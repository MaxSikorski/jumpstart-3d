// Helper pages on demand (src/helperpages.js, build.mjs, src/sw.js): Chisel, FlexiGen and Mesh to STEP are files in docs/helpers/ that the site
// fetches the first time each opens; the single file has them inline. Cases 1-2 run on both builds; 3-4 need a site and run on the site build only.
// Case 4 allows a service worker in its own context (the config blocks it elsewhere) and takes the network away after it has installed.
import { test, expect } from "@playwright/test";
import { serve } from "../mcp/serve.mjs";
import { mkdtempSync, cpSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(cached, "the service worker saved the helper pages").toEqual(["/helpers/chisel.html", "/helpers/flexigen.html", "/helpers/fonts_more.js", "/helpers/helper-three.html", "/helpers/meshstep.html"]);

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

// ---- review round 1 ----
// a route that answers nothing; unroute() lets every held request go on to the server
const hold = async (page) => { await page.route("**/helpers/*", () => {}); return { release: () => page.unroute("**/helpers/*") }; };

test("Chisel stays closed when you leave while its page is still downloading", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  const errors = watchErrors(page);
  await skipIntro(page);
  await boot(page, info);
  const gate = await hold(page);
  await page.click("#mode-chisel");
  await expect(page.locator("#chisel-host")).toContainText("Loading");
  await page.click("#mode-beginner");
  await gate.release();
  await page.waitForFunction(() => { const f = document.querySelector("#chisel-host iframe"); return !!(f && f.contentWindow && f.contentWindow.__chisel); }, null, { timeout: 30_000 });
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 600))); // a negative: give a late enter() the chance it must not take
  expect(await page.evaluate(() => window.__app.mode)).toBe("beginner");
  await expect(page.locator("#chisel-host")).toBeHidden();
  await page.click("#mode-chisel"); // and it opens normally afterwards, from the page it already has
  await expect(page.locator("#chisel-host")).toBeVisible();
  expect(await page.evaluate(() => window.__app.mode)).toBe("chisel");
  expect(errors, "console or page errors").toEqual([]);
});

test("a download that never ends can be closed with the button or Escape, and the timeout says so", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  await page.addInitScript(() => { window.__JS3D_HELPER_TIMEOUT_MS = 1500; });
  await skipIntro(page);
  await boot(page, info);
  await loadDoc(page, box20());
  await page.route("**/helpers/*", () => {}); // never answers

  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await expect(page.locator("#flexigen")).toContainText("Loading");
  await page.locator("#flexigen button", { hasText: "Close" }).click();
  await expect(page.locator("#flexigen")).toHaveCount(0);

  await page.evaluate(() => window.__app.meshstep.open());
  await expect(page.locator(".meshstep")).toContainText("Loading");
  await page.keyboard.press("Escape");
  await expect(page.locator(".meshstep")).toHaveCount(0);

  await page.click("#mode-chisel");
  await page.locator("#chisel-host button", { hasText: "Close" }).click();
  expect(await page.evaluate(() => window.__app.mode)).toBe("beginner");

  // left open, the 1.5 s limit gives up with the plain message; the next try starts afresh
  await page.evaluate(() => window.__app.meshstep.open());
  await expect(page.locator(".toast", { hasText: "Mesh to STEP needs a connection the first time" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".meshstep")).toHaveCount(0);
  await page.unroute("**/helpers/*");
  await page.evaluate(() => window.__app.meshstep.open());
  await helperFrame(page).waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
});

test("a helper file from another build says to reload, after asking the server once more", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  await skipIntro(page);
  await boot(page, info);
  await loadDoc(page, box20());
  const asked = [];
  await page.route("**/helpers/flexigen.html", async (route) => {
    asked.push(route.request().url());
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace(/^js3d-build:[0-9a-f]+/, "js3d-build:0000000000") });
  });
  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await expect(page.locator(".toast", { hasText: "A newer version was installed: reload the page to use FlexiGen" })).toBeVisible();
  await expect(page.locator("#flexigen")).toHaveCount(0);
  expect(asked.length, "once more, then the toast").toBe(2);
  // an old copy in the HTTP cache: the second ask gets the right file and the helper opens
  await page.unroute("**/helpers/flexigen.html");
  let n = 0;
  await page.route("**/helpers/flexigen.html", async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: n++ ? await r.text() : (await r.text()).replace(/^js3d-build:[0-9a-f]+/, "js3d-build:0000000000") });
  });
  await page.evaluate(() => window.__app.flexigen.open("b1"));
  await helperFrame(page).waitForFunction(() => !!window.__flexi, null, { timeout: 30_000 });
});

