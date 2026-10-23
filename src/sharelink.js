// jumpstart-3d: share link. A small editable design travels in the part of a web address after the "#": nothing is
// uploaded, the browser never sends that part to a server, and no service stores it. Open/Export > Share link… makes the link;
// opening a link (or pasting one into Import shared link) asks first and adds the design as a NEW one, never over the open one.
//
//   https://…/jumpstart-3d/#js3d=v1.d.<base64url>   v1 = link format, d = raw DEFLATE
//   https://…/jumpstart-3d/#js3d=v1.j.<base64url>   j = plain UTF-8 JSON (the browser has no raw compression)
//
// The payload is the existing project envelope { app: "jumpstart-3d", version: 1, doc }. Everything that comes out of a link is
// untrusted data: it is size-checked before it is decoded, decoded with bounds, and checked against explicit tables below. Anything
// outside the tables ("Use a project file for this design") is refused, never trimmed or passed on to the CAD kernel. No eval, no
// script, no address inside the data is ever fetched. The link is neither encrypted nor proof of who sent it.
import { el } from "./util.js";
import { ICON } from "./icons.js";
import { inflateRaw } from "./inflate.js";
import { evalExpr } from "./params.js";
import { MAX_SLOTS } from "./paint3mf.js";

// ---------------------------------------------------------------- limits (named, and tested at their edges)
export const LIMITS = {
  URL: 4096, // the whole generated address, base included: an app policy, not a browser promise
  FRAGMENT: 4096, // a received fragment (without the #)
  PASTE: 8192, // pasted text, checked before anything else looks at it
  PAYLOAD_BYTES: 3072, // decoded bytes of either codec
  JSON_BYTES: 512 * 1024, // JSON text, after inflating
  DEPTH: 64, ENTRIES: 50000, BODIES: 256, SKETCHES: 256, PARAMS: 256, NODES: 4096, SKETCH_ITEMS: 20000,
  PAINT_FACES: 4096, NAME: 256, EXPR: 512, STRING: 2048, ASSET_BYTES: 256 * 1024,
  // the most the app's own controls allow (advanced.js pattern box, beginner.js sliders, kernel.js coil and thread), so a link cannot ask the engine for more
  REPEAT: 200, REPEAT_TOTAL: 2000, CIRCULAR: 360, TURNS: 400, MEASURE: 1e5, SIDES: 24, PYRAMID_SIDES: 12, POINTS: 16,
};
const SITE = "https://maxsikorski.github.io/jumpstart-3d/"; // the community website; a file:// copy shares this address, never its own path
const PREFIX = "js3d=";
const MAX_PROBLEM = "This design is too large for a reliable share link. Send a project file instead.";

export class ShareError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; } // kind: damaged | unsupported | toolarge | newer
}
const damaged = (why) => new ShareError("damaged", "This link is damaged or is not a JumpStart 3D design link" + (why ? " (" + why + ")" : "") + ".");
const tooBig = (m) => new ShareError("toolarge", m || "This link is too large to open safely.");
const unsupported = (what) => new ShareError("unsupported", "This design uses something a link can't carry (" + what + "). Use a project file for this design.");

// ---------------------------------------------------------------- base64url, strict: no padding, nothing but the alphabet
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const REV = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) REV[ALPHA.charCodeAt(i)] = i;
export function b64urlEncode(u8) {
  let out = "", i = 0;
  for (; i + 2 < u8.length; i += 3) { const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2]; out += ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63]; }
  if (u8.length - i === 1) { const n = u8[i] << 16; out += ALPHA[n >> 18] + ALPHA[(n >> 12) & 63]; }
  else if (u8.length - i === 2) { const n = (u8[i] << 16) | (u8[i + 1] << 8); out += ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63]; }
  return out;
}
// the size is worked out from the text length before anything is allocated
export function b64urlDecode(text, maxBytes = LIMITS.PAYLOAD_BYTES) {
  const L = text.length;
  if (L % 4 === 1) throw damaged("bad length");
  const size = Math.floor((L * 3) / 4);
  if (size > maxBytes) throw tooBig();
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < L; i += 4) {
    let n = 0, k = 0;
    for (; k < 4 && i + k < L; k++) {
      const c = text.charCodeAt(i + k), v = c < 128 ? REV[c] : -1;
      if (v < 0) throw damaged("bad character");
      n = (n << 6) | v;
    }
    n <<= 6 * (4 - k);
    if (k >= 2) out[o++] = (n >> 16) & 255;
    if (k >= 3) out[o++] = (n >> 8) & 255;
    if (k === 4) out[o++] = n & 255;
  }
  if (b64urlEncode(out) !== text) throw damaged("not canonical"); // stray bits after the last byte
  return out;
}

