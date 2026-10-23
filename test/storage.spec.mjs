// Where designs are stored: IndexedDB, the move from the older localStorage keys, and the fallback when IndexedDB cannot be used.
// Runs on both builds. Every case gets its own browser context, so storage starts empty; pages of one case share it.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const DB = "jumpstart3d-projects", RESCUE = "workplane.rescue.v1";
const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });

// the intro note is turned off, and every toast is recorded (they vanish after a few seconds)
const prepare = async (page) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  });
  return errors;
};
// IndexedDB that does not answer (open never finishes) or refuses (open throws), for this app's database only
const hang = (page) => page.addInitScript((name) => {
  const real = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (n, ...rest) { if (n === name) { window.__openAt = performance.now(); return {}; } return real.call(this, n, ...rest); };
}, DB);
const refuse = (page) => page.addInitScript((name) => {
  const real = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (n, ...rest) { if (n === name) throw new DOMException("The operation is insecure.", "SecurityError"); return real.call(this, n, ...rest); };
}, DB);

const kind = (page) => page.evaluate(() => window.__app.projects._store.kind);
const save = (page, doc) => loadDoc(page, doc).then(() => page.evaluate(() => window.__app.projects.saveNow()));
// one record straight out of the database, not through the app
const rawRead = (page, store, key) => page.evaluate(([db, store, key]) => new Promise((res, rej) => {
  const o = indexedDB.open(db);
  o.onerror = () => rej(o.error);
  o.onsuccess = () => {
    const d = o.result, q = d.transaction(store).objectStore(store).get(key);
    q.onsuccess = () => { d.close(); res(q.result === undefined ? null : q.result); };
    q.onerror = () => rej(q.error);
  };
}), [DB, store, key]);
const toast = async (page, prefix) => {
  await page.waitForFunction((p) => window.__toasts.some((t) => t.text.startsWith(p)), prefix, { timeout: 20_000 });
  return page.evaluate((p) => window.__toasts.find((t) => t.text.startsWith(p)), prefix);
};

test("a saved design is stored in IndexedDB, not in localStorage", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  expect(await kind(page)).toBe("idb");
  const doc = newDoc("In the database", "beginner", { bodies: [body("b1", "Slab", box(30, 20, 5))] });
  await save(page, doc);
  const stored = await rawRead(page, "docs", doc.id);
  expect(typeof stored).toBe("string");
  expect(stored).toContain('"_updated"');
  expect(JSON.parse(stored).name).toBe("In the database");
  const entry = await rawRead(page, "entries", doc.id);
  expect(entry).toMatchObject({ id: doc.id, name: "In the database", mode: "beginner" });
  expect(await page.evaluate((id) => [localStorage.getItem("workplane.doc.v1." + id), localStorage.getItem("workplane.index.v1")], doc.id)).toEqual([null, null]);
  expect(await page.evaluate(() => localStorage.getItem("workplane.pref.v1.last"))).toBe(doc.id); // the last-open id stays where it can be read at once
  expect(errors).toEqual([]);
});

