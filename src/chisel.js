// Chisel (the third mode): 3D sculpting, built on the Chisel Sculpt app running in its
// own frame over the work area. Sculpts live in the design as mesh bodies (shown in Beginner and
// Advanced like an imported STL), each carrying its full sculpt data; only Chisel can sculpt
// them. Bodies of the design can be copied (or converted) into Chisel to sculpt.
import * as THREE from "three";
import CHISEL_HTML from "./chisel.html";
import { store, findBody, nextSeq, IDENTITY, regionsFor } from "./store.js";
import { uid, el, nextColor } from "./util.js";
import { isInch } from "./units.js";
import { theme } from "./theme.js";
import { simplify, packMesh, toB64, fromB64, contentId } from "./meshimport.js";
import { M4, arr, nextName } from "./ops.js";
import { gunzip } from "./inflate.js";

const PREVIEW_TRIS = 15000; // triangles of the copy shown in Beginner / Advanced
const MM = 20; // mm per Chisel unit (Chisel is Y up; the design is Z up, floor at z = 0)
const C2J = new THREE.Matrix4().set(MM, 0, 0, 0, 0, 0, -MM, 0, 0, MM, 0, MM, 0, 0, 0, 1);
const J2C = C2J.clone().invert();

// ---------------------------------------------------------------- sculpt data (compressed)
async function gzip(u8) {
  if (typeof CompressionStream === "undefined") return { bytes: u8, gz: false };
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(s).arrayBuffer()), gz: true };
}
// [magic, nv, nt, hasPaint] + float32 positions + uint32 indices (+ float32 paint)
function packSculpt(pos, idx, paint) {
  const nv = pos.length / 3, nt = idx.length / 3, hp = paint ? 1 : 0;
  const buf = new ArrayBuffer(16 + pos.length * 4 + idx.length * 4 + (hp ? paint.length * 4 : 0));
  new Uint32Array(buf, 0, 4).set([0x53434c50, nv, nt, hp]);
  new Float32Array(buf, 16, pos.length).set(pos);
  new Uint32Array(buf, 16 + pos.length * 4, idx.length).set(idx);
  if (hp) new Float32Array(buf, 16 + pos.length * 4 + idx.length * 4, paint.length).set(paint);
  return new Uint8Array(buf);
}
function unpackSculpt(u8) {
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const [, nv, nt, hp] = new Uint32Array(buf, 0, 4);
  const pos = new Float32Array(buf.slice(16, 16 + nv * 12));
  const idx = new Uint32Array(buf.slice(16 + nv * 12, 16 + nv * 12 + nt * 12));
  const paint = hp ? new Float32Array(buf.slice(16 + nv * 12 + nt * 12, 16 + nv * 24 + nt * 12)) : null;
  return { pos, idx, paint };
}
// a body's resize mods (Beginner handles, Advanced Scale) as one matrix in its own frame
function scaleMods(node) {
  const M = new THREE.Matrix4();
  for (const m of node.mods || []) {
    if (m.t !== "scale") continue;
    const k = Array.isArray(m.k) ? m.k : [m.k, m.k, m.k], o = m.o || [0, 0, 0];
    M.premultiply(new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2]).premultiply(new THREE.Matrix4().makeScale(k[0], k[1], k[2])).premultiply(new THREE.Matrix4().makeTranslation(o[0], o[1], o[2])));
  }
  return M;
}
const near = (a, b) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-7 * (1 + Math.abs(v)));

