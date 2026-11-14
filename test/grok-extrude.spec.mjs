// Extrude says why OK is off (Grok review, bug list item 10, 2026-11-13). The report: Advanced, Sketch on XY, Rectangle, drag, the check
// mark "Use these values" (4 edges, "1 closed profile"), then Extrude opened with OK greyed out while the status line said "Click the first
// corner". Causes: Advanced Extrude starts at 0 mm (OK needs a distance) and nothing on the panel said so; Extrude from the ribbon picked no
// shape even when there was only one; and the status line did not follow the sketch's clicks (after the first corner it still asked for it).
// Outcomes, read from the app: with one closed shape Extrude picks it, starts 10 mm up and OK works; OK makes a body of the expected volume;
// whenever OK is greyed out the panel says why in one line.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim, bodies } from "./helpers.mjs";

test.use({ viewport: { width: 1400, height: 900 } });
// closed squares on the plate (z = 0), each [centre x, centre y, side]
const squares = (...list) => {
  const pts = [], ents = [];
  list.forEach(([cx, cy, s], k) => {
    const h = s / 2, ids = [0, 1, 2, 3].map((i) => `p${k}_${i}`);
    pts.push(...[[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]].map(([x, y], i) => ({ id: ids[i], x, y })));
    ents.push(...[0, 1, 2, 3].map((i) => ({ id: `e${k}_${i}`, t: "line", a: ids[i], b: ids[(i + 1) % 4] })));
  });
  return { id: "s1", name: "Sketch 1", seq: 1, hidden: false, cons: [], plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts, ents };
};

let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); });
test.afterEach(() => { expect(errors).toEqual([]); });

