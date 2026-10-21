// Fasteners (Phase 3 step 1): the Fastener dialog and JS3D.fastener make a bolt, a nut, a threaded rod or a tap cutter as
// ordinary bodies built from the app's own Thread feature. Volumes are checked in bands (the exact values are in test/golden.json).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, exportBytes } from "./helpers.mjs";

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
// build everything, then the list (name, hole, volume, error) as the bridge sees it
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const volumeOf = async (id) => (await built()).find((b) => b.id === id).volume;
const toasts = () => page.locator("#toasts .toast").allInnerTexts();
// open Advanced Create > Fastener from the ribbon
async function openFromRibbon() {
  await page.click("#ad-features");
  await page.click("#ad-fastener");
  await expect(page.locator("#cmd")).toContainText("Fastener");
}
const part = (name) => page.locator("#fa-type button", { hasText: name }).click();
const setLength = async (v) => { await page.fill("#fa-len", String(v)); await page.locator("#fa-len").blur(); };

test("Advanced: Create > Advanced Create > Fastener makes an M8x30 bolt in one undo step", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await expect(page.locator("#fa-size")).toHaveValue("M8");
  await expect(page.locator("#fa-len")).toHaveValue("30");
  await expect(page.locator("#cmd")).toContainText("Hex head 13 mm across flats, 5.3 mm high; the length is measured under the head.");
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["M8×30 bolt"]);
  expect(list[0].error).toBeNull();
  expect(list[0].hole).toBe(false);
  expect(list[0].volume).toBeGreaterThan(2050);
  expect(list[0].volume).toBeLessThan(2140);
  // head down on the bed, 30 under the head plus the 5.3 head
  expect(list[0].bbox.min[2]).toBeCloseTo(0, 3);
  expect(list[0].bbox.max[2]).toBeCloseTo(35.3, 3);
  expect(await run(() => __app.sel)).toEqual([list[0].id]);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add M8×30 bolt");
  // the thread is an ordinary Thread feature on the group
  expect(await run((id) => JS3D.get(id).node.mods.map((m) => m.t), list[0].id)).toEqual(["thread"]);
  await run(() => JS3D.undo());
  expect(await run(() => JS3D.list().length)).toBe(0);
});

test("Advanced: a nut from the dialog has no length row", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await part("Nut");
  await expect(page.locator("#fa-len")).toHaveCount(0);
  await expect(page.locator("#cmd")).toContainText("Hex nut 13 mm across flats, 6.8 mm thick.");
  await page.click("#cmd-ok");
  const [nut] = await built();
  expect(nut.name).toBe("M8 nut");
  expect(nut.error).toBeNull();
  expect(nut.volume).toBeGreaterThan(700);
  expect(nut.volume).toBeLessThan(750);
  expect(nut.bbox.max[2]).toBeCloseTo(6.8, 3);
});

test("rods: M8x30 and 1/4-20x40 build to the expected volume, left hand included", async () => {
  await fresh();
  const [m8, inch, left] = await run(() => [
    JS3D.fastener({ type: "rod", size: "M8", length: 30 }),
    JS3D.fastener({ type: "rod", size: "1/4-20", length: 40, at: [20, 0, 0] }),
    JS3D.fastener({ type: "rod", size: "M8", length: 30, left: true, at: [40, 0, 0] }),
  ]);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list.map((b) => b.name)).toEqual(["M8×30 threaded rod", "1/4-20×40 threaded rod", "M8×30 threaded rod"]);
  const v = (id) => list.find((b) => b.id === id).volume;
  expect(v(m8)).toBeGreaterThan(1290);
  expect(v(m8)).toBeLessThan(1340);
  expect(v(inch)).toBeGreaterThan(1040);
  expect(v(inch)).toBeLessThan(1090);
  expect(Math.abs(v(left) - v(m8)) / v(m8)).toBeLessThan(0.01);
  expect(await run((id) => JS3D.get(id).node.mods[0].left, left)).toBe(true);
  // a left-hand thread is a different shape: same rod, same place, different STL bytes
  const stlHash = (hand) => run(async (left) => {
    await JS3D.newDesign("beginner");
    JS3D.fastener({ type: "rod", size: "M8", length: 30, left });
    await JS3D.ready();
    const u8 = await JS3D.export("stl");
    let h = 2166136261;
    for (let i = 84; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619) >>> 0; // FNV-1a over the triangles
    return h;
  }, hand);
  expect(await stlHash(true)).not.toBe(await stlHash(false));
});

