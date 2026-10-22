// Your server tests: Your designs › Your server keeps designs in a folder on a WebDAV server. Runs on both builds.
// The server is a fake kept in this file and attached with page.route, so no real server is needed. It is a small
// stateful WebDAV folder (PROPFIND, MKCOL, GET, PUT with If-Match, DELETE, Basic login) that records every request.
// CORS is NOT tested: Playwright answers the preflight itself and adds the headers to every answer. The README covers it.
import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim } from "./helpers.mjs";

const HOST = "https://dav.example.test/";
const PATH = "/dav/jumpstart/";
const BASE = HOST.slice(0, -1) + PATH;
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const box = (w, d, h) => prim("box", { w, d, h, r: 0, c: 0 });
const plain = (bodies) => bodies.map(({ _key, ...b }) => b);

// Designs the way the app itself keeps them (params: [] is what the store adds on load), so a loaded copy equals the file.
const design = (id, name, w, extra = {}) => newDoc(name, "beginner", { id, bodies: [body("b1", "Slab", box(w, 20, 5))], params: [], ...extra });
const projectFile = (doc) => JSON.stringify({ app: "jumpstart-3d", version: 1, doc }, null, 1);
const LOPEZ = design("dtremote1", "Lopez, Maria, Keychain v2", 30), LOPEZ_FILE = "Lopez, Maria, Keychain v2-dtremote1.json";
const BRACKET = design("dtremote2", "Bracket", 40), BRACKET_FILE = "Bracket-dtremote2.json";
const NOT_A_DESIGN = "“other.json” isn't a JumpStart 3D design file.";

// ---- the fake WebDAV server
function makeFake() {
  const s = {};
  s.reset = () => Object.assign(s, { files: new Map(), folder: true, down: false, etags: true, bump: false, redirect: false, mkcol: 0, previewGet: 0, previewPut: 0, previewDelete: 0, beforeRequest: null, prefix: "d", user: "max", pass: "pä55 wörd", log: [], n: 0, storageJson: {}, storageHits: 0 });
  s.put = (name, text) => { s.n++; s.files.set(name, { text, etag: '"e' + s.n + '"', mtime: 1_760_000_000_000 + s.n * 60_000 }); };
  const cors = { "Access-Control-Allow-Origin": "*" };
  // prefix "d": Nextcloud (d:), "D": Apache (D: with lp1: for the live properties), "": no prefix
  const multistatus = () => {
    const p = s.prefix, tag = (n, live) => (p === "" ? n : p === "D" && live ? "lp1:" + n : p + ":" + n);
    const ns = p === "" ? 'xmlns="DAV:"' : p === "D" ? 'xmlns:D="DAV:" xmlns:lp1="DAV:"' : `xmlns:${p}="DAV:"`;
    const t = (n, inner, live = false) => `<${tag(n, live)}>${inner}</${tag(n, live)}>`;
    const stat = (code, text) => t("status", `HTTP/1.1 ${code} ${text}`);
    const res = (href, props, before = "") => t("response", t("href", href) + before + t("propstat", t("prop", props) + stat(200, "OK")));
    const collection = t("resourcetype", `<${tag("collection")}/>`, true);
    let out = res(PATH, collection + t("getlastmodified", new Date(1_760_000_000_000).toUTCString(), true)) + res(PATH + "old/", collection);
    let first = true;
    for (const [name, f] of s.files) {
      out += res(PATH + encodeURIComponent(name),
        t("getlastmodified", new Date(f.mtime).toUTCString(), true) + (s.etags ? t("getetag", f.etag, true) : "") + `<${tag("resourcetype", true)}/>`,
        first ? t("propstat", t("prop", t("getetag", '"bogus"', true)) + stat(404, "Not Found")) : ""); // a property the server says it does not have
      first = false;
    }
    return `<?xml version="1.0" encoding="utf-8"?><${tag("multistatus")} ${ns}>${out}</${tag("multistatus")}>`;
  };
  s.handler = async (route) => {
    const req = route.request(), h = req.headers(), u = new URL(req.url()), m = req.method();
    const name = decodeURIComponent(u.pathname.startsWith(PATH) ? u.pathname.slice(PATH.length) : u.pathname);
    const authOk = h.authorization === "Basic " + Buffer.from(`${s.user}:${s.pass}`).toString("base64");
    s.log.push({ method: m, path: u.pathname, name, origin: h.origin, authOk, depth: h.depth, ifMatch: h["if-match"], type: h["content-type"], body: req.postData() });
    const reply = (status, headers = {}, text = "", contentType) => route.fulfill({ status, headers: { ...cors, ...headers }, body: text, contentType });
    if (s.down) return route.abort("internetdisconnected");
    if (s.redirect) return reply(301, { Location: HOST + "elsewhere/dav/" });
    if (m === "OPTIONS") return reply(204, { "Access-Control-Allow-Methods": "GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Depth, Content-Type, If-Match" });
    if (!authOk) return reply(401, { "WWW-Authenticate": 'Basic realm="fake"' });
    if (s.beforeRequest) await s.beforeRequest({ method: m, name });
    if (name.endsWith(".thumb") && m === "DELETE" && s.previewDelete) return reply(s.previewDelete);
    if (name.endsWith(".thumb") && m === "GET" && s.previewGet) return reply(s.previewGet);
    if (name.endsWith(".thumb") && m === "PUT" && s.previewPut) return reply(s.previewPut);
    if (!name) {
      if (m === "PROPFIND") return s.folder ? reply(207, {}, multistatus(), "application/xml; charset=utf-8") : reply(404);
      if (m === "MKCOL") { if (s.mkcol) return reply(s.mkcol); if (s.folder) return reply(405); s.folder = true; return reply(201); }
      return reply(405);
    }
    const f = s.files.get(name);
    if (m === "GET") return f ? reply(200, s.etags ? { ETag: f.etag } : {}, f.text, "application/json") : reply(404);
    if (m === "PUT") {
      if (!s.folder) return reply(409);
      if (s.bump && f) { s.bump = false; s.put(name, f.text); } // another device saves just before this PUT
      const cur = s.files.get(name);
      if (h["if-match"] !== undefined && (!cur || h["if-match"] !== cur.etag)) return reply(412);
      s.put(name, req.postData() || "");
      return reply(f ? 204 : 201);
    }
    if (m === "DELETE") { if (!f) return reply(404); s.files.delete(name); return reply(204); }
    return reply(405);
  };
  s.reset();
  return s;
}

