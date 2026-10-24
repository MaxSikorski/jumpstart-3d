// Import units (src/importtoast.js): a closed mesh whose units are not in doubt comes in at once, with no dialog, and a note shows its size
// and three buttons (mm, cm, in) that rescale it as one undo step. The dialog stays only for a real choice: an open mesh, or an STL under 6 mm.
// All files are made here: an ASCII STL box, a stored-zip 3MF in centimetres, and a few broken meshes. Nothing third-party is committed.
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

// ---- files
const QUADS = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]; // a box's faces, corner i = x + 2y + 4z
const corners = (w, d, h) => Array.from({ length: 8 }, (_, i) => [i & 1 ? w : 0, i & 2 ? d : 0, i & 4 ? h : 0]);
const boxTriangles = () => QUADS.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
function stlBox(w, d, h) {
  const v = corners(w, d, h);
  const facets = boxTriangles().map((t) => `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`);
  return Buffer.from(`solid box\n${facets.join("\n")}\nendsolid box\n`);
}
// two triangles that touch at one corner: they cannot be joined into one closed surface, so the mesh stays open
function stlBowTie() {
  const tri = (...p) => `facet normal 0 0 0\nouter loop\n${p.map((q) => `vertex ${q.join(" ")}`).join("\n")}\nendloop\nendfacet`;
  return Buffer.from(`solid tie\n${tri([0, 0, 0], [10, 0, 0], [0, 10, 0])}\n${tri([0, 0, 0], [-10, 0, 0], [0, 0, 10])}\nendsolid tie\n`);
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function storedZip(files) { // [{ name, data }] -> a zip with stored (uncompressed) entries
  const parts = [], dir = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data), crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    const ent = Buffer.alloc(46);
    ent.writeUInt32LE(0x02014b50, 0); ent.writeUInt16LE(20, 4); ent.writeUInt16LE(20, 6); ent.writeUInt32LE(crc, 16); ent.writeUInt32LE(data.length, 20); ent.writeUInt32LE(data.length, 24); ent.writeUInt16LE(name.length, 28); ent.writeUInt32LE(offset, 42);
    parts.push(head, name, data);
    dir.push(ent, name);
    offset += 30 + name.length + data.length;
  }
  const central = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
function threeMF(unit, w, d, h) { // the numbers are in `unit`, so a 2 x 3 x 1 box in centimetres is 20 x 30 x 10 mm
  const v = corners(w, d, h);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join("")}</vertices><triangles>${boxTriangles().map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join("")}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  return storedZip([{ name: "3D/3dmodel.model", data: xml }]);
}
const file = (name, buffer, mimeType = "") => ({ name, mimeType, buffer });

// ---- helpers
async function fresh(mode = "beginner") {
  await loadDoc(page, newDoc("Units " + mode, mode));
  await page.evaluate(() => { document.getElementById("toasts").replaceChildren(); window.__app.vp.view.target.set(0, 0, 0); });
}
async function pick(f, mode = "beginner") { // the Import button's own file picker
  if (mode === "advanced") await page.click("#ad-insert");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(mode === "beginner" ? "#bb-import" : "#ad-ins-model")]);
  await chooser.setFiles(f);
}
async function drop(files) { // a real drag onto the page, as dropimport.spec.mjs does
  const dt = await page.evaluateHandle((files) => {
    const d = new DataTransfer();
    for (const f of files) d.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return d;
  }, files.map((f) => ({ name: f.name, type: f.mimeType, bytes: Array.from(f.buffer) })));
  for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent("#viewport", type, { dataTransfer: dt });
  await dt.dispose();
}
const bodies = () => page.evaluate(() => window.JS3D.list().map((b) => ({ id: b.id, name: b.name, error: b.error, size: [0, 1, 2].map((a) => b.bbox.max[a] - b.bbox.min[a]), min: b.bbox.min, max: b.bbox.max })));
const sizeIs = (b, [w, d, h], digits = 2) => [w, d, h].forEach((v, a) => expect(b.size[a]).toBeCloseTo(v, digits));
const noteFor = (fileName) => page.locator("#toasts .imp-toast", { hasText: `Imported ${fileName}:` });
const unitBtn = (note, u) => note.locator(`[data-unit="${u}"]`);
const undoDepth = () => page.evaluate(() => window.__store.undoStack.length);
const dialog = () => page.locator("#cmd");

