import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/inspectgeo.js";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const closeAll = (a, b, e = 1e-9) => a.forEach((x, i) => close(x, b[i], e));

// outward triangles, base at z = 0, centred in x and y
function box(w, d, h) {
  const P = new Float32Array([-w/2,-d/2,0, w/2,-d/2,0, w/2,d/2,0, -w/2,d/2,0, -w/2,-d/2,h, w/2,-d/2,h, w/2,d/2,h, -w/2,d/2,h]);
  const T = new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  return { P, T, m: I, t0: 0, t1: 12 };
}
const tube = () => { // 10 x 10 x 10 outside, a 6 x 6 x 10 hole with reversed winding
  const o = box(10, 10, 10), n = box(6, 6, 10), T = [...o.T];
  for (let i = 0; i < n.T.length; i += 3) T.push(n.T[i] + 8, n.T[i + 2] + 8, n.T[i + 1] + 8);
  return { P: new Float32Array([...o.P, ...n.P]), T: new Uint32Array(T) };
};
const scaled = [2,0,0,0, 0,2,0,0, 0,0,2,0, 5,0,0,1];
const moved = (m, z) => { const c = [...m]; c[14] = z; return c; };
const body = (name, b, m = I, extra = {}) => ({ id: name.toLowerCase(), name, positions: b.P, indices: b.T, m, ...extra });
const generic = { w: 256, d: 256, h: null, label: "generic 256 x 256 mm" };

test("area, volume, determinant and box in world space", () => {
  const { P, T } = box(20, 10, 5);
  assert.equal(G.meshArea(P, T, I), 700);
  close(G.meshVolume(P, T, I), 1000);
  assert.equal(G.meshArea(P, T, scaled), 2800);
  close(G.meshVolume(P, T, scaled), 8000);
  assert.equal(G.det3(scaled), 8);
  assert.deepEqual(G.worldBox(P, scaled), { min: [-15, -10, 0], max: [25, 10, 10] });
});

test("closest point on a triangle: inside, edge, corner", () => {
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0];
  closeAll(G.closestOnTriangle([.2, .2, 1], a, b, c), [.2, .2, 0], 1e-12);
  assert.deepEqual(G.closestOnTriangle([.5, -1, 0], a, b, c), [.5, 0, 0]);
  assert.deepEqual(G.closestOnTriangle([-1, -1, 0], a, b, c), [0, 0, 0]);
});

test("closest point on a mesh and face lookups", () => {
  const { P, T } = box(20, 10, 5), q = G.closestOnMesh([20, 0, 2.5], P, T, I);
  assert.equal(q.distance, 10);
  assert.deepEqual(q.point, [10, 0, 2.5]);
  const groups = [[0, 6], [6, 6]];
  assert.equal(G.faceOfTriangle(groups, 1), 0);
  assert.equal(G.faceOfTriangle(groups, 2), 1);
  assert.deepEqual(G.faceRange(groups, 1), [2, 4]);
});

test("mesh gap between two boxes, and its size limit", () => {
  const a = box(2, 2, 2), b = box(2, 2, 2);
  b.m = [...I]; b.m[12] = 3;
  const g = G.meshGap(a, b);
  assert.equal(g.distance, 1);
  assert.equal(g.from[0], 1);
  assert.equal(g.to[0], 2);
  assert.throws(() => G.meshGap(a, b, 1), (e) => e.message === "these two are too finely meshed to measure here (192 vertex-triangle pairs, at most 40000000); measure between two points or two whole bodies instead");
});

test("plane bases", () => {
  assert.deepEqual(G.planeBasis({ axis: "z", at: 5 }), { origin: [0, 0, 5], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] });
  assert.deepEqual(G.planeBasis({ axis: "y", at: 2 }), { origin: [0, 2, 0], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] });
  assert.deepEqual(G.planeBasis({ axis: "x", at: -1 }), { origin: [-1, 0, 0], normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] });
  assert.deepEqual(G.planeBasis({ origin: [0, 0, 3], normal: [0, 0, 4] }).u, [1, 0, 0]);
  const { normal: n, u, v } = G.planeBasis({ origin: [0, 0, 0], normal: [1, 1, 0] });
  close(Math.hypot(...u), 1); close(Math.hypot(...v), 1);
  close(u[0] * v[0] + u[1] * v[1] + u[2] * v[2], 0);
  closeAll([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], n);
  assert.throws(() => G.planeBasis({ origin: [0, 0, 0], normal: [0, 0, 0] }), { message: "normal must not be [0, 0, 0]" });
  assert.throws(() => G.planeBasis({ axis: "z" }), { message: "at must be a number (mm along z)" });
  const both = 'give axis ("x", "y" or "z") and at, or origin [x, y, z] and normal [x, y, z]';
  assert.throws(() => G.planeBasis({}), { message: both });
  assert.throws(() => G.planeBasis({ axis: "q", at: 1 }), { message: both });
  assert.throws(() => G.planeBasis({ axis: "z", at: 1, origin: [0, 0, 0] }), { message: both });
});

