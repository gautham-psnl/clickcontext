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
        'Returns a COMPACT summary of the live UI element the developer most recently selected in their browser (via the UI Context bookmarklet): the selected element (tag/role/name/domPath), `primarySource` (the resolved source file:line — usually all you need to open the right code), and the user\'s own component frames (names + prop keys); library/framework frames collapse to an `otherFrames` count. ALWAYS call this FIRST whenever the user refers to a selected, inspected, or pointed-at UI element or component while debugging a local app — e.g. "this", "this element/component/button", "the component I selected/picked", "why is this disabled/hidden". This is the cheap default; only if it lacks what you need (component props, hook state, computed styles, raw HTML) call get_latest_ui_context_full.',
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
