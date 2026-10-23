// Code CAD (Phase 4): replicad code builds ONE solid in a temporary worker and is added as an ordinary STEP body that keeps its
// recipe. Reached through window.__app.codeCad (the Code CAD… menu entry opens the same dialog). Runs on both builds.
// Volumes are worked out by hand from the code in the examples (src/codecad.js).
import { test, expect } from "@playwright/test";
import { boot, watchErrors, waitIdle, bodies, exportBytes, loadDoc, newDoc } from "./helpers.mjs";

const L_BRACKET = 7200 + 7200 - 60 * 4 * 4 - 2 * Math.PI * 3 * 3 * 4; // base + wall - where they overlap - two 6 mm holes through the base
const plate = (w = 40, d = 25, t = 5, hole = 8) => (w * d - (4 - Math.PI) * 3 * 3 - Math.PI * (hole / 2) ** 2) * t; // rounded rectangle (corner 3) with a round hole
const near = (got, want, tol = 0.01) => expect(Math.abs(got - want) / want, `${got} vs ${want}`).toBeLessThan(tol);
const SPIN = (ms) => `const t = Date.now(); while (Date.now() - t < ${ms}) {} return replicad.makeBox([0, 0, 0], [10, 10, 10]);`;

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    // count the workers the page starts and stops: a build starts one and always stops it
    window.__w = { made: 0, ended: 0 };
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(...a) { super(...a); window.__w.made++; }
      terminate() { window.__w.ended++; super.terminate(); }
    };
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(async () => {
  await page.evaluate(() => document.querySelectorAll(".modal-back").forEach((m) => m.remove()));
  await page.evaluate(() => { window.__app.codeCad.cancel(); Object.assign(window.__app.codeCad.limits, { startMs: 90000, runMs: 25000 }); });
  expect(errors, "console or page errors").toEqual([]);
});

const fresh = async () => { await page.evaluate(() => JS3D.newDesign("advanced")); await waitIdle(page); };
// { id } or { error, kind }: a rejected build is data, not a failed evaluate
const build = (spec) => page.evaluate((s) => window.__app.codeCad.build(s).then((id) => ({ id }), (e) => ({ error: e.message, kind: e.kind })), spec);
const example = (i) => page.evaluate((i) => window.__app.codeCad.examples[i].code, i);
const workers = () => page.evaluate(() => ({ ...window.__w }));
const history = () => page.evaluate(() => ({ doc: JSON.stringify(window.__store.doc), undo: window.__store.undoStack.length, redo: window.__store.redoStack.length }));
const bodyOf = (id) => page.evaluate((id) => JSON.parse(JSON.stringify(window.__findBody(window.__store.doc, id))), id);
const volumeOf = async (id) => { await waitIdle(page); const b = (await bodies(page)).find((x) => x.id === id); expect(b.error).toBeNull(); return b.volume; };

test("the L bracket example builds as one STEP body with its recipe, and undo and redo move it in and out", async () => {
  await fresh();
  const before = await history();
  const w0 = await workers();
  const r = await build({ code: await example(0), name: "Bracket" });
  expect(r.error).toBeUndefined();
  const w1 = await workers();
  expect(w1.made - w0.made, "one temporary worker").toBe(1);
  expect(w1.ended - w0.ended, "and it was stopped").toBe(1);
  near(await volumeOf(r.id), L_BRACKET);
  const b = await bodyOf(r.id);
  expect(b.name).toBe("Bracket 1");
  expect(b.node).toMatchObject({ t: "step", keepPos: true, mods: [] });
  expect(b.m).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  expect(b.codeCad).toMatchObject({ version: 1, bindings: {}, lastValues: {} });
  expect(b.codeCad.code).toContain("makeCylinder");
  const doc = await page.evaluate(() => window.__store.doc);
  expect(doc.assets[b.node.asset]).toMatchObject({ kind: "step", name: "Bracket" });
  expect(Buffer.from(doc.assets[b.node.asset].data, "base64").toString("latin1")).toContain("ISO-10303-21");
  expect(await page.evaluate(() => window.__store.undoStack.length)).toBe(before.undo + 1); // one step

  await page.evaluate(() => window.__store.undo());
  await waitIdle(page);
  expect((await history()).doc).toBe(before.doc);
  await page.evaluate(() => window.__store.redo());
  near(await volumeOf(r.id), L_BRACKET);
  expect((await bodyOf(r.id)).codeCad.code).toBe(b.codeCad.code);
});

