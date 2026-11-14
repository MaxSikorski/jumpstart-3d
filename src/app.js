// jumpstart-3d: STEP sessions are initialized before the engine starts.
import { initStepProgress } from "./stepprogress.js";
// App core: wiring, modes, selection, keyboard, shared UI helpers.
import { initProjector } from "./projector.js";
import { initMedia } from "./media.js";
import { inflate } from "./inflate.js";
import { CREDITS, LICENSE_TEXTS } from "./licenses.js";
import { initSketch3D } from "./sketch3d.js";
import { initLathe } from "./lathe.js";
import { initCarve } from "./carve.js";
import { initStainedGlass } from "./stainedglass.js";
import { initColorLitho } from "./colorlitho.js";
// jumpstart-3d: keep the upstream version and community release number separate.
import { VERSION, BUILD } from "./version.js";
const BUILD_LABEL = VERSION + " · community build " + BUILD;
import { initBricks } from "./bricks.js";
import { initVoxel } from "./voxel.js";
import { initArch } from "./arch.js";
import { initCam } from "./cam.js";
import { initTutorials } from "./tutorials.js";
import * as THREE from "three";
import { Viewport, ViewCube } from "./viewport.js";
import { KernelClient } from "./kernelClient.js";
// jumpstart-3d: the extra fonts (fonts_more.js) load on first use: morefonts.js, not an import here
import { initMoreFonts } from "./morefonts.js";
import { helperAsset, helperFailText } from "./helperpages.js";
import { extraFonts, FONT_GROUPS, FONT_NAMES } from "./fonts.js";
import { SceneSync } from "./scene.js";
import { Sketcher } from "./sketcher.js";
import { store, findBody } from "./store.js";
import { setCustomTextureSource } from "./texture.js";
setCustomTextureSource(() => ({ ...(store.doc.texImages || {}), ...((store.preview && store.preview.texImages) || {}) }));
import { el, parseLength, fmt, IS_MAC, IS_IOS, IS_IPHONE, watchMacLabels } from "./util.js";
const parseLengthMM = parseLength;
import { evalExpr, exprScope } from "./params.js"; // jumpstart-3d: parameters
import { getUnit, setUnit, onUnit, toU, fromU, showLen, parseLen, unitName, SNAP_SIZES } from "./units.js";
import { setThemeColors, theme, sketchStyle, SKETCH_WIDTHS, SKETCH_COLORS } from "./theme.js";
import { ICON } from "./icons.js";
import { initBeginner } from "./beginner.js";
import { initAdvanced } from "./advanced.js";
import { initProjects } from "./projects.js";
import { initFlexiGen } from "./flexigen.js";
import { initFloorPlan } from "./floorplan.js";
import { initMeshStep } from "./meshstep.js";
import { initNeon } from "./neon.js";
import { initLayerscape } from "./layerscape.js";
import { initCosForge } from "./cosforge.js";
import { initChisel } from "./chisel.js";
import { initMeshDetail } from "./meshdetail.js";
import { initPrinterPreview } from "./printerpreview.js"; // jumpstart-3d: printer plate
import { initBridge } from "./bridge.js"; // jumpstart-3d: scripting bridge
import { initRunScript } from "./runscript.js"; // jumpstart-3d: run script
import { initCodeCad } from "./codecad.js"; // jumpstart-3d: Code CAD
import { initChat } from "./chat.js"; // jumpstart-3d: chat inside the app
import { initReport } from "./report.js"; // jumpstart-3d: report
import { captureShare, initShareLink } from "./sharelink.js"; // jumpstart-3d: share link
captureShare(); // jumpstart-3d: share link. first thing: a design link's fragment goes into memory and off the address bar, before boot() or the bridge can see it
import { initLoadUI } from "./loadui.js"; // jumpstart-3d: load
import { initFineTurn } from "./fineturn.js"; // jumpstart-3d: fine rotation
import { initPivot } from "./pivot.js"; // jumpstart-3d: pivot
import { initDirectEdit } from "./directedit.js"; // jumpstart-3d: direct edit
import { initPerfPanel } from "./perfpanel.js"; // jumpstart-3d: perf panel
// jumpstart-3d: insert supplier parts
import { initInsertPart } from "./insertpart.js";
import { initDropImport } from "./dropimport.js"; // jumpstart-3d: drop import
import { initSimpleMode } from "./simplemode.js"; // jumpstart-3d: Simple | Original switch

/* global __WASM_PARTS__ */
const WASM_PARTS = typeof __WASM_PARTS__ !== "undefined" ? __WASM_PARTS__ : [{ url: "occt.wasm.gz", gz: true }];

const $ = (id) => document.getElementById(id);

export const app = {
  mode: "beginner",
  sel: [],
  clipboard: null,
  snapOn: true,
  objectSnap: true,
  faceSnap: true, // jumpstart-3d: face snap
  gridStep() { const v = +$("snap").value; return app.snapOn && v > 0 ? v : 0; },
  // Arrow keys move things the way they look on screen, whatever the camera angle: Left/Right
  // along the world axis (X or Y) closest to the screen's left-right, Up/Down along the ground
  // axis that points "up the screen" (or straight up, Z, when looking from the side), and
  // Ctrl/Cmd + Up/Down always lifts or lowers (Z). Returns a world step of length `step`.
  arrowDelta(e, step) {
    const q = app.vp.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const ground = (v) => { const ax = Math.abs(v.x) >= Math.abs(v.y) ? new THREE.Vector3(Math.sign(v.x) || 1, 0, 0) : new THREE.Vector3(0, Math.sign(v.y) || 1, 0); return ax; };
    const k = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
    // Left/Right: the ground axis closest to the screen's across direction
    const R = ground(right);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") return R.multiplyScalar(k * step);
    if (e.ctrlKey || e.metaKey) return new THREE.Vector3(0, 0, k * step);
    // looking from the side: Up/Down go up and down
    const upG = new THREE.Vector3(up.x, up.y, 0);
    if (Math.abs(fwd.z) < 0.42 || upG.length() < 0.2) return new THREE.Vector3(0, 0, Math.sign(up.z || 1) * k * step);
    // otherwise the other ground axis (never the same one as Left/Right, even at a 45° view),
    // pointing the way "up the screen" goes
    const U = R.x ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    if (U.dot(upG) < 0) U.negate();
    return U.multiplyScalar(k * step);
  },
  isLocked(id) { const b = findBody(store.doc, id); return !!(b && b.locked); },
};

// The hosted app loads worker.js and the engine as separate files; the
// downloadable single-file version embeds both in the page instead.
function engineSources() {
  const w = document.getElementById("wp-worker-src"), b = document.getElementById("wp-occt");
  if (w && b) {
    const bin = atob(b.textContent.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { workerType: "classic", workerUrl: URL.createObjectURL(new Blob([w.textContent], { type: "text/javascript" })), parts: [{ bytes: bytes.buffer, size: bytes.length }] };
  }
  return { parts: WASM_PARTS.map((p) => ({ ...p, url: new URL(p.url, location.href).href })), workerUrl: new URL("worker.js", location.href) };
}

function boot() {
  $("mode-beginner").onclick = () => app.switchMode("beginner");
  $("mode-advanced").onclick = () => app.switchMode("advanced");
  $("mode-chisel").onclick = () => app.switchMode("chisel");
  $("mode-arch").onclick = () => app.switchMode("arch");
  const vpEl = $("viewport");
  let vp;
  // jumpstart-3d: webgl. A browser with WebGL off (or a headless one without a GPU driver) used to leave the splash up with no word; say what is wrong instead.
  try { vp = app.vp = new Viewport(vpEl); } catch (e) {
    // only when WebGL really is missing (a probe fails or the error names it); any other error is not ours to disguise
    const probe = document.createElement("canvas");
    const hasGl = !!(probe.getContext("webgl2") || probe.getContext("webgl"));
    if (hasGl && !/WebGL/i.test(String(e && e.message))) throw e;
    console.error("WebGL is unavailable:", e);
    const msg = document.getElementById("loading-msg"), bar = document.querySelector("#loading .sp-bar");
    if (msg) msg.textContent = "WebGL is unavailable in this browser, so JumpStart 3D cannot draw its 3D view. Turn on hardware acceleration in the browser settings, or try another browser.";
    if (bar) bar.style.display = "none";
    return;
  }
  // a bold origin marker: where the X (red) and Y (green) axes cross
  {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0)]);
    const ring = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x18202a, size: 12, sizeAttenuation: false, depthTest: false, transparent: true }));
    const dot = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd34d, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
    ring.renderOrder = 20; dot.renderOrder = 21;
    app.originMarker = new THREE.Group();
    app.originMarker.add(ring, dot);
    vp.overlay.add(app.originMarker);
  }
  app.cube = new ViewCube(vpEl, vp, (name) => vp.setView(name, name === "home" ? app.scene.allBox() : null));
  const load = initLoadUI(app); // jumpstart-3d: load
  // jumpstart-3d: stage panel lives beside the viewport status UI.
  app.stepProgress = initStepProgress(app);
  const kernel = (app.kernel = new KernelClient({
    ...engineSources(),
    onProgress: (m) => load.progress(m, WASM_PARTS.reduce((s, p) => s + (p.size || 0), 0)), // jumpstart-3d: load
    // jumpstart-3d: geometry progress is separate from engine download progress.
    onBuildProgress: (m) => app.stepProgress.progress(m),
    onReady: () => { load.ready(); app.status(); }, // jumpstart-3d: load. no hold: the splash is already gone
    onResults: () => {
      app.scene.refresh(); app.stepProgress.reconcile(); app.status(); app.onBuilt && app.onBuilt();
      app.advanced && app.advanced.showBuildErrors();
      // frame the design once its first meshes arrive
      if (app.needFit && !app.scene.busy()) { app.needFit = false; const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }
    },
    onFail: (msg) => { app.stepProgress.clear(); load.fail(msg); }, // jumpstart-3d: load
  }));
  kernel.onBusy = () => app.status();
  kernel.onSlowFallback = () => app.toast("This device ran short of memory for a second geometry engine, so slow bodies now build one after another in the main engine. Other changes wait until they finish.");
  for (const [k, b] of extraFonts()) kernel.addAsset("font:" + k, "font", b);
  app.moreFonts = initMoreFonts(app, { helperAsset, helperFailText }); // jumpstart-3d: extra fonts on first use
  kernel.start();
  const scene = (app.scene = new SceneSync(vp, kernel));
  vp.zoomTargets = () => scene.meshes();
  app.sketcher = new Sketcher(app);
  scene.onRefresh = () => { app.onSceneRefresh && app.onSceneRefresh(); app.plateView && app.plateView.update(); }; // jumpstart-3d: printer plate. overhang shading follows the shapes
  // a shape's size and position boxes need its finished geometry: show them once it arrives
  let drawnKey; // jumpstart-3d: fix. redraw when a new mesh lands, not only when the position boxes are missing
  app.onSceneRefresh = () => {
    if (app.mode !== "beginner" || app.sel.length !== 1 || app.command || app.sketcher.active) return;
    const insp = $("inspector"), key = scene.views.get(app.sel[0])?.key; // jumpstart-3d: fix
    if (insp && !insp.hidden && key && key !== drawnKey) { drawnKey = key; setTimeout(() => app.refreshUI("geometry"), 0); } // jumpstart-3d: fix
  };

  // on small screens the side panels start tucked away (toggle from the toolbar)
  if (window.matchMedia("(max-width: 860px)").matches) { $("shapes").classList.add("collapsed"); $("browser").classList.add("collapsed"); }
  app.pivot = initPivot(app); // jumpstart-3d: pivot. before the two modes: both draw and use it
  app.beginner = initBeginner(app);
  app.advanced = initAdvanced(app);
  app.directEdit = initDirectEdit(app, { vp, scene }); // jumpstart-3d: direct edit. click or drag a finished sketch's shape to extrude it
  if (IS_IOS) document.documentElement.classList.add("ios");
  if (IS_MAC) document.documentElement.classList.add("mac");
  // iPhone / iPad: a pinch on the panels would zoom the whole page out of shape (the 3D view has its own pinch)
  if (IS_IOS) document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  watchMacLabels(document.body);
  window.__JS3D_INFLATE__ = inflate; // helper tools (Mesh to STEP, FlexiGen) borrow it on older Safari
  app.media = initMedia(app);
  app.projector = initProjector(app);
  app.projects = initProjects(app);
  app.tutorials = initTutorials(app);
  app.sketch3d = initSketch3D(app);
app.lathe = initLathe(app);
app.carve = initCarve(app);
app.stainedGlass = initStainedGlass(app);
app.colorLitho = initColorLitho(app);
// jumpstart-3d: match the static splash before the app loads.
{ const sv = document.getElementById("sp-ver"); if (sv) sv.textContent = "Version " + BUILD_LABEL; }
app.bricks = initBricks(app);
app.voxel = initVoxel(app);
  // Save makes a new version (v1, v2...); the number shows next to the name
  app.onVersion = () => app.refreshUI && app.refreshUI("version");
  $("btn-save").onclick = () => app.projects.saveVersion();
  $("btn-tutorials").onclick = () => app.tutorials.open();
  $("btn-tutorials-menu").onclick = () => { $("menu-export").hidden = true; app.tutorials.open(); }; // jumpstart-3d: phone entry
  $("btn-import-menu").onclick = () => { $("menu-export").hidden = true; app.insertFile("any"); }; // jumpstart-3d: import in the file menu
  app.flexigen = initFlexiGen(app);
  app.floorplan = initFloorPlan(app);
  app.meshstep = initMeshStep(app);
  app.neon = initNeon(app);
  app.layerscape = initLayerscape(app);
  app.cosforge = initCosForge(app);
  app.chisel = initChisel(app);
  app.arch = initArch(app);
  app.cam = initCam(app);
  app.plateView = initPrinterPreview(app); // jumpstart-3d: printer plate. Printer plate… in the Settings menu, overhang shading

  store.on((kind) => {
    const doc = store.view;
    // jumpstart-3d: explain pictures discarded by the shared load guard.
    if (kind === "load" && store.droppedUnsafeMedia) app.toast("Left out a picture that could not be used safely.");
    // keep the selection valid
    app.sel = app.sel.filter((id) => findBody(doc, id));
    if (app.sketcher.active && !doc.sketches.some((s) => s.id === app.sketcher.active)) app.exitSketch();
    scene.state.hideSketch = app.sketcher.active;
    app.kernel.keepAlso = store.preview ? new Set(store.doc.bodies.map((b) => b._key).filter(Boolean)) : null; // jumpstart-3d: STEP parts (#173). while a preview is open, the saved bodies' meshes stay too (baseOf reads them)
    scene.sync(doc);
    // jumpstart-3d: replacement and Undo remove sessions without waiting for a poll.
    if (kind === "load") app.stepProgress.clear(); else app.stepProgress.reconcile();
    // a command can show its own picks as the selection (Combine's target)
    scene.setSelected(app.command && app.command.sceneSel ? app.command.sceneSel() : app.sel);
    if (app.sketcher.active) app.sketcher.redraw();
    app.refreshUI(kind);
    if (kind === "change") app.projects.changed(kind);
    if (kind === "load") {
      app.needFit = store.doc.bodies.length > 0; // empty designs keep the view as it is
      // a design opens in the mode it was made in
      app.setMode(store.doc.mode || "beginner", true);
      // jumpstart-3d: shapes already built this session bring no build result, so frame now; left armed, the next edit would throw the camera back
      if (app.needFit && !scene.busy()) { app.needFit = false; const b = scene.allBox(); if (!b.isEmpty()) vp.fit(b); }
    }
  });

  // top bar
  $("btn-undo").onclick = () => app.undo();
  $("btn-redo").onclick = () => app.redo();
  $("docname").addEventListener("change", (e) => {
    const v = e.target.value.trim() || "Untitled";
    store.update((d) => { d.name = v; }, "Rename");
  });
  $("docname").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); e.stopPropagation(); });
  $("nav-home").onclick = () => vp.setView("home", app.mode === "arch" ? app.arch.box() : scene.allBox());
  $("nav-fit").onclick = () => app.fit();
  $("nav-ortho").onclick = (e) => { vp.useOrtho = !vp.useOrtho; e.currentTarget.setAttribute("aria-pressed", vp.useOrtho); vp.request(); };
  app.setLighting = (on, quiet) => { vp.setRealistic(on); $("nav-light").setAttribute("aria-pressed", !!on); if (!quiet) savePrefs(); };
  $("nav-light").onclick = () => app.setLighting(!vp.realistic);
  app.setAppearances = (on, quiet) => { app.scene.state.appearance = !!on; $("nav-appear").setAttribute("aria-pressed", !!on); const c = document.getElementById("ap-show"); if (c) c.checked = !!on; app.scene.refresh(); if (!quiet) savePrefs(); };
  $("nav-appear").onclick = () => app.setAppearances(app.scene.state.appearance === false);
  $("nav-sketches").onclick = (e) => {
    scene.showSketches = !scene.showSketches;
    e.currentTarget.setAttribute("aria-pressed", scene.showSketches);
    scene.syncSketches(store.view);
    if (app.command && app.command.refreshOk) app.command.refreshOk(); // jumpstart-3d: why OK is off. an open tool's "why" line follows Show sketches
  };
  $("snap").onchange = () => { gridFromSnap(); savePrefs(); };
  // mm / inch switch, always in the status bar: changes every readout and typed value
  $("unit-toggle").onclick = () => setUnit(getUnit() === "in" ? "mm" : "in");
  initFineTurn(app); // jumpstart-3d: fine rotation
  initPerfPanel(app); // jumpstart-3d: perf panel
  initDropImport(app); // jumpstart-3d: drop import. a model file dropped anywhere on the page opens like the Import button
  // jumpstart-3d: insert supplier parts
  app.insertPart = initInsertPart(app);
  // jumpstart-3d: the top bar wraps to two rows on a narrow screen; Chisel and the Lathe message start below its real height
  new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", document.querySelector(".topbar").offsetHeight + "px")).observe(document.querySelector(".topbar"));
  onUnit(() => {
    fillSnapSizes();
    $("unit-toggle").textContent = unitName();
    app.sketcher.unitChanged && app.sketcher.unitChanged();
    if (app.command && app.command.render) app.command.render();
    if (app.mode === "beginner" && app.beginner) app.beginner.refresh("units");
    if (app.mode === "advanced" && app.advanced && app.advanced.refresh) app.advanced.refresh("units");
    app.status && app.status();
    savePrefs();
    vp.request();
    app.toast(getUnit() === "in" ? "Units: inches. The design itself doesn't change." : "Units: millimetres. The design itself doesn't change.");
  });
  $("snap-toggle").onclick = () => app.setSnap(!app.snapOn);
  $("snap-toggle").title = "Grid snapping on or off (Shift+S). Snap to ▴ chooses grid and / or objects.";
  $("snap-obj").onclick = () => app.setObjectSnap(!app.objectSnap);
  // the Snap to menu: grid and / or objects & bodies
  const smenu = $("snap-menu"), smore = $("snap-more");
  const syncSnapMenu = () => { $("snap-grid-chk").checked = app.snapOn; $("snap-obj-chk").checked = app.objectSnap; $("snap-face-chk").checked = app.faceSnap; /* jumpstart-3d: face snap */ };
  smore.onclick = (e) => {
    e.stopPropagation(); smenu.hidden = !smenu.hidden; smore.setAttribute("aria-expanded", !smenu.hidden); syncSnapMenu();
    // it opens upward from the button (the status bar would clip it)
    const r = smore.getBoundingClientRect();
    smenu.style.right = Math.max(8, innerWidth - r.right) + "px"; smenu.style.bottom = (innerHeight - r.top + 8) + "px";
  };
  $("snap-grid-chk").onchange = (e) => app.setSnap(e.target.checked);
  $("snap-obj-chk").onchange = (e) => app.setObjectSnap(e.target.checked);
  $("snap-face-chk").onchange = (e) => app.setFaceSnap(e.target.checked); // jumpstart-3d: face snap
  window.addEventListener("pointerdown", (e) => { if (!smenu.hidden && !smenu.contains(e.target) && !smore.contains(e.target)) { smenu.hidden = true; smore.setAttribute("aria-expanded", "false"); } });
  app.syncSnapMenu = syncSnapMenu;
  // the sketch palette's snap checkbox drives the same setting
  Object.defineProperty(app.sketcher, "snapOn", { get: () => app.snapOn, set: (v) => app.setSnap(v) });
  // theme menu
  const tmenu = $("menu-theme");
  $("btn-theme").onclick = () => { tmenu.hidden = !tmenu.hidden; if (!tmenu.hidden) app.syncMeshDetailUI(); }; // jumpstart-3d: mesh detail
  tmenu.addEventListener("click", (e) => { const b = e.target.closest("button"); const t = b?.dataset.theme, pf = b?.dataset.perf, md = b?.dataset.detail, ly = b?.dataset.layout, dv = b?.dataset.device; if (t) { app.setTheme(t); tmenu.hidden = true; } else if (md) { app.setMeshDetail(md); tmenu.hidden = true; } else if (pf) { app.setPerf(pf); tmenu.hidden = true; } else if (ly) { app.setLayout(ly); tmenu.hidden = true; } else if (dv) { app.setTabletMode(!app.tabletOn); tmenu.hidden = true; } }); // jumpstart-3d: mesh detail (md)
  window.addEventListener("pointerdown", (e) => { if (!tmenu.hidden && !tmenu.contains(e.target) && !e.target.closest("#btn-theme")) tmenu.hidden = true; });
  // sketch line width and colour (the menu stays open so choices can be compared)
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  $("sk-widths").append(...SKETCH_WIDTHS.map(([k, label, w]) => el("button", { "data-skw": k, role: "menuitemradio", title: label + " sketch lines", onclick: (e) => { e.stopPropagation(); app.setSketchStyle({ width: k }); } }, el("i", { style: { height: Math.max(1, w) + "px", opacity: w < 1 ? 0.7 : 1 } }), label.replace("Extra thick", "Extra"))));
  $("sk-colors").append(...SKETCH_COLORS.map(([k, label, c]) => el("button", { "data-skc": k, role: "menuitemradio", class: c == null ? "sk-theme" : "", title: label + (c == null ? " (follows Light, Dark or High contrast)" : ""), "aria-label": label, onclick: (e) => { e.stopPropagation(); app.setSketchStyle({ color: k }); } }, el("span", { style: c == null ? {} : { background: hex(c) } }))));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (app.themePref === "system") app.setTheme("system"); });
  $("btn-keys").onclick = () => app.showShortcuts();
  // Full screen, like a video player's. Esc stays with the tools: where the browser allows it the
  // Esc key is kept for the app (hold Esc to leave), and the highlighted button always goes back.
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsSync = () => {
    const on = !!fsEl();
    document.documentElement.classList.toggle("is-full", on);
    $("btn-full").setAttribute("aria-pressed", on);
    $("btn-full").title = on ? "Exit full screen (back to normal size)" : "Full screen";
    if (!on) { document.querySelector(".fs-tip")?.remove(); try { navigator.keyboard && navigator.keyboard.unlock(); } catch (e) {} }
  };
  // iPhone has no full screen for web pages (Add to Home Screen gives the full screen there)
  if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) $("btn-full").hidden = true;
  document.addEventListener("fullscreenchange", fsSync);
  document.addEventListener("webkitfullscreenchange", fsSync);
  app.toggleFullscreen = async () => {
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const root = document.documentElement;
    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
      else { root.webkitRequestFullscreen(); await new Promise((r) => setTimeout(r, 250)); if (!fsEl()) throw new Error("no"); }
    } catch (e) { app.toast(IS_MAC || IS_IOS ? "Safari didn't allow full screen here. Try the downloaded JumpStart 3D file, or Safari's View › Enter Full Screen." : "Your browser didn't allow full screen here. Try the downloaded JumpStart 3D file, or your browser's own full-screen key (F11).", "err"); return; }
    let escKept = false;
    try { if (navigator.keyboard && navigator.keyboard.lock) { await navigator.keyboard.lock(["Escape"]); escKept = true; } } catch (e) {}
    const tip = el("div", { class: "fs-tip", role: "status" },
      el("div", { html: escKept
        ? "<b>Full screen.</b> Esc still works for your tools. To go back to normal size, click the blue <b>Exit full screen</b> button at the top, or hold Esc for a moment."
        : "<b>Full screen.</b> To go back to normal size, click the blue <b>Exit full screen</b> button at the top. In this browser, Esc also leaves full screen." }),
      el("button", { onclick: () => tip.remove() }, "Got it"));
    document.querySelector(".fs-tip")?.remove();
    document.body.append(tip);
    // point the tip at the button
    requestAnimationFrame(() => {
      const r = $("btn-full").getBoundingClientRect(), tr = tip.getBoundingClientRect();
      const right = Math.max(8, innerWidth - r.right - 8);
      tip.style.top = r.bottom + 10 + "px"; tip.style.right = right + "px";
      tip.style.setProperty("--ax", Math.max(10, Math.min(tr.width - 22, innerWidth - right - (r.left + r.width / 2) - 6)) + "px");
    });
    setTimeout(() => tip.remove(), 9000);
  };
  $("btn-full").onclick = () => app.toggleFullscreen();
  $("btn-about").onclick = () => app.showAbout();
  loadPrefs();
  app.simple = initSimpleMode(app); // jumpstart-3d: Simple | Original switch (after the prefs, before the design opens)
  vp.onContext = (e) => app.contextMenu && app.contextMenu(e);
  // Tablet & Pencil mode: a two-finger tap undoes, a three-finger tap redoes
  vp.onFingerTap = (n) => { if (n === 2) app.undo(); else if (n >= 3) app.redo(); };

  document.addEventListener("keydown", onKey);
  app.escapeLayer = initEscapeKey(app); // jumpstart-3d: Escape and dialogs. Escape closes the dialog or menu in front (or the 3D Print Sim) and never reaches the design behind it
  window.addEventListener("pointerdown", (e) => {
    const menu = $("menu-export");
    if (!menu.hidden && !menu.contains(e.target) && e.target.closest("#btn-export") == null) menu.hidden = true;
  });

  app.projects.start().then(() => {
    app.setMode(store.doc.mode || "beginner", true);
    vp.setView("home", scene.allBox().isEmpty() ? null : scene.allBox());
    app.refreshUI("version");
    app.tutorials.resumeIfAny();
    app.sharelink.offer(); // jumpstart-3d: share link. a design link that opened the page is offered now that the saved design is loaded
  });
  load.hideSplash(); // jumpstart-3d: load. the workspace is built: let the mouse in
}

