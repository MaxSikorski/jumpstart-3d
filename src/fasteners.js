// jumpstart-3d: fasteners. One dialog (and JS3D.fastener) that makes a whole part: a hex bolt, a hex nut, a threaded rod or a tap
// cutter, in metric (ISO coarse) or inch (UNC / UNF) sizes. The parts are ordinary bodies: plain shapes, a group, and the app's own
// Thread feature (so the thread shows in the timeline and edits with the Thread dialog). Nothing here touches the geometry kernel.
// Thread diameters and pitches come from the Thread dialog's table (STD, passed in). Only the head and nut sizes are listed here.
import { store, nextSeq } from "./store.js";
import { uid, el, fmt } from "./util.js";
import { getUnit, withUnit } from "./units.js";

const IN = 25.4;
const MAX_TURNS = 150, WARN_TURNS = 60;
const COLOR = "#9fb1c4";
const TYPES = [["bolt", "Bolt"], ["nut", "Nut"], ["rod", "Threaded rod"], ["cutter", "Tap cutter"]];
const NOUN = { bolt: "bolt", nut: "nut", rod: "threaded rod", cutter: "tap cutter" };

// diameter -> [head across flats, head height k, nut across flats, nut thickness m]
// metric, in mm: ISO 4017 (hex head bolt) and ISO 4032 (hex nut)
const HEX = {
  "M2.5": [5, 1.7, 5, 2], M3: [5.5, 2, 5.5, 2.4], M4: [7, 2.8, 7, 3.2], M5: [8, 3.5, 8, 4.7],
  M6: [10, 4, 10, 5.2], M8: [13, 5.3, 13, 6.8], M10: [16, 6.4, 16, 8.4], M12: [18, 7.5, 18, 10.8],
};
// inch, in inches (converted below): ASME B18.6.3 hex machine screws and nuts (#6 to #10), B18.2.1 hex bolts and B18.2.2 hex nuts
const HEX_IN = {
  "#6": [0.25, 0.093, 0.3125, 0.109], "#8": [0.25, 0.11, 0.344, 0.125], "#10": [0.3125, 0.12, 0.375, 0.125],
  "1/4": [0.4375, 0.172, 0.4375, 0.219], "5/16": [0.5, 0.219, 0.5, 0.266], "3/8": [0.5625, 0.25, 0.5625, 0.328], "1/2": [0.75, 0.344, 0.75, 0.438],
};
for (const [k, v] of Object.entries(HEX_IN)) HEX[k] = v.map((x) => +(x * IN).toFixed(3));

// the sizes offered, in the order shown; the UNF rows use their diameter's row above
const METRIC = ["M2.5", "M3", "M4", "M5", "M6", "M8", "M10", "M12"];
const INCH = ["#6-32", "#8-32", "#10-24", "#10-32", "1/4-20", "1/4-28", "5/16-18", "5/16-24", "3/8-16", "3/8-24", "1/2-13", "1/2-20"];
const SIZES = [...METRIC, ...INCH];
const isMetric = (key) => key[0] === "M";
const diaKey = (key) => (isMetric(key) ? key : key.replace(/-\d+$/, ""));

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && isFinite(x));
const lengthText = (mm) => (getUnit() === "in" ? fmt(mm / IN, 3) + '"' : fmt(mm, 3));

// Checks a request and returns everything a part needs, or throws a plain message.
// the STD row for a size key such as "M8" or "1/4-20"
const findStd = (STD, key) => STD.find((s) => (isMetric(key) ? s[3] === "iso" && "M" + s[1] === key : s[0] === key + " UNC" || s[0] === key + " UNF"));

