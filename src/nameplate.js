// jumpstart-3d: name plates. One dialog (and JS3D.namePlate) that makes a flat plate sized to one line of text, rounded or pill-shaped,
// with a hanging hole or two screw holes, and the text either raised as its own body in its own colour or cut into the plate. The
// result is ordinary nodes: one hidden sketch plus the app's own Extrude for the plate, a Beginner Text shape for raised letters or
// the app's own Deboss text feature for cut-in letters. It shows in the timeline and undoes in one step. Nothing here touches the
// geometry kernel; the text is measured on the main thread with the same outlines the drawing code uses.
import { store, nextSeq, regionsFor } from "./store.js";
import { uid, el, fmt } from "./util.js";
import { getUnit, withUnit } from "./units.js";
import { textBounds, getFont } from "./textgeo.js";
import { FONT_DATA, FONT_NAMES } from "./fonts.js";
// the three classic fonts only: the extra ones (J.Siwek 2.8.1.1) come and go with a download, and getFont measures in the classic three
const FONTS = Object.keys(FONT_DATA);

const MAX_CHARS = 40;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STYLES = [["raised", "Raised (two colours)"], ["cut", "Cut in"]];
const SHAPES = [["rounded", "Rounded"], ["pill", "Pill"]];
const HOLES = [["none", "None"], ["hang", "Hanging hole"], ["screws", "Two screw holes"]];
const WARN_LENGTH = 250; // most print beds, mm

const isNum = (v) => typeof v === "number" && isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0; // 1e-6 mm, and never -0
const r3 = (v) => Math.round(v * 1000) / 1000;

