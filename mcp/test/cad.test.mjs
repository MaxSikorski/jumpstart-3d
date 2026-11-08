// The Advanced CAD tools end to end: a 60 x 40 x 25 enclosure with 2 mm walls, a filleted rim and four M3 holes, built only through tools.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, call, data } from "./helpers.mjs";

let s;
before(async () => { s = await startServer({ JS3D_MODE: "headless" }); });
after(async () => { await s.close(); });

test("sketch, extrude, shell, fillet and holes make the enclosure; faces and edges can be listed", async () => {
  await call(s.client, "new_design", { mode: "advanced" });
  const sketch = data(await call(s.client, "add_sketch", { shapes: [{ type: "rect", center: [0, 0], size: [60, 40] }], name: "Base" }));
  assert.equal(sketch.dof, 0);
  assert.deepEqual(sketch.dims.map((d) => d.value), [60, 40]);
  const { body } = data(await call(s.client, "extrude", { sketch: sketch.sketch, dist: 25, name: "Enclosure" }));
  assert.equal(data(await call(s.client, "shell_body", { id: body, th: 2, open: "top" })).open, 1);
  const fillet = data(await call(s.client, "fillet_edges", { id: body, edges: "edges of top and (>x or <x or >y or <y)", r: 1 }));
  assert.equal(fillet.edges, 4);
  const holes = data(await call(s.client, "add_holes", { id: body, face: "bottom", points: [[-22, -12, 0], [22, -12, 0], [-22, 12, 0], [22, 12, 0]], size: "M3" }));
  assert.equal(holes.holes, 4);
  await call(s.client, "wait_ready");
  const [entry] = data(await call(s.client, "list_bodies"));
  assert.equal(entry.error, null);
  assert.ok(Math.abs(entry.volume - 13516.83) < 0.5, "volume " + entry.volume);
  assert.deepEqual(entry.bbox, { min: [-30, -20, 0], max: [30, 20, 25] });
  assert.equal(data(await call(s.client, "list_edges", { id: body, select: "circle" })).length, 8);
  const [top] = data(await call(s.client, "list_faces", { id: body, select: "top" }));
  assert.equal(top.type, "plane");
  assert.deepEqual(top.normal, [0, 0, 1]);
});

test("a bad selector or an off-face hole is a tool error with the message, and nothing is added", async () => {
  await call(s.client, "new_design", { mode: "advanced" });
  const sketch = data(await call(s.client, "add_sketch", { shapes: [{ type: "rect", size: [20, 20] }] }));
  const { body } = data(await call(s.client, "extrude", { sketch: sketch.sketch, dist: 10 }));
  const bad = await call(s.client, "fillet_edges", { id: body, edges: "roof", r: 1 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /^unknown word "roof"/);
  const off = await call(s.client, "add_holes", { id: body, face: "top", points: [[50, 0, 10]], size: "M3" });
  assert.equal(off.isError, true);
  assert.match(off.content[0].text, /not on the face/);
  assert.deepEqual(data(await call(s.client, "get_body", { id: body })).node.mods, []);
});
