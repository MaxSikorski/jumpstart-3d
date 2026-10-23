// Gears (Phase 3 step 3): the Gear dialog and JS3D.gear make a spur gear, a straight bevel gear or a rack as ordinary sketches plus
// an Extrude (a Loft for bevel). Volumes are checked against the module's own outline: "shoelace" is the area of the stored outline
// points, read from JS3D.doc().sketches in stored order.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, exportBytes, quarantine } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
  // the area of a sketch's outer loop: its lines from the first one on, while each starts where the last one ended
  await page.evaluate(() => {
    window.__shoe = (skId) => {
      const sk = JS3D.doc().sketches.find((s) => s.id === skId), P = new Map(sk.pts.map((p) => [p.id, p]));
      const lines = sk.ents.filter((e) => e.t === "line");
      let A = 0, e = lines[0];
      for (let i = 0; i < lines.length; i++) {
        const p = P.get(e.a), q = P.get(e.b);
        A += p.x * q.y - q.x * p.y;
        if (e.b === lines[0].a) break;
        e = lines.find((l) => l.a === e.b);
      }
      return A / 2;
    };
  });
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = (mode = "beginner") => run((m) => JS3D.newDesign(m), mode);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const bodyOf = async (id) => (await built()).find((b) => b.id === id);
const sketchOf = (id) => run((id) => { const n = JS3D.get(id).node; return n.sketch || n.sections[0].sketch; }, id);
const shoelace = (skId) => run((s) => window.__shoe(s), skId);
const sketchData = (skId) => run((s) => JS3D.doc().sketches.find((x) => x.id === s), skId);
const counts = () => run(() => ({ bodies: JS3D.doc().bodies.length, sketches: JS3D.doc().sketches.length, undo: __store.undoStack.length }));
const near = (got, want, rel, what) => expect(Math.abs(got - want) / Math.abs(want), `${what}: ${got} vs ${want}`).toBeLessThan(rel);
const field = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };
const kind = (name) => page.locator("#ge-kind button", { hasText: name }).click();
async function openFromRibbon() {
  await page.click("#ad-features");
  await page.click("#ad-gear");
  await expect(page.locator("#cmd")).toContainText("Gear");
}

test("Advanced: Create > Advanced Create > Gear makes a 20-tooth module-2 spur gear in one undo step", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await expect(page.locator("#cmd")).toContainText("Pitch diameter 40 mm, outside 44 mm, root 35 mm.");
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["Spur gear 20 teeth m2"]);
  const g = list[0];
  expect(g.error).toBeNull();
  const doc = await run(() => JS3D.doc());
  expect(doc.sketches).toHaveLength(1);
  expect(doc.sketches[0].hidden).toBe(true);
  expect(doc.sketches[0].ents.filter((e) => e.t === "line")).toHaveLength(360);
  const area = await shoelace(doc.sketches[0].id);
  near(g.volume, area * 6, 0.001, "volume against the outline");
  expect(g.volume).toBeGreaterThan(Math.PI * 17.5 ** 2 * 6);
  expect(g.volume).toBeLessThan(Math.PI * 22 ** 2 * 6);
  expect(g.bbox.min[2]).toBeCloseTo(0, 4);
  expect(g.bbox.max[2]).toBeCloseTo(6, 4);
  expect(await run(() => __app.sel)).toEqual([g.id]);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add Spur gear 20 teeth m2");
  await run(() => JS3D.undo());
  expect(await counts()).toMatchObject({ bodies: 0, sketches: 0 });
});

