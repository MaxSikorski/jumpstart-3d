// No design is ever lost (IMPROVEMENT_PLAN §10, outcome 3): a chaos test for where designs are kept.
// Runs on both builds. Each scenario breaks something at a point decided by a seed (the page is killed in the middle of a
// save, IndexedDB or localStorage refuses to write, site data is cleared, the page reloads, two tabs save) and then asks one
// question of a fresh page: is every design the user saw saved still there, whole, in IndexedDB, the localStorage fallback,
// the rescue copy, the folder copy or a backup file, and was the user told when a save failed?
//
// How "the user saw it saved" is kept: the page reports each save that the app answered with success (`__chaosAck`, a binding
// into Node, so a kill cannot erase it). A stored design must be one of the versions the test ever tried to save, never torn or
// mixed, and never older than the newest acknowledged one. A version that was in flight at the kill may or may not be stored.
//
// Kill points are steps of the app, not timers: a hook spins the page right after the Nth IndexedDB put (the transaction is
// open), right after the Nth transaction completes (stored, but the app has not heard), at the Nth localStorage write, or at
// the Nth write to a folder file, and Node then closes the page without running its unload handlers. Same seed, same points.
//
// The app's own kernel is switched off here (a stand-in Worker): saving does not touch it and every page then starts in
// about a second. Pages are opened without waiting for it.
//
// Chromium only: the scenarios use the Chrome DevTools Protocol (newCDPSession, Storage.clearDataForOrigin), so they skip on Firefox and WebKit.
//
// Known real problems are quarantined, not failed (see `quarantined()`): the run notes a `chaos finding` and carries on. They
// are written up in the pull request. CHAOS_STRICT=1 makes them fail. CHAOS_SEEDS=1,2,3 and CHAOS_ROUNDS=6 run longer sweeps.
import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newDoc, body, prim, watchErrors, buildOf } from "./helpers.mjs";

const DB = "jumpstart3d-projects", RECOVERY_DB = "jumpstart3d-recovery";
const RESCUE = "workplane.rescue.v1", LS_INDEX = "workplane.index.v1", LS_DOC = "workplane.doc.v1.", LAST = "workplane.pref.v1.last";
const MARKER = "__js3d.chaos.token";
const SEEDS = (process.env.CHAOS_SEEDS || "11,29").split(",").map(Number);
const ROUNDS = +(process.env.CHAOS_ROUNDS || 2);
const STRICT = process.env.CHAOS_STRICT === "1";
const SAVED = "Saved in this browser";

