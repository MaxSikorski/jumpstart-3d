import { store, resolveNode } from "./store.js";
import { buildModelPlan, normalizeModelPlan, resizeBodyDocument } from "./mcp-plan.js";
import { getUnit } from "./units.js";
import { clone } from "./util.js";

const BRIDGE = "/__mcp";
const HEARTBEAT_MS = 5_000;
const BUILD_TIMEOUT_MS = 24_000;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `js3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fingerprint(doc) {
  const value = JSON.stringify(doc);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + i), 0x85ebca6b);
  }
  return `${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function bodyInfo(body, app, includeGeometry = false) {
  const view = app.scene.views.get(body.id);
  const box = app.scene.bodyWorldBox(body.id);
  const localBox = view?.data?.kbbox || view?.data?.bbox;
  const size = box ? { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z } : null;
  const localSize = localBox ? { x: localBox.max[0] - localBox.min[0], y: localBox.max[1] - localBox.min[1], z: localBox.max[2] - localBox.min[2] } : null;
  const result = {
    id: body.id,
    name: body.name,
    feature: body.node?.t ?? "unknown",
    hidden: !!body.hidden,
    locked: !!body.locked,
    error: app.scene.errors.get(body.id) ?? null,
    dimensions: size ? { x: size.x, y: size.y, z: size.z } : null,
    bounds: box ? {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      center: [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
    } : null,
    localDimensions: localSize,
    volume: view?.data?.volume ?? null,
    triangleCount: view?.data?.triangles?.length ? view.data.triangles.length / 3 : null,
  };
  if (includeGeometry) result.featureTree = featureTree(body.node);
  else result.modifierCount = body.node?.mods?.length ?? 0;
  if (includeGeometry) {
    const edges = view?.data?.edgeInfo || [];
    const faces = view?.data?.faceInfo || [];
    result.geometrySelectors = {
      edges: edges.slice(0, 512).map((edge, index) => ({ index, ...clone(edge) })),
      faces: faces.slice(0, 512).map((face, index) => ({ index, ...clone(face) })),
      truncated: edges.length > 512 || faces.length > 512,
    };
  }
  return result;
}

function featureTree(value, depth = 0) {
  if (depth > 16) return { truncated: true };
  if (Array.isArray(value)) return value.length > 2048 ? [...value.slice(0, 2048).map((item) => featureTree(item, depth + 1)), { truncated: true }] : value.map((item) => featureTree(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 2000) : value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (["assetData", "positions", "vertices", "triangles", "normals", "bytes", "data"].includes(key)) continue;
    out[key] = featureTree(child, depth + 1);
  }
  return out;
}

function documentSummary(app, editorId, revision, includeGeometry = false) {
  const doc = store.doc;
  return {
    editorId,
    revision,
    document: { id: doc.id, name: doc.name, mode: doc.mode ?? app.mode },
    units: getUnit(),
    sketches: (doc.sketches || []).map((sketch) => ({
      id: sketch.id,
      name: sketch.name,
      plane: clone(sketch.plane),
      pointCount: sketch.pts?.length ?? 0,
      entityCount: sketch.ents?.length ?? 0,
      hidden: !!sketch.hidden,
      ...(includeGeometry ? { points: sketch.pts?.slice(0, 512) ?? [], entities: sketch.ents?.slice(0, 512) ?? [], truncated: (sketch.pts?.length ?? 0) > 512 || (sketch.ents?.length ?? 0) > 512 } : {}),
    })),
    planes: (doc.planes || []).map((plane) => ({ id: plane.id, name: plane.name, kind: plane.kind, plane: clone(plane.plane), hidden: !!plane.hidden })),
    bodies: doc.bodies.filter((body) => !body.cutPreview).map((body) => bodyInfo(body, app, includeGeometry)),
  };
}

function buildStl(app) {
  const items = store.doc.bodies
    .filter((body) => !body.hidden && !body.hole && !body.cutPreview)
    .map((body) => ({ body, view: app.scene.views.get(body.id) }))
    .filter(({ view }) => view?.data?.triangles?.length);
  const triangleCount = items.reduce((total, { view }) => total + view.data.triangles.length / 3, 0);
  if (!triangleCount) throw new Error("No built solid bodies are available to export");
  const byteLength = 84 + triangleCount * 50;
  if (byteLength > MAX_EXPORT_BYTES) throw new Error(`STL export exceeds the ${MAX_EXPORT_BYTES} byte local export limit`);
  const buffer = new ArrayBuffer(byteLength);
  const dv = new DataView(buffer);
  const header = "JumpStart 3D MCP export (mm)";
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, triangleCount, true);
  let offset = 84;
  let writtenTriangles = 0;
  for (const { view } of items) {
    const { vertices: P, triangles: T } = view.data;
    const M = view.group.matrix.elements;
    const determinant = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
    const point = (index) => {
      const x = P[index * 3], y = P[index * 3 + 1], z = P[index * 3 + 2];
      return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    };
    for (let i = 0; i < T.length; i += 3) {
      const a = point(T[i]);
      let b = point(T[i + 1]);
      let c = point(T[i + 2]);
      if (determinant < 0) [b, c] = [c, b];
      const u = b.map((v, j) => v - a[j]);
      const v = c.map((q, j) => q - a[j]);
      let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal);
      if (!Number.isFinite(length)) throw new Error("Cannot export non-finite triangle geometry");
      if (length <= 1e-12) continue;
      normal = normal.map((q) => q / length);
      for (const q of [...normal, ...a, ...b, ...c]) { dv.setFloat32(offset, q, true); offset += 4; }
      dv.setUint16(offset, 0, true);
      offset += 2;
      writtenTriangles++;
    }
  }
  if (!writtenTriangles) throw new Error("No non-degenerate triangles are available to export");
  dv.setUint32(80, writtenTriangles, true);
  return new Uint8Array(buffer, 0, offset);
}