test("designs left in localStorage are copied over once, strays included", async ({ page }, info) => {
  const errors = await prepare(page);
  const A = "t_Old_Alpha", B = "t_Old_Beta", C = "t_Old_Stray";
  const mk = (id, name, updated) => JSON.stringify({ ...newDoc(name, "beginner", { bodies: [body("b1", "Slab", box(20, 20, 5))] }), id, _updated: updated });
  const seed = {
    index: [{ id: A, name: "Old Alpha", ver: 3, mode: "beginner", updated: 1000, thumb: null }, { id: B, name: "Old Beta", ver: 0, mode: "beginner", updated: 2000, thumb: null }],
    docs: { [A]: mk(A, "Old Alpha", 1000), [B]: mk(B, "Old Beta", 2000), [C]: mk(C, "Old Stray", 500) }, // C has no list entry
    last: B,
  };
  await page.addInitScript((seed) => {
    try {
      if (localStorage.getItem("workplane.index.v1")) return; // seeded once
      localStorage.setItem("workplane.index.v1", JSON.stringify(seed.index));
      for (const [id, s] of Object.entries(seed.docs)) localStorage.setItem("workplane.doc.v1." + id, s);
      localStorage.setItem("jumpstart3d.ver." + seed.index[0].id, "3");
      localStorage.setItem("workplane.pref.v1.last", seed.last);
    } catch (e) {}
  }, seed);
  await boot(page, info);
  expect(await kind(page)).toBe("idb");
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Old Beta");
  const list = await page.evaluate(() => window.__app.projects._store.list());
  expect(list.map((e) => e.id).sort()).toEqual([A, B, C]);
  expect(list.find((e) => e.id === C).name).toBe("Old Stray");
  expect(await page.evaluate((id) => window.__app.projects._store.get(id), A)).toBe(seed.docs[A]); // byte for byte
  expect(await rawRead(page, "meta", "migrated")).toMatchObject({ count: 3 });
  expect(await page.evaluate((id) => [localStorage.getItem("workplane.doc.v1." + id), localStorage.getItem("jumpstart3d.ver." + id)], A)).toEqual([seed.docs[A], "3"]); // the old copies stay

  // nothing in the old keys that the merge looks at has changed (list, number of documents): it does not run again
  await page.evaluate(([id, s]) => localStorage.setItem("workplane.doc.v1." + id, s), [A, mk(A, "Changed in localStorage", 9999)]);
  await boot(page, info);
  const again = await page.evaluate(() => window.__app.projects._store.list());
  expect(again.find((e) => e.id === A).name).toBe("Old Alpha");

  // the old list changes (an older build or a fallback visit wrote it): the merge runs again, the newer copy wins,
  // and the IndexedDB version is kept as a design of its own
  await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("workplane.index.v1"));
    idx.find((e) => e.id === "t_Old_Alpha").name = "Changed in localStorage";
    localStorage.setItem("workplane.index.v1", JSON.stringify(idx));
  });
  await boot(page, info);
  const merged = await page.evaluate(() => window.__app.projects._store.list());
  expect(merged.find((e) => e.id === A).name).toBe("Changed in localStorage");
  const kept = merged.filter((e) => e.name === "Old Alpha (before fallback)");
  expect(kept).toHaveLength(1);
  expect(JSON.parse(await page.evaluate((id) => window.__app.projects._store.get(id), kept[0].id))).toMatchObject({ id: kept[0].id, name: "Old Alpha (before fallback)" });
  expect(errors).toEqual([]);
});

