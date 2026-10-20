import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveParametricPlan, evaluateParameterExpression } from '../shared/parameters.js';
const template = () => ({
  parameters: {
    diameter: { value: 100, unit: 'mm', min: 10, max: 200 },
    radius: { expression: 'diameter / 2', unit: 'mm' },
    channels: { value: 7, unit: 'count', min: 1, max: 30 },
    depth: { value: 3, unit: 'mm' },
    thickness: { value: 6, unit: 'mm' },
  },
  constraints: [{ id: 'floor', left: 'thickness - depth', operator: 'gte', right: '2', message: 'floor too thin' }],
  operations: [{ type: 'cylinder', radius: { $expr: 'radius' }, count: { $expr: 'channels' } }],
});
test('arithmetic precedence, unary signs, exponent notation and parentheses', () => {
  assert.equal(evaluateParameterExpression('-2 * (3 + 4) + 1e2 / 2', () => 0), 36);
  assert.equal(evaluateParameterExpression('8 / 2 / 2', () => 0), 2);
});
test('resolves dependent parameters and persisted override revisions without mutating source', () => {
  const input = template();
  const result = resolveParametricPlan(input, { diameter: 110, channels: 9 });
  assert.equal(result.plan.operations[0].radius, 55);
  assert.equal(result.plan.operations[0].count, 9);
  assert.equal(result.parameters.radius.value, 55);
  assert.equal(input.parameters.diameter.value, 100);
  assert.equal(result.template.parameters.diameter.value, 110);
  assert.deepEqual(resolveParametricPlan(JSON.parse(JSON.stringify(result.template))).plan, result.plan);
  assert.equal(result.plan.parameters, undefined);
});
test('rejects unknown, derived and invalid overrides', () => {
  for (const values of [{ unknown: 1 }, { radius: 1 }, { diameter: 999 }, { channels: 2.5 }, { depth: Infinity }]) {
    assert.throws(() => resolveParametricPlan(template(), values));
  }
});
test('rejects cycles, missing dependencies and false constraints', () => {
  const cyclic = template(); cyclic.parameters.diameter = { expression: 'radius * 2', unit: 'mm' };
  assert.throws(() => resolveParametricPlan(cyclic), /cycle/);
  const missing = template(); missing.parameters.radius.expression = 'unknown';
  assert.throws(() => resolveParametricPlan(missing), /unknown reference/);
  assert.throws(() => resolveParametricPlan(template(), { depth: 5 }), /floor too thin/);
});
test('rejects arbitrary JavaScript, prototype keys and expression resource abuse', () => {
  for (const expression of ['globalThis.process.exit()', 'diameter.constructor', '1 / 0', '2 ** 4', '1;2', 'Math.sin(2)', '('.repeat(40) + '1' + ')'.repeat(40), '1'.repeat(257)]) {
    assert.throws(() => evaluateParameterExpression(expression, () => 2));
  }
  assert.throws(() => resolveParametricPlan(JSON.parse('{"parameters":{"__proto__":{"value":1,"unit":"mm"}}}')));
  assert.throws(() => resolveParametricPlan({ operations: [{ constructor: 'bad' }] }));
  assert.throws(() => resolveParametricPlan({ parameters: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, { value: 1, unit: 'scalar' }])) }));
});
test('rejects malformed parameter definitions and plan expression objects', () => {
  for (const definition of [{ value: 2, expression: '1', unit: 'mm' }, { value: 2, unit: 'inch' }, { value: 2, unit: 'mm', min: 5, max: 1 }]) {
    assert.throws(() => resolveParametricPlan({ parameters: { x: definition } }));
  }
  assert.throws(() => resolveParametricPlan({ operations: [{ $expr: '1', extra: 2 }] }));
  assert.throws(() => resolveParametricPlan({ constraints: [{ id: 'x', left: '1', operator: 'constructor', right: '2' }] }));
});
