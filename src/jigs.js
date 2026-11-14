// Jig Maker: quick woodworking jigs, each a set of printable parts made from plain primitives.
// Every part is built lying the way it prints (flat face on the bed, z ≥ 0), centred near x = y = 0;
// the maker lays the parts out in a row. Sizes are in mm.
//   miter    a small miter box: a channel with saw kerfs at 90° and 45° (and 22.5°)
//   dowel    a self-centring dowel jig: a U that fits over the board, guide holes down its middle
//   pocket   a pocket-hole jig: a block with 15° drill guides that sits on the board, a lip on its end
//   square   a try square: a stock with a lip that hooks the board edge, a ruled blade
//   angle    angle templates (45°, 30°, 22.5°…) with a fence, for setting saws and marking
//   drill    a drill guide: a block with straight holes of several sizes, labelled, with a V for dowels
//   dove     dovetails: a marking template (tails and half pins at the slope) and an angled saw guide
//   box      box (finger) joints: a finger template and an indexing key for a saw or router sled
//   mortise  mortise and tenon: a guide that straddles the board with a slot for the chisel or
//            router, and a gauge to check the tenon
//   lap      lap joints: a bridge across the board whose window guides the saw, chisel or router,
//            and a step gauge for the depth (half the thickness)
// Every jig can be a honeycomb inside (o.hex): hexagonal holes through the solid parts, clear of
// the faces that guide or locate, so it uses less plastic and stays stiff.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
// a turn about Z (degrees), then a move
const RZ = (deg, x = 0, y = 0, z = 0) => { const a = (deg * Math.PI) / 180, c = r6(Math.cos(a)), s = r6(Math.sin(a)); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1]; };
// a turn about Y (degrees), then a move: tips +Z towards +X
const RY = (deg, x = 0, y = 0, z = 0) => { const a = (deg * Math.PI) / 180, c = r6(Math.cos(a)), s = r6(Math.sin(a)); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, r6(x), r6(y), r6(z), 1]; };
const prim = (kind, p) => ({ t: "prim", kind, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])), mods: [] });
const kid = (node, m = T(), hole = false) => ({ node, m, hole });
const group = (children) => ({ t: "group", children, mods: [] });
const box = (w, d, h, x, y, z, hole = false) => kid(prim("box", { w, d, h }), T(x, y, z), hole);   // centred in x, y; z from z
const cyl = (dia, h, x, y, z, hole = false) => kid(prim("cylinder", { w: dia, d: dia, h }), T(x, y, z), hole);
const seg2 = (pts) => pts.map((a, i) => ({ t: "line", a: a.map(r6), b: pts[(i + 1) % pts.length].map(r6) }));
const PLANE_XY = { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] };
// polygons (in x, y) extruded up from z0 by h: one extrude for many shapes (ticks, slots…)
const prisms = (polys, h, z0 = 0, hole = false) => kid({ t: "extrude", regions: polys.map((p) => ({ outer: seg2(p) })), plane: PLANE_XY, dist: r6(h), mode: "one", mods: [] }, T(0, 0, z0), hole);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// engraved text on a face at height z (reads along +X)
const engrave = (str, size, x, y, z, depth = 0.6, rot = 0) => kid(prim("text", { text: str, size, h: depth + 0.5, font: "sans" }), rot ? RZ(rot, x, y, z - depth) : T(x, y, z - depth), true);
// engraved into the bottom face (z = 0), for marks that face up once the part is turned over
// (turned over about the X axis): the text is turned too, so it reads right side up then
const engraveUnder = (str, size, x, y, depth = 0.6) => kid(prim("text", { text: str, size, h: depth + 0.5, font: "sans" }), [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, r6(x), r6(y), r6(depth), 1], true);
const fmt = (v) => String(+v.toFixed(2));

