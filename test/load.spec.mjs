// Load tests: the workspace opens before the geometry engine is ready, the engine's note and its failure message,
// and the site working offline on a second visit through its service worker (src/loadui.js, src/sw.js).
// Case 1 runs on both builds; 2-4 need the engine as a separate download, so they run on the site only.
// The config blocks service workers for every other spec; case 4 allows one in its own context.
// The offline case does not assert on requestfailed: Chromium reports a worker request answered by the service worker a second time as a failed network leg.
import { test, expect } from "@playwright/test";
import { serve } from "../mcp/serve.mjs";
import { watchErrors } from "./helpers.mjs";

const NOT_SINGLE = "the single file embeds the engine";
const meshes = (page) => page.evaluate(() => window.__app.scene.meshes().length);

test("the engine note and the splash are gone once the kernel is ready", async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto(info.project.use.baseURL);
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await expect(page.locator("#engine")).toBeHidden();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
  expect(await page.evaluate(() => window.__app.kernel.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test("the workspace works while the engine downloads; shapes appear when it is ready", async ({ page }, info) => {
  test.skip(info.project.name !== "site", NOT_SINGLE);
  const errors = watchErrors(page);
  let open;
  const gate = new Promise((r) => { open = r; });
  await page.route("**/occt-gz.wasm", async (r) => { await gate; await r.continue(); });
  try {
    await page.goto(info.project.use.baseURL);
    await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
    expect(await page.evaluate(() => window.__app.kernel.ready)).toBe(false);
    await expect(page.locator("#engine")).toBeVisible();
    await expect(page.locator("#engine")).toContainText("Loading the geometry engine");
    await page.click("#mode-advanced");
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "advanced");
    await page.click("#mode-beginner");
    await expect(page.locator("#app")).toHaveAttribute("data-mode", "beginner");
    await page.evaluate(() => JS3D.add("box"));
    expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
    expect(await meshes(page)).toBe(0);
  } finally {
    open(); // always let the download go, so a failed assert does not leave the route hanging
  }
  await page.evaluate(() => JS3D.ready());
  expect(await meshes(page)).toBe(1);
  await expect(page.locator("#engine")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a failed engine download says so and leaves the workspace usable", async ({ page }, info) => {
  test.skip(info.project.name !== "site", NOT_SINGLE);
  watchErrors(page); // the 404 and the engine's error are expected here
  await page.route("**/occt-gz.wasm", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto(info.project.use.baseURL);
  await expect(page.locator(".toast.err")).toContainText("couldn't start", { timeout: 20_000 }); // lasts about 5 s
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("#engine.err")).toContainText("couldn't start");
  await expect(page.locator("#engine.err")).toContainText("(404)");
  await page.click("#mode-advanced");
  await expect(page.locator("#app")).toHaveAttribute("data-mode", "advanced");
});

test("a second visit loads from the service worker and works offline", async ({ browser }, info) => {
  test.skip(info.project.name !== "site", NOT_SINGLE);
  test.setTimeout(240_000);
  const server = await serve("docs");
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    const version = (await page.evaluate(() => fetch("sw.js").then((r) => r.text()))).match(/const VERSION = "([0-9a-f]{10})"/)[1];
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 30_000 }).toBe("activated");
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith("jumpstart-3d-"));
      return { names, entries: names.length ? (await (await caches.open(names[0])).keys()).length : 0 };
    });
    expect(cached).toEqual({ names: ["jumpstart-3d-" + version], entries: 4 });

    await server.close();
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await expect(page.locator("#loading")).toBeHidden({ timeout: 20_000 });
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.locator(".toast", { hasText: "new version" })).toHaveCount(0);
    await page.evaluate(() => JS3D.add("box"));
    await page.evaluate(() => JS3D.ready());
    expect(await meshes(page)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await server.close();
  }
});
