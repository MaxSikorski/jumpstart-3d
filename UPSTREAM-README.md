# JumpStart 3D v2.0: complete source code

Everything needed to rebuild JumpStart 3D v2.0 (with the Mac / iPad / iPhone work, the open-source credits, and 18 step-by-step tutorials (two of them for the Lathe) with built-in animations) is here: the app's own code, every third-party library and font that goes into it, the geometry engine, the build scripts and the test scripts.

New in v2.0: **3D Sketch** (`app/src/sketch3d.js`), the **Lathe** (`app/src/lathe.js`) and **Jump Brick Builder** (`app/src/bricks.js`, in Advanced → Simulate). The version number shown on the splash screen and in About comes from `app/src/version.js` (and the splash line in `app/src/index.html`).

Building from this folder gives the same app as the released `jumpstart_3d_v2.0.htm`. The only differences are the size number used by the loading bar and the file labels in two license comments.

## What's where

| Folder | What it is |
|---|---|
| `app/src/` | The JumpStart 3D app: interface, Beginner, Advanced, Chisel bridge, sketching, CAD features, Projector, Media, Picture to 3D, printing sim, tutorials (`tutorial_data.js`, `tutorials.js`, `tutorial_anims.js`), Safari / iPad support, etc. Plain JavaScript modules plus `index.html` (layout and styles). |
| `app/tools/` | Chisel, FlexiGen and Mesh to STEP: their original source pages (`*-source.html`), the add-on modules written for Chisel (`chisel_*.js`: CAD tools, view cube, characters, textures, MP4 writer, Puppet Animator), and the Python scripts that combine them into the app (`make_*.py`). |
| `app/fontsub/` | The three font subsets used by the Text tool (also embedded in `src/fonts.js`). |
| `app/build.sh`, `app/dist.sh`, `app/standalone.py` | The build. |
| `app/test/dbg.js` | A debug entry point used by the test scripts. |
| `third_party/` | The open-source libraries, as used: three.js r169, replicad 1.1.0 (TypeScript source), replicad-opencascadejs 1.1.0 (the OpenCascade geometry engine: its JavaScript loader and the WebAssembly file), opentype.js 1.3.4 (source and built module), Flatbush, Flatqueue, and a small stand-in for `manifold-3d` (replicad can use it; JumpStart 3D doesn't). |
| `LICENSES/` | Full license texts of everything in `third_party/` and the fonts. |
| `THIRD-PARTY-NOTICES.md` | Who made each library and font, what it's used for, and its license. |
| `tests/` | The Playwright scripts used to test each version (reference only: they expect the app served at `http://localhost:8765/` and contain the paths of the machine they were written on). |

## Building

You need Python 3, Node.js 18 or newer, `gzip`, and a Bash shell (macOS, Linux, or Windows with WSL / Git Bash).

```bash
cd app
bash dist.sh          # builds dist/ (index.html, app.js, worker.js, occt-gz.wasm)
python3 standalone.py # makes jumpstart-3d.html: the whole app in one file
```

The build finds the libraries in `third_party/` next to `app/`, so keep the two folders side by side. It uses an `esbuild` on your PATH if there is one, otherwise esbuild 0.28.2 through `npx` (downloaded on first use). To use a particular esbuild:

```bash
ESBUILD=/path/to/esbuild bash dist.sh
```

To try it, open `app/jumpstart-3d.html` in a browser, or serve `app/dist/` with any web server (`python3 -m http.server` inside `app/dist`) and open `index.html`.

The build steps, in order:

1. Compress the geometry engine (`third_party/replicad-opencascadejs/dist/replicad_single.wasm`) into `dist/occt-gz.wasm`.
2. Bundle three.js for the embedded tools, then build FlexiGen, Mesh to STEP and Chisel from `tools/` into `src/flexigen.html`, `src/meshstep.html` and `src/chisel.html`.
3. Bundle `src/app.js` (the app) and `src/worker.js` (the geometry engine's worker).
4. `standalone.py` puts the page, the app, the worker and the engine into one HTML file.

## The geometry engine (LGPL)

The CAD engine is Open CASCADE Technology, compiled to WebAssembly by the opencascade.js project, in the custom build that replicad publishes as `replicad-opencascadejs`. It is licensed under the GNU Lesser General Public License 2.1 (`LICENSES/LGPL-2.1-opencascade.txt`).

The engine stays a separate file: `dist/occt-gz.wasm` in the web version, and its own block (`<script id="wp-occt">`) inside the single-file version. To use a different or modified build of the engine, replace `third_party/replicad-opencascadejs/dist/replicad_single.wasm` and `replicad_single.js` with your build and run the build again.

Source code for the engine:

- Open CASCADE Technology: https://github.com/Open-Cascade-SAS/OCCT
- opencascade.js (the WebAssembly build system): https://github.com/donalffons/opencascade.js
- The replicad build configuration: https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs

## Licenses

- **Third-party code and fonts:** MIT (three.js, replicad, opentype.js), ISC (Flatbush, Flatqueue), LGPL-2.1 (the OpenCascade engine), SIL Open Font License 1.1 (Poppins, Liberation, IBM Plex, Barlow). See `THIRD-PARTY-NOTICES.md` and `LICENSES/`. Keep these notices with any copy of the app you share.
- **The two Liberation font subsets** are renamed "JumpStart Serif" and "JumpStart Mono" inside the font files, because modified versions of OFL fonts may not use the original names.
- **JumpStart 3D's own code** (`app/`): released under the MIT License (see `LICENSE`): you're free to use, copy, modify and share it, for any purpose. It includes open-source libraries and fonts under their own licenses (MIT, ISC, LGPL-2.1 for the OpenCascade geometry engine, and the SIL Open Font License). Their notices are in `THIRD-PARTY-NOTICES.md` and `LICENSES/`; please keep them with any copy you share.