// The browser prints a "Failed to load resource" line for every 401, 404, 412 and refused request. Those lines
// belong to the network, not to the app, so the ones about the fake server and storage.json are skipped here.
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("page: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url || "";
    if (FONT_HOSTS.test(url) || url.startsWith(HOST) || url.endsWith("/storage.json")) return;
    errors.push("console: " + m.text().slice(0, 300));
  });
  return errors;
}

test.describe.configure({ mode: "serial" });
let page, errors, info0, fake, single;

test.beforeAll(async ({ browser }, info) => {
  info0 = info;
  single = info.project.name === "single";
  fake = makeFake();
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
  await page.route(HOST + "**", (route) => fake.handler(route));
  await page.route("**/storage.json", (route) => { fake.storageHits++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fake.storageJson) }); });
  await boot(page, info0);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const toast = async (prefix, timeout = 20_000) => {
  await page.waitForFunction((p) => window.__toasts.some((t) => t.text.startsWith(p)), prefix, { timeout });
  return page.evaluate((p) => window.__toasts.find((t) => t.text.startsWith(p)), prefix);
};
const toastTexts = () => page.evaluate(() => window.__toasts.map((t) => t.text));
const clearToasts = () => page.evaluate(() => { window.__toasts.length = 0; });
const openDesigns = () => page.click("#btn-projects");
const openRemote = async () => { await openDesigns(); await page.click("#tab-remote"); };
const status = () => page.locator("#remote-status");
const cards = () => page.locator("#remote-grid .pcard");
const cardNames = () => page.locator("#remote-grid .pcard .meta b").allTextContents();
const card = (name) => page.locator("#remote-grid .pcard", { has: page.locator(".meta b", { hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) });
const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("jumpstart.remote")));
const stored = (id) => page.evaluate((id) => window.__app.projects._store.get(id), id);
const entries = () => page.evaluate(() => window.__app.projects._store.list());
const openId = () => page.evaluate(() => window.__store.doc.id);
const saveLocal = async (doc) => { await loadDoc(page, doc); await page.evaluate(() => window.__app.projects.saveNow()); };
const since = (n, method) => fake.log.slice(n).filter((e) => !method || e.method === method);
const methodsSince = (n) => fake.log.slice(n).map((e) => e.method);
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
const background = (name) => card(name).locator(".thumb").evaluate((e) => e.style.backgroundImage);
const closeDesigns = async () => { if (await page.locator(".modal-back").count()) { await page.click(".modal-back .xbtn"); await expect(page.locator(".modal-back")).toHaveCount(0); } };

async function connectUI({ url = BASE, user = "max", pass = fake.pass, remember = false } = {}) {
  await page.fill("#remote-url", url);
  await page.fill("#remote-user", user);
  await page.fill("#remote-pass", pass);
  await page.setChecked("#remote-remember", remember);
  await page.click("#btn-remote-connect");
}
const connect = async (opts) => { await connectUI(opts); await expect(status()).toContainText("Connected to"); };
const seed = () => {
  fake.put("other.json", JSON.stringify({ not: "ours" }));
  fake.put(BRACKET_FILE, projectFile(BRACKET));
  fake.put(LOPEZ_FILE, projectFile(LOPEZ));
  fake.put("notes.txt", "my notes");
};

test.beforeEach(async () => {
  await page.evaluate(async () => {
    document.querySelectorAll(".modal-back").forEach((m) => m.remove());
    window.__app.projects._remote.forget();
    const s = window.__app.projects._store;
    await s.ready;
    for (const e of await s.list()) await s.del(e.id);
    window.__toasts.length = 0;
  });
  fake.reset();
  await loadDoc(page, design("dtneutral1", "Neutral", 10)); // so no case starts with a design of its own open
});

test("Your designs has two tabs: This browser (as before) and Your server", async () => {
  await openDesigns();
  await expect(page.locator("#designs-tabs")).toBeVisible();
  await expect(page.locator("#tab-local")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-remote")).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#btn-restore")).toBeVisible();
  await expect(page.locator(".modal .projgrid")).toBeVisible();
  await expect(page.locator("#designs-remote")).toBeHidden();
  await page.click("#tab-remote");
  await expect(page.locator("#tab-remote")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#designs-remote")).toBeVisible();
  await expect(page.locator("#remote-form")).toBeVisible();
  await expect(page.locator("#btn-restore")).toBeHidden();
  await expect(page.locator(".modal .projgrid")).toBeHidden();
  await expect(status()).toHaveText("Keep designs in a folder on your own WebDAV server (Nextcloud, a NAS, Apache or nginx) and open them on any device.");
  await page.click("#tab-local");
  await expect(page.locator("#btn-restore")).toBeVisible();
  await expect(page.locator("#designs-remote")).toBeHidden();
  await closeDesigns();
  await openDesigns(); // every opening starts on This browser
  await expect(page.locator("#tab-local")).toHaveAttribute("aria-selected", "true");
  await closeDesigns();
});