test("tooth form: 2 z points on the tip circle, and 18 lines a tooth below 42 teeth, 16 from 42", async () => {
  await fresh();
  const [a, b, c] = await run(() => [JS3D.gear({ module: 2, teeth: 20 }), JS3D.gear({ module: 2, teeth: 41, at: [100, 0, 0] }), JS3D.gear({ module: 2, teeth: 42, at: [200, 0, 0] })]);
  const sk = await sketchData(await sketchOf(a));
  expect(sk.pts.filter((p) => Math.abs(Math.hypot(p.x, p.y) - 22) < 1e-6)).toHaveLength(40);
  // the root circle is module * 1.25 below the pitch circle (radius 20): 17.5, two points a tooth (the ends of the radial line)
  expect(sk.pts.filter((p) => Math.abs(Math.hypot(p.x, p.y) - 17.5) < 1e-6)).toHaveLength(40);
  const lines = async (id) => (await sketchData(await sketchOf(id))).ents.filter((e) => e.t === "line").length;
  expect(await lines(b)).toBe(41 * 18);
  expect(await lines(c)).toBe(42 * 16);
  expect((await built()).filter((x) => x.error)).toEqual([]);
});

test("the clearance thins tooth 0 by exactly clear at the pitch radius", async () => {
  await fresh();
  const [c0, c2] = await run(() => [JS3D.gear({ module: 2, teeth: 20, clear: 0 }), JS3D.gear({ module: 2, teeth: 20, clear: 0.2, at: [60, 0, 0] })]);
  // tooth 0 of a 20-tooth gear: point 0 is the root end of the radial line, 1 to 8 the right flank (root to tip), 9 to 16 the left flank (tip to root).
  // The thickness at a flank radius is that radius times the angle between the two flanks; read it at the pitch radius (20) by interpolating
  const thickness = async (id) => {
    const { pts } = await sketchData(await sketchOf(id));
    const w = (j) => { const R = pts[1 + j], L = pts[16 - j]; return { r: Math.hypot(R.x, R.y), t: Math.hypot(R.x, R.y) * (Math.atan2(L.y, L.x) - Math.atan2(R.y, R.x)) }; };
    for (let j = 0; j < 7; j++) {
      const a = w(j), b = w(j + 1);
      if (a.r <= 20 && b.r >= 20) return a.t + ((b.t - a.t) * (20 - a.r)) / (b.r - a.r);
    }
    throw new Error("no flank point pair around the pitch radius");
  };
  const t0 = await thickness(c0), t2 = await thickness(c2);
  expect(t0).toBeCloseTo(Math.PI, 1); // half the pitch (pi * module / 2 = pi); the interpolation between flank points is 0.01 short
  expect(t0 - t2).toBeCloseTo(0.2, 3);
});

test("a bore and a DIN 6885 keyway are drawn in the outline and take their exact area off", async () => {
  await fresh();
  const [plain, bored, keyed] = await run(() => [
    JS3D.gear({ module: 2, teeth: 30, width: 10, clear: 0 }),
    JS3D.gear({ module: 2, teeth: 30, width: 10, clear: 0, bore: 8, at: [80, 0, 0] }),
    JS3D.gear({ module: 2, teeth: 30, width: 10, clear: 0, bore: 8, keyway: true, at: [160, 0, 0] }),
  ]);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  const v = (id) => list.find((b) => b.id === id).volume;
  const area = await shoelace(await sketchOf(plain));
  near(v(plain), area * 10, 0.001, "plain");
  near(v(bored), (area - Math.PI * 16) * 10, 0.001, "bore");
  const r = 4, b = 2, h = 1, T = 5, y0 = Math.sqrt(r * r - h * h);
  const key = Math.PI * r * r - (r * r * Math.acos(y0 / r) - h * y0) + b * (T - y0);
  near(v(keyed), (area - key) * 10, 0.001, "keyway");
  const sk = await sketchData(await sketchOf(keyed));
  expect(sk.ents.filter((e) => e.t === "arc")).toHaveLength(1);
  expect(sk.ents.filter((e) => e.t === "circle")).toHaveLength(0);
  const outline = (await sketchData(await sketchOf(plain))).ents.length;
  expect(sk.ents.filter((e) => e.t === "line")).toHaveLength(outline + 3);
  expect((await sketchData(await sketchOf(bored))).ents.filter((e) => e.t === "circle")).toHaveLength(1);
});

