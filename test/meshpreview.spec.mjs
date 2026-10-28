// Mesh preview (src/meshpreview.js): an imported STL / 3MF / OBJ shows in the view at once as a see-through "Preparing…" copy of the file's own
// triangles, while the geometry worker turns it into a solid (about 9 s for a lid, 21 s for 20,000 triangles). The preview is display only: the body
// stays "not built" for every tool until the solid arrives, so nothing done in the meantime may corrupt the design.
// The curved mesh is made here (a closed torus, 200 x 50 = 20,000 triangles, nothing committed). To make the "while preparing" window
// deterministic, the safety tests hold the geometry worker's queue (kernel.pump does nothing until release()): queued work stays queued, so
// nothing is lost or sent twice. The outcome test runs the real build and logs its timings.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, stlTriangles } from "./helpers.mjs";

test.describe.configure({ timeout: 240_000 });

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
  await page.evaluate(() => {
    // test-only helpers, in the page
    window.__t = {
      hold() { window.__app.kernel.pump = () => {}; },
      release() { delete window.__app.kernel.pump; window.__app.kernel.pump(); },
      preview(id) { // what the view shows for a body that is not built yet
        const v = window.__app.scene.views.get(id), p = v && v.preview;
        if (!p) return null;
        const a = p.geometry.attributes.position.array, m = v.group.matrix.elements, s = p.scale.x;
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < a.length; i += 3) {
          const x = a[i] * s, y = a[i + 1] * s, z = a[i + 2] * s;
          for (let c = 0; c < 3; c++) {
            const w = m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c];
            if (w < min[c]) min[c] = w;
            if (w > max[c]) max[c] = w;
          }
        }
        return { tris: a.length / 9, visible: v.group.visible && p.visible, scale: s, min, max, built: !!v.data, indexed: !!p.geometry.index, inert: p.raycast.length === 0, tag: p.userData.meshPreview === true };
      },
      label(id) { // the "Preparing…" tag over it: its text when it is on screen
        const l = document.querySelector(`.vp-label.prep[data-body="${id}"]`);
        const r = l && l.getBoundingClientRect();
        return l && r.width > 0 && getComputedStyle(l).display !== "none" ? l.textContent : null;
      },
      built(id) { // the finished solid's box
        const b = window.__app.scene.bodyTightBox(id);
        return b ? { min: b.min.toArray(), max: b.max.toArray(), tris: window.__app.scene.views.get(id).data.triangles.length / 3 } : null;
      },
      labels: () => document.querySelectorAll(".vp-label.prep").length,
    };
  });
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

// ---- files: a closed torus (R 30, r 10, raised so z >= 0) as a binary STL
function torusTriangles(nu, nv, R = 30, r = 10) {
  const P = (i, j) => { const u = ((i % nu) / nu) * 2 * Math.PI, v = ((j % nv) / nv) * 2 * Math.PI; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r + r * Math.sin(v)]; };
  const T = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); T.push([a, b, c], [a, c, d]); }
  return T;
}
function stl(T) {
  const b = Buffer.alloc(84 + 50 * T.length);
  b.write("torus", 0);
  b.writeUInt32LE(T.length, 80);
  T.forEach((t, k) => t.forEach((p, i) => p.forEach((x, c) => b.writeFloatLE(x, 84 + 50 * k + 12 + 12 * i + 4 * c))));
  return b;
}
const volumeOf = (T) => Math.abs(T.reduce((s, [a, b, c]) => s + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0));
// Every test imports its own torus (R 30, 30.01, ...): the geometry worker keeps what it built, so the same file twice would be instant and show no preview.
// The outcome test and the in-flight test use the big one (200 x 50 = 20,000 triangles, about 20 s to build); the held tests the small one (60 x 30 = 3,600 triangles, a second or two).
const torus = (n, big = false) => { const T = big ? torusTriangles(200, 50, 30 + n * 0.01) : torusTriangles(60, 30, 30 + n * 0.01); return { T, bytes: stl(T) }; };
// the same kind of torus as the app's own packed mesh (u32 vertices, u32 triangles, f32 positions, u32 indices), as a design's stored file
function packedTorus(nu, nv, R, r) {
  const V = [], I = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const u = (i / nu) * 2 * Math.PI, v = (j / nv) * 2 * Math.PI; V.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r + r * Math.sin(v)); }
  const at = (i, j) => (i % nu) * nv + (j % nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1); I.push(a, b, c, a, c, d); }
  const buf = Buffer.alloc(8 + V.length * 4 + I.length * 4);
  buf.writeUInt32LE(V.length / 3, 0); buf.writeUInt32LE(I.length / 3, 4);
  V.forEach((x, k) => buf.writeFloatLE(x, 8 + 4 * k));
  I.forEach((x, k) => buf.writeUInt32LE(x, 8 + V.length * 4 + 4 * k));
  return buf.toString("base64");
}

