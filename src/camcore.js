// CAM engine for JumpStart 3D (MIT). Plain JavaScript, no DOM, so it can be tested on its own.
// It uses openly published methods rather than anyone's code:
//  - toolpaths by "drop-cutter" on a height map (the method behind the open-source OpenCAMLib):
//    the tool is lowered onto the model at each point until it touches;
//  - a height-field (dexel) material-removal simulation, as in the open-source CAMotics;
//  - G-code in the dialects of the open-source machine controllers GRBL, LinuxCNC and Marlin
//    (and Mach3, which reads the same RS-274 / NIST G-code standard).
// All sizes are millimetres, Z up, in the design's own coordinates.

export const EMPTY = -1e9;
const IN = 25.4;

// ------------------------------------------------------------------ libraries
export const POSTS = {
  grbl: { name: "GRBL", ext: "nc", note: "Most hobby CNC routers (3018, Shapeoko-style, X-Carve-style) and diode laser engravers", stream: true },
  linuxcnc: { name: "LinuxCNC", ext: "ngc", note: "LinuxCNC-controlled mills and routers (load the file)", stream: false },
  mach3: { name: "Mach3 / Mach4", ext: "tap", note: "Mach-controlled routers and mills (load the file)", stream: false },
  marlin: { name: "Marlin", ext: "gcode", note: "Marlin-based CNC conversions and MPCNC-style machines", stream: true },
  grblhal: { name: "grblHAL / FluidNC", ext: "nc", note: "GRBL-style controllers with a 4th (A) axis: grblHAL, FluidNC", stream: true, axes4: true },
};
export const MACHINES = [
  { id: "m3018", name: "Desktop CNC 3018 (GRBL)", kind: "mill", x: 300, y: 180, z: 45, rpmMin: 1000, rpmMax: 10000, feedMax: 1000, rapid: 1500, post: "grbl", units: "mm" },
  { id: "mhobby", name: "Hobby router 400×400 (GRBL)", kind: "mill", x: 400, y: 400, z: 75, rpmMin: 8000, rpmMax: 24000, feedMax: 3000, rapid: 5000, post: "grbl", units: "mm" },
  { id: "mbig", name: "Shop router 800×800 (GRBL)", kind: "mill", x: 800, y: 800, z: 100, rpmMin: 10000, rpmMax: 30000, feedMax: 5000, rapid: 8000, post: "grbl", units: "mm" },
  { id: "msheet", name: "Full-sheet router 4'×8' (LinuxCNC)", kind: "mill", x: 1250, y: 2500, z: 150, rpmMin: 6000, rpmMax: 24000, feedMax: 10000, rapid: 15000, post: "linuxcnc", units: "in" },
  { id: "mmill", name: "Benchtop mill (LinuxCNC)", kind: "mill", x: 300, y: 150, z: 250, rpmMin: 100, rpmMax: 5000, feedMax: 1500, rapid: 2500, post: "linuxcnc", units: "mm", toolChange: true },
  { id: "mmach", name: "Router with Mach3 (in)", kind: "mill", x: 610, y: 610, z: 120, rpmMin: 8000, rpmMax: 24000, feedMax: 5000, rapid: 7000, post: "mach3", units: "in" },
  { id: "mmpcnc", name: "Marlin CNC (MPCNC-style)", kind: "mill", x: 600, y: 600, z: 80, rpmMin: 10000, rpmMax: 30000, feedMax: 2400, rapid: 3000, post: "marlin", units: "mm" },
  // with a rotary 4th axis (A, turning around X): the stock is held between a chuck and a tailstock
  { id: "m3018r", name: "Desktop CNC 3018 + rotary axis (grblHAL)", kind: "mill", x: 300, y: 180, z: 45, rpmMin: 1000, rpmMax: 10000, feedMax: 1000, rapid: 1500, post: "grblhal", units: "mm", rotary: { maxD: 60, maxL: 250 } },
  { id: "mhobbyr", name: "Hobby router + 4th axis (FluidNC)", kind: "mill", x: 400, y: 400, z: 75, rpmMin: 8000, rpmMax: 24000, feedMax: 3000, rapid: 5000, post: "grblhal", units: "mm", rotary: { maxD: 100, maxL: 350 } },
  { id: "mmill4", name: "Mill with 4th axis (LinuxCNC)", kind: "mill", x: 300, y: 150, z: 250, rpmMin: 100, rpmMax: 5000, feedMax: 1500, rapid: 2500, post: "linuxcnc", units: "mm", toolChange: true, rotary: { maxD: 150, maxL: 300 } },
  { id: "mmach4", name: "Router with 4th axis (Mach3, in)", kind: "mill", x: 610, y: 610, z: 120, rpmMin: 8000, rpmMax: 24000, feedMax: 5000, rapid: 7000, post: "mach3", units: "in", rotary: { maxD: 150, maxL: 500 } },
  { id: "laser", name: "Laser engraver 400×400 (GRBL)", kind: "laser", x: 400, y: 400, z: 50, rpmMin: 0, rpmMax: 1000, feedMax: 6000, rapid: 8000, post: "grbl", units: "mm" },
];
// chip load per tooth for a 1 mm cutter, growing with diameter (k × d, capped), surface speed in m/min,
// how deep a pass may go (× diameter), and how hard the material is to cut
export const MATERIALS = [
  { id: "pine", name: "Softwood (pine)", k: 0.035, vc: 600, sd: 0.6, laser: { cut: 0.9, engrave: 0.35 } },
  { id: "oak", name: "Hardwood (oak, maple)", k: 0.028, vc: 550, sd: 0.4, laser: { cut: 1, engrave: 0.45 } },
  { id: "ply", name: "Plywood", k: 0.03, vc: 550, sd: 0.5, laser: { cut: 1, engrave: 0.4 } },
  { id: "mdf", name: "MDF", k: 0.035, vc: 600, sd: 0.6, laser: { cut: 1, engrave: 0.4 } },
  { id: "acrylic", name: "Acrylic", k: 0.02, vc: 350, sd: 0.3, laser: { cut: 1, engrave: 0.3 } },
  { id: "hdpe", name: "HDPE plastic", k: 0.035, vc: 400, sd: 0.5, laser: null },
  { id: "foam", name: "Foam / tooling board", k: 0.06, vc: 700, sd: 1.0, laser: { cut: 0.3, engrave: 0.15 } },
  { id: "wax", name: "Machinable wax", k: 0.05, vc: 500, sd: 0.8, laser: null },
  { id: "alu", name: "Aluminium 6061", k: 0.008, vc: 250, sd: 0.15, laser: null },
  { id: "brass", name: "Brass", k: 0.006, vc: 150, sd: 0.15, laser: null },
  { id: "card", name: "Cardboard / paper", k: 0.05, vc: 600, sd: 1.0, laser: { cut: 0.35, engrave: 0.15 } },
];
// tool shapes: flat end mill, ball nose, bull nose (corner radius), V-bit (angle), drill, laser
export const TOOLS = [
  { id: "f3", name: "Flat end mill 3 mm", type: "flat", d: 3, flutes: 2, len: 12 },
  { id: "f6", name: "Flat end mill 6 mm", type: "flat", d: 6, flutes: 2, len: 22 },
  { id: "f18", name: 'Flat end mill 1/8"', type: "flat", d: 3.175, flutes: 2, len: 12.7 },
  { id: "f14", name: 'Flat end mill 1/4"', type: "flat", d: 6.35, flutes: 2, len: 25.4 },
  { id: "f1", name: "Flat end mill 1 mm (detail)", type: "flat", d: 1, flutes: 2, len: 4 },
  { id: "b3", name: "Ball nose 3 mm", type: "ball", d: 3, flutes: 2, len: 12 },
  { id: "b6", name: "Ball nose 6 mm", type: "ball", d: 6, flutes: 2, len: 22 },
  { id: "b18", name: 'Ball nose 1/8"', type: "ball", d: 3.175, flutes: 2, len: 12.7 },
  { id: "bull6", name: "Bull nose 6 mm, r1", type: "bull", d: 6, cr: 1, flutes: 3, len: 20 },
  { id: "v60", name: "V-bit 60°", type: "vee", d: 12.7, angle: 60, tip: 0.2, flutes: 2, len: 11 },
  { id: "v90", name: "V-bit 90°", type: "vee", d: 12.7, angle: 90, tip: 0.2, flutes: 2, len: 6.4 },
  { id: "e30", name: "Engraving bit 30°", type: "vee", d: 3.175, angle: 30, tip: 0.1, flutes: 1, len: 5 },
  { id: "dr3", name: "Drill 3 mm", type: "drill", d: 3, angle: 118, flutes: 2, len: 20 },
  { id: "laser", name: "Laser (0.2 mm beam)", type: "laser", d: 0.2, flutes: 1, len: 0 },
];

