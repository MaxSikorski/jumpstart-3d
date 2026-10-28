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
const source = `export * from "./kernel.js"; export { makeBox, makeCylinder, getOC } from "replicad";`;
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
// the length of a thin bar from the middle of the shape along d that lies inside the shape (the wall along that ray)
function along(shape, d) {
  const [lo, hi] = shape.boundingBox.bounds, c = lo.map((v, i) => (v + hi[i]) / 2);
  const len = Math.hypot(...d), u = d.map(v => v / len);
  let bar = k.makeBox([0, -.01, -.01], [200, .01, .01]);
  const ax = [0, -u[2], u[1]], s = Math.hypot(...ax);
  if (s > 1e-9) bar = bar.rotate(Math.atan2(s, u[0]) * 180 / Math.PI, [0, 0, 0], ax.map(v => v / s));
  else if (u[0] < 0) bar = bar.rotate(180, [0, 0, 0], [0, 0, 1]);
  bar = bar.translate(c);
  try {
    const cut = shape.intersect(bar);
    try { return +(k._test.safeVolume(cut) / .0004).toFixed(3); }
    finally { cut.delete(); }
  } finally { bar.delete(); }
}
// nearest distance between the hollow's shell(s) and the outer shell (the one with the largest box); between the
// solids themselves it would read 0. null when the shape has no hollow.
function hollowGap(shape) {
  const OC = k.getOC(), shells = [];
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    for (; ex.More(); ex.Next()) {
      const box = new OC.Bnd_Box();
      OC.BRepBndLib.AddOptimal(ex.Current(), box, false, false);
      const a = box.CornerMin(), b = box.CornerMax();
      shells.push({ shell: ex.Current(), diag: Math.hypot(b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()) });
      box.delete();
    }
    if (shells.length < 2) return null;
    const outer = shells.reduce((m, x) => x.diag > m.diag ? x : m);
    let best = Infinity;
    for (const x of shells) {
      if (x === outer) continue;
      const dss = new OC.BRepExtrema_DistShapeShape();
      try {
        dss.LoadS1(x.shell); dss.LoadS2(outer.shell);
        if (dss.Perform() && dss.IsDone()) best = Math.min(best, dss.Value());
      } finally { dss.delete(); }
    }
    return Number.isFinite(best) ? +best.toFixed(4) : null;
  } finally { ex.delete(); shells.forEach(x => x.shell.delete && x.shell.delete()); }
}
const rays = (shape) => ({ x: along(shape, [1, 0, 0]), y: along(shape, [0, 1, 0]), z: along(shape, [0, 0, 1]), diag: along(shape, [1, 1, 1]) });
function measure(n, id, probe) {
  const start = Date.now();
  const [result] = k.buildBodies([{ id, rev: "shell", node: n }]);
  const ms = Date.now() - start;
  if (!result.ok) return { ok: false, error: result.error, ms };
  const shape = k.evalNode(n);
  try {
    return { ok: true, ms, volume: k._test.safeVolume(shape),
      ...(probe ? probe(shape) : { wall: n.mods.at(-1).t === "shell" ? ["x", "z", "fillet"].map(d => thickness(shape, d)) : [] }),
      open: meshReport(tris(result.mesh)).open };
  } finally { shape.delete(); }
}
function shaft(radii) {
  let shape = k.makeCylinder(radii[0], 5);
  try {
    for (let i = 1; i < radii.length; i++) {
      const piece = k.makeCylinder(radii[i], 5, [0, 0, 5 * i]);
      try {
        const joined = shape.fuse(piece);
        shape.delete();
        shape = joined;
      } finally { piece.delete(); }
    }
    return shape;
  } catch (error) { shape.delete(); throw error; }
}
const prim = (kind, p) => ({ t: "prim", kind, p, mods: [{ id: "s", seq: 2, t: "shell", th: 2, faces: [] }] });
for (const name of ["guard", "outside", "thicker", "bothhit", "presspull", "capsule", "flatcap", "unchanged"]) {
  console.error("start " + name);
  try {
    // Auto method on free-form (capsule) and on other shapes, through the real build path
    if (name === "capsule") {
      console.log(JSON.stringify({ case: name, ...measure(prim("capsule", { w: 40, d: 20, h: 12 }), name, shape => ({ gap: hollowGap(shape), rays: rays(shape) })) }));
      continue;
    }
    if (name === "flatcap") {
      console.log(JSON.stringify({ case: name, ...measure(prim("capsule", { w: 20, d: 20, h: 8 }), name, () => ({})) }));
      continue;
    }
    if (name === "unchanged") {
      const plain = prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 });
      const results = {
        roundbox: measure(node(2), "roundbox", () => ({})),
        box: measure(plain, "box", () => ({})),
        sphere: measure(prim("sphere", { w: 30, d: 30, h: 30 }), "sphere", () => ({})),
        torus: measure(prim("torus", { w: 40, d: 40, h: 10, tube: 10 }), "torus", () => ({})),
      };
      console.log(JSON.stringify({ case: name, results }));
      continue;
    }
    if (name === "bothhit") {
      const start = Date.now();
      const both = shaft([2.01, 2, 1.99]);
      const two = shaft([3, 2, 1.99]);
      let resultBoth, resultTwo;
      try {
        resultBoth = k._test.shellSolid(both, 2, [], "in", "exact");
        resultTwo = k._test.shellSolid(two, 2, [], "in", "exact");
        console.log(JSON.stringify({ case: name, nullBoth: resultBoth === null,
          okTwo: !!resultTwo && k._test.safeVolume(resultTwo) > 0, ms: Date.now() - start }));
      } finally {
        resultBoth?.delete(); resultTwo?.delete(); both.delete(); two.delete();
      }
      continue;
    }
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
    let baseVolume;
    if (name === "presspull") {
      const plain = k.evalNode(n);
      try { baseVolume = k._test.safeVolume(plain); }
      finally { plain.delete(); }
      const face = base.mesh.faceInfo.find(f => f.t === "TORUS");
      if (!face) throw new Error("Expected a torus fillet face");
      n.mods.push({ id: "offset", seq: 10, t: "offset", d: -2, faces: [face] });
    } else n.mods.push({ id: "shell", seq: 10, t: "shell", th: 2, faces: [] });
    console.log(JSON.stringify({ case: name, ...measure(n, name), ...(name === "presspull" ? { base: baseVolume } : {}) }));
  } catch (error) {
    console.log(JSON.stringify({ case: name, ok: false, error: error.message || k.errorText(error) }));
  }
}
