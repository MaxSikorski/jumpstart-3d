// Drop a model file anywhere on the page (src/dropimport.js): the "Drop to import" note, the same opening as the Import button,
// the plate, several files, other files, modes without Import. The drops are real DragEvents carrying a DataTransfer built in the page.
// The files are made by the app itself (a 20 x 10 x 5 mm box away from the plate centre, exported as STL, 3MF, OBJ and STEP), so nothing
// third-party is committed.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, waitIdle } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const TYPES = { stl: "model/stl", "3mf": "model/3mf", obj: "model/obj", step: "model/step" };
const PICKY = "Can't open";
const WORDS = "drop an STL, 3MF, OBJ, STEP, SVG or DXF file.";

// the app's own export of a 20 x 10 x 5 box standing at x 40, y 30, z 25 (so it is neither centred nor on the plate)
const fileCache = new Map();
async function modelFile(kind, name) {
  if (!fileCache.has(kind)) {
    fileCache.set(kind, await page.evaluate(async (kind) => {
      const id = window.JS3D.add("box", { size: [20, 10, 5], at: [40, 30, 25] });
      const bytes = await window.JS3D.export(kind, { ids: [id] });
      window.JS3D.remove(id);
      return Array.from(bytes);
    }, kind));
  }
  return { name, type: TYPES[kind] || "", bytes: fileCache.get(kind) };
}
const textFile = (name, text, type = "") => ({ name, type, bytes: Array.from(Buffer.from(text)) });

async function fileDrag(files) {
  return page.evaluateHandle((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return dt;
  }, files);
}
// a whole drag onto one element: enter, hover, let go
async function drop(files, target = "#viewport") {
  const dt = await fileDrag(files);
  for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent(target, type, { dataTransfer: dt });
  await dt.dispose();
}
const toast = (text) => page.locator("#toasts .toast", { hasText: text });
const state = () => page.evaluate(() => ({ list: window.JS3D.list(), selection: window.JS3D.selection(), bodies: window.__store.doc.bodies.length }));
async function fresh(mode) {
  await loadDoc(page, newDoc("Drop " + mode, mode));
  await page.evaluate(() => { document.getElementById("toasts").replaceChildren(); window.__app.vp.view.target.set(0, 0, 0); });
}
// press OK on the open dialog; when another dialog follows (several mesh files), pass more = true: it is not hidden for long
async function accept(title, more = false) {
  await expect(page.locator("#cmd")).toBeVisible();
  await expect(page.locator("#cmd")).toContainText(title);
  await page.click("#cmd-ok");
  if (!more) await expect(page.locator("#cmd")).toBeHidden();
}
// one body, selected, resting on the plate (z 0) and centred on it, 20 x 10 x 5 mm
function expectOnPlate(s, name) {
  expect(s.list).toHaveLength(1);
  const [b] = s.list;
  expect(b.name).toMatch(name);
  expect(b.error).toBeNull();
  expect(s.selection).toEqual([b.id]);
  expect(b.bbox.min[2]).toBeCloseTo(0, 3);
  expect((b.bbox.min[0] + b.bbox.max[0]) / 2).toBeCloseTo(0, 3);
  expect((b.bbox.min[1] + b.bbox.max[1]) / 2).toBeCloseTo(0, 3);
  [20, 10, 5].forEach((v, a) => expect(b.bbox.max[a] - b.bbox.min[a]).toBeCloseTo(v, 2));
  expect(b.volume).toBeCloseTo(1000, 0);
}

test("the Drop to import note shows while files are over the page, and goes on leaving, dropping and Esc", async () => {
  await fresh("beginner");
  const note = page.locator("#drop-overlay");
  await expect(note).toBeHidden();
  const dt = await fileDrag([textFile("notes.txt", "x")]);
  await page.dispatchEvent("#viewport", "dragenter", { dataTransfer: dt });
  await page.dispatchEvent("#viewport", "dragover", { dataTransfer: dt });
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute("role", "status");
  await expect(note).toContainText("Drop to import");
  await expect(note).toContainText("STL, 3MF, OBJ, STEP, SVG or DXF");
  const box = await note.boundingBox(), vp = page.viewportSize();
  expect(box).toMatchObject({ x: 0, y: 0, width: vp.width, height: vp.height });
  expect(+(await note.evaluate((n) => getComputedStyle(n).zIndex))).toBeGreaterThanOrEqual(1000); // above the canvas and every panel
  await page.dispatchEvent("#viewport", "dragleave", { dataTransfer: dt });
  await expect(note).toBeHidden();
  await page.dispatchEvent("#viewport", "dragenter", { dataTransfer: dt });
  await expect(note).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  await page.dispatchEvent("#viewport", "dragenter", { dataTransfer: dt });
  await expect(note).toBeVisible();
  await page.dispatchEvent("#viewport", "drop", { dataTransfer: dt });
  await expect(note).toBeHidden();
  await expect(toast(PICKY + " notes.txt")).toBeVisible();
  await dt.dispose();
});

