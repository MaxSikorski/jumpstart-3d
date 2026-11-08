import { test, expect } from "@playwright/test";
import { boot, watchErrors, stlTriangles } from "./helpers.mjs";
import { LIB } from "../src/texture.js";
import { gearSet as buildGearSet } from "../src/gearlib.js";
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage(); errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });
const fresh = () => page.evaluate(() => JS3D.newDesign("beginner"));
const run = (fn, arg) => page.evaluate(fn, arg);
const failure = (fn, arg) => page.evaluate(async ([src, a]) => { try { await new Function("a", "return (" + src + ")(a)")(a); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
const undoCount = () => run(() => __store.undoStack.length);
const lastLabel = () => run(() => __store.undoStack.at(-1).label);
const ringError = 'a ring gear needs at least 8 more teeth than its pinion (teeth2 at least teeth + 8)';
const viewsError = 'views must be a list of "top", "front" and "right"';
const layer = { tex: "knurl", size: 4, depth: 0.6, dir: "raise", rot: 0, mapping: "auto", falloff: 0, invert: false, once: false };
function linesByLayer(text) {
  const parts = text.trim().split(/\r?\n/), entities = []; let current;
  for (let i = 0; i < parts.length; i += 2) {
    const code = +parts[i], value = parts[i + 1];
    if (code === 0) { current = { type: value }; entities.push(current); }
    else if (current) current[code] = value;
  }
  return (layer) => {
    const lines = entities.filter((e) => e.type === "LINE" && e[8] === layer), xs = [], ys = [];
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const e of lines) { xs.push(+e[10], +e[11]); ys.push(+e[20], +e[21]); }
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
}

test("generator calls are available at bridge 1.11", async () => {
  expect(await run(() => JS3D.version)).toBe("1.11");
  expect(await run(() => ["boxMaker", "gearSet", "hardware", "textures", "texture", "drawing"].map((n) => typeof JS3D[n]))).toEqual(Array(6).fill("function"));
});
test("default bin builds and opens in the Box Maker dialog", async () => {
  await fresh(); const result = await run(() => JS3D.boxMaker());
  expect(result.parts).toHaveLength(1);
  expect(await run((id) => JS3D.get(id).node, result.id)).toBeTruthy();
  expect(await run(() => __store.doc.bodies[0].bin.cols)).toBe(3);
  expect(await lastLabel()).toBe("Bin");
  const built = await run(async (id) => { await JS3D.ready(); return JS3D.get(id); }, result.id);
  expect(built.volume).toBeGreaterThan(0); expect(built.error).toBeNull();
  expect(await run(() => JS3D.list().every((b) => !b.error))).toBe(true);
  expect(await run((id) => { __app.advanced.openBins(id); return __app.command.title; }, result.id)).toBe("Edit bin");
  await run(() => __app.advanced.cancel());
});
test("stacked doors keep dialog names, ownership, placement and one undo", async () => {
  await fresh(); const result = await run(() => JS3D.boxMaker({ style: "door", units: 2 }));
  expect(result.parts.map((p) => p.kind)).toEqual(["case", "door", "case", "door"]);
  expect(result.parts.map((p) => p.name)).toEqual(["Case 1", "Case 1 · door 1", "Case 1 · case 2", "Case 1 · door 2"]);
  const bodies = await run(() => __store.doc.bodies);
  expect(bodies.slice(1).every((b) => b.binPart === result.id)).toBe(true); expect(bodies[2].m[14]).toBe(40);
  await run(() => JS3D.undo()); expect(await run(() => JS3D.list())).toHaveLength(0);
});
test("invalid bin dimensions do not change bodies or undo", async () => {
  await fresh(); const before = await undoCount();
  expect(await failure(() => JS3D.boxMaker({ w: 20, cols: 20 }))).toMatch(/The compartments are too small/);
  expect(await failure(() => JS3D.boxMaker({ w: 5 }))).toBe("w must be a number from 10 to 1000 (mm)");
  expect(await run(() => JS3D.list())).toHaveLength(0); expect(await undoCount()).toBe(before);
});
test("library gear sets store placed bodies and linked motion joints", async () => {
  await fresh(); const result = await run(() => JS3D.gearSet());
  expect(result.parts).toHaveLength(2); const doc = await run(() => __store.doc);
  expect(doc.bodies[1].m[12]).toBe(60); expect(Object.values(doc.bodies[0].gear.ids)).toEqual(result.parts.map((p) => p.id));
  expect(doc.bodies[1].gearPart).toBe(result.id); expect(doc.joints).toHaveLength(2); expect(doc.joints[1].link.ratio).toBe(-0.5);
  expect(await lastLabel()).toBe("Gears");
  await fresh(); const rack = await run(() => JS3D.gearSet({ type: "rack", teeth: 24, module: 1.5, rackLength: 100, rackHeight: 12, bore: 4, at: [3, 4, 5] }));
  const saved = await run(() => __store.doc);
  expect(saved.bodies[0].gear.o).toMatchObject({ type: "rack", z: 24, m: 1.5, rackLen: 100, rackH: 12, boreD: 4 });
  expect(saved.bodies[1].gearPart).toBe(rack.id);
  expect(Object.values(saved.bodies[0].gear.ids)).toEqual(rack.parts.map((p) => p.id));
  expect(saved.joints.map((j) => j.body)).toEqual(rack.parts.map((p) => p.id));
  expect(saved.joints[1].link.to).toBe(saved.joints[0].id);
  const rebuilt = buildGearSet(saved.bodies[0].gear.o);
  expect(saved.bodies.map((b) => b.node)).toEqual(rebuilt.parts.map((p) => p.node));
  const before = await undoCount();
  expect(await failure(() => JS3D.gearSet({ type: "ring", teeth: 20, teeth2: 25 }))).toBe(ringError); expect(await undoCount()).toBe(before);
});
test("bevel and helical pairs build with the designed placement", async () => {
  test.setTimeout(240_000);
  await fresh(); const before = await undoCount();
  const result = await run(() => JS3D.gearSet({ type: "bevel", teeth: 20, teeth2: 30, at: [5, 7, 9] }));
  const m = await run((id) => JS3D.get(id).m, result.parts[1].id);
  expect(m.slice(8,11)).toEqual([-1,0,0]); expect(m.slice(12,15)).toEqual([25,7,39]);
  const apices = await run((ids) => ids.map((id) => {
    const body = __store.doc.bodies.find((b) => b.id === id);
    const sketches = body.node.sections.map((s) => __store.doc.sketches.find((sk) => sk.id === s.sketch));
    const [a, b] = sketches, radius = (sk) => Math.hypot(sk.pts[0].x, sk.pts[0].y);
    const h = (b.plane.o[2] - a.plane.o[2]) / (1 - radius(b) / radius(a)) + a.plane.o[2];
    return [0, 1, 2].map((i) => body.m[12 + i] + body.m[8 + i] * h);
  }), result.parts.map((p) => p.id));
  for (let i = 0; i < 3; i++) expect(apices[0][i]).toBeCloseTo(apices[1][i], 3);
  const bodies = await run(async () => { await JS3D.ready(); return JS3D.list(); });
  for (const b of bodies) { expect(b.volume).toBeGreaterThan(0); expect(b.error).toBeNull(); }
  expect(await undoCount()).toBe(before+1); expect(await lastLabel()).toBe("Bevel gear pair");
  await fresh(); const h = await run(() => JS3D.gearSet({ type: "helical" }));
  const second = await run((id) => JS3D.get(id), h.parts[1].id);
  expect(second.node.sections.length).toBeGreaterThanOrEqual(2); expect(second.m[12]).toBeCloseTo(42.567, 3);
  expect(await lastLabel()).toBe("Helical gear pair");
});
test("library hardware records settings and stands on the requested plane", async () => {
  await fresh(); const id = await run(() => JS3D.hardware({ part: "shcs", size: "M3", length: 10 }));
  const b = await run(() => __store.doc.bodies[0]);
  expect(b.fastener).toEqual({ kind: "shcs", std: "metric", size: "M3", len: 10, threads: false, name: b.name, clear: 0, left: false });
  const built = await run(async (id) => { await JS3D.ready(); return JS3D.get(id); }, id);
  expect(Math.abs(built.bbox.min[2])).toBeLessThan(0.01); expect(await lastLabel()).toBe("Add fastener");
  await run(() => JS3D.hardware({ part: "nut", size: "1/4-20" }));
  expect(await run(() => __store.doc.bodies.at(-1).fastener)).toMatchObject({ size: '1/4"-20', std: "inch" });
  const before = await undoCount(), count = await run(() => JS3D.list().length);
  expect(await failure(() => JS3D.hardware({ part: "cutter", size: "M3" }))).toMatch(/^part must be one of:/);
  expect(await failure(() => JS3D.hardware({ part: "shcs", size: "M30" }))).toMatch(/^unknown size "M30" for part "shcs"; sizes:/);
  expect(await failure(() => JS3D.hardware({ part: "washer", size: "M4", length: 5 }))).toBe('length is not used for part "washer"');
  expect(await failure(() => JS3D.hardware({ part: "washer", size: "M4", threads: true }))).toBe('part "washer" has no thread');
  expect(await failure(() => JS3D.hardware({ part: "rod", size: "M3", length: 300, threads: true }))).toMatch(/^Too many turns \(600/);
  expect(await undoCount()).toBe(before); expect(await run(() => JS3D.list().length)).toBe(count);
});
test("whole-body textures change exported mesh and keep a dialog layer", async () => {
  await fresh(); const before = await undoCount(), textures = await run(() => JS3D.textures());
  expect(textures).toHaveLength(LIB.length); expect(textures.length).toBeGreaterThanOrEqual(100);
  expect(textures).toContainEqual({ key: "knurl", name: "Diamond knurl", category: "geo", size: 4 }); expect(await undoCount()).toBe(before);
  const id = await run(() => JS3D.add("box", { size: [40,30,20] }));
  const triangles = async () => stlTriangles(Buffer.from(await run(async (id) => Array.from(await JS3D.export("stl", { ids: [id] })), id)));
  const plain = await triangles(), result = await run((id) => JS3D.texture(id, {}), id);
  expect(result).toMatchObject({ body: id, faces: "all" }); expect(await lastLabel()).toBe("Texture");
  expect(await run(() => __store.doc.bodies[0].textures[0])).toMatchObject({ id: result.texture, faces: "all", ...layer });
  expect(await triangles()).toBeGreaterThan(plain*10);
  const steps = await undoCount();
  expect(await failure((id) => JS3D.texture(id, { texture: "nope" }), id)).toBe(`unknown texture "nope"; list_textures (JS3D.textures()) gives the ${LIB.length} keys`);
  expect(await undoCount()).toBe(steps);
  const hole = await run(() => JS3D.add("box", { hole: true, name: "Cutter" }));
  expect(await failure((id) => JS3D.texture(id), hole)).toBe("Cutter is marked as a hole; textures go on solid bodies");
});
test("texture on chosen faces", async () => {
  await fresh(); const id = await run(() => JS3D.add("box", { size: [40,30,20] }));
  expect(await run((id) => JS3D.texture(id, { texture: "ribs", faces: "top" }), id)).toMatchObject({ faces: 1 });
  const faces = await run(() => __store.doc.bodies[0].textures[0].faces);
  expect(faces).toHaveLength(1);
  expect(faces[0].t).toBe("PLANE");
  [[faces[0].n, [0,0,1]], [faces[0].c, [0,0,20]]].forEach(([got, want]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9)));
});
test("mixed texture face selectors form a union", async () => {
  await fresh(); const id = await run(() => JS3D.add("box"));
  const result = await run(async (id) => {
    const top = (await JS3D.faces(id, "top"))[0].index;
    const other = (await JS3D.faces(id, "all")).find((f) => f.index !== top).index;
    return JS3D.texture(id, { faces: ["top", top, other] });
  }, id);
  expect(result.faces).toBe(2);
});
test("texture layer limit rejects the seventeenth call", async () => {
  await fresh(); const id = await run(() => JS3D.add("box", { name: "Layered" }));
  for (let i = 0; i < 16; i++) await run((id) => JS3D.texture(id), id);
  const before = await undoCount();
  expect(await failure((id) => JS3D.texture(id), id)).toBe("Layered already has 16 textures; remove one in the Texture dialog first");
  expect(await undoCount()).toBe(before);
  expect(await run(() => __store.doc.bodies[0].textures.length)).toBe(16);
});
test("generator names are trimmed and limited", async () => {
  await fresh();
  for (const kind of ["boxMaker", "hardware"]) {
    const result = await run((kind) => { const o = { name: "  " + "x".repeat(256) + "  " }; return kind === "boxMaker" ? JS3D.boxMaker(o).id : JS3D.hardware({ ...o, part: "washer", size: "M4" }); }, kind);
    expect((await run((id) => JS3D.get(id).name, result)).length).toBe(256);
    const before = await undoCount();
    expect(await failure((kind) => kind === "boxMaker" ? JS3D.boxMaker({ name: "x".repeat(257) }) : JS3D.hardware({ part: "washer", size: "M4", name: "x".repeat(257) }), kind)).toBe("name can have at most 256 characters");
    expect(await undoCount()).toBe(before);
  }
});
test("textures use mesh detail and reject changes while waiting", async () => {
  try {
    for (const detail of ["fine", "extra"]) {
      await run((d) => { __app.setMeshDetail(d, true, true); return JS3D.ready(); }, detail);
      await fresh(); const id = await run(() => JS3D.add("box"));
      expect(await run((id) => JS3D.texture(id, { faces: "top" }), id)).toMatchObject({ faces: 1 });
    }
    for (const change of ["hole", "geometry"]) {
      await fresh();
      const result = await run(async (change) => {
        const id = JS3D.add("box", { name: "Changing" });
        const p = JS3D.texture(id, { faces: "top" });
        if (change === "hole") JS3D.setHole(id, true); else JS3D.resize(id, { w: 35 });
        try { await p; return null; } catch (e) { return e.message; }
      }, change);
      expect(result).toBe("Changing changed while the texture was being prepared; try again");
    }
  } finally { await run(() => { __app.setMeshDetail("normal", true, true); return JS3D.ready(); }); }
});
test("drawing gives three measured DXF views, inches, bytes and no undo step", async () => {
  await fresh(); await run(() => JS3D.add("box", { size: [40,30,20] })); const before = await undoCount();
  const result = await run(async () => { const bytes = await JS3D.drawing(); return { bytes: bytes instanceof Uint8Array, text: new TextDecoder().decode(bytes) }; });
  expect(result.bytes).toBe(true); const bounds = linesByLayer(result.text);
  for (const [name,w,h] of [["TOP",40,30],["FRONT",40,20],["RIGHT",30,20]]) { const [x,y]=bounds(name); expect(Math.abs(x-w)).toBeLessThan(0.01); expect(Math.abs(y-h)).toBeLessThan(0.01); }
  const inches = await run(async () => new TextDecoder().decode(await JS3D.drawing({ units: "in", dims: true })));
  expect(inches).toContain('$INSUNITS\r\n70\r\n1\r\n'); expect(inches).toContain('1.575"');
  expect(await run(() => JS3D.invoke("drawing", [{}]))).toHaveProperty("$bytes"); expect(await undoCount()).toBe(before);
  await fresh(); const empty = await undoCount();
  expect(await failure(() => JS3D.drawing())).toBe("nothing to draw: holes and hidden shapes are left out");
  expect(await failure(() => JS3D.drawing({ views: [] }))).toBe(viewsError); expect(await undoCount()).toBe(empty);
});
