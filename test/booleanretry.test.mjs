// A join, cut or intersect that comes out wrong is built again with a fuzzy value (third_party/replicad operations.ts). The
// engine's default mode changes the inputs' own edges in place, and the inputs can be shapes the kernel's cache still shares
// geometry with (a boolean mod's base, a group child with no move), so the same cut gave a different volume the second time:
// fuzz seed 32's cut came out at 1612.128 mm3, then at 1611.974 mm3 (also after a join of the same two parts).
// The retries build non-destructively. This loads the real kernel (as assolid.test.mjs does) and builds seed 32's two parts
// the way the app caches them: each call of evalNode hands back a clone of the cached shape.
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
const cut = () => R.measureVolume(part(0).cut(part(1)));
const close = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= Math.abs(want) * tol, `${what}: ${got} is not within ${tol} of ${want}`);

// each cut takes about 12 s here (the retries build torus booleans up to seven times), so this does it twice and no more:
// a join in between changed nothing the second cut did not already show
test("seed 32's cut gives 1612.128 mm3 the second time too", () => {
  const first = cut(); // the first build misses the 33.8 mm3 the hole takes off (1645.93), so it is built again
  close(first, 1612.128, 1e-5, "first cut");
  close(cut(), first, 1e-6, "second cut"); // 1611.974 when a retry changed the parts the cache shares with the inputs
});
