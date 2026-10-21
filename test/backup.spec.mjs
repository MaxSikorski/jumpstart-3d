// Back up / Restore tests: Your designs saves every design in this browser into one file, and puts them back.
// Runs on both builds. Files are handed to the hidden input the way a user's picker would.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });
const file = (name, text) => ({ name, mimeType: "application/json", buffer: Buffer.from(typeof text === "string" ? text : JSON.stringify(text)) });
const NOT_BACKUP = "That isn't a JumpStart 3D backup file.";

// one page for the whole file: the kernel loads once. The tests build on each other (the backup from test 2 is restored in 3-5).
test.describe.configure({ mode: "serial" });
let page, errors, info0;
let backupFile; // the downloaded bytes, as text
let orig; // storage right after the backup was taken: { index, docs, vers } for the two seeded designs
const A = "t_Backup_Alpha", B = "t_Backup_Beta";

test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => {
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {}
    // record every toast as it appears: toasts vanish after a few seconds, so the tests read this list
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push({ text: n.textContent, err: n.classList.contains("err") }); })
        .observe(document.getElementById("toasts"), { childList: true });
    });
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

async function toast(prefix, timeout = 20_000) {
  await page.waitForFunction((p) => window.__toasts.some((t) => t.text.startsWith(p)), prefix, { timeout });
  return page.evaluate((p) => window.__toasts.find((t) => t.text.startsWith(p)), prefix);
}
const clearToasts = () => page.evaluate(() => { window.__toasts.length = 0; });
const restore = (f) => page.setInputFiles("#file-backup", f);
const openDesigns = () => page.click("#btn-projects");
const closeDesigns = async () => { if (await page.locator(".modal-back").count()) { await page.click(".modal-back .xbtn"); await expect(page.locator(".modal-back")).toHaveCount(0); } };

// every key that holds a design: the index, the docs, the version counters, the last-open id (never UI settings)
const snapshot = () => page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) if (k.startsWith("workplane.") || k.startsWith("jumpstart3d.ver.")) out[k] = localStorage.getItem(k);
  return out;
});
const wipe = () => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("workplane.") || k.startsWith("jumpstart3d.ver.")) localStorage.removeItem(k); });
const index = () => page.evaluate(() => JSON.parse(localStorage.getItem("workplane.index.v1") || "[]"));
// what the two seeded designs look like in storage
const mine = (snap) => ({
  index: JSON.parse(snap["workplane.index.v1"] || "[]").filter((e) => e.id === A || e.id === B).sort((x, y) => x.id.localeCompare(y.id)),
  docs: { [A]: snap["workplane.doc.v1." + A], [B]: snap["workplane.doc.v1." + B] },
  vers: { [A]: snap["jumpstart3d.ver." + A], [B]: snap["jumpstart3d.ver." + B] },
});

test("Your designs has Back up and Restore buttons and a hidden file picker", async () => {
  await wipe();
  await boot(page, info0);
  await openDesigns();
  const backup = page.locator("#btn-backup"), restoreBtn = page.locator("#btn-restore");
  await expect(backup).toBeVisible();
  await expect(backup).toContainText("Back up all designs");
  await expect(restoreBtn).toBeVisible();
  await expect(restoreBtn).toContainText("Restore from backup");
  const input = page.locator("#file-backup");
  await expect(input).toHaveCount(1);
  await expect(input).toBeHidden();
  await expect(input).toHaveAttribute("type", "file");
  expect(await input.getAttribute("accept")).toContain(".json");
  await closeDesigns();
});

