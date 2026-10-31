// Fasteners parts library: bolts, screws, nuts, washers, inserts and pins in metric (ISO) and
// inch (UNC) sizes. Each part is built from plain primitives (so it stays light and editable as
// a group), with an optional modeled thread (the Thread feature) on the shank or in the hole.
//
// Every part has its own origin where it meets the surface it sits on:
//   heads (bolts, screws): the underside of the head is at z = 0 and the shank goes down (-z)
//   countersunk / set screws / inserts: the top is at z = 0 (flush) and the part goes down
//   nuts, washers, rods: the part sits on z = 0 and goes up

// jumpstart-3d: fasteners. JS3D.fastener (our page API, bottom of this file) needs the store and the unit helpers.
import { store, nextSeq } from "./store.js";
import { uid, fmt } from "./util.js";
import { getUnit } from "./units.js";

const IN = 25.4;
// metric coarse: d, pitch, hex across flats (bolt head / nut), hex head height, nut height,
// socket cap head dia / height / key, button head dia / height / key, flat head dia / key,
// washer id / od / thickness, heat-set insert od / length
const METRIC = {
  M2: { d: 2, p: 0.4, af: 4, k: 1.4, m: 1.6, dk: 3.8, kk: 2, s: 1.5, bd: 3.5, bk: 1.3, bs: 1.3, fd: 4, fs: 1.3, wi: 2.2, wo: 5, wt: 0.3, io: 3.6, il: 3 },
  "M2.5": { d: 2.5, p: 0.45, af: 5, k: 1.7, m: 2, dk: 4.5, kk: 2.5, s: 2, bd: 4.7, bk: 1.5, bs: 1.5, fd: 5, fs: 1.5, wi: 2.7, wo: 6, wt: 0.5, io: 4, il: 4 },
  M3: { d: 3, p: 0.5, af: 5.5, k: 2, m: 2.4, dk: 5.5, kk: 3, s: 2.5, bd: 5.7, bk: 1.65, bs: 2, fd: 6, fs: 2, wi: 3.2, wo: 7, wt: 0.5, io: 4.6, il: 4 },
  M4: { d: 4, p: 0.7, af: 7, k: 2.8, m: 3.2, dk: 7, kk: 4, s: 3, bd: 7.6, bk: 2.2, bs: 2.5, fd: 8, fs: 2.5, wi: 4.3, wo: 9, wt: 0.8, io: 5.6, il: 6 },
  M5: { d: 5, p: 0.8, af: 8, k: 3.5, m: 4.7, dk: 8.5, kk: 5, s: 4, bd: 9.5, bk: 2.75, bs: 3, fd: 10, fs: 3, wi: 5.3, wo: 10, wt: 1, io: 6.4, il: 6 },
  M6: { d: 6, p: 1, af: 10, k: 4, m: 5.2, dk: 10, kk: 6, s: 5, bd: 10.5, bk: 3.3, bs: 4, fd: 12, fs: 4, wi: 6.4, wo: 12, wt: 1.6, io: 8, il: 8 },
  M8: { d: 8, p: 1.25, af: 13, k: 5.3, m: 6.8, dk: 13, kk: 8, s: 6, bd: 14, bk: 4.4, bs: 5, fd: 16, fs: 5, wi: 8.4, wo: 16, wt: 1.6, io: 10, il: 10 },
  M10: { d: 10, p: 1.5, af: 16, k: 6.4, m: 8.4, dk: 16, kk: 10, s: 8, bd: 17.5, bk: 5.5, bs: 6, fd: 20, fs: 6, wi: 10.5, wo: 20, wt: 2, io: 12, il: 12 },
  M12: { d: 12, p: 1.75, af: 18, k: 7.5, m: 10.8, dk: 18, kk: 12, s: 10, bd: 21, bk: 6.6, bs: 8, fd: 24, fs: 8, wi: 13, wo: 24, wt: 2.5, io: 14, il: 14 },
  M16: { d: 16, p: 2, af: 24, k: 10, m: 14.8, dk: 24, kk: 16, s: 14, bd: 28, bk: 8.8, bs: 10, fd: 30, fs: 10, wi: 17, wo: 30, wt: 3, io: 0, il: 0 },
  M20: { d: 20, p: 2.5, af: 30, k: 12.5, m: 18, dk: 30, kk: 20, s: 17, bd: 0, bk: 0, bs: 0, fd: 36, fs: 12, wi: 21, wo: 37, wt: 3, io: 0, il: 0 },
};
// inch (UNC): d and tpi; the rest are the usual proportions of the standard parts, in inches
const INCH_RAW = {
  "#4-40": { d: 0.112, tpi: 40, af: 1 / 4, k: 0.06, m: 3 / 32, s: 3 / 32 },
  "#6-32": { d: 0.138, tpi: 32, af: 5 / 16, k: 0.08, m: 7 / 64, s: 7 / 64 },
  "#8-32": { d: 0.164, tpi: 32, af: 11 / 32, k: 0.11, m: 1 / 8, s: 9 / 64 },
  "#10-24": { d: 0.19, tpi: 24, af: 3 / 8, k: 0.12, m: 1 / 8, s: 5 / 32 },
  '1/4"-20': { d: 0.25, tpi: 20, af: 7 / 16, k: 0.163, m: 7 / 32, s: 3 / 16 },
  '5/16"-18': { d: 0.3125, tpi: 18, af: 1 / 2, k: 0.211, m: 17 / 64, s: 1 / 4 },
  '3/8"-16': { d: 0.375, tpi: 16, af: 9 / 16, k: 0.243, m: 21 / 64, s: 5 / 16 },
  '1/2"-13': { d: 0.5, tpi: 13, af: 3 / 4, k: 0.323, m: 7 / 16, s: 3 / 8 },
};
const INCH = {};
for (const [name, r] of Object.entries(INCH_RAW)) {
  const d = r.d * IN;
  INCH[name] = {
    d, p: IN / r.tpi, af: r.af * IN, k: r.k * IN, m: r.m * IN,
    dk: 1.5 * d, kk: d, s: r.s * IN, bd: 1.75 * d, bk: 0.55 * d, bs: r.s * IN * 0.8, fd: 2 * d, fs: r.s * IN * 0.8,
    wi: d + 0.8, wo: 2.4 * d + 1, wt: Math.max(0.8, 0.07 * IN * (d / 6.35) ** 0.5), io: 0, il: 0, csk82: true,
  };
}

