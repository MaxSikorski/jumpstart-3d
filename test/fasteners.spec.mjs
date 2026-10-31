// Fasteners (Phase 3 step 1): JS3D.fastener makes a bolt, a nut, a threaded rod or a tap cutter as ordinary bodies built from the
// app's own Thread feature. Volumes are checked in bands (the exact values are in test/golden.json).
// Since J.Siwek 2.8.1.3 the dialog is his Fasteners parts library (fastenerCmd in advanced.js, ids fs-*) with our thread fit on top:
// a print offset per part with the ISO caps, the hand, the turns guard, UNF sizes, a tap cutter, and the F8 spacing. The dialog tests
// below drive that merged dialog; the bridge tests are unchanged.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, exportBytes, quarantine } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";

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
// open Advanced Create > Fasteners from the ribbon
async function openFromRibbon() {
  await page.click("#ad-features");
  await page.click("#ad-fasteners");
  await expect(page.locator("#cmd")).toContainText("Fastener");
}
// pick a part in the dialog; threads: tick or untick Modeled threads (a tap cutter is always threaded)
async function choose({ kind, std = "metric", size, len, threads }) {
  if (kind) await page.selectOption("#fs-kind", kind);
  if (std && (await page.locator("#fs-std").count())) await page.locator("#fs-std button", { hasText: std === "inch" ? "Inch" : "Metric" }).click();
  if (size) await page.selectOption("#fs-size", size);
  if (len !== undefined) await setLength(len);
  if (threads !== undefined && (await page.locator("#fs-threads").count())) await page.locator("#fs-threads").setChecked(threads);
}
const setLength = async (v) => { await page.fill("#fs-len", String(v)); await page.locator("#fs-len").blur(); };

test("Advanced: Create > Advanced Create > Fasteners makes a threaded M8x30 hex bolt in one undo step", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await choose({ kind: "hexbolt", size: "M8", len: 30, threads: true });
  await expect(page.locator("#fs-len")).toHaveValue("30");
  await expect(page.locator("#fs-holes")).toContainText("Holes for M8: clearance 8.8 mm, tap drill 6.75 mm.");
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["Hex bolt M8 x 30 mm"]);
  expect(list[0].error).toBeNull();
  expect(list[0].hole).toBe(false);
  expect(list[0].volume).toBeGreaterThan(1900); // his chamfered hex head over the ISO-threaded shank
  expect(list[0].volume).toBeLessThan(2050);
  // his parts stand on what they are put on: the underside of the head at z = 0, the shank going down
  expect(list[0].bbox.min[2]).toBeCloseTo(-30, 2);
  expect(list[0].bbox.max[2]).toBeCloseTo(5.3, 2);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add fastener");
  // the thread is an ordinary Thread feature on the group
  expect(await run((id) => JS3D.get(id).node.mods.map((m) => m.t), list[0].id)).toEqual(["thread"]);
  await run(() => JS3D.undo());
  expect(await run(() => JS3D.list().length)).toBe(0);
});

test("Advanced: a nut from the dialog has no length row, and its modeled thread is bored at the ISO minor diameter", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await choose({ kind: "nut", size: "M8", threads: true });
  await expect(page.locator("#fs-len")).toHaveCount(0);
  await page.click("#cmd-ok");
  const [nut] = await built();
  expect(nut.name).toBe("Hex nut M8");
  expect(nut.error).toBeNull();
  expect(nut.volume).toBeGreaterThan(550);
  expect(nut.volume).toBeLessThan(760);
  expect(nut.bbox.min[2]).toBeCloseTo(0, 2);
  expect(nut.bbox.max[2]).toBeCloseTo(6.8, 2);
  expect(await run((id) => JS3D.get(id).node.children.filter((c) => c.hole).map((c) => c.node.p.w), nut.id)).toEqual([6.646875]);
});

