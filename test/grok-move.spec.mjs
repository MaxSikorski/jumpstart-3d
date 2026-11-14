// The Grok review's Beginner move and first run (js3d-review bug 1 and 4, quick wins 1, 3, 4, 7, item 9's "AI at the top of More").
// Proof from the user's side, with real mouse (or touch) events and positions read from the document and window.__app.pivot:
//  - a plain drag that starts on the white pivot dot moves the selected box (one Undo entry, Position fields follow), in Simple and in
//    Original + Beginner; Alt-drag (or, on a touch screen, a finger held still) on the dot moves only the pivot, and the status line says so;
//    a mouse press that pauses on the dot and then drags still moves the box;
//  - Simple's Move button arms a real move: a drag on empty plate moves the selection; Esc, Move again or no selection stops it;
//  - clicked solids land beside each other, a clicked hole still lands on the old spot;
//  - the Simple card goes away for good with the first shape; a sphere's print card is calm; AI chat is first in More.
import { test, expect } from "@playwright/test";
import { boot, reload, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";

const BOX = { w: 20, d: 20, h: 20, r: 0, c: 0 };
const design = () => newDoc("grok move", "beginner", { bodies: [body("b1", "Box", prim("box", BOX))] });
const MOVE_HINT = "Drag anywhere on the plate to move the selected shape. Esc or Move again to stop.";
const PIVOT_HINT = "Moving the pivot (the point it turns around). The shape stays put.";
const DOT_TIP = /^(Alt|⌥)-drag to move the pivot \(on a touch screen: press and hold\)$/; // the app writes ⌥ for Alt on a Mac
const phone = (info) => info.project.name === "mobile";

let errors;
test.beforeEach(async ({ page }) => { errors = watchErrors(page); });
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); });

