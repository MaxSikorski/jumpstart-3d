import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { KernelClient } from "../src/kernelClient.js";

// Resolve the same vendored font library as the app; exercise the real store and coordinator.
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: { contents: 'export { commitCombine, shouldSplitCombine, hasLaterKeepPiece } from "./src/combinesplit.js"; export { store, newDoc, bodyKey, resolveNode } from "./src/store.js";', resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "node",
  alias: { "opentype.js": root + "third_party/opentype.js/dist/opentype.module.js" },
});
const { commitCombine, shouldSplitCombine, hasLaterKeepPiece, store, newDoc, bodyKey, resolveNode } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=combinesplit-test-bundle.mjs").toString("base64"));

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

import "./combinesplit-geometry.mjs";