// ------------------------------------------------------------------ honeycomb
// Hexagonal holes in a zone of a part, keeping a solid rim and clear of keep-outs. The zone is in a
// plane's own (u, v): axis "z": u = x, v = y, the holes run up from z = at; "y": u = x, v = z, the
// holes run toward -y from y = at; "y+": the same, running toward +y; "x": u = y, v = z, the holes
// run toward +x from x = at. A depth short of the far side makes blind pockets (honeycomb faces on a
// block whose middle holds guide holes or a slot).
// keep: [(u, v, r) => true when a cell of radius r there would cut something that must stay].
const SQ3 = Math.sqrt(3);
function honey(o, z) {
  if (!o.hex) return [];
  // the jig's cell size, or smaller where that leaves most of the zone solid
  let best = [], bestA = 0;
  for (const k of [1, 0.8, 0.65]) { const F = (z.cell ?? o.hCell) * k; if (F < 4) break; const out = honey1(o, { ...z, cell: F }); const A = out.length ? out[0].node.regions.length * F * F : 0; if (A > bestA * 1.25) { best = out; bestA = A; } }
  return best;
}
function honey1(o, z) {
  const F = z.cell ?? o.hCell, web = z.web ?? o.hWeb, rim = z.rim ?? Math.max(2, web * 1.25), r = F / SQ3, p = F + web;
  if (F < 3) return [];
  // the whole zone is filled edge to edge: as many cells as fit across and down, spread out evenly so
  // the frame round them is the same all round. Flat-topped or pointy-topped, whichever fits more.
  const Au = z.u1 - z.u0 - 2 * rim, Av = z.v1 - z.v0 - 2 * rim;
  const lay = (flat) => {
    // "across" runs along the rows (cells F apart side by side for pointy tops), "down" between rows
    const wA = flat ? 2 * r : F, wD = flat ? F : 2 * r, sA = flat ? (p * SQ3) / 2 : p, sD = flat ? p : (p * SQ3) / 2;
    const [AA, AD] = flat ? [Au, Av] : [Au, Av];
    const m = AD >= wD ? Math.floor((AD - wD) / sD + 1e-9) + 1 : 0; if (!m) return null;
    const stag = m > 1 || flat ? 0.5 : 0; // rows (or columns) shift by half a step
    if (flat) {
      // flat tops: columns sA apart, each column's cells p apart, every other column half a cell down
      const n = AA >= wA ? Math.floor((AA - wA) / sA + 1e-9) + 1 : 0; if (!n) return null;
      const rows = AD >= wD + (n > 1 ? p / 2 : 0) ? Math.floor((AD - wD - (n > 1 ? p / 2 : 0)) / p + 1e-9) + 1 : 0; if (!rows) return null;
      const su = n > 1 ? (AA - wA) / (n - 1) : 0, sv = rows > 1 ? (AD - wD - (n > 1 ? p / 2 : 0)) / (rows - 1) : 0;
      const pts = []; for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) pts.push([z.u0 + rim + wA / 2 + i * su, z.v0 + rim + wD / 2 + j * sv + (i % 2 && n > 1 ? Math.min(p / 2, sv / 2 || p / 2) : 0)]);
      return { pts, a0: 0 };
    }
    const n = AA >= wA + (m > 1 ? p / 2 : 0) ? Math.floor((AA - wA - (m > 1 ? p / 2 : 0)) / p + 1e-9) + 1 : 0; if (!n) return null;
    const su = n > 1 ? (AA - wA - (m > 1 ? p / 2 : 0)) / (n - 1) : 0, sv = m > 1 ? (AD - wD) / (m - 1) : 0;
    const pts = []; for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) pts.push([z.u0 + rim + wA / 2 + i * su + (j % 2 && m > 1 ? Math.min(p / 2, su / 2 || p / 2) : 0), z.v0 + rim + wD / 2 + j * sv]);
    void stag; return { pts, a0: Math.PI / 6 };
  };
  const keep = z.keep || [];
  const ok = (u, v) => !(z.inside && !z.inside(u, v, r + rim)) && !keep.some((k) => k(u, v, r + web));
  let best = null;
  // cells in an upright wall (as it prints) are pointy-topped: their sloping tops print without support
  const kinds = z.axis === "z" || z.anyTop ? [false, true] : [false];
  for (const flat of kinds) { const L = lay(flat); if (!L) continue; const pts = L.pts.filter(([u, v]) => ok(u, v)); if (!best || pts.length > best.pts.length) best = { pts, a0: L.a0 }; }
  const polys = best ? best.pts.slice(0, 600).map(([u, v]) => [0, 1, 2, 3, 4, 5].map((k) => { const a = best.a0 + (k * Math.PI) / 3; return [u + r * Math.cos(a), v + r * Math.sin(a)]; })) : [];
  if (!polys.length) return [];
  if (z.axis === "y+") return [kid({ t: "extrude", regions: polys.map((q) => ({ outer: seg2(q.map(([u, v]) => [-u, v]).reverse()) })), plane: { o: [0, z.at, 0], x: [-1, 0, 0], n: [0, 1, 0] }, dist: r6(z.depth), mode: "one", mods: [] }, T(), true)];
  const plane = z.axis === "y" ? { o: [0, z.at, 0], x: [1, 0, 0], n: [0, -1, 0] } : z.axis === "x" ? { o: [z.at, 0, 0], x: [0, 1, 0], n: [1, 0, 0] } : { o: [0, 0, z.at], x: [1, 0, 0], n: [0, 0, 1] };
  return [kid({ t: "extrude", regions: polys.map((q) => ({ outer: seg2(q) })), plane, dist: r6(z.depth), mode: "one", mods: [] }, T(), true)];
}
// both sides of a part (faces y = ±hw), pockets dIn (toward -y side's middle) and dOut deep
const sides = (o, hw, dNeg, dPos, z) => [...honey(o, { ...z, axis: "y+", at: -hw - 0.01, depth: dNeg + 0.01 }), ...honey(o, { ...z, axis: "y", at: hw + 0.01, depth: dPos + 0.01 })];
// keep-outs: a band across u (|u - c| < half), a band across v, a circle, a line (point, direction)
const keepU = (c, half) => (u, v, r) => Math.abs(u - c) < half + r;
const keepV = (c, half) => (u, v, r) => Math.abs(v - c) < half + r;
const keepC = (cu, cv, rad) => (u, v, r) => Math.hypot(u - cu, v - cv) < rad + r;
const keepLine = (pu, pv, du, dv, half) => { const L = Math.hypot(du, dv); return (u, v, r) => Math.abs(((u - pu) * dv - (v - pv) * du) / L) < half + r; };
// inside a convex polygon by at least m
const insidePoly = (pts) => { const sg = Math.sign(pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) || 1;
  return (u, v, m) => pts.every((a, i) => { const b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ey = b[1] - a[1]; return (sg * (ex * (v - a[1]) - ey * (u - a[0]))) / Math.hypot(ex, ey) >= m; }); };

export const JIG_TYPES = [
  ["dove", "Dovetail", "A marking template for the tails and half pins at the slope you choose, and a saw guide angled to match"],
  ["box", "Box joint", "A finger template to mark (or rout) even fingers, and an indexing key for a saw or router sled"],
  ["mortise", "Mortise & tenon", "A guide that straddles the board with a slot for the chisel or router, and a gauge to check the tenon"],
  ["lap", "Lap joint", "A bridge across the board: its window guides the saw, chisel or router for the shoulders, with a gauge for the depth"],
  ["miter", "Miter box", "A channel with saw kerfs at 90° and 45° to cut small stock square and at angles"],
  ["dowel", "Dowel jig", "Fits over the board and centres the guide holes on its thickness"],
  ["pocket", "Pocket-hole jig", "15° drill guides for pocket screws, with a lip that hooks the board's end"],
  ["square", "Square", "A try square: a stock that hooks the board edge and a ruled blade"],
  ["angle", "Angle templates", "Triangles with a fence for setting a saw and marking angles"],
  ["drill", "Drill guide", "Straight holes of several sizes for drilling square to a face"],
];

