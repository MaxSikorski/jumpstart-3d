// The shell hang guard in kernel.js (shellSolidOffset): a wall exactly as thick as a fillet's radius made OpenCascade's
// offset loop for minutes and eat gigabytes (Beginner: Round all edges at 2 mm, then Shell at its default 2 mm wall;
// it crashed the CI page on PR #207, 2026-10-27). With the real engine (the same esbuild setup as upstream273.test.mjs):
//  - a 40 x 30 x 20 box with 2 mm fillets and a 2 mm wall finishes in a few seconds, with the volume of a 1.99 mm wall
//    (the guard makes it 0.5% thinner) and a closed mesh;
//  - walls just outside the guard (1.99 and 2.01 mm) still use the offset as before, at their own thickness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { meshReport } from "./fuzz-checks.mjs";


const root = fileURLToPath(new URL("../", import.meta.url));
const tp = root + "third_party/";
const alias = {
  replicad: tp + "replicad/src/index.ts",
  "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts",
  "opentype.js": tp + "opentype.js/dist/opentype.module.js",
  flatbush: tp + "flatbush/index.js",
  flatqueue: tp + "flatqueue/index.js",
  "manifold-3d": tp + "manifold-3d/index.js",
  "replicad-opencascadejs": tp + "replicad-opencascadejs/dist/replicad_single.js",
};
const source = readFileSync(root + "src/kernel.js", "utf8");
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "kernel.js", loader: "js" },
  bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent",
});
const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await k.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));

// the 12 edges of the box, as the Beginner "Round all edges" button stores them
const E = (a, b) => ({ a, b, m: a.map((v, i) => (v + b[i]) / 2), t: "LINE" });
const P = [[-20, -15], [20, -15], [20, 15], [-20, 15]], edges = [];
for (let i = 0; i < 4; i++) { const [x, y] = P[i], [x2, y2] = P[(i + 1) % 4]; edges.push(E([x, y, 0], [x2, y2, 0]), E([x, y, 20], [x2, y2, 20]), E([x, y, 0], [x, y, 20])); }
const fillet = { id: "f1", seq: 1, t: "fillet", edges, r: 2 };
const node = (th) => ({ t: "prim", kind: "box", p: { w: 40, d: 30, h: 20, r: 0, c: 0 }, mods: th ? [fillet, { id: "f2", seq: 2, t: "shell", th, faces: [] }] : [fillet] });
const tris = (m) => { const out = []; for (let i = 0; i < m.triangles.length; i += 3) out.push([0, 1, 2].map((j) => [0, 1, 2].map((c) => m.vertices[3 * m.triangles[i + j] + c]))); return out; };
// the rounded box (r = 2) and the sharp-cornered hollow a wall t inside it leaves (its corners are rounded by 2 - t)
const OUTER = 36 * 26 * 16 + 4 * (36 * 26 + 26 * 16 + 36 * 16) + Math.PI * 4 * (36 + 26 + 16) + (4 / 3) * Math.PI * 8;
const wall = (t) => OUTER - (40 - 2 * t) * (30 - 2 * t) * (20 - 2 * t);
const near = (got, want, tol) => assert.ok(Math.abs(got - want) <= want * tol, `volume ${got.toFixed(1)}, expected about ${want.toFixed(1)}`);

test("a 2 mm wall on a box with 2 mm fillets finishes quickly, about 1.99 mm thick and closed", () => {
  const [first] = k.buildBodies([{ id: "b1", rev: "1", node: node(0) }]); // the fillet first, as the app builds it
  assert.ok(first.ok, first.error);
  const t0 = Date.now();
  const [res] = k.buildBodies([{ id: "b1", rev: "2", node: node(2) }]);
  const ms = Date.now() - t0;
  assert.ok(res.ok, res.error);
  assert.ok(ms < 5000, `took ${ms} ms`);
  const v = k._test.safeVolume(k.evalNode(node(2)));
  near(v, wall(1.99), 0.003);
  assert.ok(v < wall(2.01) && v > wall(1.98), `volume ${v.toFixed(1)}`);
  assert.equal(meshReport(tris(res.mesh)).open, 0);
});

test("walls just outside the guard (1.99 and 2.01 mm) keep their own thickness", () => {
  for (const th of [1.99, 2.01]) near(k._test.safeVolume(k.evalNode(node(th))), wall(th), 0.003);
});
