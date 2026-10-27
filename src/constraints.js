// Sketch constraints: coincident (also to the origin), horizontal, vertical, parallel,
// perpendicular, tangent, concentric, equal and midpoint. They are stored on the sketch (sk.cons) and kept true by a solver
// that runs after every sketch edit and while dragging (one least-squares solve over the whole sketch; see "the solver" below).
export const CONSTRAINTS = {
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
  const fixedPt = (pid) => sk.ents.some((e) => e.proj && entIds(e).includes(pid));
  if (type === "coincident" && picks.some((p) => p.kind === "origin")) {
    // pin a point to the sketch's origin (it stays there, like a projected point)
    const pt = picks.find((p) => p.kind === "pt");
    if (!pt) return "Pick a point to put on the origin.";
    if (fixedPt(pt.pid)) return "That point is fixed (projected from the body).";
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
      if (fixedPt(keep) && fixedPt(drop)) return "Both points are fixed (projected from the body).";
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
    b.x = c.x + r * Math.cos(ang);
    b.y = c.y + r * Math.sin(ang);
  }
}

// ------------------------------------------------------------ the solver
// jumpstart-3d: sketch solver. One damped least-squares (Levenberg-Marquardt) solve over the whole sketch replaces J.Siwek's
// one-constraint-at-a-time loop, which turned the wrong line when two constraints wanted the same one (the hexagon bug).
// Unknowns: the free points' x and y, and each free circle's radius. Every constraint is a few numbers that must reach zero
// (its "rows"). Each step is the smallest move of the unknowns that cuts all rows at once, so geometry that already holds
// does not move, and a point held by a constraint (origin, projected, or dragged) is never an unknown at all.
const SOLVE_TOL = 1e-10; // stop when every row is this close to zero
const OK_TOL = 1e-6; // a sketch counts as solved when its worst row is below this (millimetres; angles are scaled to a length)
const FD_STEP = 1e-6; // finite-difference step for the Jacobian
const RANK_TOL = 1e-5; // a row adds a degree of constraint only if this much of it (as a fraction of its own length) is new
const MAX_ITER = 100;

