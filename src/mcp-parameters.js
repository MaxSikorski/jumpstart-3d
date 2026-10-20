/** Bounded arithmetic parameters. Units are labels; dimensional algebra is not inferred. */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const UNITS = new Set(['mm', 'deg', 'count', 'scalar']);
function fail(message) { throw new Error(`Invalid parameters: ${message}`); }
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) fail('numbers must be finite and within +/-1e9');
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  for (const key of Object.keys(value)) if (FORBIDDEN.has(key)) fail(`forbidden key ${key}`);
}
function keys(value, allowed) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown field ${key}`); }
export function evaluateParameterExpression(source, lookup) {
  if (typeof source !== 'string' || !source.length || source.length > 256) fail('expression must contain 1 to 256 characters');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g) || [];
  if (tokens.length > 128) fail('expression exceeds token limit');
  let index = 0;
  function expr(depth, precedence = 0) {
    if (depth > 32) fail('expression exceeds nesting limit');
    let token = tokens[index++], value;
    if (token === '+' || token === '-') value = (token === '-' ? -1 : 1) * expr(depth + 1, 3);
    else if (token === '(') { value = expr(depth + 1); if (tokens[index++] !== ')') fail('missing closing parenthesis'); }
    else if (token && /^(?:\d|\.)/.test(token)) value = number(Number(token));
    else if (token && NAME.test(token) && !FORBIDDEN.has(token)) value = number(lookup(token));
    else fail(`unexpected expression token ${token ?? 'end'}`);
    for (;;) {
      const op = tokens[index], p = op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : 0;
      if (!p || p <= precedence) break;
      index++;
      const right = expr(depth + 1, p);
      value = number(op === '+' ? value + right : op === '-' ? value - right : op === '*' ? value * right : value / right);
    }
    return number(value);
  }
  const result = expr(0);
  if (index !== tokens.length) fail(`unexpected expression token ${tokens[index]}`);
  return result;
}

/** Resolve a saved template and independent parameter overrides without executing code. */
export function resolveParametricPlan(rawPlan, overrides = {}) {
  object(rawPlan, 'plan'); object(overrides, 'overrides');
  const definitions = rawPlan.parameters ?? {};
  object(definitions, 'parameters');
  if (Object.keys(definitions).length > 64) fail('at most 64 parameters are supported');
  const parameters = Object.create(null), active = new Set();
  for (const [name, definition] of Object.entries(definitions)) {
    if (!NAME.test(name) || FORBIDDEN.has(name)) fail(`invalid name ${name}`);
    object(definition, name); keys(definition, ['value', 'expression', 'unit', 'min', 'max']);
    if (!UNITS.has(definition.unit)) fail(`${name} has invalid unit`);
    if (Object.hasOwn(definition, 'value') === Object.hasOwn(definition, 'expression')) fail(`${name} needs exactly one value or expression`);
    if (Object.hasOwn(definition, 'value')) number(definition.value);
    if (definition.min !== undefined) number(definition.min);
    if (definition.max !== undefined) number(definition.max);
    if (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max) fail(`${name} has inverted bounds`);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(definitions, name)) fail(`unknown override ${name}`);
    if (Object.hasOwn(definitions[name], 'expression')) fail(`${name} is derived and read-only`);
    number(value);
  }
  function resolve(name) {
    if (Object.hasOwn(parameters, name)) return parameters[name].value;
    if (!Object.hasOwn(definitions, name) || FORBIDDEN.has(name)) fail(`unknown reference ${name}`);
    if (active.has(name)) fail(`dependency cycle at ${name}`);
    if (active.size >= 32) fail('dependency depth exceeds 32');
    active.add(name);
    const definition = definitions[name];
    const value = Object.hasOwn(definition, 'expression') ? evaluateParameterExpression(definition.expression, resolve) : Object.hasOwn(overrides, name) ? overrides[name] : definition.value;
    if (definition.unit === 'count' && !Number.isInteger(value)) fail(`${name} must be an integer`);
    if (definition.min !== undefined && value < definition.min || definition.max !== undefined && value > definition.max) fail(`${name} is outside its bounds`);
    parameters[name] = { ...definition, value };
    active.delete(name);
    return value;
  }
  for (const name of Object.keys(definitions)) resolve(name);
  const constraints = rawPlan.constraints ?? [];
  if (!Array.isArray(constraints) || constraints.length > 64) fail('at most 64 constraints are supported');
  const constraintIds = new Set();
  for (const constraint of constraints) {
    object(constraint, 'constraint'); keys(constraint, ['id', 'left', 'operator', 'right', 'message']);
    if (typeof constraint.id !== 'string' || !NAME.test(constraint.id) || constraintIds.has(constraint.id)) fail('constraint id must be unique and valid');
    constraintIds.add(constraint.id);
    if (constraint.message !== undefined && (typeof constraint.message !== 'string' || constraint.message.length > 256)) fail('constraint message exceeds limit');
    const left = evaluateParameterExpression(constraint.left, resolve), right = evaluateParameterExpression(constraint.right, resolve);
    const checks = { gt: () => left > right, gte: () => left >= right, lt: () => left < right, lte: () => left <= right, eq: () => left === right };
    if (!Object.hasOwn(checks, constraint.operator)) fail('invalid constraint operator');
    if (!checks[constraint.operator]()) fail(`constraint ${constraint.id}: ${constraint.message ?? `${left} ${constraint.operator} ${right}`}`);
  }
  let nodes = 0;
  function visit(value, depth) {
    if (++nodes > 50000 || depth > 64) fail('plan exceeds structural limits');
    if (typeof value === 'number') return number(value);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    object(value, 'plan node');
    if (Object.hasOwn(value, '$expr')) { keys(value, ['$expr']); return evaluateParameterExpression(value.$expr, resolve); }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]));
  }
  const template = visitTemplate(rawPlan);
  const { parameters: omittedParameters, constraints: omittedConstraints, ...body } = rawPlan;
  const plan = visit(body, 0);
  // Retain override values in the template so saving/reopening preserves the revision.
  for (const name of Object.keys(overrides)) template.parameters[name].value = overrides[name];
  return { plan, parameters: { ...parameters }, template, constraints: constraints.map(c => ({ ...c })) };
  function visitTemplate(value, depth = 0) {
    if (++nodes > 50000 || depth > 64) fail('template exceeds structural limits');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number') return number(value);
    if (Array.isArray(value)) return value.map(item => visitTemplate(item, depth + 1));
    object(value, 'template node');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visitTemplate(item, depth + 1)]));
  }
}
