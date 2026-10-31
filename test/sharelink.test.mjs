// Share link: the codec, the size limits and the untrusted-input checks, in Node (src/sharelink.js and the bounded src/inflate.js).
// The outcome through the real UI, on both builds, is test/sharelink.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  LIMITS, ShareError, b64urlEncode, b64urlDecode, extractFragment, parseFragment, decodeFragment, readFragment, makeLink, snapshot, validateEnvelope,
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
  bad((d) => { d.joints = [{ id: "j1" }]; }, "unsupported", /joints/);
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
test("a body made by the Fasteners dialog passes with its settings; an unknown fastener field or a wrong type is refused", () => {
  const doc = { v: 1, id: "f", name: "F", mode: "advanced", created: 1, seq: 1, grid: 1, sketches: [], planes: [], joints: [], bodies: [
    { id: "b1", name: "Hex nut M8", seq: 1, color: "#c7ccd2", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      node: { t: "prim", kind: "cylinder", p: { w: 8, d: 8, h: 6.8 }, mods: [] },
      fastener: { kind: "nut", std: "metric", size: "M8", len: null, threads: true, name: "Hex nut M8", clear: -0.1, left: false } }] };
  assert.equal(validateEnvelope(env(doc)).bodies[0].fastener.size, "M8");
  const bad = structuredClone(doc); bad.bodies[0].fastener.script = "x";
  throwsShare(() => validateEnvelope(env(bad)), null, /fastener/);
  const wrong = structuredClone(doc); wrong.bodies[0].fastener.threads = "yes";
  throwsShare(() => validateEnvelope(env(wrong)));
});
