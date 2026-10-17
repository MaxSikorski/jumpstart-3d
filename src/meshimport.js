// Reading mesh files for import (STL and 3MF): parse, repair (weld shared corners, drop
// duplicates, make every triangle face outwards), simplify very dense meshes while keeping
// their shape, and pack them for the geometry worker ("assets": see kernel.js).
import { inflate } from "./inflate.js";

export const MESH_LIMIT = 20000; // triangles kept for editing (more makes the engine crawl)

// ------------------------------------------------------------------ STL
// raw triangle corners (9 numbers per triangle), in the file's units
export function stlPositions(buffer) {
  const isBinary = (() => {
    if (buffer.byteLength < 84) return false;
    const n = new DataView(buffer).getUint32(80, true);
    if (buffer.byteLength === 84 + n * 50) return true;
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength)));
    return !/^\s*solid/i.test(head) || !/facet/i.test(new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength))));
  })();
  let pos;
  if (isBinary) {
    const dv = new DataView(buffer), n = dv.getUint32(80, true);
    if (84 + n * 50 > buffer.byteLength) throw new Error("This STL file looks damaged (it ends early).");
    pos = new Float32Array(n * 9);
    let o = 84;
    for (let i = 0; i < n; i++) { o += 12; for (let k = 0; k < 9; k++) { pos[i * 9 + k] = dv.getFloat32(o, true); o += 4; } o += 2; }
  } else {
    const text = new TextDecoder().decode(buffer);
    const num = "([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)";
    const re = new RegExp("vertex\\s+" + num + "\\s+" + num + "\\s+" + num, "g");
    const out = [];
    let m;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    pos = new Float32Array(out.length - (out.length % 9));
    pos.set(out.slice(0, pos.length));
  }
  for (let i = 0; i < pos.length; i++) if (!isFinite(pos[i])) throw new Error("This STL file has broken numbers in it.");
  if (!pos.length) throw new Error("This STL file has no triangles.");
  return pos;
}
export function parseSTL(buffer) { return repairMesh(stlPositions(buffer)).mesh; }

// ------------------------------------------------------------------ 3MF
// A 3MF file is a zip with an XML model inside: objects (meshes or groups of other
// objects), placed by the build items, with the units written in the file.
const inflateRaw = inflate;
function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("This 3MF file looks damaged (its zip directory is missing).");
  const n = dv.getUint16(e + 10, true);
  let off = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let k = 0; k < n; k++) {
    if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nl)).replace(/^\/+/, "");
    entries.set(name.toLowerCase(), { name, method, csize, lho });
    off += 46 + nl + xl + cl;
  }
  return {
    names: () => [...entries.values()].map((x) => x.name),
    async get(name) {
      const ent = entries.get(name.replace(/^\/+/, "").toLowerCase());
      if (!ent) throw new Error("This 3MF file is missing a part: " + name);
      const l = ent.lho;
      const start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
      const data = u8.subarray(start, start + ent.csize);
      if (ent.method === 0) return data;
      if (ent.method === 8) return inflateRaw(data);
      throw new Error("This 3MF file uses a kind of compression that isn't supported.");
    },
  };
}
function attrs(s) {
  const o = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}
