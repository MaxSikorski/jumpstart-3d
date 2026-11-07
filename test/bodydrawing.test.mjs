import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)), tp = root + "third_party/";
const alias = { three: tp + "three/build/three.module.js", replicad: tp + "replicad/src/index.ts", "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts", "opentype.js": tp + "opentype.js/dist/opentype.module.js", flatbush: tp + "flatbush/index.js", flatqueue: tp + "flatqueue/index.js", "manifold-3d": tp + "manifold-3d/index.js", "replicad-opencascadejs": tp + "replicad-opencascadejs/dist/replicad_single.js" };
const bundle = await build({ stdin: { contents: 'export * from "./bodydrawing.js"; export * from "./dxf.js"; export * from "./importers.js";', resolveDir: root + "src", loader: "js" }, bundle: true, format: "esm", platform: "node", write: false, alias, logLevel: "silent" });
const { drawingDXF, writeDXF, parseDXF } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const rect = (w, h) => [[0, 0, w, 0], [w, 0, w, h], [w, h, 0, h], [0, h, 0, 0]].map(([x, y, a, b]) => ({ t: "line", a: [x, y], b: [a, b] }));
const views = { top: rect(40, 30), front: rect(40, 20), right: rect(30, 20) };
function entities(text) {
  const pairs = text.trim().split(/\r?\n/), out = []; let current;
  for (let i = 0; i < pairs.length; i += 2) {
    const code = +pairs[i], value = pairs[i + 1];
    if (code === 0) { current = { type: value }; out.push(current); }
    else if (current) current[code] = value;
  }
  return out;
}
function box(text, layer) {
  const lines = entities(text).filter((e) => e.type === "LINE" && e[8] === layer), xs = [], ys = [];
  for (const l of lines) { xs.push(+l[10], +l[11]); ys.push(+l[20], +l[21]); }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
test("view placement, scale and units", () => {
  for (const [scale, units, factor] of [[1, "mm", 1], [0.5, "mm", 0.5], [1, "in", 1 / 25.4]]) {
    const text = drawingDXF(views, { scale, units }), top = box(text, "TOP"), front = box(text, "FRONT"), right = box(text, "RIGHT");
    for (const [b, w, h] of [[top, 40, 30], [front, 40, 20], [right, 30, 20]]) { near(b[2] - b[0], w * factor); near(b[3] - b[1], h * factor); }
    near(top[0], front[0]); near(right[1], front[1]); assert.ok(top[1] > front[3]); assert.ok(right[0] > front[2]);
    assert.equal(parseDXF(text).curves.length, 12);
    assert.match(text, units === "in" ? /\$INSUNITS\r\n70\r\n1\r\n/ : /\$INSUNITS\r\n70\r\n4\r\n/);
  }
  assert.match(writeDXF([{ name: "Sketch", curves: rect(1, 1), dx: 0, dy: 0 }]), /\$INSUNITS\r\n70\r\n4\r\n/);
});
test("dimensions retain view geometry and show model sizes", () => {
  for (const units of ["mm", "in"]) {
    const plain = drawingDXF(views, { units, scale: 0.5 }), text = drawingDXF(views, { units, scale: 0.5, dims: true });
    for (const n of ["TOP", "FRONT", "RIGHT"]) assert.deepEqual(box(text, n), box(plain, n));
    const e = entities(text); assert.ok(e.some((v) => v[8] === "DIMENSIONS"));
    for (const value of units === "mm" ? ["40", "30", "20"] : ['1.575"', '1.181"', '0.787"']) assert.ok(e.some((v) => v.type === "TEXT" && v[1] === value), value);
    assert.ok(parseDXF(text).curves.length >= parseDXF(plain).curves.length);
  }
});
test("single views and fractional inch labels", () => {
  const text = drawingDXF({ front: rect(38.1, 25.4) }, { units: "in", dims: true });
  assert.deepEqual(box(text, "FRONT"), [0, 0, 1.5, 1]);
  assert.ok(entities(text).some((e) => e.type === "TEXT" && e[1] === '1 1/2"'));
  assert.ok(entities(text).some((e) => e.type === "TEXT" && e[1] === '1"'));
});
