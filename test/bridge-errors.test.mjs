import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from './bridgenode.mjs';
const existing = [
  ['get', a => a.get('b9'), ['no body', '"b9"']],
  ['kind', a => a.add('bad'), ['kind', '"bad"']],
  ['size', a => a.add('box', {size: {w: 0}}), ['w', '0']],
  ['position', a => a.add('box', {at: [1, 2]}), ['at', '[1,2]']],
  ['color', a => a.add('box', {color: 'red'}), ['color', '"red"']],
  ['parameter', a => a.removeParam('x'), ['parameter', '"x"']],
  ['mode', a => a.setMode('bad'), ['mode', '"bad"']],
  ['url', a => a.connect('bad'), ['url', '"bad"']],
  ['call', a => a.invoke('bad'), ['call', '"bad"']],
  ['args', a => a.invoke('list', 4), ['args', '4']],
  ['empty ids', a => a.remove([]), ['ids', '[]']],
  ['size type', a => a.add('box', {size: 4}), ['size', '4']],
  ['size key', a => a.add('box', {size: {bad: 1}}), ['size', '"bad"']],
  ['group size', a => { const id = a.add('box'); return a.group([id]); }, ['group', 'at least two']],
  ['axis', a => { const id = a.add('box'); return a.rotate(id, 'q', 4); }, ['axis', '"q"']],
  ['degrees', a => { const id = a.add('box'); return a.rotate(id, 'z', 'q'); }, ['degrees', '"q"']],
  ['scale', a => { const id = a.add('box'); return a.scale(id, -1); }, ['k', '-1']],
  ['hole', a => { const id = a.add('box'); return a.setHole(id, 'yes'); }, ['hole', '"yes"']],
  ['name', a => { const id = a.add('box'); return a.rename(id, ''); }, ['name', '""']],
  ['hidden', a => { const id = a.add('box'); return a.setHidden(id, 'yes'); }, ['hidden', '"yes"']],
  ['parameter name', a => a.setParam(4, '1'), ['name', '4']],
  ['parameter unit', a => a.setParam('width', '1', {unit: 'cm'}), ['unit', '"cm"']],
  ['parameter expression', a => a.setParam('width', ''), ['expr', '""']],
  ['new design mode', a => a.newDesign('bad'), ['mode', '"bad"']],
  ['export kind', a => a.export('bad'), ['kind', '"bad"']],
  ['script', a => a.run(4), ['run', '4']],
  ['checkpoint label', a => a.checkpoint(4), ['label', '4']],
  ['missing checkpoint', a => a.diff('c9'), ['checkpoint', '"c9"']],

];
const cases = existing.map(([name, run, mentions]) => ({name, run, mentions}));
const body = api => api.add('box');
cases.push(
  {name: 'array size', run: a => a.add('box', {size: [1, 2]}), mentions: ['size', '[1,2]'], allowed: /w.*d.*h/},
  {name: 'text size', run: a => a.add('text', {size: {text: 4}}), mentions: ['text', '4']},
  {name: 'integer size', run: a => a.add('pyramid', {size: {sides: 2}}), mentions: ['sides', '2'], allowed: /3/},
  {name: 'group op', setup: a => [body(a), body(a)], run: (a, ids) => a.group(ids, {op: 'bad'}), mentions: ['op', '"bad"'], allowed: /intersect.*cut/},
  {name: 'ungroup plain', setup: body, run: (a, id) => a.ungroup(id), mentions: ['body'], dynamicId: true},
  {name: 'resize group', setup: a => a.group([body(a), body(a)]), run: (a, id) => a.resize(id, {}), mentions: ['id'], dynamicId: true},
  {name: 'bind group', setup: a => a.group([body(a), body(a)]), run: (a, id) => a.bind(id, 'w', '2'), mentions: ['id'], dynamicId: true},
  {name: 'bind key', setup: body, run: (a, id) => a.bind(id, 'bad', '2'), mentions: ['size', '"bad"']},
  {name: 'bind expression', setup: body, run: (a, id) => a.bind(id, 'w', 'bad'), mentions: ['expr', '"bad"'], allowed: /0\.01/},
  {name: 'parameter invalid name', run: a => a.setParam('1bad', '1'), mentions: ['name', '"1bad"']},
  {name: 'parameter invalid expression', run: a => a.setParam('width', 'bad'), mentions: ['expr', '"bad"']},
  {name: 'unbuilt centre', setup: body, run: (a, id) => a.rotate(id, 'z', 10), mentions: ['opts.about']},
  {name: 'ready timeout', app: {kernel: {ready: false, inflight: false, queue: new Set()}}, run: a => a.ready(-1), mentions: ['ready', '-1']},
  {name: 'group features', setup: (a, _, store) => { const id = a.group([body(a), body(a)]); store.doc.bodies.find(b => b.id === id).node.mods = [{t: 'fillet'}]; return id; }, run: (a, id) => a.ungroup(id), mentions: ['group', 'features']},
  {name: 'group angled scale', setup: (a, _, store) => { const id = a.group([body(a), body(a)]); const node = store.doc.bodies.find(b => b.id === id).node; node.mods = [{t: 'scale', k: [2, 1, 1], o: [0, 0, 0]}]; node.children[0].m[0] = 0.7; return id; }, run: (a, id) => a.ungroup(id), mentions: ['group']},
  {name: 'empty screenshot', app: {vp: {render() {}, canvas: {toDataURL: () => ''}}}, run: a => a.screenshotDataURL(), mentions: ['3D view']},
  {name: 'screenshot width', run: a => a.screenshotDataURL({width: 0}), mentions: ['width', '0'], allowed: /1.*8192/},
  {name: 'export build error', setup: (a, app) => { const id = body(a); app.scene.errors.set(id, 'bad build'); return id; }, run: a => a.export('stl'), mentions: ['build error', 'bad build']},
  {name: 'empty export', run: a => a.export('stl'), mentions: ['export']},
  {name: 'invalid project', run: a => a.load('bad'), mentions: ['json', '"bad"']},
  {name: 'invalid project body', run: a => a.load({bodies: [4], sketches: []}), mentions: ['body', '4']},
  {name: 'long checkpoint', run: a => a.checkpoint('x'.repeat(201)), mentions: ['label', '"' + 'x'.repeat(58) + '…'], allowed: /200/},
  {name: 'checkpoint other design diff', setup: (a, _, store) => { const id = a.checkpoint().id; store.doc.id = 'other'; return id; }, run: (a, id) => a.diff(id), mentions: ['checkpoint'], dynamicId: true},
  {name: 'checkpoint other design rollback', setup: (a, _, store) => { const id = a.checkpoint().id; store.doc.id = 'other'; return id; }, run: (a, id) => a.rollback(id), mentions: ['checkpoint'], dynamicId: true},
  {name: 'chisel state', app: {mode: 'chisel'}, run: a => a.add('box'), mentions: ['Chisel']},
  {name: 'cosforge state', app: {cosforge: {isOpen: true}}, run: a => a.add('box'), mentions: ['CosForge']},
  {name: 'carve state', app: {carve: {active: true}}, run: a => a.add('box'), mentions: ['Chip Carving']},
  {name: 'simulation undo', app: {simLock: true}, run: a => a.undo(), mentions: ['3D Print Sim']},
  {name: 'simulation rollback', app: {simLock: true}, setup: a => a.checkpoint().id, run: (a, id) => a.rollback(id), mentions: ['3D Print Sim']},
  {name: 'box style', run: a => a.boxMaker({style: 'bad'}), mentions: ['style', '"bad"'], allowed: /bin.*drawer.*tilt.*door/},
  {name: 'box width', run: a => a.boxMaker({w: 1}), mentions: ['w', '1'], allowed: /10.*1000/},
  {name: 'box count', run: a => a.boxMaker({cols: 0}), mentions: ['cols', '0'], allowed: /1.*20/},
  {name: 'gear type', run: a => a.gearSet({type: 'bad'}), mentions: ['type', '"bad"'], allowed: /pair.*rack.*ring.*planet.*bevel.*helical/},
  {name: 'gear module', run: a => a.gearSet({module: 0}), mentions: ['module', '0'], allowed: /0\.3.*10/},
  {name: 'gear pressure', run: a => a.gearSet({pressureAngle: 15}), mentions: ['pressureAngle', '15'], allowed: /14\.5.*20.*25/},
  {name: 'hardware option', run: a => a.hardware({bad: 1}), mentions: ['option', '"bad"']},
  {name: 'hardware part', run: a => a.hardware({part: 'bad'}), mentions: ['part', '"bad"']},
  {name: 'hardware size', run: a => a.hardware({part: 'hexbolt', size: 'bad'}), mentions: ['size', '"bad"']},
  {name: 'texture faces', setup: body, run: (a, id) => a.texture(id, {faces: []}), mentions: ['faces', '[]']},
  {name: 'texture size', setup: body, run: (a, id) => a.texture(id, {size: 0}), mentions: ['size', '0'], allowed: /0\.5.*100/},
  {name: 'texture direction', setup: body, run: (a, id) => a.texture(id, {dir: 'bad'}), mentions: ['dir', '"bad"'], allowed: /raise.*engrave.*both/},
  {name: 'drawing views', run: a => a.drawing({views: ['bad']}), mentions: ['views', '["bad"]'], allowed: /top.*front.*right/},
  {name: 'drawing units', run: a => a.drawing({units: 'cm'}), mentions: ['units', '"cm"'], allowed: /mm.*in/},
  {name: 'drawing scale', run: a => a.drawing({scale: 0}), mentions: ['scale', '0'], allowed: /0\.01.*100/},
  {name: 'sketch name', run: a => a.sketch({name: ''}), mentions: ['name', '""']},
  {name: 'sketch hidden', run: a => a.sketch({hidden: 'bad'}), mentions: ['hidden', '"bad"'], allowed: /true.*false/},
  {name: 'sketch plane', run: a => a.sketch({on: 'bad'}), mentions: ['on', '"bad"'], allowed: /XY.*XZ.*YZ/},
  {name: 'extrude mode', run: a => a.extrude({mode: 'bad'}), mentions: ['mode', '"bad"'], allowed: /one.*sym.*two/},
  {name: 'extrude through', run: a => a.extrude({through: 'bad'}), mentions: ['through', '"bad"'], allowed: /true.*false/},
  {name: 'extrude op', run: a => a.extrude({op: 'bad'}), mentions: ['op', '"bad"'], allowed: /new.*join.*cut/},
  {name: 'inspect material', run: a => a.inspect(null, {material: 'bad'}), mentions: ['material', '"bad"']},
  {name: 'inspect density', run: a => a.inspect(null, {density: 0}), mentions: ['density', '0'], allowed: /0\.1.*25/},
  {name: 'measure point', run: a => a.measure([1, 2], [0, 0, 0]), mentions: ['a', '[1,2]']},
  {name: 'print angle', run: a => a.printCheck({angle: 0}), mentions: ['angle', '0'], allowed: /10.*80/},
  {name: 'collision gap', run: a => a.collisions({gap: -1}), mentions: ['gap', '-1'], allowed: /0.*50/},
);
for (const {name, run, mentions, allowed, setup, app, dynamicId} of cases) test(name, async () => {
  const {api, app: instance, store} = bridge({kernel: {ready: true, inflight: false, queue: new Set()}, ...app});
  const value = setup?.(api, instance, store);
  await assert.rejects(async () => run(api, value), error => {
    for (const part of [...mentions, ...(dynamicId ? [JSON.stringify(value)] : [])]) assert.ok(error.message.includes(part), error.message);
    if (allowed) assert.match(error.message, allowed);
    assert.match(error.message, /(?:Example:|\b(?:Call|Try|Use|Leave|Press|Close|Wait|Pass|Give|Remove|Rename|Pick|Check|Undo|Open|Add|Show)\b)/);
    assert.ok(error.message.length < 300);
    if (!mentions.some(part => /undefined|\[object Object\]|NaN/.test(part))) assert.doesNotMatch(error.message, /undefined|\[object Object\]|NaN/);
    return true;
  });
});
