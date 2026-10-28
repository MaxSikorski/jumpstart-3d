// Joins, cuts and combines that involve an imported mesh run on Manifold (a small triangle-mesh geometry engine) instead of OpenCascade.
// OpenCascade has to turn every triangle of a mesh into a CAD face first (seconds, and fragile where faces touch); Manifold works on the
// triangles directly. This file is ours (not J.Siwek's); kernel.js calls it from a few marked places (the import and initMeshBool, the
// top of evalNode, buildBodies, clearCache).
//
// The idea: a "meshy" body is a boolean (a group of two or more children, or a node with a bool mod) with an imported mesh anywhere in
// its operands. buildBodies asks meshBody() for the whole body and draws it from a Manifold, with no OpenCascade work at all.
// A B-rep of the result (STEP export, a fillet or shell on top, Code CAD) is built lazily from the Manifold by evalNode (meshBrep).
// Whenever Manifold refuses an input or its result fails a check, the answer is null and today's OpenCascade code runs unchanged.
//
// Loading: the engine is part of the geometry worker's file (third_party/manifold-3d/, about 225 KB gzipped) and starts only when a
// design has an imported mesh: worker.js calls startManifold() on a mesh "asset" message and waits for manifoldReady() before a build.
// A failed start leaves Manifold unavailable and every operation runs on OpenCascade, as before.
import loadManifold from "../third_party/manifold-3d/index.js";

let M = null, loading = null, loadError = null;
export const MANIFOLD_START_LIMIT_MS = 15000;
// Starts the engine once. The promise always settles: with the module, or (a failed or stuck start, after limitMs) with a kept error and
// no Manifold, so every build goes on with OpenCascade. A failure is final for the session (no retry that could stall each build again).
export function startManifold(limitMs = MANIFOLD_START_LIMIT_MS) {
  if (loading) return loading;
  let timer;
  const stuck = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Manifold did not start within " + limitMs + " ms")), limitMs); });
  const attempt = loadManifold();
  attempt.catch(() => {}); // a start that fails after the limit has been given up on is not an unhandled rejection
  loading = Promise.race([attempt, stuck]).then((m) => { M = m; }, (e) => { M = null; loadError = e; }).finally(() => clearTimeout(timer));
  return loading;
}
export const manifoldReady = () => loading; // the promise while a start is under way or done, else null (nothing asked for Manifold yet)
export const manifoldModule = () => M;
export const manifoldError = () => loadError;

// ---------------------------------------------------------------- what kernel.js hands over
let D = null; // { evalNode, assetBytes, solidFromMesh, isNearEmpty, stableKey, cacheGet, cachePut, nothingLeft }
export function initMeshBool(deps) { D = deps; }
let enabled = true; // tests switch it off to get today's OpenCascade result for the same node
export function setMeshBoolEnabled(on) { enabled = !!on; }
let lastReason = ""; // why the last operand or result was refused (tests and the perf panel read it)
export const meshBoolReason = () => lastReason;
const usable = () => enabled && M && D;

// ---------------------------------------------------------------- which bodies are meshy
const SUPPORTED = new Set(["bool", "scale", "keeppiece"]); // mods Manifold applies itself; any other mod runs on a B-rep built from the Manifold
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m) => !m || m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

