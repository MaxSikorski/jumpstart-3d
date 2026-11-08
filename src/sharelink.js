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
import { GEAR_DEFAULTS } from "./gearlib.js";

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
  // jumpstart-3d: J.Siwek 2.9.3 parts. Browser folders; a rack of at most 400 teeth; outline pieces across the whole design; the pairs of
  // outline pieces the crossing check may compare before it gives up (a real gear needs a few per piece). Box Maker: compartments x bins.
  FOLDERS: 256, FOLDER_NAME: 60, RACK_TEETH: 400, OUTLINE_SEGMENTS: 20000, OUTLINE_PAIRS: 4e6, OUTLINE_HOLES: 16, BIN_WORK: 1600,
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
const DOC_KEYS = new Set(["v", "id", "name", "mode", "created", "seq", "grid", "bodies", "sketches", "planes", "joints", "params", "assets", "media", "ver", "printPaint", "folders"]);
// the part kinds of the Fasteners dialog (FASTENER_KINDS in fasteners.js, which this module does not import; test/sharelink.test.mjs compares)
export const FASTENER_KINDS = new Set(["hexbolt", "shcs", "button", "flat", "set", "wood", "rod", "nut", "nyloc", "sqnut", "washer", "lockw", "insert", "dowel", "cutter"]);
const BODY_KEYS = new Set(["id", "name", "seq", "color", "hole", "hidden", "m", "node", "brick", "media", "locked", "fastener", "bin", "binLid", "binPart", "hinge", "hingePart", "gear", "gearPart", "folder"]); // fastener: the Fasteners dialog's settings (J.Siwek 2.7.8, with our thread fit)
const NODE_TYPES = new Set(["prim", "extrude", "revolve", "sweep", "pipe", "coil", "group", "loft", "mirror", "placed", "mesh", "step"]);
const NODE_KEYS = new Set(["t", "id", "name", "color", "hidden", "kind", "p", "mods", "exprs", "exprUnits", "children", "sketch", "profiles", "dist", "mode", "dist2", "axis", "axisWorld", "angle", "path", "orient", "taper", "twist", "chain", "section", "size", "hollow", "wall", "edgeSegs", "railEdgeSegs", "railScale", "sections", "rail", "ruled", "closed", "src", "srcM", "srcBody", "plane", "asset", "k", "left", "pitch", "turns", "pos", "d", "h", "stretch", "keepPos", "regions", "op", "parts"]);
const PRIM_KINDS = new Set(["box", "cylinder", "tube", "cone", "pyramid", "prism", "wedge", "sphere", "hemisphere", "torus", "text", "star", "heart", "roof", "roundroof", "paraboloid", "gem", "capsule", "arrow", "spring"]);
const CHILD_KEYS = new Set(["node", "m", "hole", "color", "name", "hidden", "id", "seq"]);
const MOD_TYPES = new Set(["fillopen", "fillet", "chamfer", "hole", "bool", "keeppiece", "halfspace", "sketchsplit", "splitface", "offset", "shell", "emboss", "facepat", "thread", "scale", "pattern"]);
const MOD_KEYS = new Set(["keep", "id", "seq", "t", "exprs", "exprUnits", "angle", "at", "ax1", "ax2", "cax", "cbDepth", "cbDia", "center", "chain", "clear", "closed", "cn", "count", "csAngle", "csDia", "curves", "d", "depth", "dia", "dir", "edges", "face", "faces", "feats", "flip", "k", "kind", "left", "length", "m", "mode", "n", "n1", "n2", "o", "op", "p", "piece", "pitch", "plane", "poly", "r", "s1", "s2", "sets", "side", "sym", "th", "through", "tip", "tool", "what", "size", "x", "str", "font", "along", "mirror", "reverse", "sketch", "tapped", "hidden", "src", "sole"]);
const SKETCH_KEYS = new Set(["id", "name", "seq", "plane", "pts", "ents", "hidden", "onBody", "faceCenter", "fromFace", "cons", "image"]);
const ENT_KEYS = {
  line: ["a", "b"], circle: ["c", "r"], arc: ["c", "a", "b"], spline: ["pts", "closed"], point: ["p"], text: ["p", "str", "size", "angle", "font"],
};
const CON_KEYS = new Set(["id", "t", "p", "p1", "p2", "e", "e1", "e2", "k", "o", "v", "off", "expr", "unit", "name", "s1", "s2", "sg", "x", "y"]); // sg: jumpstart-3d: sketch solver (an angle's turning direction)
const CON_TYPES = new Set(["fixed", "origin", "coincident", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "concentric", "equal", "midpoint", "dim"]);
const PLANE_KEYS = new Set(["id", "name", "seq", "kind", "def", "plane", "size", "hidden"]);
const MEDIA_MAPS = new Set(["front", "wrap", "box", "ball"]);
const UNITS = new Set(["mm", "cm", "m", "in", "ft", "deg"]);

function num(v, what) { if (typeof v !== "number" || !Number.isFinite(v)) throw damaged(what + " is not a number"); return v; }
function bool(v, what) { if (typeof v !== "boolean") throw damaged(what + " is not true or false"); return v; }
function text(v, what, max = LIMITS.NAME) { if (typeof v !== "string" || v.length > max) throw damaged(what + " is not text, or is too long"); return v; }
function id(v, what) { if (typeof v !== "string" || !ID.test(v)) throw damaged(what + " is not a valid id"); return v; }
function obj(v, what) { if (!isObj(v)) throw damaged(what + " is not an object"); return v; }
function arr(v, what, max) { if (!Array.isArray(v) || v.length > max) throw damaged(what + " is not a list, or is too long"); return v; }
function vec(v, n, what) { if (!Array.isArray(v) || v.length !== n) throw damaged(what + " is not " + n + " numbers"); v.forEach((x) => num(x, what)); return v; }
function normal(v, what) { vec(v, 3, what); const length = Math.hypot(...v); if (!Number.isFinite(length) || !(length > 1e-9)) throw damaged(what); }
function allow(o, keys, what) { for (const k of Object.keys(o)) if (!keys.has(k)) throw unsupported(what + " has " + k.slice(0, 32).replace(/[^\w.-]/g, "?")); }
function positive(v, what) { if (!(num(v, what) > 0 && v <= LIMITS.MEASURE)) throw damaged(what); }
function nonnegative(v, what) { if (!(num(v, what) >= 0 && v <= LIMITS.MEASURE)) throw damaged(what); }
function count(v, max, what) { if (!Number.isInteger(v) || v < 1 || v > max) throw damaged(what); }

