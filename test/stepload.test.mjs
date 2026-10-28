import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { loadKernel, root } from "./stepspeed-kernel.mjs";
import { denseStep } from "../src/stepload.js";
const fixture = name => readFileSync(root + "test/fixtures/" + name);
test("dense policy is only Normal and plain STEP/import keeppiece", () => {
  assert(denseStep({ t: "step", mods: [] }, 401, 1));
  assert(denseStep({ t: "step", mods: [{ t: "keeppiece", src: "import" }] }, 401, 1));
  for (const q of [0.5, 1.1, 2, 4])
    assert(!denseStep({ t: "step" }, 500, q));
  assert(!denseStep({ t: "prim" }, 500, 1));
  assert(!denseStep({ t: "step" }, 400, 1));
  assert(!denseStep({ t: "step", mods: [{ t: "fillet" }] }, 500, 1));
});
test("real checked reader restores statics, retries with a fresh reader, preserves surfaces and exceptions", { timeout: 60000 }, async () => {
  const k = await loadKernel(), OC = k.__OC(), R = k.__R;
  const init = new OC.STEPControl_Reader();
  init.delete();
  const original = OC.Interface_Static.CVal("read.step.sequence");
  const cube = fixture("judge/cube.step");
  const readers = [], wholes = [];
  const proxy = new Proxy(OC, { get(target, key) {
      if (key === "STEPControl_Reader")
        return function () {
          const r = new target.STEPControl_Reader();
          readers.push(r);
          const oneShape = r.OneShape.bind(r);
          r.OneShape = () => {
            const whole = oneShape();
            wholes.push(whole);
            return whole;
          };
          return r;
        };
      return target[key];
    } });
  const read = bytes => k.readStepShape(proxy, R, bytes);
  const restored = () => assert.equal(OC.Interface_Static.CVal("read.step.sequence"), original);
  let shape = read(cube);
  const volume = R.measureVolume(shape);
  shape.delete();
  restored();
  readers.length = 0;
  k._stepTest.rejectFastOnce = true;
  shape = read(cube);
  assert.equal(readers.length, 2);
  assert.notEqual(readers[0], readers[1]);
  assert(readers.every(r => r.isDeleted()));
  assert(Math.abs(R.measureVolume(shape) - volume) < 1e-6);
  const a = new OC.BRepCheck_Analyzer(shape.wrapped, true, false, false);
  try {
    assert(a.IsValid());
  } finally {
    a.delete();
    shape.delete();
  }
  restored();
  assert.throws(() => read(new TextEncoder().encode("not STEP")), /Could not read this STEP file/);
  restored();
  for (const error of [new RangeError("injected"), new WebAssembly.RuntimeError("injected"), new Error("injected")]) {
    readers.length = 0;
    k._stepTest.beforeTransfer = () => {
      throw error;
    };
    try {
      assert.throws(() => read(cube), e => e === error);
      assert.equal(readers.length, error.constructor === Error ? 2 : 1);
      restored();
    } finally {
      k._stepTest.beforeTransfer = null;
    }
  }
  // Force SetCVal failure only on the empty fast policy: immediately use a fresh healed reader.
  const noFast = new Proxy(proxy, { get(target, key) {
      if (key === "Interface_Static")
        return new Proxy(OC.Interface_Static, { get(t, k) {
            if (k === "SetCVal")
              return (name, value) => value === "" ? false : t.SetCVal(name, value);
            return t[k];
          } });
      return target[key];
    } });
  readers.length = 0;
  const stages = [];
  const end = k.beginStepBuild({ id: "no-fast", rev: "r", node: { asset: "cube" } }, e => stages.push(e));
  try {
    shape = k.readStepShape(noFast, R, cube);
    shape.delete();
  } finally {
    end();
  }
  assert.deepEqual(stages.map(e => [e.stage, e.detail]), [["reading", undefined], ["building", undefined]]);
  assert.equal(readers.length, 2);
  restored();
  shape = read(fixture("judge/open-shell.step"));
  const surfaces = shape.faces;
  assert(surfaces.length > 0);
  surfaces.forEach(f => f.delete());
  shape.delete();
  restored();
  assert.throws(() => read(fixture("wire-circle.step")), /no solids or surfaces/);
  restored();
  {
    readers.length = 0;
    shape = read(fixture("step-unrepairable.step"));
    assert.equal(readers.length, 2);
    assert(shape);
    shape.delete();
    restored();
  }
  assert(wholes.every(whole => whole.isDeleted()), "every OneShape handle is freed before returning");
  const castError = new RangeError("cast failed");
  assert.throws(() => k.readStepShape(proxy, { cast() { throw castError; } }, cube), e => e === castError);
  assert(wholes.every(whole => whole.isDeleted()), "failed casts release OneShape too");
  restored();
  const first = [], second = [];
  k.setAsset("cached", "step", cube);
  const body = { id: "cached", rev: "v", node: { t: "step", asset: "cached", mods: [] } };
  assert(k.buildBodies([body], 1, { onProgress: e => first.push(e) })[0].ok);
  assert(k.buildBodies([body], 1, { onProgress: e => second.push(e) })[0].ok);
  assert.deepEqual(first.map(e => e.stage), ["reading", "building", "meshing", "sending"]);
  assert.deepEqual(second.map(e => e.stage), ["meshing", "sending"]);
  if (existsSync(root + "test/fixtures/step-needs-healing.step")) {
    readers.length = 0;
    shape = read(fixture("step-needs-healing.step"));
    assert.equal(readers.length, 2);
    shape.delete();
    restored();
  }
});
