// Nightly loading check: Lighthouse (mobile preset, simulated slow phone network) on the built site, compared with a committed baseline.
//   node build.mjs && node tools/lighthouse.mjs [--dir docs] [--runs 3] [--out lighthouse-report]
//   node tools/lighthouse.mjs --record                 run, then write the medians into lighthouse-budget.json as the baseline
//   node tools/lighthouse.mjs --record-from a.json b.json ...   write the median of those runs' summary.json files (no run)
// It builds nothing. Each run starts a fresh Chromium (Playwright's binary) with a new profile and loads the page once, cold, from
// tools/pages-server.mjs (gzip, ETags, service worker allowed). Exit 1 only when a measurement is invalid or a median is over its limit;
// with no baseline yet it prints the numbers and exits 0. Limit = baseline + max(percent of baseline, floor), see lighthouse-budget.json.
// The numbers are for catching a page that got slower, not absolute truth: the load runs on this machine and Lighthouse then simulates the slow network.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const METRICS = ["lcp", "tbt", "cls", "bytes"];
const BUDGET_FILE = fileURLToPath(new URL("../lighthouse-budget.json", import.meta.url));

export function median(values) {
  const a = [...values].sort((x, y) => x - y), mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function limitFor(rule, baseline) {
  return baseline + Math.max((baseline * rule.percent) / 100, rule.floor);
}

// The four numbers from one Lighthouse result, or the reasons it cannot be trusted.
export function readRun(lhr) {
  const problems = [];
  const audit = (id) => lhr?.audits?.[id];
  const num = (id) => {
    const v = audit(id)?.numericValue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) problems.push(`no valid value for ${id}`);
    return v;
  };
  if (lhr?.runtimeError) problems.push(`Lighthouse stopped: ${lhr.runtimeError.message || lhr.runtimeError.code}`);
  const metrics = { lcp: num("largest-contentful-paint"), tbt: num("total-blocking-time"), cls: num("cumulative-layout-shift"), bytes: num("total-byte-weight") };
  // the engine downloads in a worker: the byte count is only complete when that request is in the list and finished
  const requests = audit("network-requests")?.details?.items ?? [];
  const wasm = requests.find((r) => /\.wasm(\?|$)/.test(r.url));
  if (!wasm) problems.push("the engine download (.wasm) is missing from the request list");
  else if (!wasm.finished || wasm.statusCode !== 200) problems.push(`the engine download did not finish (status ${wasm.statusCode})`);
  const failed = requests.filter((r) => !r.finished || r.statusCode >= 400);
  if (failed.length) problems.push(`${failed.length} request(s) failed, first: ${failed[0].url}`);
  const lcpNode = audit("largest-contentful-paint-element")?.details?.items?.[0]?.items?.[0]?.node;
  return { metrics, problems, lcpElement: lcpNode?.snippet || lcpNode?.nodeLabel || "" };
}

export function medians(runs) {
  return Object.fromEntries(METRICS.map((m) => [m, median(runs.map((r) => r[m]))]));
}

// budget: the parsed lighthouse-budget.json; measured: medians; lighthouseVersion: the installed one.
// Returns { rows, invalid: [reasons], failed: bool }. No baseline: rows carry no limit and nothing fails.
export function compare({ budget, measured, lighthouseVersion }) {
  const invalid = [];
  for (const m of METRICS) if (typeof measured?.[m] !== "number" || !Number.isFinite(measured[m])) invalid.push(`${m} was not measured`);
  const base = budget.baseline;
  if (base && base.lighthouse !== lighthouseVersion) {
    invalid.push(`the baseline was recorded with Lighthouse ${base.lighthouse} but ${lighthouseVersion} is installed: record a new baseline (reviewed) before comparing`);
  }
  const rows = METRICS.map((m) => {
    const rule = budget.rules[m], value = measured?.[m];
    const b = base?.values?.[m];
    if (typeof b !== "number" || invalid.length) return { metric: m, rule, value, baseline: b, limit: undefined, over: false };
    const limit = limitFor(rule, b);
    return { metric: m, rule, value, baseline: b, limit, over: value > limit };
  });
  return { rows, invalid, failed: invalid.length > 0 || rows.some((r) => r.over) };
}

const fmt = (m, v) => (v === undefined ? "none yet" : m === "cls" ? v.toFixed(3) : m === "bytes" ? Math.round(v).toLocaleString("en-US") : `${Math.round(v)} ms`);

