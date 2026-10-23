// Smoke tests: the app boots clean, each mode and helper works, the kernel builds real geometry,
// exports produce files, and a saved design comes back after a reload.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { VERSION, BUILD } from "../src/version.js";
import { boot, buildOf, watchErrors, loadDoc, waitIdle, bodies, exportBytes, newDoc, body, prim, stlTriangles, sha256, quarantine } from "./helpers.mjs";

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

test("icon links: files on the site, data URIs in the single file", async ({}, info) => {
  const hrefs = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (ls) => ls.map((l) => l.getAttribute("href")));
  expect(hrefs.length).toBe(3);
  const singleTypes = [/^data:image\/svg\+xml;base64,/, /^data:image\/png;base64,/, /^data:image\/png;base64,/]; // document order: svg, 32 px png, apple-touch png
  for (const [i, href] of hrefs.entries()) {
    if (buildOf(info) === "single") { expect(href).toMatch(singleTypes[i]); continue; }
    expect(href).not.toMatch(/^(data:|https?:)/);
    const r = await page.request.get(new URL(href, info.project.use.baseURL).href);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe(href.endsWith(".svg") ? "image/svg+xml" : "image/png");
    const body = await r.body();
    expect(body.length).toBeGreaterThan(100);
    if (href.endsWith(".png")) { const side = href === "favicon-32.png" ? 32 : 180; expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([side, side]); }
  }
});

test("About keeps the author's credit and matches the source splash version", async () => {
  const expected = `Version ${VERSION} · community build ${BUILD}`;
  const source = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  const splashVersion = await page.evaluate((html) => new DOMParser().parseFromString(html, "text/html").querySelector("#sp-ver")?.textContent, source);
  expect(splashVersion).toBe(expected);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toBeVisible();
  await expect(about).toContainText(expected);
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

// quarantined: the handle drag does not move the size in WebKit (mouse events on the canvas); not looked into yet
test("Parameters: dragging a Beginner resize handle frees that size and keeps the others bound", async ({}, info) => {
  quarantine(info, ["site-webkit", "single-webkit"], "the handle drag does not move the size in WebKit");
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

// Beginner inspector: type a number, press Enter, then click elsewhere. The box must act once
// (one change in the design, one undo step), not again when it loses focus.
const typeThenClickAway = async (id, text) => {
  await page.locator("#" + id).fill(text);
  await page.keyboard.press("Enter");
  await waitIdle(page);
  await page.locator("#inspector .subhead").first().click();
  await waitIdle(page);
};
const bodiesJson = () => page.evaluate(() => JSON.stringify(window.__store.doc.bodies));
const undoOnce = async () => { await page.evaluate(() => window.__app.undo()); await waitIdle(page); };

test("Beginner: a group's Width, Depth and Height act once when you press Enter and click away", async () => {
  // two 20 mm boxes side by side: a 40 x 20 x 20 group
  const child = (name, x) => ({ node: prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1], hole: false, name, color: "#3b82c4" });
  const doc = newDoc("Wide group", "beginner", { bodies: [body("g1", "Group", { t: "group", children: [child("Box 1", -10), child("Box 2", 10)], mods: [] })] });
  for (const [i, from] of [[0, 40], [1, 20], [2, 20]]) {
    await loadDoc(page, doc);
    await page.evaluate(() => window.__app.select(["g1"]));
    const before = await bodiesJson();
    await expect(page.locator("#insp-s" + i)).toHaveValue(String(from));
    await typeThenClickAway("insp-s" + i, String(from * 2));
    await expect(page.locator("#insp-s" + i)).toHaveValue(String(from * 2)); // the box shows the new size once the mesh lands
    const scales = await page.evaluate(() => window.__store.doc.bodies[0].node.mods.filter((m) => m.t === "scale").map((m) => m.k));
    expect(scales).toHaveLength(1);
    scales[0].forEach((k, j) => expect(k).toBeCloseTo(j === i ? 2 : 1, 6));
    await undoOnce(); // one commit means one undo step
    expect(await bodiesJson()).toBe(before);
  }
  // stretch again: the box has the new size, so 100 is 2.5 times the 40 mm shown, not 100 / 40 on top of 80
  await loadDoc(page, doc);
  await page.evaluate(() => window.__app.select(["g1"]));
  await typeThenClickAway("insp-s0", "80");
  await typeThenClickAway("insp-s0", "100");
  const width = () => page.evaluate(() => { const b = window.__app.scene.views.get("g1").data.bbox; return b.max[0] - b.min[0]; });
  expect(await width()).toBeCloseTo(100, 1);
  const chained = await page.evaluate(() => window.__store.doc.bodies[0].node.mods.map((m) => m.k));
  expect(chained).toHaveLength(1);
  expect(chained[0][0]).toBeCloseTo(2.5, 6);
  // text half-typed in another box survives the redraw when the new mesh lands
  await page.locator("#insp-s1").fill("30");
  await page.evaluate(() => window.__app.scene.onRefresh());
  await waitIdle(page);
  await expect(page.locator("#insp-s1")).toHaveValue("30");
  await page.keyboard.press("Escape"); // drop the unsent text before the next design replaces this one
  // a box that already carries a Scale feature shows the same Size boxes
  const scaled = newDoc("Scaled box", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }, [{ id: "f1", seq: 1, t: "scale", k: [1, 1, 1], o: [0, 0, 0] }]))] });
  await loadDoc(page, scaled);
  await page.evaluate(() => window.__app.select(["b1"]));
  const before = await bodiesJson();
  await typeThenClickAway("insp-s0", "40");
  expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods.map((m) => m.k))).toEqual([[2, 1, 1]]);
  await undoOnce();
  expect(await bodiesJson()).toBe(before);
});

