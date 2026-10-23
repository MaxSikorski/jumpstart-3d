// Scripting bridge tests: window.JS3D builds, edits, exports and reloads designs, on both builds.
// The calls run inside the page, so they are the same calls a console script or a tool server makes.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, exportBytes, sha256, stlTriangles, quarantine } from "./helpers.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const PNG = [0x89, 0x50, 0x4e, 0x47];
const BOX_WITH_HOLE = 40 * 30 * 20 - Math.PI * 4 * 4 * 20; // a 40 x 30 x 20 block with an 8 mm hole through it

// one page for the whole file: the kernel loads once; every test starts from a new empty design
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const fresh = () => page.evaluate(() => JS3D.newDesign("beginner"));
const run = (fn, arg) => page.evaluate(fn, arg);
// the message of the error a call throws (or rejects with), or null when it works
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const volumeOf = (id) => run(async (id) => { await JS3D.ready(); return JS3D.get(id).volume; }, id);
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a))); // a Uint8Array from the page

test("JS3D exists, lists the shape kinds, and does nothing until called", async () => {
  // the page is as it was after boot: the bridge edited nothing
  const state = await run(() => ({ bodies: __store.doc.bodies.length, undo: __store.undoStack.length, app: !!window.__app, findBody: typeof window.__findBody }));
  expect(state).toEqual({ bodies: 0, undo: 0, app: true, findBody: "function" });
  expect(await run(() => JS3D.version)).toBe("1.6");
  const kinds = await run(() => JS3D.kinds());
  expect(kinds.length).toBe(20);
  expect(kinds.find((k) => k.kind === "box").defaults).toEqual({ w: 20, d: 20, h: 20, r: 0, c: 0 });
  expect(kinds.map((k) => k.kind)).toContain("cylinder");
  expect(await run(() => JS3D.internals.app === window.__app && JS3D.internals.store === window.__store && JS3D.delete === JS3D.remove)).toBe(true);
});

test("add: a box appears at the given place, with its volume once built, as one undo step", async () => {
  await fresh();
  // add and the first list() in one step: the worker could finish between two calls
  const { id, now } = await run(() => { const id = JS3D.add("box", { size: { w: 40, d: 30, h: 20 }, at: [10, 0, 0] }); return { id, now: JS3D.list() }; });
  expect(now).toHaveLength(1);
  expect(now[0]).toMatchObject({ id, kind: "box", position: [10, 0, 0], hole: false, hidden: false, volume: null, bbox: null, error: null }); // not built yet
  expect(await run(() => __store.undoStack.at(-1).label)).toMatch(/^Add/);
  expect(await volumeOf(id)).toBeCloseTo(24000, 1);
  const [e] = await run(() => JS3D.list());
  expect(e.bbox).toEqual({ min: [-10, -15, 0], max: [30, 15, 20] });
  const full = await run((id) => JS3D.get(id), id);
  expect(full.node.p).toMatchObject({ w: 40, d: 30, h: 20 });
  expect(full.m.slice(12, 15)).toEqual([10, 0, 0]);
});

