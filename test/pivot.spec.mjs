// Issue #100, the follow-up to the rotate gizmo: a movable pivot, and a live gizmo in Advanced.
// The reporter's picture (Shapr3D): click a cube, a handle set appears at once; drag the centre dot onto the middle of the 2x2 block
// (it snaps); drag round the ring and the cube swings about that pivot, with the angle beside the pointer.
// Proof from the user's side, in both modes, with every turn compared with corners rotated here by p' = C + R(p - C), never with
// the app's own matrix code:
//  - the dot is dragged onto another body's box middle (the other body does not change), then a 90 degree turn;
//  - Pivot X/Y/Z fields take fractional values, Reset to middle, a new selection starts from the middle again, none of it is Undo;
//  - Advanced: one click shows the handles with no command open, a double-click still opens the editor, each drag is one Undo step;
//  - a finger 21 px from the dot picks it; a second finger or a cancelled touch puts the pivot back;
//  - several bodies turn about the union box's middle taken once (+45 then -45 comes back exactly).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";

const M0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, -12, 5, 1]; // the box we turn: (30, -12, 5), not turned
const M2 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 110, 30, 0, 1]; // the reference box, well apart from the first
const BOX = { w: 40, d: 24, h: 16, r: 0, c: 0 };
const REF = { w: 30, d: 30, h: 30, r: 0, c: 0 };
const design = (mode, extra = {}) => newDoc("pivot", mode, { bodies: [body("b1", "Box", prim("box", BOX), M0), body("b2", "Reference", prim("box", REF), M2)], ...extra });

