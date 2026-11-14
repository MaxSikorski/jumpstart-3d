import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { ROTATIONS, tolOf, within, validateTruth, validateCase, loadCase, poses, toBuilt, stepMatrix, holePoint, gate, checkPose, pickPose, finish, expectWrong, table } from "./score.mjs";

const size = { id: "size", kind: "size", value: [80, 50, 6], tol: 0.1 };
const holes = { id: "holes", kind: "holes", dia: 5.5, count: 4, axis: "z", through: true, at: [[8, 8], [72, 8], [8, 42], [72, 42]], tol: 0.1 };
const truth = () => ({ spec: 1, units: "mm", name: "Plate", checks: [structuredClone(size), structuredClone(holes), { id: "distance", kind: "distance", a: { near: [0, 0, 0] }, b: { near: [0, 0, 6] }, value: 6, tol: 0.1 }, { id: "radius", kind: "radius", near: [0, 0, 0], value: 3, tol: 0.1 }, { id: "volume", kind: "volume", value: 100, tol: "1%" }, { id: "solids", kind: "solids", value: 1 }], assumed: [], questions: [] });
const kase = (id = "plate") => ({ drawbench: 1, id, title: "Plate", wave: 1, set: "development", input: { kind: "drawing", picture: "drawing.png", request: "Build it" }, overlap: 0.98, editable: [{ id: "edit-W", param: 80, to: 90, size: [90, 50, 6] }], drawing: {}, wrong: [{ recipe: "wrong-big.recipe.json", why: "Too big", fails: ["size"] }] });
const hole = (p) => ({ axis: [0, 0, 1], point: [...p, 0], from: 0, to: 6, dia: 5.5, through: true, segments: [{ dia: 5.5, from: 0, to: 6 }] });
const part = () => ({ bodies: [{ id: "b1", name: "plate", error: null, volumeFrom: "solid", solids: 1 }], body: "b1", box: { min: [0, 0, 0], max: [80, 50, 6] }, size: [80, 50, 6], volume: 100, volumeFrom: "solid", solids: 1, holes: holes.at.map(hole) });
const evidence = () => ({ distances: { distance: { kind: "planes", distance: 6, nearA: 0, nearB: 0 } }, radii: { radius: { type: "cylinder", radius: 3, near: 0 } }, overlap: { shared: 100, truthVolume: 100 } });
const pose = { index: 0, R: ROTATIONS[0] };
const check = (p = part(), t = truth(), e = evidence(), turn = pose) => checkPose({ truth: t, kase: kase(), part: p, pose: turn, evidence: e });
const byId = (checks, id) => checks.find((c) => c.id === id);

