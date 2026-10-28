// Chip Carving: carve a body of the design, or a board, plate or log of real wood varieties, with
// chip carving knives: three-corner (and four-corner) chips that pop out, V-cut lines, curved
// sweep cuts, a stab knife, a pencil for layout lines, an eraser and a sanding block. A pen's
// pressure sets how deep a cut goes (and its tilt the blade angle); with a mouse or a finger the
// Pressure slider does. Fingers carve, or move the view once a pen is used (palm friendly).
// When done the carving goes into the design as a mesh body, or out as STL, 3MF or OBJ.
//
// The wood is a signed distance field on a grid (negative inside the wood). A cut only ever takes
// wood away: each knife is a shape, and the wood becomes max(wood, -knife). The surface is drawn
// with surface nets, chunk by chunk, so only the chunks a cut touched are rebuilt.
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { el, uid, makeZip } from "./util.js";
import { nextName } from "./ops.js";
import { packMesh, toB64, contentId, simplify, MESH_LIMIT } from "./meshimport.js";
import { thickLines } from "./thickline.js";

const CH = 24; // cells per chunk side
const WOODS = {
  basswood: { label: "Basswood (linden)", c: "#ead8b4", g: "#d8c196", hard: 1.0, ring: 3.4, rough: 0.02, tip: "Soft, even and pale: the classic chip carving wood" },
  butternut: { label: "Butternut", c: "#d9b47f", g: "#b88c56", hard: 0.9, ring: 4.2, rough: 0.04, tip: "Soft and easy to cut, with a warm, open grain" },
  pine: { label: "White pine", c: "#eed8a6", g: "#cf9f5c", hard: 0.88, ring: 5.2, rough: 0.05, tip: "Soft but with harder rings: cut cleanly with a sharp knife" },
  mahogany: { label: "Mahogany", c: "#a9623f", g: "#8a4b2d", hard: 0.8, ring: 4.4, rough: 0.04, tip: "Medium hard, cuts crisply, rich red-brown" },
  cherry: { label: "Cherry", c: "#c8845a", g: "#a66440", hard: 0.7, ring: 3.2, rough: 0.03, tip: "Fine and smooth, harder to push through" },
  walnut: { label: "Black walnut", c: "#704b33", g: "#523422", hard: 0.7, ring: 3.8, rough: 0.05, tip: "Dark and beautiful; needs more pressure" },
  maple: { label: "Hard maple", c: "#eedbb8", g: "#d9bf96", hard: 0.55, ring: 2.6, rough: 0.03, tip: "Very hard: shallow cuts unless you press hard" },
  oak: { label: "Red oak", c: "#cc9c6a", g: "#a6744a", hard: 0.6, ring: 4.6, rough: 0.12, tip: "Hard and open-grained: cuts are a little rough" },
};
const TOOLS = {
  chip: { label: "Chip", name: "Chip knife: corner chip", key: "1", tip: "Press where the chip goes and drag outward to size and turn it. Let go: the slanted cuts meet at the deepest point and the chip pops out. Press harder to go deeper." },
  vcut: { label: "V-cut", name: "Chip knife: V-cut line", key: "2", tip: "Draw along the wood: a V-groove follows the knife. Press harder to cut deeper; go over a line again to deepen it." },
  sweep: { label: "Sweep", name: "Chip knife: curved sweep", key: "3", tip: "Draw a curve: a straight stop cut along your line and a slanted cut on one side, for leaves, petals and free-form chips." },
  stab: { label: "Stab", name: "Stab knife", key: "4", tip: "Press to stamp a wedge (a stab cut). Drag a little to aim it; press harder to go deeper." },
  pencil: { label: "Pencil", name: "Pencil (layout lines)", key: "5", tip: "Draw layout lines to carve along. Lines vanish where the wood is cut away." },
  eraser: { label: "Eraser", name: "Eraser", key: "6", tip: "Rub out pencil lines." },
  sand: { label: "Sand", name: "Sanding block", key: "7", tip: "Rub over edges to soften them a little. It only takes wood away." },
};
const DETAIL = { fast: { label: "Fast", budget: 1.3e6, minH: 0.45 }, normal: { label: "Normal", budget: 3.2e6, minH: 0.3 }, fine: { label: "Fine", budget: 6.5e6, minH: 0.2 } };

// ------------------------------------------------------------------ small math
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash3(x, y, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
// distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5)
function triDist(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = a[0]; qy = a[1]; qz = a[2]; return Math.hypot(px - qx, py - qy, pz - qz); }
  const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = a[0] + abx * v; qy = a[1] + aby * v; qz = a[2] + abz * v; return Math.hypot(px - qx, py - qy, pz - qz); }
  const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = a[0] + acx * w; qy = a[1] + acy * w; qz = a[2] + acz * w; return Math.hypot(px - qx, py - qy, pz - qz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = b[0] + (c[0] - b[0]) * w; qy = b[1] + (c[1] - b[1]) * w; qz = b[2] + (c[2] - b[2]) * w; return Math.hypot(px - qx, py - qy, pz - qz); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  qx = a[0] + abx * v + acx * w; qy = a[1] + aby * v + acy * w; qz = a[2] + abz * v + acz * w;
  return Math.hypot(px - qx, py - qy, pz - qz);
}

// ------------------------------------------------------------------ the wood as a distance grid
export function makeGrid(min, max, detail) {
  const D = DETAIL[detail] || DETAIL.normal;
  const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
  let h = Math.max(D.minH, Math.cbrt((sx * sy * sz) / D.budget));
  // very flat or thin work: keep the cell count sensible along every side
  while ((sx / h + 7) * (sy / h + 7) * (sz / h + 7) > D.budget * 1.25) h *= 1.08;
  const pad = 3;
  const o = new THREE.Vector3(min.x - pad * h, min.y - pad * h, min.z - pad * h);
  const nx = Math.ceil(sx / h) + 2 * pad + 1, ny = Math.ceil(sy / h) + 2 * pad + 1, nz = Math.ceil(sz / h) + 2 * pad + 1;
  const N = nx * ny * nz;
  return { o, h, nx, ny, nz, B: 3 * h, d: new Float32Array(N), orig: null, ref: new Float32Array(N), min: min.clone(), max: max.clone() };
}
export function fillAnalytic(G, f) {
  const { o, h, nx, ny, nz, d, B } = G;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const row = nx * (j + ny * k), y = o.y + j * h, z = o.z + k * h;
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
      d[row + i] = edge ? B : clamp(f(o.x + i * h, y, z), -B, B);
    }
  }
  G.orig = d.slice();
}
const boxSDF = (c, hs) => (x, y, z) => {
  const qx = Math.abs(x - c.x) - hs.x, qy = Math.abs(y - c.y) - hs.y, qz = Math.abs(z - c.z) - hs.z;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
};
// a cylinder along an axis ("x" or "z")
const cylSDF = (c, r, half, ax) => (x, y, z) => {
  const rr = ax === "x" ? Math.hypot(y - c.y, z - c.z) : Math.hypot(x - c.x, y - c.y);
  const a = ax === "x" ? Math.abs(x - c.x) : Math.abs(z - c.z);
  const dx = rr - r, dy = a - half;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
};
// a closed triangle mesh (world positions W, triangles T) into the grid: inside/outside from rays
// along z, distances near the surface from the triangles themselves
export function fillMesh(G, W, T) {
  const { o, h, nx, ny, nz, d, B } = G;
  d.fill(B);
  const cols = new Map();
  const ex = 1.37e-4 * h, ey = 2.11e-4 * h; // off the grid lines, so rays never run along an edge
  const P = (k) => [W[k * 3], W[k * 3 + 1], W[k * 3 + 2]];
  for (let t = 0; t < T.length; t += 3) {
    const a = P(T[t]), b = P(T[t + 1]), c = P(T[t + 2]);
    // which columns this triangle covers, seen from above
    const x0 = Math.max(0, Math.ceil((Math.min(a[0], b[0], c[0]) - o.x - ex) / h)), x1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0], c[0]) - o.x - ex) / h));
    const y0 = Math.max(0, Math.ceil((Math.min(a[1], b[1], c[1]) - o.y - ey) / h)), y1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1], c[1]) - o.y - ey) / h));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) > 1e-12) {
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const px = o.x + i * h + ex, py = o.y + j * h + ey;
        const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const key = i + nx * j;
        let arr = cols.get(key); if (!arr) cols.set(key, (arr = []));
        arr.push(l1 * a[2] + l2 * b[2] + l3 * c[2]);
      }
    }
    // distances for the nodes close to this triangle
    const bx0 = Math.max(1, Math.floor((Math.min(a[0], b[0], c[0]) - 1.6 * h - o.x) / h)), bx1 = Math.min(nx - 2, Math.ceil((Math.max(a[0], b[0], c[0]) + 1.6 * h - o.x) / h));
    const by0 = Math.max(1, Math.floor((Math.min(a[1], b[1], c[1]) - 1.6 * h - o.y) / h)), by1 = Math.min(ny - 2, Math.ceil((Math.max(a[1], b[1], c[1]) + 1.6 * h - o.y) / h));
    const bz0 = Math.max(1, Math.floor((Math.min(a[2], b[2], c[2]) - 1.6 * h - o.z) / h)), bz1 = Math.min(nz - 2, Math.ceil((Math.max(a[2], b[2], c[2]) + 1.6 * h - o.z) / h));
    // the triangle's plane: only nodes near it
    const nX = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), nY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nX, nY, nZ) || 1;
    for (let k = bz0; k <= bz1; k++) for (let j = by0; j <= by1; j++) for (let i = bx0; i <= bx1; i++) {
      const x = o.x + i * h, y = o.y + j * h, z = o.z + k * h;
      if (Math.abs(((x - a[0]) * nX + (y - a[1]) * nY + (z - a[2]) * nZ) / nl) > 1.6 * h) continue;
      const q = i + nx * (j + ny * k), dd = triDist(x, y, z, a, b, c);
      if (dd < d[q]) d[q] = dd;
    }
  }
  // signs: inside between pairs of crossings along each column
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const arr = cols.get(i + nx * j);
    if (!arr || arr.length < 2) continue;
    arr.sort((p, q) => p - q);
    for (let s = 0; s + 1 < arr.length; s += 2) {
      const k0 = Math.max(1, Math.ceil((arr[s] - o.z) / h)), k1 = Math.min(nz - 2, Math.floor((arr[s + 1] - o.z) / h));
      for (let k = k0; k <= k1; k++) { const q = i + nx * (j + ny * k); d[q] = -d[q]; }
    }
  }
  G.orig = d.slice();
}
// the same wood on a coarser grid (f times the cell size): for a lighter mesh
export function coarser(G, f) {
  const h = G.h * f, nx = Math.ceil(((G.nx - 1) * G.h) / h) + 1, ny = Math.ceil(((G.ny - 1) * G.h) / h) + 1, nz = Math.ceil(((G.nz - 1) * G.h) / h) + 1;
  const C = { o: G.o.clone(), h, nx, ny, nz, B: 3 * h, d: new Float32Array(nx * ny * nz), min: G.min, max: G.max };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
    C.d[i + nx * (j + ny * k)] = edge ? C.B : clamp(sample(G, G.d, G.o.x + i * h, G.o.y + j * h, G.o.z + k * h), -C.B, C.B);
  }
  return C;
}
// every chunk of a grid meshed and welded into one closed mesh
export function gridMesh(G) {
  const map = new Map(), V = [], I = [], nop = (x, y, z, o) => { o[0] = o[1] = o[2] = 1; };
  for (let cz = 0; cz < Math.ceil((G.nz - 1) / CH); cz++) for (let cy = 0; cy < Math.ceil((G.ny - 1) / CH); cy++) for (let cx = 0; cx < Math.ceil((G.nx - 1) / CH); cx++) {
    const m = meshChunk(G, cx, cy, cz, nop);
    if (!m || !m.idx.length) continue;
    weldInto(map, V, I, m);
  }
  return { V: new Float32Array(V), I: new Uint32Array(I) };
}
function weldInto(map, V, I, m) {
  const local = new Int32Array(m.pos.length / 3);
  for (let v = 0; v < local.length; v++) {
    const key = m.pos[v * 3] + "," + m.pos[v * 3 + 1] + "," + m.pos[v * 3 + 2];
    let id = map.get(key);
    if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); }
    local[v] = id;
  }
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = local[m.idx[t]], b = local[m.idx[t + 1]], c = local[m.idx[t + 2]];
    if (a !== b && b !== c && a !== c) I.push(a, b, c);
  }
}
// trilinear sample of a grid array at a world point (outside the grid: B)
export function sample(G, A, x, y, z) {
  const { o, h, nx, ny, nz } = G;
  const fx = (x - o.x) / h, fy = (y - o.y) / h, fz = (z - o.z) / h;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return G.B;
  const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k;
  const q = i + nx * (j + ny * k), sy = nx, sz = nx * ny;
  const c00 = A[q] + (A[q + 1] - A[q]) * u, c10 = A[q + sy] + (A[q + sy + 1] - A[q + sy]) * u;
  const c01 = A[q + sz] + (A[q + sz + 1] - A[q + sz]) * u, c11 = A[q + sz + sy] + (A[q + sz + sy + 1] - A[q + sz + sy]) * u;
  const c0 = c00 + (c10 - c00) * v, c1 = c01 + (c11 - c01) * v;
  return c0 + (c1 - c0) * w;
}
export function gradient(G, A, x, y, z, out) {
  const e = G.h * 0.5;
  out[0] = sample(G, A, x + e, y, z) - sample(G, A, x - e, y, z);
  out[1] = sample(G, A, x, y + e, z) - sample(G, A, x, y - e, z);
  out[2] = sample(G, A, x, y, z + e) - sample(G, A, x, y, z - e);
  const l = Math.hypot(out[0], out[1], out[2]);
  if (l > 1e-12) { out[0] /= l; out[1] /= l; out[2] /= l; } else { out[0] = 0; out[1] = 0; out[2] = 1; }
  return l / (2 * e);
}

