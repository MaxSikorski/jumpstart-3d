// jumpstart-3d: hole pattern. One dialog (and JS3D.holePattern) that cuts a grid, a staggered grid or a circle of holes into a flat
// face: round holes as ONE ordinary Hole feature (a single `hole` mod with every position in `at`; edits later in the Hole dialog),
// square, hex and slot holes as ONE sketch with an outline per hole and ONE Extrude cut (edits later in the Extrude dialog). Either
// way it shows in the timeline and undoes in one step. Nothing here touches the geometry kernel. The hole sizes come from the Hole
// dialog's tables (passed in); the layout maths is plain functions so the dialog and the bridge share it.
import * as THREE from "three";
import { store, findBody, nextSeq, regionsFor } from "./store.js";
import { sampleCurve, resolveSketch } from "./regions.js";
import { planeMatrix } from "./scene.js";
import { M4, arr } from "./ops.js";
import { uid, el, fmt } from "./util.js";
import { getUnit, withUnit } from "./units.js";

const KINDS = ["simple", "cbore", "csink", "tapped"];
// kind -> [warn above, refuse above, what to call them]. About 4 s for 100 plain holes, 13 s for 200; tapped holes cost 2 s or more each (8 took 15 s, 12 stalled the 25 s watchdog)
const LIMITS = { simple: [100, 200, "plain holes"], cbore: [65, 130, "counterbores"], csink: [65, 130, "countersinks"], tapped: [4, 8, "tapped holes"],
  // one sketch and one cut: 200 hexagons built in 6-11 s in a 6 mm plate (watchdog 25 s); one cap for all three shapes
  square: [100, 200, "square holes"], hex: [100, 200, "hex holes"], slot: [100, 200, "slots"] };
const SHAPES = ["round", "square", "hex", "slot"];
const SHAPE_NOUN = { square: ["square hole", "square holes"], hex: ["hex hole", "hex holes"], slot: ["slot", "slots"] };
const DIRS = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
const MAX_COUNT = 200;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const isNum = (x) => typeof x === "number" && isFinite(x);

// ------------------------------------------------------------------ the face
// plain 2D helpers for the fit test
function pointSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + dx * k - x, ay + dy * k - y);
}
// the gap between two segments; a proper crossing counts as -1 so that even a margin of 0 refuses it
function segmentSegment(ax, ay, bx, by, cx, cy, dx, dy) {
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px), e = 1e-9;
  const d1 = side(ax, ay, bx, by, cx, cy), d2 = side(ax, ay, bx, by, dx, dy), d3 = side(cx, cy, dx, dy, ax, ay), d4 = side(cx, cy, dx, dy, bx, by);
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return -1;
  return Math.min(pointSegment(ax, ay, cx, cy, dx, dy), pointSegment(bx, by, cx, cy, dx, dy), pointSegment(cx, cy, ax, ay, bx, by), pointSegment(dx, dy, ax, ay, bx, by));
}
const insideConvex = (P, x, y) => P.every((p, i) => { const q = P[(i + 1) % P.length]; return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]) > 1e-9; });

// The face's triangles, its outline (triangle edges used once) and the first axis, found once per face of a built shape.
const OUTLINES = new WeakMap();
function outline(data, face) {
  let faces = OUTLINES.get(data);
  if (!faces) OUTLINES.set(data, (faces = new Map()));
  if (faces.has(face)) return faces.get(face);
  const info = data.faceInfo[face];
  const n = unit(info.n);
  const [s, cnt] = data.faceGroups[face];
  const T = data.triangles, V = data.vertices;
  const pos = (k) => [V[3 * k], V[3 * k + 1], V[3 * k + 2]];
  const key = (p) => Math.round(p[0] * 1e6) + "," + Math.round(p[1] * 1e6) + "," + Math.round(p[2] * 1e6);
  const tris = [], edges = new Map(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = s; i + 2 < s + cnt; i += 3) {
    const P = [pos(T[i]), pos(T[i + 1]), pos(T[i + 2])], K = P.map(key);
    if (K[0] === K[1] || K[1] === K[2] || K[0] === K[2]) continue;
    tris.push(P);
    for (let j = 0; j < 3; j++) {
      const a = K[j], b = K[(j + 1) % 3], id = a < b ? a + "|" + b : b + "|" + a, e = edges.get(id);
      if (e) e.count++; else edges.set(id, { a: P[j], b: P[(j + 1) % 3], count: 1 });
      for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], P[j][q]); hi[q] = Math.max(hi[q], P[j][q]); }
    }
  }
  const segs = [...edges.values()].filter((e) => e.count === 1).map((e) => [e.a, e.b]);
  // first axis: the longest outline segment if it is at least 10 % of the face's diagonal, else the body's X (or Y when the face looks
  // along X). Ties go to the segment most parallel to that fallback; the sign is chosen so the axis points the same way as it.
  const X0 = (() => { const r = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]; const d = dot(r, n); return unit([r[0] - n[0] * d, r[1] - n[1] * d, r[2] - n[2] * d]); })();
  const inPlane = (d) => { const k = dot(d, n); return [d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k]; };
  const dirs = segs.map(([a, b]) => inPlane(sub(b, a)));
  const longest = dirs.reduce((m, d) => Math.max(m, len(d)), 0);
  let U = X0;
  if (longest > 0 && longest >= 0.1 * len(sub(hi, lo))) {
    let best = null, bestPar = -1;
    for (const d of dirs) if (len(d) >= longest - 1e-3) { const par = Math.abs(dot(unit(d), X0)); if (par > bestPar) { bestPar = par; best = d; } }
    U = unit(best);
  }
  const along = dot(U, X0);
  if (along < -1e-9 || (Math.abs(along) <= 1e-9 && dot(U, cross(n, X0)) < 0)) U = [-U[0], -U[1], -U[2]];
  const out = { n, c: info.c, tris, segs, U0: U, V0: cross(n, U) };
  faces.set(face, out);
  return out;
}

