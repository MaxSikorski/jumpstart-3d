// Face and edge selectors for the Advanced CAD calls (src/cadselect.js): the grammar, the world-frame rules and every error text,
// on hand-built topologies (no browser, no kernel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSelector, selectItems } from '../src/cadselect.js';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
// planes: [type, center, normal, extra]; lines: [a, b]; circles: [center, radius]. An edge belongs to a plane it lies in.
function topo(name, planes, lines, circles = []) {
  const edges = [
    ...lines.map(([a, b], index) => ({ index, type: 'line', center: a.map((v, i) => (v + b[i]) / 2), direction: unit(sub(b, a)), a, b })),
    ...circles.map(([c, r], k) => ({ index: lines.length + k, type: 'circle', center: c, radius: r })),
  ];
  const faces = planes.map(([type, center, normal, extra], index) => ({
    index, type, center, normal, ...extra,
    edges: normal && type === 'plane' ? edges.filter((e) => e.a && [e.a, e.b].every((p) => Math.abs(dot(normal, sub(p, center))) < 1e-9)).map((e) => e.index) : [],
  }));
  return { name, faces, edges };
}
const corners = (x, y, z) => [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
const ring = (x, y, z) => corners(x, y, z).map((p, i, c) => [p, c[(i + 1) % 4]]);
const risers = (x, y, z0, z1) => corners(x, y, 0).map(([a, b]) => [[a, b, z0], [a, b, z1]]);

const box = topo('Box', [
  ['plane', [0, 0, 0], [0, 0, -1]], ['plane', [0, 0, 25], [0, 0, 1]], ['plane', [0, -20, 12.5], [0, -1, 0]],
  ['plane', [0, 20, 12.5], [0, 1, 0]], ['plane', [-30, 0, 12.5], [-1, 0, 0]], ['plane', [30, 0, 12.5], [1, 0, 0]],
], [...ring(30, 20, 0), ...ring(30, 20, 25), ...risers(30, 20, 0, 25)]);

// the box after Shell (2 mm walls, top open): 0 bottom, 1 rim ring (z 25), 2 floor, 3-6 outer walls (front, back, left, right),
// 7-10 inner walls (normals point into the cavity)
const shelled = topo('Case', [
  ['plane', [0, 0, 0], [0, 0, -1]], ['plane', [0, 0, 25], [0, 0, 1]], ['plane', [0, 0, 2], [0, 0, 1]],
  ['plane', [0, -20, 12.5], [0, -1, 0]], ['plane', [0, 20, 12.5], [0, 1, 0]], ['plane', [-30, 0, 12.5], [-1, 0, 0]], ['plane', [30, 0, 12.5], [1, 0, 0]],
  ['plane', [0, -18, 13.5], [0, 1, 0]], ['plane', [0, 18, 13.5], [0, -1, 0]], ['plane', [-28, 0, 13.5], [1, 0, 0]], ['plane', [28, 0, 13.5], [-1, 0, 0]],
], [...ring(30, 20, 0), ...ring(30, 20, 25), ...ring(28, 18, 25), ...ring(28, 18, 2), ...risers(30, 20, 0, 25), ...risers(28, 18, 2, 25)]);

const drilled = topo('Plate', [
  ['plane', [0, 0, 0], [0, 0, -1]], ['plane', [0, 0, 5], [0, 0, 1]], ['cylinder', [0, 0, 2.5], undefined, { hole: true }], ['cylinder', [10, 0, 2.5], undefined, { hole: false }], ['cone', [30, 0, 2.5]],
], [[[-20, -10, 0], [20, -10, 0]]], [[[0, 0, 5], 1.7], [[0, 0, 0], 1.7]]);

const select = (t, s, k = 'face') => selectItems(parseSelector(s, k), t, k);
const edgesOf = (t, s) => select(t, s, 'edge');
const same = (a, b) => assert.deepEqual(a, b);

test('aliases and axis words use world directions', () => {
  same(select(box, 'top'), [1]);
  same(select(box, 'bottom'), [0]);
  same(select(box, 'front'), [2]);
  same(select(box, 'back'), [3]);
  same(select(box, 'left'), [4]);
  same(select(box, 'right'), [5]);
  same(select(box, '>Z'), [1]);
  same(select(box, '<X'), [4]);
  same(select(box, '>Y'), [3]);
});

test('levels: [k] counts groups of equal height, negative from the other end', () => {
  same(select(box, '>Z[1]'), [2, 3, 4, 5]);
  same(select(box, '>Z[2]'), [0]);
  same(select(box, '>Z[3]'), []);
  same(select(box, '>Z[-1]'), select(box, '<Z'));
  same(select(box, 'top[0]'), [1]);
  same(select(shelled, '>Z[1]'), [7, 8, 9, 10]);
  same(select(shelled, '<Z[1]'), [2]);
});

test('parallel, perpendicular and facing', () => {
  same(edgesOf(box, '|Z'), [8, 9, 10, 11]);
  same(edgesOf(box, '#Z'), [0, 1, 2, 3, 4, 5, 6, 7]);
  same(select(box, '#Z'), [2, 3, 4, 5]);
  same(select(box, '|Z'), [0, 1]);
  same(select(box, '+Z'), [1]);
  same(select(box, '-Z'), [0]);
  same(select(shelled, '+Z and <Z'), [2]);
  same(select(box, '|x'), [4, 5]);
});

test('edges of a face selector', () => {
  same(edgesOf(shelled, 'edges of top').length, 8);
  same(edgesOf(box, 'edges of top'), [4, 5, 6, 7]);
  const outer = edgesOf(shelled, 'edges of top and (>X or <X or >Y or <Y)');
  same(outer.length, 4);
  same(outer.map((i) => shelled.edges[i].a[2]), [25, 25, 25, 25]);
  assert.ok(outer.every((i) => [shelled.edges[i].a, shelled.edges[i].b].every((p) => Math.abs(p[0]) === 30 || Math.abs(p[1]) === 20)));
  same(edgesOf(box, 'edges of (top or bottom) and |X'), [0, 2, 4, 6]);
});

test('not, parentheses, and or, face and edge numbers', () => {
  same(select(box, 'not top'), [0, 2, 3, 4, 5]);
  same(select(box, 'not (top or bottom)'), [2, 3, 4, 5]);
  same(select(box, 'top or bottom'), [0, 1]);
  same(select(box, '#Z and not left and not right'), [2, 3]);
  same(select(box, 'face 3'), [3]);
  same(edgesOf(box, 'edge 11'), [11]);
  same(edgesOf(box, '|Z and >X'), [9, 10].filter((i) => box.edges[i].center[0] === 30));
  same(select(box, 'plane and not (>Z or <Z)'), [2, 3, 4, 5]);
});

test('types: holes, circles, cylinders', () => {
  same(select(drilled, 'hole'), [2]);
  same(select(drilled, 'cylinder'), [2, 3]);
  same(select(drilled, 'cone'), [4]);
  same(select(drilled, 'plane'), [0, 1]);
  same(edgesOf(drilled, 'circle'), [1, 2]);
  same(edgesOf(drilled, 'line'), [0]);
  same(edgesOf(drilled, 'circle and >Z'), [1]);
  same(select(drilled, 'all').length, 5);
});

test('case and spacing do not matter', () => {
  same(select(box, '> z'), [1]);
  same(select(box, 'TOP'), [1]);
  same(select(box, '  Not   Top  AND  >Z[ 1 ] '), select(box, 'not top and >z[1]'));
  same(select(box, '>Z[-1]'), select(box, '> z [ -1 ]'));
  same(edgesOf(box, 'EDGES   OF   Top'), [4, 5, 6, 7]);
});

test('an empty result is an empty list; unknown indices say what exists', () => {
  same(select(box, 'cone'), []);
  assert.throws(() => select(box, 'face 17'), { message: "Box has no face 17 (it has 0 to 5). Call JS3D.faces(id) to see the available indices." });
  assert.throws(() => edgesOf(box, 'edge 40'), { message: "Box has no edge 40 (it has 0 to 11; seams and smooth joins are not edges). Call JS3D.edges(id) to see the available indices." });
  const withSeam = { ...box, edgeMax: 14 };
  assert.throws(() => edgesOf(withSeam, 'edge 40'), { message: "Box has no edge 40 (it has 0 to 14; seams and smooth joins are not edges). Call JS3D.edges(id) to see the available indices." });
});

test('every error text', () => {
  const bad = (s, message, k = 'face') => assert.throws(() => select(box, s, k), { message });
  bad('', "empty selector, got \"\". Example: \"top\".");
  bad('   ', "empty selector, got \"   \". Example: \"top\".");
  bad('top )', "unexpected \")\" at character 4 in \"top )\". Example selector: \"top\".");
  bad('top and', "unexpected \"\" at character 7 in \"top and\". Example selector: \"top\".");
  bad('top @', "unexpected \"@\" at character 4 in \"top @\". Example selector: \"top\".");
  bad('>Q', "unexpected \"Q\" at character 1 in \">Q\". Example selector: \"top\".");
  bad('roof', /^unknown word "roof"; use top, bottom, .*, plane, cylinder, .*, edge N\. Example: "top"\.$/);
  bad('roof', /^unknown word "roof"; use top, bottom, .*, line, circle, .*, edge N\. Example: "edges of top"\.$/, 'edge');
  bad('edges of top', "\"edges of\" is for edges; this call takes faces, got \"edges of top\". Use a face selector such as \"top\".");
  bad('circle', "\"circle\" is an edge type; face types are plane, cylinder, cone, sphere, torus, other, hole. Use one of those face types.");
  bad('plane', "\"plane\" is a face type; edge types are line, circle, ellipse, other. Use one of those edge types.", 'edge');
  bad('+Z', "+Z and -Z are for faces; for edges use |Z or >Z, got \"+Z\". Example: \"|Z\".", 'edge');
  bad('-Z', "+Z and -Z are for faces; for edges use |Z or >Z, got \"-Z\". Example: \"|Z\".", 'edge');
  bad('[1]', "an index [n] only follows >X, <X ... or top, bottom, front, back, left, right, got \"[1]\". Example: \"top[0]\".");
  bad('plane[1]', "an index [n] only follows >X, <X ... or top, bottom, front, back, left, right, got \"plane[1]\". Example: \"top[0]\".");
  bad('(top', "missing \")\" in \"(top\". Add a closing parenthesis.");
  bad('edge 2', "unexpected \"edge\" at character 0 in \"edge 2\". Example selector: \"top\".");
  bad('face 2', "unexpected \"face\" at character 0 in \"face 2\". Example selector: \"top\".", 'edge');
  bad('constructor', /^unknown word "constructor"; use top, bottom, /);
  bad('toString', /^unknown word "tostring"; use top, bottom, /);
  assert.equal(select(box, 'top' + ' or top'.repeat(60), 'face').length, 1);
  bad('top' + ' or top'.repeat(72), "a selector can be at most 500 characters; this one has 507, got \"top or top or top or top or top or top or top or top or to…. Shorten the selector.");
});
