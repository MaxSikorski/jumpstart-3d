// Agent link tests: JS3D.connect / disconnect / invoke, the "Connect to AI agent" setting, JS3D.run and screenshot width,
// on both builds. A tiny WebSocket server (the `ws` package) stands in for mcp/server.mjs on a free port, so the tests never
// touch a real server on port 8822; the menu row, which always uses 8822, is served by a mock route inside the page instead.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import { boot, settle, watchErrors } from "./helpers.mjs";

const DEMO = readFileSync(new URL("../tools/bridge-demo.js", import.meta.url), "utf8");
const BOX_WITH_HOLE = 40 * 30 * 20 - Math.PI * 4 * 4 * 20;
const pngWidth = (bytes) => Buffer.from(bytes).readUInt32BE(16); // IHDR: right after the 8-byte signature and the chunk header

// a stand-in tool server: records hellos and connections, asks the page to run calls and waits for each reply
function listen(port = 0) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port }, () => {
      let seq = 0;
      const srv = { port: wss.address().port, hellos: [], connections: 0, closes: [], conn: null, replies: new Map() };
      wss.on("connection", (ws) => {
        srv.connections++;
        srv.conn = ws;
        ws.on("message", (m) => { const msg = JSON.parse(m); if (msg.hello) srv.hellos.push(msg); else srv.replies.get(msg.id)?.(msg); });
        ws.on("close", (code) => srv.closes.push(code));
      });
      srv.ask = (call, args = []) => new Promise((res) => { const id = ++seq; srv.replies.set(id, res); srv.conn.send(JSON.stringify({ id, call, args })); });
      srv.stop = () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); });
      resolve(srv);
    });
  });
}

let page, errors, sockets, mock;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  sockets = [];
  page.on("websocket", (w) => sockets.push(w.url()));
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  // the menu row connects to ws://127.0.0.1:8822; answer it here so the tests never reach a real server
  mock = { opens: 0, hellos: [], closes: 0 };
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:8822\/?$/, (ws) => {
    mock.opens++;
    ws.onMessage((m) => { const msg = JSON.parse(String(m)); if (msg.hello) mock.hellos.push(msg); });
    ws.onClose(() => mock.closes++);
  });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
// Chromium itself logs every refused WebSocket attempt as a console error; those are not the app's errors
test.afterEach(() => { expect(errors.filter((e) => !/WebSocket connection to/.test(e)), "console or page errors").toEqual([]); });

const state = () => page.evaluate(() => JS3D.connection());
const row = () => page.locator("#menu-theme button[data-agent]");
const openMenu = async () => { if (await page.locator("#menu-theme").isHidden()) await page.click("#btn-theme"); };

test("off by default: the page opens no WebSocket, and the menu row says off", async () => {
  await page.waitForTimeout(2000);
  expect(sockets).toEqual([]);
  expect(mock.opens).toBe(0); // the 8822 socket is answered in-page, where page.on("websocket") cannot see it
  expect(mock.hellos).toEqual([]);
  expect(await state()).toMatchObject({ on: false, state: "off" });
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.agent"))).toBeNull();
  await openMenu();
  await expect(row()).toBeVisible();
  await expect(row()).toContainText("Connect to AI agent");
  await expect(row()).toHaveAttribute("aria-checked", "false");
  await expect(row()).toHaveAttribute("role", "menuitemcheckbox");
  await expect(page.locator("#menu-theme")).toContainText("Off unless you turn it on");
  await page.click("#btn-theme");
});

test("connect sends a hello; list, export and errors round-trip; disconnect closes", async () => {
  const srv = await listen();
  try {
    await page.evaluate((p) => JS3D.connect("ws://127.0.0.1:" + p), srv.port);
    await expect.poll(() => srv.hellos.length).toBe(1);
    expect(srv.hellos[0]).toMatchObject({ hello: "jumpstart-3d", version: "1.1", url: await page.evaluate(() => location.href) });
    expect(srv.hellos[0].app).toMatch(/^\d/);
    expect(await state()).toEqual({ on: true, url: `ws://127.0.0.1:${srv.port}`, state: "connected" });

    await page.evaluate(() => JS3D.newDesign("beginner"));
    expect((await srv.ask("list")).result).toEqual([]);
    const id = (await srv.ask("add", ["box", { size: [40, 30, 20] }])).result;
    expect(id).toMatch(/\S/);
    expect(await srv.ask("ready")).toEqual({ id: expect.any(Number) }); // no result key: undefined
    const listed = (await srv.ask("list")).result;
    expect(listed[0]).toMatchObject({ id, kind: "box" });
    expect(listed[0].volume).toBeCloseTo(24000, 1);

    // bytes cross as base64: the STL decodes and its length matches its triangle count
    const stl = (await srv.ask("export", ["stl"])).result;
    expect(Object.keys(stl)).toEqual(["$bytes"]);
    const bytes = Buffer.from(stl.$bytes, "base64");
    expect(bytes.readUInt32LE(80)).toBeGreaterThan(0);
    expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80));

    // errors come back as messages; unknown names, internals, invoke itself and non-calls are refused
    expect((await srv.ask("get", ["nope"])).error).toBe("no body nope");
    expect((await srv.ask("nope")).error).toBe('unknown call "nope"');
    expect((await srv.ask("internals")).error).toBe('unknown call "internals"');
    expect((await srv.ask("invoke", ["list"])).error).toBe('unknown call "invoke"');
    expect((await srv.ask("version")).error).toBe('unknown call "version"');
    expect((await srv.ask("toString")).error).toBe('unknown call "toString"');
    expect((await srv.ask("add", ["teapot"])).error).toMatch(/unknown kind "teapot"/);

    // calls run one at a time, in the order they arrive: the slow export comes first and must also answer first
    const arrived = [];
    const sent = ["export", "rename", "rename", "get"].map((call, i) => srv.ask(call, [["stl"], [id, "First"], [id, "Second"], [id]][i]).then((r) => { arrived.push(call + i); return r; }));
    const order = await Promise.all(sent);
    expect(arrived).toEqual(["export0", "rename1", "rename2", "get3"]);
    expect(order[3].result.name).toBe("Second");

    await page.evaluate(() => JS3D.disconnect());
    await expect.poll(() => srv.closes.length).toBe(1);
    expect(await state()).toMatchObject({ on: false, state: "off" });
    await page.waitForTimeout(3500); // longer than the retry time: nothing reconnects
    expect(srv.connections).toBe(1);
  } finally { await srv.stop(); }
});