// ------------------------------------------------------------------ feeds and speeds
// rpm from the surface speed (limited by the machine), feed = rpm × flutes × chip load,
// plunge a third of that; pass depth and stepover from the material and the tool.
export function feedsSpeeds(tool, mat, mach) {
  if (tool.type === "laser") {
    const lp = mat.laser || { cut: 1, engrave: 0.4 };
    return { rpm: mach.rpmMax, feed: Math.min(mach.feedMax, 600), plunge: 600, stepdown: 1, stepover: 0.1, power: lp.cut, engrave: lp.engrave, engraveFeed: Math.min(mach.feedMax, 3000) };
  }
  const d = tool.d, eff = tool.type === "vee" ? Math.max(0.5, d * 0.25) : d;
  let rpm = (mat.vc * 1000) / (Math.PI * Math.max(0.5, d));
  rpm = Math.round(Math.max(mach.rpmMin || 0, Math.min(mach.rpmMax, rpm)) / 100) * 100;
  const chip = Math.min(mat.k * eff, mat.k * 8);
  let feed = rpm * (tool.flutes || 2) * chip;
  feed = Math.round(Math.max(50, Math.min(mach.feedMax, feed)));
  const plunge = Math.round(Math.max(30, feed / 3));
  const stepdown = +Math.max(0.1, Math.min(tool.len || d * 3, d * mat.sd)).toFixed(2);
  const stepover = tool.type === "ball" ? 0.12 : tool.type === "vee" ? 0.1 : 0.4;
  return { rpm, feed, plunge, stepdown, stepover };
}

// ------------------------------------------------------------------ the model as a height map
// grid of cells (res mm) covering [x0, x1] × [y0, y1]; each cell holds the highest model point above it
export function heightMap(tris, box, res) {
  const nx = Math.max(2, Math.ceil((box.x1 - box.x0) / res) + 1), ny = Math.max(2, Math.ceil((box.y1 - box.y0) / res) + 1);
  const h = new Float32Array(nx * ny).fill(EMPTY);
  const x0 = box.x0, y0 = box.y0;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5], cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / res)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / res));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / res)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / res));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * res;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * res;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
        const z = l1 * az + l2 * bz + l3 * cz, k = j * nx + i;
        if (z > h[k]) h[k] = z;
      }
    }
  }
  return { nx, ny, x0, y0, res, h };
}
// how far above its tip each point of the tool's underside is, at distance r from its axis
export function toolProfile(tool) {
  const R = tool.d / 2;
  if (tool.type === "ball") return (r) => R - Math.sqrt(Math.max(0, R * R - r * r));
  if (tool.type === "bull") { const c = Math.min(tool.cr || 0.5, R); return (r) => (r <= R - c ? 0 : c - Math.sqrt(Math.max(0, c * c - (r - (R - c)) ** 2))); }
  if (tool.type === "vee" || tool.type === "drill") { const t = Math.tan(((tool.angle || 90) * Math.PI) / 360), tip = (tool.tip || 0) / 2; return (r) => (r <= tip ? 0 : (r - tip) / t); }
  return () => 0;
}
export function toolKernel(tool, res) {
  const R = Math.max(res * 0.5, tool.d / 2), n = Math.ceil(R / res), prof = toolProfile(tool);
  const di = [], dj = [], off = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const r = Math.hypot(i, j) * res; if (r <= R + 1e-9) { di.push(i); dj.push(j); off.push(prof(r)); } }
  return { di: Int32Array.from(di), dj: Int32Array.from(dj), off: Float32Array.from(off), n };
}
// the lowest the tool can go at each cell without cutting into the model (drop-cutter)
export function dropMap(hm, kern, floor) {
  const { nx, ny, h } = hm, out = new Float32Array(nx * ny), K = kern.di.length;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let z = floor;
    for (let k = 0; k < K; k++) {
      const ii = i + kern.di[k], jj = j + kern.dj[k];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const v = h[jj * nx + ii];
      if (v === EMPTY) continue;
      const q = v - kern.off[k];
      if (q > z) z = q;
    }
    out[j * nx + i] = z;
  }
  return out;
}

