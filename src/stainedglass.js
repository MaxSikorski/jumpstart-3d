// Stained Glass Studio: turn an object (or a lamp shade) into stained glass: pieces of coloured
// glass held by a lead, copper-foil or brass frame, like a Tiffany lamp or a glass statue.
// It opens in its own window over the app (from Advanced, Beginner and Chisel) and works on a
// copy: pick the shape, how it's cut into pieces and how thick the glass and the frame are,
// paint the pieces, then export STL, 3MF (colours kept) or OBJ, or add it to the design.
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { el, uid, makeZip } from "./util.js";
import { nextName } from "./ops.js";
import { packMesh, toB64, contentId, simplify } from "./meshimport.js";
import * as SG from "./sglass.js";

const GLASS = ["#c8202f", "#e8523a", "#f08a24", "#f2c230", "#f3e19a", "#9fd45a", "#3f8f3a", "#1f6b4f", "#39a0d0", "#1f4fb4", "#2a2f8f", "#6a2fa0", "#b52f7a", "#f2a2c0", "#e9e4d8", "#d9ecf4", "#8a5a2b", "#2b2b31"];
const NAMES = { "#c8202f": "ruby red", "#e8523a": "coral", "#f08a24": "amber", "#f2c230": "gold", "#f3e19a": "cream", "#9fd45a": "spring green", "#3f8f3a": "green", "#1f6b4f": "emerald", "#39a0d0": "sky blue", "#1f4fb4": "cobalt blue", "#2a2f8f": "deep blue", "#6a2fa0": "violet", "#b52f7a": "magenta", "#f2a2c0": "pink", "#e9e4d8": "white opal", "#d9ecf4": "clear", "#8a5a2b": "brown", "#2b2b31": "black" };
const colorName = (c) => NAMES[String(c).toLowerCase()] || String(c).toUpperCase();
const PALETTES = {
  tiffany: ["#f2c230", "#f08a24", "#e8523a", "#9fd45a", "#3f8f3a", "#f3e19a", "#e9e4d8"],
  cathedral: ["#1f4fb4", "#c8202f", "#f2c230", "#3f8f3a", "#6a2fa0", "#f08a24", "#39a0d0"],
  ocean: ["#1f4fb4", "#39a0d0", "#d9ecf4", "#1f6b4f", "#2a2f8f", "#9fd45a"],
  sunset: ["#e8523a", "#f08a24", "#f2c230", "#b52f7a", "#6a2fa0", "#f2a2c0"],
  forest: ["#1f6b4f", "#3f8f3a", "#9fd45a", "#8a5a2b", "#f3e19a", "#f2c230"],
  pastel: ["#f2a2c0", "#f3e19a", "#d9ecf4", "#9fd45a", "#e9e4d8", "#b598d9"],
  rainbow: ["#c8202f", "#f08a24", "#f2c230", "#3f8f3a", "#1f4fb4", "#6a2fa0"],
};
const FRAMES = { lead: ["Lead", "#4a4d52"], copper: ["Copper foil", "#b06a3b"], brass: ["Brass", "#c8a24a"], black: ["Black", "#222326"], silver: ["Silver", "#c0c4c9"] };
const TOOLS = { paint: { label: "Paint", tip: "Paint the pieces you click or drag over" }, fill: { label: "Fill", tip: "Paint every piece of the clicked colour" }, pick: { label: "Pick", tip: "Click a piece to use its colour" } };

