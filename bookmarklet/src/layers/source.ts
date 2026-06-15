import type { SourceLayer } from '@ui/shared';

interface FiberLike {
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  _debugStack?: unknown; // React 19: an Error; older fixtures: { toString() }; or a string
  return: unknown;
}

// Frames that belong to the framework, not the user's code.
const SKIP_FILE = /node_modules|[\\/]next[\\/]dist[\\/]|react-dom|react-server|webpack[\\/]runtime|[\\/]react[\\/]cjs[\\/]/;

// Build-time source attributes, in priority order. `data-clickcontext-source` is our
// own loader; `data-locatorjs` is emitted by @locator/webpack-loader (path mode) — we
// read it too so an existing LocatorJS setup lights up clickcontext for free.
const BUILD_ATTRS = ['data-clickcontext-source', 'data-locatorjs'] as const;
const BUILD_ATTR_SELECTOR = BUILD_ATTRS.map((a) => `[${a}]`).join(', ');

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

// Splits on the last two colons so Windows drive paths (C:\…) survive.
function parseSourceAttr(value: string | null): { file: string; line: number; column: number } | null {
  if (!value) return null;
  const lastColon = value.lastIndexOf(':');
  if (lastColon === -1) return null;
  const prevColon = value.lastIndexOf(':', lastColon - 1);
  if (prevColon === -1) return null;
  const file = value.slice(0, prevColon);
  const line = parseInt(value.slice(prevColon + 1, lastColon), 10);
  const column = parseInt(value.slice(lastColon + 1), 10);
  if (!file || Number.isNaN(line) || Number.isNaN(column)) return null;
  return { file, line, column };
}

export function captureBuildAttr(el: Element): SourceLayer {
  const found = el.closest(BUILD_ATTR_SELECTOR);
  if (found) {
    for (const attr of BUILD_ATTRS) {
      const parsed = parseSourceAttr(found.getAttribute(attr));
      if (parsed) {
        return { available: true, file: parsed.file, line: parsed.line, column: parsed.column, provenance: 'build-attr' };
      }
    }
  }
  return { available: false, reason: 'no build-time source attribute' };
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

/** Extract a source position from a single fiber (no walking). */
export function sourceFromFiber(fiber: FiberLike | null | undefined): SourceLayer {
  if (!fiber) return { available: false, reason: 'no fiber' };
  // React <=18 dev: exact source on the fiber.
  const ds = fiber._debugSource;
  if (ds?.fileName) {
    return { available: true, file: ds.fileName, line: ds.lineNumber ?? 0, column: ds.columnNumber ?? 0, provenance: 'fiber-debug-source' };
  }
  // React 19 (and Next dev): parse the owner/creation stack for the first user frame.
  const stack = stackString(fiber._debugStack);
  if (stack) {
    for (const raw of stack.split('\n')) {
      const frame = parseFrame(raw);
      if (frame && looksLikeSource(frame.file) && !SKIP_FILE.test(frame.file)) {
        return { available: true, file: frame.file, line: frame.line, column: frame.column, provenance: 'owner-stack' };
      }
    }
  }
  return { available: false, reason: 'no source on this fiber' };
}

export function captureSource(el: Element): SourceLayer {
  // Tier 0+ : build-time source attribute on the clicked element or nearest ancestor.
  // Deterministic and bundler-proof — preferred over the best-effort fiber tiers.
  const built = captureBuildAttr(el);
  if (built.available) return built;

  // Tier 0 : React fiber debug source / owner stack (best-effort; bundlers may strip it).
  const key = fiberKey(el);
  if (!key) return { available: false, reason: 'no React fiber and no build-time source attribute' };

  let fiber = (el as unknown as Record<string, FiberLike | null | undefined>)[key];
  while (fiber) {
    const s = sourceFromFiber(fiber);
    if (s.available) return s;
    fiber = fiber.return as FiberLike | null | undefined;
  }

  return { available: false, reason: 'no build-time source attribute, no _debugSource, and no user frame in _debugStack' };
}