// ------------------------------------------------------------------ path helpers
// drop points that lie on a straight line (within tol), so files stay small
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = -1, mi = -1;
    const A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L2 = dx * dx + dy * dy + dz * dz || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]; let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy + (P[2] - A[2]) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy, P[2] - A[2] - t * dz);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
class Path {
  constructor(job, op) { this.m = []; this.clear = job.clearZ; this.op = op; this.at = null; }
  rapid(x, y, z) { this.m.push({ g: 0, x, y, z }); this.at = [x, y, z]; }
  feed(x, y, z, f, s) { this.m.push({ g: 1, x, y, z, f, ...(s !== undefined ? { s } : {}) }); this.at = [x, y, z]; }
  // go to (x, y) above the work and down to z
  approach(x, y, z, plunge, top) {
    if (!this.at || Math.hypot(this.at[0] - x, this.at[1] - y) > 1e-6) { if (!this.at || this.at[2] < this.clear - 1e-6) this.rapid(this.at ? this.at[0] : x, this.at ? this.at[1] : y, this.clear); this.rapid(x, y, this.clear); }
    const safe = Math.max(z, top + 1);
    if (this.at[2] > safe + 1e-6) this.rapid(x, y, safe);
    if (z < this.at[2] - 1e-6) this.feed(x, y, z, plunge);
  }
  up() { if (this.at && this.at[2] < this.clear - 1e-6) this.rapid(this.at[0], this.at[1], this.clear); }
}
const inStock = (job, x, y) => x >= job.stock.x0 - 1e-6 && x <= job.stock.x1 + 1e-6 && y >= job.stock.y0 - 1e-6 && y <= job.stock.y1 + 1e-6;

