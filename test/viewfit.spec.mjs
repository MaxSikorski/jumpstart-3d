// The camera framing after a design is opened. Users see it as: a design you have opened before is framed at once,
// an edit made later does not throw the camera back, and a design is not re-framed for one you have since left.
import { test, expect } from "@playwright/test";
import { boot, newDoc, body, prim, waitIdle, watchErrors } from "./helpers.mjs";

const box = (w) => prim("box", { w, d: 20, h: 5, r: 0, c: 0 });
const A = newDoc("A", "beginner", { id: "dA", bodies: [body("b1", "Slab", box(30))] });
const B = newDoc("B", "beginner", { id: "dB", bodies: [body("b1", "Slab", box(99))] });

let page, errors;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage(); errors = watchErrors(page); await boot(page, info);
  for (const d of [A, B]) {
    await page.evaluate(async (d) => { await window.__app.projects._store.put(d.id, JSON.stringify(d), { id: d.id, name: d.name, ver: 0, mode: d.mode, updated: 1, thumb: null }); }, d);
  }
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });

const openDesign = async (name) => { await page.click("#btn-projects"); await page.getByRole("button", { name: `Open ${name}`, exact: true }).click(); await page.waitForFunction((id) => window.__store.doc.id === id, "d" + name); await waitIdle(page); };
const still = () => page.waitForFunction(() => !window.__app.vp.isMoving());
const built = async () => { await page.waitForFunction(() => window.__app.needFit === false); await still(); }; // the first build of new shapes frames the view when it arrives
const dist = () => page.evaluate(() => window.__app.vp.view.dist);

test("a design opened again is framed at once and a later edit leaves the camera alone", async () => {
  await openDesign("A"); await built();
  const small = await dist();
  await openDesign("B"); await built();
  const big = await dist();
  expect(big).toBeGreaterThan(small * 1.5); // each design is framed on its own size
  await openDesign("A"); await still(); // every shape of A was built earlier in this page
  expect(await dist()).toBeCloseTo(small, 0);
  await page.waitForTimeout(1200); // past the delayed framing every open schedules
  // the user zooms out to look around, then changes the width
  await page.evaluate(() => { window.__app.vp.view.dist = 400; window.__app.vp.request(); });
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node.p.w = 31; }));
  await waitIdle(page);
  await page.waitForTimeout(700); // longer than a framing move (380 ms)
  expect(await dist()).toBe(400);
});

test("opening another design cancels the delayed framing of the one left behind", async () => {
  await page.waitForTimeout(1200); // the previous test's delayed framing is over
  // open A and then B at once, as a quick user would; count the framings that follow
  await page.evaluate(async () => {
    const vp = window.__app.vp, fit = vp.fit.bind(vp);
    window.__fits = 0; window.__counting = false;
    vp.fit = (b) => { if (window.__counting) window.__fits++; return fit(b); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const [name, id] of [["A", "dA"], ["B", "dB"]]) {
      document.getElementById("btn-projects").click();
      await sleep(50);
      document.querySelector(`button[aria-label="Open ${name}"]`).click();
      while (window.__store.doc.id !== id) await sleep(10);
    }
    window.__counting = true;
  });
  await waitIdle(page);
  await page.waitForTimeout(1500); // both 900 ms timers have had their time
  expect(await page.evaluate(() => window.__fits)).toBe(1); // only B's own
});