// ---- helpers
async function fresh(mode = "beginner") {
  await loadDoc(page, newDoc("Preview " + mode, mode)); // an empty design prunes whatever a held test left queued
  await page.evaluate(() => { window.__t.release(); document.getElementById("toasts").replaceChildren(); window.__app.vp.view.target.set(0, 0, 0); });
}
const hold = () => page.evaluate(() => window.__t.hold());
const release = () => page.evaluate(() => window.__t.release());
async function openTorus(n, name = "Torus.stl", big = false) {
  await page.evaluate(({ bytes, name }) => window.__app.advanced.openModelFile(new File([new Uint8Array(bytes)], name, { type: "model/stl" })), { bytes: Array.from(torus(n, big).bytes), name });
  return page.evaluate(() => window.__store.doc.bodies[window.__store.doc.bodies.length - 1].id);
}
const previewOf = (id) => page.evaluate((id) => window.__t.preview(id), id);
const labelOf = (id) => page.evaluate((id) => window.__t.label(id), id);
async function previewShown(id) {
  await page.waitForFunction((id) => !!window.__t.preview(id) && !!window.__t.label(id), id);
}
async function nothingLeft() { // no preview, no tag, no body, no queued work
  await page.waitForFunction(() => window.__t.labels() === 0 && ![...window.__app.scene.views.values()].some((v) => v.preview) && !window.__app.kernel.queue.size && !window.__app.kernel.inflight);
}
const sizeOf = (b) => [0, 1, 2].map((a) => b.max[a] - b.min[a]);
function sameBox(a, b, tol, what = "box") {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(a.min[c] - b.min[c]), `${what} min ${c}`).toBeLessThanOrEqual(tol);
    expect(Math.abs(a.max[c] - b.max[c]), `${what} max ${c}`).toBeLessThanOrEqual(tol);
  }
}

test("a dropped 20,000-triangle mesh shows at once, then becomes the solid; the preview is where the solid ends up", async () => {
  await fresh();
  const r = await page.evaluate(async (bytes) => {
    const app = window.__app, t0 = performance.now(), out = {};
    // when the preview was made (the first frame with it may take longer on a slow software renderer)
    const refresh = app.scene.refresh;
    app.scene.refresh = function () { refresh.call(this); if (out.created === undefined && [...this.views.values()].some((v) => v.preview)) out.created = performance.now() - t0; };
    const done = app.advanced.openModelFile(new File([new Uint8Array(bytes)], "Torus.stl", { type: "model/stl" }));
    await new Promise((resolve, reject) => {
      const tick = setInterval(() => {
        const b = window.__store.doc.bodies[0];
        if (!b) return;
        const v = app.scene.views.get(b.id);
        out.id = b.id;
        const p = window.__t.preview(b.id);
        if (p && out.preview === undefined) { out.preview = performance.now() - t0; out.previewInfo = p; }
        if (p && out.label === undefined && window.__t.label(b.id)) out.label = performance.now() - t0;
        if (v && v.data) { out.solid = performance.now() - t0; clearInterval(tick); resolve(); }
        else if (performance.now() - t0 > 150000) { clearInterval(tick); reject(new Error("never built")); }
      }, 5);
    });
    await done;
    app.scene.refresh = refresh;
    return out;
  }, Array.from(torus(0, true).bytes));
  console.log(`mesh preview timings (ms): made ${Math.round(r.created)}, seen ${Math.round(r.preview)}, label ${Math.round(r.label)}, solid ${Math.round(r.solid)}`);
  // made = the preview exists; seen = the page could answer again (the first frame with a new shader and 20,000 see-through triangles takes about a second in the software renderer)
  expect(r.created, "the preview is made well under a second after the drop").toBeLessThan(1500);
  expect(r.preview, "and on screen with the first frame").toBeLessThan(3000);
  expect(r.label, "with its tag").toBeLessThan(3000);
  expect(r.preview).toBeLessThanOrEqual(r.solid);
  expect(r.previewInfo.tris).toBe(20000);
  expect(r.previewInfo.visible).toBe(true);
  expect(r.previewInfo.built, "the body counts as not built while only the preview shows").toBe(false);
  expect(r.previewInfo.indexed, "flat shading: not indexed").toBe(false);
  expect(r.previewInfo.tag).toBe(true);
  expect(r.previewInfo.inert, "never takes a click").toBe(true);
  // built: preview and tag are gone, and the solid fills the box the preview showed
  await page.waitForFunction(() => window.__t.labels() === 0 && !window.__app.scene.views.get(window.__store.doc.bodies[0].id).preview);
  const built = await page.evaluate((id) => window.__t.built(id), r.id);
  sameBox(r.previewInfo, built, 0.05, "preview vs solid");
  expect(await previewOf(r.id)).toBeNull();
  expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
});

