// Ours: how Layerscape (J.Siwek's src/layerscape.html, guarded by src/lsguard.js and src/layerscape.js) treats a saved
// diorama: layer pictures get full-size canvases only when used, a diorama it can't open is never saved over without
// the user saying so, and a bad layer picture leaves the open scene and its unsaved-changes tracking as they were.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
  // remember every toast, so a short one is never missed under load
  await page.evaluate(() => { window.__toasts = []; const t = window.__app.toast; window.__app.toast = (m, k) => { window.__toasts.push(String(m)); return t(m, k); }; });
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const frame = () => page.frameLocator("#layerscape iframe");
// fn runs in the Layerscape frame as (body, arg), so it sees the page's own variables
const inFrame = (fn, arg) => frame().locator("body").evaluate(fn, arg);
async function openLayerscape() {
  await page.click("#bb-layerscape");
  await expect.poll(() => frame().locator("body").evaluate(() => !!window.__layerscapeReady), { timeout: 90_000 }).toBe(true);
}
const toasts = () => page.evaluate(() => window.__toasts.slice());
const stored = () => page.evaluate(() => window.__store.doc.layerscape);
// a picture as a data URL, drawn in the page
const picture = (w, h, color = "#8ab", type = "image/png") => page.evaluate(({ w, h, color, type }) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h); return c.toDataURL(type);
}, { w, h, color, type });
// a diorama whose pieces each use their own layer
async function diorama(name, W, H, layerCount, png) {
  const image = await picture(8, 8);
  png = png || (await picture(4, 4, "#a63"));
  const pieces = Array.from({ length: layerCount }, (_, i) => ({ id: i + 1, name: "Piece " + (i + 1), type: "standee", layer: i }));
  return { app: "layerscape", version: 1, name, W, H, image, owner: `-1:${W * H}`, nextId: layerCount + 1, horizon: 0.6, pieces,
    layers: { list: pieces.map((p, i) => ({ name: "Layer " + i, x: 0, y: 0, png })), bg: null } };
}

test("a saved diorama makes full-size layer canvases only for the layers its pieces use", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Layer canvases", "beginner"));
  await openLayerscape();
  const W = 300, H = 300;
  const image = await picture(W, H, "#8ab", "image/jpeg"), png = await picture(120, 120, "#a63");
  const d = { app: "layerscape", version: 1, name: "Many layers", W, H, image, owner: `1:${(W * H) / 2},2:${(W * H) / 2}`, nextId: 3, horizon: 0.6,
    pieces: [{ id: 1, name: "Front", type: "standee", layer: 3 }, { id: 2, name: "Back", type: "standee", layer: 7 }],
    layers: { list: Array.from({ length: 40 }, (_, i) => ({ name: "Layer " + i, x: 20, y: 20, png })), bg: null } };
  const out = await inFrame(async (_, { d }) => {
    // count the full-size canvases Layerscape makes for layers (it makes them with blankCanvas)
    // and the pictures it decodes (with loadImage)
    const made = (window.__lsMade = { n: 0 }), orig = blankCanvas, origLoad = loadImage;
    let decoded = 0;
    window.blankCanvas = (w, h) => { if (w === d.W && h === d.H) made.n++; return orig(w, h); };
    window.loadImage = (src) => { decoded++; return origLoad(src); };
    try { await window.__layerscape.load(d); } finally { window.loadImage = origLoad; }
    return { madeAtOpen: made.n, decoded, layers: layers.length, pieces: pieces.length };
  }, { d });
  expect(out).toMatchObject({ layers: 40, pieces: 2 });
  expect(out.madeAtOpen, "full-size layer canvases right after opening").toBeLessThanOrEqual(2);
  expect(out.decoded, "pictures decoded: the photo and the two used layers").toBe(3);
  // building the two pieces makes exactly their two layers
  await expect.poll(() => inFrame(() => window.__lsMade.n), { timeout: 60_000 }).toBe(2);
  await page.evaluate(() => window.__app.layerscape.close());
});