// an imported mesh anywhere in this node's operands
function containsMesh(node) {
  if (!node || typeof node !== "object") return false;
  if (node.t === "mesh") return true;
  if (node.t === "group" && (node.children || []).some((c) => containsMesh(c.node))) return true;
  if (node.t === "placed" && containsMesh(node.src)) return true;
  return (node.mods || []).some((m) => m.t === "bool" && containsMesh(m.tool));
}
// 0: not Manifold's (a B-rep shape, or a node whose last mod needs one); 1: a plain imported mesh (scale / keeppiece only, no boolean);
// 2: meshy, a boolean with an imported mesh in it (Manifold does it)
function kind(node) {
  const mods = node.mods || [];
  if (mods.length) {
    const last = mods[mods.length - 1], prefix = { ...node, mods: mods.slice(0, -1) };
    if (!SUPPORTED.has(last.t)) return 0;
    if (last.t === "bool") return containsMesh(prefix) || containsMesh(last.tool) ? 2 : 0;
    return kind(prefix);
  }
  if (node.t === "mesh") return 1;
  if (node.t === "group") {
    const kids = node.children || [];
    if (kids.length >= 2) return kids.some((c) => containsMesh(c.node)) ? 2 : 0;
    // a group of one body is how Combine / Group build their "before" baseline (the solids without the holes): it must not cost an OpenCascade import of the mesh
    return kids.length === 1 && kind(kids[0].node) >= 1 ? 2 : 0;
  }
  if (node.t === "placed") return kind(node.src) === 2 ? 2 : 0;
  return 0;
}
export const isMeshy = (node) => !!node && kind(node) === 2;
// The mesh detail reaches app shapes inside a Manifold result (they are tessellated at it), so a node with a meshy part anywhere in it
// gives different geometry at different detail. kernel.js adds qualityKey(node) to the key of every cached B-rep, and buildBodies tells
// us the detail first (setMeshQuality), because evalNode has no quality argument.
function dependsOnQuality(node) {
  if (!containsMesh(node)) return false;
  const mods = node.mods || [];
  for (let i = 0; i <= mods.length; i++) if (kind({ ...node, mods: mods.slice(0, i) }) === 2) return true;
  if (node.t === "group") return (node.children || []).some((c) => dependsOnQuality(c.node));
  if (node.t === "placed") return dependsOnQuality(node.src);
  return mods.some((m) => m.t === "bool" && dependsOnQuality(m.tool));
}
export const qualityKey = (node) => (dependsOnQuality(node) ? "#q" + lastQuality : "");
export function setMeshQuality(q) { lastQuality = q; }
const isBareMesh = (node) => node.t === "mesh" && !(node.mods || []).length;

// ---------------------------------------------------------------- cache of Manifold results
// entry: { mf, meta? } or { fail: true } (a node Manifold refused: not asked again until the cache is cleared)
const cache = new Map();
const CACHE_MAX = 40;
let depth = 0, scope = [], lastQuality = 1;
const tmp = (mf) => { scope.push(mf); return mf; }; // temporary Manifolds: freed when the outermost call ends
function put(key, entry) { cache.set(key, entry); return entry; }
function get(key) {
  const e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); }
  return e;
}
function freeEntry(e) { if (e && e.mf) try { e.mf.delete(); } catch (x) {} }
export function clearMeshCache() {
  for (const e of cache.values()) freeEntry(e);
  cache.clear();
  served.clear(); // the engine tag follows the cache: a B-rep rebuilt after this was not necessarily made by Manifold
}
// every public entry point runs inside this: temporaries are freed and the LRU trimmed when the outermost one ends (never in the middle
// of a build, which still holds entries it got from the cache)
function guarded(fn) {
  depth++;
  try { return fn(); }
  finally {
    if (--depth === 0) {
      for (const x of scope.splice(0)) try { x.delete(); } catch (e) {}
      while (cache.size > CACHE_MAX) {
        const [k, e] = cache.entries().next().value;
        cache.delete(k);
        freeEntry(e);
      }
    }
  }
}

// ---------------------------------------------------------------- operands
// Coordinates that mean the same number must come out as the same float32. An STL stores the 2.998 you typed as 2.99799990654 (float32), an
// app box has 2.998 as a double, and after both are moved up 0.1 mm they differ by one float32 step; Manifold sees two different faces and
// refuses the result. So a float32 corner (a mesh asset, or the stored corners of an earlier Manifold result) first goes back to the decimal it
// was written as (the shortest decimal of 6 or 7 digits that reads back as the same float32 and lies within DECIMAL_TOLERANCE of it; a value
// that needs more digits was not typed as a decimal, so it stays exact). That bound limits any size change from the recovery to 2e-4 mm
// (0.2 micron) at any distance from the origin; the digit limit alone did not: 524288.125 became "524288.1" and 100000.1015625 became
// "100000.1". Half a float32 step stays below 0.0001 mm up to 2048 mm, so moved flush joins work for any part up to 2 m; beyond that
// Manifold may refuse a moved flush join and the build falls back to OpenCascade (correct, slower). The decimal then goes through its
// matrix in doubles, then to float32 once, as every app shape's corner does. An unmoved operand keeps its float32 bits exactly. (A fixed
// grid, e.g. multiples of 2^-16, was tried first: it aligned the moved cases but pulled the Pi lid's z 2.998 features onto each other and
// Manifold's result was no longer closed.)
const PINCH_TOLERANCE = 1e-5; // mm: simplify() merges the zero-area pinches where flush faces meet edges
const DECIMAL_TOLERANCE = 1e-4; // mm: the most decimalOf() may move a corner
function decimalOf(f) {
  if (f === 0 || !Number.isFinite(f)) return f;
  for (let p = 6; p <= 7; p++) { const d = +f.toPrecision(p); if (Math.fround(d) === f && Math.abs(d - f) <= DECIMAL_TOLERANCE) return d; }
  return f;
}

