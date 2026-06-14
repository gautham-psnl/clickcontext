// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureComponent } from '../bookmarklet/src/layers/component';

// Build a fake fiber chain like React attaches at runtime.
function attachFiber(el: Element): void {
  const appFiber = {
    type: { name: 'App' },
    memoizedProps: {},
    _debugHookTypes: null,
    memoizedState: null,
    return: null,
  };
  const cartFiber = {
    type: { name: 'Cart' },
    memoizedProps: { items: [] },
    _debugHookTypes: ['useState'],
    memoizedState: { memoizedState: false, next: null },
    return: appFiber,
  };
  const internalFiber = {
    type: { name: 'InnerLayoutRouter' }, // should be filtered out
    memoizedProps: {},
    _debugHookTypes: null,
    memoizedState: null,
    return: cartFiber,
  };
  const btnFiber = {
    type: { name: 'CheckoutButton' },
    memoizedProps: { disabled: true, onClick: function handleClick() {} },
    _debugHookTypes: ['useState', 'useState'],
    memoizedState: { memoizedState: 0, next: { memoizedState: 'hi', next: null } },
    _debugSource: { fileName: '/src/CheckoutButton.tsx', lineNumber: 12, columnNumber: 3 },
    return: internalFiber,
  };
  (el as any)['__reactFiber$abc123'] = btnFiber;
}

describe('Layer 3 React fiber', () => {
  it('reports unavailable when no fiber is attached', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    expect(captureComponent(document.querySelector('button')!)).toEqual({ available: false });
  });

  it('walks the fiber chain, filters internals, serializes props + hooks', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    attachFiber(btn);
    const comp = captureComponent(btn);
    expect(comp.available).toBe(true);
    expect(comp.framework).toBe('react');
    const names = comp.stack!.map((f) => f.name);
    expect(names).toEqual(['CheckoutButton', 'Cart', 'App']); // InnerLayoutRouter filtered
    const checkout = comp.stack![0];
    expect(checkout.props).toEqual({ disabled: true, onClick: '[Function: handleClick]' });
    expect(checkout.hooks).toEqual([
      { type: 'useState', value: 0 },
      { type: 'useState', value: 'hi' },
    ]);
    expect(comp.stack![2].hooks).toBeNull(); // App has no _debugHookTypes
    // per-frame source captured from the fiber (resolved server-side later)
    expect(checkout.source).toEqual({ available: true, file: '/src/CheckoutButton.tsx', line: 12, column: 3 });
  });

  it('filters Next 16 / React 19 framework internals, keeping user components', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    const internals = ['SegmentViewNode', 'LayoutRouterContext', 'AppRouterContext', 'GlobalLayoutRouterContext', 'HTTPAccessFallbackBoundary', 'LoadingBoundary', 'RootErrorBoundary', 'ScrollAndMaybeFocusHandler'];
    const internalChain = internals.reduceRight<any>(
      (ret, name) => ({ type: { name }, memoizedProps: {}, _debugHookTypes: null, memoizedState: null, return: ret }),
      null,
    );
    const userFiber = { type: { name: 'Hero' }, memoizedProps: { title: 'hi' }, _debugHookTypes: null, memoizedState: null, return: internalChain };
    (btn as any)['__reactFiber$z'] = userFiber;
    const comp = captureComponent(btn);
    expect(comp.stack!.map((f) => f.name)).toEqual(['Hero']);
  });
});
