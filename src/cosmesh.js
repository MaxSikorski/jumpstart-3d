// CosForge mesh tools: the masked-grid shell builder (every costume form is a thin shell over a
// parametric surface, trimmed by a 2D outline), small solids (lathe, extrusions, tubes), welding,
// merging and display geometry. Solids are { pos: Float32Array, idx: Uint32Array, tl: Float32Array }
// where tl is a tag per triangle: 0 outside, 1 inside (the side facing the body), 0.5 edge wall,
// 2 add-on, 3 joint, 4 accent colour, 5 cut face.
import * as THREE from "three";

export const TL = { OUT: 0, IN: 1, WALL: 0.5, ADD: 2, JOINT: 3, ACCENT: 4, CAP: 5 };

// ----------------------------------------------------------------------------- 2D ear clipping
function area2(P) { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function earclip(P) {
  const n = P.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = [...Array(n).keys()];
  if (area2(P) < 0) idx.reverse();
  const out = [];
  const isEar = (a, b, c, list) => {
    const A = P[a], B = P[b], C = P[c];
    if ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) <= 1e-12) return false;
    for (const k of list) {
      if (k === a || k === b || k === c) continue;
      const p = P[k];
      const d1 = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
      const d2 = (C[0] - B[0]) * (p[1] - B[1]) - (C[1] - B[1]) * (p[0] - B[0]);
      const d3 = (A[0] - C[0]) * (p[1] - C[1]) - (A[1] - C[1]) * (p[0] - C[0]);
      if (d1 >= 0 && d2 >= 0 && d3 >= 0) return false;
    }
    return true;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let found = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (isEar(a, b, c, idx)) { out.push([a, b, c]); idx.splice(i, 1); found = true; break; }
    }
    if (!found) { // give up gracefully: fan the rest
      for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]);
      return orientTris(out, P, area2(P) >= 0);
    }
  }
  out.push([idx[0], idx[1], idx[2]]);
  return orientTris(out, P, area2(P) >= 0);
}
// earclip works on a counter-clockwise copy: give the triangles back in the polygon's own turning
function orientTris(T, P, ccw) {
  if (ccw) return T;
  return T.map(([a, b, c]) => [a, c, b]);
}

