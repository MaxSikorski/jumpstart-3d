// Talks to the geometry worker; caches meshes by body key.
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
  }
  hasAsset(id) { return this.assets.has(id); }
  addAsset(id, kind, bytes) {
    if (this.assets.has(id)) return;
    this.assets.set(id, { kind, bytes });
    if (this.ready) this.sendAsset(id);
  }
  // jumpstart-3d: Code CAD. forget a file nothing in the open design uses any more (the worker keeps an empty stand-in; an undo that needs it sends it again)
  dropAsset(id) {
    if (!this.assets.delete(id)) return;
    if (this.ready) this.worker.postMessage({ type: "dropasset", id });
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
  sendAsset(id) {
    const a = this.assets.get(id);
    const copy = a.bytes.slice().buffer;
    this.worker.postMessage({ type: "asset", id, kind: a.kind, bytes: copy }, [copy]);
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
        this.meshes.set(r.key, r);
        this.trimMeshes(); // jumpstart-3d: STEP parts (#173)
      }
      this.inflight = null;
      this.perf && this.perf.done(msg.results); // jumpstart-3d: perf panel
      this.settleProbes(msg.results); // jumpstart-3d: Code CAD
      this.onResults && this.onResults(msg.results);
      this.pump();
    } else if (msg.type === "step") {
      const w = this.stepWaiters.get(msg.req);
      this.stepWaiters.delete(msg.req);
      w && w.resolve(msg.data);
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
      res.forEach((r) => this.meshes.set(r.key, r));
      this.perf && this.perf.done(res); // jumpstart-3d: perf panel
      this.settleProbes(res); // jumpstart-3d: Code CAD
      this.onResults && this.onResults(res);
      this.pump();
    }
  }
  // jumpstart-3d: STEP parts (#173). Over 160 results, the oldest ones that no body of the open design needs go. A design of 200 bodies used to lose its first
  // 40 meshes to this and leave them unbuilt; now the cache grows only while all of it is needed, and shrinks back when a smaller design is shown.
  trimMeshes() {
    for (const k of this.meshes.keys()) {
      if (this.meshes.size <= 160) break;
      if (!(this.needed && this.needed.has(k)) && !(this.keepAlso && this.keepAlso.has(k))) this.meshes.delete(k); // keepAlso: the saved design's keys while a preview is open (app.js)
    }
  }
  has(key) { return this.meshes.has(key); }
  get(key) { return this.meshes.get(key); }
  isPending(key) { return this.queue.has(key) || (this.inflight || []).some((b) => b.key === key); }
  request(items) {
    for (const it of items) {
      if (this.meshes.has(it.key) || this.isPending(it.key)) continue;
      if (this.bad.has(it.key)) {
        const r = { ...this.bad.get(it.key), id: it.id };
        this.meshes.set(it.key, r);
        continue;
      }
      this.queue.set(it.key, it);
    }
    this.pump();
  }
  // drop queued work nobody needs any more
  prune(neededKeys) {
    this.needed = neededKeys; // jumpstart-3d: stalled() skips timed-out bodies that a newer edit replaced
    for (const k of [...this.queue.keys()]) if (!neededKeys.has(k) && !this.queue.get(k).pinned) { this.queue.delete(k); this.solo.delete(k); }
    this.trimMeshes(); // jumpstart-3d: STEP parts (#173)
  }
  pump() {
    if (!this.ready || this.inflight || !this.queue.size) return;
    // send small batches so the screen updates progressively
    // heavy parts (imported meshes, face patterns, 3D Sketch tubes along free curves) go one at a time, each with
    // its own time limit, so a few of them never add up past the limit together
    const heavy = (it) => { if (it.node && it.node.t === "group" && (it.node.children || []).length > 40) return true; const j = JSON.stringify(it.node); return j.includes('"asset"') || j.includes('"t":"facepat"') || j.includes('"t":"shell"') || j.includes('"logs":true') || (j.includes('"pipe"') && (j.includes('"bez"') || j.includes('"bsp"'))); }; // jumpstart-3d: a shell (hollow) goes alone with the long time limit: an oval capsule's Auto hollow takes 20-35 s
    const batch = [];
    for (const [k, it] of this.queue) {
      const alone = (b) => heavy(b) || this.solo.has(b.key); // jumpstart-3d: a retried body also goes alone
      if (batch.length && (alone(it) || alone(batch[0]))) break;
      batch.push(it); this.queue.delete(k);
      if (batch.length >= 4 || alone(it)) break;
    }
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
    // jumpstart-3d: wording uses production time, even when tests shorten scheduling.
    this.buildLimitMs = (slow ? 120000 : 25000) * (this.quality || 1);
    this.watchdog = setTimeout(() => this.stalled(batch), this.watchdogMs || (slow ? 120000 : 25000) * (this.quality || 1)); // jumpstart-3d: watchdogMs is a test-only override
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
  step(bodies) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.stepWaiters.set(req, { resolve, reject });
      this.worker.postMessage({ type: "step", req, bodies });
    });
  }
}
