import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from './bridgenode.mjs';
const cases = [
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
for (const [name, run, mentions] of cases) test(name, async () => {
  const {api} = bridge();
  await assert.rejects(async () => run(api), error => {
    for (const part of mentions) assert.ok(error.message.includes(part), error.message);
    assert.match(error.message, /(?:Example:|\b(?:Call|Try|Use|Leave|Close|Wait|Pass|Check|Pick|Remove|Press|Fix|Undo)\b)/);
    assert.ok(error.message.length < 300);
    assert.doesNotMatch(error.message, /undefined|\[object Object\]|NaN/);
    return true;
  });
});
