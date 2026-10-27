// Upstream 2.7.3 (J.Siwek 2.7.2 and 2.7.3), shared by the site and single-file projects:
//  - round faces the mesher drew wrongly (stray flat "planes") are checked against the true surface and redrawn, and our cone-tip fix still runs after it
//  - Pattern > Features: a click on a cut, boss, hole or text on the model (or in the timeline) picks that feature
//  - thinner sketch lines (2.5 px became 1.5 px in the editor, 2.5 became 1.4 on the model), selected lines a little bolder
// His own tests (JumpStart-3D-v2.7.3-full-source/tests) are the same as for 2.7.1 and hold no repro for these, so the designs below are ours.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, IDENTITY } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";
import { BUILD, VERSION } from "../src/version.js";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);

test("the splash and About show version 2.7.3 with the 2.7.3 and 2.7.2 notes", async () => {
  expect(VERSION).toMatch(/^2\.7\./); // 2.7.7 and later keep these notes (upstream277.spec.mjs checks the newest)
  const label = `Version ${VERSION} · community build ${BUILD}`;
  expect(await page.locator("#sp-ver").textContent()).toBe(label);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText(label);
  await expect(about).toContainText("New in version 2.7.3");
  await expect(about).toContainText("No more stray planes");
  await expect(about).toContainText("New in version 2.7.2");
  await expect(about).toContainText("Thinner sketch lines");
  await expect(about).toContainText("New in version 2.7.1");
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

// ---------------------------------------------------------------- round faces stay on the true surface
// No design we could build makes the mesher draw a wall wrongly (test/upstream273.test.mjs spoils a mesh on purpose and checks the repair itself),
// so this is the guard from the user's side: cylinder walls left by an offset and by booleans export on the cylinder, the STL is closed and keeps its volume.
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const cutBy = (id, kind, p, m) => ({ id, seq: 2, t: "bool", op: "cut", m: IDENTITY, tool: { t: "group", mods: [], children: [{ node: prim(kind, { ...p, r: 0, c: 0 }), m }] } });
const offsetFace = (id, d, c) => ({ id, seq: 3, t: "offset", d, faces: [{ t: "CYLINDRE", c }] });
// triangles of a vertical wall (corners all at one radius from an axis) whose middle lies farther in than a chord of the mesh could: they cut across the part
const strayWalls = (tris, axes) => {
  const stray = [];
  for (const t of tris) {
    const u = [0, 1, 2].map((k) => t[1][k] - t[0][k]), v = [0, 1, 2].map((k) => t[2][k] - t[0][k]);
    const nz = u[0] * v[1] - u[1] * v[0], len = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], nz) || 1;
    if (Math.abs(nz) / len > 0.5) continue; // a cap, not a wall
    for (const [cx, cy, r] of axes) {
      if (!t.every((q) => Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r) < 2e-3)) continue;
      const mid = Math.hypot((t[0][0] + t[1][0] + t[2][0]) / 3 - cx, (t[0][1] + t[1][1] + t[2][1]) / 3 - cy);
      if (r - mid > Math.max(0.5, 0.05 * r)) stray.push([r, r - mid]);
    }
  }
  return stray;
};
const cases = [
  // (an offset picks the first round face, which is the bore; the bore of 12 mm becomes 8 or 18)
  { name: "a tube whose bore wall is pushed in by 2", mods: [cutBy("f1", "cylinder", { w: 12, d: 12, h: 24 }, T(0, 0, -2)), offsetFace("f2", 2, [0, 0, 10])], axes: [[0, 0, 15], [0, 0, 4]], volume: Math.PI * (225 - 16) * 20 },
  { name: "a tube whose bore wall is pulled out by 3", mods: [cutBy("f1", "cylinder", { w: 12, d: 12, h: 24 }, T(0, 0, -2)), offsetFace("f2", -3, [0, 0, 10])], axes: [[0, 0, 15], [0, 0, 9]], volume: Math.PI * (225 - 81) * 20 },
  { name: "a post cut by an off-centre round hole", mods: [cutBy("f1", "cylinder", { w: 10, d: 10, h: 24 }, T(9, 3, -2)), cutBy("f2", "cylinder", { w: 6, d: 6, h: 24 }, T(-8, -4, -2))], axes: [[0, 0, 15], [9, 3, 5], [-8, -4, 3]], volume: Math.PI * (225 - 25 - 9) * 20 },
];
for (const c of cases) {
  test("round walls export on the cylinder, closed: " + c.name, async () => {
    await loadDoc(page, newDoc("Walls", "advanced", { bodies: [body("b1", "Post", prim("cylinder", { w: 30, d: 30, h: 20, r: 0, c: 0 }, c.mods))] }));
    expect((await bodies(page))[0].error).toBeNull();
    near(await volume(), c.volume, 0.01);
    const s = readStl(bytes(await run(() => JS3D.export("stl"))));
    expect(strayWalls(s, c.axes)).toEqual([]);
    const rep = meshReport(s);
    expect(rep.open).toBe(0);
    near(rep.volume, c.volume, 0.02);
  });
}