export function resolve(spec, STD) {
  spec = spec ?? {};
  const type = spec.type;
  if (!TYPES.some((t) => t[0] === type)) throw new Error('type must be "bolt", "nut", "rod" or "cutter"');
  const key = spec.size;
  const std = SIZES.includes(key) && findStd(STD, key);
  if (!std) throw new Error(`unknown size "${key}"; sizes: ${SIZES.join(", ")}`);
  const [, d, p] = std;
  const [af, k, nutAf, m] = HEX[diaKey(key)];
  let length = 0;
  if (type !== "nut") {
    length = spec.length;
    if (typeof length !== "number" || !isFinite(length) || length < 3 * p - 1e-9) throw new Error(`length must be a number of at least ${+(3 * p).toFixed(3)} mm for ${key}`);
    const turns = Math.round(length / p);
    if (turns > MAX_TURNS) throw new Error(tooMany(turns));
  }
  const clear = spec.clear === undefined ? 0 : spec.clear;
  if (typeof clear !== "number" || !isFinite(clear) || clear < -1 || clear > 0) throw new Error("clear must be a number from -1 to 0 (mm)");
  const left = spec.left === undefined ? false : spec.left;
  if (typeof left !== "boolean") throw new Error("left must be true or false");
  const at = spec.at === undefined ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name === undefined || spec.name === null ? "" : String(spec.name).trim();
  const name = given ? given : type === "nut" ? `${key} nut` : `${key}×${lengthText(length)} ${NOUN[type]}`;
  return { type, key, d, p, af, k, nutAf, m, length, clear, left, at, name };
}

const tooMany = (n) => `Too many turns (${n}; the most is ${MAX_TURNS}). Make it shorter or pick a larger size.`;

// A hex prism with the given width across flats; its corners sit at radius w / 2.
const hexPrism = (af, h) => { const w = +((af * 2) / Math.sqrt(3)).toFixed(3); return { t: "prim", kind: "prism", p: { w, d: w, h, sides: 6, r: 0, c: 0 }, mods: [] }; };
const cylinder = (dia, h) => ({ t: "prim", kind: "cylinder", p: { w: dia, d: dia, h, r: 0, c: 0 }, mods: [] });
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// The body for one part. Each part is its own body, so each builds on its own.
function partBody(doc, r) {
  const { type, d, p, k, af, nutAf, m, length: L, clear, left, at } = r;
  const body = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: COLOR, hole: type === "cutter", hidden: false, m: IDENTITY.slice(), node: null };
  body.m[12] = at[0]; body.m[13] = at[1]; body.m[14] = at[2];
  const thread = (z, c) => ({ id: uid("f"), seq: nextSeq(doc), t: "thread", face: { c: [0, 0, z], t: "CYLINDRE" }, pitch: p, length: 0, flip: false, left, clear: c });
  if (type === "bolt") {
    // the head sits on the bed, the shank above it; the thread goes on the group and finds the shank's round face
    const shank = IDENTITY.slice(); shank[14] = k;
    body.node = { t: "group", children: [
      { node: hexPrism(af, k), m: IDENTITY.slice(), hole: false, name: "head" },
      { node: cylinder(d, L), m: shank, hole: false, name: "shank" },
    ], mods: [thread(k + L / 2, clear)] };
  } else if (type === "nut") {
    // a hex prism with a plain hole at the thread's minor diameter, then the thread cut into the hole wall (a thread mod, not a
    // tapped hole, so a left-hand nut works)
    const node = hexPrism(nutAf, m);
    node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "hole", kind: "simple", dia: +(d - 1.0825 * p).toFixed(3), through: true, depth: m + 1, tapped: false, pitch: 0, clear: 0, tip: false, size: "", at: [{ p: [0, 0, m], n: [0, 0, 1] }] });
    node.mods.push(thread(m / 2, clear));
    body.node = node;
  } else {
    // a rod; a cutter is a rod marked as a hole. A bolt's print offset thins the thread, which loosens it. A hole works the other way
    // round (a thinner cutter would make a tighter hole), so the cutter is built wider and its thread has no offset. The kernel puts a
    // nut's flanks s (the offset) further out, and the flanks of the plain ISO profile on a rod grown by s in radius sit just there, so
    // the radius grows by s (the diameter by 2s).
    const grow = type === "cutter" ? 2 * Math.min(Math.abs(clear), 0.2 * p) : 0;
    const node = cylinder(+(d + grow).toFixed(4), L);
    node.mods.push(thread(L / 2, type === "cutter" ? 0 : clear));
    body.node = node;
  }
  return body;
}