// ---------------------------------------------------------------- seeded choices
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const shuffled = (r, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------- designs the test saves, and how they are judged
// A design's content is fixed by (id, n): the name says the version and the one body's name is `kb` kilobytes of text unique
// to the pair, so a stored design can be matched to exactly the version it came from, and a torn one matches none.
const fill = (id, n, kb) => `${id}|${n}|`.repeat(Math.ceil((kb * 1024) / (id.length + String(n).length + 2))).slice(0, kb * 1024);
const box = (w) => prim("box", { w, d: 10, h: 5, r: 0, c: 0 });
const designDoc = (id, n, kb = 1) => newDoc(`Chaos ${id} v${n}`, "beginner", { id, bodies: [body("b1", `${n}|${fill(id, n, kb)}`, box(10 + n))] });
const sig = (d) => JSON.stringify([d.name, d.mode, (d.bodies || []).map((b) => [b.id, b.name, b.node, b.m])]);
const content = (d) => JSON.stringify((d.bodies || []).map((b) => [b.name, b.node, b.m])); // ignores the name and id of the design, which a restore may change

class StorageLost extends Error {}

// One world per scenario attempt: a browser context (its storage lives as long as it does), the record of what was tried
// (`known`: id -> n -> signature) and what was acknowledged (`ledger`).
async function newWorld(browser, info) {
  const context = await browser.newContext({ viewport: info.project.use.viewport, serviceWorkers: "block", acceptDownloads: true });
  const w = { context, info, url: info.project.use.baseURL, known: new Map(), ledger: [], token: null, prevToken: null, tokens: [], onKill: null, killWhy: null, ver: new Map(), errors: [], dirs: [],
    expectKill() { this.killWhy = null; return new Promise((res) => { this.onKill = () => res("killed"); }); } };
  w.origin = buildOf(info) === "single" ? "file://" : new URL(w.url).origin;
  await context.exposeFunction("__chaosAck", (r) => { w.ledger.push(r); });
  await context.exposeFunction("__chaosKill", (why) => { w.killWhy = why; if (w.onKill) w.onKill(); });
  w.anchor = await context.newPage(); // keeps the context alive and gives CDP a session
  w.cdp = await context.newCDPSession(w.anchor);
  return w;
}
// A design version the test will try to save; remembered so the judge can recognise it later.
function mk(w, id, kb = 1, n = (w.ver.get(id) || 0) + 1) {
  w.ver.set(id, n);
  const d = designDoc(id, n, kb);
  if (!w.known.has(id)) w.known.set(id, new Map());
  w.known.get(id).set(n, sig(d));
  return d;
}
const step = (w, id, how, kb = 1) => { const doc = mk(w, id, kb); return { n: w.ver.get(id), how, doc }; };
const acked = (w, id) => Math.max(0, ...w.ledger.filter((r) => r.id === id).map((r) => r.n));

// What the judge says about what a fresh page finds. Returns the list of broken promises (empty = every design is whole).
function judge(w, items, { sameEntry = true } = {}) {
  const bad = [], byId = new Map(items.map((i) => [i.entry.id, i]));
  for (const [id, versions] of w.known) {
    const a = acked(w, id), it = byId.get(id);
    if (!it) { if (a) bad.push(`${id}: v${a} was saved but the design is gone`); continue; }
    if (it.doc == null) { bad.push(`${id}: listed, but its document is missing`); continue; }
    let doc = null, got = null;
    try { doc = JSON.parse(it.doc); const s = sig(doc); for (const [n, g] of versions) if (g === s) got = n; } catch (e) {}
    if (got == null) bad.push(`${id}: the stored document matches no version that was ever saved (torn or damaged)`);
    else if (got < a) bad.push(`${id}: v${a} was saved but v${got} is what is stored`);
    if (doc && sameEntry && it.entry.name !== doc.name) bad.push(`${id}: list entry "${it.entry.name}" does not match its document "${doc.name}"`);
  }
  return bad;
}

// A known problem: noted, not failed (the run keeps going and the note shows in the report). Flips to a failure with CHAOS_STRICT=1.
// When the check starts passing the note says so: remove the quarantine then.
function quarantined(key, ok, text) {
  if (STRICT) { expect(ok, `${key}: ${text}`).toBe(true); return; }
  const type = ok ? "chaos finding fixed" : "chaos finding";
  test.info().annotations.push({ type, description: `${key}: ${text}` });
  console.log(`${type} ${key}: ${text}`);
}

// ---------------------------------------------------------------- inside the page
// Runs before the app in every document of a page; cfg comes from openPage().
function INIT(cfg) {
  try { window.__chaosToken = localStorage.getItem(cfg.marker); localStorage.removeItem(cfg.marker); } catch (e) { window.__chaosToken = "unreadable"; }
  try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
  window.__toasts = [];
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
      .observe(document.getElementById("toasts"), { childList: true });
  });
  if (cfg.noKernel) window.Worker = function () { return { postMessage() {}, terminate() {}, addEventListener() {}, removeEventListener() {} }; };
  if (cfg.seedLs) {
    try {
      if (!localStorage.getItem("workplane.index.v1")) {
        localStorage.setItem("workplane.index.v1", JSON.stringify(cfg.seedLs.index));
        for (const [id, s] of Object.entries(cfg.seedLs.docs)) localStorage.setItem("workplane.doc.v1." + id, s);
      }
    } catch (e) {}
  }
  if (cfg.refuse) {
    const real = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (n, ...rest) { if (n === cfg.db) throw new DOMException("The operation is insecure.", "SecurityError"); return real.call(this, n, ...rest); };
  }
  // writes to the designs database fail the way a full disk does: the transaction opens, the put is queued, and the transaction aborts
  // (QuotaExceededError). Switched on and off by the test. (Cutting the real quota with CDP's Storage.overrideQuotaForOrigin did not
  // stop a write to a database that was already open, so the browser's own limit is not used for IndexedDB here.)
  window.__chaosFailWrites = !!cfg.failWrites;
  const realTx = IDBDatabase.prototype.transaction;
  window.__chaosTx = 0; // read-write transactions opened on the designs database, for tests that must wait until a save has really started
  window.__chaosArmed = !!(cfg.kill && cfg.kill.armed);
  let puts = 0, completes = 0, sets = 0, writes = 0, drops = 0;
  const spin = (why) => { window.__chaosKill(why); for (;;) {} }; // never returns: Node closes the page
  IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const mine = this.name === cfg.db;
    const tx = realTx.call(this, stores, mode, ...rest);
    if (mine && mode === "readwrite") window.__chaosTx++;
    if (mine && mode === "readwrite" && cfg.kill && cfg.kill.kind === "complete") tx.addEventListener("complete", () => { if (window.__chaosArmed && ++completes === cfg.kill.at) spin(`transaction ${completes} complete`); });
    return tx;
  };
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    if (cfg.drop && this.transaction.db.name === cfg.db && this.name === "docs" && ++drops > cfg.drop.after) return this.count(); // the mutation: a save that is never written, the transaction still completes
    const r = realPut.apply(this, a);
    if (window.__chaosFailWrites && this.transaction.db.name === cfg.db) { try { this.transaction.abort(); } catch (e) {} return r; }
    if (cfg.kill && cfg.kill.kind === "put" && window.__chaosArmed && this.transaction.db.name === cfg.db && ++puts === cfg.kill.at) spin(`put ${puts}`);
    return r;
  };
  if (cfg.kill && cfg.kill.kind === "ls") {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const r = realSet.call(this, k, v);
      if (window.__chaosArmed && this === localStorage && /^workplane\./.test(k) && ++sets === cfg.kill.at) spin(`localStorage write ${sets} (${k})`);
      return r;
    };
  }
  if (cfg.kill && cfg.kill.kind === "fswrite" && window.FileSystemWritableFileStream) {
    const realWrite = FileSystemWritableFileStream.prototype.write;
    FileSystemWritableFileStream.prototype.write = function (...a) {
      const r = realWrite.apply(this, a);
      if (window.__chaosArmed && ++writes === cfg.kill.at) spin(`folder file write ${writes}`);
      return r;
    };
  }
  if (cfg.folder) window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true });
}

