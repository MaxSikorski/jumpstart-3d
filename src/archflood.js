// Architect flood test: rain falls on the landscape (and runs off the roof), soaks into the
// ground depending on what it is, and flows downhill to collect in low places; or a river or the
// sea rises from the edges of the land. It then checks the water against the house's floor and its
// doors. A simple "shallow water on a grid" model: good for seeing where water goes and whether
// the ground slopes away from the house, not a substitute for an engineer. Sizes in mm.
import * as THREE from "three";
import { GROUND } from "./archland.js";

// how fast each ground soaks up water (mm per hour), roughly, while it isn't soaked yet
const SOAK = { grass: 13, lawn: 13, dirt: 8, sand: 30, gravel: 25, rock: 1, mulch: 20, flowers: 15, snow: 3, paving: 0, beach: 30, redsand: 25, dune: 30, riverstone: 20, stonepath: 3, slate: 1, moss: 10, meadow: 15, dryGrass: 8, clay: 2, mud: 1, brickpath: 2 };
const SOAK_MAX = 60; // after this much has soaked in, the ground takes water much more slowly

// L: the landscape (x0, y0, res, nx, ny); arr: its heights, water levels, grounds;
// house: { mask: Uint8Array (1 = under the house), floor: floor height, doors: [{name, x, y}] }
export function makeFlood(L, arr, house) {
  const { nx, ny } = L, n = nx * ny, H = arr.h;
  const d = new Float32Array(n), soaked = new Float32Array(n), soak = new Float32Array(n), peak = new Float32Array(n);
  const block = house.mask;
  for (let i = 0; i < n; i++) {
    soak[i] = SOAK[(GROUND[arr.m[i]] || GROUND[0]).id] ?? 10;
    if (!isNaN(arr.w[i]) && !block[i]) d[i] = Math.max(0, arr.w[i] - H[i]); // ponds start full
  }
  const base = d.slice();
  // the cells around the house, where the roof's water lands (gutters and downpipes) and where
  // water would get in
  const ring = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i; if (block[q]) continue;
    if ((i > 0 && block[q - 1]) || (i < nx - 1 && block[q + 1]) || (j > 0 && block[q - nx]) || (j < ny - 1 && block[q + nx])) ring.push(q);
  }
  let roofCells = 0; for (let i = 0; i < n; i++) if (block[i]) roofCells++;
  const cellOf = (x, y) => { const i = Math.round((x - L.x0) / L.res), j = Math.round((y - L.y0) / L.res); return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1; };
  const doorCells = house.doors.map((dr) => ({ ...dr, q: cellOf(dr.x, dr.y) })).filter((dr) => dr.q >= 0 && !block[dr.q]);
  const out = new Float32Array(n);
  const sim = { d, peak, t: 0, rained: 0, drained: 0, ring, doorCells, mode: null };
  // one step of dt seconds: rain (mm per hour) falls, soaks in, flows; the edges drain away
  function step(dt, rain) {
    const r = (rain * dt) / 3600;
    if (r > 0) {
      for (let i = 0; i < n; i++) if (!block[i]) d[i] += r;
      if (ring.length && roofCells) { const share = (r * roofCells) / ring.length; for (const q of ring) d[q] += share; }
      sim.rained += r;
    }
    for (let i = 0; i < n; i++) {
      if (!d[i] || block[i]) continue;
      const rate = soaked[i] < SOAK_MAX ? soak[i] : soak[i] * 0.15, s = Math.min(d[i], (rate * dt) / 3600);
      d[i] -= s; soaked[i] += s;
    }
    // flow: water moves toward lower water surfaces, a share of the difference each time
    for (let it = 0; it < 6; it++) {
      out.fill(0);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const q = j * nx + i, w = d[q];
        if (w <= 0.01 || block[q]) continue;
        const h = H[q] + w;
        let tot = 0; const f = [0, 0, 0, 0], nb = [i > 0 ? q - 1 : -1, i < nx - 1 ? q + 1 : -1, j > 0 ? q - nx : -1, j < ny - 1 ? q + nx : -1];
        for (let k = 0; k < 4; k++) {
          const o = nb[k];
          if (o < 0) { f[k] = Math.min(w, Math.max(0, w * 0.5)); tot += f[k]; continue; } // over the edge
          if (block[o]) continue;
          const dh = h - (H[o] + d[o]);
          if (dh > 0) { f[k] = dh * 0.22; tot += f[k]; }
        }
        if (!tot) continue;
        const sc = tot > w ? w / tot : 1;
        for (let k = 0; k < 4; k++) { if (!f[k]) continue; const m = f[k] * sc, o = nb[k]; out[q] -= m; if (o >= 0) out[o] += m; else sim.drained += m; }
      }
      for (let i = 0; i < n; i++) d[i] = Math.max(0, d[i] + out[i]);
    }
    for (let i = 0; i < n; i++) if (d[i] > peak[i]) peak[i] = d[i];
    sim.t += dt;
  }
  // rising water: the sea or a river comes in from the edges up to `level` (only where it can reach)
  function rise(level) {
    const seen = new Uint8Array(n), stack = [];
    for (let i = 0; i < nx; i++) stack.push(i, (ny - 1) * nx + i);
    for (let j = 0; j < ny; j++) stack.push(j * nx, j * nx + nx - 1);
    d.set(base);
    while (stack.length) {
      const q = stack.pop();
      if (seen[q] || block[q] || H[q] >= level) continue;
      seen[q] = 1; d[q] = Math.max(d[q], level - H[q]);
      const i = q % nx, j = (q / nx) | 0;
      if (i > 0) stack.push(q - 1); if (i < nx - 1) stack.push(q + 1); if (j > 0) stack.push(q - nx); if (j < ny - 1) stack.push(q + nx);
    }
    for (let i = 0; i < n; i++) if (d[i] > peak[i]) peak[i] = d[i];
  }
  function reset() { d.set(base); peak.set(base); soaked.fill(0); sim.t = sim.rained = sim.drained = 0; }
  // how the house is doing: the highest water against it (now, or at its worst), and each door
  function report(usePeak = true) {
    const W = usePeak ? peak : d;
    let worst = -Infinity, at = -1;
    for (const q of ring) { if (W[q] < 3) continue; const top = H[q] + W[q]; if (top > worst) { worst = top; at = q; } }
    const doors = doorCells.map((dr) => { const w = W[dr.q]; const top = H[dr.q] + w; return { ...dr, depth: w, over: w >= 3 ? top - house.floor : -Infinity }; });
    let maxDepth = 0; for (const q of ring) maxDepth = Math.max(maxDepth, W[q]);
    let wetCells = 0; for (let i = 0; i < n; i++) if (W[i] >= 3) wetCells++;
    return { over: at >= 0 ? worst - house.floor : -Infinity, at: at >= 0 ? [L.x0 + (at % nx) * L.res, L.y0 + ((at / nx) | 0) * L.res] : null, maxDepth, doors, wetArea: wetCells * L.res * L.res, flooded: at >= 0 && worst > house.floor };
  }
  return Object.assign(sim, { step, rise, reset, report });
}

// the water of a flood test as a surface: one square per wet cell, deeper water darker
export function floodMesh(L, arr, d, old) {
  const { nx, ny, x0, y0, res } = L, H = arr.h;
  const pos = [], col = [], c = new THREE.Color(), shallow = new THREE.Color("#7cc4f0"), deep = new THREE.Color("#1d5fa8");
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i, w = d[q];
    if (w < 3) continue;
    const z = H[q] + w, x = x0 + i * res, y = y0 + j * res, h2 = res / 2;
    c.copy(shallow).lerp(deep, Math.min(1, w / 600));
    for (const [px, py] of [[x - h2, y - h2], [x + h2, y - h2], [x + h2, y + h2], [x - h2, y - h2], [x + h2, y + h2], [x - h2, y + h2]]) { pos.push(px, py, z); col.push(c.r, c.g, c.b); }
  }
  let m = old;
  if (!m) { m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.78, roughness: 0.2, depthWrite: false })); m.renderOrder = 4; }
  m.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  m.geometry = g; m.visible = pos.length > 0;
  return m;
}