// ----------------------------------------------------------------------------- the shell builder
// desc: { nu, nv, closedU, point(u, v, out), radial(u, v, out) (a rough outward direction) }
// nodeFn(u, v) -> { f (outline: > 0 inside, about mm from the edge), off (inner surface offset), th (thickness) }
export function buildShell(desc, nodeFn, tags = { out: TL.OUT, inn: TL.IN, wall: TL.WALL }) {
  const nu = desc.nu, nv = desc.nv, closed = !!desc.closedU;
  const NU = closed ? nu : nu + 1, NV = nv + 1;
  const F = new Float32Array(NU * NV), OFF = new Float32Array(NU * NV), TH = new Float32Array(NU * NV), ACC = new Float32Array(NU * NV);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const r = nodeFn(i / nu, j / nv), k = j * NU + i;
    let f = r.f; if (!(Math.abs(f) >= 1e-3)) f = f < 0 ? -1e-3 : 1e-3;
    F[k] = f; OFF[k] = r.off || 0; TH[k] = Math.max(0.5, r.th); ACC[k] = r.acc || 0;
  }
  const node = (i, j) => j * NU + (closed ? ((i % nu) + nu) % nu : i);
  const VU = [], VV = [], VO = [], VT = [], VA = [];
  const vmap = new Map();
  const cornerV = (i, j) => {
    const k = node(i, j), key = "c" + k;
    let id = vmap.get(key);
    if (id === undefined) { id = VU.length; vmap.set(key, id); VU.push(i / nu); VV.push(j / nv); VO.push(OFF[k]); VT.push(TH[k]); VA.push(ACC[k]); }
    return id;
  };
  const edgeV = (ia, ja, ib, jb) => {
    let ka = node(ia, ja), kb = node(ib, jb);
    const fa = F[ka], fb = F[kb], t = fa / (fa - fb);
    const key = ka < kb ? "e" + ka + "_" + kb : "e" + kb + "_" + ka;
    let id = vmap.get(key);
    if (id === undefined) {
      id = VU.length; vmap.set(key, id);
      VU.push((ia + (ib - ia) * t) / nu); VV.push((ja + (jb - ja) * t) / nv);
      VO.push(OFF[ka] + (OFF[kb] - OFF[ka]) * t); VT.push(TH[ka] + (TH[kb] - TH[ka]) * t); VA.push(ACC[ka] + (ACC[kb] - ACC[ka]) * t);
    }
    return id;
  };
  const faces = [], walls = [];
  const CM = [1 | 8, 1 | 2, 2 | 4, 4 | 8];
  const DI = [0, 1, 1, 0], DJ = [0, 0, 1, 1];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const ci = DI.map((d) => i + d), cj = DJ.map((d) => j + d);
    const fs = [0, 1, 2, 3].map((c) => F[node(ci[c], cj[c])]);
    const ins = fs.map((f) => f >= 0);
    if (!ins[0] && !ins[1] && !ins[2] && !ins[3]) continue;
    const poly = [];
    for (let e = 0; e < 4; e++) {
      const a = e, b = (e + 1) % 4;
      if (ins[a]) poly.push({ id: cornerV(ci[a], cj[a]), m: CM[a], x: false, p: [DI[a], DJ[a]] });
      if (ins[a] !== ins[b]) {
        const t = fs[a] / (fs[a] - fs[b]);
        poly.push({ id: edgeV(ci[a], cj[a], ci[b], cj[b]), m: 1 << e, x: true, p: [DI[a] + (DI[b] - DI[a]) * t, DJ[a] + (DJ[b] - DJ[a]) * t] });
      }
    }
    if (poly.length < 3) continue;
    if (poly.length === 4 && !poly.some((q) => q.x)) faces.push([poly[0].id, poly[1].id, poly[2].id], [poly[0].id, poly[2].id, poly[3].id]);
    else for (const [a, b, c] of earclip(poly.map((q) => q.p))) faces.push([poly[a].id, poly[b].id, poly[c].id]);
    // edges of the cut outline, and edges on the border of an open grid, get a wall
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      let wall = p.x && q.x;
      if (!wall) {
        const m = p.m & q.m;
        if (m) {
          const e = Math.log2(m) | 0;
          if ((e === 0 && j === 0) || (e === 2 && j === nv - 1) || (!closed && ((e === 1 && i === nu - 1) || (e === 3 && i === 0)))) wall = true;
        }
      }
      if (wall && p.id !== q.id) walls.push([p.id, q.id]);
    }
  }
  // positions: inner surface at the offset, outer surface a thickness further out
  const nV = VU.length;
  const pos = new Float32Array((nV * 2 + walls.length * 4) * 3), uv = new Float32Array((nV * 2 + walls.length * 4) * 2);
  const B = new THREE.Vector3(), N = new THREE.Vector3();
  for (let k = 0; k < nV; k++) {
    surfaceAt(desc, VU[k], VV[k], B, N);
    const o = VO[k], t = VT[k];
    pos.set([B.x + N.x * (o + t), B.y + N.y * (o + t), B.z + N.z * (o + t)], k * 3);
    pos.set([B.x + N.x * o, B.y + N.y * o, B.z + N.z * o], (nV + k) * 3);
    uv.set([VU[k], VV[k]], k * 2); uv.set([VU[k], VV[k]], (nV + k) * 2);
  }
  const idx = [], tl = [];
  // outside faces marked as glowing (light lines, emblems) take the accent colour
  for (const [a, b, c] of faces) { idx.push(a, b, c); tl.push(VA[a] + VA[b] + VA[c] > 1.5 ? (tags.acc ?? TL.ACCENT) : tags.out); idx.push(nV + a, nV + c, nV + b); tl.push(tags.inn); }
  let w = nV * 2;
  for (const [a, b] of walls) {
    // copies, so the edge stays crisp in the display
    const oa = w, ob = w + 1, ia = w + 2, ib = w + 3;
    for (const [dst, src] of [[oa, a], [ob, b], [ia, nV + a], [ib, nV + b]]) { pos.copyWithin(dst * 3, src * 3, src * 3 + 3); uv.copyWithin(dst * 2, src * 2, src * 2 + 2); }
    idx.push(ob, oa, ia, ob, ia, ib); tl.push(tags.wall, tags.wall);
    w += 4;
  }
  const m = { pos, idx: new Uint32Array(idx), tl: new Float32Array(tl), uv };
  if (solidVolume(m) < 0) flip(m);
  return m;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
