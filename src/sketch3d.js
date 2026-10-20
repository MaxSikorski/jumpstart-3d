// 3D Sketch: draw lines in 3D, on a body's surface, on a virtual shape (a cube,
// a sphere or an elongated sphere used as a 360° drawing surface) or in the air.
//
// The screen splits in two. The left half is the camera: drag to turn it, pinch (or scroll) to
// zoom, two fingers to slide. The right half is the drawing view from that camera: draw there
// with a finger, a pen, a mouse or a trackpad. Both work at the same time, so one hand can turn
// the view while the other draws.
//
// Strokes are freehand, or "nodes" (tap points; a smooth curve runs through them). When done,
// every stroke becomes a solid round tube body (a Pipe along a smooth 3D curve, with rounded
// ends), so Advanced and Beginner can move, combine, split and slice it like any other part.
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { el, uid, nextColor, fmt } from "./util.js";
import { nextName } from "./ops.js";
import { withUnit } from "./units.js";

const BASES = {
  none: { label: "Nothing (draw in the air)" },
  body: { label: "A body in my design" },
  cube: { label: "Virtual cube", p: { w: 60, d: 60, h: 60 } },
  sphere: { label: "Virtual sphere", p: { w: 60, d: 60, h: 60 } },
  egg: { label: "Elongated sphere", p: { w: 40, d: 40, h: 80 } },
};
const COLORS = ["#e4572e", "#f3a712", "#29a35a", "#2b7bb9", "#7b4fa8", "#d14d8b", "#1aa6a6", "#1f2633"];

