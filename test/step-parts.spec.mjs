// STEP import, one body per part (GitHub #173): a STEP file with several parts comes in as one body per part ("<file> part 1" ... "part N"),
// each movable on its own, the whole assembly centred on the plate and resting on it, the view framed on all of them, in ONE undo step.
// A file with a single part still comes in as one plain body; a stalled read says in plain words that it took too long.
// The fixtures are made with the app's own kernel (test/fixtures/make-step-fixtures.mjs):
//   step-assembly-3-parts.step  a 60x40x10 plate with a 4 mm hole, a pin 0.05 mm wider than the hole pressed into it (pi*4.05^2*30 = 1545.9 mm3), and
//                               a 60x40x10 block lying on the plate (24000 mm3); the plate with its hole is 23497.3 mm3; as parts they add up to 49043
//   step-2-touching-cubes.step  two 10 mm cubes that touch face to face
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, newDoc, body, prim, IDENTITY, quarantine } from "./helpers.mjs";

let page, errors, info0;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(async () => {
  await page.evaluate(() => { delete window.__app.kernel.watchdogMs; });
  expect(errors, "console or page errors").toEqual([]);
});

const fixture = (name) => Array.from(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);
const sorted = (list) => list.map((b) => b.volume).sort((a, b) => a - b);
const THREE_PARTS = [1545.9, 23497.3, 24000];

async function fresh(mode) {
  await loadDoc(page, newDoc("Parts " + mode, mode));
  await page.evaluate(() => { document.getElementById("toasts").replaceChildren(); const v = window.__app.vp.view; v.target.set(0, 0, 0); });
}
// import through the real path (the Import button, a drop and Mesh to STEP all end here)
const importFile = (name, bytes) => page.evaluate(([name, bytes]) => window.__app.advanced.importModel({ name }, new Uint8Array(bytes)), [name, bytes]);
// every one of n bodies has its mesh (or an error) and the kernel has nothing left to do
async function whenBuilt(n, timeout = 90_000) {
  await page.waitForFunction((n) => {
    const a = window.__app, s = a.scene, k = a.kernel;
    if (!k.ready || k.inflight || k.queue.size || s.busy()) return false;
    const bs = window.__store.doc.bodies;
    return bs.length === n && bs.every((b) => { const v = s.views.get(b.id); return v && !v.pending && (v.data || s.errors.has(b.id)); });
  }, n, { timeout });
}
const list = () => page.evaluate(() => window.JS3D.list());
const union = (l) => ({
  min: [0, 1, 2].map((a) => Math.min(...l.map((b) => b.bbox.min[a]))),
  max: [0, 1, 2].map((a) => Math.max(...l.map((b) => b.bbox.max[a]))),
});
const solidCounts = () => page.evaluate(() => window.__store.doc.bodies.map((b) => window.__app.scene.views.get(b.id).data.solidCount));
const toast = (text) => page.locator("#toasts .toast", { hasText: text });

test("three parts come in as three bodies named after the file, centred on the plate and selected", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const l = await list();
  expect(l.map((b) => b.name)).toEqual(["three parts part 1", "three parts part 2", "three parts part 3"]);
  expect(l.map((b) => b.error)).toEqual([null, null, null]);
  expect(await solidCounts()).toEqual([1, 1, 1]);
  const v = sorted(l);
  THREE_PARTS.forEach((want, i) => near(v[i], want));
  const total = v.reduce((a, b) => a + b, 0);
  near(total, 49043, 0.005); // the parts counted one by one; fused they are 48515
  // each part where the file puts it (the plate 0-10, the pin -5 to 25 and the block 10-20 in the file; the assembly rests on Z 0, so all rise by 5)
  const at = (b, x, y, z0, z1, vol) => {
    near(b.volume, vol);
    expect(Math.abs((b.bbox.min[0] + b.bbox.max[0]) / 2), b.name + " centre X").toBeLessThan(0.01);
    expect(Math.abs((b.bbox.min[1] + b.bbox.max[1]) / 2), b.name + " centre Y").toBeLessThan(0.01);
    expect(Math.abs(b.bbox.max[0] - b.bbox.min[0] - x), b.name + " width").toBeLessThan(0.01);
    expect(Math.abs(b.bbox.max[1] - b.bbox.min[1] - y), b.name + " depth").toBeLessThan(0.01);
    expect(Math.abs(b.bbox.min[2] - z0), b.name + " bottom").toBeLessThan(0.01);
    expect(Math.abs(b.bbox.max[2] - z1), b.name + " top").toBeLessThan(0.01);
  };
  at(l[0], 60, 40, 5, 15, 23497.3); // the plate with its hole
  at(l[1], 8.1, 8.1, 0, 30, 1545.9); // the pin
  at(l[2], 60, 40, 15, 25, 24000); // the block
  const u = union(l);
  expect(Math.abs((u.min[0] + u.max[0]) / 2)).toBeLessThan(0.01);
  expect(Math.abs((u.min[1] + u.max[1]) / 2)).toBeLessThan(0.01);
  expect(Math.abs(u.min[2])).toBeLessThan(0.01);
  expect((await page.evaluate(() => window.JS3D.selection())).sort()).toEqual(l.map((b) => b.id).sort());
});

