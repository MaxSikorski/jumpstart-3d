// Print-time model for the 3D Print Sim and its G-code, worked out the way Orca Slicer's
// G-code processor estimates time: every move is a block with a cruise speed and an
// acceleration, the speed at each corner comes from the printer's jerk limits (Marlin-style
// firmware: Bambu Lab, Prusa, Ender) or its square corner velocity (Klipper: junction
// deviation), and the blocks are planned backwards and forwards so the head slows down only as
// much as it must before a corner. Speeds and accelerations are the printers' standard 0.20 mm
// process profiles for a 0.4 mm nozzle (Orca Slicer's bundled profiles).

// v: feature speeds (mm/s); first: first-layer speeds for walls and infill; acc: accelerations
// (mm/s²) for each feature; mach: machine limits (acc, travel acc, xy speed, z speed, e speed,
// retract acc); jerk: Marlin per-axis jerk (mm/s); scv: Klipper square corner velocity (mm/s)
const P = (o) => o;
export const MOTION = {
  bambu: P({ name: "Bambu Lab 0.20mm Standard", v: { outer: 200, inner: 300, sparse: 270, solid: 250, top: 200, bottom: 250, bridge: 50, support: 150, skirt: 50, brim: 50 }, first: { wall: 50, infill: 105 }, travel: 500,
    acc: { def: 10000, outer: 5000, top: 2000, first: 500, travel: 10000 }, mach: { acc: 20000, travel: 9000, v: 500, z: 20, e: 30, retract: 5000 }, jerk: { x: 9, y: 9, z: 3, e: 2.5 } }),
  k1: P({ name: "Creality K1 0.20mm Standard", v: { outer: 200, inner: 250, sparse: 270, solid: 250, top: 200, bottom: 250, bridge: 25, support: 150, skirt: 50, brim: 50 }, first: { wall: 60, infill: 60 }, travel: 500,
    acc: { def: 10000, outer: 3000, inner: 3000, top: 2000, bridge: 5000, first: 1000, travel: 10000 }, mach: { acc: 20000, travel: 20000, v: 800, z: 20, e: 30, retract: 5000 }, scv: 9 }),
  k2: P({ name: "Creality K2 0.20mm Standard", v: { outer: 200, inner: 300, sparse: 270, solid: 250, top: 200, bottom: 250, bridge: 50, support: 150, skirt: 50, brim: 50 }, first: { wall: 60, infill: 105 }, travel: 500,
    acc: { def: 12000, outer: 5000, inner: 5000, top: 5000, bridge: 6000, first: 2000, travel: 12000 }, mach: { acc: 30000, travel: 30000, v: 800, z: 20, e: 30, retract: 5000 }, scv: 9 }),
  elegoo: P({ name: "Elegoo CC 0.20mm Standard", v: { outer: 160, inner: 200, sparse: 200, solid: 250, top: 200, bottom: 250, bridge: 50, support: 150, skirt: 50, brim: 50 }, first: { wall: 50, infill: 105 }, travel: 500,
    acc: { def: 10000, outer: 5000, top: 2000, first: 500, travel: 10000 }, mach: { acc: 20000, travel: 20000, v: 500, z: 20, e: 30, retract: 5000 }, scv: 9 }),
  flashforge: P({ name: "Flashforge 0.20mm Standard", v: { outer: 200, inner: 300, sparse: 270, solid: 250, top: 200, bottom: 250, bridge: 50, support: 150, skirt: 50, brim: 50 }, first: { wall: 50, infill: 80 }, travel: 500,
    acc: { def: 10000, outer: 5000, inner: 5000, solid: 7000, top: 2000, first: 500, travel: 10000 }, mach: { acc: 20000, travel: 20000, v: 600, z: 20, e: 30, retract: 5000 }, scv: 9 }),
  u1: P({ name: "Snapmaker U1 0.20mm Standard", v: { outer: 200, inner: 300, sparse: 270, solid: 250, top: 200, bottom: 250, bridge: 50, support: 150, skirt: 50, brim: 50 }, first: { wall: 50, infill: 105 }, travel: 500,
    acc: { def: 10000, outer: 5000, top: 2000, first: 500, travel: 10000 }, mach: { acc: 20000, travel: 20000, v: 500, z: 20, e: 30, retract: 5000 }, scv: 9 }),
  voron: P({ name: "Voron 0.20mm Standard", v: { outer: 120, inner: 200, sparse: 200, solid: 200, top: 100, bottom: 200, bridge: 25, support: 150, skirt: 50, brim: 50 }, first: { wall: 50, infill: 105 }, travel: 350,
    acc: { def: 5000, outer: 3000, inner: 5000, top: 3000, first: 500, travel: 7000 }, mach: { acc: 10000, travel: 10000, v: 500, z: 15, e: 30, retract: 5000 }, scv: 5 }),
  core: P({ name: "Prusa CORE One 0.20mm SPEED", v: { outer: 170, inner: 170, sparse: 200, solid: 200, top: 100, bottom: 200, bridge: 25, support: 120, skirt: 50, brim: 50 }, first: { wall: 45, infill: 100 }, travel: 350,
    acc: { def: 3000, outer: 3000, inner: 6000, sparse: 7000, solid: 6000, top: 2000, bridge: 1500, first: 800, travel: 7000 }, mach: { acc: 8000, travel: 8000, v: 400, z: 12, e: 100, retract: 1250 }, jerk: { x: 8, y: 8, z: 2, e: 10 } }),
  mk4: P({ name: "Prusa MK4S 0.20mm SPEED", v: { outer: 170, inner: 170, sparse: 200, solid: 200, top: 100, bottom: 200, bridge: 25, support: 120, skirt: 50, brim: 50 }, first: { wall: 30, infill: 60 }, travel: 300,
    acc: { def: 4000, top: 1500, bridge: 1500, first: 800, travel: 4000 }, mach: { acc: 4000, travel: 5000, v: 300, z: 12, e: 100, retract: 1250 }, jerk: { x: 8, y: 8, z: 2, e: 10 } }),
  mini: P({ name: "Prusa MINI 0.20mm", v: { outer: 200, inner: 250, sparse: 250, solid: 250, top: 100, bottom: 250, bridge: 40, support: 110, skirt: 50, brim: 50 }, first: { wall: 40, infill: 100 }, travel: 300,
    acc: { def: 4000, solid: 3000, top: 2000, bridge: 1500, first: 500, travel: 4000 }, mach: { acc: 4000, travel: 4000, v: 300, z: 12, e: 80, retract: 1250 }, jerk: { x: 8, y: 8, z: 2, e: 10 } }),
  ender3: P({ name: "Creality Ender-3 0.20mm Standard", v: { outer: 40, inner: 40, sparse: 60, solid: 50, top: 30, bottom: 50, bridge: 25, support: 40, skirt: 40, brim: 30 }, first: { wall: 14, infill: 21 }, travel: 150,
    acc: { def: 500, first: 500, travel: 500 }, mach: { acc: 500, travel: 1500, v: 500, z: 10, e: 60, retract: 1000 }, jerk: { x: 8, y: 8, z: 0.4, e: 5 } }),
};
const BY_PRINTER = {
  a1mini: "bambu", a1: "bambu", a2l: "bambu", p1s: "bambu", p2s: "bambu", x1: "bambu", x2d: "bambu", h2s: "bambu", h2d: "bambu", h2c: "bambu",
  ender3: "ender3", k1: "k1", k1max: "k1", k2se: "k2", k2: "k2", k2pro: "k2", k2plus: "k2", cc: "elegoo", cc2: "elegoo",
  ff5m: "flashforge", ffad5x: "flashforge", creator5: "flashforge", creator5pro: "flashforge",
  mini: "mini", mk4: "mk4", xl1: "mk4", xl2: "mk4", xl5: "mk4", core1: "core", core1l: "core", core1lindx4: "core", core1lindx8: "core", u1: "u1", voron: "voron",
};
export function motionFor(printerKey, printer) {
  const k = BY_PRINTER[printerKey] || (printer && printer.brand === "Bambu Lab" ? "bambu" : printer && printer.brand === "Prusa" ? "mk4" : "k1");
  return { key: k, ...MOTION[k] };
}
// slow down for layer cooling (Orca's filament settings): a layer that would print faster than
// this many seconds is slowed down, but not below the minimum speed
export const COOLING = { pla: [4, 20], plaplus: [4, 20], cfpla: [4, 20], petg: [8, 10], abs: [3, 20], asa: [3, 20], nylon: [8, 10], cfnylon: [8, 10], pc: [8, 10], peek: [8, 10], tpu: [8, 10] };
// Bambu Lab's speed modes (percent of the standard speeds)
export const SPEED_PRESETS = [["silent", "Silent", 0.5], ["standard", "Standard", 1], ["sport", "Sport", 1.24], ["ludicrous", "Ludicrous", 1.66]];

