// A small linear-elastic finite element solver for stress tests: the body is
// voxelized into 8-node bricks, loads and supports come from picked faces, and the
// system is solved with a preconditioned conjugate gradient. Units: mm, N, MPa.

// ------------------------------------------------------------------ materials
// E in MPa, yield (or tensile) strength in MPa, density g/cm³ — typical handbook values
export const MATERIALS = {
  steel: { name: "Steel (mild, S235)", E: 200000, nu: 0.29, yield: 235, rho: 7.85 },
  stainless: { name: "Stainless steel 304", E: 193000, nu: 0.29, yield: 215, rho: 8.0 },
  aluminum: { name: "Aluminum 6061-T6", E: 69000, nu: 0.33, yield: 276, rho: 2.7 },
  brass: { name: "Brass", E: 100000, nu: 0.34, yield: 200, rho: 8.5 },
  titanium: { name: "Titanium Ti-6Al-4V", E: 114000, nu: 0.34, yield: 880, rho: 4.43 },
  abs: { name: "ABS (molded)", E: 2200, nu: 0.35, yield: 40, rho: 1.04 },
  pla: { name: "PLA (molded)", E: 3500, nu: 0.36, yield: 60, rho: 1.24 },
  nylon: { name: "Nylon 6 (molded)", E: 2500, nu: 0.39, yield: 70, rho: 1.14 },
  acrylic: { name: "Acrylic (PMMA)", E: 3200, nu: 0.37, yield: 70, rho: 1.18 },
  wood: { name: "Pine (along grain)", E: 9000, nu: 0.3, yield: 40, rho: 0.5 },
};
// FDM filaments: E, tensile strength along the layers (xy) and across them (z, layer
// adhesion). Typical values for well-tuned prints; real parts vary with settings.
export const FILAMENTS = {
  pla: { name: "PLA", E: 3000, xy: 50, z: 30, rho: 1.24 },
  plaplus: { name: "PLA+ / Tough PLA", E: 2800, xy: 48, z: 33, rho: 1.24 },
  petg: { name: "PETG", E: 2000, xy: 45, z: 32, rho: 1.27 },
  abs: { name: "ABS", E: 2000, xy: 35, z: 20, rho: 1.04 },
  asa: { name: "ASA", E: 2000, xy: 38, z: 22, rho: 1.07 },
  nylon: { name: "Nylon (PA6/PA12)", E: 1500, xy: 55, z: 35, rho: 1.1 },
  pc: { name: "Polycarbonate", E: 2300, xy: 60, z: 35, rho: 1.2 },
  cfpla: { name: "Carbon-fiber PLA", E: 4500, xy: 45, z: 22, rho: 1.3 },
  cfnylon: { name: "Carbon-fiber Nylon", E: 6000, xy: 75, z: 30, rho: 1.2 },
  peek: { name: "PEEK", E: 3800, xy: 90, z: 50, rho: 1.3 },
  tpu: { name: "TPU 95A (flexible)", E: 30, xy: 30, z: 20, rho: 1.21, flexible: true },
};