for (const mode of ["beginner", "advanced"]) {
  test(`${mode}: a closed STL in mm imports at once with its size in the note`, async () => {
    await fresh(mode);
    await pick(file("Lid.stl", stlBox(20, 10, 5), "model/stl"), mode);
    const note = noteFor("Lid.stl");
    await expect(note).toBeVisible();
    await expect(dialog()).toBeHidden();
    await expect(note).toContainText(/20(\.0)? × 10(\.0)? × 5(\.0)? mm/);
    await expect(unitBtn(note, "mm")).toHaveAttribute("aria-pressed", "true");
    await expect(unitBtn(note, "cm")).toHaveAttribute("aria-pressed", "false");
    await expect(unitBtn(note, "in")).toHaveAttribute("aria-pressed", "false");
    await waitIdle(page);
    const list = await bodies();
    expect(list).toHaveLength(1);
    expect(list[0].error).toBeNull();
    sizeIs(list[0], [20, 10, 5]);
    expect(list[0].min[2]).toBeCloseTo(0, 3); // resting on the plate
    expect((list[0].min[0] + list[0].max[0]) / 2).toBeCloseTo(0, 3); // and centred on it
    expect(await page.evaluate(() => window.JS3D.selection())).toEqual([list[0].id]);
  });
}

test("the note does not take the focus, and stays about 10 seconds", async () => {
  await fresh();
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await pick(file("Stay.stl", stlBox(20, 10, 5)));
  const note = noteFor("Stay.stl");
  await expect(note).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement.closest("#toasts")), "focus stays out of the note").toBe(false);
  await page.waitForTimeout(6000);
  await expect(note).toBeVisible();
  await expect(note).toBeHidden({ timeout: 8000 }); // about 10 s in all
});

test("clicking in makes the body 25.4 times bigger in one undo step; undo gives the original back", async () => {
  await fresh();
  await pick(file("Scale.stl", stlBox(20, 10, 5)));
  const note = noteFor("Scale.stl");
  await expect(note).toBeVisible();
  await waitIdle(page);
  const before = (await bodies())[0];
  const depth = await undoDepth();
  await unitBtn(note, "in").click();
  await expect(unitBtn(note, "in")).toHaveAttribute("aria-pressed", "true");
  await expect(note).toContainText(/508(\.0)? × 254(\.0)? × 127(\.0)? mm/);
  await waitIdle(page);
  expect(await undoDepth(), "one undo step").toBe(depth + 1);
  let list = await bodies();
  expect(list).toHaveLength(1);
  expect(list[0].error).toBeNull();
  sizeIs(list[0], [508, 254, 127], 1);
  expect(list[0].min[2], "still resting on the plate").toBeCloseTo(0, 3);
  expect((list[0].min[0] + list[0].max[0]) / 2, "same centre").toBeCloseTo(0, 3);
  expect((list[0].min[1] + list[0].max[1]) / 2).toBeCloseTo(0, 3);
  await page.evaluate(() => window.JS3D.undo());
  await waitIdle(page);
  list = await bodies();
  expect(list, "undo keeps the one body").toHaveLength(1);
  expect(list[0].id).toBe(before.id);
  sizeIs(list[0], before.size);
  expect(await undoDepth()).toBe(depth);
  await expect(note).toContainText(/20(\.0)? × 10(\.0)? × 5(\.0)? mm/); // the note follows the undo
  await expect(unitBtn(note, "mm")).toHaveAttribute("aria-pressed", "true");
  // and cm is 10 times: back through the buttons
  await unitBtn(note, "cm").click();
  await waitIdle(page);
  sizeIs((await bodies())[0], [200, 100, 50], 1);
});

test("a 3MF in centimetres lands at its file size and the note marks cm; mm reads the numbers as mm", async () => {
  await fresh();
  await pick(file("Case.3mf", threeMF("centimeter", 2, 3, 1), "model/3mf"));
  const note = noteFor("Case.3mf");
  await expect(note).toBeVisible();
  await expect(dialog()).toBeHidden();
  await expect(note).toContainText(/20(\.0)? × 30(\.0)? × 10(\.0)? mm/);
  await expect(unitBtn(note, "cm")).toHaveAttribute("aria-pressed", "true");
  await expect(unitBtn(note, "mm")).toHaveAttribute("aria-pressed", "false");
  await waitIdle(page);
  let list = await bodies();
  expect(list).toHaveLength(1);
  sizeIs(list[0], [20, 30, 10]);
  await unitBtn(note, "mm").click(); // "the file's numbers are millimetres": ten times smaller
  await waitIdle(page);
  expect(await bodies()).toHaveLength(1);
  sizeIs((await bodies())[0], [2, 3, 1]);
  await expect(unitBtn(note, "mm")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.JS3D.undo());
  await waitIdle(page);
  sizeIs((await bodies())[0], [20, 30, 10]);
  await expect(unitBtn(note, "cm")).toHaveAttribute("aria-pressed", "true");
});

