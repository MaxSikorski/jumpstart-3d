# The scripting bridge: `window.JS3D`

The app puts one object, `window.JS3D`, on the page. A script, the browser
console, a Playwright test or a tool server can use it to build shapes, change
them, read their size and volume, and export files, the same way a person does
with the mouse. It does nothing until something calls it.

It works the same in the website and in the single file
(`dist/jumpstart-3d.html`). The code is `src/bridge.js`; `tools/bridge-demo.js`
is a worked example; `test/bridge.spec.mjs` tests every call on both builds.

This file has two parts:

1. [The `JS3D` calls](#part-1-the-js3d-calls)
2. [The project file format](#part-2-the-project-file-format)

## Try it in two minutes

1. Open the app (https://maxsikorski.github.io/jumpstart-3d/ or the single file).
2. Save `tools/bridge-demo.js` to your computer (on GitHub, open the file and
   use the download button).
3. Open/Export › **Run script…** and pick that file. A block with a hole appears,
   and a message at the bottom says "Script finished" with the demo's summary
   (volume, file sizes, whether saving and reloading gave the same shape). The
   demo starts a new design, so run it on a fresh page.

A script run this way has `JS3D` and `app` in scope, can use `await` at the
top level and can end with `return` to show a value in the message. If it
fails, the error shows in red. It runs with the same trust as text pasted into
the browser console: it is your own file, running in your own page, and
nothing runs unless you pick a file (no web address parameter, no auto-run).

The console path still works, and is handy for single calls: open the browser
console (Chrome and Edge, F12 or Ctrl+Shift+J, Mac: Cmd+Option+J; Firefox,
Ctrl+Shift+K; Safari, turn on the Develop menu in Settings, then Cmd+Option+C),
paste the whole demo and press Enter, or type calls one at a time:

```js
const id = JS3D.add("box", { size: { w: 40, d: 30, h: 20 } });
await JS3D.ready();
JS3D.get(id).volume;        // 24000
```

## Part 1: The `JS3D` calls

### Conventions

- Lengths are in **mm**, angles in **degrees**, positions are `[x, y, z]`, z up.
  The page's mm/inch switch does not change anything here.
- An argument called `ids` takes one id (a string) or an array of ids.
**Errors.** A failing call throws an `Error` whose message names the bad input,
what is allowed, and one next step. Over WebSocket and MCP, the message arrives
as the tool error text. Wording may improve in any release, so match the call’s
outcome rather than its exact message. A body that fails to build reports its
error in `JS3D.list()`, with a hint when one is known.

- While Chisel mode is open, every call that edits or loads throws `leave Chisel mode first` (`setMode` is how you leave it).
- Everything is synchronous except `ready`, `export`, `screenshot`,
  `screenshotDataURL`, `load`, `newDesign`, `run`, `invoke`, `sketch`, `extrude`, `revolve`, `fillet`, `chamfer`, `shell`, `hole`, `faces` and `edges`, which return promises.
- Every edit is one undo step with a readable label (the Undo button and
  `JS3D.undo()` use it) and leaves the selection alone.
- **Shapes are built in the background.** After an edit, `volume` and `bbox`
  in `list()` are `null` until the geometry engine has finished. Call
  `await JS3D.ready()` before reading them. `export` and `screenshot` wait by
  themselves.
- A body's position is the translation in its matrix `m` (entries 12, 13, 14).
  A shape made by `add` sits with the middle of its footprint at x, y and its
  base at z. A **group**'s own position stays `[0, 0, 0]` when it is made (its
  parts keep their places inside it), so for where a group is, read `bbox`.

### Reading

| Call | Returns |
|---|---|
| `JS3D.version` | `"1.12"`. The last number goes up when calls are added; the first changes when a call changes shape. |
| `JS3D.appVersion` | The app's version, such as `"2.0"`. |
| `JS3D.kinds()` | `[{ kind, defaults }]`: the 20 shape kinds `add` accepts and their default sizes (`box`, `cylinder`, `sphere`, `cone`, `pyramid`, `wedge`, `torus`, `tube`, `hemisphere`, `prism`, `text`, `star`, `heart`, `roof`, `roundroof`, `paraboloid`, `gem`, `spring`, `capsule`, `arrow`). |
| `JS3D.list()` | The top-level bodies: `[{ id, name, kind, hole, hidden, locked, color, position, bbox, volume, error, children? }]`. `kind` is the shape kind for a basic shape and `"group"`, `"extrude"`, `"revolve"`... for the rest. `bbox` is the world box `{ min: [x,y,z], max: [x,y,z] }` and `volume` is in mm³; both are `null` until built (and while an error is shown). `error` is the geometry engine's message or `null`. `children` is the number of parts in a group. |
| `JS3D.get(id)` | The same entry plus `node` (a copy of the body's definition) and `m` (its 16-number matrix). |
| `JS3D.params()` | `[{ name, expr, value, unit }]`. `value` is mm (`null` when the expression fails), `unit` is `"mm"` or `"in"`. |
| `JS3D.doc()` | A copy of the whole design document. |
| `JS3D.save()` | `{ app: "jumpstart-3d", version: 1, doc }`: what the Export menu's project file holds. Nothing is downloaded or stored. See [Part 2](#part-2-the-project-file-format). |
| `JS3D.mode()` | `"beginner"`, `"advanced"`, `"arch"` (Architect) or `"chisel"`. |
| `JS3D.selection()` | The selected ids. |
| `JS3D.internals` | `{ app, store }`, the same objects as `window.__app` and `window.__store`, for people who know the code. |

### Waiting

`await JS3D.ready(timeoutMs = 90000)` resolves when the geometry engine is
idle and every visible body has been built (or has an error). It checks every
50 ms. If time runs out it throws and names the bodies still building. A body whose definition cannot be read at all (a hand-written file with a broken node) is never sent to the geometry engine; `ready` does not wait for it, and `list()` shows its `error`.

### Inspecting and checking

These five calls check a design without a picture. Each waits for the shapes to build (like `ready`), then reads them. They change nothing: no undo step, the selection stays as it was, nothing is saved. A call refuses while the design shows a preview or an earlier step (see the errors below), so every number comes from one design. Lengths are mm, areas mm², volumes mm³, weights grams, angles degrees. A call with no `ids` uses every top-level body that is not a hole and not hidden; with `ids` it uses those bodies (a missing one throws `no body <id>`). A body that has not built shows its build error; a hidden body that was never built says `<name> is hidden and has not been built; show it first`.

| Call | Result | Exact or mesh |
|---|---|---|
| `inspect(ids?, {material, density})` | `{ material: {key, name, density}, bodies: [{ id, name, hole, hidden, bbox: {min, max}, size: [x, y, z], volume, volumeFrom, area, weight, solids, error }], total: { bodies, bbox, size, volume, area, weight } }`. `material` is a filament key (`pla` by default; `pla`, `plaplus`, `petg`, `abs`, `asa`, `nylon`, `pc`, `cfpla`, `cfnylon`, `peek`, `tpu`); `density` (g/cm³, 0.1 to 25) overrides it and the key is then `"custom"`. `weight` is a solid part (100 % infill); a slicer's estimate is lower. A body with an `error` has null numbers and is left out of `total`. A wire-only body (curves, no surface) comes back with bbox null, volume 0, area 0 and a `note`. | `bbox`, `size`: exact box of the mesh. `volume`: the exact solid (`volumeFrom: "solid"`), else the mesh (`"mesh"`). `area`: the mesh (within about 0.5 %, a little low on curved faces). |
| `measure(a, b)` | `{ distance, exact, kind, from?, to?, delta?, angle?, parallel?, a, b }`. A target is a point `[x, y, z]`, a body id, `{body, face}` (a face number) or `{body, near: [x, y, z]}` (the face nearest that point; the result's `a.face` tells you its number). Kinds: `point-point` (with `delta`), `body-body` (shortest distance between the surfaces, 0 when they touch or overlap), `planes` (two flat parallel faces: the distance between their planes, such as a wall's thickness), `mesh`. Two flat faces also give `angle` (0 to 90). | `point-point`, `body-body`, `planes`: exact. `mesh`: `exact: false`, from the display mesh; crossing meshes do not report 0. |
| `printCheck({ids, printer, angle})` | `{ ok, summary, printer, bed: {w, d, h} or null, angle, issues: [{level, code, id, name, text}], bodies: [{ id, name, bbox, minZ, contactArea, overhangArea, overhangTriangles, fits }], ignored: [{id, name, why}] }`. `printer` is `generic` (256 x 256 mm, no height limit), `none` (no plate), or `a1`, `x1`, `p1s`, `mk4`, `mini`, `ender3`, `u1`; the default is the plate chosen in Settings. `angle` 10 to 80 (default the angle saved in Settings, 45 at first). Errors (`ok` false): `empty`, `build_error`, `wire_only`, `floating`, `below_plate`, `outside_bed`, `too_tall`. Warnings: `overhang` (more than 1 mm² of underside leaning out past `angle`), `small_contact` (less than a tenth of the footprint on the plate). Holes and hidden bodies go to `ignored`. | Mesh rules. Wall thickness is not checked. |
| `collisions({ids, gap})` | `{ pairs: [{ a, b, aName, bName, distance, state, overlap }], checked, skipped: [{id, name, error}] }`. `state` is `overlap`, `touch` (distance 0) or `near` (closer than `gap`, default 0). `overlap` is the shared volume; for `near` it is null. At most 50 bodies; the shared volume is worked out for the first 20 touching or overlapping pairs (later ones say `note`). A pair is listed when its distance is at most `gap` plus a 0.001 mm contact tolerance; 0.001 mm or less counts as touching. All distances and overlaps are worked out from one snapshot of the bodies taken at the start. The whole call has 90 seconds: pairs whose shared volume is not reached in time get `note: "not measured (the 90 second time limit was used up)"`. | Distances: exact solids. |
| `section(plane, {ids, points, picture, width})` | `plane` is `{axis: "x"|"y"|"z", at}` or `{origin, normal}`. `{ plane: {origin, normal, u, v}, shifted, area, bodies: [{ id, name, area, loops: [{ area, perimeter, hole, closed, min, max, points? }] }], skipped, truncated?, dataURL? }`. Loop coordinates are 2D, along `plane.u` and `plane.v` from `plane.origin`. `area` is the net area (outer loops minus holes), summed over bodies. A plane that passes exactly through a vertex moves 0.0001 mm (`shifted`). `points: true` adds each loop's points (over 5000 in all: `truncated`). `picture: true` adds `dataURL`, a PNG of the 3D view with the camera's side cut away (Beginner or Advanced mode; `width` default 800); the section view and the camera are put back as they were (the picture is always taken from the Home view). A cut of more than 200000 segments or 2000 outlines is refused. | Mesh cut (areas within the mesh's accuracy). |

Errors, word for word (a call that throws leaves the design as it was):

| Call | Text |
|---|---|
| any with `ids` | `no body <id>`, `no body ids given` |
| any, a body without a mesh | its build error, or `<name> is hidden and has not been built; show it first` |
| any | `the design is showing a preview; finish or cancel it first`, `the design is rolled back to an earlier step; return to the latest step first` |
| `measure`, `section`, `collisions` | `<name> is a wire-only shape (lines, no surface); it has no volume, area or faces to measure` (a body made only of curves, such as a wire from a STEP file; `measure` throws it, `section` and `collisions` list it in `skipped`) |
| `section` | `the cut has more than 200000 line segments; cut fewer or simpler bodies (pass ids)`, `the cut has more than 2000 separate outlines; cut fewer or simpler bodies (pass ids)` |
| `collisions` | `The geometry engine did not answer in time.` (the distances took longer than the 90 second limit) |
| `inspect` | `unknown material "<m>"; valid materials: pla, plaplus, petg, abs, asa, nylon, pc, cfpla, cfnylon, peek, tpu` |
| `inspect` | `density must be a number of g/cm3 from 0.1 to 25` |
| `measure` | `<a or b> must be a point [x, y, z], a body id, or {body, face} or {body, near}` |
| `measure` | `<a or b> must be [x, y, z] in mm` (a point or `near` that is not three numbers; `near` says `near must be ...`) |
| `measure` | `face must be a whole number from 0 to <n-1> (<name> has <n> faces)` |
| `measure` | `<name> has no face list; measure the body or a point instead` |
| `measure` | `a and b are the same body` |
| `measure` | `the geometry engine could not measure between <name> and <name>` |
| `measure` | `these two are too finely meshed to measure here (<n> vertex-triangle pairs, at most 40000000); measure between two points or two whole bodies instead` |
| `printCheck` | `unknown printer "<p>"; valid: generic, none, a1, x1, p1s, mk4, mini, ender3, u1 (or any 3D Print Sim printer id)` |
| `printCheck` | `angle must be a number of degrees from 10 to 80` |
| `collisions` | `gap must be a number of mm from 0 to 50` |
| `collisions` | `collisions takes at most 50 bodies at a time (got <n>); pass ids` |
| `section` | `give axis ("x", "y" or "z") and at, or origin [x, y, z] and normal [x, y, z]` (neither, both, or a bad axis) |
| `section` | `at must be a number (mm along <axis>)` |
| `section` | `origin must be [x, y, z] in mm`, `normal must be [x, y, z] in mm` |
| `section` | `normal must not be [0, 0, 0]` |
| `section` | `section pictures need Beginner or Advanced mode (now <mode>)` |
| `section` | `width must be a number of pixels between 1 and 8192` |

An example, on an open box:

```js
const outer = JS3D.add("box", { size: [60, 40, 25], name: "Box" });
const cavity = JS3D.add("box", { size: [56, 36, 25], at: [0, 0, 2], hole: true });
const box = JS3D.group([outer, cavity], { name: "Box" });
await JS3D.ready();
(await JS3D.inspect([box])).bodies[0].weight;                      // grams of PLA
(await JS3D.printCheck()).summary;                                 // "Ready to print: 1 part, no problems found."
JS3D.add("box", { size: [60, 40, 3], at: [0, 0, 26], name: "Lid" });
await JS3D.ready();
(await JS3D.collisions()).pairs;                                   // [] (1 mm apart); {gap: 2} lists them as "near"
(await JS3D.measure({ body: box, near: [30, 0, 12] }, { body: box, near: [28, 0, 12] })).distance; // 2, a wall's thickness
(await JS3D.section({ axis: "z", at: 10 })).bodies[0].area;        // 384
```

### Making and changing shapes

| Call | What it does |
|---|---|
| `JS3D.add(kind, opts)` → id | Adds a shape. `opts`: `size` (`{w, d, h, ...}` or `[w, d, h]`; keys other than the ones `kinds()` lists for that kind are refused; `w`, `d`, `h` and `size` must be at least 0.01; `sides` and `points` whole numbers of at least 3), `at` (`[x, y, z]`, default `[0, 0, 0]`), `hole` (true makes it a hole), `color` (`"#rrggbb"`), `name`. An unknown kind throws and lists the valid ones. Undo label `Add box` (and so on). |
| `JS3D.fastener(opts)` → id | Adds a threaded fastener as one body. `opts`: `type` (`"bolt"`, `"nut"`, `"rod"` or `"cutter"`), `size` (metric `M2.5 M3 M4 M5 M6 M8 M10 M12`, or inch `#6-32 #8-32 #10-24 #10-32 1/4-20 1/4-28 5/16-18 5/16-24 3/8-16 3/8-24 1/2-13 1/2-20`), `length` (mm; for a bolt it is the length under the head; not used for a nut; at least 3 thread turns, at most 150), `clear` (print offset in mm, `-1` to `0`, default `0`; `-0.2` suits most printers; the offset is capped per part, a bolt at 0.07 and a nut at 0.15 of the pitch, so a small thread stops loosening early), `left` (true for a left-hand thread), `at` (`[x, y, z]`, default `[0, 0, 0]`; the base of the part sits at z), `name`. A bolt is a group of a hex head and a shank with a Thread feature; a nut is a hex prism with a hole and a Thread feature; a rod is a cylinder with a Thread feature; a cutter is a rod that is a hole and is built wider instead of thinner: its diameter grows by twice the print offset, so the hole it cuts is as loose as a nut with that offset, and the Thread print offset tool leaves it alone. Grouping it with a solid cuts a threaded hole. Building takes a few seconds: `await JS3D.ready()`. Bad input throws a plain message (`unknown size "M7"; sizes: ...`). Undo label `Add M8×30 bolt` (and so on). |
| `await JS3D.holePattern({ body, face, layout, hole })` → `{ id, holes, dropped }` (and `sketch` for the shapes) | Drills round holes into one flat face of a body, as ONE Hole feature (a single `hole` mod with every position, so the Hole dialog edits it), or cuts square, hex or slot holes there, as ONE sketch with an outline per hole and ONE Extrude cut (`hole.shape`, below). Async: it waits for the shapes to be built first. `face` is the world direction the face looks: `"+x"`, `"-x"`, `"+y"`, `"-y"`, `"+z"` or `"-z"`; it picks the body's flat face within 1° of that direction that lies farthest along it (on a tie the larger one). Sloped faces can only be reached in the dialog. Columns run along the face's longest straight edge (on a box top, the longer side), rows across it; `angle` and `start` are measured from that edge, turning counter-clockwise seen from outside the face. `layout`: `{ type: "grid", cols, rows, pitch, margin = 0, stagger = false, angle = 0 }` (`cols` and `rows` whole numbers 1 to 200; `pitch` a number for both directions or `[column pitch, row pitch]`, leave it out to spread the holes over the face; `stagger` shifts every other row by half a column pitch and makes it one hole shorter; `angle` turns the grid on the face, degrees) or `{ type: "circle", count, radius, start = 0, center, margin = 0 }` (`count` 2 to 200; `start` the first hole's angle from the face's first axis; `center` a world `[x, y, z]` moved onto the face, default the middle of the face). `margin` is the space between a hole's edge and the face's outline (outer edges and any holes already in it). Holes that would not fit are left out: `holes` counts the ones made, `dropped` the ones left out. `hole`: `{ kind = "simple", size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear }` with `kind` `"simple"`, `"cbore"`, `"csink"` or `"tapped"`; `size` (such as `"M3"` or `"#8"`) fills the diameter and the bore, sink or thread the way the Hole dialog does, and numbers you give override it; leave `depth` out for a through hole; `clear` (tapped only) defaults to the design's Thread print offset. `hole.shape` is `"round"` (the default, everything above), `"square"`, `"hex"` or `"slot"`; the shapes take `hole.width` (the square's side, the hex's width across flats, the slot's width, mm), `hole.length` (slots only: overall length, end to end, more than the width) and `hole.depth`, and none of the round-only keys (`kind`, `size`, `dia`, `tip`, `cbDia`, `cbDepth`, `csDia`, `csAngle`, `pitch`, `clear`). A hex has a flat facing along the row and a corner across it, so stagger with a row pitch of 0.866 × the column pitch makes a honeycomb. Each outline turns with the layout: in a grid by `angle` (angle 90 puts slots along the other axis), in a circle by its own polar angle (slots point at the centre). A shape's sketch is hidden and sits on the body (named `Square holes (N)`, `Hex holes (N)` or `Slots (N)`), its plane is the one a hand-made face sketch gets (x along world X, or Y on a face looking along X), and the cut is one `bool` mod on the named body only. A through cut is a number worked out from the body as it is now (the far side plus 1 mm), so a body made thicker later is no longer cut through, and a body made taller on the face's side leaves the cut starting at the old face (an internal pocket), as with any face-sketch cut; the depth is edited in the Extrude dialog, the outlines in the sketch. Moving or resizing the pattern means undo and run the call again. `id` is the cut's id and `sketch` the sketch's. At most 200 plain, square, hex or slot holes, 130 counterbores or countersinks, 8 tapped (a tapped hole takes about 2 seconds to build, measured in a 6 mm plate; thicker plates take longer). Errors are plain and nothing is added: `hole.shape must be "round", "square", "hex" or "slot"`, `hole.<key> is only for round holes`, `hole.width and hole.length are only for square, hex and slot holes`, `hole.width must be a positive number of mm (...)`, `hole.length must be a number of mm, more than hole.width`, `hole.length is only for slots`, `Pitch must leave a wall between holes: at least 6.1 mm along a row and 6.1 mm between rows.`, `A slot's length must be more than its width.`, `Some outlines overlap. Use a larger pitch or radius, or a smaller hole.`, `face must be "+x", ...`, `<name> has no flat face facing +z`, `layout.type must be "grid" or "circle"`, `unknown size "M7"; sizes: ...`, `Pitch must be at least the hole's width (3 mm).`, `Too many holes (225; the most is 200 for plain holes). ...`, `No holes fit on this face with these settings.` Undo labels `Hole pattern (12 holes)`, `Hole pattern (24 hex holes)`, `Hole pattern (24 square holes)`, `Hole pattern (24 slots)`; one undo removes the sketch and the cut together. |
| `JS3D.gear(opts)` → id | Adds a spur gear, a helical gear, a straight bevel gear or a rack as one body, with its hidden sketch(es) (two for a bevel gear). `opts`: `kind` (`"spur"` default, `"helical"`, `"bevel"` or `"rack"`), `module` (mm, 0.3 to 10, any number; required; for a helical gear it is the normal module), `teeth` (whole number, required: spur 12 to 200, helical 12 to 30, bevel 12 to 90, rack 2 to 100), `angle` (helical only: the helix angle, degrees, 5 to 30, default 20), `hand` (helical only: `"right"` default or `"left"`; a partner of the same module and angle needs the opposite hand to mesh on parallel shafts), `width` (mm, default 6; a bevel gear's default is 6 or a third of the way to the cone's tip (`module × mate / 6`), whichever is smaller, rounded down to 0.1 mm, and it may not exceed that third), `mate` (bevel only: the partner gear's teeth, 12 to 200, default the same as `teeth`; it sets where the cone's tip is, `module × mate / 2` above the big end), `base` (rack only: the solid strip under the teeth, mm, default 5), `bore` (spur, helical and bevel: shaft hole diameter, mm; 0 or leave out for none, else 1 mm or more, leaving at least `max(1, module)` mm under the teeth), `keyway` (spur only: a DIN 6885 groove for a bore of 6 to 58 mm, notch toward +y), `clear` (print clearance, mm, taken off every tooth at the pitch line, half from each flank; default 0.1 or a quarter of the module if that is smaller; 0 up to the smaller of 0.5 and a quarter of the module), `at` (`[x, y, z]`, default `[0, 0, 0]`), `name`. A key counts as given when it is not `null` or `undefined`. The teeth are the ISO 53 basic rack at a fixed 20° (addendum 1 module, dedendum 1.25, no root fillet, no profile shift), drawn as straight lines with eight points a flank; fewer than 17 teeth are drawn plain, not undercut. A spur gear or bevel gear lies flat with its axis along z through `at`, its base on `at`'s z and tooth 0 pointing along +x; a rack starts at `at`, runs along +x for `teeth × π × module` and ends in half gaps (racks lay end to end), with its pitch line through `at` and its teeth pointing +y. The sketches sit at the world origin and the body's matrix carries `at`. A spur gear or rack is one sketch and one Extrude (its width is the Extrude's distance, so it can be bound to a parameter); a bevel gear is a big-end sketch at z = 0 and a small-end sketch at z = `width` (the same outline scaled toward the cone's tip) with a straight Loft between them, and its bore is a through Hole feature: this is the usual CAD approximation, not a spherical involute. A helical gear is the spur outline of the transverse module `module / cos(angle)` turned a little at each of several sections and joined by straight Lofts (a very wide one is refused: `width must be a positive number of mm, at most N for this helical gear (...)`); the teeth turn a right-hand way for `"right"`. Module and teeth cannot be edited afterwards: undo and call again. Two spur gears of one module mesh with their centres `module × (teeth1 + teeth2) / 2` apart; when the second has an even tooth count, turn it by `180 / teeth2` degrees about its own axis. Two bevel gears of one module, `teeth` and `mate` swapped between them, mesh at 90° when the second is built the same way, turned (when its teeth are even) by `180 / teeth` degrees about z, then by −90° about y (both about the origin), then moved by `[module × teeth1 / 2, 0, module × teeth2 / 2]`. Bad input throws a plain message and adds nothing: `kind must be "spur", "helical", "bevel" or "rack"`, `module must be a number from 0.3 to 10 (mm)`, `teeth must be a whole number from 12 to 200 for a spur gear` (`from 12 to 30 for a helical gear`, `from 12 to 90 for a bevel gear`, `from 2 to 100 for a rack`), `width must be a positive number of mm` (for a bevel gear `..., at most 10 for this bevel gear (a third of the way to the cone's tip)`), `mate must be a whole number from 12 to 200 (the partner bevel gear's teeth)`, `angle and hand are only for helical gears`, `angle must be a number from 5 to 30 (degrees of helix angle)`, `hand must be "right" or "left"`, `mate is only for bevel gears`, `base must be a positive number of mm`, `base is only for racks`, `bore and keyway are not used for a rack`, `bore must be 0 (none) or from 1 to 31 mm for this gear (it leaves 2 mm under the teeth)` (or `this gear is too small for a bore`), `keyway must be true or false`, `keyway is for spur gears only`, `keyway needs a bore from 6 to 58 mm (DIN 6885)`, `the keyway does not fit: it must leave 2 mm under the teeth`, `clear must be a number from 0 to 0.5 mm for module 2`, `at must be [x, y, z] in mm`. Undo label `Add Spur gear 20 teeth m2` (and `Bevel gear ...`, `Rack ...`). |
| `JS3D.namePlate(opts)` → `{plate, textBody, size}` | Adds a flat plate sized to one line of text, with the text raised on it as a second body or cut into it. `opts`: `text` (required; trimmed, one line, 1 to 40 characters, every character must be in the chosen font), `font` (`"sans"` default, `"serif"` or `"mono"`; all three are bold and cover English and Western European letters, digits and common symbols, and a character they lack is refused, not dropped), `size` (the height of a capital letter, mm, 2 to 100, default 10), `style` (`"raised"` default, or `"cut"`), `depth` (how far the letters stand up or are cut in, mm, 0.2 to 10, default 1; for `"cut"` at most `thickness − 0.6`), `thickness` (the plate, mm, 0.6 to 20, default 3; `"cut"` needs 0.8 or more), `margin` (text to the plate's edge, mm, 1.5 to 20, default 3), `shape` (`"rounded"` default, corner radius = `margin`, or `"pill"`, fully round ends), `holes` (`"hang"` default: one hole at the left end; `"none"`; `"screws"`: one at each end), `holeDia` (mm, default 5 for `"hang"` and 3.5 for `"screws"`, from 1 up to the plate's depth minus 3 so 1.5 mm of plate is left round it; not with `"none"`), `color` (the plate, default `"#2b7bb9"`), `textColor` (raised letters only, default `"#ffffff"`), `at` (`[x, y, z]`: the plate's centre in x and y and its base at z, default `[0, 0, 0]`), `name` (default `Name plate <text>`; the raised text body is named the same plus ` text`). A key counts as given when it is not `null` or `undefined`. The text runs along +x, read from above. The plate is the text's measured box (width `tw`, height `th`, from the same outlines the drawing code uses) plus `margin` all round: depth `th + 2 × margin`; a hole adds `holeDia + margin` (rounded) or `holeDia / 2 + margin` (pill) of length at its end and sits `margin` from the text, and with one hole the text shifts away from it. `size` in the result is `[width, depth, height]` in mm (height = thickness plus the letters' height for `"raised"`, the thickness for `"cut"`). One hidden sketch (the outline and the holes) and one Extrude make the plate, its thickness the Extrude's distance. Raised letters are a Text shape sitting on the plate's top face with its own colour (the 3MF export keeps both colours; on a one-nozzle printer a filament change at the plate's top prints two); `textBody` is `null` for `"cut"`, whose letters are the app's Deboss text feature on the plate. Keep the two bodies separate: grouping them fuses them into one colour. The plate does not follow later text edits: to fit new text, undo and call again. Bad input throws a plain message and adds nothing: `text must be a non-empty string`, `text must be one line, without line breaks or tabs`, `text can have at most 40 characters (this has 41)`, `font must be "sans", "serif" or "mono"`, `text has characters the fonts do not have: "Ł", "ж". The fonts cover English and Western European letters, digits and common symbols.`, `size must be a number from 2 to 100 (mm, the height of a capital letter)`, `style must be "raised" or "cut"`, `depth must be a number from 0.2 to 10 (mm)`, `thickness must be a number from 0.6 to 20 (mm)`, `the plate is too thin to cut text into (make it at least 0.8 mm)`, `depth must be at most 2.4 mm here, so 0.6 mm of plate stays under the letters`, `margin must be a number from 1.5 to 20 (mm)`, `shape must be "rounded" or "pill"`, `holes must be "none", "hang" or "screws"`, `holeDia is only for holes "hang" or "screws"`, `the text is too small for a hole here: use a larger margin, or holes "none"`, `holeDia must be a number from 1 to 13 mm for this plate (it leaves 1.5 mm of plate round the hole)`, `color must look like "#rrggbb"`, `textColor is only for raised text (cut-in letters are part of the plate)`, `textColor must look like "#rrggbb"`, `at must be [x, y, z] in mm`. Undo label `Add Name plate <text>`. |
| `JS3D.knurl(opts)` → id | Adds a knurled knob: a cylinder with straight V grooves all round and an optional bore. `opts`: `diameter` (outside, to the groove tips, mm, 6 to 150, default 20), `length` (mm, 1 to 200, default 15), `grooves` (a whole number, 8 to 120; default about one per mm of circumference, `round(π × diameter)` kept between 8 and 120), `depth` (mm, 0.1 up to a quarter of the diameter, and at least `radius × (1 − cos(π / grooves))` so that the groove roots lie inside the chord between two tips; default a 90° V, `π × diameter / grooves / 2`), `bore` (`"none"` default; the dialog starts with a 5 mm round bore, `"round"`, `"hex"` or `"d"`), `boreSize` (mm, from 1 to the largest that leaves 1 mm under the groove roots; the diameter for `"round"` and `"d"`, across flats for `"hex"`; default 5, hex 8; not with `"none"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Knurled knob <diameter> x <length>`). A key counts as given when it is not `null` or `undefined`. One hidden sketch (2 × `grooves` straight lines alternating between the tip radius and the root radius, tooth 0 pointing along +x, plus the bore) and one Extrude, so the result is a true solid that exports to STEP. A `"d"` bore has its flat on the +x side, 0.4 × `boreSize` from the centre. The knurl is straight only; for a diamond pattern use the Texture tool, which works on the mesh and is not kept in a STEP file. Bad input throws a plain message and adds nothing: `diameter must be a number from 6 to 150 (mm)`, `length must be a number from 1 to 200 (mm)`, `grooves must be a whole number from 8 to 120`, `depth must be a number from 0.1 to 5 mm for this diameter (the grooves can reach at most half way to the middle)`, `depth must be at least 0.762 mm for 8 grooves on this diameter; shallower grooves vanish`, `bore must be "none", "round", "hex" or "d"`, `boreSize is only for a bore "round", "hex" or "d"`, `this knob is too small for a bore: use a larger diameter, or bore "none"`, `boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)` (a hex adds `, measured across flats`), `at must be [x, y, z] in mm`. Undo label `Add <name>`. |
| `await JS3D.codeCad({code, bindings, name, bodyId})` → id | Builds ONE solid from replicad code in a temporary worker and adds it as an ordinary STEP body that keeps its code (`body.codeCad`). `code` is a function body that gets `replicad` and `params` and returns one closed solid (millimetres; not a drawing, surface, list or promise), at most 100,000 characters. `bindings` (optional) links names the code reads as `params.<name>` to named parameters: `{ width: "Width" }` (a parameter's name or id; saved by id, so renaming it changes nothing). With `bodyId` the body made earlier is updated in place (same id, position and later features; a new STEP file). Nothing runs when a design is opened or a parameter changes: the code runs only on a call like this or the dialog's Build and Update. The work stops after 25 seconds. The file that comes back is built again in the design's own worker and must be one closed solid before it is used. The result is one undo step, or nothing at all: a failed or cancelled build changes nothing, and a result is thrown away if another design was opened, a linked parameter changed or the body being updated changed while the code ran. The code is trusted JavaScript, not a sandbox: it can use the network, the browser's saved designs and caches, and other workers, and the time limit does not limit memory. Errors are plain messages (`The code has a syntax error: …`, `The code stopped with an error: …`, `The code must return one solid …`, `The code returned 2 separate pieces …`). The dialog is Open/Export > Code CAD…. |
| `JS3D.spring(opts)` → id | Adds a compression spring of round wire as one body (the app's Coil, with two Split body planes for flat ends). `opts`: `wire` (the wire's thickness, mm, 0.4 to 10, default 2), `outside` (outside diameter, mm, 2 to 200 and at least five wire diameters, default 20), `freeLength` (the spring's height, mm, 1 to 300, default 30), `turns` (total turns, 2 to 10 in steps of a half, default 5), `hand` (`"right"` default or `"left"`), `ends` (`"open"` default, or `"flat"`), `color` (default `"#7d8a96"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Spring <outside> x <freeLength>`). A key counts as given when it is not `null` or `undefined`. The wire starts on +x at the bottom and turns counter-clockwise going up for a right-hand spring. `"open"`: the wire just stops, cut square to itself, and the pitch is solved so the whole spring is exactly `freeLength` high (`freeLength = turns × pitch + wire × cos(helix angle)`). `"flat"`: the pitch is `freeLength / turns` and the first and last bit of wire is cut off by a horizontal plane, so both ends are flat and the height is exactly `freeLength`; the two planes stay where they are if the Coil is edited later, so undo and call again to change the length. Closed (squared) end turns are not made. The gap between coils, along the axis, must be at least 5 % of the wire, and the pitch at most 1.5 times the circumference of the wire's centre line (`The spring is too steep. Use more turns, a shorter free length or a larger outside diameter.`). No live preview. Bad input throws a plain message and adds nothing: `wire must be a number from 0.4 to 10 (mm)`, `outside must be a number from 2 to 200 (mm)`, `outside must be at least five wire diameters (25 mm for this wire)`, `freeLength must be a number from 1 to 300 (mm)`, `turns must be a number from 2 to 10, in steps of a half`, `hand must be "right" or "left"`, `ends must be "open" or "flat"`, `color must look like "#rrggbb"`, `at must be [x, y, z] in mm`, `The coils would touch. Increase the free length, use fewer turns, or use thinner wire.`, `This spring needs too much wire to build. Use fewer turns, a shorter free length, a smaller outside diameter or thicker wire.` (the wire's length may be at most 600 wire thicknesses; a 20 × 30 mm spring of 5 turns is 142, of 10 turns 283). Undo label `Add <name>`. |
| `JS3D.remove(ids)` → count | Deletes bodies and returns how many. `JS3D.delete` is the same call. Sketches only they used go too. |
| `JS3D.duplicate(ids, offset)` → new ids | Copies bodies, moved by `offset` (default `[0,0,0]`). |
| `JS3D.move(ids, [dx, dy, dz])` | Moves by that much along the world axes. |
| `JS3D.moveTo(id, [x, y, z])` | Puts the body's position (its matrix translation) at that point. |
| `JS3D.rotate(ids, axis, degrees, opts)` | Turns about a world axis, `"x"`, `"y"`, `"z"` or `[x, y, z]`, right-hand rule. `opts.about` is the point to turn around. The default is the middle of the bodies' world box, which needs them built: without `opts.about`, a body still being built throws `<name> is still being built: await JS3D.ready() first, or pass opts.about`, so the result never depends on timing. |
| `JS3D.resize(id, { w, d, h, ... })` | Sets the sizes of a **plain** shape (a basic shape with no features). Same checks as `add`. A torus keeps its depth equal to its width. A size that was tied to a parameter is freed. On anything else it throws `resize works on plain shapes; use scale`. |
| `JS3D.scale(ids, k, opts)` | Stretches any body. `k` is one number or `[kx, ky, kz]`; an array is along **each body's own axes**, not the world's (they differ on a turned body). `opts.about` is the point that stays put (default the middle of the bodies' world box; same rule as `rotate` for bodies still being built). It adds, or folds into, a `scale` feature on the body, the way the Beginner size boxes do. Scaling back by `1/k` about the same point removes the feature again. After a scale the body is no longer a plain shape, so `resize` and `bind` refuse it until you undo or scale back. |
| `JS3D.setHole(ids, bool)` | `bool` must be `true` or `false` (same for `setHidden`). Makes bodies holes (cut away what they overlap in a group, not exported on their own) or solids. |
| `JS3D.setColor(ids, "#rrggbb")` | |
| `JS3D.rename(id, name)` | |
| `JS3D.setHidden(ids, bool)` | A hidden body stays in `list()` with `hidden: true`, is not drawn and is left out of exports. |
| `JS3D.group(ids, { name, op })` → id | Combines two or more bodies into one: solids joined, holes cut out. `op: "intersect"` keeps only what all of them share; `op: "cut"` cuts the others out of the first. |
| `JS3D.ungroup(id)` → new ids | Splits a group back into its parts, in the same places. Throws if the body is not a group; throws `this group has features (fillets, holes...); remove them before ungrouping` when the group carries features (they would be lost); throws `this group was stretched at an angle, so it cannot be split back into shapes` when a resize cannot be pushed down into turned parts. Nothing changes when it throws. |

Locks (`locked` in `list()`) are a guard for the mouse; the bridge does not
check them.

### Advanced CAD: sketches, features and selectors

These calls make the same sketches and features the Advanced dialogs make, so a person can open the feature tree, the dialogs and the
sketch editor on the result. Each is one undo step. They work in a design of any mode (`newDesign("advanced")` is the natural start).
Every one starts like the other edits (Chisel, CosForge and Chip Carving refuse), a missing body throws `no body <id>`, and nothing is
added when a call throws. The geometry calls wait for the shapes to build themselves (`ready`), then refuse a body that is marked as a
hole (`<name> is marked as a hole; features go on solid bodies`), has a build error (`<name> has a build error: <message>`), or is hidden
and so was never built (`<name> is hidden and has not been built; show it first`). A "length" is a number of mm more than 0 (or an
expression); an **expression** is text such as `"W/2"` or `"d1 + 2"` that can use parameters and sketch dimensions. A value given as an
expression is kept as one, so it follows the parameter: `exprs` on the feature (Part 2).

| Call | What it does |
|---|---|
| `await JS3D.sketch({ on, name, shapes, hidden })` → `{ sketch, name, plane, shapes, profiles, dof, dims }` | Adds a sketch of fully dimensioned shapes (every shape has degrees of freedom 0; `dof` says so). `on`: `"XY"` (default), `"XZ"` (the Front plane), `"YZ"` (the Right plane), `{ plane, offset }` (offset in mm along the plane's normal: XY +z, XZ -y, YZ +x) or `{ body, face }` (`face`: a face selector or index that gives exactly one flat face). `shapes`: 1 to 200 objects, see below. `name` defaults to `Sketch N`; `hidden` to `false`. The result's `plane` is `{ o, x, y, n }` in the world, `shapes` lists each shape's `type`, `ents` (entity ids) and `center`, `profiles` the closed regions (`pt` inside each, `area`), `dims` the named dimensions (`name`, `value`, `expr`). Label `Create sketch`. The face's outline is not copied into the sketch: only the shapes you give are in it. |
| `await JS3D.extrude({ sketch, profiles, dist, through, mode, dist2, op, body, name })` → `{ body, feature }` | Pushes closed profiles of a sketch along its normal. `dist` is a number of mm, not 0 (or an expression; negative goes the other way, into the body for a face sketch). `profiles`: points `[x, y]` in the sketch, each picks the region holding it; the default is every profile that does not lie inside an odd number of others (a rectangle with a circle in it gives the ring; separate shapes all of them). `mode`: `"one"` (default), `"sym"` (dist split both ways) or `"two"` (also `dist2`, more than 0, the other way). `op`: `"new"` (default: a new body, named `name` or `Body N`; `feature` is `null`), `"join"` or `"cut"` (both need `body`, a solid body: the extrude becomes a feature of it). `through: true` (cut only, instead of `dist`) cuts right through the body: the distance is worked out at the call, from the body's size then, like the hole pattern's. The sketch is hidden, as the dialog's OK does. Labels `Extrude`, `Extrude join`, `Extrude cut`. |
| `await JS3D.revolve({ sketch, profiles, axis, angle, op, body, name })` → `{ body, feature }` | Turns profiles about `axis`: `"X"`, `"Y"` or `"Z"` (a world axis through the origin that lies in the sketch's plane) or the id of a `line` of the sketch. `angle` is degrees, more than 0 and at most 360 (default 360; or an expression). The rest as `extrude`. Label `Revolve`. A profile that crosses the axis builds with the geometry engine's own error in `list()`. |
| `await JS3D.fillet(id, edges, r)` → `{ body, feature, edges }` | Rounds the edges `edges` picks (a selector, an index or a list of indices) with radius `r` (a length or expression). Exactly those edges: no growing along tangent chains. A radius that is too large is not checked here: the body shows the engine's message in `list()` (`Fillet radius 5 mm is too large ... about 4.8 mm`). Label `Fillet`. |
| `await JS3D.chamfer(id, edges, d)` → `{ body, feature, edges }` | The same with a bevel of distance `d`. Label `Chamfer`. |
| `await JS3D.shell(id, { th, open, dir })` → `{ body, feature, open }` | Hollows the body to walls `th` thick (a length or expression). `open`: a face selector, index or list for the faces to take away (`"top"` makes an open box); left out or `[]` makes a closed hollow. `dir`: `"in"` (default), `"out"` or `"both"`. Labels `Shell` and `Hollow`. |
| `await JS3D.hole(id, { face, points, kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear })` → `{ body, feature, holes }` | Round holes at world points `[x, y, z]` on one flat face (`face` must give exactly one flat face: `a hole needs exactly one`). Each point is moved onto the face along its normal. One `hole` feature for all of them. `kind`, `size`, `dia`, `depth` and the rest are the Hole dialog's, checked as `holePattern` checks them (leave `depth` out for a through hole). Errors: `point 2 [22, 12, 0] is not on the face, or the hole there runs over its edge`, `holes 1 and 3 overlap (centres 2.5 mm apart; each is 3.4 mm wide)`, `Too many holes (N; the most is M for plain holes).`, and `hole makes round holes; use holePattern for square, hex or slot holes` when `shape` is given. Label `Hole (4 holes)`. |
| `JS3D.pattern(id, { features, type, axis, count, spacing, axis2, count2, spacing2, both, angle, center })` → `{ body, feature, copies }` | Repeats features of the body (this call is synchronous). `features`: ids of holes, extrude, revolve and sweep cuts or joins, and embossed text on the body, or `["shape"]` for the whole body (copies joined). `type`: `"rect"` (`count` 1 to 200 along `axis`, `spacing` mm apart, not 0 when `count` is more than 1; optionally `axis2`, `count2`, `spacing2`, not 0 when `count2` is more than 1 and ignored at `count2` 1, so `spacing2: 0` with `count2: 1` is accepted; `both` spreads the copies to both sides) or `"circle"` (`count` 2 to 360 copies over `angle` degrees, default 360, about `axis` through `center`, default the origin). `axis` is `"x"`, `"y"`, `"z"` or `[x, y, z]`, in the world. `count`, `spacing`, `angle` may be expressions. Label `Pattern`. `copies` is the number of new copies, at most 1999 (the original and its copies together are at most 2000, a `both` direction counting 2n - 1): more is refused with `this pattern would make 159200 copies; the most is 1999 (counting the original, 2000 in all)`. |
| `await JS3D.faces(id, selector)` / `await JS3D.edges(id, selector)` → list | The faces or edges of the built body that the selector picks (default `"all"`; also a whole number or a list of them), in world mm, sorted by index. A face: `index`, `type` (`plane`, `cylinder`, `cone`, `sphere`, `torus`, `other`), `center`, `normal` (planes), `area`, `radius` and `axis` (cylinders), `hole` (a cylinder that is a hole wall), `edgeCount`. An edge: `index`, `type` (`line`, `circle`, `ellipse`, `other`), `start`, `end`, `mid`, `center`, `direction` (lines), `length`, `radius` (circles), `faces` (the faces it joins). Seams and smooth joins are not edges. **Indices belong to the shape as built now and are valid until the next edit**; selectors are what to keep. Errors: `Body 1 has no face 17 (it has 0 to 9)`, `Body 1 has no edge 40 (it has 0 to 23; seams and smooth joins are not edges)`, `no faces match "cone" on Body 1`. |

**Shapes** for `sketch` (sizes may be expressions, positions are numbers; coordinates are the sketch's own x, y: world x, y on XY and on a
face looking up, x, z on XZ, y, z on YZ, and for any face the returned `plane` says which world directions they are):

| `type` | Keys |
|---|---|
| `rect` | `center` (default `[0, 0]`), `size` `[w, h]` |
| `roundrect` | `center`, `size`, `radius` (more than 0, less than half the smaller side) |
| `circle` | `center`, `diameter` |
| `slot` | `center`, `length` (overall, more than `width`), `width`, `angle` (0 or 90) |
| `polygon` | `center`, `sides` (3 to 64), `diameter` (across the corners; the first side is flat at the bottom) |
| `polyline` | `points` `[[x, y], ...]` (2 to 200; 3 or more when `closed`, which is the default), straight sides only |
| `line` | `from`, `to`, `construction` (a revolve axis, or a guide line left out of the profiles) |

Each shape carries the dimensions and constraints the sketcher's own tools give (a rectangle: horizontal and vertical sides, two
dimensions, a construction diagonal with a centre point), plus a position from the origin, so the sketch reads like one drawn by hand;
dimensions are named `d1`, `d2`, ... and can be used in expressions. Errors: `shapes[2].type must be one of rect, roundrect, circle, slot,
polygon, polyline, line`; `shapes[0].size must be [w, h] in mm, each more than 0`; `shapes[1].diameter must be a number of mm more than 0,
or an expression`; `shapes[0].radius must be more than 0 and less than half the smaller side (12.5 mm here)`; `shapes[3].length must be
more than its width`; `shapes[3].angle must be 0 or 90 (for other angles use a polyline)`; `shapes[4].sides must be a whole number from 3
to 64`; `shapes[5].points must be 2 to 200 [x, y] points in mm (3 or more when closed)`; `shapes[5] has a zero-length side at point 3`;
`shapes[0] has an unknown key "corner"; it takes center, size`; `shapes[0].center must be [x, y] in mm (numbers; expressions are for
sizes)`. **Size limit:** one `sketch` call may make at most 2000 points and 2000 entities in all, counted before anything is built: `this sketch would have 40000 points; the most is 2000 per call — split it into several sketches` (or `entities`). An expression (any length or angle given as text) is at most 200 characters: `shapes[0].diameter is too long; an expression can have at most 200 characters`. A number or expression that cannot be used: `shapes[1].diameter "W/0" does not give a usable number`. `on` errors: `on must be
"XY", "XZ", "YZ", {plane, offset} or {body, face}`, `on takes plane (and offset) or body and face, not both`, `offset must be a number of
mm`, `face "top" on Body 1 matches 3 faces; a sketch needs exactly one`, `face "hole" on Body 1 is not flat (it is a cylinder)`.

#### Selectors

A selector is at most 500 characters: `a selector can be at most 500 characters; this one has 507`. A word that is not in the grammar, such as `constructor`, gives the ordinary `unknown word` error.

A selector is text that picks faces (for `faces`, `shell`, `hole`, `sketch`) or edges (for `edges`, `fillet`, `chamfer`) by where they are,
in **world** coordinates, so "top" means up on the screen also for a body that was moved or turned.

```
selector := chain ( "or" chain )*
chain    := item ( "and" item )*
item     := "not" item | primary
primary  := "(" selector ")"
          | "edges of" item                  edge selectors only; the item is a face selector
          | "face" N | "edge" N              their own kind only
          | (">" | "<") AXIS [ "[" N "]" ]
          | ("|" | "#") AXIS
          | ("+" | "-") AXIS                 face selectors only
          | ALIAS [ "[" N "]" ]
          | TYPE | "all"
AXIS  := x | y | z            ALIAS := top (>Z) | bottom (<Z) | front (<Y) | back (>Y) | left (<X) | right (>X)
TYPE (faces) := plane | cylinder | cone | sphere | torus | other | hole       TYPE (edges) := line | circle | ellipse | other
```

- Case does not matter and spaces around the operators are optional (`> z`, `TOP`). Front is **-Y**: the app's XZ plane is the Front plane and looks along -Y.
- A chain starts from all faces (or all drawn edges) and each item narrows the set, left to right. `or` joins chains. `not X` removes what X picks from the current set; brackets work on the current set.
- `>Z` keeps the items whose centre is highest (within 0.01 mm); `<Z` the lowest. `>Z[1]` is the second level from the top (items whose centres differ by less than 0.01 mm are one level); a negative number counts from the other end, so `>Z[-1]` is the lowest level.
- `|Z` keeps flat faces whose normal, or straight edges whose direction, is within 1 degree of parallel to the axis; `#Z` within 1 degree of perpendicular. `+Z` and `-Z` (faces) keep flat faces that face that way.
- `plane`, `cylinder`, ... keep that type; `hole` keeps cylinder faces that are the wall of a hole; `all` keeps what there is.
- `edges of <face selector>` keeps the edges of those faces (it is evaluated on all the faces, then intersected with the current set of edges).
- `face 3` and `edge 3` pick an index (see `faces`, `edges`).
- An empty result throws `no faces match "<text>" on <name>` (or edges). Other errors: `empty selector`, `unexpected "<token>" at character <n> in "<text>"`, `unknown word "<word>"; use top, bottom, front, back, left, right, >Z, <Z, |Z, #Z, +Z, -Z, <types>, all, not, and, or, (, ), edges of, face N, edge N`, `"edges of" is for edges; this call takes faces`, `"circle" is an edge type; face types are plane, cylinder, cone, sphere, torus, other, hole` (and the mirror), `+Z and -Z are for faces; for edges use |Z or >Z`, `an index [n] only follows >X, <X ... or top, bottom, front, back, left, right`, `missing ")" in "<text>"`.

Example: `"edges of top and (>x or <x or >y or <y)"` is the four outer edges of the rim of a shelled box (the inner four of the ring are not the farthest in any direction).

#### What survives an edit

A selector is resolved **once, when you call**, against the shape as built, and the result is stored the way the app stores it: a
fillet's edges as the edge signatures the Fillet dialog stores, a shell's open faces as face centres, a hole's points in the body's own
coordinates. The selector text is not stored (a project file and a share link have no room for it, and every Advanced dialog rewrites its
feature from scratch). After an edit upstream, the engine finds the stored edges again by its own rules: first by the exact middle point,
else by the same position relative to the body's box and the same type, within 4 % of the box. A box whose width is bound to a parameter
and goes from 60 to 80 keeps its four outer top edges filleted, a shell's open face is the nearest face centre (within 5 % of the
diagonal: still the top), a hole keeps its place. What can fail: an edge whose place relative to the box moves by more than 4 % (an edge near a
hole at a fixed distance from a corner, after a large resize) can be lost (`Fillet: its edges no longer exist`) or move to a neighbour. Then undo and
call again, or call again with the same selector (keep your selectors, not your indices). After a parameter change, look at `faces` and `edges` again.

#### Example: a closed enclosure

```js
await JS3D.newDesign("advanced");
const sk = await JS3D.sketch({ on: "XY", name: "Base", shapes: [{ type: "rect", center: [0, 0], size: [60, 40] }] });
const { body } = await JS3D.extrude({ sketch: sk.sketch, dist: 25, name: "Enclosure" });
await JS3D.shell(body, { th: 2, open: "top" });
const f = await JS3D.fillet(body, "edges of top and (>X or <X or >Y or <Y)", 1);   // f.edges === 4
await JS3D.hole(body, { face: "bottom", points: [[-22, -12, 0], [22, -12, 0], [-22, 12, 0], [22, 12, 0]], size: "M3" });
await JS3D.ready();
```

The volume to expect: the box is 60 x 40 x 25 = 60000 mm3; the 2 mm shell with the top open takes out 56 x 36 x 23 = 46368, leaving 13632. A
fillet of radius 1 on the four outer rim edges takes r^2 (1 - pi/4) = 0.2146 mm3 per mm over 2 x 60 + 2 x 40 = 200 mm, 42.92, and the two
fillets at each of the 4 corners overlap in r^3 (1 - pi/2 + 2/3) = 0.0959, so the net is 42.92 - 0.38 = 42.54. The four M3 clearance holes (3.4 mm)
through the 2 mm floor take 4 x pi x 1.7^2 x 2 = 72.63. Total **13516.83 mm3**; the box stays `[-30, -20, 0]` to `[30, 20, 25]`.

### Parameters

| Call | What it does |
|---|---|
| `JS3D.setParam(name, expr, { unit })` → value | Adds the parameter, or changes it when the name exists (any capitals). `expr` is text such as `"40"`, `"w / 2"` or `"1in"`; `unit` is `"mm"` or `"in"` (what a bare number is read in). Returns the value in mm. Like the sidebar, an edit sets the unit afresh: leave `unit` out and the parameter is in mm, even if it was made in inches. Sizes whose new value is out of range (below 0.01 mm, for example) keep their last number, as in the app. A bad name throws the app's own message (for example `"d1" is a dimension name.`); an expression that does not give a number throws `expression did not evaluate` and nothing changes, not even the undo history. |
| `JS3D.removeParam(name)` → count | Deletes it. Sizes that used its name keep their value and lose the expression; the count is how many were freed. |
| `JS3D.bind(id, key, expr)` → size | Ties a plain shape's size (`key` is `"w"`, `"d"`, `"h"`...) to an expression, or frees it with `null`. Returns the size in mm after binding. |

### History, selection and view

| Call | What it does |
|---|---|
| `JS3D.undo()` / `JS3D.redo()` → label or `null` | One step. Refused in Chisel mode. |
| `JS3D.select(ids)` | Selects bodies (`[]` clears). |
| `JS3D.fit()` | Frames the selection, or everything when nothing is selected. |
| `JS3D.setMode("beginner" \| "advanced" \| "arch")` | Switches the mode. `"arch"` is Architect; the building is kept in the design (`doc.arch`) and the other modes keep their shapes, but the bridge has no calls for walls and openings yet. Since 2.4, leaving Architect for Beginner or Advanced also brings a drawn house along as shapes in the design (scaled down to fit the 256 mm build plate) and sends the camera back to the home view, so the body list can hold shapes you did not add. `"chisel"` is refused here. |
| `await JS3D.screenshot(opts)` → `Uint8Array` | A PNG of the 3D view, after waiting for `ready`. `opts.fit: true` frames everything shown first (ignoring the selection). `opts.width` (1 to 8192) makes the picture that many pixels wide with the same shape, drawn in the same step as the render; without it the picture is the size of the 3D view. |
| `await JS3D.screenshotDataURL(opts)` → string | The same (`fit` and `width` too) as a `data:image/png;base64,...` string (also async). In a background tab the browser runs no animation frames; the camera move for `fit` is then jumped to its end. |

### Checkpoints

`JS3D.checkpoint(label?)` saves the whole document in page memory and returns
`{id, label, bodies, at}`: a `c1`, `c2`, ... id, label (default empty), body count,
and ISO time. `JS3D.checkpoints()` lists this metadata. Only the latest 20 are
kept; checkpoints live in page memory only, so a reload loses them. Labels are
at most 200 characters. Checkpoint is refused in Chisel mode (`leave Chisel mode
first`) like other calls. Returned metadata cannot edit a snapshot.

`JS3D.diff(fromId, toId?)` returns readable lines comparing a checkpoint to now,
or to another checkpoint of the same design: bodies, features and their types, sketches, parameter
expressions, translation deltas in mm, colors, holes and visibility, and
added, removed or changed assets and media by id. Large other parts of the
document only say `Design <key> changed`. Output is at most 200 lines and 20 KB,
values are cut at 200 characters, and a long diff ends `...and N more changes`.
Identical designs return `No changes.`.

`JS3D.rollback(id)` restores the complete document as one undo step and returns
the checkpoint metadata. It is synchronous; call `ready()` before inspecting
geometry. Undo restores the newer state. Rollback keeps the current mode, is refused in the
3D Print Sim (`undo is off in the 3D Print Sim`), and overwrites a newer copy of
the design that was reloaded from another tab (undo in this tab brings it back).
The usual edit guards apply, including
`leave Chisel mode first`. A checkpoint from another design cannot be restored;
its metadata remains listed until eviction. Missing ids report the retained ids.
Checkpoint before risky edits, inspect the diff, and roll back on failure.

### Files

| Call | What it does |
|---|---|
| `await JS3D.export(kind, opts)` → `Uint8Array` | `kind` is `"stl"`, `"obj"`, `"3mf"`, `"glb"`, `"step"` or `"json"` (`"glb"` is binary glTF 2.0: one mesh and one base colour per body, in metres with Y up, the units stated in `asset.extras`). Waits for `ready` first. By default it exports every shown solid, like the Export menu with nothing selected; `opts.ids` names the bodies instead. STL, OBJ, 3MF and GLB bytes are identical to the menu's download; STEP bytes differ in the time stamp and an export counter inside the file (the tests blank both before comparing). Holes and hidden bodies are left out, also when named in `opts.ids`. It throws when there is nothing to export, and when a body has a build error (the menu would export its last good shape). `"json"` is `JSON.stringify(save(), null, 1)` as UTF-8 and ignores `ids`. |
| `await JS3D.load(json, { keepId })` | Opens a project (each `load` and `newDesign` adds an entry to "Your designs" in this browser, because the app saves the design it opens): `json` is the file's text, the parsed object, or a bare `doc`. It replaces the open design the way opening a project file does (new design id unless `keepId`, undo history cleared, saved in this browser), then waits for `ready`. A file that is not a project throws `not a JumpStart 3D project`. A body that would break the 3D view (no `id`, no `node`, no 16-number `m`) throws the same message with the reason. Nothing is changed when it throws. |
| `await JS3D.newDesign(mode)` | Starts an empty design (and adds an entry to "Your designs"), `"beginner"` (default) or `"advanced"` (not `"arch"`: switch with `setMode` afterwards). |

Bridge STL and 3MF exports follow the Export menu's quality setting, saved in localStorage as `jumpstart.exportQuality` and defaulting to Fine. They can therefore take longer: a very detailed design at Fine can take a couple of minutes. The app may show its "Making a smooth mesh…" toast, and falls back to the view mesh after 240 seconds. The MCP server's browser starts with a fresh profile, so it exports at Fine. OBJ, GLB and STEP exports are unchanged.

Example, the whole loop:

```js
const box  = JS3D.add("box", { size: [40, 30, 20] });
const hole = JS3D.add("cylinder", { size: [8, 8, 30], at: [0, 0, -5], hole: true });
const part = JS3D.group([box, hole], { name: "Block with hole" });
await JS3D.ready();
JS3D.get(part).volume;                       // 22994.69...
const stl  = await JS3D.export("stl");       // Uint8Array, 84 bytes + 50 per triangle
const file = await JS3D.export("json");      // the project file, as bytes
await JS3D.load(new TextDecoder().decode(file));
```

To save an export from the console, wrap the bytes in a download:
`const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([stl])), download: "part.stl" }); a.click();`

### Generators: Box Maker, gear sets, hardware, textures and drawings

All lengths are mm, angles degrees. Omitted or null settings use defaults. `at` is three finite numbers, default `[0,0,0]`; `name` is trimmed and may contain at most 256 characters; longer names throw `name can have at most 256 characters`. Each edit is one undo step and leaves the selection alone. Validation happens before the edit, so a refused call adds nothing. Call `await JS3D.ready()` before reading built sizes.

| Call and return | Options, defaults and errors | Undo label |
|---|---|---|
| `JS3D.boxMaker(opts = {})` → `{id, parts, cell, info}`; each part is `{id, name, kind}` | `style`: bin (default), drawer, tilt, door. `w` 10–1000 (120), `d` 10–1000 (80), `h` 5–1000 (40); for drawer, tilt and door cases the minima are 30, 30 and 20 mm respectively; `units`, `across` integers 1–8 (1). `cols` 1–20 for bin/door, 1–12 drawer, 1–8 tilt (3); `rows` 1–20 except drawer 1–12 (2). `shape`: square (default), round, hex. `wall`, `divider`, `floor` 0.4–20 (1.6, 1.2, 1.2); `radius` 0–100 (4), `inner` 0–50 (2); `scoop` true, `scoopR` 1–100 (10), `label` false, `labelW` 2–100 (10); `stack` false, `foot` 1–50 (3), `lid` false; `clear` 0–2 (0.25), `caseT` 1.2–20 (2.4). `lock`, `sideLock`: dovetail (default), pegs, none; `pull`: bar (default), knob, notch; `hinge`: left (default), right; `doorPull`: knob (default), hole, bar; `doorCatch`: none, light (default), firm. `layout`: assembled (default), print. Also `at`, `name`. Range, choice and flag errors follow the exact forms below. Too-small cells throw the library's `The compartments are too small: ...` message unchanged. | `Bin` |
| `JS3D.gearSet(opts = {})` → `{id, parts, info}`; each part is `{id, name}` | `type`: pair (default), rack, ring, planet, bevel, helical. `module` 0.3–10 (2), `width` 0.5–200 (8 for library types; bevel/helical use `JS3D.gear` defaults), `bore` 0 for none; `at`. Library types: `teeth` integer 6–300 (20), `teeth2` integer 6–400 (40); planet uses `sunTeeth`, `planetTeeth` integers 8–200 (18,12), `planets` integer 2–6 (3). `backlash` 0–1 (0.15), `pressureAngle` 14.5,20,25 (20), `boreShape` round (default), d, hex, key; `joints` true. Rack alone: `rackLength` 0–2000 (0 gives max(8,teeth) teeth), `rackHeight` 2–100 (8). Pair/ring take teeth and teeth2; rack takes teeth; planet takes its three planet settings. Bevel/helical take teeth and teeth2 (default 20 and the same as teeth), `clear` as `JS3D.gear`; helical also takes `angle` 5–30 (20), `hand` right (default) or left; the second gets the opposite hand. Errors: `<k> is not used for type "<type>"`; `pressureAngle must be 14.5, 20 or 25 (degrees)`; `a ring gear needs at least 8 more teeth than its pinion (teeth2 at least teeth + 8)`; `bore must be 0 (none) or from 0.5 to <max> mm for these gears` or `bore must be 0 (none): these gears are too small for a bore`. Here max is the smaller of module × (smallest relevant tooth count − 4.5) and 1.6 times its root radius, rounded down to 0.1 mm; planetary sets also limit the bore to half the planet root diameter. Planet sets require sun + ring teeth divisible by the planet count and more than 0.5 mm clearance between adjacent planet tips. Bevel/helical: `<teeth or teeth2> must be a whole number from 12 to 90 for a bevel gear` or `... from 12 to 30 for a helical gear`; all other `JS3D.gear` errors above pass through unchanged. | `Gears`, `Bevel gear pair`, `Helical gear pair` |
| `JS3D.hardware(opts = {})` → id | Required `part`: hexbolt, shcs, button, flat, set, wood, rod, nut, nyloc, sqnut, washer, lockw, insert, dowel; required `size` from that part's metric or inch list (`M3`, `1/4-20`; the latter is stored as `1/4"-20`). `length` 1–300, default the library's roughly three diameters, only for screws/rods/dowels. `threads` false, `clear` −1–0 (design's thread offset), `left` false; `at`, `name`. The lowest point rests on at's z. Errors: `part must be one of: <ids joined by comma and space>`; `unknown size "<size>" for part "<part>"; sizes: <available sizes>`; `length is not used for part "<part>"`; `length must be a number from 1 to 300 (mm)`; `part "<part>" has no thread`; `threads must be true or false`; `left must be true or false`; `clear must be a number from -1 to 0 (mm)`; `Too many turns (<n>; the most is 150). Make it shorter or pick a larger size.` | `Add fastener` |
| `JS3D.textures()` → `[{key, name, category, size}]` | Lists every built-in texture and its default tile size. No options or edits. | none |
| `await JS3D.texture(id, opts = {})` → `{body, texture, faces}` | `texture` key (knurl); `faces` "all" (default), a non-empty selector such as "top", an index ≥0, or a non-empty list of selectors/indices, resolved individually and combined without duplicate faces. `size` 0.5–100 (texture's size, otherwise 4), `depth` 0.05–3 (0.6), `dir`: raise (default), engrave, both; `rotation` −180–180 (0), `mapping`: auto (default), planar, cylindrical, triplanar; `edgeBlend` 0–10 (0), `invert`, `once` false. Returns faces "all" or the number chosen; texture is the new layer id. Errors: `unknown texture "<key>"; list_textures (JS3D.textures()) gives the <count> keys`; `faces must be "all", a face selector such as "top", a face index or a list of indices`; `<name> is marked as a hole; textures go on solid bodies`; `<name> already has 16 textures; remove one in the Texture dialog first`; `<name> has a build error: <msg>`; `<name> could not be built`; `faces <JSON selector> matches no face of <name>`. Selector errors pass through from `JS3D.faces`. | `Texture` |
| `await JS3D.drawing(opts = {})` → DXF `Uint8Array` | `ids` limits bodies (one id or a list); holes and hidden bodies are omitted. `views` is a non-empty list of distinct top/front/right, default all three, always drawn in that order; Top above Front, Right beside it. `scale` 0.01–100 (1 full size), `units` mm (default) or in; `dims` false adds overall size lines when true. Errors: `views must be a list of "top", "front" and "right"`; `scale must be a number from 0.01 to 100 (1 is full size)`; `units must be "mm" or "in"`; `dims must be true or false`; `nothing to draw: holes and hidden shapes are left out`; `"<name>" has a build error (<msg>); fix it before drawing`; `could not draw: <names joined by comma and space>`; `Drawings need CAD bodies: <names> came from a mesh (STL/3MF/OBJ). Leave them out of the selection, or use Mesh to STEP first.`; `Nothing to draw.`; `Cancelled.`. Geometry-engine errors pass through unchanged. | none |

Unknown options throw `unknown option "<k>"; options: <keys joined by comma and space>`. The option order is: boxMaker `style, w, d, h, units, across, cols, rows, shape, wall, divider, floor, radius, inner, scoop, scoopR, label, labelW, stack, foot, lid, clear, lock, sideLock, caseT, pull, hinge, doorPull, doorCatch, layout, at, name`; gearSet `type, module, teeth, teeth2, sunTeeth, planetTeeth, planets, width, bore, boreShape, backlash, pressureAngle, rackLength, rackHeight, joints, clear, angle, hand, at`; hardware `part, size, length, threads, clear, left, at, name`; texture `texture, faces, size, depth, dir, rotation, mapping, edgeBlend, invert, once`; drawing `ids, views, scale, units, dims`.

For the ranges in the table the exact numeric error is `<key> must be a number from <min> to <max> (mm)`; rotation uses `(degrees)`. Counts use `<key> must be a whole number from <min> to <max>`. Flags use `<key> must be true or false`. Choices use `<key> must be "first", "second" or "last"` in the order listed (two choices have only `or`); for example `style must be "bin", "drawer", "tilt" or "door"`. Positions use `at must be [x, y, z] in mm`. Missing bodies use `no body <id>`. The existing mode and body-id checks still apply.

The saved parts use the dialog's own structures: double-click to edit Box Maker or hardware parts; library gear sets open in the Gears dialog. Bevel and helical pairs use the existing sketch/Loft builder; change their tooth settings by undoing and calling again. Textures change only the mesh: STL, 3MF, OBJ and GLB include them; STEP and measured solid volumes do not. A textured design cannot go in a share link yet. Chosen texture faces use 9.1's selectors, resolved once into body-local face signatures; indices are valid until the next edit.

```js
const drawers = JS3D.boxMaker({ style: "drawer" });
const rack = JS3D.gearSet({ type: "rack", at: [160, 0, 0] });
const screw = JS3D.hardware({ part: "shcs", size: "M3", length: 10 });
const box = JS3D.add("box", { size: [40, 30, 20] });
await JS3D.texture(box, { texture: "knurl", faces: "top" });
const dxf = await JS3D.drawing({ views: ["top"] });
```

This adds no `code_cad` MCP tool (`run_script` can reach `JS3D.codeCad`), set-update call, Quick Hinge call, picture texture, texture-removal call or `export("dxf")`. Undo and call again, or use the dialogs, to change sets; hubs and lightening holes stay off in calls and can be added in the Gears dialog. Use `rotate_bodies` to turn sets. The tap cutter stays in `JS3D.fastener`; `hardware` is separate. Texture share links and textured STEP are outside this change.

### Scripts, and the link to a tool server

**Recipes and the command line.** `jumpstart build design.json --export stl` (`mcp/cli.mjs`, see `mcp/README.md`) runs a design headless on your own computer: the file is a project or a recipe, a JSON list of `{ "call", "args", "as" }` steps that go through `invoke` with `"$name"` standing for an earlier step's result. See `examples/recipes/open-box.json`.

| Call | What it does |
|---|---|
| `await JS3D.run(text)` → value | Runs script text with `JS3D` and `app` in scope and returns what the script returns: the last statement's value of a plain script (a promise is awaited), or the `return` value of a script with top-level `await`. It is what Open/Export › Run script… uses. Same trust as the console. |
| `JS3D.connect(url = "ws://127.0.0.1:8822")` | Opens a WebSocket to a tool server on this computer (`mcp/server.mjs`, see `mcp/README.md`), answers its calls and retries every 3 seconds while on. Throws if `url` is not `ws://` or `wss://`. |
| `JS3D.disconnect()` | Closes the link and stops retrying. |
| `JS3D.connection()` → `{ on, url, state }` | `state` is `"off"`, `"waiting"` (on, no server yet) or `"connected"`. |
| `await JS3D.invoke(call, args)` | Plumbing: runs `JS3D[call](...args)` and returns the result, with a `Uint8Array` as `{"$bytes": base64}`. Refuses `internals`, itself and anything that is not a call. The WebSocket link and the server's headless browser both go through it. |

Nothing connects unless asked: the page makes no connection until `connect` is called or the **Connect to AI agent** row in the theme menu (◐) is turned on. That row is remembered in this browser (`jumpstart.agent`, "on" or "off", off by default) and connects to the default address when the page loads. There is no web address parameter.

The link, in text frames of JSON: the page sends `{"hello":"jumpstart-3d","version":"1.12","app":"2.0","url":<page address>}` once it is open. The server sends `{"id":1,"call":"add","args":["box",{"size":[40,30,20]}]}`; the page answers `{"id":1,"result":...}` or `{"id":1,"error":"message"}`. Calls run one at a time, in the order they arrive. A `Uint8Array` result is `{"$bytes": base64}`. The server accepts one page at a time: a second page that says hello is closed with code 4001, and the page then switches its link off and does not retry (the remembered setting stays on). Recent Chrome and Edge ask before the website may reach a program on this computer ("local network access"); allow it. The single file is not asked.

### The whole loop for an agent

Call these MCP tools in order (use the id returned by `add_shape` as `id`):

1. `new_design`: `{"mode":"advanced"}`; then `add_shape`: `{"kind":"box","size":[60,40,25],"at":[0,0,0]}`.
2. `shell_body`: `{"id":id,"th":2,"open":"top"}`; then `fillet_edges`: `{"id":id,"edges":"edges of top and (>x or <x or >y or <y)","r":1}`.
3. `add_holes`: `{"id":id,"face":"bottom","points":[[-22,-12,0],[22,-12,0],[-22,12,0],[22,12,0]],"size":"M3"}`. Leaving depth out makes the holes through.
4. `inspect_bodies` with `{"material":"pla"}` should report bounds [-30,-20,0] to [30,20,25], volume about 13516.83 mm³ and weight about 16.76 g at 100% infill. `check_print` should have no problems (review any warnings); `check_collisions` should have no pairs. `section_view` with `{"axis":"z","at":10}` should report about 384 mm².
5. `export_file` with `{"kind":"stl","path":"/path/to/enclosure.stl"}` writes the result.

Check each tool result for an error before continuing. The headless end-to-end test is `mcp/test/proof.test.mjs`.

### What the bridge does not do

- It does not check wall thickness or slice; `printCheck` is a quick check, not a slicer.
- It builds Beginner shapes (the 20 kinds), groups, scale and parameters, and the Advanced calls above (sketches, extrude, revolve,
  fillet, chamfer, shell, holes, patterns). Sweeps, lofts, mirrors, split, emboss, threads, construction planes and sketch
  constraints other than the ones the shapes make have no call yet: write or generate a project file (Part 2) and `load` it, or use `run`.
  The fillet and shell selections are stored the way the app stores them, not as selector text.
- It does not push, publish or save anything outside this browser. `load`
  does save the opened design in this browser's storage, as opening a file does.

## Part 2: The project file format

A project is one JSON document. This part was written by looking at real files:
the 38 designs in `test/projects/`, designs built with `JS3D` and saved with
`JS3D.save()`, and what the app does with each file after `JS3D.load` and a
save. Each table says what was seen; **not checked** marks what was not.

### The file

```json
{ "app": "jumpstart-3d", "version": 1, "doc": { ... } }
```

The Export menu and `JS3D.save()` write this envelope (the menu indents with one
space). Opening a file accepts either the envelope or the bare `doc`: the app
reads `file.doc` if there is one, else the whole file. All 38 designs in
`test/projects/` are bare docs. `version` is always 1 in what the app writes;
nothing reads it (not checked beyond the code that writes and opens files).

To be opened, the `doc` must have a `bodies` array and a `sketches` array
(`[]` is fine). Anything else missing is filled in.

### The design (`doc`)

| Key | Meaning |
|---|---|
| `v` | Always `1`. |
| `id` | The design's id (a string). Opening a file gives it a new one (`load` keeps it with `keepId`). |
| `name` | Title. `"Untitled"` when missing. |
| `mode` | `"beginner"`, `"advanced"` or `"chisel"`; the mode the design opens in. When missing, a design with sketches or with `extrude`, `revolve`, `fillet`, `chamfer`, `hole`, `shell` or `bool` in it counts as `"advanced"` and anything else `"beginner"`. |
| `created` | Milliseconds since 1970. |
| `seq` | A counter. Each new body, sketch or feature takes the next number as its `seq`. |
| `grid` | `1`. |
| `bodies` | The shapes, see below. |
| `sketches` | Sketches, see below. `[]` for a Beginner design. |
| `planes`, `joints` | Construction planes and joints. `[]` in every test design. Their fields: **not checked**. |
| `params` | Named parameters `[{ id, name, expr, value }]` and `unit: "in"` when typed in inches. `id` is any unique string (the app makes `q…`); `value` is the cached result in mm (the app recomputes it on load). Parameters are evaluated top to bottom: each sees only the ones above it. Added as `[]` when missing. |
| `ver` | Optional. The Save button's version counter. |
| `assets` | Optional. Imported files: `{ "<id>": { kind: "step", name, data } }`, `data` being the file in base64. A `mesh` or `step` node points at one. Seen for one STEP design; the STL form: **not checked**. |
| `texImages` | Optional, texture pictures. **Not checked.** |

Loading a file and saving it again changed only three things across all 31
test designs: `params: []` was added where missing, sketch dimensions without a
`name` were given `d1`, `d2`..., and a `_key` was added to each body (next
section). Nothing else moved.

### A body (`doc.bodies[]`)

| Key | Meaning |
|---|---|
| `id` | String, unique in the design. **Required.** |
| `node` | What the body is, see below. **Required.** |
| `m` | 16 numbers, three.js column-major, the body's place: `[r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, x, y, z, 1]`. Translation is entries 12, 13, 14; the identity is `[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]`. **Required** (a body without one makes the 3D view throw; `JS3D.load` refuses it). A turn of 30° about z gives `[0.866, 0.5, 0, 0, -0.5, 0.866, 0, 0, 0, 0, 1, 0, x, y, z, 1]`. |
| `name` | Shown in lists. Optional (a body with none loads). |
| `color` | `"#rrggbb"`. When missing the body is grey (`#a7b0ba`). |
| `hole` | `true`: it cuts instead of adding (inside a group, and it is never exported on its own). |
| `hidden` | `true`: not drawn, not exported. |
| `seq` | Creation order, see `doc.seq`. Optional. |
| `locked` | Optional, `true` makes the mouse tools leave it alone. |
| `brick` | Optional, `{ layer, size }` on a body made with the brick tool (seen: `{"layer":0,"size":"2x2"}`). |
| `appearance`, `textures`, `sculpt` | Optional looks and Chisel data. **Not checked.** |
| `_key` | **Not part of the design.** The app caches the kernel's name for the built shape here (it is the body's `node` as text). Files from the Export menu contain it, which makes them larger; it can be deleted. `JS3D.save()` and `JS3D.doc()` leave it out. |

A hand-written minimal body, as the test helpers write them (`test/helpers.mjs`
`body()` and `prim()`):

```json
{ "id": "b1", "name": "Box", "seq": 1, "color": "#3b82c4", "hole": false, "hidden": false,
  "m": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "node": { "t": "prim", "kind": "box", "p": { "w": 20, "d": 20, "h": 20, "r": 0, "c": 0 }, "mods": [] } }
```

Seen to work (loaded, built, volume right): leaving out `name`, `color`,
`hole`, `hidden`, `seq`, `mods`, and the `r`, `c` of a box or cylinder. Seen to
break or be wrong: no `m` (the view throws), no `node` (throws), a node
without `p` (builds a zero-size shape, no error), an unknown shape `kind` (the
body shows the error `Unknown shape: teapot`; nothing else is affected), and
an `m` shorter than 16 (loads, but it is not a valid place).

A minimal whole file:

```json
{ "bodies": [ { "id": "b1", "m": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
                "node": { "t": "prim", "kind": "box", "p": { "w": 20, "d": 20, "h": 20 } } } ],
  "sketches": [] }
```

(Loaded as Beginner, called `Untitled`, a 20 mm cube. Seen with the loader's
fill-ins: `v`, `id`, `name`, `mode`, `created`, `seq`, `grid`, `planes`, `joints`
and `params` all appear after loading.)

### A node (`body.node`, and a group child's `node`)

Every node has `t`, its type, and `mods`, the list of features applied to it
in order (an empty list, or absent, for none). Types seen in the test designs:

| `t` | Fields | Notes |
|---|---|---|
| `prim` | `kind`, `p`, `mods`, optional `exprs`, `exprUnits` | A Beginner shape. `kind` is one of the 20 in `JS3D.kinds()` (the test designs use `box`, `cylinder`, `sphere`, `cone`, `text`). `p` holds the sizes; the keys for each kind are the `defaults` that `kinds()` returns (`w`, `d`, `h` plus extras such as `r`, `c` for a box's corner round and chamfer, `top` for a cone, `sides` for a pyramid or prism, `wall` for a tube, `tube` for a torus, `turns`, `wire` for a spring; `text` uses `text`, `size`, `h`, `font`). The shape is built upward from z = 0, centred on x and y. A torus keeps `d` equal to `w`. `exprs` ties a size to an expression: `{ "w": "w", "h": "w2 + 1" }` (the value in `p` is then recomputed from the parameters). `exprUnits` is `{ "w": "in" }` for a bare number typed in inches. |
| `group` | `children: [{ node, m, hole, name, color }]`, `mods`, optional `op` | A combination. Each child is a node with its own matrix `m` and `hole` flag; the group's `m` on the body is usually the identity. Solids are joined and holes cut out. `op: "intersect"` keeps what the children share. (The `JS3D.group` option `"cut"` makes the first child a solid and the others holes; it is saved as exactly that.) |
| `extrude` | `sketch`, `profiles`, `dist`, `mode`, `dist2`, `mods`, optional `exprs` | `sketch` is a sketch id. `profiles` lists the closed regions of that sketch to extrude: `{ key, pt }`, where `key` is the region's entity ids sorted and joined with commas (`"e0,e1,e2,e3"`) and `pt` is a point `[x, y]` inside it in sketch coordinates. One test design uses hand-made keys (`"lens"`, `"rect-only"`); how a key that matches no region is handled: **not checked**. `mode` is `"one"` (distance `dist` along the sketch normal, the default), `"sym"` (`dist` split both ways) or `"two"` (`dist` one way and `dist2` the other), from `kernel.js`. |
| `revolve` | `sketch`, `profiles`, `axis`, `angle`, `mods` | `axis` is `"X"`, `"Y"`, `"Z"` (world axes; the ones seen) or the id of a line in the sketch (from `store.js` resolveNode). `angle` in degrees (360 seen). |
| `sweep` | `sketch`, `profiles`, `path: { sketch, ents }`, `orient`, `dist`, `taper`, `twist`, `chain`, `mods` | One design. `path.ents` are entity ids in the path sketch. Meanings of `orient`, `taper`, `twist`, `chain`: **not checked** (seen `"perp"`, 0, 0, true). |
| `loft` | `sections: [{ sketch, ref: {key, pt} }]`, `rail`, `ruled`, `closed`, `mods` | One design. **Other fields not checked.** |
| `pipe` | `section`, `size`, `edgeSegs` or `path`, `hollow`, `wall`, `mods` | A tube along a path. **Not checked beyond the one design.** |
| `coil` | `d`, `turns`, `mode`, `h`, `pitch`, `angle`, `section`, `size`, `pos`, `left`, `mods` | One design (`mode: "height"`). **Not checked beyond that.** |
| `mirror` | `srcBody`, `plane: { o, n }`, `mods` | A live mirror of another body, by id. |
| `mesh`, `step` | `asset`, `k`, `mods` | An imported STL or STEP. `asset` is a key of `doc.assets`. |

### Features (`node.mods[]`)

Each is `{ id, seq, t, ... }`: `id` (a string, unique in the body; the app
makes `f…`) and `seq`. `t` is the type. What was seen in the test designs:

| `t` | Fields seen |
|---|---|
| `fillet` | `r` (radius, mm), `edges: [{ a, b, m, n, t }]` (each edge is described by its end points, middle point, a normal-like vector and a curve type such as `"LINE"`, in the body's own coordinates, and is matched against the shape's edges by position; when none match the body shows the error `Fillet: its edges no longer exist`), optional `exprs`. The kernel also reads `sets` when present (a list of `{ edges, r, ... }`). |
| `chamfer` | `d`, `edges` (as for fillet). |
| `hole` | `kind` (`"simple"`, `"csink"` seen), `dia`, `through`, `depth`, `tapped`, `pitch`, `clear`, `tip`, `at: [{ p, n }]` (point and direction for each hole, in the body's coordinates), and for `csink` also `cbDia`, `cbDepth`, `csDia`, `csAngle`. Optional `exprs`. |
| `shell` | `th` (wall thickness), `faces` (faces to open, `[{ c: [x, y, z] }]`, a point on each). Optional `exprs`. |
| `emboss` | `str`, `size`, `font`, `depth`, `mode` (`"emboss"` seen; the kernel also reads `"deboss"`), `kind` (`"plane"` seen), `p`, `n`. |
| `thread` | `face: { c, t: "CYLINDRE" }`, `pitch`, `length`, `flip`, `left`, `clear`. |
| `bool` | `op` (`"cut"` seen; the kernel also reads `"intersect"`, and anything else means join), `tool` (a node), `m` (the tool's matrix). |
| `scale` | `k: [kx, ky, kz]`, `o: [ox, oy, oz]`: a stretch of the body in its own frame, `x' = k·x + o`. The kernel stretches most shapes exactly; for the ones it cannot restretch (a torus, text or spring stretched unevenly, for example) it falls back to a faceted copy. |
| `pattern` | Documented in `test/README.md` (rectangular and circular, `what: "feats"` or `"shape"`, `feats` the ids of earlier mods repeated). Seen in `advanced-pattern-mod.json`. |
| `offset`, `halfspace` (Split with a plane), `sketchsplit` (Split with a sketch) | The kernel reads them (`kernel.js`), but no test design has one. **Not checked.** |

Features that ask for a value can carry `exprs` (and `exprUnits`) as for a
shape's `p`: `{ "exprs": { "dist": "t" } }` on an extrude or revolve (keys
`dist`, `dist2`, `angle`), `r`, `d`, `dia`, `depth`, `th` on the others, and
`n1`, `s1`, `n2`, `s2`, `cn`, `angle` on a pattern. The stored number is
recomputed from the parameters on every load and edit; a binding that gives
an unusable number is skipped and the stored number stays.

### Sketches (`doc.sketches[]`)

| Key | Meaning |
|---|---|
| `id`, `name`, `seq` | As for bodies. |
| `plane` | `{ o: [x,y,z], x: [..], n: [..] }`: origin, the sketch's x direction and its normal, in world coordinates. The sketch's y direction is `n × x`: with `n = [0,0,1]` and `x = [1,0,0]` the sketch lies on the floor; with `n = [0,-1,0]` it stands up in the x–z plane with y pointing up. |
| `pts` | `[{ id, x, y }]` points in sketch coordinates (mm). |
| `ents` | Shapes drawn on the points: `{ id, t: "line", a, b }`, `{ id, t: "circle", c, r }` `{ id, t: "arc", c, a, b }` (counter-clockwise from `a` to `b`) and `{ id, t: "point", p }` (`a`, `b`, `c`, `p` are point ids; a circle's `r` is a number). `cons: true` on an entity makes it construction (a guide: left out of the profiles). Other entity types (splines, text, ...): **not checked**. |
| `cons` | Optional constraints: `{ id, t: "origin", p }`, `fixed`, `horizontal` and `vertical` (`{ e1 }` or `{ p1, p2 }`), `parallel`, `perpendicular` and `equal` (`{ e1, e2 }`), `coincident` and `midpoint` (`{ p, e }`), `tangent` (`{ e1, e2 }`), and a dimension `{ id, t: "dim", k, ..., v, off, expr }` with `k` `"dist"` (`p1`, `p2`, `o` `"h"`, `"v"` or `"a"`), `"pl"`, `"ll"` (`e1`, `e2`), `"dia"`, `"rad"` (`e1`) or `"ang"`. `v` is the value in mm; `expr` is optional text using parameters, and `name` (`d1`, `d2`... added when missing) lets other expressions use the dimension. `JS3D.sketch` writes the kinds above. Anything else in the file, and how the solver reads `o`, `off`: **not checked**. |
| `hidden` | `true` hides the sketch lines. |

A sketch ties to a body only through the `sketch` id in an extrude, revolve,
sweep or loft node. Deleting a body (`JS3D.remove`) also deletes the sketches
that only it used.

### What to remember when writing a file by hand

- Required: `bodies` and `sketches` arrays on the doc; `id`, `node` and a
  16-number `m` on each body; for a `prim`, `kind` and `p` with `w`, `d`, `h`.
- Give every body and every feature its own `id`; the extrude's `sketch` and a
  group child's references use ids.
- Sizes are mm, angles degrees, the up direction is +z.
- Check the result with `await JS3D.load(json)` then `JS3D.list()`: a body that
  the geometry engine rejects shows its message in `error`.
