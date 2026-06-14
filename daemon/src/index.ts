import { ensureToken } from '@ui/shared/token.mjs';
import { DAEMON_HOST, DAEMON_PORT } from '@ui/shared';
import { createDaemon } from './server';

const token = ensureToken();
const server = createDaemon({
  token,
  onCapture: (ctx) => console.error(`[ui-context] captured ${ctx.meta?.url ?? ''} (${ctx.meta?.layers?.join(', ')})`),
});

server.listen(DAEMON_PORT, DAEMON_HOST, () => {
  console.error(`[ui-context] daemon listening on http://${DAEMON_HOST}:${DAEMON_PORT}`);
});
