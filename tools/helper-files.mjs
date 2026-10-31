// The files src/helperpages.js loads on demand (see src/README.md). build.mjs and test/helperpages.test.mjs use this list.
//   "precache": the service worker saves the file when it installs (the helper pages: offline must work without opening them first)
//   "on-use":   not saved at install; the service worker keeps it the first time it is fetched successfully (big, rarely used data)
// Every file lives in src/, is written to docs/helpers/ with a "js3d-build:<id>" first line, and is imported as text.
import { createHash } from "node:crypto";

export const HELPER_FILES = {
  "chisel.html": "precache",
  "flexigen.html": "precache",
  "meshstep.html": "precache",
  "helper-three.html": "precache",
  "fonts_more.js": "precache", // J.Siwek's 42 extra Text fonts (1.9 MB): saved quietly after the engine is ready (Max, 2026-10-30); src/morefonts.js parses the text
  "floorplan.html": "on-use", // the Floor Planner page (1 MB), when Architect opens it
};

export const STAMP = "js3d-build:";
const check = (files) => { for (const [f, mode] of Object.entries(files)) if (mode !== "precache" && mode !== "on-use") throw new Error(`HELPER_FILES: "${f}" has mode "${mode}"; use "precache" or "on-use"`); };

// the id the app and every helper file carry: a version mismatch (an open old page, a new release) is told apart from a missing file
export const helpersId = (contentOf, files = HELPER_FILES) => createHash("sha256").update(Buffer.concat(Object.keys(files).map((f) => Buffer.from(contentOf(f))))).digest("hex").slice(0, 10);

// the two lists src/sw.js is given, as "helpers/<file>" paths
export function helperLists(files = HELPER_FILES) {
  check(files);
  const pick = (mode) => Object.keys(files).filter((f) => files[f] === mode).map((f) => "helpers/" + f);
  return { precache: pick("precache"), onUse: pick("on-use") };
}

// src/sw.js with its HELPERS (installed with the worker) and ON_USE (kept on first use) slots filled
export function fillHelperSlots(swSource, lists) {
  for (const slot of ["HELPERS", "ON_USE"]) if (!swSource.includes(`const ${slot} = [];`)) throw new Error(`src/sw.js is missing the line const ${slot} = [];`);
  return swSource
    .replace("const HELPERS = [];", () => "const HELPERS = " + JSON.stringify(lists.precache) + ";")
    .replace("const ON_USE = [];", () => "const ON_USE = " + JSON.stringify(lists.onUse) + ";");
}