test("section of a tube: outer loop, hole loop, net area", () => {
  const { P, T } = tube(), p = G.planeBasis({ axis: "z", at: 5 }), cut = G.sectionBody(P, T, I, p.origin, p.normal, p.u, p.v);
  assert.equal(cut.loops.length, 2);
  assert.ok(cut.loops.every((l) => l.closed));
  const outer = cut.loops.find((l) => Math.abs(l.area - 100) < 1e-9), inner = cut.loops.find((l) => Math.abs(l.area - 36) < 1e-9);
  assert.equal(outer.hole, false);
  assert.equal(inner.hole, true);
  close(outer.perimeter, 40); close(inner.perimeter, 24);
  close(cut.area, 64);
});

test("section of a box through its middle and touching the plate", () => {
  const { P, T } = box(10, 10, 10), p = G.planeBasis({ axis: "x", at: 0 }), cut = G.sectionBody(P, T, I, p.origin, p.normal, p.u, p.v);
  assert.equal(cut.loops.length, 1);
  close(cut.loops[0].area, 100);
  assert.equal(G.touchesPlane(P, I, [0, 0, 0], [0, 0, 1]), true);
  assert.equal(G.touchesPlane(P, I, [0, 0, 5], [0, 0, 1]), false);
});

test("Ready to print: a box on the plate", () => {
  const r = G.checkPrint({ bodies: [body("Box", box(20, 10, 5))], bed: generic, angle: 45 });
  assert.equal(r.ok, true);
  assert.equal(r.summary, "Ready to print: 1 part, no problems found.");
  assert.deepEqual(r.issues, []);
  assert.equal(r.bodies[0].overhangArea, 0);
  assert.equal(r.bodies[0].contactArea, 200);
  assert.equal(r.bodies[0].fits, true);
  assert.equal(G.checkPrint({ bodies: [body("A", box(2, 2, 2)), body("B", box(2, 2, 2))], bed: generic, angle: 45 }).summary, "Ready to print: 2 parts, no problems found.");
});

