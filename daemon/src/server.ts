import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import type { UiContext } from '@ui/shared';
import { setLatest } from './store';

export interface DaemonOptions {
  token: string;
  onCapture?: (ctx: UiContext) => void;
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
