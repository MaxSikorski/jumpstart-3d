// The Advanced CAD calls of window.JS3D (sketch, extrude, revolve, fillet, chamfer, shell, hole, pattern, faces, edges), on both builds.
// The calls run inside the page, as a console script or the tool server runs them.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, stlTriangles } from "./helpers.mjs";
import { validateEnvelope } from "../src/sharelink.js";

// one page for the whole file: the kernel loads once; every test starts from a new empty Advanced design
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const fresh = () => page.evaluate(() => JS3D.newDesign("advanced"));
const run = (fn, arg) => page.evaluate(fn, arg);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const volumeOf = (id) => run(async (id) => { await JS3D.ready(); return JS3D.get(id).volume; }, id);
const labels = () => run(() => __store.undoStack.map((u) => u.label));
// a 60 x 40 x 25 box from the origin (z 0 to 25), as a sketch and an extrude
const makeBox = () => run(async () => {
  const sk = await JS3D.sketch({ shapes: [{ type: "rect", size: [60, 40] }] });
  return { sketch: sk.sketch, body: (await JS3D.extrude({ sketch: sk.sketch, dist: 25 })).body };
});
const stlVolume = (buf) => {
  let v = 0;
  for (let i = 0, o = 84; i < buf.readUInt32LE(80); i++, o += 50) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => buf.readFloatLE(o + 12 + 12 * k + 4 * c)));
    v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
  }
  return Math.abs(v);
};

test("JS3D reports version 1.9 and the ten Advanced calls", async () => {
  expect(await run(() => JS3D.version)).toBe("1.9");
  expect(await run(() => ["sketch", "extrude", "revolve", "fillet", "chamfer", "shell", "hole", "pattern", "faces", "edges"].map((k) => typeof JS3D[k]))).toEqual(Array(10).fill("function"));
});

test("a rectangle sketch and an extrude make a 60 x 40 x 25 box with named dimensions, in two undo steps", async () => {
  await fresh();
  const sk = await run(() => JS3D.sketch({ shapes: [{ type: "rect", size: [60, 40] }] }));
  expect(sk).toMatchObject({ name: "Sketch 1", dof: 0, plane: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] } });
  expect(sk.dims.map((d) => [d.name, d.value])).toEqual([["d1", 60], ["d2", 40]]);
  expect(sk.profiles).toHaveLength(1);
  expect(sk.profiles[0].area).toBeCloseTo(2400, 3);
  expect(sk.shapes[0]).toMatchObject({ type: "rect", center: [0, 0] });
  expect(sk.shapes[0].ents).toHaveLength(4);
  const { body } = await run((s) => JS3D.extrude({ sketch: s, dist: 25 }), sk.sketch);
  expect(await volumeOf(body)).toBeCloseTo(60000, 0);
  const e = await run((id) => JS3D.list().find((b) => b.id === id), body);
  expect(e.bbox).toEqual({ min: [-30, -20, 0], max: [30, 20, 25] });
  expect((await labels()).slice(-2)).toEqual(["Create sketch", "Extrude"]);
  expect(await run((s) => __store.doc.sketches.find((x) => x.id === s).hidden, sk.sketch)).toBe(true);
});

test("faces and edges list the shape in world terms and refuse unknown picks", async () => {
  await fresh();
  const { body } = await makeBox();
  expect(await run((id) => JS3D.faces(id).then((f) => f.length), body)).toBe(6);
  const [top] = await run((id) => JS3D.faces(id, "top"), body);
  expect(top).toMatchObject({ type: "plane", center: [0, 0, 25], normal: [0, 0, 1], edgeCount: 4 });
  expect(top.area).toBeCloseTo(2400, 2);
  const vertical = await run((id) => JS3D.edges(id, "|Z"), body);
  expect(vertical).toHaveLength(4);
  expect(vertical.map((e) => e.length)).toEqual([25, 25, 25, 25]);
  expect(vertical[0]).toMatchObject({ type: "line", direction: [0, 0, 1] });
  expect(await run((id) => JS3D.faces(id, "front").then((f) => f[0].normal), body)).toEqual([0, -1, 0]);
  expect(await run((id) => JS3D.faces(id, [0, 1]).then((f) => f.map((x) => x.index)), body)).toEqual([0, 1]);
  expect(await failure((id) => JS3D.faces(id, "cone"), body)).toMatch(/^no faces match "cone" on Body 1$/);
  expect(await failure((id) => JS3D.faces(id, 17), body)).toBe("Body 1 has no face 17 (it has 0 to 5)");
  expect(await failure((id) => JS3D.edges(id, 400), body)).toMatch(/^Body 1 has no edge 400 \(it has 0 to \d+; seams and smooth joins are not edges\)$/);
  expect(await failure((id) => JS3D.edges(id, "edges of"), body)).toMatch(/unknown word "edges"|unexpected/);
  expect(await failure(() => JS3D.faces("nope"))).toBe("no body nope");
});

