// Bin & Box Maker: small part bins and organiser boxes with a grid of compartments. Square
// compartments can have a finger scoop at the front and a label lip at the back; round and hex
// compartments suit bits and small parts. Bins can be stackable (a foot that sits in the rim of
// the bin below) and can come with a lid. Everything is built from plain primitives.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
const prim = (kind, p) => ({ t: "prim", kind, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])), mods: [] });
const kid = (node, m = T(), hole = false) => ({ node, m, hole });
const group = (children) => ({ t: "group", children, mods: [] });

export const BIN_DEFAULTS = {
  w: 120, d: 80, h: 40, cols: 3, rows: 2, wall: 1.6, divider: 1.2, floor: 1.2, radius: 4,
  shape: "square", inner: 2, scoop: true, scoopR: 10, label: false, labelW: 10, stack: false, foot: 3, lid: false, lidT: 2, clear: 0.25,
  // a case with a drawer, a tilt-out bin or a door; several stacked, interlocking
  style: "bin", units: 1, lock: "dovetail", caseT: 2.4, pull: "bar", hinge: "left", doorPull: "knob",
  // side by side: how many across, and how they join (rails on the right side into grooves in the left)
  across: 1, sideLock: "dovetail",
  // a door catch: bumps the door's free edge has to push past, so it stays shut until pulled
  doorCatch: "light",
  // lock clips: small plates on the back that bridge two boxes joined by dovetails, their pegs in
  // holes in both backs, so the boxes can't slide apart along the rails when you grab one
  clips: "none",
  // rail plates: plates with dovetail grooves that slide onto the open rails of two boxes, joining
  // them: across the tops of two cases side by side, or up the right side of two stacked boxes
  plates: "none", plateFit: "snug",
  // groove plates: the other way round, plates with dovetail rails that slide into the open
  // grooves of two boxes: under two cases side by side, or up the left side of a stack
  gplates: "none",
  // how the dovetails fit: the gap all round each rail in its groove
  dvFit: "normal",
};
// the gap all round a rail inside a plate's groove: snug slides on with a firm push and stays put
// dovetail fit: Normal is the set's own clearance (0.25 unless changed)
export const DV_FITS = { snug: 0.15, loose: 0.4 };
export const dvGap = (o) => DV_FITS[o.dvFit] ?? Math.max(0, o.clear ?? 0.25);
export const PLATE_FITS = { tight: 0.08, snug: 0.12, loose: 0.2 };
export const BIN_STYLES = [["bin", "Open bin"], ["drawer", "Drawer"], ["tilt", "Tilt-out bin"], ["door", "Door"]];
export const BIN_LOCKS = [["dovetail", "Dovetail rails"], ["pegs", "Pegs"], ["none", "None"]];

export function binParts(o0) {
  const o = { ...BIN_DEFAULTS, ...o0 };
  const W = Math.max(10, o.w), D = Math.max(10, o.d), H = Math.max(5, o.h);
  const cols = Math.max(1, Math.min(20, Math.round(o.cols))), rows = Math.max(1, Math.min(20, Math.round(o.rows)));
  const wall = Math.max(0.4, o.wall), div = Math.max(0.4, o.divider), floor = Math.max(0.4, o.floor);
  const foot = o.stack ? Math.max(1, Math.min(o.foot, H / 3)) : 0;
  const R = Math.max(0, Math.min(o.radius, W / 2 - 0.5, D / 2 - 0.5));
  // the walled part runs from z = foot to H; the foot (stackable) sits under it, inset to fit
  // inside the rim of the bin below, which is a recess as deep as the foot above the dividers
  const kids = [kid(prim("box", { w: W, d: D, h: H - foot, rv: R }), T(0, 0, foot))];
  if (foot) {
    const fw = W - 2 * (wall + o.clear), fd = D - 2 * (wall + o.clear);
    kids.push(kid(prim("box", { w: fw, d: fd, h: foot + 0.01, rv: Math.max(0, R - wall - o.clear) }), T(0, 0, 0)));
  }
  const iw = W - 2 * wall, id = D - 2 * wall;
  const cw = (iw - (cols - 1) * div) / cols, cd = (id - (rows - 1) * div) / rows;
  if (cw < 2 || cd < 2) throw new Error("The compartments are too small: use fewer rows or columns, or a bigger bin");
  const z0 = foot + floor, top = H - foot; // dividers stop at "top" so a bin above can sit in
  const cx = (i) => -iw / 2 + cw / 2 + i * (cw + div), cy = (j) => -id / 2 + cd / 2 + j * (cd + div);
  const holes = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const hh = H - z0 + 1;
    if (o.shape === "round") { const dia = Math.min(cw, cd); holes.push(kid(prim("cylinder", { w: dia, d: dia, h: hh }), T(cx(i), cy(j), z0), true)); }
    else if (o.shape === "hex") { const ac = Math.min(cw / Math.cos(Math.PI / 6), cd); holes.push(kid(prim("prism", { w: ac, d: ac, h: hh, sides: 6 }), T(cx(i), cy(j), z0), true)); }
    else holes.push(kid(prim("box", { w: cw, d: cd, h: hh, r: Math.max(0, Math.min(o.inner, cw / 2 - 0.05, cd / 2 - 0.05)) }), T(cx(i), cy(j), z0), true));
  }
  if (foot) holes.push(kid(prim("box", { w: iw, d: id, h: foot + 1, rv: Math.max(0, R - wall) }), T(0, 0, top), true));
  let bin = group([...kids, ...holes]);
  // finger scoops (a concave ramp at the front of each square compartment) and label lips
  if (o.shape === "square" && (o.scoop || o.label)) {
    const extra = [kid(bin)];
    const s = Math.max(1, Math.min(o.scoopR, cd * 0.6, top - z0 - 0.5));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (o.scoop) {
        // a box s x s along the front inner edge, minus a cylinder: a quarter-round cove
        const y = cy(j) - cd / 2, xw = cw - 0.02;
        const cove = group([
          kid(prim("box", { w: xw, d: s, h: s }), T(0, s / 2, 0)),
          kid(rodX(xw + 1, 2 * s), T(0, s, s), true),
        ]);
        extra.push(kid(cove, T(cx(i), y + 0.01, z0 - 0.01)));
      }
      if (o.label) {
        // a sloped shelf under the top edge of the back wall
        const lw = Math.min(o.labelW, cd * 0.45), lh = lw * 0.9;
        const yb = cy(j) + cd / 2;
        // the ramp: native wedge (x across, z up) turned so its right angle sits at the back top
        extra.push(kid(prim("wedge", { w: lw, d: cw - 0.02, h: lh }), [0, -1, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0, r6(cx(i)), r6(yb - lw / 2 + 0.01), r6(top), 1]));
      }
    }
    bin = group(extra);
  }
  let lid = null;
  if (o.lid) {
    const t = Math.max(0.8, o.lidT), lipH = Math.max(1.5, Math.min(4, H * 0.1));
    const lw = iw - 2 * o.clear, ld = id - 2 * o.clear;
    lid = group([
      kid(prim("box", { w: W, d: D, h: t, rv: R }), T(0, 0, lipH)),
      kid(prim("box", { w: lw, d: ld, h: lipH + 0.01, rv: Math.max(0, R - wall - o.clear) }), T(0, 0, 0)),
      kid(prim("box", { w: lw - 2 * wall, d: ld - 2 * wall, h: lipH, rv: Math.max(0, R - 2 * wall - o.clear) }), T(0, 0, -0.01), true),
    ]);
  }
  return { bin, lid, cell: { w: r6(cw), d: r6(cd), h: r6(top - z0) } };
}
// a round rod lying along X, centred on the origin
function rodX(len, dia) {
  // cylinder (along z) turned so its axis is x: x <- z
  return group([kid(prim("cylinder", { w: dia, d: dia, h: len }), [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -len / 2, 0, 0, 1])]);
}