// ------------------------------------------------------------------ operations
// Roughing (and facing): flat layers from the top down; at each layer the tool cuts wherever the
// model (plus the stock to leave) is below it, back and forth.
function roughOp(job, op, hm, D, opts = {}) {
  const P = new Path(job, op), { nx, ny, x0, y0, res } = hm, st = job.stock, t = op.tool;
  const leave = opts.face ? 0 : op.leave || 0, sd = Math.max(0.05, op.stepdown), so = Math.max(res, t.d * op.stepover);
  const top = st.zTop, zMin = opts.face ? st.zTop - (op.depth || 1) : job.floor;
  const zs = []; for (let z = top - sd; z > zMin + 1e-6; z -= sd) zs.push(z); zs.push(zMin);
  const along = op.angle === 90 ? "y" : "x";
  const lines = []; // each line: list of cells along it
  const step = Math.max(1, Math.round(so / res));
  if (along === "x") for (let j = 0; j < ny; j += step) lines.push({ fixed: j, n: nx }); else for (let i = 0; i < nx; i += step) lines.push({ fixed: i, n: ny });
  const cell = (L, k) => (along === "x" ? L.fixed * nx + k : k * nx + L.fixed);
  const xy = (L, k) => (along === "x" ? [x0 + k * res, y0 + L.fixed * res] : [x0 + L.fixed * res, y0 + k * res]);
  for (const z of zs) {
    let flip = false;
    for (const L of lines) {
      const segs = []; let s0 = -1;
      for (let k = 0; k <= L.n; k++) {
        let ok = false;
        if (k < L.n) { const [x, y] = xy(L, k); ok = inStock(job, x, y) && D[cell(L, k)] + leave <= z + 1e-6; }
        if (ok && s0 < 0) s0 = k;
        if (!ok && s0 >= 0) { segs.push([s0, k - 1]); s0 = -1; }
      }
      if (!segs.length) continue;
      if (flip) { segs.reverse(); for (const s of segs) s.reverse(); }
      flip = !flip;
      for (const [a, b] of segs) {
        const A = xy(L, a), B = xy(L, b);
        // stay down if the way there is clear at this layer, otherwise go over the top
        if (P.at && Math.abs(P.at[2] - z) < 1e-6 && clearLine(hm, D, P.at, A, z - leave)) P.feed(A[0], A[1], z, op.feed);
        else { P.up(); P.approach(A[0], A[1], z, op.plunge, top); }
        P.feed(B[0], B[1], z, op.feed);
      }
    }
    P.up();
  }
  return P.m;
}
// is the straight move from p to q at height z clear of the model (as seen by this tool)?
function clearLine(hm, D, p, q, z) {
  const { nx, ny, x0, y0, res } = hm, L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / (res * 0.5)));
  for (let k = 0; k <= n; k++) {
    const x = p[0] + ((q[0] - p[0]) * k) / n, y = p[1] + ((q[1] - p[1]) * k) / n;
    const i = Math.round((x - x0) / res), j = Math.round((y - y0) / res);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    if (D[j * nx + i] > z + 1e-6) return false;
  }
  return true;
}
// Finishing: the tool follows the surface line by line (drop-cutter), keeping the given stepover
function finishOp(job, op, hm, D) {
  const P = new Path(job, op), { nx, ny, x0, y0, res, h } = hm, st = job.stock, t = op.tool;
  const so = Math.max(res, t.d * op.stepover), step = Math.max(1, Math.round(so / res)), floor = job.floor;
  // only over the model (and a tool's width around it), unless asked for everything
  let near = null;
  if (op.onlyModel !== false) {
    near = new Uint8Array(nx * ny); const r = Math.ceil((t.d / 2 + res) / res);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (h[j * nx + i] !== EMPTY && h[j * nx + i] > floor + 1e-3) for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && a * a + b * b <= r * r) near[jj * nx + ii] = 1; }
  }
  const dirs = op.angle === "both" ? [0, 90] : [op.angle === 90 ? 90 : 0];
  for (const ang of dirs) {
    const along = ang === 90 ? "y" : "x", lines = [];
    if (along === "x") for (let j = 0; j < ny; j += step) lines.push(j); else for (let i = 0; i < nx; i += step) lines.push(i);
    let flip = false;
    for (const f of lines) {
      const n = along === "x" ? nx : ny, segs = []; let cur = null;
      for (let k = 0; k <= n; k++) {
        let ok = false, x = 0, y = 0, c = 0;
        if (k < n) { c = along === "x" ? f * nx + k : k * nx + f; x = along === "x" ? x0 + k * res : x0 + f * res; y = along === "x" ? y0 + f * res : y0 + k * res; ok = inStock(job, x, y) && (!near || near[c]); }
        if (ok) { (cur || (cur = [])).push([x, y, Math.max(floor, D[c])]); }
        else if (cur) { segs.push(cur); cur = null; }
      }
      if (!segs.length) continue;
      if (flip) { segs.reverse(); for (const s of segs) s.reverse(); }
      flip = !flip;
      for (const sRaw of segs) {
        const s = simplify(sRaw, op.tol || 0.02);
        const A = s[0];
        // short hop from the end of the last line: follow the surface instead of lifting
        if (P.at && P.at[2] < st.zTop && Math.hypot(P.at[0] - A[0], P.at[1] - A[1]) <= so * 1.6 + res) {
          const hop = surfaceHop(hm, D, P.at, A, floor);
          for (const q of hop) P.feed(q[0], q[1], q[2], op.feed);
        } else { P.up(); P.approach(A[0], A[1], A[2], op.plunge, st.zTop); }
        for (let i = 1; i < s.length; i++) P.feed(s[i][0], s[i][1], s[i][2], op.feed);
      }
    }
    P.up();
  }
  return P.m;
}
function surfaceHop(hm, D, p, q, floor) {
  const { nx, ny, x0, y0, res } = hm, L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / res)), out = [];
  for (let k = 1; k <= n; k++) {
    const x = p[0] + ((q[0] - p[0]) * k) / n, y = p[1] + ((q[1] - p[1]) * k) / n;
    const i = Math.max(0, Math.min(nx - 1, Math.round((x - x0) / res))), j = Math.max(0, Math.min(ny - 1, Math.round((y - y0) / res)));
    out.push([x, y, Math.max(floor, D[j * nx + i], k === n ? q[2] : -Infinity)]);
  }
  return out;
}
// the outline of the model seen from above, grown by r: closed loops (marching squares)
export function outlineLoops(hm, r, minZ = -Infinity) {
  const { nx, ny, x0, y0, res, h } = hm;
  const m = new Uint8Array(nx * ny), rr = Math.ceil(r / res);
  const offs = []; for (let b = -rr; b <= rr; b++) for (let a = -rr; a <= rr; a++) if (Math.hypot(a, b) * res <= r + 1e-9) offs.push([a, b]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = h[j * nx + i]; if (v === EMPTY || v < minZ) continue; for (const [a, b] of offs) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) m[jj * nx + ii] = 1; } }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : m[j * nx + i]);
  // edges between filled and empty cells, as half-cell-offset segments, chained into loops
  const segs = new Map(), key = (x, y) => x + "," + y;
  const add = (ax, ay, bx, by) => { segs.set(key(ax, ay), [bx, by]); };
  for (let j = -1; j < ny; j++) for (let i = -1; i < nx; i++) {
    // corners of the square between cell centers (i, j) .. (i+1, j+1); keep filled on the left
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1), idx = a | (b << 1) | (c << 2) | (d << 3);
    // midpoints (in doubled grid units): bottom (2i+1, 2j), right (2i+2, 2j+1), top (2i+1, 2j+2), left (2i, 2j+1)
    const B = [2 * i + 1, 2 * j], Rt = [2 * i + 2, 2 * j + 1], T = [2 * i + 1, 2 * j + 2], Lf = [2 * i, 2 * j + 1];
    const S = (p, q) => add(p[0], p[1], q[0], q[1]);
    switch (idx) {
      case 1: S(Lf, B); break; case 2: S(B, Rt); break; case 3: S(Lf, Rt); break; case 4: S(Rt, T); break;
      case 5: S(Lf, T); S(Rt, B); break; case 6: S(B, T); break; case 7: S(Lf, T); break; case 8: S(T, Lf); break;
      case 9: S(T, B); break; case 10: S(T, Rt); S(B, Lf); break; case 11: S(T, Rt); break; case 12: S(Rt, Lf); break;
      case 13: S(Rt, B); break; case 14: S(B, Lf); break;
    }
  }
  const loops = [];
  while (segs.size) {
    const [k0] = segs.keys(); let k = k0; const pts = [];
    for (let guard = 0; guard < 1e7; guard++) {
      const nxt = segs.get(k); if (!nxt) break;
      segs.delete(k);
      const [px, py] = k.split(",").map(Number); pts.push([x0 + (px / 2) * res, y0 + (py / 2) * res]);
      k = key(nxt[0], nxt[1]);
      if (k === k0) break;
    }
    if (pts.length > 3) loops.push(pts);
  }
  return loops.map((p) => { let A = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; A += p[i][0] * q[1] - q[0] * p[i][1]; } return { pts: p, area: A / 2, outer: A > 0 }; });
}
// Cutout: around the outline (and through holes), down through the stock in passes, with tabs that
// hold the part in place on the last passes
function cutoutOp(job, op, hm) {
  const P = new Path(job, op), st = job.stock, t = op.tool, laser = t.type === "laser";
  const r = laser ? t.d / 2 : t.d / 2 + (op.leave || 0);
  let loops = outlineLoops(hm, r);
  loops = loops.map((L) => ({ ...L, pts: simplify2(L.pts, op.tol || 0.03) })).filter((L) => L.pts.length > 2);
  // holes first, then the outsides; climb milling: outsides clockwise, holes counter-clockwise
  loops.sort((a, b) => (a.outer === b.outer ? 0 : a.outer ? 1 : -1));
  for (const L of loops) { const cw = L.area < 0; const wantCw = (op.direction || "climb") === "climb" ? L.outer : !L.outer; if (cw !== wantCw) L.pts.reverse(); }
  const bottom = laser ? st.zTop : st.zBot - (op.through ?? 0.3);
  const zs = [];
  if (laser) for (let k = 0; k < Math.max(1, op.passes || 1); k++) zs.push(st.zTop);
  else { const sd = Math.max(0.05, op.stepdown); for (let z = st.zTop - sd; z > bottom + 1e-6; z -= sd) zs.push(z); zs.push(bottom); }
  const tabs = !laser && op.tabs && op.tabs.count > 0, tabTop = st.zBot + (op.tabs ? op.tabs.height : 0);
  for (const L of loops) {
    const pts = resample(L.pts, Math.max(1, t.d));
    // arc length of each point, for the tabs
    const len = [0]; for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = len[pts.length], half = op.tabs ? (op.tabs.width + t.d) / 2 : 0;
    const inTab = (s) => { if (!tabs || !L.outer) return false; for (let k = 0; k < op.tabs.count; k++) { const c = ((k + 0.5) / op.tabs.count) * total; if (Math.abs(s - c) < half) return true; } return false; };
    for (const z of zs) {
      const A = pts[0];
      if (!P.at || Math.hypot(P.at[0] - A[0], P.at[1] - A[1]) > 1e-6) { P.up(); P.approach(A[0], A[1], laser ? z : Math.max(z, st.zTop), op.plunge, st.zTop); }
      if (!laser) P.feed(A[0], A[1], inTab(0) ? Math.max(z, tabTop) : z, op.plunge);
      for (let i = 1; i <= pts.length; i++) {
        const q = pts[i % pts.length], zz = inTab(len[i]) ? Math.max(z, tabTop) : z;
        if (laser) P.feed(q[0], q[1], z, op.feed, op.power);
        else P.feed(q[0], q[1], zz, op.feed);
      }
    }
    P.up();
  }
  return P.m;
}
function simplify2(pts, tol) { const s = simplify([...pts, pts[0]].map((p) => [p[0], p[1], 0]), tol); s.pop(); return s.map((p) => [p[0], p[1]]); }
function resample(pts, maxLen) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
// Laser engraving: line by line over the model, darker (more power) where the model is lower
function engraveOp(job, op, hm) {
  const P = new Path(job, op), { nx, ny, x0, y0, res, h } = hm, st = job.stock, t = op.tool;
  const step = Math.max(1, Math.round(Math.max(t.d, op.line || 0.2) / res));
  let lo = Infinity, hi = -Infinity; for (const v of h) if (v !== EMPTY) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!isFinite(lo)) return P.m;
  const levels = 16, pw = (v) => (v === EMPTY ? 0 : Math.round((hi - lo < 1e-6 ? 1 : 1 - (v - lo) / (hi - lo)) * 0.85 * levels + 0.15 * levels) / levels);
  let flip = false;
  for (let j = 0; j < ny; j += step) {
    const runs = []; let cur = null;
    for (let i = 0; i <= nx; i++) {
      const p = i < nx ? pw(h[j * nx + i]) : 0;
      if (cur && Math.abs(cur.p - p) < 1e-9) { cur.b = i; continue; }
      if (cur && cur.p > 0) runs.push(cur);
      cur = i < nx ? { a: i, b: i, p } : null;
    }
    if (!runs.length) continue;
    if (flip) { runs.reverse(); for (const r of runs) [r.a, r.b] = [r.b, r.a]; }
    flip = !flip;
    const y = y0 + j * res;
    for (const r of runs) {
      const xa = x0 + r.a * res - (flip ? -res / 2 : res / 2) * 0, xb = x0 + r.b * res;
      if (!P.at || Math.hypot(P.at[0] - xa, P.at[1] - y) > res * 1.5) { P.rapid(xa, y, st.zTop); }
      else P.feed(xa, y, st.zTop, op.feed, 0);
      P.feed(xb, y, st.zTop, op.feed, +(op.power * r.p).toFixed(3));
    }
  }
  return P.m;
}