// the camera has stopped: no movement over two animation frames in a row
async function settle(page) { await expect.poll(() => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => { const still = !window.__app.vp.isMoving(); requestAnimationFrame(() => r(still && !window.__app.vp.isMoving())); })))).toBe(true); }
const clientOf = (page, pt) => page.evaluate(([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);
const panel = (page) => page.evaluate(() => ({
  command: window.__app.command ? window.__app.command.title : null, sketch: window.__app.sketcher.active || null,
  okOff: document.getElementById("cmd-ok") ? document.getElementById("cmd-ok").disabled : null,
  why: (() => { const w = document.getElementById("cmd-why"); return w && !w.hidden ? w.textContent : ""; })(),
  hint: document.getElementById("hint").textContent,
  dist: document.getElementById("ex-dist") ? +document.getElementById("ex-dist").value : null,
  picked: (document.getElementById("cmd")?.innerText.match(/(\d+)\s*profiles? selected/) || [])[1] || "0",
}));
async function openDoc(page, doc) {
  await loadDoc(page, doc);
  await page.evaluate(() => { const { vp, scene } = window.__app, box = scene.allBox().clone(); for (const sk of window.__store.doc.sketches) for (const q of sk.pts) box.expandByPoint(vp.view.target.clone().set(q.x, q.y, 0)); vp.fit(box); });
  await settle(page);
}
async function okAndBuild(page) {
  await page.click("#cmd-ok");
  await expect.poll(() => page.evaluate(() => window.__app.command)).toBeNull();
  await waitIdle(page);
  const list = await bodies(page);
  expect(list.filter((b) => b.error)).toEqual([]);
  return list;
}

test("the report's steps: rectangle by mouse, the check mark, Extrude: the shape is picked, 10 mm, OK works and makes the box", async ({ page }) => {
  await loadDoc(page, newDoc("Grok extrude", "advanced"));
  await page.click("#ad-sketch");
  await page.locator("#plane-seg button").first().click(); // XY · Top
  await page.waitForFunction(() => !!window.__app.sketcher.active);
  await settle(page);
  await page.click("#sk-rect");
  await expect(page.locator("#hint")).toHaveText("Click the first corner.");
  const c = await page.evaluate(() => { const r = window.__app.vp.canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(c.x - 80, c.y - 50);
  await page.mouse.down();
  // the first corner is down: the status line asks for the next one
  await expect(page.locator("#hint")).toContainText("Click the opposite corner.");
  await page.mouse.move(c.x + 80, c.y + 50, { steps: 10 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Use these values" }).click();
  const sk = await page.evaluate(() => { const s = window.__store.doc.sketches[0], xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y); return { ents: s.ents.length, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; });
  expect(sk.ents).toBe(4);
  expect(sk.w * sk.h).toBeGreaterThan(0);
  await expect(page.locator("#palette")).toContainText("1 closed profile");
  await page.click("#sk-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", sketch: null, picked: "1", okOff: false, why: "", dist: 10 });
  expect((await panel(page)).hint).not.toContain("Click the first corner");
  const list = await okAndBuild(page);
  expect(list).toHaveLength(1);
  expect(list[0].volume).toBeCloseTo(sk.w * sk.h * 10, 0);
});

test("Finish sketch, then Extrude on the ribbon: the only shape is picked, a click on it keeps it, and OK makes 20 x 20 x 5", async ({ page }) => {
  await openDoc(page, newDoc("Grok extrude ribbon", "advanced", { sketches: [squares([0, 0, 20])] }));
  await page.click("#ad-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", picked: "1", okOff: false, why: "", dist: 10 });
  const inside = await clientOf(page, [0, 0, 0]);
  await page.mouse.click(inside.x, inside.y); // the lessons say "click the shape": it stays picked
  await expect.poll(() => panel(page)).toMatchObject({ picked: "1", okOff: false });
  await page.locator("#ex-dist").fill("5");
  await page.locator("#ex-dist").press("Tab");
  await expect.poll(() => panel(page)).toMatchObject({ okOff: false, dist: 5 });
  const list = await okAndBuild(page);
  expect(list.map((b) => b.volume)).toEqual([2000]);
});

test("OK greyed out: the panel says why in one line (no shape picked, distance 0, no shape at all), and the line goes once OK works", async ({ page }) => {
  await openDoc(page, newDoc("Grok extrude why", "advanced", { sketches: [squares([-20, 0, 20], [20, 0, 20])] }));
  await page.click("#ad-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", picked: "0", okOff: true, why: "Click inside a closed shape to choose what to extrude." });
  const right = await clientOf(page, [20, 0, 0]);
  await page.mouse.click(right.x, right.y);
  await expect.poll(() => panel(page)).toMatchObject({ picked: "1", okOff: true, why: "Drag the arrow or type a distance: it is 0 now." });
  await page.locator("#ex-dist").fill("5");
  await page.locator("#ex-dist").press("Tab");
  await expect.poll(() => panel(page)).toMatchObject({ picked: "1", okOff: false, why: "" });
  const list = await okAndBuild(page);
  expect(list.map((b) => b.volume)).toEqual([2000]);
  // nothing to extrude at all
  await loadDoc(page, newDoc("Grok extrude empty", "advanced"));
  await page.click("#ad-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", okOff: true, why: "No closed shape to extrude yet: draw one in a sketch, or click a flat face of a body." });
});

test("Show sketches off: Extrude picks nothing by itself and says the sketches are hidden; turned on, the line follows", async ({ page }) => {
  await openDoc(page, newDoc("Grok extrude hidden", "advanced", { sketches: [squares([0, 0, 20])] }));
  await page.click("#nav-sketches");
  expect(await page.evaluate(() => window.__app.scene.showSketches)).toBe(false);
  await page.click("#ad-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", picked: "0", okOff: true, dist: 0, why: "Sketches are hidden: turn on Show sketches to pick a shape, or click a flat face of a body." });
  // turned back on with Extrude open: the line follows
  await page.click("#nav-sketches");
  await expect.poll(() => panel(page)).toMatchObject({ picked: "0", okOff: true, why: "Click inside a closed shape to choose what to extrude." });
});

test("a sketch on a box's top with only an open line: the face's own outline is not picked for you", async ({ page }) => {
  const face = squares([0, 0, 20]);
  face.ents.forEach((e) => { e.proj = true; });
  face.plane.o = [0, 0, 10];
  face.onBody = "b1";
  face.pts.push({ id: "q0", x: -5, y: 0 }, { id: "q1", x: 5, y: 0 });
  face.ents.push({ id: "open", t: "line", a: "q0", b: "q1" });
  await openDoc(page, newDoc("Grok extrude face", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 10, r: 0, c: 0 }))], sketches: [face] }));
  await page.click("#ad-extrude");
  await expect.poll(() => panel(page)).toMatchObject({ command: "Extrude", picked: "0", okOff: true, why: "Click inside a closed shape to choose what to extrude." });
});
