// Fusion-style direct edit, PR 3: a finished sketch's shape is clicked or dragged to extrude it (both modes, real mouse, 1400 x 900).
// Max's words: "when i hover over that sketch, it should highlight and be able to drag up or down to extrude one way or another, or at
// least click on it and it automatically goes into the extrude tool ... if it's a body and I move it inward, that would be a cut.
// Double clicking the sketch brings up the sketch again."
// Proof from the user's side, every outcome read from the app's own state (the command, the stored design, the bodies' volumes):
//  - hover lights the shape (orange, pointer cursor, status-bar hint) and leaving puts it back;
//  - a click opens Extrude with that one shape picked and the arrow showing (10 mm in Beginner, 0 in Advanced), a typed 5 makes a 20 x 20 x 5 body;
//  - a drag up opens Extrude at once, leaves it open, and Enter keeps a body of 400 x the dragged height;
//  - a drag down on a sketch drawn on a body's top face cuts that body (a bool cut mod, no new body);
//  - a sketch pulled down into a body that stands under it cuts it; one that only touches a body at an edge stays a new body;
//  - a double-click opens the sketch, not Extrude; a body in front of a shape (or a shift-click) still takes the click;
//  - Beginner: closing a shape does not open Extrude, a note says what to do instead, and Finish sketch then a click does;
//  - touch: a tap on the shape opens Extrude, two quick taps open the sketch.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim, bodies } from "./helpers.mjs";

const BOX = prim("box", { w: 20, d: 20, h: 10, r: 0, c: 0 }); // x and y from -10 to 10, standing on z = 0
// a closed square sketch: centre (cx, cy) on the plane z = z0, w x h
const square = (cx, cy, w, h, z0 = 0, extra = {}) => ({
  id: "s1", name: "Sketch 1", seq: 1, hidden: false, cons: [], plane: { o: [0, 0, z0], x: [1, 0, 0], n: [0, 0, 1] },
  pts: [{ id: "p0", x: cx - w / 2, y: cy - h / 2 }, { id: "p1", x: cx + w / 2, y: cy - h / 2 }, { id: "p2", x: cx + w / 2, y: cy + h / 2 }, { id: "p3", x: cx - w / 2, y: cy + h / 2 }],
  ents: [["e0", "p0", "p1"], ["e1", "p1", "p2"], ["e2", "p2", "p3"], ["e3", "p3", "p0"]].map(([id, a, b]) => ({ id, t: "line", a, b })),
  ...extra,
});
const lifted = (z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];
const DOCS = {
  // a box at the origin and a square 20 x 20 on the plate beside it, centre (30, 0)
  beside: (mode) => newDoc("beside", mode, { bodies: [body("b1", "Box", BOX)], sketches: [square(30, 0, 20, 20)] }),
  // the square sits on the box's top face (z = 10), 10 x 10 in the middle
  onTop: (mode) => newDoc("on top", mode, { bodies: [body("b1", "Box", BOX)], sketches: [square(0, 0, 10, 10, 10, { onBody: "b1" })] }),
  // the square beside the box on the plate, touching its edge (x from 10 to 30)
  touching: (mode) => newDoc("touching", mode, { bodies: [body("b1", "Box", BOX)], sketches: [square(20, 0, 20, 20)] }),
  // a riser 20 x 20 x 20 under the plate (z from -20 to 0) with the square on its top
  riser: (mode) => newDoc("riser", mode, { bodies: [body("b1", "Riser", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), lifted(-20))], sketches: [square(0, 0, 10, 10)] }),
  // a riser 20 x 20 x 20 under the plate with a 20 x 20 square on its top (it matches the riser exactly), and a box 10 x 10 x 10 standing on the plate beside it, touching the tool's edge
  riserPlus: (mode) => newDoc("riser plus", mode, { bodies: [body("b1", "Riser", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), lifted(-20)), body("b2", "Stand", prim("box", { w: 10, d: 10, h: 10, r: 0, c: 0 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 15, 0, 0, 1])], sketches: [square(0, 0, 20, 20)] }),
  // the same riser with a circle of radius 5 at (14, 14): its box overlaps the riser's box, the circle itself misses the riser by 0.66 mm
  circleBeside: (mode) => newDoc("circle beside", mode, { bodies: [body("b1", "Riser", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), lifted(-20))], sketches: [{ id: "s1", name: "Sketch 1", seq: 1, hidden: false, cons: [], plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [{ id: "pc", x: 14, y: 14 }], ents: [{ id: "ec", t: "circle", c: "pc", r: 5 }] }] }),
  // a big square on the plate under the box: the box is in front of it
  under: (mode) => newDoc("under", mode, { bodies: [body("b1", "Box", BOX)], sketches: [square(0, 0, 60, 60)] }),
};