// ---- the oracle: 4 x 4 column-major matrices, and corners turned about a point
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const tr = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rot = (ax, deg) => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), m = tr(0, 0, 0);
  if (ax === "x") { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (ax === "y") { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (ax === "z") { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
const turned = (ax, deg, C, base) => mul(mul(mul(tr(C[0], C[1], C[2]), rot(ax, deg)), tr(-C[0], -C[1], -C[2])), base);
const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
// the eight corners of a box [minx, miny, minz, maxx, maxy, maxz], each carried to C + R(p - C), and the box round them
function turnedCorners(ax, deg, C, box) {
  const R = rot(ax, deg), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) {
    const q = apply(R, [x - C[0], y - C[1], z - C[2]]).map((v, i) => v + C[i]);
    q.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
  }
  return [...lo, ...hi];
}
const centreOf = (b) => [0, 1, 2].map((i) => (b[i] + b[i + 3]) / 2);
const unionBox = (a, b) => [0, 1, 2].map((i) => Math.min(a[i], b[i])).concat([3, 4, 5].map((i) => Math.max(a[i], b[i])));
const expectMatrix = (got, want) => { expect(got).toHaveLength(16); want.forEach((v, i) => expect(got[i], `m[${i}]`).toBeCloseTo(v, 6)); };
const expectBoxNear = (got, want) => { expect(got).toHaveLength(6); want.forEach((v, i) => expect(got[i], `box[${i}]`).toBeCloseTo(v, 4)); };
const expectPoint = (got, want) => { expect(got, "a pivot").not.toBeNull(); want.forEach((v, i) => expect(got[i], `pivot[${i}]`).toBeCloseTo(v, 6)); };

let page, errors;
const run = (fn, arg) => page.evaluate(fn, arg);
const matrixOf = (id, p = page) => p.evaluate((id) => window.__store.doc.bodies.find((b) => b.id === id).m, id);
const previewOf = (id) => run((id) => { const p = window.__store.preview; return p ? p.bodies.find((b) => b.id === id).m : null; }, id);
const undoDepth = (p = page) => p.evaluate(() => window.__store.undoStack.length);
const boxOf = (id, p = page) => p.evaluate((id) => { const b = window.__app.scene.bodyTightBox(id); return b ? [...b.min.toArray(), ...b.max.toArray()] : null; }, id);
const pivotNow = (p = page) => p.evaluate(() => { const a = window.__app, v = a.pivot.get(a.sel); return v ? v.toArray() : null; });
const dotShown = (p = page) => p.evaluate(() => { let on = false; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.pivotDot) on = true; }); return on; });
const rings = (p = page) => p.evaluate(() => { const out = []; window.__app.vp.overlay.traverseVisible((o) => { if (/^rot-/.test(o.userData.axis || "")) out.push(o.userData.axis.slice(4)); }); return out.sort(); });
const arcs = (p = page) => p.evaluate(() => { const out = []; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.handle && o.userData.handle.type === "rot") out.push(o.userData.handle.axis); }); return out.sort(); });
const settle = async (p = page) => { for (let ok = 0; ok < 2;) { await p.waitForTimeout(200); ok = (await p.evaluate(() => !window.__app.vp.isMoving())) ? ok + 1 : 0; } };
const clientOf = (pt, p = page) => p.evaluate(([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);
const dotClient = async (p = page) => clientOf(await p.evaluate(() => window.__app.pivot.dot.position.toArray()), p);

async function open(mode, p = page, extra) {
  await loadDoc(p, design(mode, extra));
  await p.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(p);
  const b1 = await boxOf("b1", p), b2 = await boxOf("b2", p);
  expectBoxNear(b2, [95, 15, 0, 125, 45, 30]); // where the fixture put the reference box: 30 wide, centred on x = 110, y = 30, standing on z = 0
  return { b1, b2 };
}
// a spot where a click lands on this body's top face and nothing else covers it
const spotOn = (id, p = page, avoid = []) => p.evaluate(([id, avoid]) => {
  const { vp, scene } = window.__app, b = scene.bodyTightBox(id), r = vp.canvas.getBoundingClientRect();
  for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) for (const fy of [0.5, 0.3, 0.7, 0.2, 0.8]) {
    const v = vp.view.target.clone().set(b.min.x + fx * (b.max.x - b.min.x), b.min.y + fy * (b.max.y - b.min.y), b.max.z);
    const [px, py] = vp.project(v), e = { clientX: r.left + px, clientY: r.top + py };
    if (avoid.some(([ax, ay]) => Math.hypot(ax - e.clientX, ay - e.clientY) < 30)) continue;
    const a = window.__app; // not under a handle of the live gizmo (Advanced), which would take the press
    if (a.mode === "advanced" && !a.command && a.vp.handler.wantsTouch && a.vp.handler.wantsTouch(e)) continue;
    const top = document.elementFromPoint(e.clientX, e.clientY), hit = scene.pickFace(e);
    if (top === vp.canvas && hit && hit.body === id) return { x: e.clientX, y: e.clientY };
  }
  return null;
}, [id, avoid]);
async function clickBody(id = "b1", modifier = null) {
  const s = await spotOn(id);
  expect(s, `a visible spot on ${id}`).not.toBeNull();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(s.x, s.y);
  if (modifier) await page.keyboard.up(modifier);
}
const selected = () => run(() => window.__app.sel.join(","));

// The dot, dragged on the mouse from where it is to a screen point (a snap shows on the way)
async function dragDot(to, { release = true } = {}) {
  await expect.poll(dotShown).toBe(true);
  const from = await dotClient();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  if (release) await page.mouse.up();
}

// A press on the named ring and the point to let go at to turn by deg: the pointer's angle round the ring's centre on screen (the
// other way round when the axis points away from the viewer). off pushes the press that many px outward (a finger is not on the line).
const ringPlan = (p, axis, deg, off = 0) => p.evaluate(([axis, deg, off]) => {
  const { vp } = window.__app, rect = vp.canvas.getBoundingClientRect();
  let obj = null;
  vp.overlay.traverseVisible((o) => { if (o.userData.axis === "rot-" + axis) obj = o; });
  if (!obj) return null;
  vp.updateCamera(); obj.updateWorldMatrix(true, false);
  const V = (x, y, z) => vp.view.target.clone().set(x, y, z);
  const centre = V(0, 0, 0).setFromMatrixPosition(obj.matrixWorld), [cx, cy] = vp.project(centre);
  const others = [];
  vp.overlay.traverseVisible((o) => { if (/^rot-/.test(o.userData.axis || "") && o !== obj) { o.updateWorldMatrix(true, false); for (let i = 0; i < 96; i++) others.push(vp.project(V(Math.cos(i * Math.PI / 48) * 0.95, Math.sin(i * Math.PI / 48) * 0.95, 0).applyMatrix4(o.matrixWorld))); } });
  const arrows = [];
  vp.overlay.traverseVisible((o) => { if (/^[xyz]$/.test(o.userData.axis || "") && o.userData.dir) for (const t of [0.25, 0.5, 0.75, 1, 1.2]) { o.updateWorldMatrix(true, false); arrows.push(vp.project(V(0, 0, 0).copy(o.userData.dir).multiplyScalar(t * 0.95).applyMatrix4(o.parent.matrixWorld))); } });
  const pad = []; vp.overlay.traverseVisible((o) => { if (o.userData.axis === "free") pad.push(vp.project(o.getWorldPosition(V(0, 0, 0)))); });
  for (const s of [0.125, 0.375, 0.625, 0.875, 0.0625, 0.25, 0.5, 0.75, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375]) {
    const t = s * Math.PI * 2, [px, py] = vp.project(V(Math.cos(t) * 0.95, Math.sin(t) * 0.95, 0).applyMatrix4(obj.matrixWorld));
    const d = Math.hypot(px - cx, py - cy) || 1, sx = px + (off * (px - cx)) / d, sy = py + (off * (py - cy)) / d;
    const facing = Math.sign(obj.userData.dir.dot(vp.camera.position.clone().sub(centre))) || 1;
    const a = Math.atan2(-(sy - cy), sx - cx) + (facing * deg * Math.PI) / 180, R = Math.hypot(sx - cx, sy - cy), ex = cx + R * Math.cos(a), ey = cy - R * Math.sin(a);
    const free = (x, y) => document.elementFromPoint(rect.left + x, rect.top + y) === vp.canvas;
    if (others.some(([ox, oy]) => Math.hypot(ox - sx, oy - sy) < off + 10)) continue;
    if ([...arrows, ...pad].some(([ox, oy]) => Math.hypot(ox - sx, oy - sy) < 26 + off)) continue;
    if (free(sx, sy) && free(ex, ey)) return { start: { x: rect.left + sx, y: rect.top + sy }, end: { x: rect.left + ex, y: rect.top + ey } };
  }
  return null;
}, [axis, deg, off]);
// the arrow of an axis: a press 60 % along it and the point 12 mm further along it
const arrowPlan = (p, axis, mm = 12) => p.evaluate(([axis, mm]) => {
  const { vp } = window.__app, rect = vp.canvas.getBoundingClientRect();
  let obj = null;
  vp.overlay.traverseVisible((o) => { if (o.userData.axis === axis && o.userData.dir) obj = o; });
  if (!obj) return null;
  vp.updateCamera(); obj.parent.updateMatrixWorld(true);
  const g = obj.parent, s = g.scale.x, c = g.position.clone(), d = obj.userData.dir.clone();
  const [sx, sy] = vp.project(c.clone().addScaledVector(d, 0.6 * s)), [ex, ey] = vp.project(c.clone().addScaledVector(d, 0.6 * s + mm));
  return { start: { x: rect.left + sx, y: rect.top + sy }, end: { x: rect.left + ex, y: rect.top + ey } };
}, [axis, mm]);
async function mouseDrag(pl, { release = true } = {}) {
  await page.mouse.move(pl.start.x, pl.start.y);
  await page.mouse.down();
  await page.mouse.move(pl.end.x, pl.end.y, { steps: 12 });
  if (release) await page.mouse.up();
}

// one 90 degree turn about Z, typed, in either mode
async function turnTyped(mode, ax, deg) {
  const i = "xyz".indexOf(ax);
  if (mode === "beginner") {
    await page.fill("#insp-turn" + i, String(deg));
    await page.locator("#insp-turn" + i).blur();
  } else {
    await page.click("#ad-moverot");
    await page.fill("#mv-r" + i, String(deg));
    await page.locator("#mv-r" + i).blur();
    await expect.poll(() => run(() => !!window.__store.preview)).toBe(true);
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
  }
}
const fieldId = (mode, i) => (mode === "beginner" ? "#insp-piv" : "#adv-piv") + i;
const resetId = (mode) => (mode === "beginner" ? "#insp-piv-reset" : "#adv-piv-reset");
const setPivotField = async (mode, i, v) => { await page.fill(fieldId(mode, i), String(v)); await page.locator(fieldId(mode, i)).blur(); };

test.describe("desktop", () => {
test.beforeEach(async ({ browser }, info) => { // a page per test, so one failure does not hide the others
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: drag the dot onto the other body's middle (it snaps), then a 90 degree turn swings the box about it; the other body does not change`, async () => {
    const { b1, b2 } = await open(mode);
    await clickBody("b1");
    await expect.poll(dotShown).toBe(true);
    const own = centreOf(b1);
    expectPoint(await pivotNow(), own); // at first: the middle of the box itself
    const depth = await undoDepth();

    // Escape in the middle of a drag puts the pivot back (and keeps the selection)
    await dragDot(await clientOf(centreOf(b2)), { release: false });
    await expect.poll(pivotNow).not.toEqual(own);
    await page.keyboard.press("Escape");
    expectPoint(await pivotNow(), own);
    await page.mouse.up();
    expectPoint(await pivotNow(), own);
    expect(await selected()).toBe("b1");

    await dragDot(await clientOf(centreOf(b2)), { release: false });
    await expect(page.locator(".vp-label.pivot-snap")).toHaveText("Box centre · Reference"); // what it snapped to is named
    await page.mouse.up();
    const C = centreOf(b2); // (110, 30, 15): worked out from the fixture, not from the app
    expectPoint(await pivotNow(), C);
    expect(await matrixOf("b1"), "moving the pivot moves nothing").toEqual(M0);
    expect(await undoDepth(), "and is not an Undo step").toBe(depth);
    expect(await run(() => window.__store.preview)).toBeNull();

    await turnTyped(mode, "z", 90);
    expectMatrix(await matrixOf("b1"), turned("z", 90, C, M0));
    expectBoxNear(await boxOf("b1"), turnedCorners("z", 90, C, b1)); // the world box, from the eight corners turned about C
    expect(await matrixOf("b2"), "the reference body is untouched").toEqual(M2);
    expectBoxNear(await boxOf("b2"), b2);
    expect(await undoDepth()).toBe(depth + 1);
    expectPoint(await pivotNow(), C); // the pivot stays where it was put
  });

  test(`${mode}: Pivot X/Y/Z take fractional numbers, a turn goes about that point, Reset to middle and a new selection start over, and none of it is Undo`, async () => {
    const { b1 } = await open(mode);
    await clickBody("b1");
    for (const i of [0, 1, 2]) await expect(page.locator(fieldId(mode, i))).toBeVisible();
    const depth = await undoDepth();
    await setPivotField(mode, 0, "12.5");
    await setPivotField(mode, 1, "-7.25");
    await setPivotField(mode, 2, "3.125");
    const P = [12.5, -7.25, 3.125];
    expectPoint(await pivotNow(), P);
    expect(await undoDepth(), "typing a pivot is not an Undo step").toBe(depth);
    expect(await matrixOf("b1")).toEqual(M0);

    // a bad entry keeps the previous point
    await page.fill(fieldId(mode, 0), "abc");
    await page.locator(fieldId(mode, 0)).blur();
    expectPoint(await pivotNow(), P);

    await turnTyped(mode, "z", 30);
    expectMatrix(await matrixOf("b1"), turned("z", 30, P, M0));
    expectBoxNear(await boxOf("b1"), turnedCorners("z", 30, P, b1));
    expect(await undoDepth()).toBe(depth + 1);
    expectPoint(await pivotNow(), P); // a turn does not move the pivot
    await page.click("#btn-undo"); // and neither does Undo
    expect(await matrixOf("b1")).toEqual(M0);
    expectPoint(await pivotNow(), P);

    // Reset to middle: the box's own middle again
    await page.click(resetId(mode));
    expectPoint(await pivotNow(), centreOf(b1));
    expect(await undoDepth(), "Reset is not an Undo step either").toBe(depth);
    await expect(page.locator(fieldId(mode, 0))).toHaveValue(String(centreOf(b1)[0]));

    // another selection starts from its own middle, and so does coming back
    await setPivotField(mode, 0, "12.5");
    expectPoint(await pivotNow(), [12.5, centreOf(b1)[1], centreOf(b1)[2]]);
    await run(() => window.__app.select(["b2"]));
    await expect.poll(dotShown).toBe(true);
    expectPoint(await pivotNow(), centreOf(await boxOf("b2")));
    await run(() => window.__app.select(["b1"]));
    expectPoint(await pivotNow(), centreOf(b1));
    expect(await undoDepth()).toBe(depth);
  });
}

test("Beginner: the arcs are drawn round the pivot, a drag turns about it in 15 degree steps with a dashed ring and the angle pill, one Undo step", async () => {
  const { b1 } = await open("beginner");
  await clickBody("b1");
  await expect.poll(arcs).toEqual(["x", "y", "z"]);
  await setPivotField("beginner", 0, "70");
  await setPivotField("beginner", 1, "10");
  await setPivotField("beginner", 2, "8");
  const P = [70, 10, 8], depth = await undoDepth();
  // the Z arc is where the pivot is, not at the bottom plane
  const arcZ = await run(() => { let z = null; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.handle && o.userData.handle.axis === "z") z = o.position.toArray(); }); return z; });
  expectPoint(arcZ, P);
  // press on the Z arc and drag 25 degrees' worth: it lands on 30
  const pl = await run(() => {
    const { vp } = window.__app, rect = vp.canvas.getBoundingClientRect();
    let obj = null; vp.overlay.traverseVisible((o) => { if (o.userData.handle && o.userData.handle.axis === "z") obj = o; });
    vp.updateCamera(); obj.updateWorldMatrix(true, false);
    const V = (x, y, z) => vp.view.target.clone().set(x, y, z), c = obj.position.clone(), n = V(0, 0, 1);
    const at = (x, y) => ({ clientX: rect.left + x, clientY: rect.top + y });
    for (const s of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const t = (s * Math.PI) / 2.6, [px, py] = vp.project(V(Math.cos(t), Math.sin(t), 0).applyMatrix4(obj.matrixWorld));
      const ray = vp.ray(at(px, py)), k = c.clone().sub(ray.origin).dot(n) / ray.direction.dot(n), p0 = ray.origin.clone().addScaledVector(ray.direction, k);
      const [ex, ey] = vp.project(p0.clone().sub(c).applyAxisAngle(n, (25 * Math.PI) / 180).add(c));
      if (document.elementFromPoint(rect.left + px, rect.top + py) === vp.canvas && document.elementFromPoint(rect.left + ex, rect.top + ey) === vp.canvas) return { start: { x: rect.left + px, y: rect.top + py }, end: { x: rect.left + ex, y: rect.top + ey } };
    }
    return null;
  });
  expect(pl, "the Z arc on screen").not.toBeNull();
  await mouseDrag(pl, { release: false });
  await expect(page.locator(".turn-pill:not([hidden])")).toHaveText("+30°");
  expect(await run(() => { let on = false; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.turnRing) on = true; }); return on; }), "the dashed ring is drawn while turning").toBe(true);
  await page.mouse.up();
  await expect(page.locator(".turn-pill:not([hidden])")).toBeHidden();
  expectMatrix(await matrixOf("b1"), turned("z", 30, P, M0));
  expectBoxNear(await boxOf("b1"), turnedCorners("z", 30, P, b1));
  expect(await undoDepth()).toBe(depth + 1);
});

