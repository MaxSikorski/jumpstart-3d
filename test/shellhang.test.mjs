// Shell with the Auto method: a wall equal to a fillet radius can hang the engine, and free-form shapes (the oval capsule)
// must get true walls quickly or fall back to slices when the offset folds. A timed child keeps the test run bounded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = fileURLToPath(new URL("./shellhang-child.mjs", import.meta.url));
const run = await new Promise(resolve => {
  execFile(process.execPath, [child], { timeout: 150000, killSignal: "SIGKILL", maxBuffer: 1 << 20 },
    (error, stdout, stderr) => resolve({ error, stdout, stderr }));
});
const cases = new Map();
for (const line of run.stdout.split("\n")) {
  if (!line.startsWith("{")) continue;
  try { const result = JSON.parse(line); cases.set(result.case, result); } catch {} // a line cut off by a kill: that case counts as missing
}
const last = run.stderr.trim().split("\n").findLast(line => line.startsWith("start ")) || "start unknown";
const failure = run.error?.killed && run.error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  ? `the engine run was stopped after 150 s during case ${last.slice(6)}: a hang?`
  : `the engine run failed or a case is missing (${last}): ${run.error?.message || "no result"}`;
function result(name) {
  assert.ok(!run.error, failure);
  assert.ok(cases.has(name), failure + "; missing case " + name);
  return cases.get(name);
}
function quick(r) { assert.ok(r.ms < 20000, `build took ${r.ms} ms: ${r.error || ""}`); }
function walls(r, expected) {
  assert.ok(r.ok, r.error);
  quick(r);
  assert.equal(r.wall.length, 3);
  for (const [i, value] of r.wall.entries()) {
    const tolerance = i < 2 ? .002 : .02;
    assert.ok(Math.abs(value - expected) <= tolerance,
      `wall ${["+x", "+z", "fillet"][i]} measured ${value} mm, expected ${expected} ± ${tolerance} mm`);
  }
  assert.equal(r.open, 0);
}
// the rounded box (r = 2) and the sharp-cornered hollow a wall t inside it leaves (its corners are rounded by 2 - t)
const OUTER = 36 * 26 * 16 + 4 * (36 * 26 + 26 * 16 + 36 * 16) + Math.PI * 4 * (36 + 26 + 16) + (4 / 3) * Math.PI * 8;
const wall = (t) => OUTER - (40 - 2 * t) * (30 - 2 * t) * (20 - 2 * t);
const near = (got, want, tol) => assert.ok(Math.abs(got - want) <= want * tol, `volume ${got.toFixed(1)}, expected about ${want.toFixed(1)}`);

test("a 2 mm wall on a box with 2 mm fillets finishes quickly, about 1.99 mm thick and closed", () => {
  const r = result("guard");
  walls(r, 1.99);
  near(r.volume, wall(1.99), .003);
});
test("walls just outside the guard (1.99 and 2.01 mm) keep their own thickness", () => {
  const r = result("outside");
  assert.equal(r.results?.length, 2, r.error);
  for (const [i, value] of r.results.entries()) {
    assert.ok(value.ok, value.error);
    quick(value);
    near(value.volume, wall([1.99, 2.01][i]), .003);
  }
});
test("a thinner wall hitting another fillet radius retries 0.5% thicker and stays closed", () => {
  const r = result("thicker");
  walls(r, 2.01);
  assert.ok(r.volume > 8700, `volume ${r.volume}, expected > 8700`);
});
test("when both the thinner and the thicker wall meet another radius, the offset is not tried (no hang)", () => {
  const r = result("bothhit");
  assert.equal(r.nullBoth, true, r.error || "both matching radii must skip the offset");
  assert.equal(r.okTwo, true, r.error || "the two-radius control must produce a positive-volume solid");
  quick(r);
});
test("Press Pull of a rounded edge by exactly its radius ends quickly (no engine hang)", () => {
  const r = result("presspull");
  quick(r);
  assert.ok(r.ok || /isn't supported yet|would close/.test(r.error), r.error);
  if (r.ok) assert.ok(r.volume < r.base, `volume ${r.volume}, expected below base ${r.base}`);
});

test("Auto hollow of the oval capsule makes true 2 mm walls quickly", () => {
  const r = result("capsule");
  assert.ok(r.ok, r.error);
  assert.ok(r.ms < 10000, `build took ${r.ms} ms (the slice method needs 20-30 s)`);
  near(r.volume, 3491.4, .005);
  assert.ok(r.gap >= 1.98 && r.gap <= 2.02, `nearest hollow-to-outside distance ${r.gap} mm, expected 2 ± 0.02`);
  for (const d of ["x", "y", "z"]) assert.ok(Math.abs(r.rays[d] - 2) <= .02, `wall along +${d} measured ${r.rays[d]} mm, expected 2 ± 0.02`);
  // the ray along (1, 1, 1) meets the slanted wall at an angle, so it reads longer than 2 (measured 2.763 on the true offset wall)
  assert.ok(Math.abs(r.rays.diag - 2.763) <= .03, `wall along (1, 1, 1) measured ${r.rays.diag} mm, expected 2.763 ± 0.03`);
  assert.equal(r.open, 0);
});
test("Auto hollow where the offset folds falls back to slices (the folded wall is not used)", () => {
  const r = result("flatcap");
  assert.ok(r.ok, r.error);
  assert.ok(r.ms < 60000, `build took ${r.ms} ms`);
  near(r.volume, 1294.5, .02);
  assert.ok(r.volume < 1450, `volume ${r.volume} is the folded offset's (1504), not the slice wall's`);
  assert.equal(r.open, 0);
});
test("Auto hollow of shapes that are not free-form is unchanged", () => {
  const r = result("unchanged");
  assert.equal(Object.keys(r.results || {}).length, 4, r.error);
  for (const [name, want, tol] of [["roundbox", wall(1.99), .003], ["box", 9024, .001], ["sphere", 4934.4, .002], ["torus", 4737.4, .002]]) {
    const x = r.results[name];
    assert.ok(x.ok, name + ": " + x.error);
    quick(x);
    near(x.volume, want, tol);
    assert.equal(x.open, 0, name);
  }
});
