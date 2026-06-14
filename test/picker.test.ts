// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { startPicker } from '../bookmarklet/src/picker';

describe('startPicker', () => {
  it('mounts an overlay and removes it on cancel', () => {
    const before = document.body.childElementCount;
    const handle = startPicker(() => {});
    expect(document.body.childElementCount).toBe(before + 1);
    handle.cancel();
    expect(document.body.childElementCount).toBe(before);
  });

  it('cancels on Escape', () => {
    const before = document.body.childElementCount;
    startPicker(() => {});
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.childElementCount).toBe(before);
  });
});
