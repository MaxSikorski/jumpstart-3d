// The sketch solver (src/constraints.js, "jumpstart-3d: sketch solver"), in Node with no browser: the hexagon from the Reddit post
// "Not there yet?" (horizontal + equal sides + length + 120 degree angles, clicked in any order), exactness, fixed points, conflicts and
// repeats. The same flow through the real app is test/sketch-solver.spec.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { solveSketch, normalizeSketch, addConstraint, pruneConstraints, sketchDof, clashNote, conKey, editVerdict, isPinned } from "../src/constraints.js";
import { buildDim, measureDim } from "../src/dims.js";

// a hand-drawn hexagon of radius 20, every corner nudged by up to ~1.5 mm, drawn counter-clockwise from the bottom left
const WOB = [[1.2, -0.8], [-1.5, 0.6], [0.9, 1.4], [-0.7, -1.1], [1.6, 0.3], [-0.4, -1.5]];
const hexagon = () => ({
  pts: WOB.map((w, i) => { const a = ((i * 60 - 120) * Math.PI) / 180; return { id: "p" + i, x: Math.round(20 * Math.cos(a) + w[0]), y: Math.round(20 * Math.sin(a) + w[1]) }; }),
  ents: WOB.map((_, i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 6) })),
  cons: [],
});
const pm = (sk) => new Map(sk.pts.map((p) => [p.id, p]));
const lineLen = (sk, id) => { const m = pm(sk), e = sk.ents.find((x) => x.id === id), a = m.get(e.a), b = m.get(e.b); return Math.hypot(b.x - a.x, b.y - a.y); };
const pick = (sk, id) => ({ kind: "line", e: sk.ents.find((e) => e.id === id) });
// one edit, the way sketcher.edit does it: change, prune, solve, normalize
function edit(sk, fn) { const msg = fn(sk); pruneConstraints(sk); const st = solveSketch(sk, new Set()); normalizeSketch(sk); return { st, msg }; }
// how far a constraint is from true, measured here and not by the solver
function resid(sk, c) {
  const m = pm(sk), E = new Map(sk.ents.map((e) => [e.id, e]));
  if (c.t === "dim") return Math.abs(measureDim(sk, c) - c.v);
  if (c.t === "horizontal" || c.t === "vertical") { const [a, b] = c.p1 ? [m.get(c.p1), m.get(c.p2)] : [m.get(E.get(c.e1).a), m.get(E.get(c.e1).b)]; return Math.abs(c.t === "horizontal" ? a.y - b.y : a.x - b.x); }
  if (c.t === "equal") return Math.abs(lineLen(sk, c.e1) - lineLen(sk, c.e2));
  return 0;
}
const worst = (sk) => Math.max(0, ...sk.cons.map((c) => resid(sk, c)));
// the turning angle at each corner of the hexagon, in degrees (all 60 with the same sign for a regular one)
function turns(sk) {
  const m = pm(sk), out = [];
  for (let i = 0; i < 6; i++) {
    const a = m.get("p" + i), b = m.get("p" + ((i + 1) % 6)), c = m.get("p" + ((i + 2) % 6));
    const u = [b.x - a.x, b.y - a.y], v = [c.x - b.x, c.y - b.y];
    out.push((Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI);
  }
  return out;
}
// horizontal on the bottom line, equal down the sides, the bottom length 20, then a 120 degree angle at each corner in the given order
function playHexagon(corners, { onStep } = {}) {
  const sk = hexagon();
  const step = (label, fn) => { const r = edit(sk, fn); if (onStep) onStep(label, r.st, sk); return r.st; };
  step("horizontal", (k) => addConstraint(k, "horizontal", [pick(k, "e0")]));
  for (let i = 1; i < 6; i++) step("equal " + i, (k) => addConstraint(k, "equal", [pick(k, "e" + (i - 1)), pick(k, "e" + i)]));
  const p0 = sk.pts[0], p1 = sk.pts[1];
  const len = buildDim(sk, [pick(sk, "e0")], [(p0.x + p1.x) / 2 + 1, (p0.y + p1.y) / 2 - 4]);
  len.id = "dl";
  step("length placed", (k) => { k.cons.push(len); });
  step("length 20", (k) => { k.cons.find((c) => c.id === "dl").v = 20; });
  let last = null;
  for (const i of corners) {
    const e1 = "e" + i, e2 = "e" + ((i + 1) % 6), V = pm(sk).get("p" + ((i + 1) % 6));
    const cx = sk.pts.reduce((t, p) => t + p.x, 0) / 6, cy = sk.pts.reduce((t, p) => t + p.y, 0) / 6;
    const d = buildDim(sk, [pick(sk, e1), pick(sk, e2)], [V.x + (cx - V.x) * 0.3, V.y + (cy - V.y) * 0.3]);
    assert.equal(d.k, "ang");
    d.id = "da" + i;
    step("angle placed " + i, (k) => { k.cons.push(d); });
    last = step("angle 120 at " + i, (k) => { k.cons.find((c) => c.id === "da" + i).v = 120; });
  }
  return { sk, last };
}
const perms = (a, k) => (k === 0 ? [[]] : a.flatMap((x) => perms(a.filter((y) => y !== x), k - 1).map((r) => [x, ...r])));
// a small seeded shuffle, so a failure can be run again
function shuffled(a, seed) { const r = a.slice(); let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

test("the hexagon from the post: horizontal, equal sides, length 20, then the angle at the corner next to the bottom line", () => {
  const { sk, last } = playHexagon([5]);
  assert.ok(last.ok, "the solve reports success");
  assert.ok(worst(sk) < 1e-6, "every constraint holds: " + worst(sk));
  for (const e of sk.ents) assert.ok(Math.abs(lineLen(sk, e.id) - 20) < 1e-6, e.id + " is 20 long");
  const m = pm(sk);
  assert.ok(Math.abs(m.get("p0").y - m.get("p1").y) < 1e-9, "the bottom line is horizontal");
  // nothing jumped: the old solver threw every point 27-135 mm
  const start = hexagon();
  for (const p of sk.pts) assert.ok(Math.hypot(p.x - start.pts.find((q) => q.id === p.id).x, p.y - start.pts.find((q) => q.id === p.id).y) < 6, p.id + " stays near where it was drawn");
  assert.ok(Math.abs(Math.abs(measureDim(sk, sk.cons.find((c) => c.id === "da5"))) - 120) < 1e-6);
});

test("all 156 orders of one, two or three corner angles solve: every constraint holds, sides are 20, the angles are 120", () => {
  let n = 0;
  for (const k of [1, 2, 3]) for (const order of perms([0, 1, 2, 3, 4, 5], k)) {
    n++;
    const { sk } = playHexagon(order);
    assert.ok(worst(sk) < 1e-6, "[" + order + "] residual " + worst(sk));
    for (const e of sk.ents) assert.ok(Math.abs(lineLen(sk, e.id) - 20) < 1e-6, "[" + order + "] " + e.id + " is " + lineLen(sk, e.id));
    for (const i of order) assert.ok(Math.abs(measureDim(sk, sk.cons.find((c) => c.id === "da" + i)) - 120) < 1e-6);
  }
  assert.equal(n, 156);
});

test("all six angles in 60 shuffled orders: a regular hexagon every time, and at least one angle is reported as repeating the others", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const order = shuffled([0, 1, 2, 3, 4, 5], seed);
    const { sk, last } = playHexagon(order);
    assert.ok(worst(sk) < 1e-6, "seed " + seed + " [" + order + "] residual " + worst(sk));
    for (const e of sk.ents) assert.ok(Math.abs(lineLen(sk, e.id) - 20) < 1e-6, "seed " + seed + " side");
    const t = turns(sk);
    for (const a of t) assert.ok(Math.abs(Math.abs(a) - 60) < 1e-6, "seed " + seed + " turn " + a); // interior angle 120
    assert.ok(t.every((a) => a > 0) || t.every((a) => a < 0), "seed " + seed + ": all corners turn the same way (a convex hexagon)");
    assert.ok(last.ok);
    assert.ok(last.redundant.length >= 1, "seed " + seed + ": a repeat is reported");
    assert.equal(last.dof, 2, "two freedoms are left: the hexagon's position");
  }
});

