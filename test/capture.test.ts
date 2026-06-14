// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureUiContext } from '../bookmarklet/src/capture';

describe('captureUiContext', () => {
  it('always includes dom + accessibility and reports missing layers', () => {
    document.body.innerHTML = `<button disabled>Buy</button>`;
    const ctx = captureUiContext(document.querySelector('button')!);
    expect(ctx.meta.layers).toContain('dom');
    expect(ctx.meta.layers).toContain('accessibility');
    expect(ctx.meta.layers).not.toContain('component');
    expect(ctx.component.available).toBe(false);
    expect(ctx.meta.missing.map((m) => m.layer)).toContain('component');
    expect(ctx.meta.missing.map((m) => m.layer)).toContain('source');
    expect(typeof ctx.meta.capturedAt).toBe('string');
    expect(ctx.meta.url).toContain('http');
  });

  it('adds component + source to layers when available', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    (btn as any)['__reactFiber$x'] = {
      type: { name: 'CheckoutButton' },
      memoizedProps: { disabled: true },
      _debugHookTypes: null,
      memoizedState: null,
      _debugSource: { fileName: '/src/CheckoutButton.tsx', lineNumber: 10, columnNumber: 2 },
      return: null,
    };
    const ctx = captureUiContext(btn);
    expect(ctx.meta.layers).toContain('component');
    expect(ctx.meta.layers).toContain('source');
    expect(ctx.component.stack?.[0].name).toBe('CheckoutButton');
    expect(ctx.source.file).toBe('/src/CheckoutButton.tsx');
  });
});
