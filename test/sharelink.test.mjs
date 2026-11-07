// Share link: the codec, the size limits and the untrusted-input checks, in Node (src/sharelink.js and the bounded src/inflate.js).
// The outcome through the real UI, on both builds, is test/sharelink.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  LIMITS, ShareError, FASTENER_KINDS, b64urlEncode, b64urlDecode, extractFragment, parseFragment, decodeFragment, readFragment, makeLink, snapshot, validateEnvelope,
} from "../src/sharelink.js";
import { inflateRaw } from "../src/inflate.js";

const dir = new URL("./projects/", import.meta.url);
const fixture = (name) => { const j = JSON.parse(readFileSync(new URL(name + ".json", dir), "utf8")); return j.doc || j; };
const env = (doc) => ({ app: "jumpstart-3d", version: 1, doc: structuredClone(doc) });
const BASE = "http://127.0.0.1:8765/";
const rejects = async (fn, kind, re) => assert.rejects(Promise.resolve().then(fn), (e) => e instanceof ShareError && (!kind || e.kind === kind) && (!re || re.test(e.message)), `${kind || "any"} ${re || ""}`);
const throwsShare = (fn, kind, re) => assert.throws(fn, (e) => e instanceof ShareError && (!kind || e.kind === kind) && (!re || re.test(e.message)), `${kind || "any"} ${re || ""}`);
const fragOf = (codec, bytes) => `js3d=v1.${codec}.${b64urlEncode(bytes)}`;
const utf8 = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));
// run with raw compression (or raw decompression) missing from the browser, as in an older Safari
async function without(names, fn) {
  const saved = names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]);
  for (const n of names) Object.defineProperty(globalThis, n, { value: undefined, configurable: true, writable: true });
  try { return await fn(); } finally { for (const [n, d] of saved) { if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n]; } }
}

test("base64url: round trip, no padding, strict alphabet and canonical form", () => {
  for (let n = 0; n < 40; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const t = b64urlEncode(b);
    assert.match(t, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...b64urlDecode(t)], [...b]);
  }
  assert.equal(b64urlEncode(Uint8Array.from([251, 255, 254])), "-__-");
  throwsShare(() => b64urlDecode("AAAA="), "damaged"); // padding is not in the alphabet
  throwsShare(() => b64urlDecode("AA+/"), "damaged"); // the standard alphabet is refused
  throwsShare(() => b64urlDecode("A"), "damaged"); // a length that cannot be bytes
  throwsShare(() => b64urlDecode("AAAAA"), "damaged");
  throwsShare(() => b64urlDecode("QR"), "damaged"); // stray bits after the last byte
  throwsShare(() => b64urlDecode("abéd"), "damaged");
});

test("the decoded size is checked from the text length, before allocation", () => {
  const ok = "A".repeat(4096); // 3072 bytes
  assert.equal(b64urlDecode(ok).length, LIMITS.PAYLOAD_BYTES);
  throwsShare(() => b64urlDecode("A".repeat(4097)), "damaged"); // 4097 % 4 === 1
  throwsShare(() => b64urlDecode("A".repeat(4098)), "toolarge"); // 3073 bytes
  const big = "A".repeat(2 ** 28); // would be 192 MB of bytes: refused without decoding a single character
  throwsShare(() => b64urlDecode(big), "toolarge");
});

test("fragment: exact version and codec, the receive cap, and pasted text", () => {
  assert.deepEqual(parseFragment("js3d=v1.d.AAAA"), { codec: "d", payload: "AAAA" });
  assert.deepEqual(parseFragment("js3d=v1.j."), { codec: "j", payload: "" });
  throwsShare(() => parseFragment("js3d=v2.d.AAAA"), "newer", /different version/);
  throwsShare(() => parseFragment("js3d=v01.d.AAAA"), "newer");
  throwsShare(() => parseFragment("js3d=v1.g.AAAA"), "damaged", /compression/);
  throwsShare(() => parseFragment("js3d=v1.dd.AAAA"), "damaged");
  throwsShare(() => parseFragment("js3d=v1.d.AA=="), "damaged");
  throwsShare(() => parseFragment("js3d=1.d.AAAA"), "damaged");
  throwsShare(() => parseFragment("other=v1.d.AAAA"), "damaged");
  const at = "js3d=v1.d." + "A".repeat(LIMITS.FRAGMENT - 10);
  assert.equal(at.length, 4096);
  assert.equal(parseFragment(at).codec, "d");
  throwsShare(() => parseFragment(at + "A"), "toolarge"); // 4097
  // pasting: only the recognized fragment is cut out; nothing is parsed as an address
  assert.equal(extractFragment("  https://example.org/a/b?x=1#js3d=v1.j.e30 \n"), "js3d=v1.j.e30");
  assert.equal(extractFragment("file:///Users/me/dist/jumpstart-3d.html#js3d=v1.j.e30"), "js3d=v1.j.e30");
  assert.equal(extractFragment("js3d=v1.j.e30"), "js3d=v1.j.e30");
  assert.equal(extractFragment("see #js3d=v1.j.e30 thanks"), "js3d=v1.j.e30");
  throwsShare(() => extractFragment("https://example.org/#nothing"), "damaged");
  assert.equal(extractFragment("#js3d=v1.j." + "A".repeat(8192 - 12)).length > 0, true); // 8192 characters in all: allowed
  throwsShare(() => extractFragment("x".repeat(LIMITS.PASTE + 1)), "toolarge");
});

test("j and d are never guessed: JSON tagged d and compressed bytes tagged j both fail", async () => {
  const doc = fixture("beginner-box");
  const json = utf8(env(doc)), z = deflateRawSync(json);
  assert.equal((await readFragment(fragOf("j", json))).id, doc.id);
  assert.equal((await readFragment(fragOf("d", z))).id, doc.id);
  await rejects(() => readFragment(fragOf("d", json)), "damaged");
  await rejects(() => readFragment(fragOf("j", z)), "damaged");
  await rejects(() => decodeFragment(fragOf("j", Uint8Array.from([0xc3, 0x28]))), "damaged", /text/); // invalid UTF-8
  await rejects(() => decodeFragment(fragOf("j", utf8("{not json"))), "damaged");
  await rejects(() => decodeFragment(fragOf("d", z.subarray(0, z.length - 3))), "damaged"); // truncated
});

test("decompression bombs fail while decoding, natively and in the pure-JS decoder", async () => {
  const bomb = deflateRawSync(Buffer.alloc(2 * 1024 * 1024)); // 2 MiB of zeros in about 2 KiB
  assert.ok(bomb.length < LIMITS.PAYLOAD_BYTES, "the bomb fits the compressed cap, so only the output cap stops it: " + bomb.length);
  await rejects(() => decodeFragment(fragOf("d", bomb)), "toolarge");
  await without(["DecompressionStream"], () => rejects(() => decodeFragment(fragOf("d", bomb)), "toolarge"));
  // the decoder's own limit: output exactly at the limit is fine, one byte more is not, and the default is still unbounded
  const data = Buffer.alloc(5000, 7), z = deflateRawSync(data);
  assert.equal(inflateRaw(z, undefined, 5000).length, 5000);
  assert.throws(() => inflateRaw(z, undefined, 4999), /limit/);
  assert.equal(inflateRaw(z).length, 5000);
  const stored = deflateRawSync(Buffer.alloc(3000, 1), { level: 0 });
  assert.throws(() => inflateRaw(stored, undefined, 2999), /limit/);
  assert.equal(inflateRaw(stored, undefined, 3000).length, 3000);
});

// bits for hand-made streams: header bits least-significant first, Huffman codes most-significant first
function bitWriter() {
  const bytes = []; let cur = 0, n = 0;
  const bit = (b) => { cur |= b << n; if (++n === 8) { bytes.push(cur); cur = 0; n = 0; } };
  return {
    lsb: (v, k) => { for (let i = 0; i < k; i++) bit((v >> i) & 1); },
    msb: (v, k) => { for (let i = k - 1; i >= 0; i--) bit((v >> i) & 1); },
    done: () => Uint8Array.from(n ? [...bytes, cur] : bytes),
  };
}
test("the pure-JS decoder refuses malformed streams", () => {
  const w = bitWriter(); // fixed Huffman, final: symbol 286 (a length code that does not exist)
  w.lsb(1, 1); w.lsb(1, 2); w.msb(0b11000110, 8);
  assert.throws(() => inflateRaw(w.done()), /Bad compressed data|ended early/);
  const d = bitWriter(); // symbol 257 (length 3), then distance code 30 (does not exist)
  d.lsb(1, 1); d.lsb(1, 2); d.msb(0b0000001, 7); d.msb(30, 5); d.msb(0, 7);
  assert.throws(() => inflateRaw(d.done()), /Bad compressed data|ended early/);
  const e = bitWriter(); // a match that reaches back before the start
  e.lsb(1, 1); e.lsb(1, 2); e.msb(0b0000001, 7); e.msb(0, 5); e.msb(0, 7);
  assert.throws(() => inflateRaw(e.done()), /Bad compressed data/);
  assert.throws(() => inflateRaw(Uint8Array.from([0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5])), /Bad compressed data/); // LEN and NLEN disagree
  assert.throws(() => inflateRaw(Uint8Array.from([0x01, 0x05])), /ended early/);
  assert.throws(() => inflateRaw(Uint8Array.from([0x07])), /Bad compressed data/); // block type 3
  assert.throws(() => inflateRaw(new Uint8Array(0)), /ended early/);
  const f = bitWriter(); // dynamic block whose code-length repeat runs past the last length: HLIT 257, HDIST 1, HCLEN 4, code 16 gets length 1
  f.lsb(1, 1); f.lsb(2, 2); f.lsb(0, 5); f.lsb(0, 5); f.lsb(0, 4);
  for (const v of [1, 0, 0, 1]) f.lsb(v, 3); // order 16, 17, 18, 0: 16 and 0 both get length 1
  f.msb(1, 1); f.lsb(3, 2); // symbol 16 repeats the previous length, but there is none yet
  assert.throws(() => inflateRaw(f.done()), /Bad compressed data/);
});

test("random damage to a valid stream is an error or a result, never a hang or a crash", () => {
  const z = deflateRawSync(Buffer.from(JSON.stringify(env(fixture("advanced-wall-bracket")))));
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let failed = 0;
  for (let i = 0; i < 3000; i++) {
    const m = Uint8Array.from(z);
    for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) m[Math.floor(rnd() * m.length)] ^= 1 << Math.floor(rnd() * 8);
    try { inflateRaw(m, undefined, LIMITS.JSON_BYTES); } catch (e) { assert.ok(e instanceof Error); failed++; }
  }
  assert.ok(failed > 0);
});

test("every project fixture makes a link, or is refused as too big, and reads back unchanged", async () => {
  let made = 0, large = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const doc = fixture(f.replace(/\.json$/, ""));
    const r = await makeLink(doc, BASE);
    if (!r.ok && JSON.stringify(doc).includes('"codeCad"')) { assert.equal(r.reason, "unsupported", f + ": " + r.message); continue; } // Code CAD text is not carried by a link (codecad.spec.mjs)
    if (!r.ok) { assert.equal(r.reason, "large", f + ": " + r.message); assert.match(r.message, /project file/); large++; continue; }
    assert.ok(r.url.length <= LIMITS.URL, f);
    assert.equal(r.codec, "d", f);
    const back = await readFragment(r.url.slice(r.url.indexOf("#") + 1));
    assert.deepEqual(back, snapshot(doc), f);
    made++;
  }
  assert.ok(made >= 30 && large >= 1, `${made} made, ${large} too large`);
});

