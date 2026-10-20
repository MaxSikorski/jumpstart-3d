import { buildModelPlan, normalizeModelPlan } from "./mcp-plan.js";
import { resolveParametricPlan } from "./mcp-parameters.js";

const copy = (value) => structuredClone(value);
const generatedId = (prefix) => `${prefix}${globalThis.crypto.randomUUID()}`;
const state = (doc, ids, key) => JSON.stringify(doc[key].filter((entry) => ids.includes(entry.id)), (name, value) => ["_key", "cmdPreview", "cutPreview"].includes(name) ? undefined : value);

export function compileMcpModel(document, rawPlan, replaceBodyIds = [], options = {}) {
  const { modelId: requestedId, ...template } = rawPlan;
  const resolved = resolveParametricPlan(template, options.values || {});
  const previous = options.previous;
  if (previous) {
    if (state(document, previous.bodyIds, "bodies") !== previous.bodyState || state(document, previous.sketchIds, "sketches") !== previous.sketchState || state(document, previous.planeIds, "planes") !== previous.planeState) {
      throw new Error("The model was edited outside its saved parameter plan; reconcile native edits before regenerating parameters");
    }
    replaceBodyIds = previous.bodyIds;
  }
  const modelId = previous?.id || requestedId || generatedId("model-");
  if (template.parameters && (typeof modelId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(modelId))) throw new Error("modelId must contain 1 to 80 letters, digits, underscores, or hyphens");
  if (!previous && template.parameters && document.mcpModels?.some((model) => model.id === modelId)) throw new Error("modelId already exists; revise its parameters instead");
  const input = copy(document);
  if (previous) {
    // A parametric record owns its sketches and planes. Reject external dependencies.
    const unrelated = input.bodies.filter((body) => !previous.bodyIds.includes(body.id));
    for (const entry of [...previous.sketchIds, ...previous.planeIds, ...previous.bodyIds]) {
      if (unrelated.some((body) => JSON.stringify(body.node).includes(JSON.stringify(entry)))) throw new Error("Another body depends on this model; parameter regeneration would invalidate it");
    }
    input.planes = input.planes.filter((plane) => !previous.planeIds.includes(plane.id));
    input.sketches = input.sketches.filter((sketch) => !previous.sketchIds.includes(sketch.id));
  }
  const plan = normalizeModelPlan(resolved.plan, input.bodies.map((body) => body.id), input.mode);
  const compiled = buildModelPlan(input, plan, undefined, replaceBodyIds, true);
  const changedExisting = input.bodies.filter((body) => !replaceBodyIds.includes(body.id) && state(input, [body.id], "bodies") !== state(compiled.document, [body.id], "bodies"));
  if (changedExisting.some((body) => body.locked)) throw new Error("Unlock every affected body before editing it");
  if (template.parameters) {
    if (changedExisting.length) throw new Error("Named parameter models must own their bodies; external body edits require a separate plan");
    if ((input.mcpModels?.length || 0) >= 16 && !previous) throw new Error("At most 16 saved parameter models are supported");
    // Keep final body identities stable for existing selections and references.
    if (previous) {
      const remap = new Map();
      for (const [feature, ids] of Object.entries(compiled.featureBodyIds)) {
        const old = previous.featureBodyIds[feature];
        if (typeof ids === "string" && typeof old === "string" && previous.bodyIds.includes(old) && compiled.createdBodyIds.includes(ids)) remap.set(ids, old);
      }
      for (const body of compiled.document.bodies) if (remap.has(body.id)) body.id = remap.get(body.id);
      for (const key of ["createdBodyIds", "affectedBodyIds"]) compiled[key] = compiled[key].map((id) => remap.get(id) || id);
      for (const [feature, ids] of Object.entries(compiled.featureBodyIds)) compiled.featureBodyIds[feature] = Array.isArray(ids) ? ids.map((id) => remap.get(id) || id) : remap.get(ids) || ids;
    }
    const sketchIds = compiled.document.sketches.filter((entry) => !input.sketches.some((old) => old.id === entry.id)).map((entry) => entry.id);
    const planeIds = compiled.document.planes.filter((entry) => !input.planes.some((old) => old.id === entry.id)).map((entry) => entry.id);
    const record = {
      id: modelId, version: 1, template: resolved.template, parameters: resolved.parameters,
      bodyIds: compiled.createdBodyIds, sketchIds, planeIds, featureBodyIds: compiled.featureBodyIds,
      bodyState: state(compiled.document, compiled.createdBodyIds, "bodies"),
      sketchState: state(compiled.document, sketchIds, "sketches"), planeState: state(compiled.document, planeIds, "planes"),
    };
    compiled.document.mcpModels = (compiled.document.mcpModels || []).filter((model) => model.id !== modelId && !model.bodyIds.some((id) => replaceBodyIds.includes(id)));
    compiled.document.mcpModels.push(record);
    compiled.modelId = modelId;
    compiled.parameters = resolved.parameters;
    compiled.diff = {
      parameters: Object.entries(resolved.parameters).filter(([name, value]) => JSON.stringify(previous?.parameters?.[name]) !== JSON.stringify(value)).map(([name, value]) => ({ name, before: previous?.parameters?.[name] ?? null, after: value })),
      features: ["primitives", "sketches", "features", "operations", "planes"].flatMap((kind) => {
        const before = previous ? resolveParametricPlan(previous.template).plan[kind] || [] : [];
        const after = resolved.plan[kind] || [];
        return [...new Set([...before, ...after].map((entry) => entry.id))].flatMap((id) => {
          const a = before.find((entry) => entry.id === id), b = after.find((entry) => entry.id === id);
          return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ kind, id, change: !a ? "added" : !b ? "removed" : "changed" }];
        });
      }),
    };
  } else {
    compiled.document.mcpModels = (compiled.document.mcpModels || []).filter((model) => !model.bodyIds.some((id) => replaceBodyIds.includes(id) || compiled.affectedBodyIds.includes(id) || !compiled.document.bodies.some((body) => body.id === id)));
  }
  return { ...compiled, plan };
}

export function reviseMcpParameters(document, modelId, values) {
  const previous = document.mcpModels?.find((model) => model.id === modelId);
  if (!previous || previous.version !== 1) throw new Error("Unknown or unsupported saved parameter model");
  return compileMcpModel(document, previous.template, [], { previous, values });
}