test("Back up all designs downloads one dated file with every design in it", async () => {
  // two designs, saved the way the app saves them; the blank design the app opens with is dropped so the count is exact
  await loadDoc(page, newDoc("Backup Alpha", "beginner", { bodies: [body("b1", "Slab", box(30, 20, 5))] }));
  await page.evaluate(() => window.__app.projects.saveNow());
  await loadDoc(page, newDoc("Backup Beta", "beginner", { bodies: [body("b1", "Cube", box(10, 10, 10)), body("b2", "Bar", box(40, 5, 5))] }));
  await page.evaluate(() => window.__app.projects.saveNow());
  await page.evaluate(([a, b]) => {
    localStorage.setItem("jumpstart3d.ver." + a, "3");
    localStorage.setItem("jumpstart3d.ver." + b, "2");
    const keep = JSON.parse(localStorage.getItem("workplane.index.v1")).filter((e) => e.id === a || e.id === b);
    localStorage.setItem("workplane.index.v1", JSON.stringify(keep));
  }, [A, B]);
  expect((await index()).map((e) => e.id).sort()).toEqual([A, B]);

  await openDesigns();
  await clearToasts();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#btn-backup")]);
  expect(dl.suggestedFilename()).toBe(`jumpstart-3d-backup-${new Date().toLocaleDateString("en-CA")}.json`);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  backupFile = Buffer.concat(chunks).toString("utf8");
  const j = JSON.parse(backupFile);
  expect(j.app).toBe("jumpstart-3d");
  expect(j.backup).toBe(1);
  expect(j.designs).toHaveLength(2);
  for (const d of j.designs) {
    expect(typeof d.entry.id).toBe("string");
    expect(Array.isArray(d.doc.bodies)).toBe(true);
    expect(typeof d.doc._updated).toBe("number");
    expect(d.doc.id).toBe(d.entry.id);
  }
  expect(j.designs.map((d) => d.entry.id).sort()).toEqual([A, B]);
  const t = await toast("Backed up 2 designs");
  expect(t.err).toBe(false);
  await closeDesigns();
  orig = mine(await snapshot()); // storage as the file describes it
  expect(orig.index).toHaveLength(2);
  expect(orig.vers).toEqual({ [A]: "3", [B]: "2" });
});

test("restoring into an empty browser brings back both designs exactly", async () => {
  await wipe();
  await boot(page, info0);
  expect(mine(await snapshot()).index).toEqual([]);
  await clearToasts();
  await restore(file("backup.json", backupFile));
  const t = await toast("Restored 2 designs");
  expect(t.err).toBe(false);
  await expect(page.locator(".projgrid .pcard")).toHaveCount(3); // the two restored and the design that was open
  await closeDesigns();
  const after = mine(await snapshot());
  expect(after.index).toEqual(orig.index);
  expect(after.docs).toEqual(orig.docs); // byte for byte, _updated included
  expect(after.vers).toEqual(orig.vers);
});

test("restoring the same file again adds nothing", async () => {
  const before = await snapshot();
  const count = (await index()).length;
  await clearToasts();
  await restore(file("backup.json", backupFile));
  const t = await toast("Restored 0 designs, 2 already here");
  expect(t.err).toBe(false);
  await closeDesigns();
  expect((await index()).length).toBe(count);
  const after = await snapshot();
  expect(mine(after)).toEqual(mine(before));
});

test("a design that changed since the backup is kept and the old one comes back as a (restored) copy", async () => {
  // edit design A in place (name and a body), in its doc and in the index
  const edited = await page.evaluate((a) => {
    const doc = JSON.parse(localStorage.getItem("workplane.doc.v1." + a));
    doc.name = "Backup Alpha edited";
    doc.bodies[0].name = "Slab edited"; // a real change, not just a rename
    const s = JSON.stringify(doc);
    localStorage.setItem("workplane.doc.v1." + a, s);
    const idx = JSON.parse(localStorage.getItem("workplane.index.v1"));
    idx.find((e) => e.id === a).name = doc.name;
    localStorage.setItem("workplane.index.v1", JSON.stringify(idx));
    return s;
  }, A);
  const idsBefore = (await index()).map((e) => e.id);
  await clearToasts();
  await restore(file("backup.json", backupFile));
  const t = await toast("Restored ");
  expect(t.text).toContain('kept as a "(restored)" copy');
  expect(t.text).toContain("1 already here"); // design B
  await expect(page.locator(".projgrid .pcard", { hasText: "Backup Alpha (restored)" })).toHaveCount(1);
  await closeDesigns();
  const idx = await index();
  expect(idx).toHaveLength(idsBefore.length + 1);
  const copy = idx.find((e) => e.name === "Backup Alpha (restored)");
  expect(copy).toBeTruthy();
  expect(idsBefore).not.toContain(copy.id);
  expect(idx.find((e) => e.id === A).name).toBe("Backup Alpha edited");
  const snap = await snapshot();
  expect(snap["workplane.doc.v1." + A]).toBe(edited); // untouched
  expect(snap["workplane.doc.v1." + B]).toBe(orig.docs[B]);
  const copyDoc = JSON.parse(snap["workplane.doc.v1." + copy.id]);
  expect(copyDoc.id).toBe(copy.id);
  expect(copyDoc.name).toBe("Backup Alpha (restored)");
  expect(copyDoc.bodies.map((b) => b.name)).toEqual(["Slab"]);
});

