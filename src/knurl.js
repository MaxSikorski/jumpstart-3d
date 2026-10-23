// jumpstart-3d: knurled knobs. One dialog (and JS3D.knurl) that makes a straight (axial) knurled cylinder: V grooves all round, with an
// optional round, hex or D-shaped bore. The result is ordinary nodes: one hidden sketch (2N lines alternating between the tip radius
// and the root radius, plus the bore) and the app's own Extrude, so it is a true solid that exports to STEP, shows in the timeline
// and undoes in one step. Nothing here touches the geometry kernel. A diamond knurl is the mesh Texture, not this.
import { store, nextSeq, regionsFor } from "./store.js";
import { uid, el, fmt, nextColor } from "./util.js";
import { getUnit, withUnit } from "./units.js";

const BORES = [["none", "None"], ["round", "Round"], ["hex", "Hex"], ["d", "D shaft"]];
const BORE_DEFAULT = { round: 5, hex: 8, d: 5 }; // mm; hex is across flats
const WALL = 1; // mm of material left between the bore and the groove roots
const D_FLAT = 0.4; // a D shaft's flat sits this fraction of the diameter from the centre (5 mm shaft: 4.5 mm across)
const MIN_PITCH = 0.8; // mm, finer than most nozzles print

const isNum = (v) => typeof v === "number" && isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0; // 1e-6 mm, and never -0
const r3 = (v) => Math.round(v * 1000) / 1000;
const floor3 = (v) => Math.floor(v * 1000 + 1e-6) / 1000;
const autoDepth = (D, N) => r3(Math.PI * D / N / 2); // a 90 degree V: its depth is half the pitch
const autoGrooves = (D) => Math.min(120, Math.max(8, Math.round(Math.PI * D))); // about 1 mm between grooves

// Checks a request and returns everything a knob needs, or throws a plain message. The checks run in the order the messages are
// listed in BRIDGE.md.
function resolve(spec) {
  spec = spec ?? {};
  const D = spec.diameter == null ? 20 : spec.diameter;
  if (!inRange(D, 6, 150)) throw new Error("diameter must be a number from 6 to 150 (mm)");
  const L = spec.length == null ? 15 : spec.length;
  if (!inRange(L, 1, 200)) throw new Error("length must be a number from 1 to 200 (mm)");
  const N = spec.grooves == null ? autoGrooves(D) : spec.grooves;
  if (!Number.isInteger(N) || N < 8 || N > 120) throw new Error("grooves must be a whole number from 8 to 120");
  const R = D / 2, maxDepth = floor3(R / 2);
  const depth = spec.depth == null ? autoDepth(D, N) : spec.depth;
  if (!inRange(depth, 0.1, maxDepth)) throw new Error(`depth must be a number from 0.1 to ${fmt(maxDepth, 3)} mm for this diameter (the grooves can reach at most half way to the middle)`);
  const bore = spec.bore == null ? "none" : spec.bore;
  if (!BORES.some((b) => b[0] === bore)) throw new Error('bore must be "none", "round", "hex" or "d"');
  if (bore === "none" && spec.boreSize != null) throw new Error('boreSize is only for a bore "round", "hex" or "d"');
  const root = R - depth, bs = bore === "none" ? 0 : spec.boreSize == null ? BORE_DEFAULT[bore] : spec.boreSize;
  if (bore !== "none") {
    // the largest corner of the bore (a hex's corners, a D's round part) stays WALL under the grooves
    const max = floor3(bore === "hex" ? Math.sqrt(3) * (root - WALL) : 2 * (root - WALL));
    if (max < 1) throw new Error("this knob is too small for a bore: use a larger diameter, or bore \"none\"");
    if (!inRange(bs, 1, max)) throw new Error(`boreSize must be a number from 1 to ${fmt(max, 3)} mm for this knob (it leaves ${WALL} mm under the grooves)${bore === "hex" ? ", measured across flats" : ""}`);
  }
  const at = spec.at == null ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name == null ? "" : String(spec.name).trim();
  const name = given || `Knurled knob ${fmt(D, 3)} x ${fmt(L, 3)}`;
  const pitch = Math.PI * D / N;
  return { D, L, N, R, depth, root, pitch, bore, bs, at, name };
}

