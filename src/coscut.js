// CosForge cutting: split a part with flat cuts (each cut face is closed, so every piece is a
// solid), keep pieces that are joined by an add-on together, and build joints across the cut:
// pegs, snap clips, slide-in dovetails and magnet cups. Joints sit on the inside of the shell (the
// side facing the body) so the outside stays clean. Also: does a piece fit a printer, and where to
// cut so every piece does. Sizes in mm.
import * as THREE from "three";
import { TL, merge, weld, buildShell, lathe, extrude, SD, solidVolume, earclip, orientConsistent, flip } from "./cosmesh.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ----------------------------------------------------------------------------- split with caps
export function splitSolid(m, n, d) {
  const P = m.pos, I = m.idx, nV = P.length / 3, nT = I.length / 3;
  const s = new Float64Array(nV);
  // a cut right through corners makes slivers: nudge it a hair off them
  for (let tries = 0; tries < 8; tries++) {
    let near = Infinity;
    for (let v = 0; v < nV; v++) { const q = n.x * P[v * 3] + n.y * P[v * 3 + 1] + n.z * P[v * 3 + 2] - d; s[v] = q; const a = Math.abs(q); if (a < near) near = a; }
    if (near > 2e-3) break;
    d += 0.0137 * (tries + 1);
  }
  for (let v = 0; v < nV; v++) if (Math.abs(s[v]) < 1e-7) s[v] = 1e-7;
  // which separate solid (shell, add-on, joint...) each corner belongs to, so cut faces pair up right
  const par = new Int32Array(nV).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nT; t++) { const a = find(I[t * 3]), b = find(I[t * 3 + 1]), c = find(I[t * 3 + 2]); if (a !== b) par[a] = b; const b2 = find(b); if (find(c) !== b2) par[find(c)] = b2; }
  const compOf = new Map();
  const extra = [], emap = new Map(), pmap = new Map();
  const edgePt = (a, b) => {
    const key = a < b ? a * nV + b : b * nV + a;
    let id = emap.get(key);
    if (id === undefined) {
      const t = s[a] / (s[a] - s[b]);
      const x = P[a * 3] + (P[b * 3] - P[a * 3]) * t, y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t;
      // two edges can cross the plane at the very same spot (flat slivers on an earlier cut face): one point
      // (to 1/1000 mm, looking in the neighbouring cells too, so rounding can't split a pair)
      const qx = Math.round(x * 1000), qy = Math.round(y * 1000), qz = Math.round(z * 1000), comp = find(a);
      for (let i = -1; i <= 1 && id === undefined; i++) for (let j = -1; j <= 1 && id === undefined; j++) for (let k = -1; k <= 1 && id === undefined; k++) {
        const c = pmap.get((qx + i) + "," + (qy + j) + "," + (qz + k) + "|" + comp);
        if (c !== undefined && Math.abs(extra[(c - nV) * 3] - x) < 1e-3 && Math.abs(extra[(c - nV) * 3 + 1] - y) < 1e-3 && Math.abs(extra[(c - nV) * 3 + 2] - z) < 1e-3) id = c;
      }
      if (id === undefined) { id = nV + extra.length / 3; pmap.set(qx + "," + qy + "," + qz + "|" + comp, id); extra.push(x, y, z); compOf.set(id, comp); }
      emap.set(key, id);
    }
    return id;
  };
  const side = [{ T: [], L: [], cap: [] }, { T: [], L: [], cap: [] }]; // 0: negative, 1: positive
  const seam = [];
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], tag = m.tl[t];
    const sg = [s[a] > 0, s[b] > 0, s[c] > 0];
    if (sg[0] === sg[1] && sg[1] === sg[2]) { const S = side[sg[0] ? 1 : 0]; S.T.push(a, b, c); S.L.push(tag); continue; }
    const v = [a, b, c];
    let k = 0;
    for (; k < 3; k++) if (sg[k] !== sg[(k + 1) % 3] && sg[k] !== sg[(k + 2) % 3]) break;
    const L = v[k], O1 = v[(k + 1) % 3], O2 = v[(k + 2) % 3];
    const P1 = edgePt(L, O1), P2 = edgePt(L, O2);
    const lone = side[sg[k] ? 1 : 0], other = side[sg[k] ? 0 : 1];
    lone.T.push(L, P1, P2); lone.L.push(tag);
    other.T.push(P1, O1, O2, P1, O2, P2); other.L.push(tag, tag);
    lone.cap.push(P2, P1); other.cap.push(P1, P2);
    if (tag === TL.IN) {
      const ux = P[O1 * 3] - P[L * 3], uy = P[O1 * 3 + 1] - P[L * 3 + 1], uz = P[O1 * 3 + 2] - P[L * 3 + 2], wx = P[O2 * 3] - P[L * 3], wy = P[O2 * 3 + 1] - P[L * 3 + 1], wz = P[O2 * 3 + 2] - P[L * 3 + 2];
      const nr = V3(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx).normalize();
      seam.push({ ia: P1, ib: P2, nrm: nr });
    }
  }
  const allP = new Float32Array(P.length + extra.length);
  allP.set(P); allP.set(extra, P.length);
  for (const q of seam) { q.a = V3(allP[q.ia * 3], allP[q.ia * 3 + 1], allP[q.ia * 3 + 2]); q.b = V3(allP[q.ib * 3], allP[q.ib * 3 + 1], allP[q.ib * 3 + 2]); }
  // close each side with a flat face
  const U = Math.abs(n.x) < 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  U.sub(n.clone().multiplyScalar(U.dot(n))).normalize();
  const Vv = new THREE.Vector3().crossVectors(n, U);
  const to2 = (id) => { const x = allP[id * 3], y = allP[id * 3 + 1], z = allP[id * 3 + 2]; return new THREE.Vector2(x * U.x + y * U.y + z * U.z, x * Vv.x + y * Vv.y + z * Vv.z); };
  side.forEach((S, si) => {
    // walk the cut edges into loops; a corner where the section touches itself splits off a loop there
    const out = new Map();
    for (let k = 0; k < S.cap.length; k += 2) { const a = S.cap[k], b = S.cap[k + 1]; if (a === b) continue; if (!out.has(a)) out.set(a, []); out.get(a).push(b); }
    const loops = [];
    for (const st of out.keys()) {
      while (out.get(st).length) {
        const path = [st], pos = new Map([[st, 0]]);
        let cur = st;
        for (let g = 0; g < 400000; g++) {
          const l = out.get(cur);
          if (!l || !l.length) break;
          const nx = l.pop();
          if (pos.has(nx)) {
            const i = pos.get(nx), lp = path.splice(i);
            for (const v of lp) pos.delete(v);
            if (lp.length >= 3) loops.push(lp);
            path.push(nx); pos.set(nx, path.length - 1);
          } else { path.push(nx); pos.set(nx, path.length - 1); }
          cur = nx;
          if (path.length === 1 && !(out.get(cur) || []).length) break;
        }
      }
    }
    // the face's normal: +n for the negative side, -n for the positive side
    const sgn = si === 0 ? 1 : -1;
    const L2 = loops.map((lp) => { const pts = lp.map(to2); let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return { lp, pts, area: (a / 2) * sgn, comp: compOf.get(lp[0]) }; });
    const outers = L2.filter((l) => l.area > 0).sort((a, b) => a.area - b.area), holes = L2.filter((l) => l.area < 0);
    const groups = outers.map((o) => ({ o, h: [] }));
    const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
    for (const h of holes) { const g = groups.find((gg) => gg.o.comp === h.comp && inside(h.pts[0], gg.o.pts)) || groups.find((gg) => inside(h.pts[0], gg.o.pts)); if (g) g.h.push(h); }
    for (const g of groups) {
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(g.o.pts.map((p) => p.clone()), g.h.map((h) => h.pts.map((p) => p.clone()))); } catch (e) { continue; }
      const ids = [...g.o.lp, ...g.h.flatMap((h) => h.lp)], pts = [...g.o.pts, ...g.h.flatMap((h) => h.pts)];
      for (const [a, b, c] of tris) {
        const A = pts[a], Bp = pts[b], Cp = pts[c], ar = ((Bp.x - A.x) * (Cp.y - A.y) - (Bp.y - A.y) * (Cp.x - A.x)) * sgn;
        if (ar >= 0) S.T.push(ids[a], ids[b], ids[c]); else S.T.push(ids[a], ids[c], ids[b]);
        S.L.push(TL.CAP);
      }
    }
  });
  // slivers the cut-face filler skipped: close any holes left (walking edges, so pinched loops work too)
  for (const S of side) {
    const E = new Map(), T = S.T;
    for (let k = 0; k < T.length; k += 3) for (let e = 0; e < 3; e++) { const a = T[k + e], b = T[k + ((e + 1) % 3)]; const key = a < b ? a + "_" + b : b + "_" + a; const r = E.get(key); if (r) r.n++; else E.set(key, { n: 1, a, b }); }
    const out = new Map();
    let cnt = 0;
    for (const r of E.values()) if (r.n === 1) { if (!out.has(r.b)) out.set(r.b, []); out.get(r.b).push(r.a); cnt++; }
    if (!cnt || cnt > 20000) continue;
    for (const st of [...out.keys()]) {
      while (out.get(st) && out.get(st).length) {
        const lp = [st]; let cur = out.get(st).pop(), guard = 0;
        while (cur !== st && guard++ < 20000) { lp.push(cur); const l = out.get(cur); if (!l || !l.length) break; cur = l.pop(); }
        if (cur !== st || lp.length < 3) continue;
        const pts = lp.map((id) => { const v = to2(id); return [v.x, v.y]; });
        let tris = earclip(pts);
        if (tris.length !== lp.length - 2) { tris = []; for (let i = 1; i < lp.length - 1; i++) tris.push([0, i, i + 1]); }
        for (const [a, b, c] of tris) { T.push(lp[a], lp[b], lp[c]); S.L.push(TL.CAP); }
      }
    }
  }
  const pack = (S) => {
    const used = new Map(), V = [], idx = [], tl = [];
    for (let k = 0; k < S.T.length; k += 3) {
      const a = S.T[k], b = S.T[k + 1], c = S.T[k + 2];
      if (a === b || b === c || a === c) continue;
      for (const v of [a, b, c]) { let id = used.get(v); if (id === undefined) { id = V.length / 3; used.set(v, id); V.push(allP[v * 3], allP[v * 3 + 1], allP[v * 3 + 2]); } idx.push(id); }
      tl.push(S.L[k / 3]);
    }
    return { pos: new Float32Array(V), idx: new Uint32Array(idx), tl: new Float32Array(tl) };
  };
  return { neg: pack(side[0]), pos: pack(side[1]), seam };
}

