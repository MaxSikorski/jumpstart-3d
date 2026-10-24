// Issue #181 "Sketching: Mirror Function": select sketch shapes, mirror them across a line, an axis or the origin.
// Outcome first: half a profile drawn against the Y axis closes into ONE shape and extrudes to double the volume.
// Shapes are placed from stored sketches; the tool is driven by the M key, the ribbon button, the panel buttons and clicks on the canvas.
// The maths alone is test/sketchmirror.test.mjs.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, newDoc } from "./helpers.mjs";

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { const e = errors; await page.close(); expect(e, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

// a sketch on the ground plane: points as [x, y], then entities written as { t, ... } with point indexes in place of ids
function sketchDoc({ pts, ents, cons = [] }) {
  const id = (i) => "p" + i;
  const map = (e) => {
    const o = { ...e };
    for (const k of ["a", "b", "c", "p"]) if (typeof o[k] === "number") o[k] = id(o[k]);
    if (o.pts) o.pts = o.pts.map(id);
    return o;
  };
  return {
    ...newDoc("Mirror", "advanced"),
    sketches: [{ id: "s1", name: "Sketch 1", seq: 1, hidden: false, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] },
      pts: pts.map((p, i) => ({ id: id(i), x: p[0], y: p[1] })), ents: ents.map((e, i) => ({ id: "e" + i, ...map(e) })), cons }],
  };
}
const line = (a, b, extra = {}) => ({ t: "line", a, b, ...extra });

async function open(spec) {
  await loadDoc(page, sketchDoc(spec));
  await run(() => window.__app.enterSketch("s1"));
  await page.waitForFunction(() => !window.__app.vp.anim);
  await expect(page.locator("#sk-mirror")).toBeVisible();
}
const sk = () => run(() => JSON.parse(JSON.stringify(window.__store.doc.sketches[0])));
const pt = (s, id) => { const p = s.pts.find((q) => q.id === id); return [r3(p.x), r3(p.y)]; };
const selection = () => run(() => [...window.__app.sketcher.sel]);
const pick = (ids) => run((ids) => { const s = window.__app.sketcher; s.sel = new Set(ids); s.redraw(); window.__app.onSketchSelection(); }, ids);
const tool = () => run(() => window.__app.sketcher.tool);
const undoDepth = () => run(() => window.__store.undoStack.length);
const lastLabel = () => run(() => window.__store.undoStack.at(-1).label);
// where a sketch point is on the page (the sketch lies on the ground plane, z = 0)
const at = (x, y) => run(([x, y]) => { const v = window.__app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, 0)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y]);
const clickAt = async (x, y) => { const [px, py] = await at(x, y); await page.mouse.move(px, py); await page.mouse.click(px, py); };
const newEnts = (before, after) => after.ents.filter((e) => !before.ents.some((o) => o.id === e.id));

// close the sketch and extrude every profile of it by h; the profile count, the kernel's volume and any error
async function extrudeAll(h) {
  return run(async (h) => {
    const a = window.__app;
    if (a.sketcher.active) a.exitSketch();
    a.scene.state.forceSketch = "s1";
    a.scene.syncSketches(window.__store.view);
    const regs = a.scene.sketchViews.get("s1").regions;
    window.__store.update((d) => d.bodies.push({ id: "b1", name: "Extrude", seq: 5, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      node: { t: "extrude", sketch: "s1", profiles: regs.map((r) => ({ key: r.key, pt: r.pt })), dist: h, mode: "one", dist2: 0, mods: [] } }), "Extrude");
    return regs.length;
  }, h).then(async (profiles) => {
    await waitIdle(page);
    const b = await run(() => ({ err: window.__app.scene.errors.get("b1") || null, vol: window.__app.scene.views.get("b1").data.volume }));
    expect(b.err, "kernel error").toBeNull();
    return { profiles, vol: b.vol };
  });
}

// half an L, drawn against the Y axis: closed by a line on the axis, and open (ends on the axis, nothing along it)
const HALF_L = {
  pts: [[0, 0], [20, 0], [20, 10], [10, 10], [10, 30], [0, 30]],
  ents: [line(0, 1), line(1, 2), line(2, 3), line(3, 4), line(4, 5), line(5, 0)],
};
const HALF_L_OPEN = { pts: HALF_L.pts, ents: HALF_L.ents.slice(0, 5) };
// a 20 x 20 square away from a drawn line at x = 0
const SQUARE = {
  pts: [[10, 0], [30, 0], [30, 20], [10, 20], [0, -10], [0, 40]],
  ents: [line(0, 1), line(1, 2), line(2, 3), line(3, 0), line(4, 5)],
};
const HALF_L_AREA = 20 * 10 + 10 * 20;