// ------------------------------------------------------------------ modes
app.setMode = function (mode, initial) {
  if (app.mode === mode && !initial) return;
  if (app.command) app.command.cancel();
  // Chisel: sculpting in its own frame over the work area. Leaving it saves the
  // sculpts into the design as mesh bodies.
  const wasChisel = app.mode === "chisel", wasArch = app.mode === "arch";
  app.mode = mode;
  document.getElementById("app").dataset.mode = mode;
  $("mode-beginner").setAttribute("aria-pressed", mode === "beginner");
  $("mode-advanced").setAttribute("aria-pressed", mode === "advanced");
  $("mode-chisel").setAttribute("aria-pressed", mode === "chisel");
  $("mode-arch").setAttribute("aria-pressed", mode === "arch");
  if (wasArch && mode !== "arch") app.arch.leave();
  if (mode === "chisel") {
    $("inspector").hidden = true;
    document.querySelectorAll(".popover").forEach((p) => p.remove());
    app.chisel.enter();
    app.refreshUI("mode");
    return;
  }
  if (wasChisel) app.chisel.leave();
  // Architect: its own tools and panels in the same 3D view
  if (mode === "arch") {
    document.querySelectorAll(".popover").forEach((p) => p.remove());
    app.arch.enter();
    app.refreshUI("mode");
    return;
  }
  // panels that belong to the other mode
  $("inspector").hidden = true;
  document.querySelectorAll(".popover").forEach((p) => p.remove());
  app.vp.setGridStyle(mode === "beginner" ? "workplane" : "lines");
  app.scene.state.mode = mode;
  app.scene.showSketches = $("nav-sketches").getAttribute("aria-pressed") === "true";
  $("nav-fit").title = mode === "beginner" ? "Fit all (F)" : "Fit all (Shift+F)";
  app.scene.syncSketches(store.view);
  app.scene.refresh();
  $("browser").hidden = mode !== "advanced";
  $("shapes").hidden = mode !== "beginner";
  $("shapes-tab").hidden = mode !== "beginner";
  $("timeline").hidden = mode !== "advanced";
  app.vp.handler = app.sketcher.active ? app.sketcher.handler : mode === "beginner" ? app.beginner.handler : app.advanced.handler;
  app.refreshUI("mode");
  requestAnimationFrame(() => app.vp.resize());
};

// The top-bar switch: change modes while working. The design remembers the
// mode it was last used in and reopens in it.
app.switchMode = function (mode) {
  if (app.mode === mode) return;
  app.setMode(mode);
  if (store.doc.mode !== mode) {
    store.doc.mode = mode;
    app.projects.changed();
  }
  if (mode !== "chisel" && mode !== "arch") app.toast(mode === "advanced" ? "Advanced mode: sketches, features and the timeline" : "Beginner mode: drag shapes, group and cut with holes");
};

// Slice (like Fusion's sketch palette option): when a sketch plane runs through a body, the part
// of the bodies between the camera and the plane is cut away (view only), so the sketch can be
// seen and drawn on. It stays on through an Extrude started from the sketch.
function planeCutsBodies(plane) {
  const P = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...plane.n).normalize(), new THREE.Vector3(...plane.o));
  const v = new THREE.Vector3();
  for (const view of app.scene.views.values()) {
    if (!view.mesh || !view.body || view.body.hidden || view.group.visible === false) continue;
    const pos = view.mesh.geometry.attributes.position;
    if (!pos) continue;
    view.mesh.updateMatrixWorld();
    let above = false, below = false;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      const d = P.distanceToPoint(v.fromBufferAttribute(pos, i).applyMatrix4(view.mesh.matrixWorld));
      if (d > 0.05) above = true; else if (d < -0.05) below = true;
      if (above && below) return true;
    }
  }
  return false;
}
app.sketchSlice = { on: false, auto: false, plane: null };
app.setSketchSlice = function (on) {
  const sk = app.sketcher.sketch;
  const sec = app.section;
  if (!sec) return;
  if (on && sk) {
    const only = new Map();
    for (const view of app.scene.views.values()) if (view.body) only.set(view.body.id, view.dataVer);
    app.sketchSlice = { on: true, plane: sk.plane };
    sec.set({ ref: { n: sk.plane.n, o: sk.plane.o }, d: -0.05, flip: false, hatch: false, cap: false, only, slice: true }); // just behind the plane, so the sketch draws over the cut
  } else {
    if (sec.info && sec.info.slice) sec.clear();
    app.sketchSlice = { on: false, plane: null };
  }
};
app.enterSketch = function (id) {
  app.shapeClosedTold = false; // jumpstart-3d: direct edit. the "shape closed" note shows once per sketch visit
  if (app.command) app.command.cancel();
  app.select([]);
  app.sketcher.enter(id);
  app.scene.state.hideSketch = id;
  app.scene.syncSketches(store.view);
  const sk = app.sketcher.sketch;
  // turn Slice on by itself when the plane passes through a body (and no section is in use)
  if (sk && !(app.section && app.section.on && !app.section.info.slice) && planeCutsBodies(sk.plane)) app.setSketchSlice(true);
  app.refreshUI("sketch");
};
app.exitSketch = function (keepSlice = false) {
  if (!app.sketcher.active) return;
  if (!keepSlice) app.setSketchSlice(false);
  app.sketcher.exit();
  app.scene.state.hideSketch = null;
  app.scene.syncSketches(store.view);
  app.vp.handler = app.mode === "beginner" ? app.beginner.handler : app.advanced.handler;
  app.refreshUI("sketch");
};

// ------------------------------------------------------------------ selection
// ------------------------------------------------------------------ preferences (this browser)
// the snap sizes on offer follow the units (values stay in mm)
const snapPick = { mm: "1", in: String(25.4 / 16) };
function fillSnapSizes() {
  const sel = $("snap"), u = getUnit();
  sel.innerHTML = "";
  for (const [v, label] of SNAP_SIZES[u]) sel.append(el("option", { value: String(v) }, label));
  sel.value = [...sel.options].some((o) => o.value === snapPick[u]) ? snapPick[u] : SNAP_SIZES[u][u === "in" ? 2 : 3][0];
  gridFromSnap();
}
function gridFromSnap() {
  const v = +$("snap").value;
  snapPick[getUnit()] = $("snap").value;
  if (getUnit() === "in") { app.vp.gridUnit = "in"; app.vp.gridBase = Math.max(v, 25.4 / 64); }
  else { app.vp.gridUnit = "mm"; app.vp.gridBase = Math.max(v, 0.1) >= 1 ? 1 : 0.1; }
  app.vp.request();
}
function readPrefs() { try { return JSON.parse(localStorage.getItem("workplane.ui.v1") || "{}"); } catch (e) { return {}; } }
function savePrefs() {
  try { localStorage.setItem("workplane.ui.v1", JSON.stringify({ skw: sketchStyle.width, skc: sketchStyle.color, theme: app.themePref, layout: app.layoutPref, tablet: !!app.tabletOn, tabletPrevLayout: app.tabletPrevLayout || null, snap: app.snapOn, obj: app.objectSnap, faces: app.faceSnap, grid: snapPick.mm, gridIn: snapPick.in, lightOn: app.vp.realistic, appear: app.scene.state.appearance !== false })); } catch (e) {}
}
function loadPrefs() {
  const p = readPrefs();
  if (p.grid) snapPick.mm = p.grid;
  if (p.gridIn) snapPick.in = p.gridIn;
  fillSnapSizes();
  $("unit-toggle").textContent = unitName();
  app.objectSnap = p.obj !== false;
  app.faceSnap = p.faces !== false; // jumpstart-3d: face snap
  $("snap-obj").setAttribute("aria-pressed", app.objectSnap);
  app.setSnap(p.snap !== false, true);
  app.setSketchStyle({ width: p.skw || "thin", color: p.skc || "theme" }, true);
  app.setTheme(p.theme || "system", true);
  app.setLayout(p.layout || "default", true);
  app.tabletPrevLayout = p.tabletPrevLayout || null;
  app.setTabletMode(!!p.tablet, true);
  // an iPad (or other tablet) that hasn't chosen yet: suggest Tablet & Pencil mode once
  if (p.tablet === undefined && isTablet()) setTimeout(() => app.toast("On an iPad or tablet? Turn on Tablet & Pencil mode in the Customize menu: fingers move the view, the Apple Pencil draws and picks precisely."), 4000); // jumpstart-3d: Customize replaces the theme icon
  // realistic lighting starts off (faster); it stays on only for someone who turned it on themselves
  app.setLighting(p.lightOn === true, true);
  app.setAppearances(p.appear !== false, true);
  let perf = "auto"; try { perf = localStorage.getItem(PERF_KEY) || "auto"; } catch (e) {}
  app.setPerf(perf, true);
  initMeshDetail(app);
  app.vp.onSlow = onSlow;
}

app.setSnap = function (on, quiet) {
  app.snapOn = !!on;
  $("snap-toggle").setAttribute("aria-pressed", app.snapOn);
  $("snap").disabled = !app.snapOn;
  app.syncSnapMenu && app.syncSnapMenu();
  app.chisel && app.chisel.snapChanged && app.chisel.snapChanged();
  if (!quiet) { app.toast(app.snapOn ? "Grid snapping on" : "Grid snapping off: shapes and sketch points move freely"); savePrefs(); }
  if (app.sketcher.active) app.advanced.sketchUI("snap");
};

// snapping to other objects and bodies (corners, edge middles, centers), on its own switch
app.setObjectSnap = function (on, quiet) {
  app.objectSnap = !!on;
  $("snap-obj").setAttribute("aria-pressed", app.objectSnap);
  app.syncSnapMenu && app.syncSnapMenu();
  app.chisel && app.chisel.snapChanged && app.chisel.snapChanged();
  if (!quiet) { app.toast(app.objectSnap ? "Snapping to objects and bodies on" : "Snapping to objects and bodies off"); savePrefs(); }
};

// jumpstart-3d: face snap. a dragged shape lands on the face under the pointer
app.setFaceSnap = function (on, quiet) {
  app.faceSnap = !!on;
  app.syncSnapMenu && app.syncSnapMenu();
  if (!quiet) { app.toast(app.faceSnap ? "Snapping to faces on" : "Snapping to faces off"); savePrefs(); }
};

// Performance: Normal (lightest), High or Ultra (sharpest) change only how the 3D view is drawn (pixels
// while moving, shadow detail), never the models, tools or exports. Auto picks one for this
// computer (Chromebooks and low-memory machines start lighter) and steps down if frames come
// slowly while you work; the step is remembered on this computer.
// (saved under new names: in v1.93.6 the names ran the other way)
const PERF_KEY = "jumpstart.perfmode", PERF_AUTO_KEY = "jumpstart.perfmode.auto";
const PERF_NAMES = { normal: "Normal", high: "High", ultra: "Ultra" };
function detectPerf() {
  const ua = navigator.userAgent || "", mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  let gpu = "";
  try { const gl = app.vp.renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info"); gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) {}
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)) return "normal";
  // iPhone / iPad: Safari hides the memory and core count; their very sharp screens and the
  // memory limit Safari sets for a web page make the middle mode the safe start
  if (IS_IOS) return "high";
  if (mem <= 2 || cores <= 2) return "normal";
  if (/CrOS/.test(ua) || mem <= 4 || cores <= 4 || /Mali|PowerVR|Adreno|Intel.*(HD Graphics( [45]\d\d)?$|HD Graphics [45]\d\d|UHD Graphics 6\d\d)/i.test(gpu)) return "high";
  return "ultra";
}
// from the sharpest to the lightest (Auto steps along this when things get slow)
const PERF_ORDER = ["ultra", "high", "normal"];
app.perfLevel = "ultra";
app.setPerf = function (pref, quiet) {
  if (!["auto", "normal", "high", "ultra"].includes(pref)) pref = "auto";
  app.perfPref = pref;
  let auto = null;
  try { auto = localStorage.getItem(PERF_AUTO_KEY); } catch (e) {}
  const detected = detectPerf();
  // Auto: what this computer looks like, or a lighter mode it stepped down to before
  const autoLevel = auto && PERF_ORDER.indexOf(auto) > PERF_ORDER.indexOf(detected) ? auto : detected;
  const level = pref === "auto" ? autoLevel : pref;
  app.perfLevel = level;
  app.vp.setPerf(level);
  app.chiselPerf && app.chiselPerf(level);
  document.querySelectorAll("#menu-theme button[data-perf]").forEach((b) => b.setAttribute("aria-checked", b.dataset.perf === pref));
  const note = document.getElementById("perf-auto-note"); if (note) note.textContent = "now " + PERF_NAMES[autoLevel];
  if (!quiet) { try { localStorage.setItem(PERF_KEY, pref); } catch (e) {} app.toast(PERF_NAMES[level] + (pref === "auto" ? " (Auto)" : "") + ": " + (level === "ultra" ? "the sharpest picture, for powerful computers." : level === "high" ? "lighter drawing while you move the view, for most laptops and Chromebooks." : "the lightest drawing, for slower computers.")); }
};
let slowTold = false;
function onSlow() {
  const i = PERF_ORDER.indexOf(app.perfLevel);
  if (app.perfPref === "auto" && i < 2) {
    const next = PERF_ORDER[i + 1];
    try { localStorage.setItem(PERF_AUTO_KEY, next); } catch (e) {}
    app.setPerf("auto", true);
    app.toast("Switched to " + PERF_NAMES[next] + " to keep things smooth. You can change it in the Customize menu."); // jumpstart-3d: Customize replaces the theme icon
  } else if (app.perfPref !== "auto" && i < 2 && !slowTold) {
    slowTold = true;
    app.toast("Things look slow on this computer. Try " + (i === 0 ? "High or Normal" : "Normal") + " in the Customize menu: " + (i === 0 ? "they draw" : "it draws") + " less, and every tool still works."); // jumpstart-3d: Customize replaces the theme icon
  }
}

// Sketch lines: width and colour, everywhere sketches are drawn (Advanced, Beginner, Chisel).
app.setSketchStyle = function (patch, quiet) {
  if (patch.width && SKETCH_WIDTHS.some((x) => x[0] === patch.width)) sketchStyle.width = patch.width;
  if (patch.color && SKETCH_COLORS.some((x) => x[0] === patch.color)) sketchStyle.color = patch.color;
  document.querySelectorAll("#sk-widths button").forEach((b) => b.setAttribute("aria-checked", b.dataset.skw === sketchStyle.width));
  document.querySelectorAll("#sk-colors button").forEach((b) => b.setAttribute("aria-checked", b.dataset.skc === sketchStyle.color));
  if (app.scene) app.scene.syncSketches(store.view);
  if (app.sketcher && app.sketcher.active) app.sketcher.redraw();
  if (app.vp) app.vp.request();
  // Chisel reads the colours when its theme is (re)applied
  try { app.chiselTheme && app.chiselTheme(); } catch (e) {}
  if (!quiet) savePrefs();
};

// Layouts: where the tool bars sit. Default (top), Simplified (big labelled buttons on top), Clean
// (an icon rail on the left), Classic CAD (a labelled palette on the right) and Tablet (big tools at
// the bottom). Only CSS changes (html[data-layout]); every tool is the same in each.
const LAYOUTS = { default: "Default", simple: "Big buttons", clean: "Clean", classic: "Classic CAD", tablet: "Tablet" }; // jumpstart-3d: his "Simplified" layout reads "Big buttons" beside our Simple | Original switch
app.layoutPref = "default";
app.setLayout = function (name, quiet) {
  if (!LAYOUTS[name]) name = "default";
  app.layoutPref = name;
  if (name === "default") delete document.documentElement.dataset.layout;
  else document.documentElement.dataset.layout = name;
  document.querySelectorAll("#menu-theme button[data-layout]").forEach((b) => b.setAttribute("aria-checked", b.dataset.layout === name));
  document.getElementById("ribbon-menu")?.remove();
  // the view and the panels size themselves to the new space
  requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); app.vp && app.vp.request(); });
  if (!quiet) {
    savePrefs();
    app.toast(LAYOUTS[name] + " layout: " + ({ default: "tools across the top.", simple: "bigger buttons with names.", clean: "icons down the left side (hover for names).", classic: "a tool palette down the right side.", tablet: "big tools along the bottom." })[name] + " Change it any time in the Customize menu."); // jumpstart-3d: Customize replaces the theme icon
  }
};