test("connect refuses an address that is not ws:// or wss://", async () => {
  const msg = await page.evaluate(() => { try { JS3D.connect("http://127.0.0.1:1"); return null; } catch (e) { return e.message; } });
  expect(msg).toMatch(/ws:\/\/ or wss:\/\//);
  expect(await state()).toMatchObject({ on: false });
});

test("when the server goes away the state is waiting, and a new server gets a new hello within 5 seconds", async () => {
  const first = await listen();
  await page.evaluate((p) => JS3D.connect("ws://127.0.0.1:" + p), first.port);
  await expect.poll(() => first.hellos.length).toBe(1);
  await first.stop();
  await expect.poll(async () => (await state()).state).toBe("waiting");
  const second = await listen(first.port);
  try {
    await expect.poll(() => second.hellos.length, { timeout: 5000 }).toBe(1);
    expect((await state()).state).toBe("connected");
    // the server can tell this tab that another one took over: it stops quietly instead of fighting for the connection
    second.conn.close(4001, "another tab took over");
    await expect.poll(async () => (await state()).state).toBe("off");
    await page.waitForTimeout(3500);
    expect(second.connections).toBe(1);
  } finally { await second.stop(); await page.evaluate(() => JS3D.disconnect()); }
});

test("the menu row turns the setting on and off, and the setting survives a reload", async () => {
  await openMenu();
  await row().click();
  await expect(row()).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => mock.hellos.length).toBe(1);
  await expect(row()).toContainText("connected");
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.agent"))).toBe("on");
  expect(await state()).toMatchObject({ on: true, url: "ws://127.0.0.1:8822", state: "connected" });

  // reload: the page reconnects by itself
  await settle(page);
  await page.reload();
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await expect.poll(() => mock.hellos.length).toBe(2);
  expect(await state()).toMatchObject({ on: true, state: "connected" });
  await openMenu();
  await expect(row()).toHaveAttribute("aria-checked", "true");

  await row().click();
  await expect(row()).toHaveAttribute("aria-checked", "false");
  expect(await state()).toMatchObject({ on: false, state: "off" });
  expect(await page.evaluate(() => localStorage.getItem("jumpstart.agent"))).toBe("off");
  await expect.poll(() => mock.closes).toBe(2);
  const opens = mock.opens;
  await settle(page);
  await page.reload(); // off stays off
  await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  expect(mock.opens).toBe(opens);
  expect(await state()).toMatchObject({ on: false });
});

test("JS3D.run runs the demo text and returns its summary", async () => {
  const sum = await page.evaluate((text) => JS3D.run(text), DEMO);
  expect(sum.sameShape).toBe(true);
  expect(sum.volume).toBeCloseTo(BOX_WITH_HOLE, 0);
  // top-level await and return, and a plain expression
  expect(await page.evaluate(() => JS3D.run("await JS3D.ready(); return JS3D.list().length;"))).toBe(1);
  expect(await page.evaluate(() => JS3D.run("1 + 2"))).toBe(3);
  expect(await page.evaluate(() => JS3D.run("throw new Error('boom')").catch((e) => e.message))).toBe("boom");
  expect(await page.evaluate(() => JS3D.run(5).catch((e) => e.message))).toMatch(/script as text/);
});

test("screenshot({width}) is that wide with the same shape; invoke gives the same bytes as base64", async () => {
  const full = await page.evaluate(async () => Array.from(await JS3D.screenshot({ fit: true })));
  const small = await page.evaluate(async () => Array.from(await JS3D.screenshot({ fit: true, width: 300 })));
  expect(pngWidth(small)).toBe(300);
  const dim = (b) => [Buffer.from(b).readUInt32BE(16), Buffer.from(b).readUInt32BE(20)];
  const [fw, fh] = dim(full), [sw, sh] = dim(small);
  expect(sw).toBe(300);
  expect(Math.abs(sh - Math.round((fh * 300) / fw))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(async () => (await JS3D.screenshotDataURL({ width: 120 })).slice(0, 22))).toBe("data:image/png;base64,");
  expect(pngWidth(Buffer.from((await page.evaluate(() => JS3D.invoke("screenshot", [{ width: 200 }]))).$bytes, "base64"))).toBe(200);
  expect(pngWidth(await page.evaluate(async () => Array.from(await JS3D.screenshot())))).toBe(fw); // no width: unchanged
  for (const bad of [0, -5, "300", 99999, NaN]) {
    expect(await page.evaluate((w) => JS3D.screenshot({ width: w }).catch((e) => e.message), bad)).toMatch(/width must be a number/);
  }
});