// Checks a request and returns everything a plate needs, or throws a plain message. The checks run in the order the messages are
// listed in BRIDGE.md.
function resolve(spec) {
  spec = spec ?? {};
  let text = spec.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("text must be a non-empty string");
  text = text.trim();
  if (/[\n\r\t]/.test(text)) throw new Error("text must be one line, without line breaks or tabs");
  const chars = Array.from(text);
  if (chars.length > MAX_CHARS) throw new Error(`text can have at most ${MAX_CHARS} characters (this has ${chars.length})`);
  const font = spec.font == null ? "sans" : spec.font;
  if (!FONTS.includes(font)) throw new Error('font must be "sans", "serif" or "mono"');
  // hasChar says yes to everything; a glyph index of 0 is the font's "missing" box, which the kernel would drop as a blank gap
  const face = getFont(font), missing = [...new Set(chars.filter((c) => face.charToGlyphIndex(c) === 0))];
  if (missing.length) throw new Error(`text has characters the fonts do not have: ${missing.map((c) => `"${c}"`).join(", ")}. The fonts cover English and Western European letters, digits and common symbols.`);
  const size = spec.size == null ? 10 : spec.size;
  if (!inRange(size, 2, 100)) throw new Error("size must be a number from 2 to 100 (mm, the height of a capital letter)");
  const style = spec.style == null ? "raised" : spec.style;
  if (!STYLES.some((s) => s[0] === style)) throw new Error('style must be "raised" or "cut"');
  const depth = spec.depth == null ? 1 : spec.depth;
  if (!inRange(depth, 0.2, 10)) throw new Error("depth must be a number from 0.2 to 10 (mm)");
  const H = spec.thickness == null ? 3 : spec.thickness;
  if (!inRange(H, 0.6, 20)) throw new Error("thickness must be a number from 0.6 to 20 (mm)");
  if (style === "cut") {
    if (H < 0.8 - 1e-9) throw new Error("the plate is too thin to cut text into (make it at least 0.8 mm)");
    if (depth > H - 0.6 + 1e-9) throw new Error(`depth must be at most ${fmt(H - 0.6, 3)} mm here, so 0.6 mm of plate stays under the letters`);
  }
  const m = spec.margin == null ? 3 : spec.margin;
  if (!inRange(m, 1.5, 20)) throw new Error("margin must be a number from 1.5 to 20 (mm)");
  const shape = spec.shape == null ? "rounded" : spec.shape;
  if (!SHAPES.some((s) => s[0] === shape)) throw new Error('shape must be "rounded" or "pill"');
  const holes = spec.holes == null ? "hang" : spec.holes;
  if (!HOLES.some((s) => s[0] === holes)) throw new Error('holes must be "none", "hang" or "screws"');
  if (holes === "none" && spec.holeDia != null) throw new Error('holeDia is only for holes "hang" or "screws"');
  const tb = textBounds({ str: text, size, font }), tw = tb.maxX - tb.minX, th = tb.maxY - tb.minY, D = th + 2 * m;
  const hd = holes === "none" ? 0 : spec.holeDia == null ? (holes === "hang" ? 5 : 3.5) : spec.holeDia;
  if (holes !== "none" && D - 3 < 1) throw new Error('the text is too small for a hole here: use a larger margin, or holes "none"');
  if (holes !== "none" && !inRange(hd, 1, D - 3)) throw new Error(`holeDia must be a number from 1 to ${fmt(D - 3, 3)} mm for this plate (it leaves 1.5 mm of plate round the hole)`);
  const color = spec.color == null ? "#2b7bb9" : spec.color;
  if (!COLOR.test(color)) throw new Error('color must look like "#rrggbb"');
  if (style === "cut" && spec.textColor != null) throw new Error("textColor is only for raised text (cut-in letters are part of the plate)");
  const textColor = spec.textColor == null ? "#ffffff" : spec.textColor;
  if (style === "raised" && !COLOR.test(textColor)) throw new Error('textColor must look like "#rrggbb"');
  const at = spec.at == null ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name == null ? "" : String(spec.name).trim();
  const name = given || `Name plate ${text}`;

  // layout, plate-local: the origin is the plate's centre; the text box's corners keep m from the edge (a pill's ends are arcs
  // centred on the text box's corners)
  const pill = shape === "pill", rc = pill ? D / 2 : m, n = holes === "none" ? 0 : holes === "hang" ? 1 : 2;
  const e = n ? (pill ? hd / 2 + m : hd + m) : 0, W = tw + (pill ? D : 2 * m) + n * e;
  const hx = holes === "none" ? [] : (pill ? W / 2 - D / 2 : W / 2 - m - hd / 2) * (holes === "hang" ? -1 : 1);
  const holeX = holes === "none" ? [] : holes === "hang" ? [hx] : [-hx, hx];
  const tx = holes === "hang" ? e / 2 : 0;
  const area = W * D - (4 - Math.PI) * rc * rc - n * Math.PI * (hd / 2) ** 2;
  return { text, font, size, style, depth, H, m, shape, holes, hd, color, textColor, at, name, textName: name + " text", tw, th, W, D, rc, holeX, tx, area, top: style === "raised" ? H + depth : H };
}

