// Hole pattern (Phase 3 step 2): the Hole pattern dialog and JS3D.holePattern lay out a grid, a staggered grid or a circle of
// round holes on a flat face and write them as ONE Hole feature. Volumes are checked in bands (the exact values are in test/golden.json).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, newDoc, body, prim, exportBytes } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fresh = (mode = "advanced") => run((m) => JS3D.newDesign(m), mode);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const built = () => run(async () => { await JS3D.ready(); return JS3D.list(); });
const mods = () => run(() => __store.doc.bodies[0].node.mods || []);
const undoDepth = () => run(() => __store.undoStack.length);
const plate = (w, d, h) => newDoc("Plate", "advanced", { bodies: [body("b1", "Plate", prim("box", { w, d, h, r: 0, c: 0 }))] });

// look down on the plate from above and click a world point on the screen
async function lookDown(dist = 180) {
  await run((dist) => { const v = __app.vp; const V = v.camera.position.constructor; __app.needFit = false; v.animateTo({ az: -Math.PI / 2, el: 1.4, dist, target: new V(0, 0, 0) }, 10); if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms); v.render(); }, dist); // a page without animation frames would never finish the move by itself
}
async function clickAt(x, y, z) {
  const r = await run(([x, y, z]) => { const v = __app.vp; const V = v.camera.position.constructor; const q = v.project(new V(x, y, z)); const b = v.canvas.getBoundingClientRect(); return [b.left + q[0], b.top + q[1]]; }, [x, y, z]);
  await page.mouse.click(r[0], r[1]);
}
async function openDialog() {
  await page.click("#ad-features");
  await page.click("#ad-holepattern");
  await expect(page.locator("#cmd")).toContainText("Hole pattern");
}
const setField = async (id, v) => { await page.fill("#" + id, String(v)); await page.locator("#" + id).blur(); };

// the layout axes recovered from a list of spots: columns run along x on these plates
const rowsOf = (at) => {
  const rows = new Map();
  for (const s of at) { const k = s.p[1].toFixed(3); rows.set(k, [...(rows.get(k) || []), s.p[0]]); }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, xs]) => xs.sort((a, b) => a - b));
};

test("Advanced: Create > Advanced Create > Hole pattern drills a 4 x 3 grid as one Hole feature in one undo step", async () => {
  await loadDoc(page, plate(100, 60, 10));
  await lookDown();
  await openDialog();
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await clickAt(-30, 20, 10);
  await expect(page.locator(".picklist")).toContainText("Plate · flat face");
  await setField("hp-px", 20);
  await setField("hp-py", 20);
  await setField("hp-margin", 0);
  await setField("hp-dia", 5);
  await expect(page.locator("#hp-total")).toHaveText("12 holes");
  const before = await undoDepth();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const [m, ...rest] = await mods();
  expect(rest).toEqual([]);
  expect(m).toMatchObject({ t: "hole", kind: "simple", dia: 5, through: true, tapped: false });
  expect(m.at).toHaveLength(12);
  expect(m.at.every((s) => s.n[2] === 1 && s.p[2] === 10)).toBe(true);
  const [b] = await built();
  expect(b.error).toBeNull();
  const want = 60000 - 12 * Math.PI * 2.5 * 2.5 * 10;
  expect(Math.abs(b.volume - want) / want).toBeLessThan(0.01);
  expect(await undoDepth()).toBe(before + 1);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Hole pattern (12 holes)");
  await run(() => JS3D.undo());
  expect(await mods()).toEqual([]);
});

test("stagger: every other row is half a pitch off and one hole shorter", async () => {
  await loadDoc(page, plate(100, 60, 10));
  await lookDown();
  await openDialog();
  await clickAt(-30, 20, 10);
  await setField("hp-rows", 4);
  await setField("hp-py", 15);
  await setField("hp-px", 20);
  await setField("hp-margin", 0);
  await setField("hp-dia", 5);
  await page.check("#hp-stagger");
  await expect(page.locator("#hp-total")).toHaveText("14 holes");
  await page.click("#cmd-ok");
  const [m] = await mods();
  const rows = rowsOf(m.at);
  expect(rows.map((r) => r.length)).toEqual([4, 3, 4, 3]);
  rows[0].forEach((x, i) => expect(x).toBeCloseTo(-30 + 20 * i, 3));
  rows[1].forEach((x, i) => expect(x).toBeCloseTo(-20 + 20 * i, 3));
});

