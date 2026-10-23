// Issue #87: fine rotation without a keyboard. Requester's answer to "What should it end up as?": "Having an option to activate fine
// rotation in the lower info line beside unit selector could enable rotation with the arrows in finer degrees. As an added benefit
// adding the possibility to also adjust in 0.5 and 0.1 degree would make it more versatile. Lastly the "Snap" feature could be
// expanded with a Degree Snap "back" to been aligned with the grid."
// Proof: in the status bar, a Turn control (axis, step 15 / 5 / 1 / 0.5 / 0.1 degrees, - and +, Snap back) turns the selected shape
// about the middle of its box, one undo step per press; on a touch screen the same buttons work by tap and are 44 px. Every turn is
// compared with a rotation worked out in test/rotation-oracle.mjs, never with the app's own matrix code.
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";
import { tablet, touchPage, M0, turned, turnedBox, expectMatrix, expectBox, open, spotOnBox } from "./rotation-oracle.mjs";

let page, errors;
const run = (fn, arg) => page.evaluate(fn, arg);
const matrix = (p = page) => p.evaluate(() => window.__store.doc.bodies[0].m);
const undoDepth = (p = page) => p.evaluate(() => window.__store.undoStack.length);
const centre = (b) => [0, 1, 2].map((i) => (b[i] + b[i + 3]) / 2);
async function clickBox() {
  const s = await spotOnBox(page);
  expect(s, "a visible spot on the box").not.toBeNull();
  await page.mouse.click(s.x, s.y);
  await expect.poll(() => run(() => window.__app.sel.join(","))).toBe("b1");
}
// press a status-bar button and wait for the shape to change
async function press(id, p = page, tap = false) {
  const before = await matrix(p);
  await (tap ? p.locator(id).tap() : p.locator(id).click());
  await expect.poll(() => matrix(p)).not.toEqual(before);
  return before;
}

test.describe("desktop", () => {
  test.beforeEach(async ({ browser }, info) => {
    page = await browser.newPage();
    errors = watchErrors(page);
    await boot(page, info);
  });
  test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

  test("Beginner: the Turn control beside the unit switch offers 15, 5, 1, 0.5 and 0.1; each - or + is one undo step of that many degrees about the box's middle", async () => {
    const box0 = await open("beginner", page);
    const C = centre(box0);
    await clickBox();
    await expect(page.locator("#unit-toggle")).toBeVisible();
    await expect(page.locator("#turn-step option")).toHaveText(["15°", "5°", "1°", "0.5°", "0.1°"]);
    const depth = await undoDepth();

    let n = 0;
    await page.selectOption("#turn-axis", "x");
    for (const [step, sign, id] of [[15, 1, "#turn-plus"], [5, 1, "#turn-plus"], [0.5, 1, "#turn-plus"], [0.1, 1, "#turn-plus"], [0.1, -1, "#turn-minus"]]) {
      await page.selectOption("#turn-step", String(step));
      const before = await press(id);
      n++;
      expectMatrix(await matrix(), turned("x", sign * step, C, before));
      expect(await undoDepth(), `after ${n} presses`).toBe(depth + n);
    }
    await expectBox(turnedBox("x", 15 + 5 + 0.5, box0));
    // the default axis is Z, the default step 1 degree
    await page.selectOption("#turn-axis", "z");
    await page.selectOption("#turn-step", "1");
    const before = await press("#turn-minus");
    expectMatrix(await matrix(), turned("z", -1, C, before));
    for (let i = 0; i < n + 1; i++) await page.click("#btn-undo");
    expect(await matrix()).toEqual(M0);
    await expectBox(box0);
  });

  test("Beginner: Snap back lines a turned shape up with the grid in one undo step; already lined up changes nothing", async () => {
    const box0 = await open("beginner", page);
    const C = centre(box0);
    // put the shape in a pose, selected, and wait until it is drawn there
    const set = async (m) => {
      await run((m) => { window.__store.update((d) => { d.bodies[0].m = m; }, "Turn"); window.__app.select(["b1"]); }, m);
      await expect.poll(() => run((m) => { const e = window.__app.scene.views.get("b1").group.matrix.elements; return e.every((v, i) => Math.abs(v - m[i]) < 1e-9); }, m)).toBe(true);
    };
    const depth = await undoDepth();

    await set(turned("z", 50, C)); // 50 is nearer 90 than 0
    await page.click("#turn-back");
    await expect.poll(() => matrix()).not.toEqual(turned("z", 50, C));
    expectMatrix(await matrix(), turned("z", 90, C));
    expect(await undoDepth()).toBe(depth + 2); // the set-up and the snap back
    await expectBox(turnedBox("z", 90, box0));
    await page.click("#btn-undo");
    expectMatrix(await matrix(), turned("z", 50, C));
    await page.click("#btn-redo");
    // already there: no new step
    await page.click("#turn-back");
    await expect(page.locator("#toasts")).toContainText("Already lined up");
    expect(await undoDepth()).toBe(depth + 2);

    // a small tilt on top is taken out too
    await set(turned("x", 10, C, turned("z", 50, C)));
    await page.click("#turn-back");
    await expect.poll(async () => (await matrix())[6]).toBeCloseTo(0, 6); // no tilt left
    expectMatrix(await matrix(), turned("z", 90, C));

    await set(turned("z", -20, C)); // near 0: back to where it started
    await page.click("#turn-back");
    await expect.poll(async () => Math.abs((await matrix())[1])).toBeLessThan(1e-9);
    expectMatrix(await matrix(), M0);
  });

  test("Advanced: with nothing open − and + turn at once; inside Move / Rotate they add to the pending turn (OK commits one step); the , and . keys use the step", async () => {
    const box0 = await open("advanced", page);
    const C = centre(box0);
    await clickBox();
    const depth = await undoDepth();

    await page.selectOption("#turn-step", "5");
    const before = await press("#turn-plus");
    expectMatrix(await matrix(), turned("z", 5, C, before));
    expect(await undoDepth()).toBe(depth + 1);

    await page.click("#ad-moverot");
    await expect(page.locator("#cmd")).toContainText("Move / Copy");
    await page.selectOption("#turn-step", "0.5");
    await page.click("#turn-plus");
    await page.click("#turn-plus");
    await expect(page.locator("#mv-r2")).toHaveValue("1");
    expect(await undoDepth(), "a pending turn is not a step yet").toBe(depth + 1);
    await page.keyboard.press("Period");
    await expect(page.locator("#mv-r2")).toHaveValue("1.5");
    await page.selectOption("#turn-axis", "x");
    await page.click("#turn-minus");
    await expect(page.locator("#mv-r0")).toHaveValue("-0.5");
    await page.click("#turn-back"); // Snap back does not run while the tool is open
    await expect(page.locator("#toasts")).toContainText("Finish or cancel");
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    expect(await undoDepth()).toBe(depth + 2);
    const after = await matrix();
    expect(after).not.toEqual(before);
    await page.click("#btn-undo");
    expectMatrix(await matrix(), before);
  });

  test("a locked shape does not turn, and nothing selected says so", async () => {
    await open("beginner", page);
    await run(() => { window.__store.update((d) => { d.bodies[0].locked = true; }, "Lock"); window.__app.select(["b1"]); });
    const depth = await undoDepth();
    await page.click("#turn-plus");
    await expect(page.locator("#toasts")).toContainText("Locked");
    expect(await matrix()).toEqual(M0);
    expect(await undoDepth()).toBe(depth);
    await run(() => window.__app.select([]));
    await page.click("#turn-plus");
    await expect(page.locator("#toasts")).toContainText("Select a shape");
  });
});

