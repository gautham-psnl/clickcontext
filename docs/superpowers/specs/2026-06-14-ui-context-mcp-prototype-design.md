# UI Context MCP — Prototype Design

**Date:** 2026-06-14
**Status:** Design — approved in brainstorming, pending written-spec review
**Scope of this doc:** the **prototype** (thin vertical slice), plus the documented roadmap for the full product.

---

## 1. Thesis

Let a developer **select a live UI element in a localhost app and ask an AI about it**, with the AI reasoning over the element's *actual* DOM, accessibility data, and React component/state — not a screenshot or a hand-typed description.

The prototype's single job is to prove that loop end-to-end with the least possible build and **zero install**:

> select element in browser → ask in Claude Code → grounded answer.

If that loop feels good, everything else (extension, multi-IDE, perfect source mapping, plug-and-play packaging) is additive enhancement on the same core.

---

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Product goal | Open-source, installable product | Sets the long-term bar; the prototype is the first rung |
| Accessibility (Layer 2) | **JS-computed** via `dom-accessibility-api` | Faithful W3C accname/role; **no** `chrome.debugger` banner; works with DevTools open |
| Source mapping (Layer 4) | **Progressive tiers** (see §8); prototype runs **Tier 0** only | Tier 0 needs zero project changes |
| Interaction loop | **IDE as cockpit** | Native to MCP's pull model; reuses the IDE's repo context; the model reasons, the tool only *returns* context |
| Long-term transport | Always-on **daemon** exposing **MCP-over-HTTP** | One capture store, every MCP-capable IDE connects via one URL |
| **Prototype** capture vehicle | **Bookmarklet** | Runs in page main-world (fiber accessible directly), zero install, fastest to a working loop |
| **Prototype** transport | **stdio MCP server + shared file** | stdio "just works" in every IDE with no transport config; file is a dead-simple shared store |

The daemon + MCP-over-HTTP + Chrome extension + tray app are the **product**; the prototype deliberately substitutes simpler stand-ins (bookmarklet, shared file) for each, chosen so the core loop is proven before we invest in packaging.

---

## 3. Prototype architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser — localhost app (page main world)                    │
│                                                              │
│   Bookmarklet                                                │
│     • picker overlay (hover highlight + click select, Esc)   │
│     • captureUIContext(el)  → builds UI_CONTEXT (4 layers)   │
│     • safe-serialize props/state                             │
│                          │ POST /capture (127.0.0.1:7456)    │
└──────────────────────────┼──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Daemon (Node, always-on)                                     │
│   • HTTP: POST /capture (origin/token check) , GET /health   │
│   • store latest UI_CONTEXT in memory                        │
│   • mirror to  $TMPDIR/ui-context-latest.json                │
└──────────────────────────┬──────────────────────────────────┘
                           │  reads file
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ MCP server (Node, stdio — launched by the IDE)               │
│   • tool: get_latest_ui_context()  → returns the JSON        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
              Claude Code  (asks, reasons, answers in-session)