// ------------------------------------------------------------------ cases: drawers, tilt-out bins, doors
// A case is a box open at the front (-Y). Inside it: a drawer that slides out, a bin that tips
// forward on two pins at its front bottom, or a door that swings on pins in the top and bottom.
// Cases stack: dovetail rails on top slide into grooves under the case above (from the front),
// or pegs on top fit holes underneath.
const Rx = (a, x = 0, y = 0, z = 0) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, r6(c), r6(s), 0, 0, r6(-s), r6(c), 0, r6(x), r6(y), r6(z), 1]; };
const line = (pts) => pts.map((a, i) => ({ t: "line", a: a.map(r6), b: pts[(i + 1) % pts.length].map(r6) }));
// a closed profile drawn in Y (across) and Z (up), extruded along +X by len
const PLANE_YZ = { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0] };
// a profile in X and Z extruded along -Y by len
const PLANE_XZ = { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] };
const extr = (outer, plane, len) => ({ t: "extrude", regions: [{ outer }], plane, dist: r6(len), mode: "one", mods: [] });
// dovetail cross-section (in X, Z): neck at z = 0, head (wider) at z = h; grown by g all round
const dovetailXZ = (neck, head, h, g = 0) => line([[-neck / 2 - g, -g], [neck / 2 + g, -g], [head / 2 + g, h + g], [-head / 2 - g, h + g]]);
// a profile segment list from points and arcs: items are [y, z] points, or { arc: [cy, cz], to: [y, z] }
function path(items) {
  const out = []; let prev = items[0];
  for (let i = 1; i <= items.length; i++) {
    const it = items[i % items.length], to = Array.isArray(it) ? it : it.to;
    if (Array.isArray(it)) out.push({ t: "line", a: prev.map(r6), b: to.map(r6) });
    else {
      const [cy, cz] = it.arc, a0 = Math.atan2(prev[1] - cz, prev[0] - cy), a1 = Math.atan2(to[1] - cz, to[0] - cy), r = Math.hypot(prev[0] - cy, prev[1] - cz);
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      out.push({ t: "arc", a: prev.map(r6), b: to.map(r6), m: [r6(cy + r * Math.cos(a0 + d / 2)), r6(cz + r * Math.sin(a0 + d / 2))] });
    }
    prev = to;
  }
  return out;
}

