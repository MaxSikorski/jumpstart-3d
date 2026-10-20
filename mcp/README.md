# JumpStart 3D for AI agents (MCP server)

`jumpstart-mcp` lets an AI agent such as Claude Code build and edit designs in JumpStart 3D. It is a small
[MCP](https://modelcontextprotocol.io) server that runs on your computer and turns each agent request into a call on
`window.JS3D` (the scripting bridge, documented in [`../BRIDGE.md`](../BRIDGE.md)). It works in two ways:

- **Your open tab.** The app in your browser connects to the server, and the agent edits the design you are looking at.
  You turn this on yourself: theme menu (the half-moon button) › **Connect to AI agent**. It is off unless you turn it on.
- **Headless.** The server starts its own invisible Chromium on the built site and works there. Nothing needs to be open.
  Good for "make me a bracket and save the STL".

By default (`JS3D_MODE=auto`) it uses your tab when one is connected, and starts the headless browser on the first tool
call that needs a page when none is. The `status` tool tells you which one you are talking to.

## Install

From a checkout of this repository, once:

```
npm ci
npx playwright install chromium      # only needed for headless mode
```

Add the server to Claude Code's `.mcp.json` (project folder) or with `claude mcp add`:

```json
{ "mcpServers": { "jumpstart-3d": { "command": "node", "args": ["<repo>/mcp/server.mjs"] } } }
```

Replace `<repo>` with the path of your checkout. For other agents that speak MCP over stdio, the command is the same.
`node <repo>/mcp/server.mjs --help` lists the settings. The server needs Node 18 or newer (the repository's tests use 22).

To use your open tab: open JumpStart 3D (the website or the single file), open the theme menu (◐) and turn on
**Connect to AI agent**. The row reads "waiting" until the server is found, then "connected". On the website your browser may ask to allow "local network access": allow it. The setting is remembered in
that browser, so the tab reconnects by itself when you reload it or restart the agent. Turn it off the same way.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `JS3D_MODE` | `auto` | `auto`, `tab` (only the open tab; headless is never started) or `headless` (never listens for a tab) |
| `JS3D_WS_PORT` | `8822` | The port the tab connects to, on 127.0.0.1. `0` picks a free one. The menu row uses 8822; for another port run `JS3D.connect("ws://127.0.0.1:PORT")` in the browser console |
| `JS3D_APP` | the repo's `docs/` | What headless mode opens: a web address, a `.html` file (such as `dist/jumpstart-3d.html`) or a folder with the built site. If `docs/` is not there it uses https://maxsikorski.github.io/jumpstart-3d/ |
| `JS3D_VIEWPORT` | `1000x700` | Headless window size. Screenshots follow it |

## Tools

Lengths are mm, angles degrees, positions `[x, y, z]` with z up. Ids come from `list_bodies`. A failed call comes back as a
tool error carrying the app's own message, so the agent can correct itself.

| Tool | What it does |
|---|---|
| `status` | How the server reaches the app (tab or headless), app version, design name and mode, body count. Never starts a browser |
| `wait_ready` | Waits until every shape is built. Call it after edits, before reading sizes |
| `list_kinds` | The 20 shape kinds and their default sizes |
| `list_bodies`, `get_body` | Read bodies: place, box, volume, errors; one in full |
| `add_shape`, `remove_bodies`, `duplicate_bodies` | Make, delete, copy shapes |
| `move_bodies`, `move_to`, `rotate_bodies`, `resize_shape`, `scale_bodies` | Place and size them |
| `set_hole`, `set_color`, `rename_body`, `set_hidden` | Change a body's properties |
| `group_bodies`, `ungroup_body` | Join, cut (a hole is subtracted) or intersect bodies |
| `list_params`, `set_param`, `remove_param`, `bind_size` | Named parameters and sizes that follow them |
| `undo`, `redo`, `select_bodies`, `fit_view`, `set_mode` | History, selection, view, Beginner or Advanced |
| `screenshot` | A PNG of the 3D view as an image (`width` default 800, `fit` default true) |
| `export_file` | Writes STL, OBJ, 3MF, STEP or the project `json` to a path and returns path and size |
| `save_project`, `load_project` | The design as project-file JSON (text, or a file); open one from text or a file |
| `new_design` | Start an empty design |
| `run_script` | Run JavaScript in the page with `JS3D` and `app` in scope; returns the value as JSON |

Typical loop: `add_shape` (a block), `add_shape` with `hole: true` (a cylinder), `group_bodies` to cut it, `wait_ready`,
`screenshot` to look, `export_file` at the end.

## What an agent can and cannot do

It can do what the calls above can: Beginner shapes (20 kinds), groups, scale, parameters, undo, look at the view, and read and
write files you name in `export_file`, `save_project` and `load_project`. Sketches, extrudes, fillets and the other Advanced
features have no tool of their own; `run_script` reaches anything in the page, and `load_project` opens a project file written
by hand (format in BRIDGE.md Part 2).

## Security

- The server listens on **127.0.0.1 only**, so only programs on your computer can reach it, and it never connects out by itself.
- It looks at the browser's `Origin` header and lets in only the official site (https://maxsikorski.github.io),
  `http://127.0.0.1`, `http://localhost` and `null`. Browsers send `null` for a page opened from disk, and the single-file build
  (`dist/jumpstart-3d.html`) is exactly that, so it has to be accepted. The catch: `null` is also what a sandboxed frame or a
  `data:` page on any website sends. So the check keeps ordinary web pages from other sites out, but **while no tab is
  connected, any local file or sandboxed frame in your browser could connect and act as the tab**. It is not a password.
  A program that is not a browser sends no `Origin` and is let in too (it is on your computer anyway).
- There is **no password or token**. Any program running as you on this computer can talk to the port, and anything that can
  talk to it can run script text in your tab (`run_script`) and write files where the server can (`export_file`). What you can
  do: keep **Connect to AI agent** off whenever you are not using an agent, and turn it on only for a page you trust.
- One tab at a time, and the first one keeps it: a tab that is connected is never replaced. A second tab that tries is told no,
  shows "Another tab already has the AI agent link" and stops retrying (its setting stays on, so a reload connects once
  the first tab has closed).
- A session sticks to the page its first call used. If that was your tab and the tab drops, calls wait 5 seconds for it to come
  back, then fail; they never start a headless browser instead. If it was headless, a tab that connects later is ignored
  (`status` says so); restart the server to use the tab.
- In headless mode the browser is a private, temporary profile. It does not see your tabs, designs or settings.

## Troubleshooting

- **"No JumpStart 3D tab is connected"**: open the app, theme menu › Connect to AI agent. If the row says "waiting", the server is not running or is on another port (`status` shows `wsPort`).
- **The website cannot connect but the single file can**: recent Chrome and Edge ask before a public website may reach a program on your computer ("local network access"). Allow it when asked; if you dismissed the question, open the lock icon in the address bar and allow "Local network access" for the site, then reload. The console shows `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` until you do.
- **`wsError` in `status`**: the port was taken (another copy of the server?). The server keeps running with headless only. Set `JS3D_WS_PORT`.
- **Headless fails to start**: run `npx playwright install chromium`. The first start takes several seconds (the geometry engine loads).
- **A page with the console open shows "WebSocket connection ... failed"** while the setting is on and no server runs: the tab retries every 3 seconds. Turn the setting off.
- Logs go to the agent's MCP log (stderr). stdout is the protocol.

## Tests

`npm run test:mcp` at the repository root (it builds `docs/` first). It starts the real server over stdio and drives it with the
MCP SDK's client, headless and with a Playwright page as the tab. The page-side half (the link, the menu row, `JS3D.run`,
screenshot width) is `test/agent.spec.mjs`, run by `npm test`.
