// The sketch solver, through the real app (jumpstart-3d: sketch solver; the maths alone is test/sketchsolver.test.mjs).
// Outcome first: the hexagon from the post "Not there yet?" drawn with the line tool, then horizontal, equal sides, a length of 20 and a 120 degree
// angle, clicked in BOTH orders, ends as one closed convex hexagon that obeys every constraint (the old solver threw the points 27-135 mm and said nothing).
// A dimension that fights the rest is refused with a toast and the sketch unchanged; one Undo takes back the angle; a repeat is kept with a warning.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc } from "./helpers.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const DRAW = [[-9, -18], [9, -17], [21, 1], [9, 16], [-8, 18], [-20, -1]]; // a hand-drawn hexagon, bottom line roughly flat
const sketch = () => run(() => JSON.parse(JSON.stringify(window.__store.doc.sketches[0])));
const undoDepth = () => run(() => window.__store.undoStack.length);
const lastLabel = () => run(() => window.__store.undoStack.at(-1).label);
const at = (x, y) => run(([x, y]) => { const v = window.__app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, 0)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y]);
const clickAt = async (x, y) => { const [px, py] = await at(x, y); await page.mouse.move(px, py); await page.mouse.click(px, py); };
const along = (sk, i, t = 0.5) => { const e = sk.ents[i], a = sk.pts.find((p) => p.id === e.a), b = sk.pts.find((p) => p.id === e.b); return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]; };
const inside = (sk, i) => { // just inside the hexagon at the corner after line i, where the angle label goes
  const V = sk.pts.find((p) => p.id === sk.ents[(i + 1) % 6].a), cx = sk.pts.reduce((t, p) => t + p.x, 0) / 6, cy = sk.pts.reduce((t, p) => t + p.y, 0) / 6;
  return [V.x + (cx - V.x) * 0.3, V.y + (cy - V.y) * 0.3];
};
const toasts = () => run(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent));
const clearToasts = () => run(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()));

async function openBlank() {
  await loadDoc(page, newDoc("Solver", "advanced", { sketches: [{ id: "s1", name: "Sketch 1", seq: 1, hidden: false, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], cons: [] }] }));
  await run(() => window.__app.enterSketch("s1"));
  await page.waitForFunction(() => !window.__app.vp.anim);
  await expect(page.locator("#sk-line")).toBeVisible();
}
async function drawHexagon() {
  await page.click("#sk-line");
  for (const [x, y] of [...DRAW, DRAW[0]]) await clickAt(x, y);
  await page.keyboard.press("Escape");
  const sk = await sketch();
  expect(sk.ents.length, "six lines").toBe(6);
  expect(sk.pts.length, "closed: six corners").toBe(6);
}
async function constrain(type, ...picks) { // the Constraints menu, then a click on each line
  await page.click("#sk-constraints");
  await page.click("#sk-c-" + type);
  for (const [i, t] of picks) await clickAt(...along(await sketch(), i, t));
}
async function typeValue(v) { await page.waitForSelector("#prompt-value"); await page.fill("#prompt-value", String(v)); await page.press("#prompt-value", "Enter"); }
// the Dimension tool: click the first line, the second, then the label spot, and type the value
async function dimension(picks, labelAt, value) {
  await page.click("#sk-dim");
  for (const [i, t] of picks) await clickAt(...along(await sketch(), i, t));
  await clickAt(...labelAt);
  await typeValue(value);
}
async function setUp() { // horizontal, five equals, the bottom length 20
  await constrain("horizontal", [0, 0.5]);
  for (let i = 1; i < 6; i++) await constrain("equal", [i - 1, 0.5], [i, 0.5]);
  const sk = await sketch(), m = along(sk, 0);
  await page.click("#sk-dim");
  await clickAt(...m);
  await clickAt(m[0] + 1, m[1] - 4);
  await typeValue(20);
}
// every number the constraints promise, measured here from the stored points
async function check(sk, angles) {
  const { measureDim } = await import("../src/dims.js");
  const { findRegions } = await import("../src/regions.js");
  const { resolveSketch } = await import("../src/regions.js");
  const P = new Map(sk.pts.map((p) => [p.id, p])), len = (e) => Math.hypot(P.get(e.b).x - P.get(e.a).x, P.get(e.b).y - P.get(e.a).y);
  const e0 = sk.ents[0];
  expect(Math.abs(P.get(e0.a).y - P.get(e0.b).y), "bottom line horizontal").toBeLessThan(1e-6);
  for (const e of sk.ents) expect(Math.abs(len(e) - 20), "side " + e.id).toBeLessThan(1e-6);
  for (const c of sk.cons.filter((q) => q.t === "dim")) expect(Math.abs(measureDim(sk, c) - c.v), "dimension " + c.k).toBeLessThan(1e-6);
  expect(sk.cons.filter((q) => q.k === "ang").length).toBe(angles);
  for (const c of sk.cons.filter((q) => q.k === "ang")) expect(Math.abs(measureDim(sk, c) - 120), "angle").toBeLessThan(1e-6);
  expect(findRegions(resolveSketch(sk)).length, "one closed profile").toBe(1);
  const turns = sk.ents.map((e, i) => { const f = sk.ents[(i + 1) % 6], u = [P.get(e.b).x - P.get(e.a).x, P.get(e.b).y - P.get(e.a).y], v = [P.get(f.b).x - P.get(f.a).x, P.get(f.b).y - P.get(f.a).y]; return Math.sign(u[0] * v[1] - u[1] * v[0]); });
  expect(new Set(turns).size, "convex: every corner turns the same way").toBe(1);
  expect(Math.max(...sk.pts.map((p) => Math.abs(p.x) + Math.abs(p.y))), "nothing flew away").toBeLessThan(60);
}