test("without raw compression a small design still makes a j link that reads back; a larger one offers the file", async () => {
  await without(["CompressionStream", "DecompressionStream"], async () => {
    const small = fixture("beginner-box");
    const r = await makeLink(small, BASE);
    assert.equal(r.ok, true);
    assert.equal(r.codec, "j");
    assert.match(r.url, /#js3d=v1\.j\./);
    assert.deepEqual(await readFragment(r.url.split("#")[1]), snapshot(small));
    const big = await makeLink(fixture("nameplate"), BASE);
    assert.equal(big.ok, false);
    assert.equal(big.reason, "large");
  });
  // a browser whose CompressionStream refuses the format
  const saved = globalThis.CompressionStream;
  globalThis.CompressionStream = class { constructor() { throw new TypeError("Unsupported compression format: 'deflate-raw'"); } };
  try { assert.equal((await makeLink(fixture("beginner-box"), BASE)).codec, "j"); } finally { globalThis.CompressionStream = saved; }
});

test("the whole generated address is capped at exactly 4096 characters, for both codecs", async () => {
  const doc = fixture("advanced-wall-bracket");
  for (const tags of [[], ["CompressionStream"]]) {
    await without(tags, async () => {
      const probe = await makeLink(doc, BASE), base0 = "http://h/";
      const sizeFor = async (pad) => makeLink(doc, base0 + "x".repeat(pad));
      // find the pad that puts the link exactly on the limit (the payload does not depend on the base)
      const payload = probe.ok ? probe.url.length - BASE.length : (await sizeFor(0)).size - base0.length;
      const want = LIMITS.URL - payload;
      if (want < 0) return; // this codec cannot fit the design at all (j): covered above
      const atCap = await makeLink(doc, base0 + "x".repeat(want - base0.length));
      assert.equal(atCap.ok, true, "exactly 4096 is allowed");
      assert.equal(atCap.url.length, LIMITS.URL);
      const over = await makeLink(doc, base0 + "x".repeat(want - base0.length + 1));
      assert.equal(over.ok, false, "4097 is refused");
      assert.equal(over.reason, "large");
    });
  }
});

test("a design that is too large or unsupported is refused with the project-file message", async () => {
  const r = await makeLink(fixture("holepattern-shapes"), BASE);
  assert.equal(r.ok, false);
  assert.match(r.message, /too large for a reliable share link\. Send a project file instead\./);
  const chisel = { ...fixture("beginner-box"), mode: "chisel" };
  const c = await makeLink(chisel, BASE);
  assert.equal(c.ok, false);
  assert.equal(c.reason, "unsupported");
  assert.match(c.message, /Use a project file for this design/);
});

test("the sender's snapshot drops only the storage time and the scene's cache keys", () => {
  const doc = structuredClone(fixture("beginner-peg-block"));
  doc._updated = 5; doc.bodies[0]._key = "abc";
  const s = snapshot(doc);
  assert.equal(s._updated, undefined);
  assert.equal(s.bodies[0]._key, undefined);
  assert.equal(doc.bodies[0]._key, "abc"); // the live document is not touched
  delete doc._updated; delete doc.bodies[0]._key;
  assert.deepEqual(s, doc);
});

// ---------------------------------------------------------------- the checks on a decoded project
const valid = (mutate, name) => {
  const e = env(fixture(name || "advanced-sketch-extrude"));
  mutate(e.doc, e);
  return e;
};
const bad = (mutate, kind, re, name) => assert.throws(() => validateEnvelope(valid(mutate, name)), (e) => e instanceof ShareError && (!kind || e.kind === kind) && (!re || re.test(e.message)));

test("the envelope is exact: app, version, doc", () => {
  validateEnvelope(valid(() => {}));
  for (const e of [null, [], "x", { app: "other", version: 1, doc: {} }, { app: "jumpstart-3d", version: 2, doc: {} }, { app: "jumpstart-3d", version: 1 }, { app: "jumpstart-3d", version: 1, doc: [] }]) {
    throwsShare(() => validateEnvelope(e), "damaged");
  }
  throwsShare(() => validateEnvelope({ ...valid(() => {}), extra: 1 }), "unsupported");
  bad((d) => { d.v = 2; }, "damaged");
  bad((d, e) => { delete d.bodies; }, "damaged");
});

test("dangerous names are refused wherever they sit", () => {
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const e = JSON.parse(JSON.stringify(env(fixture("beginner-box"))).replace(/^\{/, `{"${key}":{"x":1},`));
    throwsShare(() => validateEnvelope(e), "damaged");
    const inner = JSON.parse(JSON.stringify(env(fixture("beginner-box"))).replace('"p":{', `"p":{"${key}":1,`));
    throwsShare(() => validateEnvelope(inner), "damaged");
  }
});

test("unknown fields, types and kinds are refused with the project-file message, not trimmed", () => {
  bad((d) => { d.surprise = 1; }, "unsupported", /Use a project file/);
  bad((d) => { d.mode = "chisel"; }, "unsupported", /chisel/);
  bad((d) => { d.mode = "arch"; }, "unsupported");
  bad((d) => { d.mode = "nonsense"; }, "unsupported");
  bad((d) => { d.joints = [{ id: "j1", name: "Hinge joint", seq: 1, type: "revolute", body: d.bodies[0].id, parent: null, o: [0, 0, 0], d: [0, 0, 1], limited: false, min: -180, max: 180 }]; }, "unsupported", /not part of a gear set/); // a joint the person made: only gear joints travel in a link
  bad((d) => { d.arch = {}; }, "unsupported");
  bad((d) => { d.texImages = {}; }, "unsupported");
  bad((d) => { d.bodies[0].textures = []; }, "unsupported");
  bad((d) => { d.bodies[0].appearance = {}; }, "unsupported");
  bad((d) => { d.bodies[0].sculpt = {}; }, "unsupported");
  bad((d) => { d.bodies[0].node.t = "evil"; }, "unsupported");
  bad((d) => { d.bodies[0].node.script = "alert(1)"; }, "unsupported");
  bad((d) => { d.bodies[0].node.mods = [{ id: "m1", t: "run", seq: 1 }]; }, "unsupported");
  bad((d) => { d.bodies[0].node.mods = [{ id: "m1", t: "hole", seq: 1, onload: "x" }]; }, "unsupported");
  bad((d) => { d.bodies[0].node.mods = [{ id: "m1", t: "bool", seq: 1, src: "combine", tools: [] }]; }, "unsupported");
  bad((d) => { d.sketches[0].ents[0] = { id: "e1", t: "ellipse" }; }, "unsupported");
  bad((d) => { d.sketches[0].cons = [{ id: "k1", t: "script" }]; }, "unsupported");
  bad((d) => { d.assets = { a1: { kind: "sculpt", name: "x", data: "AAAA" } }; }, "unsupported");
  bad((d) => { d.bodies[0].node = { t: "prim", kind: "teapot", p: {}, mods: [] }; }, "unsupported");
  bad((d) => { d.bodies[0].node.mods = [{ id: "m1", t: "hole", seq: 1, dia: 1, evil: 1 }]; }, "unsupported");
});

test("structure: depth, entries, counts and their exact edges", () => {
  const nest = (depth) => { let o = { t: "prim", kind: "box", p: {}, mods: [] }; for (let i = 0; i < depth; i++) o = { t: "group", children: [{ node: o, m: structuredClone(fixture("beginner-box").bodies[0].m) }], mods: [] }; return o; };
  // each group adds three levels (node, children array, child object): well inside 64 at 10, past it at 25
  validateEnvelope(valid((d) => { d.bodies[0].node = nest(10); }, "beginner-box"));
  bad((d) => { d.bodies[0].node = nest(25); }, "toolarge", /nested/, "beginner-box");
  // total entries
  bad((d) => { d.params = []; d.planes = []; d.sketches[0].pts = Array.from({ length: 14000 }, (_, i) => ({ id: "p" + i, x: i, y: i })); d.sketches[0].ents = []; d.sketches[0].cons = []; }, "toolarge", /too many/);
  // bodies, sketches, parameters
  const box = fixture("beginner-box").bodies[0];
  const many = (n) => Array.from({ length: n }, (_, i) => ({ ...structuredClone(box), id: "b" + i }));
  validateEnvelope(valid((d) => { d.bodies = many(LIMITS.BODIES); }, "beginner-box"));
  bad((d) => { d.bodies = many(LIMITS.BODIES + 1); }, "damaged", /bodies/, "beginner-box");
  const sk = (n) => Array.from({ length: n }, (_, i) => ({ id: "s" + i, name: "S", seq: 1, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [] }));
  validateEnvelope(valid((d) => { d.sketches = sk(LIMITS.SKETCHES); }, "beginner-box"));
  bad((d) => { d.sketches = sk(LIMITS.SKETCHES + 1); }, "damaged", /sketches/, "beginner-box");
  const params = (n) => Array.from({ length: n }, (_, i) => ({ id: "q" + i, name: "n" + i, expr: "1", value: 1 }));
  validateEnvelope(valid((d) => { d.params = params(LIMITS.PARAMS); }, "beginner-box"));
  bad((d) => { d.params = params(LIMITS.PARAMS + 1); }, "damaged", /parameters/, "beginner-box");
  // the entry count is exact: a list of references pads it one entry at a time
  const count = (x) => { let n = 0; const st = [x]; while (st.length) { const v = st.pop(); if (Array.isArray(v)) { n += v.length; st.push(...v.filter((q) => q && typeof q === "object")); } else if (v && typeof v === "object") { n += Object.keys(v).length; st.push(...Object.values(v).filter((q) => q && typeof q === "object")); } } return n; };
  const padTo = (total) => (d) => {
    d.sketches = [{ id: "s1", name: "S", seq: 1, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [{ id: "p1", x: 0, y: 0 }], ents: [0, 1, 2, 3, 4].map((i) => ({ id: "e" + i, t: "spline", pts: [] })) }];
    let left = total - count({ app: "jumpstart-3d", version: 1, doc: d });
    for (const e of d.sketches[0].ents) { const n = Math.min(left, 15000); e.pts = Array(n).fill("p1"); left -= n; }
  };
  validateEnvelope(valid(padTo(LIMITS.ENTRIES), "beginner-box"));
  bad(padTo(LIMITS.ENTRIES + 1), "toolarge", /too many/, "beginner-box");
  // names and expressions at their edges
  validateEnvelope(valid((d) => { d.name = "n".repeat(LIMITS.NAME); }, "beginner-box"));
  bad((d) => { d.name = "n".repeat(LIMITS.NAME + 1); }, "damaged", /name/, "beginner-box");
  validateEnvelope(valid((d) => { d.params = [{ id: "q1", name: "w", expr: "1" + " ".repeat(LIMITS.EXPR - 1), value: 1 }]; }, "beginner-box"));
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "1" + " ".repeat(LIMITS.EXPR), value: 1 }]; }, "damaged", /expression/, "beginner-box");
});

test("numbers must be finite and placements must be real, affine and invertible", () => {
  assert.throws(() => validateEnvelope(JSON.parse(JSON.stringify(env(fixture("beginner-box"))).replace('"w":', '"w":1e999,"x":'))), (e) => e instanceof ShareError); // 1e999 reads as Infinity
  const M = (x) => x;
  bad((d) => { d.bodies[0].m = M(d.bodies[0].m.slice(0, 15)); }, "damaged", /numbers/, "beginner-box");
  bad((d) => { d.bodies[0].m[3] = 1; }, "damaged", /affine/, "beginner-box");
  bad((d) => { d.bodies[0].m[15] = 2; }, "damaged", /affine/, "beginner-box");
  bad((d) => { d.bodies[0].m = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }, "damaged", /flattens/, "beginner-box");
  bad((d) => { d.bodies[0].m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((v, i) => (i === 12 ? "5" : v)); }, "damaged", /number/, "beginner-box");
  validateEnvelope(valid((d) => { d.bodies[0].m = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]; }, "beginner-box")); // a mirror image is a real placement
  validateEnvelope(valid((d) => { d.bodies[0].m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1]; }, "beginner-box")); // non-uniform scale too
});