// jumpstart-3d: fasteners. Inch fine (UNF) sizes too, with their diameter's UNC head and nut sizes.
for (const [name, unc, tpi] of [["#10-32", "#10-24", 32], ['1/4"-28', '1/4"-20', 28], ['5/16"-24', '5/16"-18', 24], ['3/8"-24', '3/8"-16', 24], ['1/2"-20', '1/2"-13', 20]]) INCH[name] = { ...INCH[unc], p: IN / tpi };
for (const k of Object.keys(INCH).sort((a, b) => INCH[a].d - INCH[b].d || INCH[b].p - INCH[a].p)) { const v = INCH[k]; delete INCH[k]; INCH[k] = v; } // fine after coarse, by diameter
// end jumpstart-3d

export const FASTENER_KINDS = [
  { id: "hexbolt", label: "Hex bolt", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "shcs", label: "Socket head cap screw", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "button", label: "Button head screw", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "flat", label: "Flat head (countersunk) screw", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "set", label: "Set screw (grub)", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "wood", label: "Wood screw", group: "Bolts & screws", len: true, thread: null },
  { id: "rod", label: "Threaded rod", group: "Bolts & screws", len: true, thread: "ext" },
  { id: "nut", label: "Hex nut", group: "Nuts", thread: "int" },
  { id: "nyloc", label: "Nylon lock nut", group: "Nuts", thread: "int" },
  { id: "sqnut", label: "Square nut", group: "Nuts", thread: "int" },
  { id: "washer", label: "Flat washer", group: "Washers", thread: null },
  { id: "lockw", label: "Split lock washer", group: "Washers", thread: null },
  { id: "insert", label: "Heat-set insert (for 3D prints)", group: "Inserts & pins", thread: "int", metricOnly: true },
  { id: "dowel", label: "Dowel pin", group: "Inserts & pins", len: true, thread: null },
];
// jumpstart-3d: fasteners. A tap cutter: a threaded rod marked as a hole, to cut a threaded hole into a part (always threaded).
FASTENER_KINDS.push({ id: "cutter", label: "Tap cutter (threaded hole)", group: "Bolts & screws", len: true, thread: "cut" });
export const kindOf = (id) => FASTENER_KINDS.find((k) => k.id === id) || FASTENER_KINDS[0];
export function sizesFor(kind, std) {
  const tab = std === "inch" ? INCH : METRIC;
  return Object.keys(tab).filter((n) => {
    const s = tab[n];
    if (kind === "insert") return s.io > 0;
    if (kind === "button") return s.bd > 0;
    return true;
  });
}
export const LENGTHS = {
  metric: [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 150],
  inch: [[1 / 8, "1/8\""], [3 / 16, "3/16\""], [1 / 4, "1/4\""], [3 / 8, "3/8\""], [1 / 2, "1/2\""], [5 / 8, "5/8\""], [3 / 4, "3/4\""], [1, "1\""], [1.25, "1-1/4\""], [1.5, "1-1/2\""], [1.75, "1-3/4\""], [2, "2\""], [2.5, "2-1/2\""], [3, "3\""], [4, "4\""], [6, "6\""]],
};
export function sizeData(std, size) { return (std === "inch" ? INCH : METRIC)[size] || null; }
export function defaultLength(kind, std, size) {
  const s = sizeData(std, size); if (!s) return 10;
  if (kind === "set") return Math.max(3, Math.round(s.d * 1.5));
  if (kind === "rod") return Math.round(s.d * 10);
  if (kind === "dowel") return Math.round(s.d * 4);
  return Math.max(4, Math.round(s.d * 3));
}

