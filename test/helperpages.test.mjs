// Needs a fresh `node build.mjs` (npm test's pretest runs it). The helper files (tools/helper-files.mjs) must be files on the site, in the right
// service-worker list, and inline in the single file only; the on-use mode must stay out of the install list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { HELPER_FILES, STAMP, helperLists, fillHelperSlots } from "../tools/helper-files.mjs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const site = read("docs/app.js"), single = read("dist/jumpstart-3d.html"), sw = read("docs/sw.js");
const slot = (name, source) => JSON.parse(source.match(new RegExp(`const ${name} = (\\[.*?\\]);`))[1]);
const onDisk = readdirSync(new URL("../docs/helpers/", import.meta.url)).sort();

test("docs/helpers holds exactly the files listed in HELPER_FILES", () => {
  assert.deepEqual(onDisk, Object.keys(HELPER_FILES).sort());
});

test("docs/sw.js lists each helper file in the slot of its mode, and nowhere else", () => {
  const precache = slot("HELPERS", sw), onUse = slot("ON_USE", sw);
  for (const f of onDisk) {
    const inPre = precache.includes("helpers/" + f), inUse = onUse.includes("helpers/" + f);
    assert.equal(inPre, HELPER_FILES[f] === "precache", f);
    assert.equal(inUse, HELPER_FILES[f] === "on-use", f);
  }
  assert.equal(precache.length + onUse.length, onDisk.length);
});

test("every helper file carries the build stamp the app checks, the same id in each", () => {
  const ids = new Set(onDisk.map((f) => read("docs/helpers/" + f).match(new RegExp("^" + STAMP + "([0-9a-f]{10})\\n"))?.[1]));
  assert.equal(ids.size, 1);
  assert.ok(!ids.has(undefined));
  assert.ok(site.includes(`"${[...ids][0]}"`), "docs/app.js is built with the same id");
});

for (const f of onDisk) {
  test(`${f}: a copy on the site, inline only in the single file`, () => {
    const text = read("docs/helpers/" + f).replace(new RegExp("^" + STAMP + "[0-9a-f]+\\n"), "");
    assert.equal(text, read("src/" + f));
    // a run of plain characters from the middle of the file, so string escaping in the bundle cannot change it
    const probe = text.slice(Math.floor(text.length / 2)).match(/[A-Za-z0-9 _.,;:()=+-]{60}/)[0];
    assert.ok(!site.includes(probe), "docs/app.js must not carry " + f);
    assert.ok(single.includes(probe), "the single file must carry " + f);
  });
}

test("a file in on-use mode is left out of the install list and is the only one in ON_USE", () => {
  const pages = Object.fromEntries(Object.entries(HELPER_FILES).filter(([, mode]) => mode === "precache"));
  const lists = helperLists({ ...pages, "big-data.json": "on-use" });
  assert.ok(!lists.precache.includes("helpers/big-data.json"));
  assert.deepEqual(lists.onUse, ["helpers/big-data.json"]);
  assert.deepEqual(lists.precache, Object.keys(pages).map((f) => "helpers/" + f));
  const filled = fillHelperSlots(read("src/sw.js"), lists);
  assert.ok(!slot("HELPERS", filled).includes("helpers/big-data.json"));
  assert.deepEqual(slot("ON_USE", filled), ["helpers/big-data.json"]);
});

test("the extra fonts are saved quietly after the engine is ready; the Floor Planner page only when opened (Max, 2026-10-30)", () => {
  assert.deepEqual(helperLists().onUse, ["helpers/floorplan.html"]);
  assert.deepEqual(helperLists().precache.sort(), ["helpers/chisel.html", "helpers/flexigen.html", "helpers/fonts_more.js", "helpers/helper-three.html", "helpers/meshstep.html"]);
});

test("an unknown mode is refused", () => {
  assert.throws(() => helperLists({ "x.js": "later" }), /mode "later"/);
});
