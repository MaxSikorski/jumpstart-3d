// jumpstart-3d: compression springs. One dialog (and JS3D.spring) that makes a round-wire coil spring from the wire thickness, the
// outside diameter, the free length and the number of turns, with open ends or ends cut flat. The result is the app's own Coil
// shape (a circular section swept along a helix, sitting inside the outside diameter), so it shows in the timeline and undoes in one
// step; flat ends are two Split body planes on that Coil. Nothing here touches the geometry kernel.
// Closed (squared) end turns are not offered: they need a variable-pitch helix, which the kernel does not have.
import { store, nextSeq } from "./store.js";
import { uid, el } from "./util.js";
import { getUnit, withUnit } from "./units.js";

const ENDS = [["open", "Open"], ["flat", "Flat cut"]];
const HANDS = [["right", "Right"], ["left", "Left"]];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_TURNS = 10; // 20 turns builds in 6-9 s at Normal but 24-31 s (800k triangles) at Fine, over the 10 s a click should take
const MAX_WIRE = 600; // wire length in wire thicknesses: about 150k triangles; 3000 stalls the geometry engine, 1500 of a 0.4 mm wire takes 11 s
const MIN_GAP = 1.05; // pitch / wire: the Coil refuses anything under 1.01; this leaves a visible gap

const isNum = (v) => typeof v === "number" && isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Checks a request and returns everything a spring needs, or throws a plain message. The checks run in the order the messages are
// listed in BRIDGE.md.
export function resolve(spec) {
  spec = spec ?? {};
  const w = spec.wire == null ? 2 : spec.wire;
  if (!inRange(w, 0.4, 10)) throw new Error("wire must be a number from 0.4 to 10 (mm)");
  const O = spec.outside == null ? 20 : spec.outside;
  if (!inRange(O, 2, 200)) throw new Error("outside must be a number from 2 to 200 (mm)");
  if (O < 5 * w - 1e-9) throw new Error(`outside must be at least five wire diameters (${r3(5 * w)} mm for this wire)`);
  const L = spec.freeLength == null ? 30 : spec.freeLength;
  if (!inRange(L, 1, 300)) throw new Error("freeLength must be a number from 1 to 300 (mm)");
  const N = spec.turns == null ? 5 : spec.turns;
  if (!inRange(N, 2, MAX_TURNS) || Math.abs(N * 2 - Math.round(N * 2)) > 1e-9) throw new Error(`turns must be a number from 2 to ${MAX_TURNS}, in steps of a half`);
  const hand = spec.hand == null ? "right" : spec.hand;
  if (hand !== "right" && hand !== "left") throw new Error('hand must be "right" or "left"');
  const ends = spec.ends == null ? "open" : spec.ends;
  if (ends !== "open" && ends !== "flat") throw new Error('ends must be "open" or "flat"');
  const color = spec.color == null ? "#7d8a96" : spec.color;
  if (typeof color !== "string" || !COLOR.test(color)) throw new Error('color must look like "#rrggbb"');
  const at = spec.at == null ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name == null ? "" : String(spec.name).trim();
  const name = given || `Spring ${r3(O)} x ${r3(L)}`;
  const R = (O - w) / 2, C = 2 * Math.PI * R;
  let p, tilt = 1; // tilt: cos of the helix angle, the end of an open spring is cut square to the wire
  if (ends === "flat") p = L / N;
  else {
    // the free length of an open spring is N p + w cos(alpha): bisect for the pitch that gives L (the function only rises)
    let lo = 0, hi = L / N;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (N * mid + w / Math.sqrt(1 + (mid / C) ** 2) < L) lo = mid; else hi = mid;
    }
    p = (lo + hi) / 2;
    tilt = 1 / Math.sqrt(1 + (p / C) ** 2);
  }
  if (p < MIN_GAP * w - 1e-9) throw new Error("The coils would touch. Increase the free length, use fewer turns, or use thinner wire.");
  if (N * Math.hypot(C, p) > MAX_WIRE * w) throw new Error("This spring needs too much wire to build. Use fewer turns, a smaller outside diameter or thicker wire.");
  // where the coil's lowest point is, relative to the body's origin: the body is lowered by this much so the spring stands on z = at
  const drop = ends === "flat" ? w / 2 : w * (1 - tilt) / 2;
  return { w, O, L, N, hand, ends, color, at, name, R, C, p, drop, gap: p - w };
}