test("on the first visit, offline before the service worker controls the page, a helper still opens", async ({ browser }, info) => {
  quarantine(info, ["site-webkit"], "WebKit's internal error with a service worker under Playwright on Linux");
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  test.setTimeout(240_000);
  const server = await serve("docs");
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    await skipIntro(page);
    await page.goto(server.url);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 30_000 }).toBe("activated");
    expect(await page.evaluate(() => navigator.serviceWorker.controller), "this page is not controlled yet (no reload)").toBeNull();
    await expect.poll(() => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith("jumpstart-3d-")); return n ? (await (await caches.open(n)).keys()).filter((r) => r.url.includes("/helpers/")).length : 0; })).toBe(5); // the four helper pages and the extra fonts (precache)
    await server.close();
    await context.setOffline(true); // no reload: the page keeps its own, uncontrolled self
    await page.evaluate(() => window.__app.meshstep.open());
    await helperFrame(page).waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
    await expect(page.locator(".toast", { hasText: "needs a connection" })).toHaveCount(0);
  } finally {
    await context?.close();
    await server.close();
  }
});

test("an on-use helper file is not saved at install; the service worker keeps it the first time it is fetched", async ({ browser }, info) => {
  quarantine(info, ["site-webkit"], "WebKit's internal error with a service worker under Playwright on Linux");
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  test.setTimeout(240_000);
  // a copy of docs/, so the server can be stopped; helpers/floorplan.html (J.Siwek's Floor Planner) is on-use in tools/helper-files.mjs
  const live = mkdtempSync(join(tmpdir(), "js3d-onuse-"));
  cpSync("docs", live, { recursive: true });
  expect(readFileSync(join(live, "sw.js"), "utf8")).toContain('"helpers/floorplan.html"');
  const server = await serve(live);
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "allow" });
    const page = await context.newPage();
    const kept = () => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith("jumpstart-3d-")); return (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname).filter((p) => p.includes("floorplan")); });
    await skipIntro(page);
    await page.goto(server.url);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 30_000 }).toBe("activated");
    await expect.poll(() => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith("jumpstart-3d-")); return n ? (await (await caches.open(n)).keys()).filter((r) => r.url.includes("/helpers/")).length : 0; })).toBe(5); // the four helper pages and the extra fonts (precache)
    expect(await kept(), "not part of the install").toEqual([]);
    await page.reload(); // now the worker controls the page
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(await page.evaluate(() => fetch("helpers/floorplan.html").then((r) => r.text()))).toContain("__fp");
    await expect.poll(kept).toEqual(["/helpers/floorplan.html"]);
    await server.close();
    await context.setOffline(true);
    expect(await page.evaluate(() => fetch("helpers/floorplan.html").then((r) => r.text())), "served from the cache offline").toContain("__fp");
  } finally {
    await context?.close();
    await server.close();
    rmSync(live, { recursive: true, force: true });
  }
});

test("Escape works in the app again after Close on a slow Chisel download", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  await skipIntro(page);
  await boot(page, info);
  await loadDoc(page, box20());
  await page.route("**/helpers/*", () => {}); // never answers
  await page.click("#mode-chisel");
  await page.locator("#chisel-host button", { hasText: "Close" }).click();
  expect(await page.evaluate(() => [window.__app.mode, window.__store.doc.mode]), "the design is not left in Chisel mode").toEqual(["beginner", "beginner"]);
  await page.evaluate(() => window.__app.select(["b1"]));
  expect(await page.evaluate(() => window.__app.sel.length)).toBe(1);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__app.sel.length), "Escape reached the app").toBe(0);
  // coming back while it still loads shows the note again, with its Close
  await page.click("#mode-chisel");
  await expect(page.locator("#chisel-host")).toBeVisible();
  await expect(page.locator("#chisel-host")).toContainText("Loading");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__app.mode)).toBe("beginner");
});

// A server that sends a helper file in slow pieces (and the rest of docs/ as it is), to tell a stall from a slow link.
async function slowSite(pace) {
  const base = await serve("docs");
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const slow = pace[path];
    if (slow) {
      const body = readFileSync("docs" + path), step = Math.ceil(body.length / 3);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      for (let i = 0; i < 3; i++) {
        res.write(body.subarray(i * step, (i + 1) * step));
        if (i === 0 && slow.stallAfterFirst) return; // never ends
        await new Promise((ok) => setTimeout(ok, slow.gap));
      }
      res.end();
      return;
    }
    const r = await fetch(base.url + path.slice(1));
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise((ok) => server.close(ok)); await base.close(); } };
}

test("the wait limit counts time without data: a slow steady download finishes, a stalled one gives up", async ({ page }, info) => {
  test.skip(buildOf(info) !== "site", SITE_ONLY);
  test.setTimeout(180_000);
  const site = await slowSite({ "/helpers/meshstep.html": { gap: 700 }, "/helpers/flexigen.html": { stallAfterFirst: true } });
  try {
    await page.addInitScript(() => { window.__JS3D_HELPER_TIMEOUT_MS = 1200; try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await page.goto(site.url);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    // about 2.1 s in all, over the 1.2 s limit, but never 1.2 s without a piece
    const t0 = Date.now();
    await page.evaluate(() => window.__app.meshstep.open());
    await helperFrame(page).waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
    expect(Date.now() - t0, "took longer than the limit in all").toBeGreaterThan(1200);
    await page.evaluate(() => window.__app.meshstep.close());
    await loadDoc(page, box20());
    await page.evaluate(() => window.__app.flexigen.open("b1"));
    await expect(page.locator(".toast", { hasText: "FlexiGen needs a connection the first time" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await site.close();
  }
});