test("a drag that carries only text is left alone: no note, nothing prevented", async () => {
  await fresh("beginner");
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData("text/plain", "hello"); return d; });
  for (const type of ["dragenter", "dragover"]) await page.dispatchEvent("#viewport", type, { dataTransfer: dt });
  await expect(page.locator("#drop-overlay")).toBeHidden();
  for (const type of ["dragover", "drop"]) {
    const untouched = await page.evaluate(([dt, type]) => document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })), [dt, type]);
    expect(untouched, type + " of text").toBe(true);
  }
  expect((await state()).bodies).toBe(0);
  await expect(page.locator("#toasts .toast")).toHaveCount(0);
});

test("a file drag is claimed, so the browser does not open the file", async () => {
  await fresh("beginner");
  const dt = await fileDrag([textFile("notes.txt", "hi")]);
  for (const type of ["dragenter", "dragover", "drop"]) {
    const untouched = await page.evaluate(([dt, type]) => document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })), [dt, type]);
    expect(untouched, type + " of a file").toBe(false);
  }
});

for (const mode of ["beginner", "advanced"]) {
  for (const [kind, name, title] of [["stl", "Bracket.stl", "Import STL"], ["3mf", "Bracket.3MF", "Import 3MF"], ["obj", "Bracket.Obj", "Import OBJ"], ["step", "Bracket.STEP", null], ["step", "Bracket.stp", null]]) {
    test(`${mode}: a dropped ${name} lands on the plate, selected`, async () => {
      await fresh(mode);
      await drop([await modelFile(kind, name)], mode === "beginner" ? "#viewport" : ".topbar"); // anywhere on the page
      if (title) await accept(title); // a mesh asks for its units first, like the Import button
      await waitIdle(page);
      expectOnPlate(await state(), /^Bracket/);
    });
  }
}

test("a view panned away still gets the model at the plate centre", async () => {
  await fresh("beginner");
  await page.evaluate(() => window.__app.vp.view.target.set(70, -50, 0));
  await drop([await modelFile("step", "Panned.step")]);
  await waitIdle(page);
  expectOnPlate(await state(), /^Panned/);
});

test("several files at once: each one is imported, in order, one body each", async () => {
  await fresh("advanced");
  await drop([await modelFile("step", "One.STEP"), await modelFile("stl", "Two.stl"), await modelFile("obj", "Three.obj"), await modelFile("step", "Four.stp")]);
  await accept("Import STL", true); // the mesh files ask one after the other
  await accept("Import OBJ");
  await waitIdle(page);
  const s = await state();
  expect(s.list.map((b) => b.name.replace(/ \d+$/, ""))).toEqual(["One", "Two", "Three", "Four"]);
  expect(s.list.every((b) => b.error === null && Math.abs(b.bbox.min[2]) < 1e-3)).toBe(true);
  expect(s.selection).toEqual([s.list[3].id]); // the last one, as after four clicks on Import
});

test("a file of another kind gets one plain message and no body", async () => {
  await fresh("beginner");
  await drop([textFile("notes.txt", "hello")]);
  await expect(toast(`${PICKY} notes.txt: ${WORDS}`)).toBeVisible();
  await page.waitForTimeout(300);
  const s = await state();
  expect(s.bodies).toBe(0);
  await expect(page.locator("#cmd")).toBeHidden();
  await expect(page.locator("#toasts .toast")).toHaveCount(1);
  // pictures belong to the Insert menu, not the drop; the other files of the same drop still import
  await drop([textFile("photo.png", "x", "image/png"), await modelFile("step", "Kept.step")]);
  await expect(toast(`${PICKY} photo.png: ${WORDS}`)).toBeVisible();
  await waitIdle(page);
  expectOnPlate(await state(), /^Kept/);
});

