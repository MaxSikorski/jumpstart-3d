// Advanced mode: Fusion-style ribbon, browser, timeline and feature commands.
import * as THREE from "three";
import { store, findBody, findSketch, nextSeq, IDENTITY, timeline, regionsFor, regionOwners, shapeGroup, userLoops, resolveNode, bodyKey, primName, pathChain, orderPath } from "./store.js";
import { el, fmt, uid, round, clone, nextColor, fileAccept } from "./util.js";
import { getUnit, withUnit, showLen } from "./units.js";
import { ICON } from "./icons.js";
import { FONT_NAMES } from "./fonts.js";
import { planeMatrix } from "./scene.js";
import { thickLines } from "./thickline.js";
import { SKETCH_TOOLS, normalizeSketch, arcFrom3, addImportedCurves } from "./sketcher.js";
import { parseSVG, parseDXF, curvesBounds } from "./importers.js";
import { paramNameOk, renameParam, newParam, removeParam, applyParams, setExpr, exprOf, exprsOf, paramsToCsv, parseParamsCsv, importParams, PARAM_ERROR } from "./params.js";
import { sketchDof } from "./constraints.js"; // jumpstart-3d: parameters
import { traceImage, curvesFor } from "./trace.js";
import { subjectMask, inflate, maskBox } from "./puffy.js";
import { resolveSketch, sampleCurve, d2, polyArea } from "./regions.js";
import { M4, arr, makePrimBody, frameOnFace, groupBodies, ungroupBody, deleteBodies, duplicateBodies, nextName, PRIM_DEFAULTS, transformBodies } from "./ops.js";
import { MATERIALS, matByKey, swatchCSS } from "./appearance.js";
import { renderImage, QUALITY, LIGHT_COLORS, LIGHT_TYPES, BACKGROUNDS } from "./render.js";
import { LIB, TEX_CATS, TEXTURE_DEFAULTS, textureThumb, texByKey, registerImageTexture, bytesToB64 } from "./texture.js";
import { initSimulate } from "./simulate.js";
import { readMeshFile, simplify, packMesh, meshBounds, toB64, contentId, MESH_LIMIT } from "./meshimport.js";
import { initMeasure } from "./measure.js";
import { commitCombine, hasLaterKeepPiece } from "./combinesplit.js"; // jumpstart-3d: separate Combine pieces
import { textBounds } from "./textgeo.js";
import { initSection } from "./section.js";
import { sketchesDXF } from "./dxf.js";
import { initPipeCoil } from "./pipecoil.js";
import { initFasteners } from "./fasteners.js"; // jumpstart-3d: fasteners
import { initHolePattern } from "./holepattern.js"; // jumpstart-3d: hole pattern
import { initGears } from "./gears.js"; // jumpstart-3d: gears
import { snapSwitch, fine, makeGizmo, axisAlong, ringDrag, turnFeedback, placePill } from "./rotationui.js"; // jumpstart-3d: rotation access
import { liveGizmo, onEscape } from "./pivot.js"; // jumpstart-3d: pivot
import { initNamePlate } from "./nameplate.js"; // jumpstart-3d: name plates
import { initKnurl } from "./knurl.js"; // jumpstart-3d: knurl
import { initSpring } from "./spring.js"; // jumpstart-3d: spring
import { initPrintSim } from "./printsim.js";
import { FACEPAT, facePatCells } from "./facepat.js";

const BODY_COLORS = ["#9fb1c4", "#c9a27a", "#8fb79a", "#b49ac8", "#c98f8f", "#8fb8c9"];

export function initAdvanced(app) {
  const vp = app.vp, scene = app.scene, sketcher = app.sketcher;
  const $ = (id) => document.getElementById(id);
  const ribbon = $("ribbon"), browser = $("browser"), tl = $("timeline"), vpEl = $("viewport");
  const panel = el("div", { class: "float cmd", hidden: true, id: "cmd" });
  const palette = el("div", { class: "float cmd", hidden: true, id: "palette" });
  vpEl.append(panel, palette);

  // overlay for picked edges / faces / arrows
  const ov = new THREE.Group();
  vp.world.add(ov);
  function clearOv() { for (const c of [...ov.children]) { ov.remove(c); c.geometry && c.geometry.dispose(); } vp.request(); }

  // ------------------------------------------------------------------ base geometry (committed doc)
  // Picking runs against the committed shape, not the live preview, so edges stay stable.
  function baseOf(bodyId) {
    const b = findBody(store.doc, bodyId);
    if (!b) return null;
    const key = bodyKey(resolveNode(b.node, store.doc));
    const r = app.kernel.get(key);
    return r && r.ok ? { body: b, data: r.mesh, m: M4(b.m) } : null;
  }
  // geometry is shared between identical bodies; each body gets its own mesh and matrix
  const pickGeoCache = new Map();
  function pickMesh(base) {
    let g = pickGeoCache.get(base.data);
    if (!g) {
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(base.data.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(base.data.triangles, 1));
      g.computeBoundingSphere();
      pickGeoCache.set(base.data, g);
      if (pickGeoCache.size > 40) { const k = pickGeoCache.keys().next().value; pickGeoCache.get(k).dispose(); pickGeoCache.delete(k); }
    }
    const m = new THREE.Mesh(g, pickMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(base.m);
    m.matrixWorld.copy(base.m);
    m.userData.base = base;
    return m;
  }
  const pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  function bases(filter) {
    return store.doc.bodies.filter((b) => !b.hidden && (!filter || filter(b))).map((b) => baseOf(b.id)).filter(Boolean);
  }
  function pickBaseFace(e, filter) {
    const list = bases(filter);
    vp.ray(e);
    const hits = vp.raycaster.intersectObjects(list.map(pickMesh), false);
    if (!hits.length) return null;
    const h = hits[0];
    const base = h.object.userData.base;
    const idx = h.faceIndex * 3;
    const fg = base.data.faceGroups;
    let face = -1;
    for (let i = 0; i < fg.length; i++) if (idx >= fg[i][0] && idx < fg[i][0] + fg[i][1]) { face = i; break; }
    const nLocal = h.face.normal.clone();
    return { body: base.body.id, base, face, info: base.data.faceInfo[face], point: h.point.clone(), normal: nLocal.clone().transformDirection(base.m), nLocal, distance: h.distance };
  }
  // Is this point on a body's surface visible, or is some face in front of it? Checked along the
  // line of sight to the point itself (not the pointer), so edges deep inside cuts and holes, whose
  // walls are seen at a glancing angle, still count as visible.
  function seenPoint(p, meshes) {
    const ndc = p.clone().project(vp.camera);
    const rc = vp.raycaster;
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), vp.camera);
    const along = p.clone().sub(rc.ray.origin).dot(rc.ray.direction);
    const hits = rc.intersectObjects(meshes, false);
    return !hits.length || hits[0].distance >= along - Math.max(0.05, along * 0.004);
  }
  function pickBaseEdge(e, filter, px = vp.tol(8)) {
    const [mx, my] = vp.local(e);
    const list = bases(filter);
    const meshes = list.map(pickMesh);
    const cam = vp.camera;
    const cands = [];
    const t = new THREE.Vector3();
    for (const base of list) {
      const L = base.data.lines;
      const n = L.length / 3;
      const sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        t.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m);
        sd[i] = t.distanceTo(cam.position);
        t.project(cam);
        sx[i] = ((t.x + 1) / 2) * vp.w; sy[i] = ((1 - t.y) / 2) * vp.h;
      }
      base.data.edgeGroups.forEach(([s, c], ei) => {
        for (let i = s; i < s + c - 1; i++) {
          const dx = sx[i + 1] - sx[i], dy = sy[i + 1] - sy[i];
          const k = Math.max(0, Math.min(1, ((mx - sx[i]) * dx + (my - sy[i]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(sx[i] + dx * k - mx, sy[i] + dy * k - my);
          if (d < px) {
            // perspective-correct point on the 3D edge
            const k3 = vp.useOrtho ? k : (k * sd[i]) / ((1 - k) * sd[i + 1] + k * sd[i] || 1);
            const a = new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]), b = new THREE.Vector3(L[i * 3 + 3], L[i * 3 + 4], L[i * 3 + 5]);
            cands.push({ d, p: a.lerp(b, k3).applyMatrix4(base.m), body: base.body.id, edge: ei, info: base.data.edgeInfo[ei], base });
          }
        }
      });
    }
    // nearest visible edge under the pointer (skipping ones hidden behind faces)
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands.slice(0, 40)) if (seenPoint(c.p, meshes)) return { body: c.body, edge: c.edge, info: c.info, base: c.base };
    return null;
  }
  function edgeWorldPts(base, ei) {
    const [s, c] = base.data.edgeGroups[ei];
    const L = base.data.lines, out = [];
    for (let i = s; i < s + c; i++) out.push(new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m));
    return out;
  }
  function drawLine(pts, color, width = 1) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    l.renderOrder = 12;
    ov.add(l);
    void width;
  }
  function drawFace(base, face, color, opacity = 0.45) {
    const [s, c] = base.data.faceGroups[face];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base.data.vertices, 3));
    g.setIndex(Array.from(base.data.triangles.subarray(s, s + c)));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    m.matrix.copy(base.m);
    m.matrixWorldNeedsUpdate = true;
    m.renderOrder = 11;
    ov.add(m);
  }
  function drawDot(p, color, sizePx = 9) {
    const g = new THREE.BufferGeometry().setFromPoints([p]);
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size: sizePx, sizeAttenuation: false, depthTest: false, transparent: true }));
    m.renderOrder = 13;
    ov.add(m);
  }

  // Dragging an arrow along its direction, measured on screen. Steady from any view,
  // including when the arrow points straight at you (then dragging up = longer).
  function axisDragger(e, origin, n) {
    const [mx0, my0] = vp.local(e);
    const ps = vp.pixelSize(origin) || 0.1;
    const L = ps * 60;
    const p0 = vp.project(origin), p1 = vp.project(origin.clone().addScaledVector(n, L));
    let sx = (p1[0] - p0[0]) / L, sy = (p1[1] - p0[1]) / L;
    const ppm = 1 / ps;
    if (sx * sx + sy * sy < (0.3 * ppm) ** 2) {
      const toCam = vp.camera.position.clone().sub(origin);
      sx = 0; sy = -ppm * (n.dot(toCam) >= 0 ? 1 : -1);
    }
    const k2 = sx * sx + sy * sy;
    return (ev) => { const [mx, my] = vp.local(ev); return ((mx - mx0) * sx + (my - my0) * sy) / k2; };
  }
  // after a sketch the camera often looks straight down the extrude direction:
  // tilt it so the depth can be seen and dragged
  function tiltForDepth(n) {
    const dir = vp.camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(dir.dot(n)) < 0.92) return;
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3().crossVectors(up, n).normalize();
    const v = n.clone().multiplyScalar(0.55).addScaledVector(up, 0.68).addScaledVector(side, 0.48).normalize();
    vp.lookAlong(v, null, vp.view.target.clone(), vp.view.dist);
  }

  // ------------------------------------------------------------------ command framework
  // Selecting, resize handles (shared with Beginner) and window (marquee) selection
  let delegated = false, pressOn = null, liveOn = false;
  // jumpstart-3d: pivot. The live gizmo: a click that selects bodies shows move / turn handles at once; only pressing one transforms
  const live = liveGizmo(app, { parent: vpEl, active: () => app.mode === "advanced" && workspace === "design" && !app.command && !sketcher.active && !app.simLock, design: () => app.mode === "advanced" && workspace === "design" && !app.simLock });
  const defaultHandler = {
    wantsTouch: (e) => !!(live.pick(e) || app.beginner.pickHandle(e)),
    hover(e) {
      if (live.hover(e, "dot")) { scene.setHovered(null); return; }
      if (app.beginner.hoverHandle(e)) { live.unhot(); scene.setHovered(null); return; }
      if (live.hover(e, "parts")) { scene.setHovered(null); return; }
      const f = scene.pickFace(e);
      scene.setHovered(f ? f.body : null);
      vp.canvas.style.cursor = "default";
    },
    leave() { scene.setHovered(null); },
    down(e) {
      selSketch = null;
      // jumpstart-3d: pivot. The dot first, then the resize handles, then the arrows and rings. Not with Shift, Ctrl or Meta held (that toggles
      // the body) and not for the tap a finger lets the viewport route after pressing a handle without moving
      const plain = !(e.shiftKey || e.ctrlKey || e.metaKey) && !vp.tapping;
      if (plain && live.down(e, "dot")) { liveOn = true; return true; }
      if (app.beginner.handleDown(e)) { delegated = true; return true; }
      if (plain && live.down(e, "parts")) { liveOn = true; return true; }
      const f = scene.pickFace(e);
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (f) {
        // a click selects the body; dragging from it draws a selection window instead
        // (bodies can't be dragged in Advanced, so the window can start anywhere)
        pressOn = { id: f.body, add, start: vp.local(e), base: app.sel.slice() };
      } else {
        // drag a window on empty space to select every body it touches
        app.beginner.rubberDown(e, add);
        delegated = true;
      }
      return true;
    },
    move(e) {
      if (liveOn) { live.move(e); return; } // jumpstart-3d: pivot
      if (pressOn) {
        const [x, y] = vp.local(e);
        if (Math.hypot(x - pressOn.start[0], y - pressOn.start[1]) < 5) return;
        app.beginner.rubberDown(e, pressOn.add, pressOn.start, pressOn.base);
        pressOn = null;
        delegated = true;
      }
      if (delegated) app.beginner.handler.move(e);
    },
    up(e) {
      if (liveOn) { liveOn = false; const r = live.up(e); renderBrowser(); return r; } // jumpstart-3d: pivot
      if (pressOn) {
        const { id, add } = pressOn;
        pressOn = null;
        app.select(add ? (app.sel.includes(id) ? app.sel.filter((x) => x !== id) : [...app.sel, id]) : [id]);
        renderBrowser();
        return;
      }
      if (delegated) { delegated = false; app.beginner.handler.up(e); renderBrowser(); }
    },
    cancel() { pressOn = null; if (liveOn) { liveOn = false; live.cancel(); } if (delegated) { delegated = false; app.beginner.handler.cancel(); } }, // jumpstart-3d: pivot (live)
    dblclick(e) {
      const hits = vp.pick(e, scene.regionMeshes());
      if (hits.length) { app.enterSketch(hits[0].object.userData.region.sketch); return; }
      const f = scene.pickFace(e);
      if (f) { const b = findBody(store.doc, f.body); if (b) editBody(b); }
    },
  };

  function openCmd(def) {
    closeCmd(false);
    app.select(def.keepSelection ? app.sel : []);
    app.command = def;
    def.cancel = () => closeCmd(false);
    vp.handler = def.handler || defaultHandler;
    panel.hidden = false;
    panel.classList.toggle("wide", !!def.wide);
    def.render = () => {
      panel.innerHTML = "";
      panel.append(el("header", {}, el("h4", {}, def.title), el("button", { class: "xbtn", "aria-label": "Cancel", html: ICON.close, onclick: () => closeCmd(false) })));
      const body = el("div", { class: "body" });
      def.build(body);
      if (def.error) body.append(el("div", { class: "err-msg" }, def.error));
      panel.append(body);
      const ok = el("button", { class: def.okLabel === "Cancel" ? "btn" : "btn primary", id: "cmd-ok", disabled: def.canOk ? !def.canOk() : false, onclick: () => def.ok() }, def.okLabel || "OK");
      const foot = el("footer", {});
      if (def.onDelete) foot.append(el("button", { class: "btn danger", style: { marginRight: "auto" }, onclick: () => { def.onDelete(); } }, "Delete"));
      if (def.okLabel !== "Cancel" && def.okLabel !== "Done") foot.append(el("button", { class: "btn", onclick: () => closeCmd(false) }, "Cancel"));
      foot.append(ok);
      panel.append(foot);
    };
    def.render();
    def.refreshOk = () => { const b = $("cmd-ok"); if (b) b.disabled = (def.canOk ? !def.canOk() : false) || !!def.buildError; };
    if (def.start) def.start();
    app.refreshUI("command");
  }
  function closeCmd(committed) {
    const def = app.command;
    if (!def) return;
    app.command = null;
    if (!committed) store.setPreview(null);
    def.cleanup && def.cleanup(committed); // jumpstart-3d: pivot. (committed)
    if (!committed && def.onCancel) def.onCancel();
    scene.state.forceSketch = null;
    scene.state.ghost = new Set();
    scene.highlightRegions(new Set(), null);
    scene.syncSketches(store.view);
    clearOv();
    panel.hidden = true;
    vp.handler = sketcher.active ? sketcher.handler : app.mode === "advanced" ? defaultHandler : app.beginner.handler;
    vp.canvas.style.cursor = "default";
    app.refreshUI("command");
  }
  let previewQueued = false;
  function schedulePreview(def) {
    // a changed value gets a fresh try: drop the last error (and its disabled OK) right away,
    // so a too-large size can simply be typed over
    if (def.buildError || panel.querySelector("#cmd-err")) {
      def.buildError = null;
      panel.querySelector("#cmd-err")?.remove();
      def.refreshOk && def.refreshOk();
    }
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
      previewQueued = false;
      if (app.command !== def) return;
      try {
        def.error = null;
        if (def.valid && !def.valid()) { store.setPreview(null); }
        else store.setPreview((doc) => { app.previewing = true; try { def.apply(doc); } finally { app.previewing = false; } });
      } catch (err) { def.error = err.message; }
      def.refreshOk && def.refreshOk();
    });
  }
  // the sketches a design's features use (profiles, paths, axes, loft sections…)
  function usedSketches(doc) {
    const out = new Set();
    const walk = (o, depth = 0) => {
      if (!o || typeof o !== "object" || depth > 40) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const [k, v] of Object.entries(o)) {
        if ((k === "sketch" || k === "sketchId") && typeof v === "string") out.add(v);
        else if (v && typeof v === "object") walk(v, depth + 1);
      }
    };
    for (const b of doc.bodies || []) walk(b.node);
    return out;
  }
  function commit(def, label) {
    if (def.valid && !def.valid()) return;
    try {
      // like Fusion: a sketch that a new feature uses is tucked away once the feature is made
      // (it stays in the Browser; the eye shows it again)
      store.update((doc) => {
        const before = usedSketches(doc);
        def.apply(doc);
        for (const id of usedSketches(doc)) if (!before.has(id)) { const sk = (doc.sketches || []).find((x) => x.id === id); if (sk) sk.hidden = true; }
      }, label);
    } catch (err) { app.toast(err.message, "err"); return; }
    closeCmd(true);
  }
  // the kernel reports preview failures asynchronously; show them in the open dialog
  function showBuildErrors() {
    const def = app.command;
    if (!def || panel.hidden) return;
    const doc = store.view;
    const msgs = [];
    for (const b of doc.bodies) if (scene.errors.has(b.id) && (!store.preview || store.preview === doc)) {
      const committed = findBody(store.doc, b.id);
      // only failures this command introduced
      if (store.preview && committed && bodyKey(resolveNode(committed.node, store.doc)) === b._key) continue;
      if (b._key && !app.kernel.get(b._key)) continue; // still building
      msgs.push(scene.errors.get(b.id));
    }
    let box = panel.querySelector("#cmd-err");
    if (!msgs.length) { if (box) box.remove(); def.buildError = null; def.refreshOk && def.refreshOk(); return; }
    def.buildError = msgs[0];
    if (!box) { box = el("div", { class: "err-msg", id: "cmd-err" }); panel.querySelector(".body").append(box); }
    if (box.dataset.msg !== msgs[0]) { box.textContent = msgs[0]; box.dataset.msg = msgs[0]; }
    def.onBuildError && def.onBuildError(msgs[0], box);
    const ok = document.getElementById("cmd-ok");
    if (ok) ok.disabled = true;
  }
  // ------------------------------------------------------------------ placing text on a face
  // Snap a point on a flat face (all vectors in one space): to the face's center lines when close,
  // otherwise to the grid measured from the face center. Returns the point and its offsets.
  const gridMM = () => { const v = +(document.getElementById("snap") || {}).value; return v > 0 ? v : 1; };
  function snapOnFace(p, c, x, up, tolMM, on) {
    let u = p.clone().sub(c).dot(x), v = p.clone().sub(c).dot(up);
    if (on) {
      const g = gridMM();
      u = Math.abs(u) < tolMM ? 0 : Math.round(u / g) * g;
      v = Math.abs(v) < tolMM ? 0 : Math.round(v / g) * g;
    }
    const n = new THREE.Vector3().crossVectors(x, up).normalize();
    const out = c.clone().addScaledVector(x, u).addScaledVector(up, v).addScaledVector(n, p.clone().sub(c).dot(n));
    return { p: out, u, v };
  }
  // a text-sized outline on a face while dragging (the real letters follow when you let go)
  function drawTextGhost(center, x, up, w, h, angleDeg, color = 0x1f4fa8) {
    const a = (angleDeg * Math.PI) / 180, n = new THREE.Vector3().crossVectors(x, up).normalize();
    const xr = x.clone().applyAxisAngle(n, a), ur = up.clone().applyAxisAngle(n, a);
    const lift = n.clone().multiplyScalar(0.05);
    const pt = (i, j) => center.clone().addScaledVector(xr, (i * w) / 2).addScaledVector(ur, (j * h) / 2).add(lift);
    drawLine([pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1), pt(-1, -1)], color);
    drawLine([center.clone().addScaledVector(xr, -w / 2 - 2).add(lift), center.clone().addScaledVector(xr, w / 2 + 2).add(lift)], 0x7fa6e0);
    drawLine([center.clone().addScaledVector(ur, -h / 2 - 2).add(lift), center.clone().addScaledVector(ur, h / 2 + 2).add(lift)], 0x7fa6e0);
  }
  const textSize = (str, size, font) => { const b = textBounds({ str: String(str || "TEXT"), size, x: 0, y: 0, angle: 0, font }); return [Math.max(size * 0.6, b.maxX - b.minX), Math.max(size, b.maxY - b.minY)]; };

  // ------------------------------------------------------------------ Emboss / deboss text
  // Text raised from or cut into a face: flat faces, round faces (wrapped letter by
  // letter around a cylinder or a hole), spheres, and a straight push on other curves.
  function embossCmd(editing = null, pre = null) {
    const st = { pick: null, str: "TEXT", font: "sans", size: 8, depth: 1, mode: "emboss", angle: 0, along: false, mirror: false, reverse: false, geo: null, body: null, snap: app.snapOn, dragging: false, lastPrev: 0 };
    // wrapping a Beginner text shape onto another shape: start from its text, and replace it on OK
    if (pre) { for (const k of ["str", "font", "size", "depth", "mode"]) if (pre[k] !== undefined) st[k] = pre[k]; st.removeAfter = pre.removeId || null; }
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { str: m.str, font: m.font || "sans", size: m.size, depth: m.depth, mode: m.mode, angle: m.angle || 0, along: !!m.along, mirror: !!m.mirror, reverse: !!m.reverse, body: b.id, geo: geoOf(m) });
      // older text on an upside-down round face: same look, but shown as upright text at 0°
      if (st.geo.kind === "cyl" && !st.along && st.geo.ax) {
        const axW = new THREE.Vector3(...st.geo.ax).transformDirection(M4(b.m));
        if (axW.z < -0.35) { st.geo.ax = st.geo.ax.map((q) => -q); st.angle = (((st.angle + 180) % 360) + 360) % 360; }
      }
    }
    function geoOf(m) { const g = {}; for (const k of ["kind", "p", "n", "x", "o", "ax", "r", "ext", "c", "up", "fc"]) if (m[k] !== undefined) g[k] = m[k]; return g; }
    let hover = null;
    const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));
    // where the text goes, in the body's own coordinates
    function geoFromPick(f, snapOn = false) {
      const inv = f.base.m.clone().invert();
      const pl = f.point.clone().applyMatrix4(inv);
      const tolMM = vp.tol(10) * vp.pixelSize(f.point);
      const info = f.info;
      const wn = f.normal.clone().normalize();
      const toLocalDir = (v) => v.clone().transformDirection(inv).normalize();
      // upright text: along world X on floors and ceilings, otherwise level across the face
      const wx = Math.abs(wn.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(wn).normalize();
      if (info.t === "PLANE" && info.n) {
        // snapping: the face's center lines when close, otherwise the grid measured from the face center
        const xl = toLocalDir(wx), nl = new THREE.Vector3(...info.n).normalize(), upl = new THREE.Vector3().crossVectors(nl, xl).normalize();
        const c = info.c ? new THREE.Vector3(...info.c) : null;
        const q = c ? snapOnFace(pl, c, xl, upl, tolMM, snapOn).p : pl;
        return { kind: "plane", p: r6(q), n: info.n.slice(), x: r6(xl), ...(c ? { fc: r6(c) } : {}) };
      }
      if (info.t === "CYLINDRE" && info.ax) {
        // a round face's axis can point either way; turn it so letters stand upright as you see them
        const axW = new THREE.Vector3(...info.ax).transformDirection(f.base.m);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(vp.camera.quaternion);
        const flip = Math.abs(axW.z) > 0.35 ? axW.z < 0 : axW.dot(camUp) < 0;
        const ax = new THREE.Vector3(...info.ax).normalize(), o = new THREE.Vector3(...info.o);
        if (snapOn) { const h = pl.clone().sub(o).dot(ax), g = gridMM(); pl.addScaledVector(ax, Math.round(h / g) * g - h); }
        return { kind: "cyl", p: r6(pl), o: info.o.slice(), ax: flip ? info.ax.map((q) => -q) : info.ax.slice(), r: info.r, ext: info.ext !== false };
      }
      if (info.t === "SPHERE" && info.o) return { kind: "sphere", p: r6(pl), c: info.o.slice(), r: info.r, up: r6(toLocalDir(new THREE.Vector3(0, 0, 1))) };
      return { kind: "other", p: r6(pl), n: r6(f.nLocal.clone().normalize()), x: r6(toLocalDir(wx)) };
    }
    const KIND = { plane: "flat face", cyl: "round face", sphere: "sphere", other: "curved face" };
    const def = {
      title: (editing ? "Edit " : "") + "Emboss text",
      valid: () => !!st.geo && !!st.str.trim() && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const props = { ...st.geo, str: st.str, font: st.font, size: st.size, depth: st.depth, mode: st.mode, angle: st.angle, along: st.along, mirror: st.mirror, reverse: st.reverse };
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); for (const k of ["kind", "p", "n", "x", "o", "ax", "r", "ext", "c", "up", "fc"]) delete m[k]; Object.assign(m, props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "emboss", ...props });
        if (st.removeAfter) doc.bodies = doc.bodies.filter((x) => x.id !== st.removeAfter);
      },
      ok() { commit(def, st.mode === "deboss" ? "Deboss text" : "Emboss text"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.geo ? "Drag the text across the body to move it (or click a spot). Arrow keys nudge it. Hold Alt (Option) while dragging to move freely." : "Click where the text goes: a flat face, a round face or a sphere.",
      build(body) {
        body.append(pickbox(!st.geo, st.geo ? el("span", {}, el("b", {}, findBody(store.doc, st.body)?.name || "Body"), " · " + KIND[st.geo.kind]) : "Click a face", null));
        const txt = el("input", { class: "num", id: "em-text", value: st.str, style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { st.str = txt.value; app.submitCommand(); } });
        txt.addEventListener("input", () => { st.str = txt.value; clearTimeout(st.tt); st.tt = setTimeout(() => refresh(false), 350); });
        body.append(row("Text", txt, "em-text"));
        body.append(row("Font", textFontSelect(st.font, (v) => { st.font = v; refresh(false); }, "em-font"), "em-font"));
        body.append(row("Style", seg([["emboss", "Emboss (raised)"], ["deboss", "Deboss (cut in)"]], st.mode, (v) => { st.mode = v; refresh(); }, "em-mode")));
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Letter height", app.numField({ value: st.size, id: "em-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; refresh(false); } })));
        r3.append(el("label", {}, st.mode === "deboss" ? "Depth" : "Height", app.numField({ value: st.depth, id: "em-depth", min: 0.05, step: 0.2, onCommit: (v) => { st.depth = v; refresh(false); } })));
        r3.append(el("label", {}, "Angle °", app.numField({ value: st.angle, id: "em-angle", step: 15, onCommit: (v) => { st.angle = v; refresh(false); } })));
        body.append(r3);
        if (st.geo && st.geo.kind === "cyl") body.append(row("Direction", seg([[false, "Around"], [true, "Along"]], st.along, (v) => { st.along = v; refresh(); }, "em-along")));
        // fix text that reads backwards or upside down
        const flip = el("div", { class: "seg", id: "em-flip" },
          el("button", { id: "em-mirror", "aria-pressed": st.mirror, title: "Mirror the text left to right (for text that reads backwards, or to read correctly from the other side)", onclick: () => { st.mirror = !st.mirror; refresh(); } }, "⇋ Mirror"),
          el("button", { id: "em-reverse", "aria-pressed": st.reverse, title: "Reverse the order of the letters", onclick: () => { st.reverse = !st.reverse; refresh(); } }, "Reverse order"),
          el("button", { id: "em-rot180", title: "Turn the text upside down (adds 180° to the angle)", onclick: () => { st.angle = ((st.angle + 180) % 360 + 360) % 360; refresh(); } }, "↻ 180°"));
        body.append(row("Flip", flip, "em-flip"));
        // where it sits: offsets from the face center (flat faces), and snapping
        if (st.geo && st.geo.kind === "plane" && st.geo.fc) {
          const [u, v] = uvOf();
          const p3 = el("div", { class: "row3" });
          p3.append(el("label", {}, "Across", app.numField({ value: +u.toFixed(3), id: "em-u", step: 1, onCommit: (val) => { setUV(val, null); refresh(); } })));
          p3.append(el("label", {}, "Up", app.numField({ value: +v.toFixed(3), id: "em-v", step: 1, onCommit: (val) => { setUV(null, val); refresh(); } })));
          p3.append(el("label", {}, "\u00a0", el("button", { class: "btn", id: "em-center", title: "Put the text in the middle of the face", onclick: () => { setUV(0, 0); refresh(); } }, "Center")));
          body.append(el("div", { class: "subhead" }, "Position (from the face center)"), p3);
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "em-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; } }), "Snap to the face center and the grid (" + withUnit(gridMM(), 3) + ")"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Drag the text to move it. Snap off (or holding Alt / Option while you drag) moves it freely. Arrow keys nudge it (Shift ×10, Alt ×0.1). On round faces each letter wraps around the curve. For 3D printing, keep letters at least 5 mm tall and 0.6 mm deep."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && b.id !== st.removeAfter && (!st.body || !editing || b.id === st.body));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && b.id !== st.removeAfter && (!editing || b.id === st.body));
          if (!f || !f.info) return true;
          st.body = f.body;
          st.geo = geoFromPick(f, st.snap !== !!e.altKey);
          st.dragging = true; st.lastPrev = performance.now();
          refresh();
          return true;
        },
        // drag the text across the body's faces; the letters rebuild a few times a second and when you let go
        move(e) {
          if (!st.dragging) return;
          const f = pickBaseFace(e, (b) => b.id === st.body);
          if (!f || !f.info) return;
          st.geo = geoFromPick(f, st.snap !== !!e.altKey);
          draw();
          const now = performance.now();
          if (now - st.lastPrev > 350) { st.lastPrev = now; schedulePreview(def); }
        },
        up() { if (!st.dragging) return; st.dragging = false; refresh(); },
      },
      arrowKey(e) {
        if (!st.geo || !st.body) return false;
        const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (st.snap ? gridMM() : 1);
        const dx = e.key === "ArrowLeft" ? -k : e.key === "ArrowRight" ? k : 0, dy = e.key === "ArrowUp" ? k : e.key === "ArrowDown" ? -k : 0;
        const g = st.geo, P = new THREE.Vector3(...g.p);
        if (g.kind === "plane") { const [x, up] = axesOf(); P.addScaledVector(x, dx).addScaledVector(up, dy); }
        else if (g.kind === "cyl") { const ax = new THREE.Vector3(...g.ax).normalize(), o = new THREE.Vector3(...g.o); P.addScaledVector(ax, dy); if (dx) P.sub(o).applyAxisAngle(ax, -dx / Math.max(1e-6, g.r) * (g.ext === false ? -1 : 1)).add(o); }
        else return false;
        st.geo = { ...g, p: r6(P) };
        refresh();
        return true;
      },
    };
    // a flat face's directions (body coordinates): across (the text's x) and up
    function axesOf() { const g = st.geo, x = new THREE.Vector3(...g.x).normalize(), n = new THREE.Vector3(...g.n).normalize(); return [x, new THREE.Vector3().crossVectors(n, x).normalize(), n]; }
    function uvOf() { const g = st.geo, [x, up] = axesOf(), d = new THREE.Vector3(...g.p).sub(new THREE.Vector3(...g.fc)); return [d.dot(x), d.dot(up)]; }
    function setUV(u, v) {
      const g = st.geo, [x, up] = axesOf(), [u0, v0] = uvOf();
      const P = new THREE.Vector3(...g.p).addScaledVector(x, (u ?? u0) - u0).addScaledVector(up, (v ?? v0) - v0);
      st.geo = { ...g, p: r6(P) };
    }
    function draw() {
      clearOv();
      if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      if (st.geo && st.body) {
        const base = baseOf(st.body);
        if (base) {
          const P = new THREE.Vector3(...st.geo.p).applyMatrix4(base.m);
          drawDot(P, 0x1f4fa8, 10);
          if (st.geo.kind === "plane") {
            const [x, up] = axesOf().map((v) => v.clone().transformDirection(base.m));
            const [w, h] = textSize(st.str, st.size, st.font);
            drawTextGhost(P, x, up, w, h, st.angle || 0);
            if (st.geo.fc) drawDot(new THREE.Vector3(...st.geo.fc).applyMatrix4(base.m), 0x7fa6e0, 7);
          }
        }
      }
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ Pattern on face
  // Raise or cut a pattern (hexagons, diamond plate, screen mesh, ...) on one flat face. It is a
  // feature like a hole or emboss text: listed in the timeline, editable, rebuilt when the body changes.
  function facePatternCmd(editing = null) {
    const lastKind = (() => { try { return localStorage.getItem("jumpstart3d.facepat.kind") || "hex"; } catch (e) { return "hex"; } })();
    const K0 = FACEPAT[lastKind] ? lastKind : "hex";
    const st = { kind: K0, size: FACEPAT[K0].size, gap: FACEPAT[K0].g, depth: 1, mode: "raise", lines: false, edge: "whole", border: 2, angle: 0, ox: 0, oy: 0, body: null, geo: null, face: -1 };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { kind: m.kind, size: m.size, gap: m.gap, depth: m.depth, mode: m.mode, lines: !!m.lines, edge: m.edge || "whole", border: m.border ?? 2, angle: m.angle || 0, ox: m.ox || 0, oy: m.oy || 0, body: b.id, geo: { p: m.p, n: m.n, x: m.x } });
    }
    let hover = null;
    const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));
    function geoFromPick(f) {
      const inv = f.base.m.clone().invert();
      const pl = f.point.clone().applyMatrix4(inv);
      const wn = f.normal.clone().normalize();
      // pattern "across" direction: world X on floors and ceilings, otherwise level across the face
      const wx = Math.abs(wn.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(wn).normalize();
      return { p: r6(pl), n: f.info.n.slice(), x: r6(wx.clone().transformDirection(inv).normalize()) };
    }
    const flat = (f) => f && f.info && f.info.t === "PLANE" && f.info.n;
    const def = {
      title: (editing ? "Edit " : "") + "Pattern on face",
      valid: () => !!st.geo && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const props = { p: st.geo.p, n: st.geo.n, x: st.geo.x, kind: st.kind, size: st.size, gap: st.gap, depth: st.depth, mode: st.mode, lines: st.lines, edge: st.edge, border: st.border, angle: st.angle, ox: st.ox, oy: st.oy };
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); Object.assign(m, props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "facepat", ...props });
      },
      ok() { try { localStorage.setItem("jumpstart3d.facepat.kind", st.kind); } catch (e) {} commit(def, FACEPAT[st.kind].name + (st.mode === "cut" ? " cut" : " pattern")); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.geo ? "Change the pattern, its size, depth and direction. It stays editable: double-click it in the timeline later. Click another flat face to move it there." : "Click a flat face to put the pattern on.",
      build(body) {
        body.append(pickbox(!st.geo, st.geo ? el("span", {}, el("b", {}, findBody(store.doc, st.body)?.name || "Body"), " · flat face") : "Click a flat face", null));
        // the patterns, with little pictures
        const grid = el("div", { class: "fp-grid", id: "fp-kind" });
        for (const [k, d] of Object.entries(FACEPAT)) {
          grid.append(el("button", { class: "fp-tile", "aria-pressed": String(st.kind === k), "data-k": k, title: d.name, onclick: () => { if (st.kind === k) return; st.kind = k; st.size = d.size; st.gap = d.g; if (k === "slots") st.edge = "clip"; refresh(); } },
            el("span", { html: patSVG(k) }), el("small", {}, d.name)));
        }
        body.append(grid);
        body.append(row("Style", seg([["raise", "Raise"], ["cut", "Cut in"]], st.mode, (v) => { st.mode = v; refresh(); }, "fp-mode")));
        body.append(row("Make", seg([[false, "The shapes"], [true, "Lines between"]], st.lines, (v) => { st.lines = v; refresh(); }, "fp-lines")));
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Pattern size", app.numField({ value: st.size, id: "fp-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; refresh(false); } })));
        r3.append(el("label", {}, FACEPAT[st.kind].gap, app.numField({ value: st.gap, id: "fp-gap", min: 0, step: 0.2, onCommit: (v) => { st.gap = v; refresh(false); } })));
        r3.append(el("label", {}, st.mode === "cut" ? "Depth" : "Height", app.numField({ value: st.depth, id: "fp-depth", min: 0.05, step: 0.2, onCommit: (v) => { st.depth = v; refresh(false); } })));
        body.append(r3);
        const dirs = el("div", { class: "seg", id: "fp-dirs" }, ...[0, 30, 45, 60, 90].map((a) => el("button", { "aria-pressed": String(st.angle === a), onclick: () => { st.angle = a; refresh(); } }, a + "°")));
        body.append(row("Direction", el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, dirs, app.numField({ value: st.angle, id: "fp-angle", step: 15, onCommit: (v) => { st.angle = v; refresh(); } })), "fp-angle"));
        if (st.kind !== "slots") body.append(row("At the edges", seg([["whole", "Whole shapes"], ["clip", "Trim at edge"]], st.edge, (v) => { st.edge = v; refresh(); }, "fp-edge")));
        const r3b = el("div", { class: "row3" });
        if (st.edge !== "clip" && st.kind !== "slots") r3b.append(el("label", {}, "Border", app.numField({ value: st.border, id: "fp-border", min: 0, step: 0.5, onCommit: (v) => { st.border = v; refresh(false); } })));
        r3b.append(el("label", {}, "Shift across", app.numField({ value: st.ox, id: "fp-ox", step: 0.5, onCommit: (v) => { st.ox = v; refresh(false); } })));
        r3b.append(el("label", {}, "Shift up", app.numField({ value: st.oy, id: "fp-oy", step: 0.5, onCommit: (v) => { st.oy = v; refresh(false); } })));
        body.append(r3b);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Pattern size is the distance from one shape to the next. The pattern is centered on the face and follows it when the body is resized. For 3D printing keep gaps and walls at least 0.8 mm and heights at least 0.4 mm."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!editing || b.id === st.body));
          hover = flat(f) ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : f ? "not-allowed" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!editing || b.id === st.body));
          if (!f) return true;
          if (!flat(f)) { app.toast("Patterns go on flat faces. Click a flat face."); return true; }
          st.body = f.body; st.face = f.face;
          st.geo = geoFromPick(f);
          st.ox = 0; st.oy = 0;
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (hover) drawFace(hover.base, hover.face, 0xe8a317, 0.35);
      if (st.geo && st.body) {
        const base = baseOf(st.body);
        if (base && st.face >= 0 && base.data.faceGroups[st.face]) drawFace(base, st.face, 0x1f4fa8, 0.18);
      }
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // a small picture of a pattern (SVG), from the same shapes the engine uses
  const patSVGCache = new Map();
  function patSVG(kind) {
    if (patSVGCache.has(kind)) return patSVGCache.get(kind);
    const d = FACEPAT[kind], W = 40, s = kind === "knurl" ? 9 : kind === "mesh" ? 8 : 12;
    const cells = facePatCells({ kind, size: s, gap: (d.g / d.size) * s }, [-W / 2, -W / 2, W / 2, W / 2]);
    let out = `<svg viewBox="${-W / 2} ${-W / 2} ${W} ${W}" width="40" height="40" aria-hidden="true"><rect x="${-W / 2}" y="${-W / 2}" width="${W}" height="${W}" rx="4" fill="#d9dee6"/><g fill="#1f4fa8">`;
    for (const c of cells) out += c.r ? `<circle cx="${c.c[0].toFixed(2)}" cy="${(-c.c[1]).toFixed(2)}" r="${c.r.toFixed(2)}"/>` : `<polygon points="${c.pts.map(([x, y]) => x.toFixed(2) + "," + (-y).toFixed(2)).join(" ")}"/>`;
    out += "</g></svg>";
    patSVGCache.set(kind, out);
    return out;
  }
  function textFontSelect(value, onPick, id) {
    const s = el("select", { class: "num", id, "aria-label": "Font" }, ...Object.entries(FONT_NAMES).map(([v, l]) => el("option", { value: v, selected: v === value }, l)));
    s.onchange = () => onPick(s.value);
    return s;
  }
  const row = (label, control, id) => el("div", { class: "row" }, el("label", { for: id }, label), control);
  const seg = (options, value, onPick, id) => el("div", { class: "seg", id }, ...options.map(([v, label]) => el("button", { "aria-pressed": v === value, onclick: () => onPick(v) }, label)));
  const pickbox = (active, text, onClear, onActivate) => {
    const d = el("div", { class: "picklist" + (active ? " active" : ""), onclick: onActivate }, text);
    if (onClear) d.append(el("button", { class: "clr", onclick: (e) => { e.stopPropagation(); onClear(); } }, "Clear"));
    return d;
  };

  // ------------------------------------------------------------------ Create sketch
  const planeGizmo = new THREE.Group();
  vp.world.add(planeGizmo);
  const ORIGIN_PLANES = {
    XY: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1], color: 0x2f6fd0 },
    XZ: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0], color: 0x3f9b52 },
    YZ: { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0], color: 0xd9534f },
  };
  // labels and outlines sit in their own group so only the plane fills are pickable
  const planeGizmoDeco = new THREE.Group();
  vp.world.add(planeGizmoDeco);
  const PLANE_NAMES = { XY: "XY · Top", XZ: "XZ · Front", YZ: "YZ · Right" };
  function planeLabel(text, color) {
    const cv = document.createElement("canvas"), dpr = 2, fs = 26 * dpr;
    const ctx = cv.getContext("2d");
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 28 * dpr, h = fs + 18 * dpr;
    cv.width = w; cv.height = h;
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    const r = h / 2;
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + dpr);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.userData.aspect = w / h;
    sp.renderOrder = 12;
    return sp;
  }
  function showPlaneGizmo(on) {
    for (const c of [...planeGizmo.children]) { planeGizmo.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const c of [...planeGizmoDeco.children]) { planeGizmoDeco.remove(c); c.geometry && c.geometry.dispose(); if (c.material) { c.material.map && c.material.map.dispose(); c.material.dispose(); } }
    // construction planes stand out more while you choose a plane
    if (!!scene.state.planesBold !== on) { scene.state.planesBold = on; scene.syncPlanes(store.view); }
    if (!on) { vp.request(); return; }
    const s = Math.max(30, vp.view.dist * 0.18);
    // the squares form an open corner toward the usual front-right view: XY · Top is the floor
    // in front, YZ · Right the left wall, XZ · Front the back wall, so none hides another
    const OFF = { XY: [0, -1], XZ: [0, 0], YZ: [-1, 0] };
    for (const [name, pl] of Object.entries(ORIGIN_PLANES)) {
      const M = planeMatrix(pl);
      const [ox, oy] = OFF[name].map((v) => v * s);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).translate(s / 2 + ox, s / 2 + oy, 0), new THREE.MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.matrixAutoUpdate = false;
      m.matrix.copy(M);
      m.matrixWorldNeedsUpdate = true;
      m.userData.plane = name;
      m.renderOrder = 7;
      planeGizmo.add(m);
      // a solid border so each plane reads clearly against the grid
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [s, 0], [s, s], [0, s]].map(([x, y]) => new THREE.Vector3(x + ox, y + oy, 0))), new THREE.LineBasicMaterial({ color: pl.color, transparent: true, opacity: 0.95 }));
      edge.matrixAutoUpdate = false; edge.matrix.copy(M); edge.matrixWorldNeedsUpdate = true; edge.renderOrder = 8;
      planeGizmoDeco.add(edge);
      // a name tag in the plane's far corner
      const tag = planeLabel(PLANE_NAMES[name], pl.color);
      const th = s * 0.11;
      tag.scale.set(th * tag.userData.aspect, th, 1);
      tag.position.copy(new THREE.Vector3(ox ? -s * 0.72 : s * 0.72, oy ? -s * 0.8 : s * 0.86, 0).applyMatrix4(M));
      planeGizmoDeco.add(tag);
      m.userData.edge = edge; m.userData.tag = tag;
    }
    vp.request();
  }
  function hotGizmo(obj) {
    for (const m of planeGizmo.children) {
      const hot = obj === m;
      m.material.opacity = hot ? 0.55 : 0.3;
      m.userData.edge.material.color.set(hot ? 0xe8a317 : ORIGIN_PLANES[m.userData.plane].color);
      m.userData.tag.material.opacity = hot ? 1 : 0.9;
    }
  }
  let pendingTool = null;
  function createSketchCmd(opts = {}) {
    if (sketcher.active) app.exitSketch();
    pendingTool = opts.tool || null;
    let hoverFace = null;
    const def = {
      title: "Create sketch",
      okLabel: "Cancel",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Click the workplane, a flat face of a shape, or pick a plane below."));
        body.append(row("Origin plane", seg([["XY", "XY · Top"], ["XZ", "XZ · Front"], ["YZ", "YZ · Right"]], null, (v) => makeSketch(ORIGIN_PLANES[v], null), "plane-seg")));
        const cps = (store.doc.planes || []);
        if (cps.length) {
          const sel = el("select", { class: "num", id: "sk-cplane", "aria-label": "Construction plane" }, el("option", { value: "" }, "Pick a construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
          sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) makeSketch(p.plane, null); };
          body.append(row("Or", sel, "sk-cplane"));
        }
      },
      start() { showPlaneGizmo(true); },
      cleanup() { showPlaneGizmo(false); if (scene.state.hotPlane) { scene.state.hotPlane = null; scene.syncPlanes(store.view); } },
      ok() { closeCmd(false); },
      hint: () => "Click a plane or a flat face to start sketching.",
      handler: {
        hover(e) {
          clearOv();
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(g && g.object);
          if ((cp && cp.id) !== scene.state.hotPlane) { scene.state.hotPlane = cp ? cp.id : null; scene.syncPlanes(store.view); }
          if (g || cp) { vp.request(); return; }
          hoverFace = f && f.info && f.info.t === "PLANE" ? f : null;
          if (hoverFace) drawFace(hoverFace.base, hoverFace.face, 0xe8a317);
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          if (cp) { scene.state.hotPlane = null; makeSketch(cp.plane, null); return true; }
          if (g) { makeSketch(ORIGIN_PLANES[g.object.userData.plane], null); return true; }
          if (f && f.info && f.info.t === "PLANE") makeSketch(planeFromFace(f), f);
          else if (f) app.toast("Sketches need a flat face. Pick a plane or a planar face.");
          else if (vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))) makeSketch(ORIGIN_PLANES.XY, null); // the workplane
          return true;
        },
      },
    };
    openCmd(def);
  }
  // the nearer of an origin plane and a body face wins
  function pickPlaneOrFace(e) {
    // construction planes you made come first (unless a face is in front of them)
    const ch = vp.pick(e, scene.planeMeshes())[0] || null;
    const f0 = pickBaseFace(e);
    if (ch && (!f0 || ch.distance <= f0.distance)) {
      const p = (store.doc.planes || []).find((q) => q.id === ch.object.userData.cplane);
      if (p) return { g: null, f: null, cp: p };
    }
    const gh = vp.pick(e, planeGizmo.children)[0] || null;
    const f = f0;
    // a face you can see through the see-through origin planes wins
    if (f) return { g: null, f };
    return { g: gh, f: null };
  }
  function planeFromFace(f) {
    const n = new THREE.Vector3(...f.info.n).transformDirection(f.base.m).normalize();
    const c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
    // origin: world origin projected onto the face plane, so sketch coordinates match world ones
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c);
    const o = pl.projectPoint(new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    let x = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) x = new THREE.Vector3(0, 1, 0);
    x.sub(n.clone().multiplyScalar(x.dot(n))).normalize();
    const snap = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));
    return { o: snap(o), x: snap(x), n: snap(n) };
  }
  function projectFaceEdges(sk, f) {
    // bring the face's boundary into the sketch as fixed geometry
    const toSk = planeMatrix(sk.plane).invert();
    const base = f.base;
    const P = (v) => { const q = v.clone().applyMatrix4(toSk); return [Math.abs(q.x) < 1e-9 ? 0 : q.x, Math.abs(q.y) < 1e-9 ? 0 : q.y, q.z]; };
    const addPt = (p) => {
      const hit = sk.pts.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 1e-5);
      if (hit) return hit.id;
      const id = uid("p");
      sk.pts.push({ id, x: p[0], y: p[1] });
      return id;
    };
    const L = base.data.lines;
    base.data.edgeGroups.forEach(([s, c], ei) => {
      const pts = [];
      for (let i = s; i < s + c; i++) pts.push(P(new THREE.Vector3(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(base.m)));
      if (pts.some((p) => Math.abs(p[2]) > 1e-4)) return;
      const info = base.data.edgeInfo[ei];
      const a = P(new THREE.Vector3(...info.a).applyMatrix4(base.m)), b = P(new THREE.Vector3(...info.b).applyMatrix4(base.m)), m = P(new THREE.Vector3(...info.m).applyMatrix4(base.m));
      if (info.t === "LINE") sk.ents.push({ id: uid("e"), t: "line", a: addPt(a), b: addPt(b), proj: true });
      else if (info.t === "CIRCLE" && d2(a, b) < 1e-6) {
        const cc = [(a[0] + m[0]) / 2, (a[1] + m[1]) / 2];
        sk.ents.push({ id: uid("e"), t: "circle", c: addPt(cc), r: d2(a, m) / 2, proj: true });
      } else if (info.t === "CIRCLE") {
        const arc = arcFrom3(a, b, m);
        if (arc) sk.ents.push({ id: uid("e"), t: "arc", c: addPt(arc.c), a: addPt(arc.ccw ? a : b), b: addPt(arc.ccw ? b : a), proj: true });
      } else {
        for (let i = 0; i < pts.length - 1; i++) if (d2(pts[i], pts[i + 1]) > 1e-6) sk.ents.push({ id: uid("e"), t: "line", a: addPt(pts[i]), b: addPt(pts[i + 1]), proj: true });
      }
    });
    normalizeSketch(sk);
  }
  function makeSketch(plane, face) {
    closeCmd(false);
    let id;
    store.update((doc) => {
      const sk = { id: uid("s"), name: nextSketchName(doc), seq: nextSeq(doc), plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false };
      if (face) {
        sk.onBody = face.body;
        projectFaceEdges(sk, face);
        // remember the face's center so it can be seen and snapped to
        const q = new THREE.Vector3(...face.info.c).applyMatrix4(face.base.m).applyMatrix4(planeMatrix(sk.plane).invert());
        sk.faceCenter = [Math.abs(q.x) < 1e-9 ? 0 : +q.x.toFixed(9), Math.abs(q.y) < 1e-9 ? 0 : +q.y.toFixed(9)];
      }
      doc.sketches.push(sk);
      id = sk.id;
    }, "Create sketch");
    app.enterSketch(id);
    if (pendingTool) { sketcher.setTool(pendingTool); pendingTool = null; }
  }
  function nextSketchName(doc) {
    let n = 1;
    const names = new Set(doc.sketches.map((s) => s.name));
    while (names.has("Sketch " + n)) n++;
    return "Sketch " + n;
  }

  // ------------------------------------------------------------------ Extrude / Revolve
  function profileKey(sketchId, idx) { return sketchId + ":" + idx; }
  // a sketch made on the fly by clicking a face in Extrude; joins the design on OK
  let pendingSketch = null;
  const findSk = (doc, id) => findSketch(doc, id) || (pendingSketch && pendingSketch.id === id ? pendingSketch : null);
  function toolBox(doc, st) {
    const sk = findSk(doc, st.sketchId);
    if (!sk) return null;
    const regs = regionsFor(sk);
    const M = planeMatrix(sk.plane);
    const n = new THREE.Vector3(...sk.plane.n).normalize();
    const box = new THREE.Box3();
    const pts = [];
    for (const p of st.profiles.values()) {
      const r = regs[p.index];
      if (r) for (const q of r.poly) pts.push(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    }
    if (st.kind === "sweep") {
      for (const p of pts) box.expandByPoint(p);
      for (const q of sweepPathWorld(st)) box.expandByPoint(q);
      if (!box.isEmpty()) { const sz = box.getSize(new THREE.Vector3()); box.expandByScalar(0); void sz; }
      return box.isEmpty() ? null : box;
    }
    if (st.kind === "revolve") {
      const ax = revolveAxisWorld(st, M);
      if (!ax) return null;
      const { a, b } = ax;
      const dir = b.clone().sub(a).normalize();
      for (const p of pts) for (let k = 0; k < 8; k++) box.expandByPoint(p.clone().sub(a).applyAxisAngle(dir, (k * Math.PI) / 4).add(a));
      return box;
    }
    let lo = 0, hi = st.dist;
    if (st.mode === "sym") { lo = -Math.abs(st.dist) / 2; hi = Math.abs(st.dist) / 2; }
    if (st.mode === "two") { lo = -Math.abs(st.dist2); hi = Math.abs(st.dist); }
    for (const p of pts) { box.expandByPoint(p.clone().addScaledVector(n, lo)); box.expandByPoint(p.clone().addScaledVector(n, hi)); }
    return box;
  }
  function participants(doc, st) {
    const tb = toolBox(doc, st);
    if (!tb) return [];
    tb.expandByScalar(1e-3);
    return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && (!st.editing || st.editing.body !== b.id)).filter((b) => {
      const bb = scene.bodyTightBox(b.id);
      return bb && bb.intersectsBox(tb);
    }).map((b) => b.id);
  }
  function resolvedOp(doc, st) {
    if (st.op !== "auto") return st.op;
    const parts = participants(doc, st);
    const sk = findSk(doc, st.sketchId);
    if (!parts.length) return "new";
    if (sk && sk.onBody) return (st.kind === "extrude" && st.dist < 0 && st.mode === "one") ? "cut" : "join";
    return "new";
  }
  // while previewing a cut, show the volume being removed in see-through red
  function showCut(doc, node) {
    doc.bodies.push({ id: "__cut_preview", name: "Cut preview", seq: 1e9, color: "#e5484d", hole: false, hidden: false, cutPreview: true, m: IDENTITY.slice(), node: { ...node, mods: [] } });
  }
  function featureNode(st) {
    const base = { t: st.kind, sketch: st.sketchId, profiles: [...st.profiles.values()].map((p) => p.ref) };
    if (st.kind === "extrude") Object.assign(base, { dist: st.dist, mode: st.mode, dist2: st.dist2 }, exprsOf(st, st.mode === "two" ? ["dist", "dist2"] : ["dist"])); // jumpstart-3d: parameters
    else if (st.kind === "sweep") Object.assign(base, { path: st.path, orient: st.orient, dist: st.sdist, taper: st.taper, twist: st.twist, chain: st.chain });
    else Object.assign(base, { axis: st.axis, angle: st.angle }, exprsOf(st, ["angle"])); // jumpstart-3d: parameters
    return base;
  }

  // sweep path as sampled world points (for previews and bounding boxes)
  function sweepPathLines(st) {
    const sk = st.path && findSk(store.view, st.path.sketch);
    if (!sk) return [];
    const M = planeMatrix(sk.plane);
    return resolveSketch(sk).filter((c) => st.path.ents.includes(c.id)).map((c) => sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
  }
  const sweepPathWorld = (st) => sweepPathLines(st).flat();
  function pathPts(h) {
    const sk = findSk(store.view, h.sketch);
    const M = planeMatrix(sk.plane);
    const ids = swChain ? pathChain(resolveSketch(sk), h.curve.id) : [h.curve.id];
    return resolveSketch(sk).filter((c) => ids.includes(c.id)).map((c) => sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
  }
  // sweep "Chain selection": clicking a path curve takes every connected curve
  let swChain = true;
  const KIND_NAME = { extrude: "Extrude", revolve: "Revolve", sweep: "Sweep" };
  // any sketch curve (line, arc, circle) near the pointer, in any shown sketch
  function pickSketchCurve(e) {
    const [mx, my] = vp.local(e);
    let best = null, bd = vp.tol(9);
    const shown = new Set(scene.sketchViews.keys());
    for (const sk of store.view.sketches) {
      if (!shown.has(sk.id)) continue;
      const M = planeMatrix(sk.plane);
      for (const c of resolveSketch(sk)) {
        if (c.t === "point") continue;
        const pts = sampleCurve(c).map((q) => vp.project(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)));
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(a[0] + dx * t - mx, a[1] + dy * t - my);
          if (d < bd) { bd = d; best = { sketch: sk.id, curve: c }; }
        }
      }
    }
    return best;
  }

  // revolve axis: a sketch line, or one of the origin axes (X, Y, Z)
  const WORLD_AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  function revolveAxisWorld(st, M) {
    if (WORLD_AXES[st.axis]) return { a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(...WORLD_AXES[st.axis]) };
    const l = st.axisLine;
    if (!l) return null;
    return { a: new THREE.Vector3(l.a[0], l.a[1], 0).applyMatrix4(M), b: new THREE.Vector3(l.b[0], l.b[1], 0).applyMatrix4(M) };
  }
  // origin axes that lie in a sketch's plane direction (you can't revolve around the plane normal)
  function axesInPlane(sk) {
    if (!sk) return ["X", "Y", "Z"];
    const n = new THREE.Vector3(...sk.plane.n).normalize();
    return Object.keys(WORLD_AXES).filter((k) => Math.abs(n.dot(new THREE.Vector3(...WORLD_AXES[k]))) < 1e-6);
  }
  function extrudeCmd(kind = "extrude", editing = null, opts = {}) {
    // a new extrude starts at 0, like Fusion 360: picking a profile only highlights it; the
    // body appears once the arrow is dragged or a distance typed
    const big = app.mode === "beginner"; // Beginner: starts pulled up 10 mm, with a big arrow (easier to see and grab)
    const st = { kind, profiles: new Map(), sketchId: null, dist: kind === "extrude" && !editing && !big ? 0 : 10, mode: "one", dist2: 5, op: "auto", angle: 360, axis: null, axisLine: null, pickAxis: false, path: null, pickPath: false, orient: "perp", sdist: 1, taper: 0, twist: 0, chain: true, extent: "dist", toRef: null, pickTo: false, hoverPlane: null, hoverPlaneKey: "", editing };
    // coming straight from a sketch: show it and pick its profile when there is only one
    if (!editing && opts.sketch) {
      const sk = findSk(store.doc, opts.sketch);
      if (sk) {
        const regs = regionsFor(sk);
        st.sketchId = sk.id;
        // ignore profiles made only of a face's projected outline: the user drew something else
        const proj = new Set(sk.ents.filter((e) => e.proj).map((e) => e.id));
        // (a profile that uses any of the face's outline is the face around the drawings, not a drawing:
        // it is never picked by itself; it can still be clicked)
        const mine = regs.map((r, i) => [r, i]).filter(([r]) => !r.ents.some((id) => proj.has(id)));
        // a shape just closed in Beginner: that shape
        const fresh = opts.regionKeys ? regs.map((r, i) => [r, i]).filter(([r]) => opts.regionKeys.includes(r.key)) : [];
        // otherwise: when you drew one closed shape, all of its pieces (a face's outline can split it)
        const own = regionOwners(sk), groups = [...new Set(own.filter((o) => o.startsWith("u:")))];
        const drawn = groups.length === 1 ? regs.map((r, i) => [r, i]).filter(([, i]) => own[i] === groups[0]) : [];
        const pick = opts.regionKeys ? fresh : drawn.length ? drawn : mine.length === 1 ? mine : regs.length === 1 ? [[regs[0], 0]] : [];
        for (const [r, i] of pick) st.profiles.set(profileKey(sk.id, i), { index: i, ref: { key: r.key, pt: r.pt } });
        scene.state.forceSketch = sk.id;
        scene.syncSketches(store.view);
        if (!regs.length) app.toast("That sketch has no closed shapes to extrude yet.");
      }
    }
    // a profile clicked elsewhere (e.g. a sketch circle on a face picked with Offset face)
    if (!editing && opts.region) {
      const r = opts.region;
      st.sketchId = r.sketch;
      st.profiles.set(profileKey(r.sketch, r.index), { index: r.index, ref: { key: r.region.key, pt: r.region.pt } });
      if (opts.dist) st.dist = opts.dist;
      scene.state.forceSketch = r.sketch;
      scene.syncSketches(store.view);
    }
    // prefill from an existing feature
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const node = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).tool : b.node;
      Object.assign(st, { sketchId: node.sketch, dist: node.dist ?? 10, mode: node.mode || "one", dist2: node.dist2 ?? 5, angle: node.angle ?? 360, axis: node.axis || null, path: node.path || null, orient: node.orient || "perp", sdist: kind === "sweep" && node.dist != null ? node.dist : 1, taper: node.taper ?? 0, twist: node.twist ?? 0, chain: node.chain !== false }, exprsOf(node, ["dist", "dist2", "angle"])); // jumpstart-3d: parameters
      st.op = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).op : "new";
      const sk = findSk(store.doc, st.sketchId);
      if (sk) {
        const regs = regionsFor(sk);
        for (const ref of node.profiles || []) {
          const i = regs.findIndex((r) => r.key === ref.key && pointIn(r, ref.pt)) >= 0 ? regs.findIndex((r) => r.key === ref.key && pointIn(r, ref.pt)) : regs.findIndex((r) => pointIn(r, ref.pt));
          if (i >= 0) st.profiles.set(profileKey(sk.id, i), { index: i, ref });
        }
        if (st.axis && !WORLD_AXES[st.axis]) { const c = resolveSketch(sk).find((c) => c.id === st.axis); st.axisLine = c ? { a: c.a, b: c.b } : null; }
      }
      scene.state.forceSketch = st.sketchId;
      scene.syncSketches(store.view);
    }
    let hoverKey = null;
    let arrowDrag = null;
    const def = {
      title: (editing ? "Edit " : "") + KIND_NAME[kind],
      valid: () => st.profiles.size > 0 && (kind === "extrude" ? Math.abs(st.dist) > 1e-6 || st.mode === "two" : kind === "sweep" ? !!(st.path && st.path.ents.length) : !!st.axis && st.angle > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const node = featureNode(st);
        if (pendingSketch && pendingSketch.id === st.sketchId && !findSketch(doc, pendingSketch.id)) {
          const ps = JSON.parse(JSON.stringify(pendingSketch));
          ps.seq = nextSeq(doc);
          ps.name = nextSketchName(doc);
          doc.sketches.push(ps);
        }
        const sk = findSk(doc, st.sketchId);
        if (editing) {
          const b = findBody(doc, editing.body);
          if (editing.mod) {
            const m = b.node.mods.find((x) => x.id === editing.mod);
            m.tool = { ...node, mods: [] };
            m.op = st.op === "auto" || st.op === "new" ? m.op : st.op;
            if (app.previewing && m.op === "cut") showCut(doc, node);
          } else b.node = { ...node, mods: b.node.mods || [] };
          return;
        }
        const op = resolvedOp(doc, st);
        const parts = participants(doc, st);
        if (op === "new" || (op === "join" && !parts.length)) {
          doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, "Body"), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] }, ...(app.previewing ? { cmdPreview: true } : {}) });
        } else {
          if (!parts.length) throw new Error(op === "cut" ? "The profile doesn't reach any body to cut." : "The profile doesn't reach any body.");
          const targets = op === "join" ? [parts[0]] : parts;
          const seq = nextSeq(doc);
          for (const id of targets) {
            const b = findBody(doc, id);
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq, t: "bool", op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
          }
        }
        if (sk) sk.hidden = true;
        if (st.path) { const ps = findSk(doc, st.path.sketch); if (ps) ps.hidden = true; }
        if (app.previewing && op === "cut") showCut(doc, node);
      },
      ok() { commit(def, editing ? "Edit " + kind : KIND_NAME[kind]); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.pickPath ? (st.chain ? "Click a sketch line or arc for the path. Connected curves are added as one chain." : "Click sketch curves to add or remove them from the path.") : kind === "sweep" && st.profiles.size ? "Pick the path, then OK." : st.pickAxis ? "Click a straight sketch line to use as the axis, or pick X, Y or Z in the dialog." : st.profiles.size ? (kind === "extrude" ? "Drag the arrow or type a distance. Click a face or plane to extrude up to it. Click more profiles to add them." : "Pick the axis, then set the angle.") : kind === "extrude" ? "Click a flat face of a body to push or pull it, or click closed profiles in a sketch." : "Click one or more closed profiles in a sketch.",
      build(body) {
        body.append(pickbox(!st.pickAxis && !st.pickPath, st.profiles.size ? el("span", {}, el("b", {}, st.profiles.size), ` profile${st.profiles.size > 1 ? "s" : ""} selected`) : "Select profiles", st.profiles.size ? () => { st.profiles.clear(); st.sketchId = null; refresh(); } : null, () => { st.pickAxis = false; st.pickPath = false; def.render(); }));
        if (kind === "sweep") {
          swChain = st.chain;
          const n = st.path ? st.path.ents.length : 0;
          body.append(row("Path", pickbox(st.pickPath, n ? el("span", {}, el("b", {}, n), ` curve${n > 1 ? "s" : ""}`) : "Click a sketch path", n ? () => { st.path = null; st.pickPath = true; refresh(); } : null, () => { st.pickPath = true; def.render(); })));
          body.append(row("Orientation", seg([["perp", "Perpendicular"], ["parallel", "Parallel"]], st.orient, (v) => { st.orient = v; refresh(); }, "sw-orient")));
          body.append(el("label", { class: "check", title: "On: clicking a path curve selects every connected curve. Off: click curves one at a time." }, el("input", { type: "checkbox", id: "sw-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; swChain = st.chain; refresh(); } }), "Chain selection"));
          body.append(row("Distance", app.numField({ value: st.sdist, id: "sw-dist", min: 0.001, max: 1, step: 0.05, live: true, onCommit: (v) => { st.sdist = Math.min(1, Math.max(0.001, v)); refresh(false); } }), "sw-dist"));
          if (st.orient === "perp") {
            body.append(row("Taper angle", app.numField({ value: st.taper, id: "sw-taper", min: -89, max: 89, step: 1, angle: true, live: true, onCommit: (v) => { st.taper = v; refresh(false); } }), "sw-taper"));
            body.append(row("Twist angle", app.numField({ value: st.twist, id: "sw-twist", min: -3600, max: 3600, step: 5, angle: true, live: true, onCommit: (v) => { st.twist = v; refresh(false); } }), "sw-twist"));
          }
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Distance is a fraction of the path (0 to 1). Positive taper widens the sweep, negative narrows it. Twist is the total turn over the swept distance. Taper and twist need Perpendicular orientation, and the profile at the start of the path. Draw the profile and path in different sketches."));
        } else if (kind === "revolve") {
          body.append(row("Axis", pickbox(st.pickAxis, WORLD_AXES[st.axis] ? el("span", {}, el("b", {}, st.axis), " axis") : st.axis ? el("span", {}, el("b", {}, "1"), " sketch line") : "Click a sketch line", null, () => { st.pickAxis = true; def.render(); })));
          const sk = findSk(store.doc, st.sketchId);
          const axes = axesInPlane(sk);
          body.append(row("…or use", seg(axes.map((k) => [k, k + " axis"]), WORLD_AXES[st.axis] ? st.axis : null, (v) => { st.axis = v; st.axisLine = null; st.pickAxis = false; refresh(); }, "rv-axes")));
          body.append(row("Angle", app.numField({ value: st.angle, id: "rv-angle", min: 0.1, max: 360, step: 15, live: true, expr: exprOf(st, "angle"), angle: true, onCommit: (v, t) => { st.angle = v; setExpr(st, "angle", t, true); refresh(false); } }), "rv-angle")); // jumpstart-3d: parameters
        } else {
          body.append(row("Extent", seg([["dist", "Distance"], ["to", "To object"]], st.extent, (v) => { st.extent = v; if (v === "dist") { st.toRef = null; st.pickTo = false; } else { st.mode = "one"; st.pickTo = !st.toRef; } refresh(); }, "ex-extent")));
          if (st.extent === "to") body.append(row("Object", pickbox(!st.toRef, st.toRef ? el("span", {}, el("b", {}, st.toRef.label || "Surface")) : "Click a face or plane", st.toRef ? () => { st.toRef = null; st.pickTo = true; refresh(); } : null, () => { st.pickTo = true; def.render(); }), "ex-object"));
          else body.append(row("Direction", seg([["one", "One side"], ["sym", "Symmetric"], ["two", "Two sides"]], st.mode, (v) => { st.mode = v; refresh(); }, "ex-mode")));
          const dl = st.mode === "sym" ? "Total distance" : st.mode === "two" ? "Side 1" : "Distance";
          body.append(row(dl, (def.distInput = app.numField({ value: st.dist, id: "ex-dist", step: 1, live: true, expr: exprOf(st, "dist"), onCommit: (v, t) => { st.dist = v; setExpr(st, "dist", t); const was = st.extent === "to"; st.extent = "dist"; st.toRef = null; refresh(was); } })), "ex-dist"));
          if (st.mode === "two") body.append(row("Side 2", app.numField({ value: st.dist2, id: "ex-dist2", min: 0, step: 1, live: true, expr: exprOf(st, "dist2"), onCommit: (v, t) => { st.dist2 = v; setExpr(st, "dist2", t); refresh(false); } }), "ex-dist2")); // jumpstart-3d: parameters
        }
        if (!editing || editing.mod) {
          const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["auto", "Automatic"], ["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
          const sel = el("select", { class: "num", id: "ex-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
          sel.onchange = () => { st.op = sel.value; refresh(); };
          body.append(row("Operation", sel, "ex-op"));
          if (st.op === "auto") body.append(el("div", { class: "hint", id: "ex-hint", style: { padding: 0 } }, opHint()));
        }
      },
      start() {
        scene.syncSketches(store.view);
        if (!scene.regionMeshes().length && !editing && kind !== "extrude") app.toast("No visible sketch profiles. Create a sketch with a closed shape first.");
        refresh();
      },
      cleanup() { scene.state.forceSketch = null; pendingSketch = null; vp.afterRender.delete(placeTag); tag.remove(); },
      // typing a number anywhere goes straight into the distance (or revolve angle), like Fusion
      typeInto: () => (!st.profiles.size ? null : kind === "extrude" ? def.distInput : kind === "revolve" ? document.getElementById("rv-angle") : null),
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) {
          if (arrowDrag) return;
          if (st.pickAxis) { const l = pickSketchLine(e, st.sketchId); vp.canvas.style.cursor = l ? "pointer" : "default"; return; }
          // sweep: a click inside a profile adds/removes it, a click on a curve sets the path
          if (kind === "sweep") {
            const h = sweepPathHit(e);
            const key = h ? h.sketch + ":" + h.curve.id : null;
            if (key !== st.hoverPath) { st.hoverPath = key; st.hoverPathPts = h ? pathPts(h) : null; drawArrow(); }
            if (h || st.pickPath) { vp.canvas.style.cursor = h ? "pointer" : "default"; return; }
          }
          if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; }
          const hits = vp.pick(e, scene.regionMeshes());
          const k = hits.length ? profileKey(hits[0].object.userData.region.sketch, hits[0].object.userData.region.index) : null;
          // no sketch profile here: a flat face of a body can be pushed or pulled directly
          const hf = !k && kind === "extrude" && !editing && !st.profiles.size ? pickExtrudeFace(e) : null;
          const fk = hf ? hf.body + "#" + hf.face : null;
          if (fk !== st.hoverFace) { st.hoverFace = fk; drawArrow(); if (hf) drawFace(hf.base, hf.face, 0xe8a317); }
          // with a profile picked, a face or plane can be clicked to extrude up to it
          const hp = !k && kind === "extrude" && st.profiles.size ? pickRefPlane(e) : null;
          const hk = hp ? hp.label + hp.o.join() : "";
          if (hk !== st.hoverPlaneKey) { st.hoverPlaneKey = hk; st.hoverPlane = hp; drawArrow(); }
          vp.canvas.style.cursor = k || hf || st.hoverPlane ? "pointer" : "default";
          if (k !== hoverKey) { hoverKey = k; scene.highlightRegions(new Set(st.profiles.keys()), hoverKey); }
        },
        dblclick(e) {
          if (st.pickAxis || st.pickPath) return;
          const hits = vp.pick(e, scene.regionMeshes());
          if (!hits.length) return;
          const r = hits[0].object.userData.region;
          const skc = findSk(store.doc, r.sketch);
          if (!skc) return;
          if (st.sketchId && st.sketchId !== r.sketch) st.profiles.clear();
          st.sketchId = r.sketch;
          const regsC = regionsFor(skc);
          for (const j of shapeGroup(skc, r.index)) if (regsC[j]) st.profiles.set(profileKey(r.sketch, j), { index: j, ref: { key: regsC[j].key, pt: regsC[j].pt } });
          scene.state.forceSketch = st.sketchId;
          if (kind === "sweep") st.pickPath = false;
          refresh();
        },
        down(e) {
          const sweepCurve = kind === "sweep" ? sweepPathHit(e) : null;
          if (kind === "sweep" && (sweepCurve || st.pickPath)) {
            const h = sweepCurve;
            if (h) {
              const sk = findSk(store.view, h.sketch);
              const ids = st.chain ? pathChain(resolveSketch(sk), h.curve.id) : [h.curve.id];
              if (st.chain || !st.path || st.path.sketch !== h.sketch) st.path = { sketch: h.sketch, ents: ids };
              else { const cur = st.path.ents; st.path = { sketch: h.sketch, ents: cur.includes(ids[0]) ? cur.filter((x) => x !== ids[0]) : [...cur, ids[0]] }; }
              st.pickPath = false; st.hoverPath = null; st.hoverPathPts = null;
              refresh();
            }
            return true;
          }
          if (st.pickAxis) {
            const l = pickSketchLine(e, st.sketchId);
            if (l) { st.axis = l.id; st.axisLine = { a: l.a, b: l.b }; st.pickAxis = false; refresh(); }
            return true;
          }
          const ad = overArrow(e);
          if (ad) { arrowDrag = { ...ad, f: axisDragger(e, ad.origin, ad.n), v0: st.mode === "sym" ? st.dist / 2 : st.dist }; return true; }
          const hits = vp.pick(e, scene.regionMeshes());
          if (!hits.length) {
            if (kind === "extrude" && st.profiles.size) {
              const r = pickRefPlane(e);
              if (r) toObject(r);
              return true;
            }
            if (kind === "extrude" && !editing) {
              const f = pickExtrudeFace(e, true);
              if (f) faceProfile(f, e);
            }
            return true;
          }
          const r = hits[0].object.userData.region;
          const k = profileKey(r.sketch, r.index);
          if (st.sketchId && st.sketchId !== r.sketch) { st.profiles.clear(); st.axis = null; st.axisLine = null; }
          st.sketchId = r.sketch;
          // a click picks (or drops) just the piece under the pointer, as before; a double-click takes
          // every piece of that drawn shape (handy when a face's outline splits a shape into parts)
          const skc = findSk(store.doc, r.sketch), regsC = skc ? regionsFor(skc) : [];
          const group = [r.index];
          if (st.profiles.has(k)) for (const j of group) st.profiles.delete(profileKey(r.sketch, j));
          else for (const j of group) if (regsC[j]) st.profiles.set(profileKey(r.sketch, j), { index: j, ref: { key: regsC[j].key, pt: regsC[j].pt } });
          if (!st.profiles.size) st.sketchId = null;
          scene.state.forceSketch = st.sketchId;
          if (kind === "revolve" && st.profiles.size && !st.axis) st.pickAxis = true;
          if (kind === "sweep") st.pickPath = false; // profiles and the path can be picked in any order
          refresh();
          return true;
        },
        move(e) {
          if (!arrowDrag) return;
          let s = arrowDrag.v0 + arrowDrag.f(e);
          const g = app.gridStep() || 0.1;
          s = round(s, g >= 1 ? 1 : g);
          if (st.mode === "sym") s = Math.abs(s) * 2;
          st.extent = "dist"; st.toRef = null;
          st.dist = s || (st.dist > 0 ? g : -g);
          setExpr(st, "dist", null); // jumpstart-3d: parameters
          def.distInput && def.distInput.setValue(st.dist);
          refresh(false);
        },
        up() { arrowDrag = null; },
      },
    };
    // "To object": the distance from the profile to a parallel face or plane
    function toObject(r) {
      const sk = findSk(store.doc, st.sketchId) || pendingSketch;
      if (!sk) { app.toast("Pick a profile first."); return; }
      const sn = new THREE.Vector3(...sk.plane.n).normalize(), tn = new THREE.Vector3(...r.n).normalize();
      if (Math.abs(sn.dot(tn)) < 0.9999) { app.toast("Pick a flat face or plane that is parallel to the profile."); return; }
      const d = +new THREE.Vector3(...r.o).sub(new THREE.Vector3(...sk.plane.o)).dot(sn).toFixed(6);
      if (Math.abs(d) < 1e-6) { app.toast("That surface is on the same plane as the profile."); return; }
      Object.assign(st, { extent: "to", toRef: r, pickTo: false, mode: "one", dist: d, hoverPlane: null, hoverPlaneKey: "" });
      setExpr(st, "dist", null); // jumpstart-3d: parameters
      def.distInput && def.distInput.setValue(d);
      refresh();
    }
    // the distance shown at the arrow tip, with a reminder that it can simply be typed
    const tag = el("div", { class: "ex-tag", hidden: true });
    vp.labels.append(tag);
    function placeTag() {
      const a = def.arrow;
      if (!a || kind !== "extrude" || app.command !== def) { tag.hidden = true; return; }
      const s = vp.project(a.head || a.tip);
      tag.hidden = false;
      const typing = def.distInput && document.activeElement === def.distInput;
      tag.innerHTML = `<b>${withUnit(st.dist, 2)}</b><span>${typing ? "Enter to finish" : "type a number or drag"}</span>`;
      tag.style.transform = `translate(${Math.round(s[0] + 14)}px, ${Math.round(s[1] - 12)}px)`;
    }
    vp.afterRender.add(placeTag);
    function pickExtrudeFace(e, tell) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
      if (!f) return null;
      if (!f.info || f.info.t !== "PLANE") { if (tell) app.toast("Only flat faces can be extruded directly. Sketch on a plane to extrude other shapes."); return null; }
      return f;
    }
    // click a flat face: make a sketch of its outline and pick the region under the click
    function faceProfile(f, e) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Sketch", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      projectFaceEdges(sk, f);
      const regs = regionsFor(sk);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert());
      const pt = [q.x, q.y];
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, pt)) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      pendingSketch = sk;
      st.profiles.clear(); st.axis = null; st.axisLine = null;
      st.sketchId = sk.id;
      st.profiles.set(profileKey(sk.id, best), { index: best, ref: { key: regs[best].key, pt: regs[best].pt } });
      scene.state.forceSketch = sk.id;
      st.hoverFace = null;
      refresh();
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.head || a.tip);
      if (Math.hypot(s[0] - mx, s[1] - my) < vp.tol(big ? 30 : 14)) return a;
      if (!big) return null;
      // Beginner: the whole (thick) shaft can be grabbed too
      const o = vp.project(a.tip), dx = s[0] - o[0], dy = s[1] - o[1], t = Math.max(0, Math.min(1, ((mx - o[0]) * dx + (my - o[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(o[0] + dx * t - mx, o[1] + dy * t - my) < vp.tol(10) ? a : null;
    }
    // a sweep path pick: a sketch curve, unless the click is inside a profile of the same sketch
    function sweepPathHit(e) {
      const h = pickSketchCurve(e);
      if (!h) return null;
      if (st.pickPath) return h;
      // a click inside a profile picks the profile, even when the path line runs right through it
      // (a profile usually sits on the path's end, and the wide sketch lines are easy to touch);
      // the path can still be clicked anywhere outside the profiles, or picked with "Click a sketch path"
      const hits = vp.pick(e, scene.regionMeshes());
      return hits.length ? null : h;
    }
    function opHint() {
      if (!st.profiles.size) return "";
      return "Will " + { new: "create a new body", join: "join the body it touches", cut: "cut the bodies it passes through", intersect: "keep only the overlap" }[resolvedOp(store.doc, st)] + ".";
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      const h = document.getElementById("ex-hint");
      if (h) h.textContent = opHint();
      scene.highlightRegions(new Set(st.profiles.keys()), hoverKey);
      drawArrow();
      schedulePreview(def);
      app.status();
      if (def.arrow && !st.tilted) { st.tilted = true; tiltForDepth(def.arrow.n); }
    }
    function drawArrow() {
      clearOv();
      def.arrow = null;
      if (kind === "sweep") {
        for (const pl of sweepPathLines(st)) drawLine(pl, 0x2f66c8);
        for (const pl of st.hoverPathPts || []) drawLine(pl, 0xe8a317);
        return;
      }
      if (!st.profiles.size) return;
      const sk = findSk(store.doc, st.sketchId);
      if (!sk) return;
      const regs = regionsFor(sk);
      const M = planeMatrix(sk.plane);
      if (kind === "sweep") {
        for (const pl of sweepPathLines(st)) drawLine(pl, 0x2f66c8);
        for (const pl of st.hoverPathPts || []) drawLine(pl, 0xe8a317);
        return;
      }
      // axis line for revolve
      if (kind === "revolve") {
        const ax = revolveAxisWorld(st, M);
        if (ax) {
          const d = ax.b.clone().sub(ax.a).normalize().multiplyScalar(Math.max(60, vp.view.dist * 0.4));
          drawLine(WORLD_AXES[st.axis] ? [ax.a.clone().sub(d), ax.a.clone().add(d)] : [ax.a, ax.b], 0xe8a317);
        }
        return;
      }
      // a bold outline around the picked profiles, drawn over everything, so they stand out
      // from the faces around them
      const seg = [];
      const loop = (poly) => { for (let i = 0; i < poly.length; i++) { const a = new THREE.Vector3(poly[i][0], poly[i][1], 0).applyMatrix4(M), b = new THREE.Vector3(poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1], 0).applyMatrix4(M); seg.push(a.x, a.y, a.z, b.x, b.y, b.z); } };
      for (const p of st.profiles.values()) { const r = regs[p.index]; if (r) { loop(r.poly); (r.holePolys || []).forEach(loop); } }
      if (seg.length) { const o = thickLines(seg, 0x1f6fff, 4, false); o.renderOrder = 15; ov.add(o); }
      let cx = 0, cy = 0, n0 = 0;
      for (const p of st.profiles.values()) { const r = regs[p.index]; if (r) { cx += r.pt[0]; cy += r.pt[1]; n0++; } }
      if (!n0) return;
      const origin = new THREE.Vector3(cx / n0, cy / n0, 0).applyMatrix4(M);
      const n = new THREE.Vector3(...sk.plane.n).normalize();
      const len = st.mode === "sym" ? st.dist / 2 : st.dist;
      const tip = origin.clone().addScaledVector(n, len);
      const ps = vp.pixelSize(tip);
      // Beginner: a big handle standing out from the extruded face, the same size at any zoom
      const head = big ? tip.clone().addScaledVector(n, (Math.sign(len) || 1) * ps * 58) : tip;
      if (big) { const o = thickLines([origin.x, origin.y, origin.z, head.x, head.y, head.z], 0x1f4fa8, 7, false); o.renderOrder = 999; ov.add(o); }
      else drawLine([origin, tip], 0x1f4fa8);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(ps * (big ? 11 : 6));
      cone.position.copy(head);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(len) || 1));
      cone.renderOrder = big ? 1000 : 14; // (Beginner's big arrow is drawn over the workplane)
      ov.add(cone);
      def.arrow = { origin, n, tip, head };
      if (st.toRef) { drawRefPlane(st.toRef, 0x1f4fa8); if (st.toRef.face) drawFace(st.toRef.face.base, st.toRef.face.face, 0x1f4fa8); }
      if (st.hoverPlane) { drawRefPlane(st.hoverPlane, 0xe8a317); if (st.hoverPlane.face) drawFace(st.hoverPlane.face.base, st.hoverPlane.face.face, 0xe8a317); }
    }
    // opened by itself when a Beginner sketch closed a shape: Cancel goes back to the sketch
    if (opts.backToSketch && opts.sketch) def.onCancel = () => setTimeout(() => { if (!app.command && app.mode === "beginner" && findSketch(store.doc, opts.sketch)) app.enterSketch(opts.sketch); }, 0);
    openCmd(def);
  }
  function pointIn(r, pt) {
    const inside = (poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    return inside(r.poly) && !r.holePolys.some(inside);
  }
  function pickSketchLine(e, sketchId) {
    const docSk = store.view.sketches.filter((s) => !sketchId || s.id === sketchId);
    const [mx, my] = vp.local(e);
    let best = null, bd = vp.tol(9);
    for (const sk of docSk) {
      const M = planeMatrix(sk.plane);
      for (const c of resolveSketch(sk)) {
        if (c.t !== "line") continue;
        const a = vp.project(new THREE.Vector3(c.a[0], c.a[1], 0).applyMatrix4(M)), b = vp.project(new THREE.Vector3(c.b[0], c.b[1], 0).applyMatrix4(M));
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a[0] + dx * t - mx, a[1] + dy * t - my);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ Fillet / Chamfer
  // Like Fusion 360: Fillet or Chamfer type, several selection sets each with its own size,
  // constant / chord-length / variable radius, edges or whole faces, and tangent chain.
  function edgeCmd(kind, editing = null) {
    const st = { kind, sets: [], active: 0, chain: true, editing };
    const newSet = (value) => ({ items: [], keep: null, value, value2: value, rt: "const" });
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      const sets = m.sets && m.sets.length ? m.sets : [{ edges: m.edges, r: kind === "fillet" ? m.r : m.d }];
      st.sets = sets.map((x) => ({ items: [], keep: x.edges || [], value: x.r, value2: x.r2 ?? x.r, rt: x.rt || "const" }));
      st.chain = m.chain !== false;
      Object.assign(st.sets[0], exprsOf(m, [kind === "fillet" ? "r" : "d"], ["r"])); // jumpstart-3d: parameters
      st.lockedBody = b.id;
    } else st.sets = [newSet(kind === "fillet" ? 2 : 1)];
    const cur = () => st.sets[Math.min(st.active, st.sets.length - 1)];
    const isF = () => st.kind === "fillet";
    let hover = null, arrowDrag = null;
    const count = (s) => (s.items.length ? s.items.length : s.keep ? s.keep.length : 0);
    const def = {
      title: (editing ? "Edit " : "") + (kind === "fillet" ? "Fillet" : "Chamfer"),
      valid: () => st.sets.some((s) => count(s) > 0) && st.sets.every((s) => !count(s) || (s.value > 0 && (s.rt !== "variable" || s.value2 > 0))),
      canOk: () => def.valid(),
      apply(doc) {
        // sets per body: [{ edges, r, r2, rt }]
        const sigsOf = (s) => (s.items.length ? s.items.map((e) => ({ body: e.body, info: e.info })) : (s.keep || []).map((info) => ({ body: editing && editing.body, info })));
        const byBody = new Map();
        for (const s of st.sets) {
          const sigs = sigsOf(s);
          if (!sigs.length) continue;
          const per = new Map();
          for (const g of sigs) { if (!per.has(g.body)) per.set(g.body, []); per.get(g.body).push(g.info); }
          for (const [body, edges] of per) {
            if (!byBody.has(body)) byBody.set(body, []);
            byBody.get(body).push({ edges, r: s.value, ...(s === st.sets[0] && { exprs: s.exprs, exprUnits: s.exprUnits }), ...(isF() && s.rt === "variable" ? { r2: s.value2, rt: "variable" } : isF() && s.rt === "chord" ? { rt: "chord" } : {}) }); // jumpstart-3d: parameters
          }
        }
        const modOf = (sets) => {
          const fx = exprsOf(sets[0], ["r"], [isF() ? "r" : "d"]); // jumpstart-3d: parameters
          sets = sets.map(({ exprs, exprUnits, ...x }) => x);
          const m = { t: st.kind, edges: sets[0].edges, chain: st.chain ? undefined : false, ...fx };
          if (st.kind === "fillet") m.r = sets[0].r; else m.d = sets[0].r;
          if (sets.length > 1 || sets[0].rt) m.sets = sets;
          return m;
        };
        if (editing) {
          const b = findBody(doc, editing.body);
          const i = b.node.mods.findIndex((x) => x.id === editing.mod);
          const sets = byBody.get(editing.body);
          if (i >= 0 && sets) { const old = b.node.mods[i]; b.node.mods[i] = { id: old.id, seq: old.seq, ...modOf(sets) }; }
          return;
        }
        const seq = nextSeq(doc);
        for (const [id, sets] of byBody) {
          const b = findBody(doc, id);
          b.node.mods = b.node.mods || [];
          b.node.mods.push({ id: uid("f"), seq, ...modOf(sets) });
        }
      },
      ok() { commit(def, isF() ? "Fillet" : "Chamfer"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      // a build error like "too large… about 4.8 mm" gets a button to use that size
      onBuildError(msg, box) {
        const m = /about ([\d.]+) mm/.exec(msg);
        if (!m || box.querySelector("button")) return;
        const v = +m[1];
        box.append(el("button", { class: "btn", style: { marginTop: "6px" }, onclick: () => { cur().value = v; setExpr(cur(), "r", null); if (cur().value2 > v && cur().rt === "variable") cur().value2 = v; refresh(); } }, `Use ${fmt(v, 2)} mm`)); // jumpstart-3d: parameters
      },
      typeInto: () => (count(cur()) ? def.valInput : null),
      hint: () => editing && !cur().items.length ? "Drag the arrow or type a size, or click edges to pick a new set." : count(cur()) ? "Drag the arrow or type a size. Click edges or faces to add them; click again to remove. + adds a set with its own size." : "Click edges, or a face to take all its edges. Click again to remove.",
      build(body) {
        body.append(row("Type", seg([["fillet", "Fillet"], ["chamfer", "Chamfer"]], st.kind, (v) => { st.kind = v; def.title = (editing ? "Edit " : "") + (v === "fillet" ? "Fillet" : "Chamfer"); refresh(); }, "ed-type")));
        // selection sets, like Fusion's list with + and ×
        const list = el("div", { class: "edge-sets" });
        st.sets.forEach((s, i) => {
          const n = count(s);
          const label = `${n ? n : "No"} edge${n === 1 ? "" : "s"}` + (n ? ` · ${s.rt === "variable" && isF() ? fmt(s.value, 2) + "–" + fmt(s.value2, 2) : fmt(s.value, 2)} mm${s.rt === "chord" && isF() ? " chord" : ""}` : "");
          const r = el("div", { class: "edge-set" + (i === st.active ? " on" : ""), onclick: () => { st.active = i; refresh(); } }, el("span", { class: "sw", style: { background: SET_COLORS[i % SET_COLORS.length] } }), el("span", { class: "nm" }, `Set ${i + 1}: `, el("b", {}, label)));
          if (st.sets.length > 1) r.append(el("button", { class: "x", title: "Remove this set", "aria-label": "Remove set " + (i + 1), onclick: (e) => { e.stopPropagation(); st.sets.splice(i, 1); st.active = Math.max(0, Math.min(st.active, st.sets.length - 1)); refresh(); } }, "×"));
          else if (n) r.append(el("button", { class: "x", title: "Clear the selection", "aria-label": "Clear", onclick: (e) => { e.stopPropagation(); s.items = []; s.keep = editing ? s.keep : null; if (!editing) s.keep = null; refresh(); } }, "×"));
          list.append(r);
        });
        list.append(el("button", { class: "btn add-set", id: "ed-addset", title: "Add a selection set with its own size", onclick: () => { st.sets.push(newSet(cur().value)); st.active = st.sets.length - 1; refresh(); } }, "+ Add set"));
        body.append(list);
        const s = cur();
        if (isF()) body.append(row("Radius type", seg([["const", "Constant"], ["chord", "Chord length"], ["variable", "Variable"]], s.rt, (v) => { s.rt = v; refresh(); }, "ed-rtype")));
        const lab = !isF() ? "Distance" : s.rt === "chord" ? "Chord length" : s.rt === "variable" ? "Start radius" : "Radius";
        body.append(row(lab, (def.valInput = app.numField({ value: s.value, id: "ed-val", min: 0.001, step: 0.5, live: true, ...(s === st.sets[0] && { expr: exprOf(s, "r") }), onCommit: (v, t) => { s.value = v; setExpr(s, "r", t); refresh(false); } })), "ed-val")); // jumpstart-3d: parameters
        if (isF() && s.rt === "variable") body.append(row("End radius", app.numField({ value: s.value2, id: "ed-val2", min: 0.001, step: 0.5, live: true, onCommit: (v) => { s.value2 = v; refresh(false); } }), "ed-val2"));
        body.append(el("label", { class: "check", title: "Picking an edge also takes the edges that run smoothly on from it" }, el("input", { type: "checkbox", id: "ed-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; } }), "Tangent chain"));
        if (isF() && s.rt === "chord") body.append(el("div", { class: "hint", style: { padding: 0 } }, "Chord length is the straight distance across the rounded edge."));
        if (isF() && s.rt === "variable") body.append(el("div", { class: "hint", style: { padding: 0 } }, "The radius changes smoothly from start to end along each edge."));
      },
      start() { refresh(); },
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        move(e) {
          if (!arrowDrag) return;
          const sv = arrowDrag.v0 + arrowDrag.f(e);
          const g = app.gridStep();
          const step = g >= 1 ? 0.5 : g > 0 ? g : 0.01;
          cur().value = Math.max(step, round(sv, step));
          setExpr(cur(), "r", null); // jumpstart-3d: parameters
          def.valInput && def.valInput.setValue(cur().value);
          refresh(false);
        },
        up() { if (arrowDrag) { arrowDrag = null; vp.canvas.style.cursor = "default"; } },
        hover(e) {
          if (arrowDrag) return;
          if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; }
          const h = pickTarget(e);
          const k = h ? h.key : null;
          if (k !== (hover && hover.key)) { hover = h; draw(); }
          vp.canvas.style.cursor = h ? "pointer" : "default";
        },
        leave() { if (hover) { hover = null; draw(); } },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { ...a, f: axisDragger(e, a.origin, a.n), v0: cur().value }; vp.canvas.style.cursor = "grabbing"; return true; }
          const h = pickTarget(e);
          if (!h) return true;
          const s = cur();
          if (editing && !s.items.length) s.keep = null; // clicking edges picks a new set of edges
          const has = (ei) => s.items.findIndex((x) => x.body === h.body && x.edge === ei);
          // a click on something already picked removes it (all of it, for a face or chain)
          if (h.edges.every((ei) => has(ei) >= 0)) s.items = s.items.filter((x) => !(x.body === h.body && h.edges.includes(x.edge)));
          else {
            // an edge belongs to one set only
            for (const o of st.sets) if (o !== s) o.items = o.items.filter((x) => !(x.body === h.body && h.edges.includes(x.edge)));
            for (const ei of h.edges) if (has(ei) < 0) s.items.push({ body: h.body, edge: ei, info: h.base.data.edgeInfo[ei], pts: edgeWorldPts(h.base, ei) });
          }
          refresh();
          return true;
        },
      },
    };
    // an edge (plus its tangent chain) or, away from edges, a whole face's edges
    function pickTarget(e) {
      const filter = (b) => !b.hole && !b.locked && (!st.lockedBody || b.id === st.lockedBody);
      const eh = pickBaseEdge(e, filter);
      if (eh) {
        const edges = st.chain ? tangentChainEdges(eh.base, eh.edge) : [eh.edge];
        return { key: eh.body + ":e" + eh.edge, body: eh.body, base: eh.base, edges, face: null };
      }
      const fh = pickBaseFace(e, filter);
      const fe = fh && fh.base.data.faceEdges && fh.base.data.faceEdges[fh.face];
      if (fe && fe.length) return { key: fh.body + ":f" + fh.face, body: fh.body, base: fh.base, edges: fe.slice(), face: fh.face };
      return null;
    }
    // where the drag arrow sits: the middle of the active set's first edge, pointing into the body
    function arrowAnchor() {
      const s = cur();
      let pts, bodyId;
      if (s.items.length) { pts = s.items[0].pts; bodyId = s.items[0].body; }
      else if (editing && s.keep && s.keep[0]) {
        const b = findBody(store.doc, editing.body);
        const sig = s.keep[0];
        const M = M4(b.m);
        pts = [new THREE.Vector3(...sig.a).applyMatrix4(M), new THREE.Vector3(...sig.m).applyMatrix4(M), new THREE.Vector3(...sig.b).applyMatrix4(M)];
        bodyId = b.id;
      } else return null;
      let total = 0;
      for (let k = 1; k < pts.length; k++) total += pts[k].distanceTo(pts[k - 1]);
      let acc = 0, mid = pts[0].clone(), t = new THREE.Vector3(1, 0, 0);
      for (let k = 1; k < pts.length; k++) {
        const seg = pts[k].distanceTo(pts[k - 1]);
        if (acc + seg >= total / 2 && seg > 0) { mid = pts[k - 1].clone().lerp(pts[k], (total / 2 - acc) / seg); t = pts[k].clone().sub(pts[k - 1]).normalize(); break; }
        acc += seg;
      }
      const b = findBody(store.doc, bodyId);
      const box = b && scene.boxWithMatrix(bodyId, M4(b.m));
      if (!box) return null;
      const n = box.getCenter(new THREE.Vector3()).sub(mid);
      n.sub(t.clone().multiplyScalar(n.dot(t)));
      if (n.lengthSq() < 1e-12) return null;
      n.normalize();
      return { origin: mid, n };
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.tip);
      return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null;
    }
    function thick(ptsList, color, w) {
      const seg = [];
      for (const pts of ptsList) for (let k = 0; k < pts.length - 1; k++) seg.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
      if (!seg.length) return;
      const o = thickLines(seg, color, w, false);
      o.renderOrder = 15;
      ov.add(o);
    }
    function draw() {
      clearOv();
      st.sets.forEach((s, i) => thick(s.items.map((e) => e.pts), SET_COLOR_HEX[i % SET_COLOR_HEX.length], i === st.active ? 4 : 3));
      if (hover) thick(hover.edges.map((ei) => edgeWorldPts(hover.base, ei)), 0xe8a317, 4);
      def.arrow = null;
      const an = arrowAnchor();
      if (an) {
        const tip = an.origin.clone().addScaledVector(an.n, cur().value);
        drawLine([an.origin, tip], 0x1f4fa8);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
        cone.scale.setScalar(vp.pixelSize(tip) * 6);
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), an.n);
        cone.renderOrder = 14;
        ov.add(cone);
        def.arrow = { origin: an.origin, n: an.n, tip };
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      else {
        // keep the active set's size label in step while typing or dragging
        const s = cur(), n = count(s), b = panel.querySelector(".edge-set.on .nm b");
        if (b && n) b.textContent = `${n} edge${n === 1 ? "" : "s"} · ${s.rt === "variable" && isF() ? fmt(s.value, 2) + "–" + fmt(s.value2, 2) : fmt(s.value, 2)} mm${s.rt === "chord" && isF() ? " chord" : ""}`;
      }
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  const SET_COLORS = ["#1f6fff", "#2f8a4c", "#8a5cd0", "#d9480f", "#0e9aa7"];
  const SET_COLOR_HEX = SET_COLORS.map((c) => parseInt(c.slice(1), 16));
  // edges that run on smoothly (tangent) from edge ei, through shared end points
  function tangentChainEdges(base, ei) {
    const groups = base.data.edgeGroups, L = base.data.lines;
    const P = (i) => [L[i * 3], L[i * 3 + 1], L[i * 3 + 2]];
    const ends = groups.map(([s, c]) => {
      const a = P(s), b = P(s + c - 1), a2 = P(Math.min(s + 1, s + c - 1)), b2 = P(Math.max(s, s + c - 2));
      const dir = (p, q) => { const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...d) || 1; return d.map((x) => x / l); };
      return { a, b, ta: dir(a, a2), tb: dir(b, b2), closed: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6 };
    });
    let size = 0;
    for (const e of ends) size = Math.max(size, Math.abs(e.a[0]), Math.abs(e.a[1]), Math.abs(e.a[2]));
    const tol = Math.max(1e-4, size * 1e-5);
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol;
    const out = new Set([ei]);
    const queue = [ei];
    while (queue.length) {
      const i = queue.pop();
      const E = ends[i];
      if (E.closed) continue;
      for (const [p, t] of [[E.a, E.ta], [E.b, E.tb]]) {
        // t points into edge i from p; a smooth continuation leaves p the opposite way
        const meet = [];
        ends.forEach((o, j) => { if (j === i || o.closed) return; if (same(o.a, p)) meet.push([j, o.ta]); else if (same(o.b, p)) meet.push([j, o.tb]); });
        for (const [j, tj] of meet) {
          if (out.has(j)) continue;
          const dot = t[0] * tj[0] + t[1] * tj[1] + t[2] * tj[2];
          if (dot < -0.996) { out.add(j); queue.push(j); }
        }
      }
    }
    return [...out];
  }

  // ------------------------------------------------------------------ Hole
  // standard screw sizes: clearance (normal fit), ISO 4762 counterbores, ISO 10642 countersinks (+0.4), coarse taps
  const CLEAR = { M2: 2.4, "M2.5": 2.9, M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5 };
  const CBORE = { M2: [4.4, 2.3], "M2.5": [5.5, 2.8], M3: [6.5, 3.3], M4: [8, 4.4], M5: [9.5, 5.4], M6: [11, 6.4], M8: [14.5, 8.6], M10: [17.5, 10.7], M12: [20, 12.8] };
  const CSINK = { M2: 4.8, "M2.5": 5.9, M3: 7.1, M4: 9.4, M5: 11.6, M6: 13.8, M8: 18.3, M10: 22.8, M12: 27.3 };
  const TAP = { M2: [2, 0.4], "M2.5": [2.5, 0.45], M3: [3, 0.5], M4: [4, 0.7], M5: [5, 0.8], M6: [6, 1], M8: [8, 1.25], M10: [10, 1.5], M12: [12, 1.75], M16: [16, 2], M20: [20, 2.5] };
  // inch screws (sizes in mm): close-fit clearance, socket-head counterbore, 82° flat-head countersink
  const IN = 25.4;
  const IN_SCREWS = [["#4", 0.112, 0.120, 0.219, 0.112, 0.225], ["#6", 0.138, 0.144, 0.250, 0.138, 0.279], ["#8", 0.164, 0.170, 0.281, 0.164, 0.332], ["#10", 0.190, 0.196, 0.328, 0.190, 0.385],
    ["1/4", 0.250, 0.257, 0.406, 0.250, 0.507], ["5/16", 0.3125, 0.323, 0.500, 0.3125, 0.635], ["3/8", 0.375, 0.386, 0.594, 0.375, 0.762], ["1/2", 0.500, 0.516, 0.812, 0.500, 1.007]];
  for (const [k, , c, cb, cbh, cs] of IN_SCREWS) { CLEAR[k] = +(c * IN).toFixed(3); CBORE[k] = [+(cb * IN).toFixed(3), +(cbh * IN).toFixed(3)]; CSINK[k] = +(cs * IN).toFixed(3); }
  // inch tapped holes: the UNC / UNF sizes below, [major diameter mm, pitch mm]
  const isInchKey = (k) => /^#|\//.test(k);
  function holeCmd(editing = null) {
    const st = { at: [], body: null, kind: "simple", dia: 3.4, through: true, depth: 10, cbDia: 6.5, cbDepth: 3.3, csDia: 6.9, csAngle: 90, size: "M3", pitch: 0.5, clear: store.doc.threadOffset || 0, tip: false };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { kind: m.tapped ? "tapped" : m.kind, dia: m.dia, through: !!m.through, depth: m.depth || 10, cbDia: m.cbDia || 9, cbDepth: m.cbDepth || 3, csDia: m.csDia || 10, csAngle: m.csAngle || 90, body: b.id, size: m.size || "", pitch: m.pitch || 0.5, clear: m.clear || 0, tip: !!m.tip }, exprsOf(m, ["dia", "depth"])); // jumpstart-3d: parameters
      const M = M4(b.m);
      st.at = (m.at || [{ p: m.p, n: m.n }]).map((s) => ({ ...s, world: new THREE.Vector3(...s.p).applyMatrix4(M) }));
    }
    function applySize(k) {
      setExpr(st, "dia", null); // jumpstart-3d: parameters
      if (st.kind === "tapped") { const t = TAP[k]; if (!t) return; st.pitch = t[1]; st.dia = +(t[0] - 1.0825 * t[1]).toFixed(3); return; }
      if (!CLEAR[k]) return;
      st.dia = CLEAR[k];
      if (CBORE[k]) { st.cbDia = CBORE[k][0]; st.cbDepth = CBORE[k][1]; }
      if (CSINK[k]) { st.csDia = CSINK[k]; st.csAngle = isInchKey(k) ? 82 : 90; }
    }
    if (!editing) applySize(st.size);
    let hoverPt = null;
    const def = {
      title: (editing ? "Edit " : "") + "Hole",
      valid: () => st.at.length > 0 && st.dia > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const tapped = st.kind === "tapped";
        const params = { kind: tapped ? "simple" : st.kind, dia: st.dia, through: st.through, depth: st.depth, cbDia: st.cbDia, cbDepth: st.cbDepth, csDia: st.csDia, csAngle: st.csAngle, size: st.size, tapped, pitch: tapped ? st.pitch : 0, clear: tapped ? st.clear : 0, tip: !st.through && st.tip, at: st.at.map((s) => ({ p: s.p, n: s.n })), ...exprsOf(st, st.through ? ["dia"] : ["dia", "depth"]) }; // jumpstart-3d: parameters
        const b = findBody(doc, st.body);
        if (!b) throw new Error("Click a flat face to place the hole.");
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); delete m.exprs; delete m.exprUnits; Object.assign(m, params); return; } // jumpstart-3d: parameters
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "hole", ...params });
      },
      ok() { commit(def, "Hole"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => "Click flat faces to place holes. They snap to face centers, circular edges and sketch points.",
      build(body) {
        body.append(pickbox(true, st.at.length ? el("span", {}, el("b", {}, st.at.length), ` position${st.at.length > 1 ? "s" : ""}`) : "Click a face to place", st.at.length && !editing ? () => { st.at = []; st.body = null; refresh(); } : null));
        const kinds = seg([["simple", "Simple"], ["cbore", "Counterbore"], ["csink", "Countersink"], ["tapped", "Tapped"]], st.kind, (v) => { st.kind = v; if (st.size) applySize(st.size); refresh(); }, "hole-kind");
        kinds.classList.add("seg-wide");
        body.append(el("div", { class: "subhead" }, "Hole type"), kinds);
        const sizes = st.kind === "tapped" ? Object.keys(TAP) : Object.keys(CLEAR);
        const label = (k) => st.kind === "tapped" ? (isInchKey(k) ? `${k} (${TAP[k][2]})` : `${k} × ${TAP[k][1]}`) : k + (st.kind === "simple" ? ` clearance (${withUnit(CLEAR[k], 3)})` : "");
        const opt = (k) => el("option", { value: k, selected: k === st.size }, label(k));
        const met = sizes.filter((k) => !isInchKey(k)), inch = sizes.filter(isInchKey);
        const groups = [el("optgroup", { label: "Metric (ISO)" }, ...met.map(opt)), el("optgroup", { label: "Inch (UNC / UNF)" }, ...inch.map(opt))];
        if (getUnit() === "in") groups.reverse();
        const ssel = el("select", { class: "num", id: "hole-size", "aria-label": "Screw size" }, el("option", { value: "" }, "Custom"), ...groups);
        ssel.onchange = () => { st.size = ssel.value; if (st.size) applySize(st.size); refresh(); };
        body.append(row(st.kind === "tapped" ? "Thread" : "Screw size", ssel, "hole-size"));
        const custom = (f) => (v, t) => { f(v, t); st.size = ""; const s2 = document.getElementById("hole-size"); if (s2) s2.value = ""; refresh(false); }; // jumpstart-3d: parameters
        body.append(row(st.kind === "tapped" ? "Tap drill" : "Diameter", app.numField({ value: st.dia, id: "hole-dia", min: 0.01, step: 0.1, live: true, expr: exprOf(st, "dia"), onCommit: custom((v, t) => { st.dia = v; setExpr(st, "dia", t); }) }), "hole-dia")); // jumpstart-3d: parameters
        if (st.kind === "tapped") {
          body.append(pitchRow(st.pitch, custom((v) => (st.pitch = v)), "hole-pitch", true));
          body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; refresh(false); }, "hole-clear"), "hole-clear"));
        }
        body.append(row("Extent", seg([[true, "Through all"], [false, "Depth"]], st.through, (v) => { st.through = v; refresh(); }, "hole-ext")));
        if (!st.through) {
          body.append(row("Depth", app.numField({ value: st.depth, id: "hole-depth", min: 0.01, step: 1, live: true, expr: exprOf(st, "depth"), onCommit: (v, t) => { st.depth = v; setExpr(st, "depth", t); refresh(false); } }), "hole-depth")); // jumpstart-3d: parameters
          body.append(row("Bottom", seg([[false, "Flat"], [true, "118° drill"]], st.tip, (v) => { st.tip = v; refresh(); }, "hole-tip")));
        }
        if (st.kind === "cbore") {
          body.append(row("Bore dia.", app.numField({ value: st.cbDia, id: "hole-cbd", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.cbDia = v)) }), "hole-cbd"));
          body.append(row("Bore depth", app.numField({ value: st.cbDepth, id: "hole-cbh", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.cbDepth = v)) }), "hole-cbh"));
        }
        if (st.kind === "csink") {
          body.append(row("Sink dia.", app.numField({ value: st.csDia, id: "hole-csd", min: 0.01, step: 0.5, live: true, onCommit: custom((v) => (st.csDia = v)) }), "hole-csd"));
          body.append(row("Sink angle", app.numField({ value: st.csAngle, id: "hole-csa", min: 1, max: 179, step: 1, live: true, onCommit: custom((v) => (st.csAngle = v)) }), "hole-csa"));
        }
        if (st.kind === "tapped") body.append(el("p", { class: "hint" }, "Cuts real threads inside the hole, ready for a printed or metal screw. A print offset loosens them for 3D printing."));
        if (st.at.length === 1) {
          body.append(el("div", { class: "subhead" }, "Position (body coordinates)"));
          const r3 = el("div", { class: "row3" });
          ["X", "Y", "Z"].forEach((lab, i) => r3.append(el("label", {}, lab, app.numField({ value: st.at[0].p[i], id: "hole-p" + i, step: 0.5, onCommit: (v) => {
            st.at[0].p = st.at[0].p.slice(); st.at[0].p[i] = v;
            const b = findBody(store.doc, st.body);
            st.at[0].world = new THREE.Vector3(...st.at[0].p).applyMatrix4(M4(b.m));
            refresh(false);
          } }))));
          body.append(r3);
        }
      },
      start() { refresh(); },
      handler: {
        hover(e) { hoverPt = locate(e); draw(); vp.canvas.style.cursor = hoverPt ? "crosshair" : "default"; },
        down(e) {
          const l = locate(e);
          if (!l) return true;
          if (st.body && l.body !== st.body) { app.toast("One hole feature works on one body. Finish this one first."); return true; }
          st.body = l.body;
          st.at.push({ p: l.p, n: l.n, world: l.world });
          refresh();
          return true;
        },
      },
    };
    function locate(e) {
      // sketch points first
      const [mx, my] = vp.local(e);
      for (const sk of store.view.sketches) {
        if (sk.hidden || !scene.showSketches) continue;
        const M = planeMatrix(sk.plane);
        const n = new THREE.Vector3(...sk.plane.n).normalize();
        for (const c of resolveSketch(sk)) {
          const p2 = c.t === "point" ? c.p : c.t === "circle" ? c.c : null;
          if (!p2) continue;
          const w = new THREE.Vector3(p2[0], p2[1], 0).applyMatrix4(M);
          const s = vp.project(w);
          if (Math.hypot(s[0] - mx, s[1] - my) > vp.tol(9)) continue;
          // find the body under this point along the sketch normal
          const ray = new THREE.Raycaster(w.clone().addScaledVector(n, 1000), n.clone().negate());
          const list = bases((b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          const hit = ray.intersectObjects(list.map(pickMesh), false)[0];
          if (!hit) continue;
          const base = hit.object.userData.base;
          const inv = base.m.clone().invert();
          return { body: base.body.id, p: hit.point.clone().applyMatrix4(inv).toArray(), n: n.clone().transformDirection(inv).toArray(), world: hit.point.clone() };
        }
      }
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
      if (!f || !f.info || f.info.t !== "PLANE") return null;
      const inv = f.base.m.clone().invert();
      let local = f.point.clone().applyMatrix4(inv);
      const nL = new THREE.Vector3(...f.info.n);
      // snap: face center, circular edge centers on this face, grid in face plane
      const tol = vp.pixelSize(f.point) * 10;
      const cands = [new THREE.Vector3(...f.info.c)];
      f.base.data.edgeInfo.forEach((ei) => {
        if (ei.t === "CIRCLE" && d2(ei.a, ei.b) < 1e-6 && Math.abs(ei.a[0] - ei.b[0]) < 1e-6 && Math.abs(ei.a[2] - ei.b[2]) < 1e-6) {
          const c = new THREE.Vector3((ei.a[0] + ei.m[0]) / 2, (ei.a[1] + ei.m[1]) / 2, (ei.a[2] + ei.m[2]) / 2);
          if (Math.abs(c.clone().sub(local).dot(nL)) < 1e-4) cands.push(c);
        }
      });
      let snapped = false;
      for (const c of cands) if (c.distanceTo(local) < tol) { local = c.clone(); snapped = true; break; }
      if (!snapped) {
        const g = app.gridStep();
        if (g > 0 && Math.abs(nL.z) > 0.999) { local.x = round(local.x, g); local.y = round(local.y, g); }
      }
      return { body: f.body, p: local.toArray(), n: nL.toArray(), world: local.clone().applyMatrix4(f.base.m) };
    }
    function draw() {
      clearOv();
      for (const s of st.at) drawDot(s.world, 0x1f4fa8, 10);
      if (hoverPt) drawDot(hoverPt.world, 0xe8a317, 9);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Construction planes
  const V3 = (a) => new THREE.Vector3(...a);
  const arr3 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(9)));
  // a reference plane under the pointer: a construction plane, a flat body face or an origin plane
  function pickRefPlane(e) {
    const cands = [];
    const ph = vp.pick(e, scene.planeMeshes())[0];
    if (ph) { const p = (store.doc.planes || []).find((q) => q.id === ph.object.userData.cplane); if (p) cands.push({ d: ph.distance, ref: { ...p.plane, center: p.plane.o, size: p.size, label: p.name, cplane: p.id } }); }
    const f = pickBaseFace(e);
    if (f && f.info && f.info.t === "PLANE") {
      const pl = planeFromFace(f);
      const c = V3(f.info.c).applyMatrix4(f.base.m);
      const bb = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(f.base.data.vertices, 3)).applyMatrix4(f.base.m);
      const size = Math.max(20, bb.getSize(new THREE.Vector3()).length() * 0.8);
      cands.push({ d: f.distance, ref: { ...pl, o: arr3(c), center: arr3(c), size, label: "Face", face: f } });
    }
    // a sketch: click one of its shapes or lines
    const rh = vp.pick(e, scene.regionMeshes())[0];
    const sc = !rh ? pickSketchCurve(e) : null;
    const skId = rh ? rh.object.userData.region.sketch : sc ? sc.sketch : null;
    if (skId) { const r = sketchRef(skId); if (r) cands.push({ d: rh ? rh.distance - 1e-3 : 0, ref: r }); }
    const gh = vp.pick(e, planeGizmo.children)[0];
    if (gh) { const pl = ORIGIN_PLANES[gh.object.userData.plane]; cands.push({ d: gh.distance + 1e-3, ref: { o: pl.o, x: pl.x, n: pl.n, center: [0, 0, 0], size: 60, label: gh.object.userData.plane + " plane" } }); }
    cands.sort((a, b) => a.d - b.d);
    return cands.length ? cands[0].ref : null;
  }
  // a sketch's plane, centred on what is drawn in it
  function sketchRef(id, doc = store.view) { // jumpstart-3d: sketch move passes store.doc
    const sk = findSketch(doc, id);
    if (!sk) return null;
    const M = planeMatrix(sk.plane);
    const box = new THREE.Box3();
    for (const c of resolveSketch(sk)) for (const q of c.t === "point" ? [c.p] : sampleCurve(c)) box.expandByPoint(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    const center = box.isEmpty() ? V3(sk.plane.o) : new THREE.Plane().setFromNormalAndCoplanarPoint(V3(sk.plane.n).normalize(), V3(sk.plane.o)).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const size = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.2);
    return { o: sk.plane.o.slice(), x: sk.plane.x.slice(), n: sk.plane.n.slice(), center: arr3(center), size, label: (sk.name || "Sketch") + " (sketch plane)", sketch: sk.id };
  }
  function drawRefPlane(ref, color) {
    if (!ref) return;
    const s = ref.size || 60, h = s / 2;
    const M = planeMatrix({ o: ref.center || ref.o, x: ref.x, n: ref.n });
    const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(M));
    drawLine(pts, color);
  }
  function addPlane(doc, kind, def, plane, size) {
    doc.planes = doc.planes || [];
    let n = 1;
    const names = new Set(doc.planes.map((p) => p.name));
    while (names.has("Plane " + n)) n++;
    const p = { id: uid("pl"), name: "Plane " + n, seq: nextSeq(doc), kind, def, plane, size: Math.max(20, size || 60), hidden: false };
    doc.planes.push(p);
    return p;
  }
  function frameFrom(o, n, xHint) {
    const nn = V3(n).normalize();
    let x = xHint ? V3(xHint) : new THREE.Vector3(1, 0, 0);
    x.sub(nn.clone().multiplyScalar(x.dot(nn)));
    if (x.lengthSq() < 1e-8) { x = Math.abs(nn.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0); x.sub(nn.clone().multiplyScalar(x.dot(nn))); }
    return { o: arr3(V3(o)), x: arr3(x.normalize()), n: arr3(nn) };
  }
  // Offset plane: parallel to a plane or flat face, a distance away
  function offsetPlaneCmd(editing = null) {
    const st = { ref: null, d: 10 };
    if (editing) { const p = store.doc.planes.find((q) => q.id === editing); Object.assign(st, { ref: p.def.ref, d: p.def.d }); }
    let hover = null, arrowDrag = null;
    const def = {
      title: (editing ? "Edit " : "") + "Offset plane",
      valid: () => !!st.ref,
      canOk: () => def.valid(),
      apply(doc) {
        const r = st.ref, n = V3(r.n).normalize();
        const plane = frameFrom(V3(r.center || r.o).addScaledVector(n, st.d).toArray(), r.n, r.x);
        const ref = { o: r.o, x: r.x, n: r.n, center: r.center, size: r.size, label: r.label, sketch: r.sketch };
        if (editing) { const p = doc.planes.find((q) => q.id === editing); Object.assign(p, { plane, def: { ref, d: st.d } }); return; }
        addPlane(doc, "offset", { ref, d: st.d }, plane, r.size);
      },
      ok() { commit(def, "Offset plane"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { doc.planes = doc.planes.filter((q) => q.id !== editing); }, "Delete plane"); } : null,
      hint: () => st.ref ? "Drag the arrow or type the distance." : "Click an origin plane, a construction plane, a flat face or a sketch (or choose a sketch in the list).",
      build(body) {
        body.append(pickbox(true, st.ref ? el("b", {}, st.ref.label || "Plane") : "Select a plane, face or sketch", st.ref && !editing ? () => { st.ref = null; refresh(); } : null));
        // the origin planes as buttons too (like Create sketch): easier than hitting them in the view
        if (!editing) {
          const cur = st.ref && /^(XY|XZ|YZ) plane$/.test(st.ref.label || "") ? st.ref.label.slice(0, 2) : null;
          body.append(row("Origin plane", seg([["XY", "XY · Top"], ["XZ", "XZ · Front"], ["YZ", "YZ · Right"]], cur, (v) => { const pl = ORIGIN_PLANES[v]; st.ref = { o: pl.o, x: pl.x, n: pl.n, center: [0, 0, 0], size: 60, label: v + " plane" }; refresh(); }, "pl-origin")));
        }
        // any sketch, even a hidden one, can be the starting plane
        const sks = store.doc.sketches || [];
        if (sks.length) {
          const sel = el("select", { class: "num", id: "pl-sketch" }, el("option", { value: "" }, "…or pick a sketch"), ...sks.map((k) => el("option", { value: k.id, selected: st.ref && st.ref.sketch === k.id }, k.name || "Sketch")));
          sel.onchange = () => { const r = sel.value && sketchRef(sel.value); if (r) { st.ref = r; refresh(); } };
          body.append(row("Sketch", sel, "pl-sketch"));
        }
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "pl-d", step: 1, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "pl-d"));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) { if (arrowDrag) return; if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; } hover = st.ref ? null : pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { f: axisDragger(e, a.origin, a.n), v0: st.d }; return true; }
          const r = pickRefPlane(e);
          if (r) { st.ref = r; hover = null; refresh(); }
          return true;
        },
        move(e) { if (!arrowDrag) return; const g = app.gridStep() || 0.1; st.d = round(arrowDrag.v0 + arrowDrag.f(e), g >= 1 ? 1 : g); def.distInput && def.distInput.setValue(st.d); refresh(false); },
        up() { arrowDrag = null; },
      },
    };
    function overArrow(e) { const a = def.arrow; if (!a) return null; const [mx, my] = vp.local(e); const s = vp.project(a.tip); return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null; }
    function draw() {
      clearOv();
      def.arrow = null;
      if (hover) drawRefPlane(hover, 0xe8a317);
      if (!st.ref) return;
      drawRefPlane(st.ref, 0x2f66c8);
      const n = V3(st.ref.n).normalize(), origin = V3(st.ref.center || st.ref.o), tip = origin.clone().addScaledVector(n, st.d);
      drawLine([origin, tip], 0x1f4fa8);
      drawRefPlane({ ...st.ref, center: tip.toArray() }, 0xe8a317);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(vp.pixelSize(tip) * 6); cone.position.copy(tip);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(st.d) || 1));
      cone.renderOrder = 14; ov.add(cone);
      def.arrow = { origin, n, tip };
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ sketches as DXF
  // ids: the sketches to save (null = all of them). One sketch keeps its own coordinates;
  // several go side by side in one file, each on a layer named after it.
  async function exportSketchesDXF(ids) {
    const all = store.doc.sketches || [];
    const list = ids ? all.filter((k) => ids.includes(k.id)) : all;
    if (!list.length) { app.toast("There are no sketches to save yet."); return; }
    const txt = sketchesDXF(list);
    if (!txt) { app.toast(list.length > 1 ? "Those sketches have nothing to save (construction lines and points are left out)." : "This sketch has nothing to save yet (construction lines and points are left out).", "err"); return; }
    const clean = (t) => (t || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
    const name = (clean(store.doc.name) || "design") + (list.length === 1 ? "-" + (clean(list[0].name) || "sketch") : "-sketches") + ".dxf";
    await app.projects.saveModel(name, new TextEncoder().encode(txt));
    app.toast(list.length === 1 ? `Saved ${list[0].name} as DXF (millimetres).` : `Saved ${list.length} sketches in one DXF, side by side, each on its own layer (millimetres).`);
  }
  // ------------------------------------------------------------------ Section analysis
  // Like Fusion 360: cut the view with a plane to see inside. Nothing in the design changes,
  // and the section stays on after OK (clear it from the chip in the view or here).
  function sectionCmd() {
    const prev = section.info;
    const st = prev ? { ...prev } : { ref: null, d: 0, flip: false, hatch: true };
    let hover = null, arrowDrag = null, done = false;
    // where the arrow sits: the plane's own center, or the middle of the design on the plane
    const anchorOf = (ref) => {
      if (ref.center) return V3(ref.center);
      const box = new THREE.Box3();
      for (const b of store.view.bodies) if (!b.hidden) { const bb = scene.bodyTightBox(b.id); if (bb) box.union(bb); }
      const c = box.isEmpty() ? V3(ref.o) : box.getCenter(new THREE.Vector3());
      return new THREE.Plane().setFromNormalAndCoplanarPoint(V3(ref.n).normalize(), V3(ref.o)).projectPoint(c, new THREE.Vector3());
    };
    const live = () => section.set(st.ref ? { ref: { o: st.ref.o, n: st.ref.n, x: st.ref.x, center: anchorOf(st.ref).toArray(), size: st.ref.size, label: st.ref.label }, d: st.d, flip: st.flip, hatch: st.hatch } : null);
    const def = {
      title: "Section analysis",
      okLabel: "OK",
      valid: () => !!st.ref,
      canOk: () => !!st.ref,
      ok() { done = true; closeCmd(false); app.toast("Section on. Clear it with ✕ on the Section chip, or open Section analysis again to change it."); },
      onDelete: prev ? () => { done = true; section.clear(); closeCmd(false); } : null,
      hint: () => st.ref ? "Drag the arrow or type a distance to move the cut. Flip shows the other side." : "Click an origin plane, a construction plane or a flat face to cut along (or pick YZ / XZ / XY).",
      build(body) {
        body.append(row("Plane", pickbox(!st.ref, st.ref ? el("b", {}, st.ref.label || "Plane") : "Click a plane or flat face", st.ref ? () => { st.ref = null; refresh(); } : null), "sec-plane"));
        body.append(row("…or use", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], st.ref && ["YZ", "XZ", "XY"].includes(st.ref.label) ? st.ref.label : null, (v) => { const p = ORIGIN_PLANES[v]; st.ref = { o: p.o.slice(), n: p.n.slice(), x: p.x.slice(), label: v }; st.d = 0; refresh(); }, "sec-origin")));
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "sec-d", step: 1, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "sec-d"));
        body.append(row("Show", seg([[false, "This side"], [true, "Other side"]], st.flip, (v) => { st.flip = v; refresh(); }, "sec-flip")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sec-hatch", checked: st.hatch, onchange: (e) => { st.hatch = e.target.checked; refresh(false); } }), "Hatch the cut faces"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Only the view is cut: the design doesn't change. The cut faces show in each body's color."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); if (!done) section.set(prev); },
      typeInto: () => (st.ref ? def.distInput : null),
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) { if (arrowDrag) return; if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; } hover = pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { f: axisDragger(e, a.origin, a.n), v0: st.d }; return true; }
          const r = pickRefPlane(e);
          if (r) { st.ref = r; st.d = 0; hover = null; refresh(); }
          return true;
        },
        move(e) { if (!arrowDrag) return; const g = app.gridStep() || 0.1; st.d = round(arrowDrag.v0 + arrowDrag.f(e), g >= 1 ? 1 : g); def.distInput && def.distInput.setValue(st.d); refresh(false); },
        up() { arrowDrag = null; },
      },
    };
    function overArrow(e) { const a = def.arrow; if (!a) return null; const [mx, my] = vp.local(e); const s = vp.project(a.tip); return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null; }
    function draw() {
      clearOv();
      def.arrow = null;
      if (hover && (!st.ref || hover !== st.ref)) drawRefPlane(hover, 0xe8a317);
      if (!st.ref) return;
      const n = V3(st.ref.n).normalize(), at = anchorOf(st.ref).addScaledVector(n, st.d);
      // the arrow points to the side that is cut away
      const dir = st.flip ? n.clone().negate() : n.clone();
      const len = vp.pixelSize(at) * 60, tip = at.clone().addScaledVector(dir, len);
      drawLine([at, tip], 0x1f4fa8);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
      cone.scale.setScalar(vp.pixelSize(tip) * 6); cone.position.copy(tip);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      cone.renderOrder = 14; ov.add(cone);
      // dragging moves the plane along its normal, whichever way the arrow points
      def.arrow = { origin: at.clone().addScaledVector(n, -st.d), n, tip };
    }
    function refresh(rerender = true) { if (rerender) def.render(); live(); draw(); }
    openCmd(def);
  }
  // Plane at angle: through an axis (X, Y, Z or a straight edge), turned by an angle
  function anglePlaneCmd(editing = null) {
    const st = { axis: null, angle: 45 };
    if (editing) { const p = store.doc.planes.find((q) => q.id === editing); Object.assign(st, { axis: p.def.axis, angle: p.def.angle }); }
    let hover = null;
    const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
    const planeOfAxis = (ax, angle) => {
      const d = V3(ax.d).normalize();
      const up = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const n0 = new THREE.Vector3().crossVectors(d, up).normalize();
      const n = n0.applyAxisAngle(d, (angle * Math.PI) / 180);
      return frameFrom(ax.o, n.toArray(), d.toArray());
    };
    const def = {
      title: (editing ? "Edit " : "") + "Plane at angle",
      valid: () => !!st.axis,
      canOk: () => def.valid(),
      apply(doc) {
        const plane = planeOfAxis(st.axis, st.angle);
        if (editing) { const p = doc.planes.find((q) => q.id === editing); Object.assign(p, { plane, def: { axis: st.axis, angle: st.angle } }); return; }
        addPlane(doc, "angle", { axis: st.axis, angle: st.angle }, plane, st.axis.len ? st.axis.len * 1.4 : 60);
      },
      ok() { commit(def, "Plane at angle"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { doc.planes = doc.planes.filter((q) => q.id !== editing); }, "Delete plane"); } : null,
      hint: () => st.axis ? "Type the angle." : "Pick X, Y or Z, or click a straight edge of a body.",
      build(body) {
        body.append(row("Axis", pickbox(!st.axis, st.axis ? el("b", {}, st.axis.label) : "Click a straight edge", st.axis && !editing ? () => { st.axis = null; refresh(); } : null)));
        body.append(row("…or use", seg([["X", "X axis"], ["Y", "Y axis"], ["Z", "Z axis"]], st.axis && AX[st.axis.label] ? st.axis.label : null, (v) => { st.axis = { o: [0, 0, 0], d: AX[v], label: v, len: 0 }; refresh(); }, "pa-axes")));
        body.append(sliderRow("Angle", "pa-angle", st.angle, -180, 180, 1, "°", (v) => { st.angle = v; refresh(false); }));
      },
      start() { refresh(); },
      handler: {
        hover(e) { const h = pickBaseEdge(e); hover = h && h.info.t === "LINE" ? h : null; draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) {
          const h = pickBaseEdge(e);
          if (!h) return true;
          if (h.info.t !== "LINE") { app.toast("Pick a straight edge for the axis."); return true; }
          const base = baseOf(h.body);
          const a = V3(h.info.a).applyMatrix4(base.m), b = V3(h.info.b).applyMatrix4(base.m);
          st.axis = { o: arr3(a.clone().add(b).multiplyScalar(0.5)), d: arr3(b.clone().sub(a)), label: "Edge", len: a.distanceTo(b) };
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (hover) scene.setEdges([], { body: hover.body, edge: hover.edge }); else scene.setEdges([], null);
      if (!st.axis) return;
      const d = V3(st.axis.d).normalize(), o = V3(st.axis.o), L = Math.max(40, (st.axis.len || 0) * 0.8);
      drawLine([o.clone().addScaledVector(d, -L), o.clone().addScaledVector(d, L)], 0xe8a317);
      const pl = planeOfAxis(st.axis, st.angle);
      drawRefPlane({ ...pl, center: pl.o, size: Math.max(40, (st.axis.len || 0) * 1.4) }, 0x2f66c8);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    const prevCleanup = def.cleanup;
    def.cleanup = () => { scene.setEdges([], null); prevCleanup && prevCleanup(); };
    openCmd(def);
  }
  // Midplane: halfway between two flat faces or planes
  function midPlaneCmd() {
    const st = { a: null, b: null };
    let hover = null;
    const solve = () => {
      const A = st.a, B = st.b, na = V3(A.n).normalize(), nb = V3(B.n).normalize();
      const ca = V3(A.center || A.o), cb = V3(B.center || B.o);
      if (Math.abs(na.dot(nb)) > 0.9999) {
        const t = cb.clone().sub(ca).dot(na) / 2;
        const o = ca.clone().add(cb).multiplyScalar(0.5);
        o.addScaledVector(na, t - o.clone().sub(ca).dot(na));
        return frameFrom(o.toArray(), na.toArray(), A.x);
      }
      // two planes at an angle: the plane that splits the angle between them
      const nb2 = na.dot(nb) > 0 ? nb.clone() : nb.clone().negate();
      const n = na.clone().sub(nb2).normalize();
      const dir = new THREE.Vector3().crossVectors(na, nb).normalize();
      // a point on both planes
      const da = na.dot(ca), db = nb.dot(cb);
      const p = new THREE.Vector3().crossVectors(dir, nb).multiplyScalar(da).add(new THREE.Vector3().crossVectors(na, dir).multiplyScalar(db)).divideScalar(dir.dot(new THREE.Vector3().crossVectors(na, nb)) || 1);
      const mid = ca.clone().add(cb).multiplyScalar(0.5);
      const o = p.clone().addScaledVector(dir, mid.clone().sub(p).dot(dir));
      return frameFrom(o.toArray(), n.toArray(), dir.toArray());
    };
    const def = {
      title: "Midplane",
      valid: () => !!(st.a && st.b),
      canOk: () => def.valid(),
      apply(doc) { addPlane(doc, "mid", { a: strip(st.a), b: strip(st.b) }, solve(), Math.max(st.a.size || 60, st.b.size || 60)); },
      ok() { commit(def, "Midplane"); },
      hint: () => !st.a ? "Click the first face or plane." : !st.b ? "Click the second face or plane." : "OK to add the plane.",
      build(body) {
        body.append(row("First", pickbox(!st.a, st.a ? el("b", {}, st.a.label) : "Click a face or plane", st.a ? () => { st.a = null; st.b = null; refresh(); } : null)));
        body.append(row("Second", pickbox(!!st.a && !st.b, st.b ? el("b", {}, st.b.label) : "Click a face or plane", st.b ? () => { st.b = null; refresh(); } : null)));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) { hover = st.a && st.b ? null : pickRefPlane(e); draw(); vp.canvas.style.cursor = hover ? "pointer" : "default"; },
        down(e) { const r = pickRefPlane(e); if (!r) return true; if (!st.a) st.a = r; else if (!st.b) st.b = r; refresh(); return true; },
      },
    };
    const strip = (r) => ({ o: r.o, x: r.x, n: r.n, center: r.center, size: r.size, label: r.label });
    function draw() {
      clearOv();
      if (hover) drawRefPlane(hover, 0xe8a317);
      if (st.a) drawRefPlane(st.a, 0x2f66c8);
      if (st.b) drawRefPlane(st.b, 0x2f66c8);
      if (st.a && st.b) { const pl = solve(); drawRefPlane({ ...pl, center: pl.o, size: Math.max(st.a.size || 60, st.b.size || 60) }, 0xe8a317); }
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Insert SVG / DXF / image
  function pickFile(accept) {
    return new Promise((res) => {
      const inp = el("input", { type: "file", accept: fileAccept(accept), style: { display: "none" } });
      inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
      document.body.append(inp);
      inp.click();
    });
  }
  // shrink big pictures so designs stay small enough to save
  function loadImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let src = cv.toDataURL("image/png");
        if (src.length > 700000) src = cv.toDataURL("image/jpeg", 0.85);
        res({ src, w, h, natW: img.naturalWidth });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That picture couldn't be opened.")); };
      img.src = url;
    });
  }
  async function insertFile(kind = "any") {
    const MODELS = ".stl,.obj,.3mf,.step,.stp,model/stl,model/obj,model/3mf,application/sla"; // jumpstart-3d: OBJ in both modes' shared picker
    const accept = kind === "svg" ? ".svg,image/svg+xml" : kind === "dxf" ? ".dxf" : kind === "image" ? "image/png,image/jpeg,image/webp,image/gif,image/bmp" : kind === "model" ? MODELS : ".svg,.dxf,image/png,image/jpeg,image/webp,image/gif," + MODELS;
    const f = await pickFile(accept);
    if (!f) return;
    return openModelFile(f); // jumpstart-3d: drop import. the picker and the page-wide drop share one entry
  }
  // jumpstart-3d: drop import. What a file is, by its ending in any letter case: "model" (STL, OBJ, 3MF, STEP, STP), "svg", "dxf",
  // "image" (by its type), or null. Shared by the picker and the page-wide drop so they accept the same files.
  function fileKind(f) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext === "stl" || ext === "obj" || ext === "3mf" || ext === "step" || ext === "stp") return "model"; // jumpstart-3d: OBJ import
    return ext === "svg" ? "svg" : ext === "dxf" ? "dxf" : /^image\//.test(f.type) ? "image" : null;
  }
  // jumpstart-3d: drop import. Opens any file the Import button takes: a mesh or STEP model, an SVG or DXF drawing, a picture.
  // The picker (insertFile) and the page-wide drop (dropimport.js) both end here. Resolves once the file is handed over
  // (the dialog it opens may still be showing); never rejects.
  async function openModelFile(f) {
    const type = fileKind(f);
    if (type === "model") return importModel(f);
    if (!type) { app.toast("Pick an SVG, DXF or picture file.", "err"); return; }
    try {
      if (type === "image") {
        const img = await loadImage(f);
        ensureSketch();
        insertImageCmd(img, f.name);
      } else {
        const text = await f.text();
        const res = type === "svg" ? { curves: parseSVG(text), skipped: 0 } : parseDXF(text);
        ensureSketch();
        insertCurvesCmd(res.curves, f.name, type, res.skipped);
      }
    } catch (e) { app.toast(e.message || "That file couldn't be read.", "err"); }
  }
  // ------------------------------------------------------------------ STL / STEP import
  // Like Tinkercad: an STL becomes a shape you can move, group, cut holes in (and, in
  // Advanced, add features to). STEP files (e.g. from the Mesh to STEP Helper) come in as
  // true CAD solids.
  async function importModel(file, bytesIn) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Import";
    try {
      const bytes = bytesIn || new Uint8Array(await file.arrayBuffer());
      if (ext === "step" || ext === "stp") {
        addImported({ kind: "step", bytes, name: base, k: 1, plate: true }); // jumpstart-3d: drop import. a model file lands on the plate centre
        app.toast(`Imported ${file.name} as a CAD solid. It may take a moment to appear.`);
        return;
      }
      const big = bytes.length > 4e6;
      if (big) { app.toast("Reading " + file.name + "…"); await new Promise((r) => setTimeout(r, 60)); }
      const res = await readMeshFile(bytes, file.name); // jumpstart-3d: OBJ dispatch by filename
      const nt0 = res.mesh.I.length / 3;
      let mesh = res.mesh, err = 0;
      if (nt0 > MESH_LIMIT) {
        if (!big) { app.toast("Simplifying " + nt0.toLocaleString() + " triangles…"); await new Promise((r) => setTimeout(r, 60)); }
        ({ mesh, err } = simplify(mesh, MESH_LIMIT));
      }
      importStlCmd(mesh, base, file.name, nt0, { ...res, err, bytes });
    } catch (e) { app.toast(e.message || "That file couldn't be read.", "err"); }
  }
  function addImported({ kind, bytes, name, k, plate }) { // jumpstart-3d: drop import. plate: put it at the plate centre (X 0, Y 0), not at the view target
    const id = contentId(bytes);
    const data = toB64(bytes);
    let bodyId = null;
    store.update((doc) => {
      doc.assets = doc.assets || {};
      if (!doc.assets[id]) doc.assets[id] = { kind, name, data };
      const t = plate ? { x: 0, y: 0 } : vp.view.target, g = 10; // jumpstart-3d: drop import. was: vp.view.target
      const b = { id: (bodyId = uid("b")), name: nextName(doc, name), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0, 1], node: { t: kind, asset: id, ...(k !== 1 ? { k } : {}), mods: [] } };
      doc.bodies.push(b);
    }, "Import " + name);
    app.select([bodyId]);
    if (data.length > 3e6) app.toast("This model is large: if saving in the browser fails, use Export → Save Project File to keep your design.");
    // big meshes take a few seconds to turn into a solid: say so, then say when it's there
    const t0 = Date.now();
    let told = false;
    const watch = setInterval(() => {
      const v = app.scene.views.get(bodyId), err = app.scene.errors && app.scene.errors.get(bodyId);
      if ((v && v.data) || err || Date.now() - t0 > 180000 || !store.doc.bodies.some((b) => b.id === bodyId)) {
        clearInterval(watch);
        if (err && store.doc.bodies.some((b) => b.id === bodyId)) app.toast(`Couldn't build ${name}: ${err}`, "err"); // jumpstart-3d: drop import. a failed build used to show only in the status line
        if (v && v.data && Date.now() - t0 > 2500) app.toast(name + " is ready.");
      } else if (Date.now() - t0 > 1500 && !told) { told = true; app.toast("Preparing " + name + "… larger models can take up to a minute."); }
    }, 500);
    return bodyId;
  }
  function importStlCmd(mesh, name, fileName, ntOrig, info = {}) {
    const b = meshBounds(mesh);
    const st = { unit: "mm" };
    const K = { mm: 1, cm: 10, in: 25.4 };
    const fromFile = !!info.unitFromFile; // 3MF: the file says its units (already turned into mm)
    // a tiny STL is probably in inches or centimetres; a huge one in micrometres is rare
    if (info.format === "STL" && !fromFile && Math.max(...b.size) < 6) st.unit = "in";
    const rep = info.report || {};
    const fixes = [];
    if (rep.flipped) fixes.push(`turned ${rep.flipped.toLocaleString()} inside-out triangle${rep.flipped > 1 ? "s" : ""} the right way`);
    if (rep.dupes) fixes.push(`removed ${rep.dupes.toLocaleString()} duplicate triangle${rep.dupes > 1 ? "s" : ""}`);
    if (rep.degenerate) fixes.push(`removed ${rep.degenerate.toLocaleString()} squashed triangle${rep.degenerate > 1 ? "s" : ""}`);
    if (rep.filled) fixes.push(`closed ${rep.filled} small hole${rep.filled > 1 ? "s" : ""}`);
    const def = {
      title: "Import " + (info.format || "STL"),
      valid: () => true,
      canOk: () => true,
      ok() { closeCmd(false); addImported({ kind: "mesh", bytes: packMesh(mesh), name, k: K[st.unit], plate: true }); }, // jumpstart-3d: drop import. plate
      hint: () => "Pick the units the file was made in, then OK.",
      build(body) {
        const nt = mesh.I.length / 3;
        body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, fileName), ` · ${nt.toLocaleString()} triangles`));
        const hint = (...c) => body.append(el("div", { class: "hint", style: { padding: 0 } }, ...c));
        if (info.parts > 1) hint(`${info.parts} parts, placed as in the file.`);
        if (ntOrig > nt) hint(`Simplified from ${ntOrig.toLocaleString()} triangles so it stays quick to edit. Largest change: about ${withUnit(info.err * K[st.unit], 2)}.`);
        if (fromFile) hint(`Units come from the file (${info.unitFromFile}${info.unitFromFile === "millimeter" ? "" : ", converted to mm"}). Change them only if the size looks wrong.`);
        body.append(row("File units", seg([["mm", "mm"], ["cm", "cm"], ["in", "inches"]], st.unit, (v) => { st.unit = v; def.render(); }, "imp-unit")));
        const s = b.size.map((v) => v * K[st.unit]);
        hint(`Size: ${s.map((v) => showLen(v, 1)).join(" × ")} ${getUnit()}`);
        if (fixes.length) hint("Repaired: " + fixes.join(", ") + ".");
        // jumpstart-3d: OBJ cannot be opened directly in the Mesh to STEP helper.
        if (rep.open) hint(el("b", {}, "Not closed: "), `${rep.open.toLocaleString()} open edge${rep.open > 1 ? "s" : ""}. It will come in as a surface you can see and export, but not cut or fillet. ${info.format === "OBJ" ? "Try fixing the file." : "Try fixing the file, or the Mesh to STEP Helper."}`);
        else hint(el("b", {}, "Closed solid ✓ "), "It comes in as a solid you can move, scale, group and cut holes in.");
        if (rep.nonManifold) hint(`${rep.nonManifold.toLocaleString()} edge${rep.nonManifold > 1 ? "s are" : " is"} shared by more than two triangles (touching parts). It may not build cleanly.`);
        // jumpstart-3d: the Mesh to STEP helper only reads STL/3MF bytes.
        if (info.bytes && info.format !== "OBJ" && app.meshstep) body.append(el("button", { class: "btn", id: "imp-tostep", style: { marginTop: "8px", width: "100%" }, title: "Turn the mesh into smooth, editable CAD faces (planes, cylinders, fillets) first", onclick: () => { closeCmd(false); app.meshstep.open({ bytes: info.bytes, name: fileName }); } }, "Convert to CAD faces in Mesh to STEP…"));
      },
      handler: { down: () => false, hover() {} },
    };
    openCmd(def);
  }
  // inserting outside a sketch starts one on the XY (top) plane
  function ensureSketch() {
    if (sketcher.active) return;
    makeSketch(ORIGIN_PLANES.XY, null);
    app.toast("Started a sketch on the top (XY) plane for it.");
  }
  function insertCurvesCmd(curves, name, type, skipped) {
    const b = curvesBounds(curves);
    const st = { w: +b.w.toFixed(3), center: true };
    const aspect = b.w > 1e-9 ? b.h / b.w : 1;
    const sketchId = sketcher.active;
    const def = {
      title: "Insert " + type.toUpperCase(),
      keepSelection: true,
      valid: () => st.w > 1e-6,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk) return;
        const k = b.w > 1e-9 ? st.w / b.w : 1;
        const ox = st.center ? -(b.x0 + b.x1) / 2 : 0, oy = st.center ? -(b.y0 + b.y1) / 2 : 0;
        const T = (q) => [(q[0] + ox) * k, (q[1] + oy) * k];
        const mapped = curves.map((c) => c.t === "line" ? { t: "line", a: T(c.a), b: T(c.b) } : c.t === "circle" ? { t: "circle", c: T(c.c), r: c.r * k } : c.t === "arc" ? { t: "arc", c: T(c.c), a: T(c.a), b: T(c.b) } : { t: "spline", pts: c.pts.map(T), closed: c.closed });
        addImportedCurves(sk, mapped, Math.max(1e-5, Math.max(b.w, b.h) * k * 1e-5));
      },
      ok() { commit(def, "Insert " + type.toUpperCase()); },
      hint: () => "Set the size, then OK. Closed outlines become profiles you can extrude.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, name), ` · ${curves.length} curve${curves.length === 1 ? "" : "s"} · ${fmt(b.w, 2)} × ${fmt(b.h, 2)} mm as drawn`));
        if (skipped) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${skipped} item${skipped > 1 ? "s" : ""} (text, blocks or hatches) were left out.`));
        const hIn = app.numField({ value: +(st.w * aspect).toFixed(3), id: "ins-h", min: 0.001, step: 1, onCommit: (v) => { st.w = aspect > 1e-9 ? v / aspect : v; wIn.setValue(+st.w.toFixed(3)); refresh(false); } });
        const wIn = app.numField({ value: st.w, id: "ins-w", min: 0.001, step: 1, onCommit: (v) => { st.w = v; hIn.setValue(+(v * aspect).toFixed(3)); refresh(false); } });
        body.append(row("Width", wIn, "ins-w"), row("Height", hIn, "ins-h"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ins-center", checked: st.center, onchange: (e) => { st.center = e.target.checked; refresh(false); } }), "Center on the sketch origin"));
      },
      start() { refresh(); },
      handler: { down: () => false, hover() {} },
    };
    function refresh(rerender = true) { if (rerender) def.render(); schedulePreview(def); }
    openCmd(def);
  }
  // ------------------------------------------------------------------ sketch picture
  // Size, place and turn a sketch's reference picture: drag its handles on the canvas (corners
  // scale evenly, sides stretch, the knob on top turns it, inside moves it), type the numbers,
  // or click two points on it and type the real distance between them.
  function insertImageCmd(img, name) { pictureCmd(sketcher.active, { img, name }); }
  function pictureCmd(sketchId, fresh) {
    const sk0 = findSketch(store.doc, sketchId);
    const cur = fresh ? null : sk0 && sk0.image;
    if (!fresh && !cur) return;
    const aspect = fresh ? fresh.img.h / fresh.img.w : cur.h / cur.w;
    const w0 = fresh ? Math.min(300, Math.max(20, +(fresh.img.natW * 0.2646).toFixed(1))) : cur.w;
    const st = { w: w0, h: fresh ? +(w0 * aspect).toFixed(4) : cur.h, cx: fresh ? 0 : cur.cx || 0, cy: fresh ? 0 : cur.cy || 0, rot: fresh ? 0 : cur.rot || 0, opacity: fresh ? 0.6 : cur.opacity ?? 0.6, keep: true, cal: null };
    let drag = null, hot = null;
    const f = {};
    const def = {
      title: fresh ? "Insert image" : "Size & place picture",
      keepSelection: true,
      valid: () => st.w > 0 && st.h > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk) return;
        const base = fresh ? { src: fresh.img.src, name: fresh.name } : sk.image;
        if (!base) return;
        sk.image = { ...base, w: +st.w.toFixed(4), h: +st.h.toFixed(4), cx: +st.cx.toFixed(4), cy: +st.cy.toFixed(4), rot: +st.rot.toFixed(3), opacity: st.opacity };
      },
      ok() { commit(def, fresh ? "Insert image" : "Size picture"); },
      hint: () => st.cal ? (st.cal.pts.length < 2 ? `Click point ${st.cal.pts.length + 1} of 2 on the picture (two ends of something you know the length of).` : "Type the real length between the two points.") : "Drag the corners to scale, the sides to stretch, the round knob to turn, or inside to move.",
      build(body) {
        if (fresh) body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, fresh.name), ` · ${fresh.img.w} × ${fresh.img.h} px`));
        f.w = app.numField({ value: st.w, id: "img-w", len: true, min: 0.01, step: 5, onCommit: (v) => setSize(v, st.keep ? v * st.h / st.w : st.h) });
        f.h = app.numField({ value: st.h, id: "img-h", len: true, min: 0.01, step: 5, onCommit: (v) => setSize(st.keep ? v * st.w / st.h : st.w, v) });
        body.append(row("Width", f.w, "img-w"), row("Height", f.h, "img-h"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "img-keep", checked: st.keep, onchange: (e) => { st.keep = e.target.checked; } }), "Keep proportions"));
        const r3 = el("div", { class: "row3" });
        f.x = app.numField({ value: st.cx, id: "img-x", len: true, onCommit: (v) => { st.cx = v; changed(); } });
        f.y = app.numField({ value: st.cy, id: "img-y", len: true, onCommit: (v) => { st.cy = v; changed(); } });
        f.r = app.numField({ value: st.rot, id: "img-rot", angle: true, step: 1, onCommit: (v) => { st.rot = v; changed(); } });
        r3.append(el("label", {}, "X", f.x), el("label", {}, "Y", f.y), el("label", {}, "Turn °", f.r));
        body.append(r3);
        body.append(sliderRow("Opacity", "img-op", st.opacity * 100, 5, 100, 1, "%", (v) => { st.opacity = v / 100; schedulePreview(def); }));
        // scale from a known length
        if (!st.cal) body.append(el("button", { class: "btn", id: "img-cal", style: { width: "100%", marginTop: "6px" }, title: "Click both ends of something in the picture whose real size you know, then type that size", onclick: () => { st.cal = { pts: [] }; def.render(); draw(); app.status(); } }, "Scale with a known length…"));
        else {
          const box = el("div", { class: "cal-box" });
          box.append(el("div", { class: "hint", style: { padding: 0 } }, st.cal.pts.length < 2 ? `Click point ${st.cal.pts.length + 1} of 2 on the picture.` : "Now type how long that really is:"));
          if (st.cal.pts.length === 2) {
            const [a, b] = st.cal.pts, meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const inp = app.numField({ value: meas, id: "img-cal-len", len: true, min: 0.001, onCommit: (v) => calApply(v) });
            box.append(row("Real length", inp, "img-cal-len"));
            setTimeout(() => { inp.focus(); inp.select(); }, 0);
          }
          box.append(el("button", { class: "btn", style: { marginTop: "4px" }, onclick: () => { st.cal = null; def.render(); draw(); app.status(); } }, "Cancel scaling"));
          body.append(box);
        }
      },
      start() { vp.labelFns.add(draw); changed(); vp.request(); },
      cleanup() { vp.labelFns.delete(draw); ov.remove(); },
      handler: {
        hover(e) { if (drag) return; hot = st.cal ? null : hitHandle(e); vp.canvas.style.cursor = st.cal ? "crosshair" : CURSORS[hot] || "default"; draw(); },
        down(e) {
          const raw = sketcher.to2d(e);
          if (!raw) return false;
          if (st.cal) {
            if (st.cal.pts.length >= 2) st.cal.pts = [];
            st.cal.pts.push(raw);
            def.render(); draw(); app.status();
            return true;
          }
          const h = hitHandle(e);
          if (h == null) return false;
          drag = { h, raw0: raw, s0: { ...st } };
          return true;
        },
        move(e) {
          if (!drag) return;
          const raw = sketcher.to2d(e);
          if (!raw) return;
          dragTo(drag, raw, e);
          changed(false);
        },
        up() { if (drag) { drag = null; def.render(); } },
      },
    };
    const CURSORS = { move: "move", rot: "grab", 0: "nesw-resize", 1: "nwse-resize", 2: "nesw-resize", 3: "nwse-resize", 4: "ns-resize", 5: "ew-resize", 6: "ns-resize", 7: "ew-resize" };
    function setSize(w, h) { st.w = Math.max(0.01, w); st.h = Math.max(0.01, h); changed(); }
    // live: fields follow, the picture follows (preview), the handles follow
    function changed(rebuild = true) {
      if (!rebuild) {
        f.w && f.w.setValue(+st.w.toFixed(3)); f.h && f.h.setValue(+st.h.toFixed(3));
        f.x && f.x.setValue(+st.cx.toFixed(3)); f.y && f.y.setValue(+st.cy.toFixed(3)); f.r && f.r.setValue(+st.rot.toFixed(2));
      } else def.render();
      schedulePreview(def); draw();
    }
    function calApply(v) {
      const [a, b] = st.cal.pts, meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (meas < 1e-9) return;
      const k = v / meas;
      st.w *= k; st.h *= k;
      st.cx = a[0] + (st.cx - a[0]) * k; st.cy = a[1] + (st.cy - a[1]) * k;
      st.cal = null;
      app.toast(`Picture scaled ×${+k.toFixed(3)} so that length is ${withUnit(v, 3)}.`);
      changed(); app.status();
    }
    // picture frame in sketch coordinates
    const frameOf = (s) => {
      const r = (s.rot * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      const P = (x, y) => [s.cx + x * c - y * sn, s.cy + x * sn + y * c];
      const toLocal = (q) => { const dx = q[0] - s.cx, dy = q[1] - s.cy; return [dx * c + dy * sn, -dx * sn + dy * c]; };
      return { P, toLocal, c, sn };
    };
    const SG = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]; // corners, then side middles
    function screenPts() {
      const sk = findSketch(store.view, sketchId) || sk0;
      if (!sk) return null;
      const M = planeMatrix(sk.plane), fr = frameOf(st), px = sketcher.px ? sketcher.px() : 1;
      const S = (q) => { const p = vp.project(new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)); return [p[0], p[1]]; };
      const hs = SG.map(([sx, sy]) => S(fr.P((sx * st.w) / 2, (sy * st.h) / 2)));
      const top = S(fr.P(0, st.h / 2)), knob = S(fr.P(0, st.h / 2 + 26 * px));
      return { hs, top, knob, S };
    }
    function hitHandle(e) {
      const sp = screenPts(); if (!sp) return null;
      const m = vp.local(e), R = matchMedia("(pointer: coarse)").matches ? 16 : 9;
      const near = (q) => Math.hypot(q[0] - m[0], q[1] - m[1]) <= R;
      if (near(sp.knob)) return "rot";
      for (let i = 0; i < 4; i++) if (near(sp.hs[i])) return i;
      for (let i = 4; i < 8; i++) if (near(sp.hs[i])) return i;
      // inside the picture
      const raw = sketcher.to2d(e); if (!raw) return null;
      const l = frameOf(st).toLocal(raw);
      if (Math.abs(l[0]) <= st.w / 2 && Math.abs(l[1]) <= st.h / 2) return "move";
      return null;
    }
    function dragTo(d, raw, e) {
      const s0 = d.s0, fr = frameOf(s0), h = d.h;
      if (h === "move") { st.cx = s0.cx + raw[0] - d.raw0[0]; st.cy = s0.cy + raw[1] - d.raw0[1]; return; }
      if (h === "rot") {
        let a = (Math.atan2(raw[1] - s0.cy, raw[0] - s0.cx) * 180) / Math.PI - 90;
        a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
        st.rot = ((a % 360) + 540) % 360 - 180; return;
      }
      const [gx, gy] = SG[h];
      // the opposite corner or side stays put
      const anchor = fr.P((-gx * s0.w) / 2, (-gy * s0.h) / 2);
      const dx = raw[0] - anchor[0], dy = raw[1] - anchor[1];
      const lx = dx * fr.c + dy * fr.sn, ly = -dx * fr.sn + dy * fr.c;
      let w = s0.w, hh = s0.h;
      if (gx && gy) {
        w = Math.max(0.01, lx * gx); hh = Math.max(0.01, ly * gy);
        if (st.keep !== e.shiftKey) { const k = Math.max(0.001, (w * s0.w + hh * s0.h) / (s0.w * s0.w + s0.h * s0.h)); w = s0.w * k; hh = s0.h * k; }
      } else if (gx) { w = Math.max(0.01, lx * gx); if (st.keep && !e.shiftKey) hh = (w * s0.h) / s0.w; }
      else { hh = Math.max(0.01, ly * gy); if (st.keep && !e.shiftKey) w = (hh * s0.w) / s0.h; }
      st.w = w; st.h = hh;
      const ox = gx ? (gx * w) / 2 : 0, oy = gy ? (gy * hh) / 2 : 0;
      // the new center: from the fixed corner (or the middle of the fixed side) out by half the size
      st.cx = anchor[0] + ox * fr.c - oy * fr.sn;
      st.cy = anchor[1] + ox * fr.sn + oy * fr.c;
    }
    // the outline, handles and the measuring line, drawn over the 3D view
    const NS = "http://www.w3.org/2000/svg";
    const ov = document.createElementNS(NS, "svg");
    ov.setAttribute("class", "pic-ov");
    vpEl.append(ov);
    function draw() {
      const sp = screenPts();
      if (!sp || app.command !== def) { ov.innerHTML = ""; return; }
      const pt = (q) => q.map((v) => v.toFixed(1)).join(",");
      let h = `<polygon class="pic-frame" points="${sp.hs.slice(0, 4).map(pt).join(" ")}"/>`;
      if (!st.cal) {
        h += `<line class="pic-stem" x1="${sp.top[0]}" y1="${sp.top[1]}" x2="${sp.knob[0]}" y2="${sp.knob[1]}"/>`;
        h += `<circle class="pic-knob${hot === "rot" ? " hot" : ""}" cx="${sp.knob[0]}" cy="${sp.knob[1]}" r="6"/>`;
        sp.hs.forEach((q, i) => { const s = i < 4 ? 5 : 4; h += `<rect class="pic-h${hot === i ? " hot" : ""}" x="${q[0] - s}" y="${q[1] - s}" width="${2 * s}" height="${2 * s}"/>`; });
      } else {
        const P = st.cal.pts.map(sp.S);
        if (P.length === 2) h += `<line class="pic-cal" x1="${P[0][0]}" y1="${P[0][1]}" x2="${P[1][0]}" y2="${P[1][1]}"/>`;
        for (const q of P) h += `<circle class="pic-calpt" cx="${q[0]}" cy="${q[1]}" r="5"/>`;
      }
      ov.innerHTML = h;
    }
    openCmd(def);
  }

  // Auto trace: the picture's dark (or light) parts become closed sketch outlines to extrude
  function traceCmd(sketchId) {
    const sk0 = findSketch(store.doc, sketchId), im = sk0 && sk0.image;
    if (!im) return;
    const st = { thr: null, part: "dark", detail: "medium", specks: 0.2, smooth: true, fade: true };
    let img = null, res = null, curves = [], busy = true, autoThr = 128;
    const TOL = { low: 2.2, medium: 1.1, high: 0.55 };
    const def = {
      title: "Auto trace picture",
      keepSelection: true,
      valid: () => curves.length > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const sk = findSketch(doc, sketchId);
        if (!sk || !curves.length) return;
        addImportedCurves(sk, curves, Math.max(1e-5, Math.max(im.w, im.h) * 1e-5));
        if (st.fade && sk.image) sk.image.opacity = Math.min(sk.image.opacity ?? 0.6, 0.3);
      },
      ok() {
        const sk0 = findSketch(store.doc, sketchId), loops0 = new Set(sk0 ? userLoops(sk0).map((l) => l.key) : []);
        commit(def, "Auto trace");
        app.toast(`Traced ${res.rings.length} outline${res.rings.length === 1 ? "" : "s"}. Closed ones shade blue: they're ready to extrude.`);
        // Beginner: like drawing a closed shape, Extrude opens with the traced shapes picked
        const sk1 = findSketch(store.doc, sketchId);
        if (sk1 && app.onShapeClosed) {
          const loops = new Set(userLoops(sk1).filter((l) => !loops0.has(l.key)).map((l) => "u:" + l.key));
          const regs = regionsFor(sk1), own = regionOwners(sk1);
          const fresh = regs.filter((r, i) => loops.has(own[i])).map((r) => r.key);
          if (fresh.length) app.onShapeClosed(sketchId, fresh);
        }
      },
      hint: () => "Closed outlines become profiles you can extrude.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Turns the picture's shapes into sketch lines. Works best with a clear, high-contrast picture such as a logo or a drawing."));
        body.append(row("Trace", seg([["dark", "Dark parts"], ["light", "Light parts"]], st.part, (v) => { st.part = v; retrace(); }, "tr-part"), "tr-part"));
        const thrPct = Math.round(((st.thr ?? autoThr) / 255) * 100);
        body.append(sliderRow("Threshold", "tr-thr", thrPct, 1, 99, 1, "%", (v) => { st.thr = (v / 100) * 255; retraceSoon(); }));
        body.append(row("Detail", seg([["low", "Low"], ["medium", "Medium"], ["high", "High"]], st.detail, (v) => { st.detail = v; retrace(); }, "tr-detail"), "tr-detail"));
        body.append(sliderRow("Ignore specks", "tr-specks", st.specks * 10, 0, 50, 1, "", (v) => { st.specks = v / 10; retraceSoon(); }));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tr-smooth", checked: st.smooth, onchange: (e) => { st.smooth = e.target.checked; remap(); } }), "Smooth curves (off: straight lines only)"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tr-fade", checked: st.fade, onchange: (e) => { st.fade = e.target.checked; schedulePreview(def); } }), "Fade the picture afterwards"));
        body.append(el("button", { class: "btn", style: { width: "100%", marginTop: "4px" }, onclick: () => { st.thr = null; retrace(); } }, "Automatic threshold"));
        body.append(el("button", { class: "btn", id: "tr-to3d", style: { width: "100%", marginTop: "4px" }, title: "Puff the picture's subject up into a rounded 3D model instead", onclick: () => { closeCmd(false); puffyCmd(sketchId); } }, "Make a 3D model from the picture instead…"));
        body.append(el("div", { class: "hint", id: "tr-info", style: { padding: "6px 0 0" } }, info()));
      },
      start() { load(); },
      handler: { down: () => false, hover() {} },
    };
    function info() {
      if (busy) return "Reading the picture…";
      if (!res) return "";
      if (!res.rings.length) return "Nothing to trace at this threshold. Try moving the slider or tracing the light parts.";
      const n = res.rings.reduce((a, r) => a + r.length, 0);
      return `${res.rings.length} outline${res.rings.length === 1 ? "" : "s"} · ${curves.length} curves · ${n} points` + (res.dropped ? ` (the ${res.dropped} smallest were left out)` : "");
    }
    function load() {
      const pic = new Image();
      pic.onload = () => {
        const k = Math.min(1, 640 / Math.max(pic.naturalWidth, pic.naturalHeight));
        const W = Math.max(8, Math.round(pic.naturalWidth * k)), H = Math.max(8, Math.round(pic.naturalHeight * k));
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(pic, 0, 0, W, H);
        img = g.getImageData(0, 0, W, H);
        busy = false;
        retrace();
      };
      pic.onerror = () => { busy = false; app.toast("That picture couldn't be read for tracing.", "err"); };
      pic.src = im.src;
    }
    let tmr = 0;
    function retraceSoon() { clearTimeout(tmr); tmr = setTimeout(retrace, 120); }
    function retrace() {
      if (!img || app.command !== def) return;
      res = traceImage(img, { thr: st.thr, part: st.part, tol: TOL[st.detail], minArea: st.specks / 100 });
      if (st.thr == null) autoThr = res.threshold;
      remap(true);
    }
    function remap(rerender = false) {
      if (!res) return;
      curves = curvesFor(res, im, st.smooth);
      if (rerender) def.render(); else { const i = $("tr-info"); if (i) i.textContent = info(); }
      schedulePreview(def);
      def.refreshOk && def.refreshOk();
    }
    openCmd(def);
  }
  // Picture → puffy 3D model: cut the subject out, inflate its outline into a
  // rounded solid, paint the picture on. Not an AI reconstruction: from the front it looks like
  // the picture; from the side it is a rounded, plush-toy version of the outline.
  function puffyCmd(sketchId) {
    const sk0 = findSketch(store.doc, sketchId), im = sk0 && sk0.image;
    if (!im) return;
    const st = { mode: "auto", sens: 30, thr: 50, height: 60, puff: 80, detail: 25, paint: true };
    let img = null, mask = null, busy = true;
    const prev = el("canvas", { class: "puffy-prev", width: 260, height: 170 });
    const def = {
      title: "Picture to 3D model",
      keepSelection: true,
      valid: () => !!(mask && maskBox(mask, img.width, img.height)),
      canOk: () => def.valid(),
      apply() {},
      ok() {
        let res;
        try { res = inflate(img, mask, { height: st.height, puff: st.puff / 100, detail: st.detail / 100, res: 96 }); }
        catch (err) { app.toast(err.message, "err"); return; }
        let mesh = { V: res.V, I: res.I };
        if (mesh.I.length / 3 > MESH_LIMIT) mesh = simplify(mesh, MESH_LIMIT).mesh;
        closeCmd(false);
        const base = (im.name || "Picture").replace(/\.[^.]+$/, "");
        const id = addImported({ kind: "mesh", bytes: packMesh(mesh), name: "Puffy " + base, k: 1 });
        const mid = uid("md");
        store.update((doc) => {
          const b = doc.bodies.find((x) => x.id === id);
          if (!b) return;
          b.color = res.color;
          if (st.paint) {
            doc.media = doc.media || {};
            doc.media[mid] = { kind: "image", name: im.name || "picture", src: im.src, w: img.width, h: img.height };
            b.media = { id: mid, map: "front", dir: [0, 1, 0], up: [0, 0, 1], both: true, crop: res.crop, rep: 1, rot: 0, mirror: false };
          }
          // the flat picture it was made from steps out of the way (show it again from the browser)
          const s = doc.sketches.find((x) => x.id === sketchId); if (s) s.hidden = true;
        }, "Paint picture on");
        if (sketcher.active) app.exitSketch && app.exitSketch();
        app.toast(`Made a puffy 3D model, ${res.size.map((v) => showLen(v, 0)).join(" × ")} ${getUnit()}. It's a real solid: you can print it.${st.paint ? " The picture is painted on (Media)." : ""}`);
      },
      hint: () => "Check the cut-out, then OK.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Cuts the subject out of the picture and puffs its outline up into a rounded solid, then paints the picture on. From the front it looks like the picture; from the side it's a rounded, plush-toy version."));
        body.append(prev);
        body.append(row("Cut out", seg([["auto", "Auto"], ["dark", "Dark parts"], ["light", "Light parts"]], st.mode, (v) => { st.mode = v; def.render(); recut(); }, "pf-mode"), "pf-mode"));
        if (st.mode === "auto") body.append(sliderRow("Sensitivity", "pf-sens", st.sens, 0, 100, 1, "%", (v) => { st.sens = v; recutSoon(); }));
        else body.append(sliderRow("Threshold", "pf-thr", st.thr, 1, 99, 1, "%", (v) => { st.thr = v; recutSoon(); }));
        body.append(row("Height", app.numField({ value: st.height, id: "pf-h", len: true, min: 5, max: 500, step: 5, onCommit: (v) => { st.height = v; } }), "pf-h"));
        body.append(sliderRow("Puffiness", "pf-puff", st.puff, 20, 150, 5, "%", (v) => { st.puff = v; }));
        body.append(sliderRow("Surface detail", "pf-detail", st.detail, 0, 100, 5, "%", (v) => { st.detail = v; }));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pf-paint", checked: st.paint, onchange: (e) => { st.paint = e.target.checked; } }), "Paint the picture on it"));
        body.append(el("div", { class: "hint", id: "pf-info", style: { padding: 0 } }, busy ? "Reading the picture…" : info()));
        drawPrev();
      },
      start() { load(); },
      handler: { down: () => false, hover() {} },
    };
    function info() {
      if (!mask) return "";
      const b = maskBox(mask, img.width, img.height);
      if (!b) return "No subject found. Try a different cut-out setting.";
      return st.mode === "auto" ? "Checkered = cut away. Works best with a plain background." : "Checkered = cut away.";
    }
    function load() {
      const pic = new Image();
      pic.onload = () => {
        const k = Math.min(1, 420 / Math.max(pic.naturalWidth, pic.naturalHeight));
        const W = Math.max(8, Math.round(pic.naturalWidth * k)), H = Math.max(8, Math.round(pic.naturalHeight * k));
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(pic, 0, 0, W, H);
        img = g.getImageData(0, 0, W, H); busy = false; recut();
      };
      pic.onerror = () => { busy = false; app.toast("That picture couldn't be read.", "err"); };
      pic.src = im.src;
    }
    let tmr = 0;
    function recutSoon() { clearTimeout(tmr); tmr = setTimeout(recut, 120); }
    function recut() {
      if (!img || app.command !== def) return;
      mask = subjectMask(img, { mode: st.mode, sens: st.sens, thr: (st.thr / 100) * 255 });
      drawPrev();
      const i = $("pf-info"); if (i) i.textContent = info();
      def.refreshOk && def.refreshOk();
    }
    // the cut-out on a checkerboard
    function drawPrev() {
      const g = prev.getContext("2d"), W = prev.width, H = prev.height;
      for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) { g.fillStyle = ((x + y) / 10) % 2 ? "#d9dde2" : "#f3f5f7"; g.fillRect(x, y, 10, 10); }
      if (!img || !mask) return;
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const id = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      for (let i = 0; i < mask.length; i++) if (!mask[i]) id.data[i * 4 + 3] = 0;
      c.getContext("2d").putImageData(id, 0, 0);
      const k = Math.min(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      g.drawImage(c, (W - w) / 2, (H - h) / 2, w, h);
    }
    openCmd(def);
  }
  app.puffyCmd = (id) => puffyCmd(id || sketcher.active);
  app.pictureCmd = (id) => pictureCmd(id || sketcher.active);
  app.traceCmd = (id) => traceCmd(id || sketcher.active);

  // ------------------------------------------------------------------ Thread
  // ISO metric coarse threads: [nominal diameter, pitch]
  // Unified inch threads (UNC coarse, UNF fine): [name, major diameter in, threads per inch]
  const UN = [["#2-56 UNC", 0.086, 56], ["#4-40 UNC", 0.112, 40], ["#6-32 UNC", 0.138, 32], ["#8-32 UNC", 0.164, 32], ["#10-24 UNC", 0.190, 24], ["#10-32 UNF", 0.190, 32],
    ["1/4-20 UNC", 0.250, 20], ["1/4-28 UNF", 0.250, 28], ["5/16-18 UNC", 0.3125, 18], ["5/16-24 UNF", 0.3125, 24], ["3/8-16 UNC", 0.375, 16], ["3/8-24 UNF", 0.375, 24],
    ["7/16-14 UNC", 0.4375, 14], ["1/2-13 UNC", 0.5, 13], ["1/2-20 UNF", 0.5, 20], ["9/16-12 UNC", 0.5625, 12], ["5/8-11 UNC", 0.625, 11], ["5/8-18 UNF", 0.625, 18], ["3/4-10 UNC", 0.75, 10], ["3/4-16 UNF", 0.75, 16],
    ["7/8-9 UNC", 0.875, 9], ["1-8 UNC", 1, 8], ["1-12 UNF", 1, 12], ["1-1/4-7 UNC", 1.25, 7], ["1-1/2-6 UNC", 1.5, 6], ["2-4.5 UNC", 2, 4.5]];
  // all standard sizes as [label, major diameter mm, pitch mm, family]
  const STD = [];
  const ISO_LIST = [[1, 0.25], [1.2, 0.25], [1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [3.5, 0.6], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5], [33, 3.5], [36, 4], [42, 4.5], [48, 5], [56, 5.5], [64, 6]];
  const ISO = ISO_LIST;
  for (const [d, p] of ISO) STD.push([`M${d} × ${p}`, d, p, "iso"]);
  for (const [n, d, tpi] of UN) STD.push([n, +(d * IN).toFixed(4), +(IN / tpi).toFixed(5), "un"]);
  for (const [n, d, tpi] of UN.filter((u) => /^#|^1\/4|^5\/16|^3\/8|^1\/2-13/.test(u[0]))) TAP[n.replace(/ UN[CF]$/, "").replace(/-\d+(\.\d+)?$/, "") + (n.endsWith("UNF") ? " fine" : "")] = [+(d * IN).toFixed(4), +(IN / tpi).toFixed(5), n];
  // the closest standard size for a boss (outer diameter) or a hole (minor diameter); in inch
  // mode inch sizes are tried first, in mm mode metric ones
  function isoFor(info) {
    const d = 2 * info.r, fam = getUnit() === "in" ? ["un", "iso"] : ["iso", "un"];
    const ref = (s) => (info.ext ? s[1] : s[1] - 1.0825 * s[2]);
    const tol = Math.max(0.15, d * 0.04);
    let pick = null;
    // the other system's sizes only win when they match almost exactly (a real inch bolt in mm mode)
    fam.forEach((f, n) => {
      if (pick && n && Math.abs(ref(pick) - d) < tol) return;
      let best = null, bd = Infinity;
      for (const s of STD) if (s[3] === f) { const e = Math.abs(ref(s) - d); if (e < bd) { bd = e; best = s; } }
      if (!pick) pick = best;
      else if (bd < Math.min(tol, 0.05)) pick = best;
    });
    return { label: pick[0], size: pick[1], pitch: pick[2], fam: pick[3], exact: Math.abs(ref(pick) - d) < tol };
  }
  // pitch: mm in metric mode; threads per inch in inch mode (stored as mm either way)
  function pitchRow(pitch, onCommit, id, live = false) {
    if (getUnit() !== "in") return row("Pitch", app.numField({ value: pitch, id, min: 0.1, step: id === "th-pitch" ? 0.25 : 0.05, live, onCommit }), id);
    const tpiId = id.replace("pitch", "tpi");
    const f = app.numField({ value: +(IN / pitch).toFixed(3), id: tpiId, min: 1, max: 254, step: 1, len: false, live, onCommit: (v) => onCommit(IN / v) });
    const wrap = el("div", { class: "tpi-wrap" }, f, el("span", { class: "hint", style: { padding: 0 } }, `= ${fmt(pitch, 3)} mm pitch`));
    return row("Threads / inch", wrap, tpiId);
  }
  function faceByCenter(base, c, type) {
    let best = -1, bd = Infinity;
    (base.data.faceInfo || []).forEach((f, i) => {
      if (!f || !f.c || (type && f.t !== type)) return;
      const d = Math.hypot(f.c[0] - c[0], f.c[1] - c[1], f.c[2] - c[2]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  // clearance for 3D-printed threads: every thread face moves into the material
  const THREAD_OFFSETS = [0, -0.2, -0.25, -0.3, -0.35, -0.4, -0.45, -0.5];
  // inch mode: thousandths of an inch (stored in mm)
  const THREAD_OFFSETS_IN = [0, -0.005, -0.008, -0.010, -0.012, -0.015, -0.018, -0.020].map((v) => +(v * IN).toFixed(4));
  const offsetLabel = (v) => (!v ? "None" : getUnit() === "in" ? `${fmt(v / IN, 3)} in (${fmt(v, 2)} mm)` : `${fmt(v, 2)} mm`);
  function offsetSelect(value, onPick, id) {
    const list = (getUnit() === "in" ? THREAD_OFFSETS_IN : THREAD_OFFSETS).slice();
    const cur = value || 0;
    if (!list.some((v) => Math.abs(v - cur) < 1e-6)) { list.push(cur); list.sort((a, b) => b - a); }
    const sel = el("select", { class: "num", id, "aria-label": "Thread print offset" }, ...list.map((v) => el("option", { value: v, selected: Math.abs(v - cur) < 1e-6 }, offsetLabel(v))));
    sel.onchange = () => onPick(+sel.value);
    return sel;
  }
  // every thread feature in a body, including ones inside combined bodies
  function threadMods(node, out = []) {
    for (const m of node.mods || []) if (m.t === "thread" || (m.t === "hole" && m.tapped)) out.push(m);
    for (const c of node.children || []) if (!c.hole) threadMods(c.node, out); // jumpstart-3d: fasteners. a tap cutter keeps the offset it was made with
    return out;
  }
  function threadOffsetCmd() {
    const selIds = app.sel.slice();
    const count = (ids) => ids.reduce((n, id) => { const b = findBody(store.doc, id); return n + (b && !b.hole ? threadMods(b.node).length : 0); }, 0); // jumpstart-3d: fasteners
    const allIds = store.doc.bodies.map((b) => b.id);
    const nAll = count(allIds), nSel = count(selIds);
    const st = { clear: store.doc.threadOffset || -0.2, scope: nSel ? "sel" : "all", forNew: !nSel };
    const def = {
      title: "Thread print offset",
      keepSelection: true,
      apply(doc) {
        const ids = st.scope === "sel" ? selIds : doc.bodies.map((b) => b.id);
        for (const id of ids) { const b = findBody(doc, id); if (b && !b.hole) for (const m of threadMods(b.node)) m.clear = st.clear; } // jumpstart-3d: fasteners
        if (st.forNew) doc.threadOffset = st.clear;
      },
      ok() { commit(def, "Thread print offset"); app.toast(st.clear ? `Print offset ${offsetLabel(st.clear)} applied to ${st.scope === "sel" ? nSel : nAll} thread${(st.scope === "sel" ? nSel : nAll) === 1 ? "" : "s"}.` : "Print offset removed."); },
      hint: () => "Loosens printed threads so bolts and nuts screw together. Outside threads get thinner and inside threads get wider.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, getUnit() === "in" ? "Moves every thread surface into the material by this much, so printed parts fit. −0.008 in (0.2 mm) suits most printers; use more if threads bind." : "Moves every thread surface into the material by this much, so printed parts fit. −0.2 mm suits most printers; use more if threads bind."));
        body.append(row("Offset", offsetSelect(st.clear, (v) => { st.clear = v; def.render(); }, "to-clear"), "to-clear"));
        body.append(row("Apply to", seg([["all", `All threads (${nAll})`], ["sel", `Selected objects (${nSel})`]], st.scope, (v) => { if (v === "sel" && !selIds.length) { app.toast("Select objects first, then open this again."); return; } st.scope = v; def.render(); }, "to-scope")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "to-new", checked: st.forNew, onchange: (e) => { st.forNew = e.target.checked; } }), "Also use for new threads"));
        if (!nAll) body.append(el("div", { class: "hint", style: { padding: 0 } }, "There are no threads yet. Tick the box above to use this offset for threads you make."));
      },
    };
    openCmd(def);
  }
  function threadCmd(editing = null) {
    const st = { pick: null, pitch: 1.5, full: true, length: 10, flip: false, left: false, preset: null, clear: store.doc.threadOffset || 0 };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { pitch: m.pitch, full: !(m.length > 0), length: m.length || 10, flip: !!m.flip, left: !!m.left, body: b.id, keepFace: m.face, clear: m.clear || 0 });
      // the face is found on the shape before this thread
      const base = baseOf(b.id);
      if (base) {
        const i = faceByCenter(base, m.face.c, "CYLINDRE");
        if (i >= 0) st.pick = { body: b.id, base, face: i, info: base.data.faceInfo[i] };
      }
    }
    let hover = null;
    const def = {
      title: (editing ? "Edit " : "") + "Thread",
      valid: () => !!(st.pick || st.keepFace) && st.pitch > 0.05,
      canOk: () => def.valid(),
      apply(doc) {
        const id = st.pick ? st.pick.body : st.body;
        const b = findBody(doc, id);
        if (!b) return;
        const face = st.pick ? { c: st.pick.info.c, t: "CYLINDRE" } : st.keepFace;
        const props = { face, pitch: st.pitch, length: st.full ? 0 : st.length, flip: st.flip, left: st.left, clear: st.clear || 0 };
        if (editing) { Object.assign(b.node.mods.find((x) => x.id === editing.mod), props); return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "thread", ...props });
      },
      ok() { commit(def, "Thread"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.pick ? "Modeled thread (ISO metric or inch UNC / UNF: both use the same 60° shape). Building it takes a few seconds." : "Click a round face: the outside of a cylinder (bolt) or the inside of a hole (nut).",
      build(body) {
        const info = st.pick && st.pick.info;
        const txt = info ? el("span", {}, el("b", {}, `Ø${withUnit(2 * info.r, 2)} ${info.ext ? "cylinder" : "hole"}`), info.ext ? " · outside thread" : " · inside thread") : "Select a round face";
        body.append(pickbox(true, txt, st.pick && !editing ? () => { st.pick = null; refresh(); } : null));
        if (info) {
          const iso = isoFor(info);
          body.append(el("div", { class: "hint", style: { padding: 0 } }, iso.exact ? `Matches ${iso.label}${iso.fam === "iso" ? " (ISO coarse)" : ""}.` : `Closest standard size: ${iso.label}. The thread is cut on the face as it is.`));
        }
        // sizes: metric and inch lists (the one for the current units first); value = the label
        const mk = (f) => STD.filter((s) => s[3] === f).map((s) => el("option", { value: s[0], selected: st.preset === s[0] }, s[0] + (f === "un" ? ` (Ø${fmt(s[1], 2)} mm)` : "")));
        const groups = [el("optgroup", { label: "Metric (ISO coarse)" }, ...mk("iso")), el("optgroup", { label: "Inch (UNC / UNF)" }, ...mk("un"))];
        if (getUnit() === "in") groups.reverse();
        const sel = el("select", { class: "num", id: "th-size", "aria-label": "Thread size" }, el("option", { value: "" }, "Custom pitch"), ...groups);
        sel.onchange = () => { const s = STD.find((x) => x[0] === sel.value || (x[3] === "iso" && String(x[1]) === sel.value)); st.preset = s ? s[0] : null; if (s) { st.pitch = s[2]; def.render(); refresh(false); } };
        body.append(row("Size", sel, "th-size"));
        body.append(pitchRow(st.pitch, (v) => { st.pitch = v; st.preset = null; refresh(); }, "th-pitch"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "th-full", checked: st.full, onchange: (e) => { st.full = e.target.checked; refresh(); } }), "Full length"));
        if (!st.full) body.append(row("Length", app.numField({ value: st.length, id: "th-len", min: 0.1, step: 1, onCommit: (v) => { st.length = v; refresh(false); } }), "th-len"));
        body.append(row("Start", seg([[false, "Open end"], [true, "Other end"]], st.flip, (v) => { st.flip = v; refresh(); }, "th-flip")));
        body.append(row("Hand", seg([[false, "Right"], [true, "Left"]], st.left, (v) => { st.left = v; refresh(); }, "th-hand")));
        body.append(row("Print offset", offsetSelect(st.clear, (v) => { st.clear = v; refresh(); }, "th-clear"), "th-clear"));
        if (st.clear && Math.abs(st.clear) > 0.3 * st.pitch + 1e-9) body.append(el("div", { class: "hint", style: { padding: 0 } }, `This pitch allows at most −${withUnit(0.3 * st.pitch, 3)}; that is used.`));
      },
      start() {
        // a selected body with one round face picked from it is common; otherwise wait for a click
        refresh();
      },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          hover = f && f.info && f.info.t === "CYLINDRE" ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f) return true;
          if (!f.info || f.info.t !== "CYLINDRE") { app.toast("Pick a round face: the side of a cylinder or the inside of a hole."); return true; }
          if (editing && f.body !== st.body) { app.toast("Pick a face on the same body."); return true; }
          st.pick = f;
          const iso = isoFor(f.info);
          if (!editing) { st.pitch = iso.pitch; st.preset = iso.exact ? iso.label : null; }
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (st.pick) drawFace(st.pick.base, st.pick.face, 0x2f66c8);
      if (hover && (!st.pick || hover.face !== st.pick.face || hover.body !== st.pick.body)) drawFace(hover.base, hover.face, 0xe8a317);
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Scale
  // Typed scaling for any body (the corner handles do the same by dragging).
  function scaleCmd(editing = null) {
    const st = { body: null, uniform: true, k: [1, 1, 1], anchor: "base" };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      st.body = b.id; st.k = m.k.slice(); st.uniform = Math.abs(m.k[0] - m.k[1]) < 1e-9 && Math.abs(m.k[0] - m.k[2]) < 1e-9;
      // the point that stays put: o = a - k*a
      st.fixed = m.k.map((k, i) => (Math.abs(1 - k) > 1e-9 ? m.o[i] / (1 - k) : 0));
    } else {
      const one = app.sel.filter((id) => !app.isLocked(id));
      if (one.length === 1) st.body = one[0];
    }
    const anchorPoint = (doc) => {
      if (st.fixed) return st.fixed;
      const v = scene.views.get(st.body);
      const bb = v && v.data ? v.data.kbbox || v.data.bbox : { min: [0, 0, 0], max: [0, 0, 0] };
      const c = [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2);
      if (st.anchor === "base") c[2] = bb.min[2];
      if (st.anchor === "corner") return bb.min.slice();
      void doc;
      return c;
    };
    const def = {
      title: (editing ? "Edit " : "") + "Scale",
      valid: () => !!st.body && st.k.every((v) => v > 1e-4),
      canOk: () => def.valid() && (editing || st.k.some((v) => Math.abs(v - 1) > 1e-9)),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const a = anchorPoint(doc);
        const o = a.map((x, i) => +(x - st.k[i] * x).toPrecision(10));
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); m.k = st.k.slice(); m.o = o; return; }
        if (st.k.every((v) => Math.abs(v - 1) < 1e-12)) return;
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "scale", k: st.k.slice(), o });
      },
      ok() { commit(def, "Scale"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.body ? "Type a scale factor (2 = twice as big, 0.5 = half). Or drag the white handles on the body." : "Click the body to scale.",
      build(body) {
        const b = st.body && findBody(store.doc, st.body);
        body.append(pickbox(true, b ? el("b", {}, b.name) : "Select a body", b && !editing ? () => { st.body = null; refresh(); } : null));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sc-uni", checked: st.uniform, onchange: (e) => { st.uniform = e.target.checked; if (st.uniform) st.k = [st.k[0], st.k[0], st.k[0]]; refresh(); } }), "Uniform"));
        if (st.uniform) body.append(row("Factor", app.numField({ value: st.k[0], id: "sc-k", min: 0.001, step: 0.1, live: true, onCommit: (v) => { st.k = [v, v, v]; refresh(false); } }), "sc-k"));
        else ["X", "Y", "Z"].forEach((ax, i) => body.append(row(ax + " factor", app.numField({ value: st.k[i], id: "sc-k" + ax.toLowerCase(), min: 0.001, step: 0.1, live: true, onCommit: (v) => { st.k[i] = v; refresh(false); } }), "sc-k" + ax.toLowerCase())));
        if (!st.fixed) body.append(row("Keep fixed", seg([["base", "Base"], ["center", "Center"], ["corner", "Corner"]], st.anchor, (v) => { st.anchor = v; refresh(); }, "sc-anchor")));
        if (!st.uniform) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Uneven scaling stretches the body. Holes, fillets, shells and threads added in Advanced keep their size."));
      },
      start() { refresh(); },
      handler: {
        hover(e) { const f = pickBaseFace(e, (b) => !b.locked); vp.canvas.style.cursor = f && !editing ? "pointer" : "default"; },
        down(e) {
          if (editing) return true;
          const f = pickBaseFace(e, (b) => !b.locked);
          if (f) { st.body = f.body; refresh(); }
          return true;
        },
      },
    };
    function refresh(rerender = true) { if (rerender) def.render(); schedulePreview(def); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Texture
  // Tactile surface textures (knurl, hex, wood, leather…) on any faces. They
  // change the display and STL mesh; STEP export keeps the smooth shape.
  function textureCmd(editing = null) {
    const st = { body: null, faces: [], all: false, cat: "all", target: "faces", bodies: [], ...TEXTURE_DEFAULTS };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const t = (b.textures || []).find((x) => x.id === editing.tex);
      Object.assign(st, clone(t), { body: b.id, faces: [], all: t.faces === "all", keepFaces: t.faces });
      const base = baseOf(b.id);
      if (base && t.faces !== "all") for (const q of t.faces) { const i = faceByCenter(base, q.c, q.t); if (i >= 0 && !st.faces.some((f) => f.face === i)) st.faces.push({ base, face: i, info: base.data.faceInfo[i] }); }
    } else {
      const one = app.sel.filter((id) => !app.isLocked(id) && !findBody(store.doc, id)?.hole);
      if (one.length === 1) st.body = one[0];
      // several shapes selected: texture them whole
      if (one.length > 1) { st.target = "objects"; st.bodies = one.slice(); }
    }
    let hover = null;
    const layer = () => ({ tex: st.tex, size: st.size, depth: st.depth, dir: st.dir, rot: st.rot, mapping: st.mapping, falloff: st.falloff, invert: st.invert, once: !!st.once });
    const newImages = {}; // pictures imported while this dialog is open
    const myImages = () => ({ ...(store.doc.texImages || {}), ...newImages });
    // turn a picture into a small grayscale height map: dark parts rise
    function importImage() {
      const inp = el("input", { type: "file", accept: "image/*,.svg" });
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const MAX = 384, k = Math.min(1, MAX / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
          const w = Math.max(2, Math.round((img.naturalWidth || img.width || 256) * k)), h = Math.max(2, Math.round((img.naturalHeight || img.height || 256) * k));
          const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // see-through parts count as background
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const px = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) out[i] = 255 - Math.round(0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]);
          const id = uid("img");
          const rec = { name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "My image", w, h, b64: bytesToB64(out) };
          newImages[id] = rec;
          registerImageTexture(id, rec);
          st.tex = "img:" + id; st.cat = "mine"; st.once = true;
          if (st.size < 15) st.size = 30;
          refresh();
          app.toast(`Imported ${rec.name}. Dark parts rise; tick Invert to swap.`);
        };
        img.onerror = () => { URL.revokeObjectURL(url); app.toast("That picture couldn't be opened. Try a PNG, JPG or SVG.", "err"); };
        img.src = url;
      };
      inp.click();
    }
    const def = {
      title: (editing ? "Edit " : "") + "Texture",
      wide: true,
      valid: () => (st.target === "objects" ? st.bodies.length > 0 : !!st.body && (st.all || st.faces.length > 0)) && st.size > 0 && st.depth > 0,
      canOk: () => def.valid(),
      apply(doc) {
        if (st.target === "objects" && !editing) {
          if (st.tex.startsWith("img:")) { const id = st.tex.slice(4); doc.texImages = doc.texImages || {}; if (!doc.texImages[id] && newImages[id]) doc.texImages[id] = newImages[id]; }
          for (const id of st.bodies) {
            const b = findBody(doc, id);
            if (!b || b.hole) continue;
            b.textures = b.textures || [];
            b.textures.push({ id: uid("t"), seq: nextSeq(doc), faces: "all", ...layer() });
          }
          return;
        }
        const b = findBody(doc, st.body);
        if (!b) return;
        const faces = st.all ? "all" : st.faces.map((f) => (f.info.n ? { c: f.info.c, t: f.info.t, n: f.info.n } : { c: f.info.c, t: f.info.t }));
        b.textures = b.textures || [];
        if (st.tex.startsWith("img:")) {
          const id = st.tex.slice(4);
          doc.texImages = doc.texImages || {};
          if (!doc.texImages[id] && newImages[id]) doc.texImages[id] = newImages[id];
        }
        if (editing) { const t = b.textures.find((x) => x.id === editing.tex); Object.assign(t, layer(), { faces }); return; }
        b.textures.push({ id: uid("t"), seq: nextSeq(doc), faces, ...layer() });
      },
      ok() { commit(def, "Texture"); },
      onDelete: editing ? () => { closeCmd(false); store.update((doc) => { const b = findBody(doc, editing.body); b.textures = (b.textures || []).filter((x) => x.id !== editing.tex); }, "Remove texture"); } : null,
      hint: () => st.target === "objects" && !editing ? "Click objects to add or remove them; each is textured all over." : st.body ? "Click faces to texture (click again to remove), or use the whole body." : "Click the faces of a body to texture.",
      build(body) {
        if (!editing) body.append(row("Apply to", seg([["faces", "Faces"], ["objects", "Whole objects"]], st.target, (v) => { st.target = v; if (v === "objects") { st.bodies = st.body ? [st.body] : st.bodies; st.faces = []; st.all = false; } else { st.bodies = []; } refresh(); }, "tx-target")));
        if (st.target === "objects" && !editing) {
          const n = st.bodies.length;
          body.append(pickbox(true, n ? el("span", {}, el("b", {}, n), ` object${n > 1 ? "s" : ""} (whole)`) : "Click objects to texture", n ? () => { st.bodies = []; refresh(); } : null));
        }
        const b = st.body && findBody(store.doc, st.body);
        const what = st.all ? el("span", {}, el("b", {}, "Whole body")) : st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : b ? "Click faces, or…" : "Select faces";
        if (st.target !== "objects" || editing) body.append(pickbox(true, what, st.faces.length || st.all ? () => { st.faces = []; st.all = false; if (!editing && !app.sel.includes(st.body)) st.body = null; refresh(); } : null));
        if (b && !st.all && st.target !== "objects") body.append(el("button", { class: "btn", id: "tx-all", style: { marginBottom: "6px" }, onclick: () => { st.all = true; st.faces = []; refresh(); } }, "Texture the whole body"));
        // library
        body.append(el("div", { class: "tx-cats", id: "tx-cats" }, ...TEX_CATS.map(([k, label]) => el("button", { "aria-pressed": st.cat === k, onclick: () => { st.cat = k; def.render(); } }, label))));
        const grid = el("div", { class: "tx-grid", id: "tx-grid" });
        const mine = Object.keys(myImages()).map((id) => texByKey("img:" + id)).filter((t) => t && t.custom);
        const items = [...mine, ...LIB].filter((t) => st.cat === "all" || t.cat === st.cat);
        grid.append(el("button", { class: "tx-item tx-import", id: "tx-import", title: "Use your own picture (PNG, JPG, SVG) as a texture", onclick: importImage }, el("span", { class: "tx-plus", html: ICON.import }), el("span", {}, "Import image…")));
        for (const t of items) {
          const img = el("img", { alt: "", width: 44, height: 44 });
          const btn = el("button", { class: "tx-item", title: t.name, "aria-pressed": st.tex === t.key, "data-key": t.key, onclick: () => { const wasMine = st.tex.startsWith("img:"); st.tex = t.key; if (t.custom && !wasMine) { st.once = true; if (st.size < 15) st.size = 30; refresh(); return; } if (t.size && !st.sizeSet && !editing && Math.abs(st.size - t.size) > 1e-9) { st.size = t.size; const nf = document.getElementById("tx-size"), rg = document.getElementById("tx-size-range"); if (nf && nf.setValue) nf.setValue(t.size); else if (nf) nf.value = t.size; if (rg) { if (+rg.max < t.size) rg.max = 100; rg.value = t.size; } } grid.querySelectorAll(".tx-item").forEach((x) => x.setAttribute("aria-pressed", x.dataset.key === t.key)); schedulePreview(def); } }, img, el("span", {}, t.name));
          grid.append(btn);
          thumbQueue.push([img, t.key]);
        }
        pumpThumbs();
        body.append(grid);
        const live = (k) => (v) => { st[k] = v; refreshSoon(); };
        body.append(sliderRow("Tile size", "tx-size", st.size, 0.5, Math.max(20, st.size > 20 ? 100 : 20), 0.1, "mm", (v) => { st.sizeSet = true; live("size")(v); }));
        body.append(sliderRow("Depth", "tx-depth", st.depth, 0.05, 3, 0.05, "mm", live("depth")));
        body.append(row("Direction", seg([["raise", "Raise"], ["engrave", "Engrave"], ["both", "Both"]], st.dir, (v) => { st.dir = v; refresh(); }, "tx-dir")));
        body.append(sliderRow("Rotation", "tx-rot", st.rot, -180, 180, 1, "°", live("rot")));
        body.append(row("Mapping", seg([["auto", "Auto"], ["planar", "Flat"], ["cylindrical", "Round"], ["triplanar", "Box"]], st.mapping, (v) => { st.mapping = v; refresh(); }, "tx-map")));
        body.append(sliderRow("Edge blend", "tx-fall", st.falloff, 0, 10, 0.1, "mm", live("falloff")));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-inv", checked: st.invert, onchange: (e) => { st.invert = e.target.checked; refresh(false); } }), "Invert pattern"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-once", checked: !!st.once, onchange: (e) => { st.once = e.target.checked; refresh(false); } }), "Show once, centred (don't repeat)"));
        if (st.tex.startsWith("img:")) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Your picture: dark parts rise, light parts stay flat. Tile size sets its width. High-contrast pictures (logos, line art) work best."));
        const v = st.body && scene.views.get(st.body);
        if (v && v.data && v.data.texInfo && v.data.texInfo.limited) body.append(el("div", { class: "hint", style: { padding: 0 } }, "Detail was capped to keep the mesh manageable. Try a bigger tile size."));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Textures shape the display and STL export. STEP export keeps the smooth body."));
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
      start() { refresh(); },
      handler: {
        hover(e) {
          if (st.target === "objects" && !editing) { const f = pickBaseFace(e, (b) => !b.hole && !b.locked); scene.setHovered(f ? f.body : null); vp.canvas.style.cursor = f ? "pointer" : "default"; return; }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body || !(st.faces.length || st.all)));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          if (st.target === "objects" && !editing) {
            const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
            if (f) { const k = st.bodies.indexOf(f.body); if (k >= 0) st.bodies.splice(k, 1); else st.bodies.push(f.body); refresh(); }
            return true;
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f || !f.info) return true;
          if (st.body && f.body !== st.body && (st.faces.length || st.all || editing)) { app.toast("Texture one body at a time. Clear the faces to switch bodies."); return true; }
          if (st.body !== f.body) { st.body = f.body; st.faces = []; st.all = false; }
          if (st.all) { st.all = false; st.faces = (f.base.data.faceInfo || []).map((info, i) => ({ base: f.base, face: i, info })).filter((x) => x.info && x.info.c); }
          const i = st.faces.findIndex((x) => x.face === f.face);
          if (i >= 0) st.faces.splice(i, 1);
          else st.faces.push({ base: f.base, face: f.face, info: f.info });
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
      if (hover && !st.faces.some((f) => f.face === hover.face && hover.body === st.body)) drawFace(hover.base, hover.face, 0xe8a317);
    }
    function refresh(rerender = true) { if (rerender) def.render(); if (st.target === "objects" && !editing) scene.setSelected(st.bodies); draw(); schedulePreview(def); }
    // sliders preview a moment after you stop moving them (textures take a little while to build)
    let soon = 0;
    function refreshSoon() { clearTimeout(soon); soon = setTimeout(() => { if (app.command === def) schedulePreview(def); }, 140); }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Loft (Fusion-style)
  // sections: sketch profiles, flat faces (outlined into a sketch on OK) or a sketch point at either end;
  // smooth or straight, open or closed, optionally along a centerline rail.
  function loftCmd(editing = null) {
    const st = { secs: [], rail: null, pickRail: false, ruled: false, closed: false, op: "auto", hoverKey: null, pend: new Map(), editing };
    const ownSketch = (id) => findSketch(store.view, id) || st.pend.get(id) || null;
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const node = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).tool : b.node;
      st.secs = clone(node.sections || []);
      st.rail = node.rail ? clone(node.rail) : null;
      st.ruled = !!node.ruled; st.closed = !!node.closed;
      st.op = editing.mod ? b.node.mods.find((m) => m.id === editing.mod).op : "new";
    }
    const secKey = (s) => (s.point ? "p:" + s.point.sketch + ":" + s.point.id : s.sketch + ":" + s.ref.key + ":" + s.ref.pt.map((v) => v.toFixed(4)).join(","));
    const regionIndex = (s) => { const sk = ownSketch(s.sketch); if (!sk) return -1; const regs = regionsFor(sk); return regs.findIndex((r) => r.key === s.ref.key && pointIn(r, s.ref.pt)); };
    // world-space outline of a section (for the overlay and the bounding box)
    function secPts(s) {
      if (s.point) {
        const sk = ownSketch(s.point.sketch); if (!sk) return [];
        const c = resolveSketch(sk).find((q) => q.id === s.point.id); const p = (sk.pts || []).find((q) => q.id === s.point.id);
        const xy = c && c.t === "point" ? c.p : p ? [p.x, p.y] : null;
        return xy ? [new THREE.Vector3(xy[0], xy[1], 0).applyMatrix4(planeMatrix(sk.plane))] : [];
      }
      const sk = ownSketch(s.sketch); if (!sk) return [];
      const r = regionsFor(sk)[regionIndex(s)]; if (!r) return [];
      const M = planeMatrix(sk.plane);
      return r.poly.map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
    }
    const center = (pts) => pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pts.length));
    function loftNode() { return { t: "loft", sections: st.secs.map((s) => clone(s)), rail: st.rail ? clone(st.rail) : null, ruled: st.ruled, closed: st.closed }; }
    function loftBox() {
      const box = new THREE.Box3();
      for (const s of st.secs) for (const p of secPts(s)) box.expandByPoint(p);
      return box.isEmpty() ? null : box;
    }
    function parts() {
      const tb = loftBox(); if (!tb) return [];
      tb.expandByScalar(1e-3);
      return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && (!editing || editing.body !== b.id)).filter((b) => { const bb = scene.bodyTightBox(b.id); return bb && bb.intersectsBox(tb); }).map((b) => b.id);
    }
    function opNow() {
      if (st.op !== "auto") return st.op;
      // a profile drawn on a body's face grows that body; otherwise a new body
      const onBody = st.secs.some((s) => { const sk = !s.point && ownSketch(s.sketch); return sk && sk.onBody; });
      return onBody && parts().length ? "join" : "new";
    }
    const def = {
      title: (editing ? "Edit " : "") + "Loft",
      wide: true,
      valid: () => st.secs.filter((s) => !s.point).length >= 1 && st.secs.length >= 2,
      canOk: () => def.valid(),
      apply(doc) {
        // face outlines picked during the loft become real (hidden) sketches
        for (const [id, sk] of st.pend) if (!findSketch(doc, id) && st.secs.some((s) => s.sketch === id)) { const c = clone(sk); c.seq = nextSeq(doc); c.name = nextSketchName(doc); c.hidden = true; doc.sketches.push(c); }
        const node = loftNode();
        if (editing) {
          const b = findBody(doc, editing.body);
          if (editing.mod) { const m = b.node.mods.find((x) => x.id === editing.mod); m.tool = { ...node, mods: [] }; if (st.op !== "auto" && st.op !== "new") m.op = st.op; if (app.previewing && m.op === "cut") showCut(doc, node); }
          else b.node = { ...node, mods: b.node.mods || [] };
          return;
        }
        const op = opNow();
        const ps = parts();
        if (op === "new" || !ps.length) {
          doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, "Body"), seq: nextSeq(doc), color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] } });
        } else {
          const seq = nextSeq(doc);
          for (const id of op === "join" ? [ps[0]] : ps) {
            const b = findBody(doc, id);
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq, t: "bool", op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
          }
          if (app.previewing && op === "cut") showCut(doc, node);
        }
        for (const s of st.secs) { const sk = !s.point && findSketch(doc, s.sketch); if (sk) sk.hidden = true; }
        if (st.rail) { const sk = findSketch(doc, st.rail.sketch); if (sk) sk.hidden = true; }
      },
      ok() { commit(def, editing ? "Edit loft" : "Loft"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.pickRail ? "Click a sketch line, arc or spline for the centerline. Connected curves join into one path." : "Click profiles in order: sketch shapes, flat faces of bodies, or a sketch point for a pointed end.",
      build(body) {
        body.append(pickbox(!st.pickRail, st.secs.length ? el("span", {}, el("b", {}, st.secs.length), ` section${st.secs.length > 1 ? "s" : ""}, in order`) : "Click profiles in order", st.secs.length ? () => { st.secs = []; refresh(); } : null, () => { st.pickRail = false; def.render(); }));
        // the ordered list: move up / down, remove
        if (st.secs.length) {
          const list = el("ol", { class: "loft-list", id: "loft-list" });
          st.secs.forEach((s, i) => {
            const sk = ownSketch(s.point ? s.point.sketch : s.sketch);
            const name = s.point ? "Point" + (sk ? " · " + (sk.name || "sketch") : "") : (sk ? (sk.fromFace && !findSketch(store.doc, sk.id) ? "Face outline" : sk.name || "Sketch") + " profile" : "Missing profile");
            const mv = (d) => { const j = i + d; if (j < 0 || j >= st.secs.length) return; [st.secs[i], st.secs[j]] = [st.secs[j], st.secs[i]]; refresh(); };
            list.append(el("li", {}, el("span", { class: "ln" }, String(i + 1)), el("span", { class: "lname" }, name),
              el("button", { class: "lbtn", title: "Move up", disabled: i === 0, onclick: () => mv(-1) }, "↑"),
              el("button", { class: "lbtn", title: "Move down", disabled: i === st.secs.length - 1, onclick: () => mv(1) }, "↓"),
              el("button", { class: "lbtn", title: "Remove", onclick: () => { st.secs.splice(i, 1); refresh(); } }, "×")));
          });
          body.append(list);
          body.append(el("button", { class: "btn", id: "loft-reverse", style: { alignSelf: "flex-start" }, onclick: () => { st.secs.reverse(); refresh(); } }, "Reverse order"));
        }
        body.append(row("Shape", seg([[false, "Smooth"], [true, "Straight"]], st.ruled, (v) => { st.ruled = v; refresh(); }, "loft-ruled")));
        const nReg = st.secs.filter((s) => !s.point).length;
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "loft-closed", checked: st.closed, disabled: nReg < 3 || !!st.rail, onchange: (e) => { st.closed = e.target.checked; refresh(); } }), "Closed loop (back to the first profile; needs 3+ profiles)"));
        const n = st.rail ? st.rail.ents.length : 0;
        body.append(row("Centerline", pickbox(st.pickRail, n ? el("span", {}, el("b", {}, n), ` curve${n > 1 ? "s" : ""}`) : "Optional: click to pick", n ? () => { st.rail = null; st.pickRail = false; refresh(); } : null, () => { st.pickRail = true; st.closed = false; def.render(); }), "loft-rail"));
        if (!editing || editing.mod) {
          const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["auto", "Automatic"], ["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
          const sel = el("select", { class: "num", id: "loft-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
          sel.onchange = () => { st.op = sel.value; refresh(); };
          body.append(row("Operation", sel, "loft-op"));
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Profiles can sit on any planes, at any angle. Different shapes blend into each other (square to circle, star to circle…). Points can only be first or last. A centerline makes the loft follow a path."));
      },
      start() {
        scene.state.forceSketches = new Set(store.doc.sketches.map((x) => x.id));
        scene.syncSketches(store.view);
        refresh();
      },
      cleanup() { scene.state.forceSketches = null; scene.syncSketches(store.view); },
      handler: {
        hover(e) {
          if (st.pickRail) { const h = pickSketchCurve(e); vp.canvas.style.cursor = h ? "pointer" : "default"; st.hoverRail = h ? pathPts(h) : null; draw(); return; }
          const pt = pickSketchPointAny(e);
          st.hoverPtSel = pt;
          if (pt) { vp.canvas.style.cursor = "pointer"; st.hoverFace = null; st.hoverPt = pt.world; draw(); return; }
          st.hoverPt = null;
          const hits = vp.pick(e, scene.regionMeshes());
          const k = hits.length ? hits[0].object.userData.region.sketch + ":" + hits[0].object.userData.region.index : null;
          const hf = !k ? pickBaseFace(e, (b) => !b.hole && !b.locked) : null;
          st.hoverFace = hf && hf.info && hf.info.t === "PLANE" ? hf : null;
          vp.canvas.style.cursor = k || st.hoverFace ? "pointer" : "default";
          if (k !== st.hoverKey) { st.hoverKey = k; highlight(); }
          draw();
        },
        down(e) {
          if (st.pickRail) {
            const h = pickSketchCurve(e);
            if (h) { const sk = findSketch(store.view, h.sketch); st.rail = { sketch: h.sketch, ents: pathChain(resolveSketch(sk), h.curve.id) }; st.pickRail = false; st.hoverRail = null; refresh(); }
            return true;
          }
          const pt = pickSketchPointAny(e) || st.hoverPtSel;
          if (pt) { st.hoverPtSel = null; add({ point: { sketch: pt.sketch, id: pt.id } }); return true; }
          const hits = vp.pick(e, scene.regionMeshes());
          if (hits.length) {
            // stacked profiles (seen from above they overlap): each click at the same spot takes the
            // next one down that isn't in the loft yet; when all are in, the nearest one comes out
            const secOf = (h) => { const r = h.object.userData.region; return { sketch: r.sketch, ref: { key: r.region.key, pt: r.region.pt } }; };
            const have = new Set(st.secs.map(secKey));
            const fresh = hits.find((h) => !have.has(secKey(secOf(h))));
            add(secOf(fresh || hits[0]));
            return true;
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (f && f.info && f.info.t === "PLANE") { addFace(f, e); return true; }
          if (f) app.toast("Pick flat faces or sketch profiles for a loft.");
          return true;
        },
      },
    };
    function add(s) {
      const k = secKey(s);
      const i = st.secs.findIndex((x) => secKey(x) === k);
      if (i >= 0) st.secs.splice(i, 1);
      else {
        if (s.point && st.secs.some((x) => x.point) && st.secs.filter((x) => x.point).length >= 2) { app.toast("A loft can have a point at each end, no more."); return; }
        st.secs.push(s);
      }
      refresh();
    }
    // a flat face: its outline becomes a sketch (made real on OK)
    function addFace(f) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Face outline", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      projectFaceEdges(sk, f);
      const regs = regionsFor(sk);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert());
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, [q.x, q.y])) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      st.pend.set(sk.id, sk);
      add({ sketch: sk.id, ref: { key: regs[best].key, pt: regs[best].pt } });
    }
    // sketch points and line ends (for a pointed loft end)
    function pickSketchPointAny(e) {
      vp.updateCamera();
      const [mx, my] = vp.local(e);
      let best = null, bd = vp.tol(8);
      for (const sk of [...store.view.sketches, ...st.pend.values()]) {
        if (!scene.sketchViews.has(sk.id)) continue;
        const M = planeMatrix(sk.plane);
        for (const c of resolveSketch(sk)) {
          if (c.t !== "point") continue;
          const w = new THREE.Vector3(c.p[0], c.p[1], 0).applyMatrix4(M);
          const s2 = vp.project(w);
          const d = Math.hypot(s2[0] - mx, s2[1] - my);
          if (d < bd) { bd = d; best = { sketch: sk.id, id: c.id, world: w }; }
        }
      }
      return best;
    }
    function highlight() {
      const sel = new Set();
      for (const s of st.secs) if (!s.point) { const i = regionIndex(s); if (i >= 0) sel.add(s.sketch + ":" + i); }
      scene.highlightRegions(sel, st.hoverKey);
    }
    function draw() {
      clearOv();
      const cs = [];
      st.secs.forEach((s, i) => {
        const pts = secPts(s);
        if (!pts.length) return;
        if (s.point) drawDot(pts[0], 0x2f66c8, 11);
        else drawLine([...pts, pts[0]], 0x2f66c8);
        cs.push(center(pts));
      });
      // the loft's order: a line through the section centres
      if (cs.length > 1) drawLine(st.closed ? [...cs, cs[0]] : cs, 0xe8a317);
      if (st.rail) { const sk = findSketch(store.view, st.rail.sketch); if (sk) { const M = planeMatrix(sk.plane); for (const c of resolveSketch(sk).filter((c) => st.rail.ents.includes(c.id))) drawLine(sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)), 0x7b4fa8); } }
      for (const pl of st.hoverRail || []) drawLine(pl, 0xe8a317);
      if (st.hoverFace) drawFace(st.hoverFace.base, st.hoverFace.face, 0xe8a317, 0.35);
      if (st.hoverPt) drawDot(st.hoverPt, 0xe8a317, 12);
    }
    function refresh(rerender = true) {
      // show the outlines of picked faces so they can be clicked again (to remove)
      scene.state.forceSketches = new Set([...store.doc.sketches.map((x) => x.id), ...st.pend.keys()]);
      if (rerender) def.render();
      highlight(); draw();
      schedulePreview(def);
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Mirror (bodies)
  function mirrorCmd() {
    const st = { bodies: app.sel.filter((id) => { const b = findBody(store.doc, id); return b && !b.locked; }), plane: null, planeName: "", join: false, pickPlane: false };
    // like Fusion: with bodies already picked, the next click chooses the plane; otherwise
    // clicks pick bodies until the Mirror plane box is clicked (origin planes work any time)
    st.pickPlane = st.bodies.length > 0;
    const def = {
      title: "Mirror",
      valid: () => st.bodies.length > 0 && !!st.plane,
      canOk: () => def.valid(),
      apply(doc) {
        const P = { o: st.plane.o.slice(), n: st.plane.n.slice() };
        for (const id of st.bodies) {
          const b = findBody(doc, id);
          if (!b) continue;
          if (st.join) {
            // one body: the original plus its mirror image (a snapshot of the body as it is now)
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "bool", op: "join", tool: { t: "mirror", src: clone(b.node), srcM: b.m.slice(), plane: P, mods: [] }, m: arr(M4(b.m).invert()) });
          } else {
            // a new body that follows the original when it changes
            doc.bodies.push({ id: (st.ids || (st.ids = {}))[id] || (st.ids[id] = uid("b")), name: (b.name || "Body") + " (mirror)", seq: nextSeq(doc), color: b.color, hole: !!b.hole, hidden: false, m: IDENTITY.slice(), node: { t: "mirror", srcBody: b.id, plane: P, mods: [] } });
          }
        }
      },
      ok() { commit(def, "Mirror"); },
      hint: () => st.pickPlane ? "Click a plane or a flat face to mirror across (or pick YZ / XZ / XY)." : !st.bodies.length ? "Click the bodies to mirror." : !st.plane ? "Click more bodies, then click the Mirror plane box, or pick YZ / XZ / XY." : "Click bodies to add or remove them.",
      sceneSel: () => st.bodies,
      build(body) {
        body.append(row("Bodies", pickbox(!st.pickPlane, st.bodies.length ? el("span", {}, el("b", {}, st.bodies.length), ` bod${st.bodies.length > 1 ? "ies" : "y"}`) : "Click bodies", st.bodies.length ? () => { st.bodies = []; refresh(); } : null, () => { st.pickPlane = false; def.render(); }), "mir-bodies"));
        body.append(row("Mirror plane", pickbox(st.pickPlane || !st.plane, st.plane ? el("span", {}, el("b", {}, st.planeName)) : "Click a plane or face", null, () => { st.pickPlane = true; def.render(); }), "mir-plane"));
        body.append(row("…or use", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], ["YZ", "XZ", "XY"].includes(st.planeName) ? st.planeName : null, (v) => { const p = ORIGIN_PLANES[v]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = v; st.pickPlane = false; refresh(); }, "mir-origin")));
        const cps = store.doc.planes || [];
        if (cps.length) {
          const sel = el("select", { class: "num", id: "mir-cplane" }, el("option", { value: "" }, "A construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
          sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) { st.plane = { o: p.plane.o.slice(), n: p.plane.n.slice() }; st.planeName = p.name; st.pickPlane = false; refresh(); } };
          body.append(row("", sel, "mir-cplane"));
        }
        body.append(row("Result", seg([[false, "New body"], [true, "Join"]], st.join, (v) => { st.join = v; refresh(); }, "mir-op")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.join ? "Join merges each body with its mirror image into one body." : "New body makes a linked copy: it updates when you change the original."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(g && g.object);
          st.hover = !g && !cp && f && f.info && f.info.t === "PLANE" ? f : null;
          draw();
          vp.canvas.style.cursor = g || cp || f ? "pointer" : "default";
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          const wantPlane = st.pickPlane;
          if (cp && (wantPlane || !f)) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; st.pickPlane = false; refresh(); return true; }
          if (g && (wantPlane || !f)) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; st.pickPlane = false; refresh(); return true; }
          if (!f) return true;
          if (wantPlane && f.info && f.info.t === "PLANE") {
            const pl = planeFromFace(f);
            const c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
            st.plane = { o: c.toArray(), n: pl.n }; st.planeName = "Face of " + (findBody(store.doc, f.body)?.name || "body"); st.pickPlane = false; refresh(); return true;
          }
          const b = findBody(store.doc, f.body);
          if (b && b.locked) return true;
          const i = st.bodies.indexOf(f.body);
          if (i >= 0) st.bodies.splice(i, 1); else st.bodies.push(f.body);
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      if (st.hover && st.pickPlane) drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.35);
      if (st.plane) {
        // the mirror plane, sized to the bodies
        const n = new THREE.Vector3(...st.plane.n).normalize(), o = new THREE.Vector3(...st.plane.o);
        const box = new THREE.Box3();
        for (const id of st.bodies) { const bb = scene.bodyTightBox(id); if (bb) box.union(bb); }
        const s = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.2);
        const c = box.isEmpty() ? o : new THREE.Plane().setFromNormalAndCoplanarPoint(n, o).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
        const u = new THREE.Vector3(0, 0, 1).cross(n); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
        const v = n.clone().cross(u).normalize();
        const P = (a, b) => c.clone().addScaledVector(u, a * s / 2).addScaledVector(v, b * s / 2);
        drawLine([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), P(-1, -1)], 0x7b4fa8);
        drawLine([P(-1, 0), P(1, 0)], 0x7b4fa8);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected(st.bodies);
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Split body / Split face (Fusion-style)
  // the splitting plane from the plane gizmo, a construction plane or a flat face (world coordinates)
  function planePickerRows(body, st, refresh) {
    body.append(row("Tool plane", seg([["YZ", "YZ"], ["XZ", "XZ"], ["XY", "XY"]], ["YZ", "XZ", "XY"].includes(st.planeName) ? st.planeName : null, (v) => { const p = ORIGIN_PLANES[v]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = v; st.toolBody = null; st.curves = null; refresh(); }, "sp-origin")));
    const cps = store.doc.planes || [];
    if (cps.length) {
      const sel = el("select", { class: "num", id: "sp-cplane" }, el("option", { value: "" }, "A construction plane…"), ...cps.map((p) => el("option", { value: p.id }, p.name)));
      sel.onchange = () => { const p = cps.find((q) => q.id === sel.value); if (p) { st.plane = { o: p.plane.o.slice(), n: p.plane.n.slice() }; st.planeName = p.name; st.toolBody = null; st.curves = null; refresh(); } };
      body.append(row("", sel, "sp-cplane"));
    }
  }
  function drawToolPlane(st, ids) {
    if (!st.plane) return;
    const n = new THREE.Vector3(...st.plane.n).normalize(), o = new THREE.Vector3(...st.plane.o);
    const box = new THREE.Box3();
    for (const id of ids) { const bb = scene.bodyTightBox(id); if (bb) box.union(bb); }
    const sz = box.isEmpty() ? 60 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.15);
    const c = box.isEmpty() ? o : new THREE.Plane().setFromNormalAndCoplanarPoint(n, o).projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
    const u = new THREE.Vector3(0, 0, 1).cross(n); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
    const v = n.clone().cross(u).normalize();
    const P = (a, b) => c.clone().addScaledVector(u, a * sz / 2).addScaledVector(v, b * sz / 2);
    drawLine([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), P(-1, -1)], 0xd9534f);
    drawLine([P(-1, 0), P(1, 0)], 0xd9534f); drawLine([P(0, -1), P(0, 1)], 0xd9534f);
  }
  // a world plane in a body's own coordinates
  function planeToLocal(pl, bodyM) {
    const inv = M4(bodyM).invert();
    const o = new THREE.Vector3(...pl.o).applyMatrix4(inv);
    const n = new THREE.Vector3(...pl.n).transformDirection(inv).normalize();
    const r = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-12 ? 0 : +q.toFixed(9)));
    return { o: r(o), n: r(n) };
  }
  function splitBodyCmd() {
    const one = app.sel.length === 1 && findBody(store.doc, app.sel[0]);
    const st = { body: one && !one.locked ? one.id : null, plane: null, planeName: "", toolBody: null, sketch: null, kind: "plane", pick: one ? "tool" : "body" };
    const def = {
      title: "Split body",
      valid: () => !!st.body && (!!st.plane || !!st.toolBody || !!st.sketch),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const before = clone(b.node);
        const piece = { id: st.newId || (st.newId = uid("b")), name: (b.name || "Body") + " (split)", seq: nextSeq(doc), color: BODY_COLORS[(doc.bodies.length + 3) % BODY_COLORS.length], hole: false, hidden: false, m: b.m.slice(), node: before };
        piece.node.mods = (piece.node.mods || []).slice();
        b.node.mods = b.node.mods || [];
        if (st.sketch) {
          // a sketch: its curves are pushed through the body; each piece keeps one side
          const inv = M4(b.m).invert();
          const L = (p) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
          const D = (v) => new THREE.Vector3(...v).transformDirection(inv).toArray();
          const k = st.sketch;
          const curves = k.segs.map((x) => x.t === "circle" ? { t: "circle", c: L(x.c), r: x.r, n: D(x.n) } : { t: x.t, a: L(x.a), b: L(x.b), m: x.m && L(x.m), spans: x.spans && x.spans.map((q) => q.map(L)) });
          const plane = { o: L(k.plane.o), x: D(k.plane.x), n: D(k.plane.n) };
          const base = { t: "sketchsplit", curves, poly: k.poly, closed: k.closed, plane };
          b.node.mods.push({ id: uid("f"), seq: piece.seq, ...base, side: "a" });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, ...clone(base), side: "b" });
        } else if (st.plane) {
          const pl = planeToLocal(st.plane, b.m);
          b.node.mods.push({ id: uid("f"), seq: piece.seq, t: "halfspace", plane: pl, side: 1 });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, t: "halfspace", plane: pl, side: -1 });
        } else {
          // split by another body: the part inside the tool becomes its own body; the tool body stays
          const tb = findBody(doc, st.toolBody);
          const tool = { t: "placed", src: clone(tb.node), srcM: tb.m.slice(), mods: [] };
          const m = arr(M4(b.m).invert());
          b.node.mods.push({ id: uid("f"), seq: piece.seq, t: "bool", op: "cut", tool, m });
          piece.node.mods.push({ id: uid("f"), seq: piece.seq, t: "bool", op: "intersect", tool: clone(tool), m });
        }
        doc.bodies.push(piece);
      },
      ok() { commit(def, "Split body"); },
      hint: () => st.pick === "body" ? "Click the body to split." : st.kind === "sketch" ? "Click a line, arc, spline or circle in a sketch (or pick a sketch in the list)." : st.kind === "body" ? "Click the body to split with." : "Pick a plane below, or click a plane or flat face.",
      build(body) {
        const bb = st.body && findBody(store.doc, st.body);
        body.append(row("Body to split", pickbox(st.pick === "body", bb ? el("span", {}, el("b", {}, bb.name)) : "Click a body", bb ? () => { st.body = null; st.pick = "body"; refresh(); } : null, () => { st.pick = "body"; def.render(); }), "sp-body"));
        body.append(row("Tool type", seg([["plane", "Plane / face"], ["sketch", "Sketch"], ["body", "Body"]], st.kind, (v) => { st.kind = v; st.pick = "tool"; st.plane = null; st.planeName = ""; st.toolBody = null; st.sketch = null; refresh(); }, "sp-kind")));
        const tname = st.toolBody ? (findBody(store.doc, st.toolBody)?.name || "Body") + " (body)" : st.sketch ? st.sketch.label : st.planeName;
        const ask = st.kind === "sketch" ? "Click a sketch line, arc, spline or circle" : st.kind === "body" ? "Click another body" : "Plane or flat face";
        body.append(row("Splitting tool", pickbox(st.pick === "tool", tname ? el("span", {}, el("b", {}, tname)) : ask, null, () => { st.pick = "tool"; def.render(); }), "sp-tool"));
        if (st.kind === "plane") planePickerRows(body, st, refresh);
        if (st.kind === "sketch") {
          const sks = store.doc.sketches || [];
          if (sks.length) {
            const sel = el("select", { class: "num", id: "sp-sketch" }, el("option", { value: "" }, "…or a whole sketch"), ...sks.map((k) => el("option", { value: k.id }, k.name || "Sketch")));
            sel.onchange = () => { if (sel.value) useSketch(sel.value, null); };
            body.append(row("", sel, "sp-sketch"));
          }
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.kind === "sketch"
          ? "The sketch is pushed straight through the body (along its plane's normal). A closed shape splits off what's inside it; a line or curve splits the body into its two sides. Lines are treated as running on past their ends."
          : "The body is cut in two where the tool crosses it. Both pieces become separate bodies; a tool body is kept."));
      },
      start() { showPlaneGizmo(true); scene.state.forceSketches = new Set(store.doc.sketches.map((x) => x.id)); scene.syncSketches(store.view); refresh(); },
      cleanup() { showPlaneGizmo(false); scene.state.forceSketches = null; scene.syncSketches(store.view); scene.setSelected(app.sel); },
      handler: {
        hover(e) {
          if (st.pick === "tool" && st.kind === "sketch") { const h = pickSketchCurve(e); st.hoverCurve = h ? pathPts(h) : null; vp.canvas.style.cursor = h ? "pointer" : "default"; draw(); return; }
          const { g, f, cp } = pickPlaneOrFace(e);
          hotGizmo(st.pick === "tool" && st.kind === "plane" ? g && g.object : null);
          st.hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = g || cp || f ? "pointer" : "default";
        },
        down(e) {
          const { g, f, cp } = pickPlaneOrFace(e);
          if (st.pick === "body") {
            if (f && !findBody(store.doc, f.body)?.locked) { st.body = f.body; st.pick = "tool"; refresh(); }
            return true;
          }
          if (st.kind === "sketch") {
            const h = pickSketchCurve(e);
            if (h) useSketch(h.sketch, h.curve.id);
            return true;
          }
          if (cp && !f) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; st.toolBody = null; refresh(); return true; }
          if (g && !f) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; st.toolBody = null; refresh(); return true; }
          if (!f) return true;
          if (st.kind === "body") {
            if (f.body === st.body) { app.toast("Pick a different body as the tool."); return true; }
            st.toolBody = f.body; st.plane = null; st.planeName = ""; refresh(); return true;
          }
          if (f.info.t === "PLANE") {
            const pl = planeFromFace(f);
            st.plane = { o: new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m).toArray(), n: pl.n }; st.planeName = "Face plane"; st.toolBody = null; refresh();
          } else app.toast("Pick a flat face, a plane or a body.");
          return true;
        },
      },
    };
    // a sketch as the tool: the chain of curves through the clicked one (or the sketch's first chain)
    function useSketch(id, curveId) {
      const sk = findSketch(store.view, id);
      if (!sk) return;
      const curves = resolveSketch(sk).filter((c) => !c.cons && (c.t === "line" || c.t === "arc" || c.t === "circle" || c.t === "spline"));
      const startId = curveId || (curves[0] && curves[0].id);
      if (!startId) { app.toast("That sketch has no lines or curves."); return; }
      const ents = pathChain(resolveSketch(sk), startId);
      const ordered = orderPath(resolveSketch(sk), ents);
      const M = sk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
      const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
      const segs = ordered.map((x) => x.t === "circle" ? { t: "circle", c: W(x.c), r: x.r, n: M.n } : { t: x.t, a: W(x.a), b: W(x.b), m: x.m && W(x.m), spans: x.spans && x.spans.map((q) => q.map(W)) });
      // the 2D outline (sketch coordinates) used to sort pieces to a side
      const poly = [];
      for (const x of ordered) { for (const q of sampleCurve(x, 48)) { const last = poly[poly.length - 1]; if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-6) poly.push([q[0], q[1]]); } }
      const closed = ordered.some((x) => x.t === "circle") || (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-4);
      if (closed && poly.length > 2) poly.pop();
      // an open line splits a body only if it runs right across: extend both ends far past the body
      if (!closed && poly.length >= 2) {
        const ext = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.hypot(dx, dy) || 1; return [a[0] + (dx / l) * 1e4, a[1] + (dy / l) * 1e4]; };
        const p0 = ext(poly[0], poly[1]), p1 = ext(poly[poly.length - 1], poly[poly.length - 2]);
        const first = segs[0], last = segs[segs.length - 1];
        poly.unshift(p0); poly.push(p1);
        segs.unshift({ t: "line", a: W(p0), b: first.a });
        segs.push({ t: "line", a: last.b, b: W(p1) });
      }
      st.sketch = { segs, poly, closed, plane: { o: M.o.slice(), x: M.x.slice(), n: M.n.slice() }, label: (sk.name || "Sketch") + (closed ? " (closed shape)" : " (curve)"), sketchId: id, ents };
      st.hoverCurve = null;
      refresh();
    }
    function draw() {
      clearOv();
      if (st.hover && st.pick === "tool" && st.kind === "plane" && st.hover.info.t === "PLANE") drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.3);
      if (st.kind === "plane") drawToolPlane(st, st.body ? [st.body] : []);
      if (st.sketch) {
        const sk = findSketch(store.view, st.sketch.sketchId);
        if (sk) { const M = planeMatrix(sk.plane); for (const c of resolveSketch(sk).filter((c) => st.sketch.ents.includes(c.id))) drawLine(sampleCurve(c).map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M)), 0xd9534f); }
      }
      for (const pl of st.hoverCurve || []) drawLine(pl, 0xe8a317);
    }

    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected([st.body, st.toolBody].filter(Boolean));
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  function splitFaceCmd(editing = null) {
    const st = { faces: [], body: null, plane: null, planeName: "", curves: null, curvesRef: null, pick: "faces" };
    const def = {
      title: "Split face",
      valid: () => st.faces.length > 0 && (!!st.plane || !!st.curves),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const inv = M4(b.m).invert();
        const mod = { id: uid("f"), seq: nextSeq(doc), t: "splitface", faces: st.faces.map((f) => (f.info.n ? { c: f.info.c, t: f.info.t, n: f.info.n } : { c: f.info.c, t: f.info.t })) };
        if (st.plane) mod.plane = planeToLocal(st.plane, b.m);
        else {
          // sketch curves, in body coordinates, pushed along the sketch's normal
          const L = (p) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
          mod.curves = st.curves.map((s) => s.t === "circle" ? { t: "circle", c: L(s.c), r: s.r, n: new THREE.Vector3(...s.n).transformDirection(inv).toArray() } : { t: s.t, a: L(s.a), b: L(s.b), m: s.m && L(s.m), spans: s.spans && s.spans.map((q) => q.map(L)) });
          mod.dir = new THREE.Vector3(...st.curvesDir).transformDirection(inv).toArray();
        }
        b.node.mods = b.node.mods || [];
        b.node.mods.push(mod);
      },
      ok() { commit(def, "Split face"); },
      hint: () => st.pick === "faces" ? "Click the faces to split (one body). Then pick the tool." : st.pick === "curve" ? "Click a sketch line, arc or spline: it is pushed straight through the faces." : "Pick a plane below, a flat face of another body, or switch to a sketch.",
      build(body) {
        body.append(row("Faces", pickbox(st.pick === "faces", st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : "Click faces", st.faces.length ? () => { st.faces = []; st.body = null; refresh(); } : null, () => { st.pick = "faces"; def.render(); }), "sf-faces"));
        body.append(row("Tool", seg([["plane", "Plane / face"], ["curve", "Sketch curve"]], st.pick === "curve" || st.curves ? "curve" : "plane", (v) => { st.pick = v === "curve" ? "curve" : "tool"; if (v === "curve") { st.plane = null; st.planeName = ""; } else { st.curves = null; } def.render(); draw(); }, "sf-kind")));
        if (st.pick === "curve" || st.curves) body.append(row("Sketch curve", pickbox(st.pick === "curve", st.curves ? el("span", {}, el("b", {}, st.curvesRef.ents.length), " curve(s)") : "Click a sketch curve", st.curves ? () => { st.curves = null; st.pick = "curve"; refresh(); } : null, () => { st.pick = "curve"; def.render(); }), "sf-curve"));
        else {
          body.append(row("Plane", pickbox(st.pick === "tool", st.planeName ? el("span", {}, el("b", {}, st.planeName)) : "Click a plane or face", null, () => { st.pick = "tool"; def.render(); }), "sf-plane"));
          planePickerRows(body, st, refresh);
        }
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The faces are divided where the tool crosses them; the body's shape stays the same. Use it to offset, extrude or color part of a face."));
      },
      start() { showPlaneGizmo(true); refresh(); },
      cleanup() { showPlaneGizmo(false); },
      handler: {
        hover(e) {
          if (st.pick === "curve") { const h = pickSketchCurve(e); st.hoverCurve = h ? pathPts(h) : null; vp.canvas.style.cursor = h ? "pointer" : "default"; draw(); return; }
          const { g, f } = pickPlaneOrFace(e);
          hotGizmo(st.pick === "tool" ? g && g.object : null);
          st.hover = f && f.info ? f : null;
          draw();
        },
        down(e) {
          if (st.pick === "curve") {
            const h = pickSketchCurve(e);
            if (h) {
              const sk = findSketch(store.view, h.sketch);
              const ents = pathChain(resolveSketch(sk), h.curve.id);
              const M = sk.plane, y = [M.n[1] * M.x[2] - M.n[2] * M.x[1], M.n[2] * M.x[0] - M.n[0] * M.x[2], M.n[0] * M.x[1] - M.n[1] * M.x[0]];
              const W = (p) => [0, 1, 2].map((i) => M.o[i] + M.x[i] * p[0] + y[i] * p[1]);
              st.curves = orderPath(resolveSketch(sk), ents).map((x) => x.t === "circle" ? { t: "circle", c: W(x.c), r: x.r, n: M.n } : { t: x.t, a: W(x.a), b: W(x.b), m: x.m && W(x.m), spans: x.spans && x.spans.map((q) => q.map(W)) });
              st.curvesDir = M.n.slice(); st.curvesRef = { sketch: h.sketch, ents };
              st.pick = st.faces.length ? null : "faces"; st.hoverCurve = null; refresh();
            }
            return true;
          }
          const { g, f, cp } = pickPlaneOrFace(e);
          if (st.pick === "faces" || !st.pick) {
            if (!f || !f.info) return true;
            if (st.body && f.body !== st.body) { app.toast("Split faces of one body at a time."); return true; }
            st.body = f.body;
            const i = st.faces.findIndex((x) => x.face === f.face);
            if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ base: f.base, face: f.face, info: f.info });
            if (!st.faces.length) st.body = null;
            refresh(); return true;
          }
          if (cp && !f) { st.plane = { o: cp.plane.o.slice(), n: cp.plane.n.slice() }; st.planeName = cp.name; refresh(); return true; }
          if (g && !f) { const p = ORIGIN_PLANES[g.object.userData.plane]; st.plane = { o: p.o.slice(), n: p.n.slice() }; st.planeName = g.object.userData.plane; refresh(); return true; }
          if (f && f.info && f.info.t === "PLANE") { const pl = planeFromFace(f); st.plane = { o: new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m).toArray(), n: pl.n }; st.planeName = "Face plane"; st.pick = "faces"; refresh(); }
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8, 0.3);
      if (st.hover && (st.pick === "faces" || (st.pick === "tool" && st.hover.info.t === "PLANE"))) drawFace(st.hover.base, st.hover.face, 0xe8a317, 0.3);
      drawToolPlane(st, st.body ? [st.body] : []);
      if (st.curves) { for (const pl of pathPtsFromSegs(st.curves)) drawLine(pl, 0xd9534f); }
      for (const pl of st.hoverCurve || []) drawLine(pl, 0xe8a317);
    }
    function pathPtsFromSegs(segs) { return segs.map((x) => x.t === "circle" ? [] : [new THREE.Vector3(...x.a), ...(x.m ? [new THREE.Vector3(...x.m)] : []), new THREE.Vector3(...x.b)]); }
    function refresh(rerender = true) {
      if (rerender) def.render();
      draw();
      schedulePreview(def);
    }
    st.pick = "faces";
    openCmd(def);
  }

  // ------------------------------------------------------------------ FlexiGen (one object, worked on as a copy)
  function flexiGenCmd() {
    const ok = (id) => { const b = findBody(store.doc, id); return b && !b.hole && !b.hidden && scene.views.get(id)?.data; };
    const sel = app.sel.filter(ok);
    if (sel.length === 1) { app.flexigen.open(sel[0]); return; }
    let hover = null;
    const def = {
      title: "FlexiGen",
      okLabel: "Cancel",
      hint: () => "Click the one object to turn into a flexi model.",
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, sel.length > 1 ? "FlexiGen works on one object at a time. Click the one you want." : "Click the object to turn into a print-in-place flexi model."));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "FlexiGen works on a copy: your design, the 3D Print Sim and the simulations keep the original object."));
      },
      ok() { closeCmd(false); },
      cleanup() { scene.setHovered(null); },
      handler: {
        hover(e) { const f = pickBaseFace(e, (b) => !b.hole); const id = f ? f.body : null; if (id !== hover) { hover = id; scene.setHovered(id); } vp.canvas.style.cursor = id ? "pointer" : "default"; },
        down(e) { const f = pickBaseFace(e, (b) => !b.hole); if (f && ok(f.body)) { closeCmd(false); app.select([f.body]); app.flexigen.open(f.body); } return true; },
      },
    };
    openCmd(def);
  }
  // ------------------------------------------------------------------ Render (photo-style picture)
  const renderPrefs = { quality: "medium", shape: "view", lightType: "studio", lightColor: "neutral", customColor: "#ffe2b8", azimuth: -50, elevation: 45, intensity: 1, softness: 1, background: "studio", floor: true, bgImage: null, bgName: "" };
  function renderItems() {
    const items = [];
    const useAp = scene.state.appearance !== false;
    for (const b of store.doc.bodies) {
      if (b.hole || b.hidden) continue;
      const v = scene.views.get(b.id);
      if (!v || !v.mesh || !v.group.visible) continue;
      v.mesh.updateMatrixWorld(true);
      const ap = useAp ? b.appearance : null;
      const materials = [{ look: ap && ap.body ? ap.body : null, color: b.color }];
      let groups = null;
      if (useAp && v.faceMat && v.mats && v.mats.length > 3) {
        for (let i = 3; i < v.mats.length; i++) materials.push({ look: v.mats[i].userData.look, color: b.color });
        groups = v.mesh.geometry.groups.map((g, i) => { const m = v.faceMat.get(i); return m ? m - 2 : 0; });
      }
      items.push({ geometry: v.mesh.geometry, matrix: v.mesh.matrixWorld.clone(), materials, groups });
    }
    return items;
  }
  function renderSize(q) {
    const w = QUALITY[q].width;
    const shape = renderPrefs.shape;
    const a = shape === "16:9" ? 16 / 9 : shape === "4:3" ? 4 / 3 : shape === "1:1" ? 1 : vp.w / Math.max(1, vp.h);
    return [w, Math.round(w / a)];
  }
  function renderJob(over = {}) {
    const P = renderPrefs;
    const [W, H] = renderSize(P.quality);
    return { items: renderItems(), camera: vp.camera, width: W, height: H, samples: QUALITY[P.quality].samples, lightType: P.lightType, lightColor: P.lightColor, customColor: P.customColor,
      azimuth: P.azimuth, elevation: P.elevation, intensity: P.intensity, softness: P.softness, background: P.background, bgImage: P.bgImage, floor: P.floor, ...over };
  }
  function renderCmd() {
    const P = renderPrefs;
    let preview = null, pvTimer = 0;
    const pvCanvas = el("canvas", { class: "rd-preview", id: "rd-preview", width: 360, height: 220 });
    function updatePreview() {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(() => {
        if (preview) preview.cancel();
        const [W, H] = renderSize(P.quality);
        const pw = 360, ph = Math.round(pw * H / W);
        const items = renderItems();
        if (!items.length) return;
        const job = renderJob({ width: pw, height: ph, samples: 14, items, onProgress: (n, t, cv) => draw(cv) });
        const draw = (cv) => { if (!pvCanvas.isConnected) return; pvCanvas.width = pw; pvCanvas.height = ph; const g = pvCanvas.getContext("2d"); g.clearRect(0, 0, pw, ph); g.drawImage(cv, 0, 0, pw, ph); };
        const r = (preview = renderImage(job));
        r.promise.then(() => { if (preview === r) preview = null; }).catch(() => {});
      }, 250);
    }
    const def = {
      title: "Render",
      wide: true,
      okLabel: "Render",
      valid: () => renderItems().length > 0,
      canOk: () => renderItems().length > 0,
      apply() {},
      ok() { startRender(); },
      hint: () => "Orbit, pan and zoom the view to frame the shot. The picture uses what the view shows.",
      build(body) {
        body.append(pvCanvas);
        body.append(el("div", { class: "hint", style: { padding: "0 0 6px" } }, "Quick preview (low quality). Frame the shot in the view, then press Render."));
        body.append(el("div", { class: "subhead" }, "Quality"));
        body.append(seg(Object.entries(QUALITY).map(([k, q]) => [k, q.label]), P.quality, (v) => { P.quality = v; def.render(); updatePreview(); }, "rd-quality"));
        const [W, H] = renderSize(P.quality);
        body.append(el("div", { class: "hint", style: { padding: "4px 0 0" } }, `${W} × ${H} pixels, ${QUALITY[P.quality].samples} passes: usually ${QUALITY[P.quality].note}.`));
        body.append(row("Picture shape", seg([["view", "View"], ["16:9", "16:9"], ["4:3", "4:3"], ["1:1", "Square"]], P.shape, (v) => { P.shape = v; def.render(); updatePreview(); }, "rd-shape")));
        body.append(el("div", { class: "subhead" }, "Lighting"));
        const lt = el("select", { class: "num", id: "rd-light" }, ...Object.entries(LIGHT_TYPES).map(([k, t]) => el("option", { value: k, selected: k === P.lightType }, t.label)));
        lt.onchange = () => { P.lightType = lt.value; updatePreview(); };
        body.append(row("Light type", lt, "rd-light"));
        const colors = [...Object.entries(LIGHT_COLORS).map(([k, c]) => [k, c.label]), ["custom", "Custom"]];
        const lc = el("div", { class: "rd-colors", id: "rd-color" }, ...colors.map(([k, label]) => el("button", { class: "rd-chip", "aria-pressed": P.lightColor === k, title: label, onclick: () => { P.lightColor = k; def.render(); updatePreview(); } },
          el("i", { style: { background: k === "custom" ? P.customColor : LIGHT_COLORS[k].color } }), label)));
        body.append(row("Light color", lc, "rd-color"));
        if (P.lightColor === "custom") {
          const ci = el("input", { type: "color", id: "rd-custom", value: P.customColor });
          ci.addEventListener("input", () => { P.customColor = ci.value; updatePreview(); });
          body.append(row("Custom color", ci, "rd-custom"));
        }
        const live = (k) => (v) => { P[k] = v; updatePreview(); };
        body.append(sliderRow("Direction", "rd-az", P.azimuth, -180, 180, 5, "°", live("azimuth")));
        body.append(el("div", { class: "hint", style: { padding: 0, marginTop: "-4px" } }, "Direction: 0° lights from behind you, −90° from the left, +90° from the right, 180° from behind the model."));
        body.append(sliderRow("Height", "rd-el", P.elevation, 3, 88, 1, "°", live("elevation")));
        body.append(sliderRow("Brightness", "rd-int", P.intensity, 0.2, 2.5, 0.05, "×", live("intensity")));
        body.append(sliderRow("Softness", "rd-soft", P.softness, 0, 3, 0.05, "×", live("softness")));
        body.append(el("div", { class: "subhead" }, "Background"));
        const bg = el("select", { class: "num", id: "rd-bg" }, ...Object.entries(BACKGROUNDS).map(([k, b]) => el("option", { value: k, selected: k === P.background }, b.label)));
        bg.onchange = () => { P.background = bg.value; def.render(); if (P.background === "image" && !P.bgImage) pickBg(); else updatePreview(); };
        body.append(row("Background", bg, "rd-bg"));
        if (P.background === "image") body.append(row("Picture", el("button", { class: "btn", id: "rd-bgpick", onclick: pickBg }, P.bgImage ? "Change: " + P.bgName : "Choose a picture…"), "rd-bgpick"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "rd-floor", checked: P.floor, onchange: (e) => { P.floor = e.target.checked; updatePreview(); } }), "Shadows on the floor"));
        body.append(el("div", { class: "rd-warn", id: "rd-warn" }, "Rendering can take several minutes, especially at High and Ultra high. Keep this tab open while it works; you can cancel any time."));
      },
      start() { def.render(); updatePreview(); },
      cleanup() { clearTimeout(pvTimer); if (preview) preview.cancel(); vp.onViewChange = null; },
      handler: {},
    };
    function pickBg() {
      const inp = el("input", { type: "file", accept: "image/*" });
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => { P.bgImage = img; P.bgName = f.name.slice(0, 28); P.background = "image"; def.render(); updatePreview(); };
        img.onerror = () => app.toast("That picture couldn't be opened.", "err");
        img.src = URL.createObjectURL(f);
      };
      inp.click();
    }
    // the preview follows the view as you orbit
    vp.onViewChange = () => updatePreview();
    openCmd(def);
  }
  function startRender() {
    const items = renderItems();
    if (!items.length) { app.toast("There's nothing to render yet."); return; }
    const job = renderJob({ items });
    const back = el("div", { class: "modal-back" });
    const view = el("canvas", { class: "rd-out", id: "rd-out" });
    const bar = el("i", {});
    const info = el("div", { class: "rd-info", id: "rd-info" }, "Starting…");
    const cancelBtn = el("button", { class: "btn", id: "rd-cancel" }, "Cancel");
    const saveBtn = el("button", { class: "btn primary", id: "rd-save", hidden: true }, "Save PNG");
    const modal = el("div", { class: "modal render", role: "dialog", "aria-label": "Rendering" },
      el("header", {}, el("h2", {}, "Rendering"), el("span", { class: "rd-size" }, `${job.width} × ${job.height} · ${QUALITY[renderPrefs.quality].label}`)),
      el("div", { class: "mbody" }, el("div", { class: "rd-frame" }, view), el("div", { class: "rd-bar" }, bar), info,
        el("div", { class: "rd-btns" }, cancelBtn, saveBtn)));
    back.append(modal);
    document.body.append(back);
    const fmtT = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    const fit = () => { const mw = Math.min(innerWidth * 0.86, 1100), mh = innerHeight * 0.62; const k = Math.min(mw / job.width, mh / job.height); view.style.width = Math.round(job.width * k) + "px"; view.style.height = Math.round(job.height * k) + "px"; };
    view.width = Math.min(job.width, 1400); view.height = Math.round(view.width * job.height / job.width);
    fit();
    job.onProgress = (n, total, cv, ms) => {
      const g = view.getContext("2d"); g.clearRect(0, 0, view.width, view.height); g.drawImage(cv, 0, 0, view.width, view.height);
      bar.style.width = (100 * n / total).toFixed(1) + "%";
      const left = n ? (ms / n) * (total - n) : 0;
      info.textContent = n < total ? `Pass ${n} of ${total} · ${fmtT(ms)} so far · about ${fmtT(left)} left` : `Done in ${fmtT(ms)}`;
    };
    const r = renderImage(job);
    let done = null;
    cancelBtn.onclick = () => { if (done) { back.remove(); return; } r.cancel(); back.remove(); app.toast("Render cancelled"); };
    r.promise.then((res) => {
      done = res;
      cancelBtn.textContent = "Close";
      saveBtn.hidden = false;
      const name = (store.doc.name || "render").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "render";
      saveBtn.onclick = () => app.projects.saveImage(name + "-render.png", res.blob);
      saveBtn.focus();
    }).catch((e) => { if (e && e.message !== "cancelled") { info.textContent = "The render stopped: " + (e.message || e) + ". Try a lower quality."; cancelBtn.textContent = "Close"; done = true; } });
  }
  // ------------------------------------------------------------------ Appearance (display only)
  function appearanceCmd() {
    const st = { target: "body", bodies: [], faces: [], mat: "paint", color: "#2f6fd6", remove: false };
    for (const id of app.sel) if (!app.isLocked(id)) { const b = findBody(store.doc, id); if (b && !b.hole) st.bodies.push(id); }
    let hover = null;
    const faceRef = (info) => (info.n ? { c: info.c, t: info.t, n: info.n } : { c: info.c, t: info.t });
    const sameFace = (a, b) => a.t === b.t && Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]) < 1e-6;
    const count = () => (st.target === "body" ? st.bodies.length : st.faces.length);
    const def = {
      title: "Appearance",
      wide: true,
      valid: () => count() > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const look = { mat: st.mat, color: st.color };
        const tidy = (b) => { const a = b.appearance; if (a && !a.body && !(a.faces && a.faces.length)) delete b.appearance; };
        if (st.target === "body") {
          for (const id of st.bodies) {
            const b = findBody(doc, id);
            if (!b) continue;
            if (st.remove) { delete b.appearance; continue; }
            b.appearance = { ...(b.appearance || {}), body: look };
          }
        } else {
          for (const f of st.faces) {
            const b = findBody(doc, f.body);
            if (!b) continue;
            const ref = faceRef(f.info);
            const a = (b.appearance = { ...(b.appearance || {}) });
            a.faces = (a.faces || []).filter((x) => !sameFace(x, ref));
            if (!st.remove) a.faces.push({ ...ref, ...look });
            tidy(b);
          }
        }
      },
      ok() { commit(def, st.remove ? "Remove appearance" : "Appearance"); },
      hint: () => st.target === "body" ? "Click bodies to color them (click again to remove from the list)." : "Click faces to color them (click again to remove from the list).",
      build(body) {
        body.append(row("Apply to", seg([["body", "Bodies"], ["face", "Faces"]], st.target, (v) => { st.target = v; refresh(); }, "ap-target")));
        const n = count(), what = st.target === "body" ? "bod" + (n === 1 ? "y" : "ies") : "face" + (n === 1 ? "" : "s");
        body.append(pickbox(true, n ? el("span", {}, el("b", {}, n), " " + what) : st.target === "body" ? "Click bodies" : "Click faces", n ? () => { st.bodies = []; st.faces = []; refresh(); } : null));
        const m = matByKey(st.mat);
        body.append(row("Mode", seg([[false, "Apply"], [true, "Remove"]], st.remove, (v) => { st.remove = v; refresh(); }, "ap-mode")));
        if (!st.remove) {
          const lib = el("div", { class: "ap-lib", id: "ap-lib" });
          let grp = null;
          for (const it of MATERIALS) {
            if (it.group !== grp) { grp = it.group; lib.append(el("div", { class: "ap-group" }, grp)); }
            lib.append(el("button", { class: "ap-item", id: "ap-" + it.key, title: it.name, "aria-pressed": st.mat === it.key, onclick: () => { st.mat = it.key; if (!it.tint) st.color = it.color; else if (st.colorFor !== it.key && !st.userColor) st.color = it.color; st.colorFor = it.key; refresh(); } },
              el("span", { class: "ap-ball", style: { background: swatchCSS({ mat: it.key, color: it.tint ? (st.mat === it.key ? st.color : it.color) : it.color }) } }), el("span", { class: "ap-name" }, it.name)));
          }
          body.append(lib);
          const col = el("input", { type: "color", id: "ap-color", value: m.tint ? st.color : m.color, disabled: !m.tint, "aria-label": "Color" });
          col.addEventListener("input", () => { st.color = col.value; st.userColor = true; const ball = document.querySelector("#ap-" + st.mat + " .ap-ball"); if (ball) ball.style.background = swatchCSS({ mat: st.mat, color: st.color }); schedulePreview(def); });
          body.append(row("Color", el("div", { class: "ap-colorrow" }, col, el("span", { class: "hint", style: { padding: 0 } }, m.tint ? "Pick any color" : m.name + " has its own color")), "ap-color"));
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ap-show", checked: app.scene.state.appearance !== false, onchange: (e) => app.setAppearances(e.target.checked) }), "Show appearances"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Appearances only change how parts look on screen. Shapes and exports stay the same. Turn them off any time with the paint button by the view controls."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          hover = f && f.info ? f : null;
          if (hover && st.target === "body") scene.setHovered(hover.body); else scene.setHovered(null);
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
          if (!f || !f.info) return true;
          if (st.target === "body") {
            const i = st.bodies.indexOf(f.body);
            if (i >= 0) st.bodies.splice(i, 1); else st.bodies.push(f.body);
          } else {
            const i = st.faces.findIndex((x) => x.body === f.body && x.face === f.face);
            if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ body: f.body, base: f.base, face: f.face, info: f.info });
          }
          refresh();
          return true;
        },
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
    };
    function draw() {
      clearOv();
      if (st.target === "face") {
        for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8, 0.12);
        if (hover && !st.faces.some((f) => f.face === hover.face && f.body === hover.body)) drawFace(hover.base, hover.face, 0xe8a317, 0.35);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      scene.setSelected(st.target === "body" ? st.bodies : []);
      draw();
      schedulePreview(def);
    }
    openCmd(def);
  }
  // a labelled slider with a typed value next to it
  function sliderRow(label, id, value, min, max, step, unit, onChange) {
    const clampV = (v) => Math.min(max, Math.max(min, v));
    const range = el("input", { type: "range", class: "slider", id: id + "-range", min, max, step, value: clampV(value), "aria-label": label });
    const num = app.numField({ value, id, min, step, onCommit: (v) => { range.value = clampV(v); onChange(v); } });
    range.addEventListener("input", () => { const v = +range.value; num.setValue(v); onChange(v); });
    range.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && range.closest("#cmd")) app.submitCommand(); });
    return el("div", { class: "row sliderrow" }, el("label", { for: id }, label), el("div", { class: "slidebox" }, range, num, el("span", { class: "unit" }, unit)));
  }
  // texture thumbnails are drawn a few at a time so the panel opens instantly
  const thumbQueue = [];
  let thumbBusy = false;
  function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    const step = () => {
      const t0 = performance.now();
      while (thumbQueue.length && performance.now() - t0 < 30) {
        const [img, key] = thumbQueue.shift();
        if (img.isConnected) img.src = textureThumb(key, 88);
      }
      if (thumbQueue.length) setTimeout(step, 0); else thumbBusy = false;
    };
    setTimeout(step, 0);
  }

  // ------------------------------------------------------------------ Shell
  // ------------------------------------------------------------------ Offset face (Press Pull)
  function offsetCmd(editing = null) {
    const st = { faces: [], d: 2, body: null };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      st.d = m.d; st.body = b.id; st.keepFaces = m.faces;
    }
    let hover = null, arrowDrag = null;
    const def = {
      title: (editing ? "Edit " : "") + "Offset face",
      valid: () => (editing || st.faces.length > 0) && Math.abs(st.d) > 1e-6,
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const faces = st.faces.length ? st.faces.map((f) => (f.n ? { c: f.c, n: f.n, t: f.t } : { c: f.c, t: f.t })) : st.keepFaces;
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); m.d = st.d; m.faces = faces; return; }
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "offset", d: st.d, faces });
      },
      ok() { commit(def, "Offset face"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.faces.length ? "Drag the arrow or type a distance: positive pushes the face out, negative pulls it in." : "Click one or more faces of a body: flat, holes, cylinders or rounded faces.",
      build(body) {
        body.append(pickbox(true, st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""}`) : editing ? "Keeps the original faces" : "Select faces", st.faces.length ? () => { st.faces = []; if (!editing) st.body = null; refresh(); } : null));
        body.append(row("Distance", (def.distInput = app.numField({ value: st.d, id: "of-d", step: 0.5, live: true, onCommit: (v) => { st.d = v; refresh(false); } })), "of-d"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Positive adds material, negative removes it. On a hole, positive makes the hole smaller."));
      },
      start() { refresh(); },
      handler: {
        wantsTouch: (e) => !!overArrow(e),
        hover(e) {
          if (arrowDrag) return;
          if (overArrow(e)) { vp.canvas.style.cursor = "grab"; return; }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          hover = f && f.info ? f : null;
          draw();
          vp.canvas.style.cursor = hover ? "pointer" : "default";
        },
        down(e) {
          const a = overArrow(e);
          if (a) { arrowDrag = { a, d0: st.d, f: axisDragger(e, a.origin, a.n) }; return true; }
          // a sketch profile drawn on the face (say a circle on a cylinder's top): pull just
          // that profile, like Fusion's Press Pull, instead of the whole face
          if (!editing && !st.faces.length) {
            const rh = vp.pick(e, scene.regionMeshes());
            const fh = pickBaseFace(e, (b) => !b.hole);
            if (rh.length && (!fh || rh[0].distance <= fh.distance + 0.05)) {
              const r = rh.sort((p, q) => p.distance - q.distance || p.object.userData.region.region.area - q.object.userData.region.region.area)[0].object.userData.region;
              closeCmd(false);
              extrudeCmd("extrude", null, { region: r, dist: st.d });
              return true;
            }
          }
          const f = pickBaseFace(e, (b) => !b.hole && !b.locked && (!st.body || b.id === st.body));
          if (!f) return true;
          if (!f.info || !f.info.c) { app.toast("That face can't be offset."); return true; }
          st.body = f.body;
          const i = st.faces.findIndex((x) => x.face === f.face);
          // the arrow starts where you clicked, along the surface normal there
          if (i >= 0) st.faces.splice(i, 1);
          else st.faces.push({ face: f.face, base: f.base, c: f.info.c, n: f.info.t === "PLANE" ? f.info.n : null, t: f.info.t, at: f.point.clone(), dir: f.normal.clone().normalize() });
          if (!st.faces.length && !editing) st.body = null;
          refresh();
          return true;
        },
        move(e) {
          if (!arrowDrag) return;
          const s = arrowDrag.d0 + arrowDrag.f(e);
          const g = app.gridStep() || 0.1;
          st.d = round(s, g >= 1 ? 0.5 : g) || st.d;
          def.distInput && def.distInput.setValue(st.d);
          refresh(false);
        },
        up() { arrowDrag = null; },
      },
    };
    function pickExtrudeFace(e, tell) {
      const f = pickBaseFace(e, (b) => !b.hole && !b.locked);
      if (!f) return null;
      if (!f.info || f.info.t !== "PLANE") { if (tell) app.toast("Only flat faces can be extruded directly. Sketch on a plane to extrude other shapes."); return null; }
      return f;
    }
    // click a flat face: make a sketch of its outline and pick the region under the click
    function faceProfile(f, e) {
      const plane = planeFromFace(f);
      const sk = { id: uid("s"), name: "Sketch", seq: 0, plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], hidden: false, onBody: f.body, fromFace: true };
      projectFaceEdges(sk, f);
      const regs = regionsFor(sk);
      const q = f.point.clone().applyMatrix4(planeMatrix(sk.plane).invert());
      const pt = [q.x, q.y];
      let best = -1, area = Infinity;
      regs.forEach((r, i) => { if (!r.text && pointIn(r, pt)) { const a = Math.abs(polyArea(r.poly)); if (a < area) { area = a; best = i; } } });
      if (best < 0) { app.toast("Couldn't find the outline of that face."); return; }
      pendingSketch = sk;
      st.profiles.clear(); st.axis = null; st.axisLine = null;
      st.sketchId = sk.id;
      st.profiles.set(profileKey(sk.id, best), { index: best, ref: { key: regs[best].key, pt: regs[best].pt } });
      scene.state.forceSketch = sk.id;
      st.hoverFace = null;
      refresh();
    }
    function overArrow(e) {
      const a = def.arrow;
      if (!a) return null;
      const [mx, my] = vp.local(e);
      const s = vp.project(a.tip);
      return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(14) ? a : null;
    }
    function draw() {
      clearOv();
      def.arrow = null;
      for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
      if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      const f0 = st.faces[0];
      if (f0) {
        const origin = f0.at ? f0.at.clone() : new THREE.Vector3(...f0.c).applyMatrix4(f0.base.m);
        const n = f0.dir ? f0.dir.clone() : new THREE.Vector3(...f0.n).transformDirection(f0.base.m).normalize();
        const tip = origin.clone().addScaledVector(n, st.d);
        drawLine([origin, tip], 0x1f4fa8);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 16), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true }));
        cone.scale.setScalar(vp.pixelSize(tip) * 6);
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().multiplyScalar(Math.sign(st.d) || 1));
        cone.renderOrder = 14;
        ov.add(cone);
        def.arrow = { origin, n, tip };
      }
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    openCmd(def);
  }

  // Shell, like Fusion 360: pick faces to remove (or none, for a closed hollow body), a
  // wall thickness, and whether the wall grows inside, outside or both ways.
  function shellCmd(editing = null) {
    const st = { faces: [], th: 2, body: null, dir: "in", chain: false, closed: false };
    if (editing) {
      const b = findBody(store.doc, editing.body);
      const m = b.node.mods.find((x) => x.id === editing.mod);
      Object.assign(st, { th: m.th, body: b.id, keepFaces: m.faces, dir: m.dir || "in", chain: !!m.chain, closed: !(m.faces || []).length }, exprsOf(m, ["th"])); // jumpstart-3d: parameters
    }
    let hover = null;
    const pickable = (b) => !b.hole && !b.locked && (!st.body || b.id === st.body || (st.closed && !editing));
    const def = {
      title: (editing ? "Edit " : "") + "Shell",
      valid: () => st.th > 0 && !!st.body && (st.closed || editing || st.faces.length > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const b = findBody(doc, st.body);
        if (!b) return;
        const faces = st.closed ? [] : st.faces.length ? st.faces.map((f) => ({ c: f.c })) : st.keepFaces || [];
        const props = { th: st.th, faces, dir: st.dir === "in" ? undefined : st.dir, chain: st.chain && !st.closed ? true : undefined, ...exprsOf(st, ["th"]) }; // jumpstart-3d: parameters
        if (editing) { const m = b.node.mods.find((x) => x.id === editing.mod); delete m.exprs; delete m.exprUnits; Object.assign(m, props); return; } // jumpstart-3d: parameters
        b.node.mods = b.node.mods || [];
        b.node.mods.push({ id: uid("f"), seq: nextSeq(doc), t: "shell", ...props });
      },
      ok() { commit(def, "Shell"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => st.closed ? "Click the body to hollow out. It stays closed, with a hollow inside." : "Click the faces to remove (openings). The rest of the body becomes a wall.",
      build(body) {
        if (st.closed) body.append(pickbox(true, st.body ? el("b", {}, findBody(store.doc, st.body)?.name || "1 body") : "Select a body", st.body && !editing ? () => { st.body = null; refresh(); } : null));
        else body.append(pickbox(true, st.faces.length ? el("span", {}, el("b", {}, st.faces.length), ` face${st.faces.length > 1 ? "s" : ""} to remove`) : editing && (st.keepFaces || []).length ? "Keeps the original faces" : "Select faces to remove", st.faces.length ? () => { st.faces = []; if (!editing) st.body = null; refresh(); } : null));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sh-closed", checked: st.closed, onchange: (e) => { st.closed = e.target.checked; if (!editing) { st.faces = []; st.body = st.closed ? st.body : null; } refresh(); } }), "No openings (hollow inside)"));
        if (!st.closed) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sh-chain", checked: st.chain, onchange: (e) => { st.chain = e.target.checked; refresh(false); } }), "Tangent chain (take smoothly joined faces too)"));
        body.append(row("Thickness", app.numField({ value: st.th, id: "sh-th", min: 0.01, step: 0.5, live: true, expr: exprOf(st, "th"), onCommit: (v, t) => { st.th = v; setExpr(st, "th", t); refresh(false); } }), "sh-th")); // jumpstart-3d: parameters
        body.append(row("Direction", seg([["in", "Inside"], ["out", "Outside"], ["both", "Both"]], st.dir, (v) => { st.dir = v; refresh(); }, "sh-dir")));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, st.dir === "in" ? "The outside stays the same size; the wall grows inward." : st.dir === "out" ? "The inside keeps the body's shape; the wall grows outward." : "The wall is centered on the surface."));
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, pickable);
          hover = f;
          if (st.closed) scene.setHovered(f ? f.body : null);
          draw();
          vp.canvas.style.cursor = f ? "pointer" : "default";
        },
        leave() { hover = null; scene.setHovered(null); draw(); },
        down(e) {
          const f = pickBaseFace(e, pickable);
          if (!f) return true;
          if (st.closed) { if (!editing) st.body = f.body; refresh(); return true; }
          st.body = f.body;
          const i = st.faces.findIndex((x) => x.face === f.face);
          const c = f.info && f.info.c ? f.info.c : f.point.clone().applyMatrix4(f.base.m.clone().invert()).toArray();
          if (i >= 0) st.faces.splice(i, 1); else st.faces.push({ face: f.face, base: f.base, c });
          if (!st.faces.length && !editing) st.body = null;
          refresh();
          return true;
        },
      },
      cleanup() { scene.setHovered(null); scene.setSelected(app.sel); },
      sceneSel: () => (st.closed && st.body ? [st.body] : app.sel),
    };
    function draw() {
      clearOv();
      if (!st.closed) {
        for (const f of st.faces) drawFace(f.base, f.face, 0x2f66c8);
        if (hover) drawFace(hover.base, hover.face, 0xe8a317);
      }
    }
    function refresh(rerender = true) {
      if (rerender) def.render();
      draw();
      scene.setSelected(st.closed && st.body ? [st.body] : []);
      schedulePreview(def);
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Combine
  // Combine, like Fusion 360: pick a target body, then tool bodies; join, cut or intersect.
  // The result stays the target body (same name and history) with a Combine feature on the
  // timeline. Used-up tool bodies are kept inside the feature, so deleting it brings them back.
  function combineCmd(editing = null) {
    const st = { target: null, tools: [], op: "join", keep: false };
    let picking = "target";
    if (editing) {
      const b = findBody(store.doc, editing.body), m = b && b.node.mods.find((x) => x.id === editing.mod);
      if (!m) return;
      Object.assign(st, { target: b.id, op: m.op || "join", keep: !m.tools });
      picking = null;
    } else {
      // bodies selected before starting: the first is the target, the rest are tools
      const pre = app.sel.filter((id) => !app.isLocked(id) && findBody(store.doc, id));
      if (pre.length) { st.target = pre[0]; st.tools = pre.slice(1); picking = "tools"; }
    }
    const name = (id) => findBody(store.doc, id)?.name || "body";
    const def = {
      title: editing ? "Edit Combine" : "Combine",
      keepSelection: false,
      valid: () => !!st.target && (editing || st.tools.length > 0),
      canOk: () => def.valid(),
      apply(doc) {
        const tb = findBody(doc, st.target);
        if (editing) {
          const m = tb.node.mods.find((x) => x.id === editing.mod);
          m.op = st.op === "join" ? undefined : st.op;
          return;
        }
        const tools = st.tools.map((id) => findBody(doc, id)).filter(Boolean);
        tb.node.mods = tb.node.mods || [];
        tb.node.mods.push({
          id: uid("f"), seq: nextSeq(doc), t: "bool", src: "combine", op: st.op === "join" ? undefined : st.op,
          tool: { t: "group", children: tools.map((b) => ({ node: clone(b.node), m: b.m.slice(), hole: false, name: b.name })), mods: [] },
          m: arr(M4(tb.m).invert()),
          tools: st.keep ? undefined : tools.map((b) => clone(b)),
        });
        // (the preview leaves the tools in place, faint, so they can still be clicked)
        if (!st.keep && !app.previewing) { const gone = new Set(st.tools); doc.bodies = doc.bodies.filter((b) => !gone.has(b.id)); }
      },
      async ok() {
        if (!def.valid()) return;
        const t = st.target;
        // jumpstart-3d: stop queued dialog previews before staging the atomic result.
        closeCmd(false);
        try {
          const ids = await commitCombine(app, doc => { def.apply(doc); return t; }, "Combine", { target: t, op: st.op });
          if (ids.length) app.select(ids);
        } catch (err) { app.toast(err.message, "err"); }
      },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => editing ? "Change the operation, then OK." : picking === "target" ? "Select the target body: the one that stays." : "Select tool bodies: click them, drag a window, or Ctrl+click in the Browser. Click one again to drop it.",
      build(body) {
        const box = (which, label, content, onClear) => row(label, pickbox(picking === which, content, onClear, editing ? null : () => { picking = which; refresh(); }));
        body.append(box("target", "Target body", st.target ? el("span", {}, el("i", { class: "sw", style: { background: "#2f6fe8" } }), el("b", {}, name(st.target))) : "Select", !editing && st.target ? () => { st.target = null; picking = "target"; refresh(); } : null));
        if (!editing) body.append(box("tools", "Tool bodies", st.tools.length ? el("span", {}, el("i", { class: "sw", style: { background: "#f08a24" } }), el("b", {}, st.tools.length), " selected") : "Select", st.tools.length ? () => { st.tools = []; refresh(); } : null));
        if (!editing && st.tools.length) body.append(el("div", { class: "hint cb-names", style: { padding: "0 0 4px" } }, st.tools.map(name).join(", ")));
        body.append(row("Operation", seg([["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]], st.op, (v) => { st.op = v; refresh(); }, "cb-op")));
        if (!editing) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "cb-keep", checked: st.keep, onchange: (e) => { st.keep = e.target.checked; refresh(); } }), "Keep tools"));
      },
      start() { refresh(); },
      cleanup() { scene.setSelected([]); scene.setToolBodies([]); scene.state.ghost = new Set(); scene.refresh(); },
      // a body clicked in the Browser while Combine is open
      pickBody(id) { pick(id); },
      sceneSel: () => (st.target ? [st.target] : []),
      handler: {
        hover(e) { scene.setHovered(editing ? null : under(e)); },
        leave() { scene.setHovered(null); },
        down(e) { press = { start: vp.local(e), id: editing ? null : under(e) }; return true; },
        move(e) {
          if (rubber) { app.beginner.handler.move(e); return; }
          if (!press || editing) return;
          const [x, y] = vp.local(e);
          if (Math.hypot(x - press.start[0], y - press.start[1]) < 5) return;
          // a selection window adds every body it catches
          app.beginner.rubberDown(e, true, press.start, [], (ids) => {
            for (const id of ids) {
              if (app.isLocked(id) || id === st.target) continue;
              if (picking === "target" || !st.target) { st.target = id; picking = "tools"; continue; }
              if (!st.tools.includes(id)) st.tools.push(id);
            }
            picking = st.target ? "tools" : "target";
            refresh();
          });
          rubber = true; press = null;
          app.beginner.handler.move(e);
        },
        up(e) {
          if (rubber) { rubber = false; app.beginner.handler.up(e); return; }
          const p = press; press = null;
          if (p && p.id) pick(p.id);
        },
        cancel() { press = null; if (rubber) { rubber = false; app.beginner.handler.cancel(); } },
      },
    };
    let press = null, rubber = false;
    // the body under the pointer; while choosing tools, look past the target so bodies
    // inside or behind it can still be picked
    function under(e) {
      const ids = [];
      for (const h of vp.pick(e, scene.meshes())) { const id = h.object.userData.bodyView.body.id; if (!ids.includes(id)) ids.push(id); }
      if (picking === "tools" && st.target) return ids.find((id) => id !== st.target) || null;
      return ids[0] || null;
    }
    function pick(id) {
      if (editing) return;
      if (app.isLocked(id)) { app.toast("That body is locked."); return; }
      if (picking === "target") {
        st.target = id;
        st.tools = st.tools.filter((t) => t !== id);
        picking = "tools"; // like Fusion, go straight on to the tools
      } else if (id === st.target) return;
      else { const i = st.tools.indexOf(id); if (i >= 0) st.tools.splice(i, 1); else st.tools.push(id); }
      refresh();
    }
    function refresh() {
      def.render();
      scene.setSelected(st.target ? [st.target] : []);
      scene.setToolBodies(st.tools);
      // the live result: tool bodies show through faintly so they can still be clicked
      scene.state.ghost = new Set(def.valid() && !editing ? st.tools : []);
      schedulePreview(def);
      app.status();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Move / Copy
  function moveCmd(opts = {}) {
    // rot: the turn so far (about the selection center), shown as X/Y/Z angles
    const st = { ids: app.sel.filter((id) => !app.isLocked(id)), d: [0, 0, 0], rot: new THREE.Quaternion(), copy: false, drag: opts.drag || "screen", center: new THREE.Vector3() }; // jumpstart-3d: Free in 3D is the default drag (#163)
    if (st.ids.length < app.sel.length) app.toast("Locked bodies stay where they are.");
    // jumpstart-3d: sketch move. Move/Copy takes one sketch or bodies, never both: an extrude would move twice.
    // A sketch moves by changing its plane; the curves stay as drawn and the extrudes made from it follow.
    st.sketch = !st.ids.length && selSketch && findSketch(store.doc, selSketch) ? selSketch : null;
    let shownSketch = null;
    const showSketch = () => { // a hidden sketch is drawn while it is moved and stays hidden afterwards
      if (shownSketch === st.sketch) return;
      shownSketch = scene.state.forceSketch = st.sketch;
      scene.syncSketches(store.view);
    };
    function pickSketch(e) {
      const hit = vp.pick(e, scene.regionMeshes())[0];
      if (hit) return { sketch: hit.object.userData.region.sketch, point: hit.point.clone(), dist: hit.distance };
      const c = pickSketchCurve(e);
      const sk = c && findSketch(store.view, c.sketch);
      const point = sk && vp.rayPlane(e, new THREE.Plane().setFromNormalAndCoplanarPoint(V3(sk.plane.n).normalize(), V3(sk.plane.o)));
      return point ? { sketch: c.sketch, point, dist: vp.camera.position.distanceTo(point) } : null;
    }
    const inputs = [];
    let drag = null, hotArrow = null;
    // jumpstart-3d: pivot. The gizmo (X/Y/Z arrows, rings, a pad for free moves) is shared with the live gizmo (pivot.js); the centre is the pivot dot
    const pv = app.pivot, G = makeGizmo(vp), giz = G.group, rings = G.rings, fb = turnFeedback(vp);
    const sizeGiz = () => {
      if (!st.ids.length && !st.sketch) { giz.visible = false; pv.dot.show(null, "move"); return; }
      giz.visible = true;
      const at = st.center.clone().add(new THREE.Vector3(...st.d));
      G.place(at, st.drag === "screen" ? "all" : "z", hotArrow || (drag && drag.ring));
      if (st.ids.length) pv.dot.show(at, "move"); else pv.dot.show(null, "move"); // a sketch has no pivot of its own
    };
    vp.afterRender.add(sizeGiz);
    const pickGiz = (e) => G.pick(e);
    // the rotation center comes from where the bodies are now (not the preview)
    const recenter = () => {
      const box = new THREE.Box3();
      for (const id of st.ids) { const b = findBody(store.doc, id); const bb = b && scene.boxWithMatrix(id, M4(b.m)); if (bb) box.union(bb); }
      const sr = st.sketch && sketchRef(st.sketch, store.doc); // jumpstart-3d: sketch move
      if (sr) box.expandByPoint(V3(sr.center));
      st.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      // jumpstart-3d: pivot. The pivot decides: the body's own middle (which stays put under a turn), the union box's middle taken when
      // several were selected (not recomputed after each turn), or the point the dot was dragged to
      const pvp = !st.sketch && st.ids.length && pv.base(st.ids);
      if (pvp) st.center = pvp;
    };
    // Move / Copy borrows the pivot: the dot and the Pivot fields show where it is in the preview, and moving it keeps the pose
    // (the move and turn so far are re-expressed about the new point)
    const posed = () => st.center.clone().add(new THREE.Vector3(...st.d));
    const retarget = (p) => {
      const R = new THREE.Matrix4().makeRotationFromQuaternion(st.rot), c0 = st.center.clone();
      const c1 = c0.clone().add(p.clone().sub(c0).sub(new THREE.Vector3(...st.d)).applyMatrix4(R.clone().invert())); // the point that the pose carries to p
      st.center = c1;
      st.d = [p.x - c1.x, p.y - c1.y, p.z - c1.z];
      inputs.forEach((f, i) => f.setValue && f.setValue(st.d[i]));
      pv.setBase(c1);
      changed(false);
    };
    const lent = { get: posed, set: retarget };
    const def = {
      title: "Move / Copy",
      keepSelection: true,
      pivotIds: () => st.ids, // jumpstart-3d: pivot. the Pivot boxes stay on screen while this is open
      valid: () => st.ids.length > 0 || !!st.sketch,
      canOk: () => def.valid() && (st.d.some((v) => v) || Math.abs(st.rot.w) < 1 - 1e-9),
      mat() {
        const c = st.center;
        return new THREE.Matrix4().makeTranslation(...st.d)
          .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(st.rot))
          .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      },
      apply(doc) {
        const T = def.mat();
        st.copyIds = st.copyIds || {};
        const sk = st.sketch && findSketch(doc, st.sketch); // jumpstart-3d: sketch move
        if (sk) {
          let t = sk;
          if (st.copy) {
            t = clone(sk);
            t.id = st.copyIds[sk.id] || (st.copyIds[sk.id] = uid("s"));
            t.seq = nextSeq(doc); t.name = nextSketchName(doc); t.hidden = false;
            delete t.onBody; delete t.fromFace; // a copy must not vanish with the body the original was drawn on
            doc.sketches.push(t);
          }
          t.plane = { o: arr3(V3(sk.plane.o).applyMatrix4(T)), x: arr3(V3(sk.plane.x).transformDirection(T)), n: arr3(V3(sk.plane.n).transformDirection(T)) };
        }
        for (const id of st.ids) {
          const b = findBody(doc, id);
          if (!b) continue;
          if (st.copy) {
            const c = clone(b);
            c.id = st.copyIds[id] || (st.copyIds[id] = uid("b"));
            c.seq = nextSeq(doc); c.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
            c.m = arr(M4(b.m).premultiply(T));
            doc.bodies.push(c);
          } else b.m = arr(M4(b.m).premultiply(T));
        }
      },
      ok() { commit(def, st.copy ? "Copy" : "Move"); },
      hint: () => st.ids.length || st.sketch ? (st.drag === "screen" ? "Drag the shape to move it in 3D, an arrow to move along an axis, or a ring to rotate (15° steps; hold Shift or choose Free for any angle). Arrow keys move it as it looks on screen (Ctrl+↑↓ up and down); , and . turn it " + fine.step + "°. Or type exact values." : "Drag the shape to move it on the ground, an arrow to move along an axis, or the blue ring to turn it. Arrow keys move it as it looks on screen (Ctrl+↑↓ up and down); , and . turn it " + fine.step + "° (Shift: 15°). Choose Free in 3D to rotate around any axis. Ring drags turn in 15° steps (Shift or Free: any angle).") : "Click the shapes or a sketch to move.", // jumpstart-3d: rotation access (15° steps in both hints)
      build(body) {
        body.append(pickbox(true, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` bod${st.ids.length > 1 ? "ies" : "y"}`) : st.sketch ? el("b", {}, findSketch(store.doc, st.sketch).name || "Sketch") : "Click bodies or a sketch", st.ids.length || st.sketch ? () => { st.ids = []; st.sketch = null; changed(); } : null));
        // jumpstart-3d: sketch move. Every sketch, hidden ones too (like the offset plane's list).
        if (store.doc.sketches.length) body.append(row("Sketch", el("select", { class: "num", id: "mv-sketch", onchange: (e) => { st.sketch = e.target.value || null; if (st.sketch) st.ids = []; changed(); } },
          el("option", { value: "" }, "…or pick a sketch"), ...store.doc.sketches.map((k) => el("option", { value: k.id, selected: st.sketch === k.id }, k.name || "Sketch"))), "mv-sketch"));
        body.append(row("Drag shape", seg([["screen", "Free in 3D"], ["ground", "Free on ground"]], st.drag, (v) => { st.drag = v; def.render(); app.status(); }, "mv-drag"))); // jumpstart-3d: Free in 3D first (#163); the hint follows the choice
        body.append(row("Ring turn", snapSwitch())); // jumpstart-3d: rotation access
        body.append(el("div", { class: "subhead" }, "Move by (" + getUnit() + ")"));
        const r3 = el("div", { class: "row3" });
        inputs.length = 0;
        ["X", "Y", "Z"].forEach((l, i) => {
          const f = app.numField({ value: st.d[i], id: "mv-d" + i, step: 1, live: true, onCommit: (v) => { st.d[i] = v; changed(false); } });
          inputs.push(f);
          r3.append(el("label", {}, l, f));
        });
        body.append(r3);
        body.append(el("div", { class: "subhead" }, "Rotate around the selection center (°)"));
        const r3b = el("div", { class: "row3" });
        angInputs.length = 0;
        const ang = eulerDeg();
        ["X", "Y", "Z"].forEach((l, i) => {
          const f = app.numField({ value: ang[i], id: "mv-r" + i, step: 15, live: true, onCommit: (v) => { const cur = eulerDeg(); cur[i] = v; setEuler(cur); ringReadout = null; changed(false); } });
          angInputs.push(f);
          r3b.append(el("label", {}, l, f));
        });
        body.append(r3b);
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "mv-copy", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; changed(false); } }), "Create a copy"));
        body.append(el("button", { class: "btn", id: "mv-reset", onclick: () => { st.d = [0, 0, 0]; st.rot.identity(); changed(); } }, "Reset"));
      },
      start() { recenter(); pv.lend(lent); scene.setSelected(st.ids); showSketch(); vp.request(); }, // jumpstart-3d: pivot
      cleanup(committed) { pv.unlend(committed ? posed() : null); pv.dot.show(null, "move"); fb.dispose(); vp.afterRender.delete(sizeGiz); G.dispose(); tag.remove(); scene.setSelected([]); vp.request(); }, // jumpstart-3d: pivot (a pivot of your own goes with the bodies once Move is accepted)
      handler: {
        wantsTouch: (e) => !!(pv.dot.at(e, "move") || pickGiz(e) || scene.pickFace(e) || pickSketch(e)),
        hover(e) {
          if (drag) return;
          if (pv.dot.at(e, "move")) { vp.canvas.style.cursor = "grab"; scene.setHovered(null); return; } // jumpstart-3d: pivot
          const h = pickGiz(e);
          if (h !== hotArrow) { hotArrow = h; vp.request(); }
          if (h) { vp.canvas.style.cursor = "grab"; scene.setHovered(null); return; }
          const f = scene.pickFace(e);
          scene.setHovered(f ? f.body : null);
          const sh = !f && pickSketch(e); // jumpstart-3d: sketch move
          vp.canvas.style.cursor = f ? (st.ids.includes(f.body) ? "move" : "pointer") : sh ? (sh.sketch === st.sketch ? "move" : "pointer") : "default";
        },
        down(e) {
          const pg = pv.dotDown(e, "move"); // jumpstart-3d: pivot. the dot first: it only moves the pivot
          if (pg) { drag = { ...pg, restore: pg.cancel }; return true; }
          const h = pickGiz(e);
          if (h && h.userData.ring) return startRotate(e, h);
          if (h) return startDrag(e, h.userData.axis, h.userData.dir);
          const f = scene.pickFace(e);
          const sh = pickSketch(e); // jumpstart-3d: sketch move. A body in front of the sketch wins.
          if (sh && (!f || sh.dist < vp.camera.position.distanceTo(f.point))) {
            if (st.sketch !== sh.sketch) { st.sketch = sh.sketch; st.ids = []; changed(); }
            return startDrag(e, st.drag === "screen" ? "free" : "ground", null, sh.point);
          }
          if (!f) return true;
          if (e.shiftKey) {
            st.sketch = null; // jumpstart-3d: sketch move
            const i = st.ids.indexOf(f.body);
            if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
            changed();
            return true;
          }
          if (app.isLocked(f.body)) { app.toast("That body is locked."); return true; }
          st.sketch = null; // jumpstart-3d: sketch move
          if (!st.ids.includes(f.body)) { st.ids.push(f.body); changed(); }
          return startDrag(e, st.drag === "screen" ? "free" : "ground", null, f.point);
        },
        move(e) { if (drag) drag.move(e); },
        // jumpstart-3d: rotation access. A second finger, or a touch the browser took over, drops the gesture: the pose and preview go back to how they were before it
        cancel() {
          if (!drag) return;
          const restore = drag.restore;
          drag = null; ringReadout = null; tag.hidden = true; fb.hide(); app.clearSnapGuides(); vp.canvas.style.cursor = "default";
          if (restore) restore();
          changed();
        },
        up(e) {
          if (e && e.type === "pointercancel") return def.handler.cancel();
          if (!drag) return;
          const tap = vp.touchMode && drag.ring && !drag.moved; // jumpstart-3d: rotation access. a finger on a ring that did not move: the viewport treats it as a tap on what is under it
          if (drag.finish) drag.finish();
          fb.hide(); drag = null; ringReadout = null; tag.hidden = true; app.clearSnapGuides(); vp.canvas.style.cursor = "default"; def.render();
          if (tap) return "tap";
        },
      },
    };
    const angInputs = [];
    let ringReadout = null, keyRing = null;
    // arrow keys move it the way it looks on screen (Ctrl/Cmd + Up/Down: lift); , and . turn it
    def.arrowKey = (e) => {
      if ((!st.ids.length && !st.sketch) || e.altKey) return false;
      const d = app.arrowDelta(e, (app.gridStep() || 1) * (e.shiftKey ? 10 : 1));
      st.d = st.d.map((v, i) => +(v + d.getComponent(i)).toFixed(6));
      inputs.forEach((f, i) => f.setValue && f.setValue(st.d[i]));
      changed(false);
      return true;
    };
    // , and . : turn 1° (Shift: 15°) around the ring last dragged (the blue Z ring at first)
    def.turnKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      return def.turnBy((e.code === "Period" ? 1 : -1) * (e.shiftKey ? 15 : fine.step), keyRing || rings[2]); // jumpstart-3d: fine rotation. the step chosen in the status bar
    };
    // jumpstart-3d: fine rotation. the status bar's − / + too: s degrees around a ring (the blue Z one at first), added to the pending turn
    def.turnBy = (s, ringObj, axisName) => {
      if (!st.ids.length && !st.sketch) return false;
      ringObj = axisName ? rings.find((r) => r.userData.axis === "rot-" + axisName) : ringObj;
      const axis = ringObj.userData.dir.clone();
      st.rot.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (s * Math.PI) / 180));
      const ang = eulerDeg();
      angInputs.forEach((f, i) => f.setValue(ang[i]));
      const sc = vp.project(giz.position);
      tag.hidden = false;
      tag.innerHTML = `<b>${s > 0 ? "+" : ""}${s}°</b><span>around ${ringObj.userData.axis.slice(4).toUpperCase()} · , and . keys</span>`;
      tag.style.transform = `translate(${Math.round(sc[0] + 40)}px, ${Math.round(sc[1] - 40)}px)`;
      clearTimeout(def.turnKey.t); def.turnKey.t = setTimeout(() => { if (!drag) tag.hidden = true; }, 1400);
      changed(false);
      return true;
    };
    // X/Y/Z angles of the turn (extrinsic X, then Y, then Z), in degrees
    function eulerDeg() {
      const e = new THREE.Euler().setFromQuaternion(st.rot, "ZYX");
      return [e.x, e.y, e.z].map((v) => +((v * 180) / Math.PI).toFixed(2));
    }
    function setEuler([x, y, z]) { st.rot.setFromEuler(new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, "ZYX")); }
    // the angle while dragging a ring, shown by the pointer
    const tag = el("div", { class: "ex-tag", hidden: true });
    vp.labels.append(tag);
    function startRotate(e, ringObj) {
      keyRing = ringObj;
      const axis = ringObj.userData.dir.clone();
      const center = giz.position.clone();
      const q0 = st.rot.clone();
      const turn = ringDrag(vp, e, center, axis); // jumpstart-3d: pivot. shared with the live gizmo
      const orbit = new THREE.Box3();
      for (const id of st.ids) { const x = scene.bodyTightBox(id); if (x) orbit.union(x); }
      fb.show(center, axis, orbit.isEmpty() ? center : orbit.getCenter(new THREE.Vector3())); // jumpstart-3d: pivot. the dashed ring through the selection's orbit
      const s0 = vp.local(e);
      drag = {
        ring: ringObj, moved: false,
        move(ev) {
          if (!drag.moved) { const [x, y] = vp.local(ev); if (Math.hypot(x - s0[0], y - s0[1]) < 3) return; drag.moved = true; } // jumpstart-3d: rotation access. a finger's jitter is not a turn
          const deg = turn(ev); // 15° steps; Shift or Free: the pointer's own angle
          st.rot.copy(new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180).multiply(q0));
          ringReadout = deg;
          const ang = eulerDeg();
          angInputs.forEach((f, i) => f.setValue(ang[i]));
          tag.hidden = false;
          tag.innerHTML = `<b>${deg > 0 ? "+" : ""}${deg}°</b><span>around ${ringObj.userData.axis.slice(4).toUpperCase()} · Shift for any angle</span>`; // jumpstart-3d: rotation access
          placePill(vp, tag, ev); // jumpstart-3d: pivot. beside the pointer, farther above a finger, inside the view
          changed(false);
        },
      };
      drag.restore = () => { st.rot.copy(q0); }; // jumpstart-3d: rotation access
      vp.canvas.style.cursor = "grabbing";
      return true;
    }
    function startDrag(e, kind, dir, grabPoint) {
      const d0 = st.d.slice();
      const origin = grabPoint ? grabPoint.clone() : giz.position.clone();
      let plane;
      if (kind === "ground") plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -origin.z);
      else if (kind === "free") plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vp.camera.getWorldDirection(new THREE.Vector3()).negate(), origin);
      const p0 = plane ? vp.rayPlane(e, plane) : null;
      const g = app.gridStep();
      const axisParam = (ev) => axisAlong(vp, ev, origin, dir); // jumpstart-3d: pivot. position along the axis line closest to the pointer ray
      const s0 = dir ? axisParam(e) || 0 : 0;
      // where the bodies are when the drag starts (for snapping to other shapes)
      const boxes0 = new Map(st.ids.map((id) => { const b = findBody(store.doc, id); const bx = b && scene.boxWithMatrix(id, M4(b.m)); return [id, bx ? bx.translate(new THREE.Vector3(...d0)) : null]; }));
      drag = {
        restore() { st.d = d0; }, // jumpstart-3d: rotation access
        move(ev) {
          let delta;
          if (dir) {
            const s = axisParam(ev);
            if (s == null) return;
            delta = dir.clone().multiplyScalar(round(s - s0, g));
          } else {
            const p = vp.rayPlane(ev, plane);
            if (!p || !p0) return;
            delta = p.sub(p0);
            if (g > 0) delta.set(round(delta.x, g), round(delta.y, g), round(delta.z, g));
            delta = app.snapToObjects(st.ids, boxes0, delta, kind === "ground" ? ["x", "y"] : ["x", "y", "z"]).delta;
          }
          st.d = [d0[0] + delta.x, d0[1] + delta.y, d0[2] + delta.z].map((v) => +v.toFixed(4));
          inputs.forEach((f, i) => f.setValue(st.d[i]));
          changed(false);
        },
      };
      vp.canvas.style.cursor = "grabbing";
      return true;
    }
    function changed(rerender = true) {
      if (rerender) { recenter(); def.render(); }
      scene.setSelected(st.ids);
      showSketch();
      schedulePreview(def);
      def.refreshOk();
      vp.request();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Align
  // Bounds: line up edges or centers (like Tinkercad). Faces: put a face of one
  // body against, or flush with, a face of another (like Fusion's Align).
  function alignCmd() {
    const st = { ids: app.sel.filter((id) => !app.isLocked(id)), mode: "bounds", ax: { x: null, y: null, z: null }, to: "selection", src: null, dst: null, flush: false, center: true, pick: "src" };
    if (app.sel.some((id) => app.isLocked(id))) app.toast("Locked shapes stay where they are.");
    const AX = ["x", "y", "z"];
    const boxOf = (id) => { const b = findBody(store.doc, id); return b ? scene.boxWithMatrix(id, M4(b.m)) : null; };
    const def = {
      title: "Align",
      keepSelection: true,
      valid: () => st.mode === "bounds" ? st.ids.length > 0 && AX.some((k) => st.ax[k]) && (st.to !== "first" || st.ids.length > 1) : !!(st.src && st.dst),
      canOk: () => def.valid(),
      apply(doc) {
        if (st.mode === "bounds") {
          let target;
          if (st.to === "first") target = boxOf(st.ids[0]);
          else if (st.to === "origin") target = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
          else { target = new THREE.Box3(); for (const id of st.ids) { const b = boxOf(id); if (b) target.union(b); } }
          if (!target) return;
          const val = (box, k, how) => how === "min" ? box.min[k] : how === "max" ? box.max[k] : (box.min[k] + box.max[k]) / 2;
          for (const id of st.ids) {
            if (st.to === "first" && id === st.ids[0]) continue;
            const box = boxOf(id);
            if (!box) continue;
            const d = new THREE.Vector3();
            for (const k of AX) if (st.ax[k]) d[k] = val(target, k, st.ax[k]) - val(box, k, st.ax[k]);
            const b = findBody(doc, id);
            b.m = arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(d.x, d.y, d.z)));
          }
        } else {
          const { src, dst } = st;
          const n1 = src.n.clone(), n2 = dst.n.clone();
          const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(n1, st.flush ? n2 : n2.clone().negate()));
          const c1 = src.p, c2 = dst.p;
          const t = st.center ? c2.clone().sub(c1) : n2.clone().multiplyScalar(c2.clone().sub(c1).dot(n2));
          const T = new THREE.Matrix4().makeTranslation(c1.x + t.x, c1.y + t.y, c1.z + t.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c1.x, -c1.y, -c1.z));
          const b = findBody(doc, src.body);
          b.m = arr(M4(b.m).premultiply(T));
        }
      },
      ok() { commit(def, "Align"); },
      hint: () => st.mode === "bounds" ? "Pick how each axis lines up. Click shapes to add or remove them." : st.pick === "src" ? "Click the face on the shape that will move." : "Click the face to align it to.",
      build(body) {
        body.append(row("Method", seg([["bounds", "Edges & centers"], ["faces", "Face to face"]], st.mode, (v) => { st.mode = v; st.pick = "src"; changed(); }, "al-mode")));
        if (st.mode === "bounds") {
          body.append(pickbox(true, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` shape${st.ids.length > 1 ? "s" : ""}`) : "Click shapes", st.ids.length ? () => { st.ids = []; changed(); } : null));
          const names = { x: ["Left", "Center", "Right"], y: ["Front", "Center", "Back"], z: ["Bottom", "Middle", "Top"] };
          for (const k of AX) body.append(row(k.toUpperCase() + " axis", seg([[null, "—"], ["min", names[k][0]], ["mid", names[k][1]], ["max", names[k][2]]], st.ax[k], (v) => { st.ax[k] = v; changed(); }, "al-" + k)));
          body.append(row("Align to", seg([["selection", "All selected"], ["first", "First shape"], ["origin", "Origin"]], st.to, (v) => { st.to = v; changed(); }, "al-to")));
          if (st.to === "first" && st.ids[0]) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${findBody(store.doc, st.ids[0])?.name} stays still; the others move to it.`));
        } else {
          body.append(row("Moving face", pickbox(st.pick === "src", st.src ? el("b", {}, findBody(store.doc, st.src.body)?.name || "1 face") : "Click a face", null, () => { st.pick = "src"; def.render(); })));
          body.append(row("Target face", pickbox(st.pick === "dst", st.dst ? el("b", {}, findBody(store.doc, st.dst.body)?.name || "1 face") : "Click a face", null, () => { st.pick = "dst"; def.render(); })));
          body.append(row("Result", seg([[false, "Facing (touching)"], [true, "Flush (same way)"]], st.flush, (v) => { st.flush = v; changed(); }, "al-flush")));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "al-center", checked: st.center, onchange: (e) => { st.center = e.target.checked; changed(false); } }), "Center on the target face"));
        }
      },
      start() { scene.setSelected(st.ids); changed(false); if (app.mode === "beginner") makeDots(); },
      cleanup() { scene.setSelected([]); if (dotsEl) { dotsEl.remove(); dotsEl = null; vp.labelFns.delete(placeDots); } },
      handler: {
        hover(e) {
          if (st.mode === "bounds") { const f = scene.pickFace(e); scene.setHovered(f ? f.body : null); return; }
          const f = pickBaseFace(e, (b) => st.pick === "dst" || !b.locked);
          clearOv();
          drawPicked();
          if (f) drawFace(f.base, f.face, 0xe8a317);
        },
        down(e) {
          if (st.mode === "bounds") {
            const f = scene.pickFace(e);
            if (!f) return true;
            if (app.isLocked(f.body)) { app.toast("That shape is locked."); return true; }
            const i = st.ids.indexOf(f.body);
            if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
            changed();
            return true;
          }
          const f = pickBaseFace(e, (b) => st.pick === "dst" || !b.locked);
          if (!f) return true;
          const p = f.info && f.info.t === "PLANE" ? new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m) : f.point.clone();
          const n = f.info && f.info.t === "PLANE" ? new THREE.Vector3(...f.info.n).transformDirection(f.base.m).normalize() : f.normal.clone().normalize();
          const pick = { body: f.body, face: f.face, base: f.base, p, n };
          if (st.pick === "src") { st.src = pick; st.pick = "dst"; if (st.dst && st.dst.body === pick.body) st.dst = null; }
          else {
            if (st.src && pick.body === st.src.body) { app.toast("Pick a face on a different shape."); return true; }
            st.dst = pick;
          }
          changed();
          return true;
        },
      },
    };
    // Beginner: Tinkercad-style black dots around the selection. Each axis has three (one end, the
    // middle, the other end); click one to line everything up there, click it again to undo that axis.
    let dotsEl = null, dotLines = null;
    const dotBox = { key: null, box: null };
    const DOT_NAMES = { x: ["Left", "Center", "Right"], y: ["Front", "Center", "Back"], z: ["Bottom", "Middle", "Top"] };
    function makeDots() {
      dotsEl = el("div", { class: "al-dots", id: "al-dots" });
      for (const k of AX) ["min", "mid", "max"].forEach((v, i) => {
        dotsEl.append(el("button", { class: "al-dot", "data-ax": k, "data-v": v, title: `${k.toUpperCase()}: line up the ${DOT_NAMES[k][i].toLowerCase()}s`, "aria-label": `Align ${DOT_NAMES[k][i]} (${k.toUpperCase()})`,
          onclick: (e) => { e.stopPropagation(); st.ax[k] = st.ax[k] === v ? null : v; changed(); placeDots(); } }));
      });
      dotLines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      dotLines.setAttribute("class", "al-lines");
      for (let i = 0; i < 3; i++) dotLines.append(document.createElementNS("http://www.w3.org/2000/svg", "line"));
      dotsEl.prepend(dotLines);
      vp.container.append(dotsEl);
      vp.labelFns.add(placeDots);
      placeDots();
    }
    function placeDots() {
      if (!dotsEl) return;
      // measured once per selection, before any preview moves the shapes, so the dots stay put
      const key = st.ids.join(",");
      if (dotBox.key !== key) { dotBox.key = key; dotBox.box = new THREE.Box3(); for (const id of st.ids) { const b = boxOf(id); if (b) dotBox.box.union(b); } }
      const box = dotBox.box;
      if (st.mode !== "bounds" || st.ids.length < 2 || box.isEmpty()) { dotsEl.hidden = true; return; }
      dotsEl.hidden = false;
      const sz = box.getSize(new THREE.Vector3()), g = Math.max(4, 0.15 * Math.max(sz.x, sz.y, sz.z));
      const val = (k, v) => (v === "min" ? box.min[k] : v === "max" ? box.max[k] : (box.min[k] + box.max[k]) / 2);
      const at = { x: (q) => new THREE.Vector3(q, box.min.y - g, box.min.z), y: (q) => new THREE.Vector3(box.min.x - g, q, box.min.z), z: (q) => new THREE.Vector3(box.max.x + g, box.min.y - g, q) };
      AX.forEach((k, i) => {
        const a = vp.project(at[k](box.min[k])), c = vp.project(at[k](box.max[k])), ln = dotLines.children[i];
        ln.setAttribute("x1", a[0]); ln.setAttribute("y1", a[1]); ln.setAttribute("x2", c[0]); ln.setAttribute("y2", c[1]);
      });
      for (const b of dotsEl.querySelectorAll(".al-dot")) {
        const k = b.dataset.ax, v = b.dataset.v;
        const p = vp.project(at[k](val(k, v)));
        b.style.transform = `translate(${p[0] - 7}px, ${p[1] - 7}px)`;
        b.hidden = p[2] > 1;
        b.classList.toggle("on", st.ax[k] === v);
      }
    }
    function drawPicked() {
      if (st.src) drawFace(st.src.base, st.src.face, 0x2f66c8);
      if (st.dst) drawFace(st.dst.base, st.dst.face, 0x29a35a);
    }
    function changed(rerender = true) {
      if (rerender) def.render();
      clearOv();
      if (st.mode === "faces") drawPicked();
      scene.setSelected(st.mode === "bounds" ? st.ids : []);
      if (def.valid()) schedulePreview(def); else store.setPreview(null);
      def.refreshOk && def.refreshOk();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Pattern
  // Rectangular (one or two directions) or circular copies of bodies, like Fusion's
  // Pattern. Copies can stay separate or be joined into one body.
  function patternCmd(editing = null) { // jumpstart-3d: pattern (editing: {body, mod} of a Pattern feature)
    const st = {
      ids: app.sel.slice(), type: "rect",
      ax1: "x", n1: 3, s1: 20, ax2: "y", n2: 1, s2: 20, sym: false,
      cax: "z", cn: 6, angle: 360, about: "origin", join: false,
      // pattern along a path (a chain of sketch curves): count, spread over the whole path or a
      // fixed spacing, keep the copies' direction or turn them with the path
      path: null, pickPath: false, pn: 6, pdist: "fit", pspace: 20, orient: "same", flip: false,
      // what is copied: whole bodies, or features (cuts, bosses, holes, text) on one body
      what: "bodies", fbody: null, feats: [],
      center: new THREE.Vector3(), idmap: {},
    };
    const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    // jumpstart-3d: pattern. Editing a Pattern feature: its saved axes and centre are in the body's own coordinates; they
    // stay as saved until the picker for that one is touched (the pickers only know the world x, y, z)
    const keep = {}, saved = {};
    if (editing) {
      const eb = findBody(store.doc, editing.body), m = eb.node.mods.find((x) => x.id === editing.mod), B = M4(eb.m);
      const letter = (v, d) => { if (!v) return d; const w = new THREE.Vector3(...v).transformDirection(B), a = [w.x, w.y, w.z].map(Math.abs); return "xyz"[a.indexOf(Math.max(...a))]; };
      Object.assign(keep, { ax1: m.ax1, ax2: m.ax2, cax: m.cax, center: m.center });
      Object.assign(st, { ids: [eb.id], type: m.kind, what: m.what === "feats" ? "features" : "bodies", fbody: eb.id, feats: m.feats || [],
        ax1: letter(m.ax1, "x"), ax2: letter(m.ax2, "y"), cax: letter(m.cax, "z"), n1: m.n1 ?? 3, s1: m.s1 ?? 20, n2: m.n2 ?? 1, s2: m.s2 ?? 20, sym: !!m.sym, cn: m.cn ?? 6, angle: m.angle ?? 360 },
        exprsOf(m, ["n1", "s1", "n2", "s2", "cn", "angle"]));
      if (m.center) {
        const c = new THREE.Vector3(...m.center).applyMatrix4(B);
        st.about = m.about || (c.length() < 1e-6 ? "origin" : "center"); st.center = c;
        saved.about = st.about; saved.center = m.center;
      }
    }
    // kept as a Pattern feature (not baked copies): Advanced, not Path, and (editing, or Features, or Join)
    const asFeature = () => app.mode === "advanced" && st.type !== "path" && (editing || st.what === "features" || st.join);

    // ---------------- features that can be copied, and where each one sits (world)
    const featLabel = (m) => m.t === "hole" ? (m.tapped ? "Tapped hole" : m.kind === "csink" ? "Countersunk hole" : m.kind === "cbore" ? "Counterbored hole" : "Hole") + ((m.at || []).length > 1 ? ` ×${m.at.length}` : "")
      : m.t === "emboss" ? (m.mode === "deboss" ? "Deboss" : "Emboss") + ` "${String(m.str || "").slice(0, 12)}"`
      : ({ extrude: "Extrude ", revolve: "Revolve ", sweep: "Sweep " }[m.tool && m.tool.t] || "") + (m.op === "cut" ? "cut" : m.op === "intersect" ? "intersect" : "join");
    const featOK = (m) => m.t === "hole" || (m.t === "emboss" && m.kind !== "other") || (m.t === "bool" && m.src !== "combine" && m.tool && ["extrude", "revolve", "sweep"].includes(m.tool.t) && m.tool.sketch);
    const featsOf = (b) => { // jumpstart-3d: pattern (an edited pattern repeats only what comes before it)
      const ms = (b && b.node.mods) || [], i = editing ? ms.findIndex((x) => x.id === editing.mod) : -1;
      return (i >= 0 ? ms.slice(0, i) : ms).filter(featOK);
    };
    function featRef(b, m) {
      const B = M4(b.m), loc = (p) => new THREE.Vector3(...p).applyMatrix4(B);
      if (m.t === "hole") { const a = (m.at && m.at.length ? m.at : [{ p: m.p }]); const c = new THREE.Vector3(); a.forEach((x) => c.add(loc(x.p))); return c.divideScalar(a.length); }
      if (m.t === "emboss") return loc(m.p);
      const sk = findSketch(store.doc, m.tool.sketch);
      if (!sk) return null;
      const P = planeMatrix(sk.plane), c = new THREE.Vector3(); let n = 0;
      for (const pr of m.tool.profiles || []) if (pr.pt) { c.add(new THREE.Vector3(pr.pt[0], pr.pt[1], 0).applyMatrix4(P)); n++; }
      if (!n) return null;
      // the tool sits in the body through m (body coordinates when it was made)
      return c.divideScalar(n).applyMatrix4(new THREE.Matrix4().fromArray(m.m || IDENTITY)).applyMatrix4(B);
    }
    const chosenFeats = () => { const b = findBody(store.doc, st.fbody); return b ? featsOf(b).filter((m) => st.feats.includes(m.id)) : []; };

    // ---------------- the path: sampled into a world polyline with arc-length
    function pathData() {
      if (!st.path) return null;
      const sk = findSketch(store.view, st.path.sketch) || findSketch(store.doc, st.path.sketch);
      if (!sk) return null;
      const segs = orderPath(resolveSketch(sk), st.path.ents);
      if (!segs.length) return null;
      const P2 = [];
      const push = (q) => { const l = P2[P2.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-9) P2.push(q); };
      for (const g of segs) {
        if (g.t === "line") { push(g.a); push(g.b); }
        else if (g.t === "circle") { for (let k = 0; k <= 96; k++) { const t = (k / 96) * Math.PI * 2; push([g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)]); } }
        else if (g.t === "arc") {
          // circle through a, m, b; walk from a through m to b
          const [ax, ay] = g.a, [mx, my] = g.m, [bx, by] = g.b;
          const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
          if (Math.abs(d) < 1e-12) { push(g.a); push(g.b); continue; }
          const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
          const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
          const r = Math.hypot(ax - ux, ay - uy), ang = (x, y) => Math.atan2(y - uy, x - ux);
          const a0 = ang(ax, ay), am = ang(mx, my), a1 = ang(bx, by), TAU = Math.PI * 2;
          const norm = (v) => ((v % TAU) + TAU) % TAU;
          let sw = norm(a1 - a0); if (norm(am - a0) > sw) sw -= TAU; // go the way that passes m
          const n = Math.max(8, Math.ceil(Math.abs(sw) / (Math.PI / 32)));
          for (let k = 0; k <= n; k++) { const t = a0 + (sw * k) / n; push([ux + r * Math.cos(t), uy + r * Math.sin(t)]); }
        } else if (g.t === "bez") {
          for (const sp of g.spans || []) for (let k = 0; k <= 24; k++) {
            const t = k / 24, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            push([0, 1].map((i) => w[0] * sp[0][i] + w[1] * sp[1][i] + w[2] * sp[2][i] + w[3] * sp[3][i]));
          }
        }
      }
      const M = planeMatrix(sk.plane);
      const pts = P2.map((q) => new THREE.Vector3(q[0], q[1], 0).applyMatrix4(M));
      if (pts.length < 2) return null;
      const closed = pts[0].distanceTo(pts[pts.length - 1]) < 1e-6;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      const L = cum[cum.length - 1];
      // side: at a corner, which segment gives the direction (+1 the one after it, -1 the one before)
      const at = (s, side = 1) => {
        s = closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
        if (closed && side < 0 && s < 1e-9) s = L; // going backwards from the start: the last segment
        const q = Math.max(0, Math.min(L, s + side * 1e-6 * Math.max(1, L)));
        let k = 1;
        if (side > 0) { while (k < cum.length - 1 && cum[k] <= q) k++; } else { while (k < cum.length - 1 && cum[k] < q) k++; }
        const f = (s - cum[k - 1]) / Math.max(1e-12, cum[k] - cum[k - 1]);
        const tan = pts[k].clone().sub(pts[k - 1]).normalize();
        return { p: pts[k - 1].clone().lerp(pts[k], f), t: tan };
      };
      // the arc length of the point on the path nearest to q
      const nearest = (q) => {
        let best = 0, bd = Infinity;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], d = pts[k].clone().sub(a), len2 = d.lengthSq() || 1e-12;
          const f = Math.max(0, Math.min(1, q.clone().sub(a).dot(d) / len2)), c = a.clone().addScaledVector(d, f), e = c.distanceTo(q);
          if (e < bd) { bd = e; best = cum[k - 1] + f * Math.sqrt(len2); }
        }
        return best;
      };
      return { pts, closed, L, at, nearest, n: new THREE.Vector3(...sk.plane.n).normalize(), segCount: segs.length };
    }

    const recenter = () => {
      if (editing && keep.center) { st.center = new THREE.Vector3(...keep.center).applyMatrix4(M4(findBody(store.doc, editing.body).m)); return; } // jumpstart-3d: pattern
      const box = new THREE.Box3();
      if (st.what === "features") {
        const b = findBody(store.doc, st.fbody);
        for (const m of chosenFeats()) { const r = b && featRef(b, m); if (r) box.expandByPoint(r); }
      } else for (const id of st.ids) { const b = findBody(store.doc, id); const bb = b && scene.boxWithMatrix(id, M4(b.m)); if (bb) box.union(bb); }
      st.center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    };
    // the transform of every copy (the original is not included)
    function transforms() {
      const out = [];
      if (st.type === "rect") {
        const n1 = Math.max(1, Math.round(st.n1)), n2 = Math.max(1, Math.round(st.n2));
        // "both sides": the count is per side and the original stays in the middle
        const r1 = st.sym ? [-(n1 - 1), n1 - 1] : [0, n1 - 1], r2 = st.sym ? [-(n2 - 1), n2 - 1] : [0, n2 - 1];
        for (let i = r1[0]; i <= r1[1]; i++) for (let j = r2[0]; j <= r2[1]; j++) {
          if (i === 0 && j === 0) continue;
          const v = AXV[st.ax1].clone().multiplyScalar(i * st.s1).add(AXV[st.ax2].clone().multiplyScalar(j * st.s2));
          out.push({ key: i + "," + j, m: new THREE.Matrix4().makeTranslation(v.x, v.y, v.z) });
        }
      } else if (st.type === "circ") {
        const n = Math.max(2, Math.round(st.cn));
        const full = st.angle >= 359.999;
        const step = full ? 360 / n : st.angle / (n - 1);
        const c = st.about === "center" ? st.center : new THREE.Vector3();
        for (let i = 1; i < n; i++) {
          const R = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
            .multiply(new THREE.Matrix4().makeRotationAxis(AXV[st.cax], (i * step * Math.PI) / 180))
            .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
          out.push({ key: "c" + i, m: R });
        }
      } else {
        const pd = pathData();
        if (!pd) return out;
        const n = Math.max(2, Math.round(st.pn)), dir = st.flip ? -1 : 1;
        const s0 = pd.nearest(st.center);
        // spacing: the whole path shared out (a closed path: n equal steps all the way round;
        // an open one: from the object to the end of the path), or a typed distance
        let step = st.pspace;
        if (st.pdist === "fit") step = pd.closed ? pd.L / n : (dir > 0 ? pd.L - s0 : s0) / (n - 1);
        const A = pd.at(s0, dir);
        for (let i = 1; i < n; i++) {
          const s = s0 + dir * i * step;
          if (!pd.closed && (s < -1e-6 || s > pd.L + 1e-6)) break; // past the end of an open path
          const B = pd.at(s, dir);
          let m = new THREE.Matrix4().makeTranslation(B.p.x - A.p.x, B.p.y - A.p.y, B.p.z - A.p.z);
          if (st.orient === "follow") {
            // turn by the change in the path's direction, around the path's plane normal
            const t0 = A.t.clone().projectOnPlane(pd.n).normalize(), t1 = B.t.clone().projectOnPlane(pd.n).normalize();
            const ang = Math.atan2(t0.clone().cross(t1).dot(pd.n), t0.dot(t1));
            m = new THREE.Matrix4().makeTranslation(B.p.x, B.p.y, B.p.z)
              .multiply(new THREE.Matrix4().makeRotationAxis(pd.n, ang))
              .multiply(new THREE.Matrix4().makeTranslation(-A.p.x, -A.p.y, -A.p.z));
          }
          out.push({ key: "p" + i, m });
        }
      }
      return out;
    }
    // a feature copied by a world transform W, in its body's own coordinates
    function movedFeature(b, m, W, key, doc) {
      const B = M4(b.m), L = B.clone().invert().multiply(W).multiply(B);
      const P = (p) => new THREE.Vector3(...p).applyMatrix4(L).toArray().map((v) => +v.toFixed(9));
      const D = (v) => new THREE.Vector3(...v).transformDirection(L).toArray().map((x) => +x.toFixed(9));
      const c = clone(m);
      c.id = st.idmap[m.id + key] || (st.idmap[m.id + key] = uid("f"));
      c.seq = nextSeq(doc);
      if (m.t === "hole") {
        if (c.at) c.at = c.at.map((x) => ({ ...x, p: P(x.p), n: D(x.n) }));
        if (c.p) c.p = P(c.p);
        if (c.n) c.n = D(c.n);
      } else if (m.t === "emboss") {
        for (const k of ["p", "o", "c"]) if (c[k]) c[k] = P(c[k]);
        for (const k of ["n", "x", "ax", "up"]) if (c[k]) c[k] = D(c[k]);
      } else {
        c.m = arr(L.clone().multiply(new THREE.Matrix4().fromArray(m.m || IDENTITY)));
      }
      return c;
    }
    // jumpstart-3d: pattern. The Pattern feature's properties for body b: axes and centre in b's own coordinates
    function patternProps(b) {
      const Bi = M4(b.m).invert(), r9 = (a) => a.map((v) => +v.toFixed(9));
      // a mirrored body (determinant -1) turns the other way when undone, so its circular axis is flipped
      const flip = M4(b.m).determinant() < 0 && st.type === "circ";
      const D = (k) => keep[k] ? keep[k].slice() : r9(AXV[st[k]].clone().transformDirection(Bi).toArray()).map((x) => (flip ? 0 - x : x));
      const props = { kind: st.type, what: st.what === "features" ? "feats" : "shape" };
      if (st.what === "features") props.feats = featsOf(b).filter((m) => st.feats.includes(m.id)).map((m) => m.id);
      if (st.type === "rect") Object.assign(props, { ax1: D("ax1"), n1: st.n1, s1: st.s1, ax2: D("ax2"), n2: st.n2, s2: st.s2, sym: st.sym }, exprsOf(st, ["n1", "s1", "n2", "s2"]));
      else Object.assign(props, { cax: D("cax"), center: keep.center ? keep.center.slice() : r9((st.about === "center" ? st.center : new THREE.Vector3()).clone().applyMatrix4(Bi).toArray()), about: st.about, cn: st.cn, angle: st.angle }, exprsOf(st, ["cn", "angle"]));
      return props;
    }
    const def = {
      title: (editing ? "Edit " : "") + "Pattern", // jumpstart-3d: pattern
      keepSelection: true,
      valid: () => (st.what === "features" ? chosenFeats().length > 0 : st.ids.length > 0) && transforms().length > 0,
      canOk: () => def.valid(),
      apply(doc) {
        if (asFeature()) { // jumpstart-3d: pattern. One editable Pattern feature per body (copies are not made)
          if (editing) {
            const b = findBody(doc, editing.body), m = b && b.node.mods.find((x) => x.id === editing.mod);
            if (!m) return;
            for (const k of Object.keys(m)) if (k !== "id" && k !== "seq" && k !== "t") delete m[k];
            Object.assign(m, patternProps(b));
            return;
          }
          for (const id of st.what === "features" ? [st.fbody] : st.ids) {
            const b = findBody(doc, id);
            if (!b) continue;
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: st.idmap["pattern" + id] || (st.idmap["pattern" + id] = uid("f")), seq: nextSeq(doc), t: "pattern", ...patternProps(b) });
          }
          return;
        }
        const T = transforms();
        if (st.what === "features") {
          const b = findBody(doc, st.fbody);
          if (!b) return;
          const src = featsOf(b).filter((m) => st.feats.includes(m.id));
          // copies go right after their originals' place in the list, original order kept
          for (const t of T) for (const m of src) b.node.mods.push(movedFeature(b, m, t.m, t.key, doc));
          return;
        }
        const made = [];
        for (const id of st.ids) {
          const b = findBody(doc, id);
          if (!b) continue;
          const group = [b];
          for (const t of T) {
            const c = clone(b);
            c.id = st.idmap[id + t.key] || (st.idmap[id + t.key] = uid("b"));
            c.seq = nextSeq(doc);
            c.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
            c.m = arr(M4(b.m).premultiply(t.m));
            doc.bodies.push(c);
            group.push(c);
          }
          made.push(group);
        }
        if (st.join) {
          // one body per patterned shape: the original and its copies fused
          for (const group of made) {
            const first = group[0];
            const g = {
              id: st.idmap["join" + first.id] || (st.idmap["join" + first.id] = uid("b")),
              name: first.name + " pattern", seq: nextSeq(doc), color: first.color, hole: !!first.hole, hidden: false,
              m: IDENTITY.slice(),
              node: { t: "group", children: group.map((b) => ({ node: b.node, m: b.m, hole: false, name: b.name, color: b.color })), mods: [] },
            };
            const ids = new Set(group.map((b) => b.id));
            const at = doc.bodies.findIndex((b) => b.id === first.id);
            doc.bodies = doc.bodies.filter((b) => !ids.has(b.id));
            doc.bodies.splice(Math.min(at, doc.bodies.length), 0, g);
          }
        }
      },
      ok() { commit(def, "Pattern"); },
      onDelete: editing ? () => deleteFeature(editing) : null, // jumpstart-3d: pattern
      hint: () => editing ? "Change the count, spacing or angle. The copies update in the model."
        : st.type === "path" && (st.pickPath || !st.path) ? "Click a sketch line, arc, circle or polygon for the path. Connected curves are picked together."
        : st.what === "features" ? (st.fbody ? "Tick the features to copy. Click another body to list its features." : "Click the body that has the features (cuts, bosses, holes, text).")
        : st.ids.length ? "Set the count and spacing. The copies preview in place." : "Click the shapes to pattern.",
      build(body) {
        if (!editing) body.append(row("Objects", seg([["bodies", "Bodies"], ["features", "Features"]], st.what, (v) => { // jumpstart-3d: pattern
          st.what = v;
          if (v === "features" && !st.fbody) { const b = st.ids.map((id) => findBody(store.doc, id)).find((x) => featsOf(x).length) || store.doc.bodies.find((x) => featsOf(x).length); st.fbody = b ? b.id : null; }
          changed();
        }, "pt-what")));
        if (st.what === "bodies" && editing) body.append(el("div", { class: "hint", style: { padding: 0 } }, `Repeats the whole shape of ${findBody(store.doc, editing.body).name} and joins the copies to it.`)); // jumpstart-3d: pattern
        else if (st.what === "bodies") {
          body.append(pickbox(!st.pickPath, st.ids.length ? el("span", {}, el("b", {}, st.ids.length), ` bod${st.ids.length > 1 ? "ies" : "y"}`) : "Click bodies", st.ids.length ? () => { st.ids = []; changed(); } : null, () => { st.pickPath = false; def.render(); }));
        } else {
          const b = findBody(store.doc, st.fbody), list = featsOf(b);
          body.append(pickbox(!st.pickPath, b ? el("span", {}, el("b", {}, b.name), ` · ${st.feats.length} of ${list.length} feature${list.length === 1 ? "" : "s"}`) : "Click a body", null, () => { st.pickPath = false; def.render(); }));
          if (b && !list.length) body.append(el("div", { class: "hint", style: { padding: 0 } }, "This body has no features that can be copied. Cuts and bosses made by extruding a sketch, holes and embossed text can be patterned."));
          if (list.length) body.append(el("div", { class: "pt-feats", id: "pt-feats" }, ...list.map((m) => el("label", { class: "check" },
            el("input", { type: "checkbox", "data-mod": m.id, checked: st.feats.includes(m.id), onchange: (e) => { st.feats = e.target.checked ? [...st.feats, m.id] : st.feats.filter((x) => x !== m.id); changed(); } }), featLabel(m)))));
        }
        const types = seg([["rect", "Rectangular"], ["circ", "Circular"], ...(editing ? [] : [["path", "Path"]])], st.type, (v) => { st.type = v; if (v === "path" && !st.path) st.pickPath = true; changed(); }, "pt-type");
        types.classList.add("seg-wide");
        body.append(el("div", { class: "subhead" }, "Type"), types);
        // jumpstart-3d: pattern. Counts, spacings and the angle can be parameter expressions when the pattern is kept as a feature
        const num = (label, key, opts) => { const fx = asFeature() && key !== "pn" && key !== "pspace"; return row(label, app.numField({ value: st[key], id: "pt-" + key, live: true, ...opts, ...(fx ? { expr: exprOf(st, key) } : {}), onCommit: (v, t) => { st[key] = v; if (fx) setExpr(st, key, t, key !== "s1" && key !== "s2"); changed(false); } }), "pt-" + key); };
        const axes = (key) => seg([["x", "X"], ["y", "Y"], ["z", "Z"]], st[key], (v) => { st[key] = v; delete keep[key]; changed(); }, "pt-" + key);
        if (st.type === "rect") {
          body.append(el("div", { class: "subhead" }, "Direction 1"));
          body.append(row("Along", axes("ax1")));
          body.append(num("Count", "n1", { min: 1, max: 200, step: 1 }));
          body.append(num("Spacing", "s1", { step: 1 }));
          body.append(el("div", { class: "subhead" }, "Direction 2 (count 1 = off)"));
          body.append(row("Along", axes("ax2")));
          body.append(num("Count", "n2", { min: 1, max: 200, step: 1 }));
          body.append(num("Spacing", "s2", { step: 1 }));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-sym", checked: st.sym, onchange: (e) => { st.sym = e.target.checked; changed(false); } }), "Both sides of the original (count per side)"));
        } else if (st.type === "circ") {
          body.append(row("Around", axes("cax")));
          // editing a shape pattern: the shape on screen already includes the copies, so its centre can't be measured again;
          // the choice is the saved centre ("As saved") or the origin
          const asSaved = editing && st.what === "bodies";
          const aboutOpts = asSaved ? (saved.about === "center" ? [["origin", "Origin"], ["center", "As saved"]] : [["origin", "Origin"]]) : [["origin", "Origin"], ["center", st.what === "features" ? "Feature center" : "Shape center"]]; // jumpstart-3d: pattern
          body.append(row("Through", seg(aboutOpts, st.about, (v) => { st.about = v; if (asSaved && v === saved.about) keep.center = saved.center; else delete keep.center; changed(); }, "pt-about")));
          body.append(num("Count", "cn", { min: 2, max: 360, step: 1 }));
          body.append(num("Total angle", "angle", { min: 1, max: 360, step: 15, angle: true }));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "360° spaces the copies evenly around the full circle."));
        } else {
          const pd = pathData();
          body.append(row("Path", pickbox(st.pickPath, pd ? el("span", {}, el("b", {}, pd.segCount), ` curve${pd.segCount > 1 ? "s" : ""} · ${pd.closed ? "closed" : "open"} · ${withUnit(pd.L, 1)}`) : "Click a sketch path", pd ? () => { st.path = null; st.pickPath = true; changed(); } : null, () => { st.pickPath = true; def.render(); }), "pt-path"));
          body.append(num("Count", "pn", { min: 2, max: 500, step: 1 }));
          body.append(row("Spread", seg([["fit", pd && !pd.closed ? "To the end" : "Whole path"], ["space", "Spacing"]], st.pdist, (v) => { st.pdist = v; changed(); }, "pt-pdist")));
          if (st.pdist === "space") body.append(num("Spacing", "pspace", { min: 0.01, step: 1 }));
          body.append(row("Copies", seg([["same", "Same direction"], ["follow", "Follow path"]], st.orient, (v) => { st.orient = v; changed(); }, "pt-orient")));
          body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-flip", checked: st.flip, onchange: (e) => { st.flip = e.target.checked; changed(false); } }), "Go the other way along the path"));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, "Copies start where the " + (st.what === "features" ? "features sit" : "object sits") + " (the nearest point on the path) and step along it. Follow path turns each copy with the path, like beads on a string."));
        }
        const total = transforms().length + 1;
        body.append(el("div", { class: "hint", id: "pt-total", style: { padding: 0 } }, `${total} instance${total === 1 ? "" : "s"} in total.`));
        if (st.what === "bodies" && !editing) body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pt-join", checked: st.join, onchange: (e) => { st.join = e.target.checked; changed(); } }), "Join copies into one body")); // jumpstart-3d: pattern
        if (app.mode === "advanced" && st.type === "path") body.append(el("div", { class: "hint", style: { padding: 0 } }, "Path patterns are not editable yet: they make separate copies or fixed features.")); // jumpstart-3d: pattern
      },
      start() { recenter(); scene.setSelected(st.ids); draw(); schedulePreview(def); },
      cleanup() { scene.setSelected([]); clearOv(); },
      handler: {
        hover(e) {
          if (st.type === "path" && st.pickPath) { const h = pickSketchCurve(e); vp.canvas.style.cursor = h ? "pointer" : "default"; scene.setHovered(null); return; }
          const f = scene.pickFace(e); scene.setHovered(f ? f.body : null); vp.canvas.style.cursor = f ? "pointer" : "default";
        },
        down(e) {
          // the path: a sketch curve and the curves joined to it
          if (st.type === "path" && (st.pickPath || !scene.pickFace(e))) {
            const h = pickSketchCurve(e);
            if (h) {
              const sk = findSk(store.view, h.sketch);
              st.path = { sketch: h.sketch, ents: pathChain(resolveSketch(sk), h.curve.id) };
              st.pickPath = false; changed();
              return true;
            }
            if (st.pickPath) return true;
          }
          if (editing) return true; // jumpstart-3d: pattern
          const f = scene.pickFace(e);
          if (!f || !findBody(store.doc, f.body)) return true; // copies in the preview aren't pickable
          if (st.what === "features") { if (st.fbody !== f.body) { st.fbody = f.body; st.feats = []; changed(); } return true; }
          const i = st.ids.indexOf(f.body);
          if (i >= 0) st.ids.splice(i, 1); else st.ids.push(f.body);
          changed();
          return true;
        },
      },
    };
    // the picked path, drawn bold, with a dot where each copy goes
    function draw() {
      clearOv();
      if (st.type !== "path") return;
      const pd = pathData();
      if (!pd) return;
      const seg = [];
      for (let k = 1; k < pd.pts.length; k++) { const a = pd.pts[k - 1], b = pd.pts[k]; seg.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      const o = thickLines(seg, 0xe8a317, 4, false); o.renderOrder = 15; ov.add(o);
      const s0 = pd.nearest(st.center), A = pd.at(s0), mk = [];
      for (const t of [{ m: new THREE.Matrix4() }, ...transforms()]) {
        const q = A.p.clone().applyMatrix4(t.m), r = vp.pixelSize(q) * 5;
        mk.push(q.x - r, q.y, q.z, q.x + r, q.y, q.z, q.x, q.y - r, q.z, q.x, q.y + r, q.z);
      }
      const d = thickLines(mk, 0x2f66c8, 5, false); d.renderOrder = 16; ov.add(d);
    }
    function changed(rerender = true) {
      recenter();
      if (rerender) def.render();
      const t = document.getElementById("pt-total");
      if (t) { const n = transforms().length + 1; t.textContent = `${n} instance${n === 1 ? "" : "s"} in total.`; }
      scene.setSelected(st.what === "features" ? (st.fbody ? [st.fbody] : []) : st.ids);
      draw();
      schedulePreview(def);
      def.refreshOk();
    }
    openCmd(def);
  }

  // ------------------------------------------------------------------ Primitive
  function primCmd(kind, editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    const st = { kind: existing ? existing.node.kind : kind, p: existing ? { ...existing.node.p } : { ...PRIM_DEFAULTS[kind] }, m: existing ? existing.m.slice() : null, id: existing ? existing.id : uid("b"), placed: !!existing, ...(existing && exprsOf(existing.node, ["w", "d", "h"])) }; // jumpstart-3d: parameters
    if (!st.m) { const t = vp.view.target; st.m = arr(new THREE.Matrix4().makeTranslation(round(t.x, 5), round(t.y, 5), 0)); }
    const def = {
      title: (existing ? "Edit " : "") + primName(st.kind),
      apply(doc) {
        let b = findBody(doc, st.id);
        if (!b) { b = makePrimBody(doc, st.kind, st.m, { color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length] }); b.id = st.id; doc.bodies.push(b); }
        b.node.p = { ...st.p };
        if (st.kind === "torus") b.node.p.d = b.node.p.w;
        delete b.node.exprs; delete b.node.exprUnits; Object.assign(b.node, exprsOf(st, ["w", "d", "h"])); // jumpstart-3d: parameters
        b.m = st.m.slice();
      },
      ok() { commit(def, existing ? "Edit " + primName(st.kind).toLowerCase() : "Add " + primName(st.kind).toLowerCase()); },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id]); } : null,
      hint: () => existing ? "Edit the sizes." : "Click the ground or a flat face to place it, then set the sizes.",
      build(body) {
        const dims = st.kind === "torus" ? [["Diameter", "w"], ["Tube", "tube"]] : st.kind === "sphere" ? [["X", "w"], ["Y", "d"], ["Z", "h"]] : [["Width", "w"], ["Depth", "d"], ["Height", "h"]];
        const r3 = el("div", { class: "row3" });
        for (const [l, k] of dims) r3.append(el("label", {}, l, app.numField({ value: st.p[k], id: "pr-" + k, min: 0.01, step: 1, live: true, ...(k !== "tube" && { expr: exprOf(st, k) }), onCommit: (v, t) => { st.p[k] = v; setExpr(st, k, t); schedulePreview(def); } }))); // jumpstart-3d: parameters
        body.append(el("div", { class: "subhead" }, "Size"), r3);
        const extra = { cone: [["Top ratio", "top", 0, 1]], pyramid: [["Sides", "sides", 3, 12]], prism: [["Sides", "sides", 3, 24]], tube: [["Wall", "wall", 0.1, 1e9]], box: [["Fillet all", "r", 0, 1e9], ["Chamfer all", "c", 0, 1e9]], cylinder: [["Fillet ends", "r", 0, 1e9]] }[st.kind] || [];
        for (const [l, k, mn, mx] of extra) body.append(row(l, app.numField({ value: st.p[k] ?? 0, id: "pr-x-" + k, min: mn, max: mx, step: k === "top" ? 0.1 : 1, live: true, onCommit: (v) => { st.p[k] = v; schedulePreview(def); } }), "pr-x-" + k));
        const pos = new THREE.Vector3().setFromMatrixPosition(M4(st.m));
        const p3 = el("div", { class: "row3" });
        ["X", "Y", "Z"].forEach((l, i) => p3.append(el("label", {}, l, app.numField({ value: pos.getComponent(i), id: "pr-pos" + i, step: 1, onCommit: (v) => {
          const m = M4(st.m); const p = new THREE.Vector3().setFromMatrixPosition(m); p.setComponent(i, v); m.setPosition(p); st.m = arr(m); schedulePreview(def);
        } }))));
        body.append(el("div", { class: "subhead" }, "Base position"), p3);
      },
      start() { schedulePreview(def); },
      handler: {
        hover(e) {
          if (st.placed) return;
          const mat = placeOn(e, st.id);
          if (mat) { st.m = arr(mat); schedulePreview(def); }
        },
        down(e) {
          const mat = placeOn(e, st.id);
          if (mat) { st.m = arr(mat); st.placed = true; def.render(); schedulePreview(def); }
          return true;
        },
      },
    };
    openCmd(def);
  }

  // ------------------------------------------------------------------ 3D text on a surface
  // A text body that lies on any face (or the ground) and reads upright. Point to place it, then
  // drag it anywhere: it follows the faces, snapping to face centers and the grid (Snap off or Alt
  // moves it freely). Arrow keys nudge it; Angle spins it on the face.
  function textCmd(editingId = null) {
    const existing = editingId ? findBody(store.doc, editingId) : null;
    const p0 = existing ? existing.node.p : {};
    const st = { id: existing ? existing.id : uid("b"), str: p0.text || "TEXT", font: p0.font || "sans", size: p0.size || 10, h: p0.h || 2, angle: 0, sink: 0,
      snap: app.snapOn, placed: !!existing, dragging: false, at: null };
    // where it sits: a point on a surface, the surface's normal, the text's "across" direction, and the face center
    if (existing) {
      const m = M4(existing.m), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
      m.extractBasis(x, y, z);
      st.at = { p: new THREE.Vector3().setFromMatrixPosition(m), n: z.normalize(), x: x.normalize(), c: null, ground: false };
    } else { const t = vp.view.target; st.at = { p: new THREE.Vector3(round(t.x, 5), round(t.y, 5), 0), n: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(0, 0, 0), ground: true }; }
    const upOf = (a) => new THREE.Vector3().crossVectors(a.n, a.x).normalize();
    function matrix() {
      const a = st.at, z = a.n.clone().normalize();
      const x = a.x.clone().applyAxisAngle(z, ((st.angle || 0) * Math.PI) / 180), y = new THREE.Vector3().crossVectors(z, x);
      const m = new THREE.Matrix4().makeBasis(x, y, z);
      m.setPosition(a.p.clone().addScaledVector(z, -(st.sink || 0)));
      return arr(m);
    }
    // the surface under the pointer, as a place for the text
    function pick(e) {
      const snapOn = st.snap !== !!e.altKey;
      const f = pickBaseFace(e, (b) => b.id !== st.id && !b.hole && b.visible !== false);
      if (f && f.info) {
        const n = f.normal.clone().normalize();
        const x = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(n).normalize();
        let p = f.point.clone(), c = null;
        if (f.info.t === "PLANE" && f.info.c) {
          c = new THREE.Vector3(...f.info.c).applyMatrix4(f.base.m);
          p = snapOnFace(p, c, x, new THREE.Vector3().crossVectors(n, x).normalize(), vp.tol(10) * vp.pixelSize(f.point), snapOn).p;
        }
        return { p, n, x, c, ground: false, name: f.base.body.name };
      }
      const g = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
      if (!g) return null;
      const c = new THREE.Vector3(0, 0, 0);
      const p = snapOnFace(g, c, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), vp.tol(10) * vp.pixelSize(g), snapOn).p;
      return { p, n: new THREE.Vector3(0, 0, 1), x: new THREE.Vector3(1, 0, 0), c, ground: true, name: "Workplane" };
    }
    const uv = () => { const a = st.at; if (!a.c) return null; const d = a.p.clone().sub(a.c); return [d.dot(a.x), d.dot(upOf(a))]; };
    function setUV(u, v) {
      const a = st.at, cur = uv(); if (!cur) return;
      a.p.addScaledVector(a.x, (u ?? cur[0]) - cur[0]).addScaledVector(upOf(a), (v ?? cur[1]) - cur[1]);
    }
    const def = {
      title: (existing ? "Edit " : "") + "3D text",
      valid: () => !!st.str.trim() && st.size > 0 && st.h > 0,
      canOk: () => def.valid() && st.placed,
      apply(doc) {
        let b = findBody(doc, st.id);
        if (!b) { b = makePrimBody(doc, "text", matrix(), { color: BODY_COLORS[doc.bodies.length % BODY_COLORS.length] }); b.id = st.id; doc.bodies.push(b); }
        b.node.p = { ...(b.node.p || {}), text: st.str, size: st.size, h: st.h, font: st.font };
        b.m = matrix();
      },
      ok() { commit(def, existing ? "Edit 3D text" : "Add 3D text"); },
      onDelete: existing ? () => { closeCmd(false); deleteBodies([existing.id]); } : null,
      hint: () => st.placed ? "Drag to move the text over any face or the workplane. Arrow keys nudge it; hold Alt (Option) while dragging to move freely." : "Point at a face or the workplane and click to place the text.",
      build(body) {
        body.append(pickbox(!st.placed, st.placed ? el("span", {}, "On ", el("b", {}, st.at.name || (st.at.ground ? "Workplane" : "a face"))) : "Click a face or the workplane", null));
        const txt = el("input", { class: "num", id: "tx-text", value: st.str, style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { st.str = txt.value; txt.blur(); schedulePreview(def); } });
        txt.addEventListener("input", () => { st.str = txt.value; clearTimeout(st.tt); st.tt = setTimeout(() => { schedulePreview(def); draw(); }, 300); });
        body.append(row("Text", txt, "tx-text"));
        body.append(row("Font", textFontSelect(st.font, (v) => { st.font = v; schedulePreview(def); draw(); }, "tx-font"), "tx-font"));
        const r3 = el("div", { class: "row3" });
        r3.append(el("label", {}, "Letter height", app.numField({ value: st.size, id: "tx-size", min: 0.5, step: 1, onCommit: (v) => { st.size = v; schedulePreview(def); draw(); } })));
        r3.append(el("label", {}, "Thickness", app.numField({ value: st.h, id: "tx-h", min: 0.1, step: 0.5, onCommit: (v) => { st.h = v; schedulePreview(def); } })));
        r3.append(el("label", {}, "Angle °", app.numField({ value: st.angle, id: "tx-angle", step: 15, onCommit: (v) => { st.angle = v; schedulePreview(def); draw(); } })));
        body.append(r3);
        const turn = (d) => { st.angle = (((st.angle + d) % 360) + 360) % 360; def.render(); schedulePreview(def); draw(); };
        body.append(row("Turn", el("div", { class: "seg", id: "tx-turn" },
          el("button", { onclick: () => turn(-90), title: "Turn 90° to the left" }, "↺ 90°"), el("button", { onclick: () => turn(-15) }, "−15°"),
          el("button", { onclick: () => turn(15) }, "+15°"), el("button", { onclick: () => turn(90), title: "Turn 90° to the right" }, "↻ 90°")), "tx-turn"));
        body.append(row("Sink into the face", app.numField({ value: st.sink, id: "tx-sink", min: 0, step: 0.1, onCommit: (v) => { st.sink = v; schedulePreview(def); } }), "tx-sink"));
        const c = uv();
        if (st.placed && c) {
          const p3 = el("div", { class: "row3" });
          p3.append(el("label", {}, "Across", app.numField({ value: +c[0].toFixed(3), id: "tx-u", step: 1, onCommit: (v) => { setUV(v, null); after(); } })));
          p3.append(el("label", {}, "Up", app.numField({ value: +c[1].toFixed(3), id: "tx-v", step: 1, onCommit: (v) => { setUV(null, v); after(); } })));
          p3.append(el("label", {}, " ", el("button", { class: "btn", id: "tx-center", title: st.at.ground ? "Put the text on the origin" : "Put the text in the middle of the face", onclick: () => { setUV(0, 0); after(); } }, "Center")));
          body.append(el("div", { class: "subhead" }, st.at.ground ? "Position (from the origin)" : "Position (from the face center)"), p3);
        }
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "tx-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; } }), "Snap to face centers and the grid (" + withUnit(gridMM(), 3) + ")"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "The text is its own body: use Combine (Join) to make it one part with the shape, or try Decorate › Emboss text. A small Sink (0.2 mm) helps it join cleanly."));
      },
      start() { schedulePreview(def); draw(); },
      handler: {
        hover(e) {
          if (st.placed || st.dragging) return;
          const a = pick(e); if (!a) return;
          st.at = a; schedulePreview(def); draw();
        },
        down(e) {
          const a = pick(e); if (!a) return true;
          st.at = a; st.placed = true; st.dragging = true;
          schedulePreview(def); draw();
          return true;
        },
        move(e) {
          if (!st.dragging) return;
          const a = pick(e); if (!a) return;
          st.at = a; schedulePreview(def); draw();
        },
        up() { if (!st.dragging) return; st.dragging = false; def.render(); draw(); },
      },
      arrowKey(e) {
        if (!st.placed) return false;
        const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (st.snap ? gridMM() : 1);
        const dx = e.key === "ArrowLeft" ? -k : e.key === "ArrowRight" ? k : 0, dy = e.key === "ArrowUp" ? k : e.key === "ArrowDown" ? -k : 0;
        st.at.p.addScaledVector(st.at.x, dx).addScaledVector(upOf(st.at), dy);
        after();
        return true;
      },
    };
    function after() { def.render(); schedulePreview(def); draw(); }
    function draw() {
      clearOv();
      if (!st.at) return;
      const [w, h] = textSize(st.str, st.size, st.font);
      const lift = st.at.n.clone().multiplyScalar(st.h + 0.05);
      drawTextGhost(st.at.p.clone().add(lift), st.at.x, upOf(st.at), w, h, st.angle || 0, st.placed ? 0x1f4fa8 : 0xe8a317);
      if (st.at.c && st.placed) drawDot(st.at.c, 0x7fa6e0, 7);
      vp.request();
    }
    openCmd(def);
  }
  function placeOn(e, ignore) {
    const g = app.gridStep();
    const hit = scene.pickFace(e, (b) => b.id !== ignore && !b.hole);
    if (hit) {
      if (hit.normal.z > 0.999) return new THREE.Matrix4().makeTranslation(round(hit.point.x, g), round(hit.point.y, g), hit.point.z);
      return frameOnFace(hit.point, hit.normal);
    }
    const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    return p ? new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0) : null;
  }

  // ------------------------------------------------------------------ edit / delete features
  function editBody(b) {
    if (b.locked) { app.toast("This body is locked. Unlock it to edit (Ctrl+L)."); return; }
    if (b.node.t === "prim" && b.node.kind === "text") textCmd(b.id);
    else if (b.node.t === "prim") primCmd(b.node.kind, b.id);
    else if (b.node.t === "extrude" || b.node.t === "revolve" || b.node.t === "sweep") extrudeCmd(b.node.t, { body: b.id });
    else if (b.node.t === "pipe") pipeCmd({ body: b.id });
    else if (b.node.t === "coil") coilCmd({ body: b.id });
    else if (b.node.t === "loft") loftCmd({ body: b.id });
    else if (b.node.t === "mirror") app.toast("A mirror follows its original body. Edit the original, or delete the mirror and make a new one.");
    else if (b.node.t === "group") combineInfo(b);
    else if (b.sculpt) app.toast("This is a sculpt: switch to Chisel to keep sculpting it. Here you can move it, scale it or cut holes in it.");
    else if (b.node.t === "mesh" || b.node.t === "step") app.toast("This is an imported model: move it, scale it, cut holes in it or add features to it.");
  }
  function editPlane(id) {
    const p = (store.doc.planes || []).find((q) => q.id === id);
    if (!p) return;
    if (p.kind === "offset") offsetPlaneCmd(id);
    else if (p.kind === "angle") anglePlaneCmd(id);
    else app.toast("A midplane can't be edited. Delete it and make a new one.");
  }
  function editItem(it) {
    if (it.kind === "sketch") { app.enterSketch(it.sketch); return; }
    if (it.kind === "plane") { editPlane(it.plane); return; }
    if (it.kind === "joint") { jointCmd(it.joint); return; }
    const b = findBody(store.doc, it.body);
    if (!b) return;
    if (b.locked) { app.toast("This body is locked. Unlock it to edit (Ctrl+L)."); return; }
    if (it.tex) return textureCmd({ body: b.id, tex: it.tex });
    if (!it.mod) return editBody(b);
    const m = b.node.mods.find((x) => x.id === it.mod);
    if (m.t === "fillet" || m.t === "chamfer") edgeCmd(m.t, { body: b.id, mod: m.id });
    else if (m.t === "hole") holeCmd({ body: b.id, mod: m.id });
    else if (m.t === "shell") shellCmd({ body: b.id, mod: m.id });
    else if (m.t === "offset") offsetCmd({ body: b.id, mod: m.id });
    else if (m.t === "thread") threadCmd({ body: b.id, mod: m.id });
    else if (m.t === "scale") scaleCmd({ body: b.id, mod: m.id });
    else if (m.t === "emboss") embossCmd({ body: b.id, mod: m.id });
    else if (m.t === "facepat") facePatternCmd({ body: b.id, mod: m.id });
    else if (m.t === "pattern") patternCmd({ body: b.id, mod: m.id }); // jumpstart-3d: pattern
    else if (m.t === "keeppiece") app.toast(`This body keeps piece ${m.piece + 1} of ${m.count}. Its earlier features are independent copies. Undo Combine or Group to restore the inputs.`); // jumpstart-3d: split pieces
    else if (m.t === "halfspace" || m.t === "sketchsplit" || m.t === "splitface") app.toast(m.t !== "splitface" ? "A split can't be edited. Undo it, or delete it from the timeline and split again." : "A face split can't be edited. Delete it from the timeline and split again.");
    else if (m.t === "bool" && m.src === "combine") combineCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "pipe") pipeCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "coil") coilCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "loft") loftCmd({ body: b.id, mod: m.id });
    else if (m.t === "bool" && m.tool.t === "mirror") app.toast("This mirror join is fixed. Delete it from the timeline and mirror again to change it.");
    else if (m.t === "bool") extrudeCmd(m.tool.t, { body: b.id, mod: m.id });
  }
  function combineInfo(b) {
    const def = {
      title: b.node.op === "intersect" ? "Intersect" : "Combine",
      okLabel: "Done",
      ok() { closeCmd(false); },
      build(body) {
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `${b.name} combines ${b.node.children.length} bodies: ${b.node.children.map((c) => (c.hole ? "−" : "+") + " " + (c.name || "body")).join(", ")}.`));
        body.append(el("button", { class: "btn", onclick: () => {
          if ((b.node.mods || []).length) { app.toast("Delete the features on this body first, then undo the combine.", "err"); return; }
          closeCmd(false); app.select(ungroupBody(b.id));
        } }, "Split back into bodies"));
      },
    };
    openCmd(def);
  }
  function deleteFeature(it) {
    closeCmd(false);
    if (it.sketch) {
      const users = store.doc.bodies.filter((b) => JSON.stringify(b.node).includes(`"sketch":"${it.sketch}"`)).length;
      store.update((doc) => { doc.sketches = doc.sketches.filter((s) => s.id !== it.sketch); }, "Delete sketch");
      if (users) app.toast(`${users} feature${users > 1 ? "s" : ""} used this sketch and can no longer rebuild. Undo to bring it back.`, "err");
      return;
    }
    if (it.plane) { store.update((doc) => { doc.planes = doc.planes.filter((x) => x.id !== it.plane); }, "Delete plane"); return; }
    if (it.joint) { store.update((doc) => { doc.joints = doc.joints.filter((x) => x.id !== it.joint); }, "Delete joint"); return; }
    if (it.tex) { store.update((doc) => { const b = findBody(doc, it.body); b.textures = (b.textures || []).filter((x) => x.id !== it.tex); }, "Remove texture"); return; }
    if (!it.mod) { deleteBodies([it.body]); return; }
    // jumpstart-3d: a piece selector depends on the Combine that produced its pieces.
    if (hasLaterKeepPiece(findBody(store.doc, it.body)?.node.mods, it.mod)) {
      app.toast("Delete the split pieces, or undo Combine to restore the inputs.", "err");
      return;
    }
    store.update((doc) => {
      const b = findBody(doc, it.body);
      const gone = b.node.mods.find((m) => m.id === it.mod);
      b.node.mods = b.node.mods.filter((m) => m.id !== it.mod);
      // deleting a Combine brings back the tool bodies it used up
      if (gone && gone.src === "combine" && gone.tools) for (const t of gone.tools) if (!findBody(doc, t.id)) doc.bodies.push(clone(t));
    }, "Delete feature");
  }

  // ------------------------------------------------------------------ ribbon
  let workspace = "design";
  let edgeTool = "fillet"; // the Edge tools button runs the last one used
  function renderRibbon() {
    ribbon.innerHTML = "";
    const group = (title, cls, items) => {
      const g = el("div", { class: "rgroup " + (cls || "") });
      const r = el("div", { class: "rrow" });
      for (const it of items) {
        const b = el("button", { class: "rbtn " + (it.cls || ""), id: it.id, title: it.title || it.label, "aria-pressed": it.pressed ? "true" : null, html: ICON[it.icon] });
        b.append(el("span", {}, it.label));
        b.onclick = it.fn;
        if (it.dropdown) {
          // a plain drop-down: the button only opens its list
          b.classList.add("rdrop");
          b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
          b.querySelector("span").append(el("i", { class: "dcaret", html: '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
          b.onclick = (e) => { e.stopPropagation(); openRibbonMenu(b, it.dropdown); };
          r.append(b);
          continue;
        }
        if (!it.menu) { r.append(b); continue; }
        // split button: the main part runs the current choice, the arrow opens the list
        const caret = el("button", { class: "rcaret", id: it.id + "-more", title: "More " + it.label.toLowerCase() + " types", "aria-label": "More " + it.label.toLowerCase() + " types", "aria-haspopup": "menu", "aria-expanded": "false", html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
        caret.onclick = (e) => { e.stopPropagation(); openRibbonMenu(caret, it.menu); };
        r.append(el("div", { class: "rsplit" + (it.pressed ? " on" : "") }, b, caret));
      }
      g.append(r, el("div", { class: "rtitle" }, title));
      ribbon.append(g);
    };
    if (sketcher.active) {
      const tool = sketcher.tool;
      const t = (k, icon) => ({ id: "sk-" + k, label: SKETCH_TOOLS[k].label.replace("2-point rectangle", "Rectangle").replace("Center rectangle", "Ctr rect").replace("Center circle", "Circle").replace("3-point arc", "Arc").replace("Center arc", "Ctr arc"), title: SKETCH_TOOLS[k].label + (SKETCH_TOOLS[k].key ? ` (${SKETCH_TOOLS[k].key})` : ""), icon: icon || k, pressed: tool === k, fn: () => sketcher.setTool(k) });
      const rectKind = ["rect", "rect3", "rectc"].includes(tool) ? tool : sketcher.rectMode || "rect";
      const RECT_NAMES = { rect: "2-point rectangle", rect3: "3-point rectangle", rectc: "Center rectangle" };
      const rectItem = { id: "sk-rect", label: "Rectangle", title: RECT_NAMES[rectKind] + " (R)", icon: rectKind, pressed: ["rect", "rect3", "rectc"].includes(tool), fn: () => sketcher.setTool(rectKind),
        menu: ["rect", "rect3", "rectc"].map((k) => ({ id: "sk-" + k, label: RECT_NAMES[k], icon: k, on: tool === k, fn: () => sketcher.setTool(k) })) };
      group("Create", "sketch", [t("line"), rectItem, t("circle"), t("arc3"), t("arcc"), t("polygon"), t("spline"), t("point"), t("text")]);
      group("Insert", "sketch", [
        { id: "sk-insert", label: "Insert", title: "Insert an SVG, DXF or picture into this sketch", icon: "import", dropdown: [
          { id: "sk-ins-svg", label: "SVG drawing", title: "Insert an SVG drawing into this sketch", icon: "svgfile", fn: () => app.insertFile("svg") },
          { id: "sk-ins-dxf", label: "DXF drawing", title: "Insert a DXF drawing into this sketch", icon: "dxffile", fn: () => app.insertFile("dxf") },
          { id: "sk-ins-img", label: "Image to trace", title: "Place a picture on this sketch plane to trace over", icon: "image", fn: () => app.insertFile("image") },
        ] },
      ]);
      const CICON = { coincident: "cCoincident", horizontal: "cHorizontal", vertical: "cVertical", parallel: "cParallel", perpendicular: "cPerpendicular", tangent: "cTangent", concentric: "cConcentric", equal: "cEqual", midpoint: "cMidpoint" };
      const cTool = tool.startsWith("c-") ? tool : null;
      group("Constrain", "sketch", [
        { id: "sk-constraints", label: "Constraints", title: "Keep lines horizontal, parallel, tangent, equal… (select shapes first, or pick after choosing)", icon: "constraints", pressed: !!cTool, dropdown: Object.keys(CICON).map((k) => ({ id: "sk-c-" + k, label: SKETCH_TOOLS["c-" + k].label.replace(" constraint", ""), icon: CICON[k], on: tool === "c-" + k, fn: () => sketcher.setTool("c-" + k) })) },
      ]);
      group("Modify", "sketch", [t("trim"), t("dim"), { id: "sk-cons", label: "Construction", title: "Toggle construction (X)", icon: "construction", fn: () => sketcher.toggleConstruction() }, t("select")]);
      group("Finish", "sketch", [{ id: "sk-extrude", label: "Extrude", title: "Extrude this sketch now, without finishing it first (E)", icon: "extrude", fn: () => app.quickExtrude() }, { id: "sk-finish", label: "Finish sketch", icon: "finish", cls: "finish", fn: () => app.exitSketch() }]);
      ribbon.append(el("div", { class: "note", id: "sk-note" }, "Profiles shade blue when closed.")); // jumpstart-3d: parameters (the id; showDofNote fills it)
      showDofNote(); // jumpstart-3d: parameters
      return;
    }
    ribbon.append(el("div", { class: "wstabs", role: "tablist", "aria-label": "Workspace" },
      ...[["design", "Design"], ["print", "3D Print Sim"], ["simulate", "Simulate"]].map(([w, label]) => el("button", { role: "tab", id: "ws-" + w, "aria-selected": workspace === w ? "true" : "false", onclick: () => setWorkspace(w) }, label))));
    if (workspace === "print") {
      group("Plate", "", [
        { id: "ps-r-auto", label: "Auto orient", title: "Turn the part to need the least support", icon: "printer3d", fn: () => psim.autoOrient() },
        { id: "ps-r-lay", label: "Lay on face", title: "Click a face to put it on the plate", icon: "drop", fn: () => psim.layFace() },
        { id: "ps-r-rx", label: "Rotate X", title: "Turn 90° about X", icon: "revolve", fn: () => psim.rotate("x") },
        { id: "ps-r-ry", label: "Rotate Y", title: "Turn 90° about Y", icon: "revolve", fn: () => psim.rotate("y") },
      ]);
      group("Preview", "", [
        { id: "ps-r-model", label: "Model", title: "Part, overhangs and supports", icon: "body", pressed: psim.st.view === "model", fn: () => { psim.setView("model"); renderRibbon(); } },
        { id: "ps-r-layers", label: "Layers", title: "Layer-by-layer print preview", icon: "pattern", pressed: psim.st.view === "layers", fn: () => { psim.setView("layers"); renderRibbon(); } },
        { id: "ps-r-strength", label: "Strength", title: "Strong and weak spots of the print", icon: "stress", pressed: psim.st.view === "strength", fn: () => { psim.setView("strength"); renderRibbon(); } },
      ]);
      group("Print", "", [
        { id: "ps-r-play", label: "Play print", title: "Watch the part being printed, layer by layer", icon: "motion", fn: () => { psim.togglePlay(); renderRibbon(); } },
      ]);
      ribbon.append(el("div", { class: "note" }, "Simulation only: no G-code is made."));
      return;
    }
    if (workspace === "simulate") {
      group("Joints", "", [
        { id: "sim-joint", label: "Joint", title: "Connect two parts so one can turn or slide", icon: "joint", fn: () => sim.jointCmd() },
        { id: "sim-drive", label: "Drive", title: "Move a joint by hand", icon: "drive", fn: () => sim.driveCmd() },
      ]);
      group("Motion", "", [
        { id: "sim-motion", label: "Motion study", title: "Animate joints and check for collisions", icon: "motion", fn: () => sim.motionCmd() },
      ]);
      group("Analysis", "", [
        { id: "sim-stress", label: "Stress test", title: "Load or pressure test: stress, deflection and safety factor", icon: "stress", fn: () => sim.stressCmd() },
        { id: "sim-print", label: "Print strength", title: "3D-print strength by filament and print orientation", icon: "printer3d", fn: () => sim.printCmd() },
      ]);
      group("Visualize", "", [
        { id: "sim-render", label: "Render", title: "Make a photo-style picture of your design (PNG)", icon: "render", fn: () => renderCmd() },
      ]);
      group("Convert", "", [
        { id: "sim-meshstep", label: "Mesh to STEP", title: "Mesh to STEP Helper: turn an STL or 3MF mesh into an editable STEP solid, then open it here", icon: "import", fn: () => app.meshstep.open() },
      ]);
      group("Bricks", "", [
        { id: "sim-bricks", label: "Jump Brick Builder", title: "Rebuild the selected objects (or all) out of stud-and-tube building bricks you can print, press together and take apart", icon: "bricks", fn: () => app.bricks.open() },
      ]);
      group("CAM", "", [
        { id: "sim-cam", label: "CAM Studio", title: "Plan and simulate cutting the design on a CNC router, mill or laser, then save or send the G-code (your design is not changed)", icon: "cam", fn: () => app.cam.open() },
      ]);
      group("Voxels", "", [
        { id: "sim-voxel", label: "Voxel Studio", title: "Turn the selected objects (or all) into cubes you can paint face by face, then export STL or 3MF or add them to the design (your design is not changed until you add it)", icon: "voxel", fn: () => app.voxel.open() },
      ]);
      group("Flexi", "", [
        { id: "sim-flexigen", label: "FlexiGen", title: "Turn one object into a print-in-place articulated flexi model (your design is not changed)", icon: "flexigen", fn: () => flexiGenCmd() },
      ]);
      group("Pose", "", [
        { id: "sim-reset", label: "Reset pose", title: "Put moved parts back", icon: "clearSim", fn: () => sim.resetPose() },
        { id: "sim-apply", label: "Apply pose", title: "Keep the moved positions in the design", icon: "move", fn: () => sim.applyPose() },
      ]);
      ribbon.append(el("button", { class: "ibtn panel-toggle", style: { alignSelf: "center" }, onclick: () => browser.classList.toggle("collapsed") }, el("span", { class: "lbl" }, "Browser")));
      return;
    }
    group("Create", "", [
      { id: "ad-sketch", label: "Sketch", title: "Create sketch (S)", icon: "sketch", fn: () => createSketchCmd() },
      { id: "ad-extrude", label: "Extrude", title: "Extrude (E)", icon: "extrude", fn: () => extrudeCmd("extrude") },
      { id: "ad-sketch3d", label: "3D Sketch", title: "Draw lines in 3D on a body, a virtual sphere or cube, or in the air, with a split camera view. Works with touch, pen, mouse and trackpad.", icon: "spline", fn: () => app.sketch3d.open() },
      { id: "ad-lathe", label: "Lathe", title: "Turn a body or a wood blank on a virtual lathe with chisels (Space is the pedal), then hollow it out. The result is a mesh body.", icon: "lathe", fn: () => app.lathe.open() },
      { id: "ad-hole", label: "Hole", title: "Hole (H): simple, counterbore, countersink or tapped, with standard screw sizes", icon: "hole", fn: () => holeCmd() },
      { id: "ad-features", label: "Advanced Create", title: "Revolve, sweep, pipe, coil, loft, mirror, hole and thread", icon: "features", dropdown: [
        { id: "ad-revolve", label: "Revolve", title: "Revolve (Shift+R)", icon: "revolve", fn: () => extrudeCmd("revolve") },
        { id: "ad-sweep", label: "Sweep", title: "Sweep a profile along a path", icon: "sweep", fn: () => extrudeCmd("sweep") },
        { id: "ad-pipe", label: "Pipe", title: "A round, square or triangular tube along a path", icon: "pipe", fn: () => pipeCmd() },
        { id: "ad-coil", label: "Coil", title: "Springs and spirals", icon: "coil", fn: () => coilCmd() },
        { id: "ad-loft", label: "Loft", title: "Blend between profiles on different planes (square to circle, to a point, along a centerline…)", icon: "loft", fn: () => loftCmd() },
        { id: "ad-mirror", label: "Mirror", title: "Mirror bodies across a plane or flat face", icon: "mirror", fn: () => mirrorCmd() },
        { id: "ad-hole-m", label: "Hole", title: "Hole (H)", icon: "hole", fn: () => holeCmd() },
        { id: "ad-holepattern", label: "Hole pattern", title: "Rows, staggered rows or a circle of round, square, hex or slot holes on a flat face", icon: "hole", fn: () => holePattern.cmd() }, // jumpstart-3d: hole pattern
        { id: "ad-thread", label: "Thread", title: "Modeled metric (ISO) and inch (UNC / UNF) threads on round faces", icon: "thread", fn: () => threadCmd() },
        { id: "ad-thread-offset", label: "Thread print offset…", title: "Loosen printed threads", icon: "thread", fn: () => threadOffsetCmd() },
        { id: "ad-fastener", label: "Fastener", title: "Bolts, nuts, threaded rods and tap cutters, metric and inch", icon: "thread", fn: () => fasteners.cmd() }, // jumpstart-3d: fasteners
        { id: "ad-gear", label: "Gear", title: "Spur gears, bevel gears and racks by module and tooth count", icon: "gear", fn: () => gears.cmd() }, // jumpstart-3d: gears
        { id: "ad-nameplate", label: "Name plate", title: "A tag or name plate sized to its text, with raised or cut-in letters", icon: "tag", fn: () => namePlate.cmd() }, // jumpstart-3d: name plates
        { id: "ad-knurl", label: "Knurled knob", title: "A knob or grip with straight V grooves all round and an optional round, hex or D bore", icon: "knurl", fn: () => knurl.cmd() }, // jumpstart-3d: knurl
        { id: "ad-spring", label: "Spring", title: "A compression spring of round wire, with open ends or ends cut flat", icon: "spring", fn: () => spring.cmd() }, // jumpstart-3d: spring
      ] },
      { id: "ad-prims", label: "Primitives", title: "Box, cylinder, sphere, torus, prism and more", icon: "box", dropdown: [
        { id: "ad-box", label: "Box", icon: "box", fn: () => primCmd("box") },
        { id: "ad-cyl", label: "Cylinder", icon: "cylinder", fn: () => primCmd("cylinder") },
        { id: "ad-sphere", label: "Sphere", icon: "sphere", fn: () => primCmd("sphere") },
        { id: "ad-torus", label: "Torus", icon: "torus", fn: () => primCmd("torus") },
        { id: "ad-prism", label: "Prism", title: "Prism with 3 to 24 sides", icon: "prism", fn: () => primCmd("prism") },
        { id: "ad-cone", label: "Cone", icon: "cone", fn: () => primCmd("cone") },
        { id: "ad-pyramid", label: "Pyramid", icon: "pyramid", fn: () => primCmd("pyramid") },
        { id: "ad-tube", label: "Tube", icon: "tube", fn: () => primCmd("tube") },
        { id: "ad-capsule", label: "Capsule", icon: "capsule", fn: () => primCmd("capsule") },
        { id: "ad-text3d", label: "3D text", title: "Text that sits on any face or the workplane: drag it into place", icon: "text", fn: () => textCmd() },
      ] },
    ]);
    group("Construct", "", [
      { id: "ad-construct", label: "Planes", title: "Construction planes", icon: "planeOffset", dropdown: [
        { id: "ad-plane-off", label: "Offset plane", title: "Plane parallel to a plane or face", icon: "planeOffset", fn: () => offsetPlaneCmd() },
        { id: "ad-plane-ang", label: "Plane at angle", title: "Plane through an axis or edge, at an angle", icon: "planeAngle", fn: () => anglePlaneCmd() },
        { id: "ad-plane-mid", label: "Midplane", title: "Plane halfway between two faces", icon: "planeMid", fn: () => midPlaneCmd() },
      ] },
    ]);
    group("Insert", "", [
      { id: "ad-insert", label: "Insert", title: "Insert an SVG, DXF or picture", icon: "import", dropdown: [
        { id: "ad-ins-svg", label: "SVG drawing", title: "Insert an SVG drawing as a sketch", icon: "svgfile", fn: () => insertFile("svg") },
        { id: "ad-ins-dxf", label: "DXF drawing", title: "Insert a DXF drawing as a sketch", icon: "dxffile", fn: () => insertFile("dxf") },
        { id: "ad-ins-img", label: "Image to trace", title: "Place a picture to trace over (canvas)", icon: "image", fn: () => insertFile("image") },
        { id: "ad-ins-model", label: "STL / OBJ / 3MF / STEP model", title: "Import a 3D model: an STL, OBJ or 3MF mesh, or a STEP solid", icon: "import", fn: () => insertFile("model") }, // jumpstart-3d: OBJ import
      ] },
    ]);
    group("Modify", "", [
      { id: "ad-moverot", label: "Move / Rotate", title: "Move or turn the selected shape in 3D: drag an arrow to move, a ring to turn, or type exact values", icon: "move", fn: () => moveCmd({ drag: "screen" }) }, // jumpstart-3d: rotation access
      { id: "ad-edge", label: edgeTool === "chamfer" ? "Chamfer" : "Fillet", title: "Edge tools: round (fillet) or bevel (chamfer) edges. The arrow switches tools.", icon: edgeTool, fn: () => edgeCmd(edgeTool),
        menu: [
          { id: "ad-fillet", label: "Fillet", title: "Round edges (F)", icon: "fillet", on: edgeTool === "fillet", fn: () => { edgeTool = "fillet"; renderRibbon(); edgeCmd("fillet"); } },
          { id: "ad-chamfer", label: "Chamfer", title: "Bevel edges (C)", icon: "chamfer", on: edgeTool === "chamfer", fn: () => { edgeTool = "chamfer"; renderRibbon(); edgeCmd("chamfer"); } },
        ] },
      { id: "ad-offset", label: "Offset face", title: "Offset face / press pull (Q)", icon: "offset", fn: () => offsetCmd() },
      { id: "ad-shell", label: "Shell", icon: "shell", fn: () => shellCmd() },
      { id: "ad-advmod", label: "Advanced Modify", title: "Combine, Split body and Split face", icon: "combine", dropdown: [
        { id: "ad-combine", label: "Combine", title: "Join, cut or intersect bodies (B)", icon: "combine", fn: () => combineCmd() },
        { id: "ad-splitbody", label: "Split body", title: "Cut a body into pieces with a plane, a face or another body", icon: "splitBody", fn: () => splitBodyCmd() },
        { id: "ad-splitface", label: "Split face", title: "Divide faces with a plane or sketch curve (the shape stays the same)", icon: "splitFace", fn: () => splitFaceCmd() },
      ] },
      { id: "ad-pattern", label: "Pattern", title: "Pattern (P)", icon: "pattern", fn: () => patternCmd() },
      { id: "ad-transform", label: "Transform", title: "Move/Copy, Scale and Align", icon: "move", dropdown: [
        { id: "ad-move", label: "Move/Copy", title: "Move / Copy (M)", icon: "move", fn: () => moveCmd() },
        { id: "ad-scale", label: "Scale", title: "Scale a body by typed factors (or drag its white handles)", icon: "scale", fn: () => scaleCmd() },
        { id: "ad-align", label: "Align", title: "Align (A)", icon: "align", fn: () => alignCmd() },
      ] },
      { id: "ad-decorate", label: "Decorate", title: "Surface styling: texture, patterns on faces, emboss text and appearance", icon: "texture", dropdown: [
        { id: "ad-texture", label: "Texture", title: "Surface texture (T)", icon: "texture", fn: () => textureCmd() },
        { id: "ad-facepat", label: "Pattern on face", title: "Raise or cut a hexagon, diamond plate, screen mesh or other pattern on a flat face", icon: "facePattern", fn: () => facePatternCmd() },
        { id: "ad-emboss", label: "Emboss text", title: "Raise or cut text on a flat or curved face", icon: "emboss", fn: () => embossCmd() },
        { id: "ad-appearance", label: "Appearance", title: "Colors and materials for bodies or faces (display only)", icon: "appearance", fn: () => appearanceCmd() },
      ] },
    ]);
    group("Inspect", "", [
      { id: "ad-measure", label: "Measure", title: "Measure sizes, distances and angles (I)", icon: "measure", fn: () => measureCmd() },
      { id: "ad-section", label: "Section Analysis", title: "Cut the view with a plane to look inside your design (the design doesn't change)", icon: "section", fn: () => sectionCmd() },
    ]);
    ribbon.append(el("button", { class: "ibtn panel-toggle", style: { alignSelf: "center" }, onclick: () => browser.classList.toggle("collapsed") }, el("span", { class: "lbl" }, "Browser")));
  }
  // a small drop-down list under a ribbon split button
  function openRibbonMenu(anchor, items) {
    const old = document.getElementById("ribbon-menu");
    if (old) { old.remove(); if (old.dataset.for === anchor.id) { anchor.setAttribute("aria-expanded", "false"); return; } }
    const r = (anchor.closest(".rsplit") || anchor).getBoundingClientRect();
    const menu = el("div", { class: "rmenu", id: "ribbon-menu", role: "menu", "data-for": anchor.id, style: { left: r.left + "px", top: r.bottom + 4 + "px" } },
      ...items.map((it) => {
        const b = it.on === undefined
          ? el("button", { role: "menuitem", id: it.id, title: it.title || null, html: ICON[it.icon] }, el("span", {}, it.label))
          : el("button", { role: "menuitemradio", id: it.id, "aria-checked": it.on ? "true" : "false", html: ICON[it.icon] }, el("span", {}, it.label));
        b.onclick = () => { close(); it.fn(); };
        return b;
      }));
    const close = () => { menu.remove(); anchor.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    document.body.append(menu);
    anchor.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("[aria-checked=true]") || menu.querySelector("button");
    first && first.focus();
  }
  function copySel() {
    const s2 = app.selected();
    if (!s2.length) { app.toast("Select one or more bodies to copy."); return; }
    app.clipboard = clone(s2);
    app.toast(`Copied ${s2.length} bod${s2.length > 1 ? "ies" : "y"}`);
  }
  function pasteClip() {
    if (!app.clipboard || !app.clipboard.length) { app.toast("Nothing copied yet."); return; }
    const g = Math.max(app.gridStep(), 1) * 5, ids = [];
    store.update((doc) => {
      for (const b of app.clipboard) {
        const c = clone(b);
        c.id = uid("b");
        c.seq = nextSeq(doc);
        c.name = nextName(doc, (b.name || "Body").replace(/\s+\d+$/, ""));
        c.m = arr(M4(c.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0)));
        doc.bodies.push(c);
        ids.push(c.id);
      }
    }, "Paste");
    // the next paste lands a bit further on
    app.clipboard = app.clipboard.map((b) => ({ ...b, m: arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0))) }));
    app.select(ids);
  }
  function deleteSelected() {
    if (selSketch) { deleteFeature({ sketch: selSketch }); selSketch = null; return; }
    if (!app.sel.length) return;
    const ids = app.sel.filter((id) => !app.isLocked(id));
    if (ids.length < app.sel.length) app.toast(ids.length ? "Locked bodies were kept." : "That body is locked. Unlock it first (Ctrl+L).");
    if (ids.length) { deleteBodies(ids); app.select(app.sel.filter((id) => !ids.includes(id))); }
  }
  function toggleLock(ids = app.sel) {
    if (!ids.length) return;
    const lock = !ids.every((id) => app.isLocked(id));
    store.update((doc) => { for (const id of ids) { const b = findBody(doc, id); if (b) b.locked = lock; } }, lock ? "Lock" : "Unlock");
    app.toast(lock ? "Locked: it can't be moved, changed or deleted." : "Unlocked");
  }

  // jumpstart-3d: parameters. How constrained a sketch is, from sketchDof's count: null for a sketch with no shapes.
  const dofOf = (sk) => { const r = sketchDof(sk); return r.free ? r : null; };
  const OVER = (n) => `Fully constrained by count; ${n} more constraint${n === 1 ? "" : "s"} than needed, some may fight`;
  // the sketch ribbon's note while editing: the proof line, kept current by refresh()
  function showDofNote() {
    const note = document.getElementById("sk-note"), sk = (store.view.sketches || []).find((s) => s.id === sketcher.active), r = sk && dofOf(sk);
    if (note) note.textContent = !r ? "Profiles shade blue when closed." : r.over < 0 ? OVER(-r.over) : r.dof === 0 ? "Fully constrained" : `${r.dof} degree${r.dof === 1 ? "" : "s"} of freedom left: add dimensions or constraints`;
  }
  const dofBadge = (sk) => { // jumpstart-3d: parameters
    const r = dofOf(sk);
    return !r ? null : el("span", { class: "sk-dof" + (r.dof ? "" : " ok"), title: r.over < 0 ? OVER(-r.over) : r.dof ? `${r.dof} degree${r.dof === 1 ? "" : "s"} of freedom left` : "Fully constrained" }, r.dof ? `${r.dof} free` : "✓");
  };
  // Parameters as a CSV file: one row each, name,expression,unit
  async function exportParamsCsv() {
    const params = store.view.params || [];
    if (!params.length) { app.toast("There are no parameters to save yet."); return; }
    const name = ((store.doc.name || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "design") + "-parameters.csv";
    await app.projects.saveModel(name, new TextEncoder().encode(paramsToCsv(params)));
    app.toast(`Saved ${params.length} parameter${params.length === 1 ? "" : "s"} as ${name}.`);
  }

  // jumpstart-3d: parameters. The Parameters folder (heading with CSV out, CSV in and + , then one row each); the Advanced browser and the Beginner inspector both show it.
  function paramRows(tree) {
    const params = store.view.params || [];
    // re-running applyParams on the new doc changes nothing; it only reports dimensions that could not take the value
    const editParams = (fn, label) => {
      const next = store.update(fn, label), n = next ? applyParams(next) : 0;
      if (n) app.toast(`${n} dimension(s), size(s) or feature value(s) can't take that value`);
    };
    // one undo step takes a whole import back; a name that exists takes the new expression, a new valid name is added
    const importCsv = async () => {
      const f = await pickFile(".csv,text/csv");
      if (!f) return;
      const rows = parseParamsCsv(await f.text());
      let r;
      editParams((d) => { r = importParams(d, rows); if (!r.used) return false; }, "Import parameters");
      const bad = store.doc.params.filter((p) => !isFinite(p.value)).length;
      app.toast(`Imported ${r.used} parameter${r.used === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped` : ""}${bad ? `, ${bad} with errors` : ""}`);
    };
    const tool = (cls, title, label, fn) => el("button", { class: cls, title, "aria-label": title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    tree.append(el("div", { class: "folder" }, `Parameters (${params.length})`,
      el("span", { class: "param-tools" },
        tool("param-csv-out", "Export parameters as CSV", "CSV ↓", exportParamsCsv),
        tool("param-csv-in", "Import parameters from CSV", "CSV ↑", importCsv),
        el("button", { class: "param-add", title: "Add a parameter", "aria-label": "Add a parameter", onclick: (e) => { e.stopPropagation(); editParams((d) => { newParam(d); }, "Add parameter"); } }, "+"))));
    if (!params.length) tree.append(el("div", { class: "empty" }, "Add a parameter, then type its name in a dimension or a size box."));
    for (const p of params) {
      const nm = el("input", { class: "num param-name", value: p.name, title: "Name", "aria-label": "Parameter name" });
      const ex = el("input", { class: "num param-expr", value: p.expr, title: "Value or expression", "aria-label": `Value of ${p.name}` });
      for (const inp of [nm, ex]) inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = inp === nm ? p.name : p.expr; inp.blur(); } };
      nm.onchange = () => {
        const name = nm.value.trim(), err = paramNameOk(name, params, p.id);
        if (err) { app.toast(err); nm.value = p.name; return; }
        if (name !== p.name) editParams((d) => { renameParam(d, p.id, name); }, "Rename parameter");
      };
      ex.onchange = () => editParams((d) => {
        const q = d.params.find((x) => x.id === p.id);
        q.expr = ex.value.trim();
        if (getUnit() !== "mm") q.unit = getUnit(); else delete q.unit;
      }, "Edit parameter");
      const ok = isFinite(p.value);
      tree.append(el("div", { class: "param" }, nm, ex,
        el("span", { class: "pv" + (ok ? "" : " bad"), title: ok ? "" : PARAM_ERROR }, ok ? `${showLen(p.value, 3)} ${getUnit()}` : "error"),
        el("button", { class: "eye", title: "Delete parameter", "aria-label": "Delete " + p.name, html: ICON.del, onclick: () => { let n = 0; store.update((d) => { n = removeParam(d, p.id); }, "Delete parameter"); if (n) app.toast(`${p.name} removed; ${n} dimension(s), size(s) or feature value(s) keep their value`); } })));
    }
  }

  // ------------------------------------------------------------------ browser
  let selSketch = null;
  function renderBrowser() {
    const doc = { ...store.view, bodies: store.view.bodies.filter((b) => !b.cutPreview) };
    browser.innerHTML = "";
    if (workspace === "print") {
      browser.append(el("h3", {}, "3D Print Sim"));
      browser.append(el("div", { class: "hint", style: { padding: "6px 14px" } }, "Your design is locked while you simulate: nothing you do here changes it. Choose the parts to print in the panel on the right."));
      return;
    }
    browser.append(el("h3", {}, "Browser"));
    const tree = el("div", { class: "tree scroll", style: { flex: 1 } });
    tree.append(el("div", { class: "folder" }, `Bodies (${doc.bodies.length})`));
    if (!doc.bodies.length) tree.append(el("div", { class: "empty" }, "No bodies yet."));
    for (const b of doc.bodies) {
      const eye = el("button", { class: "eye", title: b.hidden ? "Show" : "Hide", "aria-label": b.hidden ? "Show " + b.name : "Hide " + b.name, html: b.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { findBody(d, b.id).hidden = !b.hidden; }, b.hidden ? "Show body" : "Hide body"); } });
      const n = el("div", { class: "node" + (app.sel.includes(b.id) ? " sel" : ""), title: b.name }, eye,
        el("span", { class: "swatch", style: { background: b.hole ? "repeating-linear-gradient(135deg,#c2c9d1 0 2px,#fff 2px 4px)" : b.color } }),
        el("span", { class: "nm" }, b.name + (b.hole ? " (hole)" : "")),
        scene.errors.has(b.id) ? el("span", { class: "err-dot", title: scene.errors.get(b.id) }) : null,
        el("button", { class: "eye lockbtn" + (b.locked ? " on" : ""), title: b.locked ? "Unlock" : "Lock", "aria-label": (b.locked ? "Unlock " : "Lock ") + b.name, "aria-pressed": !!b.locked, html: ICON[b.locked ? "lock" : "unlock"], onclick: (e) => { e.stopPropagation(); toggleLock([b.id]); } }));
      n.onclick = (e) => { if (app.command && app.command.pickBody) { app.command.pickBody(b.id); return; } selSketch = null; const add = e.shiftKey || e.ctrlKey || e.metaKey; app.select(add ? (app.sel.includes(b.id) ? app.sel.filter((x) => x !== b.id) : [...app.sel, b.id]) : [b.id]); };
      n.ondblclick = () => editBody(b);
      tree.append(n);
    }
    tree.append(el("div", { class: "folder" }, `Sketches (${doc.sketches.length})`,
      doc.sketches.length ? el("button", { class: "dxf-all", id: "dxf-all", title: "Download every sketch as one DXF file (each sketch on its own layer)", onclick: (e) => { e.stopPropagation(); exportSketchesDXF(null); } }, "DXF ↓ all") : null));
    if (!doc.sketches.length) tree.append(el("div", { class: "empty" }, "Create a sketch to draw profiles."));
    for (const s of doc.sketches) {
      const eye = el("button", { class: "eye", title: s.hidden ? "Show" : "Hide", "aria-label": (s.hidden ? "Show " : "Hide ") + s.name, html: s.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { findSketch(d, s.id).hidden = !s.hidden; }, s.hidden ? "Show sketch" : "Hide sketch"); } });
      const dl = el("button", { class: "eye dxf-one", title: "Download this sketch as DXF", "aria-label": "Download " + s.name + " as DXF", html: ICON.import, onclick: (e) => { e.stopPropagation(); exportSketchesDXF([s.id]); } });
      const n = el("div", { class: "node" + (selSketch === s.id || sketcher.active === s.id ? " sel" : ""), title: "Double-click to edit" }, eye, el("span", { class: "nm" }, s.name + (sketcher.active === s.id ? " (editing)" : "")), dofBadge(s), dl);
      n.onclick = () => { selSketch = s.id; app.select([]); renderBrowser(); };
      n.ondblclick = () => app.enterSketch(s.id);
      tree.append(n);
    }
    paramRows(tree); // jumpstart-3d: parameters
    const planes = doc.planes || [];
    if (planes.length) {
      tree.append(el("div", { class: "folder" }, `Construction (${planes.length})`));
      for (const p of planes) {
        const eye = el("button", { class: "eye", title: p.hidden ? "Show" : "Hide", "aria-label": (p.hidden ? "Show " : "Hide ") + p.name, html: p.hidden ? ICON.eyeOff : ICON.eye, onclick: (e) => { e.stopPropagation(); store.update((d) => { const q = d.planes.find((x) => x.id === p.id); q.hidden = !q.hidden; }, p.hidden ? "Show plane" : "Hide plane"); } });
        const n = el("div", { class: "node", title: "Double-click to edit" }, eye, el("span", { class: "nm" }, p.name),
          el("button", { class: "eye", title: "Delete plane", "aria-label": "Delete " + p.name, html: ICON.del, onclick: (e) => { e.stopPropagation(); store.update((d) => { d.planes = d.planes.filter((x) => x.id !== p.id); }, "Delete plane"); } }));
        n.ondblclick = () => editPlane(p.id);
        tree.append(n);
      }
    }
    const joints = doc.joints || [];
    if (joints.length) {
      tree.append(el("div", { class: "folder" }, `Joints (${joints.length})`));
      for (const j of joints) {
        const n = el("div", { class: "node", title: "Double-click to edit" }, el("span", { class: "eye", html: ICON.joint }), el("span", { class: "nm" }, j.name),
          el("button", { class: "eye", title: "Delete joint", "aria-label": "Delete " + j.name, html: ICON.del, onclick: (e) => { e.stopPropagation(); sim.resetPose(); store.update((d) => { d.joints = d.joints.filter((x) => x.id !== j.id); }, "Delete joint"); } }));
        n.ondblclick = () => jointCmd(j.id);
        tree.append(n);
      }
    }
    browser.append(tree);
    // properties
    const sel = app.selected();
    if (sel.length === 1) {
      const b = sel[0];
      const v = scene.views.get(b.id);
      const box = scene.bodyTightBox(b.id);
      const size = box ? box.getSize(new THREE.Vector3()) : null;
      const dl = el("dl", {},
        el("dt", {}, "Type"), el("dd", { style: { fontFamily: "var(--f-ui)" } }, b.node.t === "prim" ? primName(b.node.kind) : b.node.t === "group" ? "Combined" : b.node.t === "extrude" ? "Extrusion" : "Revolution"),
        el("dt", {}, "Size"), el("dd", {}, size ? `${showLen(size.x, 1)} × ${showLen(size.y, 1)} × ${showLen(size.z, 1)} ${getUnit()}` : "–"),
        el("dt", {}, "Volume"), el("dd", {}, v && v.data && v.data.volume != null ? fmt(v.data.volume / 1000, 3) + " cm³" : "–"),
        el("dt", {}, "Features"), el("dd", {}, String((b.node.mods || []).length)));
      const color = el("input", { type: "color", value: b.color || "#9fb1c4", id: "prop-color", title: "Body color", style: { width: "34px", height: "24px", border: 0, padding: 0, background: "none" } });
      color.onchange = () => store.update((d) => { findBody(d, b.id).color = color.value; }, "Color");
      const name = el("input", { class: "num", value: b.name, id: "prop-name", style: { fontFamily: "var(--f-ui)" } });
      name.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") name.blur(); };
      name.onchange = () => store.update((d) => { findBody(d, b.id).name = name.value.trim() || b.name; }, "Rename");
      browser.append(el("div", { class: "props" }, el("div", { style: { display: "flex", gap: "6px", marginBottom: "8px" } }, name, color), dl,
        el("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" } },
          el("button", { class: "btn", disabled: !!b.locked, onclick: () => editBody(b) }, "Edit"),
          el("button", { class: "btn", id: "prop-lock", onclick: () => toggleLock([b.id]) }, b.locked ? "Unlock" : "Lock"),
          el("button", { class: "btn danger", disabled: !!b.locked, onclick: () => deleteSelected() }, "Delete"))));
    } else if (selSketch) {
      const s = findSketch(doc, selSketch);
      if (s) browser.append(el("div", { class: "props" }, el("dl", {}, el("dt", {}, "Profiles"), el("dd", {}, String(regionsFor(s).length)), el("dt", {}, "Curves"), el("dd", {}, String(s.ents.length))),
        el("div", { style: { display: "flex", gap: "6px", marginTop: "8px" } }, el("button", { class: "btn", onclick: () => app.enterSketch(s.id) }, "Edit sketch"), el("button", { class: "btn", id: "prop-move-sketch", onclick: () => moveCmd() }, "Move/Copy"), el("button", { class: "btn danger", onclick: () => deleteSelected() }, "Delete"))));
    }
  }

  // ------------------------------------------------------------------ timeline
  const TL_ICON = { sketch: "sketch", prim: "prim", extrude: "extrude", revolve: "revolve", fillet: "fillet", chamfer: "chamfer", hole: "hole", shell: "shell", offset: "offset", combine: "combineIcon", bool: "extrude", thread: "thread", scale: "scale", texture: "texture", sweep: "sweep", pipe: "pipe", coil: "coil", loft: "loft", mirror: "mirror", keeppiece: "splitBody", halfspace: "splitBody", sketchsplit: "splitBody", splitface: "splitFace", emboss: "emboss", facepat: "facePattern", plane: "planeOffset", joint: "joint", pattern: "pattern" }; // jumpstart-3d: pattern
  let lastTl = null, lastTlT = 0;
  function renderTimeline() {
    tl.innerHTML = "";
    tl.classList.toggle("locked", workspace === "print");
    tl.append(el("span", { class: "tl-title" }, "Timeline"));
    const items = timeline(store.view);
    if (!items.length) tl.append(el("span", { class: "empty" }, "Features appear here as you build. Double-click one to edit it."));
    for (const it of items) {
      const err = it.body && scene.errors.has(it.body);
      const b = el("button", { class: "tl-item" + (err ? " err" : ""), title: `${it.label}${err ? " — " + scene.errors.get(it.body) : ""}\nDouble-click (or tap twice) to edit`, "aria-label": it.label, html: ICON[TL_ICON[it.kind]] || ICON.prim });
      b.onclick = () => {
        const key = it.mod || it.body || it.sketch;
        if (lastTl === key && performance.now() - lastTlT < 2500 && vp.touchMode) { lastTl = null; editItem(it); return; }
        lastTl = key; lastTlT = performance.now();
        if (it.body) { selSketch = null; app.select([it.body]); }
        else if (it.sketch) { selSketch = it.sketch; app.select([]); renderBrowser(); }
      };
      b.ondblclick = () => editItem(it);
      tl.append(b);
    }
    tl.scrollLeft = tl.scrollWidth;
  }

  // ------------------------------------------------------------------ sketch palette
  function renderPalette() {
    if (!sketcher.active || app.command) { palette.hidden = true; return; }
    palette.hidden = false;
    palette.innerHTML = "";
    const sk = sketcher.sketch;
    palette.append(el("header", {}, el("h4", {}, "Sketch palette · " + (sk ? sk.name : ""))));
    const body = el("div", { class: "body" });
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-snap", checked: sketcher.snapOn, onchange: (e) => { sketcher.snapOn = e.target.checked; } }), (sketcher.snapOn ? "Snap to grid points (" + withUnit(sketcher.gridSpacing(), 3) + " at this zoom)" : "Snap to grid points")));
    if (sketcher.tool === "select") body.append(el("div", { class: "hint", id: "pal-select-hint", style: { padding: "2px 0 6px" } }, "Editing: click a line, circle or arc to type its size (it becomes a dimension). Drag shapes to move them. Double-click a dimension to change it."));
    if (["rect", "rect3", "rectc"].includes(sketcher.tool)) body.append(row("Rectangle", seg([["rect", "2-point"], ["rect3", "3-point"], ["rectc", "Center"]], sketcher.tool, (v) => sketcher.setTool(v), "pal-rect")));
    if (sk && sk.image) {
      const im = sk.image;
      const setImg = (patch, label = "Edit image") => store.update((doc) => { const s2 = findSketch(doc, sk.id); if (s2 && s2.image) Object.assign(s2.image, patch); }, label);
      body.append(el("div", { class: "subhead" }, "Image · " + (im.name || "picture")));
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Width", app.numField({ value: im.w, id: "pal-imw", min: 0.1, onCommit: (v) => setImg({ w: v, h: +((v * im.h) / im.w).toFixed(4) }, "Size picture") })));
      r3.append(el("label", {}, "Height", app.numField({ value: im.h, id: "pal-imh", len: true, min: 0.1, onCommit: (v) => setImg({ h: v, w: +((v * im.w) / im.h).toFixed(4) }, "Size picture") })));
      r3.append(el("label", {}, "Turn °", app.numField({ value: im.rot || 0, id: "pal-imr", angle: true, onCommit: (v) => setImg({ rot: v }, "Turn picture") })));
      body.append(r3);
      const r3b = el("div", { class: "row3" });
      r3b.append(el("label", {}, "X", app.numField({ value: im.cx, id: "pal-imx", onCommit: (v) => setImg({ cx: v }) })));
      r3b.append(el("label", {}, "Y", app.numField({ value: im.cy, id: "pal-imy", onCommit: (v) => setImg({ cy: v }) })));
      body.append(r3b);
      body.append(el("div", { class: "pal-btns" },
        el("button", { class: "btn", id: "pal-imfit", title: "Drag handles to scale, stretch, turn or move the picture, or scale it from a length you know", onclick: () => pictureCmd(sk.id) }, "Size & place…"),
        el("button", { class: "btn", id: "pal-imtrace", title: "Turn the picture's shapes into sketch outlines you can extrude", onclick: () => traceCmd(sk.id) }, "Auto trace…"),
        el("button", { class: "btn", id: "pal-im3d", style: { gridColumn: "1 / -1" }, title: "Puff the picture's subject up into a rounded 3D model with the picture painted on", onclick: () => puffyCmd(sk.id) }, "Picture to 3D model…")));
      let opT = 0;
      body.append(sliderRow("Opacity", "pal-imop", Math.round(im.opacity * 100), 5, 100, 1, "%", (v) => { clearTimeout(opT); opT = setTimeout(() => setImg({ opacity: v / 100 }), 120); }));
      body.append(el("button", { class: "btn", id: "pal-imdel", onclick: () => store.update((doc) => { const s2 = findSketch(doc, sk.id); if (s2) delete s2.image; }, "Remove image") }, "Remove image"));
    }
    if (sketcher.tool === "polygon") body.append(row("Sides", app.numField({ value: sketcher.polySides, id: "pal-sides", min: 3, max: 64, step: 1, onCommit: (v) => { sketcher.polySides = Math.round(v); } }), "pal-sides"));
    const ids = [...sketcher.sel];
    if (ids.length === 1 && sk) {
      const id = ids[0];
      if (id.startsWith("pt:")) {
        const p = sk.pts.find((q) => q.id === id.slice(3));
        if (p) {
          const r3 = el("div", { class: "row3" });
          r3.append(el("label", {}, "X", app.numField({ value: p.x, id: "pal-px", onCommit: (v) => sketcher.setPointProps(p.id, v, p.y) })));
          r3.append(el("label", {}, "Y", app.numField({ value: p.y, id: "pal-py", onCommit: (v) => sketcher.setPointProps(p.id, p.x, v) })));
          body.append(el("div", { class: "subhead" }, "Point"), r3);
        }
      } else if (sk.ents.find((x) => x.id === id && x.t === "text")) {
        const ent = sk.ents.find((x) => x.id === id);
        const p = sk.pts.find((q) => q.id === ent.p) || { x: 0, y: 0 };
        body.append(el("div", { class: "subhead" }, "Text"));
        const txt = el("input", { class: "num", id: "pal-text", value: ent.str || "", style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
        txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") txt.blur(); });
        txt.addEventListener("change", () => sketcher.setEntProps(id, { str: txt.value }));
        body.append(txt);
        body.append(textFontSelect(ent.font || "sans", (v) => sketcher.setEntProps(id, { font: v }), "pal-font"));
        const f = (label, value, key, opts = {}) => el("label", {}, label, app.numField({ value, id: "pal-" + key, ...opts, onCommit: (v) => sketcher.setEntProps(id, { [key]: v }) }));
        body.append(el("div", { class: "row3" }, f("Size", ent.size || 10, "size", { min: 0.1 }), f("Angle °", ent.angle || 0, "angle"), el("span")));
        body.append(el("div", { class: "row3" }, f("X", p.x, "x"), f("Y", p.y, "y"), el("span")));
        const onFace = !!sk.faceCenter;
        body.append(row(onFace ? "Center on face" : "Center on origin", el("div", { class: "seg", id: "pal-tcenter" },
          el("button", { id: "pal-tc-both", onclick: () => sketcher.centerText(id, "both"), title: "Put the middle of the text on the " + (onFace ? "face center" : "origin") }, "Both"),
          el("button", { id: "pal-tc-h", onclick: () => sketcher.centerText(id, "h") }, "↔ Across"),
          el("button", { id: "pal-tc-v", onclick: () => sketcher.centerText(id, "v") }, "↕ Up")), "pal-tcenter"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-tsnap", checked: app.snapOn, onchange: (e) => app.setSnap(e.target.checked) }), "Snap while dragging (" + (onFace ? "face center, " : "") + "points, shape centers, grid)"));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Size is the height of capital letters. Drag the text to move it: its middle snaps into place. Hold Alt (Option) while dragging, or turn Snap off, to move it freely. Arrow keys nudge it (Shift ×10, Alt ×0.1)."));
      } else {
        const c = resolveSketch(sk).find((x) => x.id === id);
        const ent = sk.ents.find((x) => x.id === id);
        if (c && ent) {
          const f = (label, value, key, opts = {}) => el("label", {}, label, app.numField({ value, id: "pal-" + key, ...opts, onCommit: (v) => sketcher.setEntProps(id, { [key]: v }) }));
          if (c.t === "spline") {
            body.append(el("div", { class: "subhead" }, `Spline · ${ent.pts.length} points`));
            body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-closed", checked: !!ent.closed, onchange: (ev) => sketcher.setEntProps(id, { closed: ev.target.checked }) }), "Closed loop"));
            body.append(el("div", { class: "hint", style: { padding: 0 } }, "Drag its points to reshape it. Select a point and press Delete to remove it."));
          } else if (c.t === "line") {
            const L = d2(c.a, c.b), A = ((Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) * 180) / Math.PI + 360) % 360;
            body.append(el("div", { class: "subhead" }, ent.proj ? "Projected line (fixed)" : "Line"));
            body.append(el("div", { class: "row3" }, f("Length", L, "len", { min: 0.001 }), f("Angle °", A, "ang"), el("span")));
            body.append(el("div", { class: "row3" }, f("Start X", c.a[0], "ax"), f("Start Y", c.a[1], "ay"), el("span")));
            body.append(el("div", { class: "row3" }, f("End X", c.b[0], "bx"), f("End Y", c.b[1], "by"), el("span")));
          } else if (c.t === "circle") {
            body.append(el("div", { class: "subhead" }, "Circle"));
            body.append(el("div", { class: "row3" }, f("Diameter", c.r * 2, "dia", { min: 0.001 }), f("Center X", c.c[0], "cx"), f("Center Y", c.c[1], "cy")));
          } else if (c.t === "arc") {
            body.append(el("div", { class: "subhead" }, "Arc"));
            body.append(el("div", { class: "row3" }, f("Radius", c.r, "r", { min: 0.001 }), f("Center X", c.c[0], "cx"), f("Center Y", c.c[1], "cy")));
          } else if (c.t === "point") {
            body.append(el("div", { class: "subhead" }, "Point"));
            body.append(el("div", { class: "row3" }, f("X", c.p[0], "x"), f("Y", c.p[1], "y"), el("span")));
          }
          if (!ent.proj && c.t !== "point") body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pal-cons", checked: !!ent.cons, onchange: (e) => sketcher.setEntProps(id, { cons: e.target.checked }) }), "Construction (not part of profiles)"));
        }
      }
    } else if (ids.length > 1) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${ids.length} items selected.`));
    if (ids.length) body.append(el("button", { class: "btn danger", onclick: () => sketcher.deleteSelection() }, "Delete selected"));
    if (!["select", "trim", "dim"].includes(sketcher.tool)) body.append(el("button", { class: "btn", id: "pal-stop", onclick: () => { sketcher.done(); app.status(); } }, "Stop drawing (Esc)"));
    if (sk) body.append(el("div", { class: "hint", style: { padding: 0 } }, `${regionsFor(sk).length} closed profile${regionsFor(sk).length === 1 ? "" : "s"}.`));
    palette.append(body);
    palette.append(el("footer", {}, el("button", { class: "btn", id: "pal-extrude", title: "Go straight to Extrude (E)", onclick: () => app.quickExtrude() }, "Extrude (E)"), el("button", { class: "btn primary", id: "pal-finish", onclick: () => app.exitSketch() }, "Finish sketch")));
  }
  app.onSketchTool = () => { renderRibbon(); renderPalette(); app.status(); };
  app.onSketchSelection = () => renderPalette();

  // ------------------------------------------------------------------ keys
  function key(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "a") { app.select(store.doc.bodies.map((b) => b.id)); return true; }
    if (mod && k === "l") { toggleLock(); return true; }
    if (/^Arrow/.test(e.key) && !e.altKey && app.sel.length) {
      const ids = app.sel.filter((id) => !app.isLocked(id) && findBody(store.doc, id));
      if (!ids.length) return true;
      const d = app.arrowDelta(e, (app.gridStep() || 1) * (e.shiftKey ? 10 : 1));
      transformBodies(ids, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z), "Nudge");
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") { deleteSelected(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "c") { copySel(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "v") { pasteClip(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === "d") { if (app.sel.length) app.select(duplicateBodies(app.sel)); return true; }
    if (mod) return false;
    if (k === "f" && e.shiftKey) { app.fit(); return true; }
    // Fusion-style: L / R / C start a sketch with that tool
    const map = e.shiftKey
      ? { r: () => extrudeCmd("revolve"), c: () => edgeCmd("chamfer") }
      : { i: () => measureCmd(), t: () => textureCmd(), s: createSketchCmd, q: () => offsetCmd(), p: () => patternCmd(), a: () => alignCmd(), h: () => holeCmd(), f: () => edgeCmd("fillet"), m: () => moveCmd(), b: () => combineCmd() };
    const sketchKey = !e.shiftKey && (k === "l" || k === "r" || k === "c");
    // only a key that starts another tool closes the open one (Shift, arrows and so on don't)
    if (!sketchKey && !map[k]) return false;
    if (app.command) app.command.cancel();
    if (sketchKey) { app.startSketchTool({ l: "line", r: "rect*", c: "circle" }[k]); return true; }
    map[k]();
    return true;
  }

  const sim = initSimulate(app, { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, baseOf, drawLine, drawFace, drawDot, clearOv, row, seg, pickbox, sliderRow });
  function jointCmd(id) { sim.jointCmd(id); }
  const { pipeCmd, coilCmd } = initPipeCoil(app, { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawDot, clearOv, row, seg, pickbox, pickSketchCurve, pathPts, deleteFeature, frameFrom });
  const fasteners = initFasteners(app, { openCmd, commit, row, seg, offsetSelect, STD }); // jumpstart-3d: fasteners
  const holePattern = initHolePattern(app, { openCmd, commit, row, seg, pickbox, pickBaseFace, baseOf, drawFace, ov, clearOv, offsetSelect, pitchRow, planeFromFace, CLEAR, CBORE, CSINK, TAP, isInchKey }); // jumpstart-3d: hole pattern
  const gears = initGears(app, { openCmd, commit, row, seg }); // jumpstart-3d: gears
  const namePlate = initNamePlate(app, { openCmd, commit, row, seg }); // jumpstart-3d: name plates
  const knurl = initKnurl(app, { openCmd, commit, row, seg }); // jumpstart-3d: knurl
  const spring = initSpring(app, { openCmd, commit, row, seg }); // jumpstart-3d: spring
  // section analysis: lives on after its dialog closes; a chip in the view shows it is on
  const section = (app.section = initSection(app, vp, scene));
  const secChip = el("div", { class: "section-chip", id: "section-chip", hidden: true },
    el("span", { class: "dot" }), el("span", { class: "txt" }, "Section analysis"),
    el("button", { class: "btn", id: "section-edit", title: "Change the section", onclick: () => { if (app.mode !== "advanced") app.setMode("advanced"); sectionCmd(); } }, "Edit"),
    el("button", { class: "xbtn", id: "section-clear", "aria-label": "Turn off section analysis", title: "Turn off section analysis", html: ICON.close, onclick: () => section.clear() }));
  vp.canvas.parentElement.append(secChip);
  section.onChange((info) => { secChip.hidden = !info; if (info) secChip.querySelector(".txt").textContent = "Section: " + (info.ref.label || "plane") + (info.d ? ` ${info.d > 0 ? "+" : ""}${withUnit(info.d, 1)}` : ""); });
  const { measureCmd } = initMeasure(app, { vp, openCmd, closeCmd, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawFace, drawDot, clearOv, row, seg });
  const plateUpdate = () => app.plateView && app.plateView.update(); // jumpstart-3d: printer plate. the overhang overlay steps aside while a simulation workspace is open
  const psim = initPrintSim(app, { vp, scene, openCmd, closeCmd, row, seg, sliderRow, onView: () => { if (app.mode === "advanced") renderRibbon(); }, onOpen: plateUpdate, onClose: () => leftPrintSim() });
  // the sim panel closed (Done, ×, a mode switch…): unlock the design again
  function leftPrintSim() {
    app.simLock = false;
    document.body.classList.remove("simlock");
    if (workspace === "print") { workspace = "design"; if (app.mode === "advanced") { renderRibbon(); renderBrowser(); renderTimeline(); } }
    plateUpdate(); // jumpstart-3d: printer plate
  }
  // Beginner mode opens the same sim as a tool
  function openPrintSim() {
    if (app.mode === "advanced") { setWorkspace("print"); return; }
    if (app.sketcher.active) app.exitSketch();
    if (app.command) closeCmd(false);
    app.simLock = true;
    document.body.classList.add("simlock");
    psim.open();
    plateUpdate(); // jumpstart-3d: printer plate
  }
  function setWorkspace(w) {
    if (workspace === w) return;
    const was = workspace;
    workspace = w;
    app.simLock = w === "print";
    if (app.command) closeCmd(false);
    if (w === "design" || was === "simulate") sim.resetPose();
    renderRibbon();
    renderBrowser();
    if (w === "print") psim.open();
    plateUpdate(); // jumpstart-3d: printer plate. Simulate and 3D Print Sim hide the overlay; Design brings it back
  }

  let lastKind = null;
  // ---------------------------------------------------------------- right-click menu (both modes)
  app.contextMenu = (e) => {
    if (app.command || app.sketcher.active || app.simLock) return;
    const hit = scene.pickFace(e, (b) => !b.locked || true);
    if (hit && !app.sel.includes(hit.body)) app.select([hit.body]);
    const beg = app.mode === "beginner";
    // the same actions as the keyboard shortcuts in each mode
    const fire = (k, ctrl) => (beg ? app.beginner.key : key)({ key: k, ctrlKey: !!ctrl, metaKey: false, shiftKey: false, altKey: false, preventDefault() {}, target: document.body });
    const has = app.sel.length > 0;
    const items = [
      { id: "cm-copy", label: "Copy", kbd: "Ctrl+C", icon: "copy2", off: !has, fn: () => fire("c", true) },
      { id: "cm-paste", label: "Paste", kbd: "Ctrl+V", icon: "paste2", off: !(app.clipboard && app.clipboard.length), fn: () => fire("v", true) },
      { id: "cm-dup", label: "Duplicate", kbd: "Ctrl+D", icon: "duplicate", off: !has, fn: () => fire("d", true) },
      { id: "cm-del", label: "Delete", kbd: "Del", icon: "del", off: !has, fn: () => fire("Delete") },
    ];
    if (!beg && has) items.push({ sep: true },
      { id: "cm-move", label: "Move/Copy", kbd: "M", icon: "move", fn: () => moveCmd() },
      { id: "cm-appear", label: "Appearance…", icon: "appearance", fn: () => appearanceCmd() });
    showContext(e, items);
  };
  function showContext(e, items) {
    document.getElementById("ctx-menu")?.remove();
    const menu = el("div", { class: "rmenu ctxmenu", id: "ctx-menu", role: "menu", style: { left: e.clientX + "px", top: e.clientY + "px" } });
    for (const it of items) {
      if (it.sep) { menu.append(el("div", { class: "ctxsep" })); continue; }
      const b = el("button", { role: "menuitem", id: it.id, disabled: !!it.off, html: ICON[it.icon] || "" }, el("span", {}, it.label), it.kbd ? el("span", { class: "kbd ctxkbd" }, it.kbd) : null);
      b.onclick = () => { close(); it.fn(); };
      menu.append(b);
    }
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
    const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    document.body.append(menu);
    // keep it on screen
    const r = menu.getBoundingClientRect();
    if (r.right > innerWidth - 4) menu.style.left = Math.max(4, innerWidth - r.width - 4) + "px";
    if (r.bottom > innerHeight - 4) menu.style.top = Math.max(4, e.clientY - r.height) + "px";
  }
  return {
    cancel: () => { if (app.command) closeCmd(false); },
    sim,
    printSim: psim,
    openPrintSim,
    setWorkspace,
    handler: defaultHandler,
    key,
    refresh(kind) {
      vp.request(); // jumpstart-3d: pivot. the live gizmo follows the selection
      // switching mode or opening another design leaves the simulation workspaces
      if ((kind === "mode" || kind === "load") && workspace !== "design") { workspace = "design"; app.simLock = false; if (app.command) closeCmd(false); psim.teardown(); sim.resetPose(); }
      if (kind === "mode" || kind === "sketch" || kind === "load" || !ribbon.querySelector(".rgroup") || lastKind === "mode-b") renderRibbon();
      lastKind = kind;
      renderBrowser();
      renderTimeline();
      renderPalette();
      showDofNote(); // jumpstart-3d: parameters
      if (app.command && (kind === "change" || kind === "load") && app.command.render && !app.command.noRerenderOnChange) {/* keep dialog */}
    },
    editItem,
    // shared with Beginner mode
    createSketch: (opts) => createSketchCmd(opts || {}),
    pattern: () => patternCmd(),
    align: () => alignCmd(),
    move: () => moveCmd(),
    texture: (opts) => textureCmd(opts || null),
    insertFile: (kind) => insertFile(kind),
    openModelFile: (file) => openModelFile(file), // jumpstart-3d: drop import
    fileKind: (file) => fileKind(file), // jumpstart-3d: drop import
    importModel: (file, bytes) => importModel(file, bytes),
    exportSketchesDXF,
    get selectedSketch() { return selSketch; },
    scale: () => scaleCmd(),
    measure: () => measureCmd(),
    emboss: (pre) => embossCmd(null, pre || null),
    facePattern: (opts) => facePatternCmd(opts || null),
    text3d: (id) => textCmd(id || null),
    hole: () => holeCmd(),
    appearance: () => appearanceCmd(),
    extrude: (opts) => extrudeCmd("extrude", null, opts || {}),
    sketchUI(kind) {
      if (kind === "sketch" || !ribbon.querySelector(".rgroup.sketch")) renderRibbon();
      renderPalette();
      showDofNote(); // jumpstart-3d: parameters
    },
    showBuildErrors,
    paramRows, // jumpstart-3d: parameters
    fastener: () => fasteners.cmd(), addFastener: (spec) => fasteners.add(spec), // jumpstart-3d: fasteners
    holePattern: () => holePattern.cmd(), addHolePattern: (spec) => holePattern.add(spec), // jumpstart-3d: hole pattern
    gear: () => gears.cmd(), addGear: (spec) => gears.add(spec), // jumpstart-3d: gears
    namePlate: () => namePlate.cmd(), addNamePlate: (spec) => namePlate.add(spec), // jumpstart-3d: name plates
    knurl: () => knurl.cmd(), addKnurl: (spec) => knurl.add(spec), // jumpstart-3d: knurl
    spring: () => spring.cmd(), addSpring: (spec) => spring.add(spec), // jumpstart-3d: spring
  };
}
