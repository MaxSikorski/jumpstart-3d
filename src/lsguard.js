// jumpstart-3d: Layerscape project guard. A Layerscape diorama travels inside a design (doc.layerscape) and in its own
// project files, so it is untrusted data. Layerscape (J.Siwek's layerscape.html, in a same-origin frame) draws its
// pictures with new Image() and builds its piece list with innerHTML, so before it sees a project this keeps only:
// pictures that are embedded raster data (never an address to fetch), whole-number ids, hex colours, plain words for
// the other text fields, and finite numbers. Anything else is left out; a project without a safe photo is refused.
import { isSafeMediaSrc } from "./safeurl.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const WORD = /^[\w .-]{0,40}$/; // no quotes, brackets, colons or slashes: never markup, CSS or an address
const OWNER = /^-?\d+:\d+(?:,-?\d+:\d+)*$/;
const MAX_SIDE = 8192;
const SHEETS = ["letter", "a4", "b300", "b12", "b400"]; // layerscape.html SHEETS: another name would stop its builder
const int = (v) => Number.isInteger(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const name = (v, fallback) => (typeof v === "string" ? v.slice(0, 200) : fallback);
const pic = (v) => (isSafeMediaSrc(v, "image") ? v : null);

// numbers, true/false, null, plain words and lists of numbers; other values are left out
function plain(o, keep = {}) {
  const out = {};
  if (!isObj(o)) return out;
  for (const [k, v] of Object.entries(o)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (k in keep) { const x = keep[k](v); if (x !== undefined) out[k] = x; continue; }
    if (fin(v) || typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string" && WORD.test(v)) out[k] = v;
    else if (Array.isArray(v) && v.length <= 64 && v.every(fin)) out[k] = v.slice();
  }
  return out;
}

export function cleanLayerscape(d) {
  if (!isObj(d) || d.app !== "layerscape") return null;
  const image = pic(d.image);
  if (!image || !int(d.W) || !int(d.H) || d.W < 1 || d.H < 1 || d.W > MAX_SIDE || d.H > MAX_SIDE) return null;
  if (typeof d.owner !== "string" || !OWNER.test(d.owner)) return null;
  const pieces = [];
  for (const p of Array.isArray(d.pieces) ? d.pieces.slice(0, 500) : []) {
    if (!isObj(p) || !int(p.id) || p.id < 0) continue;
    pieces.push(plain(p, {
      id: (v) => v,
      name: (v) => name(v, "Piece"),
      type: (v) => (v === "cross" ? "cross" : "standee"),
      color: (v) => (typeof v === "string" && COLOR.test(v) ? v : "#c08a4a"),
      cloneOf: (v) => (int(v) ? v : null),
      layer: (v) => (int(v) ? v : null),
    }));
  }
  let layers = null;
  if (isObj(d.layers) && Array.isArray(d.layers.list)) {
    layers = plain(d.layers, {
      bg: pic,
      list: (list) => list.slice(0, 256).map((s) => (isObj(s) ? { name: name(s.name, ""), x: int(s.x) ? s.x : 0, y: int(s.y) ? s.y : 0, png: pic(s.png) } : null)),
    });
  }
  return {
    app: "layerscape", version: int(d.version) ? d.version : 1, name: name(d.name, "Untitled"), W: d.W, H: d.H, image, owner: d.owner,
    pieces, nextId: int(d.nextId) ? d.nextId : 1, horizon: fin(d.horizon) ? d.horizon : 0.6,
    settings: plain(d.settings, { sheet: (v) => (SHEETS.includes(v) ? v : undefined) }), view: plain(d.view), scene: int(d.scene) ? d.scene : -1, layers,
    ...(fin(d.updated) ? { updated: d.updated } : {}),
  };
}
