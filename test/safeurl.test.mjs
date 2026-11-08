import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeMediaSrc, isSafeThumb, dropUnsafeMedia } from '../src/safeurl.js';

for (const type of ['png', 'jpeg', 'webp']) {
  test(`allows embedded ${type}`, () => assert.equal(isSafeMediaSrc(`data:image/${type};base64,AA==`, 'image'), true));
}
for (const src of [null, undefined, {}, 1, '', 'http://192.168.1.1/pixel', 'https://tracker.example/pixel', '//tracker.example/a', '/a.png', 'a.png', 'file:///tmp/a.png', 'blob:null/123', 'blob:https://example.com/123', 'javascript:alert(1)', 'data:image/svg+xml;base64,AA==', 'data:text/html;base64,AA==', 'data:video/mp4;base64,AA==', 'data:image/bmp;base64,AA==', 'data:image/gif;base64,AA==', ' data:image/png;base64,AA==', 'data:image/png;base64,AA==\n', 'data:image/png;foo=bar;base64,AA==', 'data:image/png,abc', 'data:image/png;base64,']) {
  test(`rejects ${JSON.stringify(src)}`, () => assert.equal(isSafeMediaSrc(src, 'image'), false));
}
test('rejects non-image kinds, including saved video sources', () => {
  for (const kind of ['video', 'audio', 'font', undefined]) assert.equal(isSafeMediaSrc('data:image/png;base64,AA==', kind), false);
});
test('cleanup drops unsafe entries, preserves fitting and runtime-only video records, and warns with ids only', (t) => {
  const calls = [];
  t.mock.method(console, 'warn', (...args) => calls.push(args));
  const good = { kind: 'image', src: 'data:image/png;base64,AA==' };
  const doc = { media: { good, bad: { kind: 'image', src: 'http://private.example/secret' }, video: { kind: 'video', name: 'Clip' }, empty: null }, bodies: [{ color: 'url(http://bad)', media: { id: 'bad' }, node: { children: [{ color: 'red' }, { color: '#abc' }] } }], sketches: [{ id: 'sk', image: { src: '//private.example/secret', w: 12, opacity: 0.3 } }] };
  assert.equal(dropUnsafeMedia(doc), true);
  assert.deepEqual(Object.keys(doc.media), ['good', 'video']);
  assert.equal(doc.media.good, good);
  assert.equal(doc.bodies[0].media, undefined);
  assert.equal(doc.bodies[0].color, '#a7b0ba');
  assert.deepEqual(doc.bodies[0].node.children.map(c => c.color), ['#a7b0ba', '#abc']);
  assert.deepEqual(doc.sketches[0].image, { src: null, w: 12, opacity: 0.3 });
  assert.deepEqual(calls, [['Left out unsafe media', 'bad'], ['Left out unsafe media', 'empty'], ['Left out unsafe media', 'sk']]);
  assert.equal(dropUnsafeMedia(doc), false);
});

test('cleanup covers archived bodies and nested tool nodes', () => {
  const bad = 'url(http://bad)';
  const mod = { tool: { color: bad, src: { color: bad }, children: [{ color: bad }] }, tools: [{ color: bad, node: { mods: [{ tools: [{ color: '#12345678' }, { color: bad }] }] } }] };
  const doc = { bodies: [{ node: { mods: [mod] } }] };
  dropUnsafeMedia(doc);
  assert.equal(mod.tool.color, '#a7b0ba');
  assert.equal(mod.tool.src.color, '#a7b0ba');
  assert.equal(mod.tool.children[0].color, '#a7b0ba');
  assert.equal(mod.tools[0].color, '#a7b0ba');
  assert.deepEqual(mod.tools[0].node.mods[0].tools.map(t => t.color), ['#12345678', '#a7b0ba']);
});

test('thumbnail allowlist accepts only bounded JPEG and PNG data', () => {
  for (const type of ['jpeg', 'png']) assert.equal(isSafeThumb(`data:image/${type};base64,AA==`), true);
  for (const src of ['http://example.test/a', 'data:image/webp;base64,AA==', 'data:image/jpeg;base64,' + 'A'.repeat(200001)]) assert.equal(isSafeThumb(src), false);
});
