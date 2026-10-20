# Set up the JumpStart 3D MCP server (instructions for an AI agent)

You are an AI agent. Your job: add the JumpStart 3D MCP server to the tool you are running in (your "client"), then check that it works. Do the steps in order. JumpStart 3D is a CAD app in a browser; the server lets you build 3D parts in it.

## Rules (read first)

1. Ask the user before you edit any file or run any command that changes settings outside the repository (for example `claude plugin install`, `claude mcp add`, `codex mcp add`, `grok mcp add`). Say what it will change.
2. Never delete or overwrite other servers. Read the config file first. Keep every other entry. Add or replace only the `jumpstart-3d` entry. If the file or its `mcp` / `mcpServers` / `mcp_servers:` key does not exist, write the whole-file form from `mcp/README.md` instead of the fragment.
3. Use absolute paths. Below, `REPO` means the absolute path of the jumpstart-3d folder (run `pwd` inside it). Replace `REPO` in every block. On Windows write the path with forward slashes, for example `C:/Users/name/jumpstart-3d/mcp/server.mjs`.
4. If your model cannot see images, call `screenshot` with a `path` (for example `/tmp/view.png`). It saves the picture there and returns text `{path, bytes, width}`.

## Step 1. Get the code

Claude Code users: skip to the Claude Code block in Step 2; no checkout is needed (still do items 1 and 4).

1. Ask the user: "Do you want me to edit the design in a JumpStart 3D tab you have open, or work in an invisible browser?" Remember the answer: TAB or INVISIBLE.
2. Ask the user where their checkout of jumpstart-3d is. If there is none, ask where to put it, then run: `git clone https://github.com/MaxSikorski/jumpstart-3d`
3. Run:

```
cd REPO/mcp
npm ci
```

4. Only if INVISIBLE, run this once (Chromium is the invisible browser):

```
npx playwright@1.62.1 install chromium
```

## Step 2. Add the server to your client

Find your client below and do only that block. `JS3D_MODE` is `auto`: the server uses the user's open tab if they connect it, and an invisible browser if not.

**Claude Code.** Preferred (the plugin; needs no checkout). Ask the user first; run the two commands only after a clear yes, or ask them to run them in a terminal:

```
claude plugin marketplace add MaxSikorski/jumpstart-3d
claude plugin install jumpstart-3d@maxsikorski
```

Then ask the user to type `/reload-plugins`. Manual route (needs the checkout; also ask first): `claude mcp add --scope user jumpstart-3d -- node REPO/mcp/server.mjs`, then a new session.

**Codex (CLI and desktop app).** Edit `~/.codex/config.toml`, add this, then restart Codex (the desktop app has a Restart button):

```toml
[mcp_servers.jumpstart-3d]
command = "node"
args = ["REPO/mcp/server.mjs"]
startup_timeout_sec = 30
tool_timeout_sec = 600
[mcp_servers.jumpstart-3d.env]
JS3D_MODE = "auto"
```

**Hermes Agent.** Edit `~/.hermes/config.yaml`. Under `mcp_servers:` (add that line first if the file has none) add this, then restart `hermes` (if `node` is not found, also put `PATH` in `env`):

```yaml
  jumpstart-3d:
    command: "node"
    args: ["REPO/mcp/server.mjs"]
    env:
      JS3D_MODE: "auto"
    timeout: 600
    connect_timeout: 60
```

**OpenCode.** Edit `opencode.json` in the project, or `~/.config/opencode/opencode.json`. Add this under `mcp` (whole file if there is none: `{ "mcp": { <this entry> } }`), keep other keys, then restart OpenCode. Tools are named `jumpstart-3d_<tool>`.

```json
"jumpstart-3d": { "type": "local", "command": ["node", "REPO/mcp/server.mjs"], "enabled": true, "environment": { "JS3D_MODE": "auto" }, "timeout": 30000 }
```

**Gemini CLI.** Edit `~/.gemini/settings.json`. Add under `mcpServers` (whole file if there is none: `{ "mcpServers": { <this entry> } }`), then start a new session. Check with `/mcp`.