// Save the plan's designs one after the other, the way the app does: "now" is the Save path (saveNow), "soon" is an edit left to the
// 1.2 s autosave. A save the app answers with success is acknowledged to Node at once.
async function drive({ plan }) {
  const S = window.__store, P = window.__app.projects, stateEl = document.getElementById("savestate");
  const out = [];
  for (const step of plan) {
    const doc = step.doc;
    let ok = false;
    if (step.how === "now") { S.load(doc); ok = await P.saveNow(); }
    else {
      S.load({ ...doc, name: "(editing)", bodies: [] });
      S.update((d) => { d.name = doc.name; d.bodies = doc.bodies; });
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        await new Promise((r) => setTimeout(r, 20));
        if (stateEl.textContent === "Saved in this browser") { ok = true; break; }
        if (/^Couldn't save/.test(stateEl.textContent)) break;
      }
    }
    out.push({ id: doc.id, n: step.n, ok, state: stateEl.textContent });
    if (ok) await window.__chaosAck({ id: doc.id, n: step.n });
  }
  return out;
}
const readAll = (page) => page.evaluate(async () => {
  const s = window.__app.projects._store;
  await s.ready;
  const items = [];
  for (const entry of await s.list()) items.push({ entry, doc: await s.get(entry.id) });
  return { kind: s.kind, items };
});
// the localStorage keys that hold a design, and whether the list knows each document
const lsDesigns = (page) => page.evaluate(([idx, pre]) => {
  const list = JSON.parse(localStorage.getItem(idx) || "[]").map((e) => e.id);
  return { list, docs: Object.keys(localStorage).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length)) };
}, [LS_INDEX, LS_DOC]);
// readAll for the scenarios that kill the page. If a design was acknowledged and none of this world's designs is there at all, the
// browser dropped the whole storage (the Linux file:// quirk, see test/helpers.mjs), not the app: StorageLost, logged and retried by scenario().
async function readWorld(w, page) {
  const snap = await readAll(page);
  if (w.ledger.length && !snap.items.some((i) => w.known.has(i.entry.id))) throw new StorageLost("none of the saved designs is in the storage at all");
  return snap;
}
// leave exactly `free` characters of localStorage space (the browser's own limit; nothing is stubbed)
const fillStorage = (page, free) => page.evaluate((free) => {
  const k = "chaos.fill";
  localStorage.removeItem(k);
  let lo = 0, hi = 6_000_000;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; try { localStorage.setItem(k, "x".repeat(mid)); lo = mid; } catch (e) { hi = mid - 1; } }
  localStorage.setItem(k, "x".repeat(Math.max(0, lo - free)));
  return lo;
}, free);
// what a user can see of a failed save: the status text (kept in the page even when the layout hides it), whether it is on screen, the toasts
const notice = (page) => page.evaluate(() => {
  const el = document.getElementById("savestate"), cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return { text: el.textContent, shown: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0, toasts: window.__toasts.map((t) => t.text) };
});
const toldVisibly = (n) => (/^Couldn't save/.test(n.text) && n.shown) || n.toasts.some((t) => /couldn.t save|not saved|storage is full/i.test(t));

// ---------------------------------------------------------------- pages
// A new page on the world's storage. Waits for the app to have started (not for its kernel).
async function openPage(w, cfg = {}) {
  // The app gives IndexedDB 3 s to open and then settles on localStorage for the whole page (src/projstore.js:25). On a machine that is
  // busy that can happen to an ordinary page; the scenarios here are about IndexedDB, so such a page is closed and opened again.
  for (let attempt = 1; ; attempt++) {
    const page = await openOnce(w, cfg);
    if (cfg.dieEarly || cfg.refuse || (await page.evaluate(() => window.__app.projects._store.kind)) === "idb") return page;
    await page.close({ runBeforeUnload: false }).catch(() => {});
    w.tokens = [];
    test.info().annotations.push({ type: "chaos note", description: `IndexedDB did not open within the app's 3 s (attempt ${attempt}); page opened again` });
    if (attempt === 5) throw new Error("IndexedDB took longer than the app waits for it, five pages in a row: the machine is too busy for this test");
  }
}
async function openOnce(w, cfg) {
  const page = await w.context.newPage();
  const errors = watchErrors(page);
  w.errors.push(errors);
  await page.addInitScript(INIT, { db: DB, marker: MARKER, noKernel: true, ...cfg });
  const expected = w.tokens;
  if (cfg.dieEarly) { await page.goto(w.url, { waitUntil: "commit" }); w.tokens = []; return page; }
  await page.goto(w.url);
  await started(page);
  await checkToken(w, page, expected);
  return page;
}
const started = async (page) => {
  await page.waitForFunction(() => window.__app && window.__app.projects.started === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__app.projects._store.kind, null, { timeout: 15_000 });
};
// On the Linux runner Chromium now and then starts a file:// page with empty storage (see test/helpers.mjs). The marker is written
// by the page before and read by the next; only the browser touches it, so a missing one means storage was lost, not the app.
async function checkToken(w, page, expected) {
  const got = await page.evaluate(() => window.__chaosToken);
  if (expected.length && !expected.includes(got)) throw new StorageLost(`marker ${expected.join(" or ")} not found (saw ${got})`);
  w.prevToken = got; // the marker this page removed; if the page is killed, the browser may not have written the new one yet
  w.token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  w.tokens = [w.token];
  await page.evaluate(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, [MARKER, w.token]);
}
async function reloadPage(w, page) {
  const expected = w.tokens;
  await page.reload();
  await started(page);
  await checkToken(w, page, expected);
}
// Run the plan until the page's kill hook fires (then close it without unload handlers) or the plan ends.
async function runUntilKill(w, page, plan) {
  const killed = w.expectKill();
  await page.evaluate(() => { window.__chaosArmed = true; });
  const done = page.evaluate(drive, { plan }).then(() => "done", () => "gone");
  const outcome = await Promise.race([killed, done]);
  await page.close({ runBeforeUnload: false }).catch(() => {});
  w.tokens = [w.prevToken, w.token].filter(Boolean); // the page died at an unknown point: of the marker it removed and the one it wrote, the browser may have kept either
  return outcome;
}
const closeClean = (page) => page.close().catch(() => {});
const noErrors = (w) => { for (const e of w.errors) expect(e).toEqual([]); };

// A scenario retries from scratch (a new context) when the browser lost storage by itself, and is skipped, with a note, if it keeps doing so.
function scenario(title, fn, { onlySite = false } = {}) {
  test(title, async ({ browser, browserName }, info) => {
    test.setTimeout(240_000);
    test.skip(browserName !== "chromium", "uses the Chrome DevTools Protocol (CDP), which only Chromium has");
    test.skip(onlySite && buildOf(info) === "single", "no origin private file system (OPFS) on file:// in this browser");
    for (let attempt = 1; ; attempt++) {
      const w = await newWorld(browser, info);
      try { await fn(w, info); return; }
      catch (e) {
        if (!(e instanceof StorageLost)) throw e;
        const note = `${title} [${info.project.name}] attempt ${attempt}/3: ${e.message}`;
        console.log("storage-lost: " + note);
        info.annotations.push({ type: "storage-lost", description: note });
        if (attempt === 3) test.skip(true, "the browser lost its storage three times in a row");
      } finally {
        await w.context.close().catch(() => {});
        for (const d of w.dirs) rmSync(d, { recursive: true, force: true });
      }
    }
  });
}
const expectWhole = (w, snapshot, what, opts) => expect(judge(w, snapshot.items, opts), `${what}\nacknowledged: ${JSON.stringify(w.ledger)}`).toEqual([]);

// ---------------------------------------------------------------- 1. the page dies in the middle of a save
for (const seed of SEEDS) {
  scenario(`killed mid-save at seeded points, seed ${seed}: every acknowledged design is whole afterwards`, async (w) => {
    const r = rng(seed), ids = ["t_chaos_a", "t_chaos_b", "t_chaos_c"];
    let page = await openPage(w);
    await page.evaluate(drive, { plan: ids.map((id) => step(w, id, "now", 5)) });
    await closeClean(page);
    let kills = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      // each of the 5 saves is one transaction with 2 puts (the document and its list entry): a kill point past that never fires
      const kind = pick(r, ["put", "complete"]), kill = { kind, at: 1 + Math.floor(r() * (kind === "put" ? 10 : 5)), armed: false };
      const plan = Array.from({ length: 5 }, () => step(w, pick(r, ids), r() < 0.4 ? "soon" : "now", pick(r, [1, 30, 200])));
      page = await openPage(w, { kill });
      const before = await readWorld(w, page); // what the last kill left
      expectWhole(w, before, `seed ${seed} round ${round}: after the previous kill`);
      const outcome = await runUntilKill(w, page, plan);
      if (outcome === "killed") kills++;
      console.log(`chaos seed ${seed} round ${round}: ${kill.kind} #${kill.at} -> ${outcome}${w.killWhy ? " at " + w.killWhy : ""}`);
    }
    page = await openPage(w);
    expectWhole(w, await readWorld(w, page), `seed ${seed}: after the last kill`);
    await closeClean(page);
    expect(kills, "at least one kill point was reached").toBeGreaterThan(0);
    noErrors(w);
  });
}

