// Simple Beginner rail, panels and layout. Run in both builds and the mobile project.
import { test, expect } from "@playwright/test";
import { boot, waitIdle, watchErrors } from "./helpers.mjs";

let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); await page.evaluate(() => window.__app.setFace("simple", true)); });
test.afterEach(() => expect(errors).toEqual([]));

test("rail proxies every ribbon tool and mirrors state", async ({ page }, info) => {
  await expect(page.locator("#ribbon")).toBeHidden();
  await expect(page.locator("#simple-rail")).toBeVisible();
  const ids = await page.locator("#simple-rail > button").evaluateAll((bs) => bs.map((b) => b.id));
  expect(ids).toEqual(["sr-shapes", "sr-sketch", "sr-import", "sr-move", "sr-hole", "sr-group", "sr-align", "sr-fillet", "sr-measure", "sr-more"]);
  const missing = await page.evaluate(() => [...document.querySelectorAll('#ribbon .bbar button[id^="bb-"]')].map((b) => b.id).filter((id) => !document.querySelector(`#simple-rail [data-for="${id}"], #simple-shapes [data-for="${id}"], #simple-more [data-for="${id}"]`)));
  expect(missing).toEqual([]);
  await page.click("#sr-more");
  await expect(page.locator('#simple-more [data-for="bb-dup"]')).toBeDisabled();
  await page.fill("#simple-find", "fillet");
  await expect(page.locator('#simple-more [data-for="bb-fillet"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#simple-more")).toBeHidden(); await expect(page.locator("#sr-more")).toBeFocused();
  await page.click("#sr-more"); await page.fill("#simple-find", "fillet"); await page.keyboard.press("Enter");
  await expect(page.locator("#simple-more")).toBeHidden();
  expect(info.project.name === "mobile" ? await page.locator("#simple-rail > button:visible").count() : ids.length).toBe(info.project.name === "mobile" ? 7 : 10);
});

test("rail Group cuts a cylinder hole and switching preserves the design", async ({ page }) => {
  await page.evaluate(() => { const a = JS3D.add("box", { size: [40, 30, 20] }); const b = JS3D.add("cylinder", { size: [8, 8, 30], at: [0, 0, -5], hole: true }); JS3D.select([a, b]); });
  await waitIdle(page); await page.click("#sr-group"); await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
  expect(await page.evaluate(() => window.__store.doc.bodies[0].node.t)).toBe("group");
  await page.evaluate(() => window.__app.setFace("original", true));
  await expect(page.locator("#ribbon")).toBeVisible(); await expect(page.locator("#simple-rail")).toBeHidden();
  await page.evaluate(() => window.__app.setFace("simple", true));
  await expect(page.locator("#simple-rail")).toBeVisible(); expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
});

for (const [width, height] of [[1366, 768], [1280, 800], [1024, 768], [820, 1180]]) {
  test(`layout fits ${width}x${height}`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "desktop viewport sizes");
    await page.setViewportSize({ width, height });
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, boxes: ["simple-rail", "viewport", "shapes"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.right]; }) }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.width); for (const [left, right] of fit.boxes) { expect(left).toBeGreaterThanOrEqual(0); expect(right).toBeLessThanOrEqual(fit.width); }
  });
}
test("mobile layout fits", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "mobile project");
  const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, boxes: ["simple-rail", "viewport", "shapes"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.right]; }) }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.width); for (const [left, right] of fit.boxes) { expect(left).toBeGreaterThanOrEqual(0); expect(right).toBeLessThanOrEqual(fit.width); }
});
