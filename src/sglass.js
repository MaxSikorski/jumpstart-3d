// Stained glass engine: turns a surface (any object's outside, or a lamp shade) into pieces of
// glass held by a frame (lead came or copper foil), like a Tiffany lamp or a glass statue.
//  1. the surface is welded and made fine enough (triangles split in four)
//  2. it is cut into pieces: Voronoi-like "Tiffany" pieces grown over the surface (they break
//     at sharp creases), or panels, diamonds or bricks around the upright axis
//  3. each piece becomes a thin slab of glass (its outline pulled in a little for the frame)
//  4. the frame is a smooth tube along every border between pieces and along open rims, made
//     as one watertight surface from a distance field (no overlapping parts)
// No three.js here, so it also runs in Node for tests.
import { isoSurface } from "./sdfshell.js";

// ---------------------------------------------------------------- mesh basics
export function weld(soup, tol = 1e-4) {
  const map = new Map(), P = [], T = new Uint32Array(soup.length / 3);
  const q = (x) => Math.round(x / tol);
  for (let i = 0; i < soup.length / 3; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2], k = q(x) + "," + q(y) + "," + q(z);
    let v = map.get(k);
    if (v === undefined) { v = P.length / 3; map.set(k, v); P.push(x, y, z); }
    T[i] = v;
  }
  // drop triangles that collapsed
  const keep = [];
  for (let t = 0; t < T.length; t += 3) if (T[t] !== T[t + 1] && T[t + 1] !== T[t + 2] && T[t] !== T[t + 2]) keep.push(T[t], T[t + 1], T[t + 2]);
  return { P: new Float64Array(P), T: new Uint32Array(keep) };
}
const ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
// split every triangle in four until the edges are short enough (or the budget is reached)
export function refine(m, maxEdge, maxTris = 60000) {
  let { P, T } = m;
  for (let pass = 0; pass < 6; pass++) {
    const nt = T.length / 3;
    if (nt * 4 > maxTris) break;
    let sum = 0;
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e] * 3, b = T[t + ((e + 1) % 3)] * 3; sum += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
    if (sum / (nt * 3) <= maxEdge) break;
    const P2 = Array.from(P), mid = new Map(), T2 = new Uint32Array(T.length * 4);
    const M = (a, b) => { const k = ek(a, b); let v = mid.get(k); if (v === undefined) { v = P2.length / 3; P2.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2); mid.set(k, v); } return v; };
    let o = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2], ab = M(a, b), bc = M(b, c), ca = M(c, a);
      T2.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o); o += 12;
    }
    P = new Float64Array(P2); T = T2;
  }
  return { P, T };
}
// per triangle: centroid, unit normal, area; triangle neighbours across each edge
export function topology(m) {
  const { P, T } = m, nt = T.length / 3;
  const C = new Float64Array(nt * 3), N = new Float64Array(nt * 3), A = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1e-12;
    N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l; A[t] = l / 2;
    for (let i = 0; i < 3; i++) C[t * 3 + i] = (P[a + i] + P[b + i] + P[c + i]) / 3;
  }
  const edge = new Map(), nb = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = T[t * 3 + e], b = T[t * 3 + ((e + 1) % 3)], k = ek(a, b), o = edge.get(k);
    if (o === undefined) edge.set(k, t * 3 + e);
    else if (o >= 0) { nb[t * 3 + e] = (o / 3) | 0; nb[o] = t; edge.set(k, -1); }
  }
  return { C, N, A, nb, nt };
}