test("Beginner: the 90 degree buttons turn about the pivot you chose, with no bottom-keeping nudge", async () => {
  const { b1 } = await open("beginner");
  await clickBody("b1");
  await setPivotField("beginner", 0, "70");
  await setPivotField("beginner", 1, "10");
  await setPivotField("beginner", 2, "8"); // well off the box, and above its bottom
  const P = [70, 10, 8], depth = await undoDepth();
  await page.locator(".seg.rot-btn button", { hasText: "↻ X" }).first().click(); // this button turns by -90
  expectMatrix(await matrixOf("b1"), turned("x", -90, P, M0));
  expectBoxNear(await boxOf("b1"), turnedCorners("x", -90, P, b1));
  expect(await undoDepth()).toBe(depth + 1);
});

// ------------------------------------------------------------------------------------------------ Advanced: the live gizmo
test("Advanced: one click on a body shows the handles at once (no command open, nothing moved); a double-click still opens the editor and moves nothing", async () => {
  await open("advanced");
  const depth = await undoDepth();
  expect(await rings()).toEqual([]); // nothing selected, nothing drawn
  await expect(page.locator("#pivot-panel")).toBeHidden();
  await clickBody("b1");
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  expect(await dotShown()).toBe(true);
  await expect(page.locator("#pivot-panel")).toBeVisible();
  expect(await run(() => window.__app.command), "no command was opened").toBeFalsy();
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await run(() => window.__store.preview)).toBeNull();
  expect(await matrixOf("b1")).toEqual(M0);
  expect(await undoDepth()).toBe(depth);

  // double-click on the body, right where its pivot dot is: the press lands on the dot, no motion, and the editor still opens
  const d = await dotClient();
  await page.mouse.dblclick(d.x, d.y);
  await expect(page.locator("#cmd")).toBeVisible();
  expect(await run(() => window.__app.command.title)).toMatch(/box/i);
  expect(await matrixOf("b1"), "a double-click moves nothing").toEqual(M0);
  expect(await undoDepth()).toBe(depth);
  await page.locator("#cmd footer button", { hasText: "Cancel" }).click();
  expect(await run(() => window.__store.preview)).toBeNull();
  expect(await matrixOf("b1")).toEqual(M0);
  await clickBody("b1"); // (the editor lets go of the selection)
  await expect.poll(rings).toEqual(["x", "y", "z"]);
});

