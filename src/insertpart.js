// Supplier links and local folder watching share the existing model import path.
import { el } from "./util.js";
import { reason, holdImport } from "./dropimport.js";

import { store } from "./store.js";

const CSS = `
#insertpart-panel { position: fixed; right: 12px; z-index: 48; box-sizing: border-box; width: min(440px, calc(100vw - 24px)); overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px var(--shadow, #0003); font: 13px/1.45 var(--f-ui); }
#insertpart-panel[hidden], #insertpart-pill[hidden], #insertpart-panel [hidden] { display: none; }
#insertpart-panel h2 { margin: 0; font-size: 18px; }
#insertpart-panel p { margin: 0; }
#insertpart-panel header, #insertpart-suppliers, #insertpart-watch-area { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
#insertpart-panel header { justify-content: space-between; }
#insertpart-panel button, #insertpart-suppliers a, #insertpart-pill button { min-height: 44px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: var(--panel-2); color: var(--ink); font: inherit; cursor: pointer; }
#insertpart-panel button, #insertpart-suppliers a { max-width: 100%; overflow-wrap: anywhere; }
#insertpart-suppliers a { display: inline-flex; align-items: center; text-decoration: none; }
#insertpart-terms { font-size: 12px; color: var(--ink-2); }
#insertpart-drop { border: 2px dashed var(--line-2); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
#insertpart-watch-help { width: 100%; color: var(--ink-2); }
#insertpart-status { overflow-wrap: anywhere; }
#insertpart-pill { position: fixed; display: flex; z-index: 47; max-width: min(300px, calc(100vw - 24px)); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--panel); color: var(--ink); font: 13px var(--f-ui); }
#insertpart-pill button { border: 0; border-radius: 0; }
#insertpart-pill-open { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#insertpart-pill-stop { flex-shrink: 0; }
`;
const HELP = 'Chrome can\'t watch Downloads itself. Make a folder inside it (for example "3D parts"), pick it here, and save supplier downloads into it. Tip: turn on "Ask where to save each file" in Chrome\'s download settings; Chrome then remembers the folder. If a supplier sends a .zip file, unzip it into the folder.';
const FALLBACK = "Choose the folder again to watch for new parts.";
const ENDED = "Folder access ended. Click to watch again.";
const tuple = (f) => JSON.stringify([f.name, f.lastModified, f.size]);
const validHandle = (h) => h && h.kind === "directory" && typeof h.name === "string" && typeof h.values === "function" && typeof h.queryPermission === "function" && typeof h.requestPermission === "function";

function folderRecord(action, handle) {
  return new Promise((resolve) => {
    let db, tx, done = false;
    const finish = (value, abort = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (abort) { try { tx?.abort(); } catch (e) {} }
      db?.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined, true), 1500);
    try {
      const req = indexedDB.open("js3d-insertpart", 1);
      req.onblocked = req.onerror = () => finish(undefined, true);
      req.onupgradeneeded = () => {
        db = req.result;
        tx = req.transaction;
        if (done) { tx.abort(); db.close(); return; }
        try { db.createObjectStore("handles"); } catch (e) { finish(undefined, true); }
      };
      req.onsuccess = () => {
        db = req.result;
        if (done) { db.close(); return; }
        db.onversionchange = () => finish(undefined, true);
        try {
          tx = db.transaction("handles", action === "get" ? "readonly" : "readwrite");
          const store = tx.objectStore("handles");
          const request = action === "get" ? store.get("parts-folder") : action === "put" ? store.put(handle, "parts-folder") : store.delete("parts-folder");
          let value;
          request.onsuccess = () => { try { value = request.result; } catch (e) { finish(undefined, true); } };
          request.onerror = tx.onerror = tx.onabort = () => finish(undefined, true);
          tx.oncomplete = () => finish(action === "get" ? value : true);
        } catch (e) { finish(undefined, true); }
      };
    } catch (e) { finish(undefined, true); }
  });
}

