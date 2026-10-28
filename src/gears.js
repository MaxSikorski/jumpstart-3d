// jumpstart-3d: gears. One dialog (and JS3D.gear) that makes a spur gear, a straight bevel gear or a rack from a module and a tooth
// count: involute teeth (ISO 53 basic rack, 20 degrees), a print clearance, and for spur and bevel gears an optional bore (a DIN 6885
// keyway on spur gears). The result is ordinary sketches of straight lines plus the app's own Extrude (a straight Loft for a bevel
// gear), so it shows in the timeline and undoes in one step. Nothing here touches the geometry kernel.
import { store, nextSeq, regionsFor } from "./store.js";
import { uid, el, fmt, nextColor } from "./util.js";
import { getUnit, withUnit } from "./units.js";

const ALPHA = 20 * Math.PI / 180;
// Helical limits (probe, 2026-10-23). The straight Loft pairs each tooth with the nearest one in the next section, so sections must be at
// most HSTEP tooth pitches of twist apart (0.2 was stepped at 30 teeth, 0.1 held within 0.03 mm). Build time grows with sections x lines:
// about 10 s at HFACES, a stalled engine (25 s) at 60 teeth, so teeth stop at 30.
const HTEETH = [12, 30], HANGLE = [5, 30], HSTEP = 0.1, HFACES = 8000;
const linesOf = (z) => z * (z <= 41 ? 18 : 16); // lines in one outline
const PPF = 8; // points per flank: 10 changed the volume by 0.017 % for 25 % more time
const KINDS = [["spur", "Spur"], ["helical", "Helical"], ["bevel", "Bevel"], ["rack", "Rack"]];
const NOUN = { spur: "Spur gear", helical: "Helical gear", bevel: "Bevel gear", rack: "Rack" };
const TEETH = { spur: [12, 200], helical: HTEETH, bevel: [12, 90], rack: [2, 100] };
const WARN = { spur: 120, bevel: 60 };
// DIN 6885-1 hub groove: bore up to (mm) -> [groove width b, depth below the bore t2]. Bores 6 to 58 only.
const KEY = [[8, 2, 1.0], [10, 3, 1.4], [12, 4, 1.8], [17, 5, 2.3], [22, 6, 2.8], [30, 8, 3.3], [38, 10, 3.3], [44, 12, 3.3], [50, 14, 3.8], [58, 16, 4.3]];
const keyFor = (bore) => KEY.find((k) => bore <= k[0] + 1e-9);

const isNum = (v) => typeof v === "number" && isFinite(v);
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0; // 1e-6 mm, and never -0
const floor3 = (v) => Math.floor(v * 1000 + 1e-6) / 1000;
const inv = (a) => Math.tan(a) - a;

// Spur outline, counter-clockwise, tooth 0 pointing along +x. Tip and root are chords; below 42 teeth the root circle lies inside the
// base circle, so the flank starts at the base circle and a radial line runs down to the root.
// A helical gear's section square to the axis is a spur outline of the transverse module mt and pressure angle alpha; m stays the
// normal module (tooth height), clear the normal clearance.
function spurPoints(z, m, clear, mt = m, alpha = ALPHA) {
  const rp = mt * z / 2, rb = rp * Math.cos(alpha), ra = rp + m, rf = rp - 1.25 * m, r0 = Math.max(rb, rf);
  const psi = (r) => (Math.PI * mt / 2 - clear * mt / m) / (mt * z) + inv(alpha) - inv(Math.acos(Math.min(1, rb / r)));
  const t0 = Math.sqrt(Math.max(0, (r0 / rb) ** 2 - 1)), t1 = Math.sqrt((ra / rb) ** 2 - 1);
  const rs = Array.from({ length: PPF }, (_, i) => rb * Math.sqrt(1 + (t0 + (t1 - t0) * i / (PPF - 1)) ** 2));
  const radial = rf < rb, out = [];
  const at = (r, a) => out.push([r6(r * Math.cos(a)), r6(r * Math.sin(a))]);
  for (let k = 0; k < z; k++) {
    const c = 2 * Math.PI * k / z;
    if (radial) at(rf, c - psi(rb));
    for (const r of rs) at(r, c - psi(r));
    for (let i = rs.length - 1; i >= 0; i--) at(rs[i], c + psi(rs[i]));
    if (radial) at(rf, c + psi(rb));
  }
  return out;
}

