// Name plates (Phase 3 step 4a): the Name plate dialog and JS3D.namePlate make a plate sized to one line of text, with the letters
// raised as a second body in their own colour or cut into the plate. The text oracle below is independent of the app: opentype.js on
// the bundled fonts, contours the way src/textgeo.js draws them (6 points to a quadratic span, 8 to a cubic), even-odd nesting.
// "Formula" is the plate layout of BRIDGE.md worked out from that text's width, height and area.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import opentype from "../third_party/opentype.js/dist/opentype.module.js";
import { fontBytes } from "../src/fonts.js";
import { boot, watchErrors, loadDoc, exportBytes } from "./helpers.mjs";

const fonts = {};
function measure(str, size, font = "sans") {
  const f = (fonts[font] ??= opentype.parse(fontBytes(font)));
  const cap = (f.tables.os2 && f.tables.os2.sCapHeight) || f.unitsPerEm * 0.7;
  const path = f.getPath(str, 0, 0, (size * f.unitsPerEm) / cap);
  const contours = [];
  let cur = null, lx = 0, ly = 0;
  const add = (x, y) => cur.push([x, -y]);
  for (const c of path.commands) {
    if (c.type === "M") { if (cur && cur.length > 2) contours.push(cur); cur = []; add(c.x, c.y); lx = c.x; ly = c.y; }
    else if (c.type === "L") { add(c.x, c.y); lx = c.x; ly = c.y; }
    else if (c.type === "Q") {
      for (let i = 1; i <= 6; i++) { const s = i / 6, a = (1 - s) ** 2, b = 2 * (1 - s) * s, d = s * s; add(a * lx + b * c.x1 + d * c.x, a * ly + b * c.y1 + d * c.y); }
      lx = c.x; ly = c.y;
    } else if (c.type === "C") {
      for (let i = 1; i <= 8; i++) { const s = i / 8, a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, e = 3 * (1 - s) * s * s, d = s ** 3; add(a * lx + b * c.x1 + e * c.x2 + d * c.x, a * ly + b * c.y1 + e * c.y2 + d * c.y); }
      lx = c.x; ly = c.y;
    } else if (c.type === "Z") { if (cur && cur.length > 2) contours.push(cur); cur = null; }
  }
  if (cur && cur.length > 2) contours.push(cur);
  const area = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
  const inside = (pt, poly) => {
    let in_ = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) in_ = !in_;
    }
    return in_;
  };
  let textArea = 0;
  contours.forEach((c, i) => {
    const depth = contours.reduce((n, o, j) => (j !== i && inside(c[0], o) ? n + 1 : n), 0);
    textArea += (depth % 2 ? -1 : 1) * Math.abs(area(c));
  });
  const xs = contours.flat().map((p) => p[0]), ys = contours.flat().map((p) => p[1]);
  return { tw: Math.max(...xs) - Math.min(...xs), th: Math.max(...ys) - Math.min(...ys), textArea };
}

// the plate layout: sizes, hole centres (plate-local, y = 0), the text's shift and the plate's area
function formula({ text, font = "sans", size = 10, shape = "rounded", holes = "hang", hd, m = 3 }) {
  const { tw, th, textArea } = measure(text, size, font);
  hd ??= holes === "hang" ? 5 : 3.5;
  const D = th + 2 * m, pill = shape === "pill", rc = pill ? D / 2 : m, n = holes === "none" ? 0 : holes === "hang" ? 1 : 2;
  const e = n ? (pill ? hd / 2 + m : hd + m) : 0, W = tw + (pill ? D : 2 * m) + n * e;
  const lx = pill ? -W / 2 + D / 2 : -W / 2 + m + hd / 2;
  const holeX = holes === "hang" ? [lx] : holes === "screws" ? [lx, -lx] : [];
  const area = W * D - (4 - Math.PI) * rc * rc - n * Math.PI * (hd / 2) ** 2;
  return { tw, th, textArea, D, W, rc, hd, holeX, tx: holes === "hang" ? e / 2 : 0, area };
}
const f3 = (v) => String(Math.round(v * 1000) / 1000);

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = (mode = "beginner") => run((m) => JS3D.newDesign(m), mode);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const counts = () => run(() => ({ bodies: JS3D.doc().bodies.length, sketches: JS3D.doc().sketches.length, undo: __store.undoStack.length }));
const near = (got, want, rel, what) => expect(Math.abs(got - want) / Math.abs(want), `${what}: ${got} vs ${want}`).toBeLessThan(rel);
const field = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a)));
async function openFromRibbon() {
  await page.click("#ad-features");
  await page.click("#ad-nameplate");
  await expect(page.locator("#cmd")).toContainText("Name plate");
}

