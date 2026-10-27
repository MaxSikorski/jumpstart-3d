// Plays the seven batch-2 community lessons (c4-*) the way a student would: starts each from the Tutorials list, follows the
// lesson text through the real buttons, boxes and canvas clicks, and asserts that each step's own check ticks and that the
// lesson finishes. tutorials.spec.mjs only proves the targets exist; this proves the instructions work and the checks can tick.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, newDoc, loadDoc, waitIdle, bodies } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const cur = () => page.evaluate(() => window.__app.tutorials.current);
const doneHas = async (i) => (await cur())?.done.includes(i);
const ticks = (i, what) => expect.poll(() => doneHas(i), { message: `step ${i + 1} (${what}) ticks itself off`, timeout: 8000 }).toBe(true);
const next = () => page.click("#tut-next");

async function startLesson(id, mode) {
  await page.evaluate(() => window.__app.tutorials.close());
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/\.p\.c4-/.test(k) || k.startsWith("p.c4-")) localStorage.removeItem(k); });
  await loadDoc(page, newDoc("Untitled", mode));
  await page.click("#btn-tutorials");
  await page.click("#tut-tab-" + mode);
  await page.click("#tut-" + id);
  await expect(page.locator("#tut-panel")).toBeVisible();
  const tut = await page.evaluate((id) => window.__app.tutorials.list.find((t) => t.id === id).item, id);
  await page.fill("#tut-last", "Lopez"); await page.fill("#tut-first", "Maria"); await page.fill("#tut-item", tut);
  await page.click("#tut-name-apply");
  await ticks(0, "name");
  await next();
}
// Save and Export are the last two steps of every lesson; then Finish.
async function finishLesson() {
  await page.click("#btn-save");
  const i = (await cur()).step;
  await ticks(i, "save");
  await next();
  await page.evaluate(() => window.__app.select([]));
  await waitIdle(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), (async () => { await page.click("#btn-export"); await page.click('#menu-export button[data-act="stl"]'); })()]);
  expect(dl.suggestedFilename()).toMatch(/^Lopez, Maria, .* v1\.stl$/);
  await ticks(i + 1, "export");
  await next();
  await expect(page.locator(".tut-done h2")).toHaveText(/Nice work/);
  await page.click(".tut-done .btn.primary");
}

// type into one of the right-hand panel's boxes the way a student does: click, type, Enter
async function fill(id, text) {
  await page.locator("#" + id).fill(String(text));
  await page.keyboard.press("Enter");
  await waitIdle(page);
}
// the Width, Depth, Height and Position boxes of the selected Beginner shape
async function setShape(o) {
  for (const [k, id] of [["w", "insp-w"], ["d", "insp-d"], ["h", "insp-h"], ["x", "insp-pos0"], ["y", "insp-pos1"], ["z", "insp-pos2"]]) if (o[k] != null) await fill(id, o[k]);
}
async function addTile(kind, hole, o) {
  await page.click(hole ? "#dock-holes" : "#dock-objects");
  await page.locator(`#shapes .tile[data-kind="${kind}"]`).click();
  await waitIdle(page);
  await setShape(o);
}
async function ctrlAGroup() {
  await page.mouse.click(700, 120); // empty ground, so the keys go to the 3D view
  await page.keyboard.press("Control+a");
  await page.click("#bb-group");
  await waitIdle(page);
}
const noErrors = async () => expect((await bodies(page)).filter((b) => b.error)).toEqual([]);

test("c4-roofs: three houses, three roofs", async () => {
  await startLesson("c4-roofs", "beginner");
  await addTile("box", false, { w: 24, d: 24, h: 14, x: -32, y: 0, z: 0 }); await ticks(1, "first house"); await next();
  await page.click("#bb-dup"); await waitIdle(page); await fill("insp-pos0", 0);
  await page.click("#bb-dup"); await waitIdle(page); await fill("insp-pos0", 32);
  await ticks(2, "copies"); await next();
  await addTile("roof", false, { w: 28, d: 28, h: 12, x: -32, y: 0, z: 14 }); await ticks(3, "gable roof"); await next();
  await addTile("roundroof", false, { w: 28, d: 28, h: 10, x: 0, y: 0, z: 14 }); await ticks(4, "round roof"); await next();
  await addTile("pyramid", false, { w: 28, d: 28, h: 14, x: 32, y: 0, z: 14 }); await ticks(5, "pyramid"); await next();
  await noErrors();
  expect((await bodies(page)).length).toBe(6);
  await finishLesson();
});