// the speed (mm/s) and acceleration of a feature on layer k
export function featureMotion(prof, kind, k, mult = 1) {
  const v0 = k === 0 ? (kind === "outer" || kind === "inner" || kind === "skirt" || kind === "brim" ? prof.first.wall : kind === "bridge" ? Math.min(prof.v.bridge, prof.first.infill) : prof.first.infill) : prof.v[kind] || prof.v.inner;
  const a0 = k === 0 ? prof.acc.first : prof.acc[kind] || prof.acc.def;
  const m = k === 0 ? 1 : mult;
  return [v0 * m, Math.min(prof.mach.acc, a0 * Math.min(1, m))];
}

// ---------------------------------------------------------------- the planner
// A move list: x, y, z, e (absolute mm, e = filament used so far), feed (mm/s), acc (mm/s²),
// travel flag. timeMoves(list, from, to, prof) returns the seconds each move takes, starting
// and ending at rest (a layer change or a tool change stops the head anyway).
export class Moves {
  constructor(n = 1 << 14) { this.n = 0; this._grow(n); }
  _grow(n) {
    const old = this.d, d = new Float64Array(n * 7);
    if (old) d.set(old.subarray(0, this.n * 7));
    this.d = d; this.cap = n;
  }
  push(x, y, z, e, f, a, travel) {
    if (this.n >= this.cap) this._grow(this.cap * 2);
    const o = this.n++ * 7, d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = e; d[o + 4] = f; d[o + 5] = a; d[o + 6] = travel ? 1 : 0;
    return this.n - 1;
  }
}
// seconds for moves [i0, i1) of M (each from the end of the move before it; the move at i0 - 1
// gives the start position)
export function timeMoves(M, i0, i1, prof, out) {
  const d = M.d, n = i1 - i0;
  if (n <= 0) return 0;
  const J = prof.jerk, klipper = !J, mach = prof.mach;
  const dist = new Float64Array(n), cruise = new Float64Array(n), acc = new Float64Array(n), entry = new Float64Array(n), maxEntry = new Float64Array(n), safe = new Float64Array(n), nominal = new Uint8Array(n);
  // directions (x, y, z, e per mm of the move)
  const ux = new Float64Array(n), uy = new Float64Array(n), uz = new Float64Array(n), ue = new Float64Array(n);
  let pv = 0, pj = -1; // previous move's speed and index (in this run)
  const jd = klipper ? (a) => (prof.scv * prof.scv * (Math.SQRT2 - 1)) / a : null;
  for (let j = 0; j < n; j++) {
    const o = (i0 + j) * 7, p = o - 7;
    const dx = p >= 0 ? d[o] - d[p] : 0, dy = p >= 0 ? d[o + 1] - d[p + 1] : 0, dz = p >= 0 ? d[o + 2] - d[p + 2] : 0, de = p >= 0 ? d[o + 3] - d[p + 3] : 0;
    const xyz = Math.hypot(dx, dy, dz), eOnly = xyz < 1e-7;
    const L = eOnly ? Math.abs(de) : xyz;
    if (L < 1e-7) { dist[j] = 0; continue; }
    dist[j] = L;
    ux[j] = dx / L; uy[j] = dy / L; uz[j] = dz / L; ue[j] = de / L;
    let v = d[o + 4];
    // axis speed limits
    if (Math.abs(ux[j]) * v > mach.v) v = mach.v / Math.abs(ux[j]);
    if (Math.abs(uy[j]) * v > mach.v) v = mach.v / Math.abs(uy[j]);
    if (Math.abs(uz[j]) * v > mach.z) v = mach.z / Math.abs(uz[j]);
    if ((eOnly || de < 0) && Math.abs(ue[j]) * v > mach.e) v = mach.e / Math.abs(ue[j]);
    let a = eOnly ? mach.retract : Math.min(d[o + 5], d[o + 6] ? mach.travel : mach.acc);
    if (Math.abs(uz[j]) > 1e-6) a = Math.min(a, 500 / Math.abs(uz[j]));
    // Bambu / Marlin: limit the speed through gentle bends by the centripetal acceleration
    const has = pj >= 0 && pv > 1e-4;
    if (!klipper && has && !eOnly && (ux[pj] || uy[pj]) && (ux[j] || uy[j])) {
      const l1 = Math.hypot(ux[pj], uy[pj]), l2 = Math.hypot(ux[j], uy[j]);
      const ax = ux[pj] / l1, ay = uy[pj] / l1, bx = ux[j] / l2, by = uy[j] / l2, nd = Math.hypot(bx - ax, by - ay);
      if (nd < 0.5 && nd > 1e-5) { const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by), s2 = Math.sqrt((1 - Math.cos(ang)) * 0.5), r = (Math.hypot(dx, dy) * 0.5) / s2; v = Math.min(v, Math.sqrt(a * r)); }
    }
    cruise[j] = v; acc[j] = a;
    let vj;
    if (klipper) {
      safe[j] = 0;
      if (!has || eOnly || (!ux[pj] && !uy[pj] && !uz[pj])) vj = 0;
      else {
        let lim = Math.min(v * v, pv * pv);
        const der = Math.abs(ue[j] - ue[pj]); if (der > 0) lim = Math.min(lim, (1 / der) ** 2);
        const cos = Math.max(-1, Math.min(1, -(ux[pj] * ux[j] + uy[pj] * uy[j] + uz[pj] * uz[j]) / (Math.hypot(ux[pj], uy[pj], uz[pj]) * Math.hypot(ux[j], uy[j], uz[j]) || 1)));
        const sh = Math.sqrt(0.5 * (1 - cos)), ch = Math.sqrt(0.5 * (1 + cos));
        if (sh < 1 && ch > 0) { const r = sh / (1 - sh), ht = (0.5 * sh) / ch; lim = Math.min(lim, r * jd(a) * a, r * jd(acc[pj]) * acc[pj], ht * L * a, ht * dist[pj] * acc[pj]); }
        vj = Math.sqrt(lim);
      }
      // Klipper can't enter faster than it could have accelerated over the previous move
      if (has) vj = Math.min(vj, Math.sqrt(maxEntry[pj] ** 2 + 2 * dist[pj] * acc[pj]));
    } else {
      // Marlin classic jerk
      let sf = v;
      if (Math.abs(ux[j]) * v > J.x) sf = Math.min(sf, J.x);
      if (Math.abs(uy[j]) * v > J.y) sf = Math.min(sf, J.y);
      if (Math.abs(uz[j]) * v > J.z) sf = Math.min(sf, J.z);
      if (Math.abs(ue[j]) * v > J.e) sf = Math.min(sf, J.e);
      safe[j] = sf; vj = sf;
      if (has) {
        const larger = pv > v, f = larger ? v / pv : pv / v;
        vj = larger ? v : pv;
        let vf = 1, limited = false;
        const ex = [ux[pj] * pv * (larger ? f : 1), uy[pj] * pv * (larger ? f : 1), uz[pj] * pv * (larger ? f : 1)], en = [ux[j] * v, uy[j] * v, uz[j] * v], JJ = [J.x, J.y, J.z];
        let jv = [Math.abs(en[0] - ex[0]), Math.abs(en[1] - ex[1]), Math.abs(en[2] - ex[2])];
        for (let i = 0; i < 3; i++) if (jv[i] > JJ[i]) { vf *= JJ[i] / jv[i]; jv = jv.map((q) => q * vf); limited = true; }
        let vex = ue[pj] * pv * (larger ? f : 1), ven = ue[j] * v;
        if (limited) { vex *= vf; ven *= vf; }
        const jk = vex > ven ? (ven > 0 || vex < 0 ? vex - ven : Math.max(vex, -ven)) : ven < 0 || vex > 0 ? ven - vex : Math.max(-vex, ven);
        if (jk > J.e) { vf *= J.e / jk; limited = true; }
        if (limited) vj *= vf;
        const thr = vj * 0.99;
        if (safe[pj] > thr && sf > thr) vj = sf;
      }
    }
    const vAllow = Math.sqrt(safe[j] * safe[j] + 2 * a * L);
    entry[j] = Math.min(vj, vAllow); maxEntry[j] = vj; nominal[j] = v <= vAllow ? 1 : 0;
    pv = v; pj = j;
  }
  // the moves that move (zero-length ones are skipped)
  const idx = []; for (let j = 0; j < n; j++) if (dist[j] > 0) idx.push(j);
  // reverse pass, then forward pass (Marlin's planner)
  for (let q = idx.length - 1; q > 0; q--) {
    const c = idx[q - 1], nx = idx[q];
    const ne = nominal[c] ? maxEntry[c] : Math.min(maxEntry[c], Math.sqrt(entry[nx] * entry[nx] + 2 * acc[c] * dist[c]));
    entry[c] = ne;
  }
  for (let q = 0; q + 1 < idx.length; q++) {
    const c = idx[q], nx = idx[q + 1];
    if (!nominal[c] && entry[c] < entry[nx]) { const ne = Math.sqrt(entry[c] * entry[c] + 2 * acc[c] * dist[c]); if (ne < entry[nx]) entry[nx] = ne; }
  }
  // the trapezoids
  let total = 0;
  for (let q = 0; q < idx.length; q++) {
    const c = idx[q], ve = entry[c], vx = q + 1 < idx.length ? entry[idx[q + 1]] : safe[c], a = acc[c], L = dist[c];
    let vc = cruise[c];
    let da = Math.max(0, (vc * vc - ve * ve) / (2 * a)), dd = Math.max(0, (vc * vc - vx * vx) / (2 * a)), dc = L - da - dd;
    if (dc < 0) { da = Math.max(0, Math.min(L, (2 * a * L - ve * ve + vx * vx) / (4 * a))); dc = 0; vc = Math.sqrt(Math.max(0, ve * ve + 2 * a * da)); dd = L - da; }
    const tt = (vc > ve ? (vc - ve) / a : 0) + (vc > 0 ? dc / vc : 0) + (vc > vx ? (vc - vx) / a : dd / Math.max(1e-6, vc));
    total += tt;
    if (out) out[c] = tt;
  }
  return total;
}