// Tablet & Pencil mode, for iPad and other tablets (html[data-device="tablet"]): the Tablet layout
// with big touch targets, the pencil as a precise pointer and fingers for the view (viewport.js
// penMode), keys on screen (Undo, Redo, Shift, Delete, Esc, Enter, Fit), finger taps for undo and
// redo, a long press for the right-click menu, and no page zoom or text pop-ups when tapping.
function isTablet() {
  const ua = navigator.userAgent || "";
  return /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
app.tabletOn = false;
app.setTabletMode = function (on, quiet) {
  on = !!on;
  const was = app.tabletOn;
  app.tabletOn = on;
  if (on) document.documentElement.dataset.device = "tablet";
  else delete document.documentElement.dataset.device;
  if (app.vp) { app.vp.penMode = on; if (!on) { app.vp.shiftDown = false; } }
  // the Tablet layout goes with it; turning the mode off brings back the layout from before
  if (on && !was && app.layoutPref !== "tablet") { app.tabletPrevLayout = app.layoutPref; app.setLayout("tablet", true); }
  if (!on && was && app.layoutPref === "tablet" && app.tabletPrevLayout && app.tabletPrevLayout !== "tablet") { app.setLayout(app.tabletPrevLayout, true); app.tabletPrevLayout = null; }
  const b = document.querySelector('#menu-theme button[data-device="tablet"]');
  if (b) b.setAttribute("aria-checked", on);
  tabletKeys(on);
  requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); app.vp && app.vp.request(); });
  if (!quiet) {
    savePrefs();
    app.toast(on ? "Tablet & Pencil mode: draw and pick with the Apple Pencil, move the view with your fingers (one to orbit, two to pan and zoom). Two-finger tap: undo, three-finger tap: redo, long press: menu. The keys on the left of the view stand in for a keyboard." : "Tablet & Pencil mode is off.");
  }
};
// the on-screen keys, down the left edge of the view
function tabletKeys(on) {
  let bar = document.getElementById("tabkeys");
  if (!on) { if (bar) bar.remove(); return; }
  if (bar) return;
  const vpEl = document.getElementById("viewport");
  if (!vpEl) return;
  const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const keys = [
    ["tk-undo", "Undo", svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'), () => app.undo()],
    ["tk-redo", "Redo", svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'), () => app.redo()],
    ["tk-shift", "Shift: the next tap adds to the selection (tap twice to keep it on)", svg('<path d="M12 4 4 12h4v7h8v-7h4z"/>'), null],
    ["tk-del", "Delete the selection", svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'), () => key("Delete")],
    ["tk-esc", "Esc: cancel or step out", '<b>Esc</b>', () => key("Escape")],
    ["tk-ok", "Enter: OK or finish", svg('<path d="M5 12l5 5L20 7"/>'), () => { if (app.command && document.getElementById("cmd-ok")) app.submitCommand ? app.submitCommand() : document.getElementById("cmd-ok").click(); else key("Enter"); }],
    ["tk-fit", "Fit everything in the view", svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), () => app.fit()],
  ];
  bar = document.createElement("div");
  bar.id = "tabkeys"; bar.className = "tabkeys"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Keys for tablets");
  for (const [id, title, icon, fn] of keys) {
    const b = document.createElement("button");
    b.id = id; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = icon;
    if (fn) b.onclick = (e) => { e.preventDefault(); fn(); };
    bar.append(b);
  }
  // Shift: one tap = for the next pick, a second tap = stays on (locked), a third = off
  const sh = bar.querySelector("#tk-shift");
  let state = 0;
  const show = () => { sh.setAttribute("aria-pressed", state > 0); sh.classList.toggle("locked", state === 2); if (app.vp) app.vp.shiftDown = state > 0; };
  sh.onclick = (e) => { e.preventDefault(); state = (state + 1) % 3; show(); };
  if (app.vp) app.vp.endShift = () => { if (state === 1) { state = 0; show(); } };
  show();
  vpEl.append(bar);
}

// Light, dark and high-contrast interface. "system" follows the device setting.
app.setTheme = function (pref, quiet) {
  app.themePref = pref;
  const name = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
  document.documentElement.dataset.ui = name;
  setThemeColors(name);
  document.querySelectorAll("#menu-theme button[data-theme]").forEach((b) => b.setAttribute("aria-checked", b.dataset.theme === pref));
  if (app.vp) {
    app.vp.setGridStyle(app.mode === "beginner" ? "workplane" : "lines");
    // rebuild materials that carry theme colors
    for (const v of app.scene.views.values()) v.key = null;
    app.scene.refresh();
    app.scene.syncSketches(store.view);
    if (app.sketcher.active) app.sketcher.redraw();
  }
  if (!quiet) savePrefs();
};

// ------------------------------------------------------------------ object snapping
// While dragging, line up the moving shapes' edges and centers with other shapes.
const snapBoxCache = new Map();
const guideGroup = { g: null };
function otherBoxes(skip) {
  const out = [];
  for (const b of store.doc.bodies) {
    if (skip.has(b.id) || b.hidden) continue;
    const key = (b._key || "") + JSON.stringify(b.m);
    let c = snapBoxCache.get(b.id);
    if (!c || c.key !== key) {
      const box = app.scene.boxWithMatrix(b.id, new THREE.Matrix4().fromArray(b.m));
      c = { key, box };
      snapBoxCache.set(b.id, c);
    }
    if (c.box) out.push(c.box);
  }
  return out;
}
app.snapToObjects = function (ids, boxes, delta, axes) {
  app.clearSnapGuides();
  if (!app.objectSnap || !boxes) return { delta };
  const moving = new THREE.Box3();
  for (const id of ids) { const b = boxes.get(id); if (b) moving.union(b); }
  if (moving.isEmpty()) return { delta };
  const others = otherBoxes(new Set(ids));
  if (!others.length) return { delta };
  const mv = moving.clone().translate(delta);
  const tol = 8 * app.vp.pixelSize(mv.getCenter(new THREE.Vector3()));
  const vals = (b, k) => [b.min[k], (b.min[k] + b.max[k]) / 2, b.max[k]];
  const out = delta.clone();
  const guides = [];
  for (const k of axes) {
    let best = null;
    for (const o of others) for (const a of vals(mv, k)) for (const t of vals(o, k)) {
      const d = t - a;
      if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t, o };
    }
    if (best) { out[k] += best.d; guides.push({ k, at: best.at, o: best.o }); }
  }
  if (guides.length) {
    const fin = moving.clone().translate(out);
    const g = new THREE.Group();
    const mat = new THREE.LineDashedMaterial({ color: theme.c.hover, dashSize: 2, gapSize: 1.5, depthTest: false, transparent: true });
    for (const s of guides) {
      const both = fin.clone().union(s.o);
      let a, b;
      if (s.k === "x") { a = new THREE.Vector3(s.at, both.min.y, fin.min.z); b = new THREE.Vector3(s.at, both.max.y, fin.min.z); }
      else if (s.k === "y") { a = new THREE.Vector3(both.min.x, s.at, fin.min.z); b = new THREE.Vector3(both.max.x, s.at, fin.min.z); }
      else { const c = fin.getCenter(new THREE.Vector3()); a = new THREE.Vector3(both.min.x, c.y, s.at); b = new THREE.Vector3(both.max.x, c.y, s.at); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat);
      l.computeLineDistances();
      l.renderOrder = 30;
      g.add(l);
    }
    app.vp.overlay.add(g);
    guideGroup.g = g;
    app.vp.request();
  }
  return { delta: out };
};
app.clearSnapGuides = function () {
  if (guideGroup.g) { app.vp.overlay.remove(guideGroup.g); guideGroup.g.traverse((o) => o.geometry && o.geometry.dispose()); guideGroup.g = null; app.vp.request(); }
};

// L / R / C outside a sketch: start a sketch with that tool, as in Fusion
app.insertFile = (kind) => app.advanced.insertFile(kind);
app.startSketchTool = function (tool) {
  if (app.sketcher.active) { app.sketcher.setTool(tool); return; }
  app.advanced.createSketch({ tool });
};

// ------------------------------------------------------------------ updates
const SITE_URL = "https://classyapps.org/";
// jumpstart-3d: check community builds only on demand; never trust response links or HTML.
const UPDATE_URL = "https://api.github.com/repos/MaxSikorski/jumpstart-3d/releases/latest";
const RELEASE_URL = "https://github.com/MaxSikorski/jumpstart-3d/releases/latest";
async function checkForUpdates(btn) {
  const msg = document.getElementById("ab-upmsg");
  const say = (...kids) => { if (!msg) return; msg.hidden = false; msg.replaceChildren(...kids); try { msg.scrollIntoView({ block: "nearest" }); } catch (e) {} };
  btn.disabled = true; btn.textContent = "Checking…";
  let timeout;
  try {
    const ctl = new AbortController();
    timeout = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(UPDATE_URL, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: ctl.signal });
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    const info = await r.json();
    const match = typeof info?.tag_name === "string" && info.tag_name.match(/-community\.(\d+)$/);
    const build = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(build) || ctl.signal.aborted) throw new Error("Invalid release or timeout");
    if (build > BUILD) {
      say(el("b", {}, `Build ${build} is available`), " ", el("a", { href: RELEASE_URL, target: "_blank", rel: "noopener" }, "Get the new build"));
    } else say(el("b", {}, "You have the latest build"));
  } catch (err) {
    say("Couldn't check for updates");
  } finally { clearTimeout(timeout); btn.disabled = false; btn.textContent = "Check for updates"; }
}

app.checkForUpdates = checkForUpdates; // jumpstart-3d: Simple's About calls the same check

