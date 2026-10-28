// Fresh process per trial: exclude bundling, initialization and byte IO from the clock.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadKernel, root } from "./stepspeed-kernel.mjs";
const file = process.argv[2];
assert(file, "Pass the generated STEP fixture path");
const k = await loadKernel(process.argv[3]);
const bytes = readFileSync(file);
k.setAsset("bolt", "step", bytes);
const events = [];
const start = performance.now();
const [r] = k.buildBodies([{ id: "bolt", rev: "cold", node: { t: "step", asset: "bolt", mods: [] } }], 1, { onProgress: e => events.push(e) });
const ms = performance.now() - start;
assert.equal(r.ok, true, r.error);
const m = r.mesh;
assert.equal(m.solidCount, 1);
assert(m.faceInfo.length > 400);
let end = 0;
for (const [offset, count] of m.faceGroups) {
  assert.equal(offset, end);
  assert.equal(count % 3, 0);
  end += count;
}
assert.equal(end, m.triangles.length);
for (const f of m.faceInfo) {
  assert(f.c?.every(Number.isFinite));
  assert(!("cApprox" in f));
  if (f.t !== "PLANE")
    assert(!("n" in f));
  if (f.t === "CYLINDRE") {
    assert(f.r > 0);
    assert(f.ax.every(Number.isFinite));
    assert(f.o.every(Number.isFinite));
  }
}
// Face-index painting and triangle-hit normals keep their original ordering and buffers.
assert.equal(m.faceInfo.length, m.faceGroups.length);
assert.equal(m.vertices.length, m.normals.length);
assert([...m.vertices, ...m.normals].every(Number.isFinite));
const durations = {};
for (let i = 0; i < events.length; i++)
  durations[events[i].detail || events[i].stage] = (events[i + 1]?.ms ?? ms) - events[i].ms;
const report = { file: file.split("/").pop(), ms, stages: durations, platform: process.platform, arch: process.arch, node: process.version, sha256: createHash("sha256").update(bytes).digest("hex"), triangles: m.triangles.length / 3, faces: m.faceInfo.length, healingRetried: events.some(e => e.detail === "repairing"), volume: m.volume, bounds: m.bbox };
console.log("STEP_TIMING " + JSON.stringify(report));
if (!process.env.STEP_MEASURE_ONLY)
  assert(ms < 30000, `cold build ${ms.toFixed(1)} ms exceeds the unchanged 30 s budget`);
