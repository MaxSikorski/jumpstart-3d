import { test } from 'node:test';
import assert from 'node:assert/strict';
import { show } from '../src/teach.js';
test('formats values safely and briefly', () => {
  assert.equal(show('hi\n"'), '"hi\\n\\""');
  assert.equal(show('x'.repeat(100)).length, 60);
  assert.equal(show({a: 1}), '{"a":1}');
  assert.equal(show([1, 2]), '[1,2]');
  assert.equal(show([, 1, , undefined]), '[<empty>,1,<empty>,undefined]');
  assert.equal(show([-0, NaN, Infinity, -Infinity]), '[-0,NaN,Infinity,-Infinity]');
  const cycle = {}; cycle.self = cycle;
  assert.equal(show(cycle), '{"self":[Circular]}');
  assert.equal(show({a:{b:{c:{d:1}}}}), '{"a":{"b":{"c":…}}}');
  assert.equal(show(123n), '123n');
  assert.equal(show(Symbol('hi')), 'Symbol(hi)');
  assert.equal(show(new Map([[1, 2]])), 'Map(1)');
  assert.equal(show(new Set([1, 2])), 'Set(2)');
  assert.equal(show(new (class Thing {})()), 'Thing');
  assert.equal(show(() => {}), 'function');
  assert.equal(show(undefined), 'undefined');
  let calls = 0; const obj = { toJSON() { calls++; }, get secret() { calls++; } };
  assert.equal(show(obj), '{"toJSON":function,"secret":"[getter]"}');
  assert.equal(calls, 0);
  assert.doesNotThrow(() => show(new Proxy({}, { ownKeys() { throw Error('no'); } })));
});

test('bounds proxy inspection and shows array holes', () => {
  let calls = 0; const target = Object.fromEntries(Array.from({length:10000}, (_, i) => ['k'+i, i]));
  const p = new Proxy(target, {ownKeys(t) { calls++; return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t,k) { calls++; return Reflect.getOwnPropertyDescriptor(t,k); }, getPrototypeOf(t) { calls++; return Reflect.getPrototypeOf(t); }});
  show(p); assert.ok(calls <= 10, String(calls));
  assert.doesNotThrow(() => show(new Proxy({}, {getPrototypeOf() { throw Error('no'); }})));
  assert.equal(show(Array(1)), '[<empty>]'); assert.equal(show(Array(2)), '[<empty>,<empty>]');
  const a = [1]; Object.defineProperty(a, '0', {value: 7, enumerable: false}); assert.equal(show(a), '[7]');
  assert.match(show(Array(1000)), /length 1000/);
});
