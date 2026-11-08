// Arrange projected body views and offer them as a DXF drawing.
import { writeDXF } from "./dxf.js";
import { el } from "./util.js";
import { cleanCurves } from "./drawingprojection.js";
import { runDrawingJob } from "./drawingclient.js";

const names = ["top", "front", "right"];
const scaled = (c, k) => {
  const p = (v) => v.map((n) => n * k);
  if (c.t === "line") return { ...c, a: p(c.a), b: p(c.b) };
  if (c.t === "poly") return { ...c, pts: c.pts.map(p) };
  return { ...c, c: p(c.c), r: c.r * k };
};
// curvesBox in dxf.js bounds an arc as its whole circle; sizes here need the arc's own extent
function viewBox(curves) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  const at = (c, a) => [c.c[0] + c.r * Math.cos(a), c.c[1] + c.r * Math.sin(a)];
  for (const c of curves) {
    if (c.t === "line") { add(c.a); add(c.b); }
    else if (c.t === "circle") { add([c.c[0] - c.r, c.c[1] - c.r]); add([c.c[0] + c.r, c.c[1] + c.r]); }
    else if (c.t === "arc") {
      const sweep = ((c.a1 - c.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      add(at(c, c.a0)); add(at(c, c.a1));
      for (let q = 0; q < 4; q++) { const a = (q * Math.PI) / 2, d = ((a - c.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (d <= sweep) add(at(c, a)); }
    } else if (c.pts) for (const p of c.pts) add(p);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
const trimmed = (n, places) => n.toFixed(places).replace(/\.?0+$/, "");
function label(mm, units) {
  if (units !== "in") return trimmed(mm, 2);
  const v = mm / 25.4, sixteenths = Math.round(v * 16);
  if (Math.abs(v - sixteenths / 16) <= 0.002) {
    const whole = Math.floor(sixteenths / 16), rem = sixteenths % 16;
    if (!rem) return whole + '"';
    let a = rem, b = 16; while (b) [a, b] = [b, a % b];
    return (whole ? whole + " " : "") + rem / a + "/" + 16 / a + '"';
  }
  return trimmed(v, 3) + '"';
}

export function drawingDXF(viewCurves, { scale = 1, dims = false, units = "mm" } = {}) {
  const k = scale * (units === "in" ? 1 / 25.4 : 1), boxes = {}, sheets = [];
  for (const n of names) {
    const curves = (viewCurves[n] || []).map((c) => scaled(c, k)), box = viewBox(curves);
    if (box) boxes[n] = { curves, box };
  }
  const all = Object.values(boxes), factor = units === "in" ? 1 / 25.4 : 1;
  const h = 2.5 * factor, base = Math.max(10 * factor, ...all.map(({ box: b }) => 0.15 * Math.max(b.x1 - b.x0, b.y1 - b.y0)));
  const off = Math.max(base / 3, 2 * h), gap = dims ? base + 4 * h : base; // room for a size line and its label between views
  const front = boxes.front?.box, top = boxes.top?.box, right = boxes.right?.box;
  const dx = -(front || top || right || { x0: 0 }).x0;
  const dy = -(front || right || top || { y0: 0 }).y0;
  for (const n of names) {
    const item = boxes[n]; if (!item) continue;
    let x = dx, y = dy;
    if (n === "top" && (front || right)) y = Math.max(...[front, right].filter(Boolean).map((b) => b.y1 + dy)) + gap - item.box.y0;
    if (n === "right" && (front || top)) x = Math.max(...[front, top].filter(Boolean).map((b) => b.x1 + dx)) + gap - item.box.x0;
    item.dx = x; item.dy = y;
    sheets.push({ name: n.toUpperCase(), curves: item.curves, dx: x, dy: y });
  }
  if (dims) {
    const curves = [], arrow = 1.5 * factor;
    const line = (a, b) => curves.push({ t: "line", a, b });
    // an open arrowhead of two strokes, tip at p, pointing along (ux, uy)
    const head = (p, ux, uy) => { for (const s of [1, -1]) line(p, [p[0] - arrow * ux + s * arrow * 0.35 * uy, p[1] - arrow * uy - s * arrow * 0.35 * ux]); };
    for (const n of names) {
      const item = boxes[n]; if (!item) continue;
      const b = item.box, x0 = b.x0 + item.dx, x1 = b.x1 + item.dx, y0 = b.y0 + item.dy, y1 = b.y1 + item.dy;
      const width = () => {
        const y = y0 - off;
        line([x0, y0], [x0, y - arrow]); line([x1, y0], [x1, y - arrow]); line([x0, y], [x1, y]);
        head([x0, y], -1, 0); head([x1, y], 1, 0);
        curves.push({ t: "text", p: [(x0 + x1) / 2, y - 1.5 * h], h, s: label((b.x1 - b.x0) / k, units), center: true });
      };
      const height = () => {
        const x = x0 - off;
        line([x0, y0], [x - arrow, y0]); line([x0, y1], [x - arrow, y1]); line([x, y0], [x, y1]);
        head([x, y0], 0, -1); head([x, y1], 0, 1);
        // turned 90 degrees, reading upwards, just left of its size line
        curves.push({ t: "text", p: [x - 0.5 * h, (y0 + y1) / 2], h, rot: 90, s: label((b.y1 - b.y0) / k, units), center: true });
      };
      // Dimension each available view so incomplete view selections remain useful.
      width(); height();
    }
    if (curves.length) sheets.push({ name: "DIMENSIONS", curves, dx: 0, dy: 0 });
  }
  return writeDXF(sheets, { units });
}

function hasMesh(root) {
  const seen = new Set(), stack = [root];
  while (stack.length) {
    const v = stack.pop(); if (!v || typeof v !== "object" || seen.has(v)) continue;
    if (v.t === "mesh") return true;
    seen.add(v); stack.push(...Object.values(v));
  }
  return false;
}

// jumpstart-3d: share the drawing work between the dialog and JS3D.drawing.
async function drawingPreflight(bodies) {
  const { resolveNode, store } = await import("./store.js");
  const list = bodies.map((b) => ({ id: b.id, node: resolveNode(b.node, store.doc), m: b.m }));
  const mesh = bodies.filter((b, i) => hasMesh(list[i].node)); // resolved, so a mirror of an imported mesh counts too
  if (mesh.length) throw Object.assign(new Error(`Drawings need CAD bodies: ${mesh.map((b) => b.name).join(", ")} came from a mesh (STL/3MF/OBJ). Leave them out of the selection, or use Mesh to STEP first.`), { kind: "mesh" });
  return list;
}
export async function drawBodies(app, bodies, { views, scale, dims, units }, hooks = {}) {
  const list = await drawingPreflight(bodies);
  const fonts = app.kernel.waitFor && list.map((b) => app.kernel.waitFor(b)).find(Boolean);
  if (fonts) { hooks.onFonts?.(); await Promise.resolve(fonts).catch(() => {}); }
  if (hooks.stop?.()) throw Object.assign(new Error("Cancelled."), { kind: "cancelled" });
  hooks.onStart?.();
  const job = runDrawingJob(app.kernel, { bodies: list, views }, hooks.onView);
  hooks.onJob?.(job);
  const data = await job.done;
  if (hooks.stop?.()) throw Object.assign(new Error("Cancelled."), { kind: "cancelled" });
  for (const v of views) data.views[v] = cleanCurves(data.views[v] || []);
  if (!Object.values(data.views || {}).some((v) => v.length)) throw Object.assign(new Error("Nothing to draw."), { kind: "empty" });
  return { text: drawingDXF(data.views, { scale, dims, units }), skipped: data.skipped || [] };
}

export function openBodyDrawing(app, { bodies, name }) {
  if (document.getElementById("body-drawing")) return;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem("jumpstart.bodyDrawing") || "{}") || {}; } catch (e) {}
  const opener = document.activeElement;
  const back = el("div", { class: "modal-back" });
  let closed = false, job = null;
  const close = () => { closed = true; if (job) job.cancel(); back.remove(); opener?.focus(); };
  const check = (id, value) => el("input", { id: "bd-" + id, type: "checkbox", checked: value });
  const checks = Object.fromEntries(names.map((n) => [n, check(n, saved[n] !== false)]));
  const dims = check("dims", saved.dims === true);
  const select = (id, choices, value) => {
    const e = el("select", { id: "bd-" + id }, choices.map(([v, text]) => el("option", { value: v }, text)));
    e.value = choices.some(([v]) => v === value) ? value : choices[0][0]; return e;
  };
  const scale = select("scale", [["1", "1:1"], ["0.5", "1:2"], ["0.2", "1:5"], ["0.1", "1:10"], ["2", "2:1"]], saved.scale);
  const units = select("units", [["mm", "Millimetres"], ["in", "Inches"]], saved.units);
  const state = el("div", { role: "status", class: "hint", style: { padding: "0", marginTop: "8px" } });
  const cancel = el("button", { id: "bd-cancel", type: "button", onclick: close }, "Cancel");
  const submit = el("button", { id: "bd-export", type: "button" }, "Export");
  const field = (text, control) => el("label", { style: { display: "block", marginTop: "10px" } }, text, " ", control);
  const modal = el("div", { id: "body-drawing", class: "modal", role: "dialog", "aria-label": "Bodies as DXF drawing", style: { width: "min(480px, 100%)" } },
    el("header", {}, el("h2", {}, "Bodies as DXF drawing")),
    el("div", { class: "mbody" }, el("p", {}, bodies.length === 1 ? bodies[0].name : `${bodies.length} bodies`),
      el("div", {}, "Views: ", names.map((n) => el("label", { style: { marginRight: "12px" } }, checks[n], " " + n[0].toUpperCase() + n.slice(1)))),
      field("Scale:", scale), el("div", { class: "hint", style: { padding: 0 } }, "1:2 makes a 100 mm part 50 mm in the file"),
      field("Units:", units), field("Overall sizes", dims),
      el("p", { class: "hint", style: { padding: 0 } }, "Visible edges only, flat at full size. Laser and CNC tools: use one view at 1:1 without sizes."),
      el("div", { style: { display: "flex", gap: "8px" } }, submit, cancel), state));
  back.append(modal); document.body.append(back);
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const all = [...modal.querySelectorAll("input, select, button")].filter((x) => !x.disabled);
    const i = all.indexOf(document.activeElement), next = all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length];
    if (next) { e.preventDefault(); next.focus(); }
  });
  let busy = false;
  submit.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try { await exportNow(); } finally { busy = false; }
  });
  async function exportNow() {
    const views = names.filter((n) => checks[n].checked);
    if (!views.length) { app.toast("Choose at least one view.", "err"); return; }
    const options = { scale: +scale.value, dims: dims.checked, units: units.value };
    try { await drawingPreflight(bodies); } catch (e) { app.toast(e.message, "err"); return; }
    try { localStorage.setItem("jumpstart.bodyDrawing", JSON.stringify({ ...Object.fromEntries(names.map((n) => [n, checks[n].checked])), ...options, scale: scale.value })); } catch (e) {}
    submit.disabled = true; state.textContent = "Preparing the views…";
    try {
      // jumpstart-3d: the dialog keeps its progress and cancellation UI.
      const { text, skipped } = await drawBodies(app, bodies, { views, ...options }, {
        onFonts: () => { state.textContent = "Loading fonts…"; },
        onStart: () => { state.textContent = "Starting the geometry engine…"; },
        onView: (v, i, n) => { state.textContent = `Preparing ${v[0].toUpperCase() + v.slice(1)}, ${i + 1} of ${n}…`; },
        onJob: (j) => { job = j; }, stop: () => closed,
      });
      if (skipped.length) app.toast("Left out bodies: " + skipped.map((id) => bodies.find((b) => b.id === id)?.name || id).join(", ") + ".", "err");
      if (!(await app.projects.saveModel(name + " drawing.dxf", new TextEncoder().encode(text)))) return;
      app.toast(`Saved the drawing (${views.map((n) => n[0].toUpperCase() + n.slice(1)).join(", ")}) in ${units.value === "in" ? "inches" : "millimetres"}.`);
      close();
    } catch (e) { if (closed) return; app.toast(e.kind === "mesh" || e.kind === "empty" ? e.message : "DXF drawing failed: " + (e.message || String(e)), "err"); }
    finally { job = null; submit.disabled = false; state.textContent = ""; }
  }
  submit.focus();
}