test("a design saved while IndexedDB was unusable is there again when it works", async ({ context }, info) => {
  const id = "t_Where_D";
  const p1 = await context.newPage();
  const e1 = await prepare(p1);
  await boot(p1, info);
  expect(await kind(p1)).toBe("idb");
  await save(p1, newDoc("Where D", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  await p1.close();

  const p2 = await context.newPage();
  const e2 = await prepare(p2);
  await hang(p2);
  await p2.addInitScript(() => { // when the store settles on a driver, relative to the open that never answers
    const timer = setInterval(() => {
      const s = window.__app && window.__app.projects && window.__app.projects._store;
      if (s && s.kind) { window.__readyAt = performance.now(); clearInterval(timer); }
    }, 25);
  });
  await boot(p2, info);
  await p2.waitForFunction(() => window.__readyAt !== undefined, null, { timeout: 15_000 }); // "started" does not mean the store has settled, and the poll above notes the moment it did only every 25 ms
  expect(await kind(p2)).toBe("local");
  const waited = await p2.evaluate(() => window.__readyAt - window.__openAt);
  expect(waited).toBeGreaterThan(2800); // it waited for the database, then gave up
  expect(waited).toBeLessThan(6000);
  await save(p2, newDoc("Where D renamed", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  expect(await p2.evaluate((id) => JSON.parse(localStorage.getItem("workplane.doc.v1." + id)).name, id)).toBe("Where D renamed");
  await p2.close();

  const p3 = await context.newPage();
  const e3 = await prepare(p3);
  await boot(p3, info);
  expect(await kind(p3)).toBe("idb");
  expect(await p3.evaluate(() => window.__store.doc.name)).toBe("Where D renamed");
  expect(JSON.parse(await rawRead(p3, "docs", id)).name).toBe("Where D renamed");
  expect((await rawRead(p3, "entries", id)).name).toBe("Where D renamed");
  // the older version is kept next to it, once
  const list = await p3.evaluate(() => window.__app.projects._store.list());
  expect(list.filter((e) => e.id === id)).toHaveLength(1);
  expect(list.filter((e) => e.name === "Where D (before fallback)")).toHaveLength(1);
  await boot(p3, info); // nothing changed in the old keys: no second copy
  expect(await p3.evaluate(() => window.__app.projects._store.list().then((l) => l.length))).toBe(list.length);
  expect([...e1, ...e2, ...e3]).toEqual([]);
});

test("when IndexedDB refuses to open, designs are kept in localStorage and come back", async ({ page }, info) => {
  const errors = await prepare(page);
  await refuse(page);
  await boot(page, info);
  expect(await kind(page)).toBe("local");
  const doc = newDoc("Kept the old way", "beginner", { bodies: [body("b1", "Slab", box(30, 20, 5))] });
  await save(page, doc);
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem("workplane.doc.v1." + id)).name, doc.id)).toBe("Kept the old way");
  await boot(page, info);
  expect(await kind(page)).toBe("local");
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Kept the old way");
  expect(errors).toEqual([]);
});

test("an edit made just before the tab closes is kept, and applied on the next visit", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  const doc = newDoc("Before the close", "beginner", { bodies: [body("b1", "Slab", box(30, 20, 5))] });
  await save(page, doc);

  // half one: an unsaved edit and the tab-close event leave a copy in localStorage
  const rescued = await page.evaluate((k) => {
    window.__store.update((d) => { d.name = "Edited at the close"; }, "Rename");
    window.dispatchEvent(new Event("beforeunload"));
    return JSON.parse(localStorage.getItem(k));
  }, RESCUE);
  expect(rescued.id).toBe(doc.id);
  expect(JSON.parse(rescued.doc).name).toBe("Edited at the close");
  expect(rescued.entry.thumb).toBeNull();

  // half two: a newer rescue copy is there at the next start (a reload right after the event would race the write)
  await page.waitForTimeout(1600); // the edit's own save has finished
  await page.evaluate(() => window.__app.projects.saveNow());
  const thumb = (await rawRead(page, "entries", doc.id)).thumb; // each save draws a new one: this is the one the rescue must keep
  expect(thumb).toBeTruthy();
  await page.evaluate(async ([k, id]) => {
    const s = window.__app.projects._store, cur = JSON.parse(await s.get(id));
    const next = { ...cur, name: "Rescued", _updated: cur._updated + 100_000 };
    localStorage.setItem(k, JSON.stringify({ id, doc: JSON.stringify(next), entry: { id, name: "Rescued", ver: 0, mode: "beginner", updated: next._updated, thumb: null } }));
  }, [RESCUE, doc.id]);
  await boot(page, info);
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Rescued");
  const entry = await rawRead(page, "entries", doc.id);
  expect(entry.name).toBe("Rescued");
  expect(entry.thumb).toBe(thumb);
  expect(await page.evaluate((k) => localStorage.getItem(k), RESCUE)).toBeNull();
  expect(errors).toEqual([]);
});

test("a restore that cannot save the list is refused and leaves nothing behind", async ({ page }, info) => {
  const errors = await prepare(page);
  await refuse(page);
  await boot(page, info);
  expect(await kind(page)).toBe("local");
  const designs = ["t_New_One", "t_New_Two"].map((id) => ({
    entry: { id, name: "New " + id, ver: 0, mode: "beginner", updated: 1, thumb: null },
    doc: { ...newDoc("New " + id, "beginner", { bodies: [body("b1", "Slab", box(10, 10, 5))] }), id, _updated: 1 },
    ver: 4,
  }));
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("workplane.doc.v1.") || k.startsWith("jumpstart3d.ver.")).sort());
  const before = await keys();
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "workplane.index.v1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return window.__realSetItem.call(this, k, v);
    };
  });
  try {
    await page.setInputFiles("#file-backup", { name: "two.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "jumpstart-3d", backup: 1, designs })) });
    const t = await toast(page, "Restored ");
    expect(t.text).toContain("Restored 0 designs");
    expect(t.text).toContain("did not fit");
    expect(t.err).toBe(true);
    await page.click(".modal-back .xbtn");
    expect(await keys()).toEqual(before); // no new document or version keys
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  }
  expect(errors).toEqual([]);
});

