// Printer plate and overhang shading (Settings > Printer plate…), on both builds. Users see it as: pick my printer and the plate
// becomes its real width and depth; switch on overhang shading and the steep undersides of my parts turn red, and nothing about the
// design changes. The maths on small known triangles is in overhang.test.mjs and the overlay's life cycle on real three.js objects
// is in printerpreview.test.mjs (both node, no browser); this file is the same outcomes through the real dialog and the real picture.
// Bed sizes are the makers' stated build volumes (see src/printerpresets.js); no real printer was involved.
import { test, expect } from "@playwright/test";
import { boot, reload, newDoc, body, prim, loadDoc, exportBytes, sha256, watchErrors } from "./helpers.mjs";

const PRESETS = { a1: [256, 256, 256], x1: [256, 256, 256], p1s: [256, 256, 256], mk4: [250, 210, 220], mini: [180, 180, 180], ender3: [220, 220, 250], u1: [270, 270, 270] };
const NAMES = { a1: "Bambu Lab A1", x1: "Bambu Lab X1 / X1 Carbon", p1s: "Bambu Lab P1P / P1S", mk4: "Original Prusa MK4 / MK4S", mini: "Original Prusa MINI+", ender3: "Creality Ender-3 (original model)", u1: "Snapmaker U1" };
const KEY = "jumpstart.printerplate.v1";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  // helpers that run in the page (they survive reloads): camera, one pixel patch, and an independent reading of "which triangles lean out too far"
  await page.addInitScript(() => {
    window.__oh = {
      look(o) { const vp = window.__app.vp; Object.assign(vp.view, { az: o.az, el: o.el, dist: o.dist, roll: 0 }); vp.view.target.set(...o.target); vp.anim = null; vp.useOrtho = !!o.ortho; },
      snap(at, n = 5, noGrid = false) {
        const vp = window.__app.vp;
        vp.grid.visible = !noGrid;
        vp.render();
        vp.grid.visible = true;
        const [x, y] = vp.project(new vp.view.target.constructor(...at));
        const k = vp.canvas.width / vp.w, c = document.createElement("canvas"); c.width = vp.canvas.width; c.height = vp.canvas.height;
        const g = c.getContext("2d"); g.drawImage(vp.canvas, 0, 0);
        const h = (n - 1) / 2, d = g.getImageData(Math.round(x * k) - h, Math.round(y * k) - h, n, n).data, px = [];
        for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
        return { px, under: vp.grid.material.uniforms.under.value, xy: [x, y] };
      },
      // a plain, separate reading of the rule: the three corners put in the world, their cross product, flipped when the matrix mirrors
      oracle(id, deg) {
        const v = window.__app.scene.views.get(id), m = v.group.matrix.elements, P = v.data.vertices, T = v.data.triangles;
        const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
        const lim = Math.sin((deg * Math.PI) / 180) + 1e-4, out = [], W = (i) => [m[0] * P[i * 3] + m[4] * P[i * 3 + 1] + m[8] * P[i * 3 + 2] + m[12], m[1] * P[i * 3] + m[5] * P[i * 3 + 1] + m[9] * P[i * 3 + 2] + m[13], m[2] * P[i * 3] + m[6] * P[i * 3 + 1] + m[10] * P[i * 3 + 2] + m[14]];
        let area = 0;
        for (let t = 0; t < T.length / 3; t++) {
          const a = W(T[t * 3]), b = W(T[t * 3 + 1]), c = W(T[t * 3 + 2]);
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], len = Math.hypot(n[0], n[1], n[2]);
          if (len < 1e-9) continue;
          if (Math.abs(a[2]) <= 0.05 && Math.abs(b[2]) <= 0.05 && Math.abs(c[2]) <= 0.05) continue;
          if (-(det < 0 ? -1 : 1) * n[2] / len > lim) { out.push(T[t * 3] + "," + T[t * 3 + 1] + "," + T[t * 3 + 2]); area += len / 2; }
        }
        return { tris: out.sort(), area };
      },
      overlay(id) {
        const v = window.__app.scene.views.get(id);
        if (!v) return { tris: [], n: 0, visible: false };
        const os = v.group.children.filter((c) => c.userData.overhang), o = os[0];
        if (!o) return { tris: [], n: 0, visible: false };
        const I = o.geometry.getIndex().array, tris = [];
        for (let i = 0; i < I.length; i += 3) tris.push(I[i] + "," + I[i + 1] + "," + I[i + 2]);
        return { tris: tris.sort(), n: os.length, visible: o.visible, sharesPosition: o.geometry.getAttribute("position") === v.mesh.geometry.getAttribute("position") };
      },
    };
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(async () => {
  expect(errors).toEqual([]);
  await page.evaluate(() => { document.getElementById("plate-back")?.remove(); window.__app.plateView.largeTriangles = 1000000; window.__app.plateView.pref.set({ printer: "generic", shade: false, angle: 45 }); });
});

// ---- small helpers
const pref = (patch) => page.evaluate((p) => window.__app.plateView.pref.set(p), patch);
const settled = (n) => page.waitForFunction((n) => { const e = window.__app.plateView.entries(); return e.length === n && e.every((x) => x.state === "done"); }, n, { timeout: 30_000 });
async function openPlate() {
  await page.click("#btn-theme");
  await page.click("#btn-plate");
  await expect(page.locator("#plate-dialog")).toBeVisible();
}
const closePlate = () => page.click("#plate-done");
const plateState = () => page.evaluate(() => {
  const vp = window.__app.vp, u = vp.grid.material.uniforms;
  return { plate: [vp.plate.w, vp.plate.d, vp.plate.on], half: [u.halfSize.value.x, u.halfSize.value.y], scale: [vp.grid.scale.x, vp.grid.scale.y], style: vp.gridStyle, pref: window.__app.plateView.pref.get() };
});
const mean = (px) => [0, 1, 2].map((c) => Math.round(px.reduce((s, p) => s + p[c], 0) / px.length));
const isRed = ([r, g, b]) => r > 110 && r > g + 50 && r > b + 50;
const TOP = { az: 0, el: Math.PI / 2 - 1e-4, dist: 600, target: [0, 0, 0], ortho: true };
const rotX = (deg, t = [0, 0, 0]) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, ...t, 1]; };
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const scale = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const move = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const box = (id, w, d, h, m, extra = {}) => body(id, id, prim("box", { w, d, h, r: 0, c: 0 }), m, extra);

