#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateToolInput } from "../shared/schema.js";
import { extendMcpTools } from "./tool-contracts.mjs";
import { inspectTriangleMesh } from "../shared/geometry.js";
import { clientPresence } from "./presence.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DOCS = join(ROOT, "docs");
const EXPORTS = join(ROOT, "exports");
const HOST = process.env.JUMPSTART_MCP_HOST || "127.0.0.1";
const BROWSER_HOST = "localhost";
const PORT = Number(process.env.JUMPSTART_MCP_PORT || 3210);
const HTTP_ONLY = process.env.JUMPSTART_MCP_HTTP_ONLY === "1";
const MAX_HTTP_BODY = 48 * 1024 * 1024;
const MAX_QUEUED_COMMANDS = 32;
const EDITOR_STALE_MS = 15_000;
const POLL_TIMEOUT_MS = 25_000;
const PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, "2025-11-25"];

const axes = ["X", "Y", "Z"];
const commonEditor = {
  editorId: { type: "string", minLength: 1, maxLength: 120, description: "Editor id from jumpstart_list_editors. Required when more than one editor is open." },
};
const point2 = { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } };
const point3 = { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } };
const profileSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["type", "points"],
      properties: { type: { const: "polygon" }, points: { type: "array", minItems: 3, maxItems: 128, items: point2 } },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "center", "radius"],
      properties: { type: { const: "circle" }, center: point2, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 } },
    },
  ],
};
const primitiveSchema = {
  type: "object", additionalProperties: false, required: ["id", "kind"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", maxLength: 80 },
    kind: { type: "string", enum: ["box", "cylinder", "sphere", "cone", "pyramid", "wedge", "torus", "tube", "hemisphere", "prism", "text", "star", "heart", "roof", "roundroof", "paraboloid", "gem", "spring", "capsule", "arrow"] },
    parameters: { type: "object", additionalProperties: false, properties: {
      w: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, d: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, h: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      r: { type: "number", minimum: 0, maximum: 10000 }, c: { type: "number", minimum: 0, maximum: 10000 }, top: { type: "number", minimum: 0, maximum: 10000 },
      sides: { type: "integer", minimum: 3, maximum: 64 }, tube: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, wall: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      text: { type: "string", minLength: 1, maxLength: 256 }, size: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, font: { type: "string", minLength: 1, maxLength: 80 },
      points: { type: "integer", minimum: 3, maximum: 64 }, inner: { type: "number", exclusiveMinimum: 0, maximum: 1 }, turns: { type: "integer", minimum: 1, maximum: 100 }, wire: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
    } },
    position: point3, rotation: point3, hole: { type: "boolean" },
  },
};
const edgeSignatureSchema = { type: "object", additionalProperties: false, required: ["m", "n", "t"], properties: { index: { type: "integer", minimum: 0 }, a: point3, b: point3, m: point3, n: point3, t: { type: "string", maxLength: 40 } } };
const modifierSchema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["type", "radius", "edges"], properties: { type: { const: "fillet" }, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, edges: { type: "array", minItems: 1, maxItems: 512, items: edgeSignatureSchema }, chain: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["type", "thickness", "faces"], properties: { type: { const: "shell" }, thickness: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, faces: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["c"], properties: { index: { type: "integer", minimum: 0 }, c: point3, n: point3, t: { type: "string" }, r: { type: "number" }, ext: { type: "boolean" }, o: point3, d: point3, ax: point3 } } }, direction: { type: "string", enum: ["in", "out", "both"] } } },
  { type: "object", additionalProperties: false, required: ["type", "at", "diameter"], properties: { type: { const: "hole" }, at: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["p", "n"], properties: { p: point3, n: point3 } } }, diameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, kind: { type: "string", enum: ["simple", "cbore", "csink", "tapped"] }, through: { type: "boolean" }, depth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, counterboreDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, counterboreDepth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkAngle: { type: "number", minimum: 1, maximum: 179 }, tip: { type: "boolean" }, pitch: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, clearance: { type: "number", minimum: 0, maximum: 10000 } } },
  { type: "object", additionalProperties: false, required: ["type", "face", "pitch"], properties: { type: { const: "thread" }, face: { type: "object", additionalProperties: false, required: ["c", "t"], properties: { index: { type: "integer", minimum: 0 }, c: point3, t: { const: "CYLINDRE" }, n: point3, r: { type: "number" }, ext: { type: "boolean" }, o: point3, d: point3, ax: point3 } }, pitch: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, length: { type: "number", minimum: 0, maximum: 10000 }, flip: { type: "boolean" }, left: { type: "boolean" }, clearance: { type: "number", minimum: 0, maximum: 10000 } } },
  { type: "object", additionalProperties: false, required: ["type", "geo", "text", "size", "depth"], properties: { type: { const: "emboss" }, geo: { type: "object", additionalProperties: false, required: ["kind", "p", "n", "x"], properties: { kind: { const: "plane" }, p: point3, n: point3, x: point3 } }, text: { type: "string", minLength: 1, maxLength: 256 }, font: { type: "string", maxLength: 80 }, size: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, depth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, mode: { type: "string", enum: ["emboss", "deboss"] }, angle: { type: "number", minimum: -360, maximum: 360 } } },
  { type: "object", additionalProperties: false, required: ["type", "factors"], properties: { type: { const: "scale" }, factors: point3, offset: point3 } },
] };
const planOperationSchema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["id", "type", "members"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "group" }, name: { type: "string", maxLength: 80 }, members: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", maxLength: 80 }, description: "A pattern reference may expand to multiple body instances before grouping." }, operation: { type: "string", enum: ["union", "cut", "intersect"] } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "source", "mode", "axis", "count"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "pattern" }, source: { type: "string", maxLength: 80 }, mode: { type: "string", enum: ["linear", "circular"] }, axis: { type: "string", enum: axes }, count: { type: "integer", minimum: 2, maximum: 12, description: "Instances per direction for a linear pattern (count 4 with symmetric true produces 7 total); total instance count for a circular pattern, including the original." }, spacing: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, symmetric: { type: "boolean" }, angle: { type: "number", minimum: 1, maximum: 360, description: "Circular total angle. A full 360-degree pattern spaces instances around the full circle; a partial angle includes both endpoints." }, origin: point3 } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "transform" }, target: { type: "string", maxLength: 80 }, position: point3, rotation: point3, relative: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "tool", "operation"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "combine" }, target: { type: "string", maxLength: 80 }, tool: { type: "string", maxLength: 80 }, operation: { type: "string", enum: ["join", "cut", "intersect"] }, keepTool: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "modifier"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "modifier" }, target: { type: "string", maxLength: 80 }, modifier: modifierSchema } },
] };
const planSchema = {
  type: "object", additionalProperties: false, required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    mode: { type: "string", enum: ["beginner", "advanced"] },
    primitives: { type: "array", maxItems: 64, items: primitiveSchema },
    planes: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["id", "plane"], properties: { id: { type: "string", maxLength: 80 }, name: { type: "string", maxLength: 80 }, plane: { type: "string", enum: ["XY", "XZ", "YZ"] }, origin: point3 } } },
    sketches: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false, required: ["id", "plane", "origin", "profile"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          name: { type: "string", maxLength: 80 },
          plane: { type: "string", enum: ["XY", "XZ", "YZ"] },
          origin: point3,
          profile: profileSchema,
        },
      },
    },
    features: {
      type: "array", maxItems: 24,
      items: {
        type: "object", additionalProperties: false, required: ["id", "type"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          name: { type: "string", maxLength: 80 },
          type: { type: "string", enum: ["revolve", "extrude", "loft"] },
          sketch: { type: "string", minLength: 1, maxLength: 80 },
          sections: { type: "array", minItems: 2, maxItems: 12, items: { type: "string", maxLength: 80 } },
          operation: { type: "string", enum: ["new", "join", "cut"] },
          target: { type: "string", maxLength: 80 },
          axis: { type: "string", enum: axes },
          angle: { type: "number", minimum: 1, maximum: 360 },
          distance: { type: "number", exclusiveMinimum: -10000, exclusiveMaximum: 10000 },
          mode: { type: "string", enum: ["one", "sym", "two"] },
          distance2: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          ruled: { type: "boolean" }, closed: { type: "boolean" },
          pattern: {
            type: "object", additionalProperties: false, required: ["axis", "count"],
            properties: {
              axis: { type: "string", enum: axes },
              count: { type: "integer", minimum: 2, maximum: 12 },
              angle: { type: "number", minimum: 1, maximum: 360 },
              origin: point3,
            },
          },
        },
      },
    },
    operations: { type: "array", maxItems: 128, items: planOperationSchema },
  },
};

