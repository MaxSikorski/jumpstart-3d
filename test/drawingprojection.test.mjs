import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { cleanCurves } from "../src/drawingprojection.js";

const root = fileURLToPath(new URL("../", import.meta.url)), tp = root + "third_party/";
const alias = { three: tp + "three/build/three.module.js", replicad: tp + "replicad/src/index.ts", "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts", "opentype.js": tp + "opentype.js/dist/opentype.module.js", flatbush: tp + "flatbush/index.js", flatqueue: tp + "flatqueue/index.js", "manifold-3d": tp + "manifold-3d/index.js", "replicad-opencascadejs": tp + "replicad-opencascadejs/dist/replicad_single.js" };
const bundle = await build({ stdin: { contents: 'export * from "./kernel.js"; export { drawingDXF } from "./bodydrawing.js"; export { parseDXF } from "./importers.js";', resolveDir: root + "src", sourcefile: "drawing-wrapper.js", loader: "js" }, bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent" });
const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: oc } = await import(tp + "replicad-opencascadejs/dist/replicad_single.js");
await k.initKernel(oc, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
const prim = (kind, w, d, h) => ({ t: "prim", kind, p: { w, d, h }, mods: [] });
const draw = (node, m = null) => k.drawingViews([{ id: "one", node, m }], ["top", "front", "right"]);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function check(curves, lines, circles, bounds) {
  assert.equal(curves.filter(c => c.t === "line").length, lines, JSON.stringify(curves));
  assert.equal(curves.filter(c => c.t === "circle").length, circles, JSON.stringify(curves));
  assert.equal(curves.length, lines + circles, JSON.stringify(curves));
  if (bounds) { const pts = curves.filter(c => c.t === "line").flatMap(c => [c.a, c.b]); const actual = [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))]; actual.forEach((x, i) => near(x, bounds[i])); }
}
test("box views and dimensions", () => {
  const { views, skipped } = draw(prim("box", 40, 30, 20)); assert.deepEqual(skipped, []);
  check(views.top, 4, 0, [-20, 20, -15, 15]); check(views.front, 4, 0, [-20, 20, 0, 20]); check(views.right, 4, 0, [-15, 15, 0, 20]);
});
test("through hole visible only from top", () => {
  const box = prim("box", 20, 10, 5); box.mods.push({ id: "hole", seq: 0, t: "bool", op: "cut", tool: prim("cylinder", 4, 4, 5), m: null });
  const { views } = draw(box); check(views.top, 4, 1); check(views.front, 4, 0); check(views.right, 4, 0);
  const c = views.top.find(c => c.t === "circle"); near(c.r, 2); near(c.c[0], 0); near(c.c[1], 0);
});
test("transformed positions preserve view axes", () => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1]; const { views } = draw(prim("box", 40, 30, 20), m);
  check(views.top, 4, 0, [80, 120, 35, 65]); check(views.front, 4, 0, [80, 120, 0, 20]); check(views.right, 4, 0, [35, 65, 0, 20]);
});
test("cylinder silhouettes", () => { const { views } = draw(prim("cylinder", 10, 10, 20)); check(views.front, 4, 0, [-5, 5, 0, 20]); check(views.top, 0, 1); });
test("clean duplicate and touching lines", () => {
  const line = (a, b) => ({ t: "line", a, b });
  assert.deepEqual(cleanCurves([line([0, 0], [1, 0]), line([0, 0], [1, 0]), line([1, 0], [0, 0]), line([1, 0], [2, 0]), line([1, 1], [1, 1])]), [line([0, 0], [2, 0])]);
});
test("blind hole from the top shows only in Top (the views look from the right side)", () => {
  const box = prim("box", 20, 10, 5), m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1];
  box.mods.push({ id: "hole", seq: 0, t: "bool", op: "cut", tool: prim("cylinder", 4, 4, 3), m });
  const { views } = draw(box); check(views.top, 4, 1); check(views.front, 4, 0);
  const bottom = k.drawingViews([{ id: "b", node: box, m: [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 5, 1] }], ["top"]).views.top;
  check(bottom, 4, 0); // turned upside down, the hole faces the plate and Top no longer sees it
});
test("a rounded end gives a true counter-clockwise arc", () => {
  const box = prim("box", 20, 10, 5), m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  box.mods.push({ id: "end", seq: 0, t: "bool", op: "join", tool: prim("cylinder", 10, 10, 5), m });
  const top = draw(box).views.top, arcs = top.filter(c => c.t === "arc");
  assert.equal(arcs.length, 1, JSON.stringify(top)); assert.equal(top.filter(c => c.t === "line").length, 3, JSON.stringify(top));
  const a = arcs[0]; near(a.r, 5); near(a.c[0], 10); near(a.c[1], 0); near(Math.cos(a.a0), 0); near(Math.sin(a.a0), -1); near(Math.sin(a.a1), 1);
});
test("box to DXF end to end: three rectangles, inches divide by 25.4", () => {
  const { views } = draw(prim("box", 40, 30, 20));
  for (const [units, f] of [["mm", 1], ["in", 1 / 25.4]]) {
    const text = k.drawingDXF(views, { units });
    assert.match(text, units === "in" ? /\$INSUNITS\r?\n70\r?\n1\r?\n/ : /\$INSUNITS\r?\n70\r?\n4\r?\n/);
    const segs = k.parseDXF(text.replace(/\$INSUNITS\r?\n70\r?\n1/, "$INSUNITS\n70\n4")).curves.filter(c => c.t === "line");
    assert.equal(segs.length, 12);
    const xs = segs.flatMap(c => [c.a[0], c.b[0]]), ys = segs.flatMap(c => [c.a[1], c.b[1]]);
    const gap = Math.max(10 * f, 0.15 * 40 * f); // the layout's gap between views
    near(Math.max(...xs) - Math.min(...xs), (40 + 30) * f + gap); near(Math.max(...ys) - Math.min(...ys), (20 + 30) * f + gap);
  }
});
test("overall sizes measure an arc by its own extent, not its whole circle", () => {
  const box = prim("box", 20, 10, 5), m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  box.mods.push({ id: "end", seq: 0, t: "bool", op: "join", tool: prim("cylinder", 10, 10, 5), m });
  const text = k.drawingDXF({ top: draw(box).views.top }, { dims: true });
  const labels = [...text.matchAll(/\r?\nTEXT\r?\n[\s\S]*?\r?\n1\r?\n([^\r\n]+)/g)].map((x) => x[1]).sort();
  assert.deepEqual(labels, ["10", "25"]);
});
