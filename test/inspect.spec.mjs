// Inspect and check calls on window.JS3D (inspect, measure, printCheck, collisions, section), on both builds.
// An open box with a cavity and four screw holes, built through the bridge; the numbers are worked out from the sizes.
// Every call goes through guarded(), which fails when a call changes the undo stack or the selection.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors } from "./helpers.mjs";

const V = 60 * 40 * 25 - 56 * 36 * 23 - 4 * Math.PI * 1.7 ** 2 * 2; // 13559.366 mm3
const A = 14032 - 8 * Math.PI * 1.7 ** 2 + 4 * Math.PI * 3.4 * 2; // 14044.818 mm2

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
  await page.evaluate(() => {
    const state = () => JSON.stringify([__store.undoStack.length, JS3D.selection()]);
    window.guarded = async (name, ...args) => {
      const before = state();
      try { return await JS3D[name](...args); } finally { if (state() !== before) throw new Error(name + " changed the undo stack or the selection"); }
    };
    window.failure = async (name, ...args) => { try { await window.guarded(name, ...args); return null; } catch (e) { return e.message; } };
    window.addLid = (z) => JS3D.add("box", { size: [60, 40, 3], at: [0, 0, z], name: "Lid" });
    window.openBox = async () => {
      JS3D.newDesign("beginner");
      const outer = JS3D.add("box", { size: [60, 40, 25], name: "Box" });
      const cav = JS3D.add("box", { size: [56, 36, 25], at: [0, 0, 2], hole: true });
      const holes = [];
      for (const x of [-24, 24]) for (const y of [-14, 14]) holes.push(JS3D.add("cylinder", { size: { w: 3.4, d: 3.4, h: 4 }, at: [x, y, -1], hole: true }));
      const id = JS3D.group([outer, cav, ...holes], { name: "Box" });
      await JS3D.ready();
      return id;
    };
  });
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);

test("inspect: size, volume, area, weight, totals and errors", async () => {
  const r = await run(async () => {
    const id = await openBox();
    const pla = await guarded("inspect"), petg = await guarded("inspect", [id], { material: "petg" }), dens = await guarded("inspect", id, { density: 2.7 });
    JS3D.add("box", { size: [60, 40, 3], at: [0, 0, 40], name: "Lid" });
    await JS3D.ready();
    const two = await guarded("inspect", []);
    return { id, pla, petg, dens, two, wood: await failure("inspect", undefined, { material: "wood" }), d0: await failure("inspect", undefined, { density: 0 }), d30: await failure("inspect", undefined, { density: 30 }), none: await failure("inspect", "nope") };
  });
  const b = r.pla.bodies[0];
  expect(r.pla.bodies).toHaveLength(1);
  expect(b).toMatchObject({ id: r.id, name: "Box", hole: false, hidden: false, volumeFrom: "solid", solids: 1, error: null });
  expect(b.bbox).toEqual({ min: [-30, -20, 0], max: [30, 20, 25] });
  expect(b.size).toEqual([60, 40, 25]);
  expect(Math.abs(b.volume - V)).toBeLessThan(0.05);
  expect(Math.abs(b.area - A) / A).toBeLessThan(0.002);
  expect(b.weight).toBeCloseTo(16.814, 2);
  expect(r.pla.material).toEqual({ key: "pla", name: "PLA", density: 1.24 });
  expect(r.pla.total).toMatchObject({ bodies: 1, size: [60, 40, 25] });
  expect(r.petg.bodies[0].weight).toBeCloseTo(17.22, 2);
  expect(r.petg.material.key).toBe("petg");
  expect(r.dens.bodies[0].weight).toBeCloseTo(36.61, 2);
  expect(r.dens.material).toEqual({ key: "custom", name: "Custom", density: 2.7 });
  expect(r.two.bodies).toHaveLength(2);
  expect(Math.abs(r.two.total.volume - (V + 7200))).toBeLessThan(0.1);
  expect(r.two.total.bbox.max[2]).toBe(43);
  expect(r.two.total.bbox.min).toEqual([-30, -20, 0]);
  expect(r.wood).toContain('unknown material "wood"; valid materials:');
  expect(r.d0).toContain("density must be a number of g/cm3 from 0.1 to 25, got 0");
  expect(r.d30).toContain("density must be a number of g/cm3 from 0.1 to 25, got 30");
  expect(r.none).toMatch(/^no body "nope"/);
});

