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
};
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

// all the parts of a bin set: [{ key, name, node, z, color, kind }] with z the height of its unit
export function binSet(o0) {
  const o = { ...BIN_DEFAULTS, ...o0 };
  const units = Math.max(1, Math.min(8, Math.round(o.units || 1)));
  if (o.style === "bin" || !o.style) {
    const one = binParts(o), parts = [];
    const pitch = Math.max(5, o.h) - (o.stack ? Math.max(1, Math.min(o.foot, o.h / 3)) : 0);
    for (let i = 0; i < units; i++) parts.push({ key: i ? "bin" + i : "main", name: units > 1 ? "Bin " + (i + 1) : "Bin", node: one.bin, z: i * pitch, color: "#5b8fd6", kind: "bin" });
    if (one.lid) parts.push({ key: "lid", name: "Lid", node: one.lid, z: 0, dx: o.w + 12, color: "#e0a43a", kind: "lid" });
    if (o.layout === "print") parts.forEach((q, i) => { if (q.kind === "bin") { q.dx = i * (o.w + 10); q.z = 0; } else q.dx = units * (o.w + 10); });
    return { parts, cell: one.cell, info: "" };
  }
  const c = caseParts(o), parts = [];
  for (let i = 0; i < units; i++) {
    parts.push({ key: i ? "case" + i : "main", name: units > 1 ? `Case ${i + 1}` : "Case", node: c.shell, z: i * o.h, color: "#5b8fd6", kind: "case" });
    parts.push({ key: "front" + i, name: (o.style === "drawer" ? "Drawer" : o.style === "tilt" ? "Tilt bin" : "Door") + (units > 1 ? " " + (i + 1) : ""), node: c.front, z: i * o.h, color: "#e0a43a", kind: o.style });
  }
  // laid out for printing: each case in a row, its drawer, bin or door in a row in front
  if (o.layout === "print") parts.forEach((q, i) => {
    const k = Math.floor(i / 2); q.dx = k * (o.w + 10); q.z = 0; if (q.kind !== "case") q.dy = -(o.d + 15);
    // a door is turned to lie on its flat back, the pull up
    if (q.kind === "door" && c.flat) { const f = c.flat; q.node = group([kid(q.node, Rx(-Math.PI / 2, 0, -(f.z0 + f.fh / 2), f.y0 + f.td / 2))]); }
  });
  return { parts, cell: c.cell, info: c.info };
}

