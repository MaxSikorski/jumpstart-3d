// jumpstart-3d: import units. A closed mesh whose units are not in doubt (3MF, OBJ, STL of a normal size) comes in at once, without the
// "Import STL/3MF/OBJ" dialog. This file decides that, and shows the note that follows: the file name, the size, what was repaired, and three
// small buttons (mm, cm, in) that read the file's numbers as another unit. The buttons rescale the body as ONE undo step; the body stays
// centred and resting on the plate by itself (the kernel centres every imported mesh on the origin). The dialog stays for an open mesh,
// shared edges (non-manifold) and an STL under 6 mm, where there is a real choice. Each import has its own note; they stack.
import { el } from "./util.js";
import { store, findBody } from "./store.js";
import { getUnit, showLen } from "./units.js";
import { meshBounds } from "./meshimport.js";

const SHOW_MS = 10000;
const UNITS = ["mm", "cm", "in"];
const MM_PER = { mm: 1, cm: 10, in: 25.4 }; // the dialog's k values
const FILE_UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 }; // 3MF unit names
const TITLES = { mm: "Millimetres", cm: "Centimetres", in: "Inches" };

const CSS = `
.toast.imp-toast { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; }
.imp-toast .imp-units { display: flex; align-items: center; gap: 4px; font-size: 11.5px; }
.imp-toast .imp-units > span { opacity: .8; margin-right: 2px; }
.imp-toast button { font: inherit; font-size: 11.5px; min-width: 38px; min-height: 26px; padding: 2px 8px; border-radius: 5px; cursor: pointer; border: 1px solid currentColor; background: transparent; color: inherit; }
.imp-toast button[aria-pressed="true"] { background: var(--block-ink, #fff); color: var(--block, #18202a); border-color: var(--block-ink, #fff); font-weight: 600; }
@media (pointer: coarse) { .imp-toast button { min-height: 34px; min-width: 46px; } }
`;

// true when the mesh needs no question: closed, no shared edges, and the units are known (3MF) or plausible (STL of 6 mm or more)
export function importsAtOnce(mesh, info) {
  const rep = info.report || {};
  if (rep.open || rep.nonManifold) return false;
  if (info.format === "STL" && !info.unitFromFile && Math.max(...meshBounds(mesh).size) < 6) return false;
  return true;
}

function repairs(rep) {
  const n = (v) => v.toLocaleString();
  const out = [];
  if (rep.flipped) out.push(`${n(rep.flipped)} inside-out triangle${rep.flipped > 1 ? "s" : ""} turned`);
  if (rep.dupes) out.push(`${n(rep.dupes)} duplicate${rep.dupes > 1 ? "s" : ""} removed`);
  if (rep.degenerate) out.push(`${n(rep.degenerate)} squashed triangle${rep.degenerate > 1 ? "s" : ""} removed`);
  if (rep.filled) out.push(`${n(rep.filled)} small hole${rep.filled > 1 ? "s" : ""} closed`);
  return out;
}

// bodyId: the body addImported just made (k 1: the mesh is in mm, 3MF numbers already turned into mm).
export function showImportToast({ bodyId, fileName, mesh, ntOrig, info }) {
  const body0 = findBody(store.doc, bodyId);
  if (!body0 || body0.node.t !== "mesh") return;
  const asset = body0.node.asset;
  const fileMM = info.unitFromFile ? FILE_UNIT_MM[info.unitFromFile] || 1 : 1; // mm per unit the file's numbers are in
  const size = meshBounds(mesh).size;
  const nt = mesh.I.length / 3;
  const extras = [];
  const fixed = repairs(info.report || {});
  if (fixed.length) extras.push("repaired: " + fixed.join(", "));
  if (ntOrig > nt) extras.push(`simplified from ${ntOrig.toLocaleString()} triangles`);
  if (info.parts > 1) extras.push(`${info.parts} parts`);

  if (!document.getElementById("imp-toast-css")) {
    const style = el("style", { id: "imp-toast-css" });
    style.textContent = CSS;
    document.head.append(style);
  }
  const text = el("div", { class: "imp-toast-text" });
  const buttons = UNITS.map((u) => el("button", { type: "button", "data-unit": u, title: `The file's numbers are ${TITLES[u].toLowerCase()}. Click if the size looks wrong.`, onclick: () => choose(u) }, u));
  const toast = el("div", { class: "toast imp-toast" }, text, el("div", { class: "imp-units", role: "group", "aria-label": "File units" }, el("span", {}, "File units"), ...buttons));
  let timer = 0, off = null;

  const bodyNow = () => { const b = findBody(store.doc, bodyId); return b && b.node.t === "mesh" && b.node.asset === asset ? b : null; };
  const kNow = () => (bodyNow().node.k || 1);
  function close() { clearTimeout(timer); if (off) off(); toast.remove(); }
  function arm() { clearTimeout(timer); timer = setTimeout(close, SHOW_MS); }
  function refresh() {
    if (!bodyNow()) { close(); return; } // undone, deleted or merged into something else: the buttons no longer have a body
    const k = kNow();
    text.textContent = `Imported ${fileName}: ${size.map((v) => showLen(v * k, 1)).join(" × ")} ${getUnit()}` + (extras.length ? " · " + extras.join(" · ") : "");
    for (const b of buttons) b.setAttribute("aria-pressed", String(Math.abs(MM_PER[b.dataset.unit] / fileMM - k) < 1e-9));
  }
  function choose(u) {
    const k = MM_PER[u] / fileMM;
    store.update((doc) => {
      const b = findBody(doc, bodyId);
      if (!b || b.node.t !== "mesh" || b.node.asset !== asset || Math.abs((b.node.k || 1) - k) < 1e-9) return false;
      if (Math.abs(k - 1) < 1e-9) delete b.node.k; else b.node.k = k;
    }, "File units: " + u);
    refresh();
    arm();
  }
  off = store.on((kind) => { if (kind === "load") close(); else refresh(); });
  refresh();
  document.getElementById("toasts").append(toast);
  arm();
}