const ID12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseTransform(s) {
  if (!s) return ID12;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(isFinite) ? v : ID12;
}
// 3MF matrices act on row vectors (p' = p M); "first A, then B" is A * B
function composeT(A, B) {
  const a = (r, c) => (c < 3 ? A[r * 3 + c] : r === 3 ? 1 : 0);
  const b = (r, c) => (c < 3 ? B[r * 3 + c] : r === 3 ? 1 : 0);
  const out = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a(r, k) * b(k, c); out.push(s); }
  return out;
}
const pathOf = (a) => a["p:path"] || Object.keys(a).filter((k) => /:path$/.test(k)).map((k) => a[k])[0];
function parseModelXML(text) {
  const unitM = text.match(/<(?:\w+:)?model\b[^>]*\bunit\s*=\s*"([^"]+)"/);
  const objects = new Map();
  const objRe = /<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g;
  let m;
  while ((m = objRe.exec(text))) {
    const at = attrs(m[1]), body = m[2];
    const ob = { type: at.type || "model", mesh: null, components: [] };
    if (/<(?:\w+:)?mesh\b/.test(body)) {
      const V = [], T = [];
      const vr = /<(?:\w+:)?vertex\b([^>]*?)\/?>/g;
      let v;
      while ((v = vr.exec(body))) { const a = attrs(v[1]); V.push(+a.x, +a.y, +a.z); }
      const tr = /<(?:\w+:)?triangle\b([^>]*?)\/?>/g;
      while ((v = tr.exec(body))) { const a = attrs(v[1]); T.push(a.v1 | 0, a.v2 | 0, a.v3 | 0); }
      ob.mesh = { V, T };
    }
    const cr = /<(?:\w+:)?component\b([^>]*?)\/?>/g;
    let c;
    while ((c = cr.exec(body))) { const a = attrs(c[1]); ob.components.push({ id: a.objectid, T: parseTransform(a.transform), path: pathOf(a) }); }
    objects.set(at.id, ob);
  }
  const items = [];
  const build = text.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/);
  if (build) {
    const ir = /<(?:\w+:)?item\b([^>]*?)\/?>/g;
    let it;
    while ((it = ir.exec(build[1]))) { const a = attrs(it[1]); items.push({ id: a.objectid, T: parseTransform(a.transform), path: pathOf(a) }); }
  }
  return { unit: unitM ? unitM[1] : "millimeter", objects, items };
}
// millimetres per file unit
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 };
export const isZip = (u8) => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;
// -> { pos (mm, 9 per triangle), unit (file's unit name), parts }
export async function parse3MF(buf) {
  const z = readZip(buf);
  const dec = new TextDecoder();
  let root = "3D/3dmodel.model";
  try {
    const rels = dec.decode(await z.get("_rels/.rels"));
    const rel = [...rels.matchAll(/<Relationship\b([^>]*)>/g)].map((x) => attrs(x[1])).find((a) => /3dmodel$/i.test(a.Type || ""));
    if (rel && rel.Target) root = rel.Target.replace(/^\/+/, "");
  } catch (e) { /* use the usual place */ }
  const cache = new Map();
  const getModel = async (path) => {
    const key = path.replace(/^\/+/, "");
    if (!cache.has(key)) cache.set(key, parseModelXML(dec.decode(await z.get(key))));
    return cache.get(key);
  };
  const rootM = await getModel(root);
  const out = [];
  let parts = 0;
  const emit = async (path, id, T, depth) => {
    if (depth > 32) return;
    const mdl = await getModel(path);
    const ob = mdl.objects.get(id);
    if (!ob || ob.type === "support" || ob.type === "other") return;
    if (ob.mesh) {
      parts++;
      const { V, T: Tr } = ob.mesh;
      const nv = V.length / 3;
      for (let t = 0; t + 2 < Tr.length; t += 3) {
        if (![Tr[t], Tr[t + 1], Tr[t + 2]].every((k) => k >= 0 && k < nv)) continue;
        for (let j = 0; j < 3; j++) {
          const k = Tr[t + j], x = V[k * 3], y = V[k * 3 + 1], zz = V[k * 3 + 2];
          out.push(x * T[0] + y * T[3] + zz * T[6] + T[9], x * T[1] + y * T[4] + zz * T[7] + T[10], x * T[2] + y * T[5] + zz * T[8] + T[11]);
        }
      }
    }
    for (const c of ob.components) await emit(c.path || path, c.id, composeT(c.T, T), depth + 1);
  };
  if (rootM.items.length) for (const it of rootM.items) await emit(it.path || root, it.id, it.T, 0);
  else for (const id of rootM.objects.keys()) await emit(root, id, ID12, 0);
  const k = UNIT_MM[rootM.unit] || 1;
  const pos = new Float64Array(out.length - (out.length % 9));
  for (let i = 0; i < pos.length; i++) pos[i] = out[i] * k;
  if (!pos.length) throw new Error("This 3MF file has no triangles to import.");
  return { pos, unit: UNIT_MM[rootM.unit] ? rootM.unit : "millimeter", parts };
}

