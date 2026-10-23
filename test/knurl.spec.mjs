// Knurled knobs (Phase 3 step 4b): the Knurled knob dialog and JS3D.knurl make a cylinder with straight V grooves and an optional
// round, hex or D bore as one hidden sketch and one Extrude. The oracle is independent of the app: the area of the grooved outline
// is N * R * r * sin(pi / N) (N teeth, each two triangles from the centre), a second check shoelaces the sketch's own points, and the
// bore areas are the textbook formulas.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, exportBytes, quarantine } from "./helpers.mjs";

// the polygon area of a knob and its bore, for the numbers the spec gives
function formula({ diameter = 20, length = 15, grooves, depth, bore = "none", boreSize }) {
  const R = diameter / 2, N = grooves ?? Math.min(120, Math.max(8, Math.round(Math.PI * diameter)));
  const d = depth ?? Math.round((Math.PI * diameter / N / 2) * 1000) / 1000, r = R - d;
  let area = N * R * r * Math.sin(Math.PI / N), cut = 0;
  const bs = boreSize ?? { round: 5, hex: 8, d: 5 }[bore];
  if (bore === "round") cut = Math.PI * (bs / 2) ** 2;
  else if (bore === "hex") cut = Math.sqrt(3) / 2 * bs * bs;
  else if (bore === "d") { const rr = bs / 2, h = 0.4 * bs; cut = Math.PI * rr * rr - (rr * rr * Math.acos(h / rr) - h * Math.sqrt(rr * rr - h * h)); }
  return { R, N, d, r, outer: area, area: area - cut, volume: (area - cut) * length };
}

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = (mode = "beginner") => run((m) => JS3D.newDesign(m), mode);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const counts = () => run(() => ({ bodies: JS3D.doc().bodies.length, sketches: JS3D.doc().sketches.length, undo: __store.undoStack.length }));
const near = (got, want, rel, what) => expect(Math.abs(got - want) / Math.abs(want), `${what}: ${got} vs ${want}`).toBeLessThan(rel);
const field = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };
const sketchOf = (id) => run((id) => { const d = JS3D.doc(), b = d.bodies.find((x) => x.id === id); return d.sketches.find((s) => s.id === b.node.sketch); }, id);

// radii and the shoelace area of the outline: the first 2N points of the sketch, in order
function outline(sk, N) {
  const pts = sk.pts.slice(0, 2 * N);
  const radii = pts.map((p) => Math.hypot(p.x, p.y));
  const shoelace = Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p.x * q.y - q.x * p.y) / 2; }, 0));
  return { radii, shoelace };
}

test("Advanced: Create > Advanced Create > Knurled knob makes the default knob in one undo step", async () => {
  await fresh("advanced");
  await page.click("#ad-features");
  await page.click("#ad-knurl");
  await expect(page.locator("#cmd")).toContainText("Knurled knob");
  const f = formula({ bore: "round", grooves: 60 });
  await expect(page.locator("#cmd")).toContainText(`60 grooves, 1.047 mm apart, ${f.d} mm deep; the root is ${Math.round(2 * f.r * 1000) / 1000} mm across.`);
  await expect(page.locator("#cmd")).toContainText("For a diamond pattern use Texture");
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list.map((b) => b.name)).toEqual(["Knurled knob 20 x 15"]);
  const knob = list[0];
  near(knob.volume, f.volume, 0.001, "knob volume");
  const sk = await sketchOf(knob.id);
  expect(sk.hidden).toBe(true);
  expect([sk.ents.filter((e) => e.t === "line").length, sk.ents.filter((e) => e.t === "circle").length]).toEqual([120, 1]);
  expect(knob.bbox.min[2]).toBeCloseTo(0, 4);
  expect(knob.bbox.max[2]).toBeCloseTo(15, 4);
  expect(knob.bbox.max[0] - knob.bbox.min[0]).toBeGreaterThan(19.9);
  expect(knob.bbox.max[0] - knob.bbox.min[0]).toBeLessThanOrEqual(20 + 1e-6);
  expect(await run(() => __app.sel)).toEqual([knob.id]);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add Knurled knob 20 x 15");
  await run(() => JS3D.undo());
  expect(await counts()).toMatchObject({ bodies: 0, sketches: 0 });
});