test("Beginner: a shape's size and position boxes act once when you press Enter and click away", async () => {
  const doc = newDoc("Lone box", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))] });
  for (const [id, text] of [["insp-w", "30"], ["insp-d", "30"], ["insp-h", "30"], ["insp-pos0", "15"], ["insp-pos1", "15"], ["insp-pos2", "15"]]) {
    await loadDoc(page, doc);
    await page.evaluate(() => window.__app.select(["b1"]));
    const before = await bodiesJson();
    await typeThenClickAway(id, text);
    const after = await bodiesJson();
    expect(after, id).not.toBe(before);
    await undoOnce();
    expect(await bodiesJson(), id).toBe(before);
  }
});

// ---- Pattern as an editable feature (Phase P step 4) ----
// "Bar" (box 80 x 30 x 10) with one 6 mm through hole and a rectangular Pattern of it: n = 4 copies, sp = 20 apart (x = -30..30).
// "Ring" (box 10 x 10 x 10) with a circular Pattern of the whole shape: 6 around the origin.
const patDoc = () => JSON.parse(readFileSync(new URL("./projects/advanced-pattern-mod.json", import.meta.url), "utf8"));
const holeVol = (dia = 6) => Math.PI * (dia / 2) ** 2 * 10; // one hole through the 10 mm bar
const barVol = (holes, dia = 6) => 24000 - holes * holeVol(dia);
const patBar = async () => (await bodies(page)).find((b) => b.name === "Bar");
const patMod = () => page.evaluate(() => window.__store.doc.bodies[0].node.mods.find((m) => m.t === "pattern"));
// the Bar alone, with only its hole (no Pattern), for making one through the dialog
const holeOnly = () => { const d = patDoc(); d.bodies = [d.bodies[0]]; d.bodies[0].node.mods = [d.bodies[0].node.mods[0]]; d.params = []; return d; };
const closed = () => expect.poll(() => page.evaluate(() => !window.__app.command)).toBe(true);

test("Pattern: the count and spacing follow parameters, and one undo brings the shape and the STL back", async () => {
  await loadDoc(page, patDoc());
  let list = await bodies(page);
  expect(list.filter((b) => b.error)).toEqual([]);
  expect((await patBar()).volume).toBeCloseTo(barVol(4), 0);
  const a = await stlHash();
  // n = 6 needs a closer spacing to stay on the bar: both change in one step
  await page.evaluate(() => window.__store.update((d) => { d.params.find((p) => p.name === "n").expr = "6"; d.params.find((p) => p.name === "sp").expr = "12"; }, "Edit parameters"));
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await patBar()).volume).toBeCloseTo(barVol(6), 0); // two more holes
  const m = await patMod();
  expect([m.n1, m.s1]).toEqual([6, 12]);
  const b = await stlHash();
  expect(b.hash).not.toBe(a.hash);
  expect(b.tris).toBeGreaterThan(a.tris);
  await undoOnce();
  expect((await patBar()).volume).toBeCloseTo(barVol(4), 0);
  expect((await stlHash()).hash).toBe(a.hash);
});

test("Pattern: double-click it in the timeline, type a plain count, and the binding goes", async () => {
  await loadDoc(page, patDoc());
  await expect(page.locator('.tl-item[aria-label="Pattern (n1 = n, s1 = sp)"]')).toHaveCount(1);
  await page.locator('.tl-item[aria-label^="Pattern"]').first().dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Pattern");
  await expect(page.locator("#pt-n1")).toHaveValue("n");
  await expect(page.locator("#pt-n1")).toHaveClass(/fx/);
  await expect(page.locator("#pt-s1")).toHaveValue("sp");
  await page.fill("#pt-n1", "3");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  const m = await patMod();
  expect(m.n1).toBe(3);
  expect(m.exprs).toEqual({ s1: "sp" }); // n1 is gone, the spacing is still bound
  expect(m.feats).toEqual(["f1"]);
  expect((await patBar()).volume).toBeCloseTo(barVol(3), 0);
  await expect(page.locator('.tl-item[aria-label="Pattern (s1 = sp)"]')).toHaveCount(1);
});

test("Pattern: editing the source hole changes every copy; deleting it leaves a pattern that does nothing", async () => {
  await loadDoc(page, patDoc());
  await page.locator('.tl-item[aria-label^="Hole"]').dblclick();
  await page.fill("#hole-dia", "10");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await patBar()).volume).toBeCloseTo(barVol(4, 10), 0); // all four holes are 10 mm now
  await page.locator('.tl-item[aria-label^="Hole"]').dblclick();
  await page.locator("#cmd footer .btn.danger").click(); // Delete
  await closed();
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await patBar()).volume).toBeCloseTo(24000, 0);
  expect((await patMod()).t).toBe("pattern"); // still on the timeline
  await undoOnce();
  expect((await patBar()).volume).toBeCloseTo(barVol(4, 10), 0);
});

