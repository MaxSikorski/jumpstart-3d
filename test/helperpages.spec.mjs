// Helper pages on demand (src/helperpages.js, build.mjs, src/sw.js): Chisel, FlexiGen and Mesh to STEP are files in docs/helpers/ that the site
// fetches the first time each opens; the single file has them inline. Cases 1-2 run on both builds; 3-4 need a site and run on the site build only.
// Case 4 allows a service worker in its own context (the config blocks it elsewhere) and takes the network away after it has installed.
import { test, expect } from "@playwright/test";
import { serve } from "../mcp/serve.mjs";
import { watchErrors, boot, loadDoc, newDoc, body, prim, buildOf, quarantine } from "./helpers.mjs";

const SITE_ONLY = "the single file has no site to fetch from";
const box20 = () => newDoc("Box", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
const skipIntro = (page) => page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
const helperFrame = (page) => page.frames().find((f) => f.parentFrame() === page.mainFrame());

// opens each helper and waits until its page is running; closes it again
async function openAll(page) {
  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await helperFrame(page).waitForFunction(() => !!window.__flexi, null, { timeout: 30_000 });
  await expect(page.frameLocator("#flexigen iframe").locator("canvas").first()).toBeVisible();
  await page.evaluate(() => window.__app.flexigen.close());

  await page.evaluate(() => window.__app.meshstep.open());
  await helperFrame(page).waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
  await expect(page.frameLocator(".meshstep iframe").locator("canvas").first()).toBeVisible();
  await page.evaluate(() => window.__app.meshstep.close());

  await page.click("#mode-chisel");
  const chisel = await (await page.waitForSelector("#chisel-host iframe")).contentFrame();
  await chisel.waitForSelector('#shapes .chip[data-shape="sphere"]', { timeout: 30_000 });
  await page.click("#mode-beginner");
}

test("the site fetches each helper page once, when it first opens; the single file fetches nothing", async ({ page }, info) => {
  const errors = watchErrors(page);
  const helperRequests = [];
  page.on("request", (r) => { const m = new URL(r.url()).pathname.match(/\/helpers\/(.+)$/); if (m) helperRequests.push(m[1]); });
  await skipIntro(page);
  await boot(page, info);
  await loadDoc(page, box20());
  expect(helperRequests, "nothing is fetched before a helper opens").toEqual([]);

  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await helperFrame(page).waitForFunction(() => !!window.__flexi, null, { timeout: 30_000 });
  if (buildOf(info) === "site") expect([...helperRequests].sort()).toEqual(["flexigen.html", "helper-three.html"]);
  else expect(helperRequests).toEqual([]);
  await page.evaluate(() => window.__app.flexigen.close());

  await page.evaluate(() => window.__app.flexigen.open("b1")); // the second open comes from memory
  await helperFrame(page).waitForFunction(() => !!window.__flexi, null, { timeout: 30_000 });
  await page.evaluate(() => window.__app.flexigen.close());
  if (buildOf(info) === "site") expect(helperRequests.length, "FlexiGen's page and the shared three.js, once").toBe(2);

  await openAll(page);
  if (buildOf(info) === "site") expect([...helperRequests].sort()).toEqual(["chisel.html", "flexigen.html", "helper-three.html", "meshstep.html"]);
  else expect(helperRequests).toEqual([]);
  expect(errors, "console or page errors").toEqual([]);
});

test("a helper page that cannot be fetched says so, closes its window and can be tried again", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  const errors = watchErrors(page);
  await skipIntro(page);
  await boot(page, info);
  await loadDoc(page, box20());
  await page.route("**/helpers/*", (route) => route.abort());

  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await expect(page.locator(".toast", { hasText: "FlexiGen needs a connection the first time" })).toBeVisible();
  await expect(page.locator("#flexigen")).toHaveCount(0);
  await page.evaluate(() => window.__app.meshstep.open());
  await expect(page.locator(".toast", { hasText: "Mesh to STEP needs a connection the first time" })).toBeVisible();
  await expect(page.locator(".meshstep")).toHaveCount(0);
  await page.click("#mode-chisel");
  await expect(page.locator(".toast", { hasText: "Chisel needs a connection the first time" })).toBeVisible();
  await expect(page.locator("#chisel-host")).toHaveCount(0);
  expect(await page.evaluate(() => window.__app.mode), "Chisel leaves again").toBe("beginner");

  await page.unroute("**/helpers/*"); // the connection is back
  await openAll(page);
  expect(errors.filter((e) => !/helpers\/|Failed to load resource|ERR_FAILED/.test(e)), "console or page errors").toEqual([]);
});

test("offline, after the service worker has installed, every helper still opens", async ({ browser }, info) => {
  quarantine(info, ["site-webkit"], "WebKit's internal error with a service worker under Playwright on Linux");
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  test.setTimeout(240_000);
  const server = await serve("docs");
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await skipIntro(page);
    await page.goto(server.url);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 30_000 }).toBe("activated");
    const cached = await page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.startsWith("jumpstart-3d-"));
      return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname).filter((p) => p.startsWith("/helpers/")).sort();
    });
    expect(cached, "the service worker saved the helper pages").toEqual(["/helpers/chisel.html", "/helpers/flexigen.html", "/helpers/helper-three.html", "/helpers/meshstep.html"]);

    await server.close();
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await loadDoc(page, box20());
    await openAll(page);
    expect(errors, "console or page errors").toEqual([]);
  } finally {
    await context?.close();
    await server.close();
  }
});
