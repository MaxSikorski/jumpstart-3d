// Boolean results: what a user sees after Group, Join, Cut and Intersect, on both builds.
// Found by the random-edit fuzzer: a torus vanished from groups (no triangles, no bounding box, missing from STL),
// two spheres offset along x gave a wrong volume after Intersect or Cut, and an empty result showed
// "[object WebAssembly.Exception]". Every check here is made from the user's side: list(), the Group button, the STL file.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, waitIdle, quarantine } from "./helpers.mjs";
import { readStl as readStlTriangles, meshReport, readThreeMf } from "./fuzz-checks.mjs";

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
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a)));
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);

// Binary STL: triangle count, the volume the triangles enclose, whether every edge is shared by exactly two
// triangles (a closed surface), and the box round them.
function readStl(buf) {
  const n = buf.readUInt32LE(80);
  const ids = new Map(), edges = new Map();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  const vid = (p) => { const k = p.map((v) => Math.round(v * 1000)).join(","); let i = ids.get(k); if (i === undefined) { i = ids.size; ids.set(k, i); } return i; };
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12, p = [];
    for (let v = 0; v < 3; v++) {
      const q = [0, 1, 2].map((c) => buf.readFloatLE(o + v * 12 + c * 4));
      p.push(q);
      for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], q[c]); max[c] = Math.max(max[c], q[c]); }
    }
    volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    const v = p.map(vid);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (a === b) continue; // a sliver that collapsed to a point at 0.001 mm
      const k = a < b ? a + ":" + b : b + ":" + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  const open = [...edges.values()].filter((c) => c !== 2).length;
  return { triangles: n, volume, open, min, max };
}

const stl = async () => readStl(bytes(await run(() => JS3D.export("stl"))));
const entries = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
// no error text anywhere may show a raw engine object
const noObjectText = async () => {
  const all = await run(() => [...JS3D.list().map((e) => e.error), ...[...__app.scene.errors.values()]]);
  for (const t of all) if (t) expect(String(t)).not.toContain("[object");
};

// add the parts one by one and read each one's own box and volume once built
async function parts(specs) {
  await fresh();
  const ids = await run((specs) => specs.map(([kind, opts]) => JS3D.add(kind, opts)), specs);
  const list = await entries();
  return { ids, own: ids.map((id) => list.find((e) => e.id === id)) };
}
const union = (own) => ({
  min: [0, 1, 2].map((c) => Math.min(...own.map((e) => e.bbox.min[c]))),
  max: [0, 1, 2].map((c) => Math.max(...own.map((e) => e.bbox.max[c]))),
});

// the group of the given parts holds every part: its box covers all of them, its STL is closed and encloses their summed volume
async function expectGroupKeepsEveryPart(made, own, sumVolume) {
  const [g, ...rest] = await entries();
  expect(rest).toEqual([]);
  expect(g.error).toBeNull();
  const want = union(own);
  for (let c = 0; c < 3; c++) {
    expect(g.bbox.min[c]).toBeCloseTo(want.min[c], 1);
    expect(g.bbox.max[c]).toBeCloseTo(want.max[c], 1);
  }
  near(g.volume, sumVolume);
  const s = await stl();
  expect(s.triangles).toBeGreaterThan(100);
  expect(s.open, "STL edges not shared by exactly two triangles").toBe(0);
  near(s.volume, sumVolume);
  for (let c = 0; c < 3; c++) {
    expect(s.min[c]).toBeCloseTo(want.min[c], 1);
    expect(s.max[c]).toBeCloseTo(want.max[c], 1);
  }
}

test("a torus grouped with a box that does not touch it stays in the group (JS3D.group)", async () => {
  const { ids, own } = await parts([["torus", { at: [-30, 0, 0] }], ["box", { at: [30, 0, 0] }]]);
  expect(own.map((e) => e.error)).toEqual([null, null]);
  await run((ids) => JS3D.group(ids), ids);
  await expectGroupKeepsEveryPart(ids, own, own[0].volume + own[1].volume);
});

test("a torus grouped with a box through the Group button stays in the group", async () => {
  const { ids, own } = await parts([["torus", { at: [-30, 0, 0] }], ["box", { at: [30, 0, 0] }]]);
  await run((ids) => JS3D.select(ids), ids);
  await page.click("#bb-group");
  await waitIdle(page);
  await expectGroupKeepsEveryPart(ids, own, own[0].volume + own[1].volume);
});

