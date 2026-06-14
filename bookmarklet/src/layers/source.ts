import type { SourceLayer } from '@ui/shared';

interface FiberLike {
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  _debugStack?: unknown; // React 19: an Error; older fixtures: { toString() }; or a string
  return: unknown;
}

// Frames that belong to the framework, not the user's code.
const SKIP_FILE = /node_modules|[\\/]next[\\/]dist[\\/]|react-dom|react-server|webpack[\\/]runtime|[\\/]react[\\/]cjs[\\/]/;

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

function looksLikeSource(file: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs)$/.test(file.replace(/[?#].*$/, ''));
}

/**
 * Parse one stack line to {file,line,column}. Handles:
 *   "at Name (LOCATION)"  ·  "at LOCATION"  ·  "Name@LOCATION" (Firefox)
 * where LOCATION may itself contain parens, e.g. webpack-internal:///(app-pages-browser)/./app/x.tsx:42:7
 */
function parseFrame(line: string): { file: string; line: number; column: number } | null {
  let s = line.trim().replace(/^at\s+/, '');
  // If a "Name (LOCATION)" wrapper is present, the location is the parenthesised tail.
  const wrapped = s.match(/\s\((.+)\)$/);
  if (wrapped) s = wrapped[1];
  else s = s.replace(/^.*?@/, ''); // Firefox "Name@LOCATION"
  const m = s.match(/^(.*):(\d+):(\d+)$/);
  if (!m) return null;
  return { file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
}

function stackString(dbg: unknown): string {
  if (typeof dbg === 'string') return dbg;
  if (dbg && typeof dbg === 'object') {
    const e = dbg as { stack?: unknown; toString?: () => string };
    if (typeof e.stack === 'string') return e.stack; // real Error (React 19 owner stack)
    if (typeof e.toString === 'function') return e.toString();
  }
  return '';
}

export function captureSource(el: Element): SourceLayer {
  const key = fiberKey(el);
  if (!key) return { available: false, reason: 'no React fiber' };

  let fiber = (el as unknown as Record<string, FiberLike | null | undefined>)[key];

  while (fiber) {
    // React <=18 dev: exact source on the fiber.
    const ds = fiber._debugSource;
    if (ds?.fileName) {
      return { available: true, file: ds.fileName, line: ds.lineNumber ?? 0, column: ds.columnNumber ?? 0 };
    }
    // React 19 (and Next dev): parse the owner/creation stack for the first user frame.
    const stack = stackString(fiber._debugStack);
    if (stack) {
      for (const raw of stack.split('\n')) {
        const frame = parseFrame(raw);
        if (frame && looksLikeSource(frame.file) && !SKIP_FILE.test(frame.file)) {
          return { available: true, file: frame.file, line: frame.line, column: frame.column };
        }
      }
    }
    fiber = fiber.return as FiberLike | null | undefined;
  }

  return { available: false, reason: 'no _debugSource and no user frame in _debugStack (Tier 0; build may strip source info)' };
}