const tools = extendMcpTools([
  {
    name: "jumpstart_list_editors",
    title: "List open JumpStart editors",
    description: "List local JumpStart browser tabs connected to this MCP server. Call this first when more than one editor may be open.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "jumpstart_get_document",
    title: "Read the active CAD document",
    description: "Read document identity, revision, units, sketches, body features, world bounds, local dimensions, volume, triangle counts, and geometry errors. With includeGeometry true, also return capped edge and face selectors in body-local millimeters for fillet, shell, hole, thread, and emboss edits. The returned units field is the UI display preference.",
    inputSchema: { type: "object", additionalProperties: false, properties: { ...commonEditor, includeGeometry: { type: "boolean", description: "Include sketch coordinates and feature nodes so an agent can revise the editable CAD model. Large sketches are capped." } } },
  },
  {
    name: "jumpstart_preview_model",
    title: "Preview a parametric model plan",
    description: "Preview a typed CAD plan using JumpStart primitives, dimensioned circle/polygon sketches, extrude/revolve/loft features, body transforms, linear/circular patterns, groups, booleans, and native fillet/shell/hole/thread/emboss/scale modifiers. It can also modify existing bodies. Returns geometry errors, dimensions, volume, triangle counts, edge/face selectors, and a viewport image. The preview does not modify the saved document. Coordinates and dimensions use millimeters.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["plan"],
      properties: {
        ...commonEditor,
        plan: planSchema,
        includeImage: { type: "boolean", description: "Default true. Set false to omit the viewport image when only geometry status is needed." },
        replaceBodyIds: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 120 }, description: "Optional body ids from an earlier model that this plan replaces. Preview and apply remain one undoable edit." },
      },
    },
  },
  {
    name: "jumpstart_preview_resize_body",
    title: "Preview a body resize",
    description: "Preview exact local X, Y, or Z dimensions in millimeters for an existing body, including imported STL or 3MF meshes. Unspecified axes keep their current size. The default base anchor preserves the local bottom and center. Preview does not modify the saved document.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["bodyId", "size"],
      properties: {
        ...commonEditor,
        bodyId: { type: "string", minLength: 1, maxLength: 120, description: "Body id returned by jumpstart_get_document." },
        size: {
          type: "object", additionalProperties: false, minProperties: 1,
          properties: {
            x: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
            y: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
            z: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          },
          description: "Target dimensions in millimeters in the body's local coordinate axes. Include only the axes to change.",
        },
        anchor: { type: "string", enum: ["base", "center", "corner"], description: "Which point stays fixed; defaults to the base center." },
        includeImage: { type: "boolean", description: "Default true. Set false to omit the viewport image." },
      },
    },
  },
  {
    name: "jumpstart_apply_model",
    title: "Apply a successful preview",
    description: "Commit a model or body edit preview as one undoable document edit. The document must not have changed since preview. Repeating the same previewId will not duplicate the edit.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["previewId"],
      properties: { ...commonEditor, previewId: { type: "string", minLength: 1, maxLength: 100 } },
    },
  },
  {
    name: "jumpstart_undo",
    title: "Undo one document edit",
    description: "Undo exactly one edit only if expectedRevision still matches the current document revision. Read the document again after an error.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { ...commonEditor, expectedRevision: { type: "string", minLength: 1, maxLength: 100 } },
    },
  },
  {
    name: "jumpstart_export_model",
    title: "Export an editable or printable model",
    description: "Export all visible solid bodies to STL or STEP. The server writes the file under the repository's exports/ folder and returns its local path. STL is for mesh printing; STEP preserves CAD solids when the kernel supports the model.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["format"],
      properties: { ...commonEditor, format: { type: "string", enum: ["stl", "step"] }, name: { type: "string", maxLength: 80 } },
    },
  },
], planSchema);

