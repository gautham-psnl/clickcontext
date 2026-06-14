import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { getLatestUiContextText } from './tool';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'ui-context', version: '0.1.0' });
  server.registerTool(
    'get_latest_ui_context',
    {
      title: 'Get latest UI context',
      description:
        'Returns the most recently captured live UI element context: DOM (html, attributes, computed styles), accessibility (role, name, state), React component stack with props and hook state, and a best-effort source location. Call this when the user asks about a UI element they selected in the browser with the UI Context bookmarklet.',
    },
    async () => ({ content: [{ type: 'text', text: getLatestUiContextText() }] }),
  );
  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
