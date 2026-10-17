// Document operations shared by both modes.
import * as THREE from "three";
import { store, IDENTITY, nextSeq, findBody, primName } from "./store.js";
import { uid, clone, nextColor } from "./util.js";

export const M4 = (arr) => new THREE.Matrix4().fromArray(arr);
export const arr = (m) => m.toArray();

export const PRIM_DEFAULTS = {
  box: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  cylinder: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  sphere: { w: 20, d: 20, h: 20 },
  cone: { w: 20, d: 20, h: 20, top: 0 },
  pyramid: { w: 20, d: 20, h: 20, sides: 4 },
  wedge: { w: 20, d: 20, h: 20, r: 0, c: 0 },
  torus: { w: 20, d: 20, h: 4, tube: 4 },
  tube: { w: 20, d: 20, h: 20, wall: 2 },
  hemisphere: { w: 20, d: 20, h: 10 },
  prism: { w: 20, d: 20, h: 20, sides: 6, r: 0, c: 0 },
  text: { text: "TEXT", size: 15, h: 5, font: "sans" },
  star: { w: 20, d: 20, h: 5, points: 5, inner: 0.5 },
  heart: { w: 20, d: 18, h: 6 },
  roof: { w: 20, d: 20, h: 12 },
  roundroof: { w: 20, d: 20, h: 10 },
  paraboloid: { w: 20, d: 20, h: 20 },
  gem: { w: 20, d: 20, h: 20 },
  spring: { w: 20, d: 20, h: 30, turns: 5, wire: 2 },
  capsule: { w: 30, d: 12, h: 12 },
  arrow: { w: 30, d: 20, h: 5 },
};

