// Gear library: accurate involute spur gears, gear pairs, internal (ring) gears, racks and
// planetary sets, made as extruded profiles. Sizes in mm, the gear in its own frame: centred on
// the origin, lying on z = 0, the teeth around the Z axis (a rack lies along X).
//   module m (mm of pitch diameter per tooth), teeth z, pressure angle (14.5°, 20° or 25°)
//   pitch radius rp = m·z/2, base radius rb = rp·cos(pressure angle), tip rp + m, root rp − 1.25·m
// Each flank is the involute of the base circle, sampled finely, so gears made here mesh like real
// ones. Backlash (mm, at the pitch circle) is taken off the tooth thickness so printed gears turn
// freely; 0.1-0.2 mm suits most printers.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const inv = (a) => Math.tan(a) - a;
const P2 = (r, a) => [r6(r * Math.cos(a)), r6(r * Math.sin(a))];

export const GEAR_TYPES = [
  ["spur", "Spur gear", "One gear with straight teeth"],
  ["pair", "Gear pair", "Two gears that mesh, at the right distance apart"],
  ["ring", "Ring gear", "Internal (ring) gear: the teeth point inward"],
  ["rack", "Rack & pinion", "A straight toothed bar and the gear that drives it"],
  ["planet", "Planetary set", "Sun, planets and ring, all meshing"],
];
export const BORES = [["round", "Round"], ["d", "D-shaft"], ["hex", "Hex"], ["key", "Keyway"], ["none", "None"]];
export const GEAR_DEFAULTS = { type: "pair", m: 2, z: 20, z2: 40, pa: 20, thick: 8, backlash: 0.15, bore: "round", boreD: 5, hub: false, hubD: 0, hubH: 5, zp: 12, zs: 18, nPlanets: 3, rackLen: 0, rackH: 8, joints: true, spokes: false };

// a closed polygon of "bumps" between rLow and rHigh whose sides are involutes of rb:
// half = the bump's half angle at the pitch radius rp; bumps centred at angles off + k·2π/z
function bumps(z, rp, rb, pa, half, rLow, rHigh, off = 0, n = 10) {
  const pts = [], step = (2 * Math.PI) / z;
  // the half angle of a bump at radius r (it narrows outward along the involute)
  const halfAt = (r) => half + inv(pa) - (r > rb ? inv(Math.acos(rb / r)) : 0);
  const rStart = Math.max(rLow, rb);
  const flank = [];
  if (rLow < rb) flank.push([rLow, halfAt(rb)]); // a straight radial piece below the base circle
  for (let i = 0; i <= n; i++) { const t = i / n, r = rStart + (rHigh - rStart) * (1 - Math.cos((t * Math.PI) / 2)); flank.push([r, halfAt(r)]); }
  const hTip = Math.max(0.0005, halfAt(rHigh));
  for (let k = 0; k < z; k++) {
    const c = off + k * step;
    // up the right side (clockwise from the centre line), across the top, down the left side
    for (const [r, h] of flank) pts.push(P2(r, c - Math.max(h, hTip)));
    pts.push(P2(rHigh, c));
    for (let i = flank.length - 1; i >= 0; i--) { const [r, h] = flank[i]; pts.push(P2(r, c + Math.max(h, hTip))); }
    // along the bottom to the next bump
    const a0 = c + Math.max(flank[0][1], hTip), a1 = c + step - Math.max(flank[0][1], hTip);
    for (let i = 1; i < 4; i++) pts.push(P2(rLow, a0 + ((a1 - a0) * i) / 4));
  }
  // drop points that land on top of each other
  return pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
}
const loop = (pts) => pts.map((a, i) => ({ t: "line", a, b: pts[(i + 1) % pts.length] }));
const circle = (r, c = [0, 0]) => [{ t: "circle", c, r: r6(r) }];
function boreLoop(o, r) {
  const d = Math.min(o.boreD, r * 1.6);
  if (o.bore === "none" || d <= 0) return null;
  const R = d / 2;
  if (o.bore === "hex") { const a = []; for (let i = 0; i < 6; i++) a.push(P2(R / Math.cos(Math.PI / 6), (i * Math.PI) / 3 + Math.PI / 6)); return loop(a); }
  if (o.bore === "d" || o.bore === "key") {
    // a round hole with a flat (D-shaft) or a square keyway, as a polygon
    const a = [], n = 40;
    if (o.bore === "d") { const f = R * 0.8, t = Math.acos(f / R); for (let i = 0; i <= n; i++) a.push(P2(R, t + ((2 * Math.PI - 2 * t) * i) / n)); }
    else { const w = Math.max(1, d / 4), h = R + Math.max(0.8, d / 8), t = Math.asin(Math.min(0.95, w / 2 / R)); a.push([r6(R * Math.cos(t)), r6(-w / 2)]); a.push([r6(h), r6(-w / 2)]); a.push([r6(h), r6(w / 2)]); for (let i = 0; i <= n; i++) a.push(P2(R, t + ((2 * Math.PI - 2 * t) * i) / n)); }
    return loop(a);
  }
  return circle(R);
}
const plane = { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] };
const extr = (regions, h) => ({ t: "extrude", regions, plane, dist: r6(h), mode: "one", mods: [] });
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
const group = (kids) => ({ t: "group", children: kids, mods: [] });