test("units 'in' while preparing: the preview grows 25.4 times at once; the solid arrives that size", async () => {
  await fresh();
  await hold();
  const id = await openTorus(1);
  await previewShown(id);
  const mm = await previewOf(id);
  expect(mm.scale).toBe(1);
  expect(mm.min[2], "resting on the plate").toBeCloseTo(0, 3);
  expect((mm.min[0] + mm.max[0]) / 2, "centred").toBeCloseTo(0, 3);
  await page.locator('#toasts .imp-toast [data-unit="in"]').click();
  await page.waitForFunction((id) => window.__t.preview(id)?.scale === 25.4, id);
  const big = await previewOf(id);
  for (let c = 0; c < 3; c++) expect(big.max[c] - big.min[c]).toBeCloseTo((mm.max[c] - mm.min[c]) * 25.4, 2);
  expect(await page.evaluate(() => window.__app.scene.views.get(window.__store.doc.bodies[0].id).data), "still not built").toBeNull();
  await release();
  await waitIdle(page);
  const built = await page.evaluate((id) => window.__t.built(id), id);
  sameBox(big, built, 0.1, "preview vs solid");
  expect(sizeOf(built)[0]).toBeCloseTo((mm.max[0] - mm.min[0]) * 25.4, 0);
  await nothingLeft();
  expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
});

for (const [title, undo] of [["Undo", true], ["delete", false]]) {
  test(`${title} while preparing: body, preview and tag go; the solid is never built`, async () => {
    await fresh();
    await hold();
    const id = await openTorus(2);
    await previewShown(id);
    await page.evaluate(({ id, undo }) => { if (undo) window.JS3D.undo(); else window.JS3D.remove([id]); }, { id, undo });
    await nothingLeft();
    expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
    expect(await page.evaluate((id) => window.__app.scene.views.has(id), id)).toBe(false);
    await release();
    await waitIdle(page);
    expect(await page.evaluate(() => window.__store.doc.bodies.length), "still no body after the release").toBe(0);
    expect(await page.evaluate(() => window.__app.kernel.queue.size + (window.__app.kernel.inflight ? 1 : 0))).toBe(0);
    expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
    expect(await page.evaluate(() => window.__t.labels())).toBe(0);
  });
}

test("a move while preparing: the preview moves 20 mm at once; the solid lands there", async () => {
  await fresh();
  await hold();
  const id = await openTorus(3);
  await previewShown(id);
  const a = await previewOf(id);
  await page.evaluate((id) => window.JS3D.move([id], [20, 0, 0]), id);
  await page.waitForFunction(({ id, x }) => Math.abs(window.__t.preview(id).min[0] - x) < 1e-3, { id, x: a.min[0] + 20 });
  const b = await previewOf(id);
  for (let c = 0; c < 3; c++) {
    expect(b.min[c]).toBeCloseTo(a.min[c] + (c === 0 ? 20 : 0), 3);
    expect(b.max[c]).toBeCloseTo(a.max[c] + (c === 0 ? 20 : 0), 3);
  }
  await release();
  await waitIdle(page);
  sameBox(b, await page.evaluate((id) => window.__t.built(id), id), 0.05, "moved preview vs solid");
  expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
});

test("Group while preparing waits for the solid and gives one body, bigger than the torus alone", async () => {
  await fresh();
  await hold();
  const id = await openTorus(4);
  await previewShown(id);
  const boxId = await page.evaluate(() => window.JS3D.add("box", { size: [10, 10, 10], at: [40, 0, 5] }));
  await page.evaluate(({ a, b }) => window.__app.select([a, b]), { a: id, b: boxId });
  await page.keyboard.press("Control+g");
  await page.waitForFunction(() => window.__app.scene.holdBusy > 0); // staging the group; it needs the solids
  await release();
  await page.waitForFunction(() => !window.__app.scene.holdBusy && !window.__app.kernel.inflight && !window.__app.kernel.queue.size, null, { timeout: 200_000 });
  await waitIdle(page);
  const list = await page.evaluate(() => window.__store.doc.bodies.map((b) => ({ node: b.node.t, vol: window.__app.scene.views.get(b.id).data.volume, err: window.__app.scene.errors.get(b.id) || null })));
  expect(list, "one body, a group").toHaveLength(1);
  expect(list[0].node).toBe("group");
  expect(list[0].err).toBeNull();
  expect(list[0].vol, "more than the torus alone").toBeGreaterThan(volumeOf(torus(4).T) + 100);
  await nothingLeft();
});

