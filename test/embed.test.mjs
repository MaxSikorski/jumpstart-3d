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
  x.send(3, 'supports', ['add']); await tick(); assert.equal(x.sent.at(-1).result, true);
  const { describe, ...older } = api; const y = setup(older);
  y.send(1, 'describe', []); assert.equal(y.sent.at(-1).error, 'unknown call');
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

test('repeated references, sparse arrays and excessive values are refused', () => {
  const x = setup({ add() {} });
  const shared = {}; x.send(1, 'add', [[shared, shared]]); assert.ok(x.sent.at(-1).error);
  x.send(2, 'add', [new Array(1e9)]); assert.ok(x.sent.at(-1).error);
  x.send(3, 'add', [Array(100001).fill(0)]); assert.ok(x.sent.at(-1).error);
});
test('late updates cannot change a different design', async () => {
  const { store } = bridge(); const { guardUpdates } = await import('../src/embed.js');
  let release, failure; const scratch = store.doc.id, onCall = guardUpdates(store, (id) => id === scratch);
  // Exercise the same call lifecycle used by startEmbed.
  const parent = {}, sent = [];
  const ch = createChannel({ api: { add: async () => { await new Promise(r => { release = r; }); try { store.update(d => { d.name = 'changed'; }); } catch (e) { failure = e; throw e; } } }, parent, allow: [origin], post: m => sent.push(m), onCall });
  ch.start(); ch.receive({source: parent, origin, data: {type:'js3d-call', protocol:1, id:1, call:'add'}});
  store.load({...store.doc, id:'other', name:'untouched'}); release(); await tick();
  assert.equal(failure.message, "the design changed, so this website's call was stopped"); assert.equal(store.doc.name, 'untouched');
});
test('byte replies own a tight buffer', async () => {
  const x = setup({ list: () => new Uint8Array(new ArrayBuffer(1024 * 1024), 99, 1) });
  x.send(1, 'list', []); await tick(); assert.equal(x.sent.at(-1).result.buffer.byteLength, 1);
});
test('deadline reports an error and closes permanently', async () => {
  const parent = {}, sent = []; let fire, delay, cleared = false;
  const ch = createChannel({api:{add: () => new Promise(() => {})}, allow:[origin], parent, post:m => sent.push(m), now:() => 0, setTimer:(fn, ms) => { fire = fn; delay = ms; return 1; }, clearTimer:() => { cleared = true; }});
  ch.start(); ch.receive({source:parent, origin, data:{type:'js3d-call', protocol:1, id:1, call:'add'}}); assert.equal(delay, 600000);
  fire(); await tick(); assert.equal(sent[1].error, 'the call took longer than 10 minutes; reload the page to start again'); assert.equal(sent[2].reason, 'timeout'); assert.equal(ch.open, false); assert.ok(cleared);
  ch.receive({source:parent, origin, data:{type:'js3d-call', protocol:1, id:2, call:'add'}}); assert.equal(sent.length, 3);
});
test('storage isolation is empty and supports Storage property operations', async () => {
  const { storageOverlay, installIsolation } = await import('../src/embed.js');
  const real = new Map([['secret', 'saved']]);
  const s = storageOverlay(real);
  assert.equal(s.getItem('secret'), null); assert.equal(s.length, 0);
  s.setItem('a', 3); s.b = false;
  assert.equal(s.a, '3'); assert.equal(s.getItem('b'), 'false');
  assert.deepEqual(Object.keys(s), ['a', 'b']);
  const keys = []; for (const k in s) keys.push(k); assert.deepEqual(keys, ['a', 'b']);
  assert.ok('a' in s); delete s.a; assert.ok(!('a' in s));
  assert.equal(s.key(0), 'b'); s.removeItem('b'); s.x = 'x'; s.clear(); assert.equal(s.length, 0);
  assert.equal(real.get('secret'), 'saved');
  const target = {localStorage: real, sessionStorage: real, indexedDB: {}};
  assert.equal(installIsolation(target), true); assert.equal(target.indexedDB, undefined);
  assert.equal(target.localStorage.length, 0); assert.equal(target.sessionStorage.length, 0);
  target.localStorage.x = 1; assert.equal(target.sessionStorage.x, undefined);
  const blocked = {}; Object.defineProperty(blocked, 'indexedDB', {value: {}, configurable: false});
  assert.equal(installIsolation(blocked), false);
});
test('closing a stuck call releases the edit guard and timer', async () => {
  const { store } = bridge(); const { guardUpdates } = await import('../src/embed.js');
  const scratch = store.doc.id, parent = {}; let cleared = false;
  const ch = createChannel({api:{add: () => new Promise(() => {})}, allow:[origin], parent, post(){}, onCall:guardUpdates(store, id => id === scratch), setTimer:() => 42, clearTimer:id => { assert.equal(id, 42); cleared = true; }});
  ch.start(); ch.receive({source:parent, origin, data:{type:'js3d-call', protocol:1, id:1, call:'add'}});
  ch.close('stopped'); assert.ok(cleared);
  store.load({...store.doc, id:'other'}); store.update(d => { d.name = 'works'; }); assert.equal(store.doc.name, 'works');
});
test('Chisel permits reading calls and refuses edits, including queued edits', async () => {
  const parent = {}, sent = []; let chisel = true, edits = 0;
  const ch = createChannel({api:{list:() => [], add:() => { edits++; }, setMode:() => { edits++; }}, allow:[origin], parent, post:m => sent.push(m), isChisel:() => chisel});
  ch.start();
  const send = (id, call, args = []) => ch.receive({source:parent, origin, data:{type:'js3d-call', protocol:1, id, call, args}});
  send(1,'list'); await tick(); assert.deepEqual(sent.at(-1).result, []);
  send(2,'setMode',['beginner']); await tick(); assert.equal(sent.at(-1).error, 'the person is using Chisel in this frame; try again after they leave it');
  send(3,'add'); await tick(); assert.equal(edits, 0);
  chisel = false; send(4,'add'); await tick(); assert.equal(edits, 1);
});
test('embedded mesh cache and folder mirror stay idle', async () => {
  const priorWindow = globalThis.window, priorLocation = globalThis.location, priorIDB = globalThis.indexedDB;
  let opens = 0, reads = 0, writes = 0;
  globalThis.window = { parent: {}, isSecureContext:true, showDirectoryPicker() { throw Error('must not open'); } };
  globalThis.location = { protocol:'https:', search:'?embed=x' }; globalThis.indexedDB = {open() { opens++; }};
  try {
    const {diskGet, diskPut} = await import('../src/meshcache.js'); assert.equal(await diskGet('v','k'),null); await diskPut('v','k',{},1); assert.equal(opens,0);
    const {initFolder} = await import('../src/folder.js');
    const folder = initFolder({ps:{ready:Promise.resolve(), kind:'idb', getMeta(){reads++;}, setMeta(){writes++;}, onSwitch(){}}, toast(){}, fileSafe:s => s});
    await folder.now(); await folder.soon(); assert.equal(await folder.row(),null); assert.equal(reads,0); assert.equal(writes,0);
  } finally { globalThis.window = priorWindow; globalThis.location = priorLocation; globalThis.indexedDB = priorIDB; }
});
test('blocked isolation stops module startup and shows the warning', async () => {
  const oldWindow = globalThis.window, oldLocation = globalThis.location, oldDocument = globalThis.document;
  const nodes = []; let rendered;
  const fakeWindow = new Proxy({parent:{postMessage(){ throw Error('channel started'); }}}, {defineProperty(){ throw Error('blocked'); }});
  globalThis.window = fakeWindow;
  globalThis.location = {protocol:'https:', search:'?embed=https%3A%2F%2Fschool.example', origin:'https://app.example', pathname:'/cad', href:'https://app.example/cad?embed=https%3A%2F%2Fschool.example#x'};
  globalThis.document = {createElement() { const n = {}; nodes.push(n); return n; }, body:{replaceChildren(...args){ rendered = args; }}};
  try {
    await assert.rejects(import('../src/embed.js?blocked-isolation'), /Could not create the temporary workspace/);
    assert.equal(rendered[0].textContent, 'This page was opened inside another website, but this browser would not give it a private workspace. Open JumpStart 3D in its own tab.');
    assert.equal(rendered[1].href, 'https://app.example/cad');
  } finally { globalThis.window = oldWindow; globalThis.location = oldLocation; globalThis.document = oldDocument; }
});

