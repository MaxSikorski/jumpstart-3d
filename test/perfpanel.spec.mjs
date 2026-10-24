// The hidden performance panel (src/perfpanel.js): Ctrl+Alt+P or ?perf opens it, it lists the last rebuild body by body, slowest first, with a Copy button.
// Closed, it adds nothing: no DOM, no style, and the kernel client carries no recorder until the panel has been opened once.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

let page, errors, copied;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { // the clipboard is a permission prompt in a test browser: record what Copy writes instead
    window.__copied = null;
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: async (s) => { window.__copied = s; } }, configurable: true }); } catch (e) { /* the app falls back to execCommand */ }
  });
  await page.addInitScript(() => { // as in watchdog.spec: hold every build back by perBody ms per body
    const W = window.Worker;
    window.__slow = null; window.__workers = 0;
    window.Worker = class extends W {
      constructor(...a) { super(...a); window.__workers++; }
      postMessage(m, t) {
        const s = window.__slow;
        if (s && s.hang && m && m.type === "build" && m.bodies.some((b) => JSON.stringify(b.node).includes(s.hang))) return; // never answered
        if (s && m && m.type === "build") setTimeout(() => super.postMessage(m, t), s.perBody * m.bodies.length);
        else super.postMessage(m, t);
      }
    };
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(async () => {
  await page.evaluate(() => { window.__slow = null; delete window.__app.kernel.watchdogMs; });
  expect(errors, "console or page errors").toEqual([]);
});

// five bodies with sizes no other test uses, so the first four go in one batch and the fifth in the next
const doc = () => newDoc("perf five", "beginner", {
  bodies: [
    body("p1", "Block", prim("box", { w: 31.1, d: 12, h: 8, r: 0, c: 0 })),
    body("p2", "Post", prim("cylinder", { w: 9.3, d: 9.3, h: 40 })),
    body("p3", "Ball", prim("sphere", { w: 23.7, d: 23.7, h: 23.7 })),
    body("p4", "Tall box", prim("box", { w: 7.7, d: 7.7, h: 51 })),
    body("p5", "Rounded", prim("box", { w: 17.9, d: 14, h: 6 }, [{ t: "fillet", r: 1.5, seq: 2, id: "f1", edges: [{ a: [-8.95, -7, 6], b: [-8.95, 7, 6], m: [-8.95, 0, 6], n: [-0.7, 0, 0.7], t: "LINE" }] }])),
  ],
});

const parse = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll("#perfpanel tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));
  return { rows, sum: document.querySelector("#perfpanel .pp-sum").textContent };
});

test("closed: no DOM, no style, no recorder", async () => {
  await loadDoc(page, doc());
  expect(await page.evaluate(() => ({ panel: !!document.getElementById("perfpanel"), kernel: !!window.__app.kernel.perf, hasOpen: typeof window.__app.perf.open }))).toEqual({ panel: false, kernel: false, hasOpen: "function" });
});

test("Ctrl+Alt+P opens it; Rebuild all lists one row per body, slowest first, with the total", async () => {
  await page.keyboard.press("Control+Alt+KeyP");
  await expect(page.locator("#perfpanel")).toBeVisible();
  await expect(page.locator("#perfpanel .pp-sum")).toContainText("No rebuild recorded yet");
  await page.click("#perfpanel [data-pp=rebuild]");
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(5, { timeout: 60_000 });
  const { rows, sum } = await parse();
  const ms = rows.map((r) => parseFloat(r[0].replace("~", "")));
  expect(ms.every((n) => n > 0)).toBe(true);
  expect([...ms].sort((a, b) => b - a)).toEqual(ms);
  expect(rows.map((r) => r[3]).sort()).toEqual(["Ball", "Block", "Post", "Rounded", "Tall box"]);
  expect(rows.every((r) => +r[2] > 0)).toBe(true);
  expect(rows.map((r) => +r[1]).sort()).toEqual([1, 1, 1, 1, 2]);
  expect(rows.find((r) => r[3] === "Rounded")[4]).toBe("Box, Fillet");
  const total = parseFloat(/Total ([\d.]+) ms/.exec(sum)[1]);
  expect(Math.abs(total - ms.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(0.05 * ms.length + 0.1);
  expect(sum).toContain("2 batches for 5 bodies");
});

test("Copy writes the same plain text the table shows", async () => {
  await page.click("#perfpanel [data-pp=copy]");
  const { text, copiedText, rows } = await page.evaluate(() => ({ text: window.__app.perf.text(), copiedText: window.__copied, rows: [...document.querySelectorAll("#perfpanel tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)) }));
  expect(copiedText).toBe(text);
  const lines = text.split("\n");
  expect(lines.length).toBe(3 + rows.length);
  rows.forEach((r, i) => expect(lines[3 + i]).toBe(`${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]}`));
});

test("Close removes the panel and its style", async () => {
  await page.click("#perfpanel [data-pp=close]");
  expect(await page.evaluate(() => ({ panel: !!document.getElementById("perfpanel"), style: [...document.head.querySelectorAll("style")].some((s) => s.textContent.includes("#perfpanel")) }))).toEqual({ panel: false, style: false });
  await page.keyboard.press("Control+Alt+KeyP");
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(5); // the last rebuild is kept while the page lives
  await page.keyboard.press("Control+Alt+KeyP");
  await expect(page.locator("#perfpanel")).toHaveCount(0);
});

test("?perf opens it on load and a design edit lands as the new last rebuild", async ({}, info) => {
  await page.goto(info.project.use.baseURL + "?perf");
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await expect(page.locator("#perfpanel")).toBeVisible();
  await page.waitForFunction(() => window.__app.projects.started === true, null, { timeout: 20_000 });
  await loadDoc(page, doc());
  await page.evaluate(() => JS3D.add("box", { size: [13.3, 14.4, 15.5] }));
  await page.evaluate(() => JS3D.ready());
  await expect.poll(() => page.evaluate(() => window.__app.perf.last && window.__app.perf.last.rows.length)).toBe(1);
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(1);
});

test("a stalled batch is dropped from the record, its bodies are retried alone and listed, and the app keeps building", async () => {
  const sizes = [[11.1, 12, 13], [14.2, 15, 16], [17.3, 18, 19], [20.4, 21, 22]];
  await page.evaluate(() => JS3D.newDesign("beginner"));
  await page.evaluate(() => { window.__slow = { perBody: 700 }; window.__app.kernel.watchdogMs = 1800; window.__before = window.__workers; }); // four bodies together take 2.8 s: over the limit; alone 0.7 s each
  await page.evaluate((sizes) => { for (const s of sizes) JS3D.add("box", { size: s }); }, sizes);
  const r = await page.evaluate(async () => { await JS3D.ready(); await new Promise((r) => setTimeout(r, 200)); return { list: JS3D.list(), restarts: window.__workers - window.__before, last: window.__app.perf.last }; });
  expect(r.restarts).toBe(1);
  expect(r.list.map((b) => b.error)).toEqual([null, null, null, null]);
  expect(r.last.rows).toHaveLength(4); // only the retried builds: the stalled batch left no rows
  expect(r.last.rows.every((x) => !x.error && x.ms > 0 && x.tris > 0)).toBe(true);
  expect(r.last.rows.map((x) => x.batch).sort(), "batch 1 is the first box, sent alone; batch 2 stalled and left no row; 3 to 5 are the retries").toEqual([1, 3, 4, 5]);
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(4);
  await page.evaluate(() => { window.__slow = null; delete window.__app.kernel.watchdogMs; });
  await page.evaluate(() => JS3D.add("box", { size: [23.5, 24.5, 25.5] }));
  await page.evaluate(() => JS3D.ready());
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(1);
});

test("a body that stalls alone gets an error row, and the next build still works", async () => {
  await page.evaluate(() => JS3D.newDesign("beginner"));
  await page.evaluate(() => { window.__slow = { perBody: 100, hang: "13.31" }; window.__app.kernel.watchdogMs = 1200; });
  await page.evaluate(() => JS3D.add("box", { size: [51.1, 12, 13.31] }));
  await page.evaluate(async () => { await JS3D.ready(); });
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(1);
  await expect(page.locator("#perfpanel tbody tr td").nth(2)).toContainText(/error: stalled after \d+ ms/);
  await expect(page.locator("#perfpanel .pp-sum")).not.toContainText("Rebuilding");
  expect(await page.evaluate(() => window.__app.perf.text())).toMatch(/error: stalled after \d+ ms/);
  await page.evaluate(() => { window.__slow = null; delete window.__app.kernel.watchdogMs; });
  await page.evaluate(() => JS3D.add("box", { size: [27.5, 28.5, 29.5] }));
  const list = await page.evaluate(async () => { await JS3D.ready(); return JS3D.list(); });
  expect(list.map((b) => !!b.error)).toEqual([true, false]);
  await expect(page.locator("#perfpanel tbody tr")).toHaveCount(1);
  await expect(page.locator("#perfpanel tbody tr td").nth(2)).not.toContainText("error");
});

test("Rebuild all on an empty design says there is nothing to build", async () => {
  await page.evaluate(() => JS3D.newDesign("beginner"));
  await page.click("#perfpanel [data-pp=rebuild]");
  await expect(page.locator("#perfpanel .pp-sum")).toHaveText(/Nothing to rebuild/);
});
