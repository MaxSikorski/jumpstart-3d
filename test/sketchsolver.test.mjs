// The sketch solver (src/constraints.js, "jumpstart-3d: sketch solver"), in Node with no browser: the hexagon from the Reddit post
// "Not there yet?" (horizontal + equal sides + length + 120 degree angles, clicked in any order), exactness, fixed points, conflicts and
// repeats. The same flow through the real app is test/sketch-solver.spec.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { solveSketch, normalizeSketch, addConstraint, pruneConstraints, sketchDof, clashNote, conKey } from "../src/constraints.js";
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
