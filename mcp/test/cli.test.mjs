// The jumpstart command line, end to end: spawn cli.mjs (headless, the built site in docs/) and read what it prints.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO, DOCS, pngWidth } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const PROJECT = fileURLToPath(new URL("../../test/projects/advanced-hole.json", import.meta.url));
let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), "js3d-cli-")); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, JS3D_APP: DOCS }, timeout: 180_000 });

test("run prints the script's return value as one JSON line", () => {
  const r = cli("run", DEMO);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.equal(out.sameShape, true);
  assert.ok(Math.abs(out.volume - 22994.69) < 0.1);
});

test("run: a script that throws exits 1 with the message on stderr and nothing on stdout", async () => {
  const bad = join(dir, "bad.js");
  await writeFile(bad, 'JS3D.add("nonsense-kind")');
  const r = cli("run", bad);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /nonsense-kind/);
});

test("export writes an STL with triangles in it", async () => {
  const out = join(dir, "hole.stl");
  const r = cli("export", PROJECT, out);
  assert.equal(r.status, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  const bytes = await readFile(out);
  assert.equal(printed.path, out);
  assert.equal(printed.bytes, bytes.length);
  const triangles = bytes.readUInt32LE(80);
  assert.ok(triangles > 0);
  assert.equal(bytes.length, 84 + 50 * triangles);
});

test("shot --width 400 writes a PNG 400 pixels wide", async () => {
  const out = join(dir, "hole.png");
  const r = cli("shot", PROJECT, out, "--width", "400");
  assert.equal(r.status, 0, r.stderr);
  const png = await readFile(out);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(pngWidth(png), 400);
  assert.equal(JSON.parse(r.stdout).bytes, png.length);
});

test("status prints the app and JS3D versions as JSON", () => {
  const r = cli("status");
  assert.equal(r.status, 0, r.stderr);
  const st = JSON.parse(r.stdout);
  assert.match(st.app, /^\d/);
  assert.equal(st.js3d, "1.1");
  assert.equal(st.bodies, 0);
  assert.equal(typeof st.design, "string");
  assert.match(st.url, /^http:\/\/127\.0\.0\.1:\d+\//);
});

test("--app overrides JS3D_APP, as --app X or --app=X", () => {
  for (const args of [["--app", join(DOCS, "nowhere")], ["--app=" + join(DOCS, "nowhere")]]) {
  const r = spawnSync(process.execPath, [CLI, "status", ...args], { encoding: "utf8", env: { ...process.env, JS3D_APP: DOCS } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /JS3D_APP not found/);
  }
});

test("bad usage exits 2 or 1 with a message on stderr and nothing on stdout", () => {
  for (const [args, status, message] of [
    [["frobnicate"], 2, /unknown command/],
    [[], 2, /Usage:/],
    [["status", "extra"], 2, /takes 0 arguments/],
    [["run", DEMO, "again"], 2, /takes 1 argument/],
    [["export", PROJECT, join(dir, "x.txt")], 2, /\.stl/],
    [["shot", PROJECT, join(dir, "x.png"), "--width", "0"], 2, /--width/],
    [["run"], 2, /script file/],
    [["run", join(dir, "missing.js")], 1, /ENOENT/],
  ]) {
    const r = cli(...args);
    assert.equal(r.status, status, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.match(r.stderr, message);
  }
});

test("--help prints the usage on stdout and exits 0", () => {
  const r = cli("--help");
  assert.equal(r.status, 0);
  for (const c of ["run", "export", "shot", "status"]) assert.match(r.stdout, new RegExp("jumpstart " + c));
});

test("Ctrl-C stops quietly with exit code 130 and no browser is left", async () => {
  const slow = join(dir, "slow.js");
  await writeFile(slow, "await new Promise((r) => setTimeout(r, 120000)); return 1");
  const child = spawn(process.execPath, [CLI, "run", slow], { env: { ...process.env, JS3D_APP: DOCS } });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  for (let t0 = Date.now(); !err.includes("headless browser ready"); await new Promise((r) => setTimeout(r, 100))) assert.ok(Date.now() - t0 < 60_000, "the browser did not start: " + err);
  child.kill("SIGINT");
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 130);
  assert.equal(out, "");
  assert.ok(err.trim().split("\n").length <= 5, "stderr should be a few lines:\n" + err);
  assert.doesNotMatch(err, /has been closed/);
});