test("printCheck: plate, overhang, bed and height", async () => {
  const r = await run(async () => {
    const id = await openBox();
    const ok = await guarded("printCheck");
    const hole = JS3D.add("cylinder", { size: { w: 5, d: 5, h: 5 }, at: [100, 100, 0], hole: true });
    await JS3D.ready();
    const withHole = await guarded("printCheck");
    JS3D.remove(hole);
    JS3D.move(id, [0, 0, 5]);
    await JS3D.ready();
    const floating = await guarded("printCheck");
    JS3D.undo();
    JS3D.rotate(id, "x", 180, { about: [0, 0, 12.5] });
    await JS3D.ready();
    const flipped = await guarded("printCheck");
    JS3D.undo();
    const wide = JS3D.add("box", { size: [200, 20, 10], name: "Wide" });
    await JS3D.ready();
    const mini = await guarded("printCheck", { ids: [wide], printer: "mini" });
    JS3D.remove(wide);
    const tall = JS3D.add("box", { size: [20, 20, 300], name: "Tall" });
    await JS3D.ready();
    const a1 = await guarded("printCheck", { ids: [tall], printer: "a1" });
    const none = await guarded("printCheck", { ids: [tall], printer: "none" });
    return { ok, withHole, floating, flipped, mini, a1, none, zz: await failure("printCheck", { printer: "zz" }), five: await failure("printCheck", { angle: 5 }), ninety: await failure("printCheck", { angle: 90 }) };
  });
  expect(r.ok).toMatchObject({ ok: true, issues: [], printer: "generic", angle: 45, ignored: [], summary: "Ready to print: 1 part, no problems found." });
  expect(r.ok.bed).toEqual({ w: 256, d: 256, h: null });
  expect(r.ok.bodies[0].overhangArea).toBe(0);
  expect(r.withHole.ignored.map((x) => [x.name, x.why])).toEqual([["Cylinder hole 1", "hole"]]);
  expect(r.withHole.ok).toBe(true);
  expect(r.floating.ok).toBe(false);
  expect(r.floating.issues[0]).toMatchObject({ level: "error", code: "floating", name: "Box", text: "Box floats 5 mm above the plate. Move it down so its lowest point is at z = 0." });
  expect(r.flipped.ok).toBe(true);
  expect(r.flipped.issues.map((x) => x.code)).toEqual(["overhang"]);
  expect(r.flipped.issues[0].level).toBe("warn");
  expect(Math.abs(r.flipped.bodies[0].overhangArea - 1979.68)).toBeLessThan(0.5);
  expect(Math.abs(r.flipped.bodies[0].contactArea - 384)).toBeLessThan(0.01);
  expect(r.flipped.summary).toBe("Ready to print, with 1 warning.");
  expect(r.mini.ok).toBe(false);
  expect(r.mini.issues[0].code).toBe("outside_bed");
  expect(r.mini.issues[0].text).toMatch(/ plate \(X\)\. Move it toward the middle, turn it or make it smaller\.$/);
  expect(r.mini.bed).toMatchObject({ w: 180, d: 180, h: 180 });
  expect(r.a1.issues.map((x) => x.code)).toEqual(["too_tall"]);
  expect(r.a1.issues[0].text).toMatch(/^Tall is 300 mm tall; the .* prints at most 256 mm\.$/);
  expect(r.none.bed).toBeNull();
  expect(r.none.ok).toBe(true);
  expect(r.zz).toContain('unknown printer "zz"; valid:');
  expect(r.five).toContain("angle must be a number of degrees from 10 to 80, got 5");
  expect(r.ninety).toContain("angle must be a number of degrees from 10 to 80, got 90");
});

