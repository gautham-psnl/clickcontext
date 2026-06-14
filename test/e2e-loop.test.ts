import { describe, it, expect, afterAll, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { latestCapturePath } from '@ui/shared/node-paths';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import { createDaemon } from '../daemon/src/server';
import { getLatestUiContextText } from '../mcp/src/tool';

const TOKEN = 'e2e-token';
let server: Server;

const payload = {
  dom: { html: '<button disabled>Checkout</button>', tag: 'BUTTON', attributes: { disabled: '' }, domPath: 'button.checkout-btn', rect: { x: 0, y: 0, width: 80, height: 32 }, styles: { opacity: '0.5', pointerEvents: 'none' } },
  accessibility: { role: 'button', name: 'Checkout', description: '', disabled: true, ariaHidden: false },
  component: { available: true, framework: 'react', stack: [{ name: 'CheckoutButton', props: { disabled: true }, hooks: null }] },
  source: { available: true, file: '/src/CheckoutButton.tsx', line: 23, column: 5 },
  meta: { url: 'http://localhost:3000/cart', capturedAt: '2026-06-14T12:00:00.000Z', layers: ['dom', 'accessibility', 'component', 'source'], missing: [] },
};

afterEach(() => { const p = latestCapturePath(); if (existsSync(p)) rmSync(p); });
afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe('end-to-end loop', () => {
  it('capture POSTed to daemon is readable through the MCP tool', async () => {
    server = createDaemon({ token: TOKEN });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const res = await fetch(`${base}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const full = JSON.parse(await getLatestUiContextText(undefined, undefined, 'full'));
    expect(full.status).toBe('ok');
    expect(full.context.meta.url).toBe('http://localhost:3000/cart');
    expect(full.context.component.stack[0].name).toBe('CheckoutButton');
    expect(full.context.source.file).toBe('/src/CheckoutButton.tsx');

    // Default (summary) gives the compact view: element + notable a11y state.
    const summary = JSON.parse(await getLatestUiContextText());
    expect(summary.status).toBe('ok');
    expect(summary.element.tag).toBe('button');
    expect(summary.element.state.disabled).toBe(true);
    expect(summary.url).toBe('http://localhost:3000/cart');
    expect(summary.html).toBeUndefined();
  });
});