// Pushes the body into the design and returns it. The body's matrix carries the position (lowered by `drop`); the cut planes are in
// the body's own coordinates, the coil's wire starts at z = w/2.
function springBody(doc, r) {
  const mods = [];
  if (r.ends === "flat") {
    mods.push({ id: uid("f"), seq: nextSeq(doc), t: "halfspace", plane: { o: [0, 0, r.w / 2], n: [0, 0, 1] }, side: 1 });
    mods.push({ id: uid("f"), seq: nextSeq(doc), t: "halfspace", plane: { o: [0, 0, r.L + r.w / 2], n: [0, 0, 1] }, side: -1 });
  }
  const body = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: r.color, hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r.at[0], r.at[1], r6(r.at[2] - r.drop), 1],
    node: { t: "coil", d: r.O, turns: r.N, mode: "pitch", pitch: r6(r.p), angle: 0, section: "circle", size: r.w, pos: "inside", left: r.hand === "left", mods } };
  doc.bodies.push(body);
  return body;
}

export function initSpring(app, { openCmd, commit, row, seg }) {
  // used by JS3D.spring: one body, one undo step; returns the body's id
  function add(spec) {
    const r = resolve(spec);
    let id;
    store.update((doc) => { id = springBody(doc, r).id; }, "Add " + r.name);
    return id;
  }

  function cmd() {
    const inch = getUnit() === "in";
    const st = { wire: inch ? 1.5875 : 2, outside: inch ? 19.05 : 20, freeLength: inch ? 31.75 : 30, turns: 5, hand: "right", ends: "open", r: null, id: null };
    const specOf = (at) => ({ wire: st.wire, outside: st.outside, freeLength: st.freeLength, turns: st.turns, hand: st.hand, ends: st.ends, at });
    const check = () => { try { return { r: resolve(specOf([0, 0, 0])) }; } catch (err) { return { err: err.message }; } };
    const def = {
      title: "Spring",
      okLabel: "Create",
      valid: () => !check().err,
      canOk: () => def.valid(),
      apply(doc) { st.id = springBody(doc, st.r).id; },
      ok() {
        try {
          const t = app.vp.view.target, g = 10;
          st.r = resolve(specOf([Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0]));
        } catch (err) { app.toast(err.message, "err"); return; }
        commit(def, "Add " + st.r.name);
        if (!app.command) app.select([st.id]);
      },
      hint: () => "A compression spring of round wire. Afterwards double-click Coil in the timeline to change it; the flat cuts of a Flat cut spring stay where they are, so undo and run this again to change the length.",
      build(body) {
        const note = (text, cls = "hint", id) => body.append(el("div", { class: cls, id, style: { padding: 0 } }, text));
        const num = (id, value, set, o) => app.numField({ value, id, onCommit: (v) => { set(v); def.render(); }, ...o });
        body.append(row("Wire", num("sp-wire", st.wire, (v) => (st.wire = v), { len: true, min: 0.4, max: 10, step: 0.1 }), "sp-wire"));
        body.append(row("Outside", num("sp-out", st.outside, (v) => (st.outside = v), { len: true, min: 2, max: 200, step: 1 }), "sp-out"));
        body.append(row("Free length", num("sp-len", st.freeLength, (v) => (st.freeLength = v), { len: true, min: 1, max: 300, step: 1 }), "sp-len"));
        body.append(row("Turns", num("sp-turns", st.turns, (v) => (st.turns = v), { len: false, min: 2, max: MAX_TURNS, step: 0.5 }), "sp-turns"));
        body.append(row("Hand", seg(HANDS, st.hand, (v) => { st.hand = v; def.render(); }, "sp-hand")));
        body.append(row("Ends", seg(ENDS, st.ends, (v) => { st.ends = v; def.render(); }, "sp-ends")));
        const { r, err } = check();
        if (err) { note(err, "err-msg", "sp-err"); return; }
        note(`Pitch ${withUnit(r.p, 3)}, gap between coils ${withUnit(r.gap, 3)}, ${withUnit(r.O - 2 * r.w, 3)} inside across.${r.ends === "open" ? " The ends are cut square to the wire." : " The last bit of wire at each end is ground flat."} Square (closed) ends are not made yet.`);
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