test("half an L against the Y axis, mirrored with the M key and the Y axis button: one profile, double the volume", async () => {
  // the half alone, for the reference volume
  await open(HALF_L);
  const half = await extrudeAll(5);
  expect(half.profiles).toBe(1);
  expect(half.vol).toBeCloseTo(HALF_L_AREA * 5, 0);

  await open(HALF_L_OPEN);
  const before = await sk(), depth = await undoDepth();
  await pick(before.ents.map((e) => e.id));
  await page.locator("#sk-select").focus(); // keys go to the page, not into a field
  await page.keyboard.press("m");
  await expect.poll(tool).toBe("mirror");
  await expect(page.locator("#pal-mirror")).toBeVisible();
  await expect(page.locator("#pal-mir-hint")).toHaveText(/Click a line to mirror across/);
  await expect(page.locator("#sk-mirror")).toHaveAttribute("aria-pressed", "true");
  await page.click("#pal-mir-y");
  expect(await undoDepth()).toBe(depth + 1);
  expect(await lastLabel()).toBe("Mirror");
  const after = await sk();
  expect(after.ents).toHaveLength(5 + 5);
  expect(after.pts).toHaveLength(6 + 4); // the two points on the axis are shared, so the copy joins the original there
  expect(after.pts.filter((p) => Math.abs(p.x) < 1e-9)).toHaveLength(2);
  const mirrored = newEnts(before, after);
  expect(await selection()).toEqual(mirrored.map((e) => e.id));
  expect(await tool()).toBe("select");
  const full = await extrudeAll(5);
  expect(full.profiles).toBe(1);
  expect(full.vol).toBeCloseTo(2 * half.vol, 0);
});

test("a half closed by a line on the axis keeps that line (it is its own mirror image): it divides the whole into two profiles", async () => {
  await open(HALF_L);
  const before = await sk();
  await pick(before.ents.map((e) => e.id));
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  const after = await sk();
  expect(after.ents).toHaveLength(6 + 5); // the line on the axis is not doubled
  const full = await extrudeAll(5);
  expect(full.profiles).toBe(2);
  expect(full.vol).toBeCloseTo(2 * HALF_L_AREA * 5, 0);
});

test("the ribbon button, then clicking the shapes and a drawn line: two profiles, the same volume each", async () => {
  await open(SQUARE);
  const lone = await extrudeAll(3);
  expect(lone.profiles).toBe(1);
  await open(SQUARE);
  const before = await sk();
  await page.click("#sk-mirror");
  await expect.poll(tool).toBe("mirror");
  await expect(page.locator("#pal-mir-hint")).toContainText("Click the shapes to mirror");
  await expect(page.locator("#pal-mir-x")).toBeDisabled();
  // the four sides, by real clicks on their middles
  await clickAt(20, 0); await clickAt(30, 10); await clickAt(20, 20); await clickAt(10, 10);
  expect((await selection()).sort()).toEqual(["e0", "e1", "e2", "e3"]);
  await clickAt(30, 10); // a second click takes a side out again
  expect((await selection()).sort()).toEqual(["e0", "e2", "e3"]);
  await clickAt(30, 10);
  await page.click("#pal-mir-line");
  await expect(page.locator("#pal-mir-hint")).toHaveText(/Click a line to mirror across/);
  const depth = await undoDepth();
  await clickAt(0, 15); // the drawn line
  expect(await undoDepth()).toBe(depth + 1);
  const after = await sk();
  const mirrored = newEnts(before, after);
  expect(mirrored).toHaveLength(4);
  const xs = mirrored.flatMap((e) => [pt(after, e.a)[0], pt(after, e.b)[0]]);
  expect(Math.min(...xs)).toBe(-30);
  expect(Math.max(...xs)).toBe(-10);
  expect(await selection()).toEqual(mirrored.map((e) => e.id));
  const both = await extrudeAll(3);
  expect(both.profiles).toBe(2);
  expect(both.vol).toBeCloseTo(2 * lone.vol, 0);
  expect(lone.vol).toBeCloseTo(400 * 3, 0);
});

