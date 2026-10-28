// Manifold, the mesh-boolean engine for joins and cuts with an imported mesh (src/meshbool.js, third_party/manifold-3d/).
// Block 1 (the engine): the vendored files are the ones the README names, and the engine, bundled the way build.mjs bundles the
// worker (IIFE, minified), starts in a sandbox that has no `process`, no `import.meta.url` and no fetch, and cuts a cylinder out of a cube.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");

describe("the vendored Manifold engine", () => {
  const readme = readFileSync(root + "third_party/manifold-3d/README.md", "utf8");

  test("wasm.js holds the manifold.wasm the README names, and manifold.js is the package's glue", async () => {
    const mod = readFileSync(root + "third_party/manifold-3d/wasm.js", "utf8");
    const b64 = /export default "([A-Za-z0-9+/=]+)"/.exec(mod)[1];
    const wasm = gunzipSync(Buffer.from(b64, "base64"));
    assert.deepEqual([...wasm.subarray(0, 4)], [0, 0x61, 0x73, 0x6d], "a WebAssembly file");
    const wasmHash = sha(wasm), jsHash = sha(readFileSync(root + "third_party/manifold-3d/manifold.js"));
    assert.ok(readme.includes(wasmHash), "README.md names the sha256 of manifold.wasm: " + wasmHash);
    assert.ok(readme.includes(jsHash), "README.md names the sha256 of manifold.js: " + jsHash);
    assert.match(readme, /manifold-3d 3\.5\.4/);
    assert.equal(JSON.parse(readFileSync(root + "third_party/manifold-3d/package.json", "utf8")).version, "3.5.4");
  });

  test("the loader, bundled like the worker, starts with no process, no import.meta.url and no fetch, and cuts a cylinder out of a cube", async () => {
    // build.mjs: common options + format iife, and the empty import.meta warning silenced (the loader never needs it)
    const out = await build({
      stdin: { contents: 'import load from "./third_party/manifold-3d/index.js"; globalThis.__load = load;', resolveDir: root },
      bundle: true, minify: true, legalComments: "eof", target: "es2020", logLevel: "warning", format: "iife", write: false, external: ["node:*"],
      logOverride: { "empty-import-meta": "silent" },
    });
    const sandbox = {
      // what a worker has, and nothing else: JS built-ins come with the context; these are the web APIs the loader reads
      atob, TextDecoder, TextEncoder, DecompressionStream, Response, Blob, ReadableStream, WritableStream, TransformStream, URL, performance, queueMicrotask, setTimeout, clearTimeout,
      console, // the engine may log
      fetch: () => { throw new Error("the engine must not fetch anything"); },
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    assert.equal(vm.runInContext("typeof process + typeof window + typeof importScripts", sandbox), "undefinedundefinedundefined");
    vm.runInContext(out.outputFiles[0].text, sandbox, { filename: "worker-bundle.js" });
    const t0 = performance.now();
    const M = await sandbox.__load();
    const loadMs = Math.round(performance.now() - t0);
    assert.equal(await sandbox.__load(), M, "loads once");
    const cube = M.Manifold.cube({ x: 10, y: 10, z: 10 }), cyl = M.Manifold.cylinder(20, 3, 3, 96).translate({ x: 5, y: 5, z: -5 }); // plain objects: this sandbox's Array is not ours
    const cut = cube.subtract(cyl);
    const expected = 1000 - Math.PI * 9 * 10; // a 96-sided cylinder is a little smaller than the round one
    assert.ok(Math.abs(cut.volume() - expected) < 0.5, `volume ${cut.volume()} vs ${expected}`);
    assert.equal(cut.status(), "NoError");
    [cube, cyl, cut].forEach((m) => m.delete());
    console.log(`manifold-load: ${loadMs} ms in the sandbox`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 2 (the routing): the real kernel, bundled as test/meshimportfix.test.mjs does, with Manifold started the way worker.js starts
// it. A Join / Cut / Combine with an imported mesh must come out of Manifold (meshEngine "manifold"), closed, in a fraction of the
// time OpenCascade needs. Max's Pi lid is the committed reference model
// examples/pi-lid/raspberry-pi-4-case-lid.stl (or JS3D_PILID=<path>); generated meshes carry the same checks.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const lidFile = process.env.JS3D_PILID || root + "examples/pi-lid/raspberry-pi-4-case-lid.stl";
const tp = root + "third_party/";
const bundle = await build({
  stdin: { contents: 'export { initKernel, evalNode, setAsset, buildBodies, exportStep, clearCache, _test, fillReportCacheForTest } from "./src/kernel.js"; export * as R from "replicad"; export { readMeshFile, packMesh } from "./src/meshimport.js"; export { startManifold, manifoldReady, manifoldModule, manifoldError } from "./src/meshbool.js";', resolveDir: root },
  // the Fill openings report cache, so the tests can count what a build keeps (fillopen.test.mjs does the same)
  plugins: [{ name: "inspect-fill-report-cache", setup(builder) { builder.onLoad({ filter: /\/kernel\.js$/ }, ({ path }) => ({ contents: readFileSync(path, "utf8") + "\nexport const fillReportCacheForTest = fillReports;", loader: "js" })); } }],
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  // the engine's Node branch calls createRequire(import.meta.url), and a data: URL is not a file
  define: { "import.meta.url": JSON.stringify(pathToFileURL(root + "src/kernel.js").href) },
  alias: {
    replicad: tp + "replicad/src/index.ts",
    "replicad/shape-functions": tp + "replicad/src/shapeFunctions/index.ts",
    "opentype.js": tp + "opentype.js/dist/opentype.module.js",
    flatbush: tp + "flatbush/index.js",
    flatqueue: tp + "flatqueue/index.js",
    three: tp + "three/build/three.module.js",
  },
});
const K = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const { default: opencascade } = await import(root + "third_party/replicad-opencascadejs/dist/replicad_single.js");
await K.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
await K.startManifold(); await K.manifoldReady(); // worker.js does this on the first mesh asset, and waits for it before a build
const MF = K.manifoldModule();
assert.ok(MF, "Manifold started");

const I = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const box = (w, d, h) => ({ t: "prim", kind: "box", p: { w, d, h }, mods: [] });
const group = (kids, op) => ({ t: "group", ...(op ? { op } : {}), mods: [], children: kids });
const kid = (node, m = I(), hole = false) => ({ node, m, hole });
let nextId = 0;
const importStl = async (bytes, name = "m.stl") => {
  const res = await K.readMeshFile(new Uint8Array(bytes), name);
  const id = "mb" + nextId++;
  K.setAsset(id, "mesh", K.packMesh(res.mesh));
  return { t: "mesh", asset: id, mods: [] };
};
const build1 = (node, quality = 1) => {
  const t0 = performance.now();
  const [r] = K.buildBodies([{ id: "b", rev: 1, node }], quality);
  r.ms = performance.now() - t0;
  return r;
};

// a mesh asset straight from triangles, as stored (shared corners): no importer, so no repair of an open or inside-out mesh
const rawMesh = (T) => {
  const ids = new Map(), V = [], Ix = [];
  for (const t of T) for (const p of t) { const k = p.join(","); if (!ids.has(k)) { ids.set(k, V.length / 3); V.push(...p); } Ix.push(ids.get(p.join(","))); }
  const id = "mb" + nextId++;
  K.setAsset(id, "mesh", K.packMesh({ V: Float32Array.from(V), I: Uint32Array.from(Ix) }));
  return { t: "mesh", asset: id, mods: [] };
};
// binary STL of triangles [[a, b, c], ...] (each a [x, y, z])
const stlOf = (T) => {
  const b = Buffer.alloc(84 + 50 * T.length);
  b.writeUInt32LE(T.length, 80);
  T.forEach((t, k) => t.forEach((p, i) => p.forEach((x, c) => b.writeFloatLE(x, 84 + 50 * k + 12 + 12 * i + 4 * c))));
  return b;
};
const trisOf = (mf) => { // a Manifold's triangles as [[a, b, c]...]
  const g = mf.getMesh(), P = g.vertProperties, np = g.numProp, T = g.triVerts, out = [];
  for (let t = 0; t < T.length; t += 3) out.push([0, 1, 2].map((i) => [P[T[t + i] * np], P[T[t + i] * np + 1], P[T[t + i] * np + 2]]));
  return out;
};
const cube = (x, y, z, w, d, h) => MF.Manifold.cube({ x: w, y: d, z: h }).translate({ x, y, z });
// A two-level plate like the Pi lid's floor: a tray 90 x 60 x 10 whose floor top is at z 2.998, with a 20 x 20 pad whose top is at z 3
// (the lid has faces at 2.997999906539917 and 3). Shifted off the origin so that the import has to centre it.
function plateStl() {
  const tray = cube(-45, -30, 0, 90, 60, 10), cavity = cube(-40, -25, 2.998, 80, 50, 9), pad = cube(-30, -10, 2.998, 20, 20, 0.002);
  const a = tray.subtract(cavity), plate = a.add(pad);
  const T = trisOf(plate).map((t) => t.map((p) => [p[0] + 13, p[1] - 7, p[2] + 2]));
  [tray, cavity, pad, a, plate].forEach((m) => m.delete());
  return stlOf(T);
}
// the torus of issue #199 (genmeshes.mjs): R 30, r 10, nu x nv quads, two triangles each
function torusTris(nu, nv, R = 30, r = 10) {
  const P = (i, j) => { const u = (i % nu) / nu * 2 * Math.PI, v = (j % nv) / nv * 2 * Math.PI; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]; };
  const T = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); T.push([a, b, c], [a, c, d]); }
  return T;
}
const signedVolume = (T) => T.reduce((s, [a, b, c]) => s + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);

// open and non-manifold edges of a display mesh, by position
function edgeCheck(mesh, digits = null) {
  const V = mesh.vertices, T = mesh.triangles, edges = new Map();
  const key = (i) => (digits === null ? V[i * 3] + "," + V[i * 3 + 1] + "," + V[i * 3 + 2] : [0, 1, 2].map((c) => V[i * 3 + c].toFixed(digits)).join(","));
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = key(T[t + k]), b = key(T[t + (k + 1) % 3]);
    if (a === b) continue;
    const e = a < b ? a + "|" + b : b + "|" + a;
    edges.set(e, (edges.get(e) || 0) + 1);
  }
  let open = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
  return { open, nonManifold };
}
const hashMesh = (m) => createHash("sha256").update(Buffer.from(m.vertices.buffer, m.vertices.byteOffset, m.vertices.byteLength)).update(Buffer.from(m.normals.buffer, m.normals.byteOffset, m.normals.byteLength)).update(Buffer.from(m.triangles.buffer, m.triangles.byteOffset, m.triangles.byteLength)).update(JSON.stringify([m.faceGroups, m.edgeGroups, m.faceInfo, m.solidCount])).digest("hex");

// what the display fields must satisfy (the shapes meshShape returns, which scene.js, picking and the STL writer read)
function assertDisplay(m, label) {
  const nt = m.triangles.length / 3;
  assert.equal(m.vertices.length, nt * 9, label + ": one set of corners per triangle");
  assert.equal(m.normals.length, m.vertices.length);
  const seen = new Uint8Array(nt);
  for (const [s, c] of m.faceGroups) {
    assert.ok(s % 3 === 0 && c % 3 === 0 && c > 0 && s + c <= m.triangles.length, label + ": face group in range");
    for (let i = s / 3; i < (s + c) / 3; i++) { assert.equal(seen[i], 0, label + ": triangle in two face groups"); seen[i] = 1; }
  }
  assert.ok(seen.every((x) => x === 1), label + ": face groups cover every triangle exactly once");
  assert.equal(m.faceInfo.length, m.faceGroups.length);
  for (let i = 0; i < m.normals.length; i += 3) { const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]); assert.ok(Math.abs(l - 1) < 1e-4, label + ": unit normals"); }
  for (const f of m.faceInfo) { assert.equal(f.t, "PLANE"); assert.ok(Math.abs(Math.hypot(...f.n) - 1) < 1e-6 && f.c.every(Number.isFinite)); }
  const np = m.lines.length / 3;
  for (const [s, c] of m.edgeGroups) assert.ok(s >= 0 && c >= 0 && s + c <= np, label + ": edge group in range");
  assert.equal(m.edgeInfo.length, m.edgeGroups.length);
  assert.equal(m.faceEdges.length, m.faceGroups.length);
  for (const list of m.faceEdges) for (const e of list) assert.ok(e >= 0 && e < m.edgeGroups.length, label + ": face edge index");
  assert.ok(Number.isInteger(m.solidCount) && m.solidCount >= 1);
  assert.ok(m.volume > 0 && m.bbox.min.length === 3 && m.bbox.max.every((v, i) => v > m.bbox.min[i]));
  assert.equal(m.hasNonSolidFaces, false);
  if (m.solidCount > 1) { assert.equal(m.solidVolumes.length, m.solidCount); assert.equal(m.solidAreas.length, m.solidCount); }
}
const approx = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (±${tol})`);

describe("joins and cuts with an imported mesh run on Manifold", () => {
  test("a generated two-level plate: a flush Join, then a Cut, come out of Manifold closed, in one piece, with the right volumes", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const fill = box(64, 31, 3); // top at z 3: flush with the pad, 0.002 above the floor
    const join = group([kid(plate), kid(fill, I(-5.25, 0, 0))]);
    const cutNode = group([kid(join), kid(box(38, 38, 5), I(-7.3, 0, -1), true)]);
    // the expected volumes from the same shapes in doubles
    const tray = cube(-45, -30, 0, 90, 60, 10).subtract(cube(-40, -25, 2.998, 80, 50, 9)).add(cube(-30, -10, 2.998, 20, 20, 0.002));
    const f = cube(-37.25, -15.5, 0, 64, 31, 3);
    const wantJoin = tray.add(f).volume(), wantCut = tray.add(f).subtract(cube(-26.3, -19, -1, 38, 38, 5)).volume();
    const t0 = performance.now();
    const j = build1(join), c = build1(cutNode);
    const total = performance.now() - t0;
    for (const [name, r, want] of [["join", j, wantJoin], ["cut", c, wantCut]]) {
      assert.ok(r.ok, name + ": " + r.error);
      assert.equal(r.mesh.meshEngine, "manifold", name + ": engine (" + K._test.meshBoolReason() + ")");
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, name + ": open and non-manifold edges");
      assert.equal(r.mesh.solidCount, 1, name + ": one piece");
      approx(r.mesh.volume, want, 0.05, name + " volume");
      assertDisplay(r.mesh, name);
    }
    console.log(`meshbool-timing: plate join ${j.ms.toFixed(0)} ms, cut ${c.ms.toFixed(0)} ms`);
    assert.ok(total < 2000, `join + cut took ${total.toFixed(0)} ms`);
  });

  test("an 'Out' box into the plate's floor level and its pad: z 2.95, 2.998 and 3 all come out closed in one piece", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    for (const z of [2.95, 2.998, 3]) {
      const r = build1(group([kid(plate), kid(box(64, 31, 10), I(-5.25, 0, z))]));
      assert.ok(r.ok, `z ${z}: ${r.error}`);
      assert.equal(r.mesh.meshEngine, "manifold", `z ${z}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `z ${z}: open and non-manifold edges`);
      assert.equal(r.mesh.solidCount, 1, `z ${z}: one piece`);
    }
  });

  test("Manifold places an imported mesh where the B-rep import does (centred on x and y, resting on z 0)", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const r = build1(group([kid(plate), kid(box(10, 10, 1), I(0, 0, 0.5))])); // a box inside the floor: the union has the plate's bounds
    assert.equal(r.mesh.meshEngine, "manifold");
    const shape = K.evalNode(plate), bb = shape.boundingBox.bounds;
    for (let i = 0; i < 3; i++) {
      approx(r.mesh.bbox.min[i], bb[0][i], 1e-4, "bbox min " + i);
      approx(r.mesh.bbox.max[i], bb[1][i], 1e-4, "bbox max " + i);
    }
    shape.delete();
    approx(r.mesh.bbox.min[2], 0, 1e-6, "rests on z 0");
    approx(r.mesh.bbox.min[0] + r.mesh.bbox.max[0], 0, 1e-4, "centred on x");
  });

  test("a mesh with a scale mod, a Combine (bool mod) and a hole child all run on Manifold", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const tool = box(30, 30, 20), at = I(0, 0, -5);
    const viaGroup = build1(group([kid(plate), kid(tool, at, true)]));
    const viaMod = build1({ ...plate, mods: [{ t: "bool", op: "cut", tool, m: at }] });
    assert.equal(viaMod.mesh.meshEngine, "manifold", "Combine (bool mod) engine (" + K._test.meshBoolReason() + ")");
    approx(viaMod.mesh.volume, viaGroup.mesh.volume, 1e-3, "the Combine equals the group's hole");
    assert.ok(viaGroup.mesh.volume < 90 * 60 * 10);
    // a group with a scaled mesh in it
    const scaled = { ...plate, mods: [{ t: "scale", k: [2, 2, 2], o: [0, 0, 0] }] };
    const s = build1(group([kid(scaled), kid(box(10, 10, 10), I(0, 0, 0))]));
    assert.equal(s.mesh.meshEngine, "manifold", "scale engine (" + K._test.meshBoolReason() + ")");
    approx(s.mesh.bbox.max[0] - s.mesh.bbox.min[0], 180, 1e-3, "twice as wide");
  });

  test("a cut that splits the body into two pieces reports them, and a keeppiece mod picks one on Manifold", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const cutNode = group([kid(plate), kid(box(6, 70, 30), I(0, 0, -5), true)]); // a slot across the whole width: two pieces
    const r = build1(cutNode);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.equal(r.mesh.solidCount, 2);
    assert.equal(r.mesh.solidVolumes.length, 2);
    approx(r.mesh.solidVolumes[0] + r.mesh.solidVolumes[1], r.mesh.volume, 1e-3, "piece volumes add up");
    for (const piece of [0, 1]) {
      const p = build1({ ...cutNode, mods: [{ t: "keeppiece", piece, count: 2 }] });
      assert.equal(p.mesh.meshEngine, "manifold", `piece ${piece} engine (${K._test.meshBoolReason()})`);
      assert.equal(p.mesh.solidCount, 1);
      approx(p.mesh.volume, r.mesh.solidVolumes[piece], 1e-3, `piece ${piece} volume`);
    }
    const bad = build1({ ...cutNode, mods: [{ t: "keeppiece", piece: 0, count: 3 }] }); // a count that no longer fits: OpenCascade's error
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Keep piece 1: expected 3 separate solids, found 2/);
  });

  test("a cut that removes everything says 'Nothing is left'", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const r = build1(group([kid(plate), kid(box(200, 200, 200), I(0, 0, -50), true)]));
    assert.equal(r.ok, false);
    assert.match(r.error, /Nothing is left/);
  });

  test("the B-rep of a Manifold result is built on demand: STEP export, and a mod that needs a B-rep on top of the joined body", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    const [r] = K.buildBodies([{ id: "b", rev: 1, node: join }], 1);
    const shape = K.evalNode(join);
    approx(K._test.safeVolume(shape), r.mesh.volume, 0.5, "B-rep volume");
    shape.delete();
    const blob = K.exportStep([{ id: "b", node: join, m: I() }]);
    assert.ok(blob.size > 1000, "STEP file made (" + blob.size + " bytes)");
    // a mod Manifold does not do (Split body: keep everything below z 5) runs on the B-rep built from the Manifold result
    const below = build1({ ...join, mods: [{ t: "halfspace", plane: { o: [0, 0, 5], n: [0, 0, 1] }, side: -1 }] });
    assert.ok(below.ok, below.error);
    assert.equal(below.mesh.meshEngine, "manifold-brep");
    const want = build1(group([kid(join), kid(box(300, 300, 50), I(0, 0, 5), true)])); // the same, as a hole child, on Manifold
    approx(below.mesh.volume, want.mesh.volume, 0.5, "split body volume");
  });

  test("the same body built twice from cleared caches gives identical bytes", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const node = group([kid(plate), kid(box(64, 31, 3), I(-5.25, 0, 0)), kid(box(38, 38, 5), I(-7.3, 0, -1), true)]);
    const a = build1(node).mesh; K.clearCache();
    const b = build1(node).mesh; K.clearCache();
    assert.equal(hashMesh(a), hashMesh(b));
    assert.equal(b.meshEngine, "manifold");
  });

  test("repeated builds free their Manifold objects (the engine's memory does not keep growing)", async () => {
    // a Manifold that is never delete()d keeps its mesh in the engine's WebAssembly memory, which shows in the process's resident size (not in arrayBuffers).
    // Measured: freed, 15 builds grow it ~20 MB (JS and OpenCascade noise); with the freeing switched off, ~96 MB.
    const torus = await importStl(stlOf(torusTris(100, 50)), "torus10k.stl");
    const node = group([kid(torus), kid(box(31.7, 90, 30), I(-29.2, 0, -5), true)]);
    const mem = () => { global.gc && global.gc(); return process.memoryUsage().rss; };
    for (let i = 0; i < 3; i++) { build1(node); K.clearCache(); } // warm up: the heap grows once to the size this work needs
    const before = mem();
    for (let i = 0; i < 15; i++) { build1(node); K.clearCache(); }
    const grew = mem() - before;
    console.log(`meshbool-heap: resident memory grew ${(grew / 1048576).toFixed(1)} MB over 15 builds of a 10k-triangle cut`);
    assert.ok(grew <= 60 * 1048576, `resident memory grew by ${(grew / 1048576).toFixed(1)} MB over 15 builds`);
  });

  test("a 10,000-triangle torus (#199) with the hole box: 35.3 % removed, in under 2 s", async () => {
    const T = torusTris(100, 50), V0 = signedVolume(T);
    const torus = await importStl(stlOf(T), "torus10k.stl");
    // the hole box over the first third of the torus's x span, as repro199.mjs does it: w = span / 3 + 5, d = span + 10, h = 20 + 10
    const span = 80, w = span / 3 + 5;
    const node = group([kid(torus), kid(box(w, span + 10, 30), I(-45 + w / 2, 0, -5), true)]);
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    const removed = (1 - r.mesh.volume / V0) * 100;
    console.log(`meshbool-timing: torus 10k import + cut ${r.ms.toFixed(0)} ms, ${removed.toFixed(2)} % removed`);
    assert.ok(Math.abs(removed - 35.3) <= 0.5, `${removed.toFixed(2)} % removed`);
    assert.ok(r.ms < 2000, `the cut took ${r.ms.toFixed(0)} ms`);
    assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 });
    assertDisplay(r.mesh, "torus");
  });

  test("an open torus and an inside-out torus: no throw; the open one falls back to OpenCascade, the inside-out one is turned right side out", async () => {
    const T = torusTris(24, 12);
    const open = rawMesh(T.slice(1)), inside = rawMesh(T.map(([a, b, c]) => [a, c, b])), closed = rawMesh(T);
    const cutter = kid(box(30, 80, 30), I(-20, 0, -5), true);
    const rOpen = build1(group([kid(open), cutter]));
    assert.equal(rOpen.mesh ? rOpen.mesh.meshEngine : "error: " + rOpen.error, "occt-fallback", "the open mesh falls back");
    const ref = build1(group([kid(closed), cutter]));
    const rIn = build1(group([kid(inside), cutter]));
    assert.ok(rIn.ok, rIn.error);
    assert.equal(rIn.mesh.meshEngine, "manifold");
    approx(rIn.mesh.volume, ref.mesh.volume, 1e-3, "inside-out equals right-side-out");
    // the same node with Manifold off gives the OpenCascade result
    K._test.setMeshBoolEnabled(false);
    try {
      const occt = build1(group([kid(closed), cutter]));
      assert.notEqual(occt.mesh.meshEngine, "manifold", "off: no Manifold");
      approx(ref.mesh.volume, occt.mesh.volume, occt.mesh.volume * 2e-3, "Manifold and OpenCascade agree");
      const openOff = build1(group([kid(open), cutter]));
      assert.equal(openOff.ok, rOpen.ok);
      if (rOpen.ok) approx(rOpen.mesh.volume, openOff.mesh.volume, 1e-6, "fallback equals the OpenCascade path");
      else assert.equal(rOpen.error, openOff.error);
    } finally { K._test.setMeshBoolEnabled(true); }
  });

  test("a plain imported mesh with no boolean stays on the OpenCascade path", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const r = build1(plate);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, undefined);
  });

  test("a group of one imported mesh (the baseline Group and Combine build) is drawn from Manifold too, without the mesh import", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const r = build1(group([kid(plate)]));
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold");
  });

  test("the Pi lid: Join a flush fill box, then Cut the opening", async () => {
    const lid = await importStl(readFileSync(lidFile), "pi-lid.stl");
    const join = group([kid(lid), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    const cutNode = group([kid(join), kid(box(38, 38, 5), I(-7.3, 0, -1), true)]);
    const t0 = performance.now();
    const j = build1(join), c = build1(cutNode);
    const total = performance.now() - t0;
    for (const [name, r, want] of [["join", j, 18261.36], ["cut", c, 13927.16]]) {
      assert.ok(r.ok, name + ": " + r.error);
      assert.equal(r.mesh.meshEngine, "manifold", name + ": engine (" + K._test.meshBoolReason() + ")");
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, name + ": open and non-manifold edges");
      assert.equal(r.mesh.solidCount, 1, name + ": one piece");
      approx(r.mesh.volume, want, 0.05, name + " volume");
      assertDisplay(r.mesh, name);
    }
    console.log(`meshbool-timing: lid join ${j.ms.toFixed(0)} ms, cut ${c.ms.toFixed(0)} ms, together ${total.toFixed(0)} ms`);
    assert.ok(total < 2000, `join + cut took ${total.toFixed(0)} ms`);
  });

  test("the Pi lid: an 'Out' box at z 2.95, 2.998 and 3 comes out closed in one piece (OpenCascade left 682 and 26 broken edges)", async () => {
    const lid = await importStl(readFileSync(lidFile), "pi-lid.stl");
    for (const z of [2.95, 2.998, 3]) {
      const r = build1(group([kid(lid), kid(box(64, 31, 10), I(-5.25, 0, z))]));
      assert.ok(r.ok, `z ${z}: ${r.error}`);
      assert.equal(r.mesh.meshEngine, "manifold", `z ${z}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `z ${z}: open and non-manifold edges`);
      assert.equal(r.mesh.solidCount, 1, `z ${z}: one piece`);
      console.log(`meshbool-timing: lid Out box z ${z}: ${r.ms.toFixed(0)} ms`);
    }
  });

  test("the Pi lid: Manifold places it where the B-rep import does", async () => {
    const lid = await importStl(readFileSync(lidFile), "pi-lid.stl");
    const r = build1(group([kid(lid), kid(box(10, 10, 1), I(0, 0, 0.5))]));
    assert.equal(r.mesh.meshEngine, "manifold");
    const shape = K.evalNode(lid), bb = shape.boundingBox.bounds;
    for (let i = 0; i < 3; i++) { approx(r.mesh.bbox.min[i], bb[0][i], 1e-4, "min " + i); approx(r.mesh.bbox.max[i], bb[1][i], 1e-4, "max " + i); }
    shape.delete();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 3 (fix round 1): a Manifold start that fails or never finishes must not stop a build. A second copy of the kernel (its own
// Manifold state) is started with WebAssembly.instantiate stubbed, the way a browser without the right wasm support would behave.
let copies = 0;
async function freshKernel() {
  const text = bundle.outputFiles[0].text + `\n// copy ${++copies}\n`;
  const k = await import("data:text/javascript;base64," + Buffer.from(text).toString("base64"));
  await k.initKernel(opencascade, gunzipSync(readFileSync(root + "src/occt-gz.wasm")));
  return k;
}
async function withInstantiate(stub, fn) {
  const real = WebAssembly.instantiate;
  WebAssembly.instantiate = stub;
  try { return await fn(); } finally { WebAssembly.instantiate = real; }
}
const settles = (p, ms, what) => Promise.race([Promise.resolve(p).then(() => "settled"), new Promise((r) => setTimeout(() => r("hung"), ms))]).then((x) => assert.equal(x, "settled", what));

describe("a Manifold that fails to start leaves the build on OpenCascade", () => {
  for (const mode of ["rejects", "never answers"]) {
    test(`WebAssembly.instantiate ${mode}: manifoldReady() settles, the error is kept, and a mesh join builds on OpenCascade`, async () => {
      const k = await freshKernel();
      const stub = mode === "rejects" ? () => Promise.reject(new Error("no wasm here")) : () => new Promise(() => {});
      await withInstantiate(stub, async () => {
        const started = k.startManifold(mode === "rejects" ? undefined : 400); // the second argument is the time limit in ms (15 s by default)
        await settles(k.manifoldReady(), 5000, "manifoldReady() must settle");
        await settles(started, 5000, "startManifold() must settle");
      });
      assert.equal(k.manifoldModule(), null);
      assert.ok(k.manifoldError(), "the failure is kept");
      await settles(k.manifoldReady(), 1000, "a later manifoldReady() settles at once");
      // the same design builds on OpenCascade
      const res = await k.readMeshFile(new Uint8Array(plateStl()), "plate.stl");
      k.setAsset("fk", "mesh", k.packMesh(res.mesh));
      const node = group([kid({ t: "mesh", asset: "fk", mods: [] }), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
      const [r] = k.buildBodies([{ id: "b", rev: 1, node }], 1);
      assert.ok(r.ok, r.error);
      assert.equal(r.mesh.meshEngine, "occt-fallback");
      assert.ok(r.mesh.volume > 1000);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 4 (fix round 1): a cavity is part of the solid around it. Manifold's decompose() returns the enclosed void as its own shell (volume
// below zero); counted as a piece it made "2 solids" of 1000 and 512 for a 10 mm cube with an 8 mm room inside, a lazy B-rep of 1512, and a
// Combine that "split" it into pieces 1000 and -512. OpenCascade gives one solid of 488.
const cubeStl = (s = 10) => { const c = cube(-s / 2, -s / 2, 0, s, s, s), b = stlOf(trisOf(c)); c.delete(); return b; };
const solidsOf = (shape) => shape.solids ? shape.solids.length : null;

describe("an enclosed cavity belongs to the solid around it", () => {
  test("a cube with an enclosed room: one solid of 488, a B-rep of 488, keeppiece 1 of 1; the same on OpenCascade", async () => {
    const c = await importStl(cubeStl(), "cube.stl");
    const node = group([kid(c), kid(box(8, 8, 8), I(0, 0, 1), true)]);
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    approx(r.mesh.volume, 488, 1e-6, "display volume");
    assert.equal(r.mesh.solidCount, 1, "one solid, the room is not a piece");
    assert.equal(r.mesh.solidVolumes, undefined);
    assertDisplay(r.mesh, "cavity cube");
    const shape = K.evalNode(node);
    approx(K._test.safeVolume(shape), 488, 1e-3, "lazy B-rep volume");
    shape.delete();
    const kept = build1({ ...node, mods: [{ t: "keeppiece", piece: 0, count: 1 }] });
    assert.ok(kept.ok, kept.error);
    assert.equal(kept.mesh.meshEngine, "manifold");
    approx(kept.mesh.volume, 488, 1e-6, "keeppiece 1 of 1");
    const two = build1({ ...node, mods: [{ t: "keeppiece", piece: 0, count: 2 }] });
    assert.equal(two.ok, false);
    assert.match(two.error, /expected 2 separate solids, found 1/);
    const occt = K._test.withoutManifold(() => build1(node));
    assert.equal(occt.mesh.solidCount, 1);
    approx(occt.mesh.volume, 488, 1e-3, "OpenCascade volume");
  });

  test("two separate cubes, each with a room: two solids of 488, each kept alone, a B-rep of two solids", async () => {
    const a = await importStl(cubeStl(), "a.stl"), b = await importStl(cubeStl(), "b.stl");
    const cavity = (m, x) => group([kid(m, I(x, 0, 0)), kid(box(8, 8, 8), I(x, 0, 1), true)]);
    const node = group([kid(cavity(a, -20)), kid(cavity(b, 20))]);
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.equal(r.mesh.solidCount, 2);
    assert.deepEqual(r.mesh.solidVolumes.map((v) => +v.toFixed(3)), [488, 488]);
    approx(r.mesh.volume, 976, 1e-6, "display volume");
    for (const piece of [0, 1]) {
      const p = build1({ ...node, mods: [{ t: "keeppiece", piece, count: 2 }] });
      assert.ok(p.ok, p.error);
      assert.equal(p.mesh.meshEngine, "manifold");
      assert.equal(p.mesh.solidCount, 1);
      approx(p.mesh.volume, 488, 1e-6, `piece ${piece}`);
    }
    const shape = K.evalNode(node);
    approx(K._test.safeVolume(shape), 976, 1e-2, "lazy B-rep volume");
    assert.equal(solidsOf(shape), 2, "two solids in the B-rep");
    shape.delete();
    const occt = K._test.withoutManifold(() => build1(node));
    assert.equal(occt.mesh.solidCount, 2);
  });

  test("a small cube floating inside the room is a solid of its own, and the room stays with the outer one", async () => {
    const big = await importStl(cubeStl(20), "big.stl");
    const withRoom = group([kid(big), kid(box(16, 16, 16), I(0, 0, 2), true)]);
    const node = group([kid(withRoom), kid(box(4, 4, 4), I(0, 0, 8))]);
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.equal(r.mesh.solidCount, 2);
    assert.deepEqual([...r.mesh.solidVolumes].map((v) => +v.toFixed(2)).sort((x, y) => x - y), [64, 3904]);
    approx(r.mesh.volume, 3968, 1e-3, "display volume");
    const shape = K.evalNode(node);
    approx(K._test.safeVolume(shape), 3968, 1e-2, "lazy B-rep volume");
    shape.delete();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 5 (fix round 1): the mesh detail setting reaches every meshy body. A body whose last mod needs a B-rep (Split body on top of a join
// with a cylinder) was built from the cached B-rep of the old detail: Normal -> Extra fine left 300 triangles instead of 1004.
describe("mesh detail changes reach a body built on a Manifold result", () => {
  const cyl = { t: "prim", kind: "cylinder", p: { w: 20, d: 20, h: 20 }, mods: [] };
  const at = I(20, 0, 0); // clear of the plate's pad (a cylinder on the pad made Manifold refuse at Extra fine, so both sides were OpenCascade and the test compared it with itself)
  test("Normal then Extra fine equals a fresh Extra fine: a join, and a Split body on top of it", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(cyl, at)]);
    const split = { ...join, mods: [{ t: "halfspace", plane: { o: [0, 0, 15], n: [0, 0, 1] }, side: -1 }] };
    for (const [name, node, engine] of [["join", join, "manifold"], ["split body", split, "manifold-brep"]]) {
      build1(join, 1); K.clearCache(); // a session at Normal detail, with nothing cached yet
      const a = build1(node, 1), b = build1(node, 4);
      K.clearCache();
      const fresh = build1(node, 4);
      assert.ok(a.ok && b.ok && fresh.ok, `${name}: ${a.error || b.error || fresh.error}`);
      for (const [label, r] of [["Normal", a], ["Extra fine after Normal", b], ["fresh Extra fine", fresh]]) assert.equal(r.mesh.meshEngine, engine, `${name}, ${label}: engine (${K._test.meshBoolReason()})`);
      assert.ok(fresh.mesh.triangles.length > a.mesh.triangles.length, `${name}: finer detail makes more triangles (${a.mesh.triangles.length} -> ${fresh.mesh.triangles.length})`);
      assert.equal(b.mesh.triangles.length, fresh.mesh.triangles.length, `${name}: detail 4 after detail 1 has the triangles of a fresh detail 4`);
      approx(b.mesh.volume, fresh.mesh.volume, 1e-6, `${name}: volume`);
    }
  });
  test("the same holds going back down (Extra fine then Normal), and for a mesh with a plain app shape cut out of it", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const node = { ...group([kid(plate), kid(cyl, at)]), mods: [{ t: "halfspace", plane: { o: [0, 0, 15], n: [0, 0, 1] }, side: -1 }] };
    build1(node, 4); K.clearCache();
    build1(node, 4); const down = build1(node, 1);
    K.clearCache();
    const fresh = build1(node, 1);
    assert.equal(down.mesh.meshEngine, "manifold-brep", "Normal after Extra fine: engine (" + K._test.meshBoolReason() + ")");
    assert.equal(fresh.mesh.meshEngine, "manifold-brep", "fresh Normal: engine");
    assert.equal(down.mesh.triangles.length, fresh.mesh.triangles.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 6 (fix round 1): a moved mesh and a box typed on its floor must meet on the same numeric grid. The matrix was applied to each operand
// separately and rounded to float32 on its own, so a lid lifted 0.1 mm and a box at 2.998 + 0.1 landed one float32 step apart, Manifold
// refused the result, and OpenCascade made a slow, open one.
// Which of these reach the round-1 bug: with decimalOf switched off (the corners not taken back to their decimals) only the Pi lid test below
// fails ("lid lifted 0.1: ... result open or non-manifold by position"). The generated-plate tests pass either way (Manifold's own merge
// tolerance hides a one-step float32 difference on that plate, checked over 120 lifts of 0.01 to 1.2 mm), so they are regression GUARDS for the
// moved-mesh path, not reproductions.
describe("a moved mesh still meets the shapes set on its faces", () => {
  const plate = () => importStl(plateStl(), "plate.stl");
  const closedOne = (r, label) => {
    assert.ok(r.ok, label + ": " + r.error);
    assert.equal(r.mesh.meshEngine, "manifold", `${label}: engine (${K._test.meshBoolReason()})`);
    assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, label + ": open and non-manifold edges");
    assert.equal(r.mesh.solidCount, 1, label + ": one piece");
  };
  test("[guard] the plate lifted by 0.1 and 0.3 mm with an 'Out' box on its floor comes out of Manifold closed, in one piece", async () => {
    const mesh = await plate();
    for (const dz of [0.1, 0.3, 0.7, 1.3]) closedOne(build1(group([kid(mesh, I(0, 0, dz)), kid(box(64, 31, 10), I(-5.25, 0, 2.998 + dz))])), `lifted ${dz}`);
  });
  test("[guard] a joined plate moved by (dx, 0, dz), then grouped with a box flush on its floor: Manifold, closed, one piece", async () => {
    const mesh = await plate();
    const join = group([kid(mesh), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    for (const dz of [0, 0.1, 0.2, 0.3, 0.7, 1.1, 1.3, 2.9]) for (const dx of [0, 0.1, 0.35]) {
      closedOne(build1(group([kid(join, I(dx, 0, dz)), kid(box(64, 31, 10), I(-5.25 + dx, 0, 2.998 + dz))])), `moved join (${dx}, 0, ${dz})`);
    }
  });
  test("the Pi lid lifted by 0.1 and 0.3 mm with an 'Out' box on its floor, and a moved joined lid", async () => {
    const lid = await importStl(readFileSync(lidFile), "pi-lid.stl");
    for (const dz of [0.1, 0.3]) {
      const r = build1(group([kid(lid, I(0, 0, dz)), kid(box(64, 31, 10), I(-5.25, 0, 2.998 + dz))]));
      closedOne(r, `lid lifted ${dz}`);
      assert.ok(r.ms < 2000, `lid lifted ${dz} took ${r.ms.toFixed(0)} ms`);
    }
    const join = group([kid(lid), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    for (const [dx, dz] of [[0.1, 0.2], [0.35, 1.1], [0, 0.3]]) closedOne(build1(group([kid(join, I(dx, 0, dz)), kid(box(64, 31, 10), I(-5.25 + dx, 0, 2.998 + dz))])), `moved lid join (${dx}, 0, ${dz})`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 7 (fix round 1): the engine tag tells the truth about the top-level route, and an engine abort falls back instead of failing the build.
describe("meshEngine tag and engine aborts", () => {
  function withDecomposeAborting(fn) { // the instances' own prototype (not Manifold.prototype) carries the methods
    const probe = cube(0, 0, 0, 1, 1, 1), proto = Object.getPrototypeOf(probe), real = proto.decompose;
    probe.delete();
    proto.decompose = function () { throw new Error("abort(): engine failure"); };
    try { return fn(); } finally { proto.decompose = real; }
  }
  test("the tag is 'manifold-brep' both times a Split body on a join is built (a kernel cache hit too), and 'occt-fallback' when the top level was refused although a child is on Manifold", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    const split = { ...join, mods: [{ t: "halfspace", plane: { o: [0, 0, 5], n: [0, 0, 1] }, side: -1 }] };
    K.clearCache();
    assert.equal(build1(split).mesh.meshEngine, "manifold-brep", "first build");
    assert.equal(build1(split).mesh.meshEngine, "manifold-brep", "second build (the B-rep is a kernel cache hit)");
    // the top group is refused (an open mesh in it), its first child is a join Manifold did
    const open = rawMesh(torusTris(24, 12).slice(1));
    K.clearCache();
    const r = build1(group([kid(join), kid(open, I(100, 0, 0))]));
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "occt-fallback");
  });

  test("a Manifold call that aborts while the display mesh is made does not fail the build: OpenCascade builds it", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    const scaled = { ...join, mods: [{ t: "scale", k: [1.5, 1.5, 1.5], o: [0, 0, 0] }] }; // a Manifold result without piece counts yet: decompose() runs while the display is made
    K.clearCache();
    assert.equal(build1(join).mesh.meshEngine, "manifold");
    const r = withDecomposeAborting(() => build1(scaled));
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "occt-fallback");
    assert.ok(r.mesh.volume > 0);
  });

  // A regression guard, not a bug reproduction: this passed before round 1 too (finish() already ran inside the try that turns an abort into a refusal).
  test("[guard] a Manifold call that aborts while a result is being finished falls back too", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(box(64, 31, 5), I(-5.25, 0, 0))]);
    K.clearCache();
    const r = withDecomposeAborting(() => build1(join));
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "occt-fallback");
  });

  test("the tag does not outlive the cache: after clearCache() an aborted Manifold call leaves 'occt-fallback', not the earlier 'manifold-brep'", async () => {
    const plate = await importStl(plateStl(), "plate.stl");
    const join = group([kid(plate), kid(box(64, 31, 3), I(-5.25, 0, 0))]);
    const split = { ...join, mods: [{ t: "halfspace", plane: { o: [0, 0, 5], n: [0, 0, 1] }, side: -1 }] };
    K.clearCache();
    assert.equal(build1(split).mesh.meshEngine, "manifold-brep", "before");
    K.clearCache();
    const r = withDecomposeAborting(() => build1(split)); // the B-rep of the join is made by OpenCascade now
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "occt-fallback");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 8 (fix round 2): sizes far from the origin, Fill openings reports on a Manifold body, a thin enclosed cavity.
describe("a mesh far from the origin keeps its sizes", () => {
  // x, y and z are float32 here: 1000000.0625 is exact, and 1000001.125 - 1000000.0625 = 1.0625. The decimal recovery for moved meshes
  // (decimalOf) took 1000000.0625 for "1000000.06" and 1000001.125 for "1000001.1", so the cuboid came out 1.04 wide.
  const far = (x0, w, d, h) => { const c = cube(x0, 0, 0, w, d, h), t = trisOf(c); c.delete(); return t; };
  test("a 1.0625 x 1 x 1 cuboid at x = 1000000.0625, joined with a box inside it, keeps its volume (and moved with its group)", async () => {
    for (const x0 of [1000000.0625, 100000.0625, 10000.0625, 100.0625]) {
      const m = rawMesh(far(x0, 1.0625, 1, 1));
      const join = group([kid(m), kid(box(0.5, 0.5, 0.5), I(0, 0, 0.25))]);
      const r = build1(join);
      assert.ok(r.ok, `x0 ${x0}: ${r.error}`);
      assert.equal(r.mesh.meshEngine, "manifold", `x0 ${x0}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `x0 ${x0}: open and non-manifold edges`);
      approx(r.mesh.volume, 1.0625, 1e-6, `x0 ${x0}: volume`);
      // the same body moved as a group member (the operand is rebuilt from the stored corners of a Manifold result)
      const moved = build1(group([kid(join, I(0.3, 0, 0.2)), kid(box(0.25, 0.25, 0.25), I(0.3, 0, 0.45))]));
      assert.equal(moved.mesh.meshEngine, "manifold", `x0 ${x0} moved: engine (${K._test.meshBoolReason()})`);
      approx(moved.mesh.volume, 1.0625, 1e-6, `x0 ${x0} moved: volume`);
    }
  });
  // round 3: the recovered decimal may move a corner by 0.00001 mm at most, however far from the origin (values like 75000008 or
  // 524288.125 used to be pulled to a shorter decimal: 10 mm instead of 8, 1.1 instead of 1.0625)
  test("other sizes and distances keep their volume (8 x 10 x 10 at x = 75000008, 1.0625 wide at 524288.125 and 100000.1015625, a 0.1015625 span)", async () => {
    for (const [x0, w, d, h] of [[75000008, 8, 10, 10], [524288.125, 1.0625, 1, 1], [100000.1015625, 1.0625, 1, 1], [100000.1015625, 0.1015625, 1, 1]]) {
      const m = rawMesh(far(x0, w, d, h));
      const inner = Math.min(0.5, w / 2);
      const join = group([kid(m), kid(box(inner, inner, inner), I(0, 0, inner / 2))]);
      const r = build1(join);
      const tag = `x0 ${x0} w ${w}`;
      assert.ok(r.ok, `${tag}: ${r.error}`);
      assert.equal(r.mesh.meshEngine, "manifold", `${tag}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `${tag}: open and non-manifold edges`);
      approx(r.mesh.volume, w * d * h, 1e-6 * w * d * h, `${tag}: volume`);
    }
  });
  // round 4: half a float32 step is above 0.00001 mm for any coordinate above 256 mm, so the 0.00001 bound refused the recovery and a moved
  // flush join on a part 512 mm tall came out as two solids. The recovery bound is 0.0001 mm (DECIMAL_TOLERANCE): good up to 2048 mm.
  test("a 10 x 10 x H cuboid with a 5 x 5 x 10 box flush on top is one solid in place and after both move up 0.1 mm (H 512.1 and 2000.1)", async () => {
    for (const H of [512.1, 2000.1]) {
      const m = rawMesh(far(0, 10, 10, H));
      for (const dz of [0, 0.1]) {
        const r = build1(group([kid(m, I(0, 0, dz)), kid(box(5, 5, 10), I(2.5, 2.5, H + dz))]));
        const tag = `H ${H} dz ${dz}`;
        assert.ok(r.ok, `${tag}: ${r.error}`);
        assert.equal(r.mesh.meshEngine, "manifold", `${tag}: engine (${K._test.meshBoolReason()})`);
        assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `${tag}: open and non-manifold edges`);
        assert.equal(r.mesh.solidCount, 1, `${tag}: one solid`);
        approx(r.mesh.volume, 100 * H + 250, 0.05, `${tag}: volume`);
      }
    }
  });
});

describe("Fill openings reports on bodies built through Manifold", () => {
  const cyl = { t: "prim", kind: "cylinder", p: { w: 6, d: 6, h: 10 }, mods: [] };
  const fill = { t: "fillopen", id: "fill", plane: { o: [0, 0, 3], n: [0, 0, 1] }, keep: [] };
  const miniMesh = async () => importStl((await import(root + "test/fixtures/lidgen.mjs")).miniLid().stl, "mini.stl");
  const reports = K.fillReportCacheForTest;

  test("mini lid -> Fill openings -> a Combine (Manifold builds the body): the report is there, and one entry is kept", async () => {
    const mini = await miniMesh();
    const node = { ...mini, mods: [fill, { t: "bool", op: "cut", tool: box(4, 4, 6), m: I(25, 15, -1) }] };
    K.clearCache(); reports.clear();
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.ok(r.mesh.fillReports && r.mesh.fillReports.fill, "the Fill openings editor gets its report");
    assert.equal(r.mesh.fillReports.fill.filled, 6);
    assert.equal(reports.size, 1, "one report is kept after one build");
    const again = build1(node);
    assert.equal(again.mesh.fillReports.fill, r.mesh.fillReports.fill, "the next build reuses it");
    assert.equal(reports.size, 1);
    const off = K._test.withoutManifold(() => build1(node));
    assert.equal(off.mesh.fillReports.fill.filled, r.mesh.fillReports.fill.filled, "the same count as the OpenCascade build");
  });

  test("a join with a hole cylinder, then Fill openings: one report entry after one build, and a fresh report after a mesh detail change", async () => {
    const mini = await miniMesh();
    const node = { ...group([kid(mini), kid(cyl, I(12, -15, -2), true)]), mods: [fill] };
    K.clearCache(); reports.clear();
    const a = build1(node, 1);
    assert.ok(a.ok, a.error);
    assert.equal(a.mesh.meshEngine, "manifold-brep", "engine (" + K._test.meshBoolReason() + ")");
    assert.ok(a.mesh.fillReports.fill);
    assert.equal(reports.size, 1, "one report entry after one build (the fill's and the build's key are the same)");
    const b = build1(node, 4);
    assert.ok(b.ok, b.error);
    assert.notEqual(b.mesh.fillReports.fill, a.mesh.fillReports.fill, "a new detail has its own report, not the old detail's");
    assert.equal(reports.size, 2, "one entry per detail");
    const again = build1(node, 4);
    assert.equal(again.mesh.fillReports.fill, b.mesh.fillReports.fill, "a repeated build reuses the report");
    assert.equal(reports.size, 2);
  });

  test("the Pi lid -> Fill openings -> a Combine: the report is there on Manifold too", async () => {
    const lid = await importStl(readFileSync(lidFile), "pi-lid.stl");
    const f = { t: "fillopen", id: "fill", plane: { o: [39.656, 11.5548, 3], n: [0, 0, 1] }, keep: [] };
    const node = { ...lid, mods: [f, { t: "bool", op: "cut", tool: box(4, 4, 6), m: I(-44, -29, -1) }] };
    K.clearCache(); reports.clear();
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.ok(r.mesh.fillReports && r.mesh.fillReports.fill, "report");
    assert.equal(reports.size, 1);
  });
});

describe("a thin enclosed cavity is a cavity, not a film", () => {
  test("a 10 mm cube minus an enclosed 8 x 8 x 0.0005 mm box: the cavity stays (999.968), in one piece, as Manifold computes it", async () => {
    const c = await importStl(cubeStl(), "cube.stl");
    const slab = cube(-4, -4, 0, 8, 8, 0.0005), thin = await importStl(stlOf(trisOf(slab)), "thin.stl"); // a mesh: an app box is never thinner than 0.01 mm
    slab.delete();
    const node = group([kid(c), kid(thin, I(0, 0, 4.99975), true)]);
    const r = build1(node);
    assert.ok(r.ok, r.error);
    assert.equal(r.mesh.meshEngine, "manifold", "engine (" + K._test.meshBoolReason() + ")");
    assert.equal(r.mesh.solidCount, 1, "the cavity is not a piece");
    approx(r.mesh.volume, 1000 - 8 * 8 * 0.0005, 1e-4, "display volume");
    const shape = K.evalNode(node);
    approx(K._test.safeVolume(shape), 1000 - 8 * 8 * 0.0005, 1e-3, "lazy B-rep volume");
    shape.delete();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Block 9 (fine detail): at Fine and Extra fine, a hole shaped like a very thin oval through the joined Pi lid went to OpenCascade (1-10 s).
// The oval's tip puts tessellation vertices about 1e-6 mm apart, Manifold's cut points there round to one float32, and the result was pinched by position.
describe("a sharp curve at Fine detail stays on Manifold", () => {
  const nodeAt = (join, tool, x) => group([kid(join), kid(tool, I(x, 0, -5), true)]);
  // a 0.01 x 12 mm oval, what `p: { d: 12 }` without a width gives (the width clamps to 0.01 mm)
  const oval = { t: "prim", kind: "cylinder", p: { w: 0.01, d: 12, h: 20 }, mods: [] };
  const round = { t: "prim", kind: "cylinder", p: { w: 12, d: 12, h: 20 }, mods: [] };
  // OpenCascade's volumes of these holes through the joined lid (K._test.withoutManifold, measured 2026-10-28). To re-measure one, build the
  // same node inside K._test.withoutManifold after K.clearCache() (the lid's B-rep alone takes over 20 s, which is why they are recorded here).
  const OCCT = {
    oval: { 2: { [-30]: 18261.07888, [-12]: 18261.07888, 6: 18261.07887, 24: 18261.07887 }, 4: { [-30]: 18261.07888, 24: 18261.07887 } },
    round: { 2: { [-30]: 17922.06961, 24: 17922.09761 } },
  };
  let join;
  before(async () => { join = group([kid(await importStl(readFileSync(lidFile), "pi-lid.stl")), kid(box(64, 31, 3), I(-5.25, 0, 0))]); });

  test("at Fine, a 0.01 x 12 mm oval hole at 20 places through the joined Pi lid stays on Manifold: closed, one piece, quick", () => {
    const joinVol = build1(join, 2).mesh.volume, times = [];
    for (let x = -30; x <= 27; x += 3) {
      const r = build1(nodeAt(join, oval, x), 2);
      assert.ok(r.ok, `x ${x}: ${r.error}`);
      assert.equal(r.mesh.meshEngine, "manifold", `x ${x}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(r.mesh), { open: 0, nonManifold: 0 }, `x ${x}: open and non-manifold edges`);
      assert.equal(r.mesh.solidCount, 1, `x ${x}: one piece`);
      assert.ok(r.ms < 5000, `x ${x}: took ${r.ms.toFixed(0)} ms`);
      assert.ok(joinVol - r.mesh.volume > 0, `x ${x}: it really cut`);
      times.push(r.ms);
    }
    console.log(`meshbool-timing: fine oval holes: max ${Math.max(...times).toFixed(0)} ms, mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} ms`);
  });

  test("... and its volume is OpenCascade's (Fine and Extra fine)", () => {
    let worst = 0, worstRemoved = 0;
    for (const q of [2, 4]) {
      const joinVol = build1(join, q).mesh.volume;
      for (const [x, want] of Object.entries(OCCT.oval[q])) {
        const mf = build1(nodeAt(join, oval, +x), q);
        assert.equal(mf.mesh.meshEngine, "manifold", `q ${q}, x ${x}: engine (${K._test.meshBoolReason()})`);
        const rel = Math.abs(mf.mesh.volume - want) / want;
        const removedMf = joinVol - mf.mesh.volume, removedOcct = joinVol - want;
        worst = Math.max(worst, rel); worstRemoved = Math.max(worstRemoved, Math.abs(removedMf - removedOcct) / removedOcct);
        assert.ok(rel <= 1e-3, `q ${q}, x ${x}: volume ${mf.mesh.volume} vs OpenCascade ${want} (${(rel * 100).toFixed(4)} %)`);
        assert.ok(Math.abs(removedMf - removedOcct) <= 0.02 * removedOcct, `q ${q}, x ${x}: removed ${removedMf} vs OpenCascade ${removedOcct}`);
      }
    }
    console.log(`meshbool-volume: oval holes vs OpenCascade: max volume difference ${(worst * 100).toExponential(2)} %, max removed-volume difference ${(worstRemoved * 100).toFixed(3)} %`);
  });

  test("[guard] round 12 mm holes at Fine stay on Manifold with OpenCascade's volume", () => {
    const joinVol = build1(join, 2).mesh.volume;
    for (const [x, want] of Object.entries(OCCT.round[2])) {
      const mf = build1(nodeAt(join, round, +x), 2);
      assert.equal(mf.mesh.meshEngine, "manifold", `x ${x}: engine (${K._test.meshBoolReason()})`);
      assert.deepEqual(edgeCheck(mf.mesh), { open: 0, nonManifold: 0 }, `x ${x}: open and non-manifold edges`);
      approx(mf.mesh.volume, want, 1e-3 * want, `x ${x}: volume against OpenCascade`);
      approx(joinVol - mf.mesh.volume, joinVol - want, 0.01 * (joinVol - want), `x ${x}: removed volume against OpenCascade's`);
    }
  });
});
