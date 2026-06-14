import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { normalizeSourcePath, resolveSource } from '../mcp/src/resolve-source';
import type { SourceLayer } from '@ui/shared';

describe('normalizeSourcePath', () => {
  it('strips dev-server decorations', () => {
    expect(normalizeSourcePath('webpack-internal:///./src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeSourcePath('/src/App.tsx?t=12345')).toBe('/src/App.tsx');
    expect(normalizeSourcePath('http://localhost:3000/src/App.tsx')).toBe('/src/App.tsx');
    expect(normalizeSourcePath('./src/App.tsx')).toBe('src/App.tsx');
    // Next 16 / Turbopack group segment
    expect(normalizeSourcePath('webpack-internal:///(app-pages-browser)/./app/[locale]/Hero.tsx')).toBe('app/[locale]/Hero.tsx');
    expect(normalizeSourcePath('turbopack:///(ssr)/./components/Cart.tsx')).toBe('components/Cart.tsx');
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

  it('embeds a code window with the target line marked', () => {
    setup();
    const src: SourceLayer = { available: true, file: 'webpack-internal:///./src/CheckoutButton.tsx', line: 10, column: 1 };
    const out = resolveSource(src, { projectRoot: root, window: 2 });
    expect(out.code).toContain('line 8');
    expect(out.code).toContain('> 10 | line 10');
    expect(out.code).toContain('line 12');
    expect(out.resolvedFile).toContain('CheckoutButton.tsx');
  });

  it('reports resolveError when the file is missing', () => {
    setup();
    const out = resolveSource({ available: true, file: '/src/Nope.tsx', line: 3 }, { projectRoot: root });
    expect(out.code).toBeUndefined();
    expect(out.resolveError).toBeTruthy();
  });

  it('passes through unavailable source untouched', () => {
    const src: SourceLayer = { available: false, reason: 'no fiber' };
    expect(resolveSource(src, { projectRoot: '/tmp' })).toEqual(src);
  });
});