test("Ready to print: floating, below the plate", () => {
  let r = G.checkPrint({ bodies: [body("Box", box(20, 10, 5), moved(I, 5))], bed: generic, angle: 45 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((x) => x.code), ["floating", "overhang"]);
  assert.equal(r.issues[0].text, "Box floats 5 mm above the plate. Move it down so its lowest point is at z = 0.");
  assert.equal(r.issues[0].level, "error");
  assert.equal(r.issues[1].level, "warn");
  assert.equal(r.summary, "Not ready to print: 1 problem, 1 warning.");
  r = G.checkPrint({ bodies: [body("Box", box(20, 10, 5), moved(I, -2))], bed: generic, angle: 45 });
  assert.equal(r.issues[0].code, "below_plate");
  assert.equal(r.issues[0].text, "Box goes 2 mm below the plate. Move it up so its lowest point is at z = 0.");
});

test("Ready to print: outside the bed, too tall", () => {
  const mini = { w: 180, d: 180, h: 180, label: "Original Prusa MINI+" };
  let r = G.checkPrint({ bodies: [body("Box", box(200, 20, 10))], bed: mini, angle: 45 });
  assert.deepEqual(r.issues.map((x) => x.code), ["outside_bed"]);
  assert.equal(r.issues[0].text, "Box reaches outside the Original Prusa MINI+ plate (X). Move it toward the middle, turn it or make it smaller.");
  assert.equal(r.bodies[0].fits, false);
  r = G.checkPrint({ bodies: [body("Box", box(200, 200, 10))], bed: mini, angle: 45 });
  assert.match(r.issues[0].text, /plate \(X, Y\)\./);
  const a1 = { w: 256, d: 256, h: 256, label: "Bambu Lab A1" };
  r = G.checkPrint({ bodies: [body("Box", box(10, 10, 300))], bed: a1, angle: 45 });
  assert.deepEqual(r.issues.map((x) => x.code), ["too_tall"]);
  assert.equal(r.issues[0].text, "Box is 300 mm tall; the Bambu Lab A1 prints at most 256 mm.");
  assert.equal(G.checkPrint({ bodies: [body("Box", box(900, 900, 900))], bed: null, angle: 45 }).bodies[0].fits, null);
});

test("Ready to print: a pointed part touches the plate with little", () => {
  const P = new Float32Array([-10,-10,4, 10,-10,4, 10,10,4, -10,10,4, 0,0,0]); // a flat pyramid, apex down on the plate
  const T = new Uint32Array([0,1,2, 0,2,3, 0,4,1, 1,4,2, 2,4,3, 3,4,0]); // the sloping underside leans out about 70 degrees from upright
  const r = G.checkPrint({ bodies: [body("Cone", { P, T })], bed: generic, angle: 45 });
  assert.deepEqual(r.issues.map((x) => x.code).sort(), ["overhang", "small_contact"]);
  assert.equal(r.issues.find((x) => x.code === "small_contact").text.slice(0, 40), "Cone touches the plate with only 0 mm² (");
  assert.equal(r.summary, "Ready to print, with 2 warnings.");
});

test("Ready to print: nothing to print, and a body that did not build", () => {
  let r = G.checkPrint({ bodies: [], bed: generic, angle: 45 });
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "empty");
  assert.equal(r.issues[0].id, null);
  assert.equal(r.issues[0].text, "Nothing to print: the design has no shown solid bodies.");
  r = G.checkPrint({ bodies: [body("Box", box(2, 2, 2), I, { error: "broken" })], bed: generic, angle: 45 });
  assert.equal(r.issues[0].code, "build_error");
  assert.equal(r.issues[0].text, "Box did not build: broken");
  assert.equal(r.summary, "Not ready to print: 1 problem, 0 warnings.");
});

test("mesh gap: faces whose closest points lie on edge interiors", () => {
  const A = box(10, 2, 1), Bm = box(1, 10, 2), B = { ...Bm, m: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,0,2,1] };
  // A's top face (z = 1) against B's x = 0 face: perpendicular planes, 1 mm apart (B's underside is at z = 2)
  const top = { ...A, t0: 4, t1: 6 }, side = { ...B, t0: 10, t1: 12 };
  close(G.meshGap(top, side).distance, 1, 1e-6);
  close(G.closestSegments([0,0,0], [10,0,0], [5,3,4], [5,3,-4]).distance, 3);
  close(G.closestSegments([0,0,0], [1,0,0], [3,0,0], [4,0,0]).distance, 2);
});

test("Ready to print: a mirrored body still rests flat", () => {
  const flipX = [-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const r = G.checkPrint({ bodies: [body("Box", box(20, 10, 5), flipX)], bed: generic, angle: 45 });
  assert.equal(r.bodies[0].contactArea, 200);
  assert.deepEqual(r.issues, []);
});

test("Ready to print: a wire-only body is a plain error", () => {
  const r = G.checkPrint({ bodies: [body("Ring", { P: [], T: [] }, I, { wire: true })], bed: generic, angle: 45 });
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "wire_only");
  assert.match(r.issues[0].text, /^Ring is a wire-only shape/);
});

test("section: a cut with too many segments or outlines is refused", () => {
  const p = G.planeBasis({ axis: "z", at: 0.5 });
  const n = 2002;
  const quads = [];
  for (let i = 0; i < n; i++) quads.push(i * 3, i * 3 + 1, i * 3 + 2);
  const Pbig = new Float32Array(n * 9), Tbig = new Uint32Array(quads);
  for (let i = 0; i < n; i++) Pbig.set([i * 5, 0, 0, i * 5 + 1, 0, 0, i * 5, 1, 1], i * 9);
  assert.throws(() => G.sectionBody(Pbig, Tbig, I, p.origin, p.normal, p.u, p.v), /more than 200000 line segments|more than 2000 separate outlines/);
});

test("section: pieces that meet end to end become one loop", () => {
  const { P, T } = box(10, 10, 10), p = G.planeBasis({ axis: "z", at: 5 }), cut = G.sectionBody(P, T, I, p.origin, p.normal, p.u, p.v);
  assert.equal(cut.loops.length, 1);
  close(cut.loops[0].perimeter, 40);
  closeAll(cut.loops[0].min, [-5, -5]); closeAll(cut.loops[0].max, [5, 5]);
});
