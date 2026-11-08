// Sketch shapes for the Advanced CAD calls (src/cadsketch.js): every shape is fully dimensioned, has the right area, and keeps to the
// keys the share-link schema accepts.
import test from "node:test";
import assert from "node:assert/strict";
import { buildShapes, defaultProfiles, pickProfiles } from "../src/cadsketch.js";
import { sketchDof, solveSketch } from "../src/constraints.js";
import { findRegions, resolveSketch } from "../src/regions.js";

const ENT_KEYS = { line: ["a", "b"], circle: ["c", "r"], arc: ["c", "a", "b"], point: ["p"] };
const CON_KEYS = new Set(["id", "t", "p", "p1", "p2", "e", "e1", "e2", "k", "o", "v", "off", "expr"]);
const sketchOf = (shapes, num) => { const b = buildShapes(shapes, num); return { pts: b.pts, ents: b.ents, cons: b.cons, built: b }; };
const regions = (sk) => findRegions(resolveSketch(sk));
const area = (sk) => regions(sk).filter((r) => r.area > 0).map((r) => r.area).sort((a, b) => b - a);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const PI = Math.PI;
const CASES = [
  ["rect", (c) => ({ type: "rect", center: c, size: [30, 20] }), () => 600],
  ["roundrect", (c) => ({ type: "roundrect", center: c, size: [30, 20], radius: 4 }), () => 600 - (4 - PI) * 16],
  ["circle", (c) => ({ type: "circle", center: c, diameter: 12 }), () => PI * 36],
  ["slot 0", (c) => ({ type: "slot", center: c, length: 24, width: 8 }), () => 24 * 8 - (4 - PI) * 16],
  ["slot 90", (c) => ({ type: "slot", center: c, length: 24, width: 8, angle: 90 }), () => 24 * 8 - (4 - PI) * 16],
  ...[3, 6, 12].map((n) => [`polygon ${n}`, (c) => ({ type: "polygon", center: c, sides: n, diameter: 20 }), () => (n / 2) * 100 * Math.sin((2 * PI) / n)]),
  ["polyline closed slanted", (c) => ({ type: "polyline", points: [[0, 0], [20, 0], [25, 12], [5, 15], [-3, 6]].map(([x, y]) => [x + c[0], y + c[1]]) }), null],
  ["polyline open", (c) => ({ type: "polyline", closed: false, points: [[0, 0], [10, 0], [10, 8], [4, 12]].map(([x, y]) => [x + c[0], y + c[1]]) }), null],
  ["line", (c) => ({ type: "line", from: [c[0], c[1]], to: [c[0] + 9, c[1] + 5], construction: true }), null],
];

for (const [name, make, want] of CASES) {
  for (const c of [[0, 0], [17, -9.5]]) {
    test(`${name} at [${c}] is fully constrained, solves in place, has the right area`, () => {
      const sk = sketchOf([make(c)]);
      const dof = sketchDof(sk);
      assert.equal(dof.dof, 0, `dof ${JSON.stringify(dof)}`);
      assert.equal(dof.redundant, 0, `redundant ${JSON.stringify(dof)}`);
      const before = sk.pts.map((p) => [p.x, p.y]);
      const r = solveSketch(sk);
      assert.ok(r === undefined || r.ok !== false, "solves");
      sk.pts.forEach((p, i) => { assert.ok(Math.hypot(p.x - before[i][0], p.y - before[i][1]) < 1e-9, "a point moved"); });
      if (want) near(area(sk)[0], want(), name === "rect" ? 1e-6 : want() * 0.003);
    });
  }
}

test("only keys the share-link schema accepts are written", () => {
  const sk = sketchOf(CASES.map(([, make]) => make([5, 7])));
  for (const e of sk.ents) assert.deepEqual(Object.keys(e).filter((k) => !["id", "t", "cons"].includes(k)).sort(), [...ENT_KEYS[e.t]].sort(), e.t);
  for (const c of sk.cons) for (const k of Object.keys(c)) assert.ok(CON_KEYS.has(k), k);
  assert.equal(sketchDof(sk).dof, 0);
  assert.equal(sketchDof(sk).redundant, 0);
});

test("a result lists each shape's drawn entities and centre", () => {
  const { built } = sketchOf([{ type: "rect", size: [4, 4] }, { type: "line", from: [0, 0], to: [3, 4] }]);
  assert.deepEqual(built.shapes.map((s) => [s.type, s.ents.length, s.center]), [["rect", 4, [0, 0]], ["line", 1, undefined]]);
  const sk = sketchOf([{ type: "rect", size: [4, 4] }, { type: "line", from: [0, 0], to: [3, 4] }]);
  assert.equal(sk.ents.find((e) => e.id === sk.built.shapes[1].ents[0]).t, "line");
});

test("expression sizes keep their text and take the value from num", () => {
  const num = (v, what) => (typeof v === "string" ? { v: v === "W" ? 60 : 8, expr: v } : { v });
  const { cons } = sketchOf([{ type: "rect", size: ["W", 40] }], num);
  const dims = cons.filter((c) => c.t === "dim");
  assert.deepEqual(dims.map((d) => [d.o, d.v, d.expr]), [["h", 60, "W"], ["v", 40, undefined]]);
  const slot = sketchOf([{ type: "slot", length: "W", width: 8 }], num).cons.filter((c) => c.t === "dim");
  assert.equal(slot.find((d) => d.k === "dist").expr, "(W)-(8)");
  assert.equal(slot.find((d) => d.k === "dist").v, 52);
});