// keyboard shortcuts sheet
app.showAbout = function () {
  const sec = (title, items) => el("section", {}, el("h3", {}, title), el("ul", {}, ...items.map(([b, t]) => el("li", {}, el("b", {}, b), " " + t))));
  const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
  const logo = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5 12 21l9-4.5L12 12z" fill="#2d63c8"/><path d="M3 12 12 16.5 21 12 12 7.5z" fill="#6f98d8"/><path d="M3 7.5 12 12l9-4.5L12 3z" fill="#c9d3df"/></svg>';
  const modal = el("div", { class: "modal about", role: "dialog", "aria-label": "About JumpStart 3D" },
    el("header", {}, el("h2", {}, "About"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
    el("div", { class: "mbody", id: "about-body" },
      // jumpstart-3d: display both release numbers in About.
      el("div", { class: "ab-head", html: logo }, el("div", {}, el("b", {}, "JumpStart 3D ", el("span", { class: "ab-hver" }, "Version " + BUILD_LABEL)), el("span", {}, "3D design for the browser: start simple, grow into real CAD, then 3D print it."))),
      el("div", { class: "ab-update ab-top" },
        el("button", { class: "btn", id: "ab-check", onclick: (e) => checkForUpdates(e.currentTarget) }, "Check for updates"),
        el("button", { class: "btn", id: "ab-report", onclick: () => { back.remove(); app.showReport(); } }, "Report a problem"), // jumpstart-3d: report
        el("button", { class: "btn", id: "ab-slow", onclick: () => app.showSlowHelp() }, "Slow bodies"),
        el("button", { class: "btn", id: "ab-tablet", title: "For iPad and other tablets: the Apple Pencil draws and picks, fingers move the view. Also in the Customize menu under Device.", onclick: (e) => { app.setTabletMode(!app.tabletOn); e.currentTarget.textContent = app.tabletOn ? "Tablet & Pencil mode: on" : "Tablet & Pencil mode: off"; } }, app.tabletOn ? "Tablet & Pencil mode: on" : "Tablet & Pencil mode: off"), // jumpstart-3d: Customize replaces the theme icon
        // jumpstart-3d: the main button goes to the community build; the author's site stays as a second link
        el("a", { class: "btn primary", id: "ab-community", href: "https://github.com/MaxSikorski/jumpstart-3d", target: "_blank", rel: "noopener" }, "Visit the community build"),
        // jumpstart-3d: support link (community build), at the top of About
        el("a", { class: "btn", id: "ab-support", href: "https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08", target: "_blank", rel: "noopener" }, "Support"),
        el("a", { class: "btn", id: "ab-site", href: SITE_URL, target: "_blank", rel: "noopener" }, "J.Siwek's site")),
      el("p", { class: "ab-upmsg", id: "ab-upmsg", role: "status", hidden: true }),
      sec("New in version 2.9.8.9.8", [
        ["Layerscape → 3D building kit → From my design:", "turn your own JumpStart 3D design into a building kit. Boxes become buildings with walls and a roof, cylinders and prisms become round towers, a cone or pyramid on top becomes a spire and a roof shape on top a pitched roof; anything else (a dome, a wedge, text...) is cut as stacked layers in wood or folded as a low-poly shell in card. It uses the selected objects, or all that are shown."],
        ["Looks:", "print it in each object's own colour, or as a stone castle, a brick town, modern glass or a cottage, with or without windows and a door, in wood (tabs, slots and living hinges) or card (fold and glue)."],
      ]),
      sec("New in version 2.9.8.9.7", [
        ["Layerscape → 3D building kits:", "build a printed model kit like the wooden and foam ones in toy shops: a castle with spires, a football stadium, a lighthouse and cottage, a cathedral, a city block, a cottage or a clock tower, every wall, roof and tower printed (stone, brick, slate, windows, crowds, scoreboard...)."],
        ["Wood or card:", "wood kits are cut on a laser with finger-jointed walls, tabs and slots, bendy living-hinge walls for round towers and stands, and cross-slotted spires; card kits are unfolded into nets with fold lines, numbered edges and glue tabs."],
        ["Layerscape → Low-poly papercraft:", "any template, your design or an STL / OBJ file becomes a faceted low-poly model (like the 4D card kits), each panel in the model's own colours, one colour or the picture's, numbered and unfolded into nets to print, cut, fold and glue."],
        ["Faster puzzle maker:", "switching between puzzle kinds shows the new tab straight away, models are measured once, and puzzles you've already made come back instantly."],
        ["Sketch → Line:", "finishing a line (closing it, Esc, Enter or a double-click) puts the Line tool down, so a stray click doesn't start another line. Press L or pick Line to draw the next one."],
      ]),
      sec("New in version 2.9.8.9.6", [
        ["Layerscape → Puzzle maker:", "a new mode at the top of Layerscape turns a picture or a 3D model into a puzzle you can laser cut, print on paper or 3D print."],
        ["Jigsaw puzzles:", "any picture (your photo or an example scene) as a jigsaw: rectangle, rounded, circle, egg, heart or star shaped, with the number of pieces, knob size and wobble you choose, and a frame tray to hold it."],
        ["3D slot-together puzzles:", "a model sliced into flat ribs that slot into each other, from a template, your JumpStart 3D design or an STL / OBJ file; put the open picture on the ribs if you like."],
        ["3D stacked-layer puzzles:", "the model cut into layers one sheet thick, with peg holes so the layers line up as you stack them."],
        ["Puzzle templates:", "22 ready-made models to puzzle: animals (dinosaur, whale, turtle, cat, teddy, penguin), holidays (heart, star, Christmas tree, snowman, pumpkin, ghost, egg, bunny, bell, gingerbread man, dreidel) and things (rocket, globe, house, tower, car)."],
        ["Every puzzle exports:", "a laser cut kit (.zip of SVG sheets), printable pages with the steps (.pdf), a 3D print kit (.3mf and STLs), or straight into your JumpStart 3D design as objects."],
        ["16 new example scenes:", "holiday scenes (Winter village, Halloween night, Valentine's garden, Easter meadow, Autumn harvest, Festival of lights, New Year fireworks, Lucky clover, Birthday party) and more (Coral reef, Arctic friends, Desert oasis, Outer space, Dinosaur valley, Camping night, City lights), sorted by category."],
      ]),
      sec("New in version 2.9.8.9.5", [
        ["Picture to 3D model, much closer to the real thing:", "each part of the subject gets its own round thickness (legs, arms, tails, stems and the body each as thick as they are wide), instead of one puffed-up outline. Presets for an animal, a person or figure, a plant or flower, a round object and flat art (a flat back with raised detail), and every setting to refine it: the cross-section (round, pillow, thin leaves, flat with a round edge, ridged), thickness, a maximum thickness, back depth, a flat back, surface detail from the picture's shading, smoothing, edge rounding and four levels of detail. A turning 3D preview shows the model before you make it."],
        ["More pictures:", "add a side, back and top picture of the same subject and the model is carved to match each view too (so a dog photographed from the side gets its real width from a front photo, and its four legs in the right places)."],
        ["A better cut-out:", "find the subject automatically, by tapping its colours (several for a multi-coloured subject), or by brightness; tap the background to tell it what to leave out; paint with Keep and Remove brushes; grow or shrink and smooth the edge; keep holes (handles, the gap between legs) and every piece if you want them."],
        ["Helmet Maker → Photos:", "a new step: take or choose up to 4 photos of a helmet (front, side, back and top) and the helmet's shape is built from them, sized to fit your head (it is only ever pushed outward, so it still fits). Set the head's height and position inside it, round or boxy, smoothing, a little extra size and how strongly the photos shape it. \"Visor from the front photo\" finds the dark visor and uses its shape. Then Visor, Details, Look and Cut & Join work as before."],
      ]),
      sec("New in version 2.9.8.9.4", [
        ["Color Lithophane Studio", "A new app in the 3D Print Sim (Color lithophane on its ribbon, or the Color lithophane button on its Plate card, in Beginner too). Open a photo and it becomes a full-colour lithophane printed with white, cyan, magenta and yellow filament (black too, if you like): a thin white plate, then under every colour pixel a stack of thin layers of those filaments whose mix sets its colour, then a white texture on top, thicker where the picture is darker, for the brightness and the detail. The colours are worked out the way light really passes through the plastic, from each filament's colour and its TD (transmission distance), so you can set your own filaments. See it lit from behind, the colour layers on their own, or the 3D parts. Choose the width, shape (rectangle, rounded, oval, heart, hexagon), a white frame, brightness, contrast and colour, dithering, layer height, how many colour layers, pixel sizes and the white's thickness; it shows the grams of each filament. Export a 3MF (one object with a part per filament, set up for Orca Slicer and Bambu Studio) or a ZIP of STLs with a preview and the settings, or press Print in 3D Print Sim."],
        ["Full-colour printing in the 3D Print Sim", "The lithophane goes straight onto the sim's plate with each part on its own filament (white, cyan, magenta, yellow in AMS slots 1 to 4) at its layer height and 100% infill. Slice it and the layers show the colours going down, the filament changes and purges are counted (with a prime tower), the time is worked out like Orca Slicer, and Export G-code saves a real multi-colour .gcode with the tool changes. Back to my design puts your own bodies back on the plate."],
        ["3D Print Sim looks like Orca Slicer", "The sim now has Orca Slicer's layout and teal accents: the settings down the left in Printer, Filament and Process cards, the Process settings in Quality, Strength, Speed, Support, Others and Objects tabs (new: 0.08 and 0.10 mm layers, top and bottom shell layers, and the printer's own speeds and accelerations), Prepare and Preview tabs and a Slice plate button on the ribbon, a dark textured PEI plate with a 10 mm grid, the plate number and the printer's name, the layer slider up the right with the layer number and height, a slider along the bottom for the moves within the layer, and a Line Type legend with the time and share of each kind of line, the total time and the filament."],
      ]),
      sec("New in version 2.9.8.9.3", [
        ["Jigs made of honeycomb", "The Jig Maker's honeycomb now covers the whole jig, not just patches inside it: every wall, side, floor, plate, cheek and ear is a honeycomb from edge to edge, with as many cells as fit, spread evenly so the frame round them is the same all round. Blocks that hold guide holes or a slot (dowel jig, drill guide, mortise guide, pocket-hole jig) get honeycomb pockets in their sides that stop short of the holes, so the guides stay true. Only the strips the saw, chisel or drill rides on stay solid. Cells in upright walls are pointy-topped, so they print without supports. Cell size (8 mm to start) and cell walls are at the bottom of the Jig Maker, and you can still turn the honeycomb off."],
      ]),
      sec("New in version 2.9.8.9.2", [
        ["Honeycomb jigs", "Every jig from the Jig Maker (Advanced → Workshop) is now a honeycomb inside: hexagonal holes through its walls, floors, blocks and plates, so it uses less plastic and prints faster while staying stiff. The faces that guide a saw, chisel or drill and the edges that locate on the board stay solid, with a solid rim round each honeycomb. Turn it off, or change the cell size and the cell walls, at the bottom of the Jig Maker."],
        ["Joint jigs", "Four new jigs for the joints on a woodworking joints chart. Dovetail: a marking template with the tails and half pins at 1:5, 1:6, 1:7 or 1:8 (or any slope), for your board's width and thickness and number of tails, and a saw guide leaning at the same slope. Box joint: a finger template (fingers and gaps the same width, 1/4 to 3/4 inch or mm) and an indexing key for a saw or router sled. Mortise & tenon: a guide that straddles the board with a slot for the chisel or router (centred or off centre) and a tenon gauge. Lap joint: a bridge across the board whose window guides the saw, chisel or router for the shoulders, and a step gauge for half the thickness."],
      ]),
      sec("New in version 2.9.8.9.1", [
        ["Layerscape: layered files", "Open picture in Layerscape now also opens layered files: Photoshop PSD and PSB (also saved by Procreate, Affinity, Photopea, Krita and GIMP), SVG (Inkscape, Illustrator and Figma layers or groups) and OpenRaster ORA (Krita, GIMP, MyPaint), or several pictures picked at once (one layer each, the first name at the back, so number them 01, 02…). A Layers found window lists every layer with a preview: choose Piece, Cross-slot piece, Backdrop or Leave out for each, put them in order with the arrows, and press Make pieces. The bottom layer that fills the picture becomes the backdrop and hidden layers are left out to start with. Each piece keeps all of its layer, even the parts hidden behind other layers, and the backdrop layers are used as they are, so nothing needs filling in. How far back each piece stands follows the layer order (top at the front). Photoshop groups come in as one piece, clipped layers join the layer under them, and layer masks and opacity count. The layers are saved with the project."],
        ["Layerscape models in JumpStart 3D", "Import (Beginner) or Insert → STL / 3MF / STEP model (Advanced) now takes a Layerscape 3D print kit: the .zip or the .3mf inside it. It comes in as one object per part, named and coloured from the picture. Kits made with this version come in put together as the finished diorama; older kits come in laid out flat as on the print plate."],
      ]),
      sec("New in version 2.9.8.9", [
        ["Layerscape updated", "The newest Layerscape replaces the one in 2.9.8.8.1: Undo and Redo buttons, Duplicate, Copy and Paste for pieces, move a selected piece anywhere on the deck by dragging it in the 3D view (Shift + drag to move only forward or back) or with the arrow keys, resize it with its corner handle or the [ and ] keys, and a Keyboard shortcuts list (press ?). It still keeps the diorama with your design, saves files through JumpStart 3D, and Add to my design puts the finished diorama in your design."],
      ]),
      sec("New in version 2.9.8.8.1", [
        ["Layerscape", "Turn a photo into a layered, slot-together diorama. Beginner: the Layerscape button in the toolbar (it takes the Helmet Maker's place there; the Helmet Maker is still in CosForge and in Advanced → Simulate). Advanced: Simulate → Layerscape. Paint, wand, lasso or horizon-select the pieces, check the build in a 3D preview, set the size, material thickness, kerf, stage and backdrop shapes, then export a laser cut kit (SVG sheets), printable art with an assembly guide (PDF) or a 3D print kit (3MF and STL). Comes with example scenes and its own tutorials."],
        ["Part of your design", "Layerscape keeps the diorama with your JumpStart 3D design, so it's there when you open the design again (it's saved when you press Save in Layerscape or go back to JumpStart 3D). Add to my design puts every part in your design, assembled as the finished diorama and coloured from the photo, ready to move, change and export. Its files save the same way as everything else in JumpStart 3D, on an iPad too, and it follows the app's light or dark look. It works offline."],
      ]),
      sec("New in version 2.9.8.8", [
        ["Helmet Maker", "A new guided mode in CosForge for building a contemporary sci-fi helmet (Helmet Maker in Beginner's toolbar, Simulate → Helmet Maker in Advanced, or the Helmet Maker button inside CosForge). Size: pick a head size or type the distance around the head, and for a closer fit front to back, ear to ear and chin to crown; choose room for padding (snug, comfort, foam pads or headset) and the shell thickness, and see the inside and outside sizes, whether it fits your printer, and whether a head gets through the bottom. Split front / back or Auto-cut to fit in one click. Style: a library of 12 new original helmets (Nova Explorer, Vector Racer, Orbit Pilot, Specter Recon, Titan Heavy, Cyber Runner, Drift Trooper, Aegis Guard, Abyss Diver, Mech Jockey, Stealth Ops, Astro Scout), plus every other sci-fi helmet, free to print; your size stays when you change style. Add a reference picture behind the head from the front or side to match a design. Visor: full, eye, wraparound, V, split eyes, T, slit, open or closed, sized with sliders, with an optional separate lens; or draw your own visor with a finger, mouse or Pencil, or trace one from a picture (auto trace, with Simplify and Make both sides match). Details: ear pods, antennas, a top crest, chin and cheek vents, side lights and a brow camera in one tap, plus panel lines, light lines, ridge, edge, texture, emblem and rivets. Look: colours and a finish (paint, gloss, matte, PLA, PETG, silk, rainbow or two-tone silk, chrome, brushed metal, gunmetal, titanium, gold, carbon fibre), glowing or metal accents and a tinted lens, then Render a photo-style picture and save it as a PNG. Form, Sculpt, Cut & Join and Export work as in CosForge."],
        ["13 new tutorials", "Beginner: an LED push-light lamp with its own laser-cut acrylic name panel (made for the round 69 mm push lights sold at dollar stores), an LED strip lamp (10 mm strips), a hanging lamp, a holiday ornament, a stacking bin set and a planter with a saucer. Advanced: the same three LED lamps built with sketches and features (including a traced picture engraved in the acrylic), a key rack with hooks, ribs and keyhole slots, a shelf bracket with gussets and countersunk holes, woodworking jigs, and a drawer cabinet with dovetail rails, plates and clips."],
        ["Laser cutting files", "Export → Laser cut (SVG) or (DXF) turns flat parts (an acrylic panel, a sign, a stencil) into files for a laser cutter: outlines and holes as red cut lines, recesses on top (text, pictures) as black engraving."],
        ["Pattern features", "Advanced Pattern features now repeats ribs (gussets) and keyhole slots too."],
      ]),
      sec("New in version 2.9.8.7.3", [
        ["Jig Maker", "Workshop → Jig Maker makes woodworking jigs ready to print. There are six kinds. A miter box has saw kerfs at 90°, 45° (both ways) and 22.5°, sized to your stock and saw, with optional ears to screw it down. A self-centring dowel jig fits over the board, with guide holes for 6, 8 or 10 mm or inch dowels, spacing you choose and an end stop. A pocket-hole jig has 15° guides for 1/2 to 1-1/2 inch boards and tells you where to set the bit's depth collar. A try square has a ruled blade in mm or inches and a 45° shoulder. Angle templates come with a fence for setting saws and marking. A drill guide has labelled holes and a V groove for round stock. Dowel and pocket-hole guides can be sized for steel bushings. Double-click a jig to change it later."],
      ]),
      sec("New in version 2.9.8.7.2", [
        ["Box Maker dovetail fit", "When boxes join with dovetail rails, stacked or side by side, choose how they fit. Snug leaves a 0.15 mm gap around each rail: a firm push, very little wobble. Normal (0.25 mm) slides easily on most printers. Loose (0.4 mm) slides freely, for printers that run tight or for PETG. Plates in grooves follow the fit you choose, so they still fit with their own Plate fit."],
      ]),
      sec("New in version 2.9.8.7", [
        ["Rib tool", "Advanced Create has a Rib tool for reinforcing parts. Click where the rib starts and where it ends on a flat face. Straight ribs stiffen a floor or wall. Gussets are triangles that brace a corner, so start one against the wall. You set the height, thickness and count, plus the spacing for several side by side. Double-click it in the timeline to change it later."],
        ["Keyhole slot", "Advanced Create has a Keyhole slot tool for hanging parts on screws. Click a flat face (usually the back) where the screw head goes in. Each keyhole has a round head hole and a slot running up from it, with a hidden channel behind a lip that the screw head hooks behind. There are sizes for M3 / #6, M4 / #8 and M5 / #10 screws or custom sizes, the slot can point up, down, left or right, and you can place several at once."],
        ["Box Maker: plates on all four sides", "One click puts joining plates on every side: over the rails on top and the right, and in the grooves underneath and on the left. Click it again to remove them all."],
      ]),
      sec("New in version 2.9.8.6", [
        ["Box Maker plates in grooves", "Box Maker now offers both kinds of joining plate. Plates over rails have dovetail grooves and slide over the open rails, on top of cases side by side or up the right side of a stack. Plates in grooves are new: they have dovetail rails and slide into the open grooves, under two cases side by side (lifting them 2.4 mm) or up the left side of a stack. Both kinds slide on from the back, stop at the front, use the same snug Plate fit (Tight, Snug or Loose) and print flat."],
      ]),
      sec("New in version 2.9.8.5", [
        ["Box Maker rail plates", "A new Rail plates option joins boxes using their open dovetail rails. A plate with two dovetail grooves slides on from the back over a rail of each of two boxes and stops flush with the front. Choose On top (across the tops of cases side by side, when they stack with dovetails), On the side (up the right side of a stack, when boxes join side by side with dovetails), or Both. The grooves fit snugly by default, with about 0.12 mm around each rail, so a plate slides on with a firm push and stays put. Plate fit lets you pick Tight (0.08 mm) or Loose (0.2 mm) to suit your printer. The plates are separate parts that print flat, grooves up."],
      ]),
      sec("New in version 2.9.8.4", [
        ["Box Maker lock clips", "When boxes join with dovetail rails (stacked cases, or bins and cases side by side), turn on Lock clips. Small plates press onto the backs across each dovetail join, with a peg in each box, so the boxes can't slide apart along the rails when you grab one. The clips are made as separate parts that print flat with their pegs up. Pull a clip off to slide the boxes apart."],
      ]),
      sec("New in version 2.9.8.3", [
        ["Box Maker door pins", "The pin on top of a Box Maker door is 0.8 mm shorter, so the door is easier to snap into the case, and both door pins have rounded tips."],
        ["3D-print filament appearances", "Appearance has a new 3D-print filament group: PLA, PLA matte, PETG, PETG translucent, TPU (flexible) and Silk PLA. Silk rainbow shows the colors running up the part in bands, repeating 1 to 4 times. Silk two-tone gradient fades from a bottom color to a top color that you pick. Like all appearances, these only change how parts look on screen and in rendered pictures."],
      ]),
      sec("New in version 2.9.8.2", [
        ["Seasonal & holiday textures", "The Texture tool has four new groups with 50 picture textures: Seasons (snowflakes, fall leaves, acorns, suns, spring flowers, rain, beach), Holidays (snowmen, Christmas trees, nutcrackers, candy canes, ornaments, gingerbread people, holly, reindeer, jack-o'-lanterns, ghosts, bats, spider webs, turkeys, Valentine hearts, Easter eggs and bunnies, shamrocks, fireworks, dreidels), Celebrations (birthday cakes, balloons, gifts, confetti, anniversary rings and hearts, graduation caps, baby) and Animals (squirrels, chipmunks, rabbits, birds, owls, deer, butterflies, fish, cats, paw prints, woodland mix). The pictures stand up from the surface and repeat seamlessly; use Tile size to make them bigger or smaller, Depth to set how far they stand up, and Engrave to cut them in instead."],
      ]),
      sec("New in version 2.9.8.1", [
        ["Box Maker door catch:", "small round bumps on the case beside the door's free edge hold the door shut, so it doesn't swing open by itself: it clicks closed and needs a little pull to open. Pick None, Light or Firm."],
        ["Fixed:", "the door stop strips added in 2.9.8 were being cut away with the inside of the case, so they weren't really there; they are now."],
      ]),
      sec("New in version 2.9.8", [
        ["Box Maker grids:", "set how many across as well as how many high, to build a grid of bins or cases (up to 8 × 8). Side by side they join with dovetail rails on the right side that slide into grooves in the next one's left side from the front and stop flush, or with pegs, or not at all. Each one is named by its place in the grid (A1, B2…)."],
        ["Doors open outwards only:", "a stop strip runs just behind the door along the case floor, ceiling and far side, so the door can't swing back into the box."],
      ]),
      sec("New in version 2.9.7.1", [
        ["Box Maker doors:", "pick the door's pull: a knob, a finger hole through the door, or a bar. The back of the door is now completely flat (the knob no longer pokes out the back, and the hinge pins are no thicker than the door), so it prints lying on its back; Laid out to print lays it that way."],
      ]),
      sec("New in version 2.9.7", [
        ["Box Maker fixes:", "placing a set no longer climbs onto its own drawers and cases and tips over; typing a size waits until you pause before rebuilding (no more flashing \"too small\" errors); the panel keeps your place when it redraws; making a set smaller (fewer cases, no lid, another style) now really removes the extra parts."],
        ["Box Maker sets in Beginner:", "a click picks the whole set (cases, drawers, bins, doors and lid) so it moves and deletes as one, the side panel shows it as one set with Edit in Box Maker (instead of a Group button that would have merged it), and double-clicking it opens the Box Maker to change it."],
      ]),
      sec("New in version 2.9.6", [
        ["Beginner toolbar:", "Neon Sign and Box Maker are on the Beginner toolbar now, in place of Chip Carve, Lathe and Stained Glass. Those three are still in Advanced (Design ribbon → Workshop, and the Simulate tab), and the Spinning top lathe tutorial has moved to the Advanced tutorials."],
      ]),
      sec("New in version 2.9.5", [
        ["Bin & Box Maker styles:", "besides open bins, make a case with a drawer (with compartments and a bar, knob or finger-notch pull), a case with a tilt-out bin that tips forward on two pins and stops at about 30°, or a case with a door that swings on pins top and bottom (hinged left or right)."],
        ["Stacking:", "make up to 8 units stacked one on another. Cases interlock with dovetail rails that slide into grooves under the case above and stop flush, or with pegs; open bins lock with a rim and foot. Show them assembled or laid out to print. Each case and each drawer, bin or door is its own body, and double-clicking any of them opens the maker again."],
      ]),
      sec("New in version 2.9.4", [
        ["Architect, Show:", "a menu next to See-through (or the A key) picks how the house is shown: this level with the others faded (as before), the whole house solid with nothing see-through, or cut away above this level, with no roof and no floors above, so you look down into the rooms."],
        ["Staging camera (C):", "stand inside the house at eye height. Drag to look around, walk with W A S D or the arrow keys (or the on-screen pad on a tablet), step with the wheel or a pinch, and double-click a floor to walk there. The level menu takes you up or down a floor. Pick a lens (extra wide to close) and an eye height (child, seated, standing, tall)."],
        ["Photos of the inside:", "Take photo (or Space) renders the view at the size you pick (this window, HD, 4K, square or portrait) without the grid or handles; photos collect in the panel to save as PNG pictures, one at a time or all at once."],
      ]),
      sec("New in version 2.9.3", [
        ["Neon Sign Builder projects:", "Save project keeps the whole sign (words, shapes, traced pictures, tubes, backing, printer and light show) in a file you can Open again; New starts fresh. Your last sign also comes back by itself the next time you open the builder in the same browser."],
        ["Undo, redo, cut, copy, paste and delete:", "buttons at the top and the usual shortcuts: Ctrl/⌘ Z, Ctrl/⌘ Shift Z or Ctrl Y, Ctrl/⌘ X, C, V, D (duplicate), S (save), O (open), Delete, and the arrow keys to nudge a part (Shift for 10 mm)."],
        ["Light show fix:", "the builder no longer freezes with Strobe (or other patterns) running: the glow is drawn in a few pieces instead of three per tube, at about 30 frames a second, and a steady sign isn't redrawn at all. Strobe now flashes at most 3 times a second, a safer rate for people sensitive to flashing light."],
      ]),
      sec("New in version 2.9.2", [
        ["Greenhouses (Architect → Furniture → Greenhouses):", "glass greenhouses 8' × 10' and 12' × 16', a hoop house, a Victorian conservatory, a lean-to that backs up to a wall and a cold frame, each with benches and plants inside, plus potting benches, seedling shelves, raised beds, a lemon tree, orchids, hanging baskets, a rain barrel, a wheelbarrow and a compost bin."],
        ["Luxury:", "a four-poster canopy bed, Chesterfield sofas, a chaise, crystal chandeliers, a white concert grand, a marble fireplace, a stone tub, a gold rain shower, a waterfall marble island, a pro range, a wine wall and wine fridge, a library wall with a ladder, home theater seats, a sauna, a pool, a fountain, a statue and gold mirrors. Finishes adds luxury picks (marble, black marble, chevron parquet, travertine, cut stone, mosaic, fluted, coffered, wainscot, walnut, copper and gold) and an All floors button."],
        ["Food & table:", "26 small things (place settings, pizza, a birthday cake, a turkey, sushi, a cheese board, wine and more) that sit on top of whatever table, counter or shelf you put them on, and move with the table when it moves."],
        ["People:", "men, women, children and a toddler standing, walking, waving and sitting, an older man with a cane and a person in a wheelchair, with a range of skin tones."],
      ]),
      sec("New in version 2.9.1", [
        ["Neon Sign Builder:", "Advanced → Simulate → Neon Sign Builder opens in its own window with a neon theme. Type words (the Neon '80s script and 11 more fonts, centre-line tubes or outlines, several lines), add shapes (hearts, stars, lightning, palm trees, cocktails and more) or trace an image."],
        ["Shells for LED strips:", "each line becomes a rounded, glass-tube-like shell sized for the LED strip you pick (neon flex 6 × 12 or 8 × 16, COB 5 or 8 mm, RGB 10 mm or RGBW 12 mm, or your own), with a snap-fit ridge and a warning where a bend is too tight for the strip."],
        ["Backing that the shells snap into:", "follows the design like acrylic, or a rounded rectangle, circle, oval, pill, arch, hexagon, cloud, speech bubble or a shape from your design, with grooves for the shells, wire holes and hanging holes."],
        ["Bigger than the bed:", "pick your printer: a big sign is cut into pieces that each fit, with dovetail joints in the backing. Export the shells and backing as STL or 3MF, all at once or piece by piece."],
        ["Light show:", "turn the sign on in a dark room: any colour or RGB, steady, breathe, blink, old neon flicker, chase, one at a time, writes itself on, strobe, rainbow and colour wave."],
      ]),
      sec("New in version 2.9.0", [
        ["Stairs and steps:", "Architect → Stairs (K): straight, L-shaped with a landing, U-shaped (switchback), spiral, grand and outdoor steps, with or without a railing. They climb to the level above and cut its floor for you; Q turns them."],
        ["Floor openings:", "Architect → Floor hole (H): drag across the floor of the 2nd or 3rd floor (or any level) to cut an opening: a stairwell or a two-storey hall. Floors with openings go to Beginner and Advanced with the holes cut."],
        ["Railings:", "Architect → Railing (J): wood or black metal balusters, glass panels, cable rail, modern bars, colonial spindles, wrought iron or a pipe handrail, at 36\" or 42\". Stairs and porches use the same styles."],
        ["Porches:", "Architect → Porch (Y): drag a porch beside the house. It gets a deck, posts (square, round columns, craftsman, slim metal or log), beams, a railing, steps down at the front and its own roof (shed, gable, hip or flat) that is separate from the house's roof."],
        ["Arched doors:", "arched interior, front and double doors and arched openings (4' and 8') with round-topped frames and leaves, in Architect and in the Floor Planner."],
        ["Floor Planner:", "a third floor; floor openings; L-shaped, U-shaped and spiral stairs and outdoor steps; a Railings and a Porches catalog; arched doors and round archways; all of these go across to Architect, Beginner and Advanced. Its side panels can be dragged anywhere (Move …) and docked again."],
        ["Movable panels:", "drag the Architect panel by its title bar (or its ⠿ grip, or the arrow keys on the grip) to anywhere over the view; double-click the title bar (or Home) puts it back."],
      ]),
      sec("New in version 2.8.2.9", [
        ["Floor Planner houses everywhere:", "in the Floor Planner, 🏠 Use this house in ▾ (top right, and under the 3D view) takes the house into Architect, Beginner or Advanced. Every floor becomes a level, the room outlines become walls (shared walls become one), doors, windows and openings are cut into their walls, furniture becomes the matching piece from Architect's catalog, and the roof goes over the top floor, with roofs of their own on rooms that stick out below it."],
        ["Architect, Beginner or Advanced:", "in Architect the house is ready to edit, furnish, landscape or flood-test. Beginner and Advanced get it as shapes (walls, doors, window frames, floors and roofs on each level), scaled to fit the build plate, and it stays in Architect with its furniture. Sending again replaces the house in Architect (after asking); Undo brings the old one back."],
      ]),
      sec("New in version 2.8.2.8", [
        ["No more jumping:", "adding or removing an animal (or picking a region) no longer sends the Architect panel back to the top. The panel, and the animal list in it, stay where you scrolled to, and the button you pressed keeps the focus. The same goes for every other Architect panel that redraws itself."],
      ]),
      sec("New in version 2.8.2.7", [
        ["Animals from around the world:", "Landscape → Animals now has 94 animals in eight regions: Pets & farm, North America, Tropical rainforest, African savanna, Asia, Europe, Australia, and Arctic & Antarctic. Each region lists its animals, birds, water animals and fish, and the region tabs show how many are in the yard."],
        ["New animals:", "horses, cows, sheep, goats, pigs and chickens; black bears, moose, coyotes, skunks, bald eagles and hummingbirds; toucans, macaws, parrots, spider monkeys, jaguars, sloths, capybaras, tapirs, dart frogs, iguanas and piranhas; lions, cheetahs, elephants, giraffes, zebras, wildebeest, hippos, warthogs, meerkats, ostriches, flamingos, crocodiles and tilapia; giant and red pandas, tigers, snow monkeys, peacocks, cranes, mandarin ducks and koi; red deer, hedgehogs, badgers, wild boar, wolves, European robins, storks and trout; kangaroos, koalas, wombats, platypuses, dingoes, kookaburras, cockatoos, emus and barramundi; polar bears, arctic foxes, reindeer, emperor penguins, snowy owls, seals and arctic char."],
        ["How they live:", "elephants and giraffes eat leaves from the trees, pandas eat bamboo, koalas and sloths stay up in the trees, monkeys and red pandas climb onto the roof, flamingos, storks and cranes wade in the shallows, hummingbirds drink from flowers, eagles catch fish, and the hunters (lions, tigers, wolves, dingoes…) stalk the animals that run from them. The Ohio backyard mix button is gone: add the animals you want from each region."],
      ]),
      sec("New in version 2.8.2.6", [
        ["Full color (CMYK) printing:", "in the 3D Print Sim, Full color (CMYK) mixes any color from cyan, magenta, yellow, black and white filament (4, 6 or 8 layers to a mix): the walls change ink layer by layer and the skins line by line, so each body comes out as its own color. It shows each body's mix, the filament changes and the grams purged, and the G-code changes tools to match."],
        ["Animals in Architect:", "Landscape → Animals: pets (a cat and a dog) and Ohio wildlife (white-tailed deer, cottontails, chipmunks, gray and fox squirrels, red fox, raccoon, groundhog, opossum, cardinals, blue jays, robins, goldfinches, mourning doves, a woodpecker and a red-tailed hawk), plus mallards, Canada geese, bullfrogs, box turtles and fish (largemouth bass, bluegill, catfish and yellow perch) in the ponds. They walk over the hills, stop to eat grass and plants, climb trees and the house, fly from perch to perch and run from the dog and the fox. Real size, or ×2 and ×3 to spot them."],
        ["Roofs keep the rain out:", "the flood test now checks the roof. Rain falls straight into a house with no roof, or where the roof doesn't reach over the walls or a level has none of its own, and a pitched roof flatter than 2 in 12 leaks; the water shows on the floor. Fix it puts a roof over the whole house."],
      ]),
      sec("New in version 2.8.2.5", [
        ["Action figures in Chisel:", "under Action figures, pick Hero, Heroine, Kid, Chibi, Robot, Alien or Mannequin, set the height, build, head size, shoulders and arm and leg length, and get a figure of 15 parts joined by 14 snap-fit ball joints (neck, shoulders, elbows, wrists, waist, hips, knees and ankles). Each part is its own sculpt to shape and paint."],
        ["Joints that print:", "every ball sits in a socket a little bigger than it (Tight 0.1, Standard 0.15 or Loose 0.25 mm), behind a mouth narrower than the ball so it snaps in and holds a pose, and the parts never touch at rest. Lay out to print puts the parts side by side on the floor; figure parts keep their full detail in the design and in exported files."],
        ["Ball joint kit:", "a ball on a peg, a housing and a socket cutter, to join parts you sculpt yourself (with Combine → Join and Subtract)."],
        ["12 Chisel tutorials:", "Tutorials now has a Chisel tab: pebble pet, monster head, snowman, mountain, cat, alien, an animated dog, a bird, a planet, and three for action figures (a first figure, a custom one, and one jointed from scratch). Show me points at the tools inside Chisel."],
      ]),
      sec("New in version 2.8.2.4", [
        ["Gears:", "Advanced → Insert → Gears (also in Workshop and Simulate): accurate involute spur gears, gear pairs, ring gears with a pinion, rack and pinion, and planetary sets (sun, planets and ring), in module sizes 0.8-3 with any number of teeth, 14.5°, 20° or 25° pressure angle, round, D-shaft, hex or keyway bores, hubs and lightening holes. Backlash for printing is built in."],
        ["Gears move:", "each gear gets a joint linked to its neighbour by the tooth ratio, so Simulate → Motion study turns the whole train (and slides the rack) from any one gear, and checks the teeth for collisions."],
        ["Folders in the Browser:", "+ Folder puts the selected bodies in a folder. Drag bodies onto a folder (or out of it), open and close it, double-click to rename, hide or show it all at once, and click it to select everything in it."],
        ["Copy and place sketches:", "select a sketch in the Browser, Ctrl+C then Ctrl+V (or Copy & place…), and click any flat face, plane or the ground to put a copy there, turned by Spin. Place as many as you like."],
      ]),
      sec("New in version 2.8.2.3", [
        ["Furniture in Architect:", "a new Furniture tool (U) with over 200 things to place in the rooms: sofas, beds, dressers and desks, kitchen cabinets, sinks, ranges and fridges, toilets, vanities, tubs and showers, washers and dryers, lamps, rugs, plants, outdoor and garage things, stairs and more, in 15 groups with a search box. Everything in the Floor Planner's catalog is there at the same sizes."],
        ["It finds the wall:", "beds, sofas, cabinets, toilets, tubs and other things that stand against a wall turn and back up to the nearest wall by themselves (hold Shift to put one anywhere). Q turns a piece, arrow keys nudge it, and each piece can be recoloured, duplicated or deleted."],
        ["Furniture on the plan and in the print:", "the Floor plan drawing (PDF, SVG, DXF) draws the furniture from above, and Export puts it in the 3MF, OBJ or STL with the house and landscape."],
      ]),
      sec("New in version 2.8.2.2", [
        ["Clearance picks bodies:", "click or tap bodies while Clearance is open to choose which ones to check (again to drop one), drag a box around several, or click them in the Browser. The chosen bodies stay highlighted."],
        ["Safari:", "the downloaded app also opens in older Safari on iPad and Mac (before 16.4). Built shapes saved in a project file or remembered by the browser are found again in any browser, Safari and Chrome alike."],
        ["Tablet & Pencil mode:", "turn it on from the Customize menu under Device, or the Tablet & Pencil mode button in About."], // jumpstart-3d: Customize replaces the theme icon
        ["Slow bodies show sooner:", "while a very slow body builds (many curved cuts or offset curved faces), it is shown see-through as it was a step or two earlier, usually within seconds, and the finished shape takes its place when it is ready. Save once it has built: the saved file carries the built shape, so it opens in seconds on any computer or iPad."],
      ]),
      sec("New in version 2.8.2.1", [
        ["Tablet & Pencil mode:", "for iPad and other tablets, in the Customize menu under Device. The Apple Pencil works like a precise mouse: tap to pick, draw sketch lines, drag handles and selection boxes, and on iPads with pencil hover, shapes light up as the pencil comes near. Fingers move the view: one finger orbits, two pan and pinch to zoom, and a tap still picks; a hand resting on the screen while you draw is ignored. A two-finger tap undoes, a three-finger tap redoes and a long press opens the right-click menu. Keys on the left of the view stand in for a keyboard: Undo, Redo, Shift (the next pick adds to the selection; tap twice to keep it on), Delete, Esc, OK and Fit. It uses the Tablet layout with bigger buttons, and turning it off brings back your layout. Tablets suggest it the first time."], // jumpstart-3d: Customize replaces the theme icon
      ]),
      sec("New in version 2.8.2.0", [
        ["Step through the timeline:", "the Advanced timeline has ⏮ ◀ ▶ ▶ ⏭ buttons. Step back and forward to see the design as it was after any step (later steps are dimmed and the current one is outlined), click a step to jump to it, or press Play to watch the design being built step by step. Only the view changes: your design isn't touched, and opening a tool or exporting goes back to the finished design."],
        ["Slow bodies no longer stop:", "a body with many curved cuts or offset curved faces builds in the background with no time limit (a slower computer just takes longer), and you can keep working meanwhile. Stop and Why so slow? appear in the status bar while it builds, and About → Slow bodies has tips for making such bodies quicker."],
      ]),
      sec("New in version 2.8.1.9", [
        ["Designs open faster:", "a body with several cuts in a row has them all cut in one step instead of one after another (the spiral fidget cone's five spiral cuts: 30 s down to 15 s). A body that took a while to build is remembered in this browser, so the design opens in about a second the next time, and a saved project file carries the built shape of slow bodies (10 s or more), so it opens quickly on any computer. While a slow body builds, the bottom bar shows its name and how long it has taken. Bodies with many offset curved faces get enough time to finish instead of stopping with \"stalled the geometry engine\"."],
        ["Ribbon:", "Offset face and Clearance are in Advanced Modify (Q still opens Offset face). Chip Carving and the Lathe are in the Workshop menu at the right end of the Design ribbon."],
      ]),
      sec("New in version 2.8.1.8", [
        ["Clearance:", "a quick tool for parts that move (Advanced Modify → Clearance). It finds every pair of bodies that touch or overlap (a wheel on its axle, a pin in a hinge, a ball in its socket, a lid in its box) and cuts a small gap into one of each pair, so they print loose instead of fused. Choose Snug (0.2 mm), Normal (0.3 mm) or Loose (0.5 mm), or type your own; untick pairs that should stay joined, and pick which part gets the gap (the bigger one by default). Each gap is a feature in the timeline that you can edit or delete."],
        ["Offset face on a whole body:", "drag a box around a body to pick every face at once. The whole body then grows or shrinks by the distance, with rounded outside corners when it grows, and holes shrink or grow to match. Click faces as before to offset only some of them."],
      ]),
      sec("New in version 2.8.1.7", [
        ["Smoother, more accurate STL and 3MF files:", "exports used to reuse the light mesh drawn on screen, so curves came out as visible flat facets in the slicer. Each body is now meshed again from its exact shape just for the file. Choose the quality in Open/Export: Standard (within 0.05 mm, smaller files), Fine (within 0.02 mm, the default) or Extra fine (within 0.008 mm, largest files). Curves follow the true shape about three times more closely, the files stay closed (watertight) for slicers, and textures are still applied. STEP files are exact, as before."],
      ]),
      sec("New in version 2.8.1.6", [
        ["10 bigger tutorials:", "for Advanced mode, each making two or more parts with many tools, about 18-28 minutes. Advanced: Birdhouse with a lift-off roof, Round keepsake box (split into box and lid), Headphone stand with a cable clip, Fidget cone with spinning rings, Robot with plug-in arms. Expert: Link bracelet that prints already linked, Toy car with spinning wheels, Electronics case with a screw-on lid, Chess king and queen, Spiral fidget cone that spins on a base."],
        ["Pattern → Features:", "any face made by a revolve or a sweep (twisted ones too) can now be clicked to pick that feature, like in Fusion 360, and the feature's real outline is highlighted. Twisted sweeps along a straight line are built as exact helical sweeps: much faster, so a circular pattern of spiral cuts (a spiral cone) builds in seconds instead of minutes, and bodies with several curved cuts get more time before the engine gives up."],
        ["Revolve:", "points typed a hair off the axis (from rounded lengths and angles) are put onto the axis, so the outline revolves instead of failing."],
      ]),
      sec("New in version 2.8.1.5", [
        ["3D Sketch lines:", "a long hand-drawn line now always becomes a round tube that follows what you drew. Before, the geometry engine could turn some lines into a flat, twisting band with fins or lumps; each tube is now checked against the line, tight hooks are smoothed only where they are, and a tube built straight from the line is used if the engine's is off."],
        ["Pattern on a path:", "Put the object on the path (on when the object is away from the path) moves it to the nearer end of the path, and the copies run along the whole line, like beads on a string. Go the other way starts from the far end. Turn it off to keep the object where it is, with every copy the same distance from the path."],
      ]),
      sec("New in version 2.8.1.4", [
        ["Layouts:", "five ways to arrange the tools, in the Customize menu under Layout: Default (tools across the top), Big buttons (bigger buttons with names), Clean (a slim column of icons on the left; hover for names), Classic CAD (a labelled tool palette down the right side) and Tablet (big tools along the bottom, near your thumbs). Every tool is in every layout, and the choice is remembered on this computer."], // jumpstart-3d: his "Simplified" layout reads "Big buttons" in our build
        ["Save downloads a file:", "Save (or Ctrl+S) now also downloads the project file (.json) to your Downloads, so work isn't lost when a Chromebook clears the browser at sign-out. Open it again with Open/Export → Open a project file. Turn it off in Open/Export → Download a file on every Save. The Floor Planner's 💾 Save also downloads its plan file (turn it off in 📂 My plans)."],
        ["Pinned Constraints:", "while sketching in Advanced, Pin (next to Constraints on the toolbar) puts every constraint button on the workspace as a small palette. Drag it by its title bar to wherever you like, switch between names and icons only (⤡), and ✕ to put it away. It stays pinned, where you left it, for your next sketches."],
      ]),
      sec("New in version 2.8.1.3", [
        ["Floor Planner tutorials:", "ten step-by-step projects built into the Floor Planner itself (🎓 Tutorials in its top bar, so they also work when it's opened in its own tab), in the same style as the JumpStart 3D tutorials: your first room, a small apartment, L-shapes and curved walls, a furnished bedroom, kitchen and dining, outside the house, a 3D walk-through, a two-story house, a small shop and the classroom Be an Architect job. Show me points at the button to use, steps tick themselves off, and the checklist shows your progress. Its animated tour is still there as Quick tour."],
        ["Saving in the Floor Planner:", "💾 Save (or Ctrl+S) saves the whole plan (every floor, room, item, finish and the roof) in one click: the first time you name it Last name, First name, Plan name. 📂 My plans opens, copies and deletes saved plans, saves a plan to a file to take to another computer, and opens one again. The planner also keeps your last plan by itself and offers to continue it next time."],
        ["3D Print Sim objects:", "arrange the plate like Orca Slicer. Click an object on the plate (or its name under Objects) to pick it, Shift-click to pick more, and drag it to move it. Turn it by any angle around X, Y or Z, lay it on a face, scale it (type a % or use ½× / 2×) and make copies (Duplicate, as many as you like, each set in a free spot). Arrange packs everything neatly; Reset undoes it all. These changes live only in the sim: your bodies are never moved, scaled or copied in the design. The slicing, layers, times, filament and G-code use the plate as you set it."],
        ["Advanced ribbon:", "Design has a Workshop group at the right end with Fasteners, Chip Carving and Lathe. Stained Glass is on the Simulate tab."],
      ]),
      sec("New in version 2.8.1.2", [
        ["Floor Planner:", "Architect has a Floor Planner (right end of its toolbar) that opens in its own window. It's the Blueprint Floorplanner: sketch rooms on graph paper (1 block = 1 ft) with rectangles, lines and arcs; see every side's length and each room's square feet; add doors, windows, stairs and openings; furnish and finish rooms in Design 2D (furniture, rugs, floors, wall treatments, exterior brick, stone and siding, roofs, porches, dormers, outdoor items, business and garage items, custom signs); add a second floor or a basement; walk through it in Real Space 3D; and download the plan as PNG, JPEG or PDF. Education mode adds a calculator and client jobs. Its own 3D engine is built in, so it works offline."],
      ]),
      sec("New in version 2.8.1.1", [
        ["3D Print Sim times:", "print times are now worked out the way Orca Slicer does it. Every move is timed with the printer's speeds and accelerations from Orca's own 0.20 mm profiles (Bambu Lab, Creality K1 and K2, Ender-3, Prusa MK4S, CORE One and MINI, Elegoo, Flashforge, Snapmaker U1, Voron), and corners slow down by the printer's jerk or square corner velocity. Travel moves are timed too, and short layers slow down so they can cool. The old estimate was nearly twice too long. The saved G-code now carries the same speeds and per-feature accelerations (M204), skips needless retractions inside infill, and spaces top and bottom skins one line apart so they come out solid."],
        ["Fonts:", "42 more fonts for the Text tools, in groups: bold sans, rounded, serif and slab, script and handwriting, fun and cartoon, tech and games, stencil, and old style (Old English, Wild West, typewriter…). All are open-licence fonts, credited in About."],
        ["Quick Hinge:", "add a hinge in a few clicks, without FlexiGen (Advanced → Create → Advanced Create, Insert, Simulate → Makers, or Beginner's Hinge button). Choose print-in-place (prints already assembled), a pin hinge (1.75 mm filament, an M2 or M3 screw, or a printed pin) or a living hinge, with size presets, knuckles, clearance and screw holes. Lay it on any face, spin it, then Join a leaf to your part."],
        ["Architect:", "opens in feet and inches (switch to metric there and it remembers). While drawing a wall, a box by the cursor shows its length and angle. Start typing to change them (12 = 12 ft, 12 6 = 12' 6\"), press Tab for the angle and Enter to place it. Rooms, floors and roofs take a width and depth the same way."],
        ["Beginner:", "CosForge, Chip Carve and Lathe moved to the right end of the toolbar, next to Stained Glass."],
        // jumpstart-3d: the community single file is not stored compressed (his standalone.py change is not ported), so his "Smaller file" note is left out
      ]),
      sec("New in version 2.7.10", [
        ["CosForge:", "two new themes of detailed, original costume templates: Space Opera (a full Galactic Trooper suit with vents and joints, plus a bounty hunter helmet, chest, shoulder and gauntlet, a starfighter pilot helmet and life-support vest, a dark knight lord helmet, breath mask, chest armor and gauntlets, a forest scout helmet, protocol droid head and torso plating, and a hard-light shield) and Superhero Armor (a full Reactor powered-armor suit with glowing core, plus a shield hero helmet, chest and star shield, thunder god helm, cuirass and bracers, panther suit mask, chest and gauntlets, heavy armor helmet, chest and shoulders, and a valkyrie winged helm and circlet). Inspired by film and comic styles; no film or comic designs are copied."],
        ["Square mission lamp:", "a new Stained Glass shade: a four-sided, craftsman-style shade with a square tapered column base. Its Mission design pattern gives tall cream strips, an amber top band and diamond, and a lower band of green stripes, orange chevrons, amber diamonds and a green X on each side. It works with the snap-fit kit, painting, the other piece patterns and all the exports."],
        ["Bulb fittings:", "Stained Glass lamps can take real lamp hardware. Pick an E26 medium socket (the standard North American bulb), E27, E12 candelabra, or a harp or 1/8 IPS / M10 lamp rod, and a fitter plate is made for it: a collar sized for the socket's shade ring (40.5 mm for E26, adjustable), with spokes out to a ring on the shade's rim. Put it at the top (a spider, to hang the shade or set it on a harp or rod) or at the bottom (the socket stands on the base and the bulb points up). The lamp base gets a 10.5 mm hole down the middle for the rod and cord, and the view shows where the socket and bulb go. The fitter exports with the other parts."],
        ["Stained Glass:", "its button now sits at the far right of the ribbons (Design and Simulate) and of Beginner's toolbar."],
      ]),
      sec("New in version 2.7.9", [
        ["Stained Glass Studio:", "a new studio in its own window (Advanced's Create group and Simulate → Makers, Beginner's toolbar and Chisel). Turn the selected object into a glass statue, or make a Tiffany-style lamp from a dome, cone, bell, tulip, lantern, globe or vase shade (with a lamp base). Cut it into Tiffany pieces, panels, diamonds, bricks or rings; set the glass thickness (thinner lets more light through), the frame width and thickness, and the frame look (lead, copper foil, brass, black, silver); paint the pieces with glass colours or whole palettes; see it lit from inside, cathedral or opalescent."],
        ["Picture to stained glass:", "open a PNG, JPG or SVG picture: it is reduced to a few glass colours, its dark outlines become the lead lines, and big areas are cut into simple pieces a glass cutter could make. Make a flat panel (rectangle, circle or oval, arch, or the picture's own outline) or wrap the picture around a lamp shade."],
        ["Snap-fit stained glass kits:", "the frame prints as one part with a ledge under the glass and a divider between the pieces; every glass piece prints on its own, in any colour, and clicks into its own opening under small snap bumps (with a fit clearance you set). Export every part as its own STL (with a numbered piece map), one STL per colour, 3MF with every part coloured, or OBJ, or add it to the design."],
        ["3D Print Sim exports G-code:", "set the printer's G-code style (Marlin, Klipper, Prusa or Bambu Lab), nozzle and bed temperature, fan, speed (Silent to Ludicrous), skirt, brim, retraction and Z hop, then Export G-code: a real .gcode file with the walls, infill, skins, supports, travel moves, cooling, progress and the feature comments Orca Slicer uses, ready to copy to the printer's SD card or USB stick or send with its app."],
        ["Picture on a face:", "Insert → Image on a face: click a flat face of a body and the picture is put on it, sized to fit, ready to trace by hand or with Auto trace (tick Auto trace it after placing), then extrude, emboss or cut."],
        ["Architect windows:", "33 more windows: colonial, double hung, farmhouse, craftsman, prairie and diamond grilles, awning, hopper, clerestory, floor-to-ceiling, triple and double casements, glass block, arch-top, half-round, Palladian, octagon and porthole, and 14 stained glass windows (rose, gothic arch with tracery, church lancet, wheel, Tiffany floral, leaded diamonds, prairie, sunburst, art deco, mosaic, porthole, octagon, Victorian transom, entry sidelight). They send to Beginner and Advanced with their frames, muntins and lead."],
        ["CosForge:", "four new traditional themes with full suits of armor and detailed helmets: Medieval Plate (close helm, great helm, bascinet, sallet, barbute, armet with plume, and every plate down to the sabatons), Roman Legion, Ancient Greek and Norse."],
        ["Fasteners:", "now also in Advanced Create (Advanced Create → Fasteners)."],
      ]),
      sec("New in version 2.7.8", [
        ["Sketch inside a body:", "when a sketch plane runs through a body (a sketch on an offset plane inside a box, say), the part of the bodies between you and the plane is sliced away, like Fusion 360's Slice, so the sketch can be seen and drawn on. It stays on while you Extrude from the sketch (the view isn't changed back), and the Slice checkbox in the Sketch palette turns it on or off. A circle extruded inside a body now joins that body instead of being lost inside it."],
        ["Sketches tidy themselves:", "a sketch used by a feature (also a sketch you showed again to use once more) is hidden once the feature is made, and while you edit a sketch, other sketches on the same plane are not drawn on top of it."],
        ["Sweep like Fusion 360:", "the path can be sketch curves, a 3D Sketch line or body edges (picked one by one, joined end to end); an optional Guide rail turns the profile to follow a second curve and, with Scale on, grows or shrinks it to keep touching the rail; the path and rail sketches stay visible while you pick."],
        ["Joining many bodies:", "Combine (Join) and patterns fuse many bodies in one go and check the result, so a ring of 64 ribs joined to a hollow planter no longer disappears (a piece that can't be fused is kept rather than lost)."],
        ["Fasteners library:", "Insert → Fasteners (and Simulate → Makers): hex bolts, socket head, button head, flat head and set screws, wood screws, threaded rod, hex, nylon lock and square nuts, flat and split washers, heat-set inserts and dowel pins, in metric (M2 to M20) and inch (#4 to 1/2\") sizes and standard lengths, with optional modeled threads. Point at a round hole to drop the part into it, lined up; the panel shows the clearance and tap drill sizes. Double-click it later to change it."],
        ["Bin & Box Maker:", "Simulate → Makers: small part bins and organisers with a grid of square, round or hex compartments, walls, floor, corner radius, finger scoops, label lips, a stackable foot and a lid with fit clearance. Double-click the bin later to change it."],
        ["Pattern on a 3D line:", "Pattern on path can follow a 3D Sketch line, with the copies turning to follow it, and can hide the line afterwards."],
        ["Architect plants:", "51 more trees, shrubs, flowers, garden pieces and rocks for the landscape (magnolia, jacaranda, ginkgo, olive, Japanese maple, giant redwood, cedar, poplar, acacia, baobab, coconut and date palms, bamboo, citrus trees, topiary, lilac, holly, sunflowers, poppies, a vegetable bed, corn, pumpkins, bonsai, a bird bath, logs, stumps and more), with a new Garden group."],
        ["CosForge:", "a new Military theme (combat and pilot helmets, field respirator, plate carrier, duty belt, guards, pads and boots: protective gear only) and 16 more Sci-Fi parts (helmets, exo-suit armor, hover pack, holo bracer, grav boots and a hard-light shield). CosForge has no firearms or other weapons."],
      ]),
      sec("New in version 2.7.7", [
        ["Shell for any shape:", "Shell and Hollow now work on complex shapes: shapes with holes through them, branches and bosses, joined shapes, free-form and organic bodies, tori, and curved openings (open a round side, not just a flat end). When the exact offset can't make the wall, a new distance-field method builds it from the distance to the kept faces, so it works on any closed shape; flat and round shapes keep their own surface exact. It takes a few seconds."],
        ["Shell options:", "pick opening faces on several shapes at once (each gets its own shell); Hollow can add 1, 2 or 4 drain holes through the bottom (for resin and powder printing) with the size you set; and Method (Auto, Exact offset, Slices, or Any shape with Normal or Fine detail) lets you choose how the wall is made. Auto tries them in turn."],
      ]),
      sec("New in version 2.7.6", [
        ["Shell on lofts:", "Shell and Hollow now work on lofted shapes that the offset engine couldn't handle, such as a loft from a hexagon on one plane to a circle on an offset plane. When a shape has free-form sides, the wall is built from slices across the shape (each slice's outline is offset in its own plane and the slices are lofted back together), with Inside, Outside or Both and openings on flat ends. It is also much quicker to give an answer."],
        ["Tangent chain fix:", "Shell's Tangent chain no longer takes every face of a curved (lofted) body: curved faces' directions were compared wrongly, which also hid some real edges between curved faces in the view."],
      ]),
      sec("New in version 2.7.5", [
        ["Chip Carving:", "a new woodcraft simulator (Simulate → Woodcraft, Advanced's Create group, Beginner's toolbar and Chisel). Carve a board, a round plate, a log or a shape from your design, in basswood, butternut, white pine, mahogany, cherry, black walnut, hard maple or red oak (harder woods cut less deep). Knives: corner chips (three-corner, four-corner and diamond) that pop out as real chips, V-cut lines, curved sweeps with a stop cut, and a stab knife; plus a pencil and eraser for layout lines, layout guides (square or triangle grid, rosette, border band) and a sanding block. A pen's pressure sets how deep each cut goes and its tilt the blade angle; with a mouse or finger the Pressure slider does. Fingers can carve or, once a pen is used, move the view. A raking light shows the facets. Add the carving to your design or export STL, 3MF or OBJ."],
        ["Roland MDX-50:", "CAM Studio has Roland MDX-50 profiles (with the 5-tool changer, and with the ZCL-50A rotary axis) and a Roland NC code post processor for MDX-series mills."],
      ]),
      sec("New in version 2.7.4", [
        ["Sketch line style:", "choose how thick sketch lines are (Hairline, Thin, Medium, Thick or Extra thick) and their colour (the theme's own colour, or black, white, blue, red, green, orange, purple, yellow or cyan) in the Customize menu, under Sketch lines. It applies in Advanced, Beginner and Chisel and is remembered. The new default, Thin, is thinner than before."], // jumpstart-3d: Customize replaces the theme icon
        ["Shell → Hollow:", "the Shell tool now has two types. Openings removes the faces you click (an open box or cup); Hollow makes the whole model hollow inside, closed all round, with a 2 mm wall to start that you can change (quick picks 1, 2, 3 and 5 mm). Hollow works on the selected shapes, or click shapes to add them."],
        ["Shell and Fillet in Beginner:", "Beginner's toolbar has Fillet (click edges or a face, or Round all edges of the shape) and Shell (Hollow to start). The shape's panel lists its fillets and shells with Edit and Remove, plus Round edges and Make hollow buttons. Fillet and Chamfer in Advanced have the all-edges button too."],
        ["Hollow in Chisel:", "a new Hollow tool (in Easy and full Chisel) makes a sculpted model hollow inside with the wall thickness you choose."],
      ]),
      sec("New in version 2.7.3", [
        ["No more stray planes:", "fixed flat \"planes\" that could appear across a model after an extrude, offset or cut and couldn't be removed. They were a drawing fault on some round faces (a cylinder band, for example), not part of the solid; those faces are now checked and redrawn correctly, on screen and in exports. Files that showed them look right as soon as they are opened."],
        ["Pattern features, like Fusion 360:", "with Objects set to Features, click a face of a cut, boss, hole or text on the model to pick that feature (click again to unpick), or click it in the timeline. The whole body is no longer selected: picked features are outlined in blue and marked in the timeline, and the feature under the pointer is outlined in orange. Ticking features in the list still works."],
      ]),
      sec("New in version 2.7.2", [
        ["Thinner sketch lines:", "sketch lines are now about half as thick, in the sketch editor and on the model, so small or narrow profiles are easier to see and click when you extrude, revolve or pick a profile. Selected and highlighted lines stay a little bolder."],
      ]),
      sec("New in version 2.7.1", [
        ["Modern Sci-Fi armor:", "a new CosForge style with 27 original templates to build from: Vanguard, Interceptor, Sentinel, Strike Team and Flight helmets, a Night Watch cowl and a visor mask; Vanguard, Hex Core and Tactical chest pieces; back plates and a Jet Pack Mk II; pauldrons, arm guards, bracers, a Pulse Gauntlet and hand plates; thigh plates, knees, greaves, boots and toe caps; a collar, belt, hip plates and an Energy Shield. Add the whole Vanguard set at once."],
        ["Sharper shapes:", "the new templates start with angled form cages (keeled chests, jutting jaws, ridged limbs) that you can keep reshaping in the Form step."],
        ["Light lines:", "panel lines and emblems can glow in the accent colour (Surface details → Light lines and Glowing emblem), and 3MF exports keep the colours for multi-colour printing. A new angled-eyes helmet opening, too."],
      ]),
      sec("New in version 2.7", [
        ["CosForge Form tool:", "a new Form step puts a control cage over any costume part, like the form tools in CAD. Pick points, edges, faces, rows or columns (Shift adds), then drag the arrows (X, Y, Z, or yellow to push and pull along the surface) or the white ball, or use Pull out, Push in, Move, Scale, Rotate, Flatten and Make smooth. Symmetry keeps left and right matched, soft selection blends the edit into nearby points, and the cage can be smooth or creased, with fewer or more points or subdivided. The outline, details, add-ons, cuts and joints all follow the new shape."],
        ["26 more templates:", "Recon Helmet, Space Bubble Helmet, Jet Pack, Power Gauntlet, Armored Collar, Armored Hand Plate and Riot Shield (Sci-Fi); Dragon Helm, Dragon Pauldron, Dragon Gauntlet, King's Crown, Knight Hand Plate, Gorget and Wing Back Plate (Fantasy); High Collar, Lightning Helm, Star Gauntlet and Hero Shield (Comic Hero); Respirator Mask, Clockwork Gauntlet, Riveted Collar and Riveted Plate Pauldron (Steampunk); Menpo Face Guard, Nodowa Throat Guard, Horned Kabuto and Tekko Hand Guard (Samurai). Almost 100 templates in all."],
        ["New part types:", "collars (gorgets) that sit on the shoulders around the neck, and a lower-face mask style."],
      ]),
      sec("New in version 2.6", [
        ["CosForge:", "a new cosplay costume designer that opens in its own window (Simulate → CosForge in Advanced, or the CosForge button in Beginner). Enter the wearer's measurements and a mannequin is built to match, in an arms-down, A or T pose."],
        ["Costume templates:", "over 70 parts in Sci-Fi, Fantasy, Comic Hero, Steampunk and Samurai styles, plus plain forms: helmets with visors, slits or cowls, masks, crowns, chest and back plates, belts, tassets, pauldrons, arm guards, bracers, hand plates, thigh plates, knee guards, greaves, boot covers, toe caps and shields. Add one part or a whole set."],
        ["Shape and sculpt:", "every part is a form you can change: coverage, openings, edges (rolled, trimmed, flared), ridges, panel lines, hex plates, dragon scales, overlapping plates, muscles, emblems and rivets, plus add-ons like horns, spikes, fins, ears, wings, gems, antennas, goggles and thrusters. Sculpt with bulge, push, emboss, engrave and smooth brushes."],
        ["Fit to the body:", "parts follow the body when the measurements change. Move, turn and size them, and check the fit: the inside turns green, orange or red, and helmets warn when the head won't fit through."],
        ["Cut and join:", "cut parts anywhere with flat cuts, or let Auto-cut split them until every piece fits your printer (eight bed sizes). Joints go on the inside of each cut: pegs, snap clips, slide-in dovetails or magnet cups."],
        ["Export or keep editing:", "save pieces as STL (a .zip of pieces), 3MF with colours or OBJ, as worn or laid out ready to print, or add them to your design to edit in the other modes. Import your own STL or 3MF parts, or objects from your design, to fit and cut them too. The costume is kept with the design."],
      ]),
      sec("New in version 2.5.1", [
        ["CAM Studio machines:", "48 machine profiles, grouped from desktop and hobby routers, benchtop and knee mills, pro and shop routers, to industrial nesting routers, vertical machining centers and lasers, plus 7 with a 4th (rotary) axis. Your own machines can now have a rotary axis and a tool changer."],
        ["Industrial G-code:", "new Fanuc-style and Haas-style posts: program number, G54, tool changes with length offsets (G43 H), coolant, and a safe return home at the end."],
        ["More materials and bits:", "steels, stainless, cast iron, titanium, 7075 aluminium, copper, acetal, polycarbonate and carbon fiber; carbide end mills up to 3/4\", a face mill, bull and ball noses, a chamfer mill and a tap drill."],
        ["No more freezing:", "CAM Studio now works out the toolpaths, G-code and the whole cutting simulation in the background, so the window keeps responding while it works and you can keep changing settings. Scrubbing and replaying are spread over frames too. While it works, the model stays on screen with a progress bubble, and 4th-axis jobs are about ten times faster."],
      ]),
      sec("New in version 2.5", [
        ["Log cabins:", "new Log cabin wall types in Architect: round logs (8\", 10\" or 250 mm) that cross past each corner, and hewn square logs (6\", 8\" or 200 mm) with chinking between them. Pick one before drawing, or turn any wall into logs with Build as. They go to Beginner and Advanced as real logs you can print."],
        ["Simulate:", "a new Simulate tool in Architect (press S) with the weather, moving water and a flood test. Run a rainstorm (light to hurricane, 1 hour to a day): rain runs off the roof, soaks into the ground (grass and gravel soak it up, paving doesn't) and flows downhill. Or let a river or the sea rise from the edges of the land. It shows where the water collects, whether it gets above the floor at each door, and can fix it by raising the house on ground that slopes away."],
        ["CAM Studio 4th axis:", "Setup → 4th axis (rotary) mills round parts: the stock is a bar held between a chuck and a tailstock that turns (A axis) while the bit cuts from above, so handles, chess pieces, figures and cylinders are carved all the way around. Rotary roughing and finishing, a turning simulation, and G-code with A moves for grblHAL / FluidNC, LinuxCNC and Mach3, with four new machines that have a rotary axis."],
        ["Roofs:", "a roof now always sits on top of the walls under it, even if the walls are raised later or made taller. A roof that covers the whole level follows the walls when they move or grow. Drag a roof to move it (it snaps to the outside of the walls), nudge it with the arrow keys, type its center, or click Fit to walls."],
        ["Wall colour:", "pick a colour for the walls when you raise them (nine quick colours or any colour), and walls now have dark outlines so light walls are easy to see."],
        ["Floor plans:", "the Floor plan button saves the plan as a drawing: PDF or SVG on Letter, Tabloid, A4 or A3 at a standard scale (1/4\" = 1', 1:50…), or DXF at full size for CAD. Solid walls, door swings, windows and dimensions, one level or all of them."],
        ["7 new Architect tutorials:", "a round-log cabin, a square-log workshop, a corner café, landscape basics, a pond garden, a flood test, and a house and landscape ready to 3D print (12 Architect tutorials in all)."],
      ]),
      sec("New in version 2.4", [
        ["Architect:", "the mode is now called Architect. Going back to Beginner or Advanced brings the house along by itself, scaled down to fit the standard 256 × 256 mm build plate, and the camera goes back to the home view near the origin. Back in Architect it is full size again."],
        ["Landscape:", "make the ground around the house, then raise hills, dig valleys, smooth and flatten it, dig ponds, lakes and streams that fill with water, paint 22 kinds of ground (grass, meadow, dry grass, moss, beach, dune and desert sand, gravel, river stones, stone and brick paths, slate, rock, clay, mud, mulch, flower beds, snow, paving…), and place 39 trees, shrubs, grasses, flowers and stones (oak, willow, cypress, blue fir, cherry blossom, apple, aspen, palms, cactus, boxwood, lavender, roses, hydrangea, ferns, pampas grass, cattails, wildflowers, tulips, lily pads, boulders, rock piles, stepping stones, pebbles…). The landscape stays in Architect; only the house goes to the other modes."],
        ["Weather and water:", "a weather simulator (sunny, cloudy, rain, thunderstorm with lightning, snow, fog) with wind that sways the plants, and moving water with waves on ponds and lakes. Each can be turned on or off; they are only for looking at."],
        ["Finishes:", "give walls, roofs and floors a colour and a texture from the library (brick, siding, stucco, stone, shingles, slate, metal roofing, wood and more), and walls a raised or cut face pattern. They become real texture layers and face patterns when the house goes to Beginner or Advanced."],
        ["Export:", "export the house with its landscape (ground, water, trees), scaled down together to fit the build plate, as 3MF or OBJ with colours, or STL."],
      ]),
      sec("New in version 2.3", [
        ["CAM Studio:", "Advanced → Simulate → CAM Studio plans how a CNC router, mill or laser cuts your design and simulates it, cut by cut: roughing, finishing, facing, cutouts with tabs, laser cutting and engraving. Basic mode asks a few questions (machine, material, bits, quality) and works out feeds and speeds; Pro mode shows every operation and setting, with your own machine and bit profiles. Machines from a desktop 3018 to a 4'×8' router and a laser; flat, ball, bull-nose, V-bits, drills and laser heads. It warns about crashes and too-deep cuts, estimates the time, saves G-code for GRBL, LinuxCNC, Mach3 or Marlin, and can send it over USB to GRBL and Marlin machines (Chrome or Edge). Built with openly published methods (drop-cutter toolpaths as in OpenCAMLib, height-field simulation as in CAMotics)."],
        ["Architect:", "a feet-and-inches / metric switch in the toolbar (with standard wall sizes and grid for each), and 5 step-by-step tutorials, from a garden shed to a two-story house ready to 3D print."],
      ]),
      sec("New in version 2.2", [
        ["Architect:", "a new mode for houses and buildings. Draw a floor plan with Wall (corner by corner, typing exact lengths like 12' 6\") or Room, then raise the walls to the height you need. Put in doors and windows from a catalog of common sizes (interior, front, double, sliding patio, bifold, garage; single hung, slider, casement, picture, transom, round) by pointing at a wall, or type exact positions on the wall's own grid. Click a wall to edit it and the rest of the building turns see-through. Add gable, hip, shed, pyramid, barrel or flat roofs with slope and overhang presets, floors and more levels, then Send to design: the building becomes editable shapes in Beginner or Advanced at a scale you choose (1:24, 1:48, 1:50, 1:87, 1:100, 1:200 or full size)."],
      ]),
      sec("New in version 2.1.3", [
        ["Pattern on face:", "a new tool in Beginner (Face pattern) and Advanced (Decorate → Pattern on face). Click a flat face and raise or cut hexagons, diamond plate, screen mesh, circles, triangles, knurl or ribs into it, or the lines between them. Set the pattern size, gap, height or depth, direction (angle), border and an offset; keep whole shapes or trim them at the edge. It is a real feature, not a texture: it stays editable (timeline in Advanced, the shape panel in Beginner) and follows the face when the shape is resized."],
        ["26 new textures:", "new Wood, Building and Fabric groups: oak, knotty pine, fine grain, end grain, floor planks, bamboo, weathered wood; roof shingles, slate roof, fish-scale shingles, clapboard siding, barrel roof tiles, corrugated metal, floor tiles, tread plate; blue jean (denim), canvas, burlap, corduroy, quilted, window screen, rope; plus leaf veins, pineapple, rough rock and golf ball dimples. Each starts at a tile size that suits it."],
      ]),
      sec("New in version 2.1.2", [
        ["Voxel Studio:", "Advanced → Simulate → Voxel Studio opens in its own window and turns the selected objects (or all of them) into cubes, 16 to 64 across, solid or hollow. Paint single faces or whole cubes, fill flat areas, pick colors, add and remove cubes (with left-right mirroring), undo and redo, then export STL or a colored 3MF, or add it to the design (one part per color)."],
        ["Moving things:", "the arrow keys now move objects the way they look on screen, whichever way the camera is turned and however the object is rotated: Left and Right go across the screen, Up and Down go away and toward you (or up and down when you look from the side), and Ctrl+Up/Down always goes straight up and down. In Beginner, Advanced and the Move tool; , and . turn by 1° after picking a rotation arc."],
      ]),
      sec("New in version 2.1.1", [
        ["20 new tutorials:", "10 more for Beginner (bookmark, plant marker, cookie cutter, tic-tac-toe, trinket tray, Tower of Hanoi, phone amplifier, marble maze, box with a lid, pencil box) and 10 more for Advanced (washers, luggage tag, spring toy, plant pot, cable organizer, gear spinner, chess rook, bangle, bolt and nut, press-fit box), from Easy to a new Expert level."],
      ]),
      sec("New in version 2.1", [
        ["3D text:", "Advanced → Create → 3D text: text that lies on any face or the workplane and reads upright. Drag it anywhere and it follows the faces, snapping to face centers and the grid; turn Snap off (or hold Alt while dragging) to move it freely. Arrow keys nudge it, Across / Up place it exactly, Center puts it in the middle, and Angle and Turn spin it."],
        ["Emboss text:", "drag the text across the body to move it (the letters update as you go), with the same snapping, Across / Up offsets from the face center, a Center button and arrow-key nudging."],
        ["Sketch text:", "dragging keeps where you grabbed it, and the text's middle snaps to the face center, the origin, points, shape centers and the grid (hold Alt while dragging to move it freely). New Center on face buttons and arrow-key nudging."],
      ]),
      sec("New in version 2.0", [
        ["3D Sketch:", "draw lines in 3D on a body, a virtual sphere, egg or cube, or in the air, with a split screen: turn the camera with one hand while you draw with the other (touch, pen, mouse or trackpad). Freehand or nodes, undo and redo; every line becomes a solid tube."],
        ["Lathe:", "turn a body (or a copy of it) or a square or round blank on a virtual wood lathe: pick the speed, a foot pedal (Space) that you hold or that stays on, seven chisels you can twist, flying chips, then hollow it out and add it to the design or export STL, 3MF or OBJ. In Beginner, Advanced and Chisel."],
        ["Jump Brick Builder:", "in Advanced → Simulate, rebuild objects out of printable stud-and-tube building bricks (classic 8 mm or jumbo 16 mm) with a parts list and layer-by-layer building steps, built in place or laid out on print beds."],
        ["Also:", "a 256 × 256 mm Beginner workplane, path patterns in Advanced, imperial threads, and two new Lathe tutorials."],
      ]),
      sec("Four modes", [
        ["Beginner:", "drag-and-drop shapes, solids and holes, grouping, align, mirror, pattern and drop to workplane, like Tinkercad."],
        ["Advanced:", "sketch-based, parametric modeling with a feature timeline, like Fusion 360."],
        ["Chisel:", "3D sculpting with brushes, like digital clay, in Easy (big, simple tools for kids and first-timers) or Pro (30 brushes, masking, cuts and more)."],
        ["Architect:", "floor plans, walls, doors, windows and roofs for houses and buildings, a landscape with water and trees, sent to Beginner or Advanced as editable shapes (scaled to fit the build plate) or exported with the landscape."],
        ["Switch any time:", "your design carries over between modes."]]),
      sec("Beginner tools", [
        ["Shapes:", "box, cylinder, sphere, cone, pyramid, wedge, torus, tube, hemisphere, prism, text, star, heart, roof, round roof, paraboloid, gem, spring, capsule and arrow, each as a solid or a hole."],
        ["Handles:", "drag to resize, lift and rotate; press Tab to type width, depth, height and lift."],
        ["Text:", "change the font, curve it along an arc, or wrap it onto another shape's surface."],
        ["Also:", "sketch and extrude, import SVG/DXF drawings, textures, measure, lock, multi-select and the 3D Print Sim."]]),
      sec("Advanced modeling", [
        ["Sketching:", "lines, rectangles, circles, arcs, polygons, splines, text, trim, offset, dimensions and constraints (coincident, horizontal/vertical, parallel, perpendicular, tangent, concentric, equal)."],
        ["Create:", "extrude (including straight from a face), revolve, sweep, loft (any number of profiles, to a point, closed, or along a centerline), pipe, coil, mirror, primitives, construction planes."],
        ["Hole:", "simple, counterbore, countersink and tapped holes with standard screw sizes."],
        ["Threads:", "modeled ISO threads with a print offset for 3D-printed parts."],
        ["Modify:", "fillet, chamfer, offset face, shell, combine, split body, split face, pattern, move/copy, scale and align."],
        ["Decorate:", "surface textures (including your own pictures), patterns raised on or cut into flat faces, emboss or deboss text on flat and curved faces, and appearances (colors and materials)."],
        ["Inspect:", "measure distances, angles and sizes."]]),
      sec("Chisel sculpting", [
        ["Your design is there:", "bodies from Beginner and Advanced show up ready to sculpt. Sculpt, cut or move one and it becomes a sculpt; undo brings the original back. Copy sculpts a copy instead."],
        ["Brushes:", "build, clay, inflate, carve, crease, pinch, smooth, flatten, move, snakehook, twist, mask and paint, with falloff, alpha, symmetry and radial symmetry."],
        ["Stylus:", "pen pressure (Wacom, Apple Pencil, Surface Pen) changes brush size and strength; the eraser end carves."],
        ["Sketch and extrude:", "the same rectangle, circle and polygon sketch tools as Advanced, on an origin plane or a model's face, then extrude a new body, or join or cut. New bodies stay real CAD, editable in Advanced."],
        ["Move:", "exactly like Beginner: drag on the workplane with grid snapping and snap guides, size handles, lift arrow, rotation arcs, Tab to type sizes."],
        ["Cut and select:", "hole punch, lasso, box and plane cuts; window or crossing selection like the other modes. Easy mode has a simple Combine tool (join, cut away, keep the overlap)."],
        ["Files:", "sculpts show in Beginner and Advanced as meshes; export STL or OBJ (with painted colors) in millimeters."]]),
      sec("Simulate", [
        ["3D Print Sim:", "30+ printer profiles (Bambu Lab, Creality, Elegoo, Flashforge, Prusa, Snapmaker), multi-color printing with AMS-style switchers, dual nozzles and tool changers: paint faces with a filament per toolhead and watch the tool changes (changes, purge waste, prime tower), supports, layer-by-layer preview, print time, and strength maps."],
        ["Simulate:", "joints and motion, stress tests, and printed-part strength by filament and print orientation."],
        ["CosForge:", "design cosplay costumes on a mannequin built from your measurements, with themed templates you can shape, reshape with a control cage (Form), sculpt, fit, cut into printable pieces with joints, and export or add to your design."],
        ["FlexiGen:", "turn one object into a print-in-place articulated flexi model with six joint styles, then export STL or 3MF. It works on a copy, so your design is never changed."],
        ["Render:", "photo-style pictures with studio, sun, spotlight, overcast or three-point lighting, light color and direction, your own background picture, and Low to Ultra high quality, saved as PNG."]]),
      sec("Files and saving", [
        ["Export:", "STL, OBJ, 3MF and STEP: everything, or only the bodies you select. Sketches as DXF (one, or all) for laser cutters and other CAD."],
        ["Section analysis:", "in Advanced → Inspect, cut the view with a plane to see inside your design, with hatched cut faces. The design itself never changes."],
        ["Import:", "STL and 3MF meshes (repaired automatically) and STEP models in both modes, SVG and DXF drawings, and pictures to trace: drag their handles to scale, stretch and turn them, scale one from a length you know, or Auto trace a picture into outlines ready to extrude."],
        ["Drop a file:", "in Beginner or Advanced, drag an STL, 3MF, OBJ, STEP, SVG or DXF file from your computer onto the page. It opens like the Import button, and a model lands on the build plate, selected."], // jumpstart-3d: drop import
        ["Mesh to STEP:", "in Advanced → Simulate, convert an STL or 3MF mesh into a STEP solid with real flat, round and curved faces, then open it in JumpStart 3D to edit it with CAD tools."],
        ["Saving:", "designs are kept in this browser after every change. Save (or Ctrl+S) makes a new version each time: \"Lopez, Maria, Keychain v1\", v2, v3…, and STL and project files carry the same name and number. Optional Crash recovery keeps numbered backups (\"… autosave v1\", v2…) and offers them back if the app closes unexpectedly."]]), // jumpstart-3d: the Autosave button is labelled Crash recovery
      sec("Viewing", [
        ["Lighting:", "realistic shading and shadows (sun button), light, dark or high-contrast themes, orthographic view and the view cube."],
        ["Projection & animation:", "Projector (a second window that shows your objects on black, for a projector or second screen), Media (pictures and videos on objects: facing view, wrap around, all sides or ball), and Picture to 3D model (puffs a picture's subject up into a rounded, printable solid with the picture painted on), and in Chisel: ready-made characters (people, heads, animals, aliens), textures, a History strip, and the Puppet Animator (rig, pose, keyframes up to 10 seconds, an animation library, a virtual set with your own background, MP4 export)."],
        ["Performance:", "Auto, Normal (slower computers), High (most laptops and Chromebooks) or Ultra (powerful computers, sharpest) in the Customize menu: lighter modes draw fewer pixels while the view moves and simpler shadows, with every tool and export unchanged. Auto picks a mode for the computer and steps down if things get slow."], // jumpstart-3d: Customize replaces the theme icon
        ["Tutorials:", "fifty-one step-by-step projects (nineteen in Beginner, twenty in Advanced, twelve in Architect, marked Easy, Proficient, Advanced or Expert, 5-15 minutes each), from a name keychain and a rocket to a chess pawn, a wall hook, a box with a drawer and a candy jar with a screw-on lid. Each step shows which tool to use, how and when, with a short animation, and ticks itself off when it's done."], // jumpstart-3d: tutorials count
        ["Mesh detail:", "Normal, Fine, Extra fine or a custom level up to 32× in the Customize menu: how finely curved surfaces are divided into triangles, in the view and in STL, OBJ and 3MF exports. STEP is exact at every level. The menu shows the triangle count of your design and estimates it for other levels; above 500,000 it asks first, because building can take minutes."], // jumpstart-3d: Customize replaces the theme icon
        ["Help:", "press ? for every keyboard shortcut; right-click a shape for copy, paste, duplicate and delete."]]),
      // the author's credit from v1.93.8 stays in this community build (see NOTICE.md)
      el("p", { class: "ab-credit" }, "Created by J.Siwek"),
      el("p", { class: "ab-credit-sub" }, "Created with Vibe Coding Assistance"),
      el("p", { class: "ab-credit-sub" }, "Community build maintained by Max Sikorski · ",
        el("a", { href: "https://github.com/MaxSikorski/jumpstart-3d", target: "_blank", rel: "noopener" }, "github.com/MaxSikorski/jumpstart-3d")),
      // jumpstart-3d: what the community build adds
      el("p", { class: "ab-credit-sub" }, "Community build adds: named parameters across sketches, features and Beginner shapes, an editable Pattern, CSV parameters, OBJ export, Mesh detail."),
      // jumpstart-3d: agent setup
      el("p", { class: "ab-credit-sub" }, "Have an AI agent set up the MCP server for itself: tell it \"Read https://raw.githubusercontent.com/MaxSikorski/jumpstart-3d/main/mcp/AGENT-SETUP.md and set it up for me.\""),
      // the open-source libraries and fonts inside the app, with their licenses (they ask for this notice)
      el("section", { class: "ab-oss", id: "ab-oss" },
        el("h3", {}, "Open-source credits"),
        el("p", { class: "ab-oss-note" }, "JumpStart 3D is built with these open-source libraries and fonts. Thank you to their authors."),
        el("ul", {}, ...CREDITS.map((c) => el("li", {},
          el("b", {}, c.name), c.ver ? " " + c.ver : "", ": ", c.use,
          el("div", { class: "ab-oss-meta" }, c.copy, " · License: ", c.lic, " · ", el("a", { href: c.url, target: "_blank", rel: "noopener" }, "project page")),
          c.src ? el("div", { class: "ab-oss-meta" }, c.src) : null))),
        el("details", { class: "ab-oss-texts", id: "ab-licenses" },
          el("summary", {}, "Full license texts"),
          ...[["MIT License: three.js", "mit-three"], ["MIT License: replicad", "mit-replicad"], ["MIT License: opentype.js", "mit-opentype"], ["ISC License: Flatbush", "isc"], ["GNU Lesser General Public License 2.1: Open CASCADE Technology / opencascade.js / replicad-opencascadejs", "lgpl"], ["SIL Open Font License 1.1: Poppins, Liberation, IBM Plex, Barlow", "ofl"],
            ["Apache License 2.0: Manifold", "apache-manifold"], ["Boost Software License 1.0: Clipper2 (inside Manifold)", "bsl-clipper2"]] // jumpstart-3d: the two texts licenses.js adds for the mesh-boolean engine
            .map(([t, k]) => el("div", { class: "ab-lic" }, el("b", {}, t), el("pre", {}, LICENSE_TEXTS[k]))))),
      // jumpstart-3d: use the same community build label as the splash.
      el("div", { class: "ab-update" }, el("span", { class: "ab-ver", id: "ab-ver" }, "Version " + BUILD_LABEL),
        el("a", { class: "btn", href: "https://github.com/MaxSikorski/jumpstart-3d/releases", target: "_blank", rel: "noopener" }, "What's new"),
        el("a", { class: "btn", href: "https://github.com/MaxSikorski/jumpstart-3d/issues", target: "_blank", rel: "noopener" }, "Report a bug or idea"))));
  back.append(modal);
  document.body.append(back);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); back.remove(); } }); // jumpstart-3d: closing the dialog must not change the selection or sketch tool
  modal.querySelector(".xbtn").focus();
};
app.showShortcuts = function () {
  const rows = (title, list) => el("section", { class: "keys-sec" }, el("h3", {}, title), el("dl", {}, ...list.flatMap(([k, d]) => [el("dt", {}, ...k.split(" ").map((x) => el("span", { class: "kbd" }, x))), el("dd", {}, d)])));
  const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
  const modal = el("div", { class: "modal", role: "dialog", "aria-label": "Keyboard shortcuts" },
    el("header", {}, el("h2", {}, "Keyboard shortcuts"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
    el("div", { class: "mbody keys-grid" },
      rows("Sketching (both modes)", [["L", "Line"], ["R", "Rectangle (last type used; ▾ for 2-point, 3-point, center)"], ["C", "Circle"], ["A", "Arc"], ["P", "Polygon"], ["Shift T", "Text"], ["Enter / dbl-click", "Finish a spline"], ["T", "Trim"], ["D", "Dimension"], ["X", "Construction line"], ["S", "Select"], ["E", "Finish and extrude"], ["Tab", "Next typed value"], ["Esc", "Stop / finish sketch"]]),
      rows("Advanced", [["L R C", "Start a sketch with that tool"], ["Arrows", "Nudge the selection, the way it looks on screen (Ctrl ↑↓: up / down)"], ["S", "Create sketch"], ["E", "Extrude"], ["Shift R", "Revolve"], ["Q", "Offset face (press pull)"], ["H", "Hole"], ["F", "Fillet"], ["Shift C", "Chamfer"], ["M", "Move / copy"], ["A", "Align"], ["P", "Pattern"], ["B", "Combine"], ["T", "Texture"], ["I", "Measure"], ["Shift F", "Fit all"], ["Drag right / left", "Window / crossing select"]]),
      rows("Beginner", [["L R C", "Sketch a line, rectangle or circle"], ["E", "Extrude"], ["A", "Align"], ["P", "Pattern"], ["M", "Mirror"], ["H", "Make hole"], ["S", "Make solid"], ["D", "Drop to workplane"], ["T", "Texture"], ["F", "Fit all"], ["Arrows", "Nudge, the way it looks on screen (Shift ×10)"], ["Alt while dragging", "Ignore faces and the grid for a moment"], ["Ctrl ↑↓", "Lift / lower"], [", .", "Turn 1° after a rotation arc (Shift 15°)"], ["Ctrl G", "Group (Shift: ungroup)"], ["Ctrl D", "Duplicate"], ["Tab", "Type sizes on the selected shape (Shift Tab: back)"], ["I", "Measure"]]),
      rows("Architect", [["W", "Wall (click each corner)"], ["R", "Room (drag corner to corner)"], ["E", "Raise walls"], ["D", "Door"], ["N", "Window"], ["O", "Roof"], ["G", "Floor"], ["T", "Finishes (textures, colours, patterns)"], ["L", "Landscape (ground, water, plants)"], ["S", "Simulate (weather, flood test)"], ["Arrows", "Nudge the selected roof, door or window"], ["V", "Select"], ["0-9 Enter", "While drawing a wall: type its exact length (12' 6\" or 3600)"], ["Enter", "Finish the walls you are drawing"], ["Shift", "Draw at any angle"], ["Alt", "Turn snapping off for a moment"], ["P", "Plan view / 3D"], ["X", "See-through on or off"], ["Delete", "Delete the selection"], ["Esc", "Stop drawing, back to Select"]]),
      rows("Chisel (Pro)", [["D", "Standard brush"], ["C", "Clay"], ["S", "Smooth"], ["T", "Flatten"], ["G", "Move brush"], ["N", "Snakehook"], ["Q", "Mask"], ["J", "Paint"], ["M", "Select & move"], ["[ ]", "Brush size"], ["Shift drag", "Smooth"], ["Alt drag", "Invert brush"], ["Ctrl drag", "Mask"], ["X", "Mirror X"], ["F", "Frame"], ["Drag right / left", "Window / crossing select (Select & move)"], ["Tab", "Type sizes (Select & move)"], ["R C P", "Rectangle, circle, polygon (Sketch)"], ["E", "Extrude the sketch"], ["Esc", "Cancel the shape / sketch"]]),
      ...(IS_MAC ? [rows("Mac trackpad", [["Option drag", "Orbit"], ["Option Shift drag", "Pan"], ["Pinch", "Zoom"], ["Two-finger scroll", "Zoom"], ["Control click", "Right-click menu (drag to orbit)"]])] : []),
      rows("Everywhere", [[", .", "After using a rotation arc or ring: turn 1° (Shift: 15°)"], ["Shift drag", "On a rotation arc or ring: turn by any angle (otherwise 15° steps)"], ["Turn − +", "In the status bar: turn the selected shape by the chosen step (15, 5, 1, 0.5 or 0.1°); the , and . keys use that step too"], ["Ctrl C", "Copy"], ["Ctrl V", "Paste"], ["Ctrl A", "Select all"], ["Right-click", "Copy, paste, duplicate, delete"], ["Ctrl Z", "Undo"], ["Ctrl Shift Z", "Redo"], ["Ctrl L", "Lock / unlock"], ["Ctrl S", "Save"], ["Shift S", "Snapping on / off"], ["Del", "Delete"], ["Home", "Home view"], ["?", "This list"]])));
  back.append(modal);
  document.body.append(back);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); back.remove(); } }); // jumpstart-3d: closing the dialog must not change the selection or sketch tool
  modal.querySelector(".xbtn").focus();
};