// ---------------------------------------------------------------- compression: native raw DEFLATE, else the bounded pure-JS decoder
async function deflateRaw(u8) {
  try {
    const cs = new CompressionStream("deflate-raw"); // the global alone proves nothing: an unsupported format throws here, also on file://
    const w = cs.writable.getWriter();
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch (e) { return null; }
}
async function inflateBounded(bytes) {
  let ds = null;
  try { ds = new DecompressionStream("deflate-raw"); } catch (e) { ds = null; }
  if (!ds) {
    try { return inflateRaw(bytes, undefined, LIMITS.JSON_BYTES); } catch (e) { throw /limit/.test(e.message) ? tooBig() : damaged("bad compressed data"); }
  }
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(), chunks = [];
  let total = 0;
  for (;;) {
    let c;
    try { c = await r.read(); } catch (e) { throw damaged("bad compressed data"); }
    if (c.done) break;
    total += c.value.length;
    if (total > LIMITS.JSON_BYTES) { r.cancel().catch(() => {}); throw tooBig(); } // counted before the chunk is kept
    chunks.push(c.value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---------------------------------------------------------------- reading a link
// text typed or pasted: only the recognized fragment is cut out of it. It is never parsed as an address and never fetched.
export function extractFragment(text) {
  const s = String(text);
  if (s.length > LIMITS.PASTE) throw tooBig("That text is too long to be a share link.");
  const t = s.trim(), i = t.indexOf("#" + PREFIX);
  const frag = i >= 0 ? t.slice(i + 1) : t.startsWith(PREFIX) ? t : null;
  if (frag === null) throw damaged("no share link found in it");
  return frag.split(/\s/)[0];
}
export function parseFragment(frag) {
  if (frag.length > LIMITS.FRAGMENT) throw tooBig("This link is too long to open safely.");
  const m = /^js3d=v([^.]*)\.([^.]*)\.(.*)$/.exec(frag);
  if (!m) throw damaged("not a design link");
  if (m[1] !== "1") throw new ShareError("newer", "This link was made by a different version of JumpStart 3D (link format v" + m[1].slice(0, 8).replace(/[^A-Za-z0-9]/g, "") + "). Ask for a project file, or update the app.");
  if (m[2] !== "d" && m[2] !== "j") throw damaged("unknown compression");
  if (!/^[A-Za-z0-9_-]*$/.test(m[3])) throw damaged("bad character");
  return { codec: m[2], payload: m[3] };
}
export async function decodeFragment(frag) {
  const { codec, payload } = parseFragment(frag);
  const bytes = b64urlDecode(payload);
  let text;
  if (codec === "d") text = strictUtf8(await inflateBounded(bytes));
  else {
    if (bytes.length > LIMITS.JSON_BYTES) throw tooBig();
    text = strictUtf8(bytes); // a j link goes straight to the checks: bytes tagged d are never tried as j, nor the other way round
  }
  try { return JSON.parse(text); } catch (e) { throw damaged("not readable data"); }
}
function strictUtf8(u8) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { throw damaged("bad text"); }
}
// the one reader: fragment text -> a checked document
export async function readFragment(frag) { return validateEnvelope(await decodeFragment(frag)); }

// ---------------------------------------------------------------- making a link
export function snapshot(doc) {
  const d = JSON.parse(JSON.stringify(doc)); // as a project file reads it back: a failed parameter's NaN is null
  delete d._updated; // storage time
  for (const b of d.bodies || []) delete b._key; // the scene's cache on each body, not part of the design
  return d;
}
export function baseAddress() {
  return location.protocol === "http:" || location.protocol === "https:" ? location.origin + location.pathname : SITE;
}
// { ok, url, codec } or { ok: false, reason: "unsupported" | "large", message }
export async function makeLink(doc, base = baseAddress()) {
  const env = { app: "jumpstart-3d", version: 1, doc: snapshot(doc) };
  try { validateEnvelope(env); } catch (e) {
    if (e instanceof ShareError && e.kind === "toolarge") return { ok: false, reason: "large", message: /project file/.test(e.message) ? e.message : MAX_PROBLEM };
    return { ok: false, reason: "unsupported", message: e instanceof ShareError && e.kind === "unsupported" ? e.message : "This design can't go in a link. Use a project file for this design." };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(env));
  if (bytes.length > LIMITS.JSON_BYTES) return { ok: false, reason: "large", message: MAX_PROBLEM };
  const z = await deflateRaw(bytes);
  const codec = z ? "d" : "j";
  const url = base + "#" + PREFIX + "v1." + codec + "." + b64urlEncode(z || bytes);
  if (url.length > LIMITS.URL) return { ok: false, reason: "large", message: MAX_PROBLEM, codec, size: url.length };
  return { ok: true, url, codec };
}

// ---------------------------------------------------------------- checking a decoded project
const DANGER = new Set(["__proto__", "prototype", "constructor"]);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/; // SVG, http(s), blob:, file: and the rest are not in it

// explicit tables, taken from what the app writes and the kernel reads (kernel.js evalNode and applyMod)
const DOC_KEYS = new Set(["v", "id", "name", "mode", "created", "seq", "grid", "bodies", "sketches", "planes", "joints", "params", "assets", "media", "ver", "printPaint"]);
const BODY_KEYS = new Set(["id", "name", "seq", "color", "hole", "hidden", "m", "node", "brick", "media", "locked"]);
const NODE_TYPES = new Set(["prim", "extrude", "revolve", "sweep", "pipe", "coil", "group", "loft", "mirror", "placed", "mesh", "step"]);
const NODE_KEYS = new Set(["t", "id", "name", "color", "hidden", "kind", "p", "mods", "exprs", "exprUnits", "children", "sketch", "profiles", "dist", "mode", "dist2", "axis", "axisWorld", "angle", "path", "orient", "taper", "twist", "chain", "section", "size", "hollow", "wall", "edgeSegs", "pathSegs", "railSegs", "sections", "rail", "ruled", "closed", "src", "srcM", "srcBody", "plane", "asset", "k", "left", "pitch", "turns", "pos", "d", "h", "stretch", "keepPos", "regions", "op"]);
const PRIM_KINDS = new Set(["box", "cylinder", "tube", "cone", "pyramid", "prism", "wedge", "sphere", "hemisphere", "torus", "text", "star", "heart", "roof", "roundroof", "paraboloid", "gem", "capsule", "arrow", "spring"]);
const CHILD_KEYS = new Set(["node", "m", "hole", "color", "name", "hidden", "id", "seq"]);
const MOD_TYPES = new Set(["fillet", "chamfer", "hole", "bool", "keeppiece", "halfspace", "sketchsplit", "splitface", "offset", "shell", "emboss", "facepat", "thread", "scale", "pattern"]);
const MOD_KEYS = new Set(["id", "seq", "t", "exprs", "exprUnits", "angle", "at", "ax1", "ax2", "cax", "cbDepth", "cbDia", "center", "chain", "clear", "closed", "cn", "count", "csAngle", "csDia", "curves", "d", "depth", "dia", "dir", "edges", "face", "faces", "feats", "flip", "k", "kind", "left", "length", "m", "mode", "n", "n1", "n2", "o", "op", "p", "piece", "pitch", "plane", "poly", "r", "s1", "s2", "sets", "side", "sym", "th", "through", "tip", "tool", "what", "size", "x", "str", "font", "along", "mirror", "reverse", "sketch", "tapped", "hidden", "src"]);
const SKETCH_KEYS = new Set(["id", "name", "seq", "plane", "pts", "ents", "hidden", "onBody", "faceCenter", "fromFace", "cons", "image"]);
const ENT_KEYS = {
  line: ["a", "b"], circle: ["c", "r"], arc: ["c", "a", "b"], spline: ["pts", "closed"], point: ["p"], text: ["p", "str", "size", "angle", "font"],
};
const CON_KEYS = new Set(["id", "t", "p", "p1", "p2", "e", "e1", "e2", "k", "o", "v", "off", "expr", "unit", "name", "s1", "s2"]);
const CON_TYPES = new Set(["origin", "coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "concentric", "equal", "midpoint", "dim"]);
const PLANE_KEYS = new Set(["id", "name", "seq", "kind", "def", "plane", "size", "hidden"]);
const MEDIA_MAPS = new Set(["front", "wrap", "box", "ball"]);
const UNITS = new Set(["mm", "cm", "m", "in", "ft", "deg"]);

function num(v, what) { if (typeof v !== "number" || !isFinite(v)) throw damaged(what + " is not a number"); return v; }
function bool(v, what) { if (typeof v !== "boolean") throw damaged(what + " is not true or false"); return v; }
function text(v, what, max = LIMITS.NAME) { if (typeof v !== "string" || v.length > max) throw damaged(what + " is not text, or is too long"); return v; }
function id(v, what) { if (typeof v !== "string" || !ID.test(v)) throw damaged(what + " is not a valid id"); return v; }
function obj(v, what) { if (!isObj(v)) throw damaged(what + " is not an object"); return v; }
function arr(v, what, max) { if (!Array.isArray(v) || v.length > max) throw damaged(what + " is not a list, or is too long"); return v; }
function vec(v, n, what) { if (!Array.isArray(v) || v.length !== n) throw damaged(what + " is not " + n + " numbers"); v.forEach((x) => num(x, what)); return v; }
function allow(o, keys, what) { for (const k of Object.keys(o)) if (!keys.has(k)) throw unsupported(what + " has " + k.slice(0, 32).replace(/[^\w.-]/g, "?")); }
// an affine placement: 16 finite numbers, last row 0 0 0 1, a linear part that can be inverted
function mat16(m, what) {
  vec(m, 16, what);
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) throw damaged(what + " is not an affine placement");
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (!(Math.abs(det) > 1e-12)) throw damaged(what + " flattens the shape");
  return m;
}

// depth, size, finite numbers, string length and dangerous names for everything, before the tables look at it. Iterative: no recursion to blow.
function scan(root) {
  const stack = [[root, 1, ""]];
  let entries = 0;
  while (stack.length) {
    const [v, depth, key] = stack.pop();
    if (depth > LIMITS.DEPTH) throw tooBig("This design is nested too deeply to open from a link.");
    if (Array.isArray(v)) {
      entries += v.length;
      for (const x of v) {
        if (typeof x === "number") measure(key, x);
        else if (typeof x === "string") { if (x.length > LIMITS.STRING) throw tooBig("This design has text too long for a link."); }
        else if (x !== null && typeof x === "object") stack.push([x, depth + 1, key]);
        else if (typeof x !== "boolean" && x !== null) throw damaged("unexpected data");
      }
    } else {
      for (const k of Object.keys(v)) {
        entries++;
        if (DANGER.has(k)) throw damaged("a reserved name");
        const x = v[k];
        if (typeof x === "number") measure(k, x);
        else if (typeof x === "string") { if (x.length > ((k === "data" || k === "src" || k === "key") ? LIMITS.JSON_BYTES : LIMITS.STRING)) throw tooBig("This design has text too long for a link."); }
        else if (x !== null && typeof x === "object") stack.push([x, depth + 1, k]);
        else if (typeof x !== "boolean" && x !== null) throw damaged("unexpected data");
      }
    }
    if (entries > LIMITS.ENTRIES) throw tooBig("This design has too many parts to open from a link.");
  }
}

// a number is finite, and no length is bigger than the app's own controls take (not the clock, counters or version numbers)
const NOT_LENGTHS = new Set(["created", "seq", "ver", "_updated"]);
const tooLarge = () => tooBig("This design has a measurement larger than a link can open safely (over 100,000 mm). Use a project file for this design.");
function measure(key, x) {
  if (!isFinite(x)) throw damaged("a number is not finite");
  if (Math.abs(x) > LIMITS.MEASURE && !NOT_LENGTHS.has(key)) throw tooLarge();
}

function base64Bytes(s, what) {
  if (!B64.test(s) || s.length % 4) throw damaged(what + " is not valid base64");
  return (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
}

export function validateEnvelope(env) {
  if (!isObj(env) || env.app !== "jumpstart-3d" || env.version !== 1 || !isObj(env.doc)) throw damaged("not a project");
  scan(env);
  allow(env, new Set(["app", "version", "doc"]), "the link");
  const doc = env.doc;
  if (doc.v !== 1) throw damaged("unknown design version");
  if (JSON.stringify(doc).length > LIMITS.JSON_BYTES) throw tooBig();
  allow(doc, DOC_KEYS, "the design");
  id(doc.id, "the design id");
  text(doc.name, "the name");
  if (doc.mode !== "beginner" && doc.mode !== "advanced") throw unsupported("the " + (typeof doc.mode === "string" ? doc.mode.slice(0, 16).replace(/[^\w ]/g, "?") : "unknown") + " workspace");
  num(doc.created, "the creation time");
  if (!Number.isInteger(doc.seq) || doc.seq < 0) throw damaged("seq");
  if (doc.grid !== undefined) num(doc.grid, "the grid");
  if (doc.ver !== undefined) num(doc.ver, "the version");
  const ctx = { nodes: 0, bodyRefs: [], assetBytes: 0, sketches: new Map(), assets: {}, media: {} };

  if (doc.joints !== undefined && (!Array.isArray(doc.joints) || doc.joints.length)) throw unsupported("joints");
  // parameters: names, and every expression must evaluate to a finite value with the existing arithmetic parser
  const params = arr(doc.params === undefined ? [] : doc.params, "parameters", LIMITS.PARAMS), names = new Set(), pids = new Set(), done = [];
  for (const p of params) {
    obj(p, "a parameter"); allow(p, new Set(["id", "name", "expr", "unit", "value"]), "a parameter");
    id(p.id, "a parameter id");
    if (pids.has(p.id)) throw damaged("duplicate parameter id"); pids.add(p.id);
    if (typeof p.name !== "string" || !IDENT.test(p.name)) throw damaged("a parameter name");
    if (names.has(p.name.toLowerCase())) throw damaged("duplicate parameter name"); names.add(p.name.toLowerCase());
    text(p.expr, "a parameter expression", LIMITS.EXPR);
    if (p.unit !== undefined && !UNITS.has(p.unit)) throw damaged("a parameter unit");
    if (p.value !== undefined && p.value !== null) num(p.value, "a parameter value");
    const v = evalExpr(p.expr, done, { unit: p.unit });
    if (!isFinite(v)) throw damaged("parameter " + p.name + " does not evaluate");
    done.push({ name: p.name, value: v });
  }
  ctx.scope = done;

  // assets and media: embedded data only, 256 KiB of decoded bytes in all
  const assets = doc.assets === undefined ? {} : obj(doc.assets, "assets");
  for (const [k, a] of Object.entries(assets)) {
    id(k, "an asset id"); obj(a, "an asset"); allow(a, new Set(["kind", "name", "data"]), "an asset");
    if (a.kind !== "mesh" && a.kind !== "step") throw unsupported("a " + String(a.kind).slice(0, 16).replace(/[^\w ]/g, "?") + " asset");
    text(a.name, "an asset name"); text(a.data, "asset data", LIMITS.JSON_BYTES);
    ctx.assetBytes += base64Bytes(a.data, "asset data");
    ctx.assets[k] = a.kind;
  }
  const image = (src, what) => { const m = IMAGE.exec(src); if (!m) throw unsupported(what + " from outside the design"); ctx.assetBytes += base64Bytes(m[1], what); };
  const media = doc.media === undefined ? {} : obj(doc.media, "media");
  for (const [k, m] of Object.entries(media)) {
    id(k, "a media id"); obj(m, "a media entry"); allow(m, new Set(["kind", "name", "src", "w", "h"]), "a media entry");
    if (m.kind !== "image" && m.kind !== "video") throw unsupported("media of another kind");
    if (m.name !== undefined) text(m.name, "a media name");
    if (m.kind === "image") { text(m.src, "a picture", LIMITS.JSON_BYTES); image(m.src, "a picture"); } else if (m.src !== undefined) throw unsupported("a video source");
    if (m.w !== undefined) num(m.w, "a picture width"); if (m.h !== undefined) num(m.h, "a picture height");
    ctx.media[k] = true;
  }
  if (ctx.assetBytes > LIMITS.ASSET_BYTES) throw tooBig("The pictures and imported models in this design are too big for a link.");

  // sketches
  const sketches = arr(doc.sketches, "sketches", LIMITS.SKETCHES);
  let items = 0;
  for (const s of sketches) {
    obj(s, "a sketch"); allow(s, SKETCH_KEYS, "a sketch");
    id(s.id, "a sketch id");
    if (ctx.sketches.has(s.id)) throw damaged("duplicate sketch id");
    text(s.name, "a sketch name"); num(s.seq, "a sketch number");
    obj(s.plane, "a sketch plane"); allow(s.plane, new Set(["o", "x", "n"]), "a sketch plane"); vec(s.plane.o, 3, "plane"); vec(s.plane.x, 3, "plane"); vec(s.plane.n, 3, "plane");
    if (s.hidden !== undefined) bool(s.hidden, "hidden"); if (s.fromFace !== undefined) bool(s.fromFace, "fromFace");
    if (s.onBody !== undefined) text(s.onBody, "onBody", 64);
    if (s.faceCenter !== undefined) vec(s.faceCenter, 2, "faceCenter");
    const pts = arr(s.pts, "sketch points", LIMITS.SKETCH_ITEMS), ents = arr(s.ents, "sketch shapes", LIMITS.SKETCH_ITEMS), cons = arr(s.cons === undefined ? [] : s.cons, "constraints", LIMITS.SKETCH_ITEMS);
    items += pts.length + ents.length;
    if (items > LIMITS.SKETCH_ITEMS) throw tooBig("This design has too many sketch points for a link.");
    const pid = new Set(), eid = new Set();
    for (const p of pts) { obj(p, "a sketch point"); allow(p, new Set(["id", "x", "y"]), "a sketch point"); id(p.id, "a point id"); if (pid.has(p.id)) throw damaged("duplicate point id"); pid.add(p.id); num(p.x, "x"); num(p.y, "y"); }
    const needP = (v) => { if (typeof v !== "string" || !pid.has(v)) throw damaged("a sketch shape points at a missing point"); };
    for (const e of ents) {
      obj(e, "a sketch shape");
      const keys = ENT_KEYS[e.t];
      if (!keys) throw unsupported("a " + String(e.t).slice(0, 16).replace(/[^\w ]/g, "?") + " shape in a sketch");
      allow(e, new Set(["id", "t", "cons", "proj", ...keys]), "a sketch shape");
      id(e.id, "a shape id"); if (eid.has(e.id)) throw damaged("duplicate shape id"); eid.add(e.id);
      if (e.cons !== undefined) bool(e.cons, "cons"); if (e.proj !== undefined) bool(e.proj, "proj");
      if (e.t === "line") { needP(e.a); needP(e.b); }
      else if (e.t === "circle") { needP(e.c); num(e.r, "radius"); }
      else if (e.t === "arc") { needP(e.c); needP(e.a); needP(e.b); }
      else if (e.t === "spline") { arr(e.pts, "spline points", LIMITS.SKETCH_ITEMS).forEach(needP); if (e.closed !== undefined) bool(e.closed, "closed"); }
      else if (e.t === "point") needP(e.p);
      else if (e.t === "text") { needP(e.p); text(e.str, "text", LIMITS.STRING); num(e.size, "text size"); if (e.angle !== undefined) num(e.angle, "angle"); if (e.font !== undefined) text(e.font, "font", 32); }
    }
    const cid = new Set();
    for (const c of cons) {
      obj(c, "a constraint"); allow(c, CON_KEYS, "a constraint");
      if (!CON_TYPES.has(c.t)) throw unsupported("a " + String(c.t).slice(0, 16).replace(/[^\w ]/g, "?") + " constraint");
      id(c.id, "a constraint id"); if (cid.has(c.id)) throw damaged("duplicate constraint id"); cid.add(c.id);
      for (const k of ["p", "p1", "p2"]) if (c[k] !== undefined && c[k] !== null) needP(c[k]);
      for (const k of ["e", "e1", "e2"]) if (c[k] !== undefined && c[k] !== null && (typeof c[k] !== "string" || !eid.has(c[k]))) throw damaged("a constraint points at a missing shape");
      if (c.expr !== undefined) text(c.expr, "a dimension expression", LIMITS.EXPR);
      if (c.unit !== undefined && !UNITS.has(c.unit)) throw damaged("a dimension unit");
      if (c.name !== undefined) text(c.name, "a dimension name", 64);
    }
    if (s.image !== undefined) {
      obj(s.image, "a sketch picture"); allow(s.image, new Set(["src", "name", "w", "h", "cx", "cy", "rot", "opacity"]), "a sketch picture");
      text(s.image.src, "a picture", LIMITS.JSON_BYTES); image(s.image.src, "a sketch picture");
      if (ctx.assetBytes > LIMITS.ASSET_BYTES) throw tooBig("The pictures and imported models in this design are too big for a link.");
      for (const k of ["w", "h", "cx", "cy", "rot", "opacity"]) if (s.image[k] !== undefined) num(s.image[k], "a picture " + k);
    }
    ctx.sketches.set(s.id, true);
  }

  // planes
  const planes = arr(doc.planes === undefined ? [] : doc.planes, "planes", LIMITS.SKETCHES), plid = new Set();
  for (const p of planes) { obj(p, "a plane"); allow(p, PLANE_KEYS, "a plane"); id(p.id, "a plane id"); if (plid.has(p.id)) throw damaged("duplicate plane id"); plid.add(p.id); if (p.name !== undefined) text(p.name, "a plane name"); }

  // bodies
  const bodies = arr(doc.bodies, "bodies", LIMITS.BODIES), bid = new Set();
  for (const b of bodies) {
    obj(b, "a body"); allow(b, BODY_KEYS, "a body");
    id(b.id, "a body id"); if (bid.has(b.id)) throw damaged("duplicate body id"); bid.add(b.id);
    text(b.name, "a body name"); num(b.seq, "a body number");
    if (typeof b.color !== "string" || !COLOR.test(b.color)) throw damaged("a body colour");
    bool(b.hole, "hole"); bool(b.hidden, "hidden"); if (b.locked !== undefined) bool(b.locked, "locked");
    mat16(b.m, "a body placement");
    if (b.brick !== undefined) { obj(b.brick, "a brick"); allow(b.brick, new Set(["layer", "size"]), "a brick"); if (b.brick.layer !== undefined) num(b.brick.layer, "layer"); if (b.brick.size !== undefined) text(b.brick.size, "size", 32); }
    if (b.media !== undefined) {
      obj(b.media, "body media"); allow(b.media, new Set(["id", "map", "rep", "rot", "mirror", "both", "dir", "up", "crop"]), "body media");
      if (!ctx.media[b.media.id]) throw damaged("a body uses missing media");
      if (b.media.map !== undefined && !MEDIA_MAPS.has(b.media.map)) throw damaged("media map");
      for (const k of ["rep", "rot"]) if (b.media[k] !== undefined) num(b.media[k], k);
      for (const k of ["mirror", "both"]) if (b.media[k] !== undefined) bool(b.media[k], k);
      if (b.media.dir !== undefined) vec(b.media.dir, 3, "dir"); if (b.media.up !== undefined) vec(b.media.up, 3, "up"); if (b.media.crop !== undefined) vec(b.media.crop, 4, "crop");
    }
    node(obj(b.node, "a body shape"), ctx, "a shape");
  }
  for (const r of ctx.bodyRefs) if (!bid.has(r)) throw damaged("a mirror points at a missing body");
  if (doc.printPaint !== undefined) printPaint(doc.printPaint, bid);
  return doc;
}

// jumpstart-3d: painted 3MF. The 3D Print Sim's filaments (paint3mf.js): { slots: ["#rrggbb"], of: { bodyId: slot }, faces: { bodyId: { n, f: { face: slot } } } }
function printPaint(pp, bid) {
  obj(pp, "the print paint"); allow(pp, new Set(["slots", "of", "faces"]), "the print paint");
  const slots = arr(pp.slots, "the filaments", MAX_SLOTS), slot = (v) => { if (!Number.isInteger(v) || v < 0 || v >= slots.length) throw damaged("a filament number"); };
  for (const c of slots) if (typeof c !== "string" || !COLOR.test(c)) throw damaged("a filament colour");
  for (const [k, v] of Object.entries(obj(pp.of, "the filament of each body"))) { if (!bid.has(k)) throw damaged("print paint for a missing body"); slot(v); }
  let painted = 0;
  for (const [k, e] of Object.entries(pp.faces === undefined ? {} : obj(pp.faces, "the painted faces"))) {
    if (!bid.has(k)) throw damaged("print paint for a missing body");
    obj(e, "painted faces"); allow(e, new Set(["n", "f"]), "painted faces");
    if (!Number.isInteger(e.n) || e.n < 1 || e.n > LIMITS.PAINT_FACES) throw damaged("a face count");
    for (const [f, v] of Object.entries(obj(e.f, "painted faces"))) {
      if (!/^(?:0|[1-9]\d{0,3})$/.test(f) || +f >= e.n) throw damaged("a face number");
      slot(v);
      if (++painted > LIMITS.PAINT_FACES) throw tooBig("This design has too many painted faces for a link.");
    }
  }
}

// node: one shape-building step and its modifiers. Only the types and fields the kernel reads are in the tables.
function node(n, ctx, what) {
  if (++ctx.nodes > LIMITS.NODES) throw tooBig("This design has too many steps to open from a link.");
  allow(n, NODE_KEYS, what);
  if (!NODE_TYPES.has(n.t)) throw unsupported("a " + String(n.t).slice(0, 16).replace(/[^\w ]/g, "?") + " step");
  const sk = (v) => { if (typeof v !== "string" || !ctx.sketches.has(v)) throw damaged("a shape uses a missing sketch"); };
  const t = n.t;
  if (t === "prim") {
    if (!PRIM_KINDS.has(n.kind)) throw unsupported("a " + String(n.kind).slice(0, 16).replace(/[^\w ]/g, "?") + " shape");
    obj(n.p, "shape sizes");
    bounds({ ...n.p, exprs: n.exprs, exprUnits: n.exprUnits }, ctx, [["turns", LIMITS.TURNS, "turns"], ["sides", n.kind === "pyramid" ? LIMITS.PYRAMID_SIDES : LIMITS.SIDES, "sides"], ["points", LIMITS.POINTS, "points"]]);
    for (const [k, v] of Object.entries(n.p)) { if (!/^[A-Za-z0-9_]{1,16}$/.test(k)) throw damaged("a size name"); if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") throw damaged("a size"); }
  } else if (t === "extrude" || t === "revolve" || t === "sweep") {
    sk(n.sketch);
    arr(n.profiles, "profiles", LIMITS.SKETCH_ITEMS);
    if (t === "sweep") { obj(n.path, "a sweep path"); sk(n.path.sketch); }
  } else if (t === "pipe") {
    if (n.path !== undefined) { obj(n.path, "a pipe path"); sk(n.path.sketch); } // a 3D sketch pipe carries edgeSegs instead
  } else if (t === "loft") {
    arr(n.sections, "loft sections", LIMITS.BODIES).forEach((s) => { obj(s, "a loft section"); sk(s.sketch); });
    if (isObj(n.rail) && n.rail.sketch !== undefined) sk(n.rail.sketch);
  } else if (t === "group") {
    for (const c of arr(n.children, "group parts", LIMITS.BODIES * 4)) {
      obj(c, "a group part"); allow(c, CHILD_KEYS, "a group part");
      mat16(c.m, "a group part placement");
      node(obj(c.node, "a group part shape"), ctx, what);
    }
  } else if (t === "mirror" || t === "placed") {
    if (t === "mirror" && n.srcBody !== undefined) { id(n.srcBody, "a mirrored body"); ctx.bodyRefs.push(n.srcBody); } // a live mirror of another body
    else { node(obj(n.src, "a copied shape"), ctx, what); mat16(n.srcM, "a copied shape placement"); }
    if (t === "mirror") { obj(n.plane, "a mirror plane"); vec(n.plane.o, 3, "plane"); vec(n.plane.n, 3, "plane"); }
  } else if (t === "mesh" || t === "step") {
    if (typeof n.asset !== "string" || ctx.assets[n.asset] !== (t === "mesh" ? "mesh" : "step")) throw damaged("a model asset is missing");
  }
  exprs(n, ctx);
  if (t === "coil") bounds(n, ctx, [["turns", LIMITS.TURNS, "turns"]]);
  if (n.mods !== undefined) {
    const mids = new Set();
    for (const m of arr(n.mods, "modifiers", LIMITS.NODES)) {
      if (++ctx.nodes > LIMITS.NODES) throw tooBig("This design has too many steps to open from a link.");
      obj(m, "a modifier"); allow(m, MOD_KEYS, "a modifier");
      if (!MOD_TYPES.has(m.t)) throw unsupported("a " + String(m.t).slice(0, 16).replace(/[^\w ]/g, "?") + " modifier");
      id(m.id, "a modifier id"); if (mids.has(m.id)) throw damaged("duplicate modifier id"); mids.add(m.id);
      if (m.t === "bool") {
        if (m.src !== undefined) throw unsupported("a combined body");
        if (m.tool !== undefined) node(obj(m.tool, "a cutting shape"), ctx, what);
        if (m.m !== undefined) mat16(m.m, "a cutting shape placement");
      } else if (m.src !== undefined) throw damaged("a modifier source");
      exprs(m, ctx);
      counts(m, ctx);
    }
  }
}
// A typed expression is worked out with the design's parameters (the arithmetic parser, nothing else) and held to the same limits as a
// typed number. One that needs a name this check does not know (a sketch dimension) is left to the limits where that number comes from.
const COUNTED = new Set(["n1", "n2", "cn", "count", "turns", "sides", "points"]);
function exprs(o, ctx) {
  if (o.exprs !== undefined) {
    obj(o.exprs, "expressions");
    for (const [k, v] of Object.entries(o.exprs)) {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(k)) throw damaged("an expression name");
      text(v, "an expression", LIMITS.EXPR);
    }
  }
  if (o.exprUnits !== undefined) { obj(o.exprUnits, "expression units"); for (const v of Object.values(o.exprUnits)) if (!UNITS.has(v)) throw damaged("an expression unit"); }
  if (o.exprs) for (const k of Object.keys(o.exprs)) { const v = resolved(o, k, ctx, false); if (v !== undefined && k !== "angle" && !COUNTED.has(k) && Math.abs(v) > LIMITS.MEASURE) throw tooLarge(); }
}
// the number a value stands for: its expression worked out, else the typed number
function resolved(o, k, ctx, literal = true) {
  if (o.exprs && typeof o.exprs[k] === "string") {
    let v = NaN;
    try { v = evalExpr(o.exprs[k], ctx.scope, { unit: o.exprUnits && o.exprUnits[k], angle: k === "angle" }); } catch (e) { /* not resolvable here */ }
    if (isFinite(v)) return v;
  }
  return literal && typeof o[k] === "number" ? o[k] : undefined;
}
const repeatsTooMany = () => tooBig("This design repeats a shape more times than the app allows (at most 200 in each direction, 2,000 in all, 360 around a circle). Use a project file for this design.");
// each [key, most, what] is checked as the number it stands for; negative counts are refused too
function bounds(o, ctx, keys) {
  for (const [k, max, what] of keys) {
    const v = resolved(o, k, ctx);
    if (v !== undefined && !(v >= 0 && v <= max)) throw what ? tooBig(`This design has more ${what} than the app allows (at most ${max}). Use a project file for this design.`) : repeatsTooMany();
  }
}
// repeat counts are bounded before any CAD work: each one, and two directions together
function counts(m, ctx) {
  bounds(m, ctx, [["n1", LIMITS.REPEAT], ["n2", LIMITS.REPEAT], ["cn", LIMITS.CIRCULAR], ["count", LIMITS.REPEAT]]);
  if (Math.max(1, resolved(m, "n1", ctx) ?? 1) * Math.max(1, resolved(m, "n2", ctx) ?? 1) > LIMITS.REPEAT_TOTAL) throw repeatsTooMany();
}

// ---------------------------------------------------------------- the screens
let pending = null; // the fragment a link carried in, in memory only, until the person has decided
let current = null; // the dialog on screen: { back, close }
let job = 0; // a newer link supersedes an older one still being read
const after = []; // run once the decision is made (the crash-recovery offer waits for it)

// First thing the app does: take a share fragment out of the address into memory and off the address bar. history.replaceState can be
// refused (on file://); the link still imports, and the AI-agent hello strips the fragment itself.
export function captureShare() {
  try {
    const h = location.hash;
    if (!h.startsWith("#" + PREFIX)) return;
    pending = { frag: h.slice(1, 1 + LIMITS.FRAGMENT + 1) }; // one character over the cap is enough to refuse it
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* kept in the address bar; the hello and nothing else reads it */ }
  } catch (e) { /* no location: nothing to capture */ }
}

export function initShareLink(app) {
  const $ = (i) => document.getElementById(i);

  // one dialog at a time; a newer one replaces the older without deciding for it. onClose runs when the person closes it (X, Escape).
  function open(label, title, body, id) {
    if (current) current.close();
    const back = el("div", { class: "modal-back", id: id + "-back" });
    const handle = { onClose: null, close: () => { back.remove(); if (current === handle) current = null; } };
    const dismiss = () => { handle.close(); if (handle.onClose) handle.onClose(); };
    const modal = el("div", { class: "modal report share", id, role: "dialog", "aria-label": label },
      el("header", {}, el("h2", {}, title), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: dismiss })),
      el("div", { class: "mbody" }, body));
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); dismiss(); } });
    back.append(modal);
    document.body.append(back);
    current = handle;
    modal.querySelector(".xbtn").focus();
    return handle;
  }

  // ---- making a link
  async function showShare() {
    const note = el("p", { class: "rp-note", id: "share-note", role: "status" }, "Making the link…");
    const field = el("input", { type: "text", id: "share-url", readonly: true, "aria-label": "Share link", onfocus: (e) => e.target.select() });
    const copyBtn = el("button", { class: "btn primary", id: "share-copy", disabled: true }, "Copy link");
    const fileBtn = el("button", { class: "btn", id: "share-file", onclick: () => app.projects.exportJSON() }, "Save project file instead");
    const paste = el("input", { type: "text", id: "share-paste", placeholder: "Paste a link here", "aria-label": "A shared link to open", autocomplete: "off" });
    const problem = el("p", { class: "rp-note", id: "share-import-note", role: "status" });
    const importBtn = el("button", { class: "btn", id: "share-import", onclick: () => {
      let frag;
      try { frag = extractFragment(paste.value); parseFragment(frag); } catch (e) { problem.textContent = e instanceof ShareError ? e.message : "That is not a share link."; return; }
      handle.close(); pending = { frag }; offer();
    } }, "Import shared link");
    const handle = open("Share link", "Share link", [
      el("p", {}, "The whole design goes into the link: every body (also hidden ones), names, parameters and embedded pictures and models."),
      el("p", {}, "Your design is inside this link. Anyone with it can open and edit a copy. It is not encrypted. The browser does not send the fragment in the HTTP page request, but page scripts, browser extensions, history, clipboard sync and people you share with can read it."),
      field, note,
      el("div", { class: "rp-actions" }, copyBtn, fileBtn, el("button", { class: "btn", onclick: () => handle.close() }, "Close")),
      el("h3", {}, "Open a shared link"),
      el("p", {}, "Paste a complete link to open its design as a new design. This works in the downloaded file too. Nothing is fetched from the address."),
      paste, importBtn, problem,
    ], "share-dialog");
    let r;
    try { r = await makeLink(app.projects.liveDoc()); } catch (e) { r = { ok: false, reason: "error", message: "The link could not be made. Use a project file for this design." }; }
    if (current !== handle) return;
    if (!r.ok) { note.textContent = r.message; return; }
    field.value = r.url;
    const offline = !/^https?:$/.test(location.protocol);
    note.textContent = (offline ? "This link opens the community website. To open it in this offline copy, paste it into Import shared link. " : "") + (r.codec === "j" ? "This browser can't compress the design, so only small designs fit in a link; larger ones need a project file." : "Copy it and send it. The link is made on this computer; nothing was uploaded.");
    copyBtn.disabled = false;
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(r.url); app.toast("Link copied."); }
      catch (e) { field.focus(); field.select(); note.textContent = "This browser did not allow copying. The link is selected: copy it yourself (Ctrl+C, or Cmd+C on a Mac)."; }
    };
  }

  // ---- receiving a link
  function finish() { pending = null; while (after.length) { const f = after.shift(); try { f(); } catch (e) { /* a waiting task's own problem */ } } }
  async function offer() {
    const frag = pending && pending.frag, mine = ++job;
    if (frag === undefined) return;
    let doc;
    try { doc = await readFragment(frag); }
    catch (e) {
      if (mine !== job) return;
      const msg = e instanceof ShareError ? e.message : "This link could not be read.";
      const h = open("Shared design", "This link can't be opened", [el("p", { id: "share-problem" }, msg), el("div", { class: "rp-actions" }, el("button", { class: "btn primary", id: "share-ok", onclick: () => { h.close(); finish(); } }, "Close"))], "share-offer");
      h.onClose = finish;
      return;
    }
    if (mine !== job) return;
    const count = doc.bodies.length;
    const status = el("p", { class: "rp-note", id: "share-offer-note", role: "status" });
    const row = el("div", { class: "rp-actions" });
    const yes = el("button", { class: "btn primary", id: "share-accept" }, "Open as new design");
    const no = el("button", { class: "btn", id: "share-decline", onclick: () => { h.close(); finish(); } }, "Keep current design");
    row.append(yes, no);
    const h = open("Open shared design?", "Open shared design?", [
      el("p", {}, "Someone shared a design with you. Nothing has been opened yet; it only opens if you choose to."),
      el("p", { id: "share-offer-info" }, el("b", { id: "share-offer-name" }, doc.name || "Untitled"), ` · ${doc.mode === "advanced" ? "Advanced" : "Beginner"} · ${count} ${count === 1 ? "body" : "bodies"}`),
      el("p", {}, "It opens as a new design. The design you have open now stays saved as it is."),
      row, status,
    ], "share-offer");
    h.onClose = finish;
    let busy = false;
    const accept = async () => {
      if (busy) return;
      busy = true; yes.disabled = true; no.disabled = true; status.textContent = "Saving your current design first…";
      let r;
      try { r = await app.projects.importShared(doc); } catch (e) { r = "error"; }
      if (mine !== job) return;
      if (r === "ok") { h.close(); finish(); app.toast(`Opened "${doc.name || "Untitled"}" as a new design.`); return; }
      if (r === "save-failed") {
        status.textContent = "Your current design could not be saved in this browser, so nothing was opened. Save it as a file, or try again.";
        row.replaceChildren(
          el("button", { class: "btn", id: "share-save-mine", onclick: () => app.projects.exportJSON() }, "Save my design as a project file"),
          el("button", { class: "btn primary", id: "share-retry", onclick: () => { row.replaceChildren(yes, no); accept(); } }, "Retry"),
          el("button", { class: "btn", id: "share-cancel", onclick: () => { h.close(); finish(); } }, "Cancel"));
        busy = false; return;
      }
      status.textContent = r === "stale" ? "You changed designs while this was opening, so nothing was opened. Check your design, then open it again."
        : r === "storage" ? "This browser could not store the new design (its storage is full or blocked). Your current design is still open."
          : r === "chisel" ? "Leave Chisel mode first, then open the shared design."
            : "The shared design could not be opened. Your current design is still open.";
      yes.disabled = false; no.disabled = false; busy = false;
    };
    yes.onclick = accept;
    no.focus();
  }

  // a recognized fragment arriving later (pasted into the address bar of an open tab) goes through the same capture and confirmation
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#" + PREFIX)) return;
    captureShare();
    if (pending) offer();
  });

  const entry = $("btn-share-link");
  if (entry) entry.addEventListener("click", () => { $("menu-export").hidden = true; showShare(); }); // no data-act: projects.js ignores it

  app.sharelink = {
    busy: () => !!pending,
    afterDecision: (f) => { if (app.sharelink.busy()) after.push(f); else f(); },
    offer: () => { if (pending) offer(); },
    show: showShare,
  };
}
