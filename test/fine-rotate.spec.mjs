// Issue #87: fine rotation without a keyboard. Requester's answer to "What should it end up as?": "Having an option to activate fine
// rotation in the lower info line beside unit selector could enable rotation with the arrows in finer degrees. As an added benefit
// adding the possibility to also adjust in 0.5 and 0.1 degree would make it more versatile. Lastly the "Snap" feature could be
// expanded with a Degree Snap "back" to been aligned with the grid."
// Proof: in the status bar, a Turn control (axis, step 15 / 5 / 1 / 0.5 / 0.1 degrees, - and +, Snap back) turns the selected shape
// about the middle of its box, one undo step per press; on a touch screen the same buttons work by tap and are 44 px. Every turn is
// compared with a rotation worked out in test/rotation-oracle.mjs, never with the app's own matrix code.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";
import { tablet, touchPage, M0, BOX, mul, rot, tr, turned, turnedBox, expectMatrix, expectBox as expectBoxOf, open, spotOnBox } from "./rotation-oracle.mjs";

let page, errors;
const expectBox = (want, p = page) => expectBoxOf(want, p);
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

const MIRROR = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, -12, 5, 1]; // M0 flipped left-right (Beginner's Mirror): determinant -1
const det = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
const mirroredTurned = (deg) => { const m = mul(rot("z", deg), MIRROR); m[12] = 30; m[13] = -12; m[14] = 5; return m; };
// put the shape in a pose, selected, and wait until it is drawn there
async function setPose(m) {
  await run((m) => { window.__store.update((d) => { d.bodies[0].m = m; }, "Pose"); window.__app.select(["b1"]); }, m);
  await expect.poll(() => run((m) => { const e = window.__app.scene.views.get("b1").group.matrix.elements; return e.every((v, i) => Math.abs(v - m[i]) < 1e-9); }, m)).toBe(true);
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

  test("Beginner: − and + with two different boxes selected turn both about the pivot (the combined middle, taken once), so +5 then −5 puts back both exact matrices", async () => {
    const M1 = tr(110, 30, 0), REF = { w: 30, d: 30, h: 30, r: 0, c: 0 }; // a lopsided pair: the combined box's middle moves when they turn
    await loadDoc(page, newDoc("fine two", "beginner", { bodies: [body("b1", "Box", prim("box", BOX), M0), body("b2", "Cube", prim("box", REF), M1)] }));
    await run(() => { window.__app.vp.fit(window.__app.scene.allBox()); window.__app.select(["b1", "b2"]); });
    const mats = () => run(() => window.__store.doc.bodies.map((b) => b.m));
    const union = await run(() => { const u = window.__app.scene.bodyTightBox("b1").clone().union(window.__app.scene.bodyTightBox("b2")); return [...u.min.toArray(), ...u.max.toArray()]; });
    const C = centre(union);
    await page.selectOption("#turn-step", "5");
    const depth = await undoDepth();
    await page.click("#turn-plus");
    await expect.poll(() => undoDepth()).toBe(depth + 1);
    let got = await mats();
    expectMatrix(got[0], turned("z", 5, C, M0));
    expectMatrix(got[1], turned("z", 5, C, M1));
    await page.click("#turn-minus");
    await expect.poll(() => undoDepth()).toBe(depth + 2);
    got = await mats();
    expectMatrix(got[0], M0);
    expectMatrix(got[1], M1);
  });

  test("Beginner: − / + turn about a pivot typed in the Pivot X / Y / Z fields (the dot the user sees), not the shape's middle", async () => {
    const box0 = await open("beginner", page);
    await run(() => window.__app.select(["b1"]));
    const P = [12.5, -7.25, 3.125];
    for (const [i, v] of P.entries()) { await page.fill("#insp-piv" + i, String(v)); await page.locator("#insp-piv" + i).blur(); }
    await page.selectOption("#turn-step", "5");
    const depth = await undoDepth();
    await page.click("#turn-plus");
    await expect.poll(() => undoDepth()).toBe(depth + 1);
    expectMatrix(await matrix(), turned("z", 5, P, M0));
    // the world box equals the eight corners turned about P (worked out here)
    const R = rot("z", 5), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const x of [box0[0], box0[3]]) for (const y of [box0[1], box0[4]]) for (const z of [box0[2], box0[5]]) {
      const d = [x - P[0], y - P[1], z - P[2]];
      [0, 1, 2].forEach((r) => { const v = R[r] * d[0] + R[4 + r] * d[1] + R[8 + r] * d[2] + P[r]; lo[r] = Math.min(lo[r], v); hi[r] = Math.max(hi[r], v); });
    }
    await expectBox([...lo, ...hi]);
    await page.click("#turn-minus");
    await expect.poll(() => undoDepth()).toBe(depth + 2);
    expectMatrix(await matrix(), M0);
  });

  test("Beginner: Snap back keeps a mirrored shape mirrored (determinant stays -1); a mirrored shape already square says so", async () => {
    await open("beginner", page);
    await setPose(mirroredTurned(20));
    const depth = await undoDepth();
    await page.click("#turn-back");
    await expect.poll(() => undoDepth()).toBe(depth + 1);
    const m = await matrix();
    expect(det(m), "still mirrored, not un-mirrored").toBeCloseTo(-1, 6);
    expectMatrix(m, MIRROR); // the nearest right-angle pose of the same mirrored shape, back where it stood
    await page.click("#turn-back");
    await expect(page.locator("#toasts")).toContainText("Already lined up");
    expect(await undoDepth()).toBe(depth + 1);
  });

  test("Beginner: − and + turn a wedge about its own middle, so +5 then −5 puts back the exact matrix", async () => {
    await loadDoc(page, newDoc("fine wedge", "beginner", { bodies: [body("b1", "Wedge", prim("wedge", BOX), M0)] }));
    await run(() => { window.__app.vp.fit(window.__app.scene.allBox()); window.__app.select(["b1"]); });
    await page.selectOption("#turn-axis", "y"); // the wedge is a triangle across Y: its world box middle moves when it turns
    await page.selectOption("#turn-step", "5");
    const depth = await undoDepth();
    await press("#turn-plus");
    await expect.poll(() => undoDepth()).toBe(depth + 1);
    await press("#turn-minus");
    await expect.poll(() => undoDepth()).toBe(depth + 2);
    expectMatrix(await matrix(), M0);
  });

  test("Advanced: after picking a step the , and . keys still work (the dropdown lets go of the keyboard)", async () => {
    await open("advanced", page);
    await clickBox();
    await page.click("#ad-moverot");
    await expect(page.locator("#cmd")).toContainText("Move / Copy");
    await page.focus("#turn-step");
    await page.selectOption("#turn-step", "5");
    await page.keyboard.press("Period");
    await expect(page.locator("#mv-r2")).toHaveValue("5");
    await page.focus("#turn-axis"); // the keys always turn the ring last touched (Z here); the axis dropdown only lets go of the keyboard
    await page.selectOption("#turn-axis", "x");
    expect(await run(() => document.activeElement.tagName), "focus left the axis dropdown").not.toBe("SELECT");
  });

  test("Advanced: with nothing open − and + turn at once; inside Move / Rotate they add to the pending turn (OK commits one step); the , and . keys use the step", async () => {
    const box0 = await open("advanced", page);
    const C = centre(box0);
    await clickBox();
    const depth = await undoDepth();

    await page.selectOption("#turn-step", "5");
    const before = await press("#turn-plus");
    expectMatrix(await matrix(), turned("z", 5, C, before));
    const after5 = await matrix();
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
    expect(after).not.toEqual(after5);
    await page.click("#btn-undo");
    expectMatrix(await matrix(), after5); // the open tool's turn was one step; the button turn before it stays
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
    expect(await p.evaluate(() => getComputedStyle(document.getElementById("hint")).display), "the hint line stays on an iPad").not.toBe("none");
    expect(await p.evaluate(() => document.querySelector("footer.status").getBoundingClientRect().width), "the status bar stays as wide as the screen").toBeLessThanOrEqual(820);
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

test("phone: the Turn row is hidden and the status bar stays as on main (30 px or less, size readout visible)", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  const { ctx, p, errs } = await touchPage(browser, info, { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  try {
    await open("beginner", p);
    await p.touchscreen.tap(8, 400); // any touch puts the page in touch mode
    await expect(p.locator("html")).toHaveClass(/touch-ui/);
    await p.evaluate(() => window.__app.select(["b1"]));
    await expect(p.locator("#turnctl")).toBeHidden();
    await expect(p.locator("#selinfo")).toBeVisible();
    await expect(p.locator("#selinfo")).not.toHaveText("");
    expect(await p.evaluate(() => document.querySelector("footer.status").getBoundingClientRect().height), "status bar height").toBeLessThanOrEqual(30);
    expect(await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]), "no sideways scroll").toEqual([375, 375]);
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});
