import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getLatestUiContextText } from './tool';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'clickcontext', version: '0.1.0' });

  // Compact summary — the default entry point. Cheap (~200 tokens) and usually
  // all that's needed: the resolved source file:line plus the element + user frames.
  server.registerTool(
    'get_latest_ui_context',
    {
      title: 'Get latest UI context (compact)',
      description:
        'CALL THIS FIRST when the user asks about any UI element, component, or anything visual in their browser — "what is this?", "why is this disabled?", "which component is this?", "what did I click?". Returns the last element the user clicked via the clickcontext bookmarklet: source file:line, React component stack, DOM path, and accessibility info. If no capture exists yet, tell them to activate the bookmarklet and click an element first. Only call get_latest_ui_context_full when you specifically need full props, hook state, or computed styles.',
    },
    async () => ({
      content: [{ type: 'text', text: await getLatestUiContextText(undefined, undefined, 'summary') }],
    }),
  );

  // Full capture — the escape hatch. Large; call only when the compact summary
  // is insufficient and you specifically need props / hooks / styles / raw HTML.
  server.registerTool(
    'get_latest_ui_context_full',
    {
      title: 'Get latest UI context (full)',
      description:
        'Returns the COMPLETE capture of the most recently selected UI element: every component frame with full props + hook state, the element\'s computed styles, and raw HTML, plus resolved source for the element and each frame. This payload is LARGE — do NOT call it by default. Call get_latest_ui_context (compact) first; only escalate to this tool when you specifically need a component\'s props, hook/state values, computed styles, or the element\'s HTML that the summary omits. Same underlying selection as get_latest_ui_context.',
    },
    async () => ({
      content: [{ type: 'text', text: await getLatestUiContextText(undefined, undefined, 'full') }],
    }),
  );

  return server;
}

export async function startMcp(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
