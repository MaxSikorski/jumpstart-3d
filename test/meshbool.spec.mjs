// Manifold mesh booleans, through the real app on both builds (the engine and the kernel's rules are in test/meshbool.test.mjs).
// A Join, Cut or Group that involves an imported mesh runs on Manifold: the body's data says meshEngine "manifold", the result is
// closed (the exported STL has no open edge), and it is quick (the Pi-lid ranked fix #3). The plates and tori are made here and
// imported through the real Import button; Max's lid is the committed reference model examples/pi-lid/raspberry-pi-4-case-lid.stl (or JS3D_PILID=<path>). Every timing is logged as a `meshbool-timing:` line.
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, buildOf, watchErrors, loadDoc, newDoc, waitIdle, exportBytes, reload } from "./helpers.mjs";

const lidFile = process.env.JS3D_PILID || fileURLToPath(new URL("../examples/pi-lid/raspberry-pi-4-case-lid.stl", import.meta.url));

let page, errors, requests, info0;
test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  requests = [];
  page.context().on("request", (r) => requests.push(r.url()));
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a)));
const near = (a, b, tol) => expect(Math.abs(a - b), `${a} vs ${b} (±${tol})`).toBeLessThanOrEqual(tol);

// Binary STL: the volume the triangles enclose and how many edges are not shared by exactly two triangles (0 = closed)
// (exact: corners match only when their float32 values are equal; by default they match on a 0.0001 mm grid)
function readStl(buf, exact = false) {
  const n = buf.readUInt32LE(80), ids = new Map(), edges = new Map();
  let volume = 0;
  const vid = (p) => { const k = p.map((v) => (exact ? v : Math.round(v * 10000))).join(","); let i = ids.get(k); if (i === undefined) { i = ids.size; ids.set(k, i); } return i; };
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12, p = [0, 1, 2].map((v) => [0, 1, 2].map((c) => buf.readFloatLE(o + v * 12 + c * 4)));
    volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    const v = p.map(vid);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (a === b) continue;
      const k = a < b ? a + ":" + b : b + ":" + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  return { volume, open: [...edges.values()].filter((c) => c !== 2).length };
}
const stlOf = async (exact) => readStl(bytes(await run(() => JS3D.export("stl"))), exact);
const list = () => run(async () => { await JS3D.ready(60000); return JS3D.list(); });
const engineOf = (id) => run((id) => { const v = window.__app.scene.views.get(id); return v && v.data ? v.data.meshEngine || null : null; }, id);

