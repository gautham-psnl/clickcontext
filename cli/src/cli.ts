import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureToken } from '@ui/shared/token.mjs';
import { startDaemon } from '../../daemon/src/index';
import { startMcp } from '../../mcp/src/server';

const TOKEN_PLACEHOLDER = '__UI_CONTEXT_TOKEN_PLACEHOLDER__';

const USAGE = `clickcontext <command>

Commands:
  daemon       Start the capture daemon (keep running while you work)
  mcp          Start the stdio MCP server
                 register:  claude mcp add clickcontext -- npx -y clickcontext mcp
  bookmarklet  Print the bookmarklet javascript: URL (make a bookmark with it)
`;

/** Inject the per-install token into the prebuilt browser bundle and wrap it as a javascript: URL. */
export function bookmarkletUrl(browserCode: string, token: string): string {
  const withToken = browserCode.split(TOKEN_PLACEHOLDER).join(token);
  return `javascript:${encodeURIComponent(withToken)}`;
}

/** Read the prebuilt browser bundle that ships next to this CLI in dist/. */
function readBrowserBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'bookmarklet.browser.js'), 'utf8');
}

export async function runCli(argv: string[]): Promise<void> {
  switch (argv[0]) {
    case 'daemon':
      startDaemon();
      return;
    case 'mcp':
      await startMcp();
      return;
    case 'bookmarklet':
      process.stdout.write(`${bookmarkletUrl(readBrowserBundle(), ensureToken())}\n`);
      return;
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

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