test("fillet the top edges and chamfer the vertical ones, with the volumes the maths gives", async () => {
  await fresh();
  const { body } = await makeBox();
  const top = await run((id) => JS3D.fillet(id, "edges of top", 2), body);
  expect(top.edges).toBe(4);
  // 200 mm of rim loses r^2 (1 - pi/4) per mm; each of the 4 corners gives back r^3 (5/3 - pi/2) where the two fillets overlap
  expect(await volumeOf(body)).toBeCloseTo(60000 - (200 * 4 * (1 - Math.PI / 4) - 4 * 8 * (5 / 3 - Math.PI / 2)), 0);
  await fresh();
  const other = await makeBox();
  expect(await run((id) => JS3D.chamfer(id, "|Z", 1).then((r) => r.edges), other.body)).toBe(4);
  expect(await volumeOf(other.body)).toBeCloseTo(59950, 0);
  expect((await labels()).slice(-1)).toEqual(["Chamfer"]);
});

test("a fillet follows the sketch when a parameter changes", async () => {
  await fresh();
  const id = await run(async () => {
    JS3D.setParam("W", "60");
    const sk = await JS3D.sketch({ shapes: [{ type: "rect", size: ["W", 40] }] });
    const { body } = await JS3D.extrude({ sketch: sk.sketch, dist: 25 });
    await JS3D.fillet(body, "edges of top", 2);
    return body;
  });
  expect(await volumeOf(id)).toBeCloseTo(59831.38, 0);
  await run(() => JS3D.setParam("W", "80"));
  expect(await volumeOf(id)).toBeCloseTo(80000 - (240 * 4 * (1 - Math.PI / 4) - 4 * 8 * (5 / 3 - Math.PI / 2)), 0);
  expect((await run(() => JS3D.list()))[0].error).toBeNull();
});

test("shell: open top gives 2 mm walls, no open face gives a hollow", async () => {
  await fresh();
  const { body } = await makeBox();
  const r = await run((id) => JS3D.shell(id, { th: 2, open: "top" }), body);
  expect(r.open).toBe(1);
  expect(await volumeOf(body)).toBeCloseTo(13632, 0);
  expect((await labels()).slice(-1)).toEqual(["Shell"]);
  await fresh();
  const hollow = await makeBox();
  expect((await run((id) => JS3D.shell(id, { th: 2 }), hollow.body)).open).toBe(0);
  expect(await volumeOf(hollow.body)).toBeCloseTo(60000 - 56 * 36 * 21, -1);
  expect((await labels()).slice(-1)).toEqual(["Hollow"]);
});

test("a sketch on a face and a cut right through", async () => {
  await fresh();
  const { body } = await makeBox();
  const sk = await run((id) => JS3D.sketch({ on: { body: id, face: "top" }, shapes: [{ type: "circle", center: [0, 0], diameter: 10 }] }), body);
  expect(sk.plane).toMatchObject({ o: [0, 0, 25], n: [0, 0, 1] });
  const cut = await run(([id, s]) => JS3D.extrude({ sketch: s, op: "cut", body: id, through: true }), [body, sk.sketch]);
  expect(cut.body).toBe(body);
  expect(await volumeOf(body)).toBeCloseTo(60000 - Math.PI * 25 * 25, 0);
  const m = await run((id) => JS3D.get(id).node.mods.at(-1), body);
  expect(m).toMatchObject({ t: "bool", op: "cut", tool: { t: "extrude", dist: -26 } });
  expect(await failure((id) => JS3D.sketch({ on: { body: id, face: "#Z" }, shapes: [{ type: "circle", diameter: 4 }] }), body)).toMatch(/matches 4 faces; a sketch needs exactly one/);
  expect(await failure((id) => JS3D.sketch({ on: { body: id, face: "hole" }, shapes: [{ type: "circle", diameter: 4 }] }), body)).toBe('face "hole" on Body 1 is not flat (it is a cylinder)');
});

test("revolve a profile about a world axis, and refuse an axis not in the plane", async () => {
  await fresh();
  const sk = await run(() => JS3D.sketch({ on: "XZ", shapes: [{ type: "polyline", points: [[0, 0], [10, 0], [10, 20], [0, 20]] }] }));
  expect(await failure((s) => JS3D.revolve({ sketch: s, axis: "Y" }), sk.sketch)).toBe("axis Y is not in the plane of Sketch 1; use X or Z");
  const { body } = await run((s) => JS3D.revolve({ sketch: s, axis: "z" }), sk.sketch);
  expect(await volumeOf(body)).toBeCloseTo(Math.PI * 100 * 20, 0);
  const env = await run(() => JS3D.save());
  expect(() => validateEnvelope(JSON.parse(JSON.stringify(env)))).not.toThrow();
  expect(await run((id) => JS3D.get(id).node.axis, body)).toBe("Z");
});