test("the Fasteners dialog says when the print offset is past what the thread can take (bolt 0.07 pitch, nut 0.15 pitch)", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await choose({ kind: "hexbolt", size: "M3", threads: true });
  await page.selectOption("#fs-clear", "-0.1");
  await expect(page.locator("#cmd")).toContainText("M3: offsets past −0.035 mm make no difference on this bolt");
  await choose({ kind: "nut" });
  await expect(page.locator("#cmd")).toContainText("M3: offsets past −0.075 mm make no difference on this nut or hole");
  await choose({ size: "M8" });
  await expect(page.locator("#cmd")).not.toContainText("make no difference"); // 0.1 is under 0.15 x 1.25
  // without modeled threads there is no thread to fit: no offset or hand rows
  await choose({ threads: false });
  await expect(page.locator("#fs-clear")).toHaveCount(0);
  await expect(page.locator("#fs-hand")).toHaveCount(0);
  await page.click('#cmd button[aria-label="Cancel"]');
});

// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on threaded or bevel shapes (app or runner-speed finding, see the PR notes)
test("rods: M8x30 and 1/4-20x40 build to the expected volume, left hand included", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on threaded shapes");
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
  expect(v(m8)).toBeGreaterThan(1200); // 1229 with the ISO profile (the rod's section is about a circle of the pitch diameter, 7.19)
  expect(v(m8)).toBeLessThan(1260);
  expect(v(inch)).toBeGreaterThan(945); // 974 with the ISO profile
  expect(v(inch)).toBeLessThan(1005);
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
  expect(body.node.p.w).toBeCloseTo(8.375, 3); // the radius grows by the offset, at most 0.15 pitch (0.1875), so the diameter by 0.375
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

// With both ends free the thread's far cut plane sits at length + pitch from where the helix starts: when length / pitch ends in .5
// that plane used to land exactly on a break between two helix edges and the boolean left sliver triangles there.
// quarantined: Firefox stalls on threaded shapes
test("threads whose length is a whole number of pitches plus a half: tapped M5 through 6 mm, M6 rod 24.5 mm; closed STL, no stray volume", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on threaded shapes");
  const stl = async () => meshReport(readStl(Buffer.from(await run(() => JS3D.export("stl")))));
  await fresh();
  const plate = await run(async () => {
    const box = JS3D.add("box", { size: { w: 20, d: 20, h: 6 } });
    const cut = JS3D.fastener({ type: "cutter", size: "M5", length: 6 }); // 6 / 0.8 = 7.5 pitches
    return JS3D.group([box, cut], { name: "Tapped plate" });
  });
  const tapped = await volumeOf(plate);
  expect(tapped).toBeGreaterThan(2400 - Math.PI * 2.5 * 2.5 * 6); // less is removed than a full 5 mm bore
  expect(tapped).toBeLessThan(2400 - Math.PI * 2.1 * 2.1 * 6); // and more than the root circle
  let m = await stl();
  expect(m.open, "open edges in the tapped plate").toBe(0);
  expect(Math.abs(m.volume - tapped) / tapped).toBeLessThan(0.01);
  await fresh();
  const rod = await run(() => JS3D.fastener({ type: "rod", size: "M6", length: 24.5 })); // 24.5 / 1 = 24.5 pitches
  const v = await volumeOf(rod);
  expect(v).toBeGreaterThan(Math.PI * 2.46 * 2.46 * 24.5);
  expect(v).toBeLessThan(Math.PI * 3 * 3 * 24.5);
  m = await stl();
  expect(m.open, "open edges in the rod").toBe(0);
  expect(Math.abs(m.volume - v) / v).toBeLessThan(0.01);
  // a quarter pitch longer lands on no break either way: about the same rod, plus a quarter turn of thread
  await fresh();
  const longer = await volumeOf(await run(() => JS3D.fastener({ type: "rod", size: "M6", length: 24.75 })));
  expect(Math.abs(longer - v) / v).toBeLessThan(0.02);
});

