// Seen from below the plate. Users see it as: looking up at a design from under the ground, the plate is nearly
// clear (as in Tinkercad), so the underside of the part shows; from above, the plate is as solid as it was.
import { test, expect } from "@playwright/test";
import { boot, newDoc, body, prim, loadDoc, watchErrors } from "./helpers.mjs";

// A red 30 mm box 5 mm above the plate (z 5..15), off the axes, so its bottom-face centre is plain face with the plate 5 mm under it.
const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 13, 5, 1];
const doc = (mode) => newDoc("Under", mode, { bodies: [body("b1", "Box", prim("box", { w: 30, d: 30, h: 10, r: 0, c: 0 }), M, { color: "#e02020" })] });

let page, errors;
test.beforeAll(async ({ browser }, info) => { page = await browser.newPage(); errors = watchErrors(page); await boot(page, info); });
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });

// Point the camera, draw, and read the mean colour of a 9 x 9 patch round a world point, all in one task (the canvas keeps no picture).
const look = (el, at, ortho = false, dist = 200) => page.evaluate(({ el, at, ortho, dist }) => {
  const vp = window.__app.vp;
  Object.assign(vp.view, { az: 0.7, el, dist, roll: 0 });
  vp.view.target.set(13, 17, 10);
  vp.anim = null; vp.useOrtho = ortho;
  vp.render();
  const [x, y] = vp.project(new vp.view.target.constructor(...at));
  const k = vp.canvas.width / vp.w, c = document.createElement("canvas"); c.width = vp.canvas.width; c.height = vp.canvas.height;
  const g = c.getContext("2d"); g.drawImage(vp.canvas, 0, 0);
  const d = g.getImageData(Math.round(x * k) - 4, Math.round(y * k) - 4, 9, 9).data, s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return s.map((v) => Math.round(v / 81));
}, { el, at, ortho, dist });
const isRed = ([r, g, b]) => r > 110 && r > g + 50 && r > b + 50;
const FACE = [13, 17, 5], PLATE = [-80, -80, 0];

test("Beginner: from below the plate lets the underside of the part show", async () => {
  await loadDoc(page, doc("beginner"));
  const rgb = await look(-0.6, FACE);
  expect(isRed(rgb), `bottom face reads ${rgb}`).toBe(true);
});

test("Beginner: the view cube's Bottom view (orthographic) shows the underside", async () => {
  const rgb = await look(-Math.PI / 2 + 1e-4, FACE, true);
  expect(isRed(rgb), `bottom face reads ${rgb}`).toBe(true);
});

test("Advanced in the dark theme: from below the ground shows the underside", async () => {
  await page.evaluate(() => window.__app.setTheme("dark", true));
  await loadDoc(page, doc("advanced"));
  const rgb = await look(-0.6, FACE);
  expect(isRed(rgb), `bottom face reads ${rgb}`).toBe(true);
  await page.evaluate(() => window.__app.setTheme("light", true));
});

test("from above the plate is as solid as before, and is restored after a look from below", async () => {
  await loadDoc(page, doc("beginner"));
  const above = await look(0.6, PLATE);
  expect(above[2], `plate reads ${above}`).toBeGreaterThan(above[0] + 40); // the blue mat
  await look(-0.6, FACE);
  const again = await look(0.6, PLATE);
  above.forEach((v, i) => expect(Math.abs(again[i] - v)).toBeLessThanOrEqual(3));
});
