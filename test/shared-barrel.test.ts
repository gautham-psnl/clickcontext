import { describe, it, expect } from 'vitest';
import { DAEMON_HOST, DAEMON_PORT, CAPTURE_TOKEN_HEADER } from '@ui/shared';

describe('shared barrel', () => {
  it('exposes daemon constants', () => {
    expect(DAEMON_HOST).toBe('127.0.0.1');
    expect(DAEMON_PORT).toBe(7456);
    expect(CAPTURE_TOKEN_HEADER).toBe('x-clickcontext-token');
  });
});