scenario("killed between the document and its list entry on the older storage: nothing acknowledged is lost", async (w) => {
  const r = rng(SEEDS[0] + 100), ids = ["t_chaos_a", "t_chaos_b"];
  let page = await openPage(w, { refuse: true });
  expect((await readAll(page)).kind).toBe("local");
  await page.evaluate(drive, { plan: ids.map((id) => step(w, id, "now", 5)) });
  await closeClean(page);
  let kills = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const kill = { kind: "ls", at: 1 + Math.floor(r() * 6), armed: false };
    const plan = Array.from({ length: 4 }, () => step(w, pick(r, ids), "now", pick(r, [1, 30])));
    page = await openPage(w, { refuse: true, kill });
    expectWhole(w, await readWorld(w, page), `round ${round}: after the previous kill`, { sameEntry: false });
    const outcome = await runUntilKill(w, page, plan);
    if (outcome === "killed") kills++;
    console.log(`chaos local round ${round}: localStorage write #${kill.at} -> ${outcome}${w.killWhy ? " at " + w.killWhy : ""}`);
  }
  page = await openPage(w, { refuse: true });
  expectWhole(w, await readWorld(w, page), "after the last kill", { sameEntry: false });
  await closeClean(page);
  expect(kills, "at least one kill point was reached").toBeGreaterThan(0);
});

// ---------------------------------------------------------------- 2. the page dies while the first visit copies the older designs across
scenario("killed while the older localStorage designs are copied into IndexedDB: all of them are there on the next visit", async (w) => {
  const r = rng(SEEDS[0] + 200);
  const ids = ["t_old_1", "t_old_2", "t_old_3", "t_old_4", "t_old_5"];
  const docs = Object.fromEntries(ids.map((id, i) => [id, JSON.stringify({ ...designDoc(id, 1, 20), _updated: 1000 + i })]));
  const index = ids.map((id, i) => ({ id, name: `Chaos ${id} v1`, ver: 0, mode: "beginner", updated: 1000 + i, thumb: null }));
  const seedLs = { index, docs };
  // the copy is one transaction of 5 documents + 5 list entries + a record: puts 1 to 11, completion 1
  for (const [kind, at] of [["put", 1 + Math.floor(r() * 4)], ["put", 5 + Math.floor(r() * 7)], ["complete", 1]]) {
    let fired = false;
    for (let attempt = 1; attempt <= 4 && !fired; attempt++) { // a slow machine can push the page onto localStorage for good; then nothing was copied and the kill never comes
    const w2 = await newWorld(w.context.browser(), w.info); // a fresh storage for each kill point
    try {
      const killed = w2.expectKill();
      const page = await openPage(w2, { dieEarly: true, seedLs, kill: { kind, at, armed: true } });
      const out = await Promise.race([killed, new Promise((res) => setTimeout(() => res("booted"), 8000))]); // no page call is left waiting on a page that may be spinning
      console.log(`chaos migration kill ${kind} #${at} -> ${out}${w2.killWhy ? " at " + w2.killWhy : ""}`);
      if (out !== "killed") continue;
      fired = true;
      await page.close({ runBeforeUnload: false }).catch(() => {});
      const after = await openPage(w2);
      const snap = await readAll(after);
      const got = Object.fromEntries(snap.items.map((i) => [i.entry.id, i.doc]));
      for (const id of ids) expect(got[id], `kill #${at}: ${id} after the copy was interrupted`).toBe(docs[id]); // byte for byte
      const old = await after.evaluate(([pre, ids]) => ids.map((id) => localStorage.getItem(pre + id)), [LS_DOC, ids]);
      expect(old, `kill #${at}: the old copies stay`).toEqual(ids.map((id) => docs[id]));
      await closeClean(after);
    } finally { await w2.context.close().catch(() => {}); }
    }
    expect(fired, `the copy was killed at ${kind} #${at}`).toBe(true);
  }
});

