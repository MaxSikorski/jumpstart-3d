// ---- Characters: human bodies, heads, animals and aliens to start sculpting from.
// Each is built from smoothly blended capsules, cones and ellipsoids (a signed-distance model),
// turned into an even mesh with "surface nets", and comes with a skeleton (bones) so it can be
// rigged and animated in the Puppet Animator. Units here: about 1 = 1 m for a person; each
// character is scaled to a printable size when added. Characters face +Z (toward the camera).
const CHARS = (() => {
  // --- distance functions
  const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  function roundCone(px, py, pz, p) { // p: {a, b, r1, r2} (iq's round cone)
    const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
    const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz;
    if (l2 < 1e-12) return len(px - ax, py - ay, pz - az) - p.r1;
    const rr = p.r1 - p.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    const pax = px - ax, pay = py - ay, paz = pz - az, y = pax * bax + pay * bay + paz * baz, z = y - l2;
    const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y, x2 = qx * qx + qy * qy + qz * qz;
    const y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - p.r2;
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - p.r1;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - p.r1;
  }
  function ellipsoid(px, py, pz, p) {
    const [cx, cy, cz] = p.c, [rx, ry, rz] = p.r;
    const x = px - cx, y = py - cy, z = pz - cz;
    const k0 = len(x / rx, y / ry, z / rz), k1 = len(x / (rx * rx), y / (ry * ry), z / (rz * rz));
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  }
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  // part makers
  const C = (a, b, r1, r2 = r1, o = {}) => ({ t: "c", a, b, r1, r2, ...o });
  const E = (c, r, o = {}) => ({ t: "e", c, r: Array.isArray(r) ? r : [r, r, r], ...o });
  const S = (c, r, o = {}) => E(c, [r, r, r], o);
  const cut = (p, k = 0.01) => ({ ...p, sub: true, k });
  // both sides: s = +1 (character's left, +X) and -1
  const both = (f) => [f(1), f(-1)];
  const bone = (name, parent, head, tail) => ({ name, parent, head, tail });
  const mirB = (f) => [f(1, "L"), f(-1, "R")];
  function bbox(p) {
    if (p.t === "c") { const r = Math.max(p.r1, p.r2); return [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r, Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r]; }
    return [p.c[0] - p.r[0], p.c[1] - p.r[1], p.c[2] - p.r[2], p.c[0] + p.r[0], p.c[1] + p.r[1], p.c[2] + p.r[2]];
  }

  // --- a person-like figure (people, the kid, the grey alien, the cyclops)
  function humanoid(q) {
    const H = q.hip, sh = q.shoulderY, nk = q.neckY, hy = q.headY, hr = q.head, aw = q.armW, lw = q.legW;
    const parts = [
      E([0, H, 0], [q.hipW, 0.11 * q.torsoW, 0.1 * q.torsoD]),
      C([0, H + 0.02, 0], [0, sh - 0.14, 0.005], 0.13 * q.torsoW, 0.15 * q.torsoW),
      E([0, sh - 0.1, 0.01], [0.18 * q.torsoW, 0.13, 0.11 * q.torsoD]),
      C([0, sh - 0.02, 0], [0, nk + 0.02, 0.01], q.neck, q.neck * 0.9),
      E([0, hy, 0.015], hr),
      ...both((s) => C([s * 0.1 * q.torsoW, sh, 0], [s * q.shoulderX, sh, 0], 0.06 * aw, 0.055 * aw)),
      ...both((s) => C([s * q.shoulderX, sh, 0], [s * q.elbow[0], q.elbow[1], -0.01], 0.052 * aw, 0.042 * aw)),
      ...both((s) => C([s * q.elbow[0], q.elbow[1], -0.01], [s * q.wrist[0], q.wrist[1], 0.02], 0.04 * aw, 0.032 * aw)),
      ...both((s) => E([s * (q.wrist[0] + 0.015), q.wrist[1] - 0.065, 0.03], [0.028 * aw, 0.065 * q.hand, 0.045 * aw])),
      ...both((s) => C([s * q.legX, H - 0.03, 0], [s * (q.legX + 0.01), q.knee, 0.005], 0.085 * lw, 0.055 * lw)),
      ...both((s) => C([s * (q.legX + 0.01), q.knee, 0.005], [s * (q.legX + 0.01), 0.09, -0.02], 0.052 * lw, 0.038 * lw)),
      ...both((s) => E([s * (q.legX + 0.01), 0.04, 0.04], [0.045 * lw, 0.04, 0.11 * q.foot])),
      ...(q.extra || []),
    ];
    const bones = [
      bone("hips", null, [0, H, 0], [0, H + 0.14, 0]),
      bone("spine", "hips", [0, H + 0.14, 0], [0, sh - 0.12, 0]),
      bone("chest", "spine", [0, sh - 0.12, 0], [0, sh + 0.02, 0]),
      bone("neck", "chest", [0, sh + 0.02, 0], [0, nk + 0.02, 0]),
      bone("head", "neck", [0, nk + 0.02, 0], [0, hy + hr[1], 0]),
      ...mirB((s, n) => bone("shoulder." + n, "chest", [s * 0.04, sh, 0], [s * q.shoulderX, sh, 0])),
      ...mirB((s, n) => bone("upperArm." + n, "shoulder." + n, [s * q.shoulderX, sh, 0], [s * q.elbow[0], q.elbow[1], -0.01])),
      ...mirB((s, n) => bone("lowerArm." + n, "upperArm." + n, [s * q.elbow[0], q.elbow[1], -0.01], [s * q.wrist[0], q.wrist[1], 0.02])),
      ...mirB((s, n) => bone("hand." + n, "lowerArm." + n, [s * q.wrist[0], q.wrist[1], 0.02], [s * (q.wrist[0] + 0.03), q.wrist[1] - 0.14 * q.hand, 0.03])),
      ...mirB((s, n) => bone("upperLeg." + n, "hips", [s * q.legX, H - 0.03, 0], [s * (q.legX + 0.01), q.knee, 0.005])),
      ...mirB((s, n) => bone("lowerLeg." + n, "upperLeg." + n, [s * (q.legX + 0.01), q.knee, 0.005], [s * (q.legX + 0.01), 0.09, -0.02])),
      ...mirB((s, n) => bone("foot." + n, "lowerLeg." + n, [s * (q.legX + 0.01), 0.09, -0.02], [s * (q.legX + 0.01), 0.03, 0.15 * q.foot])),
    ];
    const pb = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'shoulder.R', 'upperArm.L', 'upperArm.R', 'lowerArm.L', 'lowerArm.R', 'hand.L', 'hand.R', 'upperLeg.L', 'upperLeg.R', 'lowerLeg.L', 'lowerLeg.R', 'foot.L', 'foot.R'];
    return { parts, bones, rig: "humanoid", pb: parts.map((_, i) => pb[i] || 'head') };
  }
  const ADULT = { hip: 0.98, shoulderY: 1.42, neckY: 1.54, headY: 1.67, head: [0.095, 0.12, 0.11], neck: 0.055, hipW: 0.16, torsoW: 1, torsoD: 1, shoulderX: 0.2, elbow: [0.3, 1.16], wrist: [0.37, 0.92], armW: 1, legW: 1, legX: 0.09, knee: 0.52, hand: 1, foot: 1 };

  // --- a four-legged animal (cat, dog, bunny)
  function quadruped(q) {
    const y = q.bodyY, L = q.bodyL, hz = L / 2, head = q.head;
    const parts = [
      C([0, y, -hz], [0, y + 0.02, hz * 0.85], q.bodyR * q.rump, q.bodyR),
      E([0, y + 0.01, hz * 0.85], [q.bodyR * 0.95, q.bodyR * 1.05, q.bodyR]),
      C([0, y + 0.04, hz + 0.02], [0, q.headC[1] - 0.04, q.headC[2] - 0.03], q.neck, q.neck * 0.9),
      E(q.headC, head),
      E([0, q.headC[1] - head[1] * 0.35, q.headC[2] + head[2] * 0.85], [head[0] * 0.5, head[1] * 0.42, q.snout]),
      ...both((s) => q.ears === "floppy" ? E([s * head[0] * 0.95, q.headC[1] - 0.01, q.headC[2] - 0.01], [0.022, head[1] * 0.75, head[2] * 0.42])
        : q.ears === "long" ? C([s * head[0] * 0.4, q.headC[1] + head[1] * 0.7, q.headC[2] - 0.02], [s * head[0] * 0.75, q.headC[1] + head[1] * 3.2, q.headC[2] - 0.06], 0.035, 0.028)
        : C([s * head[0] * 0.55, q.headC[1] + head[1] * 0.6, q.headC[2] - 0.01], [s * head[0] * 0.75, q.headC[1] + head[1] * 1.55, q.headC[2] - 0.02], 0.032, 0.004)),
      ...both((s) => cut(S([s * head[0] * 0.42, q.headC[1] + head[1] * 0.15, q.headC[2] + head[2] * 0.82], head[0] * 0.17), 0.012)),
      // legs: front then back (upper, lower, paw)
      ...both((s) => C([s * q.legX, y - 0.02, hz * 0.85], [s * q.legX, y * 0.45, hz * 0.88], q.legR, q.legR * 0.85)),
      ...both((s) => C([s * q.legX, y * 0.45, hz * 0.88], [s * q.legX, 0.035, hz * 0.9], q.legR * 0.85, q.legR * 0.75)),
      ...both((s) => E([s * q.legX, 0.025, hz * 0.9 + 0.02], [q.legR * 0.95, 0.025, q.legR * 1.4])),
      ...both((s) => C([s * q.legX * 1.1, y, -hz * 0.95], [s * q.legX * 1.1, y * 0.5, -hz * 0.75], q.legR * q.thigh, q.legR * 0.9)),
      ...both((s) => C([s * q.legX * 1.1, y * 0.5, -hz * 0.75], [s * q.legX * 1.1, 0.035, -hz * 0.95], q.legR * 0.85, q.legR * 0.75)),
      ...both((s) => E([s * q.legX * 1.1, 0.025, -hz * 0.92], [q.legR * 0.95, 0.025, q.legR * 1.5 * q.backPaw])),
      // tail
      C([0, y + 0.03, -hz - 0.04], q.tail[0], q.tailR, q.tailR * 0.85),
      C(q.tail[0], q.tail[1], q.tailR * 0.85, q.tailR * q.tailEnd),
    ];
    const bones = [
      bone("hips", null, [0, y, -hz * 0.9], [0, y, 0]),
      bone("spine", "hips", [0, y, 0], [0, y + 0.02, hz * 0.9]),
      bone("neck", "spine", [0, y + 0.04, hz * 0.95], [0, q.headC[1] - 0.04, q.headC[2] - 0.03]),
      bone("head", "neck", [0, q.headC[1] - 0.04, q.headC[2] - 0.03], [0, q.headC[1], q.headC[2] + head[2] + q.snout]),
      bone("tail1", "hips", [0, y + 0.03, -hz - 0.04], q.tail[0]),
      bone("tail2", "tail1", q.tail[0], q.tail[1]),
      ...mirB((s, n) => bone("frontUpper." + n, "spine", [s * q.legX, y - 0.02, hz * 0.85], [s * q.legX, y * 0.45, hz * 0.88])),
      ...mirB((s, n) => bone("frontLower." + n, "frontUpper." + n, [s * q.legX, y * 0.45, hz * 0.88], [s * q.legX, 0.02, hz * 0.95])),
      ...mirB((s, n) => bone("backUpper." + n, "hips", [s * q.legX * 1.1, y, -hz * 0.95], [s * q.legX * 1.1, y * 0.5, -hz * 0.75])),
      ...mirB((s, n) => bone("backLower." + n, "backUpper." + n, [s * q.legX * 1.1, y * 0.5, -hz * 0.75], [s * q.legX * 1.1, 0.02, -hz * 0.9])),
    ];
    const pb = ['hips', 'spine', 'neck', 'head', 'head', 'head', 'head', 'head', 'head', 'frontUpper.L', 'frontUpper.R', 'frontLower.L', 'frontLower.R', 'frontLower.L', 'frontLower.R', 'backUpper.L', 'backUpper.R', 'backLower.L', 'backLower.R', 'backLower.L', 'backLower.R', 'tail1', 'tail2'];
    return { parts, bones, rig: "quadruped", pb };
  }

  const LIST = [
    { id: "human", name: "Person", size: 4.2, k: 0.035, icon: '<circle cx="12" cy="4.5" r="2.2"/><path d="M12 7v7M8 9.5l4-1 4 1M12 14l-3 6.5M12 14l3 6.5"/>', make: () => humanoid(ADULT) },
    { id: "kid", name: "Kid", size: 3.4, k: 0.04, icon: '<circle cx="12" cy="7" r="4"/><path d="M12 11v5M9 13l3-1 3 1M12 16l-2 4.5M12 16l2 4.5"/>', make: () => humanoid({ ...ADULT, hip: 0.5, shoulderY: 0.82, neckY: 0.9, headY: 1.12, head: [0.2, 0.21, 0.19], neck: 0.07, hipW: 0.13, torsoW: 0.85, torsoD: 1, shoulderX: 0.16, elbow: [0.23, 0.66], wrist: [0.28, 0.5], armW: 1.15, legW: 1.2, legX: 0.075, knee: 0.27, hand: 0.8, foot: 0.9 }) },
    { id: "head", name: "Head", size: 2.6, k: 0.02, icon: '<path d="M8 20v-3c-2-1.5-3-3.5-3-6.5a7 7 0 0 1 14 0c0 3-1 5-3 6.5v3"/><path d="M10 11h.01M14 11h.01"/>', make: () => ({ rig: "head",
      parts: [E([0, 0.1, 0], [0.09, 0.115, 0.105]), E([0, 0.0, 0.03], [0.07, 0.065, 0.075]), ...both((s) => E([s * 0.045, 0.035, 0.065], [0.035, 0.03, 0.03])),
        C([0, 0.075, 0.1], [0, 0.03, 0.122], 0.011, 0.019), C([-0.042, 0.098, 0.088], [0.042, 0.098, 0.088], 0.016), ...both((s) => cut(S([s * 0.034, 0.072, 0.103], 0.021), 0.014)),
        ...both((s) => S([s * 0.034, 0.072, 0.093], 0.016)), ...both((s) => E([s * 0.093, 0.06, -0.005], [0.014, 0.033, 0.024])),
        E([0, -0.003, 0.098], [0.028, 0.011, 0.012]), E([0, -0.04, 0.083], [0.03, 0.026, 0.026]), C([0, -0.17, -0.015], [0, 0.0, -0.01], 0.056, 0.052), E([0, -0.19, -0.02], [0.13, 0.035, 0.08])],
      bones: [bone("neck", null, [0, -0.19, -0.015], [0, -0.03, -0.01]), bone("head", "neck", [0, -0.03, -0.01], [0, 0.22, 0])], pb: "end2neck" }) },
    { id: "toon", name: "Cartoon head", size: 2.4, k: 0.03, icon: '<circle cx="12" cy="11" r="7.5"/><circle cx="9.5" cy="10" r="1.6"/><circle cx="14.5" cy="10" r="1.6"/><path d="M9.5 14.5c1.5 1.3 3.5 1.3 5 0"/>', make: () => ({ rig: "head",
      parts: [E([0, 0.11, 0], [0.13, 0.125, 0.12]), E([0, 0.04, 0.03], [0.1, 0.07, 0.095]),
        ...both((s) => cut(S([s * 0.048, 0.135, 0.112], 0.036), 0.012)), ...both((s) => S([s * 0.048, 0.135, 0.098], 0.033)),
        S([0, 0.085, 0.13], 0.022), ...both((s) => E([s * 0.128, 0.1, -0.01], [0.02, 0.04, 0.03])),
        cut(C([-0.045, 0.04, 0.123], [0.045, 0.04, 0.123], 0.009), 0.01), ...both((s) => cut(S([s * 0.05, 0.045, 0.118], 0.01), 0.008)),
        C([0, -0.08, -0.01], [0, 0.0, 0], 0.05, 0.05)],
      bones: [bone("neck", null, [0, -0.08, -0.01], [0, 0.0, 0]), bone("head", "neck", [0, 0.0, 0], [0, 0.24, 0])], pb: "end1neck" }) },
    { id: "cat", name: "Cat", size: 3.4, k: 0.03, icon: '<path d="M4 17c0-4 3-6 7-6h4l1-3 1.5 2 1.5-2v4c0 2-1 3-2 3v4M7 17v3M11 17v3M4 15c-1.5-1-2-3-1-5"/>', make: () => quadruped({ bodyY: 0.27, bodyL: 0.38, bodyR: 0.1, rump: 1.05, neck: 0.055, headC: [0, 0.44, 0.3], head: [0.085, 0.075, 0.08], snout: 0.035, ears: "pointy", legX: 0.06, legR: 0.032, thigh: 1.6, backPaw: 1, tail: [[0, 0.42, -0.36], [0, 0.56, -0.33]], tailR: 0.024, tailEnd: 0.7 }) },
    { id: "dog", name: "Dog", size: 3.6, k: 0.035, icon: '<path d="M3 15c0-3 2-5 6-5h5l2-3h3l2 2-1 2h-2v3c0 2-1 3-2 3v3M6 15v5M10 15v5M3 13l-1-3"/>', make: () => quadruped({ bodyY: 0.33, bodyL: 0.46, bodyR: 0.12, rump: 0.95, neck: 0.07, headC: [0, 0.52, 0.34], head: [0.09, 0.085, 0.095], snout: 0.07, ears: "floppy", legX: 0.075, legR: 0.038, thigh: 1.5, backPaw: 1, tail: [[0, 0.46, -0.32], [0, 0.55, -0.36]], tailR: 0.024, tailEnd: 0.6 }) },
    { id: "bunny", name: "Bunny", size: 3, k: 0.04, icon: '<ellipse cx="12" cy="16" rx="6" ry="4.5"/><circle cx="16" cy="10" r="3"/><path d="M15 7.5l-1-5M17.5 7.5l1-5"/>', make: () => quadruped({ bodyY: 0.2, bodyL: 0.26, bodyR: 0.12, rump: 1.25, neck: 0.06, headC: [0, 0.34, 0.2], head: [0.075, 0.07, 0.075], snout: 0.03, ears: "long", legX: 0.055, legR: 0.026, thigh: 2.2, backPaw: 1.6, tail: [[0, 0.24, -0.2], [0, 0.26, -0.22]], tailR: 0.045, tailEnd: 1 }) },
    { id: "bird", name: "Bird", size: 2.8, k: 0.025, icon: '<path d="M4 13c3-5 9-6 13-3l3-1-2 3c0 4-4 6-8 6l-2 3M9 12l5-3"/>', make: () => ({ rig: "bird",
      parts: [E([0, 0.2, 0], [0.085, 0.09, 0.14]), S([0, 0.3, 0.1], 0.062), C([0, 0.3, 0.15], [0, 0.29, 0.21], 0.02, 0.004), ...both((s) => cut(S([s * 0.04, 0.315, 0.135], 0.012), 0.006)),
        ...both((s) => E([s * 0.08, 0.22, -0.01], [0.02, 0.06, 0.12])), E([0, 0.21, -0.17], [0.05, 0.012, 0.07]),
        ...both((s) => C([s * 0.035, 0.13, 0.0], [s * 0.035, 0.02, 0.01], 0.01, 0.008)), ...both((s) => E([s * 0.035, 0.01, 0.03], [0.012, 0.008, 0.035]))],
      bones: [bone("body", null, [0, 0.18, -0.1], [0, 0.22, 0.08]), bone("head", "body", [0, 0.24, 0.07], [0, 0.32, 0.18]), bone("tail", "body", [0, 0.2, -0.11], [0, 0.21, -0.24]),
        ...mirB((s, n) => bone("wing." + n, "body", [s * 0.06, 0.25, 0.02], [s * 0.1, 0.2, -0.12])), ...mirB((s, n) => bone("leg." + n, "body", [s * 0.035, 0.13, 0.0], [s * 0.035, 0.01, 0.03]))],
      pb: ['body', 'head', 'head', 'head', 'head', 'wing.L', 'wing.R', 'tail', 'leg.L', 'leg.R', 'leg.L', 'leg.R'] }) },
    { id: "fish", name: "Fish", size: 3, k: 0.03, icon: '<path d="M3 12c3-5 10-6 14 0-4 6-11 5-14 0zM17 12l4-4v8z"/><circle cx="7" cy="11" r=".8"/>', make: () => ({ rig: "chain",
      parts: [E([0, 0.15, 0.02], [0.05, 0.1, 0.2]), E([0, 0.15, -0.16], [0.032, 0.07, 0.08]), E([0, 0.15, -0.28], [0.01, 0.11, 0.06]),
        E([0, 0.26, -0.02], [0.008, 0.05, 0.08]), ...both((s) => E([s * 0.05, 0.12, 0.06], [0.03, 0.008, 0.045])), ...both((s) => S([s * 0.035, 0.18, 0.15], 0.018))],
      bones: [bone("front", null, [0, 0.15, 0.2], [0, 0.15, 0.0]), bone("middle", "front", [0, 0.15, 0.0], [0, 0.15, -0.16]), bone("tail", "middle", [0, 0.15, -0.16], [0, 0.15, -0.34])],
      pb: ['front', 'middle', 'tail', 'middle', 'front', 'front', 'front', 'front'] }) },
    { id: "grey", name: "Grey alien", size: 4, k: 0.03, icon: '<path d="M12 2c4 0 6.5 2.5 6.5 6 0 3.5-3.5 6.5-6.5 6.5S5.5 11.5 5.5 8C5.5 4.5 8 2 12 2z"/><path d="M8 8l2.5 1.5M16 8l-2.5 1.5M12 14.5v6M9 17l3-1 3 1"/>', make: () => humanoid({ ...ADULT, hip: 0.82, shoulderY: 1.16, neckY: 1.28, headY: 1.5, head: [0.17, 0.2, 0.17], neck: 0.035, hipW: 0.1, torsoW: 0.62, torsoD: 0.75, shoulderX: 0.13, elbow: [0.2, 0.86], wrist: [0.26, 0.56], armW: 0.65, legW: 0.62, legX: 0.06, knee: 0.43, hand: 1.3, foot: 0.8,
      extra: [...both((s) => cut(E([s * 0.075, 1.5, 0.15], [0.06, 0.035, 0.05]), 0.02)), ...both((s) => E([s * 0.075, 1.495, 0.12], [0.055, 0.032, 0.03])), E([0, 1.36, 0.08], [0.06, 0.05, 0.05])] }) },
    { id: "tentacle", name: "Tentacle alien", size: 3.6, k: 0.04, icon: '<circle cx="12" cy="8" r="5.5"/><path d="M8 13c-2 3-1 6-3 7M11 14c0 3-1 5 0 7M13 14c0 3 1 5 0 7M16 13c2 3 1 6 3 7"/>', make: () => {
      const parts = [E([0, 0.42, 0], [0.17, 0.16, 0.15]), ...both((s) => S([s * 0.06, 0.47, 0.13], 0.04)), C([-0.05, 0.37, 0.14], [0.05, 0.37, 0.14], 0.012)];
      const bones = [bone("body", null, [0, 0.3, 0], [0, 0.58, 0])], pb = ['body', 'body', 'body', 'body'];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6, cx = Math.cos(a), cz = Math.sin(a);
        const p0 = [cx * 0.1, 0.3, cz * 0.1], p1 = [cx * 0.2, 0.15, cz * 0.2], p2 = [cx * 0.3, 0.03, cz * 0.3], p3 = [cx * 0.4, 0.06, cz * 0.4];
        parts.push(C(p0, p1, 0.045, 0.035), C(p1, p2, 0.035, 0.024), C(p2, p3, 0.024, 0.01));
        pb.push("tentacle" + (i + 1) + ".1", "tentacle" + (i + 1) + ".2", "tentacle" + (i + 1) + ".3");
        bones.push(bone("tentacle" + (i + 1) + ".1", "body", p0, p1), bone("tentacle" + (i + 1) + ".2", "tentacle" + (i + 1) + ".1", p1, p2), bone("tentacle" + (i + 1) + ".3", "tentacle" + (i + 1) + ".2", p2, p3));
      }
      return { parts, bones, rig: "tentacles", pb };
    } },
    { id: "cyclops", name: "Cyclops alien", size: 3.4, k: 0.04, icon: '<ellipse cx="12" cy="11" rx="7" ry="7.5"/><circle cx="12" cy="9.5" r="2.6"/><path d="M9 18.5v3M15 18.5v3M8 4l-2-2.5M16 4l2-2.5"/>', make: () => humanoid({ ...ADULT, hip: 0.36, shoulderY: 0.6, neckY: 0.66, headY: 0.62, head: [0.26, 0.28, 0.24], neck: 0.08, hipW: 0.16, torsoW: 1, torsoD: 1, shoulderX: 0.27, elbow: [0.38, 0.5], wrist: [0.44, 0.36], armW: 1.1, legW: 1.2, legX: 0.1, knee: 0.2, hand: 0.9, foot: 1.1,
      extra: [cut(S([0, 0.7, 0.24], 0.1), 0.03), S([0, 0.7, 0.2], 0.09), C([-0.08, 0.86, 0.02], [-0.16, 1.06, 0.0], 0.02, 0.012), C([0.08, 0.86, 0.02], [0.16, 1.06, 0.0], 0.02, 0.012), S([-0.16, 1.07, 0], 0.035), S([0.16, 1.07, 0], 0.035), C([-0.1, 0.5, 0.2], [0.1, 0.5, 0.2], 0.018)] }) },
  ];

  // --- the distance model -> mesh (surface nets)
  function sdf(parts, k) {
    // bigger parts first; a part whose box is farther than the blend distance can't change the
    // result, so it is skipped (much quicker)
    const vol = (p) => { const b = bbox(p); return (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]); };
    const prep = (p) => ({ p, b: bbox(p), k: p.k || k });
    const adds = parts.filter((p) => !p.sub).sort((a, b) => vol(b) - vol(a)).map(prep), subs = parts.filter((p) => p.sub).map(prep);
    const one = (p, x, y, z) => (p.t === "c" ? roundCone(x, y, z, p) : ellipsoid(x, y, z, p));
    const boxD = (b, x, y, z) => { const dx = Math.max(b[0] - x, 0, x - b[3]), dy = Math.max(b[1] - y, 0, y - b[4]), dz = Math.max(b[2] - z, 0, z - b[5]); return Math.sqrt(dx * dx + dy * dy + dz * dz); };
    return (x, y, z) => {
      let d = 1e9;
      for (const q of adds) {
        if (d !== 1e9 && boxD(q.b, x, y, z) > d + q.k) continue;
        const v = one(q.p, x, y, z); d = d === 1e9 ? v : smin(d, v, q.k);
      }
      for (const q of subs) {
        if (boxD(q.b, x, y, z) > Math.abs(d) + q.k) continue;
        const v = -one(q.p, x, y, z); d = -smin(-d, -v, q.k);
      }
      return d;
    };
  }
  function mesh(parts, k, res) {
    const f = sdf(parts, k);
    const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (const p of parts) { if (p.sub) continue; const q = bbox(p); for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], q[i]); b[i + 3] = Math.max(b[i + 3], q[i + 3]); } }
    const ext = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]), h = ext / res, pad = 2 * h + k;
    const x0 = b[0] - pad, y0 = b[1] - pad, z0 = b[2] - pad;
    const nx = Math.ceil((b[3] - b[0] + 2 * pad) / h) + 1, ny = Math.ceil((b[4] - b[1] + 2 * pad) / h) + 1, nz = Math.ceil((b[5] - b[2] + 2 * pad) / h) + 1;
    const F = new Float32Array(nx * ny * nz), at = (i, j, l) => (l * ny + j) * nx + i;
    for (let l = 0; l < nz; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[at(i, j, l)] = f(x0 + i * h, y0 + j * h, z0 + l * h);
    // a vertex in every cell the surface passes through, at the average of its edge crossings
    const cid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), cat = (i, j, l) => (l * (ny - 1) + j) * (nx - 1) + i;
    const V = [];
    const E12 = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let l = 0; l < nz - 1; l++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = F[at(i + (c & 1), j + ((c >> 1) & 1), l + ((c >> 2) & 1))]; cv[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, c] of E12) {
        const va = cv[a], vc = cv[c];
        if ((va < 0) === (vc < 0)) continue;
        const t = va / (va - vc);
        sx += (a & 1) + ((c & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((c >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((c >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
      }
      cid[cat(i, j, l)] = V.length / 3;
      V.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (l + sz / n) * h);
    }
    // a quad across every grid edge the surface crosses
    const I = [];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c); };
    for (let l = 1; l < nz - 1; l++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const v0 = F[at(i, j, l)] < 0;
      if (i < nx - 1 && v0 !== (F[at(i + 1, j, l)] < 0)) quad(cid[cat(i, j - 1, l - 1)], cid[cat(i, j, l - 1)], cid[cat(i, j, l)], cid[cat(i, j - 1, l)], v0);
      if (j < ny - 1 && v0 !== (F[at(i, j + 1, l)] < 0)) quad(cid[cat(i - 1, j, l - 1)], cid[cat(i - 1, j, l)], cid[cat(i, j, l)], cid[cat(i, j, l - 1)], v0);
      if (l < nz - 1 && v0 !== (F[at(i, j, l + 1)] < 0)) quad(cid[cat(i - 1, j - 1, l)], cid[cat(i, j - 1, l)], cid[cat(i, j, l)], cid[cat(i - 1, j, l)], v0);
    }
    const pos = new Float32Array(V), idx = new Uint32Array(I);
    // a light smoothing pass takes the grid look off
    relax(pos, idx, 2);
    return { pos, idx };
  }
  function relax(pos, idx, iters) {
    const n = pos.length / 3, nb = Array.from({ length: n }, () => []);
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = idx[t + k], b = idx[t + (k + 1) % 3]; nb[a].push(b); }
    for (let it = 0; it < iters; it++) {
      const P = pos.slice();
      for (let v = 0; v < n; v++) {
        const ns = nb[v]; if (!ns.length) continue;
        let x = 0, y = 0, z = 0; for (const u of ns) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
        const m = ns.length, w = it % 2 ? -0.32 : 0.3; // Taubin: shrink-free smoothing
        pos[v * 3] += (x / m - P[v * 3]) * w; pos[v * 3 + 1] += (y / m - P[v * 3 + 1]) * w; pos[v * 3 + 2] += (z / m - P[v * 3 + 2]) * w;
      }
    }
  }
  // build a character: mesh + skeleton, scaled to its size (Chisel units), centered, feet at y = 0
  function build(id, detail = 1) {
    const ch = LIST.find((c) => c.id === id);
    const spec = ch.make();
    const res = [70, 100, 136][detail] || 100;
    const m = mesh(spec.parts, ch.k, res);
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    const P = m.pos;
    for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
    const s = ch.size / Math.max(x1 - x0, y1 - y0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const T = (p) => [(p[0] - cx) * s, (p[1] - y0) * s, (p[2] - cz) * s];
    for (let i = 0; i < P.length; i += 3) { const q = T([P[i], P[i + 1], P[i + 2]]); P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2]; }
    const bones = spec.bones.map((b) => ({ ...b, head: T(b.head), tail: T(b.tail) }));
    // which bone each part follows ("endNneck": the last N parts are the neck, the rest the head)
    let pb = spec.pb;
    if (typeof pb === 'string') { const nN = +pb[3]; pb = spec.parts.map((_, i) => (i >= spec.parts.length - nN ? 'neck' : 'head')); }
    const parts = [];
    if (pb) spec.parts.forEach((p, i) => {
      if (p.sub || !pb[i]) return;
      if (p.t === 'c') parts.push({ t: 'c', a: T(p.a), b: T(p.b), r1: p.r1 * s, r2: p.r2 * s, bone: pb[i] });
      else parts.push({ t: 'e', c: T(p.c), r: p.r.map((v) => v * s), bone: pb[i] });
    });
    return { pos: m.pos, idx: m.idx, bones, rig: spec.rig, name: ch.name, parts, k: ch.k * s };
  }
  const partDist = (p, x, y, z) => (p.t === 'c' ? roundCone(x, y, z, p) : ellipsoid(x, y, z, p));
  return { LIST, build, mesh, partDist };
})();