// every constraint as { c, n, f, deps }: f() = its n rows, read from the live points; deps = the point ids and circle shapes they depend on.
// Choices made from the geometry as it is now (which side a distance is measured on, the sign of an angle) are fixed here, once per solve.
// store: write a missing angle sign (c.sg) onto the constraint (a solve does; a read-only count does not).
function buildTerms(sk, store) {
  const P = new Map(sk.pts.map((p) => [p.id, p])), E = new Map(sk.ents.map((e) => [e.id, e]));
  const dir = (e) => { const a = P.get(e.a), b = P.get(e.b); return [b.x - a.x, b.y - a.y]; };
  const len = (e) => Math.hypot(...dir(e));
  const rad = (e) => (e.t === "circle" ? e.r : Math.hypot(P.get(e.a).x - P.get(e.c).x, P.get(e.a).y - P.get(e.c).y));
  const side = (e, x, y) => { const a = P.get(e.a), d = dir(e), L = Math.hypot(d[0], d[1]) || 1; return ((x - a.x) * -d[1] + (y - a.y) * d[0]) / L; };
  const turn = (c, e1, e2) => { const d1 = dir(e1).map((v) => v * (c.s1 || 1)), d2 = dir(e2).map((v) => v * (c.s2 || 1)); return Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]); };
  const shape = (e) => (isLine(e) ? [e.a, e.b] : e.t === "circle" ? [e.c, e] : [e.c, e.a]);
  const terms = [];
  const add = (c, deps, f, n = 1) => terms.push({ c, n, f, deps });
  for (const e of sk.ents) if (e.t === "arc" && P.has(e.a) && P.has(e.b) && P.has(e.c)) add(null, [e.c, e.a, e.b], () => [Math.hypot(P.get(e.b).x - P.get(e.c).x, P.get(e.b).y - P.get(e.c).y) - rad(e)]); // an arc's end sits on its circle
  for (const c of sk.cons || []) {
    const e1 = E.get(c.e1), e2 = E.get(c.e2), e = E.get(c.e), p = P.get(c.p);
    if (c.t === "origin") { if (p) add(c, [c.p], () => [p.x, p.y], 2); continue; }
    if (c.t === "horizontal" || c.t === "vertical") {
      const ends = c.p1 ? [c.p1, c.p2] : e1 && isLine(e1) ? [e1.a, e1.b] : null;
      if (!ends || !P.has(ends[0]) || !P.has(ends[1])) continue;
      const a = P.get(ends[0]), b = P.get(ends[1]), k = c.t === "horizontal" ? "y" : "x";
      add(c, ends, () => [a[k] - b[k]]);
    } else if (c.t === "parallel" || c.t === "perpendicular") {
      if (!isLine(e1) || !isLine(e2)) continue;
      const sc = Math.max(1, (len(e1) + len(e2)) / 2); // a turn of this many radians moves the line's ends about sc millimetres
      add(c, [e1.a, e1.b, e2.a, e2.b], () => { const d = dir(e1), u = dir(e2), n = Math.hypot(...d) * Math.hypot(...u) || 1; return [(sc * (c.t === "parallel" ? d[0] * u[1] - d[1] * u[0] : d[0] * u[0] + d[1] * u[1])) / n]; });
    } else if (c.t === "equal") {
      if (isLine(e1) && isLine(e2)) add(c, [e1.a, e1.b, e2.a, e2.b], () => [len(e1) - len(e2)]);
      else if (isRound(e1) && isRound(e2)) add(c, [...shape(e1), ...shape(e2)], () => [rad(e1) - rad(e2)]);
    } else if (c.t === "coincident") {
      if (!p || !e) continue;
      if (isLine(e)) add(c, [c.p, e.a, e.b], () => [side(e, p.x, p.y)]);
      else if (isRound(e)) add(c, [c.p, ...shape(e)], () => [Math.hypot(p.x - P.get(e.c).x, p.y - P.get(e.c).y) - rad(e)]);
    } else if (c.t === "midpoint") {
      if (!p || !e || !isLine(e)) continue;
      const a = P.get(e.a), b = P.get(e.b);
      add(c, [c.p, e.a, e.b], () => [p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2], 2);
    } else if (c.t === "tangent") {
      let l = e1, r = e2;
      if (isRound(l) && isLine(r)) [l, r] = [r, l];
      if (isLine(l) && isRound(r)) {
        const cc = P.get(r.c), sg = side(l, cc.x, cc.y) < 0 ? -1 : 1; // the circle stays on the side it is on
        add(c, [l.a, l.b, ...shape(r)], () => [side(l, cc.x, cc.y) - sg * rad(r)]);
      } else if (isRound(l) && isRound(r)) {
        const c1 = P.get(l.c), c2 = P.get(r.c), inside = Math.hypot(c2.x - c1.x, c2.y - c1.y) < Math.max(rad(l), rad(r)); // one inside the other, or side by side
        add(c, [...shape(l), ...shape(r)], () => [Math.hypot(c2.x - c1.x, c2.y - c1.y) - (inside ? Math.abs(rad(l) - rad(r)) : rad(l) + rad(r))]);
      }
    } else if (c.t === "dim") {
      if (!(c.v >= 0)) continue; // no value yet
      if (c.k === "dist") {
        const a = P.get(c.p1), b = P.get(c.p2);
        if (!a || !b) continue;
        if (c.o === "h" || c.o === "v") { const k = c.o === "h" ? "x" : "y", sg = b[k] - a[k] < 0 ? -1 : 1; add(c, [c.p1, c.p2], () => [b[k] - a[k] - sg * c.v]); }
        else add(c, [c.p1, c.p2], () => [Math.hypot(b.x - a.x, b.y - a.y) - c.v]);
      } else if (c.k === "pl" || c.k === "ll") {
        const l = c.k === "pl" ? e : e1, e3 = c.k === "ll" ? e2 : null;
        if (!isLine(l) || (c.k === "pl" ? !p : !isLine(e3))) continue;
        const at = c.k === "pl" ? () => [p.x, p.y] : () => { const a = P.get(e3.a), b = P.get(e3.b); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
        const sg = side(l, ...at()) < 0 ? -1 : 1;
        add(c, c.k === "pl" ? [c.p, l.a, l.b] : [l.a, l.b, e3.a, e3.b], () => [side(l, ...at()) - sg * c.v]);
      } else if (c.k === "dia" || c.k === "rad") {
        if (!isRound(e1)) continue;
        add(c, shape(e1), () => [rad(e1) - (c.k === "dia" ? c.v / 2 : c.v)]);
      } else if (c.k === "ang") {
        if (!isLine(e1) || !isLine(e2)) continue;
        // which way round the angle opens is kept from when it was placed (c.sg), never re-picked: a corner can't flip to -v
        let sg = c.sg;
        if (sg !== 1 && sg !== -1) { sg = turn(c, e1, e2) < 0 ? -1 : 1; if (store) c.sg = sg; }
        const want = (sg * c.v * Math.PI) / 180, sc = Math.max(1, (len(e1) + len(e2)) / 2);
        add(c, [e1.a, e1.b, e2.a, e2.b], () => { const d = turn(c, e1, e2) - want; return [sc * Math.atan2(Math.sin(d), Math.cos(d))]; });
      }
    }
  }
  return { terms, P };
}
// the unknowns: each term learns the indices of the free ones it depends on. fixed: point ids that are not unknowns.
// all: also make unknowns of every free point and circle in the sketch (for counting degrees of freedom)
function bindVars(sk, terms, P, fixed, all) {
  const idx = new Map(), vars = [];
  const get = (o, k, key) => { let i = idx.get(key); if (i == null) { i = vars.length; idx.set(key, i); vars.push({ o, k }); } return i; };
  const point = (id, out) => { if (fixed.has(id) || !P.has(id)) return; out.push(get(P.get(id), "x", id + "x"), get(P.get(id), "y", id + "y")); };
  for (const t of terms) {
    t.vars = [];
    for (const d of t.deps) { if (typeof d === "string") point(d, t.vars); else if (!d.proj) t.vars.push(get(d, "r", "r" + d.id)); }
    t.vars = [...new Set(t.vars)];
  }
  if (all) for (const e of sk.ents) if (!e.proj) { for (const id of entIds(e)) point(id, []); if (e.t === "circle") get(e, "r", "r" + e.id); }
  return vars;
}
// a symmetric positive definite system A x = b by Cholesky (A is overwritten); null when A is not positive definite
function cholSolve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= A[i][k] * A[j][k];
      if (i === j) { if (!(s > 1e-14)) return null; A[i][i] = Math.sqrt(s); } else A[i][j] = s / A[j][j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i][k] * y[k]; y[i] = s / A[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= A[k][i] * y[k]; y[i] = s / A[i][i]; }
  return y;
}
const rowsOf = (ts) => { const r = []; for (const t of ts) r.push(...t.f()); return r; };
const worstOf = (r) => { let w = 0; for (const v of r) { const a = Math.abs(v); if (!isFinite(a)) return Infinity; if (a > w) w = a; } return w; };
// the Jacobian of the terms ts over the unknowns vs (loc: unknown index -> column), by central differences, one dense row per equation
function jacobian(ts, vars, loc, ncol) {
  const J = [];
  for (const t of ts) {
    const rows = Array.from({ length: t.n }, () => new Float64Array(ncol));
    for (const j of t.vars) {
      const v = vars[j], x0 = v.o[v.k], h = FD_STEP * Math.max(1, Math.abs(x0));
      v.o[v.k] = x0 + h; const up = t.f(); v.o[v.k] = x0 - h; const dn = t.f(); v.o[v.k] = x0;
      for (let i = 0; i < t.n; i++) rows[i][loc.get(j)] = (up[i] - dn[i]) / (2 * h);
    }
    J.push(...rows);
  }
  return J;
}
// solve the terms of one connected group: the smallest move that takes every row to zero (Levenberg-Marquardt)
function lmGroup(ts, vars) {
  const loc = new Map(), vs = [];
  for (const t of ts) for (const j of t.vars) if (!loc.has(j)) { loc.set(j, vs.length); vs.push(vars[j]); }
  const n = vs.length;
  let r = rowsOf(ts), m = r.length, w = worstOf(r), norm = Math.hypot(...r), lam = 1e-6, J = null, stall = 0;
  if (!isFinite(w)) return;
  for (let it = 0; it < MAX_ITER && w > SOLVE_TOL; it++) {
    J = J || jacobian(ts, vars, loc, n);
    // minimum-norm step dx = -J^T (J J^T + lam I)^-1 r (or the same through J^T J when there are more rows than unknowns)
    let dx;
    if (m <= n) {
      const A = J.map((a, i) => Float64Array.from(J, (b, k) => { let s = i === k ? lam : 0; for (let q = 0; q < n; q++) s += a[q] * b[q]; return s; }));
      const y = cholSolve(A, Float64Array.from(r));
      dx = y && Float64Array.from({ length: n }, (_, q) => { let s = 0; for (let i = 0; i < m; i++) s -= J[i][q] * y[i]; return s; });
    } else {
      const A = Array.from({ length: n }, (_, a) => Float64Array.from({ length: n }, (_, b) => { let s = a === b ? lam : 0; for (let i = 0; i < m; i++) s += J[i][a] * J[i][b]; return s; }));
      const g = Float64Array.from({ length: n }, (_, a) => { let s = 0; for (let i = 0; i < m; i++) s -= J[i][a] * r[i]; return s; });
      dx = cholSolve(A, g);
    }
    let better = false;
    if (dx) {
      const x0 = vs.map((v) => v.o[v.k]);
      vs.forEach((v, q) => { v.o[v.k] = x0[q] + dx[q]; });
      const rn = rowsOf(ts), nn = Math.hypot(...rn);
      if (nn < norm) { better = true; stall = norm - nn < 1e-12 * norm ? stall + 1 : 0; r = rn; norm = nn; w = worstOf(rn); lam = Math.max(lam / 10, 1e-9); J = null; }
      else vs.forEach((v, q) => { v.o[v.k] = x0[q]; });
    }
    if (!better) { lam *= 10; if (lam > 1e8) break; }
    if (stall >= 3) break; // not going anywhere: the constraints fight
  }
}