// ------------------------------------------------------------------ element
// node order: (0,0,0) (1,0,0) (1,1,0) (0,1,0) (0,0,1) (1,0,1) (1,1,1) (0,1,1)
const NODE = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
function Dmat(E, nu) {
  const c = E / ((1 + nu) * (1 - 2 * nu)), a = c * (1 - nu), b = c * nu, g = c * (1 - 2 * nu) / 2;
  return [[a, b, b, 0, 0, 0], [b, a, b, 0, 0, 0], [b, b, a, 0, 0, 0], [0, 0, 0, g, 0, 0], [0, 0, 0, 0, g, 0], [0, 0, 0, 0, 0, g]];
}
// strain-displacement matrix of a unit cube at natural point (xi, eta, zeta); h = 1
function Bmat(xi, eta, ze, hs = [1, 1, 1]) {
  const B = Array.from({ length: 6 }, () => new Float64Array(24));
  for (let i = 0; i < 8; i++) {
    const [a, b, c] = NODE[i];
    // dN/dx = dN/dxi * 2/hx (the brick spans xi -1..1)
    const dx = (a * (1 + b * eta) * (1 + c * ze)) / 8 * 2 / hs[0], dy = (b * (1 + a * xi) * (1 + c * ze)) / 8 * 2 / hs[1], dz = (c * (1 + a * xi) * (1 + b * eta)) / 8 * 2 / hs[2];
    B[0][3 * i] = dx; B[1][3 * i + 1] = dy; B[2][3 * i + 2] = dz;
    B[3][3 * i] = dy; B[3][3 * i + 1] = dx; // gamma xy
    B[4][3 * i + 1] = dz; B[4][3 * i + 2] = dy; // gamma yz
    B[5][3 * i] = dz; B[5][3 * i + 2] = dx; // gamma xz
  }
  return B;
}
// incompatible bending modes (Wilson): 1-xi², 1-eta², 1-zeta² for each component;
// they stop the brick from locking up in bending. G is their strain matrix.
function Gmat(xi, eta, ze, hs = [1, 1, 1]) {
  const G = Array.from({ length: 6 }, () => new Float64Array(9));
  const d = [[(-4 * xi) / hs[0], 0, 0], [0, (-4 * eta) / hs[1], 0], [0, 0, (-4 * ze) / hs[2]]]; // d/dx,y,z of each mode
  for (let m = 0; m < 3; m++) {
    const [dx, dy, dz] = d[m];
    G[0][3 * m] = dx; G[1][3 * m + 1] = dy; G[2][3 * m + 2] = dz;
    G[3][3 * m] = dy; G[3][3 * m + 1] = dx;
    G[4][3 * m + 1] = dz; G[4][3 * m + 2] = dy;
    G[5][3 * m] = dz; G[5][3 * m + 2] = dx;
  }
  return G;
}
function invert(A, n) {
  const M = A.map((r) => [...r]), I = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; [I[c], I[p]] = [I[p], I[c]];
    const d = M[c][c];
    for (let j = 0; j < n; j++) { M[c][j] /= d; I[c][j] /= d; }
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < n; j++) { M[r][j] -= f * M[c][j]; I[r][j] -= f * I[c][j]; } }
  }
  return I;
}
// stiffness of a unit cube (E = 1) with the bending modes condensed out, plus the
// matrix that recovers the mode amplitudes from the corner displacements
function elementSetup(nu, hs) {
  const D = Dmat(1, nu), g = 1 / Math.sqrt(3);
  const Kuu = Array.from({ length: 24 }, () => new Float64Array(24)), Kua = Array.from({ length: 24 }, () => new Float64Array(9)), Kaa = Array.from({ length: 9 }, () => new Float64Array(9));
  const mulT = (X, Y, n1, n2, out, w) => { // out += X^T D Y * w
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) { let s = 0; for (let k = 0; k < 6; k++) { let t = 0; for (let l = 0; l < 6; l++) t += D[k][l] * Y[l][j]; s += X[k][i] * t; } out[i][j] += s * w; }
  };
  for (const xi of [-g, g]) for (const et of [-g, g]) for (const ze of [-g, g]) {
    const B = Bmat(xi, et, ze, hs), G = Gmat(xi, et, ze, hs), w = (hs[0] * hs[1] * hs[2]) / 8;
    mulT(B, B, 24, 24, Kuu, w); mulT(B, G, 24, 9, Kua, w); mulT(G, G, 9, 9, Kaa, w);
  }
  const Ai = invert(Kaa.map((r) => [...r]), 9);
  // R = -Kaa^-1 Kau  (9 x 24)
  const R = Array.from({ length: 9 }, (_, i) => { const r = new Float64Array(24); for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 9; k++) s += Ai[i][k] * Kua[j][k]; r[j] = -s; } return r; });
  const K = new Float64Array(576);
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let s = 0; for (let k = 0; k < 9; k++) s += Kua[i][k] * R[k][j]; K[i * 24 + j] = Kuu[i][j] + s; }
  return { K, R, D };
}

