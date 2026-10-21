// Copies in a folder: Your designs offers "Save copies into a folder…" (Chrome and Edge) and keeps every design there as a project file.
// Runs on both builds, each case in a fresh browser context. There is no real folder picker in a test browser: a fake
// showDirectoryPicker hands out a real directory handle from the browser's private file system (OPFS), which can be
// stored in IndexedDB like a picked folder. OPFS never asks for permission, so a lapsed permission is stubbed.
import { test, expect } from "@playwright/test";
import { boot, reload, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const DB = "jumpstart3d-projects";
const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });
const NOTES = "my own notes", OTHER = JSON.stringify({ not: "ours" });

const prepare = async (page, { picker = true } = {}) => {
  const errors = watchErrors(page);
  await page.addInitScript((picker) => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    if (picker) window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true });
    else { delete window.showDirectoryPicker; try { delete Window.prototype.showDirectoryPicker; } catch (e) {} }
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  }, picker);
  return errors;
};
const refuse = (page) => page.addInitScript((name) => {
  const real = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (n, ...rest) { if (n === name) throw new DOMException("The operation is insecure.", "SecurityError"); return real.call(this, n, ...rest); };
}, DB);

// the single file is opened from disk: if the browser has no private file system there, the cases that need one are skipped
const needOpfs = async (page, info) => {
  const ok = await page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false));
  test.skip(!ok && info.project.name === "single", "no origin private file system (OPFS) on file:// in this browser");
};

const save = (page, doc) => loadDoc(page, doc).then(() => page.evaluate(() => window.__app.projects.saveNow()));
const rawRead = (page, store, key) => page.evaluate(([db, store, key]) => new Promise((res, rej) => {
  const o = indexedDB.open(db);
  o.onerror = () => rej(o.error);
  o.onsuccess = () => {
    const d = o.result, q = d.transaction(store).objectStore(store).get(key);
    q.onsuccess = () => { d.close(); res(q.result === undefined ? null : q.result); };
    q.onerror = () => rej(q.error);
  };
}), [DB, store, key]);
// the folder record without the handle (a handle does not travel out of the page)
const record = (page) => page.evaluate(([db]) => new Promise((res, rej) => {
  const o = indexedDB.open(db);
  o.onerror = () => rej(o.error);
  o.onsuccess = () => {
    const d = o.result, q = d.transaction("meta").objectStore("meta").get("folder");
    q.onsuccess = () => { d.close(); const r = q.result; res(r ? { name: r.name, files: r.files, handle: !!r.handle } : null); };
    q.onerror = () => rej(q.error);
  };
}), [DB]);

// the folder the fake picker hands out: file name -> text
const readFolder = (page) => page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true }), out = {};
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== "file") continue;
    // an entry listed here can be swapped away while the app is still writing its copies; skip it and let expect.poll look again
    try { out[name] = await (await h.getFile()).text(); } catch (e) { if (e.name !== "NotFoundError") throw e; }
  }
  return out;
});
const putInFolder = (page, name, text) => page.evaluate(async ([name, text]) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true });
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text); await w.close();
}, [name, text]);
const fileOf = async (page, name) => { const t = (await readFolder(page))[name]; return t === undefined ? null : JSON.parse(t); };
// the app adds an internal key to each body; the bodies a test builds do not have it
const plain = (bodies) => bodies.map(({ _key, ...b }) => b);
const copyOf = async (page, name) => { const f = await fileOf(page, name); return f && { ...f.doc, bodies: plain(f.doc.bodies) }; };

const openDesigns = async (page) => { await page.click("#btn-projects"); await page.waitForSelector(".modal-back .newcards"); };
const status = (page) => page.locator("#folder-status");
const turnOn = async (page) => {
  await openDesigns(page);
  await page.click("#btn-folder");
  await expect(status(page)).toHaveText(/^Copies of your designs are saved to “mirror”/);
};
const toasts = (page, prefix) => page.evaluate((p) => window.__toasts.filter((t) => t.text.startsWith(p)), prefix);
const ready = (page) => page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready && window.__app.projects.started === true, null, { timeout: 90_000 });