// jumpstart-3d: an extrude that carries its outline: { regions: [{ outer: [segment], holes?: [[segment]] }], plane: { o, x, n }, dist, mode }.
// Segments are lines { t, a, b } and three-point arcs { t, a, b, m } in the plane (what bins.js writes); nothing else reaches the kernel.
// jumpstart-3d: J.Siwek 2.9.3 gears add a loop that is one whole circle { t: "circle", c, r } (a bore, a ring's rim, a lightening hole).
// Every loop must be closed, every piece must have length, and no loop may cross or touch itself (except neighbours at their shared end):
// the kernel makes each loop a face, and a loop that crosses itself is no face. How the holes lie against the outer loop and each other is
// left to the kernel, which cuts each hole from the outline as a flat boolean: the app makes such outlines itself (a big gear's lightening
// holes overlap; a big keyway on a small gear cuts into its teeth). An arc is checked as its two chords.
function inlineExtrude(n, ctx) {
  const pt = (v) => { vec(v, 2, "an outline point"); if (Math.abs(v[0]) > LIMITS.MEASURE || Math.abs(v[1]) > LIMITS.MEASURE) throw damaged("an outline point"); };
  const piece = () => { if (++ctx.outline > LIMITS.OUTLINE_SEGMENTS) throw tooBig("This design has too many outline pieces for a link."); };
  const same = (p, q) => Math.abs(p[0] - q[0]) <= 1e-9 && Math.abs(p[1] - q[1]) <= 1e-9;
  // a loop -> the corners of the polygon the checks use
  const loop = (l) => {
    if (Array.isArray(l) && ctx.outline + l.length > LIMITS.OUTLINE_SEGMENTS) throw tooBig("This design has too many outline pieces for a link.");
    arr(l, "an outline", LIMITS.OUTLINE_SEGMENTS);
    if (l.length === 1 && isObj(l[0]) && l[0].t === "circle") {
      const g = l[0]; allow(g, new Set(["t", "c", "r"]), "an outline circle"); pt(g.c); positive(g.r, "an outline radius"); piece();
      if (Math.abs(g.c[0]) + g.r > LIMITS.MEASURE || Math.abs(g.c[1]) + g.r > LIMITS.MEASURE) throw damaged("an outline circle");
      return Array.from({ length: 32 }, (_, i) => [g.c[0] + g.r * Math.cos((i * Math.PI) / 16), g.c[1] + g.r * Math.sin((i * Math.PI) / 16)]);
    }
    if (l.length < 2) throw damaged("an outline");
    const poly = [];
    for (let i = 0; i < l.length; i++) {
      const g = obj(l[i], "an outline piece");
      if (g.t === "line") allow(g, new Set(["t", "a", "b"]), "an outline line");
      else if (g.t === "arc") { allow(g, new Set(["t", "a", "b", "m"]), "an outline arc"); pt(g.m); }
      else throw unsupported("an outline piece");
      pt(g.a); pt(g.b); piece();
      if (g.t === "arc") { // three points on one line make no arc
        const ux = g.m[0] - g.a[0], uy = g.m[1] - g.a[1], vx = g.b[0] - g.a[0], vy = g.b[1] - g.a[1];
        if (!(Math.abs(ux * vy - uy * vx) > 1e-9 * Math.max(ux * ux + uy * uy, vx * vx + vy * vy))) throw damaged("a degenerate outline arc");
      }
      // the kernel closes a loop itself and never draws its last line, so a last line that starts where the loop starts is no piece at all
      // (gearlib.js's keyway bore ends that way)
      if (i === l.length - 1 && g.t === "line" && Math.hypot(g.a[0] - l[0].a[0], g.a[1] - l[0].a[1]) <= 1e-6) continue;
      poly.push(g.a); if (g.t === "arc") poly.push(g.m);
    }
    for (let i = 0; i < l.length; i++) if (!same(l[i].b, l[(i + 1) % l.length].a)) throw damaged("an outline that is not closed");
    return poly;
  };
  // the app writes one outline per extrude, with at most 9 holes (a gear's bore and 8 lightening holes): each hole is a cut in the engine
  const regions = arr(n.regions, "outlines", 1);
  if (!regions.length) throw damaged("an empty outline");
  for (const r of regions) {
    obj(r, "an outline"); allow(r, new Set(["outer", "holes"]), "an outline");
    const loops = [loop(r.outer)];
    if (r.holes !== undefined) for (const h of arr(r.holes, "outline holes", LIMITS.OUTLINE_HOLES)) loops.push(loop(h));
    simpleOutline(loops, ctx);
  }
  const pl = obj(n.plane, "an outline plane"); allow(pl, new Set(["o", "x", "n"]), "an outline plane");
  vec(pl.o, 3, "plane"); if (pl.o.some((x) => Math.abs(x) > LIMITS.MEASURE)) throw damaged("plane"); normal(pl.x, "plane direction"); normal(pl.n, "plane normal");
  // jumpstart-3d: the plane's x must lie across n, not along it (no plane can be built from two parallel directions)
  if (Math.abs(pl.x[0] * pl.n[0] + pl.x[1] * pl.n[1] + pl.x[2] * pl.n[2]) / (Math.hypot(...pl.x) * Math.hypot(...pl.n)) > 0.999) throw damaged("plane direction");
  if (!(Math.abs(num(n.dist, "a distance")) <= LIMITS.MEASURE)) throw damaged("a distance");
  if (n.mode !== undefined && !["one", "sym", "two"].includes(n.mode)) throw damaged("an extrude mode");
  if (n.dist2 !== undefined && !(Math.abs(num(n.dist2, "a distance")) <= LIMITS.MEASURE)) throw damaged("a distance");
}