test("add and the other calls refuse bad input with plain messages", async () => {
  await fresh();
  expect(await failure(() => JS3D.add("teapot"))).toMatch(/unknown kind "teapot"; valid kinds: box, cylinder/);
  expect(await failure(() => JS3D.add("box", { size: { w: 0 } }))).toMatch(/w must be a number of at least 0.01/);
  expect(await failure(() => JS3D.add("box", { size: { height: 5 } }))).toMatch(/box has no size "height"/);
  expect(await failure(() => JS3D.add("box", { at: [1, 2] }))).toMatch(/at must be \[x, y, z\]/);
  expect(await failure(() => JS3D.add("box", { color: "red" }))).toMatch(/#rrggbb/);
  expect(await failure(() => JS3D.move("nope", [1, 0, 0]))).toBe("no body nope");
  expect(await failure(() => JS3D.get("nope"))).toBe("no body nope");
  expect(await run(() => __store.doc.bodies.length)).toBe(0);
  const id = await run(() => JS3D.add("box"));
  expect(await failure((id) => JS3D.ungroup(id), id)).toMatch(/is not a group/);
  expect(await failure((id) => JS3D.rotate(id, "w", 5), id)).toMatch(/axis must be/);
  expect(await failure(() => JS3D.add("prism", { size: { sides: 2 } }))).toMatch(/sides must be a whole number of at least 3/);
  expect(await failure(() => JS3D.add("star", { size: { points: 4.5 } }))).toMatch(/points must be a whole number/);
  expect(await failure((id) => JS3D.setHole(id, "yes"), id)).toMatch(/hole must be true or false/);
  expect(await failure((id) => JS3D.setHidden(id, 1), id)).toMatch(/hidden must be true or false/);
  // turning or scaling about "the middle" needs a built shape; the answer must not depend on timing
  const unbuilt = await run(() => { const b = JS3D.add("box", { size: [13.37, 7.11, 9.5] }); const out = []; // a size nobody built before: an identical shape would come from the cache at once
    for (const f of [() => JS3D.rotate(b, "z", 5), () => JS3D.scale(b, 2)]) { try { f(); out.push(null); } catch (e) { out.push(e.message); } } return out; });
  for (const m of unbuilt) expect(m).toMatch(/Box \d+ is still being built: await JS3D.ready\(\) first, or pass opts.about/);
  expect(await run(() => { const b = JS3D.list().at(-1).id; JS3D.rotate(b, "z", 5, { about: [0, 0, 0] }); JS3D.scale(b, 2, { about: [0, 0, 0] }); return true; })).toBe(true); // a given point needs no wait
});

test("move, moveTo and rotate place the body; undo walks them back", async () => {
  await fresh();
  const id = await run(() => JS3D.add("box", { size: [40, 30, 20] }));
  await run(() => JS3D.ready());
  await run((id) => { JS3D.move(id, [5, 6, 7]); }, id);
  expect((await run((id) => JS3D.get(id), id)).position).toEqual([5, 6, 7]);
  await run((id) => { JS3D.moveTo(id, [100, 0, 0]); }, id);
  expect((await run((id) => JS3D.get(id), id)).position).toEqual([100, 0, 0]);
  await run(async (id) => { await JS3D.ready(); JS3D.rotate(id, "z", 90); await JS3D.ready(); }, id);
  // turned about the middle of its box: the 40 x 30 footprint becomes 30 x 40 around the same centre
  let e = await run((id) => JS3D.get(id), id);
  expect(e.bbox.min[0]).toBeCloseTo(85, 3); expect(e.bbox.max[0]).toBeCloseTo(115, 3);
  expect(e.bbox.min[1]).toBeCloseTo(-20, 3); expect(e.bbox.max[1]).toBeCloseTo(20, 3);
  // about a chosen point, with the axis given as a vector: (100, 0) swings to (0, 100)
  await run(async (id) => { JS3D.rotate(id, [0, 0, 1], 90, { about: [0, 0, 0] }); await JS3D.ready(); }, id);
  e = await run((id) => JS3D.get(id), id);
  expect(e.position[0]).toBeCloseTo(0, 6); expect(e.position[1]).toBeCloseTo(100, 6);
  expect(e.bbox.max[0] - e.bbox.min[0]).toBeCloseTo(40, 3);
  // four steps back to the start (add stays)
  expect(await run(() => [JS3D.undo(), JS3D.undo(), JS3D.undo(), JS3D.undo()])).toEqual(["Rotate", "Rotate", "Move", "Move"]);
  expect((await run((id) => JS3D.get(id), id)).position).toEqual([0, 0, 0]);
  expect(await run(() => JS3D.redo())).toBe("Move");
  expect(await run(() => { JS3D.undo(); return __store.doc.bodies.length; })).toBe(1);
});

test("resize changes a plain shape; scale works on anything and keeps its centre", async () => {
  await fresh();
  const id = await run(() => JS3D.add("box", { size: { w: 40, d: 30, h: 20 } }));
  await run((id) => JS3D.resize(id, { w: 50, h: 10 }), id);
  expect(await volumeOf(id)).toBeCloseTo(50 * 30 * 10, 1);
  expect(await failure((id) => JS3D.resize(id, { w: 0.001 }), id)).toMatch(/at least 0.01/);
  expect(await failure((id) => JS3D.resize(id, { w: NaN }), id)).toMatch(/at least 0.01/);
  const torus = await run(() => JS3D.add("torus"));
  await run((t) => JS3D.resize(t, { w: 60 }), torus);
  expect((await run((t) => JS3D.get(t), torus)).node.p).toMatchObject({ w: 60, d: 60 });

  // a group cannot be resized; scale it instead
  const other = await run(() => JS3D.add("cylinder", { size: { w: 10, d: 10, h: 30 }, at: [0, 0, 0] }));
  await run((o) => JS3D.setHole(o, true), other);
  const g = await run(([a, b]) => JS3D.group([a, b]), [id, other]);
  expect(await failure((g) => JS3D.resize(g, { w: 5 }), g)).toBe("resize works on plain shapes; use scale");
  const v1 = await volumeOf(g);
  const before = (await run((g) => JS3D.get(g), g)).bbox;
  await run((g) => JS3D.scale(g, 2), g);
  expect(await volumeOf(g)).toBeCloseTo(v1 * 8, 0);
  const after = (await run((g) => JS3D.get(g), g)).bbox;
  const centre = (b) => b.min.map((v, i) => (v + b.max[i]) / 2);
  centre(after).forEach((c, i) => expect(c).toBeCloseTo(centre(before)[i], 3));
  expect(after.max[0] - after.min[0]).toBeCloseTo(2 * (before.max[0] - before.min[0]), 3);
  expect(await run(() => __store.undoStack.at(-1).label)).toBe("Scale");

  // scaling back folds into the same Scale feature and leaves none behind
  await run((g) => JS3D.scale(g, 0.5), g);
  expect((await run((g) => JS3D.get(g), g)).node.mods).toEqual([]);

  // an array scales along the body's own axes: a box turned 90 degrees, stretched 2x along its own x, grows along world y
  const t = await run(() => JS3D.add("box", { size: [40, 30, 20], at: [200, 0, 0] }));
  await run(async (t) => { await JS3D.ready(); JS3D.rotate(t, "z", 90); await JS3D.ready(); }, t);
  const turned = (await run((t) => JS3D.get(t), t)).bbox;
  await run((t) => JS3D.scale(t, [2, 1, 1], { about: [200, 0, 0] }), t);
  await run(() => JS3D.ready());
  const stretched = (await run((t) => JS3D.get(t), t)).bbox;
  expect(stretched.max[1] - stretched.min[1]).toBeCloseTo(2 * (turned.max[1] - turned.min[1]), 3);
  expect(stretched.max[0] - stretched.min[0]).toBeCloseTo(turned.max[0] - turned.min[0], 3);
  expect((stretched.min[1] + stretched.max[1]) / 2).toBeCloseTo(0, 3); // the chosen point stayed put
  expect((await run((t) => JS3D.get(t), t)).volume).toBeCloseTo(2 * 40 * 30 * 20, 0);
});

test("a hole in a group cuts the block; ungroup gives the two bodies back", async () => {
  await fresh();
  const ids = await run(() => {
    const box = JS3D.add("box", { size: { w: 40, d: 30, h: 20 } });
    const cyl = JS3D.add("cylinder", { size: { w: 8, d: 8, h: 30 }, at: [0, 0, -5] });
    JS3D.setHole(cyl, true);
    return { box, cyl };
  });
  const g = await run(({ box, cyl }) => JS3D.group([box, cyl], { name: "Part" }), ids);
  const list = await run(() => JS3D.list());
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: g, name: "Part", kind: "group", children: 2 });
  expect(await volumeOf(g)).toBeCloseTo(BOX_WITH_HOLE, 0);

  const back = await run((g) => JS3D.ungroup(g), g);
  expect(back).toHaveLength(2);
  const parts = await run(() => JS3D.list());
  expect(parts.map((p) => [p.kind, p.hole, p.position])).toEqual([["box", false, [0, 0, 0]], ["cylinder", true, [0, 0, -5]]]);

  // "cut": the first body loses what the others take away; same result as a hole
  await run((cyl) => JS3D.setHole(cyl, false), back[1]);
  const c = await run((b) => JS3D.group(b, { op: "cut" }), back);
  expect(await volumeOf(c)).toBeCloseTo(BOX_WITH_HOLE, 0);
  expect(await failure((b) => JS3D.group([b]), c)).toMatch(/at least two/);

  // a group with features would lose them: refused, nothing changes
  const before = await run(() => JSON.stringify(JS3D.doc()));
  await run((c) => __store.update((d) => { d.bodies.find((b) => b.id === c).node.mods.push({ id: "f1", seq: 99, t: "fillet", r: 1, edges: [] }); }, "Add fillet"), c);
  const withFillet = await run(() => JSON.stringify(JS3D.doc()));
  expect(await failure((c) => JS3D.ungroup(c), c)).toMatch(/has features \(fillets, holes...\); remove them before ungrouping/);
  expect(await run(() => JSON.stringify(JS3D.doc()))).toBe(withFillet);
  expect(withFillet).not.toBe(before);

  // a group stretched while its parts are turned 45 degrees cannot be split again
  await fresh();
  const [x, y] = await run(() => {
    const a = JS3D.add("box", { at: [0, 0, 0] }), b = JS3D.add("box", { at: [30, 0, 0] });
    JS3D.rotate(a, "z", 45, { about: [0, 0, 0] });
    return [a, b];
  });
  const turned = await run((ids) => { const g = JS3D.group(ids); JS3D.scale(g, [2, 1, 1], { about: [0, 0, 0] }); return g; }, [x, y]);
  const snap = await run(() => JSON.stringify(JS3D.doc()));
  expect(await failure((g) => JS3D.ungroup(g), turned)).toMatch(/stretched at an angle/);
  expect(await run(() => JSON.stringify(JS3D.doc()))).toBe(snap);
});

