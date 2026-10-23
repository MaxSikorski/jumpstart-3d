// Talks to the geometry worker; caches meshes by body key.
export class KernelClient {
  constructor({ parts, workerUrl, workerType, onReady, onProgress, onResults, onFail }) {
    Object.assign(this, { parts, workerUrl, workerType, onReady, onProgress, onResults, onFail });
    this.meshes = new Map(); // key -> {ok, mesh|error}
    this.queue = new Map(); // key -> {id,key,node}
    this.inflight = null;
    this.ready = false;
    this.bad = new Set();
    this.solo = new Set(); // jumpstart-3d: keys of bodies a timed-out batch is retrying one at a time
    this.req = 0;
    this.stepWaiters = new Map();
    this.assets = new Map(); // imported files (STL/STEP), sent to the worker once
  }
  hasAsset(id) { return this.assets.has(id); }
  addAsset(id, kind, bytes) {
    if (this.assets.has(id)) return;
    this.assets.set(id, { kind, bytes });
    if (this.ready) this.sendAsset(id);
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
    if (msg.type === "progress") this.onProgress && this.onProgress(msg);
    else if (msg.type === "ready") { this.ready = true; for (const id of this.assets.keys()) this.sendAsset(id); this.onReady && this.onReady(); this.pump(); }
    else if (msg.type === "built") {
      clearTimeout(this.watchdog);
      for (const r of msg.results) {
        this.solo.delete(r.rev); // jumpstart-3d
        r.key = r.rev;
        delete r.rev;
        this.meshes.set(r.key, r);
        if (this.meshes.size > 160) this.meshes.delete(this.meshes.keys().next().value);
      }
      this.inflight = null;
      this.onResults && this.onResults(msg.results);
      this.pump();
    } else if (msg.type === "step") {
      const w = this.stepWaiters.get(msg.req);
      this.stepWaiters.delete(msg.req);
      w && w.resolve(msg.data);
    } else if (msg.type === "error") {
      const w = this.stepWaiters.get(msg.req);
      if (w) { this.stepWaiters.delete(msg.req); w.reject(new Error(msg.error)); return; }
      if (!this.ready) { this.onFail && this.onFail(msg.error); return; }
      clearTimeout(this.watchdog);
      const items = this.inflight || [];
      this.inflight = null;
      items.forEach((b) => this.solo.delete(b.key)); // jumpstart-3d
      const res = items.map((b) => ({ id: b.id, key: b.key, ok: false, error: msg.error }));
      res.forEach((r) => this.meshes.set(r.key, r));
      this.onResults && this.onResults(res);
      this.pump();
    }
  }
  has(key) { return this.meshes.has(key); }
  get(key) { return this.meshes.get(key); }
  isPending(key) { return this.queue.has(key) || (this.inflight || []).some((b) => b.key === key); }
  request(items) {
    for (const it of items) {
      if (this.meshes.has(it.key) || this.isPending(it.key)) continue;
      if (this.bad.has(it.key)) {
        const r = { id: it.id, key: it.key, ok: false, error: "This shape stalled the geometry engine. Undo the last change or adjust its values." };
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
    for (const k of [...this.queue.keys()]) if (!neededKeys.has(k)) { this.queue.delete(k); this.solo.delete(k); }
  }
  pump() {
    if (!this.ready || this.inflight || !this.queue.size) return;
    // send small batches so the screen updates progressively
    // heavy parts (imported meshes, 3D Sketch tubes along free curves) go one at a time, each with
    // its own time limit, so a few of them never add up past the limit together
    const heavy = (it) => { const j = JSON.stringify(it.node); return j.includes('"asset"') || (j.includes('"pipe"') && (j.includes('"bez"') || j.includes('"bsp"'))); };
    const batch = [];
    for (const [k, it] of this.queue) {
      const alone = (b) => heavy(b) || this.solo.has(b.key); // jumpstart-3d: a retried body also goes alone
      if (batch.length && (alone(it) || alone(batch[0]))) break;
      batch.push(it); this.queue.delete(k);
      if (batch.length >= 4 || alone(it)) break;
    }
    this.inflight = batch;
    const req = ++this.req;
    this.worker.postMessage({ type: "build", req, quality: this.quality || 1, bodies: batch.map((b) => ({ id: b.id, rev: b.key, node: b.node })) });
    // map results back by rev = key
    clearTimeout(this.watchdog);
    // imported meshes take longer to turn into solids: give them more time
    const slow = batch.some(heavy);
    this.watchdog = setTimeout(() => this.stalled(batch), this.watchdogMs || (slow ? 120000 : 25000) * (this.quality || 1)); // jumpstart-3d: watchdogMs is a test-only override
    this.onBusy && this.onBusy(true);
  }
  stalled(batch) {
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
      this.bad.add(b.key);
      return { id: b.id, key: b.key, ok: false, error: "This shape stalled the geometry engine. Undo the last change or adjust its values." };
    });
    res.forEach((r) => this.meshes.set(r.key, r));
    this.inflight = null;
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