test("margins: Fit to face keeps every hole its margin from the edge; holes that would hang over are left out and counted", async () => {
  await loadDoc(page, plate(100, 60, 10));
  await lookDown();
  await openDialog();
  await clickAt(-30, 20, 10);
  await page.locator("#hp-fit button", { hasText: "Fit to face" }).click();
  await expect(page.locator("#hp-px")).toHaveCount(0);
  await setField("hp-cols", 6);
  await setField("hp-rows", 4);
  await setField("hp-margin", 4);
  await setField("hp-dia", 5);
  await expect(page.locator("#hp-total")).toHaveText("24 holes");
  await page.click("#cmd-ok");
  const [m] = await mods();
  const xs = m.at.map((s) => s.p[0]), ys = m.at.map((s) => s.p[1]);
  expect(Math.min(...xs)).toBeCloseTo(-43.5, 3);
  expect(Math.max(...xs)).toBeCloseTo(43.5, 3);
  expect(Math.min(...ys)).toBeCloseTo(-23.5, 3);
  expect(Math.max(...ys)).toBeCloseTo(23.5, 3);
  await run(() => JS3D.undo());
  // a pitch that overhangs: 5 x 3 at 40 mm leaves only the holes inside
  await openDialog();
  await clickAt(-30, 20, 10);
  await setField("hp-cols", 5);
  await setField("hp-rows", 3);
  await setField("hp-px", 40);
  await setField("hp-py", 40);
  await setField("hp-margin", 4);
  await setField("hp-dia", 5);
  await expect(page.locator("#hp-total")).toContainText("3 holes (12 left out");
  await page.click("#cmd-ok");
  const [m2] = await mods();
  expect(m2.at.map((s) => [s.p[0], s.p[1]]).sort((a, b) => a[0] - b[0])).toEqual([[-40, 0], [0, 0], [40, 0]]);
});

// a 100 x 60 x 10 plate turned 30 degrees about z, grouped with a cube apart from it
const turnedGroup = () => run(async () => {
  await JS3D.newDesign("advanced");
  const p = JS3D.add("box", { size: [100, 60, 10], name: "Turned plate" });
  JS3D.rotate(p, "z", 30, { about: [0, 0, 0] });
  const c = JS3D.add("box", { size: [5, 5, 5], at: [90, 0, 0] });
  return JS3D.group([p, c], { name: "Group" });
});

test("a turned plate in a group, and a side face: the holes follow the face's own edges and plane", async () => {
  const g = await turnedGroup();
  const r = await run(async (g) => JS3D.holePattern({ body: g, face: "+z", layout: { type: "grid", cols: 3, rows: 2, pitch: 20 }, hole: { dia: 3 } }), g);
  expect(r).toMatchObject({ holes: 6, dropped: 0 });
  const [m] = await run((g) => JS3D.get(g).node.mods, g);
  expect(m.at).toHaveLength(6);
  const deg = (a, b) => (Math.atan2(b.p[1] - a.p[1], b.p[0] - a.p[0]) * 180) / Math.PI;
  for (const row of [m.at.slice(0, 3), m.at.slice(3)]) for (const [a, b] of [[row[0], row[1]], [row[1], row[2]]]) {
    const along = ((deg(a, b) % 180) + 180) % 180;
    expect(Math.abs(along - 30)).toBeLessThan(0.5);
  }
  const t = (Math.PI * 30) / 180;
  for (const s of m.at) {
    // back into the plate's own axes
    const x = s.p[0] * Math.cos(t) + s.p[1] * Math.sin(t), y = -s.p[0] * Math.sin(t) + s.p[1] * Math.cos(t);
    expect(Math.abs(x)).toBeLessThanOrEqual(50 - 1.5 + 1e-3);
    expect(Math.abs(y)).toBeLessThanOrEqual(30 - 1.5 + 1e-3);
    expect(s.p[2]).toBeCloseTo(10, 3);
  }
  const [grp] = await built();
  expect(grp.error).toBeNull();
  // Fit to face on the turned face keeps every spot, even the ones exactly on the margin (the mesh is float32)
  const g2 = await turnedGroup();
  expect(await run((g) => JS3D.holePattern({ body: g, face: "+z", layout: { type: "grid", cols: 5, rows: 3, margin: 2 }, hole: { dia: 3 } }), g2)).toMatchObject({ holes: 15, dropped: 0 });
  // a side face of a plain box
  await fresh();
  const b = await run(() => JS3D.add("box", { size: [100, 60, 10] }));
  await run((b) => JS3D.holePattern({ body: b, face: "+x", layout: { type: "grid", cols: 2, rows: 2, pitch: [10, 5] }, hole: { dia: 3 } }), b);
  const [side] = await run((b) => JS3D.get(b).node.mods, b);
  expect(side.at).toHaveLength(4);
  for (const s of side.at) { expect(s.p[0]).toBeCloseTo(50, 3); expect(s.n).toEqual([1, 0, 0]); }
  expect((await built())[0].error).toBeNull();
});

