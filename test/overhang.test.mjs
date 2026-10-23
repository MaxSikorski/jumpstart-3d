// The overhang rule in src/overhang.js, on known triangles (node --test, no browser; part of npm test's pretest list).
// Printer plate overhang shading and the 3D Print Sim share this rule: a face is a steep underside when
// -n.z > sin(limit) + EPS, where limit is how far it leans out from upright (10-80 degrees).
import test from "node:test";
import assert from "node:assert/strict";
import { startJob, classify, leansOut, limitOf, EPS } from "../src/overhang.js";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mat = (sx = 1, sy = 1, sz = 1, tz = 0) => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, tz, 1];
const rotX = (deg, tz = 0) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, tz, 1]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// a triangle whose counter-clockwise outward normal is `n`, lowest corner at (0,0,z)
function tri(n, z = 10, size = 3) {
  const len = Math.hypot(...n), nn = n.map((q) => q / len);
  const seed = Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = cross(nn, seed); const ul = Math.hypot(...u); u = u.map((q) => (q / ul) * size);
  const v = cross(nn, u); // u x v = n * |u|^2
  const p = [0, 0, 0], q = u, r = v;
  const zmin = Math.min(p[2], q[2], r[2]);
  const pos = new Float32Array([...p, ...q, ...r].map((val, i) => (i % 3 === 2 ? val - zmin + z : val)));
  return { pos, idx: new Uint32Array([0, 1, 2]) };
}
const flagged = (n, deg, m = I, z = 10) => { const t = tri(n, z); return classify(t.pos, t.idx, m, deg).count === 1; };
// outward normal of a face leaning `lean` degrees out from upright: straight up is lean 0 only for a wall; a wall has n.z = 0
const lean = (deg) => [Math.cos((deg * Math.PI) / 180), 0, -Math.sin((deg * Math.PI) / 180)];