export const JIG_DEFAULTS = {
  type: "miter",
  // miter box
  mStock: 40, mHeight: 30, mLength: 0, mKerf: 1.0, mWall: 8, mAngles: "both", mEars: true,
  // dowel jig
  dBoard: 19, dDowel: 8, dCount: 2, dSpacing: 32, dFirst: 20, dGuide: 25, dDrop: 15, dBush: 0, dStop: true,
  // pocket-hole jig
  pBoard: 19, pDrill: 9.5, pCount: 2, pSpacing: 22, pAngle: 15, pBush: 0,
  // square
  sBlade: 150, sStock: 100, sUnits: "mm", sNumbers: true,
  // angle templates
  aList: "45,30,22.5,60", aSize: 80,
  // drill guide
  gSizes: "3,4,5,6,8,10", gHeight: 30, gVee: true,
  // dovetail
  vBoard: 19, vWidth: 140, vTails: 3, vSlope: 6, vPin: 8,
  // box joint
  bBoard: 19, bWidth: 120, bFinger: 12.7,
  // mortise and tenon
  tBoard: 38, tWidth: 12.7, tLength: 50, tOffset: 0, tDepth: 30,
  // lap joint
  lBoard: 19, lWidth: 64, lMate: 64,
  // all: the fit of holes and slots on the printed part
  fit: 0.25,
  // all: a honeycomb inside, its cells (across the flats) and walls
  hex: true, hCell: 8, hWeb: 1.8,
};

// ------------------------------------------------------------------ miter box
function miterBox(o) {
  const W = Math.max(5, o.mStock), H = Math.max(8, o.mHeight), t = Math.max(3, o.mWall), base = 6, kerf = Math.max(0.3, o.mKerf) + 0.1;
  const Wt = W + 2 * t;
  const ang = o.mAngles === "90" ? [0] : o.mAngles === "45" ? [0, 45] : o.mAngles === "22" ? [0, 45, -45, 22.5, -22.5] : [0, 45, -45];
  // the kerfs sit along the box, each angled one far enough from its neighbours
  const spread = (a) => Wt * Math.tan((Math.abs(a) * Math.PI) / 180);
  const xs = []; let x = 0;
  ang.forEach((a, i) => { if (i) x += spread(ang[i - 1]) / 2 + spread(a) / 2 + 14; xs.push(x); });
  const span = x + spread(ang[ang.length - 1]) / 2 + spread(ang[0]) / 2;
  const L = Math.max(o.mLength || 0, span + 50), x0 = (xs[0] - spread(ang[0]) / 2 + x + spread(ang[ang.length - 1]) / 2) / 2;
  const k = [box(L, Wt, base, 0, 0, 0), box(L, t, base + H, 0, -(W / 2 + t / 2), 0), box(L, t, base + H, 0, W / 2 + t / 2, 0)];
  // ears to screw or clamp it to the bench
  if (o.mEars) for (const s of [-1, 1]) { k.push(box(24, Wt, 4, s * (L / 2 + 12), 0, 0)); for (const y of [-Wt / 4, Wt / 4]) k.push(cyl(5, 6, s * (L / 2 + 13), y, -1, true)); }
  // the kerfs: thin upright slots through both walls, 1 mm into the base
  const polys = ang.map((a, i) => { const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180), hl = (Wt / 2 + 4) / c, hw = kerf / 2, cx = xs[i] - x0;
    return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([u, v]) => [cx + u * c + v * s, -u * s + v * c]); });
  k.push(prisms(polys, H + 2, base - 1, true));
  // honeycomb: through both walls (clear of the kerfs and the top edge) and through the floor
  const wallKeep = [], floorKeep = [];
  ang.forEach((a, i) => { const c = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180), tn = sn / c, cx = xs[i] - x0, yw = W / 2 + t / 2;
    for (const sg of [-1, 1]) wallKeep.push({ sg, k: keepU(cx + sg * yw * tn, kerf / (2 * c) + (t / 2) * Math.abs(tn) + 2.5) });
    floorKeep.push(keepLine(cx, 0, sn, c, kerf / 2 + 2)); });
  k.push(...honey(o, { axis: "y+", at: -Wt / 2 - 0.5, depth: t + 1, u0: -L / 2, u1: L / 2, v0: base, v1: base + H, rim: 3, keep: wallKeep.filter((w) => w.sg < 0).map((w) => w.k) }));
  k.push(...honey(o, { axis: "y", at: Wt / 2 + 0.5, depth: t + 1, u0: -L / 2, u1: L / 2, v0: base, v1: base + H, rim: 3, keep: wallKeep.filter((w) => w.sg > 0).map((w) => w.k) }));
  k.push(...honey(o, { axis: "z", at: -0.01, depth: base + 0.02, u0: -L / 2, u1: L / 2, v0: -W / 2, v1: W / 2, rim: 2, keep: floorKeep }));
  if (o.mEars) for (const sg of [-1, 1]) k.push(...honey(o, { axis: "z", at: -0.01, depth: 4.02, u0: sg > 0 ? L / 2 : -L / 2 - 24, u1: sg > 0 ? L / 2 + 24 : -L / 2, v0: -Wt / 2, v1: Wt / 2, rim: 2, keep: [-Wt / 4, Wt / 4].map((y) => keepC(sg * (L / 2 + 13), y, 5)) }));
  // the angles, engraved on the top of the near wall next to each kerf
  ang.forEach((a, i) => k.push(engrave(fmt(Math.abs(a)) + "°", Math.min(4, t * 0.5), xs[i] - x0 + (a >= 0 ? -1 : 1) * (Math.abs(spread(a)) / 2 + 7), -(W / 2 + t / 2), base + H, 0.6)));
  return {
    parts: [{ key: "miter", name: "Miter box", node: group(k), w: L + (o.mEars ? 48 : 0), d: Wt }],
    info: [`Fits stock up to ${fmt(W)} mm wide and ${fmt(H)} mm tall. Kerfs ${fmt(kerf)} mm for a saw blade of ${fmt(o.mKerf)} mm: measure your saw's cut (a pull saw is about 0.6 to 1 mm).`, "Print with 4+ walls and 40% infill so the kerf walls stay true; a metal saw slowly widens printed kerfs."],
  };
}

