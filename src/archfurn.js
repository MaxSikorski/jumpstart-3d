// Architect furniture: a big library of furniture, fixtures and appliances (sofas, beds, kitchen
// cabinets and appliances, sinks, toilets, tubs and showers, desks, lamps, rugs, outdoor and garage
// things...) that can be placed in the rooms. Every item is built from simple closed shapes, so it
// can be drawn, exported with the house (STL, OBJ, 3MF) and drawn from above on the floor plan.
// It includes everything in the Floor Planner's catalog, at the same sizes.
// Sizes are mm, Z up. An item's front faces -Y; its back (the side against a wall) is +Y.
import * as THREE from "three";
import { MORE_CATS, MORE_ITEMS, MORE_SNAPS, moreBuilders, ON_TOP } from "./archmore.js";

const IN = 25.4;
// a lighter (f > 1) or darker (f < 1) shade of a colour
function shade(c, f) {
  const n = parseInt(c.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 1) { r *= f; g *= f; b *= f; } else { const t = f - 1; r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}
// a part's colour: "$" is the item's main colour (which can be changed), "$d"/"$dd" darker, "$l" lighter
export function partColor(c, main) {
  if (c === "$") return main;
  if (c === "$d") return shade(main, 0.75);
  if (c === "$dd") return shade(main, 0.5);
  if (c === "$l") return shade(main, 1.35);
  return c;
}
const WOOD = "#7a5230", OAK = "#b5834e", DARK = "#2b2f36", BLACK = "#1b1d22", WHITE = "#f4f6f8", STEEL = "#c3c8cd", METAL = "#8a9099", BRASS = "#c9a23a", STONE = "#e6e1d6", CREAM = "#f3ead8", SCREEN = "#20242c", WATER = "#7fc3e6", GREEN = "#4f8f3c";

// ------------------------------------------------------------------ building blocks
// The parts of one item at the origin: [{geo, c, fp (outline seen from above), top, glass, np}]
function maker() {
  const parts = [];
  let M = new THREE.Matrix4();
  const outline = (pts) => { const e = M.elements; return pts.map(([x, y]) => [e[0] * x + e[4] * y + e[12], e[1] * x + e[5] * y + e[13]]); };
  const rect = (x, y, w, d) => [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
  const ell = (x, y, rx, ry, n = 16) => { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]); } return p; };
  const add = (geo, c, fp, o = {}) => {
    geo.applyMatrix4(M); geo.computeBoundingBox();
    parts.push({ geo, c, fp: outline(fp), top: geo.boundingBox.max.z, glass: c === "glass", np: !!o.np });
  };
  const P = {
    parts,
    // a box: centred at x, y; bottom at z
    box(x, y, z, w, d, h, c, o) { add(new THREE.BoxGeometry(Math.max(1, w), Math.max(1, d), Math.max(1, h)).translate(x, y, z + h / 2), c, rect(x, y, w, d), o); },
    // a standing cylinder (an oval one when ry is given; a cone-ish one with rt)
    cyl(x, y, z, r, h, c, o = {}) {
      const rt = o.rt ?? r, ry = o.ry ?? r, g = new THREE.CylinderGeometry(rt, r, Math.max(1, h), o.seg || 20).rotateX(Math.PI / 2);
      if (ry !== r) g.scale(1, ry / r, 1);
      g.translate(x, y, z + h / 2);
      const R = Math.max(r, rt); add(g, c, ell(x, y, R, R * (ry / r)), o);
    },
    // a cylinder lying along X (centred at x, y, z) / along Y
    cylX(x, y, z, r, len, c, o = {}) { add(new THREE.CylinderGeometry(r, r, Math.max(1, len), o.seg || 16).rotateZ(Math.PI / 2).translate(x, y, z), c, rect(x, y, len, 2 * r), o); },
    cylY(x, y, z, r, len, c, o = {}) { add(new THREE.CylinderGeometry(r, r, Math.max(1, len), o.seg || 16).translate(x, y, z), c, rect(x, y, 2 * r, len), o); },
    // a cylinder through the front face (a dial, a washer door): along Y, thin
    disc(x, y, z, r, t, c, o = {}) { add(new THREE.CylinderGeometry(r, r, Math.max(1, t), o.seg || 24).translate(x, y, z), c, rect(x, y, 2 * r, t), { np: true, ...o }); },
    // a ball (an ellipsoid with ry, rz), centred at x, y, z
    ball(x, y, z, r, c, o = {}) { const ry = o.ry ?? r, rz = o.rz ?? r; add(new THREE.SphereGeometry(1, o.seg || 16, 12).scale(r, ry, rz).translate(x, y, z), c, ell(x, y, r, ry), o); },
    // a flat polygon (points in X, Y) extruded h up from z; turn it with at() to stand it up
    poly(pts, z, h, c, o = {}) { const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))); add(new THREE.ExtrudeGeometry(sh, { depth: Math.max(1, h), bevelEnabled: false, curveSegments: 4 }).translate(0, 0, z), c, pts, o); },
    cone(x, y, z, r, h, c, o = {}) { add(new THREE.ConeGeometry(r, h, o.seg || 20).rotateX(Math.PI / 2).translate(x, y, z + h / 2), c, ell(x, y, r, r), o); },
    // the parts made in fn, moved to x, y, z and turned by rz (around Z) then rx (tilt around X)
    at(x, y, z, rz, fn, rx = 0, ry = 0) {
      const M0 = M;
      M = M0.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(new THREE.Matrix4().makeRotationX(rx)).multiply(new THREE.Matrix4().makeRotationY(ry));
      try { fn(); } finally { M = M0; }
    },
  };
  return P;
}
const legs4 = (p, W, D, h, s, c, inset = 40, z = 0) => { for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.box(i * (W / 2 - inset - s / 2), j * (D / 2 - inset - s / 2), z, s, s, h, c); };
const rlegs4 = (p, W, D, h, r, c, inset = 40, z = 0) => { for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.cyl(i * (W / 2 - inset - r), j * (D / 2 - inset - r), z, r, h, c, { rt: r * 1.15, seg: 10 }); };
// drawer or door fronts on the front face (y = -D/2): cols × rows between z0 and z1, with knobs
function fronts(p, W, D, z0, z1, cols, rows, c, knob = METAL, o = {}) {
  const g = 12, cw = (W - g * (cols + 1)) / cols, rh = (z1 - z0 - g * (rows + 1)) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -W / 2 + g + cw / 2 + i * (cw + g), z = z0 + g + j * (rh + g);
    p.box(x, -D / 2 - 6, z, cw, 14, rh, c, { np: true });
    if (o.bar) p.box(o.door ? x + (i % 2 ? -1 : 1) * (cw / 2 - 40) : x, -D / 2 - 22, o.door ? z + rh * 0.55 : z + rh - 45, o.door ? 18 : Math.min(cw * 0.5, 260), 14, o.door ? Math.min(220, rh * 0.4) : 16, knob, { np: true });
    else p.disc(o.door ? x + (i % 2 ? -1 : 1) * (cw / 2 - 45) : x, -D / 2 - 22, o.door ? z + rh * 0.55 : z + rh / 2, 16, 22, knob);
  }
}
const faucet = (p, x, y, z, c = STEEL) => { p.cyl(x, y, z, 18, 260, c, { seg: 10 }); p.cylY(x, y - 70, z + 245, 14, 150, c, { np: true }); p.box(x + 55, y, z, 20, 20, 90, c, { np: true }); };
// some books on a shelf from x0 to x1, standing at z, up to h tall, depth d
function books(p, x0, x1, y, z, h, d, seed) {
  const cs = ["#b23a48", "#2f5d8a", "#e0b04a", "#3f7f5a", "#6b4f8a", "#d06f3c", "#2b2f36", "#c9c2b0"];
  let x = x0, k = seed;
  while (x < x1 - 30) {
    k = (k * 9301 + 49297) % 233280; const r = k / 233280, w = 25 + r * 30, hh = h * (0.7 + 0.28 * r);
    if (r > 0.86) { x += 60; continue; }
    p.box(x + w / 2, y, z, w, d * (0.75 + 0.2 * r), hh, cs[Math.floor(r * cs.length)], { np: true }); x += w + 2;
  }
}