test("references resolve and ids are unique in their scope", () => {
  bad((d) => { d.bodies[0].node.sketch = "nope"; }, "damaged", /missing sketch/);
  bad((d) => { d.sketches[0].ents[0].a = "ghost"; }, "damaged", /missing point/);
  bad((d) => { d.sketches[0].cons = [{ id: "k1", t: "horizontal", e1: "ghost" }]; }, "damaged", /missing shape/);
  bad((d) => { d.bodies.push(structuredClone(d.bodies[0])); }, "damaged", /duplicate body/);
  bad((d) => { d.sketches.push(structuredClone(d.sketches[0])); }, "damaged", /duplicate sketch/);
  bad((d) => { d.sketches[0].pts.push({ ...d.sketches[0].pts[0] }); }, "damaged", /duplicate point/);
  bad((d) => { d.sketches[0].ents.push({ ...d.sketches[0].ents[0] }); }, "damaged", /duplicate shape/);
  bad((d) => { d.bodies[0].node = { t: "mesh", asset: "gone", k: 1, mods: [] }; }, "damaged", /asset/);
  bad((d) => { d.bodies[0].node = { t: "mirror", srcBody: "ghost", plane: { o: [0, 0, 0], n: [1, 0, 0] }, mods: [] }; }, "damaged", /missing body/);
  bad((d) => { d.bodies[0].media = { id: "ghost" }; }, "damaged", /media/);
  const m = fixture("advanced-mirror");
  validateEnvelope({ app: "jumpstart-3d", version: 1, doc: structuredClone(m) }); // a live mirror of a body that is there
});

test("parameters: names, expressions that evaluate, and dependencies", () => {
  const ok = [{ id: "q1", name: "w", expr: "20", value: 20 }, { id: "q2", name: "h", expr: "w*2+5", value: 45 }];
  validateEnvelope(valid((d) => { d.params = structuredClone(ok); }, "beginner-box"));
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "20 +", value: 1 }]; }, "damaged", /does not evaluate/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "eval(1)", value: 1 }]; }, "damaged", /does not evaluate/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "2*h", value: 1 }, { id: "q2", name: "h", expr: "3", value: 3 }]; }, "damaged", /does not evaluate/, "beginner-box"); // sees only the ones above it
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "1/0", value: 1 }]; }, "damaged", /does not evaluate/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "w", value: 1 }]; }, "damaged", /does not evaluate/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "bad name", expr: "1" }]; }, "damaged", /name/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "1" }, { id: "q2", name: "W", expr: "2" }]; }, "damaged", /duplicate/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "w", expr: "1" }, { id: "q1", name: "x", expr: "2" }]; }, "damaged", /duplicate/, "beginner-box");
});

test("repeat counts, turns and sizes stay inside what the app's own controls allow", () => {
  const hole = (extra) => (d) => { d.bodies[0].node.mods = [{ id: "m1", t: "pattern", seq: 1, kind: "linear", what: "all", n1: 1, n2: 1, ...extra }]; };
  validateEnvelope(valid(hole({ n1: 200, n2: 10 }), "beginner-box")); // 200 is the pattern box's top
  validateEnvelope(valid(hole({ n1: 40, n2: 50 }), "beginner-box")); // 2000 copies in all
  validateEnvelope(valid(hole({ cn: 360 }), "beginner-box"));
  for (const extra of [{ n1: 201 }, { n2: 201 }, { n1: 41, n2: 50 }, { n1: 5000 }, { n1: 20000 }, { n1: -1 }, { cn: 361 }, { count: 201 }]) {
    bad(hole(extra), "toolarge", /repeats .*at most/, "beginner-box");
  }
  // a count typed as an expression is held to the same limit
  const viaParam = (n) => (d) => { d.params = [{ id: "q1", name: "N", expr: String(n), value: n }]; d.bodies[0].node.mods = [{ id: "m1", t: "pattern", seq: 1, kind: "linear", what: "all", n1: 2, n2: 1, exprs: { n1: "N" } }]; };
  validateEnvelope(valid(viaParam(200), "beginner-box"));
  bad(viaParam(5000), "toolarge", /repeats/, "beginner-box");
  // coils and springs
  const coil = (turns) => (d) => { d.bodies[0].node.turns = turns; };
  validateEnvelope(valid(coil(400), "advanced-coil"));
  bad(coil(10000), "toolarge", /turns/, "advanced-coil");
  bad(coil(401), "toolarge", /turns/, "advanced-coil");
  const prim = (kind, p) => (d) => { d.bodies[0].node = { t: "prim", kind, p: { w: 20, d: 20, h: 10, ...p }, mods: [] }; };
  validateEnvelope(valid(prim("spring", { turns: 400 }), "beginner-box"));
  bad(prim("spring", { turns: 10000 }), "toolarge", /turns/, "beginner-box");
  validateEnvelope(valid(prim("prism", { sides: 24 }), "beginner-box"));
  bad(prim("prism", { sides: 25 }), "toolarge", /sides/, "beginner-box");
  bad(prim("pyramid", { sides: 13 }), "toolarge", /sides/, "beginner-box");
  validateEnvelope(valid(prim("star", { points: 16 }), "beginner-box"));
  bad(prim("star", { points: 17 }), "toolarge", /points/, "beginner-box");
  // measurements: 100,000 mm is the most, in a size, a sketch point, a placement or an expression
  validateEnvelope(valid(prim("box", { w: 1e5 }), "beginner-box"));
  bad(prim("box", { w: 100001 }), "toolarge", /larger than/, "beginner-box");
  bad(prim("box", { w: 1e9 }), "toolarge", /larger than/, "beginner-box");
  bad((d) => { d.sketches[0].pts[0].x = 1e6; }, "toolarge", /larger than/);
  bad((d) => { d.bodies[0].m[12] = -1e6; }, "toolarge", /larger than/, "beginner-box");
  bad((d) => { d.params = [{ id: "q1", name: "W", expr: "1e7", value: 1 }]; d.bodies[0].node.exprs = { w: "W" }; }, "toolarge", /larger than/, "beginner-box");
  // the creation time and counters are not measurements
  validateEnvelope(valid((d) => { d.created = 1.8e12; d.seq = 7000000; }, "beginner-box"));
});

test("pictures and models: embedded raster data only, 256 KiB in all, nothing from outside", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const img = (src) => (d) => { d.sketches[0].image = { src, name: "p", w: 10, h: 10, cx: 0, cy: 0, rot: 0, opacity: 0.6 }; };
  validateEnvelope(valid(img(png)));
  validateEnvelope(valid(img("data:image/jpeg;base64,/9j/4AAQ")));
  validateEnvelope(valid(img("data:image/webp;base64,UklGRg==")));
  for (const src of ["http://example.org/a.png", "https://example.org/a.png", "//example.org/a.png", "file:///etc/passwd", "blob:http://x/1", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:text/html;base64,PGI+", "data:image/png,rawtext", "data:image/png;base64,@@@@", "data:image/gif;base64,R0lGODlh", " data:image/png;base64,AAAA", "data:image/png;base64,AAAA\n", "ftp://x/y.png", "/relative/a.png", "a.png"]) {
    bad(img(src), "unsupported", /outside the design/);
  }
  const media = (src) => (d) => { d.media = { m1: { kind: "image", name: "p", src, w: 4, h: 4 } }; d.bodies[0].media = { id: "m1", map: "wrap" }; };
  validateEnvelope(valid(media(png)));
  bad(media("https://example.org/a.png"), "unsupported", /outside the design/);
  bad(media("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "unsupported");
  bad((d) => { d.media = { m1: { kind: "video", name: "p", src: "https://example.org/v.mp4" } }; }, "unsupported");
  const asset = (bytes) => (d) => { d.assets = { a1: { kind: "mesh", name: "m", data: "A".repeat((bytes / 3) * 4) } }; }; // bytes: a multiple of 3
  const MAX = LIMITS.ASSET_BYTES - 1; // the largest multiple of 3 that fits: 262143
  validateEnvelope(valid(asset(MAX)));
  bad(asset(MAX + 3), "toolarge", /too big/);
  bad((d) => { d.assets = { a1: { kind: "mesh", name: "m", data: "AAAAA" } }; }, "damaged", /base64/);
  bad((d) => { d.assets = { a1: { kind: "mesh", name: "m", data: "AAA*" } }; }, "damaged", /base64/);
  // pictures and models share one budget
  bad((d) => { asset(MAX)(d); img(png)(d); }, "toolarge", /too big/);
});

test("print paint (painted 3MF): a painted design round-trips; anything outside the shape the 3D Print Sim writes is refused", async () => {
  const name = "painted-cube", doc = fixture(name);
  const link = await makeLink(doc, BASE);
  assert.equal(link.ok, true);
  assert.deepEqual((await readFragment(link.url.slice(link.url.indexOf("#") + 1))).printPaint, doc.printPaint);
  validateEnvelope(valid((d) => { delete d.printPaint.faces; }, name)); // the sim always writes faces, but a design without is read as before
  const n = LIMITS.PAINT_FACES;
  validateEnvelope(valid((d) => { d.printPaint.faces.b1 = { n, f: { [n - 1]: 1 } }; }, name)); // the edges
  bad((d) => { d.printPaint.extra = 1; }, "unsupported", /print paint/, name);
  bad((d) => { d.printPaint.faces.b1.extra = 1; }, "unsupported", /painted faces/, name);
  bad((d) => { d.printPaint.of = { nope: 0 }; }, "damaged", /missing body/, name);
  bad((d) => { d.printPaint.faces = { nope: { n: 6, f: { 0: 1 } } }; }, "damaged", /missing body/, name);
  bad((d) => { d.printPaint.faces.b1.f = { "-1": 1 }; }, "damaged", /face number/, name);
  bad((d) => { d.printPaint.faces.b1.f = { 1.5: 1 }; }, "damaged", /face number/, name);
  bad((d) => { d.printPaint.faces.b1.f = { 6: 1 }; }, "damaged", /face number/, name); // n is 6: faces are 0 to 5
  bad((d) => { d.printPaint.faces.b1 = { n: n + 1, f: {} }; }, "damaged", /face count/, name);
  bad((d) => { d.printPaint.faces.b1 = { n: 6.5, f: {} }; }, "damaged", /face count/, name);
  bad((d) => { d.printPaint.faces.b1 = { n: 99999999, f: { 99999998: 1 } }; }, "toolarge", undefined, name); // caught by the measurement cap first
  bad((d) => { d.printPaint.faces.b1.f = { 99999998: 1 }; }, "damaged", /face number/, name);
  bad((d) => { d.printPaint.slots[1] = "red"; }, "damaged", /colour/, name);
  bad((d) => { d.printPaint.slots[1] = "url(http://x)"; }, "damaged", /colour/, name);
  bad((d) => { d.printPaint.slots[1] = 5; }, "damaged", /colour/, name);
  bad((d) => { d.printPaint.of.b1 = 5; }, "damaged", /filament number/, name); // 5 slots: 0 to 4
  bad((d) => { d.printPaint.of.b1 = -1; }, "damaged", /filament number/, name);
  bad((d) => { d.printPaint.of.b1 = "1"; }, "damaged", /filament number/, name);
  bad((d) => { d.printPaint.faces.b1.f[0] = 1.5; }, "damaged", /filament number/, name);
  bad((d) => { d.printPaint.slots = Array.from({ length: 16 }, () => "#112233"); }, "damaged", /filaments/, name); // the file codes 15
  bad((d) => { d.printPaint = []; }, "damaged", /print paint/, name);
  bad((d) => { d.printPaint.of = null; }, "damaged", /filament of each body/, name);
  bad((d) => { d.printPaint.faces.b1.f = []; }, "damaged", /painted faces/, name);
  throwsShare(() => validateEnvelope(JSON.parse(JSON.stringify(env(doc)).replace('"of":{', '"of":{"__proto__":1,'))), "damaged");
});

test("print paint: the painted-face cap counts every body together, not each body alone", () => {
  const name = "painted-cube", n = LIMITS.PAINT_FACES / 2; // 2048 faces per body
  const two = (each) => (d) => {
    d.bodies.push({ ...structuredClone(d.bodies[0]), id: "b2", name: "Cube 2", seq: 2 });
    const f = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [i, 1]));
    d.printPaint.faces = { b1: { n: 2 * n, f: f(each) }, b2: { n: 2 * n, f: f(each) } };
  };
  validateEnvelope(valid(two(n), name)); // 2048 + 2048 = 4096: exactly the cap
  bad(two(n + 1), "toolarge", /too many painted faces/, name); // 2049 + 2049 = 4098: each body is under the cap, the total is not
});

