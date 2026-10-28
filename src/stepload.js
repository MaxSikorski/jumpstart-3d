// Checked STEP transfer and synchronous, body-scoped progress. No geometry policy leaks across builds.
const UNREADABLE = "Could not read this STEP file (it may be damaged or not a STEP file).";
const EMPTY = "This STEP file has no solids or surfaces in it, so there is nothing to import.";
let context;
export function beginStepBuild(body, onProgress) {
  const previous = context;
  context = { id: body.id, rev: body.rev, asset: body.node.asset, start: performance.now(), onProgress };
  return () => {
    context = previous;
  };
}
export function stepStage(stage, detail) {
  if (!context?.onProgress || !context.asset)
    return;
  const { id, rev, asset, start, onProgress } = context;
  onProgress({ id, rev, asset, stage, ms: performance.now() - start, ...(detail ? { detail } : {}) });
}
// Only Node tests set this; defaults never alter production transfer.
export const _stepTest = { rejectFastOnce: false, attempts: 0, beforeTransfer: null };
export function readStepShape(OC, R, bytes) {
  const path = "/step_" + Math.random().toString(36).slice(2) + ".step";
  let reader, original, saved = false;
  const count = (shape, type) => {
    const ex = new OC.TopExp_Explorer(shape.wrapped, type, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      let n = 0;
      for (; ex.More(); ex.Next())
        n++;
      return n;
    } finally {
      ex.delete();
    }
  };
  const valid = (shape) => {
    const check = new OC.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    try {
      return check.IsValid();
    } finally {
      check.delete();
    }
  };
  try {
    OC.FS.writeFile(path, bytes);
    reader = new OC.STEPControl_Reader(); // initializes the static parameters before the snapshot
    original = OC.Interface_Static.CVal("read.step.sequence");
    saved = true;
    const fast = OC.Interface_Static.SetCVal("read.step.sequence", "");
    for (let attempt = fast ? 0 : 1; attempt <= 1; attempt++) {
      let shape;
      try {
        if (attempt) {
          reader.delete();
          reader = null;
          reader = new OC.STEPControl_Reader();
          OC.Interface_Static.SetCVal("read.step.sequence", "FromSTEP");
          if (fast)
            stepStage("building", "repairing");
        }
        if (!attempt || !fast)
          stepStage("reading");
        _stepTest.attempts++;
        if (reader.ReadFile(path) !== OC.IFSelect_ReturnStatus.IFSelect_RetDone)
          throw new Error(UNREADABLE);
        if (!attempt || !fast)
          stepStage("building");
        _stepTest.beforeTransfer?.(attempt);
        const roots = reader.TransferRoots();
        const whole = reader.OneShape();
        if (whole.IsNull()) {
          whole.delete();
          if (!attempt)
            continue;
          throw new Error(EMPTY);
        }
        try {
          shape = R.cast(whole);
        } finally {
          whole.delete();
        }
        const solids = count(shape, OC.TopAbs_ShapeEnum.TopAbs_SOLID);
        const isValid = !attempt && solids ? valid(shape) : true;
        const forced = !attempt && _stepTest.rejectFastOnce;
        if (forced)
          _stepTest.rejectFastOnce = false;
        if (!attempt && (!roots || !solids || !isValid || forced))
          continue;
        if (!solids && !count(shape, OC.TopAbs_ShapeEnum.TopAbs_FACE))
          throw new Error(EMPTY);
        const result = shape;
        shape = null;
        return result;
      } catch (e) {
        if (attempt || e instanceof WebAssembly.RuntimeError || e instanceof RangeError || e.message === UNREADABLE)
          throw e;
        // Transfer/validation failures receive exactly one fresh, healed read.
      } finally {
        shape?.delete();
      }
    }
    throw new Error(EMPTY);
  } finally {
    try {
      if (saved)
        OC.Interface_Static.SetCVal("read.step.sequence", original);
    } finally {
      reader?.delete();
      try {
        OC.FS.unlink(path);
      } catch {
      }
    }
  }
}
export function denseStep(node, faceCount, quality) {
  return quality === 1 && node?.t === "step" && (node.mods || []).every(m => m.t === "keeppiece" && m.src === "import") && faceCount > 400;
}