test("JS3D.codeCad builds a body, waits for it to appear, and updates it by bodyId", async () => {
  await fresh();
  const out = await page.evaluate(async (code) => {
    const id = await JS3D.codeCad({ code, name: "Scripted" });
    const first = JS3D.get(id).volume;
    const again = await JS3D.codeCad({ code: code.replace("[60, 30, 4]", "[60, 30, 8]"), bodyId: id });
    return { id, again, first, second: JS3D.get(id).volume, version: JS3D.version };
  }, await example(0));
  expect(out.again).toBe(out.id);
  near(out.first, L_BRACKET);
  near(out.second, 14400 + 7200 - 60 * 4 * 8 - 2 * Math.PI * 9 * 8, 0.005); // a base 8 thick: its overlap with the wall and the holes grow
  expect(out.version).toBe("1.7");
});

test("the parameter example builds with its defaults", async () => {
  await fresh();
  const r = await build({ code: await example(1), name: "Plate" });
  expect(r.error).toBeUndefined();
  near(await volumeOf(r.id), plate());
});

test("the solid exports as STEP and the STEP opens again as a solid of the same size", async () => {
  await fresh();
  const r = await build({ code: await example(0) });
  await volumeOf(r.id);
  const step = await exportBytes(page, "step");
  expect(step.bytes.toString("latin1")).toContain("ISO-10303-21");
  await fresh();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__app.advanced.importModel({ name: "bracket.step" }, bytes);
  }, step.bytes.toString("base64"));
  await waitIdle(page);
  const list = await bodies(page);
  expect(list).toHaveLength(1);
  near(list[0].volume, L_BRACKET, 0.001);
});

test("saving and reloading keeps the recipe and never runs it", async ({}, info) => {
  await fresh();
  const r = await build({ code: await example(0), name: "Kept" });
  await volumeOf(r.id);
  const saved = await bodyOf(r.id);
  await page.evaluate(() => window.__app.projects.saveNow());
  await boot(page, info); // a new page load: only the design's own worker starts
  await waitIdle(page);
  expect((await workers()).made, "no temporary worker on load").toBe(1);
  const again = await bodyOf(r.id);
  expect(again.codeCad).toEqual(saved.codeCad);
  expect(again.node.asset).toBe(saved.node.asset);
  near(await volumeOf(r.id), L_BRACKET);
  expect((await workers()).made).toBe(1);
  // a saved project file opened through the menu path does not run it either
  const file = await exportBytes(page, "json");
  await page.setInputFiles("#file-import", { name: "kept.json", mimeType: "application/json", buffer: file.bytes });
  await page.waitForFunction(() => window.__toasts.some((t) => t.text.startsWith("Opened")), null, { timeout: 20_000 });
  await waitIdle(page);
  expect((await workers()).made).toBe(1);
  near((await bodies(page))[0].volume, L_BRACKET);
});