// E: extrude from anywhere. From inside a sketch it finishes the sketch and
// starts the extrude with that sketch's shape picked.
app.quickExtrude = function (opts = {}) {
  const sk = app.sketcher.active;
  if (sk && app.sketcher.state) app.sketcher.done();
  if (app.command) app.command.cancel();
  if (sk) app.exitSketch(true); // keep the Slice while extruding (it ends with the command)
  app.advanced.extrude(sk ? { sketch: sk, ...opts } : {});
  if (app.sketchSlice.on && !app.command) app.setSketchSlice(false);
};
// Beginner: as soon as a sketch has a new closed shape, Extrude opens on it (already 10 mm up,
// with the big arrow); Cancel goes back to the sketch to keep drawing
app.onShapeClosed = function (skId, regionKeys) {
  // jumpstart-3d: direct edit. Beginner no longer opens Extrude by itself: finish the sketch, then click the shape (or press E)
  if (app.mode === "beginner") {
    if (app.sketcher.active === skId && !app.shapeClosedTold) { app.shapeClosedTold = true; app.toast("Shape closed. Finish the sketch, then click the shape to extrude it (or press E now)."); }
    return;
  }
  if (app.mode !== "beginner" || app.sketcher.active !== skId) return;
  setTimeout(() => {
    if (app.mode !== "beginner" || app.sketcher.active !== skId) return;
    app.quickExtrude({ regionKeys, backToSketch: true });
  }, 0);
};

