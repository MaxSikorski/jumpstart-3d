// App core: wiring, modes, selection, keyboard, shared UI helpers.
import { initProjector } from "./projector.js";
import { initMedia } from "./media.js";
import { inflate } from "./inflate.js";
import { CREDITS, LICENSE_TEXTS } from "./licenses.js";
import { initSketch3D } from "./sketch3d.js";
import { initLathe } from "./lathe.js";
import { VERSION } from "./version.js";
import { initBricks } from "./bricks.js";
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
import { initChisel } from "./chisel.js";
import { initMeshDetail } from "./meshdetail.js";
import { initBridge } from "./bridge.js"; // jumpstart-3d: scripting bridge
import { initRunScript } from "./runscript.js"; // jumpstart-3d: run script

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
  const vpEl = $("viewport");
  const vp = (app.vp = new Viewport(vpEl));
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
  const kernel = (app.kernel = new KernelClient({
    ...engineSources(),
    onProgress: (m) => {
      if (m.phase === "compile") { $("loading-msg").textContent = "Compiling the kernel…"; $("loading-bar").style.width = "96%"; return; }
      const total = WASM_PARTS.reduce((s, p) => s + (p.size || 0), 0) || m.size || 1;
      app._got = app._got || {};
      app._got[m.part] = m.got;
      const got = Object.values(app._got).reduce((a, b) => a + b, 0);
      $("loading-bar").style.width = Math.min(94, (got / total) * 94) + "%";
    },
    onReady: () => {
      // let the splash be seen for a moment, then fade it away
      const wait = Math.max(0, 1700 - performance.now()) + 2000; // at least ~1.7 s after the page started, plus 2 s
      $("loading-bar").style.width = "100%";
      $("loading-msg").textContent = "Ready";
      setTimeout(() => { $("loading").classList.add("done"); setTimeout(() => { $("loading").hidden = true; }, 450); }, wait);
      app.status();
    },
    onResults: () => {
      app.scene.refresh(); app.status(); app.onBuilt && app.onBuilt();
      app.advanced && app.advanced.showBuildErrors();
      // frame the design once its first meshes arrive
      if (app.needFit && !app.scene.busy()) { app.needFit = false; const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }
    },
    onFail: (msg) => {
      $("loading-msg").textContent = "The geometry engine couldn't start: " + msg + ". Reload the page to try again.";
      $("loading-bar").style.background = "var(--danger)";
    },
  }));
  kernel.onBusy = () => app.status();
  kernel.start();
  const scene = (app.scene = new SceneSync(vp, kernel));
  vp.zoomTargets = () => scene.meshes();
  app.sketcher = new Sketcher(app);
  scene.onRefresh = () => app.onSceneRefresh && app.onSceneRefresh();
  // a shape's size and position boxes need its finished geometry: show them once it arrives
  let drawnKey; // jumpstart-3d: fix. redraw when a new mesh lands, not only when the position boxes are missing
  app.onSceneRefresh = () => {
    if (app.mode !== "beginner" || app.sel.length !== 1 || app.command || app.sketcher.active) return;
    const insp = $("inspector"), key = scene.views.get(app.sel[0])?.key; // jumpstart-3d: fix
    if (insp && !insp.hidden && key && key !== drawnKey) { drawnKey = key; setTimeout(() => app.refreshUI("geometry"), 0); } // jumpstart-3d: fix
  };

  // on small screens the side panels start tucked away (toggle from the toolbar)
  if (window.matchMedia("(max-width: 860px)").matches) { $("shapes").classList.add("collapsed"); $("browser").classList.add("collapsed"); }
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
{ const sv = document.getElementById("sp-ver"); if (sv) sv.textContent = "Version " + VERSION; }
app.bricks = initBricks(app);
  // Save makes a new version (v1, v2...); the number shows next to the name
  app.onVersion = () => app.refreshUI && app.refreshUI("version");
  $("btn-save").onclick = () => app.projects.saveVersion();
  $("btn-tutorials").onclick = () => app.tutorials.open();
  app.flexigen = initFlexiGen(app);
  app.meshstep = initMeshStep(app);
  app.chisel = initChisel(app);

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
  $("nav-home").onclick = () => vp.setView("home", scene.allBox());
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
  });
}

