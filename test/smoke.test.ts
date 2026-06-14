import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs typescript under vitest', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 2)).toBe(4);
  });
});