// ------------------------------------------------------------------ the whole job
// job: { stock: {x0,y0,x1,y1,zTop,zBot}, clearZ, floor, res, ops: [...] }, tris: model triangles
export function buildProgram(job, tris) {
  if (job.rotary) return buildRotary(job, tris);
  const st = job.stock, maxR = Math.max(1, ...job.ops.map((o) => o.tool.d / 2)) + job.res * 2;
  const box = { x0: st.x0 - maxR, y0: st.y0 - maxR, x1: st.x1 + maxR, y1: st.y1 + maxR };
  const hm = heightMap(tris, box, job.res);
  const ops = [], warnings = [];
  const drops = new Map();
  for (const op of job.ops) {
    if (op.enabled === false) continue;
    const key = JSON.stringify([op.tool.type, op.tool.d, op.tool.cr, op.tool.angle, op.tool.tip]);
    const D = () => { if (!drops.has(key)) drops.set(key, dropMap(hm, toolKernel(op.tool, job.res), job.floor)); return drops.get(key); };
    let moves = [];
    if (op.type === "rough") moves = roughOp(job, op, hm, D());
    else if (op.type === "face") moves = roughOp(job, op, hm, D(), { face: true });
    else if (op.type === "finish") moves = finishOp(job, op, hm, D());
    else if (op.type === "cutout" || op.type === "lasercut") moves = cutoutOp(job, op, hm);
    else if (op.type === "engrave") moves = engraveOp(job, op, hm);
    if (op.tool.type !== "laser" && (op.stepdown || 0) > (op.tool.len || 99) + 1e-6) warnings.push(`${op.name}: each pass (${op.stepdown} mm) is deeper than the bit's cutting length (${op.tool.len} mm).`);
    if (!moves.length) warnings.push(`${op.name}: nothing to cut with these settings.`);
    ops.push({ op, moves });
  }
  return { ops, hm, warnings };
}
// how far a move goes; turning the rotary axis counts as the arc at the tool's radius
export function moveLen(a, b, rot) {
  if (!rot || (a.a === undefined && b.a === undefined)) return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const r = Math.max(a.z, b.z) - rot.zc, da = (((b.a || 0) - (a.a || 0)) * Math.PI) / 180;
  return Math.hypot(b.x - a.x, b.z - a.z, r * da);
}
export function programStats(prog, mach) {
  let t = 0, cut = 0, air = 0, prev = null;
  for (const { moves } of prog.ops) for (const m of moves) {
    if (prev) { const d = moveLen(prev, m, prog.rotary); if (m.g === 0) { air += d; t += (d / (mach.rapid || 3000)) * 60; } else { cut += d; t += (d / Math.max(1, m.f || 100)) * 60; } }
    prev = m;
  }
  return { seconds: t, cut, air };
}