// IndexedDB that works but answers late: the first open of this app's database is held until the test lets it go
const slowOpen = (page) => page.addInitScript((name) => {
  const real = IDBFactory.prototype.open;
  let first = true, release;
  const gate = new Promise((r) => { release = r; });
  window.__releaseIdb = () => release();
  IDBFactory.prototype.open = function (n, ...rest) {
    if (n !== name || !first) return real.call(this, n, ...rest);
    first = false;
    const fake = {}, factory = this;
    gate.then(() => {
      const r = real.call(factory, n, ...rest);
      Object.defineProperty(fake, "result", { get: () => r.result });
      for (const ev of ["onupgradeneeded", "onsuccess", "onerror", "onblocked"]) r[ev] = (e) => fake[ev] && fake[ev](e);
    });
    return fake;
  };
}, DB);

test("IndexedDB that opens late takes over from localStorage: nothing lost, nothing doubled, the folder button appears", async ({ context }, info) => {
  const [A, B, C] = ["t_Late_Alpha", "t_Late_Beta", "t_Late_Gamma"];
  const mk = (id, name) => newDoc(name, "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] });
  const p1 = await context.newPage();
  const e1 = await prepare(p1);
  await p1.addInitScript(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true }); });
  await slowOpen(p1);
  await boot(p1, info); // the app starts without waiting for the database any longer than 3 s
  expect(await p1.evaluate(() => window.__app.projects._store.ready)).toBe("local"); // settles after the 3 s wait (a fresh profile starts at once, with the store still deciding)

  // saved while the database is still opening: they go to the old keys
  await save(p1, mk(A, "Late Alpha"));
  await save(p1, mk(B, "Late Beta"));
  expect(await p1.evaluate((id) => JSON.parse(localStorage.getItem("workplane.doc.v1." + id)).name, A)).toBe("Late Alpha");
  // the folder button needs IndexedDB: not there yet
  await p1.click("#btn-projects");
  await p1.waitForSelector(".projgrid .newcards", { timeout: 10_000 });
  expect(await p1.locator("#btn-folder").count()).toBe(0);
  await p1.click(".modal-back .xbtn");
  expect(await kind(p1)).toBe("local");

  // the database answers
  await p1.evaluate(() => window.__releaseIdb());
  await p1.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  const list = await p1.evaluate(() => window.__app.projects._store.list());
  expect(list.map((e) => e.id).sort()).toEqual([A, B]); // each once
  expect(JSON.parse(await rawRead(p1, "docs", A)).name).toBe("Late Alpha");
  expect(JSON.parse(await rawRead(p1, "docs", B)).name).toBe("Late Beta");
  expect(await rawRead(p1, "meta", "migrated")).toMatchObject({ count: 2 });

  // saves now land in IndexedDB, not in the old keys
  await save(p1, mk(C, "Late Gamma"));
  expect(JSON.parse(await rawRead(p1, "docs", C)).name).toBe("Late Gamma");
  expect(await p1.evaluate((id) => localStorage.getItem("workplane.doc.v1." + id), C)).toBeNull();
  await save(p1, mk(A, "Late Alpha renamed"));
  expect(JSON.parse(await rawRead(p1, "docs", A)).name).toBe("Late Alpha renamed");

  // the folder button is there
  await p1.click("#btn-projects");
  await p1.waitForSelector(".projgrid .newcards", { timeout: 10_000 });
  await p1.waitForSelector("#btn-folder", { timeout: 10_000 });
  await p1.click(".modal-back .xbtn");
  await p1.close();

  // a new visit finds everything, once
  const p2 = await context.newPage();
  const e2 = await prepare(p2);
  await boot(p2, info);
  expect(await kind(p2)).toBe("idb");
  const again = await p2.evaluate(() => window.__app.projects._store.list());
  expect(again.map((e) => e.id).sort()).toEqual([A, B, C]);
  expect(again.find((e) => e.id === A).name).toBe("Late Alpha renamed");
  expect(again.some((e) => /before fallback/.test(e.name))).toBe(false);
  expect([...e1, ...e2]).toEqual([]);
});