let page, errors;
const settle = async (p = page) => { for (let ok = 0; ok < 2;) { await p.waitForTimeout(200); ok = (await p.evaluate(() => !window.__app.vp.isMoving())) ? ok + 1 : 0; } };
const clientOf = (pt, p = page) => p.evaluate(([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);
const undoDepth = (p = page) => p.evaluate(() => window.__store.undoStack.length);
const command = (p = page) => p.evaluate(() => (window.__app.command ? window.__app.command.title : null));
const sketching = (p = page) => p.evaluate(() => window.__app.sketcher.active || null);
const arrowSet = (p = page) => p.evaluate(() => !!(window.__app.command && window.__app.command.arrow));
const distNow = async (p = page) => +(await p.locator("#ex-dist").inputValue());
const profilesText = (p = page) => p.locator("#cmd").innerText();
const volumes = async (p = page) => Object.fromEntries((await bodies(p)).map((b) => [b.id, b.volume]));

async function open(doc, p = page) {
  await loadDoc(p, doc);
  await p.evaluate(() => { // the box round the bodies and the sketches, so the shape is on screen
    const { vp, scene } = window.__app, box = scene.allBox().clone();
    for (const sk of window.__store.doc.sketches) for (const q of sk.pts) box.expandByPoint(vp.view.target.clone().set(q.x, q.y, sk.plane.o[2]));
    vp.fit(box);
  });
  await settle(p);
}
async function dragFrom(from, dy, p = page) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x, from.y + dy / 2, { steps: 6 });
  await p.mouse.move(from.x, from.y + dy, { steps: 6 });
  await p.mouse.up();
}
// Enter in the distance box is OK: wait for the new body to be built
async function keep(p = page) { await p.locator("#ex-dist").press("Enter"); await expect.poll(() => command(p)).toBeNull(); await waitIdle(p); }