// ------------------------------------------------------------------ modes
app.setMode = function (mode, initial) {
  if (app.mode === mode && !initial) return;
  if (app.command) app.command.cancel();
  // Chisel: sculpting in its own frame over the work area. Leaving it saves the
  // sculpts into the design as mesh bodies.
  const wasChisel = app.mode === "chisel";
  app.mode = mode;
  document.getElementById("app").dataset.mode = mode;
  $("mode-beginner").setAttribute("aria-pressed", mode === "beginner");
  $("mode-advanced").setAttribute("aria-pressed", mode === "advanced");
  $("mode-chisel").setAttribute("aria-pressed", mode === "chisel");
  if (mode === "chisel") {
    $("inspector").hidden = true;
    document.querySelectorAll(".popover").forEach((p) => p.remove());
    app.chisel.enter();
    app.refreshUI("mode");
    return;
  }
  if (wasChisel) app.chisel.leave();
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
  if (mode !== "chisel") app.toast(mode === "advanced" ? "Advanced mode: sketches, features and the timeline" : "Beginner mode: drag shapes, group and cut with holes");
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

// keyboard shortcuts sheet
app.showAbout = function () {
  const sec = (title, items) => el("section", {}, el("h3", {}, title), el("ul", {}, ...items.map(([b, t]) => el("li", {}, el("b", {}, b), " " + t))));
  const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) back.remove(); } });
  const logo = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5 12 21l9-4.5L12 12z" fill="#2d63c8"/><path d="M3 12 12 16.5 21 12 12 7.5z" fill="#6f98d8"/><path d="M3 7.5 12 12l9-4.5L12 3z" fill="#c9d3df"/></svg>';
  const modal = el("div", { class: "modal about", role: "dialog", "aria-label": "About JumpStart 3D" },
    el("header", {}, el("h2", {}, "About"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })),
    el("div", { class: "mbody", id: "about-body" },
      el("div", { class: "ab-head", html: logo }, el("div", {}, el("b", {}, "JumpStart 3D ", el("span", { class: "ab-hver" }, "Version " + VERSION)), el("span", {}, "3D design for the browser: start simple, grow into real CAD, then 3D print it."))),
      sec("New in version 2.0", [
        ["3D Sketch:", "draw lines in 3D on a body, a virtual sphere, egg or cube, or in the air, with a split screen: turn the camera with one hand while you draw with the other (touch, pen, mouse or trackpad). Freehand or nodes, undo and redo; every line becomes a solid tube."],
        ["Lathe:", "turn a body (or a copy of it) or a square or round blank on a virtual wood lathe: pick the speed, a foot pedal (Space) that you hold or that stays on, seven chisels you can twist, flying chips, then hollow it out and add it to the design or export STL, 3MF or OBJ. In Beginner, Advanced and Chisel."],
        ["Jump Brick Builder:", "in Advanced → Simulate, rebuild objects out of printable stud-and-tube building bricks (classic 8 mm or jumbo 16 mm) with a parts list and layer-by-layer building steps, built in place or laid out on print beds."],
        ["Also:", "a 256 × 256 mm Beginner workplane, path patterns in Advanced, imperial threads, and two new Lathe tutorials."],
      ]),
      sec("Three modes", [
        ["Beginner:", "drag-and-drop shapes, solids and holes, grouping, align, mirror, pattern and drop to workplane, like Tinkercad."],
        ["Advanced:", "sketch-based, parametric modeling with a feature timeline, like Fusion 360."],
        ["Chisel:", "3D sculpting with brushes, like digital clay, in Easy (big, simple tools for kids and first-timers) or Pro (30 brushes, masking, cuts and more)."],
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
        ["Decorate:", "surface textures (including your own pictures), emboss or deboss text on flat and curved faces, and appearances (colors and materials)."],
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
        ["FlexiGen:", "turn one object into a print-in-place articulated flexi model with six joint styles, then export STL or 3MF. It works on a copy, so your design is never changed."],
        ["Render:", "photo-style pictures with studio, sun, spotlight, overcast or three-point lighting, light color and direction, your own background picture, and Low to Ultra high quality, saved as PNG."]]),
      sec("Files and saving", [
        ["Export:", "STL, OBJ, 3MF and STEP: everything, or only the bodies you select. Sketches as DXF (one, or all) for laser cutters and other CAD."],
        ["Section analysis:", "in Advanced → Inspect, cut the view with a plane to see inside your design, with hatched cut faces. The design itself never changes."],
        ["Import:", "STL and 3MF meshes (repaired automatically) and STEP models in both modes, SVG and DXF drawings, and pictures to trace: drag their handles to scale, stretch and turn them, scale one from a length you know, or Auto trace a picture into outlines ready to extrude."],
        ["Mesh to STEP:", "in Advanced → Simulate, convert an STL or 3MF mesh into a STEP solid with real flat, round and curved faces, then open it in JumpStart 3D to edit it with CAD tools."],
        ["Saving:", "designs are kept in this browser. Save (or Ctrl+S) makes a new version each time: \"Lopez, Maria, Keychain v1\", v2, v3…, and STL and project files carry the same name and number. Optional Autosave keeps numbered backups (\"… autosave v1\", v2…) with crash recovery."]]),
      sec("Viewing", [
        ["Lighting:", "realistic shading and shadows (sun button), light, dark or high-contrast themes, orthographic view and the view cube."],
        ["Projection & animation:", "Projector (a second window that shows your objects on black, for a projector or second screen), Media (pictures and videos on objects: facing view, wrap around, all sides or ball), and Picture to 3D model (puffs a picture's subject up into a rounded, printable solid with the picture painted on), and in Chisel: ready-made characters (people, heads, animals, aliens), textures, a History strip, and the Puppet Animator (rig, pose, keyframes up to 10 seconds, an animation library, a virtual set with your own background, MP4 export)."],
        ["Performance:", "Auto, Normal (slower computers), High (most laptops and Chromebooks) or Ultra (powerful computers, sharpest) in the theme menu (◐): lighter modes draw fewer pixels while the view moves and simpler shadows, with every tool and export unchanged. Auto picks a mode for the computer and steps down if things get slow."],
        ["Tutorials:", "nineteen step-by-step projects (nine in Beginner, ten in Advanced, marked Easy, Proficient or Advanced, 5-15 minutes each), from a name keychain and a rocket to a chess pawn, a wall hook, a box with a drawer and a candy jar with a screw-on lid. Each step shows which tool to use, how and when, with a short animation, and ticks itself off when it's done."], // jumpstart-3d: tutorials count
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
      el("div", { class: "ab-update" }, el("span", { class: "ab-ver", id: "ab-ver" }, "Version " + VERSION + " · community build"),
        el("a", { class: "btn", href: "https://github.com/MaxSikorski/jumpstart-3d/releases", target: "_blank", rel: "noopener" }, "What's new"),
        // jumpstart-3d: support link (community build)
        el("a", { class: "btn", href: "https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08", target: "_blank", rel: "noopener" }, "Support"),
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
      rows("Advanced", [["L R C", "Start a sketch with that tool"], ["S", "Create sketch"], ["E", "Extrude"], ["Shift R", "Revolve"], ["Q", "Offset face (press pull)"], ["H", "Hole"], ["F", "Fillet"], ["Shift C", "Chamfer"], ["M", "Move / copy"], ["A", "Align"], ["P", "Pattern"], ["B", "Combine"], ["T", "Texture"], ["I", "Measure"], ["Shift F", "Fit all"], ["Drag right / left", "Window / crossing select"]]),
      rows("Beginner", [["L R C", "Sketch a line, rectangle or circle"], ["E", "Extrude"], ["A", "Align"], ["P", "Pattern"], ["M", "Mirror"], ["H", "Make hole"], ["S", "Make solid"], ["D", "Drop to workplane"], ["T", "Texture"], ["F", "Fit all"], ["Arrows", "Nudge (Shift ×10)"], ["Ctrl ↑↓", "Lift / lower"], ["Ctrl G", "Group (Shift: ungroup)"], ["Ctrl D", "Duplicate"], ["Tab", "Type sizes on the selected shape (Shift Tab: back)"], ["I", "Measure"]]),
      rows("Chisel (Pro)", [["D", "Standard brush"], ["C", "Clay"], ["S", "Smooth"], ["T", "Flatten"], ["G", "Move brush"], ["N", "Snakehook"], ["Q", "Mask"], ["J", "Paint"], ["M", "Select & move"], ["[ ]", "Brush size"], ["Shift drag", "Smooth"], ["Alt drag", "Invert brush"], ["Ctrl drag", "Mask"], ["X", "Mirror X"], ["F", "Frame"], ["Drag right / left", "Window / crossing select (Select & move)"], ["Tab", "Type sizes (Select & move)"], ["R C P", "Rectangle, circle, polygon (Sketch)"], ["E", "Extrude the sketch"], ["Esc", "Cancel the shape / sketch"]]),
      ...(IS_MAC ? [rows("Mac trackpad", [["Option drag", "Orbit"], ["Option Shift drag", "Pan"], ["Pinch", "Zoom"], ["Two-finger scroll", "Zoom"], ["Control click", "Right-click menu (drag to orbit)"]])] : []),
      rows("Everywhere", [["← →", "After using a rotation arc or ring: turn 1° (Shift: 15°)"], ["Ctrl C", "Copy"], ["Ctrl V", "Paste"], ["Ctrl A", "Select all"], ["Right-click", "Copy, paste, duplicate, delete"], ["Ctrl Z", "Undo"], ["Ctrl Shift Z", "Redo"], ["Ctrl L", "Lock / unlock"], ["Ctrl S", "Save"], ["Shift S", "Snapping on / off"], ["Del", "Delete"], ["Home", "Home view"], ["?", "This list"]])));
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
  app.scene.setSelected(app.sel);
  app.refreshUI("select");
};
app.selected = () => app.sel.map((id) => findBody(store.view, id)).filter(Boolean);

app.fit = function () {
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
  if (app.mode === "beginner") {
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
  if (app.sketcher.active) hint = app.sketchHint();
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
  if (app.sketcher.active) {
    if (app.sketcher.typeKey(e)) return;
    if (/^[0-9.\-]$/.test(e.key) && !app.sketcher.input.root.hidden) return;
    if (e.key === "Escape") { if (!app.sketcher.escape()) app.exitSketch(); e.preventDefault(); return; }
    if (e.key === "Enter") { if (app.sketcher.state) app.sketcher.commitTyped(); else app.exitSketch(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { app.sketcher.deleteSelection(); e.preventDefault(); return; }
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
  // the open tool can use the arrow keys (Move / Copy turns 1° with them)
  if (app.command && app.command.arrowKey && /^Arrow/.test(e.key) && app.command.arrowKey(e)) { e.preventDefault(); return; }
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
