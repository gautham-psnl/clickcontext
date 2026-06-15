// Adversarial probe: throw realistic next.config shapes at patchNextConfig,
// then VALIDATE the patched output is still syntactically valid JS.
// This catches the dangerous failure mode my unit tests miss:
// a patch that "contains the loader string" but produces broken code.

import { transformSync } from 'esbuild';

// patchNextConfig is TS; run this with: node --import tsx/esm test/probe-configs.mjs
const { patchNextConfig } = await import('../cli/src/init.ts');

function parses(code, loader) {
  try {
    // Strip TS types so esbuild parses .js/.ts uniformly.
    transformSync(code, { loader, format: 'esm' });
    return true;
  } catch (e) {
    return e.message.split('\n')[0];
  }
}

const CASES = [
  // 1. Plain ESM with as const
  ['esm-asconst', 'ts', `const nextConfig = { reactStrictMode: true } as const;
export default nextConfig;`],

  // 2. Function-form default export (config as a function)
  ['fn-export', 'ts', `export default function () {
  return { reactStrictMode: true };
}`],

  // 3. Async function config
  ['async-fn-export', 'ts', `export default async (phase) => {
  return { reactStrictMode: true };
};`],

  // 4. module.exports as a function (phase-based)
  ['cjs-fn', 'js', `module.exports = (phase, { defaultConfig }) => {
  return { reactStrictMode: true };
};`],

  // 5. Inline object directly in module.exports
  ['cjs-inline', 'js', `module.exports = {
  reactStrictMode: true,
  images: { domains: ['a.com'] },
};`],

  // 6. Config with a trailing comment after the closing brace
  ['trailing-comment', 'ts', `const nextConfig = {
  reactStrictMode: true,
}; // end config
export default nextConfig;`],

  // 7. Config with computed/spread inside
  ['spread-inside', 'ts', `const base = { reactStrictMode: true };
const nextConfig = {
  ...base,
  images: { domains: ['a.com'] },
};
export default nextConfig;`],

  // 8. Multiple wrappers nested
  ['nested-wrappers', 'js', `module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {});
const nextConfig = { reactStrictMode: true };`],

  // 9. const with type annotation and satisfies
  ['type-satisfies', 'ts', `import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
} satisfies NextConfig;
export default nextConfig;`],

  // 10. Config object already has a webpack key (turbopack target — should still be valid)
  ['has-webpack', 'ts', `const nextConfig = {
  webpack(config) { return config; },
};
export default nextConfig;`],

  // 11. Regex containing braces in a value
  ['regex-brace', 'ts', `const nextConfig = {
  rewrites: async () => [{ source: '/(.*)', destination: '/x' }],
};
export default nextConfig;`],

  // 12. Template literal with braces
  ['template-brace', 'ts', `const nextConfig = {
  basePath: \`\${process.env.BASE || '/app'}\`,
};
export default nextConfig;`],

  // 13. Object with method shorthand and arrow returning object
  ['methods', 'ts', `const nextConfig = {
  async headers() {
    return [{ source: '/', headers: [] }];
  },
};
export default nextConfig;`],

  // 14. JSDoc + no semicolon + nested deeply
  ['deep-nested', 'js', `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'a.com' }] },
}
module.exports = nextConfig`],

  // 15. export default with parens wrapping
  ['paren-wrap', 'ts', `const nextConfig = { reactStrictMode: true };
export default (nextConfig);`],
];

const RUNNERS = ['turbopack', 'experimental-turbo', 'webpack'];
let broken = 0, errored = 0, ok = 0;

for (const [name, loader, src] of CASES) {
  for (const runner of RUNNERS) {
    const { result, error, alreadyDone } = patchNextConfig(src, runner);
    if (error) {
      errored++;
      console.log(`  GRACEFUL  ${name} [${runner}] → ${error}`);
      continue;
    }
    const verdict = parses(result, loader);
    if (verdict === true) {
      ok++;
    } else {
      broken++;
      console.log(`✗ BROKEN    ${name} [${runner}] → ${verdict}`);
      console.log('  --- output ---');
      console.log(result.split('\n').map(l => '    ' + l).join('\n'));
      console.log('  --------------');
    }
  }
}

console.log(`\n${ok} valid · ${errored} graceful-error · ${broken} BROKEN (invalid JS produced)`);
process.exit(broken > 0 ? 1 : 0);
