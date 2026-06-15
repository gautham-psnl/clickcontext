import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Framework = 'nextjs' | 'vite' | 'unknown';
export type NextRunner = 'turbopack' | 'experimental-turbo' | 'webpack';

// --- Config blocks injected per runner ---

const TURBOPACK_BLOCK = `  ...(isDev && {
    turbopack: {
      rules: {
        "**/*.{tsx,jsx}": {
          loaders: [
            { loader: "@locator/webpack-loader", options: { env: "development" } },
          ],
        },
      },
    },
  }),`;

// Next.js 14 with --turbo uses experimental.turbo instead of the stable turbopack key.
const EXPERIMENTAL_TURBO_BLOCK = `  ...(isDev && {
    experimental: {
      turbo: {
        rules: {
          "**/*.{tsx,jsx}": {
            loaders: [
              { loader: "@locator/webpack-loader", options: { env: "development" } },
            ],
          },
        },
      },
    },
  }),`;

// Webpack: uses the `webpack:` function with the `dev` param — no isDev needed.
const WEBPACK_BLOCK = `  webpack: (config, { dev }) => {
    if (dev) {
      config.module.rules.push({
        test: /\\.(tsx|jsx)$/,
        use: [{ loader: '@locator/webpack-loader', options: { env: 'development' } }],
      });
    }
    return config;
  },`;

// The Vite block injected inside the react() plugin options.
const VITE_BABEL_IMPORT = `import locatorPlugin from "@locator/babel-jsx";\n`;
const VITE_BABEL_BLOCK = `    babel: { plugins: [locatorPlugin] },\n`;

// --- Detection ---

function detect(cwd: string): { framework: Framework; configFile: string | null } {
  for (const name of ['next.config.ts', 'next.config.mjs', 'next.config.js']) {
    if (existsSync(join(cwd, name))) return { framework: 'nextjs', configFile: join(cwd, name) };
  }
  for (const name of ['vite.config.ts', 'vite.config.mjs', 'vite.config.js']) {
    if (existsSync(join(cwd, name))) return { framework: 'vite', configFile: join(cwd, name) };
  }
  return { framework: 'unknown', configFile: null };
}

/** Detect whether the project uses Turbopack, experimental turbo (v14 + --turbo), or webpack. */
export function detectNextRunner(cwd: string): NextRunner {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    const nextVer = deps['next'] ?? '';
    const major = parseInt((nextVer as string).match(/\d+/)?.[0] ?? '0', 10);
    const devScript = ((pkg.scripts as Record<string, string> | undefined)?.dev) ?? '';

    if (major >= 15 && !devScript.includes('--no-turbo')) return 'turbopack'; // stable, default in v15
    if (devScript.includes('--turbo')) return 'experimental-turbo';           // v14 opt-in
    return 'webpack';
  } catch {
    return 'webpack'; // safe default
  }
}

function isAvailable(cmd: string): boolean {
  try { execSync(`${cmd} --version`, { stdio: 'pipe' }); return true; } catch { return false; }
}

function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')) && isAvailable('pnpm')) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock')) && isAvailable('yarn')) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) && isAvailable('bun')) return 'bun';
  return 'npm';
}

function install(pkg: string, cwd: string): void {
  const pm = detectPackageManager(cwd);
  const cmd =
    pm === 'pnpm' ? `pnpm add -D ${pkg}` :
    pm === 'yarn' ? `yarn add -D ${pkg}` :
    pm === 'bun'  ? `bun add -d ${pkg}` :
    `npm install --save-dev ${pkg}`;
  process.stderr.write(`  running: ${cmd}\n`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// --- Next.js config patching ---

/**
 * Walk src from the `{` at openAt, counting braces — skipping string literals,
 * template literals, and comments so unbalanced braces inside them don't confuse the count.
 */
function matchingBrace(src: string, openAt: number): number | null {
  let depth = 0;
  let i = openAt;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === ch) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) return i; }
    i++;
  }
  return null;
}

