// jumpstart-3d: scripting bridge. Puts the API below on window.JS3D so a script, the browser console or a
// tool server can build and read designs. Nothing here runs until a call is made. BRIDGE.md has the full
// reference with examples; this block is the short form.
//
// Units: lengths in mm, angles in degrees, positions [x, y, z], matrices 16 numbers column-major (a body's `m`;
// its position is m[12..14]). `ids` takes one id or an array. A call that names a missing body throws
// Error("no body <id>"). Every edit is one undo step with a readable label, and leaves the selection alone.
//
//   Reading    version, kinds(), list(), get(id), params(), doc(), save(), mode(), selection(), internals
//   Waiting    ready(timeoutMs=90000)   resolves when every shape has been built (or has an error)
//   Shapes     add(kind, {size, at, hole, color, name}) -> id
//              remove(ids) (alias delete) -> count, duplicate(ids, offset) -> new ids
//              move(ids, [dx,dy,dz]), moveTo(id, [x,y,z]), rotate(ids, axis, degrees, {about})
//              resize(id, {w,d,h,...}) plain shapes only, scale(ids, k, {about}) any shape
//              setHole(ids, bool), setColor(ids, "#rrggbb"), rename(id, name), setHidden(ids, bool)
//              group(ids, {name, op}) -> id, ungroup(id) -> new ids
//   Parameters setParam(name, expr, {unit}) -> value, removeParam(name) -> count, bind(id, key, expr|null)
//   History    undo(), redo() -> label or null
//   View       select(ids), fit(), setMode("beginner"|"advanced"), screenshot({fit}), screenshotDataURL({fit})
//   Files      export("stl"|"obj"|"3mf"|"step"|"json", {ids}) -> Uint8Array, load(json, {keepId}), newDesign(mode)
import * as THREE from "three";
import { store, findBody, nextSeq, primName } from "./store.js";
import { makePrimBody, PRIM_DEFAULTS, groupBodies, ungroupBody, deleteBodies, duplicateBodies, transformBodies, setBodyProps, M4, arr } from "./ops.js";
import { paramNameOk, removeParam, setExpr, evalExpr, exprScope, applyParams } from "./params.js";
import { uid } from "./util.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const MIN_SIZE_KEYS = new Set(["w", "d", "h", "size"]); // 0.01 mm is the smallest the app allows; other numbers (corner radius...) may be 0
const INTEGER_KEYS = new Set(["sides", "points"]);
const COLOR = /^#[0-9a-f]{6}$/i;