test.describe("the dialog and the plate", () => {
  test("every named printer, chosen in the real dialog, shows its size and its evidence, and the plate takes exactly that X × Y", async () => {
    await loadDoc(page, newDoc("Empty", "beginner"));
    await openPlate();
    const items = await page.locator("#plate-select option").allTextContents();
    expect(items[0]).toBe("Generic 256 × 256");
    expect(items).toContain("No printer boundary");
    expect(items.filter((t) => /Snapmaker/.test(t)).every((t) => /Snapmaker U1/.test(t)), `Snapmaker is the U1 only: ${items}`).toBe(true);
    for (const [key, [w, d, h]] of Object.entries(PRESETS)) {
      await page.selectOption("#plate-select", key);
      const dims = page.locator("#plate-dims");
      await expect(dims).toContainText(`Width (X) ${w} mm × depth (Y) ${d} mm × height (Z) ${h} mm`);
      const ev = page.locator("#plate-evidence");
      await expect(ev).toContainText("checked 2026-10-23");
      await expect(ev).toContainText("Not tried on a real printer");
      expect(await ev.locator("a").count()).toBeGreaterThanOrEqual(1);
      expect(await page.locator("#plate-select option:checked").textContent()).toContain(NAMES[key]);
      const s = await plateState();
      expect(s.pref.printer).toBe(key);
      expect(s.plate).toEqual([w, d, true]);
      expect(s.half).toEqual([w / 2, d / 2]);
      expect(s.scale).toEqual([w, d]);
    }
    await page.selectOption("#plate-select", "x1");
    await expect(page.locator("#plate-evidence")).toContainText("X1E"); // named as not separately checked
    await closePlate();
  });

  test("MK4 is a rectangle on screen: 250 wide, 210 deep, not a square", async () => {
    await loadDoc(page, newDoc("Empty", "beginner"));
    await pref({ printer: "mk4" });
    await page.evaluate((o) => window.__oh.look(o), TOP);
    const read = async (at) => { const s = await page.evaluate(({ at }) => window.__oh.snap(at, 5), { at }); const m = mean(s.px); return m[2] - m[0]; }; // the mat is blue, the empty ground is not
    expect(await read([121, 0, 0]), "just inside the +X edge").toBeGreaterThan(30);
    expect(await read([129, 0, 0]), "just outside the +X edge").toBeLessThan(15);
    expect(await read([0, 101, 0]), "just inside the +Y edge").toBeGreaterThan(30);
    expect(await read([0, 109, 0]), "just outside the +Y edge (a 250 × 250 square would still be mat here)").toBeLessThan(15);
    expect(await read([-121, 0, 0])).toBeGreaterThan(30);
    expect(await read([0, -109, 0])).toBeLessThan(15);
  });

  test("Generic is the old 256 × 256 mat, and No printer boundary falls back to the construction grid", async () => {
    await loadDoc(page, newDoc("Empty", "beginner"));
    await openPlate();
    await page.selectOption("#plate-select", "none");
    let s = await plateState();
    expect(s.plate[2]).toBe(false);
    expect(s.half).toEqual([20000, 20000]);
    expect(s.scale).toEqual([40000, 40000]);
    await expect(page.locator("#plate-dims")).toContainText("No boundary");
    await page.selectOption("#plate-select", "generic");
    s = await plateState();
    expect(s.plate).toEqual([256, 256, true]);
    expect(s.half).toEqual([128, 128]);
    await expect(page.locator("#plate-dims")).toContainText("no limit set");
    await closePlate();
  });

  test("Advanced keeps its construction grid and adds a thin boundary from the same X × Y, in both themes", async () => {
    await loadDoc(page, newDoc("Empty", "advanced"));
    const boundary = () => page.evaluate(() => {
      const vp = window.__app.vp; vp.render();
      const a = vp.plateLine.geometry.getAttribute("position").array;
      return { visible: vp.plateLine.visible, xs: [Math.min(a[0], a[3], a[6], a[9]), Math.max(a[0], a[3], a[6], a[9])], ys: [Math.min(a[1], a[4], a[7], a[10]), Math.max(a[1], a[4], a[7], a[10])], grid: vp.grid.scale.x, z: a[2] };
    });
    await pref({ printer: "mk4" });
    let b = await boundary();
    expect(b).toMatchObject({ visible: true, xs: [-125, 125], ys: [-105, 105], grid: 40000 });
    expect(b.z).toBeLessThan(0.1);
    await page.evaluate(() => window.__app.setTheme("dark", true));
    b = await boundary();
    expect(b).toMatchObject({ visible: true, xs: [-125, 125], ys: [-105, 105] });
    await page.evaluate(() => window.__app.setTheme("light", true));
    await pref({ printer: "none" });
    expect((await boundary()).visible).toBe(false);
    await pref({ printer: "u1" });
    expect(await boundary()).toMatchObject({ visible: true, xs: [-135, 135], ys: [-135, 135] });
  });

  test("the choice holds across Beginner/Advanced, themes and a reload", async () => {
    await loadDoc(page, newDoc("Empty", "beginner"));
    await pref({ printer: "ender3" });
    await page.evaluate(() => window.__app.setMode("advanced"));
    expect((await plateState()).plate).toEqual([220, 220, true]);
    await page.evaluate(() => window.__app.setMode("beginner"));
    await page.evaluate(() => window.__app.setTheme("dark", true));
    let s = await plateState();
    expect(s.plate).toEqual([220, 220, true]);
    expect(s.half).toEqual([110, 110]);
    await page.evaluate(() => window.__app.setTheme("light", true));
    await pref({ printer: "mk4", shade: true, angle: 60 });
    expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY))).toEqual({ v: 1, printer: "mk4", shade: true, angle: 60 });
    await reload(page);
    await page.waitForFunction(() => window.__app.projects.started === true);
    await page.evaluate(() => window.__app.setMode("beginner", true));
    s = await plateState();
    expect(s.pref).toEqual({ v: 1, printer: "mk4", shade: true, angle: 60 });
    expect(s.plate).toEqual([250, 210, true]);
    expect(s.half).toEqual([125, 105]);
    await openPlate();
    expect(await page.locator("#plate-select").inputValue()).toBe("mk4");
    expect(await page.locator("#overhang-chk").isChecked()).toBe(true);
    expect(await page.locator("#overhang-angle").inputValue()).toBe("60");
    await closePlate();
  });

  test("a plain line says which parts reach outside the area, and nothing is moved", async () => {
    await loadDoc(page, newDoc("Fit", "beginner", { bodies: [box("in", 50, 50, 20, move(-25, -25, 0)), box("far", 40, 40, 20, move(200, 0, 0)), box("tall", 20, 20, 300, move(-100, -100, 0))] }));
    await pref({ printer: "mk4" });
    const before = JSON.stringify(await page.evaluate(() => window.__store.doc));
    await openPlate();
    const fit = page.locator("#plate-fit");
    await expect(fit).toContainText("2 of 3 parts");
    await expect(fit).toContainText("far (X)");
    await expect(fit).toContainText("tall (Z)");
    await expect(fit).toContainText("They were not moved");
    await page.selectOption("#plate-select", "generic"); // no height limit: only "far" reaches out
    await expect(fit).toContainText("1 of 3 parts");
    await page.selectOption("#plate-select", "none");
    await expect(fit).toContainText("No printer boundary");
    await closePlate();
    expect(JSON.stringify(await page.evaluate(() => window.__store.doc))).toBe(before);
  });

  test("switching plates, shading and angles changes nothing in the design: same STL, same transforms, same undo history", async () => {
    const doc = newDoc("Same", "beginner", { bodies: [box("a", 30, 30, 10, move(12, 13, 5), { color: "#e02020" }), box("b", 20, 20, 10, rotX(30, [60, 0, 20]))] });
    await loadDoc(page, doc);
    const snap = () => page.evaluate(() => ({ doc: JSON.stringify(window.__store.doc), undo: window.__store.undoStack.length, ms: window.__store.doc.bodies.map((b) => b.m) }));
    const stl0 = sha256((await exportBytes(page, "stl")).bytes), s0 = await snap();
    await openPlate();
    await page.selectOption("#plate-select", "mk4");
    await page.check("#overhang-chk");
    await settled(2);
    await page.selectOption("#plate-select", "u1");
    await pref({ angle: 30 });
    await settled(2);
    await page.selectOption("#plate-select", "none");
    await pref({ angle: 80 });
    await settled(2);
    await closePlate();
    const stl1 = sha256((await exportBytes(page, "stl")).bytes), s1 = await snap();
    expect(stl1).toBe(stl0);
    expect(s1).toEqual(s0);
    await pref({ shade: false });
    expect(sha256((await exportBytes(page, "stl")).bytes)).toBe(stl0);
  });
});

