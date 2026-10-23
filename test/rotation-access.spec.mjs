// Issue #100: turning a shape without moving it. Requester's answer to "What should it end up as?": "no option in advanced mode,
// beginner mode can by just clicking on the object, but you can only rotate by GUI without moving", plus (in the report) text boxes
// for angles and relative movement. Proof from the user's side: select a lopsided box by clicking it, then
//  - Beginner: drag a rotation arc (15 degree steps; Shift or the Free switch gives the pointer's own angle) or type a turn in the inspector;
//  - Advanced: one click on Modify > Move / Rotate shows the rings, the exact boxes, and OK commits one undo step.
// Every turn is compared with a rotation worked out here from the box's own middle, never with the app's own matrix code.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";

const M0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, -12, 5, 1]; // column-major: moved to (30, -12, 5), not turned
const BOX = { w: 40, d: 24, h: 16, r: 0, c: 0 }; // three different sizes, so a turn about any axis changes the box
const design = (mode) => newDoc("rotation access", mode, { bodies: [body("b1", "Box", prim("box", BOX), M0)] });

// ---- the oracle: 4 x 4 column-major matrices
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const tr = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rot = (ax, deg) => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), m = tr(0, 0, 0);
  if (ax === "x") { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (ax === "y") { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (ax === "z") { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
// the turn about the middle of the box, applied after the starting matrix
const turned = (ax, deg, C, base = M0) => mul(mul(mul(tr(C[0], C[1], C[2]), rot(ax, deg)), tr(-C[0], -C[1], -C[2])), base);
// the box after the turn: the same middle, the half-sizes mixed by cos and sin
function turnedBox(ax, deg, box) {
  const C = [0, 1, 2].map((i) => (box[i] + box[i + 3]) / 2), h = [0, 1, 2].map((i) => (box[i + 3] - box[i]) / 2);
  const c = Math.abs(Math.cos((deg * Math.PI) / 180)), s = Math.abs(Math.sin((deg * Math.PI) / 180));
  const [i, j] = { x: [1, 2], y: [0, 2], z: [0, 1] }[ax];
  const n = h.slice();
  n[i] = c * h[i] + s * h[j]; n[j] = s * h[i] + c * h[j];
  return [...C.map((v, k) => v - n[k]), ...C.map((v, k) => v + n[k])];
}
// the angle a turn about one axis left in the matrix (the box started unturned)
const angleOf = (ax, m) => (Math.atan2({ x: m[6], y: m[8], z: m[1] }[ax], { x: m[5], y: m[0], z: m[0] }[ax]) * 180) / Math.PI;
const expectMatrix = (got, want) => { expect(got).toHaveLength(16); want.forEach((v, i) => expect(got[i], `m[${i}]`).toBeCloseTo(v, 6)); };

let page, errors;
const run = (fn, arg) => page.evaluate(fn, arg);
const matrix = () => run(() => window.__store.doc.bodies[0].m);
const previewMatrix = () => run(() => (window.__store.preview ? window.__store.preview.bodies[0].m : null));
const undoDepth = () => run(() => window.__store.undoStack.length);
const boxNow = (p = page) => p.evaluate(() => { const b = window.__app.scene.bodyTightBox("b1"); return b ? [...b.min.toArray(), ...b.max.toArray()] : null; });
const boxGap = async (want, p) => { const b = await boxNow(p); return b ? Math.max(...b.map((v, i) => Math.abs(v - want[i]))) : Infinity; }; // the worst gap to the wanted box
const expectBox = (want, p = page) => expect.poll(() => boxGap(want, p), { timeout: 20_000 }).toBeLessThan(1e-3);
const settle = async (p = page) => { // the camera stops moving, twice in a row
  for (let ok = 0; ok < 2;) { await p.waitForTimeout(200); ok = (await p.evaluate(() => !window.__app.vp.isMoving())) ? ok + 1 : 0; }
};

async function open(mode, p = page) {
  await loadDoc(p, design(mode));
  await p.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(p);
  return boxNow(p);
}

// a spot on the box's top face that shows the box (for a click or a tap)
const spotOnBox = (p = page) => p.evaluate(() => {
  const { vp, scene } = window.__app, b = scene.bodyTightBox("b1"), r = vp.canvas.getBoundingClientRect();
  for (const fx of [0.5, 0.3, 0.7]) for (const fy of [0.5, 0.3, 0.7]) {
    const v = vp.view.target.clone().set(b.min.x + fx * (b.max.x - b.min.x), b.min.y + fy * (b.max.y - b.min.y), b.max.z);
    const [px, py] = vp.project(v), e = { clientX: r.left + px, clientY: r.top + py };
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (top === vp.canvas && scene.pickFace(e) && scene.pickFace(e).body === "b1") return { x: e.clientX, y: e.clientY };
  }
  return null;
});
async function clickBox() {
  const p = await spotOnBox();
  expect(p, "a visible spot on the box").not.toBeNull();
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => run(() => window.__app.sel.join(","))).toBe("b1");
}

// Where to press and where to let go to turn by deg about axis: kind "arc" is Beginner's arc, "ring" Advanced's ring. The pointer
// path is worked out from what is drawn on screen: Beginner measures the pointer's angle on the plane through the box's middle,
// Advanced measures it around the ring's centre on screen (counted the other way when the axis points away from the viewer).
// off pushes the press that many pixels away from the middle of the picture (a finger is not on the line).
const plan = (p, kind, axis, deg, off = 0) => p.evaluate(([kind, axis, deg, off]) => {
  const { vp, scene } = window.__app, rect = vp.canvas.getBoundingClientRect();
  let obj = null;
  vp.overlay.traverseVisible((o) => { if (kind === "arc" ? o.userData.handle && o.userData.handle.type === "rot" && o.userData.handle.axis === axis : o.userData.axis === "rot-" + axis) obj = o; });
  if (!obj) return null;
  obj.updateWorldMatrix(true, false);
  const V = (x, y, z) => vp.view.target.clone().set(x, y, z);
  const centre = kind === "arc" ? scene.bodyTightBox("b1").getCenter(vp.view.target.clone()) : V(0, 0, 0).setFromMatrixPosition(obj.matrixWorld);
  const [cx, cy] = vp.project(centre);
  // a finger (off > 0) must be nearer to the wanted ring than to the others: the press is at least 8 px nearer to the wanted ring than to any other drawn ring
  const others = [];
  if (kind === "ring" && off) vp.overlay.traverseVisible((o) => { if (/^rot-/.test(o.userData.axis || "") && o !== obj) { o.updateWorldMatrix(true, false); for (let i = 0; i < 96; i++) others.push(vp.project(V(Math.cos(i * Math.PI / 48) * 0.95, Math.sin(i * Math.PI / 48) * 0.95, 0).applyMatrix4(o.matrixWorld))); } });
  for (const s of kind === "arc" ? [0.5, 0.35, 0.65, 0.2, 0.8] : [0.125, 0.375, 0.625, 0.875, 0.0625, 0.25, 0.5, 0.75, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375]) {
    const t = kind === "arc" ? (s * Math.PI) / 2.6 : s * Math.PI * 2, r = kind === "arc" ? 1 : 0.95;
    const [px, py] = vp.project(V(Math.cos(t) * r, Math.sin(t) * r, 0).applyMatrix4(obj.matrixWorld));
    const d = Math.hypot(px - cx, py - cy) || 1, sx = px + (off * (px - cx)) / d, sy = py + (off * (py - cy)) / d;
    const at = (x, y) => ({ clientX: rect.left + x, clientY: rect.top + y });
    let ex, ey;
    if (kind === "arc") {
      const n = V(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), ray = vp.ray(at(sx, sy));
      const k = centre.clone().sub(ray.origin).dot(n) / ray.direction.dot(n);
      const p0 = ray.origin.clone().addScaledVector(ray.direction, k); // where the press lands on the turning plane
      [ex, ey] = vp.project(p0.sub(centre).applyAxisAngle(n, (deg * Math.PI) / 180).add(centre));
    } else {
      const facing = Math.sign(obj.userData.dir.dot(vp.camera.position.clone().sub(centre))) || 1;
      const a = Math.atan2(-(sy - cy), sx - cx) + (facing * deg * Math.PI) / 180, R = Math.hypot(sx - cx, sy - cy);
      ex = cx + R * Math.cos(a); ey = cy - R * Math.sin(a);
    }
    const free = (x, y) => document.elementFromPoint(rect.left + x, rect.top + y) === vp.canvas;
    if (others.some(([ox, oy]) => Math.hypot(ox - sx, oy - sy) < off + 8)) continue;
    if (free(sx, sy) && free(ex, ey)) return { start: { x: rect.left + sx, y: rect.top + sy }, end: { x: rect.left + ex, y: rect.top + ey }, centre: [cx, cy] };
  }
  return null;
}, [kind, axis, deg, off]);

async function mouseDrag(pl, { shift = false, release = true } = {}) {
  await page.mouse.move(pl.start.x, pl.start.y);
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(pl.end.x, pl.end.y, { steps: 12 });
  if (release) await mouseUp(shift);
}
async function mouseUp(shift = false) {
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

const rotHandles = (p = page) => p.evaluate(() => { const out = []; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.handle && o.userData.handle.type === "rot") out.push(o.userData.handle.axis); }); return out.sort(); });
const rings = (p = page) => p.evaluate(() => { const out = []; window.__app.vp.overlay.traverseVisible((o) => { if (/^rot-/.test(o.userData.axis || "")) out.push(o.userData.axis.slice(4)); }); return out.sort(); });

