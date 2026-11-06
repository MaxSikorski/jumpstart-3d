// ================= Action Figures =================
// Posable action figures that print: a figure is 15 separate parts (head, chest, pelvis, upper
// arms, forearms, hands, thighs, shins and feet) joined by snap-fit ball-and-socket joints. Each
// part is its own sculpt, so it can be sculpted further. Every joint is exact (made from distance
// functions, meshed finely): a ball on a peg on one part, and in the other part a round socket a
// little bigger than the ball (the clearance) with a cone-shaped opening that is narrower than the
// ball, so the ball snaps in and stays, and the joint turns about 25-35 degrees each way.
// Sizes here are millimetres, Y up, the figure facing +Z, feet on y = 0. A Chisel unit is 20 mm.
const FIG = (() => {
  const U = 20, deg = Math.PI / 180;
  const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const norm = (a) => { const l = len3(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const C = (a, b, r1, r2 = r1) => ({ t: 'c', a, b, r1, r2 }), E = (c, r) => ({ t: 'e', c, r }), B = (c, h, r) => ({ t: 'b', c, h, r });
  // a rounded box (half sizes h, corner radius r)
  const rbox = (p, x, y, z) => { const qx = Math.abs(x - p.c[0]) - p.h[0] + p.r, qy = Math.abs(y - p.c[1]) - p.h[1] + p.r, qz = Math.abs(z - p.c[2]) - p.h[2] + p.r; return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - p.r; };
  const dist = (p, x, y, z) => (p.t === 'b' ? rbox(p, x, y, z) : CHARS.partDist(p, x, y, z));
  const box = (p) => (p.t === 'b' ? [p.c[0] - p.h[0], p.c[1] - p.h[1], p.c[2] - p.h[2], p.c[0] + p.h[0], p.c[1] + p.h[1], p.c[2] + p.h[2]] : CHARS.bbox(p));

  // ---------------------------------------------------------------- templates
  // proportions are fractions of the height (before it is scaled to exactly the height asked for)
  const BASE = { head: [0.058, 0.07, 0.064], headY: 0.925, neckY: 0.857, shoulderY: 0.812, shoulderX: 0.142, chest: [0.104, 0.098, 0.064], chestY: 0.725, pelvis: [0.088, 0.058, 0.062], pelvisY: 0.535, waistY: 0.618, hipY: 0.5, hipX: 0.052,
    knee: 0.285, ankle: 0.052, arm: 0.172, fore: 0.158, spread: 16, thigh: [0.05, 0.035], shin: [0.035, 0.024], upper: [0.031, 0.025], forearm: [0.025, 0.02], hand: [0.019, 0.04, 0.027], foot: [0.028, 0.024, 0.07], k: 0.012, boxy: false, ears: true };
  const TEMPLATES = [
    { id: 'hero', name: 'Hero', note: 'broad shoulders, strong build', p: { shoulderX: 0.152, chest: [0.112, 0.102, 0.068], upper: [0.034, 0.027], forearm: [0.028, 0.021], thigh: [0.053, 0.037], pelvis: [0.084, 0.056, 0.062] } },
    { id: 'heroine', name: 'Heroine', note: 'athletic, narrower shoulders', p: { shoulderX: 0.135, chest: [0.096, 0.094, 0.062], pelvis: [0.094, 0.06, 0.064], hipX: 0.056, head: [0.055, 0.068, 0.062], upper: [0.028, 0.023], forearm: [0.023, 0.019] } },
    { id: 'kid', name: 'Kid', note: 'young proportions, bigger head', p: { head: [0.085, 0.095, 0.088], headY: 0.88, neckY: 0.79, shoulderY: 0.75, shoulderX: 0.13, chestY: 0.665, chest: [0.1, 0.085, 0.066], waistY: 0.57, pelvisY: 0.5, hipY: 0.465, knee: 0.27, arm: 0.15, fore: 0.135 } },
    { id: 'chibi', name: 'Chibi', note: 'huge head, tiny body', p: { head: [0.14, 0.15, 0.135], headY: 0.8, neckY: 0.655, shoulderY: 0.615, shoulderX: 0.12, chestY: 0.545, chest: [0.095, 0.075, 0.07], waistY: 0.47, pelvisY: 0.415, pelvis: [0.085, 0.05, 0.065], hipY: 0.385, hipX: 0.05, knee: 0.22, ankle: 0.06, arm: 0.12, fore: 0.105, spread: 24, thigh: [0.046, 0.038], shin: [0.038, 0.03], upper: [0.032, 0.028], forearm: [0.028, 0.024], hand: [0.024, 0.036, 0.03], foot: [0.032, 0.028, 0.06], ears: false } },
    { id: 'robot', name: 'Robot', note: 'blocky armour plates', p: { boxy: true, k: 0.004, shoulderX: 0.155, chest: [0.112, 0.1, 0.07], pelvis: [0.085, 0.055, 0.06], head: [0.055, 0.058, 0.058], upper: [0.032, 0.029], forearm: [0.03, 0.026], thigh: [0.048, 0.04], shin: [0.04, 0.034], ears: false } },
    { id: 'alien', name: 'Alien', note: 'big head, long thin limbs', p: { head: [0.07, 0.095, 0.075], headY: 0.9, shoulderX: 0.13, chest: [0.088, 0.09, 0.055], pelvis: [0.075, 0.05, 0.05], arm: 0.195, fore: 0.185, upper: [0.024, 0.02], forearm: [0.02, 0.017], thigh: [0.042, 0.03], shin: [0.03, 0.022], hand: [0.016, 0.05, 0.024], ears: false } },
    { id: 'mannequin', name: 'Mannequin', note: 'plain smooth parts to sculpt from scratch', p: { ears: false } },
  ];
  const FITS = [['tight', 'Tight', 0.1], ['standard', 'Standard', 0.15], ['loose', 'Loose', 0.25]];
  const st = { tpl: 'hero', H: 150, build: 1, headS: 1, shoulders: 1, arms: 1, legs: 1, fit: 'standard', detail: 'print', homes: new Map(), last: null };

  // ---------------------------------------------------------------- the figure as parts
  // each part: { name, prims (smoothly blended), k, balls, sockets, clears }
  function design(o) {
    const T = TEMPLATES.find((t) => t.id === o.tpl) || TEMPLATES[0], q = { ...BASE, ...T.p };
    const b = o.build, sw = o.shoulders, al = o.arms, ll = o.legs, hs = o.headS;
    // the skeleton in height fractions (legs and arms scaled around the hips and shoulders)
    const hipY = q.hipY, kneeY = hipY - (hipY - q.knee) * ll, ankleY = kneeY - (q.knee - q.ankle) * ll, footY = ankleY - q.ankle * 0.92;
    const sx = q.shoulderX * sw, sp = q.spread * deg;
    const J = { neck: [0, q.neckY, 0], waist: [0, q.waistY, 0] };
    for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
      J['shoulder' + n] = [s * sx, q.shoulderY, 0];
      J['elbow' + n] = add(J['shoulder' + n], [s * Math.sin(sp) * q.arm * al, -Math.cos(sp) * q.arm * al, 0]);
      J['wrist' + n] = add(J['elbow' + n], [s * Math.sin(sp * 0.8) * q.fore * al, -Math.cos(sp * 0.8) * q.fore * al, 0.01]);
      const hx = Math.max(q.hipX, q.thigh[0] * b * 1.12 + 0.005);
      J['hip' + n] = [s * hx, hipY, 0];
      J['knee' + n] = [s * hx * 1.12, kneeY, 0.004];
      J['ankle' + n] = [s * hx * 1.18, ankleY, 0];
    }
    const top = q.headY + q.head[1] * hs, scale = o.H / (top - footY), Y = (p) => [p[0] * scale, (p[1] - footY) * scale, p[2] * scale];
    for (const k in J) J[k] = Y(J[k]);
    const R = (v) => v * scale * b;
    // the joints: ball diameter (fraction of the height, at least 4 mm), cone half-angle, which
    // part has the socket (parent) and which the ball (owner)
    const JT = { neck: [0.038, 50], waist: [0.05, 45], shoulder: [0.036, 55], elbow: [0.03, 55], wrist: [0.026, 50], hip: [0.042, 52], knee: [0.034, 55], ankle: [0.03, 48] };
    const clear = (FITS.find((f) => f[0] === o.fit) || FITS[1])[2], gap = 0.6;
    const parts = {}, P = (name) => (parts[name] = parts[name] || { name, prims: [], housings: [], balls: [], sockets: [], clears: [], cuts: [], k: q.k * scale });
    const joints = [];
    // rc: about how thick the moving part is at the joint. The parent is cut back where the moving
    // part goes (a round tube along it), and the moving part is cut flat behind the joint, so the
    // only things that cross a joint are the socket housing and the ball.
    const joint = (kind, at, parent, owner, toward, rc) => {
      const [f, ang] = JT[kind], rb = Math.max(2, (f * o.H) / 2), w = Math.max(1.2, 0.45 * rb), Rh = rb + clear + w, u = norm(sub(toward, at));
      P(parent).housings.push(E(at, [Rh, Rh, Rh]));
      const ta = Math.tan((kind === 'elbow' || kind === 'knee' ? 18 : 12) * deg);
      P(parent).cuts.push({ c: at, u, R: Math.max(Rh + gap, rc + 3.2), L: len3(...sub(toward, at)) * 1.2 + 6, tube: true, ta });
      P(owner).cuts.push({ c: at, u, R: rc * 2 + 6, tube: false, ta });
      P(parent).sockets.push({ c: at, rs: rb + clear, u, th: ang * deg, Rh });
      P(owner).clears.push({ c: at, R: Rh + gap });
      P(owner).balls.push({ c: at, r: rb, u, L: Rh + gap + 2.2, rn: Math.max(1.1, 0.5 * rb) });
      // how much narrower the socket's mouth is than the ball (what holds it in), and how far it turns
      joints.push({ kind, rb, clear, Rh, ang, hold: rb - (rb + clear) * Math.sin(ang * deg), turn: ang - Math.asin(Math.max(1.1, 0.5 * rb) / (rb + clear)) / deg });
    };
    // head
    const hc = Y([0, q.headY, 0.004]), hr = [q.head[0] * hs * scale, q.head[1] * hs * scale, q.head[2] * hs * scale];
    const head = P('Head');
    if (q.boxy) head.prims.push(B(hc, hr, hr[0] * 0.35), B(add(hc, [0, -hr[1] * 0.55, hr[2] * 0.2]), [hr[0] * 0.8, hr[1] * 0.45, hr[2] * 0.75], hr[0] * 0.2), B(add(hc, [0, hr[1] * 0.1, hr[2] * 0.92]), [hr[0] * 0.75, hr[1] * 0.18, hr[2] * 0.12], hr[0] * 0.06));
    else {
      head.prims.push(E(hc, hr), E(add(hc, [0, -hr[1] * 0.45, hr[2] * 0.22]), [hr[0] * 0.78, hr[1] * 0.55, hr[2] * 0.72]), E(add(hc, [0, -hr[1] * 0.05, hr[2] * 0.95]), [hr[0] * 0.13, hr[1] * 0.16, hr[2] * 0.14]));
      if (q.ears) for (const s of [1, -1]) head.prims.push(E(add(hc, [s * hr[0] * 0.98, -hr[1] * 0.05, -hr[2] * 0.05]), [hr[0] * 0.14, hr[1] * 0.26, hr[2] * 0.2]));
      if (o.tpl === 'alien') for (const s of [1, -1]) head.prims.push(E(add(hc, [s * hr[0] * 0.4, hr[1] * 0.05, hr[2] * 0.82]), [hr[0] * 0.32, hr[1] * 0.18, hr[2] * 0.2]));
    }
    // chest (with the neck, shoulder and waist joints) and pelvis
    const cc = Y([0, q.chestY, 0]), cr = [q.chest[0] * sw * scale * Math.sqrt(b), q.chest[1] * scale, q.chest[2] * scale * Math.sqrt(b)];
    const chest = P('Chest');
    if (q.boxy) chest.prims.push(B(cc, cr, cr[2] * 0.25), B(add(cc, [0, cr[1] * 0.45, 0]), [cr[0] * 1.08, cr[1] * 0.45, cr[2] * 1.02], cr[2] * 0.2));
    else chest.prims.push(E(cc, cr), E(add(cc, [0, cr[1] * 0.42, -cr[2] * 0.05]), [cr[0] * 1.12, cr[1] * 0.42, cr[2] * 0.85]), ...(o.tpl === 'hero' || o.tpl === 'mannequin' ? [1, -1].map((s) => E(add(cc, [s * cr[0] * 0.42, cr[1] * 0.25, cr[2] * 0.55]), [cr[0] * 0.48, cr[1] * 0.34, cr[2] * 0.5])) : []));
    const pc = Y([0, q.pelvisY, 0]), pr = [q.pelvis[0] * scale * Math.sqrt(b), q.pelvis[1] * scale, q.pelvis[2] * scale * Math.sqrt(b)];
    const pelvis = P('Pelvis');
    if (q.boxy) pelvis.prims.push(B(pc, pr, pr[2] * 0.3)); else pelvis.prims.push(E(pc, pr), E(add(pc, [0, pr[1] * 0.7, 0]), [pr[0] * 0.8, pr[1] * 0.6, pr[2] * 0.85]));
    joint('neck', J.neck, 'Head', 'Chest', add(J.neck, [0, -10, 0]), Math.max(cr[0], cr[2]) * 1.2);
    joint('waist', J.waist, 'Chest', 'Pelvis', add(J.waist, [0, -10, 0]), Math.max(pr[0], pr[2]) * 1.15);
    const limb = (n, a, bb, r1, r2) => { const p = P(n); if (q.boxy) { const m = mul(add(a, bb), 0.5), h = [r1 * 0.95, len3(...sub(bb, a)) / 2, r1 * 0.95]; const dir = norm(sub(bb, a)); p.prims.push(B(m, h, r1 * 0.3)); p.axis = dir; } else p.prims.push(C(a, bb, r1, r2), E(add(mul(a, 0.62), mul(bb, 0.38)), [r1 * 1.08, len3(...sub(bb, a)) * 0.3, r1 * 1.05])); };
    for (const [s, n, side] of [[1, 'L', 'left'], [-1, 'R', 'right']]) {
      const U_ = 'Upper arm (' + side + ')', F_ = 'Forearm (' + side + ')', H_ = 'Hand (' + side + ')', T_ = 'Thigh (' + side + ')', S_ = 'Shin (' + side + ')', Ft = 'Foot (' + side + ')';
      limb(U_, J['shoulder' + n], J['elbow' + n], R(q.upper[0]), R(q.upper[1]));
      limb(F_, J['elbow' + n], J['wrist' + n], R(q.forearm[0]), R(q.forearm[1]));
      const hd = norm(sub(J['wrist' + n], J['elbow' + n])), hcn = add(J['wrist' + n], mul(hd, R(q.hand[1]) * 0.95 + 1.5));
      P(H_).prims.push(E(hcn, [R(q.hand[0]) * 1.05, R(q.hand[1]), R(q.hand[2])]), C(add(hcn, [0, R(q.hand[1]) * 0.3, R(q.hand[2]) * 0.75]), add(hcn, [s * R(q.hand[0]) * 0.2, -R(q.hand[1]) * 0.2, R(q.hand[2]) * 1.45]), R(q.hand[0]) * 0.42, R(q.hand[0]) * 0.32));
      limb(T_, J['hip' + n], J['knee' + n], R(q.thigh[0]), R(q.thigh[1]));
      limb(S_, J['knee' + n], J['ankle' + n], R(q.shin[0]) * 1.06, R(q.shin[1]));
      const fc = [J['ankle' + n][0], R(q.foot[1]) * 0.98, J['ankle' + n][2] + R(q.foot[2]) * 0.42];
      if (q.boxy) P(Ft).prims.push(B(fc, [R(q.foot[0]), R(q.foot[1]), R(q.foot[2])], R(q.foot[0]) * 0.3)); else P(Ft).prims.push(E(fc, [R(q.foot[0]), R(q.foot[1]), R(q.foot[2])]), E(add(fc, [0, R(q.foot[1]) * 0.4, -R(q.foot[2]) * 0.55]), [R(q.foot[0]) * 0.9, R(q.foot[1]) * 1.1, R(q.foot[2]) * 0.38]));
      joint('shoulder', J['shoulder' + n], 'Chest', U_, J['elbow' + n], R(q.upper[0]) * 1.08);
      joint('elbow', J['elbow' + n], U_, F_, J['wrist' + n], R(q.forearm[0]) * 1.08);
      joint('wrist', J['wrist' + n], F_, H_, hcn, R(q.hand[0]) * 1.1);
      joint('hip', J['hip' + n], 'Pelvis', T_, J['knee' + n], R(q.thigh[0]) * 1.08);
      joint('knee', J['knee' + n], T_, S_, J['ankle' + n], R(q.shin[0]) * 1.14);
      joint('ankle', J['ankle' + n], S_, Ft, add(J['ankle' + n], [0, -10, 0]), R(q.foot[2]) * 0.9);
    }
    // limbs stand off the chest and pelvis: nothing of a part may come into its neighbour's
    // socket housing (the clears), and a little gap is kept everywhere at rest
    return { parts: Object.values(parts), joints, scale };
  }
  // the signed distance of one part (mm)
  function field(part) {
    const prims = part.prims.map((p) => ({ p, b: box(p) })), k = part.k, hs = part.housings || [], cuts = part.cuts || [];
    return (x, y, z) => {
      let d = 1e9;
      for (const q of prims) { const v = dist(q.p, x, y, z); d = d === 1e9 ? v : CHARS.smin(d, v, k); }
      for (const c of cuts) {
        const vx = x - c.c[0], vy = y - c.c[1], vz = z - c.c[2], t = vx * c.u[0] + vy * c.u[1] + vz * c.u[2];
        const rad = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - t * t)), back = 0.45 + rad * c.ta; // a gap that opens outward, so the joint can bend
        if (c.tube) d = Math.max(d, -Math.max(rad - c.R - 0.5 * Math.max(0, t), -(t + back), t - c.L));
        else d = Math.max(d, -Math.max(t - back, len3(vx, vy, vz) - c.R));
      }
      for (const h of hs) { const v = dist(h, x, y, z); d = d === 1e9 ? v : CHARS.smin(d, v, Math.min(k, 1.2)); }
      for (const c of part.clears) d = Math.max(d, c.R - len3(x - c.c[0], y - c.c[1], z - c.c[2]));
      for (const s of part.sockets) {
        const vx = x - s.c[0], vy = y - s.c[1], vz = z - s.c[2], r = len3(vx, vy, vz), t = vx * s.u[0] + vy * s.u[1] + vz * s.u[2];
        const rad = Math.sqrt(Math.max(0, r * r - t * t));
        const cone = Math.max(Math.cos(s.th) * rad - Math.sin(s.th) * t, -t, r - (s.Rh + 3));
        const cav = Math.min(r - s.rs, cone);
        d = Math.max(d, -cav);
      }
      for (const b of part.balls) {
        const vx = x - b.c[0], vy = y - b.c[1], vz = z - b.c[2];
        d = Math.min(d, len3(vx, vy, vz) - b.r);
        // the peg: a rod from the ball's centre into the part
        const t = Math.max(0, Math.min(b.L, vx * b.u[0] + vy * b.u[1] + vz * b.u[2]));
        d = Math.min(d, len3(vx - b.u[0] * t, vy - b.u[1] * t, vz - b.u[2] * t) - b.rn);
      }
      return d;
    };
  }
  function bounds(part) {
    const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], grow = (q) => { for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], q[i]); b[i + 3] = Math.max(b[i + 3], q[i + 3]); } };
    for (const p of part.prims) grow(box(p));
    for (const p of part.housings || []) grow(box(p));
    for (const s of part.balls) grow([s.c[0] - s.r, s.c[1] - s.r, s.c[2] - s.r, s.c[0] + s.r, s.c[1] + s.r, s.c[2] + s.r]);
    return b;
  }
  function meshPart(part, cell) { return CHARS.meshField(field(part), bounds(part), part.k + 1, 0, cell, 1); }

  // ---------------------------------------------------------------- into the scene
  function buildFigure() {
    const o = { ...st }, T = TEMPLATES.find((t) => t.id === o.tpl) || TEMPLATES[0];
    busy('Building the ' + T.name.toLowerCase() + ' action figure', () => {
      pushUndo();
      const d = design(o), cell = o.detail === 'print' ? Math.max(0.2, Math.min(0.36, o.H / 540)) : Math.max(0.35, o.H / 280);
      const base = uniqueName(T.name + ' figure'), made = [];
      const ox = cam.target.x, oz = cam.target.z;
      d.parts.forEach((part, i) => {
        const m = meshPart(part, cell), P = m.pos;
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
        for (let j = 0; j < P.length; j += 3) { P[j] /= U; P[j + 1] = P[j + 1] / U - 1; P[j + 2] /= U; x0 = Math.min(x0, P[j]); x1 = Math.max(x1, P[j]); y0 = Math.min(y0, P[j + 1]); y1 = Math.max(y1, P[j + 1]); z0 = Math.min(z0, P[j + 2]); z1 = Math.max(z1, P[j + 2]); }
        const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
        for (let j = 0; j < P.length; j += 3) { P[j] -= c[0]; P[j + 1] -= c[1]; P[j + 2] -= c[2]; }
        const ob = createObj(base + ' · ' + part.name, P, m.idx, (i * 3) % MATCAPS.length);
        ob.mesh.position.set(ox + c[0], c[1], oz + c[2]);
        st.homes.set(ob.id, ob.mesh.position.clone());
        ob.figSet = base;
        made.push(ob);
      });
      st.last = base;
      select(made[1] || made[0]); refreshAll(); frameAll(); renderSec();
      const j = d.joints, by = (k) => j.find((x) => x.kind === k);
      toast(`${base}: ${made.length} parts, ${j.length} ball joints (balls Ø${(2 * by('wrist').rb).toFixed(1)}-${(2 * by('waist').rb).toFixed(1)} mm, ${by('neck').clear} mm clearance). Lay it out for printing when ready.`);
    });
  }
  const setOf = (name) => objects.filter((x) => x.visible !== false && (x.figSet === name || (x.name || '').startsWith(name + ' · ')));
  function sets() { const s = new Set(); for (const x of objects) { const m = /^(.* figure(?: \d+)?) · /.exec(x.name || ''); if (m) s.add(m[1]); } return [...s]; }
  // the parts side by side on the floor, gaps between, for printing (each stands as it is)
  function layout(name) {
    const parts = setOf(name); if (!parts.length) return;
    pushUndo();
    const gapU = 5 / U, rowW = 200 / U;
    let x = 0, z = 0, rowD = 0;
    const boxes = parts.map((ob) => { ob.mesh.geometry.computeBoundingBox(); return ob.mesh.geometry.boundingBox; });
    const ox = cam.target.x - rowW / 2, oz = cam.target.z;
    parts.forEach((ob, i) => {
      if (!st.homes.has(ob.id)) st.homes.set(ob.id, ob.mesh.position.clone());
      const b = boxes[i], w = b.max.x - b.min.x, dd = b.max.z - b.min.z;
      if (x > 0 && x + w > rowW) { x = 0; z += rowD + gapU; rowD = 0; }
      ob.mesh.position.set(ox + x - b.min.x, -1 - b.min.y, oz + z - b.min.z);
      x += w + gapU; rowD = Math.max(rowD, dd);
    });
    st.laid = true;
    refreshAll(); frameAll();
    toast(`${parts.length} parts laid out 5 mm apart. Print them as they stand (no supports needed for most), 0.12-0.16 mm layers, then snap the balls into the sockets.`);
  }
  function assemble(name) {
    const parts = setOf(name).filter((ob) => st.homes.has(ob.id)); if (!parts.length) { toast('Nothing to put back together (it was made in an earlier session).', true); return; }
    pushUndo();
    for (const ob of parts) ob.mesh.position.copy(st.homes.get(ob.id));
    st.laid = false;
    refreshAll(); frameAll();
  }
  // a ball joint kit for figures made from scratch: a ball on a peg (join it to the part that
  // moves), a housing (join it to the other part) and a socket cutter (subtract it from that part)
  function jointKit() {
    const rb = Math.max(2, st.H * 0.02), clear = (FITS.find((f) => f[0] === st.fit) || FITS[1])[2], w = Math.max(1.2, 0.45 * rb), Rh = rb + clear + w;
    const at = [0, 0, 0], u = [0, -1, 0];
    const mk = (name, part, ci) => {
      const m = CHARS.meshField(field(part), bounds(part), 0.5, 0, 0.12, 1), P = m.pos;
      for (let j = 0; j < P.length; j++) P[j] /= U;
      const ob = createObj(uniqueName(name), P, m.idx, ci % MATCAPS.length);
      ob.mesh.position.set(cam.target.x, cam.target.y || 0, cam.target.z);
      return ob;
    };
    busy('Making a ball joint', () => {
      pushUndo();
      const ball = mk('Joint ball', { prims: [], k: 0.5, clears: [], sockets: [], balls: [{ c: at, r: rb, u, L: Rh + 3, rn: Math.max(1.1, 0.55 * rb) }] }, 1);
      const housing = mk('Joint housing', { prims: [E(at, [Rh, Rh, Rh])], k: 0.5, clears: [], sockets: [{ c: at, rs: rb + clear, u, th: 55 * deg, Rh }], balls: [] }, 3);
      housing.mesh.position.x += (2 * Rh + 4) / U;
      const cutter = mk('Joint socket cutter', { prims: [E(at, [rb + clear, rb + clear, rb + clear]), C(at, mul(u, Rh + 3), (rb + clear) * Math.sin(55 * deg), (Rh + 3) * Math.sin(55 * deg))], k: 0.01, clears: [], sockets: [], balls: [] }, 5);
      cutter.mesh.position.x -= (2 * Rh + 4) / U;
      select(ball); refreshAll(); frameAll();
      toast(`Ball Ø${(2 * rb).toFixed(1)} mm, socket Ø${(2 * (rb + clear)).toFixed(2)} mm. Put the ball where a part should turn and Join it to that part; Join the housing to the other part, or Subtract the cutter from it, at the same spot.`);
    });
  }

  // ---------------------------------------------------------------- the panel section
  function renderSec() {
    const host = $('#figSec'); if (!host) return;
    const ss = sets();
    host.innerHTML = `<div class="sub-h chars-h">Action figures</div>
      <div class="shapes chars" id="figTpls">${TEMPLATES.map((t) => `<button class="chip" data-fig="${t.id}" title="${t.name}: ${t.note}. Opens the builder.">${t.name}</button>`).join('')}</div>
      <div class="fig-row"><button class="chip" id="figKit" title="A ball, housing and socket cutter to join your own sculpted parts">Ball joint kit</button></div>
      ${ss.length ? `<div class="fig-row"><select id="figSet" aria-label="Figure">${ss.map((n) => `<option${n === st.last ? ' selected' : ''}>${n}</option>`).join('')}</select><button class="chip" id="figLay" title="Parts side by side on the floor, ready to print">Lay out to print</button><button class="chip" id="figAsm" title="Put the parts back together">Assemble</button></div>` : ''}`;
    $$('#figTpls .chip').forEach((b) => b.addEventListener('click', () => openBuilder(b.dataset.fig)));
    $('#figKit').onclick = () => jointKit();
    if (ss.length) { $('#figLay').onclick = () => layout($('#figSet').value); $('#figAsm').onclick = () => assemble($('#figSet').value); }
  }
  function openBuilder(tpl) {
    if (tpl) st.tpl = tpl;
    let dlg = $('#figDlg'); if (dlg) dlg.remove();
    dlg = document.createElement('div'); dlg.id = 'figDlg'; dlg.className = 'fig-dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Action figure builder');
    const T = TEMPLATES.find((t) => t.id === st.tpl);
    const sl = (k, label, lo, hi, stp) => `<label class="fig-sl">${label}<input type="range" id="fig-${k}" min="${lo}" max="${hi}" step="${stp}" value="${st[k]}"><b id="fig-${k}-v">${st[k]}</b></label>`;
    dlg.innerHTML = `<h3>Action figure builder</h3>
      <div class="fig-tpls">${TEMPLATES.map((t) => `<button class="chip${t.id === st.tpl ? ' on' : ''}" data-t="${t.id}" title="${t.note}">${t.name}</button>`).join('')}</div>
      <p class="fig-note">${T.name}: ${T.note}. 15 parts, 14 snap-fit ball joints (neck, shoulders, elbows, wrists, waist, hips, knees, ankles).</p>
      <label class="fig-sl">Height (mm)<input type="number" id="fig-H" min="60" max="400" step="5" value="${st.H}"></label>
      ${sl('build', 'Build', 0.8, 1.3, 0.05)}${sl('headS', 'Head size', 0.8, 1.4, 0.05)}${sl('shoulders', 'Shoulders', 0.85, 1.2, 0.05)}${sl('arms', 'Arm length', 0.85, 1.2, 0.05)}${sl('legs', 'Leg length', 0.85, 1.2, 0.05)}
      <div class="fig-seg">Joint fit ${FITS.map(([v, l, c]) => `<button class="chip${st.fit === v ? ' on' : ''}" data-fit="${v}" title="${c} mm clearance between ball and socket">${l}</button>`).join('')}</div>
      <div class="fig-seg">Detail <button class="chip${st.detail === 'draft' ? ' on' : ''}" data-det="draft" title="Quicker to make: for trying ideas">Draft</button><button class="chip${st.detail === 'print' ? ' on' : ''}" data-det="print" title="Fine mesh: accurate balls and sockets for printing">Print</button></div>
      <p class="fig-note" id="fig-info"></p>
      <div class="fig-btns"><button class="chip" id="fig-cancel">Cancel</button><button class="chip primary" id="fig-go">Build figure</button></div>`;
    document.body.append(dlg);
    const info = () => { const d = design(st), by = (k) => d.joints.find((x) => x.kind === k); $('#fig-info').textContent = `Balls Ø${(2 * by('wrist').rb).toFixed(1)} mm (wrists) to Ø${(2 * by('waist').rb).toFixed(1)} mm (waist), sockets ${(2 * by('neck').clear).toFixed(2)} mm bigger. Print in PLA or PETG at 0.12-0.16 mm layers; ${st.fit === 'tight' ? 'tight joints hold poses best but may need a drop of heat to snap in' : st.fit === 'loose' ? 'loose joints move easily but may not hold heavy poses' : 'standard joints snap in by hand and hold poses'}.`; };
    info();
    $$('.fig-tpls .chip', dlg).forEach((b) => b.onclick = () => openBuilder(b.dataset.t));
    for (const k of ['build', 'headS', 'shoulders', 'arms', 'legs']) $('#fig-' + k).oninput = (e) => { st[k] = +e.target.value; $('#fig-' + k + '-v').textContent = st[k]; info(); };
    $('#fig-H').onchange = (e) => { st.H = Math.max(60, Math.min(400, +e.target.value || 150)); e.target.value = st.H; info(); };
    $$('[data-fit]', dlg).forEach((b) => b.onclick = () => { st.fit = b.dataset.fit; openBuilder(); });
    $$('[data-det]', dlg).forEach((b) => b.onclick = () => { st.detail = b.dataset.det; openBuilder(); });
    $('#fig-cancel').onclick = () => dlg.remove();
    $('#fig-go').onclick = () => { dlg.remove(); buildFigure(); };
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
  }
  return { TEMPLATES, FITS, st, design, field, bounds, meshPart, buildFigure, layout, assemble, jointKit, renderSec, openBuilder, sets };
})();
window.__FIG = FIG; FIG.objects = () => objects;