// ------------------------------------------------------------------ dowel jig
// Printed upside down: the top block on the bed, the two cheeks up. Turned over, the cheeks
// straddle the board, so the guide holes sit on the middle of its thickness.
function dowelJig(o) {
  const T0 = Math.max(3, o.dBoard), d = Math.max(2, o.dDowel), n = Math.max(1, Math.round(o.dCount)), s = Math.max(d + 4, o.dSpacing), G = Math.max(8, o.dGuide), F = Math.max(4, o.dDrop), wall = 7;
  const first = Math.max(d / 2 + 4, o.dFirst), last = Math.max(d / 2 + 6, 12), L = first + (n - 1) * s + last + (o.dStop ? 5 : 0);
  const hole = o.dBush > 0 ? o.dBush - 0.1 : d + o.fit; // a steel bushing is pressed in (0.1 interference)
  const Wd = T0 + 0.3 + 2 * wall, x0 = -L / 2;
  const k = [box(L, Wd, G, 0, 0, 0)];
  for (const sg of [-1, 1]) k.push(box(L, wall, F, 0, sg * (T0 / 2 + 0.15 + wall / 2), G - 0.01));
  if (o.dStop) k.push(box(5, Wd, F, x0 + 2.5, 0, G - 0.01));                        // the end stop: butt it to the board's end
  const hx = (i) => x0 + (o.dStop ? 5 : 0) + first + i * s;
  for (let i = 0; i < n; i++) k.push(cyl(hole, G + 0.02, hx(i), 0, -0.01, true));
  // honeycomb through the block's sides, clear of the guide holes
  // the whole side is one honeycomb, block and cheeks, clear of the guide holes
  k.push(...sides(o, Wd / 2, Wd / 2 - hole / 2 - 2.5, Wd / 2 - hole / 2 - 2.5, { u0: x0 + (o.dStop ? 5 : 0), u1: -x0, v0: 0, v1: G + F, rim: 2 }));
  // a centre line on the cheek tops and the dowel size on the block's side
  // the dowel size on the block's bed face, which faces up once it is turned over onto the board
  k.push(engraveUnder(`${fmt(d)} mm`, 4, x0 + (o.dStop ? 5 : 0) + first + ((n - 1) * s) / 2, T0 / 2 + 0.15 + 3.2, 0.5));
  const info = [`For ${fmt(T0)} mm boards and ${fmt(d)} mm dowels: holes ${fmt(hole)} mm${o.dBush > 0 ? ` for a ${fmt(o.dBush)} mm steel bushing pressed in` : ""}, ${n > 1 ? `${n} of them ${fmt(s)} mm apart, ` : ""}the first ${fmt(first)} mm from ${o.dStop ? "the end stop" : "the end"}.`,
    "Prints with the cheeks up; turn it over onto the board's edge. Drill the same holes in both boards with the stop against the same end.", "Printed holes wear: for many holes press in a steel drill bushing (set Bushing Ø)."];
  return { parts: [{ key: "dowel", name: "Dowel jig", node: group(k), w: L, d: Wd }], info };
}

// ------------------------------------------------------------------ pocket-hole jig
// Lies on the board's face (its underside), the lip on its end hooks the board's end. Each guide
// runs at the angle to the face and aims at the middle of the board's thickness at its end.
function pocketJig(o) {
  const T0 = Math.max(6, o.pBoard), D = Math.max(3, o.pDrill), n = Math.max(1, Math.round(o.pCount)), sp = Math.max(D + 6, o.pSpacing);
  const a = Math.max(8, Math.min(30, o.pAngle)), ta = Math.tan((a * Math.PI) / 180), hb = Math.max(D + 8, 20);
  const hole = o.pBush > 0 ? o.pBush - 0.1 : D + o.fit;
  // x = 0 is the board's end; the guide axis passes (0, y, -T/2) rising back over the board (-x)
  const xTop = -(hb + T0 / 2) / ta, L = -xTop + 8, lip = 4, W = (n - 1) * sp + D + 18;
  const k = [box(L, W, hb, -L / 2 + 0.01, 0, 0), box(lip, W, hb + T0 * 0.6, lip / 2, 0, -T0 * 0.6)];
  const len = (hb + T0 / 2 + 6) / Math.sin((a * Math.PI) / 180);
  for (let i = 0; i < n; i++) { const y = (i - (n - 1) / 2) * sp; k.push(kid(prim("cylinder", { w: hole, d: hole, h: len }), RY(-(90 - a), 0, y, -T0 / 2), true)); }
  k.push(engrave(`${fmt(T0)}mm ${fmt(a)}°`, 4, -L / 2 - 6, 0, hb, 0.6));
  // honeycomb through the block's sides, clear of the guides (seen from the side they all line up)
  { const dd = W / 2 - ((n - 1) / 2) * sp - hole / 2 - 2.5; k.push(...sides(o, W / 2, dd, dd, { anyTop: true, u0: -L, u1: 0, v0: 0, v1: hb, rim: 2 })); }
  // printed upright as it sits, with the lip hanging below: lift it so it all sits on z ≥ 0 — print it on its side instead
  const g = group(k);
  const turned = group([kid(g, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, W / 2, 1])]); // on its side (+Y face down)
  const collar = (hb + T0 / 2) / Math.sin((a * Math.PI) / 180) - 3;
  return {
    parts: [{ key: "pocket", name: "Pocket-hole jig", node: turned, w: L + lip, d: hb + T0 * 0.6 }],
    info: [`For ${fmt(T0)} mm boards and a ${fmt(D)} mm stepped pocket-hole bit at ${fmt(a)}°: guide holes ${fmt(hole)} mm${o.pBush > 0 ? ` for a ${fmt(o.pBush)} mm steel bushing` : ""}${n > 1 ? `, ${n} of them ${fmt(sp)} mm apart` : ""}.`,
      `Set the bit's depth collar about ${fmt(collar)} mm above the tip, so the tip stops about 3 mm before the board's end.`,
      "Prints on its side so the guides stay round. Clamp the jig and board together; the lip goes against the board's end."],
  };
}

