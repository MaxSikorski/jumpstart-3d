# JumpStart 3D

A browser-based parametric 3D CAD tool, somewhere between Tinkercad and a
real B-rep modeler. It runs entirely in the browser: no install, no server,
no account.

**Use it here:** https://maxsikorski.github.io/jumpstart-3d/

Or download the single-file build from the Releases page and open it in any
modern browser. It works offline apart from the Google Fonts it loads for its
UI.

Created by **J.Siwek**. See [NOTICE.md](NOTICE.md) for credit and licensing.

## What is in the box

- Beginner mode: drag shapes, group them, cut with holes (Manifold mesh booleans)
- Advanced mode: sketches, extrude, revolve, loft, sweep, fillet, chamfer,
  shell, patterns and a feature timeline (OpenCascade kernel running in a
  Web Worker)
- Chisel: clay-style sculpting
- FlexiGen: print-in-place articulated figures
- Mesh to STEP: turn STL or 3MF meshes into editable STEP solids
- Layer-by-layer print preview, section analysis, multi-filament colors
- Export to STL, OBJ, 3MF, STEP and DXF

## Repository layout

```
src/            editable source
  index.html    page shell, CSS and markup
  app.js        app bundle (minified; the original source was never published)
  worker.js     geometry worker
  occt-gz.wasm  OpenCascade kernel, gzipped
  tools/        helper pages embedded into app.js at build time
  vendor/       shared three.js builds used by the helper pages
build.mjs       builds docs/ and dist/
docs/           the GitHub Pages site (built output, committed)
dist/           single-file build (not committed; attached to releases)
tools/          extract.mjs (upstream file -> src/) and add-obj-export.mjs
```

## Building

```
node build.mjs
```

This writes `docs/` (split files, fast to load, served by GitHub Pages) and
`dist/jumpstart-3d.html` (one self-contained file that runs from disk).

To try the site locally:

```
uv run python -m http.server 8765 --directory docs
```

then open http://localhost:8765/.

## Changes from the original 1.93.8 file

- The site build loads the 7 MB kernel and the worker as separate files
  instead of base64 inside the HTML, so the first page load is about 2 MB
  instead of 14 MB. The single-file build still works offline.
- The three helper pages share two three.js files instead of each carrying
  its own copy.
- Added OBJ export (Open/Export menu).
- The app code is otherwise byte-for-byte the original.

The repository keeps the upstream single files as received: `jumpstart_3d_v1.91.html`
and `jumpstart_3d_v1.93.8.htm`. `src/` is extracted from the newest one.

Do not edit `src/app.js` in the GitHub web editor. It has lines over a
megabyte long and the editor will blank the file.
