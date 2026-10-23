// Share link, through the real UI on both builds (the codec and the limits are in test/sharelink.test.mjs).
//
// What a person gets: Open/Export > Share link… puts a small design into a link that nothing uploaded; a friend opens the link in a
// fresh browser (or pastes it into Import shared link in the downloaded file), is asked first, and the design opens as a NEW design:
// same shapes (the STL bytes match the sender's and the golden export), the friend's own design untouched, nothing sent anywhere.
// The receivers are fresh browser contexts that are given nothing but the link: no document through evaluate, no storage seeding.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { boot, watchErrors, loadDoc, newDoc, body, prim, bodies, waitIdle, exportBytes, sha256, navigateKeepingStorage } from "./helpers.mjs";

const projectsDir = new URL("./projects/", import.meta.url);
const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const fixture = (name) => { const j = JSON.parse(readFileSync(new URL(name + ".json", projectsDir), "utf8")); return j.doc || j; };
const SITE = "https://maxsikorski.github.io/jumpstart-3d/";
const utf8 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o));
const envOf = (doc) => ({ app: "jumpstart-3d", version: 1, doc });
const fragOf = (codec, bytes) => `js3d=v1.${codec}.${Buffer.from(bytes).toString("base64url")}`;
const volumesOf = (list) => list.filter((b) => !b.hole).map((b) => b.volume).sort((a, b) => a - b);

test.describe.configure({ mode: "serial" });
let sender, senderErrors, info0, senderRequests;

test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  sender = await browser.newPage();
  senderErrors = watchErrors(sender);
  senderRequests = [];
  sender.on("request", (r) => senderRequests.push(r.url()));
  await sender.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(sender, info);
});
test.afterAll(async () => { await sender?.close(); });
test.afterEach(() => { expect(senderErrors, "console or page errors on the sender's page").toEqual([]); });

const fragmentOf = (link) => link.slice(link.indexOf("#") + 1);
const receiverUrl = (frag, query = "") => info0.project.use.baseURL + query + "#" + frag;
const isSite = () => info0.project.name === "site";

// the page is ready once the kernel is up and the saved design is loaded (the offer comes right after)
async function ready(page) {
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await page.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  await page.waitForFunction(() => window.__app.projects.started === true, null, { timeout: 20_000 });
}
// a browser that has never seen the app, given a link and nothing else
async function receiver(browser, { frag, init, query } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = watchErrors(page);
  const requests = [];
  page.on("request", (r) => requests.push(r.url() + " " + (r.postData() || "")));
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  if (init) await page.addInitScript(init);
  if (frag !== undefined) { await page.goto(receiverUrl(frag, query)); await ready(page); }
  return { context, page, errors, requests };
}
const storedDesigns = (page) => page.evaluate(async () => { const s = window.__app.projects._store; await s.ready; const out = []; for (const e of await s.list()) out.push({ id: e.id, name: e.name, doc: JSON.parse(await s.get(e.id)) }); return out; });
// no link is waiting for a decision: nothing was captured, so no question can still arrive (nothing to wait for)
const noLinkPending = (page) => page.evaluate(() => !window.__app.sharelink.busy());
const withoutStamp = ({ _updated, ...rest }) => rest;
const openDoc = (page) => page.evaluate(() => ({ id: window.__store.doc.id, name: window.__store.doc.name, mode: window.__store.doc.mode, ver: window.__store.doc.ver, created: window.__store.doc.created, bodies: window.__store.doc.bodies.length }));
async function stlOf(page) {
  await waitIdle(page);
  expect((await bodies(page)).filter((b) => b.error), "kernel errors").toEqual([]);
  return sha256((await exportBytes(page, "stl")).bytes);
}

// the sender's side: open the design, take its STL, and make the link through Open/Export > Share link…
async function share(doc) {
  await loadDoc(sender, doc);
  const list = await bodies(sender);
  expect(list.filter((b) => b.error), "kernel errors on the sender").toEqual([]);
  const stl = sha256((await exportBytes(sender, "stl")).bytes);
  await sender.click("#btn-export");
  await sender.click("#btn-share-link");
  await expect(sender.locator("#share-dialog")).toBeVisible();
  await expect(sender.locator("#share-copy")).toBeEnabled();
  const link = await sender.inputValue("#share-url");
  const note = await sender.textContent("#share-note");
  await sender.keyboard.press("Escape");
  await expect(sender.locator("#share-dialog")).toHaveCount(0);
  return { link, frag: fragmentOf(link), note, stl, volumes: volumesOf(list), params: doc.params || [] };
}
const unicodeName = "Café ✓ 日本語 — ブラケット 🔩";
const unicode = (doc) => { const d = structuredClone(doc); d.name = unicodeName; d.bodies.forEach((b, i) => { b.name = `${unicodeName} ${i + 1}`; }); return d; };

