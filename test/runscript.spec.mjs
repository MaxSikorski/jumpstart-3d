// Run script… tests: the Open/Export menu entry picks a .js file and runs it with JS3D in scope, on both builds.
// Files are handed to the hidden input the way a user's picker would, so no console is involved.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim } from "./helpers.mjs";

const BOX_WITH_HOLE = 40 * 30 * 20 - Math.PI * 4 * 4 * 20; // what tools/bridge-demo.js builds
const script = (name, text) => ({ name, mimeType: "text/javascript", buffer: Buffer.from(text) });

// one page for the whole file: the kernel loads once
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    // record every toast as it appears: toasts vanish after a few seconds, so the tests read this list
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (file) => page.setInputFiles("#file-script", file);
// wait for a toast starting with the given text, and return it (the demo takes a few seconds: the kernel builds)
async function toast(prefix, timeout = 90_000) {
  await page.waitForFunction((p) => window.__toasts.some((t) => t.text.startsWith(p)), prefix, { timeout });
  return page.evaluate((p) => window.__toasts.find((t) => t.text.startsWith(p)), prefix);
}
const clearToasts = () => page.evaluate(() => { window.__toasts.length = 0; });
const history = () => page.evaluate(() => ({ doc: JSON.stringify(__store.doc), undo: __store.undoStack.length }));

test("the Open/Export menu has a Run script… entry and a hidden .js picker", async () => {
  await page.click("#btn-export");
  const entry = page.locator('#menu-export button[data-act="runscript"]');
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("Run script…");
  await page.click("#btn-export");
  await expect(page.locator("#menu-export")).toBeHidden();
  const input = page.locator("#file-script");
  await expect(input).toBeHidden();
  await expect(input).toHaveAttribute("type", "file");
  expect(await input.getAttribute("accept")).toContain(".js");
});

test("the demo script runs from a picked file and ends with one Block with hole", async () => {
  await clearToasts();
  await run(new URL("../tools/bridge-demo.js", import.meta.url).pathname);
  const t = await toast("Script finished");
  expect(t.err).toBe(false);
  expect(t.text).toContain('"volume":'); // the demo's summary, as one line of JSON
  expect(t.text).toContain('"sameShape":true');
  await waitIdle(page);
  const list = await bodies(page);
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe("Block with hole");
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(BOX_WITH_HOLE, 0);
});

test("a script that throws shows a red toast and leaves the design and its history alone", async () => {
  await loadDoc(page, newDoc("Keep", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] }));
  const before = await history();
  await clearToasts();
  await run(script("bad.js", 'await JS3D.ready();\nthrow new Error("boom at step 3");'));
  const t = await toast("Script failed");
  expect(t.err).toBe(true);
  expect(t.text).toContain("boom at step 3");
  expect(await history()).toEqual(before);
  expect(await page.evaluate(() => window.__toasts.some((t) => t.text.startsWith("Script finished")))).toBe(false);
});

test("a script that does not parse is reported, not run", async () => {
  const before = await history();
  await clearToasts();
  await run(script("broken.js", "this is not javascript {"));
  const t = await toast("Script failed");
  expect(t.err).toBe(true);
  expect(await history()).toEqual(before);
});

test("top-level await and a return value work, and the value shows in the toast", async () => {
  await page.evaluate(() => JS3D.newDesign("beginner"));
  const undoBefore = await page.evaluate(() => __store.undoStack.length);
  await clearToasts();
  await run(script("box.js", [
    'const id = JS3D.add("box", { size: { w: 10, d: 10, h: 10 }, name: "Ten" });',
    "await JS3D.ready();",
    "return { volume: Math.round(JS3D.get(id).volume), toast: typeof app.toast, bodies: JS3D.list().length };",
  ].join("\n")));
  const t = await toast("Script finished");
  expect(t.err).toBe(false);
  expect(t.text).toBe('Script finished: {"volume":1000,"toast":"function","bodies":1}');
  await waitIdle(page);
  const list = await bodies(page);
  expect(list.map((b) => b.name)).toEqual(["Ten"]);
  expect(await page.evaluate(() => __store.undoStack.length)).toBe(undoBefore + 1); // the script's one edit stays undoable
});
