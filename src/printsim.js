// 3D Print Sim: lays the design on a printer's plate and simulates printing it, in the
// spirit of a slicer preview (Orca Slicer): layers with walls, infill and top/bottom skins,
// overhangs, normal or tree supports, a strength / weak-point map and print estimates.
// It never makes G-code: it is a preview to learn from, not a slicer.
import * as THREE from "three";
import { store, findBody } from "./store.js";
import { el, fmt } from "./util.js";
import { M4 } from "./ops.js";
import { FILAMENTS } from "./fea.js";

// Printers and how they handle more than one filament (like Orca Slicer's printer profiles):
//   tools.kind  "single"  one nozzle, one filament (swap by hand)
//               "mmu"     one nozzle fed by a spool switcher (AMS, CFS, Canvas, IFS, MMU3):
//                         every change unloads, loads and purges ("flushes") the old color
//               "heads"   independent toolheads / nozzles (tool changers, dual nozzle, Vortek):
//                         each filament keeps its own nozzle, so a change is a quick swap with
//                         only a small prime; more filaments than heads share a head (and flush)
//   heads: nozzles that can hold different filaments, slots: most filaments at once,
//   swap: seconds per head change, load: seconds to unload + load a spool (purge time is added),
//   prime: mm³ primed after a head swap, wSingle / wDual: printable width with one / both
//   nozzles (dual-nozzle printers), sys: what it's called.
export const PRINTERS = {
  // Bambu Lab
  a1mini: { brand: "Bambu Lab", name: "Bambu Lab A1 mini", w: 180, d: 180, h: 180, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a1: { brand: "Bambu Lab", name: "Bambu Lab A1", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 30, sys: "AMS lite" } },
  a2l: { brand: "Bambu Lab", name: "Bambu Lab A2L", w: 330, d: 320, h: 325, tools: { kind: "mmu", heads: 1, slots: 19, load: 30, sys: "AMS lite + AMS units" } },
  p1s: { brand: "Bambu Lab", name: "Bambu Lab P1S / P1P", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  p2s: { brand: "Bambu Lab", name: "Bambu Lab P2S", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 22, sys: "AMS 2 Pro" } },
  x1: { brand: "Bambu Lab", name: "Bambu Lab X1 Carbon / X1E", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 16, load: 25, sys: "AMS" } },
  x2d: { brand: "Bambu Lab", name: "Bambu Lab X2D (dual nozzle)", w: 256, d: 256, h: 260, tools: { kind: "heads", heads: 2, slots: 16, swap: 12, prime: 30, load: 25, lr: true, sys: "dual nozzle + AMS" } },
  h2s: { brand: "Bambu Lab", name: "Bambu Lab H2S", w: 340, d: 320, h: 340, tools: { kind: "mmu", heads: 1, slots: 24, load: 25, sys: "AMS 2 Pro / AMS HT" } },
  h2d: { brand: "Bambu Lab", name: "Bambu Lab H2D / H2D Pro (dual nozzle)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 2, slots: 24, swap: 12, prime: 30, load: 25, lr: true, wSingle: 325, wDual: 300, sys: "dual nozzle + AMS" } },
  h2c: { brand: "Bambu Lab", name: "Bambu Lab H2C (Vortek, 7 hotends)", w: 350, d: 320, h: 325, tools: { kind: "heads", heads: 7, slots: 24, swap: 25, prime: 15, load: 25, wSingle: 325, wDual: 300, sys: "Vortek hotend swapping (1 left + 6 right) + AMS" } },
  // Creality
  ender3: { brand: "Creality", name: "Creality Ender-3", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1: { brand: "Creality", name: "Creality K1 / K1C / K1 SE", w: 220, d: 220, h: 250, tools: { kind: "single" } },
  k1max: { brand: "Creality", name: "Creality K1 Max", w: 300, d: 300, h: 300, tools: { kind: "single" } },
  k2se: { brand: "Creality", name: "Creality K2 SE", w: 220, d: 215, h: 245, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2: { brand: "Creality", name: "Creality K2", w: 260, d: 260, h: 260, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2pro: { brand: "Creality", name: "Creality K2 Pro", w: 300, d: 300, h: 300, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  k2plus: { brand: "Creality", name: "Creality K2 Plus", w: 350, d: 350, h: 350, tools: { kind: "mmu", heads: 1, slots: 16, load: 40, sys: "CFS" } },
  // Elegoo
  cc: { brand: "Elegoo", name: "Elegoo Centauri Carbon", w: 256, d: 256, h: 256, tools: { kind: "single" } },
  cc2: { brand: "Elegoo", name: "Elegoo Centauri Carbon 2", w: 256, d: 256, h: 256, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "CANVAS" } },
  // Flashforge
  ff5m: { brand: "Flashforge", name: "Flashforge Adventurer 5M / 5M Pro", w: 220, d: 220, h: 220, tools: { kind: "single" } },
  ffad5x: { brand: "Flashforge", name: "Flashforge AD5X", w: 220, d: 220, h: 220, tools: { kind: "mmu", heads: 1, slots: 4, load: 45, sys: "IFS" } },
  creator5: { brand: "Flashforge", name: "Flashforge Creator 5 (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer" } },
  creator5pro: { brand: "Flashforge", name: "Flashforge Creator 5 Pro (4 toolheads)", w: 256, d: 256, h: 256, tools: { kind: "heads", heads: 4, slots: 4, swap: 10, prime: 15, sys: "4-toolhead tool changer, heated chamber" } },
  // Prusa
  mini: { brand: "Prusa", name: "Prusa MINI+", w: 180, d: 180, h: 180, tools: { kind: "single" } },
  mk4: { brand: "Prusa", name: "Prusa MK4S (+ MMU3)", w: 250, d: 210, h: 220, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1: { brand: "Prusa", name: "Prusa CORE One (+ MMU3)", w: 250, d: 220, h: 270, tools: { kind: "mmu", heads: 1, slots: 5, load: 30, sys: "MMU3" } },
  core1l: { brand: "Prusa", name: "Prusa CORE One L", w: 300, d: 300, h: 330, tools: { kind: "single" } },
  core1lindx4: { brand: "Prusa", name: "Prusa CORE One L INDX (4 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 4, slots: 4, swap: 12, prime: 10, sys: "INDX tool changer" } },
  core1lindx8: { brand: "Prusa", name: "Prusa CORE One L INDX (8 tools)", w: 298, d: 275, h: 330, tools: { kind: "heads", heads: 8, slots: 8, swap: 12, prime: 10, sys: "INDX tool changer" } },
  xl1: { brand: "Prusa", name: "Prusa XL (1 toolhead)", w: 360, d: 360, h: 360, tools: { kind: "single" } },
  xl2: { brand: "Prusa", name: "Prusa XL (2 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 2, slots: 2, swap: 10, prime: 15, sys: "tool changer" } },
  xl5: { brand: "Prusa", name: "Prusa XL (5 toolheads)", w: 360, d: 360, h: 360, tools: { kind: "heads", heads: 5, slots: 5, swap: 10, prime: 15, sys: "tool changer" } },
  // Snapmaker
  u1: { brand: "Snapmaker", name: "Snapmaker U1 (4 toolheads)", w: 270, d: 270, h: 270, tools: { kind: "heads", heads: 4, slots: 4, swap: 5, prime: 15, sys: "SnapSwap tool changer" } },
  // Voron
  voron: { brand: "Voron", name: "Voron 2.4 350", w: 350, d: 350, h: 340, tools: { kind: "single" } },
};
const PURGE_FLOW = 12; // mm³/s a nozzle purges at while flushing
// Orca-style flushing volume (mm³) from one color to the next: more when going from dark to
// light, and more the more different the colors are
function flushVolume(from, to) {
  const rgb = (hex) => { const c = new THREE.Color(hex || "#808080"); return [c.r, c.g, c.b]; };
  const a = rgb(from), b = rgb(to);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const dl = Math.max(0, lum(b) - lum(a));
  const dc = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.sqrt(3);
  return 140 + 520 * dl + 160 * dc;
}
// typical max volumetric flow (mm³/s) and speeds for a standard 0.4 mm nozzle profile
const FLOW = { pla: 18, plaplus: 16, petg: 12, abs: 15, asa: 14, nylon: 10, pc: 10, cfpla: 12, cfnylon: 9, peek: 6, tpu: 4 };
const COL = {
  outer: 0xff8000, inner: 0xffd400, sparse: 0xb03029, solid: 0x9654cc, top: 0xf04040, bottom: 0x5a9ee6, bridge: 0x4d80ba, support: 0x1fb85a,
};
const LEGEND = [["outer", "Outer wall"], ["inner", "Inner wall"], ["sparse", "Sparse infill"], ["solid", "Solid infill"], ["top", "Top surface"], ["bottom", "Bottom surface"], ["bridge", "Bridge"], ["support", "Support"]];
const LW = 0.42; // line width for a 0.4 mm nozzle
const SPEEDS = { outer: 150, inner: 220, sparse: 270, solid: 220, top: 180, bottom: 60, bridge: 50 }; // mm/s

export function initPrintSim(app, X) {
  const { vp, scene, openCmd, closeCmd, row, seg, sliderRow } = X;
  const st = {
    printer: "x1", filament: "pla", layer: 0.2, walls: 2, infill: 15, topN: 4, botN: 3,
    supports: "none", threshold: 45, plateOnly: false, view: "model", R: new THREE.Matrix4(), ids: [],
    pickFace: false, layerMax: 0,
    // filaments: slots[i] = { color }, and the slot each body prints with (grouped by color at first)
    slots: [], slotOf: new Map(), colorBy: "auto",
    // color painting: faces painted with a filament; tool: null | "paint" | "fill" | "erase"
    paint: new Map(), paintTool: null, brush: 0,
  };
  const root = new THREE.Group(); root.visible = false; vp.world.add(root);
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9); // keeps z below the shown layer
  vp.renderer.localClippingEnabled = true;
  const plateG = new THREE.Group(), supG = new THREE.Group(), ovG = new THREE.Group(), layG = new THREE.Group(), strG = new THREE.Group();
  root.add(plateG, supG, ovG, layG, strG);
  let W = null; // world geometry of the plate
  let A = null; // analysis (overhangs, supports)
  let S = null; // slice result
  let sliceJob = 0, slider = null, legendEl = null;

  const disposeGroup = (g) => { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); } };

  // ------------------------------------------------------------ plate
  function buildPlate() {
    disposeGroup(plateG);
    const P = PRINTERS[st.printer], dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d), new THREE.MeshBasicMaterial({ color: dark ? 0x3a424c : 0xd5dbe1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    plate.position.z = -0.02;
    plateG.add(plate);
    const pts = [];
    for (let x = -P.w / 2; x <= P.w / 2 + 1e-6; x += 10) pts.push(new THREE.Vector3(x, -P.d / 2, 0), new THREE.Vector3(x, P.d / 2, 0));
    for (let y = -P.d / 2; y <= P.d / 2 + 1e-6; y += 10) pts.push(new THREE.Vector3(-P.w / 2, y, 0), new THREE.Vector3(P.w / 2, y, 0));
    plateG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: dark ? 0x56606c : 0xb3bcc6 })));
    const box = new THREE.Box3(new THREE.Vector3(-P.w / 2, -P.d / 2, 0), new THREE.Vector3(P.w / 2, P.d / 2, P.h));
    const bh = new THREE.Box3Helper(box, dark ? 0x7d8996 : 0x8e99a5);
    bh.material.transparent = true; bh.material.opacity = 0.45;
    plateG.add(bh);
    // dual-nozzle printers: the width both nozzles (or one) can actually reach
    const uw = usableWidth();
    if (uw < P.w) {
      const u = new THREE.Box3(new THREE.Vector3(-uw / 2, -P.d / 2, 0), new THREE.Vector3(uw / 2, P.d / 2, 0.05));
      const uh = new THREE.Box3Helper(u, 0x2f7de1);
      plateG.add(uh);
    }
  }
  function usableWidth() {
    const P = PRINTERS[st.printer], T = P.tools || {};
    if (!T.wSingle) return P.w;
    ensureSlots();
    const heads = new Set(usedSlots().map(headOf)).size;
    return heads > 1 ? T.wDual : T.wSingle;
  }

  // ------------------------------------------------------------ the parts on the plate
  function targetIds() {
    const sel = app.sel.map((id) => findBody(store.doc, id)).filter((b) => b && !b.hole);
    const list = sel.length ? sel : store.doc.bodies.filter((b) => !b.hole && !b.hidden);
    return list.map((b) => b.id);
  }
  // world triangles of the parts after the sim orientation, dropped on the plate and centred
  function buildWorld() {
    const parts = [];
    for (const id of st.ids) {
      const b = findBody(store.doc, id), v = scene.views.get(id);
      if (!b || !v || !v.data) continue;
      parts.push({ id, data: v.data, M: st.R.clone().multiply(M4(b.m)) });
    }
    if (!parts.length) return null;
    // bodies that touch or overlap stay together as one object (like a multi-color model:
    // letters on a plate, a two-color part); each separate object rests on the plate. The
    // layout is kept and centred on the plate.
    const box = new THREE.Box3(), t = new THREE.Vector3();
    for (const p of parts) {
      const bk = new THREE.Box3(), V = p.data.vertices;
      for (let i = 0; i < V.length; i += 3) bk.expandByPoint(t.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(p.M));
      p.bk = bk;
    }
    const grp = parts.map((_, i) => i);
    const find = (i) => (grp[i] === i ? i : (grp[i] = find(grp[i])));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (parts[i].bk.clone().expandByScalar(0.05).intersectsBox(parts[j].bk)) grp[find(i)] = find(j);
    const low = new Map();
    parts.forEach((p, i) => { const g = find(i); low.set(g, Math.min(low.has(g) ? low.get(g) : Infinity, p.bk.min.z)); });
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.dz = -low.get(find(i));
      box.union(p.bk.clone().translate(new THREE.Vector3(0, 0, p.dz)));
    }
    const c = box.getCenter(new THREE.Vector3());
    let nV = 0, nT = 0;
    for (const p of parts) { nV += p.data.vertices.length / 3; nT += p.data.triangles.length / 3; }
    const pos = new Float32Array(nV * 3), tri = new Uint32Array(nT * 3), owner = new Uint16Array(nT), tface = new Int32Array(nT);
    let ov = 0, ot = 0;
    const pose = new Map();
    parts.forEach((p, k) => {
      const T = new THREE.Matrix4().makeTranslation(-c.x, -c.y, p.dz);
      pose.set(p.id, T.clone().multiply(st.R));
      const M = T.clone().multiply(p.M), V = p.data.vertices, Tr = p.data.triangles;
      const flip = M.determinant() < 0;
      for (let i = 0; i < V.length; i += 3) { t.set(V[i], V[i + 1], V[i + 2]).applyMatrix4(M); pos[(ov + i / 3) * 3] = t.x; pos[(ov + i / 3) * 3 + 1] = t.y; pos[(ov + i / 3) * 3 + 2] = t.z; }
      // which CAD face each triangle belongs to (faces are what gets painted)
      const fOf = new Int32Array(Tr.length / 3).fill(-1);
      (p.data.faceGroups || []).forEach(([st0, cnt], fi) => { for (let q = st0 / 3; q < (st0 + cnt) / 3; q++) fOf[q] = fi; });
      for (let i = 0; i < Tr.length; i += 3) {
        tri[ot * 3] = Tr[i] + ov; tri[ot * 3 + 1] = (flip ? Tr[i + 2] : Tr[i + 1]) + ov; tri[ot * 3 + 2] = (flip ? Tr[i + 1] : Tr[i + 2]) + ov;
        owner[ot] = k; tface[ot] = fOf[i / 3]; ot++;
      }
      ov += V.length / 3;
    });
    const size = box.getSize(new THREE.Vector3());
    const vowner = new Uint16Array(nV);
    for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) vowner[tri[t * 3 + e]] = owner[t];
    return { pos, tri, owner, tface, vowner, nParts: parts.length, ids: parts.map((p) => p.id), names: parts.map((p) => findBody(store.doc, p.id)?.name || "Body"), pose, size, nT };
  }

  // ------------------------------------------------------------ vertical-ray lookups
  function makeGrid(w) {
    const { pos, tri, nT } = w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); }
    const cell = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, nT)) * 2);
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
    const buckets = Array.from({ length: nx * ny }, () => []);
    for (let t = 0; t < nT; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const i0 = Math.floor((Math.min(pos[a], pos[b], pos[c]) - x0) / cell), i1 = Math.floor((Math.max(pos[a], pos[b], pos[c]) - x0) / cell);
      const j0 = Math.floor((Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - y0) / cell), j1 = Math.floor((Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) - y0) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * nx + i].push(t);
    }
    // every crossing of the vertical line at (x, y): {z, up (surface faces up), t}
    function hits(x, y) {
      const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return [];
      const out = [];
      for (const t of buckets[j * nx + i]) {
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
        const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        out.push({ z: l1 * pos[a + 2] + l2 * pos[b + 2] + l3 * pos[c + 2], up: d > 0, t });
      }
      out.sort((p, q) => p.z - q.z);
      // drop duplicates where the line passes exactly through a shared edge
      return out.filter((h, k) => k === 0 || Math.abs(h.z - out[k - 1].z) > 1e-5 || h.up !== out[k - 1].up);
    }
    return { hits, x0, y0, x1, y1 };
  }

  // ------------------------------------------------------------ overhangs and supports
  function analyse() {
    const w = W, { pos, tri, nT } = w;
    const cosT = Math.cos((st.threshold * Math.PI) / 180);
    const over = new Uint8Array(nT), nrm = new Float32Array(nT * 3);
    let overArea = 0, bedArea = 0;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const grid = makeGrid(w);
    // an underside resting on another body (a part stacked on another) needs no support
    const restsOnPart = (t, a, b, c) => {
      const cx = (pos[a] + pos[b] + pos[c]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      return grid.hits(cx, cy).some((h) => h.up && h.t !== t && w.owner[h.t] !== w.owner[t] && h.z <= cz + 0.05 && h.z >= cz - Math.max(0.3, st.layer));
    };
    for (let t = 0; t < nT; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      e1.set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      e2.set(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
      n.crossVectors(e1, e2);
      const ar = n.length() / 2;
      if (ar < 1e-12) continue;
      n.normalize();
      nrm[t * 3] = n.x; nrm[t * 3 + 1] = n.y; nrm[t * 3 + 2] = n.z;
      const zmax = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
      if (zmax < 0.05 && n.z < -0.98) { bedArea += ar; continue; }
      if (-n.z > cosT && Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) > st.layer * 0.5 && !(w.nParts > 1 && restsOnPart(t, a, b, c))) { over[t] = 1; overArea += ar; }
    }
    // support columns: under every overhang, from the plate (or the part below) up to it
    const sp = st.supports === "tree" ? 3 : 2, zgap = st.layer;
    const cols = [];
    if (st.supports !== "none" && overArea > 0) {
      for (let y = grid.y0 + sp / 2; y <= grid.y1; y += sp) for (let x = grid.x0 + sp / 2; x <= grid.x1; x += sp) {
        const hs = grid.hits(x, y);
        let below = 0, inside = false;
        for (const h of hs) {
          if (!h.up) { // entering material from below: an underside
            if (!inside && over[h.t] && h.z - zgap - below > st.layer * 2 && (!st.plateOnly || below === 0)) cols.push({ x, y, z0: below, z1: h.z - zgap });
            inside = true;
          } else { inside = false; below = h.z; }
        }
      }
    }
    let supVol = 0;
    disposeGroup(supG);
    if (cols.length && st.supports === "normal") {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: COL.support, transparent: true, opacity: 0.55, roughness: 0.8, depthWrite: false, clippingPlanes: [clip] }), cols.length);
      const m = new THREE.Matrix4();
      cols.forEach((c, i) => { const h = c.z1 - c.z0; m.makeScale(sp * 0.92, sp * 0.92, h).setPosition(c.x, c.y, c.z0); mesh.setMatrixAt(i, m); supVol += sp * sp * h * 0.15 + sp * sp * st.layer * 2 * 0.7; });
      supG.add(mesh);
    } else if (cols.length && st.supports === "tree") {
      supVol = buildTrees(cols, grid);
    }
    // the undersides that need support, in red
    disposeGroup(ovG);
    const op = [];
    for (let t = 0; t < nT; t++) if (over[t]) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k] * 3; op.push(pos[v], pos[v + 1], pos[v + 2] - 0.01); }
    if (op.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(op, 3));
      ovG.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: st.supports === "none" ? 0xff2d2d : 0xff7a2d, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    }
    A = { over, nrm, overArea, bedArea, grid, cols, supVol };
    adviceCache = null;
    updateBanner();
  }
  // ------------------------------------------------------------ teaching: the big red warning
  // Anything hanging out more than the overhang limit (45° from upright by default) with supports
  // off would be printed in mid-air: the plastic droops, strings or the print fails.
  let banner = null;
  function updateBanner() {
    const need = !!(A && root.visible && st.supports === "none" && A.overArea > 1);
    if (!need) { if (banner) { banner.remove(); banner = null; } return; }
    if (!banner) {
      banner = el("div", { class: "ps-banner", id: "ps-banner", role: "alert" });
      document.getElementById("viewport").append(banner);
    }
    banner.innerHTML = "";
    banner.append(
      el("div", { class: "ps-banner-sign", "aria-hidden": "true" }, "⚠"),
      el("div", { class: "ps-banner-text" },
        el("b", {}, "Supports needed!"),
        el("span", {}, `${fmt(A.overArea, 0)} mm² of this part (shown in red) hangs out more than ${st.threshold}° with nothing under it. A printer can't print on air: those layers would droop, string or fail.`),
        el("span", { class: "ps-banner-fix" }, "Fix it: turn on Supports (Normal or Tree), or turn the part (Orientation advice) so less of it hangs out.")),
      el("div", { class: "ps-banner-btns" },
        el("button", { class: "btn", id: "ps-banner-tree", onclick: () => { st.supports = "tree"; rebuild(false); renderPanel(); } }, "Tree supports"),
        el("button", { class: "btn", id: "ps-banner-normal", onclick: () => { st.supports = "normal"; rebuild(false); renderPanel(); } }, "Normal supports")));
  }

  // ------------------------------------------------------------ teaching: orientation advice
  // Each way the part could lie (the six main directions and its biggest flat faces) is scored
  // for overhang, contact with the plate and height, then the best one for each goal is offered,
  // with why it helps and how to do it.
  let adviceCache = null;
  function orientMetrics(dn) {
    const { pos, tri, nT } = W;
    const q = new THREE.Quaternion().setFromUnitVectors(dn, new THREE.Vector3(0, 0, -1));
    const Rm = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const nVtx = pos.length / 3, zs = new Float32Array(nVtx), v = new THREE.Vector3();
    const bb = new THREE.Box3();
    for (let i = 0; i < nVtx; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(Rm); zs[i] = v.z; bb.expandByPoint(v); }
    const zmin = bb.min.z, cosT = Math.cos((st.threshold * Math.PI) / 180), nn = new THREE.Vector3();
    let over = 0, bed = 0;
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < nT; t++) {
      nn.set(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]).applyQuaternion(q);
      const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
      e1.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
      e2.set(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
      const ar = e1.cross(e2).length() / 2;
      const hi = Math.max(zs[a], zs[b], zs[c]) - zmin;
      if (hi < 0.05 && nn.z < -0.98) bed += ar;
      else if (-nn.z > cosT && Math.min(zs[a], zs[b], zs[c]) - zmin > st.layer * 0.5) over += ar;
    }
    const size = bb.getSize(new THREE.Vector3());
    return { dn, Rm, over, bed, h: size.z, w: Math.max(size.x, size.y), d: Math.min(size.x, size.y) };
  }
  function advice() {
    if (!W || !A) return null;
    if (adviceCache) return adviceCache;
    const { pos, tri, nT } = W;
    const cand = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
    const byN = new Map();
    for (let t = 0; t < nT; t++) {
      const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1], nz = A.nrm[t * 3 + 2];
      const key = `${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ar = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]).cross(new THREE.Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])).length() / 2;
      const e = byN.get(key) || { n: new THREE.Vector3(nx, ny, nz), a: 0 };
      e.a += ar; byN.set(key, e);
    }
    [...byN.values()].sort((p, q) => q.a - p.a).slice(0, 6).forEach((e) => { const n = e.n.clone().normalize(); if (!cand.some((c) => c.dot(n) > 0.999)) cand.push(n); });
    if (nT > 400000) cand.length = 6; // very big meshes: the main directions only
    const all = cand.map(orientMetrics);
    const cur = all[0];
    const tol = (x) => Math.max(2, x * 0.05);
    const leastSup = all.reduce((b, m) => (m.over < b.over - tol(b.over) || (Math.abs(m.over - b.over) <= tol(b.over) && m.bed > b.bed) ? m : b));
    // strongest: the long side lies flat (lowest height), among ways that touch the plate well
    const okBed = all.filter((m) => m.bed >= 0.25 * Math.max(...all.map((x) => x.bed)) || m.bed > 50);
    const strong = (okBed.length ? okBed : all).reduce((b, m) => (m.h < b.h - 0.5 || (Math.abs(m.h - b.h) <= 0.5 && m.over < b.over) ? m : b));
    const stable = all.reduce((b, m) => (m.bed > b.bed * 1.05 || (m.bed >= b.bed * 0.95 && m.over < b.over) ? m : b));
    adviceCache = { all, cur, leastSup, strong, stable };
    return adviceCache;
  }
  function useOrient(m) { st.R.premultiply(m.Rm); st.refit = true; rebuild(); app.toast("Turned. Check the red overhangs and the Strength view."); }
  function adviceBox() {
    const a = advice();
    if (!a) return null;
    const fil = FILAMENTS[st.filament];
    const zPct = Math.round((fil.z / fil.xy) * 100);
    const same = (m) => m.dn.dot(new THREE.Vector3(0, 0, -1)) > 0.999;
    const card = (cls, title, m, why, how, metric) => el("div", { class: "psadv " + cls },
      el("div", { class: "psadv-h" }, el("b", {}, title), same(m) ? el("span", { class: "psadv-now" }, "✓ This is how it lies now") : el("button", { class: "btn", onclick: () => useOrient(m) }, "Use this")),
      el("div", { class: "psadv-m" }, metric),
      el("div", {}, el("b", {}, "Why: "), why),
      el("div", {}, el("b", {}, "How: "), how));
    const box = el("div", { class: "psadvice", id: "ps-advice" }, el("div", { class: "subhead" }, "Orientation advice"));
    // the part as it lies now: a quick read on its strength direction
    const c = a.cur;
    if (c.h > 2.2 * Math.max(1, c.d) && c.h > 25) box.append(el("div", { class: "psn warn" }, `Tall and thin as it lies now (${fmt(c.h, 0)} mm tall, ${fmt(c.d, 0)} mm thick): its layers stack up through the thin direction, so a push from the side can snap it between two layers. Lay it down if it has to take a load.`));
    box.append(card("strong", "Strongest", a.strong,
      `A printer builds in layers, and layers stick to each other only about ${zPct}% as well as the plastic holds together along a layer (${fil.name}). With the long side lying flat, the lines of plastic run the whole length of the part, so bending it means snapping those lines instead of peeling layers apart.`,
      "Lay the longest side on the plate (Use this, or Lay on face and click that side). Hooks, clips, handles and arms should lie flat so their curves are drawn inside each layer.",
      `${fmt(a.strong.h, 0)} mm tall · ${fmt(a.strong.over, 0)} mm² overhang`));
    if (a.leastSup !== a.strong) box.append(card("sup", "Least support", a.leastSup,
      "Every overhang needs support plastic under it that you break off afterwards: it costs filament and time and leaves rough marks where it touched.",
      "Put the biggest flat face down and avoid big surfaces hanging over air. Slopes steeper than 45° from upright print fine without support.",
      `${fmt(a.leastSup.over, 0)} mm² overhang · ${fmt(a.leastSup.h, 0)} mm tall`));
    if (a.stable !== a.strong && a.stable !== a.leastSup) box.append(card("stable", "Best grip on the plate", a.stable,
      "The first layer holds the whole print down. More contact means it won't come loose or warp at the corners, and the bottom comes out flat.",
      "Put the largest flat face on the plate. For a small footprint, add a brim in your slicer.",
      `${fmt(a.stable.bed, 0)} mm² on the plate · ${fmt(a.stable.over, 0)} mm² overhang`));
    box.append(el("div", { class: "hint", style: { padding: 0 } }, "Switch Show to Strength to see the weak layers in this orientation. The best choice depends on how the part is used: strength for things that bend or carry weight, least support for display pieces."));
    return box;
  }
  // tree supports: branches start under each overhang point and lean together as they go
  // down, merging into trunks that stand on the plate (or land on the part)
  function buildTrees(cols, grid) {
    const dz = 1.5, lean = Math.tan((40 * Math.PI) / 180) * dz;
    // keep it quick on big parts: thin out the contact points
    const stepK = Math.max(1, Math.ceil(cols.length / 1200));
    let nodes = cols.filter((_, i) => i % stepK === 0).map((c) => ({ x: c.x, y: c.y, z: c.z1, n: 1, floor: c.z0, alive: true }));
    const segs = [];
    let zTop = Math.max(...nodes.map((q) => q.z));
    const insideAt = (x, y, z) => { let inside = false; for (const h of grid.hits(x, y)) { if (h.z > z) break; inside = !h.up; } return inside; };
    const floorAt = (x, y, z) => { let f = 0; for (const h of grid.hits(x, y)) { if (h.z > z) break; if (h.up) f = h.z; } return f; };
    for (let z = zTop - dz; z > -dz; z -= dz) {
      const zz = Math.max(0, z);
      const act = nodes.filter((q) => q.alive && q.z > zz + 1e-9);
      for (const q of act) {
        // pull toward the weighted middle of nearby branches
        let sx = 0, sy = 0, sw = 0;
        for (const o of act) { const d = Math.hypot(o.x - q.x, o.y - q.y); if (d < 12) { sx += o.x * o.n; sy += o.y * o.n; sw += o.n; } }
        let tx = sx / sw - q.x, ty = sy / sw - q.y;
        const L = Math.hypot(tx, ty), mv = Math.min(L, lean);
        let nx = q.x + (L > 1e-9 ? (tx / L) * mv : 0), ny = q.y + (L > 1e-9 ? (ty / L) * mv : 0);
        if (insideAt(nx, ny, zz) || (st.plateOnly && floorAt(nx, ny, zz) > 0)) { nx = q.x; ny = q.y; }
        const fl = st.plateOnly ? 0 : floorAt(nx, ny, q.z);
        const nz = Math.max(zz, fl);
        segs.push([q.x, q.y, q.z, nx, ny, nz, rad(q.n)]);
        q.x = nx; q.y = ny; q.z = nz;
        if (nz <= fl + 1e-6) q.alive = false; // landed
      }
      // merge branches that touch
      const live = nodes.filter((q) => q.alive);
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        if (!a.alive) continue;
        for (let k = i + 1; k < live.length; k++) {
          const b = live[k];
          if (!b.alive || Math.abs(a.z - b.z) > 1e-6) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < (rad(a.n) + rad(b.n)) * 0.9) {
            a.x = (a.x * a.n + b.x * b.n) / (a.n + b.n); a.y = (a.y * a.n + b.y * b.n) / (a.n + b.n); a.n += b.n; b.alive = false;
          }
        }
      }
      if (!nodes.some((q) => q.alive)) break;
    }
    function rad(n) { return Math.min(4, 0.6 + 0.22 * Math.sqrt(n)); }
    let vol = 0;
    if (segs.length) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: COL.support, roughness: 0.7, clippingPlanes: [clip] }), segs.length);
      const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1), s = new THREE.Vector3();
      segs.forEach(([x0, y0, z0, x1, y1, z1, r], i) => {
        a.set(x1, y1, z1); b.set(x0 - x1, y0 - y1, z0 - z1);
        const L = b.length() || 1e-3;
        q.setFromUnitVectors(up, b.clone().normalize());
        m.compose(a, q, s.set(r, r, L + r * 0.3));
        mesh.setMatrixAt(i, m);
        vol += Math.PI * r * r * L;
      });
      supG.add(mesh);
    }
    return vol;
  }

  // ------------------------------------------------------------ slicing (done in steps)
  function slice() {
    const job = ++sliceJob;
    const w = W, { pos, tri, nT } = w;
    const lh = st.layer, H = w.size.z, nL = Math.max(1, Math.ceil(H / lh - 1e-6));
    const order = Array.from({ length: nT }, (_, t) => t);
    const zmin = new Float32Array(nT), zmax = new Float32Array(nT);
    for (let t = 0; t < nT; t++) { const a = pos[tri[t * 3] * 3 + 2], b = pos[tri[t * 3 + 1] * 3 + 2], c = pos[tri[t * 3 + 2] * 3 + 2]; zmin[t] = Math.min(a, b, c); zmax[t] = Math.max(a, b, c); }
    order.sort((p, q) => zmin[p] - zmin[q]);
    // raster for skins, areas and thin walls
    const g = A.grid, cell = Math.max(0.5, Math.min(1, Math.sqrt(((g.x1 - g.x0) * (g.y1 - g.y0)) / 40000)));
    const rx0 = g.x0 - cell, ry0 = g.y0 - cell, RW = Math.ceil((g.x1 - g.x0) / cell) + 3, RH = Math.ceil((g.y1 - g.y0) / cell) + 3;
    const occ = []; // per layer Uint8Array RW*RH
    const segsL = [], ownL = [], triL = []; // contour segments of each layer, the part and the triangle each came from
    let ptr = 0, active = [];
    const areaO = Array.from({ length: w.nParts }, () => new Float32Array(nL)); // cross-section of each part
    const res = { nL, lh, areaO, layers: [], area: new Float32Array(nL), thin: [], len: { outer: 0, inner: 0, sparse: 0, solid: 0, top: 0, bottom: 0, bridge: 0 } };
    S = null;
    const status = (t) => { const e = document.getElementById("ps-status"); if (e) e.textContent = t; };
    let k = 0;
    // pass 1: contours and occupancy
    const pass1 = () => {
      if (job !== sliceJob) return;
      const until = performance.now() + 30;
      for (; k < nL && performance.now() < until; k++) {
        const z = (k + 0.5) * lh;
        while (ptr < nT && zmin[order[ptr]] <= z) active.push(order[ptr++]);
        active = active.filter((t) => zmax[t] >= z);
        const sg = [], so = [], stri = [];
        for (const t of active) {
          const P = [tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3], q = [];
          for (let e = 0; e < 3; e++) {
            const a = P[e], b = P[(e + 1) % 3];
            const za = pos[a + 2] - z + 1e-7, zb = pos[b + 2] - z + 1e-7;
            if ((za < 0) !== (zb < 0)) { const f = za / (za - zb); q.push(pos[a] + (pos[b] - pos[a]) * f, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f); }
          }
          if (q.length === 4) {
            // point the segment so the material is on its left; then the shoelace sum is the area
            const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1];
            if ((q[2] - q[0]) * -ny + (q[3] - q[1]) * nx < 0) { const a0 = q[0], a1 = q[1]; q[0] = q[2]; q[1] = q[3]; q[2] = a0; q[3] = a1; }
            areaO[w.owner[t]][k] += (q[0] * q[3] - q[2] * q[1]) / 2;
            sg.push(q[0], q[1], q[2], q[3]);
            so.push(w.owner[t]); stri.push(t);
          }
        }
        segsL.push(sg); ownL.push(so); triL.push(stri);
        // occupancy by rows (even-odd fill)
        const o = new Uint8Array(RW * RH);
        let cnt = 0;
        for (let j = 0; j < RH; j++) {
          const y = ry0 + (j + 0.5) * cell, xs = [];
          for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= y) !== (y2 <= y)) xs.push(sg[i] + ((y - y1) / (y2 - y1)) * (sg[i + 2] - sg[i])); }
          xs.sort((p, q) => p - q);
          for (let m = 0; m + 1 < xs.length; m += 2) {
            const i0 = Math.max(0, Math.ceil((xs[m] - rx0) / cell - 0.5)), i1 = Math.min(RW - 1, Math.floor((xs[m + 1] - rx0) / cell - 0.5));
            for (let i = i0; i <= i1; i++) { o[j * RW + i] = 1; cnt++; }
          }
        }
        occ.push(o);
        res.area[k] = cnt * cell * cell;
      }
      status(`Slicing… ${Math.round((k / nL) * 50)}%`);
      if (k < nL) { setTimeout(pass1, 0); return; }
      k = 0; setTimeout(pass2, 0);
    };
    // pass 2: walls, infill and skins as toolpath lines
    const lines = [], cols = [], layerEnd = [], lown = [], ltri = [];
    const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    const CC = Object.fromEntries(Object.entries(COL).map(([key, v]) => [key, C(v)]));
    // every line also gets the time it takes to print, for the print animation
    const flow = FLOW[st.filament] || 12, sec = LW * lh;
    const cum = [];
    let tNow = 0;
    // own: the part; tri: the surface triangle the line sits against (walls and skins), so a
    // painted face changes the filament of the lines behind it
    const push = (x0, y0, x1, y1, z, kind, own = 0, tri = -1) => {
      lines.push(x0, y0, z, x1, y1, z); const c = CC[kind]; cols.push(...c, ...c); lown.push(own); ltri.push(tri);
      const len = Math.hypot(x1 - x0, y1 - y0);
      res.len[kind] += len;
      tNow += len / Math.min(SPEEDS[kind] || 200, flow / sec) + 0.02;
      cum.push(tNow);
    };
    const thinCells = new Set();
    const thinEvery = Math.max(1, Math.round(0.6 / lh));
    // fine raster of one layer, distance to the edge, and the parts thinner than two lines
    const fc = Math.min(0.35, Math.max(0.15, Math.max(g.x1 - g.x0, g.y1 - g.y0) / 260));
    const FW = Math.ceil((g.x1 - g.x0) / fc) + 4, FH = Math.ceil((g.y1 - g.y0) / fc) + 4, fx0 = g.x0 - 2 * fc, fy0 = g.y0 - 2 * fc;
    const fm = new Uint8Array(FW * FH), d1 = new Float32Array(FW * FH), d2 = new Float32Array(FW * FH);
    const BIG = 1e9, R2 = Math.SQRT2;
    const dt = (D) => {
      for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
        const c = j * FW + i; let v = D[c];
        if (v === 0) continue;
        if (i > 0) v = Math.min(v, D[c - 1] + 1);
        if (j > 0) { v = Math.min(v, D[c - FW] + 1); if (i > 0) v = Math.min(v, D[c - FW - 1] + R2); if (i < FW - 1) v = Math.min(v, D[c - FW + 1] + R2); }
        D[c] = v;
      }
      for (let j = FH - 1; j >= 0; j--) for (let i = FW - 1; i >= 0; i--) {
        const c = j * FW + i; let v = D[c];
        if (v === 0) continue;
        if (i < FW - 1) v = Math.min(v, D[c + 1] + 1);
        if (j < FH - 1) { v = Math.min(v, D[c + FW] + 1); if (i < FW - 1) v = Math.min(v, D[c + FW + 1] + R2); if (i > 0) v = Math.min(v, D[c + FW - 1] + R2); }
        D[c] = v;
      }
    };
    function thinCheck(sg, k) {
      fm.fill(0);
      for (let j = 0; j < FH; j++) {
        const y = fy0 + (j + 0.5) * fc, xs = [];
        for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= y) !== (y2 <= y)) xs.push(sg[i] + ((y - y1) / (y2 - y1)) * (sg[i + 2] - sg[i])); }
        xs.sort((p, q) => p - q);
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - fx0) / fc - 0.5)), i1 = Math.min(FW - 1, Math.floor((xs[m + 1] - fx0) / fc - 0.5));
          for (let i = i0; i <= i1; i++) fm[j * FW + i] = 1;
        }
      }
      for (let c = 0; c < fm.length; c++) d1[c] = fm[c] ? BIG : 0;
      dt(d1);
      const deep = LW / fc; // half of the narrowest printable width (two lines), in cells
      for (let c = 0; c < fm.length; c++) d2[c] = fm[c] && d1[c] >= deep ? 0 : BIG;
      dt(d2);
      for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
        const c = j * FW + i;
        if (fm[c] && d2[c] > deep + 1.5) thinCells.add(`${k}|${Math.round((fx0 + (i + 0.5) * fc) / 1.5)}|${Math.round((fy0 + (j + 0.5) * fc) / 1.5)}`);
      }
    }
    // the top (or bottom) surface right above (below) a skin line, within the skin's depth
    const skinTri = (x, y, z, kind) => {
      if (kind === "sparse") return -1;
      const up = kind === "top" || kind === "solid", down = kind === "bottom" || kind === "bridge" || kind === "solid";
      let best = -1, bd = Infinity;
      for (const h of g.hits(x, y)) {
        if (up && h.up && h.z >= z - lh && h.z - z <= (st.topN + 1) * lh && h.z - z < bd) { bd = h.z - z; best = h.t; }
        if (down && !h.up && h.z <= z && z - h.z <= (st.botN + 1) * lh && z - h.z < bd) { bd = z - h.z; best = h.t; }
      }
      return best;
    };
    const pass2 = () => {
      if (job !== sliceJob) return;
      const until = performance.now() + 30;
      for (; k < nL && performance.now() < until; k++) {
        tNow += 4; // layer change
        const z = (k + 1) * lh, sg = segsL[k], so = ownL[k], sT = triL[k], o = occ[k];
        const at = (L, i, j) => (L && i >= 0 && j >= 0 && i < RW && j < RH ? L[j * RW + i] : 0);
        // walls: the contour, plus inner walls as inward offsets of each loop
        const loops = chain(sg, so, sT);
        for (const lp of loops) {
          for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; push(a[0], a[1], b[0], b[1], z, "outer", lp.own, lp.tri[i]); }
          const inward = inwardSign(lp, sg);
          for (let wi = 1; wi < st.walls; wi++) {
            const off = offsetLoop(lp, wi * LW * inward);
            if (!off) break;
            for (let i = 0; i < off.length; i++) { const a = off[i], b = off[(i + 1) % off.length]; push(a[0], a[1], b[0], b[1], z, "inner", lp.own, off.length === lp.length ? lp.tri[i] : -1); }
          }
        }
        // skin map for this layer: which cells need solid fill (near the top or bottom)
        const sk = new Uint8Array(RW * RH); // 0 sparse, 1 solid, 2 top, 3 bottom, 4 bridge
        let anySkin = false;
        for (let c = 0; c < RW * RH; c++) {
          if (!o[c]) continue;
          let top = false, bot = k < st.botN;
          for (let d = 1; d <= st.topN; d++) { const L = occ[k + d]; if (!L || !L[c]) { top = true; break; } }
          if (!bot) for (let d = 1; d <= st.botN; d++) { const L = occ[k - d]; if (!L || !L[c]) { bot = true; break; } }
          if (!top && !bot) continue;
          anySkin = true;
          sk[c] = top && !(occ[k + 1] && occ[k + 1][c]) ? 2 : bot && k === 0 ? 3 : bot && !(occ[k - 1] && occ[k - 1][c]) ? 4 : 1;
        }
        const KIND = [null, "solid", "top", "bottom", "bridge"];
        const skinType = (x, y) => { const i = Math.floor((x - rx0) / cell), j = Math.floor((y - ry0) / cell); return i >= 0 && j >= 0 && i < RW && j < RH ? KIND[sk[j * RW + i]] : null; };
        // infill: scan lines at ±45°, alternating each layer
        const ang = k % 2 ? Math.PI / 4 : -Math.PI / 4, ca = Math.cos(ang), sa = Math.sin(ang);
        const inset = st.walls * LW;
        const sparseStep = st.infill > 0 ? LW / (st.infill / 100) : Infinity;
        const base = LW * 1.25, every = isFinite(sparseStep) ? Math.max(1, Math.round(sparseStep / base)) : Infinity;
        const rs = new Float32Array(sg.length);
        let vmin = Infinity, vmax = -Infinity;
        for (let i = 0; i < sg.length; i += 2) { const x = sg[i], y = sg[i + 1]; rs[i] = x * ca + y * sa; rs[i + 1] = -x * sa + y * ca; vmin = Math.min(vmin, rs[i + 1]); vmax = Math.max(vmax, rs[i + 1]); }
        let li = 0;
        for (let v = Math.ceil(vmin / base) * base; v <= vmax; v += base, li++) {
          const sparseLine = isFinite(every) && li % every === 0;
          if (!anySkin && !sparseLine) continue;
          const us = [], uo = [];
          for (let i = 0; i < rs.length; i += 4) { const v1 = rs[i + 1], v2 = rs[i + 3]; if ((v1 <= v) !== (v2 <= v)) { us.push(rs[i] + ((v - v1) / (v2 - v1)) * (rs[i + 2] - rs[i])); uo.push(so[i / 4]); } }
          // sort the crossings, keeping each one's part (a fill run belongs to the part it enters)
          const ord = us.map((_, i) => i).sort((p, q) => us[p] - us[q]);
          const usS = ord.map((i) => us[i]), uoS = ord.map((i) => uo[i]);
          for (let m = 0; m + 1 < usS.length; m += 2) {
            const u0 = usS[m] + inset, u1 = usS[m + 1] - inset, own = uoS[m];
            if (u1 - u0 < LW * 0.5) continue;
            if (!anySkin) { push(u0 * ca - v * sa, u0 * sa + v * ca, u1 * ca - v * sa, u1 * sa + v * ca, z, "sparse", own); continue; }
            // walk the line, splitting where the fill type changes
            let runStart = u0, runType;
            const flush = (uEnd) => {
              if (runType === undefined || uEnd - runStart < LW * 0.3) return;
              const kind = runType || "sparse";
              if (kind === "sparse" && !sparseLine) return;
              push(runStart * ca - v * sa, runStart * sa + v * ca, uEnd * ca - v * sa, uEnd * sa + v * ca, z, kind, own, skinTri(((runStart + uEnd) / 2) * ca - v * sa, ((runStart + uEnd) / 2) * sa + v * ca, z, kind));
            };
            for (let u = u0; u <= u1 + 1e-9; u += cell * 0.7) {
              const uu = Math.min(u, u1), t = skinType(uu * ca - v * sa, uu * sa + v * ca);
              if (t !== runType) { flush(uu); runStart = uu; runType = t; }
            }
            flush(u1);
          }
        }
        // thin walls: material that a pair of lines can't fill (checked every few layers)
        if (k % thinEvery === 0) thinCheck(sg, k);
        layerEnd.push(lines.length / 3);
      }
      status(`Slicing… ${50 + Math.round((k / nL) * 50)}%`);
      if (k < nL) { setTimeout(pass2, 0); return; }
      res.lines = new Float32Array(lines); res.cols = new Float32Array(cols); res.layerEnd = layerEnd; res.lown = new Uint16Array(lown); res.ltri = new Int32Array(ltri);
      res.cum = new Float64Array(cum); res.total = tNow; res.printTotal = tNow;
      // the slicer's own order; reordered by filament (and tool-change pauses added) per plan
      res.base = { lines: res.lines, cols: res.cols, lown: res.lown, ltri: res.ltri, cum: res.cum, layerEnd: layerEnd.slice(), total: tNow };
      res.thin = [...thinCells].map((s) => s.split("|").map(Number)).map(([kk, i, j]) => [i * 1.5, j * 1.5, (kk + 0.5) * lh]);
      res.cell = cell;
      res.segs = segsL;
      res.thinLayers = new Set([...thinCells].map((q) => q.split("|")[0])).size;
      res.thinHeight = res.thinLayers * thinEvery * lh;
      S = res;
      finishSlice();
    };
    status("Slicing… 0%");
    setTimeout(pass1, 0);
  }
  // join slice segments end to end into closed loops
  function chain(sg, so, sT) {
    const key = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
    const starts = new Map();
    const n = sg.length / 4, used = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const kk = key(sg[i * 4], sg[i * 4 + 1]); if (!starts.has(kk)) starts.set(kk, []); starts.get(kk).push(i); }
    const loops = [];
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const lp = [];
      lp.own = so ? so[i] : 0;
      lp.tri = [];
      let cur = i;
      while (cur !== undefined && !used[cur]) {
        used[cur] = 1;
        lp.push([sg[cur * 4], sg[cur * 4 + 1]]);
        lp.tri.push(sT ? sT[cur] : -1);
        const nxt = (starts.get(key(sg[cur * 4 + 2], sg[cur * 4 + 3])) || []).find((j) => !used[j]);
        cur = nxt;
      }
      if (lp.length >= 3) loops.push(lp);
    }
    return loops;
  }
  // which way is "into the material" from a loop: test a point just to the left of an edge
  function inwardSign(lp, sg) {
    const a = lp[0], b = lp[1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const px = (a[0] + b[0]) / 2 - (dy / L) * 0.02, py = (a[1] + b[1]) / 2 + (dx / L) * 0.02;
    let c = 0;
    for (let i = 0; i < sg.length; i += 4) { const y1 = sg[i + 1], y2 = sg[i + 3]; if ((y1 <= py) !== (y2 <= py)) { const x = sg[i] + ((py - y1) / (y2 - y1)) * (sg[i + 2] - sg[i]); if (x > px) c++; } }
    return c % 2 ? 1 : -1; // +1: material on the left
  }
  function loopArea(lp) { let s = 0; for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  // offset a loop to the left by d (negative = right); null when it collapses
  function offsetLoop(lp, d) {
    const n = lp.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = lp[(i - 1 + n) % n], c = lp[i], q = lp[(i + 1) % n];
      let ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      const n1x = -ay, n1y = ax, n2x = -by, n2y = bx;
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
      const cosh = Math.max(0.35, mx * n1x + my * n1y);
      out.push([c[0] + (mx * d) / cosh, c[1] + (my * d) / cosh]);
    }
    const a0 = loopArea(lp), a1 = loopArea(out);
    if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < LW * LW) return null;
    // an inward offset must shrink a loop (and an outward one grow it)
    if ((d > 0) === (a0 > 0) ? Math.abs(a1) > Math.abs(a0) : Math.abs(a1) < Math.abs(a0)) return null;
    return out;
  }

  // ------------------------------------------------------------ filaments and tools (multi-material)
  // every body on the plate gets a filament slot; bodies of the same color share one
  function ensureSlots() {
    for (const id of st.ids) {
      if (st.slotOf.has(id) && st.slots[st.slotOf.get(id)]) continue;
      const c = (findBody(store.doc, id)?.color || "#a7b0ba").toLowerCase();
      let i = st.slots.findIndex((q) => q.color.toLowerCase() === c);
      if (i < 0) { st.slots.push({ color: c }); i = st.slots.length - 1; }
      st.slotOf.set(id, i);
    }
    // the printer's own filament positions (toolheads, AMS slots) are ready to pick colors for
    const T = toolsOf();
    const want = T.kind === "heads" ? Math.min(T.heads, 8) : T.kind === "mmu" ? Math.min(T.slots, 4) : 1;
    while (st.slots.length < want) st.slots.push({ color: nextFilColor() });
  }
  // painted faces: st.paint = Map(bodyId -> Map(faceIndex -> slot))
  const paintOf = (id, f) => { const m = st.paint.get(id); return m && m.has(f) ? m.get(f) : null; };
  function usedSlots() {
    const set = new Set();
    for (const id of st.ids) {
      const sl = st.slotOf.get(id);
      if (sl != null) set.add(sl);
      const m = st.paint.get(id);
      if (m) for (const v of m.values()) set.add(v);
    }
    return [...set].sort((a, b) => a - b);
  }
  const toolsOf = () => PRINTERS[st.printer].tools || { kind: "single" };
  // which nozzle a filament prints from: F1 on T1, F2 on T2…; more filaments than heads share
  function headOf(slot) {
    const T = toolsOf();
    return T.kind === "heads" ? slot % T.heads : 0;
  }
  // the filament of every triangle (painted, or its body's)
  function triSlots() {
    const ts = new Int16Array(W.tri.length / 3);
    const bodySlot = W.ids.map((id) => st.slotOf.get(id) ?? 0);
    for (let t = 0; t < ts.length; t++) {
      const id = W.ids[W.owner[t]], p = paintOf(id, W.tface[t]);
      ts[t] = p != null ? p : bodySlot[W.owner[t]];
    }
    return ts;
  }
  // the filament of every toolpath line (in the slicer's own order)
  function lineSlots() {
    const B = S.base, ts = triSlots(), bodySlot = W.ids.map((id) => st.slotOf.get(id) ?? 0);
    const out = new Int16Array(B.lown.length);
    for (let i = 0; i < out.length; i++) out[i] = B.ltri[i] >= 0 ? ts[B.ltri[i]] : bodySlot[B.lown[i]];
    return out;
  }
  // what one filament change costs on this printer: seconds, and whether it swaps / purges
  function changeCost(T, from, to, loaded) {
    const h = headOf(to), hc = headOf(from);
    let secs = 0, swap = false, purge = 0;
    if (T.kind === "heads" && h !== hc) { swap = true; secs += T.swap; }
    if (loaded.get(h) !== to) {
      purge = flushVolume(st.slots[loaded.get(h) ?? from]?.color, st.slots[to]?.color);
      secs += (T.load || 30) + purge / PURGE_FLOW;
    }
    return { secs, swap, purge, h };
  }
  // Orca-style plan: each layer prints every filament it needs once, starting with the one
  // already loaded; count changes, head swaps, purge (flush) and the prime tower
  function toolPlan() {
    if (!S || !W || !S.base) return null;
    ensureSlots();
    const T = toolsOf(), fil = FILAMENTS[st.filament];
    const used = usedSlots();
    const ls = lineSlots(), B = S.base;
    const perLayer = [];
    const slotLen = new Map();
    let li = 0;
    for (let k = 0; k < S.nL; k++) {
      const end = (B.layerEnd[k] || 0) / 2, set = new Set();
      for (; li < end; li++) {
        const sl = ls[li];
        set.add(sl);
        const L = B.lines, o = li * 6;
        slotLen.set(sl, (slotLen.get(sl) || 0) + Math.hypot(L[o + 3] - L[o], L[o + 4] - L[o + 1]));
      }
      perLayer.push(set);
    }
    const plan = { kind: T.kind, used, ls, changes: 0, swaps: 0, flushes: 0, flushVol: 0, primeVol: 0, towerVol: 0, towerH: 0, secs: 0, mixedLayers: 0, firstMixed: -1, slotGrams: new Map(), heads: new Set(used.map(headOf)), seqs: [], costs: [] };
    const sec = LW * S.lh;
    for (const [sl, len] of slotLen) plan.slotGrams.set(sl, (len * sec * fil.rho) / 1000);
    for (let k = 0; k < perLayer.length; k++) if (perLayer[k].size > 1) { plan.mixedLayers++; if (plan.firstMixed < 0) plan.firstMixed = k; }
    if (used.length < 2 || T.kind === "single") return plan;
    const loaded = new Map(); // head -> slot in it
    for (const sl of used) { const h = headOf(sl); if (!loaded.has(h)) loaded.set(h, sl); }
    let cur = null, towerTop = -1;
    for (let k = 0; k < perLayer.length; k++) {
      const set = perLayer[k], seq = [...set].sort((a, b) => a - b), costs = [];
      if (cur != null && set.has(cur)) { seq.splice(seq.indexOf(cur), 1); seq.unshift(cur); }
      let changedHere = false;
      for (const sl of seq) {
        if (cur == null || sl === cur) { cur = sl; costs.push(null); continue; }
        const c = changeCost(T, cur, sl, loaded);
        plan.changes++; changedHere = true;
        if (c.swap) { plan.swaps++; plan.primeVol += T.prime || 15; }
        if (c.purge) { plan.flushes++; plan.flushVol += c.purge; loaded.set(c.h, sl); }
        plan.secs += c.secs;
        costs.push(c);
        cur = sl;
      }
      plan.seqs.push(seq); plan.costs.push(costs);
      if (changedHere || set.size > 1) towerTop = k;
    }
    if (plan.changes) {
      // a prime tower keeps every layer's nozzle(s) primed up to the last change
      const side = T.kind === "heads" ? 25 : 35;
      plan.towerSide = side;
      plan.towerH = (towerTop + 1) * S.lh;
      plan.towerVol = plan.towerH * (4 * side * 2 * LW + side * side * 0.12);
      plan.secs += plan.towerVol / Math.min(FLOW[st.filament] || 12, 200 * sec);
    }
    plan.wasteGrams = ((plan.flushVol + plan.primeVol + plan.towerVol) * fil.rho) / 1000;
    return plan;
  }
  // put each layer's lines in printing order (one filament after another, as the plan says)
  // and add the tool-change / purge pauses to the timeline, for the layer preview and the
  // print animation
  function applyOrder(plan) {
    const B = S.base, n = B.lown.length;
    const ls = plan ? plan.ls : null;
    const durs = new Float64Array(n);
    for (let i = 0; i < n; i++) durs[i] = B.cum[i] - (i ? B.cum[i - 1] : 0);
    const order = new Int32Array(n), pause = new Float32Array(n), pkind = new Uint8Array(n);
    let o = 0;
    const lEnd = [];
    let li = 0;
    for (let k = 0; k < S.nL; k++) {
      const end = (B.layerEnd[k] || 0) / 2;
      const seq = plan && plan.seqs && plan.seqs[k];
      if (!seq || seq.length < 2 && !(plan.costs[k] && plan.costs[k][0])) { for (; li < end; li++) order[o++] = li; }
      else {
        const by = new Map(seq.map((sl) => [sl, []]));
        for (; li < end; li++) (by.get(ls[li]) || by.get(seq[0])).push(li);
        seq.forEach((sl, j) => {
          const list = by.get(sl), c = plan.costs[k][j];
          if (c && list.length) { pause[o] = c.secs; pkind[o] = (c.swap ? 1 : 0) | (c.purge ? 2 : 0); }
          for (const x of list) order[o++] = x;
        });
      }
      lEnd.push(o * 2);
    }
    const lines = new Float32Array(n * 6), cols = new Float32Array(n * 6), lown = new Uint16Array(n), ltri = new Int32Array(n), lslot = new Int16Array(n), cum = new Float64Array(n);
    let t = 0;
    for (let j = 0; j < n; j++) {
      const i = order[j];
      lines.set(B.lines.subarray(i * 6, i * 6 + 6), j * 6);
      cols.set(B.cols.subarray(i * 6, i * 6 + 6), j * 6);
      lown[j] = B.lown[i]; ltri[j] = B.ltri[i]; lslot[j] = ls ? ls[i] : 0;
      t += pause[j] + durs[i];
      cum[j] = t;
    }
    Object.assign(S, { lines, cols, lown, ltri, lslot, cum, pause, pkind, durs: Float64Array.from(order, (i) => durs[i]), layerEnd: lEnd, total: t });
    const ln = layG.children[0];
    if (ln) { ln.geometry.setAttribute("position", new THREE.BufferAttribute(S.lines, 3)); ln.geometry.computeBoundingSphere(); }
  }
  const multiOK = () => toolsOf().kind !== "single";
  const toHex = (c) => "#" + new THREE.Color(c || "#a7b0ba").getHexString();
  const lightText = (c) => { const k = new THREE.Color(c || "#a7b0ba"); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b > 0.45 ? "#111" : "#fff"; };
  const FIL_COLORS = ["#e5484d", "#2f7de1", "#f5c518", "#2fbf71", "#ffffff", "#222222", "#9b59d0", "#ff8a1f"];
  const nextFilColor = () => FIL_COLORS.find((c) => !st.slots.some((q) => q.color.toLowerCase() === c)) || "#888888";
  function headName(h) {
    const T = toolsOf();
    if (T.lr && T.heads === 2) return h === 0 ? "left" : "right";
    if (st.printer === "h2c") return h === 0 ? "left" : `right · hotend ${h}`;
    return "T" + (h + 1);
  }
  // one line on what the printer does with more than one filament
  function toolText(P) {
    const T = P.tools || { kind: "single" };
    if (T.kind === "single") return "One nozzle, one filament. For two colors, pause at a layer and swap the spool by hand.";
    if (T.kind === "mmu") return `One nozzle with ${T.sys}: up to ${T.slots} filaments. Each change unloads, loads and purges (flushes) filament, so it adds time and waste.`;
    const width = T.wDual ? ` Using both nozzles, the printable width is ${T.wDual} mm (${T.wSingle} mm with one).` : "";
    return `${T.heads} ${T.lr ? "nozzles" : "toolheads"} (${T.sys}): each filament keeps its own nozzle, so changes are quick swaps with almost no waste${T.slots > T.heads ? `; more than ${T.heads} filaments share nozzles and purge` : ""}.${width}`;
  }
  // the plan drives the print order, the tower, the line colors and the painted faces
  let lastPlan = null;
  function refreshPlan() {
    if (!S || !S.base) { lastPlan = null; buildPaint(); return; }
    lastPlan = toolPlan();
    applyOrder(lastPlan);
    if (st.view === "layers") setLayer(st.layerMax);
    lineColors();
    buildTower(lastPlan);
    buildPaint();
  }
  // a filament, paint or printer change: plate area, plan, legend, panel
  function filamentsChanged() {
    buildPlate();
    refreshPlan();
    buildDocks();
    legend();
    renderPanel();
  }
  // colors of the toolpath lines by filament (Orca's "Filament" color scheme)
  function filamentColors() {
    const out = new Float32Array(S.lines.length);
    const cols = st.slots.map((q) => new THREE.Color(q.color || "#a7b0ba"));
    for (let i = 0; i < S.lown.length; i++) {
      const c = cols[S.lslot ? S.lslot[i] : 0] || cols[0];
      for (let j = 0; j < 2; j++) { out[i * 6 + j * 3] = c.r; out[i * 6 + j * 3 + 1] = c.g; out[i * 6 + j * 3 + 2] = c.b; }
    }
    return out;
  }
  const byFilament = () => st.colorBy === "filament" || (st.colorBy === "auto" && usedSlots().length > 1);
  function lineColors() {
    const ls = layG.children[0];
    if (!ls || !S) return;
    ls.geometry.setAttribute("color", new THREE.BufferAttribute(byFilament() ? filamentColors() : S.cols, 3));
    vp.request();
  }
  // painted faces drawn over the model (Model view), plus the face under the brush
  const paintG = new THREE.Group(), hoverG = new THREE.Group();
  root.add(paintG, hoverG);
  function faceTris(pred) {
    const out = [];
    for (let t = 0; t < W.tri.length / 3; t++) if (pred(t)) for (let e = 0; e < 3; e++) { const v = W.tri[t * 3 + e] * 3; out.push(W.pos[v], W.pos[v + 1], W.pos[v + 2]); }
    return out;
  }
  function overlayMesh(pos, color, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    m.renderOrder = 3;
    return m;
  }
  function buildPaint() {
    disposeGroup(paintG);
    if (!W || !st.paint.size) return;
    const bySlot = new Map();
    for (let t = 0; t < W.tri.length / 3; t++) {
      const p = paintOf(W.ids[W.owner[t]], W.tface[t]);
      if (p == null) continue;
      if (!bySlot.has(p)) bySlot.set(p, []);
      bySlot.get(p).push(t);
    }
    for (const [sl, ts] of bySlot) {
      const set = new Set(ts);
      paintG.add(overlayMesh(faceTris((t) => set.has(t)), st.slots[sl]?.color || "#888", 1));
    }
    vp.request();
  }
  function hoverFace(t) {
    disposeGroup(hoverG);
    if (t < 0 || !W || !st.paintTool) { vp.request(); return; }
    const part = W.owner[t], f = W.tface[t];
    const pred = st.paintTool === "fill" ? (q) => W.owner[q] === part : (q) => W.owner[q] === part && W.tface[q] === f;
    const col = st.paintTool === "erase" ? st.slots[st.slotOf.get(W.ids[part]) ?? 0]?.color : st.slots[st.brush]?.color;
    hoverG.add(overlayMesh(faceTris(pred), col || "#888", 0.75));
    vp.request();
  }
  // paint (or fill / erase) the face under the pointer
  function paintAt(t) {
    if (t < 0 || !W) return false;
    const id = W.ids[W.owner[t]], f = W.tface[t];
    if (f < 0) return false;
    if (st.paintTool === "fill") {
      if (st.slotOf.get(id) === st.brush && !st.paint.has(id)) return false;
      st.slotOf.set(id, st.brush); st.paint.delete(id);
      return true;
    }
    const m = st.paint.get(id) || new Map();
    const before = m.get(f);
    if (st.paintTool === "erase" || st.brush === st.slotOf.get(id)) m.delete(f); else m.set(f, st.brush);
    if (m.size) st.paint.set(id, m); else st.paint.delete(id);
    return before !== m.get(f);
  }
  // tool changers: the parked toolheads behind the plate (the one printing leaves its dock)
  const dockG = new THREE.Group();
  root.add(dockG);
  function buildDocks() {
    disposeGroup(dockG);
    const T = toolsOf(), P = PRINTERS[st.printer];
    if (T.kind !== "heads" || T.lr) return;
    ensureSlots();
    const n = T.heads, gap = Math.min(30, (P.w - 20) / n);
    for (let h = 0; h < n; h++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(gap * 0.6, 10, 14).translate(0, 0, 7), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.3, roughness: 0.5 }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(gap * 0.62, 10.4, 3).translate(0, 0, 10), new THREE.MeshStandardMaterial({ color: st.slots[h]?.color || "#888", roughness: 0.5 }));
      g.add(body, band);
      g.position.set(-((n - 1) * gap) / 2 + h * gap, P.d / 2 + 14, 0);
      g.userData.head = h;
      dockG.add(g);
    }
    dockG.userData.at = (h) => dockG.children[h] ? dockG.children[h].position : null;
  }
  const toolLabel = (sl) => {
    const T = toolsOf();
    return T.kind === "heads" ? `${headName(headOf(sl))} · F${sl + 1}` : T.kind === "mmu" ? `F${sl + 1}` : "";
  };
  // the prime tower, beside the parts (grows with the layer slider)
  const towerG = new THREE.Group();
  root.add(towerG);
  function buildTower(plan) {
    disposeGroup(towerG);
    if (!plan || !plan.towerH || !W) return;
    const P = PRINTERS[st.printer], side = plan.towerSide;
    const x = Math.min(P.w / 2 - side / 2 - 5, W.size.x / 2 + 12 + side / 2), y = Math.min(P.d / 2 - side / 2 - 5, Math.max(-P.d / 2 + side / 2 + 5, W.size.y / 2 - side / 2));
    const m = new THREE.Mesh(new THREE.BoxGeometry(side, side, plan.towerH).translate(x, y, plan.towerH / 2), new THREE.MeshStandardMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.55, roughness: 0.8, clippingPlanes: [clip] }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x5f6b77, clippingPlanes: [clip] }));
    towerG.add(m, e);
    towerG.userData.box = new THREE.Box3().setFromObject(m);
  }

  // ------------------------------------------------------------ after slicing
  function finishSlice() {
    disposeGroup(layG);
    if (S.lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(S.lines, 3));
      g.setAttribute("color", new THREE.BufferAttribute(S.cols, 3));
      layG.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
    }
    st.layerMax = S.nL - 1;
    refreshPlan();
    buildStrength();
    applyView();
    renderPanel();
  }
  // strength map: thin walls, weak (narrow) layers, unsupported overhangs and layer direction
  function buildStrength() {
    disposeGroup(strG);
    const { pos, tri, nT } = W;
    const nL = S.nL, lh = S.lh;
    // narrow layers, per part: much smaller cross-section than the part both below and above
    const weakO = S.areaO.map((ar) => {
      const wl = new Float32Array(nL);
      const maxA = Math.max(...ar);
      for (let k = 1; k < nL - 2; k++) {
        if (!(ar[k] > 0.01)) continue;
        let below = 0, above = 0;
        for (let d = 1; d <= 12; d++) { if (k - d >= 0) below = Math.max(below, ar[k - d]); if (k + d < nL) above = Math.max(above, ar[k + d]); }
        const ref = Math.min(below, above);
        if (ref > ar[k]) wl[k] = Math.max(0, Math.min(1, (1 - ar[k] / ref) * 1.4 - 0.2));
        if (ar[k] < 0.03 * maxA && above > 4 * ar[k]) wl[k] = Math.max(wl[k], 0.8);
      }
      return wl;
    });
    const thin = new Map();
    for (const [x, y, z] of S.thin) thin.set(`${Math.round(z / lh - 0.5)}|${Math.round(x / 1.5)}|${Math.round(y / 1.5)}`, 1);
    const colors = new Float32Array(pos.length), score = new Float32Array(pos.length / 3);
    const green = [0.2, 0.75, 0.35], yellow = [0.98, 0.8, 0.15], red = [0.92, 0.18, 0.16];
    const mix = (s) => (s < 0.5 ? green.map((g, i) => g + (yellow[i] - g) * s * 2) : yellow.map((g, i) => g + (red[i] - g) * (s - 0.5) * 2));
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const k = Math.min(nL - 1, Math.max(0, Math.floor(z / lh)));
      const weakLayer = weakO[W.vowner[v]];
      let s = Math.max(weakLayer[k], k > 0 ? weakLayer[k - 1] : 0);
      for (let dk = -1; dk <= 1 && s < 1; dk++) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (thin.has(`${k + dk}|${Math.round(x / 1.5) + di}|${Math.round(y / 1.5) + dj}`)) s = Math.max(s, 0.95);
      score[v] = s;
    }
    // unsupported overhangs sag: mark them when supports are off
    if (st.supports === "none") for (let t = 0; t < nT; t++) if (A.over[t]) for (let e = 0; e < 3; e++) { const v = tri[t * 3 + e]; score[v] = Math.max(score[v], 0.7); }
    for (let v = 0; v < score.length; v++) { const c = mix(score[v]); colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(tri, 1));
    g.computeVertexNormals();
    strG.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })));
    // the weakest layer, drawn as a ring
    let wk = -1, wv = 0.35, wo = 0;
    weakO.forEach((wl, o) => { for (let k = 0; k < nL; k++) if (wl[k] > wv) { wv = wl[k]; wk = k; wo = o; } });
    S.weakLayer = wk >= 0 ? { k: wk, z: (wk + 0.5) * lh, area: S.areaO[wo][wk], name: W.names[wo] } : null;
    S.thinCount = S.thin.length;
    // outline the weakest layer in red
    if (S.weakLayer) {
      const sg = S.segs[S.weakLayer.k], z = (S.weakLayer.k + 0.5) * lh, pts = [];
      for (let i = 0; i < sg.length; i += 4) pts.push(new THREE.Vector3(sg[i], sg[i + 1], z), new THREE.Vector3(sg[i + 2], sg[i + 3], z));
      const ring = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff1a1a, depthTest: false }));
      ring.renderOrder = 20;
      strG.add(ring);
    }
    if (S.thin.length) {
      const pts = S.thin.slice(0, 4000).map(([x, y, z]) => new THREE.Vector3(x, y, z));
      strG.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: 0xff2d55, size: 5, sizeAttenuation: false, depthTest: false })));
    }
  }
  function estimates() {
    const fil = FILAMENTS[st.filament], flow = FLOW[st.filament] || 12;
    const L = S ? S.len : null;
    const sec = LW * st.layer;
    const modelVol = L ? Object.values(L).reduce((a, b) => a + b, 0) * sec : 0;
    const vol = modelVol + (A ? A.supVol : 0);
    const speeds = SPEEDS;
    let t = 0;
    if (L) for (const [k, len] of Object.entries(L)) t += len / Math.min(speeds[k], flow / sec);
    t += (A ? A.supVol : 0) / Math.min(flow, 150 * sec) ;
    if (S) t += S.nL * 4; // layer changes and travel
    const grams = (vol * fil.rho) / 1000;
    const meters = vol / (Math.PI * 0.875 * 0.875) / 1000;
    if (S && S.total) t = (S.printTotal ?? S.total) + (A ? A.supVol : 0) / Math.min(flow, 150 * sec);
    return { vol, grams, meters, secs: t };
  }

  // ------------------------------------------------------------ show
  function applyView() {
    const v = st.view;
    plateG.visible = true;
    towerG.visible = v !== "strength";
    paintG.visible = v === "model";
    dockG.visible = v === "layers";
    supG.visible = v !== "strength" && st.supports !== "none";
    ovG.visible = v === "model";
    layG.visible = v === "layers" && !!S;
    strG.visible = v === "strength" && !!S;
    scene.state.simHide = new Set(v === "model" ? hiddenOthers() : store.doc.bodies.map((b) => b.id));
    scene.state.pose = W ? new Map(W.pose) : new Map();
    scene.refresh();
    if (layG.visible) setLayer(st.layerMax); else clip.constant = 1e9;
    if (slider) slider.hidden = v !== "layers" || !S;
    legend();
    vp.request();
  }
  const hiddenOthers = () => store.doc.bodies.filter((b) => !st.ids.includes(b.id)).map((b) => b.id);
  function setLayer(k) {
    st.layerMax = Math.max(0, Math.min(S ? S.nL - 1 : 0, k));
    clip.constant = st.view === "layers" && S ? (st.layerMax + 1) * S.lh + 1e-3 : 1e9;
    const ls = layG.children[0];
    if (ls && S) ls.geometry.setDrawRange(0, S.layerEnd[st.layerMax] || 0);
    if (slider) {
      slider.querySelector("input").max = S ? S.nL - 1 : 0;
      slider.querySelector("input").value = st.layerMax;
      slider.querySelector(".lv").textContent = S ? `Layer ${st.layerMax + 1} / ${S.nL} · ${fmt((st.layerMax + 1) * S.lh, 2)} mm` : "";
    }
    vp.request();
  }
  function legend() {
    if (legendEl) { legendEl.remove(); legendEl = null; }
    const host = document.getElementById("viewport");
    if (st.view === "layers" && S && byFilament()) {
      const T = toolsOf();
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Filament"), ...usedSlots().map((sl) => el("div", { class: "it" }, el("i", { style: { background: st.slots[sl].color, outline: "1px solid rgba(0,0,0,.25)" } }), "F" + (sl + 1) + (T.kind === "heads" ? " · nozzle " + headName(headOf(sl)) : ""))));
    } else if (st.view === "layers" && S) {
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Line type"), ...LEGEND.map(([k, l]) => el("div", { class: "it" }, el("i", { style: { background: "#" + COL[k].toString(16).padStart(6, "0") } }), l)));
    } else if (st.view === "strength" && S) {
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Print strength"), el("div", { class: "it" }, el("i", { style: { background: "#33bf59" } }), "Strong"), el("div", { class: "it" }, el("i", { style: { background: "#facc26" } }), "Weaker"), el("div", { class: "it" }, el("i", { style: { background: "#eb2e29" } }), "Weak point"), el("div", { class: "it" }, el("i", { style: { background: "#ff2d55", borderRadius: "50%" } }), "Too thin to print well"));
    } else if (st.view === "model") {
      legendEl = el("div", { class: "pslegend" }, el("div", { class: "t" }, "Overhangs"), el("div", { class: "it" }, el("i", { style: { background: st.supports === "none" ? "#ff2d2d" : "#ff7a2d" } }), st.supports === "none" ? "Needs support" : "Supported"), st.supports !== "none" ? el("div", { class: "it" }, el("i", { style: { background: "#1fb85a" } }), st.supports === "tree" ? "Tree support" : "Normal support") : null);
    }
    if (legendEl) host.append(legendEl);
  }

  // ------------------------------------------------------------ run
  let pending = 0;
  function rebuild(resliceNeeded = true) {
    clearTimeout(pending);
    pending = setTimeout(() => {
      W = buildWorld();
      if (!W) { A = null; S = null; renderPanel(); applyView(); return; }
      analyse();
      if (st.refit) { st.refit = false; frame(); }
      if (resliceNeeded) { stopAnim(); S = null; disposeGroup(layG); disposeGroup(strG); slice(); }
      applyView();
      renderPanel();
    }, 60);
  }

  // ------------------------------------------------------------ panel
  let def = null;
  function renderPanel() { if (def && app.command === def) def.render(); }
  function open() {
    st.ids = targetIds();
    root.visible = true;
    vp.grid.visible = false;
    buildPlate();
    buildDocks();
    def = {
      title: "3D Print Sim",
      okLabel: "Done",
      keepSelection: true,
      noEnter: true,
      wide: true,
      ok() { closeCmd(false); },
      hint: () => st.paintTool === "paint" ? `Painting with F${st.brush + 1}: click or drag over faces. Drag empty space to turn the view.` : st.paintTool === "fill" ? `Click a body to print it all with F${st.brush + 1}.` : st.paintTool === "erase" ? "Click painted faces to remove their paint." : st.pickFace ? "Click the face that should lie on the plate." : "Preview only: this simulates the print. It does not make G-code.",
      build(body) {
        const P = PRINTERS[st.printer];
        const nm = st.ids.map((id) => findBody(store.doc, id)?.name).filter(Boolean);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, `${nm.length ? nm.length === 1 ? nm[0] : nm.length + " bodies" : "Nothing"} on the plate. Nothing here changes your design, and no G-code is made.`));
        const solids = store.doc.bodies.filter((b) => !b.hole);
        if (solids.length > 1) {
          const pl = el("div", { class: "psplate" }, el("div", { class: "subhead", style: { margin: "0 0 3px" } }, "On the plate"));
          for (const b of solids) {
            const cb = el("input", { type: "checkbox", id: "plate-" + b.id, checked: st.ids.includes(b.id), onchange: (e) => {
              const ids = e.target.checked ? [...st.ids, b.id] : st.ids.filter((x) => x !== b.id);
              st.ids = solids.map((x) => x.id).filter((id) => ids.includes(id));
              stopAnim(); st.refit = true; rebuild();
            } });
            const lab = el("label", { class: "check platenode" }, cb, el("span", { class: "sw", style: { background: b.color || "#a7b0ba" } }), el("span", { class: "pn" }, b.name));
            // which filament this body prints with (like Orca's per-object filament)
            if (st.ids.includes(b.id) && (multiOK() || st.slots.length > 1)) {
              ensureSlots();
              const cur = st.slotOf.get(b.id) ?? 0;
              const fs = el("select", { class: "num psfil", id: "ps-slot-" + b.id, "aria-label": "Filament for " + b.name, title: "Which filament prints this body" },
                ...st.slots.map((q, i) => el("option", { value: i, selected: i === cur, style: { background: q.color, color: lightText(q.color) } }, "F" + (i + 1))),
                el("option", { value: "new" }, "+ New"));
              fs.style.background = st.slots[cur]?.color || "";
              fs.style.color = lightText(st.slots[cur]?.color);
              fs.onclick = (e) => e.stopPropagation();
              fs.onchange = () => {
                if (fs.value === "new") { st.slots.push({ color: nextFilColor() }); st.slotOf.set(b.id, st.slots.length - 1); }
                else st.slotOf.set(b.id, +fs.value);
                filamentsChanged();
              };
              lab.append(fs);
            }
            pl.append(lab);
          }
          body.append(pl);
        }
        // printers grouped by brand
        const groups = new Map();
        for (const [k, p] of Object.entries(PRINTERS)) { if (!groups.has(p.brand)) groups.set(p.brand, []); groups.get(p.brand).push([k, p]); }
        const psel = el("select", { class: "num", id: "ps-printer" }, ...[...groups].map(([brand, list]) => {
          const g = document.createElement("optgroup"); g.label = brand;
          for (const [k, p] of list) g.append(el("option", { value: k, selected: k === st.printer }, `${p.name.replace(brand + " ", "")} (${p.w}×${p.d}×${p.h})`));
          return g;
        }));
        psel.onchange = () => { st.printer = psel.value; buildPlate(); filamentsChanged(); };
        body.append(row("Printer", psel, "ps-printer"));
        body.append(el("div", { class: "hint pstools", id: "ps-tools", style: { padding: 0 } }, toolText(P)));
        // the filaments: one per toolhead / spool slot. Pick a color for each, pick one as the
        // paint brush, and paint faces of the model with it (like Orca's color painting)
        ensureSlots();
        const used = usedSlots();
        if (used.length > 1 || multiOK()) {
          const plan = lastPlan;
          const T = toolsOf();
          const fl = el("div", { class: "psfils", id: "ps-fils", role: "radiogroup", "aria-label": "Filaments (paint brush)" });
          const show = st.slots.map((_, i) => i).filter((i) => i < Math.max(T.kind === "heads" ? T.heads : T.kind === "mmu" ? Math.min(T.slots, 4) : 1, 1) || used.includes(i));
          for (const sl of show) {
            const q = st.slots[sl];
            const ci = el("input", { type: "color", value: toHex(q.color), id: "ps-fc-" + sl, title: "Filament color", onclick: (e) => e.stopPropagation(), oninput: (e) => { q.color = e.target.value; lineColors(); buildPaint(); }, onchange: () => filamentsChanged() });
            const where = T.kind === "heads" ? `nozzle ${headName(headOf(sl))}` : T.kind === "mmu" ? `${T.sys} slot ${sl + 1}` : sl === (used[0] ?? 0) ? "the nozzle" : "swap by hand";
            const g = plan && plan.slotGrams.get(sl);
            const on = !!st.paintTool && st.paintTool !== "erase" && st.brush === sl;
            const rowEl = el("div", { class: "psfrow" + (on ? " on" : "") + (used.includes(sl) ? "" : " idle"), id: "ps-frow-" + sl, role: "radio", "aria-checked": on ? "true" : "false", tabindex: 0, title: "Paint with F" + (sl + 1),
              onclick: () => { st.brush = sl; if (!st.paintTool || st.paintTool === "erase") st.paintTool = "paint"; st.view = "model"; applyView(); renderPanel(); } },
              ci, el("b", {}, "F" + (sl + 1)), el("span", {}, where), el("i", {}, g ? fmt(g, 1) + " g" : used.includes(sl) ? "" : "not used"));
            fl.append(rowEl);
          }
          const canAdd = st.slots.length < (T.kind === "single" ? 8 : Math.min(T.slots, 24));
          body.append(el("div", { class: "subhead" }, `Filaments (${used.length} used)`), fl);
          if (canAdd) fl.append(el("button", { class: "btn psadd", id: "ps-addfil", onclick: () => { st.slots.push({ color: nextFilColor() }); st.brush = st.slots.length - 1; renderPanel(); } }, "+ Add filament"));
          // color painting
          body.append(row("Paint", seg([["off", "Off"], ["paint", "Faces"], ["fill", "Whole body"], ["erase", "Erase"]], st.paintTool || "off", (v) => { st.paintTool = v === "off" ? null : v; if (st.paintTool) { st.view = "model"; applyView(); } hoverFace(-1); renderPanel(); }, "ps-paint")));
          body.append(el("div", { class: "hint", style: { padding: 0 } }, st.paintTool === "paint" ? `Click or drag over faces to paint them with F${st.brush + 1}. Painted faces print their walls and top/bottom skins in that filament.` : st.paintTool === "fill" ? `Click a body to print all of it with F${st.brush + 1}.` : st.paintTool === "erase" ? "Click painted faces to give them back their body's filament." : "Pick a filament above, then paint faces of the model with it to print them in that color.",
            st.paint.size ? el("button", { class: "linkbtn", id: "ps-clearpaint", onclick: () => { st.paint.clear(); filamentsChanged(); } }, " Clear all paint") : null));
        }
        const fsel = el("select", { class: "num", id: "ps-fil" }, ...Object.entries(FILAMENTS).map(([k, m]) => el("option", { value: k, selected: k === st.filament }, m.name)));
        fsel.onchange = () => { st.filament = fsel.value; if (S) buildStrength(); renderPanel(); applyView(); };
        body.append(row("Filament", fsel, "ps-fil"));
        body.append(row("Layer height", seg([[0.12, "0.12"], [0.16, "0.16"], [0.2, "0.20"], [0.28, "0.28"]], st.layer, (v) => { st.layer = v; rebuild(); }, "ps-lh")));
        body.append(row("Walls", seg([[1, "1"], [2, "2"], [3, "3"], [4, "4"]], st.walls, (v) => { st.walls = v; rebuild(); }, "ps-walls")));
        body.append(sliderRow("Infill", "ps-infill", st.infill, 0, 100, 5, "%", (v) => { st.infill = v; clearTimeout(st.infT); st.infT = setTimeout(() => rebuild(), 350); }));
        body.append(el("div", { class: "subhead" }, "Supports"));
        body.append(row("Type", seg([["none", "None"], ["normal", "Normal"], ["tree", "Tree"]], st.supports, (v) => { st.supports = v; rebuild(false); }, "ps-sup")));
        body.append(sliderRow("Overhang limit", "ps-thr", st.threshold, 10, 80, 1, "°", (v) => { st.threshold = v; clearTimeout(st.thrT); st.thrT = setTimeout(() => rebuild(false), 250); }));
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Surfaces that lean out more than this from upright need support under them. 45° is the rule of thumb for most printers."));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "ps-plate", checked: st.plateOnly, onchange: (e) => { st.plateOnly = e.target.checked; rebuild(false); } }), "On build plate only"));
        body.append(el("div", { class: "subhead" }, "Orientation"));
        body.append(el("div", { class: "psbtns" },
          el("button", { class: "btn" + (st.pickFace ? " primary" : ""), id: "ps-lay", onclick: () => { st.pickFace = !st.pickFace; renderPanel(); } }, "Lay on face"),
          el("button", { class: "btn", id: "ps-auto", onclick: () => autoOrient() }, "Auto orient"),
          el("button", { class: "btn", id: "ps-rx", onclick: () => rotate("x") }, "Rotate X"),
          el("button", { class: "btn", id: "ps-ry", onclick: () => rotate("y") }, "Rotate Y"),
          el("button", { class: "btn", id: "ps-reset", onclick: () => { st.R.identity(); st.refit = true; rebuild(); } }, "Reset")));
        body.append(el("div", { class: "subhead" }, "View"));
        body.append(row("Show", seg([["model", "Model"], ["layers", "Layers"], ["strength", "Strength"]], st.view, (v) => { st.view = v; applyView(); renderPanel(); X.onView && X.onView(); }, "ps-view")));
        if (st.view === "layers") body.append(row("Color by", seg([["type", "Line type"], ["filament", "Filament"]], byFilament() ? "filament" : "type", (v) => { st.colorBy = v; lineColors(); legend(); renderPanel(); }, "ps-colorby")));
        body.append(el("button", { class: "btn primary", id: "ps-play2", style: { width: "100%" }, onclick: () => togglePlay() }, anim.playing ? "❚❚ Pause print" : "▶ Play the print"));
        body.append(el("div", { class: "hint", id: "ps-status", style: { padding: 0 } }, S ? `Sliced: ${S.nL} layers.` : W ? "Slicing…" : ""));
        if (W) body.append(results(P));
        if (W) { const ab = adviceBox(); if (ab) body.append(ab); }
      },
      cleanup() { teardown(); X.onClose && X.onClose(); },
      handler: {
        hover(e) {
          if (st.paintTool && W) { const t = pickTri(e); hoverFace(t); vp.canvas.style.cursor = t >= 0 ? "crosshair" : "default"; return; }
          if (!st.pickFace || !W) { vp.canvas.style.cursor = "default"; return; }
          vp.canvas.style.cursor = pickTri(e) >= 0 ? "pointer" : "default";
        },
        down(e) {
          if (st.paintTool && W) {
            const t = pickTri(e);
            if (t < 0) return false; // empty space: orbit as usual
            st.painting = true;
            if (paintAt(t)) buildPaint();
            if (st.paintTool === "fill") { st.painting = false; filamentsChanged(); }
            return true;
          }
          if (!st.pickFace || !W) return false;
          const t = pickTri(e);
          if (t < 0) return true;
          const n = new THREE.Vector3(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]);
          const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1));
          st.R.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
          st.pickFace = false;
          st.refit = true; rebuild();
          return true;
        },
        move(e) {
          if (!st.painting) return;
          const t = pickTri(e);
          hoverFace(t);
          if (paintAt(t)) buildPaint();
        },
        up() { if (st.painting) { st.painting = false; filamentsChanged(); } },
        leave() { hoverFace(-1); },
      },
    };
    openCmd(def);
    // layer slider over the view
    const spd = el("select", { class: "num", id: "ps-speed", "aria-label": "Playback speed" }, ...PLAY_SPEEDS.map(([v, l]) => el("option", { value: v, selected: v === anim.speed }, l)));
    spd.onchange = () => { anim.speed = spd.value; };
    slider = el("div", { class: "pslayers", hidden: true },
      el("div", { class: "psplay" },
        el("button", { class: "btn primary", id: "ps-play", "aria-pressed": "false", onclick: () => togglePlay() }, "▶ Play print"),
        el("button", { class: "btn", id: "ps-restart", title: "Back to the first layer", onclick: () => { pause(); showTime(0); } }, "⏮"),
        spd,
        el("span", { class: "lv" }, "")),
      el("input", { type: "range", min: 0, max: 0, step: 1, value: 0, id: "ps-layer", "aria-label": "Layer", oninput: (e) => { pause(); if (nozzle) nozzle.visible = false; setLayer(+e.target.value); if (S && S.cum) anim.t = S.cum[Math.max(0, S.layerEnd[st.layerMax] / 2 - 1)] || 0; } }));
    slider.addEventListener("keydown", (e) => e.stopPropagation());
    document.getElementById("viewport").append(slider);
    rebuild();
    st.refit = true;
  }
  // look at the parts, keeping them clear of the settings panel on the right
  function frame() {
    if (!W) return;
    const s2 = W.size, hx = Math.max(10, s2.x / 2) * 1.15, hy = Math.max(10, s2.y / 2) * 1.15;
    vp.fit(new THREE.Box3(new THREE.Vector3(-hx, -hy, 0), new THREE.Vector3(hx + Math.max(hx, hy) * 1.1, hy, Math.max(s2.z, 8))));
  }
  function results(P) {
    const box = el("div", { class: "simres" });
    const plan = toolPlan();
    const uw = usableWidth();
    const fits = W.size.x <= uw && W.size.y <= P.d && W.size.z <= P.h;
    const est = estimates();
    const multi = plan && plan.used.length > 1 && plan.kind !== "single";
    if (multi) est.secs += plan.secs;
    const hh = Math.floor(est.secs / 3600), mm = Math.round((est.secs % 3600) / 60);
    box.append(el("div", { class: "simtiles" },
      el("div", { class: "simtile" }, el("span", {}, "Print time"), el("b", { id: "ps-time" }, S ? (hh ? `${hh} h ${mm} min` : `${mm} min`) : "…")),
      el("div", { class: "simtile" }, el("span", {}, "Filament"), el("b", { id: "ps-grams" }, S ? `${fmt(est.grams + (multi ? plan.wasteGrams : 0), 1)} g` : "…"), el("i", {}, S ? (multi ? `incl. ${fmt(plan.wasteGrams, 1)} g purge` : `${fmt(est.meters, 2)} m`) : "")),
      multi ? el("div", { class: "simtile", id: "ps-changes" }, el("span", {}, "Changes"), el("b", {}, String(plan.changes)), el("i", {}, plan.swaps ? `${plan.swaps} nozzle swap${plan.swaps === 1 ? "" : "s"}` : `${plan.flushes} purge${plan.flushes === 1 ? "" : "s"}`)) : el("div", { class: "simtile" }, el("span", {}, "Layers"), el("b", {}, S ? String(S.nL) : "…")),
      el("div", { class: "simtile" + (fits ? "" : " bad") }, el("span", {}, "Size"), el("b", { style: { fontSize: "12px" } }, `${fmt(W.size.x, 1)}×${fmt(W.size.y, 1)}×${fmt(W.size.z, 1)}`), fits ? null : el("i", {}, uw < P.w && W.size.x > uw && W.size.x <= P.w ? `Wider than ${uw} mm` : "Too big for this printer"))));
    // findings, worst first
    const notes = [];
    const fil = FILAMENTS[st.filament];
    // more than one filament: what this printer does with it
    if (plan && plan.used.length > 1) {
      const T = toolsOf(), n = plan.used.length, mins = (x) => (x >= 90 ? `${fmt(x / 60, 0)} min` : `${fmt(x, 0)} s`);
      if (T.kind === "single") {
        if (plan.mixedLayers) notes.push(["bad", `${n} filaments, but this printer has one nozzle and no filament switcher: ${plan.mixedLayers} layer${plan.mixedLayers === 1 ? " mixes" : "s mix"} colors, which only a multi-material printer can do. It would print in one color.`]);
        else notes.push(["warn", `${n} filaments: the colors only change between layers, so you can pause the print and swap the spool by hand at each change.`]);
      } else {
        if (n > T.slots) notes.push(["bad", `${n} filaments, but the ${T.sys} takes at most ${T.slots}. Put some bodies on the same filament.`]);
        if (T.kind === "mmu") notes.push([plan.wasteGrams > est.grams * 0.5 ? "warn" : "info", `${plan.changes} filament change${plan.changes === 1 ? "" : "s"} on one nozzle: each purges the old color (about ${fmt(plan.flushVol / Math.max(1, plan.flushes), 0)} mm³), ${fmt(plan.wasteGrams, 1)} g of waste with the prime tower, and adds about ${mins(plan.secs)}. Fewer layers that mix colors (or matching colors) means less waste.`]);
        else {
          const shared = plan.flushes ? ` ${plan.flushes} change${plan.flushes === 1 ? " shares" : "s share"} a nozzle with another filament and purge${plan.flushes === 1 ? "s" : ""}.` : "";
          notes.push(["good", `${plan.swaps} nozzle swap${plan.swaps === 1 ? "" : "s"}: each filament has its own ${T.lr ? "nozzle" : "toolhead"}, so only ${fmt(plan.wasteGrams, 1)} g is primed or wasted, and changes add about ${mins(plan.secs)}.${shared}`]);
          if (T.wDual && plan.heads.size > 1) notes.push([W.size.x > T.wDual ? "bad" : "info", `Both nozzles are used, so the printable width is ${T.wDual} mm (blue outline on the plate)${W.size.x > T.wDual ? `: this is ${fmt(W.size.x, 0)} mm wide. Use one nozzle, or turn the part` : ""}.`]);
        }
        if (plan.towerH) notes.push(["info", `A prime tower (${plan.towerSide}×${plan.towerSide} mm, ${fmt(plan.towerH, 1)} mm tall, gray) keeps the nozzle${T.kind === "heads" ? "s" : ""} clean between colors.`]);
      }
    } else if (multiOK() && st.ids.length > 1) notes.push(["info", `To print in more colors, give bodies different colors, or pick another filament (F1, F2…) next to each body in the list above.`]);
    if (A.overArea > 1 && st.supports === "none") notes.unshift(["bad big", `⚠ SUPPORTS ARE OFF: ${fmt(A.overArea, 0)} mm² hangs out more than ${st.threshold}° (red). This would fail. Turn on supports, or use the orientation advice below.`]);
    else if (A.overArea > 1) { const sg = (A.supVol * fil.rho) / 1000; notes.push(["ok", `${st.supports === "tree" ? "Tree" : "Normal"} supports under ${fmt(A.overArea, 0)} mm² of overhang (${sg < 0.1 ? "under 0.1" : "about " + fmt(sg, 1)} g of support).`]); }
    else notes.push(["good", "No overhangs need support in this orientation."]);
    const footprint = W.size.x * W.size.y;
    if (A.bedArea < 0.05 * footprint && W.size.z > 2.5 * Math.sqrt(Math.max(A.bedArea, 1))) notes.push(["warn", `Small contact with the plate (${fmt(A.bedArea, 0)} mm²) for its height: it may come loose. Add a brim or lay it on a bigger face.`]);
    if (S && S.weakLayer) notes.push(["warn", `Weakest layer${W.nParts > 1 ? " of " + S.weakLayer.name : ""} at ${fmt(S.weakLayer.z, 1)} mm (cross-section ${fmt(S.weakLayer.area, 1)} mm², red outline in Strength): layers split there first.`]);
    if (S && S.thinCount) notes.push(["warn", `Walls thinner than two lines (${fmt(2 * LW, 2)} mm) over about ${fmt(S.thinHeight, 1)} mm of height: weak, or may not print at all (pink dots in Strength).`]);
    notes.push(["info", `${fil.name}: layer bonds (Z) are about ${Math.round((fil.z / fil.xy) * 100)}% as strong as along the layers. Loads that pull layers apart are the weak direction.`]);
    if (fil.flexible) notes.push(["info", "TPU prints slowly; times are estimates."]);
    const ul = el("div", { class: "psnotes" }, ...notes.map(([k, t]) => el("div", { class: "psn " + k }, t)));
    box.append(ul);
    box.append(el("div", { class: "hint", style: { padding: 0 } }, "Estimates use a typical 0.4 mm nozzle profile. Your slicer's numbers will differ."));
    return box;
  }
  function pickTri(e) {
    if (!W) return -1;
    if (!pickMesh || pickMesh.userData.W !== W) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(W.pos, 3));
      g.setIndex(new THREE.BufferAttribute(W.tri, 1));
      g.computeBoundingSphere();
      pickMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      pickMesh.userData.W = W;
    }
    const h = vp.pick(e, [pickMesh])[0];
    return h ? h.faceIndex : -1;
  }
  let pickMesh = null;
  function rotate(ax) {
    const m = ax === "x" ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4().makeRotationY(Math.PI / 2);
    st.R.premultiply(m);
    st.refit = true; rebuild();
  }
  // try the main directions and the biggest flat faces; keep the one needing least support
  function autoOrient() {
    if (!W) return;
    const { pos, tri, nT } = W;
    const cand = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
    // big flat faces (grouped by normal)
    const byN = new Map();
    for (let t = 0; t < nT; t++) {
      const nx = A.nrm[t * 3], ny = A.nrm[t * 3 + 1], nz = A.nrm[t * 3 + 2];
      const key = `${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ar = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]).cross(new THREE.Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])).length() / 2;
      const e = byN.get(key) || { n: new THREE.Vector3(nx, ny, nz), a: 0 };
      e.a += ar; byN.set(key, e);
    }
    [...byN.values()].sort((p, q) => q.a - p.a).slice(0, 8).forEach((e) => cand.push(e.n.clone().normalize()));
    const cosT = Math.cos((st.threshold * Math.PI) / 180);
    let best = null;
    for (const dn of cand) {
      const q = new THREE.Quaternion().setFromUnitVectors(dn, new THREE.Vector3(0, 0, -1));
      const Rm = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const zs = new Float32Array(pos.length / 3);
      const v = new THREE.Vector3();
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 0; i < zs.length; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(Rm); zs[i] = v.z; zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z); }
      let over = 0, bed = 0;
      const nn = new THREE.Vector3();
      for (let t = 0; t < nT; t++) {
        nn.set(A.nrm[t * 3], A.nrm[t * 3 + 1], A.nrm[t * 3 + 2]).applyQuaternion(q);
        const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
        const a3 = a * 3, b3 = b * 3, c3 = c * 3;
        const ar = new THREE.Vector3(pos[b3] - pos[a3], pos[b3 + 1] - pos[a3 + 1], pos[b3 + 2] - pos[a3 + 2]).cross(new THREE.Vector3(pos[c3] - pos[a3], pos[c3 + 1] - pos[a3 + 1], pos[c3 + 2] - pos[a3 + 2])).length() / 2;
        const lo = Math.max(zs[a], zs[b], zs[c]) - zmin;
        if (lo < 0.05 && nn.z < -0.98) bed += ar;
        else if (-nn.z > cosT) over += ar;
      }
      const score = over - 0.5 * bed + 0.02 * (zmax - zmin) * Math.sqrt(Math.max(1, bed));
      if (!best || score < best.score - 1e-6) best = { score, Rm };
    }
    st.R.premultiply(best.Rm);
    st.refit = true; rebuild();
    app.toast("Turned to need the least support.");
  }
  function teardown() {
    stopAnim();
    if (banner) { banner.remove(); banner = null; }
    if (nozzle) { root.remove(nozzle); nozzle.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); nozzle = null; }
    sliceJob++;
    clearTimeout(pending);
    root.visible = false;
    vp.grid.visible = true;
    disposeGroup(supG); disposeGroup(ovG); disposeGroup(layG); disposeGroup(strG);
    if (slider) { slider.remove(); slider = null; }
    if (legendEl) { legendEl.remove(); legendEl = null; }
    scene.state.simHide = new Set();
    scene.state.pose = new Map();
    scene.refresh();
    W = null; A = null; S = null; pickMesh = null; st.pickFace = false;
    vp.request();
  }
  // ------------------------------------------------------------ the print, played back
  const PLAY_SPEEDS = [["fit", "Whole print in 30 s"], ["1", "Real time"], ["10", "10×"], ["60", "60×"], ["300", "300×"]];
  const anim = { playing: false, t: 0, speed: "fit", raf: 0, last: 0 };
  let nozzle = null;
  function makeNozzle() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.6, roughness: 0.35 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 20).rotateX(-Math.PI / 2).translate(0, 0, 1.2), metal);
    const block = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 4).translate(0, 0, 4.4), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.4, roughness: 0.5 }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    g.add(tip, block, glow);
    g.userData.glow = glow;
    g.renderOrder = 10;
    return g;
  }
  function segAt(t) {
    // the last line finished by time t (binary search)
    const c = S.cum;
    let lo = 0, hi = c.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] <= t) lo = m + 1; else hi = m; }
    return lo; // lines [0, lo) are done; line lo is being printed
  }
  function showTime(t) {
    if (!S || !S.cum) return;
    anim.t = Math.max(0, Math.min(S.total, t));
    const i = segAt(anim.t), n = S.cum.length;
    const ls = layG.children[0];
    if (ls) ls.geometry.setDrawRange(0, Math.min(n, i) * 2);
    // nozzle on the line being printed (or away changing tools / purging)
    if (!nozzle) { nozzle = makeNozzle(); root.add(nozzle); }
    nozzle.visible = i < n || anim.playing;
    const L = S.lines;
    let changing = null;
    if (i < n) {
      const t0 = i ? S.cum[i - 1] : 0, pz = (S.pause && S.pause[i]) || 0;
      const sl = S.lslot ? S.lslot[i] : 0;
      nozzle.userData.glow.material.color.set(st.slots[sl]?.color || "#ffa040");
      if (pz && anim.t < t0 + pz) {
        // a tool change or purge before this line: park at the dock / purge spot
        const T = toolsOf(), P = PRINTERS[st.printer], kind = S.pkind[i];
        const dock = dockG.userData.at && dockG.userData.at(headOf(sl));
        if (kind & 1 && dock) nozzle.position.set(dock.x, dock.y - 9, L[i * 6 + 2] + 2);
        else nozzle.position.set(-P.w / 2 + 6, P.d / 2 - 6, L[i * 6 + 2] + 3);
        changing = kind & 1 ? `changing to ${headName(headOf(sl))} (F${sl + 1})` : `${T.kind === "mmu" ? "loading" : "switching to"} F${sl + 1} and purging`;
        if (ls) ls.geometry.setDrawRange(0, i * 2);
      } else {
        const f = Math.max(0, Math.min(1, (anim.t - t0 - pz) / Math.max(1e-6, S.cum[i] - t0 - pz)));
        nozzle.position.set(L[i * 6] + (L[i * 6 + 3] - L[i * 6]) * f, L[i * 6 + 1] + (L[i * 6 + 4] - L[i * 6 + 1]) * f, L[i * 6 + 2]);
        if (ls) ls.geometry.setDrawRange(0, i * 2 + (f > 0.05 ? 2 : 0));
      }
      // the head that is printing has left its dock
      const ah = headOf(sl);
      for (const d of dockG.children) d.visible = d.userData.head !== ah || !!changing;
    } else if (n) nozzle.position.set(L[(n - 1) * 6 + 3], L[(n - 1) * 6 + 4], L[(n - 1) * 6 + 5] + 5);
    st.toolNow = i < n && S.lslot && lastPlan && lastPlan.used.length > 1 ? (changing || toolLabel(S.lslot[i])) : "";
    // which layer, for the slider and the supports
    let k = 0;
    while (k < S.nL - 1 && S.layerEnd[k] <= i * 2) k++;
    st.layerMax = k;
    clip.constant = (k + 1) * S.lh + 1e-3;
    if (slider) {
      const inp = slider.querySelector("input"); inp.max = S.nL - 1; inp.value = k;
      const clock = (x) => { x = Math.round(x); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s2 = x % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s2).padStart(2, "0"); };
      slider.querySelector(".lv").textContent = `Layer ${k + 1} / ${S.nL} · ${fmt((k + 1) * S.lh, 2)} mm · ${clock(anim.t)} of ${clock(S.total)}` + (st.toolNow ? ` · ${st.toolNow}` : "");
    }
    vp.request();
  }
  function play() {
    if (!S || !S.cum) { app.toast("Still slicing… try again in a moment."); return; }
    if (st.view !== "layers") { st.view = "layers"; applyView(); renderPanel(); X.onView && X.onView(); }
    if (anim.t >= S.total - 1e-6) anim.t = 0;
    anim.playing = true; anim.last = performance.now();
    const step = (now) => {
      if (!anim.playing || !S) return;
      const dt = (now - anim.last) / 1000; anim.last = now;
      const k = anim.speed === "fit" ? S.total / 30 : +anim.speed;
      showTime(anim.t + dt * k);
      if (anim.t >= S.total) { anim.playing = false; playUI(); return; }
      anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
    playUI();
  }
  function pause() { anim.playing = false; cancelAnimationFrame(anim.raf); playUI(); }
  function playUI() {
    const b2 = document.getElementById("ps-play2");
    if (b2) b2.textContent = anim.playing ? "❚❚ Pause print" : "▶ Play the print";
    const b = document.getElementById("ps-play");
    if (b) { b.textContent = anim.playing ? "❚❚ Pause" : "▶ Play print"; b.setAttribute("aria-pressed", anim.playing ? "true" : "false"); }
  }
  function stopAnim() { pause(); if (nozzle) nozzle.visible = false; anim.t = 0; }
  const setView = (v) => { if (v !== "layers") stopAnim(); st.view = v; applyView(); renderPanel(); };
  const layFace = () => { st.pickFace = !st.pickFace; renderPanel(); };
  const togglePlay = () => (anim.playing ? pause() : play());
  return { open, teardown, st, autoOrient, setView, layFace, rotate, togglePlay, setIds: (ids) => { st.ids = ids; stopAnim(); st.refit = true; rebuild(); } };
}
