// Box on face (src/facebox.js, Beginner toolbar "Box on face"): click a flat face of any body, drag a rectangle on it with the
// real mouse, see its width and depth live, type exact sizes, pick a height (out of the face, into it, or both ways) and get a
// plain box body sitting exactly on the face, ready for Group. Pi-lid ranked fix #5 (.claude/real-tasks/pi-lid). The plate with
// an opening is made by the app and imported back as an STL, so an imported mesh is covered in CI; Max's own lid
// (examples/pi-lid/raspberry-pi-4-case-lid.stl, or JS3D_PILID=<path>) is committed as a reference model.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, body, prim } from "./helpers.mjs";

const lidFile = process.env.JS3D_PILID || fileURLToPath(new URL("../examples/pi-lid/raspberry-pi-4-case-lid.stl", import.meta.url));

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a)));

// Binary STL: the volume the triangles enclose and how many edges are not shared by exactly two triangles (0 = closed)
function readStl(buf) {
  const n = buf.readUInt32LE(80), ids = new Map(), edges = new Map();
  let volume = 0;
  const vid = (p) => { const k = p.map((v) => Math.round(v * 1000)).join(","); let i = ids.get(k); if (i === undefined) { i = ids.size; ids.set(k, i); } return i; };
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
const stlOf = async (id) => readStl(bytes(await run((id) => JS3D.export("stl", { ids: [id] }), id)));
const list = () => run(async () => { await JS3D.ready(60000); return JS3D.list(); });
const doc = () => run(() => JSON.parse(JSON.stringify(window.__store.doc)));

// camera: look at `target` from azimuth/elevation (degrees) at a distance, no animation
async function look(target, az, el, dist) {
  await run(([t, az, el, dist]) => { const vp = window.__app.vp; Object.assign(vp.view, { az: (az * Math.PI) / 180, el: (el * Math.PI) / 180, dist, roll: 0 }); vp.view.target.set(...t); vp.anim = null; vp.useOrtho = false; vp.render(); }, [target, az, el, dist]);
}
// a world point -> page pixels
const screen = (p) => run((p) => { const vp = window.__app.vp, r = vp.canvas.getBoundingClientRect(); const [x, y] = vp.project(new vp.view.target.constructor(...p)); return [r.left + x, r.top + y]; }, p);
// a real left-button drag between two world points; `during` runs with the button still down
async function drag(from, to, during) {
  const [a, b] = [await screen(from), await screen(to)];
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / 12, a[1] + ((b[1] - a[1]) * i) / 12);
  if (during) await during();
  await page.mouse.up();
}
const liveLabels = () => run(() => [...document.querySelectorAll(".vp-label.fb-dim")].filter((l) => !l.hidden).map((l) => ({ k: l.dataset.k, text: l.textContent.trim() })));
const mm = (v) => new RegExp(`^${v}(\\.0+)? mm$`);
const field = (id) => page.locator("#" + id);
const pickDir = (label) => page.locator("#fb-dir button", { hasText: label }).click();
const boxOf = (id) => run((id) => { const b = window.JS3D.list().find((e) => e.id === id); return { min: b.bbox.min, max: b.bbox.max }; }, id);
const near = (a, b, tol = 1e-3) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const nearAll = (got, want, tol = 1e-3) => want.forEach((w, i) => near(got[i], w, tol));