// pieces that don't touch become separate; add-ons sunk into a shell stay with it
export function components(m, near = 3.2) {
  const nV = m.pos.length / 3, nT = m.idx.length / 3;
  if (!nT) return [];
  const par = new Int32Array(nV).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let t = 0; t < nT; t++) { uni(m.idx[t * 3], m.idx[t * 3 + 1]); uni(m.idx[t * 3], m.idx[t * 3 + 2]); }
  const used = new Uint8Array(nV);
  for (let k = 0; k < m.idx.length; k++) used[m.idx[k]] = 1;
  // join groups whose corners share a small cell of space
  const cells = new Map(), P = m.pos;
  for (let v = 0; v < nV; v++) {
    if (!used[v]) continue;
    const key = Math.floor(P[v * 3] / near) + "," + Math.floor(P[v * 3 + 1] / near) + "," + Math.floor(P[v * 3 + 2] / near);
    const o = cells.get(key);
    if (o === undefined) cells.set(key, v); else uni(o, v);
  }
  // and the neighbouring cells (small add-ons like rivets can sit between a shell's corners)
  for (const [key, v] of cells) {
    const [x, y, z] = key.split(",").map(Number);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if (!a && !b && !c) continue;
      const o = cells.get((x + a) + "," + (y + b) + "," + (z + c));
      if (o !== undefined && find(o) !== find(v)) { const dx = P[o * 3] - P[v * 3], dy = P[o * 3 + 1] - P[v * 3 + 1], dz = P[o * 3 + 2] - P[v * 3 + 2]; if (dx * dx + dy * dy + dz * dz < near * near * 2.5) uni(o, v); }
    }
  }
  const groups = new Map();
  for (let t = 0; t < nT; t++) { const r = find(m.idx[t * 3]); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(t); }
  const out = [];
  for (const tris of groups.values()) {
    const map = new Map(), V = [], idx = new Uint32Array(tris.length * 3), tl = new Float32Array(tris.length);
    tris.forEach((t, k) => { for (let e = 0; e < 3; e++) { const v = m.idx[t * 3 + e]; let id = map.get(v); if (id === undefined) { id = V.length / 3; map.set(v, id); V.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } idx[k * 3 + e] = id; } tl[k] = m.tl[t]; });
    // specks from the cut (tiny slivers) are dropped
    const piece = { pos: new Float32Array(V), idx, tl };
    if (Math.abs(solidVolume(piece)) > 1) out.push(piece);
  }
  // biggest first, so names stay steady
  return out.sort((a, b) => b.idx.length - a.idx.length);
}