export function initFasteners(app, { openCmd, commit, row, seg, offsetSelect, STD }) {
  const find = (key) => findStd(STD, key);

  // used by JS3D.fastener: one body, one undo step; returns its id
  function add(spec) {
    const r = resolve(spec, STD);
    let id;
    store.update((doc) => { const b = partBody(doc, r); doc.bodies.push(b); id = b.id; }, "Add " + r.name);
    return id;
  }

  function cmd() {
    const inch = getUnit() === "in";
    const st = { type: "bolt", size: inch ? "1/4-20" : "M8", length: inch ? IN : 30, left: false, clear: store.doc.threadOffset || 0, r: null };
    const pitch = () => find(st.size)[2];
    const turns = () => (st.type === "nut" ? 0 : Math.round(st.length / pitch()));
    const def = {
      title: "Fastener",
      okLabel: "Create",
      valid: () => turns() <= MAX_TURNS,
      canOk: () => def.valid(),
      apply(doc) { const b = partBody(doc, st.r); doc.bodies.push(b); st.id = b.id; },
      ok() {
        try {
          const t = app.vp.view.target, g = 10;
          st.r = resolve({ type: st.type, size: st.size, length: st.length, clear: st.clear, left: st.left, at: [Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0] }, STD);
        } catch (err) { app.toast(err.message, "err"); return; }
        commit(def, "Add " + st.r.name);
        if (!app.command) app.select([st.id]);
      },
      hint: () => "A bolt, nut, threaded rod or tap cutter with a real, editable thread. Building takes a few seconds.",
      build(body) {
        const note = (text) => body.append(el("div", { class: "hint", style: { padding: 0 } }, text));
        body.append(row("Part", seg(TYPES, st.type, (v) => { st.type = v; def.render(); }, "fa-type")));
        const opts = (list) => list.map((k) => { const s = find(k); return el("option", { value: k, selected: st.size === k }, isMetric(k) ? `${k} × ${s[2]}` : s[0]); });
        const groups = [el("optgroup", { label: "Metric (ISO coarse)" }, ...opts(METRIC)), el("optgroup", { label: "Inch (UNC / UNF)" }, ...opts(INCH))];
        if (inch) groups.reverse();
        const sel = el("select", { class: "num", id: "fa-size", "aria-label": "Fastener size" }, ...groups);
        sel.onchange = () => { st.size = sel.value; st.length = Math.max(st.length, 3 * pitch()); def.render(); };
        body.append(row("Size", sel, "fa-size"));
        if (st.type !== "nut") body.append(row("Length", app.numField({ value: st.length, id: "fa-len", len: true, min: 3 * pitch(), step: 1, onCommit: (v) => { st.length = v; def.render(); } }), "fa-len"));
        body.append(row("Hand", seg([[false, "Right"], [true, "Left"]], st.left, (v) => { st.left = v; def.render(); }, "fa-hand")));
        body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; def.render(); }, "fa-clear"), "fa-clear"));
        const [af, k, nutAf, m] = HEX[diaKey(st.size)];
        if (st.type === "bolt") note(`Hex head ${withUnit(af, 3)} across flats, ${withUnit(k, 3)} high; the length is measured under the head.`);
        else if (st.type === "nut") note(`Hex nut ${withUnit(nutAf, 3)} across flats, ${withUnit(m, 3)} thick.`);
        else if (st.type === "rod") note("Threaded all the way along.");
        else note("A threaded hole shape: put it inside a solid, select both and Group them. In Advanced, use Combine › Cut with the cutter as the tool. For a hole in a flat face, Hole › Tapped is quicker. Its print offset is set when it is made.");
        const n = turns();
        if (n > MAX_TURNS) note(tooMany(n));
        else if (n > WARN_TURNS) note(`About ${n} turns: this takes several seconds to build, longer on a phone.`);
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
