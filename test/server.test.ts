import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { latestCapturePath } from '@ui/shared/node-paths';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import { createDaemon } from '../daemon/src/server';
import { getLatest } from '../daemon/src/store';

const TOKEN = 'test-token';
let server: Server;
let base: string;

const payload = {
  dom: { html: '<button>Buy</button>', tag: 'BUTTON', attributes: {}, domPath: 'button', rect: { x: 0, y: 0, width: 10, height: 10 }, styles: {} },
  accessibility: { role: 'button', name: 'Buy', description: '', disabled: false, ariaHidden: false },
  component: { available: false },
  source: { available: false },
  meta: { url: 'http://localhost:3000/cart', capturedAt: '2026-06-14T00:00:00.000Z', layers: ['dom', 'accessibility'], missing: [] },
};

beforeAll(async () => {
  server = createDaemon({ token: TOKEN });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => { const p = latestCapturePath(); if (existsSync(p)) rmSync(p); });

describe('daemon http server', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /capture with valid token stores the capture (memory + disk)', async () => {
    const res = await fetch(`${base}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(getLatest()).toEqual(payload);
    expect(existsSync(latestCapturePath())).toBe(true);
  });

  it('POST /capture with bad token is rejected', async () => {
    const res = await fetch(`${base}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: 'wrong' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(403);
  });

  it('POST /capture with invalid json returns 400', async () => {
    const res = await fetch(`${base}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: TOKEN },
      body: '{ broken',
    });
    expect(res.status).toBe(400);
  });

  it('unknown route returns 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