test("six angles: three repeat the rest, the count says 2 degrees of freedom left, and none of them is called a conflict", () => {
  const { sk, last } = playHexagon([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(last.redundant, ["da3", "da4", "da5"]);
  assert.deepEqual(last.conflicting, []);
  const d = sketchDof(sk);
  assert.equal(d.dof, 2);
  assert.equal(d.redundant, 3);
  assert.equal(d.free, 12);
});

test("the angle sign is stored when the angle is placed and used on every solve", () => {
  const { sk } = playHexagon([2, 4]);
  for (const c of sk.cons.filter((q) => q.k === "ang")) assert.ok(c.sg === 1 || c.sg === -1, "sg stored on " + c.id);
  const before = sk.cons.map((c) => c.sg);
  // drag every point a little and solve many times: the same corners stay on the same side
  for (let r = 0; r < 20; r++) {
    for (const p of sk.pts) { p.x += ((r * 7 + p.id.charCodeAt(1)) % 5 - 2) * 0.4; p.y += ((r * 3 + p.id.charCodeAt(1)) % 5 - 2) * 0.4; }
    assert.ok(solveSketch(sk, new Set()).ok);
    for (const i of [2, 4]) assert.ok(Math.abs(measureDim(sk, sk.cons.find((c) => c.id === "da" + i)) - 120) < 1e-6);
  }
  assert.deepEqual(sk.cons.map((c) => c.sg), before, "the stored sign never changes");
});

test("an old saved angle without a stored sign: the first solve writes it from the geometry, and a read-only count does not", () => {
  const sk = hexagon();
  const d = buildDim(sk, [pick(sk, "e0"), pick(sk, "e1")], [20, -10]);
  d.id = "old"; d.v = 120; delete d.sg;
  sk.cons.push(d);
  sketchDof(sk);
  assert.equal(sk.cons[0].sg, undefined, "sketchDof writes nothing");
  const st = solveSketch(sk, new Set());
  assert.ok(st.ok && Math.abs(measureDim(sk, sk.cons[0]) - 120) < 1e-6);
  assert.ok(sk.cons[0].sg === 1 || sk.cons[0].sg === -1);
});

test("a dimension that fights the other constraints is reported: not ok, with the clashing constraints listed", () => {
  // a rectangle held by horizontal/vertical, 30 wide at the bottom: a different width on the top cannot be true
  const sk = { pts: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 30, y: 0 }, { id: "p2", x: 30, y: 20 }, { id: "p3", x: 0, y: 20 }],
    ents: [0, 1, 2, 3].map((i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 4) })),
    cons: [{ id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "vertical", e1: "e1" }, { id: "k3", t: "horizontal", e1: "e2" }, { id: "k4", t: "vertical", e1: "e3" },
      { id: "d1", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 30 }] };
  assert.ok(solveSketch(sk, new Set()).ok);
  const was = new Map(sk.cons.map((c) => [c.id, conKey(c)]));
  sk.cons.push({ id: "d2", t: "dim", k: "dist", p1: "p3", p2: "p2", o: "h", v: 40 });
  const st = solveSketch(sk, new Set());
  assert.equal(st.ok, false);
  assert.ok(st.worst > 1e-3);
  assert.ok(st.conflicting.includes("d2") && st.conflicting.length >= 2, "the clash is named: " + st.conflicting);
  assert.match(clashNote(sk, st.conflicting, was), /^That length conflicts with the .* constraints?; nothing changed\.$/);
});

test("a wrong angle on the finished hexagon is a conflict, named in plain English", () => {
  const { sk } = playHexagon([0, 1, 2]);
  const was = new Map(sk.cons.map((c) => [c.id, conKey(c)]));
  const V = pm(sk).get("p4");
  const d = buildDim(sk, [pick(sk, "e3"), pick(sk, "e4")], [V.x, V.y - 3]);
  d.id = "bad"; d.v = 90;
  sk.cons.push(d);
  const st = solveSketch(sk, new Set());
  assert.equal(st.ok, false);
  assert.ok(st.conflicting.includes("bad"));
  assert.match(clashNote(sk, st.conflicting, was), /^That angle conflicts with the .*(equal|horizontal).* constraints?; nothing changed\.$/);
});