// the surface point and its outward normal (found by small steps; poles fall back to desc.radial)
export function surfaceAt(desc, u, v, P, N) {
  desc.point(u, v, P);
  const e = 1e-4;
  desc.point(u + e, v, _a); desc.point(u - e, v, _b); _a.sub(_b);
  desc.point(u, v + e, _c); desc.point(u, v - e, _d); _c.sub(_d);
  N.crossVectors(_a, _c);
  const l = N.length();
  const r = desc.radial(u, v, _b);
  if (l < 1e-9 * Math.max(1, _a.length() * _c.length())) N.copy(r).normalize();
  else { N.multiplyScalar(1 / l); if (N.dot(r) < 0) N.negate(); }
  return P;
}

export function solidVolume(m) {
  const P = m.pos, I = m.idx;
  let v = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
// make every triangle turn the same way as its neighbours (walks across shared edges), then face outward
export function orientConsistent(m) {
  const I = m.idx, nT = I.length / 3, E = new Map();
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) { const a = I[t * 3 + e], b = I[t * 3 + ((e + 1) % 3)]; const k = a < b ? a + "_" + b : b + "_" + a; const l = E.get(k); if (l) l.push(t); else E.set(k, [t]); }
  const done = new Uint8Array(nT);
  let flips = 0;
  const has = (t, a, b) => { for (let e = 0; e < 3; e++) if (I[t * 3 + e] === a && I[t * 3 + ((e + 1) % 3)] === b) return true; return false; };
  for (let s0 = 0; s0 < nT; s0++) {
    if (done[s0]) continue;
    done[s0] = 1;
    const stack = [s0];
    while (stack.length) {
      const t = stack.pop();
      for (let e = 0; e < 3; e++) {
        const a = I[t * 3 + e], b = I[t * 3 + ((e + 1) % 3)], l = E.get(a < b ? a + "_" + b : b + "_" + a);
        if (!l || l.length !== 2) continue;
        const o = l[0] === t ? l[1] : l[0];
        if (done[o]) continue;
        // the neighbour must run this edge the other way (b -> a)
        if (has(o, a, b)) { const x = I[o * 3 + 1]; I[o * 3 + 1] = I[o * 3 + 2]; I[o * 3 + 2] = x; flips++; }
        done[o] = 1; stack.push(o);
      }
    }
  }
  return flips;
}
export function flip(m) { const I = m.idx; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } return m; }

