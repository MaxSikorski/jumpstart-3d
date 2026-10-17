// Sketch constraints: coincident (also to the origin), horizontal, vertical, parallel,
// perpendicular, tangent, concentric, equal and midpoint. They are stored on the sketch (sk.cons) and kept true by a small
// iterative solver that runs after every sketch edit and while dragging.
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

// ------------------------------------------------------------ the solver
// keep: point ids that must not move (being dragged); projected points never move
export function solveSketch(sk, keep = new Set()) {
  if (!sk.cons || !sk.cons.length) return;
  pruneConstraints(sk);
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const E = new Map(sk.ents.map((e) => [e.id, e]));
  const fixed = new Set(keep);
  for (const e of sk.ents) if (e.proj) for (const id of entIds(e)) fixed.add(id);
  // points on the origin sit at (0, 0) and never move
  for (const c of sk.cons) if (c.t === "origin") { const p = P.get(c.p); if (p) { p.x = 0; p.y = 0; fixed.add(c.p); } }
  const free = (id) => !fixed.has(id);
  const radius = (e) => (e.t === "circle" ? e.r : Math.hypot(P.get(e.a).x - P.get(e.c).x, P.get(e.a).y - P.get(e.c).y));
  const setRadius = (e, r) => {
    if (!(r > 1e-6)) return;
    if (e.t === "circle") { e.r = r; return; }
    const c = P.get(e.c);
    for (const id of [e.a, e.b]) { if (!free(id)) continue; const q = P.get(id), L = Math.hypot(q.x - c.x, q.y - c.y) || 1; q.x = c.x + ((q.x - c.x) / L) * r; q.y = c.y + ((q.y - c.y) / L) * r; }
  };
  // move a whole round shape (its center, and an arc's ends with it)
  const shiftRound = (e, dx, dy) => { for (const id of e.t === "arc" ? [e.c, e.a, e.b] : [e.c]) if (free(id)) { const q = P.get(id); q.x += dx; q.y += dy; } };
  const roundFree = (e) => free(e.c);
  // turn a line to a direction, about a fixed end or its middle
  function aim(e, dx, dy) {
    const a = P.get(e.a), b = P.get(e.b);
    let L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) return;
    const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
    if ((b.x - a.x) * dx + (b.y - a.y) * dy < 0) { dx = -dx; dy = -dy; }
    if (free(a.id) && free(b.id)) { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; a.x = mx - (dx * L) / 2; a.y = my - (dy * L) / 2; b.x = mx + (dx * L) / 2; b.y = my + (dy * L) / 2; }
    else if (free(b.id)) { b.x = a.x + dx * L; b.y = a.y + dy * L; }
    else if (free(a.id)) { a.x = b.x - dx * L; a.y = b.y - dy * L; }
  }
  const lineFree = (e) => free(e.a) || free(e.b);
  // change b - a by d, moving whichever ends may move
  function stretch(i1, i2, dx, dy) {
    const a = P.get(i1), b = P.get(i2);
    if (free(i1) && free(i2)) { a.x -= dx / 2; a.y -= dy / 2; b.x += dx / 2; b.y += dy / 2; }
    else if (free(i2)) { b.x += dx; b.y += dy; }
    else if (free(i1)) { a.x -= dx; a.y -= dy; }
  }
  // turn a line by ang (radians) about a shared/fixed end, or its middle
  function turn(e, ang, other) {
    const a = P.get(e.a), b = P.get(e.b);
    const shared = other ? [e.a, e.b].find((id) => [other.a, other.b].includes(id)) : null;
    let pv;
    if (shared) pv = P.get(shared);
    else if (!free(e.a) && free(e.b)) pv = a;
    else if (!free(e.b) && free(e.a)) pv = b;
    else pv = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const cs = Math.cos(ang), sn = Math.sin(ang), px = pv.x, py = pv.y;
    for (const q of [a, b]) {
      if (!free(q.id) || q === pv) continue;
      const x = q.x - px, y = q.y - py;
      q.x = px + x * cs - y * sn; q.y = py + x * sn + y * cs;
    }
  }
  // sketch dimensions (see dims.js): returns how far off the dimension still is
  function solveDim(c) {
    if (!(c.v >= 0)) return 0;
    if (c.k === "dist") {
      const a = P.get(c.p1), b = P.get(c.p2);
      if (!a || !b) return 0;
      if (c.o === "h" || c.o === "v") {
        const k = c.o === "h" ? "x" : "y", cur = b[k] - a[k], want = (cur < 0 ? -1 : 1) * c.v, err = want - cur;
        if (Math.abs(err) > 1e-12) stretch(c.p1, c.p2, k === "x" ? err : 0, k === "y" ? err : 0);
        return Math.abs(err);
      }
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 1e-9) return 0;
      const err = c.v - d;
      if (Math.abs(err) > 1e-12) stretch(c.p1, c.p2, (dx / d) * err, (dy / d) * err);
      return Math.abs(err);
    }
    if (c.k === "pl" || c.k === "ll") {
      const e = E.get(c.k === "pl" ? c.e : c.e1);
      if (!e) return 0;
      const a = P.get(e.a), b = P.get(e.b), L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      let movers, px, py;
      if (c.k === "pl") { const p = P.get(c.p); if (!p) return 0; movers = [c.p]; px = p.x; py = p.y; }
      else { const e2 = E.get(c.e2); if (!e2) return 0; const p = P.get(e2.a), q = P.get(e2.b); movers = [e2.a, e2.b]; px = (p.x + q.x) / 2; py = (p.y + q.y) / 2; }
      const s = (px - a.x) * nx + (py - a.y) * ny, want = (s < 0 ? -1 : 1) * c.v, err = want - s;
      if (Math.abs(err) < 1e-12) return 0;
      if (movers.some(free)) { for (const id of movers) if (free(id)) { const q = P.get(id); q.x += nx * err; q.y += ny * err; } }
      else if (lineFree(e)) for (const id of [e.a, e.b]) if (free(id)) { const q = P.get(id); q.x -= nx * err; q.y -= ny * err; }
      return Math.abs(err);
    }
    if (c.k === "dia" || c.k === "rad") {
      const e = E.get(c.e1);
      if (!e) return 0;
      const want = c.k === "dia" ? c.v / 2 : c.v, err = Math.abs(radius(e) - want);
      if (err > 1e-12) setRadius(e, want);
      return err;
    }
    if (c.k === "ang") {
      const e1 = E.get(c.e1), e2 = E.get(c.e2);
      if (!e1 || !e2) return 0;
      const v1 = [(P.get(e1.b).x - P.get(e1.a).x) * (c.s1 || 1), (P.get(e1.b).y - P.get(e1.a).y) * (c.s1 || 1)];
      const v2 = [(P.get(e2.b).x - P.get(e2.a).x) * (c.s2 || 1), (P.get(e2.b).y - P.get(e2.a).y) * (c.s2 || 1)];
      const cur = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
      const want = (cur < 0 ? -1 : 1) * (c.v * Math.PI) / 180, err = want - cur;
      if (Math.abs(err) < 1e-12) return 0;
      if (lineFree(e2)) turn(e2, err, e1); else if (lineFree(e1)) turn(e1, -err, e2);
      return Math.abs(err);
    }
    return 0;
  }
  for (let it = 0; it < 60; it++) {
    let worst = 0;
    for (const c of sk.cons) {
      if (c.t === "dim") { worst = Math.max(worst, solveDim(c)); continue; }
      if (c.t === "horizontal" || c.t === "vertical") {
        const [i1, i2] = c.p1 ? [c.p1, c.p2] : (() => { const e = E.get(c.e1); return [e.a, e.b]; })();
        const a = P.get(i1), b = P.get(i2);
        if (!a || !b) continue;
        const k = c.t === "horizontal" ? "y" : "x";
        const err = Math.abs(a[k] - b[k]);
        worst = Math.max(worst, err);
        if (err < 1e-12) continue;
        if (free(i1) && free(i2)) { const m = (a[k] + b[k]) / 2; a[k] = m; b[k] = m; }
        else if (free(i2)) b[k] = a[k];
        else if (free(i1)) a[k] = b[k];
      } else if (c.t === "parallel" || c.t === "perpendicular") {
        const e1 = E.get(c.e1), e2 = E.get(c.e2);
        const a1 = P.get(e1.a), b1 = P.get(e1.b), a2 = P.get(e2.a), b2 = P.get(e2.b);
        let dx = b1.x - a1.x, dy = b1.y - a1.y;
        if (c.t === "perpendicular") [dx, dy] = [-dy, dx];
        const ux = b2.x - a2.x, uy = b2.y - a2.y;
        const err = Math.abs(dx * uy - dy * ux) / ((Math.hypot(dx, dy) * Math.hypot(ux, uy)) || 1);
        worst = Math.max(worst, err);
        if (err < 1e-12) continue;
        if (lineFree(e2)) aim(e2, dx, dy);
        else if (lineFree(e1)) { let vx = ux, vy = uy; if (c.t === "perpendicular") [vx, vy] = [vy, -vx]; aim(e1, vx, vy); }
      } else if (c.t === "equal") {
        const e1 = E.get(c.e1), e2 = E.get(c.e2);
        if (isLine(e1) && isLine(e2)) {
          const L1 = Math.hypot(P.get(e1.b).x - P.get(e1.a).x, P.get(e1.b).y - P.get(e1.a).y);
          const a = P.get(e2.a), b = P.get(e2.b), L2 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const err = Math.abs(L1 - L2); worst = Math.max(worst, err);
          if (err < 1e-12) continue;
          const ux = (b.x - a.x) / L2, uy = (b.y - a.y) / L2;
          if (free(e2.a) && free(e2.b)) { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; a.x = mx - (ux * L1) / 2; a.y = my - (uy * L1) / 2; b.x = mx + (ux * L1) / 2; b.y = my + (uy * L1) / 2; }
          else if (free(e2.b)) { b.x = a.x + ux * L1; b.y = a.y + uy * L1; }
          else if (free(e2.a)) { a.x = b.x - ux * L1; a.y = b.y - uy * L1; }
        } else if (isRound(e1) && isRound(e2)) {
          const r1 = radius(e1), r2 = radius(e2), err = Math.abs(r1 - r2);
          worst = Math.max(worst, err);
          if (err > 1e-12) setRadius(e2, r1);
        }
      } else if (c.t === "coincident") {
        const p = P.get(c.p), e = E.get(c.e);
        if (!p || !e) continue;
        if (isLine(e)) {
          const a = P.get(e.a), b = P.get(e.b), dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
          const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, fx = a.x + t * dx, fy = a.y + t * dy;
          const err = Math.hypot(p.x - fx, p.y - fy); worst = Math.max(worst, err);
          if (err < 1e-12) continue;
          if (free(p.id)) { p.x = fx; p.y = fy; }
          else if (lineFree(e)) { const ox = p.x - fx, oy = p.y - fy; for (const id of [e.a, e.b]) if (free(id)) { const q = P.get(id); q.x += ox; q.y += oy; } }
        } else if (isRound(e)) {
          const cc = P.get(e.c), r = radius(e), L = Math.hypot(p.x - cc.x, p.y - cc.y) || 1e-9;
          const err = Math.abs(L - r); worst = Math.max(worst, err);
          if (err < 1e-12) continue;
          if (free(p.id)) { p.x = cc.x + ((p.x - cc.x) / L) * r; p.y = cc.y + ((p.y - cc.y) / L) * r; }
          else setRadius(e, L);
        }
      } else if (c.t === "midpoint") {
        const p = P.get(c.p), e = E.get(c.e);
        if (!p || !e || !isLine(e)) continue;
        const a = P.get(e.a), b = P.get(e.b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const err = Math.hypot(p.x - mx, p.y - my); worst = Math.max(worst, err);
        if (err < 1e-12) continue;
        if (free(p.id)) { p.x = mx; p.y = my; }
        else if (free(e.a) && free(e.b)) { const ox = p.x - mx, oy = p.y - my; a.x += ox; a.y += oy; b.x += ox; b.y += oy; }
        else if (free(e.b)) { b.x = 2 * p.x - a.x; b.y = 2 * p.y - a.y; }
        else if (free(e.a)) { a.x = 2 * p.x - b.x; a.y = 2 * p.y - b.y; }
      } else if (c.t === "tangent") {
        let e1 = E.get(c.e1), e2 = E.get(c.e2);
        if (isRound(e1) && isLine(e2)) [e1, e2] = [e2, e1];
        if (isLine(e1) && isRound(e2)) {
          const a = P.get(e1.a), b = P.get(e1.b), cc = P.get(e2.c), r = radius(e2);
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          const s = (cc.x - a.x) * nx + (cc.y - a.y) * ny, want = s >= 0 ? r : -r, err = Math.abs(s - want);
          worst = Math.max(worst, err);
          if (err < 1e-12) continue;
          if (roundFree(e2)) shiftRound(e2, nx * (want - s), ny * (want - s));
          else if (lineFree(e1)) for (const id of [e1.a, e1.b]) if (free(id)) { const q = P.get(id); q.x -= nx * (want - s); q.y -= ny * (want - s); }
          else if (e2.t === "circle") e2.r = Math.abs(s);
        } else if (isRound(e1) && isRound(e2)) {
          const c1 = P.get(e1.c), c2 = P.get(e2.c), r1 = radius(e1), r2 = radius(e2);
          const d = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1e-9;
          const want = d < Math.max(r1, r2) ? Math.abs(r1 - r2) : r1 + r2, err = Math.abs(d - want);
          worst = Math.max(worst, err);
          if (err < 1e-12) continue;
          const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
          if (roundFree(e2)) shiftRound(e2, ux * (want - d), uy * (want - d));
          else if (roundFree(e1)) shiftRound(e1, -ux * (want - d), -uy * (want - d));
        }
      }
    }
    if (worst < 1e-9) break;
  }
}

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