test("one Undo removes every part of the import, and Redo brings them all back", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  await page.evaluate(() => window.JS3D.undo());
  expect((await list()).length, "bodies left after one Undo").toBe(0);
  expect(await page.evaluate(() => Object.keys(window.__store.doc.assets || {}).length), "the design is as before the import").toBe(0);
  await page.evaluate(() => window.JS3D.redo());
  await whenBuilt(3);
  const l = await list();
  expect(l.map((b) => b.error)).toEqual([null, null, null]);
  const v = sorted(l);
  THREE_PARTS.forEach((want, i) => near(v[i], want));
});

test("Beginner: two cubes that touch import as two bodies of 1000 mm3 in different colours", async () => {
  await fresh("beginner");
  await importFile("two cubes.step", fixture("step-2-touching-cubes.step"));
  await whenBuilt(2);
  const l = await list();
  expect(l.map((b) => b.error)).toEqual([null, null]);
  l.forEach((b) => near(b.volume, 1000, 0.001));
  expect(new Set(l.map((b) => b.color)).size, "colours").toBe(2);
});

test("moving one part moves only that part", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const before = await list();
  await page.evaluate((id) => window.JS3D.move([id], [100, 0, 0]), before[1].id);
  await page.evaluate(() => window.JS3D.ready());
  const after = await list();
  expect(after[1].bbox.min[0]).toBeCloseTo(before[1].bbox.min[0] + 100, 2);
  expect(after[0].bbox).toEqual(before[0].bbox);
  expect(after[2].bbox).toEqual(before[2].bbox);
});

// (A share link cannot carry a STEP file: even two small solids are 22 KB, the link holds 4096 characters. The parts' share-link checks are in
// test/sharelink.test.mjs.)
test("the parts survive save and reopen, with the engine started again", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const byName = (l) => Object.fromEntries(l.map((b) => [b.name, { volume: b.volume, bbox: b.bbox }]));
  const want = byName(await list());
  const doc = JSON.parse(await page.evaluate(() => JSON.stringify(window.__store.doc)));
  doc.bodies.forEach((b, i) => { b.id = "re" + i; }); // new ids, as a design read back from storage
  // a new engine that has built nothing: the parts are read from the file again, and each must come out as the part it was
  await page.evaluate(() => { const k = window.__app.kernel; k.worker.terminate(); k.meshes.clear(); k.queue.clear(); k.inflight = null; k.start(); });
  await page.waitForFunction(() => window.__app.kernel.ready, null, { timeout: 90_000 });
  await loadDoc(page, doc);
  const re = await list();
  expect(re).toHaveLength(3);
  expect(re.map((b) => b.error)).toEqual([null, null, null]);
  expect(byName(re)).toEqual(want);
});

test("Beginner: the three parts can be grouped and the group taken apart again", async () => {
  await fresh("beginner");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const want = sorted(await list());
  const ids = (await list()).map((b) => b.id);
  const gid = await page.evaluate((ids) => window.JS3D.group(ids), ids);
  await page.evaluate(() => window.JS3D.ready());
  const g = await list();
  expect(g.map((b) => b.error)).toEqual(g.map(() => null));
  expect(g.some((b) => b.id === gid)).toBe(true);
  await page.evaluate((gid) => window.JS3D.ungroup(gid), gid);
  await page.evaluate(() => window.JS3D.ready());
  const l = await list();
  expect(l).toHaveLength(3);
  expect(l.map((b) => b.error)).toEqual([null, null, null]);
  expect(sorted(l)).toEqual(want);
});

test("a file with one part is one plain body: no parts flag, no piece picker", async () => {
  await fresh("advanced");
  const bytes = await page.evaluate(async () => {
    const id = window.JS3D.add("box", { size: [20, 10, 5], at: [40, 30, 25] });
    const out = await window.JS3D.export("step", { ids: [id] });
    window.JS3D.remove(id);
    return Array.from(out);
  });
  await whenBuilt(0);
  await importFile("one box.step", bytes);
  await whenBuilt(1);
  await page.waitForTimeout(1300); // the import's watcher looks every half second; give it time to (wrongly) split
  await whenBuilt(1);
  const nodes = await page.evaluate(() => window.__store.doc.bodies.map((b) => b.node));
  expect(nodes).toHaveLength(1);
  expect(nodes[0].t).toBe("step");
  expect(nodes[0].parts).toBeUndefined();
  expect(nodes[0].mods).toEqual([]);
  expect((await list())[0].name).toBe("one box 1");
});

