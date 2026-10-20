import test from "node:test";
import assert from "node:assert/strict";
import { buildModelPlan, normalizeModelPlan, resizeBodyDocument } from "../browser/model-plan.js";

function doc() {
  return { id: "doc-1", name: "Untitled", mode: "beginner", seq: 0, sketches: [], bodies: [], planes: [], joints: [] };
}

function ids() {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

test("compiles a dimensioned revolve into the native sketch and feature model", () => {
  const result = buildModelPlan(doc(), {
    name: "Lid ring",
    sketches: [{ id: "wall", plane: "XZ", origin: [0, 0, 0], profile: { type: "polygon", points: [[45.5, 0], [49.5, 0], [49.5, 5.5], [45.5, 5.5]] } }],
    features: [{ id: "ring", type: "revolve", sketch: "wall", axis: "Z" }],
  }, ids());

  assert.equal(result.document.mode, "advanced");
  assert.equal(result.document.name, "Lid ring");
  assert.equal(result.document.sketches[0].plane.n.join(","), "0,-1,0");
  assert.deepEqual(result.document.bodies[0].node, {
    t: "revolve", sketch: result.document.sketches[0].id,
    profiles: [{ key: result.document.sketches[0].ents.map((e) => e.id).sort().join(","), pt: [0, 0] }],
    mods: [], axis: "Z", angle: 360,
  });
  assert.deepEqual(result.affectedBodyIds, result.createdBodyIds);
});

test("compiles patterned extrude cutters into one native boolean feature", () => {
  const result = buildModelPlan(doc(), {
    name: "Lock test",
    sketches: [
      { id: "base", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 49.5 } },
      { id: "slot", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[45, -2], [52, -2], [52, 2], [45, 2]] } },
    ],
    features: [
      { id: "plate", type: "extrude", sketch: "base", distance: 2.4 },
      { id: "locks", type: "extrude", sketch: "slot", distance: 2.4, operation: "cut", target: "plate", pattern: { axis: "Z", count: 2 } },
    ],
  }, ids());

  assert.equal(result.document.bodies.length, 1);
  const [body] = result.document.bodies;
  assert.equal(body.node.mods[0].op, "cut");
  assert.equal(body.node.mods[0].tool.t, "group");
  assert.equal(body.node.mods[0].tool.children.length, 2);
  assert.ok(Math.abs(body.node.mods[0].tool.children[1].m[0] + 1) < 1e-10);
  assert.deepEqual(result.featureBodyIds, { plate: body.id, locks: body.id });
});