// ------------------------------------------------------------------ voxelize
// pos: world-space vertex positions; tri: indices. Returns active voxels on a grid.
export function voxelize(pos, tri, target = 5000) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], vol = 0;
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
  vol = Math.abs(vol);
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  let h = Math.cbrt(vol / target) || Math.max(...size) / 10;
  // never fewer than ~3 voxels across the thinnest overall dimension
  h = Math.min(h, Math.max(Math.min(...size.filter((s) => s > 1e-9)) / 3, 1e-3));
  // bricks fitted exactly to the bounds (slightly non-cubic), so flat sides line up
  const n = size.map((s) => Math.max(1, Math.round(s / h)));
  const hs = size.map((s, k) => (s > 1e-9 ? s / n[k] : h));
  const o = mn.slice();
  const [nx, ny, nz] = n;
  const solid = new Uint8Array(nx * ny * nz);
  const rows = Array.from({ length: ny * nz }, () => []);
  for (let t = 0; t < tri.length; t += 3) {
    const A = [pos[tri[t] * 3], pos[tri[t] * 3 + 1], pos[tri[t] * 3 + 2]], B = [pos[tri[t + 1] * 3], pos[tri[t + 1] * 3 + 1], pos[tri[t + 1] * 3 + 2]], C = [pos[tri[t + 2] * 3], pos[tri[t + 2] * 3 + 1], pos[tri[t + 2] * 3 + 2]];
    const j0 = Math.max(0, Math.floor((Math.min(A[1], B[1], C[1]) - o[1]) / hs[1] - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(A[1], B[1], C[1]) - o[1]) / hs[1] - 0.5));
    const k0 = Math.max(0, Math.floor((Math.min(A[2], B[2], C[2]) - o[2]) / hs[2] - 0.5)), k1 = Math.min(nz - 1, Math.ceil((Math.max(A[2], B[2], C[2]) - o[2]) / hs[2] - 0.5));
    const den = (B[1] - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (B[2] - A[2]);
    if (Math.abs(den) < 1e-14) continue;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
      const y = o[1] + (j + 0.5) * hs[1] + hs[1] * 1.3e-5, z = o[2] + (k + 0.5) * hs[2] + hs[2] * 0.7e-5;
      const u = ((y - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (z - A[2])) / den;
      const v = ((B[1] - A[1]) * (z - A[2]) - (y - A[1]) * (B[2] - A[2])) / den;
      if (u < 0 || v < 0 || u + v > 1) continue;
      rows[k * ny + j].push(A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]));
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const xs = rows[r].sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - o[0]) / hs[0] - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - o[0]) / hs[0] - 0.5));
      for (let i = i0; i <= i1; i++) solid[r * nx + i] = 1;
    }
  }
  return { o, h, hs, n, solid, vol };
}

// ------------------------------------------------------------------ model
export function buildModel(vox) {
  const { n, solid } = vox, [nx, ny, nz] = n;
  const NX = nx + 1, NY = ny + 1;
  const gid = (i, j, k) => i + NX * (j + NY * k);
  const map = new Int32Array(NX * NY * (nz + 1)).fill(-1);
  const elems = [];
  const eijk = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!solid[i + nx * (j + ny * k)]) continue;
    const ids = [gid(i, j, k), gid(i + 1, j, k), gid(i + 1, j + 1, k), gid(i, j + 1, k), gid(i, j, k + 1), gid(i + 1, j, k + 1), gid(i + 1, j + 1, k + 1), gid(i, j + 1, k + 1)];
    elems.push(ids);
    eijk.push(i, j, k);
  }
  let nn = 0;
  for (const ids of elems) for (const g of ids) if (map[g] < 0) map[g] = nn++;
  const conn = new Int32Array(elems.length * 8);
  elems.forEach((ids, e) => ids.forEach((g, q) => (conn[e * 8 + q] = map[g])));
  const coords = new Float64Array(nn * 3);
  for (let g = 0; g < map.length; g++) if (map[g] >= 0) {
    const i = g % NX, j = Math.floor(g / NX) % NY, k = Math.floor(g / (NX * NY));
    coords[map[g] * 3] = vox.o[0] + i * vox.hs[0]; coords[map[g] * 3 + 1] = vox.o[1] + j * vox.hs[1]; coords[map[g] * 3 + 2] = vox.o[2] + k * vox.hs[2];
  }
  return { ...vox, conn, nE: elems.length, nN: nn, map, coords, eijk: new Int32Array(eijk), gid };
}
// nearest model node to a world point (searching nearby grid nodes)
export function nearestNode(M, p) {
  const [nx, ny, nz] = M.n;
  const fi = (p[0] - M.o[0]) / M.hs[0], fj = (p[1] - M.o[1]) / M.hs[1], fk = (p[2] - M.o[2]) / M.hs[2];
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 2 && best < 0; r++) {
    for (let k = Math.round(fk) - r; k <= Math.round(fk) + r; k++) for (let j = Math.round(fj) - r; j <= Math.round(fj) + r; j++) for (let i = Math.round(fi) - r; i <= Math.round(fi) + r; i++) {
      if (i < 0 || j < 0 || k < 0 || i > nx || j > ny || k > nz) continue;
      const id = M.map[M.gid(i, j, k)];
      if (id < 0) continue;
      const d = (i - fi) ** 2 + (j - fj) ** 2 + (k - fk) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
  }
  return best;
}
// sample points spread over triangles (for spreading loads and supports over faces)
export function samplePoints(tris, perArea) {
  // tris: array of [a,b,c] points; each sample carries its share of the face area
  const out = [];
  for (const [a, b, c] of tris) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const area = Math.hypot(...cr) / 2;
    if (area < 1e-12) continue;
    const nrm = cr.map((x) => x / (2 * area));
    const steps = Math.max(1, Math.ceil(Math.sqrt(area * perArea * 2)));
    const local = [];
    for (let i = 0; i < steps; i++) for (let j = 0; j < steps - i; j++) {
      const u = (i + 1 / 3) / steps, v = (j + 1 / 3) / steps;
      local.push([a[0] + u * ab[0] + v * ac[0], a[1] + u * ab[1] + v * ac[1], a[2] + u * ab[2] + v * ac[2]]);
    }
    for (const p of local) out.push({ p, w: area / local.length, n: nrm });
  }
  return out;
}