const docA = (w = 30) => newDoc("Design A", "beginner", { bodies: [body("b1", "Slab", box(w, 20, 5))] });
const docB = () => newDoc("Design B", "beginner", { bodies: [body("b1", "Block", box(10, 10, 10))] });
const nameOf = (doc) => `${doc.name}-${doc.id}.json`;

test("no folder row where the browser has no folder picker", async ({ page }, info) => {
  const errors = await prepare(page, { picker: false });
  await boot(page, info);
  expect(await page.evaluate(() => typeof window.showDirectoryPicker)).toBe("undefined");
  await openDesigns(page);
  await expect(page.locator("#folder-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("no folder row on the older storage, where a folder could not be remembered", async ({ page }, info) => {
  const errors = await prepare(page);
  await refuse(page);
  await boot(page, info);
  expect(await page.evaluate(() => window.__app.projects._store.kind)).toBe("local");
  expect(await page.evaluate(() => typeof window.showDirectoryPicker)).toBe("function");
  await openDesigns(page);
  await expect(page.locator("#folder-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("choosing a folder copies every design, and later saves reach the files after a pause", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA(), b = docB();
  await save(page, a);
  await save(page, b);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).sort(), { timeout: 20_000 }).toEqual([nameOf(a), nameOf(b)].sort());
  for (const d of [a, b]) {
    const f = await fileOf(page, nameOf(d));
    expect(f).toMatchObject({ app: "jumpstart-3d", version: 1, doc: { id: d.id, name: d.name } });
    expect(f.doc.bodies).toEqual(JSON.parse(await rawRead(page, "docs", d.id)).bodies);
    expect(plain(f.doc.bodies)).toEqual(d.bodies);
    expect(f.doc._updated).toBeUndefined();
  }
  expect(await toasts(page, "Copies of your designs will be saved to “mirror”")).toHaveLength(1);
  const rec = await record(page);
  expect(rec).toMatchObject({ name: "mirror", handle: true });
  expect(Object.keys(rec.files).sort()).toEqual([a.id, b.id].sort());
  expect(rec.files[a.id].file).toBe(nameOf(a));

  // an edit reaches the file after a quiet pause, not at once
  const edited = docA(31);
  await save(page, edited);
  await page.waitForTimeout(1000);
  expect((await copyOf(page, nameOf(a))).bodies).toEqual(a.bodies);
  await expect.poll(async () => (await copyOf(page, nameOf(a))).bodies, { timeout: 20_000 }).toEqual(edited.bodies);
  expect(errors).toEqual([]);
});

test("a rename replaces only the file the app wrote; deleting a design leaves its file", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA(), b = docB();
  await save(page, a);
  await save(page, b);
  await putInFolder(page, "notes.txt", NOTES);
  await putInFolder(page, "Other-dzzzzzz.json", OTHER);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(4);

  await save(page, { ...b, name: "Renamed" });
  const renamed = `Renamed-${b.id}.json`;
  await expect.poll(async () => Object.keys(await readFolder(page)).sort(), { timeout: 20_000 }).toEqual([nameOf(a), "Other-dzzzzzz.json", "notes.txt", renamed].sort());
  const folder = await readFolder(page);
  expect(folder["notes.txt"]).toBe(NOTES);
  expect(folder["Other-dzzzzzz.json"]).toBe(OTHER);
  expect(JSON.parse(folder[renamed]).doc.name).toBe("Renamed");

  // delete design A in the list (the open design is B)
  const card = page.locator(".pcard", { hasText: "Design A" });
  await card.locator(".del").click();
  await page.locator(".confirm-row .btn.danger").click();
  await expect(card).toHaveCount(0);
  await page.evaluate(() => window.__app.projects._folder.now());
  expect(Object.keys(await readFolder(page))).toContain(nameOf(a));
  expect(Object.keys((await record(page)).files)).toEqual([b.id]); // the record forgets it; the file stays
  expect(errors).toEqual([]);
});

test("a lapsed permission pauses the copies, saving still works, and Allow catches up", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA();
  await save(page, a);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(1);
  await page.evaluate(() => {
    let perm = "prompt";
    FileSystemDirectoryHandle.prototype.queryPermission = async () => perm;
    FileSystemDirectoryHandle.prototype.requestPermission = async () => { perm = "granted"; return "granted"; };
  });
  const edited = docA(32);
  expect(await save(page, edited)).toBe(true);
  await expect(page.locator("#savestate")).toHaveText("Saved in this browser");
  await expect(status(page)).toHaveText("1 design waiting to be copied to “mirror”: click Allow.", { timeout: 20_000 });
  await expect(page.locator("#btn-folder-allow")).toBeVisible();
  expect((await copyOf(page, nameOf(a))).bodies).toEqual(a.bodies);
  expect(await toasts(page, "Copies to “mirror” are paused")).toHaveLength(1);
  await page.click("#btn-folder-allow");
  await expect.poll(async () => (await copyOf(page, nameOf(a))).bodies, { timeout: 20_000 }).toEqual(edited.bodies);
  await expect(status(page)).toHaveText(/^Copies of your designs are saved to “mirror”/);
  await expect(page.locator("#btn-folder-allow")).toHaveCount(0);
  expect(await toasts(page, "Copies to “mirror” are paused")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a write that fails shows in the row, never breaks saving, and is retried", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA();
  await save(page, a);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(1);
  await page.evaluate(() => {
    window.__realGet = FileSystemDirectoryHandle.prototype.getFileHandle;
    FileSystemDirectoryHandle.prototype.getFileHandle = async () => { throw new DOMException("not allowed here", "NotAllowedError"); };
  });
  const edited = docA(33);
  expect(await save(page, edited)).toBe(true);
  await expect(status(page)).toHaveText(/^Could not write to “mirror”/, { timeout: 20_000 });
  expect((await copyOf(page, nameOf(a))).bodies).toEqual(a.bodies);
  expect((await toasts(page, "Copies to “mirror” are paused"))[0].err).toBe(true);
  await page.evaluate(() => { FileSystemDirectoryHandle.prototype.getFileHandle = window.__realGet; });
  await page.evaluate(() => window.__app.projects._folder.now());
  expect((await copyOf(page, nameOf(a))).bodies).toEqual(edited.bodies);
  await expect(status(page)).toHaveText(/^Copies of your designs are saved to “mirror”/);
  expect(errors).toEqual([]);
});

test("the folder is remembered after a reload and keeps being updated", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA();
  await save(page, a);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(1);
  await reload(page);
  await ready(page);
  expect(await record(page)).toMatchObject({ name: "mirror", handle: true });
  await openDesigns(page);
  await expect(status(page)).toHaveText(/^Copies of your designs are saved to “mirror”/);
  const edited = docA(34);
  await save(page, edited);
  await expect.poll(async () => (await copyOf(page, nameOf(a))).bodies, { timeout: 20_000 }).toEqual(edited.bodies);
  expect(errors).toEqual([]);
});