// one solid out of many (no welding between them; they may overlap, as add-ons do)
export function merge(list) {
  list = list.filter((m) => m && m.idx.length);
  let nv = 0, ni = 0;
  for (const m of list) { nv += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(nv), idx = new Uint32Array(ni), tl = new Float32Array(ni / 3);
  let vo = 0, io = 0;
  for (const m of list) {
    pos.set(m.pos, vo);
    for (let k = 0; k < m.idx.length; k++) idx[io + k] = m.idx[k] + vo / 3;
    tl.set(m.tl, io / 3);
    vo += m.pos.length; io += m.idx.length;
  }
  return { pos, idx, tl };
}

// join corners at the same spot (to the 1/10000 mm) and drop triangles that collapse
export function weld(m) {
  const P = m.pos, map = new Map(), remap = new Uint32Array(P.length / 3), V = [];
  const q = (v) => Math.round(v * 1e4);
  for (let i = 0; i < P.length / 3; i++) {
    const key = q(P[i * 3]) + "," + q(P[i * 3 + 1]) + "," + q(P[i * 3 + 2]);
    let id = map.get(key);
    if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
    remap[i] = id;
  }
  const idx = [], tl = [];
  for (let k = 0; k < m.idx.length; k += 3) {
    const a = remap[m.idx[k]], b = remap[m.idx[k + 1]], c = remap[m.idx[k + 2]];
    if (a === b || b === c || a === c) continue;
    idx.push(a, b, c); tl.push(m.tl[k / 3]);
  }
  return { pos: new Float32Array(V), idx: new Uint32Array(idx), tl: new Float32Array(tl) };
}

export function transformSolid(m, M) {
  const out = { pos: new Float32Array(m.pos.length), idx: m.idx.slice(), tl: m.tl.slice() };
  const e = M.elements, P = m.pos;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    out.pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out.pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out.pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  if (M.determinant() < 0) flip(out);
  return out;
}
export function mirrorX(m) { return transformSolid(m, new THREE.Matrix4().makeScale(-1, 1, 1)); }

export function bounds(m) {
  const b = new THREE.Box3(), P = m.pos, p = new THREE.Vector3();
  for (let i = 0; i < P.length; i += 3) b.expandByPoint(p.set(P[i], P[i + 1], P[i + 2]));
  return b;
}

// display geometry: hard edges stay sharp (faces more than 38° apart don't share a normal)
const COLOR_OF_TAG = (t, base, accent, joint) => (t === TL.ACCENT ? accent : t === TL.JOINT ? joint : base);
export function displayGeometry(m, base, accent = base, joint = "#f0b23c", tint = null) {
  const P = m.pos, I = m.idx, nT = I.length / 3;
  const fn = new Float32Array(nT * 3);
  const vf = new Map();
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; let l = vf.get(v); if (!l) vf.set(v, (l = [])); l.push(t); }
  }
  const unit = (t) => { const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9), col = new Float32Array(nT * 9);
  const cB = new THREE.Color(base), cA = new THREE.Color(accent), cJ = new THREE.Color(joint), cT = new THREE.Color();
  const COS = Math.cos((38 * Math.PI) / 180);
  for (let t = 0; t < nT; t++) {
    const nt = unit(t);
    const tag = m.tl[t];
    const tc = tint && tint(t, m);
    const c = tc ? cT.set(tc) : COLOR_OF_TAG(tag, cB, cA, cJ);
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (const o of vf.get(v)) { const no = unit(o); if (no[0] * nt[0] + no[1] * nt[1] + no[2] * nt[2] >= COS) { nx += fn[o * 3]; ny += fn[o * 3 + 1]; nz += fn[o * 3 + 2]; } }
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (t * 3 + k) * 3;
      pos[o] = P[v * 3]; pos[o + 1] = P[v * 3 + 1]; pos[o + 2] = P[v * 3 + 2];
      nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// ----------------------------------------------------------------------------- small solids
// a lathe: profile [[r, z], ...] from the axis back to the axis (r = 0 at both ends), around `axis` at `at`
export function lathe(profile, at, axis, seg = 24, tag = TL.ADD, ref = null) {
  const z = axis.clone().normalize();
  const x = (ref ? ref.clone() : Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).sub(z.clone().multiplyScalar((ref || (Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))).dot(z))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const pos = [], idx = [], tl = [];
  const rings = [];
  for (const [r, h] of profile) {
    if (r <= 1e-6) { rings.push([pos.length / 3]); pos.push(at.x + z.x * h, at.y + z.y * h, at.z + z.z * h); continue; }
    const ring = [];
    for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2, c = Math.cos(a) * r, d = Math.sin(a) * r; ring.push(pos.length / 3); pos.push(at.x + x.x * c + y.x * d + z.x * h, at.y + x.y * c + y.y * d + z.y * h, at.z + x.z * c + y.z * d + z.z * h); }
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], Bq = rings[k + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = A[A.length === 1 ? 0 : s], a1 = A[A.length === 1 ? 0 : (s + 1) % seg], b0 = Bq[Bq.length === 1 ? 0 : s], b1 = Bq[Bq.length === 1 ? 0 : (s + 1) % seg];
      if (A.length > 1) { idx.push(a0, a1, b1); tl.push(tag); }
      if (Bq.length > 1) { idx.push(a0, b1, b0); tl.push(tag); }
    }
  }
  const m = { pos: new Float32Array(pos), idx: new Uint32Array(idx), tl: new Float32Array(tl) };
  if (solidVolume(m) < 0) flip(m);
  return m;
}

// a prism: a 2D outline (with optional holes) in the plane (ex, ey) at `o`, pushed `depth` along ez
export function extrude(outline, holes, o, ex, ey, ez, depth, tag = TL.ADD) {
  const shapes = THREE.ShapeUtils;
  let outer = outline.slice(); if (shapes.area(outer.map((p) => new THREE.Vector2(p[0], p[1]))) < 0) outer.reverse();
  const hs = (holes || []).map((h) => { const c = h.slice(); if (shapes.area(c.map((p) => new THREE.Vector2(p[0], p[1]))) > 0) c.reverse(); return c; });
  const all = [outer, ...hs];
  const flat = all.flat();
  const tris = shapes.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), hs.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const n = flat.length, pos = new Float32Array(n * 6);
  const put = (k, p, d) => { pos[k * 3] = o.x + ex.x * p[0] + ey.x * p[1] + ez.x * d; pos[k * 3 + 1] = o.y + ex.y * p[0] + ey.y * p[1] + ez.y * d; pos[k * 3 + 2] = o.z + ex.z * p[0] + ey.z * p[1] + ez.z * d; };
  flat.forEach((p, k) => { put(k, p, 0); put(n + k, p, depth); });
  const idx = [], tl = [];
  for (let [a, b, c] of tris) {
    const A = flat[a], Bp = flat[b], C = flat[c];
    if ((Bp[0] - A[0]) * (C[1] - A[1]) - (Bp[1] - A[1]) * (C[0] - A[0]) < 0) { const t = b; b = c; c = t; }
    idx.push(a, c, b, n + a, n + b, n + c); tl.push(tag, tag);
  }
  let base = 0;
  for (const ring of all) {
    for (let k = 0; k < ring.length; k++) { const a = base + k, b = base + ((k + 1) % ring.length); idx.push(a, b, n + b, a, n + b, n + a); tl.push(tag, tag); }
    base += ring.length;
  }
  const m = { pos, idx: new Uint32Array(idx), tl: new Float32Array(tl) };
  if (solidVolume(m) < 0) flip(m);
  return m;
}