// ---------------------------------------------------------------- building blocks
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
const FLIP = (z = 0) => [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, r6(z), 1]; // upside down, at height z
const prim = (kind, p) => ({ t: "prim", kind, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])), mods: [] });
const kid = (node, m = T(), hole = false) => ({ node, m, hole });
const group = (children, op) => ({ t: "group", ...(op ? { op } : {}), children, mods: [] });
const cyl = (dia, h) => prim("cylinder", { w: dia, d: dia, h });
const hexAC = (af) => af / Math.cos(Math.PI / 6); // across corners
// a hex prism with the usual 30° chamfer on its top (and bottom too when both)
function chamferedHex(af, h, both) {
  const ac = hexAC(af);
  const cone = (z, flip) => {
    const rTop = af * 0.475, rBase = rTop + 1.732 * h;
    const c = prim("cone", { w: 2 * rBase, d: 2 * rBase, h, top: (2 * rTop) / (2 * rBase) });
    return kid(c, flip ? FLIP(z) : T(0, 0, z));
  };
  const kids = [kid(prim("prism", { w: ac, d: ac, h, sides: 6 })), cone(0, false)];
  if (both) kids.push(cone(h, true));
  return group(kids, "intersect");
}
const hexSocket = (s, depth, zTop) => kid(prim("prism", { w: hexAC(s), d: hexAC(s), h: depth + 0.2, sides: 6 }), T(0, 0, zTop - depth), true);

// a thread feature on the round face whose center is c (in the part's own coordinates)
const threadMod = (c, pitch, clear) => ({ id: "th" + Math.random().toString(36).slice(2, 8), seq: 0, t: "thread", face: { c, t: "CYLINDRE" }, pitch: r6(pitch), length: 0, flip: false, left: false, clear: clear || 0 });