// ------------------------------------------------------------------ surface nets, one chunk
const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
export function meshChunk(G, cx, cy, cz, colorFn) {
  const { o, h, nx, ny, nz, d } = G;
  const sy = nx, sz = nx * ny;
  const i0 = cx * CH, j0 = cy * CH, k0 = cz * CH;
  const i1 = Math.min(i0 + CH, nx - 1), j1 = Math.min(j0 + CH, ny - 1), k1 = Math.min(k0 + CH, nz - 1);
  if (i0 >= i1 || j0 >= j1 || k0 >= k1) return null;
  const ci0 = Math.max(0, i0 - 1), cj0 = Math.max(0, j0 - 1), ck0 = Math.max(0, k0 - 1);
  const ci1 = Math.min(i1, nx - 1), cj1 = Math.min(j1, ny - 1), ck1 = Math.min(k1, nz - 1);
  const wx = ci1 - ci0, wy = cj1 - cj0, wz = ck1 - ck0;
  const vmap = new Int32Array(wx * wy * wz).fill(-1);
  const pos = [], nrm = [], col = [];
  const g = [0, 0, 0], v = new Float32Array(8), cc = [0, 0, 0];
  for (let k = ck0; k < ck1; k++) for (let j = cj0; j < cj1; j++) for (let i = ci0; i < ci1; i++) {
    const q = i + sy * j + sz * k;
    let mask = 0;
    for (let c = 0; c < 8; c++) { const C = CORNER[c]; const val = d[q + C[0] + sy * C[1] + sz * C[2]]; v[c] = val; if (val < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of EDGES) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]), A = CORNER[a], B = CORNER[b];
      ax += A[0] + (B[0] - A[0]) * t; ay += A[1] + (B[1] - A[1]) * t; az += A[2] + (B[2] - A[2]) * t; n++;
    }
    let x = o.x + (i + ax / n) * h, y = o.y + (j + ay / n) * h, z = o.z + (k + az / n) * h;
    // onto the surface itself (keeps facets flat and crisp)
    for (let it = 0; it < 2; it++) {
      const val = sample(G, d, x, y, z), gl = gradient(G, d, x, y, z, g);
      if (!(gl > 1e-6)) break;
      x -= g[0] * val / gl; y -= g[1] * val / gl; z -= g[2] * val / gl;
      x = clamp(x, o.x + (i - 0.5) * h, o.x + (i + 1.5) * h); y = clamp(y, o.y + (j - 0.5) * h, o.y + (j + 1.5) * h); z = clamp(z, o.z + (k - 0.5) * h, o.z + (k + 1.5) * h);
    }
    gradient(G, d, x, y, z, g);
    vmap[(i - ci0) + wx * ((j - cj0) + wy * (k - ck0))] = pos.length / 3;
    pos.push(x, y, z); nrm.push(g[0], g[1], g[2]);
    colorFn(x, y, z, cc); col.push(cc[0], cc[1], cc[2]);
  }
  const idx = [];
  const V = (i, j, k) => (i < ci0 || j < cj0 || k < ck0 || i >= ci1 || j >= cj1 || k >= ck1 ? -1 : vmap[(i - ci0) + wx * ((j - cj0) + wy * (k - ck0))]);
  const quad = (a, b, c, e, dx, dy, dz) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    // facing out of the wood: towards the outside node
    const P = (m) => [pos[m * 3], pos[m * 3 + 1], pos[m * 3 + 2]];
    const A = P(a), B = P(b), C = P(c);
    const nxx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), nyy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), nzz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const flip = nxx * dx + nyy * dy + nzz * dz < 0;
    const E = P(e);
    // the shorter diagonal
    const dAC = (A[0] - C[0]) ** 2 + (A[1] - C[1]) ** 2 + (A[2] - C[2]) ** 2, dBE = (B[0] - E[0]) ** 2 + (B[1] - E[1]) ** 2 + (B[2] - E[2]) ** 2;
    if (dAC <= dBE) { if (!flip) idx.push(a, b, c, a, c, e); else idx.push(a, c, b, a, e, c); }
    else { if (!flip) idx.push(a, b, e, b, c, e); else idx.push(a, e, b, b, e, c); }
  };
  for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const q = i + sy * j + sz * k, a = d[q] < 0;
    if (i + 1 < nx && j >= 1 && k >= 1 && (d[q + 1] < 0) !== a) { const s = a ? 1 : -1; quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k), s, 0, 0); }
    if (j + 1 < ny && i >= 1 && k >= 1 && (d[q + sy] < 0) !== a) { const s = a ? 1 : -1; quad(V(i - 1, j, k - 1), V(i, j, k - 1), V(i, j, k), V(i - 1, j, k), 0, s, 0); }
    if (k + 1 < nz && i >= 1 && j >= 1 && (d[q + sz] < 0) !== a) { const s = a ? 1 : -1; quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k), 0, 0, s); }
  }
  if (!idx.length) return { pos: new Float32Array(0), nrm: new Float32Array(0), col: new Float32Array(0), idx: new Uint32Array(0) };
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), idx: new Uint32Array(idx) };
}

// ------------------------------------------------------------------ knives (negative inside the cut)
// a V-groove from p0 to p1 on a surface with normal n: depth d0 → d1, walls `wall` radians from
// straight down, tapering at both ends; `side` makes it a sweep: one wall nearly upright
export function grooveFn(p0, p1, n, d0, d1, wall, side = 0, slopeW = 0) {
  const t = new THREE.Vector3().subVectors(p1, p0); t.addScaledVector(n, -t.dot(n));
  let L = t.length();
  if (L < 1e-6) { t.set(1, 0, 0).addScaledVector(n, -n.x); if (t.length() < 1e-3) t.set(0, 1, 0).addScaledVector(n, -n.y); L = 0; }
  t.normalize();
  const u = new THREE.Vector3().crossVectors(n, t);
  const k = Math.tan(wall), steep = Math.tan((6 * Math.PI) / 180), cosW = Math.cos(wall);
  const dmax = Math.max(d0, d1), cap = Math.max(1.2, dmax * 1.2);
  return (x, y, z) => {
    const vx = x - p0.x, vy = y - p0.y, vz = z - p0.z;
    const s = vx * t.x + vy * t.y + vz * t.z, w = vx * n.x + vy * n.y + vz * n.z, lat = vx * u.x + vy * u.y + vz * u.z;
    const f = L > 0 ? clamp(s / L, 0, 1) : 0, dep = d0 + (d1 - d0) * f;
    const e = s < 0 ? -s : s > L ? s - L : 0;
    let bottom;
    if (side) {
      // sweep: upright stop cut on one side of the line, a long slope out to slopeW on the other
      const sl = lat * side;
      const kk = sl >= 0 ? (slopeW > 0 ? slopeW / Math.max(dep, 1e-3) : k) : steep;
      bottom = -dep + Math.max(Math.abs(lat) / kk, e / k);
    } else bottom = -dep + Math.max(Math.abs(lat), e) / k;
    return Math.max((bottom - w) * cosW, w - cap);
  };
}
// a corner chip: corners on the surface plane, all slanting down to an apex
export function chipFn(corners, apex, P) {
  const planes = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const m = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(apex, a)).normalize();
    if (m.dot(new THREE.Vector3().subVectors(P, a)) > 0) m.negate();
    planes.push([m.x, m.y, m.z, -m.dot(a)]);
  }
  return (x, y, z) => { let f = -Infinity; for (const p of planes) { const v = p[0] * x + p[1] * y + p[2] * z + p[3]; if (v > f) f = v; } return f; };
}

