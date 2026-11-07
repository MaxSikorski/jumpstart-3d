// Simple | Original switch: persistence, menu, first-run card, responsive layout and studio boundaries.
import { test, expect } from "@playwright/test";
import { boot, reload, waitIdle, watchErrors } from "./helpers.mjs";

let errors;
test.beforeEach(async ({ page }) => { errors = watchErrors(page); });
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); });

const mobile = (info) => info.project.name === "mobile";
const face = (page) => page.locator("html");
const storedFace = (page) => page.evaluate(() => localStorage.getItem("jumpstart.face"));
const ready = (page) => page.waitForFunction(() => window.__app?.projects?.started === true, null, { timeout: 90_000 });

test("Original is the default", async ({ page }, info) => {
  await boot(page, info);
  await expect(face(page)).toHaveAttribute("data-face", "original");
  await expect(page.locator("#face-original")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#face-more")).toBeHidden();
  if (!mobile(info)) await expect(page.locator("#btn-projects")).toBeVisible();
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("switching keeps the design and persists the choice", async ({ page }, info) => {
  await boot(page, info);
  await page.locator('#shapes .tile[data-kind="box"]').click();
  await waitIdle(page);
  const count = await page.evaluate(() => window.__store.doc.bodies.length);
  expect(count).toBeGreaterThan(0);
  await page.click("#face-simple");
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#face-simple")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#face-original")).toHaveAttribute("aria-pressed", "false");
  expect(await storedFace(page)).toBe("simple");
  await expect(page.locator("#btn-tutorials .lbl")).toHaveText("Learn");
  await expect(page.locator("#btn-export .lbl")).toHaveText("Print / Export");
  await expect(page.locator("#btn-autosave")).toBeHidden();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(count);
  await reload(page);
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await page.click("#face-original");
  await expect(face(page)).toHaveAttribute("data-face", "original");
  if (!mobile(info)) await expect(page.locator("#btn-projects")).toBeVisible();
  await expect(page.locator("#btn-tutorials .lbl")).toHaveText("Tutorials");
  await expect(page.locator("#btn-export .lbl")).toHaveText("Open/Export");
});

test("More opens the existing dialogs and supports keyboard navigation", async ({ page }, info) => {
  await boot(page, info);
  await page.click("#face-simple");
  const more = page.locator("#face-more"), menu = page.locator("#menu-face-more");
  await more.click();
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  const items = menu.locator('[role="menuitem"]:visible');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await menu.locator('[data-for="btn-projects"]').click();
  const designs = page.getByRole("dialog", { name: "Your designs" });
  await expect(designs).toBeVisible();
  // Escape, not its Close button: on a 375 px phone his Designs dialog puts Close outside the screen
  await page.keyboard.press("Escape");
  await expect(designs).toBeHidden();
  await more.click();
  await menu.locator('[data-for="btn-theme"]').click();
  const theme = page.locator("#menu-theme");
  await expect(theme).toBeVisible();
  const box = await theme.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});

test("query parameter chooses and stores a face, then is removed", async ({ page }, info) => {
  const base = info.project.use.baseURL;
  const query = (value) => base + (base.includes("?") ? "&" : "?") + `face=${value}&keep=1#kept`;
  await page.goto(query("simple"));
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  expect(await storedFace(page)).toBe("simple");
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({ search: "?keep=1", hash: "#kept" });
  await page.goto(query("original"));
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "original");
  expect(await storedFace(page)).toBe("original");
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({ search: "?keep=1", hash: "#kept" });
});

test("Not now dismisses the first-run card permanently", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await expect(page.locator("#try-simple")).toBeVisible();
  expect(await page.evaluate(() => window.__app.trySimpleShown)).toBe(true);
  await page.click("#try-simple-no");
  await expect(page.locator("#try-simple")).toHaveCount(0);
  expect(await storedFace(page)).toBe("original");
  await reload(page);
  await ready(page);
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("the switch dismisses the first-run card", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await expect(page.locator("#try-simple")).toBeVisible();
  await page.click("#face-simple");
  await expect(page.locator("#try-simple")).toHaveCount(0);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await reload(page);
  await ready(page);
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("Try Simple selects Simple", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await expect(page.locator("#try-simple")).toBeVisible();
  await page.click("#try-simple-yes");
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("existing preferences suppress the first-run card", async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem("workplane.ui.v1", "{}"); } catch (e) {} });
  await boot(page, info, { face: false });
  await expect(page.locator("#try-simple")).toHaveCount(0);
  await expect(face(page)).toHaveAttribute("data-face", "original");
});

test("the existing layout is called Big buttons", async ({ page }, info) => {
  await boot(page, info);
  // The original theme button is hidden on narrow phones, but its own handler is still usable.
  if (mobile(info)) await page.locator("#btn-theme").evaluate((button) => button.click());
  else await page.click("#btn-theme");
  await expect(page.locator('#menu-theme button[data-layout="simple"]')).toHaveText(/^Big buttons/);
  await expect(page.locator("#menu-theme button", { hasText: "Simplified" })).toHaveCount(0);
});

test("neither face scrolls sideways", async ({ page }, info) => {
  await boot(page, info);
  const widths = mobile(info) ? [375, 390] : [1400, 1366, 1024, 820];
  for (const name of ["original", "simple"]) {
    await page.evaluate((n) => window.__app.setFace(n, true), name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at the project viewport`).toBe(true);
  }
  for (const width of widths) {
    await page.setViewportSize({ width, height: mobile(info) ? 667 : 880 });
    for (const name of ["original", "simple"]) {
      await page.evaluate((n) => window.__app.setFace(n, true), name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}px`).toBe(true);
    }
  }
});

test("Simple top bar steps aside in Architect", async ({ page }, info) => {
  await boot(page, info);
  await page.click("#face-simple");
  await page.evaluate(() => window.__app.switchMode("arch"));
  await expect(page.locator("#mode-arch")).toBeVisible();
  await expect(page.locator("#face-more")).toBeHidden();
  await page.evaluate(() => window.__app.switchMode("beginner"));
  await expect(page.locator("#face-more")).toBeVisible();
});

test("the switch never puts the Original top bar on a second row; Settings › Look switches too", async ({ page }, info) => {
  test.skip(mobile(info), "phones give the switch its own row by design");
  await boot(page, info);
  const oneRow = () => page.evaluate(() => document.querySelector(".topbar").offsetHeight < 50);
  for (const width of [1920, 1440, 1366, 1280]) {
    await page.setViewportSize({ width, height: 880 });
    await expect.poll(oneRow, { message: `Original at ${width}px is one row` }).toBe(true);
    await expect(page.locator("#face-simple"), `the way to Simple shows at ${width}px`).toBeVisible();
  }
  await page.setViewportSize({ width: 1024, height: 880 });
  await expect.poll(oneRow, { message: "Original at 1024px is one row" }).toBe(true);
  await page.click("#btn-theme");
  await page.click("#face-menu-simple");
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#face-original")).toBeVisible();
  await expect.poll(oneRow, { message: "Simple at 1024px is one row" }).toBe(true);
  await page.click("#face-more");
  await page.click('#menu-face-more [data-for="btn-theme"]');
  await expect(page.locator("#face-menu-simple")).toHaveAttribute("aria-checked", "true");
  await page.click("#face-menu-original");
  await expect(face(page)).toHaveAttribute("data-face", "original");
});