test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: pointing at a finished shape lights it up, with a pointer and a hint; moving away puts it back`, async () => {
    await open(DOCS.beside(mode));
    const on = await clientOf([30, 0, 0]);
    const lit = () => page.evaluate(() => ({ hex: window.__app.scene.regionMeshes()[0].material.color.getHexString(), cursor: window.__app.vp.canvas.style.cursor, hint: document.getElementById("hint").textContent }));
    expect((await lit()).hex).not.toBe("e8a317");
    await page.mouse.move(on.x, on.y);
    await expect.poll(lit).toMatchObject({ hex: "e8a317", cursor: "pointer" });
    expect((await lit()).hint).toContain("Click to extrude");
    const off = await clientOf([-40, 30, 0]); // bare plate
    await page.mouse.move(off.x, off.y);
    await expect.poll(lit).toMatchObject({ cursor: expect.not.stringMatching(/pointer/) });
    const after = await lit();
    expect(after.hex).not.toBe("e8a317");
    expect(after.hint).not.toContain("Click to extrude");
    expect(await command(), "hovering opens nothing").toBeNull();
  });

  test(`${mode}: one click opens Extrude on that shape with the arrow showing; typing 5 and Enter makes a 20 x 20 x 5 body`, async () => {
    await open(DOCS.beside(mode));
    const depth = await undoDepth();
    const on = await clientOf([30, 0, 0]);
    await page.mouse.click(on.x, on.y);
    await expect.poll(command).toBe("Extrude");
    expect(await profilesText()).toMatch(/1\s*profile selected/);
    expect(await arrowSet(), "the arrow is showing").toBe(true);
    expect(await distNow(), "Beginner starts 10 mm up, Advanced at 0").toBe(mode === "beginner" ? 10 : 0);
    await page.locator("#ex-dist").fill("5");
    await keep();
    const v = await volumes();
    expect(Object.keys(v)).toHaveLength(2);
    expect(v.b1).toBeCloseTo(4000, 0);
    const added = Object.entries(v).find(([id]) => id !== "b1")[1];
    expect(added).toBeCloseTo(2000, 0);
    expect(await undoDepth(), "one undo step").toBe(depth + 1);
    expect(await page.evaluate(() => window.__store.doc.bodies.every((b) => !window.__app.scene.errors.has(b.id)))).toBe(true);
  });

  test(`${mode}: pressing on the shape and dragging up opens Extrude at once, stays open, and Enter keeps a body of 400 x the height`, async () => {
    await open(DOCS.beside(mode));
    const depth = await undoDepth();
    const on = await clientOf([30, 0, 0]);
    await dragFrom(on, -120);
    await expect.poll(command).toBe("Extrude");
    expect(await command(), "the command stays open after the release").toBe("Extrude");
    const h = await distNow();
    expect(h, "dragging up makes it taller").toBeGreaterThan(0);
    expect(await undoDepth(), "nothing is stored until OK").toBe(depth);
    await keep();
    const v = await volumes();
    expect(Object.keys(v)).toHaveLength(2);
    expect(Object.entries(v).find(([id]) => id !== "b1")[1]).toBeCloseTo(400 * h, 0);
    expect(await undoDepth()).toBe(depth + 1);
  });

  test(`${mode}: the height follows the drag: a short drag gives less than a long one, and neither is the 10 mm a plain click starts with`, async () => {
    await open(DOCS.beside(mode));
    const on = await clientOf([30, 0, 0]);
    await dragFrom(on, -40);
    await expect.poll(command).toBe("Extrude");
    const short = await distNow();
    await page.keyboard.press("Escape");
    await expect.poll(command).toBeNull();
    await dragFrom(on, -130);
    await expect.poll(command).toBe("Extrude");
    const long = await distNow();
    expect(short, "a short drag up").toBeGreaterThan(0);
    expect(long, "a longer drag gives more").toBeGreaterThan(short);
    expect([short, long], "a click would start at 10 in Beginner").not.toContain(10);
  });

  test(`${mode}: the camera does not move during a drag, even looking straight down at the sketch`, async () => {
    await open(DOCS.beside(mode));
    await page.evaluate(() => window.__app.vp.setView("top"));
    await settle();
    const view = () => page.evaluate(() => { const v = window.__app.vp.view; return [v.az, v.el, v.dist, ...v.target.toArray()]; });
    const before = await view();
    await dragFrom(await clientOf([30, 0, 0]), -100);
    await expect.poll(command).toBe("Extrude");
    await settle();
    expect(Math.abs(await distNow()), "the height changed").toBeGreaterThan(0);
    const after = await view();
    after.forEach((v, i) => expect(v, `camera value ${i}`).toBeCloseTo(before[i], 6));
  });

  test(`${mode}: Esc after a drag cancels it and leaves the design as it was`, async () => {
    await open(DOCS.beside(mode));
    const depth = await undoDepth();
    await dragFrom(await clientOf([30, 0, 0]), -100);
    await expect.poll(command).toBe("Extrude");
    expect(await distNow(), "it was a drag, not a click").not.toBe(mode === "beginner" ? 10 : 0);
    await page.keyboard.press("Escape");
    await expect.poll(command).toBeNull();
    expect(await undoDepth()).toBe(depth);
    expect((await bodies(page)).length).toBe(1);
  });

  test(`${mode}: dragging a shape drawn on a body's top face down cuts that body`, async () => {
    await open(DOCS.onTop(mode));
    const depth = await undoDepth();
    await dragFrom(await clientOf([0, 0, 10]), 80);
    await expect.poll(command).toBe("Extrude");
    const h = await distNow();
    expect(h, "dragging down is negative").toBeLessThan(0);
    await expect(page.locator("#ex-hint")).toContainText("cut");
    await keep();
    expect((await bodies(page)).length, "a cut makes no new body").toBe(1);
    expect((await volumes()).b1).toBeCloseTo(4000 - 100 * Math.min(10, -h), 0);
    expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods.some((m) => m.t === "bool" && m.op === "cut"))).toBe(true);
    expect(await undoDepth()).toBe(depth + 1);
  });

  test(`${mode}: a shape that only touches a body at an edge, pulled down, still makes a new body`, async () => {
    await open(DOCS.touching(mode));
    const on = await clientOf([20, 0, 0]);
    await page.mouse.click(on.x, on.y);
    await expect.poll(command).toBe("Extrude");
    await page.locator("#ex-dist").fill("-5");
    await page.locator("#ex-dist").press("Tab");
    await expect(page.locator("#ex-hint")).toContainText("create a new body");
    await keep();
    const v = await volumes();
    expect(Object.keys(v)).toHaveLength(2);
    expect(v.b1, "the box is untouched").toBeCloseTo(4000, 0);
  });

  test(`${mode}: a shape on top of a body that stands under it, pulled down, cuts it`, async () => {
    await open(DOCS.riser(mode));
    const on = await clientOf([0, 0, 0]);
    await page.mouse.click(on.x, on.y);
    await expect.poll(command).toBe("Extrude");
    await page.locator("#ex-dist").fill("-5");
    await page.locator("#ex-dist").press("Tab");
    await expect(page.locator("#ex-hint")).toContainText("cut");
    await keep();
    expect((await bodies(page)).length).toBe(1);
    expect((await volumes()).b1).toBeCloseTo(8000 - 500, 0);
  });

  test(`${mode}: pulling down into a body that matches it stays a cut once the preview has built, and Enter cuts the riser`, async () => {
    await open(DOCS.riserPlus(mode));
    const on = await clientOf([0, 0, 0]);
    await page.mouse.click(on.x, on.y);
    await expect.poll(command).toBe("Extrude");
    await page.locator("#ex-dist").fill("-5");
    await page.locator("#ex-dist").press("Tab");
    for (let i = 0; i < 3; i++) { // the preview builds and the status redraws; the answer must not flip back to a new body
      await waitIdle(page);
      await page.waitForTimeout(500);
      await expect(page.locator("#ex-hint")).toContainText("cut");
    }
    await keep();
    const v = await volumes();
    expect(Object.keys(v), "no new body").toHaveLength(2);
    expect(v.b1).toBeCloseTo(8000 - 20 * 20 * 5, 0);
    const mods = await page.evaluate(() => Object.fromEntries(window.__store.doc.bodies.map((b) => [b.id, (b.node.mods || []).length])));
    expect(mods, "only the riser is cut; the box that only touches the tool is left alone").toEqual({ b1: 1, b2: 0 });
  });

  test(`${mode}: a circle whose box overlaps a body but which misses it makes a new body, not an empty cut`, async () => {
    await open(DOCS.circleBeside(mode));
    const on = await clientOf([14, 14, 0]);
    await page.mouse.click(on.x, on.y);
    await expect.poll(command).toBe("Extrude");
    await page.locator("#ex-dist").fill("-5");
    await page.locator("#ex-dist").press("Tab");
    await expect(page.locator("#ex-hint")).toContainText("create a new body");
    await keep();
    const v = await volumes();
    expect(Object.keys(v)).toHaveLength(2);
    expect(v.b1, "the riser is untouched").toBeCloseTo(8000, 0);
    expect(Object.entries(v).find(([id]) => id !== "b1")[1]).toBeCloseTo(Math.PI * 25 * 5, -1);
  });

  test(`${mode}: pressing the arrow soon after the click that opened Extrude still drags the arrow`, async () => {
    await open(DOCS.beside(mode));
    const on = await clientOf([30, 0, 0]);
    await page.mouse.click(on.x, on.y);
    await page.waitForFunction(() => window.__app.command && window.__app.command.arrow);
    const head = await page.evaluate(() => { const { vp, command } = window.__app, r = vp.canvas.getBoundingClientRect(), s = vp.project(command.arrow.head); return { x: r.left + s[0], y: r.top + s[1] }; });
    const before = await distNow();
    // (this machine's software rendering can hold the page for a second: make the click "just now", as it is for a person)
    await page.evaluate(() => { window.__app.command.openedBy.at = performance.now(); });
    await dragFrom(head, -50); // inside the 500 ms in which a second press at the click's own spot is taken for a double-click; the arrow is somewhere else
    expect(Math.abs((await distNow()) - before), "the arrow moved the height").toBeGreaterThan(0.5);
    expect(await command()).toBe("Extrude");
  });

  test(`${mode}: a press held while the mode is switched is forgotten; clicking a body afterwards opens nothing`, async () => {
    await open(DOCS.beside(mode));
    const on = await clientOf([30, 0, 0]);
    await page.mouse.move(on.x, on.y);
    await page.mouse.down();
    await page.evaluate((m) => window.__app.setMode(m === "beginner" ? "advanced" : "beginner", true), mode);
    await page.mouse.up();
    await page.evaluate((m) => window.__app.setMode(m, true), mode);
    await settle();
    const box = await clientOf([0, 0, 10]);
    await page.mouse.click(box.x, box.y);
    expect(await command(), "no Extrude from the old press").toBeNull();
    expect(await page.evaluate(() => window.__app.sel.join(","))).toBe("b1");
  });

  test(`${mode}: a double-click opens the sketch, not Extrude, and changes nothing`, async () => {
    await open(DOCS.beside(mode));
    const depth = await undoDepth();
    const on = await clientOf([30, 0, 0]);
    await page.mouse.dblclick(on.x, on.y);
    await expect.poll(sketching).toBe("s1");
    await settle();
    expect(await command(), "no Extrude left open").toBeNull();
    expect(await undoDepth()).toBe(depth);
    expect((await bodies(page)).length).toBe(1);
  });

  test(`${mode}: clicks elsewhere still go to the bodies and the plate; a shift-click on the shape opens nothing`, async () => {
    await open(DOCS.beside(mode));
    const box = await clientOf([0, 0, 10]); // the box's top face
    await page.mouse.click(box.x, box.y);
    expect(await page.evaluate(() => window.__app.sel.join(","))).toBe("b1");
    expect(await command()).toBeNull();
    const plate = await clientOf([-40, 30, 0]);
    await page.mouse.click(plate.x, plate.y);
    expect(await command(), "the bare plate opens nothing").toBeNull();
    const on = await clientOf([30, 0, 0]);
    await page.keyboard.down("Shift");
    await page.mouse.click(on.x, on.y);
    await page.keyboard.up("Shift");
    expect(await command(), "a shift-click passes through").toBeNull();
  });

  test(`${mode}: a body in front of a shape takes the click, and no command opens`, async () => {
    await open(DOCS.under(mode));
    const top = await clientOf([0, 0, 10]); // the box's top face, with the big square behind it on the plate
    await page.mouse.move(top.x, top.y);
    expect(await page.evaluate(() => window.__app.vp.canvas.style.cursor), "the shape is not lit behind the box").not.toBe("pointer");
    await page.mouse.click(top.x, top.y);
    expect(await page.evaluate(() => window.__app.sel.join(","))).toBe("b1");
    expect(await command()).toBeNull();
    const free = await clientOf([15, 15, 0]); // the part of the square nothing covers
    await page.mouse.click(free.x, free.y);
    await expect.poll(command).toBe("Extrude");
  });
}

