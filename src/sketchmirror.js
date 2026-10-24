// Sketch Mirror (issue #181): copies picked sketch shapes across a line, an axis or the origin.
// The maths (mirrorEnts) is pure data in, data out, so a node test can check it. The tool glue
// below it (click, panel box, apply) is called from short marked blocks in sketcher.js, app.js and advanced.js.
import { uid, el } from "./util.js";
import { sketchDof } from "./constraints.js";

const TOL = 1e-6; // same as the sketcher's point reuse
const copy = (o) => JSON.parse(JSON.stringify(o));
const TEXT_NOTE = "Text was left out: mirrored text would read backwards.";

// axis: { type: "line", a: [x, y], b: [x, y] } or { type: "point", p: [x, y] }
export function reflect(p, axis) {
  if (axis.type === "point") return [2 * axis.p[0] - p[0], 2 * axis.p[1] - p[1]];
  const [ax, ay] = axis.a, dx = axis.b[0] - ax, dy = axis.b[1] - ay;
  const t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy);
  return [2 * (ax + t * dx) - p[0], 2 * (ay + t * dy) - p[1]];
}
// a horizontal or vertical mirror line (or a point flip) keeps horizontal and vertical distances and directions
function keepsHV(axis) {
  if (axis.type === "point") return true;
  const dx = Math.abs(axis.b[0] - axis.a[0]), dy = Math.abs(axis.b[1] - axis.a[1]);
  return dy < 1e-9 * (dx + dy) || dx < 1e-9 * (dx + dy);
}