// ------------------------------------------------------------------ try square
// Printed blade down: the blade on the bed, the stock rising above it. Turned over, the stock's lip
// hooks the board's edge and the blade lies on the face, its ruled edge square to the edge.
function trySquare(o) {
  const Lb = Math.max(40, o.sBlade), Ls = Math.max(40, o.sStock), bw = 28, bt = 3, sw = 18, st = 14;
  // the blade is cut (ticks, numbers) on its own, then joined to the stock
  const blade = [box(Lb + sw / 2, bw, bt, (Lb - sw / 2) / 2, bw / 2, 0)], k = [box(sw, Ls, st, -sw / 2, Ls / 2, 0)];
  // a 45° shoulder at the stock's far end, for marking miters
  k.push(prisms([[[-sw - 0.01, Ls - sw], [0.01, Ls + 0.01], [-sw - 0.01, Ls + 0.01]]], st + 0.02, -0.01, true));
  // ruled edge along y = 0 (the reference edge): mm ticks (every 5 and 10 longer) or 1/16" ticks
  const inch = o.sUnits === "in", step = inch ? 25.4 / 16 : 1, polys = [], labels = [];
  for (let i = 1; i * step <= Lb - 3; i++) {
    const x = i * step, big = inch ? i % 16 === 0 : i % 10 === 0, mid = inch ? i % 8 === 0 : i % 5 === 0, q = inch && i % 4 === 0;
    const len = big ? 7 : mid ? 5 : q ? 4 : 2.6, hw = 0.2;
    polys.push(rect(x - hw, -0.01, x + hw, len));
    if (big) labels.push([String(inch ? i / 16 : i / 10), x]);
  }
  // the marks go on the blade's bed face: the square is turned over (about X) to use, so that face
  // is the one you see, with the stock hooking the board's edge below
  if (!o._noTicks) blade.push(prisms(polys.map((q) => q.map(([x, y]) => [x, y])), 1.1, -0.5, true));
  if (o.sNumbers && !o._noLabels) for (const [s, x] of labels) blade.push(engraveUnder(s, 3.2, x, 13, 0.6));
  // honeycomb: through the stock (clear of the blade, the 45° shoulder and the reference face) and
  // along the blade, behind the ruler
  k.push(...honey(o, { axis: "z", at: -0.01, depth: st + 0.02, u0: -sw, u1: 0, v0: bw, v1: Ls - sw, rim: 2 }));
  blade.push(...honey(o, { axis: "z", at: -0.01, depth: bt + 0.02, u0: 4, u1: Lb - 4, v0: 16, v1: bw, rim: 2 }));
  k.push(kid(group(blade)));
  return {
    parts: [{ key: "square", name: "Square", node: group(k), w: Lb + sw, d: Ls }],
    info: [`Blade ${fmt(Lb)} mm, ruled along its reference edge in ${inch ? "1/16 inch, numbered in inches" : "mm, numbered in cm"}; stock ${fmt(Ls)} mm with a 45° shoulder at its end.`,
      "Prints blade down; the ruler is on the bed side, which faces up when you use it. Check it before trusting it: draw a line along the blade, flip the square over and draw again; the two lines should match. Sand the stock's inner face to correct."],
  };
}

// ------------------------------------------------------------------ angle templates
function angleTemplates(o) {
  const list = String(o.aList).split(/[,\s]+/).map(Number).filter((v) => v > 2 && v < 88).slice(0, 8);
  const S = Math.max(30, o.aSize), pt = 3, ft = 9, fw = 8, parts = [];
  for (const a of list) {
    const r = (a * Math.PI) / 180, tip = [S * Math.cos(r), S * Math.sin(r)];
    // the plate: a triangle with the angle a at the origin, its base along the fence
    const plate = prisms([[[0, 0], [S, 0], tip]], pt, 0);
    const fence = box(S + 8, fw, ft, S / 2 + 4 - 8, -fw / 2 + 0.01, 0);
    const lbl = engrave(fmt(a) + "°", Math.min(8, S * 0.09), S * 0.55, Math.min(S * 0.2, tip[1] * 0.35), pt, 0.6);
    const ls = Math.min(8, S * 0.09), lx = S * 0.55, ly = Math.min(S * 0.2, tip[1] * 0.35);
    const hx = honey(o, { axis: "z", at: -0.01, depth: pt + 0.02, u0: 0, u1: S, v0: 0, v1: tip[1], rim: 0, inside: ((ins) => (u, v, m) => ins(u, v, m + 2.5))(insidePoly([[0, 0], [S, 0], tip])), keep: [(u, v, rr) => Math.abs(u - lx) < ls * 1.6 + rr && Math.abs(v - ly) < ls * 0.8 + rr] });
    // a honeycomb plate keeps a solid border 4 mm wide
    const node = group([plate, fence, lbl, ...hx.map((h) => h)]);
    parts.push({ key: "angle" + fmt(a).replace(".", "_"), name: `Angle ${fmt(a)}°`, node, w: S + 8, d: Math.max(tip[1], 10) + fw });
  }
  return { parts, info: [list.length ? `${list.length} template${list.length > 1 ? "s" : ""}: ${list.map((a) => fmt(a) + "°").join(", ")}. Hold the fence against the board's edge or the saw table; the long edge is the angle.` : "List the angles you want, e.g. 45, 30, 22.5"] };
}