const CASES = [
  { file: "beginner-peg-block", make: fixture, what: "Beginner" },
  { file: "advanced-wall-bracket", make: (f) => unicode(fixture(f)), what: "Advanced, with Unicode names" },
  { file: "parametric-features", make: fixture, what: "parameters" },
  { file: "import-stl-mesh", make: fixture, what: "an embedded model" },
];

for (const c of CASES) {
  test(`a link from the sender opens in a fresh browser as a new design with the same shapes: ${c.file} (${c.what})`, async ({ browser }) => {
    const doc = c.make(c.file);
    const g = golden[c.file + ".json"];
    const s = await share(doc);
    expect(s.stl, "the sender's STL is the golden export").toBe(g.stl);
    expect(s.link.length).toBeLessThanOrEqual(4096);
    expect(s.frag).toMatch(/^js3d=v1\.d\.[A-Za-z0-9_-]+$/);
    if (isSite()) expect(s.link.startsWith(info0.project.use.baseURL + "#js3d=")).toBe(true);
    else {
      // the downloaded file shares the community website's address, never a path on this computer
      expect(s.link.startsWith(SITE + "#js3d=v1.d.")).toBe(true);
      expect(s.link).not.toMatch(/file:|\/Users\/|\\|dist\/|\.html/);
      expect(s.note).toContain("This link opens the community website. To open it in this offline copy, paste it into Import shared link.");
    }
    const r = await receiver(browser, { frag: s.frag });
    try {
      const { page } = r;
      await expect(page.locator("#share-offer")).toBeVisible();
      await expect(page.locator("#share-offer-name")).toHaveText(doc.name);
      // nothing has opened and nothing has been stored for it yet
      expect(await openDoc(page)).toMatchObject({ name: "Untitled", bodies: 0 });
      expect((await storedDesigns(page)).map((d) => d.name)).not.toContain(doc.name);
      expect(await page.evaluate(() => window.__app.scene.views.size)).toBe(0);
      if (isSite()) expect(await page.evaluate(() => location.hash)).toBe(""); // taken off the address bar
      await page.click("#share-accept");
      await expect(page.locator("#share-offer")).toHaveCount(0);
      const open = await openDoc(page);
      expect(open).toMatchObject({ name: doc.name, mode: doc.mode, ver: 0 });
      expect(open.id).not.toBe(doc.id); // the sender's id never identifies a local design
      expect(await stlOf(page), "the receiver's STL is the sender's").toBe(s.stl);
      expect(volumesOf(await bodies(page))).toEqual(s.volumes);
      expect(volumesOf(await bodies(page))).toEqual(Object.values(g.volumes).sort((a, b) => a - b));
      const received = await page.evaluate(() => window.__store.doc);
      expect(received.params.map((p) => [p.name, p.expr])).toEqual((doc.params || []).map((p) => [p.name, p.expr]));
      expect(Object.keys(received.assets || {})).toEqual(Object.keys(doc.assets || {}));
      expect((await storedDesigns(r.page)).map((d) => d.id)).toContain(open.id);
      expect(r.errors, "console or page errors on the receiver").toEqual([]);
    } finally { await r.context.close(); }
  });
}

test("Import shared link: a complete link pasted into the dialog opens the same way, also with copying denied", async ({ browser }) => {
  const doc = fixture("beginner-peg-block");
  const s = await share(doc);
  const r = await receiver(browser, { init: () => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }, configurable: true }); } });
  try {
    const { page } = r;
    await page.goto(info0.project.use.baseURL);
    await ready(page);
    await expect(page.locator("#share-offer")).toHaveCount(0); // no link: nothing offered
    // copying denied: the link stays selected and the dialog says how to copy it by hand
    await loadDoc(page, doc);
    await page.click("#btn-export");
    await page.click("#btn-share-link");
    await expect(page.locator("#share-copy")).toBeEnabled();
    await page.click("#share-copy");
    await expect(page.locator("#share-note")).toContainText("did not allow copying");
    expect(await page.evaluate(() => document.activeElement.id)).toBe("share-url");
    expect(await page.evaluate(() => { const f = document.getElementById("share-url"); return f.value.slice(f.selectionStart, f.selectionEnd).length === f.value.length; })).toBe(true);
    // paste the sender's complete link, with other words around it
    await page.fill("#share-paste", `look at this: ${s.link} (from Maria)`);
    await page.click("#share-import");
    await expect(page.locator("#share-offer")).toBeVisible();
    await expect(page.locator("#share-offer-name")).toHaveText(doc.name);
    await page.click("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect(await stlOf(page)).toBe(s.stl);
    expect(r.requests.filter((u) => u.includes("js3d")), "requests that carry the link").toEqual([]);
    expect(r.errors).toEqual([]);
  } finally { await r.context.close(); }
});

