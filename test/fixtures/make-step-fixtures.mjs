// Writes the two STEP fixtures of test/step-import.spec.mjs with the app's own geometry kernel (nothing downloaded, no licence to carry).
// Run from the repository root: node test/fixtures/make-step-fixtures.mjs
// The kernel is bundled with the same esbuild settings as build.mjs, like test/assolid.test.mjs does. Each file is an assembly: the parts are
// separate products linked by NEXT_ASSEMBLY_USAGE_OCCURRENCE, which is how other CAD programs write one (STEPControl_Writer with write.step.assembly = 1).
// The files carry the time they were written in their header, so a rerun changes the bytes but not what the spec sees.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
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
const source = readFileSync(root + "src/kernel.js", "utf8") + "\nexport { R as __R }; export const __OC = () => OC;\n";
const bundle = await build({
  stdin: { contents: source, resolveDir: root + "src", sourcefile: "kernel.js", loader: "js" },
  bundle: true, minify: true, target: "es2020", format: "esm", platform: "node", write: false, alias, logLevel: "silent",
});
const k = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(tp + "replicad-opencascadejs/dist/replicad_single.js");
await k.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
const R = k.__R, OC = k.__OC();

const box = (w, d, h, x = 0, y = 0, z = 0) => R.makeBaseBox(w, d, h).translate(x, y, z);
function assembly(parts) {
  OC.Interface_Static.SetIVal("write.step.assembly", 1);
  const writer = new OC.STEPControl_Writer(), progress = new OC.Message_ProgressRange();
  writer.Transfer(R.makeCompound(parts).wrapped, OC.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  if (writer.Write("assembly.step") !== OC.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error("could not write the STEP file");
  const bytes = OC.FS.readFile("/assembly.step");
  OC.FS.unlink("/assembly.step"); writer.delete(); progress.delete();
  OC.Interface_Static.SetIVal("write.step.assembly", 0);
  return bytes;
}
const save = (name, bytes) => { writeFileSync(root + "test/fixtures/" + name, bytes); console.log(name, bytes.length, "bytes"); };

// a 60x40x10 plate with a 4 mm hole, a pin 0.05 mm wider than the hole pressed into it, a 60x40x10 block lying on the plate
const plate = box(60, 40, 10).cut(R.makeCylinder(4, 30).translate(0, 0, -10));
save("step-assembly-3-parts.step", assembly([plate, R.makeCylinder(4.05, 30).translate(0, 0, -5), box(60, 40, 10, 0, 0, 10)]));
// two 10 mm cubes that touch face to face
save("step-2-touching-cubes.step", assembly([box(10, 10, 10), box(10, 10, 10, 10, 0, 0)]));
