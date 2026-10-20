// Smoke tests: the app boots clean, each mode and helper works, the kernel builds real geometry,
// exports produce files, and a saved design comes back after a reload.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, waitIdle, bodies, exportBytes, newDoc, body, prim, stlTriangles, sha256 } from "./helpers.mjs";

const box20 = () => newDoc("Box", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
// top front edge and one vertical edge of that box, in the kernel's edge signature form
const TOP_FRONT = { a: [-10, -10, 20], b: [10, -10, 20], m: [0, -10, 20], n: [0.5, 0, 1], t: "LINE" };
const FRONT_RIGHT = { a: [10, -10, 0], b: [10, -10, 20], m: [10, -10, 10], n: [1, 0, 0.5], t: "LINE" };
// what a 3 mm round on one 20 mm edge removes: (1 - pi/4) r² L
const filletLoss = (r, L) => (1 - Math.PI / 4) * r * r * L;

// one page for the whole file: the kernel loads once; every test loads its own design first
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} }); // skip Chisel's first-visit notice
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

test("boots with the kernel ready and no errors", async () => {
  await expect(page).toHaveTitle(/JumpStart 3D/); // boot() already waited for the kernel and the loading screen; afterEach checks the errors
});

test("About keeps the author's credit and says 2.0", async () => {
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toBeVisible();
  await expect(about).toContainText("Version 2.0");
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

test("Beginner: dragging a shape tile onto the workplane makes a body", async () => {
  await loadDoc(page, newDoc("Drag", "beginner"));
  const tile = page.locator('#shapes .tile[data-kind="box"]');
  await tile.scrollIntoViewIfNeeded();
  const t = await tile.boundingBox();
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  const [x0, y0] = [t.x + t.width / 2, t.y + t.height / 2];
  const [tx, ty] = [vp.x + vp.width / 2, vp.y + vp.height / 2];
  await page.mouse.move(x0, y0 - 20); // straight up first: a sideways start slides the strip instead
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((tx - x0) * i) / 12, y0 - 20 + ((ty - y0 + 20) * i) / 12);
  await page.mouse.up();
  await waitIdle(page);
  const list = await bodies(page);
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  const node = await page.evaluate(() => window.__store.doc.bodies[0].node);
  expect(node.kind).toBe("box");
  expect(list[0].volume).toBeCloseTo(node.p.w * node.p.d * node.p.h, 0); // the dropped box has its default size
});

test("Advanced: a fillet in the document rounds the edge (the kernel works)", async () => {
  const doc = box20();
  doc.bodies[0].node.mods.push({ id: "f1", seq: 2, t: "fillet", r: 3, edges: [TOP_FRONT] });
  await loadDoc(page, doc);
  const [b] = await bodies(page);
  expect(b.error).toBeNull();
  expect(b.volume).toBeCloseTo(8000 - filletLoss(3, 20), 0);
  // remove the fillet with an edit, then undo brings it back
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node.mods = []; }, "test"));
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000, 0);
  await page.evaluate(() => window.__app.undo());
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - filletLoss(3, 20), 0);
});

test("Advanced: the Fillet tool picks an edge on screen and applies it", async () => {
  await loadDoc(page, box20());
  await page.evaluate(() => { const v = window.__app.vp; const V = v.camera.position.constructor; v.animateTo({ az: -Math.PI / 2 + 0.5, el: 0.5, dist: 110, target: new V(0, 0, 10) }, 10); });
  await page.waitForFunction(() => !window.__app.vp.anim); // the camera move has finished
  const at = async (x, y, z) => {
    const r = await page.evaluate(([x, y, z]) => { const v = window.__app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, z)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y, z]);
    await page.mouse.click(r[0], r[1]);
  };
  await page.keyboard.press("f");
  await expect(page.locator("#cmd")).toContainText(/Fillet/);
  await at(0, -10, 20); // the top front edge
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.fill("#ed-val", "3");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  const mods = await page.evaluate(() => window.__store.doc.bodies[0].node.mods.map((m) => ({ t: m.t, r: m.r, edges: m.edges.length })));
  expect(mods).toEqual([{ t: "fillet", r: 3, edges: 1 }]);
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - filletLoss(3, 20), 0);
});

test("Advanced: a chamfer in the document bevels the edge", async () => {
  const doc = box20();
  doc.bodies[0].node.mods.push({ id: "c1", seq: 2, t: "chamfer", d: 2, edges: [FRONT_RIGHT] });
  await loadDoc(page, doc);
  const [b] = await bodies(page);
  expect(b.error).toBeNull();
  expect(b.volume).toBeCloseTo(8000 - 0.5 * 2 * 2 * 20, 0);
});

