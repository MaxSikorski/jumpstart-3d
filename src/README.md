# src/: who owns which file

Read this before editing a file here or merging a new release from J.Siwek.
The app is his MIT-licensed JumpStart 3D plus our additions (AGPL-3.0-only from build 24, see `NOTICE.md`).
Every change we make inside his code is a short block marked `// jumpstart-3d:`, so a new release can merge around it.
Counts below are `grep -c "jumpstart-3d:"` as of build 24; re-check with that command.

## 1. Ours: own modules, edit freely
Files J.Siwek never shipped. Their first line usually says what they do. Keep them separate; do not fold them into his files.

| File | What it does |
|---|---|
| `dragarrow.js` | Shared outlined pull arrow for Extrude and Offset face: theme colours, pixel sizing and shaft/head picking |
| `meshdetail.js` | Mesh detail menu: Normal, Fine, Extra fine, custom up to 32x |
| `params.js` | Named parameters that drive sketch and feature sizes |
| `projstore.js` | Designs kept in IndexedDB, with a localStorage fallback |
| `folder.js` | Copies of designs in a folder the user picks |
| `backupnudge.js` | Single file only: when online and a design changed since its last backup, a quiet once-a-day note offers a backup file or folder copies (reuses `backupAll` and `folder.choose`); `shouldAsk` is the pure rule; hooked in `app.js` after `projects.start()` |
| `remote.js` | "Your server" tab: designs on a WebDAV server |
| `sharelink.js` | Share link: a small design inside a web address |
| `holepattern.js` | Rows, staggered rows or a circle of holes on a face |
| `fillopen.js` | Fill openings, the geometry: finds the openings in a flat face (vents, slots, holes, logos) and rebuilds the part's faces without them, no boolean; runs in the worker and in Node |
| `fillopenings.js` | Fill openings, the panel: click a flat face, outlines of every opening, click one to keep it open, Fill; one `fillopen` feature, editable from the timeline |
| `fillpick.js` | Plain helpers for that panel (`openingAt`: which opening is under a point; the keep-open matching), with no DOM so Node tests import them |
| `facebox.js` | Box on face (Beginner): click a flat face, drag a rectangle with live sizes, set the height (out, into or both ways); adds a plain box body on the face |
| `gears.js` | Spur, rack and bevel gears |
| `nameplate.js` | A plate sized to its text, raised or cut in |
| `knurl.js` | Knurled knobs |
| `spring.js` | Compression springs |
| `sketchmirror.js` | Sketch Mirror (M, Modify group): copies picked shapes across a line, the X or Y axis or the origin; `mirrorEnts` is the pure maths, the rest is the tool's clicks and panel box |
| `sketchsolve.js` | Sketch solver: one least-squares solve over the whole sketch, the rank count of what is still free (`sketchDof`), and the plain-English clash words; `editVerdict` (refuse, keep with a note, or allow an old clash to stay); `constraints.js` re-exports it in one marked block |
| `badgelayout.js` | Constraint badges: where each sits on screen (`layoutBadges`) so none lands on another badge, a corner or a dimension label; pure maths, no DOM |
| `bridge.js` | `window.JS3D`, the scripting API (see `BRIDGE.md`) |
| `runscript.js` | Open/Export > Run script... |
| `chat.js`, `chattools.js`, `chatproviders.js` | Chat inside the app: panel, tools, four model providers |
| `loadui.js` | Engine-load note, splash, service-worker registration |
| `helperfonts.js` | Gives a helper page (FlexiGen, Mesh to STEP, Chisel) the self-hosted fonts and inserts the shared three.js (`withFonts(html, three)`) |
| `morefonts.js` | J.Siwek's 42 extra Text fonts: reads his `fonts_more.js` as data (`helperAsset`; a "precache" helper file the service worker saves after the engine is ready), registers them on the page and in the worker when first needed; a font picker starts the load and lists them once they are in (keeping its body's font); a body whose text uses an extra font waits for them in the queue (`kernel.waitFor`, memoised per body key), others do not; a failed load gives one toast and the text builds in Rounded sans, and when a later picker gets the fonts that text is built again |
| `helperpages.js` | Helper pages and helper data load on demand. `helperAsset("<file>")` returns the text of `helpers/<file>` (`Promise<string>`, any file type: the caller parses it): inline in the single file, else fetched once from the site's `helpers/` folder (it gives up after 30 s without data; if the network fails it tries the service worker's cache, which covers the first visit before the worker controls the page) and kept in memory. A failure is a plain `Error` and is forgotten, so a retry starts fresh. Each file on the site starts with a `js3d-build:<id>` line; an id other than the app's gives an error with `skew: true` (`helperFailText` turns it into "A newer version was installed: reload"). `helperPage("chisel" \| "flexigen" \| "meshstep")` is a page plus the shared three.js and the fonts, ready for `srcdoc`. `helperLoadingNote(onClose)` is the "Loading…" label with a Close button and Escape; `note.done()` removes it. To add a page or data file: put it in `src/`, list it in `tools/helper-files.mjs` with a mode (`"precache"`: the service worker saves it at install, for offline; `"on-use"`: saved the first time it is fetched), then import it in `helperpages.js` and add it to `INLINE`. The site's `app.js` gets the import as `""`, the single file the text. The call sites in `chisel.js`, `flexigen.js` and `meshstep.js` are one marked block each |
| `report.js` | Report a problem (prefilled GitHub issue link) |
| `gltf.js`, `paint3mf.js`, `objimport.js` | glTF export, pre-painted 3MF, OBJ import |
| `combinesplit.js` | Group and Combine leave one body per new piece, and say so when a cut removed nothing (`cutRemovedNothing`) |
| `pieces.js` | What counts as a near-empty film among the pieces of a cut (thickness test) |
| `directedit.js` | Direct edit: a finished sketch's shape lights up under the pointer; a click opens Extrude on it, a drag pulls it up or down (a shape drawn on a body, pulled down, cuts it); the idle handlers of both modes call it, the Extrude panel does the work |
| `pivot.js`, `fineturn.js`, `rotationui.js` | Movable pivot, status-bar Turn control, shared rotation helpers |
| `perfpanel.js` | Hidden rebuild-times panel (Ctrl+Alt+P or `?perf`) |
| `dropimport.js` | Drop a model file anywhere on the page: "Drop to import" note, then `app.advanced.openModelFile` (the Import button's own entry); also guards the Chisel, FlexiGen and Mesh to STEP frames |
| `insertpart.js` | Supplier links, a model drop card and optional watching of a chosen folder for downloaded parts |
| `sendslicer.js` | Send to slicer (Open/Export menu): the Export > 3MF bytes handed to the slicer: a download on a computer, the share sheet on a phone or tablet that can share files; a one-time tip on making .3mf open in OrcaSlicer, PrusaSlicer, Cura or Bambu Studio |
| `importtoast.js` | Import units: a closed mesh of known units (3MF, OBJ and STL from 6 mm up) comes in at once; the note with its size, repairs and mm / cm / in buttons (one undo step); the dialog stays for open or non-manifold meshes and STL or OBJ under 6 mm; the note also has a CAD faces… shortcut to Mesh to STEP |
| `stepload.js` | Checked STEP transfer, one fresh-reader healing retry, scoped build stages, Normal-only dense STEP angular policy; all face centers remain exact |
| `stepprogress.js` | STEP import sessions, stage/elapsed panel, current-mesh completion checks and timeout formatting |
| `meshpreview.js` | Import preview: an imported mesh shows at once as a see-through "Preparing…" copy of the file's own triangles while the solid is built; display only, so every tool still sees an unbuilt body |
| `overhang.js`, `printerpresets.js`, `printerpreview.js` | Overhang rule, printer list labels and saved plate, plate and overhang shading |
| `tutorial_data_community.js` | Community tutorials (built on his `tutorial_data.js`) |
| `meshbool.js` | Joins, cuts and combines that involve an imported mesh run on Manifold (triangle-mesh engine, `third_party/manifold-3d/`) instead of OpenCascade. `startManifold()` / `manifoldReady()` load it (the worker starts it on a mesh asset; a failed or 15 s stuck start ends in a kept error and OpenCascade does the booleans); `kernel.js` calls it from marked blocks (`import` + `initMeshBool`, the top of `evalNode`, `buildBodies`, `clearCache`). `meshBody` draws a meshy body from a Manifold (`meshEngine: "manifold"`); `meshBrep` builds a B-rep from it on demand; a refusal runs today's OpenCascade code (`meshEngine: "occt-fallback"`). Corners of a moved operand go back to the decimal they were written as, through the matrix in doubles, to float32 once (so a moved mesh still meets a box set on its face); `simplify(1e-5)`, cavities kept with the solid around them, closed-by-position check, films dropped |
| `sw.js` | Service worker, site only (see section 4) |

## 2. J.Siwek's, with our marked blocks
Edit only as short `// jumpstart-3d:` blocks next to his code. Most markers: `advanced.js` 153, `projects.js` 60, `app.js` 63, `beginner.js` 43, `index.html` 35, `kernel.js` 21, `printsim.js` 15, `viewport.js` 13, `kernelClient.js` 12, `store.js` 10, `sketcher.js` 14.
`fasteners.js` (since 2.8.1.3 his Fasteners parts library, `fastenerCmd` in `advanced.js`): our marked blocks add UNF sizes, the tap cutter, left-hand threads and the ISO minor-diameter nut bore, and at the bottom our `JS3D.fastener` builder (bolt, nut, threaded rod, tap cutter: its own tested shapes); the dialog's print offset per part, hand, turns guard and F8 spacing are marked blocks in `fastenerCmd`.
Few markers (1 to 5): `inflate.js`, `icons.js`, `tutorials.js`, `tutorial_data.js`, `dims.js`, `facepat.js`, `meshimport.js`, `ops.js`, `voxel.js`, `constraints.js`, `lathe.js`, `recovery.js`, `scene.js`, `worker.js`, `version.js`.
`kernel.js` also holds our boolean fix (with one in replicad's `operations.ts`); `version.js` holds the community build number that `/ship` bumps.

## 3. J.Siwek's, untouched
No markers. On a port, take his new version whole. Do not "tidy" these.
`arch.js`, `archflood.js`, `archland.js`, `archplan.js`, `archweather.js`, `tutorial_arch.js` (Architect), `cam.js`, `camcore.js`, `camworker.js` (CAM Studio), `cosbody.js`, `coscut.js`, `cosforge.js`, `cosmesh.js`, `cosparts.js` (CosForge, from 2.6), `carve.js` (Chip Carving, from 2.7.5), `sdfshell.js` (Shell for any shape, from 2.7.7), `bins.js` (Bin & Box Maker), `hinges.js` (Quick Hinge), `gcode.js` and `motion.js` (3D Print Sim G-code and Orca-style print times), `sglass.js` and `stainedglass.js` (Stained Glass Studio), `archwin.js` (Architect windows), `floorplan.js` (Floor Planner window), `fonts_more.js` (the 42 extra Text fonts, made by `tools/make_fonts.py`; all from 2.7.8 to 2.8.1.3), `appearance.js`, `bricks.js`, `chisel.js`, `dxf.js`, `fea.js`, `flexigen.js`, `fonts.js`, `importers.js`, `licenses.js`, `measure.js`, `media.js`, `meshstep.js`, `pipecoil.js`, `projector.js`, `puffy.js`, `regions.js`, `render.js`, `section.js`, `simulate.js`, `sketch3d.js`, `textgeo.js`, `texture.js`, `theme.js`, `thickline.js`, `trace.js`, `tutorial_anims.js`, `tutorial_data_more.js`, `units.js`, `util.js`; the `fontsub/` fonts.

## 4. Special files
- `occt-gz.wasm` (7.2 MB): the OpenCascade kernel, gzipped. The worker fetches it on the site; the single file carries it as base64. If upstream's wasm changes, `tools/upstream-merge.mjs` only reports it: re-gzip with `gzip -9 -n`.
- `../third_party/manifold-3d/`: the Manifold engine (manifold-3d 3.5.4), vendored: the package's glue, its wasm as a gzipped base64 string in `wasm.js`, our loader `index.js`. It rides inside `docs/worker.js` and the single file (about +225 KB gzipped); `build.mjs` and `sw.js` needed no change. Regenerate with `tools/vendor-manifold.mjs`; the README there has the hashes.
- `floorplan.html` (1 MB, from 2.8.1.2) and `fonts_more.js` (1.9 MB): helper files (`tools/helper-files.mjs`), not in the site's `app.js`; the single file has them inline. `fonts_more.js` is "precache" (the service worker saves it quietly once the engine is ready; the page reads it when a font is needed, `morefonts.js`), `floorplan.html` is "on-use" (fetched the first time the Floor Planner opens, `floorplan.js`, marked block). `floorplan.html` is the Floor Planner page with three.js r128 built in, made by `tools/make_floorplan.py` (see `tools/README-helpers.md`); nothing in it loads from the web.
- `flexigen.html`, `meshstep.html`, `chisel.html`: built helper pages, with `helper-three.html` as the generated shared three.js, all committed. The single file carries them inline; the site's `app.js` does not: `build.mjs` writes them to `docs/helpers/`, `helperpages.js` fetches each the first time it opens, and `sw.js` caches them after the engine is ready (offline works; "on-use" files are cached when first fetched). Rebuild steps: `tools/README-helpers.md`.
- `sw.js`: site only. `build.mjs` copies it to `docs/sw.js` with a version hash and fills `FONTS`, `HELPERS` and `ON_USE` with the files in `docs/fonts/` and `docs/helpers/`. Never remove it from the site (a 404 keeps the old worker serving its cache forever).
- `camworker.js`: `build.mjs` bundles it in memory for CAM Studio's Blob worker. `camworker.bundle.txt` is gitignored; a stale copy can never win.
- Images, `manifest.webmanifest`, `webfonts.css`, `fonts/`: static assets that the build copies.

## 5. How a new upstream release comes in
```
node tools/upstream-merge.mjs --base <last source zip> --new <new source zip>
```
It three-way merges each file (his old, our current, his new) in a new `upstream-<version>` worktree, never commits, and writes a plain-English report. Add `--dry-run` to look first. The source zips live on the `upstream-originals` GitHub release (latest: 2.5.1). After a merge: resolve conflicts around our markers, `node build.mjs`, `npm test`.