test("angle turns the grid counter-clockwise from the face's first axis; a box turned onto its side finds the face looking up in the world", async () => {
  await fresh();
  const b = await run(() => JS3D.add("box", { size: [100, 60, 10] }));
  await run((b) => JS3D.holePattern({ body: b, face: "+z", layout: { type: "grid", cols: 3, rows: 2, pitch: 10, angle: 30 }, hole: { dia: 3 } }), b);
  const [m] = await run((b) => JS3D.get(b).node.mods, b);
  const deg = (a, c) => (Math.atan2(c.p[1] - a.p[1], c.p[0] - a.p[0]) * 180) / Math.PI;
  for (const row of [m.at.slice(0, 3), m.at.slice(3)]) { expect(Math.abs(deg(row[0], row[1]) - 30)).toBeLessThan(0.5); expect(Math.abs(deg(row[1], row[2]) - 30)).toBeLessThan(0.5); }
  // turned 90 degrees about x: the old +y face now looks up (the box centre moves to z = 30 at the top, y from -10 to 0)
  await fresh();
  const t = await run(async () => { const id = JS3D.add("box", { size: [100, 60, 10] }); JS3D.rotate(id, "x", 90, { about: [0, 0, 0] }); return id; });
  const r = await run((t) => JS3D.holePattern({ body: t, face: "+z", layout: { type: "circle", count: 4, radius: 3, center: [10, -5, 5] }, hole: { dia: 1.5 } }), t);
  expect(r).toMatchObject({ holes: 4, dropped: 0 });
  const world = await run((t) => {
    const b = JS3D.get(t), M = b.m;
    const pt = (p) => [0, 1, 2].map((i) => M[i] * p[0] + M[4 + i] * p[1] + M[8 + i] * p[2] + M[12 + i]);
    const dir = (n) => [0, 1, 2].map((i) => M[i] * n[0] + M[4 + i] * n[1] + M[8 + i] * n[2]);
    return b.node.mods[0].at.map((s) => ({ p: pt(s.p), n: dir(s.n) }));
  }, t);
  for (const s of world) {
    expect(s.p[2]).toBeCloseTo(30, 3);
    expect(s.n[2]).toBeCloseTo(1, 6);
    expect(Math.hypot(s.p[0] - 10, s.p[1] + 5)).toBeCloseTo(3, 3);
  }
  expect((await built())[0].error).toBeNull();
});

