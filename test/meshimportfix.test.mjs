// A mesh import merges each flat area's triangles into one face, but the corners kept their 1e-7 tolerance while the merged face is
// flat only to ~1e-5 mm, so on Max's Raspberry Pi lid 546 of 2,953 faces were invalid and a join with faces exactly flush came out
// open (137 open edges, 2,084 non-manifold) with a volume the guard accepted: no retry, no error. solidFromMesh now runs the
// kernel's fixSolid after the merge (kernel.js, "mesh import fix"). This loads the real kernel (as booleanretry.test.mjs does).
// The lid (test/fixtures/pi-lid.stl, 466 KB) is not in the public repo yet: its tests skip, saying so, while it is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const lidFile = root + "test/fixtures/pi-lid.stl";
const haveLid = existsSync(lidFile);
const skipLid = haveLid ? false : "test/fixtures/pi-lid.stl is missing (Max's Pi lid, not in the public repo yet): copy it there to run this test";

const tp = root + "third_party/";
const bundle = await build({
  stdin: { contents: 'export { initKernel, evalNode, setAsset } from "./src/kernel.js"; export * as R from "replicad"; export { readMeshFile, packMesh } from "./src/meshimport.js";', resolveDir: root },
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
const { initKernel, evalNode, setAsset, R, readMeshFile, packMesh } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
const oc = R.getOC();
const T = oc.TopAbs_ShapeEnum;

const importMesh = async (id, bytes, name) => {
  const res = await readMeshFile(new Uint8Array(bytes), name);
  setAsset(id, "mesh", packMesh(res.mesh));
  return { t: "mesh", asset: id, mods: [] };
};
const faces = (shape) => {
  const out = [], ex = new oc.TopExp_Explorer(shape.wrapped, T.TopAbs_FACE, T.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) out.push(oc.TopoDS.Face(ex.Current()));
  ex.delete();
  return out;
};
const invalidFaces = (shape) => faces(shape).filter((f) => { const a = new oc.BRepCheck_Analyzer(f, true, false); const ok = a.IsValid(); a.delete(); return !ok; }).length;
const count = (shape, type) => { const ex = new oc.TopExp_Explorer(shape.wrapped, type, T.TopAbs_SHAPE); let n = 0; for (; ex.More(); ex.Next()) n++; ex.delete(); return n; };

// the result meshed again: open and non-manifold edges, and how much of the fill area (x -36.88..26.75, y -15.21..15.5, z 0..3) is solid under vertical rays (those inside the footprint of the later cut counted apart)
function checkMesh(shape) {
  const bb = shape.boundingBox, diag = Math.hypot(...[0, 1, 2].map((i) => bb.bounds[1][i] - bb.bounds[0][i]));
  const m = shape.mesh({ tolerance: Math.max(0.005, diag * 0.0006), angularTolerance: 0.2 });
  const P = m.vertices, I = m.triangles, tris = [];
  for (let i = 0; i < I.length; i += 3) tris.push([0, 1, 2].map((k) => [P[I[i + k] * 3], P[I[i + k] * 3 + 1], P[I[i + k] * 3 + 2]]));
  const key = (p) => p.map((x) => x.toFixed(4)).join(",");
  const edges = new Map();
  for (const t of tris) {
    const ks = t.map(key);
    for (let i = 0; i < 3; i++) { const a = ks[i], b = ks[(i + 1) % 3], e = a < b ? a + "|" + b : b + "|" + a; edges.set(e, (edges.get(e) || 0) + 1); }
  }
  let open = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
  let rays = 0, solid = 0, holeRays = 0, holeSolid = 0;
  for (let x = -37.25 + 0.37; x < 26.75; x += 1) for (let y = -15.5 + 0.29; y < 15.5; y += 1) {
    const zs = [];
    for (const [a, b, c] of tris) {
      const d = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const d1 = d(a, b), d2 = d(b, c), d3 = d(c, a);
      if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
      const A = d(b, c), B = d(c, a), C = d(a, b);
      zs.push((A * a[2] + B * b[2] + C * c[2]) / (A + B + C));
    }
    zs.sort((p, q) => p - q);
    let len = 0;
    for (let i = 0; i + 1 < zs.length; i += 2) { const lo = Math.max(zs[i], 0), hi = Math.min(zs[i + 1], 3); if (hi > lo) len += hi - lo; }
    const inHole = x > -26.3 && x < 11.7 && Math.abs(y) < 19;
    if (inHole) { holeRays++; if (len > 0.05) holeSolid++; } else { rays++; if (len > 2.95) solid++; }
  }
  return { open, nonManifold, rays, solid, holeRays, holeSolid };
}

const I = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

test("an imported Pi lid has only valid faces", { skip: skipLid }, async () => {
  const lid = evalNode(await importMesh("lid", readFileSync(lidFile), "pi-lid.stl"));
  assert.ok(faces(lid).length > 2000, "the lid keeps its merged faces");
  assert.equal(invalidFaces(lid), 0, "faces BRepCheck calls invalid (546 before the fix)");
});

test("the Pi lid joined with a box flush with its faces, then cut, comes out closed and full", { skip: skipLid }, async () => {
  const lidNode = await importMesh("lid2", readFileSync(lidFile), "pi-lid.stl");
  const fill = { t: "prim", kind: "box", p: { w: 64, d: 31, h: 3 }, mods: [] };
  const join = { t: "group", mods: [], children: [{ node: lidNode, m: I() }, { node: fill, m: I(-5.25, 0, 0) }] };
  const t0 = Date.now();
  const joined = evalNode(join);
  const ms = Date.now() - t0;
  assert.ok(ms < 15000, `the join took ${ms} ms`);
  const cutNode = { t: "group", mods: [], children: [{ node: join, m: I() }, { node: { t: "prim", kind: "box", p: { w: 38, d: 38, h: 5 }, mods: [] }, m: I(-7.3, 0, -1), hole: true }] };
  const cut = evalNode(cutNode);
  for (const [name, shape] of [["join", joined], ["cut", cut]]) {
    const r = checkMesh(shape);
    assert.equal(r.open, 0, `${name}: open edges`);
    assert.equal(r.nonManifold, 0, `${name}: non-manifold edges`);
    assert.equal(count(shape, T.TopAbs_SOLID), 1, `${name}: one solid`);
    assert.equal(r.solid, r.rays, `${name}: ${r.rays - r.solid} of ${r.rays} fill-area rays outside the cut are not solid`);
    if (name === "cut") assert.equal(r.holeSolid, 0, "the cut leaves no solid in its footprint");
    else assert.equal(r.holeSolid, r.holeRays, `join: ${r.holeRays - r.holeSolid} of ${r.holeRays} fill-area rays under the cut are not solid`);
  }
  const volume = R.measureVolume(cut);
  assert.ok(Math.abs(volume - 13930) <= 13930 * 1e-3, `the cut is ${volume} mm3 (Orca slices it at 13,930)`);
});

// a 10 mm cube whose six faces are each 4 x 4 x 2 triangles, corners rounded to 7 digits and pushed up to 5e-6 mm off the plane (this one is valid without the fix too: it only guards that the fix leaves a good mesh alone)
test("a noisy cube still imports as one solid of six valid faces", async () => {
  const n = 4, h = 5, tris = [];
  const jitter = (i, j, k) => ((((i * 73 + j * 151 + k * 31) % 7) - 3) / 3) * 5e-6;
  const pt = (face, u, v) => {
    const s = (face % 2 ? 1 : -1) * h, a = -h + (u / n) * 2 * h, b = -h + (v / n) * 2 * h, e = jitter(u, v, face);
    const axis = (face >> 1) % 3, p = [0, 0, 0];
    p[axis] = s + (u > 0 && u < n && v > 0 && v < n ? e : 0); p[(axis + 1) % 3] = a; p[(axis + 2) % 3] = b;
    return p.map((x) => +x.toFixed(7));
  };
  for (let face = 0; face < 6; face++) for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) {
    const q = [pt(face, u, v), pt(face, u + 1, v), pt(face, u + 1, v + 1), pt(face, u, v + 1)];
    const flip = (face % 2 ? 1 : -1) * (((face >> 1) % 3) === 1 ? -1 : 1) > 0;
    for (const t of [[0, 1, 2], [0, 2, 3]]) tris.push((flip ? t : [...t].reverse()).map((i) => q[i]));
  }
  const stl = "solid cube\n" + tris.map((t) => "facet normal 0 0 0\nouter loop\n" + t.map((p) => "vertex " + p.join(" ")).join("\n") + "\nendloop\nendfacet").join("\n") + "\nendsolid cube\n";
  const cube = evalNode(await importMesh("noisy-cube", Buffer.from(stl), "cube.stl"));
  assert.equal(count(cube, T.TopAbs_SOLID), 1, "one solid");
  assert.equal(faces(cube).length, 6, "the triangles of each side merge into one face");
  assert.equal(invalidFaces(cube), 0, "faces BRepCheck calls invalid");
  assert.ok(Math.abs(R.measureVolume(cube) - 1000) < 0.01, `the cube is ${R.measureVolume(cube)} mm3`);
});
