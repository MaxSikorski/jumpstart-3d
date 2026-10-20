# Regression tests

Playwright drives the real app in headless Chromium: the site build in `docs/`,
served locally, and the single file `dist/jumpstart-3d.html`, opened from disk
the way users open it. `npm test` rebuilds both first.

```
npm test              both builds
npm run test:site     docs/ only (fastest while working)
npm run test:single   dist/ only
```

First time: `npm install`, then `npx playwright install chromium`. Set `JS3D_PORT` (default 8765) to serve the site build on another port, so two checkouts can run the tests at the same time. The same
suite runs on GitHub Actions for every pull request (`.github/workflows/test.yml`).

## What runs

- `smoke.spec.mjs`: the app boots with the kernel ready and no console errors;
  the About dialog keeps the author's credit; dragging a shape tile makes a
  body; a fillet and a chamfer build (the kernel works), once from a document
  and once through the Fillet tool with a click on the edge; Mesh detail
  changes the triangle count; STL, OBJ, STEP and the project file download;
  FlexiGen, Mesh to STEP and Chisel open and render, and Mesh to STEP's
  pop-out tab boots on its own; a saved design is back after a reload.
  Six parameter tests load `projects/parametric-plate.json` (named parameters
  driving sketch dimensions): changing `w` changes the volume and the STL hash
  and undo restores both, a bad expression keeps the last good shape, the
  sidebar adds a parameter, opening in inches does not rescale a design typed
  in mm (a bare number next to a name is plain, a lone number typed in inches is
  read as inches), renaming a parameter
  follows it into other parameters and dimensions, and a dimension's value box
  takes an expression. Nine more load `projects/parametric-features.json`
  (feature values following parameters): changing `t`, `d` or `f` moves the
  extrude distance, hole and fillet and the STL hash with undo restoring it,
  a bad expression keeps the last shape, renaming and deleting a parameter
  follow into features, the Extrude, Fillet and Hole dialogs take an expression
  typed into their value box, and a revolve angle, a chamfer (with a sets list)
  and a shell thickness follow too, a plain number typed over a bound box removes the binding, and the copy kept by Mirror with Join follows a parameter and its renames. Eleven more load `projects/parametric-beginner.json` (Beginner box and hole sizes following parameters): changing `w` and `h` moves the volume and the STL with undo restoring both, a bad expression keeps the shape, renaming and deleting a parameter follow into the sizes, an expression typed into the inspector's Width box binds it and a number unbinds it, a size typed on the shape (Tab) drops only that binding, the bindings survive a switch to Advanced mode and the Advanced Box dialog shows them, the inspector's Parameters list adds a parameter, a resize-handle drag frees only the stretched size, ungrouping a stretched group frees the sizes it stretched, undoing a bind redraws the box, a size below 0.01 mm is skipped, and the Advanced Box dialog takes an expression. Fifteen more load `projects/advanced-pattern-mod.json` (Pattern as an editable feature: a rectangular pattern of a hole and a circular pattern of a shape): `n` and `sp` change the number of holes and the STL with one undo restoring both, double-clicking Pattern in the timeline opens Edit Pattern with the count bound and a typed number removes the binding, editing or deleting the source hole changes or empties every copy, the pattern follows a moved and turned body and still edits with its saved axis, the circular pattern stays one body and follows its count and a parameter, the dialog makes a Pattern feature (not baked copies) in Advanced, saves a world axis in the body's own axes on a turned body, and makes one shape Pattern for "Join copies", Beginner and Advanced bodies without Join still bake separate bodies, an extrude cut is repeated, a circular pattern made with Feature center saves its centre in the body's own coordinates, a partial circle and a two-direction both-sides pattern count their copies, a runaway count is clamped (and an out-of-range parameter skipped), and a mirrored body turns the copies the same way as an unmirrored one (checked on the STL bounding box). Twelve more cover the visible proof: the degrees-of-freedom count (a repeated perpendicular does not close the last freedom; too many constraints give a warning), the check mark and its ribbon note, dimension names `d1`, `d2`… in expressions (old files get names on load, a later dimension feeds an earlier one, a loop between dimensions is put back and reported, a deleted dimension's name or a parameter's name is never given to a new one, a parameter named `d7` is refused), the parameters CSV export and import (one undo step, bad rows skipped, errors counted, BOM and CRLF files, the Beginner inspector's buttons), the Parameters tutorial's checks and the About text.
- `bridge.spec.mjs`: the scripting bridge (`window.JS3D`, documented in `BRIDGE.md`), on both builds. The calls run inside the page: adding, moving, turning, resizing, scaling, grouping and ungrouping shapes, holes, remove/duplicate/rename/colour/hide, parameters (a bound size follows its parameter, bad names and expressions are refused and leave the history alone, binding works with the page in inches), undo and redo, selection and mode, every export kind (the bytes are checked and the STL, OBJ and 3MF hashes equal what the Export menu gives for the same design), `save` and `load` (the same STL hash comes back; garbage and bodies that would break the 3D view are refused; `projects/advanced-hole.json` gives the volume and STL hash recorded in `golden.json`), screenshots (a PNG whose middle really shows the red box, not a blank canvas), the guards (a group with features refuses to ungroup, and so does one stretched at an angle; turning or scaling a shape before it is built is refused unless a point is given; a parameter made in inches edited without a unit means mm; a body whose definition cannot be read does not stall `ready()`), and the demo script `tools/bridge-demo.js`, which is run as text and its summary checked. A first test checks that loading the app edits nothing. It adds no designs to `golden.json`.
- `runscript.spec.mjs`: the Open/Export › Run script… entry, on both builds: the entry and its hidden `.js` picker exist, `tools/bridge-demo.js` handed to the picker ends with one "Block with hole" body and a "Script finished" message carrying its summary, a script that throws (or does not parse) shows a red message and leaves the design and its undo history unchanged, and a script with top-level `await` and a `return` shows the returned value in the message.
- `golden.spec.mjs`: every design in `projects/` is loaded, exported as STL,
  OBJ, 3MF and STEP (and DXF when it has sketches) through the real menu, and the bytes are hashed against
  `golden.json` (the STEP file is cleaned first: the time it was written and the
  running numbers OpenCascade puts in product names and in the links between
  bodies, which depend on how many STEP exports the page did before, are blanked). The entry also keeps
  each body's volume and the STL triangle count, so a mismatch says whether
  the shape changed or only its tessellation.

When a hash moves and the change was intended, re-record:

```
npm run test:update
```

and commit the new `golden.json` with the change that caused it. (The script
sets `UPDATE_GOLDEN=1` and records from the site build; in PowerShell run
`$env:UPDATE_GOLDEN=1; npx playwright test --project=site` instead.)

## Adding a design

Drop a project file in `projects/` (Export > Save Project File, or a
hand-written document like the existing ones) and re-record. Keep designs
small: each one is built, exported three times and hashed on every run.
A design can carry `params` (`[{ id, name, expr, value }]`, plus `unit: "in"` when typed in inches) and sketch dimensions with an `expr`, as `parametric-plate.json` does. A feature (extrude or revolve node, fillet, chamfer, hole or shell mod) can carry `exprs: { dist: "t" }` (keys `dist`, `dist2`, `angle`, `r`, `d`, `dia`, `depth`, `th`; plus `exprUnits` when typed in inches), as `parametric-features.json` does; leave `exprs` out when nothing is bound. A Beginner shape (`t: "prim"` node, also inside a group) can carry `exprs: { w: "w", d: "w/2", h: "h" }` for its sizes, stored in `p`, as `parametric-beginner.json` does.
A `pattern` mod (`kind: "rect"` with `ax1`, `n1`, `s1`, optional `ax2`, `n2`, `s2`, `sym`; or `kind: "circ"` with `cax`, `center`, `cn`, `angle`) repeats either earlier mods of the same body named in `feats` (`what: "feats"`) or the whole shape so far (`what: "shape"`). Its vectors are in the body's own coordinates, not the world's, and it can carry `exprs` for `n1`, `s1`, `n2`, `s2`, `cn`, `angle`; see `advanced-pattern-mod.json`. The three older pattern designs are baked copies and stay as they are.

## How the tests reach the app

`src/app.js` ends with three lines that put `app`, `store` and `findBody` on
`window`, exactly what the author's `app/test/dbg.js` did for his own
Playwright scripts (in the v1.94 source zip on the `upstream-originals`
release). The helpers in `helpers.mjs` load a design with `__store.load`, wait
until the kernel queue is empty and every body has a mesh, read volumes from
`__app.scene.views`, and catch downloads from the Export menu.