// ---------------------------------------------------------------- cutting into pieces
function heapPush(h, d, v) { h.push([d, v]); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h) { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < h.length && h[l][0] < h[s][0]) s = l; if (r < h.length && h[r][0] < h[s][0]) s = r; if (s === i) break; [h[s], h[i]] = [h[i], h[s]]; i = s; } } return top; }
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
// grow regions from seed triangles across the surface; crossing a sharp crease costs more
function grow(topo, seeds, creaseK) {
  const { C, N, nb, nt } = topo, reg = new Int32Array(nt).fill(-1), dist = new Float64Array(nt).fill(Infinity), h = [];
  seeds.forEach((t, i) => { reg[t] = i; dist[t] = 0; heapPush(h, 0, t); });
  while (h.length) {
    const [d, t] = heapPop(h);
    if (d > dist[t]) continue;
    for (let e = 0; e < 3; e++) {
      const u = nb[t * 3 + e]; if (u < 0) continue;
      const dot = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2];
      const w = Math.hypot(C[t * 3] - C[u * 3], C[t * 3 + 1] - C[u * 3 + 1], C[t * 3 + 2] - C[u * 3 + 2]) * (1 + creaseK * Math.max(0, 1 - dot) * 8);
      if (d + w < dist[u]) { dist[u] = d + w; reg[u] = reg[t]; heapPush(h, d + w, u); }
    }
  }
  for (let t = 0; t < nt; t++) if (reg[t] < 0) reg[t] = 0;
  return reg;
}
// the bounding box and the upright axis (for panels and diamonds)
function frame(m) {
  const { P } = m; let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  return { x0, y0, z0, x1, y1, z1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, R: Math.max(x1 - x0, y1 - y0) / 2, H: z1 - z0, D: Math.hypot(x1 - x0, y1 - y0, z1 - z0) };
}
export const PATTERNS = [
  ["tiffany", "Tiffany pieces", "Irregular pieces grown over the surface, like a Tiffany lamp"],
  ["panels", "Panels", "Upright panels in rows around the middle, like a classic lamp shade"],
  ["diamond", "Diamonds", "Diamond pieces winding around the middle"],
  ["bricks", "Bricks", "Rows of pieces, each row shifted half a piece"],
  ["rings", "Rings", "Bands around the middle, cut into a few pieces each"],
];
// region (piece number) for every triangle
export function partition(m, topo, o) {
  const { C, A, nt } = topo, F = frame(m), R = rng(o.seed || 1);
  let reg;
  const n = Math.max(2, Math.round(o.pieces || 120));
  if (o.pattern === "panels" || o.pattern === "diamond" || o.pattern === "bricks" || o.pattern === "rings") {
    // around the upright axis: angle and height
    const area = A.reduce((a, b) => a + b, 0), s = Math.sqrt(area / n); // piece size
    const ring = Math.max(3, Math.round((2 * Math.PI * Math.max(F.R, 1) * 0.8) / s));
    const band = Math.max(1, Math.round(F.H / s));
    reg = new Int32Array(nt);
    const keys = new Map();
    const { P, T } = m;
    for (let t = 0; t < nt; t++) {
      // the middle of the triangle's range of height and of angle (not its centroid): the two
      // triangles of each little quad then fall on the same side, so borders run straight
      const ac = Math.atan2(C[t * 3 + 1] - F.cy, C[t * 3] - F.cx);
      let zl = Infinity, zh = -Infinity, al = Infinity, ah = -Infinity;
      for (let e = 0; e < 3; e++) {
        const v = T[t * 3 + e] * 3, zz = P[v + 2];
        let av = Math.atan2(P[v + 1] - F.cy, P[v] - F.cx) - ac; av -= Math.round(av / (2 * Math.PI)) * 2 * Math.PI;
        zl = Math.min(zl, zz); zh = Math.max(zh, zz); al = Math.min(al, av); ah = Math.max(ah, av);
      }
      const x = Math.cos(ac + (al + ah) / 2), y = Math.sin(ac + (al + ah) / 2), z = (zl + zh) / 2 - F.z0, a = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI);
      let k;
      if (o.pattern === "panels") k = Math.floor(a * ring) + "," + Math.floor((z / Math.max(F.H, 1e-6)) * band * 0.999);
      else if (o.pattern === "rings") { const b = Math.floor((z / Math.max(F.H, 1e-6)) * band * 0.999); k = Math.floor(a * Math.max(3, Math.round(ring / 3))) + "," + b; }
      else if (o.pattern === "bricks") { const b = Math.floor((z / Math.max(F.H, 1e-6)) * band * 0.999); k = Math.floor(a * ring + (b % 2) * 0.5) % ring + "," + b; }
      else { const u = a * ring, v = (z / s) * 1.0; k = Math.floor((u + v) / 1) + "," + Math.floor((u - v) / 1); }
      let id = keys.get(k); if (id === undefined) { id = keys.size; keys.set(k, id); }
      reg[t] = id;
    }
  } else {
    // Tiffany: seeds spread out by farthest-point sampling, regions grown over the surface,
    // then two rounds of moving each seed to its piece's middle (Lloyd)
    const seeds = [Math.floor(R() * nt)], dmin = new Float64Array(nt).fill(Infinity);
    for (let i = 1; i < n; i++) {
      const s = seeds[i - 1];
      let best = 0, bd = -1;
      for (let t = 0; t < nt; t++) {
        const d = (C[t * 3] - C[s * 3]) ** 2 + (C[t * 3 + 1] - C[s * 3 + 1]) ** 2 + (C[t * 3 + 2] - C[s * 3 + 2]) ** 2;
        if (d < dmin[t]) dmin[t] = d;
        const jitter = dmin[t] * (0.75 + 0.5 * ((t * 2654435761) % 997) / 997);
        if (jitter > bd) { bd = jitter; best = t; }
      }
      seeds.push(best);
    }
    const crease = o.crease ?? 1;
    reg = grow(topo, seeds, crease);
    for (let it = 0; it < 2; it++) {
      const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n), sw = new Float64Array(n);
      for (let t = 0; t < nt; t++) { const r = reg[t], w = A[t]; sx[r] += C[t * 3] * w; sy[r] += C[t * 3 + 1] * w; sz[r] += C[t * 3 + 2] * w; sw[r] += w; }
      const bestT = new Int32Array(n).fill(-1), bestD = new Float64Array(n).fill(Infinity);
      for (let t = 0; t < nt; t++) { const r = reg[t]; if (!sw[r]) continue; const d = (C[t * 3] - sx[r] / sw[r]) ** 2 + (C[t * 3 + 1] - sy[r] / sw[r]) ** 2 + (C[t * 3 + 2] - sz[r] / sw[r]) ** 2; if (d < bestD[r]) { bestD[r] = d; bestT[r] = t; } }
      reg = grow(topo, [...bestT].filter((t) => t >= 0), crease);
    }
  }
  return tidy(topo, smooth(topo, reg, 4));
}
// straighter borders: a triangle whose neighbours are mostly in another piece joins it (this
// takes the saw teeth off borders that run across the triangles)
function smooth(topo, reg, passes) {
  const { nb, nt } = topo;
  for (let p = 0; p < passes; p++) {
    let changed = 0;
    const next = reg; // in place, so a saw-tooth row settles on one side instead of swapping
    for (let t = 0; t < nt; t++) {
      const a = nb[t * 3], b = nb[t * 3 + 1], c = nb[t * 3 + 2];
      const ra = a >= 0 ? reg[a] : -1, rb = b >= 0 ? reg[b] : -1, rc = c >= 0 ? reg[c] : -1, r = reg[t];
      let to = -1;
      if (ra >= 0 && ra === rb && ra !== r) to = ra; else if (rb >= 0 && rb === rc && rb !== r) to = rb; else if (ra >= 0 && ra === rc && ra !== r) to = ra;
      if (to >= 0) { next[t] = to; changed++; }
    }
    if (!changed) break;
  }
  return reg;
}
// every piece one connected patch; slivers joined to the neighbour they share most border with
function tidy(topo, reg0, frac = 0.22) {
  const { nb, A, nt } = topo;
  let reg = new Int32Array(nt).fill(-1), n = 0;
  for (let s = 0; s < nt; s++) {
    if (reg[s] >= 0) continue;
    const id = n++, st = [s]; reg[s] = id;
    while (st.length) { const t = st.pop(); for (let e = 0; e < 3; e++) { const u = nb[t * 3 + e]; if (u >= 0 && reg[u] < 0 && reg0[u] === reg0[t]) { reg[u] = id; st.push(u); } } }
  }
  for (let pass = 0; pass < 3; pass++) {
    const area = new Float64Array(n); for (let t = 0; t < nt; t++) area[reg[t]] += A[t];
    let total = 0, cnt = 0; for (let r = 0; r < n; r++) if (area[r] > 0) { total += area[r]; cnt++; }
    const small = total / cnt * frac;
    let changed = false;
    const shared = new Map();
    for (let t = 0; t < nt; t++) { const r = reg[t]; if (area[r] >= small) continue; for (let e = 0; e < 3; e++) { const u = nb[t * 3 + e]; if (u >= 0 && reg[u] !== r) { const k = r + ":" + reg[u]; shared.set(k, (shared.get(k) || 0) + 1); } } }
    const into = new Map();
    for (const [k, c] of shared) { const [r, q] = k.split(":").map(Number); const cur = into.get(r); if (!cur || c > cur[1]) into.set(r, [q, c]); }
    for (let t = 0; t < nt; t++) { const m = into.get(reg[t]); if (m && !into.has(m[0])) { reg[t] = m[0]; changed = true; } }
    if (!changed) break;
  }
  // renumber 0..k-1
  const map = new Map(); for (let t = 0; t < nt; t++) { if (!map.has(reg[t])) map.set(reg[t], map.size); reg[t] = map.get(reg[t]); }
  return { reg, count: map.size };
}