// loops[0] is the outer polygon, the rest are holes; each is checked on its own. Pieces go in a grid so a big gear (thousands of pieces) is cheap to check; a
// design built to crowd its pieces into one cell, or to send long pieces across every cell, runs into OUTLINE_PAIRS (cells visited and
// pairs compared, together) and is refused, never left to run.
const complicated = () => tooBig("This design's outlines are too complicated to check for a link.");
function simpleOutline(loops, ctx) {
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; };
  const edges = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  loops.forEach((p, k) => {
    if (!(Math.abs(area(p)) > 1e-9)) throw damaged("an outline with no area");
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      if (Math.hypot(ux, uy) <= 1e-7) throw damaged("an outline piece with no length");
      // the next piece turning straight back along this one
      if (Math.abs(ux * vy - uy * vx) <= 1e-12 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy < 0) throw damaged("an outline that doubles back");
      edges.push({ a, b, k, i, n: p.length });
      x0 = Math.min(x0, a[0]); y0 = Math.min(y0, a[1]); x1 = Math.max(x1, a[0]); y1 = Math.max(y1, a[1]);
    }
  });
  const G = Math.max(1, Math.ceil(Math.sqrt(edges.length))), size = Math.max(x1 - x0, y1 - y0, 1e-9) / G, cells = new Map();
  const cell = (v, o) => Math.min(G - 1, Math.max(0, Math.floor((v - o) / size)));
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const within = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const meet = (e, f) => {
    const d1 = orient(e.a, e.b, f.a), d2 = orient(e.a, e.b, f.b), d3 = orient(f.a, f.b, e.a), d4 = orient(f.a, f.b, e.b);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return (d1 === 0 && within(e.a, e.b, f.a)) || (d2 === 0 && within(e.a, e.b, f.b)) || (d3 === 0 && within(f.a, f.b, e.a)) || (d4 === 0 && within(f.a, f.b, e.b));
  };
  const neighbours = (e, f) => e.k === f.k && ((e.i + 1) % e.n === f.i || (f.i + 1) % f.n === e.i);
  edges.forEach((e, j) => {
    const seen = new Set();
    for (let cx = cell(Math.min(e.a[0], e.b[0]), x0); cx <= cell(Math.max(e.a[0], e.b[0]), x0); cx++) for (let cy = cell(Math.min(e.a[1], e.b[1]), y0); cy <= cell(Math.max(e.a[1], e.b[1]), y0); cy++) {
      if (++ctx.outlinePairs > LIMITS.OUTLINE_PAIRS) throw complicated();
      const key = cx * G + cy, list = cells.get(key);
      if (!list) { cells.set(key, [j]); continue; }
      for (const o of list) {
        if (++ctx.outlinePairs > LIMITS.OUTLINE_PAIRS) throw complicated();
        if (seen.has(o)) continue;
        seen.add(o);
        const f = edges[o];
        if (e.k === f.k && !neighbours(e, f) && meet(e, f)) throw unsupported("an outline that crosses or touches itself");
      }
      list.push(j);
    }
  });
}

