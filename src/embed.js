// A temporary design controlled by an explicitly allowed parent website.
import { store, newDoc } from "./store.js";

const NAMES = Object.freeze("supports describe ready kinds list get doc save params mode selection add fastener holePattern gear namePlate knurl spring remove delete duplicate move moveTo rotate resize scale setHole setColor rename setHidden group ungroup setParam removeParam bind undo redo select fit setMode screenshot screenshotDataURL export newDesign sketch extrude revolve fillet chamfer shell hole pattern faces edges inspect measure printCheck collisions section boxMaker gearSet hardware textures texture drawing checkpoint checkpoints diff rollback".split(" "));
const MAX_ARGS = 1024 * 1024, MAX_RESULT = 32 * 1024 * 1024;

export function parseAllow(value, ownOrigin) {
  const entries = String(value || "").split(/[\s,]+/).filter(Boolean);
  if (entries.length > 8) return [];
  return [...new Set(entries.filter((entry) => {
    try {
      const u = new URL(entry);
      return entry === u.origin && entry !== ownOrigin && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
    } catch { return false; }
  }))];
}

function validate(args) {
  const seen = new Set(); let count = 0, strings = 0;
  function visit(v, depth) {
    if (++count > 100000) throw Error("too many argument values");
    if (typeof v === "string" && (strings += v.length) > MAX_ARGS) throw Error("arguments are too big");
    if (depth > 32) throw Error("arguments are too deep");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object") throw Error("invalid arguments");
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw Error("invalid arguments");
    if (seen.has(v)) throw Error("invalid arguments");
    seen.add(v);
    if (Array.isArray(v) && (v.length > 100000 || Object.keys(v).length !== v.length)) throw Error("invalid array");
    for (const key of Object.keys(v)) {
      if (Array.isArray(v) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length)) throw Error("invalid array");
      if ((strings += key.length) > MAX_ARGS) throw Error("arguments are too big");
      if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("invalid argument key");
      visit(v[key], depth + 1);
    }
  }
  visit(args, 0);
  if (new TextEncoder().encode(JSON.stringify(args)).length > MAX_ARGS) throw Error("arguments are too big");
}

export function createChannel({ api, allow, parent, post, now = Date.now, onState = () => {}, onCall = () => () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const calls = Object.fromEntries(NAMES.filter((n) => typeof api[n] === "function").map((n) => [n, api[n].bind(api)]));
  const ready = { type: "js3d-ready", protocol: 1, apiVersion: api.apiVersion ?? api.version, calls: Object.keys(calls) };
  let open = true, started = false, lastId = 0, lastHello = -Infinity, running = false;
  let times = [], queue = [], activeOrigin = null;
  const send = (msg, origin) => { if (open) post(msg, origin); };
  const fail = (id, error, origin) => send({ type: "js3d-result", protocol: 1, id, error }, origin);
  function close(reason) {
    if (!open) return;
    open = false; queue = [];
    for (const origin of allow) post({ type: "js3d-closed", protocol: 1, reason }, origin);
    onState(reason);
  }
  async function drain() {
    if (running || !open) return;
    running = true;
    while (queue.length && open) {
      const { id, call, args, origin } = queue.shift();
      try {
        const endCall = onCall();
        let work;
        try { work = Promise.resolve(calls[call](...args)).finally(endCall); work.catch(() => {}); }
        catch (e) { endCall(); throw e; }
        let timer;
        const deadline = new Promise((_, reject) => { timer = setTimer(() => reject(Error("the call took longer than 10 minutes; reload the page to start again")), 600000); });
        let result;
        try { result = await Promise.race([work, deadline]); }
        catch (e) { if (e.message === "the call took longer than 10 minutes; reload the page to start again") { fail(id, e.message, origin); close("timeout"); break; } throw e; }
        finally { clearTimer(timer); }
        if (!open) break;
        if (result === undefined) result = null;
        if (result instanceof Uint8Array) result = result.slice();
        const size = result instanceof Uint8Array ? result.byteLength : new TextEncoder().encode(JSON.stringify(result)).length;
        if (size > MAX_RESULT) throw Error("the result is too big to send");
        send({ type: "js3d-result", protocol: 1, id, result }, origin);
      } catch (e) { fail(id, String(e?.message || e), origin); }
    }
    running = false;
  }
  function receive(event) {
    if (!open || !started || event.source !== parent || !allow.includes(event.origin)) return;
    const m = event.data;
    if (!m || m.protocol !== 1) return;
    if (m.type === "js3d-hello") {
      if (now() - lastHello >= 1000) { lastHello = now(); send(ready, event.origin); }
      return;
    }
    if (m.type !== "js3d-call") return;
    const { id, call } = m;
    if (!Number.isSafeInteger(id) || id <= 0 || id <= lastId) { if (Number.isInteger(id)) fail(id, "id must be a positive safe integer greater than earlier ids", event.origin); return; }
    lastId = id;
    const t = now(); times = times.filter((v) => t - v < 1000);
    if (times.length >= 30) { fail(id, "too many calls per second", event.origin); return; }
    times.push(t);
    if (!Object.hasOwn(calls, call)) { fail(id, NAMES.includes(call) ? "unknown call" : "this call is not available to embedding websites", event.origin); return; }
    let args = m.args === undefined ? [] : m.args;
    try {
      if (!Array.isArray(args)) throw Error("args must be an array");
      validate(args);
      if (call === "setMode" && !["beginner", "advanced"].includes(args[0])) throw Error('mode must be "beginner" or "advanced"');
      if (call === "newDesign" && args[0] !== undefined && !["beginner", "advanced"].includes(args[0])) throw Error('mode must be "beginner" or "advanced"');
      if (call === "printCheck") args = [{ ...(args[0] || {}), printer: args[0]?.printer ?? "generic", angle: args[0]?.angle ?? 45 }];
      if (queue.length >= 16) throw Error("too many calls waiting");
      if (!activeOrigin) { activeOrigin = event.origin; onState("controlled", activeOrigin); }
      queue.push({ id, call, args, origin: event.origin }); drain();
    } catch (e) { fail(id, String(e.message || e), event.origin); }
  }
  return { receive, close, start() { if (!open || started) return; started = true; for (const origin of allow) send(ready, origin); }, get open() { return open; } };
}

export function embedActive() {
  return typeof window !== "undefined" && window.parent !== window && /^(https?:)$/.test(location.protocol) && new URLSearchParams(location.search).has("embed");
}

export function storageOverlay(real) {
  const values = new Map(), removed = new Set(); let cleared = false;
  const keys = () => {
    const all = [];
    if (!cleared) try { for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k !== null && !removed.has(k)) all.push(k); } } catch {}
    for (const k of values.keys()) if (!all.includes(k)) all.push(k);
    return all;
  };
  return {
    get length() { return keys().length; },
    key(i) { return keys()[i] ?? null; },
    getItem(key) { key = String(key); if (values.has(key)) return values.get(key); if (cleared || removed.has(key)) return null; try { return real.getItem(key); } catch { return null; } },
    setItem(key, value) { key = String(key); values.set(key, String(value)); removed.delete(key); },
    removeItem(key) { key = String(key); values.delete(key); removed.add(key); },
    clear() { values.clear(); removed.clear(); cleared = true; },
  };
}