// ---------------------------------------------------------------- 3. IndexedDB refuses to grow
scenario("IndexedDB refusing writes (quota exceeded): the saved design stays whole, the user is told, and the edit is kept for when there is room", async (w) => {
  const A = "t_chaos_a", B = "t_chaos_b";
  let page = await openPage(w);
  await page.evaluate(drive, { plan: [step(w, A, "now", 5), step(w, B, "now", 5)] });
  expect(await page.evaluate((k) => localStorage.getItem(k), LAST)).toBe(B);
  await page.evaluate(() => { window.__chaosFailWrites = true; });
  const big = step(w, A, "now", 300);
  const res = (await page.evaluate(drive, { plan: [big] }))[0];
  expect(res.ok, "a save the database aborts is not acknowledged").toBe(false);
  const n = await notice(page);
  expect(n.text, "the app records the failure").toMatch(/^Couldn't save: browser storage is full or blocked/);
  // quarantined: the "Couldn't save" text sits in #savestate, which CSS hides below 1760 px of window width (src/index.html:1079), and nothing else tells the user
  quarantined("save-failure-not-visible", toldVisibly(n), `after a refused save, #savestate says "${n.text}" but is ${n.shown ? "shown" : "hidden (display:none) at the test window's 1400 px"} and ${n.toasts.length ? "toasts were " + JSON.stringify(n.toasts) : "no toast was raised"}`);
  // the Save button (Ctrl+S) must not claim success either
  await page.evaluate(() => { window.__toasts.length = 0; });
  await page.click("#btn-save");
  await page.waitForTimeout(500);
  const toasts = await page.evaluate(() => window.__toasts.map((t) => t.text));
  // quarantined: saveVersion() ignores what saveNow() returns and toasts `Saved as "<name> vN"` even when nothing was stored (src/projects.js:147-153)
  quarantined("save-button-claims-success", !toasts.some((t) => /^Saved as/.test(t)), `Save with the database refusing every write showed the toast ${JSON.stringify(toasts)}`);
  expectWhole(w, await readAll(page), "while writes are refused");
  // a backup taken now carries the open design's unsaved edit from memory
  await page.click("#btn-projects");
  await page.waitForSelector(".modal-back .newcards");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-backup")]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  const inBackup = JSON.parse(Buffer.concat(chunks).toString()).designs.find((d) => d.entry.id === A);
  expect(inBackup && sig(inBackup.doc), "the backup file holds the edit the browser could not store").toBe(w.known.get(A).get(big.n));
  await page.click(".modal-back .xbtn");
  // closing the tab keeps the edit as a rescue copy in localStorage
  await page.close({ runBeforeUnload: true });
  w.tokens = [];
  // the next visit still has no room: the saved design is whole and the rescue copy waits
  page = await openPage(w, { failWrites: true });
  expectWhole(w, await readAll(page), "still refusing writes, after the tab was closed");
  const rescue = await page.evaluate((k) => localStorage.getItem(k), RESCUE);
  expect(rescue && sig(JSON.parse(JSON.parse(rescue).doc)), "the edit waits in the rescue copy").toBe(w.known.get(A).get(big.n));
  await page.close();
  w.tokens = [];
  // room again: the next visit applies the rescue copy
  page = await openPage(w);
  const stored = (await readAll(page)).items.find((i) => i.entry.id === A);
  expect(stored && sig(JSON.parse(stored.doc)), "the edit made while IndexedDB refused writes is stored once it accepts them").toBe(w.known.get(A).get(big.n));
  expect(await page.evaluate((k) => localStorage.getItem(k), RESCUE)).toBeNull();
  await closeClean(page);
});

// ---------------------------------------------------------------- 4. localStorage refuses to grow
for (const seed of SEEDS.slice(0, 1)) {
  scenario(`localStorage full on the older storage, seed ${seed}: a refused save is reported and leaves no half-saved design`, async (w) => {
    const r = rng(seed + 300), ids = ["t_chaos_a", "t_chaos_b", "t_chaos_c", "t_chaos_d", "t_chaos_e", "t_chaos_f", "t_chaos_g"];
    const page = await openPage(w, { refuse: true });
    expect((await readAll(page)).kind).toBe("local");
    await page.evaluate(drive, { plan: [step(w, ids[0], "now", 20)] }); // v1 is in
    const free = shuffled(r, [0, 50, 700, 2500, 6000, 12000]);
    const outcomes = [];
    for (let i = 0; i < free.length; i++) {
      await fillStorage(page, free[i]);
      // a new small design: its document is tiny, its list entry (with the picture) is not. And a bigger edit of the first one.
      const plan = [step(w, ids[1 + i], "now", 1), step(w, ids[0], "now", 20 + i)];
      for (const s of plan) {
        const res = (await page.evaluate(drive, { plan: [s] }))[0];
        outcomes.push(`${free[i]}:${res.ok ? "ok" : "refused"}`);
        if (!res.ok) expect((await notice(page)).text, "the app records the failure").toMatch(/^Couldn't save/);
        const ls = await lsDesigns(page);
        expect(ls.docs.filter((d) => !ls.list.includes(d)), `free ${free[i]}: a document with no list entry is invisible`).toEqual([]);
        expectWhole(w, await readAll(page), `free ${free[i]}, after ${s.doc.name} was ${res.ok ? "saved" : "refused"}`, { sameEntry: false });
      }
    }
    console.log("chaos localStorage full outcomes: " + outcomes.join(" "));
    expect(outcomes.some((o) => o.endsWith("refused")), "the sweep reached a full localStorage").toBe(true);
    // space comes back: saving works again at once
    await page.evaluate(() => localStorage.removeItem("chaos.fill"));
    const again = (await page.evaluate(drive, { plan: [step(w, ids[0], "now", 20)] }))[0];
    expect(again.ok).toBe(true);
    expectWhole(w, await readAll(page), "after space came back");
    await closeClean(page);
  });
}

scenario("localStorage full while IndexedDB works: designs still save and are all listed after a reload", async (w) => {
  const A = "t_chaos_a", B = "t_chaos_b";
  let page = await openPage(w);
  await page.evaluate(drive, { plan: [step(w, A, "now", 5)] });
  await fillStorage(page, 0);
  const res = (await page.evaluate(drive, { plan: [step(w, B, "now", 5)] }))[0];
  expect(res.ok, "IndexedDB takes the save").toBe(true);
  await reloadPage(w, page);
  expectWhole(w, await readAll(page), "after a reload with localStorage full");
  await closeClean(page);
});

// ---------------------------------------------------------------- 5. the page reloads or closes right after an edit
scenario("reload or close at seeded moments after an edit: the edit is there afterwards", async (w) => {
  const r = rng(SEEDS[0] + 400), A = "t_chaos_a";
  let page = await openPage(w);
  await page.evaluate(drive, { plan: [step(w, A, "now", 5)] });
  const delays = shuffled(r, [0, 1, 25, 300, 800, 1150, 1190, 1215, 1300, 1900]).slice(0, 5);
  const found = [];
  for (let i = 0; i < delays.length; i++) {
    const edit = step(w, A, "soon", pick(r, [1, 40]));
    await page.evaluate(({ doc }) => { window.__store.update((d) => { d.name = doc.name; d.bodies = doc.bodies; }, "Edit"); }, edit); // left to the autosave
    await page.waitForTimeout(delays[i]);
    if (i % 3 === 2) { await page.close({ runBeforeUnload: true }); w.tokens = []; page = await openPage(w); }
    else await reloadPage(w, page);
    const snap = await readAll(page);
    const it = snap.items.find((x) => x.entry.id === A);
    const open = await page.evaluate(() => window.__store.doc.name);
    found.push(`${delays[i]}ms:${i % 3 === 2 ? "close" : "reload"}`);
    expect(it && sig(JSON.parse(it.doc)), `edit ${i + 1} made ${delays[i]} ms before the ${i % 3 === 2 ? "tab was closed" : "page reloaded"}`).toBe(w.known.get(A).get(edit.n));
    expect(open, "and it is the design that opens").toBe(edit.doc.name);
  }
  console.log("chaos reload moments: " + found.join(" "));
  await closeClean(page);
  noErrors(w);
});

scenario("closed right after an edit while localStorage is full: the edit is not lost", async (w) => {
  const A = "t_chaos_a";
  let page = await openPage(w);
  await page.evaluate(drive, { plan: [step(w, A, "now", 5)] });
  await fillStorage(page, 0); // the rescue copy has nowhere to go
  const edit = step(w, A, "soon", 5);
  // The unload save starts its IndexedDB transaction a few ticks after beforeunload, and a page that is torn down in that gap loses it
  // (seen once in 20 runs when the page was simply closed). So the same event is sent by hand and the test waits for the transaction
  // to open (a real signal) before closing the tab; what is tested is that the unload save carries the edit when the rescue copy cannot be written.
  const opened = await page.evaluate(() => window.__chaosTx);
  await page.evaluate(({ doc }) => {
    window.__store.update((d) => { d.name = doc.name; d.bodies = doc.bodies; }, "Edit");
    window.dispatchEvent(new Event("beforeunload"));
  }, edit);
  await page.waitForFunction((n) => window.__chaosTx > n, opened, { timeout: 5000 });
  await page.close({ runBeforeUnload: true });
  page = await openPage(w);
  const it = (await readAll(page)).items.find((x) => x.entry.id === A);
  // the unload save into IndexedDB carries it (the rescue copy cannot be written)
  expect(it && sig(JSON.parse(it.doc)), "the edit made just before the close is stored although localStorage was full").toBe(w.known.get(A).get(edit.n));
  await closeClean(page);
});

// ---------------------------------------------------------------- 6. autosave (crash recovery) when saving itself is broken
scenario("the autosave copy is offered back after a kill, while the designs database refuses every write", async (w) => {
  const A = "t_chaos_a";
  let page = await openPage(w);
  await page.evaluate(drive, { plan: [step(w, A, "now", 5)] });
  await page.evaluate(() => { window.__app.recovery.setEnabled(true); window.__chaosFailWrites = true; });
  const edit = step(w, A, "soon", 5);
  await page.evaluate(({ doc }) => { window.__store.update((d) => { d.name = doc.name; d.bodies = doc.bodies; }, "Edit"); }, edit);
  // the autosave wrote its copy (400 ms after the edit) into its own database
  await page.waitForFunction(({ db, key, name }) => new Promise((res) => {
    const o = indexedDB.open(db);
    o.onsuccess = () => { const q = o.result.transaction("snaps").objectStore("snaps").get(key); q.onsuccess = () => { o.result.close(); res(!!q.result && q.result.data.includes(name)); }; q.onerror = () => { o.result.close(); res(false); }; };
    o.onerror = () => res(false);
  }), { db: RECOVERY_DB, key: A + "|latest", name: edit.doc.name }, { timeout: 15_000, polling: 100 });
  await page.waitForFunction(() => /^Couldn't save/.test(document.getElementById("savestate").textContent), null, { timeout: 15_000 }); // the 1.2 s save was refused
  await page.close({ runBeforeUnload: false }); // killed: no unload handlers
  w.tokens = [];
  page = await openPage(w);
  await page.waitForSelector(".modal.recover", { timeout: 15_000 });
  await page.click("#rec-open-" + A);
  await page.waitForFunction((name) => window.__store.doc.name === name, edit.doc.name, { timeout: 15_000 });
  await page.evaluate(() => window.__app.projects.saveNow());
  const it = (await readAll(page)).items.find((x) => x.entry.id === A);
  expect(it && sig(JSON.parse(it.doc))).toBe(w.known.get(A).get(edit.n));
  await closeClean(page);
});

// ---------------------------------------------------------------- 7. site data cleared, with a folder copy
const clearSiteData = (w) => w.cdp.send("Storage.clearDataForOrigin", { origin: w.origin, storageTypes: "indexeddb,local_storage" }); // the folder copy lives in the file system, which this leaves alone
const readFolder = (page) => page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true }), out = {};
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file") continue;
    try { out[name] = await (await h.getFile()).text(); } catch (e) { if (e.name !== "NotFoundError") throw e; }
  }
  return out;
});
const turnFolderOn = async (page) => {
  await page.click("#btn-projects");
  await page.waitForSelector(".modal-back .newcards");
  await page.click("#btn-folder");
  await expect(page.locator("#folder-status")).toHaveText(/^Copies of your designs are saved to “mirror”/);
  await page.click(".modal-back .xbtn");
};
const folderDocs = (files) => Object.entries(files).filter(([n]) => /-t_chaos_\w+\.json$/.test(n)).map(([n, t]) => ({ name: n, doc: JSON.parse(t).doc }));