test("Pattern: it follows the body when the body is moved and turned 30 degrees, and still edits", async () => {
  await loadDoc(page, patDoc());
  const a = await stlHash();
  // 30 degrees about z, then 5 right and 7 forward
  await page.evaluate(() => window.__store.update((d) => { const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6); d.bodies[0].m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 5, 7, 0, 1]; }, "Move"));
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await patBar()).volume).toBeCloseTo(barVol(4), 0);
  expect((await stlHash()).tris).toBe(a.tris);
  // editing keeps the axis that was saved exactly, whatever the body's matrix is (the Along picker shows the nearest world axis)
  await page.locator('.tl-item[aria-label^="Pattern"]').first().dblclick();
  await page.fill("#pt-n1", "3");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  expect((await patMod()).ax1).toEqual([1, 0, 0]);
  expect((await patBar()).volume).toBeCloseTo(barVol(3), 0);
});

test("Pattern: a circular pattern of a shape fuses into the same body and follows its count", async () => {
  await loadDoc(page, patDoc());
  const ring = async () => (await bodies(page)).filter((b) => b.name === "Ring");
  expect(await ring()).toHaveLength(1);
  expect((await ring())[0].volume).toBeCloseTo(6000, 0); // six 10 mm cubes, none touching
  await page.evaluate(() => window.__store.update((d) => { d.bodies[1].node.mods[0].cn = 8; }, "Edit pattern"));
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect(await ring()).toHaveLength(1);
  expect((await ring())[0].volume).toBeCloseTo(8000, 0);
  // the dialog edits it and keeps the saved centre (the world origin, which is x = -30 in the ring's own coordinates)
  await page.locator('.tl-item[aria-label="Pattern"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Pattern");
  await expect(page.locator("#pt-cn")).toHaveValue("8");
  await page.fill("#pt-cn", "4");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  expect(await page.evaluate(() => { const m = window.__store.doc.bodies[1].node.mods[0]; return [m.kind, m.cn, m.center, m.cax, m.angle]; })).toEqual(["circ", 4, [-30, 0, 0], [0, 0, 1], 360]);
  expect((await ring())[0].volume).toBeCloseTo(4000, 0);
  // the count box takes a parameter too
  await page.evaluate(() => window.__store.update((d) => { d.params.push({ id: "q9", name: "k", expr: "5", value: 5 }); d.bodies[1].node.mods[0].exprs = { cn: "k" }; }, "Bind"));
  await waitIdle(page);
  expect((await ring())[0].volume).toBeCloseTo(5000, 0);
});

test("Pattern: Advanced makes a Pattern feature from the dialog, not baked copies", async () => {
  await loadDoc(page, holeOnly());
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await expect(page.locator("#cmd")).toContainText("Pattern");
  await page.locator("#pt-what button", { hasText: "Features" }).click();
  await page.locator('#pt-feats input[data-mod="f1"]').check();
  await page.fill("#pt-n1", "3");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  const mods = await page.evaluate(() => window.__store.doc.bodies[0].node.mods.map((m) => [m.t, m.feats, m.n1, m.s1, m.ax1]));
  expect(mods).toEqual([["hole", undefined, undefined, undefined, undefined], ["pattern", ["f1"], 3, 20, [1, 0, 0]]]); // two mods: the baked copies were not made
  expect((await patBar()).volume).toBeCloseTo(barVol(3), 0);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
  await undoOnce();
  expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods.length)).toBe(1); // one commit, one undo step
});

test("Pattern: on a turned body the dialog's world axis is saved in the body's own axes", async () => {
  const doc = holeOnly();
  doc.bodies[0].m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 7, 0, 1]; // the bar's long side now runs along world y
  await loadDoc(page, doc);
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await page.locator("#pt-what button", { hasText: "Features" }).click();
  await page.locator('#pt-feats input[data-mod="f1"]').check();
  await page.locator("#pt-ax1 button", { hasText: "Y" }).click();
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  const m = await patMod();
  expect(m.ax1.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
  expect((await patBar()).volume).toBeCloseTo(barVol(3), 0);
});

test("Pattern: Join copies makes one Pattern of the shape in Advanced", async () => {
  await loadDoc(page, box20());
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await page.locator("#pt-join").check();
  await page.locator("#cmd-ok").click();
  await closed();
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
  expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods.map((m) => [m.t, m.what, m.kind]))).toEqual([["pattern", "shape", "rect"]]);
  expect((await bodies(page))[0].volume).toBeCloseTo(24000, 0); // three 20 mm cubes touching along x
});

