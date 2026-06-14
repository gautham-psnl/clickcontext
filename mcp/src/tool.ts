import { readLatestCapture } from '@ui/shared/capture-file';
import type { ComponentFrame, SourceLayer, UiContext } from '@ui/shared';
import { resolveSource, resolveFrameSource } from './resolve-source';

export type Detail = 'summary' | 'full';

const MAX_NAME = 120;
const MAX_PROP_KEYS = 30;

/** Make an absolute path project-relative for compact, readable output. */
function relativize(file: string | undefined, root: string): string | undefined {
  if (!file) return undefined;
  if (file.startsWith(root)) {
    const rel = file.slice(root.length).replace(/^\/+/, '');
    return rel || file;
  }
  return file;
}

/**
 * `file:line` for a source layer, using only the *resolved* path. Returns
 * undefined when resolution failed (no resolvedFile) so callers surface the
 * resolveError instead of a useless bundle URL.
 */
function fileLine(src: SourceLayer | undefined, root: string): string | undefined {
  if (!src?.resolvedFile) return undefined;
  const rel = relativize(src.resolvedFile, root);
  const line = src.resolvedLine ?? src.line;
  return line ? `${rel}:${line}` : rel;
}

/** Prop names only — values are the bulk of the payload and rarely needed up front. */
function propKeysOf(props: unknown): string[] | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined;
  const keys = Object.keys(props as Record<string, unknown>).filter((k) => k !== 'children');
  if (keys.length === 0) return undefined;
  return keys.length > MAX_PROP_KEYS
    ? [...keys.slice(0, MAX_PROP_KEYS), `…+${keys.length - MAX_PROP_KEYS} more`]
    : keys;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Compact projection of an enriched capture. Surfaces the one thing an agent
 * almost always wants — the resolved source `file:line` (primarySource) — plus
 * the selected element and the user's own component frames (prop *keys* only).
 * Library/framework frames collapse to a count. Full props, hook state, computed
 * styles, and raw HTML are omitted; fetch them with detail:'full'.
 */
function buildSummary(ctx: UiContext, root: string): Record<string, unknown> {
  const frames = ctx.component.stack ?? [];
  const userFrames = frames.filter((f) => f.isUserComponent);
  const otherFrames = frames.length - userFrames.length;

  // primarySource: first user frame's resolved position, else the element's own.
  const primaryFrame = userFrames[0];
  const primarySource = fileLine(primaryFrame?.source, root) ?? fileLine(ctx.source, root) ?? null;

  const element: Record<string, unknown> = {
    tag: ctx.dom.tag.toLowerCase(),
    role: ctx.accessibility.role,
    name: truncate(ctx.accessibility.name, MAX_NAME),
    domPath: ctx.dom.domPath,
  };
  // Only surface a11y state when it's notable — keeps "why is this disabled?" cheap.
  if (ctx.accessibility.disabled || ctx.accessibility.ariaHidden) {
    element.state = { disabled: ctx.accessibility.disabled, ariaHidden: ctx.accessibility.ariaHidden };
  }

  const summary: Record<string, unknown> = {
    status: 'ok',
    primarySource,
    element,
    userFrames: userFrames.map((f) => ({
      name: f.name,
      source: fileLine(f.source, root),
      propKeys: propKeysOf(f.props),
    })),
    otherFrames,
    url: ctx.meta.url,
  };

  // If nothing resolved, say *why* so the agent doesn't assume the source is missing.
  if (!primarySource) {
    const err = primaryFrame?.source?.resolveError ?? ctx.source.resolveError;
    if (err) summary.sourceNote = err;
  }

  summary.hint =
    "Partial view. Call get_latest_ui_context with detail:'full' for component props, hook state, computed styles, and full HTML.";
  return summary;
}

export async function getLatestUiContextText(
  filePath?: string,
  projectRoot: string = process.env.CLICKCONTEXT_PROJECT_ROOT ?? process.cwd(),
  detail: Detail = 'summary',
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

  const enriched: UiContext = { ...ctx, source, component };

  if (detail === 'summary') {
    return JSON.stringify(buildSummary(enriched, projectRoot), null, 2);
  }

  // Full capture — compact (no pretty-print) since it's large and machine-read.
  return JSON.stringify({ status: 'ok', context: enriched });
}
