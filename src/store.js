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
  if (doc.mode === "beginner" || doc.mode === "advanced" || doc.mode === "chisel" || doc.mode === "arch") return doc.mode;
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
// Picked profiles that touch each other (a rectangle and a circle drawn overlapping, or a shape
// split by a face's outline) are joined into one outline before extruding. Each profile's
// boundary is a loop of pieces; a piece two profiles share runs in opposite directions in each,
// so those cancel, and what is left is the outline of the whole picked area (plus its holes).
// Extruding touching pieces separately makes solids that only touch, and joins or cuts with
// those can quietly lose pieces.
export function mergeRegions(regions) {
  const flat = regions.filter((r) => !r.text && r.outer);
  if (flat.length < 2) return regions;
  const R6 = (v) => Math.round(v * 1e5) / 1e5;
  const pk = (p) => R6(p[0]) + "," + R6(p[1]);
  const keyOf = (g) => g.t === "circle" ? "c" + pk(g.c) + ":" + R6(g.r) : [g.t, pk(g.a), pk(g.b), g.m ? pk(g.m) : g.spans ? pk(g.spans[0][1]) : ""].join("|");
  const revKey = (g) => g.t === "circle" ? keyOf(g) : [g.t, pk(g.b), pk(g.a), g.m ? pk(g.m) : g.spans ? pk(g.spans[g.spans.length - 1][2]) : ""].join("|");
  const all = [];
  for (const r of flat) for (const loop of [r.outer, ...(r.holes || [])]) for (const g of loop) all.push(g);
  // count each piece; a piece and its reverse cancel
  const cnt = new Map();
  for (const g of all) cnt.set(keyOf(g), (cnt.get(keyOf(g)) || 0) + 1);
  const left = [];
  const used = new Map();
  for (const g of all) {
    const k = keyOf(g), rk = revKey(g);
    if (g.t === "circle") { // no direction: the same circle twice (a disc and the ring around it) cancels in pairs
      const n = cnt.get(k); if (n % 2 === 0 || (used.get(k) || 0) < n - 1) { used.set(k, (used.get(k) || 0) + 1); continue; }
      left.push(g); continue;
    }
    if (cnt.get(rk) && (used.get(rk) || 0) < cnt.get(rk)) { used.set(rk, (used.get(rk) || 0) + 1); continue; }
    left.push(g);
  }
  if (left.length === all.length) return regions; // nothing shared: they don't touch
  // chain the remaining pieces into closed loops
  const loops = [], pool = left.filter((g) => g.t !== "circle");
  for (const c of left.filter((g) => g.t === "circle")) loops.push([c]);
  while (pool.length) {
    const loop = [pool.shift()];
    for (let guard = 0; guard < 10000; guard++) {
      const end = pk(loop[loop.length - 1].b);
      if (end === pk(loop[0].a)) break;
      const i = pool.findIndex((g) => pk(g.a) === end);
      if (i < 0) return regions; // didn't close up: keep the profiles as they were
      loop.push(pool.splice(i, 1)[0]);
    }
    loops.push(loop);
  }
  // signed area (sampled) tells outer loops (counter-clockwise) from holes
  const samp = (loop) => {
    const pts = [];
    for (const g of loop) {
      if (g.t === "circle") { for (let k = 0; k < 48; k++) pts.push([g.c[0] + g.r * Math.cos((k / 48) * 2 * Math.PI), g.c[1] + g.r * Math.sin((k / 48) * 2 * Math.PI)]); continue; }
      pts.push(g.a);
      if (g.m) pts.push(g.m);
      if (g.spans) for (const sp of g.spans) pts.push(sp[1], sp[2], sp[3]);
    }
    return pts;
  };
  const area = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return -a / 2; };
  const inside = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > q[1]) !== (P[j][1] > q[1]) && q[0] < ((P[j][0] - P[i][0]) * (q[1] - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  const info = loops.map((l) => { const P = samp(l); return { l, P, A: area(P) }; });
  // a lone circle has no direction: it's an outer loop unless it sits inside another outer loop
  const outers = info.filter((x) => x.A > 0 || (x.l[0].t === "circle" && !info.some((o) => o !== x && o.A > 0 && inside(x.P[0], o.P))));
  const holes = info.filter((x) => !outers.includes(x));
  const out = outers.map((o) => ({ outer: o.l, holes: [], _P: o.P, _A: Math.abs(o.A) }));
  for (const h of holes) {
    const host = out.filter((o) => inside(h.P[0], o._P)).sort((a, b) => a._A - b._A)[0];
    if (host) host.holes.push(h.l);
  }
  return [...regions.filter((r) => r.text || !r.outer), ...out.map(({ outer, holes }) => ({ outer, holes }))];
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
      const picked = (node.profiles || [])
        .map((ref) => resolveRegionRef(regs, ref))
        .filter(Boolean)
        .filter((r, i, a) => a.indexOf(r) === i);
      n.regions = mergeRegions(picked.map((r) => (r.text ? { text: r.text } : { outer: r.outer, holes: r.holes })));
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
    n.mods = node.mods.map((m, i) => {
      if (m.t === "bool") return { ...m, tool: resolveNode(m.tool, doc) };
      if (m.t === "pattern" && m.what === "feats") return { ...m, feats: patternFeats(m, node.mods.slice(0, i), doc) }; // jumpstart-3d: pattern
      return m;
    });
  }
  return n;
}

