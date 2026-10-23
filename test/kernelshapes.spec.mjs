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
  // pi ry rz L + 4/3 pi cx ry rz, with ry 6, rz 3, cx 3 (the smaller of ry, rz), L = 36 - 2 cx = 30
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

// capsule = two half-ellipsoids (cx by ry by rz) around a straight oval side of length L = w - 2 cx, cx = min(ry, rz, w / 2)
const capsuleVolume = (w, d, h) => {
  const ry = d / 2, rz = h / 2, cx = Math.min(ry, rz, w / 2);
  return Math.PI * ry * rz * (w - 2 * cx) + (4 / 3) * Math.PI * cx * ry * rz;
};
for (const [w, d, h, why] of [[6, 12, 6, "no side, flat"], [4, 12, 6, "no side, flat, shorter"], [10, 12, 12, "short and round in section"]]) {
  test(`a capsule ${w} x ${d} x ${h} (${why}) is one solid with its exact volume and a closed STL`, async () => {
    await fresh();
    await run(([w, d, h]) => JS3D.add("capsule", { size: { w, d, h } }), [w, d, h]);
    const [e] = await entries();
    expect(e.error).toBeNull();
    near(e.volume, capsuleVolume(w, d, h), 0.002);
    expect(await solids()).toBe(1);
    const s = await stl();
    expect(s.open).toBe(0);
    near(s.volume, capsuleVolume(w, d, h), 0.01);
  });
}

test("an oval hemisphere builds with half the sphere's volume and a closed STL", async () => {
  await fresh();
  await run(() => JS3D.add("hemisphere", { size: { w: 20, d: 12, h: 8 } }));
  const [e] = await entries();
  expect(e.error).toBeNull();
  near(e.volume, (2 / 3) * Math.PI * 10 * 6 * 8, 0.002);
  const s = await stl();
  expect(s.open).toBe(0);
  near(s.volume, e.volume, 0.01);
});

test("a body with a closed cavity, grouped with a torus and stretched, keeps its cavity", async () => {
  await fresh();
  const ids = await run(() => {
    const box = JS3D.add("box", { size: { w: 40, d: 40, h: 40 } });
    const hole = JS3D.add("sphere", { size: { w: 20, d: 20, h: 20 }, at: [0, 0, 10], hole: true });
    const ring = JS3D.add("torus", { at: [80, 0, 0] });
    return [box, hole, ring];
  });
  await run((ids) => JS3D.group(ids), ids);
  const [before] = await entries();
  expect(before.error).toBeNull();
  await run((id) => JS3D.scale([id], [1.5, 1, 1]), before.id);
  const [after] = await entries();
  expect(after.error).toBeNull();
  // the sphere's 4189 mm3 is still missing (scaled it is 6283): a filled cavity would add about 13 % to the whole
  near(after.volume, 1.5 * before.volume, 0.01);
  const s = await stl();
  expect(s.open).toBe(0);
  near(s.volume, after.volume, 0.02);
});

// an imported mesh with one face missing stays a surface; its signed volume depends on where the origin is (off the origin it can be negative)
test("an open surface mesh far from the origin, grouped with a torus and stretched, still stretches", async () => {
  const quads = [[0, 4, 6, 2], [4, 5, 7, 6], [2, 6, 7, 3], [0, 1, 5, 4], [0, 2, 3, 1]]; // the cube without its +x face [1, 3, 7, 5]
  const tris = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  const verts = [];
  for (let i = 0; i < 8; i++) verts.push(500 + 10 * (i & 1), 10 * ((i >> 1) & 1), 10 * ((i >> 2) & 1));
  const buf = Buffer.alloc(8 + verts.length * 4 + tris.length * 4);
  buf.writeUInt32LE(8, 0); buf.writeUInt32LE(tris.length / 3, 4);
  verts.forEach((v, i) => buf.writeFloatLE(v, 8 + 4 * i));
  tris.forEach((v, i) => buf.writeUInt32LE(v, 8 + verts.length * 4 + 4 * i));
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const doc = {
    v: 1, id: "g_open", name: "open", mode: "beginner", created: 1, seq: 2, grid: 1, sketches: [], planes: [], joints: [],
    assets: { aopen: { kind: "mesh", name: "open", data: buf.toString("base64") } },
    bodies: [
      { id: "b1", name: "open", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: I, node: { t: "mesh", asset: "aopen", k: 1, keepPos: true, mods: [] } },
      { id: "b2", name: "torus", seq: 2, color: "#d14d8b", hole: false, hidden: false, m: I.map((v, i) => (i === 12 ? 480 : v)), node: { t: "prim", kind: "torus", p: { w: 20, d: 20, h: 8 }, mods: [] } },
    ],
  };
  await fresh();
  await run((d) => JS3D.load(JSON.stringify(d)), doc);
  const parts = await entries();
  expect(parts.map((e) => e.error)).toEqual([null, null]);
  const g = await run((ids) => JS3D.group(ids), parts.map((e) => e.id));
  await entries();
  await run((g) => JS3D.scale([g], [1.5, 1, 1]), g);
  const [after] = await entries();
  expect(after.error).toBeNull();
  expect(after.bbox.max[0] - after.bbox.min[0]).toBeGreaterThan(40);
});

test("a ring round the end of a hollow bar does not take the bar's cavity", async () => {
  await fresh();
  // bar 20 wide, z 0 to 60, with a closed cavity z 18 to 42; the ring (inside 21, outside 23, z 0 to 44) has a smaller box than the bar
  // and that box still holds the cavity's box
  const bar = await run(() => {
    const body = JS3D.add("cylinder", { size: { w: 20, d: 20, h: 60 } });
    const cav = JS3D.add("cylinder", { size: { w: 8, d: 8, h: 24 }, at: [0, 0, 18], hole: true });
    return JS3D.group([body, cav]);
  });
  await entries();
  const ring = await run(() => {
    const body = JS3D.add("cylinder", { size: { w: 23, d: 23, h: 44 } });
    const inner = JS3D.add("cylinder", { size: { w: 21, d: 21, h: 50 }, at: [0, 0, -3], hole: true });
    return JS3D.group([body, inner]);
  });
  await entries();
  const ring2 = await run(() => JS3D.add("torus", { at: [80, 0, 0] }));
  const g = await run((ids) => JS3D.group(ids), [bar, ring, ring2]);
  const [before] = await entries();
  expect(before.error).toBeNull();
  await run((g) => JS3D.scale([g], [1.5, 1, 1]), g);
  const [after] = await entries();
  expect(after.error).toBeNull();
  // the cavity is 1206 mm3, 4 to 5 % of the whole
  near(after.volume, 1.5 * before.volume, 0.01);
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
