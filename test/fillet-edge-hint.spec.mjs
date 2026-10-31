// Fillet edge feedback, on both the site and the single-file build.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); await page.close(); });

async function openShape(kind, extra = {}) {
  await loadDoc(page, newDoc("Edge hint", "advanced", { bodies: [body("b1", "Shape", prim(kind, { w: 20, d: 20, h: 20, r: 0, c: 0 }), undefined, extra)] }));
  await page.evaluate(() => {
    const v = window.__app.vp, V = v.camera.position.constructor;
    v.animateTo({ az: -Math.PI / 2 + 0.5, el: 0.5, dist: 110, target: new V(0, 0, 10) }, 10);
  });
  await page.waitForFunction(() => !window.__app.vp.anim);
  await page.keyboard.press("f");
  await expect(page.locator("#cmd")).toContainText("Fillet");
  await page.evaluate(() => document.getElementById("toasts").replaceChildren());
}
async function point(p) {
  return page.evaluate((p) => {
    const v = window.__app.vp, V = v.camera.position.constructor, q = v.project(new V(...p)), r = v.canvas.getBoundingClientRect();
    return [r.left + q[0], r.top + q[1]];
  }, p);
}

test("a box edge highlights and is picked without a toast", async () => {
  await openShape("box");
  const [x, y] = await point([0, -10, 20]);
  await page.mouse.move(x, y);
  await expect(page.locator("#viewport canvas")).toHaveCSS("cursor", "pointer");
  await expect.poll(() => page.evaluate(() => {
    let n = 0;
    window.__app.vp.world.traverse((o) => { if (o.renderOrder === 15) n++; });
    return n;
  })).toBeGreaterThan(0);
  await page.mouse.click(x, y);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await expect(page.locator("#cmd .edge-set.on")).toContainText("1 edge");
  await expect(page.locator("#toasts .toast")).toHaveCount(0);
});

test("the middle of a cylinder's curved side explains a missed edge", async () => {
  await openShape("cylinder");
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await expect(page.locator("#toasts .toast")).toContainText("No edge to round here: smooth joins and curved seams have no edge to pick.");
});

test("a locked body explains why its edges cannot be picked and limits repeat hints", async () => {
  await openShape("box", { locked: true });
  const [x, y] = await point([0, -10, 10]);
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await expect(page.locator("#toasts .toast")).toHaveCount(1);
  await expect(page.locator("#toasts .toast")).toContainText("That body is locked/hidden/a hole, so its edges can't be picked.");
});

test("empty space produces no toast", async () => {
  await openShape("box");
  const [x, y] = await point([40, -10, 10]);
  await page.mouse.click(x, y);
  await expect(page.locator("#toasts .toast")).toHaveCount(0);
});