test("Copy link hands the link to the clipboard, and opening the dialog saves nothing", async ({ browser }) => {
  const r = await receiver(browser, { init: () => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); } });
  try {
    const { page } = r;
    await page.goto(info0.project.use.baseURL);
    await ready(page);
    await loadDoc(page, fixture("beginner-box"));
    const stored = (await storedDesigns(page)).length;
    await page.evaluate(() => { const s = window.__app.projects._store, put = s.put.bind(s); window.__puts = 0; s.put = (...a) => { window.__puts++; return put(...a); }; });
    await page.click("#btn-export");
    await page.click("#btn-share-link");
    await expect(page.locator("#share-copy")).toBeEnabled();
    const link = await page.inputValue("#share-url");
    await page.click("#share-copy");
    await expect.poll(() => page.evaluate(() => window.__copied)).toBe(link);
    // making a link is not a save: no version, no new design in the list
    expect(await page.evaluate(() => window.__store.doc.ver || 0)).toBe(0);
    await page.waitForTimeout(1500); // no event marks "a save that never comes": the write counter below says nothing was written in that time
    expect(await page.evaluate(() => window.__puts), "storage writes while making a link").toBe(0);
    expect((await storedDesigns(page)).length).toBe(stored);
    // the counter does see a real save, so the zero above means something
    await page.evaluate(() => window.__app.projects.saveNow());
    await expect.poll(() => page.evaluate(() => window.__puts)).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
  } finally { await r.context.close(); }
});

