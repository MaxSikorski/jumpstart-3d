// The nightly loading check's maths (tools/lighthouse.mjs): medians, limits, the comparison, and refusing a result that cannot be trusted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { median, limitFor, readRun, medians, compare, table } from "../tools/lighthouse.mjs";

const budget = JSON.parse(readFileSync(new URL("../lighthouse-budget.json", import.meta.url), "utf8"));
const withBaseline = (values, lighthouse = "13.5.0") => ({ ...budget, baseline: { lighthouse, values } });
const base = { lcp: 3000, tbt: 500, cls: 0.1, bytes: 10_000_000 };

// a Lighthouse result with every audit the check reads, good unless a test breaks it
const lhr = (over = {}) => ({
  audits: {
    "largest-contentful-paint": { numericValue: 2500 },
    "total-blocking-time": { numericValue: 300 },
    "cumulative-layout-shift": { numericValue: 0.05 },
    "total-byte-weight": { numericValue: 9_000_000 },
    "network-requests": { details: { items: [
      { url: "http://127.0.0.1:1/", finished: true, statusCode: 200 },
      { url: "http://127.0.0.1:1/occt-gz.wasm", finished: true, statusCode: 200 },
    ] } },
    ...over,
  },
});

test("median takes the middle run, and the mean of the middle two for an even count", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.deepEqual(medians([{ lcp: 1, tbt: 9, cls: 0, bytes: 5 }, { lcp: 3, tbt: 1, cls: 0.2, bytes: 5 }, { lcp: 2, tbt: 5, cls: 0.1, bytes: 7 }]), { lcp: 2, tbt: 5, cls: 0.1, bytes: 5 });
});

test("the committed budget has the agreed rules", () => {
  assert.deepEqual(Object.keys(budget.rules), ["lcp", "tbt", "cls", "bytes"]);
  assert.equal(limitFor(budget.rules.lcp, 3000), 3600); // 20 percent beats the 300 ms floor
  assert.equal(limitFor(budget.rules.lcp, 1000), 1300); // the floor beats 20 percent
  assert.equal(limitFor(budget.rules.tbt, 200), 300);
  assert.equal(limitFor(budget.rules.tbt, 1000), 1200);
  assert.equal(limitFor(budget.rules.cls, 0), 0.02);
  assert.ok(Math.abs(limitFor(budget.rules.cls, 0.1) - 0.12) < 1e-9);
  assert.equal(limitFor(budget.rules.bytes, 10_000_000), 10_500_000);
});

test("a value exactly at the limit passes, one step over fails", () => {
  const at = { lcp: 3600, tbt: 600, cls: 0.12, bytes: 10_500_000 };
  assert.equal(compare({ budget: withBaseline(base), measured: { ...at, cls: 0.12 }, lighthouseVersion: "13.5.0" }).rows.some((r) => r.metric !== "cls" && r.over), false);
  for (const m of ["lcp", "tbt", "bytes"]) {
    const v = compare({ budget: withBaseline(base), measured: { ...at, [m]: at[m] + 1 }, lighthouseVersion: "13.5.0" });
    assert.equal(v.failed, true, m);
    assert.deepEqual(v.rows.filter((r) => r.over).map((r) => r.metric), [m]);
  }
  assert.equal(compare({ budget: withBaseline(base), measured: { ...at, cls: 0.1201 }, lighthouseVersion: "13.5.0" }).failed, true);
});

test("a faster or smaller page passes", () => {
  assert.equal(compare({ budget: withBaseline(base), measured: { lcp: 1000, tbt: 0, cls: 0, bytes: 5_000_000 }, lighthouseVersion: "13.5.0" }).failed, false);
});

test("with no baseline nothing fails and the table says so", () => {
  const v = compare({ budget, measured: { lcp: 9e9, tbt: 9e9, cls: 9, bytes: 9e9 }, lighthouseVersion: "13.5.0" });
  assert.equal(v.failed, false);
  assert.match(table(v.rows), /no baseline/);
});

test("a baseline from another Lighthouse version fails and asks for a new one", () => {
  const v = compare({ budget: withBaseline(base, "13.4.0"), measured: base, lighthouseVersion: "13.5.0" });
  assert.equal(v.failed, true);
  assert.match(v.invalid[0], /13\.4\.0.*13\.5\.0.*new baseline/);
});

test("a metric that was not measured fails", () => {
  const v = compare({ budget: withBaseline(base), measured: { lcp: 1, tbt: 1, cls: 0 }, lighthouseVersion: "13.5.0" });
  assert.equal(v.failed, true);
  assert.match(v.invalid[0], /bytes was not measured/);
  assert.equal(compare({ budget: withBaseline(base), measured: undefined, lighthouseVersion: "13.5.0" }).failed, true);
});

test("a good result reads clean", () => {
  const r = readRun(lhr());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.metrics, { lcp: 2500, tbt: 300, cls: 0.05, bytes: 9_000_000 });
});

test("the largest-paint element is named when Lighthouse reports it", () => {
  const insight = { "lcp-breakdown-insight": { details: { items: [{ type: "table" }, { type: "node", selector: "body > div#loading > h1" }] } } };
  assert.equal(readRun(lhr(insight)).lcpElement, "body > div#loading > h1");
  assert.equal(readRun(lhr()).lcpElement, "");
});

test("a result with a missing, negative or non-numeric metric is refused", () => {
  assert.match(readRun(lhr({ "total-blocking-time": {} })).problems.join(), /total-blocking-time/);
  assert.match(readRun(lhr({ "largest-contentful-paint": { numericValue: -1 } })).problems.join(), /largest-contentful-paint/);
  assert.match(readRun(lhr({ "cumulative-layout-shift": { numericValue: NaN } })).problems.join(), /cumulative-layout-shift/);
  assert.ok(readRun({}).problems.length >= 4);
  assert.match(readRun({ ...lhr(), runtimeError: { message: "no paint" } }).problems.join(), /no paint/);
});

test("the byte count is refused unless the engine download finished", () => {
  const items = (list) => ({ "network-requests": { details: { items: list } } });
  assert.match(readRun(lhr(items([{ url: "http://x/", finished: true, statusCode: 200 }]))).problems.join(), /\.wasm.*missing/);
  assert.match(readRun(lhr(items([{ url: "http://x/occt-gz.wasm", finished: false, statusCode: -1 }]))).problems.join(), /did not finish/);
  assert.match(readRun(lhr(items([{ url: "http://x/occt-gz.wasm", finished: true, statusCode: 200 }, { url: "http://x/a.js", finished: true, statusCode: 404 }]))).problems.join(), /1 request\(s\) failed.*a\.js/);
});
