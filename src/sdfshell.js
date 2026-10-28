// Distance-field shells: the wall of a shell for any shape at all (holes, branches, free-form
// faces, curved openings). The shape's surface is cut into triangles; on a grid around it the
// distance to the kept faces (and to the faces being opened) is measured; the wall is every point
// within the thickness of the kept faces. That region's boundary is drawn as triangles (surface
// nets), thinned out, and handed back to the geometry engine, which trims it to the shape.
import { simplify } from "./meshimport.js";

const BIG = 1e9;
// distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5)
function triDist(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(px - (ax + abx * v), py - (ay + aby * v), pz - (az + abz * v)); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(px - (ax + acx * w), py - (ay + acy * w), pz - (az + acz * w)); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return Math.hypot(px - (bx + (cx - bx) * w), py - (by + (cy - by) * w), pz - (bz + (cz - bz) * w)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return Math.hypot(px - (ax + abx * v + acx * w), py - (ay + aby * v + acy * w), pz - (az + abz * v + acz * w));
}

// the grid: cell size h, corner o, nx × ny × nz nodes
export function makeGrid(min, max, t, detail = 1, pad = t + 1.5) {
  const lo = [min[0] - pad, min[1] - pad, min[2] - pad], hi = [max[0] + pad, max[1] + pad, max[2] + pad];
  const sz = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], diag = Math.hypot(...sz);
  const budget = 5e6 * detail;
  // fine enough to hold the wall (a few cells across it), within the budget
  let h = Math.max(diag / (260 * Math.cbrt(detail)), Math.min(t / 2.5, diag / 90));
  while ((sz[0] / h + 5) * (sz[1] / h + 5) * (sz[2] / h + 5) > budget) h *= 1.1;
  const o = [lo[0] - 2 * h, lo[1] - 2 * h, lo[2] - 2 * h];
  const nx = Math.ceil(sz[0] / h) + 5, ny = Math.ceil(sz[1] / h) + 5, nz = Math.ceil(sz[2] / h) + 5;
  return { o, h, nx, ny, nz };
}
// unsigned distance from the nodes to a set of triangles, only within `band` of them
export function distanceField(G, V, I, tris, band) {
  const { o, h, nx, ny, nz } = G;
  const D = new Float32Array(nx * ny * nz).fill(BIG);
  for (const t of tris) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[b], by = V[b + 1], bz = V[b + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - band - o[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + band - o[0]) / h));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - band - o[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + band - o[1]) / h));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - band - o[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + band - o[2]) / h));
    // the triangle's plane: skip nodes too far from it
    let nX = (by - ay) * (cz - az) - (bz - az) * (cy - ay), nY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nX, nY, nZ); if (!(nl > 1e-14)) continue;
    nX /= nl; nY /= nl; nZ /= nl;
    for (let k = k0; k <= k1; k++) {
      const z = o[2] + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = o[1] + j * h, row = nx * (j + ny * k);
        for (let i = i0; i <= i1; i++) {
          const x = o[0] + i * h;
          if (Math.abs((x - ax) * nX + (y - ay) * nY + (z - az) * nZ) > band) continue;
          const q = row + i;
          const dd = triDist(x, y, z, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (dd < D[q]) D[q] = dd;
        }
      }
    }
  }
  return D;
}

