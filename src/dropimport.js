// jumpstart-3d: drop import. Drop a model file anywhere on the page and it imports like the Import button does.
// While a drag that carries files is over the page, a full-page "Drop to import" note shows. Drags without files (text, links,
// the app's own shape drags) are ignored. The opening itself is app.advanced.openModelFile, the same function the Import
// button's picker uses; this file only catches the drop, checks that importing makes sense right now, and feeds the files in order.
import { el } from "./util.js";

const CSS = `
.drop-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: var(--scrim, rgba(18,24,32,.42)); pointer-events: none; }
.drop-overlay[hidden] { display: none; }
.drop-overlay .drop-card { box-sizing: border-box; max-width: min(520px, 100%); padding: 28px 36px; text-align: center; border: 3px dashed var(--accent, #1f4fa8); border-radius: 16px; background: var(--panel, #fff); color: var(--ink, #18202a); box-shadow: 0 12px 40px var(--shadow, rgba(20,30,45,.2)); }
.drop-overlay .drop-card b { display: block; font-size: 22px; }
.drop-overlay .drop-card span { display: block; margin-top: 6px; font-size: 14px; color: var(--ink-2, #44505c); }
.drop-overlay.no .drop-card { border-style: solid; border-color: var(--danger, #b3261e); }
`;

const WORDS = "STL, 3MF, OBJ, STEP, SVG or DXF";
const DROPPABLE = new Set(["model", "svg", "dxf"]); // fileKind() values a drop opens; pictures (kind "image") are for the Insert menu, not the drop
const STALE_MS = 3000; // a drag over the page fires dragover every fraction of a second; silence this long means the drag ended without a dragleave

export function initDropImport(app) {
  const style = document.createElement("style");
  style.id = "drop-css";
  style.textContent = CSS;
  document.head.append(style);
  const title = el("b", {}, "Drop to import");
  const sub = el("span", {}, WORDS);
  const overlay = el("div", { id: "drop-overlay", class: "drop-overlay", role: "status", hidden: true }, el("div", { class: "drop-card" }, title, sub));
  document.body.append(overlay);

  let depth = 0; // dragenter minus dragleave; an element removed mid-drag never fires its dragleave, so it is a hint, not the truth
  let stale = 0;
  let busy = false; // files from an earlier drop are still being opened

  // "" when a model can be imported right now, otherwise the plain sentence that says what to do first
  function reason() {
    if (app.mode !== "beginner" && app.mode !== "advanced") return "Switch to Beginner or Advanced to import a model.";
    if (document.body.classList.contains("s3d-on") || document.querySelector(".flexigen")) return "Close this tool first, then drop the file in Beginner or Advanced.";
    if (document.querySelector(".modal-back") || app.simLock || app.command) return "Finish or close the open dialog first, then drop the file again.";
    if (busy) return "Still opening the last files. Drop this one again in a moment.";
    return "";
  }
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

  function show() {
    const why = reason();
    overlay.classList.toggle("no", !!why);
    const t = why ? "Can't import here" : "Drop to import", s = why || WORDS;
    if (title.textContent !== t) title.textContent = t;
    if (sub.textContent !== s) sub.textContent = s;
    overlay.hidden = false;
    clearTimeout(stale);
    stale = setTimeout(hide, STALE_MS);
  }
  function hide() {
    depth = 0;
    clearTimeout(stale);
    overlay.hidden = true;
  }

  async function openDropped(files) {
    if (!files.length) return;
    const why = reason();
    if (why) { app.toast(why, "err"); return; }
    const A = app.advanced;
    const wanted = files.filter((f) => DROPPABLE.has(A.fileKind(f)));
    const other = files.filter((f) => !wanted.includes(f));
    if (other.length) app.toast(`Can't open ${other[0].name || "that file"}${other.length > 1 ? ` and ${other.length - 1} other file${other.length > 2 ? "s" : ""}` : ""}: drop an ${WORDS} file.`, "err");
    busy = true;
    try {
      for (const f of wanted) {
        await A.openModelFile(f);
        // a mesh, SVG or DXF opens a dialog (units, size); the next file waits until it is closed
        const dlg = app.command;
        if (dlg) await new Promise((done) => {
          const prev = dlg.cleanup;
          dlg.cleanup = (c) => { if (prev) prev.call(dlg, c); done(); };
          const poll = setInterval(() => { if (app.command !== dlg) { clearInterval(poll); done(); } }, 500); // safety net: never leave "busy" stuck
        });
      }
    } finally { busy = false; }
  }

  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    show();
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // without this the browser refuses the drop and opens the file instead
    e.dataTransfer.dropEffect = "copy";
    show();
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth--;
    const gone = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1; // the pointer left the window
    if (depth <= 0 || gone) hide();
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []); // read now: the list is emptied once this handler returns
    hide();
    openDropped(files);
  });
  window.addEventListener("dragend", hide);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) hide(); }, true);

  return { overlay };
}