test("storage.json beside the page fills the address once, only where nothing is saved; the single file never asks", async () => {
  if (single) {
    const asked = [], onRequest = (r) => { if (r.url().endsWith("storage.json")) asked.push(r.url()); };
    page.on("request", onRequest);
    await openRemote();
    await expect(page.locator("#remote-url")).toHaveValue("");
    await page.waitForTimeout(300);
    page.off("request", onRequest);
    expect(asked).toEqual([]);
    return;
  }
  fake.storageJson = { webdav: BASE };
  await boot(page, info0);
  expect(fake.storageHits, "a page load alone does not ask").toBe(0);
  await openRemote();
  await expect(page.locator("#remote-url")).toHaveValue(BASE);
  await page.click("#tab-local");
  await page.click("#tab-remote");
  await expect(page.locator("#remote-url")).toHaveValue(BASE); // the default survives a redraw
  await closeDesigns();
  await openRemote();
  await expect(page.locator("#remote-url")).toHaveValue(BASE);
  expect(fake.storageHits, "asked once per page load").toBe(1);
  await closeDesigns();
  // a short address in storage.json is taken from the page's own address
  fake.storageJson = { webdav: "designs/" };
  await page.evaluate(() => localStorage.removeItem("jumpstart.remote"));
  await boot(page, info0);
  await openRemote();
  await expect(page.locator("#remote-url")).toHaveValue(new URL("designs/", info0.project.use.baseURL).href);
  await closeDesigns();
  // a saved address wins and storage.json is not asked at all
  fake.storageHits = 0;
  await page.evaluate((url) => localStorage.setItem("jumpstart.remote", JSON.stringify({ url, user: "max", remember: false, files: {} })), BASE + "mine/");
  await boot(page, info0);
  await openRemote();
  await expect(page.locator("#remote-url")).toHaveValue(BASE + "mine/");
  await expect(page.locator("#remote-user")).toHaveValue("max");
  expect(fake.storageHits).toBe(0);
});

