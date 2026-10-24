# JumpStart 3D v2.7.3: complete source code

Everything needed to rebuild JumpStart 3D v2.7.3 (with the Mac / iPad / iPhone work, the open-source credits, and 38 step-by-step tutorials (two of them for the Lathe) with built-in animations) is here: the app's own code, every third-party library and font that goes into it, the geometry engine, the build scripts and the test scripts.

New in v2.7.3: round faces that the mesher drew wrongly (long triangles cutting across the part, seen as stray planes after an extrude, offset or cut) are now checked against the true surface and redrawn (`repairFaceMeshes` in `app/src/kernel.js`), and Pattern → Features picks features by clicking their faces on the model or in the timeline, with blue/orange outlines instead of selecting the whole body (`patternCmd` in `app/src/advanced.js`).

From v2.7.1: a **Modern Sci-Fi** CosForge style (`modernSet()` in `app/src/cosparts.js`): 27 original hard-surface templates whose angular shapes come from preset form cages (`fp`, `helmForm`, `vChest`, `ridgeLimb`, `peakDome`), glowing light lines and emblems (the `glow` and `emblemGlow` details mark outside faces for the accent colour through `buildShell` in `app/src/cosmesh.js`), and an angled-eyes helmet opening.

From v2.7: CosForge gains a **Form** step: a control cage over any part, like the form tools in CAD (`formD`, `cageUV` in `app/src/cosparts.js` blend each control point's 3D move across the part with Catmull-Rom, or straight when creased; the part's surface function is wrapped, so outlines, details, add-ons, cuts and joints all follow). The window side (`panelForm`, `drawCage`, `deform`, the arrow gizmo and picking in `app/src/cosforge.js`) has point, edge, face, row and column selection, drag arrows (X, Y, Z, along the surface) and a free-move ball, Pull out / Push in, Move, Scale, Rotate, Flatten, Make smooth, symmetry, soft selection, fewer/more points and subdivide. 26 more templates (almost 100), a **collar (gorget)** part that follows the shoulders up to the neck, and a lower-face mask. Tests: `tests/cf_form.cjs`, `tests/cftest.cjs` (now with form edits), `tests/cosforge-node.sh cf_pieces`.

From v2.6: **CosForge**, a cosplay costume designer that opens in its own window (Advanced → Simulate → CosForge, or the CosForge button in Beginner). `app/src/cosbody.js` builds a mannequin from 17 tailor's measurements (five presets, three poses) out of segments with rounded cross-sections, and measures how far any point is from the body. `app/src/cosparts.js` holds over 70 templates in Sci-Fi, Fantasy, Comic Hero, Steampunk, Samurai and Basic styles for 17 kinds of part; each part is a thin shell over a surface that follows the body (a body segment, a dome over a joint, or the head), trimmed by a 2D outline and kept clear of other body parts, with edges, ridges, panel lines, textures, muscles, emblems, rivets and add-ons (horns, fins, plates, gems, goggles...). `app/src/cosmesh.js` is the masked-grid shell builder (marching-squares outlines, watertight walls) and the small solids. `app/src/coscut.js` cuts parts with capped flat cuts, keeps add-ons with their shell, adds peg, snap, slide-in dovetail or magnet joints on the inside of each cut, checks pieces against eight printer beds and works out automatic cuts. `app/src/cosforge.js` is the window (Body, Parts, Shape, Fit, Sculpt, Cut & Join, Export), with sculpting maps, fit check, undo, STL/3MF/OBJ export, costume files, and Add to my design; the costume is kept in the design as `doc.cosforge`. Tests: `tests/cftest.cjs` (end to end in the browser), `tests/rel_cf.cjs` (the single-file app), and `tests/cosforge-node.sh` with `cf_templates`, `cf_joints`, `cf_fit` and `cf_cuts` (engine only, in Node).

