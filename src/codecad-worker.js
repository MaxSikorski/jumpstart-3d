// jumpstart-3d: Code CAD, worker side. Runs a replicad function body in a TEMPORARY worker (src/worker.js started
// by src/codecadclient.js), checks that it made one closed solid, writes it as STEP and proves the app can read that STEP
// back through the same step-body path the design will use. The temporary worker is thrown away afterwards, so code that
// misuses the engine cannot damage the design's own worker. This is trusted code, not a sandbox: a worker can fetch.
import * as replicad from "replicad";
import { setAsset, buildBodies, errorText } from "./kernel.js";

let probes = 0; // the kernel caches a shape by its node, so each probe gets its own asset id
const WRONG_TYPE = "The code must return one solid, not a drawing, sketch, face, line, list or nothing. Extrude or revolve a sketch to make a solid.";

function solidsOf(shape, OC) {
  const found = [];
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try { for (; ex.More(); ex.Next()) found.push(replicad.cast(OC.TopoDS.Solid(ex.Current()))); }
  finally { ex.delete(); }
  return found;
}
function hasLooseFaces(shape, OC) {
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_FACE, OC.TopAbs_ShapeEnum.TopAbs_SOLID);
  try { return ex.More(); } finally { ex.delete(); }
}

// code: a function body that gets `replicad` and `params` and returns one solid. params: { alias: millimetres }.
export async function runCodeCad({ code, params }) {
  let fn;
  try { fn = new Function("replicad", "params", '"use strict";\n' + code); }
  catch (e) { throw new Error("The code has a syntax error: " + e.message); }
  let result;
  try { result = fn(replicad, Object.freeze({ ...params })); }
  catch (e) {
    const m = errorText(e);
    throw new Error("The code stopped with an error: " + (/^(Standard_|BRep|StdFail)/.test(m) ? `the geometry engine refused a step (${m}). Check for sizes of zero or less.` : m));
  }

  if (result && typeof result.then === "function") throw new Error("The code returned a promise. Return the solid itself (no async or await).");
  if (!replicad.isShape3D(result)) throw new Error(WRONG_TYPE);
  const OC = replicad.getOC();
  const solids = solidsOf(result, OC);
  if (!solids.length) throw new Error("The code returned a surface, not a closed solid. Close it, or extrude a sketch to make a solid.");
  if (solids.length > 1) throw new Error(`The code returned ${solids.length} separate pieces. Return one solid for now: join them with .fuse() so they touch.`);
  if (hasLooseFaces(result, OC)) throw new Error("The code returned a solid with loose surfaces next to it. Return the solid alone.");
  const solid = solids[0];
  const check = new OC.BRepCheck_Analyzer(solid.wrapped, true, false);
  let valid;
  try { valid = check.IsValid(); } finally { check.delete(); }
  if (!valid) throw new Error("The solid is not valid (it may have faces that cross each other or a gap). Simplify the shape or change a size.");
  const volume = replicad.measureVolume(solid);
  if (!(volume > 1e-6)) throw new Error("The solid has no volume (it is flat, empty, or turned inside out).");

  const bytes = new Uint8Array(await solid.blobSTEP().arrayBuffer());
  // the proof: build the saved bytes the way the design will (a step body that keeps its position)
  const probe = "codecad-probe-" + ++probes;
  setAsset(probe, "step", bytes.slice());
  const [back] = buildBodies([{ id: probe, rev: probe, node: { t: "step", asset: probe, keepPos: true, mods: [] } }], 1);
  if (!back.ok) throw new Error("The solid was made but could not be read back from its STEP file: " + back.error);
  const v = back.mesh.volume;
  if (!(Math.abs(v - volume) <= 0.01 * volume + 1e-6)) throw new Error("The solid changed when saved as STEP, so it was not added. Simplify the shape and try again.");
  return { bytes: bytes.buffer, volume: v, bbox: back.mesh.bbox };
}