// Saved edge paths are fixed world-space segments, not references to the source body.
function segments(v) {
  const list = arr(v, "path segments", 2000);
  if (!list.length) throw damaged("an empty path");
  for (const s of list) {
    obj(s, "a path segment");
    const types = { line: ["a", "b"], arc: ["a", "b", "m"], circle: ["c", "n", "r"], bsp: ["a", "b", "pts"], bez: ["a", "b", "spans"] };
    if (typeof s.t !== "string" || !Object.hasOwn(types, s.t)) throw damaged("a path segment type");
    const keys = types[s.t];
    allow(s, new Set(["t", ...keys]), "a path segment");
    for (const k of keys.filter((k) => ["a", "b", "m", "c", "n"].includes(k))) vec(s[k], 3, "a path point");
    if (s.t === "circle") { normal(s.n, "a path normal"); positive(s.r, "a path radius"); }
    if (s.t === "arc") {
      const u = s.m.map((x, i) => x - s.a[i]), v = s.b.map((x, i) => x - s.a[i]);
      const scale = Math.max(Math.hypot(...u), Math.hypot(...v));
      const cross = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      if (Math.hypot(...u) <= 1e-6 || Math.hypot(...v) <= 1e-6 || Math.hypot(...s.m.map((x, i) => x - s.b[i])) <= 1e-6 || cross <= 1e-6 * scale * scale) throw damaged("a degenerate path arc");
    }
    if (s.t === "bsp") { const p = arr(s.pts, "path points", 2000); if (p.length < 2) throw damaged("path points"); p.forEach((x) => vec(x, 3, "a path point")); }
    if (s.t === "bez") { const spans = arr(s.spans, "path spans", 2000); if (!spans.length) throw damaged("path spans"); for (const span of spans) { if (!Array.isArray(span) || span.length !== 4) throw damaged("a path span"); span.forEach((x) => vec(x, 3, "a path point")); } }
  }
}
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
  if (!Number.isFinite(x)) throw damaged("a number is not finite");
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
  const ctx = { nodes: 0, bodyRefs: [], assetBytes: 0, sketches: new Map(), assets: {}, media: {}, outline: 0, outlinePairs: 0 };

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
    if (!Number.isFinite(v)) throw damaged("parameter " + p.name + " does not evaluate");
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
    obj(s.plane, "a sketch plane"); allow(s.plane, new Set(["o", "x", "n"]), "a sketch plane"); vec(s.plane.o, 3, "plane"); vec(s.plane.x, 3, "plane"); normal(s.plane.n, "plane normal");
    if (s.hidden !== undefined) bool(s.hidden, "hidden"); if (s.fromFace !== undefined) bool(s.fromFace, "fromFace");
    if (s.onBody !== undefined) text(s.onBody, "onBody", 64);
    if (s.faceCenter !== undefined) vec(s.faceCenter, 2, "faceCenter");
    const pts = arr(s.pts, "sketch points", LIMITS.SKETCH_ITEMS), ents = arr(s.ents, "sketch shapes", LIMITS.SKETCH_ITEMS), cons = arr(s.cons === undefined ? [] : s.cons, "constraints", LIMITS.SKETCH_ITEMS);
    items += pts.length + ents.length;
    if (items > LIMITS.SKETCH_ITEMS) throw tooBig("This design has too many sketch points for a link.");
    const pid = new Set(), eid = new Set(), pathIds = new Set();
    for (const p of pts) { obj(p, "a sketch point"); allow(p, new Set(["id", "x", "y"]), "a sketch point"); id(p.id, "a point id"); if (pid.has(p.id)) throw damaged("duplicate point id"); pid.add(p.id); num(p.x, "x"); num(p.y, "y"); }
    const pointsById = new Map(pts.map((p) => [p.id, p]));
    const needP = (v) => { if (typeof v !== "string" || !pid.has(v)) throw damaged("a sketch shape points at a missing point"); };
    for (const e of ents) {
      obj(e, "a sketch shape");
      const keys = typeof e.t === "string" && Object.hasOwn(ENT_KEYS, e.t) ? ENT_KEYS[e.t] : undefined;
      if (!keys) throw unsupported("a " + String(e.t).slice(0, 16).replace(/[^\w ]/g, "?") + " shape in a sketch");
      allow(e, new Set(["id", "t", "cons", "proj", ...keys]), "a sketch shape");
      id(e.id, "a shape id"); if (eid.has(e.id)) throw damaged("duplicate shape id"); eid.add(e.id);
      if (["line", "arc", "circle", "spline"].includes(e.t)) pathIds.add(e.id);
      if (e.cons !== undefined) bool(e.cons, "cons"); if (e.proj !== undefined) bool(e.proj, "proj");
      if (e.t === "line") { needP(e.a); needP(e.b); }
      else if (e.t === "circle") { needP(e.c); num(e.r, "radius"); }
      else if (e.t === "arc") { needP(e.c); needP(e.a); needP(e.b); const a = pointsById.get(e.a), b = pointsById.get(e.b); if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) throw damaged("a degenerate sketch arc"); }
      else if (e.t === "spline") { arr(e.pts, "spline points", LIMITS.SKETCH_ITEMS).forEach(needP); if (e.closed !== undefined) bool(e.closed, "closed"); }
      else if (e.t === "point") needP(e.p);
      else if (e.t === "text") { needP(e.p); text(e.str, "text", LIMITS.STRING); num(e.size, "text size"); if (e.angle !== undefined) num(e.angle, "angle"); if (e.font !== undefined) text(e.font, "font", 32); }
    }
    const cid = new Set(), pinned = new Set(); // jumpstart-3d: fixed constraint (pinned: points already held by a Fixed or an origin pin)
    for (const c of cons) {
      obj(c, "a constraint"); allow(c, CON_KEYS, "a constraint");
      if (typeof c.t !== "string" || !CON_TYPES.has(c.t)) throw unsupported("a " + String(c.t).slice(0, 16).replace(/[^\w ]/g, "?") + " constraint");
      id(c.id, "a constraint id"); if (cid.has(c.id)) throw damaged("duplicate constraint id"); cid.add(c.id);
      for (const k of ["p", "p1", "p2"]) if (c[k] !== undefined && c[k] !== null) needP(c[k]);
      for (const k of ["e", "e1", "e2"]) if (c[k] !== undefined && c[k] !== null && (typeof c[k] !== "string" || !eid.has(c[k]))) throw damaged("a constraint points at a missing shape");
      if (c.t === "fixed" || c.t === "origin") { // jumpstart-3d: fixed constraint: a point is held once, and never one that is projected from a body
        if (c.t === "fixed") { needP(c.p); num(c.x, "fixed x"); num(c.y, "fixed y"); }
        if (pinned.has(c.p)) throw damaged("a point that is fixed twice");
        pinned.add(c.p);
        if (c.t === "fixed" && ents.some((e) => e.proj && [e.a, e.b, e.c, e.p].includes(c.p) || (e.pts || []).includes(c.p))) throw damaged("a fixed point on a shape projected from a body");
      }
      if (c.expr !== undefined) text(c.expr, "a dimension expression", LIMITS.EXPR);
      if (c.unit !== undefined && !UNITS.has(c.unit)) throw damaged("a dimension unit");
      if (c.name !== undefined) text(c.name, "a dimension name", 64);
      if (c.sg !== undefined && c.sg !== 1 && c.sg !== -1) throw damaged("an angle direction"); // jumpstart-3d: sketch solver
    }
    if (s.image !== undefined) {
      obj(s.image, "a sketch picture"); allow(s.image, new Set(["src", "name", "w", "h", "cx", "cy", "rot", "opacity"]), "a sketch picture");
      if (s.image.src !== null) { text(s.image.src, "a picture", LIMITS.JSON_BYTES); image(s.image.src, "a sketch picture"); } // jumpstart-3d: preserve a quarantined picture placement
      if (ctx.assetBytes > LIMITS.ASSET_BYTES) throw tooBig("The pictures and imported models in this design are too big for a link.");
      for (const k of ["w", "h", "cx", "cy", "rot", "opacity"]) if (s.image[k] !== undefined) num(s.image[k], "a picture " + k);
    }
    ctx.sketches.set(s.id, pathIds);
  }

  // planes
  const planes = arr(doc.planes === undefined ? [] : doc.planes, "planes", LIMITS.SKETCHES), plid = new Set();
  for (const p of planes) { obj(p, "a plane"); allow(p, PLANE_KEYS, "a plane"); id(p.id, "a plane id"); if (plid.has(p.id)) throw damaged("duplicate plane id"); plid.add(p.id); if (p.name !== undefined) text(p.name, "a plane name"); }

  // jumpstart-3d: J.Siwek 2.9.3 Browser folders: flat (no folder inside a folder), shown as text only
  const folders = arr(doc.folders === undefined ? [] : doc.folders, "folders", LIMITS.FOLDERS), fid = new Set();
  for (const f of folders) {
    obj(f, "a folder"); allow(f, new Set(["id", "name", "open"]), "a folder");
    id(f.id, "a folder id"); if (fid.has(f.id)) throw damaged("duplicate folder id"); fid.add(f.id);
    if (!text(f.name, "a folder name", LIMITS.FOLDER_NAME).trim()) throw damaged("a folder name");
    bool(f.open, "a folder open");
  }

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
      if (typeof b.media.id !== "string" || !Object.hasOwn(ctx.media, b.media.id)) throw damaged("a body uses missing media");
      if (b.media.map !== undefined && !MEDIA_MAPS.has(b.media.map)) throw damaged("media map");
      for (const k of ["rep", "rot"]) if (b.media[k] !== undefined) num(b.media[k], k);
      for (const k of ["mirror", "both"]) if (b.media[k] !== undefined) bool(b.media[k], k);
      if (b.media.dir !== undefined) vec(b.media.dir, 3, "dir"); if (b.media.up !== undefined) vec(b.media.up, 3, "up"); if (b.media.crop !== undefined) vec(b.media.crop, 4, "crop");
    }
    if (b.fastener !== undefined) {
      const fa = b.fastener, has = (k) => fa[k] !== undefined && fa[k] !== null;
      obj(fa, "a fastener"); allow(fa, new Set(["kind", "std", "size", "len", "threads", "name", "clear", "left"]), "a fastener");
      if (typeof fa.kind !== "string" || !FASTENER_KINDS.has(fa.kind)) throw damaged("a fastener kind");
      if (has("std") && fa.std !== "metric" && fa.std !== "inch") throw damaged("a fastener standard");
      for (const k of ["size", "name"]) if (has(k)) text(fa[k], k, 64);
      if (has("len") && !(num(fa.len, "a fastener length") > 0 && fa.len <= LIMITS.MEASURE)) throw damaged("a fastener length");
      if (has("clear") && !(num(fa.clear, "a print offset") >= -1 && fa.clear <= 1)) throw damaged("a print offset");
      for (const k of ["threads", "left"]) if (fa[k] !== undefined) bool(fa[k], k);
    }
    if (b.bin !== undefined && (b.binLid !== undefined || b.binPart !== undefined) || b.binLid !== undefined && b.binPart !== undefined || b.hinge !== undefined && b.hingePart !== undefined) throw damaged("conflicting part roles");
    // jumpstart-3d: J.Siwek 2.9.3 gear sets: the first gear holds the set (gear), every other gear points back at it (gearPart)
    if ((b.gear !== undefined || b.gearPart !== undefined) && ["bin", "binLid", "binPart", "hinge", "hingePart", "gear", "gearPart"].filter((k) => b[k] !== undefined).length > 1) throw damaged("conflicting part roles");
    if (b.folder !== undefined && (typeof b.folder !== "string" || !fid.has(b.folder))) throw damaged("a body in a missing folder");
    if (b.gear !== undefined) gearSettings(b.gear);
    const ref = (v) => { id(v, "a part body id"); };
    for (const k of ["binLid", "binPart", "hingePart", "gearPart"]) if (b[k] !== undefined) ref(b[k]);
    if (b.bin !== undefined) {
      const o = obj(b.bin, "a bin");
      allow(o, new Set(["w", "d", "h", "cols", "rows", "wall", "divider", "floor", "radius", "shape", "inner", "scoop", "scoopR", "label", "labelW", "stack", "foot", "lid", "lidT", "clear", "lidId", "style", "units", "lock", "caseT", "pull", "hinge", "doorPull", "layout", "ids", "across", "sideLock", "doorCatch"]), "a bin"); // jumpstart-3d: J.Siwek 2.9.5 cases (drawer, tilt bin, door), stacking and the ids of the set's other bodies; 2.9.8 grids (across) and side joints (sideLock); 2.9.8.1 door catch (doorCatch)
      for (const k of ["w", "d", "h", "wall", "divider", "floor", "scoopR", "labelW", "foot", "lidT", "caseT"]) if (o[k] !== undefined) positive(o[k], k);
      for (const k of ["radius", "inner", "clear"]) if (o[k] !== undefined) nonnegative(o[k], k);
      for (const k of ["cols", "rows"]) if (o[k] !== undefined) count(o[k], 20, k);
      for (const k of ["scoop", "label", "stack", "lid"]) if (o[k] !== undefined) bool(o[k], k);
      if (o.shape !== undefined && !["square", "round", "hex"].includes(o.shape)) throw damaged("a bin shape");
      if (o.lidId != null) ref(o.lidId);
      if (o.units !== undefined) count(o.units, 8, "units");
      if (o.across !== undefined) count(o.across, 8, "across"); // jumpstart-3d: 2.9.8 grids, 1 to 8 across like bins.js
      for (const [k, list] of [["style", ["bin", "drawer", "tilt", "door"]], ["lock", ["dovetail", "pegs", "none"]], ["sideLock", ["dovetail", "pegs", "none"]], ["pull", ["bar", "knob", "notch"]], ["hinge", ["left", "right"]], ["doorPull", ["knob", "hole", "bar"]], ["doorCatch", ["none", "light", "firm"]], ["layout", ["", "stack", "print"]]]) if (o[k] !== undefined && !list.includes(o[k])) throw damaged("a bin " + k);
      if (o.ids !== undefined) {
        const e = Object.entries(obj(o.ids, "a bin set"));
        // jumpstart-3d: up to 8 x 8 units (2.9.8 grids): bin1-bin63 or case1-case63, front0-front63, and a lid
        if (e.length > 128) throw damaged("a bin set");
        for (const [k, v] of e) { if (!/^(?:lid|(?:bin|case)(?:[1-9]|[1-5]\d|6[0-3])|front(?:\d|[1-5]\d|6[0-3]))$/.test(k)) throw unsupported("a bin set has " + k.slice(0, 16).replace(/[^\w.-]/g, "?")); ref(v); }
        // one body per part: the same body under two keys, or a lid other than lidId, is not a set the app makes
        if (new Set(e.map(([, v]) => v)).size !== e.length) throw damaged("a bin set lists a body twice");
        if (o.ids.lid !== undefined && o.lidId != null && o.ids.lid !== o.lidId) throw damaged("a bin set has two lids");
        // jumpstart-3d: build 31 review: no part numbered past the set (units high x across)
        for (const [k] of e) if (k !== "lid" && +k.replace(/^\D+/, "") >= (o.units ?? 1) * (o.across ?? 1)) throw damaged("a bin set part past the end of the set");
      }
      // jumpstart-3d: build 31 review: the compartments of every bin together (bins and drawers have columns and rows, a tilt bin columns)
      const style = o.style ?? "bin", cells = style === "bin" || style === "drawer" ? (o.cols ?? 1) * (o.rows ?? 1) : style === "tilt" ? (o.cols ?? 1) : 1;
      if (cells * (o.units ?? 1) * (o.across ?? 1) > LIMITS.BIN_WORK) throw tooBig(`This Box Maker set has more compartments than a link can open (at most ${LIMITS.BIN_WORK} in all). Use a project file for this design.`);
    }
    if (b.hinge !== undefined) {
      const o = obj(b.hinge, "a hinge");
      allow(o, new Set(["type", "len", "dia", "knuckles", "leafW", "leafT", "clear", "pin", "screws", "screwD", "gap", "thin", "bId", "pinId", "kind"]), "a hinge");
      for (const k of ["len", "dia", "leafW", "leafT", "clear", "screwD", "gap", "thin"]) if (o[k] !== undefined) positive(o[k], k);
      if (o.knuckles !== undefined) count(o.knuckles, 25, "knuckles");
      if (o.type !== undefined && !["pip", "pin", "living"].includes(o.type)) throw damaged("a hinge type");
      if (o.pin !== undefined && !["filament", "m2", "m3", "printed"].includes(o.pin)) throw damaged("a hinge pin");
      if (o.screws !== undefined) bool(o.screws, "screws");
      if (o.kind !== undefined) text(o.kind, "hinge name");
      for (const k of ["bId", "pinId"]) if (o[k] != null) ref(o[k]);
    }
    node(obj(b.node, "a body shape"), ctx, "a shape");
  }
  for (const r of ctx.bodyRefs) if (!bid.has(r)) throw damaged("a mirror points at a missing body");
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    const check = (o, key, matches) => {
      const targetId = o[key];
      if (targetId == null) return;
      if (targetId === b.id) throw damaged("a part points at itself");
      const target = byId.get(targetId);
      if (!target) { delete o[key]; return; }
      if (!matches(target)) throw damaged("part references do not agree");
    };
    if (b.bin) check(b.bin, "lidId", (target) => target.binLid === b.id || target.binPart === b.id);
    if (b.bin && b.bin.ids) for (const k of Object.keys(b.bin.ids)) check(b.bin.ids, k, (target) => target.binPart === b.id || target.binLid === b.id); // jumpstart-3d: 2.9.5 sets: every part points back at the first body
    if (b.hinge) for (const key of ["bId", "pinId"]) check(b.hinge, key, (target) => target.hingePart === b.id);
    check(b, "binLid", (target) => target.bin?.lidId === b.id);
    check(b, "binPart", (target) => !!target.bin && (target.bin.lidId === b.id || Object.values(target.bin.ids || {}).includes(b.id)));
    check(b, "hingePart", (target) => target.hinge && (target.hinge.bId === b.id || target.hinge.pinId === b.id));
    if (b.hinge?.bId != null && b.hinge.bId === b.hinge.pinId) throw damaged("part references do not agree");
    check(b, "gearPart", (target) => !!target.gear);
  }
  gearSets(bodies, byId, doc);
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