// ------------------------------------------------------------------ the builders
// each gets (p, W, D, H, o, it) and adds the item's parts; front at -Y, back at +Y
const B = {
  sofa(p, W, D, H, o) {
    const n = o.seats || Math.max(1, Math.round(W / 700)), arm = o.arm ?? Math.min(200, W * 0.13), leg = o.leg ?? 90, seat = H * 0.5;
    rlegs4(p, W, D, leg, 22, DARK, 70);
    p.box(0, 0, leg, W, D, seat - leg - 130, "$d");
    const cw = (W - 2 * arm) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + arm + cw * (i + 0.5);
      p.box(x, -D * 0.08, seat - 140, cw - 14, D * 0.66, 150, "$");
      p.box(x, D / 2 - D * 0.27, seat, cw - 24, D * 0.16, (H - seat) * 0.82, "$l");
    }
    p.box(0, D / 2 - D * 0.1, leg, W, D * 0.2, H - leg, "$");
    for (const s of [-1, 1]) p.box(s * (W / 2 - arm / 2), 0, leg, arm, D, seat + (o.recl ? 160 : 90) - leg, "$");
    if (o.pillows) for (const s of [-1, 1]) p.at(s * (W / 2 - arm - 170), D / 2 - D * 0.38, seat + 20, s * 0.2, () => p.box(0, 0, 0, 300, 110, 300, o.pillows, { np: true }), -0.25);
    if (o.recl) p.box(0, -D / 2 + 60, leg + 30, W - 2 * arm - 40, 60, seat - leg - 160, "$d", { np: true });
  },
  sectional(p, W, D, H, o) {
    const d0 = 940, arm = 200;
    p.at(0, D / 2 - d0 / 2, 0, 0, () => B.sofa(p, W, d0, H, { seats: 3, arm, pillows: o.pillows }));
    const leg = 90, seat = H * 0.5, x = -W / 2 + d0 / 2, len = D - d0;
    p.box(x, -D / 2 + len / 2, leg, d0, len, seat - leg - 130, "$d");
    p.box(x + arm / 2, -D / 2 + len / 2 + 10, seat - 140, d0 - arm - 14, len - 20, 150, "$");
    p.box(-W / 2 + arm / 2, -D / 2 + len / 2, leg, arm, len, seat + 90 - leg, "$");
    p.at(x, -D / 2 + len / 2, 0, 0, () => rlegs4(p, d0, len, leg, 22, DARK, 60));
  },
  ottoman(p, W, D, H, o) {
    if (o.round) { p.cyl(0, 0, 60, W / 2, H - 60, "$", { ry: D / 2 }); p.cyl(0, 0, 0, W / 2 - 40, 60, DARK, { ry: D / 2 - 40 }); return; }
    rlegs4(p, W, D, 80, 20, DARK, 40); p.box(0, 0, 80, W, D, H - 80, "$");
    if (o.tuft) for (const i of [-1, 0, 1]) for (const j of [-1, 1]) p.ball(i * W * 0.28, j * D * 0.22, H, 14, "$d", { np: true });
  },
  beanbag(p, W, D, H) { p.ball(0, -D * 0.05, H * 0.34, W / 2, "$", { ry: D / 2, rz: H * 0.34 }); p.ball(0, D * 0.2, H * 0.6, W * 0.38, "$", { ry: D * 0.28, rz: H * 0.4 }); },
  table(p, W, D, H, o) {
    const t = o.t || 35, top = o.glass ? "glass" : o.top || "$";
    if (o.round) {
      p.cyl(0, 0, H - t, W / 2, t, top, { ry: D / 2, seg: 32 });
      if (o.ped || W < 800 && !o.legs4) { p.cyl(0, 0, 0, Math.min(W, D) * 0.28, 30, "$d"); p.cyl(0, 0, 30, 45, H - t - 30, "$d", { seg: 12 }); }
      else rlegs4(p, W * 0.72, D * 0.72, H - t, 22, "$d", 0);
    } else {
      p.box(0, 0, H - t, W, D, t, top);
      if (o.glass) { legs4(p, W, D, H - t, 30, o.frame || METAL, 30); p.box(0, 0, 120, W - 80, D - 80, 12, o.frame || METAL, { np: true }); }
      else if (o.trestle) { for (const s of [-1, 1]) { p.box(s * (W / 2 - 180), 0, 0, 80, D * 0.75, 50, "$d"); p.box(s * (W / 2 - 180), 0, 50, 70, 90, H - t - 50, "$d"); } p.box(0, 0, H * 0.35, W - 360, 60, 60, "$d", { np: true }); }
      else legs4(p, W, D, H - t, o.leg || 45, o.legc || "$d", o.inset ?? 35);
      if (o.shelf) p.box(0, 0, 140, W - 90, D - 90, 22, "$d", { np: true });
      if (o.apron) { p.box(0, -D / 2 + 40, H - t - 90, W - 80, 20, 90, "$d", { np: true }); p.box(0, D / 2 - 40, H - t - 90, W - 80, 20, 90, "$d", { np: true }); }
      if (o.drawer) fronts(p, W * 0.6, D, H - t - 140, H - t, 1, 1, "$l", BRASS);
    }
  },
  chair(p, W, D, H, o) {
    const seat = o.seat || 450, c = o.frame || "$d";
    if (o.metal) rlegs4(p, W, D, seat - 40, 12, c, 25); else legs4(p, W, D, seat - 40, 34, c, 20);
    p.box(0, 0, seat - 40, W, D, 40, "$");
    if (o.pad) p.box(0, -15, seat, W - 50, D - 70, 30, o.pad, { np: true });
    p.box(0, D / 2 - 20, seat, W, 34, H - seat, c === "$d" ? "$d" : c);
    if (o.slats) for (const x of [-W / 4, 0, W / 4]) p.box(x, D / 2 - 20, seat, 30, 36, H - seat - 40, "$d", { np: true });
    if (o.arm) for (const s of [-1, 1]) { p.box(s * (W / 2 - 20), 0, seat + 180, 40, D - 40, 30, c); p.box(s * (W / 2 - 20), -D / 2 + 40, seat, 30, 30, 190, c, { np: true }); }
  },
  stool(p, W, D, H, o) {
    const r = W / 2;
    p.cyl(0, 0, H - 50, r, 50, "$", { seg: 24 });
    if (o.back) p.box(0, r - 20, H, W * 0.7, 30, 280, "$d");
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; p.cyl(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, 0, 14, H - 50, o.frame || METAL, { seg: 8 }); }
    p.cyl(0, 0, H * 0.32, r * 0.66, 18, o.frame || METAL, { np: true, seg: 20 });
  },
  ochair(p, W, D, H, o) {
    const seat = 470, c = o.frame || DARK;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.at(0, 0, 60, a, () => { p.box(W * 0.22, 0, 0, W * 0.44, 50, 35, c, { np: true }); p.ball(W * 0.43, 0, -25, 30, BLACK, { np: true }); }); }
    p.cyl(0, 0, 90, 28, seat - 150, METAL, { seg: 10 });
    p.box(0, -20, seat - 60, W * 0.82, D * 0.8, 80, "$");
    p.at(0, D * 0.36, seat, 0, () => p.box(0, 0, 0, W * 0.78, 60, H - seat, "$"), -0.12);
    if (o.gaming) { p.at(0, D * 0.4, seat + 30, 0, () => { for (const s of [-1, 1]) p.box(s * W * 0.33, 0, 0, W * 0.16, 80, H - seat - 20, o.accent || "#c8243a", { np: true }); }, -0.12); }
    for (const s of [-1, 1]) { p.box(s * (W * 0.42), 0, seat + 170, 60, D * 0.45, 30, c); p.box(s * (W * 0.42), 40, seat - 30, 30, 30, 200, c, { np: true }); }
  },
  bench(p, W, D, H, o) {
    const t = o.cush ? 80 : 45;
    if (o.solid) p.box(0, 0, 0, W, D, H - t, "$d"); else legs4(p, W, D, H - t, 45, o.legc || "$d", 30);
    p.box(0, 0, H - t, W, D, t, "$");
    if (o.back) p.box(0, D / 2 - 25, H, W, 40, o.back, "$d");
  },
  tv(p, W, D, H, o) {
    const sh = o.sh || 560, tw = (o.tv || 55) * 0.87 * IN, th = (o.tv || 55) * 0.49 * IN;
    p.box(0, 0, 0, W, D, sh, "$");
    fronts(p, W, D, 40, sh - 30, Math.max(2, Math.round(W / 500)), 1, "$l", METAL, { door: true });
    p.box(0, D * 0.1, sh, 300, 200, 20, BLACK, { np: true });
    p.box(0, D * 0.1, sh + 20, 60, 40, 60, BLACK, { np: true });
    p.box(0, D * 0.12, sh + 70, Math.min(tw, W + 200), 45, th, SCREEN);
    if (o.bar) p.box(0, -D * 0.2, sh, Math.min(tw * 0.8, W - 40), 90, 70, BLACK, { np: true });
  },
  wallpanel(p, W, D, H, o) {
    const z = o.z || 0, c = o.face || "$";
    p.box(0, D / 2 - (o.t || 40) / 2, z, W, o.t || 40, H, o.frame || "$d");
    p.box(0, D / 2 - (o.t || 40) - 2, z + (o.m ?? 40), W - 2 * (o.m ?? 40), 6, H - 2 * (o.m ?? 40), c, { np: true });
    if (o.tray) p.box(0, D / 2 - 70, z - 10, W * 0.6, 60, 30, METAL, { np: true });
  },
  walltv(p, W, D, H, o) { p.box(0, D / 2 - 30, o.z || 1000, W * 0.35, 30, H * 0.4, BLACK, { np: true }); p.box(0, D / 2 - 55, o.z || 1000, W, 40, H, SCREEN); if (o.bar) p.box(0, D / 2 - 60, (o.z || 1000) - 160, W * 0.7, 90, 80, BLACK, { np: true }); },
  shelf(p, W, D, H, o) {
    const s = 22, n = o.n || Math.max(2, Math.round(H / 340)), z0 = o.z || 0, c = "$";
    for (const x of [-1, 1]) p.box(x * (W / 2 - s / 2), 0, z0, s, D, H, c);
    if (!o.open) p.box(0, D / 2 - 5, z0, W - 2 * s, 10, H, "$d", { np: true });
    if (!o.wall) p.box(0, 0, z0, W - 2 * s, D, 60, "$d");
    const step = (H - (o.wall ? 0 : 60)) / n;
    for (let i = 0; i <= n; i++) { const z = z0 + (o.wall ? 0 : 60) + Math.min(i * step, H - s - (o.wall ? 0 : 60)); p.box(0, 0, z, W - 2 * s, D, s, c, { np: i > 0 && i < n }); if (i < n && !o.empty) books(p, -W / 2 + s + 10, W / 2 - s - 10, 0, z + s, step - s - 40, D - 30, i * 7 + Math.round(W)); }
    if (o.cols) for (let k = 1; k < o.cols; k++) p.box(-W / 2 + (W / o.cols) * k, 0, z0, s, D, H, c, { np: true });
  },
  fireplace(p, W, D, H, o) {
    const c = o.stone || "$";
    p.box(0, D / 2 - (D - 120) / 2, 0, W, D - 120, H, c);
    p.box(0, -D / 2 + 60, 0, W + 160, 240, 120, "$d");
    p.box(0, -D / 2 + 112, 120, W * 0.5, 40, H * 0.5, BLACK, { np: true });
    p.box(0, 0, H, W + 200, D - 40, 70, o.mantel || WOOD);
    for (const x of [-60, 60]) p.cylX(x * 0.6, -D / 2 + 60, 170, 45, W * 0.3, "#6b4a2b", { np: true });
    p.cone(0, -D / 2 + 60, 120, 110, 260, "#ff8c3a", { np: true, seg: 10 });
  },
  lamp(p, W, D, H, o) {
    const sh = o.shade || "$";
    if (o.table) { B.table(p, W, D, o.th || 600, { round: true, ped: true, top: o.wood || OAK }); p.ball(0, 0, (o.th || 600) + 140, 90, o.base || "#c9c2b0", { rz: 140 }); p.cyl(0, 0, (o.th || 600) + 250, 110, 200, sh, { rt: 80 }); p.cyl(0, 0, (o.th || 600) + 260, 8, 170, METAL, { np: true }); return; }
    p.cyl(0, 0, 0, W * 0.4, 25, DARK); p.cyl(0, 0, 25, 13, H - 340, o.pole || METAL, { seg: 10 });
    p.cyl(0, 0, H - 340, W / 2, 320, sh, { rt: W * 0.36 });
  },
  arclamp(p, W, D, H) {
    p.box(-W / 2 + 160, 0, 0, 300, 300, 80, STONE);
    const R = W - 300, n = 10;
    for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 0.62, a1 = ((i + 1) / n) * Math.PI * 0.62; const x0 = -W / 2 + 160 + R * (1 - Math.cos(a0)) * 0.9, z0 = 80 + (H - 500) * Math.sin(a0) / Math.sin(Math.PI * 0.62), x1 = -W / 2 + 160 + R * (1 - Math.cos(a1)) * 0.9, z1 = 80 + (H - 500) * Math.sin(a1) / Math.sin(Math.PI * 0.62); const L = Math.hypot(x1 - x0, z1 - z0); p.at((x0 + x1) / 2, 0, (z0 + z1) / 2, 0, () => p.cylX(0, 0, 0, 14, L, METAL, { np: true }), 0, -Math.atan2(z1 - z0, x1 - x0)); }
    p.ball(W / 2 - 230, 0, H - 380, 230, "$", { rz: 160 });
  },
  piano(p, W, D, H, o) {
    if (o.bench) { p.at(0, D / 2 - 305, 0, 0, () => B.piano(p, W, 610, H, {})); p.box(0, -D / 2 + 170, 0, 700, 330, 480, "$"); return; }
    p.box(0, D / 2 - (D - 300) / 2, 0, W, D - 300, H, "$");
    p.box(0, -D / 2 + 150, 650, W, 300, 80, "$");
    p.box(0, -D / 2 + 120, 730, W - 120, 150, 25, WHITE, { np: true });
    for (let i = 0; i < 18; i++) p.box(-W / 2 + 120 + (i + 0.5) * (W - 240) / 18, -D / 2 + 150, 755, 18, 90, 14, BLACK, { np: true });
    for (const s of [-1, 1]) p.box(s * (W / 2 - 40), -D / 2 + 110, 0, 60, 60, 650, "$", { np: true });
  },
  grandpiano(p, W, D, H) {
    p.cyl(0, D * 0.08, 600, W / 2, 330, "$", { ry: D * 0.42, seg: 32 });
    p.box(0, -D / 2 + 260, 600, W, 300, 330, "$");
    p.box(0, -D / 2 + 140, 720, W - 140, 160, 25, WHITE, { np: true });
    p.at(0, D * 0.08, 930, 0.15, () => p.cyl(0, 0, 0, W / 2 - 30, 20, "$", { ry: D * 0.4, seg: 32, np: true }), 0, -0.45);
    for (const [x, y] of [[-W / 2 + 120, -D / 2 + 260], [W / 2 - 120, -D / 2 + 260], [0, D / 2 - 220]]) p.cyl(x, y, 0, 45, 600, "$", { seg: 10 });
    p.box(0, -D / 2 - 220, 0, 750, 340, 480, "$");
  },
  plant(p, W, D, H, o) {
    const pot = o.pot || "$", ph = Math.min(H * 0.35, 380);
    p.cyl(0, 0, 0, W * 0.32, ph, pot, { rt: W * 0.4 });
    p.cyl(0, 0, ph - 10, W * 0.37, 12, "#5a3b25", { np: true });
    if (o.tall) { p.cyl(0, 0, ph, 25, H * 0.5, "#6b4a2b", { seg: 8, np: true }); for (const [x, y, z, r] of [[0, 0, H - W * 0.4, W * 0.42], [W * 0.18, 60, H * 0.62, W * 0.3], [-W * 0.2, -40, H * 0.7, W * 0.3]]) p.ball(x, y, z, r, o.leaf || GREEN); }
    else for (const [x, y, z, r] of [[0, 0, ph + W * 0.3, W * 0.42], [W * 0.2, 40, ph + W * 0.18, W * 0.28], [-W * 0.18, -50, ph + W * 0.22, W * 0.28]]) p.ball(x, y, z, r, o.leaf || GREEN);
  },
  aquarium(p, W, D, H) {
    const sh = 750;
    p.box(0, 0, 0, W, D, sh, "$"); fronts(p, W, D, 30, sh - 20, 2, 1, "$l", METAL, { door: true });
    p.box(0, 0, sh, W, D, 30, DARK); p.box(0, 0, sh + 30, W - 20, D - 20, H - sh - 80, WATER); p.box(0, 0, H - 50, W, D, 50, DARK);
    for (const [x, z, c] of [[-W * 0.2, sh + 200, "#ff8c3a"], [W * 0.15, sh + 300, "#f2c230"], [0, sh + 150, "#e65a3a"]]) p.ball(x, -D / 2 + 5, z, 30, c, { ry: 12, rz: 20, np: true });
  },
  clock(p, W, D, H) {
    p.box(0, 0, 0, W, D, 250, "$"); p.box(0, 0, 250, W * 0.75, D * 0.8, H - 700, "$"); p.box(0, 0, H - 450, W, D, 450, "$");
    p.disc(0, -D / 2 - 5, H - 230, W * 0.36, 10, CREAM); p.box(0, -D * 0.4 - 6, 450, W * 0.4, 10, H - 1250, "#e8dcc0", { np: true }); p.disc(0, -D * 0.4 - 12, 800, 70, 10, BRASS);
  },
  speaker(p, W, D, H) { p.box(0, 0, 0, W, D, H, "$"); for (const [z, r] of [[H * 0.25, W * 0.36], [H * 0.55, W * 0.36], [H * 0.82, W * 0.16]]) p.disc(0, -D / 2 - 6, z, r, 12, BLACK); },
  bed(p, W, D, H, o) {
    const wood = o.wood || WOOD, fz = o.low ? 80 : 160, mh = 260, mz = fz + 200;
    p.box(0, 0, fz, W, D - 60, 200, wood); legs4(p, W, D - 60, fz, 70, wood, 10);
    p.box(0, 0, mz, W - 40, D - 120, mh, WHITE);
    p.box(0, -D * 0.12, mz + 20, W - 10, (D - 120) * 0.72, mh + 25, "$");
    p.box(0, -D / 2 + 120, mz + mh + 25, W - 10, 260, 20, "$l", { np: true });
    const n = o.pillows || (W > 1300 ? 2 : 1);
    for (let i = 0; i < n; i++) p.box(-W / 2 + (W / n) * (i + 0.5), D / 2 - 260, mz + mh, W / n - 80, 340, 140, WHITE);
    p.box(0, D / 2 - 40, 0, W + 40, 80, H, wood);
    if (o.foot) p.box(0, -D / 2 + 30, 0, W + 40, 60, mz + 200, wood);
  },
  bunk(p, W, D, H, o) {
    const wood = o.wood || "$d";
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.box(i * (W / 2 - 35), j * (D / 2 - 35), 0, 70, 70, H, wood);
    for (const z of [250, 1250]) { p.box(0, 0, z, W, D, 120, wood); p.box(0, 0, z + 120, W - 100, D - 100, 180, WHITE); p.box(0, -D * 0.1, z + 130, W - 90, (D - 100) * 0.75, 190, "$"); p.box(0, D / 2 - 240, z + 300, W - 200, 300, 110, WHITE, { np: true }); }
    for (const s of [-1, 1]) p.box(0, s * (D / 2 - 35), H - 250, W, 40, 120, wood);
    p.box(-W / 2 + 35, 0, 1650, 40, D, 120, wood, { np: true });
    for (let k = 0; k < 6; k++) p.cylY(W / 2 + 20, -D / 2 + 300, 300 + k * 230, 16, 380, wood, { np: true });
    for (const y of [-D / 2 + 110, -D / 2 + 490]) p.box(W / 2 + 20, y, 0, 40, 40, 1700, wood, { np: true });
  },
  crib(p, W, D, H, o) {
    const wood = "$";
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.box(i * (W / 2 - 25), j * (D / 2 - 25), 0, 50, 50, H, wood);
    p.box(0, 0, 300, W - 60, D - 60, 140, WHITE);
    for (const z of [250, H - 50]) { p.box(0, -D / 2 + 25, z, W - 60, 40, 50, wood, { np: true }); p.box(0, D / 2 - 25, z, W - 60, 40, 50, wood, { np: true }); p.box(-W / 2 + 25, 0, z, 40, D - 60, 50, wood, { np: true }); p.box(W / 2 - 25, 0, z, 40, D - 60, 50, wood, { np: true }); }
    const n = Math.round((D - 60) / 110), m = Math.round((W - 60) / 110);
    for (let k = 1; k < n; k++) for (const s of [-1, 1]) p.cyl(s * (W / 2 - 25), -D / 2 + 30 + k * (D - 60) / n, 300, 12, H - 350, wood, { seg: 6, np: true });
    for (let k = 1; k < m; k++) for (const s of [-1, 1]) p.cyl(-W / 2 + 30 + k * (W - 60) / m, s * (D / 2 - 25), 300, 12, H - 350, wood, { seg: 6, np: true });
    p.box(0, 0, 440, W * 0.5, D * 0.4, 60, o.blanket || "#9cc9e8", { np: true });
  },
  dresser(p, W, D, H, o) {
    const plinth = o.legs ? 120 : 60;
    if (o.legs) legs4(p, W, D, plinth, 40, "$d", 30); else p.box(0, 10, 0, W - 30, D - 20, plinth, "$d");
    p.box(0, 0, plinth, W, D, H - plinth - 25, "$");
    p.box(0, 5, H - 25, W + 20, D + 10, 25, o.top || "$d");
    fronts(p, W, D, plinth, H - 25, o.cols || (W > 1100 ? 2 : 1), o.rows || Math.max(1, Math.round((H - plinth) / 230)), o.front || "$l", o.knob || BRASS, { bar: o.bar });
    if (o.lamp) { p.ball(-W * 0.22, 0, H + 120, 70, "#c9c2b0", { rz: 120 }); p.cyl(-W * 0.22, 0, H + 200, 100, 170, CREAM, { rt: 75 }); }
    if (o.mirror) { p.box(0, D / 2 - 20, H, W * 0.8, 30, o.mirror, "$d"); p.box(0, D / 2 - 38, H + 40, W * 0.8 - 80, 6, o.mirror - 80, "#cfe6f2", { np: true }); }
  },
  wardrobe(p, W, D, H, o) {
    p.box(0, 0, 0, W, D, H - 40, "$"); p.box(0, 5, H - 40, W + 30, D + 10, 40, "$d");
    const doors = o.doors || 2, dw = (W - 20) / doors;
    for (let i = 0; i < doors; i++) { const x = -W / 2 + 10 + dw * (i + 0.5); p.box(x, -D / 2 - 6, 60, dw - 12, 14, H - 120 - (o.drawers ? 300 : 0), o.mirror && i % 2 ? "#cfe6f2" : "$l", { np: true }); p.box(x + (i % 2 ? -1 : 1) * (dw / 2 - 45), -D / 2 - 22, H * 0.48, 16, 14, 240, BRASS, { np: true }); }
    if (o.drawers) fronts(p, W, D, H - 400, H - 60, 2, 1, "$l", BRASS);
  },
  chest(p, W, D, H, o) { p.box(0, 0, 0, W, D, H - 50, "$"); p.box(0, 0, H - 50, W + 20, D + 20, 50, "$d"); if (o.straps) for (const x of [-W * 0.3, W * 0.3]) p.box(x, 0, 0, 40, D + 6, H - 10, METAL, { np: true }); p.box(0, -D / 2 - 8, H - 160, 60, 14, 80, BRASS, { np: true }); },
  desk(p, W, D, H, o) {
    const t = 30;
    if (o.l) { const dd = 760; p.at(0, D / 2 - dd / 2, 0, 0, () => B.desk(p, W, dd, H, { ...o, l: false })); p.box(-W / 2 + 300, -D / 2 + (D - dd) / 2, H - t, 600, D - dd + 2, t, "$"); for (const x of [-W / 2 + 25, -W / 2 + 575]) p.box(x, -D / 2 + 25, 0, 50, 50, H - t, "$d"); return; }
    p.box(0, 0, H - t, W, D, t, "$");
    if (o.stand) { for (const s of [-1, 1]) { p.box(s * (W / 2 - 120), 0, 0, 70, D * 0.8, 40, METAL); p.box(s * (W / 2 - 120), 0, 40, 60, 60, H - t - 40, METAL); } p.box(0, 0, H - t - 60, W - 280, 40, 50, METAL, { np: true }); }
    else if (o.ped !== false) { p.box(W / 2 - 220, 0, 0, 420, D - 40, H - t, "$d"); p.at(W / 2 - 220, 0, 0, 0, () => fronts(p, 420, D - 40, 0, H - t, 1, 3, "$l", METAL, { bar: true })); p.box(-W / 2 + 25, 0, 0, 50, D - 40, H - t, "$d"); p.box(-W / 4 + 50, D / 2 - 40, 250, W / 2, 20, H - t - 300, "$d", { np: true }); }
    else legs4(p, W, D, H - t, 45, o.legc || "$d", 25);
    if (o.pc) { p.box(0, D / 2 - 160, H, 220, 160, 15, BLACK, { np: true }); p.box(0, D / 2 - 160, H + 15, 50, 40, 140, BLACK, { np: true }); p.box(0, D / 2 - 175, H + 140, o.pc * 25.4 * 0.87, 30, o.pc * 25.4 * 0.5, SCREEN); p.box(0, -D / 2 + 200, H, 440, 140, 20, "#3a3f47", { np: true }); p.box(300, -D / 2 + 200, H, 60, 100, 25, "#3a3f47", { np: true }); }
    if (o.lamp) { p.cyl(-W / 2 + 140, D / 2 - 140, H, 70, 20, DARK, { np: true }); p.at(-W / 2 + 140, D / 2 - 140, H + 20, 0, () => p.cyl(0, 0, 0, 10, 380, DARK, { np: true }), 0.35); p.cyl(-W / 2 + 140, D / 2 - 270, H + 330, 80, 120, o.lamp, { rt: 40, np: true }); }
  },
  cab(p, W, D, H, o) {
    const kick = 100, top = o.top || STONE, ct = 38;
    p.box(0, 30, 0, W, D - 60, kick, BLACK);
    p.box(0, 0, kick, W, D, H - kick - ct, "$");
    const dr = o.drawers ? 0 : 150;
    if (o.drawers) fronts(p, W, D, kick, H - ct, 1, o.drawers, "$l", METAL, { bar: true });
    else { fronts(p, W, D, H - ct - dr, H - ct, 1, 1, "$l", METAL, { bar: true }); fronts(p, W, D, kick, H - ct - dr, W > 650 ? 2 : 1, 1, "$l", METAL, { bar: true, door: true }); }
    if (!o.notop) p.box(0, -12, H - ct, W, D + 25, ct, top);
  },
  cabc(p, W, D, H, o) {
    const d = 610, top = o.top || STONE;
    p.at(0, D / 2 - d / 2, 0, 0, () => B.cab(p, W, d, H, { notop: true }));
    p.at(-W / 2 + d / 2, -d / 2 + 0, 0, -Math.PI / 2, () => B.cab(p, D - d, d, H, { notop: true }));
    p.box(0, D / 2 - d / 2 - 12, H - 38, W, d + 25, 38, top);
    p.box(-W / 2 + d / 2 + 12, -d / 2, H - 38, d + 25, D - d, 38, top);
  },
  cabw(p, W, D, H, o) {
    const z = o.z || 1370;
    p.box(0, 0, z, W, D, H, "$");
    fronts(p, W, D, z, z + H, W > 650 ? 2 : 1, 1, o.glass ? "#cfe6f2" : "$l", METAL, { bar: true, door: true });
    p.box(0, -4, z + H, W + 10, D + 8, 30, "$d", { np: true });
  },
  pantry(p, W, D, H, o) {
    p.box(0, 30, 0, W, D - 60, 100, BLACK); p.box(0, 0, 100, W, D, H - 100, "$");
    fronts(p, W, D, 100, H, W > 650 ? 2 : 1, o.split ? 2 : 1, "$l", METAL, { bar: true, door: true });
  },
  island(p, W, D, H, o) {
    const over = o.seat ? 300 : 30, cd = D - over, top = o.top || STONE;
    p.box(0, D / 2 - cd / 2 + 30, 0, W - 60, cd - 60, 100, BLACK);
    p.box(0, D / 2 - cd / 2, 100, W, cd, H - 138, "$");
    const n = Math.max(1, Math.round(W / 600));
    p.at(0, D / 2 - cd / 2, 0, Math.PI, () => fronts(p, W, cd, 100, H - 38, n, 2, "$l", METAL, { bar: true }));
    p.box(0, 0, H - 38, W + 50, D, 38, top);
    if (o.sink) { p.box(0, D / 2 - cd / 2, H - 2, 560, 380, 6, "#8e979e", { np: true }); faucet(p, 0, D / 2 - 120, H); }
    if (o.stools) for (let i = 0; i < o.stools; i++) p.at(-W / 2 + (W / o.stools) * (i + 0.5), -D / 2 + 190, 0, 0, () => B.stool(p, 400, 400, 760, { back: true }));
  },
  sink(p, W, D, H, o) {
    B.cab(p, W, D, H, { top: o.top });
    const n = o.dbl ? 2 : 1, bw = (W - 200) / n;
    for (let i = 0; i < n; i++) p.box(-W / 2 + 100 + bw * (i + 0.5), -20, H - 2, bw - 30, D * 0.62, 8, "#8e979e", { np: true });
    if (o.apron) p.box(0, -D / 2 - 8, H - 260, W - 80, 20, 230, WHITE, { np: true });
    faucet(p, 0, D / 2 - 70, H);
  },
  stove(p, W, D, H, o) {
    p.box(0, 0, 0, W, D, H - 20, "$");
    p.box(0, 0, H - 20, W, D, 20, BLACK);
    const xs = W > 800 ? [-0.32, 0, 0.32] : [-0.24, 0.24];
    for (const fx of xs) for (const fy of [-0.2, 0.22]) p.cyl(fx * W, fy * D, H, Math.min(W, D) * 0.11, 8, "#3a3f47", { np: true });
    p.box(0, D / 2 - 40, H, W, 80, 160, "$d");
    for (let i = 0; i < 4; i++) p.disc(-W * 0.3 + i * W * 0.2, D / 2 - 82, H + 80, 18, 12, DARK);
    p.box(0, -D / 2 - 5, 130, W - 80, 10, H * 0.55, BLACK, { np: true });
    p.cylX(0, -D / 2 - 40, H * 0.72, 14, W - 160, STEEL, { np: true });
  },
  wallOven(p, W, D, H, o) {
    p.box(0, 0, 0, W, D, H, "$d");
    const n = o.n || 2;
    for (let i = 0; i < n; i++) { const z = 700 + i * 720; p.box(0, -D / 2 - 6, z, W - 80, 14, 660, STEEL, { np: true }); p.box(0, -D / 2 - 14, z + 120, W - 220, 10, 360, BLACK, { np: true }); p.cylX(0, -D / 2 - 45, z + 590, 14, W - 200, STEEL, { np: true }); }
  },
  hood(p, W, D, H, o) {
    const z = o.z || 1550;
    p.box(0, 0, z, W, D, 120, "$"); p.box(0, D * 0.1, z + 120, W * 0.62, D * 0.75, 200, "$"); p.box(0, D * 0.15, z + 320, W * 0.3, D * 0.4, H - 320, "$");
  },
  fridge(p, W, D, H, o) {
    p.box(0, 0, 0, W, D, H, "$");
    const h = (x, z0, z1) => { p.box(x, -D / 2 - 40, z0, 25, 25, z1 - z0, STEEL, { np: true }); p.box(x, -D / 2 - 15, z0, 15, 30, 25, STEEL, { np: true }); };
    if (o.type === "sbs") { p.box(0, -D / 2 - 2, 0, 8, 6, H, DARK, { np: true }); h(-40, H * 0.35, H * 0.8); h(40, H * 0.35, H * 0.8); p.box(-W * 0.25, -D / 2 - 3, H * 0.55, W * 0.18, 6, 300, "#3a3f47", { np: true }); }
    else if (o.type === "french") { p.box(0, -D / 2 - 2, H * 0.32, 8, 6, H * 0.68, DARK, { np: true }); p.box(0, -D / 2 - 2, H * 0.32, W, 6, 8, DARK, { np: true }); h(-40, H * 0.45, H * 0.9); h(40, H * 0.45, H * 0.9); p.box(0, -D / 2 - 40, H * 0.26, W * 0.6, 25, 25, STEEL, { np: true }); }
    else if (o.type === "mini") { h(W / 2 - 60, H * 0.4, H * 0.85); }
    else { p.box(0, -D / 2 - 2, H * 0.68, W, 6, 8, DARK, { np: true }); h(W / 2 - 60, H * 0.72, H * 0.92); h(W / 2 - 60, H * 0.3, H * 0.62); }
  },
  dw(p, W, D, H) { p.box(0, 0, 0, W, D, H, "$"); p.box(0, -D / 2 - 5, H - 120, W, 10, 110, "$d", { np: true }); p.cylX(0, -D / 2 - 35, H - 160, 14, W - 120, STEEL, { np: true }); },
  micro(p, W, D, H, o) { const z = o.z || 0; p.box(0, 0, z, W, D, H, "$"); p.box(-W * 0.12, -D / 2 - 4, z + 50, W * 0.6, 8, H - 100, BLACK, { np: true }); p.box(W * 0.32, -D / 2 - 4, z + 50, W * 0.22, 8, H - 100, "$d", { np: true }); },
  cart(p, W, D, H, o) {
    for (const z of [180, H - 300]) p.box(0, 0, z, W, D, 25, o.shelf || "$");
    p.box(0, 0, H - 30, W, D, 30, o.shelf || "$");
    rlegs4(p, W, D, H - 70, 12, "$d", 15, 70);
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.ball(i * (W / 2 - 30), j * (D / 2 - 30), 35, 35, BLACK, { np: true });
    if (o.bottles) for (let k = 0; k < 4; k++) p.cyl(-W / 2 + 90 + k * (W - 180) / 3, 0, H, 35, 260, ["#2f6b3a", "#8a4a2e", "#e8dcc0", "#2f5d8a"][k], { rt: 15, np: true });
  },
  bin(p, W, D, H, o) { p.box(0, 0, 0, W, D, H - 40, "$"); p.box(0, 0, H - 40, W + 10, D + 10, 40, "$d"); if (o.wheels) for (const s of [-1, 1]) p.cylX(s * (W / 2 - 40), D / 2 - 40, 60, 60, 40, BLACK, { np: true }); },
  toilet(p, W, D, H, o) {
    const td = 190, tz = 400;
    p.box(0, D / 2 - td / 2, tz, W, td, H - tz, "$"); p.box(0, D / 2 - td / 2, H, W + 10, td + 10, 25, "$");
    p.cyl(0, -D * 0.12, 0, W * 0.24, 330, "$", { rt: W * 0.3, ry: D * 0.22 });
    p.cyl(0, -D * 0.12, 330, W * 0.46, 70, "$", { ry: D * 0.34, seg: 28 });
    p.cyl(0, -D * 0.12, 400, W * 0.47, 25, o.seat || "$", { ry: D * 0.35, seg: 28 });
    p.box(-W * 0.3, D / 2 - td - 10, H - 70, 60, 20, 18, METAL, { np: true });
  },
  bidet(p, W, D, H) { p.cyl(0, 0, 0, W * 0.28, H - 70, "$", { rt: W * 0.34, ry: D * 0.3 }); p.cyl(0, 0, H - 70, W * 0.48, 70, "$", { ry: D * 0.46, seg: 28 }); faucet(p, 0, D / 2 - 60, H); },
  vanity(p, W, D, H, o) {
    const top = o.top || "#f0eee9", ct = 30;
    p.box(0, 30, 0, W, D - 60, 100, BLACK);
    p.box(0, 0, 100, W, D, H - 100 - ct, "$");
    const n = o.dbl ? 2 : 1;
    fronts(p, W, D, 100, H - ct - 160, Math.max(1, Math.round(W / 450)), 1, "$l", BRASS, { door: true, bar: true });
    fronts(p, W, D, H - ct - 160, H - ct, Math.max(1, Math.round(W / 600)), 1, "$l", BRASS, { bar: true });
    p.box(0, -10, H - ct, W + 20, D + 20, ct, top);
    for (let i = 0; i < n; i++) { const x = -W / 2 + (W / n) * (i + 0.5); p.cyl(x, -30, H - 3, 190, 8, "#e9eef2", { ry: 140, np: true }); faucet(p, x, D / 2 - 60, H); }
    if (o.mirror) for (let i = 0; i < n; i++) { const x = -W / 2 + (W / n) * (i + 0.5); p.box(x, D / 2 - 10, H + 300, Math.min(W / n - 100, 700), 20, 800, "#cfe6f2"); }
  },
  ped(p, W, D, H) { p.cyl(0, D * 0.1, 0, 100, H - 160, "$", { rt: 70, ry: 90 }); p.cyl(0, 0, H - 170, W / 2, 170, "$", { rt: W / 2, ry: D / 2, seg: 28 }); p.cyl(0, -20, H - 2, W * 0.36, 6, "#e3e9ee", { ry: D * 0.3, np: true }); faucet(p, 0, D / 2 - 50, H); },
  tub(p, W, D, H, o) {
    const rim = 90;
    p.box(0, 0, 0, W, D, H, "$");
    p.cyl(0, 0, H - 4, (W - 2 * rim) / 2, 8, o.water ? WATER : "#e3e9ee", { ry: (D - 2 * rim) / 2, seg: 32, np: true });
    p.cylX(-W / 2 + 70, 0, H + 110, 16, 140, STEEL, { np: true }); p.cyl(-W / 2 + 40, 0, H, 20, 120, STEEL, { np: true });
    if (o.panel) p.box(0, -D / 2 - 4, 0, W - 20, 8, H - 30, "$d", { np: true });
  },
  claw(p, W, D, H) {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.ball(i * W * 0.35, j * D * 0.3, 60, 60, BRASS, { np: true });
    p.cyl(0, 0, 100, W / 2 - 40, H - 100, "$", { rt: W / 2, ry: (D / 2 - 20), seg: 32 });
    p.cyl(0, 0, H - 4, W / 2 - 90, 8, "#e3e9ee", { ry: D / 2 - 80, seg: 32, np: true });
    p.cyl(-W / 2 + 120, 0, H, 18, 220, BRASS, { np: true });
  },
  cornertub(p, W, D, H) { p.box(0, 0, 0, W, D, H, "$"); p.cyl(W * 0.08, D * 0.08, H - 4, W * 0.36, 8, "#e3e9ee", { ry: D * 0.36, seg: 32, np: true }); p.cyl(W / 2 - 150, D / 2 - 150, H, 20, 140, STEEL, { np: true }); },
  shower(p, W, D, H, o) {
    p.box(0, 0, 0, W, D, 90, "$");
    p.cyl(0, 0, 90, 40, 4, METAL, { np: true });
    if (o.walkin) p.box(W / 2 - W * 0.3, -D / 2 + 10, 90, W * 0.6, 12, H - 90, "glass");
    else { p.box(0, -D / 2 + 10, 90, W, 12, H - 90, "glass"); p.box(-W / 2 + 10, 0, 90, 12, D - 20, H - 90, "glass"); p.box(W * 0.25, -D / 2 - 10, H * 0.45, 20, 30, 220, STEEL, { np: true }); }
    p.box(0, D / 2 - 15, 90, W, 30, H - 90, o.tile || "#dfeaf2", { np: true });
    p.cylY(0, D / 2 - 120, H - 150, 14, 200, STEEL, { np: true }); p.cyl(0, D / 2 - 220, H - 175, 90, 25, STEEL, { np: true });
  },
  medcab(p, W, D, H, o) { const z = o.z || 1200; p.box(0, D / 2 - D / 2, z, W, D, H, "$"); p.box(0, -D / 2 - 3, z + 25, W - 50, 6, H - 50, "#cfe6f2", { np: true }); },
  towelbar(p, W, D, H, o) { const z = o.z || 1200; for (const s of [-1, 1]) p.box(s * (W / 2 - 15), D / 2 - 40, z, 25, 80, 40, STEEL, { np: true }); p.cylX(0, D / 2 - 70, z + 20, 12, W, STEEL); p.box(0, D / 2 - 70, z - 380, W * 0.75, 30, 420, "$"); },
  washer(p, W, D, H, o) {
    const z = o.z || 0;
    p.box(0, 0, z, W, D, H, "$");
    p.box(0, D / 2 - 50, z + H, W, 100, 0.01, "$", { np: true });
    p.box(0, D / 2 - 60, z + H - 160, W, 120, 160, "$d", { np: true });
    if (o.top) { p.box(0, -40, z + H, W - 80, D - 200, 15, "$l", { np: true }); return; }
    p.disc(0, -D / 2 - 15, z + H * 0.45, W * 0.33, 30, o.dryer ? "$l" : "#9aa3ab"); p.disc(0, -D / 2 - 25, z + H * 0.45, W * 0.25, 20, o.dryer ? "$" : "#8fb6cc");
    for (let i = 0; i < 2; i++) p.disc(-W * 0.3 + i * 120, -D / 2 - 6, z + H - 90, 25, 12, DARK);
  },
  stack(p, W, D, H) { B.washer(p, W, D, H / 2, {}); B.washer(p, W, D, H / 2, { z: H / 2, dryer: true }); },
  utilsink(p, W, D, H) { rlegs4(p, W, D, H - 320, 18, "$d", 30); p.box(0, 0, H - 320, W, D, 320, "$"); p.box(0, -10, H - 4, W - 80, D - 90, 8, "#9aa3ab", { np: true }); faucet(p, 0, D / 2 - 40, H); },
  iron(p, W, D, H) { p.at(0, 0, H - 30, 0, () => { p.cyl(-W * 0.1, 0, 0, W * 0.4, 30, "$", { ry: D / 2, seg: 24 }); p.box(W * 0.28, 0, 0, W * 0.25, D, 30, "$"); }); for (const s of [-1, 1]) p.at(0, 0, (H - 30) / 2, 0, () => p.box(0, 0, -(H - 30) / 2, 30, 40, H - 30, METAL, { np: true }), 0, s * 0.45); p.cyl(W * 0.33, 0, H, 60, 110, "#8fb6cc", { ry: 100, rt: 30, np: true }); },
  wheater(p, W, D, H) { p.cyl(0, 0, 0, W / 2, H - 80, "$", { seg: 24 }); p.cyl(0, 0, H - 80, W / 2 - 20, 40, "$d"); for (const x of [-80, 80]) p.cyl(x, 0, H - 40, 18, 120, BRASS, { np: true }); },
  furnace(p, W, D, H) { p.box(0, 0, 0, W, D, H, "$"); for (let i = 0; i < 6; i++) p.box(0, -D / 2 - 3, 200 + i * 60, W * 0.5, 6, 20, "$d", { np: true }); p.box(0, 0, H, W * 0.8, D * 0.8, 300, METAL); },
  wireshelf(p, W, D, H, o) {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.cyl(i * (W / 2 - 15), j * (D / 2 - 15), 0, 12, H, "$", { seg: 8 });
    const n = o.n || 5;
    for (let k = 0; k < n; k++) p.box(0, 0, 100 + k * (H - 130) / (n - 1), W, D, 18, "$", { np: k > 0 && k < n - 1 });
    if (o.bins) for (let k = 0; k < n - 1; k++) for (let i = 0; i < 2; i++) p.box(-W / 4 + i * W / 2, 0, 118 + k * (H - 130) / (n - 1), W / 2 - 40, D - 40, 200, ["#3d8fd6", "#e8a317", "#c8243a", "#4f8f3c"][(k + i) % 4], { np: true });
  },
  rod(p, W, D, H, o) {
    const cs = ["#2f5d8a", "#b23a48", "#e8dcc0", "#3f7f5a", "#6b4f8a", "#d06f3c", "#2b2f36"];
    p.box(0, 0, 1750, W, D, 20, "$");
    const rods = o.double ? [1650, 1000] : [1650];
    for (const z of rods) { p.cylX(0, 0, z, 14, W, METAL, { np: true }); let k = Math.round(W) % 7; for (let x = -W / 2 + 60; x < W / 2 - 40; x += 70) { k = (k + 3) % cs.length; p.box(x, 0, z - (o.double ? 600 : 900 + (k % 3) * 150), 50, D * 0.75, o.double ? 580 : 880 + (k % 3) * 150, cs[k], { np: true }); } }
    if (o.double) p.box(0, 0, 1050, W, D, 20, "$", { np: true });
  },
  shoerack(p, W, D, H) {
    for (const s of [-1, 1]) p.box(s * (W / 2 - 10), 0, 0, 20, D, H, "$");
    const n = Math.max(2, Math.round(H / 170)), cs = ["#2b2f36", "#8a4a2e", "#f4f6f8", "#c8243a", "#2f5d8a"];
    for (let k = 0; k < n; k++) { const z = 40 + k * (H - 60) / n; p.box(0, 0, z, W - 40, D, 15, "$"); for (let i = 0; i < Math.floor((W - 40) / 120); i++) p.box(-W / 2 + 90 + i * 120, -10, z + 15, 90, D * 0.85, 80, cs[(i + k) % cs.length], { np: true }); }
  },
  cubby(p, W, D, H, o) {
    const n = o.cols || 3, m = o.rows || 3, s = 20;
    for (let i = 0; i <= n; i++) p.box(-W / 2 + s / 2 + i * (W - s) / n, 0, 0, s, D, H, "$", { np: i > 0 && i < n });
    for (let j = 0; j <= m; j++) p.box(0, 0, j * (H - s) / m, W, D, s, "$", { np: j > 0 && j < m });
    const cs = ["#3d8fd6", "#e8a317", "#c8243a", "#4f8f3c", "#e8dcc0"];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if ((i + j) % 2 === 0) p.box(-W / 2 + s + (i + 0.5) * (W - s) / n - s / 2, -10, s + j * (H - s) / m, (W - s) / n - s - 20, D - 30, (H - s) / m - s - 20, cs[(i * 3 + j) % cs.length], { np: true });
  },
  coatrack(p, W, D, H) { p.cyl(0, 0, 0, W * 0.4, 30, "$d"); p.cyl(0, 0, 30, 20, H - 30, "$", { seg: 10 }); p.ball(0, 0, H, 35, "$d"); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; p.ball(Math.cos(a) * 90, Math.sin(a) * 90, H - 120, 25, "$d", { np: true }); } p.box(80, 0, H - 900, 260, 220, 780, "#2f5d8a", { np: true }); p.box(-70, 30, H - 750, 220, 200, 620, "#8a4a2e", { np: true }); },
  kidtable(p, W, D, H) { B.table(p, W, D * 0.55, 500, { leg: 40, top: "$" }); for (const s of [-1, 1]) p.at(0, s * D * 0.38, 0, s > 0 ? 0 : Math.PI, () => B.chair(p, 300, 300, 600, { seat: 290 })); },
  tent(p, W, D, H) { p.cone(0, 0, 0, W / 2, H * 0.9, "$", { seg: 6 }); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; p.at(Math.cos(a) * W * 0.12, Math.sin(a) * W * 0.12, H * 0.82, 0, () => p.cyl(0, 0, 0, 12, H * 0.2, WOOD, { seg: 6, np: true })); } p.box(0, -W / 2 + 60, 0, W * 0.35, 30, H * 0.45, "$d", { np: true }); },
  arcade(p, W, D, H) {
    p.box(0, 0, 0, W, D, H - 250, "$"); p.box(0, D * 0.12, H - 250, W, D * 0.76, 250, "$");
    p.at(0, -D * 0.12, H * 0.62, 0, () => p.box(0, 0, 0, W - 60, 30, 480, SCREEN), 0.25);
    p.at(0, -D / 2 + 120, H * 0.5, 0, () => p.box(0, 0, 0, W, 260, 40, BLACK), -0.25);
    p.box(0, -D * 0.25, H - 230, W - 40, 20, 160, "#f2c230", { np: true });
    for (const x of [-W * 0.2, W * 0.15]) p.cyl(x, -D / 2 + 110, H * 0.5 + 50, 18, 80, "#c8243a", { np: true });
  },
  pool(p, W, D, H, o) {
    const felt = "$", wood = o.wood || "#5d3b2c";
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.box(i * (W / 2 - 150), j * (D / 2 - 150), 0, 140, 140, H - 200, wood);
    p.box(0, 0, H - 200, W, D, 140, wood);
    p.box(0, 0, H - 60, W - 200, D - 200, 20, felt);
    for (const [x, y, w, d] of [[0, -D / 2 + 50, W, 100], [0, D / 2 - 50, W, 100], [-W / 2 + 50, 0, 100, D], [W / 2 - 50, 0, 100, D]]) p.box(x, y, H - 60, w, d, 60, wood);
    if (o.pockets !== false) for (const [x, y] of [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]) p.cyl(x * (W / 2 - 100), y * (D / 2 - 100), H - 2, 55, 6, BLACK, { np: true });
    if (o.balls) for (let k = 0; k < 6; k++) p.ball(W * 0.2 + (k % 3) * 60, -60 + Math.floor(k / 3) * 70, H - 10, 28, ["#f2c230", "#2f5d8a", "#c8243a", "#6b4f8a", "#e8732a", "#2b2f36"][k], { np: true });
  },
  pingpong(p, W, D, H, o) {
    rlegs4(p, W, D, H - 40, 25, METAL, 250);
    p.box(0, 0, H - 40, W, D, 40, "$");
    p.box(0, 0, H, W - 40, 15, 2, WHITE, { np: true });
    p.box(0, 0, H, 25, D + 60, 160, o.net || WHITE);
  },
  foos(p, W, D, H) {
    rlegs4(p, W, D, H - 260, 30, DARK, 60); p.box(0, 0, H - 260, W, D, 260, "$");
    p.box(0, 0, H - 200, W - 80, D - 80, 10, GREEN, { np: true });
    for (let k = 0; k < 8; k++) { const x = -W / 2 + 80 + (k + 0.5) * (W - 160) / 8; p.cylY(x, 0, H - 60, 10, D + 120, METAL, { np: true }); p.cylY(x, (k % 2 ? 1 : -1) * (D / 2 + 70), H - 60, 22, 80, BLACK, { np: true }); }
  },
  treadmill(p, W, D, H) {
    p.box(0, 0, 0, W, D, 180, "$"); p.box(0, 30, 180, W - 120, D - 160, 10, BLACK, { np: true });
    for (const s of [-1, 1]) p.at(s * (W / 2 - 40), -D / 2 + 180, 180, 0, () => p.box(0, 0, 0, 50, 60, H - 280, "$d"), 0.15);
    p.at(0, -D / 2 + 70, H - 160, 0, () => p.box(0, 0, 0, W, 180, 220, "$d"), -0.4);
  },
  bike(p, W, D, H) {
    p.box(0, 0, 0, W, D * 0.9, 50, "$d"); p.cylX(0, -D * 0.28, 300, 230, 60, BLACK);
    p.at(0, 0, 50, 0, () => p.box(0, 0, 0, 70, 70, 720, "$"), 0.2); p.box(0, D * 0.18, 780, 160, 280, 60, BLACK);
    p.at(0, -D * 0.3, 50, 0, () => p.box(0, 0, 0, 60, 60, H - 100, "$"), -0.18); p.box(0, -D * 0.42, H - 80, W, 50, 50, BLACK);
  },
  wbench(p, W, D, H) {
    legs4(p, W, D * 0.55, 400, 50, METAL, 20); p.box(0, -D * 0.1, 400, W, D * 0.55, 80, "$");
    for (const s of [-1, 1]) p.box(s * 330, D / 2 - 60, 0, 60, 60, 1150, METAL);
    p.cylX(0, D / 2 - 60, 1100, 15, 1800, STEEL, { np: true }); for (const s of [-1, 1]) p.cylX(s * 700, D / 2 - 60, 1100, 220, 50, BLACK, { np: true });
  },
  bar(p, W, D, H) { p.box(0, 60, 0, W, D - 120, H - 40, "$"); p.box(0, 0, H - 40, W + 40, D, 40, "$d"); p.cylX(0, -D / 2 + 30, 250, 20, W - 100, BRASS, { np: true }); },
  patio(p, W, D, H, o) {
    const r = (o.table || 1200) / 2;
    p.cyl(0, 0, 720, r, 25, "$", { seg: 32 }); rlegs4(p, r * 1.2, r * 1.2, 720, 15, "$d", 0);
    if (o.umbrella) { p.cyl(0, 0, 0, 20, 2300, METAL, { seg: 8, np: true }); p.cone(0, 0, 2000, Math.min(W, D) * 0.48, 450, o.umbrella, { seg: 8 }); }
    const n = o.chairs || 4;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 4; p.at(Math.cos(a) * (r + 200), Math.sin(a) * (r + 200), 0, a - Math.PI / 2, () => B.chair(p, 480, 500, 880, { metal: true, frame: "$d", pad: o.pad || CREAM })); }
  },
  lounger(p, W, D, H) { legs4(p, W, D, 250, 40, "$d", 30); p.box(0, -D * 0.12, 250, W, D * 0.75, 80, "$"); p.at(0, D * 0.25, 300, 0, () => p.box(0, 0, 0, W, 80, 700, "$"), -0.9); },
  grill(p, W, D, H) {
    p.box(0, 0, 0, W * 0.5, D * 0.8, 750, "$d"); p.box(0, 0, 750, W * 0.5, D, 150, BLACK);
    p.at(0, 0, 900, 0, () => p.cylX(0, 0, 0, D * 0.45, W * 0.5, BLACK, { seg: 20 })); p.box(0, -D / 2 - 30, 1050, W * 0.35, 20, 20, STEEL, { np: true });
    for (const s of [-1, 1]) p.box(s * W * 0.37, 0, 850, W * 0.24, D * 0.8, 30, "$d");
    for (const s of [-1, 1]) p.disc(s * W * 0.2, D * 0.3, 80, 80, 40, BLACK);
  },
  picnic(p, W, D, H) {
    const tw = D * 0.45;
    for (let k = 0; k < 4; k++) p.box(0, -tw / 2 + (k + 0.5) * tw / 4, H - 45, W, tw / 4 - 10, 45, "$");
    for (const s of [-1, 1]) p.box(0, s * (D / 2 - 120), 420, W, 240, 45, "$");
    for (const x of [-W / 2 + 300, W / 2 - 300]) { for (const s of [-1, 1]) p.at(x, s * D * 0.22, 20, 0, () => p.box(0, 0, 0, 80, 80, H * 1.02, "$d"), s * 0.45); p.box(x, 0, 380, 80, D, 40, "$d", { np: true }); }
  },
  hottub(p, W, D, H) { p.box(0, 0, 0, W, D, H, "$"); p.box(0, 0, H - 20, W - 160, D - 160, 25, WATER, { np: true }); for (const [x, y] of [[-1, -1], [1, 1]]) p.box(x * (W / 2 - 250), y * (D / 2 - 250), H - 300, 300, 300, 280, "$l", { np: true }); },
  firepit(p, W, D, H) { p.cyl(0, 0, 0, W / 2, H, "$", { seg: 24 }); p.cyl(0, 0, H - 30, W / 2 - 120, 32, BLACK, { seg: 24, np: true }); p.cone(0, 0, H - 30, W * 0.18, 300, "#ff8c3a", { seg: 8, np: true }); p.cone(W * 0.1, 0, H - 30, W * 0.1, 200, "#f2c230", { seg: 8, np: true }); },
  swingset(p, W, D, H) {
    for (const s of [-1, 1]) for (const t of [-1, 1]) p.at(s * (W / 2 - 100), 0, H / 2, 0, () => p.box(0, 0, -H * 0.53, 90, 90, H * 1.06, "$"), t * 0.33);
    p.cylX(0, 0, H - 40, 60, W, "$");
    for (const x of [-W / 4, W / 4]) { for (const s of [-1, 1]) p.cyl(x + s * 220, 0, 450, 8, H - 500, METAL, { seg: 6, np: true }); p.box(x, 0, 420, 520, 180, 30, o_swing(x)); }
  },
  trampoline(p, W, D, H) { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.cyl(Math.cos(a) * W * 0.45, Math.sin(a) * W * 0.45, 0, 25, H, METAL, { seg: 8, np: true }); } p.cyl(0, 0, H - 30, W / 2, 30, "$", { seg: 36 }); p.cyl(0, 0, H - 25, W / 2 - 180, 30, BLACK, { seg: 36, np: true }); },
  mailbox(p, W, D, H) { p.box(0, 0, 0, 100, 100, H - 230, WOOD); p.box(0, 0, H - 230, W, D, 130, "$"); p.cylY(0, 0, H - 100, W / 2, D, "$"); p.box(W / 2 + 10, D * 0.2, H - 200, 15, 40, 180, "#c8243a", { np: true }); },
  car(p, W, D, H, o) {
    const g = 160, wr = o.suv ? 380 : 330;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.cylX(i * (W / 2 - 110), j * (D / 2 - D * 0.18), wr, wr, 220, BLACK);
    p.box(0, 0, g, W, D, H * 0.42, "$");
    const cz = g + H * 0.42, cl = D * (o.suv ? 0.66 : 0.5), cy = o.suv ? D * 0.1 : D * 0.05;
    p.box(0, cy, cz, W - 120, cl, H - cz, "$");
    p.box(0, cy - cl / 2 - 2, cz + 40, W - 200, 6, H - cz - 90, "#3a4a5c", { np: true });
    p.box(0, cy + cl / 2 + 2, cz + 40, W - 200, 6, H - cz - 90, "#3a4a5c", { np: true });
    for (const s of [-1, 1]) p.box(s * (W / 2 - 58), cy, cz + 40, 6, cl - 120, H - cz - 90, "#3a4a5c", { np: true });
    for (const s of [-1, 1]) { p.box(s * (W / 2 - 200), -D / 2 - 4, g + H * 0.28, 260, 10, 90, "#f4f0d8", { np: true }); p.box(s * (W / 2 - 200), D / 2 + 4, g + H * 0.28, 260, 10, 90, "#c8243a", { np: true }); }
  },
  toolchest(p, W, D, H) { p.box(0, 0, 120, W, D, H - 120, "$"); fronts(p, W, D, 120, H, 1, 6, "$", STEEL, { bar: true }); for (const s of [-1, 1]) for (const y of [-1, 1]) p.cylX(s * (W / 2 - 60), y * (D / 2 - 70), 60, 60, 50, BLACK, { np: true }); },
  bicycle(p, W, D, H) {
    for (const s of [-1, 1]) { p.cylX(0, s * (D / 2 - 340), 340, 340, 30, BLACK); p.cylX(0, s * (D / 2 - 340), 340, 280, 34, "#d8dde2", { np: true }); }
    p.at(0, -D * 0.05, 520, 0, () => p.box(0, 0, 0, 40, D * 0.42, 40, "$")); p.at(0, D * 0.05, 340, 0, () => p.box(0, 0, 0, 40, 40, 520, "$"), 0.3);
    p.box(0, D * 0.12, 880, 100, 260, 50, BLACK); p.box(0, -D / 2 + 320, 960, W, 40, 30, BLACK);
  },
  mower(p, W, D, H) { p.box(0, -D * 0.2, 120, W, D * 0.55, 160, "$"); p.cyl(0, -D * 0.2, 280, 140, 160, BLACK); for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.cylX(i * (W / 2 + 15), -D * 0.2 + j * D * 0.22, 100, 100, 50, BLACK); for (const s of [-1, 1]) p.at(s * W * 0.35, D * 0.15, 200, 0, () => p.box(0, 0, 0, 25, 25, 900, METAL, { np: true }), -0.55); p.box(0, D * 0.42, H - 60, W * 0.8, 30, 30, METAL); },
  rug(p, W, D, H, o) {
    if (o.round) { p.cyl(0, 0, 0, W / 2, 8, "$d", { ry: D / 2, seg: 40 }); p.cyl(0, 0, 0, W / 2 - 60, 12, "$", { ry: D / 2 - 60, seg: 40, np: true }); return; }
    p.box(0, 0, 0, W, D, 8, "$d"); p.box(0, 0, 0, W - 120, D - 120, 12, "$", { np: true });
    if (o.pattern) p.box(0, 0, 0, W * 0.4, D * 0.4, 14, o.pattern, { np: true });
  },
  chandelier(p, W, D, H, o) {
    const z = o.z || 1900, top = z + H;
    p.cyl(0, 0, z + 300, 10, H - 300, METAL, { seg: 6, np: true }); p.cyl(0, 0, top - 30, 70, 30, "$", { np: true });
    p.ball(0, 0, z + 250, 80, "$", { rz: 120 });
    const n = o.arms || 6;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, x = Math.cos(a) * W * 0.4, y = Math.sin(a) * W * 0.4; p.at(x / 2, y / 2, z + 200, a, () => p.cylX(0, 0, 0, 10, W * 0.4, "$", { np: true })); p.cyl(x, y, z + 200, 25, 80, "$", { np: true }); p.ball(x, y, z + 330, 45, "#ffe9a8", { rz: 70 }); }
  },
  pendant(p, W, D, H, o) { const z = o.z || 1700; p.cyl(0, 0, z + 250, 6, H - 250, BLACK, { seg: 6, np: true }); p.cyl(0, 0, z, W / 2, 250, "$", { rt: W * 0.18 }); p.ball(0, 0, z + 40, W * 0.12, "#ffe9a8"); },
  fan(p, W, D, H, o) {
    const z = o.z || 2350;
    p.cyl(0, 0, z + 150, 15, H - 150, "$d", { seg: 8, np: true }); p.cyl(0, 0, z + 60, 110, 110, "$d"); p.cyl(0, 0, z, 80, 60, "#ffe9a8");
    for (let i = 0; i < 5; i++) p.at(0, 0, z + 90, (i / 5) * Math.PI * 2, () => p.box(W * 0.27, 0, 0, W * 0.46, 140, 12, o.blade || "$"));
  },
  art(p, W, D, H, o) {
    const z = o.z || 1300;
    p.box(0, D / 2 - 15, z, W, 30, H, o.frame || DARK);
    p.box(0, D / 2 - 32, z + 35, W - 70, 4, H - 70, CREAM, { np: true });
    const cs = o.colors || ["$", "#e8a317", "#3d8fd6"];
    p.box(-W * 0.15, D / 2 - 36, z + 60, W * 0.45, 4, H * 0.5, cs[0], { np: true }); p.box(W * 0.18, D / 2 - 36, z + H * 0.3, W * 0.4, 4, H * 0.5, cs[1], { np: true }); p.box(-W * 0.05, D / 2 - 38, z + H * 0.55, W * 0.25, 4, H * 0.3, cs[2], { np: true });
  },
  wallclock(p, W, D, H, o) { const z = o.z || 1700; p.at(0, D / 2 - 20, z + H / 2, 0, () => { p.disc(0, 0, 0, W / 2, 40, "$"); p.disc(0, -22, 0, W / 2 - 25, 6, CREAM); p.box(0, -28, 0, 15, 4, W * 0.3, BLACK, { np: true }); p.at(0, -30, 0, 0, () => p.box(0, 0, 0, 12, 4, W * 0.4, BLACK, { np: true }), 0, 1.2); }); },
  mirrorfloor(p, W, D, H) { p.at(0, 0, 6, 0, () => { p.box(0, 0, 0, W, 40, H, "$"); p.box(0, -22, 40, W - 80, 4, H - 80, "#cfe6f2", { np: true }); }, -0.1); p.box(0, D / 2 - 30, 0, 40, 40, H * 0.6, "$", { np: true }); },
  vase(p, W, D, H, o) { p.cyl(0, 0, 0, W * 0.3, H * 0.5, "$", { rt: W * 0.18 }); for (let k = 0; k < 5; k++) { const a = k * 1.3; p.cyl(Math.cos(a) * 30, Math.sin(a) * 30, H * 0.5, 6, H * 0.4, GREEN, { seg: 4, np: true }); p.ball(Math.cos(a) * 50, Math.sin(a) * 50, H * 0.9, 45, o.flower || "#e06aa8", { np: true }); } },
  stairs(p, W, D, H, o) {
    const n = Math.max(3, Math.round(H / 185)), rise = H / n, run = D / n;
    for (let i = 0; i < n; i++) p.box(0, -D / 2 + run * (i + 0.5), 0, W, run + 1, rise * (i + 1), i === n - 1 ? "$" : "$");
    if (o.rail !== false) { const s = 1; p.at(W / 2 - 30 * s, 0, H / 2 + 900, 0, () => p.cylY(0, 0, 0, 22, Math.hypot(D, H), "$d", { np: true }), Math.atan2(H, D)); for (let i = 0; i < n; i += 2) p.cyl(W / 2 - 30, -D / 2 + run * (i + 0.5), rise * (i + 1), 15, 900, "$d", { seg: 6, np: true }); }
  },
  spiral(p, W, D, H) {
    const n = Math.max(8, Math.round(H / 190)), rise = H / n, R = W / 2;
    p.cyl(0, 0, 0, 60, H + 900, METAL, { seg: 12 });
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 1.75; p.at(0, 0, rise * (i + 1) - 40, a, () => p.box(R / 2, 0, 0, R, R * 0.5, 40, "$", { np: i < n - 1 })); p.at(Math.cos(a) * (R - 30), Math.sin(a) * (R - 30), rise * (i + 1), 0, () => p.cyl(0, 0, 0, 10, 900, METAL, { seg: 6, np: true })); }
  },
  column(p, W, D, H, o) { if (o.round) { p.cyl(0, 0, 0, W / 2, 120, "$d"); p.cyl(0, 0, 120, W * 0.38, H - 240, "$"); p.cyl(0, 0, H - 120, W / 2, 120, "$d"); } else { p.box(0, 0, 0, W, D, 120, "$d"); p.box(0, 0, 120, W * 0.8, D * 0.8, H - 240, "$"); p.box(0, 0, H - 120, W, D, 120, "$d"); } },
  hamper(p, W, D, H) { p.cyl(0, 0, 0, W / 2, H, "$", { rt: W / 2 + 15, ry: D / 2 }); p.cyl(0, 0, H, W / 2 + 20, 30, "$d", { ry: D / 2 + 20 }); },
  window_seat(p, W, D, H) { p.box(0, 0, 0, W, D, H - 90, "$d"); p.box(0, -10, H - 90, W - 20, D - 20, 90, "$"); for (let i = 0; i < 3; i++) p.box(-W / 3 + i * W / 3, D / 2 - 90, H, W / 3 - 60, 140, 380, "$l", { np: true }); },
};
moreBuilders(B, { legs4, rlegs4, fronts, faucet, books });
function o_swing(x) { return x < 0 ? "#c8243a" : "#2f5d8a"; }

