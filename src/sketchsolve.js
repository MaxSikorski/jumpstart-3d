// The sketch solver: one damped least-squares (Levenberg-Marquardt) solve over the whole sketch, the rank count of what
// is still free, and the plain-English words for a clash. Ours; J.Siwek's constraints.js re-exports it (his solver turned one
// line at a time and got stuck when two constraints wanted the same line: the hexagon bug). The constraints themselves
// (what they are, how they are added) stay in constraints.js.
import { CONSTRAINTS, pruneConstraints } from "./constraints.js";

const isLine = (e) => e && e.t === "line";
const isRound = (e) => e && (e.t === "circle" || e.t === "arc");
function entIds(e) {
  if (e.t === "line") return [e.a, e.b];
  if (e.t === "circle") return [e.c];
  if (e.t === "arc") return [e.c, e.a, e.b];
  if (e.t === "point" || e.t === "text") return [e.p];
  if (e.pts) return e.pts;
  return [];
}

// Unknowns: the free points' x and y, and each free circle's radius. Every constraint is a few numbers that must reach zero
// (its "rows"). Each step is the smallest move of the unknowns that cuts all rows at once, so geometry that already holds
// does not move, and a point held by a constraint (origin, projected, or dragged) is never an unknown at all.
const SOLVE_TOL = 1e-10; // stop when every row is this close to zero
const OK_TOL = 1e-6; // a sketch counts as solved when its worst row is below this (millimetres; angles are scaled to a length)
const FD_STEP = 1e-6; // finite-difference step for the Jacobian
const RANK_TOL = 1e-5; // a row adds a degree of constraint only if this much of it (as a fraction of its own length) is new
const MAX_ITER = 100;
const DRAG_ITER = 20; // ...and while dragging

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
    if (c.t === "fixed") { if (p && Number.isFinite(c.x) && Number.isFinite(c.y)) add(c, [c.p], () => [p.x - c.x, p.y - c.y], 2); continue; } // jumpstart-3d: fixed constraint (a hand-edited file may lack x or y)
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
      // the points sitting on a round shape: an arc's ends, and any point a Coincident holds on it
      const onIt = (q) => new Set([...(q.t === "arc" ? [q.a, q.b] : []), ...sk.cons.filter((k) => k.t === "coincident" && k.e === q.id).map((k) => k.p)]);
      if (isLine(l) && isRound(r)) {
        const cc = P.get(r.c), sg = side(l, cc.x, cc.y) < 0 ? -1 : 1; // the circle stays on the side it is on
        const at = [l.a, l.b].find((id) => onIt(r).has(id));
        if (at) { // the line ends on the shape: tangent there = the radius to that point is square to the line. (The usual row is flat at the answer here: a repeat in the count)
          const q = P.get(at), sc = Math.max(1, (len(l) + rad(r)) / 2);
          add(c, [l.a, l.b, ...shape(r), at], () => { const d = dir(l), u = [q.x - cc.x, q.y - cc.y]; return [(sc * (u[0] * d[0] + u[1] * d[1])) / ((Math.hypot(...u) * Math.hypot(...d)) || 1)]; });
        } else add(c, [l.a, l.b, ...shape(r)], () => [side(l, cc.x, cc.y) - sg * rad(r)]);
      } else if (isRound(l) && isRound(r)) {
        const c1 = P.get(l.c), c2 = P.get(r.c), both = onIt(r), at = [...onIt(l)].find((id) => both.has(id));
        if (at) { // they meet at a point: tangent there = the two radii to it point along one line
          const q = P.get(at), sc = Math.max(1, (rad(l) + rad(r)) / 2);
          add(c, [...shape(l), ...shape(r), at], () => { const u = [q.x - c1.x, q.y - c1.y], w = [q.x - c2.x, q.y - c2.y]; return [(sc * (u[0] * w[1] - u[1] * w[0])) / ((Math.hypot(...u) * Math.hypot(...w)) || 1)]; });
        } else {
          const inside = Math.hypot(c2.x - c1.x, c2.y - c1.y) < Math.max(rad(l), rad(r)); // one inside the other, or side by side
          add(c, [...shape(l), ...shape(r)], () => [Math.hypot(c2.x - c1.x, c2.y - c1.y) - (inside ? Math.abs(rad(l) - rad(r)) : rad(l) + rad(r))]);
        }
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
// the terms that share unknowns, grouped (a term with no free unknown is in no group); each group is solved and counted on its own
function groupTerms(terms, nvars) {
  const parent = Array.from({ length: nvars }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const t of terms) for (let j = 1; j < t.vars.length; j++) parent[find(t.vars[j])] = find(t.vars[0]);
  const groups = new Map();
  for (const t of terms) if (t.vars.length) { const g = find(t.vars[0]); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
  return [...groups.values()];
}
// solve the terms of one connected group: the smallest move that takes every row to zero (Levenberg-Marquardt)
// drag: a point is being dragged, once for each frame of the mouse. A position nothing can satisfy must not cost 100 rounds a frame, so this stops after
// 20 rounds, or as soon as a round gains less than a millionth of what is left
function lmGroup(ts, vars, drag) {
  const loc = new Map(), vs = [];
  for (const t of ts) for (const j of t.vars) if (!loc.has(j)) { loc.set(j, vs.length); vs.push(vars[j]); }
  const n = vs.length;
  let r = rowsOf(ts), m = r.length, w = worstOf(r), norm = Math.hypot(...r), lam = 1e-6, J = null, nz = null, G = null, stall = 0;
  if (!isFinite(w)) return;
  for (let it = 0; it < (drag ? DRAG_ITER : MAX_ITER) && w > SOLVE_TOL; it++) {
    if (!J) { // each row touches a few unknowns only: keep which, and build the products below from those
      J = jacobian(ts, vars, loc, n);
      nz = J.map((row) => { const o = []; for (let q = 0; q < n; q++) if (row[q] !== 0) o.push(q); return o; });
      G = Array.from({ length: m <= n ? m : n }, (_, i) => new Float64Array(i + 1)); // lower triangle of J J^T, or of J^T J when there are more rows than unknowns
      if (m <= n) for (let i = 0; i < m; i++) for (let k = 0; k <= i; k++) { let s = 0; for (const q of nz[i]) s += J[i][q] * J[k][q]; G[i][k] = s; }
      else for (let i = 0; i < m; i++) for (const p of nz[i]) for (const q of nz[i]) if (q <= p) G[p][q] += J[i][p] * J[i][q];
    }
    // minimum-norm step dx = -J^T (J J^T + lam I)^-1 r (or the same through J^T J when there are more rows than unknowns)
    const A = G.map((row, i) => { const c = Float64Array.from(row); c[i] += lam; return c; });
    let dx = null;
    if (m <= n) {
      const y = cholSolve(A, Float64Array.from(r));
      if (y) { dx = new Float64Array(n); for (let i = 0; i < m; i++) for (const q of nz[i]) dx[q] -= J[i][q] * y[i]; }
    } else {
      const g = new Float64Array(n);
      for (let i = 0; i < m; i++) for (const q of nz[i]) g[q] -= J[i][q] * r[i];
      dx = cholSolve(A, g);
    }
    let better = false;
    if (dx) {
      const x0 = vs.map((v) => v.o[v.k]);
      vs.forEach((v, q) => { v.o[v.k] = x0[q] + dx[q]; });
      const rn = rowsOf(ts), nn = Math.hypot(...rn);
      if (nn < norm) { better = true; stall = norm - nn < (drag ? 1e-6 : 1e-12) * norm ? stall + 1 : 0; r = rn; norm = nn; w = worstOf(rn); lam = Math.max(lam / 10, 1e-9); J = null; }
      else vs.forEach((v, q) => { v.o[v.k] = x0[q]; });
    }
    if (!better) { lam *= 10; if (lam > 1e8) break; }
    if (stall >= (drag ? 1 : 3)) break; // not going anywhere: the constraints fight
  }
}

// keep: point ids that must not move (being dragged); projected points and points on the origin never move.
// Returns { ok, worst, redundant, conflicting, dof }: ok = every constraint holds (worst = how far the worst is off, mm);
// conflicting = ids of the constraints that do not hold; redundant = ids of constraints that hold but add nothing the others
// do not already fix; dof = the degrees of freedom left (null while dragging, which skips that count); resid = how far each
// constraint is off, by id (mm; absent for a sketch with no constraints).
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
  for (const c of sk.cons) if (c.t === "fixed" && Number.isFinite(c.x) && Number.isFinite(c.y)) { const p = P.get(c.p); if (p) { p.x = c.x; p.y = c.y; fixed.add(c.p); } }
  const { terms } = buildTerms(sk, true);
  const vars = bindVars(sk, terms, P, fixed, false);
  const start = vars.map((v) => v.o[v.k]);
  // only the groups of constraints that are off are touched: a group that already holds stays exactly where it is
  for (const ts of groupTerms(terms, vars.length)) if (worstOf(rowsOf(ts)) > SOLVE_TOL) lmGroup(ts, vars, keep.size > 0);
  // a result that is not a real shape (a NaN, a circle shrunk to nothing) is thrown away
  if (vars.some((v, i) => !isFinite(v.o[v.k]) || (v.k === "r" && !(v.o.r > 1e-6)))) vars.forEach((v, i) => { v.o[v.k] = start[i]; });
  let worst = 0;
  const bad = new Set(), resid = {};
  for (const t of terms) {
    if (!t.c) continue;
    const w = worstOf(t.f());
    worst = Math.max(worst, w);
    if (w > OK_TOL) bad.add(t.c);
    resid[t.c.id] = Math.max(resid[t.c.id] || 0, w);
  }
  const conflicting = sk.cons.filter((c) => bad.has(c)).map((c) => c.id);
  if (keep.size) return { ok: worst < OK_TOL, worst, redundant: [], conflicting, dof: null, resid };
  const an = analyze(sk);
  return { ok: worst < OK_TOL, worst, redundant: an.repeated.filter((id) => !conflicting.includes(id)), conflicting, dof: an.dof, resid };
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
  let arcs = 0, rank = 0, rows = 0;
  const repeated = new Set();
  // jumpstart-3d: fixed constraint. A Fixed pins where a point is; it is counted after the others, adds only the rows that are new, and never counts as a repeat (a rectangle with Horizontal and Vertical sides can have every corner fixed: 0 left, nothing redundant)
  const isFix = (t) => t.c && t.c.t === "fixed";
  for (const t of terms) if (t.c) { if (!isFix(t)) rows += t.n; if (!t.vars.length && !isFix(t)) repeated.add(t.c); }
  for (const ts0 of groupTerms(terms, vars.length)) {
    const ts = [...ts0.filter((t) => !isFix(t)), ...ts0.filter(isFix)];
    const loc = new Map(), basis = [];
    for (const t of ts) for (const j of t.vars) if (!loc.has(j)) loc.set(j, loc.size);
    for (const t of ts) { // arcs come first in the list: their rows are counted before the constraints'
      let g = false;
      for (const row of jacobian([t], vars, loc, loc.size)) if (adds(row, basis)) { g = true; if (t.c) { rank++; if (isFix(t)) rows++; } else arcs++; }
      if (t.c && !g && !isFix(t)) repeated.add(t.c);
    }
  }
  // end jumpstart-3d
  return { free: vars.length - arcs, rank, dof: Math.max(0, vars.length - arcs - rank), redundant: rows - rank, repeated: (sk.cons || []).filter((c) => repeated.has(c)).map((c) => c.id) };
}
// does this row point somewhere the basis does not reach yet? (it is then added to the basis, as a unit vector)
function adds(row, basis) { // works in place on typed arrays: this runs for every constraint of every sketch on a redraw
  const n = row.length;
  let n0 = 0;
  for (let i = 0; i < n; i++) n0 += row[i] * row[i];
  n0 = Math.sqrt(n0);
  if (!(n0 > 1e-9)) return false;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = row[i] / n0;
  for (let pass = 0; pass < 2; pass++) for (const b of basis) { let d = 0; for (let i = 0; i < n; i++) d += w[i] * b[i]; for (let i = 0; i < n; i++) w[i] -= d * b[i]; }
  let m = 0;
  for (let i = 0; i < n; i++) m += w[i] * w[i];
  m = Math.sqrt(m);
  if (!(m > RANK_TOL)) return false;
  for (let i = 0; i < n; i++) w[i] /= m;
  basis.push(w);
  return true;
}

// plain-English names for the toasts that say a constraint clashes or repeats (the edit in sketcher.js uses them)
const DIM_NAMES = { dist: "length", pl: "distance", ll: "distance", dia: "diameter", rad: "radius", ang: "angle" };
export const conName = (c) => (c.t === "dim" ? DIM_NAMES[c.k] || "dimension" : c.t === "origin" ? "origin" : CONSTRAINTS[c.t] ? CONSTRAINTS[c.t].label.toLowerCase() : c.t);
const andList = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const namesOf = (cons) => andList([...new Set(cons.map(conName))]);
export const conNames = (sk, ids) => namesOf(sk.cons.filter((c) => ids.includes(c.id)));
// jumpstart-3d: fixed constraint. A point that cannot be moved by hand: projected from a body, on the origin, or Fixed
export const isPinned = (sk, pid) => sk.ents.some((e) => e.proj && entIds(e).includes(pid)) || (sk.cons || []).some((c) => (c.t === "origin" || c.t === "fixed") && c.p === pid);
export const conKey = (c) => JSON.stringify({ ...c, sg: undefined }); // a constraint as it was saved, without the angle sign a solve may add
// why an edit was refused: ids = the constraints that no longer hold; was = Map(constraint id -> its JSON before the edit), to tell which one was just added or changed
export function clashNote(sk, ids, was) {
  const bad = sk.cons.filter((c) => ids.includes(c.id));
  const mine = bad.find((c) => was.get(c.id) !== conKey(c));
  const others = bad.filter((c) => c !== mine);
  if (!mine) return "Those constraints conflict: " + namesOf(bad) + "; nothing changed.";
  if (!others.length) return `That ${conName(mine)} can't be reached with the shapes it holds; nothing changed.`;
  const names = [...new Set(others.map(conName))];
  return `That ${conName(mine)} conflicts with the ${andList(names)} constraint${names.length > 1 ? "s" : ""}; nothing changed.`;
}

// What to do with a constraint or dimension edit (sketcher.edit calls this; nothing here touches the sketch).
// pre / st = solveSketch before and after the edit; was = Map(constraint id -> conKey) before; cons = the constraints after.
// Returns { refuse, toast }: refuse = undo the edit; toast = the plain-English line to show (or null).
// A sketch that was solvable must stay so. One that already clashed may keep that clash, but no constraint may newly fail.
// A constraint is newly failing only if it held before (a brand-new one counts as held) and is now off by more than ten times the
// solved tolerance and more than a tenth of the worst error of the old clash: a clash that is not fixed spreads a little of its
// error onto its neighbours when another edit shifts the compromise (a dimension typed to one decimal, say), and that is not the
// edit's doing. (Tuned on a five-line sketch: harmless rounded dimensions spread under 2 % of the old worst, real conflicts 15 % and up.)
const NEW_CLASH_MIN = 10 * OK_TOL, SPREAD = 0.1;
export function editVerdict(pre, st, was, cons) {
  const sk = { cons };
  if (!st.ok) {
    const now = st.resid || {};
    const limit = Math.max(NEW_CLASH_MIN, SPREAD * pre.worst);
    const newly = st.conflicting.some((cid) => !pre.conflicting.includes(cid) && (now[cid] || 0) > limit);
    if (pre.ok || newly) return { refuse: true, toast: clashNote(sk, st.conflicting, was) };
  }
  const fresh = st.redundant.filter((cid) => !pre.redundant.includes(cid));
  const added = cons.find((c) => !was.has(c.id));
  if (fresh.length) {
    const c = cons.find((k) => k.id === (added && fresh.includes(added.id) ? added.id : fresh[0]));
    return { refuse: false, toast: added && c.id === added.id ? `That ${conName(c)} repeats what the other constraints already hold, so it adds nothing. It is kept.` : `After that, the ${conName(c)} constraint repeats what the others hold, so it adds nothing. It is kept.` }; // (a point merge adds no constraint of its own)
  }
  return { refuse: false, toast: st.ok ? null : "The sketch still has constraints that conflict: " + conNames(sk, st.conflicting) + "." };
}

// How many degrees of freedom a sketch has left, counted by the rank of its constraints
// (from the Jacobian at the sketch's current points; no longer a count of equations, which read too
// high when constraints repeat each other and too low when they fought). free is the unknown count (0 for a sketch with no shapes);
// rank is how many of them the constraints pin down; dof is free minus rank; redundant is how many equations repeat others (more
// constraints than needed). Nothing is moved.
export function sketchDof(sk) {
  const { free, rank, dof, redundant } = analyze(sk);
  return { free, rank, dof, redundant };
}
