import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { LIMITS, snapshot, validateEnvelope, makeLink } from "../src/sharelink.js";

// Use the app's real gear command and store, with its vendored font library.
const root = fileURLToPath(new URL("../", import.meta.url));
async function loadApp(legacy = false) {
  const bundle = await build({
    stdin: { contents: 'export { initGears } from "./src/gears.js"; export { store, newDoc, resolveNode, regionsFor } from "./src/store.js";', resolveDir: root },
    bundle: true, write: false, format: "esm", platform: "node",
    alias: { "opentype.js": root + "third_party/opentype.js/dist/opentype.module.js" },
    // Reproduce the previous generator's full IDs, without a second copy of the
    // gear formulas. Everything else, including region finding, is the real app.
    plugins: legacy ? [{ name: "old-gear-ids", setup(b) {
      b.onLoad({ filter: /[/\\]gears\.js$/ }, args => ({
        contents: readFileSync(args.path, "utf8").replaceAll('itemId("', 'uid("'), loader: "js",
      }));
    } }] : [],
  });
  return import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
}
const { initGears, store, newDoc, resolveNode, regionsFor } = await loadApp();
const legacy = await loadApp(true);
const gears = initGears({}, {});
const envelope = doc => ({ app: "jumpstart-3d", version: 1, doc: snapshot(doc) });
const bytes = doc => Buffer.byteLength(JSON.stringify(envelope(doc)));

test("default helical gear stays well below the JSON cap with identical resolved geometry", async t => {
  store.load(newDoc("Helical gear", "advanced"));
  const spec = { kind: "helical", module: 2, teeth: 20 };
  gears.add(spec);
  legacy.store.load(legacy.newDoc("Helical gear", "advanced"));
  legacy.initGears({}, {}).add(spec);
  t.diagnostic(`Default helical gear JSON: ${bytes(legacy.store.doc)} before, ${bytes(store.doc)} after`);
  assert.ok(bytes(store.doc) < LIMITS.JSON_BYTES / 2);
  assert.ok(bytes(store.doc) < bytes(legacy.store.doc) * 0.7);
  validateEnvelope(envelope(store.doc));
  validateEnvelope(envelope(legacy.store.doc));
  const link = await makeLink(store.doc, "https://example.invalid/");
  t.diagnostic(`Share link result: ${link.ok ? "fits" : link.reason}; URL size: ${link.size ?? "not reported"}`);
  const resolved = resolveNode(store.doc.bodies[0].node, store.doc);
  assert.deepEqual(resolved, legacy.resolveNode(legacy.store.doc.bodies[0].node, legacy.store.doc));
  // A JSON save/load retains the exact kernel input, including its cache key data.
  store.load(JSON.parse(JSON.stringify(store.doc)));
  assert.deepEqual(resolveNode(store.doc.bodies[0].node, store.doc), resolved);
  for (const sec of store.doc.bodies[0].node.sections) {
    const sk = store.doc.sketches.find(s => s.id === sec.sketch);
    assert.equal(sec.ref.key, regionsFor(sk)[0].key);
  }
});

test("a larger helical gear that exceeded the JSON cap now fits", t => {
  const spec = { kind: "helical", module: 2, teeth: 24, width: 16 };
  store.load(newDoc("Larger gear", "advanced"));
  gears.add(spec);
  legacy.store.load(legacy.newDoc("Larger gear", "advanced"));
  legacy.initGears({}, {}).add(spec);
  t.diagnostic(`Larger helical gear JSON: ${bytes(legacy.store.doc)} before, ${bytes(store.doc)} after`);
  assert.ok(bytes(legacy.store.doc) > LIMITS.JSON_BYTES);
  assert.ok(bytes(store.doc) < LIMITS.JSON_BYTES);
  assert.deepEqual(resolveNode(store.doc.bodies[0].node, store.doc), legacy.resolveNode(legacy.store.doc.bodies[0].node, legacy.store.doc));
});

test("old saved helical designs keep their long keys and resolved geometry", () => {
  const old = JSON.parse(readFileSync(new URL("./projects/gears-helical.json", import.meta.url), "utf8"));
  const before = old.bodies.map(b => resolveNode(b.node, old));
  assert.ok(old.bodies[0].node.sections[0].ref.key.length > 3500);
  store.load(structuredClone(old));
  assert.deepEqual(store.doc.bodies, old.bodies);
  assert.deepEqual(store.doc.bodies.map(b => resolveNode(b.node, store.doc)), before);
  assert.ok(before.every(n => n.sections.length >= 2 && n.sections.every(s => s.region.outer.length > 0)));
});

test("adding another gear avoids existing point and entity IDs", () => {
  store.load(newDoc("Two gears", "advanced"));
  const spec = { kind: "helical", module: 2, teeth: 20 };
  gears.add(spec);
  const first = structuredClone(store.doc);
  gears.add({ ...spec, hand: "left", at: [60, 0, 0] });
  const ids = store.doc.sketches.flatMap(s => [...s.pts, ...s.ents].map(x => x.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(store.doc.sketches.slice(0, first.sketches.length), first.sketches);
  assert.deepEqual(resolveNode(store.doc.bodies[0].node, store.doc), resolveNode(first.bodies[0].node, first));
});