test("two tori grouped keep both, and the group has a real bounding box", async () => {
  const { ids, own } = await parts([["torus", { at: [-30, 0, 0] }], ["torus", { at: [30, 0, 0] }]]);
  await run((ids) => JS3D.group(ids), ids);
  await expectGroupKeepsEveryPart(ids, own, own[0].volume + own[1].volume);
});

test("a hole that misses a torus leaves the torus whole", async () => {
  const { ids, own } = await parts([["torus", {}], ["box", { at: [60, 0, 0], hole: true }]]);
  await run((ids) => JS3D.group(ids), ids);
  await expectGroupKeepsEveryPart(ids, [own[0]], own[0].volume);
});

// the lens two equal spheres of radius r share when their centres are d apart
const lens = (r, d) => Math.PI * (4 * r + d) * (2 * r - d) ** 2 / 12;
const SPHERE = (4 / 3) * Math.PI * 1000;

for (const offset of [[6, 0, 0], [4, 4, 0]]) {
  const d = Math.hypot(...offset);
  test(`two 20 mm spheres ${d.toFixed(2)} mm apart (offset ${offset}): intersect, cut both ways and join are right`, async () => {
    const volumes = {};
    for (const [name, order, op] of [["intersect", [0, 1], "intersect"], ["cutAB", [0, 1], "cut"], ["cutBA", [1, 0], "cut"], ["join", [0, 1], undefined]]) {
      const { ids } = await parts([["sphere", { size: { w: 20, d: 20, h: 20 } }], ["sphere", { size: { w: 20, d: 20, h: 20 }, at: offset }]]);
      const g = await run(([ids, op]) => JS3D.group(ids, op ? { op } : {}), [order.map((i) => ids[i]), op]);
      const [e] = await entries();
      expect(e.id).toBe(g);
      expect(e.error, name).toBeNull();
      volumes[name] = e.volume;
    }
    near(volumes.intersect, lens(10, d), 0.002);
    near(volumes.cutAB, SPHERE - lens(10, d), 0.002);
    near(volumes.cutBA, SPHERE - lens(10, d), 0.002);
    near(volumes.join + volumes.intersect, 2 * SPHERE);
    await noObjectText();
  });
}

test("an intersect of two separate boxes says nothing is left, in plain words", async () => {
  const { ids } = await parts([["box", {}], ["box", { at: [100, 0, 0] }]]);
  await run((ids) => JS3D.group(ids, { op: "intersect" }), ids);
  const [e] = await entries();
  expect(e.error).toMatch(/Nothing is left/);
  expect(e.volume).toBeNull();
  await noObjectText();
});

test("a box cut with a hole bigger than itself says nothing is left, in plain words", async () => {
  const { ids } = await parts([["box", {}], ["box", { size: { w: 60, d: 60, h: 60 }, at: [0, 0, -20], hole: true }]]);
  await run((ids) => JS3D.group(ids), ids);
  const [e] = await entries();
  expect(e.error).toMatch(/Nothing is left/);
  await noObjectText();
  // the export refuses a design with a build error, and says which
  const message = await run(async () => { try { await JS3D.export("step"); return null; } catch (err) { return err.message; } });
  expect(message).toMatch(/Nothing is left/);
  expect(message).not.toContain("[object");
});

// A body of curves only (a wire from a STEP file) has no faces but is not empty: it builds, shows as lines, and exports.
// Made with the app's own kernel: a circle of radius 10, written by blobSTEP().
// quarantined: the single file in WebKit cannot read the STEP blob back out of the engine worker ("The I/O read operation failed"), so no STEP export works there (app bug candidate, see the nightly notes)
test("a STEP import that holds only a circle still builds and exports", async ({}, info) => {
  quarantine(info, ["single-webkit"], "the single file in WebKit cannot read the STEP blob back out of the engine worker");
  const data = readFileSync(new URL("./fixtures/wire-circle.step", import.meta.url)).toString("base64");
  await fresh();
  await run((data) => {
    JS3D.add("box"); // a solid beside it: the export must keep both
    const doc = JS3D.doc();
    doc.assets = { wirecircle: { kind: "step", name: "Wire circle", data } };
    doc.bodies.push({ id: "w1", name: "Wire circle", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "step", asset: "wirecircle", mods: [] } });
    __store.load(doc);
  }, data);
  await waitIdle(page);
  const list = await entries();
  expect(list.map((e) => e.error)).toEqual([null, null]);
  expect(await run(() => __app.scene.views.get("w1").data.lines.length)).toBeGreaterThan(0); // drawn as lines (it has no triangles)
  const step = bytes(await run(() => JS3D.export("step"))).toString("latin1");
  expect(step).toMatch(/CIRCLE/);
  expect(step).toContain("MANIFOLD_SOLID_BREP");
});

