// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { implicitRole } from '../bookmarklet/src/roles';
import { captureAccessibility } from '../bookmarklet/src/layers/accessibility';

describe('Layer 2 accessibility', () => {
  it('maps implicit roles', () => {
    document.body.innerHTML = `<a href="/x">link</a><input type="checkbox"><nav></nav>`;
    expect(implicitRole(document.querySelector('a')!)).toBe('link');
    expect(implicitRole(document.querySelector('input')!)).toBe('checkbox');
    expect(implicitRole(document.querySelector('nav')!)).toBe('navigation');
  });

  it('prefers explicit role and computes accessible name', () => {
    document.body.innerHTML = `<button aria-label="Checkout now" disabled>Checkout</button>`;
    const btn = document.querySelector('button')!;
    const a11y = captureAccessibility(btn);
    expect(a11y.role).toBe('button');
    expect(a11y.name).toBe('Checkout now');
    expect(a11y.disabled).toBe(true);
  });
});
