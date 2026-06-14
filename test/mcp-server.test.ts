import { describe, it, expect } from 'vitest';
import { buildServer } from '../mcp/src/server';

describe('mcp server', () => {
  it('builds without connecting a transport', () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });
});
