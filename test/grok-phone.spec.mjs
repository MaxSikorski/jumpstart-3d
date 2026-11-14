// The phone layout at 390 x 844 (both builds, as a Pixel 7 touch phone): long menus scroll inside the window with a fade while more is
// below, Simple's selected-shape sheet opens collapsed and never hides the shape or the size fields, touch targets are
// 44 px, and nothing sticks out past the right edge. From the Grok review (bug 3, "Mobile and touch", quick win 6).
import { test, expect, devices } from "@playwright/test";
import { boot, waitIdle, watchErrors } from "./helpers.mjs";

const { defaultBrowserType, ...phone } = devices["Pixel 7"];
test.use({ ...phone, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } });
test.skip(({ browserName }) => browserName !== "chromium", "touch emulation (isMobile) is Chromium only");

let errors;
test.beforeEach(async ({ page }, info) => {
  errors = watchErrors(page);
  await boot(page, info);
  await page.evaluate(() => window.__app.setFace("simple", true));
});
test.afterEach(() => expect(errors, "console or page errors").toEqual([]));

const rect = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
// true when the element's middle is really on top (not under a sheet, a bar or a menu edge)
const onTop = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === e || e.contains(hit)); });
const steady = (page) => page.waitForFunction(() => !window.__app.vp.isMoving());

async function menuReachesItsEnd(page, menuSel, lastSel) {
  const menu = page.locator(menuSel), last = page.locator(lastSel);
  await expect(menu).toBeVisible();
  const box = await rect(menu), win = await page.evaluate(() => innerHeight);
  expect(box.top, `${menuSel} top`).toBeGreaterThanOrEqual(0);
  expect(box.bottom, `${menuSel} bottom inside the window`).toBeLessThanOrEqual(win);
  const m = await menu.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
  expect(m.sh, `${menuSel} is taller than the screen, so it scrolls inside itself`).toBeGreaterThan(m.ch);
  await expect(menu, "a fade shows that more items are below").toHaveClass(/\bmore-below\b/);
  await last.scrollIntoViewIfNeeded();
  const item = await rect(last), seen = await rect(menu);
  expect(item.bottom).toBeLessThanOrEqual(Math.min(seen.bottom, win) + 0.5);
  expect(item.top).toBeGreaterThanOrEqual(seen.top - 0.5);
  await menu.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await expect(menu, "no fade once the end is reached").not.toHaveClass(/\bmore-below\b/);
  expect(await onTop(last), `${lastSel} can be tapped`).toBe(true);
}

test("the export menu stays inside the window and its last items can be scrolled to and tapped", async ({ page }) => {
  await page.locator("#btn-export").tap();
  await menuReachesItsEnd(page, "#menu-export", "#btn-report");
  await page.locator("#btn-share-link").scrollIntoViewIfNeeded();
  expect(await onTop(page.locator("#btn-share-link"))).toBe(true);
  await page.locator("#btn-report").scrollIntoViewIfNeeded();
  await page.locator("#btn-report").tap();
  await expect(page.locator(".modal h2", { hasText: "Report a problem" })).toBeVisible();
});

test("Customize and More also stay inside the window and scroll to their last row", async ({ page }) => {
  await page.locator("#btn-theme").tap();
  await menuReachesItsEnd(page, "#menu-theme", "#menu-theme button:visible >> nth=-1");
  await page.locator("#btn-theme").tap();
  await expect(page.locator("#menu-theme")).toBeHidden();
  await page.locator("#sr-more").tap();
  await menuReachesItsEnd(page, "#simple-more", "#simple-more button:visible >> nth=-1");
});