// ---------------------------------------------------------------- glass pieces
// one slab per piece: the surface on the outside, `tg` thick inward, its outline pulled in by
// `inset` so the frame can run between pieces. Returns { V, I, R (piece of each vertex) }.
export function glassPieces(m, topo, part, tg, inset) {
  const { P, T } = m, { N, A, C, nb, nt } = topo, { reg, count } = part;
  const tris = Array.from({ length: count }, () => []);
  for (let t = 0; t < nt; t++) tris[reg[t]].push(t);
  const V = [], I = [], R = [];
  for (let r = 0; r < count; r++) {
    const list = tris[r]; if (!list.length) continue;
    // the piece's own vertex normals and middle
    const local = new Map(), nrm = [];
    let cx = 0, cy = 0, cz = 0, ca = 0;
    for (const t of list) {
      cx += C[t * 3] * A[t]; cy += C[t * 3 + 1] * A[t]; cz += C[t * 3 + 2] * A[t]; ca += A[t];
      for (let e = 0; e < 3; e++) {
        const v = T[t * 3 + e]; let i = local.get(v);
        if (i === undefined) { i = local.size; local.set(v, i); nrm.push(0, 0, 0); }
        nrm[i * 3] += N[t * 3] * A[t]; nrm[i * 3 + 1] += N[t * 3 + 1] * A[t]; nrm[i * 3 + 2] += N[t * 3 + 2] * A[t];
      }
    }
    cx /= ca; cy /= ca; cz /= ca;
    const nl = local.size, top = new Float64Array(nl * 3), onEdge = new Uint8Array(nl);
    const bnd = [];
    for (const t of list) for (let e = 0; e < 3; e++) { const u = nb[t * 3 + e]; if (u < 0 || reg[u] !== r) { const a = local.get(T[t * 3 + e]), b = local.get(T[t * 3 + ((e + 1) % 3)]); onEdge[a] = onEdge[b] = 1; bnd.push(a, b); } }
    for (const [v, i] of local) {
      let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
      let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (onEdge[i] && inset > 0) {
        // toward the piece's middle, along the surface
        let dx = cx - x, dy = cy - y, dz = cz - z; const dn = dx * nx + dy * ny + dz * nz; dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
        const dl = Math.hypot(dx, dy, dz) || 1, k = Math.min(inset, dl * 0.4) / dl;
        x += dx * k; y += dy * k; z += dz * k;
      }
      top[i * 3] = x; top[i * 3 + 1] = y; top[i * 3 + 2] = z;
    }
    const base = V.length / 3;
    for (let i = 0; i < nl; i++) { V.push(top[i * 3], top[i * 3 + 1], top[i * 3 + 2]); R.push(r); }
    for (let i = 0; i < nl; i++) { V.push(top[i * 3] - nrm[i * 3] * tg, top[i * 3 + 1] - nrm[i * 3 + 1] * tg, top[i * 3 + 2] - nrm[i * 3 + 2] * tg); R.push(r); }
    for (const t of list) {
      const a = local.get(T[t * 3]), b = local.get(T[t * 3 + 1]), c = local.get(T[t * 3 + 2]);
      I.push(base + a, base + b, base + c, base + nl + a, base + nl + c, base + nl + b);
    }
    for (let k = 0; k < bnd.length; k += 2) { const a = bnd[k], b = bnd[k + 1]; I.push(base + a, base + nl + a, base + nl + b, base + a, base + nl + b, base + b); }
  }
  return { V: new Float32Array(V), I: new Uint32Array(I), R: new Int32Array(R) };
}
// the borders between pieces (and open rims) as segments on the glass's middle layer:
// [ax, ay, az, bx, by, bz, nx, ny, nz] each
export function borders(m, topo, part, tg) {
  const { P, T } = m, { N, nb, nt } = topo, { reg } = part, out = [];
  // vertex normals of the whole surface
  const vn = new Float64Array(P.length);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) { const v = T[t * 3 + e]; vn[v * 3] += N[t * 3]; vn[v * 3 + 1] += N[t * 3 + 1]; vn[v * 3 + 2] += N[t * 3 + 2]; }
  for (let v = 0; v < P.length / 3; v++) { const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]) || 1; vn[v * 3] /= l; vn[v * 3 + 1] /= l; vn[v * 3 + 2] /= l; }
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const u = nb[t * 3 + e];
    if (u >= 0 && (reg[u] === reg[t] || u < t)) continue; // each inner border once
    const a = T[t * 3 + e], b = T[t * 3 + ((e + 1) % 3)];
    const n = [vn[a * 3] + vn[b * 3], vn[a * 3 + 1] + vn[b * 3 + 1], vn[a * 3 + 2] + vn[b * 3 + 2]], l = Math.hypot(...n) || 1;
    out.push(P[a * 3] - vn[a * 3] * tg / 2, P[a * 3 + 1] - vn[a * 3 + 1] * tg / 2, P[a * 3 + 2] - vn[a * 3 + 2] * tg / 2, P[b * 3] - vn[b * 3] * tg / 2, P[b * 3 + 1] - vn[b * 3 + 1] * tg / 2, P[b * 3 + 2] - vn[b * 3 + 2] * tg / 2, n[0] / l, n[1] / l, n[2] / l);
  }
  return new Float64Array(out);
}
// the frame: a tube along every border, `wf` wide (across, along the surface) and `tf` thick
// (through the glass), as one watertight surface
export function frameMesh(segs, wf, tf, budget = 7e6, hk = 1.6) {
  const ns = segs.length / 9;
  if (!ns) return { V: new Float32Array(0), I: new Uint32Array(0) };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let s = 0; s < ns; s++) for (const o of [0, 3]) { const i = s * 9 + o; x0 = Math.min(x0, segs[i]); x1 = Math.max(x1, segs[i]); y0 = Math.min(y0, segs[i + 1]); y1 = Math.max(y1, segs[i + 1]); z0 = Math.min(z0, segs[i + 2]); z1 = Math.max(z1, segs[i + 2]); }
  const rw = wf / 2, rt = tf / 2, rr = Math.max(rw, rt), pad = rr + 1;
  let h = Math.min(rw, rt) / hk;
  const dims = () => [Math.ceil((x1 - x0 + 2 * pad) / h) + 3, Math.ceil((y1 - y0 + 2 * pad) / h) + 3, Math.ceil((z1 - z0 + 2 * pad) / h) + 3];
  while (dims().reduce((a, b) => a * b, 1) > budget) h *= 1.08;
  const [nx, ny, nz] = dims(), o = [x0 - pad - h, y0 - pad - h, z0 - pad - h];
  const F = new Float32Array(nx * ny * nz).fill(rr + 2 * h);
  const scale = Math.min(rw, rt);
  for (let s = 0; s < ns; s++) {
    const q = s * 9, ax = segs[q], ay = segs[q + 1], az = segs[q + 2], bx = segs[q + 3], by = segs[q + 4], bz = segs[q + 5], Nx = segs[q + 6], Ny = segs[q + 7], Nz = segs[q + 8];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1e-12;
    const lo = [Math.min(ax, bx) - rr - h, Math.min(ay, by) - rr - h, Math.min(az, bz) - rr - h], hi = [Math.max(ax, bx) + rr + h, Math.max(ay, by) + rr + h, Math.max(az, bz) + rr + h];
    const i0 = Math.max(0, Math.floor((lo[0] - o[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] - o[0]) / h));
    const j0 = Math.max(0, Math.floor((lo[1] - o[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] - o[1]) / h));
    const k0 = Math.max(0, Math.floor((lo[2] - o[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] - o[2]) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = o[0] + i * h, py = o[1] + j * h, pz = o[2] + k * h;
      let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - ax - dx * t, ey = py - ay - dy * t, ez = pz - az - dz * t;
      const dn = ex * Nx + ey * Ny + ez * Nz, tx = ex - dn * Nx, ty = ey - dn * Ny, tz = ez - dn * Nz;
      const f = (Math.sqrt((tx * tx + ty * ty + tz * tz) / (rw * rw) + (dn * dn) / (rt * rt)) - 1) * scale;
      const qq = i + nx * (j + ny * k);
      if (f < F[qq]) F[qq] = f;
    }
  }
  return isoSurface({ o, h, nx, ny, nz }, F);
}
// a lamp base (closed, upright, standing on z = 0) from a profile [[r, z], ...] going up
export function latheSolid(profile, seg = 48) {
  const V = [], I = [];
  const f = profile[0], l = profile[profile.length - 1];
  if (profile.length > 3 && Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) {
    // a closed loop (outside up, bore down): a ring of rings, no caps
    const n = profile.length - 1;
    for (let i = 0; i < n; i++) for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; V.push(profile[i][0] * Math.cos(a), profile[i][0] * Math.sin(a), profile[i][1]); }
    for (let i = 0; i < n; i++) for (let s = 0; s < seg; s++) { const j = (i + 1) % n, a = i * seg + s, b = i * seg + ((s + 1) % seg), c = j * seg + s, d = j * seg + ((s + 1) % seg); I.push(a, b, d, a, d, c); }
    return { V: new Float32Array(V), I: new Uint32Array(I) };
  }
  const pr = profile, n = pr.length;
  for (let i = 0; i < n; i++) for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; V.push(pr[i][0] * Math.cos(a), pr[i][0] * Math.sin(a), pr[i][1]); }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < seg; s++) { const a = i * seg + s, b = i * seg + ((s + 1) % seg), c = (i + 1) * seg + s, d = (i + 1) * seg + ((s + 1) % seg); I.push(a, b, d, a, d, c); }
  // caps
  const bc = V.length / 3; V.push(0, 0, pr[0][1]); const tc = V.length / 3; V.push(0, 0, pr[n - 1][1]);
  for (let s = 0; s < seg; s++) { I.push(bc, (s + 1) % seg, s); I.push(tc, (n - 1) * seg + s, (n - 1) * seg + ((s + 1) % seg)); }
  return { V: new Float32Array(V), I: new Uint32Array(I) };
}
// an open surface of revolution (a lamp shade) as a triangle soup, from [[r, z], ...]
export function latheSoup(profile, seg = 64) {
  const out = [];
  for (let i = 0; i < profile.length - 1; i++) for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
    const p = (k, a) => [profile[k][0] * Math.cos(a), profile[k][0] * Math.sin(a), profile[k][1]];
    const A = p(i, a0), B = p(i, a1), C = p(i + 1, a1), D = p(i + 1, a0);
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  return new Float32Array(out);
}
export const SHADES = {
  dome: { name: "Dome lamp shade", prof: () => { const P = []; for (let i = 0; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2) * 0.86; P.push([90 * Math.cos(a) + 2, 72 * Math.sin(a)]); } return P; }, base: true },
  cone: { name: "Cone lamp shade", prof: () => [[85, 0], [62, 30], [40, 60], [20, 86]], base: true },
  bell: { name: "Bell lamp shade", prof: () => [[88, 0], [84, 10], [72, 26], [58, 44], [44, 62], [30, 78], [16, 88]], base: true },
  tulip: { name: "Tulip shade", prof: () => [[14, 0], [34, 14], [52, 36], [60, 60], [58, 84], [50, 100]], base: false },
  lantern: { name: "Lantern (cylinder)", prof: () => [[45, 0], [45, 40], [45, 80], [45, 120]], base: false },
  globe: { name: "Globe", prof: () => { const P = []; for (let i = 0; i <= 18; i++) { const a = -Math.PI / 2 + 0.35 + (i / 18) * (Math.PI - 0.7); P.push([60 * Math.cos(a), 60 + 60 * Math.sin(a)]); } return P; }, base: false },
  square: { name: "Square mission lamp shade", square: true, base: true, prof: () => [[90, 0], [34, 56]] },
  vase: { name: "Vase", prof: () => [[1, 0], [28, 0.2], [40, 20], [44, 50], [36, 85], [22, 110], [20, 130], [28, 145]], base: false },
};
// a Tiffany-style lamp base under a shade whose rim is at radius r and height h
export function lampBase(shadeH, bore = 0) {
  const H = Math.max(120, shadeH * 2.8);
  return latheSolid(withBore([[0.01, 0], [62, 0], [64, 6], [56, 14], [30, 24], [16, 40], [11, 70], [9, H * 0.85], [12, H * 0.9], [6, H * 0.94], [5, H], [0.01, H]], bore), 40);
}
// a lathe profile with a hole of radius b straight down the middle (for a lamp rod and the cord)
export function withBore(pr, b) {
  if (!b) return pr;
  const H = pr[pr.length - 1][1], out = pr.slice(1, -1).map(([r, z]) => [Math.max(r, b + 2.5), z]);
  return [[b, 0], ...out, [Math.max(b + 2.5, pr[pr.length - 2][0]), H], [b, H], [b, 0]];
}