let nameCounters = {};
export function nextName(doc, base) {
  let n = 1;
  const names = new Set(doc.bodies.map((b) => b.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function makePrimBody(doc, kind, m, opts = {}) {
  const p = { ...PRIM_DEFAULTS[kind], ...(opts.p || {}) };
  return {
    id: uid("b"),
    name: nextName(doc, opts.hole ? primName(kind) + " hole" : primName(kind)),
    seq: nextSeq(doc),
    color: opts.color || nextColor(),
    hole: !!opts.hole,
    hidden: false,
    m: m || IDENTITY.slice(),
    node: { t: "prim", kind, p, mods: [] },
  };
}

// matrix that puts local Z along a face normal, origin at point
export function frameOnFace(point, normal) {
  const z = normal.clone().normalize();
  let x = new THREE.Vector3(1, 0, 0);
  if (Math.abs(z.dot(x)) > 0.9) x = new THREE.Vector3(0, 1, 0);
  x = x.sub(z.clone().multiplyScalar(x.dot(z))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(point);
}

// sketch ids a body's features were built from
function sketchesUsed(b) {
  const out = new Set();
  JSON.stringify(b.node, (k, v) => { if (k === "sketch" && typeof v === "string") out.add(v); return v; });
  return out;
}
// Deleting bodies also deletes the sketches that belonged only to them (drawn on
// their faces or used only by their features), so no stray lines are left behind.
export function deleteBodies(ids, label = "Delete") {
  if (!ids.length) return 0;
  let removed = 0;
  store.update((doc) => {
    const gone = doc.bodies.filter((b) => ids.includes(b.id));
    doc.bodies = doc.bodies.filter((b) => !ids.includes(b.id));
    const usedByGone = new Set(), usedByKept = new Set();
    for (const b of gone) for (const id of sketchesUsed(b)) usedByGone.add(id);
    for (const b of doc.bodies) for (const id of sketchesUsed(b)) usedByKept.add(id);
    const before = doc.sketches.length;
    doc.sketches = doc.sketches.filter((sk) => usedByKept.has(sk.id) || !(usedByGone.has(sk.id) || ids.includes(sk.onBody)));
    removed = before - doc.sketches.length;
  }, label);
  return removed;
}

export function duplicateBodies(ids, offset = [0, 0, 0]) {
  const newIds = [];
  store.update((doc) => {
    for (const id of ids) {
      const b = findBody(doc, id);
      if (!b) continue;
      const c = clone(b);
      c.id = uid("b");
      c.seq = nextSeq(doc);
      c.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
      const m = M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(...offset));
      c.m = arr(m);
      doc.bodies.push(c);
      newIds.push(c.id);
    }
  }, "Duplicate");
  return newIds;
}

// Tinkercad-style group: union of solids minus holes. op "intersect" for Combine > Intersect.
export function groupBodies(ids, opts = {}) {
  let gid = null;
  store.update((doc) => {
    const bodies = ids.map((id) => findBody(doc, id)).filter(Boolean);
    if (bodies.length < 2) return false;
    const first = opts.target ? findBody(doc, opts.target) : bodies.find((b) => !b.hole) || bodies[0];
    const ordered = [first, ...bodies.filter((b) => b !== first)];
    const children = ordered.map((b) => ({
      node: b.node, m: b.m, hole: opts.op === "cut" ? b !== first : !!b.hole, name: b.name, color: b.color,
    }));
    const allHoles = children.every((c) => c.hole);
    const g = {
      id: uid("b"),
      name: opts.name || (opts.op ? first.name : nextName(doc, allHoles ? "Hole group" : "Group")),
      seq: nextSeq(doc),
      color: first.hole ? (bodies.find((b) => !b.hole) || first).color : first.color,
      hole: allHoles,
      hidden: false,
      m: IDENTITY.slice(),
      node: { t: "group", op: opts.op === "intersect" ? "intersect" : undefined, children, mods: [] },
    };
    const keep = new Set(opts.keepTools ? [first.id] : ids);
    doc.bodies = doc.bodies.filter((b) => !keep.has(b.id));
    doc.bodies.push(g);
    gid = g.id;
  }, opts.label || "Group");
  return gid;
}

// Push a stretch (x' = k*x + o) into a group's children. Only works when every child
// frame lines up with the group's axes.
export function scaleChildren(node, k, o) {
  const perm = (v) => { const i = [0, 1, 2].find((j) => Math.abs(Math.abs(v[j]) - 1) < 1e-9); return i === undefined ? null : i; };
  const plan = [];
  for (const c of node.children) {
    const m = c.m || IDENTITY;
    const cols = [0, 1, 2].map((j) => perm([m[4 * j], m[4 * j + 1], m[4 * j + 2]]));
    if (cols.some((x) => x === null)) return false;
    plan.push(cols.map((i) => k[i]));
  }
  node.children.forEach((c, n) => {
    const kc = plan[n];
    const m = (c.m || IDENTITY).slice();
    for (let i = 0; i < 3; i++) m[12 + i] = m[12 + i] * k[i] + o[i];
    c.m = m;
    const nd = c.node;
    const plain = nd.t === "prim" && !(nd.mods && nd.mods.length) && !["torus", "text"].includes(nd.kind);
    if (plain) { nd.p = { ...nd.p, w: nd.p.w * kc[0], d: nd.p.d * kc[1], h: nd.p.h * kc[2] }; if (nd.kind === "tube" && nd.p.wall) nd.p.wall *= Math.min(kc[0], kc[1]); }
    else {
      nd.mods = nd.mods || [];
      const last = nd.mods[nd.mods.length - 1];
      if (last && last.t === "scale") { last.k = last.k.map((v, i) => v * kc[i]); last.o = last.o.map((v, i) => v * kc[i]); }
      else nd.mods.push({ id: uid("f"), seq: 0, t: "scale", k: kc, o: [0, 0, 0] });
    }
  });
  node.mods = [];
  return true;
}

export function ungroupBody(id) {
  const out = [];
  store.update((doc) => {
    const g = findBody(doc, id);
    if (!g || g.node.t !== "group") return false;
    const gm = M4(g.m);
    const idx = doc.bodies.indexOf(g);
    // a resized group hands its Scale feature down to the children
    const mods = g.node.mods || [];
    if (mods.length === 1 && mods[0].t === "scale" && !scaleChildren(g.node, mods[0].k, mods[0].o)) return false;
    const kids = g.node.children.map((c) => {
      const b = {
        id: uid("b"),
        name: c.name || nextName(doc, "Body"),
        seq: nextSeq(doc),
        color: c.color || g.color,
        hole: !!c.hole,
        hidden: false,
        m: arr(gm.clone().multiply(M4(c.m))),
        node: c.node,
      };
      out.push(b.id);
      return b;
    });
    doc.bodies.splice(idx, 1, ...kids);
  }, "Ungroup");
  return out;
}

export function transformBodies(ids, mat, label = "Move", doc = null) {
  const apply = (d) => {
    for (const id of ids) {
      const b = findBody(d, id);
      if (b) b.m = arr(M4(b.m).premultiply(mat));
    }
  };
  if (doc) return apply(doc);
  store.update(apply, label);
}

export function setBodyProps(ids, props, label = "Edit") {
  store.update((doc) => {
    for (const id of ids) {
      const b = findBody(doc, id);
      if (b) Object.assign(b, props);
    }
  }, label);
}
