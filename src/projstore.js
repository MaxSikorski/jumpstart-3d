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
const RESCUE = "workplane.rescue.v1"; // unsaved edits, written when a tab closes: one key per tab and design ("<RESCUE>.<tab>.<id>"; the bare key is the older single copy)
const OTHER = "(other tab)", BEFORE = "(before fallback)";
const LOCK = "jumpstart3d-local-designs";
const TAB = uid("t"); // names this page's saves (list entry `rev`: "<tab>:<n>") and its rescue keys
const rescueKey = (id) => RESCUE + "." + TAB + "." + id;

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

// A displaced version kept as a design of its own named "<name> <suffix>". The id is stable per (design, save), so a retry
// or a replay writes the same copy again instead of another. Returns [id, document string, list entry], or null if it cannot be read.
function copyOf(str, ent, suffix) {
  let d = null;
  try { d = JSON.parse(str); } catch (e) {}
  if (!d || typeof d !== "object") return null;
  const key = d.id + "|" + ((ent && ent.rev) || d._updated), h = (seed) => { let x = seed; for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(36).padStart(7, "0"); };
  const id = "d" + h(0x811c9dc5) + h(0x9747b28c), name = (d.name || "Untitled") + " " + suffix;
  return [id, JSON.stringify({ ...d, id, name }), { ver: d.ver || 0, mode: d.mode, updated: d._updated || 0, thumb: null, ...ent, id, name }];
}

// the same design apart from its save stamp
function sameDesign(a, b) {
  try { const x = JSON.parse(a), y = JSON.parse(b); delete x._updated; delete y._updated; return JSON.stringify(x) === JSON.stringify(y); } catch (e) { return false; }
}

// Notices that edits displaced another tab's version (kept as a copy). Replays at startup can raise one before projects.js listens.
const notices = { listener: null, held: [] };
const tell = (name) => { if (notices.listener) notices.listener(name); else notices.held.push(name); };

// `base` is what a write's edits started from: { at: the `_updated` of the copy the tab read or last saved, rev: that save's `rev` } (a bare
// stamp from an older build also works; null or undefined = no comparison). Did a save by someone else replace that copy since?
// Revisions decide when both sides have one (two saves can share a millisecond); otherwise the stamps do.
// `own` (a replayed rescue): the tab that wrote it, whose earlier saves are not "someone else".
function displaced(stored, ent, entry, docString, base, own) {
  if (!base || stored == null) return false;
  const rev = ent && ent.rev;
  if (rev && (rev === entry.rev || (own && rev.startsWith(own + ":")))) return false; // the same write again, or the same tab's earlier save
  return (rev && base.rev ? rev !== base.rev : stamp(stored) > base.at) && !sameDesign(stored, docString);
}
const baseOf = (b) => { b = typeof b === "function" ? b() : b; return b == null ? null : typeof b === "object" ? b : { at: +b || 0 }; };