test("a drop in a mode without Import says what to do and imports nothing", async () => {
  await fresh("beginner");
  await page.evaluate(() => localStorage.setItem("jumpstart.chisel.intro", "1")); // Chisel's first-visit dialog would stay open over the next tests
  for (const mode of ["arch", "chisel"]) {
    await page.evaluate((mode) => { window.__app.setMode(mode); document.getElementById("toasts").replaceChildren(); }, mode);
    await expect.poll(() => page.evaluate(() => window.__app.mode)).toBe(mode);
    const dt = await fileDrag([await modelFile("step", "Nope.step")]);
    await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
    await expect(page.locator("#drop-overlay")).toContainText("Switch to Beginner or Advanced to import a model.");
    await page.dispatchEvent("body", "drop", { dataTransfer: dt });
    await dt.dispose();
    await expect(toast("Switch to Beginner or Advanced to import a model.")).toBeAttached();
    expect(await page.evaluate(() => window.__app.mode), "no automatic mode switch").toBe(mode);
    expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  }
  await page.evaluate(() => window.__app.setMode("beginner"));
});

test("a drop over a full-screen tool or an open dialog is refused with a reason", async () => {
  await fresh("beginner");
  const [step, stl1, stl2] = [await modelFile("step", "Behind.step"), await modelFile("stl", "First.stl"), await modelFile("stl", "Second.stl")]; // made before the tool opens: they add and remove a box
  await page.evaluate(() => window.__app.sketch3d.open());
  await expect(page.locator("body.s3d-on")).toHaveCount(1);
  await drop([step]);
  await expect(toast("Close this tool first")).toBeAttached();
  await page.evaluate(() => window.__app.sketch3d.close());
  await expect(page.locator("body.s3d-on")).toHaveCount(0);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  // the units dialog of one drop is open: a second drop waits for it
  await page.evaluate(() => document.getElementById("toasts").replaceChildren());
  await drop([stl1]);
  await expect(page.locator("#cmd")).toContainText("Import STL");
  await drop([stl2]);
  await expect(toast("Finish or close the open dialog first")).toBeAttached();
  await expect(page.locator("#cmd")).toContainText("First");
  await page.click("#cmd-ok");
  await waitIdle(page);
  expectOnPlate(await state(), /^First/);
});

test("an SVG and a DXF dropped in Advanced open the same size dialog as Insert", async () => {
  await fresh("advanced");
  await drop([textFile("Plate.SVG", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect x="0" y="0" width="20" height="10"/></svg>', "image/svg+xml")]);
  await expect(page.locator("#cmd")).toContainText("Insert SVG");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const lines = ["0", "SECTION", "2", "ENTITIES"];
  for (const [x0, y0, x1, y1] of [[0, 0, 30, 0], [30, 0, 30, 20], [30, 20, 0, 20], [0, 20, 0, 0]]) lines.push("0", "LINE", "8", "0", "10", x0, "20", y0, "30", "0", "11", x1, "21", y1, "31", "0");
  lines.push("0", "ENDSEC", "0", "EOF");
  await drop([textFile("Outline.dxf", lines.join("\n") + "\n")]);
  await expect(page.locator("#cmd")).toContainText("Insert DXF");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await page.evaluate(() => window.__store.doc.sketches.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
});

test("a STEP file that cannot be built shows a message, not only the status line", async () => {
  await fresh("beginner");
  await drop([textFile("broken.step", "ISO-10303-21;\nthis is not a STEP file\nEND-ISO-10303-21;\n")]);
  await expect(toast("Couldn't build broken")).toBeVisible({ timeout: 60_000 });
  await waitIdle(page);
  const s = await state();
  expect(s.list).toHaveLength(1);
  expect(s.list[0].error).toBeTruthy();
});

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: the Import button still opens the picker and lands the model the same way`, async () => {
    await fresh(mode);
    if (mode === "advanced") await page.click("#ad-insert");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(mode === "beginner" ? "#bb-import" : "#ad-ins-model")]);
    const f = await modelFile("stl", "Picked.stl");
    await chooser.setFiles({ name: f.name, mimeType: f.type, buffer: Buffer.from(f.bytes) });
    await accept("Import STL");
    await waitIdle(page);
    expectOnPlate(await state(), /^Picked/);
    // and a picker file of the wrong kind keeps its old message
    await page.evaluate(() => document.getElementById("toasts").replaceChildren());
    if (mode === "advanced") await page.click("#ad-insert");
    const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.click(mode === "beginner" ? "#bb-import" : "#ad-ins-model")]);
    await chooser2.setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(toast("Pick an SVG, DXF or picture file.")).toBeVisible();
  });
}
