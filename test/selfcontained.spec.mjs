// Self-contained: the page asks no one but its own origin for anything (Phase 7, self-hosted fonts). On the site that means only
// requests to the site's own origin; the single file, opened from disk, makes no network request at all. Everything counts: the
// page, the three helper pages (srcdoc iframes), the Mesh to STEP pop-out tab, and the fonts, which must also really load and be used.
// Runs on both builds. Red before the fonts were self-hosted: the page linked fonts.googleapis.com and fonts.gstatic.com.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const box20 = () => newDoc("Box", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
const LOCAL = /^(file|data|blob|about):/;

test("no request leaves the page's own origin, and the fonts still load", async ({ page }, info) => {
  const baseURL = info.project.use.baseURL;
  const origin = baseURL.startsWith("http") ? new URL(baseURL).origin : null; // null: the single file, no network at all
  const requests = [];
  page.context().on("request", (r) => requests.push(r.url()));
  const errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
  await loadDoc(page, box20());

  // the helper pages are separate documents with their own fonts
  await page.evaluate(() => window.__app.flexigen.open("b1"));
  const flexi = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  await flexi.waitForFunction(() => !!window.__flexi);
  const flexiFonts = await flexi.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))));
  await page.evaluate(() => window.__app.flexigen.close());

  await page.evaluate(() => window.__app.meshstep.open());
  const mesh = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  await mesh.waitForFunction(() => !!window.__meshstep);
  const meshFonts = await mesh.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))));
  const [popup] = await Promise.all([page.context().waitForEvent("page"), page.click(".meshstep-pop")]);
  await popup.waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
  const popFonts = await popup.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))));
  await popup.close();

  // Chisel is a third helper frame; its condensed labels use IBM Plex Sans Condensed
  await page.click("#mode-chisel");
  const chisel = await (await page.waitForSelector("#chisel-host iframe")).contentFrame();
  await chisel.waitForSelector('#shapes .chip[data-shape="sphere"]', { timeout: 30_000 });
  const chiselFaces = await chisel.evaluate(() => Promise.all([document.fonts.load('500 12px "IBM Plex Sans Condensed"'), document.fonts.load('400 12px "IBM Plex Sans"')]).then((r) => r.map((faces) => faces.length)));
  const chiselFonts = await chisel.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))));

  const pageFonts = await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))));

  const outside = requests.filter((u) => !(LOCAL.test(u) || (origin && new URL(u).origin === origin)));
  expect(outside, "requests that left the page's own origin").toEqual([]);
  expect(requests.length, "the page made requests at all").toBeGreaterThan(0);

  // not only blocked: the interface fonts are really loaded and used
  expect(pageFonts).toEqual(expect.arrayContaining(["IBM Plex Sans", "Barlow Condensed"]));
  expect(await page.evaluate(() => document.fonts.load('500 12px "IBM Plex Mono"').then((faces) => faces.length)), "the mono face loads on demand").toBe(1);
  expect(flexiFonts).toEqual(expect.arrayContaining(["Chakra Petch", "IBM Plex Sans"]));
  expect(meshFonts).toEqual(expect.arrayContaining(["Chakra Petch", "IBM Plex Sans"]));
  expect(chiselFaces, "Chisel finds its own copy of the condensed and sans faces").toEqual([1, 1]);
  expect(chiselFonts).toEqual(expect.arrayContaining(["IBM Plex Sans Condensed", "IBM Plex Sans"]));
  expect(popFonts).toEqual(expect.arrayContaining(["Chakra Petch", "IBM Plex Sans"]));
  if (origin) expect(requests.filter((u) => /\/fonts\/.+\.woff2$/.test(u)).length, "font files fetched from the site").toBeGreaterThan(0);
  expect(errors, "console or page errors").toEqual([]);
});