test("a diorama whose layers need too much memory is refused with the reason", async () => {
  test.setTimeout(180_000);
  const json = JSON.stringify(await diorama("Too many layers", 1600, 1600, 24));
  await loadDoc(page, newDoc("Too many layers", "beginner", { layerscape: json }));
  const seen = (await toasts()).length;
  await openLayerscape();
  const why = "It has 24 picture layers of 1600 × 1600 pixels, more than Layerscape can hold safely (at most 23 at that size).";
  expect((await toasts()).slice(seen).join("\n")).toContain(why);
  await expect(frame().locator("#status")).toContainText(why);
  expect(await inFrame(() => layers.length), "no layer of the refused diorama is loaded").toBe(0);
  // the toast shows over the Layerscape window
  expect(await page.evaluate(() => Number(getComputedStyle(document.getElementById("toasts")).zIndex))).toBeGreaterThan(150);
  // the same diorama as a project file says why too
  await frame().locator("#projFile").setInputFiles({ name: "big.layerscape.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect(frame().locator("#status")).toContainText("That file couldn't be opened. " + why);
  await page.evaluate(() => window.__app.layerscape.close());
  expect(await stored()).toBe(json);
});

test("a diorama Layerscape can't open stays byte-identical through Save and Back, until the user replaces it", async () => {
  test.setTimeout(240_000);
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message()); return d.dismiss(); };
  page.on("dialog", onDialog);
  try {
    const kinds = [
      ["refused by the guard", JSON.stringify(await diorama("Too many layers", 1600, 1600, 24))],
      ["a layer picture that can't be read", JSON.stringify(await diorama("Unreadable layer", 40, 40, 1, "data:image/png;base64,AAAA"))],
    ];
    for (const [kind, json] of kinds) {
      await loadDoc(page, newDoc("Kept " + kind, "beginner", { layerscape: json }));
      const seen = (await toasts()).length, asked = dialogs.length;
      await openLayerscape();
      expect((await toasts()).slice(seen).join("\n"), kind).toContain("It stays in your design unchanged");
      await expect.poll(() => inFrame(() => !!window.__layerscape.model), { timeout: 90_000 }).toBe(true);
      // Save: Layerscape asks, Cancel keeps the design's diorama
      await frame().locator("#saveBtn").click();
      await expect.poll(() => dialogs.length, { message: kind }).toBe(asked + 1);
      expect(dialogs.at(-1)).toContain("couldn't be opened");
      await expect.poll(async () => (await toasts()).slice(seen).some((t) => t.startsWith("Kept the Layerscape diorama")), { message: kind }).toBe(true);
      await expect(frame().locator("#status")).not.toContainText("kept with your JumpStart 3D design");
      expect(await stored(), kind).toBe(json);
      // Back: it is not asked again and still kept
      await frame().locator("#lsBack").click();
      await expect(page.locator("#layerscape")).toHaveCount(0);
      expect(await stored(), kind).toBe(json);
      expect(dialogs.length).toBe(asked + 1);
    }
    // the user says yes: the diorama is replaced; when Undo brings the old one back, even after opening Layerscape again, it is asked again
    const json = kinds[0][1];
    await loadDoc(page, newDoc("Replaced", "beginner", { layerscape: json }));
    await openLayerscape();
    await expect.poll(() => inFrame(() => !!window.__layerscape.model), { timeout: 90_000 }).toBe(true);
    const seen = (await toasts()).length;
    let asked = dialogs.length;
    page.off("dialog", onDialog);
    page.once("dialog", (d) => { dialogs.push(d.message()); return d.accept(); });
    await frame().locator("#saveBtn").click();
    await expect.poll(() => stored()).not.toBe(json);
    expect(JSON.parse(await stored()).app).toBe("layerscape");
    expect((await toasts()).slice(seen).join("\n")).toContain("Replaced the Layerscape diorama");
    expect(dialogs.length).toBe(++asked);
    page.on("dialog", onDialog);
    await frame().locator("#lsBack").click();
    await expect(page.locator("#layerscape")).toHaveCount(0);
    await openLayerscape();
    await expect(frame().locator("#status")).toContainText("is open from your JumpStart 3D design");
    await page.evaluate(() => window.__store.undo());
    expect(await stored()).toBe(json);
    await frame().locator("#saveBtn").click();
    await expect.poll(() => dialogs.length, { message: "asked again after Undo" }).toBe(asked + 1);
    expect(await stored()).toBe(json);
    // a different design loaded while Layerscape is open never gets its diorama
    const other = newDoc("Another design", "beginner");
    await page.evaluate((doc) => window.__store.load(doc), other);
    await inFrame(() => window.__layerscape.store());
    expect(await stored()).toBeUndefined();
    expect((await toasts()).at(-1)).toContain("opened for another design");
    await page.evaluate(() => window.__app.layerscape.close());
  } finally {
    page.off("dialog", onDialog);
  }
});

test("a layer picture that can't be read leaves the open scene and its unsaved-changes tracking working", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Bad layer", "beginner"));
  await openLayerscape();
  const d = await diorama("Bad layer", 40, 40, 1, "data:image/png;base64,AAAA");
  d.owner = "1:1600";
  const out = await inFrame(async (_, { d }) => {
    const before = { W, H, name: projectName };
    let error = null;
    try { await window.__layerscape.load(d); } catch (e) { error = String((e && e.message) || e); }
    const after = { W, H, name: projectName };
    // a failure part way through opening (after the counter went up)
    const good = { ...d, name: "Builds badly", layers: null, pieces: [{ id: 1, name: "P", type: "standee" }] }, origBuild = runBuild;
    let midError = null;
    window.runBuild = () => { throw new Error("build failed"); };
    try { await window.__layerscape.load(good); } catch (e) { midError = String((e && e.message) || e); } finally { window.runBuild = origBuild; }
    const counter = suppressDirty;
    dirty = false; markDirty();
    return { before, after, error, midError, counter, dirty };
  }, { d });
  expect(out.error).toContain("couldn't be read");
  expect(out.after, "the scene that was open stays open").toEqual(out.before);
  expect(out.midError).toBe("build failed");
  expect(out.counter).toBe(0);
  expect(out.dirty, "a change after the failure counts as unsaved").toBe(true);
  await page.evaluate(() => window.__app.layerscape.close());
});
