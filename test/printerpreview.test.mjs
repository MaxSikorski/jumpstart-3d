// The overhang overlay's lifecycle in src/printerpreview.js, with real three.js objects and no browser (node --test; part of
// npm test's pretest list). A small stand-in for the page supplies what the module touches: scene views, one DOM element, localStorage.
// What it proves: the overlay shares the body's position buffer and never touches the body mesh; undersides get red triangles and
// nothing else does; a change hides the old result until the new one is done; an older job never attaches; camera-only refreshes start
// no work; teardown removes and disposes everything it made; a large mesh waits for "Analyse this mesh".
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { printsimStub } from "./printsim-rows.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
function node(tag) {
  const n = { tag, children: [], dataset: {}, style: {}, attrs: {}, listeners: {}, hidden: false, nodeType: 1,
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, remove() {}, append(...k) { this.children.push(...k); }, focus() {},
    set textContent(v) { this.children = []; if (v) this.children.push({ nodeType: 3, data: String(v) }); }, get textContent() { return this.children.map((c) => c.data ?? c.textContent).join(""); } };
  return n;
}
const viewportEl = node("div");
globalThis.document = { getElementById: (id) => (id === "viewport" ? viewportEl : null), createElement: node, createTextNode: (t) => ({ nodeType: 3, data: t }) };

const bundle = await build({
  stdin: { contents: 'import "./src/printsim.js"; export { initPrinterPreview } from "./src/printerpreview.js"; export { getPlatePref, setPlatePref } from "./src/printerpresets.js"; export * as THREE from "three";', resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "node", alias: { three: root + "third_party/three/build/three.module.js" }, plugins: [printsimStub],
});
const { initPrinterPreview, getPlatePref, setPlatePref, THREE } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

// ---- a stand-in app. Meshes are real three.js meshes inside a group, as BodyView makes them.
function makeApp() {
  const views = new Map();
  const vp = { requests: 0, plate: null, request() { this.requests++; }, setPlateSize(w, d) { this.plate = [w, d]; } };
  const app = { vp, mode: "beginner", simLock: false, section: null, projector: null, scene: { views, state: { ghost: new Set(), pose: new Map() } } };
  return app;
}
let created = 0, disposed = 0;
function addBody(app, id, pos, idx, m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial()), group = new THREE.Group();
  group.matrixAutoUpdate = false; group.matrix.fromArray(m); group.add(mesh);
  const v = { body: { id, name: id, hole: false }, mesh, group, data: { vertices: geo.getAttribute("position").array, triangles: geo.getIndex().array }, pending: false };
  app.scene.views.set(id, v);
  return v;
}
// a lifted slab: the top (up) and bottom (down) of a 10 x 10 square 5 mm up, and a wall (vertical) -> 3 triangles: bottom, top, wall
const SLAB = [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5, /* wall at y=0 */ 0, 0, 5, 10, 0, 5, 10, 0, 10];
//   bottom (0,1,2) faces -z: counter-clockwise seen from below => winding 0,2,1; top 0,1,2 faces +z; wall (4,5,6): normal -y
const SLAB_IDX = [0, 2, 1, 0, 1, 2, 4, 5, 6];
// n downward triangles in a flat grid (every other one faces up), 5 mm up
function bigMesh(n) {
  const pos = new Float32Array(n * 9), idx = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) { const x = (i % 1000) * 2, y = Math.floor(i / 1000) * 2; pos.set([x, y, 5, x + 1, y, 5, x, y + 1, 5], i * 9); idx.set(i % 2 ? [i * 3, i * 3 + 1, i * 3 + 2] : [i * 3, i * 3 + 2, i * 3 + 1], i * 3); }
  return { pos, idx };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(pv, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { await wait(15); if (pv.entries().every((e) => e.state === "done" || e.state === "needs")) return; } throw new Error("analysis did not finish"); }
const overlays = (v) => v.group.children.filter((c) => c.userData.overhang);
function fresh() {
  store.clear();
  setPlatePref({ printer: "generic", shade: false, angle: 45 }); // the saved choice is shared by every app made here; start each test from the defaults
  const app = makeApp(); const pv = initPrinterPreview(app); app.plateView = pv;
  return { app, pv };
}

test("shading off draws nothing; on, the lifted underside is red and nothing else is", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  pv.update(); await wait(100);
  assert.equal(overlays(v).length, 0);
  setPlatePref({ shade: true }); // the preference listener calls update()
  await settle(pv);
  const [o] = overlays(v);
  assert.ok(o, "an overlay was made");
  assert.equal(o.geometry.getIndex().count, 3, "exactly one triangle (the bottom)");
  assert.deepEqual([...o.geometry.getIndex().array], [0, 2, 1]);
  assert.equal(o.geometry.getAttribute("position"), v.mesh.geometry.getAttribute("position"), "the position buffer is the body's own");
  assert.equal(o.visible, true);
  assert.equal(o.raycast.length, 0, "it can never be picked");
});

