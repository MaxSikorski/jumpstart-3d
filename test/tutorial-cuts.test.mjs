import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../third_party/three/build/three.module.js';

// Exercise the actual T method without starting the tutorial UI or the geometry worker.
const source = readFileSync(new URL('../src/tutorials.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('    cuts(g) {'), source.indexOf('    // end jumpstart-3d', source.indexOf('    cuts(g) {')));
const prim = (kind, w, d, h, z = 0, hole = false, extra = {}) => ({
  node: { t: 'prim', kind, p: { w, d, h, ...extra }, mods: [] },
  m: new THREE.Matrix4().makeTranslation(0, 0, z).toArray(), hole,
});
function harness(children, volume) {
  const meshes = new Map();
  const g = { id: 'group', node: { t: 'group', children, mods: [] } };
  const T = { volume: () => volume, hasHole: (g) => g.node.children.some((c) => c.hole) };
  const app = { scene: { kernel: { get: (key) => meshes.get(key) } } };
  Object.assign(T, Function('T', 'app', 'store', 'THREE', 'bodyKey', 'resolveNode', `return ({${method}})`)(T, app, { doc: {} }, THREE, JSON.stringify, (n) => n));
  return { cuts: () => T.cuts(g), cache: (node, volume, min, max) => meshes.set(JSON.stringify(node), { ok: true, mesh: { volume, bbox: { min, max } } }), g };
}

test('community cylinder: missed, below threshold, half overlap, and null volume', () => {
  const children = [prim('box', 40, 40, 8), prim('cylinder', 10, 10, 12, -2, true)];
  const half = 0.5 * Math.PI * 25 * 8;
  assert.equal(harness(children, 12800).cuts(), false);
  assert.equal(harness(children, 12800 - half + 1).cuts(), false);
  assert.equal(harness(children, 12800 - half - 1).cuts(), true);
  for (const v of [null, undefined, NaN]) assert.equal(harness(children, v).cuts(), false);
});

test('actual oval cutter volume and partial height, including no z overlap', () => {
  const solid = prim('box', 40, 40, 8);
  const cutter = prim('cylinder', 10, 6, 12, 6, true);
  const half = Math.PI * 5 * 3; // two mm inside the block, half its removed volume
  assert.equal(harness([solid, cutter], 12800 - half - 0.01).cuts(), true);
  assert.equal(harness([solid, cutter], 12800 - half + 0.01).cuts(), false);
  for (const z of [8, 20, -12, -20]) assert.equal(harness([solid, prim('box', 10, 10, 12, z, true)], 12800).cuts(), false);
});

test('hexagonal holder uses polygon volume, not a rectangular footprint', () => {
  const children = [prim('prism', 80, 80, 100), prim('prism', 72, 72, 100, 4, true)];
  const area = (w) => 6 * w * w * Math.sin(Math.PI / 3) / 8;
  const expected = area(80) * 100, half = area(72) * 96 / 2;
  assert.equal(harness(children, expected).cuts(), false);
  assert.equal(harness(children, expected - half - 1).cuts(), true);
  assert.equal(harness(children, expected - half + 1).cuts(), false);
});

test('star area follows its fitted polygon, with nondefault point count and inner radius', () => {
  const n = 7, k = 0.3;
  const pts = Array.from({ length: 2 * n }, (_, i) => {
    const a = Math.PI / 2 + i * Math.PI / n, r = i % 2 ? k : 1;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const span = (axis) => Math.max(...pts.map(p => p[axis])) - Math.min(...pts.map(p => p[axis]));
  const area = Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2 * 64 * 50 / span(0) / span(1);
  const children = [prim('box', 100, 100, 15), prim('star', 64, 50, 17, -1, true, { points: n, inner: k })];
  const half = area * 15 / 2;
  assert.equal(harness(children, 150000 - half - 1).cuts(), true);
  assert.equal(harness(children, 150000 - half + 1).cuts(), false);
});

test('overlapping solids fall back unless their already-built union is available', () => {
  const children = [prim('box', 20, 20, 10), prim('box', 20, 20, 5), prim('box', 4, 4, 12, -1, true)];
  const h = harness(children, 4000);
  assert.equal(h.cuts(), true, 'unknown union retains the authorized hasHole fallback');
  h.cache({ ...h.g.node, children: children.slice(0, 2), mods: [] }, 4000, [-10, -10, 0], [10, 10, 10]);
  assert.equal(h.cuts(), false, 'cached union proves the cutter missed');
});

test('cached rounded solid and cutter volumes take precedence over dimensions', () => {
  const children = [prim('box', 40, 40, 8, 0, false, { r: 1 }), prim('box', 10, 10, 12, -2, true, { r: 1 })];
  const h = harness(children, 12000);
  h.cache(children[0].node, 12000, [-20, -20, 0], [20, 20, 8]);
  h.cache(children[1].node, 1000, [-5, -5, 0], [5, 5, 12]);
  assert.equal(h.cuts(), false);
});

test('touching solids can be summed, and a hole is required', () => {
  const children = [prim('box', 20, 20, 10), prim('box', 20, 20, 5, 10), prim('box', 4, 4, 17, -1, true)];
  assert.equal(harness(children, 6000).cuts(), false);
  assert.equal(harness(children, 6000 - 240).cuts(), true);
  assert.equal(harness(children.slice(0, 2), 0).cuts(), false);
});
