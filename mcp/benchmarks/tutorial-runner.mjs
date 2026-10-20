#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TUTORIAL_CASES, validateTutorialCase } from "./tutorial-cases.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXPORTS = join(ROOT, "exports");
const ENDPOINT = process.env.JUMPSTART_MCP_HTTP_URL || "http://127.0.0.1:3210/__mcp/rpc";
let requestId = 0;

async function rpc(method, params = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`MCP endpoint returned HTTP ${response.status}`);
  if (payload.error) throw new Error(payload.error.message || "MCP request failed");
  return payload.result;
}

async function tool(name, args, editorId) {
  const result = await rpc("tools/call", { name, arguments: { ...args, editorId } });
  const textBlock = result?.content?.find((item) => item.type === "text");
  let value;
  try { value = textBlock ? JSON.parse(textBlock.text) : result; }
  catch { throw new Error(`MCP tool ${name} returned invalid JSON text`); }
  if (result?.isError) throw new Error(value?.error || `MCP tool ${name} failed`);
  return value;
}

async function preview(plan, editorId) {
  const result = await tool("jumpstart_preview_model", { plan, includeImage: false }, editorId);
  if (!result.valid) throw new Error(`Preview failed: ${JSON.stringify(result.errors || [])}`);
  return result;
}

async function verifyStl(exported) {
  if (exported.format !== "stl" || !Number.isInteger(exported.byteLength) || exported.byteLength < 134) {
    throw new Error("STL export returned invalid metadata");
  }
  const localPath = join(EXPORTS, basename(exported.path));
  const bytes = await readFile(localPath);
  if (bytes.byteLength !== exported.byteLength || bytes.byteLength !== 84 + bytes.readUInt32LE(80) * 50) {
    throw new Error("STL file size does not match its binary triangle count");
  }
  const triangles = bytes.readUInt32LE(80);
  if (!triangles) throw new Error("STL has no triangles");
  for (let offset = 84; offset < bytes.byteLength; offset += 50) {
    const coordinates = [];
    for (let vertex = 0; vertex < 9; vertex++) {
      const value = bytes.readFloatLE(offset + 12 + vertex * 4);
      if (!Number.isFinite(value)) throw new Error("STL contains a non-finite vertex coordinate");
      coordinates.push(value);
    }
    const u = [0, 1, 2].map((axis) => coordinates[3 + axis] - coordinates[axis]);
    const v = [0, 1, 2].map((axis) => coordinates[6 + axis] - coordinates[axis]);
    if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) <= 1e-12) {
      throw new Error("STL contains a zero-area triangle");
    }
  }
  return { byteLength: bytes.byteLength, triangleCount: triangles };
}

async function assertBlank(editorId) {
  const document = await tool("jumpstart_get_document", { includeGeometry: false }, editorId);
  if (document.bodies.length || document.sketches.length) throw new Error("MCP guard check did not restore the blank document");
  return document;
}

async function verifyMcpGuards(editorId) {
  const blank = await assertBlank(editorId);
  const invalid = await tool("jumpstart_preview_model", {
    includeImage: false,
    plan: {
      name: "Rejected fillet preview",
      primitives: [{ id: "box", kind: "box", parameters: { w: 10, d: 10, h: 10 } }],
      operations: [{ id: "bad-edge", type: "modifier", target: "box", modifier: { type: "fillet", radius: 1, edges: [{ m: [9999, 9999, 9999], n: [1, 1, 1], t: "NO_SUCH_EDGE" }] } }],
    },
  }, editorId);
  if (invalid.valid) throw new Error("An invalid edge selector unexpectedly produced a valid preview");
  const afterFailedPreview = await assertBlank(editorId);
  if (afterFailedPreview.revision !== blank.revision) throw new Error("A failed preview changed the saved document");

  const stale = await preview({ name: "Stale preview", primitives: [{ id: "stale-box", kind: "box", parameters: { w: 10, d: 10, h: 10 } }] }, editorId);
  const winner = await preview({ name: "Winning preview", primitives: [{ id: "winner-cylinder", kind: "cylinder", parameters: { w: 12, d: 12, h: 8 } }] }, editorId);
  await tool("jumpstart_apply_model", { previewId: winner.previewId }, editorId);
  const committed = await tool("jumpstart_get_document", { includeGeometry: false }, editorId);
  let staleRejected = false;
  try { await tool("jumpstart_apply_model", { previewId: stale.previewId }, editorId); }
  catch (error) { staleRejected = /changed after preview|document changed/i.test(error.message); }
  if (!staleRejected) throw new Error("An out-of-date preview was not rejected");
  const repeated = await tool("jumpstart_apply_model", { previewId: winner.previewId }, editorId);
  const afterRetry = await tool("jumpstart_get_document", { includeGeometry: false }, editorId);
  if (!repeated.applied || afterRetry.revision !== committed.revision || afterRetry.bodies.length !== 1) throw new Error("Retrying apply duplicated or changed the committed edit");
  await tool("jumpstart_undo", { expectedRevision: afterRetry.revision }, editorId);
  await assertBlank(editorId);
}