if (embedActive()) {
  let real; try { real = window.localStorage; } catch {}
  const overlay = storageOverlay(real);
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => overlay });
}

// While a website's call runs, edits may only touch a temporary design (newDesign switches between them).
export function guardUpdates(store, isScratch) {
  let active = false;
  const update = store.update;
  store.update = function (...args) {
    if (active && !isScratch(store.doc.id)) throw Error("the design changed, so this website's call was stopped");
    return update.apply(this, args);
  };
  return () => { active = true; return () => { active = false; }; };
}

export function startEmbed(app, api) {
  const allow = parseAllow(new URLSearchParams(location.search).get("embed"), location.origin);
  const ids = new Set();
  const onCall = guardUpdates(store, (id) => ids.has(id));
  app.embed = { isScratch: (id) => ids.has(id) };
  const bar = document.createElement("div"), status = document.createElement("span"), stop = document.createElement("button"), link = document.createElement("a");
  bar.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:10000;padding:8px 10px;background:#fff;color:#111;border:1px solid #555;border-radius:6px;box-shadow:0 2px 8px #0005;font:14px sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
  status.setAttribute("aria-live", "polite");
  status.textContent = allow.length ? "Temporary design, not saved. Waiting for the website." : "Temporary design, not saved. The website did not give a valid address to allow.";
  stop.textContent = "Stop"; link.textContent = "Open the full app";
  link.href = location.origin + location.pathname; link.target = "_blank"; link.rel = "noopener noreferrer";
  bar.append(status, stop, link); document.body.append(bar);
  const channel = createChannel({ api: { ...api, newDesign: (mode = "beginner") => { const doc = newDoc("Untitled", mode); ids.add(doc.id); app.projects.embedNew(doc); return api.ready(); } }, allow, onCall, parent: window.parent, post: (msg, origin) => window.parent.postMessage(msg, origin), onState: (state, origin) => { status.textContent = state === "controlled" ? `Temporary design, not saved. Controlled by ${origin}` : `Temporary design, not saved. Channel closed (${state}).`; if (state !== "controlled") stop.disabled = true; } });
  stop.addEventListener("click", () => channel.close("stopped"));
  window.addEventListener("pagehide", () => channel.close("pagehide"));
  window.addEventListener("message", (event) => channel.receive(event));
  store.on((kind) => { if (kind === "load" && ids.size && !ids.has(store.doc.id)) channel.close("design-changed"); });
  app.projects.embedReady.then(() => {
    const doc = newDoc("Untitled", "beginner"); ids.add(doc.id); app.projects.embedNew(doc);
    channel.start();
  });
}