test("the address rules: check() and the form", async () => {
  const check = (u, p, b) => page.evaluate(([u, p, b]) => window.__app.projects._remote.check(u, p, b), [u, p, b]);
  expect((await check("http://nas.local/dav/", "https:")).error).toMatch(/won't let it reach an http:\/\/ server/);
  expect(await check("http://127.0.0.1:8080/dav/", "https:")).toEqual({ url: "http://127.0.0.1:8080/dav/" });
  expect((await check("https://a:b@x.test/d/", "http:")).error).toMatch(/Leave the user name and password out/);
  expect(await check("https://x.test/dav", "file:")).toEqual({ url: "https://x.test/dav/" });
  expect(await check("https://x.test/dav?x=1#top", "http:")).toEqual({ url: "https://x.test/dav/" });
  expect((await check("ftp://x/", "http:")).error).toMatch(/isn't a folder address/);
  // a short address is taken from the page's own address; from a file it is no address at all
  expect(await check("./designs/", "http:", "http://nas.test:8080/share/index.html")).toEqual({ url: "http://nas.test:8080/share/designs/" });
  expect((await check("./designs/", "file:", "file:///x/jumpstart-3d.html")).error).toMatch(/isn't a folder address/);
  expect((await check("./designs/", "https:", "https://pages.test/app/")).url).toBe("https://pages.test/app/designs/");
  expect((await check("/dav/", "https:", "https://pages.test/app/")).url).toBe("https://pages.test/dav/");
  expect((await check("../dav", "https:", "https://pages.test/app/x/")).url).toBe("https://pages.test/app/dav/");
  // without a scheme or a leading slash it is not taken from the page: the password would go to the page's own server
  for (const typed of ["cloud.example.com/dav/", "192.168.1.20/share/", "truenas/share/", "designs/"]) expect((await check(typed, "https:", "https://pages.test/app/")).error).toMatch(/isn't a folder address/);
  expect(await page.evaluate(() => window.__app.projects._remote.check("designs/", "https:", "https://pages.test/app/", { lenient: true }))).toEqual({ url: "https://pages.test/app/designs/" }); // storage.json
  await openRemote();
  const n0 = fake.log.length;
  await connectUI({ url: "https://max:secret@dav.example.test/dav/jumpstart/" });
  await expect(status()).toHaveText("Leave the user name and password out of the address and type them in the fields below.");
  expect(fake.log.length).toBe(n0);
  await connectUI({ user: "" });
  await expect(status()).toHaveText("Type your user name and password (on Nextcloud, an app password).");
  expect(fake.log.length).toBe(n0);
  await closeDesigns();
});

test("Connect lists the .json files newest first, sends the right requests, and remembers the password only when asked", async () => {
  seed();
  await openRemote();
  await connect();
  await expect(status()).toHaveText("Connected to dav.example.test: 3 designs there.");
  await expect(cards()).toHaveCount(3);
  expect(await cardNames()).toEqual(["Lopez, Maria, Keychain v2", "Bracket", "other"]);
  const list = fake.log.find((e) => e.method === "PROPFIND");
  expect(list).toMatchObject({ name: "", depth: "1", authOk: true });
  expect(list.type).toMatch(/^application\/xml/);
  expect(list.body).toContain("getetag");
  expect(list.origin).toBe(single ? "null" : new URL(info0.project.use.baseURL).origin);
  const rec = await record();
  expect(rec).toMatchObject({ url: BASE, user: "max", remember: false, files: {} });
  expect(rec).not.toHaveProperty("pass");
  expect(JSON.stringify(await page.evaluate(() => window.__app.projects._remote.state()))).not.toContain("pä55");
  for (const prefix of ["D", ""]) { // Apache and unprefixed answers read the same
    fake.prefix = prefix;
    await page.click("#btn-remote-forget");
    await expect(page.locator("#remote-form")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("jumpstart.remote"))).toBeNull();
    await connect();
    await expect(cards()).toHaveCount(3);
    expect(await cardNames()).toEqual(["Lopez, Maria, Keychain v2", "Bracket", "other"]);
  }
  expect(fake.files.size).toBe(4); // forgetting leaves the server alone
  await page.click("#btn-remote-forget");
  await connect({ remember: true });
  expect((await record()).pass).toBe(fake.pass);
  await closeDesigns();
  await boot(page, info0); // a new page: the password comes from the saved record
  await openRemote();
  await expect(cards()).toHaveCount(3);
  await expect(page.locator("#remote-form")).toHaveCount(0);
  await closeDesigns();
});

test("Open brings a design in with its id and the server's time; a file that is not a design changes nothing", async () => {
  seed();
  await openRemote();
  await connect();
  await clearToasts();
  const before = await entries();
  await card("other").locator(".open").click();
  await expect(status()).toHaveText(NOT_A_DESIGN);
  expect(await entries()).toEqual(before);
  expect(await toastTexts()).toEqual([]);
  await expect(page.locator(".modal-back")).toHaveCount(1);
  await card("Bracket").locator(".open").click();
  await toast("Opened “Bracket” from the server.");
  await expect(page.locator(".modal-back")).toHaveCount(0);
  expect(await openId()).toBe("dtremote2");
  const doc = JSON.parse(await stored("dtremote2"));
  expect(plain(doc.bodies)).toEqual(BRACKET.bodies);
  expect(plain(await page.evaluate(() => window.__store.doc.bodies))).toEqual(BRACKET.bodies);
  expect((await entries()).find((e) => e.id === "dtremote2")).toMatchObject({ name: "Bracket", updated: fake.files.get(BRACKET_FILE).mtime });
  const rec = (await record()).files.dtremote2;
  expect(rec).toMatchObject({ file: BRACKET_FILE, tag: fake.files.get(BRACKET_FILE).etag });
  expect(rec.sum).toMatch(/^[0-9a-z]+\.\d+$/);
});

test("Open never overwrites: a design changed here and on the server opens as a (from server) copy", async () => {
  seed();
  const mine = design("dtremote1", "Lopez, Maria, Keychain v2", 55);
  await saveLocal(mine);
  await loadDoc(page, design("dtneutral1", "Neutral", 10));
  await openRemote();
  await connect();
  const before = await stored("dtremote1");
  await clearToasts();
  await card("Lopez, Maria, Keychain v2").locator(".open").click();
  const t = await toast("“Lopez, Maria, Keychain v2” was changed here and on the server");
  expect(t.text).toBe("“Lopez, Maria, Keychain v2” was changed here and on the server, so the server's copy opened as “Lopez, Maria, Keychain v2 (from server)”. Yours is unchanged.");
  const id = await openId();
  expect(id).not.toBe("dtremote1");
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Lopez, Maria, Keychain v2 (from server)");
  expect(plain(JSON.parse(await stored(id)).bodies)).toEqual(LOPEZ.bodies);
  expect(await stored("dtremote1")).toBe(before);
  expect((await record()).files).toEqual({}); // no record for a copy, and none for the design we did not touch
});

test("Open follows the last-seen record: the server's newer copy replaces an untouched one; changes made here are kept", async () => {
  seed();
  await openRemote();
  await connect();
  await card("Bracket").locator(".open").click();
  await toast("Opened “Bracket” from the server.");
  expect(await openId()).toBe("dtremote2");
  const count = (await entries()).length;
  // the server moves on, nothing changed here
  const NEWER = design("dtremote2", "Bracket", 77);
  fake.put(BRACKET_FILE, projectFile(NEWER));
  await clearToasts();
  await openRemote();
  await card("Bracket").locator(".open").click();
  await toast("Opened “Bracket” from the server.");
  expect(await openId()).toBe("dtremote2");
  expect(plain(JSON.parse(await stored("dtremote2")).bodies)).toEqual(NEWER.bodies);
  expect((await entries()).map((e) => e.name).filter((n) => n.includes("(from server)"))).toEqual([]);
  expect((await entries()).length).toBe(count);
  // now it is changed here, the server is not
  await saveLocal(design("dtremote2", "Bracket", 99));
  const mine = await stored("dtremote2");
  await clearToasts();
  await openRemote();
  await card("Bracket").locator(".open").click();
  const t = await toast("Opened “Bracket”: the copy in this browser has changes");
  expect(t.text).toBe("Opened “Bracket”: the copy in this browser has changes the server doesn't have yet. Save it to the server to send them.");
  expect(await openId()).toBe("dtremote2");
  expect(plain(await page.evaluate(() => window.__store.doc.bodies))).toEqual(design("dtremote2", "Bracket", 99).bodies);
  expect(JSON.parse(await stored("dtremote2")).bodies).toEqual(JSON.parse(mine).bodies);
});

test("server thumbnails persist across reconnects without downloading designs; older files still open", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await page.waitForFunction(() => !window.__app.vp.isMoving()); // the load starts a framing move; a preview taken while it runs differs from the next one
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  const thumb = fake.files.get("Lid-dtlocal1.json.thumb")?.text;
  expect(thumb).toMatch(/^data:image\/jpeg;base64,\S+$/);
  await page.evaluate(() => window.__app.projects.saveNow());
  expect(thumb).toBe((await entries()).find((e) => e.id === "dtlocal1").thumb);
  const background = () => card("Lid").locator(".thumb").evaluate((e) => e.style.backgroundImage);
  await expect.poll(background).toBe(`url("${thumb}")`);
  await closeDesigns();
  await page.evaluate(async () => {
    window.__app.projects._remote.forget();
    await window.__app.projects._store.del("dtlocal1");
  });
  await boot(page, info0); // discard the remote module's in-memory list
  fake.put(BRACKET_FILE, projectFile(BRACKET));
  const n = fake.log.length;
  await openRemote();
  await connect();
  await expect(cards()).toHaveCount(2);
  await expect.poll(background).toBe(`url("${thumb}")`);
  expect(since(n, "GET").map((r) => r.name)).toEqual(["Lid-dtlocal1.json.thumb"]);
  expect(since(n, "GET").every((r) => r.authOk)).toBe(true);
  expect(await card("Bracket").locator(".thumb").evaluate((e) => e.style.backgroundImage)).toBe("none");
  await card("Bracket").locator(".open").click();
  await toast("Opened “Bracket” from the server.");
  expect(await openId()).toBe("dtremote2");
});

test("unreadable or refused previews leave designs usable and a failed preview save is reported", async () => {
  fake.put(BRACKET_FILE, projectFile(BRACKET));
  fake.put(BRACKET_FILE + ".thumb", "https://untrusted.example/image.jpg");
  await openRemote();
  await connect();
  expect(await card("Bracket").locator(".thumb").evaluate((e) => e.style.backgroundImage)).toBe("none");
  await page.click("#btn-remote-forget");
  fake.previewGet = 401;
  await connect();
  await expect(cards()).toHaveCount(1);
  expect(await card("Bracket").locator(".thumb").evaluate((e) => e.style.backgroundImage)).toBe("none");
  await card("Bracket").locator(".open").click();
  await toast("Opened “Bracket” from the server.");
  expect(await openId()).toBe("dtremote2");
  fake.previewPut = 507;
  await openRemote();
  await page.click("#btn-remote-save");
  await toast("Saved “Bracket” to the server.");
  await expect(status()).toHaveText("Saved “Bracket” to dav.example.test. The design is saved, but its preview could not be updated.");
  expect(JSON.parse(fake.files.get(BRACKET_FILE).text).doc.id).toBe("dtremote2");
});

test("Save puts the open design on the server as the folder's project file, and checks the server's copy before replacing it", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await expect(page.locator("#remote-grid")).toHaveCount(0);
  await expect(page.locator("#designs-remote .empty")).toHaveText("No designs on the server yet. Save the open design to put it there.");
  await clearToasts();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  await expect(status()).toHaveText("Saved “Lid” to dav.example.test.");
  const doc = JSON.parse(await stored("dtlocal1"));
  delete doc._updated;
  const file = fake.files.get("Lid-dtlocal1.json");
  expect(file.text).toBe(JSON.stringify({ app: "jumpstart-3d", version: 1, doc }, null, 1));
  expect(file.text).not.toContain("_updated");
  const puts = since(0, "PUT");
  expect(puts).toHaveLength(2);
  expect(puts[1]).toMatchObject({ name: "Lid-dtlocal1.json.thumb", type: "text/plain" });
  expect(puts[0]).toMatchObject({ name: "Lid-dtlocal1.json", type: "application/json" });
  expect(puts[0].ifMatch).toBeUndefined();
  await expect(cards()).toHaveCount(1);
  await expect(card("Lid")).toHaveClass(/current/);
  // saved again, unchanged: the captured preview is reused, and the design PUT carries If-Match
  const etag = file.etag;
  let n = fake.log.length;
  await clearToasts();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  expect(methodsSince(n)).toEqual(["PROPFIND", "PUT", "PUT", "PROPFIND"]);
  expect(since(n, "GET")).toEqual([]);
  expect(since(n, "PUT")[0].ifMatch).toBe(etag);
  // a server that gives no ETag: the stamp changes kind, so the content is compared first and no If-Match is sent
  fake.etags = false;
  n = fake.log.length;
  await clearToasts();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  expect(methodsSince(n)).toEqual(["PROPFIND", "GET", "PUT", "PUT", "PROPFIND"]);
  expect(since(n, "GET").map((r) => r.name)).toEqual(["Lid-dtlocal1.json"]);
  expect(since(n, "PUT")[0].ifMatch).toBeUndefined();
});

test("a renamed design replaces only its own file on the server", async () => {
  fake.put("other.json", JSON.stringify({ not: "ours" }));
  const other = fake.files.get("other.json").text;
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  await closeDesigns();
  await saveLocal(design("dtlocal1", "Lid 2", 30));
  await clearToasts();
  await openRemote();
  const n = fake.log.length;
  await page.click("#btn-remote-save");
  await toast("Saved “Lid 2” to the server.");
  expect([...fake.files.keys()].sort()).toEqual(["Lid 2-dtlocal1.json", "Lid 2-dtlocal1.json.thumb", "other.json"]);
  expect(fake.files.get("other.json").text).toBe(other);
  expect(since(n, "DELETE").map((r) => r.name)).toEqual(["Lid-dtlocal1.json.thumb", "Lid-dtlocal1.json"]);
  expect((await record()).files.dtlocal1.file).toBe("Lid 2-dtlocal1.json");
});

test("a server copy changed elsewhere is never overwritten without asking", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  await closeDesigns();
  const elsewhere = projectFile(design("dtlocal1", "Lid", 77));
  fake.put("Lid-dtlocal1.json", elsewhere);
  await saveLocal(design("dtlocal1", "Lid", 33));
  await openRemote();
  let n = fake.log.length;
  await page.click("#btn-remote-save");
  await expect(page.locator("#remote-conflict")).toContainText("The server's copy of “Lid” changed since this browser last saw it.");
  expect(since(n, "PUT")).toHaveLength(0);
  expect(fake.files.get("Lid-dtlocal1.json").text).toBe(elsewhere);
  await page.click("#btn-remote-keep");
  await expect(page.locator("#remote-conflict")).toHaveCount(0);
  await expect(status()).toHaveText("Not saved to the server. Open the server's copy to see it; your design here is unchanged.");
  expect(since(n, "PUT")).toHaveLength(0);
  await page.click("#btn-remote-save");
  await expect(page.locator("#remote-conflict")).toBeVisible();
  n = fake.log.length;
  await clearToasts();
  const etag = fake.files.get("Lid-dtlocal1.json").etag;
  await page.click("#btn-remote-replace");
  await toast("Saved “Lid” to the server.");
  const puts = since(n, "PUT");
  expect(puts).toHaveLength(2);
  expect(puts[1]).toMatchObject({ name: "Lid-dtlocal1.json.thumb", type: "text/plain" });
  expect(puts[0].ifMatch).toBe(etag);
  const local = await page.evaluate(() => JSON.stringify({ app: "jumpstart-3d", version: 1, doc: window.__store.doc }, null, 1));
  expect(fake.files.get("Lid-dtlocal1.json").text).toBe(local);
  await expect(page.locator("#remote-conflict")).toHaveCount(0);
});