// Pushes the sketch and the body or bodies into the design and returns { plate, textBody } (ids). The sketch sits at the world origin
// and the bodies' matrices carry the position, as for any Advanced body that has been moved.
function plateBodies(doc, r) {
  const sk = { id: uid("s"), name: r.name, seq: nextSeq(doc), plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: true };
  const P = (x, y) => { const p = { id: uid("p"), x: r6(x), y: r6(y) }; sk.pts.push(p); return p.id; };
  const line = (a, b) => { const l = { id: uid("e"), t: "line", a, b }; sk.ents.push(l); return l.id; };
  // arcs run counter-clockwise from a to b (regions.js)
  const arc = (c, a, b) => sk.ents.push({ id: uid("e"), t: "arc", c, a, b });
  const a = r.W / 2, b = r.D / 2, k = r.rc;
  let first;
  if (r.shape === "pill") {
    const cx = a - b, A = P(-cx, -b), B = P(cx, -b), C = P(cx, b), E = P(-cx, b), cr = P(cx, 0), cl = P(-cx, 0);
    first = line(A, B); arc(cr, B, C); line(C, E); arc(cl, E, A);
  } else {
    const p1 = P(-a + k, -b), p2 = P(a - k, -b), p3 = P(a, -b + k), p4 = P(a, b - k), p5 = P(a - k, b), p6 = P(-a + k, b), p7 = P(-a, b - k), p8 = P(-a, -b + k);
    const c1 = P(a - k, -b + k), c2 = P(a - k, b - k), c3 = P(-a + k, b - k), c4 = P(-a + k, -b + k);
    first = line(p1, p2); arc(c1, p2, p3); line(p3, p4); arc(c2, p4, p5); line(p5, p6); arc(c3, p6, p7); line(p7, p8); arc(c4, p8, p1);
  }
  for (const x of r.holeX) sk.ents.push({ id: uid("e"), t: "circle", c: P(x, 0), r: r.hd / 2 });
  doc.sketches.push(sk);
  const reg = regionsFor(sk).find((g) => g.ents.includes(first));
  const at = r.at, matrix = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const plate = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: r.color, hole: false, hidden: false, m: matrix(at[0], at[1], at[2]),
    node: { t: "extrude", sketch: sk.id, profiles: [{ key: reg.key, pt: reg.pt }], dist: r.H, mode: "one", dist2: 0, mods: [] } };
  doc.bodies.push(plate);
  let textBody = null;
  if (r.style === "cut") {
    // every key the Emboss dialog writes, so its edit dialog opens this one; Deboss cuts from H - depth up
    plate.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "emboss", kind: "plane", p: [r.tx, 0, r.H], n: [0, 0, 1], x: [1, 0, 0], str: r.text, font: r.font, size: r.size, depth: r.depth, mode: "deboss", angle: 0, along: false, mirror: false, reverse: false });
  } else {
    textBody = { id: uid("b"), name: r.textName, seq: nextSeq(doc), color: r.textColor, hole: false, hidden: false, m: matrix(at[0] + r.tx, at[1], at[2] + r.H),
      node: { t: "prim", kind: "text", p: { text: r.text, size: r.size, h: r.depth, font: r.font }, mods: [] } };
    doc.bodies.push(textBody);
  }
  return { plate: plate.id, textBody: textBody ? textBody.id : null };
}