// Shared setup for the slow-open cases below: a design that IndexedDB holds in a newer version than the copy an earlier
// visit left in localStorage (a design moved over once keeps its old copy). Returns the page, ready to open slowly.
async function newerInIdbOlderInLocal(context, info, id, { same = false, hook = false } = {}) {
  const p1 = await context.newPage();
  const errs = await prepare(p1);
  await boot(p1, info);
  await save(p1, newDoc("Stale new", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  await p1.evaluate(async ([id, same]) => { // the old copy: the same design, older, in the old keys
    const s = window.__app.projects._store, cur = JSON.parse(await s.get(id)), old = same ? cur : { ...cur, name: "Stale old", _updated: cur._updated - 100_000 };
    localStorage.setItem("workplane.doc.v1." + id, JSON.stringify(old));
    localStorage.setItem("workplane.index.v1", JSON.stringify([{ id, name: old.name, ver: 0, mode: "beginner", updated: old._updated, thumb: null }]));
  }, [id, same]);
  await p1.close();
  const p2 = await context.newPage();
  errs.push(...await prepare(p2));
  await slowOpen(p2);
  if (hook) await duringSwitch(p2);
  await boot(p2, info);
  expect(await kind(p2)).toBe("local");
  expect(await p2.evaluate(() => window.__store.doc.name)).toBe(same ? "Stale new" : "Stale old"); // the app opened the old copy
  return [p2, errs];
}
// the moment the copy into IndexedDB begins its writing transaction, the page runs window.__duringSwitch (once)
const duringSwitch = (page) => page.addInitScript(() => {
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      const tx = real.call(this, stores, mode, ...rest);
      if (mode === "readwrite" && Array.isArray(stores) && stores.includes("meta") && window.__duringSwitch) { const f = window.__duringSwitch; window.__duringSwitch = null; setTimeout(f, 0); }
      return tx;
    };
});
const idbNames = (page) => page.evaluate(() => window.__app.projects._store.list().then((l) => l.map((e) => e.name).sort()));

test("a slow IndexedDB: an open design that was read from an older copy is replaced by the newer one", async ({ context }, info) => {
  const id = "t_Late_Stale";
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id);
  await p.evaluate(() => window.__releaseIdb());
  await p.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  await p.waitForFunction(() => window.__store.doc.name === "Stale new", null, { timeout: 10_000 }); // not the old copy
  await p.evaluate(() => window.__store.update((d) => { d.name = "Stale new, edited"; }, "Rename"));
  await p.evaluate(() => window.__app.projects.saveNow());
  expect(JSON.parse(await rawRead(p, "docs", id)).name).toBe("Stale new, edited");
  expect(await idbNames(p)).toEqual(["Stale new, edited"]); // the newer content was not replaced by the older, nothing needed keeping
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: edits made on the older copy never overwrite the newer one, it is kept", async ({ context }, info) => {
  const id = "t_Late_Stale2";
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id);
  await p.evaluate(() => { window.__store.update((d) => { d.name = "Stale mine"; }, "Rename"); window.__releaseIdb(); }); // unsaved edit, then the database answers
  await p.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  await expect.poll(async () => JSON.parse(await rawRead(p, "docs", id)).name, { timeout: 15_000 }).toBe("Stale mine");
  expect(await idbNames(p)).toEqual(["Stale mine", "Stale new (before fallback)"]);
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: a save that failed meanwhile (localStorage full) is saved when the database takes over", async ({ page }, info) => {
  const id = "t_Late_Full";
  const errors = await prepare(page);
  await page.addInitScript(() => { // localStorage refuses designs once this is set
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (window.__full && String(k).startsWith("workplane.doc.v1.")) throw new DOMException("full", "QuotaExceededError"); return real.call(this, k, v); };
  });
  await slowOpen(page);
  await boot(page, info);
  await loadDoc(page, newDoc("Full", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  await page.evaluate(() => { window.__full = true; });
  expect(await page.evaluate(() => window.__app.projects.saveNow())).toBe(false); // "Couldn't save", still dirty
  expect(await page.evaluate(() => document.getElementById("savestate").textContent)).toMatch(/Couldn't save/);
  await page.evaluate(() => window.__releaseIdb());
  await page.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  await expect.poll(async () => { const s = await rawRead(page, "docs", id); return s && JSON.parse(s).name; }, { timeout: 15_000 }).toBe("Full"); // no further edit
  expect(await page.evaluate(() => document.getElementById("savestate").textContent)).toBe("Saved in this browser");
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: a save queued while the switch runs lands once, in IndexedDB, with the newest content", async ({ page }, info) => {
  const id = "t_Late_Queued";
  const errors = await prepare(page);
  await duringSwitch(page);
  await slowOpen(page);
  await boot(page, info);
  await save(page, newDoc("Queued", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  await page.evaluate(() => {
    window.__queued = null;
    window.__duringSwitch = () => { window.__store.update((d) => { d.name = "Queued newest"; }, "Rename"); window.__queued = window.__app.projects.saveNow(); };
    window.__releaseIdb();
  });
  await page.waitForFunction(() => window.__queued, null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__queued)).toBe(true);
  await page.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  expect(JSON.parse(await rawRead(page, "docs", id)).name).toBe("Queued newest");
  expect(await idbNames(page)).toEqual(["Queued newest"]); // once, no "(before fallback)"
  expect(JSON.parse(await page.evaluate((id) => localStorage.getItem("workplane.doc.v1." + id), id)).name).toBe("Queued"); // never in the old keys
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: a design deleted meanwhile stays deleted, unless IndexedDB holds a newer copy than the one deleted", async ({ context }, info) => {
  const id = "t_Late_Gone", id2 = "t_Late_Gone2";
  // the deleted copy is the one IndexedDB holds: both go
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id, { same: true });
  expect(await p.evaluate((id) => window.__app.projects._store.del(id), id)).toBe(true); // deleted from the old keys
  await p.evaluate(() => window.__releaseIdb());
  await p.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  expect(await rawRead(p, "docs", id)).toBeNull();
  expect(await rawRead(p, "entries", id)).toBeNull();
  expect(await idbNames(p)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: deleting the older copy never removes a newer one in IndexedDB", async ({ context }, info) => {
  const id = "t_Late_Gone2";
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id); // the old keys hold an older copy than IndexedDB
  expect(await p.evaluate((id) => window.__app.projects._store.del(id), id)).toBe(true);
  await p.evaluate(() => window.__releaseIdb());
  await p.waitForFunction(() => window.__app.projects._store.kind === "idb", null, { timeout: 20_000 });
  expect(JSON.parse(await rawRead(p, "docs", id)).name).toBe("Stale new"); // the copy the person never saw is still there
  expect(await idbNames(p)).toEqual(["Stale new"]);
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: a save that starts while the copy runs keeps the newer stored design", async ({ context }, info) => {
  const id = "t_Late_During";
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id, { hook: true });
  await p.evaluate(() => { // edits on the older copy, saved at the moment the copy into IndexedDB runs
    window.__duringSwitch = () => { window.__store.update((d) => { d.name = "During mine"; }, "Rename"); window.__queued = window.__app.projects.saveNow(); };
    window.__releaseIdb();
  });
  await p.waitForFunction(() => window.__queued, null, { timeout: 20_000 });
  expect(await p.evaluate(() => window.__queued)).toBe(true);
  expect(JSON.parse(await rawRead(p, "docs", id)).name).toBe("During mine");
  const kept = (await p.evaluate(() => window.__app.projects._store.list())).filter((e) => e.name === "Stale new (before fallback)");
  expect(kept).toHaveLength(1);
  expect(JSON.parse(await rawRead(p, "docs", kept[0].id)).name).toBe("Stale new (before fallback)"); // the newer content
  expect(await idbNames(p)).toEqual(["During mine", "Stale new (before fallback)"]);
  expect(errors).toEqual([]);
});