function newManifold(V, I) {
  const build = (tris) => {
    const mesh = new M.Mesh({ numProp: 3, vertProperties: V, triVerts: tris });
    mesh.merge();
    let mf;
    try { mf = new M.Manifold(mesh); } catch (e) { lastReason = String((e && e.message) || e); return null; } // "Not manifold": an open mesh, an edge shared by more than two triangles
    if (mf.status() !== "NoError" || mf.isEmpty()) { lastReason = "input status " + mf.status(); mf.delete(); return null; }
    return mf;
  };
  let mf = build(I);
  if (mf && mf.volume() < 0) { // inside out: reverse the winding, as solidFromMesh does
    mf.delete();
    const J = Uint32Array.from(I);
    for (let i = 0; i < J.length; i += 3) { const t = J[i + 1]; J[i + 1] = J[i + 2]; J[i + 2] = t; }
    mf = build(J);
    if (mf && !(mf.volume() > 0)) { mf.delete(); mf = null; }
  }
  return mf;
}
function place(P, m, count) { // positions through the matrix m, stored as float32 (float32 input goes through decimalOf first when it is moved)
  const out = new Float32Array(count * 3);
  if (isIdentity(m)) { for (let i = 0; i < out.length; i++) out[i] = P[i]; return out; }
  const clean = P instanceof Float32Array ? decimalOf : (x) => x;
  for (let i = 0; i < out.length; i += 3) {
    const x = clean(P[i]), y = clean(P[i + 1]), z = clean(P[i + 2]);
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}
// an imported mesh asset, scaled by its k, centred on X/Y and resting on Z 0 (placeImported), then placed by m
function fromAsset(node, m) {
  const u8 = D.assetBytes(node);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const head = new Uint32Array(buf, 0, 2), nv = head[0], nt = head[1];
  const V = new Float32Array(buf, 8, nv * 3), I = new Uint32Array(buf, 8 + nv * 12, nt * 3);
  const k = node.k || 1, P = new Float64Array(nv * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv * 3; i++) { const c = i % 3; P[i] = decimalOf(V[i]) * k; if (P[i] < lo[c]) lo[c] = P[i]; if (P[i] > hi[c]) hi[c] = P[i]; }
  if (!node.keepPos && nv) {
    const d = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
    for (let i = 0; i < nv * 3; i++) P[i] += d[i % 3];
  }
  return newManifold(place(P, m, nv), Uint32Array.from(I));
}
// a B-rep shape (an app box, cylinder, extrude ...) as a mesh at the display detail, then placed by m
function fromShape(node, m, q) {
  const shape = D.evalNode(node);
  try {
    const bb = shape.boundingBox, diag = Math.hypot(...[0, 1, 2].map((i) => bb.bounds[1][i] - bb.bounds[0][i])) || 1;
    bb.delete();
    const tol = Math.max(0.005, diag * 0.0006 / q); // meshShape's own tolerances
    const r = shape.mesh({ tolerance: tol, angularTolerance: 0.2 / q });
    if (!r.triangles.length) return null;
    return newManifold(place(r.vertices, m, r.vertices.length / 3), Uint32Array.from(r.triangles));
  } finally { shape.delete(); }
}

const keyOf = (node, q, m) => D.stableKey(node) + (isBareMesh(node) ? "" : "#q" + q) + (isIdentity(m) ? "" : "@" + m.map((v) => +v.toFixed(12)).join(","));

// the node placed by m, as a cache entry, or null when Manifold cannot take it
function operand(node, m, q) {
  const kd = kind(node);
  if (kd && !isBareMesh(node) && isIdentity(m)) return repr(node, q); // Manifold's own result, already cached
  const key = keyOf(node, q, m);
  const hit = get(key);
  if (hit) return hit.fail ? null : hit;
  let mf = null;
  try {
    if (kd === 0) mf = fromShape(node, m, q);
    else if (isBareMesh(node)) mf = fromAsset(node, m);
    else { // a Manifold result moved by m: rebuilt from its corners through the same placement as every other operand
      const e = repr(node, q);
      if (e) { const g = e.mf.getMesh(), np = g.numProp, P = new Float32Array((g.vertProperties.length / np) * 3); for (let i = 0; i < P.length / 3; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] = g.vertProperties[i * np + c]; mf = newManifold(place(P, m, P.length / 3), Uint32Array.from(g.triVerts)); }
    }
  } catch (e) { lastReason = String((e && e.message) || e); mf = null; }
  const entry = mf ? { mf } : null;
  put(key, entry || { fail: true });
  return entry;
}

// the node itself (kind 1 or 2) in its own frame, or null
function repr(node, q) {
  const key = keyOf(node, q, null) + "#repr";
  const hit = get(key);
  if (hit) return hit.fail ? null : hit;
  let entry = null;
  try { entry = compute(node, q); } catch (e) { lastReason = String((e && e.message) || e); entry = null; }
  put(key, entry || { fail: true });
  return entry;
}

function compute(node, q) {
  const mods = node.mods || [];
  if (mods.length) {
    const last = mods[mods.length - 1], prefix = { ...node, mods: mods.slice(0, -1) };
    const P = operand(prefix, null, q);
    if (!P) return null;
    if (last.t === "bool") {
      const tool = operand(last.tool, last.m, q);
      if (!tool) return null;
      const r = last.op === "cut" ? P.mf.subtract(tool.mf) : last.op === "intersect" ? P.mf.intersect(tool.mf) : P.mf.add(tool.mf);
      return finish(tmp(r));
    }
    if (last.t === "scale") { // x' = k * x + o in the body's own frame
      const k = last.k, o = last.o, s = tmp(P.mf.scale({ x: k[0], y: k[1], z: k[2] }));
      return { mf: s.translate({ x: o[0], y: o[1], z: o[2] }) };
    }
    return keepPiece(P.mf, last);
  }
  if (node.t === "placed") { // another body, where it sits
    const e = operand(node.src, node.srcM, q);
    return e ? { mf: e.mf.translate({ x: 0, y: 0, z: 0 }) } : null;
  }
  return groupOp(node, q);
}

// buildGroup's rules: solids fused one by one, then the holes cut (an intersect group needs two solids)
function groupOp(node, q) {
  const kids = node.children || [];
  if (node.t !== "group" || !kids.length) return null;
  const solids = [], holes = [];
  for (const k of kids) {
    const e = operand(k.node, k.m, q);
    if (!e) return null;
    (k.hole ? holes : solids).push(e.mf);
  }
  let base;
  if (node.op === "intersect") {
    if (solids.length < 2) return null;
    base = solids[0];
    for (let i = 1; i < solids.length; i++) base = tmp(base.intersect(solids[i]));
  } else {
    const list = solids.length ? solids : holes.splice(0); // a group made only of holes stays a hole
    base = list[0];
    for (let i = 1; i < list.length; i++) base = tmp(base.add(list[i]));
  }
  for (const h of holes) base = tmp(base.subtract(h));
  return finish(base);
}

// ---------------------------------------------------------------- pieces
// A piece is a solid: its outer shell plus the cavities inside it. decompose() returns every closed shell on its own, and the enclosed
// void of a hollow body comes back as a shell of NEGATIVE volume; counting it as a piece would split a hollow cube into "1000" and "-512".
// A cavity belongs to the smallest outer shell that contains it (a point-in-solid test, ray casting on that shell's triangles); a floating
// island inside a cavity is an outer shell of its own, and a cavity inside the island goes with the island (it is the smaller container).
// A shell of negative volume that nothing contains stays a piece of its own (finish() then drops it if it is a film). Films are judged on whole
// solids, never on a cavity: a 0.0005 mm thick enclosed void is real and must not be filled.
function insideShell(point, g) { // is the point inside the closed shell mesh g? (ray parity along an awkward direction, so no edge or corner is hit exactly)
  const P = g.vertProperties, np = g.numProp, T = g.triVerts, d = [0.5773502691, 0.3141592653, 0.7591234567];
  let hits = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * np, b = T[t + 1] * np, c = T[t + 2] * np;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-14) continue;
    const s = [point[0] - P[a], point[1] - P[a + 1], point[2] - P[a + 2]], u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
  }
  return hits % 2 === 1;
}
// Several solids as one Manifold, by joining their triangles. (Manifold.compose drops a lone shell of negative volume, which is what a cavity is.)
function joinSolids(list) {
  if (list.length === 1) return list[0].translate({ x: 0, y: 0, z: 0 });
  const gs = list.map((p) => p.getMesh()), V = new Float32Array(gs.reduce((n, g) => n + (g.vertProperties.length / g.numProp) * 3, 0)), T = new Uint32Array(gs.reduce((n, g) => n + g.triVerts.length, 0));
  let vo = 0, to = 0;
  for (const g of gs) {
    const np = g.numProp, nv = g.vertProperties.length / np;
    for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) V[vo + i * 3 + c] = g.vertProperties[i * np + c];
    for (let i = 0; i < g.triVerts.length; i++) T[to + i] = g.triVerts[i] + vo / 3;
    vo += nv * 3; to += g.triVerts.length;
  }
  const mf = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: V, triVerts: T }));
  if (mf.status() !== "NoError") { const why = mf.status(); mf.delete(); throw new Error("pieces joined: " + why); }
  return mf;
}
// shells (decompose() results; consumed: they are deleted here) -> solids (outer shell composed with its cavities)
function solidsFromShells(shells) {
  const info = shells.map((p) => { const b = p.boundingBox(); return { p, lo: b.min, hi: b.max, vol: p.volume(), area: p.surfaceArea() }; });
  const isCavity = (x) => x.vol < 0; // however thin: a real thin cavity is part of its solid (film filtering comes later and judges the solid, not its cavities)
  const outers = info.filter((x) => !isCavity(x)), cavities = info.filter(isCavity);
  const parent = new Map(), meshes = new Map();
  for (const c of cavities) {
    const g = c.p.getMesh(), at = [g.vertProperties[0], g.vertProperties[1], g.vertProperties[2]];
    const inside = (o) => [0, 1, 2].every((i) => o.lo[i] <= c.lo[i] + 1e-9 && o.hi[i] >= c.hi[i] - 1e-9) && (meshes.has(o) || meshes.set(o, o.p.getMesh()), insideShell(at, meshes.get(o)));
    const holder = outers.filter(inside).sort((x, y) => x.vol - y.vol)[0];
    if (holder) parent.set(c, holder);
  }
  const solids = [];
  for (const o of outers) {
    const mine = cavities.filter((c) => parent.get(c) === o);
    solids.push(joinSolids([o.p, ...mine.map((c) => c.p)]));
  }
  for (const c of cavities) if (!parent.has(c)) solids.push(c.p.translate({ x: 0, y: 0, z: 0 })); // nothing contains it: a piece of its own
  info.forEach((x) => x.p.delete());
  return solids;
}
// the separate solids of a Manifold, in solidPieces' order (centre quantized to 0.01 mm: z, y, x; then the bounds). The caller deletes them.
function sortedPieces(mf) {
  const keyed = solidsFromShells(mf.decompose()).map((p) => {
    const b = p.boundingBox(), lo = b.min, hi = b.max;
    return { p, key: [...[2, 1, 0].map((i) => Math.round((lo[i] + hi[i]) / 2 / 0.01)), ...lo, ...hi] };
  });
  keyed.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]; return 0; });
  return keyed.map((x) => x.p);
}
const measure = (p) => ({ vol: Math.abs(p.volume()), area: p.surfaceArea() });
const pieceMeta = (count, sizes) => (count > 1 && count <= 256 ? { count, volumes: sizes.map((s) => s.vol), areas: sizes.map((s) => s.area) } : { count });
function metaOf(entry) {
  if (entry.meta) return entry.meta;
  const pieces = sortedPieces(entry.mf);
  try { return (entry.meta = pieceMeta(pieces.length, pieces.length > 1 && pieces.length <= 256 ? pieces.map(measure) : [])); }
  finally { pieces.forEach((p) => p.delete()); }
}