// jumpstart-3d: J.Siwek 2.9.3 gear sets (gearlib.js, the Gears dialog in advanced.js). The settings make a new set on Edit, so they are held
// to the dialog's own ranges even when the saved gears look harmless: gear { o: settings, ids: { role: body }, jids: { role: joint }, base, base0, spin }.
const GEAR_KEYS = new Set(Object.keys(GEAR_DEFAULTS));
const GEAR_ROLE_NAMES = new Set(["g1", "g2", "rk", "ring", "sun", "p0", "p1", "p2", "p3", "p4", "p5"]);
// the parts of each kind of set, the first being the body that holds the set
function gearRoles(o) {
  const v = { ...GEAR_DEFAULTS, ...o };
  return v.type === "spur" ? ["g1"] : v.type === "pair" ? ["g1", "g2"] : v.type === "rack" ? ["g1", "rk"] : v.type === "ring" ? (v.z2 - v.z >= 8 ? ["ring", "g1"] : ["ring"])
    : ["sun", ...Array.from({ length: v.nPlanets }, (_, k) => "p" + k), "ring"];
}
function gearSettings(g) {
  obj(g, "a gear set"); allow(g, new Set(["o", "ids", "jids", "base", "base0", "spin"]), "a gear set");
  const o = obj(g.o, "gear settings"); allow(o, GEAR_KEYS, "gear settings");
  const v = { ...GEAR_DEFAULTS, ...o };
  const whole = (k, lo, hi) => { if (!Number.isInteger(v[k]) || v[k] < lo || v[k] > hi) throw damaged("gear " + k); };
  const range = (k, lo) => { if (!(num(v[k], "gear " + k) >= lo && v[k] <= LIMITS.MEASURE)) throw damaged("gear " + k); };
  whole("z", 6, 300); whole("z2", 6, 400); whole("zs", 8, 200); whole("zp", 8, 200); whole("nPlanets", 2, 6);
  range("m", 0.3); range("thick", 0.5); range("boreD", 0.5); range("hubH", 0.5); range("backlash", 0); range("rackLen", 0);
  if (v.hubD !== 0) range("hubD", 1);
  if (![14.5, 20, 25].includes(v.pa)) throw damaged("a gear pressure angle");
  if (!["spur", "pair", "ring", "rack", "planet"].includes(v.type)) throw damaged("a gear type");
  if (!["round", "d", "hex", "key", "none"].includes(v.bore)) throw damaged("a gear bore");
  for (const k of ["hub", "joints", "spokes"]) bool(v[k], "gear " + k);
  if (v.rackH !== 8) throw unsupported("a rack height the Gears dialog does not set");
  // what the settings make: a rack of at most RACK_TEETH teeth, and no set wider than a link's largest measurement
  const teeth = v.rackLen > 0 ? Math.max(3, Math.round(v.rackLen / (Math.PI * v.m))) : Math.max(8, v.z);
  if (v.type === "rack" && teeth > LIMITS.RACK_TEETH) throw tooBig(`This design has a gear rack with more teeth than a link can open (at most ${LIMITS.RACK_TEETH}). Use a project file for this design.`);
  const across = v.type === "pair" ? v.z + v.z2 : v.type === "ring" ? v.z2 : v.type === "planet" ? v.zs + 2 * v.zp : v.type === "rack" ? Math.max(v.z, teeth * Math.PI) : v.z;
  if (v.m * (across + 8) + 6 > LIMITS.MEASURE) throw tooLarge();
  if (g.base !== undefined) mat16(g.base, "a gear placement");
  if (g.base0 !== undefined) mat16(g.base0, "a gear placement");
  if (g.spin !== undefined && !(Math.abs(num(g.spin, "a gear spin")) <= 360)) throw damaged("a gear spin");
  for (const k of ["ids", "jids"]) {
    const e = Object.entries(obj(g[k], "a gear set's parts"));
    for (const [role, x] of e) { if (!GEAR_ROLE_NAMES.has(role)) throw unsupported("a gear set has " + role.slice(0, 16).replace(/[^\w.-]/g, "?")); id(x, "a gear part id"); }
    if (new Set(e.map(([, x]) => x)).size !== e.length) throw damaged("a gear set lists a part twice");
  }
}
// After every body is read: the sets' parts and joints agree both ways. A part or joint the person deleted is dropped from the set, as
// for Box Maker and hinge companions. Joints come only from gear sets (revolute or slider, unlimited, linked by the tooth ratio).
function gearSets(bodies, byId, doc) {
  const joints = arr(doc.joints === undefined ? [] : doc.joints, "joints", LIMITS.BODIES), jById = new Map(), jBodies = new Set();
  for (const j of joints) {
    obj(j, "a joint"); allow(j, new Set(["id", "name", "seq", "type", "body", "parent", "o", "d", "limited", "min", "max", "link"]), "a joint");
    id(j.id, "a joint id"); if (jById.has(j.id)) throw damaged("duplicate joint id"); jById.set(j.id, j);
    text(j.name, "a joint name");
    if (!Number.isInteger(j.seq) || j.seq < 0) throw damaged("a joint number");
    if (j.type !== "revolute" && j.type !== "slider") throw unsupported("a joint of another kind");
    if (typeof j.body !== "string" || !byId.has(j.body)) throw damaged("a joint on a missing body");
    if (jBodies.has(j.body)) throw damaged("two joints on one body"); jBodies.add(j.body);
    if (j.parent !== null || j.limited !== false || j.min !== -180 || j.max !== 180) throw unsupported("a joint that is not a gear's");
    vec(j.o, 3, "a joint origin"); vec(j.d, 3, "a joint direction");
    if (!(Math.abs(Math.hypot(...j.d) - 1) <= 1e-3)) throw damaged("a joint direction");
    if (j.link !== undefined) { obj(j.link, "a joint link"); allow(j.link, new Set(["to", "ratio"]), "a joint link"); id(j.link.to, "a linked joint"); num(j.link.ratio, "a joint ratio"); }
  }
  const owned = new Map(); // joint id -> { b: the body holding the set, role, v: its settings }
  for (const b of bodies) {
    if (!b.gear) continue;
    const g = b.gear, roles = gearRoles(g.o), v = { ...GEAR_DEFAULTS, ...g.o };
    for (const [role, x] of Object.entries(g.ids)) {
      if (x !== b.id && !byId.has(x)) { delete g.ids[role]; continue; } // a part the person deleted
      if (!roles.includes(role) || (x === b.id) !== (role === roles[0]) || (x !== b.id && byId.get(x).gearPart !== b.id)) throw damaged("gear parts do not agree");
    }
    if (g.ids[roles[0]] !== b.id) throw damaged("gear parts do not agree");
    for (const [role, x] of Object.entries(g.jids)) {
      if (!jById.has(x)) { delete g.jids[role]; continue; } // joints switched off or deleted
      const j = jById.get(x), on = role === roles[0] ? b.id : g.ids[role];
      if (!roles.includes(role) || owned.has(x) || (on !== undefined ? j.body !== on : byId.get(j.body).gearPart !== b.id)) throw damaged("gear joints do not agree");
      owned.set(x, { b, role, v });
    }
  }
  for (const j of joints) {
    const own = owned.get(j.id);
    if (!own) throw unsupported("a joint that is not part of a gear set");
    const { b, role, v } = own;
    // the part it follows, and the ratio gearSet writes (degrees, or mm for the rack, per degree of that part)
    const [driver, ratio] = role === "g2" ? ["g1", -v.z / v.z2] : role === "rk" ? ["g1", -(Math.PI * v.m * v.z) / 360] : role === "g1" && v.type === "ring" ? ["ring", v.z2 / v.z]
      : /^p\d$/.test(role) ? ["sun", -v.zs / v.zp] : role === "ring" && v.type === "planet" ? ["sun", -v.zs / (v.zs + 2 * v.zp)] : [null, 0];
    if (j.type !== (role === "rk" ? "slider" : "revolute")) throw damaged("a gear joint type");
    if (!driver) { if (j.link !== undefined) throw damaged("a gear joint link"); continue; }
    // the person deleted the driving gear's joint (Browser, Delete joint): the link to it drops out, as deleted parts do
    if (b.gear.jids[driver] === undefined && (j.link === undefined || !jById.has(j.link.to))) { delete j.link; continue; }
    if (!j.link || j.link.to === j.id || j.link.to !== b.gear.jids[driver] || Math.abs(j.link.ratio - +ratio.toFixed(8)) > 1e-9) throw damaged("a gear joint link");
  }
}