test.describe("desktop", () => {
test.beforeEach(async ({ browser }, info) => { // a page per test, so one failure does not hide the others
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

// ------------------------------------------------------------------------------------------------ Beginner
for (const axis of ["x", "z"]) {
  test(`Beginner: click the box, drag the ${axis.toUpperCase()} arc: it turns in 15 degree steps about its own middle, one undo step`, async () => {
    const box0 = await open("beginner");
    await clickBox();
    await expect.poll(() => rotHandles()).toEqual(["x", "y", "z"]); // all three arcs are there as soon as the box is selected
    const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
    const depth = await undoDepth();

    const pl = await plan(page, "arc", axis, 22); // 22 is not a step: it lands on 15 (the nearest 5 would be 20)
    expect(pl, "an arc on screen").not.toBeNull();
    await mouseDrag(pl, { release: false });
    expect(await matrix(), "while dragging only the preview moves").toEqual(M0);
    expectMatrix(await previewMatrix(), turned(axis, 15, C));
    await mouseUp();
    expectMatrix(await matrix(), turned(axis, 15, C));
    expect(await undoDepth()).toBe(depth + 1);
    await expectBox(turnedBox(axis, 15, box0));

    await page.click("#btn-undo");
    expect(await matrix()).toEqual(M0);
    await expectBox(box0);
    expect(await undoDepth()).toBe(depth);
    await page.click("#btn-redo");
    expectMatrix(await matrix(), turned(axis, 15, C));
    await expectBox(turnedBox(axis, 15, box0));
  });
}

test("Beginner: Shift (or Free) turns by the pointer's own angle, not by 15; a press with no movement turns nothing", async () => {
  const box0 = await open("beginner");
  await clickBox();
  const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
  const depth = await undoDepth();

  const pl = await plan(page, "arc", "x", 12.5);
  await mouseDrag(pl, { shift: true });
  const got = angleOf("x", await matrix());
  expect(Math.abs(got - 12.5), `Shift turned ${got} degrees`).toBeLessThan(1); // 12.5 aimed at; a snap would have said 15
  expect(Math.abs(got - Math.round(got)), `${got} is a whole degree: the old 1 degree Shift steps`).toBeGreaterThan(0.3);
  expectMatrix(await matrix(), turned("x", got, C));
  await expectBox(turnedBox("x", got, box0));
  expect(await undoDepth()).toBe(depth + 1);
  await page.click("#btn-undo");
  expect(await matrix()).toEqual(M0);

  // the Free switch does the same without a key
  await page.click("#rot-free");
  await expect(page.locator("#rot-free")).toHaveAttribute("aria-pressed", "true");
  await mouseDrag(await plan(page, "arc", "z", -12.5));
  const free = angleOf("z", await matrix());
  expect(Math.abs(free + 12.5)).toBeLessThan(1);
  expect(Math.abs(free - Math.round(free)), `${free} is a whole degree`).toBeGreaterThan(0.3);
  await page.click("#btn-undo");
  await page.click("#rot-snap");
  await mouseDrag(await plan(page, "arc", "z", 12.5));
  expect(angleOf("z", await matrix())).toBeCloseTo(15, 6); // Snap 15 again: 12.5 lands on 15
  await page.click("#btn-undo");

  // press and let go without moving: no change, no undo step
  const here = await plan(page, "arc", "y", 0);
  await mouseDrag(here);
  expect(await matrix()).toEqual(M0);
  expect(await undoDepth()).toBe(depth);
});

test("Beginner: typed 'Turn by' boxes turn by any decimal angle about the middle, one undo step each; comma and period still nudge 1 and 15", async () => {
  const box0 = await open("beginner");
  await clickBox();
  const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
  const depth = await undoDepth();
  for (const [i, ax] of ["x", "y", "z"].entries()) await expect(page.locator("#insp-turn" + i)).toBeVisible();

  await page.fill("#insp-turn0", "12.5");
  await page.locator("#insp-turn0").blur();
  await expect.poll(undoDepth).toBe(depth + 1);
  expectMatrix(await matrix(), turned("x", 12.5, C));
  await expectBox(turnedBox("x", 12.5, box0));
  await page.click("#btn-undo");
  expect(await matrix()).toEqual(M0);
  await expectBox(box0);

  // a change, not the shape's present angle: -33.3 more on Z after the redo of 12.5 on X is a second turn
  await page.click("#btn-redo");
  await page.fill("#insp-turn2", "-33.3");
  await page.locator("#insp-turn2").blur();
  await expect.poll(undoDepth).toBe(depth + 2);
  expectMatrix(await matrix(), turned("z", -33.3, C, turned("x", 12.5, C)));
  await page.click("#btn-undo");
  await page.click("#btn-undo");
  expect(await matrix()).toEqual(M0);

  // , and . after an arc: 1 degree, with Shift 15
  await mouseDrag(await plan(page, "arc", "y", 30));
  expectMatrix(await matrix(), turned("y", 30, C));
  await page.keyboard.press("Period");
  expectMatrix(await matrix(), turned("y", 31, C));
  await page.keyboard.press("Shift+Comma");
  expectMatrix(await matrix(), turned("y", 16, C));
});

// A lopsided shape: its world box's middle moves when it turns, its own middle does not. +45 then -45 must come back exactly.
const WEDGE = { w: 40, d: 24, h: 16, r: 0, c: 0 };
const wedgeDoc = (mode) => newDoc("rotation wedge", mode, { bodies: [body("b1", "Wedge", prim("wedge", WEDGE), M0)] });
const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
// the middle of the unturned vertex box, read from the mesh and carried to the world by the given matrix (worked out here)
const middleIn = (m) => run(() => {
  const p = window.__app.scene.views.get("b1").data.vertices, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  return lo.map((v, k) => (v + hi[k]) / 2);
}).then((c) => apply(m, c));
const expectPoint = (got, want) => want.forEach((v, i) => expect(got[i], `point[${i}]`).toBeCloseTo(v, 6));

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: a turn of a lopsided wedge keeps its own middle in place, and +45 then -45 puts it back exactly`, async () => {
    await loadDoc(page, wedgeDoc(mode));
    await run(() => window.__app.select(["b1"]));
    const mid0 = await middleIn(M0);
    const turn = async (deg) => { // one typed turn about Y: the wedge is a triangle across Y, so the world box middle moves when it turns
      if (mode === "beginner") {
        await page.fill("#insp-turn1", String(deg));
        await page.locator("#insp-turn1").blur();
      } else {
        await page.click("#ad-moverot");
        await page.fill("#mv-r1", String(deg));
        await page.locator("#mv-r1").blur();
        await expect.poll(previewMatrix).not.toBeNull();
        await page.click("#cmd-ok");
        await expect(page.locator("#cmd")).toBeHidden();
      }
    };
    const depth = await undoDepth();
    await turn(45);
    await expect.poll(undoDepth).toBe(depth + 1);
    const m1 = await matrix();
    expect(Math.abs(angleOf("y", m1) - 45)).toBeLessThan(1e-6);
    expectPoint(await middleIn(m1), mid0); // the wedge's own middle did not move
    // the turn is exactly the one about that point
    expectMatrix(m1, mul(mul(mul(tr(...mid0), rot("y", 45)), tr(...mid0.map((v) => -v))), M0));
    if (mode === "advanced") await run(() => window.__app.select(["b1"]));
    await turn(-45);
    await expect.poll(undoDepth).toBe(depth + 2);
    expectMatrix(await matrix(), M0);
  });
}

test("Beginner: a locked box shows no arcs and no turn boxes, and cannot be turned", async () => {
  await open("beginner");
  await run(() => window.__store.update((d) => { d.bodies[0].locked = true; }, "Lock"));
  await run(() => window.__app.select(["b1"]));
  await expect(page.locator("#inspector")).toBeVisible();
  expect(await rotHandles()).toEqual([]);
  await expect(page.locator("#insp-turn0")).toHaveCount(0);
  expect(await matrix()).toEqual(M0);
});

// ------------------------------------------------------------------------------------------------ Advanced
test("Advanced: one click on Move / Rotate shows the rings; a ring drag is a preview, OK is one undo step; Cancel changes nothing", async () => {
  const box0 = await open("advanced");
  await clickBox(); // a click on the body still only selects it
  expect(await run(() => window.__app.command)).toBeFalsy();
  const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
  const depth = await undoDepth();

  await page.click("#ad-moverot");
  await expect(page.locator("#cmd")).toContainText("Move / Copy");
  await expect.poll(() => rings()).toEqual(["x", "y", "z"]);
  for (const i of [0, 1, 2]) await expect(page.locator("#mv-r" + i)).toBeVisible(); // the exact boxes
  await expect(page.locator("#cmd-ok")).toBeDisabled();

  const pl = await plan(page, "ring", "x", 22); // 22 is not a step: 15 (the old 5 degree rule gave 20)
  expect(pl, "a ring on screen").not.toBeNull();
  await mouseDrag(pl, { release: false });
  await expect(page.locator(".ex-tag b")).toHaveText("+15°"); // the readout shows the applied angle
  await mouseUp();
  expect(await matrix(), "a drag is only a preview").toEqual(M0);
  await expect.poll(previewMatrix).not.toBeNull();
  expectMatrix(await previewMatrix(), turned("x", 15, C));
  expect(await undoDepth()).toBe(depth);
  await expect(page.locator("#mv-r0")).toHaveValue("15");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expectMatrix(await matrix(), turned("x", 15, C));
  expect(await undoDepth()).toBe(depth + 1);
  await expectBox(turnedBox("x", 15, box0));
  await page.click("#btn-undo");
  expect(await matrix()).toEqual(M0);
  await expectBox(box0);
  await page.click("#btn-redo");
  expectMatrix(await matrix(), turned("x", 15, C));

  // Cancel after a drag leaves no step and the original pose
  await page.click("#btn-undo");
  await page.click("#ad-moverot");
  await expect.poll(() => rings()).toEqual(["x", "y", "z"]);
  await mouseDrag(await plan(page, "ring", "y", 30));
  await expect.poll(previewMatrix).not.toBeNull();
  await page.locator("#cmd footer button", { hasText: "Cancel" }).click();
  await expect(page.locator("#cmd")).toBeHidden();
  await expect.poll(previewMatrix).toBeNull();
  expect(await matrix()).toEqual(M0);
  expect(await undoDepth()).toBe(depth);
  // a press with no movement on a ring turns nothing
  await page.click("#ad-moverot");
  await expect.poll(() => rings()).toEqual(["x", "y", "z"]);
  await mouseDrag(await plan(page, "ring", "z", 0));
  await expect(page.locator("#cmd-ok")).toBeDisabled();
});

test("Advanced: Z ring in a fresh design; Shift and the Free switch give the pointer's own angle", async () => {
  const box0 = await open("advanced");
  await clickBox();
  const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
  await page.click("#ad-moverot");
  await expect.poll(() => rings()).toEqual(["x", "y", "z"]);
  await mouseDrag(await plan(page, "ring", "z", 22)); // 15, not the old 5 degree rule's 20
  await page.click("#cmd-ok");
  expectMatrix(await matrix(), turned("z", 15, C));
  await expectBox(turnedBox("z", 15, box0));

  await open("advanced");
  await clickBox();
  await page.click("#ad-moverot");
  await expect.poll(() => rings()).toEqual(["x", "y", "z"]);
  await mouseDrag(await plan(page, "ring", "x", 12.5), { shift: true });
  const got = Number(await page.locator("#mv-r0").inputValue());
  expect(Math.abs(got - 12.5), `Shift turned ${got}`).toBeLessThan(1);
  expect(Math.abs(got - Math.round(got)), `${got} is a whole degree: the old 1 degree Shift steps`).toBeGreaterThan(0.3);
  await page.click("#cmd-ok");
  expectMatrix(await matrix(), turned("x", got, C));
  expect(Math.abs(angleOf("x", await matrix()) - got)).toBeLessThan(0.01);
  await page.click("#btn-undo");

  await page.click("#ad-moverot");
  await page.click("#cmd #rot-free");
  await mouseDrag(await plan(page, "ring", "y", 12.5));
  const free = Number(await page.locator("#mv-r1").inputValue());
  expect(Math.abs(free - 12.5)).toBeLessThan(1);
  expect(Math.abs(free - Math.round(free)), `${free} is a whole degree`).toBeGreaterThan(0.3);
  await page.locator("#cmd footer button", { hasText: "Cancel" }).click();
});

test("Advanced: a typed decimal angle turns by that much about the middle; comma and period nudge 1 and 15; a locked box cannot turn", async () => {
  const box0 = await open("advanced");
  await clickBox();
  const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
  const depth = await undoDepth();
  await page.click("#ad-moverot");
  await page.fill("#mv-r1", "12.5");
  await page.locator("#mv-r1").blur();
  await expect.poll(previewMatrix).not.toBeNull();
  await page.click("#cmd-ok");
  expectMatrix(await matrix(), turned("y", 12.5, C));
  await expectBox(turnedBox("y", 12.5, box0));
  expect(await undoDepth()).toBe(depth + 1);
  await page.click("#btn-undo");
  expect(await matrix()).toEqual(M0);
  await page.click("#btn-redo");
  expectMatrix(await matrix(), turned("y", 12.5, C));
  await page.click("#btn-undo");

  await page.click("#ad-moverot");
  await page.keyboard.press("Period");
  await expect(page.locator("#mv-r2")).toHaveValue("1");
  await page.keyboard.press("Shift+Period");
  await expect(page.locator("#mv-r2")).toHaveValue("16");
  await page.keyboard.press("Comma");
  await expect(page.locator("#mv-r2")).toHaveValue("15");
  await page.locator("#cmd footer button", { hasText: "Cancel" }).click();

  await run(() => window.__store.update((d) => { d.bodies[0].locked = true; }, "Lock"));
  await run(() => window.__app.select(["b1"]));
  await page.click("#ad-moverot");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  expect(await rings()).toEqual([]);
  expect(await matrix()).toEqual(M0);
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

test("touch (tablet): the Snap 15 / Free switch changes what a finger drag turns; a press 14 px off the arc still picks that arc; the buttons are 44 px", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch events through the DevTools protocol");
  const { ctx, p, cdp, errs } = await touchPage(browser, info, tablet);
  try {
    const box0 = await open("beginner", p);
    const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
    const spot = await spotOnBox(p);
    await p.touchscreen.tap(spot.x, spot.y);
    await expect.poll(() => p.evaluate(() => window.__app.sel.join(","))).toBe("b1");
    expect(await rotHandles(p)).toEqual(["x", "y", "z"]);

    // 44 CSS px targets for the turn buttons and the switch
    const sizes = await p.evaluate(() => [...document.querySelectorAll(".rot-btn button")].map((b) => { const r = b.getBoundingClientRect(); return [b.id || b.textContent, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
    expect(sizes.length, "three 90-degree buttons and the two-way switch").toBe(5);
    for (const [name, w, h] of sizes) { expect(w, name + " width").toBeGreaterThanOrEqual(44); expect(h, name + " height").toBeGreaterThanOrEqual(44); }

    // each arc is picked by a press 14 px beside it, not its neighbour
    for (const axis of ["x", "y", "z"]) {
      await expect.poll(() => rotHandles(p)).toEqual(["x", "y", "z"]); // the arcs are redrawn on a frame after the last touch
      const pl = await plan(p, "arc", axis, 0, 14);
      expect(pl, axis + " arc on screen").not.toBeNull();
      await touch(cdp, "touchStart", [pl.start]); // sets the touch mode
      const picked = await p.evaluate(({ x, y }) => { const h = window.__app.beginner.pickHandle({ clientX: x, clientY: y }); return h && h.userData.handle.type === "rot" ? h.userData.handle.axis : null; }, pl.start);
      await touch(cdp, "touchCancel", []); // (a lift with no movement is a tap, which would deselect the box)
      expect(picked, `a finger 14 px from the ${axis} arc`).toBe(axis);
    }

    // snapped: a finger drag of 12.5 lands on 15
    await expect.poll(() => rotHandles(p)).toEqual(["x", "y", "z"]); // the arcs are redrawn on a frame after the last touch
    const pl = await plan(p, "arc", "x", 12.5, 6);
    await touch(cdp, "touchStart", [pl.start]);
    await touchTo(cdp, pl.start, pl.end);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => p.evaluate(() => window.__store.doc.bodies[0].m)).not.toEqual(M0);
    expectMatrix(await p.evaluate(() => window.__store.doc.bodies[0].m), turned("x", 15, C));
    await p.locator("#btn-undo").tap();

    // free: the same drag turns by about 12.5
    await p.locator("#rot-free").tap();
    await expect(p.locator("#rot-free")).toHaveAttribute("aria-pressed", "true");
    await touch(cdp, "touchStart", [pl.start]);
    await touchTo(cdp, pl.start, pl.end);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => p.evaluate(() => window.__store.doc.bodies[0].m)).not.toEqual(M0);
    const got = angleOf("x", await p.evaluate(() => window.__store.doc.bodies[0].m));
    expect(Math.abs(got - 12.5), `free turned ${got}`).toBeLessThan(1);
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});

test("touch (tablet): in Advanced a second finger or a cancelled touch drops the turn in progress and keeps the typed move; OK then accepts only the move", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch events through the DevTools protocol");
  const { ctx, p, cdp, errs } = await touchPage(browser, info, tablet);
  try {
    const box0 = await open("advanced", p);
    const spot = await spotOnBox(p);
    await p.touchscreen.tap(spot.x, spot.y);
    await expect.poll(() => p.evaluate(() => window.__app.sel.join(","))).toBe("b1");
    await p.locator("#ad-moverot").tap();
    await expect.poll(() => rings(p)).toEqual(["x", "y", "z"]);
    const depth = await p.evaluate(() => window.__store.undoStack.length);
    // an earlier typed move stays
    await p.fill("#mv-d0", "5");
    await p.locator("#mv-d0").blur();
    const moved = tr(5, 0, 0);
    const wantMoved = mul(moved, M0);

    for (const how of ["second finger", "cancel"]) {
      const pl = await plan(p, "ring", "z", 40, 6);
      expect(pl, "a ring on screen").not.toBeNull();
      await touch(cdp, "touchStart", [pl.start]);
      await touchTo(cdp, pl.start, pl.end);
      await expect.poll(async () => Number(await p.locator("#mv-r2").inputValue()), { message: "the turn shows while the finger is down" }).not.toBe(0);
      if (how === "second finger") {
        await touch(cdp, "touchStart", [{ ...pl.end, id: 0 }, { x: pl.end.x + 60, y: pl.end.y + 60, id: 1 }]);
        await touch(cdp, "touchEnd", []);
      } else await touch(cdp, "touchCancel", []); // a cancel ends the touch by itself
      await expect(p.locator("#mv-r2"), how).toHaveValue("0");
      await expect(p.locator("#mv-d0"), how).toHaveValue("5");
      await expect(p.locator("#cmd"), "the command stays open").toBeVisible();
      await expect.poll(async () => { const m = await p.evaluate(() => (window.__store.preview ? window.__store.preview.bodies[0].m : null)); return !!m && wantMoved.every((v, i) => Math.abs(m[i] - v) < 1e-6); }, { message: how }).toBe(true);
    }
    await p.locator("#cmd-ok").tap();
    await expect(p.locator("#cmd")).toBeHidden();
    expectMatrix(await p.evaluate(() => window.__store.doc.bodies[0].m), wantMoved);
    expect(await p.evaluate(() => window.__store.undoStack.length)).toBe(depth + 1);
    await expectBox(box0.map((v, i) => v + (i % 3 === 0 ? 5 : 0)), p); // the box moved 5 along X and did not turn
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});

test("touch (tablet): in Advanced a press 14 px beside a ring picks that ring, and Free lets the finger turn by any angle", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch events through the DevTools protocol");
  const { ctx, p, cdp, errs } = await touchPage(browser, info, tablet);
  try {
    const box0 = await open("advanced", p);
    const C = [0, 1, 2].map((i) => (box0[i] + box0[i + 3]) / 2);
    const spot = await spotOnBox(p);
    await p.touchscreen.tap(spot.x, spot.y);
    await p.locator("#ad-moverot").tap();
    await expect.poll(() => rings(p)).toEqual(["x", "y", "z"]);
    const sizes = await p.evaluate(() => [...document.querySelectorAll("#cmd .rot-btn button")].map((b) => { const r = b.getBoundingClientRect(); return [b.id, r.width, r.height]; }));
    expect(sizes).toHaveLength(2);
    for (const [name, w, h] of sizes) { expect(w, name).toBeGreaterThanOrEqual(44); expect(h, name).toBeGreaterThanOrEqual(44); }
    await p.locator("#rot-free").tap();
    const pl = await plan(p, "ring", "y", 20, 14);
    expect(pl, "a ring on screen").not.toBeNull();
    await touch(cdp, "touchStart", [pl.start]);
    await touchTo(cdp, pl.start, pl.end);
    await touch(cdp, "touchEnd", []);
    await expect(p.locator("#mv-r0")).toHaveValue("0"); // not the X ring
    await expect(p.locator("#mv-r2")).toHaveValue("0"); // not the Z ring
    const got = Number(await p.locator("#mv-r1").inputValue());
    expect(Math.abs(got - 20), `the Y ring turned ${got}`).toBeLessThan(1.5);
    await p.locator("#cmd-ok").tap();
    expectMatrix(await p.evaluate(() => window.__store.doc.bodies[0].m), turned("y", got, C));
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});

test("phone: the turn buttons and the Snap 15 / Free switch are 44 px targets", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "phone emulation (isMobile) is Chromium only");
  const { ctx, p, errs } = await touchPage(browser, info, { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  try {
    await loadDoc(p, design("beginner"));
    await p.evaluate(() => window.__app.select(["b1"]));
    await expect(p.locator("#rot-snap")).toBeAttached();
    const measure = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((b) => { const r = b.getBoundingClientRect(); return [b.id || b.textContent, r.width, r.height]; }), sel);
    const beginner = await measure(".rot-btn button");
    expect(beginner.length).toBe(5);
    for (const [name, w, h] of beginner) { expect(w, name).toBeGreaterThanOrEqual(44); expect(h, name).toBeGreaterThanOrEqual(44); }
    await loadDoc(p, design("advanced"));
    await p.evaluate(() => { window.__app.select(["b1"]); document.getElementById("ad-moverot").click(); });
    await expect(p.locator("#cmd .rot-btn")).toBeAttached();
    const advanced = await measure("#cmd .rot-btn button");
    expect(advanced.length).toBe(2);
    for (const [name, w, h] of advanced) { expect(w, name).toBeGreaterThanOrEqual(44); expect(h, name).toBeGreaterThanOrEqual(44); }
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});

test("touch (tablet): a tap on another box that lands inside a selected box's arc pick zone selects that box (Multi-select adds it); a drag from the same spot still turns", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch events through the DevTools protocol");
  const { ctx, p, cdp, errs } = await touchPage(browser, info, tablet);
  try {
    await loadDoc(p, newDoc("rotation tap", "beginner", { bodies: [body("b1", "Box", prim("box", BOX), M0), body("b2", "Box 2", prim("box", BOX), tr(30 + 46, -12, 5))] }));
    await p.evaluate(() => window.__app.vp.fit(window.__app.scene.allBox()));
    await settle(p);
    const sel = () => p.evaluate(() => window.__app.sel.join(","));
    const selectB1 = async () => {
      await p.evaluate(() => window.__app.select(["b1"]));
      await expect.poll(() => rotHandles(p)).toEqual(["x", "y", "z"]); // the arcs are redrawn on a frame after the selection
    };
    await selectB1();
    // a spot on the second box that the finger-sized arc pick would claim (so the arc would win the press)
    const spot = await p.evaluate(() => {
      const { vp, scene, beginner } = window.__app, r = vp.canvas.getBoundingClientRect();
      vp.touchMode = true;
      for (let y = 0; y < r.height; y += 3) for (let x = 0; x < r.width; x += 3) {
        const e = { clientX: r.left + x, clientY: r.top + y }, f = scene.pickFace(e), h = beginner.pickHandle(e);
        if (f && f.body === "b2" && h && h.userData.handle.type === "rot" && document.elementFromPoint(e.clientX, e.clientY) === vp.canvas) return { x: e.clientX, y: e.clientY };
      }
      return null;
    });
    expect(spot, "a spot on the second box inside the arc pick zone").not.toBeNull();
    const tapAt = async () => { await p.waitForTimeout(450); /* (two taps closer than 380 ms are a double-tap) */ await touch(cdp, "touchStart", [spot]); await touch(cdp, "touchEnd", []); };

    await tapAt(); // plain tap: the box under the finger is selected, nothing turned
    await expect.poll(sel).toBe("b2");
    expect(await p.evaluate(() => window.__store.undoStack.length)).toBe(0);
    expect(await p.evaluate(() => window.__store.doc.bodies.map((b) => b.m))).toEqual([M0, tr(30 + 46, -12, 5)]);

    await selectB1();
    await p.evaluate(() => document.getElementById("bb-multi").click()); // Multi-select on: the tap adds the box
    await expect(p.locator("#bb-multi")).toHaveAttribute("aria-pressed", "true");
    await tapAt();
    await expect.poll(sel).toBe("b1,b2");
    await tapAt(); // and a second tap on it takes it out again
    await expect.poll(sel).toBe("b1");
    await p.evaluate(() => document.getElementById("bb-multi").click());

    // a drag that starts on the same spot is still the arc's: it turns the first box
    await expect.poll(() => rotHandles(p)).toEqual(["x", "y", "z"]);
    const arc = await p.evaluate(({ x, y }) => { const h = window.__app.beginner.pickHandle({ clientX: x, clientY: y }); return h && h.userData.handle.axis; }, spot);
    expect(arc, "the press picks an arc").toBeTruthy();
    const pl = await plan(p, "arc", arc, 30, 6);
    expect(pl, "the arc on screen").not.toBeNull();
    await touch(cdp, "touchStart", [pl.start]);
    await touchTo(cdp, pl.start, pl.end);
    await touch(cdp, "touchEnd", []);
    await expect.poll(() => p.evaluate(() => window.__store.doc.bodies[0].m)).not.toEqual(M0);
    expect(await sel()).toBe("b1");
  } finally { await ctx.close(); }
  expect(errs).toEqual([]);
});
