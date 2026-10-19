# Regression tests

Playwright drives the real app in headless Chromium: the site build in `docs/`,
served locally, and the single file `dist/jumpstart-3d.html`, opened from disk
the way users open it. `npm test` rebuilds both first.

```
npm test              both builds
npm run test:site     docs/ only (fastest while working)
npm run test:single   dist/ only
```

First time: `npm install`, then `npx playwright install chromium`. The same
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
  takes an expression.
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
A design can carry `params` (`[{ id, name, expr, value }]`, plus `unit: "in"` when typed in inches) and sketch dimensions with an `expr`, as `parametric-plate.json` does.

## How the tests reach the app

`src/app.js` ends with three lines that put `app`, `store` and `findBody` on
`window`, exactly what the author's `app/test/dbg.js` did for his own
Playwright scripts (in the v1.94 source zip on the `upstream-originals`
release). The helpers in `helpers.mjs` load a design with `__store.load`, wait
until the kernel queue is empty and every body has a mesh, read volumes from
`__app.scene.views`, and catch downloads from the Export menu.