// ------------------------------------------------------------------ solve
// fixed: Uint8Array per dof; f: Float64Array forces. Solves K u = f for E = 1 (scale
// displacements by 1/E afterwards; stresses don't depend on E).
export async function solve(M, fixed, f, nu, onProgress, maxIt = 6000) {
  const EL = elementSetup(nu, M.hs), Ke = EL.K, h = 1, nd = M.nN * 3, conn = M.conn, nE = M.nE;
  const diag = new Float64Array(nd);
  for (let e = 0; e < nE; e++) for (let a = 0; a < 8; a++) for (let c = 0; c < 3; c++) diag[conn[e * 8 + a] * 3 + c] += Ke[(a * 3 + c) * 25] * h;
  for (let i = 0; i < nd; i++) if (fixed[i] || !(diag[i] > 0)) diag[i] = 1;
  const ue = new Float64Array(24), fe = new Float64Array(24);
  const matvec = (x, y) => {
    y.fill(0);
    for (let e = 0; e < nE; e++) {
      const o = e * 8;
      for (let a = 0; a < 8; a++) { const n3 = conn[o + a] * 3; ue[a * 3] = x[n3]; ue[a * 3 + 1] = x[n3 + 1]; ue[a * 3 + 2] = x[n3 + 2]; }
      for (let i = 0; i < 24; i++) { let s = 0; const r = i * 24; for (let j = 0; j < 24; j++) s += Ke[r + j] * ue[j]; fe[i] = s * h; }
      for (let a = 0; a < 8; a++) { const n3 = conn[o + a] * 3; y[n3] += fe[a * 3]; y[n3 + 1] += fe[a * 3 + 1]; y[n3 + 2] += fe[a * 3 + 2]; }
    }
    for (let i = 0; i < nd; i++) if (fixed[i]) y[i] = x[i];
  };
  const b = new Float64Array(f);
  for (let i = 0; i < nd; i++) if (fixed[i]) b[i] = 0;
  const u = new Float64Array(nd), r = new Float64Array(b), z = new Float64Array(nd), p = new Float64Array(nd), Ap = new Float64Array(nd);
  for (let i = 0; i < nd; i++) { z[i] = r[i] / diag[i]; p[i] = z[i]; }
  let rz = 0, bn = 0;
  for (let i = 0; i < nd; i++) { rz += r[i] * z[i]; bn += b[i] * b[i]; }
  bn = Math.sqrt(bn) || 1;
  let it = 0, res = 1;
  const t0 = performance.now();
  while (it < maxIt) {
    matvec(p, Ap);
    let pAp = 0;
    for (let i = 0; i < nd; i++) pAp += p[i] * Ap[i];
    if (!(Math.abs(pAp) > 1e-300)) break;
    const alpha = rz / pAp;
    let rn = 0;
    for (let i = 0; i < nd; i++) { u[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rn += r[i] * r[i]; }
    res = Math.sqrt(rn) / bn;
    it++;
    if (res < 1e-6) break;
    let rz2 = 0;
    for (let i = 0; i < nd; i++) { z[i] = r[i] / diag[i]; rz2 += r[i] * z[i]; }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < nd; i++) p[i] = z[i] + beta * p[i];
    if (it % 20 === 0) {
      onProgress && onProgress(it, res);
      await new Promise((ok) => setTimeout(ok, 0));
      if (M.cancel) throw new Error("cancelled");
    }
  }
  // stresses (E = 1) at each element's corners, averaged at the nodes: this reads the
  // surface stress (where parts break) instead of the softer value at the center
  const D = EL.D, R = EL.R;
  const corners = NODE.map(([a, b, c]) => ({ B: Bmat(a, b, c, M.hs), G: Gmat(a, b, c, M.hs) }));
  const stress = new Float64Array(nE * 6), vm = new Float64Array(nE);
  const nodeS = new Float64Array(M.nN * 6), nodeC = new Float32Array(M.nN);
  const alpha = new Float64Array(9), eps = new Float64Array(6), sg = new Float64Array(6);
  const vmOf = (q) => Math.sqrt(0.5 * ((q[0] - q[1]) ** 2 + (q[1] - q[2]) ** 2 + (q[2] - q[0]) ** 2) + 3 * (q[3] * q[3] + q[4] * q[4] + q[5] * q[5]));
  for (let e = 0; e < nE; e++) {
    for (let a = 0; a < 8; a++) { const n3 = conn[e * 8 + a] * 3; ue[a * 3] = u[n3]; ue[a * 3 + 1] = u[n3 + 1]; ue[a * 3 + 2] = u[n3 + 2]; }
    for (let k = 0; k < 9; k++) { let t = 0; for (let j = 0; j < 24; j++) t += R[k][j] * ue[j]; alpha[k] = t; }
    for (let c = 0; c < 8; c++) {
      const { B, G } = corners[c];
      for (let k = 0; k < 6; k++) { let t = 0; for (let j = 0; j < 24; j++) t += B[k][j] * ue[j]; for (let j = 0; j < 9; j++) t += G[k][j] * alpha[j]; eps[k] = t / h; }
      for (let k = 0; k < 6; k++) { let t = 0; for (let j = 0; j < 6; j++) t += D[k][j] * eps[j]; sg[k] = t; stress[e * 6 + k] += t / 8; }
      const nid = conn[e * 8 + c];
      for (let k = 0; k < 6; k++) nodeS[nid * 6 + k] += sg[k];
      nodeC[nid]++;
    }
  }
  const nodeVM = new Float64Array(M.nN);
  for (let i = 0; i < M.nN; i++) { for (let k = 0; k < 6; k++) nodeS[i * 6 + k] /= nodeC[i] || 1; nodeVM[i] = vmOf(nodeS.subarray(i * 6, i * 6 + 6)); }
  // element value = the highest of its corners (so the weakest spot is not averaged away)
  for (let e = 0; e < nE; e++) { let m = 0; for (let c = 0; c < 8; c++) m = Math.max(m, nodeVM[conn[e * 8 + c]]); vm[e] = m; }
  return { u, stress, vm, nodeS, nodeVM, it, res, ms: performance.now() - t0 };
}

