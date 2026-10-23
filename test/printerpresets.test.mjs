// The printer catalog and the saved plate choice in src/printerpresets.js (node --test, no browser).
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { PRINTERS, PLATE_PRINTERS, PLATE_KEY, plateDims, getPlatePref, setPlatePref, onPlatePref } = await import("../src/printerpresets.js");

// The seven named choices and their manufacturer-stated build volumes, checked 2026-10-23 (see the URLs on each row).
const TABLE = { a1: [256, 256, 256], x1: [256, 256, 256], p1s: [256, 256, 256], mk4: [250, 210, 220], mini: [180, 180, 180], ender3: [220, 220, 250], u1: [270, 270, 270] };

test("the named choices are exactly the verified ones, with their sizes", () => {
  assert.deepEqual([...PLATE_PRINTERS].sort(), Object.keys(TABLE).sort());
  for (const [k, [w, d, h]] of Object.entries(TABLE)) {
    assert.deepEqual(plateDims(k), { w, d, h }, k);
    const ev = PRINTERS[k].dimensionEvidence;
    assert.equal(ev.status, "vendor-verified", k);
    assert.equal(ev.checked, "2026-10-23");
    assert.ok(ev.urls.length >= 1 && ev.urls.every((u) => u.startsWith("https://")), k);
    assert.equal(PRINTERS[k].physicalTest, "unverified");
  }
});

test("MK4 is rectangular, Snapmaker means the U1, X1E is not claimed", () => {
  assert.notEqual(plateDims("mk4").w, plateDims("mk4").d);
  assert.match(PRINTERS.u1.plateLabel, /U1/);
  assert.ok(PLATE_PRINTERS.every((k) => !/^Snapmaker( |$)/.test(PRINTERS[k].plateLabel) || /U1/.test(PRINTERS[k].plateLabel)));
  assert.deepEqual(PRINTERS.x1.dimensionEvidence.notVerified, ["X1E"]);
  assert.ok(!/X1E/.test(PRINTERS.x1.plateLabel));
});

test("every other catalog row stays, unchanged in size, marked unverified", () => {
  const others = Object.keys(PRINTERS).filter((k) => !PLATE_PRINTERS.includes(k));
  assert.ok(others.length >= 20);
  for (const k of others) { assert.equal(PRINTERS[k].dimensionEvidence.status, "unverified", k); assert.equal(PRINTERS[k].dimensionEvidence.checked, null); }
  assert.deepEqual([PRINTERS.k1.w, PRINTERS.k1.d, PRINTERS.k1.h], [220, 220, 250]);
  assert.deepEqual([PRINTERS.h2d.w, PRINTERS.h2d.d, PRINTERS.h2d.h], [350, 320, 325]);
  assert.equal(PRINTERS.x1.tools.slots, 16); // tool settings were not touched
});

test("generic is the old 256 x 256 mat, none has no boundary", () => {
  assert.deepEqual(plateDims("generic"), { w: 256, d: 256, h: null });
  assert.equal(plateDims("none"), null);
  assert.deepEqual(plateDims("no-such-printer"), { w: 256, d: 256, h: null });
});

test("the saved choice: defaults, junk is cleaned, changes notify once", () => {
  assert.deepEqual(getPlatePref(), { v: 1, printer: "generic", shade: false, angle: 45 });
  const seen = [];
  onPlatePref((p) => seen.push(p));
  setPlatePref({ printer: "mk4", shade: true, angle: 60 });
  setPlatePref({ printer: "mk4" });
  assert.equal(seen.length, 1);
  assert.deepEqual(JSON.parse(store.get(PLATE_KEY)), { v: 1, printer: "mk4", shade: true, angle: 60 });
  setPlatePref({ printer: "<script>", angle: 200, shade: "yes" });
  assert.deepEqual(getPlatePref(), { v: 1, printer: "generic", shade: false, angle: 45 });
});
