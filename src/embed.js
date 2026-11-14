// A temporary design controlled by an explicitly allowed parent website.
import { store, newDoc } from "./store.js";
import { setUnit } from "./units.js";
import { embedActive } from "./embedmode.js";
export { embedActive } from "./embedmode.js";

export const EMBED_CALLS = Object.freeze("supports describe ready kinds list get doc save params mode selection add fastener holePattern gear namePlate knurl spring remove delete duplicate move moveTo rotate resize scale setHole setColor rename setHidden group ungroup setParam removeParam bind undo redo select fit setMode screenshot screenshotDataURL export newDesign sketch extrude revolve fillet chamfer shell hole pattern faces edges inspect measure printCheck collisions section boxMaker gearSet hardware textures texture drawing checkpoint checkpoints diff rollback".split(" "));
export const REFUSED = Object.freeze("run codeCad load invoke connect disconnect connection".split(" "));
const READ_CALLS = new Set("kinds list get doc save params mode selection ready supports describe textures checkpoints faces edges inspect measure printCheck collisions section screenshot screenshotDataURL export drawing diff".split(" "));
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

export function createChannel({ api, allow, parent, post, now = Date.now, onState = () => {}, onCall = () => () => {}, setTimer = setTimeout, clearTimer = clearTimeout, isChisel = () => false }) {
  const calls = Object.fromEntries(EMBED_CALLS.filter((n) => typeof api[n] === "function").map((n) => [n, api[n].bind(api)]));
  const ready = { type: "js3d-ready", protocol: 1, apiVersion: api.apiVersion ?? api.version, calls: Object.keys(calls) };
  let open = true, started = false, lastId = 0, lastHello = -Infinity, running = false;
  let times = [], queue = [], activeOrigin = null, endActive = null, activeTimer = null;
  const send = (msg, origin) => { if (open) post(msg, origin); };
  const fail = (id, error, origin) => send({ type: "js3d-result", protocol: 1, id, error }, origin);
  function close(reason) {
    if (!open) return;
    open = false; queue = [];
    if (endActive) { endActive(); endActive = null; }
    if (activeTimer !== null) { clearTimer(activeTimer); activeTimer = null; }
    for (const origin of allow) post({ type: "js3d-closed", protocol: 1, reason }, origin);
    onState(reason);
  }
  async function drain() {
    if (running || !open) return;
    running = true;
    while (queue.length && open) {
      const { id, call, args, origin } = queue.shift();
      try {
        if (isChisel() && !READ_CALLS.has(call)) throw Error("the person is using Chisel in this frame; try again after they leave it");
        const endCall = onCall();
        endActive = endCall;
        let work;
        try { work = Promise.resolve(calls[call](...args)).finally(() => { if (endActive === endCall) { endCall(); endActive = null; } }); work.catch(() => {}); }
        catch (e) { endCall(); endActive = null; throw e; }
        let timer;
        const deadline = new Promise((_, reject) => { activeTimer = timer = setTimer(() => reject(Error("the call took longer than 10 minutes; reload the page to start again")), 600000); });
        let result;
        try { result = await Promise.race([work, deadline]); }
        catch (e) { if (e.message === "the call took longer than 10 minutes; reload the page to start again") { fail(id, e.message, origin); close("timeout"); break; } throw e; }
        finally { if (activeTimer === timer) { clearTimer(timer); activeTimer = null; } }
        if (!open) break;
        if (result === undefined) result = null;
        let size;
        if (result instanceof Uint8Array) size = result.byteLength;
        else {
          const json = JSON.stringify(result);
          if (json.length > MAX_RESULT) throw Error("the result is too big to send");
          size = new TextEncoder().encode(json).length;
        }
        if (size > MAX_RESULT) throw Error("the result is too big to send");
        if (result instanceof Uint8Array) result = result.slice();
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
    if (!Object.hasOwn(calls, call)) { fail(id, EMBED_CALLS.includes(call) ? "unknown call" : "this call is not available to embedding websites", event.origin); return; }
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

export function storageOverlay() {
  const values = new Map();
  const methods = {
    key(i) { return [...values.keys()][i] ?? null; },
    getItem(k) { return values.get(String(k)) ?? null; },
    setItem(k, v) { values.set(String(k), String(v)); },
    removeItem(k) { values.delete(String(k)); },
    clear() { values.clear(); },
  };
  return new Proxy({}, {
    get(_, key) { if (key === "length") return values.size; if (Object.hasOwn(methods, key)) return methods[key]; return values.get(key); },
    set(_, key, value) { values.set(String(key), String(value)); return true; },
    deleteProperty(_, key) { values.delete(key); return true; },
    has(_, key) { return values.has(key) || key === "length" || Object.hasOwn(methods, key); },
    ownKeys() { return [...values.keys()]; },
    getOwnPropertyDescriptor(_, key) { if (values.has(key)) return { configurable: true, enumerable: true, writable: true, value: values.get(key) }; },
  });
}

export function installIsolation(target) {
  try {
    for (const name of ["localStorage", "sessionStorage"]) {
      const storage = storageOverlay();
      Object.defineProperty(target, name, { configurable: true, get: () => storage });
    }
    Object.defineProperty(target, "indexedDB", { configurable: true, get: () => undefined });
    return true;
  } catch { return false; }
}

if (embedActive() && !installIsolation(window)) {
  const message = document.createElement("p"), link = document.createElement("a");
  message.textContent = "This page was opened inside another website, but this browser would not give it a private workspace. Open JumpStart 3D in its own tab.";
  link.href = location.origin + location.pathname; link.textContent = "Open JumpStart 3D";
  document.body.replaceChildren(message, link);
  throw new Error("Could not create the temporary workspace.");
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
  setUnit("mm");
  const allow = parseAllow(new URLSearchParams(location.search).get("embed"), location.origin);
  const ids = new Set();
  const onCall = guardUpdates(store, (id) => ids.has(id));
  app.embed = { isScratch: (id) => ids.has(id) };
  const bar = document.createElement("div"), status = document.createElement("span"), stop = document.createElement("button"), link = document.createElement("a");
  bar.style.cssText = "position:fixed;bottom:36px;left:8px;z-index:10000;padding:8px 10px;background:#fff;color:#111;border:1px solid #555;border-radius:6px;box-shadow:0 2px 8px #0005;font:14px sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
  status.setAttribute("aria-live", "polite");
  status.textContent = allow.length ? "Temporary design, not saved. Waiting for the website." : "Temporary design, not saved. The website did not give a valid address to allow.";
  stop.textContent = "Stop"; link.textContent = "Open the full app";
  link.href = location.origin + location.pathname; link.target = "_blank"; link.rel = "noopener noreferrer";
  bar.append(status, stop, link); document.body.append(bar);
  const position = () => {
    let top = window.innerHeight;
    for (const el of document.querySelectorAll(".status, .timeline")) {
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.height && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none") top = Math.min(top, rect.top);
    }
    const bottom = Math.max(8, window.innerHeight - top + 4) + "px";
    if (bar.style.bottom !== bottom) bar.style.bottom = bottom;
  };
  let queued = false; // the app changes the page often: measure at most once a frame
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; position(); }); } };
  position();
  window.addEventListener("resize", later);
  new MutationObserver(later).observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "hidden", "style"] });
  store.on(() => requestAnimationFrame(position));
  const channel = createChannel({ isChisel: () => app.mode === "chisel", api: { ...api, newDesign: (mode = "beginner") => { const doc = newDoc("Untitled", mode); ids.add(doc.id); app.projects.embedNew(doc); return api.ready(); } }, allow, onCall, parent: window.parent, post: (msg, origin) => window.parent.postMessage(msg, origin), onState: (state, origin) => { status.textContent = state === "controlled" ? `Temporary design, not saved. Controlled by ${origin}` : `Temporary design, not saved. Channel closed (${state}).`; if (state !== "controlled") stop.disabled = true; } });
  stop.addEventListener("click", () => channel.close("stopped"));
  window.addEventListener("pagehide", () => channel.close("pagehide"));
  window.addEventListener("message", (event) => channel.receive(event));
  store.on((kind) => { if (kind === "load" && ids.size && !ids.has(store.doc.id)) channel.close("design-changed"); });
  app.projects.embedReady.then(() => {
    const doc = newDoc("Untitled", "beginner"); ids.add(doc.id); app.projects.embedNew(doc);
    channel.start();
  });
}
