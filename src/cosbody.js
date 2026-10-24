// CosForge body: a mannequin built from a person's own measurements. It is made of segments
// (torso, neck, head, arms, legs, hands, feet), each a straight axis with rounded cross-sections
// along it, so costume parts can be shaped to follow the body and checked for fit. Sizes in mm,
// Z up, the body faces -Y (towards the front view), its left side is +X.
import * as THREE from "three";

// measurements (mm). Circumferences are around the widest part, lengths as a tailor measures them.
export const MEASURES = [
  { k: "height", name: "Height", grp: "Overall", tip: "Standing straight, floor to the top of the head, without shoes" },
  { k: "head", name: "Head", grp: "Head", tip: "Around the head just above the eyebrows and ears" },
  { k: "neck", name: "Neck", grp: "Torso", tip: "Around the base of the neck" },
  { k: "shoulder", name: "Shoulder width", grp: "Torso", tip: "Across the back, from the tip of one shoulder bone to the other" },
  { k: "chest", name: "Chest", grp: "Torso", tip: "Around the fullest part of the chest, under the arms" },
  { k: "waist", name: "Waist", grp: "Torso", tip: "Around the natural waist, the narrowest part" },
  { k: "hips", name: "Hips", grp: "Torso", tip: "Around the fullest part of the hips and seat" },
  { k: "arm", name: "Arm length", grp: "Arms", tip: "From the shoulder tip, down the outside of a slightly bent arm, to the wrist bone" },
  { k: "upperArm", name: "Upper arm", grp: "Arms", tip: "Around the fullest part of the upper arm" },
  { k: "forearm", name: "Forearm", grp: "Arms", tip: "Around the fullest part of the forearm, just below the elbow" },
  { k: "wrist", name: "Wrist", grp: "Arms", tip: "Around the wrist bone" },
  { k: "hand", name: "Hand length", grp: "Arms", tip: "From the wrist crease to the tip of the middle finger" },
  { k: "inseam", name: "Inside leg", grp: "Legs", tip: "From the crotch straight down to the floor" },
  { k: "thigh", name: "Thigh", grp: "Legs", tip: "Around the fullest part of the thigh" },
  { k: "calf", name: "Calf", grp: "Legs", tip: "Around the fullest part of the calf" },
  { k: "ankle", name: "Ankle", grp: "Legs", tip: "Around the narrowest part above the ankle bone" },
  { k: "foot", name: "Foot length", grp: "Legs", tip: "Heel to the tip of the longest toe (or shoe length)" },
];
export const PRESETS = [
  { id: "broad", name: "Adult (broad)", m: { height: 1750, head: 570, neck: 380, shoulder: 440, chest: 960, waist: 800, hips: 970, arm: 600, upperArm: 300, forearm: 265, wrist: 170, hand: 190, inseam: 800, thigh: 560, calf: 370, ankle: 230, foot: 265 } },
  { id: "curvy", name: "Adult (curvy)", m: { height: 1650, head: 550, neck: 330, shoulder: 390, chest: 920, waist: 720, hips: 1010, arm: 560, upperArm: 280, forearm: 240, wrist: 155, hand: 175, inseam: 760, thigh: 580, calf: 360, ankle: 215, foot: 240 } },
  { id: "teen", name: "Teen", m: { height: 1560, head: 545, neck: 320, shoulder: 370, chest: 820, waist: 680, hips: 850, arm: 520, upperArm: 250, forearm: 225, wrist: 150, hand: 170, inseam: 720, thigh: 480, calf: 320, ankle: 200, foot: 240 } },
  { id: "child", name: "Child (8 to 10)", m: { height: 1320, head: 525, neck: 290, shoulder: 310, chest: 680, waist: 600, hips: 700, arm: 430, upperArm: 210, forearm: 190, wrist: 135, hand: 145, inseam: 590, thigh: 400, calf: 270, ankle: 180, foot: 205 } },
  { id: "large", name: "Adult (large)", m: { height: 1800, head: 590, neck: 440, shoulder: 480, chest: 1180, waist: 1100, hips: 1150, arm: 620, upperArm: 380, forearm: 300, wrist: 190, hand: 200, inseam: 790, thigh: 680, calf: 430, ankle: 260, foot: 280 } },
];
export const POSES = [{ id: "down", name: "Arms down", deg: 12 }, { id: "a", name: "A-pose", deg: 42 }, { id: "t", name: "T-pose", deg: 88 }];