// The face seen in the layout's own axes: U (turned by `angle` degrees) and V = n x U. A spot is (a, b) from the middle of the
// face's bounding rectangle in those axes. Everything is in body coordinates, where hole positions live.
export function faceFrame(base, face, angle = 0) {
  const o = outline(base.data, face);
  const th = (angle * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  const U = [0, 1, 2].map((i) => o.U0[i] * cs + o.V0[i] * sn);
  const V = cross(o.n, U);
  const c = o.c;
  const uv = (P) => { const d = sub(P, c); return [dot(d, U), dot(d, V)]; };
  const tris = new Float64Array(o.tris.length * 6), segs = new Float64Array(o.segs.length * 4);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  o.tris.forEach((P, i) => P.forEach((p, j) => {
    const [u, v] = uv(p);
    tris[i * 6 + j * 2] = u; tris[i * 6 + j * 2 + 1] = v;
    umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }));
  o.segs.forEach(([p, q], i) => { const a = uv(p), b = uv(q); segs.set([a[0], a[1], b[0], b[1]], i * 4); });
  const cu = (umin + umax) / 2, cv = (vmin + vmax) / 2;
  const inTriangle = (x, y) => {
    for (let i = 0; i < tris.length; i += 6) {
      const x0 = tris[i], y0 = tris[i + 1], x1 = tris[i + 2], y1 = tris[i + 3], x2 = tris[i + 4], y2 = tris[i + 5];
      const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d, l2 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      if (l1 >= -1e-9 && l2 >= -1e-9 && 1 - l1 - l2 >= -1e-9) return true;
    }
    return false;
  };
  // does a cutter fit? core: the points its outline is grown from, relative to the middle of the face's rectangle (one point = a round
  // hole, two = a slot's axis ends, three or more = a convex polygon, counter-clockwise); r: how far the outline stands off the core
  // (margin included). 1e-4 mm of give: the mesh's float32 vertices are 2-5e-6 off, and on a face turned in body coordinates that
  // would drop spots sitting exactly on the margin
  const fitsCore = (core, r) => {
    const P = core.map(([a, b]) => [cu + a, cv + b]);
    for (const [x, y] of P) if (!(x >= umin - 1e-4 && x <= umax + 1e-4 && y >= vmin - 1e-4 && y <= vmax + 1e-4 && inTriangle(x, y))) return false;
    const mx = P.reduce((s, p) => s + p[0], 0) / P.length, my = P.reduce((s, p) => s + p[1], 0) / P.length;
    const reach = Math.max(...P.map((p) => Math.hypot(p[0] - mx, p[1] - my))) + r, poly = P.length >= 3, edges = P.length === 1 ? 0 : poly ? P.length : 1;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
      if (pointSegment(mx, my, ax, ay, bx, by) >= reach) continue;
      let d = edges ? Infinity : pointSegment(P[0][0], P[0][1], ax, ay, bx, by);
      for (let k = 0; k < edges; k++) { const p = P[k], q = P[(k + 1) % P.length]; d = Math.min(d, segmentSegment(ax, ay, bx, by, p[0], p[1], q[0], q[1])); }
      if (d < r - 1e-4) return false;
      // an outline end point wholly inside the polygon (a hole in the face that the cutter would swallow)
      if (poly && (insideConvex(P, ax, ay) || insideConvex(P, bx, by))) return false;
    }
    return true;
  };
  const toQ = (a, b) => [0, 1, 2].map((i) => c[i] + U[i] * (cu + a) + V[i] * (cv + b));
  return {
    n: base.data.faceInfo[face].n, c, U, V, cu, cv, Wu: umax - umin, Wv: vmax - vmin,
    toP: (a, b) => toQ(a, b).map(r4),
    toQ,
    toAB: (P) => { const [u, v] = uv(P); return [u - cu, v - cv]; },
    fitsCore,
  };
}

