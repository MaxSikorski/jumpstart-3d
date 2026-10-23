// glTF export (plan §5): Open/Export > glTF makes a binary .glb with one mesh and one colour per body, in metres, Y up.
// The reader below is independent of src/gltf.js: it checks the container (header, chunks, buffer lengths), every accessor against
// the bytes it points at, the bounding box against the same design's STL export (millimetres, Z up), and the colours against the
// bodies' sRGB hex. Nothing here runs the Khronos validator (needs a download); the same checks are the ones it makes first.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, exportBytes, newDoc, body, prim } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const RED = "#d83b3b", BLUE = "#2b7bb9", GREEN = "#3bb35a";
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const twoColours = () => newDoc("Two colours", "advanced", {
  bodies: [
    body("b1", "Red block", prim("box", { w: 20, d: 12, h: 8, r: 0, c: 0 }), T(0, 0, 0), { color: RED }),
    body("b2", "Blue block", prim("box", { w: 10, d: 30, h: 5, r: 0, c: 0 }), T(40, 15, 3), { color: BLUE }),
  ],
});

const srgbToLinear = (hex) => [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const SIZE = { 5126: 4, 5125: 4, 5123: 2 }, WIDTH = { SCALAR: 1, VEC3: 3 };

// parse a .glb with nothing but the spec: returns { json, meshes: [{ pos, nor, idx }] } after checking the container
function readGlb(buf) {
  expect(buf.readUInt32LE(0), "magic 'glTF'").toBe(0x46546c67);
  expect(buf.readUInt32LE(4), "version").toBe(2);
  expect(buf.readUInt32LE(8), "declared length equals file length").toBe(buf.length);
  const jl = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16), "first chunk is JSON").toBe(0x4e4f534a);
  expect(jl % 4, "JSON chunk 4-byte aligned").toBe(0);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString("utf8"));
  const bo = 20 + jl, bl = buf.readUInt32LE(bo);
  expect(buf.readUInt32LE(bo + 4), "second chunk is BIN").toBe(0x004e4942);
  expect(bl % 4, "BIN chunk 4-byte aligned").toBe(0);
  expect(bo + 8 + bl, "chunks fill the file exactly").toBe(buf.length);
  const bin = buf.subarray(bo + 8, bo + 8 + bl);
  expect(json.asset.version).toBe("2.0");
  expect(json.buffers).toHaveLength(1);
  expect(json.buffers[0].byteLength).toBeLessThanOrEqual(bl);
  expect(bl - json.buffers[0].byteLength, "at most 3 bytes of padding").toBeLessThan(4);
  const read = (ai) => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
    expect(a.count * SIZE[a.componentType] * WIDTH[a.type], `accessor ${ai} fills its view`).toBe(v.byteLength);
    expect((v.byteOffset || 0) % 4).toBe(0);
    const out = [];
    for (let i = 0; i < a.count * WIDTH[a.type]; i++) {
      const o = v.byteOffset + i * 4;
      out.push(a.componentType === 5126 ? bin.readFloatLE(o) : bin.readUInt32LE(o));
    }
    return { a, out };
  };
  const meshes = json.meshes.map((m) => {
    expect(m.primitives).toHaveLength(1);
    const p = m.primitives[0];
    expect(p.mode).toBe(4);
    const pos = read(p.attributes.POSITION), nor = read(p.attributes.NORMAL), idx = read(p.indices);
    expect(nor.a.count).toBe(pos.a.count);
    expect(idx.a.count % 3).toBe(0);
    expect(Math.max(...idx.out)).toBeLessThan(pos.a.count);
    // min and max are exactly what the positions hold
    for (let r = 0; r < 3; r++) {
      const col = pos.out.filter((_, i) => i % 3 === r);
      expect(pos.a.min[r]).toBe(Math.min(...col) + 0); // + 0: JSON has no -0
      expect(pos.a.max[r]).toBe(Math.max(...col) + 0);
    }
    return { name: m.name, pos: pos.out, nor: nor.out, idx: idx.out, material: p.material };
  });
  return { json, meshes };
}

// bounding box and triangle count of the same design from its STL export (mm, Z up)
function stlInfo(buf) {
  const n = buf.readUInt32LE(80), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let r = 0; r < 3; r++) {
    const x = buf.readFloatLE(84 + t * 50 + 12 + v * 12 + r * 4);
    min[r] = Math.min(min[r], x); max[r] = Math.max(max[r], x);
  }
  return { n, min, max };
}