test("a 12-tooth pinion turns freely against a 30-tooth gear when the second is turned half a tooth; without the turn they collide", async () => {
  await fresh();
  const [a, b] = await run(() => [JS3D.gear({ module: 2, teeth: 12, width: 10, clear: 0 }), JS3D.gear({ module: 2, teeth: 30, width: 10, clear: 0, at: [42, 0, 0] })]);
  const overlap = (turn) => run(async ([a, b, turn]) => {
    await JS3D.ready();
    if (turn) JS3D.rotate(b, "z", turn, { about: [42, 0, 0] });
    const g = JS3D.group([a, b], { op: "intersect" });
    await JS3D.ready();
    const row = JS3D.list().find((x) => x.id === g);
    return { v: row.volume, error: row.error };
  }, [a, b, turn]);
  const clash = await overlap(0);
  expect(clash.error).toBeNull();
  expect(clash.v).toBeGreaterThan(100);
  await run(() => JS3D.undo()); // the group
  const meshed = await overlap(6);
  expect(meshed.error).toBeNull();
  expect(meshed.v).not.toBeNull();
  expect(meshed.v).toBeLessThan(0.01);
});

test("the dialog at 12 teeth warns about undercut and Create stays on", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await field("ge-teeth", 12);
  await expect(page.locator("#cmd")).toContainText("Fewer than 17 teeth: a real gear this small is undercut at the root");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await field("ge-teeth", 17);
  await expect(page.locator("#cmd")).not.toContainText("Fewer than 17 teeth");
  await page.click("#cmd button:has-text('Cancel')");
});

test("a rack has the exact tooth form: volume, length, pitch and a clearance that thins every tooth", async () => {
  await fresh();
  const make = (clear) => run((clear) => JS3D.gear({ kind: "rack", module: 2, teeth: 20, width: 8, base: 5, clear }), clear);
  const id = await make(0);
  const g = await bodyOf(id);
  expect(g.error).toBeNull();
  const tan = Math.tan((20 * Math.PI) / 180), hp = Math.PI / 2, hTip = hp - 2 * tan, hRoot = hp + 2.5 * tan;
  near(g.volume, 8 * (20 * 2 * Math.PI * 5 + 20 * 2.25 * 2 * (hTip + hRoot)), 0.001, "rack volume");
  expect(g.bbox.max[0] - g.bbox.min[0]).toBeCloseTo(40 * Math.PI, 3);
  expect(g.bbox.min[0]).toBeCloseTo(0, 4);
  // the tooth tips come in pairs at y = module; the middle of each pair is a pitch (pi * module) from the next
  const sk = await sketchData(await sketchOf(id));
  const xs = sk.pts.filter((p) => Math.abs(p.y - 2) < 1e-9).map((p) => p.x).sort((x, y) => x - y);
  expect(xs).toHaveLength(40);
  const mids = xs.filter((_, i) => i % 2 === 0).map((x, i) => (x + xs[2 * i + 1]) / 2);
  for (let i = 1; i < mids.length; i++) expect(mids[i] - mids[i - 1]).toBeCloseTo(2 * Math.PI, 4);
  expect(sk.ents).toHaveLength(4 * 20 + 4);
  const thin = await bodyOf(await make(0.2));
  near(g.volume - thin.volume, 8 * 20 * 4.5 * 0.2, 0.001, "clearance");
});

