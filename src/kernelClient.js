// Talks to the geometry worker; caches meshes by body key.
import { diskGet, diskPut, looseKey } from "./meshcache.js";
import { VERSION as UP_VERSION, BUILD } from "./version.js";
// jumpstart-3d: saved meshes belong to one community build (his VERSION stays the same across our builds, while our kernel changes)
const VERSION = UP_VERSION + "+" + BUILD;
// jumpstart-3d: a built mesh from a project file or the browser's saved meshes is used only when it has the shape the view draws
// (a hand-edited or foreign file must not break drawing, nor be saved for later visits); a huge one is not saved in the browser
const pairsIn = (g, max) => Array.isArray(g) && g.every((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] >= 0 && p[0] + p[1] <= max);
function meshOk(m) {
  if (!m || !(m.vertices instanceof Float32Array) || !(m.normals instanceof Float32Array) || !(m.triangles instanceof Uint32Array) || !(m.lines instanceof Float32Array)) return false;
  const nv = m.vertices.length / 3;
  if (!Number.isInteger(nv) || m.normals.length !== m.vertices.length || m.triangles.length % 3 || m.lines.length % 3) return false;
  for (let i = 0; i < m.triangles.length; i++) if (m.triangles[i] >= nv) return false;
  return pairsIn(m.faceGroups, m.triangles.length) && pairsIn(m.edgeGroups, m.lines.length / 3);
}
const DISK_MAX = 20 * 1048576;
const diskSize = (m) => ["vertices", "normals", "triangles", "lines"].reduce((n, k) => n + ((m && m[k] && m[k].byteLength) || 0), 0);
// bodies that took at least this long to build are remembered in the browser for next time
const DISK_MS = 1500;
// How much work a body is, in "curved tools" (about 20 s each): sweeps, lofts, revolves, pipes and
// coils in it, and offset faces on free-form surfaces (each one a slow boolean, ~20-30 s).
const curvedTools = (j) => (j.match(/"t":"(sweep|loft|revolve|pipe|coil)"/g) || []).length + 1.5 * (j.match(/"t":"(BSPLINE_SURFACE|BEZIER_SURFACE|REVOLUTION_SURFACE|OFFSET_SURFACE|OTHER_SURFACE)"/g) || []).length;
// a body expected to take several minutes builds in a second engine of its own, so the rest of
// the design appears (and can be worked on) while it builds
const VERY_SLOW = 15;
// a very slow body without its last heavy features: the earliest prefix that builds quickly
function standInNode(node) {
  if (!node || !Array.isArray(node.mods) || !node.mods.length) return null;
  let mods = node.mods.slice();
  while (mods.length) {
    mods = mods.slice(0, -1);
    const n = { ...node, mods };
    if (curvedTools(JSON.stringify(n)) < VERY_SLOW / 2) return n;
  }
  return null;
}
export class KernelClient {
  // jumpstart-3d: build stages have their own callback.
  constructor({ parts, workerUrl, workerType, onReady, onProgress, onBuildProgress, onResults, onFail }) {
    Object.assign(this, { parts, workerUrl, workerType, onReady, onProgress, onBuildProgress, onResults, onFail });
    this.meshes = new Map(); // key -> {ok, mesh|error}
    this.queue = new Map(); // key -> {id,key,node}
    this.inflight = null;
    this.ready = false;
    // jumpstart-3d: retain stall details after mesh-cache eviction.
    this.bad = new Map();
    this.solo = new Set(); // jumpstart-3d: keys of bodies a timed-out batch is retrying one at a time
    this.req = 0;
    this.stepWaiters = new Map();
    this.assets = new Map(); // imported files (STL/STEP), sent to the worker once
    this.probes = new Map(); // jumpstart-3d: Code CAD. key -> function that takes the answer for a one-off build
    this.stale = new Set(); // jumpstart-3d: extra fonts. keys built in flight before the fonts came in: the reply is dropped and the body built again
    this.looking = new Map(); // key -> item, being looked up in the browser's saved meshes
    this.buildMs = new Map(); // key -> how long the body took to build (to know the slow ones)
    this.disk = typeof indexedDB !== "undefined"; // jumpstart-3d: no saved meshes where there is no IndexedDB (Node tests drive this class)
    this.seeded = new Map(); // built shapes from an opened project file, by looseKey
    // one engine: used if the second engine can't start or runs out of memory (a browser tab on
    // a tablet or phone has less of it); very slow bodies then build in the main engine, after
    // their stand-in and after everything else, with no time limit
    this.oneEngine = false;
    // the second engine, for very slow bodies (started when one turns up)
    this.slow = { worker: null, ready: false, queue: new Map(), inflight: null, at: 0, watchdog: null };
  }
  hasAsset(id) { return this.assets.has(id); }
  addAsset(id, kind, bytes) {
    if (this.assets.has(id)) return;
    this.assets.set(id, { kind, bytes });
    if (this.ready) this.sendAsset(id);
    if (this.slow.ready) this.sendAsset(id, this.slow.worker);
  }
  // jumpstart-3d: Code CAD. forget a file nothing in the open design uses any more (the worker keeps an empty stand-in; an undo that needs it sends it again)
  dropAsset(id) {
    if (!this.assets.delete(id)) return;
    if (this.ready) this.worker.postMessage({ type: "dropasset", id });
    if (this.slow.worker && this.slow.ready) this.slow.worker.postMessage({ type: "dropasset", id }); // the second engine has the file too
  }
  // jumpstart-3d: Code CAD. builds one node in the design's own worker, outside the scene, and answers with its result (or a failure after ms)
  probe(item, ms = 120000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.probes.delete(item.key); this.queue.delete(item.key); resolve({ ok: false, error: "The geometry engine did not answer in time." }); }, ms);
      this.probes.set(item.key, (r) => { clearTimeout(timer); resolve(r); });
      this.request([{ ...item, pinned: true }]);
    });
  }
  settleProbes(results) {
    for (const r of results) {
      const done = this.probes.get(r.key);
      if (!done) continue;
      this.probes.delete(r.key);
      this.meshes.delete(r.key);
      done(r);
    }
  }
  sendAsset(id, worker = this.worker) {
    const a = this.assets.get(id);
    const copy = a.bytes.slice().buffer;
    worker.postMessage({ type: "asset", id, kind: a.kind, bytes: copy }, [copy]);
  }
  // ---- the second engine, for very slow bodies
  startSlow() {
    const L = this.slow;
    if (L.worker) return;
    L.ready = false;
    L.worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" });
    L.worker.onmessage = (ev) => this.handleSlow(ev.data);
    L.worker.onerror = () => this.slowFailed("The second engine stopped");
    L.worker.postMessage({ type: "init", parts: this.parts });
  }
  // the second engine failed (often memory on a tablet): carry on with one engine
  slowFailed(why) {
    const L = this.slow;
    clearTimeout(L.watchdog);
    try { if (L.worker) L.worker.terminate(); } catch (e) {}
    const items = [...(L.inflight || []), ...L.queue.values()];
    L.worker = null; L.ready = false; L.inflight = null; L.queue.clear();
    this.oneEngine = true;
    for (const it of items) { it.verySlow = true; this.queue.set(it.key, it); }
    this.onSlowFallback && this.onSlowFallback(why);
    this.pump();
  }
  handleSlow(msg) {
    const L = this.slow;
    if (msg.type === "error" && /memory|out of bounds|abort|RangeError/i.test(msg.error || "")) { this.slowFailed(msg.error); return; }
    if (msg.type === "ready") { L.ready = true; for (const id of this.assets.keys()) this.sendAsset(id, L.worker); this.pumpSlow(); }
    else if (msg.type === "built" || msg.type === "error") {
      clearTimeout(L.watchdog);
      const items = L.inflight || [];
      L.inflight = null;
      const res = msg.type === "built" ? msg.results.map((r) => { r.key = r.rev; delete r.rev; return r; }) : items.map((b) => ({ id: b.id, key: b.key, ok: false, error: msg.error }));
      for (const r of res) {
        if (this.dropStale(r.key, items)) continue; // jumpstart-3d: extra fonts
        if (r.ok && r.ms) this.buildMs.set(r.key, r.ms);
        if (r.ok && this.disk && r.ms >= DISK_MS && diskSize(r.mesh) <= DISK_MAX && !this.fontless(r.key)) diskPut(VERSION, r.key, r.mesh, r.ms);
        this.meshes.set(r.key, r);
      }
      this.trimMeshes(); // jumpstart-3d: STEP parts (#173)
      this.settleProbes(res); // jumpstart-3d: Code CAD
      this.onResults && this.onResults(res);
      this.pump(); // jumpstart-3d: extra fonts (a body put back in the main queue)
      this.pumpSlow();
      this.onBusy && this.onBusy(true);
    }
  }
  pumpSlow() {
    const L = this.slow;
    if (!L.queue.size) return;
    if (!L.worker) { this.startSlow(); return; }
    if (!L.ready || L.inflight) return;
    const [k, it] = L.queue.entries().next().value;
    L.queue.delete(k);
    L.inflight = [it]; L.at = Date.now();
    L.worker.postMessage({ type: "build", req: ++this.req, quality: this.quality || 1, bodies: [{ id: it.id, rev: it.key, node: it.node }] }); // jumpstart-3d: mesh detail
    // known to be slow, and it doesn't hold anything else up: no time limit (a slower computer
    // just takes longer), only a 2-hour safety net; Stop in the status bar ends it sooner
    L.watchdog = setTimeout(() => {
      try { L.worker.terminate(); } catch (e) {}
      L.worker = null; L.ready = false; L.inflight = null;
      const r = { id: it.id, key: it.key, ok: false, error: "This shape took too long and was stopped. Undo the last change, or make it lighter: fewer offset curved faces, or Clearance instead of Offset face (About → Slow bodies has tips)." };
      this.bad.set(it.key, r); // jumpstart-3d: bad is a Map of the stalled results
      this.meshes.set(it.key, r);
      this.settleProbes([r]); // jumpstart-3d: Code CAD
      this.onResults && this.onResults([r]);
      this.pumpSlow();
    }, 7200000);
    this.onBusy && this.onBusy(true);
  }
  // Stop in the status bar: end the slow body's build. It isn't marked as stalled, so opening the
  // design again (or changing the body) tries again.
  stopSlow() {
    const L = this.slow;
    // one engine (iPad): stop the very slow body it is building; the engine starts again
    if (this.oneEngine && this.inflight && this.inflight.some((it) => it.verySlow)) {
      clearTimeout(this.watchdog);
      try { this.worker.terminate(); } catch (e) {}
      const items = [...this.inflight, ...[...this.queue.values()].filter((it) => it.verySlow)];
      for (const it of items) this.queue.delete(it.key);
      this.inflight = null;
      const res = items.map((it) => ({ id: it.id, key: it.key, ok: false, stopped: true, error: "Stopped before it finished building. Open the design again to build it. About → Slow bodies has tips for making it quicker." }));
      for (const r of res) this.meshes.set(r.key, r);
      this.onResults && this.onResults(res);
      this.start();
      return;
    }
    if (!L.inflight && !L.queue.size) return;
    clearTimeout(L.watchdog);
    try { if (L.worker) L.worker.terminate(); } catch (e) {}
    const items = [...(L.inflight || []), ...L.queue.values()];
    L.worker = null; L.ready = false; L.inflight = null; L.queue.clear();
    const res = items.map((it) => ({ id: it.id, key: it.key, ok: false, stopped: true, error: "Stopped before it finished building. Open the design again to build it. About → Slow bodies has tips for making it quicker." }));
    // shown as stopped, but the next request builds it again (has() is false for these)
    for (const r of res) this.meshes.set(r.key, r);
    this.onResults && this.onResults(res);
    this.onBusy && this.onBusy(true);
  }
  start() {
    this.ready = false;
    const w = (this.worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" })); // jumpstart-3d: w
    this.worker.onmessage = (ev) => w === this.worker && this.handle(ev.data); // jumpstart-3d: ignore a late reply from a terminated worker
    this.worker.onerror = (e) => { this.onFail && this.onFail(e.message || "The geometry engine failed to start"); };
    this.worker.postMessage({ type: "init", parts: this.parts });
  }
  handle(msg) {
    // jumpstart-3d: build stages never satisfy readiness or touch the watchdog.
    if (msg.type === "progress") {
      if (msg.req !== undefined) {
        if (msg.req === this.inflightReq && this.inflight?.some(b => b.id === msg.id && b.key === msg.rev)) {
          this.lastBuildStage = msg.detail === "repairing" ? "repairing" : msg.stage;
          this.onBuildProgress?.(msg);
        }
      } else this.onProgress?.(msg);
    }
    else if (msg.type === "ready") { this.ready = true; for (const id of this.assets.keys()) this.sendAsset(id); this.onReady && this.onReady(); this.pump(); }
    else if (msg.type === "built") {
      // jumpstart-3d: late results cannot complete a newer batch.
      if (msg.req !== undefined && (msg.req !== this.inflightReq || !this.inflight)) return;
      clearTimeout(this.watchdog);
      clearTimeout(this.noteTimer); // jumpstart-3d: clear the long-build note when results arrive
      for (const r of msg.results) {
        this.solo.delete(r.rev); // jumpstart-3d
        r.key = r.rev;
        delete r.rev;
        if (this.dropStale(r.key)) continue; // jumpstart-3d: extra fonts
        if (r.ok && r.ms) this.buildMs.set(r.key, r.ms);
        if (r.ok && this.disk && r.ms >= DISK_MS && diskSize(r.mesh) <= DISK_MAX && !this.fontless(r.key)) diskPut(VERSION, r.key, r.mesh, r.ms);
        this.meshes.set(r.key, r);
        this.trimMeshes(); // jumpstart-3d: STEP parts (#173)
      }
      this.inflight = null;
      this.perf && this.perf.done(msg.results); // jumpstart-3d: perf panel
      this.settleProbes(msg.results); // jumpstart-3d: Code CAD
      this.onResults && this.onResults(msg.results);
      this.pump();
    } else if (msg.type === "step" || msg.type === "exportMesh" || msg.type === "contacts") {
      const w = this.stepWaiters.get(msg.req);
      this.stepWaiters.delete(msg.req);
      w && w.resolve(msg.type === "step" ? msg.data : msg.results);
    } else if (msg.type === "error") {
      const w = this.stepWaiters.get(msg.req);
      if (w) { this.stepWaiters.delete(msg.req); w.reject(new Error(msg.error)); return; }
      // jumpstart-3d: scoped errors must also belong to the current batch.
      if (msg.req !== undefined && this.ready && (msg.req !== this.inflightReq || !this.inflight)) return;
      if (!this.ready) { this.onFail && this.onFail(msg.error); return; }
      clearTimeout(this.watchdog);
      clearTimeout(this.noteTimer); // jumpstart-3d: clear the long-build note when results arrive
      const items = this.inflight || [];
      this.inflight = null;
      items.forEach((b) => this.solo.delete(b.key)); // jumpstart-3d
      const res = items.map((b) => ({ id: b.id, key: b.key, ok: false, error: msg.error }));
      res.forEach((r) => { if (!this.dropStale(r.key, items)) this.meshes.set(r.key, r); }); // jumpstart-3d: extra fonts
      this.perf && this.perf.done(res); // jumpstart-3d: perf panel
      this.settleProbes(res); // jumpstart-3d: Code CAD
      this.onResults && this.onResults(res);
      this.pump();
    }
  }
  // jumpstart-3d: extra fonts. A reply for a key marked stale is not kept; the body goes back in the queue (pumped after the reply).
  dropStale(key, items = this.inflight || []) {
    if (!this.stale.delete(key)) return false;
    const it = items.find((b) => b.key === key);
    if (it) this.queue.set(key, it);
    return true;
  }
  // jumpstart-3d: STEP parts (#173). Over 160 results, the oldest ones that no body of the open design needs go. A design of 200 bodies used to lose its first
  // 40 meshes to this and leave them unbuilt; now the cache grows only while all of it is needed, and shrinks back when a smaller design is shown.
  trimMeshes() {
    for (const k of this.meshes.keys()) {
      if (this.meshes.size <= 160) break;
      if (!(this.needed && this.needed.has(k)) && !(this.keepAlso && this.keepAlso.has(k))) this.meshes.delete(k); // keepAlso: the saved design's keys while a preview is open (app.js)
    }
  }
  has(key) { const r = this.meshes.get(key); return !!r && !r.stopped; }
  get(key) { return this.meshes.get(key); }
  fontless() { return false; } // jumpstart-3d: extra fonts. morefonts.js: true for a key whose text needs fonts not in yet (such a mesh is not saved in the browser)
  isPending(key) { return this.queue.has(key) || this.looking.has(key) || (this.inflight || []).some((b) => b.key === key) || this.slow.queue.has(key) || (this.slow.inflight || []).some((b) => b.key === key); }
  isLooking() { return this.looking.size > 0; }
  // the stand-in shown while a very slow body builds (an earlier step of it), if built
  standIn(key) { const r = this.meshes.get("pre:" + key); return r && r.ok && this.isPending(key) ? r : null; }
  // the second engine is building or has bodies waiting
  slowBusy() { return !!(this.slow.inflight || this.slow.queue.size); }
  // a very slow body is building (in either engine)
  slowNow() { return !!(this.slow.inflight || (this.inflight && this.inflight.some((it) => it.verySlow))); }
  request(items) {
    for (const it of items) {
      if (this.has(it.key) || this.isPending(it.key)) continue;
      if (this.bad.has(it.key)) {
        const r = { ...this.bad.get(it.key), id: it.id };
        this.meshes.set(it.key, r);
        continue;
      }
      // a built shape that came in the opened project file
      const sd = this.seeded.size && this.seeded.get(looseKey(it.key));
      if (sd) {
        const r = { id: it.id, key: it.key, ok: true, mesh: sd.mesh, fromFile: true };
        this.meshes.set(it.key, r); this.buildMs.set(it.key, sd.ms || 20000);
        if (this.disk) diskPut(VERSION, it.key, sd.mesh, sd.ms || 20000);
        this.settleProbes([r]); // jumpstart-3d: Code CAD
        this.onResults && this.onResults([r]);
        continue;
      }
      if (this.disk && !String(it.key).startsWith("feat:")) this.lookUp(it);
      else this.queue.set(it.key, it);
    }
    this.pump();
  }
  // a body built before (in an earlier visit) comes straight from the browser's saved meshes
  lookUp(it) {
    this.looking.set(it.key, it);
    diskGet(VERSION, it.key).then((hit) => {
      if (this.looking.get(it.key) !== it) return;
      this.looking.delete(it.key);
      const mesh = hit && meshOk(hit.mesh) ? hit.mesh : null; // jumpstart-3d: meshOk
      if (hit && hit.ms) this.buildMs.set(it.key, hit.ms);
      if (mesh && !this.meshes.has(it.key)) {
        const r = { id: it.id, key: it.key, ok: true, mesh, fromDisk: true };
        this.meshes.set(it.key, r);
        this.settleProbes([r]); // jumpstart-3d: Code CAD
        this.onResults && this.onResults([r]);
      } else if (!this.meshes.has(it.key)) this.queue.set(it.key, it);
      this.pump();
    }, () => { this.looking.delete(it.key); this.queue.set(it.key, it); this.pump(); });
  }
  // the built meshes of bodies that took at least minMs to build (to go in a project file)
  slowMeshes(keys, minMs = 10000) {
    const out = [];
    for (const k of keys) { const r = this.meshes.get(k); if (r && r.ok && (this.buildMs.get(k) || 0) >= minMs) out.push({ key: k, mesh: r.mesh, ms: this.buildMs.get(k) }); }
    return out;
  }
  // meshes that came in a project file: used instead of building those bodies again
  seed(list) {
    // matched by looseKey when bodies are requested: the file may come from another browser
    for (const it of list) if (it && typeof it.key === "string" && meshOk(it.mesh)) this.seeded.set(looseKey(it.key), { mesh: it.mesh, ms: it.ms });
  }
  // drop queued work nobody needs any more
  prune(neededKeys) {
    this.needed = neededKeys; // jumpstart-3d: stalled() skips timed-out bodies that a newer edit replaced
    // (a stand-in stays while the body it stands in for is still wanted)
    for (const k of [...this.queue.keys()]) if (!neededKeys.has(k) && !(k.startsWith("pre:") && neededKeys.has(k.slice(4))) && !this.queue.get(k).pinned) { this.queue.delete(k); this.solo.delete(k); } // jumpstart-3d: pinned (Code CAD) and solo
    for (const k of [...this.looking.keys()]) if (!neededKeys.has(k) && !this.looking.get(k).pinned) this.looking.delete(k); // jumpstart-3d: pinned
    for (const k of [...this.slow.queue.keys()]) if (!neededKeys.has(k) && !this.slow.queue.get(k).pinned) this.slow.queue.delete(k); // jumpstart-3d: pinned
    this.trimMeshes(); // jumpstart-3d: STEP parts (#173)
  }
  pump() {
    // jumpstart-3d: a body whose text uses an extra font waits in the queue until the fonts are in (morefonts.js); the others go on.
    // The wait always ends (loaded or not), and then the queue is pumped again.
    const held = (it) => {
      const w = this.waitFor && this.waitFor(it);
      if (w && !this.fontWait) this.fontWait = Promise.resolve(w).catch(() => {}).finally(() => { this.fontWait = null; this.pump(); });
      return !!w;
    };
    // very slow bodies go to the second engine; meanwhile the body as it was before its last
    // heavy features (quick to build) stands in for it, see-through
    for (const [k, it] of [...this.queue]) {
      if (it.verySlow || curvedTools(JSON.stringify(it.node)) >= VERY_SLOW) {
        if (it.verySlow) continue;
        if (held(it)) continue; // jumpstart-3d: extra fonts (the second engine never builds text before the fonts are in)
        const pre = standInNode(it.node), pk = "pre:" + k;
        const wantPre = pre && !this.meshes.has(pk) && !this.queue.has(pk);
        if (this.oneEngine) {
          // one engine: the stand-in first, then the body itself, last in the queue
          this.queue.delete(k);
          if (wantPre) this.queue.set(pk, { id: it.id, key: pk, node: pre });
          it.verySlow = true;
          this.queue.set(k, it);
          continue;
        }
        this.queue.delete(k); this.slow.queue.set(k, it);
        if (wantPre) this.queue.set(pk, { id: it.id, key: pk, node: pre });
      }
    }
    this.pumpSlow();
    if (!this.ready || this.inflight || !this.queue.size) return;
    // send small batches so the screen updates progressively
    // heavy parts (imported meshes, face patterns, 3D Sketch tubes along free curves) go one at a time, each with
    // its own time limit, so a few of them never add up past the limit together
    // curved tools (sweeps, lofts, revolves) cut or joined into a body: each boolean with such a
    // surface takes seconds, so a pattern of them gets time in proportion
    const heavy = (it) => { if (it.node && it.node.t === "group" && (it.node.children || []).length > 40) return true; const j = JSON.stringify(it.node); return j.includes('"asset"') || j.includes('"t":"facepat"') || j.includes('"t":"shell"') || j.includes('"logs":true') || (j.includes('"pipe"') && (j.includes('"bez"') || j.includes('"bsp"'))) || curvedTools(j) >= 3; }; // jumpstart-3d: a shell (hollow) goes alone with the long time limit: an oval capsule's Auto hollow takes 20-35 s
    const batch = [];
    // very slow bodies (one engine) wait until everything else has been built
    const order = [...this.queue].sort((a, b) => (a[1].verySlow ? 1 : 0) - (b[1].verySlow ? 1 : 0));
    for (const [k, it] of order) {
      if (held(it)) continue; // jumpstart-3d: extra fonts
      const alone = (b) => heavy(b) || this.solo.has(b.key); // jumpstart-3d: a retried body also goes alone
      if (batch.length && (alone(it) || alone(batch[0]))) break;
      batch.push(it); this.queue.delete(k);
      if (batch.length >= 4 || alone(it)) break;
    }
    if (!batch.length) { this.onBusy && this.onBusy(true); return; } // jumpstart-3d: extra fonts (everything queued is waiting for them; the status bar says so)
    this.inflight = batch;
    this.perf && this.perf.start(); // jumpstart-3d: perf panel
    // jumpstart-3d: identify the active batch separately from export requests.
    const req = this.inflightReq = ++this.req;
    this.lastBuildStage = "waiting";
    this.worker.postMessage({ type: "build", req, quality: this.quality || 1, bodies: batch.map((b) => ({ id: b.id, rev: b.key, node: b.node })) });
    // map results back by rev = key
    clearTimeout(this.watchdog);
    // imported meshes take longer to turn into solids: give them more time
    const slow = batch.some(heavy);
    const curved = Math.max(0, ...batch.map((it) => curvedTools(JSON.stringify(it.node))));
    // a very slow body in the one engine (iPad): no time limit, only a 2-hour safety net
    const limit = batch.some((it) => it.verySlow) ? 7200000 : Math.min(1200000, Math.max(slow ? 120000 : 25000, 25000 + curved * 20000)) * (this.quality || 1); // jumpstart-3d: finer mesh detail gets more time
    // jumpstart-3d: wording uses production time, even when tests shorten scheduling.
    this.buildLimitMs = limit;
    // jumpstart-3d: an STL/3MF/STEP export already with the worker runs first: its time does not count against this batch
    this.watchdog = setTimeout(() => this.stalled(batch), this.watchdogMs || limit + (this.stepWaiters.size ? 240000 : 0)); // jumpstart-3d: watchdogMs is a test-only override
    // jumpstart-3d: a long build gets its note in the status bar after 3 s
    this.inflightAt = Date.now(); clearTimeout(this.noteTimer); this.noteTimer = setTimeout(() => this.onBusy && this.onBusy(true), 3000);
    this.onBusy && this.onBusy(true);
  }
  stalled(batch) {
    this.perf && this.perf.abort(batch); // jumpstart-3d: perf panel
    // OpenCascade occasionally loops forever on extreme fillets; restart the worker.
    try { this.worker.terminate(); } catch (e) {}
    // jumpstart-3d: load. a restart drops the old worker's STEP jobs: say so instead of waiting forever
    for (const w of this.stepWaiters.values()) w.reject(new Error("the geometry engine restarted. Try the export again"));
    this.stepWaiters.clear();
    // jumpstart-3d: a slow device or busy runner can push a healthy batch of several bodies past the limit. Retry each body alone with its own full limit; only a body that stalls alone is marked bad.
    if (batch.length > 1) {
      const current = batch.filter((b) => !this.needed || this.needed.has(b.key)); // replaced bodies are dropped, not marked bad
      for (const b of current) this.solo.add(b.key);
      this.queue = new Map([...current.map((b) => [b.key, b]), ...this.queue]);
      this.inflight = null;
      this.start();
      return;
    }
    this.solo.delete(batch[0].key);
    const res = batch.map((b) => {
      // jumpstart-3d: import UI reports the actual production deadline and last stage.
      return { id: b.id, key: b.key, ok: false, error: "This shape stalled the geometry engine. Undo the last change or adjust its values.", limitMs: this.buildLimitMs, stage: this.lastBuildStage };
    });
    res.forEach((r) => {
      this.bad.set(r.key, r);
      this.meshes.set(r.key, r);
    });
    this.inflight = null;
    this.settleProbes(res); // jumpstart-3d: Code CAD
    this.onResults && this.onResults(res);
    this.start();
  }
  // STL / 3MF: fine meshes of the exact shapes (level: standard, fine, extra)
  exportMesh(bodies, level) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.stepWaiters.set(req, { resolve, reject });
      this.worker.postMessage({ type: "exportMesh", req, level, bodies });
    });
  }
  // Clearance: which bodies touch, overlap or are closer than gap ({ pairs, vols })
  contacts(bodies, gap) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.stepWaiters.set(req, { resolve, reject });
      this.worker.postMessage({ type: "contacts", req, gap, bodies });
    });
  }
  step(bodies) {
    const w = this.waitFor && bodies.map((b) => this.waitFor(b)).find(Boolean); // jumpstart-3d: extra fonts (a STEP export of text in one)
    if (w) return Promise.resolve(w).catch(() => {}).then(() => this.step(bodies));
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.stepWaiters.set(req, { resolve, reject });
      this.worker.postMessage({ type: "step", req, bodies });
    });
  }
}