test("remove, duplicate, rename, setColor and setHidden", async () => {
  await fresh();
  const [a, b] = await run(() => [JS3D.add("box"), JS3D.add("sphere", { at: [50, 0, 0] })]);
  const [copy] = await run((a) => JS3D.duplicate(a, [0, 80, 0]), a);
  expect((await run((c) => JS3D.get(c), copy)).position).toEqual([0, 80, 0]);
  await run(([a, b]) => { JS3D.rename(a, "  Base  "); JS3D.setColor(b, "#ff8800"); }, [a, b]);
  const list = await run(() => JS3D.list());
  expect(list.find((e) => e.id === a).name).toBe("Base");
  expect(list.find((e) => e.id === b).color).toBe("#ff8800");
  expect(await failure((a) => JS3D.setColor(a, "orange"), a)).toMatch(/#rrggbb/);

  await run(() => JS3D.ready());
  const all = bytes(await run(() => JS3D.export("stl"))).length;
  await run((a) => JS3D.setHidden(a, true), a);
  const shown = await run(() => JS3D.list());
  expect(shown.find((e) => e.id === a).hidden).toBe(true); // still listed
  expect(bytes(await run(() => JS3D.export("stl"))).length).toBeLessThan(all);
  expect(await failure((a) => JS3D.export("stl", { ids: [a] }), a)).toMatch(/nothing to export/); // named, but hidden // but not exported
  await run((a) => JS3D.setHidden(a, false), a);

  expect(await run((b) => JS3D.remove(b), b)).toBe(1);
  expect(await run(() => JS3D.list().map((e) => e.id))).toEqual([a, copy]);
  expect(await failure((b) => JS3D.remove(b), b)).toBe("no body " + b);
  expect(await run(() => JS3D.undo())).toBe("Delete");
});

test("parameters: a bound size follows the parameter; bad input leaves the design alone", async () => {
  await fresh();
  const id = await run(() => JS3D.add("box", { size: { w: 40, d: 30, h: 20 } }));
  expect(await run(() => JS3D.setParam("w", "40"))).toBe(40);
  expect(await run((id) => JS3D.bind(id, "w", "w"), id)).toBe(40);
  expect(await volumeOf(id)).toBeCloseTo(24000, 1);
  expect(await run(() => JS3D.setParam("w", "50"))).toBe(50);
  expect(await volumeOf(id)).toBeCloseTo(30000, 1);
  expect(await run(() => JS3D.undo())).toBe("Edit parameter");
  expect(await volumeOf(id)).toBeCloseTo(24000, 1);
  expect(await run(() => JS3D.params())).toEqual([{ name: "w", expr: "40", value: 40, unit: "mm" }]);

  // refused: nothing changes, nothing lands on the undo stack
  const steps = await run(() => __store.undoStack.length);
  expect(await failure(() => JS3D.setParam("1x", "5"))).toMatch(/starting with a letter/);
  expect(await failure(() => JS3D.setParam("d1", "5"))).toMatch(/dimension name/);
  expect(await failure(() => JS3D.setParam("mm", "5"))).toMatch(/is a unit/);
  expect(await failure(() => JS3D.setParam("w", "nonsense +"))).toBe("expression did not evaluate");
  expect(await failure(() => JS3D.setParam("v", "w * nothing"))).toBe("expression did not evaluate");
  expect(await failure((id) => JS3D.bind(id, "w", "nothing"), id)).toMatch(/did not evaluate to a usable size/);
  expect(await failure((id) => JS3D.bind(id, "q", "5"), id)).toMatch(/box has no size "q"/);
  expect(await run(() => JS3D.params())).toEqual([{ name: "w", expr: "40", value: 40, unit: "mm" }]);
  expect(await run(() => __store.undoStack.length)).toBe(steps);

  // a second parameter can use the first; dropping the first frees the size
  expect(await run(() => JS3D.setParam("half", "w / 2"))).toBe(20);
  expect(await run(() => JS3D.removeParam("w"))).toBe(1);
  expect((await run((id) => JS3D.get(id), id)).node.exprs).toBeUndefined();
  expect(await failure(() => JS3D.removeParam("w"))).toBe("no parameter w");
  expect(await volumeOf(id)).toBeCloseTo(24000, 1);
});

test("setParam on a parameter made in inches: leaving the unit out means mm, as in the sidebar", async () => {
  await fresh();
  const doc = { bodies: [], sketches: [], params: [{ id: "q1", name: "w", expr: "1", unit: "in", value: 25.4 }] };
  await run((d) => JS3D.load(d), doc);
  expect(await run(() => JS3D.params())).toEqual([{ name: "w", expr: "1", value: 25.4, unit: "in" }]);
  expect(await run(() => JS3D.setParam("w", "50"))).toBe(50);
  expect((await run(() => JS3D.params()))[0]).toMatchObject({ unit: "mm", value: 50 });
  expect(await run(() => JS3D.setParam("w", "2", { unit: "in" }))).toBe(50.8);
});

test("a body whose definition cannot be read does not make ready() wait", async () => {
  await fresh();
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const doc = { bodies: [{ id: "bad", name: "Broken", m: I, node: { t: "group", mods: [] } }, { id: "ok", name: "Fine", m: I, node: { t: "prim", kind: "box", p: { w: 10, d: 10, h: 10 }, mods: [] } }], sketches: [] };
  const t0 = Date.now();
  await run((d) => JS3D.load(d), doc);
  expect(Date.now() - t0).toBeLessThan(20_000);
  const list = await run(() => JS3D.list());
  expect(list.find((b) => b.id === "bad").error).toMatch(/Couldn't read/);
  expect(list.find((b) => b.id === "ok").volume).toBeCloseTo(1000, 1);
});

test("bind uses millimetres even when the page shows inches", async () => {
  await fresh();
  const id = await run(() => JS3D.add("box", { size: { w: 40, d: 30, h: 20 } }));
  await page.click("#unit-toggle"); // inches
  try {
    expect(await run((id) => JS3D.bind(id, "w", "30"), id)).toBe(30);
    expect((await run((id) => JS3D.get(id), id)).node.exprUnits).toBeUndefined();
    expect(await volumeOf(id)).toBeCloseTo(30 * 30 * 20, 1);
  } finally { await page.click("#unit-toggle"); }
  expect(await page.textContent("#unit-toggle")).toMatch(/^mm/);
});

test("select, mode, fit and history", async () => {
  await fresh();
  const id = await run(() => JS3D.add("box"));
  expect(await run(() => JS3D.selection())).toEqual([]); // add leaves the selection alone
  expect(await run((id) => { JS3D.select(id); return JS3D.selection(); }, id)).toEqual([id]);
  expect(await run(() => { JS3D.select([]); return JS3D.selection(); })).toEqual([]);
  expect(await run(() => JS3D.mode())).toBe("beginner");
  expect(await run(() => { JS3D.setMode("advanced"); return [JS3D.mode(), __store.doc.mode]; })).toEqual(["advanced", "advanced"]);
  expect(await run(() => { JS3D.setMode("beginner"); return JS3D.mode(); })).toBe("beginner");
  expect(await failure(() => JS3D.setMode("chisel"))).toMatch(/mode must be/);
  expect(await run(() => { JS3D.fit(); return true; })).toBe(true);
  expect(await run(() => { const n = []; while (JS3D.undo()) n.push(1); return [n.length, JS3D.undo(), JS3D.redo()]; })).toEqual([1, null, "Add box"]);
});

// quarantined: STEP export fails in the single file in WebKit ("The I/O read operation failed"), see booleans.spec.mjs
test("export: each kind gives the right bytes, matching the Export menu", async ({}, info) => {
  quarantine(info, ["single-webkit"], "STEP export fails in the single file in WebKit");
  await fresh();
  const ids = await run(() => {
    const a = JS3D.add("box", { size: [30, 30, 10] });
    const b = JS3D.add("sphere", { at: [60, 0, 0] });
    const h = JS3D.add("cylinder", { at: [0, 0, 0] });
    JS3D.setHole(h, true); // a lone hole is never exported
    return { a, b, h };
  });
  await run(() => JS3D.ready());
  const stl = bytes(await run(() => JS3D.export("stl")));
  expect(stlTriangles(stl)).toBeGreaterThan(0);
  expect(stl.length).toBe(84 + 50 * stlTriangles(stl));
  const obj = bytes(await run(() => JS3D.export("obj")));
  expect(obj.toString("utf8").startsWith("# JumpStart")).toBe(true);
  const mf = bytes(await run(() => JS3D.export("3mf")));
  expect(mf.subarray(0, 2).toString()).toBe("PK");
  const step = bytes(await run(() => JS3D.export("step")));
  expect(step.toString("latin1")).toContain("ISO-10303-21");
  const json = JSON.parse(bytes(await run(() => JS3D.export("json"))).toString("utf8"));
  expect(json).toMatchObject({ app: "jumpstart-3d", version: 1 });
  expect(json.doc.bodies).toHaveLength(3);

  // the same bytes the menu gives for the same design (nothing is selected)
  expect(sha256(stl)).toBe(sha256((await exportBytes(page, "stl")).bytes));
  expect(sha256(obj)).toBe(sha256((await exportBytes(page, "obj")).bytes));
  expect(sha256(mf)).toBe(sha256((await exportBytes(page, "3mf")).bytes));

  // one named body
  const one = bytes(await run((id) => JS3D.export("stl", { ids: [id] }), ids.a));
  expect(stlTriangles(one)).toBeLessThan(stlTriangles(stl));
  expect(stlTriangles(one)).toBeGreaterThan(0);
  expect(await failure((id) => JS3D.export("stl", { ids: [id] }), ids.h)).toMatch(/nothing to export/); // a hole on its own
  expect(await failure(() => JS3D.export("dxf"))).toMatch(/kind must be/);
  expect(await failure(() => JS3D.export("stl", { ids: ["nope"] }))).toBe("no body nope");

  await fresh();
  expect(await failure(() => JS3D.export("stl"))).toMatch(/nothing to export/);
  expect(await failure(() => JS3D.export("step"))).toMatch(/nothing to export/);
});

test("save and load: the design comes back the same", async () => {
  await fresh();
  await run(() => {
    const box = JS3D.add("box", { size: { w: 40, d: 30, h: 20 } });
    const cyl = JS3D.add("cylinder", { size: { w: 8, d: 8, h: 30 }, at: [0, 0, -5], hole: true });
    JS3D.group([box, cyl]);
    JS3D.setParam("w", "12");
  });
  await run(() => JS3D.ready());
  const stl = sha256(bytes(await run(() => JS3D.export("stl"))));
  const saved = await run(() => JS3D.save());
  expect(saved).toMatchObject({ app: "jumpstart-3d", version: 1 });
  expect(saved.doc.bodies).toHaveLength(1);
  const oldId = saved.doc.id;
  expect(saved.doc.bodies[0]._key).toBeUndefined(); // the scene's cache is left out of the saved design
  expect(await run(() => typeof __store.doc.bodies[0]._key)).toBe("string"); // though the live document has it
  expect(await run(() => JS3D.doc().bodies[0]._key)).toBeUndefined();

  for (const input of [saved, JSON.stringify(saved), saved.doc]) { // the file, its text, or a bare doc
    await run((x) => JS3D.load(x), input);
    expect(await run(() => __store.doc.bodies.length)).toBe(1);
    expect(sha256(bytes(await run(() => JS3D.export("stl"))))).toBe(stl);
    expect(await run(() => __store.doc.id)).not.toBe(oldId); // a new design, as opening a file makes
    expect(await run(() => __store.undoStack.length)).toBe(0);
    expect(await run(() => JS3D.params())).toEqual([{ name: "w", expr: "12", value: 12, unit: "mm" }]);
  }
  await run((x) => JS3D.load(x, { keepId: true }), saved);
  expect(await run(() => __store.doc.id)).toBe(oldId);

  for (const bad of ["garbage", "null", "{}", '{"bodies": []}', 42, { doc: { bodies: {} } }]) {
    expect(await failure((x) => JS3D.load(x), bad), String(bad)).toBe("not a JumpStart 3D project");
  }
  // a body that would break the view is refused too (these load and crash the 3D view without the check)
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node = { t: "prim", kind: "box", p: { w: 5, d: 5, h: 5 }, mods: [] };
  for (const body of [{ id: "b", node }, { id: "b", m: I }, { node, m: I }, { id: "b", node, m: I.slice(0, 3) }]) {
    expect(await failure((x) => JS3D.load(x), { bodies: [body], sketches: [] }), JSON.stringify(Object.keys(body))).toMatch(/^not a JumpStart 3D project: body 0 needs/);
  }
  expect(await run(() => __store.doc.bodies.length)).toBe(1); // a refused file changes nothing

  // a file from test/projects gives the volume and the STL bytes recorded in golden.json
  const text = readFileSync(new URL("./projects/advanced-hole.json", import.meta.url), "utf8");
  await run((t) => JS3D.load(t, { keepId: true }), text);
  const g = golden["advanced-hole.json"];
  const list = await run(() => JS3D.list());
  expect(list.map((b) => b.volume)).toEqual(Object.values(g.volumes).map((v) => expect.closeTo(v, 0)));
  expect(sha256(bytes(await run(() => JS3D.export("stl"))))).toBe(g.stl);
  expect(await run(() => __app.mode)).toBe("advanced");
});

test("screenshot gives a PNG of the 3D view", async () => {
  await fresh();
  const png = bytes(await run(() => JS3D.screenshot()));
  expect([...png.subarray(0, 4)]).toEqual(PNG);
  expect(png.length).toBeGreaterThan(1000);
  await run(() => { JS3D.add("box", { size: [60, 40, 20], at: [100, 50, 0] }); });
  const fitted = bytes(await run(() => JS3D.screenshot({ fit: true })));
  expect([...fitted.subarray(0, 4)]).toEqual(PNG);
  expect(fitted.length).toBeGreaterThan(1000);
  // a blank canvas is also a valid, small PNG: look at the pixels. The box was made red; the picture must show red in its middle.
  await run(() => JS3D.setColor(JS3D.list()[0].id, "#d02020"));
  const red = await run(async () => {
    const img = new Image();
    img.src = await JS3D.screenshotDataURL({ fit: true });
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(c.width / 4, c.height / 4, c.width / 2, c.height / 2).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1] + 60 && d[i] > d[i + 2] + 60) n++;
    return n;
  });
  expect(red).toBeGreaterThan(1000);
  expect(await run(() => JS3D.screenshotDataURL())).toMatch(/^data:image\/png;base64,/);
});

test("the demo script runs and its summary checks out", async () => {
  const demo = readFileSync(new URL("../tools/bridge-demo.js", import.meta.url), "utf8");
  const s = await page.evaluate(demo);
  expect(s.volume).toBeCloseTo(BOX_WITH_HOLE, 0);
  expect(s.stlBytes).toBeGreaterThan(84);
  expect(s.stlAgain).toBe(s.stlBytes);
  expect(s.sameShape).toBe(true);
  expect(Object.keys(s.ids)).toEqual(["box", "hole", "group"]);
  expect(s.bodies).toHaveLength(1);
});
