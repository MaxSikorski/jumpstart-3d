import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { openingAt, fillReportFor } from "../src/fillpick.js";
import { miniLid } from "./fixtures/lidgen.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const lidFile = root + "examples/pi-lid/raspberry-pi-4-case-lid.stl";
const thirdParty = root + "third_party/";
const bundle = await build({
  stdin: { contents: 'export { initKernel, evalNode, setAsset, buildBodies, _test, fillReportCacheForTest } from "./src/kernel.js"; export * as R from "replicad"; export { readMeshFile, packMesh } from "./src/meshimport.js"; export * from "./src/fillopen.js";', resolveDir: root },
  plugins: [{
    name: "inspect-fill-report-cache",
    setup(builder) {
      builder.onLoad({ filter: /\/kernel\.js$/ }, ({ path }) => ({
        contents: readFileSync(path, "utf8") + "\nexport const fillReportCacheForTest = fillReports;",
        loader: "js",
      }));
    },
  }],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
  alias: { replicad: thirdParty + "replicad/src/index.ts", "replicad/shape-functions": thirdParty + "replicad/src/shapeFunctions/index.ts", "opentype.js": thirdParty + "opentype.js/dist/opentype.module.js", flatbush: thirdParty + "flatbush/index.js", flatqueue: thirdParty + "flatqueue/index.js", three: thirdParty + "three/build/three.module.js" }
});
Error.stackTraceLimit = 0;
const K = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(thirdParty + "replicad-opencascadejs/dist/replicad_single.js");
await K.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
const R = K.R;
const oc = R.getOC();
const T = oc.TopAbs_ShapeEnum;
// Choose the top or bottom plane of the three-millimetre plate.
const plane = (top = true) => ({ o: [0, 0, top ? 3 : 0], n: [0, 0, top ? 1 : -1] });
// Compare volumes with the tolerance required by the design.
const near = (actual, expected, tolerance = 0.1) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected} ± ${tolerance}`);
// Check solid count and allow only edge defects already present in the input.
function closed(shape, solids = 1, original = null) {
  const explorer = new oc.TopExp_Explorer(shape.wrapped, T.TopAbs_SOLID, T.TopAbs_SHAPE);
  let count = 0;
  for (; explorer.More(); explorer.Next()) count++;
  explorer.delete();
  assert.equal(count, solids);
  const retained = [];
  function countEdges(source) {
    const buckets = new Map();
    const explorer = new oc.TopExp_Explorer(source.wrapped, T.TopAbs_EDGE, T.TopAbs_SHAPE);
    try {
      for (; explorer.More(); explorer.Next()) {
        const edge = explorer.Current();
        try {
          const hash = oc.ReplicadShapeHasher.HashCode(edge, 2147483647);
          const bucket = buckets.get(hash) || [];
          const entry = bucket.find(entry => entry.edge.IsSame(edge));
          if (entry) entry.count++;
          else {
            const kept = oc.TopoDS.Edge(edge);
            retained.push(kept);
            bucket.push({ edge: kept, count: 1 });
          }
          buckets.set(hash, bucket);
        } finally {
          edge.delete();
        }
      }
    } finally {
      explorer.delete();
    }
    return buckets;
  }
  try {
    const edges = countEdges(shape);
    const originalEdges = original ? countEdges(original) : new Map();
    assert.ok([...edges].every(([hash, bucket]) => bucket.every(({ edge, count }) =>
      count === 2 || originalEdges.get(hash)?.some(entry => entry.edge.IsSame(edge) && entry.count === count)
    )), "every edge used twice or has the same input defect");
  } finally {
    retained.forEach(edge => edge.delete());
  }
}
// Build the plate with through-holes, a counterbore, pocket, boss and notch.
function plate() {
  let shape = R.makeBox([-40, -25, 0], [40, 25, 3]);
  // Subtract a tool and release both replaced solids.
  const cut = (tool) => {
    const next = shape.cut(tool);
    shape.delete();
    tool.delete();
    shape = next;
  };
  for (const [x, y, radius, z, height] of [[-30, 15, 2, -1, 5], [-20, 15, 2, -1, 5], [20, 15, 1.7, -1, 5], [20, 15, 3.2, 1.5, 5], [10, -15, 4, -1, 5]]) cut(R.makeCylinder(radius, height, [x, y, z]));
  cut(R.makeBox([-10, 10, -1], [10, 14, 5]));
  cut(R.makeBox([-30, -15, 1.5], [-20, -5, 5]));
  const boss = R.makeCylinder(3, 6, [0, -10, 2.9]);
  const withBoss = shape.fuse(boss);
  shape.delete();
  boss.delete();
  shape = withBoss;
  cut(R.makeBox([30, -30, -1], [45, -20, 5]));
  return shape;
}
// Exercise the same solid-fixing callback used by the kernel.
function fill(shape, pickedPlane, keep = []) {
  return K.fillOpenings(shape, { plane: pickedPlane, keep }, K._test.fixSolid);
}
for (const top of [true, false]) for (const angle of [0, 30]) test(`app plate ${top ? "top" : "bottom"}, ${angle} degrees`, () => {
  let shape = plate();
  let pickedPlane = plane(top);
  if (angle) {
    shape = shape.rotate(angle, [0, 0, 0], [1, 0, 0]);
    const radians = angle * Math.PI / 180;
    const rotatePoint = ([x, y, z]) => [x, y * Math.cos(radians) - z * Math.sin(radians), y * Math.sin(radians) + z * Math.cos(radians)];
    pickedPlane = { o: rotatePoint(pickedPlane.o), n: rotatePoint(pickedPlane.n) };
  }
  const start = performance.now();
  const result = fill(shape, pickedPlane);
  const measuredVolume = R.measureVolume(result.shape);
  console.log(`app ${top ? "top" : "bottom"} ${angle}°: ${measuredVolume} mm³, ${(performance.now() - start).toFixed(1)} ms`);
  near(measuredVolume, top ? 12016.8 : 11818.6);
  assert.equal(result.report.filled, top ? 6 : 5);
  assert.ok(result.report.openings.every(opening => typeof opening.through === "boolean"));
  if (top && !angle) {
    for (const [x, y] of [[-30, 15], [-20, 15], [10, -15]]) {
      const hole = result.report.openings.find(opening => Math.hypot(opening.c[0] - x, opening.c[1] - y) < 0.01);
      assert.equal(hole?.through, true, "round through-hole reaches the far side");
    }
    const pocket = result.report.openings.find(opening => Math.hypot(opening.c[0] + 25, opening.c[1] + 10) < 0.01);
    assert.equal(pocket?.through, false, "blind pocket stops inside the plate");
  }
  closed(result.shape);
  result.shape.delete();
});
for (const top of [true, false]) test(`30 degree plate ${top ? "top" : "bottom"} with rounded normal`, () => {
  const shape = plate().rotate(30, [0, 0, 0], [1, 0, 0]);
  const sign = top ? 1 : -1;
  const result = fill(shape, {
    o: top ? [0, -1.5, 3 * Math.sqrt(3) / 2] : [0, 0, 0],
    n: [0, -0.5 * sign, 0.866 * sign],
  });
  near(R.measureVolume(result.shape), top ? 12016.8 : 11818.6);
  assert.equal(result.report.filled, top ? 6 : 5);
  closed(result.shape);
  result.shape.delete();
});
test("curved torus boss survives filling a through-hole", () => {
  const base = R.makeBox([-20, -15, 0], [20, 15, 3]);
  const tool = R.makeCylinder(4, 5, [-10, 0, -1]);
  const perforated = base.cut(tool);
  base.delete();
  tool.delete();
  const maker = new oc.BRepPrimAPI_MakeTorus(5, 1);
  const raw = maker.Shape();
  const boss = R.cast(raw).translate([5, 0, 3]);
  raw.delete();
  maker.delete();
  const shape = perforated.fuse(boss);
  perforated.delete();
  boss.delete();
  const expected = R.measureVolume(shape) + Math.PI * 4 ** 2 * 3;
  const result = fill(shape, { o: [-15, 10, 3], n: [0, 0, 1] });
  const actual = R.measureVolume(result.shape);
  console.log(`torus boss: ${actual} mm³, expected ${expected} mm³`);
  near(actual, expected, 0.1);
  assert.equal(result.report.filled, 1);
  closed(result.shape);
  result.shape.delete();
});
test("O opening includes its supported island", () => {
  let shape = R.makeBox([-15, -15, 0], [15, 15, 3]);
  for (const [operation, minimum, maximum] of [["cut", [-5, -5, -1], [5, 5, 4]], ["fuse", [-2, -2, 0], [2, 2, 3]], ["fuse", [1, -0.5, 0], [6, 0.5, 1.5]]]) {
    const tool = R.makeBox(minimum, maximum);
    const next = shape[operation](tool);
    shape.delete();
    tool.delete();
    shape = next;
  }
  const result = fill(shape, plane());
  assert.equal(result.report.filled, 1);
  near(R.measureVolume(result.shape), 2700);
  closed(result.shape);
  result.shape.delete();
});
test("lower top face includes openings in a top face 0.002 mm higher", () => {
  const base = R.makeBox([-20, -15, 0], [20, 15, 3]);
  const slab = R.makeBox([0, -15, 3], [20, 15, 3.002]);
  let shape = base.fuse(slab);
  base.delete();
  slab.delete();
  for (const x of [-10, 10]) {
    const tool = R.makeCylinder(2, 5, [x, 0, -1]);
    const next = shape.cut(tool);
    shape.delete();
    tool.delete();
    shape = next;
  }
  const result = fill(shape, { o: [-10, 10, 3], n: [0, 0, 1] });
  assert.equal(result.report.openings.length, 2);
  assert.equal(result.report.filled, 2);
  for (const opening of result.report.openings) near(opening.depth, 3.002, 1e-6);
  near(R.measureVolume(result.shape), 3601.2, 1e-6);
  closed(result.shape);
  result.shape.delete();
});
// Import fixture bytes through the application mesh pipeline.
const importMesh = async (id, bytes) => {
  const result = await K.readMeshFile(new Uint8Array(bytes), id + ".stl");
  K.setAsset(id, "mesh", K.packMesh(result.mesh));
  return { t: "mesh", asset: id, mods: [] };
};
test("mini lid import, keep, scale and kernel reports", async () => {
  const fixture = miniLid();
  const start = performance.now();
  const node = await importMesh("mini", fixture.stl);
  const imported = K.evalNode(node);
  console.log(`mini import: ${(performance.now() - start).toFixed(1)} ms, as-is ${R.measureVolume(imported)} mm³`);
  imported.delete();
  for (const top of [true, false]) for (const keep of [[], [{ c: [...fixture.openings[0].c, top ? 3 : 0], a: fixture.openings[0].area }]]) {
    const mod = { t: "fillopen", id: "fill", plane: plane(top), keep };
    const modifiedNode = { ...node, mods: [mod] };
    const fillStart = performance.now();
    const shape = K.evalNode(modifiedNode);
    const measuredVolume = R.measureVolume(shape);
    near(measuredVolume, fixture.volumeFilled - (keep.length ? fixture.openings[0].area * 3 : 0));
    closed(shape);
    shape.delete();
    const body = K.buildBodies([{ id: "b", node: modifiedNode }])[0];
    assert.equal(body.ok, true, body.error);
    assert.equal(body.mesh.fillReports.fill.filled, 6 - keep.length);
    structuredClone(body.mesh.fillReports);
    if (top && !keep.length) {
      assert.ok([...K.fillReportCacheForTest.values()].includes(body.mesh.fillReports.fill), "build uses the report made by the fill");
      K.fillReportCacheForTest.clear();
      const recovered = K.buildBodies([{ id: "b", node: modifiedNode }])[0];
      assert.equal(recovered.ok, true, recovered.error);
      assert.deepEqual(recovered.mesh.fillReports.fill, body.mesh.fillReports.fill);
      assert.equal(K.fillReportCacheForTest.size, 1, "a true miss stores its recovered report");
      const repeated = K.buildBodies([{ id: "b", node: modifiedNode }])[0];
      assert.equal(repeated.ok, true, repeated.error);
      assert.equal(repeated.mesh.fillReports.fill, recovered.mesh.fillReports.fill, "the next build reuses the recovered report");
    }
    console.log(`mini ${top ? "top" : "bottom"} keep ${keep.length}: ${measuredVolume} mm³, ${(performance.now() - fillStart).toFixed(1)} ms`);
    if (keep.length) {
      const scaled = K._test.scaleMod(mod, [2, 2, 2], [0, 0, 0]);
      assert.deepEqual(scaled.keep[0].c, keep[0].c.map((x) => x * 2));
      near(scaled.keep[0].a, keep[0].a * 4);
      const base = K.evalNode(node);
      const doubled = base.scale(2);
      base.delete();
      const result = fill(doubled, scaled.plane, scaled.keep);
      near(R.measureVolume(result.shape), measuredVolume * 8);
      assert.equal(result.report.kept, 1);
      closed(result.shape);
      result.shape.delete();
    }
  }
});
for (const top of [true, false]) test(`Max lid ${top ? "top" : "bottom"}`, async () => {
  const started = performance.now();
  const modifiedNode = await importMesh("max", readFileSync(lidFile));
  const shape = K.evalNode(modifiedNode);
  const original = shape.clone();
  const start = performance.now();
  const result = fill(shape, { o: [39.656, 11.5548, top ? 3 : 0], n: [0, 0, top ? 1 : -1] });
  const elapsed = performance.now() - start;
  const measuredVolume = R.measureVolume(result.shape);
  console.log(`Max ${top ? "top" : "bottom"}: ${measuredVolume} mm³, fill ${elapsed.toFixed(1)} ms (target < 2 s; limit < 5 s), total ${(performance.now() - started).toFixed(1)} ms`);
  assert.equal(result.report.filled, 25);
  near(measuredVolume, 18259.7, 18.2597);
  console.log(`Max phases (ms): ${JSON.stringify(result.timings)}`);
  closed(result.shape, 1, original);
  original.delete();
  result.shape.delete();
  assert.ok(elapsed < 5e3, `${elapsed} ms`);
});
for (const z of [2.998, 3.0004]) test(`Max lid clicked plane z=${z}`, async () => {
  const node = await importMesh("max-clicked", readFileSync(lidFile));
  const original = K.evalNode(node);
  const result = fill(original.clone(), { o: [39.656, 11.5548, z], n: [0, 0, 1] });
  assert.equal(result.report.openings.length, 25);
  assert.equal(result.report.filled, 25);
  const measuredVolume = R.measureVolume(result.shape);
  near(measuredVolume, 18259.7, 18.2597);
  console.log(`Max clicked z=${z}: 25 of 25, ${measuredVolume} mm³`);
  closed(result.shape, 1, original);
  result.shape.delete();
  original.delete();
});
test("sloped exit is refused while a separate opening fills", () => {
  let shape = R.makeBox([-20, -15, 0], [20, 15, 3]);
  const wedge = R.draw([0, -1]).lineTo([21, -1]).lineTo([21, 2]).lineTo([0, 0]).close().sketchOnPlane("XZ").extrude(40).translate([0, 20, 0]);
  let next = shape.cut(wedge);
  shape.delete();
  wedge.delete();
  shape = next;
  for (const x of [-10, 10]) {
    const tool = R.makeCylinder(2, 6, [x, 0, -1]);
    next = shape.cut(tool);
    shape.delete();
    tool.delete();
    shape = next;
  }
  const before = R.measureVolume(shape);
  const result = fill(shape, plane());
  assert.equal(result.report.filled, 1);
  assert.equal(result.report.openings.filter((g) => g.state === "refused").length, 1);
  assert.equal(result.report.openings.find((g) => g.state === "refused").why, "This opening runs out to the outside of the part below the surface, so it can't be filled neatly.");
  near(R.measureVolume(result.shape) - before, Math.PI * 4 * 3);
  closed(result.shape);
  result.shape.delete();
});
test("multi-solid bodies preserve the unpicked solid; open surfaces are refused", () => {
  const a = plate();
  const body = R.makeBox([100, 0, 0], [110, 10, 10]);
  const compound = R.makeCompound([a, body]);
  const result = fill(compound, plane());
  near(R.measureVolume(result.shape), 13016.8);
  closed(result.shape, 2);
  result.shape.delete();
  a.delete();
  body.delete();
  const wire = R.drawRectangle(10, 10).sketchOnPlane("XY").wire;
  const face = R.makeFace(wire);
  assert.throws(() => fill(face, plane()), { message: "This body isn't a closed solid. Repair it first (Import > CAD faces… / Mesh to STEP)." });
  face.delete();
  wire.delete();
});
test("keep matching uses distance then area, ignores stale entries and keeps refusals", () => {
  const groups = [{ c: [0, 0, 0], a: 10, depth: 3, loops: [] }, { c: [0, 0, 0], a: 20, depth: 3, loops: [] }, { c: [10, 0, 0], a: 1, depth: 3, loops: [], why: "refused" }];
  const result = K.chooseOpenings({ faces: [0], groups }, [{ c: [0.1, 0, 0], a: 19 }, { c: [100, 0, 0], a: 1 }]);
  assert.deepEqual(result.openings.map((g) => g.state), ["fill", "keep", "refused"]);
});
test("generated mini STL has exactly two triangles per edge and the expected volume", () => {
  const fixture = miniLid();
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < fixture.stl.readUInt32LE(80); i++) {
    const points = Array.from({ length: 3 }, (_, j) => Array.from({ length: 3 }, (_2, k) => fixture.stl.readFloatLE(84 + 50 * i + 12 + 12 * j + 4 * k)));
    const [a, b, c] = points;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const keys = points.map(point => point.join(","));
    for (let j = 0; j < 3; j++) {
      const key = [keys[j], keys[(j + 1) % 3]].sort().join("|");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok([...edges.values()].every(count => count === 2));
  near(volume, fixture.volumeAsIs, 1e-6);
});

test("openingAt finds a square, an O ring and its island, and chooses the smallest area", () => {
  const square = (x0, y0, x1, y1) => [[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0]];
  const report = { openings: [
    { a: 4, loops: [square(-5,-1,-3,1)] },
    { a: 84, loops: [square(0,0,10,10),square(3,3,7,7)] },
    { a: 400, loops: [square(-6,-6,14,14)] },
  ] };
  assert.equal(openingAt(report, [-4,0,0], [0,0,1]), 0);
  assert.equal(openingAt(report, [1,1,0], [0,0,1]), 1);
  assert.equal(openingAt(report, [5,5,0], [0,0,1]), 1);
  assert.equal(openingAt(report, [20,20,0], [0,0,1]), -1);
});

// the panel and the Beginner inspector read a body's reports through fillReportFor (src/fillpick.js)
test("fillReportFor finds the report by id, else by position among the Fill openings features", () => {
  const A = { filled: 1 }, B = { filled: 2 };
  const node = (...ids) => ({ mods: [{ t: "scale", id: "s" }, ...ids.map((id) => ({ t: "fillopen", id })), { t: "hole", id: "h" }] });
  assert.equal(fillReportFor({ fillReports: { fA: A } }, node("fA"), "fA"), A, "own id");
  assert.equal(fillReportFor({ fillReports: { fA: A } }, node("fB"), "fB"), A, "a build kept from another session's id");
  assert.equal(fillReportFor({ fillReports: { fA: A, fB: B } }, node("fC", "fD"), "fC"), A, "two features, the first");
  assert.equal(fillReportFor({ fillReports: { fA: A, fB: B } }, node("fC", "fD"), "fD"), B, "two features, the second");
  assert.equal(fillReportFor({ fillReports: { fA: A, fB: B } }, node("fB", "fC"), "fB"), B, "an own id wins over position");
  assert.equal(fillReportFor({ fillReports: { fA: A } }, node("fC", "fD"), "fD"), null, "counts that differ are not guessed");
  assert.equal(fillReportFor({ fillReports: { 10: A, 2: B } }, node("fC", "fD"), "fC"), null, "ids that look like numbers are listed out of order: not guessed");
  assert.equal(fillReportFor({ fillReports: { fA: A } }, node("fB"), "other"), null, "a feature the body does not have");
  assert.equal(fillReportFor({}, node("fA"), "fA"), null);
  assert.equal(fillReportFor(null, node("fA"), "fA"), null);
});

// A5: the clicked flat half must not borrow the adjoining slope's normal or level.
function shallowSlopePlate() {
  return R.draw([-100, 0]).lineTo([100, 0])
    .lineTo([100, 3 + 100 * Math.tan(Math.PI / 1800)])
    .lineTo([0, 3]).lineTo([-100, 3]).close()
    .sketchOnPlane("XZ").extrude(30).translate([0, 15, 0]);
}
for (const boss of [false, true]) test(`flat face adjoining 0.1 degree slope${boss ? " with shallow boss" : ""}`, () => {
  let shape = shallowSlopePlate();
  const radius = boss ? 4 : 2;
  const drill = R.makeCylinder(radius, 5, [-60, 0, -1]);
  let next = shape.cut(drill);
  shape.delete();
  drill.delete();
  shape = next;
  if (boss) {
    const tool = R.makeCylinder(5, 0.2, [-25, 0, 2.9]);
    next = shape.fuse(tool);
    shape.delete();
    tool.delete();
    shape = next;
  }
  const result = fill(shape, { o: [-80, 10, 3], n: [0, 0, 1] });
  const expected = 18000 + 150000 * Math.tan(Math.PI / 1800) + (boss ? Math.PI * 25 * 0.1 : 0);
  const actual = R.measureVolume(result.shape);
  console.log(`A5 slope${boss ? " + boss" : ""}: ${actual} mm³`);
  assert.equal(result.report.filled, 1);
  near(actual, expected);
  if (boss) near(actual, 18269.654);
  closed(result.shape);
  result.shape.delete();
});
for (const countersink of [false, true]) for (const translation of [0, 1000]) test(`30 degree plate, world Z ${countersink ? "countersink" : "drill"}, Y +${translation}`, () => {
  let shape = R.makeBox([-20, -15, 0], [20, 15, 3]).rotate(30, [0, 0, 0], [1, 0, 0]);
  const drill = R.makeCylinder(2, 30, [0, 0, -15]);
  let next = shape.cut(drill);
  shape.delete();
  drill.delete();
  shape = next;
  if (countersink) {
    const tool = R.draw([0, 0]).lineTo([2, 0]).lineTo([8, 6]).lineTo([0, 6]).close()
      .sketchOnPlane("XZ").revolve();
    next = shape.cut(tool);
    shape.delete();
    tool.delete();
    shape = next;
  }
  shape = shape.translate([0, translation, 0]);
  const result = fill(shape, {
    o: [10, translation - 1.5, 3 * Math.sqrt(3) / 2],
    n: translation ? [0, -0.5, 0.866] : [0, -0.5, Math.sqrt(3) / 2],
  });
  const actual = R.measureVolume(result.shape);
  console.log(`A5 angled ${countersink ? "countersink" : "drill"}, Y +${translation}: ${actual} mm³`);
  assert.equal(result.report.filled, 1);
  near(actual, 3600);
  closed(result.shape);
  result.shape.delete();
});
for (const top of [true, false]) test(`rounded normal on translated feature plate ${top ? "top" : "bottom"}`, () => {
  const shape = plate().rotate(30, [0, 0, 0], [1, 0, 0]).translate([0, 1000, 0]);
  const sign = top ? 1 : -1;
  const result = fill(shape, {
    o: top ? [0, 998.5, 3 * Math.sqrt(3) / 2] : [0, 1000, 0],
    n: [0, -0.5 * sign, 0.866 * sign],
  });
  const actual = R.measureVolume(result.shape);
  console.log(`A5 translated feature plate ${top ? "top" : "bottom"}: ${actual} mm³`);
  assert.equal(result.report.filled, top ? 6 : 5);
  near(actual, top ? 12016.8 : 11818.6);
  closed(result.shape);
  result.shape.delete();
});

test("rounded click beside a tilted recess selects the top face", () => {
  const base = R.makeBox([-20, -15, 0], [20, 15, 3]);
  const drill = R.makeCylinder(2, 5, [-10, 0, -1]);
  const drilled = base.cut(drill);
  base.delete();
  drill.delete();
  const recess = R.draw([0, 10]).lineTo([20, -10]).lineTo([20, 10]).close()
    .sketchOnPlane("XY", 3).extrude(5).rotate(0.1, [0, 0, 3], [0, 1, 0]);
  const shape = drilled.cut(recess).rotate(30, [0, 0, 0], [1, 0, 0]);
  drilled.delete();
  recess.delete();
  const result = fill(shape, { o: [0.005, -10.1602, -2.4019], n: [0, -0.5, 0.866] });
  try {
    const actual = R.measureVolume(result.shape);
    console.log(`A6 rounded click beside recess: ${actual} mm³`);
    assert.equal(result.report.openings.length, 1);
    assert.equal(result.report.filled, 1);
    near(actual, 3595.346);
    closed(result.shape);
  } finally {
    result.shape.delete();
  }
});

test("clicked flat face wins over a slope listed first in the profile", () => {
  const rise = 20 * Math.tan(Math.PI / 1800);
  const base = R.draw([-20, 3 + rise]).lineTo([0, 3]).lineTo([20, 3])
    .lineTo([20, 0]).lineTo([-20, 0]).close()
    .sketchOnPlane("XZ").extrude(30).translate([0, 15, 0]);
  const drill = R.makeCylinder(2, 6, [10, 0, -1]);
  const shape = base.cut(drill);
  base.delete();
  drill.delete();
  const result = fill(shape, { o: [10, 10, 3], n: [0, 0, 1] });
  const actual = R.measureVolume(result.shape);
  console.log(`A5 slope-first profile: ${actual} mm³`);
  assert.equal(result.report.filled, 1);
  near(actual, 3600 + 20 * 30 * rise / 2);
  closed(result.shape);
  result.shape.delete();
});