test("no raw compression: a small design makes a tagged j link that opens; a bigger one is offered as a project file", async ({ browser }) => {
  const noStreams = () => { class Refuse { constructor() { throw new TypeError("Unsupported compression format: 'deflate-raw'"); } } Object.defineProperty(window, "CompressionStream", { value: Refuse, configurable: true, writable: true }); Object.defineProperty(window, "DecompressionStream", { value: undefined, configurable: true, writable: true }); };
  const r1 = await receiver(browser, { init: noStreams });
  try {
    const { page } = r1;
    await page.goto(info0.project.use.baseURL);
    await ready(page);
    const doc = fixture("beginner-peg-block");
    await loadDoc(page, doc);
    const want = sha256((await exportBytes(page, "stl")).bytes);
    await page.click("#btn-export");
    await page.click("#btn-share-link");
    await expect(page.locator("#share-copy")).toBeEnabled();
    const link = await page.inputValue("#share-url");
    expect(link).toMatch(/#js3d=v1\.j\./);
    await expect(page.locator("#share-note")).toContainText("can't compress");
    // a larger design: no link, the file fallback is offered at once, and it opens to the same shapes
    await page.keyboard.press("Escape");
    const big = fixture("nameplate");
    await loadDoc(page, big);
    const bigStl = sha256((await exportBytes(page, "stl")).bytes);
    expect(bigStl).toBe(golden["nameplate.json"].stl);
    await page.click("#btn-export");
    await page.click("#btn-share-link");
    await expect(page.locator("#share-note")).toContainText("too large for a reliable share link. Send a project file instead.");
    expect(await page.inputValue("#share-url")).toBe("");
    await expect(page.locator("#share-copy")).toBeDisabled();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#share-file")]);
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    const file = { name: dl.suggestedFilename(), mimeType: "application/json", buffer: Buffer.concat(chunks) };
    expect(file.name).toMatch(/\.json$/);
    // the j link, in a fresh browser that also has no raw compression
    const r2 = await receiver(browser, { frag: fragmentOf(link), init: noStreams });
    try {
      await expect(r2.page.locator("#share-offer")).toBeVisible();
      await r2.page.click("#share-accept");
      await expect(r2.page.locator("#share-offer")).toHaveCount(0);
      expect(await stlOf(r2.page)).toBe(want);
      // and the fallback file opens through Open a project file
      await r2.page.setInputFiles("#file-import", file);
      await expect.poll(async () => (await openDoc(r2.page)).name).toBe(big.name);
      expect(await stlOf(r2.page)).toBe(bigStl);
      expect(r2.errors).toEqual([]);
    } finally { await r2.context.close(); }
  } finally { await r1.context.close(); }
});

test("a d link opens in a browser with no native decompression (the bounded pure-JS decoder)", async ({ browser }) => {
  const doc = fixture("advanced-wall-bracket");
  const s = await share(doc);
  const r = await receiver(browser, { frag: s.frag, init: () => { Object.defineProperty(window, "DecompressionStream", { value: undefined, configurable: true, writable: true }); } });
  try {
    await expect(r.page.locator("#share-offer")).toBeVisible();
    await r.page.click("#share-accept");
    await expect(r.page.locator("#share-offer")).toHaveCount(0);
    expect(await stlOf(r.page)).toBe(s.stl);
    expect(r.errors).toEqual([]);
  } finally { await r.context.close(); }
});

// ---------------------------------------------------------------- the person's own work
const mine = () => {
  const d = newDoc("Mine", "beginner");
  d.bodies.push(body("m1", "My box", prim("box", { w: 20, d: 20, h: 10, r: 0, c: 0 })));
  return d;
};

test("existing work: Keep current design changes nothing; Open as new design adds one, keeps the old bytes and never reuses the sender's id", async ({ browser }) => {
  const sourceDoc = fixture("advanced-wall-bracket");
  const s = await share(sourceDoc);
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    // two designs of their own: one with the sender's own id and other content (the import must never overwrite it), and the one left open
    await loadDoc(page, { ...sourceDoc, name: "Same id, my version" });
    await page.evaluate(() => window.__app.projects.saveNow());
    await loadDoc(page, mine());
    await page.evaluate(() => window.__app.projects.saveNow());
    const a = await openDoc(page);
    const before = await storedDesigns(page);
    expect(before.map((d) => d.id).sort()).toEqual([a.id, sourceDoc.id].sort());
    const stlBefore = await stlOf(page);

    // 1. Keep current design
    await navigateKeepingStorage(page, () => page.goto(receiverUrl(s.frag, "?visit=1")));
    await ready(page);
    await expect(page.locator("#share-offer")).toBeVisible();
    await page.click("#share-decline");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await openDoc(page)).id).toBe(a.id);
    expect((await storedDesigns(page)).map((d) => [d.id, withoutStamp(d.doc)])).toEqual(before.map((d) => [d.id, withoutStamp(d.doc)]));
    expect(await stlOf(page)).toBe(stlBefore);
    // Escape and the close button also decline
    await navigateKeepingStorage(page, () => page.goto(receiverUrl(s.frag, "?visit=2")));
    await ready(page);
    await expect(page.locator("#share-offer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await storedDesigns(page)).length).toBe(before.length);
    // a reload makes no copy: the fragment was taken off the address and kept nowhere
    await navigateKeepingStorage(page, () => page.goto(info0.project.use.baseURL + "?visit=3"));
    await ready(page);
    expect(await noLinkPending(page), "the reload captured a link").toBe(true); // the offers above show the page does ask when it holds a link
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await storedDesigns(page)).length).toBe(before.length);

    // 2. Open as new design, with unsaved edits made just before: they are saved first, nothing is lost
    await navigateKeepingStorage(page, () => page.goto(receiverUrl(s.frag, "?visit=4")));
    await ready(page);
    await expect(page.locator("#share-offer")).toBeVisible();
    await page.evaluate(() => window.__store.update((d) => { d.name = "Mine, edited just now"; }, "Rename"));
    await page.click("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    const open = await openDoc(page);
    expect(open).toMatchObject({ name: sourceDoc.name, ver: 0 });
    expect([a.id, sourceDoc.id]).not.toContain(open.id);
    const after = await storedDesigns(page);
    expect(after.length).toBe(before.length + 1);
    const old = after.find((d) => d.id === a.id);
    expect(old.doc.name).toBe("Mine, edited just now"); // the edit was saved before anything opened
    expect(withoutStamp({ ...old.doc, name: "x" })).toEqual(withoutStamp({ ...before.find((d) => d.id === a.id).doc, name: "x" }));
    expect(withoutStamp(after.find((d) => d.id === sourceDoc.id).doc)).toEqual(withoutStamp(before.find((d) => d.id === sourceDoc.id).doc)); // the same id, untouched
    expect(await stlOf(page)).toBe(s.stl);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("workplane.pref.v1.last")), "a built shared design is what a reload reopens").toBe(open.id);
    // and a reload now opens the new design without offering anything again
    await navigateKeepingStorage(page, () => page.goto(info0.project.use.baseURL + "?visit=5"));
    await ready(page);
    expect((await openDoc(page)).id).toBe(open.id);
    expect(await noLinkPending(page), "the reload captured a link").toBe(true);
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await storedDesigns(page)).length).toBe(before.length + 1);
    expect(r.errors).toEqual([]);
  } finally { await r.context.close(); }
});

