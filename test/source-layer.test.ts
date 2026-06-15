// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureSource, captureBuildAttr } from '../bookmarklet/src/layers/source';

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
      provenance: 'fiber-debug-source',
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

  it('parses a React 19 owner-stack Error with a Next app/ path (parens + skips framework)', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    const err = new Error('react-stack-top-frame');
    Object.defineProperty(err, 'stack', {
      value: [
        'Error: react-stack-top-frame',
        '    at div (<anonymous>)',
        '    at Hero (webpack-internal:///(app-pages-browser)/./app/[locale]/Hero.tsx:42:13)',
        '    at LoadingBoundary (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/layout-router.js:1:1)',
      ].join('\n'),
    });
    (btn as any)['__reactFiber$x'] = { _debugStack: err, return: null };
    const src = captureSource(btn);
    expect(src.available).toBe(true);
    expect(src.file).toContain('app/[locale]/Hero.tsx');
    expect(src.line).toBe(42);
    expect(src.column).toBe(13);
  });
});

describe('Layer 4 source (Tier 0+ build attribute)', () => {
  it('reads data-clickcontext-source off the clicked element', () => {
    document.body.innerHTML = `<button data-clickcontext-source="/Users/me/app/components/Toolbar.tsx:42:6">Save</button>`;
    expect(captureSource(document.querySelector('button')!)).toEqual({
      available: true, file: '/Users/me/app/components/Toolbar.tsx', line: 42, column: 6,
      provenance: 'build-attr',
    });
  });

  it('reads data-locatorjs (path mode) from the nearest ancestor', () => {
    document.body.innerHTML = `<div data-locatorjs="/Users/me/app/Card.tsx:10:2"><span><b>x</b></span></div>`;
    const src = captureSource(document.querySelector('b')!);
    expect(src).toEqual({ available: true, file: '/Users/me/app/Card.tsx', line: 10, column: 2, provenance: 'build-attr' });
  });

  it('prefers the build attribute over fiber debug source', () => {
    document.body.innerHTML = `<button data-clickcontext-source="/real/Button.tsx:5:1">Buy</button>`;
    const btn = document.querySelector('button')!;
    (btn as any)['__reactFiber$x'] = {
      _debugSource: { fileName: '/wrong/Other.tsx', lineNumber: 99, columnNumber: 0 },
      return: null,
    };
    expect(captureSource(btn).file).toBe('/real/Button.tsx');
    expect(captureSource(btn).provenance).toBe('build-attr');
  });

  it('survives Windows drive paths (splits on the last two colons)', () => {
    document.body.innerHTML = `<button data-clickcontext-source="C:\\app\\Button.tsx:7:3">Buy</button>`;
    expect(captureBuildAttr(document.querySelector('button')!)).toEqual({
      available: true, file: 'C:\\app\\Button.tsx', line: 7, column: 3, provenance: 'build-attr',
    });
  });

  it('reports unavailable when no build attribute is present', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    expect(captureBuildAttr(document.querySelector('button')!).available).toBe(false);
  });
});
