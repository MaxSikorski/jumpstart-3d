// Printer plate and overhang shading for the design view (our addition).
//  - "Printer plate…" in the Settings menu: pick a named printer's build area (or the generic 256 × 256 plate, or no
//    boundary at all). The plate is drawn at Z=0 from the same X × Y (viewport.js setPlateSize). Nothing in the design
//    moves, turns, scales or rebuilds; a plain line says which parts reach outside the area.
//  - Overhang shading: the faces that lean out more than a chosen angle from upright are drawn in red, as a display-only
//    overlay on the body views. The maths is in overhang.js (shared with the 3D Print Sim); the printer list and the saved
//    choice are in printerpresets.js. The choice is a viewing preference in its own localStorage key: not geometry, not an
//    undo step, not a design parameter, never exported.
// The overlay shares each body mesh's position buffer and owns only its triangle list and a red material. It reads the mesh;
// it never writes to it, to the picking meshes, the edges or any export buffer. It stands aside while the 3D Print Sim,
// Section analysis, joint simulations or the Projector are on, and returns when they end.
import * as THREE from "three";
import { el } from "./util.js";
import { PRINTERS, PLATE_PRINTERS, plateDims, getPlatePref, setPlatePref, onPlatePref, ANGLE_MIN, ANGLE_MAX } from "./printerpresets.js";
import { startJob } from "./overhang.js";

const START_DELAY = 60;   // ms after a change before a job starts (a drag sends many)
const SLIDER_DELAY = 200; // ms the angle slider waits for the hand to stop
const CHUNK_MS = 8;       // longest slice of work before the page gets control back
const LARGE_TRIANGLES = 1000000; // starting size above which a mesh must be analysed on request (to be measured, not a promise)

