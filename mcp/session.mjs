// How the server reaches a JumpStart 3D page. Two ways, one call(name, args):
//   tab       the app open in the user's browser connects to our WebSocket (Connect to AI agent, in the theme menu)
//   headless  we start our own Chromium (Playwright) on the built site and call JS3D inside it
// Both end in JS3D.invoke(call, args) (src/bridge.js), so a call means the same thing either way.
// stdout is the MCP protocol: everything we say goes to stderr.
import { WebSocketServer } from "ws";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "./serve.mjs";

const PUBLIC_APP = "https://maxsikorski.github.io/jumpstart-3d/";
const CALL_TIMEOUT_MS = 120_000;
const BOOT_TIMEOUT_MS = 120_000;
const TAB_RETURN_MS = 5000; // how long a call waits for a tab that dropped to come back
const CHROMIUM_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]; // WebGL without a GPU, as the tests run it
const ORIGINS = [/^https:\/\/maxsikorski\.github\.io$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/, /^null$/]; // null: a page opened from disk

export const HELP = `jumpstart-mcp: an MCP server (stdio) that lets an AI agent edit a design in JumpStart 3D.

Environment variables:
  JS3D_MODE      auto (default) | tab | headless
                 auto: use the open browser tab if one is connected, else start a headless browser
  JS3D_WS_PORT   port the open tab connects to, on 127.0.0.1 (default 8822; 0 picks a free one)
  JS3D_APP       what headless mode opens: a web address, a .html file, or a folder holding the built site
                 (default: the docs/ folder of this checkout, else ${PUBLIC_APP})
  JS3D_VIEWPORT  headless window size, WIDTHxHEIGHT (default 1000x700)

Logs go to stderr; stdout is the protocol.`;

const allowedOrigin = (origin) => origin === undefined || ORIGINS.some((re) => re.test(origin)); // browsers always send one; other local programs may not

// {"$bytes": base64} -> Buffer (top level only, as JS3D.invoke makes it)
function decode(r) {
  return r && typeof r === "object" && typeof r.$bytes === "string" && Object.keys(r).length === 1 ? Buffer.from(r.$bytes, "base64") : r;
}

export class Session {
  constructor({ mode = "auto", wsPort = 8822, viewport = "1000x700", app, log = (m) => console.error("jumpstart-mcp: " + m) } = {}) {
    if (!["auto", "tab", "headless"].includes(mode)) throw new Error(`JS3D_MODE must be auto, tab or headless, not "${mode}"`);
    const m = /^(\d+)x(\d+)$/.exec(viewport);
    if (!m) throw new Error(`JS3D_VIEWPORT must look like 1000x700, not "${viewport}"`);
    if (!/^\d+$/.test(String(wsPort)) || Number(wsPort) > 65535) throw new Error(`JS3D_WS_PORT must be a whole number from 0 to 65535, not "${wsPort}"`);
    Object.assign(this, { mode, wsPort: Number(wsPort), viewport: { width: +m[1], height: +m[2] }, appSpec: app, log });
    this.wss = null; this.wsError = null;
    this.tab = null; // { ws, hello } once a page has said hello
    this.pending = new Map(); this.seq = 0;
    this.hl = null; // the running headless browser: { browser, page, static }
    this.launching = null; // the promise while it starts
    this.pinned = null; // "tab" or "headless": the page the first call went to; later calls never go anywhere else
    this.chain = Promise.resolve(); // calls run one at a time, in the order they arrive
  }

  static fromEnv(env = process.env) {
    return new Session({ mode: env.JS3D_MODE || undefined, wsPort: env.JS3D_WS_PORT === undefined || env.JS3D_WS_PORT === "" ? undefined : env.JS3D_WS_PORT, viewport: env.JS3D_VIEWPORT || undefined, app: env.JS3D_APP || undefined });
  }

