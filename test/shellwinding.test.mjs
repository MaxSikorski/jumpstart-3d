// The torus field had 64 flipped edges (128 open); it must have 0 and a half-cut must keep half, not volume 0.
// A slice shell read 7716 mm3 instead of about 8725. These real-kernel cases do not hang, so no child process is needed.
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
const source = `export * from "./kernel.js"; export * as sdf from "./sdfshell.js"; export { makeBox, getOC } from "replicad";`;
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "shellwinding-wrapper.js", loader: "js" },
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
const tris = (m) => { const out = []; for (let i = 0; i < m.triangles.length; i += 3) out.push([0, 1, 2].map((j) => [0, 1, 2].map((c) => m.vertices[3 * m.triangles[i + j] + c]))); return out; };
const OUTER = 36 * 26 * 16 + 4 * (36 * 26 + 26 * 16 + 36 * 16) + Math.PI * 4 * (36 + 26 + 16) + (4 / 3) * Math.PI * 8;
const wall = (t) => OUTER - (40 - 2 * t) * (30 - 2 * t) * (20 - 2 * t);
const near = (got, want, tol) => assert.ok(Math.abs(got - want) <= Math.abs(want) * tol, `volume ${got}, expected about ${want}`);
const torus = (mods = []) => ({ t: "prim", kind: "torus", p: { w: 40, d: 40, h: 10, tube: 10 }, mods });
const shell = (method) => ({ id: "s", seq: 2, t: "shell", th: 2, faces: [], method });

test("the distance field's surfaces wind one way: every edge is used once in each direction", () => {
  const shape = k.evalNode(torus());
  try {
    const m = shape.mesh({ tolerance: 0.005, angularTolerance: 0.12 });
    const V = Float32Array.from(m.vertices), I = Uint32Array.from(m.triangles), faceOf = new Int32Array(I.length / 3);
    m.faceGroups.forEach((g, fi) => { for (let i = g.start / 3; i < (g.start + g.count) / 3; i++) faceOf[i] = fi; });
    // "win" is the next test's wall; "wout" had no flips on this ring. The other three each had 32 to 296 open edges before the fix
    for (const kind of ["cavity", "outer", "wboth"]) {
      const result = k.sdf.shellField({ V, I, faceOf }, new Set(), 2, kind, { limit: 9000 });
      assert.ok(result.parts.length, kind + " must have parts");
      for (const [i, part] of result.parts.entries()) assert.equal(meshReport(tris({ vertices: part.V, triangles: part.I })).open, 0, kind + " part " + i);
    }
  } finally { shape.delete(); }
});

test("a field-method shell of a torus exports closed, with the right volume", () => {
  const [result] = k.buildBodies([{ id: "torus", rev: "field", node: torus([shell("field")]) }]);
  assert.ok(result.ok, result.error);
  const report = meshReport(tris(result.mesh));
  assert.equal(report.open, 0);
  near(report.volume, 2 * Math.PI ** 2 * 15 * (25 - 9), .01);
  near(result.mesh.volume, report.volume, .005);
});

test("a boolean on that shell works: cutting half off leaves half, closed", () => {
  const shape = k.evalNode(torus([shell("field")]));
  try {
    const box = k.makeBox([0, -30, -30], [30, 30, 30]);
    try {
      const cut = shape.cut(box);
      try {
        near(k._test.safeVolume(cut), k._test.safeVolume(shape) / 2, .01);
        assert.equal(meshReport(tris(k.meshShape(cut))).open, 0);
      } finally { cut.delete(); }
    } finally { box.delete(); }
  } finally { shape.delete(); }
});

test("a slice-method shell reports its real volume", () => {
  const node = { t: "prim", kind: "box", p: { w: 40, d: 30, h: 20, r: 0, c: 0 }, mods: [fillet, shell("slices")] };
  const [result] = k.buildBodies([{ id: "box", rev: "slices", node }]);
  assert.ok(result.ok, result.error);
  near(result.mesh.volume, wall(2), .005);
  near(result.mesh.volume, meshReport(tris(result.mesh)).volume, .005);
});
