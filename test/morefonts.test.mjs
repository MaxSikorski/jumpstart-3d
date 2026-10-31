// The extra Text fonts load on first use (src/morefonts.js): J.Siwek's fonts_more.js is read as data, never run, and only a design
// with a font other than the classic three waits for it. The browser side (pickers, builds, the toast offline) is upstream2813.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMoreFonts, usesMoreFonts } from "../src/morefonts.js";

test("all 42 fonts come out of his fonts_more.js with a name, a group and TrueType data", () => {
  const fonts = parseMoreFonts(readFileSync(new URL("../src/fonts_more.js", import.meta.url), "utf8"));
  assert.equal(fonts.length, 42);
  assert.equal(new Set(fonts.map((f) => f.key)).size, 42);
  for (const f of fonts) {
    assert.ok(f.name && f.group, f.key);
    assert.deepEqual([...Buffer.from(f.data, "base64").subarray(0, 4)], [0, 1, 0, 0], f.key + " is a TrueType font");
  }
  assert.ok(fonts.some((f) => f.key === "bangers" && /Bangers/.test(f.name)));
});

test("a damaged file is refused with a plain message", () => {
  assert.throws(() => parseMoreFonts("nothing here"), /no font list/);
  assert.throws(() => parseMoreFonts('export const MORE_FONTS = [{"key": "x", "name": "X", "group": "G"}];\nconst DATA = {\n};'), /no data for x/);
});

test("only text in a font other than sans, serif and mono needs the extra fonts", () => {
  const text = (font) => JSON.stringify({ t: "prim", kind: "text", p: { text: "Hi", font } });
  assert.equal(usesMoreFonts(text("sans")), false);
  assert.equal(usesMoreFonts(text("mono")), false);
  assert.equal(usesMoreFonts(JSON.stringify({ t: "prim", kind: "box", p: { w: 1 } })), false);
  assert.equal(usesMoreFonts(text("bangers")), true);
  assert.equal(usesMoreFonts(JSON.stringify({ mods: [{ t: "emboss", str: "A", font: "serif" }, { t: "emboss", str: "B", font: "lobster" }] })), true);
});

// the page side, with a stand-in worker: what goes to the worker and when
import { KernelClient } from "../src/kernelClient.js";
import { initMoreFonts } from "../src/morefonts.js";
const FONTS_TEXT = readFileSync(new URL("../src/fonts_more.js", import.meta.url), "utf8");
const textNode = (font) => ({ t: "prim", kind: "text", p: { text: "Hi", size: 10, h: 2, font }, mods: [] });
const item = (id, node) => ({ id, key: JSON.stringify(node), node });
function rig(helperAsset) {
  const k = new KernelClient({}), posted = [], toasts = [], synced = [];
  k.ready = true;
  k.watchdogMs = 1; k.stalled = () => {}; // no real worker to time out or restart
  k.worker = { postMessage: (m) => posted.push(m) };
  const app = { kernel: k, toast: (m) => toasts.push(m), scene: { doc: { bodies: [] }, views: new Map(), sync: (d) => synced.push(d) } };
  const fonts = initMoreFonts(app, { helperAsset, helperFailText: () => "reload" });
  const builds = () => posted.filter((m) => m.type === "build").map((m) => m.bodies.map((b) => b.id));
  const done = () => { clearTimeout(k.watchdog); clearTimeout(k.noteTimer); k.inflight = null; };
  return { app, k, posted, toasts, synced, fonts, builds, done };
}

test("a damaged fonts file: the box builds at once, the text waits, then builds in Rounded sans after one toast", async () => {
  const r = rig(async () => "not the fonts file");
  r.k.request([item("t", textNode("bangers")), item("b", { t: "prim", kind: "box", p: { w: 1, d: 1, h: 1 }, mods: [] })]);
  assert.deepEqual(r.builds(), [["b"]]); // only the body that needs no extra font went
  r.done();
  assert.equal(await r.fonts.load(), false);
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(r.builds(), [["b"], ["t"]]); // the wait ended and the text went (the worker falls back to Rounded sans)
  assert.equal(r.fonts.state, "failed");
  assert.equal(r.toasts.length, 1);
  r.done();
  await r.fonts.load(); // a later failure (a picker trying again) says nothing more
  assert.equal(r.toasts.length, 1);
  r.done();
});

