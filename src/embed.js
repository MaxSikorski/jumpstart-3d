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
  const seen = new Set();
  function visit(v, depth) {
    if (depth > 32) throw Error("arguments are too deep");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object") throw Error("invalid arguments");
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw Error("invalid arguments");
    if (seen.has(v)) throw Error("invalid arguments");
    seen.add(v);
    for (const key of Object.keys(v)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("invalid argument key");
      visit(v[key], depth + 1);
    }
    seen.delete(v);
  }
  visit(args, 0);
  if (new TextEncoder().encode(JSON.stringify(args)).length > MAX_ARGS) throw Error("arguments are too big");
}

export function createChannel({ api, allow, parent, post, now = Date.now, onState = () => {} }) {
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
        let result = await calls[call](...args);
        if (!open) break;
        if (result === undefined) result = null;
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

export function startEmbed(app, api) {
  const allow = parseAllow(new URLSearchParams(location.search).get("embed"), location.origin);
  const ids = new Set();
  app.embed = { isScratch: (id) => ids.has(id) };
  const bar = document.createElement("div"), status = document.createElement("span"), stop = document.createElement("button"), link = document.createElement("a");
  bar.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:10000;padding:8px 10px;background:#fff;color:#111;border:1px solid #555;border-radius:6px;box-shadow:0 2px 8px #0005;font:14px sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
  status.setAttribute("aria-live", "polite");
  status.textContent = allow.length ? "Temporary design, not saved. Waiting for the website." : "Temporary design, not saved. The website did not give a valid address to allow.";
  stop.textContent = "Stop"; link.textContent = "Open the full app";
  link.href = location.origin + location.pathname; link.target = "_blank"; link.rel = "noopener noreferrer";
  bar.append(status, stop, link); document.body.append(bar);
  const channel = createChannel({ api: { ...api, newDesign: (mode = "beginner") => { const doc = newDoc("Untitled", mode); ids.add(doc.id); app.projects.embedNew(doc); return api.ready(); } }, allow, parent: window.parent, post: (msg, origin) => window.parent.postMessage(msg, origin), onState: (state, origin) => { status.textContent = state === "controlled" ? `Temporary design, not saved. Controlled by ${origin}` : `Temporary design, not saved. Channel closed (${state}).`; if (state !== "controlled") stop.disabled = true; } });
  stop.addEventListener("click", () => channel.close("stopped"));
  window.addEventListener("message", (event) => channel.receive(event));
  store.on((kind) => { if (kind === "load" && ids.size && !ids.has(store.doc.id)) channel.close("design-changed"); });
  app.projects.embedReady.then(() => {
    const doc = newDoc("Untitled", "beginner"); ids.add(doc.id); app.projects.embedNew(doc);
    app.setMode("beginner"); channel.start();
  });
}