test("Pattern: Beginner still makes separate copies, with no Pattern feature", async () => {
  const doc = newDoc("Two boxes", "beginner", { bodies: [
    body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 })),
    body("b2", "Far box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 100, 0, 1]),
  ] });
  await loadDoc(page, doc);
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await expect(page.locator("#cmd")).toContainText("Pattern");
  await page.locator("#cmd-ok").click();
  await closed();
  await waitIdle(page);
  const d = await page.evaluate(() => window.__store.doc.bodies.map((b) => ({ name: b.name, mods: (b.node.mods || []).map((m) => m.t) })));
  expect(d).toHaveLength(4); // the box, its two copies, and the far box
  expect(d.filter((b) => b.name !== "Far box")).toHaveLength(3);
  expect(d.flatMap((b) => b.mods)).toEqual([]);
});

// the bounding box of a binary STL
const stlBox = (bytes) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = bytes.readUInt32LE(80);
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
    const x = bytes.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
    lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);
  }
  return [...lo, ...hi].map((x) => Math.round(x * 100) / 100);
};

test("Pattern: an extrude cut is repeated through feats, with the same volume as the baked copies", async () => {
  const doc = JSON.parse(readFileSync(new URL("./projects/advanced-pattern-feature.json", import.meta.url), "utf8"));
  const mods = doc.bodies[0].node.mods;
  doc.bodies[0].node.mods = [mods.find((m) => m.id === "f5"), { id: "p1", seq: 20, t: "pattern", kind: "rect", what: "feats", feats: ["f5"], ax1: [1, 0, 0], n1: 4, s1: 20, n2: 1, s2: 0, sym: false }];
  await loadDoc(page, doc);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await bodies(page))[0].volume).toBeCloseTo(24000 - 4 * 6 * 6 * 4, 0); // four 6 x 6 x 4 pockets
});

test("Pattern: a circular pattern made with Feature center saves the centre in the body's own coordinates", async () => {
  const doc = holeOnly();
  doc.bodies[0].node.mods[0].at = [{ p: [-30, -8, 10], n: [0, 0, 1] }, { p: [-30, 8, 10], n: [0, 0, 1] }]; // centre (-30, 0, 10)
  doc.bodies[0].m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1]; // turned 90 degrees and moved
  await loadDoc(page, doc);
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await page.locator("#pt-what button", { hasText: "Features" }).click();
  await page.locator('#pt-feats input[data-mod="f1"]').check();
  await page.locator("#pt-type button", { hasText: "Circular" }).click();
  await page.locator("#pt-about button", { hasText: "Feature center" }).click();
  await page.fill("#pt-cn", "3");
  await page.keyboard.press("Enter");
  await closed();
  await waitIdle(page);
  const m = await patMod();
  expect([m.kind, m.about, m.cn]).toEqual(["circ", "center", 3]);
  expect(m.center.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-30, 0, 10]);
  expect(m.cax.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1]);
  expect((await patBar()).volume).toBeCloseTo(barVol(6), 0); // two holes turned to six
});

test("Pattern: a partial circle spaces the copies over the angle, and both sides in two directions count every copy", async () => {
  const doc = patDoc();
  Object.assign(doc.bodies[1].node.mods[0], { cn: 3, angle: 180 }); // copies at 90 and 180 degrees
  doc.bodies[0].node.mods = [{ ...doc.bodies[0].node.mods[0], at: [{ p: [0, 0, 10], n: [0, 0, 1] }] }, { id: "f2", seq: 3, t: "pattern", kind: "rect", what: "feats", feats: ["f1"], ax1: [2, 0, 0], n1: 2, s1: 20, ax2: [0, 1, 0], n2: 2, s2: 10, sym: true }];
  await loadDoc(page, doc);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
  expect((await bodies(page)).find((b) => b.name === "Ring").volume).toBeCloseTo(3000, 0);
  expect((await patBar()).volume).toBeCloseTo(barVol(9), 0); // 3 x 3 holes; ax1 [2,0,0] still moves by the spacing
});

test("Pattern: a runaway count is clamped and a parameter out of range is skipped", async () => {
  await loadDoc(page, patDoc());
  await setParam("n", "500");
  await waitIdle(page);
  expect((await patMod()).n1).toBe(4); // 500 is over the dialog's limit of 200: skipped, the last count stays
  expect((await patBar()).volume).toBeCloseTo(barVol(4), 0);
  await page.evaluate(() => window.__store.update((d) => { const m = d.bodies[0].node.mods[1]; m.feats = []; m.n1 = 1e6; m.n2 = 1e6; delete m.exprs; }, "Edit pattern"));
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error)).toEqual([]); // 200 x 200 copies of nothing, not a million
  expect((await patBar()).volume).toBeCloseTo(24000 - holeVol(), 0); // only the source hole is left
});

test("Pattern: a mirrored body turns the copies the same way as an unmirrored one", async () => {
  const run = async (m) => {
    await loadDoc(page, newDoc("Mirrored", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 10, d: 10, h: 10, r: 0, c: 0 }), m)] }));
    await page.evaluate(() => window.__app.select(["b1"]));
    await page.keyboard.press("p");
    await page.locator("#pt-join").check();
    await page.locator("#pt-type button", { hasText: "Circular" }).click();
    await page.fill("#pt-cn", "2");
    await page.fill("#pt-angle", "90");
    await page.locator("#cmd-ok").click();
    await closed();
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    return stlBox((await exportBytes(page, "stl")).bytes);
  };
  const plain = await run([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 0, 0, 1]);
  expect(plain).toEqual([-5, -5, 0, 35, 35, 10]); // the copy is a quarter turn counter-clockwise about the origin: at y = +30
  const mirrored = await run([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 0, 0, 1]); // the same box, reflected in x
  expect(mirrored).toEqual(plain);
});