// the surface where F = 0 (F < 0 inside), as welded triangles facing out
export function isoSurface(G, F) {
  const { o, h, nx, ny, nz } = G, sy = nx, sz = nx * ny;
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const at = (x, y, z) => {
    const fx = (x - o[0]) / h, fy = (y - o[1]) / h, fz = (z - o[2]) / h;
    const i = Math.min(nx - 2, Math.max(0, fx | 0)), j = Math.min(ny - 2, Math.max(0, fy | 0)), k = Math.min(nz - 2, Math.max(0, fz | 0));
    const u = fx - i, v = fy - j, w = fz - k, q = i + sy * j + sz * k;
    const c00 = F[q] + (F[q + 1] - F[q]) * u, c10 = F[q + sy] + (F[q + sy + 1] - F[q + sy]) * u;
    const c01 = F[q + sz] + (F[q + sz + 1] - F[q + sz]) * u, c11 = F[q + sz + sy] + (F[q + sz + sy + 1] - F[q + sz + sy]) * u;
    const c0 = c00 + (c10 - c00) * v, c1 = c01 + (c11 - c01) * v;
    return c0 + (c1 - c0) * w;
  };
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const V = [], v8 = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const q = i + sy * j + sz * k;
    let mask = 0;
    for (let c = 0; c < 8; c++) { const C = CORNER[c], val = F[q + C[0] + sy * C[1] + sz * C[2]]; v8[c] = val; if (val < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of EDGES) {
      if ((v8[a] < 0) === (v8[b] < 0)) continue;
      const t = v8[a] / (v8[a] - v8[b]), A = CORNER[a], B = CORNER[b];
      ax += A[0] + (B[0] - A[0]) * t; ay += A[1] + (B[1] - A[1]) * t; az += A[2] + (B[2] - A[2]) * t; n++;
    }
    let x = o[0] + (i + ax / n) * h, y = o[1] + (j + ay / n) * h, z = o[2] + (k + az / n) * h;
    // onto the surface (sharper creases)
    for (let it = 0; it < (isoSurface.project ?? 2); it++) {
      const e = h * 0.5, f = at(x, y, z);
      const gx = (at(x + e, y, z) - at(x - e, y, z)) / (2 * e), gy = (at(x, y + e, z) - at(x, y - e, z)) / (2 * e), gz = (at(x, y, z + e) - at(x, y, z - e)) / (2 * e);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (!(g2 > 1e-8)) break;
      x -= (gx * f) / g2; y -= (gy * f) / g2; z -= (gz * f) / g2;
      x = Math.min(Math.max(x, o[0] + (i - 0.5) * h), o[0] + (i + 1.5) * h); y = Math.min(Math.max(y, o[1] + (j - 0.5) * h), o[1] + (j + 1.5) * h); z = Math.min(Math.max(z, o[2] + (k - 0.5) * h), o[2] + (k + 1.5) * h);
    }
    vid[i + (nx - 1) * (j + (ny - 1) * k)] = V.length / 3;
    V.push(x, y, z);
  }
  const I = [];
  const cell = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1 ? -1 : vid[i + (nx - 1) * (j + (ny - 1) * k)]);
  const quad = (a, b, c, d, dx, dy, dz) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const P = (m) => [V[m * 3], V[m * 3 + 1], V[m * 3 + 2]];
    const A = P(a), B = P(b), C = P(c), Dd = P(d);
    // jumpstart-3d: winding from the grid edge, not from triangle A, B, C's own normal: a quad bent by the projection above
    // could face the wrong way, which flipped its two triangles (a torus wall's STL had 64 such edges and booleans on it failed).
    // a, b, c, d go round the edge counter-clockwise seen from +x (x edges), -y (y edges) and +z (z edges)
    const flip = dx < 0 || dy > 0 || dz < 0;
    const dAC = (A[0] - C[0]) ** 2 + (A[1] - C[1]) ** 2 + (A[2] - C[2]) ** 2, dBD = (B[0] - Dd[0]) ** 2 + (B[1] - Dd[1]) ** 2 + (B[2] - Dd[2]) ** 2;
    if (dAC <= dBD) { if (!flip) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c); }
    else { if (!flip) I.push(a, b, d, b, c, d); else I.push(a, d, b, b, d, c); }
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + sy * j + sz * k, a = F[q] < 0, s = a ? 1 : -1;
    if (i + 1 < nx && (F[q + 1] < 0) !== a) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), s, 0, 0);
    if (j + 1 < ny && (F[q + sy] < 0) !== a) quad(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k), 0, s, 0);
    if (k + 1 < nz && (F[q + sz] < 0) !== a) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), 0, 0, s);
  }
  // drop unused corners
  const map = new Int32Array(V.length / 3).fill(-1), V2 = [], I2 = new Uint32Array(I.length);
  for (let n = 0; n < I.length; n++) { const v = I[n]; if (map[v] < 0) { map[v] = V2.length / 3; V2.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); } I2[n] = map[v]; }
  return { V: new Float32Array(V2), I: I2 };
}

// inside the shape? (rays along z through each column of nodes, counting crossings)
export function insideField(G, V, I) {
  const { o, h, nx, ny, nz } = G;
  const ins = new Uint8Array(nx * ny * nz);
  const cols = new Map();
  const ex = 1.37e-4 * h, ey = 2.11e-4 * h; // off the grid lines, so a ray never runs along an edge
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[b], by = V[b + 1], bz = V[b + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-14) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - o[0] - ex) / h)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - o[0] - ex) / h));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - o[1] - ey) / h)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - o[1] - ey) / h));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = o[0] + i * h + ex, py = o[1] + j * h + ey;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const key = i + nx * j;
      let arr = cols.get(key); if (!arr) cols.set(key, (arr = []));
      arr.push(l1 * az + l2 * bz + l3 * cz);
    }
  }
  for (const [key, arr] of cols) {
    if (arr.length < 2) continue;
    arr.sort((p, q) => p - q);
    const i = key % nx, j = (key - i) / nx;
    for (let s = 0; s + 1 < arr.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((arr[s] - o[2]) / h)), k1 = Math.min(nz - 1, Math.floor((arr[s + 1] - o[2]) / h));
      for (let k = k0; k <= k1; k++) ins[i + nx * (j + ny * k)] = 1;
    }
  }
  return ins;
}
// a mesh in its connected pieces (each piece one closed surface)
export function components(m) {
  const nv = m.V.length / 3, parent = new Int32Array(nv).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < m.I.length; t += 3) { const a = find(m.I[t]), b = find(m.I[t + 1]), c = find(m.I[t + 2]); parent[b] = a; parent[find(c)] = a; }
  const groups = new Map();
  for (let t = 0; t < m.I.length; t += 3) { const r = find(m.I[t]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
  const out = [];
  for (const tris of groups.values()) {
    const map = new Map(), V = [], I = [];
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = m.I[t + k]; let id = map.get(v); if (id === undefined) { id = V.length / 3; map.set(v, id); V.push(m.V[v * 3], m.V[v * 3 + 1], m.V[v * 3 + 2]); } I.push(id); }
    out.push({ V: new Float32Array(V), I: new Uint32Array(I) });
  }
  return out;
}