test("a later link in the address bar of an open tab goes through the same question; a newer one replaces an older", async ({ browser }) => {
  const a = await share(fixture("beginner-box"));
  const b = await share(fixture("beginner-peg-block"));
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    await loadDoc(page, mine());
    const mineId = (await openDoc(page)).id;
    await page.evaluate((f) => { location.hash = "#" + f; }, a.frag);
    await expect(page.locator("#share-offer-name")).toHaveText("Beginner box");
    if (isSite()) expect(await page.evaluate(() => location.hash)).toBe("");
    await page.evaluate((f) => { location.hash = "#" + f; }, b.frag);
    await expect(page.locator("#share-offer-name")).toHaveText("Peg block");
    await expect(page.locator("#share-offer")).toHaveCount(1);
    expect((await openDoc(page)).id).toBe(mineId);
    await page.click("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await openDoc(page)).name).toBe("Peg block");
    expect(await stlOf(page)).toBe(b.stl);
    expect((await storedDesigns(page)).filter((d) => d.name === "Beginner box")).toEqual([]); // the replaced one was never opened or stored
  } finally { await r.context.close(); }
});

test("a shared design the engine rejects is not what a reload reopens", async ({ browser }) => {
  const broken = fixture("advanced-coil");
  broken.name = "Broken coil";
  broken.bodies[0].node.d = 2; broken.bodies[0].node.size = 10; // a wire thicker than the coil is wide: the engine refuses it
  const frag = "js3d=v1.d." + Buffer.from(deflateRawSync(utf8(envOf(broken)))).toString("base64url");
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    await loadDoc(page, mine());
    await page.evaluate(() => window.__app.projects.saveNow());
    const a = await openDoc(page);
    await page.evaluate((f) => { location.hash = "#" + f; }, frag);
    await page.click("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect((await openDoc(page)).name).toBe("Broken coil");
    await expect.poll(async () => (await bodies(page))[0]?.error, "the engine rejects it").toBeTruthy();
    await expect.poll(async () => (await storedDesigns(page)).some((d) => d.name === "Broken coil"), "it is saved like any design").toBe(true);
    // and a reload opens the design that was open before, not the rejected one
    expect(await page.evaluate(() => localStorage.getItem("workplane.pref.v1.last"))).toBe(a.id);
    await navigateKeepingStorage(page, () => page.goto(info0.project.use.baseURL + "?visit=1"));
    await ready(page);
    expect((await openDoc(page)).id).toBe(a.id);
  } finally { await r.context.close(); }
});

// wrap the page's storage so a test can make writes fail or wait; nothing else about the app is changed
const slowOrFailing = () => {
  const s = window.__app.projects._store, put = s.put.bind(s);
  window.__fail = { all: false, others: false, delay: 0, keep: null };
  s.put = async (id, ...rest) => {
    const f = window.__fail;
    if (f.delay) await new Promise((r) => setTimeout(r, f.delay));
    if (f.all || (f.others && id !== f.keep)) return false;
    return put(id, ...rest);
  };
};

test("a storage failure keeps the old design open; a failed save of the old design stops everything; Retry works", async ({ browser }) => {
  const s = await share(fixture("beginner-peg-block"));
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    await loadDoc(page, mine());
    const a = await openDoc(page);
    await page.evaluate(() => window.__app.projects.saveNow());
    await page.evaluate(slowOrFailing);
    const countBefore = (await storedDesigns(page)).length;
    await page.evaluate((f) => { location.hash = "#" + f; }, s.frag);
    await expect(page.locator("#share-offer")).toBeVisible();

    // the new design cannot be stored: nothing opens, the old design stays, the question stays
    await page.evaluate((id) => { window.__fail.others = true; window.__fail.keep = id; }, a.id);
    await page.click("#share-accept");
    await expect(page.locator("#share-offer-note")).toContainText("could not store the new design");
    expect((await openDoc(page)).id).toBe(a.id);
    expect(await page.locator("#share-accept").isEnabled()).toBe(true);
    expect((await storedDesigns(page)).length).toBe(countBefore);

    // the old design cannot be saved: nothing happens, with a way to keep it as a file, Retry and Cancel
    await page.evaluate(() => { window.__fail.others = false; window.__fail.all = true; });
    await page.click("#share-accept");
    await expect(page.locator("#share-offer-note")).toContainText("could not be saved in this browser, so nothing was opened");
    await expect(page.locator("#share-save-mine")).toBeVisible();
    expect((await openDoc(page)).id).toBe(a.id);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#share-save-mine")]);
    expect(dl.suggestedFilename()).toMatch(/\.json$/);
    await expect(page.locator("#share-offer")).toBeVisible(); // a download is not assumed to have worked: it does not continue by itself
    expect((await openDoc(page)).id).toBe(a.id);

    // storage works again: Retry opens it
    await page.evaluate(() => { window.__fail.all = false; });
    await page.click("#share-retry");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    const list = await storedDesigns(page);
    expect(list.filter((d) => d.name === "Peg block").length).toBe(1);
    expect(list.length).toBe(countBefore + 1);
    expect(await stlOf(page)).toBe(s.stl);
  } finally { await r.context.close(); }
});

