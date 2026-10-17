// Talks to the geometry worker; caches meshes by body key.
export class KernelClient {
  constructor({ parts, workerUrl, workerType, onReady, onProgress, onResults, onFail }) {
    Object.assign(this, { parts, workerUrl, workerType, onReady, onProgress, onResults, onFail });
    this.meshes = new Map(); // key -> {ok, mesh|error}
    this.queue = new Map(); // key -> {id,key,node}
    this.inflight = null;
    this.ready = false;
    this.bad = new Set();
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
    this.worker = new Worker(this.workerUrl, this.workerType === "classic" ? {} : { type: "module" });
    this.worker.onmessage = (ev) => this.handle(ev.data);
    this.worker.onerror = (e) => { this.onFail && this.onFail(e.message || "The geometry engine failed to start"); };
    this.worker.postMessage({ type: "init", parts: this.parts });
  }
  handle(msg) {
    if (msg.type === "progress") this.onProgress && this.onProgress(msg);
    else if (msg.type === "ready") { this.ready = true; for (const id of this.assets.keys()) this.sendAsset(id); this.onReady && this.onReady(); this.pump(); }
    else if (msg.type === "built") {
      clearTimeout(this.watchdog);
      for (const r of msg.results) {
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
    for (const k of [...this.queue.keys()]) if (!neededKeys.has(k)) this.queue.delete(k);
  }
  pump() {
    if (!this.ready || this.inflight || !this.queue.size) return;
    // send small batches so the screen updates progressively
    const batch = [];
    for (const [k, it] of this.queue) { batch.push(it); this.queue.delete(k); if (batch.length >= 4) break; }
    this.inflight = batch;
    const req = ++this.req;
    this.worker.postMessage({ type: "build", req, quality: this.quality || 1, bodies: batch.map((b) => ({ id: b.id, rev: b.key, node: b.node })) });
    // map results back by rev = key
    clearTimeout(this.watchdog);
    // imported meshes take longer to turn into solids: give them more time
    const slow = batch.some((b) => JSON.stringify(b.node).includes('"asset"'));
    this.watchdog = setTimeout(() => this.stalled(batch), (slow ? 120000 : 25000) * (this.quality || 1));
    this.onBusy && this.onBusy(true);
  }
  stalled(batch) {
    // OpenCascade occasionally loops forever on extreme fillets; restart the worker.
    try { this.worker.terminate(); } catch (e) {}
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