test("c4-snowman: balls, strip arrows, dome, group", async () => {
  await startLesson("c4-snowman", "beginner");
  await addTile("sphere", false, { w: 30, d: 30, h: 30, x: 0, y: 0, z: 0 }); await ticks(1, "big ball"); await next();
  await addTile("sphere", false, { w: 22, d: 22, h: 22, x: 0, y: 0, z: 24 });
  await addTile("sphere", false, { w: 15, d: 15, h: 15, x: 0, y: 0, z: 42 }); await ticks(2, "middle and head"); await next();
  await page.click("#dock-next"); await page.click("#dock-prev"); await page.click("#dock-help-btn");
  await expect(page.locator("#dock-help")).toBeVisible();
  await page.click("#dock-help-btn"); await expect(page.locator("#dock-help")).toBeHidden();
  await next();
  await addTile("hemisphere", false, { w: 14, d: 14, h: 8, x: 0, y: 0, z: 54 }); await ticks(4, "hat"); await next();
  await ctrlAGroup(); await ticks(5, "group"); await next();
  await noErrors();
  const bs = await bodies(page);
  expect(bs.length).toBe(1);
  expect(bs[0].volume).toBeGreaterThan(14000); // three balls and a dome, fused: about 16 900 minus the overlaps
  await finishLesson();
});

test("c4-cutter-shapes: dimple, taper and slot all cut", async () => {
  await startLesson("c4-cutter-shapes", "beginner");
  await addTile("box", false, { w: 70, d: 30, h: 10, x: 0, y: 0, z: 0 }); await ticks(1, "block"); await next();
  await addTile("sphere", true, { w: 16, d: 16, h: 16, x: -22, y: 0, z: 2 }); await ticks(2, "dimple"); await next();
  await addTile("cone", true, { w: 16, d: 16, h: 16, x: 0, y: 0, z: -2 }); await ticks(3, "taper"); await next();
  await addTile("capsule", true, { w: 20, d: 6, h: 40, x: 22, y: 0, z: -15 }); await ticks(4, "slot"); await next();
  await ctrlAGroup(); await ticks(5, "group"); await next();
  await noErrors();
  const bs = await bodies(page);
  expect(bs.length).toBe(1);
  // the dimple takes out about 1 070 mm3, the taper about 700 and the slot about 1 000: 21 000 minus about 2 800 is left
  expect(bs[0].volume).toBeGreaterThan(17500);
  expect(bs[0].volume).toBeLessThan(18700);
  await finishLesson();
});

