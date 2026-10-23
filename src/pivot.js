// jumpstart-3d: a movable pivot (issue #100 follow-up). A turn happens about a point: by default the middle of the selection, and
// the white dot there can be dragged to any other point (it snaps to the centres, corners and edge middles of every visible body,
// or to the grid). The pivot is only a point in the world: it is not saved, and changing it adds nothing to Undo.
// Also here: the Pivot X/Y/Z fields, and the live gizmo that follows a selection in Advanced (one click on a body shows it).
import * as THREE from "three";
import { el, round } from "./util.js";
import { store, findBody } from "./store.js";
import { M4, arr } from "./ops.js";
import { pivotOf, turnAbout, axisAlong, ringDrag, turnFeedback, makeGizmo } from "./rotationui.js";

export const DOT_PICK_PX = 22; // half of the 44 px wide zone around the dot
const SNAP_PX = 12, SNAP_TOUCH_PX = 22;
const RANK = { box: 0, face: 1, edge: 2, corner: 3 };
const WHAT = ["Box centre", "Face centre", "Edge middle", "Corner"];

// Escape drops the gesture in progress (and nothing else: the key is not passed on, so the selection stays)
export function onEscape(fn) {
  const h = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); fn(); } };
  window.addEventListener("keydown", h, true);
  return () => window.removeEventListener("keydown", h, true);
}

