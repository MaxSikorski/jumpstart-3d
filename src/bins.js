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
};

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