test("a tap cutter is a hole: grouped with a block it cuts a threaded hole, and a print offset widens the hole", async () => {
  await fresh();
  const cutVolume = async (clear) => {
    const id = await run(async (clear) => {
      await JS3D.newDesign("beginner");
      const box = JS3D.add("box", { size: { w: 20, d: 20, h: 20 } });
      const cut = JS3D.fastener({ type: "cutter", size: "M8", length: 20, clear });
      return JS3D.group([box, cut], { name: "Tapped" });
    }, clear);
    return volumeOf(id);
  };
  const plain = await cutVolume(0);
  expect(plain).toBeGreaterThan(8000 - Math.PI * 4 * 4 * 20); // less material is removed than a full 8 mm bore
  expect(plain).toBeLessThan(8000 - Math.PI * 3.233 * 3.233 * 20); // and more than the thread's root circle
  expect(await cutVolume(-0.2)).toBeLessThan(plain);
  // the cutter alone is a hole with no clearance in its thread; the print offset is in its size instead
  await fresh();
  const id = await run(() => JS3D.fastener({ type: "cutter", size: "M8", length: 20, clear: -0.2 }));
  const body = await run((id) => JS3D.get(id), id);
  expect(body.hole).toBe(true);
  expect(body.node.mods[0].clear).toBe(0);
  expect(body.node.p.w).toBeCloseTo(8.8, 3);
});

test("the Thread print offset tool tightens a bolt but leaves a tap cutter as it was made", async () => {
  await fresh("advanced");
  const { bolt, cutter } = await run(() => ({ bolt: JS3D.fastener({ type: "bolt", size: "M8", length: 20 }), cutter: JS3D.fastener({ type: "cutter", size: "M8", length: 20, clear: -0.2, at: [30, 0, 0] }) }));
  // the normal use: a cutter grouped inside a block
  const tapped = await run(() => {
    const box = JS3D.add("box", { size: { w: 20, d: 20, h: 15 }, at: [60, 0, 0] });
    const cut = JS3D.fastener({ type: "cutter", size: "M8", length: 20, clear: -0.2, at: [60, 0, -2.5] });
    return JS3D.group([box, cut], { name: "Tapped block" });
  });
  const before = await volumeOf(cutter);
  const tappedBefore = await volumeOf(tapped);
  await page.click("#ad-features");
  await page.click("#ad-thread-offset");
  await page.selectOption("#to-clear", "-0.3");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await built();
  const clears = await run(([b, c]) => [JS3D.get(b).node.mods[0].clear, JS3D.get(c).node.mods[0].clear], [bolt, cutter]);
  expect(clears).toEqual([-0.3, 0]);
  expect(await volumeOf(cutter)).toBe(before);
  // the cutter inside the group (a hole child) keeps its thread offset of 0, and the group is unchanged
  const child = await run((g) => JS3D.get(g).node.children.filter((c) => c.hole).map((c) => c.node.mods[0].clear), tapped);
  expect(child).toEqual([0]);
  expect(await volumeOf(tapped)).toBe(tappedBefore);
});

test("the turns guard: a hint at 64 turns, a refusal at 160, and the same refusal from the bridge", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await part("Threaded rod");
  await setLength(80);
  await expect(page.locator("#cmd")).toContainText("About 64 turns: this takes several seconds to build, longer on a phone.");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await setLength(200);
  await expect(page.locator("#cmd")).toContainText("Too many turns (160; the most is 150). Make it shorter or pick a larger size.");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.click('#cmd button[aria-label="Cancel"]');
  expect(await run(() => JS3D.list().length)).toBe(0);
  const too = "Too many turns (160; the most is 150). Make it shorter or pick a larger size.";
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 200 }))).toBe(too);
  expect(await failure(() => JS3D.fastener({ type: "bolt", size: "M8", length: 200 }))).toBe(too);
  expect(await run(() => JS3D.list().length)).toBe(0);
});

