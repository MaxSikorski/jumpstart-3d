// What Claude Code does with the plugin: copy the folder, run a script-free npm ci in it. Do the same in a scratch folder
// with no docs/ beside it, then start the copy's server and ask it for status.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP = fileURLToPath(new URL("..", import.meta.url));
let root, copy;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "js3d-install-"));
  copy = join(root, "plugin");
  await cp(MCP, copy, { recursive: true, filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) });
  const npm = spawnSync("npm", ["ci", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: copy, encoding: "utf8", timeout: 110_000, shell: process.platform === "win32" });
  assert.equal(npm.status, 0, npm.stderr);
}, { timeout: 120_000 });
after(async () => { await rm(root, { recursive: true, force: true }); });

test("the copy has no docs/ beside it, so headless would open the public site", async () => {
  assert.equal(existsSync(join(root, "docs")), false);
  const { Session } = await import(pathToFileURL(join(copy, "session.mjs")).href);
  assert.equal(new Session({ mode: "headless" }).defaultApp(), "https://maxsikorski.github.io/jumpstart-3d/");
});

test("server.mjs --help runs from the bare copy", () => {
  const r = spawnSync(process.execPath, [join(copy, "server.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /JS3D_MODE/);
});

test("the copy's server answers status without starting a browser", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(copy, "server.mjs")], cwd: copy, env: { ...process.env, JS3D_WS_PORT: "0" }, stderr: "pipe" });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 37);
    const r = await client.callTool({ name: "status", arguments: {} });
    assert.equal(r.isError, undefined);
    assert.equal(JSON.parse(r.content[0].text).page, "none");
  } finally { await client.close(); }
});
