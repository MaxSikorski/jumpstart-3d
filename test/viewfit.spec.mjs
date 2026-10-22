// The camera framing after a design is opened. Users see it as: a design you have opened before is framed at once
// (from Your designs, Duplicate or a script/chat load), an edit made later does not throw the camera back, and a
// design is not re-framed for one you have since left.
import { test, expect } from "@playwright/test";
import { boot, newDoc, body, prim, waitIdle, watchErrors } from "./helpers.mjs";

const box = (w) => prim("box", { w, d: 20, h: 5, r: 0, c: 0 });
const A = newDoc("A", "beginner", { id: "dA", bodies: [body("b1", "Slab", box(30))] });
const B = newDoc("B", "beginner", { id: "dB", bodies: [body("b1", "Slab", box(99))] });
const D = newDoc("D", "beginner", { id: "dD", bodies: [body("b1", "Slab", box(55))] }); // only the script test uses it, so no other test's edit changes it
const C = newDoc("C", "beginner", { id: "dC", bodies: [body("b1", "Slab", box(40), undefined, { hidden: true })] });

let page, errors;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage(); errors = watchErrors(page); await boot(page, info);
  for (const d of [A, B, C]) {
    await page.evaluate(async (d) => { await window.__app.projects._store.put(d.id, JSON.stringify(d), { id: d.id, name: d.name, ver: 0, mode: d.mode, updated: 1, thumb: null }); }, d);
  }
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });

const openDesign = async (name) => { await page.click("#btn-projects"); await page.getByRole("button", { name: `Open ${name}`, exact: true }).click(); await page.waitForFunction((id) => window.__store.doc.id === id, "d" + name); await waitIdle(page); };
const still = () => page.waitForFunction(() => !window.__app.vp.isMoving());
const built = async () => { await page.waitForFunction(() => window.__app.needFit === false); await still(); }; // the first build of new shapes frames the view when it arrives
const dist = () => page.evaluate(() => window.__app.vp.view.dist);
// Hold back the 900 ms framing timers every open schedules, so a test runs them on its own cue instead of racing the clock.
const holdTimers = () => page.evaluate(() => {
  const real = window.setTimeout; window.__held = [];
  window.setTimeout = (fn, ms, ...a) => (ms === 900 ? (window.__held.push(fn), 0) : real(fn, ms, ...a));
  window.__real = real;
});
const releaseTimers = () => page.evaluate(() => {
  window.setTimeout = window.__real;
  const vp = window.__app.vp, fit = vp.fit.bind(vp); let n = 0;
  vp.fit = (b) => { n++; return fit(b); };
  for (const f of window.__held) f();
  vp.fit = fit;
  return n;
});

test("a design opened again is framed at once and a later edit leaves the camera alone", async () => {
  await openDesign("A"); await built();
  const small = await dist();
  await openDesign("B"); await built();
  expect(await dist()).toBeGreaterThan(small * 1.5); // each design is framed on its own size
  await openDesign("A"); await still(); // every shape of A was built earlier in this page
  expect(await dist()).toBeCloseTo(small, 0);
  await page.waitForTimeout(1200); // past the delayed framing every open schedules
  // the user zooms out to look around, then changes the width
  await page.evaluate(() => { window.__app.vp.view.dist = 400; window.__app.vp.request(); });
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node.p.w = 31; }));
  await waitIdle(page);
  await page.waitForTimeout(700); // longer than a framing move (380 ms)
  expect(await dist()).toBe(400); // an edit made later does not throw the camera back
});

test("a script or chat load of a design built earlier is framed at once", async () => {
  const load = (d) => page.evaluate(async (d) => { await window.JS3D.load(d, { keepId: true }); }, d);
  await load(D); await built(); const small = await dist(); // its first build frames it
  await load(B); await still(); expect(await dist()).toBeGreaterThan(small * 1.4);
  await load(D); await still();
  expect(await dist()).toBeCloseTo(small, 0); // not left at B's framing
});

test("Duplicate of a design built earlier is framed at once", async () => {
  await openDesign("A"); await built(); const small = await dist();
  await openDesign("B"); await built();
  await page.click("#btn-projects");
  await page.locator(".pcard", { has: page.locator('button[aria-label="Open A"]') }).getByRole("button", { name: "Duplicate" }).click();
  await page.waitForFunction(() => window.__store.doc.name === "A copy");
  await waitIdle(page); await still();
  expect(await dist()).toBeCloseTo(small, 0);
});

test("opening another design cancels the delayed framing of the one left behind", async () => {
  await page.waitForTimeout(1200); // earlier delayed framings are over
  await holdTimers();
  await openDesign("A"); await openDesign("B");
  expect(await releaseTimers()).toBe(1); // only B's own
});

test("A then B then A leaves one delayed framing, the last open's", async () => {
  await holdTimers();
  await openDesign("A"); await openDesign("B"); await openDesign("A");
  expect(await releaseTimers()).toBe(1); // not A's first one as well
});

test("a cached design with every body hidden does not leave the camera armed to jump", async () => {
  await openDesign("C"); await built(); // built once
  await openDesign("A"); await built();
  await openDesign("C"); await waitIdle(page); // now from the cache, with nothing visible to frame
  expect(await page.evaluate(() => window.__app.needFit)).toBe(false);
});
