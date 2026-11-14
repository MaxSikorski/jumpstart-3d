// Simple Beginner rail, panels and layout. Run in both builds and the mobile project.
import { test, expect } from "@playwright/test";
import { boot, waitIdle, watchErrors } from "./helpers.mjs";

async function expectVerdict(locator, state) {
  await expect.poll(async () => {
    const status = await locator.evaluate(el => [el.dataset.state, el.getAttribute("aria-busy")]);
    return status[0] === state && status[1] === "false";
  }, { timeout: 30000 }).toBe(true);
}

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

test("selected shape panel keeps the inspector and proxies", async ({ page }, info) => {
  await page.evaluate(() => { const id = JS3D.add("box", { size: [20, 20, 20] }); JS3D.select([id]); });
  await waitIdle(page);
  const panel = page.locator("#simple-panel");
  await expect(panel).toBeVisible();
  if (info.project.name === "mobile") await page.click("#simple-sheet-handle"); // a phone opens the sheet collapsed to its handle
  await expect(panel.locator("#inspector")).toBeVisible();
  await expectVerdict(panel.locator("#simple-ready"), "ready");
  for (const id of ["drop", "dup", "mirror", "shell", "fillet", "del"]) await expect(panel.locator(`[data-for="bb-${id}"]`)).toHaveCount(1);
  await page.locator("#insp-w").fill("30"); await page.locator("#insp-w").press("Enter"); await waitIdle(page);
  expect(await page.evaluate(() => window.__app.selected()[0].node.p.w)).toBe(30);
  await page.locator("#insp-pos2").fill("5"); await page.locator("#insp-pos2").press("Enter"); await waitIdle(page);
  await expectVerdict(panel.locator("#simple-ready"), "fail");
  await panel.locator('[data-for="bb-drop"]').click(); await waitIdle(page);
  await expectVerdict(panel.locator("#simple-ready"), "ready");
  await panel.locator(".solidhole button").nth(1).click();
  expect(await page.evaluate(() => window.__app.selected()[0].hole)).toBe(true);
  await panel.locator('[data-for="bb-del"]').click(); await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  await page.evaluate(() => window.__app.setFace("original", true));
  await expect(page.locator("#viewport > #inspector")).toHaveCount(1);
});

test("plate panel and sphere check", async ({ page }, info) => {
  if (info.project.name !== "mobile") await expect(page.locator("#simple-panel")).toContainText("The plate");
  await page.evaluate(() => { const id = JS3D.add("sphere", { size: [20, 20, 20] }); JS3D.select([id]); });
  await waitIdle(page);
  await expect(page.locator("#simple-panel")).toBeVisible();
  if (info.project.name === "mobile") { await page.click("#simple-sheet-handle"); await expect(page.locator("#simple-sheet-handle")).toHaveAttribute("aria-expanded", "true"); }
  await expectVerdict(page.locator("#simple-ready"), "warn");
});