// the half-width of an ellipse with circumference C whose depth is k times its width (Ramanujan)
function ellA(C, k) { return C / (Math.PI * (3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k)))); }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Catmull-Rom through the sections (clamped at the ends)
function interp(secs, t, key) {
  const n = secs.length;
  if (t <= secs[0].t) return secs[0][key];
  if (t >= secs[n - 1].t) return secs[n - 1][key];
  let i = 0; while (i < n - 2 && t > secs[i + 1].t) i++;
  const s0 = secs[Math.max(0, i - 1)], s1 = secs[i], s2 = secs[i + 1], s3 = secs[Math.min(n - 1, i + 2)];
  const u = (t - s1.t) / (s2.t - s1.t || 1);
  const p0 = s0[key], p1 = s1[key], p2 = s2[key], p3 = s3[key];
  const m1 = (p2 - p0) / 2, m2 = (p3 - p1) / 2;
  const u2 = u * u, u3 = u2 * u;
  const v = (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  // never overshoot below the smaller neighbour (keeps radii positive and shapes calm)
  return key === "a" || key === "b" ? Math.max(Math.min(p1, p2) * 0.92, v) : v;
}

// a segment: origin O, unit frame e1 (width), e2 (depth, +e2 is the back), e3 (along), length len,
// hand: +1 or -1 so that angle +90° always points to the body's outside (left side, outer arm/leg)
function segment(name, O, e3, e2hint, len, secs, hand = 1, p = 2) {
  e3 = e3.clone().normalize();
  const e2 = e2hint.clone().sub(e3.clone().multiplyScalar(e2hint.dot(e3))).normalize();
  const e1 = new THREE.Vector3().crossVectors(e2, e3).normalize();
  for (const s of secs) { s.cx = s.cx || 0; s.cy = s.cy || 0; }
  return { name, O: O.clone(), e1, e2, e3, len, secs, hand, p };
}

// a point on a segment's surface: t along (0..1), phi around (0 = front, +90° = outside), g = extra offset
export function segPoint(seg, t, phi, g = 0, out = new THREE.Vector3()) {
  const a = interp(seg.secs, t, "a") + g, b = interp(seg.secs, t, "b") + g, cx = interp(seg.secs, t, "cx"), cy = interp(seg.secs, t, "cy");
  const c = Math.cos(phi), s = Math.sin(phi), e = 2 / seg.p;
  const X = a * Math.sign(s) * Math.pow(Math.abs(s), e), Y = b * Math.sign(c) * Math.pow(Math.abs(c), e);
  const tt = clamp(t, -0.5, 1.5);
  return out.copy(seg.O).addScaledVector(seg.e3, tt * seg.len).addScaledVector(seg.e1, cx + seg.hand * X).addScaledVector(seg.e2, cy - Y);
}
export function segSection(seg, t) { return { a: interp(seg.secs, t, "a"), b: interp(seg.secs, t, "b"), cx: interp(seg.secs, t, "cx"), cy: interp(seg.secs, t, "cy") }; }

// ----------------------------------------------------------------------------- the body
export function makeBody(meas, poseDeg = 42) {
  const M = { ...PRESETS[0].m, ...meas };
  const H = M.height;
  const headH = 0.13 * H;
  const B = { M, H, pose: poseDeg, segs: {}, joints: {} };
  // head: an egg, a little deeper than wide, centred slightly back
  const hk = 1.2, ha = ellA(M.head, hk), hb = ha * hk, hc = headH * 0.53;
  const hz = H - hc;
  B.head = { C: V3(0, hb * 0.06, hz), a: ha, b: hb, c: hc };
  // the head as a segment too (bottom to top), so parts can use the same tools
  const hs = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, f = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)); hs.push({ t, a: Math.max(0.5, ha * f), b: Math.max(0.5, hb * f), cy: 0 }); }
  B.segs.head = segment("head", V3(0, hb * 0.06, hz - hc), V3(0, 0, 1), V3(0, 1, 0), 2 * hc, hs, 1, 2);
  // torso: crotch to the top of the shoulders
  const shZ = 0.818 * H, crotch = M.inseam, waistZ = 0.615 * H, chestZ = 0.72 * H, hipZ = crotch + 0.06 * H;
  const torsoTop = shZ + 0.012 * H, torsoBot = crotch - 0.035 * H;
  const chestA = ellA(M.chest, 0.66), waistA = ellA(M.waist, 0.74), hipA = ellA(M.hips, 0.72);
  const shA = M.shoulder * 0.46;
  const L = torsoTop - torsoBot, T = (z) => (z - torsoBot) / L;
  const torsoSecs = [
    { t: 0, a: hipA * 0.55, b: hipA * 0.72 * 0.55, cy: hipA * 0.05 },
    { t: T(crotch), a: hipA * 0.94, b: hipA * 0.72 * 0.9, cy: hipA * 0.06 },
    { t: T(hipZ), a: hipA, b: hipA * 0.72, cy: hipA * 0.05 },
    { t: T(waistZ), a: waistA, b: waistA * 0.74, cy: 0 },
    { t: T(lerp(waistZ, chestZ, 0.55)), a: lerp(waistA, chestA, 0.6), b: lerp(waistA * 0.74, chestA * 0.66, 0.65), cy: 0 },
    { t: T(chestZ), a: chestA, b: chestA * 0.66, cy: 0 },
    { t: T(lerp(chestZ, shZ, 0.55)), a: Math.max(chestA * 1.0, shA * 0.92), b: chestA * 0.6, cy: chestA * 0.03 },
    { t: T(shZ - 0.01 * H), a: shA * 0.95, b: chestA * 0.5, cy: chestA * 0.06 },
    { t: 1, a: shA * 0.45, b: chestA * 0.36, cy: chestA * 0.08 },
  ];
  B.segs.torso = segment("torso", V3(0, 0, torsoBot), V3(0, 0, 1), V3(0, 1, 0), L, torsoSecs, 1, 2.4);
  B.z = { crotch, waist: waistZ, chest: chestZ, hip: hipZ, shoulder: shZ, top: torsoTop, chin: H - headH, bottom: torsoBot };
  // neck
  const nr = M.neck / (2 * Math.PI), nz0 = shZ - 0.03 * H, nz1 = H - headH + 0.25 * headH;
  B.segs.neck = segment("neck", V3(0, hb * 0.12, nz0), V3(0, 0, 1), V3(0, 1, 0), nz1 - nz0, [{ t: 0, a: nr * 1.35, b: nr * 1.15 }, { t: 0.35, a: nr * 1.02, b: nr * 0.98 }, { t: 1, a: nr * 0.98, b: nr * 0.95 }], 1, 2);
  // arms (left = +X; the right side is a mirror)
  const rUA = M.upperArm / (2 * Math.PI), rFA = M.forearm / (2 * Math.PI), rW = M.wrist / (2 * Math.PI);
  const upper = 0.56 * M.arm - rUA * 0.4, fore = 0.44 * M.arm + rUA * 0.4;
  const th = (poseDeg * Math.PI) / 180;
  for (const sd of [1, -1]) {
    const S = sd > 0 ? "L" : "R";
    const sj = V3(sd * (M.shoulder / 2 - rUA * 0.75), chestA * 0.05, shZ - rUA * 0.85);
    const dir = V3(sd * Math.sin(th), 0, -Math.cos(th));
    const el = sj.clone().addScaledVector(dir, upper), wr = el.clone().addScaledVector(dir, fore);
    B.joints["shoulder" + S] = { p: sj, r: rUA * 1.12 };
    B.joints["elbow" + S] = { p: el, r: rFA * 0.88 };
    B.joints["wrist" + S] = { p: wr, r: rW * 0.95 };
    // frames: the back (+Y) stays the back; "outside" is away from the body
    const hand = sd > 0 ? -1 : 1;
    B.segs["upperArm" + S] = segment("upperArm" + S, sj, dir, V3(0, 1, 0), upper, [{ t: 0, a: rUA * 1.12, b: rUA * 1.12 }, { t: 0.3, a: rUA * 1.05, b: rUA * 1.0 }, { t: 0.6, a: rUA * 0.98, b: rUA * 0.98 }, { t: 1, a: rFA * 0.86, b: rFA * 0.84 }], hand, 2);
    B.segs["forearm" + S] = segment("forearm" + S, el, dir, V3(0, 1, 0), fore, [{ t: 0, a: rFA * 0.88, b: rFA * 0.86 }, { t: 0.18, a: rFA * 1.04, b: rFA * 0.94 }, { t: 0.6, a: rFA * 0.86, b: rFA * 0.76 }, { t: 1, a: rW * 1.12, b: rW * 0.82 }], hand, 2);
    // hand: palm faces the body in an A-pose (thin across, wide front to back)
    const hl = M.hand;
    B.segs["hand" + S] = segment("hand" + S, wr, dir, V3(0, 1, 0), hl, [{ t: 0, a: rW * 0.7, b: rW * 1.15 }, { t: 0.35, a: hl * 0.085, b: hl * 0.24 }, { t: 0.55, a: hl * 0.075, b: hl * 0.23 }, { t: 0.8, a: hl * 0.06, b: hl * 0.19 }, { t: 1, a: hl * 0.035, b: hl * 0.1 }], hand, 2.2);
    // legs
    const rT = M.thigh / (2 * Math.PI), rC = M.calf / (2 * Math.PI), rA = M.ankle / (2 * Math.PI);
    const xL = Math.max(rT * 0.95, hipA - rT * 0.9);
    const knZ = M.inseam * 0.615, anZ = Math.max(0.045 * H, M.inseam * 0.105);
    const hp = V3(sd * xL, hipA * 0.04, crotch + rT * 0.55), kn = V3(sd * xL * 0.86, -rT * 0.05, knZ), an = V3(sd * xL * 0.8, rA * 0.4, anZ);
    B.joints["hip" + S] = { p: hp, r: rT * 0.95 };
    B.joints["knee" + S] = { p: kn, r: rC * 0.92 };
    B.joints["ankle" + S] = { p: an, r: rA * 1.05 };
    B.segs["thigh" + S] = segment("thigh" + S, hp, kn.clone().sub(hp), V3(0, 1, 0), hp.distanceTo(kn), [{ t: 0, a: rT * 1.02, b: rT * 1.02 }, { t: 0.25, a: rT * 0.98, b: rT * 1.0 }, { t: 0.6, a: rT * 0.82, b: rT * 0.84 }, { t: 1, a: rC * 0.93, b: rC * 0.92 }], hand, 2);
    B.segs["shin" + S] = segment("shin" + S, kn, an.clone().sub(kn), V3(0, 1, 0), kn.distanceTo(an), [{ t: 0, a: rC * 0.93, b: rC * 0.9 }, { t: 0.28, a: rC * 1.0, b: rC * 1.02, cy: rC * 0.08 }, { t: 0.7, a: rC * 0.72, b: rC * 0.7, cy: rC * 0.04 }, { t: 1, a: rA * 1.0, b: rA * 1.02 }], hand, 2);
    // foot: heel to toe along -Y, sitting on the floor
    const fl = M.foot, heel = V3(an.x, an.y + fl * 0.2, 0);
    const fh = anZ * 1.15;
    B.segs["foot" + S] = segment("foot" + S, heel, V3(0, -1, 0), V3(0, 0, -1), fl, [
      { t: 0, a: fl * 0.13, b: fh * 0.5, cy: -fh * 0.5 }, { t: 0.25, a: fl * 0.15, b: fh * 0.55, cy: -fh * 0.55 }, { t: 0.55, a: fl * 0.18, b: fh * 0.36, cy: -fh * 0.36 },
      { t: 0.8, a: fl * 0.19, b: fh * 0.24, cy: -fh * 0.24, cx: -sd * fl * 0.02 }, { t: 1, a: fl * 0.12, b: fh * 0.14, cy: -fh * 0.14, cx: -sd * fl * 0.03 }], hand, 2.3);
    B.joints["toe" + S] = { p: segPoint(B.segs["foot" + S], 0.75, 0, 0), r: 0 };
  }
  return B;
}