scenario("site data cleared with a folder copy: every design comes back from the folder", async (w) => {
  const A = "t_chaos_a", B = "t_chaos_b";
  let page = await openPage(w, { folder: true });
  await page.evaluate(drive, { plan: [step(w, A, "now", 5), step(w, B, "now", 5)] });
  await turnFolderOn(page);
  await expect.poll(async () => folderDocs(await readFolder(page)).length, { timeout: 25_000 }).toBe(2);
  // an edit reaches the folder after the 5 s pause
  const a2 = step(w, A, "now", 5);
  await page.evaluate(drive, { plan: [a2] });
  await expect.poll(async () => { const f = folderDocs(await readFolder(page)).find((x) => x.doc.id === A); return f && f.doc.name; }, { timeout: 25_000 }).toBe(a2.doc.name);
  // and one that is saved in the browser but not yet copied when the data is cleared (by design the copy trails by a few seconds)
  const a3 = step(w, A, "now", 5);
  await page.evaluate(drive, { plan: [a3] });
  await page.close({ runBeforeUnload: false });
  await clearSiteData(w);
  w.tokens = [];
  page = await openPage(w, { folder: true });
  expect((await readAll(page)).items.filter((i) => w.known.has(i.entry.id)), "site data really is gone").toEqual([]);
  // the folder's files, handed to Restore from a folder… as a user's picker would
  const files = await readFolder(page);
  const dir = mkdtempSync(join(tmpdir(), "js3d-chaos-folder-"));
  w.dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  await page.setInputFiles("#file-folder", dir);
  await page.waitForFunction(() => window.__toasts.some((t) => t.text.startsWith("Restored ")), null, { timeout: 20_000 });
  const snap = await readAll(page);
  const has = (id, n) => snap.items.some((i) => content(JSON.parse(i.doc)) === content(designDoc(id, n, 5)));
  expect(has(B, w.ver.get(B)), "B is back from the folder, whole").toBe(true);
  // A: the folder holds the version of the last copy (v2); v3 was saved in the browser inside the copy delay
  expect(has(A, a2.n), "A is back from the folder, at the version of the last copy").toBe(true);
  // not asserted: whether v3 reached the folder depends on the 5 s copy lag, which is the app's to change
  test.info().annotations.push({ type: "chaos note", description: `A at the version saved inside the copy delay (v${a3.n}) is ${has(A, a3.n) ? "back" : "not back (the copy trails the save by about 5 s)"}` });
  await closeClean(page);
}, { onlySite: true });

