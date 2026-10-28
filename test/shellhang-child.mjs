// Run by shellhang.test.mjs in a child process with a timeout, so an engine hang fails the test instead of the whole run.
// Builds each case with the real engine and prints one JSON line per case on stdout ("start <case>" on stderr first).
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
const source = `export * from "./kernel.js"; export { makeBox } from "replicad";`;
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "shellhang-wrapper.js", loader: "js" },
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

function thickness(shape, direction) {
  const bar = direction === "z"
    ? k.makeBox([-.01, -.01, 10], [.01, .01, 50])
    : k.makeBox([0, -.01, -.01], [40, .01, .01])
      .rotate(direction === "fillet" ? Math.atan2(13, 18) * 180 / Math.PI : 0, [0, 0, 0], [0, 0, 1])
      .translate([0, 0, 10]);
  try {
    const cut = shape.intersect(bar);
    try { return k._test.safeVolume(cut) / .0004; }
    finally { cut.delete(); }
  } finally { bar.delete(); }
}
function measure(n, id) {
  const start = Date.now();
  const [result] = k.buildBodies([{ id, rev: "shell", node: n }]);
  const ms = Date.now() - start;
  if (!result.ok) return { ok: false, error: result.error, ms };
  const shape = k.evalNode(n);
  try {
    return { ok: true, ms, volume: k._test.safeVolume(shape),
      wall: n.mods.at(-1).t === "shell" ? ["x", "z", "fillet"].map(d => thickness(shape, d)) : [],
      open: meshReport(tris(result.mesh)).open };
  } finally { shape.delete(); }
}
for (const name of ["guard", "outside", "thicker", "presspull"]) {
  console.error("start " + name);
  try {
    let n = node(0);
    if (name === "thicker") {
      const vertical = edges.filter(e => e.a[2] !== e.b[2]);
      const horizontal = edges.filter(e => e.a[2] === e.b[2]);
      n.mods = [{ ...fillet, edges: vertical }, { ...fillet, id: "f2", seq: 2, edges: horizontal, r: 1.99 }];
    } else if (name === "presspull") {
      n = { t: "prim", kind: "cylinder", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] };
      const shape = k.evalNode(n);
      let top;
      try { top = k.meshShape(shape).edgeInfo.filter(e => e.t === "CIRCLE" && Math.abs(e.m[2] - 20) < 1e-5); }
      finally { shape.delete(); }
      if (top.length !== 1) throw new Error("Expected one top circle");
      n.mods.push({ ...fillet, edges: top });
    }
    const [base] = k.buildBodies([{ id: name, rev: "base", node: n }]);
    if (!base.ok) throw new Error(base.error);
    if (name === "outside") {
      const results = [1.99, 2.01].map(th => measure(node(th), name + th));
      console.log(JSON.stringify({ case: name, results }));
      continue;
    }
    if (name === "presspull") {
      const face = base.mesh.faceInfo.find(f => f.t === "TORUS");
      if (!face) throw new Error("Expected a torus fillet face");
      n.mods.push({ id: "offset", seq: 10, t: "offset", d: -2, faces: [face] });
    } else n.mods.push({ id: "shell", seq: 10, t: "shell", th: 2, faces: [] });
    console.log(JSON.stringify({ case: name, ...measure(n, name) }));
  } catch (error) {
    console.log(JSON.stringify({ case: name, ok: false, error: error.message || k.errorText(error) }));
  }
}