test("Advanced: two drags are two Undo steps and one Undo takes back only the second; Escape and a press with no motion leave nothing", async () => {
  const { b1 } = await open("advanced");
  await clickBody("b1");
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  const C = centreOf(b1), depth = await undoDepth();

  // drag 1: the Z ring, to 30 (25 lands on 30)
  const z = await ringPlan(page, "z", 25);
  expect(z, "the Z ring on screen").not.toBeNull();
  await mouseDrag(z, { release: false });
  await expect(page.locator(".turn-pill:not([hidden])")).toHaveText("+30°"); // the applied angle, beside the pointer
  expect(await matrixOf("b1"), "while dragging only the preview moves").toEqual(M0);
  expectMatrix(await previewOf("b1"), turned("z", 30, C, M0));
  await page.mouse.up();
  const m1 = turned("z", 30, C, M0);
  expectMatrix(await matrixOf("b1"), m1);
  expectBoxNear(await boxOf("b1"), turnedCorners("z", 30, C, b1));
  expect(await undoDepth(), "one drag, one step").toBe(depth + 1);

  // drag 2: the X arrow, 12 mm along X
  const x = await arrowPlan(page, "x", 12);
  await mouseDrag(x);
  const m2 = mul(tr(12, 0, 0), m1);
  expectMatrix(await matrixOf("b1"), m2);
  expect(await undoDepth()).toBe(depth + 2);

  // one Undo takes back only the second
  await page.click("#btn-undo");
  expectMatrix(await matrixOf("b1"), m1);
  expect(await undoDepth()).toBe(depth + 1);
  await page.click("#btn-redo");
  expectMatrix(await matrixOf("b1"), m2);
  await page.click("#btn-undo");

  // Escape drops only the drag in progress: the earlier step stays, the selection stays, nothing is added
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  const y = await ringPlan(page, "y", 40);
  await mouseDrag(y, { release: false });
  await expect.poll(() => previewOf("b1")).not.toBeNull();
  await page.keyboard.press("Escape");
  expect(await previewOf("b1"), "the preview is dropped").toBeNull();
  await page.mouse.up();
  expectMatrix(await matrixOf("b1"), m1);
  expect(await undoDepth()).toBe(depth + 1);
  expect(await selected(), "Escape kept the selection").toBe("b1");
  await expect(page.locator(".turn-pill:not([hidden])")).toBeHidden();

  // a press and release on a ring with no motion changes nothing
  await mouseDrag(await ringPlan(page, "x", 0));
  expect(await undoDepth()).toBe(depth + 1);
  expectMatrix(await matrixOf("b1"), m1);
  expect(await run(() => window.__store.preview)).toBeNull();
});

