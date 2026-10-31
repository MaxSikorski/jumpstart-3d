// The single file's backup reminder (src/backupnudge.js): when the browser is online and designs have changed since they were last
// backed up, a quiet note offers a backup file or folder copies. Single file only: the website never shows it. The rule itself
// (dates, changed designs, answers) is backupnudge.test.mjs; this file checks the note, its buttons and what they store.
// A browser under automation never shows the note unless the page opts in with the key below, so no other spec has it over a click;
// these tests opt in (the note then needs no start delay or quiet time) and call `__app.backupNudge.check()` after changing designs.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim, buildOf } from "./helpers.mjs";

const KEY = "jumpstart.backupnudge", TEST_KEY = "jumpstart.backupnudge.test";
const DAY = 24 * 3600 * 1000;
const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });

test.describe.configure({ mode: "serial" });
let page, errors, info0;

test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(([key, testKey]) => {
    try {
      localStorage.setItem("jumpstart.chisel.intro", "1");
      localStorage.setItem(testKey, "1");
      // a first start has just "asked", so the note does not appear before a test has set the scene
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ asked: Date.now() }));
    } catch (e) {}
  }, [KEY, TEST_KEY]);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const nudge = () => page.locator("#backup-nudge");
const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
const setState = (s) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, s]);
const check = () => page.evaluate(() => window.__app.backupNudge.check());
const count = () => page.evaluate(async () => (await window.__app.projects._store.list()).length);
const openDesigns = () => page.click("#btn-projects");
const closeDesigns = async () => { if (await page.locator(".modal-back").count()) { await page.click(".modal-back .xbtn"); await expect(page.locator(".modal-back")).toHaveCount(0); } };
// a design saved the way the app saves it; the same name again is the same design, edited
const seed = async (name, part) => {
  await loadDoc(page, newDoc(name, "beginner", { bodies: [body("b1", part, box(10, 10, 10))] }));
  await page.evaluate(() => window.__app.projects.saveNow());
};
const after = (t) => page.waitForFunction((t) => Date.now() > t, t); // a later save gets a later time stamp
// the note is gone for good: answered with a button, so the next check finds nothing to show
const clear = async () => {
  if (await nudge().count()) { await page.click("#nudge-later"); await expect(nudge()).toHaveCount(0); }
};

