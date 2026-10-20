import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { loadDoc, watchErrors } from "../../test/helpers.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../test/projects/parametric-plate.json", import.meta.url), "utf8"));
let broker, baseURL, requestId = 0;

test.beforeAll(async ({}, info) => {
  if (info.project.name !== "site") return;
  broker = spawn(process.execPath, ["mcp/server/server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HOST: "127.0.0.1", JUMPSTART_MCP_PORT: "0", JUMPSTART_MCP_HTTP_ONLY: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`MCP broker startup timed out: ${output}`)), 15_000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    broker.once("error", fail);
    broker.once("exit", (code) => fail(new Error(`MCP broker exited during startup (${code}): ${output}`)));
    broker.stderr.setEncoding("utf8");
    broker.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/JumpStart MCP app: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); baseURL = `http://127.0.0.1:${match[1]}/`; resolve(); }
    });
  });
});

test.afterAll(async () => {
  if (!broker || broker.exitCode !== null || broker.signalCode !== null) return;
  const exited = once(broker, "exit");
  broker.kill("SIGTERM");
  const timer = setTimeout(() => broker.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
});

async function tool(name, args = {}) {
  const response = await fetch(`${baseURL}__mcp/rpc`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok).toBe(true);
  const payload = await response.json();
  expect(payload.error).toBeUndefined();
  expect(payload.result.isError).not.toBe(true);
  return JSON.parse(payload.result.content.find((item) => item.type === "text").text);
}

test("bare broker URL activates MCP and exposes native parameter bindings without editing", async ({ page }, info) => {
  test.skip(info.project.name !== "site", "The offline single-file build intentionally has no MCP broker");
  const errors = watchErrors(page);
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__app?.kernel?.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  await loadDoc(page, fixture);
  let editorId;
  await expect.poll(async () => {
    const listed = await tool("jumpstart_list_editors");
    editorId = listed.editors?.[0]?.editorId;
    return !!editorId;
  }).toBe(true);
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc));
  const result = await tool("jumpstart_get_document", { editorId, includeGeometry: true });
  expect(result.nativeParameters).toEqual([
    { id: "q1", name: "w", expression: "40", unit: "mm", value: 40 },
    { id: "q2", name: "h", expression: "w/2", unit: "mm", value: 20 },
  ]);
  expect(result.nativeParametersTruncated).toBe(false);
  const dimensions = result.sketches.flatMap((sketch) => sketch.constraints).filter((constraint) => constraint.t === "dim");
  expect(dimensions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "d1", expr: "w", v: 40 }),
    expect.objectContaining({ id: "d2", expr: "h", v: 20 }),
  ]));
  expect(dimensions.every((dimension) => typeof dimension.name === "string")).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc))).toBe(before);
  expect(errors, "console or page errors").toEqual([]);
});