const run = (page, fn, arg) => page.evaluate(fn, arg);
const matrixOf = (page, id = "b1") => run(page, (id) => window.__store.doc.bodies.find((b) => b.id === id).m, id);
const undoDepth = (page) => run(page, () => window.__store.undoStack.length);
const centreOf = (page, id = "b1") => run(page, (id) => { const b = window.__app.scene.bodyTightBox(id); return b ? b.getCenter(b.min.clone()).toArray() : null; }, id);
const pivotNow = (page) => run(page, () => { const a = window.__app, v = a.pivot.get(a.sel); return v ? v.toArray() : null; });
const hint = (page) => run(page, () => document.getElementById("hint").textContent);
const dotShown = (page) => run(page, () => { let on = false; window.__app.vp.overlay.traverseVisible((o) => { if (o.userData.pivotDot) on = true; }); return on; });
const frames = (page) => run(page, () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = async (page) => { for (let ok = 0; ok < 2;) { await page.waitForTimeout(200); ok = (await run(page, () => !window.__app.vp.isMoving())) ? ok + 1 : 0; } };
const clientOf = (page, pt) => run(page, ([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);
const dotClient = async (page) => { await frames(page); return clientOf(page, await run(page, () => window.__app.pivot.dot.position.toArray())); };
const near = (a, b, tol = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
// a point on the open canvas, away from the dot, that is on no body and no handle (empty plate)
const emptySpot = (page) => run(page, () => {
  const { vp, scene, beginner, pivot } = window.__app, r = vp.canvas.getBoundingClientRect(), d = vp.project(pivot.dot.position);
  for (let rad = 120; rad <= 320; rad += 20) for (let k = 0; k < 16; k++) {
    const px = d[0] + rad * Math.cos((k * Math.PI) / 8), py = d[1] + rad * Math.sin((k * Math.PI) / 8), e = { clientX: r.left + px, clientY: r.top + py };
    if (px < 20 || py < 20 || px > r.width - 140 || py > r.height - 20) continue;
    if (document.elementFromPoint(e.clientX, e.clientY) !== vp.canvas) continue;
    if (!scene.pickFace(e) && !beginner.pickHandle(e) && !pivot.dot.at(e, "beginner")) return { x: e.clientX, y: e.clientY };
  }
  return null;
});

// Simple or Original (+ Beginner), the one box, fitted, selected, its pivot dot showing
async function open(page, info, face) {
  await boot(page, info);
  await run(page, (face) => window.__app.setFace(face, true), face);
  await loadDoc(page, design());
  await run(page, () => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(page);
  await run(page, () => window.__app.select(["b1"]));
  await expect.poll(() => dotShown(page)).toBe(true);
}

for (const face of ["simple", "original"]) {
  test(`${face}: a plain drag from the pivot dot moves the box (one Undo entry, Position follows, the pivot goes with it)`, async ({ page }, info) => {
    test.skip(phone(info), "mouse drags: computer layout");
    await open(page, info, face);
    const depth = await undoDepth(page), before = await matrixOf(page);
    expect(await centreOf(page)).toEqual([0, 0, 10]);
    const from = await dotClient(page);
    // Escape in the middle of the drag puts the box back and keeps the selection
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 20, { steps: 8 });
    await expect.poll(() => run(page, () => !!window.__store.preview)).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await matrixOf(page)).toEqual(before);
    expect(await undoDepth(page)).toBe(depth);
    expect(await run(page, () => window.__app.sel.join(","))).toBe("b1");
    expect(await run(page, () => window.__store.preview)).toBeNull();
    // the real drag
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 110, from.y + 40, { steps: 12 });
    await page.mouse.up();
    await waitIdle(page);
    const m = await matrixOf(page);
    expect(Math.hypot(m[12], m[13]), "the box moved on the plate").toBeGreaterThan(5);
    expect(m[14], "it stays on the plate").toBe(0);
    expect(m.slice(0, 12)).toEqual(before.slice(0, 12));
    expect(await undoDepth(page), "one Undo entry").toBe(depth + 1);
    expect(await run(page, () => window.__store.undoStack.at(-1).label)).toBe("Move");
    expect(await run(page, () => window.__store.preview)).toBeNull();
    const c = await centreOf(page);
    expect(near(c, [m[12], m[13], 10], 1e-6)).toBe(true);
    expect(near(await pivotNow(page), c, 1e-6), "the pivot is the box's middle again").toBe(true);
    for (const [i, v] of [[0, m[12]], [1, m[13]]]) await expect.poll(async () => Math.abs(Number(await page.inputValue("#insp-pos" + i)) - v), { message: "Position " + "XY"[i] }).toBeLessThan(0.01);
    expect(await hint(page)).not.toContain("pivot");
    await page.click("#btn-undo");
    expect(await matrixOf(page)).toEqual(before);
  });
}

test("Original + Beginner: Alt-drag on the dot moves only the pivot, the status line says so, and the dot's tooltip tells how", async ({ page }, info) => {
  test.skip(phone(info), "mouse drags: computer layout");
  await open(page, info, "original");
  const depth = await undoDepth(page), before = await matrixOf(page);
  const from = await dotClient(page);
  await page.mouse.move(from.x + 60, from.y + 60);
  await page.mouse.move(from.x, from.y);
  await expect.poll(() => run(page, () => window.__app.vp.canvas.title)).toMatch(DOT_TIP);
  await page.mouse.move(from.x + 50, from.y + 70);
  await expect.poll(() => run(page, () => window.__app.vp.canvas.getAttribute("title"))).toBeNull();
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y - 30, { steps: 12 });
  await expect.poll(() => hint(page)).toBe(PIVOT_HINT);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(await matrixOf(page), "the box stays put").toEqual(before);
  expect(await undoDepth(page), "moving the pivot is not an Undo step").toBe(depth);
  expect(near(await pivotNow(page), [0, 0, 10], 1e-3), "the pivot moved").toBe(false);
  await expect.poll(() => hint(page)).not.toBe(PIVOT_HINT);
});

for (const face of ["simple", "original"]) {
  test(`${face}: a mouse press on the dot that waits, then drags, still moves the box (the pivot goes with it, one Undo entry)`, async ({ page }, info) => {
    test.skip(phone(info), "mouse drags: computer layout");
    await open(page, info, face);
    const depth = await undoDepth(page), before = await matrixOf(page);
    const from = await dotClient(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(700); // the input under test is a slow user's pause (longer than a touch hold), not a wait for the app
    expect(await hint(page), "a mouse pause does not switch to moving the pivot").not.toBe(PIVOT_HINT);
    await page.mouse.move(from.x - 80, from.y + 50, { steps: 12 });
    await page.mouse.up();
    await waitIdle(page);
    const m = await matrixOf(page);
    expect(Math.hypot(m[12], m[13]), "the box moved on the plate").toBeGreaterThan(5);
    expect(m.slice(0, 12)).toEqual(before.slice(0, 12));
    expect(await undoDepth(page), "one Undo entry").toBe(depth + 1);
    expect(await run(page, () => window.__store.undoStack.at(-1).label)).toBe("Move");
    const c = await centreOf(page);
    expect(near(await pivotNow(page), c, 1e-6), "the pivot followed the box").toBe(true);
  });
}

test("Simple: Move arms a real move; a drag on empty plate moves the selection; Esc, Move again or no selection stops it", async ({ page }, info) => {
  test.skip(phone(info), "mouse drags: computer layout (the phone has its own touch test)");
  await open(page, info, "simple");
  const move = page.locator("#sr-move");
  await expect(move).toHaveAttribute("aria-pressed", "false");
  await move.click();
  await expect(move).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => hint(page)).toBe(MOVE_HINT);
  expect(await run(page, () => document.activeElement && document.activeElement.id), "Move no longer jumps into the X field").not.toBe("insp-pos0");
  const depth = await undoDepth(page), spot = await emptySpot(page);
  expect(spot, "an empty spot on the plate").not.toBeNull();
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 90, spot.y + 25, { steps: 12 });
  await page.mouse.up();
  await waitIdle(page);
  const m = await matrixOf(page);
  expect(Math.hypot(m[12], m[13]), "the selected box moved").toBeGreaterThan(5);
  expect(m[14]).toBe(0);
  expect(await undoDepth(page)).toBe(depth + 1);
  expect(await run(page, () => window.__app.sel.join(","))).toBe("b1");
  // still armed for the next drag; Escape stops it and keeps the selection
  await expect(move).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(move).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => hint(page)).not.toBe(MOVE_HINT);
  expect(await run(page, () => window.__app.sel.join(","))).toBe("b1");
  // disarmed: the same drag on empty plate is a selection window again and moves nothing
  const spot2 = await emptySpot(page), m2 = await matrixOf(page);
  await page.mouse.move(spot2.x, spot2.y); await page.mouse.down(); await page.mouse.move(spot2.x + 90, spot2.y + 25, { steps: 8 }); await page.mouse.up();
  expect(await matrixOf(page)).toEqual(m2);
  // Move again turns it off; clearing the selection turns it off
  await run(page, () => window.__app.select(["b1"]));
  await move.click(); await expect(move).toHaveAttribute("aria-pressed", "true");
  await move.click(); await expect(move).toHaveAttribute("aria-pressed", "false");
  await move.click(); await expect(move).toHaveAttribute("aria-pressed", "true");
  await run(page, () => window.__app.select([]));
  await expect(move).toHaveAttribute("aria-pressed", "false");
  await move.click();
  await expect(page.locator("#toasts")).toContainText("Select a shape first, then Move.");
  await expect(move).toHaveAttribute("aria-pressed", "false");
});