test("each bore type: volume equals grooved outline x length minus the bore, tip count is the groove count, the bounds hold", async () => {
  await fresh();
  const cases = [
    { diameter: 20, length: 15 },
    { diameter: 20, length: 15, bore: "round", boreSize: 5 },
    { diameter: 30, length: 10, grooves: 90, bore: "hex", boreSize: 10 },
    { diameter: 12, length: 8, grooves: 24, depth: 0.6, bore: "d", boreSize: 5 },
    { diameter: 40, length: 20, grooves: 120, bore: "round" },
  ];
  const ids = await run((cs) => cs.map((c, i) => JS3D.knurl({ ...c, at: [i * 50, 0, 0] })), cases);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  for (const [i, c] of cases.entries()) {
    const f = formula(c), b = list.find((x) => x.id === ids[i]), sk = await sketchOf(ids[i]), o = outline(sk, f.N);
    const label = JSON.stringify(c);
    near(b.volume, f.volume, 0.001, label + " volume");
    near(o.shoelace, f.outer, 1e-5, label + " shoelace of the sketch");
    expect(o.radii.filter((r) => Math.abs(r - f.R) < 1e-4), label + " tip vertices").toHaveLength(f.N);
    expect(o.radii.filter((r) => Math.abs(r - f.r) < 1e-4), label + " root vertices").toHaveLength(f.N);
    expect(sk.ents.filter((e) => e.t === "line").length, label + " lines").toBe(2 * f.N + (c.bore === "hex" ? 6 : c.bore === "d" ? 1 : 0));
    expect(b.volume).toBeLessThan(Math.PI * f.R ** 2 * (c.length ?? 15));
    // the solid cylinder to the roots is inside the knob, except for what the bore takes out
    const boreCut = f.outer - f.area;
    expect(b.volume + boreCut * (c.length ?? 15)).toBeGreaterThan(Math.PI * f.r ** 2 * (c.length ?? 15));
    expect(b.bbox.min[0] - i * 50).toBeGreaterThan(-f.R - 1e-6);
    expect(b.bbox.max[0] - i * 50).toBeLessThanOrEqual(f.R + 1e-6);
  }
  // a hex bore across flats 10 and a D bore with its flat on +x, read from the sketch
  const hex = await sketchOf(ids[2]);
  const hexPts = hex.pts.slice(180);
  expect(hexPts).toHaveLength(6);
  expect(hexPts.every((p) => Math.abs(Math.hypot(p.x, p.y) - 10 / Math.sqrt(3)) < 1e-5)).toBe(true);
  const d = await sketchOf(ids[3]);
  expect(d.ents.filter((e) => e.t === "arc")).toHaveLength(1);
  const flat = d.pts.slice(48).filter((p) => p.x > 0);
  expect(flat).toHaveLength(2);
  expect(flat.every((p) => Math.abs(p.x - 2) < 1e-6)).toBe(true);
});

test("the knob sits where at says: the axis through x and y, the base at z", async () => {
  await fresh();
  const id = await run(() => JS3D.knurl({ diameter: 16, length: 10, grooves: 40, at: [30, -20, 5], name: "Dial" }));
  const [b] = await built();
  expect(b.name).toBe("Dial");
  expect((b.bbox.min[0] + b.bbox.max[0]) / 2).toBeCloseTo(30, 2);
  expect((b.bbox.min[1] + b.bbox.max[1]) / 2).toBeCloseTo(-20, 1);
  expect(b.bbox.min[2]).toBeCloseTo(5, 4);
  expect(b.bbox.max[2]).toBeCloseTo(15, 4);
  expect(b.id).toBe(id);
});

test("build time: the default knob and 120 grooves", async () => {
  await fresh();
  const time = (spec) => run(async (s) => { const t0 = performance.now(); JS3D.knurl(s); await JS3D.ready(); while (!JS3D.list().every((b) => b.volume > 0)) await new Promise((r) => setTimeout(r, 5)); return Math.round(performance.now() - t0); }, spec);
  const a = await time({ bore: "round" });
  await fresh();
  const b = await time({ diameter: 40, grooves: 120, bore: "round" });
  console.log(`knurl build time: default knob ${a} ms, 120 grooves ${b} ms`);
  expect((await built()).filter((x) => x.error)).toEqual([]);
  expect(b).toBeLessThan(20_000);
});