test("names are only ever text: a literal element in a name survives as text", async () => {
  const name = '<img src=x onerror="alert(1)">';
  const r = await makeLink(valid((d) => { d.name = name; }, "beginner-box").doc, BASE);
  assert.equal(r.ok, true);
  assert.equal((await readFragment(r.url.split("#")[1])).name, name);
});

test("fill openings survives sharing and validates nested keep entries", async () => {
  const doc = fixture("beginner-box"), mod = {id:"fill",seq:2,t:"fillopen",plane:{o:[0,0,3],n:[0,0,1]},keep:[{c:[2,4,3],a:19.5}]};
  doc.bodies[0].node.mods=[mod];
  const link=await makeLink(doc,BASE); assert.equal(link.ok,true);
  const read=await readFragment(extractFragment(link.url)); assert.deepEqual(read.bodies[0].node.mods,[mod]);
  for(const entry of [{c:[1,2],a:2},{c:[1,2,3],a:-1},{c:[1,2,3],a:2,extra:true}]) {
    const bad=structuredClone(doc);bad.bodies[0].node.mods[0].keep=[entry];throwsShare(()=>validateEnvelope(env(bad)),entry.extra ? "unsupported" : "damaged");
  }
});

test("STEP parts (#173): a step node may carry parts: true and keeppiece pieces with src import; nothing else may", () => {
  const part = (mutate) => (d) => { const n = d.bodies[0].node; n.parts = true; n.mods = [{ id: "f1", seq: 2, t: "keeppiece", piece: 0, count: 3, src: "import" }]; mutate?.(n, d); };
  validateEnvelope(valid(part(), "import-step"));
  bad(part((n) => { n.parts = false; }), "damaged", /parts flag/, "import-step"); // true or absent, never false
  bad(part((n) => { n.parts = "yes"; }), "damaged", /parts flag/, "import-step");
  bad((d) => { d.bodies[0].node.parts = true; d.bodies[0].node.t = "prim"; d.bodies[0].node.kind = "box"; d.bodies[0].node.p = { w: 1, d: 1, h: 1 }; delete d.bodies[0].node.asset; }, "damaged", /parts flag/, "import-step");
  bad(part((n) => { n.mods[0].src = "other"; }), "damaged", /modifier source/, "import-step"); // a combine's source is not shareable here
  bad(part((n) => { n.mods[0].t = "fillet"; }), "damaged", /modifier source/, "import-step"); // only the keeppiece of an import
});

// The schema only: a real STEP file is too big for a link (4096 characters), so this asset is a stand-in and the parts would not build. That they build is test/step-parts.spec.mjs.
test("STEP parts (#173): the parts fields make a link and read back unchanged (schema only, no real file)", async () => {
  const doc = fixture("import-step");
  const first = doc.bodies[0];
  doc.bodies = [0, 1, 2].map((i) => { const b = structuredClone(first); b.id = "p" + i; b.name = "box part " + (i + 1); b.node.parts = true; b.node.mods = [{ id: "k" + i, seq: i + 2, t: "keeppiece", piece: i, count: 3, src: "import" }]; return b; });
  const link = await makeLink(doc, BASE);
  assert.equal(link.ok, true);
  const read = await readFragment(extractFragment(link.url));
  assert.deepEqual(read.bodies.map((b) => b.node), doc.bodies.map((b) => b.node));
});

// J.Siwek 2.8.1.3: the Fasteners dialog keeps its settings on the body (b.fastener), so the dialog can edit the part again
test("a body made by the Fasteners dialog passes with its settings; unknown fields, kinds and out-of-range values are refused", () => {
  const doc = { v: 1, id: "f", name: "F", mode: "advanced", created: 1, seq: 1, grid: 1, sketches: [], planes: [], joints: [], bodies: [
    { id: "b1", name: "Hex nut M8", seq: 1, color: "#c7ccd2", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      node: { t: "prim", kind: "cylinder", p: { w: 8, d: 8, h: 6.8 }, mods: [] },
      fastener: { kind: "nut", std: "metric", size: "M8", len: 24, threads: true, name: "Hex nut M8", clear: -0.1, left: false } }] };
  assert.equal(validateEnvelope(env(doc)).bodies[0].fastener.size, "M8");
  const with_ = (change) => { const d = structuredClone(doc); Object.assign(d.bodies[0].fastener, change); return env(d); };
  assert.equal(validateEnvelope(with_({ len: null })).bodies[0].fastener.len, null); // a nut made before a length was set
  for (const [change, re] of [[{ script: "x" }, /fastener/], [{ threads: "yes" }, /threads/], [{ kind: "rocket" }, /fastener kind/], [{ std: "imperial" }, /fastener standard/],
    [{ len: 0 }, /fastener length/], [{ len: 2e5 }, null], [{ clear: -1.5 }, /print offset/], [{ clear: 2 }, /print offset/]]) throwsShare(() => validateEnvelope(with_(change)), null, re);
});

