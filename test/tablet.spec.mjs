// Issue #87's reporter uses an iPad. At 820 x 1180 (iPad Air) the page was 899 px wide: the top bar's buttons added up to more than the
// screen, so the whole page scrolled sideways. Proof: on a touch tablet in each common iPad size, in Beginner and Advanced, with nothing
// selected and with a body selected, the page is no wider than the screen. A touch browser widens its layout viewport to fit what overflows
// (window.innerWidth becomes the page's width), so the screen's own width is what the page is held to. The toolbars may scroll inside
// themselves; the page may not.
import { test, expect } from "@playwright/test";
import { watchErrors, boot, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const SIZES = [[820, 1180], [768, 1024], [1024, 1366], [1180, 820]]; // iPad Air, iPad mini, iPad Pro 12.9 portrait, iPad Air landscape

for (const [width, height] of SIZES) {
  test(`tablet ${width} x ${height}: the page is no wider than the screen`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: "block" });
    const p = await ctx.newPage();
    const errors = watchErrors(p);
    try {
      await boot(p, info);
      expect(await p.evaluate(() => document.documentElement.classList.contains("touch-ui")), "the touch UI is on").toBe(true);
      for (const mode of ["beginner", "advanced"]) {
        await loadDoc(p, newDoc("tablet width", mode, { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 20 }))] }));
        for (const selected of [false, true]) {
          await p.evaluate((s) => window.__app.select(s ? ["b1"] : []), selected);
          await p.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
          const w = await p.evaluate((screenW) => ({
            scroll: document.documentElement.scrollWidth,
            inner: window.innerWidth,
            wider: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > screenW + 0.5 && !e.closest(".ribbon, .bbar, .dock-track, .toasts"))
              .slice(0, 6).map((e) => `${e.tagName}#${e.id}`),
          }), width);
          const where = `${mode}, ${selected ? "body selected" : "nothing selected"}`;
          expect(w.scroll, `scrollWidth at ${where}; outside their scrolling toolbars these reach past the edge: ${w.wider.join(" ")}`).toBeLessThanOrEqual(width);
          expect(w.inner, `innerWidth at ${where}`).toBeLessThanOrEqual(width);
        }
      }
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
