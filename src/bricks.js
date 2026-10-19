// Jump Brick Builder (Advanced → Simulate): rebuild objects out of stud-and-tube building bricks
// (the classic 8 mm system, or a jumbo 16 mm one). The objects are sampled on the brick grid, each
// layer is filled with the biggest bricks that fit (turning 90° every layer so they lock together),
// and every brick becomes its own printable body: hollow underneath, studs on top, tubes inside, so
// the printed bricks press together and come apart again.
//
// The studio shows the brick model, a parts list and building steps (one layer at a time). The
// bricks go into the design either built (where the objects were) or laid out flat for printing.
import * as THREE from "three";
import { store, findBody, nextSeq } from "./store.js";
import { el, uid } from "./util.js";

const SIZES = [[2, 6], [2, 4], [2, 3], [2, 2], [1, 6], [1, 4], [1, 3], [1, 2], [1, 1]]; // long × short, in studs
const SYSTEMS = {
  classic: { label: "Classic 8 mm", k: 1, tip: "The standard brick size: fits the bricks you already have" },
  jumbo: { label: "Jumbo 16 mm", k: 2, tip: "Twice as big: faster to print and easy for small hands" },
};
const FITS = { snug: { label: "Snug", d: 0 }, normal: { label: "Normal", d: -0.05 }, loose: { label: "Loose", d: -0.12 } };
const PALETTE = ["#d01012", "#0055bf", "#f2cd37", "#237841", "#fe8a18", "#ffffff", "#1b2a34", "#a0a5a9", "#923978", "#58ab41", "#5a93db", "#6c3d1d"];
const MAX_ADD = 2500;