test("circle: six holes on a radius of 20, and Where I clicked snaps to the centre of a hole", async () => {
  await fresh();
  const b = await run(() => JS3D.add("box", { size: [100, 60, 10] }));
  await run((b) => JS3D.holePattern({ body: b, face: "+z", layout: { type: "circle", count: 6, radius: 20 }, hole: { dia: 3 } }), b);
  const [m] = await run((b) => JS3D.get(b).node.mods, b);
  expect(m.at).toHaveLength(6);
  m.at.forEach((s, k) => {
    expect(Math.hypot(s.p[0], s.p[1])).toBeCloseTo(20, 3);
    const a = (Math.atan2(s.p[1], s.p[0]) * 180) / Math.PI;
    expect(Math.abs((((a - 60 * k) % 360) + 540) % 360 - 180)).toBeLessThan(0.01);
  });
  // a plate with a hole at (20, 10): clicking a little beside it takes its centre
  const doc = plate(100, 60, 10);
  doc.seq = 1; // the fixture's hole mod is seq 1
  doc.bodies[0].node.mods.push({ id: "f1", seq: 1, t: "hole", kind: "simple", dia: 4, through: true, depth: 10, cbDia: 6.5, cbDepth: 3.3, csDia: 6.9, csAngle: 90, size: "", tapped: false, pitch: 0, clear: 0, tip: false, at: [{ p: [20, 10, 10], n: [0, 0, 1] }] });
  await loadDoc(page, doc);
  await lookDown(420);
  await openDialog();
  await page.locator("#hp-layout button", { hasText: "Circle" }).click();
  await page.locator("#hp-centre button", { hasText: "Where I clicked" }).click();
  await clickAt(22.4, 10, 10);
  await setField("hp-count", 6);
  await setField("hp-radius", 20);
  await setField("hp-margin", 0);
  await setField("hp-dia", 3);
  await expect(page.locator("#hp-total")).toHaveText("6 holes");
  await page.click("#cmd-ok");
  const mod = (await mods()).at(-1);
  expect(mod.at).toHaveLength(6);
  for (const s of mod.at) expect(Math.hypot(s.p[0] - 20, s.p[1] - 10)).toBeCloseTo(20, 3);
});