async function main() {
  const listed = await rpc("tools/call", { name: "jumpstart_list_editors", arguments: {} });
  const editors = JSON.parse(listed.content.find((item) => item.type === "text").text).editors;
  const requestedEditorId = process.env.JUMPSTART_MCP_EDITOR_ID;
  const editor = requestedEditorId ? editors.find((entry) => entry.editorId === requestedEditorId) : editors.find((entry) => entry.focused);
  if (!editor) throw new Error("No matching JumpStart editor is connected. Open the clean benchmark tab and set JUMPSTART_MCP_EDITOR_ID if multiple tabs are open.");
  const initial = await tool("jumpstart_get_document", { includeGeometry: true }, editor.editorId);
  if (initial.bodies.length || initial.sketches.length) throw new Error("Tutorial benchmark requires a blank document; it will not overwrite an existing design.");
  await verifyMcpGuards(editor.editorId);

  const results = [];
  for (const scenario of TUTORIAL_CASES) {
    let applied = false;
    try {
      const plan = scenario.buildPlan ? await scenario.buildPlan((candidate) => preview(candidate, editor.editorId)) : scenario.plan;
      const proposed = await preview(plan, editor.editorId);
      const commit = await tool("jumpstart_apply_model", { previewId: proposed.previewId }, editor.editorId);
      if (!commit.applied) throw new Error("MCP did not commit the successful preview");
      applied = true;

      const document = await tool("jumpstart_get_document", { includeGeometry: true }, editor.editorId);
      validateTutorialCase(document, scenario);
      const exported = await tool("jumpstart_export_model", { format: "stl", name: `tutorial-${scenario.id}` }, editor.editorId);
      const stl = await verifyStl(exported);
      results.push({ id: scenario.id, pass: true, bodyCount: document.bodies.length, stlBytes: stl.byteLength, triangles: stl.triangleCount });
      process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
      const undone = await tool("jumpstart_undo", { expectedRevision: document.revision }, editor.editorId);
      if (!undone.undone || undone.document.bodies.length || undone.document.sketches.length) throw new Error("Undo did not restore the blank benchmark document");
      applied = false;
    } catch (error) {
      results.push({ id: scenario.id, pass: false, error: error instanceof Error ? error.message : String(error) });
      process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
      if (applied) {
        try {
          const current = await tool("jumpstart_get_document", { includeGeometry: false }, editor.editorId);
          await tool("jumpstart_undo", { expectedRevision: current.revision }, editor.editorId);
        } catch (undoError) {
          process.stderr.write(`Could not restore blank document after ${scenario.id}: ${undoError instanceof Error ? undoError.message : String(undoError)}\n`);
          process.exitCode = 2;
          break;
        }
      }
    }
  }
  const passed = results.filter((result) => result.pass).length;
  process.stdout.write(`Tutorial MCP benchmark: ${passed}/${TUTORIAL_CASES.length} passed\n`);
  if (passed !== TUTORIAL_CASES.length) process.exitCode = process.exitCode || 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
