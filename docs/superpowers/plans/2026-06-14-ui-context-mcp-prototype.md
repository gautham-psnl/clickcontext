# UI Context MCP — Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the loop *select a live UI element in a localhost app → ask in Claude Code → get a grounded answer* with zero install: a bookmarklet captures layered context, POSTs it to a local daemon, and a stdio MCP server hands it to the IDE.

**Architecture:** Monorepo of four source folders sharing types + a safe serializer via a `@ui/shared` path alias. The **bookmarklet** runs in the page main-world (so React fiber is directly readable), captures 4 layers, and POSTs to the **daemon**. The **daemon** (always-on Node HTTP server) stores the latest capture in memory and mirrors it to `$TMPDIR/ui-context-latest.json`. The **MCP server** (stdio, launched by the IDE) reads that file via one tool, `get_latest_ui_context`. Daemon and MCP are decoupled by the shared file.

**Tech Stack:** TypeScript, Node `http`, `@modelcontextprotocol/sdk`, `dom-accessibility-api`, esbuild (bookmarklet bundle), vitest + jsdom (tests), tsx (run TS entrypoints). Reference spec: `docs/superpowers/specs/2026-06-14-ui-context-mcp-prototype-design.md`.

---

## File Structure

```
ui-context-extension/
  package.json                 # root: deps, scripts, no workspaces (folders + alias)
  tsconfig.json                # paths: @ui/shared, @ui/shared/*
  vitest.config.ts             # jsdom-capable, resolve.alias for @ui/shared
  shared/src/
    types.ts                   # UiContext + layer interfaces
    constants.ts               # DAEMON_HOST/PORT, token header (isomorphic)
    serialize.ts               # safeSerialize() — the crown jewel
    index.ts                   # barrel: types + constants + serialize
    node-paths.ts              # latestCapturePath() (node-only)
    capture-file.ts            # read/writeLatestCapture() (node-only)
    token.mjs                  # ensureToken() (plain JS, shared by build + daemon)
  daemon/src/
    store.ts                   # in-memory latest + file mirror
    server.ts                  # createDaemon(): POST /capture, GET /health
    index.ts                   # entrypoint: ensureToken + listen
  mcp/src/
    tool.ts                    # getLatestUiContextText()
    server.ts                  # buildServer() + stdio main()
  bookmarklet/
    src/
      dom-path.ts              # cssPathTo()
      roles.ts                 # implicitRole()
      layers/dom.ts            # captureDom()
      layers/accessibility.ts  # captureAccessibility()
      layers/component.ts      # captureComponent() (React fiber walk)
      layers/source.ts         # captureSource() (Tier 0)
      capture.ts               # captureUiContext() assemble
      send.ts                  # sendCapture()
      picker.ts                # startPicker() overlay
      toast.ts                 # toast()
      index.ts                 # entry: picker -> capture -> send -> toast
    build.mjs                  # esbuild -> dist/bookmarklet-url.txt + install.html
  test/                        # vitest specs mirror the modules
  README.md
```

---