test("Delete asks first, removes only the server file, and leaves this browser's design", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  expect(Object.keys((await record()).files)).toEqual(["dtlocal1"]);
  const acts = card("Lid").locator(".acts");
  await card("Lid").locator(".del").click();
  await expect(card("Lid").locator(".confirm-row")).toContainText("Delete from the server for good?");
  await card("Lid").locator(".confirm-row .btn", { hasText: "Keep" }).click();
  await expect(acts.locator(".del")).toBeVisible();
  expect(since(0, "DELETE")).toHaveLength(0);
  await card("Lid").locator(".del").click();
  await clearToasts();
  await card("Lid").locator(".confirm-row .btn.danger").click();
  await toast("Deleted “Lid” from the server. A copy in this browser, if any, stays.");
  expect(since(0, "DELETE").map((r) => r.name)).toEqual(["Lid-dtlocal1.json.thumb", "Lid-dtlocal1.json"]);
  expect(fake.files.has("Lid-dtlocal1.json.thumb")).toBe(false);
  expect(fake.files.has("Lid-dtlocal1.json")).toBe(false);
  await expect(cards()).toHaveCount(0);
  expect(await stored("dtlocal1")).not.toBeNull();
  expect((await record()).files).toEqual({});
});

test("a wrong password says so, writes nothing and tries once", async () => {
  seed();
  await openRemote();
  await connectUI({ pass: "wrong" });
  await expect(status()).toHaveText("The server refused that user name or password. Check them (on Nextcloud, use an app password) and click Connect again.");
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.remote"))).toBeNull();
  expect(fake.log).toHaveLength(1);
  expect(fake.log[0].authOk).toBe(false);
  await expect(page.locator("#remote-form")).toBeVisible();
  await connect();
  await expect(cards()).toHaveCount(3);
});

