// Move step: how far a drag or an arrow key moves a shape (Max, like Tinkercad's "Snap grid").
// One list in the status bar, #snap: "Off · free" (to 0.01 mm) or a step size. Proof from the user's side, with real mouse and keyboard
// events and positions read from the document (the box's matrix):
//  - Off · free: a drag lands on any 0.01 mm position, a 3-pixel nudge is far less than 1 mm, and a reload keeps Off · free;
//  - 0.1 mm and 5 mm: the drag delta is a multiple of the step; Alt held mid-drag at 5 mm is free for that move;
//  - arrow keys: the step, Shift x10, Alt /10, Off = 0.1 mm, Ctrl/Cmd + Up lifts by the step;
//  - Shift+S turns snapping off (the list shows Off · free) and back on (the last size);
//  - the status line says "Snap 1 mm" (or "Snap off") while a drag moves, and goes back to normal afterwards.
import { test, expect } from "@playwright/test";
import { boot, reload, watchErrors, loadDoc, waitIdle, newDoc, body, prim } from "./helpers.mjs";

const design = () => newDoc("move step", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
const MOD = process.platform === "darwin" ? "Meta" : "Control";

let errors;
test.beforeEach(async ({ page }) => { errors = watchErrors(page); });
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); });

const run = (page, fn, arg) => page.evaluate(fn, arg);
const pos = (page) => run(page, () => window.__store.doc.bodies.find((b) => b.id === "b1").m.slice(12, 15));
const hint = (page) => run(page, () => document.getElementById("hint").textContent);
const snapShows = (page) => run(page, () => { const s = document.getElementById("snap"); return { value: s.value, text: s.selectedOptions[0].textContent, disabled: s.disabled }; });
const frames = (page) => run(page, () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = async (page) => { for (let ok = 0; ok < 2;) { await page.waitForTimeout(200); ok = (await run(page, () => !window.__app.vp.isMoving())) ? ok + 1 : 0; } };
const clientOf = (page, pt) => run(page, ([x, y, z]) => { const { vp } = window.__app, r = vp.canvas.getBoundingClientRect(); vp.updateCamera(); const s = vp.project(vp.view.target.clone().set(x, y, z)); return { x: r.left + s[0], y: r.top + s[1] }; }, pt);
const dotClient = async (page) => { await frames(page); return clientOf(page, await run(page, () => window.__app.pivot.dot.position.toArray())); };
const twoDecimals = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

async function open(page, info, size) {
  await boot(page, info);
  await run(page, () => window.__app.setFace("original", true));
  await loadDoc(page, design());
  await run(page, () => window.__app.vp.fit(window.__app.scene.allBox()));
  await settle(page);
  await run(page, () => window.__app.select(["b1"]));
  await page.selectOption("#snap", size);
}
// press on the pivot dot (a plain drag there moves the box), move in small steps, and stay down
async function dragStart(page, dx = 41, dy = 23) {
  const from = await dotClient(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  return { x: from.x + dx, y: from.y + dy };
}
async function dragBy(page, dx, dy) { const at = await dragStart(page, dx, dy); await page.mouse.up(); await waitIdle(page); return at; }

test.describe("Off · free", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name === "mobile", "mouse drags: computer layout"); });

  test("a drag lands on 0.01 mm numbers, a 3 px nudge is under 1 mm, and a reload keeps Off · free", async ({ page }, info) => {
    test.setTimeout(240_000);
    await open(page, info, "0");
    expect(await snapShows(page)).toEqual({ value: "0", text: "Off · free", disabled: false });
    expect(await run(page, () => window.__app.snapOn)).toBe(false);
    expect(await run(page, () => window.__app.gridStep())).toBe(0);
    await dragBy(page, 41, 23);
    const p = await pos(page);
    expect(Math.hypot(p[0], p[1]), "it moved").toBeGreaterThan(3);
    expect(p.every(twoDecimals), "at most two decimals: " + p).toBe(true);
    expect(p.slice(0, 2).some((v) => Math.abs(v - Math.round(v)) > 0.005), "not a whole number of mm: " + p).toBe(true);
    // a 3 px move while the button is down changes the position by less than 1 mm
    const at = await dragStart(page, 30, 10);
    await expect.poll(() => run(page, () => !!window.__store.preview)).toBe(true);
    const pv = () => run(page, () => { const m = window.__store.preview.bodies.find((b) => b.id === "b1").m; return [m[12], m[13]]; });
    const a = await pv();
    await page.mouse.move(at.x + 3, at.y);
    await expect.poll(async () => (await pv())[0] !== a[0] || (await pv())[1] !== a[1]).toBe(true);
    const b = await pv();
    expect(Math.hypot(b[0] - a[0], b[1] - a[1]), "3 px is a tiny move").toBeLessThan(1);
    expect(b.every(twoDecimals)).toBe(true);
    await page.mouse.up();
    await waitIdle(page);
    // saved per browser
    await reload(page);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready);
    expect((await snapShows(page)).text).toBe("Off · free");
    expect(await run(page, () => window.__app.snapOn)).toBe(false);
  });

  test("Alt held mid-drag at 5 mm moves freely for that move (0.01 mm, not a multiple of 5)", async ({ page }, info) => {
    await open(page, info, "5");
    const at = await dragStart(page, 41, 23);
    await expect.poll(() => run(page, () => !!window.__store.preview)).toBe(true);
    await page.keyboard.down("Alt");
    await page.mouse.move(at.x + 13, at.y + 7, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await waitIdle(page);
    const p = await pos(page);
    expect(p.every(twoDecimals), "at most two decimals: " + p).toBe(true);
    expect(p.slice(0, 2).some((v) => Math.abs(v / 5 - Math.round(v / 5)) > 0.01), "not a multiple of 5: " + p).toBe(true);
  });
});

