# Where each case file comes from

Every file in this folder was made for this repository on 2026-11-14: the recipes, truth files and wrong parts were written
by hand, and each `drawing.png` was drawn by `test/drawbench/draw.mjs` from the case's `truth.recipe.json` (the app's own flat
views plus the dimensions in `case.json`). Nothing was copied from a vendor, a textbook, a CAD site or a data set.

Licence: **CC0 1.0** (Max, 2026-11-14, the design's decision 3). Every file in this folder and its case folders (pictures,
truth files, recipes, `case.json`) is dedicated to the public domain: to the extent possible under law, the authors waive
all copyright and related rights in them worldwide (https://creativecommons.org/publicdomain/zero/1.0/). Anyone may copy,
change and reuse them without asking. The bench's code (`test/drawbench/*.mjs`) stays under the repository's licence. A
contributor who adds a case states in the pull request that they made it and dedicate it under CC0 1.0. Outside drawings
come in only after Max approves each source.

| Case | Set | Files | Made by | From | Licence |
|---|---|---|---|---|---|
| `plate-holes` | development | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-big`, `wrong-moved`, `wrong-one-corner`, `wrong-names`, `other-centred` recipes, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |
| `l-bracket` | development | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-features` recipe, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |
| `flanged-bushing` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-bolt-circle`, `other-revolve` recipes, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |
| `hex-standoff` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-inches` recipe, `drawing.png` (in inches) | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |
| `counterbored-block` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-small-hole` recipe, `drawing.png` (first angle) | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |
| `pocket-block` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-no-pocket`, `wrong-mirror` recipes, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | CC0 1.0 |

Qualification cases are never shown to the AI's instructions, the skill or a worked example (design section 7).
