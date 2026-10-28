// A shell wall equal to a fillet radius can hang the engine. A timed child keeps the test run bounded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = fileURLToPath(new URL("./shellhang-child.mjs", import.meta.url));
const run = await new Promise(resolve => {
  execFile(process.execPath, [child], { timeout: 150000, killSignal: "SIGKILL", maxBuffer: 1 << 20 },
    (error, stdout, stderr) => resolve({ error, stdout, stderr }));
});
const cases = new Map(run.stdout.trim().split("\n").filter(line => line.startsWith("{")).map(line => {
  const result = JSON.parse(line);
  return [result.case, result];
}));
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