// Rack outline, counter-clockwise: runs along +x, teeth point +y, the pitch line is y = 0. It is n pitches long and ends in half gaps,
// so racks lay end to end.
function rackPoints(n, m, clear, base) {
  const p = Math.PI * m, tan = Math.tan(ALPHA), hp = (p / 2 - clear) / 2, hTip = hp - m * tan, hRoot = hp + 1.25 * m * tan;
  const yr = -1.25 * m, yb = yr - base, out = [[0, yb], [n * p, yb], [n * p, yr]];
  for (let k = n - 1; k >= 0; k--) {
    const x = (k + 0.5) * p;
    out.push([x + hRoot, yr], [x + hTip, m], [x - hTip, m], [x - hRoot, yr]);
  }
  out.push([0, yr]);
  return out.map(([x, y]) => [r6(x), r6(y)]);
}

// Checks a request and returns everything a gear needs, or throws a plain message.
function resolve(spec) {
  spec = spec ?? {};
  const kind = spec.kind == null ? "spur" : spec.kind;
  if (!KINDS.some((k) => k[0] === kind)) throw new Error('kind must be "spur", "helical", "bevel" or "rack"');
  const m = spec.module;
  if (!isNum(m) || m < 0.3 - 1e-9 || m > 10 + 1e-9) throw new Error("module must be a number from 0.3 to 10 (mm)");
  const z = spec.teeth, [zMin, zMax] = TEETH[kind];
  if (!Number.isInteger(z) || z < zMin || z > zMax) throw new Error(`teeth must be a whole number from ${zMin} to ${zMax} for ${kind === "rack" ? "a rack" : `a ${kind} gear`}`);
  let beta = 0, hand = "right", twist = 0, sections = 0, mt = m, alphaT = ALPHA;
  if ((spec.angle != null || spec.hand != null) && kind !== "helical") throw new Error("angle and hand are only for helical gears");
  let mate = 0, H = 0;
  if (spec.mate != null && kind !== "bevel") throw new Error("mate is only for bevel gears");
  if (kind === "bevel") {
    mate = spec.mate == null ? z : spec.mate;
    if (!Number.isInteger(mate) || mate < 12 || mate > 200) throw new Error("mate must be a whole number from 12 to 200 (the partner bevel gear's teeth)");
    H = m * mate / 2; // the cone's tip, above the big end
  }
  let width = spec.width;
  if (kind === "helical") {
    const a = spec.angle == null ? 20 : spec.angle;
    if (!isNum(a) || a < HANGLE[0] - 1e-9 || a > HANGLE[1] + 1e-9) throw new Error(`angle must be a number from ${HANGLE[0]} to ${HANGLE[1]} (degrees of helix angle)`);
    hand = spec.hand == null ? "right" : spec.hand;
    if (hand !== "right" && hand !== "left") throw new Error('hand must be "right" or "left"');
    beta = a * Math.PI / 180;
    mt = m / Math.cos(beta);
    alphaT = Math.atan(Math.tan(ALPHA) / Math.cos(beta));
  }
  if (width == null) width = kind === "bevel" ? Math.min(6, Math.floor(H / 3 * 10 + 1e-9) / 10) : 6;
  if (!isNum(width) || width <= 0) throw new Error("width must be a positive number of mm");
  if (kind === "helical") {
    twist = width * Math.tan(beta) / (mt * z / 2); // radians turned over the whole width
    const step = HSTEP * 360 / z; // degrees of twist between sections
    sections = Math.max(2, Math.ceil(twist * 180 / Math.PI / step - 1e-9) + 1);
    if (linesOf(z) * (sections - 1) > HFACES) {
      const maxWidth = floor3((Math.floor(HFACES / linesOf(z)) * step * Math.PI / 180) * (mt * z / 2) / Math.tan(beta));
      throw new Error(`width must be a positive number of mm, at most ${fmt(maxWidth, 3)} for this helical gear (a wider one needs too many sections and would take too long to build)`);
    }
  }
  if (kind === "bevel" && width > H / 3 + 1e-9) throw new Error(`width must be a positive number of mm, at most ${fmt(floor3(H / 3), 3)} for this bevel gear (a third of the way to the cone's tip)`);
  let base = 0;
  if (spec.base != null && kind !== "rack") throw new Error("base is only for racks");
  if (kind === "rack") {
    base = spec.base == null ? 5 : spec.base;
    if (!isNum(base) || base <= 0) throw new Error("base must be a positive number of mm");
  }
  let bore = 0, keyway = false, wall = 0;
  if (kind === "rack") {
    if (spec.bore != null || spec.keyway != null) throw new Error("bore and keyway are not used for a rack");
  } else {
    bore = spec.bore == null ? 0 : spec.bore;
    wall = Math.max(1, m);
    const rf = m * z / 2 - 1.25 * m, rIn = kind === "bevel" ? rf * (1 - width / H) : rf; // under the teeth, at the small end for a bevel gear
    const max = 2 * (rIn - wall);
    if (!isNum(bore) || bore < 0 || (bore > 0 && (bore < 1 - 1e-9 || bore > max + 1e-9))) {
      throw new Error(max < 1 ? "this gear is too small for a bore" : `bore must be 0 (none) or from 1 to ${fmt(floor3(max), 3)} mm for this gear (it leaves ${fmt(wall, 3)} mm under the teeth)`);
    }
    if (spec.keyway != null && typeof spec.keyway !== "boolean") throw new Error("keyway must be true or false");
    if (spec.keyway) {
      if (kind !== "spur") throw new Error("keyway is for spur gears only");
      if (bore < 6 || bore > 58) throw new Error("keyway needs a bore from 6 to 58 mm (DIN 6885)");
      if (bore / 2 + keyFor(bore)[2] > rIn - wall + 1e-9) throw new Error(`the keyway does not fit: it must leave ${fmt(wall, 3)} mm under the teeth`);
      keyway = true;
    }
  }
  const cmax = Math.min(0.5, m / 4);
  const clear = spec.clear == null ? Math.min(0.1, m / 4) : spec.clear;
  if (!isNum(clear) || clear < 0 || clear > cmax + 1e-9) throw new Error(`clear must be a number from 0 to ${fmt(floor3(cmax), 3)} mm for module ${fmt(m, 3)}`);
  const at = spec.at == null ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name == null ? "" : String(spec.name).trim();
  const name = given || `${NOUN[kind]} ${z} teeth m${fmt(m, 3)}`;
  return { kind, m, z, mate, H, width, base, bore, keyway, clear, at, name, beta, hand, twist, sections, mt, alphaT };
}