// Fuzzer seed 33: OpenCascade's fuse of a torus-and-hemisphere group with a copy of itself left two torus faces whose
// outer boundary was split into two loops. The mesher read the second loop as a hole, so the group's STL was closed
// but about 3 percent too small (8006 mm3 against the group's own 8249).
test("two torus-and-hemisphere groups joined export an STL that holds the group's whole volume", async () => {
  await fresh();
  const id = await run(async () => {
    const t = JS3D.add("torus", { size: { w: 24, d: 24, h: 6 }, at: [-6, -4, 4] });
    const h = JS3D.add("hemisphere", { size: { w: 18, d: 18, h: 20 }, at: [14, 12, 8] });
    await JS3D.ready();
    const a = JS3D.group([t, h]); await JS3D.ready();
    const [b] = JS3D.duplicate([a], [-8, -16, 0]); await JS3D.ready();
    const g = JS3D.group([a, b]); await JS3D.ready(60000);
    return g;
  });
  const [g] = await entries();
  expect(g.id).toBe(id);
  expect(g.error).toBeNull();
  const file = bytes(await run((id) => JS3D.export("stl", { ids: [id] }), id));
  const m = meshReport(readStlTriangles(file)); // the fuzzer's reader: welds at 0.0001 and matches edges by direction
  near(m.volume, g.volume, 0.01);
  expect(m.open).toBe(0);
});

// Fuzzer seed 32: a cylinder joined with a torus and scaled down, grouped with that torus as a hole that touches it at
// one point. The cut left a zero-length edge with a 5.78 mm tolerance, and every boolean near it went wrong: an oval
// sphere that overlaps the group by 44 mm3 intersected to "Nothing is left", and its join and cuts disagreed.
// The design is the one the fuzzer had built by then (its steps 1 to 15), as the app saved it.
const TOUCHING_TORI = {
  v: 1, id: "t_touching_tori", name: "Touching tori", mode: "beginner", created: 1, seq: 2, grid: 1, sketches: [], planes: [], joints: [], params: [],
  bodies: [
    { id: "sph", name: "Sphere 1", seq: 1, color: "#29a35a", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -14, 6, 12, 1],
      node: { t: "prim", kind: "sphere", p: { w: 8, d: 25, h: 23 }, mods: [] } },
    { id: "grp", name: "Cylinder 1", seq: 2, color: "#f3a712", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -6, 0, 8, 1],
      node: { t: "group", mods: [], children: [
        { name: "Cylinder 1", hole: false, m: [6.123233995736766e-17, 1, 0, 0, -1, 6.123233995736766e-17, 0, 0, 0, 0, 1, 0, 9.004441261291504, 3.004441261291504, 0, 1],
          node: { t: "prim", kind: "cylinder", p: { w: 22, d: 18, h: 12, r: 0, c: 0 }, mods: [
            { id: "f1", seq: 3, t: "scale", k: [1.5, 1.5, 1.5], o: [0, 0, -3] },
            { id: "f2", seq: 4, t: "bool", src: "combine", tool: { t: "group", mods: [], children: [
              { name: "Torus 1", hole: false, m: [6.123233995736766e-17, 1, 0, 0, -1, 6.123233995736766e-17, 0, 0, 0, 0, 1, 0, -10.995558738708496, 5.004441261291505, 8, 1],
                node: { t: "prim", kind: "torus", p: { w: 22, d: 22, h: 4, tube: 4 }, mods: [] } }] },
              m: [6.123233995736766e-17, -1, 0, 0, 1, 6.123233995736766e-17, 0, 0, 0, 0, 1, 0, -3.0044412612915044, 9.004441261291504, 0, 1] },
            { id: "f3", seq: 5, t: "scale", k: [0.5, 0.5, 0.5], o: [-2.220446049e-16, 4.374285221, 3] }] } },
        { name: "Torus 1", hole: true, m: [6.123233995736766e-17, 1, 0, 0, -1, 6.123233995736766e-17, 0, 0, 0, 0, 1, 0, -10.995558738708496, 5.004441261291505, 8, 1],
          node: { t: "prim", kind: "torus", p: { w: 22, d: 22, h: 4, tube: 4 }, mods: [] } }] } },
  ],
};
test("a group whose torus hole touches it at one point still intersects, joins and cuts right with an oval sphere", async () => {
  await run((doc) => JS3D.load(doc), TOUCHING_TORI);
  const [sph, grp] = await entries();
  expect([sph.error, grp.error]).toEqual([null, null]);
  const measure = (ids, op) => run(async ([ids, op]) => {
    const g = JS3D.group(ids, op ? { op } : {}); await JS3D.ready(60000);
    const b = JS3D.list().find((e) => e.id === g);
    JS3D.undo(); await JS3D.ready(60000);
    return { volume: b.volume, error: b.error };
  }, [ids, op]);
  const I = await measure([grp.id, sph.id], "intersect"), J = await measure([grp.id, sph.id]);
  const C = await measure([grp.id, sph.id], "cut"), C2 = await measure([sph.id, grp.id], "cut");
  expect([I.error, J.error, C.error, C2.error]).toEqual([null, null, null, null]);
  near(I.volume, 43.91, 0.01); // the overlap, as each part alone intersects the sphere (the group's hole cuts nothing)
  near(J.volume + I.volume, sph.volume + grp.volume, 1e-4);
  near(C.volume, J.volume - sph.volume, 1e-4);
  near(C2.volume, J.volume - grp.volume, 1e-4);
});