test("restoring the same file once more does not stack another copy, and the last-open design is left alone", async () => {
  const cards = async () => { await openDesigns(); const c = await page.locator(".projgrid .pcard").count(); await closeDesigns(); return c; };
  const last = () => page.evaluate(() => localStorage.getItem("workplane.pref.v1.last"));
  const idsBefore = (await index()).map((e) => e.id), cardsBefore = await cards(), lastBefore = await last();
  await clearToasts();
  await restore(file("backup.json", backupFile));
  const t = await toast("Restored 0 designs, 2 already here");
  expect(t.err).toBe(false);
  expect(t.text).not.toContain("(restored)");
  await closeDesigns();
  expect((await index()).map((e) => e.id)).toEqual(idsBefore);
  expect(await cards()).toBe(cardsBefore);
  expect(await last()).toBe(lastBefore);
});

test("a backup from a newer version of the app is refused with its own message", async () => {
  const before = await snapshot();
  await clearToasts();
  await restore(file("future.json", { ...JSON.parse(backupFile), backup: 2 }));
  const t = await toast("This backup is from a newer version of the app; update first.");
  expect(t.err).toBe(true);
  expect(await snapshot()).toEqual(before);
});

test("a file that is not a backup is refused and nothing changes", async () => {
  await closeDesigns();
  const before = await snapshot();

  await clearToasts();
  await restore(file("garbage.json", "this is { not json"));
  let t = await toast(NOT_BACKUP);
  expect(t.err).toBe(true);

  await clearToasts();
  await restore(file("project.json", { app: "jumpstart-3d", version: 1, doc: newDoc("Just a project", "beginner") }));
  t = await toast(NOT_BACKUP);
  expect(t.err).toBe(true);

  await clearToasts();
  await restore(file("wrong.json", { app: "jumpstart-3d", backup: 1, designs: "no" }));
  t = await toast(NOT_BACKUP);
  expect(t.err).toBe(true);
  expect(await snapshot()).toEqual(before);

  // the other way round: Open a project file… given a backup says what it is
  await clearToasts();
  await page.setInputFiles("#file-import", file("backup.json", backupFile));
  t = await toast("That is a backup file");
  expect(t.err).toBe(true);
  expect(t.text).toContain("Restore from backup");
  await page.waitForTimeout(300);
  expect(await snapshot()).toEqual(before);
});

test("a design that does not fit in browser storage is counted, not added", async () => {
  await closeDesigns();
  const j = JSON.parse(backupFile);
  const id = "t_Backup_Quota";
  const d = j.designs[0];
  d.entry = { ...d.entry, id, name: "Too big" };
  d.doc = { ...d.doc, id, name: "Too big" };
  const one = { ...j, designs: [d] };
  const before = await snapshot();
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith("workplane.doc.v1.")) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return window.__realSetItem.call(this, k, v);
    };
  });
  try {
    await clearToasts();
    await restore(file("one.json", one));
    const t = await toast("Restored ");
    expect(t.text).toContain("did not fit");
    expect(t.err).toBe(true);
    await closeDesigns();
    const after = await snapshot();
    const ids = (await index()).map((e) => e.id);
    expect(ids).not.toContain(id);
    expect(ids.sort()).toEqual(JSON.parse(before["workplane.index.v1"]).map((e) => e.id).sort()); // the open design is re-saved, nothing else is added
    expect(after["workplane.doc.v1." + id]).toBeUndefined();
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  }
});

test("when the index cannot be saved, nothing is left behind and the toast says so", async () => {
  await closeDesigns();
  const j = JSON.parse(backupFile);
  j.designs = ["t_Backup_New1", "t_Backup_New2"].map((id, i) => ({ ...j.designs[i], entry: { ...j.designs[i].entry, id, name: "New " + id }, doc: { ...j.designs[i].doc, id, name: "New " + id }, ver: 4 }));
  const keys = (snap) => Object.keys(snap).filter((k) => k.startsWith("workplane.doc.v1.") || k.startsWith("jumpstart3d.ver.")).sort();
  const before = await snapshot();
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "workplane.index.v1") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return window.__realSetItem.call(this, k, v);
    };
  });
  try {
    await clearToasts();
    await restore(file("two.json", j));
    const t = await toast("Restored ");
    expect(t.text).toContain("did not fit");
    expect(t.text).toContain("Restored 0 designs");
    expect(t.err).toBe(true);
    await closeDesigns();
    const after = await snapshot();
    expect(keys(after)).toEqual(keys(before)); // no new doc or version keys
    expect(after["workplane.index.v1"]).toBe(before["workplane.index.v1"]);
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  }
});