export function table(rows) {
  const lines = ["| Measure | This run (median) | Baseline | Limit | Result |", "|---|---|---|---|---|"];
  for (const r of rows) {
    const result = r.limit === undefined ? "no baseline" : r.over ? "TOO SLOW" : "ok";
    lines.push(`| ${r.rule.label} | ${fmt(r.metric, r.value)} | ${fmt(r.metric, r.baseline)} | ${fmt(r.metric, r.limit)} | ${result} |`);
  }
  return lines.join("\n");
}

function args(argv) {
  const o = { dir: "docs", runs: undefined, out: "lighthouse-report", record: false, recordFrom: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") o.dir = argv[++i];
    else if (a === "--runs") o.runs = +argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--record") o.record = true;
    else if (a === "--record-from") { while (argv[i + 1] && !argv[i + 1].startsWith("--")) o.recordFrom.push(argv[++i]); }
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

function writeBaseline(budget, values, details) {
  budget.baseline = { lighthouse: details.lighthouse, chromium: details.chromium, runs: details.runs, recordedOn: details.recordedOn, values };
  writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + "\n");
  console.log(`Baseline written to lighthouse-budget.json:\n${JSON.stringify(values)}`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  const require = createRequire(import.meta.url);
  const lighthouseVersion = require("lighthouse/package.json").version;

  if (opts.recordFrom.length) {
    const sums = opts.recordFrom.map((f) => JSON.parse(readFileSync(f, "utf8")));
    const bad = sums.find((s) => s.lighthouse !== lighthouseVersion);
    if (bad) throw new Error(`a summary was made with Lighthouse ${bad.lighthouse}, installed is ${lighthouseVersion}`);
    writeBaseline(budget, medians(sums.map((s) => s.medians)), { lighthouse: lighthouseVersion, chromium: sums[0].chromium, runs: sums.length * sums[0].runs, recordedOn: sums[0].platform });
    return;
  }

  const runsWanted = opts.runs || budget.runs;
  const [{ default: lighthouse }, { chromium }, { startServer }, { createServer }] = await Promise.all([
    import("lighthouse"), import("@playwright/test"), import("./pages-server.mjs"), import("node:net"),
  ]);
  const { origin, close: closeServer } = await startServer(resolve(opts.dir));
  mkdirSync(opts.out, { recursive: true });
  const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

  const runs = [], problems = [];
  let chromiumVersion = "", lcpElement = "";
  try {
    for (let i = 1; i <= runsWanted; i++) {
      const port = await freePort();
      const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`, "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
      chromiumVersion = browser.version();
      try {
        const result = await lighthouse(origin + "/", { port, output: ["json", "html"], onlyCategories: ["performance"], logLevel: "error" });
        writeFileSync(`${opts.out}/run-${i}.json`, result.report[0]);
        writeFileSync(`${opts.out}/run-${i}.html`, result.report[1]);
        const r = readRun(result.lhr);
        runs.push(r.metrics);
        lcpElement ||= r.lcpElement;
        problems.push(...r.problems.map((p) => `run ${i}: ${p}`));
        console.log(`run ${i}: ${JSON.stringify(r.metrics, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v))}`);
      } catch (e) {
        problems.push(`run ${i}: ${e.message}`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    closeServer();
  }

  const measured = runs.length ? medians(runs) : undefined;
  const platform = `${process.platform} ${process.arch}`;
  const settings = "Lighthouse mobile preset, simulated throttling (about 1.6 Mbit/s, 150 ms, 4x slower CPU), cold load";
  const verdict = compare({ budget, measured, lighthouseVersion });
  const issues = [...problems, ...(runs.length ? verdict.invalid : [])];
  const summary = { lighthouse: lighthouseVersion, chromium: chromiumVersion, platform, runs: runsWanted, medians: measured, lcpElement, problems: issues };
  writeFileSync(`${opts.out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");

  const text = [
    `Lighthouse ${lighthouseVersion}, Chromium ${chromiumVersion}, ${platform}, ${runsWanted} runs, median. ${settings}.`,
    lcpElement ? `LCP element: ${lcpElement}` : "",
    "", table(verdict.rows), "",
    budget.baseline ? `Baseline recorded with Lighthouse ${budget.baseline.lighthouse} on ${budget.baseline.recordedOn}.` : "No baseline committed yet: report only, nothing can fail on the numbers. Record one from CI (see test/README.md).",
    ...issues.map((p) => `PROBLEM: ${p}`),
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  writeFileSync(`${opts.out}/summary.md`, text + "\n");
  console.log("\n" + text);

  if (opts.record) {
    if (issues.length) throw new Error("not recording a baseline from an invalid measurement");
    writeBaseline(budget, measured, { lighthouse: lighthouseVersion, chromium: chromiumVersion, runs: runsWanted, recordedOn: platform });
    return;
  }
  if (issues.length || verdict.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
