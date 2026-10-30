// Sketch constraints: coincident (also to the origin), horizontal, vertical, parallel,
// perpendicular, tangent, concentric, equal and midpoint. They are stored on the sketch (sk.cons) and kept true by a small
// iterative solver that runs after every sketch edit and while dragging.
export const CONSTRAINTS = {
  // jumpstart-3d: fixed constraint
  fixed: { label: "Fixed", glyph: "📌", picks: "A point, line, arc or circle" },
  coincident: { label: "Coincident", glyph: "●", picks: "A point, then another point, a line/arc/circle or the origin" },
  horizontal: { label: "Horizontal", glyph: "H", picks: "A line (or two points)" },
  vertical: { label: "Vertical", glyph: "V", picks: "A line (or two points)" },
  parallel: { label: "Parallel", glyph: "∥", picks: "Two lines" },
  perpendicular: { label: "Perpendicular", glyph: "⊥", picks: "Two lines" },
  tangent: { label: "Tangent", glyph: "T", picks: "A line and an arc/circle, or two arcs/circles" },
  concentric: { label: "Concentric", glyph: "◎", picks: "Two arcs/circles" },
  equal: { label: "Equal", glyph: "=", picks: "Two lines, or two arcs/circles" },
  midpoint: { label: "Midpoint", glyph: "△", picks: "A point, then a line (or a line, then a point)" },
};
// constraints that aren't tools of their own, but still show a badge
export const CONSTRAINT_BADGES = { ...CONSTRAINTS, origin: { label: "On the origin", glyph: "⊕" } };
let n = 0;
const cid = () => "k" + Date.now().toString(36) + (n++).toString(36);

const isLine = (e) => e && e.t === "line";
const isRound = (e) => e && (e.t === "circle" || e.t === "arc");

// what a pick is: a point ("pt:id") or an entity
export function pickKind(sk, id) {
  if (!id) return null;
  if (id === "origin") return { kind: "origin" };
  if (id.startsWith("pt:")) return { kind: "pt", pid: id.slice(3) };
  const e = sk.ents.find((x) => x.id === id);
  if (!e) return null;
  if (isLine(e)) return { kind: "line", e };
  if (isRound(e)) return { kind: "round", e };
  if (e.t === "point") return { kind: "pt", pid: e.p };
  return { kind: "other", e };
}
// how many picks a constraint still needs, and whether the picks so far fit it
export function wants(type, picks) {
  const k = picks.map((p) => p.kind);
  switch (type) {
    // jumpstart-3d: fixed constraint
    case "fixed": return k.length && k.every((x) => x === "pt" || x === "line" || x === "round") ? "done" : "bad";
    case "horizontal": case "vertical":
      if (k.length === 1) return k[0] === "line" ? "done" : k[0] === "pt" ? "more" : "bad";
      return k[0] === "pt" && k[1] === "pt" ? "done" : "bad";
    case "coincident":
      if (k.includes("origin")) return k.length === 1 ? "more" : k.includes("pt") && k.length === 2 ? "done" : "bad";
      if (k.length === 1) return k[0] === "pt" ? "more" : k[0] === "line" || k[0] === "round" ? "more" : "bad";
      if (k.includes("pt") && (k.includes("pt") || k.includes("line") || k.includes("round"))) return "done";
      return "bad";
    case "parallel": case "perpendicular":
      if (k.length === 1) return k[0] === "line" ? "more" : "bad";
      return k[1] === "line" ? "done" : "bad";
    case "tangent":
      if (k.length === 1) return k[0] === "line" || k[0] === "round" ? "more" : "bad";
      return (k[0] === "round" || k[1] === "round") && (k[1] === "line" || k[1] === "round") ? "done" : "bad";
    case "concentric":
      if (k.length === 1) return k[0] === "round" ? "more" : "bad";
      return k[1] === "round" ? "done" : "bad";
    case "midpoint":
      if (k.length === 1) return k[0] === "pt" || k[0] === "line" ? "more" : "bad";
      return k.includes("pt") && k.includes("line") ? "done" : "bad";
    case "equal":
      if (k.length === 1) return k[0] === "line" || k[0] === "round" ? "more" : "bad";
      return k[1] === k[0] ? "done" : "bad";
  }
  return "bad";
}