// With a `base` (see `displaced`) the stored copy is read in the SAME transaction: if someone else saved it since, it is kept first as
// "<name> <suffix>", so edits made on an older copy never replace a newer one. Both writes commit or neither.
function idbPut(db, id, docString, entry, base, { suffix = OTHER, own } = {}) {
  try {
    const tx = db.transaction(["docs", "entries"], "readwrite");
    const docs = tx.objectStore("docs"), entries = tx.objectStore("entries");
    let kept = null;
    const write = () => { docs.put(docString, id); entries.put({ ...entry, id }); };
    const b = baseOf(base);
    if (!b) write();
    else {
      const d = docs.get(id), e = entries.get(id);
      let waiting = 2;
      const go = () => {
        if (--waiting) return;
        try {
          const c = displaced(d.result, e.result, entry, docString, b, own) && copyOf(d.result, e.result, suffix);
          if (c) { docs.put(c[1], c[0]); entries.put(c[2]); kept = c[2].name; }
          write();
        } catch (err) { try { tx.abort(); } catch (e2) {} }
      };
      d.onsuccess = go; e.onsuccess = go;
    }
    return committed(tx).then((ok) => { if (ok && kept && suffix === OTHER) tell(kept); return ok; });
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
      if (str != null) { if (stamp(f.str) <= stamp(str)) return; const c = copyOf(str, ent, BEFORE); if (c) { docs.put(c[1], c[0]); entries.put(c[2]); } }
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

// Rescue copies are the edits a tab had not saved when it closed. They are replayed oldest first, each through the same
// compare-and-keep as a save: a copy that started from an older version than the stored one keeps the stored one as "(other tab)";
// a copy older than the stored design that is not that tab's own earlier save is itself kept as "(other tab)". Replaying twice changes
// nothing (the entry's `rev` says the write is already there), so the journal can be removed after the fact.
// The tab closing leaves a copy in localStorage and in the database's `meta` store (either may be missing: storage full, or the page torn down first).
async function applyRescue(db) {
  const jobs = new Map(); // key -> { raw: the localStorage text, r: the parsed copy }
  let keys = [];
  try { keys = Object.keys(localStorage).filter((k) => k === RESCUE || k.startsWith(RESCUE + ".")); } catch (e) {}
  try { keys.push(...await req(db.transaction("meta").objectStore("meta").getAllKeys(IDBKeyRange.bound(RESCUE, RESCUE + "\uffff")))); } catch (e) {}
  for (const k of new Set(keys)) {
    const raw = ls.get(k);
    let r = null;
    try { r = raw ? JSON.parse(raw) : null; } catch (e) {}
    if (!(r && r.id && typeof r.doc === "string")) try { r = await req(db.transaction("meta").objectStore("meta").get(k)); } catch (e) {}
    jobs.set(k, { raw, r: r && r.id && typeof r.doc === "string" ? r : null });
  }
  for (const [k, { raw, r }] of [...jobs].sort((a, b) => (a[1].r ? stamp(a[1].r.doc) : 0) - (b[1].r ? stamp(b[1].r.doc) : 0))) {
    if (r) {
      const tx = db.transaction(["docs", "entries"]);
      const [cur, ent] = await Promise.all([req(tx.objectStore("docs").get(r.id)), req(tx.objectStore("entries").get(r.id))]);
      const own = r.tab, fresh = cur == null || stamp(r.doc) > stamp(cur);
      let ok = true;
      if (fresh) ok = await idbPut(db, r.id, r.doc, { ...r.entry, thumb: ent ? ent.thumb : null }, r.base, { own });
      else if (displaced(cur, ent, r.entry, r.doc, { at: 0 }, own)) { // not the same write or that tab's earlier save, and not an identical design: an edit nobody else has
        const c = copyOf(r.doc, r.entry, OTHER);
        if (c) { ok = await idbPut(db, c[0], c[1], c[2]); if (ok) tell(c[2].name); }
      }
      if (!ok) return; // kept for the next visit
    }
    if (ls.get(k) === raw) ls.del(k); // not if another tab wrote it meanwhile
    const del = db.transaction("meta", "readwrite");
    del.objectStore("meta").delete(k);
    await committed(del);
  }
}

const rescueOf = (id, docString, entry, base) => ({ tab: TAB, id, doc: docString, entry: { ...entry, thumb: null }, base: base == null ? null : base });
const rescueWrite = (id, docString, entry, base) => ls.set(rescueKey(id), JSON.stringify(rescueOf(id, docString, entry, base)));

// guard: after a slow open took over, the first write of each design checks the stored copy against the write's base
function idbDriver(db, guard) {
  return {
    kind: "idb",
    async list() { return (await req(db.transaction("entries").objectStore("entries").getAll())).sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
    async get(id) { const v = await req(db.transaction("docs").objectStore("docs").get(id)); return v == null ? null : v; },
    async put(id, docString, entry, base) {
      const ok = await idbPut(db, id, docString, entry, base, guard && guard.on && !guard.verified.has(id) ? { suffix: BEFORE } : {});
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
    async entry(id) { const v = await req(db.transaction("entries").objectStore("entries").get(id)); return v === undefined ? null : v; },
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
      try { const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put(rescueOf(id, docString, entry, base), rescueKey(id)); if (tx.commit) tx.commit(); } catch (e) {}
    },
  };
}

// ---------------------------------------------------------------- localStorage driver (the older way)
// localStorage has no atomic compare-and-write, so the async calls run inside one origin-wide Web Lock (without Web Locks they run
// unlocked, as before). putNow (the tab closing) cannot wait for a lock and writes straight away.
async function locked(f) {
  let ran = false;
  try { if (navigator.locks) return await navigator.locks.request(LOCK, () => { ran = true; return f(); }); } catch (e) { if (ran) throw e; }
  return f();
}
const restore = (k, v) => { if (v == null) ls.del(k); else ls.set(k, v); };
function localPut(id, docString, entry, base) {
  const before = ls.get(LS_DOC + id), index = readJSON(LS_INDEX, []);
  const old = index.find((p) => p.id === id), b = baseOf(base);
  // someone else's newer copy goes into a design of its own first; if that does not fit, nothing is touched
  const c = b && displaced(before, old, entry, docString, b) ? copyOf(before, old, OTHER) : null;
  const copyBefore = c ? ls.get(LS_DOC + c[0]) : null;
  if (c && !ls.set(LS_DOC + c[0], c[1])) return false;
  const undo = () => { restore(LS_DOC + id, before); if (c) restore(LS_DOC + c[0], copyBefore); };
  if (!ls.set(LS_DOC + id, docString)) { undo(); return false; }
  const next = [{ ...entry, id }, ...(c ? [c[2]] : []), ...index.filter((p) => p.id !== id && !(c && p.id === c[0]))];
  if (ls.set(LS_INDEX, JSON.stringify(next))) { if (c) tell(c[2].name); return true; }
  // a document with no list entry would be invisible: put back what was there
  undo();
  return false;
}
const localDriver = {
  kind: "local",
  async list() { return readJSON(LS_INDEX, []); },
  async get(id) { return ls.get(LS_DOC + id); },
  async entry(id) { return readJSON(LS_INDEX, []).find((p) => p.id === id) || null; },
  put: (id, docString, entry, base) => locked(() => localPut(id, docString, entry, base)),
  del: (id) => locked(() => {
    ls.del(LS_DOC + id);
    ls.set(LS_INDEX, JSON.stringify(readJSON(LS_INDEX, []).filter((p) => p.id !== id)));
    return true;
  }),
  async getMeta() { return null; },
  async setMeta() { return false; },
  putNow: (id, docString, entry, base) => localPut(id, docString, entry, base),
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
    tab: TAB,
    onKept: (f) => { notices.listener = f; for (const n of notices.held.splice(0)) f(n); }, // called with the name of a copy kept because another tab's version was displaced
    list: run("list", []),
    get: run("get", null),
    put: run("put", false),
    del: run("del", false, (id) => { if (slow && driver === localDriver) gone.set(id, stamp(ls.get(LS_DOC + id)) || (readJSON(LS_INDEX, []).find((p) => p.id === id) || {}).updated || 0); }),
    entry: run("entry", null), // the list entry alone (its `rev` goes with the document a tab opens)
    getMeta: run("getMeta", null), // small records kept beside the designs (IndexedDB only; the older storage has no place for them)
    setMeta: run("setMeta", false),
    // for the tab closing: no waiting, no promise
    putNow: (id, docString, entry, base) => (driver ? driver.putNow : rescueWrite)(id, docString, entry, base),
  };
}