test("a linked parameter changes the shape on Update only, by id, and Update is one undoable step", async () => {
  await fresh();
  await page.evaluate(() => { JS3D.setParam("width", "50"); JS3D.setParam("hole", "10"); });
  const r = await build({ code: await example(1), name: "Plate", bindings: { width: "width", hole: "hole" } });
  expect(r.error).toBeUndefined();
  near(await volumeOf(r.id), plate(50, 25, 5, 10));
  const b = await bodyOf(r.id);
  const ids = await page.evaluate(() => Object.fromEntries(window.__store.doc.params.map((p) => [p.name, p.id])));
  expect(b.codeCad.bindings).toEqual({ width: ids.width, hole: ids.hole }); // ids, not names
  expect(b.codeCad.lastValues).toEqual({ width: 50, hole: 10 });
  expect(await page.evaluate((id) => window.__app.codeCad.status(id), r.id)).toEqual({ needsUpdate: false, why: [] });

  // a move and a later feature (a cut) are kept through an Update
  await page.evaluate((id) => window.__store.update((d) => {
    const x = window.__findBody(d, id);
    x.m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 20, 0, 1];
    x.node.mods.push({ id: "f1", seq: 99, t: "bool", op: "cut", tool: { t: "group", children: [{ node: { t: "prim", kind: "cylinder", p: { w: 4, d: 4, h: 20, r: 0, c: 0 }, mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 15, 0, -5, 1] }], mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  }, "cut"), r.id);
  const withCut = await volumeOf(r.id);
  near(withCut, plate(50, 25, 5, 10) - Math.PI * 4 * 5, 0.003);

  // renaming and then editing the parameter: nothing runs, the body says an update is needed
  const w0 = await workers();
  await page.evaluate(() => { const d = window.__store.doc; window.__store.update((n) => { n.params.find((p) => p.name === "width").name = "w2"; }, "rename"); JS3D.setParam("w2", "60"); });
  expect(await page.evaluate((id) => window.__app.codeCad.status(id), r.id)).toEqual({ needsUpdate: true, why: ["w2 changed"] });
  await waitIdle(page);
  expect((await workers()).made).toBe(w0.made);
  near(await volumeOf(r.id), withCut);

  const h = await history();
  const u = await build({ code: b.codeCad.code, bindings: (await bodyOf(r.id)).codeCad.bindings, bodyId: r.id });
  expect(u.id).toBe(r.id);
  const after = await bodyOf(r.id);
  expect(after.m).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, 20, 0, 1]);
  expect(after.node.mods).toHaveLength(1);
  expect(after.node.asset).not.toBe(b.node.asset);
  expect(after.codeCad.lastValues).toEqual({ width: 60, hole: 10 });
  expect((await history()).undo).toBe(h.undo + 1);
  near(await volumeOf(r.id), plate(60, 25, 5, 10) - Math.PI * 4 * 5, 0.003);
  const assets = await page.evaluate(() => Object.keys(window.__store.doc.assets));
  expect(assets, "the replaced file is not kept").toEqual([after.node.asset]);
  expect(await page.evaluate((id) => window.__app.codeCad.status(id).needsUpdate, r.id)).toBe(false);

  await page.evaluate(() => window.__store.undo());
  near(await volumeOf(r.id), withCut);
  expect((await bodyOf(r.id)).node.asset).toBe(b.node.asset);
  await page.evaluate(() => window.__store.redo());
  near(await volumeOf(r.id), plate(60, 25, 5, 10) - Math.PI * 4 * 5, 0.003);
});

test("a link to a missing parameter, or a bad request, is refused and the design stays as it was", async () => {
  await fresh();
  await page.evaluate(() => JS3D.setParam("width", "50"));
  const h = await history();
  const code = await example(1);
  const cases = [
    [{ code, bindings: { width: "nothing" } }, /does not exist/],
    [{ code: "" }, /code must be/],
    [{ code, bindings: { "1x": "width" } }, /cannot be used as params/],
    [{ code, bindings: { width: "" } }, /must be linked/],
    [{ code, bindings: [] }, /bindings must be an object/],
    [{ code, bodyId: "nope" }, /made with Code CAD/],
  ];
  for (const [spec, why] of cases) expect((await build(spec)).error).toMatch(why);
  const r = await build({ code, bindings: { width: "width" } });
  await volumeOf(r.id);
  await page.evaluate(() => JS3D.removeParam("width"));
  const h2 = await history();
  const u = await build({ code, bindings: (await bodyOf(r.id)).codeCad.bindings, bodyId: r.id });
  expect(u.error).toMatch(/does not exist/);
  expect(await history()).toEqual(h2);
  expect(h.undo).toBeLessThan(h2.undo);
});

test("code that is wrong, or returns the wrong thing, gives a plain message, stops its worker and changes nothing", async () => {
  await fresh();
  const h = await history();
  const cases = [
    ["return (", /syntax error/],
    ["throw new Error('boom')", /stopped with an error: boom/],
    ["return null.size", /stopped with an error/],
    ["return replicad.makeCylinder(-1, -1)", /./],
    ["", /code must be/],
    ["const x = 1;", /return one solid/],
    ["return replicad.drawCircle(5)", /return one solid/],
    ["return [replicad.makeBox([0,0,0],[1,1,1])]", /return one solid/],
    ["return replicad.drawCircle(5).sketchOnPlane('XY')", /return one solid/],
    ["return Promise.resolve(replicad.makeBox([0,0,0],[1,1,1]))", /promise/],
    ["return replicad.makeCompound([replicad.makeBox([0,0,0],[5,5,5]), replicad.makeBox([20,0,0],[25,5,5])])", /2 separate pieces/],
    ["return replicad.makeBox([0,0,0],[5,5,5]).faces[0]", /return one solid/],
  ];
  for (const [code, why] of cases) {
    const w = await workers();
    const r = await build({ code });
    expect(r.error, code).toMatch(why);
    expect(r.error, code).not.toMatch(/object|undefined/i);
    if (code) { const w2 = await workers(); expect(w2.made - w.made, code).toBe(1); expect(w2.ended - w.ended, code + " stopped").toBe(1); }
  }
  expect(await history()).toEqual(h);
  await waitIdle(page);
  expect((await bodies(page))).toEqual([]);
});