test("replacing a generated body keeps unrelated document state and drops unused source sketches", () => {
  const current = doc();
  current.sketches = [
    { id: "old-sketch", name: "Old", pts: [], ents: [] },
    { id: "other-sketch", name: "Other", pts: [], ents: [] },
  ];
  current.bodies = [
    { id: "old-body", name: "Old", node: { t: "revolve", sketch: "old-sketch", mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    { id: "other-body", name: "Other", node: { t: "revolve", sketch: "other-sketch", mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ];
  const result = buildModelPlan(current, {
    name: "Updated lid",
    sketches: [{ id: "new", plane: "XZ", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, 0], [12, 0], [12, 2], [0, 2]] } }],
    features: [{ id: "new-body", type: "revolve", sketch: "new" }],
  }, ids(), ["old-body"]);

  assert.equal(result.document.bodies.some((body) => body.id === "old-body"), false);
  assert.equal(result.document.bodies.some((body) => body.id === "other-body"), true);
  assert.equal(result.document.sketches.some((sketch) => sketch.id === "old-sketch"), false);
  assert.equal(result.document.sketches.some((sketch) => sketch.id === "other-sketch"), true);
});

test("rejects unsafe or ambiguous model plans before they reach the editor", () => {
  const bad = {
    name: "Bad",
    sketches: [{ id: "cross", plane: "XY", origin: [0, 0, 0], profile: { type: "polygon", points: [[0, 0], [5, 5], [0, 5], [5, 0]] } }],
    features: [{ id: "body", type: "extrude", sketch: "cross", distance: 2 }],
  };
  assert.throws(() => normalizeModelPlan(bad), /self-intersects|zero area/);
  assert.throws(() => normalizeModelPlan({ ...bad, sketches: [{ ...bad.sketches[0], profile: { type: "circle", center: [0, 0], radius: Infinity } }] }), /finite number/);
  const valid = { ...bad, sketches: [{ ...bad.sketches[0], profile: { type: "circle", center: [0, 0], radius: 5 } }] };
  assert.throws(() => normalizeModelPlan({ ...valid, features: [{ ...bad.features[0], operation: "cut", target: "missing" }] }), /earlier body/);
});

test("revises the imported yogurt-lid STL size while preserving its mesh and bottom anchor", () => {
  const current = doc();
  current.bodies = [{ id: "imported-lid", name: "yogurt_lid_M.stl", seq: 1, locked: false, m: [], node: { t: "mesh", asset: "yogurt_lid_M.stl", keepPos: true, mods: [] } }];
  const result = resizeBodyDocument(current, "imported-lid", { min: [-49.5, -49.5, 0], max: [49.5, 49.5, 5.5] }, { x: 100, y: 100 }, "base", ids());
  const body = result.document.bodies[0];
  assert.deepEqual(result.currentSize, [99, 99, 5.5]);
  assert.deepEqual(result.targetSize, [100, 100, 5.5]);
  assert.equal(body.node.t, "mesh");
  assert.equal(body.node.asset, "yogurt_lid_M.stl");
  assert.equal(body.node.mods[0].t, "scale");
  assert.ok(Math.abs(body.node.mods[0].k[0] - 100 / 99) < 1e-8);
  assert.ok(Math.abs(body.node.mods[0].k[1] - 100 / 99) < 1e-8);
  assert.deepEqual(body.node.mods[0].o, [0, 0, 0]);
  assert.equal(current.bodies[0].node.mods.length, 0);

  const revised = resizeBodyDocument(result.document, "imported-lid", { min: [-50, -50, 0], max: [50, 50, 5.5] }, { x: 95, y: 95 }, "base", ids());
  assert.ok(Math.abs(revised.document.bodies[0].node.mods[0].k[0] - 95 / 99) < 1e-8);
  assert.ok(Math.abs(revised.document.bodies[0].node.mods[0].k[1] - 95 / 99) < 1e-8);
  assert.equal(revised.document.bodies[0].node.asset, "yogurt_lid_M.stl");
  assert.equal(result.document.bodies[0].node.mods[0].k[0], body.node.mods[0].k[0]);
});

test("rejects locked bodies, unknown axes, and invalid requested sizes", () => {
  const current = doc();
  current.bodies = [{ id: "locked", name: "Locked", locked: true, node: { t: "mesh", mods: [] } }];
  const bounds = { min: [0, 0, 0], max: [10, 20, 5] };
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { x: 11 }), /Unlock/);
  current.bodies[0].locked = false;
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { width: 11 }), /x, y, or z/);
  assert.throws(() => resizeBodyDocument(current, "locked", bounds, { x: 0 }), /finite number/);
});

test("builds typed primitives, transforms, linear patterns, and cut groups", () => {
  const result = buildModelPlan(doc(), {
    name: "Tutorial keychain",
    primitives: [
      { id: "tag", kind: "box", parameters: { w: 60, d: 25, h: 4, r: 1.5 } },
      { id: "name", kind: "text", parameters: { text: "Mia", size: 9, h: 2 }, position: [5, 0, 4] },
      { id: "hole", kind: "cylinder", parameters: { w: 6, d: 6, h: 10 }, position: [-24, 0, -2], hole: true },
    ],
    operations: [{ id: "finished", type: "group", members: ["tag", "name", "hole"], operation: "union" }],
  }, ids());
  assert.equal(result.document.mode, "beginner");
  assert.equal(result.document.bodies.length, 1);
  assert.equal(result.document.bodies[0].node.t, "group");
  assert.equal(result.document.bodies[0].node.children.length, 3);
  assert.equal(result.document.bodies[0].node.children.filter((child) => child.hole).length, 1);
  assert.equal(result.document.bodies[0].node.children.find((child) => child.node.kind === "text").node.p.size, 9);
  assert.equal(result.createdBodyIds.length, 1);

  const patterned = buildModelPlan(doc(), {
    name: "Drainage channels",
    primitives: [{ id: "channel", kind: "box", parameters: { w: 110, d: 4, h: 4 }, position: [0, 0, 3], hole: true }],
    operations: [{ id: "row", type: "pattern", source: "channel", mode: "linear", axis: "Y", count: 4, spacing: 14, symmetric: true }],
  }, ids());
  assert.equal(patterned.document.bodies.length, 7);
  assert.equal(patterned.document.bodies.filter((body) => body.hole).length, 7);

  const partialCircular = buildModelPlan(doc(), {
    name: "Partial circular pattern",
    primitives: [{ id: "source", kind: "box", parameters: { w: 2, d: 2, h: 2 }, position: [10, 0, 0] }],
    operations: [{ id: "copies", type: "pattern", source: "source", mode: "circular", axis: "Z", count: 4, angle: 135, origin: [0, 0, 0] }],
  }, ids());
  const positions = partialCircular.document.bodies.map((body) => body.m.slice(12, 15));
  assert.equal(positions.length, 4);
  assert.ok(Math.abs(positions[3][0] + Math.sqrt(50)) < 1e-8);
  assert.ok(Math.abs(positions[3][1] - Math.sqrt(50)) < 1e-8);
});