test("bad input: each bridge error text, and nothing is added", async () => {
  await fresh();
  const before = await counts();
  const bad = [
    [{ diameter: 5 }, "diameter must be a number from 6 to 150 (mm)"],
    [{ diameter: "20" }, "diameter must be a number from 6 to 150 (mm)"],
    [{ length: 0.5 }, "length must be a number from 1 to 200 (mm)"],
    [{ grooves: 7 }, "grooves must be a whole number from 8 to 120"],
    [{ grooves: 121 }, "grooves must be a whole number from 8 to 120"],
    [{ grooves: 30.5 }, "grooves must be a whole number from 8 to 120"],
    [{ depth: 0.05 }, "depth must be a number from 0.1 to 5 mm for this diameter (the grooves can reach at most half way to the middle)"],
    [{ depth: 5.5 }, "depth must be a number from 0.1 to 5 mm for this diameter (the grooves can reach at most half way to the middle)"],
    [{ bore: "square" }, 'bore must be "none", "round", "hex" or "d"'],
    [{ boreSize: 5 }, 'boreSize is only for a bore "round", "hex" or "d"'],
    [{ bore: "none", boreSize: 5 }, 'boreSize is only for a bore "round", "hex" or "d"'],
    [{ grooves: 60, bore: "round", boreSize: 0.5 }, "boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)"],
    [{ grooves: 60, bore: "round", boreSize: 17 }, "boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)"],
    [{ grooves: 60, bore: "hex", boreSize: 15 }, "boreSize must be a number from 1 to 14.68 mm for this knob (it leaves 1 mm under the grooves), measured across flats"],
    [{ grooves: 60, bore: "d", boreSize: 17 }, "boreSize must be a number from 1 to 16.952 mm for this knob (it leaves 1 mm under the grooves)"],
    [{ diameter: 6, depth: 1.5, bore: "hex" }, "this knob is too small for a bore: use a larger diameter, or bore \"none\""],
    [{ at: [0, 0] }, "at must be [x, y, z] in mm"],
  ];
  for (const [spec, text] of bad) {
    expect(await failure((s) => JS3D.knurl(s), spec), JSON.stringify(spec)).toBe(text);
    expect(await counts(), JSON.stringify(spec)).toEqual(before);
  }
});

test("the dialog shows the error, warns about fine grooves, and the Beginner button opens it", async () => {
  await fresh();
  await page.click("#bb-knurl");
  await expect(page.locator("#cmd")).toContainText("Knurled knob");
  await expect(page.locator("#kn-bore-size")).toHaveCount(1);
  await field("kn-bore-size", 17);
  await expect(page.locator("#kn-err")).toContainText("boreSize must be a number from 1 to 16.952 mm");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await field("kn-bore-size", 5);
  await expect(page.locator("#kn-err")).toHaveCount(0);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await expect(page.locator("#cmd")).not.toContainText("finer than most printers");
  await field("kn-n", 100);
  await expect(page.locator("#cmd")).toContainText("Grooves closer than 0.8 mm are finer than most printers can print");
  await field("kn-n", 60);
  await page.locator("#kn-bore button", { hasText: "Hex" }).click();
  await expect(page.locator("#kn-bore-size")).toHaveValue("8");
  await page.locator("#kn-bore button", { hasText: "None" }).click();
  await expect(page.locator("#kn-bore-size")).toHaveCount(0);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  near(list[0].volume, formula({ grooves: 60 }).volume, 0.001, "knob without a bore");
});

test("the golden design is four true solids in a STEP file", async ({}, info) => {
  quarantine(info, ["single-webkit"], "STEP export fails in the single file in WebKit");
  const json = JSON.parse(readFileSync(new URL("./projects/knurl.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list).toHaveLength(4);
  const { bytes: step } = await exportBytes(page, "step");
  const text = step.toString("latin1");
  expect(text.startsWith("ISO-10303-21")).toBe(true);
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(4);
});