// The pieces for a shell of any shape. mesh: the shape's triangles { V, I, faceOf (face index
// per triangle) }; open: the face indices being removed; t: the wall.
//  "cavity": the hollow inside the wall (inside the shape, further than t from the kept faces),
//            run out past the openings so a cut opens them cleanly
//  "outer":  the shape grown by t round the kept faces (stopping flush at openings), filled in
//  "wall":   the wall itself (both sides of the surface, t / 2 each way)
// Each comes back as closed surfaces (one per connected piece).
export function shellField(mesh, open, t, kind, opts = {}) {
  const { V, I, faceOf } = mesh, nt = I.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], V[i + a]); max[a] = Math.max(max[a], V[i + a]); }
  const G = makeGrid(min, max, t, opts.detail || 1);
  const kept = [], opened = [];
  for (let k = 0; k < nt; k++) (open.has(faceOf[k]) ? opened : kept).push(k);
  const band = t + 1 + 2.5 * G.h;
  const dK = distanceField(G, V, I, kept, band);
  const dO = opened.length ? distanceField(G, V, I, opened, band) : null;
  const ins = insideField(G, V, I);
  const N = dK.length, F = new Float32Array(N), eps = G.h * 0.25;
  for (let q = 0; q < N; q++) {
    const dk = dK[q], d0 = dO ? dO[q] : BIG, s = (ins[q] ? -1 : 1) * Math.min(dk, d0, BIG);
    if (kind === "cavity") F[q] = Math.max(t - dk, Math.min(s, d0 - (t + 1)));
    else if (kind === "outer") F[q] = Math.min(s + eps, Math.max(dk - t, dk - d0 + 1e-4));
    // the wall itself: inside (within t of the kept faces), outside (and flush at openings), both
    else if (kind === "win") F[q] = Math.max(s, dk - t);
    else if (kind === "wout") F[q] = Math.max(-s, dk - t, dk - d0 + 1e-4);
    else F[q] = Math.max(dk - t / 2, Math.min(s, dk - d0 + 1e-4));
  }
  const { nx, ny, nz } = G;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) F[i + nx * (j + ny * k)] = Math.max(F[i + nx * (j + ny * k)], G.h);
  const m = isoSurface(G, F);
  const limit = opts.limit || 9000, total = m.I.length / 3;
  const parts = components(m).filter((p) => p.I.length >= 12).map((p) => {
    const lim = Math.max(200, Math.round((limit * p.I.length) / 3 / Math.max(1, total)));
    return p.I.length / 3 > lim ? simplify(p, lim).mesh : p;
  });
  return { parts, h: G.h };
}

// The wall region as a closed mesh (or two: inside and outside parts). mesh: the shape's
// triangles { V, I, faceOf (face index per triangle) }; open: set of face indices to remove.
// kind "near": points within t of the kept faces; "beyond": the same but only where they are
// nearer the kept faces than the opened ones (so an outside wall stops flush at an opening).
export function wallMesh(mesh, open, t, kind, opts = {}) {
  const { V, I, faceOf } = mesh, nt = I.length / 3;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], V[i + a]); max[a] = Math.max(max[a], V[i + a]); }
  const G = makeGrid(min, max, t, opts.detail || 1);
  const kept = [], opened = [];
  for (let k = 0; k < nt; k++) (open.has(faceOf[k]) ? opened : kept).push(k);
  const band = t + 2.5 * G.h;
  const dK = distanceField(G, V, I, kept, band);
  const F = new Float32Array(dK.length);
  if (kind === "beyond" && opened.length) {
    const dO = distanceField(G, V, I, opened, band + G.h);
    for (let q = 0; q < F.length; q++) F[q] = Math.max(dK[q] - t, dK[q] - dO[q] + 1e-4);
  } else for (let q = 0; q < F.length; q++) F[q] = dK[q] - t;
  // the grid's outer layer is outside
  const { nx, ny, nz } = G;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) F[i + nx * (j + ny * k)] = Math.max(F[i + nx * (j + ny * k)], G.h);
  let m = isoSurface(G, F);
  const limit = opts.limit || 9000;
  if (m.I.length / 3 > limit) m = simplify(m, limit).mesh;
  return { mesh: m, h: G.h };
}