test("the share link's list of fastener kinds is the dialog's list", () => {
  const src = readFileSync(new URL("../src/fasteners.js", import.meta.url), "utf8");
  const ids = [...src.matchAll(/\{ id: "([a-z]+)", label: "[^"]+", group: "/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15);
  assert.deepEqual([...FASTENER_KINDS].sort(), ids.sort());
});

test("a Fixed in a link: needs a point and a position, once per point, and never on a projected shape", () => {
  const fx = (d, extra) => { d.sketches[0].cons = [{ id: "k1", t: "fixed", p: "p0", x: 0, y: 0, ...extra }]; };
  validateEnvelope(valid((d) => fx(d)));
  bad((d) => fx(d, { x: undefined }), "damaged");
  bad((d) => fx(d, { p: "nope" }), "damaged");
  bad((d) => { fx(d); d.sketches[0].cons.push({ id: "k2", t: "fixed", p: "p0", x: 0, y: 0 }); }, "damaged", /twice/);
  bad((d) => { fx(d); d.sketches[0].cons.push({ id: "k2", t: "origin", p: "p0" }); }, "damaged", /twice/);
  bad((d) => { fx(d); d.sketches[0].ents[0].proj = true; }, "damaged", /projected/);
});

test("new parts and sweep paths survive sharing and reject unsafe data", async () => {
  const { BIN_DEFAULTS, binParts } = await import('../src/bins.js');
  const { HINGE_DEFAULTS, hingeParts } = await import('../src/hinges.js');
  const body = fixture('beginner-box').bodies[0];
  const doc = fixture('beginner-box');
  const bin = { ...BIN_DEFAULTS, cols: 1, rows: 1, scoop: false, lid: true };
  const bp = binParts(bin);
  const hinge = { ...HINGE_DEFAULTS, type: 'living' };
  const hp = hingeParts(hinge);
  const b = (id, node, extra) => ({ ...structuredClone(body), id, node, ...extra });
  const examples = [
    [b('bin', bp.bin, { bin: { ...bin, lidId: 'lid' } }), b('lid', bp.lid, { binLid: 'bin' })],
    [b('hinge', hp.a, { hinge: { ...hinge, bId: null, pinId: null, kind: 'Living hinge' } })],
    [b('rounded', { t: 'prim', kind: 'box', p: { w: 10, d: 10, h: 10, rv: 2 }, mods: [] }, {})],
    [b('sweep', { t: 'sweep', sketch: 's1', profiles: [{ key: 'e0,e1,e2,e3', pt: [15, 10] }], edgeSegs: [{ t: 'line', a: [0,0,0], b: [0,0,10] }], railEdgeSegs: [{ t: 'bsp', a: [1,0,0], b: [1,0,10], pts: [[1,0,0],[1,0,10]] }], railScale: true, mods: [] }, {})],
  ];
  const skdoc = fixture('advanced-sketch-extrude');
  const sk = skdoc.sketches[0];
  for (const bodies of examples) {
    const d = { ...structuredClone(doc), bodies, sketches: bodies[0].id === 'sweep' ? [{ ...structuredClone(sk), id: 's1' }] : [] };
    const link = await makeLink(d, BASE);
    assert.equal(link.ok, true, link.message);
    assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  }
  const d = { ...structuredClone(doc), bodies: examples[0], sketches: [] };
  for (const change of [{ extra: 1 }, { w: NaN }, { w: Infinity }, { w: 100001 }, { cols: -1 }]) {
    const x = structuredClone(d); Object.assign(x.bodies[0].bin, change); throwsShare(() => validateEnvelope(env(x)));
  }
  const s = { ...structuredClone(doc), bodies: examples[3], sketches: [{ ...structuredClone(sk), id: 's1' }] };
  for (const change of [{ extra: 1 }, { a: [0, 0, Infinity] }, { a: [0, 0, 100001] }]) {
    const x = structuredClone(s); Object.assign(x.bodies[0].node.edgeSegs[0], change); throwsShare(() => validateEnvelope(env(x)));
  }
  const x = structuredClone(s); x.bodies[0].node.railEdgeSegs[0].pts = Array(LIMITS.SKETCH_ITEMS + 1).fill([0,0,0]); throwsShare(() => validateEnvelope(env(x)));
  const y = structuredClone(s); y.bodies[0].node.rail = { sketch: 's1', ents: ['missing'] }; throwsShare(() => validateEnvelope(env(y)));
});

test("J.Siwek 2.9.5 Box Maker sets (a stacked door case) survive sharing; their part references are checked", async () => {
  const { BIN_DEFAULTS, binSet } = await import('../src/bins.js');
  const base = fixture('beginner-box'), body = base.bodies[0];
  const o = { ...BIN_DEFAULTS, style: 'door', units: 2, doorPull: 'bar', layout: 'print' };
  const set = binSet(o), ids = {};
  for (const q of set.parts) if (q.key !== 'main') ids[q.key] = 'p_' + q.key;
  const bodies = set.parts.map((q) => ({ ...structuredClone(body), id: q.key === 'main' ? 'main' : ids[q.key], node: q.node, ...(q.key === 'main' ? { bin: { ...o, ids } } : { binPart: 'main' }) }));
  const d = { ...structuredClone(base), bodies, sketches: [] };
  const link = await makeLink(d, BASE);
  assert.equal(link.ok, true, link.message);
  assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  for (const change of [{ style: 'safe' }, { units: 9 }, { doorPull: 'rope' }, { ids: { evil: 'p_case1' } }, { caseT: -1 }]) {
    const x = structuredClone(d); Object.assign(x.bodies[0].bin, change); throwsShare(() => validateEnvelope(env(x)));
  }
  const y = structuredClone(d); y.bodies[1].binPart = y.bodies[2].id; throwsShare(() => validateEnvelope(env(y))); // a part pointing at another part, not the set
  const z = structuredClone(d); z.bodies[1].bin = { ...o }; throwsShare(() => validateEnvelope(env(z))); // both a set and a part of one
  // the parts' own outlines (extrudes with regions on a plane, no sketch) are checked piece by piece
  const outline = (x) => { const st = [x.bodies.map((q) => q.node)]; while (st.length) { const n = st.pop(); if (Array.isArray(n)) { st.push(...n); continue; } if (n.t === 'extrude' && n.regions) return n; if (n.children) st.push(n.children.map((c) => c.node)); } };
  assert.ok(outline(d), 'a door set has an outline extrude');
  for (const harm of [(n) => { n.regions[0].outer[0].t = 'bez'; }, (n) => { delete n.plane; }, (n) => { n.regions[0].outer[0].a = [0, Infinity]; }, (n) => { n.regions[0].outer[0].evil = 1; }, (n) => { n.plane.n = [0, 0, 0]; }]) {
    const x = structuredClone(d); harm(outline(x)); throwsShare(() => validateEnvelope(env(x)));
  }
});

test("J.Siwek 2.9.8 Box Maker grids and side joints survive sharing; only his new fields, in his ranges", async () => {
  const { BIN_DEFAULTS, binSet } = await import('../src/bins.js');
  const base = fixture('beginner-box'), body = base.bodies[0];
  const make = (o) => {
    const set = binSet(o), ids = {};
    for (const q of set.parts) if (q.key !== 'main') ids[q.key] = 'p_' + q.key;
    const bodies = set.parts.map((q) => ({ ...structuredClone(body), id: q.key === 'main' ? 'main' : ids[q.key], node: q.node, ...(q.key === 'main' ? { bin: { ...o, ids } } : { binPart: 'main' }) }));
    return { ...structuredClone(base), bodies, sketches: [] };
  };
  // a 2 x 2 grid of bins joined with dovetails, and a row of door cases joined with pegs
  for (const o of [{ ...BIN_DEFAULTS, cols: 1, rows: 1, scoop: false, across: 2, units: 2, sideLock: 'dovetail' }, { ...BIN_DEFAULTS, style: 'door', across: 2, units: 1, sideLock: 'pegs' }]) {
    const d = make(o);
    const link = await makeLink(d, BASE);
    assert.equal(link.ok, true, link.message);
    assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  }
  const d = make({ ...BIN_DEFAULTS, cols: 1, rows: 1, scoop: false, across: 2, units: 2, sideLock: 'dovetail' });
  assert.deepEqual(Object.keys(d.bodies[0].bin.ids).sort(), ['bin1', 'bin2', 'bin3']);
  // the largest grid's keys pass the key check (8 x 8 cases: case63 and front63)
  const big = structuredClone(d); Object.assign(big.bodies[0].bin, { units: 8, across: 8 }); big.bodies[0].bin.ids = { case63: 'p_bin1', front63: 'p_bin2', front0: 'p_bin3' };
  for (const q of big.bodies.slice(1)) q.binPart = 'main';
  assert.doesNotThrow(() => validateEnvelope(env(big)));
  const bad = (change) => { const x = structuredClone(d); Object.assign(x.bodies[0].bin, change); throwsShare(() => validateEnvelope(env(x))); };
  for (const change of [{ across: 0 }, { across: 9 }, { across: 2.5 }, { across: '2' }, { sideLock: 'glue' }, { sideLock: 1 }, { sideJoints: true }, { down: 2 }]) bad(change);
  for (const key of ['bin64', 'case64', 'front64', 'bin0', 'bin', 'front', 'bin01', 'A1', 'lid1']) bad({ ids: { ...d.bodies[0].bin.ids, [key]: 'p_x' } });
  // build 30 review: one body under two keys, and a lid that differs from lidId
  bad({ ids: { bin1: 'p_bin1', bin2: 'p_bin1', bin3: 'p_bin3' } });
  const lids = make({ ...BIN_DEFAULTS, cols: 1, rows: 1, scoop: false, lid: true });
  assert.ok(lids.bodies[0].bin.ids.lid);
  const okLid = structuredClone(lids); okLid.bodies[0].bin.lidId = okLid.bodies[0].bin.ids.lid; assert.doesNotThrow(() => validateEnvelope(env(okLid)));
  const twoLids = structuredClone(okLid); twoLids.bodies.push({ ...structuredClone(body), id: 'other', binPart: 'main' }); twoLids.bodies[0].bin.lidId = 'other';
  throwsShare(() => validateEnvelope(env(twoLids)), 'damaged', /two lids/);
});

test("outline extrudes: stretch is two sizes in (0, 1000], and the plane's x is not along its normal (build 30 review)", async () => {
  const { BIN_DEFAULTS, binSet } = await import('../src/bins.js');
  const base = fixture('beginner-box'), body = base.bodies[0];
  const o = { ...BIN_DEFAULTS, style: 'door' }, set = binSet(o);
  const d = { ...structuredClone(base), bodies: [{ ...structuredClone(body), id: 'main', node: set.parts[0].node, bin: { ...o } }], sketches: [] };
  const outline = (x) => { const st = [x.bodies[0].node]; while (st.length) { const n = st.pop(); if (n.t === 'extrude' && n.regions) return n; if (n.children) st.push(...n.children.map((c) => c.node)); } };
  assert.ok(outline(d));
  for (const s of [[1, 1], [0.5, 2], [1e3, 1e-3]]) { const x = structuredClone(d); outline(x).stretch = s; assert.doesNotThrow(() => validateEnvelope(env(x)), String(s)); }
  for (const s of [[1], [1, 1, 1], [0, 1], [-1, 1], [1, 1e3 + 1], [1, NaN], [1, Infinity], ['1', 1], 2, { 0: 1, 1: 1 }, null]) {
    const x = structuredClone(d); outline(x).stretch = s; throwsShare(() => validateEnvelope(env(x)), 'damaged', undefined);
  }
  for (const [px, pn] of [[[0, 1, 0], [0, 1, 0]], [[0, 0, -2], [0, 0, 1]], [[1, 0, 0.01], [-1, 0, 0]]]) {
    const x = structuredClone(d); Object.assign(outline(x).plane, { x: px, n: pn }); throwsShare(() => validateEnvelope(env(x)), 'damaged', /plane direction/);
  }
  const x = structuredClone(d); Object.assign(outline(x).plane, { x: [1, 0, 0.2], n: [0, 0, 1] }); assert.doesNotThrow(() => validateEnvelope(env(x)));
});

test("hinge companions and sketch guide rails check their references and settings", async () => {
  const { HINGE_DEFAULTS, hingeParts } = await import('../src/hinges.js');
  const d = fixture('advanced-sketch-extrude'), base = d.bodies[0], sk = d.sketches[0];
  const options = { ...HINGE_DEFAULTS, type: 'pin', pin: 'printed' }, parts = hingeParts(options);
  const body = (id, node, extra) => ({ ...structuredClone(base), id, node, ...extra });
  d.bodies = [body('a', parts.a, { hinge: { ...options, bId: 'b', pinId: 'pin', kind: 'Pin hinge' } }), body('b', parts.b, { hingePart: 'a' }), body('pin', parts.pin, { hingePart: 'a' })];
  const link = await makeLink(d, BASE); assert.equal(link.ok, true, link.message); assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  for (const change of [{ extra: true }, { knuckles: -1 }, { knuckles: 26 }, { type: 'bad' }, { pin: 'bad' }, { len: Infinity }]) {
    const x = structuredClone(d); Object.assign(x.bodies[0].hinge, change); throwsShare(() => validateEnvelope(env(x)));
  }
  const e = sk.ents.find((item) => item.t === 'line');
  const s = fixture('advanced-sketch-extrude');
  s.bodies[0].node = { t: 'sweep', sketch: sk.id, profiles: [{ key: 'e0,e1,e2,e3', pt: [15, 10] }], path: { sketch: sk.id, ents: [e.id] }, rail: { sketch: sk.id, ents: [e.id] }, railScale: false, mods: [] };
  const sl = await makeLink(s, BASE); assert.equal(sl.ok, true, sl.message); assert.deepEqual(await readFragment(sl.url.split('#')[1]), snapshot(s));
  for (const change of [{ sketch: 'missing' }, { ents: ['missing'] }, { extra: true }, { ents: Array(LIMITS.SKETCH_ITEMS + 1).fill(e.id) }]) {
    const x = structuredClone(s); Object.assign(x.bodies[0].node.rail, change); throwsShare(() => validateEnvelope(env(x)));
  }
  for (const rv of [-1, Infinity, 100001, '2']) { const x = fixture('beginner-box'); x.bodies[0].node.p.rv = rv; throwsShare(() => validateEnvelope(env(x))); }
});


test("unchecked segment fields and edge paths on other nodes are refused", () => {
  for (const key of ['pathSegs', 'railSegs']) {
    const d = fixture('beginner-box'); d.bodies[0].node[key] = [{ t: 'line', a: [0, 0, 0], b: [0, 0, 1] }];
    throwsShare(() => validateEnvelope(env(d)), 'unsupported', new RegExp(key));
  }
  const d = fixture('beginner-box'); d.bodies[0].node.edgeSegs = [];
  throwsShare(() => validateEnvelope(env(d)), 'damaged');
});

test("part references agree in both directions and cannot refer to themselves", () => {
  const base = fixture('beginner-box'); const body = base.bodies[0];
  const b = (id, extra) => ({ ...structuredClone(body), id, ...extra });
  for (const bodies of [
    [b('a', { bin: { lidId: 'b' } }), b('b', {})],
    [b('a', { bin: {} }), b('b', { binLid: 'a' })],
    [b('a', { hinge: { bId: 'b' } }), b('b', {})],
    [b('a', { hinge: {} }), b('b', { hingePart: 'a' })],
    [b('a', { hinge: { bId: 'b', pinId: 'b' } }), b('b', { hingePart: 'a' })],
    ...[{ bin: { lidId: 'a' } }, { binLid: 'a' }, { hinge: { bId: 'a' } }, { hinge: { pinId: 'a' } }, { hingePart: 'a' }].map((x) => [b('a', x)]),
  ]) { const d = { ...base, bodies }; throwsShare(() => validateEnvelope(env(d)), 'damaged'); }
});

test("deleted part companions are dropped from shared links", async () => {
  const base = fixture('beginner-box'), body = base.bodies[0];
  for (const extra of [{ bin: { lidId: 'gone' } }, { binLid: 'gone' }, { hinge: { bId: 'gone', pinId: 'gone2' } }, { hingePart: 'gone' }]) {
    const d = { ...base, bodies: [{ ...structuredClone(body), ...extra }] };
    const link = await makeLink(d, BASE); assert.equal(link.ok, true, link.message);
    const shared = (await readFragment(link.url.split('#')[1])).bodies[0];
    assert.equal(shared.bin?.lidId, undefined); assert.equal(shared.binLid, undefined);
    assert.equal(shared.hinge?.bId, undefined); assert.equal(shared.hinge?.pinId, undefined); assert.equal(shared.hingePart, undefined);
    assert.deepEqual(d.bodies[0], { ...body, ...extra });
  }
});

test("path entries are unique and type maps ignore inherited names", () => {
  const d = fixture('advanced-sketch-extrude'), sk = d.sketches[0], e = sk.ents[0].id;
  for (const t of ['sweep', 'pipe']) for (const key of t === 'sweep' ? ['path', 'rail'] : ['path']) {
    const x = structuredClone(d); x.bodies[0].node = { t, sketch: sk.id, profiles: [], path: { sketch: sk.id, ents: [e] }, mods: [] };
    x.bodies[0].node[key] = { sketch: sk.id, ents: [e, e] };
    throwsShare(() => validateEnvelope(env(x)), 'damaged', /duplicate/);
  }
  const x = structuredClone(d); x.sketches[0].ents[0].t = 'toString'; throwsShare(() => validateEnvelope(env(x)));
  const y = structuredClone(d); y.bodies[0].node = { t: 'pipe', edgeSegs: [{ t: 'toString' }], mods: [] }; throwsShare(() => validateEnvelope(env(y)));
  const z = fixture('beginner-box'); z.bodies[0].media = { id: 'toString' }; throwsShare(() => validateEnvelope(env(z)), 'damaged');
});

test("path and sketch types cannot be coerced into lookup keys", async () => {
  const d = fixture('advanced-sketch-extrude');
  d.bodies[0].node = { t: 'pipe', edgeSegs: [{ t: ['circle'], c: [0,0,0], n: [0,0,1], r: '1e309' }], mods: [] };
  await rejects(() => readFragment(fragOf('d', deflateRawSync(utf8(env(d))))));
  const s = fixture('advanced-sketch-extrude'); s.sketches[0].ents[0].t = ['line'];
  throwsShare(() => validateEnvelope(env(s)));
  const json = JSON.stringify(env(fixture('beginner-box'))).replace('"created":', '"created":1e309,"ignored":');
  await rejects(() => readFragment(fragOf('d', deflateRawSync(utf8(json)))));
});

test("degenerate path arcs and zero normals are refused", () => {
  const d = fixture('advanced-sketch-extrude');
  const check = (segment) => { const x = structuredClone(d); x.bodies[0].node = { t: 'pipe', edgeSegs: [segment], mods: [] }; return () => validateEnvelope(env(x)); };
  for (const m of [[1,0,0], [0,0,0], [1,1e-14,0]]) throwsShare(check({ t: 'arc', a: [0,0,0], m, b: [2,0,0] }));
  throwsShare(check({ t: 'circle', c: [0,0,0], n: [0,0,0], r: 1 }));
  validateEnvelope(env((() => { const x = structuredClone(d); x.bodies[0].node = { t: 'pipe', edgeSegs: [{ t: 'arc', a: [0,0,0], m: [1,1,0], b: [2,0,0] }], mods: [] }; return x; })()));
  const s = structuredClone(d); s.sketches[0].plane.n = [0,0,0]; throwsShare(() => validateEnvelope(env(s)));
  const mirror = fixture('beginner-box'); mirror.bodies.push({ ...structuredClone(mirror.bodies[0]), id: 'other' }); mirror.bodies[0].node = { t: 'mirror', srcBody: 'other', plane: { o: [0,0,0], n: [0,0,0] } }; throwsShare(() => validateEnvelope(env(mirror)), 'damaged', /normal/);
  const fill = fixture('beginner-box'); fill.bodies[0].node.mods = [{ id: 'f', t: 'fillopen', plane: { o: [0,0,0], n: [0,0,0] }, keep: [] }]; throwsShare(() => validateEnvelope(env(fill)));
});

test("sketch paths only reference curve entities", () => {
  const d = fixture('advanced-sketch-extrude'), sk = d.sketches[0];
  sk.ents.push({ id: 'point1', t: 'point', p: sk.pts[0].id });
  for (const t of ['pipe', 'sweep']) for (const key of t === 'sweep' ? ['path', 'rail'] : ['path']) {
    const x = structuredClone(d); x.bodies[0].node = { t, sketch: sk.id, profiles: [], path: { sketch: sk.id, ents: [sk.ents[0].id] }, mods: [] };
    x.bodies[0].node[key] = { sketch: sk.id, ents: ['point1'] };
    throwsShare(() => validateEnvelope(env(x)));
  }
});

test('arc tolerances reject close points and nearly straight paths', () => {
  const d = fixture('advanced-sketch-extrude');
  const check = (arc) => { const x = structuredClone(d); x.bodies[0].node = { t: 'pipe', edgeSegs: [arc], mods: [] }; return () => validateEnvelope(env(x)); };
  for (const [a, m, b] of [
    [[0,0,0], [1,1e-9,0], [2,0,0]],
    [[0,0,0], [0,1e-6,0], [2,0,0]],
    [[0,0,0], [1,1,0], [0,1e-6,0]],
    [[0,0,0], [1,1,0], [1,1 + 5e-7,0]],
  ]) throwsShare(check({ t: 'arc', a, m, b }), 'damaged');
  check({ t: 'arc', a: [0,0,0], m: [1,0.01,0], b: [2,0,0] })();
  const sk = d.sketches[0];
  sk.pts.push({ id: 'arcC', x: 50, y: 50 }, { id: 'arcA', x: 60, y: 50 }, { id: 'arcB', x: 60, y: 50 });
  sk.ents.push({ id: 'arc1', t: 'arc', c: 'arcC', a: 'arcA', b: 'arcB' });
  for (const t of ['pipe', 'sweep', 'loft']) {
    const x = structuredClone(d), path = { sketch: sk.id, ents: ['arc1'] };
    x.bodies[0].node = t === 'loft' ? { t, sections: [], rail: path } : { t, sketch: sk.id, profiles: [], path };
    throwsShare(() => validateEnvelope(env(x)), 'damaged');
  }
});

test('loft paths and sections are allow-listed, and pipes need a path', () => {
  const d = fixture('advanced-sketch-extrude'), sk = d.sketches[0];
  const check = (node) => { const x = structuredClone(d); x.bodies[0].node = node; return () => validateEnvelope(env(x)); };
  const rail = { sketch: sk.id, ents: [sk.ents[0].id] };
  check({ t: 'loft', sections: [{ sketch: sk.id, ref: {} }, { point: { sketch: sk.id, id: sk.pts[0].id } }], rail })(); // the shape the loft tool writes for a point
  throwsShare(check({ t: 'loft', sections: [{ point: { sketch: sk.id, id: sk.pts[0].id, junk: 1 } }] }));
  throwsShare(check({ t: 'loft', sections: [{ point: { sketch: 'nope', id: sk.pts[0].id } }] }));
  throwsShare(check({ t: 'loft', sections: [{ point: true }] }));
  for (const bad of [{ ...rail, junk: 1 }, { ...rail, ents: [{ x: 1 }] }, { ...rail, ents: sk.ents[0].id }, {}]) throwsShare(check({ t: 'loft', sections: [], rail: bad }));
  throwsShare(check({ t: 'loft', sections: [{ sketch: sk.id, junk: 1 }] }));
  throwsShare(check({ t: 'pipe' }), 'damaged', /pipe path/);
});

test('tiny normals and conflicting part roles are refused', () => {
  const d = fixture('beginner-box');
  for (const n of [[1e-200,0,0], [1e-9,0,0]]) {
    const x = structuredClone(d); x.bodies[0].node = { t: 'pipe', edgeSegs: [{ t: 'circle', c: [0,0,0], n, r: 1 }] };
    throwsShare(() => validateEnvelope(env(x)), 'damaged');
  }
  for (const roles of [{ bin: {}, binLid: 'missing' }, { hinge: {}, hingePart: 'missing' }]) {
    const x = structuredClone(d); Object.assign(x.bodies[0], roles); throwsShare(() => validateEnvelope(env(x)), 'damaged');
  }
});

// ---------------------------------------------------------------- J.Siwek 2.9.3 parts (#293): gear sets, their joints, Browser folders
// A gear set as the Gears dialog's apply() in advanced.js writes it: placed at (10, 20), each gear its own body; the first holds the set.
// fullIds: false is what the dialog really saves on a new set (only the first gear in ids; the others point back with gearPart).
async function gearDoc(o0 = {}, { fullIds = false } = {}) {
  const { GEAR_DEFAULTS, gearSet } = await import('../src/gearlib.js');
  const o = { ...GEAR_DEFAULTS, ...o0 }, set = gearSet(o), body = fixture('beginner-box').bodies[0];
  const at = [10, 20], ids = {}, jids = {};
  const bid = (p, i) => (i === 0 ? 'g_main' : 'g_' + p.key);
  set.parts.forEach((p, i) => { if (i === 0 || fullIds) ids[p.key] = bid(p, i); jids[p.key] = 'j_' + p.key; });
  const bodies = set.parts.map((p, i) => {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const b = { ...structuredClone(body), id: bid(p, i), name: p.name, seq: i + 1, color: p.color, m: [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, at[0] + p.x, at[1] + p.y, 0, 1], node: p.node };
    if (i === 0) b.gear = { o: { ...o }, ids, jids: o.joints ? jids : {}, base: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...at, 0, 1], base0: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...at, 0, 1], spin: 0 };
    else b.gearPart = 'g_main';
    return b;
  });
  const joints = o.joints ? set.parts.map((p, i) => ({ id: jids[p.key], name: p.name + ' joint', seq: 10 + i, type: p.joint.type, body: bid(p, i), parent: null, o: [at[0] + p.x, at[1] + p.y, 0], d: p.joint.d || [0, 0, 1], limited: false, min: -180, max: 180, ...(p.joint.link ? { link: { to: jids[p.joint.link.to], ratio: +p.joint.link.ratio.toFixed(8) } } : {}) })) : [];
  return { ...structuredClone(fixture('beginner-box')), mode: 'advanced', seq: 40, bodies, sketches: [], joints };
}
const jsonTrip = (d) => validateEnvelope(JSON.parse(JSON.stringify(env(d))));

