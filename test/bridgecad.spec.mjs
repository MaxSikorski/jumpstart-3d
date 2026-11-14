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

test("JS3D reports version 1.9 or later and the ten Advanced calls", async () => {
  const [maj, min] = await run(() => JS3D.version.split(".").map(Number));
  expect(maj > 1 || (maj === 1 && min >= 9)).toBe(true);
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
  expect(await failure(() => JS3D.faces("nope"))).toMatch(/^no body "nope"/);
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

// ---- review fixes: mesh detail, pattern limits, transformed bodies --------------------------------------------------------------
// column-major 4 x 4 for T * Rz * Rx * S, and the same map applied to a point, so the expected world values come from the maths here
const compose = ({ t = [0, 0, 0], rz = 0, rx = 0, s = [1, 1, 1] }) => {
  const c = (d) => Math.cos((d * Math.PI) / 180), n = (d) => Math.sin((d * Math.PI) / 180);
  const Rz = [[c(rz), -n(rz), 0], [n(rz), c(rz), 0], [0, 0, 1]], Rx = [[1, 0, 0], [0, c(rx), -n(rx)], [0, n(rx), c(rx)]];
  const R = Rz.map((row) => [0, 1, 2].map((j) => row[0] * Rx[0][j] + row[1] * Rx[1][j] + row[2] * Rx[2][j]));
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, t[0], t[1], t[2], 1];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = R[i][j] * s[j];
  return m;
};
const apply = (m, p) => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const near3 = (a, b, d = 2) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));
const setMatrix = (id, m) => run(([id, m]) => __store.update((doc) => { doc.bodies.find((b) => b.id === id).m = m; }, "Place"), [id, m]);
const bboxOfBox = (m, lo, hi) => {
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => apply(m, [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]));
  return { min: [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))), max: [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) };
};
const LOCAL_CENTERS = [[0, 0, 0], [0, 0, 25], [0, -20, 12.5], [0, 20, 12.5], [-30, 0, 12.5], [30, 0, 12.5]];
// a rim fillet on a 60 x 40 x 25 box: the loss on a rim of length P (corner overlaps for four corners)
const rimLoss = (P, r) => P * r * r * (1 - Math.PI / 4) - 4 * r ** 3 * (5 / 3 - Math.PI / 2);
const FRAMES = [
  ["translated", { t: [100, -50, 30] }],
  ["turned 30 degrees about z and 90 about x", { t: [10, 20, 5], rz: 30, rx: 90 }],
  ["turned and scaled unevenly", { t: [-15, 40, 8], rz: 30, rx: 90, s: [1.5, 2, 0.5] }],
];