test("a bevel gear is two hidden sketches and a straight loft with the frustum volume; a bore is a Hole feature", async () => {
  await fresh();
  const id = await run(() => JS3D.gear({ kind: "bevel", module: 2, teeth: 30, mate: 30, width: 10, clear: 0 }));
  const g = await bodyOf(id);
  expect(g.error).toBeNull();
  const doc = await run(() => JS3D.doc());
  expect(doc.sketches).toHaveLength(2);
  expect(doc.sketches.every((s) => s.hidden)).toBe(true);
  expect(doc.sketches.map((s) => s.name)).toEqual(["Bevel gear 30 teeth m2 big end", "Bevel gear 30 teeth m2 small end"]);
  const node = await run((id) => JS3D.get(id).node, id);
  expect(node).toMatchObject({ t: "loft", ruled: true, closed: false });
  const A = await shoelace(doc.sketches[0].id), s = 2 / 3;
  near(g.volume, (10 * A * (1 + s + s * s)) / 3, 0.001, "frustum");
  expect(g.bbox.min[2]).toBeCloseTo(0, 4);
  expect(g.bbox.max[2]).toBeCloseTo(10, 4);
  const bored = await bodyOf(await run(() => JS3D.gear({ kind: "bevel", module: 2, teeth: 30, mate: 30, width: 10, clear: 0, bore: 6, at: [100, 0, 0] })));
  expect(bored.error).toBeNull();
  near(g.volume - bored.volume, Math.PI * 9 * 10, 0.001, "bore");
  expect(await failure(() => JS3D.gear({ kind: "bevel", module: 2, teeth: 30, width: 11 }))).toBe("width must be a positive number of mm, at most 10 for this bevel gear (a third of the way to the cone's tip)");
});

// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on threaded or bevel shapes (app or runner-speed finding, see the PR notes)
test("a bevel pair placed as the docs say meshes: cutting one from the other removes nothing, and a missed turn does overlap", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on bevel gears");
  // the shared volume is read as "one gear minus (it cut by the other)": an intersect that is empty makes the kernel throw
  await fresh();
  const pair = (turn, op) => run(async ([turn, op]) => {
    await JS3D.newDesign("beginner");
    const a = JS3D.gear({ kind: "bevel", module: 2, teeth: 20, mate: 20 }), b = JS3D.gear({ kind: "bevel", module: 2, teeth: 20, mate: 20 });
    await JS3D.ready();
    const one = JS3D.list()[0].volume;
    JS3D.rotate(b, "z", turn, { about: [0, 0, 0] });
    JS3D.rotate(b, "y", -90, { about: [0, 0, 0] });
    JS3D.move(b, [20, 0, 20]);
    const g = JS3D.group([a, b], { op });
    await JS3D.ready();
    const row = JS3D.list().find((x) => x.id === g);
    return { one, v: row.volume, error: row.error };
  }, [turn, op]);
  // measured 2026-10-21 (one gear 5322.649 mm3): turned 9 degrees the cut removes 0 (an empty intersect throws); turned 0 degrees the
  // two share 59.919 mm3 (27.92 at 4.5 degrees). The meshed loss must be a tenth of the missed overlap, or less
  const meshed = await pair(9, "cut");
  expect(meshed.error).toBeNull();
  const missed = await pair(0, "intersect");
  expect(missed.error).toBeNull();
  expect(missed.v).toBeGreaterThan(50);
  expect(meshed.one - meshed.v).toBeLessThan(missed.v / 10);
});

