import { readLatestCapture } from '@ui/shared/capture-file';
import type { ComponentFrame } from '@ui/shared';
import { resolveSource, resolveFrameSource } from './resolve-source';

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

  // Shared across element + every frame so each chunk's source map is fetched once.
  const mapCache = new Map<string, unknown | null>();
  const opts = { projectRoot, mapCache };

  const source = await resolveSource(ctx.source, opts);

  let component = ctx.component;
  if (component.available && component.stack) {
    const stack: ComponentFrame[] = await Promise.all(
      component.stack.map(async (frame) => {
        if (!frame.source) return frame;
        const { source: resolved, isUserComponent } = await resolveFrameSource(frame.source, opts);
        return { ...frame, source: resolved, isUserComponent };
      }),
    );
    component = { ...component, stack };
  }

  const enriched = { ...ctx, source, component };
  return JSON.stringify({ status: 'ok', context: enriched }, null, 2);
}