// keeppiece, as applyMod does it. A count that no longer fits is left to OpenCascade, which words the error.
function keepPiece(mf, mod) {
  const pieces = sortedPieces(mf);
  try {
    if (mod.sole && pieces.length !== mod.count) { // the rest were near-empty films: keep the significant solids, whatever the count is now
      let keep = pieces.filter((p) => { const s = measure(p); return !D.isNearEmpty(s.vol, s.area); });
      if (!keep.length) keep = pieces;
      return { mf: joinSolids(keep) };
    }
    if (pieces.length !== mod.count || !Number.isInteger(mod.piece) || mod.piece < 0 || mod.piece >= pieces.length) return null;
    return { mf: pieces[mod.piece].translate({ x: 0, y: 0, z: 0 }) };
  } finally { pieces.forEach((p) => p.delete()); }
}

// ---------------------------------------------------------------- the result of a boolean, checked
// Open and non-manifold edges counted by position: two vertices at one place that Manifold keeps apart (a pinch where a flush face meets
// an edge) leave edges that are fine by index and open by position.
function closedByPosition(g) {
  const P = g.vertProperties, np = g.numProp, T = g.triVerts, nv = P.length / np;
  const canon = new Int32Array(nv), seen = new Map();
  for (let v = 0; v < nv; v++) {
    const k = P[v * np] + "," + P[v * np + 1] + "," + P[v * np + 2];
    const c = seen.get(k);
    if (c === undefined) { seen.set(k, v); canon[v] = v; } else canon[v] = c;
  }
  const count = new Map();
  for (let t = 0; t < T.length; t += 3) for (let i = 0; i < 3; i++) {
    const a = canon[T[t + i]], b = canon[T[t + (i + 1) % 3]];
    if (a === b) continue;
    const k = a < b ? a * nv + b : b * nv + a;
    count.set(k, (count.get(k) || 0) + 1);
  }
  for (const n of count.values()) if (n !== 2) return false;
  return true;
}
// simplify (merges the pinches), then: status, closed by position, and the near-empty films a cut leaves dropped (the pieces.js rule)
function finish(raw) {
  const mf = raw.simplify(PINCH_TOLERANCE);
  if (mf.status() !== "NoError") { lastReason = "result status " + mf.status(); mf.delete(); return null; }
  if (mf.isEmpty()) return { mf };
  if (!closedByPosition(mf.getMesh())) { lastReason = "result open or non-manifold by position"; mf.delete(); return null; }
  const pieces = sortedPieces(mf);
  try {
    if (pieces.length === 1) return { mf, meta: { count: 1 } };
    const sizes = pieces.map(measure), keepIdx = pieces.map((p, i) => i).filter((i) => !D.isNearEmpty(sizes[i].vol, sizes[i].area));
    if (keepIdx.length === pieces.length || !keepIdx.length) return { mf, meta: pieceMeta(pieces.length, sizes) };
    const r = joinSolids(keepIdx.map((i) => pieces[i]));
    mf.delete();
    return { mf: r, meta: pieceMeta(keepIdx.length, keepIdx.map((i) => sizes[i])) };
  } finally { pieces.forEach((p) => p.delete()); }
}