test("Advanced: Create > Advanced Create > Name plate makes 'Max' as a plate and a second body in one undo step", async () => {
  await fresh("advanced");
  await openFromRibbon();
  await field("np-text", "Max");
  const f = formula({ text: "Max" });
  await expect(page.locator("#cmd")).toContainText(`Plate ${f3(f.W)} mm × ${f3(f.D)} mm × 3 mm; text ${f3(f.tw)} mm × ${f3(f.th)} mm.`);
  await expect(page.locator("#cmd")).toContainText("change filament at 3 mm (the top of the plate)");
  const undoBefore = await run(() => __store.undoStack.length);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["Name plate Max", "Name plate Max text"]);
  expect(list.map((b) => b.color)).toEqual(["#2b7bb9", "#ffffff"]);
  expect(list.filter((b) => b.error)).toEqual([]);
  const [plate, text] = list;
  const doc = await run(() => JS3D.doc());
  expect(doc.sketches).toHaveLength(1);
  expect(doc.sketches[0].hidden).toBe(true);
  const ents = doc.sketches[0].ents;
  expect([ents.filter((e) => e.t === "line").length, ents.filter((e) => e.t === "arc").length, ents.filter((e) => e.t === "circle").length]).toEqual([4, 4, 1]);
  near(plate.volume, f.area * 3, 0.001, "plate volume");
  near(text.volume, f.textArea * 1, 0.001, "text volume");
  expect(plate.bbox.max[0] - plate.bbox.min[0]).toBeCloseTo(f.W, 2);
  expect(plate.bbox.max[1] - plate.bbox.min[1]).toBeCloseTo(f.D, 2);
  expect(plate.bbox.min[2]).toBeCloseTo(0, 4);
  expect(plate.bbox.max[2]).toBeCloseTo(3, 4);
  expect(text.bbox.min[2]).toBeCloseTo(3, 4);
  expect(text.bbox.max[2]).toBeCloseTo(4, 4);
  const mid = (b, i) => (b.bbox.min[i] + b.bbox.max[i]) / 2;
  const off = [mid(text, 0) - mid(plate, 0) - f.tx, mid(text, 1) - mid(plate, 1)];
  console.log(`name plate "Max": text centre offset from the formula (mm): x ${off[0].toFixed(4)}, y ${off[1].toFixed(4)}`);
  expect(Math.abs(off[0])).toBeLessThan(0.3);
  expect(Math.abs(off[1])).toBeLessThan(0.3);
  expect(text.bbox.min[0] - plate.bbox.min[0]).toBeGreaterThan(3 - 0.3);
  expect(plate.bbox.max[0] - text.bbox.max[0]).toBeGreaterThan(3 - 0.3);
  expect(text.bbox.min[1] - plate.bbox.min[1]).toBeGreaterThan(3 - 0.3);
  expect(plate.bbox.max[1] - text.bbox.max[1]).toBeGreaterThan(3 - 0.3);
  expect(await run(() => __app.sel)).toEqual([plate.id, text.id]);
  expect(await run(() => __store.undoStack.length)).toBe(undoBefore + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Add Name plate Max");
  await run(() => JS3D.undo());
  expect(await counts()).toMatchObject({ bodies: 0, sketches: 0 });
});

test("holes sit where the layout puts them, for rounded and pill, hanging and screws", async () => {
  await fresh();
  const cases = [
    { shape: "rounded", holes: "hang" }, { shape: "pill", holes: "hang" },
    { shape: "rounded", holes: "screws", hd: 4 }, { shape: "pill", holes: "screws", hd: 3.5 },
  ];
  const ids = await run((cs) => cs.map((c, i) => JS3D.namePlate({ text: "Max", shape: c.shape, holes: c.holes, holeDia: c.hd, at: [0, i * 60, 0] }).plate), cases);
  const doc = await run(() => JS3D.doc());
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  for (const [i, c] of cases.entries()) {
    const f = formula({ text: "Max", shape: c.shape, holes: c.holes, hd: c.hd });
    const body = await run((id) => JS3D.get(id).node, ids[i]);
    const sk = doc.sketches.find((s) => s.id === body.sketch);
    const P = new Map(sk.pts.map((p) => [p.id, p]));
    const circles = sk.ents.filter((e) => e.t === "circle");
    expect(circles.map((e) => P.get(e.c).x).sort((a, b) => a - b), JSON.stringify(c)).toHaveLength(f.holeX.length);
    const got = circles.map((e) => [P.get(e.c).x, P.get(e.c).y, e.r]).sort((a, b) => a[0] - b[0]);
    const want = [...f.holeX].sort((a, b) => a - b);
    got.forEach(([x, y, r], k) => {
      expect(Math.abs(x - want[k]), `${JSON.stringify(c)} hole ${k} x ${x} vs ${want[k]}`).toBeLessThan(1e-6);
      expect(Math.abs(y)).toBeLessThan(1e-9);
      expect(Math.abs(r - f.hd / 2)).toBeLessThan(1e-6);
    });
    if (c.shape === "pill") expect([sk.ents.filter((e) => e.t === "line").length, sk.ents.filter((e) => e.t === "arc").length]).toEqual([2, 2]);
    near(list.find((b) => b.id === ids[i]).volume, f.area * 3, 0.001, `${JSON.stringify(c)} plate volume`);
  }
});

