// Issue #99: move and rotate sketches. Requester's answer to "What should it end up as?": "movable and rotatable".
// Move/Copy takes a sketch (picked in the Browser or from the list, hidden ones too); the extrude built from it follows.
// Fixture: a 30 x 20 rectangle at the origin in sketch s1, extruded 15 into body b1 (box x[0,30] y[0,20] z[0,15]).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, reload, watchErrors, loadDoc, waitIdle } from "./helpers.mjs";

const fixture = () => JSON.parse(readFileSync(new URL("./projects/advanced-sketch-extrude.json", import.meta.url), "utf8"));

let page, errors;
test.beforeEach(async ({ browser }, info) => { // a page per test, so one failure does not hide the others
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const r2 = (a) => a.map((v) => Math.round(v * 100) / 100 + 0); // + 0 turns -0 into 0
const boxOf = () => run(() => { const b = __app.scene.bodyTightBox("b1"); return b ? [...b.min.toArray(), ...b.max.toArray()] : null; }).then((b) => b && r2(b));
// the box once the kernel has rebuilt b1: polled, because a stale mesh is still there for a moment
const expectBox = (want) => expect.poll(boxOf, { timeout: 30_000 }).toEqual(want);
const planeOf = (id = "s1") => run((id) => __store.doc.sketches.find((s) => s.id === id).plane, id);
const undoDepth = () => run(() => __store.undoStack.length);
const BEFORE = [0, 0, 0, 30, 20, 15], MOVED = [10, -5, -10, 40, 10, 10];

async function open() {
  await loadDoc(page, fixture());
  await expectBox(BEFORE);
}
async function openMove() {
  await page.click("#ad-transform");
  await page.click("#ad-move");
  await expect(page.locator("#cmd")).toContainText("Move / Copy");
}
const setField = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };
const selectSketchInTree = (name = "Sketch 1") => page.locator("#browser .tree .node", { hasText: name }).click();

test("Move/Copy on a picked sketch: 10 along X and 90 around X tilts the extrude with it, in one undo step; undo, redo and a reload keep it", async () => {
  await open();
  expect(await boxOf()).toEqual(BEFORE);
  await selectSketchInTree();
  const depth = await undoDepth();
  await openMove();
  await expect(page.locator(".picklist")).toContainText("Sketch 1");
  await setField("mv-d0", 10);
  await setField("mv-r0", 90);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await undoDepth()).toBe(depth + 1);
  await waitIdle(page);
  await expectBox(MOVED);
  const b = (await run(() => __app.scene.errors.get("b1") || null));
  expect(b).toBeNull();
  const vol = await run(() => __app.scene.views.get("b1").data.volume);
  expect(Math.round(vol)).toBe(9000);
  const p = await planeOf();
  expect(r2(p.o)).toEqual([10, 10, -10]);
  expect(r2(p.x)).toEqual([1, 0, 0]);
  expect(r2(p.n)).toEqual([0, -1, 0]);
  expect(p.n.concat(p.x, p.o).every((v) => Math.abs(v - Math.round(v * 1e6) / 1e6) < 1e-12), "no 6e-17 noise stored").toBe(true);
  // the sketch is still a sketch: its curves are untouched and it can be edited
  expect(await run(() => __store.doc.sketches[0].pts.map((q) => [q.x, q.y]))).toEqual([[0, 0], [30, 0], [30, 20], [0, 20]]);

  // undo (the real button), then redo
  await page.click("#btn-undo");
  await expectBox(BEFORE);
  expect(await planeOf()).toEqual({ o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] });
  await page.click("#btn-redo");
  await expectBox(MOVED);

  // save and reopen
  const id = await run(() => __store.doc.id);
  await run(() => __app.projects.saveNow());
  await reload(page);
  await page.waitForFunction(() => window.__store.doc.sketches.length > 0 && window.__store.doc.bodies.length > 0, null, { timeout: 30_000 });
  expect(await run(() => __store.doc.id)).toBe(id);
  expect(r2((await planeOf()).o)).toEqual([10, 10, -10]);
  await waitIdle(page);
  await expectBox(MOVED);
  expect(await run(() => __app.scene.errors.get("b1") || null)).toBeNull();
});

