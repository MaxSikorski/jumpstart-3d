import test from "node:test";
import assert from "node:assert/strict";
import { faceKind, topLanding, sideLanding } from "../src/facesnap.js";

const apply = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const dir = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2]);
const near = (a, b, e = 0.011) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= e, `${a} vs ${b}`));
const box0 = { min: [-5, -5, 0], max: [5, 5, 10] };

test("faceKind", () => {
  assert.equal(faceKind([0, 0, 1]), "top");
  assert.equal(faceKind([0, 0, -1]), "under");
  assert.equal(faceKind([1, 0, 0]), "side");
  assert.equal(faceKind([0.7071, 0, 0.7071]), "side");
  assert.equal(faceKind([0.9, 0, 0.43]), "side");
});

test("topLanding rounds to 0.01", () => {
  assert.equal(topLanding(20, 0), 20);
  assert.equal(topLanding(20.004, 0), 20);
  assert.equal(topLanding(30, 10), 20);
  assert.equal(topLanding(12.346, 0), 12.35);
});

test("a shape lands flush on a +X side face", () => {
  const P = [20, 3, 7];
  const m = sideLanding([1, 0, 0], P, box0, 0);
  near(apply(m, [0, 0, 0]), P); // bottom centre (centre-relative c0 is the origin here)
  near(dir(m, [0, 0, 1]), [1, 0, 0], 1e-9);
  near(apply(m, [0, 0, 10]), [30, 3, 7]); // its top points away from the face
});

test("bottom centre ends on the hit point for an off-origin box", () => {
  const b = { min: [10, 20, 5], max: [30, 40, 15] };
  const P = [-8, 1, 4];
  const m = sideLanding([-1, 0, 0], P, b, 0);
  near(apply(m, [20, 30, 5]), P);
  near(dir(m, [0, 0, 1]), [-1, 0, 0], 1e-9);
});

test("45 degree slope", () => {
  const s = Math.SQRT1_2;
  const P = [10, 2, 10];
  const m = sideLanding([s, 0, s], P, box0, 0);
  near(apply(m, [0, 0, 0]), P);
  near(dir(m, [0, 0, 1]), [s, 0, s], 1e-9);
  near(dir(m, [0, 1, 0]), [0, 1, 0], 1e-9);
});

test("rounding only along the face, flush axis stays exact", () => {
  const m = sideLanding([1, 0, 0], [20.3, 3.4, 7.4], box0, 1);
  near(apply(m, [0, 0, 0]), [20.3, 3, 7]);
  const s = Math.SQRT1_2;
  const m2 = sideLanding([s, 0, s], [10.3, 3.4, 10.4], box0, 1);
  near(apply(m2, [0, 0, 0]), [10.3, 3, 10.4]);
});
