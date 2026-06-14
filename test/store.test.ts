import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { latestCapturePath } from '@ui/shared/node-paths';
import { setLatest, getLatest } from '../daemon/src/store';
import type { UiContext } from '@ui/shared';

const ctx: UiContext = {
  dom: { html: '<b/>', tag: 'B', attributes: {}, domPath: 'b', rect: { x: 0, y: 0, width: 1, height: 1 }, styles: {} },
  accessibility: { role: 'generic', name: '', description: '', disabled: false, ariaHidden: false },
  component: { available: false },
  source: { available: false },
  meta: { url: 'http://localhost:3000/', capturedAt: '2026-06-14T00:00:00.000Z', layers: ['dom', 'accessibility'], missing: [] },
};

afterEach(() => { const p = latestCapturePath(); if (existsSync(p)) rmSync(p); });

describe('daemon store', () => {
  it('returns the most recently set capture', () => {
    setLatest(ctx);
    expect(getLatest()).toEqual(ctx);
  });
  it('mirrors the latest capture to disk', () => {
    setLatest(ctx);
    expect(existsSync(latestCapturePath())).toBe(true);
  });
});
