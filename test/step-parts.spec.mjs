// STEP import, one body per part (GitHub #173): a STEP file with several parts comes in as one body per part ("<file> part 1" ... "part N"),
// each movable on its own, the whole assembly centred on the plate and resting on it, the view framed on all of them, in ONE undo step.
// A file with a single part still comes in as one plain body; a stalled read says in plain words that it took too long.
// The fixtures are made with the app's own kernel (test/fixtures/make-step-fixtures.mjs):
//   step-assembly-3-parts.step  a 60x40x10 plate with a 4 mm hole, a pin 0.05 mm wider than the hole pressed into it (pi*4.05^2*30 = 1545.9 mm3), and
//                               a 60x40x10 block lying on the plate (24000 mm3); the plate with its hole is 23497.3 mm3; as parts they add up to 49043
//   step-2-touching-cubes.step  two 10 mm cubes that touch face to face
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, newDoc, waitIdle } from "./helpers.mjs";

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
test("the parts survive save and reopen", async () => {
  await fresh("advanced");
  await importFile("three parts.step", fixture("step-assembly-3-parts.step"));
  await whenBuilt(3);
  const want = sorted(await list());
  // saved and reopened: the design's JSON, loaded under new ids so nothing of the old pictures is reused
  const json = await page.evaluate(() => JSON.stringify(window.__store.doc));
  const doc = JSON.parse(json);
  doc.bodies.forEach((b, i) => { b.id = "re" + i; });
  await loadDoc(page, doc);
  const re = await list();
  expect(re).toHaveLength(3);
  expect(re.map((b) => b.error)).toEqual([null, null, null]);
  expect(sorted(re)).toEqual(want);
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