test("Advanced: the handles follow Shift and Meta toggling and a window selection, skip locked and hidden bodies, and step aside for a command or a sketch", async () => {
  const { b1, b2 } = await open("advanced");
  await clickBody("b1");
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  const depth = await undoDepth();

  // Shift adds, Meta removes, and the pivot is the middle of both boxes
  await clickBody("b2", "Shift");
  expect(await selected()).toBe("b1,b2");
  expect(await rings()).toEqual(["x", "y", "z"]);
  expectPoint(await pivotNow(), centreOf(unionBox(b1, b2)));
  await clickBody("b2", "Meta");
  expect(await selected()).toBe("b1");
  expectPoint(await pivotNow(), centreOf(b1));

  // a window across empty space selects what it touches (b2 only), and the handles come to it
  await page.keyboard.press("Escape");
  expect(await selected()).toBe("");
  await expect.poll(rings).toEqual([]);
  const r = await run(() => {
    const { vp } = window.__app, rect = vp.canvas.getBoundingClientRect(), id = "b2";
    const pts = [], b = window.__app.scene.bodyTightBox(id);
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(vp.project(vp.view.target.clone().set(x, y, z)));
    return { x0: rect.left + Math.min(...pts.map((p) => p[0])) - 12, y0: rect.top + Math.min(...pts.map((p) => p[1])) - 12, x1: rect.left + Math.max(...pts.map((p) => p[0])) + 12, y1: rect.top + Math.max(...pts.map((p) => p[1])) + 12 };
  });
  await page.mouse.move(r.x0, r.y0); await page.mouse.down(); await page.mouse.move(r.x1, r.y1, { steps: 10 }); await page.mouse.up();
  expect(await selected()).toBe("b2");
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  expect(await undoDepth(), "selecting is not an Undo step").toBe(depth);

  // a hidden body cannot be picked and shows nothing
  await run(() => window.__store.update((d) => { d.bodies[1].hidden = true; }, "Hide"));
  await run(() => window.__app.select(["b2"]));
  await expect.poll(rings).toEqual([]);
  await run(() => window.__store.update((d) => { d.bodies[1].hidden = false; }, "Show"));

  // a locked body is selected but never moved: alone it has no handles; with the box it only follows the unlocked one
  await run(() => window.__store.update((d) => { d.bodies[1].locked = true; }, "Lock"));
  await run(() => window.__app.select(["b2"]));
  await expect.poll(rings).toEqual([]);
  await expect(page.locator("#pivot-panel")).toBeHidden();
  await run(() => window.__app.select(["b1", "b2"]));
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  expectPoint(await pivotNow(), centreOf(b1)); // the pivot is the middle of what can move
  const before = await undoDepth();
  await mouseDrag(await arrowPlan(page, "x", 12));
  expectMatrix(await matrixOf("b1"), mul(tr(12, 0, 0), M0));
  expect(await matrixOf("b2"), "the locked body stayed").toEqual(M2);
  expect(await undoDepth()).toBe(before + 1);
  await run(() => window.__store.update((d) => { d.bodies[1].locked = false; }, "Unlock"));

  // a command owns the viewport: the live handles step aside, and come back afterwards
  await run(() => window.__app.select(["b1"]));
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  await run(() => window.__app.advanced.align());
  await expect(page.locator("#cmd")).toContainText("Align");
  await expect.poll(rings).toEqual([]);
  expect(await dotShown()).toBe(false);
  await expect(page.locator("#pivot-panel")).toBeHidden();
  await page.locator("#cmd footer button", { hasText: "Cancel" }).click();
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  expect(await dotShown()).toBe(true);
});