// ------------------------------------------------------------------------------------------------ touch (phone project)
const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: q.id ?? i })) });
async function touchTo(cdp, from, to, steps = 10) {
  for (let i = 1; i <= steps; i++) await touch(cdp, "touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
}
// the box in the upper part of the view, clear of the phone's panels
async function lift(page) {
  await run(page, () => { const { vp, scene } = window.__app, c = scene.allBox().getCenter(vp.view.target.clone()), y = vp.project(c)[1]; vp.panBy(0, 0.3 * vp.h - y); });
  await settle(page);
}
const onCanvas = (page, q) => run(page, ({ x, y }) => document.elementFromPoint(x, y) === window.__app.vp.canvas, q);

test("phone: a finger drag from the dot moves the box; a finger held still on the dot, then dragged, moves only the pivot; armed Move drags on empty plate", async ({ page, context, browserName }, info) => {
  test.skip(!phone(info) || browserName !== "chromium", "touch events through the DevTools protocol, phone layout");
  await open(page, info, "simple");
  await lift(page);
  const cdp = await context.newCDPSession(page);
  const depth = await undoDepth(page), before = await matrixOf(page);
  // a plain finger drag from the dot: the box moves
  let d = await dotClient(page);
  expect(await onCanvas(page, d), "the dot is on the open canvas").toBe(true);
  await touch(cdp, "touchStart", [d]);
  await touchTo(cdp, d, { x: d.x + 60, y: d.y + 10 });
  await touch(cdp, "touchEnd", []);
  await waitIdle(page);
  const m = await matrixOf(page);
  expect(Math.hypot(m[12], m[13])).toBeGreaterThan(3);
  expect(await undoDepth(page)).toBe(depth + 1);
  // held still, then dragged: only the pivot
  await expect.poll(() => dotShown(page)).toBe(true);
  d = await dotClient(page);
  const p0 = await pivotNow(page);
  await touch(cdp, "touchStart", [d]);
  await expect.poll(() => hint(page)).toBe(PIVOT_HINT);
  await touchTo(cdp, d, { x: d.x - 50, y: d.y + 20 });
  await touch(cdp, "touchEnd", []);
  expect(await matrixOf(page)).toEqual(m);
  expect(await undoDepth(page)).toBe(depth + 1);
  expect(near(await pivotNow(page), p0, 1e-3)).toBe(false);
  // Move armed: a finger drag on empty plate moves the selection instead of turning the view
  await run(page, () => window.__app.pivot.reset(window.__app.sel));
  await page.locator("#sr-move").click();
  await expect(page.locator("#sr-move")).toHaveAttribute("aria-pressed", "true");
  const spot = await emptySpot(page), view0 = await run(page, () => [window.__app.vp.view.az, window.__app.vp.view.el]);
  expect(spot).not.toBeNull();
  await touch(cdp, "touchStart", [spot]);
  await touchTo(cdp, spot, { x: spot.x + 50, y: spot.y });
  await touch(cdp, "touchEnd", []);
  await waitIdle(page);
  const m2 = await matrixOf(page);
  expect(Math.hypot(m2[12] - m[12], m2[13] - m[13]), "the selection moved").toBeGreaterThan(3);
  expect(await run(page, () => [window.__app.vp.view.az, window.__app.vp.view.el]), "the view did not turn").toEqual(view0);
  expect(await undoDepth(page)).toBe(depth + 2);
  void before;
});

// ------------------------------------------------------------------------------------------------ first run
const tileAdd = async (page, kind, hole = false) => {
  await run(page, ([k, h]) => { window.__app.select([]); window.__app.beginner.showTile(k, h); }, [kind, hole]); // (on a phone the selected shape's sheet covers the strip)
  await page.locator(`#shapes .tile[data-kind="${kind}"]`).click();
};
const worldBoxes = (page) => run(page, () => window.__store.doc.bodies.map((b) => { const x = window.__app.scene.bodyTightBox(b.id); return { id: b.id, kind: b.node.kind, hole: b.hole, m: b.m, box: [...x.min.toArray(), ...x.max.toArray()] }; }));
const overlaps = (a, b) => a[0] < b[3] - 0.01 && b[0] < a[3] - 0.01 && a[1] < b[4] - 0.01 && b[1] < a[4] - 0.01 && a[2] < b[5] - 0.01 && b[2] < a[5] - 0.01;

test("clicking Box, Cylinder and Sphere gives three shapes side by side; a clicked hole still lands on the old spot", async ({ page }, info) => {
  await boot(page, info);
  await run(page, () => window.__app.setFace("simple", true));
  for (const kind of ["box", "cylinder", "sphere"]) await tileAdd(page, kind);
  await waitIdle(page);
  const solids = await worldBoxes(page);
  expect(solids.map((s) => s.kind)).toEqual(["box", "cylinder", "sphere"]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlaps(solids[i].box, solids[j].box), `${solids[i].kind} and ${solids[j].kind} do not overlap`).toBe(false);
  for (const s of solids) expect(Math.abs(s.box[2]), "on the plate").toBeLessThan(1e-6);
  // the old spot: the view's target, rounded to 10 mm (where the first box went)
  const old = await run(page, () => { const t = window.__app.vp.view.target; return [Math.round(t.x / 10) * 10, Math.round(t.y / 10) * 10]; });
  expect([solids[0].m[12], solids[0].m[13]]).toEqual(old);
  await tileAdd(page, "cylinder", true);
  await waitIdle(page);
  const hole = (await worldBoxes(page)).at(-1);
  expect(hole.hole).toBe(true);
  expect([hole.m[12], hole.m[13]], "a hole dropped on the box is the classic cut-a-hole start").toEqual(old);
  expect(overlaps(hole.box, solids[0].box)).toBe(true);
});

test("the Simple card stays clear of the view cube, rail and panel, goes for good with the first shape, and stays gone after a reload", async ({ page }, info) => {
  await boot(page, info, { face: false });
  const card = page.locator("#try-simple");
  await expect(card).toBeVisible();
  // the view cube, the rail, the right panel and the panel handles (the top-bar handle sits right under the top bar)
  const rects = await run(page, () => Object.fromEntries(["try-simple", "simple-rail", "simple-panel", "simple-collapse-top", "simple-collapse-bottom", "simple-collapse-rail", "simple-collapse-panel"].map((id) => [id, document.getElementById(id).getBoundingClientRect().toJSON()]).concat([["cube", document.querySelector(".viewcube").getBoundingClientRect().toJSON()]])));
  const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const other of Object.keys(rects).filter((k) => k !== "try-simple")) expect(hit(rects["try-simple"], rects[other]), "the card covers " + other + " " + JSON.stringify([rects["try-simple"], rects[other]])).toBe(false);
  expect(await run(page, () => { const r = document.getElementById("try-simple").getBoundingClientRect(), b = document.getElementById("face-card-original").getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest("#face-card-original") !== null && b.right <= r.right; }), "Switch to Original is on top and inside the card").toBe(true);
  if (phone(info)) expect(rects["try-simple"].height, "one line on a phone").toBeLessThan(44);
  else expect(rects["try-simple"].top, "bottom-left of the view on a computer").toBeGreaterThan(rects.cube.bottom);
  expect(await run(page, () => localStorage.getItem("jumpstart.face"))).toBeNull();
  await tileAdd(page, "box");
  await expect(card).toHaveCount(0);
  expect(await run(page, () => localStorage.getItem("jumpstart.face")), "adding a shape is not a choice of look").toBeNull();
  await waitIdle(page);
  await reload(page);
  await page.waitForFunction(() => window.__app?.projects?.started === true, null, { timeout: 90_000 });
  await expect(page.locator("html")).toHaveAttribute("data-face", "simple");
  await expect(card).toHaveCount(0);
  expect(await run(page, () => window.__app.trySimpleShown)).toBe(false);
  // and with an empty design after that, it still does not come back
  await run(page, () => { window.__store.load({ v: 1, id: "t_empty", name: "Empty", mode: "beginner", created: 1, seq: 0, grid: 1, bodies: [], sketches: [], planes: [], joints: [] }); });
  await reload(page);
  await page.waitForFunction(() => window.__app?.projects?.started === true, null, { timeout: 90_000 });
  await expect(card).toHaveCount(0);
});