test("a double click on Open as new design opens one design", async ({ browser }) => {
  const s = await share(fixture("beginner-peg-block"));
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    await loadDoc(page, mine());
    await page.evaluate((f) => { location.hash = "#" + f; }, s.frag);
    await expect(page.locator("#share-offer")).toBeVisible();
    await page.dblclick("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    await expect(page.locator("#share-offer")).toHaveCount(0);
    await waitIdle(page);
    expect((await storedDesigns(page)).filter((d) => d.name === "Peg block").length).toBe(1);
  } finally { await r.context.close(); }
});

test("a design switch while the old one is being saved stops the import and asks again", async ({ browser }) => {
  const s = await share(fixture("beginner-peg-block"));
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    await loadDoc(page, mine());
    await page.evaluate(slowOrFailing);
    await page.evaluate((f) => { location.hash = "#" + f; }, s.frag);
    await expect(page.locator("#share-offer")).toBeVisible();
    await page.evaluate(() => { window.__fail.delay = 900; });
    await page.click("#share-accept");
    await expect(page.locator("#share-offer-note")).toContainText("Saving your current design");
    await page.evaluate(() => window.__app.projects.newDesign("advanced")); // the person starts another design while the save waits
    await expect(page.locator("#share-offer-note")).toContainText("You changed designs while this was opening", { timeout: 15_000 });
    await page.evaluate(() => { window.__fail.delay = 0; });
    expect((await openDoc(page))).toMatchObject({ name: "Untitled", mode: "advanced", bodies: 0 });
    expect((await storedDesigns(page)).filter((d) => d.name === "Peg block")).toEqual([]);
    // asking again, with nothing in the way, opens it
    await page.click("#share-accept");
    await expect(page.locator("#share-offer")).toHaveCount(0);
    expect(await stlOf(page)).toBe(s.stl);
  } finally { await r.context.close(); }
});

test("the crash-recovery offer waits for the decision about the link", async ({ browser }) => {
  const s = await share(fixture("beginner-box"));
  const r = await receiver(browser);
  try {
    const { page } = r;
    await boot(page, info0);
    // unsaved work that an earlier session left behind: an autosave with no saved design to match
    await page.evaluate(async (doc) => {
      localStorage.setItem("jumpstart3d.autosave", "on");
      const data = JSON.stringify(doc);
      await new Promise((res, rej) => {
        const open = indexedDB.open("jumpstart3d-recovery", 1);
        open.onupgradeneeded = () => { const st = open.result.createObjectStore("snaps", { keyPath: "key" }); st.createIndex("doc", "docId"); };
        open.onsuccess = () => {
          const tx = open.result.transaction("snaps", "readwrite");
          tx.objectStore("snaps").put({ key: doc.id + "|latest", kind: "latest", reason: "closed", docId: doc.id, name: doc.name + " autosave v1", ver: 1, mode: doc.mode, time: Date.now(), size: data.length, data });
          tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
        };
        open.onerror = () => rej(open.error);
      });
    }, { ...fixture("beginner-peg-block"), id: "t_recover_me", name: "Crashed work" });
    await navigateKeepingStorage(page, () => page.goto(receiverUrl(s.frag, "?visit=1")));
    await ready(page);
    await expect(page.locator("#share-offer")).toBeVisible();
    expect(await page.evaluate(() => new Promise((res) => { const o = indexedDB.open("jumpstart3d-recovery"); o.onsuccess = () => { const q = o.result.transaction("snaps").objectStore("snaps").count(); q.onsuccess = () => res(q.result); }; })), "the unsaved work is there to be offered").toBe(1);
    await page.waitForTimeout(2500); // no event marks the offer that is held back; it is shown right after the decision below, which proves it was waiting
    await expect(page.locator(".modal.recover"), "recovery waits while the link question is open").toHaveCount(0);
    await page.click("#share-decline");
    await expect(page.locator(".modal.recover")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".modal.recover")).toContainText("Crashed work");
  } finally { await r.context.close(); }
});