test("a view zoomed in and panned far away is framed on all the parts", async () => {
  await fresh("advanced");
  await page.evaluate(() => { const v = window.__app.vp.view; v.target.set(900, 700, 0); v.dist = 60; window.__app.vp.request(); });
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const inView = () => page.evaluate(() => {
    const vp = window.__app.vp, boxes = window.JS3D.list().map((b) => window.__app.scene.bodyTightBox(b.id));
    const V = boxes[0].min.constructor;
    vp.updateCamera(); vp.camera.updateMatrixWorld(true);
    const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min.toArray()[a]))), max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max.toArray()[a])));
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => vp.project(new V(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2])))
      .every(([x, y, z]) => x >= 0 && x <= vp.w && y >= 0 && y <= vp.h && z > -1 && z < 1);
  });
  await expect.poll(inView, { timeout: 20_000 }).toBe(true);
  await page.waitForFunction(() => !window.__app.vp.isMoving());
  expect(await inView()).toBe(true);
});

test("a read that stalls the engine says it took longer than 2 minutes", async () => {
  await fresh("advanced");
  await page.evaluate(() => { window.__app.kernel.watchdogMs = 1; });
  // a file the engine has not read yet in this page (it keeps the result of every file it has built): the same fixture with a few spaces at the end
  await importFile("three parts.step", [...fixture("step-assembly-3-parts.step"), ...Array(7).fill(32)]);
  await expect(toast("took longer than 2 minutes")).toBeVisible({ timeout: 30_000 });
  await expect(toast("Couldn't import three parts")).toBeVisible();
  await page.evaluate(() => { delete window.__app.kernel.watchdogMs; });
  // the app still builds afterwards
  await fresh("advanced");
  await page.waitForFunction(() => window.__app.kernel.ready, null, { timeout: 60_000 });
  await importFile("two cubes.step", fixture("step-2-touching-cubes.step"));
  await whenBuilt(2);
});

// 200 boxes (201 for the limit test) written as one STEP file by the app itself, as step-import.spec's 200-part test does; the design is cleared again
async function boxesFile(count) {
  const side = 15;
  await loadDoc(page, newDoc("many boxes", "advanced", {
    bodies: Array.from({ length: count }, (_, i) => {
      const m = [...IDENTITY]; m[12] = (i % side) * 12; m[13] = Math.floor(i / side) * 12;
      return body("p" + i, "Part " + i, prim("box", { w: 8, d: 8, h: 8 + (i % 5), r: 0, c: 0 }), m);
    }),
  }));
  const bytes = await page.evaluate(async () => Array.from(await window.JS3D.export("step")));
  await fresh("advanced");
  return bytes;
}
const boxVolume = (count) => Array.from({ length: count }, (_, i) => 8 * 8 * (8 + (i % 5))).reduce((a, b) => a + b, 0);

// quarantined: the single file in WebKit cannot read the STEP blob back out of the engine worker (see booleans.spec.mjs)
test("a file with 200 parts splits into 200 bodies that all build", async ({}, info) => {
  quarantine(info, ["single-webkit"], "the single file in WebKit cannot read the STEP blob back out of the engine worker");
  test.setTimeout(300_000);
  const bytes = await boxesFile(200);
  await importFile("two hundred.step", bytes);
  await whenBuilt(200, 240_000);
  const l = await list();
  expect(l.filter((b) => b.error)).toEqual([]);
  expect(l.filter((b) => b.volume === null)).toEqual([]);
  expect(l[0].name).toBe("two hundred part 1");
  expect(l[199].name).toBe("two hundred part 200");
  near(l.reduce((a, b) => a + b.volume, 0), boxVolume(200), 0.002);
  expect(await page.evaluate(() => window.JS3D.selection().length)).toBe(200);
});

test("a file with 201 parts stays one body and says so", async ({}, info) => {
  quarantine(info, ["single-webkit"], "the single file in WebKit cannot read the STEP blob back out of the engine worker");
  test.setTimeout(300_000);
  const bytes = await boxesFile(201);
  await importFile("too many.step", bytes);
  await expect(toast("has 201 parts")).toBeVisible({ timeout: 120_000 });
  await whenBuilt(1);
  const nodes = await page.evaluate(() => window.__store.doc.bodies.map((b) => b.node));
  expect(nodes).toHaveLength(1);
  expect(nodes[0].parts).toBeUndefined();
  expect(nodes[0].mods).toEqual([]);
  expect((await solidCounts())[0]).toBe(201);
});