async function openTool() {
  await page.click("#bb-facebox");
  await expect(page.locator("#cmd h4")).toHaveText("Box on face");
}
// the box the tool added: the one body that was not there before
async function added(before) {
  const now = (await doc()).bodies;
  const fresh = now.filter((b) => !before.includes(b.id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}
async function groupAll() {
  const ids = (await list()).map((e) => e.id);
  await run((ids) => JS3D.select(ids), ids);
  await page.click("#bb-group");
  await waitIdle(page);
  const after = await list();
  expect(after).toHaveLength(1);
  expect(after[0].error).toBeNull();
  return after[0];
}

// A 40 x 30 x 3 plate with a 10 x 6 opening in the middle, made here, exported as STL and imported again through the Import button.
// With `split`, the left half of the top is 2.998 mm high and the right half 3 mm, as on Max's lid.
async function importPlate(split = false) {
  await loadDoc(page, newDoc("Face box plate", "beginner"));
  const stl = await run(async (split) => {
    const parts = split
      ? [JS3D.add("box", { size: { w: 20, d: 30, h: 2.998 }, at: [-10, 0, 0] }), JS3D.add("box", { size: { w: 20, d: 30, h: 3 }, at: [10, 0, 0] })]
      : [JS3D.add("box", { size: { w: 40, d: 30, h: 3 } })];
    const h = JS3D.add("box", { size: { w: 10, d: 6, h: 5 }, at: [0, 0, -1], hole: true });
    await JS3D.ready();
    JS3D.group([...parts, h]);
    await JS3D.ready(60000);
    return Array.from(await JS3D.export("stl"));
  }, split);
  await loadDoc(page, newDoc("Face box import", "beginner"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles({ name: "Plate.stl", mimeType: "model/stl", buffer: Buffer.from(stl) });
  await expect.poll(async () => (await list()).length, { timeout: 60_000 }).toBe(1);
  await waitIdle(page);
  await run(() => document.getElementById("toasts").replaceChildren());
  const [plate] = await list();
  expect(plate.error).toBeNull();
  near(plate.volume, split ? 20 * 30 * 2.998 + 20 * 30 * 3 - 5 * 6 * 2.998 - 5 * 6 * 3 : 40 * 30 * 3 - 10 * 6 * 3, 0.5);
  return plate;
}

test("drag on an imported plate, sizes live, Into face takes the plate's thickness, and Group fills the opening closed", async () => {
  const plate = await importPlate();
  nearAll([plate.bbox.min[2], plate.bbox.max[2]], [0, 3]);
  await look([0, 0, 1.5], 30, 55, 90);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag([-8, -5, 3], [8, 5, 3], async () => {
    const labels = await liveLabels();
    expect(labels.find((l) => l.k === "w")?.text).toMatch(mm(16));
    expect(labels.find((l) => l.k === "d")?.text).toMatch(mm(10));
  });
  await expect(field("fb-w")).toHaveValue(/^16(\.0+)?$/);
  await expect(field("fb-d")).toHaveValue(/^10(\.0+)?$/);
  await expect(field("fb-h")).toHaveValue(/^10(\.0+)?$/); // the default: 10 mm out of the face
  await pickDir("Into");
  await expect(field("fb-h")).toHaveValue(/^3(\.0+)?$/); // down to the plate's other side
  const undoBefore = await run(() => window.__store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  expect(await run(() => window.__store.undoStack.length)).toBe(undoBefore + 1); // one undo step
  const box = await added(before);
  expect(box.node).toMatchObject({ t: "prim", kind: "box", p: { w: 16, d: 10, h: 3 } });
  expect(box.hole).toBe(false);
  expect(await run(() => JS3D.selection())).toEqual([box.id]); // selected, ready for Group
  const bb = await boxOf(box.id);
  nearAll(bb.min, [-8, -5, 0], 1e-4); // exactly flush with both faces of the plate
  nearAll(bb.max, [8, 5, 3], 1e-4);

  const joined = await groupAll();
  near(joined.volume, 40 * 30 * 3, 0.5); // the opening is filled
  const m = await stlOf(joined.id);
  expect(m.open, "open or non-manifold edges in the joined STL").toBe(0);
  near(m.volume, 3600, 1);
});

test("faces at nearly the same level (2.998 and 3 mm): the box takes the outermost, so Group stays closed", async () => {
  await importPlate(true);
  await look([0, 0, 1.5], 30, 55, 90);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag([-18, -12, 2.998], [8, 12, 2.998]); // starts on the 2.998 mm half
  await pickDir("Into");
  await expect(field("fb-h")).toHaveValue(/^3(\.0+)?$/);
  await page.click("#cmd-ok");
  await waitIdle(page);
  const box = await added(before);
  const bb = await boxOf(box.id);
  nearAll(bb.min, [-18, -12, 0], 1e-4);
  nearAll(bb.max, [8, 12, 3], 1e-4);
  const joined = await groupAll();
  // the plate (3418.86) and the 26 x 24 x 3 box (1872), less where they overlap: 18 x 24 x 2.998 and 8 x 24 x 3, each less its half of the opening
  near(joined.volume, 3418.86 + 1872 - (18 * 24 * 2.998 - 89.94) - (8 * 24 * 3 - 90), 0.5);
  expect((await stlOf(joined.id)).open).toBe(0);
});

test("Into: typing a width that reaches the other level keeps the bottom flush, and Group stays closed", async () => {
  await importPlate(true);
  await look([0, 0, 1.5], 30, 55, 90);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag([-18, -12, 2.998], [-6, 12, 2.998]); // all on the 2.998 mm half
  await pickDir("Into");
  await expect(field("fb-h")).toHaveValue(/^2\.998$/);
  await field("fb-w").fill("26"); // now reaches x = 8, over the opening and onto the 3 mm half
  await field("fb-w").press("Tab");
  await expect(field("fb-h")).toHaveValue(/^3(\.0+)?$/);
  await page.click("#cmd-ok");
  await waitIdle(page);
  const bb = await boxOf((await added(before)).id);
  nearAll(bb.min, [-18, -12, 0], 1e-4);
  nearAll(bb.max, [8, 12, 3], 1e-4);
  const joined = await groupAll();
  near(joined.volume, 3418.86 + 1872 - (18 * 24 * 2.998 - 89.94) - (8 * 24 * 3 - 90), 0.5);
  expect((await stlOf(joined.id)).open).toBe(0);
});

test("a vertical face of an app box: default height grows out of the face, and Group stays closed", async () => {
  await loadDoc(page, newDoc("Face box side", "beginner", { bodies: [body("cube", "Cube", prim("box", { w: 20, d: 20, h: 20 }))] }));
  await look([10, 0, 10], 60, 15, 80);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag([10, -4, 6], [10, 4, 12], async () => {
    const texts = (await liveLabels()).map((l) => l.text).sort();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(mm(6));
    expect(texts[1]).toMatch(mm(8));
  });
  await page.click("#cmd-ok");
  await waitIdle(page);
  const box = await added(before);
  expect(box.node.kind).toBe("box");
  const bb = await boxOf(box.id);
  nearAll(bb.min, [10, -4, 6], 1e-4);
  nearAll(bb.max, [20, 4, 12], 1e-4);
  const joined = await groupAll();
  near(joined.volume, 8000 + 10 * 8 * 6, 0.5);
  expect((await stlOf(joined.id)).open).toBe(0);
});

test("a tilted face: typed sizes, Both ways, and the box lines up with the face and the body's edges", async () => {
  const a = (30 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  // a 30 x 30 x 10 slab turned 30 degrees about X and lifted, so its top face leans
  const m = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 20, 1];
  await loadDoc(page, newDoc("Face box tilt", "beginner", { bodies: [body("slab", "Slab", prim("box", { w: 30, d: 30, h: 10 }), m)] }));
  const n = [0, -s, c], ex = [1, 0, 0], ey = [0, c, s];
  const top = [0, -10 * s, 20 + 10 * c];
  const at = (u, v) => top.map((t, i) => t + ex[i] * u + ey[i] * v);
  await look(top, 20, 50, 110);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag(at(-6, -4), at(6, 4), async () => {
    expect(await liveLabels()).toHaveLength(2);
  });
  await field("fb-w").fill("12");
  await field("fb-w").press("Tab");
  await field("fb-d").fill("7");
  await field("fb-d").press("Tab");
  await field("fb-h").fill("4");
  await field("fb-h").press("Tab");
  await pickDir("Both");
  await page.click("#cmd-ok");
  await waitIdle(page);
  const box = await added(before);
  expect(box.node).toMatchObject({ t: "prim", kind: "box", p: { w: 12, d: 7, h: 4 } });
  const M = box.m, X = [M[0], M[1], M[2]], Z = [M[8], M[9], M[10]], O = [M[12], M[13], M[14]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  near(dot(Z, n), 1, 1e-6); // stands on the face
  near(dot(X, ex), 1, 1e-6); // and lines up with the slab's edges, the same way round
  // both ways: the box's middle (its origin plus half its height) lies in the face's plane. The drag started at (-6, -4) from the
  // face centre, which is (-6, 6) on the 1 mm grid of the face's plane (its origin is the world origin seen along the normal, 10 mm
  // from the centre along ey); the typed 12 x 7 keep that corner, so the middle is 0.5 mm back from the face centre along ey.
  const mid = O.map((o, i) => o + Z[i] * 2);
  nearAll(mid, top.map((t, i) => t - 0.5 * ey[i]), 1e-4);
  const ids = (await list()).map((e) => e.id);
  expect(ids).toContain(box.id);
  expect((await list()).find((e) => e.id === box.id).error).toBeNull();
});

test("Esc cancels: nothing is added, and the preview and the labels go away", async () => {
  await loadDoc(page, newDoc("Face box esc", "beginner", { bodies: [body("cube", "Cube", prim("box", { w: 20, d: 20, h: 20 }))] }));
  await look([0, 0, 20], 30, 55, 80);
  await openTool();
  await drag([-4, -4, 20], [4, 4, 20]);
  await expect.poll(() => run(() => window.__store.view.bodies.length)).toBe(2); // the preview box
  expect(await liveLabels()).toHaveLength(2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  expect(await run(() => [window.__store.doc.bodies.length, window.__store.view.bodies.length])).toEqual([1, 1]);
  expect(await liveLabels()).toEqual([]);
});

test("a click without a drag makes a 20 x 20 box centred where you clicked", async () => {
  await loadDoc(page, newDoc("Face box click", "beginner", { bodies: [body("slab", "Slab", prim("box", { w: 40, d: 40, h: 10 }))] }));
  await look([0, 0, 10], 30, 55, 100);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  const [x, y] = await screen([3, 2, 10]);
  await page.mouse.click(x, y);
  await expect(field("fb-w")).toHaveValue(/^20(\.0+)?$/);
  await expect(field("fb-d")).toHaveValue(/^20(\.0+)?$/);
  await page.click("#cmd-ok");
  await waitIdle(page);
  const bb = await boxOf((await added(before)).id);
  nearAll(bb.min, [-7, -8, 10], 1e-4);
  nearAll(bb.max, [13, 12, 20], 1e-4);
});

test("Out of the face on one level of a two-level top sits exactly on that level and fuses closed", async () => {
  await importPlate(true);
  await look([0, 0, 1.5], 30, 55, 90);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  await drag([-18, -12, 2.998], [-6, 12, 2.998]); // all on the 2.998 mm half
  await page.click("#cmd-ok");
  await waitIdle(page);
  const bb = await boxOf((await added(before)).id);
  nearAll(bb.min, [-18, -12, 2.998], 1e-4); // not lifted to the 3 mm half next to it
  nearAll(bb.max, [-6, 12, 12.998], 1e-4);
  const joined = await groupAll();
  near(joined.volume, 3418.86 + 12 * 24 * 10, 0.5);
  expect((await stlOf(joined.id)).open).toBe(0);
});

test("Max's Pi lid: a box drawn on the lid's floor, flush with both faces, joins closed", async () => {
  test.setTimeout(240_000);
  await loadDoc(page, newDoc("Face box lid", "beginner"));
  await page.selectOption("#snap", "0.25");
  try {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles({ name: "Canakit_Pi_4_case_lid.stl", mimeType: "model/stl", buffer: readFileSync(lidFile) });
  await expect.poll(async () => (await list()).length, { timeout: 120_000 }).toBe(1);
  await waitIdle(page, 120_000);
  await run(() => document.getElementById("toasts").replaceChildren());
  const [lid] = await list();
  expect(lid.error).toBeNull();
  await look([-5, 0, 3], 0, 89, 140);
  await openTool();
  const before = (await doc()).bodies.map((b) => b.id);
  // the fill box from Max's OrcaSlicer result: 64 x 31 at (-5.25, 0), the plate is z 0..3
  await drag([-37.25, -15.5, 3], [26.75, 15.5, 3], async () => {
    const labels = await liveLabels();
    expect(labels.find((l) => l.k === "w")?.text).toMatch(mm(64));
    expect(labels.find((l) => l.k === "d")?.text).toMatch(mm(31));
  });
  await pickDir("Into");
  // the lid floor is 2.998 mm high in places and 3 mm in others (in the STL itself), and the drag starts on a 2.998 patch: the box
  // takes the outermost of the level faces within 0.01 mm, 3 mm, or its top would sit 2 microns inside the 3 mm parts and the join
  // would come out open (246 open or non-manifold edges before this rule)
  await expect(field("fb-h")).toHaveValue(/^3(\.0+)?$/);
  const h = 3;
  await page.click("#cmd-ok");
  await waitIdle(page);
  const box = await added(before);
  const bb = await boxOf(box.id);
  nearAll(bb.min, [-37.25, -15.5, 0], 1e-4);
  nearAll(bb.max, [26.75, 15.5, h], 1e-4);
  const joined = await groupAll();
  const m = await stlOf(joined.id);
  expect(m.open, "open or non-manifold edges in the joined lid").toBe(0);
  expect(joined.volume).toBeGreaterThan(lid.volume + 100); // the openings under the box are filled
  } finally { await page.selectOption("#snap", "1"); }
});