// a tube along a path with a radius at each point, closed at both ends (r = 0 makes a point)
export function tube(path, radii, seg = 14, tag = TL.ADD) {
  const pos = [], idx = [], tl = [];
  const n = path.length;
  let ref = new THREE.Vector3(0, 0, 1);
  const rings = [];
  for (let k = 0; k < n; k++) {
    const T = path[Math.min(n - 1, k + 1)].clone().sub(path[Math.max(0, k - 1)]).normalize();
    if (Math.abs(ref.dot(T)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
    const X = ref.clone().sub(T.clone().multiplyScalar(ref.dot(T))).normalize(), Y = new THREE.Vector3().crossVectors(T, X);
    ref = X.clone();
    const r = radii[k];
    if (r <= 1e-6) { rings.push([pos.length / 3]); pos.push(path[k].x, path[k].y, path[k].z); continue; }
    const ring = [];
    for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2, c = Math.cos(a) * r, d = Math.sin(a) * r; ring.push(pos.length / 3); pos.push(path[k].x + X.x * c + Y.x * d, path[k].y + X.y * c + Y.y * d, path[k].z + X.z * c + Y.z * d); }
    rings.push(ring);
  }
  // flat end caps where the tube is open
  const cap = (R, rev) => { if (R.length === 1) return; const c = pos.length / 3; let x = 0, y = 0, z = 0; for (const v of R) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; } pos.push(x / R.length, y / R.length, z / R.length); for (let s = 0; s < R.length; s++) { const a = R[s], b = R[(s + 1) % R.length]; if (rev) idx.push(c, b, a); else idx.push(c, a, b); tl.push(tag); } };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], Bq = rings[k + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = A[A.length === 1 ? 0 : s], a1 = A[A.length === 1 ? 0 : (s + 1) % seg], b0 = Bq[Bq.length === 1 ? 0 : s], b1 = Bq[Bq.length === 1 ? 0 : (s + 1) % seg];
      if (A.length > 1) { idx.push(a0, a1, b1); tl.push(tag); }
      if (Bq.length > 1) { idx.push(a0, b1, b0); tl.push(tag); }
    }
  }
  cap(rings[0], true); cap(rings[rings.length - 1], false);
  const m = { pos: new Float32Array(pos), idx: new Uint32Array(idx), tl: new Float32Array(tl) };
  if (solidVolume(m) < 0) flip(m);
  return m;
}

// a box from a centre and three half-axes
export function box(c, ax, ay, az, tag = TL.ADD) {
  const pos = [], idx = [];
  for (let k = 0; k < 8; k++) { const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1; const p = c.clone().addScaledVector(ax, sx).addScaledVector(ay, sy).addScaledVector(az, sz); pos.push(p.x, p.y, p.z); }
  const F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  for (const [a, b, c2, d] of F) idx.push(a, b, c2, a, c2, d);
  const m = { pos: new Float32Array(pos), idx: new Uint32Array(idx), tl: new Float32Array(idx.length / 3).fill(tag) };
  if (solidVolume(m) < 0) flip(m);
  return m;
}

