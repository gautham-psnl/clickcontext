import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { writeLatestCapture, readLatestCapture } from '@ui/shared/capture-file';
import type { UiContext } from '@ui/shared';

const fixture: UiContext = {
  dom: { html: '<button>Buy</button>', tag: 'BUTTON', attributes: {}, domPath: 'button', rect: { x: 0, y: 0, width: 10, height: 10 }, styles: {} },
  accessibility: { role: 'button', name: 'Buy', description: '', disabled: false, ariaHidden: false },
  component: { available: false },
  source: { available: false, reason: 'test' },
  meta: { url: 'http://localhost:3000/', capturedAt: '2026-06-14T00:00:00.000Z', layers: ['dom', 'accessibility'], missing: [] },
};

const path = join(tmpdir(), 'ui-context-test-capture.json');
afterEach(() => { if (existsSync(path)) rmSync(path); });

describe('capture-file', () => {
  it('returns null when no file exists', () => {
    expect(readLatestCapture(path)).toBeNull();
  });
  it('round-trips a capture', () => {
    writeLatestCapture(fixture, path);
    expect(readLatestCapture(path)).toEqual(fixture);
  });
  it('returns null on corrupt json', () => {
    writeFileSync(path, '{not json', 'utf8');
    expect(readLatestCapture(path)).toBeNull();
  });
});