test("a 3MF in millimetres marks mm", async () => {
  await fresh();
  await pick(file("Plain.3mf", threeMF("millimeter", 20, 30, 10), "model/3mf"));
  const note = noteFor("Plain.3mf");
  await expect(unitBtn(note, "mm")).toHaveAttribute("aria-pressed", "true");
  await waitIdle(page);
  sizeIs((await bodies())[0], [20, 30, 10]);
});

test("an STL with open edges still opens the dialog, with the warning and the Mesh to STEP choice", async () => {
  await fresh();
  await pick(file("Tie.stl", stlBowTie(), "model/stl"));
  await expect(dialog()).toContainText("Import STL");
  await expect(dialog()).toContainText("Not closed");
  await expect(page.locator("#imp-tostep")).toBeVisible();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  await expect(page.locator("#toasts .imp-toast")).toHaveCount(0);
  await page.locator("#cmd footer").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog()).toBeHidden();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
});

test("an STL under 6 mm still opens the dialog, because the units are in doubt", async () => {
  await fresh();
  await pick(file("Tiny.stl", stlBox(4, 3, 2), "model/stl"));
  await expect(dialog()).toContainText("Import STL");
  await expect(dialog()).toContainText("Closed solid");
  await expect(page.locator("#imp-unit").getByRole("button", { name: "inches" })).toBeVisible();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
  await page.click("#cmd-ok"); // the guess is inches
  await waitIdle(page);
  sizeIs((await bodies())[0], [4 * 25.4, 3 * 25.4, 2 * 25.4], 1);
  await expect(page.locator("#toasts .imp-toast")).toHaveCount(0); // the dialog path has no note
});

test("dropping two closed files gives two bodies, no dialog, and each note keeps working for its own body", async () => {
  await fresh();
  await drop([file("Aaa.stl", stlBox(20, 10, 5), "model/stl"), file("Bbb.stl", stlBox(30, 20, 10), "model/stl")]);
  const [a, b] = [noteFor("Aaa.stl"), noteFor("Bbb.stl")];
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();
  await expect(dialog()).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length)).toBe(2);
  await waitIdle(page);
  const byName = async (re) => (await bodies()).find((x) => re.test(x.name));
  sizeIs(await byName(/^Aaa/), [20, 10, 5]);
  sizeIs(await byName(/^Bbb/), [30, 20, 10]);
  await unitBtn(a, "in").click(); // the first note's button still belongs to the first body, though a second import came after it
  await waitIdle(page);
  sizeIs(await byName(/^Aaa/), [508, 254, 127], 1);
  sizeIs(await byName(/^Bbb/), [30, 20, 10]);
  await unitBtn(b, "cm").click();
  await waitIdle(page);
  sizeIs(await byName(/^Aaa/), [508, 254, 127], 1);
  sizeIs(await byName(/^Bbb/), [300, 200, 100], 1);
  await expect(b).toContainText(/300(\.0)? × 200(\.0)? × 100(\.0)? mm/);
});

test("the note goes when its body is undone away or the design changes", async () => {
  await fresh();
  await pick(file("Gone.stl", stlBox(20, 10, 5)));
  const note = noteFor("Gone.stl");
  await expect(note).toBeVisible();
  await page.evaluate(() => window.JS3D.undo()); // undo the import itself
  await expect(note).toBeHidden();
  await pick(file("Gone2.stl", stlBox(20, 10, 5)));
  await expect(noteFor("Gone2.stl")).toBeVisible();
  await loadDoc(page, newDoc("Another", "beginner"));
  await expect(noteFor("Gone2.stl")).toBeHidden();
});

test("on a phone-width screen the note fits and its buttons can be tapped", async () => {
  const wide = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 667 });
  try {
    await fresh();
    await pick(file("Phone.stl", stlBox(20, 10, 5)));
    const note = noteFor("Phone.stl");
    await expect(note).toBeVisible();
    const box = await note.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    for (const u of ["mm", "cm", "in"]) {
      const bb = await unitBtn(note, u).boundingBox();
      expect(bb.height).toBeGreaterThanOrEqual(24);
      expect(bb.y + bb.height).toBeLessThanOrEqual(667);
    }
    await unitBtn(note, "in").click();
    await waitIdle(page);
    sizeIs((await bodies())[0], [508, 254, 127], 1);
  } finally {
    await page.setViewportSize(wide);
  }
});