test("JS3D.fastener refuses bad input with plain messages and adds nothing", async () => {
  await fresh();
  expect(await failure(() => JS3D.fastener(null))).toBe('type must be "bolt", "nut", "rod" or "cutter"');
  expect(await failure(() => JS3D.fastener({ type: "screw", size: "M8", length: 20 }))).toBe('type must be "bolt", "nut", "rod" or "cutter"');
  expect(await failure(() => JS3D.fastener())).toBe('type must be "bolt", "nut", "rod" or "cutter"');
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M7", length: 20 }))).toMatch(/^unknown size "M7"; sizes: M2\.5, M3, M4, .*, 1\/2-13, 1\/2-20$/);
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "#4-40", length: 20 }))).toMatch(/^unknown size "#4-40"/);
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 3 }))).toBe("length must be a number of at least 3.75 mm for M8");
  expect(await failure(() => JS3D.fastener({ type: "bolt", size: "M8" }))).toBe("length must be a number of at least 3.75 mm for M8");
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 20, clear: 0.2 }))).toBe("clear must be a number from -1 to 0 (mm)");
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 20, clear: -2 }))).toBe("clear must be a number from -1 to 0 (mm)");
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 20, left: "yes" }))).toBe("left must be true or false");
  expect(await failure(() => JS3D.fastener({ type: "rod", size: "M8", length: 20, at: [1, 2] }))).toBe("at must be [x, y, z] in mm");
  // a name that is not text is made into text, as add does
  expect(await run(() => JS3D.list().length)).toBe(0);
  expect(await failure(() => JS3D.fastener({ type: "nut", size: "M3", name: 5 }))).toBeNull();
  expect(await run(() => JS3D.list()[0].name)).toBe("5");
  await fresh();
  // a nut needs no length
  expect(await failure(() => JS3D.fastener({ type: "nut", size: "M3" }))).toBeNull();
  expect(await run(() => JS3D.list().length)).toBe(1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add M3 nut");
});

test("Beginner: the Fastener button makes a cutter at z = 0; a bolt cannot be ungrouped and stretching it adds a Scale", async () => {
  await fresh();
  await page.click("#bb-fastener");
  await part("Tap cutter");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const [cutter] = await built();
  expect(cutter).toMatchObject({ name: "M8×30 tap cutter", hole: true, error: null });
  expect(cutter.position[2]).toBe(0);
  // a bolt is a group with a Thread feature
  await fresh();
  const id = await run(() => { const id = JS3D.fastener({ type: "bolt", size: "M8", length: 30 }); JS3D.select([id]); return id; });
  await built();
  await page.click("#bb-ungroup");
  await expect(page.locator("#toasts .toast", { hasText: "has features" })).toHaveCount(1);
  expect(await run(() => JS3D.list().map((b) => b.kind))).toEqual(["group"]);
  // the size boxes add a Scale after the thread (so the thread is stretched too)
  const before = await volumeOf(id);
  await page.fill("#insp-s2", "70");
  await page.locator("#insp-s2").blur();
  const after = await volumeOf(id);
  expect(await run((id) => JS3D.get(id).node.mods.map((m) => m.t), id)).toEqual(["thread", "scale"]);
  expect(after).toBeGreaterThan(before * 1.5);
});

test("the golden design exports to STEP as true solids, one per part", async () => {
  const json = JSON.parse(readFileSync(new URL("./projects/fasteners.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  const { bytes } = await exportBytes(page, "step");
  expect(bytes.length).toBeGreaterThan(100_000);
  const text = bytes.toString("latin1");
  expect(text.startsWith("ISO-10303-21")).toBe(true);
  // the tap cutter is a hole inside the block's group, so four solids are exported
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(4);
});

test("in inch units the dialog starts at 1/4-20 and 1 inch, and names the part in inches", async () => {
  await fresh();
  await page.click("#unit-toggle"); // inches
  try {
    await page.click("#bb-fastener");
    await expect(page.locator("#fa-size")).toHaveValue("1/4-20");
    await expect(page.locator("#fa-len")).toHaveValue("1");
    await expect(page.locator("#cmd")).toContainText("Hex head 0.4375 in across flats");
    await page.click("#cmd-ok");
    const [bolt] = await built();
    expect(bolt.name).toBe('1/4-20×1" bolt');
    expect(bolt.error).toBeNull();
    expect(bolt.bbox.max[2]).toBeCloseTo(25.4 + 0.172 * 25.4, 2);
  } finally { await page.click("#unit-toggle"); }
});