From v2.5.1: **CAM Studio** has 48 machine profiles in groups from desktop and hobby routers to industrial machining centers and lasers (`MACHINES`, `MACHINE_GROUPS` in `app/src/camcore.js`), Fanuc-style and Haas-style posts, more materials and bits, and custom machines with a rotary axis or tool changer. Toolpaths, G-code and the whole simulation now run in a Web Worker (`app/src/camworker.js`, bundled by `dist.sh` into `app/src/camworker.bundle.txt` and started from a Blob, so it also works in the single-file app); replay and scrubbing are time-sliced. Test: `tests/cam6.cjs` (responsiveness, machines, Fanuc output).

From v2.5: **Log cabins** in Architect: round-log and square-log (hewn, with chinking) wall types, logs crossing past outside corners (`logPieces`, `logWallMesh` in `app/src/arch.js`), sent to Beginner/Advanced as real cylinders and timbers. **Simulate** (Architect, key S): weather and moving water moved here, plus a **flood test** (`app/src/archflood.js`): a grid shallow-water model with rain, roof runoff to the walls, soaking by ground type, downhill flow and draining edges, or water rising from the edges of the land; it reports water against the floor and at each door and can raise the house on a graded pad. Seven more Architect tutorials (`app/src/tutorial_arch.js`): round-log cabin, square-log workshop, corner café, landscape basics, pond garden, flood test, house and landscape for printing. Tests: `tests/ar6.cjs` (log walls and flood test), `tests/tarch.cjs <id>` for all 12 Architect tutorials. **CAM Studio 4th axis** (`buildRotary` and `RotarySim` in `app/src/camcore.js`, the turning view in `app/src/cam.js`): rotary roughing and finishing by drop-cutter on a narrow height map at each angle, a radial-column simulation of the turning bar, A-axis G-code (new grblHAL / FluidNC post, four rotary machines); `tests/rot4.mjs` (engine, Node) and `tests/cam4.cjs`. **Roofs** sit on the walls under them and can follow the walls, be dragged (snapping to the walls) or nudged (`effRoof`, `roofZ`). **Wall colour** when raising, and wall outlines. **Floor plans** as PDF, SVG and DXF (`app/src/archplan.js`, no libraries); `tests/ar7.cjs`.

From v2.4: the Architechies mode is renamed **Architect**. Leaving Architect brings the house into Beginner/Advanced automatically, scaled to the largest standard scale that fits a 256 × 256 mm build plate (`transfer`, `autoSync`, `fitScale`, `buildingHash` in `app/src/arch.js`), and the camera returns to the home view near the origin; back in Architect the building is full size again. **Landscape** (Architect only, never transferred; `app/src/archland.js`, stored as `doc.arch.land`): a height grid with raise, lower, smooth, flatten, pond/lake digging that fills with water, removing water, ground painting (10 materials) 22 ground materials and 39 trees, shrubs, grasses, flowers and stones in four groups; a weather simulator (sunny, cloudy, rain, thunderstorm, snow, fog, wind) and moving water, each switchable, in `app/src/archweather.js` (display only). **Finishes** for walls, roofs and floors (colour, library texture, wall face patterns) become texture layers and `facepat` features when sent. **Export** of house and landscape together as 3MF (per-triangle colours, deflated), OBJ (vertex colours) or STL, scaled to fit the plate, with watertight ground and water solids. Face-pattern bodies now build one at a time with the longer time limit (`app/src/kernelClient.js`). Tests: `tests/ar4.cjs` (finishes, landscape, export, auto-transfer), `tests/ar5.cjs` (plants, grounds, weather, moving water).