test("a rectangle with Equal on its sides ends exactly square (the old solver left it about 0.5 mm off)", () => {
  const sk = { pts: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 30.4, y: 0.3 }, { id: "p2", x: 29.7, y: 20.6 }, { id: "p3", x: -0.5, y: 19.8 }],
    ents: [0, 1, 2, 3].map((i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 4) })), cons: [] };
  edit(sk, (k) => addConstraint(k, "horizontal", [pick(k, "e0")]));
  edit(sk, (k) => addConstraint(k, "horizontal", [pick(k, "e2")]));
  edit(sk, (k) => addConstraint(k, "vertical", [pick(k, "e1")]));
  edit(sk, (k) => addConstraint(k, "vertical", [pick(k, "e3")]));
  edit(sk, (k) => addConstraint(k, "equal", [pick(k, "e0"), pick(k, "e1")]));
  edit(sk, (k) => addConstraint(k, "equal", [pick(k, "e1"), pick(k, "e2")]));
  const last = edit(sk, (k) => addConstraint(k, "equal", [pick(k, "e2"), pick(k, "e3")]));
  assert.ok(last.st.ok);
  const L = lineLen(sk, "e0");
  for (const id of ["e1", "e2", "e3"]) assert.ok(Math.abs(lineLen(sk, id) - L) < 1e-9, id + " is " + lineLen(sk, id) + " not " + L);
  assert.ok(worst(sk) < 1e-9);
  assert.ok(L > 15, "a square, not a collapsed one");
});

test("Equal put on first does not collapse the shape to a point", () => {
  const sk = hexagon();
  for (let i = 1; i < 6; i++) edit(sk, (k) => addConstraint(k, "equal", [pick(k, "e" + (i - 1)), pick(k, "e" + i)]));
  const L = lineLen(sk, "e0");
  assert.ok(L > 10 && L < 30, "side length stays near what was drawn: " + L);
  for (const e of sk.ents) assert.ok(Math.abs(lineLen(sk, e.id) - L) < 1e-9);
  edit(sk, (k) => addConstraint(k, "horizontal", [pick(k, "e0")]));
  const p0 = sk.pts[0], p1 = sk.pts[1];
  const len = buildDim(sk, [pick(sk, "e0")], [(p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - 5]);
  len.id = "dl"; len.v = 20;
  const st = edit(sk, (k) => { k.cons.push(len); }).st;
  assert.ok(st.ok);
  for (const e of sk.ents) assert.ok(Math.abs(lineLen(sk, e.id) - 20) < 1e-6);
});

test("geometry that already holds does not move, and fixed points never do", () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 5, y: 5 }, { id: "d", x: 15, y: 9 }, { id: "q", x: 40, y: 40 }, { id: "r", x: 52, y: 40 }],
    ents: [{ id: "L1", t: "line", a: "a", b: "b" }, { id: "L2", t: "line", a: "c", b: "d" }, { id: "far", t: "line", a: "q", b: "r" }],
    cons: [{ id: "k1", t: "horizontal", e1: "L1" }, { id: "k2", t: "origin", p: "a" }, { id: "k3", t: "horizontal", e1: "far" }] };
  const snap = JSON.stringify(sk.pts);
  assert.ok(solveSketch(sk, new Set()).ok);
  assert.equal(JSON.stringify(sk.pts), snap, "nothing was off, so nothing moved");
  // L1 is held by the origin pin, a horizontal and its length: make L2 parallel and equal to it
  sk.cons.push({ id: "k6", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 10 }, { id: "k4", t: "parallel", e1: "L1", e2: "L2" }, { id: "k5", t: "equal", e1: "L1", e2: "L2" });
  sk.pts.find((p) => p.id === "q").y = 41; // far is off; it is its own group
  const before = JSON.parse(JSON.stringify(sk.pts));
  const st = solveSketch(sk, new Set());
  assert.ok(st.ok);
  const now = pm(sk), was = new Map(before.map((p) => [p.id, p]));
  for (const id of ["a", "b"]) assert.ok(Math.hypot(now.get(id).x - was.get(id).x, now.get(id).y - was.get(id).y) < 1e-9, id + " is held by the origin, horizontal and length, and did not move");
  assert.ok(Math.abs(now.get("d").y - now.get("c").y) < 1e-9 && Math.abs(lineLen(sk, "L2") - 10) < 1e-9, "L2 turned and resized to match L1");
  // a projected line never moves, even when a constraint pulls on it
  const pr = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 3 }, { id: "c", x: 2, y: 8 }, { id: "d", x: 9, y: 12 }],
    ents: [{ id: "P", t: "line", a: "a", b: "b", proj: true }, { id: "F", t: "line", a: "c", b: "d" }],
    cons: [{ id: "k1", t: "parallel", e1: "P", e2: "F" }, { id: "k2", t: "equal", e1: "P", e2: "F" }] };
  assert.ok(solveSketch(pr, new Set()).ok);
  const m = pm(pr);
  assert.deepEqual([m.get("a").x, m.get("a").y, m.get("b").x, m.get("b").y], [0, 0, 10, 3]);
  assert.ok(Math.abs(lineLen(pr, "F") - Math.hypot(10, 3)) < 1e-9);
  // a dragged point (keep) stays where it is put and the rest follows
  const dr = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }], ents: [{ id: "L", t: "line", a: "a", b: "b" }], cons: [{ id: "k", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 10 }] };
  dr.pts[1].x = 25; dr.pts[1].y = 5;
  const k = solveSketch(dr, new Set(["b"]));
  assert.deepEqual([dr.pts[1].x, dr.pts[1].y], [25, 5]);
  assert.ok(k.ok && Math.abs(Math.hypot(dr.pts[1].x - dr.pts[0].x, dr.pts[1].y - dr.pts[0].y) - 10) < 1e-9);
});

