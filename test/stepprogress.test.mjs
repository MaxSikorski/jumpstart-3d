import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelClient } from "../src/kernelClient.js";
import { initStepProgress, stageName, stageText, formatLimit, stepStallMessage, currentImportView } from "../src/stepprogress.js";
import { beginStepBuild, stepStage } from "../src/stepload.js";
function timers(fn) {
  const saved = { setTimeout, clearTimeout, setInterval, clearInterval };
  let serial = 0;
  const tasks = new Map();
  globalThis.setTimeout = globalThis.setInterval = (cb, ms) => {
    const id = ++serial;
    tasks.set(id, { cb, ms });
    return id;
  };
  globalThis.clearTimeout = globalThis.clearInterval = id => tasks.delete(id);
  try {
    return fn(tasks);
  } finally {
    Object.assign(globalThis, saved);
  }
}
function client() {
  const events = [], loads = [], results = [];
  const k = new KernelClient({ onBuildProgress: e => events.push(e), onProgress: e => loads.push(e), onResults: r => results.push(r) });
  k.worker = { postMessage() {
    }, terminate() {
    } };
  k.ready = true;
  return { k, events, loads, results };
}
test("engine progress and scoped stages are separate; stale responses do not change deadlines", () => timers(tasks => {
  const { k, events, loads, results } = client();
  k.request([{ id: "b", key: "r", node: { t: "step", asset: "a" } }]);
  const req = k.inflightReq, watchdog = k.watchdog, note = k.noteTimer;
  const deadline = tasks.get(watchdog);
  k.handle({ type: "progress", phase: "compile" });
  assert.equal(loads.length, 1);
  for (const patch of [{ req: req - 1 }, { id: "other" }, { rev: "old" }])
    k.handle({ type: "progress", req, id: "b", rev: "r", stage: "building", ...patch });
  assert.equal(events.length, 0);
  k.handle({ type: "progress", req, id: "b", rev: "r", stage: "building", ms: 100 });
  assert.equal(events.length, 1);
  assert.equal(k.watchdog, watchdog);
  assert.equal(k.noteTimer, note);
  assert.equal(tasks.get(watchdog), deadline);
  assert(k.inflight);
  assert(k.ready);
  k.handle({ type: "built", req: req - 1, results: [] });
  k.handle({ type: "error", req: req - 1, error: "stale" });
  assert(k.inflight);
  assert.equal(results.length, 0);
  k.handle({ type: "built", req, results: [{ id: "b", rev: "r", ok: true, mesh: {} }] });
  assert.equal(k.inflight, null);
  assert.equal(results.length, 1);
  assert(!tasks.has(watchdog));
  k.handle({ type: "built", req, results: [] });
  assert.equal(results.length, 1);
}));
test("watchdog override does not change production limit; restart rejects exports", () => timers(tasks => {
  for (const [q, limit] of [[1, 120000], [2, 240000], [4, 480000], [1.25, 150000]]) {
    const { k, results } = client();
    k.quality = q;
    k.watchdogMs = 1;
    k.start = () => {
      k.ready = false;
    };
    let rejected = false;
    k.stepWaiters.set(99, { reject: () => {
        rejected = true;
      } });
    k.request([{ id: "b", key: "r", node: { t: "step", asset: "a" } }]);
    assert.equal(tasks.get(k.watchdog).ms, 1);
    k.handle({ type: "progress", req: k.inflightReq, id: "b", rev: "r", stage: "meshing" });
    tasks.get(k.watchdog).cb();
    assert(rejected);
    assert.equal(k.stepWaiters.size, 0);
    assert.equal(results[0][0].limitMs, limit);
    assert.equal(results[0][0].stage, "meshing");
    assert.equal(k.ready, false);
    k.meshes.clear();
    k.request([{ id: "again", key: "r", node: { t: "step", asset: "a" } }]);
    const repeated = k.get("r");
    assert.deepEqual(repeated, { ...results[0][0], id: "again" });
    assert.equal(repeated.limitMs, limit);
    assert.equal(repeated.stage, "meshing");
    const duration = new Map([[120000, "2 minutes"], [240000, "4 minutes"], [480000, "8 minutes"], [150000, "150 seconds"]]).get(limit);
    assert.equal(stepStallMessage("Again.step", repeated, "waiting"), `Couldn't import Again.step: building it took longer than ${duration}, so it was stopped. Last stage: Making the mesh.`);
  }
  assert.equal(stageName("repairing"), "Repairing the solid");
  assert.equal(stageName("waiting"), "Waiting for the geometry engine");
  assert.equal(stageName("meshing"), "Making the mesh");
  assert.equal(formatLimit(120000), "2 minutes");
  assert.equal(formatLimit(240000), "4 minutes");
  assert.equal(formatLimit(480000), "8 minutes");
  assert.equal(formatLimit(150000), "150 seconds");
}));
test("synchronous body context is scoped, monotonic, and cleared on exceptions", () => {
  const out = [];
  const end = beginStepBuild({ id: "one", rev: "r", node: { asset: "a" } }, e => out.push(e));
  try {
    stepStage("reading");
    stepStage("building", "repairing");
    throw Error("injected");
  } catch {
  } finally {
    end();
  }
  stepStage("meshing");
  assert.equal(out.length, 2);
  assert(out[1].ms >= out[0].ms);
  assert(out.every(e => e.id === "one"));
  const end2 = beginStepBuild({ id: "two", rev: "s", node: { asset: "b" } }, e => out.push(e));
  try {
    stepStage("meshing");
  } finally {
    end2();
  }
  assert.equal(out[2].id, "two");
});
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.textContent = "";
    this.hidden = false;
    this.style = {};
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 800 };
  }
  append(...children) {
    for (const c of children) {
      c.parent = this;
      c.parentElement = this;
      this.children.push(c);
    }
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  remove() {
    this.parent.children = this.parent.children.filter(x => x !== this);
  }
}
test("panel stages, elapsed timer, parts handoff and cleanup; retained meshes cannot complete imports", () => timers(tasks => {
  const old = globalThis.document;
  const viewport = new Element("div"), head = new Element("head");
  globalThis.document = { querySelectorAll: () => [{ getBoundingClientRect: () => ({ top: 740, bottom: 800, width: 400, height: 60 }) }], head, createElement: t => new Element(t), getElementById: () => viewport };
  try {
    const app = { kernel: { quality: 2, inflight: [{ id: "a" }], get: () => ({ ok: true }) }, scene: { views: new Map() }, status() {
      } };
    const p = initStepProgress(app);
    assert(viewport.children[0].hidden);
    const s = p.start("<long & unsafe>.step");
    assert.equal(viewport.children[0].style.bottom, "72px");
    assert.equal(s.row.attrs["aria-busy"], "true");
    assert.equal(s.bar.attrs["aria-label"], "STEP import stages");
    let checks = 0;
    p.attach(s, ["a"], "asset", () => checks++);
    assert.equal(checks, 1);
    assert(p.represented());
    p.progress({ id: "wrong", asset: "asset", stage: "sending" });
    assert.equal(s.stage, "waiting");
    for (const [i, stage] of ["reading", "building", "meshing", "sending"].entries()) {
      p.progress({ id: "a", asset: "asset", stage });
      assert.equal(s.bar.value, i);
      assert.equal(s.bar.max, 4);
    }
    s.start -= 2200;
    tasks.get(s.tick).cb();
    assert.match(s.elapsed.textContent, /2 s$/);
    assert.equal(s.bar.value, 3);
    assert.equal(s.label.textContent, "Showing the model\u2026 \u00B7 <long & unsafe>.step");
    p.parts(s, ["a", "b", "c"]);
    s.ready = 1;
    tasks.get(s.tick).cb();
    assert.equal(s.bar.max, 3);
    assert.equal(s.bar.value, 1);
    assert.equal(s.count.textContent, "1 of 3 parts ready");
    p.progress({ id: "b", asset: "asset", stage: "reading" });
    assert.equal(s.stage, "parts");
    p.reconcile();
    assert.equal(checks, 2);
    app.scene.views.set("a", { data: {}, key: "old", pending: false });
    assert.equal(currentImportView(app, { id: "a", _key: "new" }), null);
    app.scene.views.set("a", { data: {}, key: "new", pending: true });
    assert.equal(currentImportView(app, { id: "a", _key: "new" }), null);
    app.scene.views.get("a").pending = false;
    assert(currentImportView(app, { id: "a", _key: "new" }));
    p.clear();
    assert.equal(tasks.size, 0);
    assert.equal(p.sessions.size, 0);
    assert(viewport.children[0].hidden);
    assert.equal(stageText("building", "x.step", "repairing"), "Repairing the solid\u2026 \u00B7 x.step");
  } finally {
    globalThis.document = old;
  }
}));