// ---------------------------------------------------------------- the entry points kernel.js uses
const resultFor = (node, q) => repr(node, q);

// Which route built a body, for the perf panel and the tests (mesh.meshEngine). meshBody says "manifold" itself; for a body Manifold did not
// draw, engineOf tells whether the Manifold result under its last B-rep mods served the B-rep ("manifold-brep") or OpenCascade did
// everything ("occt-fallback"); undefined when no imported mesh boolean is involved. Only the top level counts: a child on Manifold under a
// refused top level is still a fallback.
const served = new Set(); // keys of B-reps meshBrep handed out (also when the kernel cache had them)
export function engineOf(node) {
  const mods = node.mods || [];
  for (let i = mods.length; i >= 0; i--) {
    const sub = i === mods.length ? node : { ...node, mods: mods.slice(0, i) };
    if (kind(sub) !== 2) continue;
    return i < mods.length && usable() && served.has(D.stableKey(sub) + "#q" + lastQuality + "#brep") ? "manifold-brep" : "occt-fallback";
  }
  return undefined;
}

// buildBodies: the display mesh of a meshy body, or null (today's OpenCascade path runs). Throws "Nothing is left" for an empty result.
// An engine call that aborts (anything but the empty result) is a refusal too.
export function meshBody(node, q = 1) {
  if (!usable() || !isMeshy(node)) return null;
  return guarded(() => {
    let mesh = null, empty = false;
    try {
      const e = resultFor(node, q);
      if (!e) return null;
      if (e.mf.isEmpty()) empty = true;
      else { mesh = displayFromManifold(e.mf, metaOf(e)); mesh.meshEngine = "manifold"; }
    } catch (x) { lastReason = String((x && x.message) || x); return null; }
    if (empty) throw new Error(D.nothingLeft);
    return mesh;
  });
}