test("the other constraints still hold: perpendicular, point on a line and a circle, midpoint, tangent, equal circles and the other dimensions", () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 20, y: 1 }, { id: "c", x: 1, y: 2 }, { id: "d", x: 3, y: 18 },
    { id: "m", x: 9, y: 4 }, { id: "o", x: 30, y: 30 }, { id: "o2", x: 60, y: 31 }, { id: "t", x: 36, y: 5 }, { id: "u", x: 50, y: 7 }, { id: "w", x: 5, y: 40 }],
    ents: [{ id: "L1", t: "line", a: "a", b: "b" }, { id: "L2", t: "line", a: "c", b: "d" }, { id: "C1", t: "circle", c: "o", r: 6 }, { id: "C2", t: "circle", c: "o2", r: 9 },
      { id: "T", t: "line", a: "t", b: "u" }, { id: "pt", t: "point", p: "w" }],
    cons: [{ id: "k0", t: "origin", p: "a" }, { id: "k1", t: "horizontal", e1: "L1" }, { id: "k2", t: "perpendicular", e1: "L1", e2: "L2" }, { id: "k3", t: "midpoint", p: "m", e: "L1" },
      { id: "k4", t: "equal", e1: "C1", e2: "C2" }, { id: "k5", t: "tangent", e1: "T", e2: "C1" }, { id: "k6", t: "coincident", p: "w", e: "C1" },
      { id: "d1", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 24 }, { id: "d2", t: "dim", k: "rad", e1: "C1", v: 7 }, { id: "d3", t: "dim", k: "pl", p: "o", e: "L1", v: 30 },
      { id: "d4", t: "dim", k: "ll", e1: "L1", e2: "T", v: 23 }, { id: "d5", t: "dim", k: "dist", p1: "c", p2: "d", o: "v", v: 15 }, { id: "k7", t: "parallel", e1: "T", e2: "L1" }] };
  const st = solveSketch(sk, new Set());
  assert.ok(st.ok, "ok, worst " + st.worst + " conflicting " + st.conflicting);
  const m = pm(sk), E = new Map(sk.ents.map((e) => [e.id, e]));
  assert.ok(Math.abs(m.get("a").x) + Math.abs(m.get("a").y) < 1e-12);
  assert.ok(Math.abs(m.get("m").x - (m.get("a").x + m.get("b").x) / 2) < 1e-9 && Math.abs(m.get("m").y - (m.get("a").y + m.get("b").y) / 2) < 1e-9);
  assert.ok(Math.abs(E.get("C1").r - 7) < 1e-9 && Math.abs(E.get("C2").r - 7) < 1e-9);
  assert.ok(Math.abs(Math.hypot(m.get("w").x - m.get("o").x, m.get("w").y - m.get("o").y) - 7) < 1e-9);
  assert.ok(Math.abs(Math.abs(m.get("d").y - m.get("c").y) - 15) < 1e-9);
  const dotp = (m.get("b").x - m.get("a").x) * (m.get("d").x - m.get("c").x) + (m.get("b").y - m.get("a").y) * (m.get("d").y - m.get("c").y);
  assert.ok(Math.abs(dotp) < 1e-8);
  // the tangent line touches circle C1
  const t = m.get("t"), u = m.get("u"), o = m.get("o"), Lt = Math.hypot(u.x - t.x, u.y - t.y);
  assert.ok(Math.abs(Math.abs(((o.x - t.x) * -(u.y - t.y) + (o.y - t.y) * (u.x - t.x)) / Lt) - 7) < 1e-9);
});

test("an arc keeps its end on its circle while the solver moves it", () => {
  const sk = { pts: [{ id: "c", x: 0, y: 0 }, { id: "a", x: 10, y: 0 }, { id: "b", x: 0, y: 10 }, { id: "x", x: 30, y: 2 }],
    ents: [{ id: "A", t: "arc", c: "c", a: "a", b: "b" }, { id: "L", t: "line", a: "b", b: "x" }],
    cons: [{ id: "k1", t: "horizontal", e1: "L" }, { id: "k2", t: "origin", p: "c" }] };
  assert.ok(solveSketch(sk, new Set()).ok);
  const m = pm(sk);
  assert.ok(Math.abs(Math.hypot(m.get("b").x, m.get("b").y) - Math.hypot(m.get("a").x, m.get("a").y)) < 1e-9, "the arc's end is still on its circle");
  assert.ok(Math.abs(m.get("b").y - m.get("x").y) < 1e-9);
});

test("a circle that would shrink to nothing is refused, not drawn", () => {
  const sk = { pts: [{ id: "c", x: 0, y: 0 }], ents: [{ id: "C", t: "circle", c: "c", r: 5 }], cons: [{ id: "d", t: "dim", k: "rad", e1: "C", v: 0 }] };
  const st = solveSketch(sk, new Set());
  assert.equal(st.ok, false);
  assert.equal(sk.ents[0].r, 5);
});

test("returns usable fields for a sketch with no constraints, and ignores a constraint that points at nothing", () => {
  const sk = hexagon();
  const bare = { pts: sk.pts, ents: sk.ents }; // a sketch saved with no constraints list at all
  assert.deepEqual(sketchDof(bare), { free: 12, rank: 0, dof: 12, redundant: 0 });
  assert.deepEqual(solveSketch(sk, new Set()), { ok: true, worst: 0, redundant: [], conflicting: [], dof: null });
  sk.cons.push({ id: "z", t: "equal", e1: "gone", e2: "e0" });
  assert.equal(solveSketch(sk, new Set()).ok, true);
  assert.equal(sk.cons.length, 0, "pruned");
});