export function initInsertPart(app) {
  let panel, pill, status, pick, again, stopButton, opener;
  let remembered = null, handle = null, phase = "idle", message = "", read = false;
  let token = 0, interval = 0, frame = 0, scanState = null;
  let resize, changes, observing = false;
  let seen = new Set(), imported = new Set(), baselineFailed = new Set(), candidates = new Map();
  const supported = () => typeof window.showDirectoryPicker === "function";
  const visible = () => panel && (!panel.hidden || !pill.hidden);
  const schedulePlace = () => { if (visible() && !frame) frame = requestAnimationFrame(() => { frame = 0; placePill(); }); };

  function layout() {
    if (visible() && !observing) {
      observing = true;
      for (const node of document.querySelectorAll("#viewport, #timeline, #toasts, #shapes, .status, #dock-help")) {
        resize.observe(node);
        changes.observe(node, { attributes: true, attributeFilter: ["hidden", "class", "style"], childList: true, subtree: true });
      }
      changes.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      window.addEventListener("resize", schedulePlace);
    } else if (!visible() && observing) {
      observing = false;
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedulePlace);
      cancelAnimationFrame(frame);
      frame = 0;
    }
    schedulePlace();
  }

  function placePill() {
    if (!visible()) return;
    const vp = document.getElementById("viewport").getBoundingClientRect();
    panel.style.top = `${vp.top + 12}px`;
    panel.style.maxHeight = `${Math.max(0, vp.height - 24)}px`;
    let top = vp.bottom;
    for (const node of document.querySelectorAll("#timeline, #toasts, #shapes.dock, .status, #dock-help")) {
      if (node.id === "toasts" && !node.children.length) continue;
      const rect = node.getBoundingClientRect();
      if (node.getClientRects().length && rect.height && getComputedStyle(node).visibility !== "hidden") top = Math.min(top, rect.top);
    }
    pill.style.left = `${vp.left + 12}px`;
    pill.style.bottom = `${window.innerHeight - top + 12}px`;
    pill.style.maxWidth = `${Math.max(0, Math.min(300, vp.width - 24))}px`;
  }

  function showOnline() {
    if (!panel) return;
    const online = navigator.onLine;
    panel.querySelector("#insertpart-suppliers").hidden = !online;
    panel.querySelector("#insertpart-help").hidden = !online;
    panel.querySelector("#insertpart-offline").hidden = online;
  }

  function renderWatch() {
    if (!panel) return;
    status.textContent = message;
    panel.querySelector("#insertpart-help").textContent = phase === "watching" ? `New files in ${handle.name} come in by themselves. You can also drop a file here.` : "Find the part, download its STEP file, then drop it here.";
    if (pick) {
      pick.disabled = phase !== "idle";
      again.disabled = phase !== "idle";
      again.hidden = !remembered || phase !== "idle";
      again.textContent = remembered ? `Watch "${remembered.name}" again` : "";
      stopButton.hidden = phase !== "reading" && phase !== "watching";
    }
    pill.hidden = phase !== "watching";
    pill.firstElementChild.textContent = handle ? `Watching ${handle.name}` : "";
    layout();
  }

  function invalidate() {
    token++;
    clearInterval(interval);
    interval = 0;
    candidates.clear();
    scanState = null;
  }
  function stop() {
    invalidate();
    phase = "idle";
    message = "Watching stopped.";
    renderWatch();
  }
  function ended(session) {
    if (session !== token) return;
    invalidate();
    phase = "idle";
    message = ENDED;
    renderWatch();
  }

  async function startWatch(folder) {
    invalidate();
    const session = token;
    scanState = { token: session, running: null, followup: false, observe: false };
    handle = remembered = folder;
    phase = "reading";
    message = "Reading folder…";
    seen = new Set();
    imported = new Set();
    baselineFailed = new Set();
    renderWatch();
    try {
      for await (const entry of folder.values()) {
        if (session !== token) return;
        if (entry.kind !== "file") continue;
        let file;
        try { file = await entry.getFile(); } catch (e) { if (session !== token) return; baselineFailed.add(entry.name); continue; }
        if (session !== token) return;
        seen.add(tuple(file));
      }
      if (session !== token) return;
      phase = "watching";
      message = `Watching ${folder.name}`;
      folderRecord("put", folder);
      interval = setInterval(() => checkFolder(true), 2000);
      renderWatch();
    } catch (e) { ended(session); }
  }

  async function chooseFolder() {
    if (phase !== "idle") return;
    const session = ++token;
    phase = "choosing";
    renderWatch();
    try {
      const folder = await window.showDirectoryPicker({ id: "js3d-parts", startIn: "downloads", mode: "read" });
      if (session !== token) return;
      if (!validHandle(folder)) throw new Error();
      await startWatch(folder);
    } catch (e) {
      if (session !== token) return;
      phase = "idle";
      if (e.name !== "AbortError") message = "That folder can't be watched here. Try another folder or drop the file instead.";
      renderWatch();
    }
  }

  async function watchAgain() {
    if (phase !== "idle" || !remembered) return;
    const session = ++token, folder = remembered;
    phase = "choosing";
    renderWatch();
    try {
      if (!validHandle(folder)) throw new Error();
      let permission = await folder.queryPermission({ mode: "read" });
      if (session !== token) return;
      if (permission !== "granted") permission = await folder.requestPermission({ mode: "read" });
      if (session !== token) return;
      if (permission !== "granted") throw new Error();
      await startWatch(folder);
    } catch (e) {
      if (session !== token) return;
      remembered = null;
      folderRecord("delete");
      phase = "idle";
      message = FALLBACK;
      renderWatch();
    }
  }

  async function scan(session, observe) {
    const folder = handle;
    try {
      const permission = await folder.queryPermission({ mode: "read" });
      if (session !== token || document.visibilityState !== "visible") return;
      if (permission !== "granted") { ended(session); return; }
      const current = observe ? new Map() : candidates;
      if (observe) for await (const entry of folder.values()) {
        if (session !== token || document.visibilityState !== "visible") return;
        if (entry.kind !== "file" || entry.name.startsWith(".") || !/\.(step|stp|stl|3mf|obj)$/i.test(entry.name)) continue;
        let file;
        try { file = await entry.getFile(); } catch (e) { if (session !== token) return; continue; }
        if (session !== token || document.visibilityState !== "visible") return;
        const key = tuple(file), prev = candidates.get(entry.name);
        if (baselineFailed.delete(entry.name)) seen.add(key);
        if (!seen.has(key)) current.set(entry.name, { entry, key, size: file.size, stable: prev?.key === key ? prev.stable + 1 : 1 });
      }
      if (session !== token || document.visibilityState !== "visible") return;
      candidates = current;
      for (const name of [...current.keys()].sort()) {
        const candidate = current.get(name);
        if (!candidate) continue;
        if (candidate.stable < 2 || !candidate.size) continue;
        if (session !== token || document.visibilityState !== "visible") return;
        let file;
        try { file = await candidate.entry.getFile(); } catch (e) { if (session !== token) return; continue; }
        if (session !== token || document.visibilityState !== "visible") return;
        const key = tuple(file);
        if (key !== candidate.key) {
          if (observe) candidates.set(name, { ...candidate, key, size: file.size, stable: 1 });
          continue;
        }
        if (seen.has(key)) { candidates.delete(name); continue; }
        if (reason(app) || store.preview) continue;
        seen.add(key);
        candidates.delete(name);
        try { await holdImport(() => {
          const pending = app.advanced.openModelFile(file); // noteFile runs synchronously before the first await.
          if (session === token) imported.add(key);
          return pending;
        }); } catch (e) {} // The importer owns its error feedback; a consumed tuple is never retried.
        if (session !== token) return;
      }
    } catch (e) { ended(session); }
  }

  function checkFolder(observe = false) {
    const session = scanState;
    if (phase !== "watching" || !session || document.visibilityState !== "visible") return Promise.resolve();
    if (session.running) { session.followup = true; session.observe ||= observe; return session.running; }
    session.running = (async () => {
      do {
        session.followup = false;
        session.observe = false;
        await scan(session.token, observe);
        observe = session.observe;
      } while (session.followup && session.token === token && phase === "watching" && document.visibilityState === "visible");
    })().finally(() => { session.running = null; });
    return session.running;
  }

  function noteFile(file) {
    if (phase === "reading" || phase === "watching") {
      const key = tuple(file);
      if (imported.has(key)) return true;
      seen.add(key);
      if (candidates.get(file.name)?.key === key) candidates.delete(file.name);
    }
    close(panel?.contains(document.activeElement));
    return false;
  }

  function escape(e) {
    if (e.key !== "Escape" || document.querySelector(".modal-back") || app.command || document.querySelector("#drop-overlay:not([hidden])") || [...document.querySelectorAll('[role="menu"]')].some((node) => (node.checkVisibility?.() ?? (!node.hidden && node.offsetParent !== null))) || e.target.closest?.("#toasts")) return;
    if (!panel.contains(e.target) && !pill.contains(e.target) && e.target !== document.body && e.target !== app.vp.canvas) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  function makePanel() {
    document.head.append(el("style", { id: "insertpart-css" }, CSS));
    const button = (id, text, onclick, attrs = {}) => el("button", { id, type: "button", onclick, ...attrs }, text);
    const suppliers = el("div", { id: "insertpart-suppliers" });
    for (const [id, text, href] of [["mcmaster", "McMaster-Carr", "https://www.mcmaster.com/"], ["misumi", "Misumi", "https://us.misumi-ec.com/"], ["openbuilds", "OpenBuilds", "https://openbuilds.com/"], ["traceparts", "TraceParts", "https://www.traceparts.com/"]]) suppliers.append(el("a", { id: `insertpart-${id}`, href, target: "_blank", rel: "noopener" }, text));
    const area = el("div", { id: "insertpart-watch-area" });
    if (supported()) {
      pick = button("insertpart-watch", "Watch a folder for new parts…", chooseFolder);
      again = button("insertpart-again", "", watchAgain);
      stopButton = button("insertpart-stop", "Stop watching", stop);
      area.append(pick, again, stopButton, el("p", { id: "insertpart-watch-help" }, HELP));
    } else area.textContent = "Watching a folder needs Chrome or Edge on a computer. Drag the file in instead.";
    status = el("p", { id: "insertpart-status", role: "status", "aria-live": "polite" });
    panel = el("section", { id: "insertpart-panel", role: "region", "aria-labelledby": "insertpart-title", hidden: true },
      el("header", {}, el("h2", { id: "insertpart-title" }, "Insert a real part"), button("insertpart-close", "×", close, { title: "Close Insert a real part", "aria-label": "Close Insert a real part" })),
      suppliers, el("p", { id: "insertpart-help" }, "Find the part, download its STEP file, then drop it here."),
      el("p", { id: "insertpart-offline", hidden: true }, "No internet connection. Drop a file you already downloaded."),
      el("p", { id: "insertpart-terms" }, "Supplier models are for designing around the real part. McMaster's terms don't allow printing or sharing their models."),
      el("div", { id: "insertpart-drop" }, "Drop a STEP, STL, 3MF or OBJ file here", button("insertpart-file", "Choose file…", () => {
        const why = reason(app);
        if (why) app.toast("Finish or close what's open first, then choose the file.", "err");
        else app.insertFile("model");
      })), area, status);
    pill = el("div", { id: "insertpart-pill", hidden: true }, button("insertpart-pill-open", "", open), button("insertpart-pill-stop", "Stop ×", stop, { "aria-label": "Stop watching folder" }));
    for (const node of [panel, pill]) for (const type of ["keydown", "keyup", "keypress"]) node.addEventListener(type, (e) => {
      if (["Enter", " ", "Tab"].includes(e.key)) e.stopPropagation();
    });
    document.body.append(panel, pill);
    resize = new ResizeObserver(schedulePlace);
    changes = new MutationObserver(schedulePlace);
    window.addEventListener("focus", () => checkFolder());
    window.addEventListener("online", showOnline);
    window.addEventListener("offline", showOnline);
    document.addEventListener("visibilitychange", () => checkFolder());
  }
  function open() {
    if (!panel) makePanel();
    if (panel.hidden) opener = document.activeElement;
    panel.hidden = false;
    document.addEventListener("keydown", escape, true);
    renderWatch();
    showOnline();
    panel.querySelector("#insertpart-close").focus();
    if (supported() && !read) {
      read = true;
      const session = token;
      folderRecord("get").then((folder) => {
        if (session !== token) return;
        if (validHandle(folder)) remembered = folder;
        else if (folder !== undefined) { folderRecord("delete"); message = FALLBACK; }
        renderWatch();
      });
    }
  }
  function close(restoreFocus = true) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.removeEventListener("keydown", escape, true);
    if (restoreFocus) (opener?.isConnected && opener.checkVisibility?.() !== false ? opener : app.vp.canvas).focus();
    layout();
  }
  document.getElementById("btn-insertpart-menu").addEventListener("click", () => {
    document.getElementById("menu-export").hidden = true;
    open();
  });
  return { open, close, stop, noteFile, folderName: () => handle?.name };
}