// ------------------------------------------------------------------------------------------------ touch (Chromium)
test("touch (tablet): tapping − and + turns by the chosen step, and the status bar's Turn controls are 44 px", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  const { ctx, p, errs } = await touchPage(browser, info, tablet);
  try {
    const box0 = await open("beginner", p);
    const C = centre(box0);
    const spot = await spotOnBox(p);
    await p.touchscreen.tap(spot.x, spot.y);
    await expect.poll(() => p.evaluate(() => window.__app.sel.join(","))).toBe("b1");
    await expect(p.locator("html")).toHaveClass(/touch-ui/);
    const sizes = await p.evaluate(() => ["turn-axis", "turn-step", "turn-minus", "turn-plus", "turn-back"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.width, r.height]; }));
    for (const [id, w, h] of sizes) { expect(w, id + " width").toBeGreaterThanOrEqual(44); expect(h, id + " height").toBeGreaterThanOrEqual(44); }

    await p.selectOption("#turn-step", "0.5");
    const depth = await undoDepth(p);
    let m = await press("#turn-plus", p, true);
    m = await press("#turn-plus", p, true);
    await press("#turn-minus", p, true);
    expectMatrix(await matrix(p), turned("z", 0.5, C, M0)); // +0.5 +0.5 -0.5
    expect(await undoDepth(p)).toBe(depth + 3);
    void m;

    // Snap back by tap: tilt it 50, then tap
    await p.evaluate((m) => { window.__store.update((d) => { d.bodies[0].m = m; }, "Turn"); }, turned("z", 50, C));
    await p.locator("#turn-back").tap();
    await expect.poll(() => matrix(p)).not.toEqual(turned("z", 50, C));
    expectMatrix(await matrix(p), turned("z", 90, C));
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});

test("phone: the Turn controls fit the status bar and are 44 px", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  const { ctx, p, errs } = await touchPage(browser, info, { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  try {
    await open("beginner", p);
    await p.touchscreen.tap(8, 400); // any touch puts the page in touch mode
    await expect(p.locator("html")).toHaveClass(/touch-ui/);
    const r = await p.evaluate(() => {
      const bar = document.querySelector("footer.status").getBoundingClientRect();
      return { bar: [bar.left, bar.right], items: ["turn-axis", "turn-step", "turn-minus", "turn-plus", "turn-back"].map((id) => { const q = document.getElementById(id).getBoundingClientRect(); return [id, q.width, q.height, q.left, q.right]; }) };
    });
    for (const [id, w, h, left, right] of r.items) {
      expect(w, id + " width").toBeGreaterThanOrEqual(44); expect(h, id + " height").toBeGreaterThanOrEqual(44);
      expect(left, id + " inside the bar").toBeGreaterThanOrEqual(r.bar[0] - 0.5); expect(right, id + " inside the bar").toBeLessThanOrEqual(r.bar[1] + 0.5);
    }
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});