// replace point q by p everywhere (a point-to-point coincidence)
export function mergePoints(sk, keep, drop) {
  if (keep === drop) return;
  for (const e of sk.ents) {
    for (const key of ["a", "b", "c", "p"]) if (e[key] === drop) e[key] = keep;
    if (e.pts) e.pts = e.pts.map((q) => (q === drop ? keep : q));
  }
  for (const c of sk.cons || []) for (const key of ["p", "p1", "p2"]) if (c[key] === drop) c[key] = keep;
  sk.pts = sk.pts.filter((q) => q.id !== drop);
}

// add a constraint from two picks (or one); returns a message on failure
export function addConstraint(sk, type, picks) {
  sk.cons = sk.cons || [];
  const P = (id) => sk.pts.find((q) => q.id === id);
  // jumpstart-3d: fixed constraint
  const fixedPt = (pid) => sk.ents.some((e) => e.proj && entIds(e).includes(pid)) || sk.cons.some((c) => (c.t === "fixed" || c.t === "origin") && c.p === pid);
  if (type === "fixed") {
    const ids = [...new Set(picks.flatMap((p) => p.kind === "pt" ? [p.pid] : p.kind === "line" ? [p.e.a, p.e.b] : [p.e.c]))];
    if (ids.every(fixedPt)) return "That point is already fixed.";
    for (const id of ids.filter((id) => !fixedPt(id))) { const p = P(id); if (p) sk.cons.push({ id: cid(), t: "fixed", p: id, x: p.x, y: p.y }); }
    return null;
  }
  if (type === "coincident" && picks.some((p) => p.kind === "origin")) {
    // pin a point to the sketch's origin (it stays there, like a projected point)
    const pt = picks.find((p) => p.kind === "pt");
    if (!pt) return "Pick a point to put on the origin.";
    // jumpstart-3d: fixed constraint
    if (fixedPt(pt.pid)) return "That point is already fixed.";
    if (sk.cons.some((c) => c.t === "origin" && c.p === pt.pid)) return "That point is already on the origin.";
    if (sk.cons.some((c) => c.t === "origin")) {
      // only one point can sit on the origin: merge it with the one already there
      const there = sk.cons.find((c) => c.t === "origin").p;
      mergePoints(sk, there, pt.pid);
      return null;
    }
    sk.cons.push({ id: cid(), t: "origin", p: pt.pid });
    return null;
  }
  if (type === "midpoint") {
    const pt = picks.find((p) => p.kind === "pt"), ln = picks.find((p) => p.kind === "line");
    if (!pt || !ln) return "Pick a point and a line.";
    if (ln.e.a === pt.pid || ln.e.b === pt.pid) return "That point is an end of the line: pick a different point.";
    if (sk.cons.some((c) => c.t === "midpoint" && c.p === pt.pid && c.e === ln.e.id)) return "That point is already at the middle of the line.";
    sk.cons.push({ id: cid(), t: "midpoint", p: pt.pid, e: ln.e.id });
    return null;
  }
  if (type === "coincident") {
    const pt = picks.find((p) => p.kind === "pt"), other = picks.find((p) => p !== pt);
    if (!pt || !other) return "Pick a point first.";
    if (other.kind === "pt") {
      // two points become one: the first one picked moves onto the second (a fixed point never moves)
      const first = picks[0].pid, second = picks[1].pid;
      const [keep, drop] = fixedPt(first) && !fixedPt(second) ? [first, second] : [second, first];
      // jumpstart-3d: fixed constraint
      if (fixedPt(keep) && fixedPt(drop)) return "Both points are already fixed.";
      mergePoints(sk, keep, drop);
      return null;
    }
    if (entIds(other.e).includes(pt.pid)) return "That point is already on it.";
    sk.cons.push({ id: cid(), t: "coincident", p: pt.pid, e: other.e.id });
    return null;
  }
  if ((type === "horizontal" || type === "vertical") && picks[0].kind === "pt") {
    sk.cons.push({ id: cid(), t: type, p1: picks[0].pid, p2: picks[1].pid });
    return null;
  }
  if (type === "concentric") {
    // share one center point; the second shape moves over
    const a = picks[0].e, b = picks[1].e;
    if (a.c === b.c) return "They already share a center.";
    const ca = P(a.c), cb = P(b.c);
    if (fixedPt(b.c) && !fixedPt(a.c)) return addConstraint(sk, type, [picks[1], picks[0]]);
    const dx = ca.x - cb.x, dy = ca.y - cb.y;
    if (b.t === "arc") for (const id of [b.a, b.b]) { const q = P(id); if (!fixedPt(id)) { q.x += dx; q.y += dy; } }
    mergePoints(sk, a.c, b.c);
    return null;
  }
  const ents = picks.map((p) => p.e.id);
  if (ents.length === 2 && ents[0] === ents[1]) return "Pick two different shapes.";
  sk.cons.push({ id: cid(), t: type, e1: ents[0], e2: ents[1] || null });
  return null;
}
function entIds(e) {
  if (e.t === "line") return [e.a, e.b];
  if (e.t === "circle") return [e.c];
  if (e.t === "arc") return [e.c, e.a, e.b];
  if (e.t === "point" || e.t === "text") return [e.p];
  if (e.pts) return e.pts;
  return [];
}
// After drawing: a new point placed on the origin is pinned there, and one placed on the
// middle of an existing line stays at its middle (like Fusion's automatic constraints).
export function autoConstrain(sk, oldPts, oldEnts) {
  sk.cons = sk.cons || [];
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const fresh = sk.pts.filter((p) => !oldPts.has(p.id));
  const lines = sk.ents.filter((e) => e.t === "line" && oldEnts.has(e.id) && !e.proj);
  const hasOrigin = sk.cons.some((c) => c.t === "origin");
  for (const p of fresh) {
    if (!hasOrigin && Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9) { sk.cons.push({ id: cid(), t: "origin", p: p.id }); continue; }
    for (const e of lines) {
      if (e.a === p.id || e.b === p.id) continue;
      const a = P.get(e.a), b = P.get(e.b);
      if (!a || !b) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L > 1e-9 && Math.hypot(p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2) < L * 1e-7) { sk.cons.push({ id: cid(), t: "midpoint", p: p.id, e: e.id }); break; }
    }
  }
}
// drop constraints that point at things that no longer exist
export function pruneConstraints(sk) {
  if (!sk.cons) return;
  const E = new Set(sk.ents.map((e) => e.id)), Pt = new Set(sk.pts.map((p) => p.id));
  sk.cons = sk.cons.filter((c) => (!c.e1 || E.has(c.e1)) && (!c.e2 || E.has(c.e2)) && (!c.e || E.has(c.e)) && (!c.p || Pt.has(c.p)) && (!c.p1 || Pt.has(c.p1)) && (!c.p2 || Pt.has(c.p2)));
}