test("a 3MF export has two objects in two colours", async () => {
  await fresh();
  await run(() => JS3D.namePlate({ text: "Max" }));
  await built();
  const text = bytes(await run(() => JS3D.export("3mf"))).toString("latin1");
  expect(text.match(/<object /g)).toHaveLength(2);
  expect(text).toContain('displaycolor="#2B7BB9FF"');
  expect(text).toContain('displaycolor="#FFFFFFFF"');
});

test("cut in: one body with a Deboss text feature, the exact volume loss, and the depth limit; a named raised plate on a lifted base", async () => {
  await fresh("advanced");
  const spec = { text: "Workshop 12", font: "serif", size: 8, depth: 1, shape: "pill", holes: "screws", holeDia: 3.5, color: "#c9a27a" };
  const [cut, raised, tag] = await run((s) => [JS3D.namePlate({ ...s, style: "cut" }), JS3D.namePlate({ ...s, style: "raised", at: [150, 0, 0] }), JS3D.namePlate({ text: "Max", textColor: "#000000", name: "Tag", at: [0, 0, 5] })], spec);
  expect(cut.textBody).toBeNull();
  expect(cut.size).toEqual([96.15, 17.078, 3]);
  expect(raised.size).toEqual([96.15, 17.078, 4]);
  const node = await run((id) => JS3D.get(id).node, cut.plate);
  expect(node.mods.map((m) => m.t)).toEqual(["emboss"]);
  expect(node.mods[0]).toMatchObject({ kind: "plane", mode: "deboss", p: [0, 0, 3], n: [0, 0, 1], x: [1, 0, 0], str: "Workshop 12", font: "serif", size: 8, depth: 1 });
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list).toHaveLength(5); // the cut plate, the raised plate and its letters, the tag and its letters
  expect(list.find((b) => b.id === cut.plate).color).toBe("#c9a27a");
  const tagPlate = list.find((b) => b.id === tag.plate), tagText = list.find((b) => b.id === tag.textBody);
  expect([tagPlate.name, tagText.name]).toEqual(["Tag", "Tag text"]);
  expect(tagText.color).toBe("#000000");
  expect(tagText.bbox.min[2]).toBeCloseTo(8, 4);
  expect(tagText.bbox.max[2]).toBeCloseTo(9, 4);
  expect(tag.size).toEqual([44.057, 16.071, 4]);
  const f = formula({ text: "Workshop 12", font: "serif", size: 8, shape: "pill", holes: "screws", hd: 3.5 });
  const v = list.find((b) => b.id === cut.plate);
  near(v.volume, f.area * 3 - f.textArea * 1, 0.001, "cut-in plate volume");
  expect(v.volume).toBeLessThan(list.find((b) => b.id === raised.plate).volume);
  expect(v.bbox.min[2]).toBeCloseTo(0, 4);
  expect(v.bbox.max[2]).toBeCloseTo(3, 4);
  expect(await failure((s) => JS3D.namePlate(s), { ...spec, style: "cut", depth: 2.5 })).toBe("depth must be at most 2.4 mm here, so 0.6 mm of plate stays under the letters");
  // the Deboss text row in the Advanced timeline opens the existing Edit Emboss text dialog, with the words in it
  await page.locator('.tl-item[aria-label^="Deboss text"]').dblclick();
  await expect(page.locator("#cmd")).toContainText("Edit Emboss text");
  await expect(page.locator("#em-text")).toHaveValue("Workshop 12");
  await page.click("#cmd .xbtn");
  await expect(page.locator("#cmd")).toBeHidden();
});

