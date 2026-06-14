import type { ComponentLayer, ComponentFrame, HookInfo } from '@ui/shared';
import { safeSerialize } from '@ui/shared';

const INTERNAL_NAMES = new Set([
  // React / generic
  'ErrorBoundary', 'LoadableComponent', 'Suspense', 'Fragment', 'StrictMode',
  // Next.js app-router internals (Next 13–16, React 18/19)
  'InnerLayoutRouter', 'OuterLayoutRouter', 'RenderFromTemplateContext',
  'HotReload', 'Router', 'AppRouter', 'ReactDevOverlay', 'RedirectBoundary',
  'RedirectErrorBoundary', 'NotFoundBoundary', 'RouterReducerProvider', 'ServerRoot',
  'SegmentViewNode', 'SegmentViewStateNode', 'LayoutRouterContext', 'TemplateContext',
  'HTTPAccessFallbackBoundary', 'HTTPAccessFallbackErrorBoundary', 'DevRootHTTPAccessFallbackBoundary',
  'LoadingBoundary', 'MetadataBoundary', 'MetadataOutlet', 'OutletBoundary',
  'InnerScrollAndFocusHandler', 'InnerScrollAndFocusHandlerOld', 'ScrollAndMaybeFocusHandler',
  'SegmentStateProvider', 'NavigationPromisesContext', 'ViewTransition',
  'ClientPageRoot', 'ClientSegmentRoot', 'PromiseQueueContext',
  '__next_root_layout_boundary__', 'AppDevOverlay', 'AppDevOverlayErrorBoundary',
  'ErrorBoundaryHandler', 'RootErrorBoundary',
]);

// React Context providers in the ancestry are plumbing, not the user's components —
// and they carry large value props. Names ending in "Context" are skipped wholesale.
function isInternal(name: string): boolean {
  return INTERNAL_NAMES.has(name) || name.endsWith('Context');
}

const MAX_FRAMES = 20;

interface FiberLike {
  type: unknown;
  memoizedProps: unknown;
  return: unknown;
  _debugHookTypes?: string[];
  memoizedState?: { memoizedState: unknown; next: unknown } | null;
}

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

function componentName(type: unknown): string | null {
  if (!type || typeof type === 'string') return null;
  const t = type as {
    name?: string;
    displayName?: string;
    render?: { name?: string; displayName?: string };
    type?: { name?: string; displayName?: string };
  };
  return t.displayName || t.name
    || t.render?.displayName || t.render?.name
    || t.type?.displayName || t.type?.name
    || null;
}

function readHooks(fiber: FiberLike): HookInfo[] | null {
  if (!fiber._debugHookTypes) return null;
  const hooks: HookInfo[] = [];
  let node = fiber.memoizedState ?? null;
  for (const type of fiber._debugHookTypes) {
    if (!node) break;
    hooks.push({ type, value: safeSerialize(node.memoizedState) });
    node = node.next as { memoizedState: unknown; next: unknown } | null;
  }
  return hooks;
}

export function captureComponent(el: Element): ComponentLayer {
  const key = fiberKey(el);
  if (!key) return { available: false };

  const stack: ComponentFrame[] = [];
  let fiber = (el as unknown as Record<string, FiberLike | null | undefined>)[key];

  while (fiber && stack.length < MAX_FRAMES) {
    const name = componentName(fiber.type);
    if (name && !isInternal(name)) {
      stack.push({
        name,
        props: safeSerialize(fiber.memoizedProps),
        hooks: readHooks(fiber),
      });
    }
    fiber = fiber.return as FiberLike | null | undefined;
  }

  return { available: true, framework: 'react', stack };
}