// ---------------------------------------------------------------- Pattern > Features, picked on the model
// A 80 x 30 x 10 bar (x -40..40, y -15..15, z 0..10) with a 10 x 10 pocket 4 deep cut into the top (feature f1, floor at z = 6)
// and a 6 mm hole through it (feature f2).
const pocketBar = () => {
  const sk = { id: "s1", name: "Pocket", seq: 1, plane: { o: [0, 0, 10], x: [1, 0, 0], n: [0, 0, 1] }, hidden: false,
    pts: [["p0", -15, -5], ["p1", -5, -5], ["p2", -5, 5], ["p3", -15, 5]].map(([id, x, y]) => ({ id, x, y })),
    ents: [["e0", "p0", "p1"], ["e1", "p1", "p2"], ["e2", "p2", "p3"], ["e3", "p3", "p0"]].map(([id, a, b]) => ({ id, t: "line", a, b })) };
  const pocket = { id: "f1", seq: 2, t: "bool", op: "cut", m: IDENTITY, tool: { t: "extrude", sketch: "s1", profiles: [{ key: "e0,e1,e2,e3", pt: [-10, 0] }], dist: -4, mode: "one", dist2: 0, mods: [] } };
  const hole = { id: "f2", seq: 3, t: "hole", kind: "simple", dia: 6, through: true, depth: 10, tapped: false, pitch: 0, clear: 0, tip: false, at: [{ p: [-30, 10, 10], n: [0, 0, 1] }] };
  return newDoc("Pocket bar", "advanced", { sketches: [sk], bodies: [body("b1", "Bar", prim("box", { w: 80, d: 30, h: 10, r: 0, c: 0 }, [pocket, hole]))] });
};
// where a world point lands on the screen
const screen = (x, y, z) => run(([x, y, z]) => { const v = window.__app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, z)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y, z]);
const clickAt = async (x, y, z) => { const [sx, sy] = await screen(x, y, z); await page.mouse.click(sx, sy); };
// the blue outline of picked features: thick lines of the pattern's blue
const BLUE = 0x2f66c8;
const blueLines = () => run((hex) => {
  const lin = (c) => (c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const want = [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
  let n = 0;
  window.__app.vp.scene.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.uC && u.uW && o.visible && u.uC.value.every((c, i) => Math.abs(c - want[i]) < 1e-4)) n++; });
  return n;
}, BLUE);
const picked = () => run(() => [...document.querySelectorAll('#pt-feats input[data-mod]')].filter((i) => i.checked).map((i) => i.getAttribute("data-mod")));
const marked = () => run(() => [...document.querySelectorAll(".tl-item.pt-on")].map((i) => i.getAttribute("data-mod")));
const volume = async () => (await bodies(page)).find((b) => b.id === "b1").volume;