test("with the server down, Save and Open say so and change nothing", async () => {
  seed();
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  const entriesBefore = await entries();
  const savedState = await page.locator("#savestate").textContent();
  fake.down = true;
  const expected = /^Could not reach the server\. The usual causes: /;
  await page.click("#btn-remote-save");
  await expect(status()).toHaveText(expected);
  const text = await status().textContent();
  expect(text.includes("Opened from a file, the page also needs the server to allow every origin (*).")).toBe(single);
  await card("Bracket").locator(".open").click();
  await expect(status()).toHaveText(expected);
  expect(await status().textContent()).toBe(text);
  expect(await entries()).toEqual(entriesBefore);
  expect(await openId()).toBe("dtlocal1");
  await expect(page.locator("#savestate")).toHaveText(savedState);
  expect(savedState).toMatch(/^Saved/);
  fake.down = false;
  await page.click("#btn-remote-save"); // and it works again when the server is back
  await toast("Saved “Lid” to the server.");
});

test("a missing folder is only made when the button is clicked", async () => {
  fake.folder = false;
  await openRemote();
  await connectUI();
  await expect(status()).toContainText("The folder wasn't found on the server (404). Check the address, or create it:");
  await expect(page.locator("#btn-remote-mkcol")).toBeVisible();
  expect(methodsSince(0)).toEqual(["PROPFIND"]);
  expect(fake.folder).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.remote"))).toBeNull();
  await page.click("#btn-remote-mkcol");
  await toast("Created the folder “jumpstart” on the server.");
  expect(methodsSince(0)).toEqual(["PROPFIND", "MKCOL", "PROPFIND"]);
  expect(fake.folder).toBe(true);
  await expect(status()).toHaveText("Connected to dav.example.test: 0 designs there.");
  await expect(page.locator("#designs-remote .empty")).toHaveText("No designs on the server yet. Save the open design to put it there.");
});

test("Test connection reports what Connect would find and keeps nothing", async () => {
  seed();
  await openRemote();
  const record0 = () => page.evaluate(() => localStorage.getItem("jumpstart.remote"));
  const tryIt = async (expected) => {
    await page.fill("#remote-url", BASE);
    await page.fill("#remote-user", "max");
    await page.fill("#remote-pass", "pä55 wörd");
    await page.click("#btn-remote-test");
    await expect(status()).toHaveText(expected);
    expect(await record0()).toBeNull();
    await expect(page.locator("#remote-form")).toBeVisible();
    await expect(page.locator("#btn-remote-mkcol")).toHaveCount(0);
  };
  const n = fake.log.length;
  fake.pass = "something else";
  await tryIt("The server refused that user name or password. Check them (on Nextcloud, use an app password) and click Connect again.");
  fake.pass = "pä55 wörd";
  fake.folder = false;
  await tryIt("The folder wasn't found on the server (404): check the address.");
  fake.folder = true;
  fake.down = true;
  await tryIt(/^Could not reach the server\./);
  fake.down = false;
  await tryIt("The server answered: the folder has 3 designs. Click Connect to use it.");
  expect(since(n).filter((e) => ["PUT", "MKCOL", "DELETE"].includes(e.method))).toEqual([]);
  expect(since(n).map((e) => e.method)).toEqual(["PROPFIND", "PROPFIND", "PROPFIND", "PROPFIND"]);
  await page.click("#btn-remote-connect");
  await expect(status()).toContainText("Connected to");
});

test("Open keeps a local copy it cannot read: the server's design opens as a (from server) copy", async () => {
  seed();
  await page.evaluate(() => window.__app.projects._store.put("dtremote1", "{ not json", { id: "dtremote1", name: "Broken", ver: 0, mode: "beginner", updated: 1, thumb: null }));
  await openRemote();
  await connect();
  const before = await stored("dtremote1");
  await clearToasts();
  await card("Lopez, Maria, Keychain v2").locator(".open").click();
  const t = await toast("This browser's copy of “Lopez, Maria, Keychain v2” couldn't be read");
  expect(t.text).toBe("This browser's copy of “Lopez, Maria, Keychain v2” couldn't be read, so the server's copy opened as “Lopez, Maria, Keychain v2 (from server)”. Yours is unchanged.");
  const id = await openId();
  expect(id).not.toBe("dtremote1");
  expect(await page.evaluate(() => window.__store.doc.name)).toBe("Lopez, Maria, Keychain v2 (from server)");
  expect(await stored("dtremote1")).toBe(before);
});

test("Save compares a file that already has its name, even when the design id is not in the usual shape", async () => {
  await saveLocal(design("t_oddid", "Odd", 30));
  const elsewhere = projectFile(design("t_oddid", "Odd", 77));
  fake.put("Odd-t_oddid.json", elsewhere);
  await openRemote();
  await connect();
  const n = fake.log.length;
  await page.click("#btn-remote-save");
  await expect(page.locator("#remote-conflict")).toBeVisible();
  expect(since(n, "PUT")).toHaveLength(0);
  expect(fake.files.get("Odd-t_oddid.json").text).toBe(elsewhere);
});