test("limits: 130 teeth warns, 150 teeth turned bevel is refused with Create off, and every bridge error adds nothing", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await field("ge-teeth", 130);
  await expect(page.locator("#cmd")).toContainText("130 teeth: the gear builds in a few seconds, but its sketch has 2080 lines and is slow to open and edit.");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await field("ge-teeth", 150);
  await kind("Bevel");
  await expect(page.locator("#cmd")).toContainText("teeth must be a whole number from 12 to 90 for a bevel gear");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await field("ge-teeth", 61);
  await expect(page.locator("#cmd")).toContainText("61 teeth: a bevel gear this size takes a few seconds to build");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.click("#cmd button:has-text('Cancel')");

  await fresh();
  const before = await counts();
  const bad = [
    [{ kind: "helical", module: 2, teeth: 20 }, 'kind must be "spur", "bevel" or "rack"'],
    [{ module: 11, teeth: 20 }, "module must be a number from 0.3 to 10 (mm)"],
    [{ module: 2, teeth: 11 }, "teeth must be a whole number from 12 to 200 for a spur gear"],
    [{ module: 2, teeth: 201 }, "teeth must be a whole number from 12 to 200 for a spur gear"],
    [{ kind: "bevel", module: 2, teeth: 91 }, "teeth must be a whole number from 12 to 90 for a bevel gear"],
    [{ kind: "rack", module: 2, teeth: 101 }, "teeth must be a whole number from 2 to 100 for a rack"],
    [{ module: 2, teeth: 20, mate: 20 }, "mate is only for bevel gears"],
    [{ kind: "bevel", module: 2, teeth: 20, mate: 11 }, "mate must be a whole number from 12 to 200 (the partner bevel gear's teeth)"],
    [{ module: 2, teeth: 20, base: 5 }, "base is only for racks"],
    [{ module: 2, teeth: 20, width: 0 }, "width must be a positive number of mm"],
    [{ kind: "rack", module: 2, teeth: 20, bore: 5 }, "bore and keyway are not used for a rack"],
    [{ module: 2, teeth: 20, bore: 36 }, "bore must be 0 (none) or from 1 to 31 mm for this gear (it leaves 2 mm under the teeth)"],
    [{ module: 2, teeth: 20, bore: 5, keyway: true }, "keyway needs a bore from 6 to 58 mm (DIN 6885)"],
    [{ kind: "bevel", module: 2, teeth: 20, bore: 8, keyway: true }, "keyway is for spur gears only"],
    [{ module: 2, teeth: 20, bore: 8, keyway: "yes" }, "keyway must be true or false"],
    [{ module: 2, teeth: 12, bore: 12, keyway: true }, "the keyway does not fit: it must leave 2 mm under the teeth"],
    [{ module: 0.3, teeth: 12, bore: 5 }, "this gear is too small for a bore"],
    [{ kind: "rack", module: 2, teeth: 20, base: 0 }, "base must be a positive number of mm"],
    [{ module: 2, teeth: 20, clear: 0.6 }, "clear must be a number from 0 to 0.5 mm for module 2"],
    [{ module: 0.35, teeth: 20, clear: 0.09 }, "clear must be a number from 0 to 0.087 mm for module 0.35"],
    [{ module: 2, teeth: 20, at: [1, 2] }, "at must be [x, y, z] in mm"],
  ];
  for (const [spec, text] of bad) {
    expect(await failure((s) => JS3D.gear(s), spec), JSON.stringify(spec)).toBe(text);
    expect(await counts(), JSON.stringify(spec)).toEqual(before);
  }
});

test("Beginner: the Gear button opens the dialog and a rack from it is one body on the bed", async () => {
  await fresh();
  await page.click("#bb-gear");
  await expect(page.locator("#cmd")).toContainText("Gear");
  await kind("Rack");
  await expect(page.locator("#cmd")).toContainText("long, tooth pitch");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["Rack 20 teeth m2"]);
  expect(list[0].error).toBeNull();
  expect(list[0].bbox.min[2]).toBeGreaterThanOrEqual(0);
});

// quarantined: STEP export fails in the single file in WebKit ("The I/O read operation failed"), see booleans.spec.mjs
test("the golden design exports to STEP as three true solids", async ({}, info) => {
  quarantine(info, ["single-webkit"], "STEP export fails in the single file in WebKit");
  const json = JSON.parse(readFileSync(new URL("./projects/gears.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list.map((b) => b.name)).toEqual(["Spur gear 18 teeth m2", "Bevel gear 16 teeth m2", "Rack 10 teeth m2"]);
  const { bytes } = await exportBytes(page, "step");
  expect(bytes.length).toBeGreaterThan(50_000);
  const text = bytes.toString("latin1");
  expect(text.startsWith("ISO-10303-21")).toBe(true);
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(3);
});
