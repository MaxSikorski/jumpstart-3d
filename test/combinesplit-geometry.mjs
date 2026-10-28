import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { isNearEmpty } from "../src/pieces.js";
import opencascade from "../third_party/replicad-opencascadejs/dist/replicad_single.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let runtime;
async function getRuntime() {
  if (!runtime) runtime = (async () => {
    const bundle = await build({
      stdin: { contents: 'export { initKernel, buildBodies } from "./src/kernel.js"; export { commitCombine } from "./src/combinesplit.js"; export { store, newDoc, bodyKey, resolveNode } from "./src/store.js"; export { groupBodiesInDoc, ungroupBody } from "./src/ops.js";', resolveDir: root },
      bundle: true, write: false, format: "esm", platform: "node",
      alias: {
        replicad: root + "third_party/replicad/src/index.ts",
        "replicad/shape-functions": root + "third_party/replicad/src/shapeFunctions/index.ts",
        "opentype.js": root + "third_party/opentype.js/dist/opentype.module.js",
        flatbush: root + "third_party/flatbush/index.js",
        flatqueue: root + "third_party/flatqueue/index.js",
        three: root + "third_party/three/build/three.module.js",
      },
    });
    const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
    await api.initKernel(opencascade, gunzipSync(readFileSync(new URL("../src/occt-gz.wasm", import.meta.url))));
    return api;
  })();
  return runtime;
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moved = (x = 0, y = 0, z = 0) => { const m = [...identity]; m.splice(12, 3, x, y, z); return m; };
const box = (w = 20, d = 20, h = 20) => ({ t: "prim", kind: "box", p: { w, d, h }, mods: [] });
const body = (id, node, m = identity) => ({ id, name: id, color: "#3b82c4", m: [...m], node });
const group = children => ({ t: "group", children, mods: [] });
const cutter = (width = 22, z = 9) => body("cutter", box(width, 22, 2), moved(0, 0, z));
const cutMod = (width = 22, z = 9) => ({ id: "cut", t: "bool", src: "combine", op: "cut", tool: group([cutter(width, z)]) });
async function setup(nodes, mode = "advanced") {
  const api = await getRuntime(), { store, newDoc, resolveNode, bodyKey, buildBodies } = api;
  const meshes = new Map();
  const rebuild = () => {
    const bodies = store.view.bodies.map(b => {
      const node = resolveNode(b.node, store.view);
      b._key = bodyKey(node);
      return { id: b.id, rev: b._key, node };
    });
    for (const r of buildBodies(bodies)) meshes.set(r.rev, r);
  };
  const doc = newDoc("Real kernel combine", mode); doc.bodies = nodes;
  store.load(doc);
  const off = store.on(rebuild); rebuild();
  const toasts = [];
  const app = { mode, command: null, toast: m => toasts.push(m), kernel: { get: key => meshes.get(key) }, scene: { errors: new Map() } };
  const results = () => store.doc.bodies.map(b => {
    const r = meshes.get(b._key); assert.equal(r?.ok, true, r?.error || "Missing built body"); return r.mesh;
  });
  return { ...api, app, off, results, toasts };
}
const volumes = meshes => meshes.map(m => Math.round(m.volume));
const center = mesh => mesh.bbox.min.map((v, i) => (v + mesh.bbox.max[i]) / 2);

for (const kind of ["separated boxes", "text i"]) {
  test(`real kernel: Group preserves ${kind} as one body`, async () => {
    const nodes = kind === "separated boxes" ? [body("target", box(4, 4, 4)), body("other", box(4, 4, 4), moved(8))]
      : [body("target", { t: "prim", kind: "text", p: { text: "i", size: 10, h: 2, font: "sans" }, mods: [] }), body("other", box(4, 4, 4), moved(20))];
    const h = await setup(nodes, "beginner");
    try {
      const ids = await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
      assert.equal(ids.length, 1); assert.equal(h.store.doc.bodies.length, 1);
      assert.equal(h.results()[0].solidCount, kind === "text i" ? 3 : 2);
      assert.equal(h.store.doc.bodies[0].node.mods.length, 0);
    } finally { h.off(); }
  });
}
test("real kernel: Group hole cutting a box creates two editable solids", async () => {
  const tool = cutter(); tool.hole = true;
  const h = await setup([body("target", box()), tool], "beginner");
  try {
    const ids = await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
    assert.equal(ids.length, 2); assert.deepEqual(volumes(h.results()), [3600, 3600]);
    assert.equal(h.store.undoStack.length, 1);
  } finally { h.off(); }
});
test("real kernel: editing an 18 mm Combine cutter to 22 mm creates two bodies", async () => {
  const node = box(); node.mods.push(cutMod(18));
  const h = await setup([body("target", node)]);
  try {
    assert.deepEqual(volumes(h.results()), [7280]);
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods[0].tool.children[0].node.p.w = 22; return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.equal(ids.length, 2); assert.deepEqual(volumes(h.results()), [3600, 3600]);
    assert.equal(h.store.undoStack.length, 1);
  } finally { h.off(); }
});
test("real kernel: cutting a pre-existing multi-solid target keeps it whole", async () => {
  const node = group([body("left", box(4, 4, 4), moved(-8)), body("right", box(4, 4, 4), moved(8))]);
  const h = await setup([body("target", node)]);
  try {
    assert.equal(h.results()[0].solidCount, 2);
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push(cutMod(22, 1)); return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.equal(ids.length, 1); assert.equal(h.results()[0].solidCount, 4);
    assert.deepEqual(volumes(h.results()), [64]);
  } finally { h.off(); }
});
test("real kernel: disconnected Join keeps one body", async () => {
  const h = await setup([body("target", box(4, 4, 4))]);
  try {
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push({ t: "bool", src: "combine", op: "join", tool: group([body("tool", box(4, 4, 4), moved(8))]) }); return "target"; }, "Combine", { target: "target", op: "join" });
    assert.equal(ids.length, 1); assert.equal(h.results()[0].solidCount, 2); assert.deepEqual(volumes(h.results()), [128]);
  } finally { h.off(); }
});
test("real kernel: piece identities keep their z order after a cutter edit with unchanged count", async () => {
  const h = await setup([body("target", box())]);
  try {
    await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push(cutMod()); return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.deepEqual(volumes(h.results()), [3600, 3600]);
    const ids = h.store.doc.bodies.map(b => b.id);
    h.store.update(doc => { for (const b of doc.bodies) b.node.mods[0].tool.children[0].m[14] = 8; }, "Move copied cutters");
    assert.deepEqual(h.store.doc.bodies.map(b => b.id), ids);
    assert.deepEqual(volumes(h.results()), [3200, 4000]);
    const centers = h.results().map(center);
    assert.ok(Math.abs(centers[0][2] - 4) < 0.01); assert.ok(Math.abs(centers[1][2] - 15) < 0.01);
  } finally { h.off(); }
});
test("real kernel: Group with a remote hole preserves its two-solid baseline as one body", async () => {
  const hole = body("hole", box(4, 4, 4), moved(30)); hole.hole = true;
  const h = await setup([body("left", box(4, 4, 4), moved(-8)), body("right", box(4, 4, 4), moved(8)), hole], "beginner");
  try {
    const ids = await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
    assert.equal(ids.length, 1); assert.equal(h.store.doc.bodies.length, 1);
    assert.equal(h.results()[0].solidCount, 2); assert.deepEqual(volumes(h.results()), [128]);
    assert.deepEqual(h.store.doc.bodies[0].node.mods, []);
    assert.equal(h.toasts.length, 1); assert.match(h.toasts[0], /^The hole did not cut anything/);
  } finally { h.off(); }
});
test("real kernel: a Group with no hole, or a hole that overlaps, says nothing; a Combine cut that misses says so", async () => {
  const run = async (nodes, commit) => { const h = await setup(nodes, "beginner"); try { await commit(h); return h.toasts; } finally { h.off(); } };
  const inside = body("hole", box(4, 4, 4)); inside.hole = true;
  const apart = body("hole", box(4, 4, 4), moved(40)); apart.hole = true;
  const grp = h => h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
  assert.deepEqual(await run([body("a", box()), body("b", box(4, 4, 4), moved(30))], grp), []);
  assert.deepEqual(await run([body("a", box()), inside], grp), []);
  assert.equal((await run([body("a", box()), apart], grp)).length, 1);
  const miss = h => h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push({ t: "bool", src: "combine", op: "cut", tool: group([body("c", box(4, 4, 4), moved(40))]) }); return "target"; }, "Combine", { target: "target", op: "cut" });
  const toasts = await run([body("target", box())], miss);
  assert.equal(toasts.length, 1); assert.match(toasts[0], /^The cut did not remove anything/);
});
test("real kernel: Intersect splits new pieces and keeps left/right identity across sub-0.01 mm centre changes", async () => {
  const h = await setup([body("target", box())]);
  try {
    const ids = await h.commitCombine(h.app, doc => {
      doc.bodies[0].node.mods.push({ t: "bool", src: "combine", op: "intersect", tool: group([
        body("left", box(4, 4, 4), moved(-5, 0, 4.00001)),
        body("right", box(4, 4, 4), moved(5, 0, 3.99999)),
      ]) });
      return "target";
    }, "Combine", { target: "target", op: "intersect" });
    assert.equal(ids.length, 2); assert.deepEqual(volumes(h.results()), [64, 64]);
    assert.equal(h.store.undoStack.length, 1);
    const assertLeftRight = () => {
      const centers = h.results().map(center);
      assert.ok(Math.abs(centers[0][0] + 5) < 0.01, "first piece stays left despite the higher z centre");
      assert.ok(Math.abs(centers[1][0] - 5) < 0.01, "second piece stays right despite the lower z centre");
    };
    assertLeftRight();
    h.store.update(doc => {
      for (const b of doc.bodies) {
        const tools = b.node.mods[0].tool.children;
        tools[0].m[14] = 3.99999; tools[1].m[14] = 4.00001;
      }
    }, "Reverse tiny tool offsets");
    assert.deepEqual(h.store.doc.bodies.map(b => b.id), ids);
    assert.deepEqual(volumes(h.results()), [64, 64]);
    assertLeftRight();
  } finally { h.off(); }
});
// A cutter that stops 1e-6 mm above the floor leaves a film far below any printable size next to the real block.
test("real kernel: Group cut that leaves a near-empty film gives one body with one solid", async () => {
  const tool = cutter(22, 1e-6); tool.hole = true;
  const h = await setup([body("target", box()), tool], "beginner");
  try {
    const ids = await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
    assert.equal(ids.length, 1); assert.equal(h.store.doc.bodies.length, 1);
    assert.equal(h.results()[0].solidCount, 1);
    assert.deepEqual(volumes(h.results()), [7200]);
    assert.equal(h.store.undoStack.length, 1);
  } finally { h.off(); }
});
test("real kernel: Combine cut that leaves a near-empty film keeps only the real piece", async () => {
  const h = await setup([body("target", box())]);
  try {
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push(cutMod(22, 1e-6)); return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.equal(ids.length, 1); assert.equal(h.results()[0].solidCount, 1); assert.deepEqual(volumes(h.results()), [7200]);
  } finally { h.off(); }
});
test("real kernel: a film beside two real pieces is dropped and the real pieces stay separate bodies", async () => {
  const h = await setup([body("target", box())]);
  try {
    const slice = tool => ({ t: "bool", src: "combine", op: "cut", tool: group([tool]) });
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push(slice(cutter(22, 1e-6)), slice(cutter(22, 9))); return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.equal(ids.length, 2); assert.deepEqual(volumes(h.results()), [2800, 3600]);
  } finally { h.off(); }
});
test("real kernel: a thin real shim (0.05 mm, large area) is kept as its own body", async () => {
  const tool = cutter(22, 0.05); tool.hole = true;
  const h = await setup([body("target", box()), tool], "beginner");
  try {
    const ids = await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
    assert.equal(ids.length, 2); assert.deepEqual(h.results().map(m => Math.round(m.volume * 10) / 10), [20, 7180]);
  } finally { h.off(); }
});
test("real kernel: a small real pin (1 x 1 x 2 mm) beside a 190 mm block is kept as its own body", async () => {
  const h = await setup([body("target", box(200, 200, 200))]);
  try {
    const ids = await h.commitCombine(h.app, doc => {
      doc.bodies[0].node.mods.push({ t: "bool", src: "combine", op: "intersect", tool: group([body("big", box(190, 190, 190)), body("pin", box(1, 1, 2), moved(98))]) });
      return "target";
    }, "Combine", { target: "target", op: "intersect" });
    assert.equal(ids.length, 2); assert.deepEqual(volumes(h.results()), [2, 6859000]);
  } finally { h.off(); }
});
test("real kernel: a film under a 200 x 200 base is dropped even though its volume is not tiny", async () => {
  const h = await setup([body("target", box(200, 200, 20))]);
  try {
    const ids = await h.commitCombine(h.app, doc => { doc.bodies[0].node.mods.push({ t: "bool", src: "combine", op: "cut", tool: group([body("c", box(220, 220, 2), moved(0, 0, 1e-6))]) }); return "target"; }, "Combine", { target: "target", op: "cut" });
    assert.equal(ids.length, 1); assert.equal(h.results()[0].solidCount, 1); assert.deepEqual(volumes(h.results()), [720000]);
  } finally { h.off(); }
});
test("real kernel: Ungroup after a film was dropped works, and editing the cutter so the film is gone still builds", async () => {
  const mk = async () => { const tool = cutter(22, 1e-6); tool.hole = true; return setup([body("target", box()), tool], "beginner"); };
  const h = await mk();
  try {
    await h.commitCombine(h.app, doc => h.groupBodiesInDoc(doc, doc.bodies.map(b => b.id)), "Group");
    const mod = h.store.doc.bodies[0].node.mods[0];
    assert.equal(mod.t, "keeppiece"); assert.equal(mod.sole, true);
    // the cutter now sits on the floor: no film, one solid; the sole selector passes it through
    h.store.update(doc => { doc.bodies[0].node.children.find(c => c.hole).m[14] = 0; }, "Move cutter");
    assert.deepEqual(volumes(h.results()), [7200]);
    const ids = h.ungroupBody(h.store.doc.bodies[0].id);
    assert.equal(ids.length, 2); assert.equal(h.store.doc.bodies.length, 2);
    assert.deepEqual(h.store.doc.bodies.map(b => b.node.mods || []), [[], []]);
  } finally { h.off(); }
});
test("an unmeasurable piece (NaN volume or area) is kept, not dropped as near-empty", () => {
  assert.equal(isNearEmpty(NaN, 10), false); assert.equal(isNearEmpty(5, NaN), false);
  assert.equal(isNearEmpty(4e-4, 400), true); assert.equal(isNearEmpty(20, 800), false); assert.equal(isNearEmpty(1e-7, 0), true);
});