for (const step of [0.1, 5]) {
  test(`${step} mm: a drag moves by a multiple of the step`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "mouse drags: computer layout");
    await open(page, info, String(step));
    expect(await snapShows(page)).toEqual({ value: String(step), text: step + " mm", disabled: false });
    await dragBy(page, 130, 70);
    const p = await pos(page);
    expect(Math.hypot(p[0], p[1]), "it moved").toBeGreaterThanOrEqual(step);
    for (const v of p.slice(0, 2)) expect(Math.abs(v / step - Math.round(v / step)), `${v} is a multiple of ${step}`).toBeLessThan(1e-6);
  });
}

test.describe("arrow keys", () => {
  const press = async (page, key) => { await page.keyboard.press(key); await waitIdle(page); };
  const fresh = async (page, info, size) => { await open(page, info, size); await run(page, () => { document.activeElement && document.activeElement.blur(); window.__app.select(["b1"]); }); };
  const moved = async (page) => { const p = await pos(page); const n = p.filter((v) => Math.abs(v) > 1e-9); expect(n.length, "one axis moves: " + p).toBe(1); return n[0]; };

  test("1 mm: an arrow moves 1, Shift 10, Alt 0.1, Alt+Shift 1; Ctrl/Cmd+Up lifts Z by 1", async ({ page }, info) => {
    await fresh(page, info, "1");
    await press(page, "ArrowRight");
    expect(Math.abs(await moved(page))).toBe(1);
    await press(page, "ArrowLeft");
    expect(await pos(page)).toEqual([0, 0, 0]);
    await press(page, "Shift+ArrowRight");
    expect(Math.abs(await moved(page))).toBe(10);
    await press(page, "Shift+ArrowLeft");
    await press(page, "Alt+ArrowRight");
    expect(Math.abs(await moved(page))).toBe(0.1);
    await press(page, "Alt+ArrowLeft");
    await press(page, "Alt+Shift+ArrowRight");
    expect(Math.abs(await moved(page))).toBe(1);
    await press(page, "Alt+Shift+ArrowLeft");
    expect(await pos(page)).toEqual([0, 0, 0]);
    await press(page, `${MOD}+ArrowUp`);
    expect(await pos(page)).toEqual([0, 0, 1]);
    await press(page, `${MOD}+Shift+ArrowUp`);
    expect(await pos(page)).toEqual([0, 0, 11]);
  });

  test("Off · free: an arrow moves 0.1 mm and ten presses stay clean (no 0.30000000000000004)", async ({ page }, info) => {
    await fresh(page, info, "0");
    await press(page, "ArrowRight");
    expect(Math.abs(await moved(page))).toBe(0.1);
    for (let i = 0; i < 2; i++) await press(page, "ArrowRight");
    expect(Math.abs(await moved(page))).toBe(0.3);
    await press(page, "Alt+ArrowRight");
    expect(Math.abs(await moved(page))).toBe(0.31);
    await press(page, `${MOD}+ArrowUp`);
    expect((await pos(page))[2]).toBe(0.1);
  });

  test("5 mm: an arrow moves 5, Alt moves 0.5", async ({ page }, info) => {
    await fresh(page, info, "5");
    await press(page, "ArrowRight");
    expect(Math.abs(await moved(page))).toBe(5);
    await press(page, "Alt+ArrowRight");
    expect(Math.abs(await moved(page))).toBe(5.5);
  });
});

test("Shift+S turns snapping off (the list shows Off · free) and back on (the last size)", async ({ page }, info) => {
  await open(page, info, "2");
  await run(page, () => { document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press("Shift+S");
  expect(await run(page, () => window.__app.snapOn)).toBe(false);
  expect(await snapShows(page)).toEqual({ value: "0", text: "Off · free", disabled: false });
  await expect(page.locator("#snap-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+S");
  expect(await run(page, () => window.__app.snapOn)).toBe(true);
  expect(await snapShows(page)).toEqual({ value: "2", text: "2 mm", disabled: false });
  // the Snap button and a size pick stay in step with the list
  await page.click("#snap-toggle");
  expect((await snapShows(page)).text).toBe("Off · free");
  await page.selectOption("#snap", "0.5");
  expect(await run(page, () => window.__app.snapOn)).toBe(true);
  await expect(page.locator("#snap-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.selectOption("#snap", "0");
  expect(await run(page, () => window.__app.snapOn)).toBe(false);
  await page.click("#snap-toggle");
  expect(await snapShows(page)).toEqual({ value: "0.5", text: "0.5 mm", disabled: false });
  expect(await page.getAttribute("#snap", "aria-label")).toBe("Snap step");
});

test("the status line names the snap step while a shape moves, and goes back to normal after", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "mouse drags: computer layout");
  await open(page, info, "1");
  const normal = await hint(page);
  expect(normal).not.toContain("Moving");
  const at = await dragStart(page, 41, 23);
  await expect.poll(() => hint(page)).toMatch(/^Moving X [+-]?[\d.]+ mm, Y [+-]?[\d.]+ mm · Snap 1 mm · hold (Alt|⌥) for free movement$/);
  await page.keyboard.down("Alt");
  await page.mouse.move(at.x + 5, at.y + 2);
  await expect.poll(() => hint(page)).toMatch(/Snap off \((Alt|⌥) held\)/);
  await page.keyboard.up("Alt");
  await page.mouse.up();
  await waitIdle(page);
  expect(await hint(page)).not.toContain("Moving");
  // Off · free, and Escape puts the hint back too
  await page.selectOption("#snap", "0");
  await dragStart(page, 41, 23);
  await expect.poll(() => hint(page)).toContain("Snap off (free)");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await hint(page)).not.toContain("Moving");
});
