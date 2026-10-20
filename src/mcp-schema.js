// The subset of JSON Schema used by the local tool contracts. Unknown input fails closed.
export function validateToolInput(value, schema, path = "arguments") {
  const fail = (message) => { throw new Error(`${path}: ${message}`); };
  if (schema.oneOf || schema.anyOf) {
    const candidates = schema.oneOf || schema.anyOf;
    const passed = candidates.filter((candidate) => {
      try { validateToolInput(value, candidate, path); return true; } catch { return false; }
    });
    if (!passed.length || (schema.oneOf && passed.length !== 1)) fail("does not match an allowed input shape");
    return;
  }
  if (schema.const !== undefined && value !== schema.const) fail(`must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("reserved property");
      const child = schema.properties?.[key];
      if (!child && schema.additionalProperties === false) fail(`unknown property ${key}`);
      if (child || typeof schema.additionalProperties === "object") validateToolInput(value[key], child || schema.additionalProperties, `${path}.${key}`);
    }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    if (Object.keys(value).length < (schema.minProperties ?? 0) || Object.keys(value).length > (schema.maxProperties ?? Infinity)) fail("property count outside limits");
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail("item count outside limits");
    for (let i = 0; i < value.length; i++) validateToolInput(value[i], schema.items || {}, `${path}[${i}]`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) fail(`must be a finite ${schema.type}`);
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity)) fail("number outside limits");
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail("string outside limits");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("invalid string format");
  } else if (schema.type === "boolean" && typeof value !== "boolean") fail("must be a boolean");
}
