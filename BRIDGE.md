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
- A call that names a body that does not exist throws `Error("no body <id>")`.
  Bad input throws an `Error` with a plain message that says what to change.
- While Chisel mode is open, every call that edits or loads throws `leave Chisel mode first` (`setMode` is how you leave it).
- Everything is synchronous except `ready`, `export`, `screenshot`,
  `screenshotDataURL`, `load`, `newDesign`, `run` and `invoke`, which return promises.
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
| `JS3D.version` | `"1.8"`. The last number goes up when calls are added; the first changes when a call changes shape. |
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

### Making and changing shapes

| Call | What it does |
|---|---|
| `JS3D.add(kind, opts)` → id | Adds a shape. `opts`: `size` (`{w, d, h, ...}` or `[w, d, h]`; keys other than the ones `kinds()` lists for that kind are refused; `w`, `d`, `h` and `size` must be at least 0.01; `sides` and `points` whole numbers of at least 3), `at` (`[x, y, z]`, default `[0, 0, 0]`), `hole` (true makes it a hole), `color` (`"#rrggbb"`), `name`. An unknown kind throws and lists the valid ones. Undo label `Add box` (and so on). |
| `JS3D.fastener(opts)` → id | Adds a threaded fastener as one body. `opts`: `type` (`"bolt"`, `"nut"`, `"rod"` or `"cutter"`), `size` (metric `M2.5 M3 M4 M5 M6 M8 M10 M12`, or inch `#6-32 #8-32 #10-24 #10-32 1/4-20 1/4-28 5/16-18 5/16-24 3/8-16 3/8-24 1/2-13 1/2-20`), `length` (mm; for a bolt it is the length under the head; not used for a nut; at least 3 thread turns, at most 150), `clear` (print offset in mm, `-1` to `0`, default `0`; `-0.2` suits most printers), `left` (true for a left-hand thread), `at` (`[x, y, z]`, default `[0, 0, 0]`; the base of the part sits at z), `name`. A bolt is a group of a hex head and a shank with a Thread feature; a nut is a hex prism with a hole and a Thread feature; a rod is a cylinder with a Thread feature; a cutter is a rod that is a hole and is built wider instead of thinner: its diameter grows by four times the print offset, so the hole it cuts is as loose as a nut with that offset, and the Thread print offset tool leaves it alone. Grouping it with a solid cuts a threaded hole. Building takes a few seconds: `await JS3D.ready()`. Bad input throws a plain message (`unknown size "M7"; sizes: ...`). Undo label `Add M8×30 bolt` (and so on). |
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

### Files

| Call | What it does |
|---|---|
| `await JS3D.export(kind, opts)` → `Uint8Array` | `kind` is `"stl"`, `"obj"`, `"3mf"`, `"glb"`, `"step"` or `"json"` (`"glb"` is binary glTF 2.0: one mesh and one base colour per body, in metres with Y up, the units stated in `asset.extras`). Waits for `ready` first. By default it exports every shown solid, like the Export menu with nothing selected; `opts.ids` names the bodies instead. STL, OBJ, 3MF and GLB bytes are identical to the menu's download; STEP bytes differ in the time stamp and an export counter inside the file (the tests blank both before comparing). Holes and hidden bodies are left out, also when named in `opts.ids`. It throws when there is nothing to export, and when a body has a build error (the menu would export its last good shape). `"json"` is `JSON.stringify(save(), null, 1)` as UTF-8 and ignores `ids`. |
| `await JS3D.load(json, { keepId })` | Opens a project (each `load` and `newDesign` adds an entry to "Your designs" in this browser, because the app saves the design it opens): `json` is the file's text, the parsed object, or a bare `doc`. It replaces the open design the way opening a project file does (new design id unless `keepId`, undo history cleared, saved in this browser), then waits for `ready`. A file that is not a project throws `not a JumpStart 3D project`. A body that would break the 3D view (no `id`, no `node`, no 16-number `m`) throws the same message with the reason. Nothing is changed when it throws. |
| `await JS3D.newDesign(mode)` | Starts an empty design (and adds an entry to "Your designs"), `"beginner"` (default) or `"advanced"` (not `"arch"`: switch with `setMode` afterwards). |

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

### Scripts, and the link to a tool server

| Call | What it does |
|---|---|
| `await JS3D.run(text)` → value | Runs script text with `JS3D` and `app` in scope and returns what the script returns: the last statement's value of a plain script (a promise is awaited), or the `return` value of a script with top-level `await`. It is what Open/Export › Run script… uses. Same trust as the console. |
| `JS3D.connect(url = "ws://127.0.0.1:8822")` | Opens a WebSocket to a tool server on this computer (`mcp/server.mjs`, see `mcp/README.md`), answers its calls and retries every 3 seconds while on. Throws if `url` is not `ws://` or `wss://`. |
| `JS3D.disconnect()` | Closes the link and stops retrying. |
| `JS3D.connection()` → `{ on, url, state }` | `state` is `"off"`, `"waiting"` (on, no server yet) or `"connected"`. |
| `await JS3D.invoke(call, args)` | Plumbing: runs `JS3D[call](...args)` and returns the result, with a `Uint8Array` as `{"$bytes": base64}`. Refuses `internals`, itself and anything that is not a call. The WebSocket link and the server's headless browser both go through it. |

Nothing connects unless asked: the page makes no connection until `connect` is called or the **Connect to AI agent** row in the theme menu (◐) is turned on. That row is remembered in this browser (`jumpstart.agent`, "on" or "off", off by default) and connects to the default address when the page loads. There is no web address parameter.

The link, in text frames of JSON: the page sends `{"hello":"jumpstart-3d","version":"1.8","app":"2.0","url":<page address>}` once it is open. The server sends `{"id":1,"call":"add","args":["box",{"size":[40,30,20]}]}`; the page answers `{"id":1,"result":...}` or `{"id":1,"error":"message"}`. Calls run one at a time, in the order they arrive. A `Uint8Array` result is `{"$bytes": base64}`. The server accepts one page at a time: a second page that says hello is closed with code 4001, and the page then switches its link off and does not retry (the remembered setting stays on). Recent Chrome and Edge ask before the website may reach a program on this computer ("local network access"); allow it. The single file is not asked.

### What the bridge does not do

- It builds Beginner shapes (the 20 kinds), groups, scale and parameters.
  Sketches, extrudes, fillets and the other Advanced features are not
  available as calls. To get an Advanced design in, write or generate a
  project file (Part 2) and `load` it.
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
| `ents` | Shapes drawn on the points: `{ id, t: "line", a, b }`, `{ id, t: "circle", c, r }` and `{ id, t: "arc", c, a, b }` (`a`, `b`, `c` are point ids; a circle's `r` is a number). Other entity types (splines, text, ...): **not checked**. |
| `cons` | Optional constraints: `{ id, t: "origin", p }`, `{ id, t: "horizontal", e1 }`, `{ id, t: "vertical", e1 }`, and a dimension `{ id, t: "dim", k, p1, p2, o, v, off, expr }`. `v` is the value in mm; `expr` is optional text using parameters, and `name` (`d1`, `d2`... added when missing) lets other expressions use the dimension. `k` was `"dist"` in the test designs. Other constraint types and dimension kinds, and how the solver reads `o`, `off`: **not checked**. |
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