// a line that ends on an arc, tangent there: the usual "distance from the centre equals the radius" row is flat at the answer in that
// case, so a count would call the tangent a repeat; the solver squares the radius to the line instead
const pick2 = (sk, id) => { const e = sk.ents.find((x) => x.id === id); return { kind: e.t === "line" ? "line" : "round", e }; };
function roundedRect(W, H, R, jitter = 0) {
  const j = (i) => ((i * 7919) % 13 - 6) / 6 * jitter; // fixed small nudges, so the drawing is a little off
  const P = [["cbl", R, R], ["cbr", W - R, R], ["ctr", W - R, H - R], ["ctl", R, H - R],
    ["b1", R, 0], ["b2", W - R, 0], ["r1", W, R], ["r2", W, H - R], ["t1", W - R, H], ["t2", R, H], ["l1", 0, H - R], ["l2", 0, R]];
  const pts = P.map(([id, x, y], i) => ({ id, x: x + j(i), y: y + j(i + 3) }));
  const ents = [{ id: "B", t: "line", a: "b1", b: "b2" }, { id: "Rt", t: "line", a: "r1", b: "r2" }, { id: "T", t: "line", a: "t1", b: "t2" }, { id: "L", t: "line", a: "l1", b: "l2" },
    { id: "ABR", t: "arc", c: "cbr", a: "b2", b: "r1" }, { id: "ATR", t: "arc", c: "ctr", a: "r2", b: "t1" }, { id: "ATL", t: "arc", c: "ctl", a: "t2", b: "l1" }, { id: "ABL", t: "arc", c: "cbl", a: "l2", b: "b1" }];
  return { pts, ents, cons: [] };
}
test("a rounded rectangle held by tangents, horizontals, verticals, equal radii and dimensions has no degrees of freedom left and no repeats", () => {
  const sk = roundedRect(60, 40, 8, 0.3);
  for (const [a, b] of [["B", "ABR"], ["Rt", "ABR"], ["Rt", "ATR"], ["T", "ATR"], ["T", "ATL"], ["L", "ATL"], ["L", "ABL"], ["B", "ABL"]]) edit(sk, (k) => addConstraint(k, "tangent", [pick2(k, a), pick2(k, b)]));
  for (const id of ["B", "T"]) edit(sk, (k) => addConstraint(k, "horizontal", [pick2(k, id)]));
  for (const id of ["L", "Rt"]) edit(sk, (k) => addConstraint(k, "vertical", [pick2(k, id)]));
  for (const id of ["ATR", "ATL", "ABL"]) edit(sk, (k) => addConstraint(k, "equal", [pick2(k, "ABR"), pick2(k, id)]));
  const push = (c) => edit(sk, (k) => { k.cons.push(c); });
  push({ id: "dr", t: "dim", k: "rad", e1: "ABR", v: 8 });
  push({ id: "dw", t: "dim", k: "dist", p1: "l1", p2: "r2", o: "h", v: 60 });
  push({ id: "dh", t: "dim", k: "dist", p1: "b1", p2: "t2", o: "v", v: 40 });
  push({ id: "o", t: "origin", p: "l2" });
  const st = solveSketch(sk, new Set());
  assert.ok(st.ok, "worst " + st.worst);
  assert.deepEqual(st.redundant, [], "no tangent is called a repeat");
  const d = sketchDof(sk);
  assert.equal(d.dof, 0, "fully constrained: " + JSON.stringify(d));
  assert.equal(d.redundant, 0);
  const m = pm(sk);
  assert.ok(Math.abs(m.get("r1").x - 60) < 1e-6 && Math.abs(m.get("t2").y - m.get("b1").y - 40) < 1e-6 && Math.abs(m.get("l2").x) + Math.abs(m.get("l2").y) < 1e-12);
});
test("a slot (two arcs and two lines): horizontal and four tangents give no repeats, and with its dimensions it is fully constrained", () => {
  const sk = { pts: [{ id: "cl", x: 0, y: 0 }, { id: "cr", x: 40, y: 0.5 }, { id: "t1", x: 0, y: 10 }, { id: "b1", x: 0.3, y: -10 }, { id: "t2", x: 40, y: 10.4 }, { id: "b2", x: 40, y: -9.5 }],
    ents: [{ id: "Al", t: "arc", c: "cl", a: "t1", b: "b1" }, { id: "Ar", t: "arc", c: "cr", a: "b2", b: "t2" }, { id: "e0", t: "line", a: "b1", b: "b2" }, { id: "e1", t: "line", a: "t2", b: "t1" }], cons: [] };
  const seen = [];
  const tryEdit = (fn) => { const before = solveSketch(JSON.parse(JSON.stringify(sk))); const r = edit(sk, fn); seen.push(...r.st.redundant.filter((id) => !before.redundant.includes(id))); };
  tryEdit((k) => addConstraint(k, "horizontal", [pick2(k, "e0")]));
  for (const [a, b] of [["e0", "Al"], ["e0", "Ar"], ["e1", "Al"], ["e1", "Ar"]]) tryEdit((k) => addConstraint(k, "tangent", [pick2(k, a), pick2(k, b)]));
  tryEdit((k) => addConstraint(k, "equal", [pick2(k, "Al"), pick2(k, "Ar")]));
  tryEdit((k) => addConstraint(k, "coincident", [{ kind: "pt", pid: "cl" }, { kind: "origin" }]));
  tryEdit((k) => { k.cons.push({ id: "r", t: "dim", k: "rad", e1: "Al", v: 10 }); });
  tryEdit((k) => { k.cons.push({ id: "l", t: "dim", k: "dist", p1: "b1", p2: "b2", o: "a", v: 40 }); });
  assert.deepEqual(seen, [], "no edit along the way calls anything a repeat");
  const d = sketchDof(sk);
  assert.deepEqual([d.dof, d.redundant], [0, 0]);
});

