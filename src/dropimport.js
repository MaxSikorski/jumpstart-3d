// jumpstart-3d: drop import. Drop a model file anywhere on the page and it imports like the Import button does.
// While a drag that carries files is over the page, a full-page "Drop to import" note shows. Drags without files (text, links,
// the app's own shape drags) are ignored. The opening itself is app.advanced.openModelFile, the same function the Import
// button's picker uses; this file only catches the drop, checks that importing makes sense right now, and feeds the files in order.
import { el } from "./util.js";
import { store } from "./store.js";

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

let busy = 0; // jumpstart-3d: insert supplier parts. Shared by dropped and watched imports.

// "" when a model can be imported right now, otherwise the plain sentence that says what to do first
export function reason(app, ignoreBusy = false) {
  if (app.mode !== "beginner" && app.mode !== "advanced") return "Switch to Beginner or Advanced to import a model.";
  if (document.body.classList.contains("s3d-on") || document.querySelector(".flexigen")) return "Close this tool first, then drop the file in Beginner or Advanced.";
  if (document.querySelector(".modal-back") || app.simLock || app.command) return "Finish or close the open dialog first, then drop the file again.";
  if (busy > 0 && !ignoreBusy) return "Still opening the last files. Drop this one again in a moment.";
  return "";
}

// jumpstart-3d: insert supplier parts
export function importBusy() { return busy > 0; }

// jumpstart-3d: insert supplier parts
export async function holdImport(fn) { busy++; try { return await fn(); } finally { busy--; } }

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
  let inside = false; // a drag that started in this page (a picture dragged out of the chat or a texture thumbnail carries "Files" too): not ours

  const hasFiles = (e) => !inside && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const lastEdit = () => store.undoStack[store.undoStack.length - 1];

  function show() {
    const why = reason(app);
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
    const why = reason(app);
    if (why) { app.toast(why, "err"); return; }
    const A = app.advanced;
    const wanted = files.filter((f) => DROPPABLE.has(A.fileKind(f)));
    const other = files.filter((f) => !wanted.includes(f));
    if (other.length) app.toast(`Can't open ${other[0].name || "that file"}${other.length > 1 ? ` and ${other.length - 1} other file${other.length > 2 ? "s" : ""}` : ""}: drop an ${WORDS} file.`, "err");
    const notOpened = (n) => { if (n > 0) app.toast(`${n} file${n > 1 ? "s" : ""} not opened.`, "err"); };
    busy++; // jumpstart-3d: insert supplier parts
    try {
      for (let i = 0; i < wanted.length; i++) {
        if (i > 0 && reason(app, true)) { notOpened(wanted.length - i); return; } // the mode or a dialog changed while the earlier files were opening
        await A.openModelFile(wanted[i]);
        const before = lastEdit(); // after the file is handed over: an SVG or DXF dropped outside a sketch starts one (an undo entry) before its dialog opens
        // a mesh, SVG or DXF opens a dialog (units, size); the next file waits until it is closed
        const dlg = app.command;
        if (dlg) {
          await new Promise((done) => {
            const prev = dlg.cleanup;
            dlg.cleanup = (c) => { if (prev) prev.call(dlg, c); done(); };
            const poll = setInterval(() => { if (app.command !== dlg) { clearInterval(poll); done(); } }, 500); // safety net: never leave "busy" stuck
          });
          if (lastEdit() === before) { notOpened(wanted.length - i - 1); return; } // Cancel or Esc: the person has had enough of this drop
        }
      }
    } finally { busy--; } // jumpstart-3d: insert supplier parts
  }

  // The handlers are shared with the helper frames (Chisel, FlexiGen, Mesh to STEP), whose own documents never bubble a drag up to this window.
  const onEnter = (e) => {
    if (e.defaultPrevented || !hasFiles(e)) return; // a drop zone of its own (the Mesh to STEP helper) has already taken it
    e.preventDefault();
    depth++;
    show();
  };
  const onOver = (e) => {
    if (e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault(); // without this the browser refuses the drop and opens the file instead
    e.dataTransfer.dropEffect = "copy";
    show();
  };
  const onLeave = (e) => {
    if (overlay.hidden) return; // some Safari versions list no types on dragleave, so the note itself says whether a file drag is on
    depth--;
    const w = e.view && e.view.innerWidth ? e.view : window;
    const gone = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= w.innerWidth - 1 || e.clientY >= w.innerHeight - 1; // the pointer left the window
    if (depth <= 0 || gone) hide();
  };
  const onDrop = (e) => {
    const own = inside;
    inside = false;
    if (own || e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []); // read now: the list is emptied once this handler returns
    hide();
    openDropped(files);
  };
  const onStart = () => { inside = true; hide(); };
  const onEnd = () => { inside = false; hide(); };
  const onMove = () => { inside = false; }; // no mouse event arrives while any drag is on, so one means a lost dragend
  function attach(w) {
    w.addEventListener("dragenter", onEnter);
    w.addEventListener("dragover", onOver);
    w.addEventListener("dragleave", onLeave);
    w.addEventListener("drop", onDrop);
    w.addEventListener("dragstart", onStart);
    w.addEventListener("dragend", onEnd);
    w.addEventListener("mousemove", onMove, true);
    w.addEventListener("pointerdown", onMove, true); // a press comes before a drag starts, so it can only clear a stale flag
  }
  attach(window);
  window.addEventListener("blur", onMove); // the page lost the focus: any drag it knew about is over
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) { hide(); e.stopPropagation(); } }, true);

  // Chisel's sculpt area and the FlexiGen helper are frames of their own: a file dropped there would be opened by the browser.
  // The Mesh to STEP helper (also a .flexigen box, with .meshstep) takes the whole window as its drop zone and is left alone.
  const FRAMES = "#chisel-host, .flexigen:not(.meshstep)";
  const adopt = (ifr) => {
    const go = () => { try { if (ifr.contentWindow && ifr.contentWindow.document) attach(ifr.contentWindow); } catch (e) {} }; // same listeners again are ignored
    ifr.addEventListener("load", go);
    go();
  };
  const adoptIn = (n) => { if (n.nodeType === 1 && n.matches(FRAMES)) n.querySelectorAll("iframe").forEach(adopt); };
  document.querySelectorAll(FRAMES).forEach(adoptIn);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(adoptIn); }).observe(document.body, { childList: true });

  return { overlay };
}
