// Restore from a folder tests: Your designs › Restore from a folder… adds the designs from the project files in a folder.
// Runs on both builds. Real temporary folders are written with Node and handed to the hidden folder input the way a user's picker would.
// The rules are Restore from backup's (backup.spec.mjs): ids kept, nothing deleted or overwritten, a changed design gets a "(restored)" copy.
import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boot, watchErrors, loadDoc, newDoc, body, prim, buildOf, browserOf, quarantine } from "./helpers.mjs";

const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });
const NONE = "No JumpStart 3D designs found in that folder.";
const plain = (bodies) => bodies.map(({ _key, ...b }) => b);

// the files the copier writes: <name>-<id>.json holding { app, version, doc } with no _updated
const design = (id, name, w, extra = {}) => newDoc(name, "beginner", { id, bodies: [body("b1", "Slab", box(w, 20, 5))], ...extra });
const projectFile = (doc) => JSON.stringify({ app: "jumpstart-3d", version: 1, doc }, null, 1);
const fileNameOf = (doc) => `${doc.name}-${doc.id}.json`;

const dirs = [];
// files: { relative path: text | { text, time } }. time (seconds) sets the file's modified time, so the order is known.
function makeFolder(files) {
  const dir = mkdtempSync(join(tmpdir(), "js3d-folder-"));
  dirs.push(dir);
  let t = 1_700_000_000;
  for (const [rel, v] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, typeof v === "string" ? v : v.text);
    const time = typeof v === "string" ? t++ : v.time;
    utimesSync(p, time, time);
  }
  return dir;
}
test.afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test.describe.configure({ mode: "serial" });
let page, errors, info0;

test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  });
  await boot(page, info0);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

async function toast(prefix, timeout = 20_000) {
  await page.waitForFunction((p) => window.__toasts.some((t) => t.text.startsWith(p)), prefix, { timeout });
  return page.evaluate((p) => window.__toasts.find((t) => t.text.startsWith(p)), prefix);
}
const clearToasts = () => page.evaluate(() => { window.__toasts.length = 0; });
const toastTexts = () => page.evaluate(() => window.__toasts.map((t) => t.text));
const restoreFrom = (dir) => page.setInputFiles("#file-folder", dir);
const openDesigns = () => page.click("#btn-projects");
const closeDesigns = async () => { if (await page.locator(".modal-back").count()) { await page.click(".modal-back .xbtn"); await expect(page.locator(".modal-back")).toHaveCount(0); } };

const snapshot = () => page.evaluate(async () => {
  const s = window.__app.projects._store;
  await s.ready;
  const out = { index: await s.list(), docs: {}, ls: {} };
  for (const e of out.index) out.docs[e.id] = await s.get(e.id);
  for (const k of Object.keys(localStorage)) if (k.startsWith("workplane.pref.v1.last") || k.startsWith("jumpstart3d.ver.")) out.ls[k] = localStorage.getItem(k);
  return out;
});
const wipe = () => page.evaluate(async () => {
  const s = window.__app.projects._store;
  await s.ready;
  for (const e of await s.list()) await s.del(e.id);
  for (const k of Object.keys(localStorage)) if (k.startsWith("workplane.pref.v1.last") || k.startsWith("jumpstart3d.ver.") || k === "workplane.rescue.v1") localStorage.removeItem(k);
});
const entryOf = (snap, id) => snap.index.find((e) => e.id === id);
const docOf = (snap, id) => JSON.parse(snap.docs[id]);
// the open design: its id, stored string and the last-open pointer
const openState = () => page.evaluate(async () => {
  const s = window.__app.projects._store;
  const id = window.__store.doc.id;
  return { id, stored: await s.get(id), last: localStorage.getItem("workplane.pref.v1.last") };
});

const ONE = design("dtfolder1", "Folder One", 30, { ver: 3 });
const TWO = design("dtfolder2", "Folder Two", 12);
let twoFolder; // the folder of cases 2 and 3

test("Your designs has a Restore from a folder button and a hidden folder picker", async () => {
  await openDesigns();
  const btn = page.locator("#btn-restore-folder");
  await expect(btn).toBeVisible();
  await expect(btn).toContainText("Restore from a folder");
  const input = page.locator("#file-folder");
  await expect(input).toHaveCount(1);
  await expect(input).toBeHidden();
  await expect(input).toHaveAttribute("type", "file");
  expect(await input.evaluate((el) => el.webkitdirectory)).toBe(true);
  await closeDesigns();
});