// a guard on speed: the count runs on every redraw and a drag solves on every mouse move, so a long sketch must stay quick.
// (Generous limits, the best of three runs; they catch a slide back to seconds, not milliseconds.)
function chain(nl) { // a zig-zag of nl lines sharing ends, each horizontal or vertical with a length, the first point on the origin: one connected group, fully constrained
  const pts = [], ents = [], cons = [{ id: "o", t: "origin", p: "p0" }];
  let x = 0, y = 0;
  for (let i = 0; i <= nl; i++) { pts.push({ id: "p" + i, x: x + (i ? 0.3 * Math.sin(i) : 0), y: y + (i ? 0.3 * Math.cos(i) : 0) }); if (i % 2 === 0) x += 10; else y += 10; }
  for (let i = 0; i < nl; i++) {
    ents.push({ id: "e" + i, t: "line", a: "p" + i, b: "p" + (i + 1) });
    cons.push({ id: "h" + i, t: i % 2 ? "vertical" : "horizontal", e1: "e" + i }, { id: "d" + i, t: "dim", k: "dist", p1: "p" + i, p2: "p" + (i + 1), o: "a", v: 10 });
  }
  return { pts, ents, cons };
}
const best = (fn) => { let b = Infinity; for (let i = 0; i < 3; i++) { const t = performance.now(); fn(); b = Math.min(b, performance.now() - t); } return b; };
test("speed: counting the freedoms of a 100-line sketch takes under half a second, and a drag that nothing can satisfy under 0.3 s a frame", () => {
  const sk = chain(100);
  assert.ok(solveSketch(sk, new Set()).ok);
  assert.equal(sketchDof(sk).dof, 0);
  const count = best(() => sketchDof(sk));
  assert.ok(count < 500, "sketchDof took " + count.toFixed(0) + " ms");
  // dragging the last point of a fully constrained chain is a position nothing can satisfy
  const drag = best(() => { const s = JSON.parse(JSON.stringify(sk)); const p = s.pts[s.pts.length - 1]; p.x += 3; p.y += 2; solveSketch(s, new Set([p.id])); });
  assert.ok(drag < 300, "a drag frame took " + drag.toFixed(0) + " ms");
  // a drag that can be satisfied still follows the mouse
  const free = chain(100); free.cons = free.cons.filter((c) => c.t !== "dim");
  const s = JSON.parse(JSON.stringify(free)); const mid = s.pts[50]; mid.x += 3; mid.y += 2;
  const st = solveSketch(s, new Set([mid.id]));
  assert.ok(st.ok);
  assert.deepEqual([mid.x, mid.y].map((v) => +v.toFixed(9)), [free.pts[50].x + 3, free.pts[50].y + 2].map((v) => +v.toFixed(9)));
});

// ---- the decision sketcher.edit makes after a constraint or dimension edit: editVerdict (refuse / keep with a note / keep)
const clone = (o) => JSON.parse(JSON.stringify(o));
// one guarded edit the way sketcher.edit does it: solve a copy for "before", change, prune, solve; a refused edit leaves the sketch as it was
function guarded(sk, fn) {
  const before = clone(sk), pre = solveSketch(clone(sk)), was = new Map((sk.cons || []).map((c) => [c.id, conKey(c)]));
  fn(sk); pruneConstraints(sk);
  const st = solveSketch(sk, new Set());
  const v = editVerdict(pre, st, was, sk.cons);
  if (v.refuse) { sk.pts = before.pts; sk.ents = before.ents; sk.cons = before.cons; } else normalizeSketch(sk);
  return { ...v, st, pre };
}
// the rule before editVerdict looked at residuals: any constraint that was not in the old clash and now fails refuses the edit
const oldRule = (pre, st) => !st.ok && (pre.ok || st.conflicting.some((id) => !pre.conflicting.includes(id)));
const rect4 = () => ({ pts: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 30, y: 0 }, { id: "p2", x: 30, y: 20 }, { id: "p3", x: 0, y: 20 }],
  ents: [0, 1, 2, 3].map((i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 4) })),
  cons: [{ id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "vertical", e1: "e1" }, { id: "k3", t: "horizontal", e1: "e2" }, { id: "k4", t: "vertical", e1: "e3" }, { id: "d1", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 30 }] });
// five lines in a ring, hand-drawn off true, with a clash already in it: the second and third sides are equal, yet one is told 10 long and the other 14
function clashed() {
  const sk = { pts: [["a", 0, 0], ["b", 10, 0.4], ["c", 20.3, 5], ["d", 28, 12], ["e", 30, -3]].map(([id, x, y]) => ({ id, x, y })),
    ents: [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "a"]].map(([a, b], i) => ({ id: "e" + i, t: "line", a, b })),
    cons: [{ id: "h0", t: "horizontal", e1: "e0" }, { id: "l0", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 10 }, { id: "eq", t: "equal", e1: "e1", e2: "e2" }, { id: "pp", t: "perpendicular", e1: "e1", e2: "e2" },
      { id: "v3", t: "vertical", e1: "e3" }, { id: "l3", t: "dim", k: "dist", p1: "d", p2: "e", o: "a", v: 15 }, { id: "par", t: "parallel", e1: "e0", e2: "e4" },
      { id: "x1", t: "dim", k: "dist", p1: "b", p2: "c", o: "a", v: 10 }, { id: "x2", t: "dim", k: "dist", p1: "c", p2: "d", o: "a", v: 14 }] };
  assert.equal(solveSketch(sk, new Set()).ok, false);
  normalizeSketch(sk);
  return sk;
}

test("editVerdict: a solvable sketch refuses an edit that cannot hold, with the clash named, and the sketch is left alone", () => {
  const sk = rect4(), keep = clone(sk);
  const v = guarded(sk, (k) => k.cons.push({ id: "d2", t: "dim", k: "dist", p1: "p3", p2: "p2", o: "h", v: 40 }));
  assert.equal(v.refuse, true);
  assert.match(v.toast, /^That length conflicts with the .* constraints?; nothing changed\.$/);
  assert.deepEqual(sk, keep);
});

test("editVerdict: a constraint that only repeats the others is kept, with a note that names it", () => {
  const sk = rect4();
  const v = guarded(sk, (k) => addConstraint(k, "parallel", [pick(k, "e0"), pick(k, "e2")]));
  assert.equal(v.refuse, false);
  assert.equal(v.toast, "That parallel repeats what the other constraints already hold, so it adds nothing. It is kept.");
  assert.equal(sk.cons.length, 6);
  // a fine edit has no toast at all
  assert.deepEqual(guarded(rect4(), (k) => { k.cons.find((c) => c.id === "d1").v = 35; }).toast, null);
});

test("editVerdict: after a point merge that adds no constraint, the note says 'After that, the ... constraint repeats'", () => {
  // two lines each told 10 long; merging the second one's ends into the first one's makes the two lengths the same line
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 0, y: 5 }, { id: "d", x: 10, y: 5 }],
    ents: [{ id: "L1", t: "line", a: "a", b: "b" }, { id: "L2", t: "line", a: "c", b: "d" }],
    cons: [{ id: "n1", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 10 }, { id: "n2", t: "dim", k: "dist", p1: "c", p2: "d", o: "a", v: 10 }] };
  assert.ok(solveSketch(sk, new Set()).ok);
  const v = guarded(sk, (k) => {
    const to = { c: "a", d: "b" };
    for (const e of k.ents) { e.a = to[e.a] || e.a; e.b = to[e.b] || e.b; }
    for (const c of k.cons) { c.p1 = to[c.p1] || c.p1; c.p2 = to[c.p2] || c.p2; }
    k.pts = k.pts.filter((p) => !to[p.id]);
  });
  assert.equal(v.refuse, false);
  assert.equal(v.toast, "After that, the length constraint repeats what the others hold, so it adds nothing. It is kept.");
});