export function initSketch3D(app) {
  let ui = null; // everything while the studio is open
  const LS = "jumpstart3d.s3d.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  // ------------------------------------------------------------------ opening
  function open() {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    if (app.sketcher && app.sketcher.active) app.exitSketch();
    const from = app.mode === "chisel" ? "advanced" : app.mode;
    const sel = (app.sel || []).filter((id) => findBody(store.doc, id) && !findBody(store.doc, id).hidden);
    const st = {
      from,
      base: sel.length ? "body" : pref("base", "sphere"), bodyId: sel[0] || null,
      bp: JSON.parse(JSON.stringify(pref("bp", { cube: BASES.cube.p, sphere: BASES.sphere.p, egg: BASES.egg.p }))),
      mode: pref("mode", "free"), on: pref("on", "surface"),
      size: pref("size", 3), color: pref("color", COLORS[3]), smooth: pref("smooth", 4), roundEnds: pref("roundEnds2", false),
      join: false, keepBase: false,
      strokes: [], undo: [], redo: [], nodes: null, // nodes: the curve being placed in node mode
    };
    buildUI(st);
    chooseBase(true);
  }

  // ------------------------------------------------------------------ the screen
  function buildUI(st) {
    const root = el("div", { class: "s3d", id: "s3d", role: "dialog", "aria-label": "3D Sketch" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "s3d-canvas" });
    const labL = el("div", { class: "s3d-lab l" }, el("b", {}, "Camera"), el("span", {}, "Drag to turn · pinch or scroll to zoom · two fingers to slide"));
    const labR = el("div", { class: "s3d-lab r" }, el("b", {}, "Draw"), el("span", { id: "s3d-hint" }, ""));
    const divider = el("div", { class: "s3d-div" });
    panes.append(canvas, labL, labR, divider);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setScissorTest(true);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(1, -1.5, 2.5); scene.add(sun);
    const grid = new THREE.GridHelper(400, 40, 0xb7c3d3, 0xd5dde8); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const camL = new THREE.PerspectiveCamera(40, 1, 0.5, 20000), camR = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
    camL.up.set(0, 0, 1); camR.up.set(0, 0, 1);
    const baseGroup = new THREE.Group(), strokeGroup = new THREE.Group(), liveGroup = new THREE.Group();
    scene.add(baseGroup, strokeGroup, liveGroup);
    // the drawing camera; the left pane looks the same way from further back, so you see the
    // whole object and where you are
    const view = { az: -Math.PI / 3, el: 0.55, dist: 220, target: new THREE.Vector3(0, 0, 30) };

    ui = { st, root, bar, panes, canvas, renderer, scene, camL, camR, view, baseGroup, strokeGroup, liveGroup, pickMeshes: [], dirty: true, raf: 0, pointers: new Map(), draw: null, gesture: null, split: 0.42, overview: 1.7 };
    renderBar();
    const ro = new ResizeObserver(() => { resize(); });
    ro.observe(panes); ui.ro = ro;
    resize();
    bindPointers();
    ui.onKey = (e) => onKey(e);
    addEventListener("keydown", ui.onKey, true);
    loop();
  }
  function resize() {
    if (!ui) return;
    const r = ui.panes.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    const xl = Math.round(r.width * ui.split);
    ui.xl = xl;
    ui.root.style.setProperty("--split", xl + "px");
    ui.camL.aspect = xl / Math.max(1, r.height); ui.camL.updateProjectionMatrix();
    ui.camR.aspect = (r.width - xl) / Math.max(1, r.height); ui.camR.updateProjectionMatrix();
    ui.dirty = true;
  }
  function placeCameras() {
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.camR.position.copy(v.target).addScaledVector(dir, v.dist); ui.camR.lookAt(v.target);
    const dl = Math.max(v.dist, ui.fitDist || v.dist) * ui.overview;
    ui.camL.position.copy(v.target).addScaledVector(dir, dl); ui.camL.lookAt(v.target);
  }
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    if (!ui.dirty) return;
    ui.dirty = false;
    placeCameras();
    const r = ui.renderer, W = ui.w, H = ui.h, xl = ui.xl;
    r.setViewport(0, 0, xl, H); r.setScissor(0, 0, xl, H); r.render(ui.scene, ui.camL);
    r.setViewport(xl, 0, W - xl, H); r.setScissor(xl, 0, W - xl, H); r.render(ui.scene, ui.camR);
  }
  const req = () => { if (ui) ui.dirty = true; };

  // ------------------------------------------------------------------ the toolbar
  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), title: t || "", onclick: () => on(v) }, l)));
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const sizeField = app.numField({ value: st.size, id: "s3d-size", min: 0.4, max: 40, step: 0.5, len: true, onCommit: (v) => { st.size = v; setPref("size", v); req(); } });
    const colors = el("div", { class: "s3d-colors", id: "s3d-colors" }, ...COLORS.map((c) => el("button", { class: "s3d-col" + (c === st.color ? " on" : ""), style: { background: c }, "aria-label": "Color " + c, onclick: () => { st.color = c; setPref("color", c); renderBar(); } })));
    const smooth = el("input", { type: "range", min: 0, max: 10, step: 1, value: st.smooth, id: "s3d-smooth", "aria-label": "Smoothing", oninput: (e) => { st.smooth = +e.target.value; setPref("smooth", st.smooth); } });
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "3D Sketch")),
      grp("Draw on", el("button", { class: "btn", id: "s3d-base", onclick: () => chooseBase(false), title: "Change what you draw on" }, baseName())),
      grp("Line", seg("s3d-mode", [["free", "Freehand", "Draw with one continuous motion"], ["nodes", "Nodes", "Tap points; a smooth curve runs through them"]], st.mode, (v) => { finishNodes(); st.mode = v; setPref("mode", v); renderBar(); hint(); })),
      grp("Place", seg("s3d-on", [["surface", "On surface", "The line follows the shape's surface"], ["air", "In the air", "The line stays on a flat sheet facing you, through where you start"]], st.on, (v) => { st.on = v; setPref("on", v); renderBar(); hint(); })),
      grp("Thickness", sizeField),
      grp("Color", colors),
      grp("Smoothing", smooth),
      el("label", { class: "check s3d-chk" }, el("input", { type: "checkbox", id: "s3d-round", checked: st.roundEnds, onchange: (e) => { st.roundEnds = e.target.checked; setPref("roundEnds2", st.roundEnds); } }), "Round ends (slower to build)"),
      st.mode === "nodes" ? grp("", el("button", { class: "btn", id: "s3d-node-done", onclick: () => finishNodes(), disabled: !(st.nodes && st.nodes.length > 1) }, "Finish curve"), el("button", { class: "btn", id: "s3d-node-close", onclick: () => finishNodes(true), disabled: !(st.nodes && st.nodes.length > 2) }, "Close loop")) : "",
      el("span", { class: "s3d-sp" }),
      grp("", el("button", { class: "btn", id: "s3d-undo", title: "Undo (Ctrl+Z)", disabled: !st.undo.length && !(st.nodes && st.nodes.length), onclick: undo }, "↶ Undo"), el("button", { class: "btn", id: "s3d-redo", title: "Redo (Ctrl+Y)", disabled: !st.redo.length, onclick: redo }, "↷ Redo")),
      grp("", el("button", { class: "btn", id: "s3d-cancel", onclick: () => close(false) }, "Cancel"), el("button", { class: "btn primary", id: "s3d-done", disabled: !st.strokes.length, onclick: () => finishAll() }, `Done (${st.strokes.length})`)),
    );
    hint();
  }
  function hint() {
    const h = document.getElementById("s3d-hint"); if (!h) return;
    const st = ui.st;
    h.textContent = st.mode === "nodes" ? "Tap to place points · Enter or Finish curve when done · Backspace removes the last point" : "Draw with a finger, pen or mouse · right-drag or two fingers here also turn the view";
  }
  const baseName = () => { const st = ui.st; if (st.base === "body") { const b = findBody(store.doc, st.bodyId); return b ? b.name : "A body"; } return BASES[st.base].label; };

  // ------------------------------------------------------------------ what to draw on
  function chooseBase(first) {
    const st = ui.st;
    const bodies = store.doc.bodies.filter((b) => !b.hidden && app.scene.views.get(b.id) && app.scene.views.get(b.id).data);
    const back = el("div", { class: "s3d-modal-back" });
    const sizeRow = (k) => {
      const p = st.bp[k];
      const f = (key, lab) => el("label", {}, lab, app.numField({ value: p[key], id: `s3d-${k}-${key}`, min: 1, step: 5, len: true, onCommit: (v) => { p[key] = v; if (k !== "egg" && key === "w") { p.d = v; p.h = v; } } }));
      return k === "egg" ? el("div", { class: "row3" }, f("w", "Width"), f("d", "Depth"), f("h", "Height")) : el("div", { class: "row3" }, f("w", k === "cube" ? "Size" : "Diameter"));
    };
    let pick = st.base === "body" && !bodies.some((b) => b.id === st.bodyId) ? (bodies.length ? "body" : "sphere") : st.base;
    let bodyId = st.bodyId || (bodies[0] && bodies[0].id);
    const card = el("div", { class: "s3d-modal", role: "dialog", "aria-label": "Draw on" });
    const render = () => {
      card.innerHTML = "";
      card.append(el("h3", {}, "What do you want to draw on?"),
        el("p", { class: "hint", style: { padding: 0 } }, "Lines can wrap around a shape in any direction. A virtual shape is only a drawing surface: it isn't added to your design unless you ask for it at the end."));
      const opts = el("div", { class: "s3d-bases" });
      for (const k of ["body", "sphere", "egg", "cube", "none"]) {
        if (k === "body" && !bodies.length) continue;
        opts.append(el("label", { class: "s3d-base-opt" + (pick === k ? " on" : "") },
          el("input", { type: "radio", name: "s3d-base", value: k, checked: pick === k, onchange: () => { pick = k; render(); } }),
          el("span", {}, BASES[k].label)));
      }
      card.append(opts);
      if (pick === "body") {
        const s = el("select", { class: "num", id: "s3d-body", onchange: (e) => { bodyId = e.target.value; } }, ...bodies.map((b) => el("option", { value: b.id, selected: b.id === bodyId }, b.name)));
        card.append(el("div", { class: "row" }, el("span", {}, "Body"), s));
      } else if (pick !== "none") card.append(sizeRow(pick));
      card.append(el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => { back.remove(); if (first) close(false, true); } }, first ? "Cancel" : "Keep the current one"),
        el("button", { class: "btn primary", id: "s3d-start", onclick: () => {
          st.base = pick; st.bodyId = pick === "body" ? bodyId : null;
          if (pick !== "body") setPref("base", pick);
          setPref("bp", st.bp);
          back.remove(); setBase(); renderBar();
        } }, first ? "Start drawing" : "Use this")));
    };
    render();
    back.append(card);
    ui.root.append(back);
  }
  function setBase() {
    const st = ui.st;
    for (const c of [...ui.baseGroup.children]) { ui.baseGroup.remove(c); c.geometry && c.geometry.dispose(); }
    ui.pickMeshes = [];
    const box = new THREE.Box3();
    const addMesh = (geo, matrix, solid) => {
      const mat = new THREE.MeshStandardMaterial({ color: solid ? 0xb9c4d2 : 0xa9c2e6, roughness: 0.7, metalness: 0, transparent: !solid, opacity: solid ? 1 : 0.45, side: THREE.DoubleSide, depthWrite: !!solid, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = false; m.matrix.copy(matrix); m.updateMatrixWorld(true);
      ui.baseGroup.add(m); ui.pickMeshes.push(m);
      if (!solid) { const w = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x5b7fb5, transparent: true, opacity: 0.25 })); w.matrixAutoUpdate = false; w.matrix.copy(matrix); ui.baseGroup.add(w); }
      geo.computeBoundingBox(); box.union(geo.boundingBox.clone().applyMatrix4(matrix));
    };
    if (st.base === "body") {
      const v = app.scene.views.get(st.bodyId), b = findBody(store.doc, st.bodyId);
      if (v && v.data && b) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(v.data.vertices, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(v.data.normals, 3));
        g.setIndex(new THREE.BufferAttribute(v.data.triangles, 1));
        addMesh(g, new THREE.Matrix4().fromArray(b.m), true);
      }
    } else if (st.base !== "none") {
      const p = st.bp[st.base];
      const g = st.base === "cube" ? new THREE.BoxGeometry(p.w, p.w, p.w, 6, 6, 6) : new THREE.SphereGeometry(0.5, 48, 32);
      const h = st.base === "cube" ? p.w : st.base === "sphere" ? p.w : p.h;
      const sc = st.base === "cube" ? new THREE.Matrix4() : new THREE.Matrix4().makeScale(p.w, st.base === "sphere" ? p.w : p.d, h);
      addMesh(g, new THREE.Matrix4().makeTranslation(0, 0, h / 2).multiply(sc), false);
    }
    // frame it
    const target = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
    const r = box.isEmpty() ? 60 : Math.max(10, box.getSize(new THREE.Vector3()).length() / 2);
    ui.view.target.copy(target);
    ui.fitDist = (r / Math.sin((40 * Math.PI) / 360)) * 1.1;
    ui.view.dist = ui.fitDist;
    ui.baseBox = box;
    req();
  }

  // ------------------------------------------------------------------ pointer handling
  function paneOf(x) { return x < ui.xl ? "L" : "R"; }
  function local(e) { const r = ui.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (!ui) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const [x, y] = local(e), pane = paneOf(x);
      const info = { id: e.pointerId, pane, x, y, x0: x, y0: y, type: e.pointerType, button: e.button };
      ui.pointers.set(e.pointerId, info);
      if (pane === "R" && e.pointerType !== "mouse" || pane === "R" && e.button === 0 && !e.altKey) {
        // a second finger on the drawing side turns it into a camera gesture
        const fingersR = [...ui.pointers.values()].filter((p) => p.pane === "R" && p.type === "touch");
        if (e.pointerType === "touch" && fingersR.length > 1) {
          if (ui.draw && ui.draw.pointer !== e.pointerId && ui.draw.type === "touch") cancelStroke();
          info.gesture = true; for (const p of fingersR) p.gesture = true;
          return;
        }
        if (!ui.draw) { info.drawing = true; startStroke(e, info); }
        return;
      }
      info.gesture = true;
    });
    c.addEventListener("pointermove", (e) => {
      if (!ui) return;
      const info = ui.pointers.get(e.pointerId);
      const [x, y] = local(e);
      if (!info) return;
      const dx = x - info.x, dy = y - info.y;
      info.x = x; info.y = y;
      if (info.drawing && ui.draw && ui.draw.pointer === e.pointerId) {
        let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        if (!evs || !evs.length) evs = [e];
        for (const ev of evs) moveStroke(local(ev));
        return;
      }
      if (!info.gesture) return;
      const same = [...ui.pointers.values()].filter((p) => p.gesture && p.pane === info.pane);
      if (same.length >= 2) {
        // pinch zoom + two-finger slide, from the two fingers' middle and spread
        const [a, b] = same;
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2], spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.gesture && ui.gesture.ids === a.id + ":" + b.id) {
          const g = ui.gesture;
          if (g.spread > 4 && spread > 4) ui.view.dist = Math.max(5, Math.min(5000, ui.view.dist * (g.spread / spread)));
          pan(mid[0] - g.mid[0], mid[1] - g.mid[1], info.pane);
        }
        ui.gesture = { ids: a.id + ":" + b.id, mid, spread };
        req();
        return;
      }
      if (info.type === "mouse" && (info.button === 1 || (info.button === 2 && e.shiftKey))) pan(dx, dy, info.pane);
      else orbit(dx, dy);
      req();
    });
    const up = (e) => {
      if (!ui) return;
      const info = ui.pointers.get(e.pointerId);
      ui.pointers.delete(e.pointerId);
      if (ui.gesture && !([...ui.pointers.values()].filter((p) => p.gesture).length >= 2)) ui.gesture = null;
      if (info && info.drawing && ui.draw && ui.draw.pointer === e.pointerId) { e.type === "pointercancel" ? cancelStroke() : endStroke(); }
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) > 0 && !e.shiftKey) ui.view.dist = Math.max(5, Math.min(5000, ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      req();
    }, { passive: false });
  }
  function orbit(dx, dy) {
    const v = ui.view;
    v.az -= dx * 0.008;
    v.el = Math.max(-1.52, Math.min(1.52, v.el + dy * 0.008));
  }
  function pan(dx, dy, pane) {
    const cam = pane === "L" ? ui.camL : ui.camR;
    const d = cam.position.distanceTo(ui.view.target);
    const k = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / ui.h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    ui.view.target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
  }

  // ------------------------------------------------------------------ turning a screen point into 3D
  const ray = new THREE.Raycaster();
  function rayAt([x, y]) {
    const xr = x - ui.xl, wr = ui.w - ui.xl;
    ray.setFromCamera(new THREE.Vector2((xr / wr) * 2 - 1, -(y / ui.h) * 2 + 1), ui.camR);
    return ray;
  }
  // a surface hit: the point lifted off the surface so the tube sits on it (a little sunk in,
  // so it fuses to the shape when joined)
  function surfaceHit(p) {
    const r = rayAt(p);
    const hits = r.intersectObjects(ui.pickMeshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : r.ray.direction.clone().negate();
    if (n.dot(r.ray.direction) > 0) n.negate();
    return { p: h.point.clone().addScaledVector(n, ui.st.size * 0.4), raw: h.point.clone(), n };
  }
  // an air point: on a sheet facing the camera, through the anchor
  function airHit(p, anchor) {
    const r = rayAt(p);
    const n = ui.camR.getWorldDirection(new THREE.Vector3());
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, anchor);
    const q = new THREE.Vector3();
    return r.ray.intersectPlane(pl, q) ? { p: q } : null;
  }
  function point3(p, stroke) {
    const st = ui.st;
    if (st.on === "surface" && ui.pickMeshes.length) return surfaceHit(p);
    if (!stroke.anchor) {
      const s = ui.pickMeshes.length ? surfaceHit(p) : null;
      stroke.anchor = s ? s.raw.clone() : (ui.baseBox && !ui.baseBox.isEmpty() ? ui.baseBox.getCenter(new THREE.Vector3()) : ui.view.target.clone());
    }
    return airHit(p, stroke.anchor);
  }

  // ------------------------------------------------------------------ strokes
  function startStroke(e, info) {
    const st = ui.st;
    if (st.mode === "nodes") {
      // node mode: a tap adds a point to the curve being built
      ui.draw = { pointer: e.pointerId, type: e.pointerType, tap: true, x0: info.x, y0: info.y };
      return;
    }
    ui.draw = { pointer: e.pointerId, type: e.pointerType, raw: [], anchor: null };
    moveStroke([info.x, info.y]);
  }
  function moveStroke(p) {
    const d = ui.draw;
    if (!d || d.tap) return;
    const h = point3(p, d);
    if (!h) return;
    const last = d.raw[d.raw.length - 1];
    if (last && last.distanceTo(h.p) < Math.max(0.15, ui.st.size * 0.15)) return;
    d.raw.push(h.p);
    showLive(d.raw);
  }
  function endStroke() {
    const d = ui.draw; ui.draw = null;
    const st = ui.st;
    if (!d) return;
    if (d.tap) {
      const info = { x: d.x0, y: d.y0 };
      const h = point3([info.x, info.y], st.nodes ? st.nodesStroke : (st.nodesStroke = { anchor: null }));
      if (!h) return;
      if (!st.nodes) { st.nodes = []; }
      st.nodes.push(h.p.toArray());
      st.redo = [];
      showNodes(); renderBar();
      return;
    }
    clearLive();
    if (d.raw.length < 2) { req(); return; }
    let pts = processStroke(d.raw.map((v) => v.toArray()), st.smooth);
    if (pts.length < 2) return;
    // a stroke that ends where it began closes up
    const closed = pts.length > 6 && dist(pts[0], pts[pts.length - 1]) < Math.max(st.size * 2, 3);
    if (closed) pts = pts.slice(0, -1);
    addStroke({ pts, size: st.size, color: st.color, closed, roundEnds: st.roundEnds });
  }
  function cancelStroke() { ui.draw = null; clearLive(); }
  function finishNodes(closeIt = false) {
    const st = ui.st;
    if (!st.nodes) return;
    const pts = st.nodes;
    st.nodes = null; st.nodesStroke = null;
    clearLive();
    if (pts.length >= 2) addStroke({ pts: pts.map((q) => q.slice()), size: st.size, color: st.color, closed: closeIt && pts.length > 2, roundEnds: st.roundEnds, nodes: true });
    else renderBar();
  }
  function addStroke(s) {
    const st = ui.st;
    st.undo.push(JSON.stringify(st.strokes));
    st.redo = [];
    st.strokes.push(s);
    redrawStrokes(); renderBar();
  }
  function undo() {
    const st = ui.st;
    if (st.nodes && st.nodes.length) { st.nodes.pop(); if (!st.nodes.length) st.nodes = null; showNodes(); renderBar(); return; }
    if (!st.undo.length) return;
    st.redo.push(JSON.stringify(st.strokes));
    st.strokes = JSON.parse(st.undo.pop());
    redrawStrokes(); renderBar();
  }
  function redo() {
    const st = ui.st;
    if (!st.redo.length) return;
    st.undo.push(JSON.stringify(st.strokes));
    st.strokes = JSON.parse(st.redo.pop());
    redrawStrokes(); renderBar();
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // even spacing, then smoothing (ends stay put), then fewer points where the line is straight
  function processStroke(raw, smooth) {
    const size = ui.st.size;
    let L = 0; for (let i = 1; i < raw.length; i++) L += dist(raw[i - 1], raw[i]);
    const step = Math.max(size * 0.6, 0.6, L / 160);
    const out = [raw[0].slice()];
    let acc = 0;
    for (let i = 1; i < raw.length; i++) {
      let a = raw[i - 1], b = raw[i], seg = dist(a, b);
      while (acc + seg >= step) {
        const t = (step - acc) / seg;
        const q = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
        out.push(q); a = q; seg = dist(a, b); acc = 0;
      }
      acc += seg;
    }
    if (dist(out[out.length - 1], raw[raw.length - 1]) > step * 0.3) out.push(raw[raw.length - 1].slice());
    let p = out;
    for (let it = 0; it < smooth * 2; it++) {
      const q = p.map((v) => v.slice());
      for (let i = 1; i < p.length - 1; i++) for (let k = 0; k < 3; k++) q[i][k] = p[i][k] * 0.5 + (p[i - 1][k] + p[i + 1][k]) * 0.25;
      p = q;
    }
    return simplify(p, Math.max(0.05, size * 0.08));
  }
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bd = 0;
      const A = new THREE.Vector3(...pts[a]), B = new THREE.Vector3(...pts[b]), line = new THREE.Line3(A, B), c = new THREE.Vector3();
      for (let i = a + 1; i < b; i++) { line.closestPointToPoint(new THREE.Vector3(...pts[i]), true, c); const d = c.distanceTo(new THREE.Vector3(...pts[i])); if (d > bd) { bd = d; best = i; } }
      if (best > 0 && bd > tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // ------------------------------------------------------------------ showing strokes
  const curveOf = (pts, closed) => new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), !!closed, "centripetal");
  function tubeMesh(pts, size, color, closed) {
    if (pts.length < 2) return null;
    const curve = curveOf(pts, closed);
    const g = new THREE.TubeGeometry(curve, Math.min(800, Math.max(8, pts.length * 6)), size / 2, 12, !!closed);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }));
  }
  function capMesh(p, size, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 16, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    m.position.set(...p); return m;
  }
  function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose && c.material.dispose(); } }
  function redrawStrokes() {
    clearGroup(ui.strokeGroup);
    for (const s of ui.st.strokes) {
      const t = tubeMesh(s.pts, s.size, s.color, s.closed); if (t) ui.strokeGroup.add(t);
      if (s.roundEnds && !s.closed) { ui.strokeGroup.add(capMesh(s.pts[0], s.size, s.color), capMesh(s.pts[s.pts.length - 1], s.size, s.color)); }
    }
    req();
  }
  function clearLive() { clearGroup(ui.liveGroup); req(); }
  let liveT = 0;
  function showLive(vecs) {
    const now = performance.now();
    if (now - liveT < 30 && vecs.length > 2) return;
    liveT = now;
    clearGroup(ui.liveGroup);
    const t = tubeMesh(vecs.map((v) => v.toArray()), ui.st.size, ui.st.color, false); if (t) ui.liveGroup.add(t);
    req();
  }
  function showNodes() {
    clearGroup(ui.liveGroup);
    const st = ui.st;
    if (st.nodes) {
      for (const q of st.nodes) { const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(st.size * 0.8, 1.2), 14, 10), new THREE.MeshBasicMaterial({ color: 0xffc23d, depthTest: false })); m.renderOrder = 20; m.position.set(...q); ui.liveGroup.add(m); }
      if (st.nodes.length > 1) { const t = tubeMesh(st.nodes, st.size, st.color, false); if (t) { t.material.transparent = true; t.material.opacity = 0.75; ui.liveGroup.add(t); } }
    }
    req();
  }

  // ------------------------------------------------------------------ keys
  function onKey(e) {
    if (!ui) return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    let done = true;
    if (mod && k === "z" && !e.shiftKey) undo();
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) redo();
    else if (e.key === "Enter" && ui.st.nodes) finishNodes();
    else if (e.key === "Backspace" && ui.st.nodes) undo();
    else if (e.key === "Escape") { const m = ui.root.querySelector(".s3d-leave"); if (m) m.remove(); else if (ui.st.nodes) { ui.st.nodes = null; showNodes(); renderBar(); } else close(false); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
    else e.stopPropagation(); // the main app's shortcuts are off while 3D Sketch is open
  }

  // ------------------------------------------------------------------ finishing
  // a smooth curve through the points, as cubic Bezier spans (Catmull-Rom, centripetal)
  function bezSpans(pts, closed) {
    const P = pts.map((q) => new THREE.Vector3(...q));
    const n = P.length, spans = [];
    const at = (i) => closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const b1 = p1.clone().add(p2.clone().sub(p0).multiplyScalar(1 / 6));
      const b2 = p2.clone().sub(p3.clone().sub(p1).multiplyScalar(1 / 6));
      spans.push([p1.toArray(), b1.toArray(), b2.toArray(), p2.toArray()].map((v) => v.map((x) => +x.toFixed(4))));
    }
    return spans;
  }
  // the line's path: points along the same smooth (centripetal) curve the preview shows, which the
  // geometry engine fits with one B-spline
  function pathPoints(s) {
    const curve = curveOf(s.pts, s.closed);
    const L = curve.getLength();
    const n = Math.max(8, Math.min(240, Math.round(L / Math.max(0.5, s.size * 0.7))));
    const out = [];
    for (let i = 0; i <= n; i++) { const q = curve.getPointAt(Math.min(1, i / n)); out.push([+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)]); }
    return out;
  }
  function strokeNode(s) {
    const pts = pathPoints(s);
    const pipe = { t: "pipe", section: "circle", size: +s.size.toFixed(3), edgeSegs: [{ t: "bsp", a: pts[0], b: pts[pts.length - 1], pts }], mods: [] };
    if (!s.roundEnds || s.closed) return pipe;
    const ball = (p) => ({ node: { t: "prim", kind: "sphere", p: { w: s.size, d: s.size, h: s.size }, mods: [] }, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2] - s.size / 2, 1] });
    return { t: "group", children: [{ node: pipe, m: IDENTITY.slice() }, ball(s.pts[0]), ball(s.pts[s.pts.length - 1])], mods: [] };
  }
  function finishAll() {
    const st = ui.st;
    finishNodes();
    if (!st.strokes.length) { close(false); return; }
    const back = el("div", { class: "s3d-modal-back" });
    const isVirtual = st.base !== "body" && st.base !== "none";
    const card = el("div", { class: "s3d-modal" },
      el("h3", {}, `Add ${st.strokes.length} line${st.strokes.length > 1 ? "s" : ""} to your design`),
      el("p", { class: "hint", style: { padding: 0 } }, "Each line becomes a solid tube you can move, combine, split or slice in Beginner and Advanced."),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "s3d-join", checked: st.join, onchange: (e) => { st.join = e.target.checked; } }), "Join all the lines into one body"),
      isVirtual ? el("label", { class: "check" }, el("input", { type: "checkbox", id: "s3d-keep", checked: st.keepBase, onchange: (e) => { st.keepBase = e.target.checked; } }), `Also add the ${BASES[st.base].label.toLowerCase()} as a body`) : null,
      el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => back.remove() }, "Keep drawing"),
        el("button", { class: "btn primary", id: "s3d-add", onclick: () => { back.remove(); commit(); } }, "Add to design")));
    back.append(card); ui.root.append(back);
  }
  function commit() {
    const st = ui.st, ids = [];
    store.update((doc) => {
      const mk = (node, name, color) => { const b = { id: uid("b"), name: nextName(doc, name), seq: nextSeq(doc), color, hole: false, hidden: false, m: IDENTITY.slice(), node }; doc.bodies.push(b); ids.push(b.id); return b; };
      if (st.join && st.strokes.length > 1) mk({ t: "group", children: st.strokes.map((s) => ({ node: strokeNode(s), m: IDENTITY.slice(), hole: false, color: s.color })), mods: [] }, "3D sketch", st.strokes[0].color);
      else for (const s of st.strokes) mk(strokeNode(s), "3D line", s.color);
      if (st.keepBase && st.base !== "body" && st.base !== "none") {
        const p = st.bp[st.base], kind = st.base === "cube" ? "box" : "sphere";
        const w = p.w, d = st.base === "egg" ? p.d : p.w, h = st.base === "egg" ? p.h : p.w;
        mk({ t: "prim", kind, p: kind === "box" ? { w, d, h, r: 0, c: 0 } : { w, d, h }, mods: [] }, st.base === "cube" ? "Box" : "Sphere", nextColor());
      }
    }, "3D Sketch");
    const n = st.strokes.length;
    close(true);
    app.select && app.select(ids);
    app.toast(`Added ${n} 3D line${n > 1 ? "s" : ""}. They take a moment to build.`);
  }
  // Cancel with lines drawn: add them, keep drawing, or throw them away
  function askLeave() {
    if (ui.root.querySelector(".s3d-leave")) return;
    const back = el("div", { class: "s3d-modal-back s3d-leave" });
    const n = ui.st.strokes.length;
    const card = el("div", { class: "s3d-modal", role: "alertdialog", "aria-label": "Leave 3D Sketch" },
      el("h3", {}, "Leave 3D Sketch?"),
      el("p", { class: "hint", style: { padding: 0 } }, `You've drawn ${n} line${n > 1 ? "s" : ""}. What would you like to do with ${n > 1 ? "them" : "it"}?`),
      el("div", { class: "lathe-leave-btns" },
        el("button", { class: "btn primary", id: "s3d-leave-keep", onclick: () => { back.remove(); commit(); } }, `Keep ${n > 1 ? "them" : "it"} (add to my design)`),
        el("button", { class: "btn", id: "s3d-leave-draw", onclick: () => back.remove() }, "Keep drawing"),
        el("button", { class: "btn danger", id: "s3d-leave-discard", onclick: () => { back.remove(); close(false, true); } }, "Discard and leave")));
    back.append(card); ui.root.append(back);
  }
  function close(saved, quiet) {
    if (!ui) return;
    if (!saved && !quiet && ui.st.strokes.length) { askLeave(); return; }
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    clearGroup(ui.strokeGroup); clearGroup(ui.liveGroup); clearGroup(ui.baseGroup);
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    const from = ui.st.from;
    ui = null;
    if (from && app.mode !== from) app.setMode(from);
  }

  return { open, close: () => close(false, true), get active() { return !!ui; }, _ui: () => ui, _node: (s) => strokeNode(s), _hit: (p) => { const h = surfaceHit(p); return h && h.p.toArray(); } };
}