test('all API calls are classified for embedding', async () => {
  const { EMBED_CALLS, REFUSED } = await import('../src/embed.js');
  const { CALLS } = await import('../src/apicontract.js');
  const names = CALLS.map(c => c.name);
  for (const name of EMBED_CALLS) assert.ok(names.includes(name), name);
  for (const name of names) assert.equal(Number(EMBED_CALLS.includes(name)) + Number(REFUSED.includes(name)), 1, name);
  for (const name of REFUSED) assert.ok(!EMBED_CALLS.includes(name), name);
});

test('async edits reject a design change before writing', async () => {
  const error = 'the design changed while this call was waiting, so nothing was changed. Run the call again on the design you want.';
  for (const call of ['sketch', 'holePattern', 'texture']) {
    let writes = 0;
    const kernel = {ready:false, inflight:0, queue:new Set()};
    const {api, store} = bridge({kernel, advanced:{addHolePattern(){ writes++; }}});
    const id = api.add('box');
    const pending = call === 'sketch' ? api.sketch({on:{body:id, face:'top'}, shapes:[{type:'circle', center:[0,0], radius:2}]}) : call === 'texture' ? api.texture(id, {texture:api.textures()[0].key}) : api.holePattern({body:id});
    const other = {...store.doc, id:'other', name:'untouched', bodies:[], sketches:[]};
    store.load(other); kernel.ready = true;
    await assert.rejects(pending, {message:error});
    assert.equal(store.doc.name, 'untouched'); assert.equal(store.doc.bodies.length, 0); assert.equal(store.doc.sketches.length, 0); assert.equal(writes, 0);
  }
});
test('a call name must be text, so a profile cannot be dodged with ["setMode"]', async () => {
  let mode = null; const x = setup({ setMode: (m) => { mode = m; } });
  x.send(1, ['setMode'], ['arch']); await tick();
  assert.match(x.sent.at(-1).error, /call must be the name of a call as text/); assert.equal(mode, null);
});
test('a call waiting in the queue is not run once the open design is no longer the temporary one', async () => {
  const parent = {}, sent = []; let current = true, ran = 0, release;
  const ch = createChannel({ api: { ready: () => new Promise((r) => { release = r; }), list: () => { ran++; return []; } }, parent, allow: [origin], post: (msg) => sent.push(msg), isCurrent: () => current });
  ch.start();
  const send = (id, call) => ch.receive({ source: parent, origin, data: { type: 'js3d-call', protocol: 1, id, call, args: [] } });
  send(1, 'ready'); send(2, 'list'); current = false; release(); await tick(); await tick();
  assert.equal(ran, 0); assert.ok(sent.some((m) => m.type === 'js3d-closed' && m.reason === 'design-changed'));
});
test('any http(s) frame is a temporary workspace; only ?embed invites control', async () => {
  const priorWindow = globalThis.window, priorLocation = globalThis.location;
  const { embedActive, embedInvited } = await import('../src/embedmode.js');
  const at = (framed, protocol, search) => { const w = { parent: null }; w.parent = framed ? {} : w; globalThis.window = w; globalThis.location = { protocol, search }; return [embedActive(), embedInvited()]; };
  try {
    assert.deepEqual(at(true, 'https:', ''), [true, false]);
    assert.deepEqual(at(true, 'http:', '?x=1'), [true, false]);
    assert.deepEqual(at(true, 'https:', '?embed=https%3A%2F%2Fschool.example'), [true, true]);
    assert.deepEqual(at(false, 'https:', '?embed=https%3A%2F%2Fschool.example'), [false, false]);
    assert.deepEqual(at(true, 'file:', '?embed=x'), [false, false]);
  } finally { globalThis.window = priorWindow; globalThis.location = priorLocation; }
});