test("bad input: each bridge error text, and nothing is added", async () => {
  await fresh();
  const before = await counts();
  const max = formula({ text: "Max" });
  const bad = [
    [{}, "text must be a non-empty string"],
    [{ text: "" }, "text must be a non-empty string"],
    [{ text: "  " }, "text must be a non-empty string"],
    [{ text: "A\nB" }, "text must be one line, without line breaks or tabs"],
    [{ text: "A\tB" }, "text must be one line, without line breaks or tabs"],
    [{ text: "A".repeat(41) }, "text can have at most 40 characters (this has 41)"],
    [{ text: "A", font: "comic" }, 'font must be "sans", "serif" or "mono"'],
    [{ text: "Łukasz żółw" }, 'text has characters the fonts do not have: "Ł", "ż", "ł". The fonts cover English and Western European letters, digits and common symbols.'],
    [{ text: "Max", size: 1 }, "size must be a number from 2 to 100 (mm, the height of a capital letter)"],
    [{ text: "Max", style: "inlay" }, 'style must be "raised" or "cut"'],
    [{ text: "Max", depth: 0.1 }, "depth must be a number from 0.2 to 10 (mm)"],
    [{ text: "Max", thickness: 0.5 }, "thickness must be a number from 0.6 to 20 (mm)"],
    [{ text: "Max", thickness: 0.7, style: "cut", depth: 0.2 }, "the plate is too thin to cut text into (make it at least 0.8 mm)"],
    [{ text: "Max", margin: 1 }, "margin must be a number from 1.5 to 20 (mm)"],
    [{ text: "Max", shape: "oval" }, 'shape must be "rounded" or "pill"'],
    [{ text: "Max", holes: "two" }, 'holes must be "none", "hang" or "screws"'],
    [{ text: "-", size: 2, margin: 1.5 }, 'the text is too small for a hole here: use a larger margin, or holes "none"'],
    [{ text: "Max", holeDia: 20 }, `holeDia must be a number from 1 to ${f3(max.D - 3)} mm for this plate (it leaves 1.5 mm of plate round the hole)`],
    [{ text: "Max", holes: "none", holeDia: 4 }, 'holeDia is only for holes "hang" or "screws"'],
    [{ text: "Max", color: "red" }, 'color must look like "#rrggbb"'],
    [{ text: "Max", style: "cut", textColor: "#ff0000" }, "textColor is only for raised text (cut-in letters are part of the plate)"],
    [{ text: "Max", textColor: "red" }, 'textColor must look like "#rrggbb"'],
    [{ text: "Max", at: [0, 0] }, "at must be [x, y, z] in mm"],
  ];
  for (const [spec, text] of bad) {
    expect(await failure((s) => JS3D.namePlate(s), spec), JSON.stringify(spec)).toBe(text);
    expect(await counts(), JSON.stringify(spec)).toEqual(before);
  }
});

test("the dialog refuses a character the fonts lack, and warns about small letters and a long plate", async () => {
  await fresh();
  await page.click("#bb-nameplate");
  await expect(page.locator("#cmd")).toContainText("Name plate");
  await field("np-text", "Łukasz");
  await expect(page.locator("#np-err")).toContainText('"Ł"');
  await expect(page.locator("#np-err")).toContainText("The fonts cover English and Western European letters");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await field("np-text", "Max");
  await expect(page.locator("#np-err")).toHaveCount(0);
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await field("np-size", 4);
  await expect(page.locator("#cmd")).toContainText("Letters under 5 mm tall, or raised or cut less than 0.6 mm, are hard to print and read.");
  await field("np-size", 10);
  await expect(page.locator("#cmd")).not.toContainText("Letters under 5 mm");
  await field("np-text", "W".repeat(40));
  await expect(page.locator("#cmd")).toContainText("longer than most print beds (about 250 mm)");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.click("#cmd .xbtn");
  await expect(page.locator("#cmd")).toBeHidden();
});

test("Beginner: the Name plate button opens the dialog; Cut in hides the text colour and makes one body on the bed", async () => {
  await fresh();
  await page.click("#bb-nameplate");
  await expect(page.locator("#cmd")).toContainText("Name plate");
  await expect(page.locator("#np-text-color")).toHaveCount(1);
  await page.locator("#np-style button", { hasText: "Cut in" }).click();
  await expect(page.locator("#np-text-color")).toHaveCount(0);
  await expect(page.locator("#cmd")).toContainText("One body; the letters are cut 1 mm deep.");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const list = await built();
  expect(list.map((b) => b.name)).toEqual(["Name plate NAME"]);
  expect(list[0].error).toBeNull();
  expect(list[0].bbox.min[2]).toBeGreaterThanOrEqual(0);
});

test("the golden design exports to STEP as five true solids", async () => {
  const json = JSON.parse(readFileSync(new URL("./projects/nameplate.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect(list.map((b) => b.name)).toEqual(["Name plate Max", "Name plate Max text", "Name plate Workshop 12"]);
  const { bytes: step } = await exportBytes(page, "step");
  expect(step.length).toBeGreaterThan(10_000);
  const text = step.toString("latin1");
  expect(text.startsWith("ISO-10303-21")).toBe(true);
  // two plates, and the three separate letters M, a and x of the raised text
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(5);
});
