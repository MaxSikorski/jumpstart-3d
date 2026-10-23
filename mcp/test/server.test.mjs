// The MCP server end to end: spawn server.mjs, talk to it with the SDK's client, headless mode on the built site (docs/).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, call, data, pngWidth, sha256, DEMO, DOCS, SERVER } from "./helpers.mjs";
import { serve } from "../serve.mjs";

let s, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "js3d-mcp-"));
  s = await startServer({ JS3D_MODE: "headless" });
});
after(async () => { await s.close(); await rm(dir, { recursive: true, force: true }); });

test("--help prints the environment variables and exits 0", () => {
  const r = spawnSync(process.execPath, [SERVER, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  for (const v of ["JS3D_MODE", "JS3D_WS_PORT", "JS3D_APP", "JS3D_VIEWPORT"]) assert.match(r.stdout, new RegExp(v));
});

test("the tools are listed, with the contract names", async () => {
  const { tools } = await s.client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["status", "wait_ready", "list_kinds", "list_bodies", "get_body", "add_shape", "add_fastener", "add_hole_pattern", "add_gear", "add_name_plate", "remove_bodies", "duplicate_bodies", "move_bodies", "move_to", "rotate_bodies", "resize_shape",
    "scale_bodies", "set_hole", "set_color", "rename_body", "set_hidden", "group_bodies", "ungroup_body", "list_params", "set_param", "remove_param", "bind_size", "undo", "redo",
    "select_bodies", "fit_view", "set_mode", "screenshot", "export_file", "save_project", "load_project", "new_design", "run_script"]) assert.ok(names.includes(n), "missing tool " + n);
  assert.ok(tools.every((t) => t.description && t.description.length > 10), "every tool is described");
});

test("no tool's input schema has a $ref or a tuple (items array): Gemini-family clients and small local servers reject them", async () => {
  const { tools } = await s.client.listTools();
  assert.ok(tools.length >= 38);
  for (const t of tools) {
    const json = JSON.stringify(t.inputSchema);
    assert.ok(!json.includes('"$ref"'), t.name + " has a $ref: " + json);
    assert.ok(!json.includes('"items":['), t.name + " has a tuple: " + json);
  }
});

test("status before any page does not start a browser", async () => {
  const st = data(await call(s.client, "status"));
  assert.equal(st.mode, "headless");
  assert.equal(st.page, "none");
  assert.match(st.hint, /headless/);
  assert.equal(s.log.join("").includes("starting a headless browser"), false);
});

test("add_shape, wait_ready and list_bodies give a block of 24000 mm3", async () => {
  const id = data(await call(s.client, "add_shape", { kind: "box", size: { w: 40, d: 30, h: 20 } }));
  assert.equal(typeof id, "string");
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const list = data(await call(s.client, "list_bodies"));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.ok(Math.abs(list[0].volume - 24000) < 0.5, "volume " + list[0].volume);
  const st = data(await call(s.client, "status"));
  assert.deepEqual([st.page, st.designMode, st.bodies, st.js3d], ["headless", "beginner", 1, "1.6"]);
  assert.match(st.app, /^\d/);
});

test("screenshot returns a PNG image block 800 pixels wide", async () => {
  const r = await call(s.client, "screenshot");
  assert.equal(r.content[0].type, "image");
  assert.equal(r.content[0].mimeType, "image/png");
  const png = Buffer.from(r.content[0].data, "base64");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(pngWidth(png), 800);
  assert.equal(pngWidth(Buffer.from((await call(s.client, "screenshot", { width: 300 })).content[0].data, "base64")), 300);
});

test("screenshot with a path writes the PNG there and answers with text, not an image", async () => {
  const file = join(dir, "view.png");
  const r = await call(s.client, "screenshot", { path: file, width: 320 });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, "text");
  const out = data(r);
  assert.equal(out.path, file);
  assert.equal(out.width, 320);
  const png = await readFile(file);
  assert.equal(out.bytes, png.length);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(pngWidth(png), 320);
});

test("export_file writes an STL to disk and says where and how big", async () => {
  const out = data(await call(s.client, "export_file", { kind: "stl", path: join(dir, "block.stl") }));
  assert.equal(out.path, join(dir, "block.stl"));
  const bytes = await readFile(out.path);
  assert.equal(out.bytes, bytes.length);
  const triangles = bytes.readUInt32LE(80);
  assert.ok(triangles > 0);
  assert.equal(bytes.length, 84 + 50 * triangles);
});

test("export_file writes a GLB: the glTF magic, version 2 and a length field equal to the file size", async () => {
  const out = data(await call(s.client, "export_file", { kind: "glb", path: join(dir, "block.glb") }));
  const bytes = await readFile(out.path);
  assert.equal(out.bytes, bytes.length);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); // "glTF"
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
});