// joining side by side: on the right side (+X) dovetail rails or pegs; on the left side (-X) the
// matching grooves or holes. Rails run front to back and stop 3 short of the front; grooves are closed
// at the front, so the box on the right slides on from the front and stops flush.
const PLANE_SIDE = { o: [0, 0, 0], x: [0, 0, 1], n: [0, 1, 0] }; // a profile in Z (across) and +X (out), extruded along +Y
const SDV = { neck: 7, head: 10, h: 3 }, SPEG = { d: 6, h: 3 };
export const sideDepth = (lock, cl) => (lock === "dovetail" ? SDV.h + cl + 0.2 : lock === "pegs" ? SPEG.h + 0.6 : 0);
// the heights of the side rails on a box whose sides run from z0 to H
const sideZs = (H, z0 = 0) => { const h = H - z0; return h >= 45 ? [z0 + h * 0.3, z0 + h * 0.72] : [z0 + h * 0.5]; };
function sideJoints(W, D, H, lock, cl, z0 = 0) {
  const out = [], zs = sideZs(H, z0);
  if (lock === "dovetail") for (const z of zs) {
    out.push(kid(extr(dovetailXZ(SDV.neck, SDV.head, SDV.h), PLANE_SIDE, D - 3), T(W / 2 - 0.01, -D / 2 + 3, z)));
    out.push(kid(extr(dovetailXZ(SDV.neck, SDV.head, SDV.h + 0.01, cl), PLANE_SIDE, D - 2 + cl), T(-W / 2 - 0.01, -D / 2 + 3 - cl, z), true));
  }
  if (lock === "pegs") for (const y of [-D / 2 + 12, D / 2 - 12]) for (const z of zs) {
    out.push(kid(rodX(SPEG.h + 0.01, SPEG.d), T(W / 2 + SPEG.h / 2 - 0.01, y, z)));
    out.push(kid(rodX(SPEG.h + 0.6, SPEG.d + 2 * cl), T(-W / 2 + (SPEG.h + 0.6) / 2 - 0.01, y, z), true));
  }
  return out;
}
// ------------------------------------------------------------------ lock clips
// A clip is a flat plate with two pegs; it lies on the back of two boxes across the seam between
// them, a peg in a hole in each back. Dovetails let boxes slide front to back; the clip stops that.
// Holes sit e in from the box's edge (clear of rounded corners, rails and grooves); a clip's pegs are
// 2e apart. Pegs are a snug push fit (0.15 bigger holes) and chamfered so they start easily.
export const CLIP = { peg: 4, fit: 0.15, plate: 2, wide: 9, backT: 3.2, depth: 2.4 };
const clipE = (R) => Math.max(7, R + 3);
// where the clips go along a seam of length L (centred, avoiding the stack rails at ±L/4)
const clipSpots = (L) => (L >= 110 ? [-(L / 2 - 14), 0, L / 2 - 14] : L >= 70 ? [-(L / 2 - 12), L / 2 - 12] : [0]);
// one clip, lying as printed: the plate on the bed (in X, Y; along Y), the pegs pointing up
function clipNode(e) {
  const L = 2 * e + CLIP.wide, pl = CLIP.depth - 0.3;
  const k = [kid(prim("box", { w: CLIP.wide, d: L, h: CLIP.plate, rv: 2.5 }))];
  for (const y of [-e, e]) k.push(kid(prim("cylinder", { w: CLIP.peg, d: CLIP.peg, h: pl + 0.4, c: 0.4 }), T(0, y, CLIP.plate - 0.4)));
  return group(k);
}
// turned to stand on a box's back (y = yb), pegs pointing forward (-Y), plate along Z (vertical
// seam) or along X (side seam)
const clipUp = (x, yb, z) => [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, r6(x), r6(yb + CLIP.plate), r6(z), 1];
const clipSide = (x, yb, z) => [0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0, r6(x), r6(yb + CLIP.plate), r6(z), 1];
// the holes in one box's back: along the top and bottom edges for stacking, the sides for side by side
function clipHoles(W, D, H, R, z0, stackSeams, sideSeams) {
  const e = clipE(R), out = [], d = CLIP.peg + CLIP.fit, hole = (x, z) => out.push(kid(rodY(CLIP.depth + 0.01, d), T(x, D / 2 - CLIP.depth, z), true));
  if (stackSeams) for (const x of clipSpots(W)) { hole(x, z0 + e); hole(x, H - e); }
  if (sideSeams) for (const z of clipSpots(H - z0)) { hole(-W / 2 + e, z0 + (H - z0) / 2 + z); hole(W / 2 - e, z0 + (H - z0) / 2 + z); }
  return out;
}
// ------------------------------------------------------------------ rail plates
// A plate with two dovetail grooves (the same as a case's grooves, closed at the front, open at the
// back) slides on from the back over a rail of each of two boxes and holds them together.
const PLATE_ROOF = 1.4, PLATE_EDGE = 8;
// on top: over the right rail of the left case and the left rail of the right case (rails at ±W/4);
// made at the left case, its underside at z = 0 (the case top)
function topPlate(W, D, cl) {
  const DV = { neck: 7, head: 10, h: 3 }, pt = DV.h + cl + PLATE_ROOF, x0 = W / 4 - PLATE_EDGE, x1 = (3 * W) / 4 + PLATE_EDGE;
  const k = [kid(prim("box", { w: x1 - x0, d: D - 1, h: pt, rv: 2 }), T((x0 + x1) / 2, 0.5, 0))];
  for (const x of [W / 4, (3 * W) / 4]) k.push(kid(extr(dovetailXZ(DV.neck, DV.head, DV.h + 0.01, cl), PLANE_XZ, D - 2 + cl), T(x, D / 2 + 1, -0.01), true));
  return { node: group(k), pt };
}
// on the right side: over the top rail of the lower box and the bottom rail of the one above (the
// next one up is "pitch" higher); made at the lower box, against its right side
function sidePlate(W, D, cl, zs, pitch) {
  const pt = SDV.h + cl + PLATE_ROOF, zA = Math.max(...zs), zB = pitch + Math.min(...zs);
  const z0 = zA - SDV.head / 2 - PLATE_EDGE, z1 = zB + SDV.head / 2 + PLATE_EDGE;
  const k = [kid(prim("box", { w: pt, d: D - 1, h: z1 - z0, rv: 0 }), T(W / 2 + pt / 2, 0.5, z0))];
  for (const z of [zA, zB]) k.push(kid(extr(dovetailXZ(SDV.neck, SDV.head, SDV.h + 0.01, cl), PLANE_SIDE, D - 2 + cl), T(W / 2 - 0.01, -D / 2 + 3 - cl, z), true));
  return { node: group(k), pt, z0, z1 };
}
// rail plates for grooves: a 2.4 plate with two dovetail rails. g = how much bigger than the plain
// dovetail each rail is: the boxes' grooves are grown by their own clearance, so a rail grown by
// (that clearance - the plate fit) leaves the plate-fit gap all round
const RAIL_BACK = 2.4;
const railXZ = (n, hd, h, g) => line([[-n / 2 - g, -0.05], [n / 2 + g, -0.05], [hd / 2 + g, h + g], [-hd / 2 - g, h + g]]);
// underneath: in the right groove of the left case and the left groove of the right case; made at
// the left case, its top at z = 0 (the case bottom)
function underPlate(W, D, g) {
  const DV = { neck: 7, head: 10, h: 3 }, x0 = W / 4 - PLATE_EDGE, x1 = (3 * W) / 4 + PLATE_EDGE;
  const k = [kid(prim("box", { w: x1 - x0, d: D - 1, h: RAIL_BACK, rv: 2 }), T((x0 + x1) / 2, 0.5, -RAIL_BACK))];
  for (const x of [W / 4, (3 * W) / 4]) k.push(kid(extr(railXZ(DV.neck, DV.head, DV.h, g), PLANE_XZ, D - 3), T(x, D / 2, 0)));
  return { node: group(k) };
}
// on the left side: in the top side groove of the lower box and the bottom one of the box above
function leftPlate(W, D, g, zs, pitch) {
  const zA = Math.max(...zs), zB = pitch + Math.min(...zs), z0 = zA - SDV.head / 2 - PLATE_EDGE, z1 = zB + SDV.head / 2 + PLATE_EDGE;
  const k = [kid(prim("box", { w: RAIL_BACK, d: D - 1, h: z1 - z0 }), T(-W / 2 - RAIL_BACK / 2, 0.5, z0))];
  for (const z of [zA, zB]) k.push(kid(extr(railXZ(SDV.neck, SDV.head, SDV.h, g), PLANE_SIDE, D - 3), T(-W / 2, -D / 2 + 3, z)));
  return { node: group(k), z0, z1 };
}
function addGroovePlates(parts, o, { across, units, pitch, W, D, g, under, side, zs }) {
  let n = 0;
  const add = (node, dx, z, flat) => { n++; parts.push({ key: "gplate" + n, name: "Plate in grooves " + n, node, z, dx, color: "#a3968c", kind: "plate", flat }); };
  if (under) { const P = underPlate(W, D, g); for (let c = 0; c + 1 < across; c++) add(P.node, c * W, 0, group([kid(P.node, T(-W / 2, 0, RAIL_BACK))])); }
  if (side) { const P = leftPlate(W, D, g, zs, pitch); for (let r = 0; r + 1 < units; r++) add(P.node, 0, r * pitch, group([kid(P.node, [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, (P.z0 + P.z1) / 2, 0, W / 2 + RAIL_BACK, 1])])); }
  return n;
}
// add the plates of a set; top plates need rails on top (cases with dovetail stacking) and side
// plates rails on the right sides (dovetails side by side) of a column two or more high
function addPlates(parts, o, { across, units, pitch, W, D, cl, top, side, zs }) {
  let n = 0;
  const add = (node, dx, z, kind, flat) => { n++; parts.push({ key: "plate" + n, name: "Plate over rails " + n, node, z, dx, color: "#8c96a3", kind: "plate", flat }); };
  if (top) { const P = topPlate(W, D, cl); for (let c = 0; c + 1 < across; c++) add(P.node, c * W, (units - 1) * pitch + o.h, "top", group([kid(P.node, [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, -W / 2, 0, P.pt, 1])])); }
  if (side) { const P = sidePlate(W, D, cl, zs, pitch); for (let r = 0; r + 1 < units; r++) add(P.node, (across - 1) * W, r * pitch, "side", group([kid(P.node, [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -(P.z0 + P.z1) / 2, 0, W / 2 + P.pt, 1])])); }
  return n;
}
// laid out for printing: flat, grooves up, in a row behind everything else
function platesFlat(parts, o) {
  let x = 0;
  for (const q of parts) if (q.kind === "plate") { q.node = q.flat; q.dx = x; q.dy = 1.5 * o.d + 40; q.z = 0; x += Math.max(o.w * 0.5 + 16 + 10, o.h * 1.2 + 10); }
}
const COLS = "ABCDEFGH";

