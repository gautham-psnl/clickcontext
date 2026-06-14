import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FlattenMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';
import type { SourceLayer } from '@ui/shared';

const WINDOW = 6; // lines of context each side

export interface ResolveOptions {
  projectRoot: string;
  window?: number;
  fetchImpl?: typeof fetch;
}

/** Strip dev-server / bundler decorations to get a filesystem-ish path. */
export function normalizeSourcePath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/[?#].*$/, ''); // ?t=123 / #hash
  p = p.replace(/^https?:\/\/[^/]+/, ''); // http://host:port/src -> /src
  p = p.replace(/^webpack-internal:\/\/\/?/, ''); // webpack-internal:/// -> rest
  p = p.replace(/^webpack:\/\/\/?/, ''); // webpack:// -> rest (source-map sources)
  p = p.replace(/^turbopack:\/\/\/?/, ''); // turbopack:// -> rest
  p = p.replace(/^file:\/\//, ''); // file:// URLs
  p = p.replace(/^_N_E\//, ''); // Next webpack namespace token
  p = p.replace(/^\[project\]\//, ''); // turbopack project-root token
  p = p.replace(/^\([^)]*\)\//, ''); // (app-pages-browser)/ , (ssr)/ group segment
  p = p.replace(/^\.\//, ''); // leading ./
  return p;
}

/** Find the file on disk given a (possibly decorated) source path. */
export function resolveFilePath(raw: string, projectRoot: string): string | null {
  const norm = normalizeSourcePath(raw);
  const candidates: string[] = [];
  if (isAbsolute(norm)) candidates.push(norm);
  candidates.push(join(projectRoot, norm));
  candidates.push(join(projectRoot, norm.replace(/^\/+/, '')));
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function extractWindow(content: string, line: number, window: number): string {
  const lines = content.split('\n');
  const start = Math.max(1, line - window);
  const end = Math.min(lines.length, line + window);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '>' : ' ';
    out.push(`${marker} ${String(n).padStart(width)} | ${lines[n - 1] ?? ''}`);
  }
  return out.join('\n');
}

/** A built bundle position (not original source) — needs source-map resolution. */
function isBundledChunk(file: string): boolean {
  return /_next\/static\/|\/static\/chunks\/|\.next\//.test(file) || /^https?:\/\/.*\.[cm]?js(\?|$)/.test(file);
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  content: string | null;
}

/** Reverse-map a generated position to its original source via a source map. Pure. */
export function traceToOriginal(rawMap: unknown, line: number, column: number): OriginalPosition | null {
  // trace-mapping wants 1-based line, 0-based column; stack columns are 1-based.
  // FlattenMap handles both flat and sectioned (indexed) maps — Next 16/Turbopack emits sectioned.
  const tracer = new FlattenMap(rawMap as ConstructorParameters<typeof FlattenMap>[0]);
  const orig = originalPositionFor(tracer, { line, column: Math.max(0, column - 1) });
  if (!orig.source || orig.line == null) return null;
  return {
    source: orig.source,
    line: orig.line,
    column: orig.column ?? 0,
    content: sourceContentFor(tracer, orig.source) ?? null,
  };
}

/** Fetch a chunk's source map: inline data-URI, sourceMappingURL comment, or <chunk>.map. */
async function fetchSourceMap(chunkUrl: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  const res = await fetchImpl(chunkUrl);
  if (!res.ok) {
    const direct = await fetchImpl(`${chunkUrl}.map`);
    return direct.ok ? await direct.json() : null;
  }
  const js = await res.text();
  const matches = [...js.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
  const last = matches.length ? matches[matches.length - 1][1] : null;
  if (last && last.startsWith('data:')) {
    const b64 = last.indexOf('base64,');
    if (b64 !== -1) return JSON.parse(Buffer.from(last.slice(b64 + 7), 'base64').toString('utf8'));
    return JSON.parse(decodeURIComponent(last.slice(last.indexOf(',') + 1)));
  }
  const mapUrl = last ? new URL(last, chunkUrl).href : `${chunkUrl}.map`;
  const mapRes = await fetchImpl(mapUrl);
  return mapRes.ok ? await mapRes.json() : null;
}

/** Enrich a SourceLayer with the actual original code lines, read locally. */
export async function resolveSource(source: SourceLayer, opts: ResolveOptions): Promise<SourceLayer> {
  if (!source.available || !source.file || !source.line) return source;
  const window = opts.window ?? WINDOW;

  // Tier 1b: captured position points at a built chunk — reverse-map via its source map.
  if (isBundledChunk(source.file)) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    try {
      const rawMap = await fetchSourceMap(source.file, fetchImpl);
      if (!rawMap) return { ...source, resolveError: 'bundled chunk; source map not found' };
      const orig = traceToOriginal(rawMap, source.line, source.column ?? 1);
      if (!orig) return { ...source, resolveError: 'source map did not map this position' };

      const onDisk = resolveFilePath(orig.source, opts.projectRoot);
      const content = orig.content ?? (onDisk ? readFileSync(onDisk, 'utf8') : null);
      const resolvedFile = onDisk ?? normalizeSourcePath(orig.source);
      if (!content) return { ...source, resolvedFile, resolvedLine: orig.line, resolveError: 'mapped to source but content unavailable' };
      return { ...source, resolvedFile, resolvedLine: orig.line, code: extractWindow(content, orig.line, window) };
    } catch (e) {
      return { ...source, resolveError: `source-map resolution failed: ${(e as Error).message}` };
    }
  }

  // Tier 1: captured path is already an original source path — read it off disk.
  const filePath = resolveFilePath(source.file, opts.projectRoot);
  if (!filePath) {
    return { ...source, resolveError: `file not found under ${opts.projectRoot} (normalized: ${normalizeSourcePath(source.file)})` };
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return { ...source, resolvedFile: filePath, code: extractWindow(content, source.line, window) };
  } catch (e) {
    return { ...source, resolveError: `read failed: ${(e as Error).message}` };
  }
}