export function initChisel(app) {
  // Easy or Pro: remembered on this device; new users start in Easy
  let level = "easy";
  try { level = localStorage.getItem("jumpstart.chisel.level") === "pro" ? "pro" : "easy"; } catch (e) {}
  let levelBar = null;
  function setLevel(l) {
    level = l === "pro" ? "pro" : "easy";
    try { localStorage.setItem("jumpstart.chisel.level", level); } catch (e) {}
    if (levelBar) levelBar.querySelectorAll("button[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === level));
    const w = win(); if (w && w.setLevel) w.setLevel(level);
  }
  // the switch hangs under the Chisel button
  function placeLevel() {
    if (!levelBar || levelBar.hidden) return;
    const r = document.getElementById("mode-chisel").getBoundingClientRect(), top = host && !host.hidden ? host.getBoundingClientRect().top : r.bottom + 6;
    // (phones: Chisel's area leaves a strip at its top for the switch, so it doesn't cover Chisel's own buttons)
    levelBar.style.top = top + "px";
    levelBar.style.left = Math.max(4, Math.min(innerWidth - levelBar.offsetWidth - 4, r.left + r.width / 2 - levelBar.offsetWidth / 2)) + "px";
  }
  function showLevel(on) {
    if (!levelBar) {
      levelBar = document.createElement("div");
      levelBar.className = "chisel-level"; levelBar.id = "chisel-level";
      levelBar.setAttribute("role", "group"); levelBar.setAttribute("aria-label", "Chisel level");
      levelBar.innerHTML = '<button data-level="easy" title="Easy: a few big, simple tools (great for kids and first-timers)">Easy</button><button data-level="pro" title="Pro: every brush, cut and setting">Pro</button><button data-lathe="1" id="chisel-lathe" class="chisel-lathe-btn" title="Turn a body or a wood blank on a virtual lathe">Lathe</button>';
      levelBar.addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.lathe) { await sync(); app.lathe.open(); return; } // your sculpting is saved first
        setLevel(b.dataset.level);
      });
      document.body.append(levelBar);
      addEventListener("resize", placeLevel);
      setLevel(level);
    }
    levelBar.hidden = !on;
    placeLevel();
  }
  let host = null, ifr = null, readyP = null, readyRes = null, docId = null, busySync = null;
  const win = () => ifr && ifr.contentWindow && ifr.contentWindow.__chisel;

  // what the Chisel frame can ask of the design
  const bridge = window.__JS3D_CHISEL__ = {
    ready: () => readyRes && readyRes(),
    // bodies that can be brought in to sculpt (not sculpts themselves, not holes)
    bodies: () => store.doc.bodies.filter((b) => !b.sculpt && !b.hole && !b.hidden && app.scene.views.get(b.id)?.data).map((b) => ({ id: b.id, name: b.name || "Body" })),
    // a body's triangles in the design's space (mm, Z up)
    bodyTris(id) {
      const v = app.scene.views.get(id);
      if (!v || !v.data || !v.mesh) return null;
      v.mesh.updateMatrixWorld(true);
      const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
      for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
      if (M.determinant() < 0) for (let i = 0; i < out.length; i += 9) for (let j = 0; j < 3; j++) { const t = out[i + 3 + j]; out[i + 3 + j] = out[i + 6 + j]; out[i + 6 + j] = t; }
      return out;
    },
    // a body as the design draws it (each face its own vertices: crisp edges), in mm, Z up
    bodyMesh(id) {
      const v = app.scene.views.get(id);
      if (!v || !v.data || !v.mesh) return null;
      v.mesh.updateMatrixWorld(true);
      const M = v.mesh.matrixWorld, P = v.data.vertices, pos = new Float32Array(P.length), p = new THREE.Vector3();
      for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z; }
      const idx = Uint32Array.from(v.data.triangles);
      if (M.determinant() < 0) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
      return { pos, idx };
    },
    // "Convert": the body leaves the design (undo in Beginner / Advanced brings it back)
    removeBody(id) { store.update((doc) => { doc.bodies = doc.bodies.filter((b) => b.id !== id); }, "Convert to sculpt"); },
    save: (name, bytes) => app.projects.saveModel(name, bytes),
    sync: () => sync(),
    // Easy (kids, first time) or Pro (everything)
    level: () => level,
    // the design's grid snapping (mm, 0 = off) and units
    grid: () => app.gridStep(),
    // snapping settings, shared with the status bar's Snap to menu
    snap: () => {
      const sel = document.getElementById("snap");
      return { grid: app.snapOn, obj: app.objectSnap, size: +sel.value, sizes: [...sel.options].map((o) => ({ v: +o.value, label: o.textContent })) };
    },
    setSnap: (k, v) => {
      if (k === "grid") app.setSnap(v, true);
      else if (k === "obj") app.setObjectSnap(v, true);
      else if (k === "size") { const sel = document.getElementById("snap"); sel.value = String(v); sel.dispatchEvent(new Event("change")); }
    },
    inch: () => isInch(),
    // the workplane and sketch colors of the current theme
    themeColors: () => ({ wp: theme.c.wp, sketch: "#" + new THREE.Color(theme.c.sketch).getHexString(), sketchFill: "#" + new THREE.Color(theme.c.sketchFill).getHexString(), preview: theme.name === "light" ? "#1f4fa8" : "#ffe600" }),
    // a sketch extruded in Chisel: a real sketch + extrude in the design (new body, or a join /
    // cut on design bodies), so it stays editable in Advanced
    cadExtrude: (req) => cadExtrude(req),
    // undo / redo such a step (only when it is still the design's last step)
    designStep: (dir, label) => designStep(dir, label),
    // Beginner / Advanced's theme (light, dark or contrast)
    theme: () => document.documentElement.dataset.ui || "light",
    // performance mode (Normal = lightest, High, Ultra = sharpest): how many pixels Chisel draws
    perf: () => app.perfLevel || "ultra",
  };
  app.chiselPerf = (l) => { const w = win(); if (w && w.setPerf) w.setPerf(l); };
  // the theme changes there: Chisel follows
  new MutationObserver(() => { const w = win(); if (w && w.setTheme) w.setTheme(document.documentElement.dataset.ui || "light"); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui"] });

  // the sketch, in the same form Advanced's sketcher writes (points, lines / circles, and the
  // horizontal / vertical rules that keep a rectangle square)
  function buildSketch(doc, plane, shapes) {
    const sk = { id: uid("s"), name: "Sketch " + ((doc.sketches || []).length + 1), seq: nextSeq(doc), plane: { o: plane.o, x: plane.x, n: plane.n }, pts: [], ents: [], cons: [], hidden: true };
    const addPt = (p) => { const hit = sk.pts.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 1e-6); if (hit) return hit.id; const id = uid("p"); sk.pts.push({ id, x: +p[0].toFixed(6), y: +p[1].toFixed(6) }); return id; };
    for (const s of shapes) {
      if (s.t === "circle") { sk.ents.push({ id: uid("e"), t: "circle", c: addPt(s.c), r: +s.r.toFixed(6) }); continue; }
      const ids = s.pts.map(addPt), L = ids.map((a, i) => { const e = { id: uid("e"), t: "line", a, b: ids[(i + 1) % ids.length] }; sk.ents.push(e); return e.id; });
      if (s.rect) L.forEach((id, i) => sk.cons.push({ id: uid("k"), t: i % 2 ? "vertical" : "horizontal", e1: id }));
    }
    return sk;
  }
  // wait for the design's bodies to be rebuilt
  async function settle(ids, before, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 100));
      if (ids.every((id) => { const v = app.scene.views.get(id); return !findBody(store.doc, id) || (v && v.data && v.dataVer !== before.get(id)) || app.scene.errors.has(id); })) break;
    }
  }
  async function cadExtrude({ mode, plane, shapes, dist, bodies = [] }) {
    const label = mode === "new" ? "Extrude (Chisel)" : mode === "join" ? "Join (Chisel)" : "Cut (Chisel)";
    let newId = null;
    const before = new Map(bodies.map((id) => [id, app.scene.views.get(id)?.dataVer]));
    try {
      store.update((doc) => {
        doc.sketches = doc.sketches || [];
        const sk = buildSketch(doc, plane, shapes);
        doc.sketches.push(sk);
        const regs = regionsFor(sk);
        if (!regs.length) throw new Error("the shapes are not closed");
        const node = { t: "extrude", sketch: sk.id, profiles: regs.map((r) => ({ key: r.key, pt: r.pt })), dist: +dist.toFixed(6), mode: "one", dist2: 5 };
        if (mode === "new") {
          newId = uid("b");
          doc.bodies.push({ id: newId, name: nextName(doc, "Body"), seq: nextSeq(doc), color: nextColor(), hole: false, hidden: false, m: IDENTITY.slice(), node: { ...node, mods: [] } });
        } else {
          const seq = nextSeq(doc);
          for (const id of bodies) {
            const b = findBody(doc, id);
            if (!b) continue;
            b.node.mods = b.node.mods || [];
            b.node.mods.push({ id: uid("f"), seq, t: "bool", op: mode, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert()) });
          }
        }
      }, label);
    } catch (err) { return { ok: false, error: err.message || String(err) }; }
    const ids = newId ? [newId] : bodies;
    await settle(ids, before);
    const bad = ids.find((id) => app.scene.errors.has(id));
    if (bad) {
      const msg = app.scene.errors.get(bad);
      store.undo();
      await settle(ids, new Map(ids.map((id) => [id, app.scene.views.get(id)?.dataVer])), 8000);
      await load({ keepUndo: true });
      return { ok: false, error: msg };
    }
    await load({ keepUndo: true });
    return { ok: true, id: newId, label };
  }
  async function designStep(dir, label) {
    const st = dir === "undo" ? store.undoStack : store.redoStack, top = st[st.length - 1];
    if (!top || top.label !== label) return false;
    const was = new Map(store.doc.bodies.map((b) => [b.id, JSON.stringify(b.node) + JSON.stringify(b.m)]));
    if (dir === "undo") store.undo(); else store.redo();
    const changed = store.doc.bodies.filter((b) => was.get(b.id) !== JSON.stringify(b.node) + JSON.stringify(b.m)).map((b) => b.id);
    await settle(changed, new Map(changed.map((id) => [id, app.scene.views.get(id)?.dataVer])), 15000);
    await load({ keepUndo: true });
    return true;
  }
  function ensure() {
    if (host) return readyP;
    host = document.createElement("div");
    host.className = "chisel-host";
    host.id = "chisel-host";
    ifr = document.createElement("iframe");
    ifr.title = "Chisel sculpting";
    readyP = new Promise((r) => { readyRes = r; });
    ifr.srcdoc = CHISEL_HTML;
    host.append(ifr);
    document.body.append(host);
    return readyP;
  }

  // the design's sculpts into Chisel: new ones, changed ones, moved or resized ones
  async function load(opts = {}) {
    const w = win();
    if (!w) return;
    const fresh = docId !== store.doc.id;
    docId = store.doc.id;
    const have = new Map(w.state().filter((s) => s.jsId).map((s) => [s.jsId, s]));
    const list = [];
    for (const b of store.doc.bodies) {
      if (!b.sculpt) continue;
      const sc = b.sculpt;
      // moves / resizes made in Beginner or Advanced since the last save from Chisel
      const D = M4(b.m).multiply(scaleMods(b.node)).multiply(M4(sc.bm).invert());
      const cm = J2C.clone().multiply(D).multiply(C2J).multiply(M4(sc.cm));
      const e = { jsId: b.id, rev: sc.rev, name: b.name, matrix: cm.elements.slice(), pup: sc.pup || null };
      const o = have.get(b.id);
      if (!o || o.syncRev !== sc.rev || fresh) {
        const a = store.doc.assets && store.doc.assets[sc.data];
        if (!a) continue;
        let bytes = fromB64(a.data);
        if (a.gz) bytes = await gunzip(bytes);
        Object.assign(e, unpackSculpt(bytes), { matcap: sc.matcap || 0 });
      }
      list.push(e);
    }
    // every other body of the design shows in Chisel as it is (sent again only when it changed)
    const rs = new Map((w.refState ? w.refState() : []).map((r) => [r.ref, r]));
    const refs = [], refIds = [];
    for (const b of store.doc.bodies) {
      if (b.sculpt || b.hole || b.hidden) continue;
      const v = app.scene.views.get(b.id);
      if (!v || !v.data || !v.mesh) continue;
      v.mesh.updateMatrixWorld(true);
      const key = (v.dataVer || 0) + "|" + v.mesh.matrixWorld.elements.map((x) => x.toFixed(5)).join(",");
      refIds.push(b.id);
      const r = rs.get(b.id);
      if (!fresh && r && (r.key === key || r.touched)) continue;
      const m = bridge.bodyMesh(b.id);
      if (m && m.idx.length) refs.push({ ref: b.id, name: b.name || "Body", key, pos: m.pos, idx: m.idx });
    }
    w.load(list, { fresh, refs, refIds, keepUndo: !!opts.keepUndo });
  }

  // Chisel's objects into the design: new or changed sculpts get new data and a new preview
  // mesh; moved ones just move; deleted ones leave the design
  async function sync() {
    const w = win();
    if (!w) return false;
    if (busySync) return busySync;
    busySync = (async () => {
      const items = w.collect();
      const gone = w.refGone ? w.refGone() : [];
      const heavy = items.filter((it) => it.pos);
      if (heavy.length) app.toast(`Saving ${heavy.length === 1 ? "your sculpt" : heavy.length + " sculpts"} into the design…`);
      await new Promise((r) => setTimeout(r, 30));
      // the slow part first, outside the design update: preview meshes and packed data
      const prepared = new Map();
      for (const it of heavy) {
        const M = new THREE.Matrix4().fromArray(it.C2J).multiply(new THREE.Matrix4().fromArray(it.matrix));
        const V = new Float32Array(it.pos.length), p = new THREE.Vector3();
        for (let i = 0; i < V.length; i += 3) { p.set(it.pos[i], it.pos[i + 1], it.pos[i + 2]).applyMatrix4(M); V[i] = p.x; V[i + 1] = p.y; V[i + 2] = p.z; }
        let I = it.idx;
        if (M.determinant() < 0) { I = Uint32Array.from(I); for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } }
        const { mesh } = simplify({ V, I: Uint32Array.from(I) }, PREVIEW_TRIS);
        const prev = packMesh(mesh);
        const raw = packSculpt(it.pos, it.idx, it.paint);
        const z = await gzip(raw);
        prepared.set(it.cid, { prev, prevId: contentId(prev), data: { bytes: z.bytes, gz: z.gz }, dataId: contentId(raw) });
      }
      const linked = [];
      let changed = false;
      const before = JSON.stringify(store.doc.bodies.filter((b) => b.sculpt).map((b) => [b.id, b.m, b.name, b.sculpt.rev, b.hidden, b.sculpt.pup || null]));
      const want = new Set(items.map((it) => it.jsId).filter(Boolean));
      const deleted = store.doc.bodies.filter((b) => b.sculpt && !want.has(b.id)).length;
      if (heavy.length || deleted || gone.length || items.some((it) => it.jsId)) {
        store.update((doc) => {
          doc.assets = doc.assets || {};
          for (const it of items) {
            let b = it.jsId ? findBody(doc, it.jsId) : null;
            if (b && !b.sculpt) b = null;
            const pr = prepared.get(it.cid);
            const hex = "#" + new THREE.Color().setRGB(it.color[0], it.color[1], it.color[2]).getHexString();
            if (pr) {
              doc.assets[pr.prevId] = { kind: "mesh", name: it.name, data: toB64(pr.prev) };
              doc.assets[pr.dataId] = { kind: "sculpt", name: it.name, data: toB64(pr.data.bytes), gz: pr.data.gz };
              let col = hex, keepName = null;
              if (!b && it.ref) {
                // a body of the design sculpted in Chisel: the sculpt takes its place (name and color)
                const old = findBody(doc, it.ref);
                if (old) { col = old.color || hex; keepName = old.name; doc.bodies = doc.bodies.filter((x) => x.id !== it.ref); }
              }
              if (!b) {
                b = { id: uid("b"), name: keepName || (it.name && !doc.bodies.some((x) => x.name === it.name) ? it.name : nextName(doc, it.name || "Sculpt")), seq: nextSeq(doc), color: col, hole: false, hidden: false, m: arr(new THREE.Matrix4()), node: { t: "mesh", asset: pr.prevId, keepPos: true, mods: [] } };
                doc.bodies.push(b);
              } else {
                b.node = { t: "mesh", asset: pr.prevId, keepPos: true, mods: [] };
                b.m = arr(new THREE.Matrix4());
              }
              b.sculpt = { data: pr.dataId, rev: it.rev, cm: it.matrix.slice(), bm: b.m.slice(), matcap: it.matcap };
            } else if (b) {
              // same sculpt, maybe moved in Chisel (or in the other modes: baked into Chisel's matrix)
              const Wj = new THREE.Matrix4().multiplyMatrices(C2J, new THREE.Matrix4().fromArray(it.matrix)).multiply(new THREE.Matrix4().multiplyMatrices(C2J, new THREE.Matrix4().fromArray(b.sculpt.cm)).invert());
              if (!near(Wj, new THREE.Matrix4())) {
                b.m = arr(Wj.multiply(M4(b.sculpt.bm)));
                b.node.mods = (b.node.mods || []).filter((m) => m.t !== "scale");
                b.sculpt.cm = it.matrix.slice();
                b.sculpt.bm = b.m.slice();
              }
            }
            if (!b) continue;
            if (it.name && b.name !== it.name && !pr) b.name = it.name;
            // its skeleton and animation (Puppet Animator)
            const pj = it.pup ? JSON.stringify(it.pup) : null;
            if ((b.sculpt.pup ? JSON.stringify(b.sculpt.pup) : null) !== pj) { if (pj) b.sculpt.pup = JSON.parse(pj); else delete b.sculpt.pup; }
            linked.push({ cid: it.cid, jsId: b.id, rev: it.rev });
          }
          doc.bodies = doc.bodies.filter((b) => !b.sculpt || linked.some((l) => l.jsId === b.id));
          // design bodies joined into another sculpt or cut away in Chisel
          if (gone.length) doc.bodies = doc.bodies.filter((b) => b.sculpt || !gone.includes(b.id));
        }, heavy.length ? "Sculpt" : "Move sculpt");
        changed = gone.length > 0 || before !== JSON.stringify(store.doc.bodies.filter((b) => b.sculpt).map((b) => [b.id, b.m, b.name, b.sculpt.rev, b.hidden, b.sculpt.pup || null]));
      }
      w.linked(linked);
      docId = store.doc.id;
      return changed;
    })();
    try { return await busySync; } finally { busySync = null; }
  }

  async function enter() {
    const first = !host;
    await ensure();
    host.hidden = false;
    showLevel(true);
    await load();
    win() && win().shown();
    ifr.focus();
    if (first) firstVisit();
  }
  // the first time Chisel opens on this device: what sculpting does to a body
  function firstVisit() {
    let seen = false;
    try { seen = localStorage.getItem("jumpstart.chisel.intro") === "1"; } catch (e) {}
    if (seen) return;
    let done = () => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} back.remove(); ifr && ifr.focus(); };
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>';
    const li = (b, t) => el("li", {}, el("b", {}, b), " " + t);
    const back = el("div", { class: "modal-back" });
    const ok = el("button", { class: "btn primary", onclick: done }, "Got it, let's sculpt");
    const modal = el("div", { class: "modal chisel-intro", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "ci-title", "aria-describedby": "ci-body" },
      el("header", {}, el("span", { class: "ci-icon", html: icon }), el("h2", { id: "ci-title" }, "Before you sculpt")),
      el("div", { class: "mbody", id: "ci-body" },
        el("p", { class: "ci-lead" }, "Sculpting turns a body into a mesh object."),
        el("p", {}, "Your shapes from Beginner and Advanced are here, ready to sculpt. As soon as you sculpt, cut or move one in Chisel, it becomes a mesh, like an imported STL file:"),
        el("ul", {},
          li("It keeps its shape, name and color", "and still shows up in Beginner and Advanced."),
          li("Its CAD editing goes away:", "no more resize handles, typed sizes, sketches, fillets or timeline steps for that body."),
          li("Changed your mind?", "Undo in Beginner or Advanced brings the original back."),
          li("Want to keep the original?", "use Copy (under \"From your design\" in the panel) to sculpt a copy instead.")),
        el("div", { class: "ci-acts" }, ok)));
    back.append(modal);
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); done(); } };
    document.addEventListener("keydown", onKey, true);
    const done0 = done; done = () => { document.removeEventListener("keydown", onKey, true); done0(); };
    ok.onclick = () => done();
    document.body.append(back);
    // the sculpting frame may grab focus as it loads: keep it on the notice
    const f = () => ok.focus({ preventScroll: true }); f(); setTimeout(f, 60); setTimeout(f, 400);
  }
  async function leave() {
    if (!host) return;
    host.hidden = true;
    showLevel(false);
    await sync();
  }
  // unsaved sculpting when the page closes
  window.addEventListener("beforeunload", (e) => { if (app.mode === "chisel" && win() && win().dirty()) { e.preventDefault(); e.returnValue = ""; } });
  return {
    enter, leave, sync, load,
    undo: () => win() && win().undo(),
    redo: () => win() && win().redo(),
    setLevel, get level() { return level; },
    // the status bar's snapping changed: Chisel shows it
    snapChanged: () => { const w = win(); if (w && w.snapChanged) w.snapChanged(); },
    get open() { return !!host && !host.hidden; },
  };
}
