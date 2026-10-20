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
  for (const n of ["status", "wait_ready", "list_kinds", "list_bodies", "get_body", "add_shape", "remove_bodies", "duplicate_bodies", "move_bodies", "move_to", "rotate_bodies", "resize_shape",
    "scale_bodies", "set_hole", "set_color", "rename_body", "set_hidden", "group_bodies", "ungroup_body", "list_params", "set_param", "remove_param", "bind_size", "undo", "redo",
    "select_bodies", "fit_view", "set_mode", "screenshot", "export_file", "save_project", "load_project", "new_design", "run_script"]) assert.ok(names.includes(n), "missing tool " + n);
  assert.ok(tools.every((t) => t.description && t.description.length > 10), "every tool is described");
});

test("no tool's input schema has a $ref or a tuple (items array): Gemini-family clients and small local servers reject them", async () => {
  const { tools } = await s.client.listTools();
  assert.ok(tools.length >= 34);
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
  assert.deepEqual([st.page, st.designMode, st.bodies, st.js3d], ["headless", "beginner", 1, "1.1"]);
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
