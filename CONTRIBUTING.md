# Contributing to JumpStart 3D

Thanks for helping. This page covers three things: reporting a bug, asking
for a feature, and changing the code. If you only want to use the app, you
do not need any of this; see the [README](README.md). Questions and
pictures of what you made go in
[Discussions](https://github.com/MaxSikorski/jumpstart-3d/discussions),
not here.

## Reporting a bug

Open an issue at https://github.com/MaxSikorski/jumpstart-3d/issues and
include:

1. **Which version.** The website, or the downloaded file? If the file,
   which release you got it from (the app itself does not show a version
   number).
2. **Browser and computer.** For example "Chrome 130 on Windows 11" or
   "Safari on an iPad". The app runs entirely in the browser, so this is
   usually the key detail.
3. **Steps to reproduce.** What you clicked, in order, starting from a new
   design if possible.
4. **What happened and what you expected.** A screenshot or short screen
   recording helps a lot.
5. **A project file, if you can.** Open/Export, then "Project file" saves a
   `.json` you can attach. It lets us see exactly what you were building.
6. **Anything in the browser console.** Press F12 (or Cmd+Option+J on Mac),
   click Console, and copy any red text.

One bug per issue. If you are not sure it is a bug, open the issue anyway.

## Asking for a feature

Open an issue and describe the problem you are trying to solve, not only the
feature you have in mind. "I can't line up holes evenly along an edge" tells
us more than "add a linear pattern option". If another CAD program does it
well, say which one and how.

Keep in mind the app's purpose: a simple CAD tool that runs in a browser
with no install. Ideas that need a server, an account, or a plugin system
are unlikely to fit.

## Changing the code

### How the code is laid out

The app is plain JavaScript modules under `src/`, from the author's source
release of version 2.3, and one command bundles them. The README's
"[Build it yourself](README.md#build-it-yourself)" section has the build and
test commands. The map of folders and the rules of thumb are below.

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
src/printerpresets.js where each bed size came from (added to the rows of printsim.js's printer list) and the saved Printer plate choice
src/printerpreview.js our Printer plate dialog and the red overhang shading in the design view
src/overhang.js     the one overhang rule, shared by the design view and the 3D Print Sim
src/params.js       our named parameters (evaluator and the dimension and feature hooks)
src/bridge.js       our scripting bridge, `window.JS3D` (see BRIDGE.md)
src/runscript.js    our "Run script…" menu entry (runs a .js file with JS3D in scope)
src/report.js       our "Report a problem" dialog (a prefilled GitHub bug report link)
src/sharelink.js    our Share link: a small design in a web address, and opening one (Open/Export › Share link…)
src/loadui.js       our loading note over the 3D view, and the start of the offline copy on the website
src/sw.js           our service worker: the website's offline copy (the site build only)
src/remote.js       our Your server tab in Your designs (designs on a WebDAV server)
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
docs/               built website: not on `main` (gitignored); the maintainer's release step builds it onto the
                    `release` branch, which GitHub Pages serves
jumpstart_3d_v2.0.htm      historical upstream v2.0 build (src/ now uses 2.3)
UPSTREAM-README.md         the author's README from the source release
```

### Rules of thumb

- After any change run `node build.mjs`, then `npm test`, then try both
  outputs yourself: the site in a browser and `dist/jumpstart-3d.html` opened
  from disk. The local site keeps its service worker, so after a rebuild reload
  twice: the first reload shows the old build and the "new version" message.
- Do not commit `docs/` or `dist/`. Pull requests carry source only: the
  maintainer's release step builds `docs/` onto the `release` branch (the
  site) and attaches the single file to the release.
- Keep "Created by J.Siwek" in the About dialog. Our additions are listed in the README, not claimed as the original.

### The short version

1. Fork the repository and clone your fork.
2. Make a branch for your change.
3. Edit the files under `src/`. Our own additions live in their own module
   where that is possible (`src/meshdetail.js`) or in a short, commented block
   next to the upstream code they extend (the OBJ exporter in
   `src/projects.js`), so a future upstream version is easy to merge.
4. Run `npm install` once, then `node build.mjs`.
5. Test both outputs: serve `docs/` and try it in a browser, and open
   `dist/jumpstart-3d.html` from disk by double-clicking it. At minimum,
   drag a box, run a fillet in Advanced mode, export an STL, and open each
   of the three helpers (Chisel, FlexiGen, Mesh to STEP). Check the browser
   console for errors.
6. Commit only your source change. `docs/` and `dist/` are build output and
   are not committed on `main` (CI refuses a pull request that adds `docs/`);
   the maintainer's release step builds the site onto the `release` branch.
7. Open a pull request. Say what you changed, why, and what you tested.

### Things we will ask you to keep

- **The credit.** "Created by J.Siwek" in the About dialog stays. Our own
  additions are listed in the README ("[What this repository adds on top of the original](README.md#what-this-repository-adds-on-top-of-the-original)"), not claimed as the original.
- **One file, no install.** Any change must still work from the single
  offline file as well as the website.
- **Small, focused pull requests.** One fix or one feature per PR is much
  easier to review and to revert if something goes wrong.
- **Plain English** in commit messages and PR descriptions. Many of the
  people here are makers, not professional developers.

### Updating to a new upstream version

If the author publishes a newer source release, put the untouched files in
the repository root, copy its `app/src` over `src/` and its `third_party`
over `third_party/`, re-apply the commits that hold our additions (git
shows them: `git log -- src/meshdetail.js src/projects.js`), rebuild and
test as above. If only a built single file appears, open an issue; building
from the minified file again is possible but is a different job.

## Questions

If something here is unclear, open an issue with the "question" label. An
unclear guide is a bug too.
