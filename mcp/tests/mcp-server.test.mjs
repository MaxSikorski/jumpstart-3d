import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

for (const entry of ["mcp/server/server.mjs", "scripts/jumpstart-mcp-server.mjs"]) test(`stdio MCP discovery and localhost registration work through ${entry}`, async () => {
  const child = spawn(process.execPath, [entry], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_PORT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const output = [];
  const waiting = [];
  lines.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(JSON.parse(line));
    else output.push(line);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const readMessage = () => output.length ? Promise.resolve(JSON.parse(output.shift())) : new Promise((resolve) => waiting.push(resolve));
  const send = async (message) => {
    const response = readMessage();
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  };

  try {
    const discover = await send({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} });
    assert.ok(discover.result.supportedVersions.includes("2026-07-28"));
    assert.deepEqual(discover.result.capabilities, { tools: {} });

    const listing = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = listing.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "jumpstart_list_editors",
      "jumpstart_get_document",
      "jumpstart_preview_model",
      "jumpstart_preview_resize_body",
      "jumpstart_apply_model",
      "jumpstart_undo",
      "jumpstart_export_model",
      "jumpstart_preview_new_document",
      "jumpstart_get_capabilities",
      "jumpstart_preview_parameters",
      "jumpstart_inspect_geometry",
      "jumpstart_select_geometry",
      "jumpstart_save_document",
      "jumpstart_reopen_document",
    ]);
    assert.equal(listing.result.tools.find((tool) => tool.name === "jumpstart_preview_model").inputSchema.properties.plan.type, "object");
    assert.equal(listing.result.tools.find((tool) => tool.name === "jumpstart_preview_model").inputSchema.properties.plan.properties.primitives.items.properties.kind.enum.includes("tube"), true);
    assert.equal(listing.result.tools.find((tool) => tool.name === "jumpstart_preview_model").inputSchema.properties.plan.properties.operations.items.oneOf.length, 5);
    assert.equal(listing.result.tools.find((tool) => tool.name === "jumpstart_preview_resize_body").inputSchema.properties.size.additionalProperties, false);
    const invalid = await send({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "jumpstart_preview_parameters", arguments: { modelId: "x", values: { diameter: -1 }, arbitraryCode: "bad" } } });
    assert.equal(invalid.result.isError, true);
    const capabilities = await send({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "jumpstart_get_capabilities", arguments: {} } });
    assert.equal(JSON.parse(capabilities.result.content[0].text).schemaVersion, 1);

    const portReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not report its port: ${stderr}`)), 5_000);
      const check = () => {
        const match = /JumpStart MCP app: http:\/\/localhost:(\d+)\//.exec(stderr);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      };
      child.stderr.on("data", check);
      check();
    });
    const port = await portReady;
    const httpInvalid = await fetch(`http://127.0.0.1:${port}/__mcp/rpc`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "jumpstart_get_document", arguments: { unexpected: true } } }),
    });
    const rejectedHttp = await httpInvalid.json();
    assert.equal(rejectedHttp.result.isError, true);
    assert.match(JSON.parse(rejectedHttp.result.content[0].text).error, /unknown property/);
    const heartbeat = await fetch(`http://127.0.0.1:${port}/__mcp/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorId: "test-editor", documentId: "doc-1", documentName: "Test", focused: true }),
    });
    assert.equal(heartbeat.status, 200);
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/__mcp/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://outside.example" },
      body: JSON.stringify({ editorId: "forged", documentId: "doc-2", documentName: "forged" }),
    });
    assert.equal(crossOrigin.status, 403);
    const staticPage = await fetch(`http://127.0.0.1:${port}/?mcp=1`, {
      headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
    });
    assert.equal(staticPage.status, 200);
    const editors = await send({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "jumpstart_list_editors", arguments: {} },
    });
    const result = JSON.parse(editors.result.content[0].text);
    assert.equal(result.editors[0].editorId, "test-editor");
  } finally {
    child.stdin.end();
    let timer;
    await Promise.race([once(child, "exit"), new Promise((resolve) => { timer = setTimeout(resolve, 3_000); })]);
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});