// the segments that make up the visible mannequin (head handled as an ellipsoid)
const SHOWN = ["torso", "neck", "upperArmL", "forearmL", "handL", "thighL", "shinL", "footL", "upperArmR", "forearmR", "handR", "thighR", "shinR", "footR"];

function loftGeometry(seg, nT = 28, nP = 40) {
  const pos = [], idx = [], p = new THREE.Vector3();
  for (let i = 0; i <= nT; i++) for (let j = 0; j < nP; j++) { segPoint(seg, i / nT, (j / nP) * Math.PI * 2, 0, p); pos.push(p.x, p.y, p.z); }
  const ring = (i, j) => i * nP + (j % nP);
  for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) { const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j + 1), d = ring(i + 1, j); idx.push(a, b, c, a, c, d); }
  // end caps
  for (const [i, t] of [[0, 0], [nT, 1]]) {
    const s = segSection(seg, t), c = seg.O.clone().addScaledVector(seg.e3, t * seg.len).addScaledVector(seg.e1, s.cx).addScaledVector(seg.e2, s.cy);
    const k = pos.length / 3; pos.push(c.x, c.y, c.z);
    for (let j = 0; j < nP; j++) if (i === 0) idx.push(k, ring(i, j + 1), ring(i, j)); else idx.push(k, ring(i, j), ring(i, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // the winding depends on the segment's handedness: keep faces pointing out
  const vol = signedVolume(g);
  if (vol < 0) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } }
  g.computeVertexNormals();
  return g;
}
export function signedVolume(g) {
  const P = g.attributes.position.array, I = g.index ? g.index.array : null, n = I ? I.length : P.length / 3;
  let v = 0;
  for (let k = 0; k < n; k += 3) {
    const a = (I ? I[k] : k) * 3, b = (I ? I[k + 1] : k + 1) * 3, c = (I ? I[k + 2] : k + 2) * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

// the mannequin as a group of meshes
export function bodyGroup(B, material) {
  const g = new THREE.Group();
  g.name = "cf-body";
  for (const k of SHOWN) g.add(new THREE.Mesh(loftGeometry(B.segs[k]), material));
  const h = B.head;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), material);
  // SphereGeometry is Y-up: after turning it Z-up the scale axes are x, z, y
  head.position.copy(h.C); head.rotation.x = Math.PI / 2; head.scale.set(h.a, h.c, h.b);
  g.add(head);
  // a nose and a jaw, so the front of the head is easy to see
  const nose = new THREE.Mesh(new THREE.ConeGeometry(h.a * 0.14, h.c * 0.32, 12), material);
  nose.position.set(0, h.C.y - h.b * 0.97, h.C.z - h.c * 0.08); nose.rotation.x = Math.PI + 0.3;
  g.add(nose);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
  jaw.scale.set(h.a * 0.78, h.b * 0.72, h.c * 0.55); jaw.position.set(0, h.C.y - h.b * 0.18, h.C.z - h.c * 0.52);
  g.add(jaw);
  for (const [k, j] of Object.entries(B.joints)) {
    if (!j.r || k.startsWith("toe")) continue;
    const s = new THREE.Mesh(new THREE.SphereGeometry(j.r, 20, 14), material);
    s.position.copy(j.p); g.add(s);
  }
  return g;
}