// Pushes the sketch(es) and the body into the design and returns the body. Sketches sit at the world origin and the body's matrix
// carries the position, as for any Advanced body that has been moved.
function gearBody(doc, r) {
  // A gear has thousands of points and lines. Their IDs repeat in line endpoints and
  // region keys, so full random IDs make saved designs needlessly large. Keep the
  // usual region key (the sorted entity IDs), using short IDs unique in this design.
  const used = new Set();
  for (const sk of doc.sketches) {
    used.add(sk.id);
    for (const list of [sk.pts, sk.ents, sk.cons]) for (const item of list || []) used.add(item.id);
  }
  for (const b of doc.bodies) used.add(b.id);
  let serial = 0;
  const itemId = (prefix) => {
    if (r.kind !== "helical") return uid(prefix);
    let id;
    do { id = prefix + (serial++).toString(36); } while (used.has(id));
    used.add(id);
    return id;
  };
  const sketch = (name, z, poly, bore) => {
    const sk = { id: uid("s"), name, seq: nextSeq(doc), plane: { o: [0, 0, z], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: true };
    const P = (x, y) => { const p = { id: itemId("p"), x, y }; sk.pts.push(p); return p.id; };
    const line = (a, b) => { const e = { id: itemId("e"), t: "line", a, b }; sk.ents.push(e); return e.id; };
    const ids = poly.map(([x, y]) => P(x, y));
    let first;
    ids.forEach((a, i) => { const e = line(a, ids[(i + 1) % ids.length]); if (!i) first = e; });
    if (bore && !bore.key) sk.ents.push({ id: itemId("e"), t: "circle", c: P(0, 0), r: bore.r });
    if (bore && bore.key) {
      // the bore with its groove as one inner loop: an arc counter-clockwise from the groove's left corner the long way round to its
      // right corner, then three lines up and across the groove
      const { r: br, b, top } = bore, hx = b / 2, hy = Math.sqrt(br * br - hx * hx);
      const c = P(0, 0), L = P(r6(-hx), r6(hy)), R = P(r6(hx), r6(hy)), RT = P(r6(hx), r6(top)), LT = P(r6(-hx), r6(top));
      sk.ents.push({ id: itemId("e"), t: "arc", c, a: L, b: R });
      line(R, RT); line(RT, LT); line(LT, L);
    }
    doc.sketches.push(sk);
    const reg = regionsFor(sk).find((g) => g.ents.includes(first));
    return { id: sk.id, ref: { key: reg.key, pt: reg.pt } };
  };
  const kw = r.keyway ? keyFor(r.bore) : null;
  const bore = r.bore > 0 ? (kw ? { r: r.bore / 2, b: kw[1], top: r.bore / 2 + kw[2], key: true } : { r: r.bore / 2 }) : null;
  let node, boreHole = false;
  if (r.kind === "bevel") {
    const poly = spurPoints(r.z, r.m, r.clear), s = 1 - r.width / r.H;
    const big = sketch(r.name + " big end", 0, poly), small = sketch(r.name + " small end", r.width, poly.map(([x, y]) => [r6(x * s), r6(y * s)]));
    node = { t: "loft", sections: [{ sketch: big.id, ref: big.ref }, { sketch: small.id, ref: small.ref }], rail: null, ruled: true, closed: false, mods: [] };
    boreHole = r.bore > 0;
  } else if (r.kind === "helical") {
    const poly = spurPoints(r.z, r.m, r.clear, r.mt, r.alphaT), secs = [];
    for (let i = 0; i < r.sections; i++) {
      const f = i / (r.sections - 1), a = (r.hand === "right" ? 1 : -1) * r.twist * f, c = Math.cos(a), s = Math.sin(a);
      const sk = sketch(`${r.name} section ${i + 1}`, r6(r.width * f), poly.map(([x, y]) => [r6(x * c - y * s), r6(x * s + y * c)]));
      secs.push({ sketch: sk.id, ref: sk.ref });
    }
    node = { t: "loft", sections: secs, rail: null, ruled: true, closed: false, mods: [] };
    boreHole = r.bore > 0;
  } else {
    const s = sketch(r.name, 0, r.kind === "rack" ? rackPoints(r.z, r.m, r.clear, r.base) : spurPoints(r.z, r.m, r.clear), bore);
    node = { t: "extrude", sketch: s.id, profiles: [s.ref], dist: r.width, mode: "one", dist2: 0, mods: [] };
  }
  const body = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: nextColor(), hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r.at[0], r.at[1], r.at[2], 1], node };
  // a bevel gear's bore is the app's own Hole feature, a plain through hole from the small end
  if (boreHole) node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "hole", kind: "simple", dia: r.bore, through: true, depth: r.width + 1, tapped: false, pitch: 0, clear: 0, tip: false, size: "", at: [{ p: [0, 0, r.width], n: [0, 0, 1] }] });
  doc.bodies.push(body);
  return body;
}

