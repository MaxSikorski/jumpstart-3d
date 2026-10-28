// J.Siwek 2.7.3 repairs round faces the mesher triangulated wrongly (long triangles cutting across the part: stray flat "planes").
// No design we could build makes the mesher fail that way, so this feeds the real repair a real mesh whose cylinder wall has been
// spoiled on purpose, with the real OpenCascade engine (the same esbuild setup as assolid.test.mjs). It checks what the app relies on:
//  - the wall is redrawn on the true surface, the mesh stays closed and keeps its volume;
//  - the face groups still tile the triangle list one face after another (the export, the face picking and our flipSlivers read them);
//  - our cone-tip clean-up (flipSlivers, run after his repair in meshShape) still leaves a pointed cone closed.
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
const source = readFileSync(root + "src/kernel.js", "utf8") + "\nexport { repairFaceMeshes as __repair, flipSlivers as __flip, badFaceTris as __bad, surfaceDeviation as __dev };\n";
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "kernel.js", loader: "js" },
  bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent",
});
const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await k.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));

const cylinder = (w, h) => k.evalNode({ t: "prim", kind: "cylinder", p: { w, d: w, h, r: 0, c: 0 }, mods: [] });
const tris = (m) => { const out = []; for (let i = 0; i < m.triangles.length; i += 3) out.push([0, 1, 2].map((j) => [0, 1, 2].map((c) => m.vertices[3 * m.triangles[i + j] + c]))); return out; };
// the groups must follow each other without a gap and end at the last triangle
const tiled = (m) => { let at = 0; for (const g of m.faceGroups) { if (g.start !== at || g.count % 3) return false; at += g.count; } return at === m.triangles.length; };
const radiusSpread = (m, g) => { // how far the centres of a wall's triangles are from the axis (the wall's radius is 10)
  let worst = 0;
  for (let i = g.start; i < g.start + g.count; i += 3) {
    const c = [0, 1].map((a) => [0, 1, 2].reduce((s, j) => s + m.vertices[3 * m.triangles[i + j] + a], 0) / 3);
    worst = Math.max(worst, 10 - Math.hypot(c[0], c[1]));
  }
  return worst;
};
// spoil the cylinder wall: each triangle (a, b, c) becomes (a, the wall corner farthest from a, c), a long chord straight across the part
function spoil(m, shape) {
  const faces = shape.faces, wall = faces.findIndex((f) => f.geomType === "CYLINDRE");
  faces.forEach((f) => f.delete());
  const g = m.faceGroups[wall], ids = [...new Set(m.triangles.slice(g.start, g.start + g.count))];
  const P = (i) => [m.vertices[3 * i], m.vertices[3 * i + 1], m.vertices[3 * i + 2]];
  for (let i = g.start; i < g.start + g.count; i += 3) {
    const a = P(m.triangles[i]);
    let far = ids[0], d = -1;
    for (const id of ids) { const q = P(id), dd = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]); if (dd > d) { d = dd; far = id; } }
    m.triangles[i + 1] = far;
  }
  return wall;
}

test("a cylinder wall drawn as chords across the part is redrawn on the true surface, closed, with consistent face groups", () => {
  const shape = cylinder(20, 30);
  const tol = 0.02, ang = 0.2;
  const m = shape.mesh({ tolerance: tol, angularTolerance: ang });
  const volume = Math.PI * 100 * 30;
  assert.ok(tiled(m));
  assert.equal(meshReport(tris(m)).open, 0);
  const wall = spoil(m, shape);
  assert.ok(radiusSpread(m, m.faceGroups[wall]) > 1, "the spoiled wall must really cut across the part");
  const fixed = k.__repair(shape, m, tol, ang);
  assert.equal(fixed, 1);
  assert.ok(tiled(m), "the face groups must still follow each other one face after another");
  assert.equal(m.faceGroups.length, 3);
  assert.ok(radiusSpread(m, m.faceGroups[wall]) < 0.1, "the wall lies on the cylinder again");
  assert.equal(m.vertices.length % 3, 0);
  assert.equal(m.normals.length, m.vertices.length);
  assert.ok(m.triangles.every((i) => i >= 0 && i < m.vertices.length / 3), "every triangle points at a real corner");
  const r = meshReport(tris(m));
  assert.equal(r.open, 0, "no open edges after the swap");
  assert.ok(Math.abs(r.volume - volume) < volume * 0.01, "volume " + r.volume + " vs " + volume);
  // our clean-up runs after his repair on the same mesh: it must leave the groups and the closed surface alone
  const before = JSON.stringify(m.faceGroups);
  k.__flip(m);
  assert.equal(JSON.stringify(m.faceGroups), before);
  assert.ok(tiled(m));
  assert.equal(meshReport(tris(m)).open, 0);
  shape.delete();
});

test("a sound mesh is left alone by the repair", () => {
  const shape = cylinder(20, 30);
  const m = shape.mesh({ tolerance: 0.02, angularTolerance: 0.2 });
  const n = m.triangles.length, groups = JSON.stringify(m.faceGroups);
  assert.equal(k.__repair(shape, m, 0.02, 0.2), 0);
  assert.equal(m.triangles.length, n);
  assert.equal(JSON.stringify(m.faceGroups), groups);
  shape.delete();
});

test("meshShape (his repair, then our sliver clean-up) leaves a pointed cone closed", () => {
  const shape = k.evalNode({ t: "prim", kind: "cone", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] });
  const m = k.meshShape(shape);
  assert.equal(meshReport(tris(m)).open, 0);
  const volume = Math.PI * 100 * 20 / 3;
  assert.ok(Math.abs(meshReport(tris(m)).volume - volume) < volume * 0.01);
  shape.delete();
});