```json
"jumpstart-3d": { "command": "node", "args": ["REPO/mcp/server.mjs"], "env": { "JS3D_MODE": "auto" }, "timeout": 600000 }
```

**Grok Build.** Run `grok mcp add jumpstart-3d -- node REPO/mcp/server.mjs`, or add this to `~/.grok/config.toml`. Start a new session. Check with `grok mcp doctor`.

```toml
[mcp_servers.jumpstart-3d]
command = "node"
args = ["REPO/mcp/server.mjs"]
env = { JS3D_MODE = "auto" }
startup_timeout_sec = 30
```

**Cursor, LM Studio, Cline, Antigravity, and any other client that reads `mcpServers`.** Add this entry inside the `mcpServers` object of the client's file (whole file if there is none: `{ "mcpServers": { <this entry> } }`):

```json
"jumpstart-3d": { "command": "node", "args": ["REPO/mcp/server.mjs"], "env": { "JS3D_MODE": "auto" } }
```

- Cursor: `~/.cursor/mcp.json`. Ask the user to toggle the server in Settings, MCP, or reload the window.
- LM Studio: Program tab, Install, Edit mcp.json (or `~/.lmstudio/mcp.json`). Ask the user to toggle the server in the Program tab.
- Cline: the MCP Servers icon, Configure tab, Configure MCP Servers opens the file (command line: `~/.cline/data/settings/cline_mcp_settings.json`).
- Antigravity: `~/.gemini/config/mcp_config.json`. Ask the user to run `/mcp`.

**Open WebUI.** It cannot run local servers by itself. Tell the user to start this bridge, then add `http://localhost:8000` with that key in Settings, Admin, Integrations, External Tool Servers. You cannot do that UI step.

```
uvx mcpo --port 8000 --api-key CHOOSE_A_KEY -- node REPO/mcp/server.mjs
```

**Cannot work.** ChatGPT on the web (connectors, developer mode) takes remote servers only; the Codex desktop app works, see the Codex block. Tell the user so. Ollama and oMLX only run models. They need an agent from this list (Hermes, OpenCode or Codex) on top; set up that agent.

## Step 3. Check it works

1. After the restart or reload, call the tool `status`. Your client adds a prefix to the name, such as `mcp__jumpstart-3d__status`, `mcp__plugin_jumpstart-3d_jumpstart-3d__status` or `jumpstart-3d_status`. Look for a tool whose name ends in `status`. In Cline, call `use_mcp_tool` with server `jumpstart-3d` and tool `status`.
2. Expected: `{"mode":"auto","page":...}`. `page` may be `none`, `tab` or `headless`; all three are fine. A `wsError` means another program holds port 8822 (another copy of the server). That is fine for the invisible browser, but the tab cannot connect to this server.
3. If INVISIBLE: call `list_bodies`. Expected: `[]`. Then `status` shows `page: "headless"`, the app version and `bodies: 0`.
4. If TAB: call no other tool yet. Any tool except `status` starts the invisible browser, and then a tab that connects is ignored. Give the user the TAB text from Step 4. After they turn the setting on, call `status`. Expected: `page: "tab"`, the app version and the body count.
5. If the tool is missing, restart the client. If it fails to start, run `node REPO/mcp/server.mjs --help` (needs Node 18 or newer, and `npm ci` done).

## Step 4. Tell the user

If INVISIBLE, say: "JumpStart 3D is connected. I work in an invisible browser, and nothing needs to be open."

If TAB, say: "Open JumpStart 3D (https://maxsikorski.github.io/jumpstart-3d/ or the single file), open the theme menu (the half-moon button), and turn on Connect to AI agent. If Chrome asks to allow local network access, allow it. Tell me when it says connected."

If the invisible browser was already used in this session and the user then connects their tab, also say: "You connected your tab after I already used the invisible browser. Restart me (your client) so the next session uses the tab."

All tools and settings: `mcp/README.md`. Scripting: `BRIDGE.md`. How to use the tools: `mcp/skills/jumpstart-3d/SKILL.md`.