test("2.9.3 gear sets of every kind pass, read back unchanged, and make a link or are refused only as too large", async () => {
  const kinds = [
    { type: 'spur' }, { type: 'pair' }, { type: 'pair', z: 6, z2: 6, bore: 'none' }, { type: 'ring', z: 12, z2: 40 }, { type: 'ring', z: 20, z2: 24 },
    { type: 'rack', z: 12 }, { type: 'rack', rackLen: 120 }, { type: 'planet', nPlanets: 3 }, { type: 'planet', nPlanets: 6, zs: 24, zp: 12 },
    { type: 'pair', hub: true, hubD: 14, hubH: 6, bore: 'd' }, { type: 'spur', z: 60, m: 2, spokes: true, bore: 'hex' }, { type: 'spur', bore: 'key', pa: 14.5 },
    { type: 'pair', joints: false }, { type: 'planet', pa: 25, backlash: 0 }, { type: 'spur', z: 120, m: 3, spokes: true },
  ];
  for (const o of kinds) for (const fullIds of [false, true]) {
    const d = await gearDoc(o, { fullIds });
    assert.deepEqual(jsonTrip(d), snapshot(d), JSON.stringify(o));
    const link = await makeLink(d, BASE);
    assert.ok(link.ok || link.reason === 'large', `${JSON.stringify(o)}: ${link.message}`);
    if (link.ok) assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  }
  const small = await makeLink(await gearDoc({ type: 'spur', z: 6, bore: 'none', joints: false }), BASE); // the smallest gear the dialog makes
  assert.ok(small.ok || small.reason === 'large', small.message);
});