export function caseParts(o) {
  const W = Math.max(30, o.w), D = Math.max(30, o.d), H = Math.max(20, o.h), cl = Math.max(0, o.clear);
  const t = Math.max(1.2, o.caseT || 2.4), wall = Math.max(0.6, o.wall), fl = Math.max(0.6, o.floor), div = Math.max(0.6, o.divider);
  const R = Math.max(0, Math.min(o.radius, W / 2 - 1, D / 2 - 1));
  const lock = o.lock || "none";
  // stacking features (rails or pegs on top, grooves or holes underneath)
  const DV = { neck: 7, head: 10, h: 3 }, PEG = { d: 6, h: 3, inset: 10 };
  const lockDepth = lock === "dovetail" ? DV.h + cl + 0.2 : lock === "pegs" ? PEG.h + 0.6 : 0;
  const tb = Math.max(t, lockDepth ? lockDepth + 1.2 : 0), tt = t, tback = t;
  const iw = W - 2 * t, ih = H - tb - tt, idp = D - tback;
  if (iw < 15 || ih < 10 || idp < 15) throw new Error("The case is too small inside: make it bigger, or the walls thinner");
  // ---- the case
  const ck = [kid(prim("box", { w: W, d: D, h: H, rv: R }))];
  ck.push(kid(prim("box", { w: iw, d: idp + 1, h: ih }), T(0, -D / 2 + (idp + 1) / 2 - 1, tb), true));
  const xs = [-W / 4, W / 4], pegXY = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [i * (W / 2 - PEG.inset), j * (D / 2 - PEG.inset)]);
  if (lock === "dovetail") for (const x of xs) {
    // rails stop 3 short of the front, so the case above slides on from the front and stops flush
    ck.push(kid(extr(dovetailXZ(DV.neck, DV.head, DV.h), PLANE_XZ, D - 3), T(x, D / 2, H - 0.01)));
    // the groove is open at the back and closed at the front: the case above stops flush
    ck.push(kid(extr(dovetailXZ(DV.neck, DV.head, DV.h + 0.01, cl), PLANE_XZ, D - 2 + cl), T(x, D / 2 + 1, -0.01), true));
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
    tk.push(kid(rodX(bw + 2 * (cl + 0.6) + 2 * (t - 0.7), 4), T(0, p, p)));
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
    const xh = hs * (W / 2 - t - cl - td / 2), y0 = -D / 2 + setback + td / 2, z0 = tb + cl;
    const dw = fw - td / 2;
    const dk = [
      kid(prim("box", { w: dw, d: td, h: fh }), T(xh - hs * (dw / 2), 0, 0)),
      kid(prim("cylinder", { w: td, d: td, h: fh }), T(xh, 0, 0)),
      kid(prim("cylinder", { w: pin, d: pin, h: tt * 0.7 + cl }), T(xh, 0, fh - 0.01)),
      kid(prim("cylinder", { w: pin, d: pin, h: tb * 0.7 + cl }), T(xh, 0, -(tb * 0.7 + cl) + 0.01)),
    ];
    // the pull, near the free edge: a knob, a finger hole through the door, or a bar
    const px = xh - hs * (dw - Math.min(12, dw * 0.15)), pz = fh * 0.5, pull = o.doorPull || "knob";
    if (pull === "hole") { const hd = Math.min(16, fh * 0.45, dw * 0.25); dk.push(kid(rodY(td + 2, hd), T(xh - hs * (dw - hd / 2 - 5), -td / 2 - 1, pz), true)); }
    else if (pull === "bar") { const bl = Math.min(fh * 0.5, 50), bx = xh - hs * (dw - 9); dk.push(kid(prim("box", { w: 4, d: 8, h: bl, rv: 2 }), T(bx, -td / 2 - 8 + 0.01, pz - bl / 2))); for (const s of [-1, 1]) dk.push(kid(prim("box", { w: 4, d: 8, h: 5 }), T(bx, -td / 2 - 4 + 0.01, pz + s * (bl / 2 - 2.5) - 2.5))); }
    else { dk.push(kid(rodY(6.5, 6), T(px, -td / 2 - 6, pz))); dk.push(kid(prim("sphere", { w: 11, d: 11, h: 11 }), T(px, -td / 2 - 6 - 3.5, pz - 5.5))); }
    front = group([kid(group(dk), T(0, y0, z0))]);
    FLAT = { y0, z0, fh, td };
    for (const [z, h] of [[-0.01, tb + 0.02], [H - tt - 0.01, tt + 0.02]]) ck.push(kid(prim("cylinder", { w: pin + 2 * cl, d: pin + 2 * cl, h }), T(xh, y0, z), true));
    // a little catch: a bump on the case floor the door's free corner clicks over
    ck.push(kid(prim("cylinder", { w: 2, d: 2, h: 0.55 }), T(-hs * (iw / 2 - 6), y0 + td / 2 + 1.4, tb - 0.01)));
    // a strip up the inside of the far wall, just behind the door, so it can't swing in
    ck.push(kid(prim("box", { w: 1.6, d: 1.6, h: ih + 0.02 }), T(-hs * (iw / 2 - 0.79), y0 + td / 2 + 0.3 + 0.8, tb - 0.01)));
    cell = null;
    info = `Door ${r6(fw).toFixed(1)} × ${r6(fh).toFixed(1)}, hinged on the ${hs < 0 ? "left" : "right"}. Bend the door slightly to push its pins into the holes in the case top and bottom.`;
  }
  // a door to print lies on its flat back: turned so the back is down at z = 0
  const flat = o.style === "door" ? FLAT : null;
  return { shell: group(ck), front, cell, info, flat };
}
let FLAT = null;
// a round rod along Y, from y = 0 to y = len, centred on X and Z
function rodY(len, dia) {
  // the cylinder's axis (z) turned to +y
  return group([kid(prim("cylinder", { w: dia, d: dia, h: len }), [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])]);
}
