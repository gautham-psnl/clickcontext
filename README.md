# UI Context MCP (prototype)

Select a live UI element in a localhost app and ask your AI IDE about it — grounded in the element's real DOM, accessibility data, React component stack, props, and hook state.

This is the **prototype**: a bookmarklet captures context and POSTs it to a local daemon; a stdio MCP server hands the latest capture to your IDE (and resolves the real source lines off disk). See `docs/superpowers/specs/` for the full design and roadmap.

## Install

The Node side ships as a single CLI, `ui-context`, with three subcommands: `daemon`, `mcp`, `bookmarklet`.

**From npm** (once published):
```bash
claude mcp add ui-context -- npx -y ui-context mcp   # register the MCP with your IDE
npx ui-context daemon                                # start the capture daemon (keep running)
npx ui-context bookmarklet                           # print the bookmarklet URL
```

**From source** (this repo, today):
```bash
npm install
npm run build          # → dist/cli.js + dist/bookmarklet.browser.js
npm link               # optional: puts `ui-context` on your PATH
```
Then, using `node dist/cli.js <cmd>` (or `ui-context <cmd>` if you linked):
1. `ui-context bookmarklet` → copy the printed `javascript:` URL into a new bookmark (drag-install via `npm run build:bookmarklet` → `bookmarklet/dist/install.html` also works).
2. `ui-context daemon` → leave it running.
3. Register the MCP with your IDE (run it from the project whose source you want resolved, or set `UI_CONTEXT_PROJECT_ROOT`):
   ```bash
   claude mcp add ui-context -- node "$(pwd)/dist/cli.js" mcp
   ```
   Any MCP-capable IDE works — point it at the same command.

## Use

1. On a running localhost app (a React **dev** build gives the richest context), run the **UI Context** bookmarklet.
2. Click the element you care about. A `Captured ✓` toast lists the layers grabbed (it's also logged to the page console).
3. In your IDE, ask: *"Why is this button disabled?"* The model calls `get_latest_ui_context` (compact) and reasons over the real data; it escalates to `get_latest_ui_context_full` only when it needs props/hooks/styles/HTML.

## What gets captured

- **DOM** — html, attributes, computed styles, dom path, bounding box (always)
- **Accessibility** — role, computed name (W3C accname via `dom-accessibility-api`), disabled/aria state (always)
- **React component stack** — component names, safe-serialized props, hook types + values (when React is present)
- **Source** — `file:line` best-effort (Tier 0), enriched server-side with the real code lines around the target (Tier 1, when the file is found under the project root)

Absent layers are reported in `meta.missing` so the model knows what it does *not* have.

## Architecture

```
bookmarklet (page main-world) --POST /capture--> daemon (127.0.0.1:7456, in-memory + file mirror)
                                                     |
                                          $TMPDIR/ui-context-latest.json
                                                     |
                                          mcp server (stdio, repo-rooted) --get_latest_ui_context--> IDE
```

- **`shared/`** — `UiContext` types, constants, and the safe serializer.
- **`daemon/`** — token-gated HTTP server; stores the latest capture and mirrors it to disk.
- **`mcp/`** — stdio MCP server exposing `get_latest_ui_context`; resolves source lines (`resolve-source.ts`).
- **`bookmarklet/`** — picker overlay + 4 capture layers, bundled by esbuild into a `javascript:` URL.

## Develop

```bash
npm test                  # full suite (48 tests)
npm run daemon            # start the capture daemon
npm run build:bookmarklet # rebuild the bookmarklet after changes
```

## Security

The daemon binds `127.0.0.1` only and gates `POST /capture` with a per-install token (in `~/.ui-context/token`, baked into the bookmarklet at build time). Captured HTML/props are treated as untrusted text — they are data for the model, never executed.

## Status & roadmap

Prototype scope is the capture → daemon → IDE loop with Tier 0 + Tier 1 source. Deferred (see the spec): Chrome extension with a hotkey, MCP-over-HTTP single-process daemon, plug-and-play tray app with IDE auto-registration, `.map` reverse-mapping for minified builds, an assisted per-bundler dev-plugin (Tier 2), and Vue/Firefox/Safari support.
