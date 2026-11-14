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

## Version promise

`JS3D.apiVersion` is a version in major.minor.patch form. `JS3D.version`
remains the major.minor form and keeps working.

Within 1.x, documented calls and properties will not be removed or renamed.
Accepted inputs will not start being refused. Defaults, units and types will
not change. A synchronous call will not become asynchronous.
A minor version can add calls, options or result fields. A patch fixes
behaviour to match these docs.

Generators reject unknown options, as do shape size keys and sketch shape keys.
`add` ignores unknown top-level options today. Other calls can differ.
Pass only documented options; an option the docs do not list is not covered by the promise.

Error message wording may improve in any release. Do not match exact message
text. Use `JS3D.supports(name)` to check whether a call exists.

This promise does not cover `internals`, the exact triangle mesh, generated
IDs, timestamps, or raw project fields beyond those documented in Part 2.

A deprecation will be announced in a minor version in the API changelog and
in `describe()`, using `deprecatedSince` and `replacement` fields. The old
call will keep working for at least 12 months and two minor versions. Removal
will happen only in 2.0. Nothing is deprecated today. `delete` remains an
alias of `remove`.

## Reference: every call

One entry per call: what it takes, what it returns, when it fails, an example and the version that added it.
`JS3D.describe()` returns the same list (names, areas, signatures, versions) while the app runs, and `JS3D.supports(name)` checks one call.
A test (`test/api-docs.test.mjs`) fails when a call in the code has no entry here, or an entry names a call the code does not have.