function readyBodies(app, bodyIds) {
  const document = store.view;
  const results = bodyIds.map((bodyId) => {
    const body = document.bodies.find((entry) => entry.id === bodyId);
    if (!body) return { id: bodyId, error: "Body no longer exists" };
    const error = app.scene.errors.get(bodyId);
    const view = app.scene.views.get(bodyId);
    if (error) return { id: bodyId, error };
    if (!view?.data || view.pending) return { id: bodyId, pending: true };
    return { id: bodyId, body, view };
  });
  return results;
}

function imageDataUrl(app) {
  app.vp.render();
  const source = app.vp.renderer.domElement;
  const scale = Math.min(1, 720 / source.width, 720 / source.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export function initMcp(app) {
  let editorId;
  try {
    editorId = sessionStorage.getItem("jumpstart.mcp.editorId") || id();
    sessionStorage.setItem("jumpstart.mcp.editorId", editorId);
  } catch {
    editorId = id();
  }

  const previews = new Map();
  const applied = new Map();
  let stopped = false;
  let polling = false;
  let pollAbort = null;
  let retryTimer = null;

  const currentRevision = () => fingerprint(store.doc);

  async function post(path, payload, signal) {
    const response = await fetch(`${BRIDGE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Local MCP bridge returned HTTP ${response.status}`);
    return result;
  }

  function assertIdle() {
    if (app.command || app.sketcher.active) throw new Error("Finish or cancel the open Sketch or CAD command before using MCP edits");
    if (store.preview) throw new Error("Finish or cancel the current preview before using MCP edits");
    if (app.mode === "chisel" || app.simLock) throw new Error("Leave Chisel or Print Simulation before using MCP edits");
  }

  async function previewModel(rawPlan, includeImage = true, replaceBodyIds = []) {
    assertIdle();
    const plan = normalizeModelPlan(rawPlan, store.doc.bodies.map((body) => body.id), store.doc.mode ?? app.mode);
    const baseSnapshot = fingerprint(store.doc);
    const compiled = buildModelPlan(store.doc, plan, undefined, replaceBodyIds, true);
    const previewDocument = clone(compiled.document);
    previewDocument.bodies.forEach((body) => {
      if (compiled.affectedBodyIds.includes(body.id)) body.cmdPreview = true;
    });
    store.setPreview((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, clone(previewDocument));
    });

    try {
      const deadline = Date.now() + BUILD_TIMEOUT_MS;
      let results;
      while (Date.now() < deadline) {
        if (fingerprint(store.doc) !== baseSnapshot) throw new Error("The document changed during preview; read the document again and retry");
        results = readyBodies(app, compiled.affectedBodyIds);
        if (results.every((result) => !result.pending)) break;
        await sleep(50);
      }
      results ??= readyBodies(app, compiled.affectedBodyIds);
      const timedOut = results.some((result) => result.pending);
      const errors = results.filter((result) => result.error || result.pending).map((result) => ({ id: result.id, error: result.error || "Geometry build timed out" }));
      const ready = !timedOut && !errors.length;
      const result = {
        previewId: id(),
        valid: ready,
        errors,
        revision: currentRevision(),
        document: { id: store.doc.id, name: plan.name },
        bodies: results.filter((entry) => entry.view).map(({ id: bodyId, body, view }) => {
          const info = bodyInfo(body, app, true);
          return { ...info, id: bodyId, volume: view.data.volume, triangleCount: view.data.triangles.length / 3 };
        }),
      };
      if (ready) {
        const box = app.scene.allBox((body) => compiled.affectedBodyIds.includes(body.id));
        if (!box.isEmpty()) app.vp.fit(box);
        if (includeImage) {
          try { result.imageDataUrl = imageDataUrl(app); } catch (error) { result.imageError = error.message || "Could not capture viewport"; }
        }
        previews.set(result.previewId, { plan, compiled, baseSnapshot, baseDocumentId: store.doc.id, revision: currentRevision() });
        if (previews.size > 20) previews.delete(previews.keys().next().value);
      }
      return result;
    } finally {
      if (store.preview) store.setPreview(null);
    }
  }

  async function previewResizeBody(bodyId, size, anchor = "base", includeImage = true) {
    assertIdle();
    const body = store.doc.bodies.find((entry) => entry.id === bodyId);
    if (!body) throw new Error(`Body ${bodyId} does not exist in the current document`);
    const view = app.scene.views.get(bodyId);
    const bounds = view?.data?.kbbox || view?.data?.bbox;
    const baseSnapshot = fingerprint(store.doc);
    const edit = resizeBodyDocument(store.doc, bodyId, bounds, size, anchor);
    const name = `Resize ${body.name}`.slice(0, 80);
    const compiled = {
      document: edit.document,
      createdBodyIds: [bodyId],
      featureBodyIds: { [bodyId]: bodyId },
      affectedBodyIds: [bodyId],
    };
    const previewDocument = clone(compiled.document);
    previewDocument.bodies.find((entry) => entry.id === bodyId).cmdPreview = true;
    store.setPreview((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, previewDocument);
    });

    try {
      const deadline = Date.now() + BUILD_TIMEOUT_MS;
      let results;
      while (Date.now() < deadline) {
        if (fingerprint(store.doc) !== baseSnapshot) throw new Error("The document changed during preview; read the document again and retry");
        results = readyBodies(app, [bodyId]);
        if (results.every((result) => !result.pending)) break;
        await sleep(50);
      }
      results ??= readyBodies(app, [bodyId]);
      const errors = results.filter((result) => result.error || result.pending).map((result) => ({ id: result.id, error: result.error || "Geometry build timed out" }));
      const valid = !errors.length;
      const result = {
        previewId: id(),
        valid,
        errors,
        revision: currentRevision(),
        bodyId,
        anchor,
        requestedLocalDimensionsMm: Object.fromEntries(Object.entries(size)),
        factors: edit.factors,
        bodies: results.filter((entry) => entry.view).map(({ body: previewBody, view: previewView }) => ({
          ...bodyInfo(previewBody, app, true),
          volume: previewView.data.volume,
          triangleCount: previewView.data.triangles.length / 3,
        })),
      };
      if (valid) {
        const box = app.scene.allBox((entry) => entry.id === bodyId);
        if (!box.isEmpty()) app.vp.fit(box);
        if (includeImage) {
          try { result.imageDataUrl = imageDataUrl(app); } catch (error) { result.imageError = error.message || "Could not capture viewport"; }
        }
        previews.set(result.previewId, { plan: { name }, compiled, baseSnapshot, baseDocumentId: store.doc.id, revision: currentRevision() });
        if (previews.size > 20) previews.delete(previews.keys().next().value);
      }
      return result;
    } finally {
      if (store.preview) store.setPreview(null);
    }
  }

  function applyModel(previewId) {
    assertIdle();
    if (applied.has(previewId)) return applied.get(previewId);
    const preview = previews.get(previewId);
    if (!preview) throw new Error("Preview expired or unknown; preview the model again");
    if (store.doc.id !== preview.baseDocumentId || fingerprint(store.doc) !== preview.baseSnapshot) {
      previews.delete(previewId);
      throw new Error("The document changed after preview; preview the plan again before applying it");
    }
    const next = clone(preview.compiled.document);
    store.update((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, next);
    }, `AI model: ${preview.plan.name}`);
    app.setMode(preview.plan.mode || "advanced");
    app.select(preview.compiled.createdBodyIds.length ? preview.compiled.createdBodyIds : preview.compiled.affectedBodyIds);
    const result = { applied: true, previewId, revision: currentRevision(), bodyIds: preview.compiled.createdBodyIds, featureBodyIds: preview.compiled.featureBodyIds };
    previews.delete(previewId);
    applied.set(previewId, result);
    if (applied.size > 100) applied.delete(applied.keys().next().value);
    return result;
  }

  async function exportModel(format, name) {
    assertIdle();
    const bodies = store.doc.bodies.filter((body) => !body.hidden && !body.hole && !body.cutPreview);
    const statuses = readyBodies(app, bodies.map((body) => body.id));
    const errors = statuses.filter((entry) => entry.error || entry.pending).map((entry) => ({ id: entry.id, error: entry.error || "Geometry is still building" }));
    if (errors.length) throw new Error(`Cannot export while geometry errors remain: ${JSON.stringify(errors)}`);
    if (format === "stl") {
      const bytes = buildStl(app);
      return { format, name, byteLength: bytes.byteLength, base64: base64(bytes) };
    }
    if (format === "step") {
      const resolved = bodies.map((body) => ({ node: resolveNode(body.node, store.doc), m: body.m }));
      const buffer = await app.kernel.step(resolved);
      if (buffer.byteLength > MAX_EXPORT_BYTES) throw new Error(`STEP export exceeds the ${MAX_EXPORT_BYTES} byte local export limit`);
      return { format, name, byteLength: buffer.byteLength, base64: base64(new Uint8Array(buffer)) };
    }
    throw new Error("Export format must be stl or step");
  }

  async function execute(command) {
    const p = command.params || {};
    switch (command.action) {
      case "list_editors": return { editors: [{ editorId, documentId: store.doc.id, documentName: store.doc.name, mode: app.mode, bodyCount: store.doc.bodies.length, focused: document.visibilityState === "visible" && document.hasFocus() }] };
      case "get_document": return documentSummary(app, editorId, currentRevision(), p.includeGeometry === true);
      case "preview_model": return previewModel(p.plan, p.includeImage !== false, p.replaceBodyIds || []);
      case "preview_resize_body": return previewResizeBody(p.bodyId, p.size, p.anchor || "base", p.includeImage !== false);
      case "apply_model": return applyModel(p.previewId);
      case "undo": {
        assertIdle();
        if (p.expectedRevision !== currentRevision()) throw new Error("The document changed; read it again before undoing");
        if (!store.undoStack.length) throw new Error("Nothing to undo");
        const undone = store.undo();
        if (!undone) throw new Error("Nothing to undo");
        return { undone: true, revision: currentRevision(), document: documentSummary(app, editorId, currentRevision()) };
      }
      case "export_model": return exportModel(p.format, p.name || store.doc.name || "design");
      default: throw new Error(`Unknown JumpStart MCP action: ${command.action}`);
    }
  }

  const heartbeat = () => post("/heartbeat", {
    editorId,
    documentId: store.doc.id,
    documentName: store.doc.name,
    mode: app.mode,
    bodyCount: store.doc.bodies.length,
    revision: currentRevision(),
    focused: document.visibilityState === "visible" && document.hasFocus(),
  }).catch(() => undefined);

  const submitResult = (commandId, ok, data, error) => post("/result", { editorId, commandId, ok, data, error }).catch(() => undefined);

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    let retry = false;
    pollAbort = new AbortController();
    try {
      const { command } = await post("/poll", { editorId }, pollAbort.signal);
      if (command) {
        try { await submitResult(command.id, true, await execute(command)); }
        catch (error) { await submitResult(command.id, false, undefined, error instanceof Error ? error.message : String(error)); }
      }
    } catch (error) {
      retry = !stopped && (!(error instanceof DOMException) || error.name !== "AbortError");
    } finally {
      pollAbort = null;
      polling = false;
      if (!stopped) {
        if (retry) retryTimer = setTimeout(() => { retryTimer = null; void poll(); }, 1_000);
        else void poll();
      }
    }
  };

  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  void poll();
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(heartbeatTimer);
    clearTimeout(retryTimer);
    pollAbort?.abort();
  }, { once: true });
}