// ------------------------------------------------------------------ the catalog
export const FURN_CATS = [
  ["living", "Living room"], ["bedroom", "Bedroom"], ["kitchen", "Kitchen"], ["dining", "Dining"], ["bath", "Bathroom"],
  ["laundry", "Laundry & utility"], ["office", "Office"], ["kids", "Kids & play"], ["rec", "Recreation"], ["closet", "Closet & storage"],
  ["decor", "Lighting & decor"], ["outdoor", "Outdoor & patio"], ["garage", "Garage"], ["rugs", "Rugs"], ["struct", "Stairs & columns"],
  ...MORE_CATS,
];
// [category, id, name, builder, width, depth, height (inches), colour, options]
// snap: true = it goes back against a wall when put near one
const SNAPS = new Set(["sofa", "sectional", "tv", "walltv", "wallpanel", "shelf", "fireplace", "piano", "aquarium", "clock", "speaker", "bed", "bunk", "crib", "dresser", "wardrobe", "desk", "cab", "cabc", "cabw", "pantry", "sink", "stove", "wallOven", "hood", "fridge", "dw", "micro", "toilet", "bidet", "vanity", "ped", "tub", "cornertub", "shower", "medcab", "towelbar", "washer", "stack", "utilsink", "wheater", "furnace", "wireshelf", "rod", "shoerack", "cubby", "toolchest", "arcade", "art", "wallclock", "window_seat", "chest", "bar", "coatrack", ...MORE_SNAPS]);
const L = [
  // living room
  ["living", "sofa84", 'Sofa 84"', "sofa", 84, 36, 34, "#7d86a6", { seats: 3, pillows: "#e8dcc0" }],
  ["living", "sofa96", 'Sofa 96"', "sofa", 96, 38, 34, "#8a7f72", { seats: 3, pillows: "#2f5d8a" }],
  ["living", "sofa72", 'Apartment sofa 72"', "sofa", 72, 34, 33, "#3f6f6a", { seats: 2 }],
  ["living", "loveseat", 'Loveseat 60"', "sofa", 60, 36, 34, "#7d86a6", { seats: 2 }],
  ["living", "sectional", "Sectional (L-shaped)", "sectional", 112, 84, 34, "#6f7f8f", { pillows: "#e8a317" }],
  ["living", "sectionalR", "Sectional, leather", "sectional", 120, 90, 34, "#6b4a2b", {}],
  ["living", "futon", "Futon", "sofa", 78, 34, 32, "#3a4a5c", { seats: 3, arm: 60 }],
  ["living", "armchair", "Armchair", "sofa", 34, 34, 34, "#7d86a6", { seats: 1 }],
  ["living", "accentchair", "Accent chair", "sofa", 30, 31, 32, "#c27c4e", { seats: 1, arm: 90 }],
  ["living", "recliner", "Recliner", "sofa", 36, 38, 40, "#6b4f3a", { seats: 1, recl: true }],
  ["living", "ottoman", "Ottoman", "ottoman", 30, 20, 17, "#8a7f72", { tuft: true }],
  ["living", "pouf", "Round pouf", "ottoman", 20, 20, 16, "#d0574b", { round: true }],
  ["living", "coffeetable", "Coffee table", "table", 48, 24, 18, OAK, { shelf: true }],
  ["living", "coffeeround", "Round coffee table", "table", 30, 30, 18, OAK, { round: true, ped: true }],
  ["living", "coffeeglass", "Glass coffee table", "table", 46, 26, 17, "#bfe3f6", { glass: true }],
  ["living", "sidetable", "Side table", "table", 20, 20, 24, OAK, { shelf: true }],
  ["living", "console", "Console table", "table", 48, 14, 30, "#5d3b2c", { drawer: true }],
  ["living", "tvstand60", 'TV stand 60" with TV', "tv", 60, 18, 56, "#4a4f57", { tv: 55, sh: 560 }],
  ["living", "tvstand72", 'Media console 72" with TV', "tv", 72, 18, 62, OAK, { tv: 65, sh: 520, bar: true }],
  ["living", "walltv", 'Wall-mounted TV 65"', "walltv", 57, 4, 32, SCREEN, { z: 1050 }],
  ["living", "bookshelf36", 'Bookshelf 36"', "shelf", 36, 12, 72, "#9b7348", {}],
  ["living", "bookshelf72", 'Bookcase 72" wide', "shelf", 72, 14, 80, "#f0ece4", { cols: 2 }],
  ["living", "fireplace", "Fireplace", "fireplace", 60, 22, 48, "#b5654a", {}],
  ["living", "fireplaceS", "Stone fireplace", "fireplace", 72, 24, 54, "#9a968d", { mantel: "#5d3b2c" }],
  ["living", "piano", "Upright piano", "piano", 58, 24, 48, "#1a1a1a", {}],
  ["living", "grandpiano", "Grand piano", "grandpiano", 60, 70, 40, "#1a1a1a", {}],
  ["living", "aquarium", "Aquarium on stand", "aquarium", 48, 18, 58, "#2b2f36", {}],
  ["living", "speakers", "Tall speaker", "speaker", 10, 12, 40, "#2b2f36", {}],
  ["living", "windowseat", "Window seat", "window_seat", 60, 22, 18, "#3d8fd6", {}],
  // bedroom
  ["bedroom", "twin", "Twin bed", "bed", 39, 75, 40, "#6f9bd1", { pillows: 1 }],
  ["bedroom", "full", "Full bed", "bed", 54, 75, 44, "#6f9bd1", {}],
  ["bedroom", "queen", "Queen bed", "bed", 60, 80, 48, "#6f9bd1", {}],
  ["bedroom", "king", "King bed", "bed", 76, 80, 50, "#6f9bd1", {}],
  ["bedroom", "calking", "Cal king bed", "bed", 72, 84, 50, "#6f9bd1", {}],
  ["bedroom", "queenW", "Queen bed, white frame", "bed", 62, 84, 52, "#e8dcc0", { wood: "#f0ece4", foot: true }],
  ["bedroom", "platform", "Low platform bed", "bed", 64, 84, 30, "#3f6f6a", { low: true, wood: "#5d3b2c" }],
  ["bedroom", "bunk", "Bunk beds", "bunk", 42, 80, 65, "#c8243a", {}],
  ["bedroom", "daybed", "Daybed", "sofa", 80, 41, 36, "#b9c4d0", { seats: 3, arm: 120 }],
  ["bedroom", "nightstand", "Nightstand", "dresser", 20, 16, 24, OAK, { rows: 2 }],
  ["bedroom", "nightstandL", "Nightstand with lamp", "dresser", 22, 17, 24, "#f0ece4", { rows: 2, lamp: true }],
  ["bedroom", "dresser60", 'Dresser 60"', "dresser", 60, 18, 34, "#a8845a", { cols: 2, rows: 3 }],
  ["bedroom", "dresser36", 'Tall chest 36"', "dresser", 36, 18, 50, "#a8845a", { rows: 5 }],
  ["bedroom", "dresserM", "Dresser with mirror", "dresser", 60, 18, 34, "#f0ece4", { cols: 2, rows: 3, mirror: 900 }],
  ["bedroom", "wardrobe", 'Wardrobe 48"', "wardrobe", 48, 24, 72, "#a8845a", {}],
  ["bedroom", "armoire", "Armoire with mirror", "wardrobe", 44, 24, 78, "#5d3b2c", { mirror: true, drawers: true }],
  ["bedroom", "bedbench", 'Bench 48"', "bench", 48, 16, 18, "#c9b48a", { cush: true }],
  ["bedroom", "makeup", "Makeup vanity with mirror", "dresser", 42, 18, 30, "#f0ece4", { legs: true, rows: 1, cols: 2, mirror: 760 }],
  ["bedroom", "hopechest", "Blanket chest", "chest", 40, 18, 20, "#8a4a2e", {}],
  ["bedroom", "floormirror", "Floor mirror", "mirrorfloor", 24, 14, 66, "#c9a23a", {}],
  // kitchen
  ["kitchen", "base18", 'Base cabinet 18"', "cab", 18, 24, 36, "#c8a878", {}],
  ["kitchen", "base24", 'Base cabinet 24"', "cab", 24, 24, 36, "#c8a878", {}],
  ["kitchen", "base30", 'Base cabinet 30"', "cab", 30, 24, 36, "#c8a878", {}],
  ["kitchen", "base36", 'Base cabinet 36"', "cab", 36, 24, 36, "#c8a878", {}],
  ["kitchen", "base48", 'Base cabinet 48"', "cab", 48, 24, 36, "#c8a878", {}],
  ["kitchen", "drawers24", 'Drawer base 24"', "cab", 24, 24, 36, "#c8a878", { drawers: 3 }],
  ["kitchen", "basewhite36", 'White base cabinet 36"', "cab", 36, 24, 36, "#f0ece4", { top: "#3a3f47" }],
  ["kitchen", "corner36", 'Corner cabinet 36"', "cabc", 36, 36, 36, "#c8a878", {}],
  ["kitchen", "upper24", 'Wall cabinet 24"', "cabw", 24, 12, 30, "#c8a878", {}],
  ["kitchen", "upper30", 'Wall cabinet 30"', "cabw", 30, 12, 30, "#c8a878", {}],
  ["kitchen", "upper36", 'Wall cabinet 36"', "cabw", 36, 12, 30, "#c8a878", {}],
  ["kitchen", "upperglass", 'Glass-door wall cabinet 30"', "cabw", 30, 12, 30, "#f0ece4", { glass: true }],
  ["kitchen", "pantry", 'Pantry cabinet 24"', "pantry", 24, 24, 84, "#c8a878", { split: true }],
  ["kitchen", "island72", "Island 72×36", "island", 72, 36, 36, "#d9c3a0", {}],
  ["kitchen", "island96", "Island 96×40", "island", 96, 40, 36, "#d9c3a0", {}],
  ["kitchen", "islandseat", "Island with 3 stools", "island", 84, 48, 36, "#3f6f6a", { seat: true, stools: 3, top: "#f0eee9" }],
  ["kitchen", "islandsink", "Island with sink", "island", 96, 42, 36, "#f0ece4", { sink: true, top: "#3a3f47" }],
  ["kitchen", "sink33", 'Single sink 33"', "sink", 33, 24, 36, "#c8a878", {}],
  ["kitchen", "sink36", 'Double sink 36"', "sink", 36, 24, 36, "#c8a878", { dbl: true }],
  ["kitchen", "farmsink", 'Farmhouse sink 36"', "sink", 36, 25, 36, "#f0ece4", { apron: true }],
  ["kitchen", "range30", 'Range 30"', "stove", 30, 26, 36, "#bfc4ca", {}],
  ["kitchen", "range36", 'Range 36" (6 burners)', "stove", 36, 27, 36, "#bfc4ca", {}],
  ["kitchen", "rangeB", 'Black range 30"', "stove", 30, 26, 36, "#2b2f36", {}],
  ["kitchen", "walloven", 'Double wall oven 30"', "wallOven", 30, 25, 84, "#c8a878", {}],
  ["kitchen", "hood30", 'Range hood 30"', "hood", 30, 20, 40, "#bfc4ca", { z: 1600 }],
  ["kitchen", "otr", "Over-the-range microwave", "micro", 30, 16, 17, "#bfc4ca", { z: 1680 }],
  ["kitchen", "fridge36", 'Fridge 36"', "fridge", 36, 30, 70, "#e3e8ec", {}],
  ["kitchen", "fridge30", 'Fridge 30"', "fridge", 30, 30, 67, "#e3e8ec", {}],
  ["kitchen", "fridgeSS", 'Side-by-side fridge 36"', "fridge", 36, 31, 70, "#c3c8cd", { type: "sbs" }],
  ["kitchen", "fridgeFD", 'French door fridge 36"', "fridge", 36, 31, 70, "#c3c8cd", { type: "french" }],
  ["kitchen", "minifridge", "Mini fridge", "fridge", 20, 20, 34, "#2b2f36", { type: "mini" }],
  ["kitchen", "dishwasher", 'Dishwasher 24"', "dw", 24, 24, 34, "#c9ced3", {}],
  ["kitchen", "barstool", "Bar stool", "stool", 16, 16, 30, "#5d3b2c", { back: true }],
  ["kitchen", "counterstool", "Counter stool", "stool", 16, 16, 25, "#2b2f36", {}],
  ["kitchen", "kcart", "Kitchen cart", "cart", 30, 18, 36, "#9b7348", {}],
  ["kitchen", "trash", "Trash can", "bin", 14, 12, 26, "#c3c8cd", {}],
  // dining
  ["dining", "dining4", "Table, 4 seats", "dining", 48, 65, 30, "#b5834e", { ch: 4 }],
  ["dining", "dining6", "Table, 6 seats", "dining", 72, 65, 30, "#b5834e", { ch: 6 }],
  ["dining", "dining8", "Table, 8 seats", "dining", 96, 69, 30, "#b5834e", { ch: 8 }],
  ["dining", "round4", "Round table, 4 seats", "dining", 68, 68, 30, "#b5834e", { ch: 4, round: true }],
  ["dining", "round6", "Round table, 6 seats", "dining", 78, 78, 30, "#b5834e", { ch: 6, round: true }],
  ["dining", "farm8", "Farmhouse table with benches", "dining", 84, 68, 30, "#8a5a32", { benches: true }],
  ["dining", "diningtable", "Dining table (no chairs)", "table", 72, 38, 30, "#b5834e", { apron: true }],
  ["dining", "chair", "Chair", "chair", 18, 18, 36, "#a8845a", { slats: true }],
  ["dining", "chairpad", "Chair with cushion", "chair", 19, 20, 38, "#f0ece4", { pad: "#3f6f6a" }],
  ["dining", "armchairD", "Dining armchair", "chair", 22, 21, 38, "#5d3b2c", { arm: true, pad: "#c9b48a" }],
  ["dining", "dbench", "Dining bench", "bench", 60, 14, 18, "#8a5a32", {}],
  ["dining", "buffet", 'Buffet 60"', "dresser", 60, 18, 34, "#a8845a", { cols: 3, rows: 2 }],
  ["dining", "hutch", "China hutch", "shelf", 48, 18, 78, "#f0ece4", { cols: 2 }],
  ["dining", "bistro", "Bar table with 2 stools", "dining", 48, 30, 42, "#2b2f36", { bistro: true }],
  ["dining", "barcart", "Bar cart", "cart", 30, 16, 34, "#c9a23a", { bottles: true, shelf: "#e8e2d6" }],
  // bathroom
  ["bath", "toilet", "Toilet", "toilet", 20, 28, 30, "#f4f7fa", {}],
  ["bath", "toiletB", "Toilet, black seat", "toilet", 20, 29, 30, "#f4f7fa", { seat: "#2b2f36" }],
  ["bath", "bidet", "Bidet", "bidet", 15, 22, 15, "#f4f7fa", {}],
  ["bath", "vanity24", 'Vanity 24"', "vanity", 24, 21, 34, "#d9c3a0", {}],
  ["bath", "vanity30", 'Vanity 30"', "vanity", 30, 21, 34, "#d9c3a0", {}],
  ["bath", "vanity36", 'Vanity 36" with mirror', "vanity", 36, 22, 34, "#3f6f6a", { mirror: true }],
  ["bath", "vanity60", 'Double vanity 60"', "vanity", 60, 22, 34, "#d9c3a0", { dbl: true }],
  ["bath", "vanity72", 'Double vanity 72" with mirrors', "vanity", 72, 22, 34, "#f0ece4", { dbl: true, mirror: true, top: "#3a3f47" }],
  ["bath", "pedsink", "Pedestal sink", "ped", 20, 18, 34, "#f4f7fa", {}],
  ["bath", "tub60", 'Tub 60"', "tub", 60, 30, 20, "#f4f7fa", { panel: true }],
  ["bath", "tub72", 'Tub 72"', "tub", 72, 36, 22, "#f4f7fa", { panel: true }],
  ["bath", "clawfoot", "Clawfoot tub", "claw", 66, 30, 24, "#f4f7fa", {}],
  ["bath", "cornertub", "Corner tub", "cornertub", 60, 60, 21, "#f4f7fa", {}],
  ["bath", "shower36", "Shower 36×36", "shower", 36, 36, 80, "#f4f7fa", {}],
  ["bath", "shower48", "Shower 48×36", "shower", 48, 36, 80, "#f4f7fa", {}],
  ["bath", "walkin", "Walk-in shower 60×36", "shower", 60, 36, 80, "#f4f7fa", { walkin: true, tile: "#c9d6dd" }],
  ["bath", "linen", "Linen cabinet", "pantry", 24, 18, 72, "#d9c3a0", { split: true }],
  ["bath", "medcab", "Medicine cabinet", "medcab", 24, 6, 30, "#f4f6f8", { z: 1250 }],
  ["bath", "mirror", "Bathroom mirror", "wallpanel", 30, 2, 36, "#cfe6f2", { z: 1100, face: "#cfe6f2", frame: "#c9a23a", m: 30, t: 30 }],
  ["bath", "towelbar", 'Towel bar 24"', "towelbar", 24, 4, 2, "#3d8fd6", { z: 1200 }],
  ["bath", "bathmat", "Bath mat", "rug", 34, 21, 1, "#9cc9e8", {}],
  ["bath", "hamper", "Laundry hamper", "hamper", 18, 18, 24, "#c9b48a", {}],
  // laundry & utility
  ["laundry", "washer", "Washer", "washer", 27, 30, 38, "#f4f6f8", {}],
  ["laundry", "dryer", "Dryer", "washer", 27, 30, 38, "#f4f6f8", { dryer: true }],
  ["laundry", "topload", "Top-load washer", "washer", 27, 28, 42, "#f4f6f8", { top: true }],
  ["laundry", "stacked", "Stacked washer and dryer", "stack", 27, 30, 76, "#f4f6f8", {}],
  ["laundry", "utilsink", "Laundry sink", "utilsink", 24, 22, 34, "#f4f6f8", {}],
  ["laundry", "ironing", "Ironing board", "iron", 54, 15, 36, "#9cc9e8", {}],
  ["laundry", "waterheater", "Water heater", "wheater", 22, 22, 60, "#e8e8e4", {}],
  ["laundry", "furnace", "Furnace", "furnace", 24, 30, 48, "#c9ced3", {}],
  ["laundry", "wireshelf", "Wire shelving", "wireshelf", 36, 14, 72, "#d8dde2", { bins: true }],
  ["laundry", "laundrycab", 'Wall cabinet 36"', "cabw", 36, 12, 30, "#f0ece4", { z: 1400 }],
  // office
  ["office", "desk60", 'Desk 60"', "desk", 60, 30, 30, "#c19a6b", {}],
  ["office", "deskpc", "Desk with computer", "desk", 60, 30, 30, "#f0ece4", { pc: 27, lamp: "#e8a317" }],
  ["office", "gamingdesk", 'Gaming desk 72"', "desk", 72, 30, 30, "#2b2f36", { ped: false, pc: 32, legc: "#c8243a" }],
  ["office", "ldesk", "L-shaped desk", "desk", 60, 60, 30, "#c19a6b", { l: true }],
  ["office", "standdesk", "Standing desk", "desk", 48, 24, 42, "#f0ece4", { stand: true, pc: 24 }],
  ["office", "writingdesk", "Writing desk", "desk", 42, 20, 30, "#8a5a32", { ped: false }],
  ["office", "officechair", "Office chair", "ochair", 26, 26, 40, "#2b2f36", {}],
  ["office", "gamingchair", "Gaming chair", "ochair", 28, 28, 50, "#2b2f36", { gaming: true }],
  ["office", "file2", "Filing cabinet, 2 drawers", "dresser", 15, 25, 28, "#8a9099", { rows: 2, bar: true, knob: STEEL, top: "$d" }],
  ["office", "file4", "Filing cabinet, 4 drawers", "dresser", 15, 25, 52, "#8a9099", { rows: 4, bar: true, knob: STEEL, top: "$d" }],
  ["office", "bookcase36", 'Bookcase 36"', "shelf", 36, 12, 72, "#9b7348", {}],
  ["office", "bookcase72", 'Bookcase 72"', "shelf", 72, 12, 72, "#9b7348", { cols: 2 }],
  ["office", "whiteboard", "Whiteboard", "wallpanel", 48, 3, 36, "#f8f9fa", { z: 900, face: "#f8f9fa", frame: "#a9b0b8", m: 20, t: 25, tray: true }],
  // kids & play
  ["kids", "crib", "Crib", "crib", 30, 54, 40, "#f0ece4", {}],
  ["kids", "toddler", "Toddler bed", "bed", 30, 56, 26, "#f2a65a", { low: true, wood: "#f0ece4", pillows: 1 }],
  ["kids", "kidsbunk", "Kids bunk beds", "bunk", 42, 80, 65, "#3d8fd6", { wood: "#f0ece4" }],
  ["kids", "toychest", "Toy chest", "chest", 36, 18, 20, "#e0a33a", {}],
  ["kids", "kidtable", "Kids table and chairs", "kidtable", 30, 44, 24, "#3d8fd6", {}],
  ["kids", "beanbag", "Beanbag", "beanbag", 36, 36, 28, "#d0574b", {}],
  ["kids", "teepee", "Play teepee", "tent", 48, 48, 66, "#e8dcc0", {}],
  ["kids", "cubby3", "Cubby organizer", "cubby", 36, 14, 36, "#f0ece4", {}],
  ["kids", "changing", "Changing table", "dresser", 36, 20, 36, "#f0ece4", { rows: 3 }],
  // recreation
  ["rec", "arcade", "Arcade machine", "arcade", 26, 30, 70, "#3d3a8a", {}],
  ["rec", "pool", "Pool table", "pool", 100, 56, 31, "#1f7a46", { balls: true }],
  ["rec", "pingpong", "Table tennis", "pingpong", 108, 60, 30, "#1c4f9c", {}],
  ["rec", "foos", "Foosball", "foos", 56, 30, 36, "#7a4b24", {}],
  ["rec", "airhockey", "Air hockey", "pool", 84, 48, 32, "#e8f0f4", { pockets: false, wood: "#2f5d8a" }],
  ["rec", "uprightpiano", "Upright piano with bench", "piano", 58, 40, 48, "#5d3b2c", { bench: true }],
  ["rec", "treadmill", "Treadmill", "treadmill", 30, 72, 56, "#444a52", {}],
  ["rec", "exbike", "Exercise bike", "bike", 22, 48, 46, "#c8243a", {}],
  ["rec", "weights", "Weight bench and rack", "wbench", 72, 60, 46, "#2b2f36", {}],
  ["rec", "yogamat", "Yoga mat", "rug", 24, 68, 1, "#8e6cc9", {}],
  ["rec", "homebar", "Home bar", "bar", 72, 24, 42, "#5d3b2c", {}],
  ["rec", "workbench", 'Workbench 72"', "table", 72, 30, 36, "#a98456", { t: 50, shelf: true, leg: 80 }],
  ["rec", "deskpc2", "Gaming desk", "desk", 60, 28, 30, "#2b2f36", { ped: false, pc: 27, legc: "#3d3a8a" }],
  // closet & storage
  ["closet", "rod48", 'Hanging rod 48"', "rod", 48, 24, 70, "#d8c9ac", {}],
  ["closet", "rod72", 'Hanging rod 72"', "rod", 72, 24, 70, "#d8c9ac", {}],
  ["closet", "rod96", 'Double rod 96"', "rod", 96, 24, 70, "#d8c9ac", { double: true }],
  ["closet", "shelving36", 'Shelving 36"', "shelf", 36, 14, 72, "#d8c9ac", { open: true, empty: true }],
  ["closet", "shoerack", 'Shoe rack 30"', "shoerack", 30, 12, 32, "#9b7348", {}],
  ["closet", "builtin", "Built-in dresser", "dresser", 48, 24, 34, "#f0ece4", { rows: 3, cols: 2 }],
  ["closet", "hamperC", "Hamper", "hamper", 18, 18, 24, "#c9b48a", {}],
  ["closet", "cubby9", "Cube storage 3×3", "cubby", 44, 15, 44, "#9b7348", {}],
  ["closet", "coatrack", "Coat rack", "coatrack", 20, 20, 70, "#5d3b2c", {}],
  ["closet", "shoebench", "Entry bench with shoe shelf", "shoerack", 36, 14, 18, "#a8845a", {}],
  // lighting & decor
  ["decor", "floorlamp", "Floor lamp", "lamp", 16, 16, 64, "#f3ead8", {}],
  ["decor", "arclamp", "Arc floor lamp", "arclamp", 50, 16, 80, "#c9a23a", {}],
  ["decor", "tablelamp", "Table lamp on side table", "lamp", 20, 20, 40, "#f3ead8", { table: true }],
  ["decor", "chandelier", "Chandelier", "chandelier", 28, 28, 40, "#c9a23a", { z: 1600 }],
  ["decor", "pendant", "Pendant light", "pendant", 16, 16, 40, "#2b2f36", { z: 1750 }],
  ["decor", "ceilingfan", 'Ceiling fan 52"', "fan", 52, 52, 18, "#8a5a32", { z: 2250 }],
  ["decor", "plantTall", "Tall potted plant", "plant", 20, 20, 64, "#b5654a", { tall: true }],
  ["decor", "plant", "Potted plant", "plant", 16, 16, 30, "#f0ece4", {}],
  ["decor", "plantS", "Snake plant", "plant", 12, 12, 36, "#2b2f36", { leaf: "#3f6f3a" }],
  ["decor", "vase", "Vase of flowers", "vase", 10, 10, 26, "#3d8fd6", {}],
  ["decor", "art", "Wall art", "art", 36, 2, 24, "#c8243a", { z: 1350 }],
  ["decor", "artbig", "Large painting", "art", 48, 2, 36, "#3d8fd6", { z: 1200, frame: "#c9a23a", colors: ["$", "#4f8f3c", "#e8dcc0"] }],
  ["decor", "wallclock", "Wall clock", "wallclock", 14, 2, 14, "#2b2f36", { z: 1700 }],
  ["decor", "grandfather", "Grandfather clock", "clock", 20, 12, 80, "#5d3b2c", {}],
  ["decor", "mirrorbig", "Wall mirror", "wallpanel", 30, 2, 40, "#cfe6f2", { z: 1000, face: "#cfe6f2", frame: "#c9a23a", m: 40, t: 35 }],
  // outdoor & patio
  ["outdoor", "patioset", "Patio table, umbrella, 4 chairs", "patio", 100, 100, 30, "#3a3f47", { umbrella: "#c8243a", table: 1100, chairs: 4 }],
  ["outdoor", "patio2", "Bistro set for 2", "patio", 60, 60, 30, "#2b2f36", { table: 650, chairs: 2, pad: "#3f6f6a" }],
  ["outdoor", "lounger", "Lounge chair", "lounger", 28, 76, 30, "#e8dcc0", {}],
  ["outdoor", "adirondack", "Adirondack chair", "chair", 30, 34, 36, "#3d8fd6", { arm: true, seat: 380, frame: "#2f5d8a" }],
  ["outdoor", "grill", "Grill", "grill", 52, 24, 46, "#2b2f36", {}],
  ["outdoor", "picnic", "Picnic table", "picnic", 72, 60, 30, "#a98456", {}],
  ["outdoor", "hottub", "Hot tub", "hottub", 84, 84, 36, "#6b5a4a", {}],
  ["outdoor", "firepit", "Fire pit", "firepit", 40, 40, 14, "#9a968d", {}],
  ["outdoor", "swingset", "Swing set", "swingset", 120, 72, 96, "#a98456", {}],
  ["outdoor", "trampoline", "Trampoline", "trampoline", 144, 144, 36, "#3d8fd6", {}],
  ["outdoor", "outsofa", "Outdoor sofa", "sofa", 78, 32, 30, "#e8dcc0", { seats: 3, arm: 140, pillows: "#3d8fd6" }],
  ["outdoor", "planter", "Planter box", "plant", 30, 30, 30, "#8a5a32", {}],
  ["outdoor", "parkbench", "Garden bench", "bench", 60, 24, 34, "#4f8f3c", { back: 450 }],
  ["outdoor", "mailbox", "Mailbox", "mailbox", 8, 20, 44, "#2b2f36", {}],
  // garage
  ["garage", "car", "Car", "car", 72, 180, 56, "#c8243a", {}],
  ["garage", "suv", "SUV", "car", 78, 190, 68, "#3a4a5c", { suv: true }],
  ["garage", "toolchest", "Tool chest", "toolchest", 27, 18, 40, "#c8243a", {}],
  ["garage", "gworkbench", "Workbench", "table", 72, 30, 36, "#a98456", { t: 50, shelf: true, leg: 80 }],
  ["garage", "gshelf", "Garage shelving", "wireshelf", 48, 18, 72, "#8a9099", { bins: true }],
  ["garage", "gcab", "Storage cabinet", "pantry", 36, 24, 72, "#8a9099", {}],
  ["garage", "bicycle", "Bicycle", "bicycle", 24, 68, 40, "#2f5d8a", {}],
  ["garage", "mower", "Lawn mower", "mower", 22, 38, 40, "#c8243a", {}],
  ["garage", "bins", "Garbage bin", "bin", 28, 28, 42, "#3f6f3a", { wheels: true }],
  ["garage", "gfridge", "Garage fridge", "fridge", 30, 30, 67, "#f4f6f8", {}],
  // rugs
  ["rugs", "rug58", "Rug 5×8", "rug", 60, 96, 1, "#9c4a4a", {}],
  ["rugs", "rug810", "Rug 8×10", "rug", 96, 120, 1, "#3f6fa8", {}],
  ["rugs", "rug912", "Rug 9×12", "rug", 108, 144, 1, "#c9b48a", {}],
  ["rugs", "runner", "Runner 2.5×8", "rug", 30, 96, 1, "#2f7a80", {}],
  ["rugs", "round6", "Round rug 6'", "rug", 72, 72, 1, "#7d8085", { round: true }],
  ["rugs", "round8", "Round rug 8'", "rug", 96, 96, 1, "#c8a040", { round: true }],
  ["rugs", "oval58", "Oval rug 5×8", "rug", 60, 96, 1, "#7a5a8a", { round: true }],
  ["rugs", "rugpat", "Patterned rug 6×9", "rug", 72, 108, 1, "#e8dcc0", { pattern: "#b23a48" }],
  // stairs & columns
  ["struct", "stairs", "Straight stairs", "stairs", 36, 120, 108, "#a98456", {}],
  ["struct", "stairsW", "Wide stairs", "stairs", 48, 132, 108, "#e8e2d6", {}],
  ["struct", "spiral", "Spiral staircase", "spiral", 60, 60, 108, "#8a9099", {}],
  ["struct", "column", "Square column", "column", 12, 12, 108, "#f0ece4", {}],
  ["struct", "columnR", "Round column", "column", 14, 14, 108, "#f0ece4", { round: true }],
];
// dining sets: a table with chairs (or benches) around it, all inside the item's size
B.dining = (p, W, D, H, o) => {
  if (o.bistro) { B.table(p, W * 0.6, W * 0.6, H, { round: true, ped: true, top: "$" }); for (const s of [-1, 1]) p.at(s * W * 0.33, 0, 0, -s * Math.PI / 2, () => B.stool(p, 380, 380, 760, { back: true, frame: "$" })); return; }
  if (o.round) {
    const r = W / 2 - 400;
    B.table(p, r * 2, r * 2, H, { round: true, ped: true });
    for (let i = 0; i < o.ch; i++) { const a = (i / o.ch) * Math.PI * 2 + Math.PI / 2; p.at(Math.cos(a) * (r + 120), Math.sin(a) * (r + 120), 0, a - Math.PI / 2, () => B.chair(p, 440, 450, 900, { slats: true })); }
    return;
  }
  const tD = Math.max(800, D - 2 * 380);
  B.table(p, W, tD, H, { apron: true });
  if (o.benches) { for (const s of [-1, 1]) p.box(0, s * (tD / 2 + 150), 0, W - 200, 300, 450, "$", {}); for (const s of [-1, 1]) for (const x of [-W / 2 + 200, W / 2 - 200]) p.box(x, s * (tD / 2 + 150), 0, 60, 260, 410, "$d", { np: true }); return; }
  const per = Math.round(o.ch / 2), pitch = W / per;
  for (const s of [-1, 1]) for (let i = 0; i < per; i++) p.at(-W / 2 + pitch * (i + 0.5), s * (tD / 2 + 60), 0, s > 0 ? 0 : Math.PI, () => B.chair(p, 440, 450, 900, { slats: true }));
};
L.push(...MORE_ITEMS);
export const FURN = L.map(([cat, id, name, kind, w, d, h, c, o]) => ({ cat, id, name, kind, w: w * IN, d: d * IN, h: h * IN, c, o: o || {}, snap: SNAPS.has(kind) && !(o && o.free), onTop: ON_TOP.has(kind) }));
export const FURN_BY = Object.fromEntries(FURN.map((f) => [f.id, f]));

