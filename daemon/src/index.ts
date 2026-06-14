import { ensureToken } from '@ui/shared/token.mjs';
import { DAEMON_HOST, DAEMON_PORT } from '@ui/shared';
import { createDaemon } from './server';

export function startDaemon(): void {
  const token = ensureToken();
  const server = createDaemon({
    token,
    onCapture: (ctx) => console.error(`[clickcontext] captured ${ctx.meta?.url ?? ''} (${ctx.meta?.layers?.join(', ')})`),
  });
  server.listen(DAEMON_PORT, DAEMON_HOST, () => {
    console.error(`[clickcontext] daemon listening on http://${DAEMON_HOST}:${DAEMON_PORT}`);
  });
}
