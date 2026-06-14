import { readLatestCapture } from '@ui/shared/capture-file';
import { resolveSource } from './resolve-source';

export async function getLatestUiContextText(
  filePath?: string,
  projectRoot: string = process.env.UI_CONTEXT_PROJECT_ROOT ?? process.cwd(),
): Promise<string> {
  const ctx = readLatestCapture(filePath);
  if (!ctx) {
    return JSON.stringify({
      status: 'no_capture',
      message: 'No UI element captured yet. In the browser, click the UI Context bookmarklet, select an element, then ask again.',
    }, null, 2);
  }
  const enriched = { ...ctx, source: await resolveSource(ctx.source, { projectRoot }) };
  return JSON.stringify({ status: 'ok', context: enriched }, null, 2);
}