test("set_mode switches to Architechies and back to Beginner", async () => {
  const mode = async () => data(await call(s.client, "status")).designMode;
  assert.equal(await mode(), "beginner");
  assert.equal(data(await call(s.client, "run_script", { code: "return JS3D.mode();" })), "beginner");
  await call(s.client, "set_mode", { mode: "arch" });
  assert.equal(await mode(), "arch");
  assert.equal(data(await call(s.client, "run_script", { code: "return JS3D.mode();" })), "arch");
  await call(s.client, "set_mode", { mode: "beginner" });
  assert.equal(await mode(), "beginner");
  assert.equal(data(await call(s.client, "run_script", { code: "return JS3D.mode();" })), "beginner");
});

test("save_project then load_project keeps the STL hash", async () => {
  const stl = async () => sha256(await readFile(data(await call(s.client, "export_file", { kind: "stl", path: join(dir, "x.stl") })).path));
  const before = await stl();
  const r = await call(s.client, "save_project");
  assert.equal(r.content[0].type, "text");
  assert.equal(JSON.parse(r.content[0].text).app, "jumpstart-3d");
  await call(s.client, "new_design");
  assert.equal(data(await call(s.client, "list_bodies")).length, 0);
  await call(s.client, "load_project", { json: r.content[0].text });
  assert.equal(await stl(), before);
  // the same through a file
  data(await call(s.client, "save_project", { path: join(dir, "p.json") }));
  await call(s.client, "new_design");
  data(await call(s.client, "load_project", { path: join(dir, "p.json") }));
  assert.equal(await stl(), before);
  const both = await call(s.client, "load_project", {});
  assert.equal(both.isError, true);
});

test("run_script runs the demo and returns its summary", async () => {
  const code = await readFile(DEMO, "utf8");
  const sum = data(await call(s.client, "run_script", { code }));
  assert.equal(sum.sameShape, true);
  assert.ok(Math.abs(sum.volume - (40 * 30 * 20 - Math.PI * 16 * 20)) < 0.5);
  const r = data(await call(s.client, "run_script", { code: "const n = JS3D.list().length; return n;" }));
  assert.equal(r, 1);
});