// ----------------------------------------------------------------------------- 2D outline helpers (> 0 inside, about mm)
export const SD = {
  box(x, y, cx, cy, hw, hh, r = 0) { const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r; return -(Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r); },
  circle(x, y, cx, cy, r) { return r - Math.hypot(x - cx, y - cy); },
  ellipse(x, y, cx, cy, rx, ry) { const k = Math.hypot((x - cx) / rx, (y - cy) / ry); return (1 - k) * Math.min(rx, ry); },
  // a polygon [[x, y], ...]
  poly(x, y, P) {
    let d = Infinity, s = 1;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[j], b = P[i], ex = b[0] - a[0], ey = b[1] - a[1], wx = x - a[0], wy = y - a[1];
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) s = -s;
    }
    return -s * d;
  },
  // smooth union / subtraction (k = blend size in mm)
  union(a, b, k = 0) { if (!k) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; },
  sub(a, b, k = 0) { if (!k) return Math.min(a, -b); const h = Math.max(k - Math.abs(a + b), 0) / k; return Math.min(a, -b) - h * h * k * 0.25; },
};
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// emblem and plate shapes (unit size: about -1..1), as polygons
export function shapePoly(kind, s = 1) {
  const P = [];
  const star = (n, r1, r2, rot = Math.PI / 2) => { for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, r = i % 2 ? r2 : r1; P.push([Math.cos(a) * r * s, Math.sin(a) * r * s]); } };
  const ngon = (n, r, rot = Math.PI / 2) => { for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; P.push([Math.cos(a) * r * s, Math.sin(a) * r * s]); } };
  switch (kind) {
    case "star": star(5, 1, 0.42); break;
    case "diamond": P.push([0, 1.15 * s], [0.75 * s, 0], [0, -1.15 * s], [-0.75 * s, 0]); break;
    case "triangle": ngon(3, 1.05, -Math.PI / 2); break;
    case "hex": ngon(6, 1, 0); break;
    case "circle": ngon(40, 1); break;
    case "bolt": P.push(...[[0.2, 1], [-0.55, -0.05], [-0.05, -0.05], [-0.3, -1], [0.55, 0.15], [0.05, 0.15], [0.35, 1]].map(([x, y]) => [x * s, y * s])); break;
    case "cross": P.push(...[[-0.25, 1], [0.25, 1], [0.25, 0.35], [0.8, 0.35], [0.8, -0.15], [0.25, -0.15], [0.25, -1], [-0.25, -1], [-0.25, -0.15], [-0.8, -0.15], [-0.8, 0.35], [-0.25, 0.35]].map(([x, y]) => [x * s, y * s])); break;
    case "crest": for (let i = 0; i <= 20; i++) { const t = i / 20, a = Math.PI * t; P.push([-Math.cos(a) * 0.85 * s, (0.15 - Math.sin(a) * 0.95 - 0.1) * s]); } P.push([0.85 * s, 0.7 * s], [0.3 * s, 0.85 * s], [0, 1 * s], [-0.3 * s, 0.85 * s], [-0.85 * s, 0.7 * s]); P.reverse(); break;
    case "gear": for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, tooth = Math.floor(i / 2) % 2 ? 1 : 0.8; P.push([Math.cos(a) * tooth * s, Math.sin(a) * tooth * s]); } break;
    case "sun": star(12, 1, 0.66); break;
    case "wing": P.push(...[[0, 0], [0.3, 0.25], [0.7, 0.75], [1, 1.25], [0.95, 0.85], [1.25, 1.05], [1.1, 0.6], [1.4, 0.7], [1.15, 0.3], [1.35, 0.25], [1, 0], [0.5, -0.25]].map(([x, y]) => [x * s, y * s])); break;
    case "crescent": for (let i = 0; i <= 24; i++) { const a = Math.PI * (0.05 + 0.9 * (i / 24)); P.push([Math.cos(a) * 1.0 * s, Math.sin(a) * 1.0 * s - 0.35 * s]); } for (let i = 24; i >= 0; i--) { const a = Math.PI * (0.05 + 0.9 * (i / 24)); P.push([Math.cos(a) * 0.72 * s, Math.sin(a) * 0.5 * s - 0.35 * s]); } break;
    case "flame": P.push(...[[0, -0.6], [0.55, -0.35], [0.6, 0.15], [0.3, 0.5], [0.4, 0.95], [0.05, 0.6], [0, 1.1], [-0.2, 0.55], [-0.45, 0.85], [-0.55, 0.3], [-0.6, -0.2], [-0.4, -0.5]].map(([x, y]) => [x * s, y * s])); break;
    default: ngon(40, 1);
  }
  return P;
}
export const EMBLEMS = ["none", "star", "diamond", "triangle", "hex", "circle", "bolt", "cross", "crest", "gear", "sun", "flame"];