test("a hidden sketch can be moved from the list in the Move/Copy dialog, and stays hidden", async () => {
  await open();
  await run(() => __store.update((d) => { d.sketches[0].hidden = true; }, "Hide sketch"));
  await run(() => __app.select(["b1"]));
  await openMove();
  await expect(page.locator(".picklist")).toContainText("1 body");
  await page.locator(".picklist .clr").click();
  await page.selectOption("#mv-sketch", { label: "Sketch 1" });
  await expect(page.locator(".picklist")).toContainText("Sketch 1");
  await setField("mv-d2", 5);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await expectBox([0, 0, 5, 30, 20, 20]);
  expect(await run(() => __store.doc.sketches[0].hidden)).toBe(true);
  expect((await planeOf()).o).toEqual([0, 0, 5]);
  expect(await run(() => __store.doc.bodies[0].m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // the body itself did not move
});

test("Create a copy leaves the first sketch and its extrude where they were", async () => {
  await open();
  await selectSketchInTree();
  await openMove();
  await page.check("#mv-copy");
  await setField("mv-d2", 7);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const sks = await run(() => __store.doc.sketches.map((s) => ({ id: s.id, name: s.name, seq: s.seq, o: s.plane.o, hidden: !!s.hidden, ents: s.ents.length })));
  expect(sks).toHaveLength(2);
  expect(sks[0]).toMatchObject({ id: "s1", o: [0, 0, 0] });
  expect(sks[1].id).not.toBe("s1");
  expect(sks[1].seq).toBeGreaterThan(sks[0].seq);
  expect(sks[1].name).toBe("Sketch 2");
  expect(sks[1]).toMatchObject({ o: [0, 0, 7], hidden: false, ents: 4 });
  await waitIdle(page);
  await expectBox(BEFORE);
  expect(await run(() => __store.doc.bodies.length)).toBe(1);
});

test("the props panel has a Move/Copy button for a selected sketch", async () => {
  await open();
  await selectSketchInTree();
  await page.locator("#browser .props #prop-move-sketch").click();
  await expect(page.locator("#cmd")).toContainText("Move / Copy");
  await expect(page.locator(".picklist")).toContainText("Sketch 1");
  await page.click("#cmd .xbtn");
  await expect(page.locator("#cmd")).toBeHidden();
});

test("clicking a shown sketch in the viewport picks it, and dragging it on the ground moves it", async () => {
  await open();
  await run(() => __store.update((d) => { d.bodies[0].hidden = true; }, "Hide body")); // nothing in front of the sketch
  await run(() => { const v = __app.vp; const V = v.camera.position.constructor; __app.needFit = false; v.animateTo({ az: -Math.PI / 2, el: 1.4, dist: 120, target: new V(15, 10, 0) }, 10); if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms); v.render(); });
  const at = (x, y) => run(([x, y]) => { const v = __app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, 0)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y]);
  await openMove();
  await expect(page.locator(".picklist")).toContainText("Click bodies or a sketch");
  await page.locator("#mv-drag button", { hasText: "Free on ground" }).click(); // Free in 3D is the default; this test is about the ground drag (#163)
  const [x0, y0] = await at(10, 10), [x1, y1] = await at(20, 10);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, y0, { steps: 3 });
  await page.mouse.move(x1, y1, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".picklist")).toContainText("Sketch 1");
  const dx = +(await page.inputValue("#mv-d0"));
  expect(dx).toBeGreaterThan(5);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expect((await planeOf()).o[0]).toBeCloseTo(dx, 3);
  expect((await planeOf()).o[2]).toBe(0);
});

test("a copy does not keep onBody/fromFace, so deleting the body the original was drawn on leaves the copy", async () => {
  const doc = fixture();
  Object.assign(doc.sketches[0], { onBody: "b1", fromFace: true });
  await loadDoc(page, doc);
  await expectBox(BEFORE);
  await run(() => __app.select([]));
  await selectSketchInTree();
  await openMove();
  await page.check("#mv-copy");
  await setField("mv-d2", 7);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const [orig, copy] = await run(() => __store.doc.sketches.map((s) => ({ id: s.id, onBody: s.onBody || null, fromFace: !!s.fromFace })));
  expect(orig).toEqual({ id: "s1", onBody: "b1", fromFace: true });
  expect(copy.onBody).toBeNull();
  expect(copy.fromFace).toBe(false);
  await run(() => JS3D.remove(["b1"]));
  expect(await run(() => __store.doc.sketches.map((s) => s.id))).toEqual([copy.id]);
});

test("a revolve around an axis drawn in the sketch follows the sketch when it is turned", async () => {
  const doc = JSON.parse(readFileSync(new URL("./projects/advanced-revolve.json", import.meta.url), "utf8"));
  const sk = doc.sketches[0];
  sk.hidden = false;
  sk.pts.push({ id: "ap0", x: 0, y: 0 }, { id: "ap5", x: 0, y: 20 });
  sk.ents.push({ id: "ae5", t: "line", a: "ap0", b: "ap5" });
  doc.bodies[0].node.axis = "ae5";
  await loadDoc(page, doc);
  const dims = () => run(() => { const b = __app.scene.bodyTightBox(__store.doc.bodies[0].id); return b ? b.max.clone().sub(b.min).toArray().map((v) => Math.round(v * 10) / 10) : null; }); // a round tube measures 29.99 across: faceted
  await expect.poll(dims, { timeout: 30_000 }).toEqual([30, 30, 20]); // a tube standing on its axis (z)
  await selectSketchInTree("s1");
  await openMove();
  await setField("mv-r0", 90);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await expect.poll(dims, { timeout: 30_000 }).toEqual([30, 20, 30]); // now lying along y
  await waitIdle(page);
  const body = await run(() => ({ err: __app.scene.errors.get(__store.doc.bodies[0].id) || null, vol: __app.scene.views.get(__store.doc.bodies[0].id).data.volume }));
  expect(body.err).toBeNull();
  expect(Math.abs(body.vol - Math.PI * (15 * 15 - 5 * 5) * 20)).toBeLessThan(5);
});