test("fonts that arrive after text was built in Rounded sans: that text is forgotten and built again, other bodies are kept", async () => {
  let online = false;
  const r = rig(async () => { if (!online) throw new Error("offline"); return FONTS_TEXT; });
  const t = item("t", textNode("bangers")), s = item("s", textNode("sans"));
  r.k.request([t, s]);
  r.done();
  await r.fonts.load();
  r.k.meshes.set(t.key, { ok: true }); r.k.meshes.set(s.key, { ok: true });
  const tv = { key: t.key }, sv = { key: s.key };
  r.app.scene.views.set("t", tv); r.app.scene.views.set("s", sv);
  online = true;
  assert.equal(await r.fonts.load(), true); // a font picker opened, now online
  assert.equal(r.k.meshes.has(t.key), false);
  assert.equal(r.k.meshes.has(s.key), true);
  assert.ok(r.posted.some((m) => m.type === "clear"));
  assert.equal(r.synced.length, 1);
  assert.equal(tv.key, null); // its view redraws with the new mesh
  assert.equal(sv.key, s.key);
  assert.equal(r.posted.filter((m) => m.type === "asset" && m.kind === "font").length, 42);
  r.done();
});

test("fonts that arrive while a Rounded sans build of the text is with the worker: that reply is dropped and the text built again", async () => {
  let online = false;
  const r = rig(async () => { if (!online) throw new Error("offline"); return FONTS_TEXT; });
  await r.fonts.load(); // offline: failed, so text in an extra font now builds in Rounded sans
  r.done();
  const t = item("t", textNode("bangers"));
  r.k.request([t]);
  assert.deepEqual(r.builds(), [["t"]]); // the fallback build is in flight
  const req = r.k.inflightReq;
  online = true;
  assert.equal(await r.fonts.load(), true); // a picker gets the fonts before the reply
  r.k.handle({ type: "built", req, results: [{ id: "t", rev: t.key, ok: true, mesh: "rounded sans" }] });
  assert.equal(r.k.meshes.has(t.key), false); // the fallback shape is not kept
  assert.deepEqual(r.builds(), [["t"], ["t"]]); // and the text went to the worker again (now with the fonts)
  r.k.handle({ type: "built", req: r.k.inflightReq, results: [{ id: "t", rev: t.key, ok: true, mesh: "bangers" }] });
  assert.equal(r.k.meshes.get(t.key).mesh, "bangers");
  r.done();
});

test("a stalled batch clears stale marks before its bodies retry", () => {
  const r = rig(async () => FONTS_TEXT);
  const a = item("a", textNode("bangers")), b = item("b", textNode("sans"));
  r.k.waitFor = null;
  r.k.worker.terminate = () => {};
  r.k.start = () => { r.k.ready = true; r.k.pump(); };
  r.k.stalled = KernelClient.prototype.stalled;
  try {
    r.k.request([a, b]);
    const batch = r.k.inflight;
    r.k.stale.add(a.key);
    r.k.stalled(batch);
    assert.equal(r.k.stale.has(a.key), false);
    r.k.handle({ type: "built", req: r.k.inflightReq, results: [{ id: "a", rev: a.key, ok: true, mesh: "fresh" }] });
    assert.equal(r.k.meshes.get(a.key).mesh, "fresh");
    assert.deepEqual(r.builds(), [["a", "b"], ["a"], ["b"]]);
  } finally { r.done(); }
});

test("a stale reply does not requeue a body replaced by an edit", () => {
  const r = rig(async () => FONTS_TEXT);
  const old = item("t", textNode("bangers")), updated = item("t", textNode("sans"));
  r.k.waitFor = null;
  try {
    r.k.request([old]);
    r.k.stale.add(old.key);
    r.k.prune(new Set([updated.key]));
    r.k.request([updated]);
    r.k.handle({ type: "built", req: r.k.inflightReq, results: [{ id: "t", rev: old.key, ok: true }] });
    assert.deepEqual(r.builds(), [["t"], ["t"]]);
    assert.equal(r.k.inflight[0].key, updated.key);
    assert.equal(r.k.queue.has(old.key), false);
  } finally { r.done(); }
});

for (const reply of ["built", "error"]) {
  test(`a probe ignores a stale ${reply} reply and receives the fresh build`, async () => {
    const r = rig(async () => FONTS_TEXT);
    const t = item("t", textNode("bangers"));
    r.k.waitFor = null;
    try {
      const probe = r.k.probe(t);
      r.k.stale.add(t.key);
      const req = r.k.inflightReq;
      if (reply === "built") r.k.handle({ type: "built", req, results: [{ id: "t", rev: t.key, ok: true, mesh: "fallback" }] });
      else r.k.handle({ type: "error", req, error: "fallback failed" });
      assert.equal(r.k.probes.has(t.key), true);
      assert.deepEqual(r.builds(), [["t"], ["t"]]);
      r.k.handle({ type: "built", req: r.k.inflightReq, results: [{ id: "t", rev: t.key, ok: true, mesh: "fresh" }] });
      assert.equal((await probe).mesh, "fresh");
    } finally {
      const done = r.k.probes.get(t.key);
      if (done) done({ ok: false });
      r.done();
    }
  });
}
