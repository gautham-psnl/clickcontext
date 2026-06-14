import type { SourceLayer } from '@ui/shared';

// Matches "...(/some/path/src/File.tsx:42:7)" and "...at File (webpack-internal:///./src/File.tsx:42:7)".
const FRAME_RE = /\(?([^()\s]*\/src\/[^()\s]+):(\d+):(\d+)\)?\s*$/;

interface FiberLike {
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  _debugStack?: { toString(): string };
  return: unknown;
}

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

export function captureSource(el: Element): SourceLayer {
  const key = fiberKey(el);
  if (!key) return { available: false, reason: 'no React fiber' };

  let fiber = (el as unknown as Record<string, FiberLike | null | undefined>)[key];

  while (fiber) {
    const ds = fiber._debugSource;
    if (ds?.fileName) {
      return { available: true, file: ds.fileName, line: ds.lineNumber ?? 0, column: ds.columnNumber ?? 0 };
    }
    const stackStr = fiber._debugStack?.toString() ?? '';
    const frame = stackStr.split('\n').find((l) => l.includes('/src/') && !l.includes('node_modules'));
    if (frame) {
      const m = frame.match(FRAME_RE);
      if (m) return { available: true, file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
    }
    fiber = fiber.return as FiberLike | null | undefined;
  }

  return { available: false, reason: 'no _debugSource or parseable /src/ stack frame (Tier 0; build may strip it)' };
}