test("Pattern: Advanced bodies without Join still bake separate copies", async () => {
  await loadDoc(page, box20());
  await page.evaluate(() => window.__app.select(["b1"]));
  await page.keyboard.press("p");
  await page.locator("#cmd-ok").click();
  await closed();
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies.map((b) => (b.node.mods || []).length))).toEqual([0, 0, 0]);

});

// ---- visible proof (Phase P step 5): constrained mark, dimension names, CSV, tutorial ----
const toastWith = (text) => page.locator("#toasts .toast", { hasText: text });
const clearToasts = () => page.evaluate(() => document.querySelectorAll("#toasts .toast").forEach((t) => t.remove())); // an older toast must not satisfy a later check
const sketchDofs = () => page.locator("#browser .sk-dof");

test("Sketch proof: sketchDof counts variables minus equations", async () => {
  const { sketchDof } = await import("../src/constraints.js");
  const pt = (id, x, y) => ({ id, x, y });
  expect(sketchDof({ pts: [], ents: [], cons: [] })).toEqual({ free: 0, dof: 0, over: 0 });
  // a lone circle: center 2 + radius 1; a diameter dimension and an origin pin close it
  const circle = { pts: [pt("c", 0, 0)], ents: [{ id: "e1", t: "circle", c: "c", r: 5 }], cons: [] };
  expect(sketchDof(circle)).toEqual({ free: 3, dof: 3, over: 3 });
  circle.cons = [{ id: "k1", t: "origin", p: "c" }, { id: "k2", t: "dim", k: "dia", e1: "e1", v: 10 }];
  expect(sketchDof(circle)).toEqual({ free: 3, dof: 0, over: 0 });
  // an arc has 5 (its end sits on its circle); a projected line adds nothing
  const arc = { pts: [pt("c", 0, 0), pt("a", 5, 0), pt("b", 0, 5), pt("q", 9, 9), pt("r", 9, 0)], ents: [{ id: "e1", t: "arc", c: "c", a: "a", b: "b" }, { id: "e2", t: "line", a: "q", b: "r", proj: true }], cons: [] };
  expect(sketchDof(arc)).toEqual({ free: 5, dof: 5, over: 5 });
  // a dimension with no value yet (v below 0) is not an equation; dof never goes below 0
  expect(sketchDof({ ...circle, cons: [{ id: "k2", t: "dim", k: "dia", e1: "e1", v: -1 }] })).toEqual({ free: 3, dof: 3, over: 3 });
  expect(sketchDof({ ...circle, cons: [{ id: "k1", t: "origin", p: "c" }, { id: "k2", t: "origin", p: "c" }, { id: "k3", t: "equal" }] })).toEqual({ free: 3, dof: 0, over: -2 });
  // a rectangle: 8 variables; origin 2 + four horizontal/vertical + the width = 7, so one is left
  const rect = { pts: [pt("p0", 0, 0), pt("p1", 40, 0), pt("p2", 40, 20), pt("p3", 0, 20)], ents: [["e0", "p0", "p1"], ["e1", "p1", "p2"], ["e2", "p2", "p3"], ["e3", "p3", "p0"]].map(([id, a, b]) => ({ id, t: "line", a, b })),
    cons: [{ id: "k0", t: "origin", p: "p0" }, { id: "k1", t: "horizontal", e1: "e0" }, { id: "k2", t: "vertical", e1: "e1" }, { id: "k3", t: "horizontal", e1: "e2" }, { id: "k4", t: "vertical", e1: "e3" }, { id: "k5", t: "dim", k: "dist", p1: "p0", p2: "p1", o: "h", v: 40 }] };
  expect(sketchDof(rect)).toEqual({ free: 8, dof: 1, over: 1 });
  // a perpendicular between two edges that are already horizontal and vertical repeats them: it must not close the last freedom
  expect(sketchDof({ ...rect, cons: [...rect.cons, { id: "k6", t: "perpendicular", e1: "e0", e2: "e1" }] })).toEqual({ free: 8, dof: 1, over: 1 });
  // a real second constraint does (a horizontal given as two points counts as the edge's own)
  expect(sketchDof({ ...rect, cons: [...rect.cons, { id: "k6", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20 }] })).toEqual({ free: 8, dof: 0, over: 0 });
  expect(sketchDof({ ...rect, cons: [...rect.cons, { id: "k6", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20 }, { id: "k7", t: "dim", k: "dist", p1: "p0", p2: "p3", o: "v", v: 20 }] })).toEqual({ free: 8, dof: 0, over: -1 });
  const twoPoint = { ...rect, cons: [{ id: "k1", t: "horizontal", p1: "p0", p2: "p1" }, { id: "k2", t: "vertical", e1: "e1" }, { id: "k3", t: "parallel", e1: "e0", e2: "e1" }] };
  expect(sketchDof(twoPoint).over).toBe(8 - 2); // e0 and e1 each carry a constraint of their own: the parallel adds nothing
});

