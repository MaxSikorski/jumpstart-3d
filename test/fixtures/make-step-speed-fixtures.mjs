// Original synthetic stress fastener, never derived from a supplier download.
import { loadKernel } from "../stepspeed-kernel.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const output = process.argv[2];
if (!output) throw new Error("Pass a temporary output directory");
mkdirSync(output, { recursive: true });
const k = await loadKernel(), R = k.__R, OC = k.__OC();
let head = R.makeCylinder(6, 12.8);
for (let i = 0; i < 100; i++) {
  const maker = new OC.BRepPrimAPI_MakeTorus(5.99, 0.06);
  const rib = R.cast(maker.Shape()).translate(0, 0, 0.08 + i * 0.128);
  maker.delete();
  const next = head.fuse(rib);
  head.delete();
  rib.delete();
  head = next;
  if (i % 20 === 0)
    console.log("rib", i);
}
const shank = R.makeCylinder(3, 30).translate(0, 0, 12.8);
let shape = head.fuse(shank);
head.delete();
shank.delete();
const initial = new Uint8Array(await shape.blobSTEP().arrayBuffer());
shape.delete();
k.setAsset("raw", "step", initial);
shape = k.evalNode({ t: "step", asset: "raw", keepPos: true, mods: [{ t: "thread", face: { c: [0, 0, 27.8], t: "CYLINDRE" }, pitch: 1, length: 0, clear: 0, flip: false, left: false }] });
const checker = new OC.BRepCheck_Analyzer(shape.wrapped, true, false, false);
if (!checker.IsValid())
  throw new Error("invalid generated solid");
checker.delete();
const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
let solids = 0;
try {
  for (; ex.More(); ex.Next())
    solids++;
}
finally {
  ex.delete();
}
const counts = {};
for (const f of shape.faces) {
  counts[f.geomType] = (counts[f.geomType] || 0) + 1;
  f.delete();
}
if (solids !== 1 || Object.values(counts).reduce((a, b) => a + b, 0) <= 400 || (counts.TORUS || 0) < 50 || !counts.BSPLINE_SURFACE)
  throw new Error("fixture requirements: " + JSON.stringify(counts));
const manifest = { provenance: "Original generated 6 mm diameter, 30 mm long pitch-1 modelled threaded shank on a 12 mm diameter, 12.8 mm head; 100 fused toroidal ribs at z=0.08+i*0.128, radii 5.99 and 0.06 mm. Not a McMaster reproduction.", recipe: "node test/fixtures/make-step-speed-fixtures.mjs", solids, faceTypes: counts, bounds: shape.boundingBox.bounds, volume: R.measureVolume(shape), files: {} };
// Construct the writer before snapshotting its initialized static units.
const init = new OC.STEPControl_Writer();
init.delete();
const unit = OC.Interface_Static.CVal("write.step.unit");
try {
  const units = "MM";
  OC.Interface_Static.SetCVal("write.step.unit", units);
  const bytes = new Uint8Array(await shape.blobSTEP().arrayBuffer());
  const name = "step-dense-fastener.step";
  writeFileSync(output + "/" + name, bytes);
  manifest.files[name] = { units, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
finally {
  OC.Interface_Static.SetCVal("write.step.unit", unit);
  shape.delete();
}
writeFileSync(output + "/step-speed-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