export function centroid(m) { const P = m.pos, n = P.length / 3; let x = 0, y = 0, z = 0; for (let i = 0; i < P.length; i += 3) { x += P[i]; y += P[i + 1]; z += P[i + 2]; } return V3(x / n, y / n, z / n); }
function crosses(m, n, d) { let lo = Infinity, hi = -Infinity; const P = m.pos; for (let i = 0; i < P.length; i += 3) { const s = n.x * P[i] + n.y * P[i + 1] + n.z * P[i + 2] - d; if (s < lo) lo = s; if (s > hi) hi = s; } return lo < -0.01 && hi > 0.01; }

// cuts: [{ n: Vector3, d, seed: Vector3 | null }] in the same space as the solid
export function applyCuts(solid, cuts) {
  let pieces = components(solid);
  const seams = [];
  cuts.forEach((c, k) => {
    let targets = pieces.map((_, i) => i);
    if (c.seed) {
      let bi = -1, bd = Infinity;
      pieces.forEach((p, i) => { if (!crosses(p, c.n, c.d)) return; const dd = centroid(p).distanceTo(c.seed); if (dd < bd) { bd = dd; bi = i; } });
      targets = bi >= 0 ? [bi] : [];
    }
    const next = [];
    pieces.forEach((p, i) => {
      if (!targets.includes(i) || !crosses(p, c.n, c.d)) { next.push(p); return; }
      const r = splitSolid(p, c.n, c.d);
      const a = components(r.neg), b = components(r.pos);
      if (!a.length || !b.length) { next.push(p); return; }
      next.push(...a, ...b);
      seams.push({ k, n: c.n.clone(), d: c.d, segs: r.seam, joint: c.joint });
    });
    pieces = next;
  });
  return { pieces, seams };
}

