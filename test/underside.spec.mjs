// Seen from below the plate. Users see it as: looking up at a design from under the ground, the plate is nearly
// clear (as in Tinkercad), so the underside of the part shows; from above, the plate is as solid as it was.
import { test, expect } from "@playwright/test";
import { boot, newDoc, body, prim, loadDoc, watchErrors } from "./helpers.mjs";

// A red 30 mm box 5 mm above the plate (z 5..15), off the axes, so a bottom-face spot (17,19,5), off the headlight glare at the centre, is plain face with the plate 5 mm under it.
const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 13, 5, 1];
const doc = (mode) => newDoc("Under", mode, { bodies: [body("b1", "Box", prim("box", { w: 30, d: 30, h: 10, r: 0, c: 0 }), M, { color: "#e02020" })] });

let page, errors;
test.beforeAll(async ({ browser }, info) => { page = await browser.newPage(); errors = watchErrors(page); await boot(page, info); });
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });

// Point the camera at (13,17,tz) from elevation `el`, draw, and read an n x n patch of pixels round a world point, all in one task
// (the canvas keeps no picture). With `noGrid` the plate is left out of the same frame: the picture the part would have without it.
// Returns the patch and the shader's "under" value for that frame.
const look = (el, at, { ortho = false, dist = 200, tz = 10, noGrid = false, n = 9 } = {}) => page.evaluate(({ el, at, ortho, dist, tz, noGrid, n }) => {
  const vp = window.__app.vp;
  Object.assign(vp.view, { az: 0.7, el, dist, roll: 0 });
  vp.view.target.set(27, 28, tz);
  vp.anim = null; vp.useOrtho = ortho;
  return window.__snap(at, noGrid, n);
}, { el, at, ortho, dist, tz, noGrid, n });
// Draw the current view and read the patch (no change of camera).
const SNAP = () => {
  window.__snap = (at, noGrid, n) => {
    const vp = window.__app.vp;
    vp.grid.visible = !noGrid;
    vp.render();
    vp.grid.visible = true;
    const [x, y] = vp.project(new vp.view.target.constructor(...at));
    const k = vp.canvas.width / vp.w, c = document.createElement("canvas"); c.width = vp.canvas.width; c.height = vp.canvas.height;
    const g = c.getContext("2d"); g.drawImage(vp.canvas, 0, 0);
    const h = (n - 1) / 2, d = g.getImageData(Math.round(x * k) - h, Math.round(y * k) - h, n, n).data, px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    return { px, under: vp.grid.material.uniforms.under.value, bgAlpha: vp.grid.material.uniforms.bgAlpha.value };
  };
};
const snap = (at, noGrid = false, n = 9) => page.evaluate(({ at, noGrid, n }) => window.__snap(at, noGrid, n), { at, noGrid, n });
const mean = (px) => [0, 1, 2].map((c) => Math.round(px.reduce((s, p) => s + p[c], 0) / px.length));
const maxDiff = (a, b) => Math.max(...a.map((p, i) => Math.max(...p.map((v, c) => Math.abs(v - b[i][c])))));
const tint = (a, b) => Math.max(...mean(a).map((v, c) => Math.abs(v - mean(b)[c]))); // how far the plate pulls the average colour of the patch
const isRed = ([r, g, b]) => r > 110 && r > g + 50 && r > b + 50;
const FACE = [17, 19, 5], PLATE = [50, 50, 0], LINE = [10, -10, 0]; // the box spans x 12..42, y 13..43; LINE is on the 10 mm major line x = 10, clear of it

// What the user sees of the part from below: its own colour, with only a small tint from the plate in front of it.
async function underside(opts) {
  const withPlate = await look(opts.el, FACE, opts);
  const without = await look(opts.el, FACE, { ...opts, noGrid: true });
  expect(withPlate.under).toBe(1);
  expect(isRed(mean(without.px)), `part without the plate reads ${mean(without.px)}`).toBe(true);
  expect(isRed(mean(withPlate.px)), `part through the plate reads ${mean(withPlate.px)}`).toBe(true);
  expect(tint(withPlate.px, without.px), `through the plate ${mean(withPlate.px)}, without it ${mean(without.px)}`).toBeLessThanOrEqual(40); // a 40% blue blend is 50+ off, with lines up to ~35; main's 0.96 mat is 190
}

test.describe("looking up from below", () => {
  test.beforeAll(async () => { await page.evaluate(SNAP); });

  test("Beginner: the plate is nearly clear, so the underside of the part shows", async () => {
    await loadDoc(page, doc("beginner"));
    await underside({ el: -0.6 });
  });

  test("Beginner: looking straight up in the orthographic view shows the underside", async () => {
    await underside({ el: -Math.PI / 2 + 1e-4, ortho: true });
  });

  test("Advanced in the dark theme: the ground is nearly clear too", async () => {
    try {
      await page.evaluate(() => window.__app.setTheme("dark", true));
      await loadDoc(page, doc("advanced"));
      await underside({ el: -0.6 });
    } finally { await page.evaluate(() => window.__app.setTheme("light", true)); }
  });

  test("faint lines stay on the plate from below, so you can still tell where you are", async () => {
    await loadDoc(page, doc("beginner"));
    const o = { el: -Math.PI / 2 + 1e-4, ortho: true, n: 9 };
    const withPlate = await look(o.el, LINE, o), without = await look(o.el, LINE, { ...o, noGrid: true });
    expect(withPlate.under).toBe(1);
    expect(maxDiff(withPlate.px, without.px), "a major line pixel against the same view without the plate").toBeGreaterThanOrEqual(8);
  });
});

