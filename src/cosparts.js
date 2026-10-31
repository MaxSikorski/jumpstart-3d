// CosForge parts: costume forms (helmets, chest plates, pauldrons, bracers, greaves, shields and
// more) shaped over the body. Each form is a thin shell over a surface that follows the body, cut to
// an outline, with details (ridges, panel lines, textures, muscles, emblems, rivets) and add-ons
// (horns, spikes, fins, ears, gems, goggles...). Everything is regenerated from its settings, so a
// part re-fits when the body's measurements change. Sizes in mm.
import * as THREE from "three";
import { segPoint, segSection, segDistance } from "./cosbody.js";
import { buildShell, surfaceAt, SD, smooth, shapePoly, lathe, extrude, tube, box, merge, weld, TL } from "./cosmesh.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

export const THEMES = [
  { id: "scifi", name: "Sci-Fi" }, { id: "modern", name: "Modern Sci-Fi" }, { id: "fantasy", name: "Fantasy" }, { id: "hero", name: "Comic Hero" },
  { id: "steam", name: "Steampunk" }, { id: "samurai", name: "Samurai" }, { id: "military", name: "Military" }, { id: "medieval", name: "Medieval Plate" }, { id: "roman", name: "Roman Legion" }, { id: "greek", name: "Ancient Greek" }, { id: "norse", name: "Norse" }, { id: "spaceop", name: "Space Opera" }, { id: "superhero", name: "Superhero Armor" }, { id: "basic", name: "Basic forms" },
];
// where each kind of part goes; sided parts come as a left and right pair
export const SLOTS = {
  helmet: { name: "Helmet", region: "Head" }, mask: { name: "Mask", region: "Head" }, crown: { name: "Crown / circlet", region: "Head" },
  gorget: { name: "Collar (gorget)", region: "Torso" }, chest: { name: "Chest plate", region: "Torso" }, back: { name: "Back plate", region: "Torso" }, belt: { name: "Belt", region: "Torso" }, tasset: { name: "Tassets (hip plates)", region: "Torso" },
  pauldron: { name: "Pauldron (shoulder)", region: "Arms", sided: true }, upperarm: { name: "Upper arm guard", region: "Arms", sided: true },
  bracer: { name: "Bracer / gauntlet", region: "Arms", sided: true }, handplate: { name: "Hand plate", region: "Arms", sided: true },
  thigh: { name: "Thigh plate", region: "Legs", sided: true }, knee: { name: "Knee guard", region: "Legs", sided: true },
  greave: { name: "Greave (shin)", region: "Legs", sided: true }, boot: { name: "Boot cover", region: "Legs", sided: true }, toe: { name: "Toe cap", region: "Legs", sided: true },
  shield: { name: "Shield", region: "Extras", sided: true, one: "L" },
};
export const REGIONS = ["Head", "Torso", "Arms", "Legs", "Extras"];

// ----------------------------------------------------------------------------- surfaces
function segDesc(seg, o) {
  const { phiC = 0, half = Math.PI, t0 = 0, t1 = 1, gap = 0, res = 3 } = o;
  const closed = half >= Math.PI - 1e-6;
  const span = closed ? Math.PI * 2 : 2 * half, phi0 = closed ? phiC - Math.PI : phiC - half;
  const R = (t) => { const s = segSection(seg, t); return (s.a + s.b) / 2 + gap; };
  const L = (t1 - t0) * seg.len, Rm = R((t0 + t1) / 2);
  const tmp = new THREE.Vector3();
  return {
    kind: "seg", closedU: closed, L, Rm, span, seg,
    nu: clampI((span * Math.max(R(t0), R(t1), Rm)) / res, 10, 300), nv: clampI(L / res, 4, 260),
    point: (u, v, out) => segPoint(seg, t0 + v * (t1 - t0), phi0 + u * span, gap, out),
    radial: (u, v, out) => {
      const t = t0 + v * (t1 - t0), s = segSection(seg, t);
      segPoint(seg, t, phi0 + u * span, gap, out);
      tmp.copy(seg.O).addScaledVector(seg.e3, t * seg.len).addScaledVector(seg.e1, s.cx).addScaledVector(seg.e2, s.cy);
      return out.sub(tmp);
    },
    xy: (u, v) => [(u - 0.5) * span * R(t0 + v * (t1 - t0)), v * L],
    halfW: (v) => (span / 2) * R(t0 + v * (t1 - t0)),
    border: (u, v) => Math.min(closed ? Infinity : Math.min(u, 1 - u) * span * R(t0 + v * (t1 - t0)), Math.min(v, 1 - v) * L),
  };
}
// a dome over a centre: phi around e3 (0 = towards e1), theta down from e3
function domeDesc(o) {
  const { C, e1, e2, e3, rx, ry, rz, th0 = 0, th1, gap = 0, mode = "polar", res = 3, phHalf = Math.PI } = o;
  const closed = phHalf >= Math.PI - 1e-6;
  const Rm = (rx + ry + rz) / 3 + gap;
  const tmp = new THREE.Vector3();
  const ang = (u, v) => [closed ? (u - 0.5) * Math.PI * 2 : (u - 0.5) * 2 * phHalf, th0 + v * (th1 - th0)];
  const d = {
    kind: "dome", closedU: closed, Rm, C, e1, e2, e3, th0, th1,
    nu: clampI((2 * (closed ? Math.PI : phHalf) * Rm * Math.sin(Math.min(th1, Math.PI / 2))) / res, 16, 300), nv: clampI(((th1 - th0) * Rm) / res, 4, 200),
    point: (u, v, out) => {
      const [ph, th] = ang(u, v), s = Math.sin(th);
      return out.copy(C).addScaledVector(e1, (rx + gap) * s * Math.cos(ph)).addScaledVector(e2, (ry + gap) * s * Math.sin(ph)).addScaledVector(e3, (rz + gap) * Math.cos(th));
    },
    radial: (u, v, out) => { d.point(u, v, out); out.sub(C); if (out.lengthSq() < 1e-9) out.copy(e3); return out; },
    xy: (u, v) => {
      const [ph, th] = ang(u, v);
      if (mode === "arc") return [ph * Rm * Math.sin(th), th * Rm];
      const r = th * Rm; return [r * Math.sin(ph), r * Math.cos(ph)];
    },
    border: (u, v) => Math.min(closed ? Infinity : Math.min(u, 1 - u) * 2 * phHalf * Rm * Math.sin(th0 + v * (th1 - th0)), th0 > 0 ? v * (th1 - th0) * Rm : Infinity, (1 - v) * (th1 - th0) * Rm),
  };
  void tmp;
  return d;
}
// a straight-through copy of a segment: lets a skirt hang below the torso, or a boot run past the ankle
function fakeSeg(O, e1, e2, e3, len, secs, p) { return { O, e1, e2, e3, len, secs, hand: 1, p }; }

// find (u, v) for a point given in outline coordinates
function invXY(desc, x, y) {
  let best = [0.5, 0.5], bd = Infinity;
  for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) { const u = i / 24, v = j / 24, [px, py] = desc.xy(u, v), d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = [u, v]; } }
  let [u, v] = best;
  for (let it = 0; it < 12; it++) {
    const e = 1e-4, [x0, y0] = desc.xy(u, v), [xu, yu] = desc.xy(u + e, v), [xv, yv] = desc.xy(u, v + e);
    const a = (xu - x0) / e, b = (xv - x0) / e, c = (yu - y0) / e, dd = (yv - y0) / e, det = a * dd - b * c;
    if (Math.abs(det) < 1e-9) break;
    const dx = x - x0, dy = y - y0;
    u += (dd * dx - b * dy) / det; v += (-c * dx + a * dy) / det;
    if (desc.closedU) u = ((u % 1) + 1) % 1; else u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));
  }
  return [u, v];
}

// "brow-30", "L*0.5", "W", 12 -> a number from the part's marks
export function ref(val, ctx) {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const m = /^\s*([A-Za-z]+)?\s*(?:([*+-])\s*(-?[\d.]+))?\s*$/.exec(val);
  if (!m) return parseFloat(val) || 0;
  let v = m[1] ? ctx[m[1]] ?? 0 : 0;
  const k = m[3] !== undefined ? parseFloat(m[3]) : 0;
  if (m[2] === "*") v *= k; else if (m[2] === "+") v += k; else if (m[2] === "-") v -= k;
  return v;
}

// ----------------------------------------------------------------------------- slots
// each returns { desc, mask(x, y, u, v), flare(u, v, x, y) (extra outward offset), ctx, lens? }
const tri = (x) => 1 - Math.abs(((x % 2) + 2) % 2 - 1) * 2; // 1 at even, -1 at odd
const pointsEdge = (x, period) => (tri(x / (period / 2)) + 1) / 2; // 0..1 sawtooth