test("code that never ends is stopped by the time limit, and the app still builds afterwards", async () => {
  await fresh();
  await page.evaluate(() => { window.__app.codeCad.limits.runMs = 1500; });
  const h = await history();
  const w = await workers();
  const t0 = Date.now();
  const r = await build({ code: "while (true) {}" });
  expect(r.kind).toBe("timeout");
  expect(r.error).toMatch(/ran for more than \d+ seconds/);
  expect(Date.now() - t0).toBeLessThan(60_000);
  expect((await workers()).ended - w.ended).toBe(1);
  expect(await history()).toEqual(h);
  expect(await page.evaluate(() => window.__app.codeCad.busy)).toBe(false);
  await page.evaluate(() => { window.__app.codeCad.limits.runMs = 25000; });
  const ok = await build({ code: await example(0) });
  expect(ok.error).toBeUndefined();
  near(await volumeOf(ok.id), L_BRACKET);
});

test("the engine start has its own limit", async () => {
  await fresh();
  await page.evaluate(() => { window.__app.codeCad.limits.startMs = 1; });
  const h = await history();
  const w = await workers();
  const r = await build({ code: await example(0) });
  expect(r.kind).toBe("start");
  expect(r.error).toMatch(/too long to start/);
  expect((await workers()).ended - w.ended).toBe(1);
  expect(await history()).toEqual(h);
});

test("Cancel stops the build, leaves the design alone and lets the next build run", async () => {
  await fresh();
  const h = await history();
  const w = await workers();
  const started = page.evaluate(() => window.__app.codeCad.build({ code: "while (true) {}" }).then(() => null, (e) => ({ error: e.message, kind: e.kind })));
  await page.waitForFunction(() => window.__app.codeCad.busy);
  expect(await build({ code: await example(0) }), "one build at a time").toMatchObject({ error: expect.stringMatching(/already running/) });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__app.codeCad.cancel());
  expect(await started).toMatchObject({ kind: "cancelled", error: expect.stringMatching(/Cancelled/) });
  expect((await workers()).ended - w.ended).toBe(1);
  expect(await page.evaluate(() => window.__app.codeCad.busy)).toBe(false);
  expect(await history()).toEqual(h);
  const ok = await build({ code: await example(0) });
  expect(ok.error).toBeUndefined();
  near(await volumeOf(ok.id), L_BRACKET);
});

test("a result that arrives after the design or its inputs changed is thrown away", async () => {
  // 1. a linked parameter changes while the code runs
  await fresh();
  await page.evaluate(() => JS3D.setParam("w", "10"));
  let started = page.evaluate((code) => window.__app.codeCad.build({ code, bindings: { w: "w" } }).then((id) => ({ id }), (e) => ({ error: e.message })), SPIN(2500));
  await page.waitForFunction(() => window.__app.codeCad.busy);
  await page.evaluate(() => JS3D.setParam("w", "11"));
  const h1 = await history();
  expect((await started).error).toMatch(/design changed/);
  expect(await history()).toEqual(h1);

  // 2. another design is opened while the code runs
  await fresh();
  started = page.evaluate((code) => window.__app.codeCad.build({ code }).then((id) => ({ id }), (e) => ({ error: e.message })), SPIN(2500));
  await page.waitForFunction(() => window.__app.codeCad.busy);
  await loadDoc(page, newDoc("Other", "advanced"));
  const h2 = await history();
  expect((await started).error).toMatch(/design changed/);
  expect(await history()).toEqual(h2);

  // 3. the body being updated is replaced (undone) while the code runs
  await fresh();
  const r = await build({ code: await example(0) });
  await volumeOf(r.id);
  const code = (await bodyOf(r.id)).codeCad.code;
  started = page.evaluate(([code, id]) => window.__app.codeCad.build({ code: "const t = Date.now(); while (Date.now() - t < 2500) {}\n" + code, bodyId: id }).then((x) => ({ id: x }), (e) => ({ error: e.message })), [code, r.id]);
  await page.waitForFunction(() => window.__app.codeCad.busy);
  await page.evaluate(() => window.__store.undo());
  expect((await started).error).toMatch(/design changed/);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
});