app.select = function (ids) {
  app.sel = [...new Set(ids)];
  app.pivot && app.pivot.selection(app.sel); // jumpstart-3d: pivot. a different set of bodies starts from its middle again
  app.scene.setSelected(app.sel);
  app.refreshUI("select");
};
app.selected = () => app.sel.map((id) => findBody(store.view, id)).filter(Boolean);

app.fit = function () {
  if (app.mode === "arch") { app.vp.fit(app.arch.box()); return; }
  const box = app.sel.length ? app.sel.reduce((b, id) => b.union(app.scene.bodyTightBox(id) || new THREE.Box3()), new THREE.Box3()) : app.scene.allBox();
  app.vp.fit(box.isEmpty() ? null : box);
};

app.undo = function () {
  if (app.mode === "chisel") { app.chisel.undo(); return; }
  if (app.simLock) { app.toast("Undo is off in the 3D Print Sim: it doesn't change your design."); return; }
  if (app.command) app.command.cancel();
  const l = store.undo();
  if (l) app.toast("Undid " + l.toLowerCase());
};
app.redo = function () {
  if (app.mode === "chisel") { app.chisel.redo(); return; }
  if (app.simLock) return;
  if (app.command) app.command.cancel();
  const l = store.redo();
  if (l) app.toast("Redid " + l.toLowerCase());
};

