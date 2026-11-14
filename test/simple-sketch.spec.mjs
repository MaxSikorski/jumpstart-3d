// Sketching in Simple Beginner (src/simplemode.js): while a sketch is open, J.Siwek's sketch tools show above the view.
// Build 36 hid them with the rest of his ribbon, so a sketch had a palette but no Line, Rectangle, Circle or Finish button.
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";

const settle = async (page) => { for (let ok = 0; ok < 2;) { await page.waitForTimeout(200); ok = (await page.evaluate(() => !window.__app.vp.isMoving())) ? ok + 1 : 0; } };
const clientOf = (page, pt) => page.evaluate(([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);

let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); await page.evaluate(() => window.__app.setFace("simple", true)); });
test.afterEach(() => expect(errors).toEqual([]));

for (const layout of ["default", "clean"]) {
  test(`Simple Beginner (${layout} layout): a sketch shows Line, Rectangle, Circle and Finish, and a rectangle drawn with them is a closed profile`, async ({ page }) => {
    if (layout !== "default") await page.evaluate((l) => { document.documentElement.dataset.layout = l; }, layout);
    await page.evaluate(() => window.__app.setMode("beginner"));
    await expect(page.locator("#sr-sketch")).toBeVisible();
    await expect(page.locator("#ribbon")).toBeHidden();
    await page.click("#sr-sketch");
    await page.locator("#plane-seg button").first().click();
    for (const id of ["sk-line", "sk-rect", "sk-circle", "sk-finish"]) await expect(page.locator("#" + id)).toBeVisible();
    const ribbon = await page.locator("#ribbon").boundingBox(), view = await page.locator("#viewport").boundingBox();
    expect(ribbon.y + ribbon.height, "the tools sit above the view, not over it").toBeLessThanOrEqual(view.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll").toBe(true);
    await settle(page);
    const a = await clientOf(page, [-10, -10, 0]), b = await clientOf(page, [10, 10, 0]);
    await page.click("#sk-rect");
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await expect.poll(() => page.evaluate(() => window.__store.doc.sketches.at(-1)?.ents.filter((e) => e.t === "line").length ?? 0)).toBe(4);
    await page.keyboard.press("Escape");
    await page.click("#sk-finish");
    await expect.poll(() => page.evaluate(() => window.__app.sketcher.active || null)).toBeNull();
    await expect(page.locator("#ribbon")).toBeHidden();
    await expect(page.locator("#sr-sketch")).toBeVisible();
    await settle(page);
    const mid = await clientOf(page, [0, 0, 0]);
    await page.mouse.click(mid.x, mid.y);
    await expect.poll(() => page.evaluate(() => window.__app.command?.title ?? null)).toBe("Extrude");
    await expect(page.locator("#cmd")).toContainText(/1\s*profile selected/);
  });
}