// all the parts of a bin set: [{ key, name, node, z, color, kind }] with z the height of its unit
export function binSet(o0) {
  const o = { ...BIN_DEFAULTS, ...o0 };
  const units = Math.max(1, Math.min(8, Math.round(o.units || 1))), across = Math.max(1, Math.min(8, Math.round(o.across || 1)));
  const side = across > 1 ? o.sideLock || "none" : "none";
  // which unit: k counts up a column, then the next column (so a set made before stays the same)
  const cells = []; for (let c = 0; c < across; c++) for (let r = 0; r < units; r++) cells.push({ c, r, k: c * units + r });
  const grid = across > 1, label = (q) => (grid ? COLS[q.c] + (q.r + 1) : String(q.r + 1));
  const many = cells.length > 1;
  if (o.style === "bin" || !o.style) {
    const sd = sideDepth(side, side === "dovetail" ? dvGap(o) : Math.max(0, o.clear));
    // joined side by side, the walls are thick enough for the grooves
    const one = binParts(sd ? { ...o, wall: Math.max(o.wall, sd + 1.2) } : o), parts = [];
    const foot = o.stack ? Math.max(1, Math.min(o.foot, o.h / 3)) : 0, pitch = Math.max(5, o.h) - foot;
    const clipSide = side === "dovetail" && o.clips === "back";
    const R = Math.max(0, Math.min(o.radius, o.w / 2 - 0.5, o.d / 2 - 0.5));
    const node = sd ? group([kid(one.bin), ...sideJoints(o.w, o.d, o.h, side, side === "dovetail" ? dvGap(o) : Math.max(0, o.clear), foot + 1), ...(clipSide ? clipHoles(o.w, o.d, o.h, R, foot, false, true) : [])]) : one.bin;
    for (const q of cells) parts.push({ key: q.k ? "bin" + q.k : "main", name: many ? "Bin " + label(q) : "Bin", node, z: q.r * pitch, dx: q.c * o.w, color: "#5b8fd6", kind: "bin" });
    if (one.lid) parts.push({ key: "lid", name: "Lid", node: one.lid, z: 0, dx: across * o.w + 12, color: "#e0a43a", kind: "lid" });
    if (clipSide) addClips(parts, o, across, units, pitch, R, foot, false, true);
    const np = side === "dovetail" && /side|both/.test(o.plates || "") && units > 1 ? addPlates(parts, o, { across, units, pitch, W: o.w, D: o.d, cl: PLATE_FITS[o.plateFit] ?? PLATE_FITS.snug, top: false, side: true, zs: sideZs(o.h, foot + 1) }) : 0;
    const ng = side === "dovetail" && /side|both/.test(o.gplates || "") && units > 1 ? addGroovePlates(parts, o, { across, units, pitch, W: o.w, D: o.d, g: dvGap(o) - (PLATE_FITS[o.plateFit] ?? PLATE_FITS.snug), under: false, side: true, zs: sideZs(o.h, foot + 1) }) : 0;
    if (o.layout === "print") parts.forEach((q, i) => { if (q.kind === "bin") { q.dx = i * (o.w + 10); q.z = 0; } else if (q.kind === "lid") q.dx = cells.length * (o.w + 10); });
    if (o.layout === "print") { clipsFlat(parts, o); platesFlat(parts, o); }
    const nc = parts.filter((q) => q.kind === "clip").length;
    return { parts, cell: one.cell, info: (ng ? `${ng} plate${ng > 1 ? "s" : ""} in grooves slide${ng > 1 ? "" : "s"} into the left side grooves from the back, joining each bin to the one above. ` : "") + (np ? `${np} plate${np > 1 ? "s" : ""} over rails slide${np > 1 ? "" : "s"} onto the side rails from the back, joining each bin to the one above. ` : "") + (nc ? `${nc} lock clip${nc > 1 ? "s" : ""} press${nc > 1 ? "" : "es"} onto the backs across the joins, so the bins can't slide apart. ` : "") + (sd ? `Side by side they join with ${side === "dovetail" ? "dovetail rails (slide the one on the right on from the front)" : "pegs"}; the walls are ${(Math.max(o.wall, sd + 1.2)).toFixed(1)} thick for it.` : "") };
  }
  // lock clips across the dovetail seams: stacked (top to bottom) and side by side
  const clipStack = o.clips === "back" && units > 1 && o.lock === "dovetail", clipSide = o.clips === "back" && across > 1 && side === "dovetail";
  const c = caseParts({ ...o, side, clipStack, clipSide }), parts = [];
  for (const q of cells) {
    const nm = many ? " " + label(q) : "";
    parts.push({ key: q.k ? "case" + q.k : "main", name: "Case" + nm, node: c.shell, z: q.r * o.h, dx: q.c * o.w, color: "#5b8fd6", kind: "case" });
    parts.push({ key: "front" + q.k, name: (o.style === "drawer" ? "Drawer" : o.style === "tilt" ? "Tilt bin" : "Door") + nm, node: c.front, z: q.r * o.h, dx: q.c * o.w, color: "#e0a43a", kind: o.style });
  }
  const R = Math.max(0, Math.min(o.radius, Math.max(30, o.w) / 2 - 1, Math.max(30, o.d) / 2 - 1));
  if (clipStack || clipSide) addClips(parts, o, across, units, o.h, R, 0, clipStack, clipSide);
  const pTop = /top|both/.test(o.plates || "") && o.lock === "dovetail" && across > 1, pSide = /side|both/.test(o.plates || "") && side === "dovetail" && units > 1;
  const np = pTop || pSide ? addPlates(parts, o, { across, units, pitch: o.h, W: Math.max(30, o.w), D: Math.max(30, o.d), cl: PLATE_FITS[o.plateFit] ?? PLATE_FITS.snug, top: pTop, side: pSide, zs: sideZs(Math.max(20, o.h), 0) }) : 0;
  const gUnder = /under|both/.test(o.gplates || "") && o.lock === "dovetail" && across > 1, gSide = /side|both/.test(o.gplates || "") && side === "dovetail" && units > 1;
  const ng = gUnder || gSide ? addGroovePlates(parts, o, { across, units, pitch: o.h, W: Math.max(30, o.w), D: Math.max(30, o.d), g: dvGap(o) - (PLATE_FITS[o.plateFit] ?? PLATE_FITS.snug), under: gUnder, side: gSide, zs: sideZs(Math.max(20, o.h), 0) }) : 0;
  // laid out for printing: each case in a row, its drawer, bin or door in a row in front
  if (o.layout === "print") { clipsFlat(parts, o); platesFlat(parts, o); }
  if (o.layout === "print") parts.filter((q) => q.kind !== "clip" && q.kind !== "plate").forEach((q, i) => {
    const k = Math.floor(i / 2); q.dx = k * (o.w + 10); q.z = 0; if (q.kind !== "case") q.dy = -(o.d + 15);
    // a door is turned to lie on its flat back, the pull up
    if (q.kind === "door" && c.flat) { const f = c.flat; q.node = group([kid(q.node, Rx(-Math.PI / 2, 0, -(f.z0 + f.fh / 2), f.y0 + f.td / 2))]); }
  });
  const nc = parts.filter((q) => q.kind === "clip").length;
  return { parts, cell: c.cell, info: c.info + (ng ? ` ${ng} plate${ng > 1 ? "s" : ""} in grooves slide${ng > 1 ? "" : "s"} into the open dovetail grooves from the back${gUnder ? ", under cases side by side" : ""}${gSide ? (gUnder ? " and" : ",") + " up the left side of cases stacked" : ""}.` : "") + (np ? ` ${np} plate${np > 1 ? "s" : ""} over rails slide${np > 1 ? "" : "s"} onto the open dovetail rails from the back${pTop ? ", across the tops of cases side by side" : ""}${pSide ? (pTop ? " and" : ",") + " up the right side of cases stacked" : ""}.` : "") + (nc ? ` ${nc} lock clip${nc > 1 ? "s" : ""} press${nc > 1 ? "" : "es"} onto the backs across the dovetail joins, so the cases can't slide apart.` : "") };
}

