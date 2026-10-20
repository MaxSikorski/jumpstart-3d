const number = { type: "number", minimum: -10000, maximum: 10000 };
const positive = { type: "number", exclusiveMinimum: 0, maximum: 10000 };
const tolerance = { type: "number", minimum: 0.00000001, maximum: 1 };
const id = { type: "string", minLength: 1, maxLength: 120 };
const axis = { type: "string", enum: ["X", "Y", "Z"] };
const editorId = id;
const expectedRevision = id;
const point = { type: "array", minItems: 3, maxItems: 3, items: number };
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const section = object({ axis, offset: number, flip: { type: "boolean" } }, ["axis", "offset"]);
const expr = object({ $expr: { type: "string", minLength: 1, maxLength: 256 } }, ["$expr"]);
function references(schema) {
  if (schema.type === "number" || schema.type === "integer") return { oneOf: [schema, expr] };
  const result = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, references(value)]));
  if (schema.items) result.items = references(schema.items);
  if (schema.oneOf) result.oneOf = schema.oneOf.map(references);
  return result;
}

export function extendMcpTools(tools, basePlan) {
  const plan = references(basePlan);
  Object.assign(plan.properties, {
    modelId: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
    parameters: { type: "object", minProperties: 1, maxProperties: 64, additionalProperties: object({ value: number, expression: { type: "string", minLength: 1, maxLength: 256 }, unit: { type: "string", enum: ["mm", "deg", "count", "scalar"] }, min: number, max: number }, ["unit"]) },
    constraints: { type: "array", maxItems: 64, items: object({ id, left: { type: "string", maxLength: 256 }, right: { type: "string", maxLength: 256 }, operator: { type: "string", enum: ["gt", "gte", "lt", "lte", "eq"] }, message: { type: "string", maxLength: 256 } }, ["id", "left", "operator", "right"]) },
  });
  for (const tool of tools.filter((entry) => entry.name.startsWith("jumpstart_preview"))) Object.assign(tool.inputSchema.properties, { section, expectedRevision });
  tools.find((entry) => entry.name === "jumpstart_preview_model").inputSchema.properties.plan = plan;
  tools.find((entry) => entry.name === "jumpstart_preview_model").description += " Numeric fields can use {$expr: 'diameter / 2'} with persisted named parameters. Returns top, side and isometric images and optional section image; restores camera and section state.";
  const extra = [
    ["jumpstart_preview_new_document", "Preview a new blank document", "Prepare a fresh native document without discarding the current design. Apply its previewId as one undoable edit; undo restores the previous document. No UI clicks or arbitrary document JSON.", object({ editorId, expectedRevision, name: { type: "string", minLength: 1, maxLength: 80 }, mode: { type: "string", enum: ["beginner", "advanced"] } }, ["expectedRevision"])],
    ["jumpstart_get_capabilities", "Discover modeling and inspection capabilities", "Read exact schemas, limits, examples and unsupported geometry. No document change.", object({})],
    ["jumpstart_preview_parameters", "Preview named parameter revisions", "Regenerate a saved model from independent parameter values. Reject derived overrides, invalid constraints and external native edits. Returns parameter and feature diff; apply with previewId.", object({ editorId, expectedRevision, modelId: id, values: { type: "object", minProperties: 1, maxProperties: 64, additionalProperties: number }, includeImage: { type: "boolean" }, section }, ["expectedRevision", "modelId", "values"])],
    ["jumpstart_inspect_geometry", "Measure generated geometry", "Measure world-space tessellation independently of submitted CAD parameters: dimensions, plane sections, line/solid intervals, flat parallel channels and mesh checks. Samples are approximate, not physical fit or manufacturing guarantees. A previewId inspects its successful cached geometry without applying it.", object({ editorId, bodyId: id, previewId: id, expectedRevision, tolerance, mesh: { type: "boolean" }, section: object({ axis, offset: number }, ["axis", "offset"]), samples: { type: "array", maxItems: 16, items: object({ axis, point }, ["axis", "point"]) }, checks: { type: "array", maxItems: 8, items: { oneOf: [object({ id, kind: { const: "dimension" }, axis, expected: positive, tolerance }, ["id", "kind", "axis", "expected"]), object({ id, kind: { const: "channels" }, axis: { type: "string", enum: ["X", "Y"] }, crossAt: number, tolerance, expected: object({ count: { type: "integer", minimum: 1, maximum: 24 }, width: positive, depth: positive, floor: positive, spacing: positive, symmetric: { type: "boolean" }, openEnds: { type: "boolean" } }) }, ["id", "kind", "axis", "crossAt", "expected"])] } } }, ["bodyId"])],
    ["jumpstart_select_geometry", "Select native geometry by geometric predicates", "Query body-local native signatures by type, axis, extreme, coordinate, nearby point, plane normal, cylinder radius or external/internal material orientation. Returns candidates and ambiguity; never silently picks. Requires a current revision and rejects stale geometry fingerprints.", object({ editorId, bodyId: id, previewId: id, expectedRevision, expectedFingerprint: id, query: object({ kind: { type: "string", enum: ["edge", "face"] }, type: { type: "string", maxLength: 30 }, axis, extreme: { type: "string", enum: ["min", "max"] }, coordinate: number, near: point, tolerance, unique: { type: "boolean" }, external: { type: "boolean" }, radius: positive, normal: point }, ["kind"]) }, ["bodyId", "expectedRevision", "expectedFingerprint", "query"])],
    ["jumpstart_save_document", "Save the current local project", "Save the exact native document and parameter templates in browser-local project storage. No remote upload or version bump. Reject stale revisions or failed storage writes.", object({ editorId, expectedRevision }, ["expectedRevision"])],
    ["jumpstart_reopen_document", "Reopen the current saved local project", "Read the current project's saved local document through native serialization and restore it as a recoverable edit. Requires the same document id and current revision; retains undo history. Does not open arbitrary projects or accept arbitrary document JSON.", object({ editorId, expectedRevision, documentId: id }, ["expectedRevision", "documentId"])],
  ].map(([name, title, description, inputSchema]) => ({ name, title, description, inputSchema }));
  return [...tools, ...extra];
}
