// Outcome 2 (a first part on a phone), PR 1: the lessons can be reached on a 375 x 667 touch phone. The top bar hides Tutorials below
// 560 px and has no room for another 44 px button, so the entry lives at the top of the Open/Export menu there. This walk taps it,
// checks the chooser fits the screen, starts the community lesson c-hole-block and checks its first step is on screen, readable and
// under nothing. It does not play the lesson (that is the next PR). Runs in its own touch context, so it is part of both builds.
import { test, expect, devices } from "@playwright/test";
import { watchErrors, boot } from "./helpers.mjs";

const W = 375, H = 667;

// The entry's size and what is on top of its centre, read in the page.
const hitTest = (sel) => (s) => {
  const e = document.querySelector(s), r = e.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, covered: !(top === e || e.contains(top)) };
};

test("phone 375 x 667: Tutorials can be opened from the menu and the first step of c-hole-block is readable", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: W, height: H }, screen: { width: W, height: H }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errors = watchErrors(p);
  try {
    await boot(p, info);
    expect(await p.evaluate(() => document.documentElement.classList.contains("touch-ui")), "the touch UI is on").toBe(true);

    await p.locator("#btn-export").tap();
    const entry = p.locator("#btn-tutorials-menu");
    await expect(entry, "a Tutorials entry in the Open/Export menu at 375 px").toBeVisible();
    const hit = await p.evaluate(hitTest("#btn-tutorials-menu"), "#btn-tutorials-menu");
    expect(hit.w, "entry width").toBeGreaterThanOrEqual(44);
    expect(hit.h, "entry height").toBeGreaterThanOrEqual(44);
    expect(hit.left).toBeGreaterThanOrEqual(0);
    expect(hit.right).toBeLessThanOrEqual(W);
    expect(hit.bottom, "entry is on screen").toBeLessThanOrEqual(H);
    expect(hit.covered, "something covers the entry's centre").toBe(false);
    await entry.tap();

    // the chooser fits the screen
    const modal = p.locator(".tut-modal");
    await expect(modal).toBeVisible();
    await expect(p.locator("#menu-export")).toBeHidden();
    const box = await modal.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(W);
    expect(box.y + box.height).toBeLessThanOrEqual(H);
    expect(await p.evaluate(() => document.documentElement.scrollWidth), "the page scrolls sideways with the chooser open").toBeLessThanOrEqual(W);
    expect(await p.evaluate(() => { const m = document.querySelector(".tut-modal .mbody"); return m.scrollWidth - m.clientWidth; }), "the chooser's list scrolls sideways").toBeLessThanOrEqual(0);

    const card = p.locator("#tut-c-hole-block");
    await card.tap();
    await expect(modal).toBeHidden();

    // the first step is on screen, readable and under nothing
    const panel = p.locator("#tut-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".tut-stepno")).toHaveText(/Step 1 of/);
    const s = await p.evaluate(() => {
      const pan = document.getElementById("tut-panel"), pr = pan.getBoundingClientRect();
      const st = document.querySelector(".status").getBoundingClientRect();
      const dock = document.getElementById("shapes"), dr = dock && dock.getClientRects().length ? dock.getBoundingClientRect() : null;
      const inside = (sel) => {
        const e = pan.querySelector(sel), r = e.getBoundingClientRect();
        const top = document.elementFromPoint(Math.min(innerWidth, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight, Math.max(0, r.top + r.height / 2)));
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, font: parseFloat(getComputedStyle(e).fontSize), clipped: r.top < pr.top || r.bottom > pr.bottom, covered: !(top === e || e.contains(top)) };
      };
      return {
        panel: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, sideways: pan.scrollWidth - pan.clientWidth },
        status: { top: st.top }, dock: dr && { top: dr.top },
        scrollWidth: document.documentElement.scrollWidth,
        title: inside(".tut-step h3"), how: inside(".tut-how li"),
      };
    });
    expect(s.panel.left).toBeGreaterThanOrEqual(0);
    expect(s.panel.right).toBeLessThanOrEqual(W);
    expect(s.panel.top).toBeGreaterThanOrEqual(0);
    expect(s.panel.bottom, "panel runs under the status bar").toBeLessThanOrEqual(s.status.top + 0.5);
    if (s.dock) expect(s.panel.bottom, "panel runs under the shape strip").toBeLessThanOrEqual(s.dock.top + 0.5);
    expect(s.panel.sideways, "panel scrolls sideways").toBeLessThanOrEqual(0);
    expect(s.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(W);
    for (const k of ["title", "how"]) {
      expect(s[k].clipped, `${k} of step 1 is cut off by the panel`).toBe(false);
      expect(s[k].covered, `${k} of step 1 is under something else`).toBe(false);
      expect(s[k].font, `${k} font size`).toBeGreaterThanOrEqual(13);
    }
    // the rest of the step is read by scrolling the panel (its footer stays put): the last instruction can be scrolled to the middle, clear of the footer
    const last = await p.evaluate(() => {
      const pan = document.getElementById("tut-panel"), items = pan.querySelectorAll(".tut-how li"), e = items[items.length - 1];
      e.scrollIntoView({ block: "center" });
      const r = e.getBoundingClientRect(), pr = pan.getBoundingClientRect(), nav = pan.querySelector(".tut-nav").getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { n: items.length, inView: r.top >= pr.top && r.bottom <= Math.min(pr.bottom, nav.top + 0.5), covered: !(top === e || e.contains(top)) };
    });
    expect(last.n, "step 1 has more than one instruction").toBeGreaterThan(1);
    expect(last.inView, "the last instruction of step 1 cannot be scrolled clear of the panel's footer").toBe(true);
    expect(last.covered, "the last instruction of step 1 is under something else after scrolling").toBe(false);
    await p.screenshot({ path: process.env.PHONE_TUTORIAL_SHOT || info.outputPath("phone-tutorial-step1.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// The phone entry is for narrow screens only: on a desktop and on an iPad the top bar has the Tutorials button, so the menu must not repeat it.
for (const [width, height] of [[1280, 800], [820, 1180]]) {
  test(`${width} x ${height}: the phone Tutorials entry is not in the Open/Export menu`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await boot(page, info);
    await page.locator("#btn-export").click();
    await expect(page.locator('#menu-export button[data-act="stl"]')).toBeVisible();
    await expect(page.locator("#btn-tutorials-menu")).toBeHidden();
    await expect(page.locator("#btn-tutorials")).toBeVisible();
  });
}
