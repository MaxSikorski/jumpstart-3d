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

## Flatqueue (3.1.0)

- Included in this source package because replicad's code refers to it; the built app does not end up using it.
- Copyright (c) 2025 Volodymyr Agafonkin
- License: ISC (`LICENSES/ISC-flatqueue.txt`)
- Project: https://github.com/mourner/flatqueue

## Build tool (not included in the app)

- esbuild 0.28.2, MIT license, https://github.com/evanw/esbuild — only used to build the app, not shipped inside it.