export function initStainedGlass(app) {
  let ui = null;
  const LS = "jumpstart3d.sglass.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  function open() {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    const ok = (b) => b && !b.hole && !b.hidden && app.scene.views.get(b.id) && app.scene.views.get(b.id).data;
    const ids = (app.sel || []).filter((id) => ok(findBody(store.doc, id)));
    const st = {
      ids, source: ids.length ? "design" : pref("shade", "dome"), pattern: (() => { const sh = ids.length ? null : SG.SHADES[pref("shade", "dome")], p = pref("pattern", "tiffany"); return sh && sh.square ? "mission" : p === "mission" ? "tiffany" : p; })(), pieces: pref("pieces", 120),
      tg: pref("tg", 1.6), wf: pref("wf", 2.4), tf: pref("tf", 3.2), frame: pref("frame", "lead"), palette: pref("palette", "tiffany"),
      glass: pref("glass", "cathedral"), light: true, base: pref("base", true), stand: false, size: pref("size", 160), seed: 1,
      tool: "paint", color: pref("color", GLASS[3]), hideOrig: true, split: true,
      // snap-fit kit: the frame prints as one part, each piece of glass on its own and snaps in
      build: pref("build", "kit"), clear: pref("clear", 0.2),
      // bulb fitting: a spider plate for a standard socket, harp or lamp rod
      fitting: pref("fitting", "none"), fitPos: pref("fitPos", "top"), fitHole: pref("fitHole", 0),
      // a picture: its colour areas become the pieces (a flat panel, or wrapped around a shade)
      pic: null, picName: "", picColors: pref("picColors", 7), pieceMM: pref("pieceMM", 22), panelShape: pref("panelShape", "rect"), repeats: pref("repeats", 4), matchGlass: pref("matchGlass", true), panelW: pref("panelW", 160),
    };
    buildUI(st);
    rebuild();
  }
  function close() {
    if (!ui) return;
    cancelAnimationFrame(ui.raf);
    clearTimeout(ui.timer);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect();
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    ui = null;
    app.vp && app.vp.request && app.vp.request();
  }

  // ------------------------------------------------------------------ the source surface
  function trisOf(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
    for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
    return out;
  }
  function sourceSoup(st) {
    if (st.source === "panel") {
      if (!st.pic) return null;
      const w = st.panelW, h = (w * st.pic.H) / st.pic.W;
      return { soup: SG.panelMesh(w, h, st.panelShape, st.pic, 50000), lamp: false, panel: { w, h } };
    }
    if (st.source === "design") {
      const parts = st.ids.map(trisOf).filter(Boolean);
      if (!parts.length) return null;
      const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n); let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return { soup: out, lamp: false };
    }
    const S = SG.SHADES[st.source] || SG.SHADES.dome;
    if (S.square) { const wB = st.size, wT = st.size * 0.38, h = st.size * 0.62; return { soup: SG.squareShadeSoup(wB, wT, h), lamp: !!S.base, square: { wB, wT, h } }; }
    const prof = S.prof(), w = Math.max(...prof.map((q) => q[0])) * 2, k = st.size / w;
    return { soup: SG.latheSoup(prof.map(([r, z]) => [r * k, z * k]), 72), lamp: !!S.base };
  }

  // ------------------------------------------------------------------ making the glass
  function make(st, light = false) {
    const src = sourceSoup(st);
    if (!src) return null;
    let m = SG.weld(src.soup, 1e-3);
    // fine enough for the pieces: about 120 triangles per piece, at most 60 000
    let area = 0; for (let t = 0; t < m.T.length; t += 3) { const P = m.P, a = m.T[t] * 3, b = m.T[t + 1] * 3, c = m.T[t + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; }
    const edge = Math.sqrt((area / Math.max(20, st.pieces * 120)) * 2.3);
    if (!src.panel && !src.square) m = SG.refine(m, light ? edge * 1.6 : edge, light ? 24000 : 60000);
    const topo = SG.topology(m);
    let part;
    const usePic = st.pic && (src.panel || st.pattern === "picture");
    if (usePic) {
      // the picture's colour areas, cut into pieces no bigger than about pieceMM across
      let uvOf;
      if (src.panel) { const { w, h } = src.panel; uvOf = (t) => [topo.C[t * 3] / w + 0.5, topo.C[t * 3 + 1] / h + 0.5]; }
      else {
        let z0 = Infinity, z1 = -Infinity; for (let i = 2; i < m.P.length; i += 3) { z0 = Math.min(z0, m.P[i]); z1 = Math.max(z1, m.P[i]); }
        uvOf = (t) => { const a = (Math.atan2(topo.C[t * 3 + 1], topo.C[t * 3]) / (2 * Math.PI) + 0.5) * st.repeats; return [a - Math.floor(a), (topo.C[t * 3 + 2] - z0) / Math.max(1e-6, z1 - z0)]; };
      }
      part = SG.pictureParts(m, topo, st.pic, uvOf, st.pieceMM * st.pieceMM * 0.8, st.seed);
      if (st.matchGlass) part.colors = part.colors.map(nearestGlass);
    } else if (src.square && st.pattern === "mission") {
      part = SG.missionParts(m, topo, src.square.wB, src.square.wT, src.square.h);
    } else part = SG.partition(m, topo, { pattern: st.pattern === "picture" ? "tiffany" : st.pattern, pieces: st.pieces, seed: st.seed });
    const tf = Math.max(st.tf, st.tg + 0.4);
    // smooth lead lines (no stair steps across the triangles)
    const topo2 = SG.smoothBorders(m, topo, part, 6);
    const kit = st.build === "kit" ? kitDims(st) : null;
    const glass = SG.glassPieces(m, topo2, part, st.tg, kit ? kit.web / 2 + kit.clear : st.wf * 0.45);
    const segs = SG.borders(m, topo2, part, st.tg);
    const frame = kit ? SG.kitFrameMesh(segs, kit, light ? 3e6 : 7e6) : SG.frameMesh(segs, st.wf, tf, light ? 3e6 : 7e6, light ? 1.05 : 1.6);
    // lamp: a base under the shade, the shade's top resting on the stem
    let extra = null, lift = 0;
    let z0 = Infinity, z1 = -Infinity, cx = 0, cy = 0;
    for (let i = 0; i < m.P.length; i += 3) { z0 = Math.min(z0, m.P[i + 2]); z1 = Math.max(z1, m.P[i + 2]); }
    const F = src.lamp || src.square ? SG.FITTINGS[st.fitting] : null, fit = F && F.hole ? F : null, hole = fit ? st.fitHole || fit.hole : 0;
    const FT = 3; // fitter plate thickness
    let fz0 = Infinity, fz1 = -Infinity; for (let i = 2; i < frame.V.length; i += 3) { fz0 = Math.min(fz0, frame.V[i]); fz1 = Math.max(fz1, frame.V[i]); }
    if (src.lamp && st.base) {
      const bore = fit ? 5.25 : 0; // a 10.5 mm hole down the base for a 1/8 IPS / M10 lamp rod and the cord
      const b = src.square ? SG.squareLampBase(z1 - z0, bore) : SG.lampBase(z1 - z0, bore); let top = 0; for (let i = 2; i < b.V.length; i += 3) top = Math.max(top, b.V[i]);
      // fitter at the bottom: the socket stands on the base, the plate clamped by its shade ring
      // about 35 mm up, and the shade sits on the plate; otherwise the shade's top rests on the stem
      lift = fit && st.fitPos === "bottom" ? top + 35 + FT - fz0 : top - (z1 - z0) * 0.98 - z0;
      extra = { mesh: b, name: "Lamp base" };
    }
    else if (st.stand && st.source === "design") {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < m.P.length; i += 3) { x0 = Math.min(x0, m.P[i]); x1 = Math.max(x1, m.P[i]); y0 = Math.min(y0, m.P[i + 1]); y1 = Math.max(y1, m.P[i + 1]); }
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
      const r = Math.max(x1 - x0, y1 - y0) * 0.62, hh = Math.max(6, (z1 - z0) * 0.08);
      const b = SG.latheSolid([[0.01, 0], [r, 0], [r, hh * 0.7], [r * 0.94, hh], [0.01, hh]], 48);
      for (let i = 0; i < b.V.length; i += 3) { b.V[i] += cx; b.V[i + 1] += cy; b.V[i + 2] += z0 - hh + 0.5; }
      extra = { mesh: b, name: "Stand" };
    }
    // a flat panel lies on the plate: lift it so the frame's underside is at z = 0
    if (src.panel) { let lo = Infinity; for (const M of [glass, frame]) for (let i = 2; i < M.V.length; i += 3) lo = Math.min(lo, M.V[i]); lift = -lo; }
    if (lift) { for (const M of [glass, frame]) for (let i = 2; i < M.V.length; i += 3) M.V[i] += lift; }
    let fitter = null, fitter_sock = null;
    if (fit) {
      const P = new Float64Array(m.P.length); for (let i = 0; i < P.length; i += 3) { P[i] = m.P[i]; P[i + 1] = m.P[i + 1]; P[i + 2] = m.P[i + 2] + lift; }
      const top = st.fitPos !== "bottom", zr = (top ? z1 : z0) + lift;
      // where the socket goes (shown in the view only, not exported)
      const zp = top ? fz1 + lift : fz0 + lift - FT;
      if (st.fitting !== "harp") fitter_sock = { r: Math.min(hole / 2 - 0.4, 19.85), z0: top ? zp - 45 : zp - 35, z1: top ? zp + FT + 8 : zp + FT + 21, up: !top };
      fitter = { name: "Bulb fitter (" + (st.fitHole || fit.hole) + " mm hole)", mesh: SG.fitterMesh(P, zr, top ? fz1 + lift : fz0 + lift - FT, hole, { t: FT, spokes: src.square ? 4 : 3, spoke0: src.square ? Math.PI / 4 : Math.PI / 2, ring: Math.max(6, st.wf + 4) }) };
    }
    if (fitter) fitter.sock = fitter_sock;
    return { m, topo: topo2, part, glass, frame, extra, fitter, count: part.count, picColors: part.colors || null, kit, panel: src.panel || null, lift, segs };
  }
  // the H-came of the kit, from the frame width and thickness and the glass thickness
  function kitDims(st) {
    const tf = Math.max(st.tf, st.tg + 1.2), extra = tf - st.tg;
    const lipT = Math.max(0.6, extra * 0.45), capH = Math.max(0.6, extra - lipT);
    const web = Math.max(0.8, Math.min(st.wf * 0.45, st.wf - 1.6));
    return { wf: Math.max(st.wf, web + 1.6), web, tg: st.tg, lipT, capH, bump: Math.min(0.5, Math.max(0.25, st.clear + 0.25)), clear: st.clear };
  }
  function nearestGlass(c) {
    const q = new THREE.Color(c); let best = GLASS[0], bd = Infinity;
    for (const g of GLASS) { const k = new THREE.Color(g), d = (k.r - q.r) ** 2 + (k.g - q.g) ** 2 + (k.b - q.b) ** 2; if (d < bd) { bd = d; best = g; } }
    return best;
  }
  // a picture file: PNG, JPEG or SVG, drawn at up to 240 pixels across, then reduced to colours
  function loadPicture(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 240 / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
      const w = Math.max(8, Math.round((img.naturalWidth || 240) * k)), h = Math.max(8, Math.round((img.naturalHeight || 240) * k));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d"); g.clearRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      ui.st.picRaw = { px: g.getImageData(0, 0, w, h).data, w, h };
      ui.st.picName = file.name;
      makePicLabels();
      if (ui.st.source === "design" || !SG.SHADES[ui.st.source]) ui.st.source = "panel";
      else if (ui.st.source !== "panel") ui.st.pattern = "picture";
      ui.framed = false;
      rebuild();
    };
    img.onerror = () => { URL.revokeObjectURL(url); app.toast("That picture couldn't be opened. Try a PNG, JPG or SVG file.", "err"); };
    img.src = url;
  }
  function makePicLabels() {
    const r = ui.st.picRaw; if (!r) return;
    ui.st.pic = SG.pictureLabels(r.px, r.w, r.h, { colors: ui.st.picColors, seed: 5 });
  }
  function pickPicture() {
    const inp = el("input", { type: "file", accept: "image/png,image/jpeg,image/svg+xml,.svg,.png,.jpg,.jpeg", style: { display: "none" } });
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) loadPicture(f); };
    document.body.append(inp); inp.click();
  }
  function autoColors(st, n, mode) {
    const pal = PALETTES[st.palette] || PALETTES.tiffany, out = [];
    let s = (st.seed * 7919 + n) >>> 0;
    const R = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    if (mode === "height" && ui && ui.g) {
      // by height: the palette from bottom to top
      const g = ui.g, zr = new Float64Array(n), cnt = new Float64Array(n); let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < g.glass.R.length; v++) { const r = g.glass.R[v], z = g.glass.V[v * 3 + 2]; zr[r] += z; cnt[r]++; }
      for (let r = 0; r < n; r++) { zr[r] /= cnt[r] || 1; lo = Math.min(lo, zr[r]); hi = Math.max(hi, zr[r]); }
      for (let r = 0; r < n; r++) { const t = (zr[r] - lo) / Math.max(1e-6, hi - lo); out.push(pal[Math.min(pal.length - 1, Math.floor((1 - t) * pal.length * 0.999 + (R() - 0.5) * 0.9))] || pal[0]); }
      return out;
    }
    for (let r = 0; r < n; r++) out.push(pal[Math.floor(R() * pal.length)]);
    return out;
  }
  function rebuild(keepColors = false) {
    if (!ui) return;
    const st = ui.st;
    setStatus("Cutting the glass…");
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => {
      if (!ui) return;
      const t0 = performance.now();
      let g = null;
      try { g = make(st); } catch (e) { console.warn(e); setStatus("That shape couldn't be made into glass: " + (e.message || e)); return; }
      if (!g) { setStatus("Pick a shape: select an object in your design first, or choose a lamp shade."); return; }
      const old = ui.cols;
      ui.g = g;
      ui.cols = keepColors && old && old.length === g.count ? old : g.picColors ? g.picColors.slice() : autoColors(st, g.count);
      show(); renderSide();
      if (!ui.framed) frameView();
      setStatus(`${g.count} pieces · built in ${Math.round(performance.now() - t0)} ms`);
    }, 30);
  }

  // ------------------------------------------------------------------ the window
  function buildUI(st) {
    const root = el("div", { class: "s3d sglass", id: "sglass", role: "dialog", "aria-label": "Stained Glass Studio" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes bk-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "sglass-canvas" });
    const side = el("aside", { class: "bk-side", id: "sglass-side" });
    const lab = el("div", { class: "s3d-lab l" }, el("b", {}, "Stained glass"), el("span", { id: "sglass-hint" }, ""));
    const status = el("div", { class: "s3d-lab r", id: "sglass-status", style: { right: "10px", left: "auto", top: "auto", bottom: "10px" } }, "");
    const view3 = el("div", { class: "bk-view" }, canvas, lab, status);
    panes.append(view3, side);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-1, -1.6, 2.4); scene.add(sun);
    const bulb = new THREE.PointLight(0xffd9a0, 0, 0, 1.2); scene.add(bulb);
    const grid = new THREE.GridHelper(600, 60, 0xb7c3d3, 0xd5dde8); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 30000); cam.up.set(0, 0, 1);
    const group = new THREE.Group(); scene.add(group);
    ui = { st, root, bar, side, canvas, view3, renderer, scene, cam, group, grid, hemi, sun, bulb, view: { az: -Math.PI / 3, el: 0.35, dist: 500, target: new THREE.Vector3() }, raf: 0, dirty: true, pointers: new Map(), undo: [], redo: [] };
    renderBar();
    const ro = new ResizeObserver(() => resize()); ro.observe(view3); ui.ro = ro;
    resize();
    bindPointers();
    ui.onKey = (e) => {
      if (!ui) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === "Escape") close();
      else if (mod && k === "z" && !e.shiftKey) undo();
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) redo();
      else if (!mod && "123".includes(k)) setTool(Object.keys(TOOLS)[+k - 1]);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    addEventListener("keydown", ui.onKey, true);
    hint();
    loop();
  }
  function setStatus(t) { const s = ui && ui.root.querySelector("#sglass-status"); if (s) s.textContent = t; }
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
  const hint = () => { const h = ui && ui.root.querySelector("#sglass-hint"); if (h) h.textContent = (TOOLS[ui.st.tool] || {}).tip + " · drag empty space to turn · right-drag to slide · scroll to zoom"; };
  function setTool(t) { if (!TOOLS[t]) return; ui.st.tool = t; renderBar(); hint(); }
  function frameView() {
    const b = new THREE.Box3().setFromObject(ui.group);
    if (b.isEmpty()) return;
    ui.framed = true;
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    ui.view.target.copy(c); ui.view.dist = Math.max(80, s * 1.7);
    ui.grid.position.set(c.x, c.y, b.min.z - 0.05);
    ui.dirty = true;
  }

  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), "data-v": v, title: t || "", onclick: () => on(v) }, l)));
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "Stained Glass Studio")),
      grp("Tool", seg("sg-tool", Object.entries(TOOLS).map(([k, t], i) => [k, t.label, t.tip + " (" + (i + 1) + ")"]), st.tool, setTool)),
      grp("Glass colour", el("div", { class: "s3d-colors", id: "sg-colors", style: { flexWrap: "wrap", maxWidth: "430px" } }, ...GLASS.map((c) => el("button", { class: "s3d-col" + (c === st.color ? " on" : ""), style: { background: c }, "data-c": c, title: colorName(c), "aria-label": "Colour " + colorName(c), onclick: () => { st.color = c; setPref("color", c); if (st.tool === "pick") st.tool = "paint"; renderBar(); } })),
        el("input", { type: "color", id: "sg-custom", value: st.color, title: "Any colour", oninput: (e) => { st.color = e.target.value; }, onchange: () => renderBar() }))),
      el("span", { class: "s3d-sp" }),
      el("div", { class: "s3d-grp" }, el("small", {}, "Export"), el("div", { style: { display: "flex", gap: "6px" } },
        el("button", { class: "btn", id: "sg-stl", onclick: () => exportFile("stl") }, "STL"),
        el("button", { class: "btn", id: "sg-3mf", title: "3MF keeps the colours: each glass colour and the frame are their own parts", onclick: () => exportFile("3mf") }, "3MF"),
        el("button", { class: "btn", id: "sg-obj", title: "OBJ with colours on the corners", onclick: () => exportFile("obj") }, "OBJ"),
        el("button", { class: "btn", id: "sg-zip", title: "Every part as its own STL file (the frame, and each glass piece), with a numbered piece map", onclick: () => exportFile("zip") }, "Parts (ZIP)"),
        el("button", { class: "btn", id: "sg-zipc", title: "One STL file per glass colour (all the pieces of that colour together), plus the frame: print each colour in one go", onclick: () => exportFile("zipc") }, "By colour (ZIP)"))),
      grp("", el("button", { class: "btn", id: "sg-close", onclick: () => close() }, "Close"), el("button", { class: "btn primary", id: "sg-add", onclick: () => addToDesign() }, "Add to design")),
    );
  }
  function renderSide() {
    const st = ui.st, s = ui.side, g = ui.g;
    s.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, el("small", {}, label), ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id, style: { flexWrap: "wrap" } }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), "data-v": v, title: t || "", onclick: () => on(v) }, l)));
    const slider = (id, label, k, min, max, step, unit, after) => {
      const out = el("b", { id: id + "-v" }, st[k] + (unit ? " " + unit : ""));
      const inp = el("input", { type: "range", id, min, max, step, value: st[k], oninput: (e) => { st[k] = +e.target.value; out.textContent = st[k] + (unit ? " " + unit : ""); }, onchange: () => { setPref(k, st[k]); after(); } });
      return el("label", { class: "sg-sl", style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", alignItems: "center" } }, el("span", {}, label), out, el("span", { style: { gridColumn: "1 / span 2" } }, inp));
    };
    const shades = Object.entries(SG.SHADES).map(([k, v]) => [k, v.name]);
    const srcSel = el("select", { id: "sg-source", onchange: (e) => { st.source = e.target.value; if (SG.SHADES[st.source] && SG.SHADES[st.source].square) st.pattern = "mission"; else if (st.pattern === "mission") st.pattern = "tiffany"; if (st.source !== "design") setPref("shade", st.source); ui.framed = false; rebuild(); } },
      ...(st.ids.length ? [el("option", { value: "design", selected: st.source === "design" }, "The selected object" + (st.ids.length > 1 ? "s" : ""))] : []),
      ...shades.map(([k, n]) => el("option", { value: k, selected: st.source === k }, n)),
      el("option", { value: "panel", selected: st.source === "panel" }, "Flat panel from a picture"));
    s.append(el("h3", {}, "Stained glass"), grp("Shape", srcSel));
    // a picture to turn into glass
    s.append(el("small", {}, "Picture"));
    s.append(el("div", { class: "bk-steprow" },
      el("button", { class: "btn" + (st.pic ? "" : " primary"), id: "sg-pic", title: "Open a PNG, JPG or SVG picture: its colour areas become the glass pieces and its dark outlines the lead lines", onclick: () => pickPicture() }, st.pic ? "Another picture…" : "Picture to glass…"),
      st.pic ? el("button", { class: "btn", id: "sg-pic-off", onclick: () => { st.pic = null; st.picRaw = null; st.picName = ""; if (st.source === "panel") st.source = "dome"; if (st.pattern === "picture") st.pattern = "tiffany"; ui.framed = false; rebuild(); } }, "Remove") : null));
    if (st.pic) {
      s.append(el("p", { class: "bk-dim", id: "sg-picname", style: { margin: 0 } }, `${st.picName} · ${st.pic.colors.length} colours`));
      s.append(el("div", { class: "s3d-colors", style: { gap: "3px" } }, ...st.pic.colors.map((c) => el("i", { style: { width: "16px", height: "16px", borderRadius: "3px", background: c, display: "inline-block", border: "1px solid #0003" } }))));
      s.append(slider("sg-piccols", "Colours", "picColors", 2, 16, 1, "", () => { makePicLabels(); rebuild(); }));
      s.append(slider("sg-piecemm", "Biggest piece", "pieceMM", 8, 80, 1, "mm", () => rebuild()));
      s.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-match", checked: st.matchGlass, onchange: (e) => { st.matchGlass = e.target.checked; setPref("matchGlass", st.matchGlass); rebuild(); } }), "Use real glass colours (nearest in the glass palette)"));
      if (st.source === "panel") {
        s.append(slider("sg-panelw", "Panel width", "panelW", 40, 400, 5, "mm", () => { ui.framed = false; rebuild(); }));
        s.append(grp("Panel shape", seg("sg-pshape", [["rect", "Rectangle"], ["circle", "Circle / oval"], ["arch", "Arch"], ["outline", "Picture outline", "Only the picture's own shape (its background is left out)"]], st.panelShape, (v) => { st.panelShape = v; setPref("panelShape", v); ui.framed = false; rebuild(); })));
      } else if (SG.SHADES[st.source]) s.append(slider("sg-repeats", "Repeats around the shade", "repeats", 1, 12, 1, "", () => rebuild()));
    }
    if (!st.ids.length) s.append(el("p", { class: "bk-dim", style: { margin: 0 } }, "To make a statue, select an object in your design first, then open Stained Glass."));
    if (st.source !== "design") s.append(slider("sg-size", "Width", "size", 60, 400, 5, "mm", () => { ui.framed = false; rebuild(); }));
    if (st.source !== "panel") {
      s.append(grp("Pieces", seg("sg-pattern", [...(SG.SHADES[st.source] && SG.SHADES[st.source].square ? [["mission", "Mission design", "The classic square-lamp design: tall cream strips, an amber top band and a lower band of green stripes, orange chevrons and diamonds"]] : []), ...SG.PATTERNS, ...(st.pic ? [["picture", "From the picture", "The picture's colour areas, repeated around the shade"]] : [])], st.pattern, (v) => { st.pattern = v; if (v !== "picture") setPref("pattern", v); rebuild(); })));
      if (!(st.pic && st.pattern === "picture") && st.pattern !== "mission") s.append(slider("sg-pieces", "How many pieces", "pieces", 10, 600, 5, "", () => rebuild()));
    }
    s.append(el("button", { class: "btn", id: "sg-reshuffle", title: "Cut the pieces again in a different way", onclick: () => { st.seed++; rebuild(); } }, "New piece layout"));
    s.append(grp("Build", seg("sg-build", [["kit", "Snap-fit kit", "The frame prints as one part; every glass piece prints on its own (any colour) and snaps into its own opening"], ["fused", "One piece", "Frame and glass as one model (for one or multi-colour printing in one go)"]], st.build, (v) => { st.build = v; setPref("build", v); rebuild(true); })));
    if (st.build === "kit") {
      const kd = kitDims(st);
      s.append(el("p", { class: "bk-dim", id: "sg-kitinfo", style: { margin: 0 } }, `Each piece rests on a ${kd.lipT.toFixed(1)} mm ledge beside a ${kd.web.toFixed(1)} mm divider and clicks under small bumps ${kd.capH.toFixed(1)} mm above the glass.`));
    }
    s.append(el("small", {}, "Thickness"));
    s.append(slider("sg-tg", "Glass", "tg", 0.4, 6, 0.1, "mm", () => rebuild(true)));
    s.append(slider("sg-wf", "Frame width", "wf", 0.6, 8, 0.1, "mm", () => rebuild(true)));
    s.append(slider("sg-tf", "Frame thickness", "tf", 0.8, 10, 0.1, "mm", () => rebuild(true)));
    if (st.build === "kit") s.append(slider("sg-clear", "Snap fit clearance", "clear", 0.05, 0.6, 0.05, "mm", () => rebuild(true)));
    s.append(grp("Frame", seg("sg-frame", Object.entries(FRAMES).map(([k, [n]]) => [k, n]), st.frame, (v) => { st.frame = v; setPref("frame", v); show(); })));
    const S = SG.SHADES[st.source];
    if (S && S.base) s.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-base", checked: st.base, onchange: (e) => { st.base = e.target.checked; setPref("base", st.base); ui.framed = false; rebuild(true); } }), "Lamp base"));
    if (S) {
      const F = SG.FITTINGS[st.fitting] || SG.FITTINGS.none;
      s.append(grp("Bulb fitting", el("select", { id: "sg-fitting", title: "Hardware the shade hangs on or sits on", onchange: (e) => { st.fitting = e.target.value; st.fitHole = 0; setPref("fitting", st.fitting); setPref("fitHole", 0); renderSide(); rebuild(true); } }, ...Object.entries(SG.FITTINGS).map(([k, v]) => el("option", { value: k, selected: k === st.fitting }, v.name)))));
      if (F.hole) {
        s.append(seg("sg-fitpos", [["top", "Top (spider)", "A plate across the top opening: hang the shade, or set it on a harp or a rod through the lamp base"], ["bottom", "Bottom (bulb up)", "A plate across the bottom opening: the socket stands on the base, its shade ring clamps the plate and the shade sits on it"]], st.fitPos, (v) => { st.fitPos = v; setPref("fitPos", v); ui.framed = false; rebuild(true); }));
        if (!st.fitHole) st.fitHole = F.hole;
        s.append(slider("sg-fithole", "Hole", "fitHole", 8, 60, 0.5, "mm", () => { setPref("fitHole", st.fitHole); rebuild(true); }));
        s.append(el("p", { class: "bk-dim", id: "sg-fitnote", style: { margin: 0 } }, F.note + (st.base ? " The lamp base gets a 10.5 mm hole down the middle for a lamp rod and the cord." : "")));
      }
    }
    if (st.source === "design") s.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-stand", checked: st.stand, onchange: (e) => { st.stand = e.target.checked; rebuild(true); } }), "Stand under the statue"));
    s.append(grp("Glass", seg("sg-glass", [["cathedral", "Cathedral", "Clear, see-through coloured glass"], ["opal", "Opalescent", "Milky glass that glows when lit, like Tiffany lamps"]], st.glass, (v) => { st.glass = v; setPref("glass", v); show(); })));
    s.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-light", checked: st.light, onchange: (e) => { st.light = e.target.checked; show(); } }), "Light inside"));
    s.append(el("small", {}, "Colour all the pieces"));
    s.append(el("div", { class: "s3d-colors", id: "sg-palettes", style: { flexWrap: "wrap", gap: "6px" } }, ...Object.entries(PALETTES).map(([k, pal]) => el("button", { class: "btn" + (st.palette === k ? " primary" : ""), "data-p": k, title: "Colour the pieces in " + k + " colours", onclick: () => { snapshot(); st.palette = k; setPref("palette", k); st.seed++; ui.cols = autoColors(st, ui.g ? ui.g.count : 0); show(); renderSide(); } },
      el("span", { style: { display: "inline-flex", gap: "1px", marginRight: "5px" } }, ...pal.slice(0, 4).map((c) => el("i", { style: { width: "7px", height: "12px", background: c, display: "inline-block" } }))), k.charAt(0).toUpperCase() + k.slice(1)))));
    s.append(el("div", { class: "bk-steprow" },
      el("button", { class: "btn", id: "sg-byheight", title: "The palette from top to bottom", onclick: () => { snapshot(); ui.cols = autoColors(st, ui.g.count, "height"); show(); } }, "By height"),
      el("button", { class: "btn", id: "sg-all", title: "Every piece in the colour you picked", onclick: () => { snapshot(); ui.cols = ui.cols.map(() => st.color); show(); } }, "All one colour")));
    s.append(el("div", { class: "bk-steprow" }, el("button", { class: "btn", id: "sg-undo", title: "Undo (Ctrl+Z)", onclick: () => undo() }, "↶ Undo"), el("button", { class: "btn", id: "sg-redo", title: "Redo (Ctrl+Y)", onclick: () => redo() }, "↷ Redo")));
    if (g) {
      const used = new Map(); for (const c of ui.cols) used.set(c, (used.get(c) || 0) + 1);
      const box = new THREE.Box3().setFromObject(ui.group), sz = box.getSize(new THREE.Vector3());
      s.append(el("p", { class: "bk-dim", id: "sg-stats" }, `${g.count} pieces · ${used.size} colours · ${sz.x.toFixed(0)} × ${sz.y.toFixed(0)} × ${sz.z.toFixed(0)} mm`));
    }
    s.append(el("small", {}, "Add to design"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-split", checked: st.split, onchange: (e) => { st.split = e.target.checked; } }), "One part per glass colour (for multi-colour printing)"),
      ...(st.ids.length ? [el("label", { class: "check" }, el("input", { type: "checkbox", id: "sg-hide", checked: st.hideOrig, onchange: (e) => { st.hideOrig = e.target.checked; } }), "Hide the original object")] : []));
    s.append(el("p", { class: "hint", style: { padding: 0 } }, "Click or drag over pieces to paint them. Thin glass (1 to 2 mm) lets light through when printed in clear or translucent filament; the frame holds the pieces together."));
  }

  // ------------------------------------------------------------------ showing it
  function show() {
    const grp = ui.group, st = ui.st, g = ui.g;
    for (const c of [...grp.children]) { grp.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }
    if (!g) { ui.dirty = true; return; }
    const gl = new THREE.BufferGeometry();
    gl.setAttribute("position", new THREE.BufferAttribute(g.glass.V, 3));
    gl.setIndex(new THREE.BufferAttribute(g.glass.I, 1));
    const col = new Float32Array(g.glass.V.length), c3 = new THREE.Color();
    const cache = ui.cols.map((c) => c3.set(c).clone());
    for (let v = 0; v < g.glass.R.length; v++) { const c = cache[g.glass.R[v]] || c3; col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    gl.setAttribute("color", new THREE.BufferAttribute(col, 3));
    gl.computeVertexNormals();
    const opal = st.glass === "opal";
    const gm = new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: opal ? 0.93 : 0.72, roughness: opal ? 0.55 : 0.12, metalness: 0, side: THREE.DoubleSide, depthWrite: !(!opal), emissive: 0xffffff, emissiveIntensity: 0 });
    // lit from inside: the glass glows in its own colours
    gm.onBeforeCompile = (sh) => { if (!st.light) return; sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor.rgb * " + (opal ? "0.55" : "0.35") + ";"); };
    gm.customProgramCacheKey = () => (st.light ? "lit" : "dark") + (opal ? "o" : "c");
    const gmesh = new THREE.Mesh(gl, gm); gmesh.userData.glass = true; gmesh.renderOrder = 2;
    grp.add(gmesh); ui.glassMesh = gmesh;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(g.frame.V, 3)); fg.setIndex(new THREE.BufferAttribute(g.frame.I, 1)); fg.computeVertexNormals();
    grp.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: FRAMES[st.frame][1], metalness: st.frame === "black" ? 0.1 : 0.75, roughness: 0.38 })));
    if (g.fitter) {
      const fg2 = new THREE.BufferGeometry(); fg2.setAttribute("position", new THREE.BufferAttribute(g.fitter.mesh.V, 3)); fg2.setIndex(new THREE.BufferAttribute(g.fitter.mesh.I, 1)); fg2.computeVertexNormals();
      grp.add(new THREE.Mesh(fg2, new THREE.MeshStandardMaterial({ color: "#8a8f98", metalness: 0.6, roughness: 0.4 })));
      const k = g.fitter.sock;
      if (k) {
        // a see-through socket and bulb, to show how it goes together
        const ghost = new THREE.MeshStandardMaterial({ color: "#d8d2c4", transparent: true, opacity: 0.45, depthWrite: false });
        const c = new THREE.Mesh(new THREE.CylinderGeometry(k.r, k.r, k.z1 - k.z0, 32), ghost); c.rotation.x = Math.PI / 2; c.position.set(0, 0, (k.z0 + k.z1) / 2); grp.add(c);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), new THREE.MeshStandardMaterial({ color: "#fff6d8", transparent: true, opacity: 0.35, depthWrite: false, emissive: "#ffe9a8", emissiveIntensity: st.light ? 0.8 : 0.1 }));
        bulb.position.set(0, 0, k.up ? k.z1 + 50 : k.z0 - 50); grp.add(bulb);
      }
    }
    if (g.extra) {
      const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(g.extra.mesh.V, 3)); bg.setIndex(new THREE.BufferAttribute(g.extra.mesh.I, 1)); bg.computeVertexNormals();
      grp.add(new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: "#6b4a2a", metalness: 0.7, roughness: 0.4 })));
    }
    // the bulb sits in the middle of the glass
    const b = new THREE.Box3().setFromBufferAttribute(gl.attributes.position), c = b.getCenter(new THREE.Vector3());
    ui.bulb.position.copy(c); ui.bulb.intensity = st.light ? 2.2 * b.getSize(new THREE.Vector3()).length() : 0; ui.bulb.distance = 0;
    ui.scene.background = new THREE.Color(st.light ? "#2a2d36" : getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    ui.hemi.intensity = st.light ? 0.55 : 1.1; ui.sun.intensity = st.light ? 0.5 : 1.2;
    ui.dirty = true;
  }
  function recolor() {
    const g = ui.g, mesh = ui.glassMesh; if (!g || !mesh) return;
    const col = mesh.geometry.attributes.color, c3 = new THREE.Color();
    const cache = ui.cols.map((c) => new THREE.Color(c));
    for (let v = 0; v < g.glass.R.length; v++) { const c = cache[g.glass.R[v]] || c3; col.setXYZ(v, c.r, c.g, c.b); }
    col.needsUpdate = true; ui.dirty = true;
  }

  // ------------------------------------------------------------------ painting
  const ray = new THREE.Raycaster();
  function pick(e) {
    if (!ui.glassMesh) return null;
    const r = ui.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), ui.cam);
    const h = ray.intersectObject(ui.glassMesh, false)[0];
    if (!h) return null;
    return ui.g.glass.R[h.face.a];
  }
  function snapshot() { if (!ui.cols) return; ui.undo.push(ui.cols.slice()); if (ui.undo.length > 60) ui.undo.shift(); ui.redo = []; }
  const undo = () => { if (!ui.undo.length) return; ui.redo.push(ui.cols.slice()); ui.cols = ui.undo.pop(); recolor(); renderSide(); };
  const redo = () => { if (!ui.redo.length) return; ui.undo.push(ui.cols.slice()); ui.cols = ui.redo.pop(); recolor(); renderSide(); };
  function paint(r) {
    const st = ui.st;
    if (st.tool === "pick") { st.color = ui.cols[r]; st.tool = "paint"; renderBar(); hint(); return false; }
    if (st.tool === "fill") { const from = ui.cols[r]; let n = 0; ui.cols = ui.cols.map((c) => (c === from ? (n++, st.color) : c)); recolor(); return n > 0; }
    if (ui.cols[r] === st.color) return false;
    ui.cols[r] = st.color; recolor(); return true;
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const p = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, tool: false };
      ui.pointers.set(e.pointerId, p);
      if (e.button !== 0 || e.shiftKey || ui.pointers.size > 1) return;
      const r = pick(e); if (r == null) return;
      p.tool = true; snapshot(); p.last = r;
      if (!paint(r)) ui.undo.pop();
    });
    c.addEventListener("pointermove", (e) => {
      const p = ui.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (p.tool) { if (ui.st.tool === "paint") { const r = pick(e); if (r != null && r !== p.last) { p.last = r; paint(r); } } return; }
      const all = [...ui.pointers.values()];
      if (all.length >= 2) {
        const [a, b] = all, sp = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.sp0) ui.view.dist = Math.max(10, Math.min(20000, ui.view.dist * (ui.sp0 / Math.max(1, sp))));
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
    c.addEventListener("wheel", (e) => { e.preventDefault(); ui.view.dist = Math.max(10, Math.min(20000, ui.view.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); ui.dirty = true; }, { passive: false });
  }

  // ------------------------------------------------------------------ files and the design
  // the parts: the frame, the base (if any), and the glass (one part per colour, or all)
  function parts(byColor0, light = false) {
    const byColor = typeof byColor0 === "object" ? byColor0 : byColor0 ? { on: true } : false;
    const st = ui.st, out = [];
    // for the design: the same pieces with fewer triangles (the pieces are cut the same way, so
    // they keep their colours); the frame made a little coarser and simplified
    let g = ui.g, cols = ui.cols;
    if (light) {
      const g2 = make(st, true);
      if (g2) {
        // each coarse piece takes the colour of the painted piece nearest its middle
        const mid = (gg) => { const { C, A, nt } = gg.topo, n = gg.count, s = new Float64Array(n * 4); for (let t = 0; t < nt; t++) { const r = gg.part.reg[t]; s[r * 4] += C[t * 3] * A[t]; s[r * 4 + 1] += C[t * 3 + 1] * A[t]; s[r * 4 + 2] += C[t * 3 + 2] * A[t]; s[r * 4 + 3] += A[t]; } return s; };
        const a = mid(g), b = mid(g2);
        cols = [];
        for (let r = 0; r < g2.count; r++) {
          const w = b[r * 4 + 3] || 1, x = b[r * 4] / w, y = b[r * 4 + 1] / w, z = b[r * 4 + 2] / w;
          let best = 0, bd = Infinity;
          for (let q = 0; q < g.count; q++) { const w2 = a[q * 4 + 3] || 1, d = (a[q * 4] / w2 - x) ** 2 + (a[q * 4 + 1] / w2 - y) ** 2 + (a[q * 4 + 2] / w2 - z) ** 2; if (d < bd) { bd = d; best = q; } }
          cols.push(ui.cols[best]);
        }
        g = g2;
      }
    }
    let fr = { V: g.frame.V, I: g.frame.I };
    if (light && fr.I.length / 3 > 40000) fr = simplify(fr, 40000).mesh;
    out.push({ name: "Frame (" + FRAMES[st.frame][0].toLowerCase() + ")", color: FRAMES[st.frame][1], V: fr.V, I: fr.I });
    if (g.extra) out.push({ name: g.extra.name, color: "#6b4a2a", V: g.extra.mesh.V, I: g.extra.mesh.I });
    if (g.fitter) out.push({ name: g.fitter.name, color: "#8a8f98", V: g.fitter.mesh.V, I: g.fitter.mesh.I });
    if (g.kit && !byColor.grouped) {
      // the kit: every piece on its own, numbered (the same number is on the piece map)
      for (const pc of SG.splitPieces(g.glass)) {
        const c = cols[pc.piece] || "#9fc4e8";
        out.push({ name: `Piece ${String(pc.piece + 1).padStart(3, "0")} ${colorName(c)}`, color: c, V: pc.V, I: pc.I, piece: pc.piece + 1 });
      }
      return out;
    }
    const groups = new Map();
    const I = g.glass.I, R = g.glass.R;
    for (let t = 0; t < I.length; t += 3) { const c = byColor && byColor.on !== false ? cols[R[I[t]]] : "glass"; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(I[t], I[t + 1], I[t + 2]); }
    for (const [c, tri] of groups) {
      const map = new Map(), V = [], I2 = new Uint32Array(tri.length);
      for (let k = 0; k < tri.length; k++) { const v = tri[k]; let n = map.get(v); if (n === undefined) { n = V.length / 3; map.set(v, n); V.push(g.glass.V[v * 3], g.glass.V[v * 3 + 1], g.glass.V[v * 3 + 2]); } I2[k] = n; }
      out.push({ name: c !== "glass" ? "Glass " + colorName(c) : "Glass", color: c !== "glass" ? c : "#9fc4e8", V: new Float32Array(V), I: I2 });
    }
    return out;
  }
  const num = (x) => { const r = Math.round(x * 1e4) / 1e4; return Object.is(r, -0) ? "0" : String(r); };
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
    const hex = (c) => "#" + String(c).replace("#", "").toUpperCase() + "FF";
    const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">JumpStart 3D</metadata>', ' <metadata name="Title">' + esc(name) + "</metadata>", ' <resources>\n  <basematerials id="1">'];
    list.forEach((m) => out.push('   <base name="' + esc(m.name) + '" displaycolor="' + hex(m.color) + '"/>'));
    out.push("  </basematerials>");
    list.forEach((m, k) => {
      const parts2 = ['  <object id="' + (k + 2) + '" type="model" name="' + esc(m.name) + '" pid="1" pindex="' + k + '">\n   <mesh>\n    <vertices>'];
      for (let i = 0; i < m.V.length; i += 3) parts2.push('     <vertex x="' + num(m.V[i]) + '" y="' + num(m.V[i + 1]) + '" z="' + num(m.V[i + 2]) + '"/>');
      parts2.push("    </vertices>\n    <triangles>");
      for (let t = 0; t < m.I.length; t += 3) parts2.push('     <triangle v1="' + m.I[t] + '" v2="' + m.I[t + 1] + '" v3="' + m.I[t + 2] + '"/>');
      parts2.push("    </triangles>\n   </mesh>\n  </object>");
      out.push(parts2.join("\n"));
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
  function objBytes(list, name) {
    // OBJ: one object per part, with the part's colour on every corner (vertex colours)
    const lines = ["# " + name + " (JumpStart 3D stained glass)"];
    let base = 1;
    for (const m of list) {
      const c = new THREE.Color(m.color);
      lines.push("o " + m.name.replace(/\s+/g, "_"));
      for (let i = 0; i < m.V.length; i += 3) lines.push(`v ${num(m.V[i])} ${num(m.V[i + 1])} ${num(m.V[i + 2])} ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}`);
      for (let t = 0; t < m.I.length; t += 3) lines.push(`f ${m.I[t] + base} ${m.I[t + 1] + base} ${m.I[t + 2] + base}`);
      base += m.V.length / 3;
    }
    return new TextEncoder().encode(lines.join("\n") + "\n");
  }
  const baseName = () => {
    const st = ui.st;
    const b = st.source === "design" ? findBody(store.doc, st.ids[0]) : null;
    return ((b ? b.name : st.source === "panel" ? (st.picName || "Picture").replace(/\.[^.]+$/, "") + " panel" : (SG.SHADES[st.source] || {}).name || "Lamp") + " stained glass").replace(/[\\/:*?"<>|]+/g, "").trim();
  };
  // a map of the pieces with their numbers (SVG): the panel as it lies, a lamp unrolled
  function pieceMap() {
    const g = ui.g, P = (x, y, z) => g.panel ? [x, -y] : [(Math.atan2(y, x) + Math.PI) * Math.hypot(x, y), -z];
    const segs = g.segs, lines = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); return p; };
    for (let i = 0; i < segs.length; i += 9) { const a = add(P(segs[i], segs[i + 1], segs[i + 2])), b = add(P(segs[i + 3], segs[i + 4], segs[i + 5])); if (Math.abs(a[0] - b[0]) < (x1 - x0) * 0.5 || g.panel) lines.push(a, b); }
    const { C, A, nt } = g.topo, n = g.count, s = new Float64Array(n * 4);
    for (let t = 0; t < nt; t++) { const r = g.part.reg[t]; const p = P(C[t * 3], C[t * 3 + 1], C[t * 3 + 2]); s[r * 4] += p[0] * A[t]; s[r * 4 + 1] += p[1] * A[t]; s[r * 4 + 3] += A[t]; }
    const pad = 6, W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad, fs = Math.max(2.2, Math.min(5, Math.sqrt((W * H) / Math.max(1, n)) * 0.28));
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(0)}mm" height="${H.toFixed(0)}mm"><rect x="${x0 - pad}" y="${y0 - pad}" width="${W}" height="${H}" fill="#fff"/>`;
    for (let r = 0; r < n; r++) { const w = s[r * 4 + 3] || 1; svg += `<circle cx="${(s[r * 4] / w).toFixed(2)}" cy="${(s[r * 4 + 1] / w).toFixed(2)}" r="${(fs * 0.9).toFixed(2)}" fill="${ui.cols[r]}" opacity=".55"/>`; }
    svg += `<path d="${lines.map((p, i) => (i % 2 ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join("")}" stroke="#222" stroke-width="0.5" fill="none"/>`;
    for (let r = 0; r < n; r++) { const w = s[r * 4 + 3] || 1; svg += `<text x="${(s[r * 4] / w).toFixed(2)}" y="${(s[r * 4 + 1] / w + fs * 0.35).toFixed(2)}" font-size="${fs.toFixed(2)}" font-family="sans-serif" text-anchor="middle">${r + 1}</text>`; }
    return svg + "</svg>";
  }
  async function exportFile(fmt) {
    if (!ui || !ui.g) return;
    const name = baseName();
    if (fmt === "zip" || fmt === "zipc") {
      // every part as its own STL (frame, base, each piece, or each colour), plus the piece map
      const list = parts(fmt === "zipc" ? { on: true, grouped: true } : true), enc = new TextEncoder();
      const files = list.map((m) => ({ name: m.name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").toLowerCase() + ".stl", data: stlBytes([m]) }));
      files.push({ name: "piece-map.svg", data: enc.encode(pieceMap()) });
      files.push({ name: "read-me.txt", data: enc.encode(`${name}\n\n${ui.g.kit ? "Snap-fit kit: print the frame once, then each piece in its own colour (the colour is in its file name). Press each piece into its numbered opening (see piece-map.svg) until it clicks under the small bumps.\n" : "Frame and glass, one file per colour.\n"}Glass ${ui.st.tg} mm, frame ${ui.st.wf} mm wide and ${ui.st.tf} mm thick${ui.g.kit ? ", fit clearance " + ui.st.clear + " mm" : ""}.\n${ui.g.fitter ? "Bulb fitter: " + (SG.FITTINGS[ui.st.fitting] || {}).name + ", " + (ui.st.fitHole || "") + " mm hole, at the " + (ui.st.fitPos === "bottom" ? "bottom" : "top") + " of the shade. " + (SG.FITTINGS[ui.st.fitting] || {}).note + " Glue the fitter's outer ring to the frame rim.\n" : ""}Made with JumpStart 3D Stained Glass Studio.\n`) });
      const z = makeZip(files), bytes = new Uint8Array(await z.arrayBuffer());
      ui.lastExport = { fmt, size: bytes.length, parts: list.length };
      if (app.projects && app.projects.saveModel) await app.projects.saveModel(name + (fmt === "zipc" ? " colours.zip" : " parts.zip"), bytes);
      app.onExport && app.onExport(fmt);
      return;
    }
    const list = parts(fmt !== "stl");
    const bytes = fmt === "stl" ? stlBytes(list) : fmt === "obj" ? objBytes(list, name) : await threeMFBytes(list, name);
    ui.lastExport = { fmt, size: bytes.length, parts: list.length };
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(name + "." + fmt, bytes);
    app.onExport && app.onExport(fmt);
  }
  function addToDesign() {
    if (!ui || !ui.g) return;
    const st = ui.st, list = parts(st.split ? { on: true, grouped: true } : { on: false, grouped: true }, true), ids = [], base = baseName();
    const nt = list.reduce((a, m) => a + m.I.length / 3, 0);
    if (nt > 300000 && !confirm(`This stained glass has ${Math.round(nt / 1000)}k triangles, so it can take a few minutes to turn into solid parts. Add it anyway? (Fewer pieces or a wider frame is quicker.)`)) return;
    store.update((doc) => {
      doc.assets = doc.assets || {};
      for (const m of list) {
        const bytes = packMesh({ V: m.V, I: m.I }), id = contentId(bytes);
        if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: base, data: toB64(bytes) };
        const b = { id: uid("b"), name: nextName(doc, m.name), seq: nextSeq(doc), color: m.color, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] }, stainedGlass: true };
        doc.bodies.push(b); ids.push(b.id);
      }
      if (st.hideOrig && st.source === "design") for (const id of st.ids) { const o = findBody(doc, id); if (o) o.hidden = true; }
    }, "Stained glass");
    close();
    app.select && app.select(ids);
    app.toast(`Added the stained glass as ${ids.length} parts. They take a moment to build.`);
  }

  return { open, close, get isOpen() { return !!ui; }, _ui: () => ui, _parts: (byColor) => (ui && ui.g ? parts(byColor) : null) };
}