test.describe("when the camera counts as below the plate", () => {
  test.beforeAll(async () => { await page.evaluate(SNAP); await loadDoc(page, doc("beginner")); });
  // [label, elevation, target z, orthographic, expected]. dist 100, so a 0.05 rad elevation moves the eye about 5 mm.
  const cases = [
    ["perspective, eye above the plate but looking slightly up at a high target", -0.05, 50, false, 0],
    ["perspective, eye below the plate but looking slightly down at a low target", 0.05, -50, false, 1],
    ["perspective, plain view from above", 0.6, 10, false, 0],
    ["perspective, plain view from below", -0.6, 10, false, 1],
    ["orthographic, camera physically below the plate but the view looks down", 0.05, -50, true, 0],
    ["orthographic, camera physically above the plate but the view looks up", -0.05, 50, true, 1],
  ];
  for (const [label, el, tz, ortho, want] of cases) {
    test(label, async () => {
      const s = await look(el, PLATE, { el, tz, ortho, dist: 100 });
      expect(s.under).toBe(want);
    });
  }
});

test("the view cube's Bottom face, clicked, shows the underside in orthographic", async () => {
  await loadDoc(page, doc("beginner"));
  await page.evaluate(SNAP);
  // turn the view so the Bottom face of the cube is in sight, and find a spot on it
  await page.evaluate(() => { const vp = window.__app.vp; vp.anim = null; vp.useOrtho = false; Object.assign(vp.view, { az: 0.7, el: -0.9, dist: 200, roll: 0 }); vp.view.target.set(27, 28, 10); vp.request(); });
  await page.waitForTimeout(400);
  const spot = await page.evaluate(() => {
    const cube = window.__app.cube, r = cube.renderer.domElement.getBoundingClientRect();
    for (let y = r.top + 4; y < r.bottom; y += 3) for (let x = r.left + 4; x < r.right; x += 3) {
      const d = cube.hit({ clientX: x, clientY: y });
      if (d && d.x === 0 && d.y === 0 && d.z === -1) return { x, y };
    }
    return null;
  });
  expect(spot, "the Bottom face is under the pointer somewhere on the cube").not.toBeNull();
  await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => !window.__app.vp.isMoving());
  expect(await page.evaluate(() => window.__app.vp.view.el)).toBeLessThan(-1.5); // looking straight up
  await page.click("#nav-ortho"); // the real orthographic button
  const s = await page.evaluate((at) => window.__snap(at, false, 9), FACE);
  const ref = await page.evaluate((at) => window.__snap(at, true, 9), FACE);
  expect(s.under).toBe(1);
  expect(isRed(mean(s.px)), `bottom face reads ${mean(s.px)}`).toBe(true);
  expect(tint(s.px, ref.px)).toBeLessThanOrEqual(40);
  await page.click("#nav-ortho");
});

for (const ortho of [false, true]) {
  test(`from above the plate is as solid as before, and restored after a look from below (${ortho ? "orthographic" : "perspective"})`, async () => {
    await loadDoc(page, doc("beginner"));
    await page.evaluate(SNAP);
    const up = ortho ? Math.PI / 2 - 1e-4 : 0.6, down = ortho ? -Math.PI / 2 + 1e-4 : -0.6;
    const above = await look(up, PLATE, { ortho, n: 5 });
    expect(above.under).toBe(0);
    expect(above.bgAlpha).toBe(0.96); // main's Beginner mat
    const a = mean(above.px);
    expect(a[2], `plate reads ${a}`).toBeGreaterThan(a[0] + 40); // the blue mat
    expect((await look(down, FACE, { ortho })).under).toBe(1);
    const again = await look(up, PLATE, { ortho, n: 5 });
    expect(again.under).toBe(0);
    expect(again.bgAlpha).toBe(0.96); // the mat itself is untouched
    mean(again.px).forEach((v, i) => expect(Math.abs(v - a[i])).toBeLessThanOrEqual(3));
  });
}

test("from above the Advanced dark ground keeps its 0.92 fill", async () => {
  try {
    await page.evaluate(() => window.__app.setTheme("dark", true));
    await loadDoc(page, doc("advanced"));
    await page.evaluate(SNAP);
    const s = await look(0.6, PLATE);
    expect(s.under).toBe(0);
    expect(s.bgAlpha).toBe(0.92);
  } finally { await page.evaluate(() => window.__app.setTheme("light", true)); }
});
