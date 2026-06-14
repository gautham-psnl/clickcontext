import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { SourceLayer } from '@ui/shared';

const WINDOW = 6; // lines of context each side

export interface ResolveOptions {
  projectRoot: string;
  window?: number;
}

/** Strip dev-server decorations to get a filesystem-ish path. */
export function normalizeSourcePath(raw: string): string {
  let p = raw.trim();
  p = p.replace(/[?#].*$/, ''); // ?t=123 / #hash
  p = p.replace(/^webpack-internal:\/\/\/?/, ''); // webpack-internal:/// -> (rest)
  p = p.replace(/^turbopack:\/\/\/?/, ''); // turbopack:/// -> (rest)
  p = p.replace(/^file:\/\//, ''); // file:// URLs
  p = p.replace(/^https?:\/\/[^/]+/, ''); // http://host:port/src -> /src
  p = p.replace(/^\([^)]*\)\//, ''); // (app-pages-browser)/ / (ssr)/ Turbopack/webpack group
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

/** Enrich a SourceLayer with the actual code lines, read locally. */
export function resolveSource(source: SourceLayer, opts: ResolveOptions): SourceLayer {
  if (!source.available || !source.file || !source.line) return source;
  const filePath = resolveFilePath(source.file, opts.projectRoot);
  if (!filePath) {
    return { ...source, resolveError: `file not found under ${opts.projectRoot} (normalized: ${normalizeSourcePath(source.file)})` };
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    return { ...source, resolvedFile: filePath, code: extractWindow(content, source.line, opts.window ?? WINDOW) };
  } catch (e) {
    return { ...source, resolveError: `read failed: ${(e as Error).message}` };
  }
}
