// asSolid must hand back the very object it was given when that is already a solid. It used to compare constructor.name to "Solid",
// which the build's minifier renames, so in the built app it never matched, made a fresh wrapper and leaked the old one.
// This bundles the real kernel.js with the same esbuild settings as build.mjs (minify on, vendored replicad), loads the real
// OpenCascade engine, and checks the answer. The page-side specs cannot see this: the kernel runs in a worker and leaks are invisible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const tp = root + "third_party/";
const alias = {
  replicad: tp + "replicad/src/index.ts",
  "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts",
  "opentype.js": tp + "opentype.js/dist/opentype.module.js",
  flatbush: tp + "flatbush/index.js",
  flatqueue: tp + "flatqueue/index.js",
  "manifold-3d": tp + "manifold-3d/index.js",
  "replicad-opencascadejs": tp + "replicad-opencascadejs/dist/replicad_single.js",
};
// asSolid is private to kernel.js: append an export line to a copy of the source
const source = readFileSync(root + "src/kernel.js", "utf8") + "\nexport { asSolid as __asSolid, R as __R };\n";
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "kernel.js", loader: "js" },
  bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent",
});
const code = bundle.outputFiles[0].text;
const k = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await k.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
const R = k.__R;

test("the minifier really renames the Solid class (so the old name check could not work)", () => {
  assert.notEqual(R.makeBaseBox(1, 1, 1).constructor.name, "Solid");
});

test("asSolid returns the same object for a solid", () => {
  const box = R.makeBaseBox(10, 10, 10);
  assert.equal(k.__asSolid(box), box);
});

test("asSolid still makes a solid from a compound and returns null for nothing", () => {
  const box = R.makeBaseBox(10, 10, 10);
  const compound = R.compoundShapes([box]);
  const s = k.__asSolid(compound);
  assert.ok(s instanceof R.Solid);
  assert.equal(k.__asSolid(null), null);
});