## Task 0: Monorepo scaffolding + toolchain smoke

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ui-context",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "daemon": "tsx daemon/src/index.ts",
    "mcp": "tsx mcp/src/server.ts",
    "build:bookmarklet": "node bookmarklet/build.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "dom-accessibility-api": "^0.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "esbuild": "^0.23.0",
    "jsdom": "^24.1.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowJs": true,
    "esModuleInterop": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@ui/shared": ["shared/src/index.ts"],
      "@ui/shared/*": ["shared/src/*"]
    }
  },
  "include": ["shared", "daemon", "mcp", "bookmarklet", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ui\/shared$/, replacement: join(root, 'shared/src/index.ts') },
      { find: /^@ui\/shared\/(.*)$/, replacement: join(root, 'shared/src/$1') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the toolchain smoke test** — `test/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs typescript under vitest', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 2)).toBe(4);
  });
});
```

- [ ] **Step 5: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: 1 passing test (`toolchain > runs typescript under vitest`).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts test/smoke.test.ts package-lock.json
git commit -m "chore: monorepo scaffolding + vitest toolchain"
```

---

## Task 1: Shared types + constants

**Files:**
- Create: `shared/src/types.ts`, `shared/src/constants.ts`, `shared/src/index.ts`
- Test: `test/shared-barrel.test.ts`

- [ ] **Step 1: Write the failing test** — `test/shared-barrel.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { DAEMON_HOST, DAEMON_PORT, CAPTURE_TOKEN_HEADER } from '@ui/shared';

describe('shared barrel', () => {
  it('exposes daemon constants', () => {
    expect(DAEMON_HOST).toBe('127.0.0.1');
    expect(DAEMON_PORT).toBe(7456);
    expect(CAPTURE_TOKEN_HEADER).toBe('x-ui-context-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/shared-barrel.test.ts`
Expected: FAIL — cannot resolve `@ui/shared`.

- [ ] **Step 3: Create `shared/src/types.ts`**

```ts
export interface DomLayer {
  html: string;
  tag: string;
  attributes: Record<string, string>;
  domPath: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
}

export interface AccessibilityLayer {
  role: string;
  name: string;
  description: string;
  disabled: boolean;
  ariaHidden: boolean;
}

export interface HookInfo {
  type: string;
  value: unknown;
}

export interface ComponentFrame {
  name: string;
  props: unknown;
  hooks: HookInfo[] | null;
}

export interface ComponentLayer {
  available: boolean;
  framework?: string;
  stack?: ComponentFrame[];
}

export interface SourceLayer {
  available: boolean;
  file?: string;
  line?: number;
  column?: number;
  reason?: string;
}

export interface MissingLayer {
  layer: string;
  reason: string;
}

export interface UiContextMeta {
  url: string;
  capturedAt: string;
  layers: string[];
  missing: MissingLayer[];
}

export interface UiContext {
  dom: DomLayer;
  accessibility: AccessibilityLayer;
  component: ComponentLayer;
  source: SourceLayer;
  meta: UiContextMeta;
}
```

- [ ] **Step 4: Create `shared/src/constants.ts`**

```ts
export const DAEMON_HOST = '127.0.0.1';
export const DAEMON_PORT = 7456;
export const CAPTURE_TOKEN_HEADER = 'x-ui-context-token';
```

- [ ] **Step 5: Create `shared/src/index.ts`**

```ts
export * from './types';
export * from './constants';
export * from './serialize';
```

> Note: `serialize` is created in Task 2. Until then this import is unresolved, which is fine — Task 1's test only touches `constants`. The barrel is completed in order.

- [ ] **Step 6: Temporarily stub `shared/src/serialize.ts` so the barrel resolves**

```ts
export {};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- test/shared-barrel.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared/src/types.ts shared/src/constants.ts shared/src/index.ts shared/src/serialize.ts test/shared-barrel.test.ts
git commit -m "feat(shared): UiContext types + daemon constants"
```

---

## Task 2: Safe serializer (`safeSerialize`)

**Files:**
- Modify: `shared/src/serialize.ts`
- Test: `test/serialize.test.ts`

- [ ] **Step 1: Write the failing tests** — `test/serialize.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeSerialize } from '@ui/shared';

describe('safeSerialize', () => {
  it('passes through plain primitives and objects', () => {
    expect(safeSerialize({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  it('marks functions', () => {
    expect(safeSerialize({ onClick: function handleClick() {} })).toEqual({ onClick: '[Function: handleClick]' });
  });

  it('breaks circular references', () => {
    const o: any = { name: 'root' };
    o.self = o;
    expect(safeSerialize(o)).toEqual({ name: 'root', self: '[Circular]' });
  });

  it('truncates deep nesting at maxDepth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = safeSerialize(deep, { maxDepth: 2 }) as any;
    expect(out.a.b).toBe('[Object …]');
  });

  it('caps array length', () => {
    const out = safeSerialize(Array.from({ length: 5 }, (_, i) => i), { maxItems: 3 }) as any[];
    expect(out.slice(0, 3)).toEqual([0, 1, 2]);
    expect(out[3]).toBe('[…+2 more]');
  });

  it('caps object key count', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 5; i++) big[`k${i}`] = i;
    const out = safeSerialize(big, { maxKeys: 2 }) as any;
    expect(Object.keys(out)).toHaveLength(3); // 2 kept + the "…" marker
    expect(out['…']).toBe('[+3 more keys]');
  });

  it('truncates long strings', () => {
    const out = safeSerialize('x'.repeat(20), { maxStringLength: 5 }) as string;
    expect(out.startsWith('xxxxx')).toBe(true);
    expect(out).toContain('+15 chars');
  });

  it('marks DOM nodes', () => {
    const el = document.createElement('button');
    expect(safeSerialize({ node: el })).toEqual({ node: '[HTMLButtonElement]' });
  });

  it('marks react elements', () => {
    const reactEl = { $$typeof: Symbol.for('react.element'), type: function Foo() {} };
    expect(safeSerialize({ child: reactEl })).toEqual({ child: '[ReactElement: Foo]' });
  });

  it('handles bigint, symbol, undefined', () => {
    expect(safeSerialize({ a: 10n, b: Symbol('s'), c: undefined })).toEqual({
      a: '10n', b: '[Symbol: s]', c: '[undefined]',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/serialize.test.ts`
Expected: FAIL — `safeSerialize is not a function`.

- [ ] **Step 3: Implement `shared/src/serialize.ts`**

```ts
export interface SerializeOptions {
  maxDepth: number;
  maxKeys: number;
  maxItems: number;
  maxStringLength: number;
  maxTotalChars: number;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  maxDepth: 4,
  maxKeys: 50,
  maxItems: 50,
  maxStringLength: 5000,
  maxTotalChars: 256 * 1024,
};

function isDomNode(v: unknown): boolean {
  return typeof Node !== 'undefined' && v instanceof Node;
}

function isReactElement(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { $$typeof?: symbol }).$$typeof === Symbol.for('react.element');
}

export function safeSerialize(value: unknown, opts: Partial<SerializeOptions> = {}): unknown {
  const o = { ...DEFAULT_SERIALIZE_OPTIONS, ...opts };
  const seen = new WeakSet<object>();
  const budget = { used: 0 };

  function walk(v: unknown, depth: number): unknown {
    if (budget.used > o.maxTotalChars) return '[Truncated: budget]';

    if (v === null) return null;
    const t = typeof v;

    if (t === 'string') {
      const s = v as string;
      const out = s.length > o.maxStringLength
        ? `${s.slice(0, o.maxStringLength)}…[+${s.length - o.maxStringLength} chars]`
        : s;
      budget.used += out.length;
      return out;
    }
    if (t === 'number' || t === 'boolean') { budget.used += 8; return v; }
    if (t === 'undefined') return '[undefined]';
    if (t === 'bigint') { budget.used += 16; return `${(v as bigint).toString()}n`; }
    if (t === 'symbol') return `[Symbol: ${String((v as symbol).description ?? '')}]`;
    if (t === 'function') return `[Function: ${(v as { name?: string }).name || 'anonymous'}]`;

    const obj = v as object;

    if (isDomNode(obj)) return `[${(obj as { constructor?: { name?: string } }).constructor?.name ?? 'Node'}]`;
    if (isReactElement(obj)) {
      const type = (obj as { type?: unknown }).type as { name?: string; displayName?: string } | string | undefined;
      const name = typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? 'Component');
      return `[ReactElement: ${name}]`;
    }
    if (obj instanceof Map) return `[Map size=${obj.size}]`;
    if (obj instanceof Set) return `[Set size=${obj.size}]`;
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof RegExp) return obj.toString();

    if (seen.has(obj)) return '[Circular]';
    if (depth >= o.maxDepth) return Array.isArray(obj) ? '[Array …]' : '[Object …]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      const limit = Math.min(obj.length, o.maxItems);
      for (let i = 0; i < limit; i++) {
        out.push(walk(obj[i], depth + 1));
        if (budget.used > o.maxTotalChars) break;
      }
      if (obj.length > o.maxItems) out.push(`[…+${obj.length - o.maxItems} more]`);
      return out;
    }

    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const limit = Math.min(keys.length, o.maxKeys);
    for (let i = 0; i < limit; i++) {
      const k = keys[i];
      budget.used += k.length;
      out[k] = walk((obj as Record<string, unknown>)[k], depth + 1);
      if (budget.used > o.maxTotalChars) break;
    }
    if (keys.length > o.maxKeys) out['…'] = `[+${keys.length - o.maxKeys} more keys]`;
    return out;
  }

  return walk(value, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/serialize.test.ts`
Expected: PASS (10 assertions across the describe block).

- [ ] **Step 5: Commit**

```bash
git add shared/src/serialize.ts test/serialize.test.ts
git commit -m "feat(shared): safe serializer with depth/breadth/size caps"
```

---

## Task 3: Node-only file + token helpers

**Files:**
- Create: `shared/src/node-paths.ts`, `shared/src/capture-file.ts`, `shared/src/token.mjs`
- Test: `test/capture-file.test.ts`, `test/token.test.ts`

- [ ] **Step 1: Write the failing tests** — `test/capture-file.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
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
    writeLatestCapture(fixture, path);
    rmSync(path);
    require('node:fs').writeFileSync(path, '{not json', 'utf8');
    expect(readLatestCapture(path)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing tests** — `test/token.test.ts`

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { ensureToken, tokenPath } from '@ui/shared/token.mjs';

const home = join(tmpdir(), `ui-context-test-home-${process.pid}`);
beforeEach(() => { process.env.UI_CONTEXT_HOME = home; });
afterEach(() => { if (existsSync(home)) rmSync(home, { recursive: true, force: true }); delete process.env.UI_CONTEXT_HOME; });

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/capture-file.test.ts test/token.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `shared/src/node-paths.ts`**

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LATEST_CAPTURE_FILENAME = 'ui-context-latest.json';

export function latestCapturePath(): string {
  return join(tmpdir(), LATEST_CAPTURE_FILENAME);
}
```

- [ ] **Step 5: Create `shared/src/capture-file.ts`**

```ts
import { writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs';
import { latestCapturePath } from './node-paths';
import type { UiContext } from './types';

export function writeLatestCapture(ctx: UiContext, filePath: string = latestCapturePath()): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ctx, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

export function readLatestCapture(filePath: string = latestCapturePath()): UiContext | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as UiContext;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Create `shared/src/token.mjs`** (plain JS — shared by the TS daemon and the build script)

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function configDir() {
  return process.env.UI_CONTEXT_HOME ?? join(homedir(), '.ui-context');
}

export function tokenPath() {
  return join(configDir(), 'token');
}

export function ensureToken() {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = tokenPath();
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const token = randomBytes(24).toString('hex');
  writeFileSync(p, token, { mode: 0o600 });
  return token;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- test/capture-file.test.ts test/token.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 8: Commit**

```bash
git add shared/src/node-paths.ts shared/src/capture-file.ts shared/src/token.mjs test/capture-file.test.ts test/token.test.ts
git commit -m "feat(shared): node-only capture-file + token helpers"
```

---

## Task 4: Daemon store

**Files:**
- Create: `daemon/src/store.ts`
- Test: `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — `test/store.test.ts`

```ts
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
  it('starts empty', () => {
    // getLatest reflects in-memory state; may be set by other tests, so set then clear expectation
    setLatest(ctx);
    expect(getLatest()).toEqual(ctx);
  });
  it('mirrors the latest capture to disk', () => {
    setLatest(ctx);
    expect(existsSync(latestCapturePath())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/store.test.ts`
Expected: FAIL — `../daemon/src/store` not found.

- [ ] **Step 3: Create `daemon/src/store.ts`**

```ts
import { writeLatestCapture } from '@ui/shared/capture-file';
import type { UiContext } from '@ui/shared';

let latest: UiContext | null = null;

export function setLatest(ctx: UiContext): void {
  latest = ctx;
  writeLatestCapture(ctx);
}

export function getLatest(): UiContext | null {
  return latest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/store.ts test/store.test.ts
git commit -m "feat(daemon): in-memory latest capture + disk mirror"
```

---

## Task 5: Daemon HTTP server

**Files:**
- Create: `daemon/src/server.ts`
- Test: `test/server.test.ts`

- [ ] **Step 1: Write the failing test** — `test/server.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import { latestCapturePath } from '@ui/shared/node-paths';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import { createDaemon } from '../daemon/src/server';
import { getLatest } from '../daemon/src/store';
import type { Server } from 'node:http';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/server.test.ts`
Expected: FAIL — `createDaemon` not found.

- [ ] **Step 3: Create `daemon/src/server.ts`**

```ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { CAPTURE_TOKEN_HEADER } from '@ui/shared';
import type { UiContext } from '@ui/shared';
import { setLatest } from './store';

export interface DaemonOptions {
  token: string;
  onCapture?: (ctx: UiContext) => void;
}

const MAX_BODY = 4 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': `content-type, ${CAPTURE_TOKEN_HEADER}`,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: DaemonOptions): Promise<void> {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });

  if (req.method === 'POST' && req.url === '/capture') {
    if (req.headers[CAPTURE_TOKEN_HEADER] !== opts.token) return send(res, 403, { error: 'invalid token' });
    try {
      const ctx = JSON.parse(await readBody(req)) as UiContext;
      setLatest(ctx);
      opts.onCapture?.(ctx);
      return send(res, 200, { ok: true, capturedAt: ctx.meta?.capturedAt });
    } catch {
      return send(res, 400, { error: 'invalid payload' });
    }
  }
  return send(res, 404, { error: 'not found' });
}

export function createDaemon(opts: DaemonOptions): Server {
  return createServer((req, res) => {
    handle(req, res, opts).catch(() => send(res, 500, { error: 'internal' }));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/server.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server.ts test/server.test.ts
git commit -m "feat(daemon): http server with token-gated POST /capture"
```

---

## Task 6: Daemon entrypoint

**Files:**
- Create: `daemon/src/index.ts`

- [ ] **Step 1: Create `daemon/src/index.ts`**

```ts
import { ensureToken } from '@ui/shared/token.mjs';
import { DAEMON_HOST, DAEMON_PORT } from '@ui/shared';
import { createDaemon } from './server';

const token = ensureToken();
const server = createDaemon({
  token,
  onCapture: (ctx) => console.error(`[ui-context] captured ${ctx.meta?.url ?? ''} (${ctx.meta?.layers?.join(', ')})`),
});

server.listen(DAEMON_PORT, DAEMON_HOST, () => {
  console.error(`[ui-context] daemon listening on http://${DAEMON_HOST}:${DAEMON_PORT}`);
});
```

- [ ] **Step 2: Verify the daemon boots**

Run: `npm run daemon` (then Ctrl-C after the line prints)
Expected: prints `[ui-context] daemon listening on http://127.0.0.1:7456`. In a second terminal, `curl http://127.0.0.1:7456/health` returns `{"ok":true}`.

- [ ] **Step 3: Commit**

```bash
git add daemon/src/index.ts
git commit -m "feat(daemon): entrypoint wires token + listen"
```

---

## Task 7: MCP tool function

**Files:**
- Create: `mcp/src/tool.ts`
- Test: `test/mcp-tool.test.ts`

- [ ] **Step 1: Write the failing test** — `test/mcp-tool.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { writeLatestCapture } from '@ui/shared/capture-file';
import { getLatestUiContextText } from '../mcp/src/tool';
import type { UiContext } from '@ui/shared';

const path = join(tmpdir(), 'ui-context-mcp-tool-test.json');
afterEach(() => { if (existsSync(path)) rmSync(path); });

const ctx: UiContext = {
  dom: { html: '<button>Buy</button>', tag: 'BUTTON', attributes: {}, domPath: 'button', rect: { x: 0, y: 0, width: 10, height: 10 }, styles: {} },
  accessibility: { role: 'button', name: 'Buy', description: '', disabled: false, ariaHidden: false },
  component: { available: false },
  source: { available: false },
  meta: { url: 'http://localhost:3000/cart', capturedAt: '2026-06-14T00:00:00.000Z', layers: ['dom', 'accessibility'], missing: [] },
};

describe('getLatestUiContextText', () => {
  it('returns a no_capture status when nothing is captured', () => {
    const out = JSON.parse(getLatestUiContextText(path));
    expect(out.status).toBe('no_capture');
    expect(out.message).toMatch(/bookmarklet/i);
  });
  it('returns the captured context', () => {
    writeLatestCapture(ctx, path);
    const out = JSON.parse(getLatestUiContextText(path));
    expect(out.status).toBe('ok');
    expect(out.context).toEqual(ctx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/mcp-tool.test.ts`
Expected: FAIL — `getLatestUiContextText` not found.

- [ ] **Step 3: Create `mcp/src/tool.ts`**

```ts
import { readLatestCapture } from '@ui/shared/capture-file';

export function getLatestUiContextText(filePath?: string): string {
  const ctx = readLatestCapture(filePath);
  if (!ctx) {
    return JSON.stringify({
      status: 'no_capture',
      message: 'No UI element captured yet. In the browser, click the UI Context bookmarklet, select an element, then ask again.',
    }, null, 2);
  }
  return JSON.stringify({ status: 'ok', context: ctx }, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/mcp-tool.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tool.ts test/mcp-tool.test.ts
git commit -m "feat(mcp): get_latest_ui_context tool function"
```

---

## Task 8: MCP stdio server

**Files:**
- Create: `mcp/src/server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test** — `test/mcp-server.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../mcp/src/server';

describe('mcp server', () => {
  it('builds without connecting a transport', () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/mcp-server.test.ts`
Expected: FAIL — `buildServer` not found.

- [ ] **Step 3: Create `mcp/src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { getLatestUiContextText } from './tool';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'ui-context', version: '0.1.0' });
  server.registerTool(
    'get_latest_ui_context',
    {
      title: 'Get latest UI context',
      description:
        'Returns the most recently captured live UI element context: DOM (html, attributes, computed styles), accessibility (role, name, state), React component stack with props and hook state, and a best-effort source location. Call this when the user asks about a UI element they selected in the browser with the UI Context bookmarklet.',
    },
    async () => ({ content: [{ type: 'text', text: getLatestUiContextText() }] }),
  );
  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/mcp-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the server starts under stdio**

Run: `npm run mcp` (it should sit waiting on stdin; Ctrl-C to exit — no crash, no output to stdout)
Expected: process stays alive with no error.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/server.ts test/mcp-server.test.ts
git commit -m "feat(mcp): stdio server exposing get_latest_ui_context"
```

---

## Task 9: Bookmarklet — DOM path + Layer 1 (DOM)

**Files:**
- Create: `bookmarklet/src/dom-path.ts`, `bookmarklet/src/layers/dom.ts`
- Test: `test/dom-layer.test.ts`

- [ ] **Step 1: Write the failing test** — `test/dom-layer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cssPathTo } from '../bookmarklet/src/dom-path';
import { captureDom } from '../bookmarklet/src/layers/dom';

describe('Layer 1 DOM', () => {
  it('builds a css-ish path', () => {
    document.body.innerHTML = `<main><div class="cart"><button id="buy" class="checkout-btn primary">Buy</button></div></main>`;
    const btn = document.getElementById('buy')!;
    expect(cssPathTo(btn)).toBe('button#buy');
  });

  it('captures tag, attributes, and curated computed styles', () => {
    document.body.innerHTML = `<button disabled class="x" aria-label="Buy">Buy</button>`;
    const btn = document.querySelector('button')!;
    const dom = captureDom(btn);
    expect(dom.tag).toBe('BUTTON');
    expect(dom.attributes.class).toBe('x');
    expect(dom.attributes['aria-label']).toBe('Buy');
    expect(dom.styles).toHaveProperty('display');
    expect(dom.styles).toHaveProperty('opacity');
    expect(typeof dom.html).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/dom-layer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `bookmarklet/src/dom-path.ts`**

```ts
export function cssPathTo(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const cls = (node.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) part += `.${cls.join('.')}`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}
```

- [ ] **Step 4: Create `bookmarklet/src/layers/dom.ts`**

```ts
import type { DomLayer } from '@ui/shared';
import { cssPathTo } from '../dom-path';

const MAX_HTML = 4000;
const STYLE_KEYS = [
  'display', 'opacity', 'pointerEvents', 'visibility', 'position',
  'color', 'backgroundColor', 'cursor',
] as const;

export function captureDom(el: Element): DomLayer {
  const cs = getComputedStyle(el as HTMLElement);
  const styles: Record<string, string> = {};
  for (const k of STYLE_KEYS) styles[k] = cs[k as unknown as number] as unknown as string;

  const attributes: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attributes[a.name] = a.value;

  const r = el.getBoundingClientRect();
  const outer = el.outerHTML;
  const html = outer.length > MAX_HTML ? `${outer.slice(0, MAX_HTML)}…` : outer;

  return {
    html,
    tag: el.tagName,
    attributes,
    domPath: cssPathTo(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    styles,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/dom-layer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bookmarklet/src/dom-path.ts bookmarklet/src/layers/dom.ts test/dom-layer.test.ts
git commit -m "feat(bookmarklet): Layer 1 DOM snapshot"
```

---

## Task 10: Bookmarklet — Layer 2 (Accessibility)

**Files:**
- Create: `bookmarklet/src/roles.ts`, `bookmarklet/src/layers/accessibility.ts`
- Test: `test/accessibility-layer.test.ts`

- [ ] **Step 1: Write the failing test** — `test/accessibility-layer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { implicitRole } from '../bookmarklet/src/roles';
import { captureAccessibility } from '../bookmarklet/src/layers/accessibility';

describe('Layer 2 accessibility', () => {
  it('maps implicit roles', () => {
    document.body.innerHTML = `<a href="/x">link</a><input type="checkbox"><nav></nav>`;
    expect(implicitRole(document.querySelector('a')!)).toBe('link');
    expect(implicitRole(document.querySelector('input')!)).toBe('checkbox');
    expect(implicitRole(document.querySelector('nav')!)).toBe('navigation');
  });

  it('prefers explicit role and computes accessible name', () => {
    document.body.innerHTML = `<button aria-label="Checkout now" disabled>Checkout</button>`;
    const btn = document.querySelector('button')!;
    const a11y = captureAccessibility(btn);
    expect(a11y.role).toBe('button');
    expect(a11y.name).toBe('Checkout now');
    expect(a11y.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/accessibility-layer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `bookmarklet/src/roles.ts`**

```ts
export function implicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
    case 'button': return 'button';
    case 'input': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    case 'select': return 'combobox';
    case 'textarea': return 'textbox';
    case 'img': return 'img';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'header': return 'banner';
    case 'footer': return 'contentinfo';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    default: return tag;
  }
}
```

- [ ] **Step 4: Create `bookmarklet/src/layers/accessibility.ts`**

```ts
import { computeAccessibleName, computeAccessibleDescription } from 'dom-accessibility-api';
import type { AccessibilityLayer } from '@ui/shared';
import { implicitRole } from '../roles';

export function captureAccessibility(el: Element): AccessibilityLayer {
  return {
    role: el.getAttribute('role') || implicitRole(el),
    name: computeAccessibleName(el),
    description: computeAccessibleDescription(el),
    disabled: (el as HTMLElement).matches?.(':disabled') || el.getAttribute('aria-disabled') === 'true',
    ariaHidden: el.getAttribute('aria-hidden') === 'true',
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/accessibility-layer.test.ts`
Expected: PASS.

> If `(el as HTMLElement).matches(':disabled')` throws in jsdom for the `<button disabled>` case, the `?.` guard returns undefined and the `||` falls through to the aria check; the assertion `disabled === true` still holds because jsdom supports `:disabled` on buttons. If a future jsdom drops it, change the disabled check to `el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'`.

- [ ] **Step 6: Commit**

```bash
git add bookmarklet/src/roles.ts bookmarklet/src/layers/accessibility.ts test/accessibility-layer.test.ts
git commit -m "feat(bookmarklet): Layer 2 accessibility (computed name + role map)"
```

---

## Task 11: Bookmarklet — Layer 3 (React fiber)

**Files:**
- Create: `bookmarklet/src/layers/component.ts`
- Test: `test/component-layer.test.ts`

- [ ] **Step 1: Write the failing test** — `test/component-layer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureComponent } from '../bookmarklet/src/layers/component';

// Build a fake fiber chain like React attaches at runtime.
function attachFiber(el: Element): void {
  const appFiber = {
    type: { name: 'App' },
    memoizedProps: {},
    _debugHookTypes: null,
    memoizedState: null,
    return: null,
  };
  const cartFiber = {
    type: { name: 'Cart' },
    memoizedProps: { items: [] },
    _debugHookTypes: ['useState'],
    memoizedState: { memoizedState: false, next: null },
    return: appFiber,
  };
  const internalFiber = {
    type: { name: 'InnerLayoutRouter' }, // should be filtered out
    memoizedProps: {},
    _debugHookTypes: null,
    memoizedState: null,
    return: cartFiber,
  };
  const btnFiber = {
    type: { name: 'CheckoutButton' },
    memoizedProps: { disabled: true, onClick: function handleClick() {} },
    _debugHookTypes: ['useState', 'useState'],
    memoizedState: { memoizedState: 0, next: { memoizedState: 'hi', next: null } },
    return: internalFiber,
  };
  (el as any)['__reactFiber$abc123'] = btnFiber;
}

describe('Layer 3 React fiber', () => {
  it('reports unavailable when no fiber is attached', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    expect(captureComponent(document.querySelector('button')!)).toEqual({ available: false });
  });

  it('walks the fiber chain, filters internals, serializes props + hooks', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    attachFiber(btn);
    const comp = captureComponent(btn);
    expect(comp.available).toBe(true);
    expect(comp.framework).toBe('react');
    const names = comp.stack!.map((f) => f.name);
    expect(names).toEqual(['CheckoutButton', 'Cart', 'App']); // InnerLayoutRouter filtered
    const checkout = comp.stack![0];
    expect(checkout.props).toEqual({ disabled: true, onClick: '[Function: handleClick]' });
    expect(checkout.hooks).toEqual([
      { type: 'useState', value: 0 },
      { type: 'useState', value: 'hi' },
    ]);
    expect(comp.stack![2].hooks).toBeNull(); // App has no _debugHookTypes
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/component-layer.test.ts`
Expected: FAIL — `captureComponent` not found.

- [ ] **Step 3: Create `bookmarklet/src/layers/component.ts`**

```ts
import type { ComponentLayer, ComponentFrame, HookInfo } from '@ui/shared';
import { safeSerialize } from '@ui/shared';

const INTERNAL_NAMES = new Set([
  'InnerLayoutRouter', 'OuterLayoutRouter', 'RenderFromTemplateContext',
  'ErrorBoundary', 'LoadableComponent', 'Suspense', 'Fragment',
  'HotReload', 'Router', 'AppRouter', 'ReactDevOverlay', 'RedirectBoundary',
  'NotFoundBoundary', 'RouterReducerProvider', 'ServerRoot',
]);

const MAX_FRAMES = 20;

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

function componentName(type: unknown): string | null {
  if (!type || typeof type === 'string') return null;
  const t = type as { name?: string; displayName?: string; render?: { name?: string; displayName?: string }; type?: { name?: string; displayName?: string } };
  return t.displayName || t.name
    || t.render?.displayName || t.render?.name
    || t.type?.displayName || t.type?.name
    || null;
}

function readHooks(fiber: { _debugHookTypes?: string[]; memoizedState?: { memoizedState: unknown; next: unknown } | null }): HookInfo[] | null {
  if (!fiber._debugHookTypes) return null;
  const hooks: HookInfo[] = [];
  let node = fiber.memoizedState as { memoizedState: unknown; next: unknown } | null;
  for (const type of fiber._debugHookTypes) {
    if (!node) break;
    hooks.push({ type, value: safeSerialize(node.memoizedState) });
    node = node.next as { memoizedState: unknown; next: unknown } | null;
  }
  return hooks;
}

export function captureComponent(el: Element): ComponentLayer {
  const key = fiberKey(el);
  if (!key) return { available: false };

  const stack: ComponentFrame[] = [];
  let fiber = (el as unknown as Record<string, { type: unknown; memoizedProps: unknown; return: unknown } & Record<string, unknown>>)[key] as
    | ({ type: unknown; memoizedProps: unknown; return: unknown } & Record<string, unknown>)
    | null
    | undefined;

  while (fiber && stack.length < MAX_FRAMES) {
    const name = componentName(fiber.type);
    if (name && !INTERNAL_NAMES.has(name)) {
      stack.push({
        name,
        props: safeSerialize(fiber.memoizedProps),
        hooks: readHooks(fiber as { _debugHookTypes?: string[]; memoizedState?: { memoizedState: unknown; next: unknown } | null }),
      });
    }
    fiber = fiber.return as typeof fiber;
  }

  return { available: true, framework: 'react', stack };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/component-layer.test.ts`
Expected: PASS (props serialized, hooks paired, internals filtered).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/layers/component.ts test/component-layer.test.ts
git commit -m "feat(bookmarklet): Layer 3 React fiber walk with safe-serialized props/hooks"
```

---

## Task 12: Bookmarklet — Layer 4 (Source, Tier 0)

**Files:**
- Create: `bookmarklet/src/layers/source.ts`
- Test: `test/source-layer.test.ts`

- [ ] **Step 1: Write the failing test** — `test/source-layer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureSource } from '../bookmarklet/src/layers/source';

describe('Layer 4 source (Tier 0)', () => {
  it('reports unavailable without a fiber', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    expect(captureSource(document.querySelector('button')!).available).toBe(false);
  });

  it('reads _debugSource when present', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    (btn as any)['__reactFiber$x'] = {
      _debugSource: { fileName: '/src/components/CheckoutButton.tsx', lineNumber: 23, columnNumber: 5 },
      return: null,
    };
    expect(captureSource(btn)).toEqual({
      available: true, file: '/src/components/CheckoutButton.tsx', line: 23, column: 5,
    });
  });

  it('parses a _debugStack frame containing /src/', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    const stack = [
      'Error: react-stack-top-frame',
      '    at CheckoutButton (webpack-internal:///./src/components/CheckoutButton.tsx:42:7)',
      '    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:1:1)',
    ].join('\n');
    (btn as any)['__reactFiber$x'] = {
      _debugStack: { toString: () => stack },
      return: null,
    };
    const src = captureSource(btn);
    expect(src.available).toBe(true);
    expect(src.file).toContain('/src/components/CheckoutButton.tsx');
    expect(src.line).toBe(42);
    expect(src.column).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/source-layer.test.ts`
Expected: FAIL — `captureSource` not found.

- [ ] **Step 3: Create `bookmarklet/src/layers/source.ts`**

```ts
import type { SourceLayer } from '@ui/shared';

// Matches "...(/some/path/src/File.tsx:42:7)" and "...at File (webpack-internal:///./src/File.tsx:42:7)".
const FRAME_RE = /\(?([^()\s]*\/src\/[^()\s]+):(\d+):(\d+)\)?\s*$/;

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
}

export function captureSource(el: Element): SourceLayer {
  const key = fiberKey(el);
  if (!key) return { available: false, reason: 'no React fiber' };

  let fiber = (el as unknown as Record<string, { _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number }; _debugStack?: { toString(): string }; return: unknown } | null | undefined>)[key];

  while (fiber) {
    const ds = fiber._debugSource;
    if (ds?.fileName) {
      return { available: true, file: ds.fileName, line: ds.lineNumber ?? 0, column: ds.columnNumber ?? 0 };
    }
    const stackStr = fiber._debugStack?.toString() ?? '';
    const frame = stackStr.split('\n').find((l) => l.includes('/src/') && !l.includes('node_modules'));
    if (frame) {
      const m = frame.match(FRAME_RE);
      if (m) return { available: true, file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
    }
    fiber = fiber.return as typeof fiber;
  }

  return { available: false, reason: 'no _debugSource or parseable /src/ stack frame (Tier 0; build may strip it)' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/source-layer.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/layers/source.ts test/source-layer.test.ts
git commit -m "feat(bookmarklet): Layer 4 Tier-0 source (debugSource + stack parse)"
```

---

## Task 13: Bookmarklet — assemble `captureUiContext`

**Files:**
- Create: `bookmarklet/src/capture.ts`
- Test: `test/capture.test.ts`

- [ ] **Step 1: Write the failing test** — `test/capture.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { captureUiContext } from '../bookmarklet/src/capture';

describe('captureUiContext', () => {
  it('always includes dom + accessibility and reports missing layers', () => {
    document.body.innerHTML = `<button disabled>Buy</button>`;
    const ctx = captureUiContext(document.querySelector('button')!);
    expect(ctx.meta.layers).toContain('dom');
    expect(ctx.meta.layers).toContain('accessibility');
    expect(ctx.meta.layers).not.toContain('component');
    expect(ctx.component.available).toBe(false);
    expect(ctx.meta.missing.map((m) => m.layer)).toContain('component');
    expect(ctx.meta.missing.map((m) => m.layer)).toContain('source');
    expect(typeof ctx.meta.capturedAt).toBe('string');
    expect(ctx.meta.url).toContain('http');
  });

  it('adds component + source to layers when available', () => {
    document.body.innerHTML = `<button>Buy</button>`;
    const btn = document.querySelector('button')!;
    (btn as any)['__reactFiber$x'] = {
      type: { name: 'CheckoutButton' },
      memoizedProps: { disabled: true },
      _debugHookTypes: null,
      memoizedState: null,
      _debugSource: { fileName: '/src/CheckoutButton.tsx', lineNumber: 10, columnNumber: 2 },
      return: null,
    };
    const ctx = captureUiContext(btn);
    expect(ctx.meta.layers).toContain('component');
    expect(ctx.meta.layers).toContain('source');
    expect(ctx.component.stack?.[0].name).toBe('CheckoutButton');
    expect(ctx.source.file).toBe('/src/CheckoutButton.tsx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/capture.test.ts`
Expected: FAIL — `captureUiContext` not found.

- [ ] **Step 3: Create `bookmarklet/src/capture.ts`**

```ts
import type { UiContext, MissingLayer } from '@ui/shared';
import { captureDom } from './layers/dom';
import { captureAccessibility } from './layers/accessibility';
import { captureComponent } from './layers/component';
import { captureSource } from './layers/source';

export function captureUiContext(el: Element): UiContext {
  const dom = captureDom(el);
  const accessibility = captureAccessibility(el);
  const component = captureComponent(el);
  const source = captureSource(el);

  const layers = ['dom', 'accessibility'];
  const missing: MissingLayer[] = [];

  if (component.available) layers.push('component');
  else missing.push({ layer: 'component', reason: 'no React fiber on element' });

  if (source.available) layers.push('source');
  else missing.push({ layer: 'source', reason: source.reason ?? 'unavailable' });

  return {
    dom,
    accessibility,
    component,
    source,
    meta: { url: location.href, capturedAt: new Date().toISOString(), layers, missing },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/capture.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/capture.ts test/capture.test.ts
git commit -m "feat(bookmarklet): assemble Ui_CONTEXT with explicit layer flags"
```

---

## Task 14: Bookmarklet — sender

**Files:**
- Create: `bookmarklet/src/send.ts`
- Test: `test/send.test.ts`

- [ ] **Step 1: Write the failing test** — `test/send.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/send.test.ts`
Expected: FAIL — `sendCapture` not found.

- [ ] **Step 3: Create `bookmarklet/src/send.ts`**

```ts
import type { UiContext } from '@ui/shared';
import { DAEMON_HOST, DAEMON_PORT, CAPTURE_TOKEN_HEADER } from '@ui/shared';

// Replaced at build time by esbuild `define`. Guarded with typeof for tests.
declare const __UI_CONTEXT_TOKEN__: string;

export interface SendOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function sendCapture(ctx: UiContext, opts: SendOptions = {}): Promise<boolean> {
  const token = opts.token ?? (typeof __UI_CONTEXT_TOKEN__ !== 'undefined' ? __UI_CONTEXT_TOKEN__ : '');
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_TOKEN_HEADER]: token },
      body: JSON.stringify(ctx),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/send.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/send.ts test/send.test.ts
git commit -m "feat(bookmarklet): token-authenticated capture sender"
```

---

## Task 15: Bookmarklet — picker, toast, entry

**Files:**
- Create: `bookmarklet/src/toast.ts`, `bookmarklet/src/picker.ts`, `bookmarklet/src/index.ts`
- Test: `test/picker.test.ts`

- [ ] **Step 1: Write the failing test** — `test/picker.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/picker.test.ts`
Expected: FAIL — `startPicker` not found.

- [ ] **Step 3: Create `bookmarklet/src/toast.ts`**

```ts
export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
    padding: '10px 14px', borderRadius: '8px', font: '13px system-ui, sans-serif',
    color: '#fff', maxWidth: '320px',
    background: kind === 'ok' ? '#16a34a' : '#dc2626',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
```

- [ ] **Step 4: Create `bookmarklet/src/picker.ts`**

```ts
export interface PickerHandle {
  cancel(): void;
}

export function startPicker(onSelect: (el: Element) => void): PickerHandle {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #4f46e5', background: 'rgba(79,70,229,0.12)',
    borderRadius: '2px', transition: 'all 40ms ease', display: 'none', top: '0', left: '0',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  let current: Element | null = null;

  function move(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block', left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    } as Partial<CSSStyleDeclaration>);
  }

  function click(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const el = current ?? document.elementFromPoint(e.clientX, e.clientY);
    cleanup();
    if (el) onSelect(el);
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup(): void {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);

  return { cancel: cleanup };
}
```

- [ ] **Step 5: Create `bookmarklet/src/index.ts`**

```ts
import { startPicker } from './picker';
import { captureUiContext } from './capture';
import { sendCapture } from './send';
import { toast } from './toast';

startPicker(async (el) => {
  const ctx = captureUiContext(el);
  const ok = await sendCapture(ctx);
  toast(
    ok ? `Captured ✓ (${ctx.meta.layers.join(', ')})` : 'UI Context daemon not reachable — is it running?',
    ok ? 'ok' : 'err',
  );
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- test/picker.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 7: Commit**

```bash
git add bookmarklet/src/toast.ts bookmarklet/src/picker.ts bookmarklet/src/index.ts test/picker.test.ts
git commit -m "feat(bookmarklet): picker overlay + toast + entry wiring"
```

---

## Task 16: Bookmarklet build script

**Files:**
- Create: `bookmarklet/build.mjs`

- [ ] **Step 1: Create `bookmarklet/build.mjs`**

```js
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureToken } from '../shared/src/token.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const token = ensureToken();

const result = await build({
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['chrome120'],
  define: { __UI_CONTEXT_TOKEN__: JSON.stringify(token) },
  // Browser bundle only imports the @ui/shared barrel (no node-only subpaths).
  alias: { '@ui/shared': join(root, 'shared/src/index.ts') },
});

const code = result.outputFiles[0].text;
const url = `javascript:${encodeURIComponent(code)}`;

const distDir = join(here, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'bookmarklet.js'), code);
writeFileSync(join(distDir, 'bookmarklet-url.txt'), url);

const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
writeFileSync(join(distDir, 'install.html'), `<!doctype html>
<meta charset="utf-8">
<title>UI Context — install</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}a.bm{display:inline-block;padding:8px 14px;border:1px solid #4f46e5;border-radius:8px;color:#4f46e5;text-decoration:none;font-weight:600}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}</style>
<h1>UI Context</h1>
<p>1. Drag this to your bookmarks bar:</p>
<p><a class="bm" href="${escapedUrl}">📌 UI Context</a></p>
<p>2. Start the daemon: <code>npm run daemon</code></p>
<p>3. On any localhost app, click the bookmarklet, then click a UI element. Ask your IDE about it.</p>`);

console.log(`bookmarklet: ${code.length} bytes of code, ${url.length} chars as URL`);
const LIMIT = 60000;
if (url.length > LIMIT) {
  console.error(`WARNING: bookmarklet URL is ${url.length} chars (> ${LIMIT}). See Risk note: drop dom-accessibility-api from the bundle and use a minimal name read.`);
}
```

- [ ] **Step 2: Build the bookmarklet and check size**

Run: `npm run build:bookmarklet`
Expected: prints the byte/char counts and writes `bookmarklet/dist/{bookmarklet.js,bookmarklet-url.txt,install.html}`.

- [ ] **Step 3: Size-budget decision (Risk §11.1 from spec)**

If the WARNING fired (URL > 60000 chars), apply the fallback now:
1. In `bookmarklet/src/layers/accessibility.ts`, replace the `dom-accessibility-api` import and `name`/`description` with a minimal read:

```ts
import type { AccessibilityLayer } from '@ui/shared';
import { implicitRole } from '../roles';

function minimalName(el: Element): string {
  return (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '').trim().slice(0, 80);
}

export function captureAccessibility(el: Element): AccessibilityLayer {
  return {
    role: el.getAttribute('role') || implicitRole(el),
    name: minimalName(el),
    description: el.getAttribute('aria-description') || '',
    disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    ariaHidden: el.getAttribute('aria-hidden') === 'true',
  };
}
```

2. Update `test/accessibility-layer.test.ts`'s name expectation if needed (`aria-label` path still yields `"Checkout now"`, so the existing assertion holds).
3. Re-run `npm test` and `npm run build:bookmarklet`; confirm green and under budget.

If the WARNING did not fire, skip this step — keep `dom-accessibility-api`.

- [ ] **Step 4: Commit**

```bash
git add bookmarklet/build.mjs bookmarklet/dist/.gitkeep
git commit -m "feat(bookmarklet): esbuild build -> javascript: URL + install page"
```

> Add `bookmarklet/dist/` to `.gitignore` except a `.gitkeep`, since the URL embeds a machine-local token. Append to `.gitignore`: `bookmarklet/dist/*` then `!bookmarklet/dist/.gitkeep`, and `touch bookmarklet/dist/.gitkeep`.

---

## Task 17: End-to-end smoke test (daemon ↔ file ↔ MCP tool)

**Files:**
- Test: `test/e2e-loop.test.ts`

- [ ] **Step 1: Write the test** — `test/e2e-loop.test.ts`

```ts
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

    const toolOut = JSON.parse(getLatestUiContextText());
    expect(toolOut.status).toBe('ok');
    expect(toolOut.context.meta.url).toBe('http://localhost:3000/cart');
    expect(toolOut.context.component.stack[0].name).toBe('CheckoutButton');
    expect(toolOut.context.source.file).toBe('/src/CheckoutButton.tsx');
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: ALL tests pass, including `end-to-end loop > capture POSTed to daemon is readable through the MCP tool`.

- [ ] **Step 3: Commit**

```bash
git add test/e2e-loop.test.ts
git commit -m "test: end-to-end daemon -> file -> mcp tool smoke"
```

---

## Task 18: README + manual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
# UI Context MCP (prototype)

Select a live UI element in a localhost app and ask your AI IDE about it — grounded in the element's real DOM, accessibility data, React component stack, props, and hook state.

This is the **prototype**: a bookmarklet captures context and POSTs it to a local daemon; a stdio MCP server hands the latest capture to your IDE. See `docs/superpowers/specs/` for the full design and roadmap.

## Setup

```bash
npm install
npm run build:bookmarklet   # writes bookmarklet/dist/install.html
```

1. Open `bookmarklet/dist/install.html` and drag the **UI Context** link to your bookmarks bar.
2. Start the daemon (leave it running):
   ```bash
   npm run daemon
   ```
3. Register the MCP server with your IDE. For Claude Code:
   ```bash
   claude mcp add ui-context -- npx -y tsx <abs-path>/mcp/src/server.ts
   ```
   (Any MCP-capable IDE works — point it at the same command.)

## Use

1. On a running localhost app (React dev build for full context), click the **UI Context** bookmarklet.
2. Click the element you care about. You'll see a `Captured ✓` toast listing the layers grabbed.
3. In your IDE, ask: *"Why is this button disabled?"* The model calls `get_latest_ui_context` and reasons over the real data.

## What gets captured

- **DOM** — html, attributes, computed styles, dom path, bounding box (always)
- **Accessibility** — role, computed name, disabled/aria state (always)
- **React component stack** — names, props, hook state (when React is present)
- **Source** — file/line, best-effort (dev builds; Tier 0)

Absent layers are reported in `meta.missing` so the model knows what it doesn't have.
````

- [ ] **Step 2: Manual end-to-end verification (Definition of Done)**

Do this against a real React dev app (e.g. a Vite `react-ts` template running on localhost):
1. `npm run daemon` in one terminal.
2. `claude mcp add ui-context -- npx -y tsx <abs-path>/mcp/src/server.ts` and open Claude Code in this repo.
3. In the browser, click the bookmarklet, then a button in the app → confirm `Captured ✓` toast.
4. In Claude Code, ask "what are the props and state of the element I just selected?" → confirm the answer references real props/hook values from the captured component.

Expected: the model's answer cites actual captured data (not a guess). Note which layers were present (`component`/`source` depend on the app being a React dev build).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: prototype README + setup/use instructions"
```

---

## Self-Review

**1. Spec coverage** — every prototype requirement maps to a task:
- Picker (hover highlight + click, Esc) → Task 15. *(Hotkey `Ctrl+Shift+K` is an extension-phase item per spec §10; the bookmarklet is activated by clicking it, so no hotkey in the prototype — consistent with the bookmarklet decision.)*
- Layer 1 DOM → Task 9. Layer 2 a11y (JS-computed) → Task 10. Layer 3 fiber → Task 11. Layer 4 Tier-0 source → Task 12.
- Safe serializer (spec §4.3, "not optional") → Task 2.
- Merge layers + `meta.layers`/`meta.missing` (spec §5) → Task 13.
- Daemon `POST /capture` + `GET /health` + memory + file mirror (spec §4.4) → Tasks 4–6.
- Security: bind 127.0.0.1, token gate (spec §7) → Tasks 5–6 (token via Task 3). *(Origin allowlisting is N/A for a bookmarklet whose origin is the app's localhost; the token is the gate, as designed.)*
- MCP `get_latest_ui_context` returns context (spec §4.5) → Tasks 7–8.
- stdio + shared file transport (spec §2) → Tasks 3, 7, 8.
- Graceful degradation / absences reported (spec §6) → Tasks 12 (`reason`), 13 (`missing`), 7 (`no_capture`).
- Definition of done (spec §12) → Task 18 Step 2.

**2. Placeholder scan** — no `TBD`/`TODO`/"add error handling"; every code step contains full code. The only conditional work (Task 16 Step 3) is fully specified with the replacement code and is gated on a measurable signal (URL length > 60000).

**3. Type consistency** — `UiContext` and layer interfaces (Task 1) are used unchanged everywhere. `setLatest`/`getLatest` (Task 4), `createDaemon`/`DaemonOptions` (Task 5), `writeLatestCapture`/`readLatestCapture` (Task 3), `getLatestUiContextText` (Task 7), `buildServer` (Task 8), `captureDom`/`captureAccessibility`/`captureComponent`/`captureSource`/`captureUiContext` (Tasks 9–13), `sendCapture` (Task 14), `startPicker`/`PickerHandle`/`toast` (Task 15) — names match across producer and consumer tasks. `CAPTURE_TOKEN_HEADER`/`DAEMON_HOST`/`DAEMON_PORT` consistent. `ensureToken` signature consistent between `token.mjs` (Task 3), daemon (Task 6), and build (Task 16).

Resolved during review: the barrel (`shared/src/index.ts`) imports `./serialize` before Task 2 creates it, so Task 1 adds a one-line stub (Step 6) that Task 2 overwrites — avoids a broken import between tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-ui-context-mcp-prototype.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, with review between tasks; fast iteration and clean context per task.
2. **Inline Execution** — execute tasks in this session via the executing-plans skill, batched with checkpoints for review.

Which approach?
