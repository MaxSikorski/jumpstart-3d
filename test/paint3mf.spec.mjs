// Pre-painted 3MF: a design painted in the 3D Print Sim exports a 3MF whose triangles already carry their
// filament, so the slicer (Orca, Snapmaker Orca, Prusa, Bambu) opens it with nothing left to paint.
// The expected codes are written out here from the slicers' own encoding (a leaf triangle's filament number
// is stored as a hex string read back to front: 1 -> "4", 2 -> "8", 3 -> "0C", 4 -> "1C", 5 -> "2C"), and
// the slicer-side decoder is rewritten independently below, so the app's own table is not the oracle.
import { test, expect } from "@playwright/test";
import { paintCode } from "../src/paint3mf.js";
import { boot, watchErrors, loadDoc, waitIdle, newDoc, body, prim, exportBytes, reload } from "./helpers.mjs";

const NS = "http://schemas.slic3r.org/3mf/2017/06";

// the 3D/3dmodel.model text of a downloaded 3MF (makeZip writes stored entries)
function modelText(bytes) {
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 30, offset + 30 + nameLength) === "3D/3dmodel.model") return bytes.toString("utf8", start, start + size);
    offset = start + size;
  }
  throw new Error("no 3D/3dmodel.model in the 3MF");
}

// PrusaSlicer's TriangleSelector::deserialize for a triangle that is not split: the string is read from its
// last character; the first nibble holds 2 bits "split sides" (0 = a leaf) and 2 bits of state; state 3 means
// the next nibble holds (filament number - 3).
function leafFilament(code) {
  const nibbles = [...code].reverse().map((c) => parseInt(c, 16));
  expect(nibbles.every((n) => n >= 0 && n <= 15), `hex string ${code}`).toBe(true);
  expect(nibbles[0] & 3, `${code} is a whole-triangle code`).toBe(0);
  let state = nibbles[0] >> 2;
  if (state === 3) { expect(nibbles.length).toBe(2); state = 3 + nibbles[1]; } else expect(nibbles.length).toBe(1);
  return state;
}

async function readTriangles(page, bytes) {
  const model = modelText(bytes);
  const r = await page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    return {
      errors: xml.querySelectorAll("parsererror").length,
      ns: xml.documentElement.getAttribute("xmlns:slic3rpe"),
      objects: [...xml.querySelectorAll("object")].map((o) => [...o.querySelectorAll("triangle")].map((t) => ({
        seg: t.getAttribute("slic3rpe:mmu_segmentation"), paint: t.getAttribute("paint_color"),
      }))),
    };
  }, model);
  expect(r.errors).toBe(0);
  return { ...r, model };
}

const cube = () => newDoc("Painted cube", "beginner", { bodies: [body("b1", "Cube", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), undefined, { color: "#3b82c4" })] });

// the screen position of the middle of one side of the 20 mm cube lying on the plate (centred, z 0..20)
const SIDES = { top: [0, 0, 20], front: [0, -10, 10], right: [10, 0, 10], left: [-10, 0, 10], back: [0, 10, 10] };
async function clickSide(page, side) {
  const [x, y] = await page.evaluate((p) => {
    const vp = window.__app.vp, v = vp.camera.position.clone().set(p[0], p[1], p[2]).project(vp.camera), r = vp.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, SIDES[side]);
  await page.mouse.click(x, y);
}

let page, errors;
test.beforeEach(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterEach(async () => { await page.close(); });

// paint four sides of the cube with F2..F5 in the real 3D Print Sim, with real clicks
async function paintTheCube() {
  await loadDoc(page, cube());
  await page.click("#bb-printsim");
  await page.waitForSelector("#ps-printer");
  await page.selectOption("#ps-printer", "p1s"); // an AMS: up to 16 filaments, 4 shown at first
  await page.click("#ps-addfil"); // F5 becomes the brush, but its row shows only once it is used
  await page.click("#ps-paint button:has-text(\"Faces\")");
  await page.waitForFunction(() => document.querySelector("#ps-status")?.textContent.startsWith("Sliced"));
  const paint = async (slot, side) => { await page.click("#ps-frow-" + slot); await clickSide(page, side); };
  const settled = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => document.querySelector("#ps-status")?.textContent.startsWith("Sliced")); };
  await page.click("#ps-rx"); // the cube lies on another side: the face that was at the back is on top
  await settled();
  await clickSide(page, "top"); // F5
  await page.click("#ps-reset");
  await settled();
  await paint(1, "top");
  await paint(2, "front");
  await paint(3, "right");
  await page.click("#cmd-ok"); // Done: the sim closes and the Export menu is free again
}

