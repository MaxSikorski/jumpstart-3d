# JumpStart 3D

[![JumpStart 3D: 3D CAD in your browser](docs/og-image.png)](https://maxsikorski.github.io/jumpstart-3d/)

A free 3D CAD tool that runs in your web browser. No install, no account,
no server. Somewhere between Tinkercad and a real CAD program: drag shapes
together in Beginner mode, or sketch, extrude, fillet and shell in Advanced
mode.

Created by **J.Siwek**, who publishes it under the MIT License. Find him at
the [official site](https://sites.google.com/view/jumpstart-3d-creator/home)
(his own downloads), his [source repository on GitHub](https://github.com/classyapps2026/jumpstart3d)
and his [video introducing 2.0](https://youtu.be/OmoVmYzoIsk).

This repository is the community fork, maintained by **Max Sikorski** with the
jumpstart-3d community: it put the app back online when the original
download disappeared, tracks his releases, and adds its own work (a
reproducible build, a test suite, named parameters, Mesh detail, OBJ export
and more, listed [below](#what-this-repository-adds-on-top-of-the-original)).
See [NOTICE.md](NOTICE.md) for credit and licensing.

## I just want to use it

Pick one:

- **Online:** open https://maxsikorski.github.io/jumpstart-3d/
- **Offline:** download
  [jumpstart-3d.html](https://github.com/MaxSikorski/jumpstart-3d/releases/latest/download/jumpstart-3d.html)
  and double-click it. That one file is the whole app. It works without an
  internet connection (only the fonts come from the web).

That is all. You do not need anything else in this repository.

**Fast after the first visit.** The website shows the workspace right away; the geometry engine (7 MB) downloads in the background, a small note in the corner of the 3D view shows how far it is, and shapes you add appear when it is ready. After that first visit the site keeps a copy on your computer, so it opens at once and works without an internet connection (only the fonts come from the web). When a new version is published it downloads in the background and a message asks you to reload. The downloaded single file is not affected.

**Back up your designs.** Designs live in this browser only (in its IndexedDB storage, which has room for big designs; browsers that block it fall back to the older, smaller storage). In Your designs, **Back up all designs…** saves them all into one file, and **Restore from backup…** puts them back, on this or another computer; it adds what is missing and never deletes anything. Clearing your browser's site data erases designs, so back up now and then. (Autosave checkpoints are not in the file.)

## What it does

- Beginner mode: drag shapes, group them, cut holes, on a 256 × 256 mm
  build plate
- Advanced mode: sketches, extrude, revolve, loft, sweep, fillet, chamfer,
  shell, patterns (including along a path, and of whole features such as
  holes and cuts) and a feature timeline, driven by a real CAD kernel
  (OpenCascade)
- 3D Sketch: draw tubes and pipes freely in space
- Lathe: turn a body or a blank into a round part
- Jump Brick Builder (Advanced, Simulate): build with bricks
- Chisel: clay-style sculpting, with Puppet Animator
- FlexiGen: print-in-place articulated figures
- Mesh to STEP: turn STL or 3MF meshes into editable STEP solids
- Nineteen step-by-step tutorials with built-in animations
- Projector window, Media (pictures and video on objects), Picture to 3D
- Works on Mac, iPad and iPhone as well as Windows, Linux and Chromebooks
- Layer-by-layer print preview, section analysis, multi-filament colors
- Export to STL, OBJ, 3MF, STEP and DXF
- Named parameters: a Parameters list in the Advanced sidebar and in the
  Beginner shape panel, and sketch dimensions, feature values (extrude
  distance, revolve angle, fillet and chamfer size, hole diameter and depth,
  shell thickness), a Pattern's count, spacing and angle, and Beginner shape
  sizes (Width, Depth, Height) that take a name or an expression (`w`, `w/2`)
  and follow it when the value changes
- Pattern as an editable feature: in Advanced, a pattern of features (holes,
  cuts, bosses, text) or a "join copies" pattern of a shape is one Pattern
  entry in the timeline, not a pile of copies; double-click it to change the
  count, spacing or angle, and editing the source hole updates every copy.
  Patterns of separate bodies, Beginner patterns and path patterns still make
  plain copies
- Proof it is parametric: a fully-constrained mark on every sketch, dimension
  names `d1`, `d2`… you can use in any dimension, feature value or shape
  size, parameters importable and exportable as CSV, and a Parameters tutorial
- Mesh detail setting (Normal, Fine, Extra fine, or a custom level up to 32×
  with a live triangle count) for smoother curves in the view and in mesh
  exports

## Chat inside the app

Click the **AI** button in the top bar, pick a model, and type what you want ("a 40 by 30 by 20 block with an 8 mm hole
through it"). The model edits the design you have open through the same 34 tools the MCP server below has: it adds shapes,
cuts holes, moves and sizes them, looks at the view and offers an export. You can see every step it takes in the chat, and
undo it like any other edit.

| Provider | Address filled in for you | Key |
|---|---|---|
| Ollama | `http://localhost:11434` | not needed |
| LM Studio | `http://localhost:1234/v1` | not needed |
| OpenAI-style (OpenAI, OpenRouter, Groq, oMLX…) | `https://api.openai.com/v1` (change it for the others) | yes |
| Anthropic | `https://api.anthropic.com/v1` | yes |

Use **List models** to fill the model box from the server. Tick **Model can see images** if your model can (it then gets
screenshots of the view). For a local model pick one that supports tools, 9B or larger works best.

A local server has to allow the page to talk to it, once:

- **Ollama:** run it with `OLLAMA_ORIGINS="*"` and restart it. On macOS: `launchctl setenv OLLAMA_ORIGINS "*"`, then quit
  and reopen the Ollama app. On Linux: `systemctl edit ollama.service` and add `Environment="OLLAMA_ORIGINS=*"` under
  `[Service]`. On Windows: add the user environment variable `OLLAMA_ORIGINS` with the value `*`. The single file (opened
  from disk) needs the same setting.
- **LM Studio:** Developer › Server Settings › turn on **Enable CORS** (or start it with `lms server start --cors`), then
  start the server.

If Chrome asks whether the site may reach devices on your local network, allow it. Safari may block the website from reaching
`localhost`; use the single file there.

Your key stays in this browser and is saved only if you tick **Remember key in this browser**. Nothing is sent until you
press Send, and the model can only use the tools. **Allow scripts** is off unless you tick it: with it on, the model can run
any JavaScript in the page (the same trust as Open/Export › Run script…). The MCP route below stays for agents that run
outside the browser, such as Claude Code.

## Use it with an AI agent

Give any AI agent that can read a web page and run commands this one line, and it sets the server up for itself (it asks you
before it edits files outside the repository):

```
Read https://raw.githubusercontent.com/MaxSikorski/jumpstart-3d/main/mcp/AGENT-SETUP.md and set it up for me.
```

(If the agent cannot fetch the address, use the same file on the web page:
[mcp/AGENT-SETUP.md](https://github.com/MaxSikorski/jumpstart-3d/blob/main/mcp/AGENT-SETUP.md).)

If you use Claude Code, two commands let your agent build and edit designs in JumpStart 3D, look at the result and export
STL, STEP, OBJ or 3MF files:

```
claude plugin marketplace add MaxSikorski/jumpstart-3d
claude plugin install jumpstart-3d@maxsikorski
```

To have the agent edit the design you have open, turn on **Connect to AI agent** in the theme menu (the half-moon button); it is
off unless you turn it on. Without that, the agent works in its own invisible browser (run `npx playwright@1.62.1 install chromium` once).
The command line (`jumpstart run`, `export`, `shot`, `status`), the full tool list and the safety notes are in
[mcp/README.md](mcp/README.md).

### Other agents

Any client that starts a stdio MCP server can use it; `mcp/README.md` has the exact file and block for each.

| Client | How to add | Does a screenshot reach the model? |
|---|---|---|
| Claude Code | the plugin above | yes |
| Codex (CLI, desktop app) | `~/.codex/config.toml`, or `codex mcp add` and then `tool_timeout_sec = 600` under that server in the same file | not confirmed |
| Hermes Agent | `~/.hermes/config.yaml` | yes (text-only model: file path) |
| OpenCode | `opencode.json` | not documented |
| Gemini CLI, Antigravity | `~/.gemini/settings.json`, `~/.gemini/config/mcp_config.json` | Gemini CLI yes |
| Cursor | `~/.cursor/mcp.json` | yes |
| Cline, LM Studio | `cline_mcp_settings.json`, `~/.lmstudio/mcp.json` | not reliably; use the `path` option |
| Grok Build | `~/.grok/config.toml` | not documented |
| Open WebUI | through the `mcpo` bridge | not documented |
| ChatGPT on the web | cannot: remote servers only (the Codex desktop app works, see its row) | |

Ollama and oMLX run models only; put one of the agents above on top. When a model cannot see images, the agent can call
`screenshot` with a `path` and the picture is saved to that file instead. The shape most clients read:

```json
{ "mcpServers": { "jumpstart-3d": { "command": "node", "args": ["<repo>/mcp/server.mjs"] } } }
```

## See it in action

The author's own tour of version 2.0:
[JumpStart 3D Design is BACK! Version 2.0](https://youtu.be/OmoVmYzoIsk)
(12½ minutes: the three modes, Lathe, 3D Sketch, patterns, the print
simulator, Chisel's animator and the projector). Mike at Making Layers walks
through Beginner, Advanced and Chisel in
[4 New 3D CAD/Modeling Programs!](https://youtu.be/KGi11k9tQhA?t=308)
(from 5:08). More videos, posts and things people made are collected in
[COMMUNITY.md](COMMUNITY.md); add yours there.

## Where to find us

- The official JumpStart 3D site, with the author's own downloads:
  https://sites.google.com/view/jumpstart-3d-creator/home
- The author's source repository: https://github.com/classyapps2026/jumpstart3d
- Reddit: https://www.reddit.com/r/Jumpstart3D/ for questions, prints and ideas
- GitHub Discussions, for announcements, polls and Q&A:
  https://github.com/MaxSikorski/jumpstart-3d/discussions

## Support the project

JumpStart 3D is free and stays free. If it saves you time, you can chip in
towards the maintainer's hosting and coffee. Both are Stripe payment links;
no account needed.

- One-time, any amount: https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08
- Monthly: https://buy.stripe.com/7sYcN479Q71p44l1cB0gw09

This supports the community build only; the original author is credited in
the app's About dialog and in NOTICE.md.

## Help improve it

You do not need to write code to help.

- **Found a bug?** Open an issue:
  https://github.com/MaxSikorski/jumpstart-3d/issues/new/choose and pick
  "Bug report". Say which browser you use and what you clicked, and attach a
  saved project file if you can.
- **Want a feature?** Same page, pick "Feature request". Describe the
  problem you are trying to solve; that helps more than a specific design.
- **Have a question, or want to show what you made?** Use
  [Discussions](https://github.com/MaxSikorski/jumpstart-3d/discussions):
  Q&A for "how do I", Show and tell for pictures of your prints.
- **Know the answer to someone else's issue or question?** Reply to it.
  Helping other users counts.
- **Want to change the code?** Read on, and see
  [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.
- **Want to support the work with money?** See
  [Support the project](#support-the-project) above.

## I want to change it or contribute

The app is plain JavaScript modules under `src/`, from the author's own
source release of version 2.0 (the untouched 2.0 files are on the
`upstream-originals` release). One command bundles them into the website
and the single offline file.

You need [Node.js](https://nodejs.org/) (version 18 or newer). Then:

```
git clone https://github.com/MaxSikorski/jumpstart-3d.git
cd jumpstart-3d
npm install
node build.mjs
```

`npm install` fetches one tool, esbuild, pinned to the version the author
used. The build writes two things:

- `docs/` the website (the same files GitHub Pages serves)
- `dist/jumpstart-3d.html` the single offline file

To try the website locally, serve the `docs/` folder with any static
server, for example:

```
npx serve docs
```

### Running the tests

The tests drive the real app in a headless browser: both builds, Beginner and
Advanced, the kernel, the helpers and the exports. Once, after `npm install`,
fetch the browser with `npx playwright@1.62.1 install chromium`. Then, after a build:

```
npm test
```

`test/README.md` explains what runs and how to re-record the golden export
hashes after an intended geometry change.

`node tools/measure-load.mjs` times a page load on a simulated 10 Mbit connection; `test/README.md` explains the numbers.

### Where things are

```
src/index.html      page shell, CSS and menus
src/app.js          the app's entry point; the other src/*.js files are its modules
                    (beginner.js, advanced.js, sketcher.js, kernel.js, projects.js, ...)
src/worker.js       geometry worker that runs the CAD kernel (kernel.js) via replicad
src/occt-gz.wasm    OpenCascade kernel, gzipped
src/flexigen.html, src/meshstep.html, src/chisel.html
                    the helper pages, built; their source is in tools/
src/meshdetail.js   our Mesh detail setting
src/params.js       our named parameters (evaluator and the dimension and feature hooks)
src/bridge.js       our scripting bridge, `window.JS3D` (see BRIDGE.md)
src/runscript.js    our "Run script…" menu entry (runs a .js file with JS3D in scope)
src/loadui.js       our loading note over the 3D view, and the start of the offline copy on the website
src/sw.js           our service worker: the website's offline copy (the site build only)
mcp/                our MCP server for AI agents, its Claude Code plugin and skill, the `jumpstart`
                    command line and AGENT-SETUP.md, the page an agent reads to set itself up
                    (see mcp/README.md); it has its own package.json, so `npm ci` inside
                    mcp/ once; its tests run with `npm run test:mcp`
skills/             a copy of the agent skill (mcp/skills/jumpstart-3d/SKILL.md) where `npx skills add`
                    and other agents' skill folders look; a test keeps the two identical
.claude-plugin/     marketplace.json, so `claude plugin marketplace add` finds the plugin in mcp/
third_party/        the libraries the build bundles: three.js, replicad, opentype.js,
                    Flatbush, Flatqueue, the OpenCascade loader
LICENSES/, THIRD-PARTY-NOTICES.md
                    licenses of everything in third_party/ and of the fonts
build.mjs           the build (the author's dist.sh and standalone.py, in Node)
tools/              helper page sources and the scripts that rebuild them
                    (see tools/README-helpers.md); og-card/ renders the link-preview image;
                    bridge-demo.js is a script for Open/Export › Run script… (or the console);
                    measure-load.mjs times a page load on a simulated slow connection
BRIDGE.md           the `JS3D` calls and the project file format
docs/               built website, committed so GitHub Pages can serve it
jumpstart_3d_v2.0.htm      the untouched upstream file this version came from
UPSTREAM-README.md         the author's README from the source release
```

### Rules of thumb

- After any change run `node build.mjs`, then `npm test`, then try both
  outputs yourself: the site in a browser and `dist/jumpstart-3d.html` opened
  from disk. The local site keeps its service worker, so after a rebuild reload
  twice: the first reload shows the old build and the "new version" message.
- Commit the rebuilt `docs/` with your change. `dist/` is not committed; the
  single file is attached to releases instead.
- Keep "Created by J.Siwek" in the About dialog. Our additions are listed
  below, not claimed as the original.

## What this repository adds on top of the original

- OBJ export in the Open/Export menu
- No waiting at a splash screen: the workspace opens while the geometry engine loads, and the website works offline after one visit through a service worker (`src/loadui.js`, `src/sw.js`, the site build only)
- Back up all designs and Restore from backup in Your designs: every design in this browser in one JSON file, and an additive restore that never deletes or overwrites (`src/projects.js`)
- Designs are stored in the browser's IndexedDB instead of the 5 MB localStorage, so a design with an imported mesh no longer fills the browser up; designs saved the old way are copied over on the first visit, and browsers where IndexedDB fails keep the old way (`src/projstore.js`)
- Link previews: when the site address is shared on Discord, Reddit, iMessage,
  Slack or X, it shows a title, a description and a 1200×630 card image. The
  tags live in `src/index.html`; the card is rendered from `tools/og-card/`
- Chat inside the app: an AI button opens a panel where a model (Ollama, LM Studio, OpenAI or Anthropic) edits the open
  design through the same 34 tools as the MCP server. Keys stay in the browser; scripts are off unless you tick them
- Mesh detail in the theme menu: Normal, Fine, Extra fine, or a custom level
  up to 32× set by a slider or by typing the triangle count you want. It
  controls how finely curved surfaces are divided into triangles, for the view
  and for STL, OBJ and 3MF exports, and asks before building more than
  500,000 triangles. The original always used the Normal level.
- The website build keeps the 7 MB kernel as a separate file, so the page
  itself is about 5 MB instead of 14 MB
- A reproducible build from readable source, with the libraries pinned
- Imported SVG drawings are stripped of scripts, embedded HTML and event
  handlers before the app reads their geometry, so a booby-trapped file cannot
  run code in the page
- Proof it is parametric: every sketch shows a ✓ when fully constrained (or
  how many degrees of freedom are left, as a plain count, so an estimate),
  every dimension has a name (`d1`, `d2`…) that any dimension, feature value
  or shape size can use (`d1/2`), the Parameters list exports and imports as
  CSV (one undo step), and a Parameters tutorial walks through it
- Named parameters: a Parameters section at the top of the Advanced browser
  (add, rename, edit, delete, undo). Give a parameter a name and a value or
  expression (`40`, `w/2`, `1in`), then type the name or an expression in any
  sketch dimension or in a feature's value box (extrude distance, revolve
  angle, fillet and chamfer size, hole diameter and depth, shell thickness);
  the sketch, the feature and everything built on it follow when the
  parameter changes. A value tied to a name shows its expression and an `fx`
  look in the dialog, and the timeline reads `Extrude (dist = t)`. A
  Beginner shape's Width, Depth and Height boxes take them too, and the shape
  panel lists the parameters under its other settings; typing a plain number,
  or resizing on the canvas, frees that size again. Parameters are saved in
  the project file; older files open unchanged. A Pattern's count, spacing
  and angle take them too (`Pattern (n1 = n)` on the timeline). Parameters
  are lengths, so a count or angle parameter typed in inch mode is scaled by
  25.4: make those in mm mode
- Pattern as an editable feature (Advanced): a new `pattern` entry in a
  body's feature list repeats the earlier hole, cut, boss or text features it
  names (by id, so editing the source updates every copy), or the whole shape
  so far, fusing the copies into it (Fusion's "pattern bodies, joined").
  Rectangular (one or two directions, optionally both sides) and circular;
  the axes and centre are saved in the body's own coordinates, so the pattern
  follows the body when it is moved or turned. The Pattern dialog opens again
  from the timeline (Edit Pattern). Still baked, as before: Beginner patterns,
  patterns of several bodies left separate (they are separate bodies) and path
  patterns. A trailing uneven Scale turns the body into a mesh, as it does for
  any feature it cannot replay
- Scripting bridge: `window.JS3D` lets a script, the browser console or a
  tool server build and edit Beginner shapes (add, move, turn, resize, scale,
  group, holes, parameters), read each body's size and volume, undo, take a
  screenshot, export STL, OBJ, 3MF, STEP or the project file, and open a project
  file, with the same bytes the Export menu gives. It does nothing until it is
  called, and works in the single file too. `BRIDGE.md` lists every call and
  documents the project `.json` format; `tools/bridge-demo.js` is an example
  you can paste into the console
- Open/Export › Run script…: pick a `.js` file and it runs with `JS3D` in
  scope, no console needed; the result or the error shows as a message
- An MCP server for AI agents (`mcp/`): Claude Code or any MCP client can build
  and edit designs through tools that mirror `JS3D`, either in the tab you have
  open (theme menu › Connect to AI agent, off unless you turn it on) or in a
  headless browser. `mcp/README.md` has the install lines, the tool list and
  what an agent can and cannot do
- A Claude Code plugin (two install commands) with a skill that teaches an agent
  to use those tools, a `jumpstart` command line that runs a script or makes
  an export or a picture without an agent, and a one-line prompt that has any
  other agent (Codex, Hermes, OpenCode, Gemini CLI, Cursor...) set the server
  up for itself; `screenshot` can save its picture to a file for models that
  cannot see images
- A regression test suite (`npm test`) that drives the real app in a headless
  browser on both builds, and runs on every pull request

## License

MIT. The author released the source of version 2.0 under the MIT License
(on the official site, https://sites.google.com/view/jumpstart-3d-creator/home,
and in his GitHub repository, https://github.com/classyapps2026/jumpstart3d).
This repository's additions, by Max Sikorski and the community, use the same
license. The author's repository has the app source but not the bundled
libraries; this repository has both, so it builds on its own. The full text is in
[LICENSE](LICENSE); credit, history and third-party licenses are in
[NOTICE.md](NOTICE.md).