test("c4-turn-snap: turn to 30 degrees, snap back, snapping and units", async () => {
  await startLesson("c4-turn-snap", "beginner");
  await addTile("box", false, { w: 30, d: 15, h: 8, x: 0, y: 0, z: 0 }); await ticks(1, "plank"); await next();
  await page.selectOption("#turn-step", "15");
  for (let k = 0; k < 3; k++) await page.click("#turn-plus");
  await waitIdle(page);
  await page.click("#turn-minus"); await waitIdle(page);
  await ticks(2, "turn to 30");
  const ang = await page.evaluate(() => { const m = window.__store.doc.bodies[0].m; return (Math.atan2(m[1], m[0]) * 180) / Math.PI; });
  expect(ang).toBeCloseTo(30, 0);
  await next();
  await page.click("#turn-back"); await waitIdle(page); await ticks(3, "snap back"); await next();
  await page.click("#snap-toggle"); await expect(page.locator("#snap-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.click("#snap-toggle"); await expect(page.locator("#snap-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.click("#snap-more"); await expect(page.locator("#snap-menu")).toBeVisible(); await page.click("#snap-more");
  await next();
  await page.click("#unit-toggle"); await expect(page.locator("#unit-toggle")).toContainText("in");
  await page.click("#unit-toggle"); await expect(page.locator("#unit-toggle")).toContainText("mm");
  await next();
  await finishLesson();
});

test("c4-top-bar: every button in the tour does something and the lesson stays alive", async () => {
  await startLesson("c4-top-bar", "beginner");
  await addTile("box", false, { w: 20, d: 20, h: 10 }); await ticks(1, "block"); await next();
  const auto = page.locator("#btn-autosave");
  if ((await auto.textContent()).includes("Off")) await auto.click();
  await expect(auto).toContainText("On"); await next();
  const sel0 = await page.evaluate(() => [...window.__app.sel]);
  expect(sel0.length, "the new block is selected").toBe(1);
  await page.click("#btn-projects");
  await expect(page.locator(".modal-back").first()).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator(".modal-back")).toHaveCount(0); // Escape itself must close it
  expect(await page.evaluate(() => [...window.__app.sel]), "the same Escape must not clear the selection").toEqual(sel0);
  await expect(page.locator("#btn-projects")).toBeFocused(); // focus goes back to the button that opened the dialog
  await next();
  await page.click("#mode-advanced"); await expect.poll(() => page.evaluate(() => window.__app.mode)).toBe("advanced");
  await page.click("#mode-beginner"); await expect.poll(() => page.evaluate(() => window.__app.mode)).toBe("beginner");
  expect((await bodies(page)).length).toBe(1);
  await next();
  await page.click("#btn-keys"); await expect(page.locator(".modal-back").first()).toBeVisible(); await page.keyboard.press("Escape");
  await expect(page.locator(".modal-back")).toHaveCount(0); // Escape itself must close it;
  await page.click("#btn-about"); await expect(page.locator(".modal", { hasText: "Created by J.Siwek" })).toBeVisible(); await page.keyboard.press("Escape");
  await expect(page.locator(".modal-back")).toHaveCount(0); // Escape itself must close it;
  await next();
  const full = page.locator("#btn-full");
  await full.click(); await expect(full).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement))).toBe(true);
  await full.click(); await expect(full).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement))).toBe(false);
  await next();
  await page.click("#btn-tutorials");
  await expect(page.locator(".tut-modal")).toBeVisible();
  await page.locator(".tut-modal .xbtn").click(); // the × the lesson says to use
  await expect(page.locator(".tut-modal")).toHaveCount(0);
  expect((await cur()).id, "closing the list keeps this lesson open").toBe("c4-top-bar");
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Lopez, Maria, Tour Block");
  await next();
  await finishLesson();
});

