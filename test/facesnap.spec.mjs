// Face snap (Beginner): dropping a dragged shape on another shape's face, like Tinkercad's Cruise.
// Real mouse events on real screen positions; results read from the document and from JS3D.list() boxes:
//  - a cylinder dragged by its body onto a box's top ends up resting on it (bottom z 20), one Undo entry; carried on to empty plate it
//    drops back to z 0; a small box dropped on a tall cylinder's top rests on it;
//  - dragged over a side face it turns so its axis points out of that face and its bottom touches it;
//  - Alt held, the Faces switch off (and it stays off after a reload), or a hole in the drag: a plain slide at the grab height;
//  - a new shape dragged from the strip lands on a top face, or on the plate when the switch is off or Alt is held.
import { test, expect } from "@playwright/test";
import { boot, reload, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";

const at = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const BOX_A = { w: 40, d: 40, h: 20, r: 0, c: 0 };
const CYL_B = { w: 10, d: 10, h: 10, r: 0, c: 0 };
const design = (extra = {}, a = body("a", "A", prim("box", BOX_A)), b = body("b", "B", prim("cylinder", CYL_B), at(60, 0, 0))) => newDoc("face snap", "beginner", { bodies: [a, b], ...extra });
const run = (page, fn, arg) => page.evaluate(fn, arg);
const phone = (info) => info.project.name === "mobile";

let errors;
test.beforeEach(async ({ page }) => { errors = watchErrors(page); });
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); });