// ---------------------------------------------------------------- pictures to stained glass
// A picture (RGBA pixels) becomes a few flat colours with bold outlines, like a design drawn for
// leaded glass: colours are reduced (k-means), dark outline pixels become lead (their pixels go to
// the colour next to them), small specks are merged away. Returns a label per pixel and colours.
export function pictureLabels(px, W, H, o = {}) {
  const K = Math.max(2, Math.min(16, o.colors || 7));
  const n = W * H, rgb = new Float32Array(n * 3), alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const a = px[i * 4 + 3] / 255; alpha[i] = a > 0.5 ? 1 : 0; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[i * 4 + c] * a + 255 * (1 - a); }
  // a light blur so noise and anti-aliasing don't make specks
  const blur = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0, w = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const k = dx || dy ? 1 : 2; s += rgb[(yy * W + xx) * 3 + c] * k; w += k; }
    blur[(y * W + x) * 3 + c] = s / w;
  }
  const lum = (i) => 0.299 * blur[i * 3] + 0.587 * blur[i * 3 + 1] + 0.114 * blur[i * 3 + 2];
  // outline pixels: much darker than the picture around them
  const dark = new Uint8Array(n);
  if (o.leadLines !== false) for (let i = 0; i < n; i++) if (lum(i) < (o.darkLevel ?? 70)) dark[i] = 1;
  // k-means on the other pixels
  const R = rng(o.seed || 5), cent = [];
  const pick = () => { for (let tries = 0; tries < 50; tries++) { const i = Math.floor(R() * n); if (!dark[i]) return [blur[i * 3], blur[i * 3 + 1], blur[i * 3 + 2]]; } return [200, 200, 200]; };
  cent.push(pick());
  while (cent.length < K) { // k-means++ start
    let best = null, bd = -1;
    for (let s = 0; s < 400; s++) { const c = pick(); let d = Infinity; for (const q of cent) d = Math.min(d, (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2); if (d > bd) { bd = d; best = c; } }
    cent.push(best);
  }
  const lab = new Int32Array(n).fill(-1);
  for (let it = 0; it < 10; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      if (dark[i]) continue;
      let b = 0, bd = Infinity;
      for (let k = 0; k < cent.length; k++) { const q = cent[k], d = (blur[i * 3] - q[0]) ** 2 + (blur[i * 3 + 1] - q[1]) ** 2 + (blur[i * 3 + 2] - q[2]) ** 2; if (d < bd) { bd = d; b = k; } }
      lab[i] = b; const s = sum[b]; s[0] += blur[i * 3]; s[1] += blur[i * 3 + 1]; s[2] += blur[i * 3 + 2]; s[3]++;
    }
    cent.forEach((q, k) => { const s = sum[k]; if (s[3]) { q[0] = s[0] / s[3]; q[1] = s[1] / s[3]; q[2] = s[2] / s[3]; } });
  }
  // lead pixels take the nearest colour (grown outward from the coloured areas)
  let front = [];
  for (let i = 0; i < n; i++) if (lab[i] >= 0) front.push(i);
  while (front.length) {
    const next = [];
    for (const i of front) { const x = i % W, y = (i / W) | 0; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && lab[j] < 0) { lab[j] = lab[i]; next.push(j); } }
    front = next;
  }
  for (let i = 0; i < n; i++) if (lab[i] < 0) lab[i] = 0;
  // majority filter: smoother borders, fewer jaggies
  for (let pass = 0; pass < (o.smooth ?? 2); pass++) {
    const cp = lab.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const cnt = new Map(); let best = cp[y * W + x], bc = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = cp[(y + dy) * W + x + dx], c = (cnt.get(v) || 0) + 1; cnt.set(v, c); if (c > bc) { bc = c; best = v; } }
      if (bc >= 5) lab[y * W + x] = best;
    }
  }
  const hex = (q) => "#" + q.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // the background: the colour most common along the picture's edge (or see-through pixels)
  const edgeCount = new Map();
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) edgeCount.set(lab[y * W + x], (edgeCount.get(lab[y * W + x]) || 0) + 1);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) edgeCount.set(lab[y * W + x], (edgeCount.get(lab[y * W + x]) || 0) + 1);
  let bg = 0, bgc = -1; for (const [k, c] of edgeCount) if (c > bgc) { bgc = c; bg = k; }
  const anyAlpha = alpha.some((a) => !a);
  return { W, H, lab, colors: cent.map(hex), bg, alpha: anyAlpha ? alpha : null, dark };
}
// a flat panel (lying on z = 0, facing up) as a fine triangle grid, w × h mm, in a shape:
// "rect", "circle", "arch" or "outline" (only the picture's non-background part)
export function panelMesh(w, h, shape, pic, maxTris = 50000) {
  const step = Math.sqrt((w * h * 2) / maxTris), nx = Math.max(2, Math.round(w / step)), ny = Math.max(2, Math.round(h / step));
  const inside = (u, v) => {
    if (shape === "circle") return (u - 0.5) ** 2 * (w / Math.min(w, h)) ** 2 + (v - 0.5) ** 2 * (h / Math.min(w, h)) ** 2 <= 0.25;
    if (shape === "arch") { const r = w / 2, yc = h - r; const y = v * h, x = u * w; return y <= yc || (x - w / 2) ** 2 + (y - yc) ** 2 <= r * r; }
    if (shape === "outline" && pic) { const px = Math.min(pic.W - 1, Math.floor(u * pic.W)), py = Math.min(pic.H - 1, Math.floor((1 - v) * pic.H)), i = py * pic.W + px; return pic.alpha ? !!pic.alpha[i] : pic.lab[i] !== pic.bg; }
    return true;
  };
  const soup = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
    if (!inside((u0 + u1) / 2, (v0 + v1) / 2)) continue;
    const P = (u, v) => [(u - 0.5) * w, (v - 0.5) * h, 0];
    soup.push(...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v0), ...P(u1, v1), ...P(u0, v1));
  }
  return new Float32Array(soup);
}
// pieces from a picture: each triangle takes the picture's colour area at uv(t); areas larger
// than maxArea are cut into simple pieces (grown inside the area), like a glass cutter would
export function pictureParts(m, topo, pic, uvOf, maxArea, seed = 1) {
  const { nt, A } = topo, key = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    const [u, v] = uvOf(t), px = Math.max(0, Math.min(pic.W - 1, Math.floor(u * pic.W))), py = Math.max(0, Math.min(pic.H - 1, Math.floor((1 - v) * pic.H)));
    key[t] = pic.lab[py * pic.W + px];
  }
  let part = tidy(topo, smooth(topo, key, 3));
  part = splitBig(topo, part, maxArea, seed);
  // the colour of each piece: the picture colour most of its triangles have
  const votes = Array.from({ length: part.count }, () => new Map());
  for (let t = 0; t < nt; t++) { const r = part.reg[t], k = key[t], mm = votes[r]; mm.set(k, (mm.get(k) || 0) + A[t]); }
  const colors = votes.map((mm) => { let b = 0, bv = -1; for (const [k, v] of mm) if (v > bv) { bv = v; b = k; } return pic.colors[b] || "#cccccc"; });
  return { ...part, colors };
}
function splitBig(topo, part, maxArea, seed) {
  const { nt, A, C } = topo;
  const area = new Float64Array(part.count); for (let t = 0; t < nt; t++) area[part.reg[t]] += A[t];
  const R = rng(seed);
  const seeds = [], owner = [];
  const members = Array.from({ length: part.count }, () => []);
  for (let t = 0; t < nt; t++) members[part.reg[t]].push(t);
  for (let r = 0; r < part.count; r++) {
    const k = Math.max(1, Math.round(area[r] / maxArea));
    const mem = members[r];
    // farthest-point seeds inside the area
    const s0 = mem[Math.floor(R() * mem.length)], list = [s0], dmin = new Float64Array(mem.length).fill(Infinity);
    for (let i = 1; i < k; i++) {
      const s = list[i - 1]; let best = mem[0], bd = -1;
      for (let q = 0; q < mem.length; q++) { const t = mem[q], d = (C[t * 3] - C[s * 3]) ** 2 + (C[t * 3 + 1] - C[s * 3 + 1]) ** 2 + (C[t * 3 + 2] - C[s * 3 + 2]) ** 2; if (d < dmin[q]) dmin[q] = d; if (dmin[q] > bd) { bd = dmin[q]; best = t; } }
      list.push(best);
    }
    for (const s of list) { seeds.push(s); owner.push(r); }
  }
  // grow from every seed, never crossing into another colour area
  const reg = new Int32Array(nt).fill(-1), dist = new Float64Array(nt).fill(Infinity), h = [];
  seeds.forEach((t, i) => { reg[t] = i; dist[t] = 0; heapPush(h, 0, t); });
  while (h.length) {
    const [d, t] = heapPop(h); if (d > dist[t]) continue;
    for (let e = 0; e < 3; e++) {
      const u = topo.nb[t * 3 + e]; if (u < 0 || part.reg[u] !== part.reg[t]) continue;
      const w = Math.hypot(C[t * 3] - C[u * 3], C[t * 3 + 1] - C[u * 3 + 1], C[t * 3 + 2] - C[u * 3 + 2]);
      if (d + w < dist[u]) { dist[u] = d + w; reg[u] = reg[t]; heapPush(h, d + w, u); }
    }
  }
  for (let t = 0; t < nt; t++) if (reg[t] < 0) reg[t] = 0;
  return tidy(topo, smooth(topo, reg, 2));
}