async function verdictOf(page) {
  await expect.poll(() => run(page, () => { const r = document.getElementById("simple-ready"); return r.getAttribute("aria-busy") === "false" && r.dataset.state !== "checking" ? r.dataset.state : null; }), { timeout: 30_000 }).not.toBeNull();
  return run(page, () => { const r = document.getElementById("simple-ready"); return { state: r.dataset.state, text: r.textContent }; });
}

test("a sphere's print card is calm: Needs a little support, the overhang number, and why round bottoms need it", async ({ page }, info) => {
  await boot(page, info);
  await run(page, () => window.__app.setFace("simple", true));
  await run(page, () => { const id = JS3D.add("sphere", { size: [20, 20, 20] }); JS3D.select([id]); });
  await waitIdle(page);
  let v = await verdictOf(page);
  expect(v.state).toBe("warn");
  expect(v.text).toContain("Needs a little support");
  expect(v.text).toMatch(/\d+ mm² leans more than 45°\./);
  expect(v.text).toContain("Round bottoms always need some support; a flat base prints without.");
  expect(v.text).not.toContain("may need supports");
  expect(v.text).not.toContain("Touches the plate only");
  // lifted off the plate: its own message, no round-bottom line
  await run(page, () => JS3D.move(JS3D.selection()[0], [0, 0, 6]));
  await waitIdle(page);
  await expect.poll(async () => (await verdictOf(page)).state).toBe("fail");
  v = await verdictOf(page);
  expect(v.text).toContain("Floats 6 mm above the plate");
  expect(v.text).not.toContain("Round bottoms");
  // a box on the plate is still simply ready
  await run(page, () => { JS3D.remove(JS3D.selection()); const id = JS3D.add("box", { size: [20, 20, 20] }); JS3D.select([id]); });
  await waitIdle(page);
  await expect.poll(async () => (await verdictOf(page)).state).toBe("ready");
});

test("AI chat is the first item in Simple's More, and search still finds it", async ({ page }, info) => {
  await boot(page, info);
  await run(page, () => window.__app.setFace("simple", true));
  await page.click("#sr-more");
  const first = () => run(page, () => [...document.querySelectorAll("#simple-more button[data-for]")].find((b) => b.getClientRects().length)?.dataset.for);
  expect(await first()).toBe("btn-chat");
  await page.fill("#simple-find", "chat");
  expect(await first()).toBe("btn-chat");
  await page.fill("#simple-find", "fillet");
  await expect(page.locator('#simple-more [data-for="btn-chat"]')).toBeHidden();
  await page.fill("#simple-find", "");
  expect(await first()).toBe("btn-chat");
});