// the design as an STL made by the app itself: a plate 40 x 30 with a 10 x 6 opening; with `split`, the left half is 2.998 mm high and the right half 3 (as on Max's lid)
async function plateStl(split) {
  await loadDoc(page, newDoc("Meshbool plate", "beginner"));
  return run(async (split) => {
    const parts = split
      ? [JS3D.add("box", { size: { w: 20, d: 30, h: 2.998 }, at: [-10, 0, 0] }), JS3D.add("box", { size: { w: 20, d: 30, h: 3 }, at: [10, 0, 0] })]
      : [JS3D.add("box", { size: { w: 40, d: 30, h: 3 } })];
    const h = JS3D.add("box", { size: { w: 10, d: 6, h: 5 }, at: [0, 0, -1], hole: true });
    await JS3D.ready();
    JS3D.group([...parts, h]);
    await JS3D.ready(60000);
    return Array.from(await JS3D.export("stl"));
  }, split);
}
// import a file through the Import button into a new design; resolves with the one body
async function importFile(name, buffer, expectCount = 1) {
  await loadDoc(page, newDoc("Meshbool import", "beginner"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles({ name, mimeType: "model/stl", buffer });
  await expect.poll(async () => (await list()).length, { timeout: 120_000 }).toBe(expectCount);
  await waitIdle(page, 120_000);
  await run(() => document.getElementById("toasts").replaceChildren());
  const bodies = await list();
  expect(bodies[0].error).toBeNull();
  return bodies[0];
}
// select everything and click the real Group button; resolves with the milliseconds until the one grouped body is drawn
async function groupAll() {
  const ids = (await list()).map((e) => e.id);
  await run((ids) => JS3D.select(ids), ids);
  const t0 = Date.now();
  await page.click("#bb-group");
  await expect.poll(async () => (await list()).length, { timeout: 120_000 }).toBe(1);
  await waitIdle(page, 120_000);
  const ms = Date.now() - t0;
  const after = await list();
  expect(after[0].error).toBeNull();
  return { body: after[0], ms };
}

test("a plate with an opening, a flush box and a real click on Group: done on Manifold, closed, quick, and it survives undo, save, reload, a share link and a hole", async ({ browser }) => {
  test.slow();
  const stl = Buffer.from(await plateStl(true));
  const plate = await importFile("Plate.stl", stl);
  const plateV = 20 * 30 * 2.998 + 20 * 30 * 3 - 5 * 6 * 2.998 - 5 * 6 * 3;
  near(plate.volume, plateV, 0.5);
  // a 14 x 10 x 3 box over the opening: its top is flush with the plate's right half (3) and 0.002 above the left half (2.998); its bottom is flush with the plate's
  await run(() => { JS3D.add("box", { size: { w: 14, d: 10, h: 3 }, at: [0, 0, 0] }); return JS3D.ready(); });
  const wantJoin = plateV + 3 * 140 - (40 * 2.998 + 40 * 3);
  const { body: joined, ms } = await groupAll();
  console.log(`meshbool-timing: ${buildOf(info0)} plate Group ${ms} ms`);
  near(joined.volume, wantJoin, 0.05);
  expect(ms, `Group took ${ms} ms (local target 2 s)`).toBeLessThan(5000);
  expect(await engineOf(joined.id)).toBe("manifold");
  const closed = await stlOf();
  expect(closed.open, "open edges in the exported STL").toBe(0);
  near(closed.volume, wantJoin, 0.05);
  // STEP: the B-rep is built from the Manifold result on demand
  const step = await exportBytes(page, "step");
  expect(step.bytes.length).toBeGreaterThan(2000);
  expect(step.bytes.subarray(0, 20).toString("latin1")).toContain("ISO-10303");
  // undo gives the plate and the box back, redo the joined body again, as a body on Manifold
  await run(() => JS3D.undo());
  await expect.poll(async () => (await list()).length).toBe(2);
  await run(() => JS3D.redo());
  await expect.poll(async () => (await list()).length).toBe(1);
  await waitIdle(page);
  near((await list())[0].volume, wantJoin, 0.05);
  expect(await engineOf((await list())[0].id)).toBe("manifold");
  // save and reload: the design comes back from storage and is built again
  await run(() => window.__app.projects.saveNow());
  await reload(page);
  await waitIdle(page, 120_000);
  const back = await list();
  expect(back).toHaveLength(1);
  near(back[0].volume, wantJoin, 0.05);
  expect(await engineOf(back[0].id)).toBe("manifold");
  // a share link opens the same design in a fresh browser, which builds the same volume
  await page.click("#btn-export");
  await page.click("#btn-share-link");
  await expect(page.locator("#share-copy")).toBeEnabled();
  const link = await page.inputValue("#share-url");
  await page.keyboard.press("Escape");
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  try {
    const other = await ctx.newPage();
    const otherErrors = watchErrors(other);
    await other.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    const frag = link.slice(link.indexOf("#") + 1);
    await other.goto(info0.project.use.baseURL + "#" + frag);
    await other.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await other.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
    await other.waitForFunction(() => window.__app.projects.started === true, null, { timeout: 20_000 });
    await other.click("#share-accept");
    await waitIdle(other, 120_000);
    const theirs = await other.evaluate(async () => { await JS3D.ready(60000); const b = JS3D.list(); return { n: b.length, volume: b[0].volume, error: b[0].error, engine: window.__app.scene.views.get(b[0].id).data.meshEngine }; });
    expect(theirs).toMatchObject({ n: 1, error: null, engine: "manifold" });
    near(theirs.volume, wantJoin, 0.05);
    expect(otherErrors).toEqual([]);
  } finally { await ctx.close(); }
  // a round hole grouped into the joined body: still Manifold, still closed, the right amount smaller
  const hole = await run(() => { const id = JS3D.add("cylinder", { size: { w: 4, d: 4, h: 10 }, at: [-12, 8, -1], hole: true }); return JS3D.ready().then(() => id); });
  expect(hole).toBeTruthy();
  const { body: holed } = await groupAll();
  expect(await engineOf(holed.id)).toBe("manifold");
  near(holed.volume, wantJoin - Math.PI * 4 * 2.998, 0.4);
  const holedStl = await stlOf();
  expect(holedStl.open).toBe(0);
  near(holedStl.volume, holed.volume, 0.05);
  // nothing was asked of the network beyond the site itself (no separate Manifold download either)
  const origin = info0.project.use.baseURL.startsWith("http") ? new URL(info0.project.use.baseURL).origin : null;
  const outside = requests.filter((u) => !(/^(file|data|blob|about):/.test(u) || (origin && new URL(u).origin === origin)));
  expect(outside, "requests that left the page's own origin").toEqual([]);
  expect(requests.filter((u) => /manifold/i.test(new URL(u).pathname.split("/").pop())), "no separate Manifold file").toEqual([]);
});

test("a 10,000-triangle torus with the hole box of issue #199: Cut removes 35.3 % on Manifold", async () => {
  test.slow();
  const nu = 100, nv = 50, R = 30, r = 10, T = [];
  const P = (i, j) => { const u = (i % nu) / nu * 2 * Math.PI, v = (j % nv) / nv * 2 * Math.PI; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]; };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); T.push([a, b, c], [a, c, d]); }
  const stl = Buffer.alloc(84 + 50 * T.length);
  stl.writeUInt32LE(T.length, 80);
  T.forEach((t, k) => t.forEach((p, i) => p.forEach((x, c) => stl.writeFloatLE(x, 84 + 50 * k + 12 + 12 * i + 4 * c))));
  const t0 = Date.now();
  const torus = await importFile("torus10k.stl", stl);
  console.log(`meshbool-timing: ${buildOf(info0)} torus 10k import ${Date.now() - t0} ms`);
  const w = 80 / 3 + 5; // the first third of the x span, 5 mm of margin: repro199.mjs
  await run((w) => { JS3D.add("box", { size: { w, d: 90, h: 30 }, at: [-45 + w / 2, 0, -5], hole: true }); return JS3D.ready(); }, w);
  const { body: cut, ms } = await groupAll();
  console.log(`meshbool-timing: ${buildOf(info0)} torus 10k Cut ${ms} ms`);
  const removed = (1 - cut.volume / torus.volume) * 100;
  expect(Math.abs(removed - 35.3), `${removed.toFixed(2)} % removed`).toBeLessThanOrEqual(0.5);
  expect(await engineOf(cut.id)).toBe("manifold");
  expect(ms).toBeLessThan(5000);
  expect((await stlOf()).open).toBe(0);
});

