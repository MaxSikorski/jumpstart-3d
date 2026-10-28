import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { loadKernel, root } from "./stepspeed-kernel.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meshReport } from "./fuzz-checks.mjs";
const temp = mkdtempSync(join(tmpdir(), "step-speed-"));
const fixture = name => readFileSync(temp + "/" + name);
let manifest;
before(() => {
  const generated = spawnSync(process.execPath, [root + "test/fixtures/make-step-speed-fixtures.mjs", temp], { encoding: "utf8", timeout: 600000, maxBuffer: 2e6 });
  assert.ifError(generated.error);
  assert.equal(generated.status, 0, generated.stderr);
  manifest = JSON.parse(fixture("step-speed-manifest.json"));
});
after(() => rmSync(temp, { recursive: true, force: true }));
test("dense STEP cold child: under 30 s", { timeout: 65000 }, () => {
  const p = spawnSync(process.execPath, [root + "test/stepspeed-trial.mjs", temp + "/step-dense-fastener.step"], { encoding: "utf8", timeout: 60000, maxBuffer: 2e6 });
  console.log(p.stdout);
  assert.ifError(p.error);
  assert.equal(p.status, 0, p.stderr);
  const r = JSON.parse(p.stdout.split("STEP_TIMING ")[1].trim());
  assert(Math.abs(r.volume - manifest.volume) / manifest.volume < 0.001);
  assert.deepEqual(Object.keys(r.stages), ["reading", "building", "meshing", "sending"]);
});
test("millimetre fixture has exact curved centers and a closed mesh", { timeout: 180000 }, async () => {
  const k = await loadKernel(), R = k.__R, OC = k.__OC();
  k.setAsset("mm", "step", fixture("step-dense-fastener.step"));
  const node = { t: "step", asset: "mm", mods: [] };
  const [r] = k.buildBodies([{ id: "mm", rev: "mm", node }], 1);
  assert(r.ok, r.error);
  assert(Math.abs(r.mesh.volume - manifest.volume) / manifest.volume < 0.001);
  for (let j = 0; j < 3; j++) {
    assert(Math.abs(r.mesh.bbox.min[j] - manifest.bounds[0][j]) < 0.001);
    assert(Math.abs(r.mesh.bbox.max[j] - manifest.bounds[1][j]) < 0.001);
  }
  const shape = k.evalNode(node), faces = shape.faces;
  try {
    for (let i = 0; i < faces.length; i++)
      if (faces[i].geomType !== "PLANE") {
        const center = faces[i].center;
        try {
          const exact = center.toTuple();
          assert.deepEqual(r.mesh.faceInfo[i].c, exact);
          assert.equal(r.mesh.faceInfo[i].t, faces[i].geomType);
        } finally {
          center.delete();
        }
      }
  } finally {
    faces.forEach(f => f.delete());
    shape.delete();
  }
  const m = r.mesh, tris = [];
  for (let i = 0; i < m.triangles.length; i += 3)
    tris.push([0, 1, 2].map(j => Array.from(m.vertices.slice(m.triangles[i + j] * 3, m.triangles[i + j] * 3 + 3))));
  const topology = meshReport(tris);
  assert.equal(topology.open, 0, "closed tessellation");
  assert(Math.abs(topology.volume - m.volume) / m.volume < 0.01);
  // Sphere analytic metadata is unchanged too; cylinder consumers (Thread, measure, simulate) use exact centers above.
  const sphere = R.makeSphere(3);
  try {
    const mesh = k.meshShape(sphere);
    const f = mesh.faceInfo.find(f => f.t === "SPHERE");
    assert.equal(f.r, 3);
    assert.deepEqual(f.o, [0, 0, 0]);
    assert(!f.n);
  } finally {
    sphere.delete();
  }
});
