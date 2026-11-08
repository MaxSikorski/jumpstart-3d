// An agent builds, checks and exports an enclosure using only MCP tools.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, call, data } from "./helpers.mjs";

let s;
before(async () => { s = await startServer({ JS3D_MODE: "headless" }); });
after(async () => { await s.close(); });

test("agent builds, inspects and exports an enclosure", async () => {
  const tool = async (name, args = {}) => data(await call(s.client, name, args));
  await tool("new_design", { mode: "advanced" });
  const id = await tool("add_shape", { kind: "box", size: [60, 40, 25], at: [0, 0, 0] });
  assert.equal((await tool("shell_body", { id, th: 2, open: "top" })).open, 1);
  assert.equal((await tool("fillet_edges", { id, edges: "edges of top and (>x or <x or >y or <y)", r: 1 })).edges, 4);
  assert.equal((await tool("add_holes", { id, face: "bottom", points: [[-22, -12, 0], [22, -12, 0], [-22, 12, 0], [22, 12, 0]], size: "M3" })).holes, 4);
  const inspection = await tool("inspect_bodies", { material: "pla" });
  assert.equal(inspection.bodies.length, 1);
  const [body] = inspection.bodies;
  assert.equal(body.error, null);
  assert.deepEqual(body.bbox, { min: [-30, -20, 0], max: [30, 20, 25] });
  assert.ok(Math.abs(body.volume - 13516.83) <= 0.5, `volume: ${body.volume}`);
  assert.ok(Math.abs(body.weight - body.volume * 1.24 / 1000) <= 0.01, `weight: ${body.weight}`);
  const print = await tool("check_print");
  assert.equal(print.ok, true, `print issues: ${JSON.stringify(print.issues)}`);
  const collisions = await tool("check_collisions");
  assert.equal(collisions.checked, 1);
  assert.deepEqual(collisions.pairs, []);
  assert.deepEqual(collisions.skipped, []);
  const section = await tool("section_view", { axis: "z", at: 10 });
  assert.equal(section.bodies.length, 1);
  assert.ok(Math.abs(section.bodies[0].area - 384) <= 0.5, `section area: ${section.bodies[0].area}`);
  const dir = await mkdtemp(join(tmpdir(), "js3d-proof-"));
  try {
    const path = join(dir, "enclosure.stl");
    await tool("export_file", { kind: "stl", path });
    const stl = await readFile(path);
    assert.ok(stl.length >= 84);
    const triangles = stl.readUInt32LE(80);
    assert.ok(triangles > 0);
    assert.equal(stl.length, 84 + 50 * triangles);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
