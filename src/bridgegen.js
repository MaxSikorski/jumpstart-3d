import { baseOf } from "./bridgecad.js";
// jumpstart-3d: generator calls (IMPROVEMENT_PLAN 9.3), stored as the dialogs store them. See BRIDGE.md.
import * as THREE from "three";
import { store, findBody, nextSeq, resolveNode, bodyKey } from "./store.js";
import { M4, arr, nextName } from "./ops.js";
import { uid, round } from "./util.js";
import { binSet } from "./bins.js";
import { gearSet as gearLib } from "./gearlib.js";
import { resolve as resolveGear, gearBody } from "./gears.js";
import { FASTENER_KINDS, sizesFor, sizeData, defaultLength, fastenerPart, partLowZ, MAX_TURNS, tooMany } from "./fasteners.js";
import { LIB } from "./texture.js";
import { drawBodies } from "./bodydrawing.js";
import { boxOptions, gearSetOptions, textureOptions, drawingOptions, at3, generatorName } from "./genopts.js";
import { show } from "./teach.js";

const T3 = (v) => arr(new THREE.Matrix4().makeTranslation(...v));
export function initBridgeGen(app, { edit, need, idList, ready, api }) {
  function boxMaker(opts = {}) {
    edit();
    const { o, at, name } = boxOptions(opts ?? {}), set = binSet(o), mainId = uid("b"), ids = {};
    store.update((doc) => {
      for (const q of set.parts) {
        const id = q.key === "main" ? mainId : (ids[q.key] = uid("b"));
        doc.bodies.push({ id, name: q.key === "main" ? name || nextName(doc, o.style === "bin" ? "Bin" : "Case") : "", seq: nextSeq(doc), color: q.color, hole: false, hidden: false, m: T3([at[0] + (q.dx || 0), at[1] + (q.dy || 0), at[2] + (q.z || 0)]), node: q.node, ...(q.key === "main" ? {} : { binPart: mainId }) });
      }
      const main = findBody(doc, mainId);
      for (const q of set.parts) if (q.key !== "main") findBody(doc, ids[q.key]).name = main.name + " · " + q.name[0].toLowerCase() + q.name.slice(1);
      main.bin = { ...o, ids };
    }, "Bin");
    return { id: mainId, parts: set.parts.map((q) => { const b = findBody(store.doc, q.key === "main" ? mainId : ids[q.key]); return { id: b.id, name: b.name, kind: q.kind }; }), cell: set.cell ?? null, info: set.info || "" };
  }
  function gearSet(opts = {}) {
    edit();
    const g = gearSetOptions(opts ?? {});
    if (!g.lib) {
      const r1 = resolveGear(g.spec1), r2 = resolveGear(g.spec2);
      let a, b;
      store.update((doc) => { a = gearBody(doc, r1).id; const b2 = gearBody(doc, r2); b2.m = g.m2.slice(); b = b2.id; }, g.type === "bevel" ? "Bevel gear pair" : "Helical gear pair");
      return { id: a, parts: [{ id: a, name: r1.name }, { id: b, name: r2.name }], info: g.info };
    }
    const set = gearLib(g.o), base = T3(g.at), M0 = M4(base), mainId = uid("b"), ids = {}, jids = {};
    store.update((doc) => {
      set.parts.forEach((p, i) => {
        const id = ids[p.key] = i === 0 ? mainId : uid("b");
        const m = arr(M0.clone().multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, 0)).multiply(new THREE.Matrix4().makeRotationZ(p.rot)));
        doc.bodies.push({ id, name: nextName(doc, p.name), seq: nextSeq(doc), color: p.color, hole: false, hidden: false, m, node: p.node, ...(i ? { gearPart: mainId } : {}) });
        p.id = id;
      });
      doc.joints = doc.joints || [];
      if (g.o.joints) {
        for (const p of set.parts) jids[p.key] = uid("j");
        const z = new THREE.Vector3(0, 0, 1).transformDirection(M4(base));
        for (const p of set.parts) {
          const c = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(M4(base));
          const d = p.joint.d ? new THREE.Vector3(...p.joint.d).transformDirection(M4(base)) : z;
          const names = new Set(doc.joints.map((j) => j.name));
          const name = (findBody(doc, p.id) || {}).name + " joint";
          doc.joints.push({ id: jids[p.key], name: names.has(name) ? name + " 2" : name, seq: nextSeq(doc), type: p.joint.type, body: p.id, parent: null, o: [c.x, c.y, c.z].map((v) => round(v, 1e-6)), d: [d.x, d.y, d.z].map((v) => +v.toFixed(6)), limited: false, min: -180, max: 180, ...(p.joint.link ? { link: { to: jids[p.joint.link.to], ratio: +p.joint.link.ratio.toFixed(8) } } : {}) });
        }
      }
      findBody(doc, mainId).gear = { o: { ...g.o }, ids: { ...ids }, jids: { ...jids }, base: base.slice(), base0: base.slice(), spin: 0 };
    }, "Gears");
    return { id: mainId, parts: set.parts.map((p) => ({ id: ids[p.key], name: findBody(store.doc, ids[p.key]).name })), info: set.info };
  }
  function hardware(opts = {}) {
    edit();
    const o = opts ?? {}, keys = "part size length threads clear left at name".split(" ");
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw new Error(`unknown option ${show(k)}; options: ${keys.join(", ")}. Remove or correct that option.`);
    const kinds = FASTENER_KINDS.filter((k) => k.id !== "cutter"), kind = kinds.find((k) => k.id === o.part);
    if (!kind) throw new Error(`part must be one of: ${kinds.map((k) => k.id).join(", ")}, got ${show(o.part)}. Example: JS3D.hardware({ part: "hexbolt", size: "M3" }).`);
    const key = typeof o.size === "string" ? o.size.trim().replace(/^(\d+\/\d+)-/, '$1"-') : "", std = key.startsWith("M") ? "metric" : "inch";
    if (!sizesFor(kind.id, std).includes(key) || (kind.metricOnly && std === "inch")) throw new Error(`unknown size ${show(o.size)} for part "${kind.id}"; sizes: ${[...sizesFor(kind.id, "metric"), ...(kind.metricOnly ? [] : sizesFor(kind.id, "inch"))].join(", ")}. Try one of those, for example "M3".`);
    if (o.length != null && !kind.len) throw new Error(`length is not used for part "${kind.id}", got ${show(o.length)}. Leave length out for this part.`);
    if (o.length != null && (typeof o.length !== "number" || !Number.isFinite(o.length) || o.length < 1 || o.length > 300)) throw new Error(`length must be a number from 1 to 300 (mm), got ${show(o.length)}. Try 12.`);
    const len = o.length ?? defaultLength(kind.id, std, key);
    for (const k of ["threads", "left"]) if (o[k] != null && typeof o[k] !== "boolean") throw new Error(`${k} must be true or false, got ${show(o[k])}. Try true.`);
    const threads = o.threads ?? false, left = o.left ?? false;
    if (threads && !kind.thread) throw new Error(`part "${kind.id}" has no thread, got threads: ${show(o.threads)}. Leave threads out for this part.`);
    if (o.clear != null && (typeof o.clear !== "number" || !Number.isFinite(o.clear) || o.clear < -1 || o.clear > 0)) throw new Error(`clear must be a number from -1 to 0 (mm), got ${show(o.clear)}. Try -0.2.`);
    const clear = o.clear ?? (store.doc.threadOffset || 0), at = at3(o.at), n = Math.round(len / sizeData(std, key).p);
    if (threads && kind.len && n > MAX_TURNS) throw new Error(tooMany(n));
    const name = generatorName(o.name), pt = fastenerPart(kind.id, std, key, len, { threads, clear, left }), id = uid("b");
    store.update((doc) => doc.bodies.push({ id, name: name || pt.name, seq: nextSeq(doc), color: pt.color, hole: false, hidden: false, m: T3([at[0], at[1], +(at[2] - partLowZ(pt.node)).toFixed(6)]), node: pt.node, fastener: { kind: kind.id, std, size: key, len, threads, name: pt.name, clear, left } }), "Add fastener");
    return id;
  }
  const textures = () => LIB.map((t) => ({ key: t.key, name: t.name, category: t.cat, size: t.size || 4 }));
  async function texture(id, opts = {}) {
    edit();
    const b = need(id), { layer, faces } = textureOptions(opts ?? {});
    if (b.hole) throw new Error(`${show(b.name)} is marked as a hole; textures go on solid bodies. JS3D.list() marks the holes with hole: true; pick a solid body.`);
    const checkLimit = (body) => { if ((body.textures || []).length >= 16) throw new Error(`${show(body.name)} already has 16 textures; remove one in the Texture dialog first`); };
    checkLimit(b);
    const key = bodyKey(resolveNode(b.node, store.doc));
    const validate = () => {
      const current = findBody(store.doc, id);
      if (!current || current.hole || bodyKey(resolveNode(current.node, store.doc)) !== key) throw new Error(`${show(b.name)} changed while the texture was being prepared; try again`);
      checkLimit(current);
      return current;
    };
    await ready();
    validate();
    if (app.scene.errors.has(id)) throw new Error(`${show(b.name)} has a build error: ${app.scene.errors.get(id)}. Fix the shape, then call JS3D.texture again.`);
    const r = baseOf(app, id);
    if (!r) throw new Error(`${show(b.name)} could not be built. Call JS3D.get(${show(id)}) to see its error and await JS3D.ready(), then try again.`);
    let stored = "all";
    if (faces !== "all") {
      const list = [], seen = new Set();
      for (const selector of Array.isArray(faces) ? faces : [faces]) {
        for (const face of await api.faces(id, selector)) if (!seen.has(face.index)) { seen.add(face.index); list.push(face); }
      }
      validate();
      if (!list.length) throw new Error(`faces ${show(faces)} matches no face of ${show(b.name)}. Call JS3D.faces(${show(id)}) to see the faces it has.`);
      stored = list.map(({ index }) => { const f = r.data.faceInfo[index]; return f.n ? { c: f.c, t: f.t, n: f.n } : { c: f.c, t: f.t }; });
    }
    const tid = uid("t");
    store.update((doc) => { const x = findBody(doc, id); (x.textures = x.textures || []).push({ id: tid, seq: nextSeq(doc), faces: stored, ...layer }); }, "Texture");
    return { body: id, texture: tid, faces: stored === "all" ? "all" : stored.length };
  }
  async function drawing(opts = {}) {
    const d = drawingOptions(opts ?? {});
    await ready();
    const bodies = (d.ids !== undefined ? idList(d.ids).map(need) : store.doc.bodies).filter((b) => !b.hole && !b.hidden);
    if (!bodies.length) throw new Error("nothing to draw: holes and hidden shapes are left out. Show a body with JS3D.setHidden(id, false), or pass opts.ids of solid ones.");
    const failed = bodies.find((b) => app.scene.errors.has(b.id));
    if (failed) throw new Error(`"${failed.name}" has a build error (${app.scene.errors.get(failed.id)}); fix it before drawing`);
    const { text, skipped } = await drawBodies(app, bodies, d);
    if (skipped.length) throw new Error(`could not draw: ${skipped.map((id) => bodies.find((b) => b.id === id)?.name || id).join(", ")}. Call JS3D.get(id) on those bodies and await JS3D.ready(), then try again.`);
    return new TextEncoder().encode(text);
  }
  return { boxMaker, gearSet, hardware, textures, texture, drawing };
}
