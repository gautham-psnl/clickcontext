import { describe, it, expect } from 'vitest';
import { sendCapture } from '../bookmarklet/src/send';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import type { UiContext } from '@ui/shared';

const ctx = { meta: { url: 'http://localhost:3000/' } } as unknown as UiContext;

describe('sendCapture', () => {
  it('POSTs with the token header and returns true on ok', async () => {
    let seenHeader = '';
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seenHeader = (init.headers as Record<string, string>)[CAPTURE_TOKEN_HEADER];
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const ok = await sendCapture(ctx, { token: 'abc', fetchImpl: fakeFetch });
    expect(ok).toBe(true);
    expect(seenHeader).toBe('abc');
  });

  it('returns false when the daemon is unreachable', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await sendCapture(ctx, { token: 'abc', fetchImpl: failing })).toBe(false);
  });
});
