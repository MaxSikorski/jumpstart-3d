import { store, resolveNode, newDoc } from "../../src/store.js";
import { resizeBodyDocument } from "./model-plan.js";
import { getUnit } from "../../src/units.js";
import { clone } from "../../src/util.js";
import { compileMcpModel, reviseMcpParameters } from "./models.js";
import { inspectGeometry } from "./inspection.js";
import { selectGeometry } from "../shared/geometry.js";
import { initAgentStatus, STATUS_HOLD_MS } from "./ai-status.js";

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
      fingerprint: fingerprint({ node: resolveNode(body.node, store.view), matrix: body.m }),
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
    nativeParameters: (doc.params || []).slice(0, 256).map((parameter) => ({
      id: String(parameter.id || "").slice(0, 120), name: String(parameter.name || "").slice(0, 120),
      expression: String(parameter.expr || "").slice(0, 2000), unit: String(parameter.unit || "mm").slice(0, 30),
      value: Number.isFinite(parameter.value) ? parameter.value : null,
    })),
    nativeParametersTruncated: (doc.params?.length || 0) > 256,
    viewport: { target: app.vp.view.target.toArray(), azimuth: app.vp.view.az, elevation: app.vp.view.el, distance: app.vp.view.dist, roll: app.vp.view.roll || 0, orthographic: app.vp.useOrtho, section: clone(app.section?.info || null) },
    sketches: (doc.sketches || []).map((sketch) => ({
      id: sketch.id,
      name: sketch.name,
      plane: clone(sketch.plane),
      pointCount: sketch.pts?.length ?? 0,
      entityCount: sketch.ents?.length ?? 0,
      hidden: !!sketch.hidden,
      ...(includeGeometry ? { points: sketch.pts?.slice(0, 512) ?? [], entities: sketch.ents?.slice(0, 512) ?? [], constraints: featureTree(sketch.cons?.slice(0, 512) || []), truncated: (sketch.pts?.length ?? 0) > 512 || (sketch.ents?.length ?? 0) > 512 || (sketch.cons?.length ?? 0) > 512 } : {}),
    })),
    planes: (doc.planes || []).map((plane) => ({ id: plane.id, name: plane.name, kind: plane.kind, plane: clone(plane.plane), hidden: !!plane.hidden })),
    bodies: doc.bodies.filter((body) => !body.cutPreview).map((body) => bodyInfo(body, app, includeGeometry)),
    parametricModels: (doc.mcpModels || []).map(({ bodyState, sketchState, planeState, ...model }) => ({ ...clone(model), sourceState: "saved parameter template; native edits are checked before regeneration" })),
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