// ---------------------------------------------------------------- the parts
// returns { node, name, color, height } or throws with a message
export function fastenerPart(kindId, std, size, length, opts = {}) {
  const s = sizeData(std, size);
  if (!s) throw new Error("Pick a size");
  const kind = kindOf(kindId);
  const L = Math.max(0.5, +length || defaultLength(kindId, std, size));
  const thread = (!!opts.threads && !!kind.thread) || kind.thread === "cut"; // jumpstart-3d: fasteners (a tap cutter is always threaded)
  const clear = opts.clear || 0;
  const lenLabel = std === "inch" ? fmtInch(L / IN) : r6(L) + " mm";
  const steel = "#a9b1ba", dark = "#3d4248", brass = "#c9a24a", zinc = "#c7ccd2";
  let node, name, color = steel;
  const shank = (zTop, len) => kid(cyl(s.d, len), T(0, 0, zTop - len));
  const shankMods = (zTop, len) => (thread ? [threadMod([0, 0, zTop - len / 2], s.p, clear)] : []);
  switch (kindId) {
    case "hexbolt": {
      node = group([kid(chamferedHex(s.af, s.k, false)), shank(0.01, L + 0.01)]);
      node.mods = shankMods(0, L);
      name = `Hex bolt ${size} x ${lenLabel}`; color = zinc;
      break;
    }
    case "shcs": {
      node = group([kid(cyl(s.dk, s.kk)), shank(0.01, L + 0.01), hexSocket(s.s, s.kk * 0.55, s.kk)]);
      node.mods = shankMods(0, L);
      name = `Socket head cap screw ${size} x ${lenLabel}`; color = dark;
      break;
    }
    case "button": {
      node = group([kid(prim("hemisphere", { w: s.bd, d: s.bd, h: s.bk })), shank(0.01, L + 0.01), hexSocket(s.bs, s.bk * 0.6, s.bk)]);
      node.mods = shankMods(0, L);
      name = `Button head screw ${size} x ${lenLabel}`; color = dark;
      break;
    }
    case "flat": {
      // 90° (ISO) or 82° (inch) head, flush at z = 0; the length includes the head
      const half = ((s.csk82 ? 82 : 90) / 2) * (Math.PI / 180);
      const hc = (s.fd - s.d) / 2 / Math.tan(half);
      const head = kid(prim("cone", { w: s.fd, d: s.fd, h: hc, top: s.d / s.fd }), FLIP(0));
      const sh = Math.max(0.5, L - hc);
      node = group([head, kid(cyl(s.d, sh + 0.01), T(0, 0, -L)), hexSocket(s.fs, Math.min(hc * 0.9, s.fs * 0.9), 0)]);
      node.mods = thread ? [threadMod([0, 0, -L + sh / 2], s.p, clear)] : [];
      name = `Flat head screw ${size} x ${lenLabel}`; color = dark;
      break;
    }
    case "set": {
      node = group([kid(cyl(s.d, L), T(0, 0, -L)), hexSocket(s.s * 0.6, Math.min(L * 0.5, s.d * 0.6), 0)]);
      node.mods = thread ? [threadMod([0, 0, -L / 2], s.p, clear)] : [];
      name = `Set screw ${size} x ${lenLabel}`; color = dark;
      break;
    }
    case "wood": {
      // flat head with a cross recess, a plain shank and a pointed tip
      const hd = s.fd, hc = (hd - s.d) / 2;
      const tip = Math.min(L * 0.4, s.d * 1.6);
      const recess = (w, d) => kid(prim("box", { w, d, h: hc * 0.8 + 0.2 }), T(0, 0, -hc * 0.8), true);
      node = group([
        kid(prim("cone", { w: hd, d: hd, h: hc, top: s.d / hd }), FLIP(0)),
        kid(cyl(s.d, L - tip + 0.01), T(0, 0, -(L - tip))),
        kid(prim("cone", { w: s.d, d: s.d, h: tip, top: 0 }), FLIP(-(L - tip))),
        recess(hd * 0.6, s.d * 0.18), recess(s.d * 0.18, hd * 0.6),
      ]);
      name = `Wood screw ${size} x ${lenLabel}`; color = brass;
      break;
    }
    case "rod": {
      node = group([kid(cyl(s.d, L))]);
      node.mods = thread ? [threadMod([0, 0, L / 2], s.p, clear)] : [];
      name = `Threaded rod ${size} x ${lenLabel}`; color = zinc;
      break;
    }
    case "nut": {
      node = group([kid(chamferedHex(s.af, s.m, true)), kid(cyl(s.d, s.m + 0.4), T(0, 0, -0.2), true)]);
      node.mods = thread ? [threadMod([0, 0, s.m / 2], s.p, clear)] : [];
      name = `Hex nut ${size}`; color = zinc;
      break;
    }
    case "nyloc": {
      const hh = s.m, ring = s.m * 0.45;
      node = group([
        kid(chamferedHex(s.af, hh, false)),
        kid(cyl(s.af * 0.92, ring), T(0, 0, hh - 0.01)),
        kid(cyl(s.d, hh + ring + 0.4), T(0, 0, -0.2), true),
      ]);
      node.mods = thread ? [threadMod([0, 0, (hh + ring) / 2], s.p, clear)] : [];
      name = `Nylon lock nut ${size}`; color = zinc;
      break;
    }
    case "sqnut": {
      node = group([kid(prim("box", { w: s.af, d: s.af, h: s.m })), kid(cyl(s.d, s.m + 0.4), T(0, 0, -0.2), true)]);
      node.mods = thread ? [threadMod([0, 0, s.m / 2], s.p, clear)] : [];
      name = `Square nut ${size}`; color = zinc;
      break;
    }
    case "washer": {
      node = group([kid(prim("tube", { w: s.wo, d: s.wo, h: s.wt, wall: (s.wo - s.wi) / 2 }))]);
      name = `Flat washer ${size}`; color = zinc;
      break;
    }
    case "lockw": {
      const od = s.d * 1.85 + 0.6, t = Math.max(0.5, s.d * 0.25);
      node = group([
        kid(prim("tube", { w: od, d: od, h: t, wall: (od - s.wi) / 2 })),
        kid(prim("box", { w: od, d: Math.max(0.3, s.d * 0.12), h: t + 0.4 }), T(od / 2, 0, -0.2), true),
      ]);
      name = `Split lock washer ${size}`; color = dark;
      break;
    }
    case "insert": {
      // knurled brass insert, top flush at z = 0 (press it into a hole about its outside size)
      const od = s.io, il = s.il, band = il * 0.36;
      const knurl = (z) => kid(prim("star", { w: od, d: od, h: band, points: 14, inner: 0.9 }), T(0, 0, z));
      node = group([
        kid(cyl(od * 0.88, il), T(0, 0, -il)),
        knurl(-band - 0.02 * il), knurl(-il + 0.02 * il),
        kid(cyl(s.d, il + 0.4), T(0, 0, -il - 0.2), true),
      ]);
      node.mods = thread ? [threadMod([0, 0, -il / 2], s.p, clear)] : [];
      name = `Heat-set insert ${size} (${r6(od)} x ${r6(il)} mm)`; color = brass;
      break;
    }
    case "dowel": {
      node = group([kid(prim("cylinder", { w: s.d, d: s.d, h: L, r: Math.min(s.d * 0.15, L * 0.2) }))]);
      name = `Dowel pin ${r6(s.d)} x ${lenLabel}`; color = steel;
      break;
    }
    // jumpstart-3d: fasteners. The tap cutter goes down from z = 0 into what it sits on. A thinner cutter would make a tighter hole,
    // so the print offset widens the cutter instead (its radius by the offset, at most 0.15 pitch) and its thread has none.
    case "cutter": {
      const dia = s.d + 2 * Math.min(Math.abs(clear), 0.15 * s.p);
      node = group([kid(cyl(dia, L), T(0, 0, -L))]);
      node.mods = [threadMod([0, 0, -L / 2], s.p, 0)];
      name = `Tap cutter ${size} x ${lenLabel}`;
      break;
    }
    // end jumpstart-3d
    default: throw new Error("Unknown part");
  }
  // jumpstart-3d: fasteners. Left-hand threads; and a modeled inside thread is cut from the ISO minor diameter (D1 = d - 1.0825 P),
  // as the Thread feature's ISO profile expects (kernel.js threadGroove), so Print offset None fits a bolt exactly.
  if (opts.left) for (const m of node.mods) if (m.t === "thread") m.left = true;
  if (thread && kind.thread === "int") for (const c of node.children) if (c.hole && c.node.kind === "cylinder" && c.node.p.w === r6(s.d)) c.node.p.w = c.node.p.d = r6(s.d - 1.0825 * s.p);
  if (kindId === "cutter") return { node, name, color, hole: true };
  // end jumpstart-3d
  return { node, name, color };
}
function fmtInch(x) {
  const w = Math.floor(x + 1e-9), f = x - w;
  const fr = [[1 / 8, "1/8"], [3 / 16, "3/16"], [1 / 4, "1/4"], [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [3 / 4, "3/4"], [7 / 8, "7/8"]].find(([v]) => Math.abs(v - f) < 1e-6);
  if (f < 1e-6) return w + '"';
  if (fr) return (w ? w + "-" : "") + fr[1] + '"';
  return x.toFixed(3) + '"';
}
// the size of hole a fastener needs (for the hint): clearance, tap drill and insert hole, in mm
export function holeSizes(std, size) {
  const s = sizeData(std, size); if (!s) return null;
  return { clearance: r6(s.d * 1.1), tap: r6(s.d - s.p), insert: s.io ? r6(s.io - 0.6) : null };
}

// ---------------------------------------------------------------- jumpstart-3d: fasteners, the page API
// JS3D.fastener (BRIDGE.md, the MCP add_fastener tool and chat): a hex bolt, a hex nut, a threaded rod or a tap cutter, in metric
// (ISO coarse) or inch (UNC / UNF) sizes, always with a real Thread feature (so it shows in the timeline and edits with the Thread
// dialog). Its own builder, so its tested shapes, names and messages stay as they were: the bolt's head sits on the bed and the shank
// goes up. Thread diameters and pitches come from the Thread dialog's table (STD, passed in); only head and nut sizes are listed here.
const MAX_TURNS = 150, WARN_TURNS = 60;
const COLOR = "#9fb1c4";
const TYPES = [["bolt", "Bolt"], ["nut", "Nut"], ["rod", "Threaded rod"], ["cutter", "Tap cutter"]];
const NOUN = { bolt: "bolt", nut: "nut", rod: "threaded rod", cutter: "tap cutter" };

// diameter -> [head across flats, head height k, nut across flats, nut thickness m]
// metric, in mm: ISO 4017 (hex head bolt) and ISO 4032 (hex nut)
const HEX = {
  "M2.5": [5, 1.7, 5, 2], M3: [5.5, 2, 5.5, 2.4], M4: [7, 2.8, 7, 3.2], M5: [8, 3.5, 8, 4.7],
  M6: [10, 4, 10, 5.2], M8: [13, 5.3, 13, 6.8], M10: [16, 6.4, 16, 8.4], M12: [18, 7.5, 18, 10.8],
};
// inch, in inches (converted below): ASME B18.6.3 hex machine screws and nuts (#6 to #10), B18.2.1 hex bolts and B18.2.2 hex nuts
const HEX_IN = {
  "#6": [0.25, 0.093, 0.3125, 0.109], "#8": [0.25, 0.11, 0.344, 0.125], "#10": [0.3125, 0.12, 0.375, 0.125],
  "1/4": [0.4375, 0.172, 0.4375, 0.219], "5/16": [0.5, 0.219, 0.5, 0.266], "3/8": [0.5625, 0.25, 0.5625, 0.328], "1/2": [0.75, 0.344, 0.75, 0.438],
};
for (const [k, v] of Object.entries(HEX_IN)) HEX[k] = v.map((x) => +(x * IN).toFixed(3));

// the sizes offered, in the order listed; the UNF rows use their diameter's row above
const API_METRIC = ["M2.5", "M3", "M4", "M5", "M6", "M8", "M10", "M12"];
const API_INCH = ["#6-32", "#8-32", "#10-24", "#10-32", "1/4-20", "1/4-28", "5/16-18", "5/16-24", "3/8-16", "3/8-24", "1/2-13", "1/2-20"];
const SIZES = [...API_METRIC, ...API_INCH];
const isMetric = (key) => key[0] === "M";
const diaKey = (key) => (isMetric(key) ? key : key.replace(/-\d+$/, ""));

const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && isFinite(x));
const lengthText = (mm) => (getUnit() === "in" ? fmt(mm / IN, 3) + '"' : fmt(mm, 3));