export function initBricks(app) {
  let ui = null;
  const LS = "jumpstart3d.bricks.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  // ------------------------------------------------------------------ opening
  function open() {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    const ok = (b) => b && !b.hole && !b.hidden && app.scene.views.get(b.id) && app.scene.views.get(b.id).data;
    let ids = (app.sel || []).filter((id) => ok(findBody(store.doc, id)));
    if (!ids.length) ids = store.doc.bodies.filter(ok).map((b) => b.id);
    if (!ids.length) { app.toast("Make or import an object first: Jump Brick Builder rebuilds objects out of bricks.", "err"); return; }
    const st = {
      ids, system: pref("system", "classic"), height: pref("height", "brick"), scale: pref("scale", 100), fill: pref("fill", "solid"),
      colors: pref("colors", "objects"), one: pref("one", PALETTE[0]), fit: pref("fit", "normal"),
      out: pref("out", "built"), hideOrig: true, layer: -1,
    };
    buildUI(st);
    rebuild();
  }

  // ------------------------------------------------------------------ the brick model
  // the objects' triangles in the design's space
  function trisOf(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
    for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
    return out;
  }
  const dims = (st) => {
    const k = SYSTEMS[st.system].k;
    return { k, P: 8 * k, H: (st.height === "plate" ? 3.2 : 9.6) * k };
  };
  // which grid cells are inside: vertical lines through each cell, inside where they've crossed
  // the surface an odd number of times (4 lines per cell, 2 heights per layer)
  function voxelize(st) {
    const { P, H } = dims(st), s = st.scale / 100;
    const objs = [], box = new THREE.Box3();
    for (const id of st.ids) {
      const t = trisOf(id); if (!t) continue;
      const b = findBody(store.doc, id);
      objs.push({ id, t, color: (b && b.color) || "#c8ccd2" });
      for (let i = 0; i < t.length; i += 3) box.expandByPoint(new THREE.Vector3(t[i], t[i + 1], t[i + 2]));
    }
    if (box.isEmpty()) return null;
    // scaled about the middle of the bottom
    const c = box.getCenter(new THREE.Vector3()); c.z = box.min.z;
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(s);
    const nx = Math.max(1, Math.round(size.x / P)), ny = Math.max(1, Math.round(size.y / P)), nz = Math.max(1, Math.round(size.z / H));
    const x0 = c.x - (nx * P) / 2, y0 = c.y - (ny * P) / 2, z0 = c.z;
    const occ = new Int16Array(nx * ny * nz).fill(-1), score = new Float32Array(nx * ny * nz);
    const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    objs.forEach((o, oi) => {
      const t = o.t, nt = t.length / 9;
      // the triangles over each column, by their footprint (scaled about c)
      const cols = new Map();
      const X = (v) => c.x + (v - c.x) * s, Y = (v) => c.y + (v - c.y) * s, Z = (v) => c.z + (v - c.z) * s;
      const tri = new Float32Array(t.length);
      for (let i = 0; i < t.length; i += 3) { tri[i] = X(t[i]); tri[i + 1] = Y(t[i + 1]); tri[i + 2] = Z(t[i + 2]); }
      for (let f = 0; f < nt; f++) {
        const a = f * 9;
        const minx = Math.min(tri[a], tri[a + 3], tri[a + 6]), maxx = Math.max(tri[a], tri[a + 3], tri[a + 6]);
        const miny = Math.min(tri[a + 1], tri[a + 4], tri[a + 7]), maxy = Math.max(tri[a + 1], tri[a + 4], tri[a + 7]);
        const i0 = Math.max(0, Math.floor((minx - x0) / P)), i1 = Math.min(nx - 1, Math.floor((maxx - x0) / P));
        const j0 = Math.max(0, Math.floor((miny - y0) / P)), j1 = Math.min(ny - 1, Math.floor((maxy - y0) / P));
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = i + j * nx; let l = cols.get(key); if (!l) cols.set(key, (l = [])); l.push(a); }
      }
      for (const [key, list] of cols) {
        const i = key % nx, j = (key - i) / nx;
        for (const [sx, sy] of sub) {
          const px = x0 + (i + sx) * P, py = y0 + (j + sy) * P, zs = [];
          for (const a of list) {
            const ax = tri[a], ay = tri[a + 1], bx = tri[a + 3], by = tri[a + 4], cx = tri[a + 6], cy = tri[a + 7];
            const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.abs(det) < 1e-12) continue;
            const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
            if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
            zs.push(l1 * tri[a + 2] + l2 * tri[a + 5] + l3 * tri[a + 8]);
          }
          if (zs.length < 2) continue;
          zs.sort((p, q) => p - q);
          const u = [zs[0]]; for (let q = 1; q < zs.length; q++) if (zs[q] - u[u.length - 1] > 1e-6) u.push(zs[q]);
          for (let q = 0; q + 1 < u.length; q += 2) {
            const za = u[q], zb = u[q + 1];
            for (let kz = Math.max(0, Math.floor((za - z0) / H)); kz <= Math.min(nz - 1, Math.floor((zb - z0) / H)); kz++) {
              for (const fz of [0.3, 0.7]) { const z = z0 + (kz + fz) * H; if (z >= za && z <= zb) { const v = i + j * nx + kz * nx * ny; score[v] += 1 / 8; if (occ[v] < 0 || oi === 0) occ[v] = oi; } }
            }
          }
        }
      }
    });
    for (let v = 0; v < occ.length; v++) if (score[v] < 0.37) occ[v] = -1;
    // hollow: only the cells that touch the outside (or the top and bottom)
    if (st.fill === "hollow") {
      const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : occ[i + j * nx + k * nx * ny]);
      const keep = new Uint8Array(occ.length);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (at(i, j, k) < 0) continue;
        // a wall two studs thick (one stud only on small models), so bricks overlap the layer below
        const r = nx > 6 && ny > 6 ? 2 : 1;
        let edge = k === 0 || k === nz - 1 || at(i, j, k + 1) < 0 || at(i, j, k - 1) < 0;
        for (let d = 1; d <= r && !edge; d++) if (at(i + d, j, k) < 0 || at(i - d, j, k) < 0 || at(i, j + d, k) < 0 || at(i, j - d, k) < 0) edge = true;
        if (edge) keep[i + j * nx + k * nx * ny] = 1;
      }
      for (let v = 0; v < occ.length; v++) if (!keep[v]) occ[v] = -1;
    }
    return { nx, ny, nz, x0, y0, z0, P, H, occ, objs };
  }
  // fill each layer with the biggest bricks that fit, turning 90° every layer
  function bricksOf(g, st) {
    const { nx, ny, nz, occ, objs } = g, out = [];
    const colorAt = (v, k) => (st.colors === "one" ? st.one : st.colors === "layers" ? PALETTE[k % PALETTE.length] : objs[occ[v]].color);
    for (let k = 0; k < nz; k++) {
      const used = new Uint8Array(nx * ny);
      const free = (i, j, col) => i < nx && j < ny && !used[i + j * nx] && occ[i + j * nx + k * nx * ny] >= 0 && colorAt(i + j * nx + k * nx * ny, k) === col;
      const alongX = k % 2 === 0;
      const visit = [];
      if (alongX) { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) visit.push([i, j]); }
      else { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) visit.push([i, j]); }
      for (const [i, j] of visit) {
        const v = i + j * nx + k * nx * ny;
        if (used[i + j * nx] || occ[v] < 0) continue;
        const col = colorAt(v, k);
        let pick = null;
        for (const [L, S] of SIZES) {
          for (const [a, b] of alongX ? [[L, S], [S, L]] : [[S, L], [L, S]]) {
            let fits = true;
            for (let di = 0; di < a && fits; di++) for (let dj = 0; dj < b && fits; dj++) if (!free(i + di, j + dj, col)) fits = false;
            if (fits) { pick = [a, b]; break; }
          }
          if (pick) break;
        }
        const [a, b] = pick || [1, 1];
        for (let di = 0; di < a; di++) for (let dj = 0; dj < b; dj++) used[i + di + (j + dj) * nx] = 1;
        out.push({ i, j, k, a, b, color: col });
      }
    }
    // bricks with nothing under or over them (they'd fall off)
    const cellOf = new Map();
    out.forEach((br, n) => { for (let di = 0; di < br.a; di++) for (let dj = 0; dj < br.b; dj++) cellOf.set(br.i + di + (br.j + dj) * nx + br.k * nx * ny, n); });
    let loose = 0;
    for (const br of out) {
      let held = false;
      for (let di = 0; di < br.a && !held; di++) for (let dj = 0; dj < br.b && !held; dj++) {
        const c0 = br.i + di + (br.j + dj) * nx;
        if (br.k > 0 && cellOf.has(c0 + (br.k - 1) * nx * ny)) held = true;
        if (br.k < nz - 1 && cellOf.has(c0 + (br.k + 1) * nx * ny)) held = true;
      }
      if (!held && nz > 1) { br.loose = true; loose++; }
    }
    out.loose = loose;
    return out;
  }

  // ------------------------------------------------------------------ one brick as a CAD body
  // stud-and-tube brick: hollow underneath, studs on top, tubes (or pins) inside
  function brickNode(a, b, st) {
    const { k, P, H } = dims(st), gap = 0.1, fit = FITS[st.fit].d;
    const L = a * P - 2 * gap, W = b * P - 2 * gap;
    const wall = Math.max(1.0, 1.2 * k), top = Math.max(1.0, 1.0 * k), inner = H - top;
    const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, +x.toFixed(4), +y.toFixed(4), +z.toFixed(4), 1];
    const prim = (kind, p) => ({ t: "prim", kind, p, mods: [] });
    const shell = { t: "group", children: [
      { node: prim("box", { w: +L.toFixed(4), d: +W.toFixed(4), h: +H.toFixed(4), r: 0, c: 0 }), m: T(0, 0, 0) },
      { node: prim("box", { w: +(L - 2 * wall).toFixed(4), d: +(W - 2 * wall).toFixed(4), h: +(inner + 0.01).toFixed(4), r: 0, c: 0 }), m: T(0, 0, -0.01), hole: true },
    ], mods: [] };
    const kids = [{ node: shell, m: T(0, 0, 0) }];
    const sd = +(4.8 * k + fit).toFixed(4), sh = +(1.7 * k).toFixed(4);
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) kids.push({ node: prim("cylinder", { w: sd, d: sd, h: sh }), m: T((i - (a - 1) / 2) * P, (j - (b - 1) / 2) * P, H - 0.01) });
    if (a >= 2 && b >= 2) {
      const od = +(6.51 * k).toFixed(4), wl = +(((6.51 - 4.8) / 2) * k).toFixed(4);
      for (let i = 0; i < a - 1; i++) for (let j = 0; j < b - 1; j++) kids.push({ node: prim("tube", { w: od, d: od, h: +(inner + 0.01).toFixed(4), wall: wl }), m: T((i + 1 - a / 2) * P, (j + 1 - b / 2) * P, 0) });
    } else if (a * b > 1) {
      const pd = +(3.0 * k).toFixed(4), long = a > 1;
      for (let i = 0; i < Math.max(a, b) - 1; i++) { const off = (i + 1 - Math.max(a, b) / 2) * P; kids.push({ node: prim("cylinder", { w: pd, d: pd, h: +(inner + 0.01).toFixed(4) }), m: long ? T(off, 0, 0) : T(0, off, 0) }); }
    }
    return { t: "group", children: kids, mods: [] };
  }

  // ------------------------------------------------------------------ the studio
  function buildUI(st) {
    const root = el("div", { class: "s3d bricks", id: "bricks", role: "dialog", "aria-label": "Jump Brick Builder" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes bk-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "bricks-canvas" });
    const side = el("aside", { class: "bk-side", id: "bricks-side" });
    const lab = el("div", { class: "s3d-lab l" }, el("b", {}, "Bricks"), el("span", {}, "Drag to turn · scroll or pinch to zoom · right-drag to slide"));
    const view3 = el("div", { class: "bk-view" }, canvas, lab);
    panes.append(view3, side);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-1, -1.6, 2.4); scene.add(sun);
    const grid = new THREE.GridHelper(400, 50, 0xb7c3d3, 0xd5dde8); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 20000); cam.up.set(0, 0, 1);
    const group = new THREE.Group(); scene.add(group);
    ui = { st, root, bar, side, canvas, view3, renderer, scene, cam, group, grid, view: { az: -Math.PI / 3, el: 0.6, dist: 300, target: new THREE.Vector3() }, raf: 0, dirty: true, pointers: new Map() };
    renderBar();
    const ro = new ResizeObserver(() => resize()); ro.observe(view3); ui.ro = ro;
    resize();
    bindPointers();
    ui.onKey = (e) => {
      if (!ui) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
      if (e.key === "Escape") { const m = ui.root.querySelector(".s3d-modal-back"); if (m) m.remove(); else close(); e.preventDefault(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") { step(1); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { step(-1); e.preventDefault(); }
      e.stopPropagation();
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
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (err) {} ui.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); });
    c.addEventListener("pointermove", (e) => {
      const p = ui.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      const all = [...ui.pointers.values()];
      if (all.length >= 2) {
        const [a, b] = all, sp = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.sp0) ui.view.dist = Math.max(20, Math.min(8000, ui.view.dist * (ui.sp0 / Math.max(1, sp))));
        ui.sp0 = sp;
      } else if (p.b === 2 || p.b === 1 || p.shift) {
        const d = ui.cam.position.distanceTo(ui.view.target), k = (2 * d * Math.tan((ui.cam.fov * Math.PI) / 360)) / ui.h;
        const right = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 1);
        ui.view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else { ui.view.az -= dx * 0.008; ui.view.el = Math.max(-0.2, Math.min(1.55, ui.view.el + dy * 0.008)); }
      ui.dirty = true;
    });
    const up = (e) => { ui.pointers.delete(e.pointerId); if (ui.pointers.size < 2) ui.sp0 = 0; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => { e.preventDefault(); ui.view.dist = Math.max(20, Math.min(8000, ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); ui.dirty = true; }, { passive: false });
  }

  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), title: t || "", onclick: () => on(v) }, l)));
    const set = (k) => (v) => { st[k] = v; setPref(k, v); renderBar(); rebuild(); };
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "Jump Brick Builder")),
      grp("Brick size", seg("bk-system", Object.entries(SYSTEMS).map(([k, s]) => [k, s.label, s.tip]), st.system, set("system"))),
      grp("Layers", seg("bk-height", [["brick", "Bricks", "Full-height bricks (fewer pieces)"], ["plate", "Plates", "Thin plates, a third as tall (more detail, more pieces)"]], st.height, set("height"))),
      grp("Model size", app.numField({ value: st.scale, id: "bk-scale", min: 10, max: 1000, step: 10, len: false, onCommit: (v) => { st.scale = v; setPref("scale", v); rebuild(); } })),
      grp("Inside", seg("bk-fill", [["hollow", "Hollow", "Bricks only around the outside (fewer bricks)"], ["solid", "Solid", "Filled with bricks all the way through"]], st.fill, set("fill"))),
      grp("Colors", seg("bk-colors", [["objects", "Objects"], ["layers", "Rainbow"], ["one", "One color"]], st.colors, set("colors")),
        st.colors === "one" ? el("div", { class: "s3d-colors" }, ...PALETTE.map((c) => el("button", { class: "s3d-col" + (c === st.one ? " on" : ""), style: { background: c }, "aria-label": "Color " + c, onclick: () => { st.one = c; setPref("one", c); renderBar(); rebuild(); } }))) : ""),
      grp("Fit", seg("bk-fit", Object.entries(FITS).map(([k, f]) => [k, f.label, k === "snug" ? "Tight: bricks hold hard (good printers)" : k === "loose" ? "Easy to pull apart (if prints come out tight)" : "Holds, and comes apart by hand"]), st.fit, (v) => { st.fit = v; setPref("fit", v); renderBar(); })),
      el("span", { class: "s3d-sp" }),
      grp("", el("button", { class: "btn", id: "bk-cancel", onclick: () => close() }, "Cancel"), el("button", { class: "btn primary", id: "bk-done", onclick: () => finish() }, "Add to design")),
    );
  }

  // ------------------------------------------------------------------ preview
  let unitBox = null, unitStud = null;
  function rebuild() {
    if (!ui) return;
    const st = ui.st;
    const g = voxelize(st);
    ui.grid3 = g;
    ui.bricks = g ? bricksOf(g, st) : [];
    st.layer = -1;
    show();
    renderSide();
    // frame it the first time
    if (g && !ui.framed) {
      ui.framed = true;
      const w = Math.max(g.nx * g.P, g.ny * g.P, g.nz * g.H);
      ui.view.target.set(g.x0 + (g.nx * g.P) / 2, g.y0 + (g.ny * g.P) / 2, g.z0 + (g.nz * g.H) / 2);
      ui.view.dist = Math.max(80, w * 2.4);
      ui.grid.position.set(ui.view.target.x, ui.view.target.y, g.z0 - 0.05);
    }
  }
  function show() {
    const grp = ui.group;
    for (const c of [...grp.children]) { grp.remove(c); c.material && c.material.dispose(); }
    const g = ui.grid3, list = ui.bricks;
    if (!g || !list.length) { ui.dirty = true; return; }
    unitBox = unitBox || new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    unitStud = unitStud || new THREE.CylinderGeometry(0.5, 0.5, 1, 16).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const { P, H, x0, y0, z0 } = g, k = dims(ui.st).k;
    const top = ui.st.layer, shown = list.filter((b) => top < 0 || b.k <= top);
    const nStud = shown.reduce((a, b) => a + b.a * b.b, 0);
    const bm = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 }), Math.max(1, shown.length));
    const sm = new THREE.InstancedMesh(unitStud, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 }), Math.max(1, nStud));
    const M = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0, s = 0;
    for (const b of shown) {
      const cx = x0 + (b.i + b.a / 2) * P, cy = y0 + (b.j + b.b / 2) * P, z = z0 + b.k * H;
      col.set(b.color); if (top >= 0 && b.k < top) col.multiplyScalar(0.72);
      if (b.loose) col.lerp(new THREE.Color("#ff2bd6"), 0.5);
      M.makeScale(b.a * P - 0.4, b.b * P - 0.4, H - 0.15).setPosition(cx, cy, z);
      bm.setMatrixAt(n, M); bm.setColorAt(n, col); n++;
      for (let i = 0; i < b.a; i++) for (let j = 0; j < b.b; j++) {
        M.makeScale(4.8 * k, 4.8 * k, 1.7 * k).setPosition(x0 + (b.i + i + 0.5) * P, y0 + (b.j + j + 0.5) * P, z + H - 0.15);
        sm.setMatrixAt(s, M); sm.setColorAt(s, col); s++;
      }
    }
    bm.count = n; sm.count = s;
    grp.add(bm, sm);
    ui.dirty = true;
  }
  const sizeName = (b) => Math.min(b.a, b.b) + "×" + Math.max(b.a, b.b);
  function parts(list) {
    const m = new Map();
    for (const b of list) { const key = sizeName(b) + "|" + b.color; const e = m.get(key) || { size: sizeName(b), color: b.color, n: 0, area: b.a * b.b }; e.n++; m.set(key, e); }
    return [...m.values()].sort((p, q) => q.area - p.area || q.n - p.n);
  }
  function step(d) {
    const g = ui.grid3; if (!g) return;
    const st = ui.st;
    st.layer = st.layer < 0 ? (d > 0 ? 0 : g.nz - 1) : st.layer + d;
    if (st.layer >= g.nz) st.layer = -1; else if (st.layer < 0) st.layer = -1;
    show(); renderSide();
  }
  function renderSide() {
    const s = ui.side, st = ui.st, g = ui.grid3, list = ui.bricks;
    s.innerHTML = "";
    if (!g || !list.length) {
      s.append(el("h3", {}, "No bricks yet"), el("p", { class: "hint" }, "The objects are thinner than one brick. Make the Model size bigger, or use Plates."));
      return;
    }
    const { P, H } = g;
    s.append(el("h3", {}, `${list.length} bricks`),
      el("p", { class: "bk-dim" }, `${g.nx} × ${g.ny} studs, ${g.nz} layer${g.nz > 1 ? "s" : ""} · ${(g.nx * P).toFixed(0)} × ${(g.ny * P).toFixed(0)} × ${(g.nz * H).toFixed(0)} mm`));
    if (list.length > MAX_ADD) s.append(el("p", { class: "bk-warn" }, `That's a lot of bricks. Use Hollow, Bricks (not Plates) or a smaller Model size to get under ${MAX_ADD}.`));
    if (list.loose) s.append(el("p", { class: "bk-warn" }, `${list.loose} brick${list.loose > 1 ? "s" : ""} (pink) ${list.loose > 1 ? "have" : "has"} nothing above or below to hold on to. Try Solid, or a bigger Model size.`));
    // building steps
    const L = st.layer;
    const here = L >= 0 ? list.filter((b) => b.k === L) : null;
    s.append(el("div", { class: "bk-steps" },
      el("small", {}, "Building steps"),
      el("div", { class: "bk-steprow" },
        el("button", { class: "btn", id: "bk-prev", onclick: () => step(-1), title: "Previous layer (←)" }, "◀"),
        el("span", { class: "bk-stepnow", id: "bk-step" }, L < 0 ? "Whole model" : `Layer ${L + 1} of ${g.nz}`),
        el("button", { class: "btn", id: "bk-next", onclick: () => step(1), title: "Next layer (→)" }, "▶")),
      el("p", { class: "hint", style: { padding: 0 } }, L < 0 ? "Step through the layers to see how it goes together, from the bottom up." : `Add these ${here.length} bricks (the bright ones). Each layer turns the opposite way so the bricks lock the layer below together.`)));
    // parts list (for the layer, or all)
    const rows = parts(here || list);
    s.append(el("small", { class: "bk-ph" }, here ? "Bricks in this layer" : "Parts list"),
      el("table", { class: "bk-parts", id: "bk-parts" }, el("tbody", {}, ...rows.map((r) => el("tr", {}, el("td", {}, el("span", { class: "bk-sw", style: { background: r.color } })), el("td", {}, r.size + (st.height === "plate" ? " plate" : " brick")), el("td", { class: "n" }, "× " + r.n))))));
    // how it goes into the design
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), title: t || "", onclick: () => on(v) }, l)));
    s.append(el("small", { class: "bk-ph" }, "Add to the design"),
      seg("bk-out", [["built", "Built", "The bricks stacked where your objects are"], ["print", "Ready to print", "Every brick laid out flat on print beds, studs up"]], st.out, (v) => { st.out = v; setPref("out", v); renderSide(); }),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "bk-hide", checked: st.hideOrig, onchange: (e) => { st.hideOrig = e.target.checked; } }), "Hide the original objects"),
      el("p", { class: "hint", style: { padding: 0 } }, st.out === "print" ? "Bricks are laid out studs-up on 256 × 256 mm beds. Export → 3MF keeps each brick a separate part for your slicer." : "Each brick is its own body, so you can move them, color them or print them one by one."));
  }

  // ------------------------------------------------------------------ into the design
  function finish() {
    const st = ui.st, g = ui.grid3, list = ui.bricks;
    if (!g || !list.length) { app.toast("There are no bricks to add.", "err"); return; }
    if (list.length > MAX_ADD) { app.toast(`That's ${list.length} bricks: get it under ${MAX_ADD} first (Hollow, Bricks or a smaller Model size).`, "err"); return; }
    const { P, H, x0, y0, z0 } = g;
    const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, +x.toFixed(4), +y.toFixed(4), +z.toFixed(4), 1];
    const nodes = new Map();
    const nodeFor = (a, b) => { const key = a + "x" + b; if (!nodes.has(key)) nodes.set(key, brickNode(a, b, st)); return JSON.parse(JSON.stringify(nodes.get(key))); };
    // laid out for printing: rows on 256 mm beds, beds side by side
    const place = [];
    if (st.out === "print") {
      const BED = 256, gap = 4 + P * 0.25;
      const order = list.map((b, n) => n).sort((p, q) => list[q].a * list[q].b - list[p].a * list[p].b || (list[p].color < list[q].color ? -1 : 1));
      let bed = 0, x = 0, y = 0, rowH = 0;
      const ox = g.x0 + g.nx * P + 40;
      for (const n of order) {
        const b = list[n], w = b.a * P, d = b.b * P;
        if (x + w > BED) { x = 0; y += rowH + gap; rowH = 0; }
        if (y + d > BED) { bed++; x = 0; y = 0; rowH = 0; }
        place[n] = [ox + bed * (BED + 30) + x + w / 2, g.y0 + y + d / 2, 0, bed];
        x += w + gap; rowH = Math.max(rowH, d);
      }
    }
    const ids = [];
    store.update((doc) => {
      for (const [n, b] of list.entries()) {
        const id = uid("b");
        const pos = st.out === "print" ? place[n] : [x0 + (b.i + b.a / 2) * P, y0 + (b.j + b.b / 2) * P, z0 + b.k * H];
        const name = `Brick ${sizeName(b)} · ${st.out === "print" ? "bed " + (pos[3] + 1) : "layer " + (b.k + 1)}`;
        doc.bodies.push({ id, name, seq: nextSeq(doc), color: b.color, hole: false, hidden: false, m: T(pos[0], pos[1], pos[2]), node: nodeFor(b.a, b.b), brick: { layer: b.k, size: sizeName(b) } });
        ids.push(id);
      }
      if (st.hideOrig) for (const id of st.ids) { const o = findBody(doc, id); if (o) o.hidden = true; }
    }, "Jump Brick Builder");
    const n = list.length, types = nodes.size;
    close();
    app.toast(`Added ${n} bricks (${types} kind${types > 1 ? "s" : ""}). Each kind is built once, so they appear in a few moments.`);
    if (app.vp && app.scene.allBox) setTimeout(() => { const bx = app.scene.allBox(); if (!bx.isEmpty()) app.vp.fit(bx); }, 600);
  }
  function close() {
    if (!ui) return;
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    for (const c of [...ui.group.children]) { ui.group.remove(c); c.material && c.material.dispose(); }
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    ui = null;
  }
  return { open, close, get active() { return !!ui; }, _ui: () => ui, _node: (a, b, st) => brickNode(a, b, st) };
}
