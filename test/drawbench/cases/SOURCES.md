# Where each case file comes from

Every file in this folder was made for this repository on 2026-11-14: the recipes, truth files and wrong parts were written
by hand, and each `drawing.png` was drawn by `test/drawbench/draw.mjs` from the case's `truth.recipe.json` (the app's own flat
views plus the dimensions in `case.json`). Nothing was copied from a vendor, a textbook, a CAD site or a data set.

Licence: the same as the repository (AGPL-3.0-only) until Max decides on the design's decision 3 (CC0 recommended for the test
pictures and truth files). A contributor who adds a case states in the pull request that they made it and licence it as this
file says.

| Case | Set | Files | Made by | From | Licence |
|---|---|---|---|---|---|
| `plate-holes` | development | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-big`, `wrong-moved`, `wrong-names` recipes, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | as the repository |
| `l-bracket` | development | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-features` recipe, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | as the repository |
| `flanged-bushing` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-bolt-circle` recipe, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | as the repository |
| `hex-standoff` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-inches` recipe, `drawing.png` (in inches) | this project | written here; picture drawn by `draw.mjs` | as the repository |
| `counterbored-block` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-small-hole` recipe, `drawing.png` (first angle) | this project | written here; picture drawn by `draw.mjs` | as the repository |
| `pocket-block` | qualification | `case.json`, `truth.json`, `truth.recipe.json`, `wrong-no-pocket`, `wrong-mirror` recipes, `drawing.png` | this project | written here; picture drawn by `draw.mjs` | as the repository |

Qualification cases are never shown to the AI's instructions, the skill or a worked example (design section 7).
