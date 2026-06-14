import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { normalizeSourcePath, resolveSource, traceToOriginal } from '../mcp/src/resolve-source';
import type { SourceLayer } from '@ui/shared';

describe('normalizeSourcePath', () => {
  it('strips dev-server / bundler decorations', () => {
    expect(normalizeSourcePath('webpack-internal:///./src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeSourcePath('/src/App.tsx?t=12345')).toBe('/src/App.tsx');
    expect(normalizeSourcePath('http://localhost:3000/src/App.tsx')).toBe('/src/App.tsx');
    expect(normalizeSourcePath('./src/App.tsx')).toBe('src/App.tsx');
    // Next 16 / Turbopack group + namespace tokens
    expect(normalizeSourcePath('webpack-internal:///(app-pages-browser)/./app/[locale]/Hero.tsx')).toBe('app/[locale]/Hero.tsx');
    expect(normalizeSourcePath('turbopack:///(ssr)/./components/Cart.tsx')).toBe('components/Cart.tsx');
    // source-map `sources` identifiers
    expect(normalizeSourcePath('webpack://_N_E/./app/Events.tsx')).toBe('app/Events.tsx');
    expect(normalizeSourcePath('turbopack://[project]/components/Cart.tsx')).toBe('components/Cart.tsx');
  });
});

// A minimal valid source map: generated (line 1, col 0) -> source[0] line 5, col 0.
const MAP = {
  version: 3,
  sources: ['app/Events.tsx'],
  sourcesContent: ['L1\nL2\nL3\nL4\nTARGET line\nL6\nL7'],
  names: [],
  mappings: 'AAIA',
};

describe('traceToOriginal', () => {
  it('reverse-maps a generated position (1-based line, 1-based col input)', () => {
    expect(traceToOriginal(MAP, 1, 1)).toMatchObject({ source: 'app/Events.tsx', line: 5, column: 0 });
  });
  it('returns null when nothing maps', () => {
    expect(traceToOriginal({ version: 3, sources: [], names: [], mappings: '' }, 9, 9)).toBeNull();
  });

  it('handles sectioned (indexed) maps — Next 16 / Turbopack emits these', () => {
    const sectioned = { version: 3, sections: [{ offset: { line: 0, column: 0 }, map: MAP }] };
    expect(traceToOriginal(sectioned, 1, 1)).toMatchObject({ source: 'app/Events.tsx', line: 5 });
  });
});

describe('resolveSource', () => {
  let root = '';
  afterEach(() => { if (root && existsSync(root)) rmSync(root, { recursive: true, force: true }); root = ''; });

  function setup(): string {
    root = mkdtempSync(join(tmpdir(), 'ui-ctx-root-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/CheckoutButton.tsx'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'), 'utf8');
    return root;
  }

  it('Tier 1: embeds a code window with the target line marked', async () => {
    setup();
    const src: SourceLayer = { available: true, file: 'webpack-internal:///./src/CheckoutButton.tsx', line: 10, column: 1 };
    const out = await resolveSource(src, { projectRoot: root, window: 2 });
    expect(out.code).toContain('line 8');
    expect(out.code).toContain('> 10 | line 10');
    expect(out.resolvedFile).toContain('CheckoutButton.tsx');
  });

  it('Tier 1: reports resolveError when the file is missing', async () => {
    setup();
    const out = await resolveSource({ available: true, file: '/src/Nope.tsx', line: 3 }, { projectRoot: root });
    expect(out.code).toBeUndefined();
    expect(out.resolveError).toBeTruthy();
  });

  it('passes through unavailable source untouched', async () => {
    const src: SourceLayer = { available: false, reason: 'no fiber' };
    expect(await resolveSource(src, { projectRoot: '/tmp' })).toEqual(src);
  });

  it('Tier 1b: reverse-maps a bundled chunk position to original source via inline map', async () => {
    const b64 = Buffer.from(JSON.stringify(MAP)).toString('base64');
    const js = `globalThis.x=1\n//# sourceMappingURL=data:application/json;base64,${b64}`;
    const fetchImpl = (async () => ({ ok: true, text: async () => js })) as unknown as typeof fetch;
    const src: SourceLayer = { available: true, file: 'http://localhost:3000/_next/static/chunks/test.js', line: 1, column: 1 };
    const out = await resolveSource(src, { projectRoot: '/tmp', window: 2, fetchImpl });
    expect(out.resolveError).toBeUndefined();
    expect(out.resolvedLine).toBe(5);
    expect(out.code).toContain('> 5 | TARGET line');
    expect(out.resolvedFile).toContain('Events.tsx');
  });

  it('Tier 1b: reports resolveError when the chunk has no source map', async () => {
    const fetchImpl = (async (url: string) => ({ ok: !url.endsWith('.map'), text: async () => 'globalThis.x=1' })) as unknown as typeof fetch;
    const src: SourceLayer = { available: true, file: 'http://localhost:3000/_next/static/chunks/test.js', line: 1, column: 1 };
    const out = await resolveSource(src, { projectRoot: '/tmp', fetchImpl });
    expect(out.code).toBeUndefined();
    expect(out.resolveError).toMatch(/source map/i);
  });
});