// the first three columns of a MeshGL's vertex properties, as a Float32Array
const corners = (g) => {
  const np = g.numProp, P = g.vertProperties;
  if (np === 3) return P;
  const V = new Float32Array((P.length / np) * 3);
  for (let i = 0; i < V.length / 3; i++) for (let c = 0; c < 3; c++) V[i * 3 + c] = P[i * np + c];
  return V;
};

// evalNode: the B-rep of a meshy node, built from its Manifold (like an import: one face per triangle, coplanar faces merged), or null
export function meshBrep(node) {
  if (!usable() || !isMeshy(node)) return null;
  return guarded(() => {
    const key = D.stableKey(node) + "#q" + lastQuality + "#brep";
    const hit = D.cacheGet(key);
    if (hit) { served.add(key); return hit; }
    let shape;
    try {
      const e = resultFor(node, lastQuality);
      if (!e || e.mf.isEmpty()) return null;
      const g = e.mf.getMesh();
      const pieces = sortedPieces(e.mf); // solidFromMesh makes one solid from one shell (a solid with cavities: all its shells); a result in several pieces gets one solid each
      try {
        if (pieces.length < 2) shape = D.solidFromMesh(corners(g), g.triVerts);
        else shape = D.makeCompound(pieces.map((p) => { const pg = p.getMesh(); return D.solidFromMesh(corners(pg), pg.triVerts); }));
      } finally { pieces.forEach((p) => p.delete()); }
    } catch (x) { lastReason = String((x && x.message) || x); served.delete(key); return null; }
    D.cachePut(key, shape);
    if (served.size > 400) served.clear();
    served.add(key);
    return shape;
  });
}