test("holes and a pattern: three M3 holes along x; off-face and overlapping points are refused", async () => {
  await fresh();
  const { body } = await makeBox();
  const h = await run((id) => JS3D.hole(id, { face: "top", points: [[-20, 0, 25]], size: "M3" }), body);
  expect(h).toMatchObject({ body, holes: 1 });
  const p = await run(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 3, spacing: 20 }), [body, h.feature]);
  expect(p.copies).toBe(2);
  expect(await volumeOf(body)).toBeCloseTo(60000 - 3 * Math.PI * 1.7 * 1.7 * 25, 0);
  expect((await labels()).slice(-2)).toEqual(["Hole (1 hole)", "Pattern"]);
  const env = await run(() => JS3D.save());
  expect(() => validateEnvelope(JSON.parse(JSON.stringify(env)))).not.toThrow();
  expect(await failure((id) => JS3D.hole(id, { face: "top", points: [[40, 0, 25]], size: "M3" }), body)).toMatch(/^point 1 \[40, 0, 25\] is not on the face, or the hole there runs over its edge$/);
  expect(await failure((id) => JS3D.hole(id, { face: "top", points: [[-10, 0, 25], [-7.5, 0, 25]], size: "M3" }), body)).toBe("holes 1 and 2 overlap (centres 2.5 mm apart; each is 3.4 mm wide)");
  expect(await failure((id) => JS3D.hole(id, { face: "top", points: [[0, 0, 25]], shape: "hex", size: "M3" }), body)).toMatch(/round holes/);
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 3, spacing: 0 }), [body, h.feature])).toBe("spacing must be a number of mm, not 0");
  expect(await failure((id) => JS3D.pattern(id, { features: ["nope"], type: "rect", axis: "x", count: 3, spacing: 5 }), body)).toBe('feature "nope" is not on Body 1');
});

test("the proof: a 60 x 40 x 25 enclosure, 2 mm walls, filleted rim, four M3 holes, built only through calls", async () => {
  await fresh();
  const out = await run(async () => {
    const sk = await JS3D.sketch({ on: "XY", name: "Base", shapes: [{ type: "rect", center: [0, 0], size: [60, 40] }] });
    const { body } = await JS3D.extrude({ sketch: sk.sketch, dist: 25, name: "Enclosure" });
    await JS3D.shell(body, { th: 2, open: "top" });
    const f = await JS3D.fillet(body, "edges of top and (>X or <X or >Y or <Y)", 1);
    await JS3D.hole(body, { face: "bottom", points: [[-22, -12, 0], [22, -12, 0], [-22, 12, 0], [22, 12, 0]], size: "M3" });
    await JS3D.ready();
    return { body, edges: f.edges, entry: JS3D.get(body), bodies: JS3D.list().length };
  });
  expect(out.edges).toBe(4);
  expect(out.bodies).toBe(1);
  expect(out.entry.error).toBeNull();
  expect(out.entry.name).toBe("Enclosure");
  expect(out.entry.bbox).toEqual({ min: [-30, -20, 0], max: [30, 20, 25] });
  expect(out.entry.volume).toBeCloseTo(13516.83, 0);
  expect(out.entry.node.mods.map((m) => m.t)).toEqual(["shell", "fillet", "hole"]);
  // STL export: a real mesh of about the same volume
  const stl = await run(async () => Array.from(await JS3D.export("stl")));
  const buf = Buffer.from(stl);
  expect(stlTriangles(buf)).toBeGreaterThan(100);
  expect(Math.abs(stlVolume(buf) - 13516.83) / 13516.83).toBeLessThan(0.01);
  // the document is a valid share link, and loads back to the same volume
  const env = await run(() => JS3D.save());
  expect(() => validateEnvelope(JSON.parse(JSON.stringify(env)))).not.toThrow();
  await run((e) => JS3D.load(e), env);
  expect(await run(async () => { await JS3D.ready(); return JS3D.list()[0].volume; })).toBeCloseTo(13516.83, 0);
  // a person can open the feature in the Advanced dialogs
  await run(() => JS3D.setMode("advanced"));
  const ids = await run(() => { const b = JS3D.doc().bodies[0]; return { body: b.id, fillet: b.node.mods.find((m) => m.t === "fillet").id, sketch: JS3D.doc().sketches[0].id }; });
  await run((x) => __app.advanced.editFeature(x.body, x.fillet), ids);
  await expect(page.locator("#cmd")).toContainText("4 edges");
  await page.keyboard.press("Escape");
  await expect(page.locator("#cmd")).toBeHidden();
  expect(await run(() => JS3D.doc().sketches[0].cons.some((c) => c.t === "dim"))).toBe(true);
  expect(await run(() => JS3D.doc().sketches[0].name)).toBe("Base");
  await expect(page.locator(".sk-dof.ok").first()).toBeVisible();
});