test("editVerdict: a sketch that already clashes keeps its clash, and a harmless edit goes through with a note", () => {
  const sk = clashed();
  const pre = solveSketch(clone(sk));
  assert.deepEqual(pre.conflicting.sort(), ["eq", "x1", "x2"]);
  // 'Origin' on a point is harmless: nothing already held is touched
  const v = guarded(sk, (k) => addConstraint(k, "coincident", [{ kind: "pt", pid: "a" }, { kind: "origin" }]));
  assert.equal(v.refuse, false);
  assert.equal(v.toast, "The sketch still has constraints that conflict: equal and length.");
});

test("editVerdict: with an old clash, an edit that makes another constraint fail is refused, whether its id is new or old", () => {
  // a new constraint (new id) that cannot hold alongside the rest
  for (const [t, a, b] of [["equal", "e0", "e3"], ["perpendicular", "e0", "e1"]]) {
    const sk = clashed(), keep = clone(sk);
    const v = guarded(sk, (k) => addConstraint(k, t, [pick(k, a), pick(k, b)]));
    assert.equal(v.refuse, true, t + " is refused");
    assert.match(v.toast, new RegExp("^That " + t + " conflicts with the .* constraints?; nothing changed\\.$"));
    assert.deepEqual(sk, keep);
  }
  // an old, held constraint that is made to fail: the left side must be 10 and the top (parallel to it) is held as 10 long too
  const sk = clashed();
  const v = guarded(sk, (k) => { k.cons.push({ id: "z", t: "dim", k: "dist", p1: "a", p2: "e", o: "a", v: 60 }); });
  assert.equal(v.refuse, true);
});

test("editVerdict: leftover error from the old clash spreading onto a constraint that held does not refuse a harmless edit", () => {
  // the distance from a to c typed to one decimal: it shifts the compromise a little, and the constraints that held take a sliver of the old clash
  const sk = clashed(), a = sk.pts.find((p) => p.id === "a"), b = sk.pts.find((p) => p.id === "c");
  const typed = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10;
  assert.notEqual(typed, Math.hypot(b.x - a.x, b.y - a.y));
  const probe = clone(sk);
  const v0 = guarded(probe, (k) => k.cons.push({ id: "n", t: "dim", k: "dist", p1: "a", p2: "c", o: "a", v: typed }));
  assert.ok(oldRule(v0.pre, v0.st), "the old rule refused this edit: " + v0.st.conflicting);
  const newly = v0.st.conflicting.filter((id) => !v0.pre.conflicting.includes(id));
  assert.ok(newly.some((id) => id !== "n"), "a constraint that held before took some of the error: " + newly);
  assert.ok(newly.every((id) => v0.st.resid[id] < 0.03 * v0.pre.worst), "...but only a sliver of the old worst error (" + v0.pre.worst.toFixed(3) + ")");
  assert.equal(v0.refuse, false);
  assert.match(v0.toast, /^The sketch still has constraints that conflict: /);
  // while a dimension that really fights the old clash moves one of them as far as the clash itself
  const hard = clashed();
  const v1 = guarded(hard, (k) => k.cons.push({ id: "n", t: "dim", k: "dist", p1: "a", p2: "c", o: "a", v: typed + 8 }));
  assert.equal(v1.refuse, true);
  const newlyHard = v1.st.conflicting.filter((id) => !v1.pre.conflicting.includes(id));
  assert.ok(newlyHard.some((id) => v1.st.resid[id] > 0.15 * v1.pre.worst), "a real conflict moves a constraint by more than 15 % of the old worst error (" + v1.pre.worst.toFixed(3) + ")");
});

test("Fixed pins a circle centre while tangent changes its radius", () => {
  const sk = { pts: [{ id: "c", x: 0, y: 5 }, { id: "a", x: -10, y: 0 }, { id: "b", x: 10, y: 0 }], ents: [{ id: "circle", t: "circle", c: "c", r: 2 }, { id: "line", t: "line", a: "a", b: "b" }], cons: [] };
  addConstraint(sk, "fixed", [{ kind: "round", e: sk.ents[0] }, { kind: "line", e: sk.ents[1] }]);
  addConstraint(sk, "tangent", [{ kind: "round", e: sk.ents[0] }, { kind: "line", e: sk.ents[1] }]);
  assert.equal(solveSketch(sk).ok, true);
  assert.deepEqual(sk.pts, [{ id: "c", x: 0, y: 5 }, { id: "a", x: -10, y: 0 }, { id: "b", x: 10, y: 0 }]);
  assert.ok(Math.abs(sk.ents[0].r - 5) < 1e-6);
});

test("Fixed line ends resist pulls and dragging; each point removes two freedoms", () => {
  const sk = { pts: [{ id: "a", x: 1, y: 2 }, { id: "b", x: 6, y: 2 }, { id: "c", x: 1, y: 7 }], ents: [{ id: "l", t: "line", a: "a", b: "b" }, { id: "p", t: "point", p: "c" }], cons: [] };
  const before = sketchDof(sk).dof;
  addConstraint(sk, "fixed", [{ kind: "line", e: sk.ents[0] }]);
  assert.equal(sketchDof(sk).dof, before - 4);
  sk.cons.push({ id: "d", t: "dim", k: "dist", p1: "a", p2: "c", v: 10 });
  sk.pts[0].x = 20; sk.pts[1].y = 30;
  assert.equal(solveSketch(sk, new Set(["a", "b"])).ok, true);
  assert.deepEqual(sk.pts.slice(0, 2), [{ id: "a", x: 1, y: 2 }, { id: "b", x: 6, y: 2 }]);
  assert.ok(Math.abs(sk.pts[2].y - 12) < 1e-6);
  assert.match(addConstraint(sk, "fixed", [{ kind: "pt", pid: "a" }]), /already fixed/);
  const copy = JSON.parse(JSON.stringify(sk)); solveSketch(copy);
  assert.deepEqual(copy.cons, sk.cons);
});