test("a D-shape with an arc mirrored across the Y axis keeps its area (the arc still runs counter-clockwise)", async () => {
  // flat side on x = 20, half circle of radius 10 bulging to x = 30
  const D = { pts: [[20, 0], [20, -10], [20, 10]], ents: [{ t: "arc", c: 0, a: 1, b: 2 }, line(2, 1)] };
  await open(D);
  const lone = await extrudeAll(2);
  expect(lone.profiles).toBe(1);
  expect(lone.vol).toBeGreaterThan(Math.PI * 50 * 2 * 0.98);
  await open(D);
  const before = await sk();
  await pick(["e0", "e1"]);
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  const after = await sk();
  const arc = newEnts(before, after).find((e) => e.t === "arc");
  expect(pt(after, arc.c)).toEqual([-20, 0]);
  expect(pt(after, arc.a)).toEqual([-20, 10]);
  expect(pt(after, arc.b)).toEqual([-20, -10]);
  const both = await extrudeAll(2);
  expect(both.profiles).toBe(2);
  expect(both.vol).toBeCloseTo(2 * lone.vol, 1);
});

test("a spline and a circle across an angled drawn line land where the reflection formula puts them", async () => {
  // the line y = x + 10; a point (x, y) goes to (y - 10, x + 10)
  const refl = ([x, y]) => [y - 10, x + 10];
  const fit = [[30, 0], [40, 12], [50, 0], [55, -9]];
  await open({
    pts: [[0, 10], [10, 20], ...fit, [40, -20], [45, 30]],
    ents: [line(0, 1), { t: "spline", pts: [2, 3, 4, 5], closed: false }, { t: "circle", c: 6, r: 5 }, { t: "point", p: 7 }],
  });
  const before = await sk();
  await pick(["e1", "e2", "e3"]);
  await page.keyboard.press("m");
  await expect.poll(tool).toBe("mirror");
  await clickAt(5, 15); // the angled line
  const after = await sk();
  const made = newEnts(before, after);
  expect(made.map((e) => e.t)).toEqual(["spline", "circle", "point"]);
  const [spline, circle, point] = made;
  spline.pts.forEach((id, i) => expect(pt(after, id)).toEqual(refl(fit[i]).map(r3)));
  expect(pt(after, circle.c)).toEqual(refl([40, -20]).map(r3));
  expect(circle.r).toBe(5);
  expect(pt(after, point.p)).toEqual(refl([45, 30]).map(r3));
  expect(await selection()).toEqual(made.map((e) => e.id));
  // a closed spline stays closed
  await run(() => window.__store.update((d) => { d.sketches[0].ents.find((e) => e.t === "spline").closed = true; }, "Close spline"));
  const closedBefore = await sk();
  await pick(["e1"]);
  await page.keyboard.press("m");
  await clickAt(5, 15);
  const closedAfter = await sk();
  expect(newEnts(closedBefore, closedAfter)[0]).toMatchObject({ t: "spline", closed: true });
});

test("Origin (point flip) turns a shape half a turn about the origin", async () => {
  await open({
    pts: [[10, 5], [30, 5], [30, 15], [10, 15], [20, 25]],
    ents: [line(0, 1), line(1, 2), line(2, 3), line(3, 0), { t: "point", p: 4 }],
  });
  const before = await sk();
  await pick(before.ents.map((e) => e.id));
  await page.click("#sk-mirror");
  await page.click("#pal-mir-o");
  const after = await sk();
  const made = newEnts(before, after);
  expect(made).toHaveLength(5);
  const key = (p) => r3(p.x) + "," + r3(p.y);
  expect(after.pts.slice(5).map(key).sort()).toEqual(before.pts.map((p) => key({ x: -p.x, y: -p.y })).sort());
});

test("one undo takes every copy away, and redo brings them all back", async () => {
  await open(HALF_L);
  const before = await sk(), depth = await undoDepth();
  await pick(before.ents.map((e) => e.id));
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  const after = await sk();
  expect(after.ents.length).toBeGreaterThan(before.ents.length);
  await page.click("#btn-undo");
  expect(await undoDepth()).toBe(depth);
  expect(await sk()).toEqual(before);
  await page.click("#btn-redo");
  expect(await sk()).toEqual(after);
});