// ------------------------------------------------------------------ drill guide
function drillGuide(o) {
  const sizes = String(o.gSizes).split(/[,\s]+/).map(Number).filter((v) => v >= 1 && v <= 25).slice(0, 10);
  const H = Math.max(10, o.gHeight), gap = 6;
  const widths = sizes.map((d) => d + o.fit + 2 * gap * 0.5);
  const L = widths.reduce((a, b) => a + b, 0) + 12, Wd = Math.max(...sizes, 6) + 26 + (o.hex ? 16 : 0);
  const k = [box(L, Wd, H, 0, 0, 0)];
  let x = -L / 2 + 6;
  sizes.forEach((d, i) => { const cx = x + widths[i] / 2; k.push(cyl(d + o.fit, H + 0.02, cx, -4, -0.01, true)); k.push(engrave(fmt(d), Math.min(4, widths[i] * 0.45), cx, Wd / 2 - 6, H, 0.6)); x += widths[i]; });
  // honeycomb pockets from underneath (the top stays solid for the labels), clear of the holes and the V
  const holeKeep = []; { let xx = -L / 2 + 6; sizes.forEach((d, i) => { holeKeep.push(keepC(xx + widths[i] / 2, -4, (d + o.fit) / 2 + 2.5)); xx += widths[i]; }); }
  k.push(...honey(o, { axis: "z", at: -0.01, depth: H + 0.02, u0: -L / 2, u1: L / 2, v0: -Wd / 2, v1: Wd / 2, rim: 2, keep: [...holeKeep, keepV(Wd / 2 - 6, 3.5), ...(o.gVee ? [keepV(-4, 10)] : [])] }));
  { const dm = Math.max(...sizes) + o.fit; k.push(...honey(o, { axis: "y", at: Wd / 2 + 0.01, depth: Wd / 2 - (dm / 2 - 4) - 2.5, u0: -L / 2, u1: L / 2, v0: 0, v1: H, rim: 2 }), ...honey(o, { axis: "y+", at: -Wd / 2 - 0.01, depth: Wd / 2 - (dm / 2 + 4) - 2.5, u0: -L / 2, u1: L / 2, v0: 0, v1: H, rim: 2, keep: o.gVee ? [keepV(0, 9)] : [] })); }
  // a V groove underneath (along X, through the hole line) so it sits centred on dowels and round stock
  if (o.gVee) k.push(kid({ t: "extrude", regions: [{ outer: seg2([[-8, -0.01], [8, -0.01], [0, 8]]) }], plane: { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0] }, dist: r6(L + 2), mode: "one", mods: [] }, T(-L / 2 - 1, -4, 0), true));
  return {
    parts: [{ key: "drill", name: "Drill guide", node: group(k), w: L, d: Wd }],
    info: [`Holes ${sizes.map((d) => fmt(d)).join(", ")} mm (each ${fmt(o.fit)} mm over, so the bit turns freely), ${fmt(H)} mm tall to keep the bit square.${o.gVee ? " The V underneath centres it on dowels and round stock." : ""}`],
  };
}


// ------------------------------------------------------------------ joint jigs
// A comb template: fingers (any shape, given as polygons in x across the board, y from the board's
// end y = 0 to the baseline y = Tb) joined by a bar behind the baseline, with a lip on the other
// face that hooks the board's end. Printed face down; turned over, it lies on the board's face with
// the lip over its end, and you mark round the fingers.
function combTemplate(o, name, key, width, Tb, fingers, label) {
  const bar = 22, t = 3, lipH = 6, lipT = 3, Wt = width + 16;
  const k = [box(Wt, bar, t, 0, Tb + bar / 2, 0), prisms(fingers, t, 0), box(Wt, lipT, t + lipH, 0, -lipT / 2, 0)];
  // the fingers start at the lip, so the lip runs the whole width
  k.push(engrave(label, 4.5, 0, Tb + bar - 6, t, 0.6));
  k.push(...honey(o, { axis: "z", at: -0.01, depth: t + 0.02, u0: -Wt / 2, u1: Wt / 2, v0: Tb, v1: Tb + bar, rim: 2, keep: [(u, v, r) => Math.abs(u) < label.length * 2.6 + r && v > Tb + bar - 11 - r] }));
  return { key, name, node: group(k), w: Wt, d: Tb + bar + lipT };
}

