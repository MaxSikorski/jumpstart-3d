import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, failingSpecs } from "../tools/nightly-issue.mjs";

const report = {
  suites: [{ specs: [{ file: "a.spec.mjs", title: "ok", tests: [{ projectName: "site", status: "expected" }] }], suites: [
    { specs: [{ file: "a.spec.mjs", title: "bad", tests: [{ projectName: "site", status: "unexpected" }, { projectName: "single", status: "expected" }] }] },
  ] }],
};

test("failingSpecs lists only unexpected results, nested suites included", () => {
  assert.deepEqual(failingSpecs(report), ["a.spec.mjs › bad [site]"]);
});

test("a blocking failure opens the issue and names its specs", () => {
  const r = buildReport({ needs: { playwright: { result: "failure" }, judge: { result: "success" } }, reports: { playwright: ["x [site]"] }, runUrl: "U", ref: "main" });
  assert.equal(r.open, true);
  assert.match(r.body, /\*\*playwright\*\*: failure\n- x \[site\]/);
});

test("Firefox and WebKit failures are listed but do not open an issue alone", () => {
  const needs = { cross: { result: "success" }, playwright: { result: "success" } };
  const r = buildReport({ needs, reports: { cross: ["y [site-webkit]"] }, runUrl: "U", ref: "main" });
  assert.equal(r.open, false);
  assert.match(r.body, /not blocking yet/);
  assert.equal(buildReport({ needs: { cross: { result: "failure" } }, reports: {}, runUrl: "U", ref: "main", crossBlocking: true }).open, true);
});

test("a skipped job is not a failure; a cancelled one is", () => {
  assert.equal(buildReport({ needs: { fuzz: { result: "skipped" } }, reports: {}, runUrl: "U", ref: "main" }).open, false);
  assert.equal(buildReport({ needs: { fuzz: { result: "cancelled" } }, reports: {}, runUrl: "U", ref: "main" }).open, true);
});

test("a failing lighthouse job does not open the issue while the check only reports", () => {
  const r = buildReport({ needs: { lighthouse: { result: "failure" }, playwright: { result: "success" } }, reports: {}, runUrl: "U", ref: "main" });
  assert.equal(r.open, false);
  assert.equal(buildReport({ needs: { lighthouse: { result: "failure" }, playwright: { result: "failure" } }, reports: {}, runUrl: "U", ref: "main" }).open, true);
});