// keep: point ids that must not move (being dragged); projected points and points on the origin never move.
// Returns { ok, worst, redundant, conflicting, dof }: ok = every constraint holds (worst = how far the worst is off, mm);
// conflicting = ids of the constraints that do not hold; redundant = ids of constraints that hold but add nothing the others
// do not already fix; dof = the degrees of freedom left (null while dragging, which skips that count).
export function solveSketch(sk, keep = new Set()) {
  const idle = { ok: true, worst: 0, redundant: [], conflicting: [], dof: null };
  if (!sk.cons || !sk.cons.length) return idle;
  pruneConstraints(sk);
  if (!sk.cons.length) return idle;
  const fixed = new Set(keep);
  for (const e of sk.ents) if (e.proj) for (const id of entIds(e)) fixed.add(id);
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  // points on the origin sit at (0, 0) and never move
  for (const c of sk.cons) if (c.t === "origin") { const p = P.get(c.p); if (p) { p.x = 0; p.y = 0; fixed.add(c.p); } }
  const { terms } = buildTerms(sk, true);
  const vars = bindVars(sk, terms, P, fixed, false);
  const start = vars.map((v) => v.o[v.k]);
  // only the groups of constraints that are off are touched: a group that already holds stays exactly where it is
  const parent = vars.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const t of terms) for (let j = 1; j < t.vars.length; j++) parent[find(t.vars[j])] = find(t.vars[0]);
  const groups = new Map();
  for (const t of terms) if (t.vars.length) { const g = find(t.vars[0]); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
  for (const ts of groups.values()) if (worstOf(rowsOf(ts)) > SOLVE_TOL) lmGroup(ts, vars);
  // a result that is not a real shape (a NaN, a circle shrunk to nothing) is thrown away
  if (vars.some((v, i) => !isFinite(v.o[v.k]) || (v.k === "r" && !(v.o.r > 1e-6)))) vars.forEach((v, i) => { v.o[v.k] = start[i]; });
  let worst = 0;
  const bad = new Set();
  for (const t of terms) {
    if (!t.c) continue;
    const w = worstOf(t.f());
    worst = Math.max(worst, w);
    if (w > OK_TOL) bad.add(t.c);
  }
  const conflicting = sk.cons.filter((c) => bad.has(c)).map((c) => c.id);
  if (keep.size) return { ok: worst < OK_TOL, worst, redundant: [], conflicting, dof: null };
  const an = analyze(sk);
  return { ok: worst < OK_TOL, worst, redundant: an.repeated.filter((id) => !conflicting.includes(id)), conflicting, dof: an.dof };
}
// How constrained the sketch is, by the rank of the Jacobian at its current points (nothing moves): free = unknowns (an arc's end
// sits on its circle, so an arc has 5), rank = how many of them the constraints pin down, dof = free - rank, redundant = how many
// equations repeat others, repeated = the ids of constraints that add nothing (each is judged in the order they were made, so a
// later repeat of an earlier one is the one named). A row counts when RANK_TOL of it is new.
function analyze(sk) {
  const fixed = new Set();
  for (const e of sk.ents) if (e.proj) for (const id of entIds(e)) fixed.add(id);
  const { terms, P } = buildTerms(sk, false);
  const vars = bindVars(sk, terms, P, fixed, true);
  const basis = [];
  const gain = (row) => { // does this row add a direction the basis does not have yet?
    const n0 = Math.hypot(...row);
    if (!(n0 > 1e-9)) return false;
    let w = row.map((x) => x / n0);
    for (let pass = 0; pass < 2; pass++) for (const b of basis) { let d = 0; for (let i = 0; i < w.length; i++) d += w[i] * b[i]; w = w.map((x, i) => x - d * b[i]); }
    const m = Math.hypot(...w);
    if (!(m > RANK_TOL)) return false;
    basis.push(w.map((x) => x / m));
    return true;
  };
  const loc = new Map(vars.map((_, i) => [i, i]));
  let arcs = 0, rows = 0;
  const repeated = [], seen = new Set();
  for (const t of terms) {
    const J = jacobian([t], vars, loc, vars.length);
    let g = false;
    for (const row of J) if (gain(Array.from(row))) g = true;
    if (!t.c) { if (g) arcs++; continue; }
    rows += t.n;
    if (!g && !seen.has(t.c.id)) { seen.add(t.c.id); repeated.push(t.c.id); }
  }
  const rank = basis.length - arcs;
  return { free: vars.length - arcs, rank, dof: Math.max(0, vars.length - basis.length), redundant: rows - rank, repeated };
}
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
    for (const id of [c.e1, c.e2]) { const m = mid(E.get(id)); if (m) out.push({ c, g, at: m }); }
  }
  return out;
}

// jumpstart-3d: parameters. How many degrees of freedom a sketch has left, counted by the rank of its constraints
// (jumpstart-3d: sketch solver: from the Jacobian at the sketch's current points; no longer a count of equations, which read too
// high when constraints repeat each other and too low when they fought). free is the unknown count (0 for a sketch with no shapes);
// rank is how many of them the constraints pin down; dof is free minus rank; redundant is how many equations repeat others (more
// constraints than needed). Nothing is moved.
export function sketchDof(sk) {
  const { free, rank, dof, redundant } = analyze(sk);
  return { free, rank, dof, redundant };
}