for (const [name, first, second] of [["the corner's line first, the bottom line second (the order that broke)", 5, 0], ["the bottom line first, the corner's line second", 0, 5]]) {
  test("Hexagon: horizontal, equal, length 20, then a 120 degree angle, " + name, async () => {
    await openBlank();
    await drawHexagon();
    await setUp();
    await check(await sketch(), 0);
    await clearToasts();
    const sk = await sketch();
    await dimension([[first, 0.6], [second, 0.4]], inside(sk, 5), 120);
    const after = await sketch();
    await check(after, 1);
    await expect(page.locator(".dimlabel", { hasText: "120°" })).toHaveCount(1);
    expect(after.cons.find((c) => c.k === "ang").sg, "the angle's turning direction is stored").toBeTruthy();
    expect(await toasts(), "no complaint").toEqual([]);
    // the other two corners next to it, then the rest: still one hexagon (the sketch is fully held after three, the rest repeat)
    await dimension([[0, 0.4], [1, 0.6]], inside(after, 0), 120);
    await dimension([[1, 0.4], [2, 0.6]], inside(await sketch(), 1), 120);
    await check(await sketch(), 3);
  });
}

test("A dimension that fights the rest is refused: the sketch is unchanged and a toast names the clash; one Undo takes back the angle", async () => {
  await openBlank();
  await drawHexagon();
  await setUp();
  for (const i of [5, 0, 1]) { const sk = await sketch(); await dimension([[i, 0.6], [(i + 1) % 6, 0.4]], inside(sk, i), 120); }
  await check(await sketch(), 3);
  // an angle on another corner: placed at what it measures, then typed as 90 (the sides and angles already fix it at 120)
  const sk = await sketch();
  await page.click("#sk-dim");
  await clickAt(...along(sk, 3, 0.6));
  await clickAt(...along(sk, 4, 0.4));
  await clickAt(...inside(sk, 3));
  await page.waitForSelector("#prompt-value");
  const placed = await sketch(), depth = await undoDepth();
  await clearToasts();
  await page.fill("#prompt-value", "90");
  await page.press("#prompt-value", "Enter");
  await expect.poll(toasts).toContainEqual(expect.stringMatching(/^That angle conflicts with the .* constraints?; nothing changed\.$/));
  const refused = await sketch();
  expect(refused, "nothing changed").toEqual(placed);
  expect(await undoDepth(), "no history entry for a refused edit").toBe(depth);
  await page.waitForSelector("#prompt-value", { state: "detached" });
  await check({ ...refused, cons: refused.cons.filter((c) => c.id !== placed.cons.at(-1).id) }, 3);

  // a good value goes through as one step that Undo takes back whole
  await page.keyboard.press("Escape");
  await run(() => window.__app.sketcher.setTool("select"));
  const before = await sketch(), d0 = await undoDepth();
  const ang = before.cons.find((c) => c.k === "ang");
  await run((id) => window.__app.sketcher.editDim(id), ang.id);
  await typeValue(120);
  await run((id) => window.__app.sketcher.editDim(id), before.cons.find((c) => c.k === "dist").id);
  await typeValue(24);
  expect(await undoDepth()).toBe(d0 + 2);
  expect(await lastLabel()).toBe("Edit dimension");
  const grown = await sketch();
  expect(Math.hypot(grown.pts[1].x - grown.pts[0].x, grown.pts[1].y - grown.pts[0].y)).toBeCloseTo(24, 6);
  await page.click("#btn-undo");
  expect(await undoDepth()).toBe(d0 + 1);
  await page.click("#btn-undo");
  expect(await sketch(), "two undos: back to the sketch before both").toEqual(before);
});

test("Undo restores the sketch from before the angle in one step, and Redo brings the angle back", async () => {
  await openBlank();
  await drawHexagon();
  await setUp();
  const sk = await sketch();
  await page.click("#sk-dim");
  await clickAt(...along(sk, 5, 0.6));
  await clickAt(...along(sk, 0, 0.4));
  await clickAt(...inside(sk, 5));
  await page.waitForSelector("#prompt-value");
  const placed = await sketch(), depth = await undoDepth();
  await page.fill("#prompt-value", "120");
  await page.press("#prompt-value", "Enter");
  await expect.poll(async () => (await sketch()).cons.at(-1).v).toBe(120);
  expect(await undoDepth(), "typing the angle is one step").toBe(depth + 1);
  expect(await lastLabel()).toBe("Edit dimension");
  const done = await sketch();
  await check(done, 1);
  await page.click("#btn-undo");
  expect(await sketch(), "the sketch from before the angle value").toEqual(placed);
  await page.click("#btn-redo");
  expect(await sketch()).toEqual(done);
});

test("A sixth angle repeats the other five: it is kept, with a warning, and the Browser says so", async () => {
  await openBlank();
  await drawHexagon();
  await setUp();
  for (const i of [5, 0, 1, 2]) { const sk = await sketch(); await dimension([[i, 0.6], [(i + 1) % 6, 0.4]], inside(sk, i), 120); }
  await clearToasts();
  const sk = await sketch();
  await page.click("#sk-dim");
  await clickAt(...along(sk, 3, 0.6));
  await clickAt(...along(sk, 4, 0.4));
  await clickAt(...inside(sk, 3));
  await expect.poll(toasts).toContainEqual(expect.stringMatching(/repeats what the other constraints already hold/));
  await typeValue(120);
  const done = await sketch();
  await check(done, 5);
  expect(done.cons.filter((c) => c.k === "ang").length, "the repeat is kept").toBe(5);
  await run(() => window.__app.exitSketch());
  await expect(page.locator("#browser .sk-dof")).toHaveAttribute("title", /more constraints? than needed/);
});
