// App core: wiring, modes, selection, keyboard, shared UI helpers.
import { initProjector } from "./projector.js";
import { initMedia } from "./media.js";
import { inflate } from "./inflate.js";
import { CREDITS, LICENSE_TEXTS } from "./licenses.js";
import { initSketch3D } from "./sketch3d.js";
import { initLathe } from "./lathe.js";
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
import { SceneSync } from "./scene.js";
import { Sketcher } from "./sketcher.js";
import { store, findBody } from "./store.js";
import { setCustomTextureSource } from "./texture.js";
setCustomTextureSource(() => ({ ...(store.doc.texImages || {}), ...((store.preview && store.preview.texImages) || {}) }));
import { el, parseLength, fmt, IS_MAC, IS_IOS, IS_IPHONE, watchMacLabels } from "./util.js";
const parseLengthMM = parseLength;
import { evalExpr, exprScope } from "./params.js"; // jumpstart-3d: parameters
import { getUnit, setUnit, onUnit, toU, fromU, showLen, parseLen, unitName, SNAP_SIZES } from "./units.js";
import { setThemeColors, theme } from "./theme.js";
import { ICON } from "./icons.js";
import { initBeginner } from "./beginner.js";
import { initAdvanced } from "./advanced.js";
import { initProjects } from "./projects.js";
import { initFlexiGen } from "./flexigen.js";
import { initMeshStep } from "./meshstep.js";
import { initCosForge } from "./cosforge.js";
import { initChisel } from "./chisel.js";
import { initMeshDetail } from "./meshdetail.js";
import { initPrinterPreview } from "./printerpreview.js"; // jumpstart-3d: printer plate
import { initBridge } from "./bridge.js"; // jumpstart-3d: scripting bridge
import { initRunScript } from "./runscript.js"; // jumpstart-3d: run script
import { initChat } from "./chat.js"; // jumpstart-3d: chat inside the app
import { initReport } from "./report.js"; // jumpstart-3d: report
import { captureShare, initShareLink } from "./sharelink.js"; // jumpstart-3d: share link
captureShare(); // jumpstart-3d: share link. first thing: a design link's fragment goes into memory and off the address bar, before boot() or the bridge can see it
import { initLoadUI } from "./loadui.js"; // jumpstart-3d: load
import { initFineTurn } from "./fineturn.js"; // jumpstart-3d: fine rotation
import { initPivot } from "./pivot.js"; // jumpstart-3d: pivot
import { initPerfPanel } from "./perfpanel.js"; // jumpstart-3d: perf panel
import { initDropImport } from "./dropimport.js"; // jumpstart-3d: drop import

/* global __WASM_PARTS__ */
const WASM_PARTS = typeof __WASM_PARTS__ !== "undefined" ? __WASM_PARTS__ : [{ url: "occt.wasm.gz", gz: true }];

const $ = (id) => document.getElementById(id);

