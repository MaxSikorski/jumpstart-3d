// jumpstart-3d: Layerscape project guard. A Layerscape diorama travels inside a design (doc.layerscape) and in its own
// project files, so it is untrusted data. Layerscape (J.Siwek's layerscape.html, in a same-origin frame) draws its
// pictures with new Image(), builds its piece list with innerHTML and runs loops sized by its settings, so before it
// opens a project this rebuilds it from known fields only: pictures that are embedded raster data (never an address
// to fetch), whole-number ids, hex colours, true/false where the app keeps true/false, and every number inside the
// range Layerscape's own controls allow. A project without a safe photo, or whose sizes do not add up, is refused.
// A project whose layers need too much memory is refused with an Error explaining why; anything else unusable returns null.
import { isSafeMediaSrc } from "./safeurl.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const OWNER = /^-?\d+:\d+(?:,-?\d+:\d+)*$/;
const MAX_SIDE = 4000; // Layerscape shrinks a photo to 2,000 px on its long side
const MAX_ID = 32767; // its pixel owners are an Int16Array
const MAX_ASPECT = 20; // a long thin photo makes its backdrop artwork huge (20:1 keeps it under about 300 MB)
const MAX_LAYERS = 256, LAYER_PIXELS = 6e7; // every layer a piece uses becomes a full-size canvas plus a mask (5 bytes a pixel), so at most about 300 MB; layers no piece uses are dropped
const int = (v) => Number.isInteger(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi, def) => (fin(v) ? Math.min(hi, Math.max(lo, v)) : def);
const name = (v, fallback) => (typeof v === "string" ? v.slice(0, 200) : fallback);
const pic = (v) => (isSafeMediaSrc(v, "image") ? v : null);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const range = (lo, hi) => (v) => (fin(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

// layerscape.html: const S = {...} and the min/max of its s_* inputs and selects; anything else is left out
const SETTINGS = {
  width: range(80, 600), deckD: range(50, 400), baseH: range(12, 150), thick: range(1, 12), kerf: range(0, 0.6), tabW: range(4, 40),
  smooth: range(0, 4), thicken: range(0, 3), bleed: range(0, 4), cornerR: range(2, 80), baseR: range(10, 80),
  sheet: oneOf(["letter", "a4", "b300", "b12", "b400"]),
  baseShape: oneOf(["square", "rounded", "curved", "stadium"]),
  backShape: oneOf(["rect", "rounded", "arch", "dome", "wave", "hills", "peaks", "scallop"]),
};
const VIEW = { yaw: range(-1.3, 1.3), pitch: range(0.04, 1.25), zoom: range(0.5, 3) }; // its drag and wheel limits
function known(o, table) {
  const out = {};
  if (!isObj(o)) return out;
  for (const k of Object.keys(table)) { const v = Object.prototype.hasOwnProperty.call(o, k) ? table[k](o[k]) : undefined; if (v !== undefined) out[k] = v; }
  return out;
}

// the pixels the owner runs cover, or -1 when a run names a piece id Layerscape cannot hold
function ownerPixels(s) {
  let n = 0;
  for (const run of s.split(",")) {
    const [v, c] = run.split(":").map(Number);
    if (v < -1 || v > MAX_ID || !(c >= 1)) return -1;
    n += c;
  }
  return n;
}

export function cleanLayerscape(d) {
  if (!isObj(d) || d.app !== "layerscape") return null;
  const image = pic(d.image);
  if (!image || !int(d.W) || !int(d.H) || d.W < 1 || d.H < 1 || d.W > MAX_SIDE || d.H > MAX_SIDE || Math.max(d.W, d.H) > MAX_ASPECT * Math.min(d.W, d.H)) return null;
  if (Array.isArray(d.pieces) && d.pieces.length > MAX_ID + 1) return null;
  if (isObj(d.layers) && Array.isArray(d.layers.list) && d.layers.list.length > MAX_LAYERS) return null;
  if (typeof d.owner !== "string" || d.owner.length > 16 * d.W * d.H || !OWNER.test(d.owner) || ownerPixels(d.owner) !== d.W * d.H) return null;
  const pieces = [], ids = new Set();
  for (const p of Array.isArray(d.pieces) ? d.pieces : []) {
    if (!isObj(p) || !int(p.id) || p.id < 0 || p.id > MAX_ID || ids.has(p.id)) continue;
    ids.add(p.id);
    const q = {
      id: p.id, name: name(p.name, "Piece"), type: p.type === "cross" ? "cross" : "standee",
      color: typeof p.color === "string" && COLOR.test(p.color) ? p.color : "#c08a4a",
      auto: p.auto === true, depth: clamp(p.depth, 0, 1, 0.5), flatBase: p.flatBase !== false, scale: clamp(p.scale, 0.25, 3, 1),
      dx: clamp(p.dx, -1000, 1000, 0), cloneOf: int(p.cloneOf) && p.cloneOf >= 0 && p.cloneOf <= MAX_ID ? p.cloneOf : null,
    };
    if (int(p.layer) && p.layer >= 0 && p.layer < MAX_LAYERS) q.layer = p.layer;
    pieces.push(q);
  }
  for (const q of pieces) if (q.cloneOf != null && !ids.has(q.cloneOf)) q.cloneOf = null;
  let layers = null;
  if (isObj(d.layers) && Array.isArray(d.layers.list)) {
    const list = d.layers.list, used = new Set(pieces.map((q) => q.layer).filter((i) => i !== undefined && i < list.length));
    if (used.size * d.W * d.H > LAYER_PIXELS) throw new Error(`It has ${used.size} picture layers of ${d.W} × ${d.H} pixels, more than Layerscape can hold safely (at most ${Math.floor(LAYER_PIXELS / (d.W * d.H))} at that size).`);
    const at = (v, side) => (int(v) && Math.abs(v) <= side ? v : 0);
    layers = {
      list: list.map((s, i) => (used.has(i) && isObj(s) ? { name: name(s.name, ""), x: at(s.x, d.W), y: at(s.y, d.H), png: pic(s.png) } : null)),
      bg: pic(d.layers.bg),
    };
  }
  const nextId = Math.max(1, ...pieces.map((p) => p.id + 1));
  return {
    app: "layerscape", version: 1, name: name(d.name, "Untitled"), W: d.W, H: d.H, image, owner: d.owner,
    pieces, nextId: int(d.nextId) && d.nextId > nextId && d.nextId <= MAX_ID + 1 ? d.nextId : nextId, horizon: clamp(d.horizon, 0, 1, 0.6),
    settings: known(d.settings, SETTINGS), view: known(d.view, VIEW), scene: -1, layers,
    ...(fin(d.updated) ? { updated: d.updated } : {}),
  };
}