// the STD row for a size key such as "M8" or "1/4-20"
const findStd = (STD, key) => STD.find((s) => (isMetric(key) ? s[3] === "iso" && "M" + s[1] === key : s[0] === key + " UNC" || s[0] === key + " UNF"));

// Checks a request and returns everything a part needs, or throws a plain message.
export function resolve(spec, STD) {
  spec = spec ?? {};
  const type = spec.type;
  if (!TYPES.some((t) => t[0] === type)) throw new Error('type must be "bolt", "nut", "rod" or "cutter"');
  const key = spec.size;
  const std = SIZES.includes(key) && findStd(STD, key);
  if (!std) throw new Error(`unknown size "${key}"; sizes: ${SIZES.join(", ")}`);
  const [, d, p] = std;
  const [af, k, nutAf, m] = HEX[diaKey(key)];
  let length = 0;
  if (type !== "nut") {
    length = spec.length;
    if (typeof length !== "number" || !isFinite(length) || length < 3 * p - 1e-9) throw new Error(`length must be a number of at least ${+(3 * p).toFixed(3)} mm for ${key}`);
    const turns = Math.round(length / p);
    if (turns > MAX_TURNS) throw new Error(tooMany(turns));
  }
  const clear = spec.clear === undefined ? 0 : spec.clear;
  if (typeof clear !== "number" || !isFinite(clear) || clear < -1 || clear > 0) throw new Error("clear must be a number from -1 to 0 (mm)");
  const left = spec.left === undefined ? false : spec.left;
  if (typeof left !== "boolean") throw new Error("left must be true or false");
  const at = spec.at === undefined ? [0, 0, 0] : spec.at;
  if (!vec3(at)) throw new Error("at must be [x, y, z] in mm");
  const given = spec.name === undefined || spec.name === null ? "" : String(spec.name).trim();
  const name = given ? given : type === "nut" ? `${key} nut` : `${key}×${lengthText(length)} ${NOUN[type]}`;
  return { type, key, d, p, af, k, nutAf, m, length, clear, left, at, name };
}