// ---- Advanced lessons: dialogs and canvas clicks. A sketch point is clicked where the camera shows it on screen.
const screenOf = (x, y) => page.evaluate(([x, y]) => {
  const vp = window.__app.vp, V = vp.camera.position.constructor, p = vp.project(new V(x, y, 0)), r = vp.canvas.getBoundingClientRect();
  return [r.left + p[0], r.top + p[1], r.width, r.height, p[0], p[1]];
}, [x, y]);
async function clickSketch(x, y) {
  const [px, py, w, h, lx, ly] = await screenOf(x, y);
  expect(lx > 0 && ly > 0 && lx < w && ly < h, `sketch point (${x}, ${y}) is on screen at ${Math.round(lx)}, ${Math.round(ly)} of ${w} x ${h}`).toBe(true);
  await page.mouse.click(px, py);
}
const sketchNow = () => page.evaluate(() => { const s = window.__store.doc.sketches[0]; const P = Object.fromEntries(s.pts.map((q) => [q.id, [q.x, q.y]])); return { pts: P, ents: s.ents, cons: s.cons || [] }; });
const lineMid = async (i) => { const s = await sketchNow(); const e = s.ents[i], a = s.pts[e.a], b = s.pts[e.b]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
async function openSketchXY() {
  await page.click("#ad-sketch");
  await page.locator("#plane-seg button").first().click();
  await page.waitForSelector("#sk-line");
}
async function pickConstraint(id) { await page.click("#sk-constraints"); await page.click("#" + id); }

test("c4-screen-looks: material, appearance, lighting, sketches and media switches", async () => {
  await startLesson("c4-screen-looks", "advanced");
  await page.click("#ad-prims"); await page.click("#ad-box");
  for (const [id, v] of [["pr-w", 40], ["pr-d", 40], ["pr-h", 10], ["pr-pos0", 0], ["pr-pos1", 0], ["pr-pos2", 0]]) { await page.locator("#" + id).fill(String(v)); await page.keyboard.press("Tab"); }
  await page.click("#cmd-ok"); await waitIdle(page);
  await ticks(1, "block"); await next();
  await page.mouse.click(...(await screenOf(0, 0)).slice(0, 2)); // select the block, as the lesson says
  await page.click("#ad-decorate"); await page.click("#ad-appearance");
  await page.click("#ap-gold"); await page.click("#cmd-ok"); await waitIdle(page);
  await ticks(2, "material"); await next();
  await page.click("#nav-appear"); await expect(page.locator("#nav-appear")).toHaveAttribute("aria-pressed", "false");
  await page.click("#nav-appear"); await expect(page.locator("#nav-appear")).toHaveAttribute("aria-pressed", "true"); await next();
  const lit = () => page.evaluate(() => window.__app.vp.realistic); // realistic lighting starts off (app.js), so the first click turns it on
  const lit0 = await lit();
  expect(lit0, "a fresh profile starts with realistic lighting off").toBe(false);
  await page.click("#nav-light"); await expect.poll(lit).toBe(!lit0);
  await page.click("#nav-light"); await expect.poll(lit).toBe(lit0); await next();
  await openSketchXY();
  await page.click("#sk-circle");
  await clickSketch(60, 0); await clickSketch(70, 0);
  await page.keyboard.press("Escape");
  await page.click("#sk-finish");
  await ticks(5, "sketch circle"); await next();
  await page.click("#nav-sketches"); await expect.poll(() => page.evaluate(() => window.__app.scene.showSketches)).toBe(false);
  await page.click("#nav-sketches"); await expect.poll(() => page.evaluate(() => window.__app.scene.showSketches)).toBe(true); await next();
  await page.click("#nav-media"); await expect(page.locator("#media-panel")).toBeVisible();
  await page.click("#nav-media"); await expect(page.locator("#media-panel")).toBeHidden(); await next();
  await finishLesson();
});

test("c4-sketch-constraints: a crooked box becomes a rectangular plate with two equal holes", async () => {
  await startLesson("c4-sketch-constraints", "advanced");
  await openSketchXY(); await next();
  await page.click("#sk-line");
  for (const [x, y] of [[-20, -15], [22, -13], [19, 17], [-18, 14], [-20, -15]]) await clickSketch(x, y);
  await page.keyboard.press("Escape");
  await ticks(2, "four lines"); await next();
  await pickConstraint("sk-c-horizontal"); await clickSketch(...(await lineMid(0)));
  await pickConstraint("sk-c-vertical"); await clickSketch(...(await lineMid(3)));
  await ticks(3, "level and plumb"); await next();
  await pickConstraint("sk-c-parallel"); await clickSketch(...(await lineMid(2))); await clickSketch(...(await lineMid(0)));
  await pickConstraint("sk-c-perpendicular"); await clickSketch(...(await lineMid(1))); await clickSketch(...(await lineMid(0)));
  await ticks(4, "parallel and perpendicular"); await next();
  const sq = await sketchNow();
  const [A, B, C, D] = sq.ents.slice(0, 4).map((e) => sq.pts[e.a]);
  expect(Math.abs(B[1] - A[1]), "bottom is level").toBeLessThan(1e-3);
  expect(Math.abs(D[0] - A[0]), "left is upright").toBeLessThan(1e-3);
  expect(Math.abs(C[0] - B[0]) + Math.abs(C[1] - D[1]), "right and top are square too").toBeLessThan(1e-3);
  const w = B[0] - A[0], h = D[1] - A[1];
  // the circle tool snaps to a coarse grid at this zoom, so use round numbers
  await page.click("#sk-circle"); await clickSketch(-10, 0); await clickSketch(-5, 0); await page.keyboard.press("Escape");
  await page.click("#sk-circle"); await clickSketch(10, 0); await clickSketch(10, 8); await page.keyboard.press("Escape");
  const two = (await sketchNow()).ents.filter((e) => e.t === "circle");
  expect(two.length).toBe(2);
  const [small, big] = two.sort((p, q) => p.r - q.r);
  expect(big.r).toBeGreaterThan(small.r);
  const pts = (await sketchNow()).pts;
  await pickConstraint("sk-c-equal");
  await clickSketch(pts[small.c][0] - small.r, pts[small.c][1]); await clickSketch(pts[big.c][0] - big.r, pts[big.c][1]); // each outline, on its left side
  await ticks(5, "equal circles"); await next();
  const cc = (await sketchNow()).ents.filter((e) => e.t === "circle");
  expect(cc[0].r).toBeCloseTo(cc[1].r, 6);
  await page.click("#sk-finish"); await next();
  await page.click("#ad-extrude");
  await clickSketch(A[0] + 3, A[1] + 3); // the shaded part outside both circles
  await page.locator("#ex-dist").fill("4"); await page.keyboard.press("Tab");
  await page.selectOption("#ex-op", "new");
  await page.click("#cmd-ok"); await waitIdle(page);
  await ticks(7, "extrude"); await next();
  await noErrors();
  const bs = await bodies(page);
  expect(bs.length).toBe(1);
  expect(bs[0].volume).toBeCloseTo((w * h - 2 * Math.PI * cc[0].r * cc[0].r) * 4, -1); // the rectangle less two equal holes
  await finishLesson();
});

test('the hole lesson does not tick when the cutter misses the box (browser test F7)', async () => {
  await page.evaluate(() => window.__app.tutorials.close());
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/\.p\.c-view-block/.test(k) || k.startsWith("p.c-view-block")) localStorage.removeItem(k); });
  await startLesson("c-view-block", "beginner");
  await next(); // step 2 of the lesson is "Add a solid"; this opens the cutter step (index 2)
  expect((await cur()).step).toBe(2);
  const [boxId, cutId] = await page.evaluate(() => [
    JS3D.add("box", { size: { w: 40, d: 40, h: 8 }, at: [40, 0, 0] }), // the mistake in the report: box left at X 40
    JS3D.add("cylinder", { size: { w: 10, d: 10, h: 12 }, at: [0, 0, -2], hole: true }),
  ]);
  const gid = await page.evaluate(async (ids) => { const g = JS3D.group(ids); await JS3D.ready(); return g; }, [boxId, cutId]);
  await waitIdle(page);
  await page.waitForTimeout(1500);
  expect(await doneHas(2), "the lesson ticked although the cutter is clear of the box").toBeFalsy();
  await next();
  expect((await cur()).step, "Next moved on from a cut that did not happen").toBe(2);
  await expect(page.locator("#toasts")).toContainText("does not cut");
  // fix it the way the lesson says: undo the group, put the box at X 0, group again
  await page.evaluate(async (ids) => { JS3D.undo(); JS3D.moveTo(ids[0], [0, 0, 0]); JS3D.group(ids); await JS3D.ready(); }, [boxId, cutId]);
  await waitIdle(page);
  await ticks(2, "a cutter that really cuts the box");
  expect(gid).toBeTruthy();
  await next();
  expect((await cur()).step).toBe(3);
  await page.evaluate(() => window.__app.tutorials.close());
});