test("a body moved before its first build still splits, as its own undo step, and the parts keep the move", async () => {
  await fresh("advanced");
  const before = await page.evaluate(async (bytes) => {
    await window.__app.advanced.importModel({ name: "moved.step" }, new Uint8Array(bytes));
    window.__store.update((doc) => { doc.bodies[0].m[12] += 50; }, "Move"); // in the same tick, before anything is built
    return window.__store.doc.bodies.length;
  }, fixture("step-assembly-3-parts.step"));
  expect(before).toBe(1);
  await whenBuilt(3);
  const l = await list();
  const u = union(l);
  expect((u.min[0] + u.max[0]) / 2).toBeCloseTo(50, 1);
  await page.evaluate(() => window.JS3D.undo());
  expect((await list()).length, "one Undo takes the split back").toBe(1);
  await page.evaluate(() => window.JS3D.undo());
  expect((await list()).length, "the second Undo takes the move back").toBe(1);
  await page.evaluate(() => window.JS3D.undo());
  expect((await list()).length, "the third Undo removes the import").toBe(0);
});

test("an open edit is not wiped by the split: it waits for the preview to end", async () => {
  await fresh("advanced");
  const id = await page.evaluate(async (bytes) => {
    await window.__app.advanced.importModel({ name: "waiting.step" }, new Uint8Array(bytes));
    return window.__store.doc.bodies[0].id;
  }, fixture("step-assembly-3-parts.step"));
  await page.evaluate(() => window.__store.setPreview(() => {})); // a drag or an open command holds a preview
  await page.waitForFunction((id) => { const v = window.__app.scene.views.get(id); return !!(v && v.data && !v.pending); }, id, { timeout: 60_000 });
  await page.waitForTimeout(1500); // the import's watcher looks every half second; a split would have cleared the preview by now
  expect(await page.evaluate(() => ({ bodies: window.__store.doc.bodies.length, preview: !!window.__store.preview }))).toEqual({ bodies: 1, preview: true });
  await page.evaluate(() => window.__store.setPreview(null));
  await whenBuilt(3);
  expect((await list()).map((b) => b.error)).toEqual([null, null, null]);
});

test("the split never costs an unrelated undo step when the history is full", async () => {
  await fresh("advanced");
  await page.evaluate(() => { for (let i = 0; i < 119; i++) window.__store.update((d) => { d.name = "Edit " + i; }, "Edit " + i); });
  await importFile("full.step", fixture("step-2-touching-cubes.step"));
  await whenBuilt(2);
  expect(await page.evaluate(() => ({ n: window.__store.undoStack.length, first: window.__store.undoStack[0].label, last: window.__store.undoStack[window.__store.undoStack.length - 1].label }))).toEqual({ n: 120, first: "Edit 0", last: "Import full" });
});

test("the timeline names an import part and explains it; the body keeps its volume", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const before = await list();
  const item = page.locator('.tl-item[aria-label="Part 1 of the file"]');
  await expect(item).toHaveCount(1);
  await item.dblclick();
  await expect(toast("This body is part 1 of 3 of an imported STEP file")).toBeVisible();
  const after = await list();
  expect(after).toHaveLength(3);
  expect(after[0].volume).toBe(before[0].volume);
  // (the refusal to delete the piece selector, "Delete the body instead", is a guard in deleteFeature: no timeline control reaches it for this feature today)
});

test("a design of more than 160 bodies keeps the saved meshes of the body being edited while its preview is open", async () => {
  test.setTimeout(240_000);
  await loadDoc(page, newDoc("many prims", "advanced", { bodies: Array.from({ length: 170 }, (_, i) => {
    const m = [...IDENTITY]; m[12] = (i % 15) * 12; m[13] = Math.floor(i / 15) * 12;
    return body("q" + i, "Q" + i, prim("box", { w: 5 + i * 0.1, d: 5, h: 5, r: 0, c: 0 }), m);
  }) }));
  await whenBuilt(170, 180_000);
  const savedKey = await page.evaluate(() => window.__store.doc.bodies[0]._key);
  expect(savedKey).toBeTruthy();
  // an edit in progress (a command's preview, a drag) shows another version of the first body: its key is new, and the design shown holds 171 results
  await page.evaluate(() => window.__store.setPreview((doc) => { doc.bodies[0].node.p.w += 1; }));
  await page.waitForFunction(() => {
    const k = window.__app.kernel, b = window.__store.view.bodies[0];
    return !!(b._key && k.has(b._key) && !k.inflight && !k.queue.size);
  }, null, { timeout: 60_000 });
  expect(await page.evaluate((k) => ({ saved: window.__app.kernel.has(k), size: window.__app.kernel.meshes.size }), savedKey), "the saved body's mesh (baseOf reads it) while the preview is open").toMatchObject({ saved: true });
  await page.evaluate(() => window.__store.setPreview(null));
  await whenBuilt(170);
  expect(await page.evaluate(() => window.__app.kernel.keepAlso)).toBeNull();
});