test("the body's mesh is read, never written", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  const before = { pos: [...v.mesh.geometry.getAttribute("position").array], idx: [...v.mesh.geometry.getIndex().array], mat: v.mesh.material, groups: v.mesh.geometry.groups.length, attrs: Object.keys(v.mesh.geometry.attributes) };
  setPlatePref({ shade: true }); await settle(pv);
  setPlatePref({ angle: 20 }); await settle(pv);
  setPlatePref({ shade: false }); await wait(50);
  assert.deepEqual([...v.mesh.geometry.getAttribute("position").array], before.pos);
  assert.deepEqual([...v.mesh.geometry.getIndex().array], before.idx);
  assert.equal(v.mesh.material, before.mat);
  assert.equal(v.mesh.geometry.groups.length, before.groups);
  assert.deepEqual(Object.keys(v.mesh.geometry.attributes), before.attrs);
  assert.ok(v.mesh.geometry.getAttribute("position"), "still has its position buffer after the overlay was removed");
  assert.equal(v.group.children.length, 1);
});

test("turning it off, and many on/off rounds, leave nothing behind and dispose what was made", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  const geos = [];
  const origAdd = v.group.add.bind(v.group);
  v.group.add = (c) => { if (c.userData.overhang) { geos.push(c.geometry); c.geometry.addEventListener("dispose", () => disposed++); created++; } return origAdd(c); };
  for (let i = 0; i < 5; i++) {
    setPlatePref({ shade: true }); await settle(pv);
    assert.equal(overlays(v).length, 1);
    setPlatePref({ shade: false });
    assert.equal(overlays(v).length, 0);
    assert.equal(pv.entries().length, 0);
  }
  assert.equal(created, 5);
  assert.equal(disposed, 5, "every overlay geometry was disposed");
  for (const g of geos) assert.equal(g.getAttribute("position"), undefined, "and let go of the body's position buffer first");
});

test("a camera move starts no analysis; a body move or a new angle does", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  setPlatePref({ shade: true }); await settle(pv);
  const jobs = pv.stats.jobs;
  for (let i = 0; i < 20; i++) pv.update(); // refreshes with nothing changed (hover, camera...)
  await wait(150);
  assert.equal(pv.stats.jobs, jobs);
  v.group.matrix.elements[14] = 20; pv.update();
  assert.equal(overlays(v)[0].visible, false, "the old result is hidden the moment something changed");
  await settle(pv);
  assert.equal(pv.stats.jobs, jobs + 1);
  assert.equal(overlays(v)[0].visible, true);
  setPlatePref({ angle: 30 }); await settle(pv);
  assert.equal(pv.stats.jobs, jobs + 2);
});

test("the angle decides: a 50 degree lean is shaded at 40 and not at 60", async () => {
  const { app, pv } = fresh();
  // one triangle leaning 50 degrees out from upright, 10 mm up: outward normal (cos50, 0, -sin50)
  const a = (50 * Math.PI) / 180, n = [Math.cos(a), 0, -Math.sin(a)], u = [0, 1, 0], w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const p = [0, 0, 10, ...u.map((q, i) => [0, 0, 10][i] + q * 5), ...w.map((q, i) => [0, 0, 10][i] + q * 5)];
  // make sure u x v points along n: pick the winding by the sign
  const cr = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const v1 = p.slice(3, 6).map((q, i) => q - p[i]), v2 = p.slice(6, 9).map((q, i) => q - p[i]);
  const idx = cr(v1, v2).reduce((s, q, i) => s + q * n[i], 0) > 0 ? [0, 1, 2] : [0, 2, 1];
  const v = addBody(app, "b", p, idx);
  setPlatePref({ shade: true, angle: 40 }); await settle(pv);
  assert.equal(overlays(v).length, 1, "shaded at 40");
  setPlatePref({ angle: 60 }); await settle(pv);
  assert.equal(overlays(v).length, 0, "clear at 60");
});

