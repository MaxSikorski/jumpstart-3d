// Import-session UI. Elapsed time is separate from polite stage announcements.
export const stageOrder = { waiting: 0, reading: 0, building: 1, meshing: 2, sending: 3 };
export function stageText(stage, name, detail) {
  if (stage === "parts")
    return `Making the parts… · ${name}`;
  if (stage === "reading")
    return `Reading ${name}…`;
  if (stage === "building")
    return `${detail === "repairing" ? "Repairing" : "Building"} the solid… · ${name}`;
  if (stage === "meshing")
    return `Making the mesh… · ${name}`;
  if (stage === "sending")
    return `Showing the model… · ${name}`;
  return `Waiting for the geometry engine… · ${name}`;
}
export function stageName(stage) {
  return ({ reading: "Reading the file", building: "Building the solid", repairing: "Repairing the solid", meshing: "Making the mesh", sending: "Showing the model", parts: "Making the parts" })[stage] || "Waiting for the geometry engine";
}
export function formatLimit(ms) {
  return ms % 60000 === 0 ? `${ms / 60000} minutes` : `${ms / 1000} seconds`;
}
export function stepStallMessage(name, result, fallbackStage) {
  return `Couldn't import ${name}: building it took longer than ${formatLimit(result.limitMs)}, so it was stopped. Last stage: ${stageName(result.stage || fallbackStage)}.`;
}
export function currentImportView(app, body) {
  const v = body && app.scene.views.get(body.id);
  return v && v.data && !v.pending && v.key === body._key && app.kernel.get(body._key)?.ok ? v : null;
}
export function initStepProgress(app) {
  const panel = document.createElement("div");
  panel.id = "step-progress";
  panel.hidden = true;
  const style = document.createElement("style");
  style.id = "step-progress-style";
  style.textContent = `#step-progress{position:absolute;left:12px;bottom:12px;z-index:8;width:min(420px, calc(100% - 24px));max-height:40%;overflow:auto;box-sizing:border-box;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px;overflow-wrap:anywhere}#step-progress[hidden]{display:none}#step-progress progress{width:100%;accent-color:var(--accent)}#step-progress small{display:block;color:var(--ink-2)}#step-progress>div+div{border-top:1px solid var(--line);margin-top:10px;padding-top:10px}`;
  document.head.append(style);
  document.getElementById("viewport").append(panel);
  let serial = 0;
  const sessions = new Map();
  function position() {
    const viewport = panel.parentElement.getBoundingClientRect();
    let bottom = 12;
    for (const obstacle of document.querySelectorAll(".timeline, .panel-tab.bottom")) {
      const rect = obstacle.getBoundingClientRect();
      if (rect.width && rect.height && rect.bottom > viewport.top && rect.top < viewport.bottom)
        bottom = Math.max(bottom, viewport.bottom - rect.top + 12);
    }
    panel.style.bottom = `${bottom}px`;
  }
  function render(s) {
    position();
    const label = stageText(s.stage, s.fileName, s.detail);
    if (s.label.textContent !== label)
      s.label.textContent = label;
    s.elapsed.textContent = ` · ${Math.floor((performance.now() - s.start) / 1000)} s`;
    s.row.dataset.stage = s.stage;
    const parts = s.stage === "parts";
    s.bar.max = parts ? s.ids.length : 4;
    s.bar.value = parts ? s.ready || 0 : stageOrder[s.stage];
    s.count.textContent = parts ? `${s.ready || 0} of ${s.ids.length} parts ready` : `${s.bar.value} of 4 stages complete`;
    s.hint.textContent = (app.kernel?.quality || 1) > 1 ? "For faster loading, choose Normal mesh detail." : "";
  }
  function finish(s) {
    if (!s || !sessions.delete(s.token))
      return;
    if (s.frame)
      cancelAnimationFrame(s.frame);
    clearInterval(s.tick);
    clearInterval(s.watch);
    s.row.remove();
    panel.hidden = !sessions.size;
    app.status?.();
  }
  const api = {
    sessions,
    start(fileName) {
      const token = String(++serial), row = document.createElement("div");
      row.id = `step-progress-${token}`;
      row.dataset.session = token;
      row.setAttribute("aria-busy", "true");
      const text = document.createElement("div");
      text.id = `step-progress-text-${token}`;
      const label = document.createElement("span");
      label.setAttribute("aria-live", "polite");
      const elapsed = document.createElement("span");
      text.append(label, elapsed);
      const bar = document.createElement("progress");
      bar.id = `step-progress-bar-${token}`;
      bar.setAttribute("aria-label", "STEP import stages");
      const count = document.createElement("small");
      count.id = `step-progress-count-${token}`;
      const hint = document.createElement("small");
      row.append(text, bar, count, hint);
      panel.append(row);
      panel.hidden = false;
      const s = { token, fileName, start: performance.now(), stage: "waiting", ids: [], row, label, elapsed, bar, count, hint };
      sessions.set(token, s);
      render(s);
      s.tick = setInterval(() => render(s), 250);
      return s;
    },
    attach(s, ids, asset, checkImport) {
      Object.assign(s, { ids, asset, checkImport });
      s.watch = setInterval(checkImport, 500);
      checkImport();
    },
    parts(s, ids) {
      s.ids = ids;
      s.stage = "parts";
      s.ready = 0;
      render(s);
    },
    progress(event) {
      for (const s of sessions.values())
        if (s.asset === event.asset && s.ids.includes(event.id)) {
          s.lastStage = event.detail === "repairing" ? "repairing" : event.stage;
          if (s.stage !== "parts" && stageOrder[event.stage] >= stageOrder[s.stage]) {
            s.stage = event.stage;
            s.detail = event.detail;
            render(s);
          }
        }
    },
    reconcile() {
      for (const s of [...sessions.values()])
        if (!s.handoff)
          s.checkImport?.();
    },
    represented() {
      return [...sessions.values()].some(s => app.kernel?.inflight?.some(b => s.ids.includes(b.id)));
    },
    update: render,
    finish,
    clear() {
      for (const s of [...sessions.values()])
        finish(s);
    },
  };
  return api;
}
