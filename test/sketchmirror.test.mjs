// Sketch Mirror (issue #181): the maths of src/sketchmirror.js in Node. The tool through the real UI is test/sketchmirror.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorEnts, reflect } from "../src/sketchmirror.js";
import { sketchDof, solveSketch } from "../src/constraints.js";

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m || ""} ${a} vs ${b}`);
const Y = { type: "line", a: [0, 0], b: [0, 1] }, X = { type: "line", a: [0, 0], b: [1, 0] }, O = { type: "point", p: [0, 0] };
const tilt = { type: "line", a: [0, 10], b: [10, 20] }; // y = x + 10
const at = (sk, r, id) => { const p = [...sk.pts, ...r.pts].find((q) => q.id === id); return [p.x, p.y]; };

test("reflect: Y axis, X axis, origin and an angled line follow the formula", () => {
  assert.deepEqual(reflect([3, 4], Y), [-3, 4]);
  assert.deepEqual(reflect([3, 4], X), [3, -4]);
  assert.deepEqual(reflect([3, 4], O), [-3, -4]);
  const [x, y] = reflect([5, 0], tilt); // across y = x + 10: (x, y) -> (y - 10, x + 10)
  near(x, -10); near(y, 15);
});

test("a half profile against the Y axis: the on-axis points are shared, so the copy closes into one loop", () => {
  const sk = { pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 20, y: 0 }, { id: "c", x: 20, y: 10 }, { id: "d", x: 0, y: 10 }],
    ents: [{ id: "e0", t: "line", a: "a", b: "b" }, { id: "e1", t: "line", a: "b", b: "c" }, { id: "e2", t: "line", a: "c", b: "d" }, { id: "e3", t: "line", a: "d", b: "a" }], cons: [] };
  const r = mirrorEnts(sk, ["e0", "e1", "e2", "e3"], Y);
  assert.equal(r.pts.length, 2); // only (-20,0) and (-20,10) are new
  assert.equal(r.ents.length, 3); // the line on the axis is its own mirror image
  assert.equal(r.skipped.same, 1);
  const used = new Set(r.ents.flatMap((e) => [e.a, e.b]));
  assert.ok(used.has("a") && used.has("d"), "the copy is joined to the original at the axis points");
});

test("an arc keeps its counter-clockwise direction: the ends swap", () => {
  const sk = { pts: [{ id: "c", x: 10, y: 0 }, { id: "a", x: 20, y: 0 }, { id: "b", x: 10, y: 10 }], ents: [{ id: "e", t: "arc", c: "c", a: "a", b: "b" }] };
  const r = mirrorEnts(sk, ["e"], Y);
  const m = r.ents[0];
  assert.deepEqual(at(sk, r, m.c), [-10, 0]);
  assert.deepEqual(at(sk, r, m.a), [-10, 10]); // old b
  assert.deepEqual(at(sk, r, m.b), [-20, 0]); // old a
  // counter-clockwise from a to b is a quarter turn (90 degrees), not three quarters
  const ang = (id) => { const [x, y] = at(sk, r, id), [cx, cy] = at(sk, r, m.c); return Math.atan2(y - cy, x - cx); };
  let sweep = (ang(m.b) - ang(m.a)) % (2 * Math.PI); if (sweep < 0) sweep += 2 * Math.PI;
  near(sweep, Math.PI / 2);
});

test("a spline, a circle and a point across an angled line land on the reflected positions; closed stays closed", () => {
  const sk = { pts: [{ id: "p1", x: 0, y: 0 }, { id: "p2", x: 10, y: 5 }, { id: "p3", x: 20, y: -5 }, { id: "c", x: 30, y: 0 }, { id: "q", x: 5, y: 5 }],
    ents: [{ id: "s", t: "spline", pts: ["p1", "p2", "p3"], closed: false }, { id: "k", t: "circle", c: "c", r: 4 }, { id: "pt", t: "point", p: "q" }, { id: "sc", t: "spline", pts: ["p1", "p2", "p3"], closed: true }] };
  const r = mirrorEnts(sk, ["s", "k", "pt", "sc"], tilt);
  const [s2, k2, pt2, sc2] = r.ents;
  ["p1", "p2", "p3"].forEach((id, i) => { const want = reflect(at(sk, r, id), tilt); assert.deepEqual(at(sk, r, s2.pts[i]).map((v) => +v.toFixed(9)), want.map((v) => +v.toFixed(9))); });
  assert.equal(k2.r, 4);
  assert.deepEqual(at(sk, r, k2.c).map((v) => +v.toFixed(9)), reflect([30, 0], tilt).map((v) => +v.toFixed(9)));
  assert.deepEqual(at(sk, r, pt2.p).map((v) => +v.toFixed(9)), reflect([5, 5], tilt).map((v) => +v.toFixed(9)));
  assert.equal(sc2.closed, true);
  assert.equal(s2.closed, false);
});

test("projected shapes become normal copies, construction stays construction, text is skipped and counted", () => {
  const sk = { pts: [{ id: "a", x: 5, y: 0 }, { id: "b", x: 5, y: 10 }, { id: "c", x: 8, y: 0 }, { id: "d", x: 8, y: 10 }, { id: "t", x: 12, y: 3 }],
    ents: [{ id: "e0", t: "line", a: "a", b: "b", proj: true }, { id: "e1", t: "line", a: "c", b: "d", cons: true }, { id: "tx", t: "text", p: "t", str: "Hi", size: 10, angle: 0, font: "sans" }] };
  const r = mirrorEnts(sk, ["e0", "e1", "tx"], Y);
  assert.equal(r.ents.length, 2);
  assert.equal(r.ents[0].proj, undefined);
  assert.equal(r.ents[0].cons, undefined);
  assert.equal(r.ents[1].cons, true);
  assert.equal(r.skipped.text, 1);
  assert.equal(r.pts.length, 4, "the text's point is not mirrored");
});

test("constraints among the picked shapes are copied with the copy's ids; the rest are not", () => {
  const sk = { pts: [{ id: "a", x: 10, y: 0 }, { id: "b", x: 30, y: 0 }, { id: "c", x: 30, y: 10 }, { id: "d", x: 10, y: 10 }, { id: "m", x: 20, y: 0 }, { id: "cc", x: 20, y: 5 }],
    ents: [{ id: "e0", t: "line", a: "a", b: "b" }, { id: "e1", t: "line", a: "b", b: "c" }, { id: "e2", t: "line", a: "c", b: "d" }, { id: "k", t: "circle", c: "cc", r: 2 }, { id: "o", t: "line", a: "a", b: "d" }, { id: "mpt", t: "point", p: "m" }],
    cons: [
      { id: "k1", t: "parallel", e1: "e0", e2: "e2" },
      { id: "k2", t: "perpendicular", e1: "e0", e2: "e1" },
      { id: "k3", t: "equal", e1: "e1", e2: "o" }, // o is not picked: not copied
      { id: "k4", t: "midpoint", p: "m", e: "e0" },
      { id: "k5", t: "horizontal", e1: "e0" },
      { id: "k6", t: "origin", p: "a" },
      { id: "d1", t: "dim", k: "dist", p1: "a", p2: "b", o: "a", v: 20, off: [20, -3], name: "w" },
      { id: "d2", t: "dim", k: "dist", p1: "b", p2: "c", o: "v", v: 10, off: [33, 5], expr: "h" },
      { id: "d3", t: "dim", k: "dia", e1: "k", v: 4, off: [22, 7] },
      { id: "d4", t: "dim", k: "ang", e1: "e0", e2: "e1", v: 90, s1: 1, s2: 1 },
    ] };
  const ids = ["e0", "e1", "e2", "k", "mpt"];
  const idsOf = (r) => r.cons.map((c) => c.t + (c.k ? ":" + c.k : ""));
  // across the Y axis: horizontal/vertical ones are kept
  let r = mirrorEnts(sk, ids, Y);
  // (the perpendicular repeats the 90 degree dimension, so only the dimension comes across)
  assert.deepEqual(idsOf(r).sort(), ["dim:ang", "dim:dia", "dim:dist", "dim:dist", "horizontal", "midpoint", "parallel"]);
  const map = new Map(ids.map((id, i) => [id, r.ents[i].id]));
  assert.equal(r.ents.length, 5);
  const par = r.cons.find((c) => c.t === "parallel");
  assert.deepEqual([par.e1, par.e2], [map.get("e0"), map.get("e2")]);
  const mid = r.cons.find((c) => c.t === "midpoint");
  assert.equal(mid.e, map.get("e0"));
  assert.notEqual(mid.p, "m");
  const d2 = r.cons.find((c) => c.v === 10);
  assert.equal(d2.expr, "h", "the expression is kept");
  const d1 = r.cons.find((c) => c.v === 20);
  assert.equal(d1.name, undefined, "a parameter name belongs to one dimension");
  assert.deepEqual(d1.off, [-20, -3]);
  assert.ok(r.cons.every((c) => c.id !== "k1" && c.id && !sk.cons.some((o) => o.id === c.id)), "new ids");
  // across an angled line: the horizontal constraint and the vertical-direction dimension would not hold
  r = mirrorEnts(sk, ids, tilt);
  assert.deepEqual(idsOf(r).sort(), ["dim:ang", "dim:dia", "dim:dist", "midpoint", "parallel"]);
  assert.equal(r.cons.find((c) => c.k === "dist").o, "a");
  // a point flip keeps horizontal and vertical
  r = mirrorEnts(sk, ids, O);
  assert.equal(idsOf(r).length, 7);
});

test("shapes that already lie on the line, or already have a mirror twin, are not doubled", () => {
  const sk = { pts: [{ id: "a", x: 0, y: -5 }, { id: "b", x: 0, y: 5 }, { id: "c", x: 0, y: 0 }, { id: "l", x: -10, y: 0 }, { id: "r", x: 10, y: 0 }],
    ents: [{ id: "on", t: "line", a: "a", b: "b" }, { id: "circ", t: "circle", c: "c", r: 3 }, { id: "L", t: "line", a: "l", b: "c" }, { id: "R", t: "line", a: "c", b: "r" }] };
  const r = mirrorEnts(sk, ["on", "circ"], Y);
  assert.equal(r.ents.length, 0);
  assert.equal(r.skipped.same, 2);
  // L and R are each other's mirror image: nothing new
  assert.equal(mirrorEnts(sk, ["L", "R"], Y).ents.length, 0);
  assert.equal(mirrorEnts(sk, ["R"], Y).ents.length, 0);
});

test("the input sketch is not changed", () => {
  const sk = { pts: [{ id: "a", x: 1, y: 2 }, { id: "b", x: 3, y: 4 }], ents: [{ id: "e", t: "line", a: "a", b: "b" }], cons: [] };
  const before = JSON.stringify(sk);
  mirrorEnts(sk, ["e"], tilt);
  assert.equal(JSON.stringify(sk), before);
});

test("a half drawn over a construction outline is still mirrored; a real copy already there is reported as a twin", () => {
  const sk = { pts: [{ id: "a", x: 10, y: 0 }, { id: "b", x: 10, y: 10 }, { id: "c", x: -10, y: 0 }, { id: "d", x: -10, y: 10 }],
    ents: [{ id: "drawn", t: "line", a: "a", b: "b" }, { id: "guide", t: "line", a: "c", b: "d", cons: true }] };
  const r = mirrorEnts(sk, ["drawn"], Y);
  assert.equal(r.ents.length, 1, "the construction line at the mirror spot is no twin of a drawn line");
  assert.equal(r.ents[0].cons, undefined);
  assert.equal(r.skipped.twin, 0);
  // a drawn line already there is a twin, and the mirror says so
  const sk2 = { ...sk, ents: [sk.ents[0], { id: "real", t: "line", a: "c", b: "d" }] };
  const r2 = mirrorEnts(sk2, ["drawn"], Y);
  assert.equal(r2.ents.length, 0);
  assert.equal(r2.skipped.twin, 1);
  // and a construction line mirrors onto a construction line, not onto a drawn one
  const r3 = mirrorEnts({ ...sk, ents: [{ ...sk.ents[0], cons: true }, { id: "real", t: "line", a: "c", b: "d" }] }, ["drawn"], Y);
  assert.equal(r3.ents.length, 1);
  assert.equal(r3.ents[0].cons, true);
});

test("a fully constrained rectangle on the axis is not over-constrained by its copy", () => {
  const sk = { pts: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 30, y: 0 }, { id: "p2", x: 30, y: 20 }, { id: "p3", x: 0, y: 20 }],
    ents: [0, 1, 2, 3].map((i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 4) })),
    cons: [{ id: "k0", t: "origin", p: "p0" }, { id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "horizontal", e1: "e2" }, { id: "k3", t: "vertical", e1: "e1" }, { id: "k4", t: "vertical", e1: "e3" },
      { id: "d1", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 30, off: [15, -4] }, { id: "d2", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20, off: [34, 10] }] };
  assert.equal(sketchDof(sk).over, 0);
  const r = mirrorEnts(sk, ["e0", "e1", "e2", "e3"], Y);
  const whole = { pts: [...sk.pts, ...r.pts], ents: [...sk.ents, ...r.ents], cons: [...sk.cons, ...r.cons] };
  assert.equal(sketchDof(whole).over, 0, "no copy that only repeats another");
  assert.equal(sketchDof(whole).dof, 0);
  assert.ok(r.cons.length >= 3, "the dimensions still come across");
});

test("a set that already holds a mirror pair adds no reversed duplicate constraint", () => {
  const sk = { pts: [{ id: "a", x: 10, y: 0 }, { id: "b", x: 10, y: 10 }, { id: "c", x: -10, y: 0 }, { id: "d", x: -10, y: 10 }],
    ents: [{ id: "L", t: "line", a: "a", b: "b" }, { id: "R", t: "line", a: "c", b: "d" }],
    cons: [{ id: "k", t: "equal", e1: "R", e2: "L" }] };
  const r = mirrorEnts(sk, ["L", "R"], Y); // each is the other's image
  assert.equal(r.ents.length, 0);
  assert.equal(r.cons.length, 0);
  const r2 = mirrorEnts({ ...sk, cons: [{ id: "k", t: "equal", e1: "R", e2: "L" }] }, ["L", "R"], Y);
  assert.equal(r2.cons.length, 0, "equal(L, R) is the same as equal(R, L)");
});

test("angle, point-to-line and line-to-line dimensions come across with the copies' ids", () => {
  const sk = { pts: [{ id: "a", x: 10, y: 0 }, { id: "b", x: 30, y: 0 }, { id: "c", x: 10, y: 10 }, { id: "d", x: 30, y: 10 }, { id: "q", x: 20, y: 25 }, { id: "o", x: 12, y: 40 }],
    ents: [{ id: "l1", t: "line", a: "a", b: "b" }, { id: "l2", t: "line", a: "c", b: "d" }, { id: "l3", t: "line", a: "a", b: "c" }, { id: "pt", t: "point", p: "q" }],
    cons: [{ id: "g1", t: "dim", k: "ll", e1: "l1", e2: "l2", v: 10, off: [5, 5] }, { id: "g2", t: "dim", k: "pl", p: "q", e: "l1", v: 25, off: [20, 12] }, { id: "g3", t: "dim", k: "ang", e1: "l1", e2: "l3", v: 90, s1: 1, s2: 1, off: [14, 4] }] };
  const r = mirrorEnts(sk, ["l1", "l2", "l3", "pt"], tilt);
  const map = new Map(["l1", "l2", "l3", "pt"].map((id, i) => [id, r.ents[i].id]));
  const by = (k) => r.cons.find((c) => c.k === k);
  assert.deepEqual([by("ll").e1, by("ll").e2], [map.get("l1"), map.get("l2")]);
  assert.equal(by("pl").e, map.get("l1"));
  assert.equal(by("pl").p, r.ents[3].p);
  assert.deepEqual([by("ang").e1, by("ang").e2], [map.get("l1"), map.get("l3")]);
  assert.equal(by("ang").v, 90);
  assert.deepEqual(by("pl").off.map((v) => +v.toFixed(9)), reflect([20, 12], tilt).map((v) => +v.toFixed(9)));
});

const withCopies = (sk, r) => structuredClone({ pts: [...sk.pts, ...r.pts], ents: [...sk.ents, ...r.ents], cons: [...(sk.cons || []), ...r.cons] });

test("the copied constraints hold every copy point: moving any one of them and solving puts it back", () => {
  const sk = { pts: [{ id: "p0", x: 0, y: 0 }, { id: "p1", x: 30, y: 0 }, { id: "p2", x: 30, y: 20 }, { id: "p3", x: 0, y: 20 }],
    ents: [0, 1, 2, 3].map((i) => ({ id: "e" + i, t: "line", a: "p" + i, b: "p" + ((i + 1) % 4) })),
    cons: [{ id: "k0", t: "origin", p: "p0" }, { id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "horizontal", e1: "e2" }, { id: "k3", t: "vertical", e1: "e1" }, { id: "k4", t: "vertical", e1: "e3" },
      { id: "d1", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 30, off: [15, -4] }, { id: "d2", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20, off: [34, 10] }] };
  const r = mirrorEnts(sk, ["e0", "e1", "e2", "e3"], Y);
  assert.equal(r.cons.length, 4, "four equations hold the copy's two corners");
  for (const moved of r.pts) for (const [dx, dy] of [[5, 0], [0, 5], [-5, -5]]) {
    const w = withCopies(sk, r);
    const m = w.pts.find((p) => p.id === moved.id);
    m.x += dx; m.y += dy;
    solveSketch(w);
    for (const q of r.pts) {
      const p = w.pts.find((x) => x.id === q.id);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, "moved " + moved.id + " by " + dx + "," + dy + ": " + q.id + " is at " + p.x + "," + p.y);
    }
  }
});

test("a point flip does not copy an angle dimension to a line that maps onto itself backwards", () => {
  const sk = { pts: [{ id: "a", x: -20, y: -20 }, { id: "b", x: 20, y: 20 }, { id: "c", x: 10, y: 0 }, { id: "d", x: 30, y: 0 }],
    ents: [{ id: "l1", t: "line", a: "a", b: "b" }, { id: "l2", t: "line", a: "c", b: "d" }],
    cons: [{ id: "g", t: "dim", k: "ang", e1: "l1", e2: "l2", v: 45, s1: 1, s2: 1, off: [15, 8] }] };
  const r = mirrorEnts(sk, ["l1", "l2"], O);
  assert.equal(r.ents.length, 1);
  assert.equal(r.cons.length, 0, "l1 is its own image but runs backwards: the angle would flip");
  const w = withCopies(sk, r), before = structuredClone(w.pts);
  solveSketch(w);
  assert.deepEqual(w.pts, before);
});