// dovetails, with half pins at both edges: n tails; the pins are p wide at their narrow side (the
// tail board's face) and widen by Tb/slope each side through the thickness
function dovetailJig(o) {
  const Tb = Math.max(6, o.vBoard), Wb = Math.max(30, o.vWidth), n = Math.max(1, Math.min(12, Math.round(o.vTails))), sl = Math.max(3, o.vSlope), p = Math.max(2, o.vPin);
  const tw = (Wb - n * p) / n, sp = tw + p, ang = (Math.atan(1 / sl) * 180) / Math.PI, dx = Tb / sl;
  if (tw - 2 * dx < 2) throw new Error("The tails are too narrow for this board: use fewer tails, narrower pins or a wider board.");
  // tails on the tail board's face: wide at the board's end (y = 0), narrow at the baseline (y = Tb)
  const tails = [];
  for (let i = 0; i < n; i++) { const c = -Wb / 2 + p / 2 + tw / 2 + i * sp; tails.push([[c - tw / 2, 0], [c + tw / 2, 0], [c + tw / 2 - dx, Tb], [c - tw / 2 + dx, Tb]]); }
  const tpl = combTemplate(o, "Dovetail template", "dovet", Wb, Tb, tails, `1:${fmt(sl)}`);
  // saw guide: stands on the end grain, its two sides leaning at the slope; the plate behind it lies
  // against the board's face. Built lying on that plate (the plate on the bed).
  const Hg = 45, B = 46, D = Math.max(Tb, 16), lean = Hg / sl;
  const k = [prisms([rect(-B / 2 - lean - 6, -22, B / 2 + lean + 6, Hg)], 4, 0), prisms([[[-B / 2, 0], [B / 2, 0], [B / 2 - lean, Hg], [-B / 2 + lean, Hg]]], D, 4)];
  k.push(engrave(`1:${fmt(sl)} ${fmt(ang)}°`, 4, 0, Hg - 8, 4 + D, 0.6));
  k.push(...honey(o, { axis: "z", at: -0.01, depth: 4 + D + 0.02, u0: -B / 2, u1: B / 2, v0: 0, v1: Hg - 12, rim: 0, inside: ((ins) => (u, v, m) => ins(u, v, m + 3))(insidePoly([[-B / 2, 0], [B / 2, 0], [B / 2 - lean, Hg], [-B / 2 + lean, Hg]])) }));
  for (const sg of [-1, 1]) k.push(...honey(o, { axis: "z", at: -0.01, depth: 4.02, u0: sg > 0 ? 0 : -B / 2 - lean - 6, u1: sg > 0 ? B / 2 + lean + 6 : 0, v0: -22, v1: Hg, rim: 2, inside: (u, v, m) => v < -m || Math.abs(u) > B / 2 + m - (v / Hg) * lean }));
  const guide = { key: "dovsaw", name: "Dovetail saw guide", node: group(k), w: B + 2 * lean + 12, d: Hg + 22 };
  return {
    parts: [tpl, guide],
    info: [`${n} tail${n > 1 ? "s" : ""} on a ${fmt(Wb)} mm wide, ${fmt(Tb)} mm thick board, slope 1:${fmt(sl)} (${fmt(ang)}°): tails ${fmt(tw)} mm at the end, ${fmt(tw - 2 * dx)} mm at the baseline; pins ${fmt(p)} mm at their narrow side, half pins at both edges.`,
      "Template: lip over the tail board's end, mark round the tails on its face, square the lines across the end. Saw guide: stand it on the end grain with its plate against the face and saw down its leaning side (turn it round for the other side of each tail). Then mark the pins from the cut tails.",
      "1:6 suits softwoods, 1:8 hardwoods."],
  };
}

// box joints: fingers and gaps the same width; board A starts with a finger, board B with a gap
function boxJointJig(o) {
  const Tb = Math.max(4, o.bBoard), Wb = Math.max(20, o.bWidth), f = Math.max(3, o.bFinger);
  const n = Math.max(1, Math.floor(Wb / f)), used = n * f, x0 = -used / 2;
  const fingers = []; for (let i = 0; i < n; i += 2) fingers.push(rect(x0 + i * f, 0, x0 + (i + 1) * f, Tb));
  const tpl = combTemplate(o, "Box joint template", "boxt", Wb, Tb, fingers, `${fmt(f)} A`);
  // the key: fits the slot cut in a sled's fence (the finger width, a little under)
  const kw = f - Math.min(0.1, o.fit / 2), kl = 70, kh = Math.max(f, 8);
  const k = [box(kl, kw, kh, 0, 0, 0)];
  k.push(...honey(o, { axis: "y", at: kw / 2 + 1, depth: kw + 2, u0: -kl / 2, u1: kl / 2, v0: 0, v1: kh, rim: 2 }));
  const key = { key: "boxkey", name: "Box joint key", node: group(k), w: kl, d: kw };
  const left = Wb - used;
  return {
    parts: [tpl, key],
    info: [`${n} fingers and gaps of ${fmt(f)} mm on a ${fmt(Wb)} mm wide, ${fmt(Tb)} mm thick board${left > 0.5 ? ` (${fmt(left)} mm left over: trim the board to ${fmt(used)} mm, or change the finger width)` : ""}.`,
      "Template: mark board A round the fingers; for board B slide the template one finger along so its fingers mark B's gaps. Key: glue it into a slot in your sled's fence, one finger width from the blade; cut, move the board onto the key, cut again.",
      "Set the blade or bit height to the board's thickness."],
  };
}

