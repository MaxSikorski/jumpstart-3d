// Which faces lean out too far to print without support under them (our addition).
// Shared by the design view's overhang shading (printerpreview.js) and the 3D Print Sim (printsim.js), so both
// use one rule. Pure maths on typed arrays: no browser, no three.js, so Node can test it.
//
// The rule. The printer builds along world +Z. The limit is "how far a surface may lean outward from upright",
// 10 to 80 degrees. For the outward unit normal n of a triangle in world space, the triangle is a steep underside
// when  -n.z > sin(limit) + EPS.  Upright walls (n.z = 0) and upward faces are clear; a suspended horizontal
// underside (n.z = -1) is flagged at every limit. A face exactly at the limit is clear (EPS absorbs float noise).
// (The sim used cos(limit) before, which agrees with this only at 45 degrees.)
export const EPS = 1e-4;
export const BED_TOUCH = 0.05; // mm: a triangle whose three corners are all this close to the plate is resting on it
export const limitOf = (deg) => Math.sin((deg * Math.PI) / 180);
export const leansOut = (nz, deg) => -nz > limitOf(deg) + EPS;

// Local flat-face normals (cross products, not unit, not averaged) per triangle list, filled as a job reaches
// each triangle and kept until the mesh arrays are dropped. Keyed by the index array of the mesh.
const normalCache = new WeakMap();
function normalsFor(positions, indices) {
  let e = normalCache.get(indices);
  if (!e || e.positions !== positions) { e = { positions, n: new Float32Array(indices.length), filled: 0 }; normalCache.set(indices, e); }
  return e;
}

// 3x3 inverse of the linear part of a column-major 4x4. Returns null when the matrix flattens the shape.
function inverse3(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]; // rows of M
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12)) return null;
  const k = 1 / det;
  return {
    det,
    // B[r][c], row-major: the inverse of [[a b c][d e f][g h i]]
    b: [A * k, (c * h - b * i) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, (c * d - a * f) * k, C * k, (b * g - a * h) * k, (a * e - b * d) * k],
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// A resumable classification of every triangle of one mesh.
//   positions  Float32Array xyz of the vertices (the mesh's own, in its local space)
//   indices    Uint32Array, three per triangle
//   m          the 16 numbers (column-major) that put the mesh in the world: body pose, any displayed stretch
//   deg        the lean limit
// step(ms) works for about `ms` milliseconds and returns true when finished. result() lists the flagged triangles.
// The world normal of a flat face is  B^T n  (B = inverse of the linear part), so a nonuniform scale, a mirror or a
// turned body all give the true outward direction; the sign of the determinant does not matter.
export function startJob(positions, indices, m = IDENTITY, deg = 45) {
  const nT = (indices.length / 3) | 0;
  const cache = normalsFor(positions, indices);
  const inv = inverse3(m);
  const hits = [];
  let t = inv ? 0 : nT, area = 0;
  const limit = limitOf(deg) + EPS;
  const m2 = m[2], m6 = m[6], m10 = m[10], m14 = m[14];
  const B = inv ? inv.b : null, absDet = inv ? Math.abs(inv.det) : 0;
  const job = {
    total: nT,
    get processed() { return Math.min(t, nT); },
    get done() { return t >= nT; },
    step(ms = 8) {
      const deadline = nowMs() + ms;
      while (t < nT) {
        const stop = Math.min(nT, t + 2048);
        for (; t < stop; t++) {
          const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
          if (t >= cache.filled) {
            const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
            const ux = positions[i1] - ax, uy = positions[i1 + 1] - ay, uz = positions[i1 + 2] - az;
            const vx = positions[i2] - ax, vy = positions[i2 + 1] - ay, vz = positions[i2 + 2] - az;
            cache.n[t * 3] = uy * vz - uz * vy; cache.n[t * 3 + 1] = uz * vx - ux * vz; cache.n[t * 3 + 2] = ux * vy - uy * vx;
            cache.filled = t + 1;
          }
          const nx = cache.n[t * 3], ny = cache.n[t * 3 + 1], nz = cache.n[t * 3 + 2];
          if (nx * nx + ny * ny + nz * nz < 1e-24) continue; // a sliver with no direction
          // world normal = B^T n
          const wx = B[0] * nx + B[3] * ny + B[6] * nz, wy = B[1] * nx + B[4] * ny + B[7] * nz, wz = B[2] * nx + B[5] * ny + B[8] * nz;
          const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
          if (!(len > 1e-12)) continue;
          if (!(-wz / len > limit)) continue;
          // all three corners on the plate: it rests on the bed
          const z0 = m2 * positions[i0] + m6 * positions[i0 + 1] + m10 * positions[i0 + 2] + m14;
          const z1 = m2 * positions[i1] + m6 * positions[i1 + 1] + m10 * positions[i1 + 2] + m14;
          const z2 = m2 * positions[i2] + m6 * positions[i2 + 1] + m10 * positions[i2 + 2] + m14;
          if (Math.abs(z0) <= BED_TOUCH && Math.abs(z1) <= BED_TOUCH && Math.abs(z2) <= BED_TOUCH) continue;
          hits.push(t);
          area += 0.5 * absDet * len; // |det| * |B^T n_local| / 2 is the triangle's area in the world
        }
        if (t < nT && nowMs() >= deadline) return false;
      }
      return true;
    },
    // flagged triangles (their numbers), the vertex indices to draw them, and their total area in mm²
    result() {
      const tris = Uint32Array.from(hits), index = new Uint32Array(hits.length * 3);
      for (let k = 0; k < hits.length; k++) { index[k * 3] = indices[hits[k] * 3]; index[k * 3 + 1] = indices[hits[k] * 3 + 1]; index[k * 3 + 2] = indices[hits[k] * 3 + 2]; }
      return { tris, index, area, count: hits.length };
    },
  };
  return job;
}

// the whole mesh at once (tests, small meshes)
export function classify(positions, indices, m, deg) {
  const j = startJob(positions, indices, m, deg);
  while (!j.step(1e9));
  return j.result();
}