test("an older job never attaches its result after a newer change", async () => {
  const { app, pv } = fresh();
  const n = 2400000, { pos, idx } = bigMesh(n);
  pv.largeTriangles = 1e9; // this test is about slicing, not the opt-in
  const v = addBody(app, "b", pos, idx);
  setPlatePref({ shade: true, angle: 10 });
  const t0 = Date.now();
  while (pv.stats.chunks < 1 && Date.now() - t0 < 5000) await wait(5); // the first job has run one slice and is waiting for the next
  assert.equal(pv.entries()[0].state, "working");
  const first = pv.stats.jobs;
  setPlatePref({ angle: 80 }); // supersedes it
  await settle(pv, 60000);
  assert.ok(pv.stats.jobs >= first + 1);
  assert.ok(pv.stats.cancelled >= 1, "the superseded job was cancelled");
  assert.equal(overlays(v).length, 1);
  assert.equal(overlays(v)[0].geometry.getIndex().count, (n / 2) * 3);
  assert.equal(pv.entries()[0].state, "done");
});

test("hidden, hole and preview bodies get none, and nothing stays when a body goes away", async () => {
  const { app, pv } = fresh();
  const a = addBody(app, "a", SLAB, SLAB_IDX), b = addBody(app, "b", SLAB, SLAB_IDX), c = addBody(app, "c", SLAB, SLAB_IDX), d = addBody(app, "d", SLAB, SLAB_IDX);
  b.body.hole = true; c.group.visible = false; d.body.cmdPreview = true;
  setPlatePref({ shade: true }); await settle(pv);
  assert.deepEqual([a, b, c, d].map((v) => overlays(v).length), [1, 0, 0, 0]);
  app.scene.views.delete("a"); pv.update();
  assert.equal(overlays(a).length, 0);
  assert.equal(pv.entries().length, 0);
});

test("the print sim, section analysis and the projector hide it; ending them brings it back without a duplicate", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  setPlatePref({ shade: true }); await settle(pv);
  for (const [on, off] of [[() => { app.simLock = true; }, () => { app.simLock = false; }], [() => { app.section = { info: {} }; }, () => { app.section = null; }], [() => { app.projector = { isOpen: true }; }, () => { app.projector = null; }], [() => { app.mode = "arch"; }, () => { app.mode = "beginner"; }]]) {
    on(); pv.update();
    assert.equal(overlays(v).length, 0, "hidden");
    off(); pv.update(); await settle(pv);
    assert.equal(overlays(v).length, 1, "back, once");
  }
});

test("the plate follows the choice: MK4 is 250 x 210, none draws nothing, and nothing is moved", async () => {
  const { app } = fresh();
  assert.deepEqual(app.vp.plate, [256, 256]);
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  const m = [...v.group.matrix.elements];
  setPlatePref({ printer: "mk4" }); assert.deepEqual(app.vp.plate, [250, 210]);
  setPlatePref({ printer: "u1" }); assert.deepEqual(app.vp.plate, [270, 270]);
  setPlatePref({ printer: "none" }); assert.deepEqual(app.vp.plate, [0, 0]);
  setPlatePref({ printer: "generic" }); assert.deepEqual(app.vp.plate, [256, 256]);
  assert.deepEqual([...v.group.matrix.elements], m);
});

test("a large mesh waits for Analyse this mesh, then runs", async () => {
  const { app, pv } = fresh();
  const v = addBody(app, "b", SLAB, SLAB_IDX);
  pv.largeTriangles = 2; // a measured starting figure of 1,000,000 in the app; lowered here
  setPlatePref({ shade: true }); await wait(150);
  assert.equal(pv.stats.jobs, 0, "no work was started");
  assert.equal(overlays(v).length, 0);
  assert.equal(pv.entries()[0].state, "needs");
  assert.equal(viewportEl.children.at(-1).dataset.state, "needs");
  const btn = viewportEl.children.at(-1).children.find((c) => c.attrs && c.attrs.id === "overhang-analyse");
  assert.ok(btn, "the chip offers the button");
  btn.listeners.click();
  await settle(pv);
  assert.equal(pv.stats.jobs, 1);
  assert.equal(overlays(v).length, 1);
});

test("a big mesh is analysed in short slices while the page keeps breathing", async () => {
  const { app, pv } = fresh();
  const n = 2400000, { pos, idx } = bigMesh(n);
  pv.largeTriangles = 1e9; // this test is about slicing, not the opt-in
  const v = addBody(app, "b", pos, idx);
  let beats = 0; const hb = setInterval(() => beats++, 5);
  const t0 = Date.now();
  setPlatePref({ shade: true }); await settle(pv, 60000);
  clearInterval(hb);
  console.log(`# ${n} triangles: ${Date.now() - t0} ms in all, ${pv.stats.chunks} slices, longest slice ${pv.stats.longestChunkMs.toFixed(1)} ms, ${beats} heartbeats`);
  assert.ok(pv.stats.chunks > 5, "worked in slices");
  assert.ok(beats > 5, "the event loop kept turning meanwhile");
  assert.equal(overlays(v)[0].geometry.getIndex().count, (n / 2) * 3);
});