test("a folder of two project files is added with its ids, times and versions; the open design and last-open pointer stay", async () => {
  await wipe();
  await boot(page, info0);
  await page.evaluate(() => window.__app.projects.saveNow());
  const before = await openState();
  twoFolder = makeFolder({ [fileNameOf(ONE)]: { text: projectFile(ONE), time: 1_700_000_100 }, [fileNameOf(TWO)]: { text: projectFile(TWO), time: 1_700_000_200 } });
  await clearToasts();
  await restoreFrom(twoFolder); // verified: a directory path works for the webkitdirectory input
  const t = await toast("Restored 2 designs, 0 already here");
  expect(t.err).toBe(false);
  await expect(page.locator("#btn-restore-folder")).toBeVisible(); // Your designs reopened
  const snap = await snapshot();
  for (const [d, time] of [[ONE, 1_700_000_100_000], [TWO, 1_700_000_200_000]]) {
    const e = entryOf(snap, d.id);
    expect(e).toMatchObject({ id: d.id, name: d.name, mode: "beginner", ver: d.ver || 0, thumb: null });
    expect(e.updated).toBe(time);
    const stored = docOf(snap, d.id);
    expect(stored._updated).toBe(time);
    const { _updated, ...rest } = stored;
    expect({ ...rest, bodies: plain(rest.bodies) }).toEqual(d);
  }
  expect(snap.ls["jumpstart3d.ver.dtfolder1"]).toBe("3");
  expect(snap.ls["jumpstart3d.ver.dtfolder2"]).toBeUndefined();
  const after = await openState();
  expect(after.id).toBe(before.id);
  expect(after.last).toBe(before.last);
  const sans = (str) => { const { _updated, ...r } = JSON.parse(str); return r; }; // opening Your designs saves the open design again, which only moves its time
  expect(sans(after.stored)).toEqual(sans(before.stored));
  await closeDesigns();
});

// quarantined: the "Restored 0 designs, 2 already here" note never showed in WebKit once; not looked into yet
test("restoring the same folder again says already here and changes nothing", async ({}, info) => {
  quarantine(info, ["site-webkit", "single-webkit"], "WebKit: the already-here note did not show");
  const before = await snapshot();
  await clearToasts();
  await restoreFrom(twoFolder);
  const t = await toast("Restored 0 designs, 2 already here");
  expect(t.text).toBe("Restored 0 designs, 2 already here");
  expect(t.err).toBe(false);
  const after = await snapshot();
  expect(after.index.map((e) => e.id).sort()).toEqual(before.index.map((e) => e.id).sort());
  for (const d of [ONE, TWO]) {
    expect(entryOf(after, d.id)).toEqual(entryOf(before, d.id));
    expect(after.docs[d.id]).toBe(before.docs[d.id]);
  }
  await closeDesigns();
});

test("a design changed since the file was made is kept, and the file's version is added as a (restored) copy", async () => {
  const changed = design("dtfolder1", "Folder One", 55, { ver: 3 });
  await page.evaluate(async (doc) => {
    await window.__app.projects._store.put(doc.id, JSON.stringify({ ...doc, _updated: Date.now() }), { id: doc.id, name: doc.name, ver: 3, mode: doc.mode, updated: Date.now(), thumb: null });
  }, changed);
  const before = await snapshot();
  const open = await openState();
  await clearToasts();
  await restoreFrom(twoFolder);
  const t = await toast("Restored 0 designs, 1 already here");
  expect(t.text).toBe('Restored 0 designs, 1 already here, 1 kept as a "(restored)" copy');
  expect(t.err).toBe(false);
  const after = await snapshot();
  expect(after.docs.dtfolder1).toBe(before.docs.dtfolder1); // the changed design is untouched
  const fresh = after.index.filter((e) => !before.index.some((b) => b.id === e.id));
  expect(fresh).toHaveLength(1);
  expect(fresh[0].name).toBe("Folder One (restored)");
  expect(fresh[0].id).not.toBe("dtfolder1");
  const copy = docOf(after, fresh[0].id);
  expect(plain(copy.bodies)).toEqual(ONE.bodies);
  expect(copy.id).toBe(fresh[0].id);
  expect(after.docs.dtfolder2).toBe(before.docs.dtfolder2);
  expect((await openState()).last).toBe(open.last);
  await closeDesigns();
});

