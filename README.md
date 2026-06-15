# clickcontext

Click a UI element in your localhost app — ask your AI IDE why it looks the way it does.

Captures the real DOM, accessibility tree, React component stack (props + hook state), and source file:line of whatever you click. Sends it to a local MCP server your IDE reads automatically.

```bash
npx clickcontext init      # patch your app's dev config (Next.js / Vite)
npx clickcontext daemon    # start the capture daemon (keep running)
```
Then open **http://127.0.0.1:7456/install** → drag the bookmarklet to your bookmarks bar → click any element → ask your IDE.

---

## Install

**1. Register the MCP with your IDE** (once per machine):

**Claude Code:**
```bash
claude mcp add --scope user clickcontext -- npx -y clickcontext@latest mcp
```
> `--scope user` makes it available in every project, not just the current directory.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "clickcontext": {
      "command": "npx",
      "args": ["-y", "clickcontext@latest", "mcp"]
    }
  }
}
```
Restart Claude Desktop after saving.

> Currently tested with Claude Code and Claude Desktop. Other MCP-capable IDEs may work but are untested.

**2. Patch your app** (once per project — adds a dev-only source loader):

```bash
cd your-app
npx clickcontext init
```

Detects Next.js and Vite. Installs the right loader and patches your config. Restart your dev server after.

> Skip this step if you just want to try it — you'll still get DOM, accessibility, and React component data. Source resolution just won't have exact file:line.

**3. Start the daemon** (every session):

```bash
npx clickcontext daemon
```

> The daemon is global — one instance handles captures from all your localhost projects. Switch between tabs in different projects and your IDE always gets context from whichever element you last clicked.

**4. Install the bookmarklet** (once):

Open **http://127.0.0.1:7456/install** in your browser and drag the button to your bookmarks bar.

---

## Use

1. Open your localhost app in the browser.
2. Click the **clickcontext** bookmark. A picker activates — hover to see component names.
3. Click the element you want to inspect. A `Captured ✓` toast confirms it.
4. In your IDE, ask anything: *"Why is this button disabled?"*, *"What component renders this?"*, *"Where is this defined?"*

The IDE calls `get_latest_ui_context` automatically and reasons over the real data.

---

## What gets captured

| Layer | Contents |
|---|---|
| **DOM** | HTML, attributes, computed styles, bounding box |
| **Accessibility** | ARIA role, computed name (W3C), disabled state |
| **React** | Component stack, props, hook types + values |
| **Source** | File path, line number, surrounding code lines |

React layers require a React dev build. Source layer is richest when `clickcontext init` has been run.

---

## Requirements

- Node.js 18+
- A React app running in dev mode (Next.js, Vite, CRA, etc.)
- An MCP-capable IDE (Claude Code, Cursor, Zed, etc.)

---

## Architecture

```
browser bookmarklet  →  POST /capture  →  daemon (127.0.0.1:7456)
                                               ↓
                                    $TMPDIR/clickcontext-latest.json
                                               ↓
                              MCP server (stdio)  →  IDE
```

The daemon and MCP server are both started by the `clickcontext` CLI. The bookmarklet runs entirely in your browser's main world (no extension required) and communicates with the daemon over localhost using a per-install token stored in `~/.clickcontext/token`.

---

## Security

The daemon binds to `127.0.0.1` only and requires the per-install token on every capture request. The token is injected into the bookmarklet at runtime by the CLI — it never leaves your machine. Captured HTML and props are treated as plain text data, never executed.

---

## Contributing

```bash
git clone https://github.com/gautham-psnl/clickcontext.git
cd clickcontext
npm install
npm run build   # → dist/cli.js + dist/bookmarklet.browser.js
npm test        # 97 tests

# Throw a battery of real-world next.config shapes at the config patcher
# and verify each patched output is still valid JS:
node --import tsx/esm test/probe-configs.mjs
```

Issues and PRs welcome at [github.com/gautham-psnl/clickcontext](https://github.com/gautham-psnl/clickcontext).
