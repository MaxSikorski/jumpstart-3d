# The helper pages: FlexiGen, Mesh to STEP and Chisel

These three pages run inside JumpStart 3D in iframes. The built pages are
committed as `src/flexigen.html`, `src/meshstep.html` and `src/chisel.html`,
so `node build.mjs` needs nothing from this folder. The three pages carry a
placeholder; `src/helperfonts.js` inserts `src/helper-three.html` when a page opens.

What is here is the author's source for them, from the v1.94 source release:

- `flexi-source.html`, `meshstep-source.html`, `chisel-source.html`: the
  original stand-alone pages
- `chisel_*.js`: the add-on modules written for Chisel (CAD tools, view cube,
  characters, textures, MP4 writer, Puppet Animator)
- `make_flexigen.py`, `make_meshstep.py`, `make_chisel.py`: splice the pieces
  into the three pages under `src/`
- `three-global*.js` and the `.min.js` builds next to them: the orbit build
  is the one shared three.js copy
- `make_helper_three.py`: wraps the orbit build in `src/helper-three.html`

To regenerate the pages after changing anything here, from the repository
root:

```bash
node_modules/.bin/esbuild tools/three-global.js --bundle --format=iife --minify --legal-comments=eof --target=es2020 --alias:three=./third_party/three/build/three.module.js --outfile=tools/three-global.min.js
node_modules/.bin/esbuild tools/three-global-orbit.js --bundle --format=iife --minify --legal-comments=eof --target=es2020 --alias:three=./third_party/three/build/three.module.js --outfile=tools/three-global-orbit.min.js
uv run --no-project python tools/make_helper_three.py
uv run --no-project python tools/make_flexigen.py
uv run --no-project python tools/make_meshstep.py
uv run --no-project python tools/make_chisel.py
node build.mjs
```

The Python scripts use only the standard library and expect to sit in `tools/` next to `src/`. `make_meshstep.py` also writes a stand-alone `mesh-to-step-helper.html` at the repository root; it is ignored by git.
