import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from './bridgenode.mjs';
const { createChannel, parseAllow } = await import('../src/embed.js');

const origin = 'https://school.example', other = 'http://localhost:123';
const tick = () => new Promise((r) => setImmediate(r));
function setup(api = {}) {
  const parent = {}, sent = []; let time = 10000;
  const ch = createChannel({ api, parent, allow: [origin, other], post: (msg, to) => sent.push({ ...msg, to }), now: () => time });
  ch.start();
  const send = (id, call, args, extra = {}) => ch.receive({ source: parent, origin, data: { type: 'js3d-call', protocol: 1, id, call, args }, ...extra });
  return { ch, sent, send, parent, advance: (n) => { time += n; } };
}
test('allowlist accepts exact cross-origin addresses only', () => {
  assert.deepEqual(parseAllow(`${origin}, ${other} http://127.0.0.1:44 http://[::1]:5`, 'https://app.example'), [origin, other, 'http://127.0.0.1:44', 'http://[::1]:5']);
  for (const x of ['*', 'null', origin + '/x', origin + '/', 'https://u@school.example', 'http://school.example', 'ftp://school.example', 'https://app.example']) assert.deepEqual(parseAllow(x, 'https://app.example'), []);
  assert.deepEqual(parseAllow(Array(9).fill(origin).join(','), ''), []);
});
test('ready, source, origin, exact replies, refused and missing calls', async () => {
  const {api} = bridge(); const x = setup(api);
  assert.equal(x.sent.length, 2); assert.ok(x.sent[0].calls.includes('add'));
  x.send(1, 'list', [], { source: {} }); x.send(1, 'list', [], { origin: 'https://wrong.example' }); assert.equal(x.sent.length, 2);
  x.send(1, 'list', [], { origin: other }); await tick(); assert.equal(x.sent.at(-1).to, other);
  x.send(2, 'run', []); assert.match(x.sent.at(-1).error, /not available/);
  x.send(3, 'supports', []); assert.equal(x.sent.at(-1).error, 'unknown call');
});
test('profiles and print defaults', async () => {
  let got; const x = setup({ setMode: () => {}, newDesign: () => {}, printCheck: (o) => { got = o; } });
  x.send(1, 'setMode', ['arch']); assert.match(x.sent.at(-1).error, /mode/);
  x.send(2, 'newDesign', ['arch']); assert.match(x.sent.at(-1).error, /mode/);
  x.send(3, 'printCheck', [{}]); await tick(); assert.deepEqual(got, { printer: 'generic', angle: 45 }); assert.equal(x.sent.at(-1).result, null);
});
test('invalid arguments and increasing ids', () => {
  const x = setup({ add() {} }); let id = 0;
  let deep = {}; for (let i = 0; i < 34; i++) deep = { a: deep };
  for (const bad of [new Map(), new Date(), new ArrayBuffer(1), new Uint8Array(1), deep, 'x'.repeat(1024 * 1024), JSON.parse('{"__proto__":1}'), NaN, Infinity]) { x.send(++id, 'add', [bad]); assert.ok(x.sent.at(-1).error); }
  x.send(id, 'add', []); assert.match(x.sent.at(-1).error, /id/);
});
test('queue, failures, close, result size and bytes', async () => {
  let release; const x = setup({ add: () => new Promise((r) => { release = r; }), get: () => { throw Error('bad'); }, list: () => new Uint8Array([1,2]), doc: () => 'x'.repeat(32 * 1024 * 1024 + 1) });
  x.send(1, 'add', []); for (let i = 2; i <= 17; i++) x.send(i, 'get', []); x.send(18, 'get', []); assert.match(x.sent.at(-1).error, /waiting/);
  release(null); await tick(); assert.equal(x.sent.filter((m) => m.error === 'bad').length, 16);
  x.send(19, 'list', []); await tick(); assert.deepEqual(x.sent.at(-1).result, new Uint8Array([1,2]));
  x.send(20, 'doc', []); await tick(); assert.equal(x.sent.at(-1).error, 'the result is too big to send');
  x.send(21, 'add', []); x.ch.close('stopped'); const count = x.sent.length; release(1); await tick(); x.send(22, 'list', []); assert.equal(x.sent.length, count); assert.equal(x.sent.at(-1).reason, 'stopped');
});
test('rate limit and hello throttling', async () => {
  const x = setup({ list: () => null });
  for (let i = 1; i <= 31; i++) { x.send(i, 'list', []); await tick(); }
  assert.match(x.sent.at(-1).error, /per second/);
  const hello = () => x.ch.receive({source:x.parent, origin, data:{type:'js3d-hello',protocol:1}});
  const n = x.sent.length; hello(); hello(); assert.equal(x.sent.length, n + 1); x.advance(1000); hello(); assert.equal(x.sent.length, n + 2);
});
test('design change closes the channel', async () => {
  const x = setup({ list: () => [] });
  x.ch.close('design-changed');
  assert.equal(x.sent.at(-1).reason, 'design-changed');
  const count = x.sent.length; x.send(1, 'list', []); await tick();
  assert.equal(x.sent.length, count);
});
test('store load clears history before an embedded scratch', () => {
  const {store, api} = bridge(); api.add('box'); assert.ok(store.undoStack.length); const before = store.doc.id;
  store.load({...store.doc, id: 'scratch', bodies: []}); assert.equal(store.undo(), null); assert.notEqual(store.doc.id, before);
});