app.refreshUI = function (kind) {
  $("btn-undo").disabled = !store.undoStack.length;
  $("btn-redo").disabled = !store.redoStack.length;
  const nameEl = $("docname");
  if (document.activeElement !== nameEl) nameEl.value = store.doc.name;
  { const v = app.projects ? app.projects.version() : 0, ve = $("docver"); ve.hidden = !v; ve.textContent = "v" + v; ve.title = v ? `Saved ${v} time${v > 1 ? "s" : ""}: the next Save makes v${v + 1}` : ""; }
  if (app.mode === "arch") app.arch.refresh(kind);
  else if (app.mode === "beginner") {
    if (app.sketcher.active) { app.advanced.sketchUI(kind); $("inspector").hidden = true; }
    else {
      // the sketch palette belongs to sketch editing only
      $("palette").hidden = true;
      app.beginner.refresh(kind);
    }
  } else app.advanced.refresh(kind);
  app.status();
};

// "Rebuilding": after a few seconds it names the body being built and how long it has taken,
// so a slow body (spiral cuts, many offset faces) shows it is still working
function busyText() {
  const k = app.kernel, b = $("busy");
  if (!b) return;
  const nameOf = (list) => list.map((it) => (store.doc.bodies.find((x) => x.id === it.id) || {}).name).filter(Boolean);
  const tm = (at) => { const s = Math.round((Date.now() - at) / 1000); return s >= 60 ? Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s" : s + " s"; };
  const parts = [];
  if (k && k.inflight && k.inflightAt && Date.now() - k.inflightAt > 4000) {
    const names = nameOf(k.inflight);
    parts.push("Building " + (names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? "…" : "") + " · " : "") + tm(k.inflightAt) + (k.queue.size ? ` · ${k.queue.size} more` : ""));
  }
  // a very slow body building in the background engine (the rest of the design is usable)
  if (k && k.slow && k.slow.inflight) {
    const names = nameOf(k.slow.inflight);
    parts.push((names.length ? names[0] : "A slow body") + " is building in the background · " + tm(k.slow.at) + (k.slow.queue.size ? ` · ${k.slow.queue.size} more` : ""));
  }
  // jumpstart-3d: a hollow on a curved shape can take a minute; say so after 3 s instead of only "Rebuilding"
  if (k && k.inflight && Date.now() - (k.inflightAt || 0) >= 2900 && k.inflight.some((it) => JSON.stringify(it.node).includes('"t":"shell"'))) parts.unshift("Hollowing: on a curved shape this can take a minute");
  b.textContent = parts.length ? parts.join(" | ") : "Rebuilding";
  const slowNow = !!(k && k.slowNow && k.slowNow()) && !b.hidden;
  const st = $("busy-stop"), hp = $("busy-help");
  if (st) st.hidden = !slowNow;
  if (hp) hp.hidden = !slowNow;
  b.title = k && k.slow && k.slow.inflight ? "This body has many curved cuts or offset curved faces, so it takes several minutes the first time. It is remembered afterwards, and saved project files carry it, so it opens quickly next time." : "";
}
setInterval(() => { if (app.kernel && (app.kernel.inflight || (app.kernel.slow && app.kernel.slow.inflight))) busyText(); }, 1000);
// a very slow body: Stop, and tips for making it quicker
setTimeout(() => {
  const st = $("busy-stop"), hp = $("busy-help");
  if (st) st.onclick = () => { app.kernel.stopSlow(); app.toast("Stopped. That body isn't shown until it is built: open the design again (or change the body) to build it."); };
  if (hp) hp.onclick = () => app.showSlowHelp();
}, 0);
app.showSlowHelp = () => {
  const tips = [
    ["Why it's slow:", "every curved cut (sweep, twisted sweep, loft, revolve) and every curved face you Offset is one heavy calculation for the geometry engine, and they are done one after another. A body with 5 spiral cuts plus 24 offset spiral faces is about 30 of them."],
    ["It only happens once:", "the built body is remembered in this browser, and a project file saved after it has built carries it, so the design then opens in a few seconds, on any computer. Let it finish once, then Save."],
    ["Making clearance between moving parts:", "try Advanced Modify → Clearance before offsetting many curved faces: it cuts the other part, grown by the gap, out in one step. On very complex free-form parts (like spiral cuts) the engine may not be able to grow the part; Clearance then says so, and offsetting the faces is the way."],
    ["Fewer, simpler features:", "offset a few big faces rather than many small ones; pattern a cut rather than making each copy by hand; fillet or shell before adding spiral cuts, not after; and keep twisted sweeps to the turns you need."],
    ["Keep working meanwhile:", "a very slow body builds in a second engine, so the rest of the design can be changed while it builds. Stop ends it; opening the design again starts it again."],
  ];
  const box = document.createElement("div");
  box.className = "modal-back"; box.id = "slow-help";
  box.innerHTML = '<div class="modal" role="dialog" aria-label="Slow bodies" style="max-width:560px"><header style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line-2)"><h3 style="margin:0;flex:1;font:600 16px/1 var(--f-label);letter-spacing:.08em;text-transform:uppercase">Slow bodies</h3><button class="xbtn" aria-label="Close">✕</button></header><div style="padding:12px 16px 16px;display:flex;flex-direction:column;gap:9px;font-size:13px;line-height:1.45"></div></div>';
  const body = box.querySelector(".modal > div");
  for (const [h, t] of tips) { const p = document.createElement("p"); p.style.margin = "0"; const bb = document.createElement("b"); bb.textContent = h + " "; p.append(bb, t); body.append(p); }
  const close = () => box.remove();
  box.querySelector(".xbtn").onclick = close;
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  document.body.append(box);
};