// ------------------------------------------------------------------ any mesh file
// -> { mesh, report, format, unitFromFile (true for 3MF: positions already in mm), parts }
export async function readMeshFile(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (isZip(bytes)) {
    const r = await parse3MF(buf);
    const { mesh, report } = repairMesh(r.pos);
    return { mesh, report, format: "3MF", unitFromFile: r.unit, parts: r.parts };
  }
  const { mesh, report } = repairMesh(stlPositions(buf));
  return { mesh, report, format: "STL", unitFromFile: null, parts: 1 };
}

// ------------------------------------------------------------------ repair
function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max, diag: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1 };
}
// join corners closer than `tol` (a true distance check across neighbouring grid cells)
function weldPoints(P, tol) {
  const n = P.length / 3, cell = Math.max(tol, 1e-12) * 2;
  const grid = new Map();
  const V = [], remap = new Uint32Array(n), tol2 = tol * tol;
  const key = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      const list = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const j of list) { const ex = V[j * 3] - x, ey = V[j * 3 + 1] - y, ez = V[j * 3 + 2] - z; if (ex * ex + ey * ey + ez * ez <= tol2) { found = j; break; } }
    }
    if (found < 0) {
      found = V.length / 3;
      V.push(x, y, z);
      const k = key(cx, cy, cz);
      const list = grid.get(k);
      if (list) list.push(found); else grid.set(k, [found]);
    }
    remap[i] = found;
  }
  return { V: new Float64Array(V), remap };
}
function edgeCounts(I, nv) {
  const m = new Map();
  for (let t = 0; t < I.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = I[t + j], b = I[t + (j + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
    m.set(k, (m.get(k) || 0) + 1);
  }
  let open = 0, nonManifold = 0;
  for (const c of m.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { open, nonManifold };
}
// triangles from corners, dropping collapsed ones and exact duplicates
function buildTris(remap, nCorners) {
  const out = [], seen = new Set();
  let dupes = 0, degenerate = 0;
  for (let t = 0; t < nCorners; t += 3) {
    const a = remap[t], b = remap[t + 1], c = remap[t + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const s = [a, b, c].sort((p, q) => p - q).join(",");
    if (seen.has(s)) { dupes++; continue; }
    seen.add(s);
    out.push(a, b, c);
  }
  return { I: new Uint32Array(out), dupes, degenerate };
}
// every triangle wound the same way as its neighbours, and each piece facing outwards
function orient(V, I) {
  const nt = I.length / 3, nv = V.length / 3;
  const edgeTris = new Map();
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
    const a = I[t * 3 + j], b = I[t * 3 + (j + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
    const l = edgeTris.get(k);
    if (l) l.push(t); else edgeTris.set(k, [t]);
  }
  const hasDirected = (t, a, b) => { for (let j = 0; j < 3; j++) if (I[t * 3 + j] === a && I[t * 3 + (j + 1) % 3] === b) return true; return false; };
  const flip = (t) => { const x = I[t * 3 + 1]; I[t * 3 + 1] = I[t * 3 + 2]; I[t * 3 + 2] = x; };
  const comp = new Int32Array(nt).fill(-1);
  let flipped = 0, pieces = 0;
  for (let s = 0; s < nt; s++) {
    if (comp[s] >= 0) continue;
    const id = pieces++;
    const stack = [s], members = [];
    comp[s] = id;
    while (stack.length) {
      const t = stack.pop();
      members.push(t);
      for (let j = 0; j < 3; j++) {
        const a = I[t * 3 + j], b = I[t * 3 + (j + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
        const l = edgeTris.get(k);
        if (!l || l.length !== 2) continue; // only walk across clean (two-sided) edges
        const u = l[0] === t ? l[1] : l[0];
        if (comp[u] >= 0) continue;
        // a neighbour shares the edge in the opposite direction when both face the same way
        if (hasDirected(u, a, b)) { flip(u); flipped++; }
        comp[u] = id;
        stack.push(u);
      }
    }
    // inside-out piece: turn it the right way round
    let vol = 0;
    for (const t of members) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      vol += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
    }
    if (vol < 0) for (const t of members) flip(t);
  }
  return { flipped, pieces };
}
// Close small holes (gaps of up to 100 edges, e.g. a few missing triangles) so the model can
// still become a solid. Each hole is fanned from its middle, facing the same way as the
// triangles around it. Needs consistently wound triangles (run after orient).
function fillHoles(V, I) {
  const nv = V.length / 3;
  const count = new Map();
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < I.length; t += 3) for (let j = 0; j < 3; j++) { const k = ek(I[t + j], I[t + (j + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
  // border edges, walked the opposite way to their triangle: next[b] = a for triangle edge a->b
  const next = new Map(), clash = new Set();
  for (let t = 0; t < I.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = I[t + j], b = I[t + (j + 1) % 3];
    if (count.get(ek(a, b)) !== 1) continue;
    if (next.has(b)) clash.add(b); else next.set(b, a);
  }
  const Vout = Array.from(V), Iout = Array.from(I);
  const used = new Set();
  let filled = 0;
  for (const start of next.keys()) {
    if (used.has(start) || clash.has(start)) continue;
    const loop = [start];
    let cur = next.get(start), ok = true;
    while (cur !== start) {
      if (cur === undefined || clash.has(cur) || used.has(cur) || loop.length > 100) { ok = false; break; }
      loop.push(cur);
      cur = next.get(cur);
    }
    loop.forEach((v) => used.add(v));
    if (!ok || loop.length < 3) continue;
    if (loop.length === 3) { Iout.push(loop[0], loop[1], loop[2]); filled++; continue; }
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) { cx += V[v * 3]; cy += V[v * 3 + 1]; cz += V[v * 3 + 2]; }
    const c = Vout.length / 3;
    Vout.push(cx / loop.length, cy / loop.length, cz / loop.length);
    for (let i = 0; i < loop.length; i++) Iout.push(loop[i], loop[(i + 1) % loop.length], c);
    filled++;
  }
  return filled ? { V: new Float64Array(Vout), I: new Uint32Array(Iout), filled } : { V, I, filled: 0 };
}
// raw corners (9 numbers per triangle) -> clean indexed mesh + what was fixed
export function repairMesh(pos) {
  const b = boundsOf(pos);
  const nCorners = pos.length / 3;
  // 1) join corners that are the same point up to rounding in the file
  let tol = b.diag * 1e-6;
  let w = weldPoints(pos, tol);
  let tris = buildTris(w.remap, nCorners);
  let ec = edgeCounts(tris.I, w.V.length / 3);
  // 2) still gaps? some exporters round more coarsely: try a slightly larger tolerance
  if (ec.open > 0) {
    const tol2 = b.diag * 2e-5;
    const w2 = weldPoints(pos, tol2);
    const t2 = buildTris(w2.remap, nCorners);
    const e2 = edgeCounts(t2.I, w2.V.length / 3);
    if (e2.open < ec.open && t2.I.length >= tris.I.length * 0.995) { w = w2; tris = t2; ec = e2; tol = tol2; }
  }
  let V = w.V, I = tris.I;
  const o = orient(V, I);
  // 3) small holes: patch them so the model can still be a closed solid
  let filled = 0;
  if (ec.open > 0) {
    const h = fillHoles(V, I);
    if (h.filled) { V = h.V; I = h.I; filled = h.filled; ec = edgeCounts(I, V.length / 3); }
  }
  return {
    mesh: { V: new Float32Array(V), I },
    report: { corners: nCorners, vertices: V.length / 3, triangles: I.length / 3, dupes: tris.dupes, degenerate: tris.degenerate, flipped: o.flipped, pieces: o.pieces, open: ec.open, nonManifold: ec.nonManifold, filled, weldTol: tol },
  };
}

export function meshBounds({ V }) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { if (V[i + k] < min[k]) min[k] = V[i + k]; if (V[i + k] > max[k]) max[k] = V[i + k]; }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// ------------------------------------------------------------------ simplify
// Quadric edge collapse (Garland & Heckbert): repeatedly merges the pair of corners whose
// merge changes the shape least, so flat faces stay flat and sharp edges stay sharp.
// Returns { mesh, err } where err is roughly the largest distance (in the mesh's units)
// any part of the surface moved.
export function simplify(mesh, limit = MESH_LIMIT) {
  let nt = mesh.I.length / 3;
  if (nt <= limit) return { mesh, err: 0 };
  let pre = 0;
  // enormous files: a quick coarse pass first so the careful pass stays fast
  if (nt > 1200000) { const c = cluster(mesh, 600000); mesh = c.mesh; pre = c.err; nt = mesh.I.length / 3; }
  const r = qem(mesh, limit);
  if (r.mesh.I.length / 3 > limit * 1.15) { const c = cluster(r.mesh, limit); return { mesh: c.mesh, err: Math.max(r.err, c.err) + pre }; }
  return { mesh: r.mesh, err: r.err + pre };
}

function qem(mesh, limit) {
  const nv = mesh.V.length / 3;
  const P = Float64Array.from(mesh.V);
  const T = Int32Array.from(mesh.I);
  const nt = T.length / 3;
  const alive = new Uint8Array(nt).fill(1);
  const dead = new Uint8Array(nv);
  const ver = new Int32Array(nv);
  const vt = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) vt[T[t * 3 + j]].push(t);
  const Q = new Float64Array(nv * 10);
  const addQ = (v, a, b, c, d, w) => { const q = v * 10; Q[q] += w * a * a; Q[q + 1] += w * a * b; Q[q + 2] += w * a * c; Q[q + 3] += w * a * d; Q[q + 4] += w * b * b; Q[q + 5] += w * b * c; Q[q + 6] += w * b * d; Q[q + 7] += w * c * c; Q[q + 8] += w * c * d; Q[q + 9] += w * d * d; };
  const triN = (t, out) => {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const n = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const L = triN(t, n);
    if (!(L > 0)) continue;
    const a = n[0] / L, b = n[1] / L, c = n[2] / L, p = T[t * 3] * 3, d = -(a * P[p] + b * P[p + 1] + c * P[p + 2]);
    for (let j = 0; j < 3; j++) addQ(T[t * 3 + j], a, b, c, d, 1);
  }
  // open borders: a stiff plane along each border edge keeps the outline in place
  const ekey = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const ecount = new Map();
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const k = ekey(T[t * 3 + j], T[t * 3 + (j + 1) % 3]); ecount.set(k, (ecount.get(k) || 0) + 1); }
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
    const a = T[t * 3 + j], b = T[t * 3 + (j + 1) % 3];
    if (ecount.get(ekey(a, b)) !== 1) continue;
    const L = triN(t, n);
    if (!(L > 0)) continue;
    const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
    let px = ey * n[2] - ez * n[1], py = ez * n[0] - ex * n[2], pz = ex * n[1] - ey * n[0];
    const pl = Math.hypot(px, py, pz);
    if (!(pl > 0)) continue;
    px /= pl; py /= pl; pz /= pl;
    const d = -(px * P[a * 3] + py * P[a * 3 + 1] + pz * P[a * 3 + 2]);
    addQ(a, px, py, pz, d, 100); addQ(b, px, py, pz, d, 100);
  }
  ecount.clear();
  const S = new Float64Array(10);
  // best place for the merged corner: the quadric's minimum when it is well defined and
  // near the edge, else the better of the two ends and the middle
  const target = (a, b, out) => {
    for (let i = 0; i < 10; i++) S[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const e = (x, y, z) => S[0] * x * x + 2 * S[1] * x * y + 2 * S[2] * x * z + 2 * S[3] * x + S[4] * y * y + 2 * S[5] * y * z + 2 * S[6] * y + S[7] * z * z + 2 * S[8] * z + S[9];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    let best = Infinity;
    const tryP = (x, y, z) => { const v = e(x, y, z); if (v < best) { best = v; out[0] = x; out[1] = y; out[2] = z; } };
    tryP(ax, ay, az); tryP(bx, by, bz); tryP((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    const a11 = S[0], a12 = S[1], a13 = S[2], a22 = S[4], a23 = S[5], a33 = S[7];
    const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    const scale = Math.abs(a11) + Math.abs(a22) + Math.abs(a33);
    if (Math.abs(det) > 1e-9 * scale * scale * scale) {
      const b1 = -S[3], b2 = -S[6], b3 = -S[8];
      const x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det;
      const y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
      const z = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det;
      const L = Math.hypot(bx - ax, by - ay, bz - az);
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      if (isFinite(x) && Math.hypot(x - mx, y - my, z - mz) <= L) tryP(x, y, z);
    }
    return Math.max(0, best);
  };
  // binary heap of candidate merges (lazy: stale entries are skipped when popped)
  const hc = [], ha = [], hb = [], hva = [], hvb = [];
  const heap = [];
  const less = (i, j) => hc[heap[i]] < hc[heap[j]];
  const swap = (i, j) => { const x = heap[i]; heap[i] = heap[j]; heap[j] = x; };
  const push = (cost, a, b) => {
    const id = hc.length;
    hc.push(cost); ha.push(a); hb.push(b); hva.push(ver[a]); hvb.push(ver[b]);
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && less(l, m)) m = l; if (r < heap.length && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
    }
    return top;
  };
  const tgt = [0, 0, 0];
  const seenE = new Set();
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
    const a = T[t * 3 + j], b = T[t * 3 + (j + 1) % 3], k = ekey(a, b);
    if (seenE.has(k)) continue;
    seenE.add(k);
    push(target(a, b, tgt), Math.min(a, b), Math.max(a, b));
  }
  seenE.clear();
  const liveTris = (v) => { const l = vt[v].filter((t) => alive[t]); vt[v] = l; return l; };
  const others = (v, list) => { const s = new Set(); for (const t of list) for (let j = 0; j < 3; j++) { const u = T[t * 3 + j]; if (u !== v) s.add(u); } return s; };
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  let live = nt, maxErr = 0;
  // would moving corner `v` (of triangle t) to p flip or squash the triangle?
  const bad = (t, v, p) => {
    const L0 = triN(t, n0);
    const q = v * 3;
    const ox = P[q], oy = P[q + 1], oz = P[q + 2];
    P[q] = p[0]; P[q + 1] = p[1]; P[q + 2] = p[2];
    const L1 = triN(t, n1);
    P[q] = ox; P[q + 1] = oy; P[q + 2] = oz;
    if (!(L1 > 1e-12 * (L0 || 1))) return true;
    return (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (L0 * L1) < 0.2;
  };
  while (live > limit && heap.length) {
    const id = pop();
    const a = ha[id], b = hb[id];
    if (dead[a] || dead[b] || hva[id] !== ver[a] || hvb[id] !== ver[b]) continue;
    const ta = liveTris(a), tb = liveTris(b);
    const shared = tb.filter((t) => T[t * 3] === a || T[t * 3 + 1] === a || T[t * 3 + 2] === a);
    if (!shared.length) continue;
    // keep the surface a clean sheet: the two corners may only share the neighbours
    // of the triangles being removed
    const na = others(a, ta), nb = others(b, tb);
    let common = 0;
    for (const u of na) if (u !== b && nb.has(u)) common++;
    if (common !== shared.length) continue;
    const cost = target(a, b, tgt);
    let ok = true;
    for (const t of ta) if (!shared.includes(t) && bad(t, a, tgt)) { ok = false; break; }
    if (ok) for (const t of tb) if (!shared.includes(t) && bad(t, b, tgt)) { ok = false; break; }
    if (!ok) continue;
    // merge b into a
    for (const t of shared) alive[t] = 0;
    live -= shared.length;
    const merged = ta.filter((t) => alive[t]);
    for (const t of tb) if (alive[t]) { for (let j = 0; j < 3; j++) if (T[t * 3 + j] === b) T[t * 3 + j] = a; merged.push(t); }
    vt[a] = merged; vt[b] = [];
    P[a * 3] = tgt[0]; P[a * 3 + 1] = tgt[1]; P[a * 3 + 2] = tgt[2];
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    dead[b] = 1; ver[a]++; ver[b]++;
    if (cost > maxErr) maxErr = cost;
    // only the edges around the merged corner change cost
    for (const u of others(a, merged)) push(target(a, u, tgt), Math.min(a, u), Math.max(a, u));
  }
  // pack the survivors
  const map = new Int32Array(nv).fill(-1), V = [], I = [];
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue;
    for (let j = 0; j < 3; j++) { const v = T[t * 3 + j]; if (map[v] < 0) { map[v] = V.length / 3; V.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } I.push(map[v]); }
  }
  return { mesh: { V: new Float32Array(V), I: new Uint32Array(I) }, err: Math.sqrt(maxErr) };
}

// coarse fallback: snap corners to a grid until the mesh is small enough
function cluster(mesh, limit) {
  const b = meshBounds(mesh);
  const diag = Math.hypot(...b.size) || 1;
  let cell = diag / Math.sqrt(limit) / 1.2;
  for (let round = 0; round < 30; round++) {
    const ids = new Map(), sums = [];
    const remap = new Uint32Array(mesh.V.length / 3);
    for (let i = 0; i < remap.length; i++) {
      const x = mesh.V[i * 3], y = mesh.V[i * 3 + 1], z = mesh.V[i * 3 + 2];
      const key = Math.floor((x - b.min[0]) / cell) + "," + Math.floor((y - b.min[1]) / cell) + "," + Math.floor((z - b.min[2]) / cell);
      let id = ids.get(key);
      if (id === undefined) { id = sums.length; ids.set(key, id); sums.push([0, 0, 0, 0]); }
      const s = sums[id]; s[0] += x; s[1] += y; s[2] += z; s[3]++;
      remap[i] = id;
    }
    const V = new Float32Array(sums.length * 3);
    sums.forEach((s, i) => { V[i * 3] = s[0] / s[3]; V[i * 3 + 1] = s[1] / s[3]; V[i * 3 + 2] = s[2] / s[3]; });
    const seen = new Set(), out = [];
    for (let t = 0; t < mesh.I.length; t += 3) {
      const a = remap[mesh.I[t]], c1 = remap[mesh.I[t + 1]], c2 = remap[mesh.I[t + 2]];
      if (a === c1 || c1 === c2 || a === c2) continue;
      const key = [a, c1, c2].sort((p, q) => p - q).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, c1, c2);
    }
    if (out.length / 3 <= limit) return { mesh: { V, I: new Uint32Array(out) }, err: cell * Math.sqrt(3) / 2 };
    cell *= 1.25;
  }
  throw new Error("This mesh is too detailed to simplify.");
}

// [nv, nt] header + float32 positions + uint32 indices
export function packMesh({ V, I }) {
  const buf = new ArrayBuffer(8 + V.length * 4 + I.length * 4);
  new Uint32Array(buf, 0, 2).set([V.length / 3, I.length / 3]);
  new Float32Array(buf, 8, V.length).set(V);
  new Uint32Array(buf, 8 + V.length * 4, I.length).set(I);
  return new Uint8Array(buf);
}

export function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
// a short id from the content, so the same file imported twice is stored once
export function contentId(u8) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < u8.length; i += Math.max(1, Math.floor(u8.length / 200000))) { h1 = Math.imul(h1 ^ u8[i], 16777619); h2 = Math.imul(h2 + u8[i], 2246822519); }
  return "a" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + u8.length.toString(36);
}