// ---------------------------------------------------------------- snap-fit kit
// The frame as H-shaped came: a ledge under the glass (lipT thick, wf wide) and a web between the
// pieces (web wide) rising capH above the glass, with small snap bumps on the web's sides just
// above the glass. Each piece is cut so its edge sits `clear` away from the web, on the ledge,
// and the bumps hold it down once it's pressed in. Glass is at -tg..0 in the surface normal.
export function kitFrameMesh(segs, o, budget = 7e6) {
  const ns = segs.length / 9;
  if (!ns) return { V: new Float32Array(0), I: new Uint32Array(0) };
  const { wf, web, tg, lipT, capH, bump, clear } = o;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let s = 0; s < ns; s++) for (const q of [0, 3]) { const i = s * 9 + q; x0 = Math.min(x0, segs[i]); x1 = Math.max(x1, segs[i]); y0 = Math.min(y0, segs[i + 1]); y1 = Math.max(y1, segs[i + 1]); z0 = Math.min(z0, segs[i + 2]); z1 = Math.max(z1, segs[i + 2]); }
  const rr = Math.max(wf / 2, tg / 2 + lipT, capH + tg / 2) + 1, pad = rr + 1;
  let h = Math.min(web / 2.2, lipT / 1.6, 0.45);
  const dims = () => [Math.ceil((x1 - x0 + 2 * pad) / h) + 3, Math.ceil((y1 - y0 + 2 * pad) / h) + 3, Math.ceil((z1 - z0 + 2 * pad) / h) + 3];
  while (dims().reduce((a, b) => a * b, 1) > budget) h *= 1.07;
  const [nx, ny, nz] = dims(), or = [x0 - pad - h, y0 - pad - h, z0 - pad - h];
  const F = new Float32Array(nx * ny * nz).fill(rr);
  // the segments are on the glass's middle layer (n = -tg/2): the ledge spans n in
  // [-tg - lipT, -tg], the web n in [-tg - lipT, capH]
  const lipC = -tg / 2 - lipT / 2, lipH = lipT / 2, webC = (capH - tg - lipT) / 2 + tg / 2, webH = (capH + tg + lipT) / 2;
  const box = (t, n, hw, cn, hh) => { const qx = Math.abs(t) - hw, qy = Math.abs(n - cn) - hh; return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)); };
  // snap bumps: about every 9 mm along the borders, on both sides of the web
  const bumps = [], seen = new Set(), cellB = 9;
  for (let s = 0; s < ns; s++) {
    const q = s * 9, mx = (segs[q] + segs[q + 3]) / 2, my = (segs[q + 1] + segs[q + 4]) / 2, mz = (segs[q + 2] + segs[q + 5]) / 2;
    const key = Math.floor(mx / cellB) + "," + Math.floor(my / cellB) + "," + Math.floor(mz / cellB);
    if (seen.has(key)) continue; seen.add(key);
    const dx = segs[q + 3] - segs[q], dy = segs[q + 4] - segs[q + 1], dz = segs[q + 5] - segs[q + 2], L = Math.hypot(dx, dy, dz) || 1;
    const N = [segs[q + 6], segs[q + 7], segs[q + 8]], T = [dx / L, dy / L, dz / L];
    const S = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]; // across the border, along the surface
    const up = tg / 2 + bump * 0.9; // just above the glass's top face
    for (const sd of [-1, 1]) bumps.push([mx + N[0] * up + S[0] * sd * (web / 2), my + N[1] * up + S[1] * sd * (web / 2), mz + N[2] * up + S[2] * sd * (web / 2)]);
  }
  const put = (lo, hi, f) => {
    const i0 = Math.max(0, Math.floor((lo[0] - or[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] - or[0]) / h));
    const j0 = Math.max(0, Math.floor((lo[1] - or[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] - or[1]) / h));
    const k0 = Math.max(0, Math.floor((lo[2] - or[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] - or[2]) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const qq = i + nx * (j + ny * k), v = f(or[0] + i * h, or[1] + j * h, or[2] + k * h); if (v < F[qq]) F[qq] = v; }
  };
  for (let s = 0; s < ns; s++) {
    const q = s * 9, ax = segs[q], ay = segs[q + 1], az = segs[q + 2], bx = segs[q + 3], by = segs[q + 4], bz = segs[q + 5], Nx = segs[q + 6], Ny = segs[q + 7], Nz = segs[q + 8];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1e-12;
    const e2 = rr - 0.5 + h;
    const lo = [Math.min(ax, bx) - e2, Math.min(ay, by) - e2, Math.min(az, bz) - e2], hi = [Math.max(ax, bx) + e2, Math.max(ay, by) + e2, Math.max(az, bz) + e2];
    put(lo, hi, (px, py, pz) => {
      let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - ax - dx * t, ey = py - ay - dy * t, ez = pz - az - dz * t;
      const dn = ex * Nx + ey * Ny + ez * Nz, tt = Math.hypot(ex - dn * Nx, ey - dn * Ny, ez - dn * Nz);
      return Math.min(box(tt, dn, wf / 2, lipC, lipH), box(tt, dn, web / 2, webC, webH));
    });
  }
  const br = bump; // the bumps: small balls half sunk into the web
  for (const [bx, by, bz] of bumps) { const e = br + 2 * h; put([bx - e, by - e, bz - e], [bx + e, by + e, bz + e], (px, py, pz) => Math.hypot(px - bx, py - by, pz - bz) - br); }
  return isoSurface({ o: or, h, nx, ny, nz }, F);
}
// each glass piece as its own closed mesh (for the kit: one file per piece)
export function splitPieces(glass) {
  const { V, I, R } = glass, by = new Map();
  for (let t = 0; t < I.length; t += 3) { const r = R[I[t]]; if (!by.has(r)) by.set(r, []); by.get(r).push(I[t], I[t + 1], I[t + 2]); }
  const out = [];
  for (const [r, tri] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    const map = new Map(), V2 = [], I2 = new Uint32Array(tri.length);
    for (let k = 0; k < tri.length; k++) { const v = tri[k]; let n = map.get(v); if (n === undefined) { n = V2.length / 3; map.set(v, n); V2.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); } I2[k] = n; }
    out.push({ piece: r, V: new Float32Array(V2), I: I2 });
  }
  return out;
}
// straighter, smoother borders: points along each border (between pieces, not on the open rim
// and not where three pieces meet) move toward the middle of their two border neighbours, so
// lead lines across the triangle grid lose their stair steps. Returns the moved mesh's topology.
export function smoothBorders(m, topo, part, iters = 6) {
  const { P, T } = m, { nb, nt } = topo, { reg } = part, nv = P.length / 3;
  const link = Array.from({ length: nv }, () => new Set()), rim = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const u = nb[t * 3 + e], a = T[t * 3 + e], b = T[t * 3 + ((e + 1) % 3)];
    if (u < 0) { rim[a] = rim[b] = 1; continue; }
    if (reg[u] !== reg[t] && u > t) { link[a].add(b); link[b].add(a); }
  }
  // how many pieces meet at each point (three or more: a junction, kept in place)
  const meet = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) meet[T[t * 3 + e]].add(reg[t]);
  const movable = [];
  for (let v = 0; v < nv; v++) if (!rim[v] && link[v].size === 2 && meet[v].size === 2) movable.push(v);
  const Q = new Float64Array(P.length);
  for (let it = 0; it < iters; it++) {
    Q.set(P);
    for (const v of movable) {
      const [a, b] = [...link[v]];
      for (let c = 0; c < 3; c++) Q[v * 3 + c] = P[v * 3 + c] * 0.5 + (P[a * 3 + c] + P[b * 3 + c]) * 0.25;
    }
    P.set(Q);
  }
  return topology(m);
}