for (const [label, frame] of FRAMES) {
  test(`calls on a body ${label}: world faces and edges, local references, built result, and a rebuild`, async () => {
    await fresh();
    const m = compose(frame);
    const id = await run(async () => {
      JS3D.setParam("W", "60");
      const sk = await JS3D.sketch({ shapes: [{ type: "rect", size: ["W", 40] }] });
      return (await JS3D.extrude({ sketch: sk.sketch, dist: 25 })).body;
    });
    await setMatrix(id, m);
    // faces: the six world centres are the local ones through the matrix; normals are unit and perpendicular to the face
    const faces = await run((id) => JS3D.faces(id), id);
    expect(faces).toHaveLength(6);
    const want = LOCAL_CENTERS.map((p) => apply(m, p));
    for (const w of want) expect(faces.some((f) => f.center.every((v, i) => Math.abs(v - w[i]) < 0.01))).toBe(true);
    for (const f of faces) expect(Math.hypot(...f.normal)).toBeCloseTo(1, 3);
    // "top" is the face with the highest world z, and its four edges are those of that face
    const topWant = want.reduce((a, b) => (b[2] > a[2] ? b : a));
    const [top] = await run((id) => JS3D.faces(id, "top"), id);
    near3(top.center, topWant, 2);
    const topEdges = await run((id) => JS3D.edges(id, "edges of top"), id);
    expect(topEdges).toHaveLength(4);
    for (const e of topEdges) expect(Math.abs(e.mid[2] - topWant[2]) < 3 * Math.max(...(frame.s || [1]))).toBe(true);
    const wEdges = await run((id) => JS3D.edges(id), id);
    for (const e of wEdges) { expect(Math.hypot(e.end[0] - e.start[0], e.end[1] - e.start[1], e.end[2] - e.start[2])).toBeCloseTo(e.length, 2); }
    // fillet the top face's rim: the stored edges lie on the local face, the volume is the local one
    const localTop = LOCAL_CENTERS.find((p) => { const w = apply(m, p); return Math.abs(w[2] - topWant[2]) < 1e-6 && Math.abs(w[0] - topWant[0]) < 1e-6; });
    await run((id) => JS3D.fillet(id, "edges of top", 2), id);
    const stored = await run((id) => JS3D.get(id).node.mods.at(-1), id);
    expect(stored.edges).toHaveLength(4);
    const face = localTop[1] === 20 ? 1 : localTop[1] === -20 ? 1 : localTop[0] !== 0 ? 0 : 2;
    const level = localTop[face];
    for (const e of stored.edges) expect(Math.abs(e.m[face] - level)).toBeLessThan(0.01);
    const perimeter = face === 0 ? 2 * (40 + 25) : face === 1 ? 2 * (60 + 25) : 2 * (60 + 40);
    const info = () => run(async (id) => { await JS3D.ready(); const g = JS3D.get(id); return { v: g.volume, bbox: g.bbox, error: g.error }; }, id);
    let r = await info();
    expect(r.error).toBeNull();
    expect(r.v).toBeCloseTo(60000 - rimLoss(perimeter, 2), 0);
    const bb = bboxOfBox(m, [-30, -20, 0], [30, 20, 25]);
    near3(r.bbox.min, bb.min, 2); near3(r.bbox.max, bb.max, 2);
    // a rebuild: change the width; the fillet stays on the same local face
    await run(() => JS3D.setParam("W", "80"));
    r = await info();
    expect(r.error).toBeNull();
    const perimeter2 = face === 0 ? 2 * (40 + 25) : face === 1 ? 2 * (80 + 25) : 2 * (80 + 40);
    expect(r.v).toBeCloseTo(80000 - rimLoss(perimeter2, 2), 0);
    const bb2 = bboxOfBox(m, [-40, -20, 0], [40, 20, 25]);
    near3(r.bbox.min, bb2.min, 2); near3(r.bbox.max, bb2.max, 2);
  });

  test(`hole and shell on a body ${label}: local references and the built result, also after a rebuild`, async () => {
    const m = compose(frame);
    const make = async () => {
      await fresh();
      const id = await run(async () => {
        JS3D.setParam("W", "60");
        const sk = await JS3D.sketch({ shapes: [{ type: "rect", size: ["W", 40] }] });
        return (await JS3D.extrude({ sketch: sk.sketch, dist: 25 })).body;
      });
      await setMatrix(id, m);
      const faces = await run((id) => JS3D.faces(id), id);
      const faceAt = (p) => { const w = apply(m, p); return faces.find((f) => f.center.every((v, i) => Math.abs(v - w[i]) < 0.01)); };
      return { id, faceAt };
    };
    const info = (id) => run(async (id) => { await JS3D.ready(); const g = JS3D.get(id); return { v: g.volume, error: g.error }; }, id);
    // a hole through the local bottom face, at the local point (10, 5, 0) given in world mm
    let { id, faceAt } = await make();
    const h = await run(([id, face, p]) => JS3D.hole(id, { face, points: [p], size: "M3" }), [id, faceAt([0, 0, 0]).index, apply(m, [10, 5, 0])]);
    expect(h.holes).toBe(1);
    const at = await run((id) => JS3D.get(id).node.mods.at(-1).at[0], id);
    near3(at.p, [10, 5, 0], 3);
    near3(at.n.map(Math.abs), [0, 0, 1], 3);
    let r = await info(id);
    expect(r.error).toBeNull();
    expect(r.v).toBeCloseTo(60000 - Math.PI * 1.7 * 1.7 * 25, 0);
    await run(() => JS3D.setParam("W", "80"));
    r = await info(id);
    expect(r.error).toBeNull();
    expect(r.v).toBeCloseTo(80000 - Math.PI * 1.7 * 1.7 * 25, 0);
    // a shell that opens the face highest in the world; its stored point is that face's local centre
    ({ id, faceAt } = await make());
    const worldTop = LOCAL_CENTERS.map((p) => [p, apply(m, p)]).reduce((a, b) => (b[1][2] > a[1][2] + 1e-6 ? b : a));
    const openAxis = worldTop[0][0] !== 0 ? 0 : worldTop[0][1] !== 0 ? 1 : 2;
    await run(([id, i]) => JS3D.shell(id, { th: 2, open: i }), [id, faceAt(worldTop[0]).index]);
    const sh = await run((id) => JS3D.get(id).node.mods.at(-1), id);
    expect(sh.faces).toHaveLength(1);
    near3(sh.faces[0].c, worldTop[0], 2);
    const cavity = (w) => { const d = [w, 40, 25].map((x, i) => (i === openAxis ? x - 2 : x - 4)); return d[0] * d[1] * d[2]; };
    r = await info(id);
    expect(r.error).toBeNull();
    expect(r.v).toBeCloseTo(60000 - cavity(60), -1);
    await run(() => JS3D.setParam("W", "80"));
    r = await info(id);
    expect(r.error).toBeNull();
    expect(r.v).toBeCloseTo(80000 - cavity(80), -1);
  });
}

