import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_TASKS, agentTask } from "../benchmarks/agent-tasks.mjs";
import { evaluateSession, inspectStl } from "../scripts/agent-benchmark.mjs";

test("agent tasks contain requests and invariants, never prepared plans", () => {
  assert.equal(AGENT_TASKS.length, 3);
  for (const task of AGENT_TASKS) {
    assert.equal(typeof task.request, "string");
    assert.equal(task.plan, undefined);
    assert.equal(task.buildPlan, undefined);
  }
  assert.throws(() => agentTask("unknown"), /Unknown task/);
});

test("agent evaluator fails missing evidence instead of borrowing deterministic coverage", () => {
  const result = evaluateSession({ taskId: "coaster-revision", baseline: { revision: "before" }, calls: [], checkpoints: {} });
  assert.equal(result.pass, false);
  assert.ok(result.checks.some((check) => check.name === "channels-measured" && !check.pass));
  assert.ok(result.checks.some((check) => check.name === "save-reopen" && !check.pass));
  assert.ok(result.checks.some((check) => check.name === "undo-restores-baseline" && !check.pass));
});

test("dimensions must come from exported geometry, not feature parameters", () => {
  const session = {
    taskId: "reject-and-correct", baseline: { revision: "before" }, calls: [],
    checkpoints: { candidate: { document: { revision: "after", bodies: [{ featureTree: { t: "prim", p: { w: 74, d: 74, h: 5 } }, dimensions: { x: 74, y: 74, z: 5 }, volume: 100 }] }, stl: { triangles: 10, degenerate: 0, dimensions: { x: 80, y: 74, z: 5 } } } },
  };
  const result = evaluateSession(session);
  assert.equal(result.checks.find((check) => check.name === "export-dimension-x").pass, false);
  assert.equal(result.checks.find((check) => check.name === "export-dimension-y").pass, true);
  assert.equal(result.checks.find((check) => check.name === "mesh-topology").pass, false);
});

function triangle(points) {
  const bytes = Buffer.alloc(134);
  bytes.writeUInt32LE(1, 80);
  points.flat().forEach((value, index) => bytes.writeFloatLE(value, 96 + index * 4));
  return bytes;
}

test("binary STL evidence measures vertices and rejects malformed or non-finite files", () => {
  const measured = inspectStl(triangle([[0, 0, 0], [4, 0, 0], [0, 3, 0]]));
  assert.deepEqual(measured.dimensions, { x: 4, y: 3, z: 0 });
  assert.equal(measured.degenerate, 0);
  assert.equal(inspectStl(triangle([[0, 0, 0], [4, 0, 0], [8, 0, 0]])).degenerate, 1);
  assert.throws(() => inspectStl(Buffer.alloc(84)), /Invalid/);
  assert.throws(() => inspectStl(triangle([[NaN, 0, 0], [4, 0, 0], [0, 3, 0]])), /Non-finite/);
});

test("a successful apply without its earlier matching preview fails provenance", () => {
  const result = evaluateSession({ taskId: "reject-and-correct", baseline: { revision: "before" }, checkpoints: {}, calls: [{ name: "jumpstart_apply_model", sequence: 1, args: { previewId: "missing" }, result: { applied: true } }] });
  assert.equal(result.checks.find((check) => check.name === "preview-before-apply").pass, false);
});

test("tray section checks consume measured solid intervals and require the actual compartment clearances", () => {
  const samples = [
    { axis: "X", intervals: [[0,2],[27,29],[81,83]] },
    { axis: "Y", intervals: [[0,2],[55,57]] },
    { axis: "Z", intervals: [[0,2]] },
    { axis: "Z", intervals: [[0,12]] },
  ];
  const session = { taskId: "offset-tray", baseline: { revision: "before" }, checkpoints: { candidate: { document: { revision: "after", bodies: [] } } }, calls: [{ name: "jumpstart_inspect_geometry", result: { revision: "after", measurements: { samples } } }] };
  let result = evaluateSession(session);
  assert.equal(result.checks.find((check) => check.name === "tray-walls-divider-compartments").pass, true);
  assert.equal(result.checks.find((check) => check.name === "tray-short-axis-walls").pass, true);
  assert.equal(result.checks.find((check) => check.name === "tray-floor-and-height").pass, true);
  samples[0].intervals[1] = [28,30];
  result = evaluateSession(session);
  assert.equal(result.checks.find((check) => check.name === "tray-walls-divider-compartments").pass, false);
});

test("coaster acceptance rejects a claimed pass without measured dimensions and uniform spacing", () => {
  const session = {
    taskId: "coaster-revision", baseline: { revision: "before" },
    checkpoints: { candidate: { document: { revision: "after", bodies: [] } } },
    calls: [{ name: "jumpstart_inspect_geometry", args: { checks: [{ id: "channels", kind: "channels", expected: { count: 9, width: 4, depth: 3 } }] }, result: { revision: "after", checks: [{ id: "channels", pass: true, measured: { count: 9, width: 5, depth: 3, spacings: [10,10,10,10,10,10,10,11] } }] } }],
  };
  const result = evaluateSession(session);
  assert.equal(result.checks.find((check) => check.name === "channel-dimensions-independent").pass, false);
  assert.equal(result.checks.find((check) => check.name === "channel-spacing-uniform").pass, false);
});