test("rotations are the 24 proper orthonormal integer matrices", () => {
  assert.equal(ROTATIONS.length, 24); assert.equal(new Set(ROTATIONS.map(String)).size, 24);
  assert.deepEqual(ROTATIONS[0], [1,0,0,0,1,0,0,0,1]);
  for (const r of ROTATIONS) {
    for (const n of r) assert.ok([-1, 0, 1].includes(n));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.equal([0,1,2].reduce((s, k) => s + r[i*3+k]*r[j*3+k], 0), +(i === j));
    assert.equal(r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6]), 1);
  }
});
test("poses match sizes or choose closest", () => {
  assert.equal(poses([80,50,6], [50,80,6], tolOf(0.1, 1)).length, 4);
  assert.equal(poses([40,40,25], [40,40,25], tolOf(0.1, 1)).length, 8);
  assert.equal(poses([80,50,6], [55,88,6.6], tolOf(0.1, 1)).length, 4);
});
test("point and STEP transforms agree for all rotations", () => {
  const min = [-10, 17, 9], built = [4, -3, 12], sizes = [80, 50, 6];
  for (const r of ROTATIONS) for (let i = 0; i < 30; i++) {
    const p = [((i*31)%101)/101*80, ((i*17)%97)/97*50, ((i*13)%89)/89*6], a = p.map((n, j) => n + min[j]);
    const m = stepMatrix(r, sizes, min, built), actual = [0,1,2].map((j) => m[j]*a[0] + m[4+j]*a[1] + m[8+j]*a[2] + m[12+j]);
    actual.forEach((n, j) => assert.ok(Math.abs(n - toBuilt(r, sizes, built, p)[j]) < 1e-9));
  }
  assert.deepEqual(holePoint("x", [2, 3]), [0, 2, 3]); assert.deepEqual(holePoint("y", [2, 3]), [2, 0, 3]);
});
test("tolerances validate and compare asymmetrically", () => {
  assert.deepEqual(tolOf(0.2, 10), { minus: 0.2, plus: 0.2 });
  assert.deepEqual(tolOf({ minus: 1, plus: 2 }, 10), { minus: 1, plus: 2 });
  assert.deepEqual(tolOf("1%", -100), { minus: 1, plus: 1 });
  assert.ok(within(12, 10, tolOf({ minus: 1, plus: 2 }, 10))); assert.ok(!within(8.9, 10, tolOf({ minus: 1, plus: 2 }, 10)));
  for (const bad of [-1, "-1%", "abc", {}, null, Infinity]) assert.throws(() => tolOf(bad, 1));
});
test("hole counts, positions, through and counterbores", () => {
  assert.equal(byId(check(), "holes").status, "pass");
  let p = part(); p.holes[0].point[0] += 0.5; assert.match(byId(check(p), "holes").note, /nearest is 0.5 mm away/);
  p = part(); p.holes[0].dia = 5.2; assert.match(byId(check(p), "holes").note, /found 3 Ø5.5 holes along z, expected 4/);
  p = part(); p.holes[0].through = false; assert.match(byId(check(p), "holes").note, /blind, expected through/);
  p = part(); const t = truth(); t.checks[1].cbore = { dia: 11, depth: 2 }; p.holes.forEach((h) => h.segments.push({ dia: 10.6, from: 0, to: 2 })); assert.match(byId(check(p, t), "holes").note, /counterbore Ø10.6 × 2, expected Ø11 × 2/);
});
test("rotated plate holes pass", () => {
  const r = [0,-1,0,1,0,0,0,0,1], index = ROTATIONS.findIndex((v) => String(v) === String(r));
  const p = part(); p.size = [50,80,6]; p.box.max = p.size; p.holes = holes.at.map((at) => { const v = toBuilt(r, size.value, p.box.min, holePoint("z", at)); return hole(v); });
  assert.ok(check(p, truth(), evidence(), { index, R: r }).every((c) => c.status === "pass"));
});
test("distance, radius, volume, solids and overlap", () => {
  assert.ok(check().every((c) => c.status === "pass"));
  let e = evidence(); e.distances.distance.kind = "edges"; assert.match(byId(check(part(), truth(), e), "distance").note, /parallel flat faces/);
  e = evidence(); e.distances.distance.nearA = 3.2; assert.match(byId(check(part(), truth(), e), "distance").note, /closest 3.2 mm away/);
  e = evidence(); e.radii.radius.type = "plane"; assert.equal(byId(check(part(), truth(), e), "radius").status, "fail");
  e = evidence(); e.radii.radius.near = 4; assert.equal(byId(check(part(), truth(), e), "radius").status, "fail");
  e = evidence(); e.distances.distance = { error: "no faces" }; e.radii.radius = { error: "no radius" }; e.overlap = { error: "no collision" };
  const checks = check(part(), truth(), e); for (const id of ["distance", "radius", "overlap"]) assert.equal(byId(checks, id).status, "unverified"); assert.match(byId(checks, "overlap").note, /no collision/);
  const p = part(); p.volumeFrom = "mesh"; p.solids = 2; assert.equal(byId(check(p), "volume").status, "unverified"); assert.equal(byId(check(p), "solids").status, "fail");
  e = evidence(); e.overlap.shared = 90; assert.equal(byId(check(part(), truth(), e), "overlap").status, "fail");
});
test("gate failures prevent all other checks", () => {
  for (const change of [(p) => p.bodies.push({}), (p) => { p.bodies[0].error = "broken"; }, (p) => { p.volumeFrom = "mesh"; }, (p) => { p.solids = 2; }]) {
    const p = part(); change(p); assert.equal(gate(truth(), p).status, "fail"); assert.ok(gate(truth(), p).note);
    const r = finish({ truth: truth(), kase: kase(), part: p, scored: [], editable: [{ id: "edit-W", status: "pass" }] });
    assert.equal(r.pose, null); assert.ok(r.checks.slice(1).every((c) => c.status === "not run")); assert.equal(r.pass, false);
  }
});
test("finish, pose choice, and wrong expectations", () => {
  const checks = check(), scored = [{ pose, checks }];
  const r = finish({ truth: truth(), kase: kase(), part: part(), scored, editable: [{ id: "edit-W", status: "fail", measured: [1,2,3], note: "wrong size" }] });
  assert.equal(r.pass, true); assert.equal(r.score.passed, r.score.total - 1); assert.equal(r.score.percent, Math.floor(100 * r.score.passed / r.score.total));
  assert.equal(expectWrong(r, ["edit-W"]).ok, true); assert.deepEqual(expectWrong(r, ["size"]), { ok: false, unexpected: ["edit-W"], missing: ["size"] });
  const a = { pose, checks: [{ id: "overlap", gating: true, status: "pass", measured: 0.98 }] }, b = { pose, checks: [{ id: "overlap", gating: true, status: "pass", measured: 0.99 }] };
  assert.equal(pickPose([a, b]), 1); assert.equal(pickPose([b, b]), 0);
  assert.match(table([{ case: "plate", design: "truth", result: r }, { case: "plate", design: "wrong-big", result: r, expected: { ok: true } }]), /Reference parts: 0 of 1 score 100 %\. Wrong parts: 1 of 1 fail as expected\./);
});
test("truth and case validation name problems", () => {
  assert.equal(validateTruth(truth()).name, "Plate"); assert.equal(validateCase(kase(), "plate", truth()).id, "plate");
  for (const [mutate, pattern] of [
    [(t) => { t.spec = 2; }, /spec/], [(t) => { t.units = "in"; }, /units/], [(t) => { t.checks[0].id = "gate"; }, /gate/],
    [(t) => { t.checks[1].count = 0; }, /holes/], [(t) => { t.checks[0].tol = "bad"; }, /size.*tolerance/],
    [(t) => { t.checks[1].depth = 2; }, /holes.*depth/], [(t) => { t.checks[2].a.near = [0]; }, /distance/],
    [(t) => { t.checks[3].value = 0; }, /radius/], [(t) => { t.checks[4].value = -1; }, /volume/],
    [(t) => { t.checks[5].value = 0; }, /solids/], [(t) => { t.checks.push(t.checks[0]); }, /size/],
  ]) { const t = truth(); mutate(t); assert.throws(() => validateTruth(t), pattern); }
  for (const [mutate, pattern] of [[(c) => { c.id = "other"; }, /id/], [(c) => { c.input.picture = "../x"; }, /input/], [(c) => { c.wrong[0].fails = ["unknown"]; }, /fails/], [(c) => { c.editable[0].to = 80; }, /editable/]]) { const c = kase(); mutate(c); assert.throws(() => validateCase(c, "plate", truth()), pattern); }
});
test("loadCase checks required files", async () => {
  const root = await mkdtemp(join(tmpdir(), "drawbench-")), dir = join(root, "plate");
  await mkdir(dir);
  try {
    const c = kase(basename(dir)); await writeFile(join(dir, "case.json"), JSON.stringify(c)); await writeFile(join(dir, "truth.json"), JSON.stringify(truth()));
    await writeFile(join(dir, "truth.recipe.json"), "{}"); await writeFile(join(dir, "wrong-big.recipe.json"), "{}");
    await assert.rejects(loadCase(dir), /drawing\.png/); await writeFile(join(dir, "drawing.png"), "");
    assert.equal((await loadCase(dir)).kase.id, basename(dir));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("hole centres are matched one to one, so a near miss cannot take another centre's hole", () => {
  const t = truth();
  t.checks[1] = { ...holes, count: 2, at: [[1, 5], [1.18, 5]] };
  const p = part();
  p.holes = [hole([1.08, 5]), hole([0.91, 5])];
  assert.equal(byId(check(p, t), "holes").status, "pass");
  p.holes = [hole([1.08, 5]), hole([0.85, 5])];
  assert.match(byId(check(p, t), "holes").note, /no Ø5\.5 hole at \[1(\.18)?, 5\] \(nearest is/);
});

test("a blind hole and a counterbore must open on the stated side", () => {
  const t = truth(), p = part();
  t.checks[1] = { id: "blind", kind: "holes", dia: 5, count: 1, axis: "z", through: false, depth: 4, at: [[40, 25]], opens: "+z", tol: 0.1 };
  const blind = (open, from) => ({ axis: [0, 0, 1], point: [40, 25, from], from, to: from + 4, dia: 5, through: false, open, segments: [{ dia: 5, from, to: from + 4 }] });
  p.holes = [blind([0, 0, 1], 2)];
  assert.equal(byId(check(p, t), "blind").status, "pass");
  p.holes = [blind([0, 0, -1], 0)];
  assert.match(byId(check(p, t), "blind").note, /opens on the wrong side \(expected \+z\)/);
  const flipped = ROTATIONS.findIndex((R) => R.join() === "1,0,0,0,-1,0,0,0,-1"); // half a turn about x: +z becomes -z
  assert.equal(byId(check(p, t, evidence(), { index: flipped, R: ROTATIONS[flipped] }), "blind").status, "pass");
  t.checks[1] = { ...holes, id: "cb", count: 1, at: [[40, 25]], dia: 6.6, cbore: { dia: 11, depth: 6.5 }, opens: "+z" };
  const cbore = (segments) => ({ axis: [0, 0, 1], point: [40, 25, 0], from: 0, to: 6, dia: 6.6, through: true, segments });
  p.holes = [{ ...cbore([{ dia: 6.6, from: -13.5, to: 0 }, { dia: 11, from: 0, to: 6.5 }]), from: -13.5, to: 6.5 }];
  assert.equal(byId(check(p, t), "cb").status, "pass");
  p.holes = [{ ...cbore([{ dia: 11, from: 0, to: 6.5 }, { dia: 6.6, from: 6.5, to: 20 }]), from: 0, to: 20 }];
  assert.match(byId(check(p, t), "cb").note, /counterbore of the Ø6\.6 hole at \[40, 25\] is on the wrong side/);
  p.holes = [{ ...cbore([{ dia: 6.6, from: 0, to: 20 }]), from: 0, to: 20 }];
  assert.match(byId(check(p, t), "cb").note, /^no counterbore, expected Ø11 × 6\.5$/);
});

test("an overlap that could not be measured is reported but does not decide the case", () => {
  const e = evidence();
  e.overlap = { error: "the geometry engine failed" };
  const checks = check(part(), truth(), e);
  assert.deepEqual({ ...byId(checks, "overlap") }, { id: "overlap", kind: "overlap", status: "unverified", expected: 0.98, measured: null, tol: null, note: "overlap not measured: the geometry engine failed", gating: false });
  const r = finish({ truth: truth(), kase: kase(), part: part(), scored: [{ pose, checks }], editable: [{ id: "edit-W", status: "pass", measured: [90, 50, 6], note: "" }] });
  assert.equal(r.pass, true);
  assert.ok(r.score.percent < 100);
});

test("other correct builds: validated, listed in the summary, and only editable checks may be expected to fail", async () => {
  const good = { ...kase(), other: [{ recipe: "other-centred.recipe.json", why: "centred", fails: ["edit-W"] }] };
  assert.equal(validateCase(good, "plate", truth()), good);
  assert.throws(() => validateCase({ ...good, other: [{ recipe: "other-a.recipe.json", why: "x", fails: ["size"] }] }, "plate", truth()), /only fail editable checks/);
  assert.throws(() => validateCase({ ...good, other: [{ recipe: "wrong-a.recipe.json", why: "x", fails: [] }] }, "plate", truth()), /invalid or duplicate other recipe/);
  const full = finish({ truth: truth(), kase: kase(), part: part(), scored: [{ pose, checks: check() }], editable: [{ id: "edit-W", status: "pass", measured: [90, 50, 6], note: "" }] });
  assert.equal(full.score.percent, 100);
  const text = table([{ case: "plate", design: "truth", kind: "truth", result: full }, { case: "plate", design: "other-centred", kind: "other", result: full, expected: expectWrong(full, []) },
    { case: "plate", design: "mine.json", kind: "design", result: full }]);
  assert.match(text, /Reference parts: 1 of 1 score 100 %\. Other correct builds: 1 of 1 pass as expected\. mine\.json: PASS, \d+ of \d+ checks \(100 %\)\./);
  const dir = await mkdtemp(join(tmpdir(), "drawbench-other-"));
  try {
    await mkdir(join(dir, "plate"));
    for (const [name, value] of [["truth.json", truth()], ["case.json", good], ["drawing.png", ""], ["truth.recipe.json", {}], ["wrong-big.recipe.json", {}]]) await writeFile(join(dir, "plate", name), typeof value === "string" ? value : JSON.stringify(value));
    await assert.rejects(loadCase(join(dir, "plate")), /missing file other-centred\.recipe\.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