export function initCarve(app) {
  let ui = null;
  const LS = "jumpstart3d.carve.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  // ------------------------------------------------------------------ opening
  function open() {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    if (app.sketcher && app.sketcher.active) app.exitSketch();
    const sel = (app.sel || []).filter((id) => findBody(store.doc, id) && !findBody(store.doc, id).hidden && !findBody(store.doc, id).hole);
    const st = {
      from: app.mode,
      src: sel.length ? "body" : pref("src", "board"), bodyId: sel[0] || null, copy: pref("copy", true),
      blank: pref("blank", { w: 120, d: 80, h: 18, dia: 100, ph: 16, ld: 50, len: 140 }),
      wood: pref("wood", "basswood"), detail: pref("detail", "normal"),
      tool: pref("tool", "chip"), shape: pref("shape", "tri"), snap: pref("snap", true),
      depth: pref("depth", 3), push: pref("push", 0.6), angle: pref("angle", 65), tilt: pref("tilt", true),
      sweepW: pref("sweepW", 3), side: pref("side", 1), stabLen: pref("stabLen", 6), sandR: pref("sandR", 3), eraseR: pref("eraseR", 3),
      steady: pref("steady", true), penOnly: pref("penOnly", true), rake: pref("rake", true),
      guides: pref("guides", { kind: "none", size: 10 }), outDetail: pref("outDetail", "std"),
      undo: [], redo: [],
    };
    buildUI(st);
    chooseWork(true);
  }

  // ------------------------------------------------------------------ the screen
  function buildUI(st) {
    const root = el("div", { class: "s3d carve", id: "carve", role: "dialog", "aria-label": "Chip Carving" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "carve-canvas", tabindex: "0" });
    const lab = el("div", { class: "s3d-lab l carve-lab" }, el("b", { id: "carve-tname" }, ""), el("span", { id: "carve-hint" }, ""));
    const meter = el("div", { class: "carve-meter", id: "carve-meter", title: "How hard you are pressing (a pen's pressure, or the Pressure slider)" }, el("i", { id: "carve-meter-bar" }));
    const info = el("div", { class: "carve-info", id: "carve-info" }, "");
    const hand = el("button", { class: "carve-hand", id: "carve-hand", "aria-pressed": "false", title: "Move the view with one finger or the mouse (instead of carving)" }, "✋ Move view");
    const msg = el("div", { class: "lathe-msg carve-msg", id: "carve-msg", hidden: true });
    const tray = el("div", { class: "carve-tray" }, info, meter, hand);
    panes.append(canvas, lab, msg, tray);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    const hemi = new THREE.HemisphereLight(0xffffff, 0x6a5a4a, 0.85); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(1, 1, 0.6); scene.add(fill);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 20000); cam.up.set(0, 0, 1);
    const work = new THREE.Group(), bench = new THREE.Group(), over = new THREE.Group(), chipsGroup = new THREE.Group();
    scene.add(work, bench, over, chipsGroup);
    ui = { st, root, bar, panes, canvas, renderer, scene, cam, sun, hemi, work, bench, over, chipsGroup, hand, msg,
      view: { az: -Math.PI / 2, el: 0.95, dist: 300, target: new THREE.Vector3() },
      G: null, chunks: new Map(), dirty: new Set(), pencil: [], guides: [], chips: [], pointers: new Map(), stroke: null, raf: 0, last: performance.now(), handOn: false, penSeen: false, pressure: st.push };
    hand.onclick = () => { ui.handOn = !ui.handOn; hand.setAttribute("aria-pressed", String(ui.handOn)); };
    renderBar();
    const ro = new ResizeObserver(() => resize()); ro.observe(panes); ui.ro = ro;
    resize();
    bindPointers();
    ui.onKey = (e) => onKey(e);
    addEventListener("keydown", ui.onKey, true);
    setTimeout(() => canvas.focus({ preventScroll: true }), 30);
    setLight();
    loop();
  }
  function resize() {
    if (!ui) return;
    const r = ui.panes.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    ui.cam.aspect = r.width / Math.max(1, r.height); ui.cam.updateProjectionMatrix();
  }
  function placeCamera() {
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.cam.position.copy(v.target).addScaledVector(dir, v.dist); ui.cam.lookAt(v.target);
    ui.cam.near = Math.max(0.5, v.dist / 200); ui.cam.far = v.dist * 50; ui.cam.updateProjectionMatrix();
  }
  // a low, raking light (from the upper left, like a lamp across the bench) shows the facets best
  function setLight() {
    if (!ui) return;
    const rake = ui.st.rake;
    const el2 = rake ? 0.5 : 1.0, az = -2.3;
    ui.sun.position.set(Math.cos(el2) * Math.cos(az), Math.cos(el2) * Math.sin(az), Math.sin(el2)).multiplyScalar(100).add(ui.view.target);
    ui.sun.target.position.copy(ui.view.target); ui.sun.target.updateMatrixWorld();
    ui.sun.intensity = rake ? 2.3 : 1.6; ui.hemi.intensity = rake ? 0.8 : 0.95;
  }

  // ------------------------------------------------------------------ the toolbar
  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "data-v": v, "aria-pressed": String(cur === v), title: t || "", onclick: () => on(v) }, l)));
    const slider = (id, min, max, step, val, fmt, on, title) => {
      const out = el("span", { class: "carve-val" }, fmt(val));
      return el("div", { class: "lathe-row", title }, el("input", { type: "range", id, min, max, step, value: val, "aria-label": title, oninput: (e) => { const v = +e.target.value; on(v); out.textContent = fmt(v); } }), out);
    };
    const tools = seg("carve-tool", Object.entries(TOOLS).map(([k, t]) => [k, t.label, t.name + " (" + t.key + ")"]), st.tool, (v) => setTool(v));
    b.append(el("div", { class: "s3d-title" }, el("b", {}, "Chip Carving")),
      grp("Work", el("button", { class: "btn", id: "carve-work", onclick: () => chooseWork(false), title: "Change what you are carving" }, workName())),
      grp("Tool", tools));
    // the tool's own settings
    if (st.tool === "chip") b.append(grp("Chip", seg("carve-shape", [["tri", "△", "Three-corner chip (triangle)"], ["sq", "◇", "Four-corner chip (square)"], ["dia", "⬦", "Diamond chip"]], st.shape, (v) => { st.shape = v; setPref("shape", v); renderBar(); })),
      el("label", { class: "check s3d-chk", title: "Turn chips in 15° steps" }, el("input", { type: "checkbox", id: "carve-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; setPref("snap", st.snap); } }), "Snap 15°"));
    if (st.tool === "vcut" || st.tool === "stab" || st.tool === "sweep") b.append(grp("Blade angle", slider("carve-angle", 45, 85, 1, st.angle, (v) => v + "°", (v) => { st.angle = v; setPref("angle", v); }, "The knife's angle to the wood: lower makes wider, shallower V-cuts (a pen's tilt can set it)")));
    if (st.tool === "sweep") b.append(grp("Slope", slider("carve-sweepw", 1, 12, 0.5, st.sweepW, (v) => v + " mm", (v) => { st.sweepW = v; setPref("sweepW", v); }, "How far the slanted cut reaches from the line")),
      grp("Slope side", seg("carve-side", [[-1, "Left"], [1, "Right"]], st.side, (v) => { st.side = v; setPref("side", v); renderBar(); })));
    if (st.tool === "stab") b.append(grp("Length", slider("carve-stablen", 2, 20, 0.5, st.stabLen, (v) => v + " mm", (v) => { st.stabLen = v; setPref("stabLen", v); }, "How long the stab is at full depth")));
    if (st.tool === "sand") b.append(grp("Block size", slider("carve-sandr", 1, 12, 0.5, st.sandR, (v) => v + " mm", (v) => { st.sandR = v; setPref("sandR", v); }, "Sanding block size")));
    if (st.tool === "eraser") b.append(grp("Eraser size", slider("carve-erar", 1, 15, 0.5, st.eraseR, (v) => v + " mm", (v) => { st.eraseR = v; setPref("eraseR", v); }, "Eraser size")));
    if (st.tool !== "pencil" && st.tool !== "eraser") {
      b.append(grp("Max depth", slider("carve-depth", 0.5, 10, 0.25, st.depth, (v) => v + " mm", (v) => { st.depth = v; setPref("depth", v); }, "How deep a cut goes at full pressure (in the softest wood; hard woods cut less deep)")));
      b.append(grp("Pressure", slider("carve-push", 0.1, 1, 0.05, st.push, (v) => Math.round(v * 100) + "%", (v) => { st.push = v; setPref("push", v); ui.pressure = v; }, "How hard the mouse or a finger presses (a pen uses its own pressure)")));
    }
    b.append(grp("Pen and touch",
      el("label", { class: "check", title: "Once a pen is used, fingers move the view instead of carving (rest your hand on the screen)" }, el("input", { type: "checkbox", id: "carve-penonly", checked: st.penOnly, onchange: (e) => { st.penOnly = e.target.checked; setPref("penOnly", st.penOnly); } }), "Fingers move view when a pen is used"),
      el("label", { class: "check", title: "Tilting the pen sets the blade angle for V-cuts, sweeps and stabs" }, el("input", { type: "checkbox", id: "carve-tilt", checked: st.tilt, onchange: (e) => { st.tilt = e.target.checked; setPref("tilt", st.tilt); } }), "Pen tilt sets the blade angle"),
      el("label", { class: "check", title: "Smooths a shaky hand along V-cuts, sweeps and pencil lines" }, el("input", { type: "checkbox", id: "carve-steady", checked: st.steady, onchange: (e) => { st.steady = e.target.checked; setPref("steady", st.steady); } }), "Steady lines")));
    b.append(grp("Layout", el("select", { class: "num", id: "carve-guides", title: "Pencil guide lines drawn on the top of the work", onchange: (e) => { st.guides.kind = e.target.value; setPref("guides", st.guides); makeGuides(); } },
      ...[["none", "No guides"], ["square", "Square grid"], ["tri", "Triangle grid"], ["rosette", "Rosette"], ["border", "Border band"]].map(([v, l]) => el("option", { value: v, selected: st.guides.kind === v }, l))),
      app.numField({ value: st.guides.size, id: "carve-gsize", min: 2, max: 80, step: 1, len: true, onCommit: (v) => { st.guides.size = v; setPref("guides", st.guides); makeGuides(); } })));
    b.append(el("label", { class: "check s3d-chk", title: "A low lamp across the bench: shows the facets of the chips" }, el("input", { type: "checkbox", id: "carve-rake", checked: st.rake, onchange: (e) => { st.rake = e.target.checked; setPref("rake", st.rake); setLight(); } }), "Raking light"));
    b.append(el("span", { class: "s3d-sp" }),
      grp("", el("button", { class: "btn", id: "carve-undo", title: "Undo (Ctrl+Z)", disabled: !st.undo.length, onclick: undo }, "↶ Undo"), el("button", { class: "btn", id: "carve-redo", title: "Redo (Ctrl+Y)", disabled: !st.redo.length, onclick: redo }, "↷ Redo")),
      grp("", el("select", { class: "num", id: "carve-export", title: "Save the carving as a file", disabled: !ui.G, onchange: (e) => { const f = e.target.value; e.target.value = ""; if (f) exportFile(f); } },
        el("option", { value: "" }, "Export…"), el("option", { value: "stl" }, "STL"), el("option", { value: "3mf" }, "3MF"), el("option", { value: "obj" }, "OBJ"))),
      grp("", el("button", { class: "btn", id: "carve-cancel", onclick: () => close(false) }, "Cancel"), el("button", { class: "btn primary", id: "carve-done", disabled: !ui.G, onclick: () => finish() }, "Done")));
    const t = TOOLS[st.tool];
    const tn = document.getElementById("carve-tname"); if (tn) tn.textContent = t.name;
    const hn = document.getElementById("carve-hint"); if (hn) hn.textContent = t.tip + " · Right-drag (or two fingers) to look around, scroll or pinch to zoom.";
  }
  function setTool(v) {
    const st = ui.st;
    st.tool = v; setPref("tool", v);
    endStroke(true);
    renderBar();
  }
  function updateUndoBtns() {
    const u = document.getElementById("carve-undo"), r = document.getElementById("carve-redo");
    if (u) u.disabled = !ui.st.undo.length; if (r) r.disabled = !ui.st.redo.length;
  }
  const workName = () => { const st = ui.st; if (st.src === "body") { const b = findBody(store.doc, st.bodyId); return b ? b.name : "A body"; } return st.src === "plate" ? "Round plate" : st.src === "log" ? "Log" : "Board"; };

  // ------------------------------------------------------------------ what to carve
  function chooseWork(first) {
    const st = ui.st;
    const bodies = store.doc.bodies.filter((b) => !b.hidden && !b.hole && app.scene.views.get(b.id) && app.scene.views.get(b.id).data);
    let pick = st.src === "body" && !bodies.length ? "board" : st.src;
    let bodyId = bodies.some((b) => b.id === st.bodyId) ? st.bodyId : bodies[0] && bodies[0].id;
    const back = el("div", { class: "s3d-modal-back" });
    const card = el("div", { class: "s3d-modal", role: "dialog", "aria-label": "Choose what to carve" });
    const render = () => {
      card.innerHTML = "";
      const opt = (k, label) => el("label", { class: "s3d-base-opt" + (pick === k ? " on" : "") }, el("input", { type: "radio", name: "carve-src", value: k, checked: pick === k, onchange: () => { pick = k; render(); } }), el("span", {}, label));
      card.append(el("h3", {}, "What do you want to chip carve?"),
        el("p", { class: "hint", style: { padding: 0 } }, "Chip carving cuts small chips out of the surface with a knife. Start with a board (the classic), a round plate, a log, or a shape from your design."),
        el("div", { class: "s3d-bases" }, bodies.length ? opt("body", "A shape in my design") : null, opt("board", "Board"), opt("plate", "Round plate"), opt("log", "Log (lying down)")));
      const num = (key, lab) => el("label", {}, lab, app.numField({ value: st.blank[key], id: "carve-b-" + key, min: 5, max: 400, step: 1, len: true, onCommit: (v) => { st.blank[key] = v; } }));
      if (pick === "body") {
        card.append(el("div", { class: "row" }, el("span", {}, "Shape"), el("select", { class: "num", id: "carve-body", onchange: (e) => { bodyId = e.target.value; } }, ...bodies.map((b) => el("option", { value: b.id, selected: b.id === bodyId }, b.name)))));
        card.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "carve-copy", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; setPref("copy", st.copy); } }), "Carve a copy (the original stays as it is)"));
      } else if (pick === "board") card.append(el("div", { class: "row3" }, num("w", "Length"), num("d", "Width"), num("h", "Thickness")));
      else if (pick === "plate") card.append(el("div", { class: "row3" }, num("dia", "Diameter"), num("ph", "Thickness")));
      else card.append(el("div", { class: "row3" }, num("ld", "Diameter"), num("len", "Length")));
      card.append(el("div", { class: "row" }, el("span", {}, "Wood"), el("select", { class: "num", id: "carve-wood", style: { width: "auto" }, onchange: (e) => { st.wood = e.target.value; const tip = card.querySelector("#carve-woodtip"); if (tip) tip.textContent = (WOODS[st.wood] || {}).tip || "The shape's own color."; } },
        ...(pick === "body" ? [el("option", { value: "body", selected: st.wood === "body" }, "Same color as the shape")] : []),
        ...Object.entries(WOODS).map(([k, w]) => el("option", { value: k, selected: st.wood === k }, w.label)))));
      card.append(el("p", { class: "hint", id: "carve-woodtip", style: { padding: 0 } }, (WOODS[st.wood] || {}).tip || "The shape's own color."));
      card.append(el("div", { class: "row" }, el("span", {}, "Detail"), el("div", { class: "seg s3d-seg", id: "carve-detail" }, ...Object.entries(DETAIL).map(([k, d]) => el("button", { "aria-pressed": String(st.detail === k), title: k === "fine" ? "Sharpest cuts; slower on older computers and tablets" : k === "fast" ? "Quickest on older computers and tablets" : "Good for most computers", onclick: () => { st.detail = k; setPref("detail", k); render(); } }, d.label)))));
      card.append(el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => { back.remove(); if (first) close(false, true); } }, first ? "Cancel" : "Keep the current work"),
        el("button", { class: "btn primary", id: "carve-start", onclick: () => {
          if (!first && ui.st.undo.length && !confirm("Start over with new work? Your carving so far will be lost.")) return;
          if (pick !== "body" && st.wood === "body") st.wood = "basswood";
          st.src = pick; st.bodyId = pick === "body" ? bodyId : null;
          if (pick !== "body") { setPref("src", pick); setPref("blank", st.blank); }
          if (st.wood !== "body") setPref("wood", st.wood);
          back.remove();
          mount();
        } }, "Start carving")));
    };
    render();
    back.append(card);
    ui.root.append(back);
  }

  function mount() {
    const st = ui.st;
    let G;
    try { G = st.src === "body" ? fromBody(st.bodyId) : fromBlank(st); }
    catch (e) { app.toast(e.message || "That can't be carved.", "err"); return; }
    if (!G) { app.toast("That shape isn't ready yet.", "err"); return; }
    // the wood's look: rings around a log axis along the work's longest side
    const W = WOODS[st.wood];
    let base = W ? new THREE.Color(W.c) : null, late = W ? new THREE.Color(W.g) : null;
    if (!W) { const b = findBody(store.doc, st.bodyId); base = new THREE.Color((b && b.color) || "#c8a06a"); late = base.clone().multiplyScalar(0.86); }
    const size = new THREE.Vector3().subVectors(G.max, G.min);
    const axis = size.x >= size.y ? "x" : "y";
    const span = Math.max(size.x, size.y, size.z);
    // the tree's center, below and to the side of a board (flat-sawn); in the middle of a log
    const pith = st.src === "log" ? new THREE.Vector3((G.min.x + G.max.x) / 2, (G.min.y + G.max.y) / 2 + size.y * 0.08, (G.min.z + G.max.z) / 2 - size.z * 0.06)
      : new THREE.Vector3((G.min.x + G.max.x) / 2 + (axis === "y" ? span * 0.35 : 0), (G.min.y + G.max.y) / 2 + (axis === "x" ? span * 0.35 : 0), G.min.z - Math.max(60, span * 0.9));
    G.look = { base, late, fresh: base.clone().lerp(new THREE.Color(1, 1, 1), 0.1), ring: W ? W.ring : 4, axis, pith, rough: W ? W.rough : 0.03, hard: W ? W.hard : 0.9 };
    ui.G = G;
    st.undo = []; st.redo = [];
    ui.pencil = []; ui.guides = [];
    for (const c of ui.chunks.values()) disposeChunk(c);
    ui.chunks.clear();
    ui.dirty = new Set();
    const ncx = Math.ceil((G.nx - 1) / CH), ncy = Math.ceil((G.ny - 1) / CH), ncz = Math.ceil((G.nz - 1) / CH);
    G.ncx = ncx; G.ncy = ncy; G.ncz = ncz;
    // build the surface nearest the camera first, a few chunks a frame
    const order = [];
    for (let cz = ncz - 1; cz >= 0; cz--) for (let cy = 0; cy < ncy; cy++) for (let cx = 0; cx < ncx; cx++) order.push(cx + "," + cy + "," + cz);
    ui.pending = order;
    ui.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    buildBench(); buildChips(); makeGuides();
    const c = new THREE.Vector3().addVectors(G.min, G.max).multiplyScalar(0.5);
    ui.view.target.copy(c);
    ui.view.az = -Math.PI / 2 - 0.25; ui.view.el = st.src === "log" ? 0.55 : 0.95;
    const asp = Math.max(0.3, ui.w / Math.max(1, ui.h)), tanH = Math.tan((ui.cam.fov * Math.PI) / 360);
    ui.view.dist = Math.max(80, (Math.max(size.x / asp, size.y, size.z) * 0.75) / tanH);
    setLight();
    renderBar();
    showMsg("Getting the wood ready…");
  }
  function fromBlank(st) {
    const t = app.vp ? app.vp.view.target : new THREE.Vector3();
    const cx = Math.round(t.x / 10) * 10, cy = Math.round(t.y / 10) * 10, B = st.blank;
    let min, max, f;
    if (st.src === "plate") {
      const r = Math.max(5, B.dia) / 2, hh = Math.max(2, B.ph);
      min = new THREE.Vector3(cx - r, cy - r, 0); max = new THREE.Vector3(cx + r, cy + r, hh);
      f = cylSDF(new THREE.Vector3(cx, cy, hh / 2), r, hh / 2, "z");
    } else if (st.src === "log") {
      const r = Math.max(5, B.ld) / 2, L = Math.max(10, B.len);
      min = new THREE.Vector3(cx - L / 2, cy - r, 0); max = new THREE.Vector3(cx + L / 2, cy + r, 2 * r);
      f = cylSDF(new THREE.Vector3(cx, cy, r), r, L / 2, "x");
    } else {
      const w = Math.max(5, B.w), dd = Math.max(5, B.d), hh = Math.max(2, B.h);
      min = new THREE.Vector3(cx - w / 2, cy - dd / 2, 0); max = new THREE.Vector3(cx + w / 2, cy + dd / 2, hh);
      // a hair of rounding on the edges, like sanded stock
      const rr = 0.4;
      const bf = boxSDF(new THREE.Vector3(cx, cy, hh / 2), new THREE.Vector3(w / 2 - rr, dd / 2 - rr, hh / 2 - rr));
      f = (x, y, z) => bf(x, y, z) - rr;
    }
    const G = makeGrid(min, max, st.detail);
    fillAnalytic(G, f);
    return G;
  }
  function fromBody(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles;
    const W = new Float32Array(P.length), p = new THREE.Vector3(), box = new THREE.Box3();
    for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); W[i] = p.x; W[i + 1] = p.y; W[i + 2] = p.z; box.expandByPoint(p); }
    const size = box.getSize(new THREE.Vector3());
    if (Math.min(size.x, size.y, size.z) < 0.5) throw new Error("That shape is too thin to carve.");
    const G = makeGrid(box.min, box.max, ui.st.detail);
    fillMesh(G, W, T);
    return G;
  }

  // ------------------------------------------------------------------ the bench, chunks
  function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); } }
  function buildBench() {
    clearGroup(ui.bench);
    const G = ui.G, size = new THREE.Vector3().subVectors(G.max, G.min), c = new THREE.Vector3().addVectors(G.min, G.max).multiplyScalar(0.5);
    const S = Math.max(size.x, size.y) * 2.6 + 120;
    const top = new THREE.Mesh(new THREE.BoxGeometry(S, S * 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.9 }));
    top.position.set(c.x, c.y, G.min.z - 4.05);
    ui.bench.add(top);
    ui.benchZ = G.min.z;
  }
  function disposeChunk(c) { if (c && c.mesh) { ui.work.remove(c.mesh); c.mesh.geometry.dispose(); } }
  // the wood's color at a point (rings, a little figure), lighter where it was freshly cut
  const cA = new THREE.Color(), cB = new THREE.Color();
  function woodColor(x, y, z, out) {
    const L = ui.G.look, G = ui.G;
    const r = L.axis === "x" ? Math.hypot(y - L.pith.y, z - L.pith.z) : Math.hypot(x - L.pith.x, z - L.pith.z);
    const along = L.axis === "x" ? x : y;
    const warp = (noise3(along * 0.012, r * 0.05, 0.5) - 0.5) * 6 + (noise3(along * 0.05, x * 0.02 + 3, y * 0.02) - 0.5) * 1.2;
    const t = ((r + warp) / L.ring) % 1;
    const band = t < 0 ? 0 : t > 0.7 ? Math.min(1, (t - 0.7) / 0.18) * (t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1) : 0;
    const streak = (noise3(along * 0.4, (L.axis === "x" ? y : x) * 3.2, z * 3.2) - 0.5) * 0.06;
    const cut = sample(G, G.orig, x, y, z) < -0.3 * G.h;
    cA.copy(cut ? L.fresh : L.base).lerp(L.late, band * 0.75);
    out[0] = clamp(cA.r * (1 + streak), 0, 1); out[1] = clamp(cA.g * (1 + streak), 0, 1); out[2] = clamp(cA.b * (1 + streak), 0, 1);
  }
  void cB;
  function rebuildChunk(key) {
    const G = ui.G;
    const [cx, cy, cz] = key.split(",").map(Number);
    const m = meshChunk(G, cx, cy, cz, woodColor);
    const old = ui.chunks.get(key);
    if (!m || !m.idx.length) { if (old) disposeChunk(old); ui.chunks.delete(key); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(m.col, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeBoundingSphere();
    if (old && old.mesh) { old.mesh.geometry.dispose(); old.mesh.geometry = g; old.data = m; return; }
    const mesh = new THREE.Mesh(g, ui.mat);
    ui.work.add(mesh);
    ui.chunks.set(key, { mesh, data: m });
  }
  function markDirty(i0, i1, j0, j1, k0, k1) {
    const G = ui.G;
    for (let cz = Math.max(0, Math.floor((k0 - 2) / CH)); cz <= Math.min(G.ncz - 1, Math.floor((k1 + 2) / CH)); cz++)
      for (let cy = Math.max(0, Math.floor((j0 - 2) / CH)); cy <= Math.min(G.ncy - 1, Math.floor((j1 + 2) / CH)); cy++)
        for (let cx = Math.max(0, Math.floor((i0 - 2) / CH)); cx <= Math.min(G.ncx - 1, Math.floor((i1 + 2) / CH)); cx++) ui.dirty.add(cx + "," + cy + "," + cz);
  }

  // ------------------------------------------------------------------ cutting
  // the wood inside a world box becomes max(wood, -knife); the old values are kept for undo
  function applyKnife(min, max, fn, rough = true) {
    const G = ui.G, { o, h, nx, ny, d, B } = G;
    const i0 = Math.max(1, Math.floor((min.x - o.x) / h)), i1 = Math.min(G.nx - 2, Math.ceil((max.x - o.x) / h));
    const j0 = Math.max(1, Math.floor((min.y - o.y) / h)), j1 = Math.min(G.ny - 2, Math.ceil((max.y - o.y) / h));
    const k0 = Math.max(1, Math.floor((min.z - o.z) / h)), k1 = Math.min(G.nz - 2, Math.ceil((max.z - o.z) / h));
    if (i0 > i1 || j0 > j1 || k0 > k1) return 0;
    const sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1;
    const old = new Float32Array(sx * sy * sz);
    const amp = rough ? G.look.rough : 0;
    let removed = 0, n = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
      const row = nx * (j + ny * k);
      for (let i = i0; i <= i1; i++) {
        const q = row + i, was = d[q];
        old[n++] = was;
        const x = o.x + i * h, y = o.y + j * h, z = o.z + k * h;
        let t = fn(x, y, z);
        if (t > B) continue;
        if (amp) t += (noise3(x * 1.7, y * 1.7, z * 1.7) - 0.5) * amp * 2;
        const nv = Math.min(B, -t);
        if (nv > was) { d[q] = nv; if (was < 0 && nv >= 0) removed++; }
      }
    }
    if (ui.stroke) ui.stroke.patches.push({ i0, j0, k0, sx, sy, sz, old });
    else ui.st.undo.push({ patches: [{ i0, j0, k0, sx, sy, sz, old }] });
    markDirty(i0, i1, j0, j1, k0, k1);
    return removed * h * h * h;
  }
  const bboxOf = (pts, pad) => { const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity); for (const p of pts) { mn.min(p); mx.max(p); } mn.subScalar(pad); mx.addScalar(pad); return [mn, mx]; };
  // the knife's angle: the pen's tilt, or the setting (degrees from the wood's surface)
  function bladeAngle() { const a = ui.tiltAngle != null && ui.st.tilt ? ui.tiltAngle : ui.st.angle; return (clamp(a, 40, 88) * Math.PI) / 180; }
  function depthFor(p) { const G = ui.G; return Math.max(0.12, ui.st.depth * G.look.hard * Math.pow(clamp(p, 0.02, 1), 0.85)); }
  function grooveSeg(a, b, n, p0, p1, kind) {
    const wall = Math.PI / 2 - bladeAngle();
    const d0 = depthFor(p0), d1 = depthFor(p1);
    const fn = kind === "sweep" ? grooveFn(a, b, n, d0, d1, wall, ui.st.side, ui.st.sweepW) : grooveFn(a, b, n, d0, d1, wall);
    const reach = Math.max(d0, d1) * (Math.tan(wall) + 0.2) + (kind === "sweep" ? ui.st.sweepW : 0) + 2 * ui.G.h + 1.5;
    const [mn, mx] = bboxOf([a, b], reach);
    const v = applyKnife(mn, mx, fn);
    if (v > 0) spawnChips(Math.min(6, 1 + Math.round(v * 2)), b, n, Math.min(1.8, 0.4 + Math.max(d0, d1) * 0.3));
    return v;
  }
  function chipCorners(c, n, dir, R, shape) {
    const u = dir.clone().addScaledVector(n, -dir.dot(n)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const pts = [];
    const at = (ang, rad) => c.clone().addScaledVector(u, Math.cos(ang) * rad).addScaledVector(w, Math.sin(ang) * rad);
    if (shape === "sq") for (let i = 0; i < 4; i++) pts.push(at((i * Math.PI) / 2, R));
    else if (shape === "dia") { pts.push(at(0, R), at(Math.PI / 2, R * 0.5), at(Math.PI, R), at((3 * Math.PI) / 2, R * 0.5)); }
    else for (let i = 0; i < 3; i++) pts.push(at((i * 2 * Math.PI) / 3, R));
    return pts;
  }
  function chipDepth(R, shape, p) {
    const inr = shape === "tri" ? R * 0.5 : shape === "sq" ? R * Math.SQRT1_2 : R * 0.447;
    return Math.min(depthFor(p), inr * 2.2);
  }
  function cutChip(c, n, dir, R, p) {
    const st = ui.st;
    const corners = chipCorners(c, n, dir, R, st.shape);
    const dep = chipDepth(R, st.shape, p);
    const apex = c.clone().addScaledVector(n, -dep);
    const top = c.clone().addScaledVector(n, Math.max(1.5, dep));
    const fn0 = chipFn(corners, apex, top);
    const cap = Math.max(1.5, dep * 1.2);
    const fn = (x, y, z) => Math.max(fn0(x, y, z), (x - c.x) * n.x + (y - c.y) * n.y + (z - c.z) * n.z - cap);
    const [mn, mx] = bboxOf([...corners, apex, top], 2 * ui.G.h + 0.5);
    const v = applyKnife(mn, mx, fn);
    if (v > 0) popChip(corners, apex, n);
    return v;
  }
  function cutStab(c, n, dir, p) {
    const wall = (Math.PI / 2 - bladeAngle()) * 0.6;
    const t = dir.clone().addScaledVector(n, -dir.dot(n)); if (t.length() < 1e-6) t.set(1, 0, 0); t.normalize();
    const L = ui.st.stabLen, dep = depthFor(p);
    // shallow at the knife's point, deepest at the heel
    const a = c.clone().addScaledVector(t, -L / 2), b = c.clone().addScaledVector(t, L / 2);
    const fn = grooveFn(a, b, n, Math.min(0.15, dep), dep, Math.max(0.12, wall));
    const [mn, mx] = bboxOf([a, b], dep * 1.2 + 2 * ui.G.h + 1.5);
    const v = applyKnife(mn, mx, fn);
    if (v > 0) spawnChips(3, b, n, 0.6);
    return v;
  }
  function sandAt(c, n) {
    const G = ui.G, { o, h, nx, ny, d } = G, R = ui.st.sandR;
    const i0 = Math.max(1, Math.floor((c.x - R - o.x) / h)), i1 = Math.min(G.nx - 2, Math.ceil((c.x + R - o.x) / h));
    const j0 = Math.max(1, Math.floor((c.y - R - o.y) / h)), j1 = Math.min(G.ny - 2, Math.ceil((c.y + R - o.y) / h));
    const k0 = Math.max(1, Math.floor((c.z - R - o.z) / h)), k1 = Math.min(G.nz - 2, Math.ceil((c.z + R - o.z) / h));
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    const sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1, old = new Float32Array(sx * sy * sz);
    let m = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) old[m++] = d[i + nx * (j + ny * k)];
    const S = nx * ny, k = 0.35 * ui.st.push;
    m = 0;
    for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++, m++) {
      const x = o.x + i * h, y = o.y + j * h, z = o.z + kk * h, r = Math.hypot(x - c.x, y - c.y, z - c.z);
      if (r > R) continue;
      const q = i + nx * (j + ny * kk), was = old[m];
      if (Math.abs(was) > 2 * h) continue;
      const avg = (d[q - 1] + d[q + 1] + d[q - nx] + d[q + nx] + d[q - S] + d[q + S]) / 6;
      if (avg > was) d[q] = was + (avg - was) * k * (1 - r / R);
    }
    if (ui.stroke) ui.stroke.patches.push({ i0, j0, k0, sx, sy, sz, old });
    markDirty(i0, i1, j0, j1, k0, k1);
    void n;
  }

  // ------------------------------------------------------------------ chips flying
  function buildChips() {
    clearGroup(ui.chipsGroup);
    const MAX = 900, col = ui.G.look.fresh.clone();
    const flake = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.8, 0.16), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }), MAX);
    flake.instanceMatrix.setUsage(THREE.DynamicDrawUsage); flake.count = 0; flake.frustumCulled = false;
    ui.chipsGroup.add(flake);
    ui.flake = flake; ui.chips = []; ui.chipMax = MAX;
    ui.bigChips = [];
  }
  function spawnChips(nc, p, n, s) {
    for (let k = 0; k < nc; k++) {
      if (ui.chips.length >= ui.chipMax) ui.chips.shift();
      const v = n.clone().multiplyScalar(60 + Math.random() * 90).add(new THREE.Vector3((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 40 + Math.random() * 60));
      ui.chips.push({ p: p.clone().addScaledVector(n, 0.6), v, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(25), s: s * (0.6 + Math.random() * 0.8), life: 0, rest: false });
    }
  }
  // the real chip: the little pyramid that came out, popping up and tumbling onto the bench
  function popChip(corners, apex, n) {
    const P = [...corners.map((c) => c.clone()), apex.clone()], c0 = new THREE.Vector3();
    for (const p of P) c0.add(p); c0.divideScalar(P.length);
    const pos = [];
    const nC = corners.length;
    for (let i = 0; i < nC; i++) { const a = P[i], b = P[(i + 1) % nC], ap = P[nC]; pos.push(a.x - c0.x, a.y - c0.y, a.z - c0.z, b.x - c0.x, b.y - c0.y, b.z - c0.z, ap.x - c0.x, ap.y - c0.y, ap.z - c0.z); }
    for (let i = 1; i + 1 < nC; i++) { const a = P[0], b = P[i], cc = P[i + 1]; pos.push(a.x - c0.x, a.y - c0.y, a.z - c0.z, cc.x - c0.x, cc.y - c0.y, cc.z - c0.z, b.x - c0.x, b.y - c0.y, b.z - c0.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: ui.G.look.fresh, roughness: 0.75, side: THREE.DoubleSide }));
    m.position.copy(c0);
    ui.chipsGroup.add(m);
    // lying on the bench: the chip's top (the old surface) face down, so the point is up
    const flat = new THREE.Quaternion().setFromUnitVectors(n.clone(), new THREE.Vector3(0, 0, -1));
    const lift = corners[0].clone().sub(c0).dot(n);
    const out = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).normalize().multiplyScalar(110 + Math.random() * 60);
    ui.bigChips.push({ flat, lift: Math.max(0.05, lift), m, v: n.clone().multiplyScalar(120).add(out).add(new THREE.Vector3(0, 0, 90)), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14), life: 0, rest: false });
    if (ui.bigChips.length > 80) { const o = ui.bigChips.shift(); ui.chipsGroup.remove(o.m); o.m.geometry.dispose(); o.m.material.dispose(); }
  }
  const mtmp = new THREE.Matrix4(), qtmp = new THREE.Quaternion(), stmp = new THREE.Vector3();
  function stepChips(dt) {
    const G = ui.G; if (!G) return;
    const ground = (p) => (sample(G, G.d, p.x, p.y, p.z) < 0 ? p.z : -Infinity);
    const fall = (c, bounce) => {
      c.v.z -= 2600 * dt; c.v.multiplyScalar(Math.pow(0.5, dt));
      const before = c.p.clone();
      c.p.addScaledVector(c.v, dt);
      if (ground(c.p) > -Infinity || c.p.z < ui.benchZ + 0.2) {
        // landed: on the work (brushed off soon, so the cuts stay in view), or on the bench
        if (c.p.z < ui.benchZ + 0.2) c.p.z = ui.benchZ + 0.2; else { c.p.copy(before); c.onWork = true; }
        if (Math.abs(c.v.z) < 90 || !bounce) c.rest = true; else { c.v.z *= -0.25; c.v.x *= 0.4; c.v.y *= 0.4; }
      }
    };
    let n = 0;
    ui.chips = ui.chips.filter((c) => c.life < (c.onWork ? 2.2 : 12));
    for (const c of ui.chips) {
      c.life += dt;
      if (!c.rest) { fall(c, true); qtmp.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt)); c.q.multiply(qtmp); }
      const end = c.onWork ? 2.2 : 12, fade = c.life > end - 1 ? Math.max(0.01, end - c.life) : 1;
      stmp.set(c.s * fade, c.s * fade, c.s * fade);
      mtmp.compose(c.p, c.q, stmp);
      ui.flake.setMatrixAt(n++, mtmp);
    }
    ui.flake.count = n; ui.flake.instanceMatrix.needsUpdate = true;
    for (let i = ui.bigChips.length - 1; i >= 0; i--) {
      const b = ui.bigChips[i];
      b.life += dt;
      const gone = b.onWork ? b.life - b.restAt > 0.6 : b.life > 14;
      if (gone) { const k = Math.max(0, b.m.scale.x - dt * 3); b.m.scale.setScalar(k); if (k <= 0) { ui.chipsGroup.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); ui.bigChips.splice(i, 1); } continue; }
      if (b.rest) continue;
      const c = { p: b.m.position, v: b.v, rest: false };
      fall(c, b.life > 0.25);
      b.rest = c.rest;
      if (b.rest) {
        b.restAt = b.life; b.onWork = !!c.onWork;
        // it settles on its flat side (the old surface down), turned any which way
        b.m.quaternion.copy(b.flat).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
        b.m.position.z = Math.max(b.m.position.z, ui.benchZ + b.lift);
        continue;
      }
      b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt; b.m.rotation.z += b.w.z * dt;
    }
  }

  // ------------------------------------------------------------------ pencil lines and guides
  function linesObj(list, hex, w) {
    const G = ui.G, seg = [];
    const vis = (p) => Math.abs(sample(G, G.d, p.x, p.y, p.z)) < 0.55 * G.h + 0.05;
    for (const line of list) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (!vis(a.p) || !vis(b.p)) continue;
      seg.push(a.p.x + a.n.x * 0.08, a.p.y + a.n.y * 0.08, a.p.z + a.n.z * 0.08, b.p.x + b.n.x * 0.08, b.p.y + b.n.y * 0.08, b.p.z + b.n.z * 0.08);
    }
    if (!seg.length) return null;
    const o = thickLines(seg, hex, w, true); o.renderOrder = 3; return o;
  }
  function drawLines() {
    if (!ui || !ui.G) return;
    for (const k of ["pencilObj", "guideObj"]) if (ui[k]) { ui.over.remove(ui[k]); ui[k].geometry.dispose(); ui[k].material.dispose(); ui[k] = null; }
    ui.pencilObj = linesObj(ui.pencil, 0x2b2b2b, 1.6);
    ui.guideObj = linesObj(ui.guides, 0x5b7fa8, 1.1);
    if (ui.pencilObj) ui.over.add(ui.pencilObj);
    if (ui.guideObj) ui.over.add(ui.guideObj);
    ui.linesDirty = false;
  }
  // a point dropped straight down onto the top of the work
  function dropTo(x, y) {
    const G = ui.G;
    let z = G.max.z + G.h, prev = sample(G, G.d, x, y, z);
    const stepZ = G.h * 0.5;
    for (let s = 0; s < 4000 && z > G.min.z - G.h; s++) {
      const nz = z - Math.max(stepZ, Math.min(prev, G.B) * 0.8), v = sample(G, G.d, x, y, nz);
      if (v < 0) { let a = nz, b = z; for (let it = 0; it < 10; it++) { const m = (a + b) / 2; if (sample(G, G.d, x, y, m) < 0) a = m; else b = m; } const g = [0, 0, 0]; gradient(G, G.d, x, y, b, g); return g[2] > 0.6 ? { p: new THREE.Vector3(x, y, b), n: new THREE.Vector3(g[0], g[1], g[2]) } : null; }
      z = nz; prev = v;
    }
    return null;
  }
  function makeGuides() {
    if (!ui || !ui.G) return;
    const G = ui.G, g = ui.st.guides, S = Math.max(2, g.size || 10);
    const lines = [];
    const trace = (pts) => { let cur = []; for (const [x, y] of pts) { const h = dropTo(x, y); if (h) cur.push(h); else { if (cur.length > 1) lines.push(cur); cur = []; } } if (cur.length > 1) lines.push(cur); };
    const step = Math.max(0.5, G.h);
    const cx = (G.min.x + G.max.x) / 2, cy = (G.min.y + G.max.y) / 2;
    const line = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(L / step)); const pts = []; for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]); trace(pts); };
    const X0 = G.min.x, X1 = G.max.x, Y0 = G.min.y, Y1 = G.max.y;
    if (g.kind === "square") {
      for (let x = cx - Math.floor((cx - X0) / S) * S; x <= X1; x += S) line(x, Y0, x, Y1);
      for (let y = cy - Math.floor((cy - Y0) / S) * S; y <= Y1; y += S) line(X0, y, X1, y);
    } else if (g.kind === "tri") {
      const hS = (S * Math.sqrt(3)) / 2, span = Math.hypot(X1 - X0, Y1 - Y0);
      for (let y = cy - Math.ceil(span / hS) * hS; y <= cy + span; y += hS) line(X0, y, X1, y);
      for (const ang of [Math.PI / 3, (2 * Math.PI) / 3]) {
        const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
        for (let o = -Math.ceil(span / hS) * hS; o <= span; o += hS) { const ox = cx + px * o, oy = cy + py * o; line(ox - dx * span, oy - dy * span, ox + dx * span, oy + dy * span); }
      }
    } else if (g.kind === "rosette") {
      const R = Math.min(X1 - X0, Y1 - Y0) / 2 - 1;
      for (let r = S; r <= R + 1e-6; r += S) { const n = Math.max(24, Math.ceil((2 * Math.PI * r) / step)), pts = []; for (let i = 0; i <= n; i++) pts.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]); trace(pts); }
      for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; line(cx, cy, cx + R * Math.cos(a), cy + R * Math.sin(a)); }
    } else if (g.kind === "border") {
      for (const inset of [S * 0.6, S * 1.6]) { const x0 = X0 + inset, x1 = X1 - inset, y0 = Y0 + inset, y1 = Y1 - inset; if (x1 > x0 && y1 > y0) { line(x0, y0, x1, y0); line(x1, y0, x1, y1); line(x1, y1, x0, y1); line(x0, y1, x0, y0); } }
    }
    ui.guides = lines;
    drawLines();
  }

  // ------------------------------------------------------------------ the loop
  function showMsg(m) { if (!ui) return; if (ui.msg.textContent !== m) { ui.msg.textContent = m; ui.msg.hidden = !m; } }
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - ui.last) / 1000);
    ui.last = now;
    if (ui.G) {
      const t0 = performance.now();
      // the first build, then chunks changed by cuts
      if (ui.pending && ui.pending.length) {
        while (ui.pending.length && performance.now() - t0 < 30) rebuildChunk(ui.pending.pop());
        if (!ui.pending.length) { ui.pending = null; showMsg(""); makeGuides(); }
      }
      if (ui.dirty.size) {
        for (const k of [...ui.dirty]) { ui.dirty.delete(k); rebuildChunk(k); if (performance.now() - t0 > 40) break; }
        if (!ui.dirty.size) ui.linesDirty = true;
      }
      if (ui.linesDirty && !ui.stroke) drawLines();
      stepChips(dt);
      drawPreview();
    }
    const bar = document.getElementById("carve-meter-bar");
    if (bar) bar.style.height = Math.round(clamp(ui.pressure, 0, 1) * 100) + "%";
    placeCamera();
    ui.renderer.render(ui.scene, ui.cam);
  }
  function setInfo() {
    const i = document.getElementById("carve-info");
    if (!i || !ui.G) return;
    const src = ui.lastType === "pen" ? "Pen " + Math.round(ui.pressure * 100) + "%" : ui.lastType === "touch" ? "Finger " + Math.round(ui.pressure * 100) + "%" : "Mouse " + Math.round(ui.pressure * 100) + "%";
    const t = ui.st.tool;
    const deep = t === "pencil" || t === "eraser" || t === "sand" ? "" : " · up to " + depthFor(ui.pressure).toFixed(1) + " mm";
    const ang = (t === "vcut" || t === "stab" || t === "sweep") ? " · blade " + Math.round((bladeAngle() * 180) / Math.PI) + "°" : "";
    i.textContent = src + deep + ang;
  }

  // ------------------------------------------------------------------ finding the wood under the pointer
  const ray = new THREE.Raycaster();
  function local(e) { const r = ui.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function pick(x, y, A) {
    const G = ui.G; if (!G) return null;
    A = A || G.d;
    ray.setFromCamera(new THREE.Vector2((x / ui.w) * 2 - 1, -(y / ui.h) * 2 + 1), ui.cam);
    const box = new THREE.Box3(G.o.clone(), G.o.clone().add(new THREE.Vector3(G.nx - 1, G.ny - 1, G.nz - 1).multiplyScalar(G.h)));
    const r = ray.ray, hitIn = new THREE.Vector3();
    let t0 = 0;
    if (!box.containsPoint(r.origin)) { if (!r.intersectBox(box, hitIn)) return null; t0 = hitIn.distanceTo(r.origin); }
    const tExit = (() => { const far = r.origin.clone().addScaledVector(r.direction, 1e6); const back = new THREE.Ray(far, r.direction.clone().negate()); const q = new THREE.Vector3(); return back.intersectBox(box, q) ? q.distanceTo(r.origin) : t0; })();
    let t = t0 + 1e-4, p = new THREE.Vector3(), prevT = t;
    for (let s = 0; s < 6000 && t <= tExit; s++) {
      p.copy(r.origin).addScaledVector(r.direction, t);
      const v = sample(G, A, p.x, p.y, p.z);
      if (v < 0) {
        let a = prevT, b = t;
        for (let it = 0; it < 12; it++) { const m = (a + b) / 2; p.copy(r.origin).addScaledVector(r.direction, m); if (sample(G, A, p.x, p.y, p.z) < 0) b = m; else a = m; }
        p.copy(r.origin).addScaledVector(r.direction, a);
        const g = [0, 0, 0]; gradient(G, A, p.x, p.y, p.z, g);
        return { p: p.clone(), n: new THREE.Vector3(g[0], g[1], g[2]) };
      }
      prevT = t;
      t += Math.max(G.h * 0.35, Math.min(v, G.B) * 0.8);
    }
    return null;
  }
  // where the pointer is on the plane through c with normal n
  function onPlane(x, y, c, n) {
    ray.setFromCamera(new THREE.Vector2((x / ui.w) * 2 - 1, -(y / ui.h) * 2 + 1), ui.cam);
    const q = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, c), q) ? q : null;
  }

  // ------------------------------------------------------------------ pointers: pen, finger, mouse
  function readPen(e) {
    ui.lastType = e.pointerType;
    if (e.pointerType === "pen") {
      ui.penSeen = true;
      ui.pressure = e.pressure > 0 ? e.pressure : ui.pressure || 0.5;
      // the pen's angle to the screen as the blade's angle to the wood
      let alt = null;
      if (typeof e.altitudeAngle === "number" && e.altitudeAngle > 0 && e.altitudeAngle < Math.PI / 2 - 1e-3) alt = (e.altitudeAngle * 180) / Math.PI;
      else if (e.tiltX || e.tiltY) { const tx = Math.tan((e.tiltX * Math.PI) / 180), ty = Math.tan((e.tiltY * Math.PI) / 180); alt = 90 - (Math.atan(Math.hypot(tx, ty)) * 180) / Math.PI; }
      ui.tiltAngle = alt;
    } else {
      ui.tiltAngle = null;
      // a touch screen that reports force (3D Touch, some tablets)
      const forced = e.pointerType === "touch" && e.pressure > 0 && e.pressure !== 0.5 && e.pressure !== 1;
      ui.pressure = forced ? e.pressure : ui.st.push * (e.shiftKey ? 0.5 : 1);
    }
    setInfo();
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (!ui || !ui.G || ui.pending) return;
      e.preventDefault();
      c.focus({ preventScroll: true });
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const [x, y] = local(e);
      const info = { id: e.pointerId, x, y, x0: x, y0: y, type: e.pointerType, button: e.button };
      ui.pointers.set(e.pointerId, info);
      const touches = [...ui.pointers.values()].filter((p) => p.type === "touch");
      if (e.pointerType === "touch" && touches.length > 1) {
        // a second finger: look around (a cut that just started is kept)
        if (ui.pendingTouch) { clearTimeout(ui.pendingTouch.t); ui.pendingTouch = null; }
        endStroke(false); for (const p of touches) p.look = true; return;
      }
      const look = e.button === 2 || e.button === 1 || (e.button === 0 && (e.altKey || ui.handOn)) || (e.pointerType === "touch" && ui.st.penOnly && ui.penSeen);
      if (look) { info.look = true; info.pan = e.button === 1 || (e.button === 2 && e.shiftKey); return; }
      readPen(e);
      const startCut = () => {
        const h = pick(x, y);
        if (!h) { info.look = true; return; }
        info.cut = true;
        beginStroke(h, x, y, e);
      };
      // a finger waits a moment, in case a second one follows (to look around)
      if (e.pointerType === "touch") { ui.pendingTouch = { id: e.pointerId, t: setTimeout(() => { if (ui && ui.pendingTouch && ui.pendingTouch.id === e.pointerId) { ui.pendingTouch = null; startCut(); } }, 70) }; info.waiting = true; return; }
      startCut();
    });
    c.addEventListener("pointermove", (e) => {
      if (!ui || !ui.G) return;
      const [x, y] = local(e);
      const info = ui.pointers.get(e.pointerId);
      if (!info) { if (e.pointerType !== "touch") { ui.hover = ui.pending ? null : pick(x, y); if (e.pointerType === "pen") readPen(e); } return; }
      const dx = x - info.x, dy = y - info.y; info.x = x; info.y = y;
      if (info.cut) {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs.length ? evs : [e]) { readPen(ev); const [cx2, cy2] = local(ev); strokeMove(cx2, cy2, ev); }
        return;
      }
      if (info.waiting) return;
      const look = [...ui.pointers.values()].filter((p) => p.look);
      if (look.length >= 2) {
        const [a, b] = look, spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.spread0) ui.view.dist = clamp(ui.view.dist * (ui.spread0 / Math.max(1, spread)), 20, 8000);
        ui.spread0 = spread;
        if (info === a) pan(dx * 0.5, dy * 0.5);
        return;
      }
      if (info.look) { if (info.pan) pan(dx, dy); else orbit(dx, dy); }
    });
    const up = (e) => {
      if (!ui) return;
      const info = ui.pointers.get(e.pointerId);
      ui.pointers.delete(e.pointerId);
      if ([...ui.pointers.values()].filter((p) => p.look).length < 2) ui.spread0 = 0;
      if (ui.pendingTouch && ui.pendingTouch.id === e.pointerId) {
        // a quick tap with a finger: a chip or a stab right there
        clearTimeout(ui.pendingTouch.t); ui.pendingTouch = null;
        const h = pick(info.x, info.y);
        if (h && e.type === "pointerup") { readPen(e); beginStroke(h, info.x, info.y, e); endStroke(false); }
        return;
      }
      if (info && info.cut) endStroke(e.type !== "pointerup");
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch" && !ui.pointers.size) ui.hover = null; });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!ui) return;
      ui.view.dist = clamp(ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 20, 8000);
    }, { passive: false });
  }
  function orbit(dx, dy) { const v = ui.view; v.az -= dx * 0.006; v.el = clamp(v.el + dy * 0.006, -1.2, 1.55); if (ui.st.rake) setLight(); }
  function pan(dx, dy) {
    const cam = ui.cam, d = cam.position.distanceTo(ui.view.target), k = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / ui.h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    ui.view.target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
    if (ui.st.rake) setLight();
  }

  // ------------------------------------------------------------------ strokes
  function beginStroke(h, x, y) {
    const G = ui.G, st = ui.st;
    G.ref.set(G.d); // the surface as it was when the knife went in
    ui.stroke = { tool: st.tool, start: h, last: h, n: h.n.clone(), lastP: ui.pressure, maxP: ui.pressure, patches: [], sx: x, sy: y, scr: [x, y], pts: [h], pencilBefore: null, cut: 0 };
    if (st.tool === "pencil" || st.tool === "eraser") ui.stroke.pencilBefore = ui.pencil.map((l) => l.slice());
    if (st.tool === "pencil") ui.pencil.push([{ p: h.p.clone(), n: h.n.clone() }]);
    if (st.tool === "eraser") eraseAt(h.p);
    if (st.tool === "sand") sandAt(h.p, h.n);
  }
  function strokeMove(x, y) {
    const s = ui.stroke; if (!s) return;
    s.maxP = Math.max(s.maxP, ui.pressure);
    const st = ui.st;
    if (st.tool === "chip" || st.tool === "stab") { s.cur = [x, y]; return; }
    // a steady hand: the knife follows the pointer a little behind
    if (st.steady && st.tool !== "eraser" && st.tool !== "sand") { s.scr[0] += (x - s.scr[0]) * 0.45; s.scr[1] += (y - s.scr[1]) * 0.45; x = s.scr[0]; y = s.scr[1]; }
    const G = ui.G;
    const h = pick(x, y, st.tool === "vcut" || st.tool === "sweep" ? G.ref : G.d);
    if (!h) return;
    const gap = h.p.distanceTo(s.last.p);
    if (st.tool === "eraser") { if (gap > 0.5) { eraseAt(h.p); s.last = h; } return; }
    if (st.tool === "sand") { if (gap > Math.max(0.6, st.sandR * 0.3)) { sandAt(h.p, h.n); s.last = h; } return; }
    if (st.tool === "pencil") { if (gap > Math.max(0.3, G.h * 0.7)) { ui.pencil[ui.pencil.length - 1].push({ p: h.p.clone(), n: h.n.clone() }); s.last = h; ui.linesDirty = true; drawLines(); } return; }
    const spacing = Math.max(0.35, G.h * 0.9);
    if (gap < spacing) return;
    if (gap > 25) { s.last = h; return; } // jumped off an edge: start again from here
    s.n.lerp(h.n, 0.3).normalize();
    s.cut += grooveSeg(s.last.p, h.p, s.n, s.lastP, ui.pressure, st.tool);
    s.last = h; s.lastP = ui.pressure;
  }
  function chipGeom(s) {
    const st = ui.st, c = s.start.p, n = s.start.n;
    const at = s.cur ? onPlane(s.cur[0], s.cur[1], c, n) : null;
    let dir = at ? at.clone().sub(c) : null;
    let R = dir ? dir.length() : 0;
    // a frame on the surface to measure the angle from
    const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const e1 = ref.clone().addScaledVector(n, -ref.dot(n)).normalize(), e2 = new THREE.Vector3().crossVectors(n, e1);
    if (!dir || R < 1e-6) { dir = e2.clone(); R = 0; }
    if (st.tool === "chip" && st.snap && R > 0) {
      let a = Math.atan2(dir.dot(e2), dir.dot(e1));
      a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      dir = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    }
    return { c, n, dir: dir.normalize(), R };
  }
  function endStroke(cancel) {
    if (!ui) return;
    const s = ui.stroke; if (!s) return;
    const st = ui.st;
    if (!cancel) {
      if (s.tool === "chip") {
        const g = chipGeom(s);
        if (g.R < Math.max(1, ui.G.h * 2)) app.toast("Drag outward from the chip's center to size it.");
        else s.cut += cutChip(g.c, g.n, g.dir, g.R, s.maxP);
      } else if (s.tool === "stab") {
        const g = chipGeom(s);
        let dir = g.dir;
        if (g.R < 1) { const fwd = new THREE.Vector3(); ui.cam.getWorldDirection(fwd); dir = fwd.addScaledVector(g.n, -fwd.dot(g.n)); if (dir.length() < 1e-3) dir.set(0, 1, 0); dir.normalize(); }
        s.cut += cutStab(g.c, g.n, dir, s.maxP);
      } else if ((s.tool === "vcut" || s.tool === "sweep") && s.last === s.start) {
        // a tap: a short nick
        const fwd = new THREE.Vector3(); ui.cam.getWorldDirection(fwd);
        const t = fwd.addScaledVector(s.n, -fwd.dot(s.n)); if (t.length() < 1e-3) t.set(1, 0, 0); t.normalize();
        s.cut += grooveSeg(s.start.p.clone().addScaledVector(t, -0.6), s.start.p.clone().addScaledVector(t, 0.6), s.n, s.maxP, s.maxP, s.tool);
      }
    }
    ui.stroke = null;
    const step = { patches: s.patches };
    if (s.pencilBefore) step.pencilBefore = s.pencilBefore;
    if (step.patches.length || step.pencilBefore) { st.undo.push(step); if (st.undo.length > 60) st.undo.shift(); st.redo = []; }
    if (s.tool === "pencil" && ui.pencil.length && ui.pencil[ui.pencil.length - 1].length < 2) ui.pencil.pop();
    ui.linesDirty = true;
    updateUndoBtns();
  }
  function eraseAt(p) {
    const R = ui.st.eraseR, out = [];
    for (const line of ui.pencil) {
      let cur = [];
      for (const q of line) { if (q.p.distanceTo(p) <= R) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(q); }
      if (cur.length > 1) out.push(cur);
    }
    ui.pencil = out;
    drawLines();
  }

  // the chip, stab and hover outlines (drawn over the wood)
  function drawPreview() {
    if (ui.prevObj) { ui.over.remove(ui.prevObj); ui.prevObj.geometry.dispose(); ui.prevObj.material.dispose(); ui.prevObj = null; }
    const s = ui.stroke, st = ui.st, seg = [];
    const ring = (c, n, r, k = 32) => { const u = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize(), w = new THREE.Vector3().crossVectors(n, u); for (let i = 0; i < k; i++) { const a0 = (i / k) * 2 * Math.PI, a1 = ((i + 1) / k) * 2 * Math.PI; const p0 = c.clone().addScaledVector(u, r * Math.cos(a0)).addScaledVector(w, r * Math.sin(a0)).addScaledVector(n, 0.1), p1 = c.clone().addScaledVector(u, r * Math.cos(a1)).addScaledVector(w, r * Math.sin(a1)).addScaledVector(n, 0.1); seg.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); } };
    let color = 0xd9480f;
    if (s && (s.tool === "chip" || s.tool === "stab")) {
      const g = chipGeom(s);
      if (s.tool === "chip" && g.R > 0) {
        const pts = chipCorners(g.c, g.n, g.dir, g.R, st.shape).map((p) => p.addScaledVector(g.n, 0.1));
        const dep = chipDepth(g.R, st.shape, s.maxP), apex = g.c.clone().addScaledVector(g.n, -dep);
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; seg.push(a.x, a.y, a.z, b.x, b.y, b.z); seg.push(a.x, a.y, a.z, apex.x, apex.y, apex.z); }
        const tn = document.getElementById("carve-info"); if (tn) tn.textContent = `Chip ${(g.R * 2).toFixed(1)} mm across · ${dep.toFixed(1)} mm deep`;
      } else if (s.tool === "stab") {
        let dir = g.dir; if (g.R < 1) { const fwd = new THREE.Vector3(); ui.cam.getWorldDirection(fwd); dir = fwd.addScaledVector(g.n, -fwd.dot(g.n)).normalize(); }
        const a = g.c.clone().addScaledVector(dir, -st.stabLen / 2).addScaledVector(g.n, 0.1), b = g.c.clone().addScaledVector(dir, st.stabLen / 2).addScaledVector(g.n, 0.1);
        const side = new THREE.Vector3().crossVectors(g.n, dir).multiplyScalar(depthFor(s.maxP) * 0.35);
        const b1 = b.clone().add(side), b2 = b.clone().sub(side);
        seg.push(a.x, a.y, a.z, b1.x, b1.y, b1.z, a.x, a.y, a.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z);
      }
    } else if (!s && ui.hover && !ui.pointers.size) {
      const h = ui.hover, t = st.tool;
      color = 0x2f66c8;
      const r = t === "sand" ? st.sandR : t === "eraser" ? st.eraseR : t === "pencil" ? 0.4 : t === "chip" ? 0.8 : Math.max(0.5, depthFor(ui.pressure) * Math.tan(Math.PI / 2 - bladeAngle()));
      ring(h.p, h.n, r);
    }
    if (!seg.length) return;
    const o = thickLines(seg, color, 1.6, false); o.renderOrder = 6;
    ui.over.add(o); ui.prevObj = o;
  }

  // ------------------------------------------------------------------ undo / redo
  function swapPatch(p) {
    const G = ui.G, { nx, ny, d } = G;
    let m = 0;
    for (let k = p.k0; k < p.k0 + p.sz; k++) for (let j = p.j0; j < p.j0 + p.sy; j++) for (let i = p.i0; i < p.i0 + p.sx; i++, m++) { const q = i + nx * (j + ny * k), t = d[q]; d[q] = p.old[m]; p.old[m] = t; }
    markDirty(p.i0, p.i0 + p.sx - 1, p.j0, p.j0 + p.sy - 1, p.k0, p.k0 + p.sz - 1);
  }
  function undo() {
    const st = ui.st; if (!ui.G || !st.undo.length) return;
    endStroke(true);
    const s = st.undo.pop();
    for (let i = s.patches.length - 1; i >= 0; i--) swapPatch(s.patches[i]);
    if (s.pencilBefore) { const now = ui.pencil; ui.pencil = s.pencilBefore; s.pencilBefore = now; }
    st.redo.push(s); ui.linesDirty = true; updateUndoBtns();
  }
  function redo() {
    const st = ui.st; if (!ui.G || !st.redo.length) return;
    const s = st.redo.pop();
    for (const p of s.patches) swapPatch(p);
    if (s.pencilBefore) { const now = ui.pencil; ui.pencil = s.pencilBefore; s.pencilBefore = now; }
    st.undo.push(s); ui.linesDirty = true; updateUndoBtns();
  }

  // ------------------------------------------------------------------ keys
  function onKey(e) {
    if (!ui) return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
    const modal = ui.root.querySelector(".s3d-modal-back");
    if (modal) { e.stopPropagation(); if (e.key === "Escape" && modal.classList.contains("carve-leave")) modal.remove(); return; }
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    let done = true;
    if (mod && k === "z" && !e.shiftKey) undo();
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) redo();
    else if (!mod && /^[1-7]$/.test(k)) setTool(Object.keys(TOOLS)[+k - 1]);
    else if (!mod && (k === "[" || k === "]")) { ui.st.depth = clamp(ui.st.depth + (k === "]" ? 0.5 : -0.5), 0.5, 10); setPref("depth", ui.st.depth); renderBar(); }
    else if (e.key === "Enter" && ui.G) finish();
    else if (e.key === "Escape") { if (ui.stroke) endStroke(true); else close(false); }
    else done = false;
    if (done) e.preventDefault();
    e.stopPropagation(); // the main app's shortcuts are off while carving
  }

  // ------------------------------------------------------------------ the finished carving
  // every chunk's surface, welded into one closed mesh (world mm)
  function fullMesh() {
    for (const k of [...ui.dirty]) rebuildChunk(k);
    ui.dirty.clear();
    if (ui.pending) { while (ui.pending.length) rebuildChunk(ui.pending.pop()); ui.pending = null; }
    const map = new Map(), V = [], I = [];
    for (const c of ui.chunks.values()) weldInto(map, V, I, c.data);
    return { V: new Float32Array(V), I: new Uint32Array(I) };
  }
  function signedVolume({ V, I }) {
    let s = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      s += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
    }
    return s / 6;
  }
  const colorHex = () => "#" + ui.G.look.base.getHexString();
  function finish() {
    if (!ui.G) return;
    endStroke(true);
    const st = ui.st;
    const back = el("div", { class: "s3d-modal-back lathe-done-back" });
    const card = el("div", { class: "s3d-modal" });
    const render = () => {
      card.innerHTML = "";
      card.append(el("h3", {}, "Your chip carving"),
        el("p", { class: "hint", style: { padding: 0 } }, "Add it to your design as a mesh body (move, scale and combine it in Beginner and Advanced, or sculpt it in Chisel), or save a file for a slicer or another app."));
      card.append(el("div", { class: "row" }, el("span", {}, "Detail in the design"), el("div", { class: "seg s3d-seg", id: "carve-outdetail" },
        ...[["std", "Standard", "Up to 20,000 triangles: quick to edit"], ["high", "High", "Up to 40,000 triangles: sharper, slower to edit"]].map(([v, l, t]) => el("button", { "aria-pressed": String(st.outDetail === v), title: t, onclick: () => { st.outDetail = v; setPref("outDetail", v); render(); } }, l)))));
      if (st.src === "body") card.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "carve-copy2", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; setPref("copy", st.copy); } }), "Add it as a copy (keep the original as it is)"));
      card.append(el("div", { class: "row lathe-exp" }, el("span", {}, "Export (full detail)"),
        ...["stl", "3mf", "obj"].map((f) => el("button", { class: "btn", id: "carve-exp-" + f, title: `Save the carving as a .${f} file`, onclick: () => exportFile(f) }, f.toUpperCase()))));
      card.append(el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => back.remove() }, "Keep carving"),
        el("button", { class: "btn primary", id: "carve-add", onclick: () => { back.remove(); commit(); } }, "Add to design")));
    };
    render();
    back.append(card); ui.root.append(back);
  }
  function finalMesh(limit) {
    let m = fullMesh();
    if (!m.I.length) return null;
    if (signedVolume(m) < 0) { const I = m.I; for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } }
    if (limit && m.I.length / 3 > limit) m = simplify(m, limit).mesh;
    return m;
  }
  function stlFile(m) {
    const { V, I } = m, n = I.length / 3, dv = new DataView(new ArrayBuffer(84 + n * 50));
    const head = "JumpStart 3D chip carving (mm)"; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      for (const f of [nx / l, ny / l, nz / l, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(o, f, true); o += 4; }
      o += 2;
    }
    return new Uint8Array(dv.buffer);
  }
  const num = (x) => { const r = Math.round(x * 1e4) / 1e4; return Object.is(r, -0) ? "0" : String(r); };
  function objFile(m) {
    const out = ["# JumpStart 3D chip carving, millimeters", "o Chip_carving"];
    for (let i = 0; i < m.V.length; i += 3) out.push("v " + num(m.V[i]) + " " + num(m.V[i + 1]) + " " + num(m.V[i + 2]));
    for (let t = 0; t < m.I.length; t += 3) out.push("f " + (m.I[t] + 1) + " " + (m.I[t + 1] + 1) + " " + (m.I[t + 2] + 1));
    return new TextEncoder().encode(out.join("\n") + "\n");
  }
  async function threeMFFile(m, color) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">JumpStart 3D</metadata>', ' <resources>\n  <basematerials id="1">', '   <base name="Wood" displaycolor="' + color.toUpperCase() + 'FF"/>', "  </basematerials>", '  <object id="2" type="model" name="Chip carving" pid="1" pindex="0">\n   <mesh>\n    <vertices>'];
    for (let i = 0; i < m.V.length; i += 3) out.push('     <vertex x="' + num(m.V[i]) + '" y="' + num(m.V[i + 1]) + '" z="' + num(m.V[i + 2]) + '"/>');
    out.push("    </vertices>\n    <triangles>");
    for (let t = 0; t < m.I.length; t += 3) out.push('     <triangle v1="' + m.I[t] + '" v2="' + m.I[t + 1] + '" v3="' + m.I[t + 2] + '"/>');
    out.push("    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid=\"2\"/>\n </build>\n</model>\n");
    const enc = new TextEncoder();
    const z = makeZip([
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: "3D/3dmodel.model", data: enc.encode(out.join("\n")) },
    ]);
    return new Uint8Array(await z.arrayBuffer());
  }
  async function exportFile(fmt) {
    if (!ui.G) return;
    endStroke(true);
    showMsg("Preparing the file…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const m = finalMesh(0);
      if (!m) { app.toast("There's nothing to export.", "err"); return; }
      const bytes = fmt === "stl" ? stlFile(m) : fmt === "obj" ? objFile(m) : await threeMFFile(m, colorHex());
      const nm = ((ui.st.src === "body" ? (findBody(store.doc, ui.st.bodyId) || {}).name : null) || "Chip carving").replace(/[\\/:*?"<>|]+/g, "").trim() || "Chip carving";
      ui.lastExport = { fmt, size: bytes.length, tris: m.I.length / 3 };
      if (app.projects && app.projects.saveModel) await app.projects.saveModel(nm + (ui.st.src === "body" ? " (carved)" : "") + "." + fmt, bytes);
      app.onExport && app.onExport(fmt);
    } finally { showMsg(""); }
  }
  async function commit() {
    const st = ui.st;
    showMsg("Adding it to your design…");
    await new Promise((r) => setTimeout(r, 40));
    if (!ui) return;
    const m = finalMesh(st.outDetail === "high" ? 40000 : MESH_LIMIT);
    if (!m) { showMsg(""); app.toast("There's nothing left to add.", "err"); return; }
    const color = colorHex(), ids = [];
    store.update((doc) => {
      doc.assets = doc.assets || {};
      const bytes = packMesh(m), id = contentId(bytes);
      if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: "Chip carving", data: toB64(bytes) };
      const b = { id: uid("b"), name: nextName(doc, "Chip carving"), seq: nextSeq(doc), color, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] } };
      doc.bodies.push(b); ids.push(b.id);
      if (st.src === "body" && !st.copy) { const o = findBody(doc, st.bodyId); if (o) o.hidden = true; }
    }, "Chip carving");
    const from = st.from;
    close(true);
    if (from !== "chisel") app.select && app.select(ids);
    app.toast("Added your chip carving. It takes a moment to build.");
    if (from === "chisel" && app.chisel) {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ready = ids.every((id) => (app.scene.views.get(id) || {}).data || app.scene.errors.has(id));
        if (ready || Date.now() - t0 > 60000) { clearInterval(iv); app.chisel.load({ keepUndo: true }); }
      }, 300);
    }
  }
  function askLeave() {
    if (ui.root.querySelector(".carve-leave")) return;
    endStroke(true);
    const back = el("div", { class: "s3d-modal-back carve-leave" });
    const done = () => back.remove();
    const card = el("div", { class: "s3d-modal", role: "alertdialog", "aria-label": "Leave Chip Carving" },
      el("h3", {}, "Leave Chip Carving?"),
      el("p", { class: "hint", style: { padding: 0 } }, "You've carved this piece. What would you like to do with it?"),
      el("div", { class: "lathe-leave-btns" },
        el("button", { class: "btn primary", id: "carve-leave-keep", onclick: () => { done(); commit(); } }, "Keep it (add it to my design)"),
        el("button", { class: "btn", id: "carve-leave-carve", onclick: () => { done(); ui.canvas.focus({ preventScroll: true }); } }, "Keep carving"),
        el("button", { class: "btn danger", id: "carve-leave-discard", onclick: () => { done(); close(false, true); } }, "Discard it and leave")));
    back.append(card); ui.root.append(back);
    setTimeout(() => card.querySelector("#carve-leave-carve").focus(), 30);
  }
  function close(saved, quiet) {
    if (!ui) return;
    if (!saved && !quiet && ui.st.undo.length) { askLeave(); return; }
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    if (ui.pendingTouch) clearTimeout(ui.pendingTouch.t);
    for (const g of [ui.work, ui.bench, ui.over, ui.chipsGroup]) clearGroup(g);
    if (ui.mat) ui.mat.dispose();
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    const from = ui.st.from;
    ui = null;
    if (from && app.mode !== from) app.setMode(from);
  }

  return {
    open, close: () => close(false, true), get active() { return !!ui; },
    // for tests
    _ui: () => ui, _pick: (x, y) => ui && pick(x, y), _mesh: () => finalMesh(0), _vol: signedVolume,
    _chip: (c, n, dir, R, p) => { ui.stroke = { patches: [] }; const v = cutChip(c, n, dir, R, p); const s = ui.stroke; ui.stroke = null; ui.st.undo.push({ patches: s.patches }); updateUndoBtns(); return v; },
    _groove: (a, b, n, p, kind) => { ui.stroke = { patches: [] }; const v = grooveSeg(a, b, n, p, p, kind || "vcut"); const s = ui.stroke; ui.stroke = null; ui.st.undo.push({ patches: s.patches }); updateUndoBtns(); return v; },
    _ready: () => !!(ui && ui.G && !ui.pending && !ui.dirty.size),
    _last: () => ui && ui.lastExport,
  };
}