test("2.9.3 gear settings: the dialog's ranges at their edges, nothing past them, no unknown or computed fields", async () => {
  const d = await gearDoc({ type: 'spur' });
  const ok = (change) => { const x = structuredClone(d); Object.assign(x.bodies[0].gear.o, change); assert.doesNotThrow(() => validateEnvelope(env(x)), JSON.stringify(change)); };
  const bad = (change, kind) => { const x = structuredClone(d); Object.assign(x.bodies[0].gear.o, change); throwsShare(() => validateEnvelope(env(x)), kind, undefined); };
  for (const c of [{ z: 6 }, { z: 300 }, { z2: 6 }, { z2: 400 }, { zs: 8 }, { zs: 200 }, { zp: 200 }, { nPlanets: 2 }, { nPlanets: 6 }, { m: 0.3 }, { thick: 0.5 }, { boreD: 0.5 }, { hubH: 0.5 }, { backlash: 0 }, { rackLen: 0 }, { hubD: 0 }, { hubD: 1 }, { pa: 14.5 }, { pa: 25 }, { bore: 'none' }, { m: 320 }]) ok(c);
  for (const c of [{ z: 5 }, { z: 301 }, { z: 6.5 }, { z2: 5 }, { z2: 401 }, { zs: 7 }, { zs: 201 }, { zp: 7 }, { zp: 201 }, { nPlanets: 1 }, { nPlanets: 7 }, { m: 0.29 }, { m: '2' }, { thick: 0.49 }, { boreD: 0.4 }, { hubH: 0 }, { backlash: -0.01 }, { rackLen: -1 }, { hubD: 0.5 }, { pa: 21 }, { pa: '20' },
    { type: 'worm' }, { type: 'toString' }, { bore: 'star' }, { hub: 'yes' }, { joints: 1 }, { spokes: null }, { m: Infinity }]) bad(c, 'damaged');
  bad({ rackH: 9 }, 'unsupported'); bad({ evil: 1 }, 'unsupported'); bad({ exprs: { m: 'p' } }, 'unsupported');
  bad({ m: 330, z: 300 }, 'toolarge'); bad({ hubD: 100001 }, 'toolarge'); // a 300-tooth gear of module 330 is over 100 m across
  // a rack: at most 400 teeth, however its length is typed
  const r = await gearDoc({ type: 'rack', m: 1 });
  const rack = (len) => { const x = structuredClone(r); x.bodies[0].gear.o.rackLen = len; return () => validateEnvelope(env(x)); };
  assert.doesNotThrow(rack(400 * Math.PI)); throwsShare(rack(401 * Math.PI), 'toolarge', /400/);
  for (const [k, v] of [['base', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2]], ['base0', Array(16).fill(0)], ['spin', 361], ['spin', '90'], ['evil', 1]]) {
    const x = structuredClone(d); x.bodies[0].gear[k] = v; throwsShare(() => validateEnvelope(env(x)));
  }
  for (const k of ['ids', 'jids', 'o']) { const x = structuredClone(d); delete x.bodies[0].gear[k]; throwsShare(() => validateEnvelope(env(x)), 'damaged'); }
});

test("2.9.3 gear parts point both ways, never at themselves, one role each; deleted parts and joints drop out", async () => {
  const d = await gearDoc({ type: 'pair' }, { fullIds: true });
  const bad = (harm, kind) => { const x = structuredClone(d); harm(x); throwsShare(() => validateEnvelope(env(x)), kind, undefined); };
  const [main, g2] = [0, 1];
  bad((x) => { x.bodies[main].gear.ids = { g1: 'g_main', g2: 'g_main' }; }, 'damaged'); // one body under two roles
  bad((x) => { x.bodies[main].gear.ids = { g2: 'g_main', g1: 'g_g2' }; }, 'damaged'); // the first body under another role
  bad((x) => { x.bodies[main].gear.ids = { g2: 'g_g2' }; }, 'damaged'); // the set does not list its own body
  bad((x) => { delete x.bodies[g2].gearPart; }, 'damaged'); // listed, but not pointing back
  bad((x) => { x.bodies[g2].gearPart = 'g_g2'; }, 'damaged'); // pointing at itself
  bad((x) => { x.bodies[main].gear.ids.rk = 'g_g2'; delete x.bodies[main].gear.ids.g2; }, 'damaged'); // a role this kind of set does not have
  bad((x) => { x.bodies[main].gear.ids.g9 = 'g_g2'; }, 'unsupported');
  bad((x) => { x.bodies[g2].gearPart = 'g_g2b'; x.bodies.push({ ...structuredClone(x.bodies[g2]), id: 'g_g2b', gearPart: 'g_main' }); x.joints = []; x.bodies[main].gear.jids = {}; }, 'damaged'); // a part pointing at a body with no set
  bad((x) => { x.bodies[g2].bin = {}; }, 'damaged'); // two roles
  bad((x) => { x.bodies[main].hingePart = 'g_g2'; }, 'damaged');
  bad((x) => { x.bodies[main].gearPart = 'g_g2'; }, 'damaged');
  // the second set of two cannot claim the first set's gear
  bad((x) => { const y = structuredClone(x.bodies[main]); y.id = 'g_other'; y.gear.ids = { g1: 'g_other', g2: 'g_g2' }; y.gear.jids = {}; x.bodies.push(y); }, 'damaged');
  // the person deleted the second gear (and its joint): the set and the remaining joint still open, without the gone part
  const x = structuredClone(d); x.bodies.splice(g2, 1); x.joints = x.joints.filter((j) => j.body !== 'g_g2');
  const back = jsonTrip(x);
  assert.deepEqual(back.bodies[0].gear.ids, { g1: 'g_main' }); assert.deepEqual(back.bodies[0].gear.jids, { g1: 'j_g1' });
  // a part whose set was deleted keeps its shape and loses the pointer
  const y = structuredClone(d); y.bodies.splice(main, 1); y.joints = [];
  assert.equal(jsonTrip(y).bodies[0].gearPart, undefined);
  // and the joints switched off later leave old joint ids behind in the set: dropped too
  const z = await gearDoc({ type: 'pair', joints: false }); z.bodies[0].gear.jids = { g1: 'j_old1', g2: 'j_old2' };
  assert.deepEqual(jsonTrip(z).bodies[0].gear.jids, {});
});

test("2.9.3 gear joints: only the set's own, on its bodies, linked to the right gear by the tooth ratio, never in a loop", async () => {
  for (const o of [{ type: 'pair' }, { type: 'rack' }, { type: 'ring', z: 12, z2: 40 }, { type: 'planet', nPlanets: 4 }]) {
    const d = await gearDoc(o);
    const linked = d.joints.findIndex((j) => j.link), driver = d.joints.findIndex((j) => !j.link);
    const bad = (harm, kind) => { const x = structuredClone(d); harm(x.joints, x); throwsShare(() => validateEnvelope(env(x)), kind, undefined); };
    bad((js) => { js[linked].link.ratio *= 1.001; }, 'damaged');
    bad((js) => { js[linked].link.ratio = -js[linked].link.ratio; }, 'damaged');
    bad((js) => { js[linked].link.ratio = null; }, 'damaged');
    bad((js) => { js[linked].link.to = js[linked].id; }, 'damaged'); // linked to itself
    bad((js) => { js[linked].link.to = 'j_missing'; }, 'damaged');
    bad((js) => { js[driver].link = { to: js[linked].id, ratio: 1 }; }, 'damaged'); // a loop: the driver may not follow anything
    bad((js) => { delete js[linked].link; }, 'damaged');
    bad((js) => { js[linked].link.evil = 1; }, 'unsupported');
    bad((js) => { js[linked].type = js[linked].type === 'slider' ? 'revolute' : 'slider'; }, 'damaged');
    bad((js) => { js[linked].type = 'ball'; }, 'unsupported');
    bad((js) => { js[driver].limited = true; }, 'unsupported');
    bad((js) => { js[driver].parent = 'g_main'; }, 'unsupported');
    bad((js) => { js[driver].min = -90; }, 'unsupported');
    bad((js) => { js[driver].d = [0, 0, 0]; }, 'damaged');
    bad((js) => { js[driver].d = [0, 0, 2]; }, 'damaged');
    bad((js) => { js[driver].o = [0, 0, Infinity]; }, 'damaged');
    bad((js) => { js[driver].seq = -1; }, 'damaged');
    bad((js) => { js[driver].body = 'g_missing'; }, 'damaged');
    bad((js) => { js[linked].body = js[driver].body; }, 'damaged'); // two joints on one body
    bad((js) => { js.push({ ...structuredClone(js[driver]), id: 'j_extra', body: 'g_extra' }); }, 'damaged'); // a joint the set does not list
    bad((js, x) => { const t = x.bodies[0].gear.jids; const [a, b] = Object.keys(t); [t[a], t[b]] = [t[b], t[a]]; }, 'damaged'); // roles swapped
    bad((js) => { js.push({ ...structuredClone(js[driver]), id: js[driver].id }); }, 'damaged'); // duplicate id
  }
  const d = await gearDoc({ type: 'pair' }), x = structuredClone(d);
  x.bodies.push({ ...structuredClone(d.bodies[0]), id: 'plain', gear: undefined }); delete x.bodies.at(-1).gear;
  x.joints.push({ ...structuredClone(d.joints[0]), id: 'j_plain', body: 'plain' });
  throwsShare(() => validateEnvelope(env(x)), 'unsupported', /not part of a gear set/);
  const y = structuredClone(d); y.joints = [{ id: 'j1' }]; throwsShare(() => validateEnvelope(env(y)), 'damaged');
  const z = structuredClone(d); z.joints = Array(LIMITS.BODIES + 1).fill(d.joints[0]); throwsShare(() => validateEnvelope(env(z)), 'damaged');
});

