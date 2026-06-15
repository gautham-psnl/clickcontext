import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The turbopack block we inject into next.config.* for Next.js + Turbopack.
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

// The Vite block we inject inside the react() plugin options.
const VITE_BABEL_IMPORT = `import locatorPlugin from "@locator/babel-jsx";\n`;
const VITE_BABEL_BLOCK = `    babel: { plugins: [locatorPlugin] },\n`;

type Framework = 'nextjs' | 'vite' | 'unknown';

function detect(cwd: string): { framework: Framework; configFile: string | null } {
  for (const name of ['next.config.ts', 'next.config.mjs', 'next.config.js']) {
    if (existsSync(join(cwd, name))) return { framework: 'nextjs', configFile: join(cwd, name) };
  }
  for (const name of ['vite.config.ts', 'vite.config.mjs', 'vite.config.js']) {
    if (existsSync(join(cwd, name))) return { framework: 'vite', configFile: join(cwd, name) };
  }
  return { framework: 'unknown', configFile: null };
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

function patchNextConfig(content: string): { result: string; alreadyDone: boolean; error?: string } {
  if (content.includes('@locator/webpack-loader') || content.includes('data-clickcontext-source')) {
    return { result: content, alreadyDone: true };
  }

  let out = content;

  // Add isDev const before the nextConfig declaration (after the last import line).
  if (!out.includes('isDev')) {
    // Insert after the last top-level import/require statement.
    const lastImport = [...out.matchAll(/^(?:import\s[^;]+;|const\s+\w+\s*=\s*require\([^)]+\);)\s*$/gm)];
    if (lastImport.length) {
      const last = lastImport[lastImport.length - 1];
      const insertAt = (last.index ?? 0) + last[0].length;
      out = out.slice(0, insertAt) + `\nconst isDev = process.env.NODE_ENV !== "production";\n` + out.slice(insertAt);
    } else {
      out = `const isDev = process.env.NODE_ENV !== "production";\n\n` + out;
    }
  }

  // Find the closing brace: last `};` before `export default` (ESM) or last `};` in file (CJS).
  const esmIdx = out.lastIndexOf('export default');
  const cjsIdx = out.lastIndexOf('module.exports');
  if (esmIdx === -1 && cjsIdx === -1) return { result: content, alreadyDone: false, error: 'could not find `export default` or `module.exports` in config file' };

  const searchIn = esmIdx !== -1 ? out.slice(0, esmIdx) : out;
  const closingBrace = searchIn.lastIndexOf('};');
  if (closingBrace === -1) return { result: content, alreadyDone: false, error: 'could not find config object closing `};`' };

  out = out.slice(0, closingBrace) + TURBOPACK_BLOCK + '\n};\n' + out.slice(closingBrace + 2);
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

  // Add import at the top (after last existing import).
  const lastImport = [...out.matchAll(/^import\s[^;]+;\s*$/gm)];
  if (lastImport.length) {
    const last = lastImport[lastImport.length - 1];
    const insertAt = (last.index ?? 0) + last[0].length;
    out = out.slice(0, insertAt) + '\n' + VITE_BABEL_IMPORT + out.slice(insertAt);
  } else {
    out = VITE_BABEL_IMPORT + out;
  }

  // Inject babel option into react({ ... }) — find the first `react({` and add inside.
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

  // 1. Install the right package.
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

  // 2. Patch the config file.
  const content = readFileSync(configFile, 'utf8');
  const { result, alreadyDone, error } =
    framework === 'nextjs' ? patchNextConfig(content) : patchViteConfig(content);

  if (alreadyDone) {
    process.stdout.write(`  config already patched — nothing to do\n`);
  } else if (error) {
    process.stdout.write(`  could not auto-patch: ${error}\n`);
    printManualInstructions(framework);
  } else {
    writeFileSync(configFile, result, 'utf8');
    process.stdout.write(`  patched ${configFile.replace(cwd + '/', '')}\n`);
  }

  process.stdout.write(`
Done. Restart your dev server to pick up the new loader.
Elements will now carry a build-time source attribute for deterministic
file:line resolution — no source maps needed.

Next:
  clickcontext daemon        # start the capture daemon
  clickcontext bookmarklet   # get the bookmarklet (or visit http://127.0.0.1:7456/install)
`);
}

function printManualInstructions(framework: Framework): void {
  if (framework === 'nextjs') {
    process.stdout.write(`
  Add this to your next.config.ts manually:

    const isDev = process.env.NODE_ENV !== "production";

    // inside your nextConfig object:
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
  } else {
    process.stdout.write(`
  Add this to your vite.config.ts manually:

    import locatorPlugin from "@locator/babel-jsx";

    // inside plugins: [ react({ babel: { plugins: [locatorPlugin] } }) ]
`);
  }
}