test("beginner: closing a shape no longer opens Extrude; a note says to finish the sketch and click the shape, and that works", async () => {
  await loadDoc(page, newDoc("draw", "beginner"));
  await settle();
  await page.evaluate(() => { // (a toast lives 2.6 s and a slow machine can miss it between two looks: keep a record)
    window.__toastText = "";
    new MutationObserver(() => { window.__toastText += document.getElementById("toasts").textContent + "|"; }).observe(document.getElementById("toasts"), { childList: true, subtree: true });
  });
  await page.click("#bb-sketch");
  await page.locator("#plane-seg button").first().click();
  await page.waitForSelector("#sk-rect");
  await settle();
  const a = await clientOf([-10, -10, 0]), b = await clientOf([10, 10, 0]);
  await page.click("#sk-rect");
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect.poll(() => page.evaluate(() => window.__toastText)).toContain("click the shape");
  await page.waitForTimeout(400); // the old behaviour opened Extrude on the next tick
  expect(await command(), "no Extrude by itself").toBeNull();
  expect(await sketching(), "still in the sketch").not.toBeNull();
  await page.keyboard.press("Escape");
  await page.click("#sk-finish");
  await expect.poll(sketching).toBeNull();
  await settle();
  const mid = await clientOf([0, 0, 0]);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(command).toBe("Extrude");
  expect(await profilesText()).toMatch(/1\s*profile selected/);
});