test("after tapping Box the sheet is collapsed, the box stays in view, and the handle opens it with the sizes above the tool strip", async ({ page }) => {
  await page.locator('#shapes .tile[data-kind="box"]').tap();
  await page.waitForFunction(() => window.__app.selected().length === 1);
  await waitIdle(page); await steady(page);
  const sheet = page.locator("#simple-panel"), handle = page.locator("#simple-sheet-handle"), rail = page.locator("#simple-rail");
  await expect(sheet).toBeVisible();
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  const selinfo = (await page.locator("#selinfo").textContent()).trim();
  expect(selinfo).toMatch(/^[\d.]+ × [\d.]+ × [\d.]+ mm$/);
  await expect(handle).toContainText("Box");
  await expect(handle).toContainText(selinfo);
  const collapsed = await rect(sheet);
  expect(collapsed.height, "collapsed: just the handle row").toBeLessThanOrEqual(72);
  for (const part of [".sheet-name", ".sheet-size"]) expect(await onTop(handle.locator(part)), `the handle's ${part.slice(7)} is not covered`).toBe(true);
  // the panel buttons (Simple's collapse handles) float above the sheet: none may sit on it
  const clear = async (label) => {
    const box = await rect(sheet);
    for (const b of await page.evaluate(() => [...document.querySelectorAll(".simple-collapse")].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none").map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }))) {
      const w = Math.min(b.right, box.right) - Math.max(b.left, box.left), h = Math.min(b.bottom, box.bottom) - Math.max(b.top, box.top);
      expect(w > 0.5 && h > 0.5, `${label}: ${b.id} sits on the sheet`).toBe(false);
    }
  };
  await clear("collapsed");

  const bodyBox = () => page.evaluate(() => {
    const app = window.__app, vp = app.vp, id = app.selected()[0].id, box = app.scene.bodyTightBox(id), V = box.min.constructor;
    vp.updateCamera(); vp.camera.updateMatrixWorld(true);
    const r = vp.canvas.getBoundingClientRect(), pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => vp.project(new V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)));
    return { top: r.top + Math.min(...pts.map((p) => p[1])), bottom: r.top + Math.max(...pts.map((p) => p[1])) };
  });
  const shape = await bodyBox();
  expect(shape.bottom, "the box is above the collapsed sheet").toBeLessThanOrEqual(collapsed.top);
  expect(await onTop(page.locator('#shapes .tile[data-kind="cylinder"]')), "the shape strip stays usable").toBe(true);

  await handle.tap();
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  const open = await rect(sheet), railBox = await rect(rail), head = await rect(handle);
  await clear("open");
  expect(open.height).toBeGreaterThan(150);
  expect(open.bottom, "the open sheet ends at the tool strip, not under it").toBeLessThanOrEqual(railBox.top + 0.5);
  expect((await bodyBox()).bottom, "the box stays visible above the open sheet").toBeLessThanOrEqual(open.top);
  for (const id of ["insp-w", "insp-d", "insp-h"]) {
    const f = page.locator("#" + id), r = await rect(f);
    expect(r.top, `${id} below the handle`).toBeGreaterThanOrEqual(head.bottom - 0.5);
    expect(r.bottom, `${id} above the tool strip`).toBeLessThanOrEqual(Math.min(railBox.top, open.bottom) + 0.5);
    expect(await onTop(f), `${id} is not covered`).toBe(true);
  }
  await handle.tap();
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  expect((await rect(sheet)).height).toBeLessThanOrEqual(72);
});

test("pulling the handle up with a finger opens the sheet and pulling it down closes it", async ({ page, context }) => {
  await page.locator('#shapes .tile[data-kind="box"]').tap();
  await page.waitForFunction(() => window.__app.selected().length === 1);
  await waitIdle(page);
  const handle = page.locator("#simple-sheet-handle"), cdp = await context.newCDPSession(page);
  const pull = async (dy) => {
    const r = await rect(handle), x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y + (dy * i) / 6), id: 0 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await pull(-80);
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await pull(80);
  await expect(handle).toHaveAttribute("aria-expanded", "false");
});