const editors = new Map();
const queues = new Map();
const waiters = new Map();
const pending = new Map();
const presence = clientPresence();
let shuttingDown = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function response(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function settleWaiter(editorId, command) {
  const waiter = waiters.get(editorId);
  if (!waiter) return false;
  waiters.delete(editorId);
  clearTimeout(waiter.timer);
  waiter.resolve(command);
  return true;
}

function settlePending(commandId, result) {
  const entry = pending.get(commandId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(commandId);
  entry.resolve(result);
  return true;
}

function pruneEditors() {
  const now = Date.now();
  for (const [editorId, editor] of editors) {
    if (now - editor.lastSeen <= EDITOR_STALE_MS || waiters.has(editorId)) continue;
    editors.delete(editorId);
    queues.delete(editorId);
    for (const [commandId, entry] of pending) {
      if (entry.editorId === editorId) settlePending(commandId, { ok: false, error: "JumpStart editor is no longer connected" });
    }
  }
}

function listEditors() {
  pruneEditors();
  return [...editors.values()].sort((a, b) => Number(b.focused) - Number(a.focused)).map(({ lastSeen, ...editor }) => editor);
}

function selectEditor(editorId) {
  pruneEditors();
  if (editorId) {
    const exact = editors.get(editorId);
    if (!exact) throw new Error(`JumpStart editor ${editorId} is not connected`);
    return exact;
  }
  const all = [...editors.values()];
  if (all.length === 1) return all[0];
  const focused = all.filter((editor) => editor.focused);
  if (focused.length === 1) return focused[0];
  if (!all.length) throw new Error("No JumpStart editor is connected. Open the local app URL shown by the MCP server.");
  throw new Error("Multiple JumpStart editors are open; pass editorId from jumpstart_list_editors");
}

function removeQueued(editorId, commandId) {
  const queue = queues.get(editorId) || [];
  queues.set(editorId, queue.filter((command) => command.id !== commandId));
}

async function dispatch(action, params) {
  const editor = selectEditor(params.editorId);
  const queue = queues.get(editor.editorId) || [];
  if (queue.length >= MAX_QUEUED_COMMANDS) throw new Error("JumpStart editor command queue is full; wait for current work to finish");
  const command = { id: randomUUID(), action, params: { ...params } };
  delete command.params.editorId;

  const timeoutMs = action === "export_model" ? 60_000 : action === "preview_model" ? 60_000 : 30_000;
  const resultPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      removeQueued(editor.editorId, command.id);
      resolve({ ok: false, error: `JumpStart editor timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    pending.set(command.id, { editorId: editor.editorId, resolve, timer, delivered: false });
  });

  const waiter = waiters.get(editor.editorId);
  if (waiter && settleWaiter(editor.editorId, command)) pending.get(command.id).delivered = true;
  else {
    queue.push(command);
    queues.set(editor.editorId, queue);
  }
  return resultPromise;
}

async function readBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_HTTP_BODY) throw new Error("Request exceeds local MCP bridge body limit");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_HTTP_BODY) throw new Error("Request exceeds local MCP bridge body limit");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON"); }
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

function allowedLocalRequest(req, allowNavigation = false) {
  const host = req.headers.host || "";
  let url;
  try { url = new URL(`http://${host}`); } catch { return false; }
  if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === String(server.address()?.port))) return false;
  if (allowNavigation && (req.method === "GET" || req.method === "HEAD")) return true;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const fetchSite = req.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function handleBridge(req, res, pathname) {
  if (!allowedLocalRequest(req)) return json(res, 403, { error: "Only same-origin localhost requests are accepted" });
  if (req.method !== "POST") return json(res, 405, { error: "Use POST for the local bridge" });
  let body;
  try { body = await readBody(req); }
  catch (error) { return json(res, 400, { error: error.message }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Expected a JSON object" });

  if (pathname === "/__mcp/client") {
    try {
      validateToolInput(body, { type: "object", additionalProperties: false, required: ["clientId", "state"], properties: { clientId: { type: "string", pattern: "^[a-zA-Z0-9-]{16,80}$", minLength: 16, maxLength: 80 }, state: { type: "string", enum: ["connect", "heartbeat", "disconnect"] } } });
      presence.lease(body.clientId, body.state);
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (pathname === "/__mcp/heartbeat") {
    if (typeof body.editorId !== "string" || body.editorId.length > 120 || typeof body.documentId !== "string" || typeof body.documentName !== "string") {
      return json(res, 400, { error: "Invalid editor heartbeat" });
    }
    const editor = { editorId: body.editorId, documentId: body.documentId, documentName: body.documentName.slice(0, 120), mode: String(body.mode || "").slice(0, 30), bodyCount: Number.isFinite(body.bodyCount) ? body.bodyCount : 0, revision: String(body.revision || ""), focused: body.focused === true, lastSeen: Date.now() };
    editors.set(editor.editorId, editor);
    queues.set(editor.editorId, queues.get(editor.editorId) || []);
    return json(res, 200, { ok: true, agent: presence.status() });
  }

  if (pathname === "/__mcp/poll") {
    if (typeof body.editorId !== "string") return json(res, 400, { error: "Invalid editor id" });
    pruneEditors();
    const editor = editors.get(body.editorId);
    if (!editor) return json(res, 410, { error: "Editor heartbeat expired" });
    editor.lastSeen = Date.now();
    const queue = queues.get(body.editorId) || [];
    const command = queue.shift();
    if (command) {
      const entry = pending.get(command.id);
      if (entry) entry.delivered = true;
      return json(res, 200, { command });
    }
    if (waiters.has(body.editorId)) settleWaiter(body.editorId, null);
    let done = false;
    let timer;
    const promise = new Promise((resolve) => {
      timer = setTimeout(() => {
        done = true;
        if (waiters.get(body.editorId)?.resolve === resolve) waiters.delete(body.editorId);
        resolve(null);
      }, POLL_TIMEOUT_MS);
      waiters.set(body.editorId, { resolve, timer });
    });
    const onClose = () => {
      if (!done) settleWaiter(body.editorId, null);
    };
    res.once("close", onClose);
    const result = await promise;
    done = true;
    res.removeListener("close", onClose);
    if (!res.writableEnded) json(res, 200, { command: result });
    return;
  }

  if (pathname === "/__mcp/result") {
    if (typeof body.editorId !== "string" || typeof body.commandId !== "string" || typeof body.ok !== "boolean") return json(res, 400, { error: "Invalid command result" });
    if (pending.get(body.commandId)?.editorId !== body.editorId) return json(res, 200, { accepted: false });
    const accepted = settlePending(body.commandId, { ok: body.ok, data: body.data, error: typeof body.error === "string" ? body.error.slice(0, 4000) : undefined });
    return json(res, 200, { accepted });
  }
  return json(res, 404, { error: "Unknown local MCP bridge route" });
}

async function handleHttpRpc(req, res) {
  if (!allowedLocalRequest(req)) return json(res, 403, { error: "Only same-origin localhost requests are accepted" });
  if (req.method !== "POST") return json(res, 405, { error: "Use POST for local MCP requests" });
  let message;
  try { message = await readBody(req); }
  catch (error) { return json(res, 400, { error: error.message }); }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    return json(res, 400, { error: "Expected a JSON-RPC request" });
  }

  const { id, method, params = {} } = message;
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    res.writeHead(202, { "Cache-Control": "no-store" });
    return res.end();
  }

  let result;
  if (method === "initialize") {
    result = {
      protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "jumpstart-3d", version: "0.1.0" },
      instructions: "Use preview before apply. Model coordinates are millimeters.",
    };
  } else if (method === "ping") {
    result = {};
  } else if (method === "tools/list") {
    result = { resultType: "complete", tools, cacheScope: "public", ttlMs: 300_000 };
  } else if (method === "tools/call") {
    if (typeof params.name !== "string" || !tools.some((tool) => tool.name === params.name)) {
      result = toolError(new Error(`Unknown tool: ${params.name || ""}`));
    } else {
      try { result = toolResult(await callTool(params.name, params.arguments === undefined ? {} : params.arguments)); }
      catch (error) { result = toolError(error); }
    }
  } else {
    return json(res, 200, { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
  return json(res, 200, { jsonrpc: "2.0", id: id ?? null, result });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  if (!allowedLocalRequest(req, true)) {
    process.stderr.write(`Rejected local app request: method=${req.method} host=${req.headers.host || ""} origin=${req.headers.origin || ""} site=${req.headers["sec-fetch-site"] || ""} mode=${req.headers["sec-fetch-mode"] || ""} dest=${req.headers["sec-fetch-dest"] || ""}\n`);
    return json(res, 403, { error: "Only localhost requests are accepted" });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Static app only accepts GET and HEAD" });
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return json(res, 400, { error: "Invalid path" }); }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(DOCS, relative);
  if (file !== DOCS && !file.startsWith(DOCS + sep)) return json(res, 404, { error: "Not found" });
  try { await access(file); }
  catch {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("Build the local JumpStart app first with npm run build.\n");
  }
  const contentType = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  let shell;
  if (file === join(DOCS, "index.html") && req.method === "GET") {
    try { shell = (await readFile(file, "utf8")).replace("</head>", '<meta name="jumpstart-mcp-bridge" content="1">\n</head>'); }
    catch { return json(res, 503, { error: "The local app is rebuilding; retry after the build finishes" }); }
  }
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  if (shell !== undefined) return res.end(shell);
  createReadStream(file).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`).pathname;
  if (pathname === "/__mcp/rpc") { void handleHttpRpc(req, res); return; }
  if (pathname.startsWith("/__mcp/")) { void handleBridge(req, res, pathname); return; }
  void serveStatic(req, res, pathname);
});

const host = (args) => typeof args.editorId === "string" ? args.editorId : undefined;

async function callTool(name, args) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (Buffer.byteLength(JSON.stringify(args)) > 262144) throw new Error("Tool input exceeds 262144 byte budget");
  validateToolInput(args, tool.inputSchema);
  presence.activity();
  const run = async (action, params) => {
    const result = await dispatch(action, params);
    if (!result?.ok) throw new Error(result?.error || `JumpStart ${action} failed`);
    return result.data;
  };
  switch (name) {
    case "jumpstart_get_capabilities": return {
      schemaVersion: 1, units: "mm", toolSchemas: tools,
      limits: { toolInputBytes: 262144, trianglesInspected: 200000, estimatedTriangleVisits: 8000000, meshWeldToleranceMm: 0.0001, namedParameters: 64, parameterModels: 16, images: 4 },
      operations: ["primitives", "circle/polygon sketches", "extrude", "revolve", "loft", "linear/circular patterns", "transforms", "booleans", "fillet", "shell", "hole", "thread", "planar emboss", "scale"],
      inspection: ["top/side/isometric/section images", "tessellated plane sections", "line/solid intervals", "dimensions", "axis-aligned parallel flat-bottom channels", "mesh edge incidence", "semantic native signature queries"],
      unsupported: ["general sketch constraint solver", "arcs/splines through MCP", "dimensional algebra", "automatic stable topological naming", "mesh-to-parametric reconstruction", "arbitrary mirror planes", "self-intersection validation", "minimum wall thickness everywhere", "physical fit or printability certification"],
      parameterExample: { parameters: { diameter: { value: 100, unit: "mm", min: 10, max: 500 } }, numericReference: { $expr: "diameter / 2" }, operators: ["+", "-", "*", "/", "parentheses"], lifecycle: "preview_model -> inspect_geometry(previewId) -> apply_model -> save_document -> preview_parameters; templates survive native save/reopen" },
      validationLayers: ["schema", "CAD construction", "requested geometric measurements", "export mesh checks", "physical fit unverified"],
    };
    case "jumpstart_list_editors": return { editors: listEditors() };
    case "jumpstart_get_document": return await run("get_document", { editorId: host(args), includeGeometry: args.includeGeometry === true });
    case "jumpstart_preview_new_document": return await run("preview_new_document", { ...args, editorId: host(args) });
    case "jumpstart_preview_model": return await run("preview_model", { editorId: host(args), plan: args.plan, replaceBodyIds: args.replaceBodyIds || [], includeImage: args.includeImage !== false, section: args.section, expectedRevision: args.expectedRevision });
    case "jumpstart_preview_resize_body": return await run("preview_resize_body", { editorId: host(args), bodyId: args.bodyId, size: args.size, anchor: args.anchor, includeImage: args.includeImage !== false, section: args.section, expectedRevision: args.expectedRevision });
    case "jumpstart_preview_parameters": return await run("preview_parameters", { ...args, editorId: host(args) });
    case "jumpstart_inspect_geometry": return await run("inspect_geometry", { ...args, editorId: host(args) });
    case "jumpstart_select_geometry": return await run("select_geometry", { ...args, editorId: host(args) });
    case "jumpstart_save_document": return await run("save_document", { ...args, editorId: host(args) });
    case "jumpstart_reopen_document": return await run("reopen_document", { ...args, editorId: host(args) });
    case "jumpstart_apply_model": return await run("apply_model", { editorId: host(args), previewId: args.previewId });
    case "jumpstart_undo": return await run("undo", { editorId: host(args), expectedRevision: args.expectedRevision });
    case "jumpstart_export_model": {
      const name = sanitizeName(args.name || "design");
      const result = await run("export_model", { editorId: host(args), format: args.format, name });
      if (!result?.base64 || !["stl", "step"].includes(args.format)) throw new Error("Editor returned an invalid export payload");
      const bytes = Buffer.from(result.base64, "base64");
      if (bytes.length !== result.byteLength || bytes.length > 32 * 1024 * 1024) throw new Error("Export payload failed size validation");
      await mkdir(EXPORTS, { recursive: true });
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      const fileName = `${name}-${digest}.${args.format}`;
      const path = join(EXPORTS, fileName);
      try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(path);
        if (!existing.equals(bytes)) throw new Error("Export filename collision; change the export name and retry");
      }
      let meshValidation;
      if (args.format === "stl") {
        const count = bytes.length >= 84 ? bytes.readUInt32LE(80) : 0;
        if (!count || bytes.length !== 84 + count * 50) throw new Error("Malformed binary STL export");
        if (count <= 200000) {
          const vertices = new Float64Array(count * 9), triangles = new Uint32Array(count * 3);
          for (let i = 0; i < count; i++) for (let j = 0; j < 9; j++) vertices[i * 9 + j] = bytes.readFloatLE(84 + i * 50 + 12 + j * 4);
          for (let i = 0; i < triangles.length; i++) triangles[i] = i;
          meshValidation = inspectTriangleMesh({ vertices, triangles }, { tolerance: 0.0001 });
          meshValidation.valid = !meshValidation.degenerateTriangles && !meshValidation.boundaryEdges && !meshValidation.nonManifoldEdges && !meshValidation.inconsistentWindingEdges;
        } else meshValidation = { valid: null, status: "not_checked", reason: "Export exceeds the 200000 triangle inspection budget" };
      }
      return { format: args.format, path, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), meshValidation, physicalFit: "unverified", manufacturingPerformance: "unverified" };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function sanitizeName(value) {
  if (typeof value !== "string" || value.length > 80) throw new Error("Export name must be a string of at most 80 characters");
  const name = value.trim().replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/^\.+|\.+$/g, "").slice(0, 80);
  return name || "design";
}

function textContent(value) {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
}

function toolResult(value) {
  const content = [];
  if (Array.isArray(value?.images)) {
    const { images, ...summary } = value;
    content.push(textContent({ ...summary, images: images.map(({ dataUrl, ...metadata }) => metadata) }));
    for (const image of images) {
      const match = /^data:image\/(png|jpeg);base64,/.exec(image.dataUrl || "");
      if (match) { content.push(textContent({ view: image.view })); content.push({ type: "image", data: image.dataUrl.slice(match[0].length), mimeType: `image/${match[1]}` }); }
    }
    return { resultType: "complete", content, isError: false };
  }
  const imageMatch = /^data:image\/(png|jpeg);base64,/.exec(value?.imageDataUrl || "");
  if (imageMatch) {
    const { imageDataUrl, ...summary } = value;
    content.push(textContent(summary));
    content.push({ type: "image", data: imageDataUrl.slice(imageMatch[0].length), mimeType: `image/${imageMatch[1]}` });
  } else content.push(textContent(value));
  return { resultType: "complete", content, isError: false };
}

function toolError(error) {
  return { resultType: "complete", content: [textContent({ error: error instanceof Error ? error.message : String(error) })], isError: true };
}

async function handleMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const { id: requestId, method, params = {} } = message;
  if (typeof method !== "string") return rpcError(requestId ?? null, -32600, "Expected a JSON-RPC method");
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  try {
    if (["initialize", "server/discover"].includes(method)) presence.stdioConnected();
    if (method === "server/discover") {
      return response(requestId, {
        resultType: "complete",
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "jumpstart-3d", version: "0.1.0" } },
        instructions: "Use jumpstart_preview_model, inspect its geometry and image, then apply the returned previewId. Model coordinates are millimeters. Read the current document revision before undoing. STL fit is not guaranteed by dimensions alone.",
        ttlMs: 300_000,
        cacheScope: "public",
      });
    }
    if (method === "initialize") {
      return response(requestId, {
        protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "jumpstart-3d", version: "0.1.0" },
        instructions: "Use preview before apply. Model coordinates are millimeters.",
      });
    }
    if (method === "ping") return response(requestId, {});
    if (method === "tools/list") return response(requestId, { resultType: "complete", tools, cacheScope: "public", ttlMs: 300_000 });
    if (method === "tools/call") {
      if (typeof params.name !== "string" || !tools.some((tool) => tool.name === params.name)) {
        return response(requestId, toolError(new Error(`Unknown tool: ${params.name || ""}`)));
      }
      try {
        const args = params.arguments === undefined ? {} : params.arguments;
        return response(requestId, toolResult(await callTool(params.name, args)));
      }
      catch (error) { return response(requestId, toolError(error)); }
    }
    rpcError(requestId ?? null, -32601, `Unknown method: ${method}`);
  } catch (error) {
    rpcError(requestId ?? null, -32603, error instanceof Error ? error.message : String(error));
  }
}

function close() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [editorId] of waiters) settleWaiter(editorId, null);
  for (const [commandId] of pending) settlePending(commandId, { ok: false, error: "MCP server is shutting down" });
  server.close();
}

server.listen(PORT, HOST, () => {
  process.stderr.write(`JumpStart MCP app: http://${BROWSER_HOST}:${server.address().port}/?mcp=1\n`);
});
server.on("error", (error) => {
  process.stderr.write(`JumpStart MCP local server failed: ${error.message}\n`);
  process.exitCode = 1;
  close();
});

if (!HTTP_ONLY) {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { void handleMessage(JSON.parse(line)); }
      catch (error) { rpcError(null, -32700, error instanceof Error ? error.message : String(error)); }
    }
  });
  process.stdin.on("end", close);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
