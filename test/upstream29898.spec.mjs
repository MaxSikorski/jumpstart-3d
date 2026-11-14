// Outcome checks for upstream 2.9.8.3 through 2.9.8.9.8, in both builds.
import { test, expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, exportBytes } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });
const run = (fn, arg) => page.evaluate(fn, arg);
const empty = (name, mode = "advanced") => newDoc(name, mode);
async function checkedBodies() {
  await waitIdle(page);
  const list = await bodies(page);
  for (const b of list) { expect(b.error, b.name).toBeNull(); expect(b.volume, b.name).toBeGreaterThan(0); }
  return list;
}
async function at(x, y, z) {
  const [sx, sy] = await run(([x, y, z]) => {
    const vp = window.__app.vp, q = vp.project(vp.camera.position.clone().set(x, y, z)), r = vp.canvas.getBoundingClientRect();
    return [r.left + q[0], r.top + q[1]];
  }, [x, y, z]);
  await page.mouse.click(sx, sy);
}
async function downloaded(click) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), click()]);
  const chunks = [];
  for await (const chunk of await dl.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
// Read ZIP entries from the central directory, including deflated 3MF files.
function unzip(bytes) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP end record missing");
  const entries = new Map();
  let pos = bytes.readUInt32LE(end + 16);
  for (let n = bytes.readUInt16LE(end + 10); n > 0; n--) {
    if (bytes.readUInt32LE(pos) !== 0x02014b50) throw new Error("Bad ZIP central directory");
    const method = bytes.readUInt16LE(pos + 10), size = bytes.readUInt32LE(pos + 20);
    const nameLen = bytes.readUInt16LE(pos + 28), extraLen = bytes.readUInt16LE(pos + 30), commentLen = bytes.readUInt16LE(pos + 32);
    const name = bytes.subarray(pos + 46, pos + 46 + nameLen).toString();
    const local = bytes.readUInt32LE(pos + 42), start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression ${method}`);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test("version and About include the upstream release notes", async () => {
  expect(VERSION).toBe("2.9.8.9.8");
  const label = `Version 2.9.8.9.8 · community build ${BUILD}`;
  await expect(page.locator("#sp-ver")).toHaveText(label);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText(label);
  for (const text of ["New in version 2.9.8.9.8", "From my design", "New in version 2.9.8.9.7"]) await expect(about).toContainText(text);
  await page.keyboard.press("Escape");
});

test("Layerscape opens, makes a puzzle and adds its parts to the design", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, empty("Layerscape", "beginner"));
  await page.click("#bb-layerscape");
  await expect(page.locator("#layerscape iframe")).toHaveCount(1);
  const frame = page.frameLocator("#layerscape iframe");
  await expect.poll(async () => frame.locator("body").evaluate(() => !!window.__layerscapeReady), { timeout: 90_000 }).toBe(true);
  await frame.locator('#lsMode [data-mode="puzzle"]').click();
  await expect.poll(async () => frame.locator("body").evaluate(() => window.__layerscape.puzzle?.seq || 0), { timeout: 90_000 }).toBeGreaterThan(0);
  await frame.locator('#pzKind [data-k="slot"]').click();
  await expect.poll(async () => frame.locator("body").evaluate(() => window.__layerscape.puzzle.model?.kind), { timeout: 90_000 }).toBe("slot");
  await expect(frame.locator("#pzXDesign")).toBeEnabled();
  await frame.locator("#pzXDesign").click();
  await expect.poll(() => run(() => window.__store.doc.bodies.length), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect(page.locator("#layerscape")).toHaveCount(0);
  expect((await checkedBodies()).length).toBeGreaterThan(0);
});

// ours (src/lsguard.js): a diorama inside a design file is untrusted. Layerscape runs in a same-origin frame, so a crafted
// piece id must not become markup, and no picture or colour in it may make the app contact a web address.
test("a hostile Layerscape diorama in a design runs no script and fetches nothing", async () => {
  test.setTimeout(180_000);
  const hits = [];
  await page.route(/example\.invalid/, (r) => { hits.push(r.request().url()); return r.abort(); });
  try {
    const png = await run(() => { const c = document.createElement("canvas"); c.width = c.height = 4; const g = c.getContext("2d"); g.fillStyle = "#8ab"; g.fillRect(0, 0, 4, 4); return c.toDataURL("image/png"); });
    const evil = '"><img src=x onerror="window.__pwned=1">';
    const diorama = (image) => JSON.stringify({ app: "layerscape", version: 1, name: "Hostile", W: 4, H: 4, image, owner: "-1:8,1:8", nextId: 2, horizon: 0.6,
      pieces: [{ id: "1" + evil, name: "bad" }, { id: 1, name: "ok" + evil, type: "standee", color: "url(https://example.invalid/c.png)", auto: '" autofocus onfocus="window.__pwned=1', depth: 0.5, flatBase: true, scale: 1, dx: 0, cloneOf: null }],
      settings: { smooth: 1e30, sheet: "constructor" }, view: { zoom: "url(https://example.invalid/v.png)" }, scene: -1,
      layers: { list: [{ name: "l", x: 0, y: 0, png: "https://example.invalid/l.png" }], bg: "https://example.invalid/bg.png" } });
    const open = async () => {
      await page.click("#bb-layerscape");
      const frame = page.frameLocator("#layerscape iframe");
      await expect.poll(() => frame.locator("body").evaluate(() => !!window.__layerscapeReady), { timeout: 90_000 }).toBe(true);
      return frame;
    };
    // a safe photo: the project opens with only the well-formed piece, its colour replaced, its name as plain text
    await loadDoc(page, newDoc("Hostile diorama", "beginner", { layerscape: diorama(png) }));
    let frame = await open();
    await expect(frame.locator("#pieceList li.pitem")).toHaveCount(1);
    await expect(frame.locator("#pieceList .pname")).toHaveValue("ok" + evil);
    expect(await frame.locator("#pieceList .sw").evaluate((e) => getComputedStyle(e).backgroundImage)).toBe("none");
    expect(await frame.locator("body").evaluate(() => window.__pwned)).toBeUndefined();
    await run(() => window.__app.layerscape.close());
    // a photo that is a web address: the project is refused and Layerscape opens its own sample instead
    await loadDoc(page, newDoc("Hostile diorama 2", "beginner", { layerscape: diorama("https://example.invalid/photo.png") }));
    frame = await open();
    expect(await frame.locator("body").evaluate(() => window.__pwned)).toBeUndefined();
    await run(() => window.__app.layerscape.close());
    expect(await run(() => window.__pwned)).toBeUndefined();
    expect(hits).toEqual([]);
  } finally {
    await page.unroute(/example\.invalid/);
  }
});

test("Helmet Maker adds a solid helmet", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, empty("Helmet", "beginner"));
  await run(() => window.__app.cosforge.open({ mode: "helmet" })); // Simulate → Helmet Maker in Advanced, Workshop → Helmet Maker in Simple
  await expect.poll(() => run(() => !!window.__app.cosforge._t()?.ready()), { timeout: 90_000 }).toBe(true);
  await page.click("#cf-step-export");
  await page.click("#cf-x-design");
  await expect.poll(() => run(() => window.__store.doc.bodies.length), { timeout: 90_000 }).toBeGreaterThan(0);
  expect((await checkedBodies()).length).toBeGreaterThan(0);
});

test("Jig Maker honeycomb removes material from the same jig", async () => {
  test.setTimeout(240_000);
  async function make(hex) {
    await loadDoc(page, empty(`Jig ${hex}`));
    await page.click("#ad-workshop"); await page.click("#ad-jigs");
    await page.locator("#jg-type button", { hasText: "Miter box" }).click();
    await page.locator("#jg-hex").setChecked(hex);
    await page.click("#cmd-ok");
    await expect.poll(() => run(() => window.__store.doc.bodies.length), { timeout: 90_000 }).toBeGreaterThan(0);
    const list = await checkedBodies();
    return { count: list.length, volume: list.reduce((s, b) => s + b.volume, 0) };
  }
  const solid = await make(false), honey = await make(true);
  expect(honey.count).toBe(solid.count);
  expect(honey.volume).toBeLessThan(solid.volume);
});

test("rib and keyhole appear in the timeline and change volume", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Features", "advanced", { bodies: [body("pl", "Plaque", prim("box", { w: 100, d: 80, h: 10 }))] }));
  const initial = (await checkedBodies())[0].volume;
  // UNSURE: picking depends on the viewport camera and face tessellation in each build.
  await run(() => { const vp = window.__app.vp; vp.animateTo({ az: -Math.PI / 2, el: 1.4, target: vp.camera.position.clone().set(0, 0, 5), dist: 220 }); });
  await expect.poll(() => run(() => window.__app.vp.view.el), { timeout: 10_000 }).toBeGreaterThan(1.3);
  await page.click("#ad-features"); await page.click("#ad-rib");
  await at(-30, 0, 10); await at(30, 0, 10); await page.click("#cmd-ok");
  const ribVolume = (await checkedBodies())[0].volume;
  expect(ribVolume).toBeGreaterThan(initial);
  await page.click("#ad-features"); await page.click("#ad-keyhole");
  await at(0, 25, 10); await page.click("#cmd-ok");
  const cutVolume = (await checkedBodies())[0].volume;
  expect(cutVolume).toBeLessThan(ribVolume);
  const mods = await run(() => window.__store.doc.bodies[0].node.mods.map((m) => m.src));
  expect(mods).toEqual(expect.arrayContaining(["rib", "keyhole"]));
  await expect(page.locator('#timeline button[aria-label^="Rib"]')).toHaveCount(1);
  await expect(page.locator('#timeline button[aria-label^="Keyhole"]')).toHaveCount(1);
});

test("Box Maker dovetail fit changes geometry and plates add parts", async () => {
  test.setTimeout(240_000);
  await loadDoc(page, empty("Dovetail"));
  await page.click("#ws-simulate"); await page.click("#sim-bins");
  await page.locator("#bn-style button", { hasText: "Drawer" }).click();
  await page.fill("#bn-units", "2"); await page.press("#bn-units", "Tab");
  await page.fill("#bn-across", "2"); await page.press("#bn-across", "Tab");
  await page.locator("#bn-lock button", { hasText: "Dovetail" }).click();
  await page.locator("#bn-sidelock button", { hasText: "Dovetail" }).click();
  await page.locator("#bn-dvfit button", { hasText: "Snug" }).click();
  await at(0, 0, 0); await page.click("#cmd-ok");
  await expect.poll(() => run(() => window.__store.doc.bodies.length), { timeout: 90_000 }).toBeGreaterThan(0);
  const snug = await checkedBodies();
  const id = snug[0].id;
  await run((id) => window.__app.advanced.openBins(id), id);
  await page.locator("#bn-dvfit button", { hasText: "Loose" }).click();
  await page.click("#cmd-ok");
  const loose = await checkedBodies();
  // UNSURE: the first generated body is expected to be a case whose grooves change with fit.
  expect(loose.find((b) => b.id === id).volume).not.toBe(snug[0].volume);
  await run((id) => window.__app.advanced.openBins(id), id);
  await page.click("#bn-plates-all"); await page.click("#cmd-ok");
  const withPlates = await checkedBodies();
  expect(withPlates.length).toBeGreaterThan(loose.length);
  expect(withPlates.some((b) => /plate/i.test(b.name))).toBe(true);
});

test("Color Lithophane exports a multi-object 3MF from an uploaded picture", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, empty("Color lithophane"));
  await page.click("#ws-print"); await page.click("#ps-r-litho");
  const png = await run(() => { const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"); g.fillStyle = "red"; g.fillRect(0, 0, 16, 32); g.fillStyle = "blue"; g.fillRect(16, 0, 16, 32); return c.toDataURL().split(",")[1]; });
  await page.locator("#cl-file").setInputFiles({ name: "two-colors.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect.poll(() => run(() => window.__app.colorLitho._ui()?.st.name), { timeout: 30_000 }).toBe("two-colors");
  const bytes = await downloaded(() => page.click("#cl-3mf"));
  const entries = unzip(bytes);
  const model = [...entries].find(([name]) => /3dmodel\.model$/i.test(name));
  expect(model).toBeTruthy();
  expect((model[1].toString().match(/<object\b/g) || []).length).toBeGreaterThan(1);
  expect((model[1].toString().match(/<component\b/g) || []).length).toBeGreaterThan(1);
  await page.click("#cl-close");
});

// ours: the design keeps its painted filaments (doc.printPaint) while the lithophane plate is in the sim and after Back to my design
test("the colour lithophane plate never replaces the design's painted filaments", async () => {
  test.setTimeout(180_000);
  // two bodies on two filaments: the app keeps paint only when at least two filaments are used
  const paint = { slots: ["#ff0000", "#00aa00"], of: { bx: 0, by: 1 }, faces: {} };
  const doc = newDoc("Painted", "advanced", { bodies: [body("bx", "Red box", prim("box", { w: 30, d: 30, h: 10 })), body("by", "Green box", prim("box", { w: 20, d: 20, h: 10 }))] });
  doc.printPaint = paint;
  await loadDoc(page, doc);
  await checkedBodies();
  await page.click("#ws-print"); await page.click("#ps-r-litho");
  const png = await run(() => { const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 32, 32); return c.toDataURL().split(",")[1]; });
  await page.locator("#cl-file").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect.poll(() => run(() => window.__app.colorLitho._ui()?.st.name), { timeout: 30_000 }).toBe("red");
  await page.click("#cl-sim");
  await expect.poll(() => run(() => window.__app.advanced.printSim.hasExternal()), { timeout: 60_000 }).toBe(true);
  // a design change while the plate is loaded must not write the plate's filaments into the design
  // (the sim may add the printer's empty filament slots after the design's own: only the design's own are compared)
  const kept = async () => { const pp = await run(() => window.__store.doc.printPaint); return pp && { slots: pp.slots.slice(0, 2), of: pp.of }; };
  await run(() => window.__store.update((d) => { d.name = "Painted 2"; }, "rename"));
  expect(await kept()).toEqual({ slots: paint.slots, of: paint.of });
  await page.click("#ps-ext-back");
  await expect.poll(() => run(() => window.__app.advanced.printSim.hasExternal())).toBe(false);
  expect(await run(() => window.__app.advanced.printSim.st.slots.slice(0, 2).map((q) => q.color))).toEqual(paint.slots);
  await run(() => window.__store.update((d) => { d.name = "Painted 3"; }, "rename"));
  expect(await kept()).toEqual({ slots: paint.slots, of: paint.of });
  await run(() => window.__app.advanced.cancel());
});

test("laser SVG and DXF contain cut geometry for a plate with a hole", async () => {
  test.setTimeout(180_000);
  const hole = { id: "h", seq: 2, t: "hole", kind: "simple", dia: 8, through: true, depth: 10, tapped: false, pitch: 0, clear: 0, tip: false, at: [{ p: [0, 0, 3], n: [0, 0, 1] }] };
  await loadDoc(page, newDoc("Laser", "advanced", { bodies: [body("plate", "Plate", prim("box", { w: 60, d: 40, h: 3 }, [hole]))] }));
  const list = await checkedBodies();
  expect(list[0].volume).toBeLessThan(60 * 40 * 3);
  const svg = (await exportBytes(page, "laser-svg")).bytes.toString();
  expect(svg).toMatch(/<svg\b/i); expect(svg).toMatch(/id="CUT"[^>]*stroke="#ff0000"/i); expect(svg).toMatch(/<path\b/i);
  const dxf = (await exportBytes(page, "laser-dxf")).bytes.toString();
  expect(dxf).toMatch(/(?:LINE|POLYLINE|LWPOLYLINE|ARC|CIRCLE)\s+8\s+CUT/i);
});

test("finishing a sketch line returns to Select", async () => {
  await loadDoc(page, empty("Line"));
  await run(() => window.__app.startSketchTool("line"));
  if (!(await run(() => !!window.__app.sketcher.active))) await page.locator("#cmd button", { hasText: "XY" }).first().click();
  await expect.poll(() => run(() => !!window.__app.sketcher.active)).toBe(true);
  await run(() => { const s = window.__app.sketcher; s.click({ p: [0, 0] }, null); s.click({ p: [20, 0] }, null); s.click({ p: [20, 15] }, null); });
  await page.keyboard.press("Escape");
  await expect.poll(() => run(() => window.__app.sketcher.tool)).toBe("select");
  const before = await run(() => window.__app.sketcher.sketch.ents.filter((e) => e.t === "line").length);
  expect(before).toBeGreaterThan(0);
  await run(() => window.__app.sketcher.click({ p: [40, 40] }, null));
  expect(await run(() => window.__app.sketcher.sketch.ents.filter((e) => e.t === "line").length)).toBe(before);
});

// ours: Simple's More reaches his new tools (Workshop group) and his new Layerscape maker, and Find a tool finds them
test("Simple's More reaches Layerscape, Rib, Keyhole slot, Jig Maker, Helmet Maker, Colour lithophane and laser files", async () => {
  test.setTimeout(120_000);
  await loadDoc(page, newDoc("Simple tools", "beginner", { bodies: [body("pl", "Plate", prim("box", { w: 60, d: 40, h: 3 }))] }));
  await checkedBodies();
  await run(() => window.__app.setFace("simple", true));
  try {
    await page.click("#sr-more");
    const more = page.locator("#simple-more");
    for (const label of ["Layerscape", "Rib", "Keyhole slot", "Jig Maker", "Helmet Maker", "Colour lithophane", "Laser cut file"]) await expect(more.locator("button[data-for]", { hasText: label }).first()).toBeVisible();
    await page.fill("#simple-find", "jig");
    await expect(more.locator("button[data-for]:visible")).toHaveText(["Jig Maker"]);
    await more.locator("button[data-for]", { hasText: "Jig Maker" }).click();
    await expect.poll(() => run(() => window.__app.command?.title || "")).toBe("Jig Maker");
    await run(() => window.__app.advanced.cancel());
    await page.click("#sr-more"); await page.fill("#simple-find", "");
    await run(() => window.__app.select(["pl"]));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), more.locator("button[data-for]", { hasText: "Laser cut file" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/laser\.svg$/);
  } finally {
    await run(() => window.__app.setFace("original", true));
  }
});
