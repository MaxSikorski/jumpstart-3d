// A join, cut or intersect that comes out wrong is built again with a fuzzy value (third_party/replicad operations.ts). The
// engine's default mode raises the tolerances of the inputs' own vertices and edges in place, and the inputs can be shapes the
// kernel's cache still shares geometry with (a boolean mod's base, a group child with no move), so a later boolean on the same
// part came out differently: fuzz seed 32's cut gave 1612.128 mm3 the first time and 1611.974 mm3 the second. The retries build
// non-destructively. This loads the real kernel (as assolid.test.mjs does), builds seed 32's two parts the way the app caches
// them (each call of evalNode hands back a clone of the cached shape) and cuts once: the part must still be as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const tp = root + "third_party/";
const bundle = await build({
  stdin: { contents: 'export { initKernel, evalNode } from "./src/kernel.js"; export * as R from "replicad";', resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  alias: {
    replicad: tp + "replicad/src/index.ts",
    "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts",
    "opentype.js": tp + "opentype.js/dist/opentype.module.js",
    flatbush: tp + "flatbush/index.js",
    flatqueue: tp + "flatqueue/index.js",
    three: tp + "three/build/three.module.js",
  },
});
const { initKernel, evalNode, R } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));

// seed 32's group: a cylinder joined with a torus and scaled down, less that torus as a hole (it touches the cylinder at one point)
const children = JSON.parse(readFileSync(root + "test/fixtures/touching-tori.json", "utf8")).bodies[1].node.children;
const part = (i) => evalNode({ t: "group", mods: [], children: [children[i]] });
const oc = R.getOC();
const vertexTolerance = (shape) => oc.BRep_Tool.MaxTolerance(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);

test("a cut that is built again leaves the tolerances of its inputs alone", () => {
  const [base, hole] = [part(0), part(1)];
  assert.ok(vertexTolerance(base) < 1e-5, "the part starts clean (2.5e-6)");
  const cut = base.cut(hole); // the first build misses the 33.8 mm3 the hole takes off (1645.93), so it is built again
  assert.ok(Math.abs(R.measureVolume(cut) - 1612.128) <= 1612.128 * 1e-5, `the cut is ${R.measureVolume(cut)}`);
  assert.ok(vertexTolerance(base) < 1e-5, `the part's vertices now have a tolerance of ${vertexTolerance(base)} (2.48 when a retry changed them)`);
  assert.ok(vertexTolerance(part(0)) < 1e-5, "and so does the copy the cache holds");
});