// failure index of a 3D-printed element: layers are weaker across (z) than along them
// b: unit build direction (world). Returns {fi, mode}
export function printFailure(s, b, Sxy, Sz) {
  const [sx, sy, sz, txy, tyz, txz] = s;
  const S = [[sx, txy, txz], [txy, sy, tyz], [txz, tyz, sz]];
  const t = [S[0][0] * b[0] + S[0][1] * b[1] + S[0][2] * b[2], S[1][0] * b[0] + S[1][1] * b[1] + S[1][2] * b[2], S[2][0] * b[0] + S[2][1] * b[1] + S[2][2] * b[2]];
  const sbb = t[0] * b[0] + t[1] * b[1] + t[2] * b[2];
  const tau = Math.hypot(t[0] - sbb * b[0], t[1] - sbb * b[1], t[2] - sbb * b[2]);
  // in-plane basis
  const a = Math.abs(b[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
  const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const v = [b[1] * u[2] - b[2] * u[1], b[2] * u[0] - b[0] * u[2], b[0] * u[1] - b[1] * u[0]];
  const q = (x, y) => { const Sx = [S[0][0] * y[0] + S[0][1] * y[1] + S[0][2] * y[2], S[1][0] * y[0] + S[1][1] * y[1] + S[1][2] * y[2], S[2][0] * y[0] + S[2][1] * y[1] + S[2][2] * y[2]]; return x[0] * Sx[0] + x[1] * Sx[1] + x[2] * Sx[2]; };
  const suu = q(u, u), svv = q(v, v), suv = q(u, v);
  const vmIn = Math.sqrt(Math.max(0, suu * suu - suu * svv + svv * svv + 3 * suv * suv));
  const a1 = vmIn / Sxy, a2 = sbb > 0 ? sbb / Sz : -sbb / Sxy, a3 = tau / (0.8 * Sz);
  const fi = Math.sqrt(a1 * a1 + a2 * a2 + a3 * a3);
  const mode = a2 >= a1 && a2 >= a3 ? (sbb > 0 ? "layers pulling apart" : "crushing across layers") : a3 >= a1 ? "layers sliding (shear)" : "lines of plastic within a layer (strongest direction)";
  return { fi, mode };
}

// ------------------------------------------------------------------ colors
// a perceptual blue → green → yellow → red ramp
export function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0.18, 0.35, 0.85], [0.1, 0.7, 0.85], [0.3, 0.78, 0.35], [0.98, 0.82, 0.2], [0.93, 0.3, 0.2]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
}