function headDims(B, S) {
  const h = B.head, mR = (h.a + h.b + h.c) / 3, r = S.round || 0;
  return { C: h.C.clone(), rx: lerp(h.b, mR, r), ry: lerp(h.a, mR, r), rz: lerp(h.c, mR, r) * (S.tall || 1) };
}
const SHAPERS = {
  helmet(B, S, res) {
    const hd = headDims(B, S);
    const depth = rad(S.depth ?? 112), back = rad(S.back ?? 18);
    const desc = domeDesc({ ...hd, e1: V3(0, -1, 0), e2: V3(1, 0, 0), e3: V3(0, 0, 1), th1: depth + back, gap: S.gap ?? 12, mode: "arc", res });
    const Rm = desc.Rm, brow = rad(S.brow ?? 70) * Rm, fw = S.faceW ?? 120, fh = S.faceH ?? 40;
    const opening = (x, y) => {
      switch (S.face) {
        case "open": return SD.box(x, y, 0, brow + 400, fw / 2, 400, 16);
        case "visor": return SD.box(x, y, 0, brow + fh / 2, fw / 2, fh / 2, 10);
        case "bigvisor": return SD.box(x, y, 0, brow + fh / 2, fw / 2, fh / 2, 30);
        case "tvisor": return Math.max(SD.box(x, y, 0, brow + 13, fw / 2, 13, 6), SD.box(x, y, 0, brow + 300, 18, 300, 6));
        case "slit": return SD.box(x, y, 0, brow + 7, fw / 2, 7, 6);
        case "eyes": { const eye = (sx) => SD.poly(x, y, [[sx * 12, brow + 10], [sx * fw * 0.4, brow - 2], [sx * fw * 0.47, brow + 9], [sx * fw * 0.36, brow + 18], [sx * 16, brow + 20]]); return Math.max(eye(1), eye(-1)); }
        case "cowl": return Math.max(SD.ellipse(x, y, fw * 0.27, brow + 16, 24, 13), SD.ellipse(x, y, -fw * 0.27, brow + 16, 24, 13), SD.box(x, y, 0, brow + fh + 400, fw * 0.42, 400, 22));
        default: return -1e9;
      }
    };
    const mask = (x, y, u) => {
      const ph = (u - 0.5) * Math.PI * 2, lim = depth + back * (1 - Math.cos(ph)) / 2;
      return SD.sub(lim * Rm - y, opening(x, y));
    };
    const lensOn = S.lens && (S.face === "visor" || S.face === "bigvisor");
    const ctx = { wrapR: Rm, L: (depth + back) * Rm, W: Math.PI * Rm, brow, eye: brow + 16, top: 0, mid: brow * 0.5, emblemY: brow - 28 };
    return { desc, mask, ctx, lens: lensOn ? (x, y) => opening(x, y) + 5 : null };
  },
  mask(B, S, res) {
    const hd = headDims(B, {});
    const desc = domeDesc({ ...hd, e1: V3(0, -1, 0), e2: V3(1, 0, 0), e3: V3(0, 0, 1), th0: rad(48), th1: rad(132), phHalf: rad(80), gap: S.gap ?? 4, mode: "arc", res });
    const Rm = desc.Rm, eye = rad(91) * Rm, y0 = rad(48) * Rm;
    const eyes = (x, y) => Math.max(SD.ellipse(x, y, 31, eye, 17, 10), SD.ellipse(x, y, -31, eye, 17, 10));
    const mask = (x, y) => {
      const yy = y - y0;
      let f;
      if (S.style === "domino") f = SD.poly(x, yy, [[-86, eye - y0 - 6], [-58, eye - y0 - 27], [0, eye - y0 - 22], [58, eye - y0 - 27], [86, eye - y0 - 6], [66, eye - y0 + 20], [18, eye - y0 + 21], [0, eye - y0 + 11], [-18, eye - y0 + 21], [-66, eye - y0 + 20]]);
      else if (S.style === "lower") f = SD.sub(SD.box(x, yy, 0, eye - y0 + 78, 78, 46, 34), SD.ellipse(x, yy, 0, eye - y0 + 30, 16, 12));
      else if (S.style === "half") f = Math.min(SD.box(x, yy, 0, eye - y0 - 4, 82, 52, 22), Math.max(SD.box(x, yy, 0, eye - y0 + 40, 30, 18, 10), SD.box(x, yy, 0, eye - y0 + 6, 82, 30, 18)));
      else f = SD.sub(SD.box(x, yy, 0, eye - y0 + 30, 80, 82, 40), SD.box(x, yy, 0, eye - y0 + 82, 18, 4, 4));
      return SD.sub(f, eyes(x, y));
    };
    return { desc, mask, ctx: { L: rad(132) * Rm, W: rad(80) * Rm, eye, brow: eye - 18, emblemY: eye - 40, mid: eye } };
  },
  crown(B, S, res) {
    const hd = headDims(B, {});
    const top = rad(S.top ?? 62), bot = rad(S.bottom ?? 74), ph = S.pointH ?? 18;
    const Rm0 = (hd.rx + hd.ry + hd.rz) / 3 + (S.gap ?? 3);
    const th0 = Math.max(rad(10), top - (ph * 1.6) / Rm0 - rad(2));
    const desc = domeDesc({ ...hd, e1: V3(0, -1, 0), e2: V3(1, 0, 0), e3: V3(0, 0, 1), th0, th1: bot, gap: S.gap ?? 3, mode: "arc", res: Math.min(res, 2.2) });
    const Rm = desc.Rm, yt = top * Rm, yb = bot * Rm;
    const per = (2 * Math.PI * Rm * Math.sin(top)) / Math.max(1, S.points ?? 7);
    const mask = (x, y) => {
      const spikes = S.style === "flat" ? 0 : S.style === "round" ? ph * Math.pow(Math.abs(Math.cos((Math.PI * x) / per)), 0.6) : ph * pointsEdge(x + per / 2, per);
      const front = ph * 0.7 * Math.exp(-((x / 28) ** 2));
      return Math.min(yb - y, y - (yt - spikes - front));
    };
    return { desc, mask, ctx: { L: yb, W: Math.PI * Rm, emblemY: (yt + yb) / 2, mid: (yt + yb) / 2, brow: yt } };
  },
  chest(B, S, res, back = false) {
    const tor = B.segs.torso, Tz = (z) => (z - tor.O.z) / tor.len;
    const t0 = Math.max(0.02, Tz(B.z.waist - (S.drop ?? 40))), t1 = S.top ?? 0.985;
    const desc = segDesc(tor, { phiC: back ? Math.PI : 0, half: rad(S.side ?? 100), t0, t1, gap: S.gap ?? 14, res });
    const L = desc.L, Wt = desc.halfW(1), Wb = desc.halfW(0), nk = S.neck ?? (back ? 50 : 72), ar = S.arm ?? 80, vd = S.vd ?? 50;
    const mask = (x, y) => {
      let fb;
      switch (S.bottom) {
        case "v": fb = y - (vd * Math.abs(x)) / Wb; break;
        case "round": fb = y - vd * (x / Wb) ** 2; break;
        case "points": fb = y - vd * pointsEdge(x + Wb / 5, (2 * Wb) / 5); break;
        case "arch": fb = y - vd * (1 - (x / Wb) ** 2); break;
        default: fb = y;
      }
      let f = Math.min(L - y, fb * 0.8);
      f = SD.sub(f, SD.ellipse(x, y, 0, L + nk * 0.3, nk * 1.15, nk), 6);
      for (const sx of [1, -1]) f = SD.sub(f, SD.ellipse(x, y, sx * (Wt + ar * 0.12), L - ar * 0.55, ar, ar * 1.55), 8);
      return f;
    };
    const tc = Tz(B.z.chest), tw = Tz(B.z.waist);
    const ctx = { L, W: Wt, chest: (tc - t0) * tor.len, waist: (tw - t0) * tor.len, wChest: segSection(tor, tc).a, emblemY: (tc - t0) * tor.len + (back ? 0 : 20), mid: L / 2, down: -1 };
    return { desc, mask, ctx };
  },
  back(B, S, res) { return SHAPERS.chest(B, S, res, true); },
  belt(B, S, res) {
    const tor = B.segs.torso, Tz = (z) => (z - tor.O.z) / tor.len;
    const h = S.height ?? 60, zc = B.z.waist + (S.dz ?? -30);
    const desc = segDesc(tor, { phiC: 0, half: Math.PI - rad((S.open ?? 24) / 2), t0: Tz(zc - h / 2), t1: Tz(zc + h / 2), gap: S.gap ?? 8, res: Math.min(res, 2.5) });
    const L = desc.L;
    const mask = (x, y) => (S.buckle ? Math.max(Math.min(y, L - y), SD.box(x, y, 0, L / 2, (S.buckle ?? 0) / 2, L / 2 + 8, 6)) : Math.min(y, L - y));
    return { desc, mask, ctx: { L, W: desc.halfW(0.5), emblemY: L / 2, mid: L / 2, down: -1 }, ext: S.buckle ? 10 : 0 };
  },
  tasset(B, S, res) {
    const tor = B.segs.torso, Tz = (z) => (z - tor.O.z) / tor.len;
    const th = Tz(B.z.hip + (S.dz ?? 20)), sec = segSection(tor, th), len = S.len ?? 200, fl = S.flare ?? 0.25;
    const O = tor.O.clone().addScaledVector(tor.e3, th * tor.len);
    const seg = fakeSeg(O, tor.e1, tor.e2, V3(0, 0, -1), len, [{ t: 0, a: sec.a, b: sec.b, cx: sec.cx, cy: sec.cy }, { t: 1, a: sec.a + fl * len, b: sec.b + fl * len, cx: sec.cx, cy: sec.cy }], tor.p);
    const desc = segDesc(seg, { phiC: 0, half: rad((S.cover ?? 200) / 2), t0: 0, t1: 1, gap: S.gap ?? 10, res });
    const k = Math.max(1, S.plates ?? 3), g = S.split ?? 14, band = S.band ?? 0;
    const mask = (x, y) => {
      const W = desc.halfW(y / len), pw = (2 * W - (k - 1) * g) / k;
      let f = -1e9;
      for (let i = 0; i < k; i++) { const xc = -W + pw / 2 + i * (pw + g); f = Math.max(f, SD.box(x, y, xc, len / 2, pw / 2, len / 2, 12)); }
      if (band) f = Math.max(f, Math.min(SD.box(x, y, 0, band / 2, W, band / 2), y));
      return f;
    };
    return { desc, mask, ctx: { L: len, W: desc.halfW(0), emblemY: len * 0.4, mid: len / 2, down: 1 } };
  },
  limb(B, S, res, segName, phiC) {
    const seg = typeof segName === "string" ? B.segs[segName] : segName;
    const ep = S.point ?? 0, t0 = (S.from ?? (typeof segName === "string" && segName.startsWith("thigh") ? 0.25 : 0.1)) - ep / seg.len, t1 = (S.to ?? 0.9) + (S.extend ?? 0) / seg.len;
    const desc = segDesc(seg, { phiC, half: rad(Math.min(360, S.cover ?? 300) / 2), t0, t1, gap: S.gap ?? 6, res });
    const L = desc.L, W = desc.halfW(0.5);
    const mask = (x, y) => {
      let f = Math.min(y, L - y);
      if (ep > 0) f = Math.min(L - y, y - ep + ep * Math.max(0, 1 - Math.abs(x) / Math.max(10, W * 0.42)));
      if (S.bottomPoints) f = Math.min(f, L - y - S.bottomPoints * pointsEdge(x, (2 * W) / 4));
      if (S.arch) f = Math.min(f, L - y - S.arch * Math.max(0, 1 - (x / (S.archW ?? 62)) ** 2));
      return f;
    };
    const fe = S.flareTop ?? 0, fw = S.flareBot ?? 0;
    const flare = (u, v) => fe * (1 - smooth(0, 0.35, v)) ** 2 + fw * smooth(0.6, 1, v) ** 2;
    return { desc, mask, flare, ctx: { L, W, emblemY: L * 0.42, mid: L / 2, down: 1 } };
  },
  pauldron(B, S, res) {
    const sj = B.joints.shoulderL, d = B.segs.upperArmL.e3.clone();
    const tilt = rad(S.tilt ?? 32);
    const e3 = V3(Math.sin(tilt), 0, Math.cos(tilt)).normalize();
    const e1 = d.clone().sub(e3.clone().multiplyScalar(d.dot(e3))).normalize();
    const e2 = new THREE.Vector3().crossVectors(e3, e1);
    const r0 = sj.r * 1.55 * (S.size ?? 1);
    const desc = domeDesc({ C: sj.p.clone().add(V3(0, 0, sj.r * 0.1)), e1, e2, e3, rx: r0 * 1.15, ry: r0 * 1.05, rz: r0 * 0.92, th1: rad(S.reach ?? 105), gap: S.gap ?? 10, res });
    const Wd = r0 * 1.25 * (S.width ?? 1), D = r0 * 1.9 * (S.drop ?? 1), yc = D * 0.16;
    const mask = (x, y) => {
      switch (S.shape) {
        case "shield": return Math.max(SD.ellipse(x, y, 0, yc - D * 0.05, Wd, D * 0.42), SD.poly(x, y, [[-Wd * 0.8, yc], [Wd * 0.8, yc], [0, yc + D * 0.62]]));
        case "tower": return SD.box(x, y, 0, yc + D * 0.1, Wd * 0.95, D * 0.55, 10);
        case "spiky": return Math.min(SD.ellipse(x, y, 0, yc, Wd, D * 0.5), y - (yc - D * 0.5 + 18) + 26 * pointsEdge(x + Wd / 3, (2 * Wd) / 3) + 0.0);
        default: return SD.ellipse(x, y, 0, yc, Wd, D * 0.5);
      }
    };
    return { desc, mask, ctx: { L: D, W: Wd, D, emblemY: yc - D * 0.1, mid: yc, top: yc - D * 0.5, down: 1 } };
  },
  handplate(B, S, res) {
    const hs = B.segs.handL, t = 0.38, sec = segSection(hs, t);
    const c = hs.O.clone().addScaledVector(hs.e3, t * hs.len).addScaledVector(hs.e1, sec.cx).addScaledVector(hs.e2, sec.cy);
    const lat = segPoint(hs, t, Math.PI / 2, 0).sub(c).normalize();
    const e1 = hs.e3.clone().sub(lat.clone().multiplyScalar(hs.e3.dot(lat))).normalize(), e2 = new THREE.Vector3().crossVectors(lat, e1);
    const desc = domeDesc({ C: c, e1, e2, e3: lat, rx: hs.len * 0.4, ry: sec.b * 1.25, rz: sec.a * 1.4, th1: rad(70), gap: S.gap ?? 4, res: Math.min(res, 2.5) });
    const mask = (x, y) => SD.ellipse(x, y, 0, 4, sec.b * 1.0, hs.len * 0.36);
    return { desc, mask, ctx: { L: hs.len * 0.7, W: sec.b, emblemY: 0, mid: 0, down: 1 } };
  },
  knee(B, S, res) {
    const kn = B.joints.kneeL, e3 = V3(0, -1, 0.12).normalize(), e1 = V3(0, 0, -1).sub(e3.clone().multiplyScalar(-e3.z)).normalize(), e2 = new THREE.Vector3().crossVectors(e3, e1);
    const r = kn.r * 1.12 * (S.size ?? 1);
    const desc = domeDesc({ C: kn.p.clone().addScaledVector(e3, kn.r * 0.3), e1, e2, e3, rx: r * 1.1, ry: r * 1.15, rz: r, th1: rad(92), gap: S.gap ?? 8, res: Math.min(res, 2.5) });
    const R = r * 0.78, w = S.wings ?? 1;
    const mask = (x, y) => Math.max(SD.circle(x, y, 0, 0, R), w ? SD.ellipse(x, y, 0, R * 0.1, R * 1.32, R * 0.4) : -1e9, S.fan ? SD.poly(x, y, [[-R * 0.9, -R * 0.2], [0, -R * 1.45], [R * 0.9, -R * 0.2]]) : -1e9);
    return { desc, mask, ctx: { L: R * 2, W: R, emblemY: 0, mid: 0, down: 1 } };
  },
  toe(B, S, res) {
    const fs = B.segs.footL, t = 0.6, sec = segSection(fs, t);
    const c = fs.O.clone().addScaledVector(fs.e3, t * fs.len).addScaledVector(fs.e1, sec.cx).addScaledVector(fs.e2, sec.cy);
    const e3 = V3(0, -0.45, 1).normalize(), fwd = V3(0, -1, 0), e1 = fwd.clone().sub(e3.clone().multiplyScalar(fwd.dot(e3))).normalize(), e2 = new THREE.Vector3().crossVectors(e3, e1);
    const desc = domeDesc({ C: c, e1, e2, e3, rx: fs.len * 0.45, ry: sec.a * 1.3, rz: sec.b * 2.0, th1: rad(88), gap: S.gap ?? 8, res: Math.min(res, 2.5) });
    const mask = (x, y) => SD.ellipse(x, y, 0, fs.len * 0.12, sec.a * 1.6, fs.len * 0.5);
    return { desc, mask, ctx: { L: fs.len, W: sec.a, emblemY: 0, mid: 0, down: 1 } };
  },
  shield(B, S, res) {
    const fa = B.segs.forearmL, t = 0.55, sec = segSection(fa, t);
    const ax = fa.O.clone().addScaledVector(fa.e3, t * fa.len).addScaledVector(fa.e1, sec.cx).addScaledVector(fa.e2, sec.cy);
    const P0 = segPoint(fa, t, Math.PI / 2, (S.gap ?? 10) + 40), lat = P0.clone().sub(ax).normalize();
    const R = S.curve ?? 700, C = P0.clone().addScaledVector(lat, -R);
    const e1 = fa.e3.clone().sub(lat.clone().multiplyScalar(fa.e3.dot(lat))).normalize(), e2 = new THREE.Vector3().crossVectors(lat, e1);
    const sz = S.size ?? 500;
    const desc = domeDesc({ C, e1, e2, e3: lat, rx: R, ry: R, rz: R, th1: Math.min(rad(80), (sz * 0.72) / R), gap: 0, res: Math.max(res, 3) });
    const s = sz / 2;
    const mask = (x, y) => {
      switch (S.shape) {
        case "kite": return SD.poly(x, y, [[-0.82 * s, -0.75 * s], [-0.5 * s, -0.95 * s], [0.5 * s, -0.95 * s], [0.82 * s, -0.75 * s], [0.7 * s, 0.1 * s], [0, 1.25 * s], [-0.7 * s, 0.1 * s]]);
        case "heater": { const P = [[-0.85 * s, -0.85 * s], [0.85 * s, -0.85 * s]]; for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; P.push([Math.cos(a) * 0.85 * s, -0.25 * s + Math.sin(a) * 1.1 * s]); } return SD.poly(x, y, P); }
        case "hex": return SD.poly(x, y, shapePoly("hex", s));
        case "tower": return SD.box(x, y, 0, 0, s * 0.62, s * 1.1, 24);
        default: return SD.circle(x, y, 0, 0, s);
      }
    };
    return { desc, mask, ctx: { L: sz, W: s, emblemY: 0, mid: 0, down: 1 } };
  },
};
SHAPERS.upperarm = (B, S, r) => SHAPERS.limb(B, S, r, "upperArmL", Math.PI / 2);
SHAPERS.bracer = (B, S, r) => SHAPERS.limb(B, S, r, "forearmL", Math.PI / 2);
SHAPERS.thigh = (B, S, r) => SHAPERS.limb(B, S, r, "thighL", 0);
SHAPERS.greave = (B, S, r) => SHAPERS.limb(B, S, r, "shinL", 0);
// a collar: a sloping band from the top of the shoulders up around the neck
SHAPERS.gorget = (B, S, r) => {
  const tor = B.segs.torso, nk = B.segs.neck, H = B.H;
  const zB = B.z.shoulder - 0.05 * H * (S.spread ?? 1), tB = (zB - tor.O.z) / tor.len, sB = segSection(tor, tB);
  const zN = nk.O.z + nk.len * 0.55, sN = segSection(nk, 0.55), sM = segSection(tor, 1);
  const O = tor.O.clone().addScaledVector(tor.e3, tB * tor.len), L = zN - zB, tm = (B.z.top - zB) / L;
  const nyOff = nk.O.y - tor.O.y;
  // follow the shoulders' own shape up to the top of the torso, then narrow to the neck
  const secs = [];
  const tTop = Math.min(0.85, Math.max(0.3, tm));
  for (let k = 0; k <= 5; k++) { const z = zB + (B.z.top - zB) * (k / 5), sc = segSection(tor, (z - tor.O.z) / tor.len); secs.push({ t: tTop * (k / 5), a: Math.max(sc.a, sN.a * 1.25), b: Math.max(sc.b, sN.b * 1.2), cx: sc.cx, cy: sc.cy }); }
  secs.push({ t: 1, a: sN.a, b: sN.b, cx: 0, cy: nyOff });
  void sB; void sM;
  const seg = fakeSeg(O, tor.e1, tor.e2, V3(0, 0, 1), L, secs, 2.2);
  return SHAPERS.limb(B, { from: 0, to: 1, cover: 330, gap: 8, ...S }, r, seg, 0);
};
SHAPERS.boot = (B, S, r) => SHAPERS.limb(B, { from: 0.72, to: 1, extend: 45, flareBot: 28, arch: (S.extend ?? 45) + 30, ...S }, r, "shinL", 0);

// body segments each kind of part keeps clear of (it is trimmed where it would run into them)
const ARMS = ["upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR", "shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR"];
const AVOID = {
  helmet: ["neck", "torso"], mask: ["neck"], crown: [], gorget: ["torso", "head", "shoulderL", "shoulderR", "upperArmL", "upperArmR"],
  chest: ARMS, back: ARMS, belt: ARMS, tasset: [...ARMS, "thighL", "thighR"],
  pauldron: ["upperArmL", "elbowL", "torso", "neck", "head"], upperarm: ["torso", "forearmL"], bracer: ["handL", "upperArmL", "thighL", "torso"], handplate: ["handL", "forearmL"],
  thigh: ["torso", "thighR", "handL", "forearmL", "hipR"], knee: ["thighL", "shinL"], greave: ["footL", "shinR", "thighL"], boot: ["footL", "shinR"], toe: ["footL", "shinL", "ankleL"], shield: [],
};
// ----------------------------------------------------------------------------- surface details
function hexEdge(x, y, s) {
  const h = (s * Math.sqrt(3)) / 2;
  let best = Infinity;
  for (const [ox, oy] of [[0, 0], [h, 1.5 * s]]) {
    const i = Math.round((x - ox) / (2 * h)), j = Math.round((y - oy) / (3 * s));
    const dx = Math.abs(x - ox - i * 2 * h), dy = Math.abs(y - oy - j * 3 * s);
    const d = Math.max(dx, dx * 0.5 + dy * (Math.sqrt(3) / 2));
    if (d < best) best = d;
  }
  return h - best;
}
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function details(x, y, f, D, ctx, res) {
  const T = D.thick ?? 2.5;
  let th = T, off = 0, acc = 0;
  const gw = Math.max(1.2, res * 0.7), groove = (d) => (d < gw ? 1 - (d / gw) ** 2 : 0);
  const es = D.edgeSize ?? 6, eh = D.edgeH ?? 2;
  switch (D.edge) {
    case "roll": if (f < es) th += eh * Math.sqrt(Math.max(0, 1 - ((f - es / 2) / (es / 2)) ** 2)); break;
    case "trim": th += eh * (1 - smooth(es - 0.8, es + 0.8, f)); break;
    case "flare": off += eh * 3 * (1 - smooth(0, es * 2.5, f)) ** 2; break;
    case "bevel": th *= 0.5 + 0.5 * smooth(0, es, f); break;
  }
  if (D.ridge) {
    const w = D.ridgeW ?? 10;
    let dist = D.ridgeDir === "h" ? Math.abs(y - ref(D.ridgePos ?? "mid", ctx)) : Math.abs(x - (D.ridgePos && D.ridgeDir !== "h" ? ref(D.ridgePos, ctx) : 0));
    // a helmet's centre line runs on over the top and down the back
    if (ctx.wrapR && D.ridgeDir !== "h") dist = Math.min(dist, Math.abs(Math.PI * ctx.wrapR * Math.sin(y / ctx.wrapR) - Math.abs(x)));
    if (dist < w) th += D.ridge * (D.ridgeSharp ? 1 - dist / w : Math.sqrt(1 - (dist / w) ** 2)) * smooth(0, es + 2, f);
  }
  if (D.muscle && ctx.chest !== undefined) {
    const m = D.muscle, W = ctx.wChest || ctx.W * 0.5, yc = ctx.chest;
    if (ctx.back) {
      for (const sx of [1, -1]) { const k = Math.hypot((x - sx * W * 0.42) / (W * 0.36), (y - yc - 15) / 70); if (k < 1) th += m * 9 * Math.sqrt(1 - k * k); }
      th -= m * 3 * groove(Math.abs(x) * 0.6);
    } else {
      for (const sx of [1, -1]) { const k = Math.hypot((x - sx * W * 0.4) / (W * 0.42), (y - yc - 6) / (y < yc ? 38 : 62)); if (k < 1) th += m * 14 * Math.pow(1 - k * k, 0.6); }
      const yw = ctx.waist ?? 0;
      for (let r = 0; r < 3; r++) for (const sx of [1, -1]) {
        const cy = yw + 10 + r * ((yc - yw - 40) / 3), sd = SD.box(x, y, sx * W * 0.2, cy, W * 0.17, (yc - yw - 40) / 7.2, 10);
        if (sd > 0) th += m * 6 * smooth(0, 7, sd);
      }
      th -= m * 4 * groove(Math.abs(x) * 0.7);
    }
  }
  if (D.lines && D.lines !== "none" && f > 2) {
    const g = D.lineGap ?? 14, dep = D.lineDepth ?? 1, s = Math.max(6, g * 2.4);
    let d = Infinity;
    const mod = (a, p) => Math.abs((((a % p) + p) % p) - p / 2) - p / 2;
    switch (D.lines) {
      case "inset": d = Math.abs(f - g); break;
      case "panels": d = Math.min(Math.abs(f - g), f > g ? Math.abs(x) : Infinity, f > g ? Math.abs(y - ctx.mid) : Infinity); break;
      case "grid": d = Math.min(Math.abs(mod(x, s)), Math.abs(mod(y, s))); break;
      case "hbands": d = Math.abs(mod(y, s)); break;
      case "vbands": d = Math.abs(mod(x, s)); break;
      case "chevron": d = Math.abs(mod(y - (ctx.down || 1) * Math.abs(x) * 0.6, s)); break;
    }
    th -= dep * groove(d);
    if (D.glow && groove(d) > 0.2) acc = 1;
  }
  if (D.tex && D.tex !== "none" && f > 1.5) {
    const s = D.texSize ?? 20, dep = D.texDepth ?? 1.5, inside = smooth(1.5, 4, f);
    switch (D.tex) {
      case "hex": th += dep * smooth(gw * 0.5, gw * 1.5, hexEdge(x, y, s)) * inside; break;
      case "scales": {
        const r = s / 2, row = s * 0.62, j0 = Math.floor(y / row);
        let best = 0;
        for (const j of [j0, j0 + 1]) { const ox = j % 2 ? r : 0, i = Math.round((x - ox) / s), dx = x - ox - i * s, dy = (y - j * row) * (ctx.down || 1); const k = Math.hypot(dx, dy) / r; if (k < 1 && dy <= r * 0.2) best = Math.max(best, Math.sqrt(1 - k * k)); }
        th += dep * best * inside; break;
      }
      case "lames": { const yy = (ctx.down || 1) * y, fr = ((yy % s) + s) % s / s; th += dep * fr * inside; break; }
      case "ribs": th += dep * 0.5 * (1 + Math.cos((2 * Math.PI * x) / s)) * inside; break;
      case "quilt": { const m = (a) => Math.abs((((a % s) + s) % s) - s / 2); th -= dep * 0.7 * groove(Math.min(s / 2 - m(x + y), s / 2 - m(x - y)) * 0.7) * inside; break; }
      case "hammered": { const i = Math.floor(x / s), j = Math.floor(y / s); let v = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const cx = (i + a + hash(i + a, j + b) * 0.8) * s, cy = (j + b + hash(j + b, i + a) * 0.8) * s, k = Math.hypot(x - cx, y - cy) / (s * 0.55); if (k < 1) v = Math.max(v, 1 - k * k); } th -= dep * 0.6 * v * inside; break; }
    }
  }
  if (D.emblem && D.emblem !== "none") {
    const P = D._poly, ex = ref(D.emblemX ?? 0, ctx), ey = ref(D.emblemY ?? "emblemY", ctx) + (D.emblemDY || 0);
    const sd = SD.poly(x - ex, y - ey, P);
    if (sd > -0.5) th += (D.emblemH ?? 2.5) * smooth(-0.4, 1.2, sd);
    if (D.emblemGlow && sd > 0) acc = 1;
  }
  th = Math.max(Math.min(T * 0.5, 1.2), th);
  return { th, off, acc };
}