test("a copy in the folder opens through Open > Project file", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA();
  await save(page, a);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(1);
  const text = (await readFolder(page))[nameOf(a)];
  await page.setInputFiles("#file-import", { name: nameOf(a), mimeType: "application/json", buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.__toasts.some((t) => t.text === "Opened Design A"), null, { timeout: 20_000 });
  const opened = await page.evaluate(() => ({ id: window.__store.doc.id, name: window.__store.doc.name, bodies: window.__store.doc.bodies }));
  expect(opened.name).toBe("Design A");
  expect(opened.id).not.toBe(a.id);
  expect(plain(opened.bodies)).toEqual(a.bodies);
  expect(errors).toEqual([]);
});

test("Stop copying removes the record, keeps the files, and the pick button is back", async ({ page }, info) => {
  const errors = await prepare(page);
  await boot(page, info);
  await needOpfs(page, info);
  const a = docA();
  await save(page, a);
  await turnOn(page);
  await expect.poll(async () => Object.keys(await readFolder(page)).length, { timeout: 20_000 }).toBe(1);
  await page.click("#btn-folder-stop");
  await expect(page.locator("#btn-folder")).toBeVisible();
  await expect(page.locator("#folder-status")).toHaveCount(0);
  await expect.poll(() => record(page)).toBeNull();
  await save(page, docA(35)); // later saves no longer reach the folder
  await page.waitForTimeout(7000);
  expect(Object.keys(await readFolder(page))).toEqual([nameOf(a)]);
  expect((await copyOf(page, nameOf(a))).bodies).toEqual(a.bodies);
  expect(errors).toEqual([]);
});