// Pushes the sketch and the body into the design and returns the body. The sketch sits at the world origin and the body's matrix
// carries the position, as for any Advanced body that has been moved. Tooth 0 points along +x.
function knurlBody(doc, r) {
  const sk = { id: uid("s"), name: r.name, seq: nextSeq(doc), plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: true };
  const P = (x, y) => { const p = { id: uid("p"), x: r6(x), y: r6(y) }; sk.pts.push(p); return p.id; };
  const line = (a, b) => { const e = { id: uid("e"), t: "line", a, b }; sk.ents.push(e); return e.id; };
  const ring = [];
  for (let i = 0; i < r.N; i++) {
    const a = 2 * Math.PI * i / r.N, b = a + Math.PI / r.N;
    ring.push(P(r.R * Math.cos(a), r.R * Math.sin(a)), P(r.root * Math.cos(b), r.root * Math.sin(b)));
  }
  let first;
  ring.forEach((a, i) => { const e = line(a, ring[(i + 1) % ring.length]); if (!i) first = e; });
  if (r.bore === "round") sk.ents.push({ id: uid("e"), t: "circle", c: P(0, 0), r: r.bs / 2 });
  else if (r.bore === "hex") {
    const c = r.bs / Math.sqrt(3), v = [0, 1, 2, 3, 4, 5].map((k) => P(c * Math.cos(k * Math.PI / 3), c * Math.sin(k * Math.PI / 3)));
    v.forEach((a, i) => line(a, v[(i + 1) % 6]));
  } else if (r.bore === "d") {
    // the flat on the +x side; an arc runs counter-clockwise from its top corner the long way round to its bottom corner
    const rr = r.bs / 2, h = D_FLAT * r.bs, y = Math.sqrt(rr * rr - h * h), c = P(0, 0), top = P(h, y), bottom = P(h, -y);
    sk.ents.push({ id: uid("e"), t: "arc", c, a: top, b: bottom });
    line(bottom, top);
  }
  doc.sketches.push(sk);
  const reg = regionsFor(sk).find((g) => g.ents.includes(first));
  const body = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: nextColor(), hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r.at[0], r.at[1], r.at[2], 1],
    node: { t: "extrude", sketch: sk.id, profiles: [{ key: reg.key, pt: reg.pt }], dist: r.L, mode: "one", dist2: 0, mods: [] } };
  doc.bodies.push(body);
  return body;
}

export function initKnurl(app, { openCmd, commit, row, seg }) {
  // used by JS3D.knurl: the sketch and the body, one undo step; returns the body's id
  function add(spec) {
    const r = resolve(spec);
    let id;
    store.update((doc) => { id = knurlBody(doc, r).id; }, "Add " + r.name);
    return id;
  }

  function cmd() {
    const inch = getUnit() === "in";
    const st = { D: inch ? 19.05 : 20, L: inch ? 12.7 : 15, N: 60, depth: null, bore: "round", size: { round: inch ? 6.35 : 5, hex: inch ? 7.9375 : 8, d: inch ? 6.35 : 5 }, r: null, id: null };
    const specOf = (at) => {
      const s = { diameter: st.D, length: st.L, grooves: st.N, bore: st.bore, at };
      if (st.depth != null) s.depth = st.depth;
      if (st.bore !== "none") s.boreSize = st.size[st.bore];
      return s;
    };
    const check = () => { try { return { r: resolve(specOf([0, 0, 0])) }; } catch (err) { return { err: err.message }; } };
    const def = {
      title: "Knurled knob",
      okLabel: "Create",
      valid: () => !check().err,
      canOk: () => def.valid(),
      apply(doc) { st.id = knurlBody(doc, st.r).id; },
      ok() {
        try {
          const t = app.vp.view.target, g = 10;
          st.r = resolve(specOf([Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0]));
        } catch (err) { app.toast(err.message, "err"); return; }
        commit(def, "Add " + st.r.name);
        if (!app.command) app.select([st.id]);
      },
      hint: () => "One sketch and one Extrude. Afterwards double-click Extrude in the timeline to change the length; to change the diameter, grooves or bore, undo and run this again.",
      build(body) {
        const note = (text, cls = "hint", id) => body.append(el("div", { class: cls, id, style: { padding: 0 } }, text));
        const num = (id, value, set, o) => app.numField({ value, id, onCommit: (v) => { set(v); def.render(); }, ...o });
        body.append(row("Diameter", num("kn-dia", st.D, (v) => (st.D = v), { len: true, min: 6, max: 150, step: 1 }), "kn-dia"));
        body.append(row("Length", num("kn-len", st.L, (v) => (st.L = v), { len: true, min: 1, max: 200, step: 1 }), "kn-len"));
        body.append(row("Grooves", num("kn-n", st.N, (v) => (st.N = Math.round(v)), { len: false, min: 8, max: 120, step: 1 }), "kn-n"));
        const { r, err } = check();
        body.append(row("Groove depth", num("kn-depth", st.depth ?? autoDepth(st.D, st.N), (v) => (st.depth = v), { len: true, min: 0.1, step: 0.1 }), "kn-depth"));
        body.append(row("Bore", seg(BORES, st.bore, (v) => { st.bore = v; def.render(); }, "kn-bore")));
        if (st.bore !== "none") body.append(row(st.bore === "hex" ? "Across flats" : "Bore size", num("kn-bore-size", st.size[st.bore], (v) => (st.size[st.bore] = v), { len: true, min: 1, step: 0.5 }), "kn-bore-size"));
        if (err) { note(err, "err-msg", "kn-err"); return; }
        note(`${r.N} grooves, ${withUnit(r.pitch, 3)} apart, ${withUnit(r.depth, 3)} deep; the root is ${withUnit(2 * r.root, 3)} across. Straight grooves along the length, a true solid. For a diamond pattern use Texture: it works on the mesh and is not kept in a STEP file.`);
        if (r.pitch < MIN_PITCH) note(`Grooves closer than ${withUnit(MIN_PITCH, 3)} are finer than most printers can print: use fewer grooves or a larger diameter.`);
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
