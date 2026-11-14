// findHoles (measure.mjs) on faces and edges shaped like JS3D.faces / JS3D.edges output (no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findHoles } from "./measure.mjs";

const plane = (index, center, normal, edgeCount) => ({ index, type: "plane", center, normal, area: 100, edgeCount });
const cylinder = (index, center, radius, axis, length, share = 1) => ({ index, type: "cylinder", center, radius, axis, hole: true, area: share * 2 * Math.PI * radius * length, edgeCount: 2 });
// a whole circle round the z axis line through (x, y), at height z: start = end, mid opposite
const ring = (index, [x, y], z, r, faces) => ({ index, type: "circle", start: [x - r, y, z], mid: [x + r, y, z], end: [x - r, y, z], center: [x, y, z], radius: r, faces });
// half a circle from angle a0 to a0 + 180 degrees round (x, y) at height z (centre given wrong on purpose: arcs are worked out)
const half = (index, [x, y], z, r, a0, faces, sweep = 180) => {
  const at = (deg) => [x + r * Math.cos(deg * Math.PI / 180), y + r * Math.sin(deg * Math.PI / 180), z];
  return { index, type: "circle", start: at(a0), mid: at(a0 + sweep / 2), end: at(a0 + sweep), center: [x + 1, y + 1, z], radius: r, faces };
};
const round = (v) => typeof v === "number" ? Math.round(v * 1e6) / 1e6 + 0 : Array.isArray(v) ? v.map(round) : v === null || typeof v !== "object" ? v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));

test("a counterbored through hole is one hole with two bores; a flat-bottomed hole is blind", () => {
  const faces = [
    plane(3, [20, 15, 0], [0, 0, -1], 5), plane(4, [20, 15, 12], [0, 0, 1], 7),
    cylinder(6, [10, 10, 3.5], 2.75, [0, 0, -1], 7), cylinder(7, [10, 10, 9.5], 5, [0, 0, -1], 5),
    cylinder(8, [30, 20, 8], 3, [0, 0, -1], 8), plane(9, [10, 10, 7], [0, 0, 1], 2), plane(10, [30, 20, 4], [0, 0, 1], 1),
  ];
  const edges = [
    ring(11, [10, 10], 0, 2.75, [3, 6]), ring(13, [10, 10], 12, 5, [4, 7]), ring(14, [30, 20], 12, 3, [4, 8]),
    ring(15, [10, 10], 7, 2.75, [6, 9]), ring(18, [10, 10], 7, 5, [7, 9]), ring(20, [30, 20], 4, 3, [8, 10]),
    { index: 1, type: "line", start: [0, 0, 0], end: [40, 0, 0], mid: [20, 0, 0], center: [20, 0, 0], faces: [3, 4] },
  ];
  const holes = round(findHoles(faces, edges)).sort((a, b) => a.point[0] - b.point[0]);
  assert.deepEqual(holes, [
    { axis: [0, 0, 1], point: [10, 10, 0], from: 0, to: 12, dia: 5.5, through: true, segments: [{ dia: 5.5, from: 0, to: 7 }, { dia: 10, from: 7, to: 12 }] },
    { axis: [0, 0, 1], point: [30, 20, 12], from: 4, to: 12, dia: 6, through: false, segments: [{ dia: 6, from: 4, to: 12 }] },
  ]);
});

test("a hole in two half faces counts once, with its axis from the arcs' true centre", () => {
  const faces = [plane(0, [0, 0, 0], [0, 0, -1], 6), plane(1, [0, 0, 5], [0, 0, 1], 6),
    cylinder(2, [20, 10.9, 2.5], 2, [1e-12, 0, 1], 5, 0.5), cylinder(3, [20, 9.1, 2.5], 2, [0, 0, -1], 5, 0.5)];
  const edges = [half(4, [20, 10], 0, 2, 0, [0, 2]), half(5, [20, 10], 5, 2, 0, [1, 2]), half(6, [20, 10], 0, 2, 180, [0, 3]), half(7, [20, 10], 5, 2, 180, [1, 3])];
  const holes = round(findHoles(faces, edges));
  assert.equal(holes.length, 1);
  assert.deepEqual(holes[0], { axis: [0, 0, 1], point: [20, 10, 0], from: 0, to: 5, dia: 4, through: true, segments: [{ dia: 4, from: 0, to: 5 }] });
});

test("a slot's round ends and an inner fillet are not holes", () => {
  const faces = [plane(0, [0, 0, 0], [0, 0, -1], 6), plane(1, [0, 0, 5], [0, 0, 1], 6),
    cylinder(2, [10, 0, 2.5], 3, [0, 0, 1], 5, 0.5), cylinder(3, [30, 0, 2.5], 3, [0, 0, 1], 5, 0.5),
    { index: 4, type: "cylinder", center: [0, 40, 2], radius: 2, axis: [1, 0, 0], hole: true, area: 0.25 * 2 * Math.PI * 2 * 60, edgeCount: 4 }];
  const edges = [half(5, [10, 0], 0, 3, 90, [0, 2]), half(6, [10, 0], 5, 3, 90, [1, 2]), half(7, [30, 0], 0, 3, 270, [0, 3]), half(8, [30, 0], 5, 3, 270, [1, 3]),
    // the fillet runs along x from 0 to 60: a quarter arc in the y-z plane at each end
    ...[0, 60].map((x, i) => { const at = (deg) => [x, 40 + 2 * Math.cos(deg * Math.PI / 180), 2 + 2 * Math.sin(deg * Math.PI / 180)];
      return { index: 9 + i, type: "circle", start: at(180), mid: at(225), end: at(270), center: [x, 39, 1], radius: 2, faces: [4] }; })];
  assert.deepEqual(findHoles(faces, edges), []);
});

test("an outer cylinder is not a hole, and a hole whose end edges are missing has unknown depth", () => {
  const faces = [{ index: 0, type: "cylinder", center: [0, 0, 5], radius: 10, axis: [0, 0, 1], hole: false, area: 2 * Math.PI * 10 * 10, edgeCount: 2 },
    cylinder(1, [0, 0, 5], 3, [0, 0, 1], 10)];
  const holes = round(findHoles(faces, []));
  assert.deepEqual(holes, [{ axis: [0, 0, 1], point: [0, 0, 5], from: 5, to: 5, dia: 6, through: null, segments: [{ dia: 6, from: 5, to: 5 }] }]);
});