test("Mesh detail: Fine builds more triangles than Normal", async () => {
  await loadDoc(page, newDoc("Cyl", "beginner", { bodies: [body("b1", "Cylinder", prim("cylinder", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] }));
  const tris = () => page.evaluate(() => window.__app.scene.views.get("b1").data.triangles.length / 3);
  const normal = await tris();
  await page.evaluate(() => window.__app.setMeshDetail("fine", true));
  await waitIdle(page);
  expect(await tris()).toBeGreaterThan(normal);
  await page.evaluate(() => window.__app.setMeshDetail("normal", true));
  await waitIdle(page);
  expect(await tris()).toBe(normal);
});

test("exports STL, OBJ, STEP and the project file", async () => {
  await loadDoc(page, box20());
  const stl = await exportBytes(page, "stl");
  expect(stl.name).toMatch(/\.stl$/);
  expect(stlTriangles(stl.bytes)).toBe(12);
  expect(stl.bytes.length).toBe(84 + 12 * 50);
  const obj = await exportBytes(page, "obj");
  expect(obj.bytes.toString("utf8")).toMatch(/^# JumpStart 3D export/);
  expect(obj.bytes.toString("utf8").match(/^f /gm)).toHaveLength(12);
  const step = await exportBytes(page, "step");
  expect(step.bytes.toString("latin1")).toMatch(/^ISO-10303-21/);
  expect(step.bytes.toString("latin1")).toContain("MANIFOLD_SOLID_BREP");
  const json = await exportBytes(page, "json");
  const parsed = JSON.parse(json.bytes.toString("utf8"));
  expect(parsed.app).toBe("jumpstart-3d");
  expect(parsed.doc.bodies.map((b) => b.name)).toEqual(["Box"]);
});

test("FlexiGen opens on a body and renders", async () => {
  await loadDoc(page, box20());
  await page.evaluate(() => window.__app.flexigen.open("b1"));
  const frame = page.frameLocator("#flexigen iframe");
  await expect(frame.locator("canvas").first()).toBeVisible();
  const helper = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  await helper.waitForFunction(() => !!window.__flexi);
  await page.evaluate(() => window.__app.flexigen.close());
  await expect(page.locator("#flexigen")).toHaveCount(0);
});

test("Mesh to STEP helper opens, renders, and pops out into its own tab", async () => {
  await page.evaluate(() => window.__app.meshstep.open());
  const frame = page.frameLocator(".meshstep iframe");
  await expect(frame.locator("canvas").first()).toBeVisible();
  await page.frames().find((f) => f.parentFrame() === page.mainFrame()).waitForFunction(() => !!window.__meshstep);
  // "Open in a new tab" hands the helper's HTML to a new tab as a blob; it must boot on its own there
  const [popup] = await Promise.all([page.context().waitForEvent("page"), page.click(".meshstep-pop")]);
  await popup.waitForFunction(() => !!window.__meshstep, null, { timeout: 30_000 });
  await expect(popup.locator("canvas").first()).toBeVisible();
  await popup.close();
  await expect(page.locator(".meshstep")).toHaveCount(0); // the pop-out closes the in-page copy
});

test("Chisel opens, adds a sphere and hands it back as a body", async () => {
  await loadDoc(page, newDoc("Sculpt", "beginner"));
  await page.click("#mode-chisel");
  const frame = page.frameLocator("#chisel-host iframe");
  await expect(frame.locator('#shapes .chip[data-shape="sphere"]')).toBeVisible({ timeout: 30_000 });
  await frame.locator('#shapes .chip[data-shape="sphere"]').click();
  await expect(frame.locator("#objList")).not.toHaveText("", { timeout: 30_000 });
  await frame.locator("#js3dSave").click();
  await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.filter((b) => b.sculpt).length), { timeout: 60_000 }).toBe(1);
  await page.click("#mode-beginner");
  await waitIdle(page);
  const [b] = await bodies(page);
  expect(b.volume).toBeGreaterThan(0);
});

test("an imported SVG cannot run code (CodeQL alert #2)", async () => {
  // a 20 mm square plus every way an SVG file could carry code: the import must keep the square and run none of it
  const trap = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20" width="20mm" height="20mm" onload="window.__pwned=1">
  <rect x="0" y="0" width="20" height="20"/>
  <image onerror="window.__pwned=2"/>
  <foreignObject width="1" height="1"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.__pwned=3"/><script>window.__pwned=4</script></body></foreignObject>
  <a xlink:href="javascript:window.__pwned=5"><path d="M0 0 L5 5"/></a>
  <animate attributeName="x" onbegin="window.__pwned=6" dur="1s"/>
</svg>`;
  await loadDoc(page, newDoc("Trap", "beginner"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => { window.__app.insertFile("svg"); })]); // no return value: the call only resolves once a file is picked
  await chooser.setFiles({ name: "trap.svg", mimeType: "image/svg+xml", buffer: Buffer.from(trap) });
  await expect(page.locator("#cmd")).toContainText("Insert SVG");
  await expect(page.locator("#cmd")).toContainText("5 curves"); // the square's four sides and the path inside the link
  await page.click("#cmd-ok");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  await page.waitForTimeout(500); // give any handler that slipped through time to fire
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.evaluate(() => window.__store.doc.sketches[0].ents.length)).toBe(5);
  await page.evaluate(() => window.__app.exitSketch());
});

test("a saved design comes back after a reload", async ({}, info) => {
  await loadDoc(page, newDoc("Restore me", "beginner", { bodies: [body("b1", "Keeper", prim("box", { w: 10, d: 10, h: 10, r: 0, c: 0 }))] }));
  await page.evaluate(() => window.__app.projects.saveNow());
  await boot(page, info);
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Restore me");
  expect((await bodies(page)).map((b) => b.name)).toEqual(["Keeper"]);
});

// ---- named parameters driving sketch dimensions (Phase P step 1) ----
const parametric = () => JSON.parse(readFileSync(new URL("./projects/parametric-plate.json", import.meta.url), "utf8"));
const setParam = (name, expr) => page.evaluate(([name, expr]) => window.__store.update((d) => { d.params.find((p) => p.name === name).expr = expr; }, "Edit parameter"), [name, expr]);
const paramState = () => page.evaluate(() => {
  const d = window.__store.doc, sk = d.sketches[0], pt = (id) => sk.pts.find((p) => p.id === id);
  return { params: d.params.map((p) => ({ name: p.name, value: p.value })), dims: sk.cons.filter((c) => c.t === "dim").map((c) => c.v), p1x: pt("p1").x, p2y: pt("p2").y };
});
const stlHash = async () => { const stl = await exportBytes(page, "stl"); return { hash: sha256(stl.bytes), tris: stlTriangles(stl.bytes) }; };
const paramValue = (name) => page.locator("#browser .param", { has: page.locator(`input.param-name[value="${name}"]`) }).locator(".pv"); // re-queried each time: the panel is rebuilt on every store event

test("Parameters: changing w changes the volume and the STL, undo brings both back", async () => {
  await loadDoc(page, parametric());
  let list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(12000, 0);
  const a = await stlHash();
  expect(a.tris).toBe(12);

  await setParam("w", "60");
  await waitIdle(page);
  list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(27000, 0); // 60 x 30 x 15: h = w/2 follows
  const s = await paramState();
  expect(s.params.map((p) => p.value)).toEqual([60, 30]);
  expect(s.dims).toEqual([60, 30]);
  expect(s.p1x).toBeCloseTo(60, 6);
  expect(s.p2y).toBeCloseTo(30, 6);
  const b = await stlHash();
  expect(b.tris).toBe(12);
  expect(b.hash).not.toBe(a.hash);

  await page.evaluate(() => window.__app.undo()); // one step: parameter, dimensions and points together
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
  const u = await paramState();
  expect(u.params.map((p) => p.value)).toEqual([40, 20]);
  expect(u.dims).toEqual([40, 20]);
  expect((await stlHash()).hash).toBe(a.hash);
});

test("Parameters: a bad expression keeps the last good shape and shows 'error'", async () => {
  await loadDoc(page, parametric());
  await setParam("w", "nope*2");
  await waitIdle(page);
  const list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(12000, 0);
  expect((await paramState()).dims).toEqual([40, 20]);
  await expect(page.locator("#browser")).toBeVisible();
  await expect(paramValue("w")).toContainText("error");
  await setParam("w", "50");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(50 * 25 * 15, 0);
  await expect(paramValue("w")).not.toContainText("error");
});

test("Parameters: the sidebar adds a parameter and evaluates what is typed", async () => {
  await loadDoc(page, parametric());
  const rows = page.locator("#browser .param");
  await expect(rows).toHaveCount(2);
  await page.click("#browser .param-add");
  await expect(rows).toHaveCount(3);
  expect(await page.evaluate(() => window.__store.doc.params.length)).toBe(3);
  await rows.nth(2).locator("input.param-expr").fill("w+5");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__store.doc.params[2].value)).toBeCloseTo(45, 6);
});

test("Parameters: opening in inches does not rescale a design typed in mm", async () => {
  await loadDoc(page, parametric());
  await page.click("#unit-toggle"); // the status-bar mm / in switch
  try {
    await expect(page.locator("#unit-toggle")).toContainText("in");
    await page.evaluate(() => window.__store.update((d) => { d.bodies[0].name = "Plate 2"; }, "Rename")); // any unrelated edit re-evaluates
    await waitIdle(page);
    expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
    expect((await paramState()).params.map((p) => p.value)).toEqual([40, 20]);
    // with a name in it, a bare number is a plain number even in inches: w/4 is a quarter of w
    await page.locator("#browser .param").nth(1).locator("input.param-expr").fill("w/4");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.__store.doc.params[1].value)).toBeCloseTo(10, 6);
    await waitIdle(page);
    expect((await bodies(page))[0].volume).toBeCloseTo(40 * 10 * 15, 0);
    // with no name, a number typed in inches is read as inches, and the unit is kept with it
    await page.locator("#browser .param").nth(0).locator("input.param-expr").fill("2");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.__store.doc.params[0].value)).toBeCloseTo(50.8, 6);
    expect(await page.evaluate(() => window.__store.doc.params[0].unit)).toBe("in");
    await waitIdle(page);
    expect((await bodies(page))[0].volume).toBeCloseTo(50.8 * 12.7 * 15, 0);
  } finally {
    if ((await page.locator("#unit-toggle").textContent()).includes("in")) await page.click("#unit-toggle");
  }
});

test("Parameters: renaming a parameter follows it into other parameters and dimensions", async () => {
  await loadDoc(page, parametric());
  const name = page.locator("#browser .param").nth(0).locator("input.param-name");
  await name.fill("width");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__store.doc.params[0].name)).toBe("width");
  const d = await page.evaluate(() => ({ h: window.__store.doc.params[1].expr, dims: window.__store.doc.sketches[0].cons.filter((c) => c.t === "dim").map((c) => c.expr) }));
  expect(d.h).toBe("width/2");
  expect(d.dims).toEqual(["width", "h"]);
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
});

test("Parameters: typing an expression into a dimension's value box binds it", async () => {
  await loadDoc(page, parametric());
  await page.evaluate(() => window.__app.enterSketch("s1"));
  try {
    await page.evaluate(() => window.__app.sketcher.editDim("d1"));
    await page.fill("#prompt-value", "w/4");
    await page.press("#prompt-value", "Enter");
    await waitIdle(page);
    const d1 = await page.evaluate(() => window.__store.doc.sketches[0].cons.find((c) => c.id === "d1"));
    expect(d1.expr).toBe("w/4");
    expect(d1.v).toBeCloseTo(10, 6);
    await expect(page.locator(".dimlabel", { hasText: "w/4 = 10" })).toBeVisible();
    expect((await bodies(page))[0].volume).toBeCloseTo(10 * 20 * 15, 0);
  } finally {
    await page.evaluate(() => window.__app.exitSketch());
  }
});

// ---- feature values follow named parameters (Phase P step 2) ----
// t = 15 (extrude distance), d = 6 (through hole), f = 2 (fillet on one vertical edge)
const features = () => JSON.parse(readFileSync(new URL("./projects/parametric-features.json", import.meta.url), "utf8"));
const featureVol = (t = 15, d = 6, f = 2) => 40 * 20 * t - Math.PI * (d / 2) ** 2 * t - (1 - Math.PI / 4) * f * f * t;
const featureNode = () => page.evaluate(() => { const n = window.__store.doc.bodies[0].node; return { dist: n.dist, exprs: n.exprs, mods: n.mods.map((m) => ({ t: m.t, dia: m.dia, r: m.r, exprs: m.exprs })) }; });

test("Parameters: changing t moves the extrude distance, the volume and the STL; undo brings them back", async () => {
  await loadDoc(page, features());
  let list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(featureVol(), 0);
  const a = await stlHash();
  await setParam("t", "30");
  await waitIdle(page);
  list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(featureVol(30), 0);
  expect((await featureNode()).dist).toBe(30);
  expect((await stlHash()).hash).not.toBe(a.hash);
  await page.evaluate(() => window.__app.undo());
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(featureVol(), 0);
  expect((await featureNode()).dist).toBe(15);
  expect((await stlHash()).hash).toBe(a.hash);
});

test("Parameters: changing d resizes the hole, changing f resizes the fillet", async () => {
  await loadDoc(page, features());
  await setParam("d", "10");
  await waitIdle(page);
  let list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(featureVol(15, 10), 0);
  expect((await featureNode()).mods[0].dia).toBe(10);
  await setParam("f", "4");
  await waitIdle(page);
  list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(featureVol(15, 10, 4), 0);
  expect((await featureNode()).mods[1].r).toBe(4);
});

test("Parameters: a bad expression for t keeps the last shape and shows 'error'", async () => {
  await loadDoc(page, features());
  await setParam("t", "nope*2");
  await waitIdle(page);
  const list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(featureVol(), 0);
  expect((await featureNode()).dist).toBe(15);
  expect((await featureNode()).exprs).toEqual({ dist: "t" }); // still bound
  await expect(paramValue("t")).toContainText("error");
});

test("Parameters: renaming a parameter follows it into features; deleting one unbinds them", async () => {
  await loadDoc(page, features());
  const t = page.locator("#browser .param", { has: page.locator('input.param-name[value="t"]') });
  await t.locator("input.param-name").fill("thick");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await featureNode()).exprs).toEqual({ dist: "thick" });
  await page.locator('#browser button[aria-label="Delete thick"]').click();
  await expect.poll(async () => (await featureNode()).exprs).toBeUndefined();
  const n = await featureNode();
  expect(n.dist).toBe(15); // the number stays
  expect(n.mods.map((m) => m.exprs)).toEqual([{ dia: "d" }, { r: "f" }]); // the others are untouched
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(featureVol(), 0);
});

test("Parameters: the Extrude dialog takes an expression for the distance and keeps it", async () => {
  await loadDoc(page, features());
  await page.locator('.tl-item[aria-label^="Extrude"]').dblclick();
  const dist = page.locator("#ex-dist");
  await expect(dist).toHaveValue("t");
  await expect(dist).toHaveClass(/fx/);
  await dist.fill("t*2");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  await waitIdle(page);
  const n = await featureNode();
  expect(n.exprs).toEqual({ dist: "t*2" });
  expect(n.dist).toBe(30);
  expect((await bodies(page))[0].volume).toBeCloseTo(featureVol(30), 0);
  await expect(page.locator('.tl-item[aria-label="Extrude (dist = t*2)"]')).toHaveCount(1);
});

test("Parameters: fillet and hole dialogs take expressions; a chamfer (also with a sets list) and a shell follow a parameter", async () => {
  await loadDoc(page, features());
  await page.locator('.tl-item[aria-label^="Fillet"]').dblclick();
  await expect(page.locator("#ed-val")).toHaveValue("f");
  await page.fill("#ed-val", "f*2");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  await page.locator('.tl-item[aria-label^="Hole"]').dblclick();
  await expect(page.locator("#hole-dia")).toHaveValue("d");
  await page.fill("#hole-dia", "d+2");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  await waitIdle(page);
  const n = await featureNode();
  expect(n.mods.map((m) => [m.exprs, m.r, m.dia])).toEqual([[{ dia: "d+2" }, undefined, 8], [{ r: "f*2" }, 4, undefined]]);
  expect((await bodies(page))[0].volume).toBeCloseTo(featureVol(15, 8, 4), 0);

  const doc = box20();
  doc.params = [{ id: "q1", name: "c", expr: "3", value: 3 }, { id: "q2", name: "w", expr: "1.5", value: 1.5 }, { id: "q3", name: "a", expr: "90", value: 90 }];
  doc.bodies[0].node.mods.push({ id: "c1", seq: 2, t: "chamfer", d: 2, edges: [FRONT_RIGHT], exprs: { d: "c" } });
  await loadDoc(page, doc);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - 0.5 * 3 * 3 * 20, 0);
  await setParam("c", "4");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - 0.5 * 4 * 4 * 20, 0);

  // with a sets list the kernel reads sets[0].r, so that is where the new size goes
  doc.bodies[0].node.mods[0] = { id: "c1", seq: 2, t: "chamfer", d: 2, edges: [FRONT_RIGHT], sets: [{ edges: [FRONT_RIGHT], r: 2, rt: "const" }], exprs: { d: "c" } };
  await loadDoc(page, doc);
  await setParam("c", "4");
  await waitIdle(page);
  expect((await page.evaluate(() => window.__store.doc.bodies[0].node.mods[0].sets[0].r))).toBe(4);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - 0.5 * 4 * 4 * 20, 0);

  doc.bodies[0].node.mods = [{ id: "s1", seq: 2, t: "shell", th: 2, faces: [], exprs: { th: "w" } }];
  await loadDoc(page, doc);
  const v1 = (await bodies(page))[0].volume;
  expect(v1).toBeCloseTo(8000 - 17 ** 3, 0);
  await setParam("w", "3");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(8000 - 14 ** 3, 0);
});

test("Parameters: a revolve angle follows a parameter and an out-of-range value is skipped", async () => {
  const doc = features();
  doc.params.push({ id: "q6", name: "a", expr: "360", value: 360 });
  doc.sketches[0].cons = doc.sketches[0].cons.map((c) => (c.id === "d1" ? { ...c, expr: undefined, v: 40 } : c));
  doc.bodies[0].node = { t: "revolve", sketch: "s1", profiles: doc.bodies[0].node.profiles, axis: "X", angle: 360, exprs: { angle: "a" }, mods: [] };
  await loadDoc(page, doc);
  expect((await bodies(page))[0].volume).toBeCloseTo(Math.PI * 20 * 20 * 40, 0);
  await setParam("a", "180");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo((Math.PI * 20 * 20 * 40) / 2, 0);
  await setParam("a", "400"); // out of range: keeps 180
  await waitIdle(page);
  expect((await page.evaluate(() => window.__store.doc.bodies[0].node.angle))).toBe(180);
});

test("Parameters: typing a plain number into a bound distance box removes the binding", async () => {
  await loadDoc(page, features());
  await page.locator('.tl-item[aria-label^="Extrude"]').dblclick();
  await expect(page.locator("#ex-dist")).toHaveClass(/fx/);
  await page.fill("#ex-dist", "20");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);
  await waitIdle(page);
  expect((await featureNode()).dist).toBe(20);
  expect(await page.evaluate(() => "exprs" in window.__store.doc.bodies[0].node)).toBe(false); // the key is gone, not left as {}
  expect((await bodies(page))[0].volume).toBeCloseTo(featureVol(20), 0);
});

test("Parameters: the copy kept by Mirror with Join follows t and its renames", async () => {
  const doc = features();
  const node = doc.bodies[0].node;
  node.mods.push({ id: "m1", seq: 5, t: "bool", op: "join", tool: { t: "mirror", src: JSON.parse(JSON.stringify(node)), srcM: doc.bodies[0].m.slice(), plane: { o: [0, 0, 0], n: [1, 0, 0] }, mods: [] }, m: doc.bodies[0].m.slice() });
  await loadDoc(page, doc);
  const src = () => page.evaluate(() => { const s = window.__store.doc.bodies[0].node.mods[2].tool.src; return { dist: s.dist, exprs: s.exprs }; });
  let list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(2 * featureVol(), 0);
  await setParam("t", "30");
  await waitIdle(page);
  list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(2 * featureVol(30), 0); // both halves grew
  expect((await src()).dist).toBe(30);
  await page.locator("#browser .param", { has: page.locator('input.param-name[value="t"]') }).locator("input.param-name").fill("thick");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await src()).exprs).toEqual({ dist: "thick" });
});

// ---- Beginner shapes follow named parameters (Phase P step 3) ----
// a plate (box 40 x w/2 x 20) with a hole of diameter h/2 through it; w = 40, h = 20
const beginnerDoc = () => JSON.parse(readFileSync(new URL("./projects/parametric-beginner.json", import.meta.url), "utf8"));
const plateVol = (w = 40, h = 20) => w * (w / 2) * h - Math.PI * (h / 4) ** 2 * h;
// the same box on its own (a shape the Beginner inspector shows Width, Depth and Height for)
const lone = () => { const doc = beginnerDoc(); doc.bodies[0].node = doc.bodies[0].node.children[0].node; return doc; };
const kids = () => page.evaluate(() => window.__store.doc.bodies[0].node.children.map((c) => ({ p: c.node.p, exprs: c.node.exprs, exprUnits: c.node.exprUnits })));
const loneNode = () => page.evaluate(() => { const n = window.__store.doc.bodies[0].node; return { p: n.p, exprs: n.exprs, exprUnits: n.exprUnits, hasExprs: "exprs" in n }; });
const selectBody = async (id = "b1") => { await page.evaluate((id) => window.__app.select([id]), id); await expect(page.locator("#inspector")).toBeVisible(); };

test("Parameters: Beginner sizes follow w, and undo brings the shape and the STL back in one step", async () => {
  await loadDoc(page, beginnerDoc());
  let list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(plateVol(), 0);
  const a = await stlHash();
  await setParam("w", "60");
  await waitIdle(page);
  list = await bodies(page);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeCloseTo(plateVol(60), 0);
  expect((await kids())[0].p).toMatchObject({ w: 60, d: 30, h: 20 });
  const b = await stlHash();
  expect(b.hash).not.toBe(a.hash);
  await setParam("h", "24"); // the hole follows h/2 as well: w and d of the cylinder (its 30 mm height still passes through)
  await waitIdle(page);
  expect((await kids())[1].p).toMatchObject({ w: 12, d: 12 });
  expect((await bodies(page))[0].volume).toBeCloseTo(plateVol(60, 24), 0);
  await page.evaluate(() => { window.__app.undo(); window.__app.undo(); });
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(plateVol(), 0);
  expect((await stlHash()).hash).toBe(a.hash);
  await page.evaluate(() => window.__app.redo());
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(plateVol(60), 0);
});

test("Parameters: a bad expression for w keeps the Beginner shape, shows 'error' and keeps the binding", async () => {
  await loadDoc(page, lone());
  await setParam("w", "nope*2");
  await waitIdle(page);
  expect((await bodies(page))[0].error).toBeNull();
  expect((await bodies(page))[0].volume).toBeCloseTo(40 * 20 * 20, 0);
  expect((await loneNode()).exprs).toEqual({ w: "w", d: "w/2", h: "h" });
  await selectBody();
  await expect(page.locator("#insp-params .param", { has: page.locator('input.param-name[value="w"]') }).locator(".pv")).toContainText("error");
});

test("Parameters: renaming w follows into Beginner sizes, deleting h unbinds only h", async () => {
  await loadDoc(page, beginnerDoc());
  await selectBody();
  await page.locator('#insp-params input.param-name[value="w"]').fill("width");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await kids())[0].exprs).toEqual({ w: "width", d: "width/2", h: "h" });
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(plateVol(), 0);
  await page.locator('#insp-params button[aria-label="Delete h"]').click();
  await expect.poll(async () => (await kids())[0].exprs).toEqual({ w: "width", d: "width/2" });
  const k = await kids();
  expect(k[0].p.h).toBe(20); // the number stays
  expect(k[1].exprs).toBeUndefined(); // its only bindings were h/2, so the map is gone, not left as {}
  expect(k[1].p).toMatchObject({ w: 10, d: 10 });
  await page.locator('#insp-params button[aria-label="Delete width"]').click();
  await expect.poll(async () => (await kids())[0].exprs).toBeUndefined();
});

test("Parameters: typing an expression into the Beginner Width box binds it, a number unbinds it", async () => {
  await loadDoc(page, lone());
  await selectBody();
  await expect(page.locator("#insp-w")).toHaveClass(/fx/);
  await expect(page.locator("#insp-w")).toHaveValue("w");
  await page.fill("#insp-w", "w*2");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).p.w).toBe(80);
  let n = await loneNode();
  expect(n.exprs).toEqual({ w: "w*2", d: "w/2", h: "h" });
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(80 * 20 * 20, 0);
  await expect(page.locator("#insp-w")).toHaveValue("w*2");
  await setParam("w", "50"); // 100 wide, depth 25
  await waitIdle(page);
  n = await loneNode();
  expect(n.p).toMatchObject({ w: 100, d: 25 });
  await page.fill("#insp-w", "50");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).exprs).toEqual({ d: "w/2", h: "h" });
  expect((await loneNode()).p.w).toBe(50);
  await page.fill("#insp-d", "7");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).exprs).toEqual({ h: "h" });
  await page.fill("#insp-h", "7");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).hasExprs).toBe(false);
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); // a box left focused would send its text into the next design
});

test("Parameters: resizing a Beginner shape without an expression drops the binding for that size only", async () => {
  await loadDoc(page, lone());
  await selectBody();
  await page.locator("#viewport canvas").first().focus();
  await page.keyboard.press("Tab"); // type a size on the shape, like Tinkercad: Width first
  await expect(page.locator("#dim-input")).toBeVisible();
  await page.fill("#dim-input", "70");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).p.w).toBe(70);
  expect((await loneNode()).exprs).toEqual({ d: "w/2", h: "h" });
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(70 * 20 * 20, 0);
  await setParam("w", "60"); // d follows, w no longer does
  await waitIdle(page);
  expect((await loneNode()).p).toMatchObject({ w: 70, d: 30 });
});

test("Parameters: a Beginner design opened in Advanced keeps its bindings and w still drives it", async () => {
  await loadDoc(page, lone());
  await page.click("#mode-advanced");
  await waitIdle(page);
  expect((await loneNode()).exprs).toEqual({ w: "w", d: "w/2", h: "h" });
  await setParam("w", "60");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(60 * 30 * 20, 0);
  await expect(page.locator('.tl-item[aria-label^="Box"]')).toHaveAttribute("aria-label", /w = w/);
  // the Advanced Box dialog shows the bindings; a number typed over one drops just that one
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.locator("#browser .props button", { hasText: "Edit" }).click();
  await expect(page.locator("#pr-w")).toHaveValue("w");
  await expect(page.locator("#pr-w")).toHaveClass(/fx/);
  await page.fill("#pr-h", "30");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).p.h).toBe(30);
  expect((await loneNode()).exprs).toEqual({ w: "w", d: "w/2" });
  await page.click("#mode-beginner");
  await waitIdle(page);
  expect((await loneNode()).exprs).toEqual({ w: "w", d: "w/2" });
});

test("Parameters: the Beginner inspector lists parameters and adds one", async () => {
  await loadDoc(page, lone());
  await selectBody();
  const rows = page.locator("#insp-params .param");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator(".pv")).toContainText("40");
  await page.locator("#insp-params .param-add").click();
  await expect(rows).toHaveCount(3);
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => p.name))).toEqual(["w", "h", "p3"]);
  await page.fill("#insp-w", "p3*2"); // a new parameter is available to the size boxes at once
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).exprs.w).toBe("p3*2");
  expect((await loneNode()).p.w).toBe(20); // p3 = 10
});

test("Parameters: ungrouping a resized group drops the bindings of the sizes it stretched", async () => {
  const doc = beginnerDoc();
  doc.bodies[0].node.mods = [{ id: "f1", seq: 3, t: "scale", k: [2, 1, 1], o: [0, 0, 0] }]; // what typing 80 into the group Width box leaves behind
  await loadDoc(page, doc);
  await selectBody();
  await page.locator("#inspector button", { hasText: "Ungroup" }).click();
  await expect.poll(async () => page.evaluate(() => window.__store.doc.bodies.length)).toBe(2);
  const nodes = await page.evaluate(() => window.__store.doc.bodies.map((b) => b.node));
  const box = nodes.find((n) => n.kind === "box"), cyl = nodes.find((n) => n.kind === "cylinder");
  expect(box.p.w).toBe(80);
  expect(box.exprs).toEqual({ d: "w/2", h: "h" }); // w is free, d and h still follow
  expect(cyl.p.w).toBe(20);
  expect(cyl.exprs).toEqual({ d: "h/2" });
  await waitIdle(page);
  expect((await bodies(page)).find((b) => b.name === "Box 1").volume).toBeCloseTo(80 * 20 * 20, 0);
});

test("Parameters: undoing a bind that did not change the number redraws the Beginner box", async () => {
  await loadDoc(page, lone());
  await selectBody();
  await page.fill("#insp-w", "40"); // the same 40 mm, but no longer a name
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).exprs).toEqual({ d: "w/2", h: "h" });
  await expect(page.locator("#insp-w")).not.toHaveClass(/fx/);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__app.undo(); });
  await expect(page.locator("#insp-w")).toHaveValue("w");
  await expect(page.locator("#insp-w")).toHaveClass(/fx/);
});

test("Parameters: a Beginner size below 0.01 mm is skipped and the shape keeps its size", async () => {
  await loadDoc(page, lone());
  await selectBody();
  await page.locator('#insp-params input.param-expr').first().fill("0.005");
  await page.keyboard.press("Enter");
  await expect(page.locator("#toasts .toast", { hasText: "size(s)" })).toBeVisible();
  await waitIdle(page);
  expect((await loneNode()).p).toMatchObject({ w: 40, d: 20, h: 20 });
  expect((await bodies(page))[0].volume).toBeCloseTo(40 * 20 * 20, 0);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
});

test("Parameters: the Advanced Box dialog takes an expression for Width", async () => {
  await loadDoc(page, lone());
  await page.click("#mode-advanced");
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.locator("#browser .props button", { hasText: "Edit" }).click();
  await page.fill("#pr-w", "w+5");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await loneNode()).p.w).toBe(45);
  expect((await loneNode()).exprs).toEqual({ w: "w+5", d: "w/2", h: "h" });
  await page.click("#mode-beginner");
  await waitIdle(page);
});

test("Parameters: dragging a Beginner resize handle frees that size and keeps the others bound", async () => {
  await loadDoc(page, lone());
  await selectBody();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await waitIdle(page);
  // the handle in the middle of the +x edge: where it is on screen, and where 10 mm further along x is
  const pts = await page.evaluate(() => {
    const a = window.__app, vp = a.vp;
    let h = null;
    vp.overlay.traverse((o) => { const i = o.userData && o.userData.handle; if (i && i.type === "size" && i.sx === 1 && i.sy === 0 && o.visible) h = o; });
    if (!h) return null;
    const r = vp.canvas.getBoundingClientRect();
    const scr = (v) => { const p = v.clone().project(vp.camera); return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height]; };
    const w = h.getWorldPosition(h.position.clone());
    return { from: scr(w), to: scr(w.clone().setX(w.x + 10)) };
  });
  expect(pts).not.toBeNull();
  await page.mouse.move(...pts.from);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(pts.from[0] + ((pts.to[0] - pts.from[0]) * i) / 10, pts.from[1] + ((pts.to[1] - pts.from[1]) * i) / 10);
  await page.mouse.up();
  await expect.poll(async () => (await loneNode()).p.w).toBeGreaterThan(45);
  const n = await loneNode();
  expect(n.exprs).toEqual({ d: "w/2", h: "h" });
  expect(n.p.h).toBe(20);
});