// the turns guard, shared with the Fasteners dialog (advanced.js fastenerCmd)
export { MAX_TURNS, WARN_TURNS };
export const tooMany = (n) => `Too many turns (${n}; the most is ${MAX_TURNS}). Make it shorter or pick a larger size.`;

// A hex prism with the given width across flats; its corners sit at radius w / 2.
const hexPrism = (af, h) => { const w = +((af * 2) / Math.sqrt(3)).toFixed(3); return { t: "prim", kind: "prism", p: { w, d: w, h, sides: 6, r: 0, c: 0 }, mods: [] }; };
const cylinder = (dia, h) => ({ t: "prim", kind: "cylinder", p: { w: dia, d: dia, h, r: 0, c: 0 }, mods: [] });
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// The body for one part. Each part is its own body, so each builds on its own.
function partBody(doc, r) {
  const { type, d, p, k, af, nutAf, m, length: L, clear, left, at } = r;
  const body = { id: uid("b"), name: r.name, seq: nextSeq(doc), color: COLOR, hole: type === "cutter", hidden: false, m: IDENTITY.slice(), node: null };
  body.m[12] = at[0]; body.m[13] = at[1]; body.m[14] = at[2];
  const thread = (z, c) => ({ id: uid("f"), seq: nextSeq(doc), t: "thread", face: { c: [0, 0, z], t: "CYLINDRE" }, pitch: p, length: 0, flip: false, left, clear: c });
  if (type === "bolt") {
    // the head sits on the bed, the shank above it; the thread goes on the group and finds the shank's round face
    const shank = IDENTITY.slice(); shank[14] = k;
    body.node = { t: "group", children: [
      { node: hexPrism(af, k), m: IDENTITY.slice(), hole: false, name: "head" },
      { node: cylinder(d, L), m: shank, hole: false, name: "shank" },
    ], mods: [thread(k + L / 2, clear)] };
  } else if (type === "nut") {
    // a hex prism with a plain hole at the thread's minor diameter, then the thread cut into the hole wall (a thread mod, not a
    // tapped hole, so a left-hand nut works)
    const node = hexPrism(nutAf, m);
    node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "hole", kind: "simple", dia: +(d - 1.0825 * p).toFixed(3), through: true, depth: m + 1, tapped: false, pitch: 0, clear: 0, tip: false, size: "", at: [{ p: [0, 0, m], n: [0, 0, 1] }] });
    node.mods.push(thread(m / 2, clear));
    body.node = node;
  } else {
    // a rod; a cutter is a rod marked as a hole. A bolt's print offset thins the thread, which loosens it. A hole works the other way
    // round (a thinner cutter would make a tighter hole), so the cutter is built wider and its thread has no offset. The kernel puts a
    // nut's flanks s (the offset) further out, and the flanks of the plain ISO profile on a rod grown by s in radius sit just there, so
    // the radius grows by s (the diameter by 2s).
    const grow = type === "cutter" ? 2 * Math.min(Math.abs(clear), 0.15 * p) : 0;
    const node = cylinder(+(d + grow).toFixed(4), L);
    node.mods.push(thread(L / 2, type === "cutter" ? 0 : clear));
    body.node = node;
  }
  return body;
}

// JS3D.fastener: one body, one undo step; returns its id
export function initFasteners(app, { STD }) {
  function add(spec) {
    const r = resolve(spec, STD);
    let id;
    store.update((doc) => { const b = partBody(doc, r); doc.bodies.push(b); id = b.id; }, "Add " + r.name);
    return id;
  }
  return { add };
}
// end jumpstart-3d
