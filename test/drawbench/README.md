# Drawing bench: the judge for picture and blueprint to CAD (Phase 9.7)

The judge from `.claude/plans/phase9-7-picture-to-cad.md` section 7, PR 1: reference parts, their drawings and ground truth,
and a scorer that measures a built part itself. No AI and no API key are involved. Later PRs add the AI runs (PR 10).

```bash
npm run drawing-bench                         # score every reference part and every wrong part, print the table
npm run drawing-bench -- --case plate-holes   # one case
npm run drawing-bench -- --case plate-holes --design my-part.json   # score a design (project file or recipe) against a case
npm run drawing-bench:draw                    # make the drawings again (cases/<id>/drawing.png) from the recipes
```

`--app <url|file|dir>` picks the app as for `jumpstart` (default: this checkout's `docs/`, so run `node build.mjs` first).
Exit codes: 0 every scored design behaved as expected (or the given design passes), 3 a design failed, 1 the bench itself failed,
2 bad usage.

## Files

| Path | What |
|---|---|
| `score.mjs` | Pure scoring maths, no browser: case checks, tolerances, the 24 turns, hole matching, the score. Node-tested. |
| `measure.mjs` | Talks to the app through `JS3D.invoke` calls only (inspect, faces, edges, measure, collisions, params, save, load): builds parts, measures them, runs the scorer. |
| `bench.mjs` | The `npm run drawing-bench` command. |
| `page.mjs` | What the two Playwright specs (`test/drawbench.spec.mjs`, `test/drawbench-wrong.spec.mjs`) share. |
| `draw.mjs` | Makes `drawing.png` for each case: the app's own flat views (`JS3D.drawing`) plus the case's dimension lines. |
| `cases/<id>/` | One reference part: `case.json`, `truth.json`, `truth.recipe.json`, `drawing.png`, `wrong-*.recipe.json`, `other-*.recipe.json`. |
| `cases/SOURCES.md` | Who made each file, where it came from, its licence. Every case needs a line. |

## A case (`cases/<id>/case.json`)

```json
{
  "drawbench": 1,
  "id": "plate-holes",
  "title": "Mounting plate",
  "wave": 1,
  "set": "development",
  "input": { "kind": "drawing", "picture": "drawing.png", "request": "Build this part." },
  "overlap": 0.98,
  "editable": [ { "id": "edit-W", "param": 80, "to": 90, "size": [90, 50, 6] } ],
  "drawing": { "title": "MOUNTING PLATE", "units": "mm", "projection": "third", "views": ["top", "front", "right"],
               "notes": ["ALL SIZES IN MM", "TOLERANCE ±0.1 UNLESS STATED"], "dims": [ ... ] },
  "other": [ { "recipe": "other-centred.recipe.json", "why": "turned, centred, own size names", "fails": [] } ],
  "wrong": [ { "recipe": "wrong-big.recipe.json", "why": "10 percent too big", "fails": ["size", "volume", "overlap"] } ]
}
```

- `id` is the folder name (lower case, digits and dashes). `set` is `development` (may be looked at while tuning the AI's
  instructions) or `qualification` (never shown to the AI's instructions, the skill or the examples). `wave` is 1 or 2.
- `input.kind` is `drawing`, `sketch` or `photo`; `picture` is a file in the folder; `request` is what the AI will be told.
- `overlap`: the least shared volume, as a fraction of both parts together, that passes (0.98 drawing, 0.97 sketch, 0.90 photo).
- `editable`: named-size checks. Each finds a named parameter of the built design whose value is `param` (within 0.001 mm),
  changes it to `to`, saves and reloads the design, and checks that the part's box is now `size` (truth frame, within the
  `size` check's tolerance). It then puts the design back. Several parameters with that value are tried in turn; one that
  works passes. Until PR 11 these checks are reported and counted in the score but do not decide pass or fail (`gating: false`).
- `drawing`: how `draw.mjs` draws the case (below).
- `wrong`: deliberately wrong parts. `fails` lists exactly the check ids that must fail for that part (the bench and the
  Playwright test both hold the scorer to it: no more, no fewer).
- `other` (optional): other correct builds of the same part, made differently (turned, moved, centred, revolved, other
  size names). Each must pass; its `fails` may only list editable checks (a build with no named sizes fails those).

## The ground truth (`cases/<id>/truth.json`)

A part spec, the format of the design's section 5, so `check_spec` and `jumpstart build --spec` can read the same files later.

```json
{
  "spec": 1,
  "name": "Mounting plate",
  "units": "mm",
  "source": { "kind": "drawing", "projection": "third", "scale": "dimensioned" },
  "checks": [
    { "id": "size",     "kind": "size",     "value": [80, 50, 6], "tol": 0.1, "from": "stated" },
    { "id": "holes-5.5", "kind": "holes",   "dia": 5.5, "count": 4, "axis": "z", "through": true,
      "at": [[8, 8], [72, 8], [8, 42], [72, 42]], "tol": 0.1, "from": "stated" },
    { "id": "T",        "kind": "distance", "a": { "near": [50, 30, 6] }, "b": { "near": [50, 30, 0] }, "value": 6, "tol": 0.1, "from": "stated" },
    { "id": "R",        "kind": "radius",   "near": [1.757, 1.757, 3], "value": 6, "tol": 0.1, "from": "stated" },
    { "id": "volume",   "kind": "volume",   "value": 22773.15, "tol": "1%", "from": "derived", "note": "80*50*6 - ..." },
    { "id": "solids",   "kind": "solids",   "value": 1 }
  ],
  "assumed": [],
  "questions": []
}
```

- **Coordinates are measured from the part's box low corner** (the way drawings measure), in the truth's own frame:
  `near` points are `[x, y, z]`; a hole's `at` is the centre in the plane across its axis: axis `z` gives `[x, y]`, axis `y`
  gives `[x, z]`, axis `x` gives `[y, z]`.
- **Six kinds:** `size` (box sizes `[x, y, z]`), `holes`, `distance` (between the two flat faces nearest `a.near` and
  `b.near`), `radius` (the cylindrical face nearest `near`), `volume` (mm³), `solids` (count). The scorer reads only
  `near` targets; face selectors (`{ "face": "top" }`) come with `check_spec`.
- **`holes`:** `dia`, `count`, `axis` (`x`, `y` or `z`), `through` (true, or false for a blind hole), optional `at`
  (`count` centres), optional `depth` (a blind hole: from its opening to its floor), optional `cbore: { dia, depth }` (a
  counterbore at the opening), optional `opens` (`"+z"`, `"-y"`...: the side a blind hole or a counterbore opens on,
  in the truth's frame). `dia` is the smallest bore. `tol` applies to diameters, positions and depths.
- **Tolerances:** a number (plus or minus mm), `{ "minus": a, "plus": b }`, or a percent as text (`"1%"`). For `size` it
  applies to each of the three sizes. `solids` has none.
- Optional on any check: `from` (`stated`, `given`, `derived`, `measured`, `assumed`) and `note` (how a value was worked out).

## How a design is scored

`measure.mjs` builds the truth recipe in a fresh design, measures it and exports it as STEP. Then it builds or loads the
design to score in a fresh design, saves it and opens the saved file again (so every number comes from the file the person
gets), and measures it with the app's own calls. It never reads a spec the AI wrote.

1. **Gate** (check `gate`): exactly one visible solid body, built without error, an exact solid (not a mesh), with the
   truth's `solids` count. If the gate fails, every other check is `not run` and fails.
2. **Turns:** of the 24 right-angle turns (no mirror images), keep those that make the truth's box sizes match the built
   box within the `size` tolerance; if none does, keep the closest ones. For each, the truth's box low corner sits on the
   built box's low corner.
3. **Checks for each turn:** every truth check, plus `holes-total` (the built part has exactly as many holes as the truth
   lists) and `overlap` (the truth part, imported as a STEP body and turned, shares at least `overlap` of the volume of both
   parts together, measured with `JS3D.collisions`). The turn with the most passing gating checks is kept (ties: the larger
   overlap, then the first turn). If the geometry engine cannot work out the overlap, the check says "overlap not measured"
   (`unverified`) and the case is decided by the other checks (design section 7).
4. **Editable** checks run on the kept turn.
5. **Score:** passed checks out of all checks, as a percent. A case **passes** when every gating check passes; `pass` for
   the bench is 100 % of the gating checks, no partial credit. Each check is `pass`, `fail`, `unverified` (could not be
   measured) or `not run`; only `pass` counts.

Holes are found from faces: hole-wall cylinders are grouped by axis line, so a counterbore and its bore are one hole, and a
bore that comes in several faces is one hole. A hole end is closed when the face beyond its end circle is a floor (a flat
face whose outside points into the hole) or a cone or sphere that ends in a point (a drill point; a cone with an edge at
each end is a chamfer at the mouth). A hole open at both ends is through, open at
one end blind; a cavity closed at both ends is not a hole. Truth centres are matched to built holes one to one. A counterbore must reach an end of its hole (an enlargement inside
the hole is not one), at the open end of a blind hole.
Exact values are used where the app has them (cylinder radii, distances between flat faces, solid volume); the box is the
mesh's box (within about 0.02 mm on round parts).

Scoring replaces the open design several times (the overlap and editable checks load temporary copies) and puts the
design back under its own id at the end; the temporary copies get new ids and stay in that browser's design list. Run it
in a throwaway browser, as the bench and the tests do, never in a person's own tab.

Known blind spot: a small extra feature that the truth does not list (a notch, a slot, an extra chamfer) passes when it
stays under the volume tolerance (1 %) and the overlap limit (0.98). A truth file catches it only with a check aimed at it.

## Drawings (`case.json` `drawing`)

`draw.mjs` builds the truth recipe, takes the flat views from `JS3D.drawing({ views })` (visible edges only, no hidden lines),
lays them out itself and adds the case's dimensions, then writes a PNG 2000 pixels wide.

- `projection`: `third` (Top above Front, Right to the right of Front) or `first` (Top below Front, Right to the left).
- `units`: `mm` or `in` (the label text is written in `dims` as it should appear; `units` only goes into the title block).
- `title`, `notes`: the title block. The title block also says the projection and "Drawn for the JumpStart 3D drawing bench".
- `dims`: each in one view, with points measured from that view's box low corner, in mm (top view `[x, y]`, front view
  `[x, z]`, right view `[y, z]`):
  - `{ "view": "top", "type": "linear", "along": "x", "from": [0, 0], "to": [80, 0], "at": -10, "text": "80" }`: a size line
    along x (or `"along": "y"`), with extension lines from both points to the size line at `at` (a y value for `along: x`,
    an x value for `along: y`; outside the part, so negative or past the size).
  - `{ "view": "top", "type": "leader", "point": [30, 25], "r": 5, "to": [50, 62], "text": "Ø10 THRU" }`: an arrow from the
    edge of the circle of radius `r` round `point` (or from `point` itself when `r` is left out) to `to`, with the text there.
  - `{ "view": "top", "type": "centre", "point": [30, 25], "r": 5 }`: a centre mark.

Sizes on a drawing are the truth's: a drawing never shows a size the truth file does not hold, and every stated size in the
truth is on the drawing.
