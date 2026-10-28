import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const DRAW_HINT = "Pick a tool to draw: Line (L), Rectangle (R), Circle (C), or another in the Create group.";
test.use({ viewport: { width: 1400, height: 900 } });
let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); });
test.afterEach(() => { expect(errors).toEqual([]); });

async function settle(page) {
  for (let ok = 0; ok < 2;) {
    await page.waitForTimeout(200);
    ok = await page.evaluate(() => !window.__app.vp.isMoving()) ? ok + 1 : 0;
  }
}
async function clickPoint(page, pt) {
  const p = await page.evaluate(([x, y, z]) => {
    const { vp } = window.__app, r = vp.canvas.getBoundingClientRect();
    vp.updateCamera();
    const s = vp.project(vp.view.target.clone().set(x, y, z));
    return { x: r.left + s[0], y: r.top + s[1] };
  }, pt);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === window.__app.vp.canvas, p)).toBe(true);
  await page.mouse.click(p.x, p.y);
}
async function open(page, mode, extra = {}) {
  await loadDoc(page, newDoc("sketch entry", mode, extra));
  await settle(page);
}
async function entered(page, tool = "select") {
  await page.waitForFunction(() => !!window.__app.sketcher.active);
  await expect.poll(() => page.evaluate(() => window.__app.sketcher.tool)).toBe(tool);
  await settle(page);
}
async function selectHint(page) {
  await expect(page.locator("#sk-select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hint")).toContainText(DRAW_HINT);
  await expect(page.locator("#pal-select-hint")).toHaveText(DRAW_HINT);
}
async function beginnerSketch(page) {
  await open(page, "beginner");
  await page.locator("#bb-sketch").click();
  await clickPoint(page, [10, -10, 0]); // inside the XY square, away from the corner all three origin planes share
  await entered(page);
  expect(await page.evaluate(() => window.__app.sketcher.sketch.plane.n)).toEqual([0, 0, 1]);
}
const entities = (page) => page.evaluate(() => window.__store.doc.sketches[0].ents);

test("Beginner: Select opens an empty sketch and neither plate click draws", async ({ page }) => {
  await beginnerSketch(page);
  await selectHint(page);
  await clickPoint(page, [-20, -10, 0]);
  expect(await entities(page)).toHaveLength(0);
  await clickPoint(page, [20, 10, 0]);
  expect(await entities(page)).toHaveLength(0);
  expect(await page.evaluate(() => window.__app.sketcher.state)).toBeNull();
});

test("Beginner: L draws a line, then R draws four lines and a closed profile", async ({ page }) => {
  await beginnerSketch(page);
  await page.keyboard.press("l");
  await entered(page, "line");
  await clickPoint(page, [-30, -20, 0]);
  await clickPoint(page, [-10, -20, 0]);
  await expect.poll(async () => (await entities(page)).map((e) => e.t)).toEqual(["line"]);
  await page.keyboard.press("s");
  await entered(page);
  await expect(page.locator("#hint")).toContainText("Click a line, circle or arc to type its size.");
  await expect(page.locator("#pal-select-hint")).toContainText("Editing: click a line");
  await page.keyboard.press("r");
  await entered(page, "rect");
  await clickPoint(page, [10, -10, 0]);
  await clickPoint(page, [30, 10, 0]);
  await expect.poll(async () => (await entities(page)).map((e) => e.t)).toEqual(Array(5).fill("line"));
  // Beginner's existing automatic Extrude leaves the sketch and exposes its profile meshes.
  await expect.poll(() => page.evaluate(() => window.__app.command?.title)).toBe("Extrude");
  await expect.poll(() => page.evaluate(() => {
    const id = window.__store.doc.sketches[0].id;
    return window.__app.scene.regionMeshes().filter((m) => m.userData.region.sketch === id).length;
  })).toBeGreaterThanOrEqual(1);
});

test("Advanced: choosing XY opens Select with the drawing hint", async ({ page }) => {
  await open(page, "advanced");
  await page.locator("#ad-sketch").click();
  await page.locator("#plane-seg button").filter({ hasText: "XY" }).click();
  await entered(page);
  await selectHint(page);
});

test("Beginner: C before picking the plate still opens Circle", async ({ page }) => {
  await open(page, "beginner");
  await page.keyboard.press("c");
  await expect(page.locator("#plane-seg")).toBeVisible();
  await clickPoint(page, [10, -10, 0]);
  await entered(page, "circle");
  expect(await page.evaluate(() => window.__app.sketcher.sketch.plane.n)).toEqual([0, 0, 1]);
  expect(await entities(page)).toHaveLength(0);
});

test("Advanced: a new sketch on a box top opens Select despite projected edges", async ({ page }) => {
  await open(page, "advanced", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
  expect(await page.evaluate(() => [...window.__app.scene.errors])).toEqual([]);
  await page.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(page);
  await page.locator("#ad-sketch").click();
  await clickPoint(page, [0, 0, 20]);
  await entered(page);
  await selectHint(page);
  const sk = await page.evaluate(() => window.__app.sketcher.sketch);
  expect(sk.onBody).toBe("b1");
  expect(sk.plane.n).toEqual([0, 0, 1]);
  expect(sk.plane.o[2]).toBe(20);
  expect(sk.ents.length).toBeGreaterThan(0);
  expect(sk.ents.every((e) => e.proj)).toBe(true);
});