test("a slow IndexedDB: when keeping the newer copy fails, nothing is overwritten and the edits stay unsaved until it works", async ({ context }, info) => {
  const id = "t_Late_Fail";
  const [p, errors] = await newerInIdbOlderInLocal(context, info, id, { hook: true });
  await p.evaluate(() => { // storing a "(before fallback)" design fails; the first attempt is made while the copy runs
    const real = IDBObjectStore.prototype.put;
    window.__fail = true;
    IDBObjectStore.prototype.put = function (v, ...rest) { if (window.__fail && typeof v === "string" && v.includes("(before fallback)")) throw new DOMException("full", "QuotaExceededError"); return real.call(this, v, ...rest); };
    window.__duringSwitch = () => { window.__store.update((d) => { d.name = "Fail mine"; }, "Rename"); window.__queued = window.__app.projects.saveNow(); };
    window.__releaseIdb();
  });
  await p.waitForFunction(() => window.__queued !== undefined, null, { timeout: 20_000 });
  expect(await p.evaluate(() => window.__queued)).toBe(false);
  expect(await p.evaluate(() => document.getElementById("savestate").textContent)).toMatch(/Couldn't save/);
  expect(JSON.parse(await rawRead(p, "docs", id)).name).toBe("Stale new"); // not overwritten
  expect(await idbNames(p)).toEqual(["Stale new"]);
  await p.evaluate(() => { window.__fail = false; });
  expect(await p.evaluate(() => window.__app.projects.saveNow())).toBe(true); // the retry keeps the newer copy and saves the edits
  expect(JSON.parse(await rawRead(p, "docs", id)).name).toBe("Fail mine");
  expect(await idbNames(p)).toEqual(["Fail mine", "Stale new (before fallback)"]);
  expect(errors).toEqual([]);
});

test("a rescue copy made on an older base keeps the newer stored design as \"(before fallback)\"", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  const id = "t_Rescue_Base";
  const doc = newDoc("Rescue base", "beginner", { id, bodies: [body("b1", "Slab", box(30, 20, 5))] });
  await save(page, doc);
  // the real write records the stamp the edits started from
  const written = await page.evaluate((k) => {
    window.__store.update((d) => { d.name = "Rescue base edited"; }, "Rename");
    window.dispatchEvent(new Event("beforeunload"));
    return JSON.parse(localStorage.getItem(k));
  }, RESCUE);
  expect(typeof written.base).toBe("number");
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.__app.projects.saveNow());
  await page.evaluate((k) => localStorage.removeItem(k), RESCUE);
  // a rescue copy whose base is older than the stored design (another visit saved since), and one whose base is the stored design
  const stored = JSON.parse(await rawRead(page, "docs", id));
  const rescue = (name, base) => page.evaluate(([k, id, stored, name, base]) => {
    const next = { ...stored, name, _updated: stored._updated + 50_000 };
    localStorage.setItem(k, JSON.stringify({ id, doc: JSON.stringify(next), entry: { id, name, ver: 0, mode: "beginner", updated: next._updated, thumb: null }, base }));
  }, [RESCUE, id, stored, name, base]);
  await rescue("Rescue same base", stored._updated);
  await boot(page, info);
  expect(JSON.parse(await rawRead(page, "docs", id)).name).toBe("Rescue same base");
  expect(await idbNames(page)).toEqual(["Rescue same base"]); // base is the stored copy: nothing to keep
  const now = JSON.parse(await rawRead(page, "docs", id));
  await page.evaluate(([k, id, now]) => {
    const next = { ...now, name: "Rescue old base", _updated: now._updated + 50_000 };
    localStorage.setItem(k, JSON.stringify({ id, doc: JSON.stringify(next), entry: { id, name: next.name, ver: 0, mode: "beginner", updated: next._updated, thumb: null }, base: now._updated - 10_000 }));
  }, [RESCUE, id, now]);
  await boot(page, info);
  expect(JSON.parse(await rawRead(page, "docs", id)).name).toBe("Rescue old base");
  expect(await idbNames(page)).toEqual(["Rescue old base", "Rescue same base (before fallback)"]);
  expect(errors).toEqual([]);
});