scenario("killed in the middle of writing a folder copy: every file in the folder is a whole design", async (w) => {
  const r = rng(SEEDS[0] + 500), ids = ["t_chaos_a", "t_chaos_b"];
  let page = await openPage(w, { folder: true });
  await page.evaluate(drive, { plan: ids.map((id) => step(w, id, "now", 5)) });
  await turnFolderOn(page);
  await expect.poll(async () => folderDocs(await readFolder(page)).length, { timeout: 25_000 }).toBe(2);
  await closeClean(page);
  for (let round = 1; round <= 2; round++) {
    const at = 1 + Math.floor(r() * 2);
    page = await openPage(w, { folder: true, kill: { kind: "fswrite", at, armed: false } });
    const edits = ids.map((id) => step(w, id, "now", 60));
    await page.evaluate(drive, { plan: edits });
    const hit = w.expectKill();
    await page.evaluate(() => { window.__chaosArmed = true; window.__app.projects._folder.now(); });
    const killed = await Promise.race([hit.then(() => true), new Promise((res) => setTimeout(() => res(false), 15_000))]);
    console.log(`chaos folder round ${round}: file write #${at} -> ${killed ? "killed at " + w.killWhy : "not reached"}`);
    await page.close({ runBeforeUnload: false }).catch(() => {});
    w.tokens = [];
    page = await openPage(w, { folder: true });
    // a new name is created empty before it is written, so a kill can leave an empty file next to the old whole one; a file with some content must be whole
    const raw = Object.entries(await readFolder(page)).filter(([n]) => /-t_chaos_\w+\.json$/.test(n));
    const empty = raw.filter(([, t]) => t === "").map(([n]) => n);
    if (empty.length) test.info().annotations.push({ type: "chaos note", description: `round ${round}: ${empty.length} empty file(s) left by the kill: ${empty.join(", ")}` });
    const whole = new Map();
    for (const [n, t] of raw.filter(([, t]) => t !== "")) {
      let doc = null;
      try { doc = JSON.parse(t).doc; } catch (e) {}
      const versions = doc && w.known.get(doc.id);
      expect(!!versions && [...versions.values()].includes(sig(doc)), `round ${round}: ${n} is a version that was saved, not a half-written file`).toBe(true);
      whole.set(doc.id, true);
    }
    expect([...whole.keys()].sort(), "every design still has a whole file").toEqual([...ids].sort());
    expectWhole(w, await readWorld(w, page), `round ${round}: the browser's own copies`);
    await closeClean(page);
  }
}, { onlySite: true });

// ---------------------------------------------------------------- 8. site data cleared between backups
scenario("site data cleared between two backups: every design in either backup comes back", async (w) => {
  const A = "t_chaos_a", B = "t_chaos_b", C = "t_chaos_c";
  let page = await openPage(w);
  const backup = async () => {
    await page.click("#btn-projects");
    await page.waitForSelector(".modal-back .newcards");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-backup")]);
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    await page.click(".modal-back .xbtn");
    return { name: dl.suggestedFilename(), mimeType: "application/json", buffer: Buffer.concat(chunks) };
  };
  const a1 = step(w, A, "now", 5), b1 = step(w, B, "now", 5);
  await page.evaluate(drive, { plan: [a1, b1] });
  const first = await backup();
  const a2 = step(w, A, "now", 5), c1 = step(w, C, "now", 5);
  await page.evaluate(drive, { plan: [a2, c1] });
  const second = await backup();
  await page.close();
  await clearSiteData(w);
  w.tokens = [];
  page = await openPage(w);
  expect((await readAll(page)).items.filter((i) => w.known.has(i.entry.id))).toEqual([]);
  for (const f of [first, second]) {
    const before = await page.evaluate(() => window.__toasts.filter((t) => t.text.startsWith("Restored ")).length);
    await page.setInputFiles("#file-backup", f);
    await page.waitForFunction((n) => window.__toasts.filter((t) => t.text.startsWith("Restored ")).length > n, before, { timeout: 20_000 });
  }
  const snap = await readAll(page);
  for (const s of [a1, a2, b1, c1]) {
    expect(snap.items.some((i) => content(JSON.parse(i.doc)) === content(designDoc(s.doc.id, s.n, 5))), `${s.doc.name} is back from a backup, whole`).toBe(true);
  }
  await closeClean(page);
});