app.status = function () {
  const busy = app.scene && (app.scene.busy() || app.kernel.inflight || app.kernel.queue.size || (app.kernel.slowBusy && app.kernel.slowBusy()));
  // jumpstart-3d: a STEP row already describes this active build.
  $("busy").hidden = !busy || !app.kernel.ready || app.stepProgress.represented();
  busyText();
  let hint = "";
  if (app.mode === "arch") hint = app.arch.hint();
  else if (app.sketcher.active) hint = app.sketchHint();
  else if (app.command) hint = app.command.hint ? app.command.hint() : "";
  else if (app.directEdit && app.directEdit.hint()) hint = app.directEdit.hint(); // jumpstart-3d: direct edit
  else if (app.mode === "beginner" && app.beginner && app.beginner.hint && app.beginner.hint()) hint = app.beginner.hint(); // jumpstart-3d: grok move. the pivot drag and Simple's Move say what a drag does
  else if (app.mode === "beginner") hint = app.vp.touchMode ? "Drag shapes onto the workplane. Drag empty space to orbit, two fingers to pan and zoom." : (IS_MAC ? "Drag shapes onto the workplane. Option-drag (or two-finger click and drag) to orbit, Option+Shift-drag to pan, pinch or scroll to zoom." : "Drag shapes onto the workplane. Right-drag to orbit, Shift+right-drag or middle-drag to pan, scroll to zoom.");
  else if (app.sel.length === 1 && !app.isLocked(app.sel[0])) hint = "Drag the white handles to scale the body. Double-click a body or timeline item to edit it.";
  else hint = app.vp.touchMode ? "Start with Sketch, or add a primitive. Drag to orbit, two fingers to pan and zoom, double-tap to edit." : (IS_MAC ? "Start with Create Sketch, or add a primitive. Drag across empty space to select (right: window, left: crossing). Option-drag orbits, Option+Shift-drag pans, pinch zooms." : "Start with Create Sketch, or add a primitive. Drag across empty space to select (right: window, left: crossing). Right-drag orbits, middle-drag pans.");
  const errs = [...app.scene.errors.entries()].filter(([id]) => findBody(store.view, id));
  if (errs.length && !app.sketcher.active) {
    const b = findBody(store.view, errs[0][0]);
    hint = `${b.name}: ${errs[0][1]}`;
    $("hint").style.color = "var(--danger)";
  } else $("hint").style.color = "";
  $("hint").textContent = hint;
  const sel = app.selected();
  if (sel.length === 1 && app.scene.views.get(sel[0].id)?.data) {
    const box = app.scene.bodyTightBox(sel[0].id);
    const s = box.getSize(new THREE.Vector3());
    $("selinfo").textContent = `${showLen(s.x)} × ${showLen(s.y)} × ${showLen(s.z)} ${getUnit()}`;
  } else $("selinfo").textContent = sel.length > 1 ? `${sel.length} selected` : "";
};
app.sketchHint = function () {
  const t = app.sketcher.tool, st = app.sketcher.state;
  const typing = " Type a number to set it exactly, Tab for the next value.";
  return {
    line: st ? "Click the next point. Click the start point to close, Esc to stop." + typing : "Click to start a line.",
    rect: st ? "Click the opposite corner." + typing : "Click the first corner.",
    rectc: st ? "Click a corner." + typing : "Click the center.",
    spline: st ? `Click more points (${st.fit ? st.fit.length : 1} so far). Click the first point to close it; double-click, Enter or Esc to finish.` : "Click the first point of the spline.",
    rect3: st ? (st.step === 1 ? "Click the end of the first side." + typing : "Click to set the width." + typing) : "Click the first corner.",
    circle: st ? "Click to set the size." + typing : "Click the center.",
    arc3: st ? (st.step === 1 ? "Click the end point." : "Click a point on the arc.") : "Click the start point.",
    arcc: st ? (st.step === 1 ? "Click the start point (sets the radius)." : "Click the end point, counter-clockwise.") : "Click the center.",
    polygon: st ? "Click to set the radius." + typing : "Click the center.",
    point: "Click to place a point (holes can use sketch points).",
    trim: "Click a segment to cut it back to the nearest intersections.",
    dim: "Sketch dimension: click a line, circle or arc (or two points or lines for a distance or angle), click again to place it, then type the value. Double-click a dimension to change it.",
    mirror: app.sketcher.mirrorHint(), // jumpstart-3d: sketch mirror
    // jumpstart-3d: Fusion-style. An empty sketch, including projected face edges, needs a drawing hint.
    select: app.sketcher.sketch && !app.sketcher.sketch.ents.some((x) => !x.proj)
      ? "Pick a tool to draw: Line (L), Rectangle (R), Circle (C), or another in the Create group."
      : "Click a line, circle or arc to type its size. Drag to move shapes, double-click a dimension to change it. Delete removes, X toggles construction. Pick a tool above to draw more.",
  }[t] || "";
};

// ------------------------------------------------------------------ shared UI helpers
app.toast = function (msg, kind = "") {
  if (kind === "err") app.lastError = String(msg); // jumpstart-3d: report (the last error is carried into the report)
  const t = el("div", { class: "toast " + kind }, msg);
  $("toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 5200 : 2600);
};

// numeric field with expression parsing, arrows to step
// press the open dialog's OK button once the latest preview has been worked out
app.submitCommand = function () {
  const def = app.command;
  if (!def || def.noEnter || def.okLabel === "Cancel" || def.okLabel === "Done") return false;
  const ok = document.getElementById("cmd-ok");
  if (!ok) return false;
  // the preview may still be rebuilding after a change (OK is greyed out meanwhile):
  // wait for it, then press OK if the result is good
  if (ok.disabled) {
    if (!(def.valid ? def.valid() : true)) return false;
    const t0 = performance.now();
    const wait = () => {
      if (app.command !== def) return;
      const b = document.getElementById("cmd-ok");
      if (b && !b.disabled && !app.scene.busy()) { b.click(); return; }
      if (def.buildError || performance.now() - t0 > 30000) return;
      setTimeout(wait, 120);
    };
    setTimeout(wait, 120);
    return true;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const b = document.getElementById("cmd-ok");
    if (app.command === def && b && !b.disabled) b.click();
  }));
  return true;
};
// fields that hold a length (shown and typed in the chosen units); the rest are angles, counts, factors…
const LEN_FIELD = /^(em-size|em-depth|ex-dist2?|ed-val2?|hole-(dia|depth|cbd|cbh|csd|p\d)|pl-d|ins-[hw]|img-w|th-len|of-d|sh-th|mv-d\d|pr-(w|d|h|tube|pos\d)|pr-x-(wall|r|c)|pt-s\d|pal-(imw|imx|imy|px|py|x|y|size|len|ax|ay|bx|by|dia|cx|cy|r)|insp-(s\d|size|h|w|d|pos\d)|pp-(size|wall)|cl-(d|h|pitch|size|o\d))$/;
app.numField = function ({ value, onCommit, step = 1, min = -Infinity, max = Infinity, id, unit = "mm", angle = false, live = false, len, expr }) {
  const isLen = !angle && (len != null ? len : !!(id && LEN_FIELD.test(id)));
  // shown in the current units; the value handed back is always mm
  const show = (v) => (isLen ? showLen(v, 3) : fmt(v, 3));
  const parseLength = (txt) => (isLen ? parseLen(txt) : parseLengthMM(txt));
  if (isLen && getUnit() === "in") step = step >= 1 ? 25.4 / 16 : 25.4 / 64;
  // jumpstart-3d: parameters. Passing expr (the saved expression text, or null) lets the field hold a parameter expression:
  // onCommit(v, text) gets the trimmed text, or null for a plain number. Without expr (undefined) the field is unchanged.
  let bound = expr || null;
  const read = (txt) => {
    const v = parseLength(txt);
    if (expr === undefined || isFinite(v)) return { v, text: null };
    return { v: evalExpr(txt, exprScope(store.view), { unit: isLen ? getUnit() : "mm", angle }), text: txt.trim() };
  };
  // phone number pads in "decimal" mode have no minus key, so only use them where negatives aren't allowed
  const inp = el("input", { class: "num" + (bound ? " fx" : ""), type: "text", inputmode: min >= 0 ? "decimal" : null, value: bound || show(value), id, spellcheck: "false", autocomplete: "off" }); // jumpstart-3d: parameters
  let last = value;
  const commit = () => {
    const { v, text } = read(inp.value);
    if (!isFinite(v) || v < min || v > max) { inp.classList.add("bad"); return; }
    inp.classList.remove("bad");
    delete inp.dataset.dirty; // jumpstart-3d: fix. committed text is not half-typed; the inspector would put it back after its redraw and commit it again on blur
    if (Math.abs(v - last) > 1e-12 || text !== bound) { last = v; bound = text; onCommit(v, text); } // jumpstart-3d: parameters
    inp.value = bound || show(v); // jumpstart-3d: parameters
    inp.classList.toggle("fx", !!bound); // jumpstart-3d: parameters
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commit(); inp.select();
      // Enter in a tool's dialog applies the change, like pressing OK
      if (!inp.classList.contains("bad") && inp.closest("#cmd")) app.submitCommand();
    }
    else if (e.key === "Escape") { inp.value = bound || show(last); inp.blur(); } // jumpstart-3d: parameters
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = parseLength(inp.value);
      const s = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === "ArrowUp" ? 1 : -1);
      inp.value = show(Math.max(min, Math.min(max, (isFinite(cur) ? cur : last) + s)));
      commit();
    }
  });
  if (live) inp.addEventListener("input", () => { const { v, text } = read(inp.value); if (isFinite(v) && v >= min && v <= max) { inp.classList.remove("bad"); inp.classList.toggle("fx", !!text); last = v; bound = text; onCommit(v, text); } }); // jumpstart-3d: parameters
  inp.addEventListener("change", commit);
  inp.addEventListener("focus", () => inp.select());
  inp.setValue = (v) => { last = v; bound = null; inp.classList.remove("fx"); if (document.activeElement !== inp) inp.value = show(v); }; // jumpstart-3d: parameters
  void unit; void angle;
  return inp;
};

// jumpstart-3d: parameters. resolve(text) can replace the length parser; onOk also gets the typed text
app.promptValue = function ({ at, label, value, onOk, onCancel, unit = getUnit(), resolve }) {
  const vpEl = $("viewport");
  vpEl.querySelector(".prompt")?.remove();
  const inp = el("input", { class: "num", value, type: "text", inputmode: "decimal", id: "prompt-value" });
  const box = el("div", { class: "prompt", style: { left: Math.min(at[0] + 12, vpEl.clientWidth - 160) + "px", top: Math.min(at[1] + 12, vpEl.clientHeight - 50) + "px" } }, el("span", {}, label), inp);
  vpEl.append(box);
  inp.focus();
  inp.select();
  let done = false;
  const close = (ok) => { if (done) return; done = true; box.remove(); app.vp.canvas.focus(); if (!ok && onCancel) onCancel(); };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { const v = resolve ? resolve(inp.value) : parseLength(inp.value, unit); if (isFinite(v)) { close(true); onOk(v, inp.value); } else inp.classList.add("bad"); }
    if (e.key === "Escape") close(false);
  });
  inp.addEventListener("blur", () => setTimeout(() => box.isConnected && close(false), 150));
};

// ------------------------------------------------------------------ keyboard
import { initEscapeKey } from "./escapekey.js"; // jumpstart-3d: Escape and dialogs (imported here, not at the top, so J.Siwek's import list merges cleanly)
// jumpstart-3d: keyboard access. true from a mouse press until the next key press: a button focused this way still hands Tab to the size box (:focus-visible cannot tell, the browser has already seen the key)
let focusByMouse = false, keyAfterMouse = false;
document.addEventListener("pointerdown", () => { focusByMouse = true; }, true);
document.addEventListener("keydown", () => { keyAfterMouse = focusByMouse; focusByMouse = false; }, true); // keyAfterMouse: this key is the first one since the press
function onKey(e) {
  if (app.escapeLayer && app.escapeLayer(e)) return; // jumpstart-3d: Escape and dialogs
  if (app.mode === "chisel") return; // Chisel has its own keys (in its frame)
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (document.querySelector(".modal-back")) return;
  // the 3D Print Sim never changes the design: only view keys work there
  if (app.simLock) {
    if (e.key === "Home") { app.vp.setView("home", app.scene.allBox()); return; }
    if (e.key === " ") { e.preventDefault(); app.advanced.printSim && app.advanced.printSim.togglePlay(); return; }
    if (["Delete", "Backspace", "Enter"].includes(e.key) || ((e.ctrlKey || e.metaKey) && /^[zyxcvdgal]$/i.test(e.key))) e.preventDefault();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
  if (mod && k === "y") { e.preventDefault(); app.redo(); return; }
  if (mod && k === "s") { e.preventDefault(); app.projects.saveVersion(); return; }
  if (e.key === "?") { e.preventDefault(); app.showShortcuts(); return; }
  if (!mod && e.shiftKey && k === "s" && !app.sketcher.active) { e.preventDefault(); app.setSnap(!app.snapOn); return; }
  if (app.mode === "arch") { if (app.arch.key(e)) e.preventDefault(); return; }
  if (app.sketcher.active) {
    if (app.sketcher.typeKey(e)) return;
    if (/^[0-9.\-]$/.test(e.key) && !app.sketcher.input.root.hidden) return;
    if (e.key === "Escape") { if (!app.sketcher.escape()) app.exitSketch(); e.preventDefault(); return; }
    if (e.key === "Enter") { if (app.sketcher.state) app.sketcher.commitTyped(); else app.exitSketch(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { app.sketcher.deleteSelection(); e.preventDefault(); return; }
    if (/^Arrow/.test(e.key) && !mod && app.sketcher.nudge(e)) { e.preventDefault(); return; }
    const map = { l: "line", r: "rect*", c: "circle", a: "arc3", p: "polygon", t: "trim", d: "dim", s: "select" };
    if (!mod && (k === "e" || k === "q")) { e.preventDefault(); app.quickExtrude(); return; }
    if (!mod && e.shiftKey && k === "t") { app.sketcher.setTool("text"); return; }
    if (!mod && map[k]) { app.sketcher.setTool(map[k]); return; }
    if (!mod && k === "x") { app.sketcher.toggleConstruction(); return; }
    if (!mod && !e.shiftKey && k === "m") { app.sketcher.setTool("mirror"); return; } // jumpstart-3d: sketch mirror
    if (k === "f" && e.shiftKey) { app.fit(); return; }
    return;
  }
  // typing a number while a tool is open goes straight into its main value (Extrude's distance)
  if (app.command && app.command.typeInto && !mod && /^[0-9.\-]$/.test(e.key)) {
    const inp = app.command.typeInto();
    if (inp && inp.isConnected) { inp.focus(); inp.select(); return; } // the key then lands in the field
  }
  // Enter applies the open tool (unless a dialog button has focus; Enter presses that button)
  if (e.key === "Enter" && app.command && !e.target.closest?.("#cmd button")) { e.preventDefault(); app.submitCommand(); return; }
  if (e.key === "Escape") {
    if (app.command) { app.command.cancel(); return; }
    app.select([]);
    return;
  }
  if (e.key === "Home") { app.vp.setView("home", app.scene.allBox()); return; }
  if (!mod && k === "e" && !e.shiftKey && !e.altKey) { e.preventDefault(); app.quickExtrude(); return; }
  // the open tool can use the arrow keys (Move / Copy moves with them, and turns with , and .)
  if (app.command && app.command.arrowKey && /^Arrow/.test(e.key) && app.command.arrowKey(e)) { e.preventDefault(); return; }
  if (app.command && app.command.turnKey && (e.code === "Comma" || e.code === "Period") && app.command.turnKey(e)) { e.preventDefault(); return; }
  // jumpstart-3d: keyboard access. Tab (type a size on the selected shape) goes to the shape only while the view or the page has the focus, or a button the mouse just clicked; a button the keyboard reached, and anything in the import note, keeps Tab as the browser moves it
  if (e.key === "Tab" && e.target !== app.vp.canvas && e.target !== document.body && e.target !== document.documentElement && (e.target.closest?.("#toasts") || !keyAfterMouse)) return;
  const handled = app.mode === "beginner" ? app.beginner.key(e) : app.advanced.key(e);
  if (handled) e.preventDefault();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

// Our addition: the app and its document store on window, as the author's app/test/dbg.js
// exposed them for his Playwright scripts. The regression tests in test/ drive both builds through these.
window.__app = app; window.__store = store; window.__findBody = findBody;

// jumpstart-3d: scripting bridge. window.JS3D, documented in BRIDGE.md; does nothing until a script calls it.
initBridge(app);
initCodeCad(app); // jumpstart-3d: Code CAD. the Code CAD… menu entry and app.codeCad; nothing runs until Build or Update
initRunScript(app); // jumpstart-3d: run script. the Run script… menu entry; runs a chosen .js file with JS3D in scope
initChat(app); // jumpstart-3d: chat inside the app. the AI button and panel; idle until clicked
initReport(app); // jumpstart-3d: report. Report a problem (Open/Export menu and About); the app sends nothing
initShareLink(app); // jumpstart-3d: share link. Share link… and Import shared link (Open/Export menu); the link stays in the address, nothing is uploaded