// ----------------------------------------------------------------------------- joints
export const JOINTS = [
  { id: "none", name: "None (glue)" }, { id: "peg", name: "Peg and hole" }, { id: "snap", name: "Snap clip" },
  { id: "slide", name: "Slide-in dovetail" }, { id: "magnet", name: "Magnet cups" },
];
export const MAGNETS = { "6x2": [6, 2], "8x3": [8, 3], "10x3": [10, 3], "12x3": [12, 3] };
export const defaultJoint = () => ({ type: "peg", size: 1, spacing: 70, clear: 0.3, flip: false, magnet: "8x3" });

function chain(segs) {
  const key = (v) => Math.round(v.x * 1e3) + "," + Math.round(v.y * 1e3) + "," + Math.round(v.z * 1e3);
  const adj = new Map();
  segs.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = key(p); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    // walk to one end first
    let cur = i, from = segs[i].a, guard = 0;
    for (;;) { const k = key(from), nb = (adj.get(k) || []).find((j) => j !== cur && !used[j]); if (nb === undefined || guard++ > segs.length) break; const s = segs[nb]; from = key(s.a) === k ? s.b : s.a; cur = nb; if (cur === i) break; }
    const line = [];
    let at = from, c2 = cur;
    const seen = new Set();
    while (c2 !== undefined && !used[c2] && !seen.has(c2)) {
      seen.add(c2); used[c2] = 1;
      const s = segs[c2], k = key(at), to = key(s.a) === k ? s.b : s.a;
      line.push({ p: at.clone(), q: to.clone(), nrm: s.nrm });
      at = to;
      c2 = (adj.get(key(at)) || []).find((j) => !used[j]);
    }
    if (line.length) lines.push(line);
  }
  return lines;
}