// the clips of a set: one on each spot of every dovetail seam, standing on the backs
function addClips(parts, o, across, units, pitch, R, z0, stack, side) {
  const W = o.style === "bin" || !o.style ? o.w : Math.max(30, o.w), D = o.style === "bin" || !o.style ? o.d : Math.max(30, o.d), H = o.h;
  const e = clipE(R), node = clipNode(e); let n = 0;
  const add = (m, dx, z) => { n++; parts.push({ key: "clip" + n, name: "Clip " + n, node: group([kid(node, m)]), z, dx, color: "#8c96a3", kind: "clip" }); };
  if (stack) for (let c = 0; c < across; c++) for (let r = 0; r + 1 < units; r++) for (const x of clipSpots(W)) add(clipUp(x, D / 2, 0), c * o.w, (r + 1) * pitch);
  if (side) for (let c = 0; c + 1 < across; c++) for (let r = 0; r < units; r++) for (const z of clipSpots(H - z0)) add(clipSide(W / 2, D / 2, z0 + (H - z0) / 2 + z), c * o.w, r * pitch);
}
// laid out for printing: the clips flat in a row behind the boxes, pegs up
function clipsFlat(parts, o) {
  let i = 0;
  for (const q of parts) if (q.kind === "clip") { const e = clipE(Math.max(0, Math.min(o.radius, o.w / 2 - 1, o.d / 2 - 1))); q.node = clipNode(e); q.dx = i++ * (CLIP.wide + 6); q.dy = o.d / 2 + e + 20; q.z = 0; }
}