// touch: real touch events (Chromium only)
const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: "block" };
for (const mode of ["beginner", "advanced"]) {
  test(`touch (tablet, ${mode}): a tap on the shape opens Extrude; two quick taps open the sketch`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation is Chromium only");
    const ctx = await browser.newContext(tablet);
    const p = await ctx.newPage();
    const errs = watchErrors(p);
    try {
      await boot(p, info);
      await open(DOCS.beside(mode), p);
      // the lower part of a tablet's view is under panels: lift the picture
      await p.evaluate(() => { const { vp, scene } = window.__app, c = scene.allBox().getCenter(vp.view.target.clone()), y = vp.project(c)[1]; vp.panBy(0, 0.25 * vp.h - y); });
      await settle(p);
      const on = await clientOf([30, 0, 0], p);
      await p.touchscreen.tap(on.x, on.y);
      await expect.poll(() => command(p)).toBe("Extrude");
      expect(await profilesText(p)).toMatch(/1\s*profile selected/);
      await p.keyboard.press("Escape").catch(() => {});
      await p.evaluate(() => window.__app.command && window.__app.command.cancel());
      await expect.poll(() => command(p)).toBeNull();
      await settle(p);
      const again = await clientOf([30, 0, 0], p);
      await p.touchscreen.tap(again.x, again.y);
      // (opening Extrude can hold this machine's software renderer for a second, which a person's second tap does not wait for: make the first tap "just now")
      await p.evaluate(() => { const c = window.__app.command; if (c && c.openedBy) c.openedBy.at = performance.now(); });
      await p.touchscreen.tap(again.x, again.y);
      await expect.poll(() => sketching(p)).toBe("s1");
      expect(await command(p)).toBeNull();
      expect(errs).toEqual([]);
    } finally { await ctx.close(); }
  });

  test(`touch (tablet, ${mode}): an interrupted touch (cancelled) on the shape opens nothing`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation is Chromium only");
    const ctx = await browser.newContext(tablet);
    const p = await ctx.newPage();
    const errs = watchErrors(p);
    try {
      await boot(p, info);
      await open(DOCS.beside(mode), p);
      await p.evaluate(() => { const { vp, scene } = window.__app, c = scene.allBox().getCenter(vp.view.target.clone()), y = vp.project(c)[1]; vp.panBy(0, 0.25 * vp.h - y); });
      await settle(p);
      const on = await clientOf([30, 0, 0], p);
      const cdp = await ctx.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: on.x, y: on.y, id: 0 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await p.waitForTimeout(500);
      expect(await command(p), "a cancelled touch is not a tap").toBeNull();
      expect(errs).toEqual([]);
    } finally { await ctx.close(); }
  });
}