// ------------------------------------------------------------------ shapes
const PARTS = new Map();
export function furnParts(it) {
  let parts = PARTS.get(it.id);
  if (!parts) {
    const p = maker();
    (B[it.kind] || B.chest)(p, it.w, it.d, it.h, it.o, it);
    parts = p.parts;
    PARTS.set(it.id, parts);
  }
  return parts;
}
// the item's real height (wall-mounted things sit up the wall)
export function furnTop(it) { let t = 0; for (const q of furnParts(it)) t = Math.max(t, q.top); return t; }
const MATS = new Map(), GHOST = new Map();
function material(c, ghost) {
  const key = c + (ghost ? "g" : "");
  const cache = ghost ? GHOST : MATS;
  let m = cache.get(key);
  if (!m) {
    if (c === "glass") m = new THREE.MeshStandardMaterial({ color: "#bfe3f6", roughness: 0.1, metalness: 0.1, transparent: true, opacity: ghost ? 0.2 : 0.35, depthWrite: false });
    else m = new THREE.MeshStandardMaterial({ color: c, roughness: [STEEL, METAL, BRASS].includes(c) ? 0.35 : 0.72, metalness: [STEEL, METAL, BRASS].includes(c) ? 0.45 : 0.02, ...(ghost ? { transparent: true, opacity: 0.5, depthWrite: false } : {}) });
    cache.set(key, m);
  }
  return m;
}
// a placed item as a group: f = { id, k, x, y, r, col }; z = the floor it stands on
export function furnObject(f, z, ghost) {
  const it = FURN_BY[f.k], g = new THREE.Group();
  if (!it) return g;
  const main = f.col || it.c;
  for (const q of furnParts(it)) {
    const m = new THREE.Mesh(q.geo, material(q.glass ? "glass" : partColor(q.c, main), ghost));
    m.userData.shared = true;
    if (q.glass) m.renderOrder = 3;
    g.add(m);
  }
  g.position.set(f.x, f.y, z + (f.z || 0)); g.rotation.z = f.r || 0;
  return g;
}
// the size of a part's outline from above (mm²)
function area(q) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of q.fp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return (x1 - x0) * (y1 - y0); }
// how high the top of the furniture is at x, y (on one level): for things that sit on a table,
// counter or shelf. Things hung up high (lights, art) and people are left out; skip = an id to ignore.
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
export function surfaceAt(list, x, y, skip) {
  let top = 0;
  for (const f of list) {
    if (f.id === skip) continue;
    const it = FURN_BY[f.k]; if (!it || it.cat === "people") continue;
    const c = Math.cos(-(f.r || 0)), s = Math.sin(-(f.r || 0)), dx = x - f.x, dy = y - f.y, lx = dx * c - dy * s, ly = dx * s + dy * c;
    if (Math.abs(lx) > it.w / 2 + 50 || Math.abs(ly) > it.d / 2 + 50) continue;
    for (const q of furnParts(it)) {
      const z0 = q.geo.boundingBox.min.z;
      if (z0 > 1500 || (q.glass && q.top > 1200) || ((it.kind === "greenhouse" || it.kind === "sauna") && q.top > 1300) || !inPoly(lx, ly, q.fp)) continue;
      top = Math.max(top, (f.z || 0) + q.top);
    }
  }
  return top;
}
// a placed item's outline pieces from above, in plan coordinates (for the floor plan drawing),
// lowest first; small details and things up near the ceiling (fans, lights) left out
export function furnPlan(f) {
  const it = FURN_BY[f.k]; if (!it) return [];
  const c = Math.cos(f.r || 0), s = Math.sin(f.r || 0);
  return furnParts(it).filter((q) => !q.glass && q.geo.boundingBox.min.z < 1500 && (!q.np || area(q) >= 15000)).slice().sort((a, b) => a.top - b.top).map((q) => q.fp.map(([x, y]) => [f.x + x * c - y * s, f.y + x * s + y * c]));
}
// the item's footprint corners (its size box), in plan coordinates
export function furnBox(f) {
  const it = FURN_BY[f.k]; if (!it) return [];
  const c = Math.cos(f.r || 0), s = Math.sin(f.r || 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [f.x + (i * it.w / 2) * c - (j * it.d / 2) * s, f.y + (i * it.w / 2) * s + (j * it.d / 2) * c]);
}
// closed solids for export: [{name, color, pos}] (triangle soup, mm), the same colours together
export function furnSolids(list, elevOf, glass) {
  const out = new Map();
  for (const f of list) {
    const it = FURN_BY[f.k]; if (!it) continue;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(f.x, f.y, elevOf(f.lvl) + (f.z || 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), f.r || 0), new THREE.Vector3(1, 1, 1));
    for (const q of furnParts(it)) {
      if (q.glass && !glass) continue;
      const color = q.glass ? "#bfe3f6" : partColor(q.c, f.col || it.c), name = q.glass ? "Glass" : "Furniture";
      const g = q.geo.index ? q.geo.toNonIndexed() : q.geo.clone(); g.applyMatrix4(M);
      const key = name + "|" + color;
      if (!out.has(key)) out.set(key, { name, color, chunks: [] });
      out.get(key).chunks.push(g.attributes.position.array);
      g.dispose();
    }
  }
  return [...out.values()].map((o) => { const n = o.chunks.reduce((a, c) => a + c.length, 0), pos = new Float32Array(n); let k = 0; for (const c of o.chunks) { pos.set(c, k); k += c.length; } return { name: o.name, color: o.color, pos }; });
}
// a small picture of the item seen from above (for the catalog tiles), 44 × 40
const ICONS = new Map();
export function furnSVG(it, col) {
  const key = it.id + (col || "");
  if (ICONS.has(key)) return ICONS.get(key);
  const parts = furnParts(it).filter((q) => !q.np || area(q) >= 15000).slice().sort((a, b) => a.top - b.top);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of parts) for (const [x, y] of q.fp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const s = Math.min(38 / Math.max(1, x1 - x0), 34 / Math.max(1, y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = (x, y) => (22 + (x - cx) * s).toFixed(1) + "," + (20 - (y - cy) * s).toFixed(1);
  let body = "";
  for (const q of parts) {
    const c = q.glass ? "#bfe3f6" : partColor(q.c, col || it.c);
    body += `<polygon points="${q.fp.map(([x, y]) => P(x, y)).join(" ")}" fill="${c}"${q.glass ? ' fill-opacity="0.5"' : ""} stroke="#2b2f36" stroke-opacity="0.55" stroke-width="0.5"/>`;
  }
  const svg = `<svg viewBox="0 0 44 40" width="44" height="40" aria-hidden="true">${body}</svg>`;
  ICONS.set(key, svg);
  return svg;
}
// colours to pick from for a placed item
export const FURN_COLORS = ["#7d86a6", "#3f6f6a", "#6b4f3a", "#8a7f72", "#c27c4e", "#c8243a", "#e8a317", "#3d8fd6", "#4f8f3c", "#6b4f8a", "#f0ece4", "#c8a878", "#b5834e", "#5d3b2c", "#2b2f36", "#c3c8cd"];