/** Find the opening `{` of the Next.js config object. */
function findConfigOpenBrace(src: string): number | null {
  const namesToTry: string[] = [];

  // Strategy A: direct named export
  const directExport =
    src.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)?.[1] ??
    src.match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (directExport) namesToTry.push(directExport);

  // Strategy B: wrapped export — extract identifiers from wrapper args.
  // Uses [,(] so `withPlugins([...], nextConfig)` (comma-separated) is also caught.
  const exportLine =
    src.match(/export\s+default\s+.+/)?.[0] ??
    src.match(/module\.exports\s*=\s*.+/)?.[0] ?? '';
  for (const m of exportLine.matchAll(/[,(]\s*([A-Za-z_$][\w$]*)/g)) namesToTry.push(m[1]);

  // Try each candidate: look for const/let/var <name>[: TypeAnnotation] = {
  for (const name of namesToTry) {
    const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\b[^=]*=\\s*\\{`);
    const m = src.match(declRe);
    if (m?.index !== undefined) return m.index + m[0].length - 1;
  }

  // Strategy C: inline export — export default { or module.exports = {
  const inlineESM = src.match(/export\s+default\s*\{/);
  if (inlineESM?.index !== undefined) return inlineESM.index + inlineESM[0].length - 1;

  const inlineCJS = src.match(/module\.exports\s*=\s*\{/);
  if (inlineCJS?.index !== undefined) return inlineCJS.index + inlineCJS[0].length - 1;

  return null;
}

/**
 * Insert `block` just before the object's closing brace at `closeBrace`.
 * Adds a comma separator unless the preceding property already ends with one
 * (or the object is empty) — without this, single-line / no-trailing-comma
 * configs like `{ reactStrictMode: true }` fuse into invalid JS.
 */
function insertBeforeClose(src: string, closeBrace: number, block: string): string {
  let i = closeBrace - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  const prevChar = src[i];
  const sep = prevChar === ',' || prevChar === '{' ? '' : ',';
  return src.slice(0, i + 1) + sep + '\n' + block + '\n' + src.slice(closeBrace);
}

export function patchNextConfig(
  content: string,
  runner: NextRunner = 'turbopack',
): { result: string; alreadyDone: boolean; error?: string } {
  if (content.includes('@locator/webpack-loader') || content.includes('data-clickcontext-source')) {
    return { result: content, alreadyDone: true };
  }

  let out = content;

  if (runner === 'webpack') {
    // Webpack: inject a new `webpack:` function.  If one already exists, bail — adding a second
    // key would silently override the first.
    if (/\bwebpack\s*[:(]/.test(out)) {
      return {
        result: content,
        alreadyDone: false,
        error: 'config already has a webpack function — add the loader push manually:\n\n' +
          '    config.module.rules.push({\n' +
          '      test: /\\.(tsx|jsx)$/,\n' +
          "      use: [{ loader: '@locator/webpack-loader', options: { env: 'development' } }],\n" +
          '    });\n\n' +
          '  Add it inside the `if (dev)` guard before `return config`.',
      };
    }

    const openBrace = findConfigOpenBrace(out);
    if (openBrace === null) return { result: content, alreadyDone: false, error: 'could not locate Next.js config object — patch manually (see README)' };
    const closeBrace = matchingBrace(out, openBrace);
    if (closeBrace === null) return { result: content, alreadyDone: false, error: 'unbalanced braces in config file — patch manually (see README)' };

    out = insertBeforeClose(out, closeBrace, WEBPACK_BLOCK);
    return { result: out, alreadyDone: false };
  }

  // Turbopack and experimental-turbo both use the isDev spread pattern.
  if (!out.includes('isDev')) {
    const lastImport = [...out.matchAll(/^(?:import\s[^;]+;|const\s+\w+\s*=\s*require\([^)]+\);)\s*$/gm)];
    if (lastImport.length) {
      const last = lastImport[lastImport.length - 1];
      const insertAt = (last.index ?? 0) + last[0].length;
      out = out.slice(0, insertAt) + `\nconst isDev = process.env.NODE_ENV !== "production";\n` + out.slice(insertAt);
    } else {
      out = `const isDev = process.env.NODE_ENV !== "production";\n\n` + out;
    }
  }

  const block = runner === 'experimental-turbo' ? EXPERIMENTAL_TURBO_BLOCK : TURBOPACK_BLOCK;

  const openBrace = findConfigOpenBrace(out);
  if (openBrace === null) return { result: content, alreadyDone: false, error: 'could not locate Next.js config object — patch manually (see README)' };
  const closeBrace = matchingBrace(out, openBrace);
  if (closeBrace === null) return { result: content, alreadyDone: false, error: 'unbalanced braces in config file — patch manually (see README)' };

  out = insertBeforeClose(out, closeBrace, block);
  return { result: out, alreadyDone: false };
}

// --- Vite config patching ---

function patchViteConfig(content: string): { result: string; alreadyDone: boolean; error?: string } {
  if (content.includes('@locator/babel-jsx') || content.includes('locatorPlugin')) {
    return { result: content, alreadyDone: true };
  }
  if (!content.includes('react(')) {
    return { result: content, alreadyDone: false, error: 'vite.config does not contain react() plugin — patch it manually (see README)' };
  }

  let out = content;

  const lastImport = [...out.matchAll(/^import\s[^;]+;\s*$/gm)];
  if (lastImport.length) {
    const last = lastImport[lastImport.length - 1];
    const insertAt = (last.index ?? 0) + last[0].length;
    out = out.slice(0, insertAt) + '\n' + VITE_BABEL_IMPORT + out.slice(insertAt);
  } else {
    out = VITE_BABEL_IMPORT + out;
  }

  out = out.replace(/react\(\{/, `react({\n${VITE_BABEL_BLOCK}`);
  return { result: out, alreadyDone: false };
}

// --- Entry point ---

export function runInit(cwd: string): void {
  process.stdout.write(`clickcontext init — detecting project in ${cwd}\n\n`);

  const { framework, configFile } = detect(cwd);

  if (framework === 'unknown' || !configFile) {
    process.stdout.write(`  No Next.js or Vite config found.\n`);
    process.stdout.write(`  Supported: next.config.ts/mjs/js, vite.config.ts/mjs/js\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`  detected: ${framework} (${configFile.replace(cwd + '/', '')})\n`);

  const runner = framework === 'nextjs' ? detectNextRunner(cwd) : null;
  if (runner) {
    const runnerLabel = runner === 'turbopack' ? 'Turbopack (Next.js 15+)' :
                        runner === 'experimental-turbo' ? 'Turbopack experimental (Next.js 14 + --turbo)' :
                        'webpack (Next.js 14)';
    process.stdout.write(`  bundler: ${runnerLabel}\n`);
  }

  const pkg = framework === 'vite' ? '@locator/babel-jsx' : '@locator/webpack-loader';
  const pkgJson = join(cwd, 'package.json');
  let alreadyInstalled = false;
  if (existsSync(pkgJson)) {
    try {
      const p = JSON.parse(readFileSync(pkgJson, 'utf8')) as Record<string, Record<string, string>>;
      alreadyInstalled = !!(p.devDependencies?.[pkg] ?? p.dependencies?.[pkg]);
    } catch { /* ignore */ }
  }

  if (alreadyInstalled) {
    process.stdout.write(`  ${pkg} already installed — skipping install\n`);
  } else {
    process.stdout.write(`  installing ${pkg}...\n`);
    try {
      install(pkg, cwd);
      process.stdout.write(`  installed ${pkg}\n`);
    } catch {
      process.stdout.write(`  install failed — run manually: npm install --save-dev ${pkg}\n`);
    }
  }

  const content = readFileSync(configFile, 'utf8');
  const { result, alreadyDone, error } =
    framework === 'nextjs'
      ? patchNextConfig(content, runner!)
      : patchViteConfig(content);

  if (alreadyDone) {
    process.stdout.write(`  config already patched — nothing to do\n`);
  } else if (error) {
    process.stdout.write(`  could not auto-patch: ${error}\n`);
    printManualInstructions(framework, runner ?? 'turbopack');
  } else {
    writeFileSync(configFile, result, 'utf8');
    process.stdout.write(`  patched ${configFile.replace(cwd + '/', '')}\n`);
  }

  patchClaudeMd(cwd);

  process.stdout.write(`
Done. Restart your dev server to pick up the new loader.
Elements will now carry a build-time source attribute for deterministic
file:line resolution — no source maps needed.

Next:
  clickcontext daemon        # start the capture daemon
  clickcontext bookmarklet   # get the bookmarklet (or visit http://127.0.0.1:7456/install)
`);
}

const CLAUDE_MD_MARKER = '<!-- clickcontext -->';
const CLAUDE_MD_BLOCK = `${CLAUDE_MD_MARKER}
## clickcontext

When the user asks about any UI element, component, styling, or visual behavior in
their app, call the \`get_latest_ui_context\` MCP tool first. It returns the last element
they clicked via the clickcontext bookmarklet: source file:line, React component stack,
DOM path, and accessibility info. If nothing has been captured yet, ask them to activate
the bookmarklet and click an element first.
${CLAUDE_MD_MARKER}`;

function patchClaudeMd(cwd: string): void {
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
  if (existing.includes(CLAUDE_MD_MARKER)) return;
  const updated = existing ? existing.trimEnd() + '\n\n' + CLAUDE_MD_BLOCK + '\n' : CLAUDE_MD_BLOCK + '\n';
  writeFileSync(claudeMdPath, updated, 'utf8');
  process.stdout.write(`  wrote CLAUDE.md hint (so your IDE calls clickcontext proactively)\n`);
}

function printManualInstructions(framework: Framework, runner: NextRunner): void {
  if (framework === 'nextjs') {
    if (runner === 'webpack') {
      process.stdout.write(`
  Add this to your next.config webpack function:

    webpack: (config, { dev }) => {
      if (dev) {
        config.module.rules.push({
          test: /\\.(tsx|jsx)$/,
          use: [{ loader: '@locator/webpack-loader', options: { env: 'development' } }],
        });
      }
      return config;
    },
`);
    } else if (runner === 'experimental-turbo') {
      process.stdout.write(`
  Add this to your next.config object:

    const isDev = process.env.NODE_ENV !== "production";

    ...(isDev && {
      experimental: {
        turbo: {
          rules: {
            "**/*.{tsx,jsx}": {
              loaders: [{ loader: "@locator/webpack-loader", options: { env: "development" } }],
            },
          },
        },
      },
    }),
`);
    } else {
      process.stdout.write(`
  Add this to your next.config object:

    const isDev = process.env.NODE_ENV !== "production";

    ...(isDev && {
      turbopack: {
        rules: {
          "**/*.{tsx,jsx}": {
            loaders: [{ loader: "@locator/webpack-loader", options: { env: "development" } }],
          },
        },
      },
    }),
`);
    }
  } else {
    process.stdout.write(`
  Add this to your vite.config.ts:

    import locatorPlugin from "@locator/babel-jsx";

    // inside plugins: [ react({ babel: { plugins: [locatorPlugin] } }) ]
`);
  }
}
