// Real-kernel cylinder lettering: compare tangent prisms against the original shell method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { meshReport } from "./fuzz-checks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), tp = root + "third_party/";
const alias = { replicad: tp + "replicad/src/index.ts", "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts", "opentype.js": tp + "opentype.js/dist/opentype.module.js", flatbush: tp + "flatbush/index.js", flatqueue: tp + "flatqueue/index.js", "manifold-3d": tp + "manifold-3d/index.js", "replicad-opencascadejs": tp + "replicad-opencascadejs/dist/replicad_single.js" };
async function load(exact = false) {
  const plugin = { name: "exact", setup(b) { b.onLoad({ filter: /src\/kernel\.js$/ }, (a) => {
    let contents = readFileSync(a.path, "utf8");
    const old = 'const fast = sags.map((sag) => around && (sag < depth * 0.1 || (emb && sag < 0.02)));';
    assert.ok(contents.includes(old));
    contents = contents.replace(old, exact ? 'const fast = sags.map(() => false);' : old + ' if (around) globalThis.__embossRoutes = fast.slice();');
    return { contents, loader: "js" };
  }); } };
  const bundle = await build({ stdin: { contents: 'export * from "./kernel.js";', resolveDir: root + "src", sourcefile: "embosscyl-wrapper.js", loader: "js" }, bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, plugins: [plugin], logLevel: "silent" });
  const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const { default: oc } = await import(tp + "replicad-opencascadejs/dist/replicad_single.js");
  await k.initKernel(oc, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
  return k;
}
const k = await load(), exact = await load(true);
const message = "HAPPY BIRTHDAY MATE - FROM ALL OF US WITH LOVE - 2026 ** CHEERS".slice(0, 60);
function node(str, mode = "deboss", size = 1, r = 17.53 / 2, h = 1.5, along = false) {
  return { t: "prim", kind: "cylinder", p: { w: 2 * r, d: 2 * r, h }, mods: [{ id: "f", seq: 1, t: "emboss", kind: "cyl", p: [r, 0, h / 2], o: [0, 0, 0], ax: [0, 0, 1], r, ext: true, str, font: "sans", size, depth: 0.3, mode, along }] };
}
const tris = (m) => { const out = []; for (let i = 0; i < m.triangles.length; i += 3) out.push([0, 1, 2].map((j) => [0, 1, 2].map((c) => m.vertices[3 * m.triangles[i + j] + c]))); return out; };
function run(kernel, n) { const start = performance.now(), shape = kernel.evalNode(n), ms = performance.now() - start; return { shape, ms, volume: kernel._test.safeVolume(shape) }; }
function closed(kernel, shape) { const report = meshReport(tris(kernel.meshShape(shape, 1))); assert.equal(report.open, 0); return report; }
const base = (r, h) => Math.PI * r * r * h;
for (const mode of ["deboss", "emboss"]) test(`60 characters ${mode}: fast closed result and accurate letter volume`, (t) => {
  const full = run(k, node(message, mode));
  try { t.diagnostic(`build ${full.ms.toFixed(0)} ms`); assert.ok(full.ms < 60000, `build took ${full.ms.toFixed(0)} ms`); closed(k, full.shape); } finally { full.shape.delete(); }
  const n = node(message.slice(0, 8), mode), fast = run(k, n), reference = run(exact, n);
  try { const b = base(17.53 / 2, 1.5), a = Math.abs(fast.volume - b), e = Math.abs(reference.volume - b); t.diagnostic(`8-character letter volumes fast ${a.toFixed(5)}, exact ${e.toFixed(5)} mm³`); assert.ok(e > 0 && Math.abs(a - e) / e < 0.03); } finally { fast.shape.delete(); reference.shape.delete(); }
});
test("overlapping kerning pair remains one closed solid with material removed", () => {
  const result = run(k, node("AVATAR"));
  try { assert.equal(result.shape.solids.length, 1); assert.ok(result.volume < base(17.53 / 2, 1.5)); closed(k, result.shape); } finally { result.shape.delete(); }
});
test("Along text is not clipped by the shell", (t) => {
  const result = run(k, node("HELLOHEL", "emboss", 4, 10, 50, true));
  try { const v = k.meshShape(result.shape, 1).vertices; let lo = Infinity, hi = -Infinity; for (let i = 0; i < v.length; i += 3) if (Math.hypot(v[i], v[i + 1]) > 10.15) { lo = Math.min(lo, v[i + 2]); hi = Math.max(hi, v[i + 2]); } t.diagnostic(`letter span ${(hi - lo).toFixed(2)} mm`); assert.ok(hi - lo >= 23); } finally { result.shape.delete(); }
});
test("mixed-width serif text trims only the wide letter", (t) => {
  const n = node("Wavy Text", "deboss", 1); n.mods[0].font = "serif";
  const result = run(k, n), routes = globalThis.__embossRoutes;
  try { t.diagnostic(`per-letter W build ${result.ms.toFixed(0)} ms; routes ${routes}`); assert.ok(result.ms < 60000); assert.ok(routes.includes(true) && routes.includes(false)); assert.equal(routes[0], false); assert.ok(result.volume < base(17.53 / 2, 1.5)); closed(k, result.shape); } finally { result.shape.delete(); }
});
test("small letters cut a hole face", (t) => {
  const r = 8, h = 3, n = node("INSIDE", "deboss", 0.8, r, h);
  n.p.w = n.p.d = 20; n.mods[0].ext = false;
  n.mods.unshift({ id: "hole", seq: 0, t: "bool", op: "cut", tool: { t: "prim", kind: "cylinder", p: { w: 2 * r, d: 2 * r, h }, mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  const result = run(k, n);
  try { t.diagnostic(`hole-face build ${result.ms.toFixed(0)} ms`); assert.ok(globalThis.__embossRoutes.every(Boolean)); assert.ok(result.volume < base(10, h) - base(r, h)); closed(k, result.shape); } finally { result.shape.delete(); }
});
test("shallow deboss uses the shell when sag would reduce edge depth", () => {
  const n = node("a", "deboss", 1); n.mods[0].font = "serif"; n.mods[0].depth = 0.05;
  const actual = run(k, n), routes = globalThis.__embossRoutes, reference = run(exact, n);
  try { assert.deepEqual(routes, [false]); assert.ok(Math.abs(actual.volume - reference.volume) < 1e-7); } finally { actual.shape.delete(); reference.shape.delete(); }
});
test("large letters retain the exact shell method", () => {
  const n = node("AB", "deboss", 10, 8, 15), actual = run(k, n), routes = globalThis.__embossRoutes, reference = run(exact, n);
  try { assert.ok(routes.every((v) => !v)); assert.ok(Math.abs(actual.volume - reference.volume) < 1e-7); closed(k, actual.shape); } finally { actual.shape.delete(); reference.shape.delete(); }
});