export function initPivot(app) {
  const vp = app.vp, scene = app.scene;
  // custom: a point the user chose (world coordinates). anchor: the default for several bodies, the union box's middle taken once
  // when they were selected and kept in the first body's own frame, so it stays put when they turn about it. lend: Move / Copy
  // shows its own pose of the pivot while it is open.
  const S = { key: "", custom: null, anchor: null, lend: null };
  const keyOf = (ids) => app.mode + "|" + [...ids].sort().join(",");
  const movable = (ids) => ids.filter((id) => { const v = scene.views.get(id); return v && v.data && v.group.visible && !app.isLocked(id); });
  function sync(ids) { const k = keyOf(ids); if (k !== S.key) { S.key = k; S.custom = null; S.anchor = null; } }
  function auto(ids) {
    if (ids.length === 1) { const b = findBody(store.view, ids[0]); return b ? pivotOf(scene, ids[0], M4(b.m)) : null; }
    if (!S.anchor) {
      const box = new THREE.Box3(), first = [...ids].sort()[0], b = findBody(store.view, first);
      for (const id of ids) { const x = scene.bodyTightBox(id); if (x) box.union(x); }
      if (box.isEmpty() || !b) return null;
      S.anchor = { id: first, local: box.getCenter(new THREE.Vector3()).applyMatrix4(M4(b.m).invert()) };
    }
    const b = findBody(store.view, S.anchor.id);
    return b ? S.anchor.local.clone().applyMatrix4(M4(b.m)) : null;
  }
  // the pivot as stored (ignoring what Move / Copy is showing); null when nothing can turn
  function base(ids0) {
    const ids = movable(ids0);
    sync(ids);
    if (!ids.length) return null;
    return S.custom ? S.custom.clone() : auto(ids);
  }
  // the middle of the selection as it is shown now (several bodies: the union box's middle now, not kept)
  function middle(ids0) {
    const ids = movable(ids0);
    sync(ids);
    if (!ids.length) return null;
    S.anchor = null;
    const p = auto(ids);
    S.anchor = null;
    return p;
  }
  const get = (ids) => (S.lend ? S.lend.get() : base(ids));
  const set = (p) => { if (S.lend) S.lend.set(p); else S.custom = p.clone(); };

  // ------------------------------------------------------------------------------------------ the dot
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]);
  const pt = (color, size, order) => {
    const m = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
    m.renderOrder = order; m.frustumCulled = false;
    return m;
  };
  const dotGroup = new THREE.Group(), markGroup = new THREE.Group();
  dotGroup.add(pt(0x18202a, 17, 60), pt(0xffffff, 12, 61)); // a 12 px white dot with a dark outline
  markGroup.add(pt(0xe8a317, 25, 57), pt(0x18202a, 20, 58)); // a gold ring behind it when it is snapped to something
  dotGroup.visible = markGroup.visible = false;
  dotGroup.userData.pivotDot = true;
  vp.overlay.add(markGroup, dotGroup);
  const tag = vp.addLabel("pivot-tag"), snapTag = vp.addLabel("pivot-snap");
  tag.textContent = "Pivot"; tag.hidden = snapTag.hidden = true;
  const dot = { owner: null, p: new THREE.Vector3(), snap: null };
  // each owner calls this every frame with its point (or null): the dot is drawn for the last one that gave a point
  function show(p, owner) {
    if (!p) { if (dot.owner === owner) { dot.owner = null; dotGroup.visible = false; } return; }
    dot.owner = owner; dot.p.copy(p); dotGroup.visible = true;
    dotGroup.children.forEach((c) => c.position.copy(p));
    vp.request();
  }
  function placeLabels() {
    const on = dotGroup.visible;
    tag.hidden = !on;
    snapTag.hidden = !(on && dot.snap);
    markGroup.visible = on && !!dot.snap;
    if (!on) return;
    const s = vp.project(dot.p);
    tag.style.transform = `translate(${Math.round(s[0] + 12)}px, ${Math.round(s[1] - 22)}px)`;
    if (dot.snap) {
      markGroup.children.forEach((c) => c.position.copy(dot.p));
      snapTag.textContent = dot.snap.text;
      snapTag.style.transform = `translate(${Math.round(s[0] + 14)}px, ${Math.round(s[1] + 12)}px)`;
    }
  }
  vp.labelFns.add(placeLabels);
  // is the pointer within the 44 px zone of the dot this owner is showing?
  function dotAt(e, owner) {
    if (!dotGroup.visible || dot.owner !== owner) return false;
    vp.updateCamera();
    const [mx, my] = vp.local(e), s = vp.project(dot.p);
    return s[2] > -1 && s[2] < 1 && Math.hypot(s[0] - mx, s[1] - my) <= DOT_PICK_PX;
  }

  // ------------------------------------------------------------------------------------------ snapping
  // every visible body's tight box middle, face centres, edge middles and edge ends, in the world (worked out from the meshing
  // result's own faceInfo / edgeInfo, so the geometry engine is not asked anything); kept per geometry and matrix
  function bodyAnchors(id, v) {
    const m = v.group.matrix, name = (findBody(store.view, id) || {}).name || "Body", key = name + "|" + m.elements.join(",");
    if (v._anchors && v._anchors.data === v.data && v._anchors.key === key) return v._anchors.list;
    const list = [], seen = new Map();
    const add = (p, rank) => {
      const k = Math.round(p.x * 1e3) + "," + Math.round(p.y * 1e3) + "," + Math.round(p.z * 1e3), prev = seen.get(k);
      if (prev) { if (rank > prev.rank) { prev.rank = rank; prev.text = WHAT[rank] + " · " + name; } return; }
      const a = { p, rank, text: WHAT[rank] + " · " + name };
      seen.set(k, a); list.push(a);
    };
    const W = (a) => new THREE.Vector3(a[0], a[1], a[2]).applyMatrix4(m);
    const box = scene.boxWithMatrix(id, m);
    if (box) add(box.getCenter(new THREE.Vector3()), RANK.box);
    for (const f of v.data.faceInfo || []) if (f && f.c) add(W(f.c), RANK.face);
    for (const e of v.data.edgeInfo || []) if (e) { if (e.m) add(W(e.m), RANK.edge); if (e.a) add(W(e.a), RANK.corner); if (e.b) add(W(e.b), RANK.corner); }
    v._anchors = { data: v.data, key, list };
    return list;
  }
  function allAnchors() {
    const out = [];
    for (const [id, v] of scene.views) if (v.data && v.group.visible) out.push(...bodyAnchors(id, v));
    return out;
  }

  // ------------------------------------------------------------------------------------------ dragging the dot
  // Free on the camera-facing plane through where it started; then the nearest anchor within 12 px (22 for a finger), else the
  // grid. Only the pivot changes: no geometry, no Undo entry. Returns { move, finish, cancel } or null when the dot was not hit.
  function dotDown(e, owner) {
    if (!dotAt(e, owner)) return null;
    const start = dot.p.clone(), prev = { custom: S.custom && S.custom.clone(), anchor: S.anchor };
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()), start);
    const off = start.clone().sub(vp.rayPlane(e, plane) || start); // pressing beside the dot does not make it jump
    const cands = allAnchors();
    let dead = false;
    const stopEsc = onEscape(() => g.cancel());
    const g = {
      move(ev) {
        if (dead) return;
        const hit = vp.rayPlane(ev, plane);
        if (!hit) return;
        let p = hit.add(off), snap = null;
        if (app.objectSnap) {
          const s0 = vp.project(p), tol = vp.touchMode ? SNAP_TOUCH_PX : SNAP_PX;
          let bd = Infinity;
          for (const c of cands) {
            const s = vp.project(c.p);
            if (s[2] < -1 || s[2] > 1) continue;
            const d = Math.hypot(s[0] - s0[0], s[1] - s0[1]);
            if (d > tol) continue;
            if (!snap || d < bd - 0.5 || (d <= bd + 0.5 && c.rank > snap.rank)) { snap = c; bd = d; }
          }
        }
        if (snap) p = snap.p.clone();
        else { const gs = app.gridStep(); if (gs > 0) p.set(round(p.x, gs), round(p.y, gs), round(p.z, gs)); }
        dot.snap = snap ? { text: snap.text } : null;
        set(p);
        vp.request();
      },
      finish() { stopEsc(); dot.snap = null; vp.request(); },
      cancel() {
        if (dead) return;
        dead = true; stopEsc();
        if (S.lend) S.lend.set(start); else { S.custom = prev.custom; S.anchor = prev.anchor; }
        dot.snap = null; vp.request();
      },
    };
    return g;
  }

  // ------------------------------------------------------------------------------------------ Pivot X/Y/Z fields
  // absolute world coordinates; Enter or leaving a box commits only the pivot. idsFn: the bodies the pivot belongs to.
  function fields(prefix, idsFn) {
    const boxes = ["X", "Y", "Z"].map((ax, i) => {
      const f = app.numField({ value: 0, id: `${prefix}${i}`, len: true, step: Math.max(app.gridStep(), 0.1), onCommit: (v) => {
        const p = get(idsFn());
        if (!p) return;
        p.setComponent(i, v);
        set(p);
        vp.request();
      } });
      f.addEventListener("blur", () => setTimeout(() => { if (f.classList.contains("bad")) { f.classList.remove("bad"); shown = [NaN, NaN, NaN]; sync_(); } }, 0)); // a bad entry goes back to the pivot
      return f;
    });
    const reset = el("button", { class: "btn", id: prefix + "-reset", title: "Put the pivot back in the middle of the selection", onclick: () => { api.reset(idsFn()); vp.request(); } }, "Reset to middle");
    let shown = [NaN, NaN, NaN];
    const sync_ = () => {
      const p = get(idsFn());
      if (!p) return;
      boxes.forEach((f, i) => { const v = p.getComponent(i); if (v !== shown[i] && document.activeElement !== f) { shown[i] = v; f.setValue(v); } });
    };
    const root = el("div", { class: "pivot-fields" },
      el("div", { class: "row3" }, ...boxes.map((f, i) => el("label", {}, "Pivot " + "XYZ"[i], f))), reset);
    return { root, sync: sync_ };
  }

  const api = {
    dot: { show, at: dotAt, get position() { return dot.p; } },
    movable,
    get,
    base,
    // a world point the user (or a field) chose; Move / Copy sets its own through lend
    set,
    setBase(p) { S.custom = p.clone(); },
    // after the selected bodies moved by delta: a chosen pivot goes with them
    shift(delta) { if (S.custom) S.custom.add(delta); },
    isCustom(ids) { sync(movable(ids)); return !!S.custom; },
    // back to the middle of the selection: the body's own middle, or the union box's middle now
    reset(ids) {
      if (S.lend) { const p = middle(ids); if (p) S.lend.set(p); return; }
      sync(movable(ids)); S.custom = null; S.anchor = null;
    },
    // the selection changed (or may have): a different set of bodies starts again from its middle
    selection(ids) { sync(movable(ids)); },
    load() { S.key = ""; S.custom = null; S.anchor = null; },
    lend(h) { S.lend = h; },
    unlend(final) { if (final && S.custom) S.custom = final.clone(); S.lend = null; },
    dotDown,
    fields,
  };
  store.on((kind) => { if (kind === "load") api.load(); });
  return api;
}

