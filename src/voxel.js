// Voxel Studio (Advanced → Simulate): turn objects into a voxel model (little cubes), paint the
// cubes' faces, add or remove cubes, then export STL or 3MF (with colors) or add it to the design.
// It opens in its own window over the app and works on a copy, so the design only changes when
// you press "Add to design".
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { el, uid, makeZip } from "./util.js";
import { nextName } from "./ops.js";
import { packMesh, toB64, contentId } from "./meshimport.js";

const PALETTE = ["#d01012", "#fe8a18", "#f2cd37", "#58ab41", "#237841", "#5a93db", "#0055bf", "#923978", "#f5a3c7", "#6c3d1d", "#ffffff", "#a0a5a9", "#1b2a34", "#000000"];
const NAMES = { "#d01012": "red", "#fe8a18": "orange", "#f2cd37": "yellow", "#58ab41": "green", "#237841": "dark green", "#5a93db": "light blue", "#0055bf": "blue", "#923978": "purple", "#f5a3c7": "pink", "#6c3d1d": "brown", "#ffffff": "white", "#a0a5a9": "gray", "#1b2a34": "dark gray", "#000000": "black" };
const colorName = (c) => NAMES[String(c).toLowerCase()] || String(c).toUpperCase();
// jumpstart-3d: imported colors must be six hex digits, including at the XML boundary.
const safeColor = (c) => typeof c === "string" && c.length === 7 && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : "#C8CCD2";
const COUNTS = [16, 24, 32, 48, 64];
const MAX_VOX = 260000;
// the six faces of a cube: direction, and the four corners of the face (unit cube, outward winding)
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const QUADS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]],
];
const TOOLS = {
  paint: { label: "Paint", tip: "Paint the faces you click or drag over" },
  cube: { label: "Cube", tip: "Paint all six faces of each cube you touch" },
  fill: { label: "Fill", tip: "Fill a flat area of one color with the new color" },
  pick: { label: "Pick", tip: "Click a face to use its color" },
  add: { label: "Add", tip: "Add a cube on the face you click" },
  erase: { label: "Remove", tip: "Remove the cube you click" },
};

