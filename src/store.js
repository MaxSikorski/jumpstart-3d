// Document model, undo/redo, and resolution of sketch references for the kernel.
import { clone, uid } from "./util.js";
import { resolveSketch, findRegions, resolveRegionRef, regionContains, polyArea } from "./regions.js";
import { textShapes, textBounds } from "./textgeo.js";
import { applyParams } from "./params.js"; // jumpstart-3d: parameters

// text entities resolved to a spec the kernel and the outline code understand
export function sketchTexts(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const out = [];
  for (const e of sk.ents) {
    if (e.t !== "text" || e.cons) continue;
    const p = P.get(e.p);
    if (!p || !String(e.str || "").trim()) continue;
    out.push({ id: e.id, spec: { str: e.str, size: e.size || 10, x: p.x, y: p.y, angle: e.angle || 0, font: e.font || "sans" } });
  }
  return out;
}

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function newDoc(name = "Untitled", mode = "beginner") {
  return { v: 1, id: uid("d"), name, mode, created: Date.now(), seq: 0, grid: 1, bodies: [], sketches: [], planes: [], joints: [], params: [] };
}
// older designs have no mode: anything with sketches or features is Advanced
export function docMode(doc) {
  if (doc.mode === "beginner" || doc.mode === "advanced" || doc.mode === "chisel") return doc.mode;
  const json = JSON.stringify(doc.bodies || []);
  return (doc.sketches || []).length || /"t":"(extrude|revolve|fillet|chamfer|hole|shell|bool)"/.test(json) ? "advanced" : "beginner";
}

// ------------------------------------------------------------- store
const listeners = new Set();
export const store = {
  doc: newDoc(),
  preview: null, // a proposed doc while a command dialog is open
  undoStack: [],
  redoStack: [],
  get view() { return this.preview || this.doc; },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind) { for (const f of listeners) f(kind); },
  load(doc) {
    this.doc = migrate(doc);
    applyParams(this.doc); // jumpstart-3d: parameters
    this.preview = null;
    this.undoStack = [];
    this.redoStack = [];
    this.emit("load");
  },
  // mutate a copy of the doc; push the old one on the undo stack
  update(fn, label = "Edit") {
    const next = clone(this.doc);
    const r = fn(next);
    if (r === false) return;
    applyParams(next); // jumpstart-3d: parameters
    this.undoStack.push({ doc: this.doc, label });
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
    this.doc = next;
    this.preview = null;
    this.emit("change");
    return next;
  },
  // replace doc without history (live drags); call update() at the end
  setTransient(doc) { this.preview = doc; this.emit("preview"); },
  setPreview(fn) {
    if (!fn) { if (this.preview) { this.preview = null; this.emit("preview"); } return; }
    const next = clone(this.doc);
    fn(next);
    this.preview = next;
    this.emit("preview");
  },
  commitPreview(label) {
    if (!this.preview) return;
    const p = this.preview;
    this.preview = null;
    this.undoStack.push({ doc: this.doc, label });
    this.redoStack = [];
    this.doc = p;
    this.emit("change");
  },
  undo() {
    if (!this.undoStack.length) return null;
    const { doc, label } = this.undoStack.pop();
    this.redoStack.push({ doc: this.doc, label });
    this.doc = doc;
    this.preview = null;
    this.emit("change");
    return label;
  },
  redo() {
    if (!this.redoStack.length) return null;
    const { doc, label } = this.redoStack.pop();
    this.undoStack.push({ doc: this.doc, label });
    this.doc = doc;
    this.preview = null;
    this.emit("change");
    return label;
  },
};

function migrate(doc) {
  const d = { ...newDoc(), ...doc };
  d.bodies = d.bodies || [];
  d.sketches = d.sketches || [];
  d.planes = d.planes || [];
  d.joints = d.joints || [];
  d.params = d.params || [];
  d.mode = docMode(doc);
  return d;
}