// ---------------------------------------------------------------------------------------------- the live gizmo (Advanced)
// One click on a body shows arrows, rings, a pad and the pivot dot at once, without opening Move / Copy. Only pressing a handle
// changes anything: a drag previews and is one Undo step when let go; Escape, a cancelled touch or a second finger drops only
// the drag in progress. host.active(): true while nothing else (a tool, a sketch, a simulation) owns the viewport.
export function liveGizmo(app, host) {
  const vp = app.vp, pv = app.pivot, G = makeGizmo(vp), fb = turnFeedback(vp);
  let hot = null, drag = null, shown = null, panelIds = [];
  const fl = pv.fields("adv-piv", () => panelIds);
  const panel = el("div", { class: "float pivpanel", id: "pivot-panel", hidden: true },
    el("div", { class: "subhead" }, "Pivot"), fl.root,
    el("div", { class: "hint", style: { padding: 0 } }, "Turns happen around this point. Drag the white dot, or type where it goes."));
  host.parent.append(panel);

  function frame() {
    const list = host.active() ? pv.movable(app.sel) : [];
    const p = list.length ? (drag && drag.pos ? drag.pos() : pv.get(list)) : null;
    shown = p ? { ids: list, p } : null;
    G.group.visible = !!p;
    if (p) G.place(p, "all", drag ? drag.part : hot);
    pv.dot.show(p, "live");
    // the pivot fields stay while Move / Copy is open (it lends its own pose of the pivot)
    const cmdIds = app.command && app.command.pivotIds ? app.command.pivotIds() : null;
    panelIds = shown ? shown.ids : cmdIds || [];
    panel.hidden = !panelIds.length || !host.design();
    if (!panel.hidden) fl.sync();
  }
  vp.afterRender.add(frame);
  const baseOf = (ids) => new Map(ids.map((id) => [id, findBody(store.doc, id).m]));
  const preview = (ids, base, T) => store.setPreview((doc) => { for (const id of ids) { const b = findBody(doc, id); if (b) b.m = arr(M4(base.get(id)).premultiply(T)); } });
  const end = () => { drag = null; vp.canvas.style.cursor = "default"; vp.request(); };

  function startPart(e, part) {
    const ids = shown.ids, p0 = shown.p.clone(), base = baseOf(ids);
    let dead = false;
    const stopEsc = onEscape(() => d.cancel());
    const d = { part, pos: null, deg: 0, delta: new THREE.Vector3(), cancel() { if (dead) return; dead = true; stopEsc(); store.setPreview(null); fb.hide(); end(); }, finish() {}, move() {} };
    if (part.userData.ring) {
      const axis = part.userData.dir.clone(), turn = ringDrag(vp, e, p0, axis), orbit = new THREE.Box3();
      for (const id of ids) { const b = app.scene.bodyTightBox(id); if (b) orbit.union(b); }
      fb.show(p0, axis, orbit.isEmpty() ? p0 : orbit.getCenter(new THREE.Vector3()));
      d.pos = () => p0;
      d.move = (ev) => { d.deg = turn(ev); fb.angle(d.deg, ev); preview(ids, base, turnAbout(p0, axis, d.deg)); };
      d.finish = () => { fb.hide(); if (d.deg) store.commitPreview(`Rotate ${d.deg}°`); else store.setPreview(null); };
    } else {
      const free = part.userData.axis === "free", dir = free ? null : part.userData.dir.clone(), g = app.gridStep();
      const plane = free ? new THREE.Plane().setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()), p0) : null;
      const q0 = free ? vp.rayPlane(e, plane) : null, s0 = free ? 0 : axisAlong(vp, e, p0, dir) || 0;
      const boxes = new Map(ids.map((id) => [id, app.scene.boxWithMatrix(id, M4(base.get(id)))]));
      d.pos = () => p0.clone().add(d.delta);
      d.move = (ev) => {
        let delta;
        if (free) {
          const q = vp.rayPlane(ev, plane);
          if (!q || !q0) return;
          delta = q.sub(q0);
          if (g > 0) delta.set(round(delta.x, g), round(delta.y, g), round(delta.z, g));
          delta = app.snapToObjects(ids, boxes, delta, ["x", "y", "z"]).delta;
        } else {
          const s = axisAlong(vp, ev, p0, dir);
          if (s == null) return;
          delta = dir.clone().multiplyScalar(round(s - s0, g));
        }
        d.delta = delta;
        preview(ids, base, new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z));
      };
      d.finish = () => { app.clearSnapGuides(); if (d.delta.lengthSq() > 0) { pv.shift(d.delta); store.commitPreview("Move"); } else store.setPreview(null); };
    }
    d.up = () => { if (dead) return; dead = true; stopEsc(); d.finish(); end(); };
    drag = d;
    vp.canvas.style.cursor = "grabbing";
    return d;
  }

  const live = {
    panel,
    // is something of the gizmo (the dot or a handle) under the pointer?
    pick(e) {
      frame();
      if (!shown) return null;
      return pv.dot.at(e, "live") ? "dot" : G.pick(e);
    },
    hover(e) {
      if (drag) return true;
      const h = live.pick(e);
      const part = h && h !== "dot" ? h : null;
      if (part !== hot) { hot = part; vp.request(); }
      if (h) vp.canvas.style.cursor = "grab";
      return !!h;
    },
    // a press on the dot or a handle: true when it was one (the body under it is not picked)
    down(e) {
      const h = live.pick(e);
      if (!h) return false;
      if (h === "dot") {
        const g = pv.dotDown(e, "live");
        drag = { part: null, move: g.move, up: () => { g.finish(); end(); }, cancel: () => { g.cancel(); end(); } };
        return true;
      }
      startPart(e, h);
      return true;
    },
    move(e) { if (drag) drag.move(e); },
    up(e) { if (!drag) return; if (e && e.type === "pointercancel") drag.cancel(); else drag.up(e); },
    cancel() { if (drag) drag.cancel(); },
    get dragging() { return !!drag; },
    dispose() { vp.afterRender.delete(frame); G.dispose(); fb.dispose(); panel.remove(); pv.dot.show(null, "live"); },
  };
  return live;
}
