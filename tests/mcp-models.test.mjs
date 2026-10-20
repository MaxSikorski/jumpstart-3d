import test from "node:test";
import assert from "node:assert/strict";
import { compileMcpModel, reviseMcpParameters } from "../src/mcp-models.js";
import { validateToolInput } from "../src/mcp-schema.js";

const doc = () => ({ id: "d1", name: "Untitled", seq: 0, mode: "beginner", bodies: [], sketches: [], planes: [], joints: [] });
const plan = {
  name: "Named coaster", modelId: "coaster", parameters: { diameter: { value: 100, unit: "mm", min: 10, max: 500 }, floor: { value: 3, unit: "mm" }, depth: { value: 3, unit: "mm" }, thickness: { expression: "floor + depth", unit: "mm" } },
  primitives: [{ id: "base", kind: "cylinder", parameters: { w: { $expr: "diameter" }, d: { $expr: "diameter" }, h: { $expr: "thickness" } } }],
};
test("parameter revision survives native serialization, keeps root identities and unrelated bodies", () => {
  const initial = compileMcpModel(doc(), plan);
  const snapshot = JSON.stringify(initial.document);
  const saved = JSON.parse(snapshot);
  saved.bodies[0]._key = "native runtime cache is not a user edit";
  saved.bodies.push({ id: "unrelated", node: { t: "prim", kind: "box", p: { w: 1, d: 1, h: 1 } } });
  const revised = reviseMcpParameters(saved, "coaster", { diameter: 110 });
  assert.equal(revised.document.bodies.length, 2);
  assert.equal(revised.document.bodies[1].node.p.w, 110);
  assert.equal(revised.document.bodies[1].id, initial.document.bodies[0].id);
  assert.deepEqual(revised.document.bodies[0], saved.bodies[1]);
  assert.equal(revised.parameters.thickness.value, 6);
  assert.equal(revised.document.mcpModels[0].template.parameters.diameter.value, 110);
  assert.equal(JSON.stringify(initial.document), snapshot);
  assert.equal(revised.diff.parameters[0].name, "diameter");
});
test("native edits, locked bodies and external dependencies cannot be silently overwritten", () => {
  const built = compileMcpModel(doc(), plan);
  built.document.bodies[0].node.p.h = 9;
  assert.throws(() => reviseMcpParameters(built.document, "coaster", { diameter: 110 }), /outside/);
  const fresh = compileMcpModel(doc(), plan);
  fresh.document.bodies.push({ id: "mirror", node: { t: "mirror", srcBody: fresh.createdBodyIds[0] } });
  assert.throws(() => reviseMcpParameters(fresh.document, "coaster", { diameter: 110 }), /depends/);
});
test("runtime tool schema rejects unknown keys, nonfinite values and excessive arrays", () => {
  const schema = { type: "object", additionalProperties: false, required: ["value"], properties: { value: { oneOf: [{ type: "number", minimum: 0 }, { type: "object", additionalProperties: false, required: ["$expr"], properties: { $expr: { type: "string", maxLength: 32 } } }] } } };
  validateToolInput({ value: { $expr: "diameter / 2" } }, schema);
  for (const value of [{ value: NaN }, { value: -1 }, { value: 1, unexpected: true }, {}, JSON.parse('{"value":1,"__proto__":{}}')]) assert.throws(() => validateToolInput(value, schema));
});
test("unused owned guide sketches do not accumulate across parameter revisions", () => {
  const withGuide = { ...structuredClone(plan), sketches: [{ id: "guide", plane: "XY", origin: [0, 0, 0], profile: { type: "circle", center: [0, 0], radius: { $expr: "diameter / 2" } } }] };
  const initial = compileMcpModel(doc(), withGuide);
  const second = reviseMcpParameters(initial.document, "coaster", { diameter: 110 });
  const third = reviseMcpParameters(second.document, "coaster", { diameter: 120 });
  assert.equal(third.document.sketches.length, 1);
  assert.equal(third.document.mcpModels[0].sketchIds.length, 1);
});
test("parameter plans cannot consume external bodies, including locked group members", () => {
  const d = doc();
  d.bodies.push({ id: "external", name: "Existing", m: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], node: { t: "prim", kind: "box", p: { w: 1, d: 1, h: 1 }, mods: [] } });
  const grouped = { ...structuredClone(plan), operations: [{ id: "combined", type: "group", members: ["base", "external"] }] };
  assert.throws(() => compileMcpModel(d, grouped), /own their bodies/);
  d.bodies[0].locked = true;
  const { parameters, ...plain } = grouped;
  plain.primitives = [{ id: "base", kind: "box", parameters: { w: 2, d: 2, h: 2 } }];
  assert.throws(() => compileMcpModel(d, plain), /Unlock/);
});
