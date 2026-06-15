import type { UiContext } from '@ui/shared';
import { DAEMON_HOST, DAEMON_PORT, CAPTURE_TOKEN_HEADER } from '@ui/shared';

// Replaced at build time by esbuild `define`. Guarded with typeof for tests.
declare const __UI_CONTEXT_TOKEN__: string;
// Replaced at build time too; the CLI rewrites it at runtime when --port is used,
// so a custom-port daemon's /install page hands out a matching bookmarklet.
declare const __CLICKCONTEXT_PORT__: string;

export interface SendOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function sendCapture(ctx: UiContext, opts: SendOptions = {}): Promise<boolean> {
  const token = opts.token ?? (typeof __UI_CONTEXT_TOKEN__ !== 'undefined' ? __UI_CONTEXT_TOKEN__ : '');
  const port = typeof __CLICKCONTEXT_PORT__ !== 'undefined' ? __CLICKCONTEXT_PORT__ : String(DAEMON_PORT);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`http://${DAEMON_HOST}:${port}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: token },
      body: JSON.stringify(ctx),
    });
    return res.ok;
  } catch {
    return false;
  }
}