export function initVoxel(app) {
  let ui = null;
  const LS = "jumpstart3d.voxel.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  // ------------------------------------------------------------------ opening
  function open() {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    const ok = (b) => b && !b.hole && !b.hidden && app.scene.views.get(b.id) && app.scene.views.get(b.id).data;
    let ids = (app.sel || []).filter((id) => ok(findBody(store.doc, id)));
    if (!ids.length) ids = store.doc.bodies.filter(ok).map((b) => b.id);
    if (!ids.length) { app.toast("Make or import an object first: Voxel Studio turns objects into cubes.", "err"); return; }
    const st = { ids, count: pref("count", 32), fill: pref("fill", "solid"), tool: "paint", color: pref("color", PALETTE[0]), mirror: false, grid: pref("grid", true), split: pref("split", true), hideOrig: true };
    buildUI(st);
    voxelizeNow();
  }
  function close() {
    if (!ui) return;
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    ui = null;
    app.vp && app.vp.request && app.vp.request();
  }

  // ------------------------------------------------------------------ objects → voxels
  function trisOf(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
    for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
    return out;
  }
  // inside: odd number of surface crossings along a vertical line through each cube's middle;
  // plus every cube the surface passes through, so thin parts (walls, letters) are kept
  function voxelize(st) {
    const objs = [], box = new THREE.Box3();
    for (const id of st.ids) {
      const t = trisOf(id); if (!t) continue;
      const b = findBody(store.doc, id);
      objs.push({ t, color: safeColor(b && b.color) }); // jumpstart-3d: normalize body colors.
      for (let i = 0; i < t.length; i += 3) box.expandByPoint(new THREE.Vector3(t[i], t[i + 1], t[i + 2]));
    }
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    let s = Math.max(size.x, size.y, size.z) / st.count;
    const est = () => Math.ceil(size.x / s) * Math.ceil(size.y / s) * Math.ceil(size.z / s);
    while (est() > MAX_VOX) s *= 1.1;
    const nx = Math.max(1, Math.ceil(size.x / s - 1e-6)), ny = Math.max(1, Math.ceil(size.y / s - 1e-6)), nz = Math.max(1, Math.ceil(size.z / s - 1e-6));
    const x0 = box.min.x + (size.x - nx * s) / 2, y0 = box.min.y + (size.y - ny * s) / 2, z0 = box.min.z;
    const N = nx * ny * nz, occ = new Uint8Array(N), col = new Uint8Array(N);
    const colors = [];
    const ci = (c) => { const i = colors.indexOf(c); if (i >= 0) return i; colors.push(c); return colors.length - 1; };
    objs.forEach((o) => {
      const t = o.t, nt = t.length / 9, c = ci(o.color);
      const cols = new Map();
      for (let f = 0; f < nt; f++) {
        const a = f * 9;
        const minx = Math.min(t[a], t[a + 3], t[a + 6]), maxx = Math.max(t[a], t[a + 3], t[a + 6]);
        const miny = Math.min(t[a + 1], t[a + 4], t[a + 7]), maxy = Math.max(t[a + 1], t[a + 4], t[a + 7]);
        const i0 = Math.max(0, Math.floor((minx - x0) / s - 0.5)), i1 = Math.min(nx - 1, Math.floor((maxx - x0) / s - 0.5) + 1);
        const j0 = Math.max(0, Math.floor((miny - y0) / s - 0.5)), j1 = Math.min(ny - 1, Math.floor((maxy - y0) / s - 0.5) + 1);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = i + j * nx; let l = cols.get(key); if (!l) cols.set(key, (l = [])); l.push(a); }
        // the surface itself, sampled finely
        const ux = t[a + 3] - t[a], uy = t[a + 4] - t[a + 1], uz = t[a + 5] - t[a + 2], vx = t[a + 6] - t[a], vy = t[a + 7] - t[a + 1], vz = t[a + 8] - t[a + 2];
        const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz));
        const m = Math.min(200, Math.max(1, Math.ceil((L / s) * 2)));
        for (let p = 0; p <= m; p++) for (let q = 0; q <= m - p; q++) {
          const x = t[a] + (ux * p + vx * q) / m, y = t[a + 1] + (uy * p + vy * q) / m, z = t[a + 2] + (uz * p + vz * q) / m;
          const i = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / s))), j = Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / s))), k = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / s)));
          const v = i + j * nx + k * nx * ny;
          if (!occ[v]) { occ[v] = 1; col[v] = c; }
        }
      }
      for (const [key, list] of cols) {
        const i = key % nx, j = (key - i) / nx, px = x0 + (i + 0.5) * s, py = y0 + (j + 0.5) * s, zs = [];
        for (const a of list) {
          const ax = t[a], ay = t[a + 1], bx = t[a + 3], by = t[a + 4], cx = t[a + 6], cy = t[a + 7];
          const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
          if (Math.abs(det) < 1e-12) continue;
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
          if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
          zs.push(l1 * t[a + 2] + l2 * t[a + 5] + l3 * t[a + 8]);
        }
        if (zs.length < 2) continue;
        zs.sort((p, q) => p - q);
        const u = [zs[0]]; for (let q = 1; q < zs.length; q++) if (zs[q] - u[u.length - 1] > 1e-6) u.push(zs[q]);
        for (let q = 0; q + 1 < u.length; q += 2) {
          const za = u[q], zb = u[q + 1];
          for (let k = Math.max(0, Math.floor((za - z0) / s)); k <= Math.min(nz - 1, Math.floor((zb - z0) / s)); k++) {
            const z = z0 + (k + 0.5) * s;
            if (z >= za && z <= zb) { const v = i + j * nx + k * nx * ny; if (!occ[v]) { occ[v] = 1; col[v] = c; } }
          }
        }
      }
    });
    // hollow: keep only the cubes that can see the outside
    if (st.fill === "hollow") {
      const keep = new Uint8Array(N);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = i + j * nx + k * nx * ny; if (!occ[v]) continue;
        for (const [dx, dy, dz] of DIRS) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || !occ[a + b * nx + c * nx * ny]) { keep[v] = 1; break; } }
      }
      occ.set(keep);
    }
    const fc = new Uint8Array(N * 6);
    for (let v = 0; v < N; v++) if (occ[v]) fc.fill(col[v], v * 6, v * 6 + 6);
    return { nx, ny, nz, s, x0, y0, z0, occ, fc, colors };
  }

  // ------------------------------------------------------------------ the surface mesh
  function surface(g, withGrid) {
    const { nx, ny, nz, s, x0, y0, z0, occ, fc, colors } = g;
    const pos = [], cols = [], faces = [], lines = [];
    const rgb = colors.map((c) => new THREE.Color(c));
    const filled = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && occ[i + j * nx + k * nx * ny];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = i + j * nx + k * nx * ny; if (!occ[v]) continue;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = DIRS[f];
        if (filled(i + dx, j + dy, k + dz)) continue;
        const q = QUADS[f].map(([a, b, c]) => [x0 + (i + a) * s, y0 + (j + b) * s, z0 + (k + c) * s]);
        const c = rgb[fc[v * 6 + f]] || rgb[0];
        for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...q[t]); cols.push(c.r, c.g, c.b); }
        faces.push(v * 6 + f, v * 6 + f);
        if (withGrid) for (let e = 0; e < 4; e++) lines.push(...q[e], ...q[(e + 1) % 4]);
      }
    }
    return { pos: new Float32Array(pos), cols: new Float32Array(cols), faces: new Int32Array(faces), lines: new Float32Array(lines) };
  }
  // each cube's main color: the color most of its outside faces have (all faces when it's buried)
  function cubeColors(g) {
    const { nx, ny, nz, occ, fc } = g, out = new Uint8Array(occ.length), cnt = new Map();
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = i + j * nx + k * nx * ny; if (!occ[v]) continue;
      cnt.clear(); let best = fc[v * 6], bn = 0;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = DIRS[f], n = vid(g, i + dx, j + dy, k + dz);
        if (n >= 0 && occ[n]) continue;
        const c = fc[v * 6 + f], m = (cnt.get(c) || 0) + 1; cnt.set(c, m); if (m > bn) { bn = m; best = c; }
      }
      out[v] = best;
    }
    return out;
  }
  // closed, welded triangle meshes for files and the design: all cubes as one part, or one part per
  // main color (each part is a closed solid; faces keep their painted colors in tc for 3MF)
  function meshes(g, byColor) {
    const { nx, ny, nz, s, x0, y0, z0, occ, fc, colors } = g;
    const cc = byColor ? cubeColors(g) : null;
    const out = new Map();
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = i + j * nx + k * nx * ny; if (!occ[v]) continue;
      const key = cc ? cc[v] : 0;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = DIRS[f], n = vid(g, i + dx, j + dy, k + dz);
        if (n >= 0 && occ[n] && (!cc || cc[n] === key)) continue;
        let m = out.get(key); if (!m) out.set(key, (m = { V: [], I: [], tc: [], map: new Map(), color: colors[key] || colors[0] }));
        const ids = QUADS[f].map(([a, b, c]) => {
          const gi = i + a, gj = j + b, gk = k + c, h = gi + gj * (nx + 1) + gk * (nx + 1) * (ny + 1);
          let id = m.map.get(h); if (id === undefined) { id = m.V.length / 3; m.map.set(h, id); m.V.push(x0 + gi * s, y0 + gj * s, z0 + gk * s); }
          return id;
        });
        m.I.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        const fcol = n >= 0 && occ[n] ? key : fc[v * 6 + f];
        m.tc.push(fcol, fcol);
      }
    }
    return [...out.values()].map((m) => ({ V: new Float32Array(m.V), I: new Uint32Array(m.I), tc: m.tc, color: m.color }));
  }

  // ------------------------------------------------------------------ UI
  function buildUI(st) {
    const root = el("div", { class: "s3d voxel", id: "voxel", role: "dialog", "aria-label": "Voxel Studio" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes bk-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "voxel-canvas" });
    const side = el("aside", { class: "bk-side", id: "voxel-side" });
    const lab = el("div", { class: "s3d-lab l" }, el("b", {}, "Voxels"), el("span", { id: "voxel-hint" }, ""));
    const view3 = el("div", { class: "bk-view" }, canvas, lab);
    panes.append(view3, side);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-1, -1.6, 2.4); scene.add(sun);
    const grid = new THREE.GridHelper(400, 50, 0xb7c3d3, 0xd5dde8); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 20000); cam.up.set(0, 0, 1);
    const group = new THREE.Group(); scene.add(group);
    const hover = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1f4fa8, depthTest: false, transparent: true })); hover.renderOrder = 5; scene.add(hover);
    ui = { st, root, bar, side, canvas, view3, renderer, scene, cam, group, grid, hover, view: { az: -Math.PI / 3, el: 0.6, dist: 300, target: new THREE.Vector3() }, raf: 0, dirty: true, pointers: new Map(), undo: [], redo: [] };
    renderBar();
    const ro = new ResizeObserver(() => resize()); ro.observe(view3); ui.ro = ro;
    resize();
    bindPointers();
    ui.onKey = (e) => {
      if (!ui) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === "Escape") { const m = ui.root.querySelector(".s3d-modal-back"); if (m) m.remove(); else close(); }
      else if (mod && k === "z" && !e.shiftKey) undo();
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) redo();
      else if (!mod && "123456".includes(k)) setTool(Object.keys(TOOLS)[+k - 1]);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    addEventListener("keydown", ui.onKey, true);
    loop();
  }
  function resize() {
    if (!ui) return;
    const r = ui.view3.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    ui.cam.aspect = r.width / Math.max(1, r.height); ui.cam.updateProjectionMatrix();
    ui.dirty = true;
  }
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    if (!ui.dirty) return;
    ui.dirty = false;
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.cam.position.copy(v.target).addScaledVector(dir, v.dist); ui.cam.lookAt(v.target);
    ui.renderer.render(ui.scene, ui.cam);
  }
  const hint = () => { const h = ui && ui.root.querySelector("#voxel-hint"); if (h) h.textContent = (TOOLS[ui.st.tool] || {}).tip + " · drag empty space to turn · right-drag to slide · scroll to zoom"; };
  function setTool(t) { if (!TOOLS[t]) return; ui.st.tool = t; renderBar(); hint(); }

  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), "data-v": v, title: t || "", onclick: () => on(v) }, l)));
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "Voxel Studio")),
      grp("Tool", seg("vx-tool", Object.entries(TOOLS).map(([k, t], i) => [k, t.label, t.tip + " (" + (i + 1) + ")"]), st.tool, setTool)),
      grp("Color", el("div", { class: "s3d-colors", id: "vx-colors" }, ...PALETTE.map((c) => el("button", { class: "s3d-col" + (c === st.color ? " on" : ""), style: { background: c }, "data-c": c, "aria-label": "Color " + c, onclick: () => { st.color = c; setPref("color", c); if (st.tool === "pick" || st.tool === "erase") st.tool = "paint"; renderBar(); } })),
        el("input", { type: "color", id: "vx-custom", value: st.color, title: "Any color", oninput: (e) => { st.color = e.target.value; }, onchange: () => renderBar() }))),
      el("span", { class: "s3d-sp" }),
      el("div", { class: "s3d-grp" }, el("small", {}, "Export"), el("div", { style: { display: "flex", gap: "6px" } }, el("button", { class: "btn", id: "vx-stl", onclick: () => exportFile("stl") }, "STL"), el("button", { class: "btn", id: "vx-3mf", title: "3MF keeps the colors", onclick: () => exportFile("3mf") }, "3MF"))),
      grp("", el("button", { class: "btn", id: "vx-cancel", onclick: () => close() }, "Close"), el("button", { class: "btn primary", id: "vx-add", onclick: () => addToDesign() }, "Add to design")),
    );
  }
  function renderSide() {
    const st = ui.st, s = ui.side, g = ui.g;
    s.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, el("small", {}, label), ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), "data-v": v, title: t || "", onclick: () => on(v) }, l)));
    s.append(el("h3", {}, "Voxel model"),
      grp("Cubes across the longest side", seg("vx-count", COUNTS.map((n) => [n, String(n), `${n} cubes along the longest side`]), st.count, (v) => { if (ui.g && ui.undo.length && !confirm("Change the size? Painting and edits so far will be lost (the model is made again).")) return; st.count = v; setPref("count", v); voxelizeNow(); })),
      grp("Inside", seg("vx-fill", [["solid", "Solid", "Cubes all the way through"], ["hollow", "Hollow", "Only the outside cubes (lighter, fewer cubes)"]], st.fill, (v) => { if (ui.g && ui.undo.length && !confirm("Make the model again? Painting and edits so far will be lost.")) return; st.fill = v; setPref("fill", v); voxelizeNow(); })),
      el("div", { class: "bk-steprow" }, el("button", { class: "btn", id: "vx-undo", title: "Undo (Ctrl+Z)", onclick: () => undo() }, "↶ Undo"), el("button", { class: "btn", id: "vx-redo", title: "Redo (Ctrl+Y)", onclick: () => redo() }, "↷ Redo")),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "vx-mirror", checked: st.mirror, onchange: (e) => { st.mirror = e.target.checked; } }), "Mirror left-right (paint and edit both sides)"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "vx-grid", checked: st.grid, onchange: (e) => { st.grid = e.target.checked; setPref("grid", st.grid); show(); } }), "Show cube lines"));
    if (!g) { s.append(el("p", { class: "bk-dim" }, "Nothing to show.")); return; }
    let n = 0; for (let v = 0; v < g.occ.length; v++) n += g.occ[v];
    const used = new Map(); const sf = surface(g, false);
    for (let f = 0; f < sf.faces.length; f += 2) { const c = g.colors[g.fc[sf.faces[f]]]; used.set(c, (used.get(c) || 0) + 1); }
    s.append(el("p", { class: "bk-dim", id: "vx-stats" }, `${n.toLocaleString()} cubes · ${g.nx} × ${g.ny} × ${g.nz} · each cube ${(+g.s.toFixed(2))} mm`),
      el("p", { class: "bk-dim" }, `Size ${(g.nx * g.s).toFixed(1)} × ${(g.ny * g.s).toFixed(1)} × ${(g.nz * g.s).toFixed(1)} mm`));
    s.append(el("small", {}, "Colors used"));
    const t = el("table", { class: "bk-parts", id: "vx-colorlist" });
    for (const [c, k] of [...used.entries()].sort((a, b) => b[1] - a[1])) t.append(el("tr", {}, el("td", {}, el("span", { class: "bk-sw", style: { background: c } })), el("td", {}, colorName(c)), el("td", { class: "n" }, `${k} faces`)));
    s.append(t);
    s.append(el("small", {}, "Add to design"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "vx-split", checked: st.split, onchange: (e) => { st.split = e.target.checked; setPref("split", st.split); } }), "One part per color (each cube goes with its main color; keeps the colors for multi-color printing)"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "vx-hide", checked: st.hideOrig, onchange: (e) => { st.hideOrig = e.target.checked; } }), "Hide the original objects"));
    s.append(el("p", { class: "hint", style: { padding: 0 } }, "Click or drag on the model with a tool. Keys 1-6 pick the tools; Ctrl+Z undoes. 3MF files keep each color as its own part, ready for a multi-color printer."));
  }
  function voxelizeNow() {
    const g = voxelize(ui.st);
    ui.g = g; ui.undo = []; ui.redo = [];
    show(); renderSide(); hint();
    if (g && !ui.framed) {
      ui.framed = true;
      const w = Math.max(g.nx, g.ny, g.nz) * g.s;
      ui.view.target.set(g.x0 + (g.nx * g.s) / 2, g.y0 + (g.ny * g.s) / 2, g.z0 + (g.nz * g.s) / 2);
      ui.view.dist = Math.max(60, w * 2.6);
      ui.grid.position.set(ui.view.target.x, ui.view.target.y, g.z0 - 0.05);
    }
  }
  function show() {
    const grp = ui.group;
    for (const c of [...grp.children]) { grp.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }
    ui.mesh = null;
    const g = ui.g; if (!g) { ui.dirty = true; return; }
    const sf = surface(g, ui.st.grid);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(sf.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(sf.cols, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.userData.faces = sf.faces;
    grp.add(mesh); ui.mesh = mesh;
    if (ui.st.grid && sf.lines.length) {
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(sf.lines, 3));
      grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x18202a, transparent: true, opacity: 0.22 })));
    }
    ui.dirty = true;
  }

  // ------------------------------------------------------------------ painting and editing
  const ray = new THREE.Raycaster();
  function pick(e) {
    if (!ui.mesh) return null;
    const r = ui.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ui.cam);
    const h = ray.intersectObject(ui.mesh, false)[0];
    if (!h) return null;
    const vf = ui.mesh.userData.faces[h.faceIndex];
    return { v: Math.floor(vf / 6), f: vf % 6, point: h.point };
  }
  const ijk = (g, v) => { const i = v % g.nx, j = Math.floor(v / g.nx) % g.ny, k = Math.floor(v / (g.nx * g.ny)); return [i, j, k]; };
  const vid = (g, i, j, k) => (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz ? -1 : i + j * g.nx + k * g.nx * g.ny);
  const mirrorOf = (g, v, f) => { const [i, j, k] = ijk(g, v); const mf = f === 0 ? 1 : f === 1 ? 0 : f; return [vid(g, g.nx - 1 - i, j, k), mf]; };
  function colorIndex(c) { const g = ui.g; let i = g.colors.indexOf(c); if (i < 0) { if (g.colors.length >= 250) i = 0; else { g.colors.push(c); i = g.colors.length - 1; } } return i; }
  function snapshot() { const g = ui.g; ui.undo.push({ occ: g.occ.slice(), fc: g.fc.slice(), colors: g.colors.slice() }); if (ui.undo.length > 40) ui.undo.shift(); ui.redo = []; }
  function restore(from, to) { const g = ui.g; const s = from.pop(); if (!s) return; to.push({ occ: g.occ.slice(), fc: g.fc.slice(), colors: g.colors.slice() }); g.occ = s.occ; g.fc = s.fc; g.colors = s.colors; show(); renderSide(); }
  const undo = () => ui.g && restore(ui.undo, ui.redo);
  const redo = () => ui.g && restore(ui.redo, ui.undo);
  // one action at a picked face (and its mirror twin); returns whether anything changed
  function apply(h) {
    const st = ui.st, g = ui.g, c = colorIndex(st.color);
    const targets = [[h.v, h.f]];
    if (st.mirror) { const m = mirrorOf(g, h.v, h.f); if (m[0] >= 0 && (m[0] !== h.v || m[1] !== h.f)) targets.push(m); }
    let changed = false;
    for (const [v, f] of targets) {
      if (st.tool === "paint") { if (g.occ[v] && g.fc[v * 6 + f] !== c) { g.fc[v * 6 + f] = c; changed = true; } }
      else if (st.tool === "cube") { if (g.occ[v]) for (let q = 0; q < 6; q++) if (g.fc[v * 6 + q] !== c) { g.fc[v * 6 + q] = c; changed = true; } }
      else if (st.tool === "erase") { if (g.occ[v]) { g.occ[v] = 0; changed = true; } }
      else if (st.tool === "add") {
        const [i, j, k] = ijk(g, v), [dx, dy, dz] = DIRS[f], n = vid(g, i + dx, j + dy, k + dz);
        if (n < 0) { app.toast("That's the edge of the voxel space. Pick more cubes across to make room.", "err"); continue; }
        if (!g.occ[n]) { g.occ[n] = 1; g.fc.fill(c, n * 6, n * 6 + 6); changed = true; }
      } else if (st.tool === "fill") changed = flood(v, f, c) || changed;
    }
    return changed;
  }
  // fill: the flat patch of same-colored faces facing the same way
  function flood(v0, f, c) {
    const g = ui.g, from = g.fc[v0 * 6 + f];
    if (from === c) return false;
    const [dx, dy, dz] = DIRS[f];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].filter((a) => !(a[0] && dx) && !(a[1] && dy) && !(a[2] && dz));
    const exposed = (v) => { const [i, j, k] = ijk(g, v), n = vid(g, i + dx, j + dy, k + dz); return g.occ[v] && (n < 0 || !g.occ[n]); };
    const seen = new Set([v0]), q = [v0];
    while (q.length) {
      const v = q.pop();
      g.fc[v * 6 + f] = c;
      const [i, j, k] = ijk(g, v);
      for (const a of axes) for (const sgn of [1, -1]) {
        const n = vid(g, i + a[0] * sgn, j + a[1] * sgn, k + a[2] * sgn);
        if (n < 0 || seen.has(n) || !exposed(n) || g.fc[n * 6 + f] !== from) continue;
        seen.add(n); q.push(n);
      }
    }
    return true;
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const p = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, tool: false };
      ui.pointers.set(e.pointerId, p);
      if (e.button !== 0 || e.shiftKey || ui.pointers.size > 1) return;
      const h = pick(e); if (!h) return;
      if (ui.st.tool === "pick") { ui.st.color = ui.g.colors[ui.g.fc[h.v * 6 + h.f]]; ui.st.tool = "paint"; renderBar(); hint(); return; }
      p.tool = true; snapshot(); p.last = h.v * 6 + h.f;
      if (apply(h)) { show(); } else ui.undo.pop();
      p.changed = true;
    });
    c.addEventListener("pointermove", (e) => {
      const p = ui.pointers.get(e.pointerId);
      if (!p) { hoverAt(e); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (p.tool) {
        // painting while dragging (adding and removing happen once per press, so they don't run away)
        if (ui.st.tool === "paint" || ui.st.tool === "cube") { const h = pick(e); if (h && h.v * 6 + h.f !== p.last) { p.last = h.v * 6 + h.f; if (apply(h)) show(); } }
        hoverAt(e);
        return;
      }
      const all = [...ui.pointers.values()];
      if (all.length >= 2) {
        const [a, b] = all, sp = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.sp0) ui.view.dist = Math.max(10, Math.min(8000, ui.view.dist * (ui.sp0 / Math.max(1, sp))));
        ui.sp0 = sp;
      } else if (p.b === 2 || p.b === 1 || p.shift) {
        const d = ui.cam.position.distanceTo(ui.view.target), k = (2 * d * Math.tan((ui.cam.fov * Math.PI) / 360)) / ui.h;
        const right = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 1);
        ui.view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else { ui.view.az -= dx * 0.008; ui.view.el = Math.max(-1.5, Math.min(1.55, ui.view.el + dy * 0.008)); }
      ui.dirty = true;
    });
    const up = (e) => { const p = ui.pointers.get(e.pointerId); ui.pointers.delete(e.pointerId); if (ui.pointers.size < 2) ui.sp0 = 0; if (p && p.tool) renderSide(); };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", () => { ui.hover.visible = false; ui.dirty = true; });
    c.addEventListener("wheel", (e) => { e.preventDefault(); ui.view.dist = Math.max(10, Math.min(8000, ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); ui.dirty = true; }, { passive: false });
  }
  // outline the face (or the new cube's spot) under the pointer
  function hoverAt(e) {
    const h = pick(e), g = ui.g;
    if (!h) { if (ui.hover.visible) { ui.hover.visible = false; ui.dirty = true; } return; }
    let [i, j, k] = ijk(g, h.v), f = h.f;
    if (ui.st.tool === "add") { const [dx, dy, dz] = DIRS[f]; i += dx; j += dy; k += dz; f = f ^ 1; }
    const q = QUADS[f].map(([a, b, c]) => new THREE.Vector3(g.x0 + (i + a) * g.s, g.y0 + (j + b) * g.s, g.z0 + (k + c) * g.s));
    const pts = []; for (let e2 = 0; e2 < 4; e2++) pts.push(q[e2], q[(e2 + 1) % 4]);
    if (ui.st.tool === "cube" || ui.st.tool === "erase") {
      const P = (a, b, c) => new THREE.Vector3(g.x0 + (i + a) * g.s, g.y0 + (j + b) * g.s, g.z0 + (k + c) * g.s);
      for (const [a, b] of [[[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 1, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 0]], [[0, 0, 1], [1, 0, 1]], [[1, 0, 1], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 0, 1]], [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[1, 1, 0], [1, 1, 1]], [[0, 1, 0], [0, 1, 1]]]) pts.push(P(...a), P(...b));
    }
    ui.hover.geometry.dispose(); ui.hover.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    ui.hover.material.color.set(ui.st.tool === "erase" ? 0xd9534f : 0x1f4fa8);
    ui.hover.visible = true; ui.dirty = true;
  }

  // ------------------------------------------------------------------ files and the design
  const num = (x) => { const r = Math.round(x * 1e5) / 1e5; return Object.is(r, -0) ? "0" : String(r); };
  function stlBytes(list) {
    let n = 0; for (const m of list) n += m.I.length / 3;
    const dv = new DataView(new ArrayBuffer(84 + n * 50)); dv.setUint32(80, n, true);
    let o = 84;
    for (const m of list) for (let t = 0; t < m.I.length; t += 3) {
      const a = m.I[t] * 3, b = m.I[t + 1] * 3, c = m.I[t + 2] * 3, V = m.V;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      for (const f of [nx / l, ny / l, nz / l, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(o, f, true); o += 4; }
      o += 2;
    }
    return new Uint8Array(dv.buffer);
  }
  async function threeMFBytes(list, name) {
    const esc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
    const hex = (c) => safeColor(c) + "FF"; // jumpstart-3d: prevent XML attribute injection.
    const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">JumpStart 3D</metadata>', ' <metadata name="Title">' + esc(name) + "</metadata>", " <resources>\n  <basematerials id=\"1\">"];
    const cols = ui.g.colors;
    cols.forEach((c) => out.push('   <base name="' + esc(colorName(c)) + '" displaycolor="' + hex(c) + '"/>'));
    out.push("  </basematerials>");
    list.forEach((m, k) => {
      out.push('  <object id="' + (k + 2) + '" type="model" name="' + esc(name + " " + colorName(m.color)) + '" pid="1" pindex="' + Math.max(0, cols.indexOf(m.color)) + '">\n   <mesh>\n    <vertices>');
      for (let i = 0; i < m.V.length; i += 3) out.push('     <vertex x="' + num(m.V[i]) + '" y="' + num(m.V[i + 1]) + '" z="' + num(m.V[i + 2]) + '"/>');
      out.push("    </vertices>\n    <triangles>");
      const own = Math.max(0, cols.indexOf(m.color));
      for (let t = 0; t < m.I.length; t += 3) out.push('     <triangle v1="' + m.I[t] + '" v2="' + m.I[t + 1] + '" v3="' + m.I[t + 2] + '"' + (m.tc && m.tc[t / 3] !== own ? ' pid="1" p1="' + m.tc[t / 3] + '"' : "") + "/>");
      out.push("    </triangles>\n   </mesh>\n  </object>");
    });
    out.push(" </resources>\n <build>");
    list.forEach((m, k) => out.push('  <item objectid="' + (k + 2) + '"/>'));
    out.push(" </build>\n</model>\n");
    const enc = new TextEncoder();
    const z = makeZip([
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: "3D/3dmodel.model", data: enc.encode(out.join("\n")) },
    ]);
    return new Uint8Array(await z.arrayBuffer());
  }
  const baseName = () => { const b = findBody(store.doc, ui.st.ids[0]); return ((ui.st.ids.length > 1 ? "Objects" : (b && b.name) || "Model") + " voxels").replace(/[\\/:*?"<>|]+/g, "").trim(); };
  async function exportFile(fmt) {
    if (!ui || !ui.g) return;
    const name = baseName();
    // STL has no colors: one solid; 3MF: one part per color
    const list = meshes(ui.g, fmt === "3mf");
    const bytes = fmt === "stl" ? stlBytes(list) : await threeMFBytes(list, name);
    ui.lastExport = { fmt, size: bytes.length, parts: list.length };
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(name + "." + fmt, bytes);
    app.onExport && app.onExport(fmt);
  }
  function addToDesign() {
    if (!ui || !ui.g) return;
    const st = ui.st, list = meshes(ui.g, st.split), ids = [], base = baseName();
    if (!list.length) { app.toast("There are no cubes left to add.", "err"); return; }
    const nt = list.reduce((a, m) => a + m.I.length / 3, 0);
    if (nt > 60000 && !confirm(`This voxel model has ${Math.round(nt / 1000)}k triangles, so it can take a minute or more to turn into solid parts and will make the design slower. Add it anyway? (Fewer cubes across is quicker.)`)) return;
    store.update((doc) => {
      doc.assets = doc.assets || {};
      for (const m of list) {
        const bytes = packMesh({ V: m.V, I: m.I }), id = contentId(bytes);
        if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: base, data: toB64(bytes) };
        const b = { id: uid("b"), name: nextName(doc, list.length > 1 ? "Voxels " + colorName(m.color) : "Voxels"), seq: nextSeq(doc), color: m.color, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] }, voxel: true };
        doc.bodies.push(b); ids.push(b.id);
      }
      if (st.hideOrig) for (const id of st.ids) { const o = findBody(doc, id); if (o) o.hidden = true; }
    }, "Voxel Studio");
    close();
    app.select && app.select(ids);
    app.toast(ids.length > 1 ? `Added the voxel model as ${ids.length} parts, one per color.` : "Added the voxel model. It takes a moment to build.");
  }

  return { open, close, get isOpen() { return !!ui; }, _ui: () => ui, _meshes: (byColor) => (ui && ui.g ? meshes(ui.g, byColor) : null) };
}