// ---------------------------------------------------------------- square (mission style) lamps
// A four-sided shade: a square frustum, open at the top and bottom, wB wide at the bottom, wT at
// the top, h high (four trapezoid panels), and a square lamp base under it.
export function squareShadeSoup(wB, wT, h, nu = 72, nv = 60) {
  // a regular (u, v) grid on each panel, so lines of constant u (the converging strips) and of
  // constant v (the bands) run straight along triangle edges
  const b = wB / 2, a = wT / 2, out = [];
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let f = 0; f < 4; f++) {
    const p = C[f], q = C[(f + 1) % 4];
    const P = (u, v) => { const r = b + (a - b) * v; return [(q[0] + (p[0] - q[0]) * u) * r, (q[1] + (p[1] - q[1]) * u) * r, h * v]; };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const A = P(i / nu, j / nv), B = P((i + 1) / nu, j / nv), Cc = P((i + 1) / nu, (j + 1) / nv), D = P(i / nu, (j + 1) / nv);
      // outward winding; alternate the diagonal so diagonal lines are even both ways
      if ((i + j) % 2) out.push(...B, ...A, ...D, ...B, ...D, ...Cc); else out.push(...A, ...D, ...Cc, ...A, ...Cc, ...B);
    }
  }
  return new Float32Array(out);
}
// a solid with square cross-sections: profile [[halfWidth, z], ...] going up
export function squareSolid(profile) {
  const s = latheSolid(profile.map(([r, z]) => [r * Math.SQRT2, z]), 4);
  const c = Math.SQRT1_2;
  for (let i = 0; i < s.V.length; i += 3) { const x = s.V[i], y = s.V[i + 1]; s.V[i] = x * c - y * c; s.V[i + 1] = x * c + y * c; }
  return s;
}
// a mission-style base: a stepped square foot, a tapered square column and a neck to the shade
export function squareLampBase(shadeH, bore = 0) {
  const H = Math.max(140, shadeH * 2.3);
  return squareSolid(withBore([[0.01, 0], [46, 0], [46, 7], [42, 10], [38, 14], [36, 18], [22, 24], [16, 30], [15, 36], [12, H * 0.86], [15, H * 0.88], [15, H * 0.9], [8, H * 0.92], [6, H], [0.01, H]], bore));
}
// The classic mission design on each of the four panels (u across the panel 0..1 at that height,
// v up 0..1): a top band of amber with a small diamond, tall cream strips with an amber diamond at
// the bottom middle, and a lower band of green stripes, two rows of orange chevrons with amber
// diamonds and a green X in the middle. Returns [key, colour] for a point.
const MISSION = { cream: "#f1e6c8", orange: "#e8822a", amber: "#b8641c", green: "#8cc63f", lime: "#a9d65a" };
export function missionCell(face, u, v) {
  const M = MISSION, du = u - 0.5, k = "f" + face + ":";
  const diamond = (cu, cv, ru, rv) => Math.abs(u - cu) / ru + Math.abs(v - cv) / rv <= 1;
  if (v >= 0.91) {
    if (diamond(0.5, 0.955, 0.045, 0.06)) return [k + "td", M.amber];
    return [k + (du < 0 ? "tl" : "tr"), M.orange];
  }
  if (v >= 0.89) return [k + "tline", M.cream];
  if (v >= 0.31) {
    if (diamond(0.5, 0.42, 0.07, 0.09)) return [k + "md", M.amber];
    const edges = [1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6];
    let i = 0; while (i < edges.length && u > edges[i]) i++;
    return [k + "s" + i, M.cream];
  }
  // the lower band
  if (v >= 0.26) return [k + "g1" + (du < 0 ? "l" : "r"), M.green];
  if (v < 0.05) return [k + "g2" + (du < 0 ? "l" : "r"), M.green];
  const xv = v - 0.155;
  if (Math.abs(du - xv * 0.9) < 0.03 || Math.abs(du + xv * 0.9) < 0.03) return [k + "x" + (du < 0 ? "l" : "r") + (xv < 0 ? "b" : "t"), M.lime];
  for (const cu of [0.27, 0.73]) if (diamond(cu, 0.155, 0.035, 0.05)) return [k + "d" + cu, M.amber];
  // two rows of orange chevrons, mirrored about the middle
  const row = v >= 0.155 ? 1 : 0, rv = v - (row ? 0.2 : 0.105);
  const side = du < 0 ? -1 : 1, w = Math.abs(du);
  const idx = Math.floor((w - Math.abs(rv) * 1.8) / 0.085);
  return [k + "o" + row + side + "_" + idx, M.orange];
}
// pieces from the mission design, for a square shade
export function missionParts(m, topo, wB, wT, h) {
  const { C, N, nt } = topo, key = new Int32Array(nt), keys = new Map(), colorOf = [];
  for (let t = 0; t < nt; t++) {
    const x = C[t * 3], y = C[t * 3 + 1], z = C[t * 3 + 2], nx = N[t * 3], ny = N[t * 3 + 1];
    const face = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 0 : 2) : ny > 0 ? 1 : 3;
    const half = wB / 2 + ((wT - wB) / 2) * (z / h);
    const s = face === 0 ? y : face === 2 ? -y : face === 1 ? -x : x;
    const u = (s / half + 1) / 2, v = z / h;
    const [k, c] = missionCell(face, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    let id = keys.get(k); if (id === undefined) { id = keys.size; keys.set(k, id); colorOf.push(c); }
    key[t] = id;
  }
  const part = tidy(topo, smooth(topo, key, 1), 0.03);
  const votes = Array.from({ length: part.count }, () => new Map());
  for (let t = 0; t < nt; t++) { const r = part.reg[t], mm = votes[r]; mm.set(key[t], (mm.get(key[t]) || 0) + topo.A[t]); }
  const colors = votes.map((mm) => { let b = 0, bv = -1; for (const [k, v] of mm) if (v > bv) { bv = v; b = k; } return colorOf[b]; });
  return { ...part, colors };
}