export function initNamePlate(app, { openCmd, commit, row, seg }) {
  // used by JS3D.namePlate: the sketch and the body or bodies, one undo step; returns { plate, textBody, size: [W, D, top] }
  function add(spec) {
    const r = resolve(spec);
    let made;
    store.update((doc) => { made = plateBodies(doc, r); }, "Add " + r.name);
    return { ...made, size: [r3(r.W), r3(r.D), r3(r.top)] };
  }

  function cmd() {
    const inch = getUnit() === "in";
    const st = {
      text: "NAME", font: "sans", style: "raised", size: inch ? 9.525 : 10, depth: inch ? 1.5875 : 1, shape: "rounded", thick: inch ? 3.175 : 3, margin: inch ? 3.175 : 3,
      holes: "hang", hang: inch ? 4.7625 : 5, screws: inch ? 3.5719 : 3.5, color: "#2b7bb9", textColor: "#ffffff", ids: null, r: null,
    };
    const specOf = (at) => {
      const s = { text: st.text, font: st.font, size: st.size, style: st.style, depth: st.depth, thickness: st.thick, margin: st.margin, shape: st.shape, holes: st.holes, color: st.color, at };
      if (st.holes !== "none") s.holeDia = st[st.holes];
      if (st.style === "raised") s.textColor = st.textColor;
      return s;
    };
    const check = () => { try { return { r: resolve(specOf([0, 0, 0])) }; } catch (err) { return { err: err.message }; } };
    const def = {
      title: "Name plate",
      okLabel: "Create",
      valid: () => !check().err,
      canOk: () => def.valid(),
      apply(doc) { st.ids = plateBodies(doc, st.r); },
      ok() {
        const box = document.getElementById("np-text");
        if (box) st.text = box.value;
        try {
          const t = app.vp.view.target, g = 10;
          st.r = resolve(specOf([Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0]));
        } catch (err) { app.toast(err.message, "err"); return; }
        commit(def, "Add " + st.r.name);
        if (!app.command) app.select([st.ids.plate, st.ids.textBody].filter(Boolean));
      },
      hint: () => st.style === "raised"
        ? "To change the words later, select the text in Beginner. The plate keeps its size: to fit new text, undo and run this again."
        : "To change the words later, double-click Deboss text in the Advanced timeline. To fit the plate to new text, undo and run this again.",
      build(body) {
        const note = (text, cls = "hint", id) => body.append(el("div", { class: cls, id, style: { padding: 0 } }, text));
        const num = (id, value, set, o) => app.numField({ value, id, len: true, onCommit: (v) => { set(v); def.render(); }, ...o });
        const text = el("input", { class: "num", id: "np-text", value: st.text, style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        text.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") text.blur(); });
        text.addEventListener("change", () => { st.text = text.value; def.render(); }); // not on input: a re-render would take the caret away
        body.append(row("Text", text, "np-text"));
        const font = el("select", { class: "num", id: "np-font", "aria-label": "Font" }, ...FONTS.map((v) => el("option", { value: v, selected: v === st.font }, FONT_NAMES[v])));
        font.onchange = () => { st.font = font.value; def.render(); };
        body.append(row("Font", font, "np-font"));
        body.append(row("Style", seg(STYLES, st.style, (v) => { st.style = v; def.render(); }, "np-style")));
        body.append(row("Letter size", num("np-size", st.size, (v) => (st.size = v), { min: 2, max: 100, step: 1 }), "np-size"));
        body.append(row(st.style === "cut" ? "Depth" : "Text height", num("np-depth", st.depth, (v) => (st.depth = v), { min: 0.2, max: 10, step: 0.2 }), "np-depth"));
        body.append(row("Shape", seg(SHAPES, st.shape, (v) => { st.shape = v; def.render(); }, "np-shape")));
        body.append(row("Thickness", num("np-thick", st.thick, (v) => (st.thick = v), { min: 0.6, max: 20, step: 0.5 }), "np-thick"));
        body.append(row("Margin", num("np-margin", st.margin, (v) => (st.margin = v), { min: 1.5, max: 20, step: 0.5 }), "np-margin"));
        body.append(row("Holes", seg(HOLES, st.holes, (v) => { st.holes = v; def.render(); }, "np-holes")));
        if (st.holes !== "none") body.append(row("Hole size", num("np-hole", st[st.holes], (v) => (st[st.holes] = v), { min: 1, step: 0.5 }), "np-hole"));
        const colour = (id, key) => el("input", { type: "color", id, value: st[key], style: { width: "34px", height: "24px", border: 0, padding: 0, background: "none" }, onchange: (e) => { st[key] = e.target.value; } });
        body.append(row("Plate colour", colour("np-color", "color"), "np-color"));
        if (st.style === "raised") body.append(row("Text colour", colour("np-text-color", "textColor"), "np-text-color"));
        const { r, err } = check();
        if (err) { note(err, "err-msg", "np-err"); return; }
        note(`Plate ${withUnit(r.W, 3)} × ${withUnit(r.D, 3)} × ${withUnit(r.H, 3)}; text ${withUnit(r.tw, 3)} × ${withUnit(r.th, 3)}.`);
        if (r.style === "raised") note(`Two bodies in two colours. With one nozzle, change filament at ${withUnit(r.H, 3)} (the top of the plate) to print the letters in the second colour; a multi-colour printer takes both colours from a 3MF export.`);
        else note(`One body; the letters are cut ${withUnit(r.depth, 3)} deep.`);
        if (r.size < 5 || r.depth < 0.6) note("Letters under 5 mm tall, or raised or cut less than 0.6 mm, are hard to print and read.");
        if (r.W > WARN_LENGTH) note(`The plate is ${withUnit(r.W, 3)} long: longer than most print beds (about 250 mm).`);
      },
    };
    openCmd(def);
  }

  return { cmd, add };
}
