// Shared real-kernel loader; compilation and engine initialization are outside timing.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
export const root = fileURLToPath(new URL("../", import.meta.url));
export async function loadKernel(sourcePath = root + "src/kernel.js") {
  const tp = root + "third_party/";
  const alias = { replicad: tp + "replicad/src/index.ts", "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts", "opentype.js": tp + "opentype.js/dist/opentype.module.js", flatbush: tp + "flatbush/index.js", flatqueue: tp + "flatqueue/index.js", "manifold-3d": tp + "manifold-3d/index.js" };
  const source = readFileSync(sourcePath, "utf8") + "\nexport { R as __R }; export const __OC = () => OC; export { _stepTest, readStepShape, beginStepBuild } from \"./stepload.js\";";
  const bundle = await build({ stdin: { contents: source, resolveDir: root + "src", loader: "js" }, bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent" });
  const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const { default: oc } = await import(tp + "replicad-opencascadejs/dist/replicad_single.js");
  await k.initKernel(oc, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
  return k;
}