const box = (page, id) => run(page, async (id) => { await JS3D.ready(60000); return JS3D.list().find((b) => b.id === id || b.name === id).bbox; }, id);
const mat = (page, id) => run(page, (id) => window.__store.doc.bodies.find((b) => b.id === id).m, id);
const undoDepth = (page) => run(page, () => window.__store.undoStack.length);
// the camera, set directly (az/el in degrees)
async function look(page, target, az, el, dist) {
  await run(page, ([t, az, el, dist]) => { const vp = window.__app.vp; Object.assign(vp.view, { az: (az * Math.PI) / 180, el: (el * Math.PI) / 180, dist, roll: 0 }); vp.view.target.set(...t); vp.anim = null; vp.useOrtho = false; vp.render(); }, [target, az, el, dist]);
  for (let ok = 0; ok < 2;) { await page.waitForTimeout(150); ok = (await run(page, () => !window.__app.vp.isMoving())) ? ok + 1 : 0; }
}
const clientOf = (page, pt) => run(page, ([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);

async function open(page, info, doc = design(), view = [[20, 0, 10], -55, 28, 260]) {
  test.skip(phone(info), "mouse drags: computer layout");
  await boot(page, info);
  await loadDoc(page, doc);
  await look(page, ...view);
}
// press at the world point `from`, move along the list of world points `via`, release (Alt pressed after the press: Alt before it would orbit)
async function drag(page, from, via, { alt = false, release = true } = {}) {
  const a = await clientOf(page, from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (alt) await page.keyboard.down("Alt");
  let p = a;
  for (const w of via) {
    const q = await clientOf(page, w);
    for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + ((q.x - p.x) * i) / 10, p.y + ((q.y - p.y) * i) / 10);
    p = q;
  }
  if (!release) return;
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}
const GRAB_B = [60, 0, 10]; // the top of the cylinder
const A_TOP = [0, 0, 20];
const A_SIDE = [20, 0, 10]; // the +X face of A, visible from the iso view
const PLATE = [-70, -50, 0];

test("a cylinder dragged onto a box's top rests on it, one Undo entry; carried on to the plate it drops back", async ({ page }, info) => {
  await open(page, info);
  const rot = (await mat(page, "b")).slice(0, 12), depth = await undoDepth(page);
  await drag(page, GRAB_B, [A_TOP], { release: false });
  await expect.poll(async () => (await box(page, "b")).min[2], { message: "preview rests on the top" }).toBeGreaterThan(19.9);
  // on to empty plate in the same drag
  const c = await clientOf(page, PLATE);
  await page.mouse.move(c.x, c.y, { steps: 12 });
  await expect.poll(async () => (await box(page, "b")).min[2]).toBeLessThan(0.01);
  const c2 = await clientOf(page, A_TOP);
  await page.mouse.move(c2.x, c2.y, { steps: 12 });
  await expect.poll(async () => (await box(page, "b")).min[2]).toBeGreaterThan(19.9);
  await page.mouse.up();
  await waitIdle(page);
  const b = await box(page, "b");
  expect(b.min[2]).toBeCloseTo(20, 1);
  expect(b.max[2]).toBeCloseTo(30, 1);
  expect((b.min[0] + b.max[0]) / 2).toBeGreaterThan(-20);
  expect((b.min[0] + b.max[0]) / 2).toBeLessThan(20);
  expect((await mat(page, "b")).slice(0, 12)).toEqual(rot);
  expect(await undoDepth(page)).toBe(depth + 1);
  await run(page, () => window.__store.undo());
  await waitIdle(page);
  expect((await box(page, "b")).min[2]).toBeCloseTo(0, 1);
  expect((await box(page, "b")).min[0]).toBeCloseTo(55, 1);
  expect(await undoDepth(page)).toBe(depth);
});

test("a drag that landed on a top and then ends on the empty plate sits on the plate", async ({ page }, info) => {
  await open(page, info);
  await drag(page, GRAB_B, [A_TOP, PLATE]);
  await waitIdle(page);
  const b = await box(page, "b");
  expect(b.min[2]).toBeCloseTo(0, 1);
  expect(b.max[2]).toBeCloseTo(10, 1);
});

test("a small box dropped on a tall cylinder's top rests on it", async ({ page }, info) => {
  const doc = design({}, body("a", "Tower", prim("cylinder", { w: 20, d: 20, h: 40, r: 0, c: 0 })), body("b", "Small", prim("box", { w: 10, d: 10, h: 10, r: 0, c: 0 }), at(60, 0, 0)));
  await open(page, info, doc, [[20, 0, 20], -55, 28, 300]);
  await drag(page, [60, 0, 10], [[0, 0, 40]]);
  await waitIdle(page);
  const b = await box(page, "b");
  expect(b.min[2]).toBeCloseTo(40, 1);
  expect(b.max[2]).toBeCloseTo(50, 1);
});

test("over a side face the shape turns to stand out of that face with its bottom on it", async ({ page }, info) => {
  await open(page, info);
  const depth = await undoDepth(page);
  await drag(page, GRAB_B, [A_SIDE]);
  await waitIdle(page);
  const b = await box(page, "b"), m = await mat(page, "b");
  expect(b.min[0]).toBeCloseTo(20, 1); // flush on x = 20
  expect(b.max[0]).toBeCloseTo(30, 1); // its 10 mm length points out of the face
  expect(m[8]).toBeCloseTo(1, 6); // its axis (local +Z) is world +X
  expect(Math.abs(m[9]) + Math.abs(m[10])).toBeLessThan(1e-6);
  expect(await undoDepth(page)).toBe(depth + 1);
  await run(page, () => window.__store.undo());
  await waitIdle(page);
  expect((await box(page, "b")).min[0]).toBeCloseTo(55, 1);
});

test("Alt held during the drag: the shape stays at the grab height and can overlap the box", async ({ page }, info) => {
  await open(page, info);
  await drag(page, GRAB_B, [A_TOP], { alt: true });
  await waitIdle(page);
  expect((await box(page, "b")).min[2]).toBeCloseTo(0, 1);
  expect(await run(page, () => window.__store.doc.bodies.length)).toBe(2);
});

test("the Faces switch: off means a plain drag, and it stays off after a reload", async ({ page }, info) => {
  await open(page, info);
  expect(await run(page, () => window.__app.faceSnap)).toBe(true);
  await page.click("#snap-more");
  await expect(page.locator("#snap-face-chk")).toBeChecked();
  await page.locator("#snap-face-chk").uncheck();
  expect(await run(page, () => window.__app.faceSnap)).toBe(false);
  await drag(page, GRAB_B, [A_TOP]);
  await waitIdle(page);
  expect((await box(page, "b")).min[2]).toBeCloseTo(0, 1);
  await reload(page);
  expect(await run(page, () => window.__app.faceSnap)).toBe(false);
  await page.click("#snap-more");
  await expect(page.locator("#snap-face-chk")).not.toBeChecked();
  await page.locator("#snap-face-chk").check();
  expect(await run(page, () => window.__app.faceSnap)).toBe(true);
  expect(await run(page, () => JSON.parse(localStorage.getItem("workplane.ui.v1")).faces)).toBe(true);
});

test("a hole dragged over a box keeps its height, so it still cuts", async ({ page }, info) => {
  const doc = design({}, undefined, body("b", "Hole", prim("cylinder", CYL_B), at(60, 0, 0), { hole: true }));
  await open(page, info, doc);
  await drag(page, GRAB_B, [A_TOP]);
  await waitIdle(page);
  expect((await box(page, "b")).min[2]).toBeCloseTo(0, 1);
});

async function stripDrag(page, to, alt = false) {
  const tile = page.locator('#shapes .tile[data-kind="box"]');
  await tile.scrollIntoViewIfNeeded();
  const t = await tile.boundingBox(), end = await clientOf(page, to);
  const [x0, y0] = [t.x + t.width / 2, t.y + t.height / 2];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0, y0 - 20);
  if (alt) await page.keyboard.down("Alt");
  for (let i = 1; i <= 14; i++) await page.mouse.move(x0 + ((end.x - x0) * i) / 14, y0 - 20 + ((end.y - y0 + 20) * i) / 14);
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  await waitIdle(page);
  return run(page, () => window.__store.doc.bodies.filter((b) => b.id !== "a" && b.id !== "b").map((b) => b.m[14]));
}

test("a new shape dragged from the strip lands on a top face; with the switch off, or Alt held, on the plate", async ({ page }, info) => {
  await open(page, info, design(), [[0, 0, 10], -55, 28, 300]);
  const on = await stripDrag(page, A_TOP);
  expect(on).toHaveLength(1);
  expect(on[0]).toBeCloseTo(20, 1);
  await run(page, () => window.__store.undo());
  await run(page, () => window.__app.setFaceSnap(false, true));
  const off = await stripDrag(page, A_TOP);
  expect(off).toHaveLength(1);
  expect(off[0]).toBeCloseTo(0, 1);
  await run(page, () => { window.__store.undo(); window.__app.setFaceSnap(true, true); });
  const alt = await stripDrag(page, A_TOP, true);
  expect(alt).toHaveLength(1);
  expect(alt[0]).toBeCloseTo(0, 1);
});