test("Sketch proof: the Browser shows a check on a fully constrained sketch and '1 free' when a dimension goes", async () => {
  await loadDoc(page, parametric());
  await expect(sketchDofs()).toHaveCount(1);
  await expect(sketchDofs()).toHaveText("✓");
  await expect(sketchDofs()).toHaveAttribute("title", "Fully constrained");
  // editing: the ribbon note says so, and follows the sketch
  await page.evaluate(() => window.__app.enterSketch(window.__store.doc.sketches[0].id));
  await expect(page.locator("#sk-note")).toHaveText("Fully constrained");
  await page.evaluate(() => window.__store.update((d) => { d.sketches[0].cons = d.sketches[0].cons.filter((c) => c.id !== "d2"); }, "Remove dimension"));
  await expect(sketchDofs()).toHaveText("1 free");
  await expect(page.locator("#sk-note")).toHaveText("1 degree of freedom left: add dimensions or constraints");
  await page.evaluate(() => window.__app.exitSketch());
  await waitIdle(page);
  // a perpendicular on two edges that are already horizontal and vertical is a repeat: still one free, no check
  await page.evaluate(() => window.__store.update((d) => { d.sketches[0].cons.push({ id: "c9", t: "perpendicular", e1: "e0", e2: "e1" }); }, "Add perpendicular"));
  await expect(sketchDofs()).toHaveText("1 free");
  // too many constraints: the check stays, with a warning in its title
  await page.evaluate(() => window.__store.update((d) => { d.sketches[0].cons.push({ id: "d2", t: "dim", k: "dist", p1: "p1", p2: "p2", o: "v", v: 20 }, { id: "x3", t: "dim", k: "dist", p1: "p0", p2: "p3", o: "v", v: 20 }); }, "Add dimensions"));
  await expect(sketchDofs()).toHaveText("✓");
  await expect(sketchDofs()).toHaveAttribute("title", "Fully constrained by count; 1 more constraint than needed, some may fight");
  // a design with no sketches shows nothing
  await loadDoc(page, box20());
  await expect(sketchDofs()).toHaveCount(0);
});

test("Dimension names: old files get d1, d2; any expression can use them and they follow changes", async () => {
  await clearToasts();
  const old = parametric();
  for (const c of old.sketches[0].cons) delete c.name; // files from before names
  await loadDoc(page, old);
  expect(await page.evaluate(() => window.__store.doc.sketches[0].cons.filter((c) => c.t === "dim").map((c) => c.name))).toEqual(["d1", "d2"]);
  // an extrude distance of d1/2: 20 mm while the plate is 40 wide, 30 when w is 60
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node.exprs = { dist: "d1/2" }; }, "Bind distance"));
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(40 * 20 * 20, 0);
  await setParam("w", "60");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(60 * 30 * 30, 0);
  // the dimension prompt names the dimension, and the label shows name = expression = value while editing
  await page.evaluate(() => window.__app.enterSketch(window.__store.doc.sketches[0].id));
  await expect(page.locator(".dimlabel", { hasText: "d1 = w = 60" })).toBeVisible();
  await page.evaluate(() => window.__app.exitSketch());
  // a parameter cannot take a dimension's name
  await page.click("#browser .param-add");
  const nm = page.locator("#browser .param").nth(2).locator("input.param-name");
  await nm.fill("D7");
  await page.keyboard.press("Enter");
  await expect(toastWith("dimension name")).toBeVisible();
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => p.name))).toEqual(["w", "h", "p3"]);
});

test("Dimension names: a dimension can use another that comes later, and an angle dimension's degrees feed a length", async () => {
  const doc = parametric();
  const cons = doc.sketches[0].cons;
  cons.find((c) => c.id === "d1").name = "d1"; cons.find((c) => c.id === "d2").name = "d2";
  cons.find((c) => c.id === "d1").expr = "d2*2"; // d1 is listed first but needs d2, which needs h, which needs w
  await loadDoc(page, doc);
  await setParam("w", "60");
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(60 * 30 * 15, 0); // d2 = h = 30, d1 = 60
  // an angle dimension (90°) named d3 feeds a length: d2 = d3/3 = 30 mm
  const withAngle = parametric();
  for (const c of withAngle.sketches[0].cons) if (c.t === "dim") c.name = c.id;
  withAngle.sketches[0].cons.push({ id: "dA", t: "dim", k: "ang", e1: "e0", e2: "e1", s1: 1, s2: 1, v: 90, off: [5, 5], name: "d3" });
  withAngle.sketches[0].cons.find((c) => c.id === "d2").expr = "d3/3";
  await loadDoc(page, withAngle);
  expect((await bodies(page))[0].volume).toBeCloseTo(40 * 30 * 15, 0);
});