test("guards: a warning at 110 holes, a refusal at 225 (Create off), tapped holes stop at 8, and the bridge refuses the same way", async () => {
  await loadDoc(page, plate(200, 200, 6));
  await lookDown(300);
  await openDialog();
  await clickAt(-40, 40, 6);
  await setField("hp-cols", 11);
  await setField("hp-rows", 10);
  await setField("hp-margin", 0);
  await setField("hp-dia", 3);
  await setField("hp-px", 2);
  await expect(page.locator("#hp-note")).toContainText("Pitch must be at least the hole's width (3 mm).");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await setField("hp-px", 10);
  await expect(page.locator("#hp-note")).toContainText("About 110 holes: this may take a few seconds to build, longer on a phone.");
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await setField("hp-cols", 15);
  await setField("hp-rows", 15);
  const many = "Too many holes (225; the most is 200 for plain holes). Use fewer rows or columns, or a larger pitch.";
  await expect(page.locator("#hp-note")).toContainText(many);
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await page.locator("#hp-kind button", { hasText: "Tapped" }).click();
  await setField("hp-cols", 3);
  await setField("hp-rows", 3);
  await expect(page.locator("#hp-note")).toContainText("Too many holes (9; the most is 8 for tapped holes)");
  await expect(page.locator("#cmd-ok")).toBeDisabled();
  await run(() => __app.command && __app.command.cancel());
  // the bridge says the same and adds nothing
  const id = await run(() => __store.doc.bodies[0].id);
  const depth = await undoDepth();
  const bad = (spec) => failure(async (s) => { const [id, spec] = s; await JS3D.holePattern({ body: id, ...spec }); }, [id, spec]);
  const grid = (extra = {}) => ({ face: "+z", layout: { type: "grid", cols: 15, rows: 15, pitch: 10, ...extra }, hole: { dia: 3 } });
  expect(await bad(grid())).toBe(many);
  expect(await bad({ ...grid({ cols: 3, rows: 3 }), hole: { kind: "tapped", size: "M3" } })).toBe("Too many holes (9; the most is 8 for tapped holes). Use fewer rows or columns, or a larger pitch.");
  expect(await bad(grid({ cols: 2, rows: 2, pitch: 1000 }))).toBe("No holes fit on this face with these settings.");
  expect(await bad(grid({ cols: 2, rows: 2, pitch: [10, 2] }))).toBe("Pitch must be at least the hole's width (3 mm).");
  expect(await bad({ face: "+z", layout: { type: "grid", cols: 200, rows: 1 }, hole: { dia: 3 } })).toBe("Pitch must be at least the hole's width (3 mm).");
  expect(await bad({ face: "+z", layout: { type: "circle", count: 40, radius: 10 }, hole: { dia: 3 } })).toBe("Holes on this circle would overlap: use a larger radius or fewer holes.");
  expect(await bad({ ...grid(), face: "up" })).toBe('face must be "+x", "-x", "+y", "-y", "+z" or "-z"');
  expect(await bad({ ...grid(), layout: { type: "ring" } })).toBe('layout.type must be "grid" or "circle"');
  expect(await bad({ ...grid(), hole: { size: "M7" } })).toMatch(/^unknown size "M7"; sizes: M2, M2\.5, M3/);
  expect(await bad({ ...grid(), hole: {} })).toBe("hole.dia must be a positive number of mm, or give hole.size");
  expect(await bad({ ...grid(), hole: { dia: 3, kind: "slot" } })).toBe('hole.kind must be "simple", "cbore", "csink" or "tapped"');
  expect(await bad({ ...grid(), hole: { dia: 3, depth: 0 } })).toBe("hole.depth must be a positive number of mm (leave it out for a through hole)");
  expect(await bad({ ...grid({ cols: 0 }) })).toBe("cols and rows must be whole numbers from 1 to 200");
  expect(await bad({ ...grid({ pitch: -1 }) })).toBe("pitch must be a positive number of mm, or [column pitch, row pitch]");
  expect(await bad({ ...grid({ margin: -1 }) })).toBe("margin must be a number of at least 0 mm");
  expect(await bad({ ...grid({ angle: "x" }) })).toBe("angle and start must be numbers of degrees");
  expect(await bad({ face: "+z", layout: { type: "circle", count: 1, radius: 5 }, hole: { dia: 3 } })).toBe("count must be a whole number from 2 to 200");
  expect(await bad({ face: "+z", layout: { type: "circle", count: 4, radius: 0 }, hole: { dia: 3 } })).toBe("radius must be a positive number of mm");
  expect(await bad({ face: "+z", layout: { type: "circle", count: 4, radius: 5, center: [1, 2] }, hole: { dia: 3 } })).toBe("center must be [x, y, z] in mm");
  expect(await failure(() => JS3D.holePattern({ body: "nope" }))).toBe("no body nope");
  // a sphere has no flat face, and a body marked as a hole takes no holes
  const sphere = await run(() => JS3D.add("sphere", { size: [20, 20, 20] }));
  expect(await failure(async (sid) => { await JS3D.holePattern({ body: sid, face: "+z", layout: { type: "grid", cols: 1, rows: 1 }, hole: { dia: 3 } }); }, sphere)).toMatch(/ has no flat face facing \+z$/);
  const cutter = await run(() => { const c = JS3D.add("box", { size: [10, 10, 10], hole: true }); return c; });
  expect(await failure(async (cid) => { await JS3D.holePattern({ body: cid, face: "+z", layout: { type: "grid", cols: 1, rows: 1 }, hole: { dia: 3 } }); }, cutter)).toMatch(/ is marked as a hole; holes go into solid bodies$/);
  expect(await mods()).toEqual([]);
  expect(await undoDepth()).toBe(depth + 2); // the sphere and the cutter, nothing else
});

test("the golden design exports to STEP as one true solid", async () => {
  const json = JSON.parse(readFileSync(new URL("./projects/holepattern.json", import.meta.url), "utf8"));
  await loadDoc(page, json);
  const list = await built();
  expect(list.filter((b) => b.error)).toEqual([]);
  expect((await mods()).map((m) => m.at.length)).toEqual([18, 8]);
  const { bytes } = await exportBytes(page, "step");
  expect(bytes.length).toBeGreaterThan(10_000);
  const text = bytes.toString("latin1");
  expect(text.startsWith("ISO-10303-21")).toBe(true);
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1);
});