// add a character to the scene (like Add shape): standing on the floor, in front of the camera
function addCharacter(id) {
  const ch = CHARS.LIST.find((c) => c.id === id);
  busy('Building ' + ch.name.toLowerCase(), () => {
    pushUndo();
    const m = CHARS.build(id, S.detail);
    // the mesh is centered in x / z with its feet at 0; Chisel objects are centered on their middle
    const P = m.pos; let y0 = 1e9, y1 = -1e9;
    for (let i = 1; i < P.length; i += 3) { y0 = Math.min(y0, P[i]); y1 = Math.max(y1, P[i]); }
    const cy = (y0 + y1) / 2;
    for (let i = 1; i < P.length; i += 3) P[i] -= cy;
    const o = createObj(uniqueName(ch.name), P, m.idx, objects.length % MATCAPS.length);
    const dy = (p) => [p[0], p[1] - cy, p[2]];
    o.skel = { rig: m.rig, ver: Date.now(), k: m.k, bones: m.bones.map((b) => ({ ...b, head: dy(b.head), tail: dy(b.tail) })),
      parts: m.parts.map((p) => (p.t === 'c' ? { ...p, a: dy(p.a), b: dy(p.b) } : { ...p, c: dy(p.c) })) };
    o.mesh.position.set(cam.target.x, -1 + (y1 - y0) / 2, cam.target.z);
    for (let tries = 0; tries < 8 && objects.some(x => x !== o && x.visible && x.mesh.position.distanceTo(o.mesh.position) < 1.2); tries++) {
      o.mesh.position.addScaledVector(new V3().setFromMatrixColumn(camera.matrixWorld, 0), 2.6);
    }
    select(o); refreshAll(); frameAll(o);
    toast(ch.name + ' added · ' + fmt(triCount(o)) + ' triangles · ready to sculpt (or to animate in the Puppet Animator)');
  });
}
function renderChars() {
  const host = $('#charShapes');
  if (!host) return;
  host.innerHTML = CHARS.LIST.map(c => `<button class="chip" data-char="${c.id}" title="Add a ${c.name.toLowerCase()} to sculpt"><svg viewBox="0 0 24 24">${c.icon}</svg>${c.name}</button>`).join('');
  $$('#charShapes .chip').forEach(b => b.addEventListener('click', () => addCharacter(b.dataset.char)));
}

