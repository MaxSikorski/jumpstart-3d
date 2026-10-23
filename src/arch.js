// Architechies (the fourth mode): a 3D floor-plan maker for houses and buildings. Draw walls (or
// whole rooms) on the plan, raise them to a height, put doors and windows in them (by snapping in
// 3D or by typing exact positions on a grid view of each wall), cover it with a roof and send it
// to Beginner or Advanced as real, editable shapes (walls with their openings cut, frames, roof).
// The building lives in the design (doc.arch) at full size, so undo, saving and versions work as
// everywhere else; it is drawn here with plain three.js meshes, so editing is instant.
import * as THREE from "three";
import { store, nextSeq, IDENTITY } from "./store.js";
import { el, uid, parseLength } from "./util.js";
import { isInch, setUnit, onUnit } from "./units.js";
import { ICON } from "./icons.js";
import { nextName } from "./ops.js";

const IN = 25.4, FT = 304.8;
// ------------------------------------------------------------------ catalogs
// doors and windows: rough openings (width × height) and, for windows, the sill height
export const DOORS = [
  { id: "int30", name: 'Interior door 30"', w: 762, h: 2032, kind: "single" },
  { id: "int32", name: 'Interior door 32"', w: 813, h: 2032, kind: "single" },
  { id: "ext36", name: 'Front door 36"', w: 914, h: 2032, kind: "front" },
  { id: "dbl60", name: 'Double door 60"', w: 1524, h: 2032, kind: "double" },
  { id: "patio72", name: 'Sliding patio 72"', w: 1829, h: 2032, kind: "slider" },
  { id: "bifold48", name: 'Closet bifold 48"', w: 1219, h: 2032, kind: "bifold" },
  { id: "garage9", name: "Garage door 9'", w: 2743, h: 2134, kind: "garage" },
  { id: "garage16", name: "Garage door 16'", w: 4877, h: 2134, kind: "garage" },
  { id: "m800", name: "Interior door 800 mm", w: 800, h: 2040, kind: "single" },
  { id: "m900", name: "Front door 900 mm", w: 900, h: 2100, kind: "front" },
  { id: "open", name: "Open doorway", w: 914, h: 2134, kind: "opening" },
];
export const WINDOWS = [
  { id: "sh3648", name: "Single hung 36×48", w: 914, h: 1219, sill: 914, kind: "hung" },
  { id: "sh2436", name: "Small 24×36", w: 610, h: 914, sill: 1067, kind: "hung" },
  { id: "pic7248", name: "Picture 72×48", w: 1829, h: 1219, sill: 762, kind: "picture" },
  { id: "sl4836", name: "Slider 48×36", w: 1219, h: 914, sill: 1067, kind: "slider" },
  { id: "cas3060", name: "Tall casement 30×60", w: 762, h: 1524, sill: 610, kind: "casement" },
  { id: "bath2424", name: "Bathroom 24×24", w: 610, h: 610, sill: 1372, kind: "picture" },
  { id: "tr3612", name: "Transom 36×12", w: 914, h: 305, sill: 2134, kind: "picture" },
  { id: "round24", name: 'Round 24"', w: 610, h: 610, sill: 1219, kind: "round" },
  { id: "m1200", name: "Window 1200×1200 mm", w: 1200, h: 1200, sill: 900, kind: "casement" },
];
const PRESETS = Object.fromEntries([...DOORS, ...WINDOWS].map((p) => [p.id, p]));
export const WALL_TYPES = [
  { id: "ext6", name: "Exterior 2×6 (6½\")", t: 165 },
  { id: "ext4", name: "Exterior 2×4 (4½\")", t: 114 },
  { id: "int4", name: "Interior 2×4 (4½\")", t: 114 },
  { id: "block8", name: "Block or brick (8\")", t: 203 },
  { id: "m250", name: "Exterior 250 mm", t: 250 },
  { id: "m200", name: "Exterior 200 mm", t: 200 },
  { id: "m100", name: "Interior 100 mm", t: 100 },
];
const HEIGHTS_IN = [["8'", 8 * FT], ["9'", 9 * FT], ["10'", 10 * FT], ["12'", 12 * FT]];
const HEIGHTS_MM = [["2.4 m", 2400], ["2.7 m", 2700], ["3.0 m", 3000], ["3.6 m", 3600]];
const ROOFS = [
  { id: "gable", name: "Gable" }, { id: "hip", name: "Hip" }, { id: "shed", name: "Shed" },
  { id: "pyramid", name: "Pyramid" }, { id: "barrel", name: "Barrel" }, { id: "flat", name: "Flat" },
];
const SCALES = [["1:1", 1, "full size"], ["1:24", 24, '½" = 1\' (dollhouse)'], ["1:48", 48, '¼" = 1\''], ["1:50", 50, "2 cm = 1 m"], ["1:87", 87, "HO model train"], ["1:100", 100, "1 cm = 1 m"], ["1:200", 200, "0.5 cm = 1 m"]];
const COL = { wall: "#ebe6dc", plan: "#56657a", roof: "#8b4a3c", slab: "#bdb6aa", door: "#9b6a43", garage: "#e9e7e2", frame: "#f6f5f1", glass: "#9fd0ee", knob: "#c9a23a", sel: "#1f4fa8" };

// ------------------------------------------------------------------ lengths
export function fmtLen(mm) {
  if (!isFinite(mm)) return "";
  if (!isInch()) return Math.round(mm) + " mm";
  const q = Math.round((Math.abs(mm) / IN) * 4) / 4, s = mm < 0 ? "-" : "";
  const ft = Math.floor(q / 12 + 1e-9), inch = q - ft * 12;
  const whole = Math.floor(inch + 1e-9), fr = inch - whole;
  const frs = fr > 0.7 ? "¾" : fr > 0.4 ? "½" : fr > 0.1 ? "¼" : "";
  const ins = (whole || !frs ? String(whole) : "") + frs;
  return s + (ft ? `${ft}' ` : "") + (ft && !whole && !frs ? '0"' : ins + '"');
}
// 10' 6", 10'6, 126", 126 in, 3.2 m, 3200, 320 cm, 6 1/2" ... (bare numbers: the unit in use)
export function parseArch(str) {
  let s = String(str).trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return NaN;
  s = s.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, "($1+$2/$3)");
  s = s.replace(/(\d+(?:\.\d+)?)\s*'\s*(?=\S)/g, "$1ft+").replace(/(\d+(?:\.\d+)?)\s*'/g, "$1ft");
  s = s.replace(/\)\s*"/g, ")in").replace(/\+\s*$/, "");
  // "(6+1/2)in" → (6+1/2)*1in
  s = s.replace(/\)in/g, ")*1in");
  return parseLength(s, isInch() ? "in" : "mm");
}

// ------------------------------------------------------------------ the building data
function defaults() {
  const inch = isInch();
  return { v: 1, levels: [{ id: "L1", name: "Level 1", elev: 0 }], walls: [], openings: [], roofs: [], slabs: [], wallT: inch ? 165 : 200, wallH: inch ? 9 * FT : 2700, grid: inch ? 6 * IN : 100 };
}
const D2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a, b, tol = 1) => D2(a, b) < tol;
function winfo(w) {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1e-6;
  return { L, ux: dx / L, uy: dy / L, nx: dy / L, ny: -dx / L };
}
// distance from p to wall w's centerline, and where along it (0..L)
function onWall(w, p) {
  const { L, ux, uy } = winfo(w), qx = p[0] - w.a[0], qy = p[1] - w.a[1];
  const u = qx * ux + qy * uy;
  const uc = Math.max(0, Math.min(L, u));
  return { u, d: Math.hypot(qx - ux * uc, qy - uy * uc) };
}
// how far each end of a wall reaches past its centerline end, so corners and tees close up
function wallExt(walls, w) {
  const out = [0, 0];
  [w.a, w.b].forEach((p, i) => {
    for (const o of walls) {
      if (o === w || o.lvl !== w.lvl) continue;
      if (near(p, o.a) || near(p, o.b)) { out[i] = Math.max(out[i], o.t / 2); continue; }
      const r = onWall(o, p);
      if (r.u > 1 && r.u < winfo(o).L - 1 && r.d < 1) out[i] = Math.max(out[i], o.t / 2);
    }
  });
  return out;
}
function levelTop(A, lvl) {
  let h = 0;
  for (const w of A.walls) if (w.lvl === lvl) h = Math.max(h, w.h || 0);
  return h || A.wallH;
}
// openings of a wall that fit: inside the wall, and not overlapping an earlier one
function goodOpenings(A, w) {
  const { L } = winfo(w), list = A.openings.filter((o) => o.wall === w.id).sort((p, q) => p.s - q.s), ok = [], bad = new Set();
  const h = w.h || 0;
  for (const o of list) {
    const top = o.sill + o.h;
    if (o.s < -0.5 || o.s + o.w > L + 0.5 || o.sill < -0.5 || top > h - 10 || o.w < 50 || o.h < 50) { bad.add(o.id); continue; }
    if (ok.some((q) => o.s < q.s + q.w + 20 && q.s < o.s + o.w + 20 && o.sill < q.sill + q.h + 20 && q.sill < top + 20)) { bad.add(o.id); continue; }
    ok.push(o);
  }
  return { ok, bad };
}
// a wall's frame: x along the wall, y up, z across (the wall's "A" side is -z, "B" side +z)
function wallBasis(w, elev) {
  const { ux, uy, nx, ny } = winfo(w);
  return new THREE.Matrix4().set(ux, 0, nx, w.a[0], uy, 0, ny, w.a[1], 0, 1, 0, elev, 0, 0, 0, 1);
}

// ------------------------------------------------------------------ meshes
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, transparent: !!opts.glass, opacity: opts.glass ? 0.42 : 1, side: opts.glass ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !opts.glass });
    m.userData.base = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
    matCache.set(key, m);
  }
  return matCache.get(key);
}
function box(sx, sy, sz, color, opts) { return new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, sx), Math.max(0.5, sy), Math.max(0.5, sz)), mat(color, opts)); }
// put a part at (along, up, across) in a wall's frame
function inWall(obj, B, x, y, z) { obj.position.set(x, y, z); obj.updateMatrix(); obj.matrix.premultiply(B); obj.matrixAutoUpdate = false; obj.matrixWorldNeedsUpdate = true; return obj; }

