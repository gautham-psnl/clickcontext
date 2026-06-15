import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureToken } from '../shared/src/token.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const token = ensureToken();
// Keep in sync with DAEMON_PORT in shared/src/constants.ts. This standalone
// dev build bakes the default port; the shipped CLI build uses a placeholder.
const DEFAULT_PORT = 7456;

const result = await build({
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['chrome120'],
  define: {
    __UI_CONTEXT_TOKEN__: JSON.stringify(token),
    __CLICKCONTEXT_PORT__: JSON.stringify(String(DEFAULT_PORT)),
  },
  // Browser bundle only imports the @ui/shared barrel (no node-only subpaths).
  alias: { '@ui/shared': join(root, 'shared/src/index.ts') },
});

const code = result.outputFiles[0].text;
const url = `javascript:${encodeURIComponent(code)}`;

const distDir = join(here, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'bookmarklet.js'), code);
writeFileSync(join(distDir, 'bookmarklet-url.txt'), url);

const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
writeFileSync(join(distDir, 'install.html'), `<!doctype html>
<meta charset="utf-8">
<title>UI Context — install</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}a.bm{display:inline-block;padding:8px 14px;border:1px solid #4f46e5;border-radius:8px;color:#4f46e5;text-decoration:none;font-weight:600}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}</style>
<h1>UI Context</h1>
<p>1. Drag this to your bookmarks bar:</p>
<p><a class="bm" href="${escapedUrl}">ClickContext</a></p>
<p>2. Start the daemon: <code>npm run daemon</code></p>
<p>3. On any localhost app, click the bookmarklet, then click a UI element. Ask your IDE about it.</p>`);

console.log(`bookmarklet: ${code.length} bytes of code, ${url.length} chars as URL`);
const LIMIT = 60000;
if (url.length > LIMIT) {
  console.error(`WARNING: bookmarklet URL is ${url.length} chars (> ${LIMIT}). See Risk note: drop dom-accessibility-api from the bundle and use a minimal name read.`);
}
