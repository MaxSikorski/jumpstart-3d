// Upstream 2.5.1 regressions (J.Siwek's CAM Studio update: Fanuc-style and Haas-style G-code, machines with a tool changer,
// and toolpaths, G-code and the cutting simulation made in a Web Worker so the window never freezes), shared by the site and
// single-file projects. His own test (JumpStart-3D-v2.5.1-full-source/tests/cam6.cjs) is data only here.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

test.describe("version 2.5.1", () => {
  let page, errors;
  test.beforeAll(async ({ browser }, info) => {
    page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    errors = watchErrors(page);
    await page.addInitScript(() => {
      try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
      // count the Web Workers the page starts from a Blob (CAM Studio's), and keep a frame counter for the responsiveness test
      window.__blobWorkers = 0;
      const W = window.Worker;
      window.Worker = function (url, opts) { if (String(url).startsWith("blob:")) window.__blobWorkers++; return new W(url, opts); };
      window.Worker.prototype = W.prototype;
      window.__frames = 0; window.__maxGap = 0;
      let last = performance.now();
      const tick = (t) => { window.__frames++; window.__maxGap = Math.max(window.__maxGap, t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await boot(page, info);
  });
  test.afterAll(async () => { await page.close(); });
  test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

  const camOpen = async (name, size) => {
    await loadDoc(page, newDoc(name, "advanced", { bodies: [body("b1", "Block", prim("box", size))] }));
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    await page.click("#ws-simulate");
    await page.click("#sim-cam");
    await expect(page.locator("#cam-side")).toBeVisible();
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.result && u.done; }, null, { timeout: 90_000 });
  };
  const camClose = async () => { await page.click("#cam-close"); await expect(page.locator("#cam-side")).toHaveCount(0); };
  // pick a machine, then wait for the G-code made for it (the old result stays on state until the worker answers)
  const useMachine = async (id, header) => {
    await page.selectOption("#cam-machine", id);
    await page.waitForFunction((h) => { const u = window.__app.cam._ui(); return u && u.result && u.done && u.result.gcode.includes(h); }, header, { timeout: 120_000 });
    return page.evaluate(() => window.__app.cam._ui().result.gcode);
  };

  test("About keeps the 2.5.1 notes and the credit (the current version is checked in upstream271.spec.mjs)", async () => {
    const label = `Version ${VERSION} · community build ${BUILD}`; // later releases keep the 2.5.1 notes; the version itself moves on
    expect(await page.locator("#sp-ver").textContent()).toBe(label);
    await page.click("#btn-about");
    const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
    await expect(about).toContainText(label);
    await expect(about).toContainText("New in version 2.5.1");
    await expect(about).toContainText("Created by J.Siwek");
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();
  });

  test("CAM Studio: Fanuc-style and Haas-style G-code from a machine with a tool changer", async () => {
    await camOpen("Upstream 2.5.1 posts", { w: 40, d: 30, h: 10, r: 0, c: 0 });
    const fanuc = await useMachine("vmcmm", "FANUC-STYLE");
    expect(fanuc).toMatch(/^O\d{4} /m); // the program number line
    expect(fanuc).toMatch(/^G90 G54$/m);
    expect(fanuc).toMatch(/^G43 H\d+ Z/m); // tool length offset after the tool change
    expect(fanuc).toMatch(/\bM6\b/);
    const haas = await useMachine("vmc30", "HAAS-STYLE");
    expect(haas).toMatch(/^O\d{4} /m);
    expect(haas).toMatch(/G54/);
    expect(haas).toMatch(/^G43 H\d+ Z/m);
    expect(await page.evaluate(() => window.__blobWorkers)).toBeGreaterThan(0); // made in the worker, not on the page
    await camClose();
  });

  test("CAM Studio: the page keeps drawing frames while the worker makes the toolpaths and simulation, and the result arrives", async () => {
    await camOpen("Upstream 2.5.1 responsive", { w: 120, d: 90, h: 20, r: 0, c: 0 });
    await page.click('#cam-quality button[data-v="fine"]');
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.working; }, null, { timeout: 15_000 });
    const frames0 = await page.evaluate(() => { window.__maxGap = 0; return window.__frames; });
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && !u.working && u.result && u.done; }, null, { timeout: 180_000 });
    const { frames, gap, gcode } = await page.evaluate(() => ({ frames: window.__frames, gap: window.__maxGap, gcode: window.__app.cam._ui().result.gcode }));
    expect(gcode.split("\n").length).toBeGreaterThan(20);
    expect(frames - frames0, "frames drawn while the worker was busy").toBeGreaterThan(5);
    expect(gap, "longest wait between two frames, ms").toBeLessThan(1500);
    await camClose();
  });
});