test("Export while preparing says 'Still building' and downloads the solid once it is built", async () => {
  await fresh();
  await hold();
  const id = await openTorus(5);
  await previewShown(id);
  const download = page.waitForEvent("download", { timeout: 200_000 });
  await page.click("#btn-export");
  await page.click('#menu-export button[data-act="stl"]');
  await expect(page.locator("#toasts .toast", { hasText: "Still building" })).toBeVisible();
  expect(await page.evaluate(() => window.__app.scene.views.get(window.__store.doc.bodies[0].id).data), "nothing was exported from the preview").toBeNull();
  await release();
  const dl = await download;
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  const built = await page.evaluate((id) => window.__t.built(id), id);
  expect(built, "built when the file arrived").not.toBeNull();
  expect(stlTriangles(bytes)).toBe(built.tris);
  expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
});

test("reopening a design with an imported mesh shows the preview before the solid is built", async () => {
  await fresh();
  await hold();
  const doc = newDoc("Reopen", "beginner", { assets: { atestreopen1: { kind: "mesh", name: "Ring", data: packedTorus(60, 30, 31, 9) } } });
  doc.bodies.push({ id: "b_ring", name: "Ring", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 25, 0, 0, 1], node: { t: "mesh", asset: "atestreopen1", mods: [] } });
  await page.evaluate((doc) => { window.__store.load(doc); window.__app.setMode("beginner", true); window.__app.select([]); }, doc);
  await previewShown("b_ring");
  const p = await previewOf("b_ring");
  expect(p.tris).toBe(3600);
  expect((p.min[0] + p.max[0]) / 2, "centred on the plate, then moved by the body's own place").toBeCloseTo(25, 2);
  expect(p.min[2]).toBeCloseTo(0, 3);
  await release();
  await waitIdle(page);
  sameBox(p, await page.evaluate(() => window.__t.built("b_ring")), 0.05, "preview vs solid");
  await nothingLeft();
  expect(await page.evaluate(() => window.__app.scene.errors.size)).toBe(0);
});

test("a mesh body with a feature on it, and a STEP import, get no preview", async () => {
  await fresh("advanced");
  await hold();
  const asset = packedTorus(60, 30, 31, 9);
  const doc = newDoc("NoPreview", "advanced", { assets: { atestplain1: { kind: "mesh", name: "Ring", data: asset }, atestplain2: { kind: "step", name: "Part", data: Buffer.from("ISO-10303-21;\nEND-ISO-10303-21;\n").toString("base64") } } });
  const m = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
  const mk = (id, x, node) => ({ id, name: id, seq: 1, color: "#3b82c4", hole: false, hidden: false, m: m(x), node });
  doc.bodies.push(
    mk("b_plain", 0, { t: "mesh", asset: "atestplain1", mods: [] }),
    mk("b_mods", 100, { t: "mesh", asset: "atestplain1", mods: [{ t: "scale", k: [1, 1, 2], o: [0, 0, 0] }] }),
    mk("b_step", 200, { t: "step", asset: "atestplain2", mods: [] }));
  await page.evaluate((doc) => { window.__store.load(doc); window.__app.setMode("advanced", true); window.__app.select([]); }, doc);
  await previewShown("b_plain"); // the plain one is drawn, so the others had their chance too
  expect(await previewOf("b_mods")).toBeNull();
  expect(await previewOf("b_step")).toBeNull();
  expect(await page.evaluate(() => window.__t.labels())).toBe(1);
  await fresh(); // loads an empty design: the held work is dropped, never built
});

