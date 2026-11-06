// J.Siwek 2.9.3: project files carry the built meshes of slow bodies (src/meshpack.js) and the client uses them instead of building
// (src/kernelClient.js seed). A hand-edited or foreign file must not break drawing: only a mesh of the shape the view draws is used,
// and a fine one round-trips through packMesh / unpackMesh. The browser side (the IndexedDB cache) is not covered here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelClient } from "../src/kernelClient.js";
import { packMesh, unpackMesh } from "../src/meshpack.js";

const good = () => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  triangles: new Uint32Array([0, 1, 2]), lines: new Float32Array([0, 0, 0, 1, 0, 0]), faceGroups: [[0, 3]], edgeGroups: [[0, 2]], volume: 0,
});
const client = () => { const k = new KernelClient({}); k.ready = true; k.worker = { postMessage() {} }; return k; };

test("a good built mesh from a project file is used instead of a build, and survives packing", async () => {
  const k = client(), res = [];
  k.onResults = (r) => res.push(...r);
  const mesh = await unpackMesh(await packMesh(good()));
  k.seed([{ key: "box:1.0000001", mesh, ms: 20000 }]);
  k.request([{ id: "b", key: "box:1.0000001", node: { t: "prim" } }]);
  assert.equal(res.length, 1);
  assert.equal(res[0].ok, true);
  assert.equal(res[0].fromFile, true);
  assert.equal(k.queue.size, 0);
});

test("a damaged or foreign built mesh is ignored and the body is built as usual", () => {
  const bad = [
    { ...good(), faceGroups: undefined },
    { ...good(), vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    { ...good(), triangles: new Uint32Array([0, 1, 9]) },
    { ...good(), faceGroups: [[0, 30]] },
    { ...good(), edgeGroups: [["0", 2]] },
    "not a mesh",
  ];
  for (const [i, mesh] of bad.entries()) {
    const k = client(), res = [];
    k.onResults = (r) => res.push(...r);
    k.seed([{ key: "k" + i, mesh }]);
    k.request([{ id: "b", key: "k" + i, node: { t: "prim" } }]);
    assert.equal(res.filter((r) => r.fromFile).length, 0, "case " + i);
    assert.ok(k.inflight && k.inflight.some((b) => b.key === "k" + i), "case " + i + " is built");
    clearTimeout(k.watchdog); clearTimeout(k.noteTimer);
  }
});