test("a bad call is a tool error with the page's message, and the server carries on", async () => {
  const r = await call(s.client, "add_shape", { kind: "teapot" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /unknown kind "teapot"; valid kinds: box/);
  const r2 = await call(s.client, "get_body", { id: "nope" });
  assert.equal(r2.isError, true);
  assert.equal(r2.content[0].text, "no body nope");
  const r3 = await call(s.client, "set_color", { ids: "x" }); // missing input: the SDK refuses it
  assert.equal(r3.isError, true);
  assert.equal(data(await call(s.client, "list_bodies")).length, 1);
});

test("add_fastener makes a threaded rod and refuses a bad size", async () => {
  await call(s.client, "new_design");
  const id = data(await call(s.client, "add_fastener", { type: "rod", size: "M8", length: 30 }));
  assert.equal(typeof id, "string");
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const [rod] = data(await call(s.client, "list_bodies"));
  assert.equal(rod.name, "M8×30 threaded rod");
  assert.equal(rod.error, null);
  assert.ok(rod.volume > 1290 && rod.volume < 1340, "volume " + rod.volume);
  const bad = await call(s.client, "add_fastener", { type: "rod", size: "M7", length: 30 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /^unknown size "M7"/);
});

test("add_hole_pattern drills a grid of six holes and refuses too many", async () => {
  await call(s.client, "new_design");
  const body = data(await call(s.client, "add_shape", { kind: "box", size: { w: 60, d: 40, h: 6 } }));
  const out = data(await call(s.client, "add_hole_pattern", { body, face: "+z", layout: "grid", cols: 3, rows: 2, pitch: 10, dia: 4 }));
  assert.equal(out.holes, 6);
  assert.equal(out.dropped, 0);
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const [plate] = data(await call(s.client, "list_bodies"));
  assert.equal(plate.error, null);
  const want = 14400 - 6 * Math.PI * 2 * 2 * 6;
  assert.ok(Math.abs(plate.volume - want) / want < 0.01, "volume " + plate.volume);
  // a big plate, so all 400 holes would fit: the limit is what refuses them
  await call(s.client, "new_design");
  const big = data(await call(s.client, "add_shape", { kind: "box", size: { w: 300, d: 300, h: 6 } }));
  const bad = await call(s.client, "add_hole_pattern", { body: big, face: "+z", layout: "grid", cols: 20, rows: 20, pitch: 10, dia: 3 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Too many holes \(400/);
  assert.deepEqual(data(await call(s.client, "get_body", { id: big })).node.mods || [], []);
});

test("add_hole_pattern with shape hex cuts six hexagons as a sketch and one Extrude cut; a slot needs a length", async () => {
  await call(s.client, "new_design");
  const body = data(await call(s.client, "add_shape", { kind: "box", size: { w: 60, d: 40, h: 6 } }));
  const out = data(await call(s.client, "add_hole_pattern", { body, face: "+z", layout: "grid", cols: 3, rows: 2, pitch: 12, shape: "hex", width: 6 }));
  assert.equal(out.holes, 6);
  assert.equal(typeof out.sketch, "string");
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const [plate] = data(await call(s.client, "list_bodies"));
  assert.equal(plate.error, null);
  const want = 14400 - 6 * 31.177 * 6;
  assert.ok(Math.abs(plate.volume - want) / want < 0.01, "volume " + plate.volume);
  const bad = await call(s.client, "add_hole_pattern", { body, face: "+z", layout: "grid", cols: 2, rows: 1, pitch: 20, shape: "slot", width: 4 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /hole\.length must be/);
});

test("add_gear makes a 20-tooth spur gear, refuses a kind the schema does not list and a module the bridge refuses", async () => {
  await call(s.client, "new_design");
  const id = data(await call(s.client, "add_gear", { module: 2, teeth: 20, width: 6 }));
  assert.equal(typeof id, "string");
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const [gear] = data(await call(s.client, "list_bodies"));
  assert.equal(gear.name, "Spur gear 20 teeth m2");
  assert.equal(gear.error, null);
  assert.ok(gear.volume > Math.PI * 17.5 ** 2 * 6 && gear.volume < Math.PI * 22 ** 2 * 6, "volume " + gear.volume);
  // the tool's schema lists the three kinds, so the server's own validation answers before the page does (its wording is the SDK's, so only the value is checked)
  const bad = await call(s.client, "add_gear", { kind: "helical", module: 2, teeth: 20 });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /helical/);
  const bad2 = await call(s.client, "add_gear", { module: 11, teeth: 20 });
  assert.equal(bad2.isError, true);
  assert.match(bad2.content[0].text, /^module must be a number from 0\.3 to 10 \(mm\)/);
});

test("add_name_plate makes a plate and its raised letters, refuses a style the schema does not list and text on two lines", async () => {
  await call(s.client, "new_design");
  const made = data(await call(s.client, "add_name_plate", { text: "Max" }));
  assert.equal(typeof made.plate, "string");
  assert.equal(typeof made.textBody, "string");
  assert.deepEqual(made.size, [44.057, 16.071, 4]);
  assert.deepEqual(data(await call(s.client, "wait_ready")), { ready: true });
  const bodies = data(await call(s.client, "list_bodies"));
  assert.deepEqual(bodies.map((b) => b.name), ["Name plate Max", "Name plate Max text"]);
  assert.deepEqual(bodies.map((b) => b.error), [null, null]);
  assert.ok(Math.abs(bodies[0].volume / 2042.0 - 1) < 0.01, "plate volume " + bodies[0].volume);
  assert.ok(Math.abs(bodies[1].volume / 166.2 - 1) < 0.01, "text volume " + bodies[1].volume);
  const bad = await call(s.client, "add_name_plate", { text: "Max", style: "inlay" });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /inlay/);
  const bad2 = await call(s.client, "add_name_plate", { text: "A\nB" });
  assert.equal(bad2.isError, true);
  assert.match(bad2.content[0].text, /^text must be one line/);
});

test("a bad JS3D_WS_PORT or JS3D_MODE exits with code 2 and a plain message", () => {
  for (const [name, value] of [["JS3D_WS_PORT", "abc"], ["JS3D_WS_PORT", "70000"], ["JS3D_WS_PORT", "-1"], ["JS3D_MODE", "sideways"]]) {
    const r = spawnSync(process.execPath, [SERVER], { encoding: "utf8", env: { ...process.env, [name]: value }, input: "" });
    assert.equal(r.status, 2, name + "=" + value);
    assert.match(r.stderr, new RegExp(name + " must"));
  }
});

test("the static server answers a broken web address with 400 and keeps serving", async () => {
  const site = await serve(DOCS);
  try {
    assert.equal((await fetch(site.url + "%E0%A4%A")).status, 400);
    assert.equal((await fetch(site.url + "nope.html")).status, 404);
    assert.equal((await fetch(site.url)).status, 200);
  } finally { await site.close(); }
});