export function initPrinterPreview(app) {
  const vp = app.vp, scene = app.scene;
  const ovs = new Map();         // body id -> { view, geoId, sig, gen, job, mesh, state, timer, tris }
  const approved = new Set();    // geometry ids the user asked to analyse although they are large
  const stats = { jobs: 0, chunks: 0, longestChunkMs: 0, lastTriangles: 0, lastMs: 0, cancelled: 0 };
  const api = { stats, largeTriangles: LARGE_TRIANGLES };
  let dialog = null, chip = null, fitTimer = 0;

  // ------------------------------------------------------------------ the plate
  const modeShowsPlate = () => app.mode === "beginner" || app.mode === "advanced";
  vp.plateOK = modeShowsPlate;
  function applyPlate() {
    const d = plateDims(getPlatePref().printer);
    vp.setPlateSize(d ? d.w : 0, d ? d.d : 0);
  }
  applyPlate();

  // ------------------------------------------------------------------ the overlay
  function suspended() {
    if (!modeShowsPlate() || app.simLock) return true;
    if (app.section && app.section.info) return true;
    if (scene.state.pose && scene.state.pose.size) return true;
    if (app.projector && app.projector.isOpen) return true;
    const ws = document.getElementById("ws-simulate");
    return !!(ws && ws.getAttribute("aria-selected") === "true");
  }
  const eligible = (id, v) => {
    const b = v.body;
    return !!(v.mesh && v.data && b && !b.hole && !b.cmdPreview && !b.cutPreview && !v.pending && v.group.visible && !scene.state.ghost.has(id));
  };
  const tmpM = new THREE.Matrix4(), tmpL = new THREE.Matrix4();
  // the matrix that puts the mesh's own coordinates in the world: the body's pose times any stretch shown while it rebuilds
  function worldOf(v) {
    tmpL.compose(v.mesh.position, v.mesh.quaternion, v.mesh.scale);
    return tmpM.multiplyMatrices(v.group.matrix, tmpL).elements.slice();
  }
  function dropMesh(e) {
    if (!e.mesh) return;
    e.mesh.parent && e.mesh.parent.remove(e.mesh);
    e.mesh.geometry.deleteAttribute("position"); // the position buffer is the body's, not ours: disposing a geometry that still holds it would free it
    e.mesh.geometry.dispose();
    e.mesh.material.dispose();
    e.mesh = null;
  }
  function teardown(id) {
    const e = ovs.get(id);
    if (!e) return;
    if (e.state === "working") stats.cancelled++;
    e.gen++; clearTimeout(e.timer); e.job = null;
    dropMesh(e);
    ovs.delete(id);
  }
  function teardownAll() { for (const id of [...ovs.keys()]) teardown(id); }

  function finish(e) {
    const r = e.job.result();
    e.job = null; e.state = "done"; e.count = r.count; e.area = r.area;
    const pos = e.view.mesh.geometry.getAttribute("position");
    if (!r.count || !pos) { dropMesh(e); return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", pos);
    geo.setIndex(new THREE.BufferAttribute(r.index, 1));
    if (e.mesh) {
      const old = e.mesh.geometry;
      e.mesh.geometry = geo;
      old.deleteAttribute("position"); old.dispose();
    } else {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      m.name = "overhang-overlay"; m.userData.overhang = true;
      m.renderOrder = 1; m.frustumCulled = false; m.raycast = () => {}; // never picked
      e.view.group.add(m);
      e.mesh = m;
    }
    e.mesh.position.copy(e.view.mesh.position); e.mesh.scale.copy(e.view.mesh.scale); e.mesh.quaternion.copy(e.view.mesh.quaternion);
    e.mesh.visible = true;
    vp.request();
  }
  function run(e) {
    const gen = ++e.gen, t0 = performance.now();
    const v = e.view, geo = v.mesh.geometry;
    e.job = startJob(geo.getAttribute("position").array, geo.getIndex().array, e.matrix, getPlatePref().angle);
    e.state = "working"; stats.jobs++; stats.lastTriangles = e.job.total;
    const tick = () => {
      if (e.gen !== gen || !e.job) return;
      const c0 = performance.now();
      const done = e.job.step(CHUNK_MS);
      const dt = performance.now() - c0;
      stats.chunks++; if (dt > stats.longestChunkMs) stats.longestChunkMs = dt;
      if (e.gen !== gen) return;
      if (done) {
        if (v.mesh && v.mesh.geometry === geo) { stats.lastMs = performance.now() - t0; finish(e); } else { e.state = "idle"; e.sig = null; }
        showChip();
      } else { showChip(); e.timer = setTimeout(tick, 0); }
    };
    e.timer = setTimeout(tick, 0);
  }

  // called after every scene refresh and when a mode that suspends the overlay starts or ends
  function update() {
    const pref = getPlatePref();
    if (!pref.shade) { if (ovs.size) teardownAll(); if (chip && !chip.hidden) showChip(); scheduleFit(); return; } // the common case: nothing to do
    if (suspended()) { if (ovs.size) teardownAll(); showChip(); scheduleFit(); return; }
    const live = new Set();
    for (const [id, v] of scene.views) {
      if (!eligible(id, v)) {
        const e = ovs.get(id);
        if (e && v.pending) { if (e.mesh) e.mesh.visible = false; live.add(id); } // rebuilding: the new mesh brings a new geometry, and then this one is dropped
        continue; // anything else that is not eligible (hidden, hole, ghost, no mesh) loses its overlay below
      }
      live.add(id);
      const geoId = v.mesh.geometry.uuid;
      let e = ovs.get(id);
      if (e && (e.view !== v || e.geoId !== geoId)) { teardown(id); e = null; }
      if (!e) { e = { id, view: v, geoId, sig: null, gen: 0, job: null, mesh: null, state: "idle", timer: 0, count: 0, area: 0 }; ovs.set(id, e); }
      e.matrix = worldOf(v);
      const sig = e.matrix.join(",") + "|" + pref.angle;
      e.tris = v.data.triangles.length / 3;
      if (e.sig === sig) { if (e.mesh) e.mesh.visible = e.state === "done"; continue; } // a camera move changes nothing here
      if (e.state === "working") stats.cancelled++;
      e.sig = sig; e.gen++; clearTimeout(e.timer); e.job = null;
      if (e.mesh) e.mesh.visible = false; // no stale result while a new one is pending
      if (e.tris > api.largeTriangles && !approved.has(geoId)) { e.state = "needs"; continue; }
      e.state = "waiting";
      e.timer = setTimeout(() => { if (ovs.get(id) === e && e.state === "waiting") run(e); }, START_DELAY);
    }
    for (const id of [...ovs.keys()]) if (!live.has(id) && !(scene.views.get(id) && scene.views.get(id).pending)) teardown(id);
    showChip();
    scheduleFit();
  }

  // ------------------------------------------------------------------ the legend in the view
  let chipAt = 0;
  function showChip() {
    const pref = getPlatePref();
    const on = pref.shade && !suspended();
    if (!on) { chip && (chip.hidden = true); return; }
    if (!chip) {
      chip = el("div", { class: "oh-chip", id: "overhang-chip", role: "status" });
      document.getElementById("viewport").append(chip);
    }
    const all = [...ovs.values()];
    const quick = all.some((e) => e.state === "working") && chip.dataset.state === "pending" && performance.now() - chipAt < 120;
    if (quick) return; // progress text changes every few ms; repaint it a few times a second
    chipAt = performance.now();
    chip.hidden = false;
    const needs = all.filter((e) => e.state === "needs");
    const busy = all.filter((e) => e.state === "waiting" || e.state === "working");
    const state = needs.length ? "needs" : busy.length ? "pending" : "done";
    chip.dataset.state = state;
    chip.dataset.triangles = String(all.reduce((s, e) => s + (e.state === "done" ? e.count : 0), 0));
    chip.textContent = "";
    chip.append(el("i", { class: "oh-sw", "aria-hidden": "true" }));
    if (state === "needs") {
      const e = needs[0];
      chip.append(el("span", {}, `${bodyName(e)} has ${e.tris.toLocaleString()} triangles. Overhang shading waits until you ask for it.`),
        el("button", { class: "btn", id: "overhang-analyse", onclick: () => { for (const n of needs) { approved.add(n.geoId); n.sig = null; } update(); } }, "Analyse this mesh"));
    } else if (state === "pending") {
      const total = busy.reduce((s, e) => s + (e.job ? e.job.total : e.tris), 0), did = busy.reduce((s, e) => s + (e.job ? e.job.processed : 0), 0);
      chip.append(el("span", {}, `Analysing overhangs… ${total ? Math.round((100 * did) / total) : 0}% of ${total.toLocaleString()} triangles`));
    } else {
      chip.append(el("span", {}, `Red: faces leaning out more than ${pref.angle}° from upright (steep undersides). This does not say that support is needed: bridges, other parts, layer settings and cooling are for your slicer.`));
    }
  }
  const bodyName = (e) => (e.view.body && e.view.body.name) || "A body";

  // ------------------------------------------------------------------ do the parts fit?
  // Each visible solid's real vertices in world space against X ±w/2, Y ±d/2, Z 0…height. Reads only.
  function fitReport() {
    const d = plateDims(getPlatePref().printer);
    if (!d) return { text: "No printer boundary is drawn.", out: [] };
    const out = [], tol = 0.01;
    let n = 0;
    for (const [id, v] of scene.views) {
      if (!v.data || !v.group.visible || !v.body || v.body.hole) continue;
      n++;
      const m = v.group.matrix.elements, P = v.data.vertices;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
      }
      const why = [];
      if (x0 < -d.w / 2 - tol || x1 > d.w / 2 + tol) why.push("X");
      if (y0 < -d.d / 2 - tol || y1 > d.d / 2 + tol) why.push("Y");
      if (z0 < -tol) why.push("below the plate");
      if (d.h != null && z1 > d.h + tol) why.push("Z");
      if (why.length) out.push(`${v.body.name || id} (${why.join(", ")})`);
    }
    if (!n) return { text: "Nothing in the design yet.", out };
    return { text: out.length ? `${out.length} of ${n} ${n === 1 ? "part reaches" : "parts; these reach"} outside this area: ${out.slice(0, 4).join(", ")}${out.length > 4 ? "…" : ""}. They were not moved.` : `All ${n} ${n === 1 ? "part is" : "parts are"} inside this area.`, out };
  }
  function scheduleFit() { if (dialog) { clearTimeout(fitTimer); fitTimer = setTimeout(paintInfo, 250); } }

  // ------------------------------------------------------------------ the dialog
  function evidenceNote(key) {
    const wrap = el("span", {});
    if (key === "generic") { wrap.append("The default plate the app has always drawn. Not tied to any printer."); return wrap; }
    if (key === "none") { wrap.append("No printer area is drawn."); return wrap; }
    const P = PRINTERS[key], ev = P.dimensionEvidence;
    if (ev.status === "vendor-verified") {
      wrap.append(`Build volume stated by the maker for ${ev.models.join(" / ")} (checked ${ev.checked}). `);
      ev.urls.forEach((u, i) => wrap.append(i ? ", " : "", el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, "source " + (i + 1))));
      if (ev.notVerified.length) wrap.append(` Not separately checked: ${ev.notVerified.join(", ")}.`);
    } else wrap.append("Size not yet checked against the maker's own page.");
    wrap.append(" Not tried on a real printer.");
    return wrap;
  }
  function paintInfo() {
    if (!dialog) return;
    const pref = getPlatePref(), d = plateDims(pref.printer);
    const set = (id, ...kids) => { const n = dialog.querySelector("#" + id); if (n) { n.textContent = ""; n.append(...kids); } };
    set("plate-dims", d ? `Width (X) ${d.w} mm × depth (Y) ${d.d} mm × height (Z) ${d.h == null ? "no limit set" : d.h + " mm"}` : "No boundary");
    set("plate-evidence", evidenceNote(pref.printer));
    set("plate-fit", fitReport().text);
    dialog.querySelector("#plate-dims").dataset.w = d ? d.w : "";
    dialog.querySelector("#plate-dims").dataset.d = d ? d.d : "";
    dialog.querySelector("#plate-dims").dataset.h = d && d.h != null ? d.h : "";
  }
  function close() { if (dialog) { dialog.remove(); dialog = null; clearTimeout(fitTimer); } }
  function open() {
    close();
    const pref = getPlatePref();
    const sel = el("select", { class: "num", id: "plate-select", "aria-label": "Printer plate" });
    const add = (parent, value, label) => parent.append(el("option", { value, selected: value === pref.printer }, label));
    add(sel, "generic", "Generic 256 × 256");
    const og = document.createElement("optgroup"); og.label = "Printers (size from the maker)";
    for (const k of PLATE_PRINTERS) { const d = plateDims(k); add(og, k, `${PRINTERS[k].plateLabel} (${d.w} × ${d.d} × ${d.h})`); }
    sel.append(og);
    add(sel, "none", "No printer boundary");
    if (!["generic", "none", ...PLATE_PRINTERS].includes(pref.printer) && PRINTERS[pref.printer]) { // picked in the print sim from a row nobody has checked yet
      const P = PRINTERS[pref.printer], og2 = document.createElement("optgroup"); og2.label = "From the print sim (size not yet checked)";
      add(og2, pref.printer, `${P.name} (${P.w} × ${P.d} × ${P.h})`); sel.append(og2);
    }
    sel.onchange = () => setPlatePref({ printer: sel.value });
    const chk = el("input", { type: "checkbox", id: "overhang-chk", checked: pref.shade, onchange: (e) => setPlatePref({ shade: e.target.checked }) });
    const out = el("b", { id: "overhang-angle-val" }, pref.angle + "°");
    let sliderT = 0;
    const rng = el("input", { type: "range", id: "overhang-angle", min: ANGLE_MIN, max: ANGLE_MAX, step: 1, value: pref.angle, "aria-label": "Maximum outward lean from upright",
      oninput: (e) => { out.textContent = e.target.value + "°"; clearTimeout(sliderT); const v = +e.target.value; sliderT = setTimeout(() => setPlatePref({ angle: v }), SLIDER_DELAY); } });
    const back = (dialog = el("div", { class: "modal-back", id: "plate-back" }));
    back.append(el("div", { class: "modal plate-dlg", id: "plate-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Printer plate" },
      el("header", {}, el("h2", {}, "Printer plate"), el("button", { class: "xbtn", id: "plate-x", "aria-label": "Close", onclick: close }, "×")),
      el("div", { class: "mbody" },
        el("label", { class: "plate-row", for: "plate-select" }, el("span", {}, "Plate"), sel),
        el("div", { class: "plate-facts", id: "plate-dims" }),
        el("div", { class: "hint plate-note", id: "plate-evidence" }),
        el("div", { class: "plate-fit", id: "plate-fit", role: "status" }),
        el("div", { class: "hint plate-note" }, "A viewing guide only. Choosing a plate never moves, turns, scales or rebuilds your parts. Printer keep-out zones, clips, brims and purge towers are for your slicer."),
        el("div", { class: "subhead" }, "Overhang shading"),
        el("label", { class: "check" }, chk, "Show steep undersides in red"),
        el("label", { class: "plate-row", for: "overhang-angle" }, el("span", {}, "Maximum outward lean from upright"), rng, out),
        el("div", { class: "hint plate-note" }, "Red faces lean out more than this, measured from straight up (the printer builds along Z). It marks steep undersides, not a promise that support is needed: bridges, support from another part, layer settings, material and cooling are for your slicer. The 3D Print Sim uses the same rule."),
        el("div", { class: "ci-acts", style: { display: "flex", justifyContent: "flex-end", marginTop: "12px" } }, el("button", { class: "btn primary", id: "plate-done", onclick: close }, "Done")))));
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.body.append(back);
    paintInfo();
    sel.focus();
  }

  // ------------------------------------------------------------------ wiring
  const menuBtn = document.getElementById("btn-plate");
  if (menuBtn) menuBtn.addEventListener("click", () => { const m = document.getElementById("menu-theme"); if (m) m.hidden = true; open(); });
  onPlatePref(() => { applyPlate(); update(); paintInfo(); });
  if (app.section && app.section.onChange) app.section.onChange(() => update());
  const pbtn = document.getElementById("nav-projector");
  if (pbtn) new MutationObserver(() => update()).observe(pbtn, { attributes: true, attributeFilter: ["aria-pressed"] });

  Object.assign(api, { update, open, close, pref: { get: getPlatePref, set: setPlatePref }, fitReport, entries: () => [...ovs.values()].map((e) => ({ id: e.id, state: e.state, count: e.count, area: e.area, visible: !!(e.mesh && e.mesh.visible) })) });
  return api;
}