// ---------------------------------------------------------------- bulb fittings
// Standard lamp hardware the shade can hang on or sit on. Hole sizes are for the plate's middle
// collar: a socket with a shade ring passes through the hole and the ring screws on to clamp it;
// a harp or a threaded lamp rod passes through the small hole and a finial holds it.
export const FITTINGS = {
  none: { name: "No fitting" },
  e26: { name: "E26 medium (standard US / Canada bulb)", hole: 40.5, note: "For an E26 medium-base socket with a shade ring (the threaded body is about 39.7 mm across). Use LED bulbs: they stay cool enough for printed parts." },
  e27: { name: "E27 socket (Europe)", hole: 40.5, note: "For an E27 socket with a shade ring (about 39.7 mm across the thread). Use LED bulbs." },
  e12: { name: "E12 candelabra socket", hole: 25.5, note: "For an E12 candelabra socket with a shade ring. Measure yours: sizes vary, set the hole to fit." },
  harp: { name: "Harp or lamp rod (1/8 IPS, M10)", hole: 10.5, note: "A spider fitting: a harp top or a 1/8 IPS / M10 threaded rod goes through the hole and a finial screws on to hold the shade." },
};
// The fitter: a flat plate with a collar round the hole, spokes, and an outer ring that rests on
// (top) or carries (bottom) the shade's rim. P: the shade surface points, zr: the rim height,
// zp: the plate's underside, nSpokes, spoke0: angle of the first spoke.
export function fitterMesh(P, zr, zp, hole, opt = {}) {
  const T = opt.t || 3, nb = 120, rh = hole / 2, collar = opt.collar || 6, ringW = opt.ring || 7, spW = opt.spoke || 7;
  const R = new Float64Array(nb);
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i + 2] - zr) > 1.5) continue;
    const a = Math.atan2(P[i + 1], P[i]), b = ((Math.floor(((a / (2 * Math.PI)) + 1) * nb)) % nb), r = Math.hypot(P[i], P[i + 1]);
    if (r > R[b]) R[b] = r;
  }
  // fill empty bins from their neighbours
  for (let pass = 0; pass < nb; pass++) { let empty = 0; for (let b = 0; b < nb; b++) if (!R[b]) { const l = R[(b + nb - 1) % nb], r = R[(b + 1) % nb]; if (l || r) R[b] = l && r ? (l + r) / 2 : l || r; else empty++; } if (!empty) break; }
  const ns = opt.spokes || 3, s0 = opt.spoke0 || Math.PI / 2;
  const NT = 28, V = [], I = [];
  const rOut = (b) => R[b] + 2;
  if (rOut(0) < rh + collar + 2) throw new Error("The shade's opening is too small for this fitting: make the shade bigger or pick a smaller fitting");
  // cells (b, j): solid if in the collar, the outer ring or a spoke
  const rad = (b, j) => rh + (rOut(b) - rh) * (j / NT);
  const ang = (b) => (b / nb) * Math.PI * 2;
  const solid = (b, j) => {
    b = (b + nb) % nb; if (j < 0 || j >= NT) return false;
    const r = (rad(b, j) + rad(b, j + 1) + rad((b + 1) % nb, j) + rad((b + 1) % nb, j + 1)) / 4, a = ang(b + 0.5);
    if (r < rh + collar || r > R[b] - ringW + 2) return true;
    for (let k = 0; k < ns; k++) { let d = a - (s0 + (k * 2 * Math.PI) / ns); d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < Math.PI / 2 && r * Math.abs(Math.sin(d)) < spW / 2) return true; }
    return false;
  };
  const vid = new Map();
  const vtx = (b, j, top) => { b = (b + nb) % nb; const k = (b * (NT + 1) + j) * 2 + (top ? 1 : 0); let id = vid.get(k); if (id === undefined) { const r = rad(b, j), a = ang(b); id = V.length / 3; V.push(r * Math.cos(a), r * Math.sin(a), zp + (top ? T : 0)); vid.set(k, id); } return id; };
  const quad = (a, b, c, d) => I.push(a, c, b, a, d, c);
  for (let b = 0; b < nb; b++) for (let j = 0; j < NT; j++) {
    if (!solid(b, j)) continue;
    const b1 = b + 1;
    quad(vtx(b, j, 1), vtx(b1, j, 1), vtx(b1, j + 1, 1), vtx(b, j + 1, 1));
    quad(vtx(b, j, 0), vtx(b, j + 1, 0), vtx(b1, j + 1, 0), vtx(b1, j, 0));
    if (!solid(b, j - 1)) quad(vtx(b, j, 0), vtx(b1, j, 0), vtx(b1, j, 1), vtx(b, j, 1));
    if (!solid(b, j + 1)) quad(vtx(b, j + 1, 0), vtx(b, j + 1, 1), vtx(b1, j + 1, 1), vtx(b1, j + 1, 0));
    if (!solid(b - 1, j)) quad(vtx(b, j, 0), vtx(b, j, 1), vtx(b, j + 1, 1), vtx(b, j + 1, 0));
    if (!solid(b + 1, j)) quad(vtx(b1, j, 0), vtx(b1, j + 1, 0), vtx(b1, j + 1, 1), vtx(b1, j, 1));
  }
  return { V: new Float32Array(V), I: new Uint32Array(I) };
}