// mortise and tenon: the guide straddles the board like the dowel jig; its slot is the mortise
function mortiseJig(o) {
  const Tb = Math.max(8, o.tBoard), w = Math.max(3, Math.min(Tb - 4, o.tWidth)), len = Math.max(w, o.tLength), off = o.tOffset || 0;
  const wall = 7, G = 22, F = 16, L = len + 2 * 24, Wd = Tb + 0.3 + 2 * wall, sw = w + o.fit;
  const k = [box(L, Wd, G, 0, 0, 0)];
  for (const sg of [-1, 1]) k.push(box(L, wall, F, 0, sg * (Tb / 2 + 0.15 + wall / 2), G - 0.01));
  k.push(box(len + o.fit, sw, G + 0.02, 0, off, -0.01, true));
  // lines on the cheeks at the mortise ends, to line up with your marks
  for (const sx of [-1, 1]) for (const sg of [-1, 1]) k.push(box(0.8, wall + 0.02, 1.2, sx * (len / 2 + o.fit / 2), sg * (Tb / 2 + 0.15 + wall / 2), G + F - 1));
  k.push(...sides(o, Wd / 2, Wd / 2 - (sw / 2 - off) - 2.5, Wd / 2 - (sw / 2 + off) - 2.5, { u0: -L / 2, u1: L / 2, v0: 0, v1: G + F, rim: 2, keep: [(u, v, r) => v + r > G + F - 3 && Math.abs(Math.abs(u) - (len + o.fit) / 2) < 2 + r] }));
  k.push(engraveUnder(`${fmt(w)} x ${fmt(len)}`, 4, 0, Tb / 2 + 0.15 + 3.2, 0.5));
  const guide = { key: "mortise", name: "Mortise guide", node: group(k), w: L, d: Wd };
  // tenon gauge: an open slot exactly the mortise width (a snug fit), to test the cheeks
  const gw = Math.max(44, w + 36), gl = 50, gh = 12, gs = w + Math.min(0.1, o.fit / 2), depth = Math.min(o.tDepth || 30, gl - 12);
  const g = [box(gl, gw, gh, 0, 0, 0), box(depth + 0.02, gs, gh + 0.02, gl / 2 - depth / 2 + 0.01, 0, -0.01, true)];
  g.push(engrave(fmt(w), 4, -gl / 2 + 8, 0, gh, 0.6));
  g.push(...honey(o, { axis: "z", at: -0.01, depth: gh + 0.02, u0: -gl / 2, u1: gl / 2, v0: -gw / 2, v1: gw / 2, rim: 3, keep: [keepV(0, gs / 2 + 3), keepC(-gl / 2 + 8, 0, 8)] }));
  const gauge = { key: "tenon", name: "Tenon gauge", node: group(g), w: gl, d: gw };
  return {
    parts: [guide, gauge],
    info: [`Mortise ${fmt(w)} × ${fmt(len)} mm in a ${fmt(Tb)} mm thick board${off ? `, ${fmt(off)} mm off centre` : ", centred on its thickness"}; the slot is ${fmt(sw)} mm wide so a ${fmt(w)} mm chisel or bit runs in it.`,
      "Guide: prints with the cheeks up; turn it over onto the board's edge, line its end marks up with your layout and clamp. Chop or rout to depth, a few mm at a time. Tenon gauge: pare the tenon's cheeks until it just slides into the gauge's slot.",
      "A mortise about a third of the board's thickness is the usual choice."],
  };
}

// lap joints: a bridge across the board; the window is the mating board's width
function lapJig(o) {
  const Tb = Math.max(4, o.lBoard), Wb = Math.max(15, o.lWidth), m = Math.max(10, o.lMate), wall = 8, t = 8, F = 16, side = 26;
  const win = m + o.fit, Lx = win + 2 * side, Wy = Wb + 0.3 + 2 * wall;
  const k = [box(Lx, Wy, t, 0, 0, 0), box(win, Wy + 0.02, t + 0.02, 0, 0, -0.01, true)];
  for (const sg of [-1, 1]) for (const sx of [-1, 1]) k.push(box(side, wall, F, sx * (win / 2 + side / 2), sg * (Wb / 2 + 0.15 + wall / 2), t - 0.01));
  for (const sx of [-1, 1]) k.push(...honey(o, { axis: "z", at: -0.01, depth: t + 0.02, u0: sx > 0 ? win / 2 : -Lx / 2, u1: sx > 0 ? Lx / 2 : -win / 2, v0: -Wy / 2, v1: Wy / 2, rim: 2, keep: [keepU(sx * (win / 2), 3)] }));
  for (const sx of [-1, 1]) k.push(...honey(o, { axis: "y", at: Wy / 2 + 1, depth: Wy + 2, u0: sx > 0 ? win / 2 : -Lx / 2, u1: sx > 0 ? Lx / 2 : -win / 2, v0: t, v1: t + F, rim: 2.5, keep: [keepU(sx * (win / 2), 3)] }));
  k.push(engraveUnder(`${fmt(m)}`, 4, win / 2 + side / 2, 0, 0.5));
  const bridge = { key: "lap", name: "Lap joint guide", node: group(k), w: Lx, d: Wy };
  // depth gauge: a step half the board's thickness
  const half = Tb / 2, gl = 48, gw = 24, gh = half + 14;
  const g = [box(gl, gw, gh, 0, 0, 0), box(gl / 2 + 0.02, gw + 0.02, half + 0.02, gl / 4 + 0.01, 0, gh - half, true)];
  g.push(engrave(`${fmt(half)}`, 4, -gl / 4, 0, gh, 0.6));
  g.push(...honey(o, { axis: "y", at: gw / 2 + 1, depth: gw + 2, u0: -gl / 2, u1: gl / 2, v0: 0, v1: gh - half, rim: 2 }));
  g.push(...honey(o, { axis: "z", at: -0.01, depth: gh - half + 0.02, u0: -gl / 2, u1: 0, v0: -gw / 2, v1: gw / 2, rim: 2, keep: [keepC(-gl / 4, 0, 6)] }));
  const gauge = { key: "lapg", name: "Lap depth gauge", node: group(g), w: gl, d: gw };
  return {
    parts: [bridge, gauge],
    info: [`For a ${fmt(Wb)} mm wide, ${fmt(Tb)} mm thick board crossed by a ${fmt(m)} mm wide one: the window is ${fmt(win)} mm, the lap ${fmt(half)} mm deep.`,
      "Guide: prints with its legs up; turn it over across the board, legs either side, over your marks. Saw down both inner faces of the window (or rout with a bearing bit), clear the waste between, and check the depth with the gauge's step. Cut the mating board the same way.",
      "Make a few extra saw cuts in the waste to make it easy to chisel out."],
  };
}

const MAKERS = { miter: miterBox, dowel: dowelJig, pocket: pocketJig, square: trySquare, angle: angleTemplates, drill: drillGuide, dove: dovetailJig, box: boxJointJig, mortise: mortiseJig, lap: lapJig };

// the parts of a jig, laid out in a row along X: [{ key, name, node, x, y }]
export function jigSet(o0) {
  const o = { ...JIG_DEFAULTS, ...o0 };
  const r = (MAKERS[o.type] || miterBox)(o);
  let x = 0;
  const parts = r.parts.map((p) => { const px = x + p.w / 2; x += p.w + 12; return { ...p, x: px, y: 0, color: "#c8a26a" }; });
  const mid = x / 2 - 6; for (const p of parts) p.x -= mid;
  return { parts, info: r.info };
}