```

Two tiny Node processes in the prototype: the **always-on daemon** (receives captures any time) and the **stdio MCP server** (ephemeral, launched per IDE session, reads the shared file). They are decoupled by the shared file, so neither needs to know the other's lifecycle.

---

## 4. Components

### 4.1 Bookmarklet (`bookmarklet/`)
A single self-contained script, minified into a `javascript:` URL the user drags to their bookmarks bar. Because bookmarklets execute in the **page's main world**, `__reactFiber$*` properties are directly readable — no extension/world-bridging needed.

Responsibilities:
- **Picker overlay:** on activation, track `mousemove`, draw a highlight box over the hovered element; `click` selects (and `preventDefault`s the app's own handler); `Esc` cancels. One element at a time.
- **Capture:** run `captureUIContext(selectedEl)`.
- **Send:** `fetch('http://127.0.0.1:7456/capture', { method:'POST', body: JSON.stringify(ctx) })`. On failure (daemon down) show a small inline toast: *"UI Context daemon not reachable — is it running?"*
- **Confirm:** on success show a *"Captured ✓"* toast.

> Bundling note: bookmarklets have length limits and can't easily import npm packages. `dom-accessibility-api` will be **bundled inline** (esbuild → IIFE → URI-encode) rather than imported. If inlining proves too large for the bookmarklet, fall back to a minimal computed-role/name read for the prototype and move full `dom-accessibility-api` to the extension. This is a known prototype risk, tracked in §10.

### 4.2 `captureUIContext(el)` — the four layers

**Layer 1 — DOM (always):**
```
dom: {
  html: el.outerHTML.slice(0, MAX_HTML),   // capped
  tag: el.tagName,
  attributes: { ...from el.attributes },
  domPath: cssPathTo(el),                   // e.g. "main > div.cart > button.checkout-btn"
  rect: el.getBoundingClientRect(),
  styles: {                                 // resolved, not authored
    display, opacity, pointerEvents, visibility, position, ...curated set
  }
}
```

**Layer 2 — Accessibility (always, JS-computed):**
```
accessibility: {
  role: computeRole(el),        // dom-accessibility-api
  name: computeAccessibleName(el),
  description: computeAccessibleDescription(el),
  disabled: el.matches(':disabled') || aria-disabled,
  ariaHidden, ...selected ARIA state
}
```
Honest framing: this is a faithful *implementation* of the W3C accname/role algorithms, not a read of the browser's internal AX tree. Good enough for the product; CDP high-fidelity mode is a documented later option.

**Layer 3 — React fiber (when React present):**
- Find the fiber key: `Object.keys(el).find(k => k.startsWith('__reactFiber$'))`.
- Walk `fiber.return` upward, collecting **user components** (skip host/string types and, by default, framework-internal noise via a denylist so the stack isn't 55 frames deep).
- Per component: `name` (handle `memo`/`forwardRef`/`displayName` fallbacks), **safe-serialized** `memoizedProps`, and hooks paired from `_debugHookTypes` × `memoizedState` linked list.
```
component: {
  available: true, framework: 'react',
  stack: [ { name, props, hooks: [{type, value}] }, ... ]   // user components, trimmed
}
```

**Layer 4 — Source, Tier 0 (best-effort, dev-only):**
- Prefer `fiber._debugSource` ({fileName, lineNumber, columnNumber}) when present (React ≤18 dev).
- Else parse the owner/`_debugStack` trace for the first `/src/`-ish, non-`node_modules` frame.
- Else `{ available: false, reason: '...' }`.
No `.map` resolution in the prototype — that's Tier 1.

### 4.3 Safe serializer (`serialize.ts`) — **not optional**
Raw `JSON.stringify(memoizedProps)` throws on circular refs and silently drops/garbles functions, DOM nodes, and huge objects. The serializer enforces:
- **Depth cap** (e.g. 4) and **breadth cap** (e.g. 50 keys / array items) → `'[…+N more]'`
- **Functions** → `'[Function: name]'`
- **DOM nodes / React elements** → `'[HTMLButtonElement]'` / `'[ReactElement: Foo]'`
- **Circular refs** → `'[Circular]'`
- **Total payload cap** (e.g. 256 KB) → truncate with a marker
This module is pure, deterministic, and the **first thing to unit-test**.

### 4.4 Daemon (`daemon/`)
Always-on Node process (`npx ui-context` for the product; `node daemon.js` for the prototype).
- `POST /capture` — validate `Origin`/token (see §7), store latest UI_CONTEXT in memory, mirror to `$TMPDIR/ui-context-latest.json` (atomic write: temp + rename).
- `GET /health` — liveness for the bookmarklet/IDE.
- Binds **127.0.0.1 only**.

### 4.5 MCP server (`mcp/`)
stdio MCP server, launched by the IDE (`claude mcp add ui-context -- node mcp/server.js`).
- Tool **`get_latest_ui_context()`** — no args. Reads `$TMPDIR/ui-context-latest.json`, returns it. If absent/stale, returns a structured "no capture yet — select an element and press the bookmarklet" message so the model can tell the user what to do.
- (Optional nicety) include capture age so the model can warn if the selection is stale.

---

## 5. Data flow — the `UI_CONTEXT` payload

```jsonc
{
  "dom": { ... },
  "accessibility": { ... },
  "component": { "available": true|false, ... },
  "source": { "available": true|false, ... },
  "meta": {
    "url": "http://localhost:3000/cart",
    "capturedAt": "<ISO ts, stamped by daemon>",
    "layers": ["dom", "accessibility", "component", "source"],  // only the available ones
    "missing": [ { "layer": "source", "reason": "no _debugSource; prod-like build" } ]
  }
}
```

`meta.layers` / `meta.missing` make graceful degradation **explicit** — the model is always told what's present and what's absent and why, so it never silently reasons over a gap.

---

## 6. Error handling & graceful degradation

| Situation | Behavior |
|---|---|
| Daemon not running | Bookmarklet toast: "daemon not reachable". MCP tool returns "no capture / daemon may be down". |
| No capture yet | Tool returns a clear instruction payload, not an error. |
| React absent | `component.available=false`; DOM+a11y still flow. |
| Source unavailable | `source.available=false` + `reason`; recorded in `meta.missing`. |
| Serialization hits caps | Truncation markers inserted; never throws. |
| Stale capture | Tool includes capture age; model can warn. |

Principle: **every layer is independent and optional; the absence of one never breaks the others, and absences are reported, not hidden.**

---

## 7. Security model

A localhost listener can be hit by *any* page's JavaScript, not just our tooling. Mitigations, in from day one:
- **Bind 127.0.0.1** (no LAN exposure).
- **Origin/token check** on `POST /capture`: accept only requests carrying a per-install shared token (the bookmarklet embeds it) and/or an expected `Origin`. Reject others with 403.
- Treat captured HTML/props as **untrusted text** end-to-end (it's just data handed to the model; never executed).

---

## 8. Source-accuracy tiers (roadmap, documented now)

| Tier | Mechanism | Accuracy | Setup | Phase |
|---|---|---|---|---|
| **0** | fiber `_debugSource` / owner-stack parse | fuzzy, dev-only | none | **prototype** |
| **1** | daemon reads `.map` files off disk + reverse-maps (`@jridgewell/trace-mapping`); can return real source lines around the location | good, **bundler-agnostic** | needs project path | later |
| **2** | per-bundler dev-plugin injects exact `data-source-loc` at build time | **perfect** | **assisted** install + dev-server restart | later |

Tier 2 detail: on connection the MCP can **detect the bundler** (read `package.json`/config) and *offer* assisted setup — not silent file-editing — because auto-editing diverse config shapes (TS/JS, ESM/CJS, monorepos) is fragile and requires a dev-server restart. "Differs project to project" = both per-bundler *and* per-config-shape; the assisted installer carries a detection→strategy matrix and always asks consent.

---

## 9. Testing strategy

- **Unit (highest value):** `serialize.ts` against adversarial inputs (circular, fn, DOM node, deep, huge, symbols). Pure + deterministic.
- **Unit:** role/name computation on small DOM fixtures; fiber-walk component-name resolution (`memo`/`forwardRef`/anonymous).
- **Integration:** spin a fixture React dev app → run `captureUIContext` on a known element (headless or a saved fiber fixture) → assert payload shape and layer flags.
- **Loop smoke test:** POST a sample UI_CONTEXT to the daemon → confirm file mirror → call the MCP tool → assert it returns the same payload. This is the "the wiring works" gate.

---

## 10. Out of scope for the prototype (deferred, by phase)

- **Chrome extension** (replaces bookmarklet): persistent hotkey `Ctrl+Shift+K`, picker overlay, **main-world script injection** (`world:"MAIN"`) for fiber, Web Store publishing. *Next phase.*
- **MCP-over-HTTP single-process daemon** (collapses the two prototype processes; enables true multi-IDE via one URL). *Next phase.*
- **Plug-and-play tray app**: auto-start on login, status UI, **auto-detect + auto-register installed IDEs**. *Later.*
- **Tier 1 / Tier 2 source mapping** (incl. assisted bundler-plugin setup). *Later.*
- **Vue 3** (`__vueParentComponent`), **Firefox/Safari** ports, multi-element compare, action execution (click/fill). *Later.*

---

## 11. Risks / open questions

1. **Bookmarklet size vs `dom-accessibility-api`** — inlining may exceed comfortable bookmarklet size. Mitigation: minimal computed read for the prototype, full lib in the extension. (§4.1)
2. **`_debugSource` availability** varies by React version/build — Tier 0 will frequently report `unavailable`. Acceptable for the prototype; Tier 1 is the real fix.
3. **Fiber stack noise** — framework internals bloat the stack; needs a sensible user-component filter/denylist.
4. **stdio MCP + shared file vs HTTP single-process** — **DECIDED: stdio MCP + shared file** for config-free reliability; MCP-over-HTTP single-process is the next-phase consolidation (§10).
5. **Prototype package layout** — **DECIDED: monorepo** with `bookmarklet/`, `daemon/`, `mcp/`, `shared/` workspaces (shared types + the safe serializer live in `shared/`).

---

## 12. Definition of done (prototype)

A developer can: load a local React dev app → click the bookmarklet → select an element → switch to Claude Code → ask *"why is this disabled?"* → get an answer that references the element's real props/state/DOM. No browser extension, no project changes, no manual context copying.