// The copies of the entities `ids` of sketch `sk` mirrored across `axis`; nothing in sk changes.
// Returns { pts, ents, cons } (new items only: a mirrored point that lands on an existing point,
// such as one on the mirror line, reuses it) and skipped: { text, same } counts.
export function mirrorEnts(sk, ids, axis) {
  const want = new Set(ids);
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const pts = [];
  const ptMap = new Map(); // old point id -> its mirror image's id
  const mp = (id) => {
    if (ptMap.has(id)) return ptMap.get(id);
    const q = P.get(id);
    const [x, y] = reflect([q.x, q.y], axis);
    const hit = sk.pts.find((r) => Math.hypot(r.x - x, r.y - y) < TOL) || pts.find((r) => Math.hypot(r.x - x, r.y - y) < TOL);
    let nid;
    if (hit) nid = hit.id; else { nid = uid("p"); pts.push({ id: nid, x, y }); }
    ptMap.set(id, nid);
    return nid;
  };
  const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // is there already a shape exactly like n (a line also read backwards)?
  const twin = (n, list, cons) => list.find((o) => o.t === n.t && !!o.cons === !!cons && (
    n.t === "line" ? (o.a === n.a && o.b === n.b) || (o.a === n.b && o.b === n.a)
      : n.t === "circle" ? o.c === n.c && Math.abs(o.r - n.r) < TOL
        : n.t === "arc" ? o.c === n.c && o.a === n.a && o.b === n.b
          : n.t === "spline" ? !!o.closed === !!n.closed && (sameList(o.pts, n.pts) || sameList(o.pts, [...n.pts].reverse()))
            : n.t === "point" ? o.p === n.p : false));

  const ents = [];
  const entMap = new Map(); // old entity id -> the entity that is its mirror image
  const direct = new Set(); // images whose a -> b runs the way the original did (a twin found elsewhere may run backwards)
  const skipped = { text: 0, same: 0, twin: 0 };
  for (const e of sk.ents) {
    if (!want.has(e.id)) continue;
    if (e.t === "text") { skipped.text++; continue; }
    let n;
    if (e.t === "line") n = { t: "line", a: mp(e.a), b: mp(e.b) };
    else if (e.t === "circle") n = { t: "circle", c: mp(e.c), r: e.r };
    else if (e.t === "arc") n = { t: "arc", c: mp(e.c), a: mp(e.b), b: mp(e.a) }; // a mirror image turns clockwise: swap the ends to stay counter-clockwise
    else if (e.t === "spline") n = { t: "spline", pts: e.pts.map(mp), closed: !!e.closed };
    else if (e.t === "point") n = { t: "point", p: mp(e.p) };
    else continue;
    if (twin(n, [e], e.cons)) { entMap.set(e.id, e.id); direct.add(e.id); skipped.same++; continue; } // it lies on the mirror line
    const other = twin(n, sk.ents.filter((o) => o !== e), e.cons) || twin(n, ents, e.cons); // (a construction shape is no twin of a drawn one)
    if (other) { entMap.set(e.id, other.id); skipped.twin++; continue; }
    const ne = { ...copy(e), ...n, id: uid("e") };
    delete ne.proj; // a projected edge becomes an ordinary copy
    if (!ne.cons) delete ne.cons;
    if (ne.t !== "spline") delete ne.closed;
    entMap.set(e.id, ne.id);
    direct.add(ne.id);
    ents.push(ne);
  }

  // constraints among the picked shapes, with the copies' ids; anything that would not stay true is left out.
  // Dimensions go first, then the geometric ones, and a copy that would leave the sketch with more constraints
  // than it can use (a repeat) is dropped, so a fully constrained sketch does not come out over-constrained.
  const hv = keepsHV(axis);
  const E = (id) => entMap.get(id), Pt = (id) => ptMap.get(id);
  const make = (c) => {
    if (["parallel", "perpendicular", "equal", "tangent", "concentric"].includes(c.t)) return E(c.e1) && E(c.e2) ? { ...copy(c), e1: E(c.e1), e2: E(c.e2) } : null;
    if (c.t === "midpoint" || c.t === "coincident") return Pt(c.p) && E(c.e) ? { ...copy(c), p: Pt(c.p), e: E(c.e) } : null;
    if ((c.t === "horizontal" || c.t === "vertical") && hv) {
      if (c.e1) return E(c.e1) ? { ...copy(c), e1: E(c.e1) } : null;
      return Pt(c.p1) && Pt(c.p2) ? { ...copy(c), p1: Pt(c.p1), p2: Pt(c.p2) } : null;
    }
    if (c.t !== "dim") return null;
    let nc = null;
    if (c.k === "dist" && (c.o === "a" || hv) && Pt(c.p1) && Pt(c.p2)) nc = { ...copy(c), p1: Pt(c.p1), p2: Pt(c.p2) };
    else if ((c.k === "dia" || c.k === "rad") && E(c.e1)) nc = { ...copy(c), e1: E(c.e1) };
    else if (c.k === "pl" && Pt(c.p) && E(c.e)) nc = { ...copy(c), p: Pt(c.p), e: E(c.e) };
    else if (c.k === "ll" && E(c.e1) && E(c.e2)) nc = { ...copy(c), e1: E(c.e1), e2: E(c.e2) };
    else if (c.k === "ang" && direct.has(E(c.e1)) && direct.has(E(c.e2))) nc = { ...copy(c), e1: E(c.e1), e2: E(c.e2) };
    if (nc) {
      delete nc.name; // a parameter name belongs to one dimension
      if (nc.off) nc.off = reflect(nc.off, axis);
    }
    return nc;
  };
  const all = sk.cons || [];
  const order = [...all.filter((c) => c.t === "dim"), ...all.filter((c) => c.t !== "dim")];
  const trial = { pts: [...sk.pts, ...pts], ents: [...sk.ents, ...ents], cons: [...all] };
  const over0 = sketchDof(sk).over;
  const floor = over0 >= 0 ? over0 : -Infinity;
  const cons = [];
  const seen = new Set(all.map((c) => JSON.stringify(refsOf(c))));
  for (const c of order) {
    const nc = make(c);
    if (!nc) continue;
    const key = JSON.stringify(refsOf(nc));
    if (seen.has(key)) continue; // it would repeat a constraint that is already there
    trial.cons.push(nc);
    if (sketchDof(trial).over < floor) { trial.cons.pop(); continue; }
    seen.add(key);
    nc.id = uid(c.t === "dim" ? "dm" : "k");
    cons.push(nc);
  }
  return { pts, ents, cons, skipped };
}
// what a constraint ties together, in an order that does not depend on which shape was named first
const SYMMETRIC = ["parallel", "perpendicular", "equal", "tangent", "concentric", "horizontal", "vertical"];
function refsOf(c) {
  const { id, v, expr, unit, off, name, ...rest } = c; // eslint-disable-line no-unused-vars
  const swap = (a, b) => { if (rest[a] != null && rest[b] != null && String(rest[a]) > String(rest[b])) [rest[a], rest[b]] = [rest[b], rest[a]]; };
  if (SYMMETRIC.includes(c.t) || (c.t === "dim" && (c.k === "dist" || c.k === "ll"))) { swap("e1", "e2"); swap("p1", "p2"); }
  return rest;
}