export const app = {
  mode: "beginner",
  sel: [],
  clipboard: null,
  snapOn: true,
  objectSnap: true,
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
  const kernel = (app.kernel = new KernelClient({
    ...engineSources(),
    onProgress: (m) => load.progress(m, WASM_PARTS.reduce((s, p) => s + (p.size || 0), 0)), // jumpstart-3d: load
    onReady: () => { load.ready(); app.status(); }, // jumpstart-3d: load. no hold: the splash is already gone
    onResults: () => {
      app.scene.refresh(); app.status(); app.onBuilt && app.onBuilt();
      app.advanced && app.advanced.showBuildErrors();
      // frame the design once its first meshes arrive
      if (app.needFit && !app.scene.busy()) { app.needFit = false; const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }
    },
    onFail: (msg) => load.fail(msg), // jumpstart-3d: load
  }));
  kernel.onBusy = () => app.status();
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
// jumpstart-3d: match the static splash before the app loads.
{ const sv = document.getElementById("sp-ver"); if (sv) sv.textContent = "Version " + BUILD_LABEL; }
app.bricks = initBricks(app);
app.voxel = initVoxel(app);
  // Save makes a new version (v1, v2...); the number shows next to the name
  app.onVersion = () => app.refreshUI && app.refreshUI("version");
  $("btn-save").onclick = () => app.projects.saveVersion();
  $("btn-tutorials").onclick = () => app.tutorials.open();
  $("btn-tutorials-menu").onclick = () => { $("menu-export").hidden = true; app.tutorials.open(); }; // jumpstart-3d: phone entry
  app.flexigen = initFlexiGen(app);
  app.meshstep = initMeshStep(app);
  app.cosforge = initCosForge(app);
  app.chisel = initChisel(app);
  app.arch = initArch(app);
  app.cam = initCam(app);
  app.plateView = initPrinterPreview(app); // jumpstart-3d: printer plate. Printer plate… in the Settings menu, overhang shading

  store.on((kind) => {
    const doc = store.view;
    // keep the selection valid
    app.sel = app.sel.filter((id) => findBody(doc, id));
    if (app.sketcher.active && !doc.sketches.some((s) => s.id === app.sketcher.active)) app.exitSketch();
    scene.state.hideSketch = app.sketcher.active;
    scene.sync(doc);
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
  };
  $("snap").onchange = () => { gridFromSnap(); savePrefs(); };
  // mm / inch switch, always in the status bar: changes every readout and typed value
  $("unit-toggle").onclick = () => setUnit(getUnit() === "in" ? "mm" : "in");
  initFineTurn(app); // jumpstart-3d: fine rotation
  initPerfPanel(app); // jumpstart-3d: perf panel
  initDropImport(app); // jumpstart-3d: drop import. a model file dropped anywhere on the page opens like the Import button
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
  const syncSnapMenu = () => { $("snap-grid-chk").checked = app.snapOn; $("snap-obj-chk").checked = app.objectSnap; };
  smore.onclick = (e) => {
    e.stopPropagation(); smenu.hidden = !smenu.hidden; smore.setAttribute("aria-expanded", !smenu.hidden); syncSnapMenu();
    // it opens upward from the button (the status bar would clip it)
    const r = smore.getBoundingClientRect();
    smenu.style.right = Math.max(8, innerWidth - r.right) + "px"; smenu.style.bottom = (innerHeight - r.top + 8) + "px";
  };
  $("snap-grid-chk").onchange = (e) => app.setSnap(e.target.checked);
  $("snap-obj-chk").onchange = (e) => app.setObjectSnap(e.target.checked);
  window.addEventListener("pointerdown", (e) => { if (!smenu.hidden && !smenu.contains(e.target) && !smore.contains(e.target)) { smenu.hidden = true; smore.setAttribute("aria-expanded", "false"); } });
  app.syncSnapMenu = syncSnapMenu;
  // the sketch palette's snap checkbox drives the same setting
  Object.defineProperty(app.sketcher, "snapOn", { get: () => app.snapOn, set: (v) => app.setSnap(v) });
  // theme menu
  const tmenu = $("menu-theme");
  $("btn-theme").onclick = () => { tmenu.hidden = !tmenu.hidden; if (!tmenu.hidden) app.syncMeshDetailUI(); };
  tmenu.addEventListener("click", (e) => { const b = e.target.closest("button"); const t = b?.dataset.theme, pf = b?.dataset.perf, md = b?.dataset.detail; if (t) { app.setTheme(t); tmenu.hidden = true; } else if (md) { app.setMeshDetail(md); tmenu.hidden = true; } else if (pf) { app.setPerf(pf); tmenu.hidden = true; } });
  window.addEventListener("pointerdown", (e) => { if (!tmenu.hidden && !tmenu.contains(e.target) && !e.target.closest("#btn-theme")) tmenu.hidden = true; });
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
  vp.onContext = (e) => app.contextMenu && app.contextMenu(e);

  document.addEventListener("keydown", onKey);
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

app.enterSketch = function (id) {
  if (app.command) app.command.cancel();
  app.select([]);
  app.sketcher.enter(id);
  app.scene.state.hideSketch = id;
  app.scene.syncSketches(store.view);
  app.refreshUI("sketch");
};
app.exitSketch = function () {
  if (!app.sketcher.active) return;
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
  try { localStorage.setItem("workplane.ui.v1", JSON.stringify({ theme: app.themePref, snap: app.snapOn, obj: app.objectSnap, grid: snapPick.mm, gridIn: snapPick.in, lightOn: app.vp.realistic, appear: app.scene.state.appearance !== false })); } catch (e) {}
}
function loadPrefs() {
  const p = readPrefs();
  if (p.grid) snapPick.mm = p.grid;
  if (p.gridIn) snapPick.in = p.gridIn;
  fillSnapSizes();
  $("unit-toggle").textContent = unitName();
  app.objectSnap = p.obj !== false;
  $("snap-obj").setAttribute("aria-pressed", app.objectSnap);
  app.setSnap(p.snap !== false, true);
  app.setTheme(p.theme || "system", true);
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
    app.toast("Switched to " + PERF_NAMES[next] + " to keep things smooth. You can change it in the theme menu (◐).");
  } else if (app.perfPref !== "auto" && i < 2 && !slowTold) {
    slowTold = true;
    app.toast("Things look slow on this computer. Try " + (i === 0 ? "High or Normal" : "Normal") + " in the theme menu (◐): " + (i === 0 ? "they draw" : "it draws") + " less, and every tool still works.");
  }
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
        // jumpstart-3d: the main button goes to the community build; the author's site stays as a second link
        el("a", { class: "btn primary", id: "ab-community", href: "https://github.com/MaxSikorski/jumpstart-3d", target: "_blank", rel: "noopener" }, "Visit the community build"),
        // jumpstart-3d: support link (community build), at the top of About
        el("a", { class: "btn", id: "ab-support", href: "https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08", target: "_blank", rel: "noopener" }, "Support"),
        el("a", { class: "btn", id: "ab-site", href: SITE_URL, target: "_blank", rel: "noopener" }, "J.Siwek's site")),
      el("p", { class: "ab-upmsg", id: "ab-upmsg", role: "status", hidden: true }),
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
        ["Saving:", "designs are kept in this browser. Save (or Ctrl+S) makes a new version each time: \"Lopez, Maria, Keychain v1\", v2, v3…, and STL and project files carry the same name and number. Optional Autosave keeps numbered backups (\"… autosave v1\", v2…) with crash recovery."]]),
      sec("Viewing", [
        ["Lighting:", "realistic shading and shadows (sun button), light, dark or high-contrast themes, orthographic view and the view cube."],
        ["Projection & animation:", "Projector (a second window that shows your objects on black, for a projector or second screen), Media (pictures and videos on objects: facing view, wrap around, all sides or ball), and Picture to 3D model (puffs a picture's subject up into a rounded, printable solid with the picture painted on), and in Chisel: ready-made characters (people, heads, animals, aliens), textures, a History strip, and the Puppet Animator (rig, pose, keyframes up to 10 seconds, an animation library, a virtual set with your own background, MP4 export)."],
        ["Performance:", "Auto, Normal (slower computers), High (most laptops and Chromebooks) or Ultra (powerful computers, sharpest) in the theme menu (◐): lighter modes draw fewer pixels while the view moves and simpler shadows, with every tool and export unchanged. Auto picks a mode for the computer and steps down if things get slow."],
        ["Tutorials:", "fifty-one step-by-step projects (nineteen in Beginner, twenty in Advanced, twelve in Architect, marked Easy, Proficient, Advanced or Expert, 5-15 minutes each), from a name keychain and a rocket to a chess pawn, a wall hook, a box with a drawer and a candy jar with a screw-on lid. Each step shows which tool to use, how and when, with a short animation, and ticks itself off when it's done."], // jumpstart-3d: tutorials count
        ["Mesh detail:", "Normal, Fine, Extra fine or a custom level up to 32× in the theme menu (◐): how finely curved surfaces are divided into triangles, in the view and in STL, OBJ and 3MF exports. STEP is exact at every level. The menu shows the triangle count of your design and estimates it for other levels; above 500,000 it asks first, because building can take minutes."],
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
          ...[["MIT License: three.js", "mit-three"], ["MIT License: replicad", "mit-replicad"], ["MIT License: opentype.js", "mit-opentype"], ["ISC License: Flatbush", "isc"], ["GNU Lesser General Public License 2.1: Open CASCADE Technology / opencascade.js / replicad-opencascadejs", "lgpl"], ["SIL Open Font License 1.1: Poppins, Liberation, IBM Plex, Barlow", "ofl"]]
            .map(([t, k]) => el("div", { class: "ab-lic" }, el("b", {}, t), el("pre", {}, LICENSE_TEXTS[k]))))),
      // jumpstart-3d: use the same community build label as the splash.
      el("div", { class: "ab-update" }, el("span", { class: "ab-ver", id: "ab-ver" }, "Version " + BUILD_LABEL),
        el("a", { class: "btn", href: "https://github.com/MaxSikorski/jumpstart-3d/releases", target: "_blank", rel: "noopener" }, "What's new"),
        el("a", { class: "btn", href: "https://github.com/MaxSikorski/jumpstart-3d/issues", target: "_blank", rel: "noopener" }, "Report a bug or idea"))));
  back.append(modal);
  document.body.append(back);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
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
      rows("Beginner", [["L R C", "Sketch a line, rectangle or circle"], ["E", "Extrude"], ["A", "Align"], ["P", "Pattern"], ["M", "Mirror"], ["H", "Make hole"], ["S", "Make solid"], ["D", "Drop to workplane"], ["T", "Texture"], ["F", "Fit all"], ["Arrows", "Nudge, the way it looks on screen (Shift ×10)"], ["Ctrl ↑↓", "Lift / lower"], [", .", "Turn 1° after a rotation arc (Shift 15°)"], ["Ctrl G", "Group (Shift: ungroup)"], ["Ctrl D", "Duplicate"], ["Tab", "Type sizes on the selected shape (Shift Tab: back)"], ["I", "Measure"]]),
      rows("Architect", [["W", "Wall (click each corner)"], ["R", "Room (drag corner to corner)"], ["E", "Raise walls"], ["D", "Door"], ["N", "Window"], ["O", "Roof"], ["G", "Floor"], ["T", "Finishes (textures, colours, patterns)"], ["L", "Landscape (ground, water, plants)"], ["S", "Simulate (weather, flood test)"], ["Arrows", "Nudge the selected roof, door or window"], ["V", "Select"], ["0-9 Enter", "While drawing a wall: type its exact length (12' 6\" or 3600)"], ["Enter", "Finish the walls you are drawing"], ["Shift", "Draw at any angle"], ["Alt", "Turn snapping off for a moment"], ["P", "Plan view / 3D"], ["X", "See-through on or off"], ["Delete", "Delete the selection"], ["Esc", "Stop drawing, back to Select"]]),
      rows("Chisel (Pro)", [["D", "Standard brush"], ["C", "Clay"], ["S", "Smooth"], ["T", "Flatten"], ["G", "Move brush"], ["N", "Snakehook"], ["Q", "Mask"], ["J", "Paint"], ["M", "Select & move"], ["[ ]", "Brush size"], ["Shift drag", "Smooth"], ["Alt drag", "Invert brush"], ["Ctrl drag", "Mask"], ["X", "Mirror X"], ["F", "Frame"], ["Drag right / left", "Window / crossing select (Select & move)"], ["Tab", "Type sizes (Select & move)"], ["R C P", "Rectangle, circle, polygon (Sketch)"], ["E", "Extrude the sketch"], ["Esc", "Cancel the shape / sketch"]]),
      ...(IS_MAC ? [rows("Mac trackpad", [["Option drag", "Orbit"], ["Option Shift drag", "Pan"], ["Pinch", "Zoom"], ["Two-finger scroll", "Zoom"], ["Control click", "Right-click menu (drag to orbit)"]])] : []),
      rows("Everywhere", [[", .", "After using a rotation arc or ring: turn 1° (Shift: 15°)"], ["Shift drag", "On a rotation arc or ring: turn by any angle (otherwise 15° steps)"], ["Turn − +", "In the status bar: turn the selected shape by the chosen step (15, 5, 1, 0.5 or 0.1°); the , and . keys use that step too"], ["Ctrl C", "Copy"], ["Ctrl V", "Paste"], ["Ctrl A", "Select all"], ["Right-click", "Copy, paste, duplicate, delete"], ["Ctrl Z", "Undo"], ["Ctrl Shift Z", "Redo"], ["Ctrl L", "Lock / unlock"], ["Ctrl S", "Save"], ["Shift S", "Snapping on / off"], ["Del", "Delete"], ["Home", "Home view"], ["?", "This list"]])));
  back.append(modal);
  document.body.append(back);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
  modal.querySelector(".xbtn").focus();
};