test("Dimension names: a loop between dimensions is put back and reported, not multiplied", async () => {
  await clearToasts();
  const doc = parametric();
  const [d1, d2] = doc.sketches[0].cons.filter((c) => c.t === "dim");
  d1.expr = "d2*2"; d2.expr = "d1*2";
  await loadDoc(page, doc);
  const state = () => page.evaluate(() => ({ v: window.__store.doc.sketches[0].cons.filter((c) => c.t === "dim").map((c) => c.v), n: window.__store.undoStack.length }));
  expect((await state()).v).toEqual([40, 20]);
  expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].name = "Plate 2"; }, "Rename")); // an unrelated update runs it again
  await waitIdle(page);
  expect((await state()).v).toEqual([40, 20]);
  expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
  // editing a parameter in the list reports the two dimensions that could not take a value
  await page.locator("#browser .param").nth(1).locator("input.param-expr").fill("w/2+0");
  await page.keyboard.press("Enter");
  await expect(toastWith("can't take that value")).toBeVisible();
  expect((await state()).v).toEqual([40, 20]);
});

test("Dimension names: a deleted dimension's name is not given to a new one, and a parameter's name is not taken", async () => {
  await loadDoc(page, parametric());
  const names = () => page.evaluate(() => window.__store.doc.sketches[0].cons.filter((c) => c.t === "dim").map((c) => c.name));
  const dim = (id, p2) => ({ id, t: "dim", k: "dist", p1: "p0", p2, o: "v", v: 20, off: [-5, 10] });
  await page.evaluate((x) => window.__store.update((d) => { d.sketches[0].cons.push(x); }, "Add dimension"), dim("x3", "p3"));
  expect(await names()).toEqual(["d1", "d2", "d3"]);
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node.exprs = { dist: "d3/2" }; }, "Bind distance"));
  await waitIdle(page);
  expect((await bodies(page))[0].volume).toBeCloseTo(40 * 20 * 10, 0);
  await page.evaluate(() => window.__store.update((d) => { d.sketches[0].cons = d.sketches[0].cons.filter((c) => c.id !== "x3"); }, "Delete dimension"));
  await page.evaluate((x) => window.__store.update((d) => { d.sketches[0].cons.push(x); }, "Add dimension"), dim("y4", "p3"));
  const after = await names();
  expect(after.slice(0, 2)).toEqual(["d1", "d2"]);
  expect(after[2]).not.toBe("d3");
  // an older file with a parameter named d1: the dimension gets the next name, and d1 still means the parameter
  const old = parametric();
  old.params.push({ id: "q9", name: "d1", expr: "40", value: 40 });
  for (const c of old.sketches[0].cons) delete c.name;
  old.sketches[0].cons.find((c) => c.id === "d1").expr = "d1/2"; // the width: 20, from the parameter d1
  old.sketches[0].cons.find((c) => c.id === "d2").expr = "5"; // a plain 5 (no name in it)
  await loadDoc(page, old);
  expect(await names()).toEqual(["d2", "d3"]);
  expect(await page.evaluate(() => window.__store.doc.sketches[0].cons.find((c) => c.id === "d1").v)).toBe(20);
});

test("CSV: the Parameters list saves name,expression,unit, and an import changes values in one undo step", async () => {
  await clearToasts();
  await loadDoc(page, parametric());
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#browser .param-csv-out")]);
  expect(dl.suggestedFilename()).toBe("Parametric-plate-parameters.csv");
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("name,expression,unit\nw,40,\nh,w/2,\n");
  // import: w changes, k is new, "bad name" and a row with no value are skipped
  const csv = "name,expression,unit\nW,60,\nk,5,\nbad name,3,\nn2,\n";
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#browser .param-csv-in")]);
  await chooser.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(toastWith("Imported 2 parameters, 2 rows skipped")).toBeVisible();
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => [p.name, p.expr]))).toEqual([["w", "60"], ["h", "w/2"], ["k", "5"]]);
  expect((await bodies(page))[0].volume).toBeCloseTo(60 * 30 * 15, 0);
  await undoOnce();
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => [p.name, p.expr]))).toEqual([["w", "40"], ["h", "w/2"]]);
  expect((await bodies(page))[0].volume).toBeCloseTo(12000, 0);
  // a semicolon file with a quoted field and no header row; a file with nothing usable changes nothing and adds no undo step
  const undoBefore = await page.evaluate(() => window.__store.undoStack.length);
  const [c2] = await Promise.all([page.waitForEvent("filechooser"), page.click("#browser .param-csv-in")]);
  await c2.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("1bad;3\n;\n") });
  await expect(toastWith("Imported 0 parameters, 1 row skipped")).toBeVisible();
  expect(await page.evaluate(() => window.__store.undoStack.length)).toBe(undoBefore);
  const [c3] = await Promise.all([page.waitForEvent("filechooser"), page.click("#browser .param-csv-in")]);
  await c3.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from('"q1";"2*3";IN\n') });
  await expect(toastWith("Imported 1 parameter")).toBeVisible();
  expect(await page.evaluate(() => window.__store.doc.params.slice(2).map((p) => [p.name, p.expr, p.unit]))).toEqual([["q1", "2*3", "in"]]);
});

