// jumpstart-3d: advanced CAD calls (IMPROVEMENT_PLAN 9.1). AGPL-3.0-only.
// The Advanced-mode calls of JS3D: sketch, extrude, revolve, fillet, chamfer, shell, hole, pattern, faces, edges. Each writes the same
// document structures the Advanced dialogs write, in one undo step, so a person can open the feature tree, the dialogs and the sketch
// editor on the result. Faces and edges are picked with selectors (cadselect.js), resolved once at the call against the built shape and
// stored the way the app stores them (edge signatures, face centres, hole points). BRIDGE.md has the reference.
import { show } from "./teach.js";
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY, resolveNode, bodyKey, regionsFor, findSketch } from "./store.js";
import { M4, arr, nextName } from "./ops.js";
import { uid, nextColor } from "./util.js";
import { evalExpr, exprScope } from "./params.js";
import { sketchDof } from "./constraints.js";
import { faceArea } from "./holepattern.js";
import { planeMatrix } from "./scene.js";
import { parseSelector, selectItems } from "./cadselect.js";
import { LIMITS } from "./sharelink.js";
import { buildShapes, defaultProfiles, pickProfiles } from "./cadsketch.js";

const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const r9 = (x) => +x.toFixed(9) || 0;
const round3 = (x) => Math.round(x * 1e3) / 1e3;
const rounded = (v) => (typeof v === "number" ? r4(v) : Array.isArray(v) ? v.map(rounded) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)])) : v);
const PLANES = {
  XY: { x: [1, 0, 0], n: [0, 0, 1] },
  XZ: { x: [1, 0, 0], n: [0, -1, 0] },
  YZ: { x: [0, 1, 0], n: [1, 0, 0] },
};
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const FACE_TYPES = { PLANE: "plane", CYLINDRE: "cylinder", CONE: "cone", SPHERE: "sphere", TORUS: "torus" };
const EDGE_TYPES = { LINE: "line", CIRCLE: "circle", ELLIPSE: "ellipse" };
const LEN = ["a number of mm more than 0, or an expression", (v) => v > 0];
const snap = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));

export const baseOf = (app, id) => {
  const b = findBody(store.doc, id);
  if (!b) return null;
  const r = app.kernel.get(bodyKey(resolveNode(b.node, store.doc)) + (app.kernel.quality > 1 ? "@q" + app.kernel.quality : ""));
  return r && r.ok ? { body: b, data: r.mesh, m: M4(b.m) } : null;
};

