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

  it('returns the captured context (unavailable source passes through untouched)', async () => {
    writeLatestCapture(ctx, path);
    const out = JSON.parse(await getLatestUiContextText(path));
    expect(out.status).toBe('ok');
    expect(out.context).toEqual(ctx);
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
      const out = JSON.parse(await getLatestUiContextText(path, root));
      expect(out.status).toBe('ok');
      expect(out.context.source.code).toMatch(/> +5 \| row 5/);
      expect(out.context.source.resolvedFile).toContain('Foo.tsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
