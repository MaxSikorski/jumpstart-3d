import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMock } from "./mockmodel.mjs";
import { loadFixture, selectCases, formatReport, sha256 } from "./bench/score.mjs";
import { driveCase, limitsFor } from "./bench/driver.mjs";
import { mockPlans } from "./bench/mock-plans.mjs";
import { createReport, reportDirectory, persistReport, buildHash, runCases } from "../tools/chat-bench.mjs";

// Other specs may run between builds; only this spec consumes the shared mock wall budget.
// The runner process creates the clock file (workers inherit the variable) and removes it when the whole run ends.
if (!process.env.JS3D_CHAT_JUDGE_CLOCK) {
  process.env.JS3D_CHAT_JUDGE_CLOCK = join(tmpdir(), `js3d-chat-judge-${randomUUID()}.json`);
  process.once("exit", () => rmSync(process.env.JS3D_CHAT_JUDGE_CLOCK, { force: true }));
}
const clockPath = process.env.JS3D_CHAT_JUDGE_CLOCK;
const { fixture, casesSha256 } = await loadFixture();
const ciCases = selectCases(fixture, Object.keys(mockPlans));
let mock;
test.beforeAll(async () => { mock = await startMock(); });
test.afterAll(async () => { await mock.close(); });
test.setTimeout(150000);