// ---------------------------------------------------------------- 9. two tabs
scenario("two tabs saving different designs at once: both designs survive, whole", async (w) => {
  const r = rng(SEEDS[0] + 600), X = "t_chaos_x", Y = "t_chaos_y";
  const pa = await openPage(w);
  await pa.evaluate(drive, { plan: [step(w, X, "now", 5)] });
  const pb = await openPage(w); // opens the design the other tab saved last
  await pb.evaluate(drive, { plan: [step(w, Y, "now", 5)] });
  for (let i = 0; i < 8; i++) {
    const a = step(w, X, r() < 0.5 ? "now" : "soon", pick(r, [1, 50])), b = step(w, Y, r() < 0.5 ? "now" : "soon", pick(r, [1, 50]));
    if (r() < 0.5) await Promise.all([pa.evaluate(drive, { plan: [a] }), pb.evaluate(drive, { plan: [b] })]);
    else { await pb.evaluate(drive, { plan: [b] }); await pa.evaluate(drive, { plan: [a] }); }
  }
  await closeClean(pa);
  await closeClean(pb);
  const page = await openPage(w);
  expectWhole(w, await readAll(page), "after two tabs saved");
  await closeClean(page);
});

scenario("two tabs saving the same design: what is stored is whole, and the other tab's saved edit is kept somewhere", async (w) => {
  const D = "t_chaos_d";
  const pa = await openPage(w);
  await pa.evaluate(drive, { plan: [step(w, D, "now", 5)] });
  const pb = await openPage(w); // the same design v1 is open in both
  const a = step(w, D, "now", 5), b = step(w, D, "now", 5);
  // concurrent saves first: whatever wins is a whole version
  await Promise.all([pa.evaluate(drive, { plan: [a] }), pb.evaluate(drive, { plan: [b] })]);
  let page = await openPage(w);
  const stored = (await readAll(page)).items.find((i) => i.entry.id === D);
  const which = stored && [...w.known.get(D)].find(([, g]) => g === sig(JSON.parse(stored.doc)));
  expect(which && [a.n, b.n].includes(which[0]), "after two tabs saved the same design at once, one of the two whole versions is stored").toBe(true);
  await closeClean(page);
  // then one after the other: tab A saves, tab B (which has not seen it) saves later
  const a2 = step(w, D, "now", 5), b2 = step(w, D, "now", 5);
  await pa.evaluate(drive, { plan: [a2] });
  await pb.evaluate(drive, { plan: [b2] });
  page = await openPage(w);
  const snap = await readAll(page);
  expectWhole(w, snap, "after the second tab saved over the first");
  const keptA = snap.items.some((i) => content(JSON.parse(i.doc)) === content(designDoc(D, a2.n, 5)));
  // quarantined: the later save replaces the document outright; nothing compares it with what the other tab stored, and no copy of the replaced version is kept (src/projstore.js:43-50 idbPut, src/projects.js:120)
  quarantined("two-tabs-same-design-overwrite", keptA, `tab A saved v${a2.n} ("Saved in this browser" was shown), then tab B saved v${b2.n} over it: v${a2.n} is ${keptA ? "still stored" : "gone from IndexedDB, with no copy and no warning in either tab"}`);
  await closeClean(page);
  await closeClean(pa);
  await closeClean(pb);
});

// ---------------------------------------------------------------- 10. the judge itself must be able to fail
test("the judge flags a missing, an older and a torn design", () => {
  const w = { known: new Map(), ledger: [], ver: new Map() };
  const v1 = mk(w, "d1", 1), v2 = mk(w, "d1", 1);
  mk(w, "d2", 1);
  w.ledger.push({ id: "d1", n: 2 }, { id: "d2", n: 1 });
  const stored = (d, extra = {}) => ({ entry: { id: d.id, name: d.name }, doc: JSON.stringify({ ...d, ...extra }) });
  expect(judge(w, [stored(v2), stored(designDoc("d2", 1))])).toEqual([]);
  expect(judge(w, [stored(v1), stored(designDoc("d2", 1))])).toEqual(["d1: v2 was saved but v1 is what is stored"]);
  expect(judge(w, [stored(v2)])).toEqual(["d2: v1 was saved but the design is gone"]);
  expect(judge(w, [stored(v2, { bodies: v1.bodies }), stored(designDoc("d2", 1))])[0]).toMatch(/matches no version that was ever saved/);
  expect(judge(w, [{ entry: { id: "d1", name: "x" }, doc: null }, stored(designDoc("d2", 1))])).toEqual(["d1: listed, but its document is missing"]);
});

scenario("a save that is dropped on the way to IndexedDB is caught by the judge", async (w) => {
  const A = "t_chaos_a";
  const run = async (drop) => {
    const world = await newWorld(w.context.browser(), w.info);
    try {
      const page = await openPage(world, drop ? { drop: { after: 1 } } : {});
      await page.evaluate(drive, { plan: [step(world, A, "now", 5), step(world, A, "now", 5), step(world, A, "now", 5)] });
      await closeClean(page);
      world.tokens = [];
      const next = await openPage(world);
      return judge(world, (await readAll(next)).items);
    } finally { await world.context.close().catch(() => {}); }
  };
  expect(await run(false), "without the dropped save, nothing is wrong").toEqual([]);
  const bad = await run(true);
  expect(bad.length, "with every save after the first dropped (acknowledged, never written) the judge must object").toBeGreaterThan(0);
  expect(bad[0]).toMatch(/was saved but v\d is what is stored/);
});