test("a damaged mesh file has no preview and breaks nothing; a good one next to it still previews", async () => {
  await fresh();
  await hold();
  const header = (nv, nt, floats, idx) => { const b = Buffer.alloc(8 + floats.length * 4 + idx.length * 4); b.writeUInt32LE(nv, 0); b.writeUInt32LE(nt, 4); floats.forEach((x, k) => b.writeFloatLE(x, 8 + 4 * k)); idx.forEach((x, k) => b.writeUInt32LE(x, 8 + floats.length * 4 + 4 * k)); return b.toString("base64"); };
  const tri = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const assets = {
    atestbadgood: { kind: "mesh", name: "Good", data: packedTorus(60, 30, 32, 9) },
    atestbadcut: { kind: "mesh", name: "Cut", data: "AAAAAA==" }, // four bytes: not even a header
    atestbadlong: { kind: "mesh", name: "Long", data: header(3, 5000, tri, [0, 1, 2]) }, // the header promises more triangles than the file holds
    atestbadindex: { kind: "mesh", name: "Index", data: header(3, 1, tri, [0, 1, 7]) }, // a corner that does not exist
  };
  const doc = newDoc("Damaged", "beginner", { assets });
  const m = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
  [["b_good", "atestbadgood"], ["b_cut", "atestbadcut"], ["b_long", "atestbadlong"], ["b_index", "atestbadindex"]].forEach(([id, asset], i) =>
    doc.bodies.push({ id, name: id, seq: i + 1, color: "#3b82c4", hole: false, hidden: false, m: m(i * 100), node: { t: "mesh", asset, mods: [] } }));
  await page.evaluate((doc) => { window.__store.load(doc); window.__app.setMode("beginner", true); window.__app.select([]); }, doc);
  await previewShown("b_good");
  // a few more refreshes (hover, select) must not retry or throw
  await page.evaluate(() => { window.__app.select(["b_cut"]); window.__app.select(["b_good"]); window.__app.select([]); });
  for (const id of ["b_cut", "b_long", "b_index"]) expect(await previewOf(id), id).toBeNull();
  expect(await page.evaluate(() => window.__t.labels())).toBe(1);
  expect((await previewOf("b_good")).tris).toBe(3600);
  // the same body id switching damaged -> good -> damaged file (designs reloaded while the worker waits): the damaged one never shows the good one's preview
  const swap = (asset) => { const d = newDoc("Swap", "beginner", { assets }); d.bodies.push({ id: "b_swap", name: "Swap", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: m(0), node: { t: "mesh", asset, mods: [] } }); return d; };
  const load = (d) => page.evaluate((d) => { window.__store.load(d); window.__app.setMode("beginner", true); window.__app.select([]); }, d);
  await load(swap("atestbadcut"));
  expect(await previewOf("b_swap")).toBeNull();
  await load(swap("atestbadgood"));
  await previewShown("b_swap");
  await load(swap("atestbadcut"));
  await page.waitForFunction(() => window.__t.labels() === 0);
  expect(await previewOf("b_swap"), "no stale preview of the other file").toBeNull();
  await fresh(); // an empty design: no preview and no tag is left, and the held work is dropped
  expect(await page.evaluate(() => [...window.__app.scene.views.values()].filter((v) => v.preview).length + window.__t.labels())).toBe(0);
});

test("the Preparing tag is not drawn over the Architect floor plan, and comes back with Beginner", async () => {
  await fresh();
  await hold();
  const id = await openTorus(7);
  await previewShown(id);
  await page.evaluate(() => window.JS3D.setMode("arch"));
  await page.waitForFunction(() => window.__app.scene.root.visible === false);
  await page.waitForFunction(() => window.__t.labels() === 0);
  await page.evaluate(() => window.JS3D.setMode("beginner"));
  await page.waitForFunction((id) => !!window.__t.label(id), id);
  await fresh();
});

test("Undo while the solid is already being built: nothing is left, and the late answer harms nothing", async () => {
  await fresh();
  const id = await openTorus(6, "Late.stl", true);
  await previewShown(id);
  await page.waitForFunction(() => !!window.__app.kernel.inflight, null, { timeout: 5000 }); // the worker has the job
  await page.evaluate(() => window.JS3D.undo());
  await page.waitForFunction(() => window.__t.labels() === 0 && ![...window.__app.scene.views.values()].some((v) => v.preview) && window.__store.doc.bodies.length === 0);
  expect(await page.evaluate((id) => window.__app.scene.views.has(id), id), "the view is gone at once").toBe(false);
  expect(await page.evaluate(() => !!window.__app.kernel.inflight), "the worker is still busy with the undone body").toBe(true);
  await nothingLeft(); // waits for the late reply
  expect(await page.evaluate(() => window.__store.doc.bodies.length + window.__app.scene.views.size + window.__app.scene.errors.size)).toBe(0);
  // and the app builds normally afterwards
  const next = await openTorus(8, "After.stl");
  await waitIdle(page);
  expect(await page.evaluate((id) => !!window.__app.scene.views.get(id).data && !window.__app.scene.errors.has(id), next)).toBe(true);
  await nothingLeft();
});