export function initGears(app, { openCmd, commit, row, seg }) {
  // used by JS3D.gear: the sketch(es) and the body, one undo step; returns the body's id
  function add(spec) {
    const r = resolve(spec);
    let id;
    store.update((doc) => { id = gearBody(doc, r).id; }, "Add " + r.name);
    return id;
  }

  function cmd() {
    const inch = getUnit() === "in";
    const st = { kind: "spur", m: 2, z: 20, mate: 20, angle: 20, hand: "right", width: inch ? 6.35 : 6, base: 5, bore: 0, key: false, clear: null, r: null, id: null };
    const specOf = (at) => {
      const s = { kind: st.kind, module: st.m, teeth: st.z, width: st.width, at };
      if (st.kind === "bevel") s.mate = st.mate;
      if (st.kind === "helical") { s.angle = st.angle; s.hand = st.hand; }
      if (st.kind === "rack") s.base = st.base;
      else { s.bore = st.bore; if (st.kind === "spur" && st.bore > 0 && st.key) s.keyway = true; }
      if (st.clear != null) s.clear = st.clear;
      return s;
    };
    const check = () => { try { return { r: resolve(specOf([0, 0, 0])) }; } catch (err) { return { err: err.message }; } };
    const def = {
      title: "Gear",
      okLabel: "Create",
      valid: () => !check().err,
      canOk: () => def.valid(),
      apply(doc) { st.id = gearBody(doc, st.r).id; },
      ok() {
        try {
          const t = app.vp.view.target, g = 10;
          st.r = resolve(specOf([Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0]));
        } catch (err) { app.toast(err.message, "err"); return; }
        commit(def, "Add " + st.r.name);
        if (!app.command) app.select([st.id]);
      },
      hint: () => st.kind === "bevel"
        ? "Two sketches and one straight Loft. To change it, undo and run this again."
        : st.kind === "helical"
        ? "A stack of sketches, each turned a little further, and one straight Loft through them. To change it, undo and run this again."
        : "One sketch and one Extrude. Afterwards double-click Extrude in the timeline to change the width; to change the module or teeth, undo and run this again.",
      build(body) {
        const note = (text, cls = "hint", id) => body.append(el("div", { class: cls, id, style: { padding: 0 } }, text));
        const num = (id, value, set, o) => app.numField({ value, id, onCommit: (v) => { set(v); def.render(); }, ...o });
        body.append(row("Kind", seg(KINDS, st.kind, (v) => { st.kind = v; def.render(); }, "ge-kind")));
        body.append(row(st.kind === "helical" ? "Normal module" : "Module", num("ge-mod", st.m, (v) => (st.m = v), { len: false, min: 0.3, max: 10, step: 0.5 }), "ge-mod"));
        body.append(row("Teeth", num("ge-teeth", st.z, (v) => (st.z = Math.round(v)), { len: false, min: 2, max: 200, step: 1 }), "ge-teeth"));
        if (st.kind === "helical") {
          body.append(row("Helix angle", num("ge-angle", st.angle, (v) => (st.angle = v), { len: false, min: HANGLE[0], max: HANGLE[1], step: 1 }), "ge-angle"));
          body.append(row("Hand", seg([["right", "Right"], ["left", "Left"]], st.hand, (v) => { st.hand = v; def.render(); }, "ge-hand")));
        }
        if (st.kind === "bevel") body.append(row("Partner's teeth", num("ge-mate", st.mate, (v) => (st.mate = Math.round(v)), { len: false, min: 12, max: 200, step: 1 }), "ge-mate"));
        body.append(row("Width", num("ge-width", st.width, (v) => (st.width = v), { len: true, min: 0.01, step: 1 }), "ge-width"));
        if (st.kind === "rack") body.append(row("Base", num("ge-base", st.base, (v) => (st.base = v), { len: true, min: 0.01, step: 1 }), "ge-base"));
        else body.append(row("Bore", num("ge-bore", st.bore, (v) => (st.bore = v), { len: true, min: 0, step: 1 }), "ge-bore"));
        if (st.kind === "spur" && st.bore > 0) {
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ge-key", checked: st.key, onchange: (e) => { st.key = e.target.checked; def.render(); } }), "Keyway (DIN 6885)"));
        }
        const { r, err } = check();
        body.append(row("Print clearance", num("ge-clear", st.clear ?? (r ? r.clear : Math.min(0.1, st.m / 4)), (v) => (st.clear = v), { len: true, min: 0, max: 0.5, step: 0.05 }), "ge-clear"));
        if (err) { note(err, "err-msg", "ge-err"); return; }
        const m = r.m, z = r.z, d = m * z, p = Math.PI * m;
        if (r.kind === "helical") note(`Normal module ${fmt(m, 3)}, so the pitch diameter is ${withUnit(r.mt * z, 3)}, outside ${withUnit(r.mt * z + 2 * m, 3)}, root ${withUnit(r.mt * z - 2.5 * m, 3)}. The teeth turn ${fmt(r.twist * 180 / Math.PI, 3)}° from one face to the other. A partner of the same module and helix angle, but the opposite hand, meshes with its centre module × (${z} + its teeth) / (2 × cos ${fmt(r.beta * 180 / Math.PI, 3)}°) away.`);
        else if (r.kind === "spur") note(`Pitch diameter ${withUnit(d, 3)}, outside ${withUnit(d + 2 * m, 3)}, root ${withUnit(d - 2.5 * m, 3)}. A partner of the same module meshes with its centre module × (${z} + its teeth) / 2 away.${inch ? ` Diametral pitch ${fmt(25.4 / m, 3)}.` : ""}`);
        else if (r.kind === "bevel") note(`Big end: pitch diameter ${withUnit(d, 3)}, outside ${withUnit(d + 2 * m, 3)}. Meshes at 90° with a ${r.mate}-tooth bevel gear of the same module; the cone's tip is ${withUnit(r.H, 3)} above the big end.`);
        else note(`${withUnit(z * p, 3)} long, tooth pitch ${withUnit(p, 3)}. The pitch line is ${withUnit(m, 3)} below the tooth tips.`);
        if (r.keyway) { const k = keyFor(r.bore); note(`Keyway ${withUnit(k[1], 3)} wide, ${withUnit(k[2], 3)} deep (DIN 6885 for a ${withUnit(r.bore, 3)} shaft).`); }
        if (r.kind !== "rack" && z < 17) note("Fewer than 17 teeth: a real gear this small is undercut at the root to make room for its partner. This one is not, so against a larger gear it can rub; keep some print clearance, or use 17 teeth or more.");
        if (r.kind === "spur" && z > WARN.spur) note(`${z} teeth: the gear builds in a few seconds, but its sketch has ${z * (z <= 41 ? 18 : 16)} lines and is slow to open and edit.`);
        if (r.kind === "bevel" && z > WARN.bevel) note(`${z} teeth: a bevel gear this size takes a few seconds to build, longer on a phone.`);
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