test("collisions: touch, overlap, apart, near", async () => {
  const r = await run(async () => {
    const id = await openBox();
    const lid = addLid(25);
    await JS3D.ready();
    const touch = await guarded("collisions");
    JS3D.moveTo(lid, [0, 0, 24]);
    await JS3D.ready();
    const overlap = await guarded("collisions");
    JS3D.moveTo(lid, [0, 0, 26]);
    await JS3D.ready();
    const apart = await guarded("collisions");
    const near = await guarded("collisions", { gap: 2 });
    const one = await guarded("collisions", { ids: [id] });
    return { id, lid, touch, overlap, apart, near, one, neg: await failure("collisions", { gap: -1 }), big: await failure("collisions", { gap: 51 }) };
  });
  expect(r.touch.checked).toBe(2);
  expect(r.touch.skipped).toEqual([]);
  expect(r.touch.pairs).toHaveLength(1);
  expect(r.touch.pairs[0]).toMatchObject({ aName: "Box", bName: "Lid", distance: 0, state: "touch", overlap: 0 });
  expect([r.touch.pairs[0].a, r.touch.pairs[0].b].sort()).toEqual([r.id, r.lid].sort());
  expect(r.overlap.pairs[0].state).toBe("overlap");
  expect(Math.abs(r.overlap.pairs[0].overlap - 384)).toBeLessThan(0.5);
  expect(r.apart.pairs).toEqual([]);
  expect(r.near.pairs).toHaveLength(1);
  expect(r.near.pairs[0]).toMatchObject({ state: "near", overlap: null });
  expect(Math.abs(r.near.pairs[0].distance - 1)).toBeLessThan(1e-3);
  expect(r.one).toEqual({ pairs: [], checked: 1, skipped: [] });
  expect(r.neg).toContain("gap must be a number of mm from 0 to 50, got -1");
  expect(r.big).toContain("gap must be a number of mm from 0 to 50, got 51");
});

test("measure: points, bodies, flat faces and the mesh", async () => {
  const r = await run(async () => {
    const id = await openBox();
    const lid = addLid(26);
    await JS3D.ready();
    const pts = await guarded("measure", [0, 0, 0], [3, 4, 0]);
    const bodies = await guarded("measure", id, lid);
    const wall = await guarded("measure", { body: id, near: [30, 0, 12] }, { body: id, near: [28, 0, 12] });
    const byNumber = await guarded("measure", { body: id, face: wall.a.face }, { body: id, face: wall.b.face });
    const mesh = await guarded("measure", [29, 0, 40], id);
    const meshFlip = await guarded("measure", id, [29, 0, 40]);
    const faceBody = await guarded("measure", { body: id, face: wall.a.face }, lid);
    return { id, pts, bodies, wall, byNumber, mesh, meshFlip, faceBody,
      bad: await failure("measure", "nope"), nul: await failure("measure", null, [0, 0, 0]), badPoint: await failure("measure", [1, 2], [0, 0, 0]),
      far: await failure("measure", { body: id, face: 9999 }, [0, 0, 0]), same: await failure("measure", id, id), obj: await failure("measure", { body: id, face: 0, near: [0, 0, 0] }, [0, 0, 0]) };
  });
  expect(r.pts).toMatchObject({ distance: 5, exact: true, kind: "point-point", delta: [3, 4, 0], from: [0, 0, 0], to: [3, 4, 0], a: { point: [0, 0, 0] }, b: { point: [3, 4, 0] } });
  expect(Math.abs(r.bodies.distance - 1)).toBeLessThan(1e-4);
  expect(r.bodies).toMatchObject({ kind: "body-body", exact: true });
  expect(r.bodies.a).toEqual({ body: r.id, name: "Box" });
  expect(Math.abs(r.wall.distance - 2)).toBeLessThan(1e-4);
  expect(r.wall).toMatchObject({ kind: "planes", exact: true, parallel: true, angle: 0 });
  expect(r.wall.a).toMatchObject({ body: r.id, name: "Box", type: "PLANE" });
  expect(r.wall.a.normal).toEqual([1, 0, 0]);
  expect(Number.isInteger(r.wall.a.face) && Number.isInteger(r.wall.b.face) && r.wall.a.face !== r.wall.b.face).toBe(true);
  expect(r.wall.a.nearDistance).toBeLessThan(1e-3);
  expect(r.byNumber.kind).toBe("planes");
  expect(Math.abs(r.byNumber.distance - 2)).toBeLessThan(1e-4);
  expect(r.byNumber.a.nearDistance).toBeUndefined();
  expect(Math.abs(r.mesh.distance - 15)).toBeLessThan(1e-3);
  expect(r.mesh).toMatchObject({ kind: "mesh", exact: false });
  expect(Math.abs(r.meshFlip.distance - 15)).toBeLessThan(1e-3);
  expect(r.faceBody).toMatchObject({ kind: "mesh", exact: false });
  expect(r.faceBody.distance).toBeGreaterThan(0);
  const target = "must be a point [x, y, z], a body id, or {body, face} or {body, near}";
  expect(r.bad).toMatch(/^no body "nope"/);
  expect(r.nul).toContain("a " + target + ", got null");
  expect(r.badPoint).toContain("a must be [x, y, z] in mm, got [1,2]");
  expect(r.far).toMatch(/^face must be a whole number from 0 to \d+ \(Box has \d+ faces\), got 9999/);
  expect(r.same).toContain("a and b are the same body, got ");
  expect(r.obj).toContain("a " + target + ", got ");
});

