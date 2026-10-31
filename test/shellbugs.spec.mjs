// Both builds: Auto hollow of an oval capsule gets true walls quickly, a flat capsule (offset folds) falls back to slices with a status note, the torus field exports closed, and slice shells report their real volume.
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

const capsuleDoc = (w, d, h) => newDoc("Capsule", "advanced", { bodies: [body("b1", "Capsule", prim("capsule", { w, d, h },
  [{ id: "s", seq: 2, t: "shell", th: 2, faces: [] }]))] });
const load = (doc) => run((doc) => { window.__store.load(doc); window.__app.setMode(doc.mode || "beginner", true); window.__app.select([]); }, doc);

test("an oval capsule's Auto hollow has true 2 mm walls and builds quickly", async () => {
  test.setTimeout(180_000);
  const start = Date.now();
  await load(capsuleDoc(40, 20, 12));
  await waitIdle(page, 170_000);
  const ms = Date.now() - start;
  test.info().annotations.push({ type: "build ms", description: String(ms) });
  expect(ms, "well under the 20-30 s the slice method took").toBeLessThan(30_000);
  await okAll();
  // the offset wall (about 1 s in node): a true 2 mm wall is 3491.4 mm3, the slice wall was only 2918
  const volume = await vol("b1");
  near(volume, 3491.4, .01);
  const report = meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
  expect(report.open).toBe(0);
  near(report.volume, volume, .01);
});

test("a flat capsule's Auto hollow (offset folds, slices used) shows the hollowing note", async () => {
  test.setTimeout(180_000);
  const start = Date.now();
  await load(capsuleDoc(20, 20, 8));
  await expect(page.locator("#busy")).toHaveText(/Hollowing/, { timeout: 15_000 });
  await waitIdle(page, 170_000);
  test.info().annotations.push({ type: "build ms", description: String(Date.now() - start) });
  await okAll();
  // the offset of this tight curve folds (1504 mm3, walls under 2 mm); Auto keeps the slice wall, 1294.5 mm3
  const volume = await vol("b1");
  near(volume, 1294.5, .02);
  expect(volume).toBeLessThan(1450);
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
