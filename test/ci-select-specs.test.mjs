import test from "node:test";
import assert from "node:assert/strict";
import { select, MAX_SPECS } from "../tools/ci-select-specs.mjs";

const all = () => true;

test("a changed spec is selected; smoke, golden, mobile and the chat judge are not in the list", () => {
  const r = select(["test/pivot.spec.mjs", "test/smoke.spec.mjs", "test/golden.spec.mjs", "test/chatjudge.spec.mjs", "test/mobile.spec.mjs", "src/app.js"], all);
  assert.deepEqual(r.specs, ["test/pivot.spec.mjs"]);
});

test("only top-level test/*.spec.mjs files count; helpers, projects and nested files do not", () => {
  const r = select(["test/helpers.mjs", "test/projects/a.spec.mjs", "test/fixtures/x.spec.mjs", "test/x.test.mjs", "xtest/a.spec.mjs", "README.md", "src/pivot.js"], all);
  assert.deepEqual(r, { specs: [], notices: [] });
});

test("a deleted spec is dropped", () => {
  assert.deepEqual(select(["test/gone.spec.mjs", "test/here.spec.mjs"], (p) => p !== "test/gone.spec.mjs").specs, ["test/here.spec.mjs"]);
});

test("no name is skipped: spaces, plus signs, brackets and shell characters stay whole", () => {
  const names = ["test/two words.spec.mjs", "test/c++.spec.mjs", "test/a(b).spec.mjs", "test/a;b.spec.mjs", "test/$(x).spec.mjs", "test/[x]{1}.spec.mjs"];
  const r = select(names, all);
  assert.deepEqual(r.specs, [...names].sort());
  assert.deepEqual(r.notices, []);
});

test("a name with a line break is not a spec path", () => {
  assert.deepEqual(select(["test/a\nb.spec.mjs"], all).specs, []);
});

test("more than the cap runs the first ones sorted and says so", () => {
  const names = Array.from({ length: 13 }, (_, i) => `test/s${String(i).padStart(2, "0")}.spec.mjs`).reverse();
  const r = select(names, all);
  assert.equal(r.specs.length, MAX_SPECS);
  assert.equal(r.specs[0], "test/s00.spec.mjs");
  assert.match(r.notices[0], /13 spec files changed: running the first 10/);
});

test("an empty diff selects nothing", () => {
  assert.deepEqual(select([], all), { specs: [], notices: [] });
});
