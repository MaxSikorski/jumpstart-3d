// jumpstart-3d: perf panel. A hidden panel for debugging a slow design: how long the last rebuild took, body by body, slowest first.
// Open it with Ctrl+Alt+P, the address ?perf, or app.perf.open() in the console. Nothing is measured and nothing is drawn until the panel has been opened once.
// Time is measured on the main thread around each batch the kernel client sends to the geometry worker and shared evenly among the bodies of that batch (marked ~). Per-feature times need a worker change: wrap each applyMod() in evalNode() (src/kernel.js) with performance.now().
import { store, timeline } from "./store.js";

const CSS = `
#perfpanel { position: fixed; top: 64px; right: 12px; z-index: 70; width: min(560px, calc(100vw - 24px)); max-height: 60vh; display: flex; flex-direction: column; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 24px var(--shadow); font: 12px/1.4 system-ui, sans-serif; }
#perfpanel header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line-2); }
#perfpanel h2 { flex: 1; margin: 0; font-size: 13px; }
#perfpanel button { font: inherit; padding: 3px 9px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel-2); color: var(--ink); cursor: pointer; }
#perfpanel .pp-sum { padding: 6px 10px; color: var(--ink-2); }
#perfpanel .pp-scroll { overflow: auto; padding: 0 10px 10px; }
#perfpanel table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
#perfpanel th, #perfpanel td { padding: 3px 6px; text-align: left; border-bottom: 1px solid var(--line-2); vertical-align: top; }
#perfpanel th.n, #perfpanel td.n { text-align: right; white-space: nowrap; }
#perfpanel tr.err td { color: var(--danger); }
`;

export function initPerfPanel(app) {
  let rec = null; // the recorder, made the first time the panel opens
  let panel = null;

  function makeRecorder() {
    const k = app.kernel;
    let open = null, cur = null; // the rebuild being timed, and the batch in flight
    // This runs inside the kernel client's message handler: a mistake here must never stop the build queue.
    const safe = (f) => (...a) => { try { f(...a); } catch (e) { console.warn("perf panel:", e); } };
    const r = {
      last: null,
      start: safe(() => {
        if (!open) open = { t0: performance.now(), batches: 0, rows: [] };
        cur = { n: ++open.batches, t: performance.now() };
      }),
      done: safe((results) => {
        if (!cur) return;
        const per = (performance.now() - cur.t) / (results.length || 1);
        for (const x of results) open.rows.push({ id: x.id, batch: cur.n, ms: per, tris: x.ok !== false && x.mesh ? x.mesh.triangles.length / 3 : 0, error: x.ok === false ? x.error : null });
        cur = null;
        r.finish();
      }),
      // A stalled batch of several bodies is retried one by one, so its time is dropped; a body that stalls alone is final and gets an error row.
      abort: safe((batch) => {
        if (cur && batch.length === 1) open.rows.push({ id: batch[0].id, batch: cur.n, ms: performance.now() - cur.t, tris: 0, error: `stalled after ${Math.round(performance.now() - cur.t)} ms` });
        cur = null;
        setTimeout(r.finish, 0); // the client has settled its queue by the next turn
      }),
      finish: safe(() => {
        if (!open || cur || k.inflight || k.queue.size) return;
        if (open.rows.length) {
          const feats = new Map();
          for (const t of timeline(store.view)) if (t.body) feats.set(t.body, [...(feats.get(t.body) || []), t.label]);
          const names = new Map(store.view.bodies.map((b) => [b.id, b.name]));
          for (const row of open.rows) { row.name = names.get(row.id) || "(removed body)"; row.features = (feats.get(row.id) || []).join(", "); }
          open.rows.sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name));
          r.last = { rows: open.rows, batches: open.batches, wall: performance.now() - open.t0 };
        }
        open = null;
        render();
      }),
    };
    return r;
  }

  const fmt = (n) => n.toFixed(1);
  function text() {
    const l = rec && rec.last;
    if (!l) return "JumpStart 3D rebuild times: no rebuild recorded yet.";
    const total = l.rows.reduce((s, x) => s + x.ms, 0);
    const out = [`JumpStart 3D rebuild times (slowest first)`, `Total ${fmt(total)} ms in ${l.batches} batch${l.batches === 1 ? "" : "es"} for ${l.rows.length} bod${l.rows.length === 1 ? "y" : "ies"} (${fmt(l.wall)} ms on the clock)`, `ms | batch | triangles | body | features`];
    for (const x of l.rows) out.push(`~${fmt(x.ms)} | ${x.batch} | ${x.error ? "error: " + x.error : x.tris} | ${x.name} | ${x.features}`);
    return out.join("\n");
  }

  function render(note) {
    if (!panel) return;
    const l = rec.last;
    panel.sum.textContent = note || (l ? text().split("\n")[1] : "No rebuild recorded yet. Press Rebuild all to time every body.");
    panel.body.replaceChildren();
    if (!l) return;
    const t = document.createElement("table");
    t.innerHTML = "<thead><tr><th class='n'>ms</th><th class='n'>Batch</th><th class='n'>Triangles</th><th>Body</th><th>Features</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const x of l.rows) {
      const tr = document.createElement("tr");
      if (x.error) tr.className = "err";
      for (const [v, cls] of [["~" + fmt(x.ms), "n"], [x.batch, "n"], [x.error ? "error: " + x.error : x.tris, x.error ? "" : "n"], [x.name, ""], [x.features, ""]]) {
        const td = document.createElement("td");
        td.textContent = v; td.className = cls;
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(tb);
    panel.body.append(t);
  }

  function copy() {
    const s = text();
    const fallback = () => { const ta = document.createElement("textarea"); ta.value = s; document.body.append(ta); ta.select(); try { document.execCommand("copy"); } catch (e) { /* the text is also in app.perf.text() */ } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(fallback); else fallback();
    app.toast && app.toast("Copied the rebuild times");
  }

  function rebuildAll() {
    const k = app.kernel;
    if (!k.ready || !app.scene.doc) { render("The geometry engine is not ready yet."); return; }
    panel.sum.textContent = "Rebuilding…";
    k.worker.postMessage({ type: "clear" }); // the worker keeps finished shapes; without this a repeat build would take no time
    k.meshes.clear();
    app.scene.sync(app.scene.doc);
    if (!k.inflight && !k.queue.size) render("Nothing to rebuild: no shape needs building."); // an empty design, or every shape already marked as stalled
  }

  function open() {
    if (panel) return;
    if (!rec) { rec = makeRecorder(); app.kernel.perf = rec; }
    const style = document.createElement("style");
    style.textContent = CSS;
    const el = document.createElement("div");
    el.id = "perfpanel"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Rebuild times");
    el.innerHTML = "<header><h2>Rebuild times</h2><button data-pp='copy'>Copy</button><button data-pp='rebuild'>Rebuild all</button><button data-pp='close'>Close</button></header><div class='pp-sum'></div><div class='pp-scroll'></div>";
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-pp]");
      if (b) ({ copy, rebuild: rebuildAll, close })[b.dataset.pp]();
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.head.append(style); document.body.append(el);
    panel = { el, style, sum: el.querySelector(".pp-sum"), body: el.querySelector(".pp-scroll") };
    render();
  }
  function close() {
    if (!panel) return;
    panel.el.remove(); panel.style.remove(); panel = null;
  }

  app.perf = { open, close, toggle: () => (panel ? close() : open()), text, get last() { return rec && rec.last; } };
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyP") { e.preventDefault(); app.perf.toggle(); }
  });
  if (new URLSearchParams(location.search).has("perf")) open();
}