// the numbers of an external gear
export function gearSizes(m, z, pa = 20) {
  const a = (pa * Math.PI) / 180, rp = (m * z) / 2;
  return { rp, rb: rp * Math.cos(a), ra: rp + m, rf: Math.max(rp - 1.25 * m, m * 0.3), pitchD: 2 * rp, outsideD: 2 * (rp + m), rootD: 2 * Math.max(rp - 1.25 * m, m * 0.3) };
}
// one external spur gear (with its bore and hub), and its info
export function spurGear(o, z, opt = {}) {
  const a = (o.pa * Math.PI) / 180, S = gearSizes(o.m, z, o.pa);
  const half = Math.PI / (2 * z) - o.backlash / 2 / S.rp;
  const outer = loop(bumps(z, S.rp, S.rb, a, half, S.rf, S.ra, opt.off || 0));
  const holes = [];
  const b = boreLoop(o, S.rf); if (b) holes.push(b);
  // lightening holes in a big gear, between the hub and the teeth
  if (o.spokes && S.rf > Math.max(o.boreD, o.hubD || 0) / 2 + 12) {
    const r0 = Math.max(o.boreD / 2 + 3, (o.hubD || 0) / 2 + 2), r1 = S.rf - 3, rc = (r0 + r1) / 2, rr = (r1 - r0) / 2 * 0.9;
    const n = Math.max(3, Math.min(8, Math.floor((2 * Math.PI * rc) / (2 * rr + 4))));
    for (let k = 0; k < n; k++) holes.push(circle(rr, P2(rc, ((k + 0.5) * 2 * Math.PI) / n)));
  }
  let node = extr([{ outer, holes }], o.thick);
  if (o.hub && o.hubD > o.boreD && o.hubH > 0) {
    const hub = extr([{ outer: circle(Math.min(o.hubD / 2, S.rf - 0.5)), holes: b ? [b] : [] }], o.hubH);
    node = group([{ node, m: T(), hole: false }, { node: hub, m: T(0, 0, o.thick), hole: false }]);
  }
  return { node, sizes: S };
}
// an internal (ring) gear: a rim with z teeth pointing inward
export function ringGear(o, z, rim = 0) {
  const a = (o.pa * Math.PI) / 180, rp = (o.m * z) / 2, rb = rp * Math.cos(a);
  const half = Math.PI / (2 * z) + o.backlash / 2 / rp; // the hole's bumps are the spaces between the ring's teeth
  const rIn = Math.max(rp - o.m, rb * 1.0005), rOut = rp + 1.25 * o.m;
  const hole = loop(bumps(z, rp, rb, a, half, rIn, rOut, 0));
  const R = rOut + Math.max(rim || 0, 2.5 * o.m, 3);
  return { node: extr([{ outer: circle(R), holes: [hole] }], o.thick), sizes: { rp, pitchD: 2 * rp, insideD: 2 * rIn, outsideD: 2 * R } };
}
// a rack along X: teeth on +Y, its pitch line at y = 0, the bar below
export function rack(o, n) {
  const a = (o.pa * Math.PI) / 180, p = Math.PI * o.m, ha = o.m, hf = 1.25 * o.m, H = Math.max(o.rackH, hf + 2);
  const tp = p / 2 - o.backlash, tan = Math.tan(a), pts = [];
  const x0 = -(n * p) / 2;
  pts.push([r6(x0), r6(-hf - H)]);
  for (let k = 0; k < n; k++) {
    const c = x0 + (k + 0.5) * p; // the tooth's centre
    const wr = tp / 2 + hf * tan, wt = Math.max(0.05, tp / 2 - ha * tan);
    pts.push([r6(c - p / 2), r6(-hf)], [r6(c - wr), r6(-hf)], [r6(c - wt), r6(ha)], [r6(c + wt), r6(ha)], [r6(c + wr), r6(-hf)]);
  }
  pts.push([r6(-x0), r6(-hf)], [r6(-x0), r6(-hf - H)]);
  return { node: extr([{ outer: loop(pts), holes: [] }], o.thick), sizes: { len: n * p, pitch: p } };
}