test("Fixed records clashes, can pin a rectangle selection, and prunes deleted points", () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }, { id: "c", x: 4, y: 3 }, { id: "d", x: 0, y: 3 }], ents: ["a", "b", "c", "d"].map((p, i, all) => ({ id: "e" + i, t: "line", a: p, b: all[(i + 1) % 4] })), cons: [] };
  addConstraint(sk, "fixed", sk.ents.map((e) => ({ kind: "line", e })));
  assert.equal(sk.cons.length, 4); assert.equal(sketchDof(sk).dof, 0);
  sk.cons.push({ id: "clash", t: "dim", k: "dist", p1: "a", p2: "b", v: 8 });
  assert.deepEqual(solveSketch(sk).conflicting, ["clash"]);
  sk.pts = sk.pts.filter((p) => p.id !== "a"); pruneConstraints(sk);
  assert.equal(sk.cons.some((c) => c.p === "a"), false);
});

test("old design JSON solves exactly as before Fixed was added", () => {
  const sk = JSON.parse('{"pts":[{"id":"a","x":1,"y":2},{"id":"b","x":8,"y":5}],"ents":[{"id":"l","t":"line","a":"a","b":"b"}],"cons":[{"id":"h","t":"horizontal","e1":"l"}]}');
  const result = solveSketch(sk);
  assert.deepEqual({ result, sk }, JSON.parse('{"result":{"ok":true,"worst":7.460698725481052e-14,"redundant":[],"conflicting":[],"dof":3,"resid":{"h":7.460698725481052e-14}},"sk":{"pts":[{"id":"a","x":1,"y":3.5000000000499227},{"id":"b","x":8,"y":3.5000000000499973}],"ents":[{"id":"l","t":"line","a":"a","b":"b"}],"cons":[{"id":"h","t":"horizontal","e1":"l"}]}}'));
});

// the rectangle tool adds Horizontal and Vertical to its four sides (sketcher.js); Fixed on top of them must not read as a repeat
const toolRect = () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }, { id: "c", x: 4, y: 3 }, { id: "d", x: 0, y: 3 }], ents: ["a", "b", "c", "d"].map((p, i, all) => ({ id: "e" + i, t: "line", a: p, b: all[(i + 1) % 4] })), cons: [] };
  sk.ents.forEach((e, i) => sk.cons.push({ id: "hv" + i, t: i % 2 ? "vertical" : "horizontal", e1: e.id }));
  return sk;
};
function fixEdit(sk, fn) { const pre = solveSketch(clone(sk)), was = new Map(sk.cons.map((c) => [c.id, conKey(c)])); const msg = fn(sk); const st = solveSketch(sk); return { msg, v: editVerdict(pre, st, was, sk.cons), dof: sketchDof(sk), st }; }
test("Fixed on a rectangle-tool rectangle: one side leaves 1 free, all four sides leave 0, nothing is a repeat and no toast", () => {
  let sk = toolRect();
  let r = fixEdit(sk, (s) => addConstraint(s, "fixed", [{ kind: "line", e: s.ents[0] }]));
  assert.equal(r.v.toast, null); assert.equal(r.dof.dof, 1); assert.equal(r.dof.redundant, 0);
  sk = toolRect();
  r = fixEdit(sk, (s) => addConstraint(s, "fixed", s.ents.map((e) => ({ kind: "line", e }))));
  assert.equal(r.v.toast, null, "no repeat toast"); assert.equal(r.dof.dof, 0); assert.equal(r.dof.redundant, 0);
  assert.deepEqual(r.st.redundant, []);
  // one at a time, each Fixed after the last: still no repeat
  sk = toolRect();
  for (const e of sk.ents) { r = fixEdit(sk, (s) => addConstraint(s, "fixed", [{ kind: "line", e: s.ents.find((x) => x.id === e.id) }])); assert.equal(r.v.toast, null); }
  assert.equal(sketchDof(sk).redundant, 0);
});

test("Concentric with both centres already fixed is refused in plain words", () => {
  const sk = { pts: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 10, y: 0 }], ents: [{ id: "k1", t: "circle", c: "c1", r: 2 }, { id: "k2", t: "circle", c: "c2", r: 3 }], cons: [] };
  addConstraint(sk, "fixed", [{ kind: "round", e: sk.ents[0] }, { kind: "round", e: sk.ents[1] }]);
  const n = sk.cons.length;
  assert.equal(addConstraint(sk, "concentric", [{ kind: "round", e: sk.ents[0] }, { kind: "round", e: sk.ents[1] }]), "Both centres are already fixed.");
  assert.equal(sk.cons.length, n); assert.equal(sk.pts.length, 2);
});

test("a Fixed with no position (a hand-edited file) is dropped, and nothing turns NaN", () => {
  const sk = { pts: [{ id: "a", x: 1, y: 2 }, { id: "b", x: 5, y: 2 }], ents: [{ id: "l", t: "line", a: "a", b: "b" }], cons: [{ id: "f1", t: "fixed", p: "a" }, { id: "f2", t: "fixed", p: "b", x: 5 }] };
  const solved = solveSketch(clone(sk)); // before pruning: ignored, not NaN
  assert.ok(solved.ok); assert.ok(Number.isFinite(solved.worst));
  pruneConstraints(sk);
  assert.deepEqual(sk.cons, []);
  assert.deepEqual(sk.pts.map((p) => [p.x, p.y]), [[1, 2], [5, 2]]);
});

test("isPinned: a Fixed point, an origin point and a projected point are pinned; a free one is not", () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }, { id: "c", x: 2, y: 0 }, { id: "d", x: 3, y: 0 }], ents: [{ id: "l", t: "line", a: "c", b: "d", proj: true }], cons: [{ id: "f", t: "fixed", p: "a", x: 0, y: 0 }, { id: "o", t: "origin", p: "b" }] };
  assert.deepEqual(["a", "b", "c", "d"].map((id) => isPinned(sk, id)), [true, true, true, true]);
  assert.equal(isPinned({ ...sk, ents: [], cons: [] }, "a"), false);
});