test("a cube painted with four filaments exports a 3MF that carries them", async () => {
  await paintTheCube();
  // what the sim holds: face index -> filament index, read from the app and not from the file
  const painted = await page.evaluate(() => {
    const st = window.__app.advanced.printSim.st, m = st.paint.get("b1");
    const fg = window.__app.scene.views.get("b1").data.faceGroups;
    return { faces: fg.length, byFace: m ? [...m.entries()] : [], groups: fg };
  });
  expect(painted.faces).toBe(6);
  expect(painted.byFace.map(([, s]) => s).sort()).toEqual([1, 2, 3, 4]);

  const { bytes } = await exportBytes(page, "3mf");
  const { ns, objects } = await readTriangles(page, bytes);
  expect(ns).toBe(NS);
  expect(objects).toHaveLength(1);
  const tris = objects[0];
  expect(tris).toHaveLength(12); // a cube: 6 faces, 2 triangles each
  // every triangle: the file says what the sim painted (none: no attribute)
  const slotOfTri = new Array(12).fill(null);
  for (const [f, s] of painted.byFace) { const [start, count] = painted.groups[f]; for (let t = start / 3; t < (start + count) / 3; t++) slotOfTri[t] = s; }
  let withCode = 0;
  tris.forEach((t, i) => {
    if (slotOfTri[i] == null) { expect(t.seg, `triangle ${i} is not painted`).toBeNull(); expect(t.paint).toBeNull(); return; }
    withCode++;
    expect(t.seg, `triangle ${i}`).toBe(t.paint); // Orca and Prusa read one name, Bambu the other
    expect(leafFilament(t.seg)).toBe(slotOfTri[i] + 1);
  });
  expect(withCode).toBe(8);
  // the codes themselves, F2..F5
  const codes = new Set(tris.map((t) => t.seg).filter(Boolean));
  expect([...codes].sort()).toEqual(["0C", "1C", "2C", "8"]);
  const painted3mf = modelText(bytes);

  // an edit and its undo leave the paint alone
  await page.evaluate(() => { window.__store.update((d) => { d.bodies[0].name = "Renamed"; }, "Rename"); window.__store.undo(); });
  expect(modelText((await exportBytes(page, "3mf")).bytes)).toBe(painted3mf);

  // saved and reloaded: the sim has not been opened since, and the file still carries the paint
  await page.evaluate(() => window.__app.projects.saveNow());
  await reload(page);
  await page.waitForFunction(() => window.__app.projects.started === true);
  await page.waitForFunction(() => window.__store.doc.bodies.length === 1);
  await waitIdle(page);
  expect(modelText((await exportBytes(page, "3mf")).bytes)).toBe(painted3mf);
  // and the sim shows the same paint again
  await page.click("#bb-printsim");
  await page.waitForSelector("#ps-printer");
  expect(await page.evaluate(() => [...window.__app.advanced.printSim.st.paint.get("b1").values()].sort())).toEqual([1, 2, 3, 4]);
  expect(errors).toEqual([]);
});

test("the slot codes are the slicers' for filaments 1 to 15", () => {
  for (let n = 1; n <= 15; n++) expect(leafFilament(paintCode(n - 1)), "filament " + n).toBe(n);
  expect([1, 2, 3, 4, 5].map((n) => paintCode(n - 1))).toEqual(["4", "8", "0C", "1C", "2C"]);
  expect(paintCode(-1)).toBeNull();
  expect(paintCode(15)).toBeNull(); // a 16th filament has no code: left to the slicer's default
});

