import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseDXF, relative, validateDrawing, layout, drawingSVG, drawCase } from './draw.mjs';

const fixture = await readFile(new URL('./fixtures/plate-views.dxf', import.meta.url), 'utf8');
const drawing = { title: 'PLATE', units: 'mm', projection: 'third', views: ['top', 'front', 'right'], notes: ['A < B'], dims: [
  { type: 'linear', view: 'top', along: 'x', from: [0, 0], to: [80, 0], at: -10, text: '80' },
  { type: 'leader', view: 'top', point: [5, 5], r: 2.25, to: [20, 50], text: 'Ø4.5 THRU' },
  { type: 'centre', view: 'top', point: [5, 5], r: 2.25 },
] };
const parsed = parseDXF(fixture);
const views = Object.fromEntries(drawing.views.map(v => [v, relative(parsed[v.toUpperCase()])]));

test('fixture contains the expected views and holes', () => {
  assert.equal(parsed.TOP.filter(c => c.t === 'line').length, 4);
  assert.equal(parsed.TOP.filter(c => c.t === 'circle').length, 4);
  assert.equal(parsed.FRONT.filter(c => c.t === 'line').length, 4);
  assert.equal(parsed.RIGHT.filter(c => c.t === 'line').length, 4);
  assert.deepEqual(views.top.size, [80, 40]);
  assert.deepEqual(views.front.size, [80, 5]);
  assert.deepEqual(views.right.size, [40, 5]);
  assert.deepEqual(views.top.curves.filter(c => c.t === 'circle').map(c => [...c.c, c.r]).sort((a,b) => a[0]-b[0] || a[1]-b[1]), [[5,5,2.25],[5,35,2.25],[60,30,2.25],[75,5,2.25]]);
});

test('arcs use their actual extent', () => {
  const c = parseDXF('0\nARC\n8\nTOP\n10\n10\n20\n20\n40\n4\n50\n0\n51\n90\n0\nEOF\n').TOP;
  const r = relative(c);
  assert.ok(Math.abs(r.size[0] - 4) < 1e-10 && Math.abs(r.size[1] - 4) < 1e-10);
  assert.ok(Math.abs(r.curves[0].c[0]) < 1e-10 && Math.abs(r.curves[0].c[1]) < 1e-10);
});

test('polylines and unknown entities', () => {
  const dxf = '0\nPOLYLINE\n8\nTOP\n70\n1\n0\nVERTEX\n10\n1\n20\n2\n0\nVERTEX\n10\n3\n20\n4\n0\nSEQEND\n0\nPOLYLINE\n8\nTOP\n70\n0\n0\nVERTEX\n10\n5\n20\n6\n0\nSEQEND\n0\nTEXT\n8\nTOP\n1\nignore\n0\nEOF\n';
  assert.deepEqual(parseDXF(dxf).TOP, [{ t:'poly', pts:[[1,2],[3,4]], closed:true }, { t:'poly', pts:[[5,6]], closed:false }]);
});

test('layout leaves room for dimensions in both projections', () => {
  for (const projection of ['third', 'first']) {
    const result = layout(views, { ...drawing, projection }, 10), { top, front, right } = result.place;
    if (projection === 'third') { assert.ok(top[1] - 10 >= front[1] + 5 + 8); assert.ok(right[0] >= front[0] + 80 + 8); }
    else { assert.ok(top[1] + 50 + 8 <= front[1]); assert.ok(right[0] + 40 + 8 <= front[0]); }
    assert.ok(top[1] - 10 >= 0);
    assert.equal(top[0], front[0]); assert.equal(right[1], front[1]);
  }
});

test('SVG includes geometry, dimensions and escaped title block', () => {
  const svg = drawingSVG(drawing, views);
  assert.ok(svg.startsWith('<svg'));
  for (const s of ['width="2000"', 'Ø4.5 THRU', 'A &lt; B', 'PLATE', 'THIRD ANGLE PROJECTION', '<circle', '>80</text>']) assert.ok(svg.includes(s), s);
  assert.ok(drawingSVG({ ...drawing, projection: 'first' }, views).includes('FIRST ANGLE PROJECTION'));
});

test('validation identifies invalid fields', () => {
  validateDrawing(drawing);
  const bad = [
    [{ title: '' }, /title/], [{ units: 'cm' }, /units/], [{ projection: 'side' }, /projection/],
    [{ views: ['top','top'] }, /views/], [{ notes: [1] }, /notes/], [{ dims: null }, /dims/],
    [{ dims: [{ type:'linear', view:'right', along:'z' }] }, /along/],
    [{ dims: [{ type:'linear', view:'top', along:'x', from:[0,0], to:[1,0], at:NaN, text:'x' }] }, /at/],
    [{ dims: [{ type:'leader', view:'top', point:[0,0], to:[1,1], r:0, text:'x' }] }, /r/],
    [{ dims: [{ type:'centre', view:'front', point:[0,0], r:-1 }] }, /r/],
    [{ dims: [{ type:'centre', view:'other', point:[0,0], r:1 }] }, /view/],
  ];
  for (const [change, reason] of bad) assert.throws(() => validateDrawing({ ...drawing, ...change }), reason);
});

test('drawCase builds, draws and writes the rasterizer output', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'drawbench-'));
  try {
    await writeFile(path.join(dir, 'case.json'), JSON.stringify({ drawing }));
    await writeFile(path.join(dir, 'truth.recipe.json'), JSON.stringify({ version: 1, steps: [] }));
    const calls = [];
    const result = await drawCase(async (name, args) => { calls.push([name, args]); if (name === 'drawing') return Buffer.from(fixture); }, dir, { png: async svg => { assert.ok(svg.includes('<svg')); return Buffer.from('png'); } });
    assert.deepEqual(calls.map(c => c[0]), ['newDesign', 'ready', 'drawing']);
    assert.deepEqual(calls[2][1], [{ views: drawing.views }]);
    assert.equal(await readFile(result.file, 'utf8'), 'png');
    assert.equal(result.width, 2000); assert.ok(result.height > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