export function caseParts(o) {
  const W = Math.max(30, o.w), D = Math.max(30, o.d), H = Math.max(20, o.h), cl = Math.max(0, o.clear);
  const dcl = dvGap(o); // the dovetails' own fit (Snug, Normal or Loose)
  const t = Math.max(1.2, o.caseT || 2.4), wall = Math.max(0.6, o.wall), fl = Math.max(0.6, o.floor), div = Math.max(0.6, o.divider);
  const R = Math.max(0, Math.min(o.radius, W / 2 - 1, D / 2 - 1));
  const lock = o.lock || "none";
  // stacking features (rails or pegs on top, grooves or holes underneath)
  const DV = { neck: 7, head: 10, h: 3 }, PEG = { d: 6, h: 3, inset: 10 };
  const lockDepth = lock === "dovetail" ? DV.h + dcl + 0.2 : lock === "pegs" ? PEG.h + 0.6 : 0;
  const tb = Math.max(t, lockDepth ? lockDepth + 1.2 : 0), tt = t, tback = o.clipStack || o.clipSide ? Math.max(t, CLIP.backT) : t;
  // side walls: thicker when cases join side by side (the grooves are cut into the left one)
  const sd = sideDepth(o.side || "none", o.side === "dovetail" ? dcl : cl), ts = Math.max(t, sd ? sd + 1.2 : 0);
  const iw = W - 2 * ts, ih = H - tb - tt, idp = D - tback;
  if (iw < 15 || ih < 10 || idp < 15) throw new Error("The case is too small inside: make it bigger, or the walls thinner");
  // ---- the case
  const ck = [kid(prim("box", { w: W, d: D, h: H, rv: R }))];
  ck.push(kid(prim("box", { w: iw, d: idp + 1, h: ih }), T(0, -D / 2 + (idp + 1) / 2 - 1, tb), true));
  if (sd) ck.push(...sideJoints(W, D, H, o.side, o.side === "dovetail" ? dcl : cl, 0));
  if (o.clipStack || o.clipSide) ck.push(...clipHoles(W, D, H, R, 0, o.clipStack, o.clipSide));
  const xs = [-W / 4, W / 4], pegXY = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [i * (W / 2 - PEG.inset), j * (D / 2 - PEG.inset)]);
  if (lock === "dovetail") for (const x of xs) {
    // rails stop 3 short of the front, so the case above slides on from the front and stops flush
    ck.push(kid(extr(dovetailXZ(DV.neck, DV.head, DV.h), PLANE_XZ, D - 3), T(x, D / 2, H - 0.01)));
    // the groove is open at the back and closed at the front: the case above stops flush
    ck.push(kid(extr(dovetailXZ(DV.neck, DV.head, DV.h + 0.01, dcl), PLANE_XZ, D - 2 + dcl), T(x, D / 2 + 1, -0.01), true));
  }
  if (lock === "pegs") for (const [x, y] of pegXY) {
    ck.push(kid(prim("cylinder", { w: PEG.d, d: PEG.d, h: PEG.h + 0.01, c: 0.6 }), T(x, y, H - 0.01)));
    ck.push(kid(prim("cylinder", { w: PEG.d + 2 * cl, d: PEG.d + 2 * cl, h: PEG.h + 0.6 }), T(x, y, -0.01), true));
  }
  // ---- what goes in it
  let front, cell = null, info = "";
  const fw = iw - 2 * cl, fh = ih - 2 * cl;
  if (o.style === "drawer") {
    const dd = idp - cl, fx = 0, fy = -D / 2 + dd / 2, fz = tb + cl;
    const cols = Math.max(1, Math.min(12, Math.round(o.cols))), rows = Math.max(1, Math.min(12, Math.round(o.rows)));
    const cw = (fw - 2 * wall - (cols - 1) * div) / cols, cd = (dd - 2 * wall - (rows - 1) * div) / rows;
    if (cw < 3 || cd < 3) throw new Error("The drawer's compartments are too small: fewer rows or columns, or a bigger case");
    const dk = [kid(prim("box", { w: fw, d: dd, h: fh }))];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) dk.push(kid(prim("box", { w: cw, d: cd, h: fh, r: Math.max(0, Math.min(o.inner, cw / 2 - 0.05, cd / 2 - 0.05)) }), T(-fw / 2 + wall + cw / 2 + i * (cw + div), -dd / 2 + wall + cd / 2 + j * (cd + div), fl), true));
    // the pull: a bar, a knob or a finger notch in the top of the front
    const pz = fh * 0.55;
    if (o.pull === "notch") dk.push(kid(rodY(wall * 3 + 1, Math.min(fw * 0.4, 30)), T(0, -dd / 2 - 1, fh), true));
    else if (o.pull === "knob") { dk.push(kid(rodY(6, 6), T(0, -dd / 2 - 6, pz))); dk.push(kid(prim("sphere", { w: 12, d: 12, h: 12 }), T(0, -dd / 2 - 9, pz - 6))); }
    else { const bl = Math.min(fw * 0.5, 60); dk.push(kid(prim("box", { w: bl, d: 8, h: 4, rv: 2 }), T(0, -dd / 2 - 4 + 0.5, pz))); for (const s of [-1, 1]) dk.push(kid(prim("box", { w: 5, d: 8, h: 4 }), T(s * (bl / 2 - 2.5), -dd / 2 - 4 + 0.5, pz))); }
    front = group([kid(group(dk), T(fx, fy, fz))]);
    cell = { w: r6(cw), d: r6(cd), h: r6(fh - fl) };
    info = `Drawer ${r6(fw).toFixed(1)} × ${r6(dd).toFixed(1)} × ${r6(fh).toFixed(1)}. It slides on the case floor.`;
  } else if (o.style === "tilt") {
    // the side profile (Y back, Z up): a quarter round about the pivot at the front bottom, so it
    // swings out without touching the top; open on top between the front and the curved back
    const p = 5, Rc = ih - 2 * cl - p - 0.4, hf = p + Rc * 0.78, wl = wall;
    if (Rc < 12) throw new Error("The case is too low for a tilt-out bin: make it taller");
    const yT = p + Math.sqrt(Rc * Rc - (hf - p) ** 2), yB = p + Math.sqrt(Rc * Rc - p * p);
    const outer = path([[0, p], [0, hf], [yT, hf], { arc: [p, p], to: [yB, 0] }, [p, 0], { arc: [p, p], to: [0, p] }]);
    const Ri = Rc - wl, top = hf + 1, yC = p + Math.sqrt(Ri * Ri - (top - p) ** 2), yD = p + Math.sqrt(Ri * Ri - (fl - p) ** 2);
    const bw = fw - 2 * 0.6; // room for the pins' shoulders
    const cols = Math.max(1, Math.min(8, Math.round(o.cols))), cw = (bw - 2 * wl - (cols - 1) * div) / cols;
    if (cw < 3) throw new Error("Too many compartments across for this tilt-out bin");
    const tk = [kid(extr(outer, PLANE_YZ, bw), T(-bw / 2, 0, 0))];
    // the inside: the same shape a wall thinner, open on top (its front bottom corner cut off at the curve)
    for (let i = 0; i < cols; i++) tk.push(kid(extr(path([[wl, p], [wl, top], [yC, top], { arc: [p, p], to: [yD, fl] }, [p, fl]]), PLANE_YZ, cw), T(-bw / 2 + wl + i * (cw + div), 0, 0), true));
    // pins (through the whole width, showing at each side), a pull tab, and a stop rib
    tk.push(kid(rodX(bw + 2 * (cl + 0.6) + 2 * (Math.min(ts, t + 1.5) - 0.7), 4), T(0, p, p)));
    tk.push(kid(prim("box", { w: Math.min(bw * 0.4, 40), d: 5, h: 3, rv: 1.5 }), T(0, -2.5 + 0.5, hf - 3)));
    const phiC = Math.asin(Math.min(0.99, (yT - p) / Rc)), e = 0.6 + Rc * (1 / Math.cos((12 * Math.PI) / 180) - 1);
    tk.push(kid(prim("box", { w: bw, d: 2.5, h: e + 1 }), Rx(-phiC, 0, p + (Rc - 1) * Math.sin(phiC), p + (Rc - 1) * Math.cos(phiC))));
    const by = -D / 2, bz = tb + cl;
    front = group([kid(group(tk), T(0, by, bz))]);
    // pin holes in the case sides
    ck.push(kid(rodX(W + 2, 4 + 2 * cl), T(0, by + p, bz + p), true));
    cell = { w: r6(cw), d: r6(yD - wl), h: r6(hf - fl) };
    info = `Tilt-out bin ${r6(bw).toFixed(1)} wide, ${r6(yB).toFixed(1)} deep, ${r6(hf).toFixed(1)} tall at the front. Push its pins into the holes in the case sides (the sides flex). It tips out about 30° and stops.`;
    if (yB + 2 < idp) info += ` The case is deeper than the bin needs: ${r6(yB + tback + 2).toFixed(0)} deep is enough.`;
  } else {
    // a door: pins top and bottom near the hinge side turn in holes in the case; the hinge edge is
    // rounded so it clears the side wall as it swings
    // the door's back is flat (it prints lying on it): the pins and the rounded hinge edge are no
    // thicker than the door, and the pull is only on the front
    const td = 3.2, setback = 2, hs = o.hinge === "right" ? 1 : -1, pin = 3;
    const xh = hs * (W / 2 - ts - cl - td / 2), y0 = -D / 2 + setback + td / 2, z0 = tb + cl;
    const dw = fw - td / 2;
    const pinTop = Math.max(0.6, tt * 0.7 + cl - 0.8), pinBot = tb * 0.7 + cl, pr = 0.6;
    const dk = [
      kid(prim("box", { w: dw, d: td, h: fh }), T(xh - hs * (dw / 2), 0, 0)),
      kid(prim("cylinder", { w: td, d: td, h: fh }), T(xh, 0, 0)),
      // the pins (nubs): the top one 0.8 shorter than before (easier to snap in), both with their
      // tips rounded; each runs pr into the door so the rounded root edge is buried in it
      kid(prim("cylinder", { w: pin, d: pin, h: pinTop + pr, r: pr }), T(xh, 0, fh - pr)),
      kid(prim("cylinder", { w: pin, d: pin, h: pinBot + pr, r: pr }), T(xh, 0, -pinBot)),
    ];
    // the pull, near the free edge: a knob, a finger hole through the door, or a bar
    const px = xh - hs * (dw - Math.min(12, dw * 0.15)), pz = fh * 0.5, pull = o.doorPull || "knob";
    if (pull === "hole") { const hd = Math.min(16, fh * 0.45, dw * 0.25); dk.push(kid(rodY(td + 2, hd), T(xh - hs * (dw - hd / 2 - 5), -td / 2 - 1, pz), true)); }
    else if (pull === "bar") { const bl = Math.min(fh * 0.5, 50), bx = xh - hs * (dw - 9); dk.push(kid(prim("box", { w: 4, d: 8, h: bl, rv: 2 }), T(bx, -td / 2 - 8 + 0.01, pz - bl / 2))); for (const s of [-1, 1]) dk.push(kid(prim("box", { w: 4, d: 8, h: 5 }), T(bx, -td / 2 - 4 + 0.01, pz + s * (bl / 2 - 2.5) - 2.5))); }
    else { dk.push(kid(rodY(6.5, 6), T(px, -td / 2 - 6, pz))); dk.push(kid(prim("sphere", { w: 11, d: 11, h: 11 }), T(px, -td / 2 - 6 - 3.5, pz - 5.5))); }
    front = group([kid(group(dk), T(0, y0, z0))]);
    FLAT = { y0, z0, fh, td };
    for (const [z, h] of [[-0.01, tb + 0.02], [H - tt - 0.01, tt + 0.02]]) ck.push(kid(prim("cylinder", { w: pin + 2 * cl, d: pin + 2 * cl, h }), T(xh, y0, z), true));
    // the door stop: a strip just behind the door along the floor, the ceiling and the far side, so
    // the door opens outwards only (it rests against the strip when shut). Near the hinge the strip
    // stops short, out of the way of the door's rounded edge.
    const sy = y0 + td / 2 + 0.3 + 0.8, lip = cl + 1.4, x0 = xh - hs * (td + 1.5), x1 = -hs * (iw / 2 - 0.01), sw = Math.abs(x1 - x0);
    ck.push(kid(prim("box", { w: 1.6, d: 1.6, h: ih + 0.02 }), T(-hs * (iw / 2 - 0.79), sy, tb - 0.01)));
    ck.push(kid(prim("box", { w: sw, d: 1.6, h: lip + 0.01 }), T((x0 + x1) / 2, sy, tb - 0.01)));
    ck.push(kid(prim("box", { w: sw, d: 1.6, h: lip + 0.01 }), T((x0 + x1) / 2, sy, H - tt - lip)));
    // the catch: two small round bumps on the far wall, just in front of the shut door's free edge. They
    // reach past the edge by a little (light 0.35, firm 0.7), so the door clicks past them shut and needs a
    // small pull to open. Half of each bump is in the wall; the round face lets the door ride over it.
    const grip = o.doorCatch === "firm" ? 0.7 : o.doorCatch === "none" ? 0 : 0.35;
    if (grip) {
      const r = 0.95, wallX = -hs * (iw / 2), cx = wallX + hs * (cl + grip - r), cy = y0 - td / 2 - r - 0.05;
      for (const fz of [0.25, 0.75]) ck.push(kid(prim("sphere", { w: 2 * r, d: 2 * r, h: 2 * r }), T(cx, cy, z0 + fh * fz - r)));
    }
    cell = null;
    info = `Door ${r6(fw).toFixed(1)} × ${r6(fh).toFixed(1)}, hinged on the ${hs < 0 ? "left" : "right"}; it opens outwards only (a stop strip behind it)${grip ? `, and ${o.doorCatch === "firm" ? "firm" : "light"} catch bumps hold it shut until you pull it` : ""}. Bend the door slightly to push its pins into the holes in the case top and bottom.`;
  }
  // a door to print lies on its flat back: turned so the back is down at z = 0
  const flat = o.style === "door" ? FLAT : null;
  // the case is the block with its holes cut (the hollow, grooves, pin holes); then the things added
  // inside the hollow (the door stop, catch bumps) and outside (rails, pegs) go on after, so the
  // hollow can't cut them away
  const solids = ck.filter((k) => !k.hole), holes = ck.filter((k) => k.hole);
  const shell = group([kid(group([solids[0], ...holes])), ...solids.slice(1)]);
  return { shell, front, cell, info, flat };
}
let FLAT = null;
// a round rod along Y, from y = 0 to y = len, centred on X and Z
function rodY(len, dia) {
  // the cylinder's axis (z) turned to +y
  return group([kid(prim("cylinder", { w: dia, d: dia, h: len }), [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])]);
}
