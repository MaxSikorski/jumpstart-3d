# JumpStart 3D for AI agents (MCP server)

`jumpstart-mcp` lets an AI agent such as Claude Code build and edit designs in JumpStart 3D. It is a small
[MCP](https://modelcontextprotocol.io) server that runs on your computer and turns each agent request into a call on
`window.JS3D` (the scripting bridge, documented in [`../BRIDGE.md`](../BRIDGE.md)). It works in two ways:

- **Your open tab.** The app in your browser connects to the server, and the agent edits the design you are looking at.
  You turn this on yourself: theme menu (the half-moon button) › **Connect to AI agent**. It is off unless you turn it on.
- **Headless.** The server starts its own invisible Chromium on the built site and works there. Nothing needs to be open.
  Good for "make me a bracket and save the STL".

Prefer to stay in the browser? The app also has a chat panel (the **AI** button) that offers a model the same tools; see "Chat inside the app" in the [main README](../README.md). This server is for agents that run outside the browser.

By default (`JS3D_MODE=auto`) it uses your tab when one is connected, and starts the headless browser on the first tool
call that needs a page when none is. The `status` tool tells you which one you are talking to.

## Install

### Let your agent do it

Paste this line to any AI agent that can read a web page and run commands (Claude Code, Codex, Hermes, OpenCode, Gemini CLI...):

```
Read https://raw.githubusercontent.com/MaxSikorski/jumpstart-3d/main/mcp/AGENT-SETUP.md and set it up for me.
```

[`AGENT-SETUP.md`](AGENT-SETUP.md) tells the agent how to get the code, add the server to its own configuration (asking you before it edits files outside the repository) and check that it works. The rest of this section is the same thing done by hand.

### Claude Code: two commands

```
claude plugin marketplace add MaxSikorski/jumpstart-3d
claude plugin install jumpstart-3d@maxsikorski
```

(Inside a session: `/plugin marketplace add MaxSikorski/jumpstart-3d`, then `/plugin install jumpstart-3d@maxsikorski`, then `/reload-plugins`.)

That installs the server and a skill that teaches the agent how to use it. Claude Code installs the server's packages itself.
The plugin lives in this `mcp/` folder, with no built site next to it, so **headless mode opens the public site**
(https://maxsikorski.github.io/jumpstart-3d/) and needs internet. Headless also needs Chromium, once:

```
npx playwright@1.62.1 install chromium
```

Using your open tab needs no Chromium and no internet beyond the page itself (see below).

If you pre-approve tools in your Claude Code settings, the plugin's tool names are `mcp__plugin_jumpstart-3d_jumpstart-3d__<tool>`
(for example `mcp__plugin_jumpstart-3d_jumpstart-3d__status`), or `mcp__plugin_jumpstart-3d_jumpstart-3d__*` for all of them.
Update with `claude plugin marketplace update maxsikorski` then `claude plugin update jumpstart-3d@maxsikorski`;
remove with `claude plugin uninstall jumpstart-3d@maxsikorski`.
Updates follow the repository, but the plugin's `version` (in `mcp/.claude-plugin/plugin.json`) keeps an installed copy where it is until that number changes: every change under `mcp/` needs a bump in both `mcp/.claude-plugin/plugin.json` and `mcp/package.json`.

### From a checkout, or for other agents

Inside `mcp/` of a checkout of this repository, once:

```
cd mcp
npm ci
npx playwright@1.62.1 install chromium      # only needed for headless mode
```

Add the server to Claude Code's `.mcp.json` (project folder) or with `claude mcp add --scope user jumpstart-3d -- node <repo>/mcp/server.mjs` (the same entry as below, for every folder):

```json
{ "mcpServers": { "jumpstart-3d": { "command": "node", "args": ["<repo>/mcp/server.mjs"] } } }
```

Replace `<repo>` with the path of your checkout. Any agent that speaks MCP over stdio uses the same command. From a checkout,
headless mode opens the checkout's own `docs/` folder when it is there. Tools added this way are called `mcp__jumpstart-3d__<tool>`.
`node <repo>/mcp/server.mjs --help` lists the settings. The server needs Node 18 or newer (the repository's tests use 22).

To use your open tab: open JumpStart 3D (the website or the single file), open the theme menu (◐) and turn on
**Connect to AI agent**. The row reads "waiting" until the server is found, then "connected". On the website your browser may ask to allow "local network access": allow it. The setting is remembered in
that browser, so the tab reconnects by itself when you reload it or restart the agent. Turn it off the same way.

### Other agents

Any client that starts a stdio MCP server can use it. Replace `<repo>` with the path of your checkout (`npm ci` inside `mcp/` once). Windows: write the path with forward slashes, for example `C:/Users/name/jumpstart-3d/mcp/server.mjs` (works in JSON, TOML and YAML). Merge the entry into the file; keep the other servers. `JS3D_MODE` is shown as `auto` (your tab if connected, else headless); see Settings below.

| Client | How to add | Does a screenshot reach the model? |
|---|---|---|
| Claude Code | the plugin above, or `claude mcp add --scope user jumpstart-3d -- node <repo>/mcp/server.mjs` | yes |
| Codex (CLI and desktop app) | `~/.codex/config.toml`, or `codex mcp add jumpstart-3d -- node <repo>/mcp/server.mjs`, then add `tool_timeout_sec = 600` under that server in `~/.codex/config.toml` (or use the TOML block below instead) | not confirmed in its docs; use `path` if it does not |
| Hermes Agent | `~/.hermes/config.yaml` | yes with a vision model; a text-only model gets the file path |
| OpenCode | `opencode.json` | not documented; use `path` |
| Gemini CLI | `~/.gemini/settings.json`, or `gemini mcp add jumpstart-3d node <repo>/mcp/server.mjs` | yes |
| Antigravity | `~/.gemini/config/mcp_config.json` | not documented; use `path` |
| Cursor | `~/.cursor/mcp.json` | yes |
| Cline | `cline_mcp_settings.json` (MCP Servers icon, Configure) | not reliably (a known bug); use `path` |
| LM Studio | `~/.lmstudio/mcp.json` (Program tab, Install, Edit mcp.json) | no (a known bug); use `path` |
| Grok Build | `~/.grok/config.toml`, or `grok mcp add jumpstart-3d -- node <repo>/mcp/server.mjs` | not documented; use `path` |
| Open WebUI | through the `mcpo` bridge (`uvx mcpo --port 8000 --api-key KEY -- node <repo>/mcp/server.mjs`), then Settings › Admin › Integrations › External Tool Servers | not documented; use `path` |
| ChatGPT on the web (connectors, developer mode) | cannot: remote servers only. The Codex desktop app works, see the Codex row | |

Ollama and oMLX only run models; put one of the agents above on top. Use a model with tool calling and at least 9B parameters: 35 tools is a lot for a small one.

Cursor, LM Studio, Cline, Antigravity and most others read the `mcpServers` shape (Claude Code's `.mcp.json` too):

```json
{ "mcpServers": { "jumpstart-3d": { "command": "node", "args": ["<repo>/mcp/server.mjs"], "env": { "JS3D_MODE": "auto" } } } }
```

The others have their own shapes. Codex (`tool_timeout_sec` is raised because exports and pictures can take longer than its 60 second default):

```toml
[mcp_servers.jumpstart-3d]
command = "node"
args = ["<repo>/mcp/server.mjs"]
startup_timeout_sec = 30
tool_timeout_sec = 600
[mcp_servers.jumpstart-3d.env]
JS3D_MODE = "auto"
```

Grok Build (`~/.grok/config.toml`; it also reads `~/.claude.json` and `.mcp.json` entries):

```toml
[mcp_servers.jumpstart-3d]
command = "node"
args = ["<repo>/mcp/server.mjs"]
env = { JS3D_MODE = "auto" }
startup_timeout_sec = 30
```

Hermes (`mcp_servers:` in `~/.hermes/config.yaml`; Hermes passes only the `env` you list, so add `PATH` if `node` is not found):

```yaml
mcp_servers:
  jumpstart-3d:
    command: "node"
    args: ["<repo>/mcp/server.mjs"]
    env:
      JS3D_MODE: "auto"
    timeout: 600
    connect_timeout: 60
```

OpenCode (`mcp` in `opencode.json`; tools are named `jumpstart-3d_<tool>`; `timeout` is for fetching the tool list):

```json
{ "$schema": "https://opencode.ai/config.json", "mcp": { "jumpstart-3d": { "type": "local", "command": ["node", "<repo>/mcp/server.mjs"], "enabled": true, "environment": { "JS3D_MODE": "auto" }, "timeout": 30000 } } }
```

Gemini CLI (`mcpServers` in `~/.gemini/settings.json`; `timeout` is in milliseconds):

```json
{ "mcpServers": { "jumpstart-3d": { "command": "node", "args": ["<repo>/mcp/server.mjs"], "env": { "JS3D_MODE": "auto" }, "timeout": 600000 } } }
```

The tool names carry a prefix your client adds (`mcp__jumpstart-3d__status`, `jumpstart-3d_status`...). Where a client can load skills, point it at [`mcp/skills/jumpstart-3d/SKILL.md`](skills/jumpstart-3d/SKILL.md) (also copied to `skills/jumpstart-3d/SKILL.md` at the repository root, so `npx skills add MaxSikorski/jumpstart-3d` finds it); otherwise paste its body into the agent's instructions file (`AGENTS.md`, `GEMINI.md`...). The client rows above come from each product's documentation as of October 2026; the Codex, OpenCode, Grok and Antigravity picture behaviour is untested here.

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
| `add_fastener` | A hex bolt, hex nut, threaded rod or tap cutter (a threaded hole shape: group it with a solid to cut a threaded hole), metric M2.5 to M12 or inch #6 to 1/2, with a print offset. Takes a few seconds to build: call `wait_ready` |
| `move_bodies`, `move_to`, `rotate_bodies`, `resize_shape`, `scale_bodies` | Place and size them |
| `set_hole`, `set_color`, `rename_body`, `set_hidden` | Change a body's properties |
| `group_bodies`, `ungroup_body` | Join, cut (a hole is subtracted) or intersect bodies |
| `list_params`, `set_param`, `remove_param`, `bind_size` | Named parameters and sizes that follow them |
| `undo`, `redo`, `select_bodies`, `fit_view`, `set_mode` | History, selection, view, Beginner or Advanced |
| `screenshot` | A PNG of the 3D view as an image (`width` default 800, `fit` default true). With `path`, for a model that cannot see images, it writes the PNG there and returns `{path, bytes, width}` as text instead |
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

## Command line

`mcp/cli.mjs` (installed as `jumpstart` when the package is linked; from a checkout, `node mcp/cli.mjs`) runs a script or makes a file
without an agent. It starts its own headless browser (so it needs Chromium, see above) and never touches your tab or a running
server. It prints a JSON result on stdout; progress and errors go to stderr. Exit codes: 0 done, 1 the script or the app failed, 2 bad usage.

```
jumpstart run <script.js> [--app <url|file|dir>]         run a script with JS3D in scope; prints what it returns
jumpstart export <project.json> <out.stl|obj|3mf|step>   open a project, write the export, print the path and size
jumpstart shot <project.json> <out.png> [--width N]      a picture of the 3D view (800 pixels wide by default)
jumpstart status [--app <url|file|dir>]                  start the app and print app version, JS3D version, design, body count
```

`--app` is the same as `JS3D_APP` above. For example `node mcp/cli.mjs run tools/bridge-demo.js` runs the scripting demo and prints its summary.

## Security

- The server listens on **127.0.0.1 only**, so only programs on your computer can reach it, and it connects out only when headless mode has no local `docs/` and opens the public site.
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
- **Headless fails to start**: run `npx playwright@1.62.1 install chromium`. The first start takes several seconds (the geometry engine loads).
- **A page with the console open shows "WebSocket connection ... failed"** while the setting is on and no server runs: the tab retries every 3 seconds. Turn the setting off.
- Logs go to the agent's MCP log (stderr). stdout is the protocol.

## Tests

`npm run test:mcp` at the repository root (run `npm ci` inside `mcp/` first; it builds `docs/`, then runs every file in `mcp/test/`).
`server` (which also checks that no tool's input schema has a `$ref` or a tuple, and the `screenshot` `path` option) and `tab` start the real server over stdio and drive it with the MCP SDK's client, headless and with a Playwright page as the tab.
`cli` runs the command line. `plugin` checks that the plugin files agree with each other, that the skill at the repository root (`skills/jumpstart-3d/SKILL.md`) is byte-identical to `mcp/skills/jumpstart-3d/SKILL.md`, and that the one-line setup prompt is the same everywhere it appears. `install` copies this folder to a scratch place,
runs `npm ci --ignore-scripts` there as Claude Code does, and starts the copy's server (it needs the npm registry or a warm npm cache).
The page-side half (the link, the menu row, `JS3D.run`, screenshot width) is `test/agent.spec.mjs`, run by `npm test`.