// jumpstart-3d: pattern. A feature pattern lists the ids of the earlier mods it repeats; the kernel gets them as
// resolved copies, so editing the source hole changes every copy. An id that is gone is dropped.
function patternFeats(m, before, doc) {
  return (m.feats || []).map((id) => before.find((x) => x.id === id)).filter((f) => f && ["hole", "emboss", "bool"].includes(f.t)).map((f) => (f.t === "bool" ? { ...f, tool: resolveNode(f.tool, doc) } : f));
}

export function bodyKey(resolved) {
  return JSON.stringify(resolved, (k, v) => (k === "id" || k === "seq" || k === "name" || k === "color" || k === "exprs" || k === "exprUnits" ? undefined : v)); // jumpstart-3d: parameters
}

// ------------------------------------------------------------- timeline
// Every creation step gets a sequence number; the timeline lists them in order.
const PRIM_NAMES = { box: "Box", cylinder: "Cylinder", sphere: "Sphere", cone: "Cone", pyramid: "Pyramid", wedge: "Wedge", torus: "Torus", tube: "Tube", hemisphere: "Hemisphere", prism: "Prism", text: "Text", star: "Star", heart: "Heart", roof: "Roof", roundroof: "Round roof", paraboloid: "Paraboloid", gem: "Gem", spring: "Spring", capsule: "Capsule", arrow: "Arrow" };
export function primName(kind) { return PRIM_NAMES[kind] || kind; }

// jumpstart-3d: parameters. " (dist = t)" after the label of a feature with bound values
const exprTag = (o) => { const e = Object.entries(o.exprs || {}); return e.length ? ` (${e.map(([k, v]) => `${k} = ${v}`).join(", ")})` : ""; };
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
    items.push({ seq: b.seq, kind, label: label + exprTag(n), body: b.id }); // jumpstart-3d: parameters
    for (const m of n.mods || []) {
      // jumpstart-3d: fill openings
      const lab = { fillopen: "Fill openings", keeppiece: `Keep piece ${m.piece + 1}`, halfspace: "Split body", sketchsplit: "Split body", splitface: "Split face", fillet: "Fillet", chamfer: "Chamfer", hole: "Hole", shell: "Shell", offset: "Offset face", thread: "Thread", scale: "Scale", emboss: m.mode === "deboss" ? "Deboss text" : "Emboss text", facepat: "Pattern on face", pattern: "Pattern", bool: ({ sweep: "Sweep ", revolve: "Revolve ", pipe: "Pipe ", coil: "Coil ", loft: "Loft ", mirror: "Mirror " }[m.tool && m.tool.t] || "Extrude ") + (m.op === "cut" ? "cut" : m.op === "intersect" ? "intersect" : "join") }[m.t]; // jumpstart-3d: pattern (label)
      if (m.src === "combine") { items.push({ seq: m.seq || b.seq, kind: "combine", label: "Combine" + (m.op === "cut" ? " (cut)" : m.op === "intersect" ? " (intersect)" : ""), body: b.id, mod: m.id }); continue; }
      items.push({ seq: m.seq || b.seq, kind: m.t === "bool" ? (m.tool && ["sweep", "pipe", "coil", "loft", "mirror"].includes(m.tool.t) ? m.tool.t : "extrude") : m.t, label: lab && lab + exprTag(m.t === "bool" ? m.tool : m), body: b.id, mod: m.id }); // jumpstart-3d: parameters
    }
    for (const tx of b.textures || []) items.push({ seq: tx.seq || b.seq, kind: "texture", label: "Texture", body: b.id, tex: tx.id });
  }
  return items.sort((a, b) => a.seq - b.seq);
}
