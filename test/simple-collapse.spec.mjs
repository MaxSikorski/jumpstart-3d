// Simple panel controls run on both builds and the mobile project.
import { test, expect } from "@playwright/test";
import { boot, reload, waitIdle, watchErrors } from "./helpers.mjs";

let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); await page.evaluate(() => window.__app.setFace("simple", true)); });
test.afterEach(() => expect(errors).toEqual([]));

for (const part of ["rail", "panel", "top", "bottom"]) {
  test(`${part} hides and its handle brings it back`, async ({ page }, info) => {
    if (part === "panel" && info.project.name === "mobile") {
      await page.evaluate(() => { const id = JS3D.add("box", { size: [20, 20, 20] }); JS3D.select([id]); }); await waitIdle(page);
    }
    const button = page.locator(`#simple-collapse-${part}`);
    const size = () => page.locator("#viewport").evaluate(e => ({ width: e.clientWidth, height: e.clientHeight }));
    const initial = await size();
    await button.click(); await expect(button).toBeVisible(); await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("html")).toHaveAttribute("data-simple-hide", new RegExp(`\\b${part}\\b`));
    const closed = await size();
    if (part === "top" || part === "bottom" || (part === "rail" && info.project.name === "mobile")) expect(closed.height).toBeGreaterThan(initial.height);
    if (info.project.name !== "mobile" && (part === "rail" || part === "panel")) expect(closed.width).toBeGreaterThan(initial.width);
    await button.click(); await expect(button).toHaveAttribute("aria-expanded", "true");
  });
}

test("whole plate restores the previous mix across reload and uses Home framing", async ({ page }) => {
  await page.click("#simple-collapse-rail");
  await page.evaluate(() => { const vp = window.__app.vp, original = vp.setView; window.__homeCalls = []; vp.setView = function (...args) { window.__homeCalls.push(args[0]); return original.apply(this, args); }; });
  await page.click("#simple-whole-plate");
  await expect(page.locator("#simple-whole-plate")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-simple-hide", "rail panel top bottom");
  await expect.poll(() => page.evaluate(() => window.__homeCalls.includes("home"))).toBe(true);
  await reload(page);
  await expect(page.locator("#simple-whole-plate")).toHaveAttribute("aria-pressed", "true");
  await page.click("#simple-whole-plate");
  await expect(page.locator("html")).toHaveAttribute("data-simple-hide", "rail");
  await reload(page); await expect(page.locator("html")).toHaveAttribute("data-simple-hide", "rail");
  await page.keyboard.press("Shift+Alt+P"); await expect(page.locator("#simple-whole-plate")).toHaveAttribute("aria-pressed", "true");
});

test("Original hides controls and layouts have no horizontal overflow", async ({ page }, info) => {
  if (info.project.name !== "mobile") await page.setViewportSize({ width: 1366, height: 768 });
  await page.click("#simple-whole-plate");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.__app.setFace("original", true));
  for (const id of ["rail", "panel", "top", "bottom"]) await expect(page.locator(`#simple-collapse-${id}`)).toBeHidden();
  await expect(page.locator("#simple-whole-plate")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