test("building needs no network beyond the engine file the app already has", async ({}, info) => {
  await fresh();
  const urls = [];
  const note = (req) => urls.push(req.url());
  page.context().on("request", note);
  const single = info.project.name.startsWith("single");
  if (single) await page.context().setOffline(true); // everything is inside the one file
  try {
    const r = await build({ code: await example(0) });
    expect(r.error).toBeUndefined();
    near(await volumeOf(r.id), L_BRACKET);
  } finally {
    page.context().off("request", note);
    if (single) await page.context().setOffline(false);
  }
  const origin = new URL(info.project.use.baseURL).origin;
  const outside = urls.filter((u) => !/^(blob:|data:)/.test(u) && !(single ? u.startsWith("file:") : u.startsWith(origin + "/")));
  expect(outside, "requests to other places").toEqual([]);
});

test("a design with Code CAD text is refused by Share link, which only carries plain shapes", async () => {
  await fresh();
  await build({ code: await example(0) });
  await page.click("#btn-export");
  await page.click("#btn-share-link");
  await expect(page.locator("#share-note")).toContainText(/project file/);
  await expect(page.locator("#share-url")).toHaveValue("");
});

test("the dialog builds a body from its example, shows errors in place, and reopens the recipe", async () => {
  await fresh();
  await page.evaluate(() => window.__app.codeCad.open());
  await expect(page.locator("#cc-trust")).toContainText("not a sandbox");
  await expect(page.locator("#cc-code")).toHaveValue(/makeBox/);
  await page.selectOption("#cc-example", "1");
  await expect(page.locator("#cc-name")).toHaveValue("Plate");
  await expect(page.locator("#cc-hints")).toContainText("params.width");
  await page.click("#cc-add-link");
  await page.fill(".cc-link input", "width");
  await page.locator(".cc-link select").selectOption({ label: "Choose a parameter…" });
  await page.click("#cc-run");
  await expect(page.locator("#cc-err")).toContainText("needs both");
  // a code error stays in the dialog, which stays open
  await page.locator(".cc-link .xbtn").click();
  await page.fill("#cc-code", "return (");
  await page.click("#cc-run");
  await expect(page.locator("#cc-err")).toContainText("syntax error", { timeout: 90_000 });
  await expect(page.locator("#cc-run")).toBeEnabled();
  // fix it, build, and the dialog closes on a new body
  await page.selectOption("#cc-example", "1");
  await page.click("#cc-run");
  await expect(page.locator(".modal-back.codecad")).toHaveCount(0, { timeout: 90_000 });
  await waitIdle(page);
  const list = await bodies(page);
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe("Plate 1");
  near(list[0].volume, plate());
  // reopen from the body: its code is there and the button says Update
  await page.evaluate((id) => window.__app.codeCad.open({ bodyId: id }), await page.evaluate(() => window.__store.doc.bodies[0].id));
  await expect(page.locator("#cc-code")).toHaveValue(/params\.width/);
  await expect(page.locator("#cc-run")).toHaveText("Update");
  // closing while a build runs cancels it
  await page.fill("#cc-code", "while (true) {}");
  await page.click("#cc-run");
  await expect(page.locator("#cc-cancel")).toBeVisible();
  await page.click("#cc-close");
  await expect(page.locator(".modal-back.codecad")).toHaveCount(0);
  await page.waitForFunction(() => !window.__app.codeCad.busy);
  expect((await bodies(page))).toHaveLength(1);
});

test("Open/Export has a Code CAD… entry that opens the dialog", async () => {
  const entry = page.locator('#menu-export button[data-act="codecad"]');
  await fresh();
  await page.click("#btn-export");
  await entry.click();
  await expect(page.locator(".modal-back.codecad")).toHaveCount(1);
  await page.click("#cc-close");
});
