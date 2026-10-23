// The toolbar menus scroll inside themselves when the window is too short for them (the theme menu is long:
// theme, performance, mesh detail, printer, AI agent), so the last row is always reachable.
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const openMenu = async () => {
  await page.click("#btn-theme");
  await expect(page.locator("#menu-theme")).toBeVisible();
};
const metrics = () => page.evaluate(() => {
  const m = document.getElementById("menu-theme");
  const r = m.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, vh: window.innerHeight, scrollH: m.scrollHeight, clientH: m.clientHeight, scrollW: m.scrollWidth, clientW: m.clientWidth };
});

test("short window: the theme menu stays inside the window and scrolls to its last row", async () => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await openMenu();
  const m = await metrics();
  expect(m.bottom, "menu bottom inside the window").toBeLessThanOrEqual(m.vh);
  expect(m.scrollH, "menu is scrollable").toBeGreaterThan(m.clientH);
  expect(m.scrollW, "no sideways scrollbar").toBeLessThanOrEqual(m.clientW);
  const agent = page.locator("#menu-theme button[data-agent]");
  await agent.scrollIntoViewIfNeeded();
  const box = await agent.boundingBox();
  expect(box.y + box.height, "agent row visible").toBeLessThanOrEqual(m.vh);
  await expect(agent).toBeVisible();
  // the Ultra-sized controls inside still work: the mesh detail slider moves
  await page.locator("#detail-range").scrollIntoViewIfNeeded();
  await page.locator("#detail-range").fill("2");
  await expect(page.locator("#detail-level")).toHaveText(/2/);
  await page.locator("#detail-range").fill("1");
  await agent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: process.env.MENU_SHOT || "test-results/menu-scroll.png" });
  await page.click("#btn-theme");
});

test("tall window: the theme menu fits without a scrollbar", async () => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await openMenu();
  const m = await metrics();
  expect(m.scrollH).toBeLessThanOrEqual(m.clientH);
  expect(m.bottom).toBeLessThanOrEqual(m.vh);
  await page.click("#btn-theme");
});