// E: extrude from anywhere. From inside a sketch it finishes the sketch and
// starts the extrude with that sketch's shape picked.
app.quickExtrude = function (opts = {}) {
  const sk = app.sketcher.active;
  if (sk && app.sketcher.state) app.sketcher.done();
  if (app.command) app.command.cancel();
  if (sk) app.exitSketch();
  app.advanced.extrude(sk ? { sketch: sk, ...opts } : {});
};
// Beginner: as soon as a sketch has a new closed shape, Extrude opens on it (already 10 mm up,
// with the big arrow); Cancel goes back to the sketch to keep drawing
app.onShapeClosed = function (skId, regionKeys) {
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

app.status = function () {
  const busy = app.scene && (app.scene.busy() || app.kernel.inflight || app.kernel.queue.size);
  $("busy").hidden = !busy || !app.kernel.ready;
  let hint = "";
  if (app.mode === "arch") hint = app.arch.hint();
  else if (app.sketcher.active) hint = app.sketchHint();
  else if (app.command) hint = app.command.hint ? app.command.hint() : "";
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
    select: "Click a line, circle or arc to type its size. Drag to move shapes, double-click a dimension to change it. Delete removes, X toggles construction. Pick a tool above to draw more.",
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
function onKey(e) {
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
initRunScript(app); // jumpstart-3d: run script. the Run script… menu entry; runs a chosen .js file with JS3D in scope
initChat(app); // jumpstart-3d: chat inside the app. the AI button and panel; idle until clicked
initReport(app); // jumpstart-3d: report. Report a problem (Open/Export menu and About); the app sends nothing
initShareLink(app); // jumpstart-3d: share link. Share link… and Import shared link (Open/Export menu); the link stays in the address, nothing is uploaded
