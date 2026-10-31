# The helper pages: FlexiGen, Mesh to STEP and Chisel

These three pages run inside JumpStart 3D in iframes. The built pages are
committed as `src/flexigen.html`, `src/meshstep.html` and `src/chisel.html`,
so `node build.mjs` needs nothing from this folder. The three pages carry a
placeholder; `src/helperpages.js` loads a page on first use (inline in the single file, from `docs/helpers/` on the site) and `src/helperfonts.js` inserts `src/helper-three.html` when it opens.

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

## The Floor Planner and the extra fonts (J.Siwek 2.8.1.2 and 2.8.1.1)

- `src/floorplan.html` is made by `tools/make_floorplan.py` from `tools/floorplanner-source.html` (the Blueprint Floorplanner),
  `tools/fp_tutorials.js` and `tools/fp_addons.js`, with `third_party/three-r128/three.min.js` built in (the source's cdnjs
  `<script src>` is replaced, so the page loads nothing from the web). Regenerate from the repository root:

  ```bash
  THIRD_PARTY=third_party uv run --no-project python -I tools/make_floorplan.py
  ```

  For 2.8.1.3 this gives a file byte-equal to his.
- `src/fonts_more.js` is made by `tools/make_fonts.py` from `tools/fontlist.txt` and a checkout of the Google Fonts repository
  (not in this repository); the TTFs it used are in `src/fontsub/more/`, their credits in `src/fontsub/more/credits.json` and
  `LICENSES/fonts-more.txt`. We take his `fonts_more.js` as it is.