// ------------------------------------------------------------ the tool (called from the sketcher)
// shapes picked so far: whole shapes only (the points of a selection do not count)
const picked = (s) => {
  const sk = s.sketch;
  return sk ? [...s.sel].filter((id) => sk.ents.some((e) => e.id === id)) : [];
};
export function begin(s) { s.mirrorStage = picked(s).length ? "line" : "shapes"; }
export function hint(s) {
  return s.mirrorStage === "line" ? "Click a line to mirror across, or use X axis, Y axis or Origin. Esc cancels."
    : picked(s).length ? "Click more shapes to add or remove them, then click the Mirror line button, or use X axis, Y axis or Origin."
      : "Click the shapes to mirror. Then click a line to mirror across, or use X axis, Y axis or Origin.";
}
export function hover(s, raw) {
  s.hover = s.pickEnt(raw);
  s.cursor = null;
  s.redraw();
}
// a click in the viewport: in the shapes step it adds or removes a shape, in the line step a line is the mirror line
export function click(s, raw) {
  const sk = s.sketch, hit = s.pickEnt(raw);
  if (!sk || !hit || hit.startsWith("pt:") || hit === "origin") return true;
  if (s.mirrorStage === "line") {
    const e = sk.ents.find((x) => x.id === hit);
    if (!e || e.t !== "line") { s.app.toast && s.app.toast("Click a straight line, or use X axis, Y axis or Origin."); return true; }
    const P = new Map(sk.pts.map((p) => [p.id, [p.x, p.y]]));
    apply(s, { type: "line", a: P.get(e.a), b: P.get(e.b) });
    return true;
  }
  s.sel.has(hit) ? s.sel.delete(hit) : s.sel.add(hit);
  s.redraw();
  s.app.onSketchSelection && s.app.onSketchSelection();
  s.app.status && s.app.status();
  return true;
}
export const AXES = {
  x: { type: "line", a: [0, 0], b: [1, 0] },
  y: { type: "line", a: [0, 0], b: [0, 1] },
  origin: { type: "point", p: [0, 0] },
};
// mirror the picked shapes now: one undo step "Mirror"; the copies become the selection
export function apply(s, axis) {
  const ids = picked(s);
  if (!ids.length) { s.app.toast && s.app.toast("Pick the shapes to mirror first."); return false; }
  const toast = (m) => s.app.toast && s.app.toast(m);
  if (axis.type === "line" && Math.hypot(axis.b[0] - axis.a[0], axis.b[1] - axis.a[1]) < TOL) { toast("That line is too short to mirror across."); return false; }
  let made = null;
  const sk0 = s.sketch;
  const preview = mirrorEnts(sk0, ids, axis);
  if (!preview.ents.length) {
    toast(preview.skipped.text ? TEXT_NOTE : preview.skipped.twin ? "Nothing to mirror: those shapes already have a mirror copy." : "Nothing to mirror: those shapes already lie on the line.");
    return false;
  }
  s.edit("Mirror", (sk) => {
    made = mirrorEnts(sk, ids, axis);
    sk.pts.push(...made.pts);
    sk.ents.push(...made.ents);
    if (made.cons.length) (sk.cons = sk.cons || []).push(...made.cons);
  });
  s.sel = new Set(made.ents.map((e) => e.id));
  s.setTool("select");
  s.app.onSketchSelection && s.app.onSketchSelection();
  toast(made.skipped.text ? TEXT_NOTE : `Mirrored ${made.ents.length} shape${made.ents.length === 1 ? "" : "s"}.`);
  return true;
}

// the Mirror box in the sketch panel
export function mirrorBox(s) {
  const n = picked(s).length, stage = s.mirrorStage;
  const stageBtn = (id, key, label) => el("button", { id, "aria-pressed": stage === key ? "true" : "false", onclick: () => { s.mirrorStage = key; s.app.onSketchSelection && s.app.onSketchSelection(); s.app.status && s.app.status(); } }, label);
  const axisBtn = (id, label, axis, title) => el("button", { class: "btn", id, disabled: n ? null : "", title, onclick: () => apply(s, axis) }, label);
  return el("div", { id: "pal-mirror" },
    el("div", { class: "subhead" }, "Mirror"),
    el("div", { class: "seg", id: "pal-mir-stage" }, stageBtn("pal-mir-shapes", "shapes", `Shapes (${n})`), stageBtn("pal-mir-line", "line", "Mirror line")),
    el("div", { class: "hint", id: "pal-mir-hint", style: { padding: "4px 0" } }, hint(s)),
    el("div", { class: "pal-btns" },
      axisBtn("pal-mir-x", "X axis", AXES.x, "Mirror across the sketch's X axis (up becomes down)"),
      axisBtn("pal-mir-y", "Y axis", AXES.y, "Mirror across the sketch's Y axis (left becomes right)"),
      axisBtn("pal-mir-o", "Origin (point flip)", AXES.origin, "Flip through the origin (turned half a turn)"),
      el("button", { class: "btn", id: "pal-mir-cancel", onclick: () => s.escape() }, "Cancel (Esc)")));
}