test("builds native loft, shell, thread, and emboss features from validated plan operations", () => {
  const result = buildModelPlan(doc(), {
    name: "Tutorial vase",
    sketches: [
      { id: "base", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: 15 } },
      { id: "mid", plane: "XY", origin: [0, 0, 40], profile: { type: "circle", center: [0, 0], radius: 22.5 } },
      { id: "top", plane: "XY", origin: [0, 0, 80], profile: { type: "circle", center: [0, 0], radius: 12.5 } },
    ],
    planes: [{ id: "plane-1", plane: "XY", origin: [0, 0, 40] }, { id: "plane-2", plane: "XY", origin: [0, 0, 80] }],
    features: [{ id: "body", type: "loft", sections: ["base", "mid", "top"] }],
    operations: [{ id: "hollow", type: "modifier", target: "body", modifier: { type: "shell", thickness: 2, faces: [] } }],
  }, ids());
  assert.equal(result.document.planes.length, 2);
  assert.equal(result.document.bodies[0].node.t, "loft");
  assert.equal(result.document.bodies[0].node.sections.length, 3);
  assert.equal(result.document.bodies[0].node.mods[0].t, "shell");
  assert.equal(result.document.bodies[0].node.mods[0].th, 2);

  const detailed = buildModelPlan(doc(), {
    name: "Marked body",
    primitives: [{ id: "body", kind: "cylinder", parameters: { w: 20, d: 20, h: 10 } }],
    operations: [
      { id: "thread", type: "modifier", target: "body", modifier: { type: "thread", face: { c: [0, 0, 5], t: "CYLINDRE" }, pitch: 1, length: 0 } },
      { id: "label", type: "modifier", target: "body", modifier: { type: "emboss", geo: { kind: "plane", p: [0, 0, 10], n: [0, 0, 1], x: [1, 0, 0] }, text: "M3", size: 5, depth: 0.6 } },
    ],
  }, ids());
  assert.deepEqual(detailed.document.bodies[0].node.mods.map((mod) => mod.t), ["thread", "emboss"]);
});

test("adds typed modifiers to an existing body without replacing its source geometry", () => {
  const current = doc();
  current.mode = "advanced";
  current.bodies = [{ id: "imported", name: "Imported mesh", locked: false, hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "mesh", asset: "source-asset", keepPos: true, mods: [] } }];
  const result = buildModelPlan(current, {
    name: "Imported mesh updated",
    operations: [{ id: "new-scale", type: "modifier", target: "imported", modifier: { type: "scale", factors: [1.1, 1.1, 1], offset: [0, 0, 0] } }],
  }, ids());
  assert.equal(result.document.mode, "advanced");
  assert.equal(result.document.bodies[0].node.t, "mesh");
  assert.equal(result.document.bodies[0].node.asset, "source-asset");
  assert.equal(result.document.bodies[0].node.mods[0].t, "scale");
  assert.deepEqual(result.createdBodyIds, []);
  assert.deepEqual(result.affectedBodyIds, ["imported"]);
});

test("rejects unsupported plan fields and ambiguous modifier inputs", () => {
  assert.throws(() => normalizeModelPlan({ name: "Bad", python: "run me", primitives: [{ id: "b", kind: "box" }] }), /not supported/);
  assert.throws(() => normalizeModelPlan({ name: "Bad", primitives: [{ id: "b", kind: "box", hole: "yes" }] }), /hole must be a boolean/);
  assert.throws(() => normalizeModelPlan({
    name: "Bad",
    primitives: [{ id: "b", kind: "box" }],
    operations: [{ id: "shell", type: "modifier", target: "b", modifier: { type: "shell", thickness: 2, direction: "sideways", faces: [] } }],
  }), /direction must be in, out, or both/);
});