From v2.3: **CAM Studio** (Advanced → Simulate): `app/src/camcore.js` is the CAM engine (machines, materials, bits, feeds and speeds, height-map drop-cutter toolpaths for roughing, finishing, facing and cutouts with tabs, laser cut and engrave, a height-field material-removal simulation, and G-code for GRBL, LinuxCNC, Mach3 and Marlin); `app/src/cam.js` is the window (Basic and Pro modes, playback, saving G-code, Web Serial streaming to GRBL/Marlin). The engine was written for JumpStart 3D using openly published methods (drop-cutter as in OpenCAMLib, height-field simulation as in CAMotics); no code from those projects is included. Architechies gained a feet-and-inches / metric switch and five tutorials (`app/src/tutorial_arch.js`). Tests: `tests/cam1.cjs`, `tests/camtest.mjs` (engine only, runs in Node), `tests/tarch.cjs <tutorial id>`.

From v2.2: **Architechies**, a fourth mode for houses and buildings (`app/src/arch.js`): floor plans (walls and rooms), raising walls, a catalog of doors and windows placed by snapping or typed on each wall's grid, see-through editing, roofs (gable, hip, shed, pyramid, barrel, flat), floors and levels, and Send to design, which turns the building into editable Beginner/Advanced shapes at a chosen scale (`buildingBodies`). The building is stored in the design as `doc.arch`. Tests: `tests/ar1.cjs`, `tests/ar2.cjs`, `tests/ar3.cjs`.

From v2.1.3: **Pattern on face** (Beginner toolbar → Face pattern; Advanced → Decorate → Pattern on face) raises or cuts hexagons, diamond plate, screen mesh, circles, triangles, knurl or ribs on a flat face as an editable feature (`facepat` in `app/src/kernel.js`, shapes in `app/src/facepat.js`, dialog `facePatternCmd` in `app/src/advanced.js`). 26 new textures in new Wood, Building and Fabric groups (`app/src/texture.js`). About has **Check for updates** and **Visit classyapps.org** buttons; the check reads `https://classyapps.org/jumpstart3d/version.json` (`SITE_URL` / `UPDATE_URL` in `app/src/app.js`). Tests: `tests/fp1.cjs`, `tests/fp2.cjs`, `tests/fp3.cjs`, `tests/tx1.cjs`, `tests/upd2.cjs`.

From v2.1.2: **Voxel Studio** (`app/src/voxel.js`, in Advanced → Simulate) turns objects into cubes you can paint face by face, add and remove, then export as STL or a colored 3MF or add to the design (one part per color). The arrow keys now move objects the way they look on screen, whatever the camera angle or the object's rotation (`app.arrowDelta` in `app/src/app.js`, used by Beginner, Advanced and the Move tool); `,` and `.` turn by 1° after a rotation arc. `tests/vx1.cjs` checks Voxel Studio and `tests/arr.cjs` checks the arrow keys from 12 camera angles.

From v2.1.1: 20 more tutorials (10 Beginner, 10 Advanced, from Easy to a new Expert level) in `app/src/tutorial_data_more.js`; `tests/tnew.cjs` drives each one through the app.

From v2.1: easier text in Advanced. **3D text** (Create → Primitives → 3D text, `textCmd` in `app/src/advanced.js`) lies on any face or the workplane and can be dragged across faces, snapping to face centers and the grid or moving freely. **Emboss text** (`embossCmd`) can now be dragged across the body, with the same snapping, Across / Up offsets from the face center and arrow-key nudging. **Sketch text** (`app/src/sketcher.js`) keeps the grab point while dragging, snaps its middle to the face center and other points, nudges with the arrow keys and has Center on face buttons. `tests/t21.cjs` checks all three.

From v2.0: **3D Sketch** (`app/src/sketch3d.js`), the **Lathe** (`app/src/lathe.js`) and **Jump Brick Builder** (`app/src/bricks.js`, in Advanced → Simulate). The version number shown on the splash screen and in About comes from `app/src/version.js` (and the splash line in `app/src/index.html`).

Building from this folder gives the same app as the released `jumpstart_3d_v2.7.3.htm`. The only differences are the size number used by the loading bar and the file labels in two license comments.

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
