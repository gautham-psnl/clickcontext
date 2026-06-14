// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cssPathTo } from '../bookmarklet/src/dom-path';
import { captureDom } from '../bookmarklet/src/layers/dom';

describe('Layer 1 DOM', () => {
  it('builds a css-ish path', () => {
    document.body.innerHTML = `<main><div class="cart"><button id="buy" class="checkout-btn primary">Buy</button></div></main>`;
    const btn = document.getElementById('buy')!;
    expect(cssPathTo(btn)).toBe('button#buy');
  });

  it('captures tag, attributes, and curated computed styles', () => {
    document.body.innerHTML = `<button disabled class="x" aria-label="Buy">Buy</button>`;
    const btn = document.querySelector('button')!;
    const dom = captureDom(btn);
    expect(dom.tag).toBe('BUTTON');
    expect(dom.attributes.class).toBe('x');
    expect(dom.attributes['aria-label']).toBe('Buy');
    expect(dom.styles).toHaveProperty('display');
    expect(dom.styles).toHaveProperty('opacity');
    expect(typeof dom.html).toBe('string');
  });
});