function faceArea(data, face) {
  const [s, cnt] = data.faceGroups[face], T = data.triangles, V = data.vertices;
  let area = 0;
  for (let i = s; i + 2 < s + cnt; i += 3) {
    const p = [0, 1, 2].map((j) => [V[3 * T[i + j]], V[3 * T[i + j] + 1], V[3 * T[i + j] + 2]]);
    area += len(cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
  }
  return area;
}

// The flat face of a built body that looks along a world direction ([x, y, z]): within 1 degree, the one farthest along it; on a
// tie (0.01 mm) the one with the most area. Returns the face number, or -1.
export function findFace(base, dir) {
  const d = new THREE.Vector3(...dir).normalize(), found = [];
  base.data.faceInfo.forEach((info, i) => {
    if (!info || info.t !== "PLANE" || !info.n || !info.c) return;
    if (new THREE.Vector3(...info.n).transformDirection(base.m).angleTo(d) > Math.PI / 180) return;
    found.push({ i, far: new THREE.Vector3(...info.c).applyMatrix4(base.m).dot(d) });
  });
  if (!found.length) return -1;
  const top = Math.max(...found.map((f) => f.far));
  const tied = found.filter((f) => f.far >= top - 0.01);
  if (tied.length === 1) return tied[0].i;
  return tied.map((f) => ({ i: f.i, area: faceArea(base.data, f.i) })).sort((p, q) => q.area - p.area)[0].i;
}

// ------------------------------------------------------------------ the layout
// What is cut at each spot, in layout units (mm, relative to the spot, before the spot's turn): key (what LIMITS and the texts go
// by), hu and hv (half the extent along the row and across it, for fitting to the face), core and r (the outline is the core
// grown by r: one point + r = a round hole, two points + r = a slot, a polygon + 0), area (for the overlap check).
// h: a hole request as resolveHole returns it, or the dialog's state.
function cutterOf(h) {
  const shape = h.shape ?? "round";
  if (shape === "square") {
    const a = h.width / 2;
    return { key: "square", hu: a, hv: a, r: 0, core: [[-a, -a], [a, -a], [a, a], [-a, a]], area: h.width * h.width };
  }
  if (shape === "hex") {
    const F = h.width, k = F / Math.sqrt(3);
    return { key: "hex", hu: F / 2, hv: k, r: 0, core: [0, 1, 2, 3, 4, 5].map((i) => [k * Math.cos(Math.PI / 6 + (Math.PI * i) / 3), k * Math.sin(Math.PI / 6 + (Math.PI * i) / 3)]), area: (Math.sqrt(3) / 2) * F * F };
  }
  if (shape === "slot") {
    const W = h.width, L = h.length, c = (L - W) / 2;
    return { key: "slot", hu: L / 2, hv: W / 2, r: W / 2, core: [[-c, 0], [c, 0]], area: W * L - (4 - Math.PI) * (W / 2) ** 2 };
  }
  const R = outerR(h);
  return { key: h.kind, hu: R, hv: R, r: R, core: [[0, 0]] };
}

// layout: { type: "grid", cols, rows, fit, px, py, stagger, margin } or { type: "circle", count, radius, start, margin, center }
// (center: a body-coordinates point, or null for the middle of the face). cutter: from cutterOf.
// Returns the spots that fit on the face ({ p, n, q, turn }: p rounded for the Hole mod, q exact, turn in radians: 0 in a grid, whose
// axes already carry the Angle; the polar angle in a circle), and how many were laid out in all.
export function layoutSpots(fr, L, cutter) {
  const cand = [];
  let total, impossible = false, px, py;
  if (L.type === "grid") {
    const { cols, rows } = L;
    const fit = (w, n, h) => (n > 1 ? (w - 2 * (L.margin + h)) / (n - 1) : 0);
    px = L.fit ? fit(fr.Wu, cols, cutter.hu) : L.px; py = L.fit ? fit(fr.Wv, rows, cutter.hv) : L.py;
    total = L.stagger ? Math.ceil(rows / 2) * cols + Math.floor(rows / 2) * (cols - 1) : cols * rows;
    if (px < 0 || py < 0) impossible = true;
    else for (let j = 0; j < rows; j++) {
      const odd = L.stagger && j % 2 === 1, n = odd ? cols - 1 : cols;
      for (let i = 0; i < n; i++) cand.push([(i - (n - 1) / 2) * px, (j - (rows - 1) / 2) * py, 0]);
    }
  } else {
    total = L.count;
    const [ox, oy] = L.center ? fr.toAB(L.center) : [0, 0];
    for (let k = 0; k < L.count; k++) {
      const t = (L.start * Math.PI) / 180 + (2 * Math.PI * k) / L.count;
      cand.push([ox + L.radius * Math.cos(t), oy + L.radius * Math.sin(t), t]);
    }
  }
  const n = fr.n.slice(), r = cutter.r + L.margin;
  const turned = ([a, b, t]) => { const c = Math.cos(t), s = Math.sin(t); return cutter.core.map(([x, y]) => [a + x * c - y * s, b + x * s + y * c]); };
  const spots = impossible ? [] : cand.filter((spot) => fr.fitsCore(turned(spot), r)).map(([a, b, t]) => ({ p: fr.toP(a, b), n: n.slice(), q: fr.toQ(a, b), turn: t }));
  return { spots, total, dropped: total - spots.length, px, py };
}

// What to say about a layout of n kept holes: an error (nothing is made), a warning (slow), or nothing.
function verdict(L, cutter, n, res) {
  const [warn, max, noun] = LIMITS[cutter.key], round = KINDS.includes(cutter.key), R = cutter.hu;
  if (cutter.key === "slot" && !(cutter.hu > cutter.hv)) return { error: "A slot's length must be more than its width." };
  if (round) {
    // holes that would overlap: the pitch actually used (worked out in Fit mode; a negative one is "nothing fits" below), or the chord of the circle
    if (L.type === "circle" && 2 * L.radius * Math.sin(Math.PI / L.count) < 2 * R - 1e-9) return { error: "Holes on this circle would overlap: use a larger radius or fewer holes." };
    if (L.type === "grid" && ((L.cols > 1 && res.px >= 0 && res.px < 2 * R - 1e-9) || (L.rows > 1 && res.py >= 0 && res.py < 2 * R - 1e-9))) return { error: `Pitch must be at least the hole's width (${fmt(2 * R, 3)} mm).` };
  } else if (L.type === "grid" && ((L.cols > 1 && res.px >= 0 && res.px < 2 * cutter.hu + 0.1) || (L.rows > 1 && !L.stagger && res.py >= 0 && res.py < 2 * cutter.hv + 0.1))) {
    // no zero-width walls: they would give outlines that share an edge. (Circles are caught by the overlap check at Create.)
    return { error: `Pitch must leave a wall between holes: at least ${fmt(2 * cutter.hu + 0.1, 3)} mm along a row and ${fmt(2 * cutter.hv + 0.1, 3)} mm between rows.` };
  }
  if (n === 0) return { error: "No holes fit on this face with these settings." };
  if (n > max) return { error: `Too many holes (${n}; the most is ${max} for ${noun}). Use fewer rows or columns, or a larger pitch.` };
  if (n > warn) return { warn: `About ${n} holes: this may take a few seconds to build, longer on a phone${cutter.key === "tapped" ? " (measured in a 6 mm plate; thicker plates take longer)" : ""}.` };
  return {};
}

// ------------------------------------------------------------------ the hole
// A tapped hole's thread is cut out to dia / 2 + 0.5413 pitch + c (kernel.js, the thread mod; c = the print offset, at most 0.15 pitch).
const outerR = (h) => h.kind === "tapped" ? h.dia / 2 + 0.5413 * h.pitch + Math.min(Math.abs(h.clear), 0.15 * h.pitch)
  : Math.max(h.dia, h.kind === "cbore" ? h.cbDia : 0, h.kind === "csink" ? h.csDia : 0) / 2;

// The Hole dialog's size rule: a screw size fills the diameter (and the bore, sink or thread). T: its tables.
function applySize(h, k, T) {
  if (h.kind === "tapped") { const t = T.TAP[k]; if (!t) return; h.pitch = t[1]; h.dia = +(t[0] - 1.0825 * t[1]).toFixed(3); return; }
  if (!T.CLEAR[k]) return;
  h.dia = T.CLEAR[k];
  if (T.CBORE[k]) { h.cbDia = T.CBORE[k][0]; h.cbDepth = T.CBORE[k][1]; }
  if (T.CSINK[k]) { h.csDia = T.CSINK[k]; h.csAngle = T.isInchKey(k) ? 82 : 90; }
}

// A hole request ({ shape, kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear, width, length }) checked and
// completed, or a plain message. A shape other than round takes only width, length (slots) and depth, and comes back as
// { shape, width, length, through, depth }.
export function resolveHole(spec, T, threadOffset = 0) {
  spec = spec ?? {};
  const shape = spec.shape ?? "round";
  if (!SHAPES.includes(shape)) throw new Error('hole.shape must be "round", "square", "hex" or "slot"');
  if (shape !== "round") return resolveShape(spec, shape);
  if (spec.width != null || spec.length != null) throw new Error("hole.width and hole.length are only for square, hex and slot holes");
  const kind = spec.kind ?? "simple";
  if (!KINDS.includes(kind)) throw new Error('hole.kind must be "simple", "cbore", "csink" or "tapped"');
  const h = { shape: "round", kind, dia: 0, through: true, depth: 10, tip: false, cbDia: 6.5, cbDepth: 3.3, csDia: 6.9, csAngle: 90, size: "", pitch: 0, clear: 0 };
  if (spec.size != null) {
    const table = kind === "tapped" ? T.TAP : T.CLEAR;
    if (typeof spec.size !== "string" || !Object.prototype.hasOwnProperty.call(table, spec.size)) throw new Error(`unknown size "${spec.size}"; sizes: ${Object.keys(table).join(", ")}`);
    h.size = spec.size;
    applySize(h, h.size, T);
  }
  const positive = (key, msg) => { if (spec[key] == null) return; if (!isNum(spec[key]) || spec[key] <= 0) throw new Error(msg); h[key] = spec[key]; };
  positive("dia", "hole.dia must be a positive number of mm, or give hole.size");
  if (!(h.dia > 0)) throw new Error("hole.dia must be a positive number of mm, or give hole.size");
  if (spec.depth != null) {
    if (!isNum(spec.depth) || spec.depth <= 0) throw new Error("hole.depth must be a positive number of mm (leave it out for a through hole)");
    h.through = false; h.depth = spec.depth;
  }
  h.tip = !!spec.tip;
  for (const key of ["cbDia", "cbDepth", "csDia"]) positive(key, `hole.${key} must be a positive number of mm`);
  if (spec.csAngle != null) { if (!isNum(spec.csAngle) || spec.csAngle < 1 || spec.csAngle > 179) throw new Error("hole.csAngle must be a number of degrees from 1 to 179"); h.csAngle = spec.csAngle; }
  if (kind === "tapped") {
    positive("pitch", "hole.pitch must be a positive number of mm");
    if (!(h.pitch > 0)) throw new Error("give hole.size, or hole.pitch as a positive number of mm");
    h.clear = spec.clear ?? threadOffset;
    if (!isNum(h.clear) || h.clear < -1 || h.clear > 0) throw new Error("hole.clear must be a number from -1 to 0 (mm)");
  }
  return h;
}

function resolveShape(spec, shape) {
  for (const key of ["kind", "size", "dia", "tip", "cbDia", "cbDepth", "csDia", "csAngle", "pitch", "clear"]) if (spec[key] != null) throw new Error(`hole.${key} is only for round holes`);
  if (!isNum(spec.width) || spec.width <= 0) throw new Error("hole.width must be a positive number of mm (the square's side, the hex's width across flats, or the slot's width)");
  const h = { shape, width: spec.width, length: 0, through: true, depth: 10 };
  if (shape === "slot") {
    if (!isNum(spec.length) || spec.length <= spec.width) throw new Error("hole.length must be a number of mm, more than hole.width");
    h.length = spec.length;
  } else if (spec.length != null) throw new Error("hole.length is only for slots");
  if (spec.depth != null) {
    if (!isNum(spec.depth) || spec.depth <= 0) throw new Error("hole.depth must be a positive number of mm (leave it out for a through hole)");
    h.through = false; h.depth = spec.depth;
  }
  return h;
}

// The mod's fields, exactly as the Hole dialog writes them (without id, seq and positions).
const holeFields = (h) => {
  const tapped = h.kind === "tapped";
  return { kind: tapped ? "simple" : h.kind, dia: h.dia, through: h.through, depth: h.depth, cbDia: h.cbDia, cbDepth: h.cbDepth, csDia: h.csDia, csAngle: h.csAngle, size: h.size, tapped, pitch: tapped ? h.pitch : 0, clear: tapped ? h.clear : 0, tip: !h.through && h.tip };
};

function pushMod(doc, bodyId, h, spots) {
  const b = findBody(doc, bodyId);
  if (!b) throw new Error("no body " + bodyId);
  const id = uid("f");
  b.node.mods = b.node.mods || [];
  b.node.mods.push({ id, seq: nextSeq(doc), t: "hole", ...holeFields(h), at: spots.map((s) => ({ p: s.p.slice(), n: s.n.slice() })) });
  return id;
}

// "24 hex holes", "1 slot", "12 holes"
const countText = (n, shape) => `${n} ${shape === "round" || !shape ? (n === 1 ? "hole" : "holes") : SHAPE_NOUN[shape][n === 1 ? 0 : 1]}`;
const SKETCH_NAME = { square: "Square holes", hex: "Hex holes", slot: "Slots" };
const OVERLAP = "Some outlines overlap. Use a larger pitch or radius, or a smaller hole.";

// How far a cut from the face must go to clear the body's far side by 1 mm: the longest distance, along the inward normal, from the
// face to any vertex of the body (in world coordinates). A number, as the Extrude dialog stores "To object": a body made thicker
// later is no longer cut through.
function throughDepth(base, info) {
  const c = new THREE.Vector3(...info.c).applyMatrix4(base.m), n = new THREE.Vector3(...info.n).transformDirection(base.m), w = new THREE.Vector3(), V = base.data.vertices;
  let far = 0;
  for (let i = 0; i + 2 < V.length; i += 3) far = Math.max(far, c.dot(n) - w.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(base.m).dot(n));
  return -Math.round((far + 1) * 1000) / 1000;
}

// the sketch's outlines as line segments in world space (arcs as 12 pieces per turn), for the preview
function outlineSegments(sk) {
  const m = planeMatrix(sk.plane), out = [], v = new THREE.Vector3();
  const put = ([s, t]) => { v.set(s, t, 0).applyMatrix4(m); out.push(v.x, v.y, v.z); };
  for (const c of resolveSketch(sk)) {
    const pts = sampleCurve(c, 12);
    for (let i = 0; i + 1 < pts.length; i++) { put(pts[i]); put(pts[i + 1]); }
  }
  return new Float32Array(out);
}

// A layout request from the bridge, checked and filled in (angle and start in degrees).
function resolveLayout(spec) {
  spec = spec ?? {};
  const margin = spec.margin ?? 0;
  const count = (n, lo, msg) => { if (!Number.isInteger(n) || n < lo || n > MAX_COUNT) throw new Error(msg); };
  if (spec.type === "grid") {
    count(spec.cols, 1, "cols and rows must be whole numbers from 1 to 200");
    count(spec.rows, 1, "cols and rows must be whole numbers from 1 to 200");
    let fit = true, px = 0, py = 0;
    if (spec.pitch != null) {
      const p = Array.isArray(spec.pitch) ? spec.pitch : [spec.pitch, spec.pitch];
      if (p.length !== 2 || !p.every((x) => isNum(x) && x > 0)) throw new Error("pitch must be a positive number of mm, or [column pitch, row pitch]");
      fit = false; [px, py] = p;
    }
    if (!isNum(margin) || margin < 0) throw new Error("margin must be a number of at least 0 mm");
    const stagger = spec.stagger ?? false, angle = spec.angle ?? 0;
    if (typeof stagger !== "boolean") throw new Error("stagger must be true or false");
    if (!isNum(angle)) throw new Error("angle and start must be numbers of degrees");
    return { type: "grid", cols: spec.cols, rows: spec.rows, fit, px, py, stagger, margin, angle };
  }
  if (spec.type === "circle") {
    count(spec.count, 2, "count must be a whole number from 2 to 200");
    if (!isNum(spec.radius) || spec.radius <= 0) throw new Error("radius must be a positive number of mm");
    if (!isNum(margin) || margin < 0) throw new Error("margin must be a number of at least 0 mm");
    const start = spec.start ?? 0;
    if (!isNum(start)) throw new Error("angle and start must be numbers of degrees");
    const c = spec.center;
    if (c != null && !(Array.isArray(c) && c.length === 3 && c.every(isNum))) throw new Error("center must be [x, y, z] in mm");
    return { type: "circle", count: spec.count, radius: spec.radius, start, margin, center: c ?? null, angle: 0 };
  }
  throw new Error('layout.type must be "grid" or "circle"');
}

// ------------------------------------------------------------------ the dialog and the bridge call
export function initHolePattern(app, { openCmd, commit, row, seg, pickbox, pickBaseFace, baseOf, drawFace, ov, clearOv, offsetSelect, pitchRow, planeFromFace, CLEAR, CBORE, CSINK, TAP, isInchKey }) {
  const T = { CLEAR, CBORE, CSINK, TAP, isInchKey };

  // The sketch for square, hex and slot holes: one outline per spot, no projected face outline, no constraints (as the polygon tool
  // draws). The plane is the one every face sketch gets (x = world X), so a hand-opened sketch reads in world numbers. Returns
  // { sk, profiles, dist } with the sketch not yet numbered (seq) and profiles null when check is off (the preview). check: the
  // regions must be exactly one per spot, each the size of its cutter, or the outlines overlap.
  function shapeSketch(base, face, fr, h, cutter, spots, check) {
    const info = base.data.faceInfo[face], plane = planeFromFace({ info, base });
    const o = new THREE.Vector3(...plane.o), xs = new THREE.Vector3(...plane.x).normalize(), ns = new THREE.Vector3(...plane.n).normalize(), ys = new THREE.Vector3().crossVectors(ns, xs).normalize();
    const point = (W) => { const d = W.clone().sub(o); return [d.dot(xs), d.dot(ys)]; };
    const dir = (v) => { const w = new THREE.Vector3(...v).transformDirection(base.m); return [w.dot(xs), w.dot(ys)]; };
    const e1 = dir(fr.U), e2 = dir(fr.V), pts = [], ents = [];
    for (const spot of spots) {
      const c = point(new THREE.Vector3(...spot.q).applyMatrix4(base.m)), cs = Math.cos(spot.turn), sn = Math.sin(spot.turn);
      const f1 = [e1[0] * cs + e2[0] * sn, e1[1] * cs + e2[1] * sn], f2 = [-f1[1], f1[0]]; // the right angle counter-clockwise in the sketch, whatever the body's matrix does to V (a mirrored body turns it clockwise)
      const P = (x, y) => { const p = { id: uid("p"), x: c[0] + f1[0] * x + f2[0] * y, y: c[1] + f1[1] * x + f2[1] * y }; pts.push(p); return p.id; };
      const line = (a, b) => ents.push({ id: uid("e"), t: "line", a, b });
      if (cutter.key === "slot") {
        // counter-clockwise: the arcs run from a to b the short way round (regions.js)
        const k = cutter.core[1][0], r = cutter.r, A = P(-k, -r), B = P(k, -r), C = P(k, r), D = P(-k, r), Cr = P(k, 0), Cl = P(-k, 0);
        line(A, B); ents.push({ id: uid("e"), t: "arc", c: Cr, a: B, b: C }); line(C, D); ents.push({ id: uid("e"), t: "arc", c: Cl, a: D, b: A });
      } else {
        const ids = cutter.core.map(([x, y]) => P(x, y));
        ids.forEach((id, i) => line(id, ids[(i + 1) % ids.length]));
      }
    }
    const fc = point(new THREE.Vector3(...info.c).applyMatrix4(base.m)), tidy = (q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9));
    const sk = { id: uid("s"), name: `${SKETCH_NAME[cutter.key]} (${spots.length})`, seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts, ents, hidden: true, onBody: base.body.id, faceCenter: [tidy(fc[0]), tidy(fc[1])] };
    if (!check) return { sk, profiles: null, dist: 0 };
    const regions = regionsFor(sk);
    if (regions.length !== spots.length || regions.some((r) => Math.abs(r.area - cutter.area) > 0.02 * cutter.area)) throw new Error(OVERLAP);
    return { sk, profiles: regions.map((r) => ({ key: r.key, pt: r.pt })), dist: h.through ? throughDepth(base, info) : -h.depth };
  }

  // the sketch and its Extrude cut onto the named body; the tool starts on the face and runs into the body. Returns the cut's id.
  function pushShape(doc, bodyId, built) {
    const b = findBody(doc, bodyId);
    if (!b) throw new Error("no body " + bodyId);
    const id = uid("f");
    built.sk.seq = nextSeq(doc);
    doc.sketches.push(built.sk);
    b.node.mods = b.node.mods || [];
    b.node.mods.push({ id, seq: nextSeq(doc), t: "bool", op: "cut", tool: { t: "extrude", sketch: built.sk.id, profiles: built.profiles, dist: built.dist, mode: "one", dist2: 0, mods: [] }, m: arr(M4(b.m).invert()) });
    return id;
  }

  // used by JS3D.holePattern (after the shapes are built): one Hole feature, or for square, hex and slot a sketch and an Extrude
  // cut, in one undo step; returns { id, holes, dropped } (and sketch for the shapes)
  function add(spec) {
    spec = spec ?? {};
    const body = findBody(store.doc, spec.body);
    if (!body) throw new Error("no body " + spec.body);
    if (body.hole) throw new Error(`${body.name} is marked as a hole; holes go into solid bodies`);
    const base = baseOf(body.id), failure = app.scene.errors.get(body.id);
    if (failure) throw new Error(`${body.name} has a build error: ${failure}`);
    if (!base) throw new Error(body.hidden ? `${body.name} is hidden and has not been built; show it first` : `${body.name} has a build error: it could not be built`);
    if (!Object.prototype.hasOwnProperty.call(DIRS, spec.face)) throw new Error('face must be "+x", "-x", "+y", "-y", "+z" or "-z"');
    const face = findFace(base, DIRS[spec.face]);
    if (face < 0) throw new Error(`${body.name} has no flat face facing ${spec.face}`);
    const L = resolveLayout(spec.layout);
    const h = resolveHole(spec.hole, T, store.doc.threadOffset || 0);
    if (L.center) L.center = new THREE.Vector3(...L.center).applyMatrix4(base.m.clone().invert()).toArray();
    const fr = faceFrame(base, face, L.angle), cutter = cutterOf(h);
    const res = layoutSpots(fr, L, cutter);
    const g = verdict(L, cutter, res.spots.length, res);
    if (g.error) throw new Error(g.error);
    const label = `Hole pattern (${countText(res.spots.length, h.shape)})`;
    let id;
    if (h.shape === "round") {
      store.update((doc) => { id = pushMod(doc, body.id, h, res.spots); }, label);
      return { id, holes: res.spots.length, dropped: res.dropped };
    }
    const built = shapeSketch(base, face, fr, h, cutter, res.spots, true);
    store.update((doc) => { id = pushShape(doc, body.id, built); }, label);
    return { id, holes: res.spots.length, dropped: res.dropped, sketch: built.sk.id };
  }

  function cmd() {
    const st = {
      pick: null, click: null, res: null, fr: null, check: {},
      shape: "round", width: 6, length: 12,
      layout: "grid", cols: 4, rows: 3, fit: false, px: 10, py: 10, stagger: false, angle: 0,
      count: 6, radius: 20, start: 0, centre: false, margin: 3,
      // the Hole dialog's own defaults
      kind: "simple", dia: 3.4, through: true, depth: 10, cbDia: 6.5, cbDepth: 3.3, csDia: 6.9, csAngle: 90, size: "M3", pitch: 0.5, clear: store.doc.threadOffset || 0, tip: false,
    };
    applySize(st, st.size, T);
    let hover = null;
    const dotMaterial = new THREE.PointsMaterial({ color: 0x1f4fa8, size: 8, sizeAttenuation: false, depthTest: false, transparent: true });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x1f4fa8, depthTest: false });
    const pickable = (b) => !b.hole && !b.locked;

    const layoutOf = () => st.layout === "grid"
      ? { type: "grid", cols: st.cols, rows: st.rows, fit: st.fit, px: st.px, py: st.py, stagger: st.stagger, margin: st.margin }
      : { type: "circle", count: st.count, radius: st.radius, start: st.start, margin: st.margin, center: st.centre ? st.click : null };
    function recalc() {
      st.res = null; st.fr = null; st.check = {}; st.lines = null;
      if (!st.pick) return;
      st.fr = faceFrame(st.pick.base, st.pick.face, st.layout === "grid" ? st.angle : 0);
      st.res = layoutSpots(st.fr, layoutOf(), cutterOf(st));
      st.check = verdict(layoutOf(), cutterOf(st), st.res.spots.length, st.res);
      // the outlines for the preview, built once per change (nothing while the layout is refused: it can hold 40,000 candidates)
      if (st.shape !== "round" && st.res.spots.length && !st.check.error) st.lines = outlineSegments(shapeSketch(st.pick.base, st.pick.face, st.fr, st, cutterOf(st), st.res.spots, false).sk);
    }
    function noteLines() {
      if (!st.res) return [el("div", { class: "hint", style: { padding: 0 } }, "Click a flat face to start.")];
      const n = st.res.spots.length, k = st.res.dropped;
      const out = [el("div", { id: "hp-total", style: { fontWeight: "600" } }, countText(n, st.shape) + (k > 0 ? ` (${k} left out: they would not fit inside the face and its margin)` : ""))];
      if (st.check.error) out.push(el("div", { id: "hp-warn", class: "err-msg" }, st.check.error));
      else if (st.check.warn) out.push(el("div", { id: "hp-warn", class: "hint", style: { padding: 0 } }, st.check.warn));
      return out;
    }
    function draw() {
      clearOv();
      if (st.pick) {
        drawFace(st.pick.base, st.pick.face, 0x2f66c8);
        // one Points object for every round spot, or one LineSegments object with every outline; nothing while the layout is refused
        const spots = st.res && !st.check.error ? st.res.spots : [];
        if (st.lines) {
          const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(st.lines, 3)), lineMaterial);
          lines.renderOrder = 13;
          ov.add(lines);
        } else if (spots.length && st.shape === "round") {
          const pos = new Float32Array(spots.length * 3), v = new THREE.Vector3();
          spots.forEach((s, i) => v.set(...s.p).applyMatrix4(st.pick.base.m).toArray(pos, i * 3));
          const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)), dotMaterial);
          dots.renderOrder = 13;
          ov.add(dots);
        }
      }
      if (hover && (!st.pick || hover.face !== st.pick.face || hover.body !== st.pick.body)) drawFace(hover.base, hover.face, 0xe8a317);
    }
    function refresh(rerender = true) {
      recalc();
      if (rerender) def.render();
      else { const box = document.getElementById("hp-note"); if (box) box.replaceChildren(...noteLines()); }
      draw();
      def.refreshOk && def.refreshOk();
    }
    // where the click landed, snapped to the centre of a full circle on the face when one is within 10 px (as the Hole dialog does)
    function clickPoint(f) {
      const local = f.point.clone().applyMatrix4(f.base.m.clone().invert());
      const n = new THREE.Vector3(...f.info.n), tol = app.vp.pixelSize(f.point) * 10;
      for (const ei of f.base.data.edgeInfo || []) {
        if (ei.t !== "CIRCLE" || Math.hypot(ei.a[0] - ei.b[0], ei.a[1] - ei.b[1], ei.a[2] - ei.b[2]) > 1e-3) continue;
        const c = new THREE.Vector3((ei.a[0] + ei.m[0]) / 2, (ei.a[1] + ei.m[1]) / 2, (ei.a[2] + ei.m[2]) / 2);
        if (Math.abs(c.clone().sub(local).dot(n)) < 1e-4 && c.distanceTo(local) < tol) return c.toArray();
      }
      return local.toArray();
    }

    // numbers: counts are whole, lengths are typed in the chosen units
    const field = (id, value, onCommit, o = {}) => app.numField({ value, id, live: true, onCommit: (v) => { onCommit(v); refresh(false); }, ...o });
    const whole = (id, value, min, set) => field(id, value, (v) => set(Math.round(v)), { len: false, min, max: MAX_COUNT, step: 1 });
    const length = (id, value, set, min = 0.01) => field(id, value, set, { len: true, min, step: 1 });
    const degrees = (id, value, set) => field(id, value, set, { len: false, step: 5 });

    const def = {
      title: "Hole pattern",
      okLabel: "Create",
      valid: () => !!st.pick && !!st.res && st.res.spots.length > 0 && !st.check.error && (st.shape === "round" ? st.dia > 0 : st.width > 0),
      canOk: () => def.valid(),
      // the shapes are built (and the overlap check made) before the document is touched, so a refusal adds nothing
      apply(doc) {
        if (st.shape === "round") pushMod(doc, st.pick.body, st, st.res.spots);
        else pushShape(doc, st.pick.body, shapeSketch(st.pick.base, st.pick.face, st.fr, st, cutterOf(st), st.res.spots, true));
      },
      ok() { commit(def, `Hole pattern (${countText(st.res.spots.length, st.shape)})`); },
      hint: () => st.shape === "round"
        ? "One Hole feature with every position. Afterwards double-click it in the timeline to change the hole; to move the pattern, undo and run this again."
        : 'One sketch with every outline and one Extrude cut. Afterwards double-click "Extrude cut" in the timeline to change the depth; to move or resize the pattern, undo and run this again. A through cut is worked out from the body as it is now.',
      build(body) {
        const name = st.pick && st.pick.base.body.name;
        body.append(pickbox(true, st.pick ? el("span", {}, el("b", {}, name), " · flat face") : "Click a flat face", st.pick ? () => { st.pick = null; st.click = null; refresh(); } : null));
        body.append(row("Layout", seg([["grid", "Grid"], ["circle", "Circle"]], st.layout, (v) => { st.layout = v; refresh(); }, "hp-layout")));
        if (st.layout === "grid") {
          body.append(row("Columns", whole("hp-cols", st.cols, 1, (v) => (st.cols = v)), "hp-cols"));
          body.append(row("Rows", whole("hp-rows", st.rows, 1, (v) => (st.rows = v)), "hp-rows"));
          body.append(row("Spacing", seg([[false, "Pitch"], [true, "Fit to face"]], st.fit, (v) => { st.fit = v; refresh(); }, "hp-fit")));
          if (!st.fit) {
            body.append(row("Column pitch", length("hp-px", st.px, (v) => (st.px = v)), "hp-px"));
            body.append(row("Row pitch", length("hp-py", st.py, (v) => (st.py = v)), "hp-py"));
          }
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "hp-stagger", checked: st.stagger, onchange: (e) => { st.stagger = e.target.checked; refresh(false); } }), "Stagger every other row"));
          body.append(row("Angle", degrees("hp-angle", st.angle, (v) => (st.angle = v)), "hp-angle"));
        } else {
          body.append(row("Count", whole("hp-count", st.count, 2, (v) => (st.count = v)), "hp-count"));
          body.append(row("Radius", length("hp-radius", st.radius, (v) => (st.radius = v)), "hp-radius"));
          body.append(row("Start angle", degrees("hp-start", st.start, (v) => (st.start = v)), "hp-start"));
          body.append(row("Centre", seg([[false, "Face centre"], [true, "Where I clicked"]], st.centre, (v) => { st.centre = v; refresh(); }, "hp-centre")));
        }
        body.append(row("Edge margin", length("hp-margin", st.margin, (v) => (st.margin = v), 0), "hp-margin"));

        body.append(el("div", { class: "subhead" }, "Hole"));
        body.append(row("Shape", seg([["round", "Round"], ["square", "Square"], ["hex", "Hex"], ["slot", "Slot"]], st.shape, (v) => { st.shape = v; refresh(); }, "hp-shape")));
        if (st.shape !== "round") {
          body.append(row(st.shape === "square" ? "Side" : st.shape === "hex" ? "Across flats" : "Width", length("hp-w", st.width, (v) => (st.width = v)), "hp-w"));
          if (st.shape === "slot") body.append(row("Length", length("hp-len", st.length, (v) => (st.length = v)), "hp-len"));
          body.append(row("Extent", seg([[true, "Through all"], [false, "Depth"]], st.through, (v) => { st.through = v; refresh(); }, "hp-ext")));
          if (!st.through) body.append(row("Depth", length("hp-depth", st.depth, (v) => (st.depth = v)), "hp-depth"));
          body.append(el("div", { id: "hp-note" }, ...noteLines()));
          return;
        }
        // mirrors holeCmd's fields; keep the mod fields in step
        const kinds = seg([["simple", "Simple"], ["cbore", "Counterbore"], ["csink", "Countersink"], ["tapped", "Tapped"]], st.kind, (v) => { st.kind = v; if (st.size) applySize(st, st.size, T); refresh(); }, "hp-kind");
        kinds.classList.add("seg-wide");
        body.append(kinds);
        const sizes = st.kind === "tapped" ? Object.keys(TAP) : Object.keys(CLEAR);
        const label = (k) => st.kind === "tapped" ? (isInchKey(k) ? `${k} (${TAP[k][2]})` : `${k} × ${TAP[k][1]}`) : k + (st.kind === "simple" ? ` clearance (${withUnit(CLEAR[k], 3)})` : "");
        const opt = (k) => el("option", { value: k, selected: k === st.size }, label(k));
        const groups = [el("optgroup", { label: "Metric (ISO)" }, ...sizes.filter((k) => !isInchKey(k)).map(opt)), el("optgroup", { label: "Inch (UNC / UNF)" }, ...sizes.filter(isInchKey).map(opt))];
        if (getUnit() === "in") groups.reverse();
        const ssel = el("select", { class: "num", id: "hp-size", "aria-label": "Screw size" }, el("option", { value: "" }, "Custom"), ...groups);
        ssel.onchange = () => { st.size = ssel.value; if (st.size) applySize(st, st.size, T); refresh(); };
        body.append(row(st.kind === "tapped" ? "Thread" : "Screw size", ssel, "hp-size"));
        const custom = (set) => (v) => { set(v); st.size = ""; const s2 = document.getElementById("hp-size"); if (s2) s2.value = ""; };
        const hole = (id, value, set, min = 0.01, step = 0.5) => field(id, value, custom(set), { len: true, min, step });
        body.append(row(st.kind === "tapped" ? "Tap drill" : "Diameter", hole("hp-dia", st.dia, (v) => (st.dia = v), 0.01, 0.1), "hp-dia"));
        if (st.kind === "tapped") {
          body.append(pitchRow(st.pitch, (v) => { custom((x) => (st.pitch = x))(v); refresh(false); }, "hp-pitch", true));
          body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; refresh(false); }, "hp-clear"), "hp-clear"));
        }
        body.append(row("Extent", seg([[true, "Through all"], [false, "Depth"]], st.through, (v) => { st.through = v; refresh(); }, "hp-ext")));
        if (!st.through) {
          body.append(row("Depth", length("hp-depth", st.depth, (v) => (st.depth = v)), "hp-depth"));
          body.append(row("Bottom", seg([[false, "Flat"], [true, "118° drill"]], st.tip, (v) => { st.tip = v; refresh(); }, "hp-tip")));
        }
        if (st.kind === "cbore") {
          body.append(row("Bore dia.", hole("hp-cbd", st.cbDia, (v) => (st.cbDia = v)), "hp-cbd"));
          body.append(row("Bore depth", hole("hp-cbh", st.cbDepth, (v) => (st.cbDepth = v)), "hp-cbh"));
        }
        if (st.kind === "csink") {
          body.append(row("Sink dia.", hole("hp-csd", st.csDia, (v) => (st.csDia = v)), "hp-csd"));
          body.append(row("Sink angle", field("hp-csa", st.csAngle, custom((v) => (st.csAngle = v)), { len: false, min: 1, max: 179, step: 1 }), "hp-csa"));
        }
        body.append(el("div", { id: "hp-note" }, ...noteLines()));
      },
      start() { refresh(); },
      cleanup() { dotMaterial.dispose(); lineMaterial.dispose(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, pickable);
          hover = f && f.info && f.info.t === "PLANE" ? f : null;
          draw();
          app.vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, pickable);
          if (!f) return true;
          if (!f.info || f.info.t !== "PLANE") { app.toast("Pick a flat face."); return true; }
          st.pick = f;
          st.click = clickPoint(f);
          refresh();
          return true;
        },
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
