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
| `JS3D.version` | `"1.1"`. The last number goes up when calls are added; the first changes when a call changes shape. |
| `JS3D.appVersion` | The app's version, such as `"2.0"`. |
| `JS3D.kinds()` | `[{ kind, defaults }]`: the 20 shape kinds `add` accepts and their default sizes (`box`, `cylinder`, `sphere`, `cone`, `pyramid`, `wedge`, `torus`, `tube`, `hemisphere`, `prism`, `text`, `star`, `heart`, `roof`, `roundroof`, `paraboloid`, `gem`, `spring`, `capsule`, `arrow`). |
| `JS3D.list()` | The top-level bodies: `[{ id, name, kind, hole, hidden, locked, color, position, bbox, volume, error, children? }]`. `kind` is the shape kind for a basic shape and `"group"`, `"extrude"`, `"revolve"`... for the rest. `bbox` is the world box `{ min: [x,y,z], max: [x,y,z] }` and `volume` is in mm³; both are `null` until built (and while an error is shown). `error` is the geometry engine's message or `null`. `children` is the number of parts in a group. |
| `JS3D.get(id)` | The same entry plus `node` (a copy of the body's definition) and `m` (its 16-number matrix). |
| `JS3D.params()` | `[{ name, expr, value, unit }]`. `value` is mm (`null` when the expression fails), `unit` is `"mm"` or `"in"`. |
| `JS3D.doc()` | A copy of the whole design document. |
| `JS3D.save()` | `{ app: "jumpstart-3d", version: 1, doc }`: what the Export menu's project file holds. Nothing is downloaded or stored. See [Part 2](#part-2-the-project-file-format). |
| `JS3D.mode()` | `"beginner"` or `"advanced"` (or `"chisel"`). |
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
| `JS3D.setMode("beginner" \| "advanced")` | Switches the mode. |
| `await JS3D.screenshot(opts)` → `Uint8Array` | A PNG of the 3D view, after waiting for `ready`. `opts.fit: true` frames everything shown first (ignoring the selection). `opts.width` (1 to 8192) makes the picture that many pixels wide with the same shape, drawn in the same step as the render; without it the picture is the size of the 3D view. |
| `await JS3D.screenshotDataURL(opts)` → string | The same (`fit` and `width` too) as a `data:image/png;base64,...` string (also async). In a background tab the browser runs no animation frames; the camera move for `fit` is then jumped to its end. |

### Files

| Call | What it does |
|---|---|
| `await JS3D.export(kind, opts)` → `Uint8Array` | `kind` is `"stl"`, `"obj"`, `"3mf"`, `"step"` or `"json"`. Waits for `ready` first. By default it exports every shown solid, like the Export menu with nothing selected; `opts.ids` names the bodies instead. STL, OBJ and 3MF bytes are identical to the menu's download; STEP bytes differ in the time stamp and an export counter inside the file (the tests blank both before comparing). Holes and hidden bodies are left out, also when named in `opts.ids`. It throws when there is nothing to export, and when a body has a build error (the menu would export its last good shape). `"json"` is `JSON.stringify(save(), null, 1)` as UTF-8 and ignores `ids`. |
| `await JS3D.load(json, { keepId })` | Opens a project (each `load` and `newDesign` adds an entry to "Your designs" in this browser, because the app saves the design it opens): `json` is the file's text, the parsed object, or a bare `doc`. It replaces the open design the way opening a project file does (new design id unless `keepId`, undo history cleared, saved in this browser), then waits for `ready`. A file that is not a project throws `not a JumpStart 3D project`. A body that would break the 3D view (no `id`, no `node`, no 16-number `m`) throws the same message with the reason. Nothing is changed when it throws. |
| `await JS3D.newDesign(mode)` | Starts an empty design (and adds an entry to "Your designs"), `"beginner"` (default) or `"advanced"`. |

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

The link, in text frames of JSON: the page sends `{"hello":"jumpstart-3d","version":"1.1","app":"2.0","url":<page address>}` once it is open. The server sends `{"id":1,"call":"add","args":["box",{"size":[40,30,20]}]}`; the page answers `{"id":1,"result":...}` or `{"id":1,"error":"message"}`. Calls run one at a time, in the order they arrive. A `Uint8Array` result is `{"$bytes": base64}`. The server accepts one page at a time: a second page that says hello is closed with code 4001, and the page then switches its link off and does not retry (the remembered setting stays on). Recent Chrome and Edge ask before the website may reach a program on this computer ("local network access"); allow it. The single file is not asked.

### What the bridge does not do

- It builds Beginner shapes (the 20 kinds), groups, scale and parameters.
  Sketches, extrudes, fillets and the other Advanced features are not
  available as calls. To get an Advanced design in, write or generate a
  project file (Part 2) and `load` it.
- It does not push, publish or save anything outside this browser. `load`
  does save the opened design in this browser's storage, as opening a file does.

## Part 2: The project file format

A project is one JSON document. This part was written by looking at real files:
the 31 designs in `test/projects/`, designs built with `JS3D` and saved with
`JS3D.save()`, and what the app does with each file after `JS3D.load` and a
save. Each table says what was seen; **not checked** marks what was not.

### The file

```json
{ "app": "jumpstart-3d", "version": 1, "doc": { ... } }
```

The Export menu and `JS3D.save()` write this envelope (the menu indents with one
space). Opening a file accepts either the envelope or the bare `doc`: the app
reads `file.doc` if there is one, else the whole file. All 31 designs in
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