test("measure: two sheets of one plate give its thickness", async () => {
  const r = await run(async () => {
    const id = JS3D.add("box", { size: [40, 30, 6] });
    await JS3D.ready();
    return guarded("measure", { body: id, near: [0, 0, 6] }, { body: id, near: [0, 0, 0] });
  });
  expect(r).toMatchObject({ kind: "planes", exact: true, parallel: true, angle: 0 });
  expect(Math.abs(r.distance - 6)).toBeLessThan(1e-4);
});

test("section: loops, holes, shifted plane, points", async () => {
  const r = await run(async () => {
    await openBox();
    return {
      z10: await guarded("section", { axis: "z", at: 10 }),
      z1: await guarded("section", { axis: "z", at: 1 }),
      z2: await guarded("section", { axis: "z", at: 2 }),
      x0: await guarded("section", { axis: "x", at: 0 }),
      pts: await guarded("section", { axis: "z", at: 10 }, { points: true }),
      miss: await guarded("section", { axis: "z", at: 100 }),
      tilt: await guarded("section", { origin: [0, 0, 10], normal: [0, 0, 5] }),
      both: await failure("section", { axis: "z", at: 1, origin: [0, 0, 0], normal: [0, 0, 1] }),
      none: await failure("section", {}),
      axis: await failure("section", { axis: "w", at: 1 }),
      at: await failure("section", { axis: "y" }),
      nan: await failure("section", { axis: "y", at: "high" }),
      zero: await failure("section", { origin: [0, 0, 0], normal: [0, 0, 0] }),
      point: await failure("section", { origin: [0, 0], normal: [0, 0, 1] }),
    };
  });
  const plane = 'give axis ("x", "y" or "z") and at, or origin [x, y, z] and normal [x, y, z]';
  expect(r.z10.bodies).toHaveLength(1);
  const body = r.z10.bodies[0];
  expect(body.loops).toHaveLength(2);
  expect(body.loops.every((l) => l.closed)).toBe(true);
  expect(body.loops.map((l) => [l.area, l.hole]).sort((a, b) => b[0] - a[0])).toEqual([[2400, false], [2016, true]]);
  expect(Math.abs(body.area - 384)).toBeLessThan(1e-3);
  expect(r.z10.shifted).toBe(0);
  expect(r.z10.plane).toEqual({ origin: [0, 0, 10], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] });
  expect(Math.abs(r.z10.area - 384)).toBeLessThan(1e-3);
  expect(r.z10.skipped).toEqual([]);
  expect(body.loops.find((l) => !l.hole)).toMatchObject({ min: [-30, -20], max: [30, 20], perimeter: 200 });
  expect(body.loops[0].points).toBeUndefined();
  expect(r.z1.bodies[0].loops).toHaveLength(5);
  expect(r.z1.bodies[0].loops.filter((l) => l.hole)).toHaveLength(4);
  expect(Math.abs(r.z1.area - 2363.68)).toBeLessThan(0.5);
  expect(r.z2.shifted).toBe(0.0001);
  expect(Math.abs(r.z2.area - 384)).toBeLessThan(0.01);
  expect(r.x0.bodies[0].loops).toHaveLength(1);
  expect(r.x0.bodies[0].loops[0].hole).toBe(false);
  expect(Math.abs(r.x0.area - 172)).toBeLessThan(1e-3);
  expect(r.x0.plane).toMatchObject({ u: [0, 1, 0], v: [0, 0, 1] });
  for (const l of r.pts.bodies[0].loops) {
    expect(l.points.length).toBeGreaterThanOrEqual(4);
    for (const p of l.points) { expect(p[0]).toBeGreaterThanOrEqual(l.min[0] - 1e-3); expect(p[0]).toBeLessThanOrEqual(l.max[0] + 1e-3); expect(p[1]).toBeGreaterThanOrEqual(l.min[1] - 1e-3); expect(p[1]).toBeLessThanOrEqual(l.max[1] + 1e-3); }
  }
  expect(r.miss.bodies).toEqual([]);
  expect(r.miss.area).toBe(0);
  expect(Math.abs(r.tilt.area - 384)).toBeLessThan(1e-3);
  expect(r.both).toContain(plane);
  expect(r.none).toContain(plane);
  expect(r.axis).toContain(plane);
  expect(r.at).toContain("at must be a number (mm along y), got undefined");
  expect(r.nan).toContain('at must be a number (mm along y), got "high"');
  expect(r.zero).toContain("normal must not be [0, 0, 0]");
  expect(r.point).toContain("origin must be [x, y, z] in mm, got [0,0]");
});