function imageDataUrl(app, box) {
  app.vp.render();
  const source = app.vp.renderer.domElement;
  if (!source.width || !source.height || app.vp.renderer.getContext().isContextLost()) throw new Error("Viewport is unavailable or its WebGL context is lost");
  let sx = 0, sy = 0, sw = source.width, sh = source.height;
  if (box && !box.isEmpty()) {
    const projected = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(app.vp.project(box.min.clone().set(x, y, z)));
    const ratioX = source.width / app.vp.w, ratioY = source.height / app.vp.h;
    const minX = Math.min(...projected.map((p) => p[0])) * ratioX, maxX = Math.max(...projected.map((p) => p[0])) * ratioX;
    const minY = Math.min(...projected.map((p) => p[1])) * ratioY, maxY = Math.max(...projected.map((p) => p[1])) * ratioY;
    const padding = Math.max(16, (maxX - minX) * 0.06, (maxY - minY) * 0.06);
    sx = Math.max(0, Math.floor(minX - padding)); sy = Math.max(0, Math.floor(minY - padding));
    sw = Math.max(1, Math.min(source.width - sx, Math.ceil(maxX + padding) - sx));
    sh = Math.max(1, Math.min(source.height - sy, Math.ceil(maxY + padding) - sy));
  }
  const scale = Math.min(1, 1024 / sw, 1024 / sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function previewImages(app, box, section) {
  const vp = app.vp;
  const saved = { view: { ...vp.view, target: vp.view.target.clone() }, ortho: vp.useOrtho, anim: vp.anim, grid: vp.grid.visible, overlay: vp.overlay.visible, section: clone(app.section?.info || null), time: performance.now() };
  const images = [], imageErrors = [];
  try {
    vp.anim = null; vp.useOrtho = true; vp.grid.visible = false; vp.overlay.visible = false;
    app.section?.clear();
    // Selection tint hides same-normal channel floors in orthographic previews.
    for (const body of store.view.bodies) {
      const view = app.scene.views.get(body.id);
      if (view?.mesh) { view.applyStyle(body, { ...app.scene.styleFor(body), selected: false, hovered: false, tool: false, edgesStrong: true }); view.setFaceStates(new Map()); }
    }
    const views = [ ["top", "top"], ["side", "front"], ["isometric", "home"] ];
    if (section) views.push(["section", section.axis === "X" ? "right" : section.axis === "Y" ? "front" : "top"]);
    for (const [name, view] of views) {
      try {
        vp.setView(view, box);
        Object.assign(vp.view, vp.anim.to); vp.anim = null;
        vp.view.target = vp.view.target.clone();
        // Native fit caps its portrait aspect correction. Fit projected bounds directly
        // so narrow editor panels cannot clip corners of rectangular parts.
        vp.updateCamera();
        const corners = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(vp.project(box.min.clone().set(x, y, z)));
        const width = Math.max(...corners.map((p) => p[0])) - Math.min(...corners.map((p) => p[0]));
        const height = Math.max(...corners.map((p) => p[1])) - Math.min(...corners.map((p) => p[1]));
        vp.view.dist *= Math.max(width / (vp.w * 0.8), height / (vp.h * 0.8), 0.001);
        if (name === "section") {
          if (!app.section) throw new Error("Native section rendering is unavailable");
          const n = [0, 0, 0]; n[["X", "Y", "Z"].indexOf(section.axis)] = section.axis === "Y" ? -1 : 1;
          const o = [0, 0, 0]; o[["X", "Y", "Z"].indexOf(section.axis)] = section.offset;
          app.section.set({ ref: { n, o }, d: 0, flip: section.flip === true, hatch: true });
        }
        images.push({ view: name, projection: "orthographic", ...(name === "section" ? { section } : {}), dataUrl: imageDataUrl(app, box) });
      } catch (error) { imageErrors.push({ view: name, error: error.message }); }
    }
  } finally {
    app.section?.set(saved.section);
    vp.view = saved.view; vp.useOrtho = saved.ortho; vp.grid.visible = saved.grid; vp.overlay.visible = saved.overlay;
    vp.anim = saved.anim;
    if (vp.anim) vp.anim.t0 += performance.now() - saved.time;
    app.scene.refresh();
    vp.render(); vp.request();
  }
  return { images, imageErrors, cameraRestored: true, sectionRestored: true };
}

export function initMcp(app) {
  // Static and offline upstream builds have no local broker. Only the broker's
  // served shell or an explicit loopback opt-in should start MCP networking.
  const local = location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname);
  const enabled = local && (document.querySelector('meta[name="jumpstart-mcp-bridge"]')?.content === "1" || new URLSearchParams(location.search).get("mcp") === "1");
  if (!enabled) {
    const indicator = document.getElementById("ai-status");
    if (indicator) indicator.hidden = true;
    return { enabled: false };
  }
  const drawStatus = initAgentStatus();
  const status = { checking: true, online: false, connected: false, recent: false };
  let statusTimer;
  const showStatus = (changes) => { Object.assign(status, changes); drawStatus(status); };
  const finishStatus = (outcome, error) => {
    clearTimeout(statusTimer);
    showStatus({ action: null, outcome, error });
    statusTimer = setTimeout(() => showStatus({ outcome: null, error: null }), STATUS_HOLD_MS);
  };
  showStatus({});
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

  function checkRevision(expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== currentRevision()) throw new Error("The document changed; read it again before continuing");
  }

  async function previewCompiled(compiled, plan, includeImage, section, extra = {}) {
    const baseSnapshot = currentRevision();
    const previewDocument = clone(compiled.document);
    previewDocument.bodies.forEach((body) => { if (compiled.affectedBodyIds.includes(body.id)) body.cmdPreview = true; });
    store.setPreview((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, previewDocument);
    });
    const ownedPreview = store.preview;
    const assertOwned = () => {
      checkRevision(baseSnapshot);
      if (store.preview !== ownedPreview || app.command || app.sketcher.active) throw new Error("Another editor command replaced the MCP preview; finish it and retry");
    };
    try {
      const deadline = Date.now() + BUILD_TIMEOUT_MS;
      let results;
      while (Date.now() < deadline) {
        assertOwned();
        results = readyBodies(app, compiled.affectedBodyIds);
        if (results.every((result) => !result.pending)) break;
        await sleep(50);
      }
      results = readyBodies(app, compiled.affectedBodyIds);
      const errors = results.filter((entry) => entry.error || entry.pending).map((entry) => ({ id: entry.id, error: entry.error || "Geometry build timed out" }));
      const result = {
        previewId: id(), valid: !errors.length, errors, revision: currentRevision(),
        validation: { schema: "passed", cadConstruction: errors.length ? "failed" : "passed", geometricRequirements: "not_requested", physicalFit: "unverified", manufacturingPerformance: "unverified" },
        document: { id: store.doc.id, name: plan.name },
        modelId: compiled.modelId, parameters: compiled.parameters, diff: compiled.diff,
        bodies: results.filter((entry) => entry.view).map(({ body, view }) => ({ ...bodyInfo(body, app, true), volume: view.data.volume, triangleCount: view.data.triangles.length / 3 })),
        ...extra,
      };
      if (result.valid) {
        const box = app.scene.allBox((body) => compiled.affectedBodyIds.includes(body.id));
        if (includeImage && !box.isEmpty()) Object.assign(result, previewImages(app, box, section));
        const geometries = new Map(results.map(({ body, view }) => [body.id, {
          mesh: { vertices: view.data.vertices, triangles: view.data.triangles, matrix: Array.from(view.group.matrix.elements) },
          selectors: bodyInfo(body, app, true).geometrySelectors,
        }]));
        const bytes = [...geometries.values()].reduce((sum, { mesh }) => sum + (mesh.vertices.byteLength || mesh.vertices.length * 8) + (mesh.triangles.byteLength || mesh.triangles.length * 8), 0);
        if (bytes > 32 * 1024 * 1024) throw new Error("Preview geometry exceeds the 32 MiB inspection cache budget");
        previews.set(result.previewId, { plan, compiled, baseSnapshot, baseDocumentId: store.doc.id, revision: currentRevision(), geometries, bytes });
        const cacheBytes = () => [...previews.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        while (previews.size > 20 || cacheBytes() > 64 * 1024 * 1024) previews.delete(previews.keys().next().value);
      }
      assertOwned();
      return result;
    } finally {
      // A human can begin a native preview while the worker is building. Do not
      // clear a preview now owned by that command when abandoning this request.
      if (store.preview === ownedPreview) store.setPreview(null);
    }
  }

  async function previewModel(rawPlan, includeImage = true, replaceBodyIds = [], section, expectedRevision) {
    assertIdle(); checkRevision(expectedRevision);
    const compiled = compileMcpModel(store.doc, rawPlan, replaceBodyIds);
    return previewCompiled(compiled, compiled.plan, includeImage, section);
  }

  async function previewParameters(p) {
    assertIdle(); checkRevision(p.expectedRevision);
    const compiled = reviseMcpParameters(store.doc, p.modelId, p.values);
    return previewCompiled(compiled, compiled.plan, p.includeImage !== false, p.section);
  }

  async function previewResizeBody(bodyId, size, anchor = "base", includeImage = true, section, expectedRevision) {
    assertIdle(); checkRevision(expectedRevision);
    const body = store.doc.bodies.find((entry) => entry.id === bodyId);
    if (!body) throw new Error("Body does not exist in the current document");
    const view = app.scene.views.get(bodyId);
    const edit = resizeBodyDocument(store.doc, bodyId, view?.data?.kbbox || view?.data?.bbox, size, anchor);
    // Resizing a generated model directly invalidates its saved template ownership.
    edit.document.mcpModels = (edit.document.mcpModels || []).filter((model) => !model.bodyIds.includes(bodyId));
    const compiled = { document: edit.document, createdBodyIds: [bodyId], featureBodyIds: { [bodyId]: bodyId }, affectedBodyIds: [bodyId] };
    return previewCompiled(compiled, { name: `Resize ${body.name}`.slice(0, 80), mode: store.doc.mode }, includeImage, section, { bodyId, anchor, requestedLocalDimensionsMm: { ...size }, factors: edit.factors });
  }

  function inspectionSource(p) {
    assertIdle(); checkRevision(p.expectedRevision);
    if (p.previewId) {
      const preview = previews.get(p.previewId);
      if (!preview || preview.baseDocumentId !== store.doc.id || preview.baseSnapshot !== currentRevision()) throw new Error("Preview expired or stale; preview again before inspecting");
      const geometry = preview.geometries.get(p.bodyId);
      if (!geometry) throw new Error("Body is not part of the requested preview");
      return geometry;
    }
    const [status] = readyBodies(app, [p.bodyId]);
    if (status.error || status.pending) throw new Error(status.error || "Geometry is still building; retry read-only inspection");
    return { mesh: { vertices: status.view.data.vertices, triangles: status.view.data.triangles, matrix: Array.from(status.view.group.matrix.elements) }, selectors: bodyInfo(status.body, app, true).geometrySelectors };
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
    if (preview.failedMesh || [...(preview.checks?.values() || [])].some((pass) => !pass)) throw new Error("Preview has failed requested geometry checks; correct the model or resolve the reported measurement before applying");
    const next = clone(preview.compiled.document);
    store.update((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, next);
    }, `AI model: ${preview.plan.name}`);
    app.setMode(preview.plan.mode || "advanced");
    app.select(preview.compiled.createdBodyIds.length ? preview.compiled.createdBodyIds : preview.compiled.affectedBodyIds);
    const result = { applied: true, previewId, revision: currentRevision(), bodyIds: preview.compiled.createdBodyIds, featureBodyIds: preview.compiled.featureBodyIds, modelId: preview.compiled.modelId, parameters: preview.compiled.parameters };
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
      case "preview_new_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const document = newDoc(p.name || "Untitled", p.mode || "beginner");
        return previewCompiled({ document, createdBodyIds: [], affectedBodyIds: [], featureBodyIds: {} }, { name: document.name, mode: document.mode }, false, undefined, { newDocument: { id: document.id, name: document.name, mode: document.mode }, replacesDocument: store.doc.id });
      }
      case "preview_model": return previewModel(p.plan, p.includeImage !== false, p.replaceBodyIds || [], p.section, p.expectedRevision);
      case "preview_resize_body": return previewResizeBody(p.bodyId, p.size, p.anchor || "base", p.includeImage !== false, p.section, p.expectedRevision);
      case "preview_parameters": return previewParameters(p);
      case "inspect_geometry": {
        const result = { ...inspectGeometry(inspectionSource(p).mesh, p), bodyId: p.bodyId, revision: currentRevision() };
        if (p.previewId) {
          const preview = previews.get(p.previewId);
          preview.checks ||= new Map();
          for (const check of result.checks) preview.checks.set(`${p.bodyId}:${check.id}`, check.pass);
          if (result.meshValidation) { preview.meshChecks ||= new Map(); preview.meshChecks.set(p.bodyId, result.meshValidation.valid); preview.failedMesh = [...preview.meshChecks.values()].some((pass) => !pass); }
        }
        return result;
      }
      case "select_geometry": {
        const { selectors } = inspectionSource(p);
        const { kind, ...predicate } = p.query;
        return selectGeometry(selectors, { kind, predicate, expectedFingerprint: p.expectedFingerprint, currentFingerprint: selectors.fingerprint });
      }
      case "save_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const result = app.projects.saveLocalMcp();
        return { ...result, revision: currentRevision() };
      }
      case "reopen_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const result = app.projects.reopenLocalMcp(p.documentId);
        const deadline = Date.now() + BUILD_TIMEOUT_MS;
        while (readyBodies(app, store.doc.bodies.map((body) => body.id)).some((entry) => entry.pending) && Date.now() < deadline) await sleep(50);
        return { ...result, revision: currentRevision(), document: documentSummary(app, editorId, currentRevision(), true) };
      }
      case "apply_model": return applyModel(p.previewId);
      case "undo": {
        assertIdle();
        if (p.expectedRevision !== currentRevision()) throw new Error("The document changed; read it again before undoing");
        if (!store.undoStack.length) throw new Error("Nothing to undo");
        const undone = store.undo();
        if (!undone) throw new Error("Nothing to undo");
        if (app.mode !== store.doc.mode) app.setMode(store.doc.mode || "beginner", true);
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
  }, AbortSignal.timeout(3000)).then((response) => showStatus({ checking: false, online: true, connected: response.agent?.clientConnected === true, recent: response.agent?.recentClientActivity === true })).catch(() => showStatus({ checking: false, online: false, connected: false, recent: false }));

  const submitResult = (commandId, ok, data, error) => post("/result", { editorId, commandId, ok, data, error }).catch(() => undefined);

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    let retry = false;
    pollAbort = new AbortController();
    try {
      const { command } = await post("/poll", { editorId }, pollAbort.signal);
      if (command) {
        const reading = ["get_document", "inspect_geometry", "select_geometry", "list_editors"].includes(command.action);
        if (!reading) clearTimeout(statusTimer);
        showStatus({ action: command.action, checking: false, online: true, recent: true, ...(reading ? {} : { error: null, outcome: null }) });
        const before = currentRevision();
        try {
          const result = await execute(command);
          const failed = result?.valid === false || result?.geometricRequirements === "failed";
          const changesDocument = ["apply_model", "undo", "reopen_document"].includes(command.action);
          const outcome = command.action.startsWith("preview_") || ["save_document", "export_model"].includes(command.action) ? command.action : changesDocument ? before !== currentRevision() ? command.action : "no_change" : null;
          if (reading && !failed) showStatus({ action: null });
          else finishStatus(failed ? null : outcome, failed ? "The requested geometry checks failed. The saved model was not changed by inspection." : null);
          await submitResult(command.id, true, result);
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finishStatus(null, message);
          await submitResult(command.id, false, undefined, message);
        }
      }
    } catch (error) {
      showStatus({ checking: false, online: false, connected: false, recent: false });
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
    clearTimeout(statusTimer);
    clearTimeout(retryTimer);
    pollAbort?.abort();
  }, { once: true });
}