// pull an arc's end point back onto its circle after the solver has moved things
export function normalizeSketch(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  for (const e of sk.ents) {
    if (e.t !== "arc") continue;
    const c = P.get(e.c), a = P.get(e.a), b = P.get(e.b);
    if (!c || !a || !b) continue;
    const r = Math.hypot(a.x - c.x, a.y - c.y);
    const ang = Math.atan2(b.y - c.y, b.x - c.x);
    // jumpstart-3d: fixed constraint
    if ((sk.cons || []).some((k) => k.t === "fixed" && k.p === e.b)) continue;
    b.x = c.x + r * Math.cos(ang);
    b.y = c.y + r * Math.sin(ang);
  }
}

// jumpstart-3d: sketch solver. solveSketch, sketchDof and the plain-English clash words moved to sketchsolve.js (ours): one least-squares solve over the whole sketch.
export { solveSketch, sketchDof, conName, conNames, conKey, clashNote, editVerdict } from "./sketchsolve.js";
// end jumpstart-3d

// where to draw each constraint's little badge (sketch coordinates)
export function glyphSpots(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const E = new Map(sk.ents.map((e) => [e.id, e]));
  const mid = (e) => {
    if (!e) return null;
    if (isLine(e)) { const a = P.get(e.a), b = P.get(e.b); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
    if (e.t === "circle") { const c = P.get(e.c); return [c.x + e.r * 0.71, c.y + e.r * 0.71]; }
    if (e.t === "arc") { const a = P.get(e.a), b = P.get(e.b); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
    return null;
  };
  const out = [];
  for (const c of sk.cons || []) {
    if (!CONSTRAINT_BADGES[c.t]) continue; // dimensions draw themselves
    const g = CONSTRAINT_BADGES[c.t].glyph;
    if (c.p1) { const a = P.get(c.p1), b = P.get(c.p2); if (a && b) out.push({ c, g, at: [(a.x + b.x) / 2, (a.y + b.y) / 2] }); continue; }
    if (c.p) { const p = P.get(c.p); if (p) out.push({ c, g, at: [p.x, p.y] }); continue; }
    for (const id of [c.e1, c.e2]) { const m = mid(E.get(id)); if (m) out.push({ c, g, at: m, on: id }); } // jumpstart-3d: badge layout (F10): which entity the badge belongs to
  }
  return out;
}
