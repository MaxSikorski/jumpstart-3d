// The ISO metric thread profile (kernel.js threadGroove), measured on the real kernel: an M3, M5 and M8 bolt and nut are cut through the axis
// and the section is read back (diameters, flat widths, flank angle, pitch diameter), then a nut is slid over the bolt to check they do not
// overlap. Plan and numbers: .claude/plans/screw-threads (ISO 68-1 basic profile, ISO 965 tolerance position h / H).
// The whole file takes about 100 s (more with THREAD_BOOLEAN=1) and is run by hand; pretest runs the small threadquick.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PITCH, getRuntime, measure, checkNone, checkSlivers } from "./threadprofile-lib.mjs";

for (const key of ["M3", "M5", "M8"]) {
  test(`${key}: ISO basic profile at print offset None, bolt and nut do not overlap`, { timeout: 240000 }, () => checkNone(key));
}

test("print offset: the M3 nut no longer falls through at -0.2 (it did: bolt major 2.700 < nut minor 2.759); M5 and M8 keep room at -0.1", { timeout: 600000 }, async () => {
  for (const [key, c] of [["M3", -0.2], ["M5", -0.1], ["M8", -0.1]]) {
    const p = PITCH[key], H = 0.866025 * p;
    const m = await measure(key, c, key === "M3"); // boolean (THREAD_BOOLEAN=1): M3 only
    // the offset s of each part is capped (bolt 0.07 pitch: its crest flat P/8 is nearly gone; nut 0.15 pitch), as kernel.js threadGroove says
    const sb = Math.min(Math.abs(c), 0.07 * p), sn = Math.min(Math.abs(c), 0.15 * p), d2 = +key.slice(1) - 0.649519 * p;
    // the crest of one part meets the root of the other, so the smallest radial gap is about the nut's s
    assert.ok(m.gap > 0.8 * sn, `${key} at ${c}: the nut has no room (radial gap ${m.gap.toFixed(4)} mm, wanted over ${(0.8 * sn).toFixed(4)})`);
    if (m.overlap !== null) assert.ok(m.overlap < 0.05, `${key} at ${c}: overlap ${m.overlap.toFixed(3)} mm3`);
    // the bolt's crest still reaches past the nut's crest by at least 90 percent of the 5H/8 engagement
    assert.ok(m.engagement >= 0.9 * 5 * H / 8, `${key} at ${c}: engagement ${m.engagement.toFixed(3)} mm, wanted at least ${(0.9 * 5 * H / 8).toFixed(3)}`);
    assert.ok(m.bolt.major > m.nut.minor, `${key} at ${c}: the bolt (${m.bolt.major.toFixed(3)}) falls through the nut (${m.nut.minor.toFixed(3)})`);
    // the flanks move by s: the pitch diameter of the bolt shrinks and the nut's grows by about 2 s each (the section reads the bolt up to 0.03 fat at offset None)
    assert.ok(m.bolt.pitchDia < d2 + 0.03 - 1.9 * sb, `${key} at ${c}: bolt pitch diameter ${m.bolt.pitchDia.toFixed(3)} (ISO ${d2.toFixed(3)}, s ${sb})`);
    assert.ok(m.nut.pitchDia > d2 - 0.03 + 1.9 * sn, `${key} at ${c}: nut pitch diameter ${m.nut.pitchDia.toFixed(3)} (ISO ${d2.toFixed(3)}, s ${sn})`);
  }
});

test("no sliver edges: M2.5, M3 and M5 bolt and nut at offsets 0, -0.1 and -0.2 are valid and their shortest edge is at least 0.009 mm", { timeout: 600000 }, () => checkSlivers(["M2.5", "M3", "M5"]));