export function initBridgeCad(app, { edit, need, ready }) {
  // a number or an expression: { v, expr? }. kind [description, test]; a failed test on a plain number says what is wanted, on an expression
  // that the text gives no usable number
  function quantity(raw, name, [what, ok], angle = false) {
    if (typeof raw === "number" && isFinite(raw)) {
      if (!ok(raw)) throw new Error(`${name} must be ${what}, got ${show(raw)}. Give a valid ${name}.`);
      return { v: raw };
    }
    if (typeof raw !== "string" || !raw.trim()) throw new Error(`${name} must be ${what}, got ${show(raw)}. Give a valid ${name}.`);
    if (raw.length > 200) throw new Error(`${name} is too long; an expression can have at most 200 characters, got ${show(raw)}. Shorten the expression.`);
    const v = evalExpr(raw, exprScope(store.doc), { unit: "mm", angle });
    if (!isFinite(v) || !ok(v)) throw new Error(`${name} ${show(raw)} does not give a usable number. Use ${what}.`);
    return { v, expr: raw };
  }
  const withExpr = (owner, key, n) => { if (n.expr) (owner.exprs = owner.exprs || {})[key] = n.expr; };
  const loose = (raw, name) => quantity(raw, name, ["a number", () => true]);

  // the built shape of a body, after waiting for the engine. solid: the call puts a feature on it
  async function target(id, solid = true) {
    edit();
    const body = need(id);
    if (solid && body.hole) throw new Error(`${show(body.name)} is marked as a hole; features go on solid bodies. Choose a solid body from JS3D.list().`);
    await ready();
    const failure = app.scene.errors.get(id);
    if (failure) throw new Error(`${show(body.name)} has a build error: ${failure}. Check the body in JS3D.list() and fix its geometry.`);
    const base = baseOf(app, id);
    if (!base) throw new Error(body.hidden ? `${show(body.name)} is hidden and has not been built; show it first. Then retry the call.` : `${show(body.name)} could not be built. Check its geometry in JS3D.list().`);
    return base;
  }

  // ------------------------------------------------------------- topology, in world coordinates
  function topology(base) {
    const { data, m, body } = base, W = (a) => new THREE.Vector3(...a).applyMatrix4(m), D = (a) => new THREE.Vector3(...a).transformDirection(m);
    const drawn = data.edgeGroups.map((g) => g[1] > 0);
    const faces = data.faceInfo.map((info, i) => {
      const f = { index: i, type: FACE_TYPES[info.t] ?? "other", center: W(info.c).toArray(), area: faceArea(data, i), edges: (data.faceEdges[i] || []).filter((e) => drawn[e]) };
      if (info.t === "PLANE" && info.n) f.normal = D(info.n).toArray();
      if (info.t === "CYLINDRE") Object.assign(f, { radius: info.r, axis: D(info.ax).toArray(), hole: info.ext === false });
      if (info.t === "SPHERE") f.radius = info.r;
      return f;
    });
    const L = data.lines, edges = [];
    data.edgeInfo.forEach((info, i) => {
      if (!drawn[i]) return;
      const [s, c] = data.edgeGroups[i], poly = [];
      for (let j = s; j < s + c; j++) poly.push(W([L[j * 3], L[j * 3 + 1], L[j * 3 + 2]]));
      const a = W(info.a), b = W(info.b), mid = W(info.m), type = EDGE_TYPES[info.t] ?? "other", full = a.distanceTo(b) < 1e-6;
      let length = 0;
      for (let j = 0; j + 1 < poly.length; j++) length += poly[j].distanceTo(poly[j + 1]);
      const center = type === "line" ? a.clone().add(b).multiplyScalar(0.5) : type === "circle" && full ? a.clone().add(mid).multiplyScalar(0.5)
        : poly.reduce((s2, p) => s2.add(p), new THREE.Vector3()).divideScalar(poly.length || 1);
      const e = { index: i, type, start: a.toArray(), end: b.toArray(), mid: mid.toArray(), center: center.toArray(), length, faces: [] };
      if (type === "line") e.direction = b.clone().sub(a).normalize().toArray();
      if (type === "circle") {
        if (full) e.radius = a.distanceTo(mid) / 2;
        else { const area = new THREE.Vector3().crossVectors(mid.clone().sub(a), b.clone().sub(a)).length() / 2; e.radius = area > 1e-12 ? (a.distanceTo(mid) * mid.distanceTo(b) * a.distanceTo(b)) / (4 * area) : Infinity; }
      }
      edges.push(e);
    });
    const byIndex = new Map(edges.map((e) => [e.index, e]));
    faces.forEach((f) => f.edges.forEach((e) => byIndex.get(e)?.faces.push(f.index)));
    return { name: body.name, faces, edges, edgeMax: data.edgeInfo.length - 1 };
  }
  // the indices a selector (text, an index, a list of indices) gives; throws when none match
  function pick(topo, kind, sel) {
    const text = typeof sel === "string" ? sel : Number.isInteger(sel) ? `${kind} ${sel}` : Array.isArray(sel) && sel.length && sel.every(Number.isInteger) ? sel.map((i) => `${kind} ${i}`).join(" or ") : null;
    if (text === null) throw new Error(`${kind}s must be a selector such as ${kind === "face" ? '"top"' : '"edges of top"'}, ${kind === "edge" ? "an" : "a"} ${kind} index or a list of indices, got ${show(sel)}. Call JS3D.${kind === "face" ? "faces" : "edges"}(id) to inspect them.`);
    const found = selectItems(parseSelector(text, kind), topo, kind);
    if (!found.length) throw new Error(`no ${kind}s match ${show(sel)} on ${show(topo.name)}. Call JS3D.${kind === "face" ? "faces" : "edges"}(id) to inspect them.`);
    return found;
  }
  const faceView = ({ edges, ...f }) => rounded({ ...f, edgeCount: edges.length });
  const one = (topo, sel, why) => {
    const [i, ...rest] = pick(topo, "face", sel);
    if (rest.length) throw new Error(`face ${show(sel)} on ${show(topo.name)} matches ${rest.length + 1} faces; ${why} needs exactly one. Use an index from JS3D.faces(id).`);
    const f = topo.faces[i];
    if (f.type !== "plane" || !f.normal) throw new Error(`face ${show(sel)} on ${show(topo.name)} is not flat (it is a ${f.type === "other" ? "curved surface" : f.type}). Choose a plane from JS3D.faces(id).`);
    return i;
  };

  // ------------------------------------------------------------- sketch
  function facePlane(info, m) {
    const n = new THREE.Vector3(...info.n).transformDirection(m).normalize(), c = new THREE.Vector3(...info.c).applyMatrix4(m);
    const o = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c).projectPoint(new THREE.Vector3(), new THREE.Vector3());
    const x = new THREE.Vector3(Math.abs(n.x) > 0.9 ? 0 : 1, Math.abs(n.x) > 0.9 ? 1 : 0, 0);
    x.sub(n.clone().multiplyScalar(x.dot(n))).normalize();
    return { plane: { o: snap(o), x: snap(x), n: snap(n) }, center: c };
  }
  async function sketchPlane(on) {
    const bad = 'on must be "XY", "XZ", "YZ", {plane, offset} or {body, face}';
    const world = (name, offset = 0) => {
      const p = PLANES[String(name).toUpperCase()];
      if (!p) throw new Error(`${bad}, got ${show(name)}. Example: on: "XY".`);
      if (typeof offset !== "number" || !isFinite(offset)) throw new Error(`offset must be a number of mm, got ${show(offset)}. Example: offset: 5.`);
      return { plane: { o: p.n.map((v) => v * offset || 0), x: p.x.slice(), n: p.n.slice() } };
    };
    if (typeof on === "string") return world(on);
    if (!on || typeof on !== "object" || Array.isArray(on)) throw new Error(`${bad}, got ${show(on)}. Example: on: "XY".`);
    const flat = on.plane !== undefined || on.offset !== undefined, onBody = on.body !== undefined || on.face !== undefined;
    if (flat && onBody) throw new Error(`on takes plane (and offset) or body and face, not both, got ${show(on)}. Remove one choice.`);
    if (flat) return world(on.plane ?? "", on.offset);
    if (!onBody || on.body === undefined || on.face === undefined) throw new Error(`${bad}, got ${show(on)}. Example: on: "XY".`);
    if (!(typeof on.face === "string" || Number.isInteger(on.face))) throw new Error(`face must be a face selector such as "top" or a face index, got ${show(on.face)}. Call JS3D.faces(on.body) to inspect faces.`);
    const base = await target(on.body), topo = topology(base), f = one(topo, on.face, "a sketch");
    const { plane, center } = facePlane(base.data.faceInfo[f], base.m), q = center.applyMatrix4(planeMatrix(plane).invert()), tidy = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(9));
    return { plane, onBody: base.body.id, faceCenter: [tidy(q.x), tidy(q.y)] };
  }
  const nextSketchName = (doc) => { const names = new Set(doc.sketches.map((s) => s.name)); let n = 1; while (names.has("Sketch " + n)) n++; return "Sketch " + n; };

  async function sketch(opts) {
    edit();
    const { on = "XY", name, shapes, hidden = false } = opts ?? {};
    if (name !== undefined && (typeof name !== "string" || !name.trim())) throw new Error(`name must be a non-empty string, got ${show(name)}. Example: name: "Part".`);
    if (typeof hidden !== "boolean") throw new Error(`hidden must be true or false, got ${show(hidden)}. Use hidden: true to hide the new sketch, or leave it out.`);
    const where = await sketchPlane(on);
    const built = buildShapes(shapes, (v, what) => quantity(v, what, ["a number", () => true]));
    let id;
    store.update((doc) => {
      const sk = { id: uid("s"), name: name ? name.trim() : nextSketchName(doc), seq: nextSeq(doc), plane: where.plane, pts: built.pts, ents: built.ents, cons: built.cons, hidden };
      if (where.onBody) { sk.onBody = where.onBody; sk.faceCenter = where.faceCenter; }
      doc.sketches.push(sk);
      id = sk.id;
    }, "Create sketch");
    const sk = findSketch(store.doc, id), { o, x, n } = sk.plane, y = new THREE.Vector3(...n).cross(new THREE.Vector3(...x));
    return {
      sketch: id, name: sk.name, plane: rounded({ o, x, y: y.toArray(), n }),
      shapes: built.shapes.map((s) => ({ ...s })),
      profiles: regionsFor(sk).map((r) => rounded({ pt: r.pt, area: r.area })),
      dof: sketchDof(sk).dof,
      dims: sk.cons.filter((c) => c.t === "dim").map((c) => ({ name: c.name, value: r4(c.v), ...(c.expr ? { expr: c.expr } : {}) })),
    };
  }

  // ------------------------------------------------------------- extrude and revolve
  // the sketch, its profiles and where the result goes; checked before anything is written
  function shapeOf(o) {
    const { sketch: sid, profiles, op = "new", body, name } = o;
    if (!["new", "join", "cut"].includes(op)) throw new Error(`op must be "new", "join" or "cut", got ${show(op)}. Use op: "join" to add to opts.body, "cut" to cut it, or leave op out.`);
    if (op === "new" && body !== undefined) throw new Error(`body is only for op "join" or "cut", got ${show(body)}. Remove body or change op.`);
    if (op !== "new" && body === undefined) throw new Error(`op ${show(op)} needs body: the id of the body to ${op}, got ${show(body)}. Choose one from JS3D.list().`);
    if (op !== "new" && name !== undefined) throw new Error(`name is only for op "new", got ${show(name)}. Remove name or change op.`);
    if (name !== undefined && (typeof name !== "string" || !name.trim())) throw new Error(`name must be a non-empty string, got ${show(name)}. Example: name: "Part".`);
    const sk = typeof sid === "string" && findSketch(store.doc, sid);
    if (!sk) throw new Error(`no sketch ${show(sid)}. Use the sketch id returned by JS3D.sketch().`);
    const target_ = op === "new" ? null : need(body);
    if (target_ && target_.hole) throw new Error(`${show(target_.name)} is marked as a hole; features go on solid bodies. Choose a solid body from JS3D.list().`);
    const regions = regionsFor(sk);
    if (!regions.length) throw new Error(`${show(sk.name)} has no closed shapes to extrude. Create a sketch with a closed shape.`);
    if (profiles !== undefined && !Array.isArray(profiles)) throw new Error(`profiles must be a list of [x, y] points in the sketch, got ${show(profiles)}. Use points from the JS3D.sketch() result.`);
    const picked = profiles && profiles.length ? pickProfiles(regions, profiles, sk.name) : defaultProfiles(regions);
    return { sk, op, name, body: target_, refs: picked.map((r) => ({ key: r.key, pt: r.pt })) };
  }
  // one update: the sketch is hidden (as the dialog's OK does) and the node becomes a new body or a join or cut on the body
  function place(s, node, label) {
    let feature = null, bodyId;
    store.update((doc) => {
      findSketch(doc, s.sk.id).hidden = true;
      if (s.op === "new") {
        bodyId = uid("b");
        doc.bodies.push({ id: bodyId, name: s.name?.trim() ?? nextName(doc, "Body"), seq: nextSeq(doc), color: nextColor(), hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] } });
      } else {
        const b = findBody(doc, s.body.id);
        bodyId = b.id;
        feature = uid("f");
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: feature, seq: nextSeq(doc), t: "bool", op: s.op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
      }
    }, s.op === "new" ? label : `${label} ${s.op}`);
    return { body: bodyId, feature };
  }

  async function extrude(o) {
    edit();
    o = o ?? {};
    if (o.mode !== undefined && !["one", "sym", "two"].includes(o.mode)) throw new Error(`mode must be "one", "sym" or "two", got ${show(o.mode)}. Use mode: "sym" for both ways equally, "two" with dist2, or leave it out for one way.`);
    let mode = o.mode ?? "one";
    if (o.dist2 !== undefined && mode !== "two") throw new Error(`dist2 is only for mode "two", got ${show(o.dist2)}. Remove dist2 or set mode to "two".`);
    if (mode === "two" && o.dist2 === undefined) throw new Error(`mode "two" needs dist2, got ${show(o.dist2)}. Set dist2 to a positive distance.`);
    if (o.through !== undefined && typeof o.through !== "boolean") throw new Error(`through must be true or false, got ${show(o.through)}. Use through: true to go through the whole body, or leave it out and give dist.`);
    if (o.through && o.op !== "cut") throw new Error(`through is only for op "cut", got ${show(o.through)}. Set op to "cut" or remove through.`);
    if (o.through && o.dist !== undefined) throw new Error(`give dist or through, not both, got dist ${show(o.dist)} and through ${show(o.through)}. Remove one.`);
    if (o.through && mode !== "one") throw new Error(`through needs mode "one", got ${show(mode)}. Set mode to "one".`);
    const s = shapeOf(o);
    let dist, dist2 = o.dist2 === undefined ? undefined : quantity(o.dist2, "dist2", LEN);
    if (o.through) {
      const base = await target(s.body.id), n = new THREE.Vector3(...s.sk.plane.n).normalize(), p0 = new THREE.Vector3(...s.sk.plane.o), w = new THREE.Vector3(), V = base.data.vertices;
      let up = -Infinity, down = -Infinity;
      for (let i = 0; i + 2 < V.length; i += 3) { const d = w.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(base.m).sub(p0).dot(n); up = Math.max(up, d); down = Math.max(down, -d); }
      if (up > 1e-6 && down > 1e-6) { mode = "two"; dist = { v: round3(up + 1) }; dist2 = { v: round3(down + 1) }; }
      else if (down > 1e-6) dist = { v: -round3(down + 1) };
      else if (up > 1e-6) dist = { v: round3(up + 1) };
      else throw new Error(`${show(s.body.name)} does not reach the sketch plane. Place the sketch on or through the body.`);
    } else {
      dist = quantity(o.dist, "dist", ["a number of mm, not 0, or an expression", (v) => Math.abs(v) > 1e-6]);
    }
    const node = { t: "extrude", sketch: s.sk.id, profiles: s.refs, dist: dist.v, mode, dist2: dist2 ? dist2.v : 0 };
    withExpr(node, "dist", dist);
    if (dist2) withExpr(node, "dist2", dist2);
    return place(s, node, "Extrude");
  }

  async function revolve(o) {
    edit();
    o = o ?? {};
    const s = shapeOf(o), { axis } = o;
    if (typeof axis !== "string" || !axis) throw new Error(`axis must be "X", "Y", "Z" or the id of a line in the sketch, got ${show(axis)}. Choose an axis in the sketch plane.`);
    const n = new THREE.Vector3(...s.sk.plane.n).normalize();
    let stored;
    if (/^[xyz]$/i.test(axis)) {
      stored = axis.toUpperCase();
      if (Math.abs(n.dot(new THREE.Vector3(...AXES[axis.toLowerCase()]))) >= 1e-6) {
        const ok = Object.keys(AXES).filter((k) => Math.abs(n.dot(new THREE.Vector3(...AXES[k]))) < 1e-6).map((k) => k.toUpperCase());
        throw new Error(`axis ${show(axis)} is not in the plane of ${show(s.sk.name)}; ${ok.length ? "use " + ok.join(" or ") : "use the id of a line in the sketch"}.`);
      }
    } else {
      if (!s.sk.ents.some((e) => e.id === axis && e.t === "line")) throw new Error(`axis ${show(axis)} is not a line of ${show(s.sk.name)}. Use a line id returned by JS3D.sketch().`);
      stored = axis;
    }
    const angle = o.angle === undefined ? { v: 360 } : quantity(o.angle, "angle", ["more than 0 and at most 360 (degrees)", (v) => v > 0 && v <= 360], true);
    const node = { t: "revolve", sketch: s.sk.id, profiles: s.refs, axis: stored, angle: angle.v };
    withExpr(node, "angle", angle);
    return place(s, node, "Revolve");
  }

  // ------------------------------------------------------------- fillet, chamfer, shell, holes
  const mod = (id, doc, m) => { const b = findBody(doc, id); b.node.mods = b.node.mods || []; b.node.mods.push(m); };
  async function edgeFeature(t, id, edges, raw, key) {
    const base = await target(id), topo = topology(base), picked = pick(topo, "edge", edges), size = quantity(raw, key, [`a number of mm more than 0, or an expression`, (v) => v > 0]);
    const feature = uid("f"), m = { id: feature, seq: 0, t, edges: picked.map((i) => structuredClone(base.data.edgeInfo[i])), [key]: size.v };
    withExpr(m, key, size);
    store.update((doc) => { m.seq = nextSeq(doc); mod(id, doc, m); }, t === "fillet" ? "Fillet" : "Chamfer");
    return { body: id, feature, edges: picked.length };
  }
  async function shell(id, o) {
    const base = await target(id), topo = topology(base);
    o = o ?? {};
    const th = quantity(o.th, "th", ["a number of mm more than 0, or an expression", (v) => v > 0]), dir = o.dir ?? "in";
    if (!["in", "out", "both"].includes(dir)) throw new Error(`dir must be "in", "out" or "both", got ${show(dir)}. Choose one of those values.`);
    const open = o.open === undefined || o.open === null || (Array.isArray(o.open) && !o.open.length) ? [] : pick(topo, "face", o.open);
    const feature = uid("f"), m = { id: feature, seq: 0, t: "shell", th: th.v, faces: open.map((f) => ({ c: structuredClone(base.data.faceInfo[f].c) })), ...(dir === "in" ? {} : { dir }) };
    withExpr(m, "th", th);
    store.update((doc) => { m.seq = nextSeq(doc); mod(id, doc, m); }, open.length ? "Shell" : "Hollow");
    return { body: id, feature, open: open.length };
  }
  async function hole(id, o) {
    o = o ?? {};
    if (o.shape !== undefined) throw new Error(`hole makes round holes; use holePattern for square, hex or slot holes, got shape ${show(o.shape)}. Remove shape for a round hole.`);
    const base = await target(id), topo = topology(base);
    if (o.face === undefined) throw new Error(`face must be a face selector such as "top" or a face index, got ${show(o.face)}. Call JS3D.faces(id) to inspect faces.`);
    const face = one(topo, o.face, "a hole"), { kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear } = o;
    const r = app.advanced.addHoles({ body: id, face, points: o.points, hole: { kind, size, dia, depth, tip, cbDia, cbDepth, csDia, csAngle, pitch, clear } });
    return { body: id, feature: r.id, holes: r.holes };
  }

  // ------------------------------------------------------------- pattern
  const featOK = (m) => m.t === "hole" || (m.t === "emboss" && m.kind !== "other") || (m.t === "bool" && m.src !== "combine" && m.src !== "clearance" && m.tool && ["extrude", "revolve", "sweep"].includes(m.tool.t) && m.tool.sketch);
  function pattern(id, o) {
    edit();
    const body = need(id);
    if (body.hole) throw new Error(`${show(body.name)} is marked as a hole; features go on solid bodies. Choose a solid body from JS3D.list().`);
    o = o ?? {};
    const wholeShape = Array.isArray(o.features) && o.features.length === 1 && o.features[0] === "shape";
    if (!Array.isArray(o.features) || !o.features.length || (!wholeShape && !o.features.every((f) => typeof f === "string" && f !== "shape"))) throw new Error(`features must be a list of feature ids, or ["shape"], got ${show(o.features)}. Use a feature id returned by a feature call.`);
    const mods = body.node.mods || [];
    if (!wholeShape) for (const fid of o.features) {
      const m = mods.find((x) => x.id === fid);
      if (!m) throw new Error(`feature ${show(fid)} is not on ${show(body.name)}. Use a feature id returned by a feature call on this body.`);
      if (!featOK(m)) throw new Error(`feature ${show(fid)} (${/^[aeiou]/i.test(m.t) ? "an" : "a"} ${m.t}) cannot be patterned; holes, extrude, revolve and sweep cuts or joins, and embossed text can. Choose a supported feature.`);
    }
    if (o.type !== "rect" && o.type !== "circle") throw new Error(`type must be "rect" or "circle", got ${show(o.type)}. Choose one of those values.`);
    const circle = o.type === "circle", Bi = M4(body.m).invert(), mirrored = M4(body.m).determinant() < 0;
    const dirOf = (a, name) => {
      const v = typeof a === "string" ? (Object.hasOwn(AXES, a.toLowerCase()) ? AXES[a.toLowerCase()] : null) : Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === "number" && isFinite(x)) ? a : null;
      if (!v || !(Math.hypot(...v) > 0)) throw new Error(`${name} must be "x", "y", "z" or [x, y, z], got ${show(a)}. Use a non-zero direction such as "x".`);
      return new THREE.Vector3(...v).transformDirection(Bi).toArray().map((x) => r9(circle && mirrored ? -x : x));
    };
    const count = (raw, name, lo, hi) => quantity(raw, name, [`a whole number from ${lo} to ${hi}`, (v) => Number.isInteger(Math.round(v)) && Math.abs(v - Math.round(v)) < 1e-9 && v >= lo && v <= hi]);
    const spacing = (raw, name) => quantity(raw, name, ["a number of mm, not 0", (v) => v !== 0]);
    const props = { kind: circle ? "circ" : "rect", what: wholeShape ? "shape" : "feats" };
    if (!wholeShape) props.feats = mods.filter((m) => o.features.includes(m.id)).map((m) => m.id);
    let copies;
    const exprs = {};
    const keep = (key, n) => { if (n.expr) exprs[key] = n.expr; };
    if (circle) {
      const cn = count(o.count, "count", 2, 360), angle = o.angle === undefined ? { v: 360 } : quantity(o.angle, "angle", ["more than 0 and at most 360 (degrees)", (v) => v > 0 && v <= 360], true);
      const c = o.center ?? [0, 0, 0];
      if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => typeof x === "number" && isFinite(x))) throw new Error(`center must be [x, y, z] in mm, got ${show(c)}. Example: center: [0, 0, 0].`);
      Object.assign(props, { cax: dirOf(o.axis, "axis"), center: new THREE.Vector3(...c).applyMatrix4(Bi).toArray().map(r9), cn: cn.v, angle: angle.v });
      keep("cn", cn); keep("angle", angle);
      copies = cn.v - 1;
    } else {
      const n1 = count(o.count, "count", 1, 200), n2 = o.count2 === undefined ? { v: 1 } : count(o.count2, "count2", 1, 200), sym = o.both === undefined ? false : o.both;
      if (typeof sym !== "boolean") throw new Error(`both must be true or false, got ${show(sym)}. Set both to true or false.`);
      const s1 = n1.v > 1 ? spacing(o.spacing, "spacing") : o.spacing === undefined ? { v: 0 } : quantity(o.spacing, "spacing", ["a number of mm", () => true]);
      if (n2.v > 1 && o.axis2 === undefined) throw new Error(`axis2 is needed when count2 is more than 1, got ${show(o.axis2)}. Example: axis2: "y".`);
      const s2 = n2.v > 1 ? spacing(o.spacing2, "spacing2") : o.spacing2 === undefined ? { v: 0 } : quantity(o.spacing2, "spacing2", ["a number of mm", () => true]);
      const ax1 = dirOf(o.axis, "axis");
      const other = o.axis2 ?? Object.keys(AXES).map((k) => [k, Math.abs(new THREE.Vector3(...AXES[k]).dot(new THREE.Vector3(...ax1)))]).sort((a, b) => a[1] - b[1])[0][0];
      Object.assign(props, { ax1, n1: n1.v, s1: s1.v, ax2: dirOf(other, "axis2"), n2: n2.v, s2: s2.v, sym });
      keep("n1", n1); keep("s1", s1); keep("n2", n2); keep("s2", s2);
      const span = (n) => (sym ? 2 * n - 1 : n);
      copies = Math.round(span(n1.v)) * Math.round(span(n2.v)) - 1;
      if (copies + 1 > LIMITS.REPEAT_TOTAL) throw new Error(`this pattern would make ${copies} copies; the most is ${LIMITS.REPEAT_TOTAL - 1} (counting the original, ${LIMITS.REPEAT_TOTAL} in all). Reduce count or count2.`);
      if (copies < 1) throw new Error("the pattern makes no copies; give count or count2 of 2 or more");
    }
    if (Object.keys(exprs).length) props.exprs = exprs;
    const feature = uid("f");
    store.update((doc) => mod(id, doc, { id: feature, seq: nextSeq(doc), t: "pattern", ...props }), "Pattern");
    return { body: id, feature, copies };
  }

  return {
    sketch, extrude, revolve,
    fillet: (id, edges, r) => edgeFeature("fillet", id, edges, r, "r"),
    chamfer: (id, edges, d) => edgeFeature("chamfer", id, edges, d, "d"),
    shell, hole, pattern,
    async faces(id, selector = "all") { const topo = topology(await target(id, false)); return pick(topo, "face", selector).map((i) => faceView(topo.faces[i])); },
    async edges(id, selector = "all") { const topo = topology(await target(id, false)); return pick(topo, "edge", selector).map((i) => rounded(topo.edges.find((e) => e.index === i))); },
  };
}
