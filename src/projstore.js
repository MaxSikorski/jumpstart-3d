// jumpstart-3d: designs storage. Designs (the document and its Your-designs list entry with the
// thumbnail) live in this browser's IndexedDB, which has room for big designs. Where IndexedDB
// cannot be opened (browsers or sandboxes that block it, a hanging open, the claude.ai sandbox) the
// same calls use the older localStorage keys, as the app always did. The choice is made once per
// page, except one way: if IndexedDB is only slow (it answers after the 3 s the first start waits), the
// store starts on localStorage and switches to IndexedDB when the open finally succeeds, copying what was
// saved meanwhile across once (see `adopt`).
// Not stored here: the version counters and the last-open id, which projects.js reads synchronously.
import { uid } from "./util.js";

const DBNAME = "jumpstart3d-projects";
const LS_INDEX = "workplane.index.v1", LS_DOC = "workplane.doc.v1.";
const RESCUE = "workplane.rescue.v1"; // the last unsaved edit, written when the tab closes

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const readJSON = (k, d) => { try { const v = ls.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const stamp = (docString) => { try { return +JSON.parse(docString)._updated || 0; } catch (e) { return 0; } };

// ---------------------------------------------------------------- IndexedDB driver
function openDB() { // null on error or blocked; a slow open keeps waiting (the caller decides how long to wait)
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    try {
      const r = indexedDB.open(DBNAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("docs"); // key = design id, value = the document as a JSON string
        r.result.createObjectStore("entries", { keyPath: "id" });
        r.result.createObjectStore("meta");
      };
      r.onsuccess = () => { if (done) r.result.close(); else finish(r.result); }; // after an error or block: nobody will use it
      r.onerror = () => finish(null);
      r.onblocked = () => finish(null);
    } catch (e) { finish(null); }
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const committed = (tx) => new Promise((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false); });

// The IndexedDB version of a design, as a design of its own named "<name> (before fallback)".
function keepCopy(docs, entries, str, ent) {
  let d = null;
  try { d = JSON.parse(str); } catch (e) {}
  if (!d) return;
  const id = uid("d"), name = (d.name || "Untitled") + " (before fallback)";
  docs.put(JSON.stringify({ ...d, id, name }), id);
  entries.put({ ver: d.ver || 0, mode: d.mode, updated: d._updated || 0, thumb: null, ...ent, id, name });
}

// the same design apart from its save stamp (a tab's own earlier save, met again by its rescue copy: nothing to keep)
function sameDesign(a, b) {
  try { const x = JSON.parse(a), y = JSON.parse(b); delete x._updated; delete y._updated; return JSON.stringify(x) === JSON.stringify(y); } catch (e) { return false; }
}

// `base` (optional, a stamp or a function returning one or null) is the `_updated` of the copy these edits started from.
// With it the stored copy is read in the SAME transaction: if it is newer than the base and is not this very write, it is
// kept first as "(before fallback)", so edits made on an older copy never replace a newer one. Both writes commit or neither.
function idbPut(db, id, docString, entry, base) {
  try {
    const tx = db.transaction(["docs", "entries"], "readwrite");
    const docs = tx.objectStore("docs"), entries = tx.objectStore("entries");
    const write = () => { docs.put(docString, id); entries.put({ ...entry, id }); };
    const b = typeof base === "function" ? base() : base;
    if (b == null) write();
    else {
      const d = docs.get(id), e = entries.get(id);
      let waiting = 2;
      const go = () => {
        if (--waiting) return;
        try {
          if (d.result != null && stamp(d.result) > b && stamp(d.result) !== stamp(docString) && !sameDesign(d.result, docString)) keepCopy(docs, entries, d.result, e.result);
          write();
        } catch (err) { try { tx.abort(); } catch (e2) {} }
      };
      d.onsuccess = go; e.onsuccess = go;
    }
    return committed(tx);
  } catch (e) { return Promise.resolve(false); }
}

// If the size, content hash or number of documents of the old localStorage keys differ from what the
// last merge saw, something wrote them: only `del` writes them; anything else that changes them is an
// older build or a fallback visit.
function fingerprint() {
  const idx = ls.get(LS_INDEX) || "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < idx.length; i++) { hash ^= idx.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  let docs = 0;
  try { docs = Object.keys(localStorage).filter((k) => k.startsWith(LS_DOC)).length; } catch (e) {}
  return { len: idx.length, hash: hash >>> 0, docs };
}
const sameFingerprint = (a, b) => !!a && !!b && a.len === b.len && a.hash === b.hash && a.docs === b.docs;

// Copy what the older storage left behind into IndexedDB, in ONE transaction (read and write), so an
// interrupted copy runs again and two tabs cannot interleave. Per design: one that IndexedDB lacks is
// added; one with a newer `_updated` replaces the IndexedDB one, whose version is first kept as a new
// design named "<name> (before fallback)"; an equal or older one is ignored.
function merge(db, fp) {
  const list = readJSON(LS_INDEX, []);
  const index = new Map((Array.isArray(list) ? list : []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const found = [];
  let keys = [];
  try { keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_DOC)); } catch (e) {}
  for (const k of keys) {
    const str = ls.get(k), id = k.slice(LS_DOC.length);
    let doc = null;
    try { doc = JSON.parse(str); } catch (e) {}
    if (!doc || typeof doc !== "object") continue;
    found.push({ id, str, entry: { id, name: doc.name, ver: doc.ver || 0, mode: doc.mode, updated: doc._updated || 0, thumb: null, ...index.get(id) } });
  }
  const tx = db.transaction(["docs", "entries", "meta"], "readwrite");
  const docs = tx.objectStore("docs"), entries = tx.objectStore("entries");
  const have = found.map(() => ({}));
  let waiting = found.length * 2, copied = 0;
  const write = () => {
    found.forEach((f, i) => {
      const { str, ent } = have[i];
      if (str != null) { if (stamp(f.str) <= stamp(str)) return; keepCopy(docs, entries, str, ent); }
      docs.put(f.str, f.id);
      entries.put(f.entry);
      copied++;
    });
    tx.objectStore("meta").put({ at: Date.now(), count: copied, fp }, "migrated");
  };
  if (!found.length) write();
  found.forEach((f, i) => {
    const d = docs.get(f.id), e = entries.get(f.id);
    d.onsuccess = () => { have[i].str = d.result; if (--waiting === 0) write(); };
    e.onsuccess = () => { have[i].ent = e.result; if (--waiting === 0) write(); };
  });
  return committed(tx);
}

// A rescue copy newer than the stored design is the edit made just before the tab closed. If the stored design is newer
// than the copy those edits started from (`base`), it is kept as "(before fallback)" first.
// The tab closing leaves the copy in localStorage and in the database's `meta` store (either may be missing: storage full, or the page torn down first).
async function applyRescue(db) {
  for (const where of ["ls", "idb"]) {
    let raw = null, r = null;
    try { raw = where === "ls" ? ls.get(RESCUE) : await req(db.transaction("meta").objectStore("meta").get(RESCUE)); } catch (e) {}
    if (!raw) continue;
    try { r = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) {}
    if (r && r.id && typeof r.doc === "string") {
      const tx = db.transaction(["docs", "entries"]);
      const [cur, ent] = await Promise.all([req(tx.objectStore("docs").get(r.id)), req(tx.objectStore("entries").get(r.id))]);
      if ((cur == null || stamp(r.doc) > stamp(cur)) && !await idbPut(db, r.id, r.doc, { ...r.entry, thumb: ent ? ent.thumb : null }, r.base)) return; // kept for the next visit
    }
    if (where === "ls") ls.del(RESCUE);
    else {
      const del = db.transaction("meta", "readwrite");
      del.objectStore("meta").delete(RESCUE);
      await committed(del);
    }
  }
}

const rescueOf = (id, docString, entry, base) => ({ id, doc: docString, entry: { ...entry, thumb: null }, base: base == null ? null : base });
const rescueWrite = (id, docString, entry, base) => ls.set(RESCUE, JSON.stringify(rescueOf(id, docString, entry, base)));

// guard: after a slow open took over, the first write of each design checks the stored copy against the write's base
function idbDriver(db, guard) {
  return {
    kind: "idb",
    async list() { return (await req(db.transaction("entries").objectStore("entries").getAll())).sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
    async get(id) { const v = await req(db.transaction("docs").objectStore("docs").get(id)); return v == null ? null : v; },
    async put(id, docString, entry, base) {
      const ok = await idbPut(db, id, docString, entry, guard && guard.on && !guard.verified.has(id) ? base : undefined);
      if (ok && guard) guard.verified.add(id);
      return ok;
    },
    async del(id) {
      // an old copy must never come back through a merge, and an older build must not list a card with no document
      ls.del(LS_DOC + id);
      try { const raw = ls.get(LS_INDEX); if (raw) ls.set(LS_INDEX, JSON.stringify(JSON.parse(raw).filter((p) => p.id !== id))); } catch (e) {}
      const tx = db.transaction(["docs", "entries"], "readwrite");
      tx.objectStore("docs").delete(id);
      tx.objectStore("entries").delete(id);
      return committed(tx);
    },
    async getMeta(key) { const v = await req(db.transaction("meta").objectStore("meta").get(key)); return v === undefined ? null : v; },
    setMeta(key, value) { // null removes the key
      try {
        const tx = db.transaction("meta", "readwrite");
        if (value == null) tx.objectStore("meta").delete(key); else tx.objectStore("meta").put(value, key);
        return committed(tx);
      } catch (e) { return Promise.resolve(false); }
    },
    // for the tab closing: the rescue copy goes to localStorage first (it may be full), then the put is queued in the same call, so a page torn down right after still has it in flight
    putNow(id, docString, entry, base) {
      rescueWrite(id, docString, entry, base);
      try { const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put(rescueOf(id, docString, entry, base), RESCUE); if (tx.commit) tx.commit(); } catch (e) {}
    },
  };
}

// ---------------------------------------------------------------- localStorage driver (the older way)
function localPut(id, docString, entry) {
  const before = ls.get(LS_DOC + id);
  if (!ls.set(LS_DOC + id, docString)) return false;
  const index = readJSON(LS_INDEX, []).filter((p) => p.id !== id);
  index.unshift({ ...entry, id });
  if (ls.set(LS_INDEX, JSON.stringify(index))) return true;
  // a document with no list entry would be invisible: put back what was there
  if (before == null) ls.del(LS_DOC + id); else ls.set(LS_DOC + id, before);
  return false;
}
const localDriver = {
  kind: "local",
  async list() { return readJSON(LS_INDEX, []); },
  async get(id) { return ls.get(LS_DOC + id); },
  async put(id, docString, entry) { return localPut(id, docString, entry); },
  async del(id) {
    ls.del(LS_DOC + id);
    ls.set(LS_INDEX, JSON.stringify(readJSON(LS_INDEX, []).filter((p) => p.id !== id)));
    return true;
  },
  async getMeta() { return null; },
  async setMeta() { return false; },
  putNow: (id, docString, entry) => localPut(id, docString, entry),
};

// ---------------------------------------------------------------- the store
const FIRST_WAIT = 3000; // how long the first start waits for IndexedDB before it begins on localStorage

// Bring a freshly opened database up to date: drop what was deleted meanwhile, copy the localStorage leftovers over, apply a rescue copy.
// Returns the database, or null (closed) when the copy could not be made.
async function adopt(db, gone) {
  try {
    if (gone && gone.size) { // designs deleted on localStorage while IndexedDB was still opening: their IndexedDB copies go too, unless a newer one is there
      const tx = db.transaction(["docs", "entries"], "readwrite");
      const docs = tx.objectStore("docs"), entries = tx.objectStore("entries");
      for (const [id, at] of gone) {
        const g = docs.get(id);
        g.onsuccess = () => { if (g.result != null && stamp(g.result) <= at) { docs.delete(id); entries.delete(id); } };
      }
      if (!await committed(tx)) { db.close(); return null; }
    }
    const migrated = await req(db.transaction("meta").objectStore("meta").get("migrated"));
    const fp = fingerprint();
    if ((!migrated || !sameFingerprint(migrated.fp, fp)) && !await merge(db, fp)) { db.close(); return null; }
  } catch (e) { try { db.close(); } catch (e2) {} return null; }
  try { await applyRescue(db); } catch (e) {}
  return db;
}

export function openProjectStore() {
  let driver = null;
  const switched = []; // called once, after a slow IndexedDB open took over from localStorage
  const gone = new Map(); // id -> the `_updated` of the copy deleted on localStorage while IndexedDB was still opening
  const guard = { on: false, verified: new Set() };
  const opened = openDB();
  let slow = false;
  const ready = (async () => {
    const waited = Symbol();
    let db = await Promise.race([opened, new Promise((r) => setTimeout(() => r(waited), FIRST_WAIT))]);
    if (db === waited) { slow = true; driver = localDriver; return "local"; }
    if (db) db = await adopt(db);
    driver = db ? idbDriver(db) : localDriver; // no guard: not a slow open
    return driver.kind;
  })();
  // every call waits for ready and for the call before it, so un-awaited saves land in order
  let chain = ready;
  const run = (name, bad, before) => (...args) => {
    const p = chain.then(() => { if (before) before(...args); return driver[name](...args); }).catch(() => bad);
    chain = p;
    return p;
  };
  // Slow open: it joins the same chain, so the copy runs between two calls, never inside one. Saves made
  // on localStorage before this point are in the old keys that `merge` reads; saves after it go to IndexedDB.
  ready.then(() => slow && opened).then((db) => {
    if (!db) return;
    chain = chain.then(async () => {
      const ok = await adopt(db, gone);
      if (!ok) return;
      guard.on = true;
      driver = idbDriver(ok, guard);
      for (const f of switched) { try { f(); } catch (e) {} }
    }).catch(() => {});
  });
  return {
    ready,
    get kind() { return driver ? driver.kind : null; },
    onSwitch: (f) => switched.push(f),
    list: run("list", []),
    get: run("get", null),
    put: run("put", false),
    del: run("del", false, (id) => { if (slow && driver === localDriver) gone.set(id, stamp(ls.get(LS_DOC + id)) || (readJSON(LS_INDEX, []).find((p) => p.id === id) || {}).updated || 0); }),
    getMeta: run("getMeta", null), // small records kept beside the designs (IndexedDB only; the older storage has no place for them)
    setMeta: run("setMeta", false),
    // for the tab closing: no waiting, no promise
    putNow: (id, docString, entry, base) => (driver ? driver.putNow : rescueWrite)(id, docString, entry, base),
  };
}