test("section picture: PNG, section view put back, Arch mode refused", async () => {
  const r = await run(async () => {
    await openBox();
    const shot = await guarded("section", { axis: "z", at: 10 }, { picture: true, width: 400 });
    const afterPicture = __app.section.info;
    const badWidth = await failure("section", { axis: "z", at: 10 }, { picture: true, width: 0 });
    const afterBad = __app.section.info;
    const img = new Image();
    img.src = shot.dataURL;
    await img.decode();
    JS3D.setMode("arch");
    const arch = await failure("section", { axis: "z", at: 10 }, { picture: true });
    const archPlain = await guarded("section", { axis: "z", at: 10 });
    JS3D.setMode("beginner");
    return { head: shot.dataURL.slice(0, 22), width: img.naturalWidth, afterPicture, badWidth, afterBad, arch, archArea: archPlain.area };
  });
  expect(r.head).toBe("data:image/png;base64,");
  expect(r.width).toBe(400);
  expect(r.afterPicture).toBeNull();
  expect(r.badWidth).toMatch(/^width must be a number of pixels between 1 and 8192/);
  expect(r.afterBad).toBeNull();
  expect(r.arch).toMatch(/^section pictures need Beginner or Advanced mode \(now \w+\)/);
  expect(Math.abs(r.archArea - 384)).toBeLessThan(1e-3);
});

test("hidden bodies are left out unless named", async () => {
  const r = await run(async () => {
    JS3D.newDesign("beginner");
    const a = JS3D.add("box", { size: [10, 10, 10], name: "Shown" });
    const b = JS3D.add("box", { size: [10, 10, 10], at: [30, 0, 0], name: "Later" });
    await JS3D.ready();
    JS3D.setHidden(b, true);
    const hiddenDefault = await guarded("inspect");
    const hiddenNamed = await guarded("inspect", [b]);
    const check = await guarded("printCheck");
    return { a, b, hiddenDefault, hiddenNamed, check };
  });
  expect(r.hiddenDefault.bodies.map((x) => x.name)).toEqual(["Shown"]);
  expect(r.hiddenNamed.bodies[0]).toMatchObject({ name: "Later", hidden: true });
  expect(r.check.ignored).toEqual([{ id: r.b, name: "Later", why: "hidden" }]);
});

test("null ids mean every shown solid, as over the WebSocket", async () => {
  const r = await run(async () => {
    await openBox();
    return { inspect: await guarded("inspect", null, {}), print: await guarded("printCheck", { ids: null }), cols: await guarded("collisions", { ids: null, gap: null }) };
  });
  expect(r.inspect.bodies).toHaveLength(1);
  expect(r.print.ok).toBe(true);
  expect(r.cols.checked).toBe(1);
});