test("Advanced: Move / Copy keeps OK and Cancel, borrows the pivot and keeps the pose when the dot moves; the live handles wait until it closes", async () => {
  const { b1, b2 } = await open("advanced");
  await clickBody("b1");
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  const depth = await undoDepth();
  await page.click("#ad-moverot");
  await expect(page.locator("#cmd")).toContainText("Move / Copy");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await expect(page.locator("#pivot-panel")).toBeVisible(); // the boxes stay while it is open
  await page.fill("#mv-r2", "30"); // turn 30 about the middle of the box first
  await page.locator("#mv-r2").blur();
  await expect.poll(() => previewOf("b1")).not.toBeNull();
  const before = await previewOf("b1");
  expectMatrix(before, turned("z", 30, centreOf(b1), M0));
  // move the dot onto the reference box's middle: the pose on screen does not change
  await dragDot(await clientOf(centreOf(b2)));
  expectMatrix(await previewOf("b1"), before);
  expect(await matrixOf("b1")).toEqual(M0);
  await expect(page.locator("#adv-piv0")).toHaveValue("110");
  // a further 60 turns the preview about that point; OK is one Undo step
  await page.fill("#mv-r2", "90");
  await page.locator("#mv-r2").blur();
  await expect.poll(async () => { const m = await previewOf("b1"); const w = turned("z", 60, centreOf(b2), before); return !!m && w.every((v, i) => Math.abs(m[i] - v) < 1e-6); }).toBe(true);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expectMatrix(await matrixOf("b1"), turned("z", 60, centreOf(b2), before));
  expect(await undoDepth()).toBe(depth + 1);
  expect(await matrixOf("b2")).toEqual(M2);
  await expect.poll(rings).toEqual(["x", "y", "z"]); // the live handles are back
});