function rayTri(o, d, a, b, c) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, tx = o.x - a[0], ty = o.y - a[1], tz = o.z - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-6 || u > 1 + 1e-6) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv; if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
// the inside surface of a piece near p, as a height along Nn over a small (s, t) grid
function heightField(piece, p, S, T, Nn, s0, s1, t0, t1, step = 1.5) {
  const P = piece.pos, I = piece.idx, cand = [];
  const R2 = (Math.max(Math.abs(s0), Math.abs(s1)) + Math.max(Math.abs(t0), Math.abs(t1)) + 10) ** 2;
  for (let t = 0; t < I.length / 3; t++) {
    if (piece.tl[t] !== TL.IN) continue;
    const a = I[t * 3] * 3;
    const dx = P[a] - p.x, dy = P[a + 1] - p.y, dz = P[a + 2] - p.z;
    if (dx * dx + dy * dy + dz * dz > R2) continue;
    const b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    cand.push([P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]);
  }
  const ns = Math.max(2, Math.ceil((s1 - s0) / step) + 1), nt = Math.max(2, Math.ceil((t1 - t0) / step) + 1);
  const H = new Float32Array(ns * nt).fill(NaN);
  const o = new THREE.Vector3();
  let hits = 0;
  for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
    const s = s0 + ((s1 - s0) * i) / (ns - 1), t = t0 + ((t1 - t0) * j) / (nt - 1);
    o.copy(p).addScaledVector(S, s).addScaledVector(T, t).addScaledVector(Nn, -8);
    let best = Infinity;
    for (let k = 0; k < cand.length; k += 3) { const h = rayTri(o, Nn, cand[k], cand[k + 1], cand[k + 2]); if (h > 0 && h < best) best = h; }
    if (best < 30) { H[j * ns + i] = best - 8; hits++; }
  }
  if (hits < 3) return null;
  // fill gaps (past the edge of the piece) from the nearest sample
  for (let pass = 0; pass < ns + nt; pass++) {
    let left = 0;
    for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
      const k = j * ns + i; if (!isNaN(H[k])) continue;
      let sum = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= ns || jj >= nt) continue; const v = H[jj * ns + ii]; if (!isNaN(v)) { sum += v; c++; } }
      if (c) H[k] = sum / c; else left++;
    }
    if (!left) break;
  }
  const at = (s, t) => {
    const x = Math.max(0, Math.min(ns - 1, ((s - s0) / (s1 - s0)) * (ns - 1))), y = Math.max(0, Math.min(nt - 1, ((t - t0) / (t1 - t0)) * (nt - 1)));
    const i = Math.min(ns - 2, Math.floor(x)), j = Math.min(nt - 2, Math.floor(y)), fx = x - i, fy = y - j;
    const g = (a, b) => H[b * ns + a];
    return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fy) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
  };
  return at;
}
// a slab that follows a height field: top(s, t) along Nn, thickness th(s, t), outline f(s, t) > 0
function slab(p, S, T, Nn, s0, s1, t0, t1, top, th, f, res = 0.7) {
  const desc = {
    nu: Math.max(2, Math.ceil((s1 - s0) / res)), nv: Math.max(2, Math.ceil((t1 - t0) / res)), closedU: false,
    point: (u, v, out) => { const s = s0 + u * (s1 - s0), t = t0 + v * (t1 - t0); return out.copy(p).addScaledVector(S, s).addScaledVector(T, t).addScaledVector(Nn, top(s, t)); },
    radial: (u, v, out) => out.copy(Nn),
  };
  return weld(buildShell(desc, (u, v) => {
    const s = s0 + u * (s1 - s0), t = t0 + v * (t1 - t0);
    const border = Math.min(u * (s1 - s0), (1 - u) * (s1 - s0), v * (t1 - t0), (1 - v) * (t1 - t0));
    return { f: Math.min(border, f ? f(s, t) : Infinity), off: 0, th: th(s, t) };
  }, { out: TL.JOINT, inn: TL.JOINT, wall: TL.JOINT }));
}

