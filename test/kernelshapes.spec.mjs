// Kernel fixes found by the random-edit fuzzer, checked from the user's side (list(), the STL file, the error text):
//  - oval spheres corrupted the engine after about eight of them (the point projection onto an ellipsoid face)
//  - stretching text or a torus unevenly gave a raw engine error or a refusal
//  - a capsule that is not round in section took 10 to 25 s and a flat one came out wrong
import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = () => run(() => JS3D.newDesign("beginner"));
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);
const entries = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const stl = async () => meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
const solids = async () => (bytes(await run(() => JS3D.export("step"))).toString("latin1").match(/MANIFOLD_SOLID_BREP/g) || []).length;

test("default text stretched sideways: no engine error, exactly twice the volume, still four letters", async () => {
  await fresh();
  const id = await run(() => JS3D.add("text"));
  const [before] = await entries();
  expect(before.error).toBeNull();
  await run((id) => JS3D.scale([id], [2, 1, 1]), id);
  const [after] = await entries();
  expect(after.error).toBeNull();
  near(after.volume, 2 * before.volume, 0.005);
  expect(await solids()).toBe(4);
  const s = await stl();
  expect(s.open).toBe(0);
  near(s.volume, after.volume, 0.02);
});

test("default torus stretched sideways: no refusal, about twice the volume, closed STL", async () => {
  await fresh();
  const id = await run(() => JS3D.add("torus"));
  const [before] = await entries();
  await run((id) => JS3D.scale([id], [2, 1, 1]), id);
  const [after] = await entries();
  expect(after.error).toBeNull();
  near(after.volume, 2 * before.volume, 0.02);
  const s = await stl();
  expect(s.open).toBe(0);
  near(s.volume, after.volume, 0.03);
});

test("a torus and a box apart, stretched sideways together, stay two solids", async () => {
  await fresh();
  const ids = await run(() => [JS3D.add("torus", { at: [-30, 0, 0] }), JS3D.add("box", { at: [30, 0, 0] })]);
  const parts = await entries();
  const g = await run((ids) => JS3D.group(ids), ids);
  await entries();
  await run((g) => JS3D.scale([g], [1, 1.5, 1]), g);
  const [e] = await entries();
  expect(e.error).toBeNull();
  near(e.volume, 1.5 * (parts[0].volume + parts[1].volume), 0.02);
  expect(await solids()).toBe(2);
});

test("a 20 mm cone's STL is closed at the tip wherever it stands", async () => {
  const volume = Math.PI * 100 * 20 / 3;
  for (const at of [[0, 0, 0], [4, 8, 0]]) {
    await fresh();
    await run((at) => JS3D.add("cone", { size: { w: 20, d: 20, h: 20 }, at }), at);
    const [e] = await entries();
    expect(e.error).toBeNull();
    const s = await stl();
    expect(s.open, "open edges at " + at).toBe(0);
    near(s.volume, volume, 0.01);
  }
});

test("a binding error never reaches the user as raw engine text", async () => {
  // the same stretch that used to say: Function 'ShapeFix_Solid.SolidFromShell' called with an invalid signature
  await fresh();
  const id = await run(() => JS3D.add("text"));
  await entries();
  await run((id) => JS3D.scale([id], [3, 1, 1]), id);
  const all = await run(async () => { await JS3D.ready(); return [...JS3D.list().map((e) => e.error), ...[...__app.scene.errors.values()]]; });
  for (const t of all) expect(String(t || "")).not.toMatch(/invalid signature|Expected null or instance|table index|out of bounds/);
});

test("a capsule 36 x 12 x 6 is one solid with its exact volume and a closed STL", async () => {
  await fresh();
  await run(() => JS3D.add("capsule", { size: { w: 36, d: 12, h: 6 } }));
  const [e] = await entries();
  expect(e.error).toBeNull();
  // pi ry rz L + 4/3 pi cx ry rz, with ry 6, rz 3, L = 36 - 2 cx, cx 6
  near(e.volume, 1922.65, 0.002);
  expect(await solids()).toBe(1);
  const s = await stl();
  expect(s.open).toBe(0);
  near(s.volume, 1922.65, 0.01);
});

test("a capsule 27 x 24 x 20 builds in seconds, not minutes", async () => {
  await fresh();
  const t = await run(async () => {
    const t0 = performance.now();
    JS3D.add("capsule", { size: { w: 27, d: 24, h: 20 } });
    await JS3D.ready();
    return performance.now() - t0;
  });
  const [e] = await entries();
  expect(e.error).toBeNull();
  near(e.volume, 7665.49, 0.002);
  expect(t, "ms to build").toBeLessThan(5000);
});

// last in the file: on a corrupted engine every later test would fail for this reason
test("twelve designs in a row with two oval spheres and their group build without an engine error", async () => {
  test.setTimeout(240_000);
  for (let i = 0; i < 12; i++) {
    await fresh();
    await run((i) => [
      JS3D.add("sphere", { size: { w: 20 + (i % 5), d: 12 + (i % 3), h: 8 + (i % 4) } }),
      JS3D.add("sphere", { size: { w: 18 + (i % 4), d: 14 + (i % 2), h: 9 + (i % 3) }, at: [6, 3, 0] }),
    ], i);
    const parts = await entries();
    for (const e of parts) expect(e.error, `design ${i + 1}: ${e.name}`).toBeNull();
    const vol = parts.map((e) => e.volume);
    const out = {};
    for (const op of ["join", "intersect"]) {
      await fresh();
      await run(([i, op]) => {
        const x = JS3D.add("sphere", { size: { w: 20 + (i % 5), d: 12 + (i % 3), h: 8 + (i % 4) } });
        const y = JS3D.add("sphere", { size: { w: 18 + (i % 4), d: 14 + (i % 2), h: 9 + (i % 3) }, at: [6, 3, 0] });
        JS3D.group([x, y], op === "join" ? {} : { op });
      }, [i, op]);
      const [g, ...rest] = await entries();
      expect(rest).toEqual([]);
      expect(g.error, `design ${i + 1}: ${op}`).toBeNull();
      out[op] = g.volume;
    }
    near(out.join + out.intersect, vol[0] + vol[1], 0.01);
  }
});