test("a preview or a rolled-back design is refused, not mixed with the committed one", async () => {
  const r = await run(async () => {
    const id = await openBox();
    __store.setPreview((d) => { d.bodies.find((b) => b.id === id).m[12] = 50; });
    const preview = await failure("inspect");
    const section = await failure("section", { axis: "z", at: 10 });
    __store.setPreview(null);
    const after = await guarded("inspect");
    return { preview, section, size: after.bodies[0].size };
  });
  expect(r.preview).toBe("the design is showing a preview; finish or cancel it first");
  expect(r.section).toBe(r.preview);
  expect(r.size).toEqual([60, 40, 25]);
});

test("collisions: a gap of 0.005 mm is not reported when gap is 0, and is near when gap is 0.01", async () => {
  const r = await run(async () => {
    JS3D.newDesign("beginner");
    JS3D.add("box", { size: [10, 10, 10], name: "A" });
    JS3D.add("box", { size: [10, 10, 10], at: [0, 0, 10.005], name: "B" });
    await JS3D.ready();
    return { zero: await guarded("collisions"), wide: await guarded("collisions", { gap: 0.01 }) };
  });
  expect(r.zero.pairs).toEqual([]);
  expect(r.wide.pairs).toHaveLength(1);
  expect(r.wide.pairs[0].state).toBe("near");
  const r2 = await run(async () => {
    JS3D.newDesign("beginner");
    JS3D.add("box", { size: [10, 10, 10], name: "A" });
    JS3D.add("box", { size: [10, 10, 10], at: [0, 0, 10.02], name: "B" });
    await JS3D.ready();
    return { zero: await guarded("collisions"), wide: await guarded("collisions", { gap: 0.05 }) };
  });
  expect(r2.zero.pairs).toEqual([]);
  expect(r2.wide.pairs[0].state).toBe("near");
});

test("measure: perpendicular faces on edges give the true gap", async () => {
  const r = await run(async () => {
    JS3D.newDesign("beginner");
    const a = JS3D.add("box", { size: [10, 2, 1], name: "A" });
    const b = JS3D.add("box", { size: [1, 10, 2], at: [0.5, 0, 2], name: "B" });
    await JS3D.ready();
    return guarded("measure", { body: a, near: [0, 0, 1] }, { body: b, near: [0, 0, 3] });
  });
  expect(r.kind).toBe("mesh");
  expect(r.distance).toBeCloseTo(1, 3);
});

test("wire-only STEP bodies give plain answers", async () => {
  const data = readFileSync(new URL("./fixtures/wire-circle.step", import.meta.url)).toString("base64");
  const r = await run(async (data) => {
    JS3D.newDesign("beginner");
    JS3D.add("box", { size: [10, 10, 10], name: "Solid" });
    const doc = JS3D.doc();
    doc.assets = { wirecircle: { kind: "step", name: "Wire circle", data } };
    doc.bodies.push({ id: "w1", name: "Ring", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "step", asset: "wirecircle", mods: [] } });
    __store.load(doc);
    await JS3D.ready();
    return { inspect: await guarded("inspect", ["w1"]), check: await guarded("printCheck"), measure: await failure("measure", [0, 0, 0], { body: "w1", face: 0 }), point: await failure("measure", [0, 0, 0], "w1") };
  }, data);
  expect(r.inspect.bodies[0]).toMatchObject({ volume: 0, area: 0, bbox: null, error: null });
  expect(r.inspect.bodies[0].note).toMatch(/wire-only/);
  expect(r.check.issues.find((x) => x.code === "wire_only").text).toMatch(/^Ring is a wire-only shape/);
  expect(r.measure).toMatch(/^Ring is a wire-only shape/);
  expect(r.point).toMatch(/^Ring is a wire-only shape/);
});

test("section picture: always from Home, and the user's camera comes back", async () => {
  const r = await run(async () => {
    await openBox();
    const vp = __app.vp;
    __app.vp.setView("left");
    vp.stepAnim(vp.anim.t0 + vp.anim.ms);
    const before = { az: vp.view.az, el: vp.view.el, dist: vp.view.dist, target: vp.view.target.toArray() };
    await guarded("section", { axis: "z", at: 10 }, { picture: true, width: 200 });
    const after = { az: vp.view.az, el: vp.view.el, dist: vp.view.dist, target: vp.view.target.toArray() };
    return { before, after, anim: !!vp.anim };
  });
  expect(r.after).toEqual(r.before);
  expect(r.anim).toBe(false);
});