function wallMesh(A, w, elev, ext) {
  const { L } = winfo(w), h = Math.max(1, w.h || 0), t = w.t;
  const { ok } = goodOpenings(A, w);
  const shape = new THREE.Shape();
  // doors reach the floor: they are notches in the outline; windows are holes
  const doors = ok.filter((o) => o.sill < 1 && PRESETS[o.preset]?.kind !== "round").sort((p, q) => p.s - q.s);
  shape.moveTo(-ext[0], 0);
  for (const o of doors) { shape.lineTo(o.s, 0); shape.lineTo(o.s, o.h); shape.lineTo(o.s + o.w, o.h); shape.lineTo(o.s + o.w, 0); }
  shape.lineTo(L + ext[1], 0); shape.lineTo(L + ext[1], h); shape.lineTo(-ext[0], h); shape.closePath();
  for (const o of ok) {
    if (doors.includes(o)) continue;
    const p = new THREE.Path();
    if (PRESETS[o.preset]?.kind === "round") p.absarc(o.s + o.w / 2, o.sill + o.h / 2, Math.min(o.w, o.h) / 2, 0, Math.PI * 2, true);
    else { p.moveTo(o.s, o.sill); p.lineTo(o.s, o.sill + o.h); p.lineTo(o.s + o.w, o.sill + o.h); p.lineTo(o.s + o.w, o.sill); p.closePath(); }
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 28 });
  g.translate(0, 0, -t / 2);
  const m = new THREE.Mesh(g, mat(COL.wall).clone());
  m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
  m.applyMatrix4(wallBasis(w, elev));
  m.userData.pick = { k: "wall", id: w.id };
  return m;
}
function planWallMesh(w, elev, ext) {
  const { L } = winfo(w);
  const m = box(L + ext[0] + ext[1], 30, w.t, COL.plan);
  m.material = m.material.clone(); m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
  inWall(m, wallBasis(w, elev), (L + ext[1] - ext[0]) / 2, 15, 0);
  m.userData.pick = { k: "wall", id: w.id };
  return m;
}
// a door or window, with its frame, in the wall's frame
function openingModel(o, w, elev) {
  const P = PRESETS[o.preset] || { kind: o.k === "door" ? "single" : "picture" };
  const B = wallBasis(w, elev), g = new THREE.Group(), t = w.t;
  const cx = o.s + o.w / 2, fw = Math.min(55, o.w * 0.08), dep = t + 24;
  const add = (m, x, y, z) => g.add(inWall(m, B, x, y, z));
  const side = o.flip ? -1 : 1;
  if (P.kind === "round") {
    const r = Math.min(o.w, o.h) / 2, cy = o.sill + o.h / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - fw / 2, fw / 2, 10, 40), mat(COL.frame));
    add(ring, cx, cy, 0);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(r - fw * 0.8, 40), mat(COL.glass, { glass: true }));
    add(gl, cx, cy, 0);
    const bar = box(o.w - fw, 30, 40, COL.frame); add(bar, cx, cy, 0);
    const bar2 = box(30, o.h - fw, 40, COL.frame); add(bar2, cx, cy, 0);
  } else if (o.k === "window") {
    const y0 = o.sill;
    add(box(fw, o.h, dep, COL.frame), o.s + fw / 2, y0 + o.h / 2, 0);
    add(box(fw, o.h, dep, COL.frame), o.s + o.w - fw / 2, y0 + o.h / 2, 0);
    add(box(o.w, fw, dep, COL.frame), cx, y0 + o.h - fw / 2, 0);
    add(box(o.w, fw, dep, COL.frame), cx, y0 + fw / 2, 0);
    add(box(o.w + 90, 32, t + 70, COL.frame), cx, y0 - 16, side * 10); // sill
    const gw = o.w - 2 * fw, gh = o.h - 2 * fw;
    add(box(gw, gh, 6, COL.glass, { glass: true }), cx, y0 + o.h / 2, 0);
    if (P.kind === "hung") add(box(gw, 42, 60, COL.frame), cx, y0 + o.h / 2, 0);
    if (P.kind === "slider" || (P.kind === "casement" && o.w > 900)) add(box(42, gh, 60, COL.frame), cx, y0 + o.h / 2, 0);
  } else {
    // door: jambs and head, then the door itself
    add(box(fw, o.h, dep, COL.frame), o.s + fw / 2, o.h / 2, 0);
    add(box(fw, o.h, dep, COL.frame), o.s + o.w - fw / 2, o.h / 2, 0);
    add(box(o.w, fw, dep, COL.frame), cx, o.h - fw / 2, 0);
    const lw = o.w - 2 * fw, lh = o.h - fw;
    const knob = (x) => { for (const z of [-34, 34]) { const k = new THREE.Mesh(new THREE.SphereGeometry(30, 14, 10), mat(COL.knob, { metal: 0.6, rough: 0.35 })); add(k, x, 960, z); } };
    const hingeL = !o.hingeR;
    if (P.kind === "single" || P.kind === "front") {
      add(box(lw, lh, 44, COL.door), cx, lh / 2, 0);
      if (P.kind === "front") { for (const yy of [lh * 0.28, lh * 0.7]) for (const zz of [-24, 24]) add(box(lw * 0.62, lh * 0.32, 6, COL.door, { rough: 0.6 }), cx, yy, zz); }
      knob(hingeL ? o.s + o.w - fw - 70 : o.s + fw + 70);
    } else if (P.kind === "double") {
      for (const k of [-1, 1]) add(box(lw / 2 - 4, lh, 44, COL.door), cx + k * lw / 4, lh / 2, 0);
      knob(cx - 70); knob(cx + 70);
    } else if (P.kind === "bifold") {
      for (let i = 0; i < 4; i++) add(box(lw / 4 - 6, lh, 32, COL.door), o.s + fw + (i + 0.5) * lw / 4, lh / 2, (i % 2 ? 8 : -8));
    } else if (P.kind === "slider") {
      for (const k of [-1, 1]) {
        const px = cx + k * lw / 4, pz = k * 22;
        add(box(lw / 2 + 20, 50, 40, COL.frame), px, lh - 25, pz); add(box(lw / 2 + 20, 50, 40, COL.frame), px, 25, pz);
        add(box(50, lh, 40, COL.frame), px - lw / 4 + 15, lh / 2, pz); add(box(50, lh, 40, COL.frame), px + lw / 4 - 15, lh / 2, pz);
        add(box(lw / 2 - 80, lh - 100, 6, COL.glass, { glass: true }), px, lh / 2, pz);
      }
    } else if (P.kind === "garage") {
      add(box(lw, lh, 50, COL.garage), cx, lh / 2, 0);
      for (let i = 1; i < 4; i++) for (const z of [-27, 27]) add(box(lw, 14, 4, "#c9c5bd"), cx, (lh * i) / 4, z);
    }
    // the door swing, drawn on the floor (plan symbol)
    if (P.kind === "single" || P.kind === "front" || P.kind === "double") {
      const pts = [], R = P.kind === "double" ? lw / 2 : lw;
      const hinges = P.kind === "double" ? [[o.s + fw, 1], [o.s + o.w - fw, -1]] : [[hingeL ? o.s + fw : o.s + o.w - fw, hingeL ? 1 : -1]];
      const sw = o.swing === "b" ? 1 : -1;
      for (const [hx, dir] of hinges) {
        const arc = [];
        for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; arc.push(new THREE.Vector3(hx + dir * R * Math.cos(a), 4, sw * (t / 2 + R * Math.sin(a)))); }
        arc.push(new THREE.Vector3(hx, 4, sw * (t / 2 + R)), new THREE.Vector3(hx, 4, sw * t / 2));
        pts.push(arc);
      }
      for (const arc of pts) {
        const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), new THREE.LineBasicMaterial({ color: 0x56657a }));
        ln.applyMatrix4(B);
        g.add(ln);
      }
    }
  }
  g.traverse((m) => { if (m.isMesh) m.userData.pick = { k: "open", id: o.id }; });
  return g;
}
// roof solid (for display): the footprint with its overhang, the slope from the pitch
export function roofParts(r, z0) {
  const o = r.over || 0, x0 = Math.min(r.x0, r.x1) - o, x1 = Math.max(r.x0, r.x1) + o, y0 = Math.min(r.y0, r.y1) - o, y1 = Math.max(r.y0, r.y1) + o;
  const W = x1 - x0, Dd = y1 - y0, tp = Math.tan((Math.max(1, Math.min(75, r.pitch || 30)) * Math.PI) / 180);
  const along = r.dir === "x" ? "x" : "y"; // the ridge runs along
  const span = along === "y" ? W : Dd, run = along === "y" ? Dd : W;
  let H;
  if (r.kind === "flat") H = r.thick || 200;
  else if (r.kind === "shed") H = span * tp;
  else if (r.kind === "pyramid") H = (Math.min(W, Dd) / 2) * tp;
  else if (r.kind === "hip") H = (Math.min(W, Dd) / 2) * tp;
  else H = (span / 2) * tp;
  return { x0, x1, y0, y1, W, D: Dd, H, z0, along, span, run, tp };
}
function roofGeometry(r, z0) {
  const q = roofParts(r, z0), { x0, x1, y0, y1, H } = q, zt = z0 + H, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (r.kind === "hip" || r.kind === "pyramid") {
    const b = [V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0)], faces = [[b[3], b[2], b[1], b[0]]];
    if (r.kind === "pyramid") { const apex = V(xm, ym, zt); for (let i = 0; i < 4; i++) faces.push([b[i], b[(i + 1) % 4], apex]); return polyGeo(faces); }
    const d = Math.min(q.W, q.D) / 2;
    if (q.W >= q.D) { const ra = V(x0 + d, ym, zt), rb = V(x1 - d, ym, zt); faces.push([b[0], b[1], rb, ra], [b[1], b[2], rb], [b[2], b[3], ra, rb], [b[3], b[0], ra]); }
    else { const ra = V(xm, y0 + d, zt), rb = V(xm, y1 - d, zt); faces.push([b[0], b[1], ra], [b[1], b[2], rb, ra], [b[2], b[3], rb], [b[3], b[0], ra, rb]); }
    return polyGeo(faces);
  }
  // gable, shed, barrel and flat roofs are prisms: a cross-section (across the ridge) run along it
  const span = q.span, sh = new THREE.Shape();
  if (r.kind === "flat") { sh.moveTo(0, 0); sh.lineTo(span, 0); sh.lineTo(span, H); sh.lineTo(0, H); }
  else if (r.kind === "shed") { const hi = r.flip ? span : 0; sh.moveTo(0, 0); sh.lineTo(span, 0); sh.lineTo(hi, H); }
  else if (r.kind === "barrel") { sh.moveTo(0, 0); sh.lineTo(span, 0); sh.absellipse(span / 2, 0, span / 2, H, 0, Math.PI, false); }
  else { sh.moveTo(0, 0); sh.lineTo(span, 0); sh.lineTo(span / 2, H); }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: q.run, bevelEnabled: false, curveSegments: 36 });
  // section x → across, section y → up, extrusion → along the ridge (kept right-handed)
  const M = q.along === "y" ? new THREE.Matrix4().set(1, 0, 0, x0, 0, 0, -1, y1, 0, 1, 0, z0, 0, 0, 0, 1) : new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, y0, 0, 1, 0, z0, 0, 0, 0, 1);
  g.applyMatrix4(M);
  return g;
}
// flat-shaded geometry from planar polygons (outward winding)
function polyGeo(faces) {
  const pos = [];
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) for (const p of [f[0], f[i], f[i + 1]]) pos.push(p.x, p.y, p.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ to Beginner / Advanced
// The building as real shapes: per level, the walls (one shape: wall boxes joined, the doors and
// windows cut out), doors, window frames, glass, floors and each roof, made from the app's own
// shapes so they stay editable. k = 1 / scale.
export function buildingBodies(A, opt) {
  const k = 1 / (opt.scale || 1), out = [];
  const R = (x, y, z, ang = 0, pre = null) => {
    const m = new THREE.Matrix4().makeTranslation(x * k, y * k, z * k).multiply(new THREE.Matrix4().makeRotationZ(ang));
    if (pre) m.multiply(pre);
    return m.elements.slice();
  };
  const prim = (kind, p, m, hole) => {
    const q = {}; for (const [kk, v] of Object.entries(p)) q[kk] = ["w", "d", "h", "wall"].includes(kk) ? Math.max(0.05, v * k) : v;
    return { node: { t: "prim", kind, p: q, mods: [] }, m, ...(hole ? { hole: true } : {}) };
  };
  // a box in a wall's frame: along u, across n, bottom at z
  const wbox = (w, elev, u, n, z, sx, sn, sz, hole) => {
    const { ux, uy, nx, ny } = winfo(w), ang = Math.atan2(uy, ux);
    return prim("box", { w: sx, d: sn, h: sz }, R(w.a[0] + ux * u + nx * n, w.a[1] + uy * u + ny * n, elev + z, ang), hole);
  };
  const round = (w, elev, o, kind, p, depth) => {
    const { ux, uy, nx, ny } = winfo(w), ang = Math.atan2(uy, ux), u = o.s + o.w / 2, r = Math.min(o.w, o.h) / 2;
    const pre = new THREE.Matrix4().makeTranslation(0, (depth / 2) * k, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    return prim(kind, { ...p, h: depth }, R(w.a[0] + ux * u, w.a[1] + uy * u, elev + o.sill + r, ang, pre));
  };
  const body = (name, color, children, extra = {}) => { if (children.length) out.push({ name, color, node: { t: "group", children, mods: [], ...extra } }); };
  const multi = A.levels.length > 1;
  for (const L of A.levels) {
    const walls = A.walls.filter((w) => w.lvl === L.id && (w.h || 0) > 0);
    const tag = multi ? " · " + L.name : "";
    if (opt.walls) {
      const kids = [];
      for (const w of walls) {
        const e = wallExt(A.walls, w), { L: len } = winfo(w);
        kids.push(wbox(w, L.elev, (len + e[1] - e[0]) / 2, 0, 0, len + e[0] + e[1], w.t, w.h));
      }
      for (const w of walls) for (const o of goodOpenings(A, w).ok) {
        if (PRESETS[o.preset]?.kind === "round") { const c = round(w, L.elev, o, "cylinder", { w: Math.min(o.w, o.h), d: Math.min(o.w, o.h) }, w.t + 4); c.hole = true; kids.push(c); }
        else kids.push(wbox(w, L.elev, o.s + o.w / 2, 0, o.sill < 1 ? -2 : o.sill, o.w, w.t + 4, o.sill < 1 ? o.h + 2 : o.h, true));
      }
      body("Walls" + tag, COL.wall, kids);
    }
    const doors = [], frames = [], glass = [];
    for (const w of walls) for (const o of goodOpenings(A, w).ok) {
      const P = PRESETS[o.preset] || {}, fw = Math.min(55, o.w * 0.08), dep = w.t + 24, E = L.elev, cx = o.s + o.w / 2;
      if (P.kind === "round") {
        const r = Math.min(o.w, o.h);
        frames.push(round(w, E, o, "tube", { w: r, d: r, wall: fw }, dep));
        glass.push(round(w, E, o, "cylinder", { w: r - fw, d: r - fw }, 6));
      } else if (o.k === "window") {
        frames.push(wbox(w, E, o.s + fw / 2, 0, o.sill, fw, dep, o.h), wbox(w, E, o.s + o.w - fw / 2, 0, o.sill, fw, dep, o.h), wbox(w, E, cx, 0, o.sill + o.h - fw, o.w - 2 * fw, dep, fw), wbox(w, E, cx, 0, o.sill, o.w - 2 * fw, dep, fw));
        frames.push(wbox(w, E, cx, (o.flip ? -1 : 1) * 10, o.sill - 32, o.w + 90, w.t + 70, 32));
        if (P.kind === "hung") frames.push(wbox(w, E, cx, 0, o.sill + o.h / 2 - 21, o.w - 2 * fw, 60, 42));
        if (P.kind === "slider" || (P.kind === "casement" && o.w > 900)) frames.push(wbox(w, E, cx, 0, o.sill + fw, 42, 60, o.h - 2 * fw));
        glass.push(wbox(w, E, cx, 0, o.sill + fw, o.w - 2 * fw, 6, o.h - 2 * fw));
      } else {
        doors.push(wbox(w, E, o.s + fw / 2, 0, 0, fw, dep, o.h), wbox(w, E, o.s + o.w - fw / 2, 0, 0, fw, dep, o.h), wbox(w, E, cx, 0, o.h - fw, o.w - 2 * fw, dep, fw));
        const lw = o.w - 2 * fw, lh = o.h - fw;
        if (P.kind === "single" || P.kind === "front" || P.kind === "garage") doors.push(wbox(w, E, cx, 0, 0, lw, P.kind === "garage" ? 50 : 44, lh));
        else if (P.kind === "double") for (const s of [-1, 1]) doors.push(wbox(w, E, cx + s * lw / 4, 0, 0, lw / 2 - 4, 44, lh));
        else if (P.kind === "bifold") for (let i = 0; i < 4; i++) doors.push(wbox(w, E, o.s + fw + (i + 0.5) * lw / 4, 0, 0, lw / 4 - 6, 32, lh));
        else if (P.kind === "slider") { for (const s of [-1, 1]) { doors.push(wbox(w, E, cx + s * lw / 4, s * 22, 0, lw / 2 + 20, 40, 50), wbox(w, E, cx + s * lw / 4, s * 22, lh - 50, lw / 2 + 20, 40, 50)); glass.push(wbox(w, E, cx + s * lw / 4, s * 22, 50, lw / 2 - 80, 6, lh - 100)); } }
      }
    }
    if (opt.doors) body("Doors" + tag, COL.door, doors);
    if (opt.windows) body("Window frames" + tag, COL.frame, frames);
    if (opt.glass) body("Glass" + tag, COL.glass, glass);
    if (opt.floors) for (const s of A.slabs.filter((q) => q.lvl === L.id)) {
      const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1), th = s.thick || 150;
      body("Floor" + tag, COL.slab, [prim("box", { w: x1 - x0, d: y1 - y0, h: th }, R((x0 + x1) / 2, (y0 + y1) / 2, L.elev - th))]);
    }
    if (opt.roof) for (const r of A.roofs.filter((q) => q.lvl === L.id)) {
      const z0 = L.elev + (r.z ?? levelTop(A, L.id)), q = roofParts(r, z0), xm = (q.x0 + q.x1) / 2, ym = (q.y0 + q.y1) / 2;
      const name = (ROOFS.find((x) => x.id === r.kind) || { name: "Roof" }).name + " roof" + tag;
      const rot = q.along === "x" ? Math.PI / 2 : 0;
      if (r.kind === "flat") body(name, COL.roof, [prim("box", { w: q.W, d: q.D, h: q.H }, R(xm, ym, z0))]);
      else if (r.kind === "gable") body(name, COL.roof, [prim("roof", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot))]);
      else if (r.kind === "barrel") body(name, COL.roof, [prim("roundroof", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot))]);
      else if (r.kind === "pyramid") body(name, COL.roof, [prim("pyramid", { w: q.W, d: q.D, h: q.H, sides: 4 }, R(xm, ym, z0))]);
      else if (r.kind === "shed") body(name, COL.roof, [prim("wedge", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot + (r.flip ? Math.PI : 0)))]);
      else if (r.kind === "hip") body(name, COL.roof, [prim("roof", { w: q.W, d: q.D, h: (q.W / 2) * q.tp }, R(xm, ym, z0)), prim("roof", { w: q.D, d: q.W, h: (q.D / 2) * q.tp }, R(xm, ym, z0, Math.PI / 2))], { op: "intersect" });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the mode
export function initArch(app) {
  const vp = app.vp;
  const $ = (id) => document.getElementById(id);
  const ribbon = $("ribbon"), vpEl = $("viewport");
  const root = new THREE.Group(), ov = new THREE.Group();
  root.visible = ov.visible = false;
  vp.world.add(root); vp.world.add(ov);
  const panel = el("div", { class: "float inspector arch-panel", id: "arch-panel", hidden: true });
  const elev = el("div", { class: "float arch-elev", id: "arch-elev", hidden: true });
  const labels = el("div", { class: "vp-labels arch-labels" });
  vpEl.append(panel, elev, labels);
  const st = { tool: "select", sel: null, level: "L1", draft: null, hover: null, preset: { door: "int32", window: "sh3648" }, roof: { kind: "gable", pitch: 26.6, over: 300, dir: "y", flip: false, thick: 200 }, xray: true, others: true, autoRaise: false, drag: null, typed: "", plan: false };
  let active = false;
  // ------------------------------------------------------------ data
  const A = () => store.view.arch;
  const AC = () => store.doc.arch; // committed (not the live preview)
  function ensure() {
    if (!store.doc.arch) { store.doc.arch = defaults(); app.projects && app.projects.changed && app.projects.changed(); }
    const a = store.doc.arch;
    if (!a.levels.some((l) => l.id === st.level)) st.level = a.levels[0].id;
  }
  const levelOf = (id) => A().levels.find((l) => l.id === id) || A().levels[0];
  const cur = () => levelOf(st.level);
  const wallById = (id, a = A()) => a.walls.find((w) => w.id === id);
  const openById = (id, a = A()) => a.openings.find((o) => o.id === id);
  const update = (fn, label) => store.update((doc) => { if (!doc.arch) doc.arch = defaults(); return fn(doc.arch, doc); }, label);
  const preview = (fn) => store.setPreview((doc) => fn(doc.arch, doc));
  const gridStep = () => A().grid || (isInch() ? 6 * IN : 100);
  // move every wall end that sits on p0 to p1 (corners stay joined)
  function moveEnds(a, lvl, p0, p1, skip) {
    for (const w of a.walls) {
      if (w.lvl !== lvl || (skip && skip.has(w.id))) continue;
      if (near(w.a, p0)) w.a = [p1[0], p1[1]];
      if (near(w.b, p0)) w.b = [p1[0], p1[1]];
    }
  }
  // ------------------------------------------------------------ drawing the building
  const meshes = { walls: new Map(), opens: new Map(), roofs: new Map(), slabs: new Map() };
  function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData.own) o.material.dispose(); }); } }
  function rebuild() {
    if (!active) return;
    clearGroup(root);
    for (const m of Object.values(meshes)) m.clear();
    const a = A(); if (!a) return;
    const selWall = st.sel && (st.sel.k === "wall" ? st.sel.id : st.sel.k === "open" ? openById(st.sel.id)?.wall : null);
    for (const L of a.levels) {
      const curL = L.id === st.level;
      if (!curL && !st.others) continue;
      for (const w of a.walls.filter((q) => q.lvl === L.id)) {
        const ext = wallExt(a.walls, w);
        const m = (w.h || 0) > 0 ? wallMesh(a, w, L.elev, ext) : planWallMesh(w, L.elev, ext);
        m.material.userData.own = true;
        root.add(m); meshes.walls.set(w.id, m);
        m.userData.level = L.id;
        if ((w.h || 0) > 0) for (const o of goodOpenings(a, w).ok) { const g = openingModel(o, w, L.elev); g.userData.level = L.id; root.add(g); meshes.opens.set(o.id, g); }
      }
      for (const s of a.slabs.filter((q) => q.lvl === L.id)) {
        const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1), th = s.thick || 150;
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, th), mat(COL.slab).clone());
        m.material.userData.own = true; m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, L.elev - th / 2);
        m.userData.pick = { k: "slab", id: s.id }; m.userData.level = L.id;
        root.add(m); meshes.slabs.set(s.id, m);
      }
      for (const r of a.roofs.filter((q) => q.lvl === L.id)) {
        const m = new THREE.Mesh(roofGeometry(r, L.elev + (r.z ?? levelTop(a, L.id))), mat(COL.roof).clone());
        m.material.userData.own = true; m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
        m.userData.pick = { k: "roof", id: r.id }; m.userData.level = L.id;
        root.add(m); meshes.roofs.set(r.id, m);
      }
    }
    // see-through: while a wall (or one of its doors and windows) is being edited, everything else
    // fades away; other levels are always a little faded
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      let op = 1;
      const pk = o.userData.pick, lvl = o.userData.level || (o.parent && o.parent.userData.level);
      if (lvl && lvl !== st.level) op = 0.35;
      if (st.plan && pk && pk.k === "roof") op = Math.min(op, 0.12);
      if (selWall && st.xray) {
        const mine = (pk && pk.k === "wall" && pk.id === selWall) || (pk && pk.k === "open" && openById(pk.id)?.wall === selWall);
        if (!mine) op = Math.min(op, 0.12);
      }
      if (op < 1) {
        if (!o.material.userData.own) { o.material = o.material.clone(); o.material.userData.own = true; o.material.userData.base = { transparent: o.material.transparent, opacity: o.material.opacity, depthWrite: o.material.depthWrite }; }
        o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity, op); o.material.depthWrite = false;
        o.renderOrder = 2;
      }
    });
    // the selection
    if (st.sel) {
      const m = st.sel.k === "wall" ? meshes.walls.get(st.sel.id) : st.sel.k === "roof" ? meshes.roofs.get(st.sel.id) : st.sel.k === "slab" ? meshes.slabs.get(st.sel.id) : null;
      if (m) { m.material.emissive = new THREE.Color(0x1f4fa8); m.material.emissiveIntensity = 0.28; }
      if (st.sel.k === "open") { const g = meshes.opens.get(st.sel.id); g && g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.userData.own = true; o.material.emissive = new THREE.Color(0x1f4fa8); o.material.emissiveIntensity = 0.45; } }); }
    }
    drawOverlay();
    vp.request();
  }
  // ------------------------------------------------------------ overlay: drafts, snaps, guides, handles
  const lbls = [];
  function label(text, p, cls = "") { const d = el("div", { class: "vp-label arch-lbl " + cls }, text); labels.append(d); lbls.push({ d, p: p.clone() }); return d; }
  function placeLabels() { for (const { d, p } of lbls) { const q = vp.project(p); d.style.transform = `translate(${q[0]}px, ${q[1]}px) translate(-50%, -50%)`; d.hidden = q[2] > 1; } }
  vp.afterRender.add(() => { if (active) placeLabels(); });
  function line(pts, color = 0x1f4fa8, dashed = false) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 120, gapSize: 80, depthTest: false, transparent: true }) : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    const l = new THREE.Line(g, m); if (dashed) l.computeLineDistances(); l.renderOrder = 30; ov.add(l); return l;
  }
  function dot(p, color = 0x1f4fa8, size = 10) {
    const g = new THREE.BufferGeometry().setFromPoints([p]);
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true }));
    m.renderOrder = 31; ov.add(m);
  }
  function ghostBox(B, x, y, z, sx, sy, sz, color = 0x1f4fa8, op = 0.35) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false }));
    m.renderOrder = 29; inWall(m, B, x, y, z); ov.add(m); return m;
  }
  function drawOverlay() {
    clearGroup(ov); labels.replaceChildren(); lbls.length = 0;
    if (!active) return;
    const a = A(), L = cur(), z = L.elev + 6;
    const P3 = (p) => new THREE.Vector3(p[0], p[1], z);
    // wall ends you can drag (Select tool, selected wall)
    if (st.tool === "select" && st.sel && st.sel.k === "wall") { const w = wallById(st.sel.id); if (w) { dot(P3(w.a), 0xffffff, 13); dot(P3(w.a), 0x1f4fa8, 9); dot(P3(w.b), 0xffffff, 13); dot(P3(w.b), 0x1f4fa8, 9); const { L: len } = winfo(w); label(fmtLen(len), new THREE.Vector3((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, L.elev + Math.max(w.h || 0, 30) + 250), "measure"); } }
    if (st.plan) for (const w of a.walls.filter((q) => q.lvl === st.level)) { if (st.sel && st.sel.k === "wall" && st.sel.id === w.id) continue; const { L: len, nx, ny } = winfo(w); label(fmtLen(len), new THREE.Vector3((w.a[0] + w.b[0]) / 2 + nx * (w.t / 2 + 250), (w.a[1] + w.b[1]) / 2 + ny * (w.t / 2 + 250), L.elev + 50), "measure aux"); }
    const d = st.draft;
    if (d && (d.kind === "wall" || d.kind === "chain")) {
      const pts = d.pts.map(P3);
      if (d.cur) pts.push(P3(d.cur));
      if (pts.length > 1) line(pts, 0x1f4fa8);
      // the walls being drawn, as thick outlines
      const t = a.wallT;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
        if (len < 1) continue;
        const B = wallBasis({ a: [p.x, p.y], b: [q.x, q.y] }, L.elev);
        ghostBox(B, len / 2, 15, 0, len, 30, t, 0x1f4fa8, 0.25);
        label(fmtLen(len), p.clone().add(q).multiplyScalar(0.5).setZ(z + 200), i === pts.length - 2 ? "measure" : "measure aux");
      }
    }
    if (d && (d.kind === "room" || d.kind === "roofrect" || d.kind === "slabrect") && d.p0 && d.p1) {
      const [x0, y0] = d.p0, [x1, y1] = d.p1;
      line([P3([x0, y0]), P3([x1, y0]), P3([x1, y1]), P3([x0, y1]), P3([x0, y0])], d.kind === "room" ? 0x1f4fa8 : 0x8b4a3c);
      label(fmtLen(Math.abs(x1 - x0)), P3([(x0 + x1) / 2, y0]).setZ(z + 200), "measure");
      label(fmtLen(Math.abs(y1 - y0)), P3([x1, (y0 + y1) / 2]).setZ(z + 200), "measure");
    }
    if (st.snap) {
      const p = P3(st.snap.p);
      dot(p, st.snap.kind === "grid" || st.snap.kind === "free" ? 0x56657a : 0xe8a317, st.snap.kind === "free" ? 7 : 11);
      for (const g of st.snap.guides || []) line([P3(g[0]), P3(g[1])], 0xe8a317, true);
    }
    // a door or window about to be placed
    if (st.ghost) {
      const { w, s, preset } = st.ghost, P = PRESETS[preset], B = wallBasis(w, L.elev);
      const sill = P.sill ?? 0, ok = st.ghost.ok;
      ghostBox(B, s + P.w / 2, sill + P.h / 2, 0, P.w, P.h, w.t + 60, ok ? 0x1f4fa8 : 0xd9534f, 0.4);
      const { L: len } = winfo(w);
      label("← " + fmtLen(s), new THREE.Vector3().setFromMatrixPosition(B).add(new THREE.Vector3(winfo(w).ux * s / 2, winfo(w).uy * s / 2, sill + P.h + 200)), "measure aux");
      label(fmtLen(len - s - P.w) + " →", new THREE.Vector3().setFromMatrixPosition(B).add(new THREE.Vector3(winfo(w).ux * (s + P.w + (len - s - P.w) / 2), winfo(w).uy * (s + P.w + (len - s - P.w) / 2), sill + P.h + 200)), "measure aux");
    }
    if (st.typed && d) label("Length: " + st.typed + "▌  (Enter)", P3(d.cur || d.pts[d.pts.length - 1]).setZ(z + 600), "measure");
    vp.request();
  }
  // ------------------------------------------------------------ picking and snapping
  function groundAt(e) { return vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), -cur().elev)); }
  function pickPart(e, kinds) {
    const objs = [];
    root.traverse((o) => { if (o.isMesh && o.userData.pick && (!kinds || kinds.includes(o.userData.pick.k))) { const lvl = o.userData.level || (o.parent && o.parent.userData.level); if (lvl === st.level) objs.push(o); } });
    vp.ray(e);
    const hits = vp.raycaster.intersectObjects(objs, false);
    return hits.length ? { ...hits[0].object.userData.pick, point: hits[0].point } : null;
  }
  function snapAt(e, from, skipIds) {
    const g = groundAt(e);
    if (!g) return null;
    const a = A(), lvl = st.level, tol = vp.pixelSize(g) * vp.tol(12);
    let p = [g.x, g.y], kind = "free";
    const guides = [];
    const ws = a.walls.filter((w) => w.lvl === lvl && !(skipIds && skipIds.has(w.id)));
    const ends = []; for (const w of ws) ends.push(w.a, w.b);
    // ends of walls, then their middles
    let best = null, bd = tol;
    for (const q of ends) { const dd = D2(q, p); if (dd < bd) { bd = dd; best = q; } }
    if (st.draft && st.draft.pts && st.draft.pts.length > 2) { const q = st.draft.pts[0]; if (D2(q, p) < tol) best = q; }
    if (best) return { p: [best[0], best[1]], kind: "end", guides };
    for (const w of ws) { const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]; if (D2(m, p) < tol * 0.8) return { p: m, kind: "mid", guides }; }
    const snapOn = app.snapOn !== false && !e.altKey;
    // straight lines from the last point: 0, 45, 90°... (Shift: any angle)
    if (from && !e.shiftKey) {
      const dx = p[0] - from[0], dy = p[1] - from[1], len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), step = Math.PI / 4;
      const sa = Math.round(ang / step) * step;
      if (len > 1 && Math.abs(ang - sa) < 0.07) {
        let l2 = len * Math.cos(ang - sa);
        if (snapOn) l2 = Math.max(gridStep(), Math.round(l2 / gridStep()) * gridStep());
        p = [from[0] + Math.cos(sa) * l2, from[1] + Math.sin(sa) * l2]; kind = "angle";
        // line up with other wall ends along the way
        for (const q of ends) {
          if (Math.abs(Math.cos(sa)) > 0.99 && Math.abs(q[0] - p[0]) < tol) { p = [q[0], p[1]]; guides.push([q, p]); break; }
          if (Math.abs(Math.sin(sa)) > 0.99 && Math.abs(q[1] - p[1]) < tol) { p = [p[0], q[1]]; guides.push([q, p]); break; }
        }
        return { p, kind, guides };
      }
    }
    // line up with other wall ends
    let ax = false, ay = false;
    for (const q of ends) {
      if (!ax && Math.abs(q[0] - p[0]) < tol) { p = [q[0], p[1]]; ax = true; guides.push([q, null]); }
      if (!ay && Math.abs(q[1] - p[1]) < tol) { p = [p[0], q[1]]; ay = true; guides.push([q, null]); }
    }
    for (const gd of guides) gd[1] = [p[0], p[1]];
    if (snapOn) { const s = gridStep(); if (!ax) p[0] = Math.round(p[0] / s) * s; if (!ay) p[1] = Math.round(p[1] / s) * s; kind = ax || ay ? "align" : "grid"; }
    else if (ax || ay) kind = "align";
    return { p, kind, guides };
  }
  // ------------------------------------------------------------ tools
  function setTool(t) {
    if (st.draft && st.draft.kind === "chain" && st.draft.pts.length > 1) finishChain();
    st.tool = t; st.draft = null; st.ghost = null; st.snap = null; st.typed = "";
    // a standard overhang for the units in use (12" or 300 mm)
    if (Math.abs(st.roof.over - 300) < 0.01 && isInch()) st.roof.over = 12 * IN; else if (Math.abs(st.roof.over - 12 * IN) < 0.01 && !isInch()) st.roof.over = 300;
    if (t !== "select" && st.sel && st.sel.k !== "wall") st.sel = null;
    renderRibbon(); renderPanel(); rebuild(); app.status();
    vp.canvas.style.cursor = t === "select" ? "default" : "crosshair";
  }
  function select(sel) { st.sel = sel; rebuild(); renderPanel(); app.status(); }
  function newWall(a, p, q, h) { return { id: uid("w"), lvl: st.level, a: [p[0], p[1]], b: [q[0], q[1]], t: a.wallT, h: h ?? (st.autoRaise ? a.wallH : 0) }; }
  function finishChain() {
    const d = st.draft;
    st.draft = null; st.typed = "";
    if (!d || d.pts.length < 2) { drawOverlay(); return; }
    const pts = d.pts;
    update((a) => { for (let i = 0; i + 1 < pts.length; i++) if (D2(pts[i], pts[i + 1]) > 1) a.walls.push(newWall(a, pts[i], pts[i + 1])); }, pts.length > 2 ? "Draw walls" : "Draw wall");
  }
  function addChainPoint(p) {
    const d = st.draft;
    if (!d) { st.draft = { kind: "chain", pts: [p], cur: p }; drawOverlay(); return; }
    const last = d.pts[d.pts.length - 1];
    if (D2(last, p) < 1) { finishChain(); return; }
    d.pts.push(p);
    // back at the start: the room is closed
    if (d.pts.length > 3 && near(p, d.pts[0], 1)) { finishChain(); return; }
    drawOverlay();
  }
  function roomWalls(p0, p1) {
    const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]), y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
    if (x1 - x0 < 300 || y1 - y0 < 300) { app.toast("Make the room bigger: drag from one corner to the other."); return; }
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    update((a) => { for (let i = 0; i < 4; i++) a.walls.push(newWall(a, c[i], c[(i + 1) % 4])); }, "Draw room");
  }
  // the walls' outline on this level (outside faces), for a roof or floor that covers everything
  function levelRect(lvl = st.level) {
    const ws = A().walls.filter((w) => w.lvl === lvl);
    if (!ws.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of ws) for (const p of [w.a, w.b]) { x0 = Math.min(x0, p[0] - w.t / 2); y0 = Math.min(y0, p[1] - w.t / 2); x1 = Math.max(x1, p[0] + w.t / 2); y1 = Math.max(y1, p[1] + w.t / 2); }
    return { x0, y0, x1, y1 };
  }
  function addRoof(rect) {
    if (!rect) { app.toast("Draw some walls first: the roof covers them."); return; }
    const r = { id: uid("r"), lvl: st.level, kind: st.roof.kind, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, pitch: st.roof.pitch, over: st.roof.over, dir: st.roof.dir, flip: st.roof.flip, thick: st.roof.thick };
    update((a) => { a.roofs.push(r); }, "Add roof");
    st.sel = { k: "roof", id: r.id }; st.tool = "select"; renderRibbon(); renderPanel(); rebuild();
  }
  function addSlab(rect) {
    if (!rect) { app.toast("Draw some walls first: the floor goes under them."); return; }
    const s = { id: uid("s"), lvl: st.level, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, thick: isInch() ? 6 * IN : 150 };
    update((a) => { a.slabs.push(s); }, "Add floor");
    st.sel = { k: "slab", id: s.id }; st.tool = "select"; renderRibbon(); renderPanel(); rebuild();
  }
  // walls grow to their height, a little at a time
  function raiseWalls(ids, h) {
    const a0 = A(), from = new Map(a0.walls.filter((w) => ids.includes(w.id)).map((w) => [w.id, w.h || 0]));
    if (!from.size) { app.toast("Draw some walls first."); return; }
    const t0 = performance.now(), T = 450;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / T), e = 1 - Math.pow(1 - k, 3);
      if (k < 1) { preview((a) => { for (const w of a.walls) if (from.has(w.id)) w.h = Math.max(1, from.get(w.id) + (h - from.get(w.id)) * e); }); requestAnimationFrame(step); }
      else update((a) => { for (const w of a.walls) if (from.has(w.id)) w.h = h; a.wallH = h; }, "Raise walls");
    };
    step();
  }
  // where along a wall a door or window would go, for a point on (or near) it
  function placeOn(w, point, P) {
    const { L, ux, uy } = winfo(w), a = A();
    const u = (point.x - w.a[0]) * ux + (point.y - w.a[1]) * uy;
    let s = u - P.w / 2;
    const tol = vp.pixelSize(point) * vp.tol(14), grid = gridStep();
    if (Math.abs(u - L / 2) < tol) s = L / 2 - P.w / 2;
    else if (app.snapOn !== false) s = Math.round(s / grid) * grid;
    const edge = Math.min(100, Math.max(0, (L - P.w) / 2));
    s = Math.max(edge, Math.min(L - P.w - edge, s));
    const sill = P.sill ?? 0, h = (w.h || 0) > 0 ? w.h : a.wallH;
    const fits = L >= P.w + 20 && sill + P.h <= h - 10 && !a.openings.some((o) => o.wall === w.id && s < o.s + o.w + 20 && o.s < s + P.w + 20 && sill < o.sill + o.h + 20 && o.sill < sill + P.h + 20);
    return { w, s, preset: P.id, ok: fits };
  }
  function placeOpening(g) {
    const P = PRESETS[g.preset], a = A(), w = wallById(g.w.id);
    if (!g.ok) { app.toast(winfo(w).L < P.w + 20 ? "That wall is too short for this " + (P.sill === undefined ? "door." : "window.") : "It would overlap another door or window, or not fit under the top of the wall."); return; }
    const o = { id: uid("o"), wall: w.id, k: P.sill === undefined ? "door" : "window", preset: P.id, s: g.s, w: P.w, h: P.h, sill: P.sill ?? 0 };
    const flat = a.walls.filter((q) => q.lvl === w.lvl && !(q.h > 0));
    update((aa) => {
      aa.openings.push(o);
      // doors and windows need walls: flat (plan) walls are raised to the wall height first
      for (const q of aa.walls) if (q.lvl === w.lvl && !(q.h > 0)) q.h = aa.wallH;
    }, "Add " + P.name.toLowerCase());
    if (flat.length) app.toast(`Raised the walls to ${fmtLen(a.wallH)} so the ${o.k} fits. Change the height with Raise walls.`);
    return o.id;
  }
  function deleteSel() {
    const s = st.sel;
    if (!s) return false;
    update((a) => {
      if (s.k === "wall") { a.walls = a.walls.filter((w) => w.id !== s.id); a.openings = a.openings.filter((o) => o.wall !== s.id); }
      if (s.k === "open") a.openings = a.openings.filter((o) => o.id !== s.id);
      if (s.k === "roof") a.roofs = a.roofs.filter((r) => r.id !== s.id);
      if (s.k === "slab") a.slabs = a.slabs.filter((r) => r.id !== s.id);
    }, "Delete " + { wall: "wall", open: "door or window", roof: "roof", slab: "floor" }[s.k]);
    st.sel = null; renderPanel(); rebuild();
    return true;
  }
  // ------------------------------------------------------------ pointer
  const handler = {
    // touch: a finger drags when it starts on something to drag (otherwise it turns the view)
    wantsTouch(e) {
      if (["room", "roof", "floor"].includes(st.tool)) return true;
      if (st.tool !== "select") return false;
      if (endHandleAt(e)) return true;
      const h = pickPart(e);
      return !!(h && st.sel && h.id === st.sel.id);
    },
    hover(e) {
      if (st.drag) return;
      const t = st.tool;
      if (t === "wall") { const last = st.draft && st.draft.pts[st.draft.pts.length - 1]; st.snap = snapAt(e, last); if (st.draft && st.snap) st.draft.cur = st.snap.p; drawOverlay(); return; }
      if (t === "room" || t === "roof" || t === "floor") { st.snap = snapAt(e, null); if (st.draft && st.draft.p0 && st.snap && st.draft.waiting) st.draft.p1 = st.snap.p; drawOverlay(); return; }
      if (t === "door" || t === "window") {
        const h = pickPart(e, ["wall", "open"]);
        const wid = h ? (h.k === "wall" ? h.id : openById(h.id)?.wall) : null, w = wid && wallById(wid);
        st.ghost = w ? placeOn(w, h.point, PRESETS[st.preset[t]]) : null;
        vp.canvas.style.cursor = w ? (st.ghost.ok ? "copy" : "not-allowed") : "crosshair";
        drawOverlay(); return;
      }
      // select: point at what can be picked
      const h = pickPart(e);
      const endHit = endHandleAt(e);
      vp.canvas.style.cursor = endHit ? "grab" : h ? "pointer" : "default";
    },
    down(e) {
      const t = st.tool;
      if (t === "wall") { const last = st.draft && st.draft.pts[st.draft.pts.length - 1]; const s = snapAt(e, last); if (s) addChainPoint(s.p); return true; }
      if (t === "room" || t === "roof" || t === "floor") {
        const s = snapAt(e, null); if (!s) return true;
        if (st.draft && st.draft.waiting) { finishRect(st.draft.p0, s.p); return true; }
        st.draft = { kind: t === "room" ? "room" : t === "roof" ? "roofrect" : "slabrect", p0: s.p, p1: s.p, sx: e.clientX, sy: e.clientY };
        st.drag = { k: "rect" };
        drawOverlay(); return true;
      }
      if (t === "door" || t === "window") { if (st.ghost) placeOpening(st.ghost); return true; }
      // select tool
      const eh = endHandleAt(e);
      if (eh) { st.drag = { k: "end", w: eh.w, p0: eh.p, moved: false }; return true; }
      const h = pickPart(e);
      if (!h) { if (st.sel) select(null); return true; }
      if (h.k === "wall") {
        select({ k: "wall", id: h.id });
        const g = groundAt(e);
        st.drag = { k: "wallmove", id: h.id, g0: g ? [g.x, g.y] : null, sx: e.clientX, sy: e.clientY, moved: false };
      } else if (h.k === "open") {
        select({ k: "open", id: h.id });
        const o = openById(h.id), w = wallById(o.wall), { ux, uy } = winfo(w);
        st.drag = { k: "openmove", id: h.id, u0: (h.point.x - w.a[0]) * ux + (h.point.y - w.a[1]) * uy, s0: o.s, sx: e.clientX, sy: e.clientY, moved: false };
      } else select({ k: h.k, id: h.id });
      return true;
    },
    move(e) {
      const d = st.drag;
      if (!d) return;
      if (d.k === "rect") { const s = snapAt(e, null); if (s) { st.draft.p1 = s.p; st.snap = s; drawOverlay(); } return; }
      if (d.k === "end") {
        const w = wallById(d.w, AC()), other = near(w.a, d.p0) ? w.b : w.a;
        const s = snapAt(e, other, new Set(AC().walls.filter((q) => near(q.a, d.p0) || near(q.b, d.p0)).map((q) => q.id)));
        if (!s) return;
        st.snap = s; d.p1 = s.p; d.moved = true;
        preview((a) => moveEnds(a, st.level, d.p0, s.p));
        return;
      }
      if (d.k === "wallmove") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
        const g = groundAt(e); if (!g || !d.g0) return;
        const w = wallById(d.id, AC()), { nx, ny } = winfo(w);
        let k = (g.x - d.g0[0]) * nx + (g.y - d.g0[1]) * ny;
        if (app.snapOn !== false && !e.altKey) k = Math.round(k / gridStep()) * gridStep();
        d.moved = true; d.k2 = k;
        preview((a) => { const ww = a.walls.find((q) => q.id === d.id); const a0 = w.a, b0 = w.b; const na = [a0[0] + nx * k, a0[1] + ny * k], nb = [b0[0] + nx * k, b0[1] + ny * k]; moveEnds(a, st.level, a0, na, new Set([d.id])); moveEnds(a, st.level, b0, nb, new Set([d.id])); ww.a = na; ww.b = nb; });
        return;
      }
      if (d.k === "openmove") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        const o = openById(d.id, AC()), w = wallById(o.wall, AC()), { L, ux, uy, nx, ny } = winfo(w);
        const pl = new THREE.Plane(new THREE.Vector3(nx, ny, 0), -(nx * w.a[0] + ny * w.a[1]));
        const p = vp.rayPlane(e, pl); if (!p) return;
        const u = (p.x - w.a[0]) * ux + (p.y - w.a[1]) * uy;
        let s = d.s0 + (u - d.u0);
        if (app.snapOn !== false && !e.altKey) s = Math.round(s / gridStep()) * gridStep();
        s = Math.max(0, Math.min(L - o.w, s));
        d.moved = true;
        preview((a) => { a.openings.find((q) => q.id === d.id).s = s; });
      }
    },
    up(e) {
      const d = st.drag; st.drag = null;
      if (!d) return;
      if (d.k === "rect") {
        const moved = Math.hypot(e.clientX - st.draft.sx, e.clientY - st.draft.sy) > 6;
        if (!moved) { st.draft.waiting = true; drawOverlay(); return; } // click, then click the other corner
        finishRect(st.draft.p0, st.draft.p1);
        return;
      }
      if (d.moved) store.commitPreview({ end: "Move wall end", wallmove: "Move wall", openmove: "Move " + (openById(d.id)?.k || "opening") }[d.k] || "Edit");
      else store.setPreview(null);
      st.snap = null; drawOverlay();
    },
    dblclick() { if (st.tool === "wall" && st.draft) finishChain(); },
    leave() { st.ghost = null; if (!st.draft) st.snap = null; drawOverlay(); },
    cancel() { st.drag = null; store.setPreview(null); },
  };
  function finishRect(p0, p1) {
    const d = st.draft; st.draft = null; st.snap = null;
    if (!d) return;
    if (d.kind === "room") roomWalls(p0, p1);
    else {
      // drawn from wall corner to wall corner: reach the outside faces
      const t = A().wallT / 2, rect = { x0: Math.min(p0[0], p1[0]) - t, y0: Math.min(p0[1], p1[1]) - t, x1: Math.max(p0[0], p1[0]) + t, y1: Math.max(p0[1], p1[1]) + t };
      if (rect.x1 - rect.x0 < 300 || rect.y1 - rect.y0 < 300) { app.toast("Drag across the area to cover, from one corner to the other."); drawOverlay(); return; }
      if (d.kind === "roofrect") addRoof(rect); else addSlab(rect);
    }
    drawOverlay();
  }
  function endHandleAt(e) {
    if (!st.sel || st.sel.k !== "wall") return null;
    const w = wallById(st.sel.id); if (!w) return null;
    const [mx, my] = vp.local(e), z = cur().elev;
    for (const p of [w.a, w.b]) { const q = vp.project(new THREE.Vector3(p[0], p[1], z)); if (Math.hypot(q[0] - mx, q[1] - my) < vp.tol(10)) return { w: w.id, p }; }
    return null;
  }
  // ------------------------------------------------------------ panel (right) and fields
  function lenField(value, onCommit, id, opts = {}) {
    const inp = el("input", { class: "num", id, value: fmtLen(value), "aria-label": opts.label || "" , spellcheck: "false" });
    let last = value;
    const commit = () => {
      const v = parseArch(inp.value);
      if (!isFinite(v) || (opts.min !== undefined && v < opts.min)) { inp.classList.add("bad"); return; }
      inp.classList.remove("bad");
      if (Math.abs(v - last) > 1e-6) { last = v; onCommit(v); } else inp.value = fmtLen(v);
    };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { commit(); inp.blur(); } if (e.key === "Escape") { inp.value = fmtLen(last); inp.blur(); } });
    inp.addEventListener("blur", commit);
    inp.addEventListener("focus", () => inp.select());
    return inp;
  }
  function numIn(value, onCommit, id, step = 1) {
    const inp = el("input", { class: "num", id, value: String(+(+value).toFixed(2)), inputmode: "decimal" });
    const commit = () => { const v = parseFloat(inp.value); if (!isFinite(v)) { inp.classList.add("bad"); return; } inp.classList.remove("bad"); if (v !== value) { value = v; onCommit(v); } };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { commit(); inp.blur(); } if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); inp.value = String(+(parseFloat(inp.value || 0) + (e.key === "ArrowUp" ? step : -step)).toFixed(2)); commit(); } });
    inp.addEventListener("blur", commit);
    return inp;
  }
  const row = (label, ctl) => el("div", { class: "row" }, el("label", {}, label), ctl);
  const seg = (opts, value, on, id) => el("div", { class: "seg", id }, ...opts.map(([v, l]) => el("button", { "aria-pressed": String(v === value), onclick: () => on(v) }, l)));
  const chips = (list, on) => el("div", { class: "arch-chips" }, ...list.map(([l, v]) => el("button", { class: "btn", onclick: () => on(v) }, l)));
  function head(title, sub) { return el("header", {}, el("h4", {}, title), sub ? el("span", { class: "arch-sub" }, sub) : null); }
  function presetSVG(P) {
    const W = 44, H = 44, sc = 36 / Math.max(P.w, (P.sill ?? 0) + P.h, 1200), x0 = (W - P.w * sc) / 2, base = 40;
    const y1 = base - ((P.sill ?? 0) + P.h) * sc, hh = P.h * sc, ww = P.w * sc;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="44" height="44" aria-hidden="true"><rect x="2" y="2" width="40" height="38" rx="3" fill="var(--panel-2)"/><line x1="2" y1="${base}" x2="42" y2="${base}" stroke="var(--ink-3)" stroke-width="1"/>`;
    if (P.kind === "round") s += `<circle cx="22" cy="${y1 + hh / 2}" r="${hh / 2}" fill="#bfe3f6" stroke="var(--ink-2)" stroke-width="1.2"/>`;
    else if (P.sill !== undefined) s += `<rect x="${x0}" y="${y1}" width="${ww}" height="${hh}" fill="#bfe3f6" stroke="var(--ink-2)" stroke-width="1.2"/>` + (P.kind === "hung" ? `<line x1="${x0}" y1="${y1 + hh / 2}" x2="${x0 + ww}" y2="${y1 + hh / 2}" stroke="var(--ink-2)"/>` : P.kind === "slider" || P.kind === "casement" ? `<line x1="${22}" y1="${y1}" x2="22" y2="${y1 + hh}" stroke="var(--ink-2)"/>` : "");
    else s += `<rect x="${x0}" y="${y1}" width="${ww}" height="${hh}" fill="${P.kind === "opening" ? "none" : P.kind === "garage" ? "#e9e7e2" : P.kind === "slider" ? "#bfe3f6" : "#c9a27a"}" stroke="var(--ink-2)" stroke-width="1.2" ${P.kind === "opening" ? 'stroke-dasharray="2 2"' : ""}/>` + (P.kind === "double" || P.kind === "slider" ? `<line x1="22" y1="${y1}" x2="22" y2="${base}" stroke="var(--ink-2)"/>` : P.kind === "garage" ? [1, 2, 3].map((i) => `<line x1="${x0}" y1="${y1 + hh * i / 4}" x2="${x0 + ww}" y2="${y1 + hh * i / 4}" stroke="var(--ink-3)"/>`).join("") : P.kind === "single" || P.kind === "front" ? `<circle cx="${x0 + ww - 3}" cy="${y1 + hh * 0.55}" r="1.2" fill="var(--ink-2)"/>` : "");
    return s + "</svg>";
  }
  const roofSVG = (k) => {
    const p = { gable: "M4 30 L22 10 L40 30 Z", hip: "M4 30 L14 14 L30 14 L40 30 Z", shed: "M4 30 L4 12 L40 24 L40 30 Z", pyramid: "M6 30 L22 8 L38 30 Z", barrel: "M4 30 C4 12 40 12 40 30 Z", flat: "M4 30 L4 22 L40 22 L40 30 Z" }[k];
    return `<svg viewBox="0 0 44 36" width="44" height="36" aria-hidden="true"><path d="${p}" fill="#a85b48" stroke="var(--ink-2)" stroke-width="1.2" stroke-linejoin="round"/><rect x="8" y="30" width="28" height="4" fill="var(--ink-3)"/></svg>`;
  };
  function renderPanel() {
    if (!active) { panel.hidden = true; elev.hidden = true; return; }
    if (panel.contains(document.activeElement) && document.activeElement.tagName === "INPUT") { panel.dataset.stale = "1"; }
    panel.replaceChildren();
    panel.hidden = false;
    const a = A(), body = el("div", { class: "body" });
    const t = st.tool, s = st.sel;
    if (t === "wall" || t === "room") {
      panel.append(head(t === "wall" ? "Draw walls" : "Draw a room"));
      body.append(el("p", { class: "arch-hint" }, t === "wall" ? "Click to start a wall, click again for each corner. Double-click, press Enter or click the first point again to finish. Type a length (like 12' or 3600) and press Enter for an exact wall." : "Drag from one corner of the room to the opposite corner (or click both corners). It makes four walls."));
      body.append(row("Wall type", wallTypeSelect(a.wallT, (v) => update((aa) => { aa.wallT = v; }, "Wall thickness"))));
      body.append(row("Thickness", lenField(a.wallT, (v) => update((aa) => { aa.wallT = v; }, "Wall thickness"), "ar-wallt", { min: 20 })));
      body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-autoraise", checked: st.autoRaise, onchange: (e) => { st.autoRaise = e.target.checked; } }), "Raise new walls right away (" + fmtLen(a.wallH) + ")"));
      body.append(el("p", { class: "arch-hint" }, "Snaps to the grid (" + fmtLen(gridStep()) + "), wall ends and middles, and straight 45°/90° lines. Hold Shift for any angle, Alt to turn snapping off for a moment."));
    } else if (t === "raise") {
      panel.append(head("Raise walls"));
      body.append(el("p", { class: "arch-hint" }, "Pull the floor plan up into walls. Pick a height, then raise all the walls on this level (or only the selected wall)."));
      const hf = lenField(a.wallH, (v) => update((aa) => { aa.wallH = v; }, "Wall height"), "ar-wallh", { min: 300 });
      body.append(row("Height", hf));
      body.append(chips(isInch() ? HEIGHTS_IN : HEIGHTS_MM, (v) => update((aa) => { aa.wallH = v; }, "Wall height")));
      body.append(el("button", { class: "btn primary", id: "ar-raise-all", onclick: () => raiseWalls(a.walls.filter((w) => w.lvl === st.level).map((w) => w.id), A().wallH) }, "Raise all walls on " + cur().name));
      if (s && s.k === "wall") body.append(el("button", { class: "btn", id: "ar-raise-one", onclick: () => raiseWalls([s.id], A().wallH) }, "Raise only the selected wall"));
      body.append(el("button", { class: "btn", id: "ar-flatten", onclick: () => raiseWalls(a.walls.filter((w) => w.lvl === st.level).map((w) => w.id), 1) }, "Back to a flat floor plan"));
    } else if (t === "door" || t === "window") {
      const list = t === "door" ? DOORS : WINDOWS;
      panel.append(head(t === "door" ? "Doors" : "Windows"));
      body.append(el("p", { class: "arch-hint" }, "Pick one, then point at a wall: it snaps along the wall (to the grid and the wall's middle). Click to put it in. To type exact positions, click a wall with Select and use its grid below."));
      const grid = el("div", { class: "arch-cat", id: "ar-cat" });
      for (const P of list) grid.append(el("button", { class: "arch-tile", "data-p": P.id, "aria-pressed": String(st.preset[t] === P.id), title: P.name, onclick: () => { st.preset[t] = P.id; renderPanel(); } }, el("span", { html: presetSVG(P) }), el("b", {}, P.name), el("small", {}, `${fmtLen(P.w)} × ${fmtLen(P.h)}` + (P.sill !== undefined ? ` · sill ${fmtLen(P.sill)}` : ""))));
      body.append(grid);
    } else if (t === "roof") {
      panel.append(head("Roof"));
      body.append(el("p", { class: "arch-hint" }, "Pick a roof shape and its slope, then cover the whole level, or drag across the walls it should cover (corner to corner)."));
      const grid = el("div", { class: "arch-cat roofs", id: "ar-roofs" });
      for (const R of ROOFS) grid.append(el("button", { class: "arch-tile", "data-r": R.id, "aria-pressed": String(st.roof.kind === R.id), onclick: () => { st.roof.kind = R.id; if (R.id === "shed" && st.roof.pitch > 20) st.roof.pitch = 14.04; if (R.id !== "shed" && st.roof.pitch < 15) st.roof.pitch = 26.57; renderPanel(); } }, el("span", { html: roofSVG(R.id) }), el("b", {}, R.name)));
      body.append(grid);
      roofFields(body, st.roof, (k, v) => { st.roof[k] = v; renderPanel(); });
      body.append(el("button", { class: "btn primary", id: "ar-roof-all", onclick: () => addRoof(levelRect()) }, "Cover the whole level"));
    } else if (t === "floor") {
      panel.append(head("Floor"));
      body.append(el("p", { class: "arch-hint" }, "A floor slab under the walls. Cover the whole level, or drag across the area (corner to corner)."));
      body.append(el("button", { class: "btn primary", id: "ar-floor-all", onclick: () => addSlab(levelRect()) }, "Cover the whole level"));
    } else if (s && s.k === "wall" && wallById(s.id)) {
      wallPanel(body, wallById(s.id));
    } else if (s && s.k === "open" && openById(s.id)) {
      openingPanel(body, openById(s.id));
    } else if (s && s.k === "roof" && a.roofs.find((r) => r.id === s.id)) {
      const r = a.roofs.find((q) => q.id === s.id);
      panel.append(head((ROOFS.find((q) => q.id === r.kind) || {}).name + " roof"));
      const set = (k, v) => update((aa) => { aa.roofs.find((q) => q.id === r.id)[k] = v; }, "Edit roof");
      body.append(seg(ROOFS.map((q) => [q.id, q.name]), r.kind, (v) => set("kind", v), "ar-roofkind"));
      roofFields(body, r, set);
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Width", lenField(Math.abs(r.x1 - r.x0), (v) => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id), c = (q.x0 + q.x1) / 2; q.x0 = c - v / 2; q.x1 = c + v / 2; }, "Edit roof"), "ar-rw", { min: 300 })));
      r3.append(el("label", {}, "Depth", lenField(Math.abs(r.y1 - r.y0), (v) => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id), c = (q.y0 + q.y1) / 2; q.y0 = c - v / 2; q.y1 = c + v / 2; }, "Edit roof"), "ar-rd", { min: 300 })));
      r3.append(el("label", {}, "Raise by", lenField(r.z !== undefined ? r.z - levelTop(a, r.lvl) : 0, (v) => set("z", levelTop(A(), r.lvl) + v), "ar-rz")));
      body.append(r3);
      body.append(el("button", { class: "btn", onclick: () => deleteSel() }, "Delete roof"));
    } else if (s && s.k === "slab" && a.slabs.find((q) => q.id === s.id)) {
      const q = a.slabs.find((x) => x.id === s.id);
      panel.append(head("Floor"));
      body.append(row("Thickness", lenField(q.thick || 150, (v) => update((aa) => { aa.slabs.find((x) => x.id === q.id).thick = v; }, "Floor thickness"), "ar-slabt", { min: 10 })));
      body.append(el("button", { class: "btn", onclick: () => deleteSel() }, "Delete floor"));
    } else overviewPanel(body);
    panel.append(body);
    renderElev();
    app.status();
  }
  function wallTypeSelect(t, on) {
    const s = el("select", { class: "num", id: "ar-walltype", "aria-label": "Wall type" }, el("option", { value: "" }, "Custom"), ...WALL_TYPES.map((w) => el("option", { value: w.t, selected: Math.abs(w.t - t) < 0.5 }, w.name)));
    s.onchange = () => { if (s.value) on(+s.value); };
    return s;
  }
  function roofFields(body, r, set) {
    const rise = Math.tan((r.pitch * Math.PI) / 180) * 12;
    body.append(row("Slope", el("div", { class: "arch-inline" }, numIn(r.pitch, (v) => set("pitch", Math.max(1, Math.min(75, v))), "ar-pitch", 1), el("span", {}, "° · " + rise.toFixed(1) + "/12"))));
    body.append(chips([["4/12", 18.43], ["6/12", 26.57], ["8/12", 33.69], ["12/12", 45], ["20°", 20], ["30°", 30]], (v) => set("pitch", v)));
    if (r.kind !== "flat") body.append(row("Overhang", lenField(r.over ?? 300, (v) => set("over", v), "ar-over", { min: 0 })));
    if (r.kind === "gable" || r.kind === "shed" || r.kind === "barrel") body.append(row("Ridge runs", seg([["x", "Left–right (X)"], ["y", "Front–back (Y)"]], r.dir, (v) => set("dir", v), "ar-dir")));
    if (r.kind === "shed") body.append(row("High side", seg([[false, "First"], [true, "Other"]], !!r.flip, (v) => set("flip", v), "ar-flip")));
    if (r.kind === "flat") body.append(row("Thickness", lenField(r.thick || 200, (v) => set("thick", v), "ar-thick", { min: 20 })));
  }
  function wallPanel(body, w) {
    const a = A(), { L, ux, uy } = winfo(w);
    panel.append(head("Wall", fmtLen(L)));
    const set = (fn, label) => update((aa) => fn(aa.walls.find((q) => q.id === w.id), aa), label);
    const r3 = el("div", { class: "row3" });
    r3.append(el("label", {}, "Length", lenField(L, (v) => update((aa) => { const q = aa.walls.find((x) => x.id === w.id); const nb = [q.a[0] + ux * v, q.a[1] + uy * v]; moveEnds(aa, q.lvl, q.b, nb); }, "Wall length"), "ar-len", { min: 100 })));
    r3.append(el("label", {}, "Thickness", lenField(w.t, (v) => set((q) => { q.t = v; }, "Wall thickness"), "ar-t", { min: 20 })));
    r3.append(el("label", {}, "Height", lenField(w.h || 0, (v) => set((q) => { q.h = v; }, "Wall height"), "ar-h", { min: 0 })));
    body.append(r3);
    body.append(row("Type", wallTypeSelect(w.t, (v) => set((q) => { q.t = v; }, "Wall type"))));
    body.append(row("Angle °", numIn(+((Math.atan2(uy, ux) * 180) / Math.PI).toFixed(1), (v) => update((aa) => { const q = aa.walls.find((x) => x.id === w.id); const r = (v * Math.PI) / 180; moveEnds(aa, q.lvl, q.b, [q.a[0] + Math.cos(r) * L, q.a[1] + Math.sin(r) * L]); }, "Wall angle"), "ar-ang", 15)));
    const ops = a.openings.filter((o) => o.wall === w.id).sort((p, q) => p.s - q.s), bad = goodOpenings(a, w).bad;
    body.append(el("div", { class: "subhead" }, `Doors and windows (${ops.length})`));
    for (const o of ops) body.append(el("div", { class: "texrow arch-oprow" + (bad.has(o.id) ? " bad" : "") },
      el("span", { html: presetSVG(PRESETS[o.preset] || { w: o.w, h: o.h, sill: o.k === "window" ? o.sill : undefined, kind: "single" }), class: "arch-mini" }),
      el("span", {}, `${(PRESETS[o.preset] || {}).name || o.k} · ${fmtLen(o.s)} from start` + (bad.has(o.id) ? " · doesn't fit" : "")),
      el("button", { class: "btn", onclick: () => select({ k: "open", id: o.id }) }, "Edit")));
    const add = (k) => {
      const P = PRESETS[st.preset[k]];
      // the middle of the wall, or the free spot nearest to it
      let g = placeOn(w, new THREE.Vector3(w.a[0] + ux * L / 2, w.a[1] + uy * L / 2, 0), P);
      if (!g.ok) {
        const step = gridStep(), cands = [];
        for (let u = P.w / 2 + 100; u <= L - P.w / 2 - 100; u += step) cands.push(u);
        cands.sort((p, q) => Math.abs(p - L / 2) - Math.abs(q - L / 2));
        for (const u of cands) { const g2 = placeOn(w, new THREE.Vector3(w.a[0] + ux * u, w.a[1] + uy * u, 0), P); if (g2.ok) { g = g2; break; } }
      }
      const id = placeOpening(g); if (id) select({ k: "open", id });
    };
    body.append(el("div", { class: "arch-inline" }, el("button", { class: "btn", id: "ar-add-door", onclick: () => add("door") }, "+ Door"), el("button", { class: "btn", id: "ar-add-window", onclick: () => add("window") }, "+ Window")));
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", checked: st.xray, onchange: (e) => { st.xray = e.target.checked; rebuild(); } }), "See through the rest of the building"));
    body.append(el("button", { class: "btn", id: "ar-delwall", onclick: () => deleteSel() }, "Delete wall"));
  }
  function openingPanel(body, o) {
    const a = A(), w = wallById(o.wall), { L } = winfo(w), P = PRESETS[o.preset] || {};
    panel.append(head(o.k === "door" ? "Door" : "Window", P.name || ""));
    const set = (fn, label = "Edit " + o.k) => update((aa) => fn(aa.openings.find((q) => q.id === o.id), aa), label);
    const list = o.k === "door" ? DOORS : WINDOWS;
    const sel = el("select", { class: "num", id: "ar-preset" }, ...list.map((p) => el("option", { value: p.id, selected: p.id === o.preset }, `${p.name} (${fmtLen(p.w)} × ${fmtLen(p.h)})`)));
    sel.onchange = () => set((q) => { const p = PRESETS[sel.value], c = q.s + q.w / 2; q.preset = p.id; q.w = p.w; q.h = p.h; if (p.sill !== undefined) q.sill = p.sill; q.s = Math.max(0, Math.min(L - p.w, c - p.w / 2)); }, "Change " + o.k);
    body.append(row("Model", sel));
    body.append(el("div", { class: "subhead" }, "Where it is (on the wall's grid)"));
    const r3 = el("div", { class: "row3" });
    r3.append(el("label", {}, "From start", lenField(o.s, (v) => set((q) => { q.s = v; }), "ar-os", { min: 0 })));
    r3.append(el("label", {}, "From end", lenField(L - o.s - o.w, (v) => set((q) => { q.s = L - q.w - v; }), "ar-oe", { min: 0 })));
    r3.append(el("label", {}, o.k === "door" ? "From floor" : "Sill height", lenField(o.sill, (v) => set((q) => { q.sill = v; }), "ar-osill", { min: 0 })));
    body.append(r3);
    const r3b = el("div", { class: "row3" });
    r3b.append(el("label", {}, "Width", lenField(o.w, (v) => set((q) => { const c = q.s + q.w / 2; q.w = v; q.s = c - v / 2; }), "ar-ow", { min: 100 })));
    r3b.append(el("label", {}, "Height", lenField(o.h, (v) => set((q) => { q.h = v; }), "ar-oh", { min: 100 })));
    r3b.append(el("label", {}, " ", el("button", { class: "btn", id: "ar-center", onclick: () => set((q) => { q.s = (L - q.w) / 2; }) }, "Center")));
    body.append(r3b);
    if (goodOpenings(a, w).bad.has(o.id)) body.append(el("p", { class: "arch-warn" }, "This " + o.k + " doesn't fit: it runs past the end or top of the wall, or overlaps another one. It is left out until it fits."));
    if (o.k === "door" && ["single", "front", "double"].includes(P.kind)) {
      body.append(row("Hinges", seg([[false, "Left"], [true, "Right"]], !!o.hingeR, (v) => set((q) => { q.hingeR = v; }), "ar-hinge")));
      body.append(row("Opens to", seg([["a", "Side A"], ["b", "Side B"]], o.swing === "b" ? "b" : "a", (v) => set((q) => { q.swing = v; }), "ar-swing")));
    }
    if (o.k === "window") body.append(row("Sill outside", seg([[false, "Side B"], [true, "Side A"]], !!o.flip, (v) => set((q) => { q.flip = v; }), "ar-wflip")));
    body.append(el("div", { class: "arch-inline" }, el("button", { class: "btn", onclick: () => select({ k: "wall", id: w.id }) }, "Back to the wall"), el("button", { class: "btn", id: "ar-delopen", onclick: () => deleteSel() }, "Delete")));
  }
  function overviewPanel(body) {
    const a = A(), L = cur();
    panel.append(head("Architechies", L.name));
    const walls = a.walls.filter((w) => w.lvl === L.id), total = walls.reduce((s, w) => s + winfo(w).L, 0);
    const steps = [
      ["1", "Draw the floor plan", "Wall (W) or Room (R)", walls.length > 0, () => setTool("room")],
      ["2", "Raise the walls", "Raise walls (E)", walls.some((w) => w.h > 0), () => setTool("raise")],
      ["3", "Add doors and windows", "Door (D) · Window (N)", a.openings.some((o) => walls.some((w) => w.id === o.wall)), () => setTool("door")],
      ["4", "Put a roof on", "Roof (O)", a.roofs.some((r) => r.lvl === L.id), () => setTool("roof")],
      ["5", "Use it in your design", "Send to design", false, () => sendDialog()],
    ];
    const ol = el("ol", { class: "arch-steps" });
    for (const [n, t, how, done, go] of steps) ol.append(el("li", { class: done ? "done" : "" }, el("button", { class: "arch-step", onclick: go }, el("b", {}, (done ? "✓ " : n + ". ") + t), el("small", {}, how))));
    body.append(ol);
    body.append(el("div", { class: "arch-inline arch-unitline" }, el("span", {}, "Units:"), el("b", {}, isInch() ? "feet and inches" : "metric (mm)"), el("button", { class: "btn", id: "ar-units-swap", onclick: () => setUnits(isInch() ? "mm" : "in") }, isInch() ? "Use metric" : "Use feet & inches")));
    body.append(el("div", { class: "subhead" }, "This level"));
    body.append(el("p", { class: "arch-hint" }, `${walls.length} wall${walls.length === 1 ? "" : "s"} · ${fmtLen(total)} of wall · ${a.openings.filter((o) => walls.some((w) => w.id === o.wall)).length} doors and windows`));
    const r3 = el("div", { class: "row3" });
    r3.append(el("label", {}, "Name", (() => { const i = el("input", { class: "num", id: "ar-lname", value: L.name }); i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); }); i.addEventListener("change", () => update((aa) => { aa.levels.find((x) => x.id === L.id).name = i.value || L.name; }, "Rename level")); return i; })()));
    r3.append(el("label", {}, "Floor at", lenField(L.elev, (v) => update((aa) => { aa.levels.find((x) => x.id === L.id).elev = v; }, "Level height"), "ar-lelev")));
    r3.append(el("label", {}, "Grid", gridSelect()));
    body.append(r3);
    body.append(el("div", { class: "arch-inline" }, el("button", { class: "btn", id: "ar-addlevel", onclick: () => addLevel() }, "+ Level above"), a.levels.length > 1 ? el("button", { class: "btn", onclick: () => deleteLevel() }, "Delete level") : null));
    if (a.levels.length > 1) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", checked: st.others, onchange: (e) => { st.others = e.target.checked; rebuild(); } }), "Show the other levels"));
    body.append(el("p", { class: "arch-hint" }, "Click a wall to edit it: the rest of the building turns see-through, and its grid opens below for typing exact door and window positions."));
  }
  function gridSelect() {
    const opts = isInch() ? [[IN, '1"'], [3 * IN, '3"'], [6 * IN, '6"'], [FT, "1'"], [2 * FT, "2'"]] : [[10, "10 mm"], [50, "50 mm"], [100, "100 mm"], [250, "250 mm"], [500, "500 mm"], [1000, "1 m"]];
    const g = gridStep();
    const s = el("select", { class: "num", id: "ar-grid", "aria-label": "Grid" }, ...opts.map(([v, l]) => el("option", { value: v, selected: Math.abs(v - g) < 0.01 }, l)));
    s.onchange = () => { update((aa) => { aa.grid = +s.value; }, "Grid size"); vp.gridBase = +s.value; };
    return s;
  }
  function addLevel() {
    const a = A(), L = cur(), top = levelTop(a, L.id);
    const id = uid("L"), n = a.levels.length + 1, copy = a.walls.filter((w) => w.lvl === L.id && (w.t >= 150 || isInch() && w.t >= 160));
    update((aa) => {
      aa.levels.push({ id, name: "Level " + n, elev: L.elev + top });
      // the outside walls carry on up (thick ones); inside walls are drawn again
      for (const w of copy) aa.walls.push({ ...w, id: uid("w"), lvl: id, h: 0 });
    }, "Add level");
    st.level = id; st.sel = null; renderRibbon(); renderPanel(); rebuild();
    app.toast(copy.length ? "Level added above, with the outside walls copied as a floor plan. Raise them when ready." : "Level added above.");
  }
  function deleteLevel() {
    const a = A(), L = cur();
    if (a.levels.length < 2) return;
    if (!confirm(`Delete ${L.name} and everything on it?`)) return;
    update((aa) => {
      const ids = new Set(aa.walls.filter((w) => w.lvl === L.id).map((w) => w.id));
      aa.levels = aa.levels.filter((x) => x.id !== L.id); aa.walls = aa.walls.filter((w) => !ids.has(w.id)); aa.openings = aa.openings.filter((o) => !ids.has(o.wall));
      aa.roofs = aa.roofs.filter((r) => r.lvl !== L.id); aa.slabs = aa.slabs.filter((r) => r.lvl !== L.id);
    }, "Delete level");
    st.level = A().levels[0].id; st.sel = null; renderRibbon(); renderPanel(); rebuild();
  }
  // ------------------------------------------------------------ the wall's grid (elevation)
  const SVGNS = "http://www.w3.org/2000/svg";
  function renderElev() {
    const s = st.sel;
    const w = s && (s.k === "wall" ? wallById(s.id) : s.k === "open" ? wallById(openById(s.id)?.wall) : null);
    if (!active || !w || st.tool !== "select") { elev.hidden = true; return; }
    elev.hidden = false;
    const a = A(), { L } = winfo(w), h = w.h > 0 ? w.h : a.wallH;
    let minor = gridStep(); while (L / minor > 70) minor *= 2;
    const major = isInch() ? FT : 1000;
    const m = Math.max(L, h) * 0.05 + 250, fs = Math.max(L + 2 * m, (h + 2 * m) * 3.2) * 0.016;
    let svg = `<svg xmlns="${SVGNS}" viewBox="${-m} ${-(h + m)} ${L + 2 * m} ${h + 2 * m}" preserveAspectRatio="xMidYMid meet" class="arch-elevsvg">`;
    svg += `<rect x="0" y="${-h}" width="${L}" height="${h}" class="ae-wall"/>`;
    for (let u = 0; u <= L + 0.5; u += minor) svg += `<line x1="${u}" y1="0" x2="${u}" y2="${-h}" class="${Math.abs(u / major - Math.round(u / major)) < 1e-6 ? "ae-major" : "ae-minor"}"/>`;
    for (let z = 0; z <= h + 0.5; z += minor) svg += `<line x1="0" y1="${-z}" x2="${L}" y2="${-z}" class="${Math.abs(z / major - Math.round(z / major)) < 1e-6 ? "ae-major" : "ae-minor"}"/>`;
    const short = (v) => (isInch() ? Math.round(v / FT) + "'" : +(v / 1000).toFixed(1) + " m");
    let lab = major; for (const k of [1, 2, 5, 10, 20, 50]) { lab = major * k; if (L / lab <= 12) break; }
    for (let u = 0; u <= L + 0.5; u += lab) svg += `<text x="${u}" y="${fs * 1.3}" font-size="${fs}" text-anchor="middle" class="ae-t">${short(u)}</text>`;
    let labz = major; for (const k of [1, 2, 5, 10]) { labz = major * k; if (h / labz <= 6) break; }
    for (let z = labz; z <= h + 0.5; z += labz) svg += `<text x="${-fs * 0.5}" y="${-z + fs * 0.35}" font-size="${fs}" text-anchor="end" class="ae-t">${short(z)}</text>`;
    const bad = goodOpenings(a, w).bad;
    for (const o of a.openings.filter((q) => q.wall === w.id)) {
      const P = PRESETS[o.preset] || {}, cls = "ae-open" + (s.k === "open" && s.id === o.id ? " sel" : "") + (bad.has(o.id) ? " bad" : "") + (o.k === "door" ? " door" : "");
      if (P.kind === "round") svg += `<circle data-o="${o.id}" cx="${o.s + o.w / 2}" cy="${-(o.sill + o.h / 2)}" r="${Math.min(o.w, o.h) / 2}" class="${cls}"/>`;
      else svg += `<rect data-o="${o.id}" x="${o.s}" y="${-(o.sill + o.h)}" width="${o.w}" height="${o.h}" class="${cls}"/>`;
      if (s.k === "open" && s.id === o.id) {
        // dimension lines to both ends and the floor
        const y = -(o.sill + o.h / 2);
        svg += `<line x1="0" y1="${y}" x2="${o.s}" y2="${y}" class="ae-dim"/><line x1="${o.s + o.w}" y1="${y}" x2="${L}" y2="${y}" class="ae-dim"/>`;
        svg += `<text x="${o.s / 2}" y="${y - fs * 0.4}" font-size="${fs}" text-anchor="middle" class="ae-d">${fmtLen(o.s)}</text><text x="${o.s + o.w + (L - o.s - o.w) / 2}" y="${y - fs * 0.4}" font-size="${fs}" text-anchor="middle" class="ae-d">${fmtLen(L - o.s - o.w)}</text>`;
        if (o.sill > 1) svg += `<line x1="${o.s + o.w / 2}" y1="0" x2="${o.s + o.w / 2}" y2="${-o.sill}" class="ae-dim"/><text x="${o.s + o.w / 2 + fs * 0.4}" y="${-o.sill / 2}" font-size="${fs}" class="ae-d">${fmtLen(o.sill)}</text>`;
      }
    }
    svg += `<text x="0" y="${-h - fs * 0.6}" font-size="${fs}" class="ae-t">◀ start</text><text x="${L}" y="${-h - fs * 0.6}" font-size="${fs}" text-anchor="end" class="ae-t">end ▶</text></svg>`;
    elev.innerHTML = "";
    const hd = el("header", {}, el("h4", {}, "Wall grid"), el("span", { class: "arch-sub" }, `${fmtLen(L)} long × ${fmtLen(h)} high · grid ${fmtLen(minor)} · seen from side B · drag a door or window, or type its position`), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => select(null) }));
    const wrap = el("div", { class: "ae-wrap", html: svg });
    elev.append(hd, wrap);
    const sv = wrap.querySelector("svg");
    sv.addEventListener("pointerdown", (e) => {
      const t = e.target.closest("[data-o]");
      if (!t) return;
      e.preventDefault();
      const o = openById(t.dataset.o, AC()); if (!o) return;
      const toW = (ev) => { const p = sv.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(sv.getScreenCTM().inverse()); return [q.x, -q.y]; };
      const p0 = toW(e), g = gridStep();
      let moved = false, ns = o.s, nsill = o.sill;
      sv.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const p = toW(ev);
        ns = o.s + p[0] - p0[0]; nsill = o.k === "door" ? o.sill : o.sill + p[1] - p0[1];
        if (app.snapOn !== false && !ev.altKey) { ns = Math.round(ns / g) * g; if (o.k !== "door") nsill = Math.round(nsill / g) * g; if (Math.abs(ns + o.w / 2 - L / 2) < g * 0.6) ns = L / 2 - o.w / 2; }
        ns = Math.max(0, Math.min(L - o.w, ns)); nsill = Math.max(0, Math.min(h - o.h - 10, nsill));
        moved = true;
        if (t.tagName === "circle") { t.setAttribute("cx", ns + o.w / 2); t.setAttribute("cy", -(nsill + o.h / 2)); } else { t.setAttribute("x", ns); t.setAttribute("y", -(nsill + o.h)); }
        preview((aa) => { const q = aa.openings.find((x) => x.id === o.id); q.s = ns; q.sill = nsill; });
      };
      const upf = () => {
        sv.removeEventListener("pointermove", mv); sv.removeEventListener("pointerup", upf); sv.removeEventListener("pointercancel", upf);
        if (moved) { store.commitPreview("Move " + o.k); st.sel = { k: "open", id: o.id }; renderPanel(); rebuild(); }
        else select({ k: "open", id: o.id });
      };
      sv.addEventListener("pointermove", mv); sv.addEventListener("pointerup", upf); sv.addEventListener("pointercancel", upf);
    });
  }
  // ------------------------------------------------------------ toolbar
  function renderRibbon() {
    if (!active) return;
    ribbon.innerHTML = "";
    const bar = el("div", { class: "bbar archbar" });
    const btn = (icon, label, title, fn, id, pressed) => {
      const b = el("button", { class: "ibtn", title, id, "aria-label": label, html: ICON[icon] || ICON.box });
      b.append(el("span", { class: "lbl" }, label));
      if (pressed !== undefined) b.setAttribute("aria-pressed", String(!!pressed));
      b.onclick = fn; bar.append(b); return b;
    };
    const sep = () => bar.append(el("span", { class: "sep" }));
    const T = st.tool;
    btn("select", "Select", "Select and edit walls, doors, windows and roofs (V)", () => setTool("select"), "ar-select", T === "select");
    btn("archWall", "Wall", "Draw walls, corner by corner (W)", () => setTool("wall"), "ar-wall", T === "wall");
    btn("archRoom", "Room", "Draw a rectangular room: four walls (R)", () => setTool("room"), "ar-room", T === "room");
    sep();
    btn("archRaise", "Raise walls", "Raise the floor plan's walls to a height (E)", () => setTool("raise"), "ar-raise", T === "raise");
    sep();
    btn("archDoor", "Door", "Put doors in walls (D)", () => setTool("door"), "ar-door", T === "door");
    btn("archWindow", "Window", "Put windows in walls (N)", () => setTool("window"), "ar-window", T === "window");
    sep();
    btn("archRoof", "Roof", "Gable, hip, shed, pyramid, barrel or flat roofs (O)", () => setTool("roof"), "ar-roof", T === "roof");
    btn("archFloor", "Floor", "A floor slab under the walls (G)", () => setTool("floor"), "ar-floor", T === "floor");
    sep();
    const a = A();
    const lv = el("select", { class: "num arch-level", id: "ar-level", "aria-label": "Level", title: "The level (floor) you are working on" }, ...a.levels.map((l) => el("option", { value: l.id, selected: l.id === st.level }, l.name)), el("option", { value: "+" }, "+ Add a level above"));
    lv.onchange = () => { if (lv.value === "+") { addLevel(); return; } st.level = lv.value; st.sel = null; st.draft = null; renderPanel(); rebuild(); };
    bar.append(lv);
    // units: imperial (feet and inches) or metric, for every size shown and typed
    const un = el("div", { class: "seg arch-units", id: "ar-units", role: "group", "aria-label": "Units", title: "Units for sizes: feet and inches, or metric (mm)" },
      el("button", { "aria-pressed": String(isInch()), "data-u": "in", onclick: () => setUnits("in") }, "ft · in"),
      el("button", { "aria-pressed": String(!isInch()), "data-u": "mm", onclick: () => setUnits("mm") }, "Metric"));
    bar.append(un);
    btn("archPlan", st.plan ? "3D view" : "Plan view", "Look straight down at the floor plan, or back to 3D (P)", () => togglePlan(), "ar-plan", st.plan);
    btn("archXray", "See-through", "When you edit a wall, make the rest of the building see-through (X)", () => { st.xray = !st.xray; renderRibbon(); rebuild(); }, "ar-xray", st.xray);
    sep();
    btn("archSend", "Send to design", "Turn the building into shapes in Beginner or Advanced, at a scale you pick", () => sendDialog(), "ar-send");
    ribbon.append(bar);
  }
  function box3() {
    const b = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); b.union(bb); } });
    if (b.isEmpty()) { const g = isInch() ? 20 * FT : 6000; b.set(new THREE.Vector3(-g, -g, 0), new THREE.Vector3(g, g, 3000)); }
    return b;
  }
  // switching units: standard sizes for that system (wall thickness and height, grid) unless they
  // were changed from the other system's standards
  function setUnits(u) {
    st.unitsPicked = true;
    if ((u === "in") !== isInch()) setUnit(u);
    else renderRibbon();
  }
  onUnit(() => {
    if (!active) return;
    const a = AC(), inch = isInch(), D = defaults(), other = inch ? { wallT: 200, wallH: 2700, grid: 100 } : { wallT: 165, wallH: 9 * FT, grid: 6 * IN };
    const fix = {};
    for (const k of ["wallT", "wallH", "grid"]) if (Math.abs((a[k] || 0) - other[k]) < 0.5 || (k === "grid" && (inch ? a.grid % IN > 0.01 : Math.abs(a.grid / 10 - Math.round(a.grid / 10)) > 0.01))) fix[k] = D[k];
    if (Object.keys(fix).length) update((aa) => { Object.assign(aa, fix); }, inch ? "Feet and inches" : "Metric");
    vp.gridBase = gridStep();
    renderRibbon(); renderPanel(); rebuild();
    app.toast(inch ? "Sizes in feet and inches (like 12' 6\"). Walls default to 6½\" thick and 9' high; the grid is 6\"." : "Sizes in millimetres. Walls default to 200 mm thick and 2.7 m high; the grid is 100 mm.");
  });
  function togglePlan() {
    st.plan = !st.plan; if (st.plan) st.planSeen = true;
    vp.setView(st.plan ? "top" : "home", box3());
    renderRibbon(); rebuild();
  }
  // ------------------------------------------------------------ send to Beginner / Advanced
  function sendDialog() {
    const a = A();
    if (!a.walls.some((w) => w.h > 0)) { app.toast("Raise the walls first (Raise walls), then send the building to your design."); return; }
    const inch = isInch();
    const opt = { scale: inch ? 48 : 100, walls: true, doors: true, windows: true, glass: false, roof: true, floors: true, replace: true, mode: "beginner" };
    try { const saved = JSON.parse(localStorage.getItem("jumpstart3d.arch.send") || "null"); if (saved) Object.assign(opt, saved); } catch (e) {}
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const size = el("p", { class: "arch-hint", id: "ar-send-size" });
    const showSize = () => { const b = box3(), sz = b.getSize(new THREE.Vector3()); const k = 1 / opt.scale; size.textContent = `The model will be about ${fmtSmall(sz.x * k)} × ${fmtSmall(sz.y * k)} × ${fmtSmall(sz.z * k)}` + (opt.scale === 1 ? " (full size: too big to print, good for planning)" : sz.x * k > 256 || sz.y * k > 256 ? " (bigger than most print beds: try a smaller scale)" : "") + "."; };
    const fmtSmall = (mm) => (inch ? (mm / IN).toFixed(2) + " in" : mm.toFixed(1) + " mm");
    const scaleSel = el("select", { class: "num", id: "ar-scale" }, ...SCALES.map(([l, v, note]) => el("option", { value: v, selected: v === opt.scale }, `${l} · ${note}`)));
    scaleSel.onchange = () => { opt.scale = +scaleSel.value; showSize(); };
    const chk = (k, label) => el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-s-" + k, checked: opt[k], onchange: (e) => { opt[k] = e.target.checked; } }), label);
    const modeSeg = seg([["beginner", "Beginner"], ["advanced", "Advanced"]], opt.mode, (v) => { opt.mode = v; modeSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String((i ? "advanced" : "beginner") === v))); }, "ar-s-mode");
    const go = el("button", { class: "btn primary", id: "ar-send-go", onclick: () => { try { localStorage.setItem("jumpstart3d.arch.send", JSON.stringify({ ...opt })); } catch (e) {} back.remove(); send(opt); } }, "Send to design");
    const modal = el("div", { class: "modal arch-send", role: "dialog", "aria-label": "Send to design" },
      el("header", {}, el("h2", {}, "Send to design"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", { class: "arch-hint" }, "The building becomes shapes you can edit, combine and 3D print in Beginner or Advanced: the walls (with doors and windows cut out), frames, floors and roofs. The building stays here in Architechies too, so you can change it and send it again."),
        row("Scale", scaleSel), size,
        el("div", { class: "subhead" }, "Include"),
        el("div", { class: "arch-checks" }, chk("walls", "Walls"), chk("doors", "Doors"), chk("windows", "Window frames"), chk("glass", "Glass (separate part)"), chk("roof", "Roofs"), chk("floors", "Floors")),
        chk("replace", "Replace the copy sent before"),
        row("Then open", modeSeg),
        el("div", { class: "arch-inline", style: { justifyContent: "flex-end", marginTop: "10px" } }, el("button", { class: "btn", onclick: () => back.remove() }, "Cancel"), go)));
    back.append(modal); document.body.append(back);
    showSize();
  }
  function send(opt) {
    const list = buildingBodies(A(), opt);
    if (!list.length) { app.toast("Nothing to send: choose at least one part."); return; }
    const ids = [];
    store.update((doc) => {
      if (opt.replace) doc.bodies = doc.bodies.filter((b) => !b.arch);
      for (const b of list) {
        const id = uid("b");
        doc.bodies.push({ id, name: doc.bodies.some((x) => x.name === b.name) ? nextName(doc, b.name) : b.name, seq: nextSeq(doc), color: b.color, hole: false, hidden: false, m: IDENTITY.slice(), node: b.node, arch: true });
        ids.push(id);
      }
      doc.mode = opt.mode;
    }, "Send building to design");
    app.setMode(opt.mode);
    app.select(ids);
    setTimeout(() => app.fit && app.fit(), 300);
    app.toast(`Your building is in ${opt.mode === "advanced" ? "Advanced" : "Beginner"} as ${ids.length} part${ids.length > 1 ? "s" : ""} at ${SCALES.find((q) => q[1] === opt.scale)?.[0] || "1:" + opt.scale}. It takes a moment to build.`);
  }
  // ------------------------------------------------------------ keys
  function key(e) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    // typing an exact wall length while drawing
    if (st.tool === "wall" && st.draft && !mod) {
      if (/^[0-9.'"\/ ]$/.test(e.key) || (e.key === "m" && st.typed) || (e.key === "c" && st.typed)) { st.typed += e.key; drawOverlay(); return true; }
      if (e.key === "Backspace" && st.typed) { st.typed = st.typed.slice(0, -1); drawOverlay(); return true; }
      if (e.key === "Enter" && st.typed) {
        const len = parseArch(st.typed), d = st.draft, last = d.pts[d.pts.length - 1], c = d.cur || [last[0] + 1, last[1]];
        let dx = c[0] - last[0], dy = c[1] - last[1]; const l0 = Math.hypot(dx, dy); if (l0 < 1) { dx = 1; dy = 0; } else { dx /= l0; dy /= l0; }
        st.typed = "";
        if (isFinite(len) && len > 10) { const p = [last[0] + dx * len, last[1] + dy * len]; d.cur = p; addChainPoint(p); }
        else app.toast("Type a length, like 12' 6\" or 3600.");
        drawOverlay(); return true;
      }
    }
    if (e.key === "Escape") {
      if (st.typed) { st.typed = ""; drawOverlay(); return true; }
      if (st.draft) { if (st.draft.kind === "chain" && st.draft.pts.length > 1) finishChain(); else { st.draft = null; drawOverlay(); } return true; }
      if (st.tool !== "select") { setTool("select"); return true; }
      if (st.sel) { select(st.sel.k === "open" ? { k: "wall", id: openById(st.sel.id)?.wall } : null); return true; }
      return false;
    }
    if (e.key === "Enter" && st.draft && st.draft.kind === "chain") { finishChain(); return true; }
    if ((e.key === "Delete" || e.key === "Backspace") && !mod) return deleteSel();
    if (mod) return false;
    const tools = { v: "select", w: "wall", r: "room", e: "raise", d: "door", n: "window", o: "roof", g: "floor" };
    if (tools[k]) { setTool(tools[k]); return true; }
    if (k === "p") { togglePlan(); return true; }
    if (k === "x") { st.xray = !st.xray; renderRibbon(); rebuild(); return true; }
    if (k === "f" || k === "h") { vp.setView(k === "h" ? "home" : st.plan ? "top" : "home", box3()); return true; }
    if (/^Arrow/.test(e.key) && st.sel && st.sel.k === "open") {
      const o = openById(st.sel.id), w = wallById(o.wall), { L } = winfo(w), g = gridStep() * (e.shiftKey ? 10 : 1);
      const ds = e.key === "ArrowLeft" ? -g : e.key === "ArrowRight" ? g : 0, dz = o.k === "window" ? (e.key === "ArrowUp" ? g : e.key === "ArrowDown" ? -g : 0) : 0;
      update((aa) => { const q = aa.openings.find((x) => x.id === o.id); q.s = Math.max(0, Math.min(L - q.w, q.s + ds)); q.sill = Math.max(0, q.sill + dz); }, "Move " + o.k);
      return true;
    }
    return false;
  }
  function hint() {
    const t = st.tool;
    if (t === "wall") return st.draft ? "Click the next corner. Double-click, Enter or click the first point to finish; type a length and press Enter for an exact wall; Esc to stop." : "Click where the wall starts. Snaps to the grid, wall ends and straight lines (Shift: any angle).";
    if (t === "room") return st.draft && st.draft.waiting ? "Click the opposite corner of the room." : "Drag from one corner of the room to the opposite corner.";
    if (t === "raise") return "Pick a height and raise the walls.";
    if (t === "door" || t === "window") return "Point at a wall and click to put the " + t + " in. Esc when done.";
    if (t === "roof" || t === "floor") return "Cover the whole level from the panel, or drag across the walls to cover (corner to corner).";
    if (st.sel && st.sel.k === "wall") return "Drag the blue dots to move the wall's ends, or drag the wall to slide it. Its grid (below) places doors and windows exactly. Delete removes it.";
    if (st.sel && st.sel.k === "open") return "Drag it along the wall (here or on the grid below), or type its position. Arrow keys nudge it.";
    return "Start with Room (R) or Wall (W). Right-drag orbits, Shift+right-drag or middle-drag pans, scroll zooms. Click a wall to edit it.";
  }
  // ------------------------------------------------------------ entering and leaving
  let saved = null;
  function enter() {
    ensure();
    active = true;
    root.visible = ov.visible = true;
    labels.hidden = false;
    saved = { base: vp.gridBase, max: vp.maxDist };
    if (app.scene.root) app.scene.root.visible = false;
    if (app.scene.sketchRoot) app.scene.sketchRoot.visible = false;
    if (app.scene.planeRoot) app.scene.planeRoot.visible = false;
    $("browser").hidden = true; $("shapes").hidden = true; $("shapes-tab").hidden = true; $("timeline").hidden = true; $("inspector").hidden = true;
    $("palette") && ($("palette").hidden = true);
    vp.setGridStyle("lines");
    vp.gridBase = gridStep();
    vp.maxDist = 150000;
    vp.handler = handler;
    app.sel = [];
    st.tool = "select"; st.draft = null; st.sel = null;
    renderRibbon(); rebuild(); renderPanel();
    const first = !A().walls.length;
    vp.setView("home", box3());
    if (first) setTimeout(() => app.toast("Architechies: start with Room (R) or Wall (W) to draw a floor plan."), 400);
    requestAnimationFrame(() => vp.resize());
  }
  function leave() {
    if (!active) return;
    if (st.draft && st.draft.kind === "chain" && st.draft.pts.length > 1) finishChain();
    active = false;
    root.visible = ov.visible = false;
    clearGroup(root); clearGroup(ov); labels.replaceChildren(); lbls.length = 0;
    panel.hidden = true; elev.hidden = true;
    if (app.scene.root) app.scene.root.visible = true;
    if (app.scene.sketchRoot) app.scene.sketchRoot.visible = true;
    if (app.scene.planeRoot) app.scene.planeRoot.visible = true;
    if (saved) { vp.gridBase = saved.base; vp.maxDist = saved.max; }
    vp.canvas.style.cursor = "default";
  }
  function refresh(kind) {
    if (!active) return;
    if (!store.view.arch) { ensure(); }
    // keep the selection valid (undo can remove things)
    const a = A();
    if (st.sel && !({ wall: wallById, open: openById, roof: (id) => a.roofs.find((r) => r.id === id), slab: (id) => a.slabs.find((r) => r.id === id) }[st.sel.k](st.sel.id))) st.sel = null;
    if (!a.levels.some((l) => l.id === st.level)) st.level = a.levels[0].id;
    rebuild();
    if (kind !== "preview") { renderRibbon(); renderPanel(); }
  }
  return { enter, leave, refresh, key, hint, handler, get active() { return active; }, box: box3, setTool, state: st, send, select };
}