async function wallLimit() {
  let used = 0;
  try { used = JSON.parse(await readFile(clockPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const started = Date.now(), runEnd = started + limitsFor("mock").runMs - used;
  const controller = new AbortController();
  const expire = () => controller.abort(new Error("chat judge: run exceeded 8 minutes"));
  const timer = setTimeout(expire, Math.max(1, runEnd - Date.now()));
  if (Date.now() >= runEnd) expire();
  return { signal: controller.signal, clear: async () => { clearTimeout(timer); await writeFile(clockPath, JSON.stringify(used + Date.now() - started)); } };
}
async function run(browser, info, id, plan, options = {}) {
  mock.reset(); mock.script = plan;
  const wall = await wallLimit();
  try {
    return await driveCase({ browser, url: info.project.use.baseURL, build: info.project.name, fixture,
      case: fixture.cases.find((c) => c.id === id), providerUrl: mock.url, signal: wall.signal, ...options });
  } finally { await wall.clear(); }
}
const box = () => ({ tool: "add_shape", args: { kind: "box", size: { w: 40, d: 30, h: 20 } } });
const end = () => [{ tool: "wait_ready", args: {} }, { text: "Done." }];
const idOf = (r) => typeof r === "string" ? r : r.id;

test("five independent mock panel cases produce a five-row scorer report", async ({ browser }, info) => {
  test.setTimeout(480000);
  const report = createReport({ mode: "mock", build: info.project.name, fixture, selected: ciCases, casesSha256 });
  const dir = await reportDirectory(report);
  await persistReport(dir, report);
  report.buildSha256 = await buildHash(info.project.name);
  const results = [], wall = await wallLimit();
  try {
    await runCases({ report, dir, fixture, selected: ciCases, browser, url: info.project.use.baseURL, providerUrl: mock.url, signal: wall.signal,
      beforeCase: (c) => { mock.reset(); mock.script = mockPlans[c.id](); },
      onResult: (result, c) => {
        const first = mock.requests[0]?.body, last = mock.requests.at(-1)?.body;
        results.push({ ...result, c, first, last, sent: [...mock.sent] });
      } });
  } finally { await wall.clear(); console.log(formatReport(report)); console.log(`Report: ${dir}`); }
  expect(report.complete).toBe(true);
  expect(report.summary).toEqual({ pass: 5, fail: 0, error: 0, notRun: 0, denominator: 5, percent: 100 });
  expect(report.coverage).toEqual({ selected: 5, total: 50 });
  for (const { row, metadata, evidence, c, first, last, sent } of results) {
    expect(row.status, JSON.stringify(row)).toBe("pass");
    expect(row.metrics).toEqual({ body: true, volume: true, bbox: true, holes: true });
    expect(row.toolErrors).toEqual([]); expect(evidence.consoleErrors).toEqual([]); expect(evidence.userRows).toBe(1);
    expect(row.observed.topology.components).toBe(1);
    expect(row.observed.topology.chi).toBe(2 - 2 * c.expected.holes);
    expect(first.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(first.messages[1].content).toBe(fixture.preamble + "\n" + c.request);
    expect(first.tools.map((t) => t.function.name)).not.toContain("run_script");
    expect(first.options).toEqual({ num_ctx: 32768 }); expect(first.stream).toBe(false);
    expect(last.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const calls = sent.flatMap((m) => m.tool_calls || []).map((c) => c.function.name);
    expect(evidence.toolNames).toEqual(calls); expect(calls.at(-1)).toBe("wait_ready");
    expect(row.toolCalls).toBe(calls.length); expect(row.providerRequests).toBe(calls.length + 1);
    expect(last.messages.filter((m) => m.role === "tool").map((m) => m.tool_name)).toEqual(calls);
    expect(metadata.systemSha256).toBe(sha256(first.messages[0].content));
    expect(metadata.toolsSha256).toBe(sha256(JSON.stringify(first.tools)));
    expect(metadata.toolCount).toBe(first.tools.length);
  }
});

test("a final Done without tools cannot pass", async ({ browser }, info) => {
  const { row } = await run(browser, info, "J3-001", [{ text: "Done." }]);
  expect(row.status).toBe("fail"); expect(row.metrics.body).toBe(false); expect(row.observed.bodies).toBe(0);
  expect(row.metrics.volume).toBe(null); expect(row.messages).toEqual(["expected one visible solid and no spare bodies"]);
});
for (const extra of ["hidden", "cutter"]) test(`an extra ${extra} body is counted`, async ({ browser }, info) => {
  const plan = [box(), { tool: "add_shape", args: { kind: "box", size: { w: 2, d: 2, h: 2 }, at: [60, 0, 0], hole: extra === "cutter" } }];
  if (extra === "hidden") plan.push((_req, results) => ({ tool: "set_hidden", args: { ids: [idOf(results[1])], hidden: true } }));
  const { row } = await run(browser, info, "J3-001", [...plan, ...end()]);
  expect(row.status, JSON.stringify(row)).toBe("fail"); expect(row.observed.bodies).toBe(2); expect(row.metrics.body).toBe(false);
});
test("equal-volume one-bore plate fails only the two-hole metric", async ({ browser }, info) => {
  const { row } = await run(browser, info, "J3-005", [
    { tool: "add_shape", args: { kind: "box", size: { w: 60, d: 40, h: 5 } } },
    (_req, results) => ({ tool: "add_hole_pattern", args: { body: idOf(results[0]), face: "+z", layout: "grid", cols: 1, rows: 1, dia: 8 * Math.SQRT2 } }), ...end(),
  ]);
  expect(row.status, JSON.stringify(row)).toBe("fail");
  expect(row.metrics).toEqual({ body: true, volume: true, bbox: true, holes: false });
  expect(row.messages).toEqual(["expected 2 through holes, got 1"]);
});
test("a 0.2 mm shift fails only world bounds", async ({ browser }, info) => {
  const shape = box(); shape.args.at = [0.2, 0, 0];
  const { row } = await run(browser, info, "J3-001", [shape, ...end()]);
  expect(row.status).toBe("fail"); expect(row.metrics).toEqual({ body: true, volume: true, bbox: false, holes: true });
  expect(row.messages).toEqual(["bbox min.x differs by 0.200000 mm (allowed 0.1)", "bbox max.x differs by 0.200000 mm (allowed 0.1)"]);
});
test("a deadline closes the context before a fresh good conversation", async ({ browser }, info) => {
  const before = browser.contexts().length;
  const timed = await run(browser, info, "J3-001", [{ ...box(), delayMs: 2000 }, ...end()], { limits: { caseMs: 300 } });
  expect(timed.row.status).toBe("error"); expect(timed.row.messages).toContain("chat judge: J3-001 exceeded 0.3 s");
  expect(timed.row.toolCalls).toBe(0); expect(browser.contexts()).toHaveLength(before);
  const good = await run(browser, info, "J3-001", mockPlans["J3-001"]());
  expect(good.row.status, JSON.stringify(good.row)).toBe("pass"); expect(good.evidence.userRows).toBe(1);
  expect(mock.requests).toHaveLength(3); expect(mock.requests[0].body.messages.map(m => m.role)).toEqual(["system", "user"]);
  expect(good.row.observed.bodies).toBe(1); expect(good.row.toolCalls).toBe(2); expect(browser.contexts()).toHaveLength(before);
});
test("HTTP failure is a terminal chat error", async ({ browser }, info) => {
  const { row, evidence } = await run(browser, info, "J3-001", [], { allowConsoleError: (msg) =>
    msg.location().url === mock.url + "/api/chat" && /^Failed to load resource: the server responded with a status of 500/.test(msg.text()) });
  expect(row.status).toBe("error"); expect(row.messages).toContain("chat judge: chat did not finish normally");
  expect(row.messages).toContainEqual({ detail: "500 script exhausted" }); expect(evidence.consoleErrors).toEqual([]);
});
test("empty model reply is an error", async ({ browser }, info) => {
  const { row } = await run(browser, info, "J3-001", [{ text: "" }]);
  expect(row.status).toBe("error"); expect(row.messages).toContain("chat judge: chat did not finish normally");
  expect(row.messages).toContainEqual({ detail: "The model gave no answer." });
});
test("the app's 30-tool stop is an error", async ({ browser }, info) => {
  const { row } = await run(browser, info, "J3-001", Array.from({ length: 40 }, () => ({ tool: "fit_view", args: {} })));
  expect(row.status).toBe("error"); expect(row.toolCalls).toBe(30); expect(row.providerRequests).toBeLessThanOrEqual(31);
  expect(row.messages).toContain("chat judge: chat did not finish normally");
  expect(row.messages).toContainEqual({ detail: "Stopped after 30 tool calls. Send another message to continue." });
});
test("recoverable tool errors are separate from terminal errors", async ({ browser }, info) => {
  const { row } = await run(browser, info, "J3-001", [{ tool: "get_body", args: { id: "missing" } }, ...mockPlans["J3-001"]()]);
  expect(row.status, JSON.stringify(row)).toBe("pass"); expect(row.toolErrors).toHaveLength(1); expect(row.toolErrors[0].tool).toBe("get_body");expect(row.messages).toEqual([]);
});
test("provider deadline and request cap abort the case", async ({ browser }, info) => {
  const slow = await run(browser, info, "J3-001", [{ text: "Done.", delayMs: 2000 }], { limits: { providerMs: 100 } });
  expect(slow.row.status).toBe("error"); expect(slow.row.messages).toContain("chat judge: provider request exceeded 120 s");
  const capped = await run(browser, info, "J3-001", mockPlans["J3-001"](), { limits: { providerRequests: 1 } });
  expect(capped.row.status).toBe("error"); expect(capped.row.messages).toContain("chat judge: exceeded 31 provider requests");
});
