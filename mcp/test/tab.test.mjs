// Tab mode: a real page (Playwright) opens the built site and connects itself to the server's WebSocket, the way the
// "Connect to AI agent" menu row does. Also the Origin check, the one-tab rule, and the https site as the page's origin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { WebSocket } from "ws";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { serve } from "../serve.mjs";
import { startServer, call, data, DOCS } from "./helpers.mjs";

const GL = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"];
let s, site, browser, page, port;
before(async () => {
  s = await startServer({ JS3D_MODE: "auto", JS3D_WS_PORT: "0" }); // 0: any free port, so two checkouts can test at once
  site = await serve(DOCS);
  browser = await chromium.launch({ args: GL });
  page = await newPage(browser, site.url);
});
after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
  if (s) await s.close();
});

async function newPage(browser, url) {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await p.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await p.goto(url);
  await p.waitForFunction(() => window.JS3D && window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await p.waitForSelector("#loading", { state: "hidden", timeout: 20_000 });
  return p;
}
async function until(fn, what, ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const status = async (client = s.client) => data(await call(client, "status"));
// opens a socket with the given Origin header: resolves "open" or "refused"
const tryOrigin = (origin, p = port) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${p}`, origin === undefined ? {} : { headers: { Origin: origin } });
  ws.on("open", () => resolve({ result: "open", ws }));
  ws.on("error", () => resolve({ result: "refused" }));
  ws.on("unexpected-response", (req, res) => { res.resume(); resolve({ result: "refused" }); });
});
// a stand-in page: says hello and answers every call with the same canned status
function fakeTab(p, url = "http://localhost:1/") {
  return tryOrigin("http://localhost:1", p).then(({ ws }) => {
    const closed = new Promise((r) => ws.on("close", (code) => r(code)));
    ws.on("message", (m) => { const { id } = JSON.parse(m); ws.send(JSON.stringify({ id, result: { app: "test", js3d: "1.1", design: "Other", designMode: "beginner", bodies: 7 } })); });
    ws.send(JSON.stringify({ hello: "jumpstart-3d", version: "1.1", app: "test", url }));
    return { ws, closed };
  });
}

test("with no tab, status says so and starts nothing", async () => {
  const st = await status();
  assert.equal(st.mode, "auto");
  assert.equal(st.page, "none");
  assert.ok(st.wsPort > 0);
  port = st.wsPort;
  assert.match(st.hint, /Connect to AI agent/);
  assert.match(st.hint, /local network/);
  assert.equal(s.log.join("").includes("starting a headless browser"), false);
});

test("the Origin check: another site's page is refused; local pages and pages opened from disk are let in", async () => {
  assert.equal((await tryOrigin("https://evil.example")).result, "refused");
  assert.equal((await tryOrigin("http://127.0.0.1.evil.example")).result, "refused");
  for (const ok of ["http://localhost:1234", "http://127.0.0.1:8765", "https://maxsikorski.github.io", "null"]) {
    const r = await tryOrigin(ok);
    assert.equal(r.result, "open", ok);
    r.ws.close();
  }
  // peers that never said hello never became the tab
  assert.equal((await status()).page, "none");
});

test("a page that connects becomes the tab, and tools edit that page", async () => {
  await page.evaluate((p) => JS3D.connect("ws://127.0.0.1:" + p), port);
  await until(async () => (await status()).page === "tab", "the tab to connect");
  const st = await status();
  assert.equal(st.page, "tab");
  assert.equal(st.js3d, "1.1");
  assert.equal(st.bodies, 0);
  assert.equal(st.url, site.url);
  const id = data(await call(s.client, "add_shape", { kind: "cylinder", size: { w: 10, d: 10, h: 30 }, name: "Peg" }));
  const list = await page.evaluate(() => JS3D.list());
  assert.deepEqual(list.map((b) => [b.id, b.name]), [[id, "Peg"]]);
  data(await call(s.client, "wait_ready"));
  assert.equal((await status()).bodies, 1);
  // bytes cross as base64 and come back as a picture
  const shot = await call(s.client, "screenshot", { width: 400 });
  assert.equal(Buffer.from(shot.content[0].data, "base64").readUInt32BE(16), 400);
  // the page's own error message comes back
  const bad = await call(s.client, "get_body", { id: "nope" });
  assert.equal(bad.isError, true);
  assert.equal(bad.content[0].text, "no body nope");
  assert.equal(s.log.join("").includes("starting a headless browser"), false); // a tab was there, so no browser was started
});

test("a second tab is refused while the first is live, and connects after the first has gone", async () => {
  const second = await fakeTab(port);
  assert.equal(await second.closed, 4001);
  assert.equal((await status()).url, site.url); // still the first tab
  await page.evaluate(() => JS3D.disconnect());
  await until(async () => (await status()).hint, "the first tab to be forgotten");
  const third = await fakeTab(port);
  await until(async () => (await status()).url === "http://localhost:1/", "the new tab to be taken");
  assert.equal((await status()).design, "Other");
  third.ws.close();
});

test("the session stays with its tab: a lost tab means an error after a short wait, never a headless browser", async () => {
  await until(async () => (await status()).page === "none", "the tab to be forgotten");
  const st = await status();
  assert.match(st.hint, /Connect to AI agent/);
  const t0 = Date.now();
  const r = await call(s.client, "list_bodies");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /tab disconnected; turn Connect to AI agent on again or reload it, then retry/);
  assert.ok(Date.now() - t0 >= 4500, "it waited for the tab to come back");
  assert.equal(s.log.join("").includes("starting a headless browser"), false);
});

test("the https site can be the page's origin (with the browser's local network permission)", async () => {
  const SITE = "https://maxsikorski.github.io/jumpstart-3d/";
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/octet-stream", ".png": "image/png" };
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await context.grantPermissions(["local-network-access"]);
  await context.route(SITE + "**", async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/jumpstart-3d\//, "") || "index.html";
    try { await route.fulfill({ body: await readFile(join(DOCS, name)), contentType: types[extname(name)] || "application/octet-stream" }); }
    catch { await route.fulfill({ status: 404, body: "not found" }); }
  });
  const p = await context.newPage();
  try {
    await p.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await p.goto(SITE);
    await p.waitForFunction(() => window.JS3D && window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
    await p.evaluate((n) => JS3D.connect("ws://127.0.0.1:" + n), port);
    await until(async () => (await status()).url === SITE, "the https page to connect");
    assert.equal(data(await call(s.client, "list_kinds")).length, 20);
  } finally { await context.close(); }
});

test("an open tab is not switched to once the session is headless", async () => {
  const other = await startServer({ JS3D_MODE: "auto", JS3D_WS_PORT: "0" });
  try {
    const wsPort = (await status(other.client)).wsPort;
    assert.deepEqual(data(await call(other.client, "list_bodies")), []); // no tab yet: this starts the headless browser
    assert.equal((await status(other.client)).page, "headless");
    const tab = await fakeTab(wsPort);
    await until(async () => /restart the server/.test((await status(other.client)).hint || ""), "the status to mention the tab");
    const st = await status(other.client);
    assert.equal(st.page, "headless");
    assert.match(st.hint, /a tab is connected but this session is headless; restart the server to use the tab/);
    assert.deepEqual(data(await call(other.client, "list_bodies")), []); // still the headless page, not the fake tab
    tab.ws.close();
  } finally { await other.close(); }
});

test("a taken WebSocket port is reported by status; the server keeps running", async () => {
  const taken = createServer();
  await new Promise((r) => taken.listen(0, "127.0.0.1", r));
  const other = await startServer({ JS3D_MODE: "auto", JS3D_WS_PORT: String(taken.address().port) });
  try {
    const st = await status(other.client);
    assert.equal(st.page, "none");
    assert.equal(st.wsPort, null);
    assert.match(st.wsError, /could not listen on port \d+/);
    assert.match(other.log.join(""), /headless only/);
  } finally { await other.close(); await new Promise((r) => taken.close(r)); }
});
