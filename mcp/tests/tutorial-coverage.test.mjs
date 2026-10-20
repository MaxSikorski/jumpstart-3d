import test from "node:test";
import assert from "node:assert/strict";
import { tutorialCoverage } from "../benchmarks/coverage.mjs";

test("upstream tutorial coverage reports unsupported native 2.0 plans", () => {
  const coverage = tutorialCoverage();
  assert.equal(coverage.total, 19);
  assert.equal(coverage.implemented, 16);
  assert.deepEqual(coverage.missing.map(({ id }) => id), ["b-top", "a-cup", "a-params"]);
  assert.deepEqual(coverage.obsolete, []);
});
