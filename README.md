# JumpStart 3D

[![JumpStart 3D: 3D CAD in your browser](src/og-image.png)](https://maxsikorski.github.io/jumpstart-3d/)

A free 3D CAD tool that runs in your web browser. No install, no account, no server. Somewhere
between Tinkercad and a real CAD program: drag shapes together in Beginner mode, or sketch,
extrude, fillet and shell in Advanced mode.

Created by **J.Siwek**, who publishes it under the MIT License. Find him at the
[official site](https://classyapps.org/) (his own downloads), his
[source repository on GitHub](https://github.com/classyapps2026/jumpstart3d) and his
[video introducing 2.0](https://youtu.be/OmoVmYzoIsk).

This repository is the community fork, maintained by **Max Sikorski** with the jumpstart-3d
community. It put the app back online when the original download disappeared, follows each of
J.Siwek's releases, and adds some work of its own, listed in
[What this repository adds on top of the original](#what-this-repository-adds-on-top-of-the-original).
See [NOTICE.md](NOTICE.md) for credit and licensing.

**[Open it](https://maxsikorski.github.io/jumpstart-3d/)** ·
**[Download the single file](https://github.com/MaxSikorski/jumpstart-3d/releases/latest/download/jumpstart-3d.html)** ·
**[Use it with an AI agent](#use-it-with-an-ai-agent)**

## Contents

- [Get started](#get-started)
- [What people make with it](#what-people-make-with-it)
- [What it can do](#what-it-can-do)
- [Keep your designs safe](#keep-your-designs-safe)
- [Chat inside the app](#chat-inside-the-app)
- [Use it with an AI agent](#use-it-with-an-ai-agent)
- [Help improve it](#help-improve-it)
- [Support the project](#support-the-project)
- [What this repository adds on top of the original](#what-this-repository-adds-on-top-of-the-original)
- [Setting up your server](#setting-up-your-server)
- [Build it yourself](#build-it-yourself)
- [License](#license)

## Get started

JumpStart 3D can be used in a browser tab, as one downloaded file, or as an installed app. You do
not need anything else in this repository.

### Use it online

Open https://maxsikorski.github.io/jumpstart-3d/ in any current browser. The workspace shows
straight away, and the geometry engine (7 MB) loads in the background; a small note in the corner
of the 3D view shows how far it is.

### Use the single file

Download
[jumpstart-3d.html](https://github.com/MaxSikorski/jumpstart-3d/releases/latest/download/jumpstart-3d.html)
(about 16 MB) and double-click it. That one file is the whole JumpStart 3D app and needs no
internet connection.

### Install it as an app

On the website, use Install in Chrome or Edge, or Add to Dock in Safari. A community member also
shared an Electron wrapper for the single file on macOS in
[issue #11](https://github.com/MaxSikorski/jumpstart-3d/issues/11).

### Use it offline

After your first visit, the JumpStart 3D website keeps a copy on your computer, fonts included, so
it opens at once and works without internet. When a new version is published, a message asks you
to reload. The single file never needs the web.

## What people make with it

The JumpStart 3D community shares what it builds in a few places. Everything below is by the
people named, not by this project.

### Videos

[![JumpStart 3D Design is BACK! Version 2.0](https://img.youtube.com/vi/OmoVmYzoIsk/hqdefault.jpg)](https://youtu.be/OmoVmYzoIsk)

J.Siwek's own tour of version 2.0, at [Make and Remake](https://www.youtube.com/@MakeandRemake-z5c),
October 2026: the three modes, Lathe, 3D Sketch, patterns, the print simulator, Chisel's animator
and the projector (12½ minutes).

[![4 New 3D CAD/Modeling Programs!](https://img.youtube.com/vi/KGi11k9tQhA/hqdefault.jpg)](https://youtu.be/KGi11k9tQhA?t=308)

Mike at [Making Layers](https://www.youtube.com/@MakingLayers), October 2026, walks through
Beginner, Advanced and Chisel in "4 New 3D CAD/Modeling Programs!" (the JumpStart 3D part starts
at 5:08).

### Prints, questions and ideas

The [r/Jumpstart3D subreddit](https://www.reddit.com/r/Jumpstart3D/) is where people ask questions
and share prints and ideas. The JumpStart 3D
[Show and tell](https://github.com/MaxSikorski/jumpstart-3d/discussions/categories/show-and-tell)
category on GitHub Discussions is ready for pictures of what you designed. It has one
[welcome thread](https://github.com/MaxSikorski/jumpstart-3d/discussions/13) and no replies yet, so
yours could be the first. Questions go in [Discussions](https://github.com/MaxSikorski/jumpstart-3d/discussions).

### Learn it

JumpStart 3D has seventy-five step-by-step tutorials with animations, behind the **Tutorials** button
in the top bar: forty-four from J.Siwek and thirty-one added by this community build for the
toolbar buttons that had none.

### Add yours

Made a video, a post or a print? [COMMUNITY.md](COMMUNITY.md) collects them and explains how to add
yours: open an issue with the "Share your content" form, or reply with a link. We link to your
work; we do not copy it.

## What it can do

JumpStart 3D works on Mac, iPad and iPhone as well as Windows, Linux and Chromebooks. It has two
groups of features: J.Siwek's own, and the ones this community build adds.

### J.Siwek's features

- **Beginner mode:** drag shapes, group them and cut holes, on a 256 × 256 mm build plate.
- **Advanced mode:** sketches, extrude, revolve, loft, sweep, fillet, chamfer, shell, patterns and
  a feature timeline, driven by a real CAD kernel (OpenCascade).
- **3D Sketch** for tubes and pipes, **Lathe**, **Jump Brick Builder**, and **Chisel** for
  clay-style sculpting with Puppet Animator.
- **Architechies** (new in 2.2): floor plans, walls, doors, windows and roofs, sent to Beginner or
  Advanced as editable shapes.
- **CAM Studio** (new in 2.3): plan and simulate CNC router, mill or laser cuts and save G-code.
  Sending it to a machine over USB asks the browser's own permission first.
- **FlexiGen** for print-in-place articulated figures, and **Mesh to STEP** to turn STL or 3MF
  meshes into editable solids.
- **Print tools:** layer-by-layer preview, section analysis and multi-filament colours. Export to
  STL, 3MF, STEP and DXF (Chisel also exports OBJ).
- A projector window, pictures and video on objects, and Picture to 3D.

### Added by this community build

- **Named parameters:** type `w` or `w/2` instead of a number, and everything follows when it
  changes.
- **Bolts, nuts, gears, hole patterns and name plates**, ready to drop into a design.
- **Turning shapes** by typed angle or in fine steps, around a pivot you can move.
- **Your printer's plate size**, with steep undersides shaded red.
- **glTF and OBJ export, OBJ import**, and a pre-painted 3MF for multi-colour printing.
- **Back up, folder copies and your own server**, and a **share link** that puts a small design in
  a web address.
- **An AI chat and AI agent support.**

The complete list is in
[What this repository adds on top of the original](#what-this-repository-adds-on-top-of-the-original).

## Keep your designs safe

JumpStart 3D keeps your designs in the browser you used, and clearing that browser's site data
erases them. Three tools in **Your designs** protect them. None ever deletes or overwrites a design
you already have.

### Back up and restore

**Back up all designs…** saves every design into one file. **Restore from backup…** puts them back,
on this or another computer. Autosave checkpoints are not in the file.

### Save copies into a folder

**Save copies into a folder…** (Chrome and Edge on a computer) keeps a project file of every
design in a folder you pick, updated a few seconds after you stop editing. Those copies survive
clearing site data. After the browser restarts, open Your designs and click **Allow**.

**Restore from a folder…** (any browser on a computer) adds the designs back from such a folder.
Your browser may say "upload"; nothing leaves your computer.

### Your server tab

The **Your server** tab in Your designs keeps designs in a folder on a WebDAV server (Nextcloud, a
NAS, a web server), so every computer you use can open them. Type the folder's address, your user
name and password (on Nextcloud, an app password from Settings › Security), and click **Connect**.

If your copy and the server's both changed, the server's opens as "… (from server)" and yours
stays. The server has to be set up once: see
[Setting up your server](#setting-up-your-server).

## Chat inside the app

JumpStart 3D has a built-in AI chat. Click the **AI** button in the top bar, pick a model, and type
what you want ("a 40 by 30 by 20 block with an 8 mm hole through it"). The model edits the design
you have open: it adds shapes, cuts holes, moves and sizes them, looks at the view and offers an
export. It acts only through the same tools as the
[agent server](mcp/README.md#tools), you see every step in the chat, and you can undo it like any
other edit.

### Chat providers

| Provider | Address filled in for you | Key |
|---|---|---|
| Ollama | `http://localhost:11434` | not needed |
| LM Studio | `http://localhost:1234/v1` | not needed |
| OpenAI-style (OpenAI, OpenRouter, Groq, oMLX…) | `https://api.openai.com/v1` (change it for the others) | yes |
| Anthropic | `https://api.anthropic.com/v1` | yes |

Use **List models** to fill the model box from the server. Tick **Model can see images** if yours
can. For a local model, pick one that supports tools; 9B or larger works best.

### Let a local model connect

A local model server has to allow the JumpStart 3D page to talk to it, once.

- **Ollama:** run it with `OLLAMA_ORIGINS="*"` and restart it. The single file needs the same
  setting.
  - macOS: `launchctl setenv OLLAMA_ORIGINS "*"`, then quit and reopen the Ollama app.
  - Linux: `systemctl edit ollama.service` and add `Environment="OLLAMA_ORIGINS=*"` under
    `[Service]`.
  - Windows: add the user environment variable `OLLAMA_ORIGINS` with the value `*`.
- **LM Studio:** Developer › Server Settings › turn on **Enable CORS** (or start it with
  `lms server start --cors`), then start the server.

If Chrome asks whether the site may reach devices on your local network, allow it. Safari may block
the website from reaching `localhost`; use the single file there.

### Chat keys and scripts

Your key stays in this browser and is saved only if you tick **Remember key in this browser**.
Nothing is sent until you press Send. **Allow scripts** is off unless you tick it: with it on, the
model can run any JavaScript in the page, the same trust as Open/Export › Run script….

## Use it with an AI agent

Agents that run outside the browser, such as Claude Code, Codex or Gemini CLI, can build and edit
JumpStart 3D designs, look at the result and export STL, STEP, OBJ or 3MF. This is separate from
the in-app chat (see [Chat inside the app](#chat-inside-the-app)).

### One-line setup for any agent

Give any agent that can read a web page and run commands this one line, and it sets everything up
itself (it asks before it edits files outside the repository):

```
Read https://raw.githubusercontent.com/MaxSikorski/jumpstart-3d/main/mcp/AGENT-SETUP.md and set it up for me.
```

If the agent cannot fetch the address, use the same file on the web:
[mcp/AGENT-SETUP.md](https://github.com/MaxSikorski/jumpstart-3d/blob/main/mcp/AGENT-SETUP.md).

### Claude Code plugin

With Claude Code, two commands install the JumpStart 3D plugin:

```
claude plugin marketplace add MaxSikorski/jumpstart-3d
claude plugin install jumpstart-3d@maxsikorski
```

### Edit the design you have open

For an agent to edit the JumpStart 3D design open in your browser, turn on **Connect to AI agent**
in the Theme, performance and mesh detail menu (the half-moon button). It is off unless you turn it
on. Without that, the agent works in its own invisible browser, which needs Chromium once:
`npx playwright@1.62.1 install chromium`.

### More about agents

Setup for other agents (Codex, Gemini CLI, Cursor and more), the command line, the full tool list
and the safety notes are in [mcp/README.md](mcp/README.md).

## Help improve it

You do not need to write code to help JumpStart 3D.

Writing or filming about it? [PRESS.md](PRESS.md) has the facts, links and pictures for press and video makers.

### Report a bug

Open an issue at https://github.com/MaxSikorski/jumpstart-3d/issues/new/choose and pick "Bug
report". Say which browser you use and what you clicked, and attach a saved project file if you can.

### Ask for a feature

Use the same page and pick "Feature request". Describe the problem you are trying to solve; that
helps more than a specific design.

### Ask a question or answer one

Questions and pictures of what you made go in
[Discussions](https://github.com/MaxSikorski/jumpstart-3d/discussions). If you know the answer to
someone else's question, reply to it. Helping other users counts.

### Change the code

See [CONTRIBUTING.md](CONTRIBUTING.md) for the guide, and
[Build it yourself](#build-it-yourself) to get a working copy.

## Support the project

JumpStart 3D is free and stays free. If it saves you time, you can chip in towards the
maintainer's hosting and coffee. Both are Stripe payment links; no account needed. The About
dialog also has a Support button.

- One-time, any amount: https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08
- Monthly: https://buy.stripe.com/7sYcN479Q71p44l1cB0gw09

This supports the community build only; the original author is credited in the app's About dialog
and in NOTICE.md.

## What this repository adds on top of the original

This is the full list of what the JumpStart 3D community build adds to J.Siwek's app. It is all
ours, not his. The code for each sits in its own module or in a short, marked block, so a new
upstream version stays easy to merge.

### Making things

- Fasteners: hex bolts, hex nuts, threaded rods and tap cutters in metric (M2.5 to M12) and inch
  (#6 to 1/2) sizes, with a print offset so printed parts screw together.
- Hole patterns: rows, staggered rows or a circle of round, square, hex or slot holes on a flat
  face. Round holes can be plain, counterbored, countersunk or tapped; square, hex and slot holes
  are cut through the part or to a depth.
- Gears: spur gears, straight bevel gears and racks from a module and a tooth count, with a print
  clearance and an optional bore and keyway. Helical gears are not built yet, and to change a gear's
  teeth you undo and make it again.
- Name plates: a plate sized to one line of text, with the letters raised in a second colour or
  cut in, and optional hanging or screw holes.
- Thirty-one more tutorials, for the toolbar buttons that had none.

### Editing

- Named parameters: give a value a name or an expression (`40`, `w/2`, `1in`) and use it in sketch
  dimensions, feature values, pattern counts and Beginner shape sizes. Everything built on it
  follows when it changes. The list exports and imports as CSV.
- A fully-constrained mark on every sketch, and a name for every dimension (`d1`, `d2`…), as proof
  the design is parametric.
- Patterns as one editable timeline entry: change the count, spacing or angle later, and editing
  the source hole updates every copy.
- Move and turn sketches, and the features built from them follow.
- Turning shapes: typed angles, 15° steps or free turning, fine steps from the status bar, and a
  movable pivot with snapping.
- A hidden rebuild-times panel for slow designs (Ctrl+Alt+P, or add `?perf` to the address): the last
  rebuild body by body, slowest first, with batch, triangles, total and a Copy button for bug reports.
- An underside view: the plate turns nearly clear when you look from below.
- Boolean fixes: a torus no longer disappears from a group, two offset spheres cut to the right
  volume, an empty result says "Nothing is left", and joined torus groups export at the right
  size.

### Printing

- Printer plate: pick your printer's build area; Beginner's mat takes its width and depth, and
  Advanced keeps its grid and adds a thin outline of the plate. The sizes are the makers' stated
  build volumes, checked against their pages and not yet tried on real printers.
- Overhang shading: faces that lean out more than a limit you choose (10 to 80°) are painted red.
  The 3D Print Sim uses the same rule. The choice is a viewing setting kept on your device, not
  saved in the design.
- Pre-painted 3MF: what you paint in the 3D Print Sim is written into the 3MF, so Orca and
  PrusaSlicer open it with the colours already on the model. Not yet tried in Orca, Snapmaker
  Orca or Bambu Studio themselves.
- Mesh detail, in the Theme, performance and mesh detail menu: Normal, Fine, Extra fine, or a
  custom level up to 32×, for smoother curves in the view and in exports. It asks before building
  more than 500,000 triangles.

### Files and sharing

- OBJ and glTF (`.glb`) export, and OBJ import in Beginner and Advanced.
- Share link: puts a small design in a web address, which you copy and send. Nothing is uploaded,
  the receiver is asked before it opens, and it opens as a new design, never over theirs. The link
  holds the whole design, unencrypted, so anyone with it can open a copy. It is capped at 4096
  characters, and designs made in Chisel or Architechies, or with joints, need a project file
  instead.
- Report a problem: opens a bug report on GitHub with the app details filled in, never your
  design. The app sends nothing; you press the link and then Create on GitHub.
- Link previews: shared on Discord, Reddit, iMessage, Slack or X, the site shows a title and a
  card image.
- Imported SVG drawings are cleaned of scripts, so a booby-trapped file cannot run code.

### Storage and safety

- Back up all designs and Restore from backup, Save copies into a folder, Restore from a folder,
  and the Your server tab (see [Keep your designs safe](#keep-your-designs-safe)).
- Designs are stored in the browser's IndexedDB, which has room for big designs, instead of the
  5 MB localStorage. Old designs are copied over on the first visit and left in place.

### Speed and installing

- No waiting at a splash screen: the workspace opens while the engine loads, and the website works
  offline after one visit.
- Installable as an app, with the fonts included.
- The website keeps the 7 MB kernel as a separate file, so the page itself is about 5 MB, against
  about 16 MB for the single file.
- The About dialog has **Check for updates**, **Visit the community build**, **Support** and
  **J.Siwek's site**. The update check contacts our GitHub releases only when you click it.

### AI and scripting

- Chat inside the app (see [Chat inside the app](#chat-inside-the-app)).
- An MCP server for AI agents, and a Claude Code plugin with a skill that teaches an agent to use
  it, plus a `jumpstart` command line that makes exports and pictures without an agent. See
  [mcp/README.md](mcp/README.md).
- A scripting bridge, `window.JS3D`, that scripts and the browser console can call; Open/Export ›
  Run script… runs a `.js` file with it. [BRIDGE.md](BRIDGE.md) lists every call and the project
  file format.

### Building and testing

- A reproducible build from readable source, with the libraries pinned.
- A test suite (`npm test`) that drives the real app on both builds. A short part gates every pull
  request and the rest runs nightly.

## Setting up your server

JumpStart 3D's Your server tab speaks WebDAV (not S3 or Windows shares). This section explains
what your server must allow and gives recipes for common ones. We have not tried the recipes
ourselves: tell us in an issue if one works, or what it needed.

### The https problem

The JumpStart 3D website is on https, and a NAS at home usually speaks plain http, which browsers
refuse to mix with an https page ("mixed content"). Two fixes: give the NAS a certificate and use
its https:// address, or put the page on the NAS itself, next to the folder (see the
[TrueNAS recipe](#truenas)), so the page and the folder share one address and nothing needs
permission.

### What the server must allow

A browser lets a web page talk to another address only when that address agrees. So the server has
to answer the page's "may I?" question (a request called OPTIONS) and add a few headers to every
answer, errors included:

- `Access-Control-Allow-Origin`: `*`, or the address the page is opened from.
- `Access-Control-Allow-Methods`: `GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS`.
- `Access-Control-Allow-Headers`: `Authorization, Depth, Content-Type, If-Match`.
- The OPTIONS question has to be answered with a success (204 is usual) without asking for a
  password, because the browser sends it before it sends the password.

If Chrome asks whether the page may reach devices on your local network, allow it. If the folder is
missing, the Your server tab offers a **Create the folder** button; it never creates one by itself.
**Test connection** checks the address, user name and password without saving anything.

### nginx

nginx needs the third-party `nginx-dav-ext-module`; the stock module cannot list a folder or
answer OPTIONS.

```nginx
location /dav/ {
    root /srv;
    dav_methods PUT DELETE MKCOL;
    dav_ext_methods PROPFIND OPTIONS;
    client_max_body_size 64m;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Depth, Content-Type, If-Match" always;
    if ($request_method = OPTIONS) { return 204; }
    auth_basic "JumpStart 3D";
    auth_basic_user_file /etc/nginx/dav.htpasswd;
}
```

### Apache

Apache needs `mod_dav`, `mod_dav_fs` and `mod_headers` switched on.

```apache
<Location "/dav/">
    Dav On
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Allow-Methods "GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS"
    Header always set Access-Control-Allow-Headers "Authorization, Depth, Content-Type, If-Match"
    AuthType Basic
    AuthName "JumpStart 3D"
    AuthUserFile /etc/apache2/dav.passwd
    <LimitExcept OPTIONS>
        Require valid-user
    </LimitExcept>
</Location>
```

### TrueNAS

TrueNAS CORE 13 has a built-in WebDAV service (Services › WebDAV: HTTP on port 8080, or HTTPS on
8081 with a certificate) and WebDAV shares (Sharing › WebDAV Shares). A share's address is
`http(s)://<your NAS>:<port>/<share name>/`, and the share name is case-sensitive. The service has
one password, for the user `webdav`. Set its authentication to **Basic**; Digest will not work.

TrueNAS SCALE removed the built-in service in 23.10 (Cobia); install the WebDAV app from its
catalog (or Nextcloud) and use the address the app shows. Neither lets you add the headers, so use
the no-headers route: copy the single file `jumpstart-3d.html` (or the contents of `docs/`) into
the share and open it at the share's address. In the Your server tab, type the share's address, or
just `./designs/` for a folder next to the page, then `webdav` and its password. Because the page
and the folder share one address, no headers and no https are needed.

### Nextcloud

For Nextcloud the address is `https://<your host>/remote.php/dav/files/<your user>/<folder>/`. Use
an app password (Settings › Security); it also works with two-factor login. Nextcloud sends none of
the headers for WebDAV, so put a reverse proxy in front that adds them and answers OPTIONS before
Nextcloud sees it (the [nginx recipe](#nginx) shows the idea). The proxy also needs a body-size
limit like `client_max_body_size 64m;`, because nginx's 1 MB default refuses bigger designs.
Nextcloud slows down repeated failed logins, so check the password before clicking Connect again.

### Synology and other NAS boxes

A Synology or other NAS that serves WebDAV for JumpStart 3D is the same story as Nextcloud: it needs
a reverse proxy you control in front of it that adds the headers listed in
[What the server must allow](#what-the-server-must-allow) and answers OPTIONS before the NAS sees
it.

### Fill in the address for everyone

If you put the JumpStart 3D website on your own server (copy the contents of `docs/`), put a file
`storage.json` next to `index.html` containing `{ "webdav": "https://your.server/dav/jumpstart/" }`,
or a short address such as `"designs/"` (taken from where the page is). The page reads it the first
time the Your server tab is opened and only fills in the address field. Passwords never go in it.
An address someone has already typed and connected with wins over the file. `docs/` is rebuilt
every time, so the file lives on your server only.

The single file opened from your disk cannot read `storage.json`, so type the address. A page
opened from disk has no web address of its own, so the server has to allow every origin (`*`). The
saved password sits in the browser's storage for local files, which other local pages might be able
to read: use an app password you can revoke.

### Why not S3 or Windows shares

An S3 bucket needs a secret key that a web page would have to hold in the open, and browsers cannot
speak the Windows file-sharing protocol (SMB) at all. WebDAV works with a user name and a password
and runs on most NAS boxes and cloud drives.

## Build it yourself

This section is for building JumpStart 3D from source. You need [Node.js](https://nodejs.org/) 20
or newer.

### Build the app

```
git clone https://github.com/MaxSikorski/jumpstart-3d.git
cd jumpstart-3d
npm install
node build.mjs
```

`npm install` fetches esbuild (pinned to the version the author used), the Playwright test tool
and ws. The build writes the website to `docs/` and the single file to `dist/jumpstart-3d.html`.
Neither is committed on `main`. To try the website, serve `docs/` with any static server, for
example `npx serve docs`.

### Run the tests

The JumpStart 3D tests drive the real app in a headless browser, on both builds. Once, fetch the
browser with `npx playwright@1.62.1 install chromium`. Then, after a build, run `npm test`. After a
change that is meant to alter the geometry, run `npm run test:update` to record the new export
hashes. [test/README.md](test/README.md) has the rest.

### Where things are

The map of folders, the rules of thumb for changes and how to send a pull request are in
[CONTRIBUTING.md](CONTRIBUTING.md); the review process is in [REVIEW.md](REVIEW.md).

## License

JumpStart 3D is MIT licensed. The author released the source of version 2.0 under the MIT License
(on his first official site, https://sites.google.com/view/jumpstart-3d-creator/home, and in his
GitHub repository, https://github.com/classyapps2026/jumpstart3d). This repository's additions, by
Max Sikorski and the community, use the same license. The author's repository has the app source
but not the bundled libraries; this repository has both, so it builds on its own. The full text is
in [LICENSE](LICENSE); credit, history and third-party licenses are in [NOTICE.md](NOTICE.md).