test("a renamed design does not overwrite a file another device already wrote under the new name", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  await closeDesigns();
  const elsewhere = projectFile(design("dtlocal1", "Lid 2", 77));
  fake.put("Lid 2-dtlocal1.json", elsewhere);
  await saveLocal(design("dtlocal1", "Lid 2", 30));
  await openRemote();
  const n = fake.log.length;
  await page.click("#btn-remote-save");
  await expect(page.locator("#remote-conflict")).toContainText("“Lid 2”");
  expect(since(n, "PUT")).toHaveLength(0);
  expect(since(n, "DELETE")).toHaveLength(0);
  expect(fake.files.get("Lid 2-dtlocal1.json").text).toBe(elsewhere);
  expect(fake.files.has("Lid-dtlocal1.json")).toBe(true);
});

test("a refused PUT (412) shows the conflict row once; a refused Replace it says so instead of asking again", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  await page.click("#btn-remote-save");
  await toast("Saved “Lid” to the server.");
  await closeDesigns();
  await saveLocal(design("dtlocal1", "Lid", 33));
  await openRemote();
  const n = fake.log.length;
  fake.bump = true;
  await page.click("#btn-remote-save");
  await expect(page.locator("#remote-conflict")).toBeVisible();
  expect(since(n, "PUT")).toHaveLength(1);
  fake.bump = true;
  await page.click("#btn-remote-replace");
  await expect(status()).toHaveText("The server refused to replace it (412). Open the server's copy and save again.");
  await expect(page.locator("#remote-conflict")).toHaveCount(0);
  expect(since(n, "PUT")).toHaveLength(2);
});

test("a 401 on a remembered password drops it, shows the form and is not repeated", async () => {
  seed();
  await openRemote();
  await connect({ remember: true });
  expect((await record()).pass).toBe(fake.pass);
  await closeDesigns();
  fake.pass = "changed elsewhere";
  const n = fake.log.length;
  await boot(page, info0);
  await openRemote();
  await expect(page.locator("#remote-form")).toBeVisible();
  await expect(status()).toHaveText(/^The server refused that user name or password/);
  expect(fake.log.length - n).toBe(1);
  const rec = await record();
  expect(rec).not.toHaveProperty("pass");
  expect(rec).toMatchObject({ url: BASE, user: "max", remember: true });
  await expect(page.locator("#remote-url")).toHaveValue(BASE);
  await page.click("#tab-local");
  await page.click("#tab-remote");
  await expect(page.locator("#remote-form")).toBeVisible();
  expect(fake.log.length - n, "no second try with the same password").toBe(1);
  await closeDesigns();
});

test("a redirect is refused with a plain text, nothing is kept and the new place is not asked", async () => {
  fake.redirect = true;
  await openRemote();
  const text = "The server sent this address somewhere else (a redirect). Type the address it moves to.";
  await page.fill("#remote-url", BASE);
  await page.fill("#remote-user", "max");
  await page.fill("#remote-pass", "pä55 wörd");
  await page.click("#btn-remote-test");
  await expect(status()).toHaveText(text);
  await page.click("#btn-remote-connect");
  await expect(status()).toHaveText(text);
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.remote"))).toBeNull();
  expect(fake.log.map((e) => e.method)).toEqual(["PROPFIND", "PROPFIND"]);
  expect(fake.log.filter((e) => e.path.startsWith("/elsewhere"))).toEqual([]);
});

test("a failed Create the folder does not sign out a connected user", async () => {
  seed();
  await openRemote();
  await connect({ remember: true });
  await closeDesigns();
  fake.folder = false;
  fake.mkcol = 403;
  await boot(page, info0); // the remembered password connects by itself and finds the folder gone
  await openRemote();
  await expect(page.locator("#btn-remote-mkcol")).toBeVisible();
  await page.click("#btn-remote-mkcol");
  await expect(status()).toHaveText("The folder can't be made there (403). Check the address.");
  expect((await page.evaluate(() => window.__app.projects._remote.state())).connected).toBe(true);
  await expect(page.locator("#btn-remote-save")).toBeVisible();
  expect((await record()).pass).toBe(fake.pass);
});

test("inside claude.ai there is no tab strip and no request", async () => {
  await page.evaluate(() => { window.claude = {}; });
  fake.storageHits = 0;
  try {
    await openDesigns();
    await expect(page.locator(".modal-back")).toHaveCount(1);
    await expect(page.locator("#btn-restore")).toBeVisible();
    await expect(page.locator("#designs-tabs")).toHaveCount(0);
    await expect(page.locator("#designs-remote")).toHaveCount(0);
    expect(fake.log).toEqual([]);
    expect(fake.storageHits).toBe(0);
  } finally { await page.evaluate(() => { delete window.claude; }); }
  await closeDesigns();
});


test("Save captures JSON and preview before waiting for the server, even when the open design changes", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  await openRemote();
  await connect();
  const listing = gate(), upload = gate();
  let listed = false, uploading = false;
  fake.beforeRequest = async ({ method, name }) => {
    if (method === "PROPFIND" && !listed) { listed = true; await listing.promise; }
    if (method === "PUT" && name === "Lid-dtlocal1.json") { uploading = true; await upload.promise; }
  };
  await page.evaluate(() => {
    window.__originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    window.__previewCaptures = [];
    HTMLCanvasElement.prototype.toDataURL = function (type, ...args) {
      if (type !== "image/jpeg") return window.__originalToDataURL.call(this, type, ...args);
      const id = window.__store.doc.id;
      window.__previewCaptures.push(id);
      return "data:image/jpeg;base64," + btoa(id);
    };
  });
  try {
    await page.click("#btn-remote-save");
    await expect.poll(() => listed).toBe(true);
    expect(await page.evaluate(() => window.__previewCaptures)).toContain("dtlocal1");
    await loadDoc(page, design("dtlocal2", "Other", 60));
    listing.release();
    await expect.poll(() => uploading).toBe(true);
    await loadDoc(page, design("dtlocal3", "Third", 90));
    upload.release();
    await toast("Saved “Lid” to the server.");
    const puts = since(0, "PUT");
    expect(puts.map((r) => r.name)).toEqual(["Lid-dtlocal1.json", "Lid-dtlocal1.json.thumb"]);
    expect(plain(JSON.parse(puts[0].body).doc.bodies)).toEqual(design("dtlocal1", "Lid", 30).bodies);
    expect(JSON.parse(puts[0].body).doc).toMatchObject({ id: "dtlocal1", name: "Lid" });
    expect(puts[1].body).toBe("data:image/jpeg;base64," + Buffer.from("dtlocal1").toString("base64"));
    expect(await openId()).toBe("dtlocal3");
    expect((await record()).files.dtlocal1.file).toBe("Lid-dtlocal1.json");
  } finally {
    fake.beforeRequest = null;
    listing.release(); upload.release();
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toDataURL = window.__originalToDataURL;
      delete window.__originalToDataURL; delete window.__previewCaptures;
    });
  }
});

