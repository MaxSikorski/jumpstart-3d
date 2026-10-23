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
const GONE = "workplane.gone.v1."; // a deleted design leaves a marker (until the design is written again) so a rescue copy cannot bring it back; IndexedDB: meta key GONE + id

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const readJSON = (k, d) => { try { const v = ls.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
// the save stamp: record() in projects.js writes it last, so the tail of the text has it; any other layout is parsed
const stamp = (docString) => {
  const m = typeof docString === "string" && /"_updated":(\d+)\}$/.exec(docString.slice(-48));
  if (m) return +m[1];
  try { return +JSON.parse(docString)._updated || 0; } catch (e) { return 0; }
};
const preserved = new Set(); // ids whose fallback version a merge kept as a copy (the page opened that design from the older copy)
const seen = new Map(); // id -> the `_updated` of the copy this page last read or wrote (0 = none): the base of a write that names none

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

// A version to keep as a design of its own, named "<name> <suffix>". The id comes from the design's content, so keeping the same
// content again lands on the same copy (see putCopy). Returns [id, document string, list entry], or null if it cannot be read.
function copyOf(str, ent, suffix) {
  let d = null;
  try { d = JSON.parse(str); } catch (e) {}
  if (!d || typeof d !== "object") return null;
  const { _updated, ...rest } = d, text = d.id + "|" + JSON.stringify(rest);
  const h = (seed) => { let x = seed; for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(36).padStart(7, "0"); };
  const id = "d" + h(0x811c9dc5) + h(0x9747b28c), name = (d.name || "Untitled") + " " + suffix;
  return [id, JSON.stringify({ ...d, id, name }), { ver: d.ver || 0, mode: d.mode, updated: d._updated || 0, thumb: null, ...ent, id, name }];
}
const withId = (c, id) => [id, JSON.stringify({ ...JSON.parse(c[1]), id }), { ...c[2], id }];

// the same design apart from its save stamp
function sameDesign(a, b) {
  try { const x = JSON.parse(a), y = JSON.parse(b); delete x._updated; delete y._updated; return JSON.stringify(x) === JSON.stringify(y); } catch (e) { return false; }
}

// Inside a transaction: write copy c, unless the same design is already there under its id (then it is kept as it is), or something
// else is (a copy that was edited since): then the new copy gets an id of its own.
function putCopy(docs, entries, c) {
  const g = docs.get(c[0]);
  g.onsuccess = () => {
    if (g.result != null) { if (sameDesign(g.result, c[1])) return; c = withId(c, uid("d")); }
    docs.put(c[1], c[0]);
    entries.put(c[2]);
  };
}
function idbKeep(db, c) {
  try {
    const tx = db.transaction(["docs", "entries"], "readwrite");
    putCopy(tx.objectStore("docs"), tx.objectStore("entries"), c);
    return committed(tx).then((ok) => { if (ok) tell(c[2].name); return ok; });
  } catch (e) { return Promise.resolve(false); }
}

// Notices that edits displaced another tab's version (kept as a copy). Replays at startup can raise one before projects.js listens.
const notices = { listener: null, held: [] };
const tell = (name) => { if (notices.listener) notices.listener(name); else notices.held.push(name); };

const seqOf = (rev) => +String(rev).slice(String(rev).lastIndexOf(":") + 1);
// A write's `base` is what its edits started from: { at: the `_updated` of the copy the tab read or last saved, rev: that save's `rev` }
// (a bare stamp, from an older build, counts by stamp only). With none, the page's last look at the design stands in for it ({ weak: true }, by stamp only).
// Was the stored copy replaced by someone else since, with something other than these edits? When in doubt it was: the stored copy is
// then kept. Revisions decide when both sides have one (two saves can share a millisecond); a design identical to the write never counts.
// `own`: the tab whose earlier saves are not "someone else" (this tab, or the one that wrote a replayed rescue copy).
function displaced(stored, ent, entry, docString, base, own) {
  if (stored == null) return false;
  const rev = ent && ent.rev;
  if (rev && (rev === entry.rev || rev === base.rev)) return false; // the same write again, or the copy these edits started from
  if (rev && own && rev.startsWith(own + ":")) return false;
  let hit;
  if (base.rev) hit = rev ? true : stamp(stored) !== base.at; // a save without a revision since: an older build, a restore
  else if (rev && !base.weak) hit = true; // saved by a newer build after this copy (which had no revision) was read
  else hit = stamp(stored) > base.at;
  return hit && !sameDesign(stored, docString);
}
const baseOf = (b, id) => { b = typeof b === "function" ? b() : b; return b == null ? { at: seen.get(id) || 0, weak: true } : typeof b === "object" ? b : { at: +b || 0, weak: true }; };

// The stored copy is read in the SAME transaction: if someone else saved it since (see `displaced`), it is kept first as
// "<name> <suffix>", so edits made on an older copy never replace a newer one. Both writes commit or neither.
// `rescue`: { key, raw } a rescue copy in the `meta` store that this write replays; it is deleted in the same transaction if it still holds raw.
function idbPut(db, id, docString, entry, base, { suffix = OTHER, own, rescue } = {}) {
  try {
    const tx = db.transaction(["docs", "entries", "meta"], "readwrite");
    const docs = tx.objectStore("docs"), entries = tx.objectStore("entries"), meta = tx.objectStore("meta");
    let kept = null;
    const b = baseOf(base, id), d = docs.get(id), e = entries.get(id), r = rescue ? meta.get(rescue.key) : null;
    let waiting = rescue ? 3 : 2;
    const go = () => {
      if (--waiting) return;
      try {
        const c = displaced(d.result, e.result, entry, docString, b, own) && copyOf(d.result, e.result, suffix);
        if (c) { putCopy(docs, entries, c); kept = c[2].name; }
        docs.put(docString, id); entries.put({ ...entry, id });
        meta.delete(GONE + id);
        if (rescue && JSON.stringify(r.result) === rescue.raw) meta.delete(rescue.key);
      } catch (err) { try { tx.abort(); } catch (e2) {} }
    };
    d.onsuccess = go; e.onsuccess = go; if (r) r.onsuccess = go;
    return committed(tx).then((ok) => { if (ok) seen.set(id, entry.updated || 0); if (ok && kept && suffix === OTHER) tell(kept); return ok; });
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
// design named "<name> (before fallback)"; an identical one is ignored, and so is an older one that was already there at the last merge
// (an old copy left behind); an older one that differs and was saved since (a fallback save the other copy never saw) is kept as a
// new design "<name> (before fallback)" too.
function merge(db, fp, since) {
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
      if (str != null) {
        if (sameDesign(f.str, str)) return;
        const newer = stamp(f.str) > stamp(str);
        if (!newer && stamp(f.str) <= since) return;
        const c = newer ? copyOf(str, ent, BEFORE) : copyOf(f.str, f.entry, BEFORE);
        if (c) putCopy(docs, entries, c);
        if (!newer) { preserved.add(f.id); return; }
      }
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

// Rescue copies are the edits a tab had not saved when it closed. Each one found, in localStorage or in the database's `meta` store
// (either may be missing: storage full, or the page torn down first), is replayed on its own, oldest first, and removed once its own
// replay has committed and only if it still holds the value that was read. Replaying twice changes nothing (the entry's `rev` says the
// write is already there), so a crash between the two is harmless.
// What a replay does with copy r when the stored design is cur (list entry ent): "skip" (already there, or that tab's later save is),
// "write" (r goes in; a stored version it does not descend from is kept first by the write), "copy" (r is older than what is stored and
// from elsewhere: it is kept as a design of its own).
function replayPlan(r, cur, ent) {
  if (cur == null) return "write";
  const rev = ent && ent.rev, mine = r.entry && r.entry.rev;
  if ((rev && rev === mine) || sameDesign(cur, r.doc)) return "skip";
  if (rev && r.tab && rev.startsWith(r.tab + ":")) return seqOf(mine) > seqOf(rev) ? "write" : "skip"; // that tab's own saves: the later one wins, whatever the clocks say
  return (rev && r.base && r.base.rev === rev) || stamp(r.doc) > stamp(cur) ? "write" : "copy";
}
const validRescue = (r) => r && typeof r === "object" && r.id && typeof r.doc === "string";
const byAge = (a, b) => stamp(a.r.doc) - stamp(b.r.doc) || seqOf(a.r.entry && a.r.entry.rev) - seqOf(b.r.entry && b.r.entry.rev) || 0;
const rescueKeysHere = () => { try { return Object.keys(localStorage).filter((k) => k === RESCUE || k.startsWith(RESCUE + ".")); } catch (e) { return []; } };

async function applyRescue(db) {
  const jobs = [], junk = [];
  for (const k of rescueKeysHere()) {
    const raw = ls.get(k);
    let r = null;
    try { r = JSON.parse(raw); } catch (e) {}
    (validRescue(r) ? jobs : junk).push({ where: "ls", k, raw, r });
  }
  let keys = [];
  try { keys = await req(db.transaction("meta").objectStore("meta").getAllKeys(IDBKeyRange.bound(RESCUE, RESCUE + "￿"))); } catch (e) {}
  for (const k of keys) {
    let r = null;
    try { r = await req(db.transaction("meta").objectStore("meta").get(k)); } catch (e) {}
    (validRescue(r) ? jobs : junk).push({ where: "idb", k, r, raw: JSON.stringify(r) });
  }
  for (const j of jobs.sort(byAge)) {
    const tx = db.transaction(["docs", "entries", "meta"]);
    const [cur, ent, gone] = await Promise.all([req(tx.objectStore("docs").get(j.r.id)), req(tx.objectStore("entries").get(j.r.id)), req(tx.objectStore("meta").get(GONE + j.r.id))]);
    const plan = cur == null && (gone != null || ls.get(GONE + j.r.id) != null) ? "skip" : replayPlan(j.r, cur, ent); // deleted in another tab since: the rescue copy must not bring it back
    if (plan === "write") {
      if (!await idbPut(db, j.r.id, j.r.doc, { ...j.r.entry, thumb: ent ? ent.thumb : null }, j.r.base, { own: j.r.tab, rescue: j.where === "idb" ? { key: j.k, raw: j.raw } : null })) return; // kept for the next visit
      if (j.where === "idb") continue; // removed in the write's own transaction
    }
    if (plan === "copy") { const c = copyOf(j.r.doc, j.r.entry, OTHER); if (c && !await idbKeep(db, c)) return; }
    await drop(db, j);
  }
  for (const j of junk) await drop(db, j);
}
async function drop(db, j) {
  if (j.where === "ls") { if (ls.get(j.k) === j.raw) ls.del(j.k); return; }
  try {
    const tx = db.transaction("meta", "readwrite"), m = tx.objectStore("meta"), g = m.get(j.k);
    g.onsuccess = () => { if (JSON.stringify(g.result) === j.raw) m.delete(j.k); };
    await committed(tx);
  } catch (e) {}
}

const rescueOf = (id, docString, entry, base) => ({ tab: TAB, id, doc: docString, entry: { ...entry, thumb: null }, base: base == null ? null : base });
const rescueWrite = (id, docString, entry, base) => { const k = rescueKey(id); ls.del(k); return ls.set(k, JSON.stringify(rescueOf(id, docString, entry, base))); }; // removed first: a refused write must not leave the older copy to be mistaken for the newest
// the tab closing on localStorage: the rescue copy only; if it does not fit (a second full copy of a big design next to the first), the design is written over itself instead, as before the rescue copies existed
const localNow = (id, docString, entry, base) => { if (!rescueWrite(id, docString, entry, base)) localPut(id, docString, entry, base, TAB); };

// guard: after a slow open took over, the first write of each design checks the stored copy against the write's base
function idbDriver(db, guard) {
  return {
    kind: "idb",
    async list() { return (await req(db.transaction("entries").objectStore("entries").getAll())).sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
    async get(id) { const v = await req(db.transaction("docs").objectStore("docs").get(id)); seen.set(id, v == null ? 0 : stamp(v)); return v == null ? null : v; },
    async put(id, docString, entry, base) {
      const ok = await idbPut(db, id, docString, entry, base, { own: TAB, ...(guard && guard.on && !guard.verified.has(id) ? { suffix: BEFORE } : {}) });
      if (ok && guard) guard.verified.add(id);
      return ok;
    },
    async del(id) {
      // an old copy must never come back through a merge, and an older build must not list a card with no document
      ls.del(LS_DOC + id);
      try { const raw = ls.get(LS_INDEX); if (raw) ls.set(LS_INDEX, JSON.stringify(JSON.parse(raw).filter((p) => p.id !== id))); } catch (e) {}
      seen.delete(id);
      const tx = db.transaction(["docs", "entries", "meta"], "readwrite");
      tx.objectStore("docs").delete(id);
      tx.objectStore("entries").delete(id);
      tx.objectStore("meta").put(Date.now(), GONE + id);
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
// localStorage has no atomic compare-and-write, so the calls that change it run inside one origin-wide Web Lock. Known limit: a browser
// without Web Locks (or one that refuses the lock) runs them unlocked, so two tabs saving in the same instant can still overwrite each
// other there; saving must keep working, so it is not refused. The tab closing cannot wait for a lock: it only writes a rescue copy,
// which is replayed under the lock the next time the page starts on localStorage.
async function locked(f) {
  let ran = false;
  try { if (navigator.locks) return await navigator.locks.request(LOCK, () => { ran = true; return f(); }); } catch (e) { if (ran) throw e; }
  return f();
}
const restore = (k, v) => { if (v == null) ls.del(k); else ls.set(k, v); };
function localPut(id, docString, entry, base, own) {
  const before = ls.get(LS_DOC + id), index = readJSON(LS_INDEX, []);
  const old = index.find((p) => p.id === id);
  // someone else's newer copy goes into a design of its own first; if that does not fit, nothing is touched
  let c = displaced(before, old, entry, docString, baseOf(base, id), own) ? copyOf(before, old, OTHER) : null, haveCopy = false;
  if (c) {
    const there = ls.get(LS_DOC + c[0]);
    if (there != null) { if (sameDesign(there, c[1])) haveCopy = true; else c = withId(c, uid("d")); }
  }
  const copyBefore = c ? ls.get(LS_DOC + c[0]) : null;
  if (c && !haveCopy && !ls.set(LS_DOC + c[0], c[1])) return false;
  const undo = () => { restore(LS_DOC + id, before); if (c && !haveCopy) restore(LS_DOC + c[0], copyBefore); };
  if (!ls.set(LS_DOC + id, docString)) { undo(); return false; }
  const listed = c && index.some((p) => p.id === c[0]);
  const next = [{ ...entry, id }, ...(c && !listed ? [c[2]] : []), ...index.filter((p) => p.id !== id)];
  if (ls.set(LS_INDEX, JSON.stringify(next))) { seen.set(id, entry.updated || 0); ls.del(GONE + id); if (c) tell(c[2].name); return true; }
  // a document with no list entry would be invisible: put back what was there
  undo();
  return false;
}
function localKeep(c) { // putCopy for localStorage
  const there = ls.get(LS_DOC + c[0]);
  if (there != null) { if (sameDesign(there, c[1])) return true; c = withId(c, uid("d")); }
  return localPut(c[0], c[1], c[2]);
}
// the rescue copies left by tabs closed on localStorage, under the lock; same plan as for IndexedDB
async function localReplay() {
  const jobs = [], junk = [];
  for (const k of rescueKeysHere()) {
    const raw = ls.get(k);
    let r = null;
    try { r = JSON.parse(raw); } catch (e) {}
    (validRescue(r) ? jobs : junk).push({ k, raw, r });
  }
  await locked(() => {
    for (const j of jobs.sort(byAge)) {
      const r = j.r, ent = readJSON(LS_INDEX, []).find((p) => p.id === r.id), cur = ls.get(LS_DOC + r.id),
        plan = cur == null && ls.get(GONE + r.id) != null ? "skip" : replayPlan(r, cur, ent);
      if (plan === "write" && !localPut(r.id, r.doc, { ...r.entry, thumb: ent ? ent.thumb : null }, r.base, r.tab)) return; // kept for the next visit
      if (plan === "copy") { const c = copyOf(r.doc, r.entry, OTHER); if (c && !localKeep(c)) return; if (c) tell(c[2].name); }
      if (ls.get(j.k) === j.raw) ls.del(j.k);
    }
    for (const j of junk) if (ls.get(j.k) === j.raw) ls.del(j.k);
  });
}
const localDriver = {
  kind: "local",
  async list() { return readJSON(LS_INDEX, []); },
  async get(id) { const v = ls.get(LS_DOC + id); seen.set(id, v == null ? 0 : stamp(v)); return v; },
  async entry(id) { return readJSON(LS_INDEX, []).find((p) => p.id === id) || null; },
  put: (id, docString, entry, base) => locked(() => localPut(id, docString, entry, base, TAB)),
  del: (id) => locked(() => {
    seen.delete(id);
    ls.del(LS_DOC + id);
    ls.set(LS_INDEX, JSON.stringify(readJSON(LS_INDEX, []).filter((p) => p.id !== id)));
    ls.set(GONE + id, String(Date.now()));
    return true;
  }),
  async getMeta() { return null; },
  async setMeta() { return false; },
  putNow: localNow,
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
    if ((!migrated || !sameFingerprint(migrated.fp, fp)) && !await merge(db, fp, migrated ? migrated.at : Infinity)) { db.close(); return null; }
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
    if (db === waited) { slow = true; driver = localDriver; await localReplay().catch(() => {}); return "local"; }
    if (db) db = await adopt(db);
    driver = db ? idbDriver(db) : localDriver; // no guard: not a slow open
    if (!db) await localReplay().catch(() => {});
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
    fallbackKept: (id) => preserved.has(id),
    onKept: (f) => { notices.listener = f; for (const n of notices.held.splice(0)) f(n); }, // called with the name of a copy kept because another tab's version was displaced
    list: run("list", []),
    get: run("get", null),
    put: run("put", false),
    del: run("del", false, (id) => { if (slow && driver === localDriver) gone.set(id, stamp(ls.get(LS_DOC + id)) || (readJSON(LS_INDEX, []).find((p) => p.id === id) || {}).updated || 0); }),
    entry: run("entry", null), // the list entry alone (its `rev` goes with the document a tab opens)
    getMeta: run("getMeta", null), // small records kept beside the designs (IndexedDB only; the older storage has no place for them)
    setMeta: run("setMeta", false),
    // for the tab closing: no waiting, no promise
    putNow: (id, docString, entry, base) => (driver ? driver.putNow : localNow)(id, docString, entry, base),
  };
}
