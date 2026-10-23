// Node tests for the readers and tolerances the fuzzer uses (test/fuzz-checks.mjs): each one on a small file or number where
// the right answer is known, so the fuzzer's checks are known to fail when they should.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { makeRng, readStl, meshReport, readThreeMf, readStep, meshMatches, stretchExcused, replayCommand, FINE_MESH_TRIANGLES, coneOpenExcused } from "./fuzz-checks.mjs";

// a zip with the given entries (compressed, no checksum: the reader does not look at it)
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = deflateRawSync(Buffer.from(text)), nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(8, 10); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(text.length, 24); head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data); central.push(head, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
// a unit cube mesh as 3MF text, scaled by s
const cube = (id, s) => `<object id="${id}" type="model"><mesh><vertices>${[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((v) => `<vertex x="${v[0] * s}" y="${v[1] * s}" z="${v[2] * s}"/>`).join("")}</vertices><triangles>${[[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join("")}</triangles></mesh></object>`;
const model = (resources, build) => zip([["3D/3dmodel.model", `<?xml version="1.0"?><model><resources>${resources}</resources><build>${build}</build></model>\n`]]);

test("3MF: build items are resolved to their objects", () => {
  const ok = readThreeMf(model(cube(2, 2) + cube(3, 3), '<item objectid="2"/><item objectid="3"/>'));
  assert.deepEqual(ok.items.map((x) => x.objectid), ["2", "3"]);
  assert.deepEqual(ok.items.map((x) => Math.round(x.placed)), [8, 27]);
  assert.ok(ok.items.every((x) => x.mesh.open === 0));
  // the resources are fine but the build uses object 2 twice and never object 3: a slicer gets a duplicate and loses a part
  const twice = readThreeMf(model(cube(2, 2) + cube(3, 3), '<item objectid="2"/><item objectid="2"/>'));
  assert.deepEqual(twice.items.map((x) => x.objectid), ["2", "2"]);
  assert.equal(new Set(twice.items.map((x) => x.objectid)).size, 1);
  assert.throws(() => readThreeMf(model(cube(2, 2), '<item objectid="9"/>')), /does not exist/);
  assert.throws(() => readThreeMf(model(cube(2, 2) + cube(2, 3), '<item objectid="2"/>')), /two objects with id 2/);
  // a transform scales what the item places
  assert.equal(Math.round(readThreeMf(model(cube(2, 2), '<item objectid="2" transform="2 0 0 0 2 0 0 0 2 5 5 5"/>')).items[0].placed), 64);
  // an open mesh is seen
  const open = cube(2, 2).replace('<triangle v1="0" v2="2" v3="1"/>', "");
  assert.equal(readThreeMf(model(open, '<item objectid="2"/>')).items[0].mesh.open, 3);
});

test("STEP: every solid entity the exporter writes is counted, a cavity too", () => {
  const file = (body) => Buffer.from(`ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${body}\nENDSEC;\nEND-ISO-10303-21;\n`);
  assert.equal(readStep(file("#10=MANIFOLD_SOLID_BREP('',#11);\n#20 = MANIFOLD_SOLID_BREP ('',#21);")).solids, 2);
  assert.equal(readStep(file("#10=BREP_WITH_VOIDS('',#11,(#12));")).solids, 1);
  assert.equal(readStep(file("#10=SHAPE_REPRESENTATION('MANIFOLD_SOLID_BREP',(#11),#12);")).solids, 0);
  assert.throws(() => readStep(Buffer.from("not a step file")), /ISO-10303-21/);
  assert.throws(() => readStep(Buffer.from("ISO-10303-21;\nDATA;\n")), /END-ISO/);
});

test("volume tolerance: flat shapes are held to a hair, curved ones to the tessellation", () => {
  assert.equal(meshMatches(1960, 2000, ["box"]), false); // a box 2 percent short must be seen
  assert.equal(meshMatches(1999.99, 2000, ["box"]), true);
  assert.equal(meshMatches(1999.99, 2000, ["box", "group"]), true);
  assert.equal(meshMatches(1994, 2000, ["box", "cylinder"]), true); // 0.3 percent, as seen on curved shapes
  assert.equal(meshMatches(70.99, 71.47, ["cylinder", "sphere"]), true); // 0.67 percent on a small shape
  assert.equal(meshMatches(1970, 2000, ["cylinder"]), false); // 1.5 percent is not tessellation
  assert.equal(meshMatches(NaN, 2000, ["box"]), false);
});

test("known kernel problems are excused only for what was shown", () => {
  const big = { kind: "group", mods: 0, tris: FINE_MESH_TRIANGLES };
  assert.equal(stretchExcused([2, 1, 1], big), true);
  assert.equal(stretchExcused(2, big), false); // an even stretch never takes that path
  assert.equal(stretchExcused([2, 2, 2], big), false);
  assert.equal(stretchExcused([2, 1, 1], { ...big, tris: 100 }), false); // a small mesh is no excuse
  assert.equal(stretchExcused([2, 1, 1], { kind: "box", mods: 0, tris: 5000 }), false); // a plain shape is stretched in its sizes
  assert.equal(stretchExcused([2, 1, 1], { kind: "box", mods: 1, tris: 5000 }), false); // nor is a box with a feature
  assert.equal(stretchExcused([2, 1, 1], { kind: "torus", mods: 0, tris: 5000 }), true);
});

test("the replay command keeps strict mode and the build", () => {
  assert.equal(replayCommand({ seed: 7, ops: 18, strict: false, project: "site" }), "FUZZ_SEED=7 FUZZ_OPS=18 npx playwright test test/fuzz.spec.mjs --project=site");
  assert.equal(replayCommand({ seed: 7, ops: 18, strict: true, project: "single" }), "FUZZ_STRICT=1 FUZZ_SEED=7 FUZZ_OPS=18 npx playwright test test/fuzz.spec.mjs --project=single");
});

test("STL: closed and open meshes are told apart, the same seed gives the same numbers", () => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const stl = (tris) => { const b = Buffer.alloc(84 + 50 * tris.length); b.writeUInt32LE(tris.length, 80); tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => b.writeFloatLE(c, 84 + 50 * i + 12 + 12 * k + 4 * j)))); return b; };
  const tris = f.map((t) => t.map((i) => v[i]));
  const closed = meshReport(readStl(stl(tris)));
  assert.equal(closed.open, 0);
  assert.ok(Math.abs(closed.volume - 1) < 1e-9);
  assert.equal(meshReport(readStl(stl(tris.slice(1)))).open, 3);
  assert.ok(meshReport(readStl(stl(tris.map((t) => [t[0], t[2], t[1]])))).volume < 0);
  assert.throws(() => readStl(stl(tris).subarray(0, 200)), /says 12 triangles/);
  const a = makeRng(5), b = makeRng(5);
  assert.deepEqual([a.next(), a.int(1, 6)], [b.next(), b.int(1, 6)]);
});

test("cone seam: 12 open edges for each cone a body holds, and no other body is excused", () => {
  assert.equal(coneOpenExcused(12, 1), true);
  assert.equal(coneOpenExcused(13, 1), false); // one more open edge than a cone leaves
  assert.equal(coneOpenExcused(24, 2), true);
  assert.equal(coneOpenExcused(40, 1), false); // a cone does not excuse a broken body around it
  assert.equal(coneOpenExcused(6, 0), false); // a body with no cone has no excuse at all
});
