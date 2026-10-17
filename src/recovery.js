// Crash recovery and autosave history. Every change is copied to the browser's
// IndexedDB within a moment (and at once when the page is hidden, closed or hits an
// error), separately from normal saving. On the next start, unsaved work found there is
// offered back. A rolling set of checkpoints per design can be restored any time.
import { el } from "./util.js";
import { ICON } from "./icons.js";

const DBNAME = "jumpstart3d-recovery", STORE = "snaps";
const LS_FALLBACK = "jumpstart3d.recovery.";
const CHECKPOINT_EVERY = 2 * 60 * 1000; // ms of editing between checkpoints
const KEEP_CHECKPOINTS = 12; // per design
const KEEP_DESIGNS = 10;

function openDB() {
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    setTimeout(() => finish(null), 3000);
    try {
      const r = indexedDB.open(DBNAME, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: "key" }); s.createIndex("doc", "docId"); };
      r.onsuccess = () => finish(r.result);
      r.onerror = () => finish(null);
      r.onblocked = () => finish(null);
    } catch (e) { finish(null); }
  });
}

const PREF = "jumpstart3d.autosave";
// autosaves are numbered per design: "Lopez, Maria, Keychain autosave v1", v2...
const AUTOVER = "jumpstart3d.autover.";
export function initRecovery({ getDoc, toast, restore, savedCopy }) {
  let db = null, ready = null, timer = 0, lastData = "", lastCheckpoint = 0, mem = new Map();
  // off unless the user turns it on (remembered in this browser)
  let enabled = false;
  try { enabled = localStorage.getItem(PREF) === "on"; } catch (e) {}
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    keys() { try { return Object.keys(localStorage).filter((k) => k.startsWith(LS_FALLBACK)); } catch (e) { return []; } },
  };
  ready = openDB().then((d) => { db = d; });

  // ---------------------------------------------------------------- storage
  function put(rec) {
    mem.set(rec.key, rec);
    if (db) {
      try { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec); return new Promise((r) => { tx.oncomplete = () => r(true); tx.onerror = () => r(false); tx.onabort = () => r(false); }); }
      catch (e) { /* fall through */ }
    }
    return Promise.resolve(ls.set(LS_FALLBACK + rec.key, JSON.stringify(rec)));
  }
  function del(key) {
    mem.delete(key);
    if (db) { try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); } catch (e) {} }
    ls.del(LS_FALLBACK + key);
  }
  async function all() {
    await ready;
    let out = [];
    if (db) {
      out = await new Promise((r) => {
        try { const q = db.transaction(STORE, "readonly").objectStore(STORE).getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); }
        catch (e) { r([]); }
      });
    }
    for (const k of ls.keys()) { try { const v = JSON.parse(ls.get(k)); if (v && !out.some((o) => o.key === v.key)) out.push(v); } catch (e) {} }
    for (const v of mem.values()) if (!out.some((o) => o.key === v.key)) out.push(v);
    return out.sort((a, b) => b.time - a.time);
  }

  // ---------------------------------------------------------------- snapshots
  function snapshotNow(reason = "edit") {
    clearTimeout(timer);
    if (!enabled) return;
    const doc = getDoc();
    if (!doc) return;
    let data;
    try { data = JSON.stringify(doc); } catch (e) { return; }
    if (data === lastData && reason === "edit") return;
    lastData = data;
    const time = Date.now();
    // a new autosave version with each checkpoint; the latest copy carries the newest number
    let v = +(ls.get(AUTOVER + doc.id) || 0) || 0;
    const checkpoint = time - lastCheckpoint > CHECKPOINT_EVERY;
    if (checkpoint || !v) { v += 1; ls.set(AUTOVER + doc.id, String(v)); }
    const name = `${doc.name || "Untitled"} autosave v${v}`;
    const base = { docId: doc.id, name, ver: v, mode: doc.mode || "beginner", time, size: data.length, data };
    put({ ...base, key: doc.id + "|latest", kind: "latest", reason });
    if (checkpoint) {
      lastCheckpoint = time;
      put({ ...base, key: doc.id + "|" + time, kind: "checkpoint", reason });
      prune(doc.id);
    }
  }
  async function prune(docId) {
    const list = await all();
    const cps = list.filter((r) => r.docId === docId && r.kind === "checkpoint");
    for (const r of cps.slice(KEEP_CHECKPOINTS)) del(r.key);
    // only the most recently edited designs keep autosaves
    const docs = [...new Set(list.map((r) => r.docId))];
    for (const id of docs.slice(KEEP_DESIGNS)) for (const r of list.filter((x) => x.docId === id)) del(r.key);
  }
  // called on every change: write within a moment
  function touch() { if (!enabled) return; clearTimeout(timer); timer = setTimeout(() => snapshotNow("edit"), 400); }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(PREF, enabled ? "on" : "off"); } catch (e) {}
    if (enabled) { lastData = ""; lastCheckpoint = 0; snapshotNow("enabled"); }
  }
  // the latest copy matches what is saved now: nothing to recover for this design
  function markSaved(doc) { if (doc) lastData = ""; }

  // write at once whenever the page might go away or something breaks
  const urgent = (why) => () => { try { snapshotNow(why); } catch (e) {} };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") urgent("hidden")(); });
  window.addEventListener("pagehide", urgent("closed"));
  window.addEventListener("beforeunload", urgent("closed"));
  let errShown = false;
  const onCrash = () => {
    if (!enabled) return;
    urgent("error")();
    if (!errShown) { errShown = true; toast && toast("Something went wrong, but your work is autosaved. If the app misbehaves, reload: you'll be offered your latest work."); setTimeout(() => (errShown = false), 30000); }
  };
  window.addEventListener("error", onCrash);
  window.addEventListener("unhandledrejection", onCrash);
  setInterval(() => snapshotNow("timer"), 20000);

  // ---------------------------------------------------------------- on start: anything unsaved?
  async function check() {
    if (!enabled) return;
    const list = (await all()).filter((r) => r.kind === "latest");
    const found = [];
    for (const r of list) {
      const saved = await savedCopy(r.docId);
      if (saved === r.data) continue; // already saved
      found.push(r);
    }
    if (!found.length) return;
    showRecover(found);
  }
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function modal(title, body) {
    const back = el("div", { class: "modal-back" });
    const m = el("div", { class: "modal recover", role: "dialog", "aria-label": title },
      el("header", {}, el("h2", {}, title), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => back.remove() })), el("div", { class: "mbody" }, body));
    back.append(m);
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
    document.body.append(back);
    return back;
  }
  function showRecover(found) {
    const box = el("div", {});
    box.append(el("p", { class: "hint", style: { margin: "0 0 12px" } }, found.length === 1
      ? "JumpStart 3D closed before this work was saved. You can get it back."
      : "JumpStart 3D closed before some work was saved. You can get it back."));
    const back = modal("Recover unsaved work", box);
    for (const r of found) {
      const row = el("div", { class: "recrow" },
        el("div", { class: "rinfo" }, el("b", {}, r.name), el("span", {}, `Autosaved ${when(r.time)} · ${r.mode === "advanced" ? "Advanced" : "Beginner"}${r.reason === "error" ? " · saved after an error" : ""}`)),
        el("button", { class: "btn primary", id: "rec-open-" + r.docId, onclick: () => { back.remove(); doRestore(r, false); } }, "Recover"),
        el("button", { class: "btn", onclick: () => { del(r.key); row.remove(); if (!box.querySelector(".recrow")) back.remove(); } }, "Discard"));
      box.append(row);
    }
    box.append(el("p", { class: "hint", style: { margin: "12px 0 0" } }, "Discard keeps the last saved version. Earlier autosaves stay under Designs → Autosaves."));
  }
  function doRestore(r, asCopy) {
    let doc;
    try { doc = JSON.parse(r.data); } catch (e) { toast && toast("That autosave couldn't be read.", "err"); return; }
    restore(doc, asCopy, r.name);
    if (!asCopy) del(r.docId + "|latest");
    toast && toast(asCopy ? `Opened "${r.name}" (from ${when(r.time)})` : `Recovered ${r.name.replace(/ autosave v\d+$/, "")} from ${when(r.time)}`);
  }
  // every autosave, newest first
  async function openHistory() {
    const list = await all();
    const box = el("div", {});
    const back = modal("Autosaves", box);
    box.append(el("p", { class: "hint", style: { margin: "0 0 12px" } }, "JumpStart 3D keeps copies of your designs while you work: the latest change, plus a checkpoint every couple of minutes. Opening one makes a copy, so nothing is overwritten."));
    if (!list.length) box.append(el("div", { class: "empty" }, "No autosaves yet."));
    for (const r of list) {
      box.append(el("div", { class: "recrow" },
        el("div", { class: "rinfo" }, el("b", {}, r.name), el("span", {}, `${when(r.time)} · ${r.kind === "latest" ? "latest change" : "checkpoint"} · ${Math.max(1, Math.round(r.size / 1024))} KB`)),
        el("button", { class: "btn", onclick: () => { back.remove(); doRestore(r, true); } }, "Open copy")));
    }
  }
  return { touch, snapshotNow, markSaved, check, openHistory, all, setEnabled, get enabled() { return enabled; } };
}
