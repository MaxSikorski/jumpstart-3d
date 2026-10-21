---
name: jumpstart-3d
description: "Build and edit 3D parts in JumpStart 3D through its MCP tools: Beginner shapes, holes, groups, parameters, screenshots, STL/STEP/OBJ/3MF export. Use when the user asks for a part, bracket, box, enclosure or any 3D model, or for an edit to the design they have open in JumpStart 3D."
---

# Driving JumpStart 3D

JumpStart 3D is a CAD app that runs in a browser. These tools edit a design in it. The tool names start with a prefix your client adds; this text uses the short names (`status`, `add_shape`...).

## Facts to keep straight

- Lengths are millimetres, angles degrees, positions `[x, y, z]` with z up.
- `add_shape` puts the middle of the shape's footprint at `at` `[x, y]` and its base at `at` z. Default `[0, 0, 0]`.
- Sizes are `{w, d, h}` (width x, depth y, height z) or `[w, d, h]`. `list_kinds` shows the 20 kinds and their size keys.
- Never guess an id. Every tool that takes ids needs ones returned by `add_shape`, `group_bodies` or `list_bodies`.
- Shapes are built in the background. `volume` and `bbox` in `list_bodies` are null until you call `wait_ready`. `screenshot` and `export_file` wait by themselves.
- A hole is a cutter, not a part. It is see-through, is left out of exports, and does nothing until `group_bodies` combines it with a solid.
- A group's own position stays `[0, 0, 0]`; read `bbox` to see where it is.
- `add_fastener` makes a whole bolt, nut, threaded rod or tap cutter with a real thread (metric M2.5 to M12, inch #6 to 1/2). A bolt's `length` is under the head. A tap cutter is a hole: put it inside a solid and `group_bodies` both, and it cuts a threaded hole. Threads take a few seconds to build, so call `wait_ready`. More than 150 thread turns is refused.
- `add_hole_pattern` drills a grid, a staggered grid or a circle of round holes into one flat face of a body, as one Hole feature. `face` is the direction the face looks (`+z` is the top). Columns run along the face's longest straight edge (on a box top, the longer side), rows across it; `angle` and `start` are measured from that edge. Leave `pitch` out to spread the holes over the face; holes that would not fit inside the face and its `margin` are left out and counted in `dropped`. Plain, counterbore (`cbore`), countersink (`csink`) or `tapped`, with a `size` such as `M3`. `shape` `square`, `hex` or `slot` cuts that outline instead (`width`: the side, the width across flats or the slot's width; `length`: the slot's overall length) as one sketch and one Extrude cut, with the same layouts; stagger with a row pitch of 0.866 x the column pitch for a honeycomb. More than 200 plain holes or shapes (8 tapped) is refused. Call `wait_ready` after.
- `add_gear` makes a spur gear, a straight bevel gear or a rack from `module` (mm) and `teeth`. Two spur gears of one module mesh at centres `module × (teeth1 + teeth2) / 2` apart; when `teeth2` is even, turn the second by `180 / teeth2` degrees about its own centre with rotate_bodies. Call wait_ready after.
- `add_name_plate` makes a tag or name plate sized to one line of text: raised letters are a second body in their own colour (do not group_bodies them with the plate, that fuses them into one colour); cut letters are part of the plate. Call wait_ready after.

## The loop

1. `status` first. It never starts a browser. `page` says where you are:
   - `tab`: the user's open browser tab. You are editing their real design. Add to it; call `new_design` only if they ask (it replaces what is on screen).
   - `headless`: your own invisible browser with a blank design.
   - `none`: nothing yet. Any other tool starts headless. If the user wants their open tab, tell them: theme menu (half-moon button), turn on "Connect to AI agent". Chrome may ask to allow "local network access" for the website; they must allow it.
2. Build with `add_shape`, then `set_hole`, `move_bodies`, `resize_shape`, `group_bodies`.
3. `wait_ready`, then `list_bodies` to check sizes and volumes. A body with an `error` did not build; read the message, fix it, or `undo`.
4. `screenshot` after every few edits and look at it. Do not trust the numbers alone. If your model cannot see images, pass `path` (a file name): the PNG is saved there and you get `{path, bytes, width}` as text, so the user can look at the file.
5. At the end `export_file` and tell the user the full path. Use an absolute path; a relative one is relative to the folder the server was started in. Kinds: `stl`, `obj`, `3mf`, `step`, `json` (the project file).

If a tool fails with "could not start the headless browser", tell the user to run `npx playwright@1.62.1 install chromium` once and then try again. Headless opens the public site (https://maxsikorski.github.io/jumpstart-3d/) unless the server runs from a checkout that has a built `docs/` folder, or `JS3D_APP` says otherwise, so it needs internet when the server runs from the installed plugin.

## Worked example: a 40 x 30 x 20 mm block with an 8 mm hole straight through

1. `add_shape` `{"kind": "box", "size": {"w": 40, "d": 30, "h": 20}, "name": "Block"}` returns the block's id, say `"b1"`.
2. `add_shape` `{"kind": "cylinder", "size": {"w": 8, "d": 8, "h": 30}, "at": [0, 0, -5], "hole": true, "name": "Hole"}` returns `"b2"`. It is taller than the block and starts 5 mm below it, so it cuts all the way through.
3. `group_bodies` `{"ids": ["b1", "b2"], "name": "Block with hole"}` returns the group's id, say `"b3"`.
4. `wait_ready`, then `list_bodies`: one body, volume about 22994.7 mm3 (24000 minus the hole).
5. `screenshot` to look. `export_file` `{"kind": "stl", "path": "/Users/me/block.stl"}` returns the path and byte count.

To cut one existing solid out of another instead: `group_bodies` with `"op": "cut"` subtracts every later id from the first.

## What the tools cannot do

Sketches, extrudes, revolves, fillets, chamfers and the other Advanced features have no tool. Use `run_script` for anything else: it runs JavaScript in the page with `JS3D` in scope and returns the value as JSON. Top-level `await` works; end with `return` to give a value back. It has the full power of the page, so use it for the design only. Full reference: BRIDGE.md in the JumpStart 3D repository (https://github.com/MaxSikorski/jumpstart-3d/blob/main/BRIDGE.md). The calls you will use most:

```js
JS3D.add("box", { size: [40, 30, 20], at: [0, 0, 0], hole: false })   // returns an id
JS3D.group([a, b], { name: "Part", op: "cut" })                       // join, or cut/intersect
JS3D.scale(id, [1, 1, 2]); JS3D.rotate(id, "z", 45)                   // about the box middle: after `await JS3D.ready()`, or pass `{ about }`
JS3D.setParam("w", "40"); JS3D.bind(id, "w", "w/2")                   // a size that follows a parameter
await JS3D.ready();  JS3D.list();  JS3D.get(id).volume                // wait, then read
await JS3D.screenshot({ fit: true, width: 800 })                      // PNG bytes
await JS3D.export("step")                                             // bytes; also stl, obj, 3mf, json
await JS3D.load(jsonText)                                             // open a project file you wrote
```

To get an Advanced design (sketches, features) in, write a project file by hand (format in BRIDGE.md Part 2) and open it with `load_project`.

## Mistakes to avoid

- Reading `volume` before `wait_ready`.
- Rotating or scaling before `wait_ready` (the tools throw while a body is still being built unless you pass `about`).
- Calling `group_bodies` with a hole alone: a hole needs a solid to cut.
- Forgetting that `at` z is the base of the shape, not its middle.
- Using `new_design` on a user's open tab without being asked.
- Telling the user a file exists without the path from `export_file`.
