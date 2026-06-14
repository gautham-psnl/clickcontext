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
        'Returns the live UI element the developer most recently selected in their browser (via the UI Context bookmarklet): its DOM (html, attributes, computed styles), accessibility (role/name/state), the React component stack — each frame with props, hook state, its source file, and an isUserComponent flag (true = the user\'s own code, false = a library/framework wrapper) — and the resolved source code at the selection. ALWAYS call this FIRST whenever the user refers to a selected, inspected, or pointed-at UI element or component while debugging a local app — e.g. "this", "this element/component/button", "the component I selected/picked", "why is this disabled/hidden", "what props/state does this have". Use the per-frame isUserComponent flags to focus on the user\'s component rather than wrappers.',
    },
    async () => ({ content: [{ type: 'text', text: await getLatestUiContextText() }] }),
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
