import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

// 1) Browser bundle — the bookmarklet code, with the token left as a placeholder.
//    The CLI injects the per-install token at runtime (it differs per machine).
await build({
  entryPoints: [join(root, 'bookmarklet/src/index.ts')],
  outfile: join(dist, 'bookmarklet.browser.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome120'],
  define: { __UI_CONTEXT_TOKEN__: JSON.stringify('__UI_CONTEXT_TOKEN_PLACEHOLDER__') },
});

// 2) Node CLI — fully self-contained: bundles daemon + mcp + shared + all npm deps.
//    Bundling the MCP SDK keeps only the stdio transport (tree-shakes express/hono/http).
await build({
  entryPoints: [join(root, 'cli/src/entry.ts')],
  outfile: join(dist, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node18'],
  banner: { js: '#!/usr/bin/env node' },
});

console.log('built dist/cli.js + dist/bookmarklet.browser.js');