// how far a point is from some of the body's segments, joints ("shoulderL"...) or "head"
const _d = new THREE.Vector3();
export function segDistance(B, names, P) {
  let best = Infinity;
  for (const k of names) {
    if (k === "head") {
      const h = B.head; _d.copy(P).sub(h.C);
      const rho = Math.hypot(_d.x / h.a, _d.y / h.b, _d.z / h.c), r = _d.length();
      best = Math.min(best, rho > 1e-6 ? r * (1 - 1 / rho) : -h.a);
      continue;
    }
    const j = B.joints[k];
    if (j) { if (j.r) best = Math.min(best, P.distanceTo(j.p) - j.r); continue; }
    const s = B.segs[k]; if (!s) continue;
    _d.copy(P).sub(s.O);
    let t = _d.dot(s.e3) / s.len, ax = 0;
    if (t < 0) { ax = -t * s.len; t = 0; } else if (t > 1) { ax = (t - 1) * s.len; t = 1; }
    const sec = segSection(s, t);
    const lx = _d.dot(s.e1) - sec.cx, ly = _d.dot(s.e2) - sec.cy;
    const rho = Math.hypot(lx / sec.a, ly / sec.b), r = Math.hypot(lx, ly);
    let dist = rho > 1e-6 ? r * (1 - 1 / rho) : -Math.min(sec.a, sec.b);
    if (ax > 0) dist = dist > 0 ? Math.hypot(dist, ax) : ax;
    best = Math.min(best, dist);
  }
  return best;
}
export const ALL_SEGS = [...SHOWN, "head", "shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR"];
// roughly how far a point is outside the body (negative: inside it), for the fit check
export function bodyDistance(B, P) { return segDistance(B, ALL_SEGS, P); }
function bodyDistanceOld(B, P) {
  let best = Infinity;
  const d = new THREE.Vector3();
  for (const k of SHOWN) {
    const s = B.segs[k];
    d.copy(P).sub(s.O);
    let t = d.dot(s.e3) / s.len, ax = 0;
    if (t < 0) { ax = -t * s.len; t = 0; } else if (t > 1) { ax = (t - 1) * s.len; t = 1; }
    const sec = segSection(s, t);
    const lx = d.dot(s.e1) - sec.cx, ly = d.dot(s.e2) - sec.cy;
    const rho = Math.hypot(lx / sec.a, ly / sec.b);
    const r = Math.hypot(lx, ly);
    let dist = rho > 1e-6 ? r * (1 - 1 / rho) : -Math.min(sec.a, sec.b);
    if (ax > 0) dist = dist > 0 ? Math.hypot(dist, ax) : ax;
    if (dist < best) best = dist;
  }
  // head ellipsoid
  const h = B.head;
  d.copy(P).sub(h.C);
  const rho = Math.hypot(d.x / h.a, d.y / h.b, d.z / h.c), r = d.length();
  const dh = rho > 1e-6 ? r * (1 - 1 / rho) : -h.a;
  if (dh < best) best = dh;
  for (const [k, j] of Object.entries(B.joints)) { if (!j.r || k.startsWith("toe")) continue; const dj = P.distanceTo(j.p) - j.r; if (dj < best) best = dj; }
  return best;
}

// the nearest point on the body's centre lines (used to tell which side of a shell faces the body)
export function bodyAxisPoint(B, P) {
  let best = null, bd = Infinity;
  const d = new THREE.Vector3();
  for (const k of [...SHOWN, "head"]) {
    const s = B.segs[k];
    d.copy(P).sub(s.O);
    const t = clamp(d.dot(s.e3) / s.len, 0, 1);
    const sec = segSection(s, t);
    const q = s.O.clone().addScaledVector(s.e3, t * s.len).addScaledVector(s.e1, sec.cx).addScaledVector(s.e2, sec.cy);
    const dist = q.distanceTo(P) - Math.min(sec.a, sec.b);
    if (dist < bd) { bd = dist; best = q; }
  }
  return best;
}