test("a design that was never painted exports a 3MF with no paint, as before", async () => {
  await loadDoc(page, cube());
  const { objects, model } = await readTriangles(page, (await exportBytes(page, "3mf")).bytes);
  expect(model).not.toContain("slic3rpe");
  expect(model).not.toContain("paint_color");
  expect(objects[0].every((t) => t.seg === null && t.paint === null)).toBe(true);
});

test("at most 15 filaments can be added, the most the file can code", async () => {
  await loadDoc(page, cube());
  await page.click("#bb-printsim");
  await page.selectOption("#ps-printer", "a2l"); // 19 AMS slots: the printer would allow more than 15
  for (let i = 0; i < 20 && await page.locator("#ps-addfil").count(); i++) await page.click("#ps-addfil");
  expect(await page.evaluate(() => window.__app.advanced.printSim.st.slots.length)).toBe(15);
  await expect(page.locator("#ps-addfil")).toHaveCount(0);
  // the body's own filament list stops at 15 too
  await expect(page.locator("#ps-slot-b1 option[value=new]")).toHaveCount(0);
});

test("a body edited into another number of faces loses its face paint in the sim and in the file, and can be painted again", async () => {
  await loadDoc(page, cube());
  await page.click("#bb-printsim");
  await page.selectOption("#ps-printer", "p1s");
  await page.click("#ps-frow-1");
  await clickSide(page, "top");
  expect(await page.evaluate(() => window.__app.advanced.printSim.st.paint.get("b1").size)).toBe(1);
  await page.click("#cmd-ok");
  // the same body, now a cylinder (3 faces instead of 6)
  await page.evaluate(() => window.__store.update((d) => { d.bodies[0].node = { t: "prim", kind: "cylinder", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] }; }, "Cylinder"));
  await waitIdle(page);
  expect(await page.evaluate(() => window.__app.scene.views.get("b1").data.faceGroups.length)).toBe(3);
  expect(modelText((await exportBytes(page, "3mf")).bytes), "stale paint is not exported").not.toContain("mmu_segmentation");
  await page.click("#bb-printsim");
  await page.waitForSelector("#ps-printer");
  expect(await page.evaluate(() => window.__app.advanced.printSim.st.paint.has("b1")), "the sim drops it too").toBe(false);
  await page.click("#ps-frow-1");
  await clickSide(page, "top");
  await page.click("#cmd-ok");
  const info = await page.evaluate(() => {
    const m = window.__app.advanced.printSim.st.paint.get("b1"), fg = window.__app.scene.views.get("b1").data.faceGroups;
    return { size: m.size, tris: [...m.keys()].reduce((n, f) => n + fg[f][1] / 3, 0) };
  });
  expect(info.size).toBe(1);
  const { objects } = await readTriangles(page, (await exportBytes(page, "3mf")).bytes);
  const coded = objects[0].filter((t) => t.seg);
  expect(coded.length).toBe(info.tris);
  expect(coded.every((t) => t.seg === "8" && t.paint === "8")).toBe(true);
});

test("a damaged printPaint in a design file is ignored, not fatal", async () => {
  for (const bad of ["junk", { slots: 5, of: {} }, { slots: [], of: { b1: 1 }, faces: { b1: null } }, { slots: [], of: { b1: 1 }, faces: { b1: { n: 6, f: 7 } } }]) {
    const doc = cube();
    doc.printPaint = bad;
    await loadDoc(page, doc);
    const { objects, model } = await readTriangles(page, (await exportBytes(page, "3mf")).bytes);
    expect(model, JSON.stringify(bad)).not.toContain("mmu_segmentation");
    expect(objects[0]).toHaveLength(12);
  }
  expect(errors).toEqual([]);
});