// node: one shape-building step and its modifiers. Only the types and fields the kernel reads are in the tables.
function node(n, ctx, what) {
  if (++ctx.nodes > LIMITS.NODES) throw tooBig("This design has too many steps to open from a link.");
  allow(n, NODE_KEYS, what);
  if (typeof n.t !== "string" || !NODE_TYPES.has(n.t)) throw unsupported("a " + String(n.t).slice(0, 16).replace(/[^\w ]/g, "?") + " step");
  const sk = (v) => { if (typeof v !== "string" || !ctx.sketches.has(v)) throw damaged("a shape uses a missing sketch"); };
  const path = (p) => { obj(p, "a sweep path"); allow(p, new Set(["sketch", "ents"]), "a sweep path"); sk(p.sketch); const ents = arr(p.ents, "path shapes", LIMITS.SKETCH_ITEMS); if (!ents.length) throw damaged("an empty path"); if (new Set(ents).size !== ents.length) throw damaged("duplicate path shapes"); for (const e of ents) if (!ctx.sketches.get(p.sketch).has(e)) throw damaged("a path uses a missing sketch shape"); };
  const t = n.t;
  if (t === "prim") {
    if (typeof n.kind !== "string" || !PRIM_KINDS.has(n.kind)) throw unsupported("a " + String(n.kind).slice(0, 16).replace(/[^\w ]/g, "?") + " shape");
    obj(n.p, "shape sizes");
    if (n.p.rv !== undefined) { if (n.kind !== "box") throw damaged("corner radius"); nonnegative(n.p.rv, "corner radius"); }
    bounds({ ...n.p, exprs: n.exprs, exprUnits: n.exprUnits }, ctx, [["turns", LIMITS.TURNS, "turns"], ["sides", n.kind === "pyramid" ? LIMITS.PYRAMID_SIDES : LIMITS.SIDES, "sides"], ["points", LIMITS.POINTS, "points"]]);
    for (const [k, v] of Object.entries(n.p)) { if (!/^[A-Za-z0-9_]{1,16}$/.test(k)) throw damaged("a size name"); if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") throw damaged("a size"); }
  } else if (t === "extrude" && n.sketch === undefined && n.profiles === undefined) {
    inlineExtrude(n, ctx); // jumpstart-3d: J.Siwek 2.9.5 Box Maker parts carry their own outline (regions on a plane), no sketch
  } else if (t === "extrude" || t === "revolve" || t === "sweep") {
    sk(n.sketch);
    arr(n.profiles, "profiles", LIMITS.SKETCH_ITEMS);
    if (t === "sweep") {
      if (n.path !== undefined) path(n.path); else if (n.edgeSegs === undefined) throw damaged("a sweep path");
      if (n.rail !== undefined && n.rail !== null) path(n.rail);
      if (n.railEdgeSegs !== undefined) segments(n.railEdgeSegs);
      if (n.railScale !== undefined) bool(n.railScale, "rail scale");
    }
  } else if (t === "pipe") {
    if (n.path !== undefined) path(n.path); else if (n.edgeSegs === undefined) throw damaged("a pipe path"); // a 3D sketch pipe carries edgeSegs instead
  } else if (t === "loft") {
    arr(n.sections, "loft sections", LIMITS.BODIES).forEach((s) => { obj(s, "a loft section"); allow(s, new Set(["sketch", "ref", "point"]), "a loft section");
      // jumpstart-3d: a loft to a point is stored as { point: { sketch, id } } with no top-level sketch (advanced.js loft tool)
      if (s.point !== undefined) { obj(s.point, "a loft point"); allow(s.point, new Set(["sketch", "id"]), "a loft point"); sk(s.point.sketch); id(s.point.id, "a loft point id"); } else sk(s.sketch);
    });
    if (n.rail != null) path(n.rail);
  } else if (t === "group") {
    for (const c of arr(n.children, "group parts", LIMITS.BODIES * 4)) {
      obj(c, "a group part"); allow(c, CHILD_KEYS, "a group part");
      mat16(c.m, "a group part placement");
      node(obj(c.node, "a group part shape"), ctx, what);
    }
  } else if (t === "mirror" || t === "placed") {
    if (t === "mirror" && n.srcBody !== undefined) { id(n.srcBody, "a mirrored body"); ctx.bodyRefs.push(n.srcBody); } // a live mirror of another body
    else { node(obj(n.src, "a copied shape"), ctx, what); mat16(n.srcM, "a copied shape placement"); }
    if (t === "mirror") { obj(n.plane, "a mirror plane"); vec(n.plane.o, 3, "plane"); normal(n.plane.n, "plane normal"); }
  } else if (t === "mesh" || t === "step") {
    if (typeof n.asset !== "string" || !Object.hasOwn(ctx.assets, n.asset) || ctx.assets[n.asset] !== (t === "mesh" ? "mesh" : "step")) throw damaged("a model asset is missing");
  }
  if (n.stretch !== undefined && (!Array.isArray(n.stretch) || n.stretch.length !== 2 || !n.stretch.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e3))) throw damaged("a stretch"); // jumpstart-3d: kernel.js scales the outline by it
  if (n.edgeSegs !== undefined) { if (t !== "sweep" && t !== "pipe") throw damaged("a sweep or pipe path"); segments(n.edgeSegs); }
  if ((n.railEdgeSegs !== undefined || n.railScale !== undefined) && t !== "sweep") throw damaged("a sweep rail");
  if (n.parts !== undefined && (t !== "step" || !bool(n.parts, "the parts flag"))) throw damaged("the parts flag"); // STEP parts (#173): one body per part of an imported file
  exprs(n, ctx);
  if (t === "coil") bounds(n, ctx, [["turns", LIMITS.TURNS, "turns"]]);
  if (n.mods !== undefined) {
    const mids = new Set();
    for (const m of arr(n.mods, "modifiers", LIMITS.NODES)) {
      if (++ctx.nodes > LIMITS.NODES) throw tooBig("This design has too many steps to open from a link.");
      obj(m, "a modifier"); allow(m, MOD_KEYS, "a modifier");
      if (typeof m.t !== "string" || !MOD_TYPES.has(m.t)) throw unsupported("a " + String(m.t).slice(0, 16).replace(/[^\w ]/g, "?") + " modifier");
      id(m.id, "a modifier id"); if (mids.has(m.id)) throw damaged("duplicate modifier id"); mids.add(m.id);
      if (m.t === "bool") {
        if (m.src !== undefined) throw unsupported("a combined body");
        if (m.tool !== undefined) node(obj(m.tool, "a cutting shape"), ctx, what);
        if (m.m !== undefined) mat16(m.m, "a cutting shape placement");
      } else if (m.src !== undefined && !(m.t === "keeppiece" && m.src === "import")) throw damaged("a modifier source"); // STEP parts (#173): the piece of an imported file
      if (m.t === "fillopen") {
        obj(m.plane, "an opening plane"); allow(m.plane, new Set(["o", "n"]), "an opening plane");
        vec(m.plane.o, 3, "plane origin"); normal(m.plane.n, "plane normal");
        for (const e of arr(m.keep, "kept openings", LIMITS.NODES)) { obj(e, "a kept opening"); allow(e, new Set(["c", "a"]), "a kept opening"); vec(e.c, 3, "opening centre"); num(e.a, "opening area"); if (e.a < 0) throw damaged("opening area"); }
      }
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
  if (o.exprs && Object.hasOwn(o.exprs, k) && typeof o.exprs[k] === "string") {
    let v = NaN;
    try { v = evalExpr(o.exprs[k], ctx.scope, { unit: o.exprUnits && Object.hasOwn(o.exprUnits, k) ? o.exprUnits[k] : undefined, angle: k === "angle" }); } catch (e) { /* not resolvable here */ }
    if (Number.isFinite(v)) return v;
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