test("Max's Pi lid: Join a flush fill box, then Cut the opening", async () => {
  test.slow();
  const lid = await importFile("Canakit_Pi_4_case_lid.stl", readFileSync(lidFile));
  expect(lid.error).toBeNull();
  await run(() => { JS3D.add("box", { size: { w: 64, d: 31, h: 3 }, at: [-5.25, 0, 0] }); return JS3D.ready(); });
  const join = await groupAll();
  console.log(`meshbool-timing: ${buildOf(info0)} lid Join ${join.ms} ms`);
  expect(await engineOf(join.body.id)).toBe("manifold");
  near(join.body.volume, 18261.36, 0.1);
  await run(() => { JS3D.add("box", { size: { w: 38, d: 38, h: 5 }, at: [-7.3, 0, -1], hole: true }); return JS3D.ready(); });
  const cut = await groupAll();
  console.log(`meshbool-timing: ${buildOf(info0)} lid Cut ${cut.ms} ms`);
  expect(await engineOf(cut.body.id)).toBe("manifold");
  near(cut.body.volume, 13927.16, 0.1);
  const out = await stlOf();
  expect(out.open, "open edges in the exported STL").toBe(0);
  near(out.volume, 13927.16, 0.1);
  expect(join.ms).toBeLessThan(5000);
  expect(cut.ms).toBeLessThan(5000);
});

test("Max's Pi lid at Fine detail: a thin oval hole stays on Manifold, closed and quick", async () => {
  test.slow();
  const lid = await importFile("Canakit_Pi_4_case_lid.stl", readFileSync(lidFile));
  expect(lid.error).toBeNull();
  await run(() => { JS3D.add("box", { size: { w: 64, d: 31, h: 3 }, at: [-5.25, 0, 0] }); return JS3D.ready(); });
  const join = await groupAll();
  try {
    await run(() => window.__app.setMeshDetail("fine", true));
    await waitIdle(page, 120_000);
    // a 0.01 x 12 mm oval (what a cylinder with d 12 and no width gives); its tip is the sharp curve Manifold used to refuse at Fine
    const hole = await run(async () => { const id = JS3D.add("cylinder", { size: { w: 0.01, d: 12, h: 20 }, at: [-30, 0, -5], hole: true }); await JS3D.ready(); return JS3D.get(id).node.p; });
    expect(hole).toMatchObject({ w: 0.01, d: 12, h: 20 });
    const cut = await groupAll();
    console.log(`meshbool-timing: ${buildOf(info0)} lid Fine oval hole ${cut.ms} ms`);
    expect(await engineOf(cut.body.id)).toBe("manifold");
    // the joined lid is 18261.36 mm3 (test/meshbool.test.mjs, Fine); that test measures the oval removing 0.280 mm3 at x -30, so 18261.08
    near(cut.body.volume, 18261.08, 0.05);
    expect(cut.body.volume).toBeLessThan(join.body.volume);
    // the oval is 0.01 mm wide and its tip is far narrower, so the 0.0001 mm grid would join its two walls: count by exact position
    expect((await stlOf(true)).open, "open edges in the exported STL").toBe(0);
    expect(cut.ms).toBeLessThan(5000);
  } finally {
    await run(() => window.__app.setMeshDetail("normal", true));
    await waitIdle(page, 120_000);
  }
});
