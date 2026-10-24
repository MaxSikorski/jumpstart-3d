// Architect (the fourth mode): a 3D floor-plan maker for houses and buildings. Draw walls (or
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
import { LIB, texByKey, TEXTURE_DEFAULTS, applyTextures } from "./texture.js";
import { FACEPAT, facePatCells } from "./facepat.js";
import * as LAND from "./archland.js";
import { makeWeather, WEATHER } from "./archweather.js";
import * as LAND_FLOOD from "./archflood.js";
import { planDrawing, planPDF, planSVG, planDXF, PAPERS } from "./archplan.js";

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
  // log walls: the thickness is the log's size
  { id: "logR10", name: "Round logs 10\"", t: 254, log: "round" },
  { id: "logR8", name: "Round logs 8\"", t: 203, log: "round" },
  { id: "logS8", name: "Square logs 8\" (hewn)", t: 203, log: "square" },
  { id: "logS6", name: "Square logs 6\"", t: 152, log: "square" },
  { id: "logR250", name: "Round logs 250 mm", t: 250, log: "round" },
  { id: "logS200", name: "Square logs 200 mm", t: 200, log: "square" },
];
export const LOG_COL = "#9a6a40";
const HEIGHTS_IN = [["8'", 8 * FT], ["9'", 9 * FT], ["10'", 10 * FT], ["12'", 12 * FT]];
const HEIGHTS_MM = [["2.4 m", 2400], ["2.7 m", 2700], ["3.0 m", 3000], ["3.6 m", 3600]];
const ROOFS = [
  { id: "gable", name: "Gable" }, { id: "hip", name: "Hip" }, { id: "shed", name: "Shed" },
  { id: "pyramid", name: "Pyramid" }, { id: "barrel", name: "Barrel" }, { id: "flat", name: "Flat" },
];
const SCALES = [["1:1", 1, "full size"], ["1:24", 24, '½" = 1\' (dollhouse)'], ["1:48", 48, '¼" = 1\''], ["1:50", 50, "2 cm = 1 m"], ["1:87", 87, "HO model train"], ["1:100", 100, "1 cm = 1 m"], ["1:200", 200, "0.5 cm = 1 m"]];
const WALL_COLORS = [["Warm white", "#ebe6dc"], ["Greige", "#c9bfae"], ["Sage", "#9fb08f"], ["Sky blue", "#8fb3cf"], ["Slate gray", "#7b8794"], ["Barn red", "#9a3e32"], ["Brick", "#b5654a"], ["Tan", "#c8a77a"], ["Charcoal", "#4a4f57"]];
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
// ------------------------------------------------------------------ roofs: where they go
// the outside of the walls on a level (for roofs and floors that cover the whole level)
function levelOutline(A, lvl) {
  const ws = A.walls.filter((w) => w.lvl === lvl);
  if (!ws.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of ws) for (const p of [w.a, w.b]) { x0 = Math.min(x0, p[0] - w.t / 2); y0 = Math.min(y0, p[1] - w.t / 2); x1 = Math.max(x1, p[0] + w.t / 2); y1 = Math.max(y1, p[1] + w.t / 2); }
  return { x0, y0, x1, y1 };
}
// a roof as it is now: one that follows the walls takes their outline every time
export function effRoof(A, r) {
  if (r.fit === "level") { const o = levelOutline(A, r.lvl); if (o) return { ...r, ...o }; }
  return r;
}
// the roof sits on the tallest raised wall under it (plus its own lift)
export function roofZ(A, r) {
  const q = effRoof(A, r), rx0 = Math.min(q.x0, q.x1), rx1 = Math.max(q.x0, q.x1), ry0 = Math.min(q.y0, q.y1), ry1 = Math.max(q.y0, q.y1);
  let h = 0;
  for (const w of A.walls) {
    if (w.lvl !== r.lvl || !(w.h > 0)) continue;
    const wx0 = Math.min(w.a[0], w.b[0]) - w.t / 2, wx1 = Math.max(w.a[0], w.b[0]) + w.t / 2, wy0 = Math.min(w.a[1], w.b[1]) - w.t / 2, wy1 = Math.max(w.a[1], w.b[1]) + w.t / 2;
    if (wx1 > rx0 + 1 && wx0 < rx1 - 1 && wy1 > ry0 + 1 && wy0 < ry1 - 1) h = Math.max(h, w.h);
  }
  const lift = r.lift ?? (r.z !== undefined ? r.z - levelTop(A, r.lvl) : 0);
  return (h || levelTop(A, r.lvl)) + lift;
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

// ------------------------------------------------------------------ finishes
// A wall, roof or floor can have a finish: fin = { color, tex, size, depth } (a texture from the
// library, its tile size and depth on the printed model, in mm), and a wall can also have a face
// pattern on its outside face: pat = { kind, size, gap, depth, mode } (as the Pattern on face tool).
// Here they are drawn as pictures on the surfaces; sent to Beginner or Advanced they become real
// texture layers and face patterns, and Architect's export shapes them too.
export const FIN_TEX = LIB.filter((t) => ["build", "wood", "nature", "mat", "geo", "fabric"].includes(t.cat));
const mapCache = new Map();
function finishMap(fin, pat) {
  const isPat = !!(pat && pat.kind && FACEPAT[pat.kind]);
  const key = isPat ? "p:" + pat.kind + ":" + (+(pat.gap ?? FACEPAT[pat.kind].g) / (pat.size || FACEPAT[pat.kind].size)).toFixed(3) : fin && fin.tex ? "t:" + fin.tex : null;
  if (!key) return null;
  if (mapCache.has(key)) return mapCache.get(key);
  const cv = document.createElement("canvas");
  let per;
  if (isPat) {
    const K = FACEPAT[pat.kind], base = pat.kind === "hex" ? [1, Math.sqrt(3)] : pat.kind === "diamond" ? [Math.SQRT2, Math.SQRT2] : [1, 1], n = 4;
    per = [base[0] * n, base[1] * n];
    const W = 256, H = Math.round((256 * per[1]) / per[0]), sc = W / per[0];
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#c4c4c4"; g.fillRect(0, 0, W, H);
    const cells = facePatCells({ kind: pat.kind, size: 1, gap: Math.max(0.1, (pat.gap ?? K.g) / (pat.size || K.size)) }, [0, 0, per[0], per[1]]);
    g.fillStyle = pat.mode === "cut" ? "#8d8d8d" : "#ffffff"; g.strokeStyle = "#6f6f6f"; g.lineWidth = 1.2;
    for (const c of cells) {
      g.beginPath();
      if (c.r) g.arc(c.c[0] * sc, H - c.c[1] * sc, c.r * sc, 0, Math.PI * 2);
      else if (c.pts) c.pts.forEach(([x, y], i) => (i ? g.lineTo(x * sc, H - y * sc) : g.moveTo(x * sc, H - y * sc)));
      g.closePath(); g.fill(); g.stroke();
    }
  } else {
    const src = texByKey(fin.tex).src, w = src.w, h = src.h, d = src.data;
    let lo = Infinity, hi = -Infinity; for (const v of d) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const r = 1 / (hi - lo || 1);
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d"), im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (d[y * w + x] - lo) * r, vx = (d[y * w + ((x + 1) % w)] - d[y * w + ((x + w - 1) % w)]) * r;
      const sh = Math.max(0, Math.min(255, 255 * (0.62 + 0.36 * v - 0.5 * vx))), o = (y * w + x) * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = sh; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    per = [1, src.aspect && h ? h / w : 1];
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const out = { tex, per };
  mapCache.set(key, out);
  return out;
}
// texture coordinates projected along each vertex's main axis, so the picture keeps its real size
function boxUV(g, px, py) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    let u, v;
    if (az >= ax && az >= ay) { u = x; v = y; } else if (ax >= ay) { u = y; v = z; } else { u = x; v = z; }
    uv[i * 2] = u / px; uv[i * 2 + 1] = v / py;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}
// S: the scale the model will be printed at (the finish sizes are on the printed model)
function dress(m, fin, pat, S) {
  if (fin && fin.color) m.material.color.set(fin.color);
  const fm = finishMap(fin, pat);
  if (!fm) return;
  const size = pat && pat.kind ? pat.size || FACEPAT[pat.kind].size : (fin && fin.size) || 4;
  boxUV(m.geometry, fm.per[0] * size * S, fm.per[1] * size * S);
  m.material.map = fm.tex; m.material.needsUpdate = true;
}
const finName = (fin) => (fin && fin.tex ? (LIB.find((t) => t.key === fin.tex) || {}).name || fin.tex : "");

// ------------------------------------------------------------------ log walls
// Logs stacked up the wall: round logs overlap a little (the grooves between them show), square
// (hewn) logs sit on a thin, set-back strip of chinking. At outside corners the logs run past the
// corner and cross, as in a real log cabin. Shared by the 3D view, Send to design and export.
function wallCorners(walls, w) {
  return [w.a, w.b].map((p) => walls.some((o) => o !== w && o.lvl === w.lvl && (near(p, o.a) || near(p, o.b))));
}
// each log as {u0, u1, y, kind: "log" | "chink", d (size up), t (size across)}, in the wall's frame
export function logPieces(A, w, ext, corners) {
  const { L } = winfo(w), D = w.t, h = Math.max(D, w.h || 0), round = w.log === "round";
  const step = round ? D * 0.86 : D, n = Math.max(1, Math.round((h - D) / step) + 1);
  const over = D * 0.75, u0 = -ext[0] - (corners[0] ? over : 0), u1 = L + ext[1] + (corners[1] ? over : 0);
  const ops = goodOpenings(A, w).ok;
  const out = [];
  const cut = (y0, y1, a, b, push) => {
    // the parts of [a, b] not taken by a door or window between heights y0..y1
    let segs = [[a, b]];
    for (const o of ops) {
      if (o.sill >= y1 - 1 || o.sill + o.h <= y0 + 1) continue;
      const s0 = o.s, s1 = o.s + o.w;
      segs = segs.flatMap(([p, q]) => (s1 <= p || s0 >= q ? [[p, q]] : [[p, s0], [s1, q]].filter(([x, y]) => y - x > 20)));
    }
    for (const [p, q] of segs) push(p, q);
  };
  for (let i = 0; i < n; i++) {
    const yb = i * step, yt = Math.min(h, yb + D);
    if (round) cut(yb, yt, u0, u1, (p, q) => out.push({ u0: p, u1: q, y: yb, d: D, t: D, kind: "log" }));
    else {
      cut(yb, yb + D * 0.92, u0, u1, (p, q) => out.push({ u0: p, u1: q, y: yb, d: Math.min(D * 0.92, h - yb), t: D, kind: "log" }));
      if (i < n - 1) cut(yb + D * 0.92, yb + D, -ext[0], L + ext[1], (p, q) => out.push({ u0: p, u1: q, y: yb + D * 0.92, d: D * 0.08, t: D * 0.78, kind: "chink" }));
    }
  }
  return out;
}
function mergeGeos(list) {
  let n = 0; const parts = list.map((g) => { const q = g.index ? g.toNonIndexed() : g; n += q.attributes.position.count; return q; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const q of parts) {
    pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3);
    const c = q.userData.shade ?? 1;
    for (let i = 0; i < q.attributes.position.count; i++) col.set([c, c, c], (o + i) * 3);
    o += q.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function logWallMesh(A, w, elev, ext) {
  const geos = [];
  logPieces(A, w, ext, wallCorners(A.walls, w)).forEach((p, i) => {
    const len = p.u1 - p.u0;
    let g;
    if (w.log === "round" && p.kind === "log") { g = new THREE.CylinderGeometry(p.d / 2, p.d / 2, len, 14, 1); g.rotateZ(Math.PI / 2); g.translate((p.u0 + p.u1) / 2, p.y + p.d / 2, 0); }
    else { g = new THREE.BoxGeometry(len, p.d, p.t); g.translate((p.u0 + p.u1) / 2, p.y + p.d / 2, 0); }
    g.userData.shade = p.kind === "chink" ? 1.45 : 0.86 + 0.14 * ((i * 7919) % 11) / 10;
    geos.push(g);
  });
  const m = new THREE.Mesh(mergeGeos(geos), new THREE.MeshStandardMaterial({ color: (w.fin && w.fin.color) || LOG_COL, vertexColors: true, roughness: 0.9 }));
  m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
  m.applyMatrix4(wallBasis(w, elev));
  m.userData.pick = { k: "wall", id: w.id };
  return m;
}
function anyWallMesh(A, w, elev, ext) { return w.log && w.h > 0 ? logWallMesh(A, w, elev, ext) : wallMesh(A, w, elev, ext); }

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
// how big the building is (mm, full size): walls, floors and roofs with their overhangs
export function buildingExtent(A) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const lv = new Map(A.levels.map((l) => [l.id, l]));
  for (const w of A.walls) { if (!(w.h > 0)) continue; const E = (lv.get(w.lvl) || {}).elev || 0; for (const p of [w.a, w.b]) { x0 = Math.min(x0, p[0] - w.t / 2); y0 = Math.min(y0, p[1] - w.t / 2); x1 = Math.max(x1, p[0] + w.t / 2); y1 = Math.max(y1, p[1] + w.t / 2); } z1 = Math.max(z1, E + w.h); z0 = Math.min(z0, E); }
  for (const s of A.slabs) { const E = (lv.get(s.lvl) || {}).elev || 0; x0 = Math.min(x0, s.x0, s.x1); x1 = Math.max(x1, s.x0, s.x1); y0 = Math.min(y0, s.y0, s.y1); y1 = Math.max(y1, s.y0, s.y1); z0 = Math.min(z0, E - (s.thick || 150)); }
  for (const r of A.roofs) { const E = ((lv.get(r.lvl) || {}).elev || 0) + roofZ(A, r), q = roofParts(effRoof(A, r), E); x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); y0 = Math.min(y0, q.y0); y1 = Math.max(y1, q.y1); z1 = Math.max(z1, E + q.H); }
  if (!isFinite(x0)) return null;
  if (!isFinite(z0)) z0 = 0;
  if (!isFinite(z1)) z1 = z0 + 1;
  return { x0, y0, x1, y1, z0, z1 };
}
// the largest standard scale at which the building fits a 256 × 256 mm build plate (with a margin)
export const PLATE = 236;
const NICE = [1, 2, 5, 10, 12, 20, 24, 25, 48, 50, 75, 87, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 2000, 5000];
export function fitScale(ext) {
  const big = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0, (ext.z1 - ext.z0) * 1.0);
  for (const s of NICE) if (big / s <= PLATE) return s;
  return Math.ceil(big / PLATE);
}
// a fingerprint of the building (not the landscape), to know whether it changed
export function buildingHash(A) {
  const t = JSON.stringify([A.levels, A.walls, A.openings, A.roofs, A.slabs]);
  let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36) + t.length.toString(36);
}
// The building as real shapes: per level, the walls (one shape: wall boxes joined, the doors and
// windows cut out), doors, window frames, glass, floors and each roof, made from the app's own
// shapes so they stay editable. k = 1 / scale.
export function buildingBodies(A, opt) {
  const k = 1 / (opt.scale || 1), out = [];
  const off = opt.offset || [0, 0, 0];
  const R = (x, y, z, ang = 0, pre = null) => {
    const m = new THREE.Matrix4().makeTranslation((x - off[0]) * k, (y - off[1]) * k, (z - off[2]) * k).multiply(new THREE.Matrix4().makeRotationZ(ang));
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
  const body = (name, color, children, extra = {}, fin = null) => {
    if (!children.length) return;
    const b = { name: fin && fin.tex ? name + " · " + finName(fin) : name, color: (fin && fin.color) || color, node: { t: "group", children, mods: [], ...extra } };
    if (fin && fin.tex && opt.textures !== false) b.textures = [{ ...TEXTURE_DEFAULTS, id: uid("t"), faces: "all", tex: fin.tex, size: fin.size || 4, depth: fin.depth ?? 0.4 }];
    out.push(b);
  };
  const multi = A.levels.length > 1;
  for (const L of A.levels) {
    const walls = A.walls.filter((w) => w.lvl === L.id && (w.h || 0) > 0);
    const tag = multi ? " · " + L.name : "";
    if (opt.walls) {
      // walls with the same finish are one shape (with every door and window on the level cut out)
      const holes = [];
      for (const w of walls) for (const o of goodOpenings(A, w).ok) {
        if (PRESETS[o.preset]?.kind === "round") { const c = round(w, L.elev, o, "cylinder", { w: Math.min(o.w, o.h), d: Math.min(o.w, o.h) }, w.t + 4); c.hole = true; holes.push(c); }
        else holes.push(wbox(w, L.elev, o.s + o.w / 2, 0, o.sill < 1 ? -2 : o.sill, o.w, w.t + 4, o.sill < 1 ? o.h + 2 : o.h, true));
      }
      let cx = 0, cy = 0; for (const w of walls) { cx += (w.a[0] + w.b[0]) / 2 / walls.length; cy += (w.a[1] + w.b[1]) / 2 / walls.length; }
      const groups = new Map();
      for (const w of walls) { const key = JSON.stringify([w.fin && (w.fin.tex || w.fin.color) ? w.fin : null, w.log || null]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(w); }
      for (const [key, ws] of groups) {
        const fin = JSON.parse(key)[0], kids = [], mods = [];
        for (const w of ws) {
          const e = wallExt(A.walls, w), { L: len, ux, uy } = winfo(w);
          let { nx, ny } = winfo(w);
          if (w.log) {
            // each log as its own shape (the door and window holes cut through them all)
            const ang = Math.atan2(uy, ux);
            for (const pc of logPieces(A, w, e, wallCorners(A.walls, w))) {
              if (w.log === "round" && pc.kind === "log") kids.push(prim("cylinder", { w: pc.d, d: pc.d, h: pc.u1 - pc.u0 }, R(w.a[0] + ux * pc.u0, w.a[1] + uy * pc.u0, L.elev + pc.y + pc.d / 2, ang, new THREE.Matrix4().makeRotationY(Math.PI / 2))));
              else kids.push(wbox(w, L.elev, (pc.u0 + pc.u1) / 2, 0, pc.y, pc.u1 - pc.u0, pc.t, pc.d));
            }
          } else kids.push(wbox(w, L.elev, (len + e[1] - e[0]) / 2, 0, 0, len + e[0] + e[1], w.t, w.h));
          const P = w.pat;
          if (P && P.kind && FACEPAT[P.kind] && opt.patterns !== false) {
            // on the outside face (the side facing away from the middle of the level)
            const mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
            if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
            const u = (len + e[1] - e[0]) / 2 - e[0] * 0, px = w.a[0] + ux * ((len + e[1] - e[0]) / 2) + nx * (w.t / 2), py = w.a[1] + uy * ((len + e[1] - e[0]) / 2) + ny * (w.t / 2);
            void u;
            const pp = [(px - off[0]) * k, (py - off[1]) * k, (L.elev + w.h / 2 - off[2]) * k].map((v) => +v.toFixed(5));
            const n = [+nx.toFixed(6), +ny.toFixed(6), 0];
            if (mods.some((m) => Math.abs(m.n[0] * n[0] + m.n[1] * n[1] - 1) < 1e-4 && Math.abs((m.p[0] - pp[0]) * n[0] + (m.p[1] - pp[1]) * n[1]) < 0.05)) continue;
            const K = FACEPAT[P.kind];
            mods.push({ id: uid("f"), t: "facepat", p: pp, n, x: [+(-ny).toFixed(6), +nx.toFixed(6), 0], kind: P.kind, size: P.size || K.size, gap: P.gap ?? K.g, depth: P.depth || 0.4, mode: P.mode === "cut" ? "cut" : "raise", lines: false, edge: "whole", border: P.border ?? 1, angle: 0, ox: 0, oy: 0 });
          }
        }
        const logs = ws.some((w) => w.log);
        const name = (logs ? "Log walls" : "Walls") + (fin && fin.tex ? " · " + finName(fin) : "") + tag;
        const textures = fin && fin.tex ? [{ ...TEXTURE_DEFAULTS, id: uid("t"), faces: "all", tex: fin.tex, size: fin.size || 4, depth: fin.depth ?? 0.4 }] : null;
        if (kids.length) out.push({ name, color: (fin && fin.color) || (logs ? LOG_COL : COL.wall), node: { t: "group", children: [...kids, ...holes], mods, ...(logs ? { logs: true } : {}) }, ...(textures && opt.textures !== false ? { textures } : {}) });
      }
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
      body("Floor" + tag, COL.slab, [prim("box", { w: x1 - x0, d: y1 - y0, h: th }, R((x0 + x1) / 2, (y0 + y1) / 2, L.elev - th))], {}, s.fin);
    }
    if (opt.roof) for (const r0 of A.roofs.filter((q) => q.lvl === L.id)) {
      const z0 = L.elev + roofZ(A, r0), r = effRoof(A, r0), q = roofParts(r, z0), xm = (q.x0 + q.x1) / 2, ym = (q.y0 + q.y1) / 2;
      const name = (ROOFS.find((x) => x.id === r.kind) || { name: "Roof" }).name + " roof" + tag;
      const rot = q.along === "x" ? Math.PI / 2 : 0;
      if (r.kind === "flat") body(name, COL.roof, [prim("box", { w: q.W, d: q.D, h: q.H }, R(xm, ym, z0))], {}, r.fin);
      else if (r.kind === "gable") body(name, COL.roof, [prim("roof", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot))], {}, r.fin);
      else if (r.kind === "barrel") body(name, COL.roof, [prim("roundroof", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot))], {}, r.fin);
      else if (r.kind === "pyramid") body(name, COL.roof, [prim("pyramid", { w: q.W, d: q.D, h: q.H, sides: 4 }, R(xm, ym, z0))], {}, r.fin);
      else if (r.kind === "shed") body(name, COL.roof, [prim("wedge", { w: q.span, d: q.run, h: q.H }, R(xm, ym, z0, rot + (r.flip ? Math.PI : 0)))], {}, r.fin);
      else if (r.kind === "hip") body(name, COL.roof, [prim("roof", { w: q.W, d: q.D, h: (q.W / 2) * q.tp }, R(xm, ym, z0)), prim("roof", { w: q.D, d: q.W, h: (q.D / 2) * q.tp }, R(xm, ym, z0, Math.PI / 2))], { op: "intersect" }, r.fin);
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
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem("jumpstart3d.arch." + k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
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
    drawLand();
    const S = printScale();
    const selWall = st.sel && (st.sel.k === "wall" ? st.sel.id : st.sel.k === "open" ? openById(st.sel.id)?.wall : null);
    for (const L of a.levels) {
      const curL = L.id === st.level;
      if (!curL && !st.others) continue;
      for (const w of a.walls.filter((q) => q.lvl === L.id)) {
        const ext = wallExt(a.walls, w);
        const m = (w.h || 0) > 0 ? anyWallMesh(a, w, L.elev, ext) : planWallMesh(w, L.elev, ext);
        m.material.userData.own = true;
        if ((w.h || 0) > 0) dress(m, w.fin, w.pat, S);
        // dark edges so light walls stand out (in light mode especially)
        if ((w.h || 0) > 0 && !w.log) { const ln = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: 0x3b4450, transparent: true, opacity: 0.55 })); ln.material.userData.own = true; ln.userData.edge = true; m.add(ln); }
        root.add(m); meshes.walls.set(w.id, m);
        m.userData.level = L.id;
        if ((w.h || 0) > 0) for (const o of goodOpenings(a, w).ok) { const g = openingModel(o, w, L.elev); g.userData.level = L.id; root.add(g); meshes.opens.set(o.id, g); }
      }
      for (const s of a.slabs.filter((q) => q.lvl === L.id)) {
        const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1), th = s.thick || 150;
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, th), mat(COL.slab).clone());
        m.material.userData.own = true; m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, L.elev - th / 2);
        dress(m, s.fin, null, S);
        m.userData.pick = { k: "slab", id: s.id }; m.userData.level = L.id;
        root.add(m); meshes.slabs.set(s.id, m);
      }
      for (const r of a.roofs.filter((q) => q.lvl === L.id)) {
        const m = new THREE.Mesh(roofGeometry(effRoof(a, r), L.elev + roofZ(a, r)), mat(COL.roof).clone());
        m.material.userData.own = true; m.material.userData.base = { transparent: false, opacity: 1, depthWrite: true };
        m.userData.pick = { k: "roof", id: r.id }; m.userData.level = L.id;
        dress(m, r.fin, null, S);
        root.add(m); meshes.roofs.set(r.id, m);
      }
    }
    // see-through: while a wall (or one of its doors and windows) is being edited, everything else
    // fades away; other levels are always a little faded
    root.traverse((o) => {
      if (o.userData.edge) { const pk = o.parent.userData.pick, lvl = o.parent.userData.level; let op = 0.55; if (lvl && lvl !== st.level) op = 0.2; if (selWall && st.xray && !(pk && pk.id === selWall)) op = 0.06; o.material.opacity = op; return; }
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
  // ------------------------------------------------------------ the landscape (Architect only)
  const landRoot = new THREE.Group();
  landRoot.visible = false;
  vp.world.add(landRoot);
  const LB = { key: null, pkey: null, ground: null, water: null, plants: new THREE.Group(), arr: null };
  landRoot.add(LB.plants);
  const WX = makeWeather(vp, landRoot);
  { const w = pref("weather", null); if (w) WX.state.wind = w.wind ?? 0.3, WX.state.waves = w.waves ?? 0.5, WX.state.water = w.water !== false, WX.state.kind = w.kind || "clear"; }
  const saveWx = () => { try { const w = WX.state; localStorage.setItem("jumpstart3d.arch.weather", JSON.stringify({ kind: w.kind, wind: w.wind, waves: w.waves, water: w.water })); } catch (e) {} };
  const IN6 = () => (isInch() ? 6 * FT : 2000);
  st.land = { mode: "raise", r: 0, k: 0.5, mat: 0, plant: "oak", depth: 0, show: true };
  // the scale the model will be printed at (finish sizes are on the printed model)
  function printScale() {
    const sync = store.doc.archSync;
    if (sync && sync.scale) return sync.scale;
    const e = buildingExtent(AC() || defaults());
    return e ? fitScale(e) : 50;
  }
  function disposeObj(o) { if (!o) return; o.parent && o.parent.remove(o); o.traverse((q) => { if (q.geometry && !q.userData.shared) q.geometry.dispose(); }); }
  function drawLand(live) {
    const a = A(), L = a && a.land;
    const show = !!(L && st.land.show && active);
    landRoot.visible = show;
    vp.grid.visible = !show;
    if (show !== LB.shown) { LB.shown = show; WX.show(show); }
    if (!L) { disposeObj(LB.ground); disposeObj(LB.water); LB.ground = LB.water = null; LB.plants.clear(); LB.key = LB.pkey = null; return; }
    const key = live ? null : L.nx + ":" + L.h + L.w + L.m + L.x0 + "," + L.y0 + "," + L.res;
    if (live || key !== LB.key) {
      const arr = live || LAND.landArrays(L);
      LB.arr = arr;
      disposeObj(LB.ground); disposeObj(LB.water);
      LB.ground = LAND.groundMesh(L, arr); LB.ground.userData.pick = { k: "land" };
      landRoot.add(LB.ground);
      LB.water = LAND.waterMesh(L, arr); if (LB.water) { LB.water.renderOrder = 3; landRoot.add(LB.water); }
      LB.key = key; LB.pkey = null;
    }
    if (LB.arr) { let lo = Infinity, hi = -Infinity; for (const v of LB.arr.h) { if (v < lo) lo = v; if (v > hi) hi = v; } const e = buildingExtent(a); WX.attach({ bounds: { x0: L.x0, y0: L.y0, x1: L.x0 + (L.nx - 1) * L.res, y1: L.y0 + (L.ny - 1) * L.res, z0: lo, z1: Math.max(hi, e ? e.z1 : 0) }, waterMesh: LB.water, plantGroup: LB.plants }); }
    const pkey = JSON.stringify(L.plants) + (LB.key || "live");
    if (pkey !== LB.pkey || live) {
      LB.plants.clear();
      for (const p of L.plants) LB.plants.add(LAND.plantObject(p, LAND.heightAt(L, LB.arr, p.x, p.y) - 30 * (p.s || 1)));
      LB.pkey = live ? null : pkey;
    }
    vp.request();
  }
  function landPoint(e) {
    if (LB.ground && landRoot.visible) { vp.ray(e); const h = vp.raycaster.intersectObject(LB.ground, false)[0]; if (h) return h.point; }
    return vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  }
  function makeLand(margin) {
    const ext = buildingExtent(AC()) || { x0: -4000, y0: -4000, x1: 4000, y1: 4000 };
    const big = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0) + 2 * margin;
    const res = Math.max(100, Math.ceil(big / 170 / 50) * 50);
    const sn = (v, up) => (up ? Math.ceil(v / res) : Math.floor(v / res)) * res;
    const rect = { x0: sn(ext.x0 - margin), y0: sn(ext.y0 - margin), x1: sn(ext.x1 + margin, true), y1: sn(ext.y1 + margin, true) };
    update((a) => { a.land = LAND.newLand(rect, res); }, "Make the ground");
    st.land.show = true;
    renderPanel(); rebuild();
    app.toast("Ground made around the house. Shape it with Raise and Lower, dig ponds with Water, paint it and plant trees.");
  }
  // level the ground under (and just around) the building, at the floor
  function padUnderHouse() {
    const L = AC().land, ext = buildingExtent(AC());
    if (!L || !ext) return;
    const arr = LAND.landArrays(L), m = 300, fall = 1500;
    for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      const x = L.x0 + i * L.res, y = L.y0 + j * L.res;
      const dx = Math.max(ext.x0 - m - x, 0, x - ext.x1 - m), dy = Math.max(ext.y0 - m - y, 0, y - ext.y1 - m), d = Math.hypot(dx, dy);
      if (d >= fall) continue;
      const t = d / fall, f = 1 - t * t * (3 - 2 * t), q = j * L.nx + i;
      arr.h[q] += (0 - arr.h[q]) * f;
      if (f > 0.95) arr.w[q] = NaN;
    }
    update((a) => { a.land = LAND.packArrays(a.land, arr); }, "Level the ground under the house");
  }
  const LAND_TOOLS = [["raise", "Raise"], ["lower", "Lower"], ["smooth", "Smooth"], ["flatten", "Flatten"], ["water", "Pond / lake"], ["dry", "Remove water"], ["paint", "Paint"], ["plant", "Plant"], ["unplant", "Remove plants"]];
  function landPanel(body) {
    const a = A(), L = a.land, o = st.land;
    panel.append(head("Landscape", "only in Architect"));
    if (!L) {
      body.append(el("p", { class: "arch-hint" }, "Make the ground around your house, then shape hills and valleys, dig ponds and lakes that fill with water, paint grass, paths and flower beds, and plant trees and bushes. The landscape stays in Architect: only the house goes to the other modes. Export it all together (with the house, scaled to fit the build plate) as STL, OBJ or 3MF."));
      const opts = isInch() ? [["10' around", 10 * FT], ["25' around", 25 * FT], ["60' around", 60 * FT]] : [["3 m around", 3000], ["8 m around", 8000], ["20 m around", 20000]];
      body.append(el("div", { class: "subhead" }, "Make the ground"));
      body.append(el("div", { class: "arch-inline", id: "ar-land-make" }, ...opts.map(([l, v], i) => el("button", { class: "btn" + (i === 1 ? " primary" : ""), "data-m": v, onclick: () => makeLand(v) }, l))));
      return;
    }
    if (!o.r) o.r = IN6();
    if (!o.depth) o.depth = isInch() ? 4 * FT : 1200;
    body.append(el("div", { class: "arch-cat land", id: "ar-landtools" }, ...LAND_TOOLS.map(([v, l]) => el("button", { class: "btn" + (o.mode === v ? " on" : ""), "aria-pressed": String(o.mode === v), "data-t": v, onclick: () => { o.mode = v; renderPanel(); drawOverlay(); } }, l))));
    const tip = { raise: "Drag on the ground to build up hills (hold still to keep raising).", lower: "Drag to dig the ground down.", smooth: "Drag to soften bumps and edges.", flatten: "Drag to level the ground to the height where you started.", water: "Drag to dig a pond, lake or stream: it fills with water level with where you started.", dry: "Drag over water to drain it.", paint: "Pick a ground and drag to paint it: grass, paths, sand, flower beds…", plant: "Pick a tree, bush or rock, then click to place it (drag to plant a row).", unplant: "Drag over plants to remove them." }[o.mode];
    body.append(el("p", { class: "arch-hint" }, tip));
    const r3 = el("div", { class: "row3" });
    r3.append(el("label", {}, "Brush size", lenField(o.r, (v) => { o.r = v; drawOverlay(); }, "ar-brush", { min: 100 })));
    r3.append(el("label", {}, "Strength %", numIn(Math.round(o.k * 100), (v) => { o.k = Math.max(0.05, Math.min(1, v / 100)); }, "ar-strength", 10)));
    if (o.mode === "water") r3.append(el("label", {}, "Water depth", lenField(o.depth, (v) => { o.depth = v; }, "ar-wdepth", { min: 50 })));
    body.append(r3);
    if (o.mode === "paint") {
      const g = el("div", { class: "arch-cat ground", id: "ar-grounds" });
      LAND.GROUND.forEach((G, i) => g.append(el("button", { class: "arch-tile", "data-g": G.id, "aria-pressed": String(o.mat === i), title: G.name, onclick: () => { o.mat = i; renderPanel(); } }, el("span", { class: "arch-swatch", style: { background: G.c } }), el("b", {}, G.name))));
      body.append(g);
    }
    if (o.mode === "plant") {
      const cat = o.pcat || (LAND.PLANTS.find((q) => q.id === o.plant) || {}).cat || "tree";
      body.append(seg(LAND.PLANT_CATS, cat, (v) => { o.pcat = v; renderPanel(); }, "ar-pcat"));
      const g = el("div", { class: "arch-cat plants", id: "ar-plants" });
      for (const P of LAND.PLANTS.filter((q) => q.cat === cat)) g.append(el("button", { class: "arch-tile", "data-p": P.id, "aria-pressed": String(o.plant === P.id), title: P.name, onclick: () => { o.plant = P.id; renderPanel(); } }, el("span", { html: plantSVG(P.id) }), el("b", {}, P.name), el("small", {}, "about " + fmtLen(P.h) + " tall")));
      body.append(g);
    }
    body.append(el("div", { class: "arch-inline" }, el("span", { class: "arch-hint" }, "Weather, moving water and the flood test:"), el("button", { class: "btn", id: "ar-goto-sim", onclick: () => setTool("sim") }, "Simulate (S)")));
    body.append(el("div", { class: "subhead" }, "Ground"));
    body.append(el("p", { class: "arch-hint" }, `${fmtLen((L.nx - 1) * L.res)} × ${fmtLen((L.ny - 1) * L.res)} · ${L.plants.length} plant${L.plants.length === 1 ? "" : "s"}`));
    body.append(el("div", { class: "arch-inline" },
      el("button", { class: "btn", id: "ar-land-pad", onclick: () => padUnderHouse() }, "Level under the house"),
      el("button", { class: "btn", id: "ar-land-del", onclick: () => { if (confirm("Remove the ground, its water and plants?")) update((aa) => { delete aa.land; }, "Remove the ground"); } }, "Remove ground")));
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-land-show", checked: o.show, onchange: (e) => { o.show = e.target.checked; drawLand(); } }), "Show the landscape"));
    body.append(el("button", { class: "btn primary", id: "ar-export2", onclick: () => exportDialog() }, "Export house and landscape…"));
  }
  function plantSVG(k) {
    const c = { oak: "#4d8a3c", maple: "#d9782e", birch: "#8cc04f", pine: "#2f6b3a", spruce: "#285c40", palm: "#4f9a3e", bush: "#4f8f3c", shrub: "#3f7f3a", hedge: "#3f7a35", rock: "#8d8a84", grassclump: "#7fae4b" }[k];
    const tr = '<rect x="20.5" y="26" width="3" height="12" fill="#6b4a2b"/>';
    const body = { oak: `${tr}<circle cx="22" cy="18" r="11" fill="${c}"/>`, maple: `${tr}<circle cx="22" cy="18" r="11" fill="${c}"/>`, birch: '<rect x="21" y="20" width="2.4" height="18" fill="#ece8de"/>' + `<ellipse cx="22" cy="15" rx="7" ry="11" fill="${c}"/>`, pine: `${tr}<path d="M22 4 34 30H10z" fill="${c}"/>`, spruce: `${tr}<path d="M22 3 31 32H13z" fill="${c}"/>`, palm: '<path d="M22 38c0-10 1-18 0-24" stroke="#8a6b48" stroke-width="3" fill="none"/>' + `<path d="M22 13c-6-4-12-3-15 1M22 13c6-4 12-3 15 1M22 13c-3-5-8-8-12-8M22 13c3-5 8-8 12-8" stroke="${c}" stroke-width="3" fill="none"/>`, bush: `<ellipse cx="22" cy="30" rx="13" ry="9" fill="${c}"/>`, shrub: `<ellipse cx="22" cy="30" rx="12" ry="8" fill="${c}"/><circle cx="16" cy="27" r="2" fill="#e06aa8"/><circle cx="25" cy="25" r="2" fill="#e06aa8"/><circle cx="29" cy="31" r="2" fill="#e06aa8"/>`, hedge: `<rect x="6" y="22" width="32" height="15" rx="3" fill="${c}"/>`, rock: `<path d="M8 37 13 26l9-4 9 3 5 12z" fill="${c}"/>`, grassclump: `<path d="M22 38 14 20M22 38l2-20M22 38l9-17M22 38l-4-14M22 38l6-12" stroke="${c}" stroke-width="2.4" fill="none"/>` }[k];
    const C2 = { willow: "#8db556", cypress: "#2e5a32", fir: "#4f7c86", cherry: "#f2b6cf", apple: "#5f9a3f", aspen: "#e2b53b", redmaple: "#b9342a", dead: "#6e5d4e", fanpalm: "#5a9a46", cactus: "#4f8a45", boxwood: "#2f6a32", lavender: "#8e6cc9", rose: "#3b6e34", hydrangea: "#7f98e0", fern: "#4e8f3a", juniper: "#3e6b4f", pampas: "#e8dcc0", reeds: "#6e8f45", wildflowers: "#e8c33a", tulips: "#d8323a", lilypad: "#4f8f3c", stone: "#8b8780", rockpile: "#85817a", flatstone: "#a29d93", pebbles: "#a7a29a", boulder2: "#b4aba3" }, c2 = C2[k];
    const more = !body && c2 ? ({
      willow: `${tr}<ellipse cx="22" cy="16" rx="10" ry="8" fill="${c2}"/><path d="M12 16v16M16 18v17M28 18v17M32 16v16" stroke="${c2}" stroke-width="3"/>`,
      cypress: `<rect x="21" y="31" width="2" height="7" fill="#6b4a2b"/><ellipse cx="22" cy="18" rx="5" ry="15" fill="${c2}"/>`,
      fir: `${tr}<path d="M22 3 33 30H11z" fill="${c2}"/>`, cherry: `${tr}<circle cx="22" cy="17" r="11" fill="${c2}"/>`,
      apple: `${tr}<circle cx="22" cy="17" r="11" fill="${c2}"/><circle cx="17" cy="15" r="1.8" fill="#cc2f2f"/><circle cx="26" cy="20" r="1.8" fill="#cc2f2f"/><circle cx="24" cy="11" r="1.8" fill="#cc2f2f"/>`,
      aspen: '<rect x="21" y="20" width="2.4" height="18" fill="#e4e0d2"/>' + `<ellipse cx="22" cy="14" rx="7" ry="11" fill="${c2}"/>`, redmaple: `${tr}<circle cx="22" cy="18" r="11" fill="${c2}"/>`,
      dead: `<path d="M22 38V14M22 22l-8-8M22 18l7-9M22 27l9-5M16 15l-3-5" stroke="${c2}" stroke-width="2.5" fill="none"/>`,
      fanpalm: '<rect x="20" y="20" width="4" height="18" fill="#7d6248"/>' + `<path d="M22 20 8 12M22 20 12 6M22 20 22 4M22 20 32 6M22 20 36 12" stroke="${c2}" stroke-width="4"/>`,
      cactus: `<rect x="19" y="8" width="6" height="30" rx="3" fill="${c2}"/><path d="M19 24h-5v-9M25 20h5v-8" stroke="${c2}" stroke-width="4" fill="none"/>`,
      boxwood: `<circle cx="22" cy="30" r="8" fill="${c2}"/>`, lavender: '<path d="M14 38V24M18 38V20M22 38V18M26 38V20M30 38V24" stroke="#7d9a6a" stroke-width="2"/>' + `<path d="M14 26v-5M18 22v-6M22 20v-7M26 22v-6M30 26v-5" stroke="${c2}" stroke-width="3.5"/>`,
      rose: `<ellipse cx="22" cy="29" rx="12" ry="9" fill="${c2}"/><circle cx="16" cy="25" r="2.4" fill="#c8243a"/><circle cx="25" cy="23" r="2.4" fill="#c8243a"/><circle cx="29" cy="30" r="2.4" fill="#c8243a"/>`,
      hydrangea: `<ellipse cx="22" cy="30" rx="12" ry="8" fill="#47813f"/><circle cx="16" cy="25" r="4" fill="${c2}"/><circle cx="25" cy="23" r="4" fill="${c2}"/><circle cx="30" cy="28" r="3.5" fill="${c2}"/>`,
      fern: `<path d="M22 37 8 26M22 37l-6-17M22 37V17M22 37l6-17M22 37l14-11" stroke="${c2}" stroke-width="3" fill="none"/>`,
      juniper: `<ellipse cx="22" cy="32" rx="16" ry="6" fill="${c2}"/>`,
      pampas: '<path d="M22 38 14 20M22 38V16M22 38l8-18" stroke="#8fa05b" stroke-width="2" fill="none"/>' + `<ellipse cx="14" cy="16" rx="3" ry="7" fill="${c2}"/><ellipse cx="22" cy="11" rx="3" ry="7" fill="${c2}"/><ellipse cx="30" cy="16" rx="3" ry="7" fill="${c2}"/>`,
      reeds: `<path d="M16 38V12M22 38V8M28 38V14" stroke="${c2}" stroke-width="2"/><rect x="14.5" y="12" width="3" height="8" rx="1.5" fill="#6b4a2b"/><rect x="20.5" y="8" width="3" height="8" rx="1.5" fill="#6b4a2b"/><rect x="26.5" y="14" width="3" height="8" rx="1.5" fill="#6b4a2b"/>`,
      wildflowers: '<path d="M12 38V26M18 38V22M24 38V25M30 38V21M35 38V27" stroke="#6e9a45" stroke-width="1.6"/><circle cx="12" cy="25" r="2.5" fill="#e8c33a"/><circle cx="18" cy="21" r="2.5" fill="#e06aa8"/><circle cx="24" cy="24" r="2.5" fill="#ffffff" stroke="#bbb" stroke-width=".5"/><circle cx="30" cy="20" r="2.5" fill="#8e6cc9"/><circle cx="35" cy="26" r="2.5" fill="#e65a3a"/>',
      tulips: '<path d="M15 38V24M22 38V20M29 38V24" stroke="#5d8f3e" stroke-width="1.8"/><path d="M12 24h6v-5l-3 2-3-2z" fill="#d8323a"/><path d="M19 20h6v-5l-3 2-3-2z" fill="#f2c230"/><path d="M26 24h6v-5l-3 2-3-2z" fill="#e06aa8"/>',
      lilypad: '<rect x="2" y="28" width="40" height="10" rx="3" fill="#3d8fd6" opacity=".55"/>' + `<ellipse cx="17" cy="32" rx="8" ry="3" fill="${c2}"/><ellipse cx="29" cy="34" rx="6" ry="2.4" fill="${c2}"/><circle cx="17" cy="30.5" r="2" fill="#f4c3d6"/>`,
      stone: `<path d="M14 37l3-6 8-2 5 3 1 5z" fill="${c2}"/>`, rockpile: `<path d="M6 37l4-9 8-2 4 4 6-6 7 3 4 10z" fill="${c2}"/><path d="M16 26l4-6 6 1 2 5" fill="#9a958d"/>`,
      flatstone: `<ellipse cx="22" cy="35" rx="15" ry="3.5" fill="${c2}"/>`, pebbles: `<ellipse cx="12" cy="36" rx="4" ry="2" fill="${c2}"/><ellipse cx="21" cy="35" rx="3" ry="1.8" fill="#8c877f"/><ellipse cx="29" cy="36" rx="4.5" ry="2" fill="#bdb7ad"/><ellipse cx="35" cy="34.5" rx="2.5" ry="1.5" fill="${c2}"/>`,
      boulder2: `<path d="M5 37 9 22l11-8 12 4 6 19z" fill="${c2}"/>`,
    })[k] : "";
    return `<svg viewBox="0 0 44 40" width="44" height="40" aria-hidden="true"><rect x="2" y="37" width="40" height="2" fill="#8b6a45"/>${body || more || ""}</svg>`;
  }
  const landHandler = {
    hover(e) { const p = landPoint(e); st.brushAt = p ? [p.x, p.y] : null; drawOverlay(); },
    down(e) {
      const L = AC().land;
      if (!L) { app.toast("Make the ground first (in the panel on the right)."); return true; }
      const p = landPoint(e); if (!p) return true;
      const o = st.land;
      if (o.mode === "plant" || o.mode === "unplant") {
        st.drag = { k: "plants", add: [], gone: new Set(), last: null };
        plantAt(p);
        return true;
      }
      const arr = LAND.landArrays(L), h0 = LAND.heightAt(L, arr, p.x, p.y);
      st.drag = { k: "land", L, arr, target: o.mode === "water" ? h0 - (isInch() ? 4 * IN : 100) : h0, last: null, at: p, moved: false };
      dab(p, true);
      // hold still to keep raising, lowering or digging
      if (["raise", "lower", "smooth", "water"].includes(o.mode)) st.drag.timer = setInterval(() => { if (st.drag && st.drag.k === "land") dab(st.drag.at, true); }, 90);
      return true;
    },
    move(e) {
      const d = st.drag, p = landPoint(e);
      st.brushAt = p ? [p.x, p.y] : null;
      if (!d || !p) { drawOverlay(); return; }
      if (d.k === "plants") plantAt(p); else { d.at = p; dab(p, false); }
      drawOverlay();
    },
    up() {
      const d = st.drag; st.drag = null;
      if (!d) return;
      if (d.timer) clearInterval(d.timer);
      const o = st.land;
      if (d.k === "land") {
        if (!d.moved) return;
        update((a) => { a.land = LAND.packArrays(a.land, d.arr); }, { raise: "Raise ground", lower: "Lower ground", smooth: "Smooth ground", flatten: "Flatten ground", water: "Dig a pond", dry: "Remove water", paint: "Paint ground" }[o.mode]);
      } else if (d.add.length || d.gone.size) {
        update((a) => { a.land.plants = a.land.plants.filter((q) => !d.gone.has(q.id)).concat(d.add); }, d.add.length ? (d.add.length > 1 ? "Plant " + d.add.length : "Plant " + (LAND.PLANTS.find((q) => q.id === d.add[0].k) || {}).name) : "Remove plants");
      } else store.setPreview(null);
    },
  };
  function dab(p, force) {
    const d = st.drag, o = st.land;
    if (!force && d.last && Math.hypot(p.x - d.last[0], p.y - d.last[1]) < o.r * 0.15) return;
    d.last = [p.x, p.y];
    const kind = o.mode, step = Math.max(20, o.r * 0.05);
    if (LAND.brush(d.L, d.arr, p.x, p.y, { kind, r: o.r, k: o.k, step, target: d.target, depth: o.depth, mat: o.mat })) { d.moved = true; drawLand(d.arr); }
  }
  function plantAt(p) {
    const d = st.drag, o = st.land, a = AC();
    if (o.mode === "plant") {
      const P = LAND.PLANTS.find((q) => q.id === o.plant) || LAND.PLANTS[0];
      const gap = Math.max(P.id === "hedge" ? 2200 : P.h * 0.45, 400);
      if (d.last && Math.hypot(p.x - d.last[0], p.y - d.last[1]) < gap) return;
      const r = P.id === "hedge" && d.last ? Math.atan2(p.y - d.last[1], p.x - d.last[0]) : P.id === "hedge" ? 0 : Math.random() * Math.PI * 2;
      d.last = [p.x, p.y];
      d.add.push({ id: uid("p"), k: P.id, x: Math.round(p.x), y: Math.round(p.y), s: P.id === "hedge" ? 1 : +(0.85 + Math.random() * 0.3).toFixed(2), r: +r.toFixed(3) });
    } else for (const q of a.land.plants) if (Math.hypot(q.x - p.x, q.y - p.y) < o.r) d.gone.add(q.id);
    preview((aa) => { aa.land.plants = aa.land.plants.filter((q) => !d.gone.has(q.id)).concat(d.add); });
  }
  // ------------------------------------------------------------ finishes: textures, colours and face patterns
  st.brush = { fin: { tex: "bricks", size: 3, depth: 0.3, color: "#c9b8a0" }, pat: { kind: "" } };
  const cleanFin = (f) => { if (!f) return null; const o = {}; if (f.color) o.color = f.color; if (f.tex) { o.tex = f.tex; o.size = +f.size || 3; o.depth = +(f.depth ?? 0.3); } return Object.keys(o).length ? o : null; };
  const cleanPat = (p) => (p && p.kind && FACEPAT[p.kind] ? { kind: p.kind, size: +p.size || FACEPAT[p.kind].size / 4, gap: +(p.gap ?? FACEPAT[p.kind].g / 4), depth: +p.depth || 0.4, mode: p.mode === "cut" ? "cut" : "raise" } : null);
  const putFin = (q, f) => { const c = cleanFin(f); if (c) q.fin = c; else delete q.fin; };
  const putPat = (q, p) => { const c = cleanPat(p); if (c) q.pat = c; else delete q.pat; };
  function finishFields(body, fin, pat, onFin, onPat, base) {
    const f = { ...(fin || {}) }, S = printScale();
    body.append(el("div", { class: "subhead" }, "Finish"));
    const color = el("input", { type: "color", id: "ar-fin-color", value: f.color || base, "aria-label": "Colour" });
    color.onchange = () => onFin({ ...f, color: color.value });
    const tex = el("select", { class: "num", id: "ar-fin-tex", "aria-label": "Texture" }, el("option", { value: "" }, "Smooth (no texture)"), ...FIN_TEX.map((t) => el("option", { value: t.key, selected: t.key === f.tex }, t.name)));
    tex.onchange = () => onFin({ ...f, tex: tex.value || undefined, size: f.size || (["build", "wood"].includes((LIB.find((t) => t.key === tex.value) || {}).cat) ? 3 : 2), depth: f.depth ?? 0.3 });
    body.append(el("div", { class: "arch-inline" }, color, el("button", { class: "btn", title: "Back to the standard colour", onclick: () => onFin({ ...f, color: undefined }) }, "Standard colour")));
    body.append(row("Texture", tex));
    if (f.tex) {
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Tile (mm)", numIn(f.size || 3, (v) => onFin({ ...f, size: Math.max(0.3, v) }), "ar-fin-size", 0.5)));
      r3.append(el("label", {}, "Depth (mm)", numIn(f.depth ?? 0.3, (v) => onFin({ ...f, depth: Math.max(0.05, v) }), "ar-fin-depth", 0.1)));
      body.append(r3);
    }
    if (onPat) {
      const p = { ...(pat || {}) };
      const ps = el("select", { class: "num", id: "ar-pat-kind", "aria-label": "Face pattern" }, el("option", { value: "" }, "None"), ...Object.entries(FACEPAT).map(([k, K]) => el("option", { value: k, selected: k === p.kind }, K.name)));
      // a size that gives a few hundred shapes on a typical wall of this house
      ps.onchange = () => {
        const K = FACEPAT[ps.value]; if (!K) { onPat(null); return; }
        const e = buildingExtent(AC()), face = e ? (Math.max(e.x1 - e.x0, e.y1 - e.y0) * (e.z1 - e.z0) * 0.5) / (S * S) : 4000;
        const sz = Math.max(K.size / 4, Math.round(Math.sqrt(face / 220) * 2) / 2);
        onPat({ kind: ps.value, size: sz, gap: +((K.g / K.size) * sz).toFixed(2), depth: 0.4, mode: p.mode || "raise" });
      };
      body.append(row("Face pattern", ps));
      if (p.kind && FACEPAT[p.kind]) {
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Size (mm)", numIn(p.size, (v) => onPat({ ...p, size: Math.max(0.5, v) }), "ar-pat-size", 0.5)));
        r3.append(el("label", {}, FACEPAT[p.kind].gap + " (mm)", numIn(p.gap, (v) => onPat({ ...p, gap: Math.max(0.1, v) }), "ar-pat-gap", 0.1)));
        r3.append(el("label", {}, "Depth (mm)", numIn(p.depth, (v) => onPat({ ...p, depth: Math.max(0.05, v) }), "ar-pat-depth", 0.1)));
        body.append(r3);
        body.append(row("Pattern", seg([["raise", "Raised"], ["cut", "Cut in"]], p.mode || "raise", (v) => onPat({ ...p, mode: v }), "ar-pat-mode")));
      }
    }
    body.append(el("p", { class: "arch-hint" }, `Texture and pattern sizes are on the printed model (1:${S}), as in Beginner and Advanced. They become real texture layers and face patterns there${onPat ? " (patterns go on the wall's outside face)" : ""}.`));
  }
  function applyFinish(h) {
    const f = cleanFin(st.brush.fin), p = cleanPat(st.brush.pat);
    update((a) => {
      const q = (h.k === "wall" ? a.walls : h.k === "roof" ? a.roofs : a.slabs).find((x) => x.id === h.id);
      if (!q) return;
      putFin(q, f);
      if (h.k === "wall") putPat(q, p);
    }, "Finish the " + { wall: "wall", roof: "roof", slab: "floor" }[h.k]);
  }
  function finishAll(kind, fin, pat) {
    update((a) => {
      const list = kind === "wall" ? a.walls.filter((w) => w.lvl === st.level && w.h > 0) : kind === "roof" ? a.roofs : a.slabs;
      for (const q of list) { putFin(q, fin); if (kind === "wall" && pat !== undefined) putPat(q, pat); }
    }, kind === "wall" ? "Finish all walls" : kind === "roof" ? "Finish all roofs" : "Finish all floors");
  }
  function finishPanel(body) {
    panel.append(head("Finishes", "textures, colours, patterns"));
    body.append(el("p", { class: "arch-hint" }, "Set up a finish, then click walls, roofs and floors to give it to them. Patterns go on walls only."));
    finishFields(body, st.brush.fin, st.brush.pat, (v) => { st.brush.fin = v; renderPanel(); }, (v) => { st.brush.pat = v || { kind: "" }; renderPanel(); }, "#c9b8a0");
    const pre = [["Brick", { tex: "bricks", size: 3, depth: 0.3, color: "#b5654a" }], ["Siding", { tex: "siding", size: 3, depth: 0.3, color: "#e8e4da" }], ["Stucco", { tex: "stucco", size: 2, depth: 0.2, color: "#efe6d2" }], ["Stone", { tex: "stone", size: 4, depth: 0.4, color: "#a7a197" }], ["Wood", { tex: "planks", size: 4, depth: 0.25, color: "#a8784c" }], ["Shingles", { tex: "shingles", size: 3, depth: 0.35, color: "#6d4b3e" }], ["Slate", { tex: "slate", size: 3, depth: 0.3, color: "#5d6670" }], ["Metal roof", { tex: "corrugated", size: 2.5, depth: 0.3, color: "#8f9aa3" }]];
    body.append(el("div", { class: "subhead" }, "Quick picks"));
    body.append(el("div", { class: "arch-chips", id: "ar-fin-presets" }, ...pre.map(([l, f]) => el("button", { class: "btn", onclick: () => { st.brush.fin = { ...f }; renderPanel(); } }, l))));
    body.append(el("div", { class: "arch-inline" },
      el("button", { class: "btn", id: "ar-fin-walls", onclick: () => finishAll("wall", st.brush.fin, st.brush.pat) }, "All walls on " + cur().name),
      el("button", { class: "btn", id: "ar-fin-roofs", onclick: () => finishAll("roof", st.brush.fin) }, "All roofs")));
  }
  // ------------------------------------------------------------ export the house with its landscape
  // the house as triangles (full size, mm), by part, with each finished wall on its own
  function houseParts(opt) {
    const a = AC(), tmp = new THREE.Group(), parts = [];
    const take = (obj, name, color, extra = {}) => {
      tmp.add(obj); obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material && o.material.opacity < 0.9 && !opt.glass) return;
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        const isGlass = o.material && o.material.transparent && o.material.opacity < 0.9;
        parts.push({ name: isGlass ? "Glass" : name, color: isGlass ? COL.glass : o.material && o.material.color ? "#" + o.material.color.getHexString() : color, pos: g.attributes.position.array, ...extra });
        g.dispose();
      });
      tmp.remove(obj);
    };
    for (const L of a.levels) {
      for (const w of a.walls.filter((q) => q.lvl === L.id && q.h > 0)) {
        const m = anyWallMesh(a, w, L.elev, wallExt(a.walls, w));
        if (w.fin && w.fin.color) m.material.color.set(w.fin.color);
        take(m, w.log ? "Log walls" : "Walls", (w.fin && w.fin.color) || (w.log ? LOG_COL : COL.wall), { fin: w.fin, pat: w.pat, wall: w, elev: L.elev });
        for (const o of goodOpenings(a, w).ok) take(openingModel(o, w, L.elev), o.k === "door" ? "Doors" : "Windows", COL.frame);
      }
      for (const s of a.slabs.filter((q) => q.lvl === L.id)) {
        const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1), th = s.thick || 150;
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, th), mat((s.fin && s.fin.color) || COL.slab));
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, L.elev - th / 2);
        take(m, "Floors", (s.fin && s.fin.color) || COL.slab, { fin: s.fin });
      }
      for (const r of a.roofs.filter((q) => q.lvl === L.id)) take(new THREE.Mesh(roofGeometry(effRoof(a, r), L.elev + roofZ(a, r)), mat((r.fin && r.fin.color) || COL.roof)), "Roof", (r.fin && r.fin.color) || COL.roof, { fin: r.fin });
    }
    return parts;
  }
  // a texture on (already scaled) triangles, with the faces found by their direction
  function texturize(pos, fin, budget = 1.5e5) {
    const nT = pos.length / 9, key = new Array(nT), groups = new Map();
    for (let t = 0; t < nT; t++) {
      const o = t * 9, ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const d = nx * pos[o] + ny * pos[o + 1] + nz * pos[o + 2];
      const k = [nx, ny, nz].map((v) => Math.round(v * 200)).join(",") + "|" + Math.round(d * 20);
      key[t] = k;
      if (!groups.has(k)) groups.set(k, { n: [nx, ny, nz], tris: [] });
      groups.get(k).tris.push(t);
    }
    const V = new Float32Array(pos.length), faceGroups = [], faceInfo = [];
    let w = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of groups.values()) {
      const s = w; let c = [0, 0, 0];
      for (const t of g.tris) for (let i = 0; i < 9; i++) { const v = pos[t * 9 + i]; V[w++] = v; c[i % 3] += v / (g.tris.length * 3); min[i % 3] = Math.min(min[i % 3], v); max[i % 3] = Math.max(max[i % 3], v); }
      faceGroups.push([s / 3, (w - s) / 3]);
      faceInfo.push({ t: "PLANE", n: g.n, c });
    }
    const tris = new Uint32Array(pos.length / 3); for (let i = 0; i < tris.length; i++) tris[i] = i;
    const layer = { ...TEXTURE_DEFAULTS, id: "x", faces: "all", tex: fin.tex, size: fin.size || 3, depth: fin.depth ?? 0.3 };
    const r = applyTextures({ vertices: V, triangles: tris, faceGroups, faceInfo, bbox: { min, max } }, [layer], budget);
    const out = new Float32Array(r.triangles.length * 3);
    for (let i = 0; i < r.triangles.length; i++) { const v = r.triangles[i]; out[i * 3] = r.vertices[v * 3]; out[i * 3 + 1] = r.vertices[v * 3 + 1]; out[i * 3 + 2] = r.vertices[v * 3 + 2]; }
    return out;
  }
  // a raised face pattern on a wall's outside face, as little solids (print size, mm)
  function patternSolids(w, elev, pat, k, off) {
    const a = AC(), e = wallExt(a.walls, w), { L: len, ux, uy } = winfo(w);
    let { nx, ny } = winfo(w);
    const ws = a.walls.filter((q) => q.lvl === w.lvl && q.h > 0);
    let cx = 0, cy = 0; for (const q of ws) { cx += (q.a[0] + q.b[0]) / 2 / ws.length; cy += (q.a[1] + q.b[1]) / 2 / ws.length; }
    if (((w.a[0] + w.b[0]) / 2 - cx) * nx + ((w.a[1] + w.b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
    // the face in its own frame (along the wall, up), at print size
    const sgn = ux * ny - uy * nx > 0 ? 1 : -1; // keep (along, up, out) right-handed
    const u0 = -e[0] * k, u1 = (len + e[1]) * k, h = w.h * k, border = 0.6;
    const opens = goodOpenings(a, w).ok.map((o) => [o.s * k - border, o.sill * k - border, (o.s + o.w) * k + border, (o.sill + o.h) * k + border]);
    const circ = (c) => Array.from({ length: 16 }, (_, i) => [c.c[0] + c.r * Math.cos((i / 16) * Math.PI * 2), c.c[1] + c.r * Math.sin((i / 16) * Math.PI * 2)]);
    const cells = facePatCells({ ...pat, size: pat.size, gap: pat.gap }, [u0, 0, u1, h]).map((c) => (c.pts ? c : c.r ? { ...c, pts: circ(c) } : c)).filter((c) => {
      const pts = c.pts || []; if (pts.length < 3) return false;
      for (const [x, y] of pts) { if (x < u0 + border || x > u1 - border || y < border || y > h - border) return false; }
      const bx0 = Math.min(...pts.map((p) => p[0])), bx1 = Math.max(...pts.map((p) => p[0])), by0 = Math.min(...pts.map((p) => p[1])), by1 = Math.max(...pts.map((p) => p[1]));
      return !opens.some((o) => bx1 > o[0] && bx0 < o[2] && by1 > o[1] && by0 < o[3]);
    }).slice(0, 6000);
    const P = [], d = pat.depth || 0.4, ox = ((w.a[0] + nx * (w.t / 2)) - off[0]) * k, oy = ((w.a[1] + ny * (w.t / 2)) - off[1]) * k, oz = (elev - off[2]) * k;
    const W3 = (u, v, s) => [ox + ux * u + nx * s, oy + uy * u + ny * s, oz + v];
    for (const c of cells) {
      let pts = c.pts; if (sgn > 0) pts = pts.slice().reverse();
      const n = pts.length;
      for (let i = 1; i + 1 < n; i++) { P.push(...W3(...pts[0], d), ...W3(...pts[i], d), ...W3(...pts[i + 1], d)); P.push(...W3(...pts[0], -0.02), ...W3(...pts[i + 1], -0.02), ...W3(...pts[i], -0.02)); }
      for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; const A1 = W3(...p, -0.02), B1 = W3(...q, -0.02), C1 = W3(...q, d), D1 = W3(...p, d); P.push(...A1, ...B1, ...C1, ...A1, ...C1, ...D1); }
    }
    return new Float32Array(P);
  }
  function exportDialog() {
    const a = AC(), L = a.land, ext = buildingExtent(a);
    if (!ext && !L) { app.toast("Draw and raise some walls (or make the ground) first."); return; }
    const opt = Object.assign({ fmt: "3mf", house: true, ground: true, water: true, plants: true, glass: false, finishes: true, scale: "fit", base: 3 }, pref("export", {}));
    if (!L) { opt.ground = opt.water = opt.plants = false; }
    const arr = L ? LAND.landArrays(L) : null;
    // the whole scene's extent (full size)
    const whole = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      if (opt.house && ext) { x0 = ext.x0; y0 = ext.y0; x1 = ext.x1; y1 = ext.y1; z0 = ext.z0; z1 = ext.z1; }
      if (L && (opt.ground || opt.water || opt.plants)) {
        let lo = Infinity, hi = -Infinity; for (const v of arr.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        x0 = Math.min(x0, L.x0); y0 = Math.min(y0, L.y0); x1 = Math.max(x1, L.x0 + (L.nx - 1) * L.res); y1 = Math.max(y1, L.y0 + (L.ny - 1) * L.res);
        z0 = Math.min(z0, lo); z1 = Math.max(z1, hi + (opt.plants && L.plants.length ? Math.max(...L.plants.map((p) => (LAND.PLANTS.find((q) => q.id === p.k) || { h: 0 }).h * (p.s || 1))) : 0));
      }
      if (!isFinite(x0)) return null;
      return { x0, y0, x1, y1, z0, z1 };
    };
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const size = el("p", { class: "arch-hint", id: "ar-exp-size" });
    const scaleOf = () => { const w = whole(); if (!w) return 100; if (opt.scale !== "fit") return opt.scale; let s = fitScale({ ...w, z0: w.z0 - (opt.ground ? opt.base * 50 : 0) }); for (let i = 0; i < 4; i++) { const s2 = fitScale({ ...w, z0: w.z0 - (opt.ground ? opt.base * s : 0) }); if (s2 === s) break; s = s2; } return s; };
    const fitOpt = el("option", { value: "fit" });
    const showSize = () => {
      const w = whole(); if (!w) { size.textContent = "Nothing to export: pick something to include."; return; }
      const S = scaleOf(), k = 1 / S, base = opt.ground ? opt.base : 0;
      fitOpt.textContent = `Fit the 256 mm build plate (${scaleName(opt.scale === "fit" ? S : fitScale(w))})`;
      size.textContent = `About ${((w.x1 - w.x0) * k).toFixed(1)} × ${((w.y1 - w.y0) * k).toFixed(1)} × ${((w.z1 - w.z0) * k + base).toFixed(1)} mm at ${scaleName(S)}.` + ((w.x1 - w.x0) * k > 256 || (w.y1 - w.y0) * k > 256 ? " That is bigger than most build plates: pick a smaller scale." : "");
    };
    const scaleSel = el("select", { class: "num", id: "ar-exp-scale" }, fitOpt, ...SCALES.filter((q) => q[1] > 1).map(([l, v, note]) => el("option", { value: v, selected: v === opt.scale }, `${l} · ${note}`)), el("option", { value: 300, selected: opt.scale === 300 }, "1:300"), el("option", { value: 500, selected: opt.scale === 500 }, "1:500"));
    fitOpt.selected = opt.scale === "fit";
    scaleSel.onchange = () => { opt.scale = scaleSel.value === "fit" ? "fit" : +scaleSel.value; showSize(); };
    const chk = (k, label, dis) => el("label", { class: "check" + (dis ? " dis" : "") }, el("input", { type: "checkbox", id: "ar-e-" + k, checked: opt[k] && !dis, disabled: !!dis, onchange: (e) => { opt[k] = e.target.checked; showSize(); } }), label);
    const fmtSeg = seg([["3mf", "3MF (colours)"], ["obj", "OBJ (colours)"], ["stl", "STL"]], opt.fmt, (v) => { opt.fmt = v; fmtSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent.toLowerCase().startsWith(v)))); }, "ar-e-fmt");
    const baseIn = numIn(opt.base, (v) => { opt.base = Math.max(0.6, v); showSize(); }, "ar-e-base", 0.5);
    const go = el("button", { class: "btn primary", id: "ar-exp-go", onclick: async () => {
      go.disabled = true; go.textContent = "Making the file…";
      try { await doExport(opt, scaleOf(), arr); try { localStorage.setItem("jumpstart3d.arch.export", JSON.stringify(opt)); } catch (e) {} back.remove(); }
      catch (err) { console.error(err); app.toast("Couldn't export: " + (err.message || err)); go.disabled = false; go.textContent = "Export"; }
    } }, "Export");
    const modal = el("div", { class: "modal arch-send", role: "dialog", "aria-label": "Export house and landscape" },
      el("header", {}, el("h2", {}, "Export house and landscape"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", { class: "arch-hint" }, "Everything is scaled down together (the house sits on the ground), centered and standing on the build plate. 3MF and OBJ keep the colours: grass, water, trees, walls and roof. Each part is its own object, ready for a multi-colour printer."),
        row("Format", fmtSeg), row("Scale", scaleSel), size,
        el("div", { class: "subhead" }, "Include"),
        el("div", { class: "arch-checks" }, chk("house", "House", !ext), chk("ground", "Ground", !L), chk("water", "Water", !L), chk("plants", "Trees and plants", !L || !L.plants.length), chk("glass", "Window glass", !ext), chk("finishes", "Textures and raised patterns", !ext)),
        row("Ground base (mm)", baseIn),
        el("div", { class: "arch-inline", style: { justifyContent: "flex-end", marginTop: "10px" } }, el("button", { class: "btn", onclick: () => back.remove() }, "Cancel"), go)));
    back.append(modal); document.body.append(back);
    showSize();
  }
  async function doExport(opt, S, arr) {
    const a = AC(), L = a.land, k = 1 / S, ext = buildingExtent(a);
    let parts = [];
    let zb = ext ? ext.z0 : 0;
    if (L && opt.ground) { const g = LAND.groundSolid({ ...L, base: opt.base * S }, arr); zb = g.zb; parts.push(g); }
    else if (L && (opt.water || opt.plants)) { let lo = Infinity; for (const v of arr.h) lo = Math.min(lo, v); zb = Math.min(zb, lo); }
    if (L && opt.water) { const w = LAND.waterSolid(L, arr); if (w) parts.push(w); }
    if (L && opt.plants && L.plants.length) parts.push(...LAND.plantSolids(L, arr, L.plants));
    const house = opt.house && ext ? houseParts(opt) : [];
    // the middle of everything, standing on the plate
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of [...parts, ...house]) for (let i = 0; i < p.pos.length; i += 3) { x0 = Math.min(x0, p.pos[i]); x1 = Math.max(x1, p.pos[i]); y0 = Math.min(y0, p.pos[i + 1]); y1 = Math.max(y1, p.pos[i + 1]); }
    if (!isFinite(x0)) throw new Error("nothing to export");
    const off = [(x0 + x1) / 2, (y0 + y1) / 2, zb];
    // the house at print size, with its textures and raised patterns
    const out = [];
    const sc = (pos) => { const q = new Float32Array(pos.length); for (let i = 0; i < q.length; i += 3) { q[i] = (pos[i] - off[0]) * k; q[i + 1] = (pos[i + 1] - off[1]) * k; q[i + 2] = (pos[i + 2] - off[2]) * k; } return q; };
    let skipped = 0;
    // about 300 000 textured triangles for the whole house, shared between its textured parts
    const nTex = house.filter((p) => p.fin && p.fin.tex).length, budget = Math.max(3e4, 3e5 / Math.max(1, nTex));
    for (const p of house) {
      let pos = sc(p.pos);
      if (opt.finishes && p.fin && p.fin.tex) { try { pos = texturize(pos, p.fin, budget); } catch (e) { console.warn("texture", e); } }
      out.push({ name: p.name === "Walls" && p.fin && p.fin.tex ? "Walls " + finName(p.fin) : p.name, color: p.color, pos });
      if (opt.finishes && p.pat && p.pat.kind) {
        if (p.pat.mode === "cut") skipped++;
        else { const ps = patternSolids(p.wall, p.elev, cleanPat(p.pat), k, off); if (ps.length) out.push({ name: "Wall pattern", color: p.color, pos: ps }); }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    // the same names and colours become one object each
    const merged = new Map();
    for (const p of [...parts.map((q) => ({ ...q, pos: sc(q.pos) })), ...out]) {
      const key = p.tcol ? p.name + "#" + Math.random() : p.name + "|" + p.color;
      if (!merged.has(key)) merged.set(key, { ...p, chunks: [] });
      merged.get(key).chunks.push(p.pos);
    }
    const list = [...merged.values()].map((m) => { if (m.chunks.length === 1) return { ...m, pos: m.chunks[0] }; const n = m.chunks.reduce((s, c) => s + c.length, 0), pos = new Float32Array(n); let o = 0; for (const c of m.chunks) { pos.set(c, o); o += c.length; } return { name: m.name, color: m.color, pos }; });
    const names = new Map(); for (const p of list) { const n = names.get(p.name) || 0; names.set(p.name, n + 1); if (n) p.name += " " + (n + 1); }
    const title = "House and landscape", base = "house-and-landscape";
    let bytes;
    if (opt.fmt === "stl") bytes = LAND.stlFile(list, 1, [0, 0, 0]);
    else if (opt.fmt === "obj") bytes = LAND.objFile(list, 1, [0, 0, 0], title);
    else bytes = await LAND.threeMFFile(list, 1, [0, 0, 0], title);
    await app.projects.saveModel(base + "." + opt.fmt, bytes);
    app.onExport && app.onExport(opt.fmt);
    const tris = list.reduce((s, p) => s + p.pos.length / 9, 0);
    app.toast(`Saved ${base}.${opt.fmt}: ${list.length} part${list.length > 1 ? "s" : ""}, ${Math.round(tris).toLocaleString()} triangles, at ${scaleName(S)}.` + (skipped ? " Cut-in wall patterns are made in Beginner and Advanced (send the house there)." : ""));
    st.exported = opt.fmt;
  }
  // ------------------------------------------------------------ Simulate: weather, moving water and a flood test
  st.flood = { mode: "rain", rate: 50, hours: 3, level: null, sim: null, mesh: null, result: null, running: false, wx0: null };
  // the house on the landscape grid: cells under it (walls and everything inside them), its floor and its doors
  function houseOnGrid(L) {
    const a = AC(), lv = [...a.levels].sort((p, q) => p.elev - q.elev)[0], ws = a.walls.filter((w) => w.lvl === lv.id && w.h > 0);
    const { nx, ny, res } = L, n = nx * ny, mask = new Uint8Array(n);
    for (const w of ws) {
      const { L: len, ux, uy } = winfo(w), r = w.t / 2 + res * 0.5;
      for (let u = -r; u <= len + r; u += res / 2) {
        const px = w.a[0] + ux * u, py = w.a[1] + uy * u;
        for (let s = -r; s <= r; s += res / 2) {
          const x = px - uy * s, y = py + ux * s, i = Math.round((x - L.x0) / res), j = Math.round((y - L.y0) / res);
          if (i >= 0 && j >= 0 && i < nx && j < ny) mask[j * nx + i] = 1;
        }
      }
    }
    // everything the walls enclose is under the house too (reach in from the edges of the land)
    const out = new Uint8Array(n), stack = [];
    for (let i = 0; i < nx; i++) stack.push(i, (ny - 1) * nx + i);
    for (let j = 0; j < ny; j++) stack.push(j * nx, j * nx + nx - 1);
    while (stack.length) { const q = stack.pop(); if (out[q] || mask[q]) continue; out[q] = 1; const i = q % nx, j = (q / nx) | 0; if (i > 0) stack.push(q - 1); if (i < nx - 1) stack.push(q + 1); if (j > 0) stack.push(q - nx); if (j < ny - 1) stack.push(q + nx); }
    for (let q = 0; q < n; q++) if (!out[q]) mask[q] = 1;
    const doors = [];
    for (const w of ws) for (const o of goodOpenings(a, w).ok) {
      if (o.sill > 1) continue;
      const { ux, uy, nx: wx, ny: wy } = winfo(w), u = o.s + o.w / 2, cx = w.a[0] + ux * u, cy = w.a[1] + uy * u, off = w.t / 2 + res * 1.2;
      for (const sg of [1, -1]) {
        const x = cx + wx * off * sg, y = cy + wy * off * sg, i = Math.round((x - L.x0) / res), j = Math.round((y - L.y0) / res);
        if (i >= 0 && j >= 0 && i < nx && j < ny && !mask[j * nx + i]) { doors.push({ name: (PRESETS[o.preset] || {}).name || "Door", x, y, id: o.id }); break; }
      }
    }
    return { mask, floor: lv.elev, doors, level: lv };
  }
  const RATES_MM = [["Light 10 mm/h", 10], ["Heavy 25 mm/h", 25], ["Very heavy 50 mm/h", 50], ["Cloudburst 100 mm/h", 100], ["Hurricane 150 mm/h", 150]];
  const RATES_IN = [["Light ½\"/h", 12.7], ["Heavy 1\"/h", 25.4], ["Very heavy 2\"/h", 50.8], ["Cloudburst 4\"/h", 101.6], ["Hurricane 6\"/h", 152.4]];
  function floodClear(keepResult) {
    const F = st.flood;
    if (F.raf) cancelAnimationFrame(F.raf);
    F.raf = 0; F.running = false;
    if (F.mesh) { landRoot.remove(F.mesh); F.mesh.geometry.dispose(); F.mesh = null; }
    if (LB.water) LB.water.visible = true;
    if (F.wx0) { WX.set(F.wx0); F.wx0 = null; }
    F.sim = null;
    if (!keepResult) F.result = null;
    drawOverlay(); vp.request();
  }
  function floodRun() {
    const a = AC(), L = a.land, F = st.flood;
    if (!L) { app.toast("Make the ground first (Landscape)."); return; }
    if (!a.walls.some((w) => w.h > 0)) { app.toast("Raise the walls of a house first: the test checks the water against its floor and doors."); return; }
    floodClear();
    const arr = LAND.landArrays(L), house = houseOnGrid(L), sim = LAND_FLOOD.makeFlood(L, arr, house);
    F.sim = sim; F.house = house; F.arr = arr; F.running = true; F.result = null;
    if (LB.water) LB.water.visible = false;
    if (F.mode === "rain") { F.wx0 = { on: WX.state.on, kind: WX.state.kind }; WX.set({ on: true, kind: F.rate >= 100 ? "storm" : "rain" }); }
    let lo = Infinity; for (let i = 0; i < L.nx; i++) lo = Math.min(lo, arr.h[i], arr.h[(L.ny - 1) * L.nx + i]); for (let j = 0; j < L.ny; j++) lo = Math.min(lo, arr.h[j * L.nx], arr.h[j * L.nx + L.nx - 1]);
    const target = F.level ?? house.floor + (isInch() ? 12 * IN : 300), t0 = performance.now(), total = F.hours * 3600, after = 1800, dt = 30;
    let frames = 0;
    const frame = () => {
      F.raf = 0;
      if (!active || st.tool !== "sim" || F.sim !== sim) return;
      if (F.mode === "rain") {
        const t1 = performance.now();
        while (sim.t < total + after && performance.now() - t1 < 28) sim.step(dt, sim.t < total ? F.rate : 0);
        F.done = sim.t >= total + after;
        F.clock = sim.t;
      } else {
        const k = Math.min(1, (performance.now() - t0) / 3500), lvl = lo + (target - lo) * (1 - Math.pow(1 - k, 2));
        sim.rise(lvl); F.clock = lvl; F.done = k >= 1;
      }
      F.mesh = LAND_FLOOD.floodMesh(L, arr, sim.d, F.mesh);
      if (!F.mesh.parent) landRoot.add(F.mesh);
      frames++;
      if (F.done || frames % 8 === 0) { F.result = sim.report(true); drawOverlay(); renderSimResult(); }
      vp.request();
      if (F.done) { F.running = false; renderPanel(); return; }
      F.raf = requestAnimationFrame(frame);
    };
    F.raf = requestAnimationFrame(frame);
    renderPanel();
  }
  // make the house flood-safe: lift it on a pad of ground that slopes away on every side
  function floodFix() {
    const F = st.flood, a = AC(), L = a.land, r = F.result;
    if (!L || !r) return;
    const step = isInch() ? 6 * IN : 150, need = Math.max(isInch() ? 12 * IN : 300, Math.ceil((Math.max(0, r.over) + (isInch() ? 6 * IN : 150)) / step) * step);
    const arr = LAND.landArrays(L), house = houseOnGrid(L), ext = buildingExtent(a), floor = house.floor + need, fall = isInch() ? 10 * FT : 3000;
    for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      const x = L.x0 + i * L.res, y = L.y0 + j * L.res, q = j * L.nx + i;
      const dx = Math.max(ext.x0 - x, 0, x - ext.x1), dy = Math.max(ext.y0 - y, 0, y - ext.y1), dd = Math.hypot(dx, dy);
      // the ground under the house at the new floor, then sloping down (5%, more near the walls)
      const want = house.mask[q] || dd < L.res ? floor : floor - (isInch() ? 6 * IN : 150) - dd * 0.06;
      if (want > arr.h[q]) arr.h[q] = want;
    }
    update((aa) => {
      for (const lv of aa.levels) lv.elev += need;
      aa.land = LAND.packArrays(aa.land, arr);
    }, "Raise the house on a graded pad");
    floodClear();
    app.toast(`The house is ${fmtLen(need)} higher, on a pad of ground that slopes away from it. Run the test again.`);
  }
  function renderSimResult() {
    const box = panel.querySelector("#ar-flood-result");
    if (!box) return;
    const F = st.flood, r = F.result;
    box.replaceChildren();
    if (!r) return;
    const clock = F.mode === "rain" ? `${Math.floor(F.clock / 3600)} h ${String(Math.round((F.clock % 3600) / 60)).padStart(2, "0")} min${F.clock > F.hours * 3600 ? " (rain over, draining)" : ""}` : `water at ${fmtLen(F.clock)}`;
    box.append(el("div", { class: "arch-hint" }, (F.running ? "Running… " : "Done: ") + clock + (F.mode === "rain" ? ` · ${fmtLen(F.sim ? F.sim.rained : 0)} of rain` : "")));
    const bad = r.flooded || r.doors.some((d) => d.over > 0);
    box.append(el("div", { class: "flood-verdict " + (bad ? "bad" : "good"), id: "ar-flood-verdict" },
      bad ? `Flooded: water gets ${fmtLen(Math.max(r.over, ...r.doors.map((d) => d.over)))} above the floor.` : r.maxDepth >= 3 ? `Dry inside: the water stays ${fmtLen(-r.over)} below the floor.` : "Dry: no water collects against the house."));
    for (const d of r.doors) box.append(el("div", { class: "arch-hint" }, `${d.over > 0 ? "✗" : "✓"} ${d.name}: ` + (d.depth >= 3 ? `${fmtLen(d.depth)} of water outside` + (d.over > 0 ? `, ${fmtLen(d.over)} over the floor` : "") : "dry")));
    if (bad && !F.running) {
      box.append(el("p", { class: "arch-hint" }, "Ways to fix it: raise the floor and slope the ground away from the house (at least 6\" in the first 10', or 150 mm in 3 m), keep doors on the high side, dig a pond or swale to catch the water, or use ground that soaks it up (grass, gravel, mulch) instead of paving."));
      box.append(el("button", { class: "btn primary", id: "ar-flood-fix", onclick: () => floodFix() }, "Fix it: raise the house on a graded pad"));
    }
  }
  function simPanel(body) {
    const a = A(), F = st.flood, W = WX.state, wx = (o2) => { WX.set(o2); saveWx(); renderPanel(); };
    panel.append(head("Simulate", "weather · water · flooding"));
    if (!a.land) {
      body.append(el("p", { class: "arch-hint" }, "Simulate the weather around your house, make ponds and lakes ripple, and test the house and its landscape for flooding. It all happens on the ground around the house, so make the ground first."));
      body.append(el("button", { class: "btn primary", id: "ar-sim-land", onclick: () => setTool("land") }, "Make the ground (Landscape)"));
      return;
    }
    body.append(el("div", { class: "subhead" }, "Flood test"));
    body.append(el("p", { class: "arch-hint" }, "Will this house stay dry? Rain falls (and runs off the roof), soaks into the ground and flows downhill; or a river or the sea rises from the edges of the land."));
    body.append(seg([["rain", "Rainstorm"], ["rise", "Rising water"]], F.mode, (v) => { F.mode = v; floodClear(); renderPanel(); }, "ar-flood-mode"));
    if (F.mode === "rain") {
      body.append(el("div", { class: "arch-chips", id: "ar-flood-rate" }, ...(isInch() ? RATES_IN : RATES_MM).map(([l, v]) => el("button", { class: "btn", "aria-pressed": String(Math.abs(F.rate - v) < 1), "data-r": Math.round(v), onclick: () => { F.rate = v; renderPanel(); } }, l))));
      body.append(row("For", seg([[1, "1 hour"], [3, "3 hours"], [6, "6 hours"], [24, "1 day"]], F.hours, (v) => { F.hours = v; renderPanel(); }, "ar-flood-hours")));
    } else {
      const hs = houseOnGrid(a.land);
      body.append(row("Water rises to", lenField(F.level ?? hs.floor + (isInch() ? 12 * IN : 300), (v) => { F.level = v; }, "ar-flood-level")));
      body.append(el("p", { class: "arch-hint" }, `The house's floor is at ${fmtLen(hs.floor)}. Heights are measured from the plan's ground level (0).`));
    }
    body.append(el("div", { class: "arch-inline" },
      el("button", { class: "btn primary", id: "ar-flood-run", onclick: () => floodRun() }, F.running ? "Running…" : F.result ? "Run again" : "Run the flood test"),
      F.result || F.running ? el("button", { class: "btn", id: "ar-flood-reset", onclick: () => { floodClear(); renderPanel(); } }, "Clear") : null));
    body.append(el("div", { id: "ar-flood-result", class: "flood-result" }));
    body.append(el("div", { class: "subhead" }, "Weather"));
    body.append(el("div", { class: "arch-inline" },
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-wx-on", checked: W.on, onchange: (e) => wx({ on: e.target.checked }) }), "Show the weather"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-wx-water", checked: W.water, onchange: (e) => wx({ water: e.target.checked }) }), "Moving water")));
    body.append(el("div", { class: "arch-cat land", id: "ar-wx-kind" }, ...WEATHER.map((q) => el("button", { class: "btn", "aria-pressed": String(W.on && W.kind === q.id), "data-w": q.id, onclick: () => wx({ on: true, kind: q.id }) }, q.name))));
    const r3w = el("div", { class: "row3" });
    r3w.append(el("label", {}, "Wind %", numIn(Math.round(W.wind * 100), (v) => wx({ wind: Math.max(0, Math.min(1, v / 100)) }), "ar-wx-wind", 10)));
    r3w.append(el("label", {}, "Waves %", numIn(Math.round(W.waves * 100), (v) => wx({ waves: Math.max(0, Math.min(1, v / 100)) }), "ar-wx-waves", 10)));
    body.append(r3w);
    body.append(el("p", { class: "arch-hint" }, "The weather and waves are for looking at; the flood test only shows water. None of them change the design or the exported model."));
    requestAnimationFrame(renderSimResult);
  }

  // ------------------------------------------------------------ floor plans as drawings (PDF, SVG, DXF)
  function planDialog() {
    const a = AC();
    if (!a.walls.length) { app.toast("Draw some walls first: the floor plan is made from them."); return; }
    const inch = isInch();
    const opt = Object.assign({ fmt: "pdf", levels: "current", paper: inch ? "letter" : "a4", scale: inch ? 48 : 50, dims: true, swings: true }, pref("plan", {}));
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const note = el("p", { class: "arch-hint", id: "ar-pe-note" });
    const sheets = () => (opt.levels === "all" ? a.levels : [cur()]).map((L) => ({ title: (store.doc.name || "Floor plan") + " - " + L.name, sub: "", lvl: L.id, drawing: planDrawing(a, L.id, { fmt: fmtLen, dims: opt.dims, swings: opt.swings, presets: PRESETS, winfo, wallExt, goodOpenings }) }));
    const scaleLabel = (sc) => (sc === "fit" ? "fit to the page" : sc === 48 ? '1/4" = 1\' (1:48)' : sc === 96 ? '1/8" = 1\' (1:96)' : sc === 24 ? '1/2" = 1\' (1:24)' : "1:" + sc);
    const check = () => {
      if (opt.fmt === "dxf") { note.textContent = `Full size, in ${inch ? "inches" : "millimetres"}, with layers for walls, doors, windows, dimensions and text. Opens in AutoCAD, LibreCAD, Fusion, SketchUp and most CAD programs.`; return; }
      const sh = sheets(), P = PAPERS[opt.paper], big = sh.filter((x) => { const b = x.drawing.box; return b && opt.scale !== "fit" && ((b.x1 - b.x0) / opt.scale > P.w - 24 || (b.y1 - b.y0) / opt.scale > P.h - 40); });
      note.textContent = `${sh.length} ${opt.fmt === "pdf" ? "page" : "drawing"}${sh.length > 1 ? "s" : ""} on ${P.name}, ${scaleLabel(opt.scale)}.` + (big.length ? " The plan is bigger than the page at this scale: pick a smaller scale, a bigger page, or Fit." : "");
    };
    const seg2 = (id, items, key) => { const g = seg(items, opt[key], (v) => { opt[key] = v; g.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(items[i][0] === v))); papRow.hidden = scRow.hidden = opt.fmt === "dxf"; check(); }, id); return g; };
    const pap = el("select", { class: "num", id: "ar-pe-paper" }, ...Object.entries(PAPERS).map(([k, P]) => el("option", { value: k, selected: k === opt.paper }, P.name))); pap.onchange = () => { opt.paper = pap.value; check(); };
    const scs = ["fit", ...(inch ? [24, 48, 96] : [20, 50, 100, 200])];
    const sc = el("select", { class: "num", id: "ar-pe-scale" }, ...scs.map((v) => el("option", { value: v, selected: v === opt.scale }, scaleLabel(v)))); sc.onchange = () => { opt.scale = sc.value === "fit" ? "fit" : +sc.value; check(); };
    const papRow = row("Paper", pap), scRow = row("Scale", sc);
    const chk = (k, label) => el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-pe-" + k, checked: opt[k], onchange: (e) => { opt[k] = e.target.checked; check(); } }), label);
    const go = el("button", { class: "btn primary", id: "ar-pe-go", onclick: async () => {
      const sh = sheets().map((x) => ({ ...x, sub: (opt.fmt === "dxf" ? "full size" : "Scale " + scaleLabel(opt.scale)) + " - made with JumpStart 3D" }));
      const bytes = opt.fmt === "pdf" ? planPDF(sh, opt.paper, opt.scale) : opt.fmt === "svg" ? planSVG(sh, opt.paper, opt.scale) : planDXF(sh, inch);
      const name = ((store.doc.name || "floor-plan").replace(/[\\/:*?"<>|]+/g, "").trim() || "floor-plan") + (opt.levels === "all" ? "" : " - " + cur().name) + "." + opt.fmt;
      try { localStorage.setItem("jumpstart3d.arch.plan", JSON.stringify(opt)); } catch (e) {}
      await app.projects.saveModel(name, bytes);
      app.onExport && app.onExport(opt.fmt);
      st.planExported = opt.fmt;
      back.remove();
      app.toast("Saved " + name);
    } }, "Save floor plan");
    const modal = el("div", { class: "modal arch-send", role: "dialog", "aria-label": "Floor plan" },
      el("header", {}, el("h2", {}, "Floor plan"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", { class: "arch-hint" }, "A drawing of the plan seen from above: solid walls, doors with their swings, windows, and the length of every wall."),
        row("Format", seg2("ar-pe-fmt", [["pdf", "PDF"], ["svg", "SVG"], ["dxf", "DXF (CAD)"]], "fmt")),
        row("Levels", seg2("ar-pe-levels", [["current", cur().name], ["all", "All levels"]], "levels")),
        papRow, scRow, chk("dims", "Dimensions"), chk("swings", "Door swings"), note,
        el("div", { class: "arch-inline", style: { justifyContent: "flex-end", marginTop: "10px" } }, el("button", { class: "btn", onclick: () => back.remove() }, "Cancel"), go)));
    back.append(modal); document.body.append(back);
    papRow.hidden = scRow.hidden = opt.fmt === "dxf";
    check();
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
    if (st.tool === "sim" && st.flood.result) for (const dr of st.flood.result.doors) label((dr.over > 0 ? "✗ " : "✓ ") + dr.name + (dr.over > 0 ? ": +" + fmtLen(dr.over) : dr.depth >= 3 ? ": " + fmtLen(dr.depth) + " water" : ": dry"), new THREE.Vector3(dr.x, dr.y, st.flood.house.floor + 2400), dr.over > 0 ? "bad" : "good");
    if (st.tool === "land" && st.brushAt && a.land && LB.arr) {
      const pts = [], r = st.land.r || IN6();
      for (let i = 0; i <= 64; i++) { const q = (i / 64) * Math.PI * 2, x = st.brushAt[0] + Math.cos(q) * r, y = st.brushAt[1] + Math.sin(q) * r; pts.push(new THREE.Vector3(x, y, LAND.heightAt(a.land, LB.arr, x, y) + 40)); }
      line(pts, st.land.mode === "water" || st.land.mode === "dry" ? 0x3d8fd6 : st.land.mode === "plant" || st.land.mode === "unplant" ? 0x4c8c39 : 0xffffff);
    }
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
    if (t !== "sim" && st.flood && (st.flood.sim || st.flood.result)) floodClear();
    if (st.draft && st.draft.kind === "chain" && st.draft.pts.length > 1) finishChain();
    st.tool = t; st.draft = null; st.ghost = null; st.snap = null; st.typed = "";
    // a standard overhang for the units in use (12" or 300 mm)
    if (Math.abs(st.roof.over - 300) < 0.01 && isInch()) st.roof.over = 12 * IN; else if (Math.abs(st.roof.over - 12 * IN) < 0.01 && !isInch()) st.roof.over = 300;
    if (t !== "select" && st.sel && st.sel.k !== "wall") st.sel = null;
    renderRibbon(); renderPanel(); rebuild(); app.status();
    vp.canvas.style.cursor = t === "select" ? "default" : "crosshair";
  }
  function select(sel) { st.sel = sel; rebuild(); renderPanel(); app.status(); }
  function newWall(a, p, q, h) { return { id: uid("w"), lvl: st.level, a: [p[0], p[1]], b: [q[0], q[1]], t: a.wallT, h: h ?? (st.autoRaise ? a.wallH : 0), ...(a.wallLog ? { log: a.wallLog } : {}), ...(a.wallColor ? { fin: { color: a.wallColor } } : {}) }; }
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
  function addRoof(rect, fit) {
    if (!rect) { app.toast("Draw some walls first: the roof covers them."); return; }
    const r = { id: uid("r"), lvl: st.level, ...(fit ? { fit: "level" } : {}), kind: st.roof.kind, x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, pitch: st.roof.pitch, over: st.roof.over, dir: st.roof.dir, flip: st.roof.flip, thick: st.roof.thick };
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
      if (["room", "roof", "floor", "land"].includes(st.tool)) return true;
      if (st.tool !== "select") return false;
      if (endHandleAt(e)) return true;
      const h = pickPart(e);
      return !!(h && ((st.sel && h.id === st.sel.id) || h.k === "roof"));
    },
    hover(e) {
      if (st.drag) return;
      const t = st.tool;
      if (t === "land") return landHandler.hover(e);
      if (t === "finish") { const h = pickPart(e, ["wall", "roof", "slab"]); vp.canvas.style.cursor = h ? "copy" : "default"; return; }
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
      if (t === "land") return landHandler.down(e);
      if (t === "finish") { const h = pickPart(e, ["wall", "roof", "slab"]); if (h) applyFinish(h); return true; }
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
      } else {
        select({ k: h.k, id: h.id });
        if (h.k === "roof") { const g = groundAt(e); st.drag = { k: "roofmove", id: h.id, g0: g ? [g.x, g.y] : null, sx: e.clientX, sy: e.clientY, moved: false }; }
      }
      return true;
    },
    move(e) {
      if (st.tool === "land") return landHandler.move(e);
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
      if (d.k === "roofmove") {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
        const g = groundAt(e); if (!g || !d.g0) return;
        const r0 = AC().roofs.find((q) => q.id === d.id), E = effRoof(AC(), r0);
        let dx = g.x - d.g0[0], dy = g.y - d.g0[1];
        if (app.snapOn !== false && !e.altKey) {
          // snap the roof's edges to the outside of the walls, else to the grid
          const o = levelOutline(AC(), r0.lvl), tol = vp.pixelSize(g) * vp.tol(14), gs = gridStep();
          const sx = (v, cands) => { let best = null; for (const c of cands) if (Math.abs(v - c) < tol && (best === null || Math.abs(v - c) < Math.abs(best))) best = c - v; return best; };
          const bx = o && sx(E.x0 + dx, [o.x0, o.x1]) !== null ? sx(E.x0 + dx, [o.x0, o.x1]) : o && sx(E.x1 + dx, [o.x0, o.x1]) !== null ? sx(E.x1 + dx, [o.x0, o.x1]) : null;
          const by = o && sx(E.y0 + dy, [o.y0, o.y1]) !== null ? sx(E.y0 + dy, [o.y0, o.y1]) : o && sx(E.y1 + dy, [o.y0, o.y1]) !== null ? sx(E.y1 + dy, [o.y0, o.y1]) : null;
          dx = bx !== null ? dx + bx : Math.round(dx / gs) * gs; dy = by !== null ? dy + by : Math.round(dy / gs) * gs;
        }
        d.moved = true;
        preview((a) => { const q = a.roofs.find((x) => x.id === d.id); Object.assign(q, { x0: E.x0 + dx, x1: E.x1 + dx, y0: E.y0 + dy, y1: E.y1 + dy }); delete q.fit; });
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
      if (st.tool === "land") return landHandler.up(e);
      const d = st.drag; st.drag = null;
      if (!d) return;
      if (d.k === "rect") {
        const moved = Math.hypot(e.clientX - st.draft.sx, e.clientY - st.draft.sy) > 6;
        if (!moved) { st.draft.waiting = true; drawOverlay(); return; } // click, then click the other corner
        finishRect(st.draft.p0, st.draft.p1);
        return;
      }
      if (d.moved) store.commitPreview({ end: "Move wall end", roofmove: "Move roof", wallmove: "Move wall", openmove: "Move " + (openById(d.id)?.k || "opening") }[d.k] || "Edit");
      else store.setPreview(null);
      st.snap = null; drawOverlay();
    },
    dblclick() { if (st.tool === "wall" && st.draft) finishChain(); },
    leave() { st.ghost = null; st.brushAt = null; if (!st.draft) st.snap = null; drawOverlay(); },
    cancel() { if (st.drag && st.drag.timer) clearInterval(st.drag.timer); st.drag = null; store.setPreview(null); drawLand(); },
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
      body.append(row("Wall type", wallTypeSelect(a.wallT, (W) => update((aa) => { aa.wallT = W.t; if (W.log) aa.wallLog = W.log; else delete aa.wallLog; }, W.log ? "Log walls" : "Wall type"), a.wallLog)));
      body.append(row("Thickness", lenField(a.wallT, (v) => update((aa) => { aa.wallT = v; }, "Wall thickness"), "ar-wallt", { min: 20 })));
      body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-autoraise", checked: st.autoRaise, onchange: (e) => { st.autoRaise = e.target.checked; } }), "Raise new walls right away (" + fmtLen(a.wallH) + ")"));
      body.append(el("p", { class: "arch-hint" }, "Snaps to the grid (" + fmtLen(gridStep()) + "), wall ends and middles, and straight 45°/90° lines. Hold Shift for any angle, Alt to turn snapping off for a moment."));
    } else if (t === "raise") {
      panel.append(head("Raise walls"));
      body.append(el("p", { class: "arch-hint" }, "Pull the floor plan up into walls. Pick a height, then raise all the walls on this level (or only the selected wall)."));
      const hf = lenField(a.wallH, (v) => update((aa) => { aa.wallH = v; }, "Wall height"), "ar-wallh", { min: 300 });
      body.append(row("Height", hf));
      body.append(chips(isInch() ? HEIGHTS_IN : HEIGHTS_MM, (v) => update((aa) => { aa.wallH = v; }, "Wall height")));
      // wall colour: pick one so the walls are easy to see (it can be changed any time in Finishes)
      const wc = a.wallColor || COL.wall, setWc = (c) => update((aa) => { aa.wallColor = c; for (const w of aa.walls) if (w.lvl === st.level) putFin(w, { ...(w.fin || {}), color: c }); }, "Wall colour");
      const ci = el("input", { type: "color", id: "ar-wallcolor", value: wc, "aria-label": "Wall colour" }); ci.onchange = () => setWc(ci.value);
      body.append(row("Wall colour", el("div", { class: "arch-inline" }, ci, el("div", { class: "arch-swatches", id: "ar-wallcolors" }, ...WALL_COLORS.map(([n, c]) => el("button", { class: "arch-sw", title: n, "aria-label": n, "aria-pressed": String(c.toLowerCase() === wc.toLowerCase()), "data-c": c, style: { background: c }, onclick: () => setWc(c) }))))));
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
      body.append(el("button", { class: "btn primary", id: "ar-roof-all", onclick: () => addRoof(levelRect(), true) }, "Cover the whole level"));
    } else if (t === "floor") {
      panel.append(head("Floor"));
      body.append(el("p", { class: "arch-hint" }, "A floor slab under the walls. Cover the whole level, or drag across the area (corner to corner)."));
      body.append(el("button", { class: "btn primary", id: "ar-floor-all", onclick: () => addSlab(levelRect()) }, "Cover the whole level"));
    } else if (t === "land") {
      landPanel(body);
    } else if (t === "finish") {
      finishPanel(body);
    } else if (t === "sim") {
      simPanel(body);
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
      // where it is: following the walls (it moves and grows with them), or placed by hand
      const E = effRoof(a, r);
      const manual = (fn, label = "Edit roof") => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id), e = effRoof(aa, q); Object.assign(q, { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 }); delete q.fit; fn(q, aa); }, label);
      body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-roof-follow", checked: r.fit === "level", onchange: (e) => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id); if (e.target.checked) q.fit = "level"; else { const ef = effRoof(aa, q); Object.assign(q, { x0: ef.x0, y0: ef.y0, x1: ef.x1, y1: ef.y1 }); delete q.fit; } }, e.target.checked ? "Roof follows the walls" : "Roof placed by hand") }), "Follow the walls (covers the whole level, and moves and grows with it)"));
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Width", lenField(Math.abs(E.x1 - E.x0), (v) => manual((q) => { const c = (q.x0 + q.x1) / 2; q.x0 = c - v / 2; q.x1 = c + v / 2; }), "ar-rw", { min: 300 })));
      r3.append(el("label", {}, "Depth", lenField(Math.abs(E.y1 - E.y0), (v) => manual((q) => { const c = (q.y0 + q.y1) / 2; q.y0 = c - v / 2; q.y1 = c + v / 2; }), "ar-rd", { min: 300 })));
      r3.append(el("label", {}, "Raise by", lenField(r.lift ?? (r.z !== undefined ? r.z - levelTop(a, r.lvl) : 0), (v) => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id); q.lift = v; delete q.z; }, "Raise roof"), "ar-rz")));
      const r3b = el("div", { class: "row3" });
      r3b.append(el("label", {}, "Center X", lenField((E.x0 + E.x1) / 2, (v) => manual((q) => { const d = v - (q.x0 + q.x1) / 2; q.x0 += d; q.x1 += d; }, "Move roof"), "ar-rx")));
      r3b.append(el("label", {}, "Center Y", lenField((E.y0 + E.y1) / 2, (v) => manual((q) => { const d = v - (q.y0 + q.y1) / 2; q.y0 += d; q.y1 += d; }, "Move roof"), "ar-ry")));
      r3b.append(el("label", {}, " ", el("button", { class: "btn", id: "ar-roof-fit", title: "Put the roof back over the walls, sitting on top of them", onclick: () => update((aa) => { const q = aa.roofs.find((x) => x.id === r.id); q.fit = "level"; delete q.z; q.lift = 0; }, "Fit roof to the walls") }, "Fit to walls")));
      body.append(r3);
      body.append(r3b);
      body.append(el("p", { class: "arch-hint" }, "The roof always sits on top of the walls under it, even when you change their height. Drag it to move it (it snaps to the corners of the walls), or nudge it with the arrow keys."));
      finishFields(body, r.fin, null, (v) => update((aa) => { putFin(aa.roofs.find((q) => q.id === r.id), v); }, "Roof finish"), null, COL.roof);
      body.append(el("button", { class: "btn", onclick: () => deleteSel() }, "Delete roof"));
    } else if (s && s.k === "slab" && a.slabs.find((q) => q.id === s.id)) {
      const q = a.slabs.find((x) => x.id === s.id);
      panel.append(head("Floor"));
      body.append(row("Thickness", lenField(q.thick || 150, (v) => update((aa) => { aa.slabs.find((x) => x.id === q.id).thick = v; }, "Floor thickness"), "ar-slabt", { min: 10 })));
      finishFields(body, q.fin, null, (v) => update((aa) => { putFin(aa.slabs.find((x) => x.id === q.id), v); }, "Floor finish"), null, COL.slab);
      body.append(el("button", { class: "btn", onclick: () => deleteSel() }, "Delete floor"));
    } else overviewPanel(body);
    panel.append(body);
    renderElev();
    app.status();
  }
  // t: thickness, log: "round" | "square" | undefined; on(type) gets the chosen WALL_TYPES entry
  function wallTypeSelect(t, on, log) {
    const s = el("select", { class: "num", id: "ar-walltype", "aria-label": "Wall type" }, el("option", { value: "" }, "Custom"),
      el("optgroup", { label: "Framed and masonry" }, ...WALL_TYPES.filter((w) => !w.log).map((w) => el("option", { value: w.id, selected: !log && Math.abs(w.t - t) < 0.5 }, w.name))),
      el("optgroup", { label: "Log cabin" }, ...WALL_TYPES.filter((w) => w.log).map((w) => el("option", { value: w.id, selected: w.log === log && Math.abs(w.t - t) < 0.5 }, w.name))));
    if (![...s.options].some((o) => o.selected && o.value)) s.value = "";
    s.onchange = () => { const W = WALL_TYPES.find((w) => w.id === s.value); if (W) on(W); };
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
    body.append(row("Type", wallTypeSelect(w.t, (W) => set((q) => { q.t = W.t; if (W.log) q.log = W.log; else delete q.log; }, "Wall type"), w.log)));
    body.append(row("Build as", seg([["", "Framed"], ["round", "Round logs"], ["square", "Square logs"]], w.log || "", (v) => set((q) => { if (v) { q.log = v; if (!q.log0 && q.t < 150) q.t = isInch() ? 8 * IN : 200; } else delete q.log; }, v ? "Log walls" : "Framed wall"), "ar-logkind")));
    body.append(el("button", { class: "btn", id: "ar-log-all", onclick: () => update((aa) => { for (const q of aa.walls) if (q.lvl === w.lvl) { if (w.log) { q.log = w.log; q.t = w.t; } else delete q.log; } }, w.log ? "All log walls" : "All framed walls") }, w.log ? "Make every wall on this level " + (w.log === "round" ? "round logs" : "square logs") : "Make every wall on this level framed"));
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
    if (w.h > 0) {
      finishFields(body, w.fin, w.pat, (v) => set((q) => putFin(q, v), "Wall finish"), (v) => set((q) => putPat(q, v), "Wall pattern"), COL.wall);
      body.append(el("button", { class: "btn", id: "ar-fin-copyall", onclick: () => finishAll("wall", w.fin || null, w.pat || null) }, "Use this finish on every wall on " + cur().name));
    }
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
    panel.append(head("Architect", L.name));
    const walls = a.walls.filter((w) => w.lvl === L.id), total = walls.reduce((s, w) => s + winfo(w).L, 0);
    const steps = [
      ["1", "Draw the floor plan", "Wall (W) or Room (R)", walls.length > 0, () => setTool("room")],
      ["2", "Raise the walls", "Raise walls (E)", walls.some((w) => w.h > 0), () => setTool("raise")],
      ["3", "Add doors and windows", "Door (D) · Window (N)", a.openings.some((o) => walls.some((w) => w.id === o.wall)), () => setTool("door")],
      ["4", "Put a roof on", "Roof (O)", a.roofs.some((r) => r.lvl === L.id), () => setTool("roof")],
      ["5", "Use it in your design", "Send to design, or just switch to Beginner", !!store.doc.archSync, () => sendDialog()],
      ["6", "Landscape and finishes (optional)", "Landscape (L) · Finishes (T) · Export", !!a.land, () => setTool("land")],
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
    btn("archFinish", "Finishes", "Textures, colours and face patterns for walls, roofs and floors (T)", () => setTool("finish"), "ar-finish", T === "finish");
    sep();
    btn("archLand", "Landscape", "Ground around the house: hills, ponds and lakes, paint, trees and bushes (L)", () => setTool("land"), "ar-land", T === "land");
    btn("archSim", "Simulate", "Weather, moving water and a flood test for the house and its landscape (S)", () => setTool("sim"), "ar-sim", T === "sim");
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
    btn("archExport", "Export", "Export the house with its landscape, scaled to fit the build plate, as 3MF, OBJ or STL", () => exportDialog(), "ar-export");
    btn("archPlanDoc", "Floor plan", "Save the floor plan as a drawing: PDF, SVG or DXF (for CAD)", () => planDialog(), "ar-planexp");
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
    const opt = { scale: "fit", walls: true, doors: true, windows: true, glass: false, roof: true, floors: true, replace: true, mode: "beginner" };
    try { const saved = JSON.parse(localStorage.getItem("jumpstart3d.arch.send") || "null"); if (saved) Object.assign(opt, saved); } catch (e) {}
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
    const size = el("p", { class: "arch-hint", id: "ar-send-size" });
    const ext = buildingExtent(AC()), fit = ext ? fitScale(ext) : 100;
    const showSize = () => { const sz = ext ? { x: ext.x1 - ext.x0, y: ext.y1 - ext.y0, z: ext.z1 - ext.z0 } : { x: 0, y: 0, z: 0 }; const k = 1 / (opt.scale === "fit" ? fit : opt.scale); size.textContent = `The model will be about ${fmtSmall(sz.x * k)} × ${fmtSmall(sz.y * k)} × ${fmtSmall(sz.z * k)}` + (opt.scale === 1 ? " (full size: too big to print, good for planning)" : sz.x * k > 256 || sz.y * k > 256 ? " (bigger than most print beds: try a smaller scale)" : "") + "."; };
    const fmtSmall = (mm) => (inch ? (mm / IN).toFixed(2) + " in" : mm.toFixed(1) + " mm");
    const scaleSel = el("select", { class: "num", id: "ar-scale" }, el("option", { value: "fit", selected: opt.scale === "fit" }, `Fit the 256 mm build plate (${scaleName(fit)})`), ...SCALES.map(([l, v, note]) => el("option", { value: v, selected: v === opt.scale }, `${l} · ${note}`)));
    scaleSel.onchange = () => { opt.scale = scaleSel.value === "fit" ? "fit" : +scaleSel.value; showSize(); };
    const chk = (k, label) => el("label", { class: "check" }, el("input", { type: "checkbox", id: "ar-s-" + k, checked: opt[k], onchange: (e) => { opt[k] = e.target.checked; } }), label);
    const modeSeg = seg([["beginner", "Beginner"], ["advanced", "Advanced"]], opt.mode, (v) => { opt.mode = v; modeSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String((i ? "advanced" : "beginner") === v))); }, "ar-s-mode");
    const go = el("button", { class: "btn primary", id: "ar-send-go", onclick: () => { try { localStorage.setItem("jumpstart3d.arch.send", JSON.stringify({ ...opt })); } catch (e) {} back.remove(); send(opt); } }, "Send to design");
    const modal = el("div", { class: "modal arch-send", role: "dialog", "aria-label": "Send to design" },
      el("header", {}, el("h2", {}, "Send to design"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
      el("div", { class: "mbody" },
        el("p", { class: "arch-hint" }, "The building becomes shapes you can edit, combine and 3D print in Beginner or Advanced: the walls (with doors and windows cut out), frames, floors and roofs. The building stays here in Architect too, so you can change it and send it again."),
        row("Scale", scaleSel), size,
        el("div", { class: "subhead" }, "Include"),
        el("div", { class: "arch-checks" }, chk("walls", "Walls"), chk("doors", "Doors"), chk("windows", "Window frames"), chk("glass", "Glass (separate part)"), chk("roof", "Roofs"), chk("floors", "Floors")),
        chk("replace", "Replace the copy sent before"),
        row("Then open", modeSeg),
        el("div", { class: "arch-inline", style: { justifyContent: "flex-end", marginTop: "10px" } }, el("button", { class: "btn", onclick: () => back.remove() }, "Cancel"), go)));
    back.append(modal); document.body.append(back);
    showSize();
  }
  // put the building into the design as shapes: centered on the origin, standing on the plate, at
  // the chosen scale (or the largest standard scale that fits a 256 mm plate)
  function transfer(opt) {
    const a = AC(), ext = buildingExtent(a);
    if (!ext) return null;
    const scale = opt.scale === "fit" || !opt.scale ? fitScale(ext) : opt.scale;
    const offset = [(ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, ext.z0];
    const list = buildingBodies(a, { ...opt, scale, offset });
    if (!list.length) return null;
    const ids = [], hash = buildingHash(a);
    store.update((doc) => {
      // if the earlier copy was moved as a whole, the new one goes to the same place
      const old = doc.bodies.filter((b) => b.arch), m0 = old.length && old.every((b) => JSON.stringify(b.m) === JSON.stringify(old[0].m)) ? old[0].m.slice() : IDENTITY.slice();
      if (opt.replace !== false) doc.bodies = doc.bodies.filter((b) => !b.arch);
      for (const b of list) {
        const id = uid("b"), bseq = nextSeq(doc);
        for (const t of b.textures || []) t.seq = nextSeq(doc);
        for (const m of b.node.mods || []) m.seq = nextSeq(doc);
        doc.bodies.push({ id, name: doc.bodies.some((x) => x.name === b.name) ? nextName(doc, b.name) : b.name, seq: bseq, color: b.color, hole: false, hidden: false, m: m0, node: b.node, arch: true, ...(b.textures ? { textures: b.textures } : {}) });
        ids.push(id);
      }
      doc.archSync = { hash, scale, manual: opt.scale !== "fit" && !!opt.scale && !opt.auto ? opt.scale : (doc.archSync && doc.archSync.manual) || null };
      if (opt.mode) doc.mode = opt.mode;
    }, opt.auto ? "Update the house in the design" : "Send building to design");
    const k = 1 / scale;
    return { ids, scale, box: new THREE.Box3(new THREE.Vector3((ext.x0 - offset[0]) * k, (ext.y0 - offset[1]) * k, 0), new THREE.Vector3((ext.x1 - offset[0]) * k, (ext.y1 - offset[1]) * k, (ext.z1 - ext.z0) * k)) };
  }
  const scaleName = (s) => (SCALES.find((q) => q[1] === s) || ["1:" + s])[0];
  function send(opt) {
    const r = transfer(opt);
    if (!r) { app.toast("Nothing to send: choose at least one part."); return; }
    app.setMode(opt.mode);
    app.select(r.ids);
    homeView(r.box);
    app.toast(`Your building is in ${opt.mode === "advanced" ? "Advanced" : "Beginner"} as ${r.ids.length} part${r.ids.length > 1 ? "s" : ""} at ${scaleName(r.scale)}. It takes a moment to build.`);
  }
  // leaving Architect: the house follows into the other mode, scaled to fit the build plate (the
  // landscape stays here); the view goes back to the home view near the origin
  function autoSync() {
    const a = AC();
    let box = null;
    if (a && a.walls.some((w) => w.h > 0)) {
      const sync = store.doc.archSync, h = buildingHash(a), have = store.doc.bodies.some((b) => b.arch);
      if (!sync || sync.hash !== h) {
        const saved = pref("send", {});
        const r = transfer({ walls: true, doors: true, windows: true, glass: !!saved.glass, roof: true, floors: true, replace: true, scale: (sync && sync.manual) || "fit", auto: true });
        if (r) { box = r.box; setTimeout(() => app.toast(`The house is here at ${scaleName(r.scale)}, so it fits the 256 × 256 mm build plate. Back in Architect it is full size again.`), 350); }
      } else if (have) box = null;
    }
    return box;
  }
  function homeView(box) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const V = vp.constructor.VIEWS ? vp.constructor.VIEWS.home : { az: (-55 * Math.PI) / 180, el: (28 * Math.PI) / 180 };
      const fit = box && !box.isEmpty() ? vp.fitParams(box) : app.scene.allBox && !app.scene.allBox().isEmpty() ? vp.fitParams(app.scene.allBox()) : { target: new THREE.Vector3(0, 0, 0), dist: 330 };
      vp.animateTo({ az: V.az, el: V.el, roll: 0, target: fit.target, dist: Math.min(fit.dist, 600) });
    }));
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
    const tools = { v: "select", w: "wall", r: "room", e: "raise", d: "door", n: "window", o: "roof", g: "floor", l: "land", t: "finish", s: "sim" };
    if (tools[k]) { setTool(tools[k]); return true; }
    if (k === "p") { togglePlan(); return true; }
    if (k === "x") { st.xray = !st.xray; renderRibbon(); rebuild(); return true; }
    if (k === "f" || k === "h") { vp.setView(k === "h" ? "home" : st.plan ? "top" : "home", box3()); return true; }
    if (/^Arrow/.test(e.key) && st.sel && st.sel.k === "roof") {
      const g = gridStep() * (e.shiftKey ? 10 : 1), dx = e.key === "ArrowLeft" ? -g : e.key === "ArrowRight" ? g : 0, dy = e.key === "ArrowDown" ? -g : e.key === "ArrowUp" ? g : 0;
      update((aa) => { const q = aa.roofs.find((x) => x.id === st.sel.id); if (!q) return; const E = effRoof(aa, q); Object.assign(q, { x0: E.x0 + dx, x1: E.x1 + dx, y0: E.y0 + dy, y1: E.y1 + dy }); delete q.fit; }, "Move roof");
      return true;
    }
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
    if (t === "land") return A().land ? "Drag on the ground with the brush. Right-drag orbits, scroll zooms. Pick Raise, Lower, Pond, Paint or Plant in the panel." : "Make the ground in the panel on the right.";
    if (t === "finish") return "Click walls, roofs and floors to give them the finish in the panel.";
    if (t === "sim") return "Run a flood test, or turn on the weather. Right-drag orbits, scroll zooms.";
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
    if (first) setTimeout(() => app.toast("Architect: start with Room (R) or Wall (W) to draw a floor plan."), 400);
    requestAnimationFrame(() => vp.resize());
  }
  function leave() {
    if (!active) return;
    if (st.draft && st.draft.kind === "chain" && st.draft.pts.length > 1) finishChain();
    let box = null;
    try { box = autoSync(); } catch (e) { console.warn("house transfer failed", e); }
    homeView(box);
    active = false;
    root.visible = ov.visible = false;
    landRoot.visible = false; vp.grid.visible = true;
    if (LB.shown) { LB.shown = false; WX.show(false); }
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
  return { enter, leave, refresh, key, hint, handler, get active() { return active; }, box: box3, setTool, state: st, send, select, weather: WX.state };
}