test("listings stay usable while previews load progressively with bounded concurrency, and Save reuses previews", async () => {
  await saveLocal(design("dtlocal1", "Lid", 30));
  const thumb = (await entries()).find((e) => e.id === "dtlocal1").thumb;
  expect(thumb).toMatch(/^data:image\/jpeg;base64,/);
  for (let i = 0; i < 9; i++) {
    const doc = design("dtpreview" + i, "Preview " + i, 20 + i);
    const name = doc.name + "-" + doc.id + ".json";
    fake.put(name, projectFile(doc)); fake.put(name + ".thumb", thumb);
  }
  const waiting = new Map();
  let active = 0, peak = 0;
  fake.beforeRequest = async ({ method, name }) => {
    if (method !== "GET" || !name.endsWith(".thumb")) return;
    const pending = gate();
    waiting.set(name, pending);
    peak = Math.max(peak, ++active);
    try { await pending.promise; } finally { active--; }
  };
  try {
    await openRemote();
    await connect();
    await expect(cards()).toHaveCount(9);
    await expect(page.locator("#btn-remote-save")).toBeEnabled();
    await expect.poll(() => waiting.size).toBe(4);
    expect(active).toBe(4);
    for (let i = 0; i < 9; i++) await expect(card("Preview " + i).locator(".open")).toBeEnabled();
    expect(await background("Preview 8")).toBe("none");
    // A thumbnail finishing must not dismiss a Delete/Keep confirmation.
    const first = [...waiting.keys()][0], firstName = first.slice(0, first.indexOf("-dtpreview"));
    await card(firstName).locator(".del").click();
    waiting.get(first).release();
    await expect.poll(() => background(firstName)).toBe(`url("${thumb}")`);
    await expect(card(firstName).locator(".confirm-row")).toBeVisible();
    await expect.poll(() => waiting.size).toBe(5);
    expect(active).toBe(4);
    await card(firstName).locator(".confirm-row .btn", { hasText: "Keep" }).click();
    // Open works while the other four GETs are still stalled.
    await card("Preview 0").locator(".open").click();
    await toast("Opened “Preview 0” from the server.");
    expect(await openId()).toBe("dtpreview0");
    fake.beforeRequest = null;
    for (const pending of waiting.values()) pending.release();
    await expect.poll(() => active).toBe(0);
    await openRemote();
    for (let i = 0; i < 9; i++) await expect.poll(() => background("Preview " + i)).toBe(`url("${thumb}")`);
    expect(peak).toBe(4);
    const n = fake.log.length;
    await page.click("#btn-remote-save");
    await toast("Saved “Preview 0” to the server.");
    expect(since(n, "GET").filter((r) => r.name.endsWith(".thumb"))).toEqual([]);
    await expect(cards()).toHaveCount(9);
  } finally {
    fake.beforeRequest = null;
    for (const pending of waiting.values()) pending.release();
    await expect.poll(() => active).toBe(0);
  }
});

for (const action of ["Delete", "Rename"]) {
  test(`${action} preserves the old JSON, card and record when preview cleanup fails, then retries an absent sidecar`, async () => {
    await saveLocal(design("dtlocal1", "Lid", 30));
    await openRemote();
    await connect();
    await page.click("#btn-remote-save");
    await toast("Saved “Lid” to the server.");
    const oldFile = fake.files.get("Lid-dtlocal1.json").text, oldRecord = (await record()).files.dtlocal1;
    if (action === "Rename") {
      await closeDesigns();
      await saveLocal(design("dtlocal1", "Lid 2", 30));
      await openRemote();
    }
    const perform = async () => {
      if (action === "Rename") return page.click("#btn-remote-save");
      if (await card("Lid").locator(".del").count()) await card("Lid").locator(".del").click();
      await card("Lid").locator(".confirm-row .btn.danger").click();
    };
    await clearToasts();
    fake.previewDelete = 403;
    const n = fake.log.length;
    await perform();
    await expect(status()).toContainText("403");
    expect(since(n, "DELETE").map((r) => r.name)).toEqual(["Lid-dtlocal1.json.thumb"]);
    expect(fake.files.get("Lid-dtlocal1.json").text).toBe(oldFile);
    expect(fake.files.has("Lid-dtlocal1.json.thumb")).toBe(true);
    expect((await record()).files.dtlocal1).toEqual(oldRecord);
    await expect(card("Lid")).toHaveCount(1);
    expect((await toastTexts()).filter((t) => /^(Saved|Deleted) /.test(t))).toEqual([]);
    // Another client removes the advertised sidecar before DELETE: a 404 must not block JSON cleanup.
    fake.previewDelete = 0;
    fake.beforeRequest = async ({ method, name }) => {
      if (method === "DELETE" && name === "Lid-dtlocal1.json.thumb") fake.files.delete(name);
    };
    const retry = fake.log.length;
    await perform();
    await toast(action === "Rename" ? "Saved “Lid 2” to the server." : "Deleted “Lid” from the server.");
    fake.beforeRequest = null;
    expect(since(retry, "DELETE").map((r) => r.name)).toEqual(["Lid-dtlocal1.json.thumb", "Lid-dtlocal1.json"]);
    expect(fake.files.has("Lid-dtlocal1.json")).toBe(false);
    await expect(card("Lid")).toHaveCount(0);
    await expect(page.locator("#remote-conflict")).toHaveCount(0);
    if (action === "Rename") {
      expect((await record()).files.dtlocal1.file).toBe("Lid 2-dtlocal1.json");
      expect(fake.files.has("Lid 2-dtlocal1.json.thumb")).toBe(true);
      await expect(card("Lid 2")).toHaveCount(1);
    } else expect((await record()).files).toEqual({});
  });
}
