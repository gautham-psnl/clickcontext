import { ensureToken } from '@ui/shared/token.mjs';
import { DAEMON_HOST, DAEMON_PORT } from '@ui/shared';
import { createDaemon } from './server';

export interface StartDaemonOptions {
  installUrl?: string;
  port?: number;
}

/** Is a clickcontext daemon already answering on this port? Distinguishes
 *  "our daemon is already up" (harmless) from "some other process owns it". */
async function isOurDaemon(host: string, port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(`http://${host}:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body?.ok === true;
  } catch {
    return false;
  }
}

export function startDaemon(opts: StartDaemonOptions = {}): void {
  const token = ensureToken();
  const port = opts.port ?? DAEMON_PORT;
  const server = createDaemon({
    token,
    installUrl: opts.installUrl,
    onCapture: (ctx) => console.error(`[clickcontext] captured ${ctx.meta?.url ?? ''} (${ctx.meta?.layers?.join(', ')})`),
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') {
      console.error(`[clickcontext] daemon error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    // Port is taken — find out by whom before deciding it's a failure.
    void isOurDaemon(DAEMON_HOST, port).then((ours) => {
      if (ours) {
        console.error(`[clickcontext] a daemon is already running on http://${DAEMON_HOST}:${port} — you're all set.`);
        console.error(`[clickcontext] the daemon is shared across all your projects; no need to start another.`);
        process.exitCode = 0;
      } else {
        console.error(`[clickcontext] port ${port} is already in use by another process.`);
        console.error(`[clickcontext] free it, or start on a different port:`);
        console.error(`[clickcontext]   clickcontext daemon --port <n>`);
        console.error(`[clickcontext] then reinstall the bookmarklet from http://${DAEMON_HOST}:<n>/install`);
        process.exitCode = 1;
      }
    });
  });

  server.listen(port, DAEMON_HOST, () => {
    console.error(`[clickcontext] daemon listening on http://${DAEMON_HOST}:${port}`);
    if (opts.installUrl) console.error(`[clickcontext] bookmarklet install page → http://${DAEMON_HOST}:${port}/install`);
  });
}