test("default profiles: a ring for a rectangle with a circle in it, every separate shape, nested pairs", () => {
  const holey = sketchOf([{ type: "rect", size: [40, 30] }, { type: "circle", diameter: 10 }]);
  const picked = defaultProfiles(regions(holey));
  assert.equal(picked.length, 1);
  near(picked[0].area, 1200 - PI * 25, 0.5);
  assert.equal(defaultProfiles(regions(sketchOf([{ type: "rect", size: [10, 10] }, { type: "rect", center: [30, 0], size: [10, 10] }]))).length, 2);
  const nested = defaultProfiles(regions(sketchOf([{ type: "rect", size: [60, 60] }, { type: "circle", diameter: 30 }, { type: "circle", diameter: 10 }])));
  assert.equal(nested.length, 2);
  const sizes = nested.map((r) => r.area).sort((a, b) => a - b);
  near(sizes[0], PI * 25, 0.5);
  near(sizes[1], 3600 - PI * 225, 1);
});

test("pickProfiles finds the region at a point and says when there is none", () => {
  const sk = sketchOf([{ type: "rect", size: [40, 30] }, { type: "circle", diameter: 10 }]);
  const regs = regions(sk);
  assert.equal(pickProfiles(regs, [[15, 0], [16, 1]], "Sketch 1").length, 1);
  assert.equal(pickProfiles(regs, [[15, 0], [0, 0]], "Sketch 1").length, 2);
  assert.throws(() => pickProfiles(regs, [[100, 4]], "Sketch 1"), { message: "no closed profile at [100, 4] in Sketch 1" });
});

test("validation texts", () => {
  const bad = (shapes, message) => assert.throws(() => buildShapes(shapes), { message });
  bad([], "shapes must be a list of 1 to 200 shapes");
  bad("rect", "shapes must be a list of 1 to 200 shapes");
  bad(Array(201).fill({ type: "circle", diameter: 1 }), "shapes must be a list of 1 to 200 shapes");
  bad([{ type: "rect", size: [1, 1] }, { type: "rect", size: [1, 1] }, { type: "cube" }], "shapes[2].type must be one of rect, roundrect, circle, slot, polygon, polyline, line");
  bad([{ type: "rect", size: [0, 5] }], "shapes[0].size must be [w, h] in mm, each more than 0");
  bad([{ type: "rect", size: 5 }], "shapes[0].size must be [w, h] in mm, each more than 0");
  bad([{ type: "circle", diameter: -2 }], "shapes[0].diameter must be a number of mm more than 0, or an expression");
  bad([{ type: "circle" }, ], "shapes[0].diameter must be a number of mm more than 0, or an expression");
  bad([{ type: "circle", diameter: "x y" }], 'shapes[0].diameter "x y" does not give a usable number');
  bad([{ type: "roundrect", size: [30, 25], radius: 12.5 }], "shapes[0].radius must be more than 0 and less than half the smaller side (12.5 mm here)");
  bad([{ type: "slot", length: 5, width: 5 }], "shapes[0].length must be more than its width");
  bad([{ type: "slot", length: 9, width: 5, angle: 45 }], "shapes[0].angle must be 0 or 90 (for other angles use a polyline)");
  bad([{ type: "polygon", sides: 2, diameter: 5 }], "shapes[0].sides must be a whole number from 3 to 64");
  bad([{ type: "polygon", sides: 5.5, diameter: 5 }], "shapes[0].sides must be a whole number from 3 to 64");
  bad([{ type: "polyline", points: [[0, 0]] }], "shapes[0].points must be 2 to 200 [x, y] points in mm (3 or more when closed)");
  bad([{ type: "polyline", points: [[0, 0], [1, 1]] }], "shapes[0].points must be 2 to 200 [x, y] points in mm (3 or more when closed)");
  bad([{ type: "polyline", closed: false, points: [[0, 0], [1, 1], [1, 1]] }], "shapes[0] has a zero-length side at point 2");
  bad([{ type: "rect", size: [1, 1], corner: 2 }], 'shapes[0] has an unknown key "corner"; it takes center, size');
  bad([{ type: "rect", size: [1, 1], center: [1] }], "shapes[0].center must be [x, y] in mm (numbers; expressions are for sizes)");
  const pl = { type: "polyline", points: Array.from({ length: 200 }, (_, i) => [i, (i * 7) % 5 + (i % 2) * 3]) };
  bad(Array(200).fill(pl), "this sketch would have 40000 points; the most is 2000 per call — split it into several sketches");
  bad(Array(200).fill({ type: "roundrect", size: [10, 10], radius: 2 }), "this sketch would have 2600 points; the most is 2000 per call — split it into several sketches");
  bad([{ type: "polygon", sides: 65, diameter: 5 }], "shapes[0].sides must be a whole number from 3 to 64");
  assert.doesNotThrow(() => buildShapes(Array(100).fill({ type: "circle", diameter: 1 })));
});

test("sketch limits include the shared origin point and entity", () => {
  const polyline = (count) => ({ type: "polyline", points: Array.from({ length: count }, (_, i) => [i + 1, i % 2]) });
  const shapes = Array.from({ length: 10 }, () => polyline(200));
  assert.throws(() => buildShapes(shapes), /this sketch would have 2001 points/);
  shapes[9] = polyline(199);
  const built = buildShapes(shapes);
  assert.equal(built.pts.length, 2000);
  assert.equal(built.ents.length, 2000);
  const atOrigin = Array.from({ length: 10 }, () => ({ type: "polyline", points: Array.from({ length: 200 }, (_, i) => [i, i % 2]) }));
  const originBuilt = buildShapes(atOrigin);
  assert.equal(originBuilt.pts.length, 2000);
  assert.equal(originBuilt.ents.length, 2000);
});
