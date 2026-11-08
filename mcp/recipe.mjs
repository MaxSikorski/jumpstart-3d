// Recipes: a design as data. { "jumpstart": "recipe", "version": 1, "steps": [ { "call", "args", "as" } ] }.
// Pure functions only (no browser), so the node unit test can reach them; cli.mjs runs the steps.
export const MAX_STEPS = 2000;
export const MAX_BYTES = 5 * 1024 * 1024;
export const REFUSED = ["run", "codeCad", "connect", "disconnect", "load", "newDesign"]; // code, links and whole-design swaps: recipes are data, not code

const REF = /^\$([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/;

// Replaces every string that is exactly "$name" or "$name.key" (anywhere in nested arrays and objects) by an earlier step's
// saved result: an object with an id gives that id for "$name"; "$name.key" gives the field. Other strings stay as they are.
export function substitute(value, vars) {
  if (typeof value === "string") {
    const m = REF.exec(value);
    if (!m) return value;
    const [, name, key] = m;
    if (!Object.hasOwn(vars, name)) throw new Error(`${value}: no earlier step saved a result as "${name}"`);
    const v = vars[name];
    if (key === undefined) return v && typeof v === "object" && !Array.isArray(v) && "id" in v ? v.id : v;
    if (!v || typeof v !== "object" || !Object.hasOwn(v, key)) throw new Error(`${value}: the result saved as "${name}" has no "${key}"`);
    return v[key];
  }
  if (Array.isArray(value)) return value.map((x) => substitute(x, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, substitute(x, vars)]));
  return value;
}

export const isRecipe = (d) => !!d && typeof d === "object" && d.jumpstart === "recipe";

// Checks the shape of a recipe before any browser starts; throws a plain message naming the step.
export function checkRecipe(r) {
  if (r.version !== 1) throw new Error(`recipe version must be 1, not ${JSON.stringify(r.version)}`);
  if (!Array.isArray(r.steps)) throw new Error('a recipe needs "steps": an array');
  if (r.steps.length > MAX_STEPS) throw new Error(`a recipe has at most ${MAX_STEPS} steps, this one has ${r.steps.length}`);
  r.steps.forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== "object" || typeof s.call !== "string" || !s.call) throw new Error(`step ${n}: needs a "call" (a JS3D call name)`);
    if (REFUSED.includes(s.call)) throw new Error(`step ${n} (${s.call}): recipes cannot use ${s.call}; they are data, not code`);
    if (s.args !== undefined && !Array.isArray(s.args)) throw new Error(`step ${n} (${s.call}): "args" must be an array`);
    if (s.as !== undefined && !(typeof s.as === "string" && /^[A-Za-z_]\w*$/.test(s.as))) throw new Error(`step ${n} (${s.call}): "as" must be a plain name such as "box"`);
  });
  return r;
}