export function initBridge(app) {
  const need = (id) => {
    const b = typeof id === "string" && findBody(store.doc, id);
    if (!b) throw new Error("no body " + id);
    return b;
  };
  const idList = (ids, allowEmpty) => {
    const list = [...new Set(Array.isArray(ids) ? ids : [ids])];
    if (!list.length && !allowEmpty) throw new Error("no body ids given");
    list.forEach(need);
    return list;
  };
  const vec3 = (v, what) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && isFinite(x))) throw new Error(`${what} must be [x, y, z] in mm`);
    return v;
  };
  // every call that changes the design starts here. Chisel keeps its own copy of the shapes and writes it back into whatever
  // design is open when you leave, so nothing may be edited or loaded under it.
  const edit = () => {
    if (app.mode === "chisel") throw new Error("leave Chisel mode first");
    if (app.command) app.command.cancel();
  };
  const bool = (v, what) => {
    if (typeof v !== "boolean") throw new Error(`${what} must be true or false`);
    return v;
  };
  const isPlain = (b) => b.node.t === "prim" && !(b.node.mods && b.node.mods.length);
  // the design as data. The scene writes a cache, _key, onto each body in the live document; it is not part of the design.
  const snapshot = () => {
    const d = structuredClone(store.doc);
    d.bodies.forEach((b) => delete b._key);
    return d;
  };
  const translation = (v) => new THREE.Matrix4().makeTranslation(...v);

  // size values for a shape kind, checked. base: the sizes the shape has now (a torus keeps its depth equal to its width)
  function sizePatch(kind, size, base = PRIM_DEFAULTS[kind]) {
    if (size === undefined) return {};
    if (Array.isArray(size)) {
      if (size.length !== 3 || !("w" in base)) throw new Error(`${kind} size must be {${Object.keys(base).join(", ")}}`);
      size = { w: size[0], d: size[1], h: size[2] };
    }
    if (typeof size !== "object" || size === null) throw new Error("size must be {w, d, h} or [w, d, h]");
    const p = {};
    for (const [k, v] of Object.entries(size)) {
      if (!(k in base)) throw new Error(`${kind} has no size "${k}"; it has: ${Object.keys(base).join(", ")}`);
      if (typeof base[k] === "string") {
        if (typeof v !== "string" || !v) throw new Error(`${k} must be a non-empty string`);
      } else if (INTEGER_KEYS.has(k)) {
        if (!Number.isInteger(v) || v < 3) throw new Error(`${k} must be a whole number of at least 3, got ${v}`);
      } else {
        const min = MIN_SIZE_KEYS.has(k) ? 0.01 : 0;
        if (typeof v !== "number" || !isFinite(v) || v < min) throw new Error(`${k} must be a number of at least ${min}, got ${v}`);
      }
      p[k] = v;
    }
    if (kind === "torus" && Object.keys(p).length) p.d = p.w ?? base.w;
    return p;
  }

  // ------------------------------------------------------------- reading
  // a body's world box and volume, only while its shape is built and current (a view keeps its old mesh while a rebuild runs)
  function built(id) {
    const v = app.scene.views.get(id);
    return v && v.data && !v.pending && !app.scene.errors.has(id) ? v : null;
  }
  function entry(b) {
    const v = built(b.id), box = v ? app.scene.bodyTightBox(b.id) : null;
    const n = b.node;
    const e = {
      id: b.id, name: b.name, kind: n.t === "prim" ? n.kind : n.t, hole: !!b.hole, hidden: !!b.hidden, locked: !!b.locked, color: b.color,
      position: [b.m[12], b.m[13], b.m[14]],
      bbox: box ? { min: box.min.toArray().map(r4), max: box.max.toArray().map(r4) } : null,
      volume: v && v.data.volume != null ? Math.round(v.data.volume * 1e3) / 1e3 : null,
      error: app.scene.errors.get(b.id) || null,
    };
    if (n.t === "group") e.children = (n.children || []).length;
    return e;
  }
  // where to turn or scale when no point is given: the middle of the bodies' world box. A body that is not built has no box,
  // and guessing would make the result depend on timing.
  function centreOf(ids) {
    const boxes = ids.map((id) => {
      if (!built(id)) throw new Error(`${need(id).name} is still being built: await JS3D.ready() first, or pass opts.about`);
      return app.scene.bodyTightBox(id);
    });
    return boxes.reduce((a, b) => a.union(b)).getCenter(new THREE.Vector3()).toArray();
  }

  // ------------------------------------------------------------- waiting
  // the visible shapes still being built, as a list of names; null when everything is done (the logic of test/helpers.mjs waitIdle)
  function waiting() {
    const k = app.kernel, s = app.scene, names = [];
    for (const b of store.view.bodies) {
      if (s.errors.has(b.id) && !b._key) continue; // its definition could not be read, so it is never sent to the kernel
      const v = s.views.get(b.id);
      if (!v || v.pending || (!b.hidden && !v.data && !s.errors.has(b.id))) names.push(b.name);
    }
    return !k.ready || k.inflight || k.queue.size || names.length ? names : null;
  }
  async function ready(timeoutMs = 90000) {
    const t0 = Date.now();
    for (;;) {
      const w = waiting();
      if (!w) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`JS3D.ready timed out after ${timeoutMs} ms; still building: ${w.length ? w.join(", ") : "(the geometry engine is busy)"}`);
      await sleep(50);
    }
  }

  // ------------------------------------------------------------- history
  function history(dir) {
    edit();
    if (app.simLock) throw new Error("undo is off in the 3D Print Sim");
    return store[dir]();
  }

  // ------------------------------------------------------------- the pieces of export and screenshot
  async function screenshotDataURL(opts = {}) {
    await ready();
    if (opts.fit) {
      const box = app.scene.allBox();
      app.vp.fit(box.isEmpty() ? null : box);
      for (let i = 0; app.vp.anim && i < 60; i++) await sleep(50);
      if (app.vp.anim) app.vp.stepAnim(app.vp.anim.t0 + app.vp.anim.ms); // a hidden tab runs no animation frames: jump to the end
    }
    // the canvas does not keep its picture: draw and read in the same task
    app.vp.render();
    const url = app.vp.canvas.toDataURL("image/png");
    if (url.length < 100) throw new Error("the 3D view has no size to draw (is the tab hidden?)");
    return url;
  }
  const FILES = { stl: "stlBytes", obj: "objBytes", "3mf": "threeMFBytes", step: "stepBytes" };

  const api = {
    version: "1",
    internals: { app, store },

    kinds: () => Object.entries(PRIM_DEFAULTS).map(([kind, defaults]) => ({ kind, defaults: { ...defaults } })),
    list: () => store.doc.bodies.map(entry),
    get(id) { const b = need(id); return { ...entry(b), node: structuredClone(b.node), m: b.m.slice() }; },
    doc: snapshot,
    save: () => ({ app: "jumpstart-3d", version: 1, doc: snapshot() }),
    ready,

    // ----------------------------------------------------------- shapes
    add(kind, opts = {}) {
      edit();
      if (!PRIM_DEFAULTS[kind]) throw new Error(`unknown kind "${kind}"; valid kinds: ${Object.keys(PRIM_DEFAULTS).join(", ")}`);
      const p = sizePatch(kind, opts.size);
      const at = vec3(opts.at ?? [0, 0, 0], "at");
      if (opts.color !== undefined && !COLOR.test(opts.color)) throw new Error('color must look like "#rrggbb"');
      let id;
      store.update((doc) => {
        const b = makePrimBody(doc, kind, arr(translation(at)), { p, hole: !!opts.hole, color: opts.color });
        if (opts.name) b.name = String(opts.name);
        doc.bodies.push(b);
        id = b.id;
      }, "Add " + primName(kind).toLowerCase());
      return id;
    },
    remove(ids) {
      edit();
      ids = idList(ids);
      deleteBodies(ids, "Delete");
      return ids.length;
    },
    duplicate(ids, offset = [0, 0, 0]) {
      edit();
      return duplicateBodies(idList(ids), vec3(offset, "offset"));
    },
    move(ids, delta) {
      edit();
      transformBodies(idList(ids), translation(vec3(delta, "delta")), "Move");
    },
    moveTo(id, pos) {
      edit();
      need(id);
      const [x, y, z] = vec3(pos, "position");
      store.update((doc) => { const m = findBody(doc, id).m.slice(); m[12] = x; m[13] = y; m[14] = z; findBody(doc, id).m = m; }, "Move");
    },
    rotate(ids, axis, degrees, opts = {}) {
      edit();
      ids = idList(ids);
      const a = new THREE.Vector3(...(typeof axis === "string" ? AXES[axis.toLowerCase()] || [0, 0, 0] : Array.isArray(axis) ? vec3(axis, "axis") : [0, 0, 0]));
      if (!a.lengthSq()) throw new Error('axis must be "x", "y", "z" or [x, y, z]');
      if (typeof degrees !== "number" || !isFinite(degrees)) throw new Error("degrees must be a number");
      const c = vec3(opts.about ?? centreOf(ids), "about");
      const R = translation(c).multiply(new THREE.Matrix4().makeRotationAxis(a.normalize(), (degrees * Math.PI) / 180)).multiply(translation(c.map((x) => -x)));
      transformBodies(ids, R, "Rotate");
    },
    resize(id, size) {
      edit();
      const b = need(id);
      if (!isPlain(b)) throw new Error("resize works on plain shapes; use scale");
      const p = sizePatch(b.node.kind, size, b.node.p);
      store.update((doc) => {
        const n = findBody(doc, id).node;
        Object.assign(n.p, p);
        for (const k of Object.keys(p)) setExpr(n, k, null); // a typed size stops following its parameter
      }, "Resize");
    },
    // k: one number, or [kx, ky, kz] along the body's own axes. The shape gets a Scale feature (x' = k*x + o in its own frame,
    // o chosen so the `about` point stays where it is), the way the Beginner size boxes do it.
    scale(ids, k, opts = {}) {
      edit();
      ids = idList(ids);
      const kk = typeof k === "number" ? [k, k, k] : k;
      if (!Array.isArray(kk) || kk.length !== 3 || !kk.every((x) => typeof x === "number" && isFinite(x) && x > 0)) throw new Error("k must be a positive number or [kx, ky, kz]");
      const about = new THREE.Vector3(...vec3(opts.about ?? centreOf(ids), "about"));
      store.update((doc) => {
        for (const id of ids) {
          const b = findBody(doc, id);
          const a = about.clone().applyMatrix4(M4(b.m).invert()); // the point in the body's own frame
          const o = a.toArray().map((x, i) => x * (1 - kk[i]));
          const mods = (b.node.mods = b.node.mods || []);
          const last = mods[mods.length - 1];
          if (last && last.t === "scale") {
            last.k = last.k.map((v, i) => +(v * kk[i]).toPrecision(10));
            last.o = last.o.map((v, i) => +(v * kk[i] + o[i]).toPrecision(10));
            if (last.k.every((v) => Math.abs(v - 1) < 1e-9) && last.o.every((v) => Math.abs(v) < 1e-6)) mods.pop();
          } else mods.push({ id: uid("f"), seq: nextSeq(doc), t: "scale", k: kk.map((v) => +v.toPrecision(10)), o: o.map((v) => +v.toPrecision(10)) });
        }
      }, "Scale");
    },
    setHole(ids, hole) {
      edit();
      setBodyProps(idList(ids), { hole: bool(hole, "hole") }, hole ? "Make hole" : "Make solid");
    },
    setColor(ids, color) {
      edit();
      if (!COLOR.test(color)) throw new Error('color must look like "#rrggbb"');
      setBodyProps(idList(ids), { color }, "Color");
    },
    rename(id, name) {
      edit();
      need(id);
      if (typeof name !== "string" || !name.trim()) throw new Error("name must be a non-empty string");
      setBodyProps([id], { name: name.trim() }, "Rename");
    },
    setHidden(ids, hidden) {
      edit();
      setBodyProps(idList(ids), { hidden: bool(hidden, "hidden") }, hidden ? "Hide" : "Show");
    },
    group(ids, opts = {}) {
      edit();
      ids = idList(ids);
      if (ids.length < 2) throw new Error("group needs at least two bodies");
      if (opts.op !== undefined && opts.op !== "intersect" && opts.op !== "cut") throw new Error('op must be "intersect" or "cut" (leave it out to join)');
      const id = groupBodies(ids, { name: opts.name, op: opts.op, target: opts.op === "cut" ? ids[0] : undefined });
      if (!id) throw new Error("could not group those bodies");
      return id;
    },
    ungroup(id) {
      edit();
      const b = need(id);
      if (b.node.t !== "group") throw new Error(`body ${id} is not a group`);
      // ungroupBody would drop features other than a resize without a word
      const mods = b.node.mods || [];
      if (mods.length && !(mods.length === 1 && mods[0].t === "scale")) throw new Error("this group has features (fillets, holes...); remove them before ungrouping");
      const out = ungroupBody(id);
      if (!out.length) throw new Error("this group was stretched at an angle, so it cannot be split back into shapes");
      return out;
    },

    // ----------------------------------------------------------- parameters
    params: () => store.doc.params.map((p) => ({ name: p.name, expr: p.expr, value: isFinite(p.value) ? p.value : null, unit: p.unit || "mm" })),
    setParam(name, expr, opts = {}) {
      edit();
      if (typeof name !== "string") throw new Error("name must be a string");
      expr = String(expr).trim();
      if (!expr) throw new Error("expression is empty");
      if (opts.unit !== undefined && opts.unit !== "in" && opts.unit !== "mm") throw new Error('unit must be "mm" or "in"');
      const old = store.doc.params.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!old) { const why = paramNameOk(name, store.doc.params); if (why) throw new Error(why); }
      let value, bad = false;
      store.update((doc) => {
        let p = old && doc.params.find((q) => q.id === old.id);
        if (!p) doc.params.push((p = { id: uid("q"), name, expr, value: NaN }));
        p.expr = expr;
        if (opts.unit === "in") p.unit = "in"; else delete p.unit; // like the sidebar, every edit sets the unit afresh
        applyParams(doc);
        if (!isFinite(p.value)) { bad = true; return false; } // leaves the design and the history untouched
        value = p.value;
      }, old ? "Edit parameter" : "Add parameter");
      if (bad) throw new Error("expression did not evaluate");
      return value;
    },
    removeParam(name) {
      edit();
      const p = store.doc.params.find((q) => typeof name === "string" && q.name.toLowerCase() === name.toLowerCase());
      if (!p) throw new Error("no parameter " + name);
      let n = 0;
      store.update((doc) => { n = removeParam(doc, p.id); }, "Delete parameter");
      return n;
    },
    // tie a plain shape's size (key "w", "d", "h"...) to an expression, or free it with null. Returns the size now.
    bind(id, key, expr) {
      edit();
      const b = need(id);
      if (!isPlain(b)) throw new Error("bind works on plain shapes");
      if (typeof b.node.p[key] !== "number") throw new Error(`${b.node.kind} has no size "${key}"`);
      if (expr !== null) {
        expr = String(expr);
        if (!(evalExpr(expr, exprScope(store.doc)) >= 0.01)) throw new Error(`"${expr}" did not evaluate to a usable size`);
      }
      store.update((doc) => {
        const n = findBody(doc, id).node;
        setExpr(n, key, expr);
        if (n.exprUnits) { delete n.exprUnits[key]; if (!Object.keys(n.exprUnits).length) delete n.exprUnits; } // the script's numbers are mm whatever unit the page shows
      }, expr === null ? "Free size" : "Bind size");
      return findBody(store.doc, id).node.p[key];
    },

    // ----------------------------------------------------------- history, selection, view
    undo: () => history("undo"),
    redo: () => history("redo"),
    select: (ids) => app.select(idList(ids ?? [], true)),
    selection: () => app.sel.slice(),
    fit: () => app.fit(),
    mode: () => app.mode,
    setMode(mode) {
      if (mode !== "beginner" && mode !== "advanced") throw new Error('mode must be "beginner" or "advanced"');
      if (app.mode === mode) return;
      app.setMode(mode);
      if (store.doc.mode !== mode) { store.doc.mode = mode; app.projects.changed(); }
    },
    screenshotDataURL,
    async screenshot(opts = {}) {
      const bin = atob((await screenshotDataURL(opts)).split(",")[1]);
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    },

    // ----------------------------------------------------------- files
    async export(kind, opts = {}) {
      if (kind === "json") return new TextEncoder().encode(JSON.stringify(api.save(), null, 1));
      if (!FILES[kind]) throw new Error('kind must be "stl", "obj", "3mf", "step" or "json"');
      await ready();
      // like the Export menu with nothing selected: every shown solid (named bodies too: holes and hidden ones are left out)
      const bodies = (opts.ids ? idList(opts.ids).map(need) : store.doc.bodies).filter((b) => !b.hole && !b.hidden);
      const failed = bodies.find((b) => app.scene.errors.has(b.id));
      if (failed) throw new Error(`"${failed.name}" has a build error (${app.scene.errors.get(failed.id)}); fix it before exporting`);
      const bytes = bodies.length ? await app.projects[FILES[kind]](bodies) : null;
      if (!bytes) throw new Error("nothing to export: holes and hidden shapes are left out");
      return bytes;
    },
    async load(json, opts = {}) {
      edit();
      let j = json;
      if (typeof j === "string") { try { j = JSON.parse(j); } catch (e) { j = null; } }
      const doc = j && (j.doc || j);
      if (!doc || !Array.isArray(doc.bodies) || !Array.isArray(doc.sketches)) throw new Error("not a JumpStart 3D project");
      // a body without these would break the 3D view for good, so refuse before touching anything
      const bad = doc.bodies.findIndex((b) => !b || typeof b.id !== "string" || !b.node || typeof b.node.t !== "string" || !Array.isArray(b.m) || b.m.length !== 16 || !b.m.every((x) => typeof x === "number" && isFinite(x)));
      if (bad >= 0) throw new Error(`not a JumpStart 3D project: body ${bad} needs an id, a node and a matrix m of 16 numbers`);
      const d = structuredClone(doc);
      if (!opts.keepId) d.id = uid("d");
      // the same steps as opening a project file
      app.select([]);
      if (app.command) app.command.cancel();
      app.exitSketch();
      store.load(d);
      app.projects.saveNow();
      app.vp.setView("home");
      return ready();
    },
    newDesign(mode = "beginner") {
      edit();
      if (mode !== "beginner" && mode !== "advanced") throw new Error('mode must be "beginner" or "advanced"');
      app.projects.newDesign(mode);
      return ready();
    },
  };
  api.delete = api.remove;
  window.JS3D = api;
}
