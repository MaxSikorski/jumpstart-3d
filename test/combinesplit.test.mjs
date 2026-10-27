import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { KernelClient } from "../src/kernelClient.js";

// Resolve the same vendored font library as the app; exercise the real store and coordinator.
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: { contents: 'export { commitCombine, shouldSplitCombine, hasLaterKeepPiece, cutRemovedNothing, GROUP_CUT_NOTHING } from "./src/combinesplit.js"; export { store, newDoc, bodyKey, resolveNode } from "./src/store.js";', resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "node",
  alias: { "opentype.js": root + "third_party/opentype.js/dist/opentype.module.js" },
});
const { commitCombine, shouldSplitCombine, hasLaterKeepPiece, cutRemovedNothing, GROUP_CUT_NOTHING, store, newDoc, bodyKey, resolveNode } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=combinesplit-test-bundle.mjs").toString("base64"));

test("Group commits 161 disconnected pieces even though the mesh cache holds only 160", async t => {
  const count = 161, kernel = new KernelClient({});
  const doc = newDoc("Many pieces", "beginner");
  doc.bodies = [{ id: "target", name: "Many pieces", color: "#3b82c4", m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "group", children: [{node:{t:"prim",kind:"box",p:{w:20,d:20,h:20}},hole:false},{node:{t:"prim",kind:"box",p:{w:22,d:22,h:2}},hole:true}], mods: [] } }];
  store.load(doc);
  // Simulate completed worker builds, retaining the real client's eviction policy.
  const off = store.on(() => {
    const results = store.view.bodies.map(b => {
      b._key = bodyKey(resolveNode(b.node, store.view));
      return { id: b.id, rev: b._key, ok: true, mesh: { solidCount: b.node.mods.length || !b.node.children.some(c => c.hole) ? 1 : count } };
    });
    kernel.handle({ type: "built", results });
  });
  // A reintroduced cache barrier fails promptly instead of waiting its 130-second deadline.
  let now = 0;
  t.mock.method(Date, "now", () => now += 150000);
  try {
    const ids = await commitCombine({ kernel, mode: "beginner", command: null, scene: { errors: new Map() } }, () => "target", "Group");
    assert.equal(ids.length, count);
    assert.equal(store.doc.bodies.length, count);
    assert.equal(store.undoStack.length, 1);
    assert.equal(kernel.meshes.size, 160);
    assert.equal(store.preview, null);
    assert.deepEqual(store.doc.bodies.map(b => b.node.mods.at(-1).piece), Array.from({ length: count }, (_, i) => i));
    store.undo();
    assert.equal(store.doc.bodies.length, 1);
    assert.deepEqual(store.doc.bodies[0].node.mods, []);
  } finally { off(); }
});

for (const op of ['cut', 'intersect']) test(op + ' splits only new solids of a single-solid target', () => {
  assert.equal(shouldSplitCombine({op, beforeCount:1, afterCount:2}), true);
  assert.equal(shouldSplitCombine({op, beforeCount:2, afterCount:3}), false);
  assert.equal(shouldSplitCombine({op, beforeCount:2, afterCount:2}), false);
});
test('Join never auto-splits', () => {
  assert.equal(shouldSplitCombine({op:'join', beforeCount:1, afterCount:2}), false);
});
test('Group requires holes and growth over its hole-free baseline', () => {
  assert.equal(shouldSplitCombine({isGroup:true, hasHoles:false, beforeCount:1, afterCount:2}), false);
  assert.equal(shouldSplitCombine({isGroup:true, hasHoles:true, beforeCount:2, afterCount:2}), false);
  assert.equal(shouldSplitCombine({isGroup:true, hasHoles:true, beforeCount:1, afterCount:2}), true);
});
test('surface-only and mixed surface results never auto-split', () => {
  assert.equal(shouldSplitCombine({op:'cut', beforeCount:1, afterCount:0}), false);
  assert.equal(shouldSplitCombine({op:'cut', beforeCount:1, afterCount:2, hasNonSolidFaces:true}), false);
});
test('refuse deleting Combine only when a keep piece follows it', () => {
  const combine = {id:'c', t:'bool', src:'combine'}, keep = {id:'k',t:'keeppiece'};
  assert.equal(hasLaterKeepPiece([combine, keep], 'c'), true);
  assert.equal(hasLaterKeepPiece([keep, combine], 'c'), false);
  assert.equal(hasLaterKeepPiece([combine], 'c'), false);
  assert.equal(hasLaterKeepPiece([combine, keep], 'k'), false);
});

test('cutRemovedNothing: equal volumes count, a real cut or a missing volume does not', () => {
  assert.equal(cutRemovedNothing(8000, 8000), true);
  assert.equal(cutRemovedNothing(8000, 8000 - 1e-9), true);      // float noise
  assert.equal(cutRemovedNothing(8000, 8000 - 0.01), false);     // 1.25e-6 of it: a real, tiny cut
  assert.equal(cutRemovedNothing(8000, 6000), false);
  assert.equal(cutRemovedNothing(0.5, 0.5 - 1e-4), true);        // tiny part: the absolute floor
  assert.equal(cutRemovedNothing(null, 8000), false);
  assert.equal(cutRemovedNothing(8000, undefined), false);
  assert.equal(cutRemovedNothing(8000, NaN), false);
  assert.equal(cutRemovedNothing(0, 0), false);
});

// Group the 20 mm box with a hole; the fake engine reports the volumes of the hole-free baseline and of the complete group.
async function groupWithHole({ hole, volumes }) {
  const kernel = new KernelClient({}), toasts = [];
  const doc = newDoc("Empty cut", "beginner");
  doc.bodies = [{ id: "target", name: "Part", color: "#3b82c4", m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "group", children: [{node:{t:"prim",kind:"box",p:{w:20,d:20,h:20}},hole:false},{node:{t:"prim",kind:"box",p:{w:5,d:5,h:5}},hole}], mods: [] } }];
  store.load(doc);
  const off = store.on(() => {
    const results = store.view.bodies.map(b => {
      b._key = bodyKey(resolveNode(b.node, store.view));
      const complete = b.node.children.some(c => c.hole);
      return { id: b.id, rev: b._key, ok: true, mesh: { solidCount: 1, volume: complete ? volumes[1] : volumes[0] } };
    });
    kernel.handle({ type: "built", results });
  });
  try {
    await commitCombine({ kernel, mode: "beginner", command: null, scene: { errors: new Map() }, toast: (m, k) => toasts.push([m, k]) }, () => "target", "Group");
  } finally { off(); }
  return toasts;
}
test('Group: a hole that removed nothing toasts once, a hole that cut or no hole does not', async () => {
  assert.deepEqual(await groupWithHole({ hole: true, volumes: [8000, 8000] }), [[GROUP_CUT_NOTHING, undefined]]);
  assert.deepEqual(await groupWithHole({ hole: true, volumes: [8000, 7875] }), []);
  assert.deepEqual(await groupWithHole({ hole: false, volumes: [8000, 8000] }), []);
});

import "./combinesplit-geometry.mjs";