test("a group body with its own matrix and a moved child: faces, a fillet on both tops, and a rebuild", async () => {
  await fresh();
  const out = await run(async () => {
    JS3D.setParam("W", "60");
    const a = await JS3D.sketch({ shapes: [{ type: "rect", size: ["W", 40] }] });
    const A = (await JS3D.extrude({ sketch: a.sketch, dist: 25 })).body;
    const b = await JS3D.sketch({ shapes: [{ type: "rect", size: ["W", 40] }] });
    const B = (await JS3D.extrude({ sketch: b.sketch, dist: 25 })).body;
    JS3D.move([B], [100, 0, 0]);
    return { A, B };
  });
  const group = await run(([A, B]) => JS3D.group([A, B]), [out.A, out.B]);
  const m = compose({ t: [7, -3, 11], rz: 30 });
  await setMatrix(group, m);
  const tops = await run((id) => JS3D.faces(id, "top"), group);
  expect(tops).toHaveLength(2);
  for (const t of tops) expect(t.center[2]).toBeCloseTo(36, 2);
  const local = await run((id) => JS3D.get(id).bbox, group);
  expect(local.min[2]).toBeCloseTo(11, 2);
  const fil = await run((id) => JS3D.fillet(id, "edges of top", 2), group);
  expect(fil.edges).toBe(8);
  const info = () => run(async (id) => { await JS3D.ready(); const g = JS3D.get(id); return { v: g.volume, error: g.error }; }, group);
  let r = await info();
  expect(r.error).toBeNull();
  expect(r.v).toBeCloseTo(120000 - 2 * rimLoss(200, 2), 0);
  await run(() => JS3D.setParam("W", "64"));
  r = await info();
  expect(r.error).toBeNull();
  expect(r.v).toBeCloseTo(2 * 64 * 40 * 25 - 2 * rimLoss(2 * (64 + 40), 2), 0);
});

test("Fine and Extra fine mesh detail: faces, fillet and hole still find the built shape", async () => {
  await fresh();
  try {
    for (const detail of ["fine", "extra"]) {
      await run((d) => { __app.setMeshDetail(d, true, true); return JS3D.ready(); }, detail);
      expect(await run(() => __app.kernel.quality)).toBeGreaterThan(1);
      await fresh();
      const { body } = await makeBox();
      expect(await run((id) => JS3D.faces(id, "top").then((f) => f.length), body)).toBe(1);
      expect((await run((id) => JS3D.fillet(id, "edges of top", 2), body)).edges).toBe(4);
      expect((await run((id) => JS3D.hole(id, { face: "bottom", points: [[0, 0, 0]], size: "M3" }), body)).holes).toBe(1);
      expect((await run(async (id) => { await JS3D.ready(); return JS3D.get(id).error; }, body))).toBeNull();
    }
  } finally {
    await run(() => { __app.setMeshDetail("normal", true, true); return JS3D.ready(); });
  }
});

test("pattern: spacing2 0 with count2 1 is accepted; spacing is needed only where copies are made; the total is capped", async () => {
  await fresh();
  const { body } = await makeBox();
  const h = await run((id) => JS3D.hole(id, { face: "top", points: [[-25, 0, 25]], size: "M3" }), body);
  const feat = h.feature;
  const p = await run(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 2, spacing: 20, count2: 1, spacing2: 0 }), [body, feat]);
  expect(p.copies).toBe(1);
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 1, spacing: 20, count2: 2, axis2: "y", spacing2: 0 }), [body, feat])).toBe("spacing2 must be a number of mm, not 0");
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 2, spacing: 0 }), [body, feat])).toBe("spacing must be a number of mm, not 0");
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 200, spacing: 0.01, count2: 200, axis2: "y", spacing2: 0.01, both: true }), [body, feat])).toBe("this pattern would make 159200 copies; the most is 1999 (counting the original, 2000 in all)");
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "x", count: 200, spacing: 0.01, count2: 11, axis2: "y", spacing2: 0.01 }), [body, feat])).toBe("this pattern would make 2199 copies; the most is 1999 (counting the original, 2000 in all)");
  expect(await failure(([id, f]) => JS3D.pattern(id, { features: [f], type: "rect", axis: "constructor", count: 2, spacing: 5 }), [body, feat])).toBe('axis must be "x", "y", "z" or [x, y, z]');
});

test("limits: long expressions, long selectors and prototype names are refused plainly", async () => {
  await fresh();
  const { body } = await makeBox();
  expect(await failure(() => JS3D.sketch({ shapes: [{ type: "circle", diameter: "1+".repeat(150) + "1" }] }))).toBe("shapes[0].diameter is too long; an expression can have at most 200 characters");
  expect(await failure((id) => JS3D.fillet(id, "top", "1+".repeat(150) + "1"), body)).toBe("r is too long; an expression can have at most 200 characters");
  expect(await failure((id) => JS3D.faces(id, "top or ".repeat(80) + "top"), body)).toMatch(/^a selector can be at most 500 characters; this one has 5\d\d$/);
  expect(await failure((id) => JS3D.faces(id, "constructor"), body)).toMatch(/^unknown word "constructor"; use top, bottom/);
  expect(await failure(() => JS3D.sketch({ shapes: Array(200).fill({ type: "polyline", points: Array.from({ length: 200 }, (_, i) => [i, (i % 2) * 3]) }) }))).toBe("this sketch would have 40000 points; the most is 2000 per call — split it into several sketches");
});