export const nextSeq = (doc) => ++doc.seq;
export const findBody = (doc, id) => doc.bodies.find((b) => b.id === id);
export const findSketch = (doc, id) => doc.sketches.find((s) => s.id === id);

// ------------------------------------------------------------- regions cache
const regionCache = new Map();
export function sketchCurves(sk) {
  return resolveSketch(sk);
}
// The closed shapes the user drew themselves (projected face outlines left out), and for
// each profile of the sketch, which of those shapes it belongs to: the smallest one around it.
// Projected outlines split a drawn shape into pieces; the pieces belong together.
const loopCache = new Map();
export function userLoops(sk) {
  const key = JSON.stringify([sk.pts, sk.ents]);
  let r = loopCache.get(key);
  if (!r) {
    r = findRegions(resolveSketch(sk).filter((c) => !c.proj && !c.cons));
    loopCache.set(key, r);
    if (loopCache.size > 60) loopCache.delete(loopCache.keys().next().value);
  }
  return r;
}
export function regionOwners(sk) {
  const regs = regionsFor(sk), loops = userLoops(sk);
  return regs.map((r) => {
    if (r.text) return "r:" + r.key;
    let best = null;
    for (const L of loops) if (regionContains(L, r.pt) && (!best || Math.abs(polyArea(L.poly)) < Math.abs(polyArea(best.poly)))) best = L;
    return best ? "u:" + best.key : "r:" + r.key;
  });
}
// the profiles that make up the same drawn shape as profile i
export function shapeGroup(sk, i) {
  const own = regionOwners(sk);
  return own[i] && own[i].startsWith("u:") ? own.map((o, j) => (o === own[i] ? j : -1)).filter((j) => j >= 0) : [i];
}
export function regionsFor(sk) {
  const key = JSON.stringify([sk.pts, sk.ents]);
  let r = regionCache.get(key);
  if (!r) {
    r = findRegions(resolveSketch(sk));
    // each text is one profile (click any letter to pick the whole text)
    for (const t of sketchTexts(sk)) {
      const b = textBounds(t.spec);
      const shapes = textShapes(t.spec);
      if (!shapes.length) continue;
      r.push({
        key: "text:" + t.id, ents: [t.id], text: t.spec, shapes,
        poly: [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]], holePolys: [],
        area: (b.maxX - b.minX) * (b.maxY - b.minY), pt: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
      });
    }
    regionCache.set(key, r);
    if (regionCache.size > 60) regionCache.delete(regionCache.keys().next().value);
  }
  return r;
}