// ---------------------------------------------------------------- display mesh (the fields meshShape returns)
// Faces are Manifold's coplanar face groups, flat shaded (one set of corners per triangle); an edge is drawn between two faces whose
// normals differ by more than 25 degrees (the dense-body rule of meshShape). The order of triangles and faces is made canonical (by
// position), because the order Manifold returns them in depends on the engine's history: building the same body twice must give the same bytes.
function displayFromManifold(mf, meta) {
  const g = mf.getMesh(), P = g.vertProperties, np = g.numProp, T = g.triVerts, nt = T.length / 3;
  const runIndex = g.runIndex && g.runIndex.length ? g.runIndex : [0, T.length];
  const run = new Uint32Array(nt);
  for (let r = 0; r + 1 < runIndex.length; r++) for (let t = runIndex[r] / 3; t < runIndex[r + 1] / 3; t++) run[t] = r;
  const faceKey = (t) => (g.faceID && g.faceID.length ? run[t] * 0x1000000 + g.faceID[t] : t);
  // each triangle's corners, rotated so the smallest (x, then y, then z) comes first; winding is kept
  const C = new Float32Array(nt * 9), V0 = new Uint32Array(nt * 3); // V0: the vertex index behind each rotated corner
  const less = (a, b) => { for (let c = 0; c < 3; c++) if (P[a * np + c] !== P[b * np + c]) return P[a * np + c] < P[b * np + c]; return false; };
  for (let t = 0; t < nt; t++) {
    let r = 0;
    for (let i = 1; i < 3; i++) if (less(T[t * 3 + i], T[t * 3 + r])) r = i;
    for (let i = 0; i < 3; i++) { const v = T[t * 3 + (r + i) % 3]; V0[t * 3 + i] = v; for (let c = 0; c < 3; c++) C[t * 9 + i * 3 + c] = P[v * np + c]; }
  }
  const ranked = Array.from({ length: nt }, (_, t) => t).sort((a, b) => { for (let i = 0; i < 9; i++) if (C[a * 9 + i] !== C[b * 9 + i]) return C[a * 9 + i] - C[b * 9 + i]; return a - b; });
  const faceNo = new Map(), members = [];
  for (const t of ranked) { const k = faceKey(t); let f = faceNo.get(k); if (f === undefined) { f = members.length; faceNo.set(k, f); members.push([]); } members[f].push(t); }
  const order = members.flat();
  const vertices = new Float32Array(nt * 9), normals = new Float32Array(nt * 9), triangles = new Uint32Array(nt * 3);
  const faceGroups = [], acc = [], faceOfTri = new Int32Array(nt);
  let k = 0;
  members.forEach((list, f) => {
    faceGroups.push([k * 3, list.length * 3]); acc.push({ n: [0, 0, 0], c: [0, 0, 0], A: 0 });
    const a = acc[f];
    for (const t of list) {
      faceOfTri[t] = f;
      const o = t * 9, ux = C[o + 3] - C[o], uy = C[o + 4] - C[o + 1], uz = C[o + 5] - C[o + 2], vx = C[o + 6] - C[o], vy = C[o + 7] - C[o + 1], vz = C[o + 8] - C[o + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], L = Math.hypot(n[0], n[1], n[2]) || 1;
      a.A += L / 2;
      for (let c = 0; c < 3; c++) { a.n[c] += n[c]; a.c[c] += (L / 2) * (C[o + c] + C[o + 3 + c] + C[o + 6 + c]) / 3; }
      for (let i = 0; i < 3; i++) {
        triangles[k * 3 + i] = k * 3 + i;
        for (let c = 0; c < 3; c++) { vertices[(k * 3 + i) * 3 + c] = C[o + i * 3 + c]; normals[(k * 3 + i) * 3 + c] = n[c] / L; }
      }
      k++;
    }
  });
  const faceInfo = acc.map((a) => { const L = Math.hypot(a.n[0], a.n[1], a.n[2]) || 1; return { t: "PLANE", n: a.n.map((x) => x / L), c: a.c.map((x) => x / (a.A || 1)) }; });
  // edges: a triangle edge between two different faces, drawn when the crease is sharper than 25 degrees
  const nv = P.length / np, half = new Map(), lines = [], edgeGroups = [], edgeInfo = [], faceEdges = faceInfo.map(() => []);
  const cos25 = Math.cos((25 * Math.PI) / 180);
  for (const t of order) for (let i = 0; i < 3; i++) {
    const a = V0[t * 3 + i], b = V0[t * 3 + (i + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
    const o = half.get(key);
    if (o === undefined) { half.set(key, t); continue; }
    const fa = faceOfTri[o], fb = faceOfTri[t];
    if (fa === fb) continue;
    const na = faceInfo[fa].n, nb = faceInfo[fb].n;
    if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] > cos25) continue;
    const A = [P[a * np], P[a * np + 1], P[a * np + 2]], B = [P[b * np], P[b * np + 1], P[b * np + 2]];
    const ei = edgeInfo.length;
    edgeGroups.push([lines.length / 3, 2]);
    lines.push(...A, ...B);
    edgeInfo.push({ a: A, b: B, m: A.map((x, c) => (x + B[c]) / 2), t: "LINE" });
    faceEdges[fa].push(ei); faceEdges[fb].push(ei);
  }
  const bb = mf.boundingBox(), size = [0, 1, 2].map((i) => bb.max[i] - bb.min[i]);
  for (const e of edgeInfo) e.n = e.m.map((v, i) => (size[i] > 1e-9 ? (v - bb.min[i]) / size[i] : 0.5)); // as edgeSig does
  const mesh = {
    vertices, normals, triangles, faceGroups, faceInfo,
    lines: new Float32Array(lines), edgeGroups, edgeInfo, faceEdges,
    bbox: { min: [...bb.min], max: [...bb.max] },
    volume: mf.volume(),
    solidCount: meta.count, hasNonSolidFaces: false,
  };
  if (meta.volumes) { mesh.solidVolumes = meta.volumes; mesh.solidAreas = meta.areas; }
  return mesh;
}