test("the turns guard: a hint at 64 turns, a refusal at 160, and the same refusal from the bridge", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await choose({ kind: "rod", size: "M8", threads: true });
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

// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on threaded or bevel shapes (app or runner-speed finding, see the PR notes)
test("Beginner: the Fasteners button makes a tap cutter standing on the ground; a bolt cannot be ungrouped and stretching it adds a Scale", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on threaded shapes");
  await fresh();
  await page.click("#bb-fastener");
  await choose({ kind: "cutter", size: "M8", len: 30 });
  await expect(page.locator("#fs-threads")).toHaveCount(0); // always threaded
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const [cutter] = await built();
  expect(cutter).toMatchObject({ name: "Tap cutter M8 x 30 mm", hole: true, error: null });
  expect(cutter.bbox.min[2]).toBeCloseTo(0, 2); // never put on a face: it stands on the ground
  expect(cutter.bbox.max[2]).toBeCloseTo(30, 2);
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

// quarantined: STEP export fails in the single file in WebKit ("The I/O read operation failed"), see booleans.spec.mjs; in Firefox the engine stalls on the threads
test("the golden design exports to STEP as true solids, one per part", async ({}, info) => {
  quarantine(info, ["single-webkit", "site-firefox", "single-firefox"], "STEP export fails in the single file in WebKit; Firefox stalls on threaded shapes");
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

test("in inch units the dialog starts in inch sizes and names the part in inches", async () => {
  await fresh();
  await page.click("#unit-toggle"); // inches
  try {
    await run(() => localStorage.removeItem("jumpstart3d.fastener")); // the dialog remembers the last part; start as a new user
    await page.click("#bb-fastener");
    await expect(page.locator("#fs-std button[aria-pressed=true], #fs-std button.on")).toContainText("Inch");
    await expect(page.locator("#fs-size")).toHaveValue('1/4"-20');
    await choose({ kind: "hexbolt", std: "inch", size: '1/4"-20', len: 1, threads: true });
    await expect(page.locator("#fs-holes")).toContainText(" in");
    await page.click("#cmd-ok");
    const [bolt] = await built();
    expect(bolt.name).toBe('Hex bolt 1/4"-20 x 1"');
    expect(bolt.error).toBeNull();
    expect(bolt.bbox.min[2]).toBeCloseTo(-25.4, 2);
    expect(bolt.bbox.max[2]).toBeCloseTo(0.163 * 25.4, 2);
  } finally { await page.click("#unit-toggle"); }
});

test("Beginner: a second Fastener from the dialog starts beside the first one, not on top of it (browser test F8)", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on threaded shapes");
  await fresh("beginner");
  await page.click("#bb-fastener");
  await choose({ kind: "hexbolt", size: "M8", len: 30, threads: true });
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await built();
  await page.click("#bb-fastener");
  await choose({ kind: "nut", size: "M8", threads: true });
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  const bolt = list.find((b) => b.name.startsWith("Hex bolt")), nut = list.find((b) => b.name.startsWith("Hex nut"));
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(bolt).toBeTruthy(); expect(nut).toBeTruthy();
  const overlapXY = bolt.bbox.min[0] < nut.bbox.max[0] && bolt.bbox.max[0] > nut.bbox.min[0] && bolt.bbox.min[1] < nut.bbox.max[1] && bolt.bbox.max[1] > nut.bbox.min[1];
  expect(overlapXY, "the nut sits on the bolt").toBe(false);
  expect(nut.bbox.min[2]).toBeCloseTo(0, 3);
});

test("Beginner: a tap cutter from the dialog stays inside the box at 0,0 and Group cuts it (review of the F8 fix)", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on threaded shapes");
  await fresh("beginner");
  const id = await run(() => JS3D.add("box", { size: { w: 30, d: 30, h: 40 }, at: [0, 0, 0] }));
  await run(() => JS3D.fit()); // the dialog drops the part at the view target: look at the box first
  const before = await volumeOf(id);
  await page.click("#bb-fastener");
  await choose({ kind: "cutter", size: "M8", len: 30 });
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  const cutter = list.find((b) => b.hole);
  // dropped at the view target (his dialog rounds it to 5 mm), inside the box: not pushed aside
  expect(cutter.bbox.min[0]).toBeGreaterThan(-15); expect(cutter.bbox.max[0]).toBeLessThan(15);
  expect(cutter.bbox.min[1]).toBeGreaterThan(-15); expect(cutter.bbox.max[1]).toBeLessThan(15);
  const g = await run(async (ids) => { const g = JS3D.group(ids); await JS3D.ready(); return g; }, [id, cutter.id]);
  expect(await volumeOf(g)).toBeLessThan(before - 300);
});