// ------------------------------------------------------------------ G-code
// origin: "fl-top" (front-left corner of the stock, Z0 on its top), "c-top" (center, top), "fl-bottom"
export function workOrigin(job) {
  const s = job.stock, o = job.origin || "fl-top";
  if (job.rotary) return [o === "r-mid" ? (s.x0 + s.x1) / 2 : s.x0, job.rotary.yc, job.rotary.zc];
  return [o.startsWith("c") ? (s.x0 + s.x1) / 2 : s.x0, o.startsWith("c") ? (s.y0 + s.y1) / 2 : s.y0, o.endsWith("bottom") ? s.zBot : s.zTop];
}
export function toGcode(prog, job, mach, opts = {}) {
  const post = POSTS[opts.post || mach.post] ? opts.post || mach.post : "grbl", inch = (opts.units || mach.units) === "in";
  const k = inch ? 1 / IN : 1, dp = inch ? 4 : 3, O = workOrigin(job), rot = !!job.rotary;
  const n = (v) => { let s = (v * k).toFixed(dp); if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" ? "0" : s; };
  const L = [], c = (t) => L.push(post === "marlin" ? "; " + t : "(" + t.replace(/[()]/g, "") + ")");
  const laserMach = mach.kind === "laser";
  c(`${opts.title || "JumpStart 3D job"}`);
  c(`Made with JumpStart 3D CAM for ${POSTS[post].name}, ${inch ? "inches" : "millimetres"}`);
  if (!rot) c(`Stock ${n(job.stock.x1 - job.stock.x0)} x ${n(job.stock.y1 - job.stock.y0)} x ${n(job.stock.zTop - job.stock.zBot)}; zero at the ${job.origin === "c-top" ? "center of the stock top" : job.origin === "fl-bottom" ? "front-left corner, bottom" : "front-left corner of the stock top"}`);
  if (rot) {
    c(`4th axis: the stock turns around X (A axis, degrees). X0 at the ${job.origin === "r-mid" ? "middle" : "left end"} of the stock; Y0 and Z0 on the rotary axis centerline`);
    c(`Stock: round, ${n(job.rotary.R * 2)} across, ${n(job.stock.x1 - job.stock.x0)} long`);
    if (post === "grbl") c("Standard GRBL 1.1 has no A axis: use grblHAL or FluidNC (or LinuxCNC / Mach3)");
  }
  for (const { op } of prog.ops) c(`T${op.toolNo || 1}: ${op.tool.name}  - ${op.name}`);
  if (post === "linuxcnc") L.push("G17 G21 G40 G49 G80 G90 G94 G64 P" + n(0.02).replace(/^0$/, "0.02"));
  else if (post === "mach3") L.push("G17 G40 G49 G80 G90 G94");
  else L.push("G90 G94 G17");
  L.push(inch ? "G20" : "G21");
  L.push(`G0 Z${n(job.clearZ - O[2])}`);
  if (rot) L.push("G0 A0");
  let last = { x: null, y: null, z: null, f: null, s: null, g: null, a: null }, first = true;
  const an = (v) => { let s = v.toFixed(3); s = s.replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" ? "0" : s; };
  const safe = job.clearZ;
  for (const { op, moves } of prog.ops) {
    const laser = op.tool.type === "laser", tn = op.toolNo || 1;
    c(`${op.name}`);
    if (!first || post === "linuxcnc" || post === "mach3") {
      L.push(`G0 Z${n(safe - O[2])}`);
      if (!laser || !first) L.push(post === "marlin" ? "M5" : "M5");
      if (!first) {
        if (post === "linuxcnc" || post === "mach3") { L.push(`T${tn} M6`); if (post === "linuxcnc") L.push(`G43 H${tn}`); }
        else if (!laser) { c(`Change the bit to T${tn}: ${op.tool.name}, set Z zero again, then resume`); L.push(post === "marlin" ? "M0 Change bit" : "M0"); }
      } else if (post === "linuxcnc" || post === "mach3") { L.push(`T${tn} M6`); if (post === "linuxcnc") L.push(`G43 H${tn}`); }
    }
    first = false;
    if (laser) L.push(post === "marlin" ? "M3 S0" : "M4 S0");
    else if (post === "marlin") { L.push(`M3 S${Math.max(1, Math.min(255, Math.round((op.rpm / (mach.rpmMax || op.rpm)) * 255)))}`); L.push("G4 S3"); }
    else { L.push(`S${Math.round(op.rpm)} M3`); L.push(post === "grbl" ? "G4 P3" : "G4 P3"); }
    last = { x: null, y: null, z: null, f: null, s: null, g: null, a: last.a };
    const sScale = laser ? (post === "marlin" ? 255 : mach.rpmMax || 1000) : 1;
    for (const m of moves) {
      const x = m.x - O[0], y = m.y - O[1], z = m.z - O[2];
      let s = (m.g === 0 ? "G0" : "G1");
      const parts = [];
      if (last.x === null || Math.abs(x - last.x) > 1e-7) parts.push("X" + n(x));
      if (last.y === null || Math.abs(y - last.y) > 1e-7) parts.push("Y" + n(y));
      if (!laser && (last.z === null || Math.abs(z - last.z) > 1e-7)) parts.push("Z" + n(z));
      if (laser && last.z === null) parts.push("Z" + n(z));
      if (m.a !== undefined && (last.a === null || Math.abs(m.a - last.a) > 1e-6)) { parts.push("A" + an(m.a)); last.a = m.a; }
      if (!parts.length && !(laser && m.s !== undefined && m.s !== last.s)) continue;
      if (m.g === 1 && m.f !== last.f) { parts.push("F" + (inch ? (m.f / IN).toFixed(1) : String(Math.round(m.f)))); last.f = m.f; }
      if (laser && m.g === 1 && m.s !== undefined && m.s !== last.s) { parts.push("S" + Math.round(m.s * sScale)); last.s = m.s; }
      if (laser && m.g === 0) last.s = 0;
      L.push(s + " " + parts.join(" "));
      last.x = x; last.y = y; last.z = z;
    }
  }
  L.push(`G0 Z${n(safe - O[2])}`);
  L.push("M5");
  L.push(`G0 X0 Y0`);
  if (rot) L.push("G0 A0");
  L.push(post === "linuxcnc" ? "M2" : post === "marlin" ? "M84" : "M30");
  if (post === "linuxcnc" || post === "mach3") { L.unshift("%"); L.push("%"); }
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------------ material removal simulation
// The stock as a grid of columns (dexels); the tool's underside is swept along each move and
// lowers the columns it passes through. Also watches for rapid moves into material and cuts deeper
// than the bit can reach.
export class StockSim {
  constructor(job, res) {
    const s = job.stock;
    this.res = res; this.x0 = s.x0; this.y0 = s.y0;
    this.nx = Math.max(2, Math.round((s.x1 - s.x0) / res) + 1); this.ny = Math.max(2, Math.round((s.y1 - s.y0) / res) + 1);
    this.zTop = s.zTop; this.zBot = s.zBot;
    this.h = new Float32Array(this.nx * this.ny).fill(s.zTop);
    this.burn = new Uint8Array(this.nx * this.ny);
    this.removed = 0; this.rapidHits = 0; this.tooDeep = 0; this.dirty = null;
    this.kern = new Map();
  }
  kernel(tool) { const k = JSON.stringify([tool.type, tool.d, tool.cr, tool.angle, tool.tip]); if (!this.kern.has(k)) this.kern.set(k, toolKernel(tool.type === "laser" ? { ...tool, type: "flat", d: Math.max(tool.d, this.res) } : tool, this.res)); return this.kern.get(k); }
  mark(i, j) { const d = this.dirty || (this.dirty = { i0: i, i1: i, j0: j, j1: j }); if (i < d.i0) d.i0 = i; if (i > d.i1) d.i1 = i; if (j < d.j0) d.j0 = j; if (j > d.j1) d.j1 = j; }
  // one straight move from a to b (positions of the tool tip)
  move(a, b, tool, g, power) {
    const K = this.kernel(tool), L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / (this.res * 0.5)));
    const laser = tool.type === "laser", flute = tool.len || 1e9, nx = this.nx, ny = this.ny, h = this.h, res = this.res, a2 = this.res * this.res;
    let hit = false;
    for (let s = n === 1 && L < 1e-9 ? 1 : 0; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n, y = a.y + ((b.y - a.y) * s) / n, z = a.z + ((b.z - a.z) * s) / n;
      const ci = Math.round((x - this.x0) / res), cj = Math.round((y - this.y0) / res);
      if (ci < -K.n || cj < -K.n || ci > nx + K.n || cj > ny + K.n) continue;
      // a laser burns: shallow when engraving, through when cutting at full power
      const zt = laser ? (g === 0 || !power ? Infinity : power >= 0.95 ? this.zBot - 1 : this.zTop - 0.6 * power) : z;
      if (zt === Infinity) continue;
      for (let k = 0; k < K.di.length; k++) {
        const i = ci + K.di[k], j = cj + K.dj[k];
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const idx = j * nx + i, zc = laser ? zt : zt + K.off[k];
        if (h[idx] > zc + 1e-4) {
          if (g === 0 && !laser) { if (h[idx] - zc > 0.05) hit = true; continue; }
          if (!laser && h[idx] - zc > flute + 0.01) this.tooDeep++;
          this.removed += (h[idx] - Math.max(zc, this.zBot - 1)) * a2;
          h[idx] = Math.max(zc, this.zBot - 1);
          if (laser) this.burn[idx] = Math.min(255, this.burn[idx] + 60);
          this.mark(i, j);
        }
      }
    }
    if (hit) this.rapidHits++;
  }
}

// ------------------------------------------------------------------ 4th axis (rotary)
// The stock is a round bar turning around a line parallel to X (the A axis). For each angle the
// part is turned so that side faces up, and the tool works from above, as in 3-axis: the same
// drop-cutter on a narrow height map along the axis. Tool positions are kept as x, z (the tool tip,
// z - zc = its distance from the axis) and a (degrees).
// job.rotary: { yc, zc (the axis), R (stock radius), mx0, mx1 (where the model is along X), core }
function turned(rel, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), out = new Float32Array(rel.length);
  for (let i = 0; i < rel.length; i += 3) { const y = rel[i + 1], z = rel[i + 2]; out[i] = rel[i]; out[i + 1] = y * c - z * s; out[i + 2] = y * s + z * c; }
  return out;
}
// the lowest radius the tool's tip can reach along the line under it, at one angle
function rotaryLine(rel, ang, tool, job, kernCache) {
  const R = job.rotary, res = job.res, rT = tool.d / 2 + res;
  const t = turned(rel, ang);
  const hm = heightMap(t, { x0: R.mx0 - rT, x1: R.mx1 + rT, y0: -rT, y1: rT }, res);
  const key = JSON.stringify([tool.type, tool.d, tool.cr, tool.angle, tool.tip]);
  if (!kernCache.has(key)) kernCache.set(key, toolKernel(tool, res));
  const D = dropMap(hm, kernCache.get(key), R.core || 0);
  const j0 = Math.round((0 - hm.y0) / res), out = [];
  for (let i = 0; i < hm.nx; i++) { const x = hm.x0 + i * res; if (x < R.mx0 - 1e-6 || x > R.mx1 + 1e-6) continue; out.push([x, D[j0 * hm.nx + i]]); }
  return out;
}
function buildRotary(job, tris) {
  const R = job.rotary, rel = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) { rel[i] = tris[i]; rel[i + 1] = tris[i + 1] - R.yc; rel[i + 2] = tris[i + 2] - R.zc; }
  const kc = new Map(), ops = [], warnings = [];
  const clear = R.R + 5, deg = (r) => (r * 180) / Math.PI;
  for (const op of job.ops) {
    if (op.enabled === false) continue;
    const t = op.tool, m = [], at = { x: null, z: null, a: null };
    const mv = (g, x, r, a, f) => { m.push({ g, x, y: R.yc, z: R.zc + r, a: +a.toFixed(4), ...(g ? { f } : {}) }); at.x = x; at.z = r; at.a = a; };
    const up = () => { if (at.x !== null && at.z < clear - 1e-6) mv(0, at.x, clear, at.a); };
    if (op.type === "rrough") {
      // flat layers inward from the outside; along X at each angle, cutting where the part is lower
      const so = Math.max(job.res, t.d * op.stepover), nA = Math.max(8, Math.ceil((2 * Math.PI * R.R) / so)), sd = Math.max(0.05, op.stepdown), leave = op.leave || 0;
      const lines = []; for (let k = 0; k < nA; k++) { const a = (2 * Math.PI * k) / nA; lines.push({ a, pts: rotaryLine(rel, a, t, job, kc) }); }
      let lo = Infinity; for (const L of lines) for (const p of L.pts) lo = Math.min(lo, p[1] + leave);
      const rs = []; for (let r = R.R - sd; r > lo + 1e-6; r -= sd) rs.push(r); rs.push(Math.max(lo, R.core || 0));
      let flip = false, prevR = R.R;
      for (const r of rs) {
        for (const L of lines) {
          const segs = []; let s0 = null;
          for (let i = 0; i <= L.pts.length; i++) { const ok = i < L.pts.length && L.pts[i][1] + leave <= r + 1e-6; if (ok && !s0) s0 = [i, i]; else if (ok) s0[1] = i; if (!ok && s0) { segs.push(s0); s0 = null; } }
          if (!segs.length) continue;
          if (flip) { segs.reverse(); for (const sg of segs) sg.reverse(); }
          flip = !flip;
          for (const [a, b] of segs) {
            const A = L.pts[a][0], B = L.pts[b][0];
            if (at.x === null || Math.abs(at.a - deg(L.a)) > 1e-6 || Math.abs(at.x - A) > 1e-6 || Math.abs(at.z - r) > 1e-6) { up(); mv(0, A, clear, deg(L.a)); mv(0, A, Math.min(clear, prevR + 0.5), deg(L.a)); mv(1, A, r, deg(L.a), op.plunge); }
            mv(1, B, r, deg(L.a), op.feed);
          }
        }
        up(); prevR = r;
      }
    } else if (op.type === "rfinish") {
      // along X at each angle, following the surface; turning a little at the end of each line
      let rMax = 1; for (let i = 0; i < rel.length; i += 3) rMax = Math.max(rMax, Math.hypot(rel[i + 1], rel[i + 2]));
      const so = Math.max(job.res * 0.5, t.d * op.stepover), nA = Math.max(12, Math.ceil((2 * Math.PI * rMax) / so));
      let flip = false;
      for (let k = 0; k <= nA; k++) {
        const a = (2 * Math.PI * k) / nA, pts = rotaryLine(rel, a, t, job, kc).map((p) => [p[0], Math.max(R.core || 0, p[1]), 0]);
        if (!pts.length) continue;
        let line = simplify(pts, op.tol || 0.03);
        if (flip) line = line.reverse();
        flip = !flip;
        const A = line[0];
        if (at.x === null) { mv(0, A[0], clear, deg(a)); mv(1, A[0], A[1], deg(a), op.plunge); }
        else mv(1, A[0], Math.max(A[1], at.z), deg(a), op.feed); // turn to the next angle, never lower than either side
        if (Math.abs(at.z - A[1]) > 1e-6) mv(1, A[0], A[1], deg(a), op.feed);
        for (let i = 1; i < line.length; i++) mv(1, line[i][0], line[i][1], deg(a), op.feed);
      }
      up();
    }
    if ((op.stepdown || 0) > (t.len || 99) + 1e-6) warnings.push(`${op.name}: each pass (${op.stepdown} mm) is deeper than the bit's cutting length (${t.len} mm).`);
    if (R.R > (t.len || 99) + 0.5 && op.type === "rrough") warnings.push(`${op.name}: the bit (${t.len} mm cutting length) can't reach all the way in at once; it cuts in passes, but check the holder clears the stock.`);
    if (!m.length) warnings.push(`${op.name}: nothing to cut with these settings.`);
    ops.push({ op, moves: m });
  }
  return { ops, hm: null, warnings, rotary: { zc: R.zc, yc: R.yc } };
}
// The round stock as radial columns: for each step along X and each angle, how far material reaches
// from the axis. The tool's underside is swept along each move (turning with A).
export class RotarySim {
  constructor(job, res) {
    const R = job.rotary, s = job.stock;
    this.res = res; this.x0 = s.x0; this.R = R.R; this.zc = R.zc; this.yc = R.yc; this.zBot = 0;
    this.nx = Math.max(2, Math.round((s.x1 - s.x0) / res) + 1);
    this.na = Math.max(24, Math.min(1440, Math.round((2 * Math.PI * R.R) / res)));
    this.rho = new Float32Array(this.nx * this.na).fill(R.R);
    this.removed = 0; this.rapidHits = 0; this.tooDeep = 0; this.kern = new Map();
    this.rotary = true;
  }
  kernel(tool) { const k = JSON.stringify([tool.type, tool.d, tool.cr, tool.angle, tool.tip]); if (!this.kern.has(k)) this.kern.set(k, toolKernel(tool, this.res * 0.75)); return this.kern.get(k); }
  move(a, b, tool, g) {
    const K = this.kernel(tool), r0 = a.z - this.zc, r1 = b.z - this.zc, A0 = ((a.a || 0) * Math.PI) / 180, A1 = ((b.a ?? a.a ?? 0) * Math.PI) / 180;
    const L = Math.hypot(b.x - a.x, r1 - r0, Math.max(r0, r1) * (A1 - A0)), n = Math.max(1, Math.ceil(L / (this.res * 0.6)));
    const { nx, na, rho, res } = this, kr = res * 0.75, da = (2 * Math.PI) / na, flute = tool.len || 1e9;
    let hit = false;
    for (let s = 0; s <= n; s++) {
      const f = s / n, x = a.x + (b.x - a.x) * f, r = r0 + (r1 - r0) * f, A = A0 + (A1 - A0) * f;
      if (r >= this.R + tool.d) continue;
      for (let k = 0; k < K.di.length; k++) {
        const dx = K.di[k] * kr, w = K.dj[k] * kr, h = r + K.off[k];
        const i = Math.round((x + dx - this.x0) / res); if (i < 0 || i >= nx) continue;
        // every angle column this bit of the tool's underside covers (it spans kr across)
        const pa = A + Math.atan2(w - kr / 2, h), pb = A + Math.atan2(w + kr / 2, h);
        const ja = Math.round(pa / da), jb = Math.max(ja, Math.round(pb / da));
        for (let jj = ja; jj <= jb; jj++) {
          const phi = jj * da - A, ww = h * Math.tan(phi), rt = Math.hypot(ww, h);
          let j = jj % na; if (j < 0) j += na;
          const q = i * na + j;
          if (rho[q] > rt + 1e-4) {
            if (g === 0) { if (rho[q] - rt > 0.1) hit = true; continue; }
            if (rho[q] - rt > flute + 0.01) this.tooDeep++;
            this.removed += (rho[q] * rho[q] - rt * rt) * 0.5 * da * res;
            rho[q] = rt;
          }
        }
      }
    }
    if (hit) this.rapidHits++;
  }
}
