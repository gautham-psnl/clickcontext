// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeSerialize } from '@ui/shared';

describe('safeSerialize', () => {
  it('passes through plain primitives and objects', () => {
    expect(safeSerialize({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  it('marks functions', () => {
    expect(safeSerialize({ onClick: function handleClick() {} })).toEqual({ onClick: '[Function: handleClick]' });
  });

  it('breaks circular references', () => {
    const o: any = { name: 'root' };
    o.self = o;
    expect(safeSerialize(o)).toEqual({ name: 'root', self: '[Circular]' });
  });

  it('truncates deep nesting at maxDepth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = safeSerialize(deep, { maxDepth: 2 }) as any;
    expect(out.a.b).toBe('[Object …]');
  });

  it('caps array length', () => {
    const out = safeSerialize(Array.from({ length: 5 }, (_, i) => i), { maxItems: 3 }) as any[];
    expect(out.slice(0, 3)).toEqual([0, 1, 2]);
    expect(out[3]).toBe('[…+2 more]');
  });

  it('caps object key count', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 5; i++) big[`k${i}`] = i;
    const out = safeSerialize(big, { maxKeys: 2 }) as any;
    expect(Object.keys(out)).toHaveLength(3); // 2 kept + the "…" marker
    expect(out['…']).toBe('[+3 more keys]');
  });

  it('truncates long strings', () => {
    const out = safeSerialize('x'.repeat(20), { maxStringLength: 5 }) as string;
    expect(out.startsWith('xxxxx')).toBe(true);
    expect(out).toContain('+15 chars');
  });

  it('marks DOM nodes', () => {
    const el = document.createElement('button');
    expect(safeSerialize({ node: el })).toEqual({ node: '[HTMLButtonElement]' });
  });

  it('marks react elements', () => {
    const reactEl = { $$typeof: Symbol.for('react.element'), type: function Foo() {} };
    expect(safeSerialize({ child: reactEl })).toEqual({ child: '[ReactElement: Foo]' });
  });

  it('marks React 19 transitional elements (host + component types)', () => {
    const componentEl = { $$typeof: Symbol.for('react.transitional.element'), type: function Bar() {} };
    const hostEl = { $$typeof: Symbol.for('react.transitional.element'), type: 'span' };
    expect(safeSerialize({ a: componentEl, b: hostEl })).toEqual({
      a: '[ReactElement: Bar]', b: '[ReactElement: span]',
    });
  });

  it('handles bigint, symbol, undefined', () => {
    expect(safeSerialize({ a: 10n, b: Symbol('s'), c: undefined })).toEqual({
      a: '10n', b: '[Symbol: s]', c: '[undefined]',
    });
  });
});
