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
  stdin: { contents: 'export { initKernel, evalNode } from "./src/kernel.js"; export * as R from "replicad"; export { solidsMayTouch } from "replicad/shape-functions";', resolveDir: root },
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
const { initKernel, evalNode, R, solidsMayTouch } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
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

// The retries run up to 7 intersects, which on a many-face pair whose solids are apart (the meshed gears of gears.spec) passed the
// 120 s watchdog. When the first build crossed no face of one input with a face of the other, and no vertex of either input is in
// or on the other solid, the solids are apart and a result that shows no overlap is right: no retry, no intersect.
const star = (teeth, r0, r1, height) => {
  const points = [];
  for (let i = 0; i < teeth; i++) for (const [f, r] of [[0, r0], [0.15, r1], [0.35, r1], [0.5, r0]]) points.push([r * Math.cos(((i + f) / teeth) * 2 * Math.PI), r * Math.sin(((i + f) / teeth) * 2 * Math.PI)]);
  let d = R.draw(points[0]);
  for (const p of points.slice(1)) d = d.lineTo(p);
  return d.close().sketchOnPlane("XY").extrude(height);
};
// runs fn and returns how many BRepAlgoAPI_Common builders it made
const countCommons = (fn) => {
  const Common = oc.BRepAlgoAPI_Common;
  let n = 0;
  oc.BRepAlgoAPI_Common = function (...args) { n++; return new Common(...args); };
  try { fn(); } finally { oc.BRepAlgoAPI_Common = Common; }
  return n;
};
const near = (a, b, rel = 1e-5) => Math.abs(a - b) <= rel * Math.abs(b);

test("a fluted pin in a ring 0.05 mm away is cut without a single intersect", () => {
  const pin = star(40, 20, 24, 8);
  const ring = R.makeCylinder(30, 8).cut(star(40, 20.05, 24.05, 8));
  let cut;
  const commons = countCommons(() => { cut = pin.cut(ring); });
  assert.equal(commons, 0, `${commons} intersects were built`);
  assert.ok(near(R.measureVolume(cut), R.measureVolume(pin)), `the cut is ${R.measureVolume(cut)}, the pin ${R.measureVolume(pin)}`);
});

test("seed 32's reverse cut still finds the overlap its first build misses", () => {
  const cut = part(1).cut(part(0));
  assert.ok(near(R.measureVolume(cut), 676.968), `the reverse cut is ${R.measureVolume(cut)}`);
});

test("a tool fully inside its base takes its volume off (no section edges, but not apart)", () => {
  const big = R.makeBox([-50, -50, -50], [50, 50, 50]);
  const small = R.makeBox([-5, -5, -5], [5, 5, 5]);
  const cut = big.cut(small);
  assert.ok(near(R.measureVolume(cut), 1e6 - 1e3), `the cut is ${R.measureVolume(cut)}`);
});

test("a filler that fits its notch exactly is not apart: the retries still run (7 intersects) and nothing comes off", () => {
  // no section edges and no vertex of the filler inside the L, but the solids touch along three faces
  const L = R.makeBox([0, 0, 0], [20, 20, 20]).cut(R.makeBox([10, 10, -1], [21, 21, 21]));
  const filler = R.makeBox([10, 10, 0], [20, 20, 20]);
  let cut;
  const commons = countCommons(() => { cut = L.cut(filler); });
  assert.equal(commons, 7, `${commons} intersects were built (0 means the touch check is gone)`);
  assert.ok(near(R.measureVolume(cut), 6000), `the cut is ${R.measureVolume(cut)}`);
});

test("solidsMayTouch: nested or touching solids may touch, solids apart do not, whatever wraps them", () => {
  const compound = (...shapes) => {
    const builder = new oc.TopoDS_Builder(), c = new oc.TopoDS_Compound();
    builder.MakeCompound(c);
    for (const s of shapes) builder.Add(c, s.wrapped);
    return c;
  };
  const big = R.makeBox([-50, -50, -50], [50, 50, 50]), small = R.makeBox([-5, -5, -5], [5, 5, 5]);
  const apart = R.makeBox([200, 0, 0], [210, 10, 10]), touching = R.makeBox([50, 0, 0], [60, 10, 10]);
  const [B, S, A, T] = [big, small, apart, touching].map((s) => s.wrapped);
  assert.equal(solidsMayTouch(S, B), true, "a box in a box");
  assert.equal(solidsMayTouch(S, compound(big)), true, "a box in the compound a boolean returns");
  assert.equal(solidsMayTouch(compound(small), compound(big)), true, "compound in compound");
  assert.equal(solidsMayTouch(compound(apart, small), B), true, "a group with one member apart and one inside");
  // the big box's own vertex is outside the small one, so the nesting shows only from the small side: the gate asks both ways
  assert.equal(solidsMayTouch(B, compound(apart, small)), false, "one direction alone does not see the big box around a small one");
  assert.equal(solidsMayTouch(B, compound(apart, small)) || solidsMayTouch(compound(apart, small), B), true, "both directions do");
  assert.equal(solidsMayTouch(T, B), true, "a box that touches by a vertex on the face");
  assert.equal(solidsMayTouch(A, B), false, "apart");
  assert.equal(solidsMayTouch(B, A), false, "apart, the other way round");
  assert.equal(solidsMayTouch(compound(apart), compound(big)), false, "apart, both compounds");
  assert.equal(solidsMayTouch(compound(), B), true, "no solid at all: uncertain");
});