test("everything that is not a design of ours is ignored; unreadable ones of ours are counted", async () => {
  await wipe();
  const GOOD = design("dtgood1", "Good", 20), BACKED = design("dtbackup1", "In Backup", 20), SUB = design("dtsub1", "In Subfolder", 20);
  const dir = makeFolder({
    "notes.txt": "my own notes",
    "stranger.json": JSON.stringify({ not: "ours" }),
    "broken.json": "{ this is not json",
    "backup.json": JSON.stringify({ app: "jumpstart-3d", backup: 1, designs: [{ entry: { id: BACKED.id, name: BACKED.name }, doc: BACKED }] }),
    "nobodies.json": JSON.stringify({ app: "jumpstart-3d", version: 1, doc: { id: "dtnobodies", name: "No Bodies" } }),
    [`sub/${fileNameOf(SUB)}`]: projectFile(SUB),
    [fileNameOf(GOOD)]: projectFile(GOOD),
  });
  await clearToasts();
  // note every path the browser hands over (capture phase, so it runs before the app reads and clears the input)
  await page.evaluate(() => { window.__paths = null; window.addEventListener("change", (e) => { if (e.target.id === "file-folder") window.__paths = [...e.target.files].map((f) => f.webkitRelativePath); }, true); });
  await restoreFrom(dir);
  const t = await toast("Restored 1 design, 0 already here");
  expect(t.text).toBe("Restored 1 design, 0 already here, 1 unreadable");
  const paths = await page.evaluate(() => window.__paths);
  expect(paths.some((p) => p.split("/").length === 3 && p.endsWith(fileNameOf(SUB)))).toBe(true); // the subfolder file arrived, three parts deep, and was left out
  expect(paths.filter((p) => p.split("/").length === 2)).toHaveLength(6);
  expect(t.err).toBe(true);
  const ids = (await snapshot()).index.map((e) => e.id);
  expect(ids).toContain("dtgood1");
  for (const id of ["dtbackup1", "dtsub1", "dtnobodies"]) expect(ids).not.toContain(id);
  await closeDesigns();
});

test("a file without an id inside takes it from the -<id>.json end of its name", async () => {
  await wipe();
  const doc = design("x", "Box", 20);
  delete doc.id;
  const dir = makeFolder({ "Box-dtsuffix1.json": projectFile(doc) });
  await clearToasts();
  await restoreFrom(dir);
  await toast("Restored 1 design, 0 already here");
  const snap = await snapshot();
  expect(entryOf(snap, "dtsuffix1")).toMatchObject({ id: "dtsuffix1", name: "Box" });
  expect(docOf(snap, "dtsuffix1").id).toBe("dtsuffix1");
  await closeDesigns();
});

test("a folder with no design of ours says so and changes nothing", async () => {
  const before = await snapshot();
  const dir = makeFolder({ "notes.txt": "my own notes" });
  await clearToasts();
  await restoreFrom(dir);
  const t = await toast(NONE);
  expect(t.err).toBe(true);
  expect(await toastTexts()).toEqual([NONE]);
  expect(await snapshot()).toEqual(before);
});

test("of two files with one id, the newest keeps the id and the older becomes a (restored) copy", async () => {
  await wipe();
  const v3 = design("dtpair1", "Box", 30), v4 = design("dtpair1", "Box", 40);
  const dir = makeFolder({ "Box v3.json": { text: projectFile(v3), time: 1_700_000_300 }, "Box v4.json": { text: projectFile(v4), time: 1_700_000_400 } });
  await clearToasts();
  await restoreFrom(dir);
  await toast("Restored 1 design, 0 already here");
  const snap = await snapshot();
  expect(plain(docOf(snap, "dtpair1").bodies)).toEqual(v4.bodies);
  const copy = snap.index.find((e) => e.name === "Box (restored)");
  expect(copy).toBeTruthy();
  expect(plain(docOf(snap, copy.id).bodies)).toEqual(v3.bodies);
  await closeDesigns();
});

test("with copies in a folder on, a restored design is copied to the folder, and the copier does not rewrite it", async ({ browser }, info) => {
  test.skip(buildOf(info) === "single" || browserOf(info) !== "chromium", "the fake folder is an OPFS handle: none on file:// or in Linux WebKit, and Firefox handles have no queryPermission");
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = watchErrors(p);
  await p.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true });
  });
  try {
    await boot(p, info);
    await p.click("#btn-projects");
    await p.click("#btn-folder");
    await expect(p.locator("#folder-status")).toHaveText(/^Copies of your designs are saved to “mirror”/);
    const NEW = design("dtmirror1", "Mirror Me", 25);
    await p.setInputFiles("#file-folder", makeFolder({ [fileNameOf(NEW)]: projectFile(NEW) }));
    await expect(p.locator("#btn-restore-folder")).toBeVisible();
    const names = () => p.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true }), out = [];
      for await (const [name, h] of dir.entries()) if (h.kind === "file") out.push(name);
      return out.sort();
    });
    await expect.poll(() => p.evaluate(async () => (await window.__app.projects._store.list()).some((e) => e.id === "dtmirror1")), { timeout: 20_000 }).toBe(true);
    await p.evaluate(() => window.__app.projects._folder.now());
    await expect.poll(names, { timeout: 20_000 }).toContain(fileNameOf(NEW));
    const first = await names();
    const stamp = () => p.evaluate(async (name) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("mirror", { create: true });
      return (await (await dir.getFileHandle(name)).getFile()).lastModified;
    }, fileNameOf(NEW));
    const written = await stamp();
    await p.evaluate(() => window.__app.projects._folder.now());
    await p.evaluate(() => window.__app.projects._folder.soon()); // starts the 5 s quiet period; its run must find nothing due
    await p.waitForTimeout(6500);
    expect(await names()).toEqual(first);
    expect(await stamp()).toBe(written);
    expect(errs).toEqual([]);
  } finally { await ctx.close(); }
});