// every part of the set: [{ key, name, node, x, y, rot (rad), color, joint: { type, link: { to, ratio } } }]
// plus info lines. Joint ratios: degrees of this part per degree of the driver it links to.
export function gearSet(o0) {
  const o = { ...GEAR_DEFAULTS, ...o0 };
  o.z = Math.max(6, Math.round(o.z)); o.z2 = Math.max(6, Math.round(o.z2));
  const parts = [], info = [];
  const f = (v) => +v.toFixed(2);
  if (o.type === "spur" || o.type === "pair" || o.type === "rack") {
    const g = spurGear(o, o.z);
    parts.push({ key: "g1", name: o.type === "rack" ? "Pinion" : o.type === "pair" ? "Gear " + o.z + "T" : "Gear", node: g.node, x: 0, y: 0, rot: 0, color: "#d08a2e", joint: { type: "revolute" } });
    info.push(`${o.z} teeth, module ${o.m}: pitch Ø${f(g.sizes.pitchD)} mm, outside Ø${f(g.sizes.outsideD)} mm, root Ø${f(g.sizes.rootD)} mm.`);
    if (o.type === "pair") {
      const g2 = spurGear(o, o.z2, { off: Math.PI + Math.PI / o.z2 }), cd = (o.m * (o.z + o.z2)) / 2;
      parts.push({ key: "g2", name: "Gear " + o.z2 + "T", node: g2.node, x: cd, y: 0, rot: 0, color: "#5b8fd6", joint: { type: "revolute", link: { to: "g1", ratio: -o.z / o.z2 } } });
      info.push(`${o.z2}-tooth gear: pitch Ø${f(g2.sizes.pitchD)} mm. Centres ${f(cd)} mm apart. Ratio ${o.z}:${o.z2} (${f(o.z2 / o.z)} turns of the small gear for one of the big one).`);
    }
    if (o.type === "rack") {
      const n = o.rackLen > 0 ? Math.max(3, Math.round(o.rackLen / (Math.PI * o.m))) : Math.max(8, o.z);
      const r = rack(o, n), rp = (o.m * o.z) / 2;
      parts.push({ key: "rk", name: "Rack", node: r.node, x: 0, y: -rp, rot: 0, color: "#5b8fd6", joint: { type: "slider", d: [1, 0, 0], link: { to: "g1", ratio: -(Math.PI * o.m * o.z) / 360 } } });
      info.push(`Rack ${f(r.sizes.len)} mm long (${n} teeth, ${f(r.sizes.pitch)} mm apart): it moves ${f(Math.PI * o.m * o.z)} mm for each turn of the pinion.`);
      // the pinion's teeth line up with the rack's spaces
      parts[0].rot = n % 2 ? Math.PI / o.z : 0;
      parts[0].rot += -Math.PI / 2;
    }
  } else if (o.type === "ring") {
    const r = ringGear(o, o.z2);
    parts.push({ key: "ring", name: "Ring gear " + o.z2 + "T", node: r.node, x: 0, y: 0, rot: 0, color: "#5b8fd6", joint: { type: "revolute" } });
    info.push(`${o.z2}-tooth ring: pitch Ø${f(r.sizes.pitchD)} mm, teeth reach in to Ø${f(r.sizes.insideD)} mm, outside Ø${f(r.sizes.outsideD)} mm.`);
    if (o.z2 - o.z >= 8) {
      const g = spurGear(o, o.z, { off: 0 }), cd = (o.m * (o.z2 - o.z)) / 2;
      parts.push({ key: "g1", name: "Pinion " + o.z + "T", node: g.node, x: cd, y: 0, rot: 0, color: "#d08a2e", joint: { type: "revolute", link: { to: "ring", ratio: o.z2 / o.z } } });
      info.push(`With a ${o.z}-tooth pinion inside, ${f(cd)} mm off centre (ratio ${o.z}:${o.z2}, both turn the same way).`);
    } else info.push("A pinion inside needs at least 8 fewer teeth than the ring.");
  } else if (o.type === "planet") {
    let zs = Math.max(8, Math.round(o.zs)), zp = Math.max(8, Math.round(o.zp));
    const zr = zs + 2 * zp, np = Math.max(2, Math.min(6, Math.round(o.nPlanets)));
    const cd = (o.m * (zs + zp)) / 2;
    const sun = spurGear(o, zs, { off: 0 });
    parts.push({ key: "sun", name: "Sun gear " + zs + "T", node: sun.node, x: 0, y: 0, rot: 0, color: "#d08a2e", joint: { type: "revolute" } });
    const oP = { ...o, bore: o.bore === "none" ? "none" : "round", boreD: Math.min(o.boreD, ((zp - 2.5) * o.m) * 0.5), hub: false, spokes: false };
    for (let k = 0; k < np; k++) {
      const a = (k * 2 * Math.PI) / np;
      // turn each planet so its teeth fall into the sun's spaces at its place (and so the ring's)
      const pl = spurGear(oP, zp, { off: a + Math.PI - Math.PI / zp + ((a * zs) / zp) % ((2 * Math.PI) / zp) });
      parts.push({ key: "p" + k, name: "Planet " + (k + 1), node: pl.node, x: r6(cd * Math.cos(a)), y: r6(cd * Math.sin(a)), rot: 0, color: "#7a9a4a", joint: { type: "revolute", link: { to: "sun", ratio: -zs / zp } } });
    }
    const ring = ringGear(o, zr);
    parts.push({ key: "ring", name: "Ring gear " + zr + "T", node: ring.node, x: 0, y: 0, rot: (Math.PI * (zp - 1)) / zr, color: "#5b8fd6", joint: { type: "revolute", link: { to: "sun", ratio: -zs / zr } } });
    const even = (zs + zr) % np === 0;
    info.push(`Sun ${zs}T, ${np} planets ${zp}T, ring ${zr}T (module ${o.m}). Planet centres ${f(cd)} mm from the middle; ring outside Ø${f(ring.sizes.outsideD)} mm.`);
    info.push(even ? `With the planets' carrier held still, the ring turns ${f(zr / zs)} times slower than the sun (the other way). Holding the ring instead gives ${f(1 + zr / zs)}:1.` : `For ${np} evenly spaced planets, sun + ring teeth (${zs + zr}) should divide by ${np}: change the teeth.`);
  }
  if (o.type !== "rack" && o.type !== "planet" && o.z < 13 && o.pa <= 20) info.push("Fewer than 13 teeth at 20° (17 at 14.5°) undercuts the roots a little: fine for printing, or use more teeth.");
  return { parts, info };
}