// Fuzzer seed 33: two tori joined where their lowest circles cross. The mesher leaves a patch of triangles under
// 0.1 micron across at the crossing; the 3MF writer welded corners only when they rounded to the same 0.01 micron,
// so one of those triangles stayed with three edges that no other triangle shared, and slicers saw an open mesh.
test("two tori joined where their lowest circles cross export a closed 3MF", async () => {
  await fresh();
  const id = await run(async () => {
    const a = JS3D.add("torus", { size: { w: 24, d: 24, h: 6 }, at: [-6, -4, 4] });
    const b = JS3D.add("torus", { size: { w: 24, d: 24, h: 6 }, at: [-14, -20, 4] });
    await JS3D.ready();
    const g = JS3D.group([a, b]); await JS3D.ready(60000);
    return g;
  });
  const [g] = await entries();
  expect(g.id).toBe(id);
  expect(g.error).toBeNull();
  const m = readThreeMf(bytes(await run(() => JS3D.export("3mf"))));
  expect(m.items.length).toBe(1);
  expect(m.items[0].mesh.open, "3MF edges with no partner").toBe(0);
  near(m.items[0].placed, g.volume, 0.01);
});

// An oval sphere (20 by 30 by 10) and an oval cylinder (10 by 14 by 12) at x = 5: OpenCascade missed their overlap, so the join
// lost the sphere (volume of the cylinder only), their intersect said "Nothing is left" and the cuts came out too big (one
// of them not even a valid solid). Fuzzy values 1e-6 to 1e-4 repeat the mistake, so the build retries with looser ones when
// the volumes do not fit (third_party/replicad operations.ts). The overlap is 850.09 mm3 by a grid integral over the cylinder's section.
test("an oval sphere and an oval cylinder that overlap join, intersect and cut right", async () => {
  const OVERLAP = 850.09, SPHERE = (4 / 3) * Math.PI * 10 * 15 * 5, CYLINDER = Math.PI * 5 * 7 * 12;
  const volumes = {};
  for (const [name, order, op] of [["intersect", [0, 1], "intersect"], ["cutAB", [0, 1], "cut"], ["cutBA", [1, 0], "cut"], ["join", [0, 1], undefined], ["joinBA", [1, 0], undefined]]) {
    const { ids } = await parts([["sphere", { size: { w: 20, d: 30, h: 10 } }], ["cylinder", { size: { w: 10, d: 14, h: 12 }, at: [5, 0, 0] }]]);
    const g = await run(([ids, op]) => { const g = JS3D.group(ids, op ? { op } : {}); return JS3D.ready(90000).then(() => g); }, [order.map((i) => ids[i]), op]);
    const [e] = await entries();
    expect(e.id).toBe(g);
    expect(e.error, name).toBeNull();
    volumes[name] = e.volume;
  }
  near(volumes.intersect, OVERLAP, 0.01);
  near(volumes.join, SPHERE + CYLINDER - volumes.intersect, 0.01);
  near(volumes.joinBA, volumes.join, 0.001);
  near(volumes.cutAB, SPHERE - volumes.intersect, 0.01);
  near(volumes.cutBA, CYLINDER - volumes.intersect, 0.01);
  await noObjectText();
});