// the joint parts for one spot on a seam: { a: [solids for the negative side], b: [...] }
function jointAt(J, p, S, T, Nn, A, Bp) {
  const k = Math.max(0.6, Math.min(2, J.size || 1)), c = J.clear ?? 0.3, emb = 0.8;
  const La = 14 * k, Lb = 18 * k;
  const hA = heightField(A, p, S, T, Nn, -La - 2, 0.5, -14 * k, 14 * k);
  const hB = heightField(Bp, p, S, T, Nn, -0.5, Lb + 8, -14 * k, 14 * k);
  if (!hA || !hB) return null;
  const h = (s, t) => (s < 0 ? hA(s, t) : hB(s, t));
  const out = { a: [], b: [] };
  if (J.type === "peg") {
    const w = 12 * k, tabT = Math.max(2, 2.4 * k), rp = 2.3 * k, sp = Lb * 0.55;
    out.a.push(slab(p, S, T, Nn, -La, 0, -w / 2, w / 2, (s, t) => hA(s, t) - emb, () => emb + c + tabT));
    out.a.push(slab(p, S, T, Nn, -La * 0.6, Lb, -w / 2, w / 2, (s, t) => h(s, t) + c, () => tabT, (s, t) => SD.sub(SD.box(s, t, (Lb - La * 0.6) / 2, 0, (Lb + La * 0.6) / 2, w / 2, 2.5), SD.circle(s, t, sp, 0, rp + 0.25))));
    const z0 = hB(sp, 0) - emb, z1 = hB(sp, 0) + c + tabT + 0.6;
    out.b.push(lathe([[0, z0], [rp, z0], [rp, z1 - 0.5], [rp - 0.5, z1], [0, z1]], p.clone().addScaledVector(S, sp), Nn, 20, TL.JOINT));
  } else if (J.type === "snap") {
    const w = 8 * k, g = 1.2, armT = Math.max(1.4, 1.6 * k), sb = 5 * k, br = 2.5, bh = 1.2, sv = sb + 4 + 0.15, tip = sv + br + 0.8;
    out.a.push(slab(p, S, T, Nn, -La, 0, -w / 2 - 1, w / 2 + 1, (s, t) => hA(s, t) - emb, () => emb + g + armT));
    out.a.push(slab(p, S, T, Nn, -La * 0.6, tip, -w / 2, w / 2, (s, t) => h(s, t) + g, () => armT, (s, t) => SD.box(s, t, (tip - La * 0.6) / 2, 0, (tip + La * 0.6) / 2, w / 2, 1.2)));
    const nb = hB(sv, 0) + g + armT - 0.3;
    out.a.push(extrude([[sv, nb], [sv + br, nb], [sv, nb + bh]], [], p.clone().addScaledVector(T, -(w / 2 - 0.5)), S, Nn, T, w - 1, TL.JOINT));
    const T0 = w / 2 + c, T1 = T0 + 1.8 * k;
    let hmin = Infinity, hmax = -Infinity;
    for (const ss of [sb, sb + 2, sb + 4]) for (const tt of [-T1, -T0, 0, T0, T1]) { const v = hB(ss, tt); hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
    const nTop = hmin - emb, nChan = hmax + g + armT + c, nBot = nChan + 1.8 * k;
    out.b.push(extrude([[-T1, nTop], [-T0, nTop], [-T0, nChan], [T0, nChan], [T0, nTop], [T1, nTop], [T1, nBot], [-T1, nBot]], [], p.clone().addScaledVector(S, sb), T, Nn, S, 4, TL.JOINT));
  } else if (J.type === "slide") {
    const w0 = 8 * k, w1 = 14 * k, Lt = 14 * k, tabT = Math.max(2, 2.4 * k), W2 = w1 / 2 + 2;
    out.a.push(slab(p, S, T, Nn, -La, 0, -W2, W2, (s, t) => hA(s, t) - emb, () => emb + c + tabT));
    const tongue = [[-La * 0.6, -W2], [0, -W2], [0, -w0 / 2], [Lt, -w1 / 2], [Lt, w1 / 2], [0, w0 / 2], [0, W2], [-La * 0.6, W2]];
    out.a.push(slab(p, S, T, Nn, -La * 0.6, Lt, -W2, W2, (s, t) => h(s, t) + c, () => tabT, (s, t) => SD.poly(s, t, tongue)));
    const pocket = [[-5, -w0 / 2], [0, -w0 / 2], [Lt, -w1 / 2], [Lt, w1 / 2], [0, w0 / 2], [-5, w0 / 2]];
    const Ws = w1 / 2 + 4;
    out.b.push(slab(p, S, T, Nn, 0, Lt + 4, -Ws, Ws, (s, t) => hB(s, t) - emb, () => emb + c + tabT, (s, t) => SD.sub(SD.box(s, t, (Lt + 4) / 2, 0, (Lt + 4) / 2, Ws, 2), SD.poly(s, t, pocket) + 0.25)));
  } else if (J.type === "magnet") {
    const [md, mh] = MAGNETS[J.magnet] || MAGNETS["8x3"];
    const r = md / 2 + 0.15, dp = mh + 0.25, R = r + 1.8, Lm = dp + 1.6;
    const zc = hA(-0.5, 0) + R - 1.0;
    const prof = [[0, dp], [r, dp], [r, 0], [R, 0], [R, Lm], [0, Lm]];
    out.a.push(lathe(prof, p.clone().addScaledVector(Nn, zc), S.clone().negate(), 28, TL.JOINT));
    out.b.push(lathe(prof, p.clone().addScaledVector(Nn, zc), S.clone(), 28, TL.JOINT));
  }
  return out;
}

// add joints along every seam that asks for them; pieces gain the joint solids
export function addJoints(pieces, seams, allCuts) {
  const adds = pieces.map(() => []);
  const found = [];
  for (const sm of seams) {
    const J = sm.joint;
    if (!J || J.type === "none") continue;
    const k = Math.max(0.6, Math.min(2, J.size || 1)), margin = 16 * k, spacing = Math.max(25, J.spacing || 70);
    for (const line of chain(sm.segs)) {
      const len = line.reduce((a, s) => a + s.p.distanceTo(s.q), 0);
      if (len < margin * 1.6) continue;
      const n = Math.max(1, Math.floor((len - 2 * margin) / spacing) + 1);
      const step = n > 1 ? (len - 2 * margin) / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        const want = n > 1 ? margin + i * step : len / 2;
        let acc = 0, seg = line[0], f = 0;
        for (const s of line) { const l = s.p.distanceTo(s.q); if (acc + l >= want) { seg = s; f = (want - acc) / (l || 1); break; } acc += l; }
        const p = seg.p.clone().lerp(seg.q, f);
        let Sd = sm.n.clone();
        if (J.flip) Sd.negate();
        const Nn = seg.nrm.clone().sub(Sd.clone().multiplyScalar(seg.nrm.dot(Sd))).normalize();
        if (!isFinite(Nn.x) || Nn.lengthSq() < 0.5) continue;
        const T = new THREE.Vector3().crossVectors(Sd, Nn).normalize();
        // stay away from the other cuts
        if (allCuts.some((c, ci) => ci !== sm.k && Math.abs(c.n.dot(p) - c.d) < 14 * k)) continue;
        const pick = (sign) => {
          let bi = -1, bd = Infinity;
          pieces.forEach((pc, pi) => {
            const P = pc.pos;
            for (let v = 0; v < P.length; v += 3) {
              const dx = P[v] - p.x, dy = P[v + 1] - p.y, dz = P[v + 2] - p.z;
              if ((dx * Sd.x + dy * Sd.y + dz * Sd.z) * sign < 0.05) continue;
              const dd = dx * dx + dy * dy + dz * dz;
              if (dd < bd) { bd = dd; bi = pi; }
            }
          });
          return bd < 64 ? bi : -1;
        };
        const ia = pick(-1), ib = pick(1);
        if (ia < 0 || ib < 0 || ia === ib) continue;
        const r = jointAt(J, p, Sd, T, Nn, pieces[ia], pieces[ib]);
        if (!r) continue;
        adds[ia].push(...r.a); adds[ib].push(...r.b);
        found.push({ p, type: J.type });
      }
    }
  }
  return { pieces: pieces.map((pc, i) => (adds[i].length ? merge([pc, ...adds[i]]) : pc)), joints: found };
}