test("Advanced: several bodies turn about the union box's middle taken once, so +45 then -45 comes back exactly; Reset to middle uses the boxes as they are now", async () => {
  const { b1, b2 } = await open("advanced");
  const U = centreOf(unionBox(b1, b2));
  await run(() => window.__app.select(["b1", "b2"]));
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  expectPoint(await pivotNow(), U);
  const depth = await undoDepth();
  await turnTyped("advanced", "x", 45);
  const m1 = turned("x", 45, U, M0), m2 = turned("x", 45, U, M2);
  expectMatrix(await matrixOf("b1"), m1);
  expectMatrix(await matrixOf("b2"), m2);
  expectPoint(await pivotNow(), U); // kept: not worked out again from the turned boxes
  await turnTyped("advanced", "x", -45);
  expectMatrix(await matrixOf("b1"), M0);
  expectMatrix(await matrixOf("b2"), M2);
  expect(await undoDepth()).toBe(depth + 2);

  // Reset to middle works the union out from the boxes as they are now
  await turnTyped("advanced", "x", 45);
  await page.click("#adv-piv-reset");
  const now = unionBox(await boxOf("b1"), await boxOf("b2"));
  expectPoint(await pivotNow(), centreOf(now));
});

test("Advanced: with a sketch open the live handles are not drawn; they come back with the body", async () => {
  await loadDoc(page, JSON.parse(readFileSync(new URL("./projects/advanced-sketch-extrude.json", import.meta.url), "utf8")));
  await page.evaluate(() => { window.__app.setMode("advanced", true); window.__app.vp.fit(window.__app.scene.allBox()); });
  await settle();
  await run(() => window.__app.select(["b1"]));
  await expect.poll(rings).toEqual(["x", "y", "z"]);
  await run(() => window.__app.enterSketch("s1"));
  await expect.poll(() => run(() => !!window.__app.sketcher.active)).toBe(true);
  await run(() => window.__app.select(["b1"])); // a selection made from code while the sketch is open
  expect(await rings()).toEqual([]);
  expect(await dotShown()).toBe(false);
  await expect(page.locator("#pivot-panel")).toBeHidden();
  await run(() => window.__app.exitSketch());
  await run(() => window.__app.select(["b1"]));
  await expect.poll(rings).toEqual(["x", "y", "z"]);
});
});

