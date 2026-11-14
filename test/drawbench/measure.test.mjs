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
    { axis: [0, 0, 1], point: [10, 10, 0], from: 0, to: 12, dia: 5.5, through: true, open: null, segments: [{ dia: 5.5, from: 0, to: 7 }, { dia: 10, from: 7, to: 12 }] },
    { axis: [0, 0, 1], point: [30, 20, 4], from: 4, to: 12, dia: 6, through: false, open: [0, 0, 1], segments: [{ dia: 6, from: 4, to: 12 }] },
  ]);
});

test("a hole in two half faces counts once, with its axis from the arcs' true centre", () => {
  const faces = [plane(0, [0, 0, 0], [0, 0, -1], 6), plane(1, [0, 0, 5], [0, 0, 1], 6),
    cylinder(2, [20, 10.9, 2.5], 2, [1e-12, 0, 1], 5, 0.5), cylinder(3, [20, 9.1, 2.5], 2, [0, 0, -1], 5, 0.5)];
  const edges = [half(4, [20, 10], 0, 2, 0, [0, 2]), half(5, [20, 10], 5, 2, 0, [1, 2]), half(6, [20, 10], 0, 2, 180, [0, 3]), half(7, [20, 10], 5, 2, 180, [1, 3])];
  const holes = round(findHoles(faces, edges));
  assert.equal(holes.length, 1);
  assert.deepEqual(holes[0], { axis: [0, 0, 1], point: [20, 10, 0], from: 0, to: 5, dia: 4, through: true, open: null, segments: [{ dia: 4, from: 0, to: 5 }] });
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

test("an outer cylinder is not a hole, and a hole with no end edges has unknown depth and a length from its area", () => {
  const faces = [{ index: 0, type: "cylinder", center: [0, 0, 5], radius: 10, axis: [0, 0, 1], hole: false, area: 2 * Math.PI * 10 * 10, edgeCount: 2 },
    cylinder(1, [0, 0, 5], 3, [0, 0, 1], 10)];
  const holes = round(findHoles(faces, []));
  assert.deepEqual(holes, [{ axis: [0, 0, 1], point: [0, 0, 0], from: 0, to: 10, dia: 6, through: null, open: null, segments: [{ dia: 6, from: 0, to: 10 }] }]);
});

// a plate 20 mm thick with one z hole of radius r at (x, y): plain face and edge lists, built from pieces [from, to]
function stack(pieces, { r = 3, x = 0, y = 0, low = "open", high = "open", circlesAt = null } = {}) {
  const faces = [plane(0, [x + 20, y, 0], [0, 0, -1], 5), plane(1, [x + 20, y, 20], [0, 0, 1], 5)], edges = [];
  let index = 10;
  for (const [i, [from, to, radius = r]] of pieces.entries()) {
    const f = 100 + i;
    faces.push(cylinder(f, [x, y, (from + to) / 2], radius, [0, 0, i % 2 ? -1 : 1], to - from));
    for (const z of circlesAt ? circlesAt(from, to) : [from, to]) edges.push(ring(index++, [x, y], z, radius, [f, z === 0 ? 0 : z === 20 ? 1 : 50 + index]));
  }
  if (low === "floor") { faces[0] = plane(0, [x, y, 0], [0, 0, 1], 1); }
  if (high === "floor") { faces[1] = plane(1, [x, y, 20], [0, 0, -1], 3); } // a floor with a post on it: three edges, outside facing into the hole
  return { faces, edges };
}

test("a cavity closed at both ends is not a hole; a floor with a post on it still closes a hole", () => {
  const sealed = stack([[0, 20]], { low: "floor", high: "floor" });
  assert.deepEqual(findHoles(sealed.faces, sealed.edges), []);
  const blocked = stack([[0, 20]], { high: "floor" });
  assert.deepEqual(round(findHoles(blocked.faces, blocked.edges)).map(({ through, open }) => ({ through, open })), [{ through: false, open: [0, 0, -1] }]);
});

test("pieces of one bore join into one hole whatever their order, also with no edge where they meet", () => {
  for (const order of [[[0, 6], [12, 20], [6, 12]], [[12, 20], [0, 6], [6, 12]], [[6, 12], [0, 6], [12, 20]]]) {
    const { faces, edges } = stack(order);
    assert.deepEqual(round(findHoles(faces, edges)), [{ axis: [0, 0, 1], point: [0, 0, 0], from: 0, to: 20, dia: 6, through: true, open: null, segments: [{ dia: 6, from: 0, to: 20 }] }], JSON.stringify(order));
  }
  // a smooth join: each piece has only its outer end circle, the other end comes from the face's centre
  const { faces, edges } = stack([[0, 12], [12, 20]], { circlesAt: (from, to) => [from === 0 ? 0 : to] });
  assert.deepEqual(round(findHoles(faces, edges)).map(({ from, to, through }) => ({ from, to, through })), [{ from: 0, to: 20, through: true }]);
});

test("counterbores at both ends make one through hole with three bores", () => {
  const { faces, edges } = stack([[0, 5, 5.5], [5, 15, 3.3], [15, 20, 5.5]]);
  const holes = round(findHoles(faces, edges));
  assert.equal(holes.length, 1);
  assert.deepEqual(holes[0].segments, [{ dia: 11, from: 0, to: 5 }, { dia: 6.6, from: 5, to: 15 }, { dia: 11, from: 15, to: 20 }]);
  assert.equal(holes[0].dia, 6.6);
});

test("a blind hole in two half faces is blind: its floor has two arc edges but faces into the hole", () => {
  const faces = [plane(0, [0, 0, 0], [0, 0, -1], 4), plane(1, [0, 0, 10], [0, 0, 1], 6), plane(2, [20, 10, 4], [0, 0, 1], 2),
    cylinder(3, [20, 10.9, 7], 2, [0, 0, 1], 6, 0.5), cylinder(4, [20, 9.1, 7], 2, [0, 0, 1], 6, 0.5)];
  const edges = [half(5, [20, 10], 4, 2, 0, [2, 3]), half(6, [20, 10], 10, 2, 0, [1, 3]), half(7, [20, 10], 4, 2, 180, [2, 4]), half(8, [20, 10], 10, 2, 180, [1, 4])];
  assert.deepEqual(round(findHoles(faces, edges)).map(({ from, to, through, open }) => ({ from, to, through, open })), [{ from: 4, to: 10, through: false, open: [0, 0, 1] }]);
});

test("a chamfer at each mouth leaves a through hole; a drill point closes a blind one", () => {
  const cone = (index, z, edgeCount) => ({ index, type: "cone", center: [0, 0, z], area: 5, edgeCount });
  const chamfered = { faces: [plane(0, [20, 0, 0], [0, 0, -1], 5), plane(1, [20, 0, 20], [0, 0, 1], 5), cylinder(2, [0, 0, 10], 1, [0, 0, 1], 19.6), cone(3, 0.1, 2), cone(4, 19.9, 2)],
    edges: [ring(5, [0, 0], 0.2, 1, [2, 3]), ring(6, [0, 0], 19.8, 1, [2, 4]), ring(7, [0, 0], 0, 1.2, [0, 3]), ring(8, [0, 0], 20, 1.2, [1, 4])] };
  assert.deepEqual(round(findHoles(chamfered.faces, chamfered.edges)).map(({ from, to, through }) => ({ from, to, through })), [{ from: 0.2, to: 19.8, through: true }]);
  const drilled = { faces: [plane(1, [20, 0, 20], [0, 0, 1], 5), cylinder(2, [0, 0, 15], 3, [0, 0, 1], 10), cone(3, 9, 1)],
    edges: [ring(5, [0, 0], 10, 3, [2, 3]), ring(6, [0, 0], 20, 3, [1, 2])] };
  assert.deepEqual(round(findHoles(drilled.faces, drilled.edges)).map(({ through, open }) => ({ through, open })), [{ through: false, open: [0, 0, 1] }]);
});

test("a long bore in three faces with smooth joins is one hole, though the middle face's area is the mesh's (a little low)", () => {
  const faces = [plane(0, [20, 0, 0], [0, 0, -1], 5), plane(1, [20, 0, 100], [0, 0, 1], 5),
    cylinder(2, [0, 0, 10], 6, [0, 0, 1], 20), cylinder(3, [0, 0, 50], 6, [0, 0, -1], 60, 0.9995), cylinder(4, [0, 0, 90], 6, [0, 0, 1], 20)];
  const edges = [ring(5, [0, 0], 0, 6, [0, 2]), ring(6, [0, 0], 100, 6, [1, 4])];
  for (const order of [faces, [...faces].reverse()]) {
    assert.deepEqual(round(findHoles(order, edges)).map(({ from, to, dia, through, segments }) => ({ from, to, dia, through, segments: segments.length })),
      [{ from: 0, to: 100, dia: 12, through: true, segments: 1 }]);
  }
});