// ---------------------------------------------------------------- untrusted links
const good = () => envOf(fixture("beginner-box"));
const variant = (mutate) => { const e = good(); mutate(e.doc, e); return e; };
const bothCodecs = (e) => [["d", fragOf("d", deflateRawSync(utf8(e)))], ["j", fragOf("j", utf8(e))]];
const BAD = [
  ["an unknown extra field", variant((d) => { d.surprise = 1; }), /Use a project file/],
  ["a workspace links do not carry", variant((d) => { d.mode = "chisel"; }), /Use a project file/],
  ["an unknown step type", variant((d) => { d.bodies[0].node.t = "evil"; }), /Use a project file/],
  ["an unknown modifier field", variant((d) => { d.bodies[0].node.mods = [{ id: "m1", t: "hole", seq: 1, dia: 1, onload: "x" }]; }), /Use a project file/],
  ["a dangling sketch", variant((d) => { d.bodies[0].node = { t: "extrude", sketch: "nope", profiles: [], dist: 5, mode: "one", mods: [] }; }), /damaged/],
  ["a dangling model", variant((d) => { d.bodies[0].node = { t: "mesh", asset: "gone", k: 1, mods: [] }; }), /damaged/],
  ["a flat transform", variant((d) => { d.bodies[0].m = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }), /damaged/],
  ["a transform with a bad last row", variant((d) => { d.bodies[0].m[15] = 3; }), /damaged/],
  ["a bad parameter expression", variant((d) => { d.params = [{ id: "q1", name: "w", expr: "2 +", value: 1 }]; }), /damaged/],
  ["a parameter that calls out", variant((d) => { d.params = [{ id: "q1", name: "w", expr: "fetch('http://x')", value: 1 }]; }), /damaged/],
  ["an outside picture", variant((d) => { d.sketches = [{ id: "s1", name: "S", seq: 1, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], image: { src: "https://img.example.test/a.png", name: "p", w: 1, h: 1 } }]; }), /outside the design/],
  ["an svg picture", variant((d) => { d.media = { m1: { kind: "image", name: "p", src: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", w: 1, h: 1 } }; }), /outside the design/],
  ["a file picture", variant((d) => { d.media = { m1: { kind: "image", name: "p", src: "file:///etc/passwd", w: 1, h: 1 } }; }), /outside the design/],
];
const RAW_BAD = [ // checked as text before they are parsed
  ["a number that is not finite", JSON.stringify(good()).replace('"w":', '"w":1e999,"x":'), /damaged/],
  ["a reserved name", JSON.stringify(good()).replace('"p":{', '"p":{"__proto__":{"a":1},'), /damaged/],
  ["data nested too deeply", JSON.stringify(good()).replace('"p":{', '"p":{"a":' + "[".repeat(80) + "]".repeat(80) + ","), /nested too deeply|damaged/],
];

test("bad links are refused with a plain message and leave the open design, the stored designs and the network alone", async ({ browser }) => {
  await loadDoc(sender, mine());
  await sender.evaluate(async () => { await window.__app.projects.saveNow(); });
  const open0 = await openDoc(sender);
  const stored0 = (await storedDesigns(sender)).map((d) => d.id).sort();
  senderRequests.length = 0;
  const attempt = async (text, re, why) => {
    await sender.click("#btn-export");
    await sender.click("#btn-share-link");
    await sender.fill("#share-paste", text);
    await sender.click("#share-import");
    // two places can say no: the box itself (the text is not a link) or the question that opens after the link was read
    const inBox = sender.locator("#share-import-note"), problem = sender.locator("#share-problem");
    await expect(inBox.or(problem), why).toHaveText(re);
    if (await problem.count()) { await sender.click("#share-ok"); await expect(sender.locator("#share-offer")).toHaveCount(0); }
    else await sender.keyboard.press("Escape");
    await expect(sender.locator("#share-dialog")).toHaveCount(0);
    expect((await openDoc(sender)).id, why).toBe(open0.id);
  };
  // not links at all, or links the format does not allow
  await attempt("hello there", /no share link/, "plain text");
  await attempt("js3d=v2.d.AAAA", /different version/, "an unknown version");
  await attempt("js3d=v1.x.AAAA", /compression/, "an unknown codec");
  await attempt("js3d=v1.d.AA==", /damaged/, "padding");
  await attempt("js3d=v1.d.AA+/", /damaged/, "the other base64 alphabet");
  await attempt("js3d=v1.d.A", /damaged|not a design/, "a length that cannot be bytes");
  await attempt("js3d=v1.d." + "A".repeat(4090), /too long/, "a fragment over 4096");
  await attempt("x".repeat(8193), /too long/, "pasted text over 8192");
  // damaged streams
  const e = good(), z = deflateRawSync(utf8(e));
  await attempt("#" + fragOf("j", Buffer.from([0xc3, 0x28])), /damaged/, "bad UTF-8");
  await attempt("#" + fragOf("j", utf8("{nope")), /damaged/, "JSON that is not JSON");
  await attempt("#" + fragOf("d", utf8(e)), /damaged/, "JSON bytes tagged d are not guessed at");
  await attempt("#" + fragOf("j", z), /damaged/, "compressed bytes tagged j are not guessed at");
  await attempt("#" + fragOf("d", z.subarray(0, z.length - 4)), /damaged/, "a truncated stream");
  await attempt("#" + fragOf("d", deflateRawSync(Buffer.alloc(2 * 1024 * 1024))), /too large to open safely/, "a decompression bomb");
  // content, through both codecs
  for (const [why, env, re] of BAD) for (const [codec, frag] of bothCodecs(env)) await attempt("#" + frag, re, `${why} (${codec})`);
  for (const [why, text, re] of RAW_BAD) for (const [codec, frag] of [["d", fragOf("d", deflateRawSync(utf8(text)))], ["j", fragOf("j", utf8(text))]]) await attempt("#" + frag, re, `${why} (${codec})`);
  // nothing was stored, and the external picture was never fetched
  expect((await storedDesigns(sender)).map((d) => d.id).sort()).toEqual(stored0);
  expect(senderRequests.filter((u) => /img\.example\.test|etc\/passwd/.test(u)), "pictures named by a link").toEqual([]);
});

test("a name that looks like a page element is shown as text and nothing in it runs", async () => {
  const name = '<img src=x onerror="window.__pwned=1"> & <b>bold</b>';
  const e = variant((d) => { d.name = name; });
  await sender.click("#btn-export");
  await sender.click("#btn-share-link");
  await sender.fill("#share-paste", "#" + fragOf("d", deflateRawSync(utf8(e))));
  await sender.click("#share-import");
  await expect(sender.locator("#share-offer-name")).toHaveText(name);
  expect(await sender.locator("#share-offer img, #share-offer b b").count()).toBe(0);
  // a control: the same kind of element, put in the page on purpose, does run its handler here, and by then the name's would have run too
  await sender.evaluate(() => { const d = document.createElement("div"); d.innerHTML = '<img src="data:image/png;base64,AAAA" onerror="window.__sensor=1">'; document.body.append(d); });
  await sender.waitForFunction(() => window.__sensor === 1);
  expect(await sender.evaluate(() => window.__pwned)).toBeUndefined();
  await sender.click("#share-decline");
  await expect(sender.locator("#share-offer")).toHaveCount(0);
});

test("the link does not leak while the question is open, after Cancel, with the AI connection on or the address bar change refused", async ({ browser }) => {
  const s = await share(fixture("beginner-peg-block"));
  const token = s.frag.slice(-48);
  for (const refuseHistory of [false, true]) {
    const sockets = [], consoleText = [], requests = [];
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = watchErrors(page);
    page.on("console", (m) => consoleText.push(m.text()));
    page.on("request", (q) => requests.push(q.url() + " " + (q.postData() || "")));
    await page.addInitScript((refuse) => {
      try { localStorage.setItem("jumpstart.chisel.intro", "1"); localStorage.setItem("jumpstart.agent", "on"); } catch (e) {} // the AI-agent connection was already on
      if (refuse) history.replaceState = () => { throw new DOMException("refused", "SecurityError"); };
    }, refuseHistory);
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:8822\/?$/, (ws) => { ws.onMessage((m) => sockets.push(String(m))); });
    try {
      await page.goto(receiverUrl(s.frag));
      await ready(page);
      await expect(page.locator("#share-offer")).toBeVisible();
      await expect.poll(() => sockets.length, { message: "the AI-agent connection says hello" }).toBeGreaterThan(0);
      const hello = JSON.parse(sockets[0]);
      expect(hello.hello).toBe("jumpstart-3d");
      expect(hello.url).not.toContain("#");
      expect(hello.url).not.toContain("js3d");
      const leaks = () => [...sockets, ...requests, ...consoleText].filter((t) => t.includes(token) || t.includes("js3d="));
      expect(leaks()).toEqual([]);
      if (refuseHistory) expect(await page.evaluate(() => location.hash.startsWith("#js3d="))).toBe(true); // the address was left alone; the fragment still reaches nothing
      else if (isSite()) expect(await page.evaluate(() => location.hash)).toBe("");
      await page.click("#share-decline");
      await expect(page.locator("#share-offer")).toHaveCount(0);
      // the bug report a person can send, and its text, hold nothing of the link
      await page.click("#btn-export");
      await page.click("#btn-report");
      const report = (await page.inputValue("#rp-details")) + (await page.inputValue("#rp-steps")) + (await page.evaluate(() => String(window.__app.lastError || "")));
      expect(report).not.toContain(token);
      expect(report).not.toContain("js3d=");
      // controls: the console and request recordings do catch what the page writes and asks for, so an empty list means something
      await page.route("https://control.invalid/**", (route) => route.fulfill({ status: 200, body: "" }));
      await page.evaluate(() => { console.log("control-line"); return fetch("https://control.invalid/control-request", { mode: "no-cors" }); });
      await expect.poll(() => consoleText.includes("control-line") && requests.some((u) => u.includes("control-request"))).toBe(true);
      await page.waitForTimeout(500); // no event marks a leak that never happens
      expect(leaks()).toEqual([]);
      expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).not.toContain(token);
      expect(errors.filter((e) => !/WebSocket connection to/.test(e))).toEqual([]);
    } finally { await context.close(); }
  }
});
