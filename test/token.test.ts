import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { ensureToken, tokenPath } from '@ui/shared/token.mjs';

const home = join(tmpdir(), `ui-context-test-home-${process.pid}`);
beforeEach(() => { process.env.CLICKCONTEXT_HOME = home; });
afterEach(() => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); delete process.env.CLICKCONTEXT_HOME; });

describe('ensureToken', () => {
  it('creates a token file and returns the token', () => {
    const token = ensureToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(tokenPath(), 'utf8').trim()).toBe(token);
  });
  it('is idempotent', () => {
    expect(ensureToken()).toBe(ensureToken());
  });
});