// ----------------------------------------------------------------------------- add-ons
const ADDONS = ["horn", "spike", "fin", "ear", "plate", "gem", "antenna", "goggles", "thruster", "gauge", "boss", "box"];
export { ADDONS };
export const ADDON_NAMES = { horn: "Horn", spike: "Spike", fin: "Fin / crest", ear: "Ear", plate: "Flat plate (wing, crescent...)", gem: "Gem", antenna: "Antenna", goggles: "Goggles", thruster: "Thruster", gauge: "Gauge", boss: "Shield boss", box: "Pouch / box" };
function profileH(kind, s) {
  switch (kind) {
    case "shark": return s < 0.7 ? Math.pow(s / 0.7, 1.3) : (1 - s) / 0.3;
    case "mohawk": return Math.min(1, s / 0.12, (1 - s) / 0.12);
    case "ear": return s < 0.38 ? s / 0.38 : (1 - s) / 0.62;
    case "rounded": return Math.sqrt(Math.max(0, Math.sin(Math.PI * s)));
    default: return Math.pow(Math.max(0, Math.sin(Math.PI * s)), 0.6);
  }
}
// a point on the outside of the shell at outline coords (x, y), with normal and tangents
function anchor(sh, x, y) {
  const [u, v] = invXY(sh.desc, x, y);
  const B = new THREE.Vector3(), N = new THREE.Vector3();
  surfaceAt(sh.desc, u, v, B, N);
  const r = sh.nodeAt(u, v);
  const S = B.clone().addScaledVector(N, r.off + r.th);
  const e = 0.5, [u2, v2] = invXY(sh.desc, x + e, y), [u3, v3] = invXY(sh.desc, x, y + e);
  const Bx = new THREE.Vector3(), By = new THREE.Vector3(), Nt = new THREE.Vector3();
  surfaceAt(sh.desc, u2, v2, Bx, Nt); surfaceAt(sh.desc, u3, v3, By, Nt);
  const Tx = Bx.sub(B), Ty = By.sub(B);
  Tx.sub(N.clone().multiplyScalar(Tx.dot(N))).normalize();
  Ty.sub(N.clone().multiplyScalar(Ty.dot(N))).sub(Tx.clone().multiplyScalar(Ty.dot(Tx))).normalize();
  if (!isFinite(Tx.x) || Tx.lengthSq() < 0.5) { Tx.set(1, 0, 0).sub(N.clone().multiplyScalar(N.x)).normalize(); Ty.crossVectors(N, Tx); }
  return { S, N, Tx, Ty, u, v, th: r.th };
}
function addonSolids(a, sh, ctx) {
  const out = [];
  const x0 = ref(a.x ?? 0, ctx) + (a._dx || 0);
  const xs = a.mirror && Math.abs(x0) > 0.5 ? [x0, -x0] : [x0];
  xs.forEach((x, mi) => {
    const y = ref(a.y ?? 0, ctx) + (a._dy || 0), sz = a.size ?? 10, flipA = mi === 1;
    const ang = rad(flipA ? 180 - (a.ang ?? 0) : a.ang ?? 0);
    const A = anchor(sh, x, y);
    const Td = A.Tx.clone().multiplyScalar(Math.cos(ang)).addScaledVector(A.Ty, Math.sin(ang)).normalize();
    switch (a.k) {
      case "horn": case "spike": {
        const len = a.len ?? (a.k === "spike" ? sz * 2.4 : sz * 7), n = a.k === "spike" ? 6 : 22, curl = rad(a.k === "spike" ? 0 : a.curl ?? 60), tilt = rad(a.tilt ?? (a.k === "spike" ? 0 : 30));
        let D = A.N.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(Td, Math.sin(tilt)).normalize();
        const axis = new THREE.Vector3().crossVectors(A.N, Td).normalize();
        if (axis.lengthSq() < 0.5) axis.copy(A.Tx);
        const path = [], radii = [];
        let p = A.S.clone().addScaledVector(A.N, -Math.min(3, A.th + 0.5));
        for (let k = 0; k <= n; k++) {
          path.push(p.clone()); radii.push(k === n ? 0 : sz * Math.pow(1 - k / n, 0.85));
          p = p.clone().addScaledVector(D, len / n);
          D = D.clone().applyAxisAngle(axis, curl / n);
        }
        out.push(tube(path, radii, 14));
        break;
      }
      case "fin": case "ear": {
        const l = a.len ?? (a.k === "ear" ? 50 : 160), h = a.h ?? (a.k === "ear" ? 55 : 40), w = a.w ?? 4, prof = a.k === "ear" ? "ear" : a.profile ?? "blade";
        const n = 28, y0 = y - l / 2, Q = [], Nn = [];
        const sag = a.path === "sagittal" && ctx.wrapR;
        for (let k = 0; k <= n; k++) {
          let yy = a.across ? y : y0 + (k / n) * l, xx = a.across ? x - l / 2 + (k / n) * l : x;
          // over the top of a helmet: up the front, then down the back
          if (sag) { const s = ref(a.from ?? "brow-10", ctx), e = ref(a.to ?? "brow", ctx), d = -s + (k / n) * (s + e); yy = Math.max(0.5, Math.abs(d)); xx = d < 0 ? 0 : Math.PI * ctx.wrapR * Math.sin(yy / ctx.wrapR) - 0.01; }
          const P = anchor(sh, xx, yy); Q.push(P.S.clone().addScaledVector(P.N, -Math.min(2.5, P.th + 0.4))); Nn.push(P.N.clone());
        }
        const X = Q[n].clone().sub(Q[0]).normalize(), Navg = Nn.reduce((s, v) => s.add(v), new THREE.Vector3()).normalize();
        const Y = Navg.clone().sub(X.clone().multiplyScalar(Navg.dot(X))).normalize(), W = new THREE.Vector3().crossVectors(X, Y);
        const to2 = (P) => { const d = P.clone().sub(Q[0]); return [d.dot(X), d.dot(Y)]; };
        const bottom = Q.map((q, k) => { const p2 = to2(q); p2[1] -= 1.5; return p2; });
        const top = [];
        for (let k = n; k >= 0; k--) { const hh = h * profileH(prof, k / n); if (hh > 0.6) top.push(to2(Q[k].clone().addScaledVector(Nn[k], hh + 2))); }
        const poly = [...bottom, ...top];
        out.push(extrude(poly, [], Q[0].clone().addScaledVector(W, -w / 2), X, Y, W, w));
        break;
      }
      case "plate": {
        const shape = a.shape ?? "wing", w = a.w ?? 3;
        let P = shapePoly(shape, sz);
        const rot = rad(a.rot ?? 0);
        P = P.map(([px, py]) => { const qx = (flipA ? -px : px), qy = py; return [qx * Math.cos(rot) - qy * Math.sin(rot) * (flipA ? -1 : 1), qx * Math.sin(rot) * (flipA ? -1 : 1) + qy * Math.cos(rot)]; });
        // in the tangent plane: +x along the outline's x, +y towards the outline's -y (up on a helmet)
        const ex = A.Tx.clone(), ey = A.Ty.clone().negate();
        out.push(extrude(P, [], A.S.clone().addScaledVector(A.N, -Math.min(1.5, A.th) + (a.lift ?? 0)), ex, ey, A.N.clone(), w + Math.min(1.5, A.th), a.accent ? TL.ACCENT : TL.ADD));
        break;
      }
      case "gem": out.push(lathe([[0, -1.5], [sz, -1.5], [sz, sz * 0.22], [sz * 0.62, sz * 0.62], [0, sz * 0.72]], A.S, A.N, a.seg ?? 8, TL.ACCENT, A.Tx)); break;
      case "boss": out.push(lathe([[0, -1.5], [sz, -1.5], [sz, sz * 0.12], [sz * 0.85, sz * 0.38], [sz * 0.5, sz * 0.58], [0, sz * 0.64]], A.S, A.N, 32)); break;
      case "antenna": {
        const len = a.len ?? 70;
        out.push(lathe([[0, -2], [4, -2], [4, 3], [1.6, 6], [1.6, len], [0, len]], A.S, A.N, 12));
        out.push(lathe([[0, len - 3], [3, len - 1], [4, len + 2], [3, len + 5], [0, len + 6.5]], A.S, A.N, 12, TL.ACCENT));
        break;
      }
      case "goggles": {
        const r = sz;
        out.push(lathe([[0, -2], [r, -2], [r, r * 0.42], [r * 0.86, r * 0.52], [r * 0.78, r * 0.36], [0, r * 0.36]], A.S, A.N, 28));
        out.push(lathe([[0, r * 0.3], [r * 0.8, r * 0.3], [r * 0.8, r * 0.4], [0, r * 0.42]], A.S, A.N, 28, TL.ACCENT));
        break;
      }
      case "thruster": {
        const r = sz;
        out.push(lathe([[0, -2], [r, -2], [r, r * 0.5], [r * 1.25, r * 1.5], [r * 0.9, r * 1.5], [r * 0.7, r * 0.7], [0, r * 0.7]], A.S, A.N, 24));
        break;
      }
      case "gauge": {
        const r = sz;
        out.push(lathe([[0, -1.5], [r, -1.5], [r, r * 0.3], [r * 0.88, r * 0.34], [r * 0.85, r * 0.2], [0, r * 0.2]], A.S, A.N, 28));
        out.push(lathe([[0, r * 0.15], [r * 0.84, r * 0.15], [r * 0.84, r * 0.24], [0, r * 0.26]], A.S, A.N, 28, TL.ACCENT));
        break;
      }
      case "box": {
        const w = a.w ?? sz * 1.6, hh = a.len ?? sz * 1.2, d = a.h ?? sz * 0.8;
        out.push(box(A.S.clone().addScaledVector(A.N, d / 2 - 1.5), A.Tx.clone().multiplyScalar(w / 2), A.Ty.clone().multiplyScalar(hh / 2), A.N.clone().multiplyScalar(d / 2)));
        break;
      }
    }
  });
  // a row: several copies along y (or x for "across")
  return out;
}
function expandRows(list) {
  const out = [];
  for (const a of list || []) {
    if (!a || a.off) continue;
    const n = Math.max(1, Math.min(24, a.count ?? 1)), step = a.step ?? 30;
    for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * step; out.push({ ...a, _dx: a.rowAcross ? o : 0, _dy: a.rowAcross ? 0 : o }); }
  }
  return out;
}

// rivets along a line inside the edge (marching squares on the outline)
function rivetSolids(sh, D, ctx) {
  const { F, NU, NV, nu, nv, closed } = sh.grid;
  const inset = D.rivetInset ?? 9, gapR = D.rivetGap ?? 26, r = D.rivetSize ?? 2.6;
  const val = (i, j) => F[j * NU + (closed ? ((i % nu) + nu) % nu : i)] - inset;
  const segs = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], fv = c.map(([a, b]) => val(a, b));
    const pts = [];
    for (let e = 0; e < 4; e++) { const a = e, b = (e + 1) % 4; if ((fv[a] >= 0) !== (fv[b] >= 0)) { const t = fv[a] / (fv[a] - fv[b]); pts.push([(c[a][0] + (c[b][0] - c[a][0]) * t) / nu, (c[a][1] + (c[b][1] - c[a][1]) * t) / nv]); } }
    if (pts.length >= 2) segs.push([pts[0], pts[1]]);
    if (pts.length === 4) segs.push([pts[2], pts[3]]);
  }
  // walk the segments in order of length along each, dropping a rivet every gap
  const out = [];
  let acc = gapR / 2;
  const used = new Uint8Array(segs.length);
  const key = (p) => Math.round(p[0] * 1e5) + "," + Math.round(p[1] * 1e5);
  const byEnd = new Map();
  segs.forEach((s, k) => { for (const p of s) { const kk = key(p); if (!byEnd.has(kk)) byEnd.set(kk, []); byEnd.get(kk).push(k); } });
  const place = (u, v) => {
    const B = new THREE.Vector3(), N = new THREE.Vector3(); surfaceAt(sh.desc, u, v, B, N);
    const nd = sh.nodeAt(u, v), S = B.addScaledVector(N, nd.off + nd.th);
    out.push(lathe([[0, -0.8], [r, -0.8], [r, r * 0.15], [r * 0.75, r * 0.5], [r * 0.4, r * 0.66], [0, r * 0.7]], S, N, 10));
  };
  const xyLen = (a, b) => { const [x0, y0] = sh.desc.xy(a[0], a[1]), [x1, y1] = sh.desc.xy(b[0], b[1]); return Math.hypot(x1 - x0, y1 - y0); };
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    let cur = s0, from = segs[s0][0];
    acc = gapR / 2;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      const s = segs[cur], to = key(s[0]) === key(from) ? s[1] : s[0];
      const l = xyLen(from, to);
      if (l < 200) {
        let d = gapR - acc;
        while (d <= l) { const t = d / (l || 1); place(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t); d += gapR; }
        acc = l - (d - gapR);
      }
      from = to;
      cur = (byEnd.get(key(to)) || []).find((k) => !used[k]) ?? -1;
      if (out.length > 400) return out;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------- sculpting maps
export const SCULPT_RES = [128, 96];
function sampleMap(map, u, v, closed) {
  if (!map) return 0;
  const [W, H] = SCULPT_RES;
  const x = u * (closed ? W : W - 1), y = v * (H - 1);
  let i0 = Math.floor(x), j0 = Math.floor(y);
  const fx = x - i0, fy = y - j0;
  const at = (i, j) => { i = closed ? ((i % W) + W) % W : Math.max(0, Math.min(W - 1, i)); j = Math.max(0, Math.min(H - 1, j)); return map[j * W + i]; };
  return (at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx) * (1 - fy) + (at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx) * fy;
}

// ----------------------------------------------------------------------------- form cage
// A cage of control points over the part (like a T-spline form): each point carries a 3D move, and
// the moves are blended smoothly (Catmull-Rom) or straight (creased) across the whole surface.
export function cageUV(form, closed, i, j) { return [closed ? i / form.nu : i / (form.nu - 1), j / (form.nv - 1)]; }
function cr(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }
export function formD(form, u, v, closed, out) {
  const { nu, nv, d } = form, sharp = form.sharp;
  const x = closed ? u * nu : u * (nu - 1), y = v * (nv - 1);
  const i = Math.floor(x), j = Math.min(nv - 2, Math.max(0, Math.floor(y))), tx = x - i, ty = y - j;
  const I = (k) => (closed ? ((k % nu) + nu) % nu : Math.max(0, Math.min(nu - 1, k)));
  const J = (k) => Math.max(0, Math.min(nv - 1, k));
  for (let c = 0; c < 3; c++) {
    const at = (a, b) => d[(J(b) * nu + I(a)) * 3 + c];
    if (sharp) {
      const ii = closed ? i : Math.min(nu - 2, i), fx = closed ? tx : x - ii;
      out[c] = (at(ii, j) * (1 - fx) + at(ii + 1, j) * fx) * (1 - ty) + (at(ii, j + 1) * (1 - fx) + at(ii + 1, j + 1) * fx) * ty;
    } else {
      const ii = closed ? i : Math.min(nu - 2, i), fx = closed ? tx : x - ii;
      const row = (b) => cr(at(ii - 1, b), at(ii, b), at(ii + 1, b), at(ii + 2, b), fx);
      out[c] = cr(row(j - 1), row(j), row(j + 1), row(j + 2), ty);
    }
  }
  return out;
}
export const formUsed = (form) => !!(form && form.d && form.d.some((v) => v !== 0));

// ----------------------------------------------------------------------------- one part
// inst: { tpl, shape, deco, addons, sculpt: { bulge, emboss } }; returns the left (or centre) solids
export function generatePart(inst, B, res = 3) {
  const slot = inst.slot;
  const S = inst.shape || {}, D = { ...(inst.deco || {}) };
  if (D.emblem && D.emblem !== "none") D._poly = shapePoly(D.emblem, D.emblemSize ?? 30);
  const sh0 = SHAPERS[slot](B, S, res);
  const { desc, mask } = sh0;
  desc.basePoint = desc.point;
  if (formUsed(inst.form)) {
    const base = desc.point, fd = [0, 0, 0], F = inst.form, cl = desc.closedU;
    desc.point = (u, v, out) => { base(u, v, out); formD(F, cl ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)), cl, fd); out.x += fd[0]; out.y += fd[1]; out.z += fd[2]; return out; };
  }
  const ctx = { ...sh0.ctx, back: slot === "back", res };
  const closed = desc.closedU;
  const NU = closed ? desc.nu : desc.nu + 1, NV = desc.nv + 1;
  const bulge = inst.sculpt && inst.sculpt.bulge, emboss = inst.sculpt && inst.sculpt.emboss;
  const avoid = inst.noAvoid ? [] : AVOID[slot] || [];
  const bp = new THREE.Vector3();
  const nodeFull = (u, v) => {
    const [x, y] = desc.xy(u, v);
    let f = Math.min(mask(x, y, u, v), desc.border(u, v));
    if (avoid.length && f > -20) { desc.point(u, v, bp); f = Math.min(f, segDistance(B, avoid, bp) - 3); }
    const r = details(x, y, f, D, ctx, res);
    r.off += (sh0.flare ? sh0.flare(u, v, x, y) : 0) + sampleMap(bulge, u, v, closed);
    r.th += sampleMap(emboss, u, v, closed);
    if (r.th < 0.8) r.th = 0.8;
    r.f = f;
    return r;
  };
  const F = new Float32Array(NU * NV), cache = new Map();
  const nodeFn = (u, v) => { const r = nodeFull(u, v); const i = Math.round(u * desc.nu), j = Math.round(v * desc.nv); if (i < NU) F[j * NU + i] = r.f; return r; };
  const shell = buildShell(desc, nodeFn);
  const sh = { desc, grid: { F, NU, NV, nu: desc.nu, nv: desc.nv, closed }, nodeAt: (u, v) => { const k = Math.round(u * 1e4) * 1e5 + Math.round(v * 1e4); let r = cache.get(k); if (!r) { r = nodeFull(u, v); cache.set(k, r); } return r; } };
  const parts = [shell];
  if (D.rivets) parts.push(...rivetSolids(sh, D, ctx));
  for (const a of expandRows(inst.addons)) {
    try { parts.push(...addonSolids(a, sh, ctx)); } catch (e) { /* an add-on off the part is skipped */ }
  }
  const extra = [];
  if (sh0.lens) {
    const lens = buildShell(desc, (u, v) => { const [x, y] = desc.xy(u, v); return { f: Math.min(sh0.lens(x, y), desc.border(u, v), mask(x, y, u, v) + 30), off: -2.1 + sampleMap(bulge, u, v, closed), th: 1.5 }; }, { out: TL.ACCENT, inn: TL.ACCENT, wall: TL.ACCENT });
    if (lens.idx.length) extra.push({ name: "visor lens", solid: weld(lens) });
  }
  // each solid is joined up on its own, so touching add-ons never share corners
  return { solid: merge(parts.map(weld)), shellRender: shell, extra, desc, ctx, sh };
}

// for sculpting: (u, v) under a point on the part's display mesh comes from the shell's uv
export function uvSpan(desc) { const [x0] = desc.xy(0, 0.5), [x1] = desc.xy(1, 0.5), [, y0] = desc.xy(0.5, 0), [, y1] = desc.xy(0.5, 1); return [Math.abs(x1 - x0) || 1, Math.abs(y1 - y0) || 1]; }