// ----------------------------------------------------------------------------- printer fit
export const PRINTERS = [
  { id: "256", name: "256 × 256 × 256 mm (Bambu X1/P1, A1)", bed: [256, 256, 256] },
  { id: "180", name: "180 × 180 × 180 mm (Bambu A1 mini)", bed: [180, 180, 180] },
  { id: "220", name: "220 × 220 × 250 mm (Ender 3, Kobra)", bed: [220, 220, 250] },
  { id: "235", name: "235 × 235 × 250 mm (Ender 3 V2/S1)", bed: [235, 235, 250] },
  { id: "250", name: "250 × 210 × 220 mm (Prusa MK4)", bed: [250, 210, 220] },
  { id: "300", name: "300 × 300 × 300 mm (large format)", bed: [300, 300, 300] },
  { id: "350", name: "350 × 350 × 350 mm (Voron 350)", bed: [350, 350, 350] },
  { id: "400", name: "400 × 400 × 450 mm (Ender 5 Max, Neptune Max)", bed: [400, 400, 450] },
];
function pca(m) {
  const c = centroid(m), P = m.pos, C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const st = Math.max(1, Math.floor(P.length / 3 / 6000));
  for (let i = 0; i < P.length; i += 3 * st) { const d = [P[i] - c.x, P[i + 1] - c.y, P[i + 2] - c.z]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  // power iteration with deflation
  const axes = [];
  let M = C.map((r) => r.slice());
  for (let k = 0; k < 2; k++) {
    let v = [1, 0.3 + k, 0.2];
    for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map((a) => M[a][0] * v[0] + M[a][1] * v[1] + M[a][2] * v[2]); const l = Math.hypot(...w) || 1; v = w.map((x) => x / l); }
    const ax = V3(...v);
    for (const q of axes) ax.sub(q.clone().multiplyScalar(ax.dot(q)));
    ax.normalize(); axes.push(ax);
    const lam = [0, 1, 2].reduce((s, a) => s + v[a] * (M[a][0] * v[0] + M[a][1] * v[1] + M[a][2] * v[2]), 0);
    M = M.map((r, a) => r.map((x, b) => x - lam * v[a] * v[b]));
  }
  axes.push(new THREE.Vector3().crossVectors(axes[0], axes[1]).normalize());
  return { c, axes };
}
function extentsAlong(m, axes) {
  const P = m.pos, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const a = axes[k], v = P[i] * a.x + P[i + 1] * a.y + P[i + 2] * a.z; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return hi.map((h, k) => h - lo[k]);
}
// the best way to stand a piece on the bed: { fits, ext: [x, y, z], R: Matrix4 (rotation) }
export function fitBed(m, bed, margin = 4) {
  const b = bed.map((v) => v - margin);
  const { axes } = pca(m);
  const frames = [[V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)], axes];
  let best = null;
  for (const F of frames) for (let k = 0; k < 3; k++) for (const ang of [0, 15, 30, 45, 60, 75]) {
    const ax = F[k], a1 = F[(k + 1) % 3].clone().applyAxisAngle(ax, (ang * Math.PI) / 180), a2 = new THREE.Vector3().crossVectors(ax, a1);
    const A = [a1, a2, ax], e = extentsAlong(m, A);
    // put the shortest side up (thin shells lie flatter), the others on the bed's long sides
    const order = [0, 1, 2].sort((i, j) => e[j] - e[i]);
    const bo = [0, 1, 2].sort((i, j) => b[j] - b[i]);
    let fit = true, worst = 0;
    const map = [null, null, null];
    for (let q = 0; q < 3; q++) { const ratio = e[order[q]] / b[bo[q]]; worst = Math.max(worst, ratio); if (ratio > 1) fit = false; map[bo[q]] = order[q]; }
    if (!best || worst < best.worst) best = { worst, fit, A, map, e };
  }
  const X = best.A[best.map[0]].clone(), Y = best.A[best.map[1]].clone(), Z = new THREE.Vector3().crossVectors(X, Y);
  const R = new THREE.Matrix4().makeBasis(X, Y, Z).transpose();
  return { fits: best.fit, ext: [best.e[best.map[0]], best.e[best.map[1]], best.e[best.map[2]]], R, worst: best.worst };
}
// where to cut so every piece fits: returns cuts [{ n, d, seed }] (applied in order)
export function autoCuts(pieces, bed, maxCuts = 14) {
  const cuts = [];
  let list = pieces.slice();
  for (let it = 0; it < maxCuts; it++) {
    const bad = list.findIndex((p) => !fitBed(p, bed).fits);
    if (bad < 0) break;
    const p = list[bad], { axes } = pca(p), e = extentsAlong(p, axes);
    let n = axes[0].clone();
    // a cut square to the world reads better when it's close
    for (const w of [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)]) if (Math.abs(n.dot(w)) > Math.cos((22 * Math.PI) / 180)) { n = w.clone().multiplyScalar(Math.sign(n.dot(w))); break; }
    void e;
    const P = p.pos; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < P.length; i += 3) { const v = P[i] * n.x + P[i + 1] * n.y + P[i + 2] * n.z; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    let d = (lo + hi) / 2;
    const seed = centroid(p);
    const r = splitSolid(p, n, d), a = components(r.neg), b = components(r.pos);
    if (!a.length || !b.length) break;
    list.splice(bad, 1, ...a, ...b);
    cuts.push({ n, d, seed });
  }
  return { cuts, fits: list.every((p) => fitBed(p, bed).fits), count: list.length };
}
export { V3 };