test.describe("overhang shading", () => {
  test("a lifted box has two red triangles under it; a box on the bed, and every wall and top, have none", async () => {
    await loadDoc(page, newDoc("Known", "beginner", { bodies: [box("bed", 20, 20, 20, move(-60, 0, 0)), box("lifted", 20, 20, 10, move(40, 0, 5))] }));
    await pref({ shade: true });
    await settled(2);
    const bed = await page.evaluate(() => window.__oh.overlay("bed")), lifted = await page.evaluate(() => window.__oh.overlay("lifted"));
    expect(bed.tris).toEqual([]);
    expect(lifted.tris.length).toBe(2);
    expect(lifted.sharesPosition).toBe(true);
    const e = await page.evaluate(() => Object.fromEntries(window.__app.plateView.entries().map((x) => [x.id, x])));
    expect(e.lifted.count).toBe(2);
    expect(e.lifted.area).toBeCloseTo(400, 1);
    expect(e.bed.count).toBe(0);
    expect(await page.evaluate(() => window.__oh.oracle("lifted", 45))).toMatchObject({ tris: lifted.tris });
    // the legend says what red means, and what it does not
    const chip = page.locator("#overhang-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("more than 45° from upright");
    await expect(chip).toContainText("does not say that support is needed");
  });

  test("just below, at and above the limit: 30, 45 and 60 degrees from upright", async () => {
    // a box turned about X by 40 degrees and lifted clear of the bed: its underside leans 50 degrees from upright, its front face 40
    await loadDoc(page, newDoc("Tilt", "beginner", { bodies: [box("t", 30, 20, 10, rotX(40, [0, 0, 30]))] }));
    await pref({ shade: true, angle: 45 }); await settled(1);
    const at = async (deg) => { await pref({ angle: deg }); await settled(1); const o = await page.evaluate(() => window.__oh.overlay("t")), r = await page.evaluate((d) => window.__oh.oracle("t", d), deg), e = await page.evaluate(() => window.__app.plateView.entries()[0]); expect(o.tris, `limit ${deg}`).toEqual(r.tris); return { n: o.tris.length, area: e.area }; };
    expect(await at(45)).toMatchObject({ n: 2 });      // the 50° underside only (30 × 20 = 600 mm²)
    expect((await at(45)).area).toBeCloseTo(600, 0);
    expect(await at(30)).toMatchObject({ n: 4 });      // and the 40° front face (30 × 10 = 300 mm²) too
    expect((await at(30)).area).toBeCloseTo(900, 0);
    expect(await at(60)).toMatchObject({ n: 0 });      // neither: the old cosine rule would have shaded both here
    // 49 and 51 around the underside's 50 degrees
    expect((await at(49)).n).toBe(2);
    expect((await at(51)).n).toBe(0);
    // faces exactly at the limit are clear: a box turned 45 degrees leans 45 on both undersides
    await loadDoc(page, newDoc("Edge", "beginner", { bodies: [box("t", 30, 20, 10, rotX(45, [0, 0, 30]))] }));
    await settled(1);
    expect((await at(45)).n).toBe(0);
    expect((await at(44)).n).toBe(4);
    expect((await at(46)).n).toBe(0);
  });

  test("turned, stretched and mirrored bodies give the same triangles as an independent reading of the rule", async () => {
    const cone = (m) => body("c", "Cone", prim("cone", { w: 20, d: 20, h: 8, top: 0 }), m);
    const flip = mul(move(0, 0, 40), rotX(180)); // apex down, lifted well clear of the bed
    const variants = {
      "turned": flip,
      "stretched in x": mul(flip, scale(2, 1, 1)),
      "squashed in z": mul(flip, scale(1, 1, 0.4)),
      "mirrored": mul(flip, scale(-1, 1, 1)),
      "mirrored and stretched": mul(mul(flip, scale(-1, 1, 3)), rotX(20)),
    };
    for (const [label, m] of Object.entries(variants)) {
      await loadDoc(page, newDoc("Cone", "beginner", { bodies: [cone(m)] }));
      await pref({ shade: true, angle: 45 });
      await settled(1);
      const counts = [];
      for (const deg of [30, 45, 60]) {
        await pref({ angle: deg }); await settled(1);
        const o = await page.evaluate(() => window.__oh.overlay("c")), r = await page.evaluate((d) => window.__oh.oracle("c", d), deg);
        expect(o.tris, `${label} at ${deg}`).toEqual(r.tris);
        const e = await page.evaluate(() => window.__app.plateView.entries()[0]);
        expect(e.area, `${label} area at ${deg}`).toBeCloseTo(r.area, 0);
        counts.push(o.tris.length);
      }
      expect(counts[0], `${label}: something is shaded at 30`).toBeGreaterThan(0);
      expect(counts[0] >= counts[1] && counts[1] >= counts[2], `${label}: a wider limit never shades more (${counts})`).toBe(true);
    }
  });

  test("on screen: red under the lifted box from below, the wall and the top stay their own colour, the plate stays clear, picking still works", async () => {
    const M = move(12, 13, 5); // z 5..15, x 12..42, y 13..43, as in underside.spec.mjs
    await loadDoc(page, newDoc("Pix", "beginner", { bodies: [box("b1", 30, 30, 10, M, { color: "#3b82c4" })] }));
    const BELOW = { az: 0.7, el: -0.6, dist: 200, target: [27, 28, 10] }, FACE = [17, 19, 5];
    const px = (look, at, noGrid = false) => page.evaluate(({ look, at, noGrid }) => { window.__oh.look(look); return window.__oh.snap(at, 9, noGrid); }, { look, at, noGrid });
    let s = await px(BELOW, FACE);
    expect(s.under).toBe(1);
    expect(isRed(mean(s.px)), `without shading the underside reads ${mean(s.px)}`).toBe(false);
    const off = mean(s.px);
    await pref({ shade: true }); await settled(1);
    s = await px(BELOW, FACE);
    const on = mean(s.px);
    expect(isRed(on), `with shading it reads ${on}`).toBe(true);
    expect(Math.max(...off.map((v, c) => Math.abs(v - on[c]))), "shading changed the picture").toBeGreaterThan(40);
    // the plate is as clear as before: the red shows through it, with no more tint than underside.spec.mjs allows
    const bare = mean((await px(BELOW, FACE, true)).px);
    expect(isRed(bare)).toBe(true);
    expect(Math.max(...on.map((v, c) => Math.abs(v - bare[c]))), `through the plate ${on}, without it ${bare}`).toBeLessThanOrEqual(40);
    // from the side the wall is not red, and from above the top is not red
    s = await px({ az: -Math.PI / 2, el: 0.02, dist: 200, target: [27, 28, 10] }, [27, 13, 10]);
    expect(isRed(mean(s.px)), `wall reads ${mean(s.px)}`).toBe(false);
    s = await px({ az: 0.7, el: 0.9, dist: 200, target: [27, 28, 10] }, [27, 28, 15]);
    expect(isRed(mean(s.px)), `top reads ${mean(s.px)}`).toBe(false);
    // the red lives only under the box: nothing red beside it
    s = await px(BELOW, [60, 19, 5]);
    expect(isRed(mean(s.px))).toBe(false);
    // picking goes to the body, not the overlay; selection edges are still drawn above the red
    const pick = await page.evaluate(() => {
      window.__oh.look({ az: 0.7, el: -0.6, dist: 200, target: [27, 28, 10] });
      const a = window.__app, vp = a.vp; vp.render();
      const [x, y] = vp.project(new vp.view.target.constructor(17, 19, 5)), r = vp.canvas.getBoundingClientRect();
      const hit = a.scene.pickFace({ clientX: r.left + x, clientY: r.top + y });
      a.select(["b1"]);
      const v = a.scene.views.get("b1"), o = v.group.children.find((c) => c.userData.overhang);
      return { body: hit && hit.body, edges: v.edges.visible, edgeOrder: v.edges.renderOrder, overlayOrder: o.renderOrder };
    });
    expect(pick.body).toBe("b1");
    expect(pick.edges).toBe(true);
    expect(pick.edgeOrder).toBeGreaterThan(pick.overlayOrder);
  });

  test("camera motion starts no analysis; hidden and hole bodies get none; deleting one leaves nothing behind", async () => {
    await loadDoc(page, newDoc("Many", "beginner", { bodies: [box("a", 20, 20, 10, move(0, 0, 5)), box("h", 20, 20, 10, move(40, 0, 5), { hidden: true }), box("g", 20, 20, 10, move(80, 0, 5), { hole: true })] }));
    await pref({ shade: true });
    await settled(1);
    const jobs = await page.evaluate(() => window.__app.plateView.stats.jobs);
    await page.evaluate(() => { const vp = window.__app.vp; for (let i = 0; i < 30; i++) { vp.view.az += 0.05; vp.view.el += 0.01; vp.render(); } });
    await page.evaluate(() => window.__app.scene.setHovered("a")); await page.evaluate(() => window.__app.scene.setHovered(null));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__app.plateView.stats.jobs)).toBe(jobs);
    expect((await page.evaluate(() => ["h", "g"].map((id) => window.__oh.overlay(id).n)))).toEqual([0, 0]);
    await page.evaluate(() => window.__store.update((d) => { d.bodies = d.bodies.filter((b) => b.id !== "a"); }, "Delete"));
    await page.waitForFunction(() => !window.__app.scene.views.has("a"));
    expect(await page.evaluate(() => window.__app.plateView.entries().length)).toBe(0);
  });

  test("changing the mesh detail rebuilds the overlay from the new triangles; toggling returns the GPU resources to where they started", async () => {
    await loadDoc(page, newDoc("Ball", "beginner", { bodies: [body("s", "Ball", prim("sphere", { w: 30, d: 30, h: 30 }), move(0, 0, 10))] }));
    try {
      await pref({ shade: true, angle: 45 }); await settled(1);
      const n0 = (await page.evaluate(() => window.__oh.overlay("s"))).tris.length;
      expect(n0).toBeGreaterThan(0);
      const tris0 = await page.evaluate(() => window.__app.scene.views.get("s").data.triangles.length / 3);
      await page.evaluate(() => window.__app.setMeshDetail("fine", true));
      await page.waitForFunction((n) => { const v = window.__app.scene.views.get("s"); return v && v.data && !v.pending && v.data.triangles.length / 3 > n && !window.__app.scene.busy(); }, tris0, { timeout: 60_000 });
      await settled(1);
      const o = await page.evaluate(() => window.__oh.overlay("s")), r = await page.evaluate(() => window.__oh.oracle("s", 45));
      console.log(`# sphere: ${n0} red triangles at normal detail, ${o.tris.length} at fine (${await page.evaluate(() => window.__app.scene.views.get("s").data.triangles.length / 3)} triangles in all)`);
      expect(o.tris.length).toBeGreaterThan(n0);
      expect(o.tris).toEqual(r.tris);
      expect(o.n).toBe(1);
    } finally { await page.evaluate(() => window.__app.setMeshDetail("normal", true)); await page.waitForFunction(() => { const v = window.__app.scene.views.get("s"); return !window.__app.scene.busy() && window.__app.kernel.quality === 1 && v && !v.pending; }, null, { timeout: 60_000 }); }
    await pref({ shade: false });
    const geometries = () => page.evaluate(() => { window.__app.vp.render(); return window.__app.vp.renderer.info.memory.geometries; });
    const topColour = () => page.evaluate(() => { const b = window.__app.scene.bodyWorldBox("s"), c = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z]; window.__oh.look({ az: 0.7, el: 1.2, dist: 120, target: c }); return window.__oh.snap(c, 5).px; });
    const base = await geometries(), colour = mean(await topColour());
    for (let i = 0; i < 3; i++) {
      await pref({ shade: true }); await settled(1);
      expect(await geometries()).toBeGreaterThan(base);
      await pref({ shade: false });
      expect(await geometries(), `round ${i + 1}`).toBe(base);
    }
    expect(await page.evaluate(() => window.__app.scene.views.get("s").group.children.length)).toBe(2); // mesh and edges: nothing of ours left
    mean(await topColour()).forEach((v, c) => expect(Math.abs(v - colour[c])).toBeLessThanOrEqual(3)); // the ball still renders as before
  });

  test("a mesh over the size limit waits until you press Analyse this mesh", async () => {
    await loadDoc(page, newDoc("Big", "beginner", { bodies: [box("a", 20, 20, 10, move(0, 0, 5))] }));
    await page.evaluate(() => { window.__app.plateView.largeTriangles = 3; }); // 1,000,000 in the app; this box has 12
    const jobs = await page.evaluate(() => window.__app.plateView.stats.jobs);
    await pref({ shade: true });
    const chip = page.locator("#overhang-chip");
    await expect(chip).toHaveAttribute("data-state", "needs");
    await expect(chip).toContainText("12 triangles");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__app.plateView.stats.jobs)).toBe(jobs);
    expect((await page.evaluate(() => window.__oh.overlay("a"))).n).toBe(0);
    await page.evaluate(() => document.getElementById("overhang-analyse").click());
    await settled(1);
    expect((await page.evaluate(() => window.__oh.overlay("a"))).tris.length).toBe(2);
    await expect(chip).toHaveAttribute("data-state", "done");
    console.log("# " + JSON.stringify(await page.evaluate(() => window.__app.plateView.stats)));
  });

  test("Section analysis hides the overlay and ending it brings it back once", async () => {
    await loadDoc(page, newDoc("Sec", "advanced", { bodies: [box("a", 20, 20, 10, move(0, 0, 5))] }));
    await pref({ shade: true }); await settled(1);
    await page.evaluate(() => window.__app.section.set({ ref: { o: [0, 0, 10], n: [0, 0, 1], x: [1, 0, 0], center: [10, 10, 10], size: 50, label: "test" }, d: 0, flip: false, hatch: false }));
    expect(await page.evaluate(() => window.__oh.overlay("a").n)).toBe(0);
    expect(await page.evaluate(() => window.__app.plateView.entries().length)).toBe(0);
    await page.evaluate(() => window.__app.section.clear());
    await settled(1);
    expect(await page.evaluate(() => window.__oh.overlay("a").n)).toBe(1);
  });
});

