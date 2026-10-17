// Mesh detail (our addition): Normal / Fine / Extra fine, or a custom level up to 32×.
// The geometry worker divides its tessellation tolerances by `quality`; the kernel
// client sends it with every build and the scene folds it into the mesh cache key.
// This module owns the setting, the menu rows in index.html, the saved preference
// and the warning above 500,000 estimated triangles. Triangle counts on curved
// faces grow with the square of the level, which is what the estimate uses.
import { el } from "./util.js";

const PRESETS = { normal: { q: 1, label: "Normal" }, fine: { q: 2, label: "Fine" }, extra: { q: 4, label: "Extra fine" } };
const MAX = 32, WARN = 500000, KEY = "jumpstart.meshdetail";

export function initMeshDetail(app) {
  let reportTimer = 0, dialog = null, applyTimer = 0;
  const levelOf = (id) => {
    if (PRESETS[id]) return PRESETS[id].q;
    const m = /^custom:([\d.]+)$/.exec(id || "");
    return m ? Math.min(MAX, Math.max(1, Math.round((+m[1] || 1) * 2) / 2)) : 1;
  };
  const now = () => (app.kernel && app.kernel.quality) || 1;
  const triangles = () => {
    let n = 0;
    if (app.scene && app.scene.doc) for (const b of app.scene.doc.bodies) { const v = app.scene.views.get(b.id); if (v && v.data) n += v.data.triangles.length / 3; }
    return n;
  };
  const estimate = (q) => Math.round(triangles() * (q / now()) ** 2);
  const labelOf = (id) => (PRESETS[id] ? PRESETS[id].label : "Custom " + levelOf(id) + "×");

  function warn(est, q, go) {
    dialog && dialog.remove();
    const back = (dialog = el("div", { class: "modal-back" }));
    const close = () => { back.remove(); if (dialog === back) dialog = null; app.syncMeshDetailUI(); };
    back.append(el("div", { class: "modal chisel-intro", role: "alertdialog", "aria-modal": "true" },
      el("header", {}, el("h2", {}, "That's a lot of triangles")),
      el("div", { class: "mbody" },
        el("p", { class: "ci-lead" }, "About " + est.toLocaleString() + " triangles at " + q + "×."),
        el("p", {}, "Building could take several minutes, the view may get slow, and STL, OBJ and 3MF exports will be large. Your design itself is not changed, and you can pick a lower level at any time."),
        el("div", { class: "ci-acts", style: { gap: "8px" } },
          el("button", { class: "btn", onclick: close }, "Keep the current level"),
          el("button", { class: "btn primary", onclick: () => { close(); go(); } }, "Build it anyway")))));
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.body.append(back);
  }
  // once the rebuild settles, say how many triangles the design has now
  function report(label) {
    clearInterval(reportTimer);
    const t0 = Date.now();
    reportTimer = setInterval(() => {
      if (!app.scene || (app.scene.busy() && Date.now() - t0 < MAX * 30000)) return;
      clearInterval(reportTimer);
      const n = triangles();
      if (n) app.toast(label + ": " + n.toLocaleString() + " triangles in this design.");
      app.syncMeshDetailUI();
    }, 500);
  }

  app.setMeshDetail = function (id, quiet, force) {
    if (!id) { try { id = localStorage.getItem(KEY); } catch (e) {} }
    if (!PRESETS[id] && !/^custom:/.test(id || "")) id = "normal";
    const q = levelOf(id);
    if (!PRESETS[id]) id = "custom:" + q;
    if (!quiet && !force) {
      const est = estimate(q);
      if (est > WARN && q > now()) { warn(est, q, () => app.setMeshDetail(id, quiet, true)); return; }
    }
    app.meshDetail = id;
    const label = labelOf(id);
    if (app.kernel && (app.kernel.quality || 1) !== q) {
      app.kernel.quality = q;
      if (app.scene && app.scene.doc) { app.scene.sync(app.scene.doc); if (!quiet) report(label); }
    }
    app.syncMeshDetailUI();
    if (quiet) return;
    try { localStorage.setItem(KEY, id); } catch (e) {}
    app.toast(label + " mesh detail: " + (id === "normal" ? "the quickest to build." : id === "fine" ? "smoother curves in the view and in STL, OBJ and 3MF exports." : id === "extra" ? "the smoothest preset; big or detailed designs take longer to build." : "building… the finished triangle count will show when it's done."));
  };

  // the Custom slider and the triangle-count box in the theme menu
  const range = document.getElementById("detail-range"), tris = document.getElementById("detail-tris");
  const level = document.getElementById("detail-level"), est = document.getElementById("detail-est");
  const show = (q) => {
    level.textContent = q + "×";
    const n = triangles();
    tris.value = n ? estimate(q) : "";
    tris.disabled = !n;
    est.textContent = n ? (app.scene.busy() ? "building…" : q === now() ? "now" : "estimate") : "add a shape first";
  };
  range.oninput = () => show(+range.value);
  range.onchange = () => { clearTimeout(applyTimer); applyTimer = setTimeout(() => app.setMeshDetail("custom:" + +range.value), 400); };
  tris.onchange = () => {
    const n = triangles(), want = +tris.value;
    if (!n || !(want > 0)) return show(+range.value);
    const q = Math.min(MAX, Math.max(1, Math.round(now() * Math.sqrt(want / n) * 2) / 2));
    range.value = q;
    app.setMeshDetail("custom:" + q);
  };
  app.syncMeshDetailUI = () => {
    const id = app.meshDetail || "normal", q = levelOf(id);
    document.querySelectorAll("#menu-theme button[data-detail]").forEach((b) => b.setAttribute("aria-checked", b.dataset.detail === id));
    range.value = q;
    show(q);
  };
  app.setMeshDetail(null, true);
}