test("Pattern > Features: a click on the pocket's floor picks it, a second click unpicks it, and the pattern copies it", async () => {
  await loadDoc(page, pocketBar());
  expect((await bodies(page))[0].error).toBeNull();
  const V0 = await volume();
  near(V0, 24000 - 400 - Math.PI * 9 * 10, 0.002); // the pocket and the hole are really cut
  await run(() => { const v = window.__app.vp; const V = v.camera.position.constructor; v.animateTo({ az: -Math.PI / 2 + 0.4, el: 1.15, dist: 140, target: new V(0, 0, 5) }, 10); });
  await page.waitForFunction(() => !window.__app.vp.anim);
  await run(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await expect(page.locator("#cmd")).toContainText("Pattern");
  await page.locator("#pt-what button", { hasText: "Features" }).click();
  await expect(page.locator("#hint")).toContainText("Click a cut, boss, hole or text on the model");
  expect(await picked()).toEqual([]);
  expect(await blueLines()).toBe(0);

  // click the floor of the pocket: that feature, and only that one, is picked
  await clickAt(-10, 0, 6);
  await expect.poll(picked).toEqual(["f1"]);
  expect(await marked()).toEqual(["f1"]); // the timeline marks it too
  expect(await blueLines()).toBeGreaterThan(0); // and it is outlined on the model
  // a second click unpicks it
  await clickAt(-10, 0, 6);
  await expect.poll(picked).toEqual([]);
  expect(await marked()).toEqual([]);
  expect(await blueLines()).toBe(0);
  // the timeline picks too
  await page.locator('.tl-item[data-mod="f1"]').click();
  await expect.poll(picked).toEqual(["f1"]);
  await page.locator('.tl-item[data-mod="f1"]').click();
  await expect.poll(picked).toEqual([]);
  // a click on the plain top of the bar picks nothing and says why
  await clickAt(20, -8, 10);
  expect(await picked()).toEqual([]);

  await clickAt(-10, 0, 6);
  await expect.poll(picked).toEqual(["f1"]);
  await page.fill("#pt-n1", "3");
  await page.keyboard.press("Enter");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  expect((await bodies(page))[0].error).toBeNull();
  near(await volume(), V0 - 800, 0.002); // two more pockets of 400 mm3, the hole untouched
  expect(await run(() => window.__store.doc.bodies[0].node.mods.map((m) => [m.t, m.feats]))).toEqual([["bool", undefined], ["hole", undefined], ["pattern", ["f1"]]]);
  expect(await blueLines()).toBe(0); // the outline is gone with the dialog
  expect(await marked()).toEqual([]);

  // editing the pattern still has our Delete button, and Delete takes the pattern away again
  await page.locator('.tl-item[aria-label="Pattern"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Pattern");
  await expect(page.locator("#hint")).toContainText("Change the count, spacing or angle");
  const del = page.locator("#cmd button.danger", { hasText: "Delete" });
  await expect(del).toBeVisible();
  await del.click();
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  near(await volume(), V0, 0.002);
  expect(await run(() => window.__store.doc.bodies[0].node.mods.length)).toBe(2);
});

// While a pattern is edited, a click in the timeline must not turn it into another kind of pattern or move it to another body (his timelinePick ignored edit mode).
const holeMod = (id, at) => ({ id, seq: 2, t: "hole", kind: "simple", dia: 5, through: true, depth: 10, tapped: false, pitch: 0, clear: 0, tip: false, at: [{ p: at, n: [0, 0, 1] }] });
const patternMod = (id, extra) => ({ id, seq: 3, t: "pattern", kind: "rect", ax1: [1, 0, 0], n1: 3, s1: 20, n2: 1, s2: 0, sym: false, ...extra });
const twoPatterns = () => newDoc("Two patterns", "advanced", { bodies: [
  body("b1", "Bar", prim("box", { w: 80, d: 30, h: 10, r: 0, c: 0 }, [holeMod("f1", [-30, 0, 10]), patternMod("f2", { what: "feats", feats: ["f1"] })])),
  body("b2", "Plate", prim("box", { w: 40, d: 20, h: 10, r: 0, c: 0 }, [holeMod("g1", [0, 0, 10]), patternMod("g2", { what: "shape", ax1: [0, 1, 0], n1: 2, s1: 60 })]), T(0, 80, 0)),
] });
const modsOf = (id) => run((id) => window.__store.doc.bodies.find((b) => b.id === id).node.mods, id);
const patternOf = async (id, mod) => { const m = (await modsOf(id)).find((x) => x.id === mod); return [m.what, m.feats, m.n1]; };

test("editing a pattern: timeline clicks on another body's feature or on a hole in a shape pattern change nothing", async () => {
  await loadDoc(page, twoPatterns());
  expect((await bodies(page)).map((b) => b.error)).toEqual([null, null]);
  const before = { b1: await modsOf("b1"), b2: await modsOf("b2") };
  const ok = async () => { await page.locator("#cmd-ok").click(); await expect(page.locator("#cmd")).toBeHidden(); await waitIdle(page); };

  // a feature pattern on the Bar: another body's hole is refused with a toast, the Bar's own hole still unpicks and re-picks
  await page.locator('.tl-item[data-mod="f2"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Pattern");
  await expect.poll(picked).toEqual(["f1"]);
  await page.locator('.tl-item[data-mod="g1"]').click();
  await expect(page.locator("#toasts .toast", { hasText: "Close the pattern" }).first()).toContainText("Close the pattern to pick features from another body.");
  await expect.poll(picked).toEqual(["f1"]);
  await page.locator('.tl-item[data-mod="f1"]').click();
  await expect.poll(picked).toEqual([]);
  await page.locator('.tl-item[data-mod="f1"]').click();
  await expect.poll(picked).toEqual(["f1"]);
  await ok();
  expect(await patternOf("b1", "f2")).toEqual(["feats", ["f1"], 3]);
  expect(await modsOf("b2")).toEqual(before.b2);
  const barAfter = await modsOf("b1"); // saving fills in the pattern's second axis; it must stay as it is from here on

  // a shape pattern on the Plate: neither its own hole nor the Bar's hole turns it into a feature pattern
  await page.locator('.tl-item[data-mod="g2"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Pattern");
  await page.locator('.tl-item[data-mod="g1"]').click();
  await page.locator('.tl-item[data-mod="f1"]').click();
  expect(await picked()).toEqual([]);
  await ok();
  expect(await patternOf("b2", "g2")).toEqual(["shape", undefined, 2]);
  expect(await modsOf("b1")).toEqual(barAfter);
  expect((await bodies(page)).map((b) => b.error)).toEqual([null, null]);
});

// ---------------------------------------------------------------- thinner sketch lines
test("sketch lines are about half as thick as in 2.7.1, selected lines a little bolder", async () => {
  const doc = pocketBar();
  doc.bodies[0].node.mods = []; // the sketch alone, so it shows as a loose profile
  await loadDoc(page, doc);
  // J.Siwek 2.7.4 made the sketch line width a setting and "Thin" (1.0 px) the default; these are the 2.7.3 numbers, which are his "Medium" (1.5 px)
  await run(() => window.__app.setSketchStyle({ width: "medium" }, true));
  // on the model (not being edited): thick lines of the sketch colour, 1.4 px (2.5 px before)
  const modelWidths = await run(() => { const w = new Set(); window.__app.vp.scene.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.uW && o.visible) w.add(u.uW.value); }); return [...w]; });
  expect(modelWidths).toContain(1.4);
  expect(modelWidths).not.toContain(2.5);
  // in the editor: the quads' width in screen pixels
  await run(() => window.__app.enterSketch("s1"));
  await page.waitForFunction(() => window.__app.sketcher.active === "s1" && !window.__app.vp.anim);
  await run(() => window.__app.sketcher.redraw()); // the camera has settled: the lines are drawn for this zoom
  const widths = () => run(() => {
    const sk = window.__app.sketcher, px = sk.px(), seen = new Set();
    for (const o of sk.group.children) {
      const p = o.geometry && o.geometry.attributes.position;
      if (!o.isMesh || !p || p.count % 6 || o.material.opacity !== 1) continue; // thick-line quads, not the filled profile
      const w = Math.hypot(p.getX(0) - p.getX(1), p.getY(0) - p.getY(1), p.getZ(0) - p.getZ(1)) / px;
      seen.add(o.material.color.getHexString() + ":" + Math.round(w * 100) / 100);
    }
    return [...seen];
  });
  // the other wide quads are the axis markers (34 px); a sketch line is under 10
  const lines = async () => (await widths()).map((x) => x.split(":")).map(([hex, w]) => ({ hex, w: +w })).filter((x) => x.w < 10);
  const plain = await lines();
  expect(plain.map((x) => x.w)).toEqual([1.5]); // 2.5 before
  await run(() => { window.__app.sketcher.sel = new Set(["e0"]); window.__app.sketcher.redraw(); });
  const sel = await lines();
  expect(sel.map((x) => x.w).sort()).toEqual([1.5, 2.4]); // the selected line: 3.5 before, still bolder than the others
  expect(sel.find((x) => x.w === 2.4).hex).not.toBe(plain[0].hex);
  await run(() => window.__app.exitSketch());
  await run(() => window.__app.setSketchStyle({ width: "thin" }, true));
});