// ------------------------------------------------------------- sweep paths
// Ends of a sketch curve (lines and arcs; circles are closed).
function curveEnds(c) {
  if (c.t === "line") return [c.a, c.b];
  if (c.t === "arc" || (c.t === "spline" && !c.closed)) return [c.pa, c.pb];
  return null;
}
const isClosed = (c) => c.t === "circle" || (c.t === "spline" && c.closed);
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
// The chain of connected curves through a picked one, stopping at branches (like Fusion).
export function pathChain(curves, startId) {
  const cs = curves.filter((c) => c.t === "line" || c.t === "arc" || c.t === "circle" || c.t === "spline");
  const start = cs.find((c) => c.id === startId);
  if (!start) return [];
  if (isClosed(start)) return [start.id];
  const ids = new Set([start.id]);
  const grow = (pt) => {
    for (;;) {
      const touching = cs.filter((c) => !isClosed(c) && curveEnds(c).some((q) => near(q, pt)));
      if (touching.length !== 2) return; // an open end or a branch
      const next = touching.find((c) => !ids.has(c.id));
      if (!next) return; // closed loop
      ids.add(next.id);
      const [e0, e1] = curveEnds(next);
      pt = near(e0, pt) ? e1 : e0;
    }
  };
  const [a, b] = curveEnds(start);
  grow(a); grow(b);
  return [...ids];
}
// Ordered, oriented path segments in sketch coordinates: {t, a, b, m?} or a circle.
export function orderPath(curves, ids) {
  const segs = curves.filter((c) => ids.includes(c.id));
  if (!segs.length) return [];
  const circ = segs.find((c) => c.t === "circle");
  if (circ) return [{ t: "circle", c: circ.c, r: circ.r }];
  const loop = segs.find((c) => c.t === "spline" && c.closed);
  if (loop) return [{ t: "bez", a: loop.pa, b: loop.pb, spans: loop.spans }];
  const mid = (c) => { let sw = ((c.a1 - c.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI; const t = c.a0 + sw / 2; return [c.c[0] + c.r * Math.cos(t), c.c[1] + c.r * Math.sin(t)]; };
  const items = segs.map((c) => ({ c, ends: curveEnds(c) }));
  // start at an end used once (an open path); a closed loop can start anywhere
  const count = (pt) => items.reduce((n, it) => n + it.ends.filter((q) => near(q, pt)).length, 0);
  let first = items.find((it) => count(it.ends[0]) === 1 || count(it.ends[1]) === 1) || items[0];
  let pt = count(first.ends[0]) === 1 || count(first.ends[1]) !== 1 ? first.ends[0] : first.ends[1];
  const out = [], used = new Set();
  for (let guard = 0; guard < items.length; guard++) {
    const it = guard === 0 ? first : items.find((x) => !used.has(x) && x.ends.some((q) => near(q, pt)));
    if (!it) break;
    used.add(it);
    const fwd = near(it.ends[0], pt);
    const a = fwd ? it.ends[0] : it.ends[1], b = fwd ? it.ends[1] : it.ends[0];
    if (it.c.t === "spline") out.push({ t: "bez", a, b, spans: fwd ? it.c.spans : it.c.spans.slice().reverse().map((q) => [q[3], q[2], q[1], q[0]]) });
    else out.push(it.c.t === "line" ? { t: "line", a, b } : { t: "arc", a, b, m: mid(it.c) });
    pt = b;
  }
  return out;
}

export function sketchPathSegs(psk, ents) {
  const M = psk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
  const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
  return orderPath(resolveSketch(psk), ents).map((s) => s.t === "circle" ? { t: "circle", c: W(s.c), r: s.r, n: M.n } : { t: s.t, a: W(s.a), b: W(s.b), m: s.m && W(s.m), spans: s.spans && s.spans.map((b) => b.map(W)) });
}
// ------------------------------------------------------------- resolution
// Replace sketch references with concrete geometry so the kernel can build it.
// When every piece of a shape the user drew is picked (a face's projected outline cut it into
// pieces), use the drawn shape itself: one clean profile instead of slivers that share edges.
// Pieces that share edges extrude into solids that touch, and booleans with those can fail.
function wholeLoops(sk, regs, picked) {
  if (picked.length < 2 || !sk.ents.some((e) => e.proj)) return picked;
  const own = regionOwners(sk), loops = userLoops(sk);
  const idx = new Set(picked.map((r) => regs.indexOf(r)));
  const byOwner = new Map();
  own.forEach((o, i) => { if (o.startsWith("u:")) { if (!byOwner.has(o)) byOwner.set(o, []); byOwner.get(o).push(i); } });
  const out = [];
  const used = new Set();
  for (const r of picked) {
    const i = regs.indexOf(r), o = own[i];
    const all = o && byOwner.get(o);
    if (all && all.length > 1 && all.every((j) => idx.has(j))) {
      if (used.has(o)) continue;
      const L = loops.find((l) => "u:" + l.key === o);
      if (L) { used.add(o); out.push(L); continue; }
    }
    out.push(r);
  }
  return out;
}
export function resolveNode(node, doc) {
  const n = { ...node };
  if (node.t === "pipe") {
    // a sketch path, or body edges picked as fixed world-space segments
    const psk = node.path && findSketch(doc, node.path.sketch);
    if (psk) n.pathSegs = sketchPathSegs(psk, node.path.ents);
    else n.pathSegs = node.edgeSegs || [];
    delete n.path; delete n.edgeSegs;
  }
  if (node.t === "sweep") {
    // path: ordered world-space segments from the path sketch
    const psk = node.path && findSketch(doc, node.path.sketch);
    if (psk) {
      const M = psk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
      const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
      n.pathSegs = orderPath(resolveSketch(psk), node.path.ents).map((s) => s.t === "circle" ? { t: "circle", c: W(s.c), r: s.r, n: M.n } : { t: s.t, a: W(s.a), b: W(s.b), m: s.m && W(s.m), spans: s.spans && s.spans.map((b) => b.map(W)) });
    } else n.pathSegs = [];
    delete n.path;
  }
  if (node.t === "extrude" || node.t === "revolve" || node.t === "sweep") {
    const sk = findSketch(doc, node.sketch);
    if (sk) {
      const regs = regionsFor(sk);
      n.plane = sk.plane;
      let picked = (node.profiles || [])
        .map((ref) => resolveRegionRef(regs, ref))
        .filter(Boolean)
        .filter((r, i, a) => a.indexOf(r) === i);
      picked = wholeLoops(sk, regs, picked);
      n.regions = picked.map((r) => (r.text ? { text: r.text } : { outer: r.outer, holes: r.holes }));
      if (node.t === "revolve" && node.axis) {
        const W = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
        if (W[node.axis]) { n.axisWorld = { o: [0, 0, 0], d: W[node.axis] }; n.axis = null; }
        else {
          const c = resolveSketch(sk).find((c) => c.id === node.axis);
          n.axis = c && c.t === "line" ? { a: c.a, b: c.b } : null;
        }
      }
    } else {
      n.regions = [];
    }
    delete n.sketch;
    delete n.profiles;
  }
  if (node.t === "loft") {
    // sections: sketch profiles (or points) turned into planes and loops; an optional centerline
    n.sections = (node.sections || []).map((sec) => {
      if (sec.point) {
        const sk = findSketch(doc, sec.point.sketch);
        if (!sk) return null;
        const p = resolveSketch(sk).find((c) => c.id === sec.point.id) || (sk.pts || []).find((q) => q.id === sec.point.id);
        const xy = p ? (p.t === "point" ? p.p : [p.x, p.y]) : null;
        if (!xy) return null;
        const M = sk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
        return { pt: [0, 1, 2].map((i) => M.o[i] + M.x[i] * xy[0] + y[i] * xy[1]) };
      }
      const sk = findSketch(doc, sec.sketch);
      if (!sk) return null;
      const r = resolveRegionRef(regionsFor(sk), sec.ref);
      return r ? { plane: sk.plane, region: r.text ? { text: r.text } : { outer: r.outer, holes: r.holes } } : null;
    }).filter(Boolean);
    const rsk = node.rail && findSketch(doc, node.rail.sketch);
    if (rsk) {
      const M = rsk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
      const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
      n.railSegs = orderPath(resolveSketch(rsk), node.rail.ents).map((s) => s.t === "circle" ? { t: "circle", c: W(s.c), r: s.r, n: M.n } : { t: s.t, a: W(s.a), b: W(s.b), m: s.m && W(s.m), spans: s.spans && s.spans.map((b) => b.map(W)) });
    }
    delete n.rail;
  }
  if (node.t === "mirror" && node.srcBody) {
    // a live mirror of another body: follows it when it changes
    const src = doc.bodies.find((b) => b.id === node.srcBody);
    if (src && src.node.t !== "mirror") { n.src = resolveNode(src.node, doc); n.srcM = src.m; }
    else n.src = null;
    delete n.srcBody;
  } else if ((node.t === "mirror" || node.t === "placed") && node.src) n.src = resolveNode(node.src, doc);
  if (node.t === "group") {
    n.children = node.children.map((c) => ({ node: resolveNode(c.node, doc), m: c.m, hole: !!c.hole }));
  }
  if (node.mods && node.mods.length) {
    n.mods = node.mods.map((m) => {
      if (m.t === "bool") return { ...m, tool: resolveNode(m.tool, doc) };
      return m;
    });
  }
  return n;
}

export function bodyKey(resolved) {
  return JSON.stringify(resolved, (k, v) => (k === "id" || k === "seq" || k === "name" || k === "color" ? undefined : v));
}

// ------------------------------------------------------------- timeline
// Every creation step gets a sequence number; the timeline lists them in order.
const PRIM_NAMES = { box: "Box", cylinder: "Cylinder", sphere: "Sphere", cone: "Cone", pyramid: "Pyramid", wedge: "Wedge", torus: "Torus", tube: "Tube", hemisphere: "Hemisphere", prism: "Prism", text: "Text", star: "Star", heart: "Heart", roof: "Roof", roundroof: "Round roof", paraboloid: "Paraboloid", gem: "Gem", spring: "Spring", capsule: "Capsule", arrow: "Arrow" };
export function primName(kind) { return PRIM_NAMES[kind] || kind; }

export function timeline(doc) {
  const items = [];
  for (const s of doc.sketches) items.push({ seq: s.seq, kind: "sketch", label: s.name, sketch: s.id });
  for (const p of doc.planes || []) items.push({ seq: p.seq, kind: "plane", label: p.name, plane: p.id });
  for (const j of doc.joints || []) items.push({ seq: j.seq, kind: "joint", label: j.name, joint: j.id });
  for (const b of doc.bodies) {
    if (b.cutPreview) continue;
    const n = b.node;
    const kind = n.t === "prim" || n.t === "mesh" || n.t === "step" ? "prim" : n.t === "group" ? "combine" : n.t;
    const label = n.t === "mesh" ? (b.sculpt ? "Sculpt" : "Imported mesh") : n.t === "step" ? "Imported STEP" : n.t === "prim" ? primName(n.kind) : n.t === "group" ? (n.op === "intersect" ? "Intersect" : "Combine") : n.t === "extrude" ? "Extrude" : n.t === "sweep" ? "Sweep" : n.t === "pipe" ? "Pipe" : n.t === "coil" ? "Coil" : n.t === "loft" ? "Loft" : n.t === "mirror" ? "Mirror" : "Revolve";
    items.push({ seq: b.seq, kind, label, body: b.id });
    for (const m of n.mods || []) {
      const lab = { halfspace: "Split body", sketchsplit: "Split body", splitface: "Split face", fillet: "Fillet", chamfer: "Chamfer", hole: "Hole", shell: "Shell", offset: "Offset face", thread: "Thread", scale: "Scale", emboss: m.mode === "deboss" ? "Deboss text" : "Emboss text", bool: ({ sweep: "Sweep ", revolve: "Revolve ", pipe: "Pipe ", coil: "Coil ", loft: "Loft ", mirror: "Mirror " }[m.tool && m.tool.t] || "Extrude ") + (m.op === "cut" ? "cut" : m.op === "intersect" ? "intersect" : "join") }[m.t];
      if (m.src === "combine") { items.push({ seq: m.seq || b.seq, kind: "combine", label: "Combine" + (m.op === "cut" ? " (cut)" : m.op === "intersect" ? " (intersect)" : ""), body: b.id, mod: m.id }); continue; }
      items.push({ seq: m.seq || b.seq, kind: m.t === "bool" ? (m.tool && ["sweep", "pipe", "coil", "loft", "mirror"].includes(m.tool.t) ? m.tool.t : "extrude") : m.t, label: lab, body: b.id, mod: m.id });
    }
    for (const tx of b.textures || []) items.push({ seq: tx.seq || b.seq, kind: "texture", label: "Texture", body: b.id, tex: tx.id });
  }
  return items.sort((a, b) => a.seq - b.seq);
}
