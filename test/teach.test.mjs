import { test } from 'node:test';
import assert from 'node:assert/strict';
import { show } from '../src/teach.js';
test('formats values safely and briefly', () => {
  assert.equal(show('hi'), '"hi"');
  assert.equal(show('x'.repeat(100)).length, 60);
  assert.equal(show({a: 1}), '{"a":1}');
  assert.equal(show([1, 2]), '[1,2]');
  const cycle = {}; cycle.self = cycle;
  assert.equal(show(cycle), 'object');
  assert.equal(show(1n), 'bigint');
  assert.equal(show(() => {}), 'function');
  assert.equal(show(undefined), 'undefined');
  assert.equal(show(NaN), 'NaN');
});