test("Save, Undo, Redo, the view buttons, the cube arrows and the units control are 44 px targets, and nothing sticks out", async ({ page }) => {
  const check = async (face) => {
    const targets = await page.evaluate(() => [...document.querySelectorAll("#btn-save, #btn-undo, #btn-redo, .navbtns button, .cube-arrow, .cube-roll, #unit-toggle")]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden")
      .map((e) => { const r = e.getBoundingClientRect(); return { name: e.id || e.className, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
    for (const t of targets) {
      // Original's phone top bar has no room for 44 px wide Save, Undo and Redo (Export would wrap onto a new row): they get the height;
      // and its phone status bar stays the compact 28 px bar (Architect's panels are laid out against it)
      if (!(face === "Original" && /^btn-(save|undo|redo)$/.test(t.name))) expect(t.w, `${face}: ${t.name} width`).toBeGreaterThanOrEqual(43.5);
      if (!(face === "Original" && t.name === "unit-toggle")) expect(t.h, `${face}: ${t.name} height`).toBeGreaterThanOrEqual(43.5);
    }
    const names = targets.map((t) => t.name);
    for (const must of ["btn-save", "btn-undo", "nav-home", "nav-fit", "nav-ortho", "nav-light", "unit-toggle", "cube-arrow r", "cube-roll cw"]) expect(names, face).toContain(must);
    const cube = targets.filter((t) => /cube-|navbtns/.test(t.name) || t.name.startsWith("nav-") || t.name === "simple-whole-plate");
    for (let i = 0; i < cube.length; i++) for (let j = i + 1; j < cube.length; j++) {
      const a = cube[i], b = cube[j], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(w > 0.5 && h > 0.5, `${face}: ${a.name} overlaps ${b.name}`).toBe(false);
    }
    const bar = await page.evaluate(() => { const r = (id) => document.getElementById(id)?.getBoundingClientRect(); return { save: r("btn-save").top, exp: r("btn-export").top }; });
    expect(Math.abs(bar.exp - bar.save), `${face}: Export stays on the first row of the top bar`).toBeLessThan(12);
    const right = targets.find((t) => t.name === "cube-arrow r");
    const win = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
    expect(right.right, `${face}: Rotate view right inside the window`).toBeLessThanOrEqual(win.w);
    expect(win.sw, `${face}: no sideways page scroll`).toBeLessThanOrEqual(win.w);
    expect(win.bw, `${face}: no sideways page scroll`).toBeLessThanOrEqual(win.w);
  };
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await check("Simple");
  await page.evaluate(() => window.__app.setFace("original", true));
  await check("Original");
});

test.describe("a short phone window", () => {
  test.use({ viewport: { width: 375, height: 667 }, screen: { width: 375, height: 667 } });
  test("the export menu still fits and reaches its last item", async ({ page }) => {
    await page.locator("#btn-export").tap();
    await menuReachesItsEnd(page, "#menu-export", "#btn-report");
  });
  test("the top bar keeps Export on its first row and the page never scrolls sideways (Simple and Original)", async ({ page }) => {
    for (const face of ["simple", "original"]) {
      await page.evaluate((f) => window.__app.setFace(f, true), face);
      const m = await page.evaluate(() => ({ save: document.getElementById("btn-save").getBoundingClientRect(), exp: document.getElementById("btn-export").getBoundingClientRect(), sw: document.documentElement.scrollWidth, w: innerWidth }));
      expect(Math.abs(m.exp.top - m.save.top), `${face}: Export on the first row`).toBeLessThan(12);
      expect(m.exp.right, face).toBeLessThanOrEqual(m.w);
      expect(m.save.height, `${face}: Save is 44 px tall`).toBeGreaterThanOrEqual(43.5);
      expect(m.sw, face).toBeLessThanOrEqual(m.w);
    }
  });
  test("the view buttons stay inside the view, clear of the collapsed sheet, and none overlap", async ({ page }) => {
    const check = async (label) => {
      const t = await page.evaluate(() => [...document.querySelectorAll(".navbtns button, .cube-arrow, .cube-roll, .simple-collapse")].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none")
        .map((e) => { const r = e.getBoundingClientRect(); return { name: e.id || e.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
      const view = await rect(page.locator("#viewport")), sheet = page.locator("#simple-panel");
      const floor = (await sheet.isVisible()) ? Math.min(view.bottom, (await rect(sheet)).top) : view.bottom;
      for (const a of t) {
        expect(a.bottom, `${label}: ${a.name} above the bottom of the view and the sheet`).toBeLessThanOrEqual(floor + 0.5);
        expect(a.left, `${label}: ${a.name}`).toBeGreaterThanOrEqual(-0.5);
        expect(a.right, `${label}: ${a.name}`).toBeLessThanOrEqual(view.right + 0.5);
      }
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        expect(w > 0.5 && h > 0.5, `${label}: ${a.name} overlaps ${b.name}`).toBe(false);
      }
      expect(t.filter((a) => a.name.startsWith("nav-")).length, label).toBeGreaterThanOrEqual(4);
    };
    await check("empty plate");
    await page.locator('#shapes .tile[data-kind="box"]').tap();
    await page.waitForFunction(() => window.__app.selected().length === 1);
    await waitIdle(page);
    await check("a shape selected");
  });
});

test("opening the sheet over a shape low in the view moves the view so the shape stays above it", async ({ page }) => {
  await page.locator('#shapes .tile[data-kind="box"]').tap();
  await page.waitForFunction(() => window.__app.selected().length === 1);
  await waitIdle(page); await steady(page);
  await page.evaluate(() => window.__app.vp.panBy(0, 220));
  const bottom = () => page.evaluate(() => {
    const app = window.__app, vp = app.vp, box = app.scene.bodyTightBox(app.selected()[0].id), V = box.min.constructor;
    vp.updateCamera(); vp.camera.updateMatrixWorld(true);
    const r = vp.canvas.getBoundingClientRect();
    return r.top + Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => vp.project(new V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))[1]));
  });
  const before = await bottom();
  await page.locator("#simple-sheet-handle").tap();
  await expect(page.locator("#simple-sheet-handle")).toHaveAttribute("aria-expanded", "true");
  await steady(page);
  const top = (await rect(page.locator("#simple-panel"))).top;
  expect(before, "the shape started where the open sheet would cover it").toBeGreaterThan(top);
  expect(await bottom(), "the shape is above the open sheet").toBeLessThanOrEqual(top);
});

test.describe("a touch tablet", () => {
  test.use({ viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 } });
  test("More keeps the place and height Simple gives it beside the rail", async ({ page }) => {
    await page.locator("#sr-more").tap();
    const m = await page.evaluate(() => ({ max: document.getElementById("simple-more").style.maxHeight, rail: document.getElementById("simple-rail").offsetHeight + "px", bottom: document.getElementById("simple-more").style.bottom }));
    expect(m.max).toBe(m.rail);
    expect(m.bottom).not.toBe("");
  });
  test("the view-cube arrows and view buttons are 44 px, apart, and inside the window", async ({ page }) => {
    for (const face of ["simple", "original"]) {
      await page.evaluate((f) => window.__app.setFace(f, true), face);
      const t = await page.evaluate(() => [...document.querySelectorAll(".navbtns button, .cube-arrow, .cube-roll")].filter((e) => e.getClientRects().length)
        .map((e) => { const r = e.getBoundingClientRect(); return { name: e.id || e.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));
      const vp = await rect(page.locator("#viewport"));
      for (const a of t) {
        expect(a.right - a.left, `${face}: ${a.name}`).toBeGreaterThanOrEqual(43.5);
        expect(a.bottom - a.top, `${face}: ${a.name}`).toBeGreaterThanOrEqual(43.5);
        expect(a.right, `${face}: ${a.name} inside the view`).toBeLessThanOrEqual(vp.right + 0.5);
        expect(a.top, `${face}: ${a.name} inside the view`).toBeGreaterThanOrEqual(vp.top - 0.5);
      }
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        expect(w > 0.5 && h > 0.5, `${face}: ${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });
});

test("a menu opened from a lower row of a wrapped top bar still ends inside the window", async ({ page }) => {
  await page.evaluate(() => { document.querySelector(".topbar").style.paddingTop = "120px"; });
  await page.locator("#btn-export").tap();
  const menu = page.locator("#menu-export");
  await expect(menu).toBeVisible();
  await expect.poll(async () => (await rect(menu)).bottom, { message: "the export menu ends inside the window" }).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.locator("#btn-report").scrollIntoViewIfNeeded();
  expect(await onTop(page.locator("#btn-report"))).toBe(true);
  await page.locator("#btn-export").tap();
  await expect(menu).toBeHidden();
  // Customize hangs from the bar: when the bar grows while it is open, it is capped again
  await page.evaluate(() => { document.querySelector(".topbar").style.paddingTop = "0px"; });
  await page.locator("#btn-theme").tap();
  const theme = page.locator("#menu-theme");
  await expect(theme).toBeVisible();
  const before = (await rect(theme)).top, win = await page.evaluate(() => innerHeight);
  await page.evaluate(() => { document.querySelector(".topbar").style.minHeight = "220px"; }); // the bar grows (as when it wraps)
  await expect.poll(async () => (await rect(theme)).top, { message: "Customize follows the bar down" }).toBeGreaterThan(before + 100);
  await expect.poll(async () => (await rect(theme)).bottom, { message: "Customize ends inside the window" }).toBeLessThanOrEqual(win);
  await page.evaluate(() => { document.querySelector(".topbar").style.minHeight = ""; }); // and shrinks back
  await expect.poll(async () => (await rect(theme)).top).toBeLessThan(before + 1);
  await expect.poll(async () => (await rect(theme)).bottom).toBeLessThanOrEqual(win);
  await expect(theme).toHaveClass(/\bmore-below\b/);
});

test.describe("a small touch tablet in Simple", () => {
  test.use({ viewport: { width: 744, height: 1133 }, screen: { width: 744, height: 1133 } });
  test("a small lesson panel at the top of the view stops short of the view cube and its arrows", async ({ page }) => {
    const m = await page.evaluate(() => {
      // placed the way the tutorials place their small panel on a tablet: 10 px into the 3D view, 6 px from its top
      const vp = document.getElementById("viewport").getBoundingClientRect(), d = document.createElement("div");
      d.className = "tut-panel mini"; d.style.left = vp.left + 10 + "px"; d.style.top = vp.top + 6 + "px"; d.textContent = "A lesson step that is long enough to fill the panel to its widest, and then some more words.";
      document.body.append(d);
      const cluster = [...document.querySelectorAll(".viewcube, .cube-arrows > *")].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
      return { right: d.getBoundingClientRect().right, left: Math.min(...cluster.map((r) => r.left)) };
    });
    expect(m.right).toBeLessThanOrEqual(m.left);
  });
});

test("More moves above a phone keyboard while Find a tool is typed in", async ({ page }) => {
  await page.locator("#sr-more").tap();
  const more = page.locator("#simple-more");
  await expect(more).toBeVisible();
  // a keyboard shrinks the visible part of the page (visualViewport) while the page itself keeps its height
  const visible = await page.evaluate(() => {
    const h = Math.round(innerHeight * 0.55);
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => h });
    window.visualViewport.dispatchEvent(new Event("resize"));
    return h;
  });
  await expect.poll(async () => (await rect(more)).bottom, { message: "More ends above the keyboard" }).toBeLessThanOrEqual(visible);
  expect((await rect(more)).top).toBeGreaterThanOrEqual(0);
  await page.locator("#simple-find").fill("hole");
  await page.locator("#simple-more button:visible >> nth=-1").scrollIntoViewIfNeeded();
  const last = await rect(page.locator("#simple-more button:visible >> nth=-1"));
  expect(last.bottom, "the last result can be scrolled above the keyboard").toBeLessThanOrEqual(visible + 0.5);
  await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event("resize")); });
  await expect.poll(async () => page.evaluate(() => document.getElementById("simple-more").style.bottom)).toBe("");
});