test("a two-colour design exports as a .glb: valid container, the design's bounding box in metres, two materials in the right colours", async () => {
  await loadDoc(page, twoColours());
  const stl = stlInfo((await exportBytes(page, "stl")).bytes);
  const out = await exportBytes(page, "glb");
  expect(out.name).toBe("Two colours.glb");
  const { json, meshes } = readGlb(out.bytes);

  // one mesh, node and material per body, in body order, named after the body
  expect(json.meshes.map((m) => m.name)).toEqual(["Red block", "Blue block"]);
  expect(json.nodes.map((n) => n.name)).toEqual(["Red block", "Blue block"]);
  expect(json.scenes[0].nodes).toEqual([0, 1]);
  expect(json.materials).toHaveLength(2);
  const colours = json.materials.map((m) => m.pbrMetallicRoughness.baseColorFactor);
  [RED, BLUE].forEach((hex, k) => {
    srgbToLinear(hex).forEach((v, c) => expect(colours[k][c]).toBeCloseTo(v, 5));
    expect(colours[k][3]).toBe(1);
  });
  expect(meshes.map((m) => m.material)).toEqual([0, 1]);

  // units and axes are stated, and the numbers agree: millimetres/1000, (x, y, z) -> (x, z, -y)
  expect(json.asset.extras).toMatchObject({ units: "metres", sourceUnits: "millimetres", scaleFromSource: 0.001 });
  expect(json.asset.extras.upAxis).toMatch(/^Y/);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  json.accessors.filter((a) => a.min).forEach((a) => a.min.forEach((v, r) => { min[r] = Math.min(min[r], v); max[r] = Math.max(max[r], a.max[r]); }));
  const want = { min: [stl.min[0], stl.min[2], -stl.max[1]].map((v) => v / 1000), max: [stl.max[0], stl.max[2], -stl.min[1]].map((v) => v / 1000) };
  min.forEach((v, r) => expect(Math.abs(v - want.min[r])).toBeLessThan(1e-7));
  max.forEach((v, r) => expect(Math.abs(v - want.max[r])).toBeLessThan(1e-7));
  expect(max[0] - min[0]).toBeCloseTo(0.055, 6); // -10 .. 45 mm = 55 mm across, so not 55 and not 0.05 mm by mistake
  expect(meshes.reduce((n, m) => n + m.idx.length / 3, 0)).toBe(stl.n);
});

test("normals are unit length and agree with the winding, also on a mirrored and a turned body", async () => {
  const mirror = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -40, 0, 0, 1];
  const turned = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, -40, 5, 1]; // 90 degrees about Z
  const doc = twoColours();
  doc.bodies.push(body("b3", "Mirrored", prim("box", { w: 20, d: 12, h: 8, r: 2, c: 0 }), mirror, { color: GREEN }));
  doc.bodies.push(body("b4", "Turned", prim("cylinder", { w: 14, d: 14, h: 9, r: 0, c: 0 }), turned, { color: GREEN }));
  await loadDoc(page, doc);
  const { json, meshes } = readGlb((await exportBytes(page, "glb")).bytes);
  expect(json.meshes).toHaveLength(4);
  for (const m of meshes) {
    let bad = 0;
    for (let v = 0; v < m.nor.length; v += 3) if (Math.abs(Math.hypot(m.nor[v], m.nor[v + 1], m.nor[v + 2]) - 1) > 1e-4) bad++;
    expect(bad, "non-unit normals").toBe(0);
    let flipped = 0;
    for (let t = 0; t < m.idx.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => m.idx[t + k] * 3);
      const u = [0, 1, 2].map((r) => m.pos[b + r] - m.pos[a + r]), w = [0, 1, 2].map((r) => m.pos[c + r] - m.pos[a + r]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const dot = [a, b, c].reduce((s, i) => s + n[0] * m.nor[i] + n[1] * m.nor[i + 1] + n[2] * m.nor[i + 2], 0);
      if (dot < -1e-18) flipped++; // zero-area slivers in the kernel mesh give 0
    }
    expect(flipped, `${m.name}: triangles facing against their normals`).toBe(0);
  }
  // the mirrored box sits at x = -40 +- 10 mm, so its metres are -0.05 .. -0.03
  const mir = json.accessors[json.meshes[2].primitives[0].attributes.POSITION];
  expect(mir.min[0]).toBeCloseTo(-0.05, 6);
  expect(mir.max[0]).toBeCloseTo(-0.03, 6);
});

test("JS3D.export('glb') gives the bytes the menu gives, and holes and hidden bodies are left out", async () => {
  const doc = twoColours();
  doc.bodies.push(body("h1", "Hole", prim("cylinder", { w: 4, d: 4, h: 30, r: 0, c: 0 }), T(0, 0, -5), { hole: true }));
  doc.bodies.push(body("x1", "Hidden", prim("box", { w: 5, d: 5, h: 5, r: 0, c: 0 }), T(80, 0, 0), { hidden: true }));
  await loadDoc(page, doc);
  const viaBridge = Buffer.from(await page.evaluate(async () => Array.from(await window.JS3D.export("glb"))));
  const viaMenu = (await exportBytes(page, "glb")).bytes;
  expect(viaBridge.equals(viaMenu)).toBe(true);
  expect(readGlb(viaMenu).json.meshes.map((m) => m.name)).toEqual(["Red block", "Blue block"]);
});