test.describe("single file", () => {
  test.beforeEach(({}, info) => { test.skip(buildOf(info) !== "single", "the reminder exists in the double-click file only"); });

  test("online with new designs: 'You're online. Back up your N designs?' with its buttons, once", async () => {
    await clear();
    await seed("Nudge A", "Slab");
    await seed("Nudge B", "Cube");
    const n = await count();
    expect(n).toBeGreaterThanOrEqual(2);
    await setState({});
    await check();
    await expect(nudge()).toBeVisible();
    await expect(page.locator("#backup-nudge-text")).toHaveText(`You're online. Back up your ${n} designs?`);
    await expect(nudge()).toHaveAttribute("aria-label", "Backup reminder");
    await expect(page.locator("#nudge-file")).toHaveText("Save a backup file");
    await expect(page.locator("#nudge-later")).toHaveText("Not now");
    await expect(page.locator("#nudge-never")).toHaveText("Don't ask again");
    // the folder button is there where the browser can copy into a folder (and no folder is set up yet), nowhere else
    const folder = await page.evaluate(async () => { const i = await window.__app.projects._folder.info(); return i.supported && !i.chosen; });
    await expect(page.locator("#nudge-folder")).toHaveCount(folder ? 1 : 0);
    if (folder) await expect(page.locator("#nudge-folder")).toHaveText("Save copies into a folder");
    const s = await state();
    expect(Math.abs(s.asked - Date.now())).toBeLessThan(60_000); // shown: the next ask is a day away
    await check();
    await expect(nudge()).toHaveCount(1); // checking again does not stack a second note
    await expect(page.locator(".backup-nudge")).toHaveCount(1);
    await page.click("#nudge-later");
  });

  test("Not now hides it; it asks again only after a day and only if a design changed", async () => {
    await clear();
    await setState({});
    await check();
    await expect(nudge()).toBeVisible();
    const before = Date.now();
    await page.click("#nudge-later");
    await expect(nudge()).toHaveCount(0);
    let s = await state();
    expect(s.answered).toBeGreaterThanOrEqual(before - 1000);
    expect(s.asked).toBeGreaterThanOrEqual(before - 1000);
    expect(s.never).toBeFalsy();

    await check();
    await expect(nudge()).toHaveCount(0); // asked a moment ago
    await page.evaluate(() => window.__app.projects.saveNow()); // nothing of the open design is left to autosave later
    const answered = await page.evaluate(() => Date.now());
    await setState({ answered, asked: answered - 2 * DAY });
    await check();
    await expect(nudge()).toHaveCount(0); // a day has passed, but nothing changed since the answer
    await after(answered);
    await seed("Nudge A", "Slab edited");
    await check();
    await expect(nudge()).toBeVisible(); // a design changed
    await page.click("#nudge-later");
    await expect(nudge()).toHaveCount(0);
  });

  test("Save a backup file downloads the backup, hides the note and counts as backed up", async () => {
    await clear();
    await setState({});
    await check();
    await expect(nudge()).toBeVisible();
    const t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#nudge-file")]);
    expect(dl.suggestedFilename()).toBe(`jumpstart-3d-backup-${new Date().toLocaleDateString("en-CA")}.json`);
    await expect(nudge()).toHaveCount(0);
    const s = await state();
    expect(s.backedUp).toBeGreaterThanOrEqual(t0 - 1000);
    expect(s.backedUp).toBeLessThanOrEqual(Date.now());
    expect(s.answered).toBeGreaterThanOrEqual(t0 - 1000);
    await setState({ ...s, asked: Date.now() - 2 * DAY });
    await check();
    await expect(nudge()).toHaveCount(0); // nothing changed since the backup
  });

  test("a backup made in Your designs counts too", async () => {
    await clear();
    await setState({ asked: Date.now() - 2 * DAY }); // never backed up, a day since the last ask
    await check();
    await expect(nudge()).toBeVisible();
    await page.click("#nudge-later"); // out of the way for the Your designs click
    await setState({ asked: Date.now() - 2 * DAY });
    const t0 = Date.now();
    await openDesigns();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#btn-backup")]);
    expect(dl.suggestedFilename()).toMatch(/^jumpstart-3d-backup-\d{4}-\d\d-\d\d\.json$/);
    await closeDesigns();
    expect((await state()).backedUp).toBeGreaterThanOrEqual(t0 - 1000);
    await check();
    await expect(nudge()).toHaveCount(0);
  });

  test("Don't ask again lasts across a reload and can be turned on again in Your designs", async () => {
    await clear();
    await setState({});
    await check();
    await expect(nudge()).toBeVisible();
    await page.click("#nudge-never");
    await expect(nudge()).toHaveCount(0);
    expect((await state()).never).toBe(true);

    await boot(page, info0); // a fresh document of the same page
    expect((await state()).never).toBe(true);
    await seed("Nudge A", "after never");
    await check();
    await expect(nudge()).toHaveCount(0);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("jumpstart.backupnudge")); s.asked = 0; localStorage.setItem("jumpstart.backupnudge", JSON.stringify(s)); });
    await check();
    await expect(nudge()).toHaveCount(0); // a day since the last ask changes nothing

    await openDesigns();
    await expect(page.locator("#nudge-row")).toContainText("Backup reminders are off");
    await page.click("#btn-nudge-on");
    await expect(page.locator("#nudge-row")).toHaveCount(0);
    expect((await state()).never).toBe(false);
    await closeDesigns();
    await check();
    await expect(nudge()).toBeVisible(); // on again, and a design was saved after the answer
    await page.click("#nudge-later");
  });

  test("offline it stays away; when the browser reports it is online again, it shows", async () => {
    await clear();
    await setState({});
    await page.context().setOffline(true);
    try {
      await page.waitForFunction(() => navigator.onLine === false);
      await check();
      await expect(nudge()).toHaveCount(0);
    } finally { await page.context().setOffline(false); }
    await page.waitForFunction(() => navigator.onLine === true);
    await page.evaluate(() => window.dispatchEvent(new Event("online"))); // Chromium sends it too; this makes sure the page has heard it
    await expect(nudge()).toBeVisible();
    await page.click("#nudge-later");
  });

  test("it makes no network request of its own", async () => {
    await clear();
    await setState({});
    const requests = [];
    const onRequest = (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) requests.push(r.url()); };
    page.on("request", onRequest);
    try {
      await check();
      await expect(nudge()).toBeVisible();
      await page.click("#nudge-later");
      await expect(nudge()).toHaveCount(0);
    } finally { page.off("request", onRequest); }
    expect(requests).toEqual([]);
  });

  test("Save copies into a folder uses the folder flow: chosen hides the note, a cancelled picker leaves it", async () => {
    await clear();
    await setState({});
    await check();
    await expect(nudge()).toBeVisible();
    test.skip(await page.locator("#nudge-folder").count() === 0, "this browser has no folder picker");
    // the flow itself is folder.spec.mjs; here only the hand-off is checked, with the flow answering for the picker
    await page.evaluate(() => { window.__nudgeFolderCalls = 0; window.__nudgeFolderAnswer = false; window.__app.projects._folder.choose = async () => { window.__nudgeFolderCalls++; return window.__nudgeFolderAnswer; }; });
    await page.click("#nudge-folder");
    await expect.poll(() => page.evaluate(() => window.__nudgeFolderCalls)).toBe(1);
    await expect(nudge()).toBeVisible(); // cancelled: still there
    await page.evaluate(() => { window.__nudgeFolderAnswer = true; });
    const t0 = Date.now();
    await page.click("#nudge-folder");
    await expect(nudge()).toHaveCount(0);
    expect((await state()).answered).toBeGreaterThanOrEqual(t0 - 1000);
  });

  test("storage that refuses writes never throws into the page", async () => {
    await clear();
    await setState({});
    await page.evaluate((k) => {
      const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
      window.__restoreStorage = () => { Storage.prototype.setItem = set; Storage.prototype.getItem = get; };
      Storage.prototype.setItem = function (key, v) { if (key === k) throw new DOMException("full", "QuotaExceededError"); return set.call(this, key, v); };
      Storage.prototype.getItem = function (key) { if (key === k) throw new DOMException("blocked", "SecurityError"); return get.call(this, key); };
    }, KEY);
    try {
      await check();
      await expect(nudge()).toBeVisible(); // reads fail: treated as nothing stored; the write fails quietly
      await page.click("#nudge-later");
      await expect(nudge()).toHaveCount(0);
      await page.click("#btn-projects"); // the Your designs row asks the same storage
      await expect(page.locator(".modal-back")).toHaveCount(1);
      await closeDesigns();
    } finally { await page.evaluate(() => window.__restoreStorage()); }
  });

  test("a browser under automation without the opt-in never shows it", async ({ browser }) => {
    const p = await browser.newPage();
    const errs = watchErrors(p);
    try {
      await p.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
      await boot(p, info0);
      expect(await p.evaluate(() => window.__app.backupNudge)).toBeNull();
      expect(await p.locator("#backup-nudge").count()).toBe(0);
      expect(errs).toEqual([]);
    } finally { await p.close(); }
  });
});

test.describe("website", () => {
  test.beforeEach(({}, info) => { test.skip(buildOf(info) !== "site", "checked on the website build"); });

  test("it never shows on the website, even when online with changed designs and opted in", async () => {
    await seed("Nudge Site", "Slab");
    expect(await page.evaluate(() => window.__app.backupNudge)).toBeNull();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1500)); return document.querySelectorAll("#backup-nudge, #backup-nudge-css").length; })).toBe(0);
    await openDesigns();
    await expect(page.locator("#btn-backup")).toBeVisible(); // Your designs works as before
    await expect(page.locator("#nudge-row")).toHaveCount(0);
    await closeDesigns();
  });
});