// ------------------------------------------------------------------------------------------------ touch (Chromium: real touch events through the DevTools protocol)
const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: "block" };
async function touchPage(browser, info, options) {
  const ctx = await browser.newContext(options);
  const p = await ctx.newPage();
  const errs = watchErrors(p);
  await boot(p, info);
  const cdp = await ctx.newCDPSession(p);
  return { ctx, p, cdp, errs };
}
const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: q.id ?? i })) });
async function touchTo(cdp, from, to, steps = 10) {
  for (let i = 1; i <= steps; i++) await touch(cdp, "touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
}

for (const mode of ["beginner", "advanced"]) {
  test(`touch (tablet, ${mode}): a finger 21 px from the dot picks it and moves only the pivot; a second finger or a cancelled touch puts it back; a held finger changes nothing`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch events through the DevTools protocol");
    const { ctx, p, cdp, errs } = await touchPage(browser, info, tablet);
    try {
      const { b1, b2 } = await open(mode, p);
      // a tablet has panels over the lower part of the view: lift the picture to the upper part, clear of them
      await p.evaluate(() => { const { vp, scene } = window.__app, c = scene.allBox().getCenter(vp.view.target.clone()), y = vp.project(c)[1]; vp.panBy(0, 0.25 * vp.h - y); });
      await settle(p);
      const s = await spotOn("b1", p);
      await p.touchscreen.tap(s.x, s.y);
      await expect.poll(() => p.evaluate(() => window.__app.sel.join(","))).toBe("b1");
      await expect.poll(() => dotShown(p)).toBe(true);
      const depth = await undoDepth(p);
      expectPoint(await pivotNow(p), centreOf(b1));

      // press 21 px beside the dot (a finger is not on the point), drag onto the other body's middle
      const off = { x: 0, y: 21 };
      const d0 = await dotClient(p), target = await clientOf(centreOf(b2), p);
      const free = (q) => p.evaluate(({ x, y }) => document.elementFromPoint(x, y) === window.__app.vp.canvas, q);
      expect(await free({ x: target.x + off.x, y: target.y + off.y }), "the reference box's middle is on the open canvas").toBe(true);
      const from = { x: d0.x + off.x, y: d0.y + off.y };
      await touch(cdp, "touchStart", [from]);
      await touchTo(cdp, from, { x: target.x + off.x, y: target.y + off.y });
      await touch(cdp, "touchEnd", []);
      await expect.poll(() => pivotNow(p)).not.toEqual(centreOf(b1));
      expectPoint(await pivotNow(p), centreOf(b2));
      expect(await matrixOf("b1", p), "only the pivot moved").toEqual(M0);
      expect(await undoDepth(p)).toBe(depth);
      expect(await p.evaluate(() => window.__store.preview)).toBeNull();

      // a second finger, then a cancelled touch: the pivot goes back to where it was
      for (const how of ["second finger", "cancel"]) {
        const d1 = await dotClient(p), start = { x: d1.x + off.x, y: d1.y + off.y }, away = { x: start.x - 70, y: start.y + 30 };
        await touch(cdp, "touchStart", [start]);
        await touchTo(cdp, start, away);
        await expect.poll(() => pivotNow(p), { message: how + ": it follows the finger" }).not.toEqual(centreOf(b2));
        if (how === "second finger") {
          await touch(cdp, "touchStart", [{ ...away, id: 0 }, { x: away.x - 40, y: away.y - 120, id: 1 }]);
          await touch(cdp, "touchEnd", []);
        } else await touch(cdp, "touchCancel", []);
        expectPoint(await pivotNow(p), centreOf(b2));
        expect(await undoDepth(p)).toBe(depth);
      }

      // holding a finger still on the dot, then lifting it, changes nothing: no geometry, no history
      const d2 = await dotClient(p);
      await touch(cdp, "touchStart", [d2]);
      await p.waitForTimeout(800);
      await touch(cdp, "touchEnd", []);
      expectPoint(await pivotNow(p), centreOf(b2));
      expect(await matrixOf("b1", p)).toEqual(M0);
      expect(await undoDepth(p)).toBe(depth);
    } finally { await ctx.close(); }
    expect(errs).toEqual([]);
  });
}