test("constraints and dimensions among the shapes are copied: a fully constrained rectangle on the axis stays fully constrained with its copy", async () => {
  await open({
    pts: [[0, 0], [30, 0], [30, 20], [0, 20]],
    ents: [line(0, 1), line(1, 2), line(2, 3), line(3, 0)],
    cons: [
      { id: "k0", t: "origin", p: "p0" },
      { id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "horizontal", e1: "e2" },
      { id: "k3", t: "vertical", e1: "e1" }, { id: "k4", t: "vertical", e1: "e3" },
      { id: "d1", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 30, off: [15, -4] },
      { id: "d2", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20, off: [34, 10] },
    ],
  });
  await expect(page.locator("#sk-note")).toHaveText("Fully constrained");
  const before = await sk();
  await pick(before.ents.map((e) => e.id));
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  const after = await sk();
  const made = newEnts(before, after);
  expect(made).toHaveLength(3); // the left side lies on the axis
  const copied = after.cons.filter((c) => !before.cons.some((o) => o.id === c.id));
  expect(copied.map((c) => c.t + (c.k || "")).sort()).toEqual(["dimdist", "dimdist", "horizontal", "horizontal"]);
  const ids = new Set(made.map((e) => e.id));
  // (the copied vertical would only repeat the two dimensions and the horizontals: left out, so the sketch is not over-constrained)
  expect(copied.filter((c) => c.e1).every((c) => ids.has(c.e1))).toBe(true);
  // nothing moved when the solver ran again, and the whole sketch is still fully constrained
  expect(after.pts.slice(0, 4)).toEqual(before.pts);
  expect(after.pts.filter((p) => p.x < 0).map((p) => [p.x, p.y]).sort((a, b) => a[1] - b[1])).toEqual([[-30, 0], [-30, 20]]);
  await expect(page.locator("#sk-note")).toHaveText("Fully constrained"); // exactly: not the over-constrained warning, not "degrees of freedom left"
});

test("text is left out of a mirror, with a note; the other shapes are mirrored", async () => {
  await open({
    pts: [[10, 0], [30, 0], [20, 20]],
    ents: [line(0, 1), { t: "text", p: 2, str: "Hi", size: 8, angle: 0, font: "sans" }],
  });
  const before = await sk();
  await pick(["e0", "e1"]);
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  await expect(page.locator(".toast", { hasText: "Text was left out: mirrored text would read backwards." })).toBeVisible();
  const after = await sk();
  expect(after.ents.filter((e) => e.t === "text")).toHaveLength(1);
  expect(newEnts(before, after).map((e) => e.t)).toEqual(["line"]);
  // only text picked: a note and no change
  const depth = await undoDepth();
  await pick(["e1"]);
  await page.click("#sk-mirror");
  await page.click("#pal-mir-y");
  expect(await undoDepth()).toBe(depth);
  expect((await sk()).ents).toHaveLength(after.ents.length);
});

test("Esc cancels the tool and keeps the picked shapes; construction and projected shapes mirror as the right kind", async () => {
  await open({
    pts: [[10, 5], [30, 5], [10, 10], [30, 10], [10, 20], [30, 20]],
    ents: [line(0, 1), line(2, 3, { cons: true }), line(4, 5, { proj: true })],
  });
  const before = await sk(), depth = await undoDepth();
  await pick(["e0"]);
  await page.click("#sk-mirror");
  await expect.poll(tool).toBe("mirror");
  await expect(page.locator("#pal-mir-hint")).toHaveText(/Click a line to mirror across/);
  await page.keyboard.press("Escape");
  expect(await tool()).toBe("select");
  expect(await selection()).toEqual(["e0"]);
  expect(await undoDepth()).toBe(depth);
  await pick(["e0", "e1", "e2"]);
  await page.click("#sk-mirror");
  await page.click("#pal-mir-x");
  const after = await sk();
  const made = newEnts(before, after);
  expect(made).toHaveLength(3);
  expect(made.map((e) => !!e.cons)).toEqual([false, true, false]);
  expect(made.every((e) => !e.proj)).toBe(true);
  expect(made.map((e) => pt(after, e.a))).toEqual([[10, -5], [10, -10], [10, -20]]);
});
