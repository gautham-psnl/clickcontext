import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureToken } from '@ui/shared/token.mjs';
import { DAEMON_PORT } from '@ui/shared';
import { startDaemon } from '../../daemon/src/index';
import { startMcp } from '../../mcp/src/server';
import { runInit } from './init';

const TOKEN_PLACEHOLDER = '__UI_CONTEXT_TOKEN_PLACEHOLDER__';
const PORT_PLACEHOLDER = '__CLICKCONTEXT_PORT_PLACEHOLDER__';

const USAGE = `clickcontext <command>

Commands:
  init         Detect Next.js / Vite and patch the config for source attributes
  daemon       Start the capture daemon (keep running while you work)
                 --port <n>  listen on a custom port (default 7456)
  mcp          Start the stdio MCP server
                 register:  claude mcp add clickcontext -- npx -y clickcontext mcp
  bookmarklet  Print the bookmarklet javascript: URL (or visit http://127.0.0.1:7456/install)
                 --port <n>  point the bookmarklet at a custom daemon port
`;

/** Inject the per-install token (and daemon port) into the prebuilt browser bundle
 *  and wrap it as a javascript: URL. */
export function bookmarkletUrl(browserCode: string, token: string, port: number = DAEMON_PORT): string {
  const withToken = browserCode
    .split(TOKEN_PLACEHOLDER).join(token)
    .split(PORT_PLACEHOLDER).join(String(port));
  return `javascript:${encodeURIComponent(withToken)}`;
}

/** Parse `--port <n>` / `--port=<n>` from argv; returns DAEMON_PORT if absent. */
export function parsePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
    const m = a.match(/^--port=(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return n;
    }
  }
  return DAEMON_PORT;
}

/** Read the prebuilt browser bundle that ships next to this CLI in dist/. */
function readBrowserBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'bookmarklet.browser.js'), 'utf8');
}

export async function runCli(argv: string[]): Promise<void> {
  switch (argv[0]) {
    case 'init':
      runInit(process.env.CLICKCONTEXT_PROJECT_ROOT ?? process.cwd());
      return;
    case 'daemon': {
      const token = ensureToken();
      const port = parsePort(argv);
      const url = bookmarkletUrl(readBrowserBundle(), token, port);
      startDaemon({ installUrl: url, port });
      return;
    }
    case 'mcp':
      await startMcp();
      return;
    case 'bookmarklet': {
      const port = parsePort(argv);
      process.stdout.write(`${bookmarkletUrl(readBrowserBundle(), ensureToken(), port)}\n`);
      return;
    }
    case 'help':
    case '--help':
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command: ${argv[0]}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}