test.describe("the 3D Print Sim", () => {
  const openSim = async () => { await page.evaluate(() => window.__app.advanced.openPrintSim()); await expect(page.locator("#ps-printer")).toBeVisible(); };
  const doneSim = async () => { await page.click("#cmd-ok"); await expect(page.locator("#ps-printer")).toHaveCount(0); };
  const setLimit = (deg) => page.evaluate((v) => { const r = document.getElementById("ps-thr-range"); r.value = v; r.dispatchEvent(new Event("input", { bubbles: true })); }, deg);
  const banner = () => page.evaluate(() => (document.getElementById("ps-banner") || {}).textContent || "");

  test("it opens on the chosen printer, a change there is the same choice, the overlay steps aside and comes back, the plate returns after Done", async () => {
    await loadDoc(page, newDoc("Sim", "beginner", { bodies: [box("w", 200, 20, 20, move(-100, 0, 5))] }));
    await pref({ printer: "mini", shade: true }); await settled(1);
    await openSim();
    expect(await page.locator("#ps-printer").inputValue()).toBe("mini");
    await expect(page.locator(".simtile.bad")).toContainText("Too big for this printer"); // 200 mm does not fit the MINI+'s 180
    expect(await page.evaluate(() => window.__oh.overlay("w").n)).toBe(0);
    expect(await page.evaluate(() => window.__app.plateView.entries().length)).toBe(0);
    await page.selectOption("#ps-printer", "a1");
    await expect(page.locator(".simtile.bad")).toHaveCount(0);
    expect((await plateState()).pref.printer).toBe("a1");
    await page.selectOption("#ps-printer", "u1");
    await doneSim();
    const s = await plateState();
    expect(s.pref.printer).toBe("u1");
    expect(s.plate).toEqual([270, 270, true]);
    expect(await page.evaluate(() => window.__app.vp.grid.visible)).toBe(true);
    await settled(1);
    expect(await page.evaluate(() => window.__oh.overlay("w").n)).toBe(1);
    // Generic or none leave the sim on its own default
    await pref({ printer: "generic" });
    await openSim();
    expect(await page.locator("#ps-printer").inputValue()).toBe("u1"); // last used in the sim; the design plate choice does not force one
    await doneSim();
  });

  test("the sim and the design view use one rule: the limit is the lean from upright, so 30, 45 and 60 differ from the old cosine rule", async () => {
    // a post with a box turned 40 degrees on top of it, well off the bed so its undersides are not touching the plate:
    // the box's underside leans 50 degrees from upright (600 mm²) and its front face 40 degrees (300 mm²)
    await loadDoc(page, newDoc("SimRule", "beginner", { bodies: [box("post", 10, 10, 40, move(0, 0, 0)), box("arm", 30, 20, 10, mul(move(8, 0, 30), rotX(40)))] }));
    await openSim();
    const shows = (text) => page.waitForFunction((t) => ((document.getElementById("ps-banner") || {}).textContent || "").includes(t), text, { timeout: 30_000 });
    await shows("600 mm²"); // the default limit, 45°
    expect(await banner()).toContain("more than 45°");
    await setLimit(30);
    await shows("900 mm²");
    expect(await banner()).toContain("more than 30°");
    await setLimit(60);
    await page.waitForFunction(() => !document.getElementById("ps-banner"), null, { timeout: 30_000 }); // at 60 the 50° and 40° faces are both fine; the old cosine rule shaded both
    await doneSim();
  });

  test("a part resting on another part needs no support in the sim, though the design overlay still marks its underside", async () => {
    await loadDoc(page, newDoc("Stack", "beginner", { bodies: [box("low", 40, 40, 10, move(0, 0, 0)), box("up", 20, 20, 10, move(10, 10, 10))] }));
    await pref({ shade: true }); await settled(2);
    expect((await page.evaluate(() => window.__oh.overlay("up"))).tris.length).toBe(2); // steep downward faces, as it says
    expect((await page.evaluate(() => window.__oh.overlay("low"))).tris.length).toBe(0);
    await openSim();
    await expect(page.locator("#ps-status")).toContainText("Sliced", { timeout: 60_000 });
    await page.waitForTimeout(500);
    expect(await banner(), "no 'Supports needed' warning for a part that rests on another").toBe("");
    await doneSim();
  });
});
