// Issue #163: the Move tool's "Drag shape" choice. A new user pressing Move should be able to drag along all axes at once, so
// "Free in 3D" is listed first and is the one selected; "Free on ground" is the second choice and keeps the shape on its height.
// Proof from the user's side: open Move on a box, read the two buttons, drag the box upward on screen and read the Z box.
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";
import { open, spotOnBox } from "./rotation-oracle.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => { // a page per test, so one failure does not hide the others
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const field = async (id) => Number(await page.inputValue("#" + id));
const heightNow = () => run(() => window.__store.doc.bodies[0].m[14]);

async function openMove() {
  await open("advanced", page);
  await run(() => window.__app.select(["b1"])); // the hint and the handles belong to a selected shape
  await page.click("#ad-transform");
  await page.click("#ad-move");
  await expect(page.locator("#cmd")).toContainText("Move / Copy");
}
// press on the box's top face and drag straight up the screen
async function dragUp(px) {
  const p = await spotOnBox(page);
  expect(p, "a visible spot on the box").not.toBeNull();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y - px, { steps: 12 });
  await page.mouse.up();
}

test("Move opens with Free in 3D first and selected; Free on ground is the second choice", async () => {
  await openMove();
  const buttons = page.locator("#mv-drag button");
  await expect(buttons).toHaveText(["Free in 3D", "Free on ground"]);
  await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#hint")).toContainText("move it in 3D"); // the hint matches the choice
});

test("with the default, dragging the box up the screen raises it, and OK keeps the new height in one undo step", async () => {
  await openMove();
  const z0 = await heightNow();
  const depth = await run(() => window.__store.undoStack.length);
  await dragUp(80);
  await expect.poll(() => field("mv-d2")).toBeGreaterThan(1); // the height box moved, nothing was chosen first
  expect(Math.abs(await field("mv-d0")) + Math.abs(await field("mv-d1")), "a free drag also moves sideways; an arrow drag could not").toBeGreaterThan(0);
  const dz = await field("mv-d2");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await heightNow()).toBeCloseTo(z0 + dz, 3);
  expect(await run(() => window.__store.undoStack.length)).toBe(depth + 1);
});

test("choosing Free on ground still keeps the box at its height: the same drag changes X and Y only", async () => {
  await openMove();
  await page.locator("#mv-drag button", { hasText: "Free on ground" }).click();
  await expect(page.locator("#mv-drag button").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hint")).toContainText("move it on the ground"); // the other hint, still pointing at Free in 3D
  await expect(page.locator("#hint")).toContainText("Choose Free in 3D");
  await dragUp(80);
  await expect.poll(async () => Math.abs(await field("mv-d0")) + Math.abs(await field("mv-d1"))).toBeGreaterThan(1);
  expect(await field("mv-d2")).toBe(0);
});
