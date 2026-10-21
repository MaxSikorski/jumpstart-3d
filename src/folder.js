// jumpstart-3d: copies in a folder. Where the browser can pick a folder (Chrome and Edge on a computer),
// Your designs offers "Save copies into a folder…". Once chosen, every design is kept there as an
// ordinary project file, a few seconds after editing stops and at once on Save, so clearing the
// browser's site data does not lose work. The designs in IndexedDB stay the original; this only copies.
// The folder handle and what was written live in the store's `meta` record "folder":
// { handle, name, files: { <design id>: { file, updated } } }. A copy run compares the list of designs
// with `files` and writes whatever is newer, so anything missed (permission lapsed, a failed write, the
// tab closed) is caught up on the next run. Nothing here throws into the app or writes to the console.
import { el } from "./util.js";

const KEY = "folder", MODE = { mode: "readwrite" }, QUIET = 5000;
const plural = (n) => `${n} design${n === 1 ? "" : "s"}`;

export function initFolder({ ps, toast, fileSafe }) {
  let supported = false, record = null, status = { kind: "ok" }, paused = false, timer = null, rowEl = null;
  let running = null, again = false;
  const q = () => `“${record ? record.name : ""}”`;

  const text = () => {
    const n = q();
    if (status.kind === "waiting") return status.n ? `${plural(status.n)} waiting to be copied to ${n}: click Allow.` : `Click Allow to keep copying to ${n}.`;
    if (status.kind === "refused") return `The browser refused access to ${n}. Click Allow to ask again, or stop and choose another folder.`;
    if (status.kind === "failed") return `Could not write to ${n}: ${status.msg}. Your designs are still saved in this browser.`;
    if (status.kind === "notfound") return `${n} can't be found; it may have been moved or deleted. Stop copying and choose it again.`;
    return `Copies of your designs are saved to ${n}.`;
  };
  const red = () => status.kind !== "ok" && status.kind !== "waiting";

  const fill = () => {
    if (!rowEl) return;
    if (!record) {
      rowEl.replaceChildren(el("button", { class: "btn", id: "btn-folder", title: "Chrome and Edge: keep every design as a file in a folder you choose", onclick: choose }, "Save copies into a folder…"));
      return;
    }
    const asks = status.kind === "waiting" || status.kind === "refused";
    rowEl.replaceChildren(
      el("span", { id: "folder-status", style: red() ? { color: "var(--danger)" } : {} }, text()),
      asks ? el("button", { class: "btn", id: "btn-folder-allow", onclick: allow }, "Allow") : null,
      el("button", { class: "btn", id: "btn-folder-stop", title: "Stop saving copies; the files already in the folder stay", onclick: stop }, "Stop copying"));
  };
  const setStatus = (s) => {
    status = s;
    fill();
    if (!paused && ((s.kind === "waiting" && s.n >= 1) || s.kind === "refused" || s.kind === "failed")) {
      paused = true;
      toast(`Copies to ${q()} are paused: open Your designs to fix it.`, s.kind === "waiting" ? undefined : "err");
    }
  };

  async function choose() {
    let handle;
    try { handle = await window.showDirectoryPicker({ id: "jumpstart-3d", mode: "readwrite" }); }
    catch (e) { if (!e || e.name !== "AbortError") toast("That folder can't be used: " + ((e && e.message) || "the browser refused it"), "err"); return; }
    const next = { handle, name: handle.name, files: {} };
    if (!await ps.setMeta(KEY, next)) { toast("Couldn't remember the folder.", "err"); return; }
    record = next;
    status = { kind: "ok" };
    fill();
    toast(`Copies of your designs will be saved to ${q()}.`);
    now();
  }
  async function allow() {
    try { await record.handle.requestPermission(MODE); } catch (e) {}
    now();
  }
  async function stop() {
    clearTimeout(timer);
    record = null;
    status = { kind: "ok" };
    fill();
    if (!await ps.setMeta(KEY, null)) toast("Couldn't stop copying: it will start again next time.", "err");
  }

  async function write(dir, name, data) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    try { await w.write(data); await w.close(); } // the old file is replaced only on close
    catch (e) { try { await w.abort(); } catch (e2) {} throw e; }
  }

  // Which designs are newer than their copy, and may we write? Also forgets (in the record only) designs that are gone.
  async function assess(rec) {
    const perm = await rec.handle.queryPermission(MODE);
    const list = await ps.list();
    const ids = new Set(list.map((e) => e.id));
    for (const id of Object.keys(rec.files)) if (!ids.has(id)) delete rec.files[id];
    return { perm, due: list.filter((e) => !rec.files[e.id] || rec.files[e.id].updated < e.updated) };
  }

  async function run() {
    const rec = record;
    if (!rec) return;
    try {
      const { perm, due } = await assess(rec);
      if (record !== rec) return;
      if (perm !== "granted") { setStatus(perm === "denied" ? { kind: "refused" } : { kind: "waiting", n: due.length }); return; }
      try {
        for (const e of due) {
          if (record !== rec) return;
          const s = await ps.get(e.id);
          let doc = null;
          try { doc = JSON.parse(s); } catch (x) {}
          if (!doc) continue;
          delete doc._updated;
          const name = (fileSafe(e.name || "").slice(0, 70) || "design") + "-" + e.id + ".json";
          await write(rec.handle, name, JSON.stringify({ app: "jumpstart-3d", version: 1, doc }, null, 1));
          const old = rec.files[e.id];
          // Mac and Windows disks ignore case: "Box" renamed to "box" is the same file, which must not be removed
          if (old && old.file.normalize("NFC").toLowerCase() !== name.normalize("NFC").toLowerCase()) { try { await rec.handle.removeEntry(old.file); } catch (x) {} } // only the file this app wrote
          rec.files[e.id] = { file: name, updated: e.updated };
        }
      } finally {
        if (record === rec) await ps.setMeta(KEY, rec); // what was written so far is kept even when a write failed
      }
      if (record === rec) setStatus({ kind: "ok" });
    } catch (e) {
      if (record === rec) setStatus(e && e.name === "NotFoundError" ? { kind: "notfound" } : { kind: "failed", msg: (e && e.message) || (e && e.name) || "unknown error" });
    }
  }
  function now() {
    clearTimeout(timer);
    timer = null;
    if (!record) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await run(); } while (again); } finally { running = null; }
    })();
    return running;
  }
  function soon() {
    if (!record) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; now(); }, QUIET);
  }

  // The meta read is queued now, so it is the first thing in the store's chain.
  const loaded = Promise.all([ps.ready, ps.getMeta(KEY)]).then(([kind, rec]) => {
    supported = kind === "idb" && typeof window.showDirectoryPicker === "function" && !!window.isSecureContext && !window.claude;
    if (supported && rec && rec.handle && rec.files) { record = rec; soon(); }
  }).catch(() => {});

  return {
    soon,
    now,
    async row() {
      await loaded;
      if (!supported) return null;
      rowEl = el("div", { class: "backup-row", id: "folder-row" });
      fill();
      if (record && status.kind === "ok") assess(record).then(({ perm, due }) => { if (perm !== "granted" && status.kind === "ok") setStatus(perm === "denied" ? { kind: "refused" } : { kind: "waiting", n: due.length }); }).catch(() => {});
      return rowEl;
    },
  };
}
