# Third-party notices

JumpStart 3D includes the open-source software and fonts below. Their full license texts are in the `LICENSES/` folder, and are also shown in the app under **About → Open-source credits**.

## three.js (r169)

- Used for: All 3D drawing: the main view, Chisel, the Projector, FlexiGen and Mesh to STEP.
- Copyright © 2010-2024 three.js authors
- License: MIT
- Project: https://github.com/mrdoob/three.js

## replicad (1.1.0)

- Used for: The CAD layer between the app and the geometry engine (sketches, extrude, fillets, STEP).
- Copyright 2023 QuaroTech Sàrl (Steve Genoud)
- License: MIT
- Project: https://github.com/sgenoud/replicad

## Open CASCADE Technology (OCCT), as replicad-opencascadejs (1.1.0 (built with opencascade.js))

- Used for: The geometry engine (the WebAssembly file the app loads at start).
- Copyright © Open CASCADE SAS; opencascade.js © Sebastian Alff; build configuration © Steve Genoud
- License: LGPL-2.1 (OCCT: LGPL-2.1 with the Open CASCADE Exception)
- Project: https://github.com/Open-Cascade-SAS/OCCT
- Source code: OCCT https://github.com/Open-Cascade-SAS/OCCT · opencascade.js https://github.com/donalffons/opencascade.js · this build's configuration https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs. The engine is kept as its own file (occt-gz.wasm, or a separate block inside the single-file version), so it can be swapped for another build. The JumpStart 3D source download includes the engine files and how to rebuild the app with them.

## opentype.js (1.3.4)

- Used for: Reads the fonts for the Text tool.
- Copyright © 2020 Frederik De Bleser
- License: MIT
- Project: https://github.com/opentypejs/opentype.js

## Flatbush (4.6.2)

- Used for: A fast spatial index used inside replicad.
- Copyright © 2022 Vladimir Agafonkin
- License: ISC
- Project: https://github.com/mourner/flatbush

## Manifold (manifold-3d 3.5.4)

- Used for: Joins and cuts that involve an imported mesh (STL, 3MF, OBJ). The WebAssembly file is kept, gzipped, inside the geometry worker (`third_party/manifold-3d/`); it starts only when a design has an imported mesh.
- Copyright 2021 The Manifold Authors
- License: Apache-2.0 (`LICENSES/Apache-2.0-manifold.txt`)
- Project: https://github.com/elalish/manifold
- Source code: the npm package https://registry.npmjs.org/manifold-3d/-/manifold-3d-3.5.4.tgz (the glue is included unchanged; `third_party/manifold-3d/README.md` says how the WebAssembly string is made from it).

## Clipper2 (inside the Manifold WebAssembly file)

- Used for: The 2D polygon operations inside Manifold; JumpStart 3D does not call them.
- Copyright (c) Angus Johnson
- License: Boost Software License 1.0 (`LICENSES/BSL-1.0-clipper2.txt`)
- Project: https://github.com/AngusJohnson/Clipper2

## Poppins Bold (font, subset)

- Used for: The "Rounded sans" font of the Text tool.
- Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)
- License: SIL Open Font License 1.1
- Project: https://github.com/itfoundry/Poppins

## Liberation Serif Bold and Liberation Mono Bold (fonts, subsets)

- Used for: The "Serif" and "Mono" fonts of the Text tool. Shortened to the letters the tool needs and renamed JumpStart Serif / JumpStart Mono, since modified versions may not use the original names.
- Digitized data copyright © 2010 Google Corporation; Copyright © 2012 Red Hat, Inc.
- License: SIL Open Font License 1.1
- Project: https://github.com/liberationfonts/liberation-fonts

## IBM Plex Sans and IBM Plex Mono (fonts)

- Used for: The interface lettering. The font files (latin subset, WOFF2) are part of the app; nothing is loaded from the web.
- Copyright © 2017 IBM Corp. (IBM Plex Sans Condensed, used in the helper pages: © 2019 IBM Corp.)
- License: SIL Open Font License 1.1
- Project: https://github.com/IBM/plex

## Barlow Condensed (font)

- Used for: The headings (latin subset, WOFF2, part of the app).
- Copyright 2017 The Barlow Project Authors
- License: SIL Open Font License 1.1
- Project: https://github.com/jpt/barlow

## Chakra Petch (font)

- Used for: The lettering of the FlexiGen and Mesh to STEP helper pages (latin subset, WOFF2, part of the app).
- Copyright 2018 The Chakra Petch Project Authors
- License: SIL Open Font License 1.1
- Project: https://github.com/m4rc1e/Chakra-Petch

## three.js (r128)

- Used for: The 3D views of the Floor Planner (Architect → Floor Planner), which was made with this version. Built into the Floor Planner page; nothing is loaded from the web.
- Copyright © 2010-2021 three.js authors
- License: MIT (`LICENSES/MIT-three.js-r128.txt`)
- Project: https://github.com/mrdoob/three.js/tree/r128

## The Text tool's 42 extra fonts (subsets)

- Used for: The extra fonts of the Text tools (Anton, Bebas Neue, Montserrat, Lobster, Orbitron, Roboto Slab and 36 more). Shortened to the letters the tool needs and renamed "JumpStart <style>", since modified versions may not use a Reserved Font Name.
- Copyright: each font's own holders, listed per file in `LICENSES/fonts-more.txt` and in the app under About → Open-source credits.
- License: SIL Open Font License 1.1 (`LICENSES/OFL-1.1-fonts.txt`), or Apache License 2.0 for the six marked so, such as Roboto Slab and Ultra (`LICENSES/Apache-2.0-fonts.txt`)
- Project: https://github.com/google/fonts

## Flatqueue (3.1.0)

- Included in this source package because replicad's code refers to it; the built app does not end up using it.
- Copyright (c) 2025 Volodymyr Agafonkin
- License: ISC (`LICENSES/ISC-flatqueue.txt`)
- Project: https://github.com/mourner/flatqueue

## Build tool (not included in the app)

- esbuild 0.28.2, MIT license, https://github.com/evanw/esbuild — only used to build the app, not shipped inside it.
