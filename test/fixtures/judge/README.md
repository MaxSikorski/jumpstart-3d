# Export judge controls

These files are outside `test/projects/` and never enter `golden.json`.

- `cube.stl` is a binary 10 mm cube: 12 triangles, 8 exactly welded vertices,
  0 boundary edges and 1000 mm³ enclosed volume.
- `open-cube.stl` omits the top two triangles: 10 triangles and 4 boundary
  edges. `cube.3mf` and `open-cube.3mf` contain those same triangles as a
  single direct mesh/build item in millimeters, with no transform.
- The STL triangles came from the supplied runner probe's readable 20 mm
  `good.stl`/`bad.stl`, scaled by exactly one half and encoded with Python's
  standard-library `struct`. 3MF packaging used `zipfile` and a fixed timestamp.
  Local checks of the production raw-topology functions confirmed the
  facet/edge counts in all four files. The native Mesh and slicer checks of these four files run in CI (`test:judge:integration`).

The four STEP controls were authored once by `make-step-controls.py` with FreeCAD
1.1.4 on the CI runner (the script's output is the only way to get them; this Mac has no
FreeCAD) and are kept as raw files; the test never regenerates them. The script uses
`Part.makeBox(10,10,10)` and a shell of five of its six faces, without healing:

- `cube.step`: one closed solid, 1000 mm³ (one `MANIFOLD_SOLID_BREP`).
- `open-shell.step`: the five faces as an `OPEN_SHELL`, no solid; FreeCAD reports its shell as not closed.
- `two-cubes.step`: two separated closed cubes, 2000 mm³.
- `two-cubes-and-shell.step`: that compound plus a loose open shell; it must fail
  even though the two valid solids survive.

To author them again, run on a machine with the pinned FreeCAD:

```sh
JUDGE_FIXTURE_OUTPUT="$PWD/test/fixtures/judge" \
  "$FREECAD_CMD" "$PWD/test/fixtures/judge/make-step-controls.py" </dev/null
```

The `probe-*` files are verbatim outputs from supplied probe run
[39638736662](https://github.com/MaxSikorski/jumpstart-3d/actions/runs/39638736662),
October 21, 2026, Ubuntu 24.04.5 image 20261018.339.1. PrusaSlicer was
2.8.1+linux-x64-GTK3-202409181416; FreeCAD was 1.1.4. The open 20 mm cube
sliced with exit zero and empty stderr to 66 layers, byte-identical to the
closed cube's G-code. FreeCAD reported `isSolid=false`, four boundary edges,
and `hasNonManifolds=false`. The test uses this evidence to keep G-code
success separate from original mesh validity. This was Prusa's default
profile, not `tools/judge-prusa.ini`.

The unit tests' `--info` examples follow the pinned
[2.8.1 print_info implementation](https://github.com/prusa3d/PrusaSlicer/blob/version_2.8.1/src/libslic3r/Model.cpp#L1490).
The supplied probe did not capture `--info`; those examples are synthetic.
The native controls must verify that grammar on the runner and retain actual
logs under `test-results/judge-self-test/`. No unit stub establishes that a
native consumer accepts or rejects a model.
