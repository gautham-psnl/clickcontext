import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import type { UiContext } from '@ui/shared';
import { setLatest } from './store';

export interface DaemonOptions {
  token: string;
  onCapture?: (ctx: UiContext) => void;
  installUrl?: string; // bookmarklet javascript: URL — served at GET /install
}

const MAX_BODY = 4 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': `content-type, ${CAPTURE_TOKEN_HEADER}`,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function installPage(bookmarkletUrl: string): string {
  const escaped = bookmarkletUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // Decoded snippet for paste-in-console use (same code, not URL-encoded).
  const snippet = decodeURIComponent(bookmarkletUrl.replace(/^javascript:/, ''));
  const escapedSnippet = snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;');
  return `<!doctype html>
<meta charset="utf-8">
<title>clickcontext — install</title>
<style>
  *{box-sizing:border-box}
  body{font:15px/1.6 system-ui,sans-serif;max-width:600px;margin:48px auto;padding:0 20px;color:#111}
  h1{font-size:1.3rem;margin-bottom:4px}
  .sub{color:#666;margin-top:0;margin-bottom:32px;font-size:.9rem}
  .step{margin-bottom:28px}
  .step h2{font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4f46e5;margin-bottom:8px}
  a.bm{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem;cursor:grab;user-select:none}
  a.bm:hover{background:#4338ca}
  .alt{margin-top:12px;font-size:.85rem;color:#555}
  pre{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;font-size:.78rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:80px;cursor:pointer;position:relative}
  pre::after{content:"click to copy";position:absolute;right:10px;top:8px;font-size:.7rem;color:#9ca3af;font-family:system-ui}
  pre.copied::after{content:"copied!";color:#4f46e5}
  .done{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px;font-size:.85rem;color:#166534;display:none}
</style>
<h1>clickcontext</h1>
<p class="sub">Select a UI element → ask your AI IDE about it</p>

<div class="step">
  <h2>Step 1 — drag to bookmarks bar</h2>
  <a class="bm" href="${escaped}" draggable="true">⬛ clickcontext</a>
  <p class="alt">Or paste this snippet directly into your browser console (click to copy):</p>
  <pre id="snippet" onclick="copySnippet(this)">${escapedSnippet}</pre>
</div>

<div class="step">
  <h2>Step 2 — open your app</h2>
  Go to <a href="http://localhost:3000" target="_blank">localhost:3000</a> (or wherever your dev server runs).
  Click the bookmarklet, then click any UI element.
</div>

<div class="step">
  <h2>Step 3 — ask your AI IDE</h2>
  In your AI IDE (with this project open), ask:<br>
  <em>"Why is this button disabled?"</em> or <em>"What component renders this?"</em>
</div>

<script>
function copySnippet(el) {
  navigator.clipboard.writeText(${JSON.stringify(snippet)}).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 2000);
  });
}
</script>`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: DaemonOptions): Promise<void> {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/install') {
    if (!opts.installUrl) return send(res, 503, { error: 'bookmarklet not available (daemon started without installUrl)' });
    return sendHtml(res, 200, installPage(opts.installUrl));
  }

  if (req.method === 'POST' && req.url === '/capture') {
    if (req.headers[CAPTURE_TOKEN_HEADER] !== opts.token) return send(res, 403, { error: 'invalid token' });
    try {
      const ctx = JSON.parse(await readBody(req)) as UiContext;
      setLatest(ctx);
      opts.onCapture?.(ctx);
      return send(res, 200, { ok: true, capturedAt: ctx.meta?.capturedAt });
    } catch {
      return send(res, 400, { error: 'invalid payload' });
    }
  }
  return send(res, 404, { error: 'not found' });
}

export function createDaemon(opts: DaemonOptions): Server {
  return createServer((req, res) => {
    handle(req, res, opts).catch(() => send(res, 500, { error: 'internal' }));
  });
}
