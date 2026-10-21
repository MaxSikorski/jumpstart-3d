#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename, unlink, stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { JudgeError, loadFixture, selectCases, plannedRow, sha256, updateSummary, formatReport, exitCode } from "../test/bench/score.mjs";
import { CHROMIUM_ARGS, driveCase, limitsFor, redact } from "../test/bench/driver.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const HELP = `Chat geometry benchmark: local Ollama only, one attempt per case.
Usage: npm run bench:chat -- [--build site|single|both] [--model TAG] [--cases J3-001,J3-003] [--help]
Defaults: site, qwen3:14b, all 50 cases. Both runs site then single.
JS3D_BENCH_URL defaults to http://127.0.0.1:11434; HTTP loopback only.
Reports: chat-bench-results/. Subsets always show coverage out of 50.
Exit: 0 fully measured (any pass rate), 2 setup/measurement/partial/write failure, 130 interrupted.
Install/start Ollama and pull the model yourself; see test/README.md for browser CORS setup.
`;

export function parseArgs(args) {
  const options = { build: "site", model: "qwen3:14b" }, used = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--build", "--model", "--cases", "--help"].includes(flag) || used.has(flag)) throw new JudgeError(`chat judge: unknown option "${flag}"`);
    used.add(flag);
    if (flag === "--help") { options.help = true; continue; }
    const value = args[i + 1]?.startsWith("--") ? undefined : args[++i];
    if (flag === "--build") {
      if (!["site", "single", "both"].includes(value)) throw new JudgeError("chat judge: build must be site, single or both");
      options.build = value;
    } else if (flag === "--model") {
      if (typeof value !== "string" || !value.trim()) throw new JudgeError("chat judge: model must be a non-empty Ollama tag");
      options.model = value.trim();
    } else {
      if (!value) throw new JudgeError("chat judge: cases must be unique known IDs");
      options.cases = value;
    }
  }
  return options;
}

export function ollamaURL(value = "http://127.0.0.1:11434") {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error();
    // URL normalisation must not admit alternate IP spellings or hidden paths.
    if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(value)) throw new Error();
    return u.origin;
  } catch { throw new JudgeError("chat judge: Ollama URL must be an HTTP loopback address"); }
}

export async function preflight(url, model, { signal, timeoutMs = 5000 } = {}) {
  url = ollamaURL(url);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  let version, tags;
  try {
    [version, tags] = await Promise.all(["/api/version", "/api/tags"].map(async (path) => {
      const response = await fetch(url + path, { signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new Error();
      try { return await response.json(); } catch { throw new JudgeError("chat judge: Ollama metadata is incomplete"); }
    }));
  } catch (e) {
    controller.abort();
    if (e instanceof JudgeError) throw e;
    throw new JudgeError("chat judge: could not reach Ollama within 5 s; start Ollama and retry");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  if (typeof version?.version !== "string" || !version.version.trim() || !Array.isArray(tags?.models)) throw new JudgeError("chat judge: Ollama metadata is incomplete");
  const installed = tags.models.find((m) => m.name === model);
  if (!installed) throw new JudgeError(`chat judge: Ollama model "${model}" is not installed; pull it before running`);
  if (typeof installed.digest !== "string" || !/^(?:sha256:)?[0-9a-f]{64}$/i.test(installed.digest)) throw new JudgeError("chat judge: Ollama metadata is incomplete");
  return { ollamaVersion: version.version, modelDigest: installed.digest };
}

export function createReport({ mode, build, model, fixture, selected, casesSha256, limits = limitsFor(mode) }) {
  return updateSummary({ version: 1, mode, build, startedAt: new Date().toISOString(), finishedAt: null, complete: false, runError: null,
    provider: "ollama", model: mode === "mock" ? "mock-tools" : model, modelDigest: null, ollamaVersion: null,
    appVersion: null, bridgeVersion: null, buildSha256: null, casesSha256, systemSha256: null, toolsSha256: null, toolCount: null,
    scripts: false, vision: false, meshDetail: "normal", limits, tolerance: fixture.tolerance, tokenUsage: "not_collected",
    coverage: { selected: selected.length, total: 50 }, summary: null, cases: selected.map(plannedRow) });
}

export async function reportDirectory(report, root = join(ROOT, "chat-bench-results"), now = Date.now()) {
  try {
    await mkdir(root, { recursive: true });
    for (let i = 0; ; i++) {
      const stamp = new Date(now + i).toISOString().replace(/[-:.]/g, "");
      const dir = join(root, `${stamp}-${process.pid}-${report.mode}-${report.build}`);
      try { await mkdir(dir); return dir; } catch (e) { if (e.code !== "EEXIST") throw e; }
    }
  } catch (e) { throw new JudgeError(`chat judge: could not write report: ${redact(e.message)}`); }
}

export async function persistReport(dir, report) {
  updateSummary(report);
  for (const [name, content] of [["score.json", JSON.stringify(report, null, 2) + "\n"], ["score.md", formatReport(report)]]) {
    const temp = join(dir, `.${name}-${randomUUID()}.tmp`);
    try { await writeFile(temp, content, { flag: "wx" }); await rename(temp, join(dir, name)); }
    catch (e) { await unlink(temp).catch(() => {}); throw new JudgeError(`chat judge: could not write report: ${redact(e.message)}`); }
  }
}

export async function buildHash(build) {
  const file = build === "site" ? "docs/app.js" : "dist/jumpstart-3d.html";
  try { return sha256(await readFile(join(ROOT, file))); }
  catch { throw new JudgeError(`chat judge: ${file} is missing; run node build.mjs first`); }
}

export async function startServer(directory = join(ROOT, "docs")) {
  const base = await realpath(directory);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
  const server = createServer(async (req, res) => {
    try {
      let path = resolve(base, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
      if (path !== base && !path.startsWith(base + sep)) throw new Error();
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
      path = await realpath(path);
      if (!path.startsWith(base + sep)) throw new Error();
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
      createReadStream(path).on("error", () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

export async function runCases({ report, dir, fixture, selected, browser, url, providerUrl, signal, beforeCase = () => {}, onResult = () => {}, driver = driveCase }) {
  await persistReport(dir, report);
  for (let i = 0; i < selected.length; i++) {
    if (signal?.aborted) break;
    await beforeCase(selected[i]);
    const result = await driver({ browser, url, build: report.build, fixture, case: selected[i], providerUrl,
      model: report.model, mode: report.mode, limits: report.limits, signal });
    report.cases[i] = result.row;
    for (const [key, value] of Object.entries(result.metadata)) if (report[key] == null) report[key] = value;
    await persistReport(dir, report);
    await onResult(result, selected[i]);
  }
  if (signal?.aborted) {
    const message = signal.reason?.message || "chat judge: interrupted before case ran";
    report.runError = { message, detail: null };
    for (const row of report.cases) if (row.status === "not_run") row.messages = [message];
  }
  report.finishedAt = new Date().toISOString();
  await persistReport(dir, report);
  return report;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  let browser, server, timer, activeReport, interrupted = false;
  const controller = new AbortController(), reports = [];
  const interrupt = () => { interrupted = true; controller.abort(new JudgeError("chat judge: interrupted before case ran")); };
  process.on("SIGINT", interrupt);
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(HELP); return 0; }
    const { fixture, casesSha256 } = await loadFixture(), selected = selectCases(fixture, options.cases);
    const builds = options.build === "both" ? ["site", "single"] : [options.build];
    timer = setTimeout(() => controller.abort(new JudgeError("chat judge: run exceeded 60 minutes")), limitsFor("ollama").runMs);
    for (const build of builds) {
      const report = createReport({ mode: "ollama", build, model: options.model, fixture, selected, casesSha256 });
      const dir = await reportDirectory(report);
      reports.push({ report, dir });
      await persistReport(dir, report);
    }
    const providerUrl = ollamaURL(env.JS3D_BENCH_URL);
    for (const { report } of reports) report.buildSha256 = await buildHash(report.build);
    const metadata = await preflight(providerUrl, options.model, { signal: controller.signal });
    for (const { report, dir } of reports) { Object.assign(report, metadata); await persistReport(dir, report); }
    server = await startServer();
    // Playwright's own SIGINT handler would exit before main() records the case in flight and prints the table.
    browser = await chromium.launch({ args: CHROMIUM_ARGS, handleSIGINT: false });
    for (const { report, dir } of reports) {
      activeReport = report;
      const url = report.build === "site" ? server.url : pathToFileURL(join(ROOT, "dist/jumpstart-3d.html")).href;
      await runCases({ report, dir, fixture, selected, browser, url, providerUrl, signal: controller.signal });
      console.log(formatReport(report)); console.log(`Report: ${dir}`);
      activeReport = null;
    }
    return interrupted ? 130 : Math.max(...reports.map(({ report }) => exitCode(report)));
  } catch (e) {
    const message = controller.signal.aborted ? controller.signal.reason.message : e instanceof JudgeError ? e.message : "chat judge: page failed";
    console.error(message);
    for (const { report, dir } of reports) {
      if (report.finishedAt && report !== activeReport) continue;
      report.runError = { message, detail: e instanceof JudgeError ? e.detail : redact(e.message) };
      report.finishedAt = new Date().toISOString();
      if (controller.signal.aborted) for (const row of report.cases) if (row.status === "not_run") row.messages = [message];
      try { await persistReport(dir, report); } catch (writeError) { console.error(writeError.message); }
      console.log(formatReport(report)); console.log(`Report: ${dir}`);
    }
    return interrupted ? 130 : 2;
  } finally {
    clearTimeout(timer); process.removeListener("SIGINT", interrupt);
    if (browser) await browser.close();
    if (server) await server.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
