import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeMediaSrc, dropUnsafeMedia } from '../src/safeurl.js';

for (const type of ['png', 'jpeg', 'webp', 'gif']) {
  test(`allows embedded ${type}`, () => assert.equal(isSafeMediaSrc(`data:image/${type};base64,AA==`, 'image'), true));
}
for (const src of [null, undefined, {}, 1, '', 'http://192.168.1.1/pixel', 'https://tracker.example/pixel', '//tracker.example/a', '/a.png', 'a.png', 'file:///tmp/a.png', 'blob:null/123', 'blob:https://example.com/123', 'javascript:alert(1)', 'data:image/svg+xml;base64,AA==', 'data:text/html;base64,AA==', 'data:video/mp4;base64,AA==', 'data:image/bmp;base64,AA==', ' data:image/png;base64,AA==', 'data:image/png;base64,AA==\n', 'data:image/png;foo=bar;base64,AA==', 'data:image/png,abc', 'data:image/png;base64,']) {
  test(`rejects ${JSON.stringify(src)}`, () => assert.equal(isSafeMediaSrc(src, 'image'), false));
}
test('rejects non-image kinds, including saved video sources', () => {
  for (const kind of ['video', 'audio', 'font', undefined]) assert.equal(isSafeMediaSrc('data:image/png;base64,AA==', kind), false);
});
test('cleanup drops unsafe entries, preserves fitting and runtime-only video records, and warns with ids only', (t) => {
  const calls = [];
  t.mock.method(console, 'warn', (...args) => calls.push(args));
  const good = { kind: 'image', src: 'data:image/png;base64,AA==' };
  const doc = { media: { good, bad: { kind: 'image', src: 'http://private.example/secret' }, video: { kind: 'video', name: 'Clip' } }, bodies: [{ media: { id: 'bad' } }], sketches: [{ id: 'sk', image: { src: '//private.example/secret' } }] };
  assert.equal(dropUnsafeMedia(doc), true);
  assert.deepEqual(Object.keys(doc.media), ['good', 'video']);
  assert.equal(doc.media.good, good);
  assert.equal(doc.bodies[0].media.id, 'bad');
  assert.equal(doc.sketches[0].image, undefined);
  assert.deepEqual(calls, [['Left out unsafe media', 'bad'], ['Left out unsafe media', 'sk']]);
  assert.equal(dropUnsafeMedia(doc), false);
});