// ----------------------------------------------------------------------------- templates
const C = { white: "#e9edf2", slate: "#58626e", cyan: "#39c0ff", steel: "#b9c0c8", gold: "#d4a017", red: "#c8202f", yellow: "#f2c230", blue: "#2f5fb8", brass: "#b48443", copper: "#a55a2a", leather: "#6b4a2a", black: "#2b2b31", lacq: "#8e1f1f", green: "#4d7a3a", purple: "#5b3a8c" };
const t = (id, name, theme, slot, shape, deco, addons, color, accent, set = true) => ({ id, name, theme, slot, shape: shape || {}, deco: { thick: 2.5, ...(deco || {}) }, addons: addons || [], color, accent: accent || color, set });
// a form cage preset: fn(i, j, phi) -> [dx, dy, dz] in body mm (x: wearer's left, y: back, z: up)
const fp = (nu, nv, sharp, fn) => { const d = []; for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) d.push(...fn(i, j)); return { nu, nv, sharp, d }; };
const withForm = (form, x) => { x.form = form; return x; };
// helmets: 12 x 6 cage around the head (i = 6 is the face, j = 0 the crown)
const helmForm = (jaw, cheek, brow, crown = 0) => fp(12, 6, true, (i, j) => {
  const ph = (i / 12 - 0.5) * Math.PI * 2, front = Math.max(0, Math.cos(ph)), side = Math.sin(ph);
  let dx = 0, dy = 0, dz = 0;
  if (j === 5) { dy -= jaw * front ** 3; dz -= jaw * 0.45 * front ** 3; }
  if (j === 4) { dy -= jaw * 0.45 * front ** 3; dx += cheek * side * front; }
  if (j === 2 || j === 3) dy -= brow * front ** 4 * (j === 3 ? 1 : 0.5);
  if (j === 0) dz += crown;
  if (j === 1) dz += crown * 0.5 * (1 - front);
  return [dx, dy, dz];
});
// torso plates: 7 x 6 (i = 3 is the middle, j = 0 the bottom)
const vChest = (keel, point) => fp(7, 6, true, (i, j) => {
  const c = Math.abs(i - 3);
  let dy = c === 0 ? -keel : c === 1 ? -keel * 0.45 : c === 3 ? keel * 0.3 : 0;
  if (j === 5) dy *= 0.3;
  return [0, j === 0 ? dy * 0.5 : dy, j === 0 && c === 0 ? -point : 0];
});
const backForm = (spine) => fp(7, 6, true, (i, j) => [0, Math.abs(i - 3) === 0 && j > 0 && j < 5 ? spine : 0, 0]);
// limbs: 7 x 6 along the limb, i = 3 is the middle of the plate
const ridgeLimb = (out, lateral = true) => fp(7, 6, true, (i, j) => { const c = Math.abs(i - 3), k = c === 0 ? 1 : c === 1 ? 0.35 : 0, m = j === 0 || j === 5 ? 0.4 : 1; return lateral ? [out * k * m, 0, 0] : [0, -out * k * m, 0]; });
const peakDome = (lift) => fp(12, 6, true, (i, j) => [0, 0, j === 0 ? lift : j === 1 ? lift * 0.4 : 0]);
function modernSet() {
  const G = "#2d3138", W = "#eef1f4", R = "#b8202b", N = "#1f2f4a", O = "#ff7a1a", T = "#2ad1c9", B = "#3aa0ff", L = "#8be04e", P = "#7b4fd6", Y = "#ffc93c", S = "#9aa3ad";
  const glow = { lines: "panels", lineGap: 9, lineDepth: 0.9, glow: true, edge: "trim", edgeSize: 4, edgeH: 1.2 };
  const M = "modern";
  return [
    withForm(helmForm(14, 6, 6, 4), t("vanguard-helm", "Vanguard Helm", M, "helmet", { face: "bigvisor", faceW: 128, faceH: 44, brow: 72, lens: true, depth: 122, back: 12, round: 0.2 }, { ...glow, ridge: 3, ridgeW: 9, ridgeSharp: true }, [{ k: "fin", path: "sagittal", from: "brow-30", to: "brow+20", h: 10, profile: "blade", w: 6 }], G, O)),
    withForm(helmForm(10, 10, 3), t("interceptor-helm", "Interceptor Helm", M, "helmet", { face: "visor", faceW: 150, faceH: 22, brow: 76, lens: true, depth: 126, back: 14, round: 0.1, tall: 1.03 }, { ...glow, lineGap: 7 }, [{ k: "fin", x: 74, y: "brow+28", len: 70, h: 16, profile: "shark", w: 4, mirror: true }], W, T, false)),
    withForm(helmForm(6, 4, 8, 6), t("sentinel-helm", "Sentinel Helm", M, "helmet", { face: "eyes", faceW: 130, brow: 80, lens: true, depth: 128, back: 10, round: 0.35 }, { ...glow, ridge: 2.5, ridgeW: 14 }, [], N, B, false)),
    withForm(helmForm(8, 3, 2, 10), t("strike-helm", "Strike Team Helm", M, "helmet", { face: "bigvisor", faceW: 118, faceH: 58, brow: 70, lens: true, depth: 124, back: 8, round: 0.6 }, { edge: "trim", edgeSize: 5, edgeH: 1.6, emblem: "crest", emblemSize: 22, emblemH: 2, emblemGlow: true }, [{ k: "plate", x: 0, y: "brow-34", shape: "diamond", size: 22, w: 3, accent: true }], P, Y, false)),
    withForm(helmForm(0, 0, 5, 0), t("night-cowl", "Night Watch Cowl", M, "helmet", { face: "cowl", faceW: 120, faceH: 44, brow: 74, depth: 118, back: 8, gap: 6 }, { thick: 2.2, edge: "bevel", edgeSize: 3, lines: "chevron", lineGap: 14, lineDepth: 0.6 }, [{ k: "fin", x: 40, y: "brow-36", len: 60, h: 8, profile: "blade", w: 4, mirror: true }], "#262a33", "#c9a227", false)),
    t("pilot-helm", "Flight Helmet", M, "helmet", { face: "open", faceW: 140, brow: 64, depth: 110, back: 16, round: 0.3, gap: 14 }, { ...glow, lineGap: 12 }, [{ k: "plate", x: 0, y: "brow+6", shape: "crescent", size: 70, w: 2, lift: 4, accent: true }, { k: "gauge", x: 98, y: "brow+40", size: 16, mirror: true }], W, R, false),
    withForm(vChest(14, 18), t("vanguard-chest", "Vanguard Chest", M, "chest", { bottom: "v", vd: 40, side: 102 }, { ...glow, emblem: "hex", emblemSize: 18, emblemH: 2, emblemGlow: true }, [], G, O)),
    withForm(backForm(6), t("vanguard-back", "Vanguard Back", M, "back", {}, { ...glow, ridge: 3, ridgeW: 12, ridgeSharp: true }, [{ k: "thruster", x: 50, y: "chest-50", size: 15, mirror: true }], G, O)),
    withForm(vChest(8, 10), t("core-chest", "Hex Core Chest", M, "chest", { bottom: "arch", vd: 30, side: 104 }, { ...glow, lineGap: 11, muscle: 0.35, emblem: "hex", emblemSize: 26, emblemH: 3, emblemGlow: true, emblemDY: 20 }, [], N, B, false)),
    withForm(vChest(6, 0), t("tactical-rig", "Tactical Chest Rig", M, "chest", { bottom: "straight", side: 96 }, { lines: "grid", lineGap: 22, lineDepth: 0.8, edge: "trim", edgeSize: 5 }, [{ k: "box", x: 50, y: "waist+50", size: 22, w: 40, len: 60, h: 26, count: 2, rowAcross: true, step: 48, mirror: true }], "#3c4234", "#c46a2b", false)),
    withForm(peakDome(10), t("vanguard-pauldron", "Vanguard Pauldron", M, "pauldron", { shape: "tower", drop: 1.1, size: 1.1 }, { ...glow, tex: "lames", texSize: 26, texDepth: 2 }, [], G, O)),
    withForm(peakDome(14), t("strike-pauldron", "Strike Pauldron", M, "pauldron", { shape: "shield" }, { ...glow }, [{ k: "fin", x: 0, y: "mid", len: 70, h: 18, profile: "shark", w: 4 }], W, T, false)),
    withForm(ridgeLimb(6), t("vanguard-upper", "Vanguard Arm Guard", M, "upperarm", { from: 0.32, to: 0.88, cover: 220 }, { ...glow }, [], G, O)),
    withForm(ridgeLimb(6), t("vanguard-bracer", "Vanguard Bracer", M, "bracer", { from: 0.06, to: 0.94, cover: 300, flareTop: 10 }, { ...glow }, [{ k: "gem", x: 0, y: "L*0.75", size: 8 }], G, O)),
    withForm(ridgeLimb(5), t("pulse-gauntlet", "Pulse Gauntlet", M, "bracer", { from: 0.02, to: 0.97, cover: 310, flareTop: 18 }, { ...glow, lineGap: 7, tex: "hex", texSize: 8, texDepth: 0.8 }, [{ k: "gem", x: 0, y: "L*0.82", size: 10 }, { k: "gem", x: 0, y: "L*0.5", size: 6, count: 3, step: 18 }], R, Y, false)),
    t("vanguard-hand", "Vanguard Hand Plate", M, "handplate", {}, { ...glow, lineGap: 5 }, [{ k: "gem", x: 0, y: 0, size: 7 }], G, O),
    withForm(ridgeLimb(7, false), t("vanguard-thigh", "Vanguard Thigh Plate", M, "thigh", { cover: 170 }, { ...glow }, [], G, O)),
    t("vanguard-knee", "Vanguard Knee", M, "knee", { wings: 1, fan: 1 }, { ...glow, lineGap: 7 }, [], G, O),
    withForm(ridgeLimb(8, false), t("vanguard-greave", "Vanguard Greave", M, "greave", { cover: 230, point: 40, flareBot: 8 }, { ...glow }, [], G, O)),
    t("vanguard-boot", "Vanguard Boot", M, "boot", { cover: 310 }, { ...glow, lineGap: 8 }, [], G, O),
    t("vanguard-toe", "Vanguard Toe Cap", M, "toe", {}, { ...glow, lineGap: 6 }, [], G, O),
    t("vanguard-collar", "Vanguard Collar", M, "gorget", { spread: 1.1, cover: 320 }, { ...glow, tex: "lames", texSize: 12, texDepth: 1.4 }, [], G, O),
    t("vanguard-belt", "Vanguard Belt", M, "belt", { height: 52, buckle: 76 }, { ...glow, emblem: "hex", emblemSize: 18, emblemH: 2, emblemGlow: true }, [{ k: "box", x: 95, y: "mid", size: 20, mirror: true }], G, O),
    withForm(fp(7, 6, true, (i, j) => [0, 0, 0]), t("vanguard-tassets", "Vanguard Hip Plates", M, "tasset", { plates: 2, len: 170, cover: 150, split: 40 }, { ...glow, tex: "lames", texSize: 34, texDepth: 2 }, [], G, O)),
    t("energy-shield", "Energy Shield", M, "shield", { shape: "hex", size: 480, curve: 900 }, { tex: "hex", texSize: 34, texDepth: 1.2, lines: "inset", lineGap: 14, glow: true, edge: "trim", edgeSize: 10, edgeH: 2, thick: 3 }, [{ k: "gem", x: 0, y: 0, size: 18 }], N, T, false),
    t("jetpack-mk2", "Jet Pack Mk II", M, "back", { side: 70, drop: -110, top: 0.97 }, { ...glow }, [{ k: "thruster", x: 64, y: "L*0.22", size: 28, mirror: true }, { k: "box", x: 0, y: "L*0.55", size: 36, w: 96, len: 120, h: 44 }, { k: "fin", x: 64, y: "L*0.55", len: 90, h: 22, profile: "shark", w: 4, mirror: true }], W, B, false),
    withForm(helmForm(4, 8, 2), t("visor-mask", "Visor Mask", M, "mask", { style: "half" }, { thick: 2.2, lines: "inset", lineGap: 5, glow: true, edge: "bevel", edgeSize: 2 }, [], S, L, false)),
  ].map((x) => { if (x.form && x.slot === "mask") delete x.form; return x; });
}
// Military (v2.7.8): field armor and gear in olive, tan and ranger green. Protective gear only: no
// firearms or other weapons anywhere in CosForge.
function militarySet() {
  const OD = "#5b6236", TAN = "#a08560", RG = "#4b5a3a", BK = "#2b2d2f", GR = "#6c7076", WEB = "#3b3f2a", FL = "#e0b13a";
  const mil = { lines: "grid", lineGap: 20, lineDepth: 0.7, edge: "trim", edgeSize: 4, edgeH: 1.2 };
  const X = "military";
  return [
    withForm(helmForm(0, 4, 3, 6), t("mil-helm", "Combat Helmet", X, "helmet", { face: "open", faceW: 150, brow: 62, depth: 112, back: 8, round: 0.75, gap: 18 }, { edge: "roll", edgeSize: 5, edgeH: 1.4, tex: "quilt", texSize: 30, texDepth: 0.6 }, [{ k: "box", x: 0, y: "brow+14", size: 14, w: 30, len: 24, h: 12 }, { k: "box", x: 84, y: "brow+30", size: 10, w: 14, len: 60, h: 8, mirror: true }], OD, WEB)),
    withForm(helmForm(6, 4, 6, 4), t("mil-helm-visor", "Riot Helmet (visor)", X, "helmet", { face: "bigvisor", faceW: 170, faceH: 80, brow: 64, lens: true, depth: 120, back: 10, round: 0.6 }, { edge: "trim", edgeSize: 5, edgeH: 1.4, lines: "inset", lineGap: 12 }, [], BK, GR, false)),
    withForm(helmForm(0, 2, 2, 4), t("mil-pilot", "Jet Pilot Helmet", X, "helmet", { face: "visor", faceW: 156, faceH: 34, brow: 72, lens: true, depth: 116, back: 14, round: 0.55 }, { edge: "trim", edgeSize: 4, emblem: "star", emblemSize: 18, emblemH: 1.5 }, [{ k: "box", x: 70, y: "brow+40", size: 12, w: 22, len: 36, h: 10, mirror: true }], GR, FL, false)),
    t("mil-respirator", "Field Respirator", X, "mask", { style: "lower" }, { thick: 2.4, lines: "hbands", lineGap: 9, edge: "roll", edgeSize: 4 }, [{ k: "gauge", x: 46, y: "mid", size: 22, mirror: true }], BK, OD),
    t("mil-collar", "Neck Guard", X, "gorget", { spread: 1.05, cover: 260 }, { ...mil, tex: "quilt", texSize: 20, texDepth: 0.8 }, [], OD, WEB),
    withForm(vChest(4, 0), t("mil-carrier", "Plate Carrier", X, "chest", { bottom: "straight", side: 100 }, { ...mil }, [{ k: "box", x: 0, y: "waist+48", size: 22, w: 44, len: 66, h: 24, count: 3, rowAcross: true, step: 50 }, { k: "box", x: 70, y: "chest-20", size: 14, w: 30, len: 40, h: 14, mirror: true }], TAN, WEB)),
    withForm(vChest(4, 0), t("mil-carrier-od", "Plate Carrier (olive)", X, "chest", { bottom: "straight", side: 100 }, { ...mil }, [{ k: "box", x: 0, y: "waist+48", size: 22, w: 44, len: 66, h: 24, count: 3, rowAcross: true, step: 50 }, { k: "gem", x: 0, y: "chest-10", size: 10 }], OD, WEB, false)),
    withForm(backForm(3), t("mil-back", "Carrier Back Panel", X, "back", { bottom: "straight" }, { ...mil }, [{ k: "box", x: 0, y: "L*0.5", size: 30, w: 110, len: 170, h: 34 }], TAN, WEB)),
    t("mil-belt", "Duty Belt", X, "belt", { height: 50, buckle: 64 }, { lines: "vbands", lineGap: 24, edge: "trim", edgeSize: 3 }, [{ k: "box", x: 60, y: "mid", size: 18, w: 34, len: 44, h: 22, mirror: true }, { k: "box", x: 120, y: "mid", size: 16, w: 28, len: 40, h: 20, mirror: true }], WEB, TAN),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("mil-tassets", "Groin & Hip Guards", X, "tasset", { plates: 3, len: 150, cover: 200, split: 18 }, { ...mil, tex: "quilt", texSize: 22, texDepth: 0.8 }, [], OD, WEB)),
    withForm(peakDome(6), t("mil-pauldron", "Shoulder Guard", X, "pauldron", { shape: "shield", size: 1 }, { ...mil, tex: "quilt", texSize: 22, texDepth: 0.8 }, [{ k: "box", x: 0, y: "mid", size: 8, w: 40, len: 30, h: 4 }], OD, WEB)),
    withForm(ridgeLimb(3), t("mil-upper", "Upper Arm Guard", X, "upperarm", { from: 0.35, to: 0.85, cover: 220 }, { ...mil }, [], OD, WEB)),
    withForm(ridgeLimb(4), t("mil-bracer", "Forearm Guard", X, "bracer", { from: 0.08, to: 0.9, cover: 280, flareTop: 6 }, { ...mil }, [{ k: "box", x: 0, y: "L*0.5", size: 10, w: 34, len: 28, h: 8 }], OD, WEB)),
    t("mil-hand", "Knuckle Guard", X, "handplate", {}, { edge: "roll", edgeSize: 3, lines: "vbands", lineGap: 12 }, [], BK, OD),
    withForm(ridgeLimb(4, false), t("mil-thigh", "Thigh Rig", X, "thigh", { cover: 160 }, { ...mil }, [{ k: "box", x: 0, y: "L*0.5", size: 18, w: 50, len: 60, h: 20 }], TAN, WEB)),
    t("mil-knee", "Knee Pad", X, "knee", { wings: 1 }, { edge: "roll", edgeSize: 4, edgeH: 1.5, tex: "quilt", texSize: 14, texDepth: 0.8 }, [], BK, OD),
    withForm(ridgeLimb(5, false), t("mil-greave", "Shin Guard", X, "greave", { cover: 220, point: 20, flareBot: 4 }, { ...mil }, [], OD, WEB)),
    t("mil-boot", "Combat Boot Cover", X, "boot", { cover: 300 }, { lines: "hbands", lineGap: 12, edge: "roll", edgeSize: 4 }, [], BK, TAN),
    t("mil-toe", "Boot Toe Cap", X, "toe", {}, { edge: "roll", edgeSize: 3 }, [], BK, TAN),
    t("mil-shield", "Riot Shield (field)", X, "shield", { shape: "tower", size: 600, curve: 1000, gap: 24 }, { lines: "inset", lineGap: 20, edge: "trim", edgeSize: 12, edgeH: 2, thick: 3 }, [], BK, GR, false),
  ];
}
// more Sci-Fi (v2.7.8): original designs, armor and gear only
function moreScifi() {
  const W = "#e8ecf1", G = "#3a4049", A = "#ff8a1f", Cy = "#39c0ff", V = "#8f5cf0", R = "#c8202f", Gn = "#5fd38a", S = "#9aa3ad";
  const tech = { lines: "panels", lineGap: 10, lineDepth: 0.9, glow: true, edge: "trim", edgeSize: 4, edgeH: 1.3 };
  const X = "scifi";
  return [
    withForm(helmForm(10, 8, 5, 2), t("star-marine-helm", "Star Marine Helm", X, "helmet", { face: "bigvisor", faceW: 136, faceH: 46, brow: 70, lens: true, depth: 126, back: 14, round: 0.25 }, { ...tech, ridge: 3, ridgeW: 10 }, [{ k: "antenna", x: 88, y: "brow+12", len: 50 }, { k: "box", x: 80, y: "brow+34", size: 10, w: 16, len: 34, h: 10, mirror: true }], G, A, false)),
    withForm(helmForm(12, 10, 6, 0), t("void-trooper-helm", "Void Trooper Helm", X, "helmet", { face: "eyes", faceW: 128, brow: 78, lens: true, depth: 124, back: 12, round: 0.4 }, { ...tech, lines: "chevron", lineGap: 12 }, [{ k: "fin", x: 0, y: "brow-6", len: 80, h: 14, profile: "shark", w: 4 }], W, V, false)),
    withForm(helmForm(4, 4, 2, 6), t("mech-pilot-helm", "Mech Pilot Helm", X, "helmet", { face: "visor", faceW: 150, faceH: 30, brow: 74, lens: true, depth: 120, back: 16, round: 0.45 }, { ...tech }, [{ k: "goggles", x: 0, y: "brow+40", size: 16 }, { k: "antenna", x: 90, y: "brow+6", len: 36, mirror: true }], S, Cy, false)),
    t("cyber-visor", "Cyber Visor", X, "mask", { style: "half" }, { thick: 2.2, lines: "inset", lineGap: 4, glow: true, edge: "bevel", edgeSize: 2 }, [], G, Gn, false),
    t("comms-collar", "Comms Collar", X, "gorget", { spread: 1.1 }, { ...tech, lines: "hbands", lineGap: 8 }, [{ k: "antenna", x: 70, y: "mid", len: 70 }], G, A, false),
    withForm(vChest(12, 14), t("exo-chest", "Exo-Suit Chest", X, "chest", { bottom: "v", vd: 46, side: 104 }, { ...tech, emblem: "hex", emblemSize: 22, emblemH: 2, emblemGlow: true }, [{ k: "gauge", x: 64, y: "chest-24", size: 18, mirror: true }], W, A, false)),
    withForm(vChest(6, 0), t("reactor-chest", "Reactor Core Chest", X, "chest", { bottom: "arch", vd: 30, side: 102 }, { ...tech, emblem: "gear", emblemSize: 30, emblemH: 3, emblemGlow: true, emblemDY: 16 }, [], G, Cy, false)),
    withForm(backForm(5), t("hover-pack", "Hover Pack", X, "back", { side: 70, drop: -100, top: 0.97 }, { ...tech }, [{ k: "thruster", x: 58, y: "L*0.3", size: 24, mirror: true }, { k: "thruster", x: 0, y: "L*0.62", size: 18 }, { k: "fin", x: 70, y: "L*0.55", len: 70, h: 18, profile: "shark", w: 4, mirror: true }], G, A, false)),
    t("tech-belt", "Tech Belt", X, "belt", { height: 50, buckle: 70 }, { ...tech, emblem: "hex", emblemSize: 16, emblemH: 2, emblemGlow: true }, [{ k: "box", x: 80, y: "mid", size: 16, w: 30, len: 36, h: 18, mirror: true }], G, Cy, false),
    withForm(peakDome(12), t("lamp-pauldron", "Lamp Pauldron", X, "pauldron", { shape: "tower", drop: 1.05 }, { ...tech, tex: "lames", texSize: 22, texDepth: 1.6 }, [{ k: "gauge", x: 0, y: "mid", size: 16 }], W, Cy, false)),
    withForm(ridgeLimb(6), t("holo-bracer", "Holo Bracer", X, "bracer", { from: 0.06, to: 0.94, cover: 300, flareTop: 10 }, { ...tech }, [{ k: "gem", x: 0, y: "L*0.5", size: 12 }, { k: "box", x: 0, y: "L*0.78", size: 6, w: 40, len: 26, h: 6 }], G, Gn, false)),
    withForm(ridgeLimb(7, false), t("exo-thigh", "Exo Thigh Plate", X, "thigh", { cover: 170 }, { ...tech, ridge: 2.5, ridgeW: 10 }, [], W, A, false)),
    t("servo-knee", "Servo Knee", X, "knee", { wings: 1, fan: 1 }, { ...tech, lineGap: 7 }, [{ k: "gauge", x: 0, y: "mid", size: 12 }], G, A, false),
    withForm(ridgeLimb(8, false), t("exo-greave", "Exo Greave", X, "greave", { cover: 230, point: 30, flareBot: 8 }, { ...tech }, [], W, A, false)),
    t("grav-boot", "Grav Boot", X, "boot", { cover: 310 }, { ...tech, lineGap: 8 }, [{ k: "thruster", x: 0, y: "L*0.85", size: 14 }], G, Cy, false),
    t("hardlight-shield", "Hard-Light Shield", X, "shield", { shape: "round", size: 460, curve: 800 }, { tex: "hex", texSize: 28, texDepth: 1.2, glow: true, edge: "trim", edgeSize: 10, edgeH: 2, thick: 3 }, [{ k: "boss", x: 0, y: 0, size: 60 }], G, V, false),
  ];
}
// Traditional armor (v2.7.9): full suits, each slot covered, so "Add the whole set" dresses the
// whole body, with detailed helmets (visors, crests, cheek guards, neck guards, rivets).
function historicSets() {
  const ST = "#b9c0c8", DS = "#7d848c", BR = "#b07a3a", BZ = "#a8743a", LE = "#6b4a2a", RD = "#8e1f1f", GD = "#d4a017", WH = "#e9edf2", IR = "#5e6268";
  const plate = { edge: "roll", edgeSize: 5, edgeH: 1.8, rivets: true, rivetInset: 7, rivetGap: 22 };
  const lames = (size = 22) => ({ ...plate, tex: "lames", texSize: size, texDepth: 2.2 });
  const M = "medieval", R = "roman", G = "greek", N = "norse";
  return [
    // ---- Medieval plate: a full harness
    withForm(helmForm(8, 6, 6, 4), t("med-close", "Close Helm", M, "helmet", { face: "slit", faceW: 120, brow: 74, depth: 126, back: 12, round: 0.3 }, { ...plate, ridge: 3, ridgeW: 10, ridgeSharp: true, lines: "inset", lineGap: 14 }, [{ k: "fin", path: "sagittal", from: "brow-40", to: "brow+40", h: 12, profile: "rounded", w: 4 }, { k: "boss", x: 64, y: "brow+22", size: 8, mirror: true }], ST, GD)),
    withForm(helmForm(2, 2, 4, 0), t("med-great", "Great Helm", M, "helmet", { face: "slit", faceW: 130, brow: 70, depth: 128, back: 20, round: 0.05, tall: 1.08 }, { ...plate, lines: "vbands", lineGap: 40, lineDepth: 1 }, [{ k: "plate", x: 0, y: "brow+34", shape: "cross", size: 30, w: 2, accent: true }], ST, GD, false)),
    withForm(helmForm(10, 4, 2, 22), t("med-bascinet", "Bascinet with Visor", M, "helmet", { face: "visor", faceW: 126, faceH: 16, brow: 76, depth: 124, back: 14, round: 0.2, tall: 1.06 }, { ...plate, ridge: 3, ridgeW: 8, ridgeSharp: true, lines: "chevron", lineGap: 10, lineDepth: 0.8 }, [{ k: "fin", path: "sagittal", from: "brow-10", to: "brow+60", h: 8, profile: "shark", w: 4 }, { k: "gem", x: 0, y: "brow+40", size: 4, count: 5, rowAcross: true, step: 12 }], ST, GD, false)),
    withForm(helmForm(0, 4, 2, 6), t("med-sallet", "Sallet", M, "helmet", { face: "visor", faceW: 140, faceH: 14, brow: 72, depth: 118, back: 40, round: 0.5 }, { ...plate, ridge: 2.5, ridgeW: 12 }, [{ k: "fin", path: "sagittal", from: "brow-30", to: "brow+70", h: 9, profile: "rounded", w: 4 }], DS, GD, false)),
    withForm(helmForm(4, 8, 4, 4), t("med-barbute", "Barbute", M, "helmet", { face: "tvisor", faceW: 110, brow: 70, depth: 122, back: 12, round: 0.45 }, { ...plate, ridge: 2.5, ridgeW: 10, ridgeSharp: true }, [], ST, GD, false)),
    withForm(helmForm(6, 4, 6, 10), t("med-armet", "Armet with Plume", M, "helmet", { face: "slit", faceW: 116, brow: 72, depth: 124, back: 12, round: 0.25 }, { ...plate, ridge: 3, ridgeW: 8 }, [{ k: "fin", path: "sagittal", from: "brow+20", to: "brow+80", h: 60, profile: "mohawk", w: 14, accent: true }], ST, RD, false)),
    t("med-bevor", "Bevor (chin guard)", M, "mask", { style: "lower" }, { ...plate, tex: "lames", texSize: 14, texDepth: 1.6 }, [], ST, GD, false),
    t("med-gorget", "Plate Gorget", M, "gorget", { spread: 1.2, cover: 280 }, lames(14), [], ST, GD),
    withForm(vChest(12, 6), t("med-breast", "Breastplate", M, "chest", { bottom: "arch", vd: 26, side: 104 }, { ...plate, ridge: 3, ridgeW: 14, ridgeSharp: true, emblem: "crest", emblemSize: 30, emblemH: 1.6 }, [], ST, GD)),
    withForm(backForm(5), t("med-back", "Backplate", M, "back", { bottom: "straight" }, { ...plate, ridge: 2.5, ridgeW: 10 }, [], ST, GD)),
    t("med-fauld", "Fauld (waist lames)", M, "belt", { height: 70 }, lames(16), [{ k: "gem", x: 0, y: "mid", size: 8 }], ST, GD),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("med-tassets", "Tassets", M, "tasset", { plates: 2, len: 200, cover: 180, split: 30 }, lames(24), [], ST, GD)),
    withForm(peakDome(10), t("med-pauldron", "Layered Pauldron", M, "pauldron", { shape: "tower", drop: 1.2, size: 1.1 }, lames(18), [{ k: "fin", x: 0, y: "mid-20", len: 70, h: 14, profile: "rounded", w: 4 }], ST, GD)),
    withForm(ridgeLimb(3), t("med-rerebrace", "Rerebrace", M, "upperarm", { from: 0.32, to: 0.88, cover: 240 }, plate, [], ST, GD)),
    withForm(ridgeLimb(4), t("med-vambrace", "Vambrace", M, "bracer", { from: 0.04, to: 0.92, cover: 300, flareTop: 14 }, { ...plate, ridge: 2, ridgeW: 8 }, [], ST, GD)),
    t("med-gauntlet", "Gauntlet Plate", M, "handplate", {}, lames(9), [{ k: "spike", x: 0, y: "mid", size: 4, len: 8, count: 4, rowAcross: true, step: 14 }], ST, GD),
    withForm(ridgeLimb(5, false), t("med-cuisse", "Cuisse", M, "thigh", { cover: 180 }, { ...plate, ridge: 2.5, ridgeW: 10 }, [], ST, GD)),
    t("med-poleyn", "Poleyn (knee)", M, "knee", { wings: 1, fan: 1 }, { ...plate, ridge: 2, ridgeW: 8 }, [{ k: "boss", x: 0, y: "mid", size: 10 }], ST, GD),
    withForm(ridgeLimb(6, false), t("med-greave", "Greave", M, "greave", { cover: 240, point: 30, flareBot: 6 }, { ...plate, ridge: 2.5, ridgeW: 10 }, [], ST, GD)),
    t("med-sabaton", "Sabaton", M, "boot", { cover: 300 }, lames(14), [], ST, GD),
    t("med-toe", "Sabaton Toe", M, "toe", {}, lames(10), [], ST, GD),
    t("med-heater", "Heater Shield", M, "shield", { shape: "heater", size: 520, curve: 900 }, { edge: "trim", edgeSize: 14, edgeH: 2, thick: 3, emblem: "crest", emblemSize: 150, emblemH: 2 }, [], WH, RD),
    t("med-kite", "Kite Shield", M, "shield", { shape: "kite", size: 600, curve: 800 }, { edge: "trim", edgeSize: 12, edgeH: 2, thick: 3, rivets: true, rivetInset: 10, rivetGap: 30 }, [{ k: "boss", x: 0, y: -60, size: 40 }], RD, GD, false),
    // ---- Roman legion
    withForm(helmForm(0, 16, 2, 4), t("rom-galea", "Galea (legionary helmet)", R, "helmet", { face: "open", faceW: 120, brow: 66, depth: 112, back: 42, round: 0.5, gap: 12 }, { edge: "roll", edgeSize: 6, edgeH: 2, rivets: true, rivetInset: 6, rivetGap: 18, ridge: 2, ridgeW: 10 }, [{ k: "plate", x: 0, y: "brow-8", shape: "crescent", size: 70, w: 3, accent: true }, { k: "boss", x: 74, y: "brow+30", size: 7, mirror: true }, { k: "fin", path: "sagittal", from: "brow-10", to: "brow+60", h: 40, profile: "mohawk", w: 12, accent: true }], DS, RD)),
    withForm(helmForm(0, 16, 2, 4), t("rom-centurion", "Centurion Helmet", R, "helmet", { face: "open", faceW: 120, brow: 66, depth: 112, back: 42, round: 0.5, gap: 12 }, { edge: "roll", edgeSize: 6, edgeH: 2, rivets: true, rivetInset: 6, rivetGap: 18 }, [{ k: "fin", y: "brow+40", x: 0, across: true, len: 220, h: 50, profile: "rounded", w: 14, accent: true }], BR, RD, false)),
    t("rom-focale", "Neck Scarf Guard", R, "gorget", { spread: 1, cover: 240 }, { edge: "roll", edgeSize: 4, tex: "quilt", texSize: 18, texDepth: 0.6 }, [], RD, GD),
    withForm(vChest(4, 0), t("rom-segmentata", "Lorica Segmentata", R, "chest", { bottom: "straight", side: 106 }, { tex: "lames", texSize: 26, texDepth: 2.6, edge: "roll", edgeSize: 4, edgeH: 1.6, rivets: true, rivetInset: 6, rivetGap: 30 }, [{ k: "boss", x: 50, y: "chest-20", size: 6, mirror: true }], DS, BR)),
    withForm(backForm(3), t("rom-back", "Segmentata Back", R, "back", { bottom: "straight" }, { tex: "lames", texSize: 26, texDepth: 2.6, edge: "roll", edgeSize: 4, edgeH: 1.6 }, [], DS, BR)),
    t("rom-cingulum", "Cingulum Belt", R, "belt", { height: 48, buckle: 50 }, { edge: "trim", edgeSize: 3, emblem: "star", emblemSize: 14, emblemH: 1.5 }, [{ k: "gem", x: 30, y: "mid", size: 5, count: 6, rowAcross: true, step: 26, mirror: true }], LE, BR),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("rom-pteruges", "Pteruges (leather strips)", R, "tasset", { plates: 7, len: 180, cover: 280, split: 6 }, { edge: "trim", edgeSize: 3, lines: "vbands", lineGap: 14, lineDepth: 0.8 }, [], LE, BR)),
    withForm(peakDome(4), t("rom-shoulder", "Segmented Shoulder", R, "pauldron", { shape: "tower", drop: 1.15 }, { tex: "lames", texSize: 18, texDepth: 2.2, edge: "roll", edgeSize: 4, rivets: true, rivetInset: 5, rivetGap: 24 }, [], DS, BR)),
    withForm(ridgeLimb(2), t("rom-upper", "Upper Arm Lames", R, "upperarm", { from: 0.32, to: 0.85, cover: 230 }, { tex: "lames", texSize: 16, texDepth: 2, edge: "roll", edgeSize: 3 }, [], DS, BR)),
    withForm(ridgeLimb(2), t("rom-manica", "Manica (arm guard)", R, "bracer", { from: 0.04, to: 0.92, cover: 300, flareTop: 10 }, { tex: "lames", texSize: 14, texDepth: 2, edge: "roll", edgeSize: 3 }, [], DS, BR)),
    t("rom-hand", "Hand Guard", R, "handplate", {}, { edge: "roll", edgeSize: 3, tex: "lames", texSize: 10, texDepth: 1.4 }, [], DS, BR),
    withForm(ridgeLimb(2, false), t("rom-thigh", "Thigh Guard", R, "thigh", { cover: 150 }, { edge: "roll", edgeSize: 4, lines: "hbands", lineGap: 20 }, [], LE, BR)),
    t("rom-knee", "Knee Guard", R, "knee", { wings: 1 }, { edge: "roll", edgeSize: 4 }, [], BR, BR),
    withForm(ridgeLimb(4, false), t("rom-ocrea", "Ocrea (greave)", R, "greave", { cover: 230, point: 20, flareBot: 4 }, { edge: "roll", edgeSize: 5, ridge: 2, ridgeW: 10 }, [], BR, GD),
    ),
    t("rom-caligae", "Caligae (sandal boots)", R, "boot", { cover: 280 }, { lines: "vbands", lineGap: 16, lineDepth: 1, edge: "trim", edgeSize: 3 }, [], LE, BR),
    t("rom-toe", "Sandal Toe", R, "toe", {}, { lines: "hbands", lineGap: 10, edge: "trim", edgeSize: 2 }, [], LE, BR),
    t("rom-scutum", "Scutum (curved shield)", R, "shield", { shape: "tower", size: 640, curve: 520, gap: 24 }, { edge: "trim", edgeSize: 14, edgeH: 2, thick: 3, emblem: "bolt", emblemSize: 120, emblemH: 2, lines: "inset", lineGap: 40 }, [{ k: "boss", x: 0, y: 0, size: 50 }], RD, GD),
    // ---- Ancient Greek (bronze)
    withForm(helmForm(12, 10, 6, 4), t("grk-corinthian", "Corinthian Helmet", G, "helmet", { face: "tvisor", faceW: 116, brow: 72, depth: 124, back: 14, round: 0.35 }, { edge: "roll", edgeSize: 5, edgeH: 1.6, lines: "inset", lineGap: 10, lineDepth: 0.8 }, [{ k: "fin", path: "sagittal", from: "brow-30", to: "brow+80", h: 50, profile: "mohawk", w: 16, accent: true }], BZ, RD)),
    withForm(helmForm(0, 12, 4, 4), t("grk-attic", "Attic Helmet", G, "helmet", { face: "open", faceW: 126, brow: 68, depth: 116, back: 24, round: 0.45, gap: 12 }, { edge: "roll", edgeSize: 5, edgeH: 1.6, emblem: "star", emblemSize: 14, emblemH: 1.4 }, [{ k: "plate", x: 0, y: "brow-10", shape: "crescent", size: 60, w: 2, accent: true }, { k: "fin", path: "sagittal", from: "brow-10", to: "brow+60", h: 34, profile: "rounded", w: 12, accent: true }], BZ, GD, false)),
    withForm(helmForm(0, 8, 4, 2), t("grk-chalcidian", "Chalcidian Helmet", G, "helmet", { face: "eyes", faceW: 126, brow: 74, depth: 118, back: 18, round: 0.4 }, { edge: "roll", edgeSize: 5, edgeH: 1.6, ridge: 2, ridgeW: 10 }, [{ k: "horn", x: 60, y: "brow+20", size: 6, len: 40, curl: 40, tilt: 20, mirror: true }], BZ, GD, false)),
    t("grk-gorget", "Bronze Collar", G, "gorget", { spread: 1.1 }, { edge: "roll", edgeSize: 4, lines: "hbands", lineGap: 12 }, [], BZ, GD),
    withForm(vChest(6, 10), t("grk-cuirass", "Muscle Cuirass", G, "chest", { bottom: "arch", vd: 34, side: 104, neck: 66 }, { muscle: 1, edge: "roll", edgeSize: 5, edgeH: 1.8 }, [], BZ, GD)),
    withForm(backForm(4), t("grk-back", "Cuirass Back", G, "back", {}, { muscle: 0.5, edge: "roll", edgeSize: 5, edgeH: 1.8 }, [], BZ, GD)),
    t("grk-belt", "Zoma Belt", G, "belt", { height: 40 }, { edge: "roll", edgeSize: 3, lines: "chevron", lineGap: 14 }, [], BZ, GD),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("grk-pteruges", "Linen Pteruges", G, "tasset", { plates: 8, len: 170, cover: 290, split: 5 }, { edge: "trim", edgeSize: 3 }, [], WH, RD)),
    withForm(peakDome(6), t("grk-shoulder", "Shoulder Flap", G, "pauldron", { shape: "shield" }, { edge: "roll", edgeSize: 4, emblem: "star", emblemSize: 16, emblemH: 1.4 }, [], WH, RD)),
    withForm(ridgeLimb(2), t("grk-upper", "Upper Arm Guard", G, "upperarm", { from: 0.35, to: 0.85, cover: 200 }, { edge: "roll", edgeSize: 4 }, [], BZ, GD)),
    withForm(ridgeLimb(3), t("grk-bracer", "Bronze Bracer", G, "bracer", { from: 0.1, to: 0.9, cover: 280, flareTop: 8 }, { edge: "roll", edgeSize: 4, muscle: 0.4 }, [], BZ, GD)),
    t("grk-hand", "Bronze Hand Plate", G, "handplate", {}, { edge: "roll", edgeSize: 3 }, [], BZ, GD),
    withForm(ridgeLimb(3, false), t("grk-thigh", "Thigh Guard", G, "thigh", { cover: 150 }, { edge: "roll", edgeSize: 4, muscle: 0.4 }, [], BZ, GD)),
    t("grk-knee", "Knee Cap", G, "knee", { wings: 1 }, { edge: "roll", edgeSize: 4 }, [], BZ, GD),
    withForm(ridgeLimb(6, false), t("grk-greave", "Bronze Greave", G, "greave", { cover: 260, point: 10, flareBot: 4 }, { edge: "roll", edgeSize: 5, muscle: 0.8 }, [], BZ, GD)),
    t("grk-boot", "Leather Boot", G, "boot", { cover: 270 }, { edge: "trim", edgeSize: 3, lines: "vbands", lineGap: 18 }, [], LE, BZ),
    t("grk-toe", "Boot Toe", G, "toe", {}, { edge: "trim", edgeSize: 2 }, [], LE, BZ),
    t("grk-hoplon", "Hoplon (round shield)", G, "shield", { size: 620, curve: 700 }, { edge: "roll", edgeSize: 18, edgeH: 3, thick: 3, emblem: "star", emblemSize: 180, emblemH: 2 }, [], BZ, RD),
    // ---- Norse
    withForm(helmForm(0, 4, 4, 6), t("nor-spectacle", "Spectacle Helmet", N, "helmet", { face: "open", faceW: 130, brow: 64, depth: 108, back: 12, round: 0.6, gap: 10 }, { ridge: 3, ridgeW: 12, edge: "roll", edgeSize: 4, rivets: true, rivetInset: 6, rivetGap: 18, lines: "vbands", lineGap: 46, lineDepth: 1.2 }, [{ k: "goggles", x: 28, y: "brow+8", size: 20, mirror: true }], IR, BR)),
    withForm(helmForm(0, 2, 2, 10), t("nor-nasal", "Nasal Helmet", N, "helmet", { face: "open", faceW: 134, brow: 62, depth: 104, back: 10, round: 0.4, gap: 10 }, { ridge: 3, ridgeW: 10, ridgeSharp: true, edge: "roll", edgeSize: 5, rivets: true, rivetInset: 6, rivetGap: 20 }, [{ k: "plate", x: 0, y: "brow+18", shape: "triangle", size: 22, w: 3, rot: 180 }], IR, BR, false)),
    withForm(helmForm(0, 4, 4, 6), t("nor-horned", "Horned Helm (saga style)", N, "helmet", { face: "open", faceW: 130, brow: 66, depth: 108, back: 14, round: 0.6, gap: 10 }, { ridge: 3, ridgeW: 12, edge: "roll", edgeSize: 4, rivets: true, rivetInset: 6, rivetGap: 18 }, [{ k: "horn", x: 70, y: "brow-30", size: 12, len: 110, curl: 70, tilt: 30, mirror: true, accent: true }], IR, "#e8dcc0", false)),
    t("nor-collar", "Fur Collar", N, "gorget", { spread: 1.3, cover: 300 }, { tex: "scales", texSize: 10, texDepth: 1.6, edge: "roll", edgeSize: 4 }, [], "#7a5a3a", "#c9b38a"),
    withForm(vChest(4, 0), t("nor-lamellar", "Lamellar Vest", N, "chest", { bottom: "straight", side: 104 }, { tex: "scales", texSize: 14, texDepth: 1.6, edge: "trim", edgeSize: 5 }, [], IR, BR)),
    withForm(backForm(2), t("nor-back", "Lamellar Back", N, "back", { bottom: "straight" }, { tex: "scales", texSize: 14, texDepth: 1.6, edge: "trim", edgeSize: 5 }, [], IR, BR)),
    t("nor-belt", "Leather Belt", N, "belt", { height: 46, buckle: 56 }, { edge: "trim", edgeSize: 3, emblem: "gear", emblemSize: 14, emblemH: 1.4 }, [{ k: "box", x: 90, y: "mid", size: 16, w: 30, len: 40, h: 18, mirror: true }], LE, BR),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("nor-skirt", "Mail Skirt", N, "tasset", { plates: 3, len: 210, cover: 260, split: 10 }, { tex: "scales", texSize: 8, texDepth: 1.2, edge: "trim", edgeSize: 3 }, [], IR, BR)),
    withForm(peakDome(6), t("nor-shoulder", "Shoulder Guard", N, "pauldron", { shape: "shield" }, { tex: "scales", texSize: 12, texDepth: 1.4, edge: "roll", edgeSize: 4 }, [], IR, BR)),
    withForm(ridgeLimb(2), t("nor-upper", "Leather Arm Wrap", N, "upperarm", { from: 0.35, to: 0.85, cover: 220 }, { lines: "hbands", lineGap: 16, edge: "trim", edgeSize: 3 }, [], LE, BR)),
    withForm(ridgeLimb(3), t("nor-bracer", "Leather Bracer", N, "bracer", { from: 0.06, to: 0.92, cover: 290, flareTop: 8 }, { lines: "chevron", lineGap: 14, edge: "trim", edgeSize: 4, rivets: true, rivetInset: 5, rivetGap: 22 }, [], LE, BR)),
    t("nor-hand", "Hand Wrap", N, "handplate", {}, { lines: "hbands", lineGap: 10, edge: "trim", edgeSize: 2 }, [], LE, BR),
    withForm(ridgeLimb(2, false), t("nor-thigh", "Thigh Wrap", N, "thigh", { cover: 160 }, { lines: "chevron", lineGap: 18, edge: "trim", edgeSize: 3 }, [], LE, BR)),
    t("nor-knee", "Knee Cop", N, "knee", { wings: 1 }, { edge: "roll", edgeSize: 4, rivets: true, rivetInset: 5, rivetGap: 16 }, [], IR, BR),
    withForm(ridgeLimb(3, false), t("nor-greave", "Leg Wrap Greave", N, "greave", { cover: 250, point: 10 }, { lines: "chevron", lineGap: 16, edge: "trim", edgeSize: 3 }, [], LE, BR)),
    t("nor-boot", "Fur Boot", N, "boot", { cover: 300 }, { tex: "scales", texSize: 10, texDepth: 1.4, edge: "roll", edgeSize: 4 }, [], "#7a5a3a", "#c9b38a"),
    t("nor-toe", "Boot Toe", N, "toe", {}, { edge: "roll", edgeSize: 3 }, [], LE, BR),
    t("nor-round", "Round Shield", N, "shield", { size: 640, curve: 1400 }, { edge: "trim", edgeSize: 14, edgeH: 2, thick: 3, lines: "vbands", lineGap: 60, lineDepth: 1 }, [{ k: "boss", x: 0, y: 0, size: 60 }], "#c8202f", GD),
  ];
}
// Space Opera and Superhero Armor (v2.7.10): original, detailed designs in the spirit of space
// adventure films (troopers, hunters, pilots, dark knights, droid plating) and comic-book hero
// suits (powered armor, shield heroes, thunder armor, panther suits). No film or comic designs
// are copied, and as everywhere in CosForge there are no firearms or other weapons.
function spaceOperaSet() {
  const WH = "#eef0f2", BK = "#26282c", GY = "#7d848c", GR = "#5e6a4c", TN = "#b59a6a", RD = "#9c1c20", GD = "#c9a23a", CP = "#a8653a", BL = "#3a6ea8";
  const tr = { lines: "panels", lineGap: 12, lineDepth: 0.9, edge: "trim", edgeSize: 4, edgeH: 1.3, ridge: 2.5, ridgeW: 10 };
  const X = "spaceop";
  return [
    // ---- Galactic Trooper: a full white suit with dark joints and vents
    withForm(helmForm(12, 10, 6, 4), t("so-trooper-helm", "Galactic Trooper Helmet", X, "helmet", { face: "eyes", faceW: 126, brow: 76, lens: true, depth: 126, back: 12, round: 0.35 }, { ...tr, ridgeSharp: true }, [{ k: "box", x: 34, y: "brow+44", size: 8, w: 14, len: 18, h: 6, mirror: true }, { k: "gem", x: 0, y: "brow+52", size: 4, count: 5, rowAcross: true, step: 8 }, { k: "fin", path: "sagittal", from: "brow-30", to: "brow+10", h: 6, profile: "rounded", w: 8 }, { k: "boss", x: 82, y: "brow+28", size: 9, mirror: true }], WH, BK)),
    t("so-trooper-collar", "Trooper Neck Seal", X, "gorget", { spread: 1, cover: 260 }, { lines: "hbands", lineGap: 7, edge: "trim", edgeSize: 3 }, [], BK, WH),
    withForm(vChest(10, 8), t("so-trooper-chest", "Trooper Chest Plate", X, "chest", { bottom: "straight", side: 104 }, { ...tr, emblem: "hex", emblemSize: 14, emblemH: 1.5 }, [{ k: "box", x: 0, y: "waist+70", size: 14, w: 70, len: 26, h: 8 }, { k: "gem", x: 40, y: "chest-12", size: 5, count: 3, step: 10, mirror: true }], WH, BK)),
    withForm(backForm(4), t("so-trooper-back", "Trooper Back Plate", X, "back", { bottom: "straight" }, { ...tr }, [{ k: "box", x: 0, y: "L*0.55", size: 20, w: 90, len: 60, h: 18 }], WH, BK)),
    t("so-trooper-belt", "Trooper Utility Belt", X, "belt", { height: 54, buckle: 70 }, { lines: "vbands", lineGap: 20, edge: "trim", edgeSize: 3, emblem: "diamond", emblemSize: 14, emblemH: 1.5 }, [{ k: "box", x: 70, y: "mid", size: 14, w: 26, len: 34, h: 16, count: 2, rowAcross: true, step: 34, mirror: true }], WH, BK),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("so-trooper-tassets", "Trooper Hip Plates", X, "tasset", { plates: 2, len: 150, cover: 150, split: 50 }, { ...tr }, [], WH, BK)),
    withForm(peakDome(6), t("so-trooper-pauldron", "Trooper Shoulder Bell", X, "pauldron", { shape: "shield", size: 1 }, { ...tr }, [], WH, BK)),
    withForm(ridgeLimb(4), t("so-trooper-upper", "Trooper Bicep Plate", X, "upperarm", { from: 0.36, to: 0.86, cover: 220 }, { ...tr }, [], WH, BK)),
    withForm(ridgeLimb(4), t("so-trooper-bracer", "Trooper Forearm", X, "bracer", { from: 0.06, to: 0.9, cover: 300, flareTop: 8 }, { ...tr }, [{ k: "box", x: 0, y: "L*0.6", size: 6, w: 30, len: 22, h: 5 }], WH, BK)),
    t("so-trooper-hand", "Trooper Glove Plate", X, "handplate", {}, { lines: "vbands", lineGap: 10, edge: "trim", edgeSize: 2 }, [], BK, WH),
    withForm(ridgeLimb(5, false), t("so-trooper-thigh", "Trooper Thigh Plate", X, "thigh", { cover: 170 }, { ...tr }, [{ k: "box", x: 0, y: "L*0.4", size: 10, w: 44, len: 30, h: 8 }], WH, BK)),
    t("so-trooper-knee", "Trooper Knee Plate", X, "knee", { wings: 1, fan: 1 }, { ...tr, lineGap: 7 }, [], WH, BK),
    withForm(ridgeLimb(6, false), t("so-trooper-shin", "Trooper Shin Plate", X, "greave", { cover: 240, point: 20, flareBot: 6 }, { ...tr }, [], WH, BK)),
    t("so-trooper-boot", "Trooper Boot", X, "boot", { cover: 300 }, { lines: "hbands", lineGap: 10, edge: "trim", edgeSize: 3 }, [], WH, BK),
    t("so-trooper-toe", "Trooper Toe Cap", X, "toe", {}, { edge: "trim", edgeSize: 2 }, [], WH, BK),
    // ---- more helmets and parts
    withForm(helmForm(4, 6, 4, 2), t("so-hunter-helm", "Bounty Hunter Helmet", X, "helmet", { face: "visor", faceW: 138, faceH: 22, brow: 76, lens: true, depth: 124, back: 14, round: 0.25 }, { edge: "trim", edgeSize: 5, edgeH: 1.6, rivets: true, rivetInset: 7, rivetGap: 24, tex: "hammered", texSize: 8, texDepth: 0.5 }, [{ k: "gauge", x: 92, y: "brow+10", size: 14 }, { k: "plate", x: 0, y: "brow-20", shape: "triangle", size: 22, w: 2, rot: 180, accent: true }], GR, RD, false)),
    withForm(vChest(6, 0), t("so-hunter-chest", "Hunter Chest Plate", X, "chest", { bottom: "arch", vd: 26, side: 100 }, { edge: "trim", edgeSize: 5, tex: "hammered", texSize: 10, texDepth: 0.6, emblem: "crest", emblemSize: 20, emblemH: 1.5 }, [{ k: "box", x: 60, y: "waist+40", size: 12, w: 22, len: 40, h: 14, count: 3, rowAcross: true, step: 26 }], GR, RD, false)),
    withForm(peakDome(8), t("so-hunter-pauldron", "Hunter Shoulder Plate", X, "pauldron", { shape: "shield" }, { edge: "trim", edgeSize: 4, tex: "hammered", texSize: 10, texDepth: 0.6 }, [{ k: "plate", x: 0, y: "mid", shape: "crest", size: 22, w: 1.5, accent: true }], GR, RD, false)),
    withForm(ridgeLimb(4), t("so-hunter-gauntlet", "Hunter Gauntlet", X, "bracer", { from: 0.04, to: 0.94, cover: 300, flareTop: 12 }, { edge: "trim", edgeSize: 4, lines: "inset", lineGap: 8 }, [{ k: "box", x: 0, y: "L*0.55", size: 8, w: 36, len: 30, h: 8 }, { k: "gem", x: -12, y: "L*0.55", size: 3, count: 4, step: 7 }], GR, RD, false)),
    withForm(helmForm(2, 4, 2, 6), t("so-pilot-helm", "Starfighter Pilot Helmet", X, "helmet", { face: "open", faceW: 140, brow: 64, depth: 112, back: 16, round: 0.5, gap: 14 }, { edge: "trim", edgeSize: 5, edgeH: 1.5, emblem: "star", emblemSize: 14, emblemH: 1.4 }, [{ k: "fin", path: "sagittal", from: "brow-30", to: "brow+40", h: 8, profile: "rounded", w: 30, accent: true }, { k: "goggles", x: 0, y: "brow-14", size: 24 }, { k: "box", x: 80, y: "brow+36", size: 10, w: 20, len: 28, h: 10, mirror: true }], WH, "#e06a1f", false)),
    withForm(vChest(2, 0), t("so-pilot-vest", "Pilot Life-Support Vest", X, "chest", { bottom: "straight", side: 96 }, { lines: "vbands", lineGap: 26, edge: "trim", edgeSize: 4 }, [{ k: "box", x: 0, y: "chest-10", size: 20, w: 80, len: 50, h: 22 }, { k: "gem", x: -20, y: "chest-10", size: 5, count: 4, rowAcross: true, step: 13 }], "#e06a1f", WH, false)),
    withForm(helmForm(14, 12, 8, 4), t("so-dark-helm", "Dark Knight Lord Helmet", X, "helmet", { face: "eyes", faceW: 120, brow: 78, lens: true, depth: 128, back: 34, round: 0.6, tall: 1.04 }, { edge: "roll", edgeSize: 5, edgeH: 1.8, ridge: 3, ridgeW: 12, ridgeSharp: true }, [{ k: "box", x: 0, y: "brow+56", size: 10, w: 40, len: 22, h: 8 }], BK, "#4a4d52", false)),
    t("so-dark-mask", "Dark Knight Breath Mask", X, "mask", { style: "lower" }, { thick: 2.4, lines: "vbands", lineGap: 5, edge: "roll", edgeSize: 3 }, [], BK, GY, false),
    withForm(vChest(8, 6), t("so-dark-chest", "Dark Knight Chest Armor", X, "chest", { bottom: "arch", vd: 30, side: 104 }, { edge: "roll", edgeSize: 5, edgeH: 1.6, ridge: 2, ridgeW: 10 }, [{ k: "box", x: 0, y: "chest-20", size: 22, w: 90, len: 60, h: 10 }, { k: "gem", x: -24, y: "chest-28", size: 5, count: 4, rowAcross: true, step: 16, accent: true }, { k: "gem", x: -16, y: "chest-10", size: 4, count: 3, rowAcross: true, step: 16 }], BK, RD, false)),
    withForm(ridgeLimb(3), t("so-dark-gauntlet", "Dark Knight Gauntlet", X, "bracer", { from: 0.04, to: 0.92, cover: 300, flareTop: 22 }, { edge: "roll", edgeSize: 5, lines: "hbands", lineGap: 18 }, [], BK, GY, false)),
    withForm(helmForm(6, 4, 4, 2), t("so-scout-helm", "Forest Scout Helmet", X, "helmet", { face: "visor", faceW: 130, faceH: 26, brow: 72, lens: true, depth: 118, back: 30, round: 0.55 }, { ...tr, lineGap: 16 }, [{ k: "box", x: 0, y: "brow+40", size: 12, w: 30, len: 34, h: 12 }], WH, BK, false)),
    withForm(helmForm(0, 0, 2, 0), t("so-droid-helm", "Protocol Droid Head", X, "helmet", { face: "open", faceW: 90, brow: 70, depth: 120, back: 6, round: 0.9, gap: 6 }, { edge: "roll", edgeSize: 4, lines: "hbands", lineGap: 22, lineDepth: 1 }, [{ k: "goggles", x: 26, y: "brow+6", size: 16, mirror: true }, { k: "plate", x: 0, y: "brow+44", shape: "circle", size: 14, w: 2, accent: true }], GD, CP, false)),
    withForm(vChest(2, 0), t("so-droid-chest", "Droid Torso Plating", X, "chest", { bottom: "straight", side: 104 }, { lines: "grid", lineGap: 24, edge: "roll", edgeSize: 4, rivets: true, rivetInset: 8, rivetGap: 26 }, [{ k: "gauge", x: 0, y: "chest-20", size: 26 }, { k: "box", x: 0, y: "waist+40", size: 16, w: 60, len: 30, h: 8 }], GD, CP, false)),
    t("so-energy-shield", "Hard-Light Wrist Shield", X, "shield", { shape: "round", size: 420, curve: 700 }, { tex: "hex", texSize: 26, texDepth: 1.2, glow: true, edge: "trim", edgeSize: 10, edgeH: 2, thick: 3 }, [{ k: "boss", x: 0, y: 0, size: 40 }], BL, WH, false),
  ];
}
function superheroSet() {
  const RD = "#b3141d", GD = "#d8a92b", BL = "#1f3f8f", SV = "#c7ccd2", BK = "#1c1d21", PU = "#5b3a8c", GM = "#4f555c", WH = "#eef0f2", CY = "#39c0ff";
  const suit = { lines: "panels", lineGap: 11, lineDepth: 0.9, edge: "trim", edgeSize: 4, edgeH: 1.3, ridge: 2.5, ridgeW: 9, ridgeSharp: true };
  const X = "superhero";
  return [
    // ---- Reactor Suit: a full powered-armor suit
    withForm(helmForm(12, 10, 6, 4), t("sh-reactor-helm", "Reactor Suit Helmet", X, "helmet", { face: "eyes", faceW: 118, brow: 76, lens: true, depth: 126, back: 10, round: 0.3 }, { ...suit, emblemGlow: true }, [{ k: "plate", x: 0, y: "brow-16", shape: "crest", size: 22, w: 1.5, accent: true }, { k: "fin", path: "sagittal", from: "brow-40", to: "brow+10", h: 5, profile: "rounded", w: 30 }, { k: "gem", x: 66, y: "brow+30", size: 5, mirror: true, accent: true }], RD, GD)),
    t("sh-reactor-collar", "Reactor Collar", X, "gorget", { spread: 1.1 }, { ...suit, lines: "hbands", lineGap: 8 }, [], RD, GD),
    withForm(vChest(12, 10), t("sh-reactor-chest", "Reactor Chest Plate", X, "chest", { bottom: "v", vd: 40, side: 104 }, { ...suit, emblem: "circle", emblemSize: 26, emblemH: 2.5, emblemGlow: true, emblemDY: 10 }, [{ k: "gem", x: 0, y: "emblemY", size: 11, accent: true }], RD, GD)),
    withForm(backForm(6), t("sh-reactor-back", "Reactor Back Plate", X, "back", {}, { ...suit }, [{ k: "thruster", x: 46, y: "chest-50", size: 14, mirror: true }], RD, GD)),
    t("sh-reactor-belt", "Reactor Waist", X, "belt", { height: 50, buckle: 60 }, { ...suit, lines: "vbands", lineGap: 16, emblem: "hex", emblemSize: 14, emblemH: 1.5 }, [], GD, RD),
    withForm(fp(7, 6, true, () => [0, 0, 0]), t("sh-reactor-hips", "Reactor Hip Plates", X, "tasset", { plates: 2, len: 160, cover: 160, split: 40 }, { ...suit }, [], RD, GD)),
    withForm(peakDome(12), t("sh-reactor-pauldron", "Reactor Shoulder", X, "pauldron", { shape: "tower", drop: 1.05 }, { ...suit, tex: "lames", texSize: 20, texDepth: 1.6 }, [], RD, GD)),
    withForm(ridgeLimb(5), t("sh-reactor-upper", "Reactor Arm Plate", X, "upperarm", { from: 0.32, to: 0.88, cover: 230 }, { ...suit }, [], RD, GD)),
    withForm(ridgeLimb(5), t("sh-reactor-bracer", "Reactor Gauntlet", X, "bracer", { from: 0.04, to: 0.95, cover: 310, flareTop: 12 }, { ...suit }, [{ k: "gem", x: 0, y: "L*0.85", size: 7, accent: true }], RD, GD)),
    t("sh-reactor-hand", "Reactor Palm Plate", X, "handplate", {}, { ...suit, lineGap: 6 }, [{ k: "gem", x: 0, y: 0, size: 8, accent: true }], RD, GD),
    withForm(ridgeLimb(7, false), t("sh-reactor-thigh", "Reactor Thigh Plate", X, "thigh", { cover: 175 }, { ...suit }, [], RD, GD)),
    t("sh-reactor-knee", "Reactor Knee", X, "knee", { wings: 1, fan: 1 }, { ...suit, lineGap: 7 }, [], GD, RD),
    withForm(ridgeLimb(8, false), t("sh-reactor-shin", "Reactor Shin", X, "greave", { cover: 240, point: 34, flareBot: 8 }, { ...suit }, [], RD, GD)),
    t("sh-reactor-boot", "Reactor Boot", X, "boot", { cover: 310 }, { ...suit, lineGap: 9 }, [{ k: "thruster", x: 0, y: "L*0.9", size: 12 }], RD, GD),
    t("sh-reactor-toe", "Reactor Toe", X, "toe", {}, { ...suit, lineGap: 6 }, [], RD, GD),
    // ---- shield hero, thunder armor, panther suit, heavy armor, winged valkyrie
    withForm(helmForm(0, 6, 4, 2), t("sh-patriot-helm", "Shield Hero Helmet", X, "helmet", { face: "open", faceW: 128, brow: 70, depth: 106, back: 10, round: 0.35, gap: 12 }, { edge: "trim", edgeSize: 4, edgeH: 1.4, emblem: "star", emblemSize: 22, emblemH: 1.6 }, [{ k: "plate", x: 70, y: "brow+6", shape: "wing", size: 34, w: 2, mirror: true, accent: true }], BL, WH, false)),
    withForm(vChest(6, 4), t("sh-patriot-chest", "Shield Hero Chest", X, "chest", { bottom: "arch", vd: 26, side: 102 }, { muscle: 0.6, lines: "hbands", lineGap: 26, lineDepth: 0.8, edge: "trim", edgeSize: 4, emblem: "star", emblemSize: 46, emblemH: 2 }, [], BL, WH, false)),
    t("sh-patriot-shield", "Star Round Shield", X, "shield", { size: 600, curve: 700 }, { edge: "roll", edgeSize: 40, edgeH: 2.5, thick: 3, emblem: "star", emblemSize: 120, emblemH: 2.5, lines: "inset", lineGap: 60, lineDepth: 1.4 }, [], RD, WH, false),
    withForm(helmForm(0, 8, 4, 6), t("sh-thunder-helm", "Thunder God Helm", X, "helmet", { face: "open", faceW: 132, brow: 64, depth: 108, back: 18, round: 0.45, gap: 12 }, { edge: "roll", edgeSize: 5, edgeH: 1.8, ridge: 3, ridgeW: 12 }, [{ k: "plate", x: 78, y: "brow-6", shape: "wing", size: 66, w: 3, mirror: true, rot: 10, accent: true }], SV, GD, false)),
    withForm(vChest(8, 4), t("sh-thunder-chest", "Thunder God Cuirass", X, "chest", { bottom: "arch", vd: 30, side: 104 }, { edge: "roll", edgeSize: 5, edgeH: 1.8, lines: "inset", lineGap: 16 }, [{ k: "boss", x: 36, y: "chest-10", size: 14, count: 3, step: 40, mirror: true }], BK, SV, false)),
    withForm(ridgeLimb(3), t("sh-thunder-bracer", "Thunder Bracer", X, "bracer", { from: 0.06, to: 0.92, cover: 300, flareTop: 10 }, { edge: "roll", edgeSize: 4, tex: "scales", texSize: 9, texDepth: 1.2, emblem: "bolt", emblemSize: 16, emblemH: 1.6 }, [], SV, GD, false)),
    withForm(helmForm(8, 6, 6, 4), t("sh-panther-helm", "Panther Suit Mask Helmet", X, "helmet", { face: "eyes", faceW: 112, brow: 76, lens: true, depth: 126, back: 6, round: 0.5 }, { lines: "chevron", lineGap: 9, lineDepth: 0.8, glow: true, edge: "trim", edgeSize: 3 }, [{ k: "ear", x: 50, y: "brow-40", len: 34, h: 30, w: 4, mirror: true }], BK, PU, false)),
    withForm(vChest(8, 10), t("sh-panther-chest", "Panther Suit Chest", X, "chest", { bottom: "v", vd: 46, side: 102 }, { lines: "chevron", lineGap: 10, lineDepth: 0.8, glow: true, edge: "trim", edgeSize: 3, muscle: 0.5 }, [{ k: "gem", x: 0, y: "chest-30", size: 6, count: 5, rowAcross: true, step: 14, accent: true }], BK, PU, false)),
    withForm(ridgeLimb(4), t("sh-panther-gauntlet", "Panther Gauntlet", X, "bracer", { from: 0.04, to: 0.96, cover: 300, flareTop: 8 }, { lines: "chevron", lineGap: 9, glow: true, edge: "trim", edgeSize: 3 }, [{ k: "spike", x: 0, y: "L*0.95", size: 3, len: 14, count: 3, rowAcross: true, step: 10 }], BK, PU, false)),
    withForm(helmForm(14, 12, 6, 8), t("sh-heavy-helm", "Heavy Armor Helmet", X, "helmet", { face: "slit", faceW: 110, brow: 76, depth: 128, back: 14, round: 0.15, tall: 1.05 }, { ...suit, rivets: true, rivetInset: 8, rivetGap: 22 }, [{ k: "box", x: 80, y: "brow+26", size: 12, w: 22, len: 40, h: 12, mirror: true }], GM, SV, false)),
    withForm(vChest(14, 8), t("sh-heavy-chest", "Heavy Armor Chest", X, "chest", { bottom: "straight", side: 108 }, { ...suit, rivets: true, rivetInset: 9, rivetGap: 26, emblem: "circle", emblemSize: 22, emblemH: 2, emblemGlow: true }, [{ k: "box", x: 64, y: "chest-40", size: 16, w: 30, len: 40, h: 16, mirror: true }], GM, CY, false)),
    withForm(peakDome(16), t("sh-heavy-pauldron", "Heavy Armor Shoulder", X, "pauldron", { shape: "tower", drop: 1.2, size: 1.2 }, { ...suit, tex: "lames", texSize: 22, texDepth: 2.2, rivets: true, rivetInset: 7, rivetGap: 20 }, [], GM, SV, false)),
    withForm(helmForm(0, 4, 4, 6), t("sh-valkyrie-helm", "Valkyrie Winged Helm", X, "helmet", { face: "open", faceW: 130, brow: 64, depth: 106, back: 12, round: 0.5, gap: 12 }, { edge: "roll", edgeSize: 5, edgeH: 1.6, lines: "chevron", lineGap: 14 }, [{ k: "plate", x: 74, y: "brow-12", shape: "wing", size: 80, w: 3, mirror: true, rot: 18, accent: true }, { k: "gem", x: 0, y: "brow+8", size: 7, accent: true }], SV, GD, false)),
    t("sh-valkyrie-crown", "Valkyrie Circlet", X, "crown", { style: "points", points: 5, pointH: 26, top: 50, bottom: 64 }, { thick: 2.4, edge: "trim", edgeSize: 2 }, [{ k: "gem", x: 0, y: "mid", size: 7, accent: true }], GD, CY, false),
  ];
}
export const TEMPLATES = [
  // Sci-Fi
  t("scifi-helm", "Visor Helmet", "scifi", "helmet", { face: "bigvisor", faceW: 150, faceH: 62, brow: 70, lens: true, depth: 116, back: 14, round: 0.25 }, { lines: "panels", lineGap: 12, ridge: 3, ridgeW: 14, edge: "trim", edgeSize: 5, edgeH: 1.5 }, [{ k: "antenna", x: 92, y: "brow+10", len: 60 }, { k: "gem", x: 80, y: "brow+28", size: 9, mirror: true }], C.white, C.cyan),
  t("scifi-chest", "Hardsuit Chest", "scifi", "chest", { bottom: "v", vd: 60, side: 100 }, { lines: "panels", lineGap: 16, ridge: 2.5, ridgeW: 20, edge: "trim", edgeSize: 6, edgeH: 1.6, emblem: "hex", emblemSize: 22, emblemH: 2 }, [{ k: "gem", x: 0, y: "emblemY", size: 12 }], C.white, C.cyan),
  t("scifi-back", "Hardsuit Back", "scifi", "back", { bottom: "straight" }, { lines: "inset", lineGap: 16, edge: "trim", edgeSize: 6, edgeH: 1.6, tex: "hex", texSize: 16, texDepth: 1 }, [{ k: "thruster", x: 58, y: "chest-30", size: 18, mirror: true }], C.white, C.cyan),
  t("scifi-pauldron", "Plated Pauldron", "scifi", "pauldron", { shape: "shield" }, { lines: "inset", lineGap: 10, edge: "trim", edgeSize: 5, edgeH: 1.5, ridge: 3, ridgeW: 12 }, [], C.white, C.cyan),
  t("scifi-upper", "Arm Guard", "scifi", "upperarm", { from: 0.38, to: 0.85, cover: 220 }, { lines: "panels", lineGap: 8, edge: "trim", edgeSize: 4 }, [], C.white, C.cyan),
  t("scifi-bracer", "Tech Bracer", "scifi", "bracer", { from: 0.08, to: 0.9, cover: 290, flareTop: 6 }, { tex: "hex", texSize: 11, texDepth: 1, edge: "trim", edgeSize: 5, edgeH: 1.5 }, [{ k: "gem", x: 0, y: "mid", size: 11 }], C.white, C.cyan),
  t("scifi-thigh", "Thigh Plate", "scifi", "thigh", { cover: 170 }, { lines: "panels", lineGap: 14, edge: "trim", edgeSize: 5, ridge: 2, ridgeW: 14 }, [], C.white, C.cyan),
  t("scifi-knee", "Knee Pad", "scifi", "knee", { wings: 1 }, { lines: "inset", lineGap: 8, edge: "trim", edgeSize: 4 }, [], C.slate, C.cyan),
  t("scifi-greave", "Armored Greave", "scifi", "greave", { cover: 230, point: 36, flareBot: 6 }, { lines: "panels", lineGap: 12, ridge: 3, ridgeW: 12, edge: "trim", edgeSize: 5 }, [], C.white, C.cyan),
  t("scifi-boot", "Boot Cover", "scifi", "boot", { cover: 300 }, { lines: "hbands", lineGap: 10, edge: "trim", edgeSize: 5 }, [], C.slate, C.cyan),
  t("scifi-belt", "Utility Belt", "scifi", "belt", { height: 55 }, { lines: "vbands", lineGap: 18, edge: "trim", edgeSize: 4, edgeH: 1.2 }, [{ k: "box", x: 70, y: "mid", size: 22, mirror: true }, { k: "gem", x: 0, y: "mid", size: 14 }], C.slate, C.cyan),
  t("scifi-shield", "Hex Shield", "scifi", "shield", { shape: "hex", size: 460 }, { tex: "hex", texSize: 30, texDepth: 1.4, edge: "trim", edgeSize: 10, edgeH: 2, thick: 3 }, [], C.slate, C.cyan),
  // Fantasy
  t("knight-helm", "Great Helm", "fantasy", "helmet", { face: "slit", faceW: 130, brow: 76, depth: 128, back: 6, round: 0.5, tall: 1.06, gap: 14 }, { ridge: 4, ridgeW: 9, ridgeSharp: true, edge: "roll", edgeSize: 7, edgeH: 2, rivets: true, rivetInset: 9, rivetGap: 30 }, [{ k: "fin", x: 0, y: "mid", len: 150, h: 34, profile: "rounded", w: 5, off: true }], C.steel, C.gold),
  t("crested-helm", "Crested Helm", "fantasy", "helmet", { face: "tvisor", faceW: 128, brow: 72, depth: 122, back: 10, round: 0.35 }, { ridge: 3, ridgeW: 8, edge: "roll", edgeSize: 6, edgeH: 2 }, [{ k: "fin", path: "sagittal", from: "brow-20", to: "brow+30", h: 55, profile: "mohawk", w: 10 }], C.gold, C.red, false),
  t("horned-helm", "Horned Helm", "fantasy", "helmet", { face: "open", faceW: 132, brow: 68, depth: 96, back: 14, round: 0.3 }, { ridge: 3, ridgeW: 10, ridgeSharp: true, edge: "roll", edgeSize: 6, edgeH: 2, rivets: true, rivetInset: 8, rivetGap: 24 }, [{ k: "horn", x: 74, y: "brow-34", size: 15, len: 120, curl: 75, tilt: 30, ang: -90, mirror: true }], C.steel, C.gold),
  t("fantasy-chest", "Knight Breastplate", "fantasy", "chest", { bottom: "round", vd: 30, side: 104 }, { ridge: 5, ridgeW: 16, ridgeSharp: true, edge: "roll", edgeSize: 7, edgeH: 2.2, rivets: true, rivetInset: 10, rivetGap: 34 }, [], C.steel, C.gold),
  t("fantasy-back", "Knight Backplate", "fantasy", "back", { bottom: "straight" }, { edge: "roll", edgeSize: 7, edgeH: 2.2, rivets: true, rivetInset: 10, rivetGap: 34 }, [], C.steel, C.gold),
  t("fantasy-pauldron", "Layered Pauldron", "fantasy", "pauldron", { shape: "round", drop: 1.1 }, { tex: "lames", texSize: 26, texDepth: 3, edge: "roll", edgeSize: 6, edgeH: 2, rivets: true, rivetInset: 7, rivetGap: 22 }, [], C.steel, C.gold),
  t("spiked-pauldron", "Spiked Pauldron", "fantasy", "pauldron", { shape: "spiky" }, { edge: "roll", edgeSize: 6, edgeH: 2 }, [{ k: "spike", x: 0, y: "mid-10", size: 9, len: 42, count: 3, rowAcross: true, step: 34 }], C.black, C.steel, false),
  t("fantasy-bracer", "Scaled Vambrace", "fantasy", "bracer", { from: 0.06, to: 0.92, cover: 280, point: 42, flareBot: 5 }, { tex: "scales", texSize: 15, texDepth: 1.8, edge: "trim", edgeSize: 5, edgeH: 1.6 }, [], C.steel, C.gold),
  t("fantasy-tasset", "Tassets", "fantasy", "tasset", { plates: 3, len: 190, cover: 210 }, { tex: "lames", texSize: 38, texDepth: 2.5, edge: "roll", edgeSize: 6 }, [], C.steel, C.gold),
  t("fantasy-thigh", "Cuisse", "fantasy", "thigh", { cover: 190 }, { edge: "roll", edgeSize: 6, edgeH: 2, ridge: 3, ridgeW: 12, ridgeSharp: true }, [], C.steel, C.gold),
  t("fantasy-knee", "Knee Cop", "fantasy", "knee", { fan: 1, wings: 1 }, { ridge: 3, ridgeW: 10, ridgeSharp: true, edge: "roll", edgeSize: 5 }, [], C.steel, C.gold),
  t("fantasy-greave", "Greave", "fantasy", "greave", { cover: 220, flareBot: 10 }, { ridge: 4, ridgeW: 12, ridgeSharp: true, edge: "roll", edgeSize: 6, edgeH: 2 }, [], C.steel, C.gold),
  t("fantasy-toe", "Sabaton", "fantasy", "toe", {}, { tex: "lames", texSize: 22, texDepth: 2, edge: "roll", edgeSize: 4 }, [], C.steel, C.gold),
  t("elf-circlet", "Elven Circlet", "fantasy", "crown", { style: "points", points: 9, pointH: 14, top: 64, bottom: 72 }, { thick: 2.2, edge: "trim", edgeSize: 2.5, edgeH: 0.8 }, [{ k: "gem", x: 0, y: "mid", size: 8 }], C.gold, C.green, false),
  t("kite-shield", "Kite Shield", "fantasy", "shield", { shape: "kite", size: 520 }, { edge: "trim", edgeSize: 14, edgeH: 2.5, emblem: "cross", emblemSize: 120, emblemH: 2, thick: 3, rivets: true, rivetInset: 8, rivetGap: 40 }, [], C.blue, C.gold),
  t("round-shield", "Round Shield", "fantasy", "shield", { shape: "round", size: 520 }, { tex: "ribs", texSize: 60, texDepth: 1.2, edge: "trim", edgeSize: 16, edgeH: 2.5, thick: 3, rivets: true, rivetInset: 8, rivetGap: 40 }, [{ k: "boss", x: 0, y: 0, size: 60 }], C.leather, C.steel, false),
  // Comic Hero
  t("hero-cowl", "Hero Cowl", "hero", "helmet", { face: "cowl", faceW: 124, faceH: 46, brow: 74, depth: 120, back: 10, gap: 6, round: 0 }, { thick: 2.2, edge: "bevel", edgeSize: 3 }, [], C.red, C.yellow),
  t("eared-cowl", "Eared Cowl", "hero", "helmet", { face: "cowl", faceW: 124, faceH: 46, brow: 74, depth: 120, back: 10, gap: 6, round: 0 }, { thick: 2.2, edge: "bevel", edgeSize: 3 }, [{ k: "ear", x: 48, y: "brow-56", len: 46, h: 58, mirror: true }], C.black, C.yellow, false),
  t("winged-helm", "Winged Helmet", "hero", "helmet", { face: "open", faceW: 136, brow: 70, depth: 92, back: 8, round: 0.4 }, { ridge: 3, ridgeW: 14, edge: "trim", edgeSize: 5, edgeH: 1.5, emblem: "bolt", emblemSize: 16, emblemH: 2 }, [{ k: "plate", x: 86, y: "brow-14", shape: "wing", size: 64, w: 3, mirror: true, rot: 8, accent: true }], C.yellow, C.red, false),
  t("hero-chest", "Muscle Chest", "hero", "chest", { bottom: "arch", vd: 30, side: 104, neck: 66 }, { muscle: 1, edge: "bevel", edgeSize: 4, emblem: "star", emblemSize: 34, emblemH: 2.5, emblemY: "chest+40" }, [], C.red, C.yellow),
  t("hero-back", "Muscle Back", "hero", "back", { bottom: "straight" }, { muscle: 1, edge: "bevel", edgeSize: 4 }, [], C.red, C.yellow),
  t("hero-gauntlet", "Finned Gauntlet", "hero", "bracer", { from: 0.04, to: 0.94, cover: 300, flareTop: 18 }, { edge: "bevel", edgeSize: 4, emblem: "bolt", emblemSize: 18, emblemH: 2 }, [{ k: "fin", x: 0, y: "L*0.42", len: 34, h: 26, profile: "shark", w: 3, count: 3, step: 46 }], C.red, C.yellow),
  t("hero-belt", "Hero Belt", "hero", "belt", { height: 48, buckle: 70 }, { edge: "trim", edgeSize: 4, edgeH: 1.2, emblem: "circle", emblemSize: 26, emblemH: 2.5 }, [], C.yellow, C.red),
  t("hero-boot", "Hero Boot Cuff", "hero", "boot", { cover: 330, flareBot: 34, from: 0.62, bottomPoints: 0 }, { edge: "roll", edgeSize: 5, edgeH: 1.5, emblem: "bolt", emblemSize: 22, emblemH: 2, emblemY: "L*0.35" }, [], C.red, C.yellow),
  t("domino-mask", "Domino Mask", "hero", "mask", { style: "domino" }, { thick: 2, edge: "bevel", edgeSize: 2 }, [], C.black, C.yellow),
  // Steampunk
  t("steam-helm", "Aviator Cap & Goggles", "steam", "helmet", { face: "open", faceW: 132, brow: 70, depth: 108, back: 22, round: 0.15, gap: 8 }, { tex: "quilt", texSize: 26, texDepth: 1.2, edge: "roll", edgeSize: 6, edgeH: 1.8, rivets: true, rivetInset: 8, rivetGap: 22 }, [{ k: "goggles", x: 34, y: "brow-18", size: 22, mirror: true }], C.leather, C.brass),
  t("steam-chest", "Riveted Chest Plate", "steam", "chest", { bottom: "straight", side: 100 }, { lines: "hbands", lineGap: 18, lineDepth: 1, edge: "trim", edgeSize: 7, edgeH: 1.8, rivets: true, rivetInset: 11, rivetGap: 22, emblem: "gear", emblemSize: 36, emblemH: 2.5 }, [{ k: "gauge", x: 0, y: "emblemY", size: 22 }], C.brass, C.copper),
  t("steam-back", "Boiler Back", "steam", "back", {}, { lines: "hbands", lineGap: 18, edge: "trim", edgeSize: 7, edgeH: 1.8, rivets: true, rivetInset: 11, rivetGap: 22 }, [{ k: "thruster", x: 48, y: "chest-10", size: 16, mirror: true }], C.brass, C.copper),
  t("steam-pauldron", "Gear Pauldron", "steam", "pauldron", { shape: "round" }, { edge: "trim", edgeSize: 6, edgeH: 1.8, emblem: "gear", emblemSize: 26, emblemH: 2.5, rivets: true, rivetInset: 8, rivetGap: 18 }, [], C.brass, C.copper),
  t("steam-bracer", "Brass Bracer", "steam", "bracer", { from: 0.1, to: 0.9, cover: 290 }, { lines: "hbands", lineGap: 14, edge: "trim", edgeSize: 5, rivets: true, rivetInset: 7, rivetGap: 18 }, [{ k: "gauge", x: 0, y: "mid", size: 15 }], C.brass, C.copper),
  t("steam-belt", "Gadget Belt", "steam", "belt", { height: 56 }, { edge: "trim", edgeSize: 5, rivets: true, rivetInset: 6, rivetGap: 20 }, [{ k: "box", x: 80, y: "mid", size: 24, mirror: true }, { k: "gauge", x: 0, y: "mid", size: 18 }], C.leather, C.brass),
  t("steam-greave", "Brass Greave", "steam", "greave", { cover: 210 }, { lines: "hbands", lineGap: 16, edge: "trim", edgeSize: 6, rivets: true, rivetInset: 8, rivetGap: 20 }, [], C.brass, C.copper),
  // Samurai
  t("kabuto", "Kabuto Helmet", "samurai", "helmet", { face: "open", faceW: 140, brow: 66, depth: 90, back: 42, round: 0.55, gap: 14 }, { tex: "ribs", texSize: 24, texDepth: 1.4, edge: "flare", edgeSize: 8, edgeH: 4 }, [{ k: "plate", x: 0, y: "brow-22", shape: "crescent", size: 92, w: 3, accent: true }], C.black, C.gold),
  t("samurai-do", "Do Chest Armor", "samurai", "chest", { bottom: "straight", side: 110, neck: 64 }, { tex: "lames", texSize: 34, texDepth: 2.4, edge: "roll", edgeSize: 6, edgeH: 2 }, [], C.black, C.gold),
  t("samurai-back", "Do Back", "samurai", "back", {}, { tex: "lames", texSize: 34, texDepth: 2.4, edge: "roll", edgeSize: 6, edgeH: 2 }, [], C.black, C.gold),
  t("sode", "Sode Shoulder Guard", "samurai", "pauldron", { shape: "tower", drop: 1.2 }, { tex: "lames", texSize: 22, texDepth: 2.4, edge: "roll", edgeSize: 5 }, [], C.black, C.lacq),
  t("kote", "Kote Bracer", "samurai", "bracer", { from: 0.08, to: 0.9, cover: 220 }, { tex: "hex", texSize: 12, texDepth: 1.2, edge: "roll", edgeSize: 4 }, [], C.black, C.gold),
  t("haidate", "Haidate Thigh Guard", "samurai", "thigh", { cover: 160 }, { tex: "scales", texSize: 18, texDepth: 1.6, edge: "roll", edgeSize: 5 }, [], C.black, C.lacq),
  t("suneate", "Suneate Shin Guard", "samurai", "greave", { cover: 200 }, { lines: "vbands", lineGap: 12, lineDepth: 1.2, edge: "roll", edgeSize: 5 }, [], C.black, C.gold),
  t("samurai-tasset", "Kusazuri Skirt", "samurai", "tasset", { plates: 4, len: 220, cover: 260, split: 8 }, { tex: "lames", texSize: 30, texDepth: 2.2, edge: "roll", edgeSize: 5 }, [], C.black, C.lacq),
  // more (v2.7)
  t("recon-helm", "Recon Helmet", "scifi", "helmet", { face: "visor", faceW: 140, faceH: 26, brow: 78, lens: true, depth: 124, back: 12, round: 0.15, tall: 1.04 }, { lines: "panels", lineGap: 10, ridge: 2.5, ridgeW: 10, edge: "trim", edgeSize: 4, edgeH: 1.4 }, [{ k: "gauge", x: 96, y: "brow+20", size: 20, mirror: true }, { k: "antenna", x: 96, y: "brow+8", len: 45 }], C.slate, C.cyan, false),
  t("space-helm", "Space Bubble Helmet", "scifi", "helmet", { face: "bigvisor", faceW: 200, faceH: 110, brow: 58, lens: true, depth: 125, back: 0, round: 1, gap: 34 }, { edge: "trim", edgeSize: 6, edgeH: 2 }, [{ k: "antenna", x: 70, y: "brow-40", len: 50, mirror: true }], C.white, C.cyan, false),
  t("jetpack", "Jet Pack", "scifi", "back", { side: 70, drop: -120, top: 0.97 }, { lines: "panels", lineGap: 10, edge: "trim", edgeSize: 5 }, [{ k: "thruster", x: 62, y: "L*0.25", size: 26, mirror: true }, { k: "box", x: 0, y: "L*0.55", size: 36, w: 90, len: 110, h: 40 }], C.slate, C.cyan, false),
  t("power-gauntlet", "Power Gauntlet", "scifi", "bracer", { from: 0.04, to: 0.96, cover: 310, flareTop: 14 }, { tex: "hex", texSize: 9, texDepth: 1, edge: "trim", edgeSize: 5, edgeH: 1.6 }, [{ k: "gem", x: 0, y: "L*0.3", size: 8, count: 3, step: 26 }], C.slate, C.cyan, false),
  t("scifi-collar", "Armored Collar", "scifi", "gorget", {}, { lines: "hbands", lineGap: 8, edge: "trim", edgeSize: 4 }, [], C.white, C.cyan),
  t("scifi-hand", "Armored Hand Plate", "scifi", "handplate", {}, { lines: "inset", lineGap: 5, edge: "trim", edgeSize: 3 }, [], C.white, C.cyan),
  t("riot-shield", "Riot Shield", "scifi", "shield", { shape: "tower", size: 560, curve: 900, gap: 22 }, { lines: "panels", lineGap: 18, edge: "trim", edgeSize: 12, edgeH: 2, thick: 3 }, [], C.slate, C.cyan, false),
  t("dragon-helm", "Dragon Helm", "fantasy", "helmet", { face: "slit", faceW: 120, brow: 76, depth: 122, back: 20, round: 0.3 }, { tex: "scales", texSize: 16, texDepth: 1.6, edge: "roll", edgeSize: 5 }, [{ k: "horn", x: 60, y: "brow-50", size: 13, len: 150, curl: 110, tilt: 55, ang: -95, mirror: true }, { k: "fin", path: "sagittal", from: "brow-30", to: "brow+60", h: 30, profile: "shark", w: 5 }], C.green, C.gold, false),
  t("dragon-pauldron", "Dragon Pauldron", "fantasy", "pauldron", { shape: "spiky", size: 1.1 }, { tex: "scales", texSize: 15, texDepth: 1.8, edge: "roll", edgeSize: 5 }, [{ k: "horn", x: 0, y: "mid", size: 9, len: 60, curl: 50, tilt: 30, ang: -90, count: 3, rowAcross: true, step: 30 }], C.green, C.gold, false),
  t("dragon-gauntlet", "Dragon Gauntlet", "fantasy", "bracer", { from: 0.04, to: 0.94, cover: 300, flareTop: 16, point: 30 }, { tex: "scales", texSize: 12, texDepth: 1.5, edge: "roll", edgeSize: 4 }, [{ k: "spike", x: 0, y: "L*0.45", size: 5, len: 22, count: 4, step: 34 }], C.green, C.gold, false),
  t("kings-crown", "King's Crown", "fantasy", "crown", { style: "points", points: 8, pointH: 38, top: 58, bottom: 72 }, { thick: 2.6, edge: "trim", edgeSize: 3, edgeH: 1 }, [{ k: "gem", x: 0, y: "mid", size: 9 }, { k: "gem", x: 52, y: "mid", size: 6, mirror: true }], C.gold, C.red, false),
  t("knight-hand", "Knight Hand Plate", "fantasy", "handplate", {}, { tex: "lames", texSize: 14, texDepth: 1.6, edge: "roll", edgeSize: 3 }, [], C.steel, C.gold),
  t("fantasy-gorget", "Gorget", "fantasy", "gorget", { spread: 1.3 }, { tex: "lames", texSize: 16, texDepth: 2, edge: "roll", edgeSize: 5, rivets: true, rivetInset: 6, rivetGap: 22 }, [], C.steel, C.gold),
  t("angel-wings", "Wing Back Plate", "fantasy", "back", { side: 60, drop: -150, top: 0.96 }, { edge: "roll", edgeSize: 5, emblem: "crest", emblemSize: 30, emblemH: 2 }, [{ k: "plate", x: 40, y: "L*0.6", shape: "wing", size: 170, w: 4, mirror: true, rot: -10, accent: true }], C.white, C.gold, false),
  t("high-collar", "High Collar", "hero", "gorget", { spread: 0.8, cover: 220, flareBot: 18, bottomPoints: 18 }, { edge: "bevel", edgeSize: 3 }, [], C.purple, C.yellow),
  t("bolt-helm", "Lightning Helm", "hero", "helmet", { face: "open", faceW: 132, brow: 72, depth: 96, back: 10, round: 0.3 }, { ridge: 3, ridgeW: 12, edge: "trim", edgeSize: 4 }, [{ k: "plate", x: 84, y: "brow-10", shape: "bolt", size: 40, w: 3, mirror: true, rot: 90, accent: true }], C.red, C.yellow, false),
  t("star-gauntlet", "Star Gauntlet", "hero", "bracer", { from: 0.04, to: 0.94, cover: 300, flareTop: 22, bottomPoints: 0 }, { edge: "roll", edgeSize: 4, emblem: "star", emblemSize: 20, emblemH: 2 }, [], C.blue, C.red, false),
  t("hero-shield", "Hero Shield", "hero", "shield", { shape: "heater", size: 480 }, { edge: "trim", edgeSize: 16, edgeH: 2.5, emblem: "bolt", emblemSize: 120, emblemH: 2, thick: 3 }, [], C.blue, C.yellow, false),
  t("respirator", "Respirator Mask", "steam", "mask", { style: "lower" }, { thick: 2.4, lines: "hbands", lineGap: 10, edge: "roll", edgeSize: 4, rivets: true, rivetInset: 5, rivetGap: 16 }, [{ k: "gauge", x: 38, y: "eye+70", size: 18, mirror: true }], C.brass, C.copper, false),
  t("clockwork-gauntlet", "Clockwork Gauntlet", "steam", "bracer", { from: 0.04, to: 0.94, cover: 300, flareTop: 18 }, { edge: "trim", edgeSize: 5, emblem: "gear", emblemSize: 22, emblemH: 2, rivets: true, rivetInset: 6, rivetGap: 16 }, [{ k: "gauge", x: 0, y: "L*0.7", size: 13 }], C.copper, C.brass, false),
  t("steam-collar", "Riveted Collar", "steam", "gorget", { spread: 1.1 }, { lines: "hbands", lineGap: 12, edge: "trim", edgeSize: 5, rivets: true, rivetInset: 6, rivetGap: 18 }, [], C.brass, C.copper),
  t("steam-plate-pauldron", "Riveted Plate Pauldron", "steam", "pauldron", { shape: "tower", drop: 1.15 }, { tex: "lames", texSize: 22, texDepth: 2.2, edge: "trim", edgeSize: 5, rivets: true, rivetInset: 7, rivetGap: 16 }, [], C.copper, C.brass, false),
  t("menpo", "Menpo Face Guard", "samurai", "mask", { style: "lower" }, { thick: 2.4, edge: "roll", edgeSize: 4 }, [], C.black, C.lacq),
  t("nodowa", "Nodowa Throat Guard", "samurai", "gorget", { spread: 0.9, cover: 200 }, { tex: "lames", texSize: 14, texDepth: 1.8, edge: "roll", edgeSize: 4 }, [], C.black, C.gold),
  t("horned-kabuto", "Horned Kabuto", "samurai", "helmet", { face: "open", faceW: 140, brow: 66, depth: 90, back: 42, round: 0.55, gap: 14 }, { tex: "ribs", texSize: 22, texDepth: 1.4, edge: "flare", edgeSize: 8, edgeH: 4 }, [{ k: "horn", x: 46, y: "brow-26", size: 9, len: 150, curl: 35, tilt: 20, ang: -90, mirror: true }], C.lacq, C.gold, false),
  t("tekko", "Tekko Hand Guard", "samurai", "handplate", {}, { tex: "hex", texSize: 8, texDepth: 1, edge: "roll", edgeSize: 3 }, [], C.black, C.gold),
  // Modern Sci-Fi (v2.8): sleek hard-surface armor with light lines; angular shapes come from preset form cages
  ...modernSet(),
  ...moreScifi(),
  // Military (v2.7.8)
  ...militarySet(),
  // Traditional armor (v2.7.9)
  ...historicSets(),
  // Space Opera and Superhero Armor (v2.7.10)
  ...spaceOperaSet(),
  ...superheroSet(),
  // Basic forms
  ...["helmet", "mask", "crown", "gorget", "chest", "back", "belt", "tasset", "pauldron", "upperarm", "bracer", "handplate", "thigh", "knee", "greave", "boot", "toe", "shield"].map((s) =>
    t("basic-" + s, "Plain " + SLOTS[s].name.replace(/ \(.*\)/, "").toLowerCase(), "basic", s, s === "helmet" ? { face: "open", depth: 108 } : s === "mask" ? { style: "half" } : {}, {}, [], "#c9ced6", "#7aa7e0", false)),
];
TEMPLATES.forEach((x) => { const n = x.name; x.name = n.charAt(0).toUpperCase() + n.slice(1); });
export const tplById = (id) => TEMPLATES.find((x) => x.id === id);