test("2.9.3 gear outlines: whole circles, closed loops that never cross themselves, holes left to the kernel's cut; the outline caps hold", async () => {
  const d = await gearDoc({ type: 'pair', joints: false, spokes: true, z: 60, z2: 60 });
  const outer = d.bodies[0].node.regions[0];
  assert.ok(outer.holes.some((h) => h.length === 1 && h[0].t === 'circle'), 'a round bore is a circle loop');
  const box = (s, x = 0, y = 0) => [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]].map((a, i, p) => ({ t: 'line', a, b: p[(i + 1) % 4] }));
  const one = (region) => ({ ...structuredClone(d), bodies: [{ ...structuredClone(fixture('beginner-box').bodies[0]), node: { t: 'extrude', regions: [region], plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, dist: 5, mode: 'one', mods: [] } }], joints: [] });
  const circle = (r, c = [0, 0]) => [{ t: 'circle', c, r }];
  assert.doesNotThrow(() => validateEnvelope(env(one({ outer: circle(10), holes: [box(2), circle(1, [6, 0])] }))));
  assert.doesNotThrow(() => validateEnvelope(env(one({ outer: box(10), holes: [] }))));
  const bad = (region, kind, re) => throwsShare(() => validateEnvelope(env(one(region))), kind, re);
  bad({ outer: [...box(10), { t: 'circle', c: [0, 0], r: 1 }] }, 'unsupported'); // a circle inside a loop of other pieces
  bad({ outer: circle(0) }, 'damaged'); bad({ outer: circle(-1) }, 'damaged'); bad({ outer: [{ t: 'circle', c: [0, 0], r: 1, n: [0, 0, 1] }] }, 'unsupported');
  bad({ outer: circle(1, [99999.5, 0]) }, 'damaged'); // reaches past the largest measurement
  bad({ outer: [{ t: 'circle', c: [0], r: 1 }] }, 'damaged');
  bad({ outer: box(10).map((s, i) => (i === 2 ? { ...s, a: [10, 11] } : s)) }, 'damaged', /not closed/);
  bad({ outer: [box(10)[0], { t: 'line', a: [10, -10], b: [10, -10] }, ...box(10).slice(1)] }, 'damaged', /no length/); // a piece with no length
  bad({ outer: [{ t: 'line', a: [0, 0], b: [0, 0] }, ...box(10)] }, 'damaged'); // nor at the start
  bad({ outer: [{ t: 'line', a: [0, 0], b: [10, 0] }, { t: 'line', a: [10, 0], b: [0, 0] }] }, 'damaged'); // there and back: no area
  bad({ outer: [{ t: 'arc', a: [0, 0], m: [5, 0], b: [10, 0] }, { t: 'line', a: [10, 0], b: [10, 10] }, { t: 'line', a: [10, 10], b: [0, 0] }] }, 'damaged', /degenerate/); // an arc through three points on a line
  assert.doesNotThrow(() => validateEnvelope(env(one({ outer: [{ t: 'arc', a: [0, 0], m: [5, -2], b: [10, 0] }, { t: 'line', a: [10, 0], b: [10, 10] }, { t: 'line', a: [10, 10], b: [0, 0] }] }))));
  bad({ outer: [[0, 0], [10, 0], [5, 0], [5, 5]].map((a, i, p) => ({ t: 'line', a, b: p[(i + 1) % 4] })) }, 'damaged', /doubles back/);
  bad({ outer: [[0, 0], [10, 10], [10, 0], [0, 4]].map((a, i, p) => ({ t: 'line', a, b: p[(i + 1) % 4] })) }, 'damaged', /crosses/); // a bow tie
  bad({ outer: box(10), holes: [[[0, 0], [5, 5], [5, 0], [0, 4]].map((a, i, p) => ({ t: 'line', a, b: p[(i + 1) % 4] }))] }, 'damaged', /crosses/); // a hole that crosses itself
  // how holes lie against the outline and each other is the kernel's flat boolean cut: the app makes overlapping holes (a big gear's
  // lightening holes) and holes into the edge (a big keyway on a small gear) itself
  for (const holes of [[box(5), box(1)], [box(3, -2, 0), box(3, 2, 0)], [box(2, 9, 0)], [box(10)], [box(2, 30, 0)]]) assert.doesNotThrow(() => validateEnvelope(env(one({ outer: box(10), holes }))));
  const { GEAR_DEFAULTS, gearSet } = await import('../src/gearlib.js');
  const part = (o, key) => () => validateEnvelope(env({ ...one({ outer: box(1) }), bodies: [{ ...structuredClone(fixture('beginner-box').bodies[0]), node: gearSet({ ...GEAR_DEFAULTS, ...o }).parts.find((p) => p.key === key).node }] }));
  for (const o of [{ type: 'spur', z: 200, m: 3, spokes: true }, { type: 'planet', m: 0.5, zs: 19, zp: 44, bore: 'key', boreD: 20 }]) for (const p of gearSet({ ...GEAR_DEFAULTS, ...o }).parts) assert.doesNotThrow(part(o, p.key), JSON.stringify(o) + p.key);
  // a ring gear with more backlash than about three quarters of its module: gearlib.js's tooth spaces run into each other, which is no face
  throwsShare(part({ type: 'ring', m: 0.5, z: 12, z2: 40, backlash: 0.6 }, 'ring'), 'damaged', /crosses/);
  assert.doesNotThrow(part({ type: 'ring', m: 0.5, z: 12, z2: 40, backlash: 0.15 }, 'ring'));
  // the outline pieces of the whole design together
  const ring = (n, r) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]).map((a, i, p) => ({ t: 'line', a, b: p[(i + 1) % n] }));
  // (today the entry and JSON caps stop a design long before 20,000 pieces; the outline cap stays as a second wall, so it is tested with the entry cap raised)
  const saved = { ...LIMITS }; LIMITS.ENTRIES = 1e6; LIMITS.JSON_BYTES = 16 * 1024 * 1024;
  try {
    const many = (n) => one({ outer: ring(n, 50) });
    assert.doesNotThrow(() => validateEnvelope(env(many(LIMITS.OUTLINE_SEGMENTS))));
    throwsShare(() => validateEnvelope(env(many(LIMITS.OUTLINE_SEGMENTS + 1))), 'toolarge', /outline pieces/);
    const two = one({ outer: ring(LIMITS.OUTLINE_SEGMENTS / 2, 50) }); two.bodies.push({ ...structuredClone(two.bodies[0]), id: 'b2' });
    assert.doesNotThrow(() => validateEnvelope(env(two)));
    two.bodies[1].node.regions[0].outer = ring(LIMITS.OUTLINE_SEGMENTS / 2 + 1, 50); throwsShare(() => validateEnvelope(env(two)), 'toolarge', /outline pieces/);
  } finally { Object.assign(LIMITS, saved); }
  // thousands of pieces crowded into one corner of a big outline: refused quickly as too complicated, not checked pair by pair forever
  const holes = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) holes.push(circle(0.0004, [i * 0.001, j * 0.001]));
  const t0 = Date.now();
  throwsShare(() => validateEnvelope(env(one({ outer: box(5000, 4990, 4990), holes }))), 'toolarge', /too complicated/);
  assert.ok(Date.now() - t0 < 5000);
});

test("Box Maker outlines of every style pass the new outline checks", async () => {
  const { BIN_DEFAULTS, binSet } = await import('../src/bins.js');
  const body = fixture('beginner-box').bodies[0];
  for (const style of ['bin', 'drawer', 'tilt', 'door']) for (const sideLock of ['dovetail', 'pegs', 'none']) for (const layout of ['', 'print']) for (const lock of ['dovetail', 'pegs']) {
    const o = { ...BIN_DEFAULTS, style, sideLock, layout, lock, across: 2, units: 2, lid: style === 'bin', stack: style === 'bin', label: true }, set = binSet(o), ids = {};
    for (const q of set.parts) if (q.key !== 'main') ids[q.key] = 'p_' + q.key;
    const bodies = set.parts.map((q) => ({ ...structuredClone(body), id: q.key === 'main' ? 'main' : ids[q.key], node: q.node, ...(q.key === 'main' ? { bin: { ...o, ids } } : { binPart: 'main' }) }));
    assert.doesNotThrow(() => validateEnvelope(env({ ...structuredClone(fixture('beginner-box')), bodies, sketches: [] })), JSON.stringify({ style, sideLock, layout, lock }));
  }
});

test("2.9.3 Browser folders: flat, named, with real members; names stay text", async () => {
  const d = fixture('beginner-box'); d.folders = [{ id: 'fd1', name: '<img src=x onerror=alert(1)>', open: true }, { id: 'fd2', name: 'Folder 2', open: false }]; d.bodies[0].folder = 'fd1';
  const link = await makeLink(d, BASE); assert.equal(link.ok, true, link.message);
  assert.deepEqual(await readFragment(link.url.split('#')[1]), snapshot(d));
  const bad = (harm, kind) => { const x = structuredClone(d); harm(x); throwsShare(() => validateEnvelope(env(x)), kind, undefined); };
  bad((x) => { x.bodies[0].folder = 'fd9'; }, 'damaged'); bad((x) => { x.bodies[0].folder = ['fd1']; }, 'damaged');
  bad((x) => { x.folders[1].id = 'fd1'; }, 'damaged'); bad((x) => { x.folders[0].id = 'a b'; }, 'damaged');
  bad((x) => { x.folders[0].name = '   '; }, 'damaged'); bad((x) => { x.folders[0].name = 'x'.repeat(61); }, 'damaged'); bad((x) => { x.folders[0].name = 7; }, 'damaged');
  bad((x) => { x.folders[0].open = 'yes'; }, 'damaged'); bad((x) => { delete x.folders[0].open; }, 'damaged');
  bad((x) => { x.folders[0].parent = 'fd2'; }, 'unsupported'); bad((x) => { x.folders[0].children = ['fd2']; }, 'unsupported');
  bad((x) => { x.folders = { fd1: {} }; }, 'damaged');
  const ok = structuredClone(d); ok.folders[0].name = 'x'.repeat(60); assert.doesNotThrow(() => validateEnvelope(env(ok)));
  const many = (n) => { const x = structuredClone(d); x.folders = Array.from({ length: n }, (_, i) => ({ id: 'f' + i, name: 'F' + i, open: true })); delete x.bodies[0].folder; return () => validateEnvelope(env(x)); };
  assert.doesNotThrow(many(LIMITS.FOLDERS)); throwsShare(many(LIMITS.FOLDERS + 1), 'damaged');
});

test("2.9.3 clearance cuts and whole-body offsets stay refused (no guard yet against offsets that hang the engine)", () => {
  const d = fixture('beginner-box');
  const x = structuredClone(d); x.bodies[0].node.mods = [{ id: 'm1', seq: 1, t: 'offset', all: true, d: 1, faces: [] }];
  throwsShare(() => validateEnvelope(env(x)), 'unsupported', /all/);
  const y = structuredClone(d); y.bodies[0].node.mods = [{ id: 'm1', seq: 1, t: 'bool', src: 'clearance', op: 'cut', gap: 0.2, other: 'Lid', tool: { t: 'group', children: [] } }];
  throwsShare(() => validateEnvelope(env(y)), 'unsupported');
});

test("Box Maker sets (build 31 review): all the compartments together are capped, and no part is numbered past the set", async () => {
  const { BIN_DEFAULTS, binSet } = await import('../src/bins.js');
  const body = fixture('beginner-box').bodies[0];
  const make = (o) => {
    const set = binSet({ ...BIN_DEFAULTS, ...o, cols: 1, rows: 1 }), ids = {};
    for (const q of set.parts) if (q.key !== 'main') ids[q.key] = 'p_' + q.key;
    // each part as a plain box: the check is of the settings, and 64 real bins would pass the entry cap first
    const bodies = set.parts.map((q) => ({ ...structuredClone(body), id: q.key === 'main' ? 'main' : ids[q.key], ...(q.key === 'main' ? { bin: { ...BIN_DEFAULTS, ...o, ids } } : { binPart: 'main' }) }));
    return { ...structuredClone(fixture('beginner-box')), bodies, sketches: [] };
  };
  const work = (o) => () => validateEnvelope(env(make(o)));
  assert.equal(LIMITS.BIN_WORK, 1600);
  assert.doesNotThrow(work({ cols: 20, rows: 20, units: 4, across: 1 })); // 1600: four bins of 20 x 20
  throwsShare(work({ cols: 20, rows: 20, units: 5, across: 1 }), 'toolarge', /1600/);
  assert.doesNotThrow(work({ cols: 5, rows: 5, units: 8, across: 8 })); // 1600: an 8 x 8 wall of 5 x 5 bins
  throwsShare(work({ cols: 5, rows: 6, units: 8, across: 8 }), 'toolarge');
  assert.doesNotThrow(work({ style: 'door', cols: 20, rows: 20, units: 8, across: 8 })); // a door case has no compartments
  assert.doesNotThrow(work({ style: 'tilt', cols: 8, rows: 20, units: 8, across: 8 })); // a tilt bin counts its sections only (8 x 64)
  throwsShare(work({ style: 'drawer', cols: 12, rows: 12, units: 4, across: 3 }), 'toolarge'); // 144 x 12
  // the part keys stop at units x across
  const d = make({ units: 2, across: 2 });
  assert.deepEqual(Object.keys(d.bodies[0].bin.ids).sort(), ['bin1', 'bin2', 'bin3']);
  for (const [key, good] of [['bin3', true], ['bin4', false], ['case4', false], ['front3', true], ['front4', false], ['lid', true]]) {
    const x = structuredClone(d); x.bodies = [x.bodies[0], { ...structuredClone(body), id: 'p_extra', binPart: 'main' }]; x.bodies[0].bin.ids = { [key]: 'p_extra' };
    if (good) assert.doesNotThrow(() => validateEnvelope(env(x)), key); else throwsShare(() => validateEnvelope(env(x)), 'damaged', /past the end/);
  }
});
