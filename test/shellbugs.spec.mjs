// Both builds: Auto hollow finishes with a status note, the torus field exports closed, and slice shells report their real volume.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });
const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const vol = async (id) => (await bodies(page)).find((b) => b.id === id).volume;
const okAll = async () => { for (const b of await bodies(page)) expect(b.error, b.name).toBeNull(); };
const near = (got, want, tol) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol);
// the 12 edges of the box, as the Beginner "Round all edges" button stores them
const E = (a, b) => ({ a, b, m: a.map((v, i) => (v + b[i]) / 2), t: "LINE" });
const P = [[-20, -15], [20, -15], [20, 15], [-20, 15]], edges = [];
for (let i = 0; i < 4; i++) { const [x, y] = P[i], [x2, y2] = P[(i + 1) % 4]; edges.push(E([x, y, 0], [x2, y2, 0]), E([x, y, 20], [x2, y2, 20]), E([x, y, 0], [x, y, 20])); }
const fillet = { id: "f1", seq: 1, t: "fillet", edges, r: 2 };
const OUTER = 36 * 26 * 16 + 4 * (36 * 26 + 26 * 16 + 36 * 16) + Math.PI * 4 * (36 + 26 + 16) + (4 / 3) * Math.PI * 8;
const wall = (t) => OUTER - (40 - 2 * t) * (30 - 2 * t) * (20 - 2 * t);

test("an oval capsule's Auto hollow builds (no stall) and the status bar says it is hollowing", async () => {
  test.setTimeout(180_000);
  const doc = newDoc("Capsule", "advanced", { bodies: [body("b1", "Capsule", prim("capsule", { w: 40, d: 20, h: 12 },
    [{ id: "s", seq: 2, t: "shell", th: 2, faces: [] }]))] });
  await run((doc) => { window.__store.load(doc); window.__app.setMode(doc.mode || "beginner", true); window.__app.select([]); }, doc);
  await expect(page.locator("#busy")).toHaveText(/Hollowing/, { timeout: 15_000 });
  await waitIdle(page, 170_000);
  await okAll();
  const volume = await vol("b1");
  // Auto takes the slice method here (the ends are free-form), and its walls are only as thick as asked across each slice:
  // about 2918 mm3 against 3490 for a true 2 mm wall (the offset and field methods); a wall, not nothing or the whole capsule
  expect(volume).toBeGreaterThan(3490 * .8);
  expect(volume).toBeLessThan(3490 * 1.03);
  await expect(page.locator("#busy")).toBeHidden();
  const report = meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
  expect(report.open).toBe(0);
  near(report.volume, volume, .01);
});

test("a field-method torus shell exports a closed STL", async () => {
  await loadDoc(page, newDoc("Torus", "advanced", { bodies: [body("b1", "Torus", prim("torus", { w: 40, d: 40, h: 10, tube: 10 },
    [{ id: "s", seq: 2, t: "shell", th: 2, faces: [], method: "field" }]))] }));
  await okAll();
  const report = meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
  expect(report.open).toBe(0);
  near(report.volume, 4737.4, .01);
});

test("a slice-method shell of the rounded Beginner box shows its real volume", async () => {
  await loadDoc(page, newDoc("Rounded box", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 },
    [fillet, { id: "s", seq: 2, t: "shell", th: 2, faces: [], method: "slices" }]))] }));
  await okAll();
  near(await vol("b1"), wall(2), .005);
});