| Area | Calls |
|---|---|
| Discovery and waiting | [ready](#api-ready), [supports](#api-supports), [describe](#api-describe) |
| Reading | [kinds](#api-kinds), [list](#api-list), [get](#api-get), [doc](#api-doc), [save](#api-save), [params](#api-params), [mode](#api-mode), [selection](#api-selection) |
| Shapes | [add](#api-add), [fastener](#api-fastener), [holePattern](#api-holePattern), [gear](#api-gear), [namePlate](#api-namePlate), [codeCad](#api-codeCad), [knurl](#api-knurl), [spring](#api-spring) |
| Editing | [remove](#api-remove), [delete](#api-delete), [duplicate](#api-duplicate), [move](#api-move), [moveTo](#api-moveTo), [rotate](#api-rotate), [resize](#api-resize), [scale](#api-scale), [setHole](#api-setHole), [setColor](#api-setColor), [rename](#api-rename), [setHidden](#api-setHidden), [group](#api-group), [ungroup](#api-ungroup) |
| Parameters | [setParam](#api-setParam), [removeParam](#api-removeParam), [bind](#api-bind) |
| History and view | [undo](#api-undo), [redo](#api-redo), [select](#api-select), [fit](#api-fit), [setMode](#api-setMode), [screenshot](#api-screenshot), [screenshotDataURL](#api-screenshotDataURL) |
| Files | [export](#api-export), [load](#api-load), [newDesign](#api-newDesign) |
| Scripts and agent link | [run](#api-run), [invoke](#api-invoke), [connect](#api-connect), [disconnect](#api-disconnect), [connection](#api-connection) |
| Advanced CAD | [sketch](#api-sketch), [extrude](#api-extrude), [revolve](#api-revolve), [fillet](#api-fillet), [chamfer](#api-chamfer), [shell](#api-shell), [hole](#api-hole), [pattern](#api-pattern), [faces](#api-faces), [edges](#api-edges) |
| Inspection | [inspect](#api-inspect), [measure](#api-measure), [printCheck](#api-printCheck), [collisions](#api-collisions), [section](#api-section) |
| Generators | [boxMaker](#api-boxMaker), [gearSet](#api-gearSet), [hardware](#api-hardware), [textures](#api-textures), [texture](#api-texture), [drawing](#api-drawing) |
| Checkpoints | [checkpoint](#api-checkpoint), [checkpoints](#api-checkpoints), [diff](#api-diff), [rollback](#api-rollback) |
| Properties | [version](#api-version), [apiVersion](#api-apiVersion), [appVersion](#api-appVersion), [internals](#api-internals) |

### Reference: Discovery and waiting

<a id="api-ready"></a>
#### `JS3D.ready(timeoutMs = 90000) -> Promise<undefined>`
Waits until the design is fully built, so that the sizes, boxes and volumes in `list()` and every measuring call can be trusted. A script that adds a shape and then reads it calls this in between.
- **Arguments:** `timeoutMs`: how long to wait before giving up, in ms, default 90000. It looks every 50 ms.
- **Returns:** `undefined`, once every shown shape has been built or has a build error, and the geometry engine has nothing left to do (no shape building, no queue, and no Combine or Group still staging).
- **Errors:** throws after `timeoutMs` and names the shapes still building (or says the geometry engine is busy). The fix is to wait longer, to give the heavy feature (a fine thread, a fillet with a large radius) more time, or to look at those bodies' `error` in `list()`. A shape whose definition cannot be read at all (a hand-written file with a broken node) is never sent to the engine, so `ready` does not wait for it and `list()` shows its error instead.
- **Example:** `const id = JS3D.add("box", {size: [20, 20, 20]}); await JS3D.ready(); JS3D.get(id).volume; // 8000`
- **Since:** 1.0 · async: every shown shape is built (or has an error) and the engine is idle, checked every 50 ms · does not change the design

<a id="api-supports"></a>
#### `JS3D.supports(name) -> boolean`
Tells a tool whether a call exists before trying it, so a script written for a newer page can fall back or stop instead of failing. It looks the name up and never runs the call.
- **Arguments:** `name`: the call's name as text, such as `"add"`; the `JS3D.` prefix is not part of it.
- **Returns:** `true` only for the calls this bridge has, that is the names `describe()` lists (76 of them in 1.13, and `"delete"` counts as the same call as `remove`). `false` for the four properties (`version`, `apiVersion`, `appVersion`, `internals`), for an unknown name, for a name the object inherits rather than has (`toString`, `hasOwnProperty`), for a different capitalisation (`"Add"`), and for anything that is not text (`null`, a number, an array).
- **Errors:** none; a name that is not text is simply `false`.
- **Example:** `if (JS3D.supports("checkpoint")) JS3D.checkpoint("before the edit");`
- **Since:** 1.13 · synchronous · does not change the design

<a id="api-describe"></a>
#### `JS3D.describe() -> {apiVersion, version, appVersion, calls, properties}`
Gives a tool the whole API in one object: every call with its area, version, arguments and a link to its entry, plus the four properties. It says nothing about the open design, so the answer is the same on every design and before any shape exists.
- **Arguments:** none.
- **Returns:** `{apiVersion, version, appVersion, calls, properties}`. `apiVersion` is the full API version, `"1.13.1"` (major.minor.patch). `version` is the same as `JS3D.version`, `"1.13"` (major.minor). `appVersion` is the app's own version, such as `"2.9.8.2"`. `calls` is a list sorted by name, one `{name, area, since, async, signature, docs}` for each call: `name` without the `JS3D.` prefix; `area` the part of this reference it is in (`"Shapes"`, `"History and view"`, ...); `since` the API version that added it (`"1.0"`); `async` `true` when the call returns a promise; `signature` its arguments and result as text, also without the prefix (`"add(kind, [opts]) -> string"`); `docs` the link to its entry here (`"BRIDGE.md#api-add"`). `properties` is a list sorted by name, one `{name, since, value}` for each property: `value` is a short text saying what the property holds (for `version`, `the API version as "major.minor"`). Both lists are fresh copies, so changing one changes nothing for the next call. In 1.13 there are 76 calls and 4 properties.
- **Errors:** none; it takes no arguments and reads nothing from the design.
- **Example:** `JS3D.describe().calls.filter((c) => c.async).map((c) => c.name);   // ["chamfer", "codeCad", ...]`
- **Since:** 1.13 · synchronous · does not change the design

### Reference: Reading

<a id="api-kinds"></a>
#### `JS3D.kinds() -> [{kind, defaults}]`
The shape kinds `add` accepts, each with the sizes it starts with. Use it to check a kind name, or to find out which size keys that kind has before you pass `size`.
- **Arguments:** none.
- **Returns:** an array of 20 `{kind, defaults}` objects, always in this order: `box`, `cylinder`, `sphere`, `cone`, `pyramid`, `wedge`, `torus`, `tube`, `hemisphere`, `prism`, `text`, `star`, `heart`, `roof`, `roundroof`, `paraboloid`, `gem`, `spring`, `capsule`, `arrow`. `kind` is the name to give `add`. `defaults` holds that shape's size keys and their starting values: `w`, `d`, `h` in mm, plus the keys that shape has — `r` (corner radius) and `c` (chamfer), `sides` or `points` (whole counts), `top`, `tube`, `wall`, `inner`, `turns`, `wire`, and for text `text` (a string), `font` (a string) and `size` (mm). It is a fresh copy: changing it changes nothing.
- **Errors:** none.
- **Example:** `JS3D.kinds().find((k) => k.kind === "torus").defaults` → `{ w: 20, d: 20, h: 4, tube: 4 }`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-list"></a>
#### `JS3D.list() -> [{id, name, kind, hole, hidden, locked, color, position, bbox, volume, error, children?}]`
Every body in the design, holes and hidden ones too, as one entry each. The quickest way to see what is there and where it is.
- **Arguments:** none.
- **Returns:** an array of `{id, name, kind, hole, hidden, locked, color, position, bbox, volume, error}`, one per body. `id` is the string to pass as `ids`. `name` is its name, or `undefined` if omitted in a loaded body. `kind` is the shape kind for a basic shape (`"box"`, `"cylinder"`...) and the body's type for the rest (`"group"`, `"extrude"`, `"revolve"`...). `hole` and `hidden` are true or false. `locked` is the mouse guard; `codeCad` also refuses to update a locked body. `color` is `"#rrggbb"` or `undefined` if omitted in a loaded body. `position` is `[x, y, z]` in mm, the translation in the body's matrix. `bbox` is the world box derived from mesh vertices `{min: [x, y, z], max: [x, y, z]}` in mm, rounded to 0.0001 mm, or `null` while the body is still being built or has an error. `volume` is mm³ rounded to 0.001, or `null` for the same reason. It is copied from the built geometry without applying the matrix determinant, so a loaded scaled matrix can make it differ from world volume. `error` is the geometry engine's message or `null`. A group entry also has `children`, the number of parts in it.
- **Errors:** none.
- **Example:** `JS3D.list().filter((b) => !b.hidden).map((b) => b.name)`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-get"></a>
#### `JS3D.get(id) -> {...list entry, node, m}`
One body in full: the same entry `list()` gives, plus its definition and its matrix. Use it to read how a body was made (sizes, features, group parts) before copying or changing it.
- **Arguments:** `id`: one body id (a single string; not a list).
- **Returns:** an object with every field of a `list()` entry, plus `node` and `m`. `node` is a deep copy of the body's definition: `{t: "prim", kind, p, mods}` for a basic shape (`p` holds its sizes, `mods` its features), `{t: "group", children, mods}` for a group (each child has `node`, `m`, `hole`, `name`, `color`), and the body's type with its own fields for CAD bodies such as `extrude` or `revolve` — Part 2 has every field. `m` is the 16-number matrix, column-major; its position is `m[12..14]`. The optional name and color, mesh-derived bounds and scaled-matrix volume limitation described under `list` also apply here. Changing the result changes nothing.
- **Errors:** throws when the id is not a body in the design.
- **Example:** `const id = JS3D.add("box"); JS3D.get(id).node.p.h; // 20`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-doc"></a>
#### `JS3D.doc() -> object`
A copy of the whole design document: everything a project file saves. Use it to inspect the design as data, or to keep a copy before a big change (`save()` gives it in file form).
- **Arguments:** none. (An internal option, `{shareAssets: true}`, keeps imported file data shared instead of copying it; checkpoints use it. Leave it out.)
- **Returns:** the Part 2 design object as a plain object: `v` (always 1), `id`, `name`, `mode` (`"beginner"`, `"advanced"`, `"arch"` or `"chisel"`), `created` (milliseconds since 1970), `seq` (the counter new bodies, sketches and features take numbers from), `grid`, `bodies`, `sketches`, `planes`, `joints` and `params`, plus `ver`, `assets` (imported files, base64) and `texImages` when the design has them. The 3D view's own cache (`_key`) is taken off every body. Part 2 describes each part. It is a deep copy: changing it changes nothing.
- **Errors:** none.
- **Example:** `JS3D.doc().bodies.length`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-save"></a>
#### `JS3D.save() -> {app, version, doc}`
The design wrapped as a project file, the same thing the Export menu writes. Nothing is downloaded or stored: you get the object (or `JSON.stringify` it yourself).
- **Arguments:** none.
- **Returns:** `{app: "jumpstart-3d", version: 1, doc}`. `app` is the file's name tag, `version` is the file format (always 1 — it is not `JS3D.version`), and `doc` is exactly what `doc()` gives.
- **Errors:** none.
- **Example:** `JS3D.save().version` → 1
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-params"></a>
#### `JS3D.params() -> [{name, expr, value, unit}]`
The named parameters, in the order they were added. Each parameter sees only the ones above it.
- **Arguments:** none.
- **Returns:** an array of `{name, expr, value, unit}`. `name` is the parameter's name, `expr` the text it was set to (such as `"60"` or `"Width / 2"`), `value` its result in mm (`null` when the expression does not work any more), and `unit` `"mm"` or `"in"` — what a bare number in `expr` is read in when it contains no parameter name. If it contains a parameter name, bare numbers are read in mm regardless of `unit`.
- **Errors:** none.
- **Example:** ``JS3D.params().map((p) => `${p.name} = ${p.value} mm`)``
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-mode"></a>
#### `JS3D.mode() -> string`
Which mode the app is in. The bridge has no calls for the modes it is not in: Chisel refuses every edit, and Architect keeps the building apart from the bodies.
- **Arguments:** none.
- **Returns:** `"beginner"`, `"advanced"`, `"arch"` (Architect) or `"chisel"`. `setMode` is how you change it.
- **Errors:** none.
- **Example:** `JS3D.mode() === "advanced"`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-selection"></a>
#### `JS3D.selection() -> [id]`
The bodies the person has selected. Useful to work on what is selected instead of guessing ids.
- **Arguments:** none.
- **Returns:** an array of body ids, in the order the app holds them; `[]` when nothing is selected. `select(ids)` sets it.
- **Errors:** none.
- **Example:** `JS3D.selection().length`
- **Since:** 1.0 · synchronous · does not change the design

### Reference: Shapes

<a id="api-add"></a>
#### `JS3D.add(kind, {size, at, hole, color, name}) -> id`
Adds a primitive shape.
- **Arguments:** `kind` is one of `box`, `cylinder`, `sphere`, `cone`, `pyramid`, `wedge`, `torus`, `tube`, `hemisphere`, `prism`, `text`, `star`, `heart`, `roof`, `roundroof`, `paraboloid`, `gem`, `spring`, `capsule`, or `arrow`. `JS3D.kinds()` lists each kind's size keys and defaults. `size` is an object of those keys or `[w, d, h]` in mm; omitted keys use the kind's defaults. `w`, `d`, `h`, and `size` must be at least 0.01; `sides` and `points` are integers at least 3. Other numeric size keys must be finite and nonnegative; `text` and `font` must be nonempty strings. For a torus, `d` is always set to `w`, even when `d` is supplied separately. `at` is a three-number position in mm, default `[0, 0, 0]`. `hole` marks a cutting body, default false. `color` is `"#rrggbb"`, default an automatic color. `name` is the body name, default an automatic name.
- **Returns:** The new body id string.
- **Errors:** Throws for an unknown kind, invalid size keys or values, position or color, or while an editing mode blocks changes. Supply valid values or leave the mode first.
- **Example:** `JS3D.add("box", {size: [40, 30, 20]})`
- **Since:** 1.0 · synchronous · one undo step

<a id="api-fastener"></a>
#### `JS3D.fastener({type, size, length, clear, left, at, name}) -> id`
Adds a threaded bolt, nut, rod or tap cutter.
- **Arguments:** `type` is `"bolt"`, `"nut"`, `"rod"` or `"cutter"`; `size` is a supported metric or inch thread size, such as `"M3"` or `"1/4-20"`. `length` is required in mm except for a nut, and must be at least three pitches with rounded turn count at most 150. `clear` is the print offset in mm, -1 to 0, default 0, capped per part by pitch. `left` selects a left-hand thread, default false. `at` is `[x, y, z]` in mm, default `[0, 0, 0]`, with the base at z. `name` optionally overrides the generated name.
- **Returns:** The body id string; a cutter is marked as a hole.
- **Errors:** Throws for unsupported type or size, invalid dimensions, offset or position, too few or too many turns, or a blocked editing mode. Use a supported size and adjust length or leave the mode.
- **Example:** `JS3D.fastener({type: "bolt", size: "M8", length: 30})`
- **Since:** 1.2 · synchronous · one undo step

<a id="api-holePattern"></a>
#### `JS3D.holePattern({body, face, layout, hole}) -> Promise<{id, holes, dropped, sketch?}>`
Cuts a pattern into a flat face as one feature.
- **Arguments:** `body` is the solid body id; `face` is `"+x"`, `"-x"`, `"+y"`, `"-y"`, `"+z"` or `"-z"`. `layout` is a grid `{type: "grid", cols, rows, pitch, margin, stagger, angle}` or circle `{type: "circle", count, radius, start, center, margin}`. Grid `cols` and `rows` are integers 1–200; `pitch` is a positive mm number or `[column, row]`, omitted to spread holes; `stagger` defaults false and `angle` defaults 0 degrees. Circle `count` is an integer 2–200, `radius` is positive mm, `start` defaults 0 degrees, and `center` is a world `[x, y, z]` in mm, default face center. `margin` is nonnegative mm, default 0. `hole` has `shape` (`"round"` default, `"square"`, `"hex"`, `"slot"`), `depth` (positive mm; omitted for through). Round holes accept `kind` (`"simple"` default, `"cbore"`, `"csink"`, `"tapped"`), `size` (supported preset, e.g. `"M3"`), `dia`, `tip`, `cbDia`, `cbDepth`, `csDia`, `csAngle`, `pitch`, `clear`. A round hole requires `dia` or a `size` preset; a tapped hole without a preset also requires `pitch`. `dia`, `cbDia`, `cbDepth`, `csDia`, and `pitch` are positive mm; `tip` selects a drill-point bottom and defaults false. Without a preset, counterbore diameter and depth default to 6.5 and 3.3 mm, countersink diameter to 6.9 mm, and `csAngle` to 90 degrees (allowed 1–179). Tapped `clear` is -1 to 0 mm, default design thread offset. Presets fill dimensions; supplied values override them. Non-round holes require positive `width` in mm; hex width is measured across flats; slots also require `length` greater than width. The chosen face is the flat face within one degree of the world direction that lies farthest along it; ties within 0.01 mm go to the largest area. Grid axes lie in the face frame, centered on its bounding rectangle; `angle` turns those axes. At most 200 plain or shaped holes, 130 counterbores or countersinks, or 8 tapped holes.
- **Returns:** `{id, holes, dropped, sketch?}`: the feature id, number made, number outside the face, and the hidden sketch id for non-round holes.
- **Errors:** Rejects missing or unbuildable bodies, hole bodies, invalid face, layout or hole settings, overlaps, too many holes, or a pattern with no fitting holes. Show and repair the body, choose a flat face, and adjust the pattern. Editing modes can also block the call.
- **Example:** `const id = JS3D.add("box", {size: [40, 40, 20]}); await JS3D.holePattern({body: id, face: "+z", layout: {type: "grid", cols: 2, rows: 2}, hole: {dia: 3}})`
- **Since:** 1.3 · async: waits for geometry to build · one undo step

<a id="api-gear"></a>
#### `JS3D.gear({kind, module, teeth, width, angle, hand, mate, base, bore, keyway, clear, at, name}) -> id`
Adds a gear or rack with hidden construction sketches.
- **Arguments:** `kind` is `"spur"` (default), `"helical"`, `"bevel"`, or `"rack"`. `module` is required, 0.3–10 mm (the normal module for helical gears); `teeth` is required, integer 12–200 for spur, 12–30 helical, 12–90 bevel, 2–100 rack. `width` is positive mm, default 6; bevel defaults to the smaller of 6 and a third of the cone height rounded down to 0.1 mm, and cannot exceed that third; helical width also has a geometry-dependent maximum. Helical `angle` is 5–30 degrees, default 20, and `hand` is `"right"` (default) or `"left"`. Bevel `mate` is partner teeth, integer 12–200, default `teeth`. Rack `base` is positive mm, default 5. Other gears accept `bore` 0 (default, none) or at least 1 mm, leaving `max(1, module)` mm under teeth. `keyway` is a boolean, default false, spur only, requiring a 6–58 mm bore and enough wall. `clear` is 0 to the smaller of 0.5 and module/4 mm, default the smaller of 0.1 and module/4. `at` is `[x, y, z]` in mm, default origin; `name` defaults to a generated name.
- **Returns:** The new body id string.
- **Errors:** Throws for invalid or incompatible options, insufficient wall, excessive width, invalid position, or blocked editing. Adjust the specified dimensions or leave the editing mode.
- **Example:** `JS3D.gear({module: 2, teeth: 20})`
- **Since:** 1.5 · synchronous · one undo step

<a id="api-namePlate"></a>
#### `JS3D.namePlate({text, font, size, style, depth, thickness, margin, shape, holes, holeDia, color, textColor, at, name}) -> {plate, textBody, size}`
Adds a plate fitted to a line of text, raised or cut in.
- **Arguments:** `text` is required, trimmed, one line of 1–40 supported characters. `font` is `"sans"` (default), `"serif"` or `"mono"`; `size` is capital height 2–100 mm, default 10. `style` is `"raised"` (default) or `"cut"`; `depth` is 0.2–10 mm, default 1. `thickness` is 0.6–20 mm, default 3; cut text requires at least 0.8 mm thickness and leaves at least 0.6 mm beneath it. `margin` is 1.5–20 mm, default 3; `shape` is `"rounded"` (default) or `"pill"`. `holes` is `"hang"` (default), `"none"` or `"screws"`; `holeDia` is 1 mm to plate depth minus 3 mm, default 5 for hang or 3.5 for screws, and must be omitted (or null) with `holes: "none"`. `color` is `"#rrggbb"`, default `"#2b7bb9"`; `textColor` is for raised text only, default `"#ffffff"`. `at` is `[x, y, z]` in mm, default origin, with plate centered in x and y and base at z; `name` defaults to a name based on text.
- **Returns:** `{plate, textBody, size}`: plate id, raised text body id or null for cut text, and `[width, depth, height]` in mm.
- **Errors:** Throws for invalid or unsupported text, invalid options, holes that cannot fit, insufficient thickness, or blocked editing. Change the text or dimensions and try again.
- **Example:** `JS3D.namePlate({text: "Workshop", holes: "none"})`
- **Since:** 1.6 · synchronous · one undo step

<a id="api-codeCad"></a>
#### `JS3D.codeCad({code, bindings, name, bodyId}) -> Promise<id>`
Builds one solid from replicad code in a temporary worker and saves it as a STEP body.
- **Arguments:** `code` is a function body string of at most 100,000 characters, receiving `replicad` and `params` and returning one closed solid in mm. `bindings` optionally maps up to 20 code parameter names to design parameter names or ids. Each alias is at most 40 characters, starts with a letter, underscore or dollar sign, and then uses letters, digits, underscores or dollar signs; `__proto__` is forbidden. `name` optionally names the body and is trimmed to 80 characters. `bodyId` optionally updates a previous Code CAD body in place, keeping its id, position and later features.
- **Returns:** The created or updated body id string.
- **Errors:** Rejects invalid code or bindings, a non-solid or multiple solids, failed or cancelled builds, concurrent builds, locked update targets, STEP files over 50 MB, worker startup over 90 seconds, or code execution over 25 seconds. Read-back and geometry waiting follow those limits. It also rejects if the design id or load generation changes, linked parameter ids or values change, or the update target is removed, locked, or changes its asset or Code CAD recipe during the build. Correct the code or retry. Editing modes can block the call. Code runs as trusted JavaScript with browser access.
- **Example:** `await JS3D.codeCad({code: "return replicad.makeBox([0, 0, 0], [10, 10, 10]);"})`
- **Since:** 1.7 · async: waits for the worker and geometry build · one undo step; selects the resulting body

<a id="api-knurl"></a>
#### `JS3D.knurl({diameter, length, grooves, depth, bore, boreSize, at, name}) -> id`
Adds a straight-grooved knob with an optional bore.
- **Arguments:** `diameter` is 6–150 mm, default 20; `length` 1–200 mm, default 15. `grooves` is an integer 8–120, default rounded circumference in mm, limited to that range. `depth` is at least 0.1 mm and radius × (1 − cos(π/grooves)) rounded up to 0.001 mm, and at most diameter/4 rounded down to 0.001 mm. The default π × diameter / grooves / 2 is rounded to 0.001 mm. `bore` is `"none"` (default), `"round"`, `"hex"`, or `"d"`; `boreSize` is 1 mm to the maximum leaving 1 mm under the roots, default 5 (8 for hex), and must be omitted (or null) with `bore: "none"`. With root radius = diameter/2 − depth, the maximum is 2 × (root radius − 1), or √3 × (root radius − 1) for hex, rounded down to 0.001 mm. Hex size is across flats. `at` is `[x, y, z]` in mm, default origin, axis at x/y and base at z. `name` defaults to a generated name.
- **Returns:** The body id string.
- **Errors:** Throws for invalid dimensions, disappearing grooves, a bore that does not fit, invalid position, or blocked editing. Adjust the size or leave the mode.
- **Example:** `JS3D.knurl({diameter: 20, bore: "round", boreSize: 5})`
- **Since:** 1.7 · synchronous · one undo step

<a id="api-spring"></a>
#### `JS3D.spring({wire, outside, freeLength, turns, hand, ends, color, at, name}) -> id`
Adds a round-wire compression spring.
- **Arguments:** `wire` is 0.4–10 mm, default 2; `outside` is 2–200 mm and at least five wire diameters, default 20; `freeLength` is 1–300 mm, default 30. `turns` is 2–10 in half-turn steps, default 5. `hand` is `"right"` (default) or `"left"`; `ends` is `"open"` (default) or `"flat"`. `color` is `"#rrggbb"`, default `"#7d8a96"`. `at` is `[x, y, z]` in mm, default origin, axis at x/y and base at z; `name` defaults to a generated name. Coils need at least 5% of wire thickness as axial gap; pitch is at most 1.5 times the wire centerline circumference, and wire length at most 600 wire thicknesses.
- **Returns:** The body id string.
- **Errors:** Throws for invalid options, touching coils, excessive steepness or wire length, or blocked editing. Adjust the spring or leave the mode.
- **Example:** `JS3D.spring({wire: 2, outside: 20, freeLength: 30, turns: 5})`
- **Since:** 1.8 · synchronous · one undo step

### Reference: Editing

<a id="api-remove"></a>
#### `JS3D.remove(ids) -> number`
Deletes bodies. Sketches that only they used (drawn on their faces, or used only by their features) go with them.
- **Arguments:** `ids`: one body id or an array of ids. A repeated id counts once.
- **Returns:** how many bodies were deleted (the number of distinct ids).
- **Errors:** throws while Chisel, CosForge or Chip Carving is open (leave them first); when no ids are given; or when an id is not in the design. An open dialog is cancelled first, and nothing is deleted when it throws.
- **Example:** `const id = JS3D.add("box"); JS3D.remove(id); // 1`
- **Since:** 1.0 · synchronous · one undo step ("Delete")

<a id="api-delete"></a>
#### `JS3D.delete(ids) -> number`
The same function as `remove` (in fact `JS3D.delete === JS3D.remove`): deleting bodies, and returning how many. Use whichever name reads better; both stay.
- **Arguments:** `ids`: one body id or an array of ids.
- **Returns:** how many bodies were deleted.
- **Errors:** the same as `remove`: Chisel, CosForge or Chip Carving open; no ids; an id that is not in the design.
- **Example:** `const id = JS3D.add("box"); JS3D.delete(id); // 1`
- **Since:** 1.0 · synchronous · one undo step ("Delete")

<a id="api-duplicate"></a>
#### `JS3D.duplicate(ids, [offset]) -> string[]`
Copies bodies. A copy keeps everything the original has (sizes, features, colour, hole and hidden flags, group parts) and gets a new id, a new place in the stack and a new name with the next free number ("Base 3" when "Base 1" and "Base 2" exist).
- **Arguments:** `ids`: one body id or an array of ids. `offset`: `[dx, dy, dz]` in mm, the copy's shift along the world axes; default `[0, 0, 0]`, which puts the copy exactly on the original.
- **Returns:** an array of the new ids, in the order of `ids`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given; when an id is not in the design; or when `offset` is not three numbers.
- **Example:** `const id = JS3D.add("box"); JS3D.duplicate(id, [25, 0, 0])[0]`
- **Since:** 1.0 · synchronous · one undo step ("Duplicate")

<a id="api-move"></a>
#### `JS3D.move(ids, [dx, dy, dz]) -> undefined`
Moves bodies by an offset along the world axes. The usual way to space parts out (`duplicate` with an offset does it in one step).
- **Arguments:** `ids`: one body id or an array of ids. `[dx, dy, dz]`: the shift in mm along world x, y and z; any sign, any size.
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given; when an id is not in the design; or when the offset is not three numbers.
- **Example:** `const id = JS3D.add("box"); JS3D.move(id, [0, 0, 5])`
- **Since:** 1.0 · synchronous · one undo step ("Move")

<a id="api-moveTo"></a>
#### `JS3D.moveTo(id, pos) -> undefined`
Puts one body's position at a point, whatever its turn. This moves the body's own origin: for a shape made by `add`, the middle of its footprint at its base height.
- **Arguments:** `id`: one body id (a single string; not a list). `pos`: `[x, y, z]` in world mm, the new translation in the body's matrix (`m[12..14]`).
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the id is not in the design; or when `pos` is not three numbers.
- **Example:** `const id = JS3D.add("box"); JS3D.moveTo(id, [0, 0, 20])`
- **Since:** 1.0 · synchronous · one undo step ("Move")

<a id="api-rotate"></a>
#### `JS3D.rotate(ids, axis, degrees, [opts]) -> undefined`
Turns bodies about a world axis, right-hand rule (for `"z"`, a positive angle turns +x toward +y). Several bodies turn together about one point when you pass `opts.about`.
- **Arguments:** `ids`: one body id or an array of ids. `axis`: `"x"`, `"y"` or `"z"` (any capitals) or a vector `[x, y, z]` in world mm — it is normalized, so `[1, 0, 1]` is a valid diagonal axis and `[0, 0, 0]` is refused. `degrees`: the angle, any number; negative turns the other way, and values over 360 just keep turning. `opts.about`: `[x, y, z]` in world mm, the point that stays put; default the middle of the bodies' world box, which needs them built (call `await JS3D.ready()` first, or pass `about`).
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given or an id is not in the design; when the axis is not one of those words or three numbers with a length; when `degrees` is not a number; when `about` is not three numbers; and, without `about`, when a body is still being built (or has a build error). No timing surprises: with `about` the result is worked out from the numbers you give.
- **Example:** `const id = JS3D.add("box"); await JS3D.ready(); JS3D.rotate(id, "z", 90)`
- **Since:** 1.0 · synchronous · one undo step ("Rotate")

<a id="api-resize"></a>
#### `JS3D.resize(id, size) -> undefined`
Sets the sizes of one plain shape — a basic shape with no features and no scale. It changes the shape's definition, not a transform, so the 3D view rebuilds it.
- **Arguments:** `id`: one body id. `size`: `{w, d, h, ...}` with the keys that kind has (`kinds()` lists them, for example `r` and `c` on a box, `sides` on a pyramid, `tube` on a torus), or `[w, d, h]` as a shorthand for a kind that has a `w`. `w`, `d`, `h` and `size` must be at least 0.01 mm; other numbers 0 or more; `sides` and `points` whole numbers of 3 or more. A torus keeps `d` equal to `w`. A size that was tied to an expression is freed and keeps the number you give. String size keys such as `text` and `font` must be nonempty. For a torus, `d` is reset to `w`.
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the id is not in the design; when the body is not a plain shape (a body with any feature, such as a fillet or a scale, needs `scale` or undo first); when `size` is not an object; when the kind has no such key (the message lists the keys it has); when `[w, d, h]` is used on a kind without a `w` (text); or when a size value does not meet the rules above.
- **Example:** `const id = JS3D.add("box"); JS3D.resize(id, {w: 8, d: 8, h: 30})`
- **Since:** 1.0 · synchronous · one undo step ("Resize")

<a id="api-scale"></a>
#### `JS3D.scale(ids, k, [opts]) -> undefined`
Stretches bodies, plain or not. It adds a Scale feature to the body, worked out in the body's own frame — the same feature the Beginner size handles make, so the dialogs still show it.
- **Arguments:** `ids`: one body id or an array of ids. `k`: one number (the same in every direction) or `[kx, ky, kz]`, along the body's **own** axes (on a turned body they are not the world's). Every factor must be more than 0; 1 leaves that direction alone; under 1 shrinks. `opts.about`: `[x, y, z]` in world mm, the point that stays put; default the middle of the bodies' world box, which needs them built (`await JS3D.ready()` first, or pass `about`).
- **Returns:** `undefined`. Scaling back by `1/k` about the same point removes the feature again.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given or an id is not in the design; when `k` is not a positive number or three positive numbers; when `about` is not three numbers; and, without `about`, when a body is still being built or has a build error. After a scale the body is no longer a plain shape, so `resize` and `bind` refuse it until you undo or scale back.
- **Example:** `const id = JS3D.add("box"); await JS3D.ready(); JS3D.scale(id, [1, 1, 2])`
- **Since:** 1.0 · synchronous · one undo step ("Scale")

<a id="api-setHole"></a>
#### `JS3D.setHole(ids, hole) -> undefined`
Makes bodies holes, or makes them solid again. A hole cuts away what it overlaps inside a group and is left out of exports.
- **Arguments:** `ids`: one body id or an array of ids. `hole`: `true` to make holes, `false` to make solids — exactly a boolean, not `1` or `"true"`.
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given or an id is not in the design; or when `hole` is not `true` or `false`.
- **Example:** `const id = JS3D.add("box"); JS3D.setHole(id, true)`
- **Since:** 1.0 · synchronous · one undo step ("Make hole" / "Make solid")

<a id="api-setColor"></a>
#### `JS3D.setColor(ids, color) -> undefined`
Sets the colour of bodies, the one the 3D view and the 3MF export use. A group is drawn in its own colour; the colours of its parts are kept inside it for `ungroup`.
- **Arguments:** `ids`: one body id or an array of ids. `color`: exactly `"#rrggbb"` — six hex digits, capitals allowed. Not the short form `"#f00"` and not a colour name.
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given or an id is not in the design; or when the colour is not `"#rrggbb"`. Nothing changes when it throws.
- **Example:** `const id = JS3D.add("box"); JS3D.setColor(id, "#2b7bb9")`
- **Since:** 1.0 · synchronous · one undo step ("Color")

<a id="api-rename"></a>
#### `JS3D.rename(id, name) -> undefined`
Renames one body. The name shows in the body list and in `list()`.
- **Arguments:** `id`: one body id. `name`: a non-empty string; spaces at both ends are trimmed, the rest is kept as typed. Names need not be unique — the app only avoids repeats when it makes objects itself.
- **Returns:** `undefined`.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the id is not in the design; or when the name is empty or not a string.
- **Example:** `const id = JS3D.add("box"); JS3D.rename(id, "Front plate")`
- **Since:** 1.0 · synchronous · one undo step ("Rename")

<a id="api-setHidden"></a>
#### `JS3D.setHidden(ids, hidden) -> undefined`
Hides bodies from the 3D view and from exports, or shows them again. Handy to get parts out of the way, or out of a picture and a file.
- **Arguments:** `ids`: one body id or an array of ids. `hidden`: `true` to hide, `false` to show — exactly a boolean.
- **Returns:** `undefined`. A hidden body stays in `list()` with `hidden: true` and can be shown again at any time.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when no ids are given or an id is not in the design; or when `hidden` is not `true` or `false`.
- **Example:** `const id = JS3D.add("box"); JS3D.setHidden(id, true)`
- **Since:** 1.0 · synchronous · one undo step ("Hide" / "Show")

<a id="api-group"></a>
#### `JS3D.group(ids, [opts]) -> string`
Combines two or more bodies into one new body: solids are joined and holes are cut out of them, the same group the app's Group button makes. The parts leave the body list and the group takes their place.
- **Arguments:** `ids`: two or more body ids. `opts` (`{name, op}`): `name`, the group's name — default `"Group N"`, or `"Hole group N"` when every part is a hole; `op` — leave it out to join, `"intersect"` keeps only what all parts share, `"cut"` cuts every other part out of the first id in `ids`. With `op` the group takes the name of the part it keeps (for `"cut"`, the first id) unless you give one.
- **Returns:** the new group's id (a string). A group's own position stays `[0, 0, 0]` (the parts keep their places inside it), so read `bbox` for where it is.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when fewer than two ids are given; when an id is not in the design; or when `op` is neither `"intersect"` nor `"cut"`.
- **Example:** `const box = JS3D.add("box"); const cavity = JS3D.add("box", {hole: true, size: [10, 10, 10]}); JS3D.group([box, cavity], {name: "Enclosure"})`
- **Since:** 1.0 · synchronous · one undo step ("Group")

<a id="api-ungroup"></a>
#### `JS3D.ungroup(id) -> string[]`
Splits a group back into its parts, as new bodies in the same places, and removes the group. The way back from `group`.
- **Arguments:** `id`: one group id.
- **Returns:** an array of the new part ids.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the id is not in the design; when the body is not a group; when the group carries features other than a scale (fillets, holes... — they would be lost, so remove them or undo first); or when the group was stretched at an angle, so it cannot be split back into shapes. Nothing changes when it throws.
- **Example:** `const a = JS3D.add("box"); const b = JS3D.add("box"); const group = JS3D.group([a, b]); JS3D.ungroup(group)`
- **Since:** 1.0 · synchronous · one undo step ("Ungroup")

### Reference: Parameters

<a id="api-setParam"></a>
#### `JS3D.setParam(name, expr, [opts]) -> number`
Adds a named parameter, or changes one that already has that name (in any capitals). Sizes bound with `bind` follow it, so a design can be driven by a few numbers.
- **Arguments:** `name`: a string. A new name uses letters, digits and `_` and starts with a letter or underscore; a unit word (`mm`, `cm`, `m`, `in`, `ft`, `deg`) and a dimension name such as `d1` are refused; a name already taken (any capitals) edits that parameter instead. `expr`: the text, such as `"60"`, `"Width / 2"` or `"1in"`, trimmed; it may use the parameters above it (the ones added before it) and nothing below. `opts.unit`: `"mm"` (default) or `"in"` — what a bare number in `expr` is read in when it contains no parameter name. If it contains a parameter name, bare numbers are read in mm regardless of `unit`. Like the sidebar, every edit sets the unit afresh, so a parameter made in inches goes back to mm unless you pass `unit` again.
- **Returns:** the parameter's value in mm, as a number.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the name is not a string; when the expression is empty; when `unit` is neither `"mm"` nor `"in"`; when the name is not allowed (the app's own message, for example `"d1" is a dimension name.` or `"in" is a unit.` — only for a new name; a name that is already taken edits that parameter); or when the expression does not give a number (`expression did not evaluate`) — then nothing changes, not even the undo history. A size whose new value is out of range (below 0.01 mm, say) keeps its last number while the parameter still changes.
- **Example:** `JS3D.setParam("Width", "60")` → 60 · `JS3D.setParam("Depth", "4", { unit: "in" })` → 101.6
- **Since:** 1.0 · synchronous · one undo step ("Add parameter" / "Edit parameter"); no undo step when it throws

<a id="api-removeParam"></a>
#### `JS3D.removeParam(name) -> number`
Deletes a parameter (the name is matched in any capitals). Sizes, sketch dimensions and feature values that used its name keep their current number and lose the expression, so they stop following it; later parameters that used the name are left as they are and may then show `null` for their value in `params()`.
- **Arguments:** `name`: the parameter's name.
- **Returns:** how many bound values were freed (0 when nothing used it).
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; or when there is no parameter with that name (also when `name` is not a string).
- **Example:** `JS3D.setParam("Width", "60"); JS3D.removeParam("Width"); // 0`
- **Since:** 1.0 · synchronous · one undo step ("Delete parameter")

<a id="api-bind"></a>
#### `JS3D.bind(id, key, expr) -> number`
Ties one size of a plain shape to an expression, so that it follows a parameter, or frees it again with `null`. This is the script's version of the Beginner size box that shows a formula.
- **Arguments:** `id`: one body id; the body must be a plain shape (a basic shape with no features and no scale). `key`: the size key of that kind, and it must be a number — `w`, `d`, `h`, `r`, `c`, `top`, `tube`, `wall`, `inner`, `size`, `turns`, `wire`...; text-only keys such as `text` and `font` are refused. `expr`: the text, such as `"Width / 2"`, which may use the parameters and the sketch dimension names, or `null` to free the size and keep the number it has. It must give at least 0.01 mm when you bind; the numbers are worked out in mm whatever unit the page shows.
- **Returns:** the size in mm, after binding — the shape takes the new value straight away.
- **Errors:** throws while Chisel, CosForge or Chip Carving is open; when the id is not in the design; when the body is not a plain shape (`bind works on plain shapes`); when the kind has no numeric size under that key (the message names the kind); or when the expression does not give a usable size (an error naming the expression).
- **Example:** `const id = JS3D.add("box"); JS3D.setParam("Height", "30"); JS3D.bind(id, "h", "Height"); // 30`
- **Since:** 1.0 · synchronous · one undo step ("Bind size" / "Free size")

### Reference: History and view

<a id="api-undo"></a>
#### `JS3D.undo() -> string | null`
Goes back one step in the design's history, the same step the Undo button takes. Call it when a script or a tool has made a change that should not stay.
- **Arguments:** none.
- **Returns:** the label of the step that was undone, in the app's own words (`"Add box"`, `"Fillet"`, `"Move"`), or `null` when there is nothing to undo.
- **Errors:** throws `leave Chisel mode first` while Chisel is open (switch modes with `setMode`), throws while CosForge or Chip Carving is open (close it first), and throws `undo is off in the 3D Print Sim` while the 3D Print Sim is open, because that view never changes the design. An unconfirmed dialog is cancelled first, then the preceding history step is also undone if one exists.
- **Example:** `JS3D.add("box", { size: [20, 20, 20] }); JS3D.undo();   // "Add box"`
- **Since:** 1.0 · synchronous · one step back; the step is kept, so `redo` puts it back

<a id="api-redo"></a>
#### `JS3D.redo() -> string | null`
Puts back the step that `undo` took away, the same step the Redo button takes.
- **Arguments:** none.
- **Returns:** the label of the step put back, in the app's own words, or `null` when there is nothing to redo.
- **Errors:** the same as `undo`: refused in Chisel mode, while CosForge or Chip Carving is open, and while the 3D Print Sim is open. An unconfirmed dialog is cancelled first.
- **Example:** `JS3D.add("box"); JS3D.undo(); JS3D.redo(); // both return the edit label`
- **Since:** 1.0 · synchronous · one step forward; the step is kept, so `undo` takes it away again. Any new edit clears the redo steps.

<a id="api-select"></a>
#### `JS3D.select([ids]) -> undefined`
Selects bodies, as clicking them does, so `fit()` and the panels work on them.
- **Arguments:** `ids`: one body id or an array of ids, optional. Leave it out or pass `[]` to clear the selection. Every id must be in the design.
- **Returns:** `undefined`.
- **Errors:** throws when an id is not in the design; the selection is left as it was.
- **Example:** `const id = JS3D.add("box"); await JS3D.ready(); JS3D.select([id]); JS3D.fit()`
- **Since:** 1.0 · synchronous · no undo step; the selection is not part of the design, is not saved and is not undone

<a id="api-fit"></a>
#### `JS3D.fit() -> undefined`
Frames the view: the selected bodies fill it, or the whole design when nothing is selected. Use it before a picture, or after a move that pushed a shape out of sight.
- **Arguments:** none.
- **Returns:** `undefined`. The camera glides into place over a moment; there is no promise to await.
- **Errors:** none of its own. In Architect it frames the building rather than the bodies.
- **Example:** `const id = JS3D.add("box"); await JS3D.ready(); JS3D.select(id); JS3D.fit()`
- **Since:** 1.0 · synchronous · does not change the design; it moves the camera

<a id="api-setMode"></a>
#### `JS3D.setMode(mode) -> undefined`
Switches between Beginner, Advanced and Architect, the same as the top-bar buttons; the design remembers the mode it is opened in. This is also how a script leaves Chisel mode.
- **Arguments:** `mode`: `"beginner"`, `"advanced"` or `"arch"` (Architect). The mode the app is already in does nothing.
- **Returns:** `undefined`.
- **Errors:** throws `mode must be "beginner", "advanced" or "arch" (Architect)` for anything else, including no argument; nothing changes then. `"chisel"` is refused: Chisel is not offered here, and leaving it goes through one of the three names.
- **Example:** `JS3D.setMode("advanced");`
- **Since:** 1.0 · synchronous · no undo step; it stores the mode in the design and marks the design unsaved. Leaving Architect turns the drawn building into ordinary shapes in the design (as the app does), so the body list can grow; leaving Chisel saves the sculpts as mesh bodies.

<a id="api-screenshot"></a>
#### `JS3D.screenshot({fit, width}) -> Promise<Uint8Array>`
Takes a PNG picture of the 3D view as it is drawn now, for a preview, a report or an email. It waits for the shapes to build first.
- **Arguments:** an options object, optional. `fit`: `true` frames everything shown first, ignoring the selection; default `false`, so the camera stays where it is. `width`: the picture's width in whole pixels, 1 to 8192; default the size of the 3D view. The height follows to keep the same shape, so a smaller picture is the same frame drawn smaller.
- **Returns:** a promise for the PNG file's bytes, a `Uint8Array`.
- **Errors:** throws `width must be a number of pixels between 1 and 8192`, and `the 3D view has no size to draw` when the view has no size to draw. It fails like `ready` when a shape never finishes building.
- **Example:** `const png = await JS3D.screenshot({ fit: true, width: 1200 });`
- **Since:** 1.0 · async: every shape is built, and the camera move for `fit` (up to 3 seconds; in a hidden tab, where the browser runs no animation frames, the move is jumped to its end) · does not change the design

<a id="api-screenshotDataURL"></a>
#### `JS3D.screenshotDataURL({fit, width}) -> Promise<string>`
The same picture as `screenshot`, written as a data address instead of bytes, which is what an `<img>` tag or a CSS background can show directly.
- **Arguments:** the same as `screenshot`: `fit` (default `false`) and `width` (1 to 8192 pixels, default the view's width).
- **Returns:** a promise for text that starts `data:image/png;base64,` and holds the PNG.
- **Errors:** the same as `screenshot`.
- **Example:** `const img = document.createElement("img"); img.src = await JS3D.screenshotDataURL({width: 800}); document.body.append(img)`
- **Since:** 1.0 · async: every shape is built, and the camera move for `fit` (up to 3 seconds) · does not change the design

### Reference: Files

<a id="api-export"></a>
#### `JS3D.export(kind, {ids}) -> Promise<Uint8Array>`
Makes a file from the design and hands back its bytes instead of downloading it: a model for a slicer or a CAD program, or the project itself, for a test or a tool.
- **Arguments:** `kind`: `"stl"`, `"obj"`, `"3mf"`, `"glb"`, `"step"` or `"json"`. `ids`: optional, one body id or a list, to export only those bodies; without it every shown solid is exported, like the Export menu with nothing selected.
- **Returns:** a promise for the file's bytes (`Uint8Array`). `"json"` is the project file (`save()` as indented text), made at once and ignoring `ids`. STL, OBJ, 3MF and GLB are the menu's own bytes; STEP differs only in its time stamp and an export counter inside the file. Holes and hidden bodies are left out, also when named in `ids`.
- **Errors:** throws `kind must be "stl", "obj", "3mf", "glb", "step" or "json"`, an unknown body id, a build error on a selected body (the menu would export its last good shape instead), and `nothing to export: holes and hidden shapes are left out` when no solid is left.
- **Example:** `const id = JS3D.add("box"); const stl = await JS3D.export("stl", {ids: [id]})`
- **Since:** 1.0 · async: every shape is built; STL and 3MF then wait for the finer mesh the Export menu's quality setting asks for (Fine can take minutes, and the view's mesh is used if that takes over 4 minutes) · does not change the design

<a id="api-load"></a>
#### `JS3D.load(json, {keepId}) -> Promise<undefined>`
Opens a project the way opening a file does: the open design is replaced and the new one becomes the current design.
- **Arguments:** `json`: the file's text, the parsed object, or a bare design (`doc`), with or without the `{app, version, doc}` envelope. `keepId`: `true` keeps the design id in the file; default `false`, which gives the design a new id, as opening a file does.
- **Returns:** a promise for `undefined`, after the new design's shapes are built.
- **Errors:** throws `not a JumpStart 3D project` when the text is not JSON or the design has no `bodies` and `sketches` lists, and `not a JumpStart 3D project: body <n> needs an id, a node and a matrix m of 16 numbers` for a body that would break the 3D view. Validation failures leave the design unchanged. After replacement, `ready()` can reject, for example on timeout, while the replacement remains loaded. Saving to browser storage starts after replacement and is not awaited. Like every edit it is refused while Chisel, CosForge or Chip Carving is open (leave or close it first).
- **Example:** `const project = JS3D.save(); await JS3D.load(project, {keepId: true})`
- **Since:** 1.0 · async: the new design's shapes are built · replaces the design, clears the undo history, saves it in this browser's designs and puts the camera in the home view

<a id="api-newDesign"></a>
#### `JS3D.newDesign([mode]) -> Promise<undefined>`
Starts an empty design called Untitled, as New design does, ready for a script to build in. Use it when a script should not touch what the person has open.
- **Arguments:** `mode`: `"beginner"` (default) or `"advanced"`, the mode the new design opens in. `"arch"` is refused: switch with `setMode` afterwards.
- **Returns:** a promise for `undefined`, once the empty design is ready.
- **Errors:** throws `mode must be "beginner" or "advanced"` for anything else, and is refused while Chisel, CosForge or Chip Carving is open (leave or close it first).
- **Example:** `await JS3D.newDesign("advanced");`
- **Since:** 1.0 · async: the new design is loaded and its shapes are built · replaces the design, clears the undo history, saves it in this browser's designs and puts the camera in the home view

### Reference: Scripts and agent link

<a id="api-run"></a>
#### `JS3D.run(text) -> Promise<any>`
Runs script text in the page with `JS3D` and `app` in scope, the same way Open/Export › Run script… does, and gives back what the script returns.
- **Arguments:** `text`: the script as text. A plain script gives back the value of its last statement, and a promise there is awaited. A script with top-level `await` or a final `return` does not parse as a plain script and is run as the body of an async function instead, giving back the `return` value. The trust is the browser console's: the text can do anything the page can, and nothing runs unless someone calls this.
- **Returns:** a promise for that value, `undefined` when the script returns nothing.
- **Errors:** throws `run needs the script as text` for anything that is not text, and passes on any error the script itself throws, unchanged. The edits the script makes are undone one step each, like direct calls.
- **Example:** `await JS3D.run('const id = JS3D.add("box", { size: [20, 20, 20] }); return id;');`
- **Since:** 1.1 · async: the script's own promise · whatever the script does

<a id="api-invoke"></a>
#### `JS3D.invoke(call, [args]) -> Promise<any>`
Runs one call by its name with a list of arguments: the plumbing the WebSocket link and the AI server's headless page both use, so the two reach the bridge the same way.
- **Arguments:** `call`: the call's name as text, such as `"add"` (`"delete"` works too). `args`: an optional array of that call's arguments, default `[]`.
- **Returns:** a promise for what the call returns, with one change: a `Uint8Array` (a file or a picture) comes back as `{"$bytes": base64}`, because JSON has no bytes.
- **Errors:** throws an unknown call error naming the call for `"invoke"` itself, for the four properties (`version`, `apiVersion`, `appVersion`, `internals`) and for any name that is not a call, and `args must be an array` for arguments that are not a list. The call's own errors are passed on as they are.
- **Example:** `const id = await JS3D.invoke("add", ["box", { size: [20, 20, 20] }]);`
- **Since:** 1.1 · async: whatever the call it runs waits for · the effect of that call (an edit is one undo step, as usual)

<a id="api-connect"></a>
#### `JS3D.connect([url]) -> undefined`
Opens the link to an AI tool server on this computer (`mcp/server.mjs`), answers its calls one at a time and keeps trying every 3 seconds until `disconnect`. Nothing connects until this is called or the Connect to AI agent row in the theme menu is turned on, so a page on its own makes no connection.
- **Arguments:** `url`: the server's address, default `"ws://127.0.0.1:8822"`. It must start `ws://` or `wss://`.
- **Returns:** `undefined` at once; `connection()` then reports `"waiting"`, and `"connected"` once the server is there. When the socket opens, the page sends `{"hello":"jumpstart-3d","version":"1.13","apiVersion":"1.13.1","app":"2.9.8.2","url":<the page's address>}` (a design link's `#` part is never sent), then `{"id":n,"result":...}` or `{"id":n,"error":"..."}` for each call it receives.
- **Errors:** throws `url must be a ws:// or wss:// address` for anything else, and nothing changes. A browser that will not let the page reach this computer (Safari on an https page) says so once and keeps retrying. A second page asking for the same server is refused by the server: that page then switches its link off and stops retrying, though the remembered setting stays on, so a reload can take the link later.
- **Example:** `JS3D.connect(); JS3D.connection().state;   // "waiting" at first; "connected" a moment later if a tool server is running`
- **Since:** 1.1 · synchronous · no undo step; opens a socket and shows its state in the theme menu

<a id="api-disconnect"></a>
#### `JS3D.disconnect() -> undefined`
Closes the link to the AI tool server and stops retrying, for when a script or a test is done with it.
- **Arguments:** none.
- **Returns:** `undefined`; `connection()` then says `state: "off"`. Calling it when the link is already off is harmless.
- **Errors:** none.
- **Example:** `JS3D.disconnect(); JS3D.connection().on;   // false`
- **Since:** 1.1 · synchronous · no undo step; the remembered Connect to AI agent setting is left as it is

<a id="api-connection"></a>
#### `JS3D.connection() -> {on, url, state}`
Says where the AI link stands, for a status line, a log or a test.
- **Arguments:** none.
- **Returns:** `{on, url, state}`: `on` is `true` when the link is wanted (the setting), `url` is the address it uses, and `state` is `"off"`, `"waiting"` (wanted, no server yet, trying every 3 seconds) or `"connected"`. It is a fresh object each call; changing it changes nothing.
- **Errors:** none.
- **Example:** `JS3D.connection();   // { on: false, url: "ws://127.0.0.1:8822", state: "off" }`
- **Since:** 1.1 · synchronous · does not change the design

### Reference: Advanced CAD

<a id="api-sketch"></a>
#### `JS3D.sketch({on, name, shapes, hidden}) -> Promise<{sketch, name, plane, shapes, profiles, dof, dims}>`
Creates a sketch with dimensioned shapes. It does not copy a selected face's outline.
- **Arguments:** `on` defaults to `"XY"`; also `"XZ"`, `"YZ"`, `{plane, offset}` (offset in mm along the normal: +Z, -Y, +X respectively; default 0), or `{body, face}` with a body id and a selector or index for exactly one flat face. Plane names ignore case. `name` is an optional nonempty string; default `Sketch N`. `hidden` is a boolean, default `false`. `shapes` is an array of 1–200 objects: `rect` has `center`, `size: [w,h]`; `roundrect` adds `radius`, less than half the smaller side; `circle` has `center`, `diameter`; `slot` has `center`, `length`, `width`, `angle` (0 or 90 degrees, default 0; length greater than width); `polygon` has `center`, `sides` (integer 3–64), `diameter` across corners; `polyline` has `points` (2–200 pairs, at least 3 if closed) and `closed` (boolean, default true); `line` has `from`, `to`, `construction` (true makes a guide). Each object also has `type`. Centers default to `[0,0]`; coordinates are numeric pairs in sketch mm. Sizes are positive numbers or parameter expressions of at most 200 characters. Lines must have nonzero length. The call creates position and size dimensions and constraints such as horizontal, vertical, tangent, equal, midpoint, coincident and origin; it does not accept arbitrary constraint or dimension objects. At most 2000 points and 2000 entities are created per call.
- **Returns:** `sketch` is the sketch id; `name` its name; `plane` has world origin `o` and direction vectors `x`, `y`, `n`; `shapes` has each `type`, drawn entity ids `ents`, and `center` where applicable; `profiles` has an interior point `pt` in sketch mm and `area` in mm² for each closed region; `dof` is remaining degrees of freedom; `dims` lists `name`, `value` and optional `expr` for dimensions.
- **Errors:** rejects invalid planes, shapes, expressions, sizes, limits or names, missing bodies, and face selectors that do not find exactly one flat face. A face body must build successfully and not be marked as a hole. Editing must be available; finish previews or conflicting modes first.
- **Example:** `await JS3D.sketch({shapes: [{type: "rect", size: [60, 40]}]})`
- **Since:** 1.9 · async: waits for the geometry engine when placed on a body face · one undo step

<a id="api-extrude"></a>
#### `JS3D.extrude({sketch, profiles, dist, through, mode, dist2, op, body, name}) -> Promise<{body, feature}>`
Pushes closed sketch profiles along the sketch normal and hides the sketch.
- **Arguments:** `sketch` is a sketch id. `profiles` is an optional array of `[x,y]` points in sketch mm, each picking its smallest containing region; omitted or empty chooses regions inside an even number of other outlines. `dist` is a signed mm number with absolute value greater than 0.000001 or expression, unless `through: true` is used. `mode` is `"one"` (default), `"sym"`, or `"two"`; `dist2` is a positive mm number or expression required only for `"two"`. `through` is boolean, default false; true requires `op: "cut"`, mode `"one"`, and no `dist`, and computes the distance from the current body. `op` is `"new"` (default), `"join"` or `"cut"`; `body` is required for join or cut and forbidden for new. `name` is an optional nonempty name for new only. Expressions have at most 200 characters.
- **Returns:** `body` is the new or target body id; `feature` is the added feature id, or `null` for a new body.
- **Errors:** rejects missing sketches or bodies, sketches without closed regions, unmatched profile points, invalid distances or option combinations, hole bodies, and a through cut whose body does not reach the plane. Editing must be available; a through cut also requires a built body.
- **Example:** `const sk = await JS3D.sketch({shapes: [{type: "rect", size: [20, 20]}]}); await JS3D.extrude({sketch: sk.sketch, dist: 10})`
- **Since:** 1.9 · async: waits for the geometry engine for a through cut · one undo step

<a id="api-revolve"></a>
#### `JS3D.revolve({sketch, profiles, axis, angle, op, body, name}) -> Promise<{body, feature}>`
Turns closed sketch profiles around an axis and hides the sketch.
- **Arguments:** `sketch`, `profiles`, `op`, `body` and `name` follow `extrude`: profile points are sketch mm, default selects alternating nested regions; `op` defaults to `"new"`, with `body` required for `"join"` or `"cut"` and `name` allowed only for new. `axis` is `"X"`, `"Y"` or `"Z"` through the world origin and parallel to the sketch plane, or a line entity id in the sketch. `angle` is degrees, greater than 0 and at most 360, default 360; a number or expression of at most 200 characters.
- **Returns:** `body` is the new or target body id; `feature` is the feature id, or `null` for new.
- **Errors:** rejects invalid sketches, profiles, axis, angle or operation, missing or hole target bodies, and unavailable editing. A profile crossing the axis may instead fail when the geometry builds; inspect the body's build error.
- **Example:** `const sk = await JS3D.sketch({shapes: [{type: "rect", center: [0, 15], size: [10, 10]}]}); await JS3D.revolve({sketch: sk.sketch, axis: "X"})`
- **Since:** 1.9 · async: returns a Promise after creating the feature; does not wait for its build · one undo step

<a id="api-fillet"></a>
#### `JS3D.fillet(id, edges, r) -> Promise<{body, feature, edges}>`
Rounds selected edges without extending the selection along tangent edges.
- **Arguments:** `id` is a solid body id; `edges` is edge selector text, an index, or a nonempty array of indices; `r` is a positive radius in mm or an expression of at most 200 characters. Selectors are described under `edges`. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** `body` and `feature` are ids; `edges` is the number selected.
- **Errors:** rejects unavailable editing, missing, hole, unbuilt or failed bodies, invalid or unmatched selectors, and invalid radius. An overly large radius may fail during the later build; reduce it and inspect the body's error.
- **Example:** `const id = JS3D.add("box"); await JS3D.fillet(id, "edges of top", 1)`
- **Since:** 1.9 · async: waits for the current body to build · one undo step

<a id="api-chamfer"></a>
#### `JS3D.chamfer(id, edges, d) -> Promise<{body, feature, edges}>`
Bevels selected edges.
- **Arguments:** `id` is a solid body id; `edges` is edge selector text, an index, or a nonempty array of indices; `d` is a positive distance in mm or an expression of at most 200 characters. Selectors are described under `edges`. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** `body` and `feature` are ids; `edges` is the number selected.
- **Errors:** rejects unavailable editing, missing, hole, unbuilt or failed bodies, invalid or unmatched selectors, and invalid distance. An unsuitable bevel may fail during the later build; reduce it and inspect the body's error.
- **Example:** `const id = JS3D.add("box"); await JS3D.chamfer(id, "edges of top", 1)`
- **Since:** 1.9 · async: waits for the current body to build · one undo step

<a id="api-shell"></a>
#### `JS3D.shell(id, {th, open, dir}) -> Promise<{body, feature, open}>`
Hollows a body and optionally removes selected faces.
- **Arguments:** `id` is a solid body id; `th` is a positive wall thickness in mm or an expression of at most 200 characters. `open` is face selector text, an index, or an array of indices; omitted, null or empty means a closed hollow. `dir` is `"in"` (default), `"out"` or `"both"`. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** `body` and `feature` are ids; `open` is the number of removed faces.
- **Errors:** rejects unavailable editing, missing, hole, unbuilt or failed bodies, invalid thickness or direction, and invalid or unmatched selectors. Geometry may fail on a later build if the wall is unsuitable.
- **Example:** `const id = JS3D.add("box"); await JS3D.shell(id, {th: 2, open: "top"})`
- **Since:** 1.9 · async: waits for the current body to build · one undo step

<a id="api-hole"></a>
#### `JS3D.hole(id, {face, points, kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear}) -> Promise<{body, feature, holes}>`
Cuts round holes at world points projected onto one flat face.
- **Arguments:** `id` is a solid body id; `face` is selector text, an index, or a one-element index array matching exactly one flat face; `points` is a nonempty array of world `[x,y,z]` mm points. `kind` is `"simple"` (plain, default), `"cbore"`, `"csink"` or `"tapped"`. Give `size` or positive `dia` in mm; a size fills the standard dimensions, and explicit values override them. Plain, counterbore and countersink sizes are `M2`, `M2.5`, `M3`, `M4`, `M5`, `M6`, `M8`, `M10`, `M12`, `#4`, `#6`, `#8`, `#10`, `1/4`, `5/16`, `3/8`, `1/2`. Tapped sizes also include metric `M16`, `M20`, and inch `#2`, `#4`, `#6`, `#8`, `#10`, `#10 fine`, `1/4`, `1/4 fine`, `5/16`, `5/16 fine`, `3/8`, `3/8 fine`, `1/2`. `depth` is positive mm; omitted or null makes a through hole. `tip` enables a drill tip on a blind hole, default false. `cbDia`, `cbDepth`, `csDia` are positive mm, defaults 6.5, 3.3, 6.9; `csAngle` is 1–179 degrees, default 90. `pitch` is positive mm and required for tapped holes without a size; `clear` is -1 to 0 mm, default the design's thread offset. Size presets may change these defaults. Limits are 200 plain, 130 counterbore, 130 countersink or 8 tapped holes per call. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** `body` and `feature` are ids; `holes` is the number created.
- **Errors:** rejects unavailable editing, missing, hole, unbuilt or failed bodies, bad face selection, invalid hole options, too many points, holes that cross the face edge or overlap, and any `shape` option. Use `holePattern` for non-round holes.
- **Example:** `const id = JS3D.add("box"); await JS3D.hole(id, {face: "top", points: [[0, 0, 20]], size: "M3"})`
- **Since:** 1.9 · async: waits for the current body to build · one undo step

<a id="api-pattern"></a>
#### `JS3D.pattern(id, {features, type, axis, count, spacing, axis2, count2, spacing2, both, angle, center}) -> {body, feature, copies}`
Repeats eligible features or the whole body.
- **Arguments:** `id` is a solid body id. `features` is a nonempty array of ids of holes, embossed text, or sketch-based extrude, revolve or sweep joins or cuts; `["shape"]` repeats the body. `type` is `"rect"` or `"circle"`. `axis` is a nonzero world direction `"x"`, `"y"`, `"z"` or `[x,y,z]`. For rect, `count` is an integer 1–200; `spacing` is mm, nonzero when count exceeds 1. Optional `axis2`, `count2` (1–200, default 1), `spacing2` (nonzero when count2 exceeds 1) set a second direction; `axis2` is required when count2 exceeds 1. `both` is boolean, default false, and extends both ways. The original and copies together cannot exceed 2000 and at least one copy is required. For circle, `count` is 2–360 including the original, `angle` is greater than 0 and at most 360 degrees (default 360), `center` is world `[x,y,z]` mm (default origin). Counts, spacing and angle accept expressions up to 200 characters.
- **Returns:** `body` and `feature` are ids; `copies` counts new copies, excluding the original.
- **Errors:** rejects unavailable editing, missing or hole bodies, unsupported or missing features, invalid axes, counts, spacing, angles or expressions, and patterns with no copies or too many total instances.
- **Example:** `const id = JS3D.add("box"); JS3D.pattern(id, {features: ["shape"], type: "rect", axis: "x", count: 3, spacing: 30})`
- **Since:** 1.9 · synchronous · one undo step

<a id="api-faces"></a>
#### `JS3D.faces(id, selector) -> Promise<array>`
Lists matching faces of the currently built body in world coordinates.
- **Arguments:** `id` is a body id, including a hole body; `selector` defaults to `"all"` and may be text, an index or a nonempty index array. Text is case-insensitive, at most 500 characters: `all`, `plane`, `cylinder`, `cone`, `sphere`, `torus`, `other`, `hole`; `face N`; `>X`, `<X` and their Y/Z forms; aliases `top` (+Z extreme), `bottom`, `front` (-Y), `back`, `left`, `right`; optional `[n]` selects a zero-based extreme level, negative from the other end. `|X` and `#X` select flat normals parallel or perpendicular within 1 degree; `+X` and `-X` select facing direction, also for Y/Z. Combine with `not`, `and`, `or` and parentheses; `and` narrows left to right and precedes `or`. Extreme centers within 0.01 mm share a level. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** index-sorted objects: `index`, `type`, world `center` in mm, `area` in mm², `edgeCount`; planes also have `normal`, cylinders `radius` in mm, `axis` and boolean `hole`, spheres `radius` in mm. Indices describe the current build and can change after edits.
- **Errors:** rejects unavailable editing, missing, unbuilt or failed bodies, invalid selectors or indices, and selectors matching nothing. Show an unbuilt hidden body first.
- **Example:** `const id = JS3D.add("box"); await JS3D.faces(id, "top and plane")`
- **Since:** 1.9 · async: waits for the current body to build · does not change the design

<a id="api-edges"></a>
#### `JS3D.edges(id, selector) -> Promise<array>`
Lists matching drawn edges of the currently built body in world coordinates; seams and smooth joins are omitted.
- **Arguments:** `id` is a body id, including a hole body; `selector` defaults to `"all"` and may be text, an index or a nonempty index array. Text is case-insensitive, at most 500 characters: `all`, `line`, `circle`, `ellipse`, `other`, `edge N`, `edges of` followed by a face selector, extreme `>X`, `<X` and Y/Z forms, aliases `top`, `bottom`, `front`, `back`, `left`, `right`, and optional extreme level `[n]` (zero-based, negative from the other end). `|X` and `#X` select straight directions parallel or perpendicular within 1 degree, also for Y/Z. Use `not`, `and`, `or`, parentheses; `and` narrows left to right and precedes `or`. Extreme centers within 0.01 mm share a level. Face selectors for `edges of` use the grammar in `faces`. Index arrays are converted to selector text, which must be at most 500 characters after conversion.
- **Returns:** index-sorted objects: `index`, `type`, world `start`, `end`, `mid`, `center` in mm, approximate `length` in mm, and `faces` indices; lines also have `direction`, circles `radius` in mm. Indices describe the current build and can change after edits.
- **Errors:** rejects unavailable editing, missing, unbuilt or failed bodies, invalid selectors or indices, and selectors matching nothing. Show an unbuilt hidden body first.
- **Example:** `const id = JS3D.add("box"); await JS3D.edges(id, "edges of top and line")`
- **Since:** 1.9 · async: waits for the current body to build · does not change the design

### Reference: Inspection

<a id="api-inspect"></a>
#### `JS3D.inspect(ids, {material, density}) -> Promise<{material, bodies, total}>`
Measures bodies and estimates their weight from density.
- **Arguments:** `ids` is one body id or an array; omitted, null or empty selects shown solid bodies, excluding holes. Explicit ids can include hidden or hole bodies. `material` defaults to `"pla"`; choices are `pla`, `plaplus`, `petg`, `abs`, `asa`, `nylon`, `pc`, `cfpla`, `cfnylon`, `peek`, `tpu`. `density` overrides material and must be 0.1–25 g/cm³.
- **Returns:** `material` has `key`, `name`, `density`; custom density uses key `custom`. Each `bodies` item has `id`, `name`, `hole`, `hidden`, `bbox: {min,max}` and `size` in world mm, `volume` in mm³, `volumeFrom` (`"solid"`, `"mesh"`, or `null` for a wire or failed build), `area` in mm², `weight` in grams, `solids`, and `error`. A wire has zero volume, area and weight, zero solids and a `note`; a failed build has null measurements and an error. `total` has `bodies` counted with successful surface measurements, combined `bbox`, `size`, `volume`, `area`, `weight`; its box and size are null if none succeed.
- **Errors:** rejects unknown ids, material or density and a preview or rolled-back design. Individual build failures appear in results; show hidden bodies that have not built.
- **Example:** `const id = JS3D.add("box"); await JS3D.inspect([id], {material: "petg"})`
- **Since:** 1.10 · async: waits for the geometry engine to settle · does not change the design

<a id="api-measure"></a>
#### `JS3D.measure(a, b) -> Promise<{a, b, distance, exact, kind, from?, to?, delta?, angle?}>`
Measures a distance between points, bodies or faces.
- **Arguments:** Each of `a` and `b` is a world point `[x,y,z]` in mm, a body id, `{body, face}` with a zero-based face index, or `{body, near}` with a world point that chooses the nearest face. Explicit bodies may be hidden or holes if built.
- **Returns:** `a` and `b` echo targets: a point has `point`; a body has `body`, `name`; a face adds `face`, surface `type`, world `center`, optional `normal`, and `nearDistance` in mm when chosen by proximity. `distance` is mm, `exact` indicates the method, and `kind` is `point-point`, `body-body`, `planes` or `mesh`. Point-point also has world `from`, `to`, `delta`; mesh results have closest `from`, `to`. Two faces with normals also have `angle`, the unsigned acute angle from 0 to 90 degrees, and `parallel`; parallel planes use exact plane distance. Mesh distances are approximations.
- **Errors:** rejects invalid targets, missing or unbuilt bodies, wire-only shapes, invalid face indices, measuring a body against itself, engine measurement failure, meshes too fine to compare, or a preview or rolled-back design.
- **Example:** `await JS3D.measure([0, 0, 0], [3, 4, 0])`
- **Since:** 1.10 · async: waits for the geometry engine to settle and, for two bodies, its contact calculation · does not change the design

<a id="api-printCheck"></a>
#### `JS3D.printCheck({ids, printer, angle}) -> Promise<{ok, summary, issues, bodies, ignored}>`
Checks the shown bodies against the plate and common printing problems.
- **Arguments:** `ids` is one id or an array; omitted, null or empty checks all bodies, ignoring hidden and hole bodies. `printer` defaults to the saved plate choice (initially `"generic"`); use `"none"`, `"generic"`, or any 3D Print Sim printer id, including `a1`, `x1`, `p1s`, `mk4`, `mini`, `ender3`, `u1`. Generic is 256 × 256 mm with no height limit; none has no boundary. `angle` is the overhang threshold in degrees, 10–80, default the saved preference (initially 45).
- **Returns:** `ok` is false if any error exists; `summary` is readable text; `issues` has `level`, `code`, body `id`, `name`, and `text` (id and name can be null). Codes include `empty`, `wire_only`, `build_error`, `floating`, `below_plate`, `outside_bed`, `too_tall`, `overhang`, `small_contact`. `bodies` has successful `id`, `name`, world `bbox`, `minZ`, `contactArea`, `overhangArea`, `overhangTriangles`, `fits` (null without a bed). Areas are mm². `printer`, `bed` (`{w,d,h}` in mm or null), `angle`, and `ignored` (`id`, `name`, `why`: `hole` or `hidden`) describe the check.
- **Errors:** rejects unknown ids or printer, out-of-range angle, or a preview or rolled-back design. Build and wire problems are reported as issues.
- **Example:** `await JS3D.printCheck({printer: "generic", angle: 45})`
- **Since:** 1.10 · async: waits for the geometry engine to settle · does not change the design

<a id="api-collisions"></a>
#### `JS3D.collisions({ids, gap}) -> Promise<{pairs, checked, skipped}>`
Finds touching, overlapping or nearby bodies.
- **Arguments:** `ids` is one body id or an array, defaulting when omitted, null or empty to shown solid bodies. Explicit ids can include hidden or hole bodies if built. At most 50 bodies may be requested. `gap` is 0–50 mm, default 0.
- **Returns:** `checked` counts usable bodies; `skipped` lists `id`, `name`, `error` for unbuilt or wire bodies. Each sorted `pairs` item has body ids `a`, `b`, names `aName`, `bName`, `distance` in mm, `state` (`overlap`, `touch`, `near`), `overlap` in mm³ or null, and optional `error` or `note`. Contacts within 0.001 mm are treated as touching; overlap is measured for at most 20 contacts within a 90-second budget, so some volumes can be null.
- **Errors:** rejects unknown ids, more than 50 bodies, an invalid gap, or a preview or rolled-back design. Engine failures or time limits can leave a pair's overlap unmeasured.
- **Example:** `const a = JS3D.add("box"); const b = JS3D.add("box", {at: [30, 0, 0]}); await JS3D.collisions({ids: [a, b], gap: 2})`
- **Since:** 1.10 · async: waits for the geometry engine to settle, find contacts and probe overlaps · does not change the design

<a id="api-section"></a>
#### `JS3D.section(plane, {ids, points, picture, width}) -> Promise<{plane, shifted, area, bodies, dataURL?}>`
Measures cross sections through bodies and can capture a section picture.
- **Arguments:** `plane` is `{axis: "x"|"y"|"z", at}` in world mm or `{origin, normal}` with world three-number vectors; normal must be nonzero. `ids` is one id or an array, defaulting when omitted, null or empty to shown solid bodies; explicit ids can include built hidden or hole bodies. `points` includes loop points when truthy, default false. `picture` requests a PNG data URL when truthy, default false, in Beginner or Advanced mode; `width` is picture width in pixels from 1 to 8192, default 800.
- **Returns:** `plane` is `{origin, normal, u, v}` with normalized directions; `shifted` is 0 or 0.0001 mm along the normal to avoid vertices on the plane; `area` is total mm². `bodies` contains intersected `id`, `name`, `area`, and `loops`; each loop has `area` mm², `perimeter` mm, `hole`, `closed`, 2D `min`, `max`, and optionally `points` in the plane's mm coordinates. At most 5000 points are included; `truncated: true` indicates omitted loops' points. `skipped` has `id`, `name`, `error`. With a picture, `dataURL` is the PNG.
- **Errors:** rejects invalid planes or ids, a preview or rolled-back design, invalid picture width, picture requests outside Beginner and Advanced mode, or a cut exceeding 200000 line segments or 2000 outlines. Unbuilt and wire bodies are listed in `skipped`.
- **Example:** `JS3D.add("box"); await JS3D.section({axis: "z", at: 10}, {points: true})`
- **Since:** 1.10 · async: waits for the geometry engine to settle and, if requested, the picture capture · does not change the design; temporarily changes and restores the section view and camera for a picture

### Reference: Generators

<a id="api-boxMaker"></a>
#### `JS3D.boxMaker({style, w, d, h, units, across, cols, rows, shape, wall, divider, floor, radius, inner, scoop, scoopR, label, labelW, stack, foot, lid, clear, lock, sideLock, caseT, pull, hinge, doorPull, doorCatch, layout, at, name}) -> {id, parts, cell, info}`
Makes a bin or a case with compartments and optional parts.
- **Arguments:** `style` is `"bin"` (default), `"drawer"`, `"tilt"`, or `"door"`. In mm, `w` and `d` are 10–1000 for bins or 30–1000 otherwise (defaults 120, 80); `h` is 5–1000 for bins or 20–1000 otherwise (40). `units` and `across` are integers 1–8 (1); `cols` is 1–20 for bin/door, 1–12 drawer, 1–8 tilt (3); `rows` is 1–20 except drawer 1–12 (2). `shape` is `"square"` (default), `"round"`, or `"hex"`. In mm: `wall`, `divider`, `floor` are 0.4–20 (defaults 1.6, 1.2, 1.2); `radius` 0–100 (4); `inner` 0–50 (2); `scoopR` 1–100 (10); `labelW` 2–100 (10); `foot` 1–50 (3); `clear` 0–2 (0.25); `caseT` 1.2–20 (2.4). Boolean `scoop` defaults true; `label`, `stack`, `lid` default false. `lock` and `sideLock` are `"dovetail"` (default), `"pegs"`, or `"none"`; `pull` is `"bar"` (default), `"knob"`, or `"notch"`; `hinge` is `"left"` (default) or `"right"`; `doorPull` is `"knob"` (default), `"hole"`, or `"bar"`; `doorCatch` is `"light"` (default), `"none"`, or `"firm"`; `layout` is `"assembled"` (default) or `"print"`. `at` is a three-number position in mm, default origin. `name` is converted to a trimmed string of at most 256 characters; empty uses an automatic name.
- **Returns:** `{id, parts, cell, info}`: main body id; part list `{id, name, kind}`; `cell: {w, d, h}` compartment dimensions in mm or `null`; and an informational string.
- **Errors:** Throws for unknown options, invalid ranges, choices, flags or position, an overlong name, compartments too small to build, or blocked editing. Adjust options or leave the mode.
- **Example:** `JS3D.boxMaker({style: "drawer", cols: 2})`
- **Since:** 1.11 · synchronous · one undo step

<a id="api-gearSet"></a>
#### `JS3D.gearSet({type, module, teeth, teeth2, sunTeeth, planetTeeth, planets, width, bore, boreShape, backlash, pressureAngle, rackLength, rackHeight, joints, clear, angle, hand, at}) -> {id, parts, info}`
Adds a meshing gear set and, for library sets, optional joints.
- **Arguments:** `type` is `"pair"` (default), `"rack"`, `"ring"`, `"planet"`, `"bevel"`, or `"helical"`. All accept `module` 0.3–10 mm (default 2), `width` 0.5–200 mm (default 8 for library sets, gear-specific default for bevel/helical), `bore` in mm (default 0, none), and `at` as `[x, y, z]` in mm (default origin). Pair and ring accept integer `teeth` 6–300 (20) and `teeth2` 6–400 (40); rack accepts `teeth`; planet accepts integer `sunTeeth` 8–200 (18), `planetTeeth` 8–200 (12), and `planets` 2–6 (3). These four library types accept `backlash` 0–1 mm (0.15), `pressureAngle` 14.5, 20 or 25 degrees (20), `boreShape` `"round"` (default), `"d"`, `"hex"`, or `"key"`, and boolean `joints` (true). Rack also accepts `rackLength` 0–2000 mm (0 selects an automatic length) and `rackHeight` 2–100 mm (8). Library bore is 0 or 0.5 mm up to the geometry-dependent maximum: the smaller of module × (smallest relevant tooth count − 4.5) and 1.6 times its root radius, rounded down to 0.1 mm; planet bores also must fit the planet roots. Ring teeth2 must be at least teeth + 8. Planet spacing must leave over 0.5 mm between tips, and sun plus ring teeth must divide by the number of planets. Bevel/helical accept integer `teeth` and `teeth2`, 12–90 for bevel or 12–30 for helical (20 and same as teeth); `clear` follows `JS3D.gear`. Helical also accepts `angle` 5–30 degrees (20) and `hand` `"right"` (default) or `"left"`; the second gear uses the opposite hand. Bevel/helical bore and width must also satisfy `JS3D.gear` limits.
- **Returns:** `{id, parts, info}`: main body id, list of `{id, name}` for each body, and an array of informational strings about the set.
- **Errors:** Throws for unknown or type-incompatible options, invalid ranges or geometry, impossible planet spacing or ring teeth, a bore that does not fit, or blocked editing. Adjust the set or leave the mode.
- **Example:** `JS3D.gearSet({type: "pair", module: 2, teeth: 20, teeth2: 40})`
- **Since:** 1.11 · synchronous · one undo step

<a id="api-hardware"></a>
#### `JS3D.hardware({part, size, length, threads, clear, left, at, name}) -> id`
Adds one hardware body from the hardware library.
- **Arguments:** `part` is required: `"hexbolt"`, `"shcs"`, `"button"`, `"flat"`, `"set"`, `"wood"`, `"rod"`, `"nut"`, `"nyloc"`, `"sqnut"`, `"washer"`, `"lockw"`, `"insert"`, or `"dowel"`. `size` is a supported size string for that part, such as `"M3"` or `"1/4-20"`; inserts are metric only. `length` is 1–300 mm, only for screws, rods and dowels, default based on nominal diameter `d` in mm: set screws use max(3, round(1.5 × d)), rods round(10 × d), dowels round(4 × d), and other length-bearing parts max(4, round(3 × d)). `threads` is boolean, default false, and requires a threaded part; threaded lengths cannot exceed 150 turns. `clear` is -1 to 0 mm, default the design thread offset. `left` is boolean, default false. `at` is `[x, y, z]` in mm, default origin; the lowest point rests at z. `name` is converted to a trimmed string of at most 256 characters, default the library name.
- **Returns:** The new body id string.
- **Errors:** Throws for unknown options, unsupported part or size, length on a part without length, invalid ranges or flags, unsupported threads, too many turns, invalid position, overlong name, or blocked editing. The size error lists supported sizes.
- **Example:** `JS3D.hardware({part: "shcs", size: "M3", length: 10})`
- **Since:** 1.11 · synchronous · one undo step

<a id="api-textures"></a>
#### `JS3D.textures() -> [{key, name, category, size}]`
Lists the built-in textures.
- **Arguments:** None.
- **Returns:** An array of `{key, name, category, size}`: texture key, display name, category, and default tile size in mm.
- **Errors:** No input validation errors.
- **Example:** `JS3D.textures()`
- **Since:** 1.11 · synchronous · does not change the design

<a id="api-texture"></a>
#### `JS3D.texture(id, {texture, faces, size, depth, dir, rotation, mapping, edgeBlend, invert, once}) -> Promise<{body, texture, faces}>`
Adds a texture layer to a solid body's faces.
- **Arguments:** `id` is a body id. `texture` is a key from `JS3D.textures()`, default `"knurl"`. `faces` is `"all"` (default), a nonempty face selector string such as `"top"`, a nonnegative face index, or a nonempty array of selectors and indices; duplicates are removed. In mm, `size` is 0.5–100 (default texture tile size or 4), `depth` 0.05–3 (0.6), `edgeBlend` 0–10 (0). `dir` is `"raise"` (default), `"engrave"`, or `"both"`; `rotation` is -180–180 degrees (0); `mapping` is `"auto"` (default), `"planar"`, `"cylindrical"`, or `"triplanar"`. `invert` and `once` are booleans, default false. A body can have at most 16 texture layers.
- **Returns:** `{body, texture, faces}`: body id, new texture layer id, and `"all"` or the number of selected faces.
- **Errors:** Rejects invalid options or selectors, a missing or hole body, a full 16-layer body, build errors, no matched faces, or a body changed while preparing the texture. Correct the input, remove a layer, repair the body or retry. Editing modes can block the call.
- **Example:** `const id = JS3D.add("box"); await JS3D.texture(id, {texture: "knurl", faces: "top"})`
- **Since:** 1.11 · async: waits for geometry and face selection · one undo step

<a id="api-drawing"></a>
#### `JS3D.drawing({ids, views, scale, units, dims}) -> Promise<Uint8Array>`
Creates a DXF drawing of visible solid CAD bodies.
- **Arguments:** `ids` is one body id or an array, default all bodies; holes and hidden bodies are omitted. `views` is a nonempty array of distinct `"top"`, `"front"`, `"right"`, default all three; output uses that order. `scale` is 0.01–100, default 1 for full size. `units` is `"mm"` (default) or `"in"`. `dims` is boolean, default false; true adds overall dimensions.
- **Returns:** A `Uint8Array` containing DXF file bytes.
- **Errors:** Rejects invalid options or ids, no visible solid bodies, build failures, bodies that cannot be drawn, or mesh bodies that need conversion to STEP. Repair or exclude those bodies and retry; cancellation and geometry errors also reject.
- **Example:** `JS3D.add("box"); await JS3D.drawing({views: ["top"], dims: true})`
- **Since:** 1.11 · async: waits for geometry and drawing generation · does not change the design

### Reference: Checkpoints

<a id="api-checkpoint"></a>
#### `JS3D.checkpoint(label) -> {id, label, bodies, at}`
Saves a snapshot in page memory. Only the latest 20 checkpoints are kept.
- **Arguments:** `label` is a string of at most 200 characters, default `""`.
- **Returns:** `{id, label, bodies, at}`: checkpoint id, label, body count, and ISO timestamp.
- **Errors:** Throws for a non-string or overlong label, or while an editing mode blocks changes. Shorten the label or leave the mode.
- **Example:** `JS3D.checkpoint("Before changes")`
- **Since:** 1.12 · synchronous · no undo step; changes page memory

<a id="api-checkpoints"></a>
#### `JS3D.checkpoints() -> [{id, label, bodies, at}]`
Lists checkpoint metadata held in this page's memory, including checkpoints from other designs.
- **Arguments:** None.
- **Returns:** An array of `{id, label, bodies, at}`: checkpoint id, label, body count, and ISO timestamp, oldest first.
- **Errors:** No input validation errors.
- **Example:** `JS3D.checkpoints()`
- **Since:** 1.12 · synchronous · does not change the design

<a id="api-diff"></a>
#### `JS3D.diff(fromId, toId) -> string`
Compares a checkpoint with the current design or another checkpoint of the current design.
- **Arguments:** `fromId` is a checkpoint id string; optional `toId` is another checkpoint id, default the current design. Both checkpoints must belong to the current design.
- **Returns:** A readable multiline string of changes, or `"No changes."`. Output is capped at 200 change lines and 20,480 JavaScript string units for change lines (counting one separator per line), not UTF-8 bytes; the remaining-change count is appended beyond that cap; long values are shortened.
- **Errors:** Throws if a checkpoint is missing or belongs to another design. Choose a retained checkpoint for the current design.
- **Example:** `const cp = JS3D.checkpoint("Before"); JS3D.add("box"); JS3D.diff(cp.id)`
- **Since:** 1.12 · synchronous · does not change the design

<a id="api-rollback"></a>
#### `JS3D.rollback(id) -> {id, label, bodies, at}`
Restores a retained checkpoint for the current design as one undoable change, preserving the current mode.
- **Arguments:** `id` is a checkpoint id string from `JS3D.checkpoints()`; it must belong to the current design.
- **Returns:** `{id, label, bodies, at}`: restored checkpoint id, label, body count, and ISO timestamp.
- **Errors:** Throws if the checkpoint is missing or from another design, editing is blocked, or 3D Print Sim has undo locked. Choose a retained checkpoint for this design and leave the blocking mode.
- **Example:** `const cp = JS3D.checkpoint("Before"); JS3D.add("box"); JS3D.rollback(cp.id)`
- **Since:** 1.12 · synchronous · one undo step

### Reference: Properties

<a id="api-version"></a>
#### `JS3D.version`
The API version as `"major.minor"` text, for a tool that checks what the page can do before calling it.
- **Value:** `"1.13"`. The first number changes when an existing call changes shape or meaning; the second goes up when calls are added (1.0 was the first bridge). Read `supports()` or `describe()` rather than guessing from it.
- **Example:** `JS3D.version;   // "1.13"`
- **Since:** 1.0 · synchronous · does not change the design

<a id="api-apiVersion"></a>
#### `JS3D.apiVersion`
The API version in full, `"major.minor.patch"`, where the patch number goes up for a fix that adds or changes no call.
- **Value:** `"1.13.1"`. Its first two numbers are the same as `version`; the third is new in 1.13, so a page older than that has only `version`.
- **Example:** `JS3D.apiVersion;   // "1.13.1"`
- **Since:** 1.13 · synchronous · does not change the design

<a id="api-appVersion"></a>
#### `JS3D.appVersion`
The app's own version, for a bug report or a log line. It is not the API version: the app and its API are numbered apart.
- **Value:** the build's version from `src/version.js`, now `"2.9.8.2"`, such as `"2.9.8.2"`. It changes with each release of the app.
- **Example:** `JS3D.appVersion;   // "2.9.8.2"`
- **Since:** 1.1 · synchronous · does not change the design

<a id="api-internals"></a>
#### `JS3D.internals`
The app's own objects, for people who know this code. Unsupported: anything reached through it can change in any release, without notice, so do not build on it.
- **Value:** `{ app, store }`, the same objects as `window.__app` and `window.__store`. It is a property, not a call, so `invoke` refuses it and `supports()` says `false`. Everything stable is on the calls in this reference.
- **Example:** `JS3D.internals.app.mode;   // "beginner", and may change in any release`
- **Since:** 1.0 · synchronous · whatever a script does through it can change anything, without any of the checks the calls make

## Part 1: The `JS3D` calls

### Conventions

- Lengths are in **mm**, angles in **degrees**, positions are `[x, y, z]`, z up.
  The page's mm/inch switch does not change anything here.
- An argument called `ids` takes one id (a string) or an array of ids.
**Errors.** A failing call throws an `Error` whose message names the bad input,
the value received, what is allowed, and one next step. Over WebSocket and MCP, the message arrives
as the tool error text. Wording may improve in any release, so match the call’s
outcome rather than its exact message. A body that fails to build reports its
error in `JS3D.list()`, with a hint when one is known.

- While Chisel mode is open, every call that edits or loads throws `leave Chisel mode first` (`setMode` is how you leave it).
- Everything is synchronous except `ready`, `export`, `screenshot`,
  `screenshotDataURL`, `load`, `newDesign`, `run`, `invoke`, `codeCad`, `holePattern`, `sketch`, `extrude`, `revolve`, `fillet`, `chamfer`, `shell`, `hole`, `faces`, `edges`, `inspect`, `measure`, `printCheck`, `collisions`, `section`, `texture` and `drawing`, which return promises.
- Every edit is one undo step with a readable label (the Undo button and
  `JS3D.undo()` use it). Most edits leave the selection alone; `codeCad` selects the resulting body.
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

These five calls check a design without a picture. Each waits for the shapes to build (like `ready`), then reads them. They change nothing: no undo step, the selection stays as it was, nothing is saved. A call refuses while the design shows a preview or an earlier step (see the errors below), so every number comes from one design. Lengths are mm, areas mm², volumes mm³, weights grams, angles degrees. A call with no `ids` uses every top-level body that is not a hole and not hidden; with `ids` it uses those bodies (a missing one throws an error naming the id). A body that has not built shows its build error; show a hidden body that was never built first.

| Call | Result | Exact or mesh |
|---|---|---|
| `inspect(ids?, {material, density})` | `{ material: {key, name, density}, bodies: [{ id, name, hole, hidden, bbox: {min, max}, size: [x, y, z], volume, volumeFrom, area, weight, solids, error }], total: { bodies, bbox, size, volume, area, weight } }`. `material` is a filament key (`pla` by default; `pla`, `plaplus`, `petg`, `abs`, `asa`, `nylon`, `pc`, `cfpla`, `cfnylon`, `peek`, `tpu`); `density` (g/cm³, 0.1 to 25) overrides it and the key is then `"custom"`. `weight` is a solid part (100 % infill); a slicer's estimate is lower. A body with an `error` has null numbers and is left out of `total`. A wire-only body (curves, no surface) comes back with bbox null, volume 0, area 0 and a `note`. | `bbox`, `size`: exact box of the mesh. `volume`: the exact solid (`volumeFrom: "solid"`), else the mesh (`"mesh"`). `area`: the mesh (within about 0.5 %, a little low on curved faces). |
| `measure(a, b)` | `{ distance, exact, kind, from?, to?, delta?, angle?, parallel?, a, b }`. A target is a point `[x, y, z]`, a body id, `{body, face}` (a face number) or `{body, near: [x, y, z]}` (the face nearest that point; the result's `a.face` tells you its number). Kinds: `point-point` (with `delta`), `body-body` (shortest distance between the surfaces, 0 when they touch or overlap), `planes` (two flat parallel faces: the distance between their planes, such as a wall's thickness), `mesh`. Two flat faces also give `angle` (0 to 90). | `point-point`, `body-body`, `planes`: exact. `mesh`: `exact: false`, from the display mesh; crossing meshes do not report 0. |
| `printCheck({ids, printer, angle})` | `{ ok, summary, printer, bed: {w, d, h} or null, angle, issues: [{level, code, id, name, text}], bodies: [{ id, name, bbox, minZ, contactArea, overhangArea, overhangTriangles, fits }], ignored: [{id, name, why}] }`. `printer` is `generic` (256 x 256 mm, no height limit), `none` (no plate), or `a1`, `x1`, `p1s`, `mk4`, `mini`, `ender3`, `u1`; the default is the plate chosen in Settings. `angle` 10 to 80 (default the angle saved in Settings, 45 at first). Errors (`ok` false): `empty`, `build_error`, `wire_only`, `floating`, `below_plate`, `outside_bed`, `too_tall`. Warnings: `overhang` (more than 1 mm² of underside leaning out past `angle`), `small_contact` (less than a tenth of the footprint on the plate). Holes and hidden bodies go to `ignored`. | Mesh rules. Wall thickness is not checked. |
| `collisions({ids, gap})` | `{ pairs: [{ a, b, aName, bName, distance, state, overlap }], checked, skipped: [{id, name, error}] }`. `state` is `overlap`, `touch` (distance 0) or `near` (closer than `gap`, default 0). `overlap` is the shared volume; for `near` it is null. At most 50 bodies; the shared volume is worked out for the first 20 touching or overlapping pairs (later ones say `note`). A pair is listed when its distance is at most `gap` plus a 0.001 mm contact tolerance; 0.001 mm or less counts as touching. All distances and overlaps are worked out from one snapshot of the bodies taken at the start. The whole call has 90 seconds: pairs whose shared volume is not reached in time get `note: "not measured (the 90 second time limit was used up)"`. | Distances: exact solids. |
| `section(plane, {ids, points, picture, width})` | `plane` is `{axis: "x"|"y"|"z", at}` or `{origin, normal}`. `{ plane: {origin, normal, u, v}, shifted, area, bodies: [{ id, name, area, loops: [{ area, perimeter, hole, closed, min, max, points? }] }], skipped, truncated?, dataURL? }`. Loop coordinates are 2D, along `plane.u` and `plane.v` from `plane.origin`. `area` is the net area (outer loops minus holes), summed over bodies. A plane that passes exactly through a vertex moves 0.0001 mm (`shifted`). `points: true` adds each loop's points (over 5000 in all: `truncated`). `picture: true` adds `dataURL`, a PNG of the 3D view with the camera's side cut away (Beginner or Advanced mode; `width` default 800); the section view and the camera are put back as they were (the picture is always taken from the Home view). A cut of more than 200000 segments or 2000 outlines is refused. | Mesh cut (areas within the mesh's accuracy). |

Errors (a call that throws leaves the design as it was):

| Call | Condition |
|---|---|
| any with `ids` | An id is missing from the design. An empty list selects the default bodies. |
| body without a mesh | `measure` throws; `inspect` returns an error for the body, `printCheck` reports an issue, and `section` and `collisions` list it in `skipped`. A hidden body may need to be shown before it can build. |
| any | The design is showing a preview or is rolled back to an earlier step. |
| `measure`, `section`, `collisions` | A body has only curves and no surface. `measure` throws; `section` and `collisions` list it in `skipped`. |
| `section` | The cut exceeds the limit of 200000 line segments or 2000 outlines. |
| `collisions` | The geometry engine does not answer within 90 seconds. |
| `inspect` | The material is unknown or density is outside 0.1 to 25 g/cm³. |
| `measure` | A target, point, face index or face list is invalid; both targets are the same body; the engine cannot measure them; or the meshes are too fine to measure. |
| `printCheck` | The printer is unknown or the angle is outside 10 to 80 degrees. |
| `collisions` | The gap is outside 0 to 50 mm or more than 50 bodies are given. |
| `section` | The plane, offset, origin, normal, picture mode or picture width is invalid. |

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
| `JS3D.namePlate(opts)` → `{plate, textBody, size}` | Adds a flat plate sized to one line of text, with the text raised on it as a second body or cut into it. `opts`: `text` (required; trimmed, one line, 1 to 40 characters, every character must be in the chosen font), `font` (`"sans"` default, `"serif"` or `"mono"`; all three are bold and cover English and Western European letters, digits and common symbols, and a character they lack is refused, not dropped), `size` (the height of a capital letter, mm, 2 to 100, default 10), `style` (`"raised"` default, or `"cut"`), `depth` (how far the letters stand up or are cut in, mm, 0.2 to 10, default 1; for `"cut"` at most `thickness − 0.6`), `thickness` (the plate, mm, 0.6 to 20, default 3; `"cut"` needs 0.8 or more), `margin` (text to the plate's edge, mm, 1.5 to 20, default 3), `shape` (`"rounded"` default, corner radius = `margin`, or `"pill"`, fully round ends), `holes` (`"hang"` default: one hole at the left end; `"none"`; `"screws"`: one at each end), `holeDia` (mm, default 5 for `"hang"` and 3.5 for `"screws"`, from 1 up to the plate's depth minus 3 so 1.5 mm of plate is left round it; not with `"none"`), `color` (the plate, default `"#2b7bb9"`), `textColor` (raised letters only, default `"#ffffff"`), `at` (`[x, y, z]`: the plate's centre in x and y and its base at z, default `[0, 0, 0]`), `name` (default `Name plate <text>`; the raised text body is named the same plus ` text`). A key counts as given when it is not `null` or `undefined`. The text runs along +x, read from above. The plate is the text's measured box (width `tw`, height `th`, from the same outlines the drawing code uses) plus `margin` all round: depth `th + 2 × margin`; a hole adds `holeDia + margin` (rounded) or `holeDia / 2 + margin` (pill) of length at its end and sits `margin` from the text, and with one hole the text shifts away from it. `size` in the result is `[width, depth, height]` in mm (height = thickness plus the letters' height for `"raised"`, the thickness for `"cut"`). One hidden sketch (the outline and the holes) and one Extrude make the plate, its thickness the Extrude's distance. Raised letters are a Text shape sitting on the plate's top face with its own colour (the 3MF export keeps both colours; on a one-nozzle printer a filament change at the plate's top prints two); `textBody` is `null` for `"cut"`, whose letters are the app's Deboss text feature on the plate. Keep the two bodies separate: grouping them fuses them into one colour. The plate does not follow later text edits: to fit new text, undo and call again. Bad input throws a plain message and adds nothing: `text must be a non-empty string`, `text must be one line, without line breaks or tabs`, `text can have at most 40 characters (this has 41)`, `font must be "sans", "serif" or "mono"`, `text has characters the fonts do not have: ["Ł","ж"], got "Łж". The fonts cover English and Western European letters, digits and common symbols. Example: JS3D.namePlate({text: "Hello"}).`, `size must be a number from 2 to 100 (mm, the height of a capital letter)`, `style must be "raised" or "cut"`, `depth must be a number from 0.2 to 10 (mm)`, `thickness must be a number from 0.6 to 20 (mm)`, `the plate is too thin to cut text into (make it at least 0.8 mm)`, `depth must be at most 2.4 mm here, so 0.6 mm of plate stays under the letters`, `margin must be a number from 1.5 to 20 (mm)`, `shape must be "rounded" or "pill"`, `holes must be "none", "hang" or "screws"`, `holeDia is only for holes "hang" or "screws"`, `the text is too small for a hole here, got size 2. Use a larger margin or set holes to "none".`, `holeDia must be a number from 1 to 13 mm for this plate (it leaves 1.5 mm of plate round the hole)`, `color must look like "#rrggbb"`, `textColor is only for raised text (cut-in letters are part of the plate)`, `textColor must look like "#rrggbb"`, `at must be [x, y, z] in mm`. Undo label `Add Name plate <text>`. |
| `JS3D.knurl(opts)` → id | Adds a knurled knob: a cylinder with straight V grooves all round and an optional bore. `opts`: `diameter` (outside, to the groove tips, mm, 6 to 150, default 20), `length` (mm, 1 to 200, default 15), `grooves` (a whole number, 8 to 120; default about one per mm of circumference, `round(π × diameter)` kept between 8 and 120), `depth` (mm, 0.1 up to a quarter of the diameter, and at least `radius × (1 − cos(π / grooves))` so that the groove roots lie inside the chord between two tips; default a 90° V, `π × diameter / grooves / 2`), `bore` (`"none"` default; the dialog starts with a 5 mm round bore, `"round"`, `"hex"` or `"d"`), `boreSize` (mm, from 1 to the largest that leaves 1 mm under the groove roots; the diameter for `"round"` and `"d"`, across flats for `"hex"`; default 5, hex 8; not with `"none"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Knurled knob <diameter> x <length>`). A key counts as given when it is not `null` or `undefined`. One hidden sketch (2 × `grooves` straight lines alternating between the tip radius and the root radius, tooth 0 pointing along +x, plus the bore) and one Extrude, so the result is a true solid that exports to STEP. A `"d"` bore has its flat on the +x side, 0.4 × `boreSize` from the centre. The knurl is straight only; for a diamond pattern use the Texture tool, which works on the mesh and is not kept in a STEP file. Bad input throws a plain message and adds nothing: `diameter must be a number from 6 to 150 (mm)`, `length must be a number from 1 to 200 (mm)`, `grooves must be a whole number from 8 to 120`, `depth must be a number from 0.1 to 5 mm for this diameter (the grooves can reach at most half way to the middle)`, `depth must be at least 0.762 mm for 8 grooves on this diameter; shallower grooves vanish`, `bore must be "none", "round", "hex" or "d"`, `boreSize is only for a bore "round", "hex" or "d"`, `this knob is too small for a bore, got diameter 6. Use a larger diameter or set bore to "none".`, `boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)` (a hex adds `, measured across flats`), `at must be [x, y, z] in mm`. Undo label `Add <name>`. |
| `await JS3D.codeCad({code, bindings, name, bodyId})` → id | Builds ONE solid from replicad code in a temporary worker and adds it as an ordinary STEP body that keeps its code (`body.codeCad`). `code` is a function body that gets `replicad` and `params` and returns one closed solid (millimetres; not a drawing, surface, list or promise), at most 100,000 characters. `bindings` (optional) links names the code reads as `params.<name>` to named parameters: `{ width: "Width" }` (a parameter's name or id; saved by id, so renaming it changes nothing). With `bodyId` the body made earlier is updated in place (same id, position and later features; a new STEP file). Nothing runs when a design is opened or a parameter changes: the code runs only on a call like this or the dialog's Build and Update. The work stops after 25 seconds. The file that comes back is built again in the design's own worker and must be one closed solid before it is used. The result is one undo step, or nothing at all: a failed or cancelled build changes nothing, and a result is thrown away if another design was opened, a linked parameter changed or the body being updated changed while the code ran. The code is trusted JavaScript, not a sandbox: it can use the network, the browser's saved designs and caches, and other workers, and the time limit does not limit memory. Errors are plain messages (`The code has a syntax error: …`, `The code stopped with an error: …`, `The code must return one solid …`, `The code returned 2 separate pieces …`). The dialog is Open/Export > Code CAD…. |
| `JS3D.spring(opts)` → id | Adds a compression spring of round wire as one body (the app's Coil, with two Split body planes for flat ends). `opts`: `wire` (the wire's thickness, mm, 0.4 to 10, default 2), `outside` (outside diameter, mm, 2 to 200 and at least five wire diameters, default 20), `freeLength` (the spring's height, mm, 1 to 300, default 30), `turns` (total turns, 2 to 10 in steps of a half, default 5), `hand` (`"right"` default or `"left"`), `ends` (`"open"` default, or `"flat"`), `color` (default `"#7d8a96"`), `at` (`[x, y, z]`: the axis passes through x and y, the base is at z, default `[0, 0, 0]`), `name` (default `Spring <outside> x <freeLength>`). A key counts as given when it is not `null` or `undefined`. The wire starts on +x at the bottom and turns counter-clockwise going up for a right-hand spring. `"open"`: the wire just stops, cut square to itself, and the pitch is solved so the whole spring is exactly `freeLength` high (`freeLength = turns × pitch + wire × cos(helix angle)`). `"flat"`: the pitch is `freeLength / turns` and the first and last bit of wire is cut off by a horizontal plane, so both ends are flat and the height is exactly `freeLength`; the two planes stay where they are if the Coil is edited later, so undo and call again to change the length. Closed (squared) end turns are not made. The gap between coils, along the axis, must be at least 5 % of the wire, and the pitch at most 1.5 times the circumference of the wire's centre line (`The spring is too steep. Use more turns, a shorter free length or a larger outside diameter.`). No live preview. Bad input throws a plain message and adds nothing: `wire must be a number from 0.4 to 10 (mm)`, `outside must be a number from 2 to 200 (mm)`, `outside must be at least five wire diameters (25 mm for this wire)`, `freeLength must be a number from 1 to 300 (mm)`, `turns must be a number from 2 to 10, in steps of a half`, `hand must be "right" or "left"`, `ends must be "open" or "flat"`, `color must look like "#rrggbb"`, `at must be [x, y, z] in mm`, `The coils would touch. Increase the free length, use fewer turns, or use thinner wire.`, `This spring needs too much wire to build. Use fewer turns, a shorter free length, a smaller outside diameter or thicker wire.` (the wire's length may be at most 600 wire thicknesses; a 20 × 30 mm spring of 5 turns is 142, of 10 turns 283). Undo label `Add <name>`. |
| `JS3D.remove(ids)` → count | Deletes bodies and returns how many. `JS3D.delete` is the same call. Sketches only they used go too. |
| `JS3D.duplicate(ids, offset)` → new ids | Copies bodies, moved by `offset` (default `[0,0,0]`). |
| `JS3D.move(ids, [dx, dy, dz])` | Moves by that much along the world axes. |
| `JS3D.moveTo(id, [x, y, z])` | Puts the body's position (its matrix translation) at that point. |
| `JS3D.rotate(ids, axis, degrees, opts)` | Turns about a world axis, `"x"`, `"y"`, `"z"` or `[x, y, z]`, right-hand rule. `opts.about` is the point to turn around. The default is the middle of the bodies' world box, which needs them built: without `opts.about`, a body that is still being built or has a build error causes an error, so the result never depends on timing. |
| `JS3D.resize(id, { w, d, h, ... })` | Sets the sizes of a **plain** shape (a basic shape with no features). Same checks as `add`. A torus keeps its depth equal to its width. A size that was tied to a parameter is freed. On anything else it throws and suggests scaling instead. |
| `JS3D.scale(ids, k, opts)` | Stretches any body. `k` is one number or `[kx, ky, kz]`; an array is along **each body's own axes**, not the world's (they differ on a turned body). `opts.about` is the point that stays put (default the middle of the bodies' world box; same rule as `rotate` for bodies still being built). It adds, or folds into, a `scale` feature on the body, the way the Beginner size boxes do. Scaling back by `1/k` about the same point removes the feature again. After a scale the body is no longer a plain shape, so `resize` and `bind` refuse it until you undo or scale back. |
| `JS3D.setHole(ids, bool)` | `bool` must be `true` or `false` (same for `setHidden`). Makes bodies holes (cut away what they overlap in a group, not exported on their own) or solids. |
| `JS3D.setColor(ids, "#rrggbb")` | |
| `JS3D.rename(id, name)` | |
| `JS3D.setHidden(ids, bool)` | A hidden body stays in `list()` with `hidden: true`, is not drawn and is left out of exports. |
| `JS3D.group(ids, { name, op })` → id | Combines two or more bodies into one: solids joined, holes cut out. `op: "intersect"` keeps only what all of them share; `op: "cut"` cuts the others out of the first. |
| `JS3D.ungroup(id)` → new ids | Splits a group back into its parts, in the same places. Throws if the body is not a group; throws when the group carries features (they would be lost); throws `this group was stretched at an angle, so it cannot be split back into shapes` when a resize cannot be pushed down into turned parts. Nothing changes when it throws. |

Locks (`locked` in `list()`) are a guard for the mouse; the bridge does not
check them.

### Advanced CAD: sketches, features and selectors

These calls make the same sketches and features the Advanced dialogs make, so a person can open the feature tree, the dialogs and the
sketch editor on the result. Each is one undo step. They work in a design of any mode (`newDesign("advanced")` is the natural start).
Every one starts like the other edits (Chisel, CosForge and Chip Carving refuse), a missing body throws an error naming the id, and nothing is
added when a call throws. The geometry calls wait for the shapes to build themselves (`ready`), then refuse a body that is marked as a
hole, has a build error, or is hidden
and so was never built. A "length" is a number of mm more than 0 (or an
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
| `await JS3D.faces(id, selector)` / `await JS3D.edges(id, selector)` → list | The faces or edges of the built body that the selector picks (default `"all"`; also a whole number or a list of them), in world mm, sorted by index. A face: `index`, `type` (`plane`, `cylinder`, `cone`, `sphere`, `torus`, `other`), `center`, `normal` (planes), `area`, `radius` and `axis` (cylinders), `hole` (a cylinder that is a hole wall), `edgeCount`. An edge: `index`, `type` (`line`, `circle`, `ellipse`, `other`), `start`, `end`, `mid`, `center`, `direction` (lines), `length`, `radius` (circles), `faces` (the faces it joins). Seams and smooth joins are not edges. **Indices belong to the shape as built now and are valid until the next edit**; selectors are what to keep. Errors: `Body 1 has no face 17 (it has 0 to 9)`, `Body 1 has no edge 40 (it has 0 to 23; seams and smooth joins are not edges)`, `no faces match "cone" on "Body 1"`. |

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
mm`, `face "top" on "Body 1" matches 3 faces; a sketch needs exactly one`, `face "hole" on "Body 1" is not flat (it is a cylinder)`.

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
- An empty result reports that no faces or edges match. Invalid selectors also report the problem, such as an unknown word, a misplaced index, a missing parenthesis, or a selector for the wrong kind of item.

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
| `JS3D.boxMaker(opts = {})` → `{id, parts, cell, info}`; each part is `{id, name, kind}` | `style`: bin (default), drawer, tilt, door. `w` 10–1000 (120), `d` 10–1000 (80), `h` 5–1000 (40); for drawer, tilt and door cases the minima are 30, 30 and 20 mm respectively; `units`, `across` integers 1–8 (1). `cols` 1–20 for bin/door, 1–12 drawer, 1–8 tilt (3); `rows` 1–20 except drawer 1–12 (2). `shape`: square (default), round, hex. `wall`, `divider`, `floor` 0.4–20 (1.6, 1.2, 1.2); `radius` 0–100 (4), `inner` 0–50 (2); `scoop` true, `scoopR` 1–100 (10), `label` false, `labelW` 2–100 (10); `stack` false, `foot` 1–50 (3), `lid` false; `clear` 0–2 (0.25), `caseT` 1.2–20 (2.4). `lock`, `sideLock`: dovetail (default), pegs, none; `pull`: bar (default), knob, notch; `hinge`: left (default), right; `doorPull`: knob (default), hole, bar; `doorCatch`: none, light (default), firm. `layout`: assembled (default), print. Also `at`, `name`. Invalid ranges, choices and flags are refused. Too-small cells also cause an error. | `Bin` |
| `JS3D.gearSet(opts = {})` → `{id, parts, info}`; each part is `{id, name}` | `type`: pair (default), rack, ring, planet, bevel, helical. `module` 0.3–10 (2), `width` 0.5–200 (8 for library types; bevel/helical use `JS3D.gear` defaults), `bore` 0 for none; `at`. Library types: `teeth` integer 6–300 (20), `teeth2` integer 6–400 (40); planet uses `sunTeeth`, `planetTeeth` integers 8–200 (18,12), `planets` integer 2–6 (3). `backlash` 0–1 (0.15), `pressureAngle` 14.5,20,25 (20), `boreShape` round (default), d, hex, key; `joints` true. Rack alone: `rackLength` 0–2000 (0 gives max(8,teeth) teeth), `rackHeight` 2–100 (8). Pair/ring take teeth and teeth2; rack takes teeth; planet takes its three planet settings. Bevel/helical take teeth and teeth2 (default 20 and the same as teeth), `clear` as `JS3D.gear`; helical also takes `angle` 5–30 (20), `hand` right (default) or left; the second gets the opposite hand. Incompatible options, unsupported pressure angles, insufficient ring teeth and unsuitable bores cause errors. Here max is the smaller of module × (smallest relevant tooth count − 4.5) and 1.6 times its root radius, rounded down to 0.1 mm; planetary sets also limit the bore to half the planet root diameter. Planet sets require sun + ring teeth divisible by the planet count and more than 0.5 mm clearance between adjacent planet tips. Bevel and helical pairs use the tooth limits and other checks of `JS3D.gear`. | `Gears`, `Bevel gear pair`, `Helical gear pair` |
| `JS3D.hardware(opts = {})` → id | Required `part`: hexbolt, shcs, button, flat, set, wood, rod, nut, nyloc, sqnut, washer, lockw, insert, dowel; required `size` from that part's metric or inch list (`M3`, `1/4-20`; the latter is stored as `1/4"-20`). `length` 1–300, default the library's roughly three diameters, only for screws/rods/dowels. `threads` false, `clear` −1–0 (design's thread offset), `left` false; `at`, `name`. The lowest point rests on at's z. Invalid parts, sizes, options or thread settings and too many turns cause errors. | `Add fastener` |
| `JS3D.textures()` → `[{key, name, category, size}]` | Lists every built-in texture and its default tile size. No options or edits. | none |
| `await JS3D.texture(id, opts = {})` → `{body, texture, faces}` | `texture` key (knurl); `faces` "all" (default), a non-empty selector such as "top", an index ≥0, or a non-empty list of selectors/indices, resolved individually and combined without duplicate faces. `size` 0.5–100 (texture's size, otherwise 4), `depth` 0.05–3 (0.6), `dir`: raise (default), engrave, both; `rotation` −180–180 (0), `mapping`: auto (default), planar, cylindrical, triplanar; `edgeBlend` 0–10 (0), `invert`, `once` false. Returns faces "all" or the number chosen; texture is the new layer id. Invalid options or selectors, missing or unsuitable bodies, full texture layers and build failures cause errors. Selector errors pass through from `JS3D.faces`. | `Texture` |
| `await JS3D.drawing(opts = {})` → DXF `Uint8Array` | `ids` limits bodies (one id or a list); holes and hidden bodies are omitted. `views` is a non-empty list of distinct top/front/right, default all three, always drawn in that order; Top above Front, Right beside it. `scale` 0.01–100 (1 full size), `units` mm (default) or in; `dims` false adds overall size lines when true. Invalid options, no drawable bodies, build failures, mesh bodies requiring conversion and cancellation cause errors. Geometry-engine errors pass through unchanged. | none |

Unknown options throw an error naming the option and listing the allowed keys. The option order is: boxMaker `style, w, d, h, units, across, cols, rows, shape, wall, divider, floor, radius, inner, scoop, scoopR, label, labelW, stack, foot, lid, clear, lock, sideLock, caseT, pull, hinge, doorPull, doorCatch, layout, at, name`; gearSet `type, module, teeth, teeth2, sunTeeth, planetTeeth, planets, width, bore, boreShape, backlash, pressureAngle, rackLength, rackHeight, joints, clear, angle, hand, at`; hardware `part, size, length, threads, clear, left, at, name`; texture `texture, faces, size, depth, dir, rotation, mapping, edgeBlend, invert, once`; drawing `ids, views, scale, units, dims`.

The errors for invalid ranges, counts, flags and choices name the option and allowed values. Position and body-id checks also apply, as do the editing mode checks.

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

Nothing connects unless asked: the page makes no connection until `connect` is called or the **Connect to AI agent** row in the Customize menu (the sliders button) is turned on. That row is remembered in this browser (`jumpstart.agent`, "on" or "off", off by default) and connects to the default address when the page loads. There is no web address parameter.

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

## API changelog

- 1.13.1: Error messages name the bad input, show the value received and say what to try next; known geometry-engine failures get a hint in list(), get() and export.
- 1.13.0: Added supports, describe and apiVersion, the version promise, and a reference for every call.
- 1.12: Added checkpoints, diff and rollback.
- 1.11: Added Box Maker, gear sets, hardware, textures and DXF drawing.
- 1.10: Added inspection, measurement, print checks, collisions and sections.
- 1.9: Added advanced CAD calls, sketches and topology selection.
- 1.8: Added springs.
- 1.7: Added Code CAD and knurled knobs.
- 1.6: Added name plates.
- 1.5: Added gears.
- 1.4: Added square, hex and slot hole patterns.
- 1.3: Added hole patterns.
- 1.2: Added fasteners.
- 1.1: Added the agent connection, `run`, `invoke`, `appVersion` and screenshot width support.
- 1.0: Introduced the scripting bridge.

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