test("limitOf is the sine: 30 -> 0.5, 45 -> 0.7071, 60 -> 0.8660", () => {
  assert.ok(Math.abs(limitOf(30) - 0.5) < 1e-12);
  assert.ok(Math.abs(limitOf(45) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(limitOf(60) - Math.sqrt(3) / 2) < 1e-12);
});

test("upward face, vertical wall and a lifted horizontal underside", () => {
  for (const deg of [10, 45, 80]) {
    assert.equal(flagged([0, 0, 1], deg), false, `up at ${deg}`);
    assert.equal(flagged([1, 0, 0], deg), false, `wall at ${deg}`);
    assert.equal(flagged([0, 0, -1], deg), true, `lifted underside at ${deg}`);
  }
});

test("an underside lying on the bed is not flagged; one corner above the 0.05 mm band makes it flagged", () => {
  assert.equal(flagged([0, 0, -1], 45, I, 0), false);
  assert.equal(flagged([0, 0, -1], 45, I, 0.04), false);
  assert.equal(flagged([0, 0, -1], 45, I, 0.06), true);
  assert.equal(flagged([0, 0, -1], 45, I, -0.04), false);
});

test("just below, at and above 30, 45 and 60 degrees from upright", () => {
  for (const L of [30, 45, 60]) {
    assert.equal(flagged(lean(L - 1), L), false, `${L - 1} deg face, limit ${L}`);
    assert.equal(flagged(lean(L), L), false, `a face exactly at ${L} is clear`);
    assert.equal(flagged(lean(L + 1), L), true, `${L + 1} deg face, limit ${L}`);
  }
});

test("the old cosine rule disagrees away from 45: a 50 degree face under a 60 degree limit is clear", () => {
  const n = lean(50);
  assert.equal(-n[2] > Math.cos((60 * Math.PI) / 180), true, "the old cos rule flagged it");
  assert.equal(flagged(n, 60), false, "the sine rule clears it");
  const m = lean(20); // and a 20 degree face under a 30 degree limit: old cos(30)=0.87 cleared a 0.34 face too; check the other side
  assert.equal(-m[2] > Math.cos((30 * Math.PI) / 180), false);
  assert.equal(flagged(lean(35), 30), true, "the sine rule flags 35 over 30; the old rule (0.57 > 0.87) did not");
  assert.equal(-lean(35)[2] > Math.cos((30 * Math.PI) / 180), false);
});

test("leansOut matches the job", () => {
  assert.equal(leansOut(-limitOf(45) - 2 * EPS, 45), true);
  assert.equal(leansOut(-limitOf(45), 45), false);
  assert.equal(leansOut(0.5, 45), false);
});

test("a body turned on the bed: a wall turned 90 degrees becomes an underside, an underside becomes a wall", () => {
  assert.equal(flagged([0, 0, -1], 45, rotX(90, 10), 10), false); // the underside turns to face -y: a wall
  assert.equal(flagged([0, 1, 0], 45, rotX(90, 10), 0), false); // the +y wall turns to face +z (the pieces sit 10 mm up)
  assert.equal(flagged([0, -1, 0], 45, rotX(90, 10), 0), true); // the -y wall turns to face -z
});

test("nonuniform scale uses the inverse transpose of the matrix, not the normal itself", () => {
  const n = lean(45); // outward (0.707, 0, -0.707)
  // stretch z by 2: the face gets steeper in z, so it leans less: n' ~ (1, 0, -0.5) -> -nz 0.447 < sin 45
  assert.equal(flagged(n, 45, mat(1, 1, 2)), false);
  // stretch x by 2: the face lies flatter: n' ~ (0.5, 0, -1) -> -nz 0.894 > sin 45
  assert.equal(flagged(n, 45, mat(2, 1, 1)), true);
});

test("a mirrored body keeps its outward direction: undersides stay undersides, tops stay tops", () => {
  assert.equal(flagged(lean(60), 45, mat(-1, 1, 1)), true);
  assert.equal(flagged([0, 0, 1], 45, mat(-1, 1, 1)), false);
  assert.equal(flagged([0, 0, -1], 45, mat(1, 1, -1)), false, "mirrored in z the underside is a top");
  assert.equal(flagged([0, 0, 1], 45, mat(1, 1, -1), 10), true, "and a top is an underside");
});

test("the area is the area in the world", () => {
  const t = tri([0, 0, -1], 10, 1);
  const base = classify(t.pos, t.idx, I, 45).area;
  assert.ok(base > 0);
  assert.ok(Math.abs(classify(t.pos, t.idx, mat(2, 2, 1, 0), 45).area - 4 * base) < 1e-4);
  assert.ok(Math.abs(classify(t.pos, t.idx, mat(-3, 1, 1, 0), 45).area - 3 * base) < 1e-4);
});

test("a degenerate triangle and a flat matrix are skipped", () => {
  const pos = new Float32Array([0, 0, 5, 1, 0, 5, 2, 0, 5]);
  assert.equal(classify(pos, new Uint32Array([0, 1, 2]), I, 45).count, 0);
  const t = tri([0, 0, -1], 10);
  assert.equal(classify(t.pos, t.idx, mat(1, 1, 0), 45).count, 0);
});

test("a long mesh is worked through in short chunks and gives the same answer as one pass", () => {
  const n = 20000, pos = new Float32Array(n * 9), idx = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const down = i % 3 === 0, z = 5 + (i % 7);
    pos.set([i, 0, z, i + 1, 0, z, i, down ? 1 : -1, z], i * 9); // down: normal -z via winding; otherwise +z
    if (!down) pos.set([i, 0, z, i, 1, z, i + 1, 0, z], i * 9);
    idx.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
  }
  const job = startJob(pos, idx, I, 45);
  let chunks = 1;
  while (!job.step(0)) chunks++;
  assert.ok(chunks >= 9, `only ${chunks} chunks`);
  assert.equal(job.processed, n);
  const whole = classify(pos, idx, I, 45);
  assert.equal(job.result().count, whole.count);
  assert.deepEqual([...job.result().tris].slice(0, 20), [...whole.tris].slice(0, 20));
  assert.ok(whole.count > 0 && whole.count < n);
});

test("a new limit on the same mesh reuses the cached face normals and still answers correctly", () => {
  const t = tri(lean(40), 10);
  assert.equal(classify(t.pos, t.idx, I, 30).count, 1);
  assert.equal(classify(t.pos, t.idx, I, 45).count, 0);
  assert.equal(classify(t.pos, t.idx, I, 30).count, 1);
});
