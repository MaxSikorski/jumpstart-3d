# src/: who owns which file

Read this before editing a file here or merging a new release from J.Siwek.
The app is his MIT-licensed JumpStart 3D plus our additions (AGPL-3.0-only from build 24, see `NOTICE.md`).
Every change we make inside his code is a short block marked `// jumpstart-3d:`, so a new release can merge around it.
Counts below are `grep -c "jumpstart-3d:"` as of build 24; re-check with that command.

## 1. Ours: own modules, edit freely
Files J.Siwek never shipped. Their first line usually says what they do. Keep them separate; do not fold them into his files.

| File | What it does |
|---|---|
| `meshdetail.js` | Mesh detail menu: Normal, Fine, Extra fine, custom up to 32x |
| `params.js` | Named parameters that drive sketch and feature sizes |
| `projstore.js` | Designs kept in IndexedDB, with a localStorage fallback |
| `folder.js` | Copies of designs in a folder the user picks |
| `remote.js` | "Your server" tab: designs on a WebDAV server |
| `sharelink.js` | Share link: a small design inside a web address |
| `fasteners.js` | Bolts, nuts, threaded rods, tap cutters |
| `holepattern.js` | Rows, staggered rows or a circle of holes on a face |
| `gears.js` | Spur, rack and bevel gears |
| `nameplate.js` | A plate sized to its text, raised or cut in |
| `knurl.js` | Knurled knobs |
| `spring.js` | Compression springs |
| `bridge.js` | `window.JS3D`, the scripting API (see `BRIDGE.md`) |
| `runscript.js` | Open/Export > Run script... |
| `chat.js`, `chattools.js`, `chatproviders.js` | Chat inside the app: panel, tools, four model providers |
| `loadui.js` | Engine-load note, splash, service-worker registration |
| `helperfonts.js` | Gives the helper pages (FlexiGen, Mesh to STEP, Chisel) the self-hosted fonts |
| `report.js` | Report a problem (prefilled GitHub issue link) |
| `gltf.js`, `paint3mf.js`, `objimport.js` | glTF export, pre-painted 3MF, OBJ import |
| `combinesplit.js` | Group and Combine leave one body per new piece |
| `pivot.js`, `fineturn.js`, `rotationui.js` | Movable pivot, status-bar Turn control, shared rotation helpers |
| `perfpanel.js` | Hidden rebuild-times panel (Ctrl+Alt+P or `?perf`) |
| `overhang.js`, `printerpresets.js`, `printerpreview.js` | Overhang rule, printer list labels and saved plate, plate and overhang shading |
| `tutorial_data_community.js` | Community tutorials (built on his `tutorial_data.js`) |
| `sw.js` | Service worker, site only (see section 4) |

## 2. J.Siwek's, with our marked blocks
Edit only as short `// jumpstart-3d:` blocks next to his code. Most markers: `advanced.js` 135, `projects.js` 60, `app.js` 58, `beginner.js` 43, `index.html` 35, `kernel.js` 21, `printsim.js` 15, `viewport.js` 13, `kernelClient.js` 12, `store.js` 10, `sketcher.js` 7.
Few markers (1 to 5): `inflate.js`, `icons.js`, `tutorials.js`, `tutorial_data.js`, `dims.js`, `facepat.js`, `meshimport.js`, `ops.js`, `voxel.js`, `constraints.js`, `lathe.js`, `recovery.js`, `scene.js`, `worker.js`, `version.js`.
`kernel.js` also holds our boolean fix (with one in replicad's `operations.ts`); `version.js` holds the community build number that `/ship` bumps.

## 3. J.Siwek's, untouched
No markers. On a port, take his new version whole. Do not "tidy" these.
`arch.js`, `archflood.js`, `archland.js`, `archplan.js`, `archweather.js`, `tutorial_arch.js` (Architect), `cam.js`, `camcore.js`, `camworker.js` (CAM Studio), `appearance.js`, `bricks.js`, `chisel.js`, `dxf.js`, `fea.js`, `flexigen.js`, `fonts.js`, `importers.js`, `licenses.js`, `measure.js`, `media.js`, `meshstep.js`, `pipecoil.js`, `projector.js`, `puffy.js`, `regions.js`, `render.js`, `section.js`, `simulate.js`, `sketch3d.js`, `textgeo.js`, `texture.js`, `theme.js`, `thickline.js`, `trace.js`, `tutorial_anims.js`, `tutorial_data_more.js`, `units.js`, `util.js`; the `fontsub/` fonts.

## 4. Special files
- `occt-gz.wasm` (7.2 MB): the OpenCascade kernel, gzipped. The worker fetches it on the site; the single file carries it as base64. If upstream's wasm changes, `tools/upstream-merge.mjs` only reports it: re-gzip with `gzip -9 -n`.
- `flexigen.html`, `meshstep.html`, `chisel.html`: built helper pages, committed and imported as text. Rebuild steps: `tools/README-helpers.md`.
- `sw.js`: site only. `build.mjs` copies it to `docs/sw.js` with a version hash. Never remove it from the site (a 404 keeps the old worker serving its cache forever).
- `camworker.js`: `build.mjs` bundles it in memory for CAM Studio's Blob worker. `camworker.bundle.txt` is gitignored; a stale copy can never win.
- Images, `manifest.webmanifest`, `webfonts.css`, `fonts/`: static assets that the build copies.

## 5. How a new upstream release comes in
```
node tools/upstream-merge.mjs --base <last source zip> --new <new source zip>
```
It three-way merges each file (his old, our current, his new) in a new `upstream-<version>` worktree, never commits, and writes a plain-English report. Add `--dry-run` to look first. The source zips live on the `upstream-originals` GitHub release (latest: 2.5.1). After a merge: resolve conflicts around our markers, `node build.mjs`, `npm test`.
