// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureSource } from '../bookmarklet/src/layers/source';

describe('Layer 4 source (Tier 0)', () => {
  it('reports unavailable without a fiber', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    expect(captureSource(document.querySelector('button')!).available).toBe(false);
  });

  it('reads _debugSource when present', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    (btn as any)['__reactFiber$x'] = {
      _debugSource: { fileName: '/src/components/CheckoutButton.tsx', lineNumber: 23, columnNumber: 5 },
      return: null,
    };
    expect(captureSource(btn)).toEqual({
      available: true, file: '/src/components/CheckoutButton.tsx', line: 23, column: 5,
    });
  });

  it('parses a _debugStack frame containing /src/', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    const stack = [
      'Error: react-stack-top-frame',
      '    at CheckoutButton (webpack-internal:///./src/components/CheckoutButton.tsx:42:7)',
      '    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:1:1)',
    ].join('\n');
    (btn as any)['__reactFiber$x'] = {
      _debugStack: { toString: () => stack },
      return: null,
    };
    const src = captureSource(btn);
    expect(src.available).toBe(true);
    expect(src.file).toContain('/src/components/CheckoutButton.tsx');
    expect(src.line).toBe(42);
    expect(src.column).toBe(7);
  });
});
