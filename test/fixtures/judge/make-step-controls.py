import os
from pathlib import Path

import Part

# This is a one-time authoring script, never part of the integration test.
out = Path(os.environ['JUDGE_FIXTURE_OUTPUT'])
out.mkdir(parents=True, exist_ok=True)
cube = Part.makeBox(10, 10, 10)
shell = Part.makeShell(cube.Faces[:5])
second = Part.makeBox(10, 10, 10)
second.translate((30, 0, 0))
loose = shell.copy()
loose.translate((60, 0, 0))
shapes = {
    'cube.step': cube,
    'open-shell.step': shell,
    'two-cubes.step': Part.makeCompound([cube, second]),
    'two-cubes-and-shell.step': Part.makeCompound([cube, second, loose]),
}
for name, shape in shapes.items():
    shape.exportStep(str(out / name))
    imported = Part.read(str(out / name))
    print(name, 'solids=', len(imported.Solids), 'volume=', imported.Volume,
          'shells_closed=', [s.isClosed() for s in imported.Shells], flush=True)