  // ------------------------------------------------------------- the open tab
  async start() {
    if (this.mode === "headless") return;
    await new Promise((done) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: this.wsPort, maxPayload: 1 << 30, verifyClient: ({ origin }) => allowedOrigin(origin) });
      wss.once("listening", () => { this.wss = wss; this.wsPort = wss.address().port; this.log(`waiting for a browser tab on ws://127.0.0.1:${this.wsPort}`); done(); });
      wss.once("error", (e) => {
        this.wsError = `could not listen on port ${this.wsPort} (${e.code || e.message})`;
        this.log(this.wsError + "; headless only");
        done();
      });
      wss.on("connection", (ws, req) => {
        ws.on("message", (data) => this.#onMessage(ws, data));
        ws.on("close", () => this.#onClose(ws));
        ws.on("error", () => {});
      });
    });
  }
  #onMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.hello === "jumpstart-3d") {
      if (this.tab && this.tab.ws !== ws) { // a tab that is connected is never replaced: the newcomer is told to stop trying
        this.log("a second tab tried to connect; refused");
        ws.close(4001, "another tab already has the AI agent link");
        return;
      }
      this.tab = { ws, hello: msg };
      this.log(`tab connected (app ${msg.app}, JS3D ${msg.version}, ${msg.url})`);
    } else if (this.tab && this.tab.ws === ws && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error !== undefined) p.reject(new Error(msg.error)); else p.resolve(msg.result === undefined ? null : msg.result);
    }
  }
  #onClose(ws) {
    if (!this.tab || this.tab.ws !== ws) return;
    this.tab = null;
    this.log("tab disconnected");
    this.#failPending("The tab disconnected before it answered.");
  }
  #failPending(why) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    this.pending.clear();
  }

  // ------------------------------------------------------------- headless
  async #launch() {
    let browser, stat;
    try {
      const { chromium } = await import("playwright");
      const spec = this.appSpec || this.defaultApp();
      let url = spec;
      if (!/^(https?|file):\/\//i.test(spec)) {
        const path = resolve(spec);
        if (!existsSync(path)) throw new Error(`JS3D_APP not found: ${path}`);
        if (statSync(path).isDirectory()) { stat = await serve(path); url = stat.url; } else url = pathToFileURL(path).href;
      }
      this.log(`starting a headless browser on ${url}`);
      browser = await chromium.launch({ args: CHROMIUM_ARGS });
      const context = await browser.newContext({ viewport: this.viewport });
      await context.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
      const page = await context.newPage();
      page.on("pageerror", (e) => this.log("page error: " + e.message));
      await page.goto(url, { timeout: BOOT_TIMEOUT_MS });
      await page.waitForFunction(() => window.JS3D && window.__app && window.__app.kernel && window.__app.kernel.ready, null, { timeout: BOOT_TIMEOUT_MS });
      await page.waitForSelector("#loading", { state: "hidden", timeout: BOOT_TIMEOUT_MS });
      const h = (this.hl = { browser, page, static: stat });
      browser.on("disconnected", () => { if (this.hl === h) this.hl = null; if (stat) stat.close(); });
      this.log("headless browser ready");
      return h;
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      if (stat) await stat.close();
      throw new Error("could not start the headless browser: " + e.message);
    }
  }
  defaultApp() {
    const docs = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs");
    return existsSync(resolve(docs, "index.html")) ? docs : PUBLIC_APP;
  }

  // ------------------------------------------------------------- calls
  // "tab", "headless" or null: the page calls go to, without starting anything. The first call pins the session to one page.
  target() {
    if (this.pinned) return this.pinned;
    if (this.mode !== "headless" && this.tab) return "tab";
    return null;
  }

  // timeoutMs: how long to wait for the page's answer
  call(name, args = [], { timeoutMs = CALL_TIMEOUT_MS } = {}) {
    const run = this.chain.then(() => this.#call(name, args, timeoutMs));
    this.chain = run.catch(() => {});
    return run;
  }
  async #call(name, args, timeoutMs) {
    const where = this.pinned || (this.mode === "headless" ? "headless" : this.tab || this.mode === "tab" ? "tab" : "headless");
    if (where === "tab") {
      if (!this.tab) {
        if (!this.pinned) throw new Error(this.noTab());
        await this.#waitForTab(TAB_RETURN_MS);
        if (!this.tab) throw new Error("The tab disconnected; turn Connect to AI agent on again or reload it, then retry.");
      }
      this.pinned = "tab";
      return decode(await this.#callTab(name, args, timeoutMs));
    }
    if (!this.hl) await (this.launching ||= this.#launch().finally(() => { this.launching = null; }));
    if (!this.hl) throw new Error("the headless browser closed right after it started");
    this.pinned = "headless";
    return decode(await this.#callHeadless(name, args, timeoutMs));
  }
  async #waitForTab(ms) {
    for (let t0 = Date.now(); !this.tab && Date.now() - t0 < ms;) await new Promise((r) => setTimeout(r, 100));
  }
  noTab() {
    return "No JumpStart 3D tab is connected. Open the app in a browser, open the theme menu (the half-moon button) and turn on Connect to AI agent; if the browser asks about local network access, allow it." + (this.wsError ? ` (The server ${this.wsError}.)` : "");
  }
  #callTab(name, args, timeoutMs) {
    const { ws } = this.tab;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`The tab did not answer ${name} within ${timeoutMs / 1000} s.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, call: name, args }));
    });
  }
  async #callHeadless(name, args, timeoutMs) {
    const { page } = this.hl;
    let timer;
    const out = await Promise.race([
      page.evaluate(async ([call, a]) => {
        try { const r = await window.JS3D.invoke(call, a); return { ok: r === undefined ? null : r }; } catch (e) { return { err: (e && e.message) || String(e) }; }
      }, [name, args]),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error(`The headless browser did not answer ${name} within ${timeoutMs / 1000} s.`)), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (out.err !== undefined) throw new Error(out.err);
    return out.ok;
  }

  // what the status tool reports; never starts a browser
  async status() {
    const t = this.target();
    const live = t === "tab" ? !!this.tab : t === "headless" ? !!this.hl : false;
    const s = { mode: this.mode, page: live ? t : "none", wsPort: this.wss ? this.wsPort : null };
    if (this.wsError) s.wsError = this.wsError;
    if (this.pinned === "headless" && this.tab) s.hint = "a tab is connected but this session is headless; restart the server to use the tab";
    if (!live) {
      s.hint = this.pinned === "tab" ? "The tab disconnected; turn Connect to AI agent on again or reload it. Calls wait 5 seconds for it, then fail." :
        this.pinned === "headless" ? "The headless browser starts again on the next tool call that needs a page." :
        this.mode === "tab" ? this.noTab() : this.mode === "headless" ? "A headless browser starts on the first tool call that needs a page." :
        "No page yet. Open JumpStart 3D and turn on Connect to AI agent in the theme menu to use that tab (allow the browser's local network permission if it asks), or call any other tool to start a headless browser.";
      return s;
    }
    s.url = t === "tab" ? this.tab.hello.url : this.hl.page.url();
    try {
      return { ...s, ...(await this.call("run", ["({ app: JS3D.appVersion, js3d: JS3D.version, design: JS3D.doc().name, designMode: JS3D.mode(), bodies: JS3D.list().length })"])) };
    } catch (e) { return { ...s, error: e.message }; } // the page went away or is busy: still say what we know
  }

  async close() {
    this.#failPending("The server is shutting down.");
    if (this.wss) { for (const c of this.wss.clients) c.terminate(); await new Promise((r) => this.wss.close(r)); this.wss = null; }
    if (this.launching) await this.launching.catch(() => {});
    const h = this.hl;
    this.hl = null;
    if (h) { await h.browser.close().catch(() => {}); if (h.static) await h.static.close(); }
  }
}