// ---- Textures: a library of patterns (or your own picture), put onto the selected model as
// paint (vertex colors: saved with the sculpt and exported with the OBJ), painted with the
// Paint brush, or raised into the surface as bumps. Sampled "triplanar": the pattern is laid on
// from the three directions and blended by which way the surface faces, so it wraps any shape.
const TEX = (() => {
  const N = 256;
  // tileable value noise
  function noise(seed, cells) {
    const r = (i, j) => { const s = Math.sin((((i % cells) + cells) % cells) * 127.1 + (((j % cells) + cells) % cells) * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
    return (x, y) => { const fx = x * cells, fy = y * cells, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v); return (r(i, j) * (1 - su) + r(i + 1, j) * su) * (1 - sv) + (r(i, j + 1) * (1 - su) + r(i + 1, j + 1) * su) * sv; };
  }
  function fbm(seed, base = 4, oct = 4) { const ns = Array.from({ length: oct }, (_, o) => noise(seed + o * 13, base << o)); return (x, y) => { let s = 0, a = 0.5, t = 0; for (const n of ns) { s += n(x, y) * a; t += a; a *= 0.5; } return s / t; }; }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const P = {
    wood: () => { const n = fbm(1, 3, 3); return (x, y) => { const v = (Math.sin((x * 6 + n(x, y) * 3) * Math.PI * 2) + 1) / 2; return mix(hex("#7a4a22"), hex("#c08a52"), v * 0.8 + n(x * 2 % 1, y) * 0.2); }; },
    marble: () => { const n = fbm(2, 4, 5); return (x, y) => { const v = Math.pow((Math.sin((x + y + n(x, y) * 1.6) * Math.PI * 4) + 1) / 2, 6); return mix(hex("#eceae6"), hex("#6b6f78"), v); }; },
    stone: () => { const n = fbm(3, 6, 4), m = noise(9, 8); return (x, y) => { const v = n(x, y), c = m(x, y); return mix(hex("#5d5f63"), hex("#a3a29d"), v * 0.8 + (c > 0.62 ? 0.15 : 0)); }; },
    bricks: () => { const n = fbm(4, 8, 3); return (x, y) => { const row = Math.floor(y * 8), xx = (x * 4 + (row % 2) * 0.5) % 1, yy = (y * 8) % 1, mortar = xx < 0.06 || yy < 0.12; return mortar ? hex("#cfcac0") : mix(hex("#8e3b2a"), hex("#b4573c"), n(x, y)); }; },
    scales: () => (x, y) => { const sx = x * 8, sy = y * 8, row = Math.floor(sy), cx = (sx + (row % 2) * 0.5) % 1, cy = sy % 1, d = Math.hypot(cx - 0.5, cy - 0.15); return d < 0.62 ? mix(hex("#2f8f5b"), hex("#14492e"), Math.min(1, d / 0.62)) : hex("#0f3b25"); },
    fur: () => { const n = fbm(5, 16, 3), m = noise(6, 4); return (x, y) => mix(hex("#6b4424"), hex("#d9a46a"), n(x * 0.25 % 1, y) * 0.6 + m(x, y) * 0.4); },
    spots: () => (x, y) => { const cx = (x * 6) % 1, cy = (y * 6 + 0.5 * (Math.floor(x * 6) % 2)) % 1; return Math.hypot(cx - 0.5, cy - 0.5) < 0.28 ? hex("#2b2b2b") : hex("#f2c14e"); },
    stripes: () => (x, y) => ((x + y) * 6) % 1 < 0.5 ? hex("#1e2a44") : hex("#f4f1ea"),
    checker: () => (x, y) => (Math.floor(x * 8) + Math.floor(y * 8)) % 2 ? hex("#222222") : hex("#eeeeee"),
    camo: () => { const a = fbm(7, 3, 3), b = fbm(8, 4, 3); return (x, y) => { const u = a(x, y), v = b(x, y); return u > 0.58 ? hex("#3d4a2a") : v > 0.55 ? hex("#7a6a45") : u < 0.4 ? hex("#20251b") : hex("#5d7041"); }; },
    lava: () => { const n = fbm(10, 4, 5); return (x, y) => { const v = n(x, y); return v > 0.55 ? mix(hex("#ff7a00"), hex("#ffe14a"), (v - 0.55) * 3) : mix(hex("#1a0d08"), hex("#5a1e0c"), v / 0.55); }; },
    galaxy: () => { const n = fbm(11, 3, 5), st = noise(12, 64); return (x, y) => { const v = n(x, y), s = st(x, y) > 0.93 ? 1 : 0; return s ? [255, 255, 255] : mix(hex("#0b0b2a"), hex("#7b3fb0"), Math.pow(v, 2) * 1.6); }; },
  };
  const NAMES = { wood: "Wood", marble: "Marble", stone: "Stone", bricks: "Bricks", scales: "Scales", fur: "Fur", spots: "Spots", stripes: "Stripes", checker: "Checker", camo: "Camo", lava: "Lava", galaxy: "Galaxy" };
  const lib = {}; // id -> { name, data (RGBA), w, h, url }
  function make(id) {
    if (lib[id]) return lib[id];
    const f = P[id](), c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), im = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [r, gg, b] = f(x / N, y / N), j = (y * N + x) * 4; im.data[j] = r; im.data[j + 1] = gg; im.data[j + 2] = b; im.data[j + 3] = 255; }
    g.putImageData(im, 0, 0);
    return (lib[id] = { name: NAMES[id], data: im.data, w: N, h: N, url: c.toDataURL() });
  }
  function fromImage(img, name) {
    const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(2, Math.round(img.naturalWidth * k)), h = Math.max(2, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const id = 'img' + Date.now();
    lib[id] = { name: name || 'Picture', data: g.getImageData(0, 0, w, h).data, w, h, url: c.toDataURL() };
    return id;
  }
  const st = { cur: 'wood', scale: 1, depth: 0.35, brush: false };
  // color (0..1) of the texture at a point with a normal (object coordinates)
  function sample(t, u, v) {
    const x = ((u % 1) + 1) % 1 * t.w, y = ((v % 1) + 1) % 1 * t.h, i = Math.min(t.w - 1, x | 0), j = Math.min(t.h - 1, y | 0), k = (j * t.w + i) * 4;
    return [t.data[k] / 255, t.data[k + 1] / 255, t.data[k + 2] / 255];
  }
  function at(t, x, y, z, nx, ny, nz) {
    const s = 0.5 / st.scale; // one tile per 2 / scale units (40 mm at scale 1)
    let wx = Math.pow(Math.abs(nx), 4), wy = Math.pow(Math.abs(ny), 4), wz = Math.pow(Math.abs(nz), 4); const W = wx + wy + wz || 1; wx /= W; wy /= W; wz /= W;
    const a = sample(t, z * s, -y * s), b = sample(t, x * s, z * s), c = sample(t, x * s, -y * s);
    return [a[0] * wx + b[0] * wy + c[0] * wz, a[1] * wx + b[1] * wy + c[1] * wz, a[2] * wx + b[2] * wy + c[2] * wz];
  }
  function colorAt(o, vi) {
    const t = lib[st.cur] || make(st.cur), P = o.pos, N = o.mesh.geometry.attributes.normal.array, i = vi * 3;
    return at(t, P[i], P[i + 1], P[i + 2], N[i], N[i + 1], N[i + 2]);
  }
  // the whole model (masked parts are protected)
  function fill(o) {
    pushUndo(); o.dirty = true;
    const n = o.pos.length / 3, M = o.mask, PT = o.paint;
    for (let v = 0; v < n; v++) { const f = 1 - (M ? M[v] : 0); if (f <= 0) continue; const c = colorAt(o, v); for (let q = 0; q < 3; q++) PT[v * 3 + q] += (c[q] - PT[v * 3 + q]) * f; }
    colorDirty.add(o); o.rev = (o.rev || 0) + 1; req(); refreshAll();
  }
  // raise bright parts of the texture out of the surface (dark parts sink a little)
  function emboss(o) {
    pushUndo(); o.dirty = true;
    const t = lib[st.cur] || make(st.cur), n = o.pos.length / 3, M = o.mask, P = o.pos, N = o.mesh.geometry.attributes.normal.array;
    const d = st.depth * 0.05; // up to 1 mm per step at depth 1
    for (let v = 0; v < n; v++) {
      const f = 1 - (M ? M[v] : 0); if (f <= 0) continue;
      const i = v * 3, c = at(t, P[i], P[i + 1], P[i + 2], N[i], N[i + 1], N[i + 2]), l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) - 0.5;
      P[i] += N[i] * l * d * f; P[i + 1] += N[i + 1] * l * d * f; P[i + 2] += N[i + 2] * l * d * f;
    }
    markGeo(o); refreshAll();
  }
  function renderSec() {
    const sec = $('#texSec');
    if (!sec) return;
    for (const id of Object.keys(P)) make(id);
    const o = sel;
    let h = `<h2><span class="dot"></span>Texture<em>${o ? esc(o.name) : 'select a model'}</em></h2>`;
    h += `<div class="tex-grid">${Object.entries(lib).map(([id, t]) => `<button class="tex-sw" data-tex="${id}" aria-pressed="${id === st.cur}" title="${esc(t.name)}"><img src="${t.url}" alt=""><span>${esc(t.name)}</span></button>`).join('')}<button class="tex-sw tex-add" id="texAdd" title="Use your own picture as a texture"><span class="plus">+</span><span>Your picture</span></button></div>`;
    h += `<label class="row" for="texScale"><span>Size</span><input type="range" id="texScale" min="0.25" max="4" step="0.05" value="${st.scale}"><output>${st.scale.toFixed(2)}×</output></label>`;
    h += `<div class="acts two"><button class="action" id="texFill" ${o ? '' : 'disabled'} title="Color the whole model with the texture (masked parts stay as they are)">Paint model</button><button class="action" id="texRaise" ${o ? '' : 'disabled'} title="Push the texture into the surface as bumps (light parts out, dark parts in). Press again for deeper.">Raise as bumps</button></div>`;
    h += `<label class="row" for="texDepth"><span>Bump depth</span><input type="range" id="texDepth" min="0.05" max="1" step="0.05" value="${st.depth}"><output>${Math.round(st.depth * 100)}%</output></label>`;
    h += `<label class="check" for="texBrush"><input type="checkbox" id="texBrush" ${st.brush ? 'checked' : ''}>Paint brush paints with this texture</label>`;
    h += `<p class="hint">Painted textures are saved with the sculpt and exported with the OBJ. The model's detail decides how sharp a texture looks: subdivide for finer patterns.</p>`;
    sec.innerHTML = h;
    sec.querySelectorAll('[data-tex]').forEach((b) => b.onclick = () => { st.cur = b.dataset.tex; renderSec(); });
    $('#texAdd').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const url = URL.createObjectURL(f), img = new Image(); img.onload = () => { st.cur = fromImage(img, f.name.replace(/\.[^.]+$/, '')); URL.revokeObjectURL(url); renderSec(); }; img.src = url; };
      inp.click();
    };
    const sc = $('#texScale'); sc.oninput = () => { st.scale = +sc.value; sc.nextElementSibling.textContent = st.scale.toFixed(2) + '×'; };
    const dp = $('#texDepth'); dp.oninput = () => { st.depth = +dp.value; dp.nextElementSibling.textContent = Math.round(st.depth * 100) + '%'; };
    $('#texBrush').onchange = (e) => { st.brush = e.target.checked; if (st.brush && S.tool !== 'paint' && !S.easy) setTool('paint'); };
    $('#texFill').onclick = () => { if (sel) busy('Painting texture', () => { fill(sel); toast('Texture painted on ' + sel.name); }); };
    $('#texRaise').onclick = () => { if (sel) busy('Raising texture', () => { emboss(sel); toast('Texture raised on ' + sel.name + ' (Undo takes it back)'); }); };
  }
  return { st, lib, make, colorAt, fill, emboss, renderSec, get brush() { return st.brush; } };
})();
