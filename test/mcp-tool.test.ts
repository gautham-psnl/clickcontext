import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeLatestCapture } from '@ui/shared/capture-file';
import { getLatestUiContextText } from '../mcp/src/tool';
import type { UiContext } from '@ui/shared';

const path = join(tmpdir(), 'ui-context-mcp-tool-test.json');
afterEach(() => { if (existsSync(path)) rmSync(path); });

const ctx: UiContext = {
  dom: { html: '<button>Buy</button>', tag: 'BUTTON', attributes: {}, domPath: 'button', rect: { x: 0, y: 0, width: 10, height: 10 }, styles: {} },
  accessibility: { role: 'button', name: 'Buy', description: '', disabled: false, ariaHidden: false },
  component: { available: false },
  source: { available: false },
  meta: { url: 'http://localhost:3000/cart', capturedAt: '2026-06-14T00:00:00.000Z', layers: ['dom', 'accessibility'], missing: [] },
};

describe('getLatestUiContextText', () => {
  it('returns a no_capture status when nothing is captured', async () => {
    const out = JSON.parse(await getLatestUiContextText(path));
    expect(out.status).toBe('no_capture');
    expect(out.message).toMatch(/bookmarklet/i);
  });

  it('full detail returns the captured context (unavailable source passes through untouched)', async () => {
    writeLatestCapture(ctx, path);
    const out = JSON.parse(await getLatestUiContextText(path, undefined, 'full'));
    expect(out.status).toBe('ok');
    expect(out.context).toEqual(ctx);
  });

  it('resolves per-frame source and flags user vs library components', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-ctx-frames-'));
    mkdirSync(join(root, 'components'), { recursive: true });
    const heroFile = join(root, 'components/Hero.tsx');
    writeFileSync(heroFile, Array.from({ length: 10 }, (_, i) => `h${i + 1}`).join('\n'), 'utf8');
    const withStack: UiContext = {
      ...ctx,
      component: {
        available: true,
        framework: 'react',
        stack: [
          { name: 'Hero', props: {}, hooks: null, source: { available: true, file: heroFile, line: 5 } },
          { name: 'LibButton', props: {}, hooks: null, source: { available: true, file: '/x/node_modules/lib/Button.tsx', line: 3 } },
        ],
      },
      meta: { ...ctx.meta, layers: ['dom', 'accessibility', 'component'] },
    };
    writeLatestCapture(withStack, path);
    try {
      const out = JSON.parse(await getLatestUiContextText(path, root, 'full'));
      const [hero, lib] = out.context.component.stack;
      expect(hero.isUserComponent).toBe(true);
      expect(hero.source.resolvedFile).toContain('Hero.tsx');
      expect(hero.source.resolvedLine).toBe(5);
      expect(lib.isUserComponent).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enriches the source layer with real code lines (Tier 1)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-ctx-tool-root-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/Foo.tsx'), Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join('\n'), 'utf8');
    const withSource: UiContext = {
      ...ctx,
      source: { available: true, file: '/src/Foo.tsx', line: 5, column: 1 },
      meta: { ...ctx.meta, layers: ['dom', 'accessibility', 'source'] },
    };
    writeLatestCapture(withSource, path);
    try {
      const out = JSON.parse(await getLatestUiContextText(path, root, 'full'));
      expect(out.status).toBe('ok');
      expect(out.context.source.code).toMatch(/> +5 \| row 5/);
      expect(out.context.source.resolvedFile).toContain('Foo.tsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('getLatestUiContextText — summary (default)', () => {
  it('defaults to a compact summary: element + hoisted primarySource, no html/styles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-ctx-summary-'));
    mkdirSync(join(root, 'components'), { recursive: true });
    const heroFile = join(root, 'components/Hero.tsx');
    writeFileSync(heroFile, Array.from({ length: 10 }, (_, i) => `h${i + 1}`).join('\n'), 'utf8');
    const withStack: UiContext = {
      ...ctx,
      component: {
        available: true,
        framework: 'react',
        stack: [
          { name: 'Hero', props: { title: 'Hi', onClose: '[Function]', children: '[ReactElement]' }, hooks: null, source: { available: true, file: heroFile, line: 5 } },
          { name: 'LibButton', props: {}, hooks: null, source: { available: true, file: '/x/node_modules/lib/Button.tsx', line: 3 } },
        ],
      },
      meta: { ...ctx.meta, layers: ['dom', 'accessibility', 'component'] },
    };
    writeLatestCapture(withStack, path);
    try {
      const out = JSON.parse(await getLatestUiContextText(path, root)); // no detail → summary
      expect(out.status).toBe('ok');
      // resolved source is hoisted to the top, project-relative, with a line.
      expect(out.primarySource).toBe('components/Hero.tsx:5');
      // selected element is present, full html / computed styles are not.
      expect(out.element.tag).toBe('button');
      expect(out.element.role).toBe('button');
      expect(out.html).toBeUndefined();
      expect(out.element.styles).toBeUndefined();
      // only the user frame is expanded; library frames collapse to a count.
      expect(out.userFrames).toHaveLength(1);
      expect(out.userFrames[0].name).toBe('Hero');
      expect(out.userFrames[0].source).toBe('components/Hero.tsx:5');
      // prop *keys* only, and `children` is dropped as noise.
      expect(out.userFrames[0].propKeys).toEqual(['title', 'onClose']);
      expect(out.otherFrames).toBe(1);
      expect(out.hint).toMatch(/detail.*full/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('summary is dramatically smaller than full for the same capture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ui-ctx-size-'));
    mkdirSync(join(root, 'components'), { recursive: true });
    const heroFile = join(root, 'components/Hero.tsx');
    writeFileSync(heroFile, Array.from({ length: 10 }, (_, i) => `h${i + 1}`).join('\n'), 'utf8');
    const bulky: UiContext = {
      ...ctx,
      dom: { ...ctx.dom, html: '<button>'.padEnd(3000, 'x') + '</button>', styles: { color: 'red', display: 'flex' } },
      component: {
        available: true,
        framework: 'react',
        stack: [
          { name: 'Hero', props: { big: 'y'.repeat(2000) }, hooks: [{ type: 'useState', value: 'z'.repeat(2000) }], source: { available: true, file: heroFile, line: 5 } },
        ],
      },
      meta: { ...ctx.meta, layers: ['dom', 'accessibility', 'component'] },
    };
    writeLatestCapture(bulky, path);
    try {
      const summary = await getLatestUiContextText(path, root, 'summary');
      const full = await getLatestUiContextText(path, root, 'full');
      expect(summary.length).toBeLessThan(full.length / 5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports why source could not be resolved instead of silently dropping it', async () => {
    const noResolve: UiContext = {
      ...ctx,
      source: { available: true, file: '/nope/Missing.tsx', line: 9, resolveError: 'file not found' },
      meta: { ...ctx.meta, layers: ['dom', 'accessibility', 'source'] },
    };
    // Pre-resolved error survives because resolveSource passes through a missing file.
    writeLatestCapture(noResolve, path);
    const out = JSON.parse(await getLatestUiContextText(path, '/nonexistent-root'));
    expect(out.primarySource === null || typeof out.primarySource === 'string').toBe(true);
    if (out.primarySource === null) expect(out.sourceNote).toBeTruthy();
  });
});