test("CSV: a file with a BOM, CRLF line ends, a quoted comma and a ; with a decimal comma reads, and saves back out the same", async () => {
  await clearToasts();
  await loadDoc(page, parametric());
  const importText = async (text) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#browser .param-csv-in")]);
    await chooser.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  };
  await importText('\uFEFFname,expression,unit\r\nw,60,\r\nk,"max(1,2)",\r\n');
  await expect(toastWith("Imported 2 parameters, 1 with errors")).toBeVisible(); // the kernel has no max(): k shows an error, and says so
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => [p.name, p.expr]))).toEqual([["w", "60"], ["h", "w/2"], ["k", "max(1,2)"]]);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#browser .param-csv-out")]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  expect(Buffer.concat(chunks).toString("utf8")).toBe('name,expression,unit\nw,60,\nh,w/2,\nk,"max(1,2)",\n');
  await waitIdle(page);
  // one ; and one , in the file: it is a ; file (a decimal comma)
  await importText("w;12,5\n");
  await expect.poll(() => page.evaluate(() => window.__store.doc.params[0].expr)).toBe("12,5");
});

test("CSV: the buttons in the Beginner inspector save the same file, and an import there is one undo step", async () => {
  await clearToasts();
  const doc = JSON.parse(readFileSync(new URL("./projects/parametric-beginner.json", import.meta.url), "utf8"));
  await loadDoc(page, doc);
  await page.evaluate(() => window.__app.select(["b1"]));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#insp-params .param-csv-out")]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("name,expression,unit\n" + doc.params.map((p) => `${p.name},${p.expr},${p.unit || ""}\n`).join(""));
  const before = await page.evaluate(() => JSON.stringify(window.__store.doc.params));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#insp-params .param-csv-in")]);
  await chooser.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("w,50\nk,3\n") });
  await expect(toastWith("Imported 2 parameters")).toBeVisible();
  expect(await page.evaluate(() => window.__store.doc.params.map((p) => p.name))).toEqual(["w", "h", "k"]);
  await undoOnce();
  expect(await page.evaluate(() => JSON.stringify(window.__store.doc.params))).toBe(before);
});

test("CSV: an import that leaves a parameter with an error says how many", async () => {
  await clearToasts();
  await loadDoc(page, parametric());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#browser .param-csv-in")]);
  await chooser.setFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("w,k*2\nk,5\n") }); // w comes before k, so k is not known to it yet
  await expect(toastWith("Imported 2 parameters, 2 with errors")).toBeVisible(); // w, and h which uses it
});

test("Tutorials: the Parameters tutorial exists and ticks its steps off for a matching design", async () => {
  await loadDoc(page, newDoc("Untitled", "advanced"));
  const r = await page.evaluate(() => {
    const t = window.__app.tutorials, tut = t.list.find((x) => x.id === "a-params"), T = t.T;
    const run = () => tut.steps.map((s) => (s.check ? !!s.check(T) : null));
    const out = { count: t.list.length, beginner: t.list.filter((x) => x.mode === "beginner").length, adv: t.list.filter((x) => x.mode === "advanced").length, arch: t.list.filter((x) => x.mode === "arch").length, steps: tut.steps.length, level: tut.level, item: tut.item };
    out.empty = run();
    return out;
  });
  expect(r.steps).toBeGreaterThanOrEqual(7);
  expect(r.count).toBe(44);
  expect(r.beginner).toBe(19);
  expect(r.adv).toBe(20);
  expect(r.arch).toBe(5);
  expect(r.level).toBe("Proficient");
  expect(r.item).toBe("Bracket");
  expect(r.empty.slice(0, 6)).toEqual([false, false, false, false, false, false]);
  // build the finished design the steps describe: sketch rectangle, w/h/t, bound dimensions, extrude by t, then w = 80
  const doc = parametric();
  doc.name = "Lopez, Maria, Bracket";
  doc.params.push({ id: "q3", name: "t", expr: "8", value: NaN });
  doc.bodies[0].node.exprs = { dist: "t" };
  await loadDoc(page, doc);
  const checks = () => page.evaluate(() => { const t = window.__app.tutorials, T = t.T; return t.list.find((x) => x.id === "a-params").steps.map((s) => (s.check ? !!s.check(T) : null)); });
  expect((await checks()).slice(0, 5)).toEqual([true, true, false, true, true]); // w = 40 here, so "add w = 60" is not met yet
  await setParam("w", "60");
  expect((await checks()).slice(0, 6)).toEqual([true, true, true, true, true, false]);
  await setParam("w", "80");
  expect((await checks()).slice(0, 6)).toEqual([true, true, false, true, true, true]);
  expect((await bodies(page))[0].volume).toBeCloseTo(80 * 40 * 8, 0);
});

test("About says forty-four tutorials and lists what the community build adds", async () => {
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText("forty-four step-by-step projects (nineteen in Beginner, twenty in Advanced, five in Architechies");
  await expect(about).toContainText("Community build adds: named parameters across sketches, features and Beginner shapes, an editable Pattern, CSV parameters, OBJ export, Mesh detail.");
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

test("without WebGL the loading screen says so instead of waiting forever", async ({ browser }, info) => {
  const p = await browser.newPage();
  try {
    await p.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : real.call(this, type, ...rest); };
    });
    await p.goto(info.project.use.baseURL);
    await expect(p.locator("#loading-msg")).toContainText("WebGL is unavailable in this browser");
    await expect(p.locator("#loading")).toBeVisible();
  } finally { await p.close(); }
});
