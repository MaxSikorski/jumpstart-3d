// Saving designs (account storage when available, plus this browser), export and import.
import { store, newDoc, IDENTITY } from "./store.js";
import { el, uid, debounce, makeZip, fmt } from "./util.js";
import { ICON } from "./icons.js";
import { initRecovery } from "./recovery.js";

const LS_INDEX = "workplane.index.v1";
const LS_DOC = "workplane.doc.v1.";
const LS_PREF = "workplane.pref.v1";

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const readJSON = (k, d) => { try { const v = ls.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };

export function initProjects(app) {
  const $ = (id) => document.getElementById(id);
  let db = null, userId = null, downloads = null;
  let remoteOk = false;
  let dirty = false;
  const stateEl = $("savestate");
  const setState = (t) => { stateEl.textContent = t; };

  // ---------------------------------------------------------------- capability setup
  async function capabilities() {
    const c = window.claude;
    if (!c || !c.use) return;
    const [d, u, dl] = await Promise.all([c.use("db").catch(() => null), c.use("user").catch(() => null), c.use("downloads").catch(() => null)]);
    downloads = dl;
    if (d && u) {
      try { userId = await u.id(); } catch (e) { userId = null; }
      if (userId) { db = d; remoteOk = true; }
    }
  }
  const col = () => db.collection(`data/users/${userId}/projects`);

  // ---------------------------------------------------------------- index
  function localIndex() { return readJSON(LS_INDEX, []); }
  function writeIndex(list) { ls.set(LS_INDEX, JSON.stringify(list)); }
  async function listAll() {
    const map = new Map(localIndex().map((p) => [p.id, { ...p, where: "local" }]));
    if (remoteOk) {
      try {
        const snap = await col().orderBy("updated", "desc").limit(200).get();
        for (const d of snap.docs) {
          const v = d.data();
          const cur = map.get(d.id);
          if (!cur || (v.updated || 0) >= (cur.updated || 0)) map.set(d.id, { id: d.id, name: v.name, ver: v.ver || 0, mode: v.mode, updated: v.updated, thumb: v.thumb, where: "account" });
          else cur.where = "both";
        }
      } catch (e) { /* keep local list */ }
    }
    return [...map.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  async function loadDoc(id) {
    let local = readJSON(LS_DOC + id, null);
    if (remoteOk) {
      try {
        const s = await col().doc(id).get();
        if (s.exists) {
          const v = s.data();
          if (!local || (v.updated || 0) > (local._updated || 0)) local = { ...JSON.parse(v.data), _updated: v.updated };
        }
      } catch (e) {}
    }
    return local;
  }

  // ---------------------------------------------------------------- saving
  function thumbnail() {
    try {
      // draw a fresh frame right before copying it (the canvas doesn't keep old frames)
      app.vp.render();
      const src = app.vp.renderer.domElement;
      const c = document.createElement("canvas");
      c.width = 240; c.height = 150;
      const g = c.getContext("2d");
      const sr = src.width / src.height, tr = 240 / 150;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sr > tr) { sw = sh * tr; sx = (src.width - sw) / 2; } else { sh = sw / tr; sy = (src.height - sh) / 2; }
      g.drawImage(src, sx, sy, sw, sh, 0, 0, 240, 150);
      return c.toDataURL("image/jpeg", 0.72);
    } catch (e) { return null; }
  }
  function saveLocal(doc, thumb) {
    const updated = Date.now();
    const okDoc = ls.set(LS_DOC + doc.id, JSON.stringify({ ...doc, _updated: updated }));
    const idx = localIndex().filter((p) => p.id !== doc.id);
    idx.unshift({ id: doc.id, name: doc.name, ver: doc.ver || 0, mode: doc.mode, updated, thumb });
    writeIndex(idx);
    ls.set(LS_PREF + ".last", doc.id);
    return okDoc ? updated : null;
  }
  async function saveRemote(doc, thumb, updated) {
    if (!remoteOk) return false;
    const data = JSON.stringify(doc);
    if (data.length > 240000) { remoteNote = "too big for your account storage"; return false; }
    try {
      await col().doc(doc.id).set({ name: doc.name, ver: doc.ver || 0, mode: doc.mode || "beginner", updated, thumb: thumb || "", data });
      return true;
    } catch (e) { remoteNote = e && e.code === "invalid_argument" ? "you can't write here" : "account storage unavailable"; return false; }
  }
  let remoteNote = "";
  async function saveNow() {
    const doc = store.doc;
    const thumb = thumbnail();
    const updated = saveLocal(doc, thumb);
    dirty = false;
    if (remoteOk) {
      setState("Saving…");
      const ok = await saveRemote(doc, thumb, updated || Date.now());
      setState(ok ? "Saved" : updated ? `Saved in this browser (${remoteNote})` : "Not saved");
    } else setState(updated ? "Saved in this browser" : "Couldn't save: browser storage is blocked. Export a project file instead.");
  }
  const saveSoon = debounce(saveNow, 1200);

  // ---------------------------------------------------------------- versions
  // Every Save (the Save button, Ctrl+S, or a project file) is a new version of the same design:
  // "Lopez, Maria, Keychain v1", then v2... The number lives in the design and, so that undo
  // can't wind it back, also in this browser.
  const VER_KEY = "jumpstart3d.ver.";
  const verOf = (doc = store.doc) => Math.max(doc.ver || 0, +(ls.get(VER_KEY + doc.id) || 0) || 0);
  const versionName = (doc = store.doc, v = verOf(doc)) => (doc.name || "Untitled") + (v ? " v" + v : "");
  function bumpVersion() {
    const doc = store.doc, v = verOf(doc) + 1;
    doc.ver = v;
    if (store.view && store.view !== doc) store.view.ver = v;
    ls.set(VER_KEY + doc.id, String(v));
    app.onVersion && app.onVersion(v);
    return v;
  }
  async function saveVersion() {
    const v = bumpVersion();
    await saveNow();
    app.toast(`Saved as "${versionName(store.doc, v)}"`);
    app.onSaved && app.onSaved(v);
    return v;
  }

  // ---------------------------------------------------------------- crash recovery
  const rec = initRecovery({
    getDoc: () => store.doc,
    toast: (m, k) => app.toast(m, k),
    restore: (doc, asCopy, name) => {
      if (asCopy) {
        const t = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        // the copy keeps the autosave's name ("… autosave v3") and starts its own saves at v1
        doc.id = uid("d"); doc.name = /\sautosave v\d+$/.test(name || "") ? name : `${doc.name} autosave (${t})`; doc.ver = 0;
      }
      createNew(doc, doc.mode);
    },
    savedCopy: async (id) => { const d = await loadDoc(id); if (!d) return null; delete d._updated; return JSON.stringify(d); },
  });
  app.recovery = rec;
  // the Autosave button in the top bar
  const asBtn = $("btn-autosave");
  const showAutosave = () => { asBtn.textContent = rec.enabled ? "Autosave: On" : "Autosave: Off"; asBtn.setAttribute("aria-pressed", rec.enabled ? "true" : "false"); };
  asBtn.onclick = () => {
    rec.setEnabled(!rec.enabled);
    showAutosave();
    app.toast(rec.enabled ? "Autosave is on: backups are kept as you work and offered back if the app closes unexpectedly." : "Autosave is off. Your designs are still saved as usual; crash backups are not kept.");
  };
  showAutosave();

  // ---------------------------------------------------------------- sample design
  function sampleAdvanced() {
    const d = newDoc("Sample: wall bracket", "advanced");
    const pid = () => uid("p");
    const P = [[0, 0], [50, 0], [50, 5], [5, 5], [5, 40], [0, 40]].map(([x, y]) => ({ id: pid(), x, y }));
    const sk = { id: uid("s"), name: "Sketch 1", seq: ++d.seq, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] }, pts: P, ents: P.map((p, i) => ({ id: uid("e"), t: "line", a: p.id, b: P[(i + 1) % P.length].id })), hidden: true };
    d.sketches.push(sk);
    const profiles = [{ key: [...sk.ents.map((e) => e.id)].sort().join(","), pt: [2.5, 20] }];
    const bracket = { id: uid("b"), name: "Bracket", seq: ++d.seq, color: "#9fb1c4", hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "extrude", sketch: sk.id, profiles, dist: 24, mode: "sym", dist2: 0, mods: [] } };
    bracket.node.mods.push({ id: uid("f"), seq: ++d.seq, t: "fillet", r: 4, edges: [{ a: [5, -12, 5], b: [5, 12, 5], m: [5, 0, 5], n: [0.1, 0.5, 0.125], t: "LINE" }] });
    bracket.node.mods.push({ id: uid("f"), seq: ++d.seq, t: "hole", kind: "csink", dia: 4.5, through: true, depth: 10, cbDia: 9, cbDepth: 3, csDia: 9, csAngle: 90, at: [{ p: [36, 0, 5], n: [0, 0, 1] }] });
    bracket.node.mods.push({ id: uid("f"), seq: ++d.seq, t: "hole", kind: "csink", dia: 4.5, through: true, depth: 10, cbDia: 9, cbDepth: 3, csDia: 9, csAngle: 90, at: [{ p: [5, 0, 28], n: [1, 0, 0] }] });
    d.bodies.push(bracket);
    return d;
  }
  function sampleBeginner() {
    const d = newDoc("Sample: peg block", "beginner");
    // a Tinkercad-style group: rounded block minus a cylinder hole
    const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
    d.bodies.push({
      id: uid("b"), name: "Peg block", seq: ++d.seq, color: "#e4572e", hole: false, hidden: false, m: T(-15, 0, 0),
      node: { t: "group", children: [
        { node: { t: "prim", kind: "box", p: { w: 24, d: 24, h: 14, r: 2, c: 0 }, mods: [] }, m: IDENTITY.slice(), hole: false, name: "Box 1", color: "#e4572e" },
        { node: { t: "prim", kind: "cylinder", p: { w: 10, d: 10, h: 20, r: 0, c: 0 }, mods: [] }, m: T(0, 0, 4), hole: true, name: "Cylinder hole 1", color: "#c9cfd6" },
      ], mods: [] },
    });
    d.bodies.push({ id: uid("b"), name: "Cone 1", seq: ++d.seq, color: "#29a35a", hole: false, hidden: false, m: T(20, 10, 0), node: { t: "prim", kind: "cone", p: { w: 16, d: 16, h: 18, top: 0.25 }, mods: [] } });
    d.bodies.push({ id: uid("b"), name: "Sphere 1", seq: ++d.seq, color: "#2b7bb9", hole: false, hidden: false, m: T(20, -18, 0), node: { t: "prim", kind: "sphere", p: { w: 14, d: 14, h: 14 }, mods: [] } });
    return d;
  }

  // ---------------------------------------------------------------- open / new
  async function open(id) {
    const d = await loadDoc(id);
    if (!d) { app.toast("That design couldn't be found.", "err"); return false; }
    delete d._updated;
    app.select([]);
    if (app.command) app.command.cancel();
    app.exitSketch();
    store.load(d);
    ls.set(LS_PREF + ".last", id);
    setState("Saved");
    app.vp.setView("home", app.scene.allBox().isEmpty() ? null : app.scene.allBox());
    setTimeout(() => { const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }, 900);
    return true;
  }
  function createNew(doc, mode = "beginner") {
    app.select([]);
    if (app.command) app.command.cancel();
    app.exitSketch();
    store.load(doc || newDoc("Untitled", mode));
    saveNow();
    app.vp.setView("home");
  }

  // ---------------------------------------------------------------- designs modal
  async function openModal() {
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) close(); } });
    const grid = el("div", { class: "projgrid" }, el("div", { class: "empty" }, "Loading…"));
    const where = (remoteOk ? "Designs are saved to your account and in this browser." : "Designs are saved in this browser. Export a project file to keep a copy elsewhere.") + " Each design opens in the mode you last used it in; switch any time with the Beginner / Advanced buttons.";
    const modal = el("div", { class: "modal", role: "dialog", "aria-label": "Your designs" },
      el("header", {}, el("h2", {}, "Your designs"), el("button", { class: "btn", id: "btn-sample", title: "Open an example design to explore (a copy you can change)", onclick: () => { close(); createNew(app.mode === "advanced" ? sampleAdvanced() : sampleBeginner()); } }, "Open a sample"), el("button", { class: "btn", id: "btn-tut-from-designs", title: "Step-by-step projects", onclick: () => { close(); app.tutorials && app.tutorials.open(); } }, "Tutorials"), el("button", { class: "btn", id: "btn-autosaves", title: "Copies kept while you work, for getting back lost changes", onclick: () => { close(); rec.openHistory(); } }, "Autosaves…"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => close() })),
      el("div", { class: "mbody" }, el("p", { class: "hint", style: { margin: "0 0 12px", color: "var(--ink-3)" } }, where), grid));
    back.append(modal);
    document.body.append(back);
    const close = () => back.remove();
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    await saveNow();
    const list = await listAll();
    grid.innerHTML = "";
    grid.append(el("div", { class: "newcards" },
      el("button", { class: "newcard", onclick: () => { close(); createNew(null, "beginner"); } }, el("div", {}, el("b", {}, "+ Beginner design"), el("span", {}, "Drag and combine shapes"))),
      el("button", { class: "newcard", onclick: () => { close(); createNew(null, "advanced"); } }, el("div", {}, el("b", {}, "+ Advanced design"), el("span", {}, "Sketches, features, timeline")))));
    for (const p of list) {
      const card = el("div", { class: "pcard" + (p.id === store.doc.id ? " current" : "") });
      const th = el("button", { class: "thumb", style: { backgroundImage: p.thumb ? `url(${p.thumb})` : "none", border: 0, cursor: "pointer" }, "aria-label": "Open " + p.name, onclick: async () => { close(); await open(p.id); } });
      const when = p.updated ? new Date(p.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
      const acts = el("div", { class: "acts" });
      acts.append(el("button", { onclick: async () => { close(); await open(p.id); } }, "Open"));
      acts.append(el("button", { onclick: async () => {
        const d = await loadDoc(p.id);
        if (!d) return;
        delete d._updated;
        d.id = uid("d"); d.name = d.name + " copy"; d.ver = 0;
        close(); createNew(d);
      } }, "Duplicate"));
      const delBtn = el("button", { class: "del" }, "Delete");
      delBtn.onclick = () => {
        const confirmRow = el("div", { class: "confirm-row" }, "Delete for good?",
          el("button", { class: "btn danger", style: { padding: "3px 8px" }, onclick: async () => {
            ls.del(LS_DOC + p.id);
            writeIndex(localIndex().filter((x) => x.id !== p.id));
            if (remoteOk) { try { await col().doc(p.id).delete(); } catch (e) {} }
            card.remove();
            if (p.id === store.doc.id) { close(); createNew(null, store.doc.mode); }
          } }, "Delete"),
          el("button", { class: "btn", style: { padding: "3px 8px" }, onclick: () => confirmRow.replaceWith(acts) }, "Keep"));
        acts.replaceWith(confirmRow);
      };
      acts.append(delBtn);
      card.append(th, el("div", { class: "meta" }, el("b", {}, (p.name || "Untitled") + (p.ver ? " v" + p.ver : "")), el("span", {}, when + (p.where === "account" ? " · account" : "")), p.mode ? el("span", { class: "tag " + p.mode }, p.mode === "advanced" ? "Advanced" : p.mode === "chisel" ? "Chisel" : "Beginner") : null), acts);
      grid.append(card);
    }
  }

  // ---------------------------------------------------------------- export
  // Model files (.stl, .3mf) download as they are from the standalone file. Inside claude.ai
  // the save dialog only accepts some file types, so there they come wrapped in a .zip.
  async function offerModel(filename, bytes) {
    if (!downloads) return offer(filename, bytes);
    try { await downloads.save({ filename, data: new Blob([bytes]) }); return; }
    catch (e) {
      if (e && e.code === "declined") return;
      if (!e || (e.code !== "rejected_extension" && e.code !== "extension_not_enabled")) { app.toast("Couldn't save the file: " + ((e && e.message) || "unavailable"), "err"); return; }
    }
    app.toast("This view can't save ." + filename.split(".").pop() + " files directly, so it's inside a .zip. The downloaded JumpStart 3D file saves it unzipped.");
    await offer(filename.replace(/\.[^.]+$/, "") + ".zip", makeZip([{ name: filename, data: bytes }]));
  }
  async function offer(filename, data) {
    if (!downloads) {
      // running outside claude.ai (the downloaded file): use a normal browser download
      if (!window.claude) {
        const blob = data instanceof Blob ? data : new Blob([data]);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000); // Safari asks first: keep the file around until it is saved
        return;
      }
      app.toast("Saving files isn't available in this view.", "err"); return;
    }
    try {
      await downloads.save({ filename, data });
    } catch (e) {
      if (e && e.code === "declined") return;
      app.toast("Couldn't save the file: " + ((e && e.message) || "unavailable"), "err");
    }
  }
  // file names keep the design's name as typed ("Lopez, Maria, Keychain v2.stl"); only characters
  // that files can't have are left out
  const fileSafe = (t) => t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const safeName = () => fileSafe(versionName()) || "design";
  // which bodies an export includes: the selection when there is one, otherwise everything shown
  let exportScope = "all";
  const selectedSolids = () => app.sel.map((id) => store.doc.bodies.find((b) => b.id === id)).filter((b) => b && !b.hole);
  const allSolids = () => store.doc.bodies.filter((b) => !b.hole && !b.hidden);
  const exportBodies = () => (exportScope === "sel" && selectedSolids().length ? selectedSolids() : allSolids());
  const exportName = () => {
    const list = exportBodies();
    if (exportScope === "sel" && list.length === 1 && list.length < allSolids().length) return fileSafe(versionName() + " - " + (list[0].name || "body")) || "design";
    return safeName();
  };
  function renderScope() {
    let box = $("export-scope");
    if (!box) { box = el("div", { id: "export-scope", class: "exscope", role: "radiogroup", "aria-label": "Bodies to export" }); menu.prepend(box, el("hr")); }
    const nSel = selectedSolids().length, nAll = allSolids().length;
    box.innerHTML = "";
    box.append(el("div", { class: "exhead" }, "Bodies to export"));
    const opt = (v, label, count, disabled) => {
      const b = el("button", { role: "radio", class: "exopt", id: "export-scope-" + v, "aria-checked": exportScope === v ? "true" : "false", disabled: disabled || null, "data-scope": v }, label, el("small", {}, String(count)));
      b.onclick = (e) => { e.stopPropagation(); exportScope = v; renderScope(); };
      return b;
    };
    box.append(opt("sel", "Selected", nSel, !nSel), opt("all", "All bodies", nAll, false));
  }
  function stlBytes(bodies = exportBodies()) { // jumpstart-3d: scripting bridge (the list can be passed in)
    const tris = [];
    for (const b of bodies) {
      const v = app.scene.views.get(b.id);
      if (!v || !v.data) continue;
      tris.push({ data: v.data, m: v.group.matrix });
    }
    const count = tris.reduce((s, t) => s + t.data.triangles.length / 3, 0);
    if (!count) return null;
    const buf = new ArrayBuffer(84 + count * 50);
    const dv = new DataView(buf);
    const head = "JumpStart 3D export (mm)";
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, count, true);
    let o = 84;
    const e = new Float32Array(16);
    for (const { data, m } of tris) {
      const M = m.elements;
      const P = data.vertices, T = data.triangles;
      const tp = (i) => [M[0] * P[i * 3] + M[4] * P[i * 3 + 1] + M[8] * P[i * 3 + 2] + M[12], M[1] * P[i * 3] + M[5] * P[i * 3 + 1] + M[9] * P[i * 3 + 2] + M[13], M[2] * P[i * 3] + M[6] * P[i * 3 + 1] + M[10] * P[i * 3 + 2] + M[14]];
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      for (let t = 0; t < T.length; t += 3) {
        let a = tp(T[t]), b = tp(T[t + 1]), c = tp(T[t + 2]);
        if (det < 0) [b, c] = [c, b];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (const f of [nx, ny, nz, ...a, ...b, ...c]) { dv.setFloat32(o, f, true); o += 4; }
        dv.setUint16(o, 0, true); o += 2;
      }
    }
    void e;
    return new Uint8Array(buf);
  }
  async function exportSTL() {
    const bytes = stlBytes();
    if (!bytes) { app.toast("Nothing to export yet. Holes on their own aren't exported."); return; }
    await offerModel(exportName() + ".stl", bytes);
    app.onExport && app.onExport("stl");
  }
  // OBJ (our addition): one "o" group per body, in mm, same bodies and transforms as STL
  function objBytes(bodies = exportBodies()) { // jumpstart-3d: scripting bridge
    const lines = ["# JumpStart 3D export (mm)"];
    let off = 1;
    const f = (x) => { const v = Math.round(x * 1e5) / 1e5; return Object.is(v, -0) ? "0" : String(v); };
    for (const b of bodies) {
      const v = app.scene.views.get(b.id);
      if (!v || !v.data) continue;
      const M = v.group.matrix.elements, P = v.data.vertices, T = v.data.triangles;
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      lines.push("o " + String(b.name || b.id).replace(/\s+/g, "_"));
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        lines.push("v " + f(M[0] * x + M[4] * y + M[8] * z + M[12]) + " " + f(M[1] * x + M[5] * y + M[9] * z + M[13]) + " " + f(M[2] * x + M[6] * y + M[10] * z + M[14]));
      }
      for (let t = 0; t < T.length; t += 3) {
        let a = T[t] + off, b2 = T[t + 1] + off, c = T[t + 2] + off;
        if (det < 0) [b2, c] = [c, b2];
        lines.push("f " + a + " " + b2 + " " + c);
      }
      off += P.length / 3;
    }
    if (lines.length === 1) return null;
    return new TextEncoder().encode(lines.join("\n") + "\n");
  }
  async function exportOBJ() {
    const bytes = objBytes();
    if (!bytes) { app.toast("Nothing to export yet. Holes on their own aren't exported."); return; }
    await offerModel(exportName() + ".obj", bytes);
    app.onExport && app.onExport("obj");
  }
  // 3MF: one object per body with its color, vertices shared so slicers see closed meshes
  function threeMFBytes(bodies = exportBodies()) { // jumpstart-3d: scripting bridge
    const objs = [];
    for (const b of bodies) {
      const v = app.scene.views.get(b.id);
      if (v && v.data) objs.push({ b, data: v.data, m: v.group.matrix });
    }
    if (!objs.length) return null;
    const esc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
    const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); return "#" + (m ? m[1] : "A7B0BA").toUpperCase() + "FF"; };
    const num = (x) => { const r = Math.round(x * 1e5) / 1e5; return Object.is(r, -0) ? "0" : String(r); };
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
    out.push(' <metadata name="Application">JumpStart 3D</metadata>');
    out.push(' <metadata name="Title">' + esc(store.doc.name || "design") + '</metadata>');
    out.push(' <resources>\n  <basematerials id="1">');
    objs.forEach((o) => out.push('   <base name="' + esc(o.b.name || "Body") + '" displaycolor="' + hex(o.b.color) + '"/>'));
    out.push('  </basematerials>');
    objs.forEach((o, k) => {
      const M = o.m.elements, P = o.data.vertices, T = o.data.triangles;
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      const index = new Map(), verts = [], remap = new Int32Array(P.length / 3);
      for (let i = 0; i < P.length / 3; i++) {
        const x = M[0] * P[i * 3] + M[4] * P[i * 3 + 1] + M[8] * P[i * 3 + 2] + M[12];
        const y = M[1] * P[i * 3] + M[5] * P[i * 3 + 1] + M[9] * P[i * 3 + 2] + M[13];
        const z = M[2] * P[i * 3] + M[6] * P[i * 3 + 1] + M[10] * P[i * 3 + 2] + M[14];
        const key = num(x) + "," + num(y) + "," + num(z);
        let id = index.get(key);
        if (id === undefined) { id = verts.length; index.set(key, id); verts.push('     <vertex x="' + num(x) + '" y="' + num(y) + '" z="' + num(z) + '"/>'); }
        remap[i] = id;
      }
      const tris = [];
      for (let t = 0; t < T.length; t += 3) {
        let a = remap[T[t]], b2 = remap[T[t + 1]], c = remap[T[t + 2]];
        if (a === b2 || b2 === c || a === c) continue; // collapsed by welding
        if (det < 0) [b2, c] = [c, b2];
        tris.push('     <triangle v1="' + a + '" v2="' + b2 + '" v3="' + c + '"/>');
      }
      out.push('  <object id="' + (k + 2) + '" type="model" name="' + esc(o.b.name || "Body") + '" pid="1" pindex="' + k + '">\n   <mesh>\n    <vertices>');
      out.push(verts.join("\n"));
      out.push('    </vertices>\n    <triangles>');
      out.push(tris.join("\n"));
      out.push('    </triangles>\n   </mesh>\n  </object>');
    });
    out.push(' </resources>\n <build>');
    objs.forEach((o, k) => out.push('  <item objectid="' + (k + 2) + '"/>'));
    out.push(' </build>\n</model>\n');
    const enc = new TextEncoder();
    return makeZipBytes([
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: "3D/3dmodel.model", data: enc.encode(out.join("\n")) },
    ]);
  }
  async function makeZipBytes(files) { return new Uint8Array(await makeZip(files).arrayBuffer()); }
  async function export3MF() {
    const bytes = threeMFBytes();
    if (!bytes) { app.toast("Nothing to export yet. Holes on their own aren't exported."); return; }
    await offerModel(exportName() + ".3mf", await bytes);
    app.onExport && app.onExport("3mf");
  }
  // jumpstart-3d: scripting bridge. the STEP bytes of a list of bodies, split out of exportSTEP
  async function stepBytes(bodies) {
    const { resolveNode } = await import("./store.js");
    return new Uint8Array(await app.kernel.step(bodies.map((b) => ({ node: resolveNode(b.node, store.doc), m: b.m }))));
  }
  async function exportSTEP() {
    const bodies = exportBodies();
    if (!bodies.length) { app.toast("Nothing to export yet."); return; }
    app.toast("Preparing STEP file…");
    try {
      await offerModel(exportName() + ".step", await stepBytes(bodies));
    } catch (e) { app.toast("STEP export failed: " + e.message, "err"); }
  }
  async function exportJSON() {
    // a project file is a save too: it gets the next version number
    bumpVersion();
    saveNow();
    app.onSaved && app.onSaved(verOf());
    await offer(safeName() + ".json", JSON.stringify({ app: "jumpstart-3d", version: 1, doc: store.doc }, null, 1));
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        const doc = j.doc || j;
        if (!Array.isArray(doc.bodies) || !Array.isArray(doc.sketches)) throw new Error("not a JumpStart 3D project");
        doc.id = uid("d");
        // an opened file carries on from its version number
        const vm = /\sv(\d+)\.json$/i.exec(file.name);
        if (vm && !(doc.ver > 0)) doc.ver = +vm[1];
        if (doc.ver) ls.set(VER_KEY + doc.id, String(doc.ver));
        createNew(doc);
        app.toast(`Opened ${doc.name || "project"}`);
        setTimeout(() => { const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }, 900);
      } catch (e) { app.toast("That file isn't a JumpStart 3D project file.", "err"); }
    };
    r.readAsText(file);
  }
  const menu = $("menu-export");
  $("btn-export").onclick = () => {
    menu.hidden = !menu.hidden;
    // default: just the selection if something is selected, otherwise every body
    if (!menu.hidden) { exportScope = selectedSolids().length ? "sel" : "all"; renderScope(); }
  };
  menu.addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.act;
    if (!a) return;
    menu.hidden = true;
    if (a === "stl") exportSTL();
    if (a === "obj") exportOBJ();
    if (a === "3mf") export3MF();
    if (a === "step") exportSTEP();
    if (a === "dxf") app.advanced.exportSketchesDXF(null);
    if (a === "json") exportJSON();
    if (a === "import") $("file-import").click();
  });
  $("file-import").onchange = (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ""; };
  $("btn-projects").onclick = () => openModal();
  window.addEventListener("beforeunload", () => { if (dirty) saveNow(); });

  return {
    // a finished render (PNG) goes through the same save path as models
    async saveImage(filename, blob) { await offerModel(filename, new Uint8Array(await blob.arrayBuffer())); },
    async saveModel(filename, bytes) { await offerModel(filename, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); },
    async start() {
      const capP = capabilities();
      const last = ls.get(LS_PREF + ".last");
      let doc = last ? readJSON(LS_DOC + last, null) : null;
      if (doc) { delete doc._updated; store.load(doc); setState("Saved in this browser"); }
      else {
        // wait briefly for account storage so returning users get their last design
        await Promise.race([capP, new Promise((r) => setTimeout(r, 2500))]);
        let opened = false;
        if (remoteOk) {
          const list = await listAll();
          if (list.length) opened = await open(list[0].id);
        }
        if (!opened) {
          // first visit: a clean workplane with an untitled design (saved once something is made)
          store.load(newDoc("Untitled", "beginner"));
        }
      }
      // offer back any work that was never saved (a crash, a closed tab)
      Promise.race([capP, new Promise((r) => setTimeout(r, 3000))]).then(() => setTimeout(() => rec.check(), 300));
      capP.then(async () => {
        if (!remoteOk) { if (!stateEl.textContent) setState("Saved in this browser"); return; }
        // the account may hold a newer copy of this design (edited on another device)
        try {
          const s = await col().doc(store.doc.id).get();
          if (s.exists && !store.undoStack.length) {
            const v = s.data();
            const local = readJSON(LS_DOC + store.doc.id, null);
            if (v.updated > ((local && local._updated) || 0)) { store.load(JSON.parse(v.data)); app.toast("Loaded the latest version from your account"); }
          }
          setState("Saved");
        } catch (e) {}
      });
    },
    changed() { dirty = true; setState("Unsaved changes"); saveSoon(); rec.touch(); },
    saveNow,
    saveLocalMcp() {
      const doc = store.doc;
      const updated = saveLocal(doc, thumbnail());
      if (!updated) throw new Error("Browser-local project storage failed; no save was confirmed");
      const saved = readJSON(LS_DOC + doc.id, null);
      if (!saved) throw new Error("Could not read back the saved project");
      delete saved._updated;
      if (JSON.stringify(saved) !== JSON.stringify(doc)) throw new Error("Saved project failed exact serialization readback");
      dirty = false; setState("Saved in this browser");
      return { saved: true, documentId: doc.id, storage: "browser-local", serializationVerified: true };
    },
    reopenLocalMcp(documentId) {
      if (documentId !== store.doc.id) throw new Error("MCP reopen is limited to the current project id");
      const saved = readJSON(LS_DOC + documentId, null);
      if (!saved || saved.id !== documentId || !Array.isArray(saved.bodies) || !Array.isArray(saved.sketches)) throw new Error("Saved local project is missing or invalid");
      delete saved._updated;
      // Older project snapshots predate the native parameter list required by 2.0.
      if (saved.params === undefined) saved.params = [];
      if (!Array.isArray(saved.params)) throw new Error("Saved project's native parameters are invalid");
      if (JSON.stringify(saved).length > 32 * 1024 * 1024) throw new Error("Saved project exceeds the local reopen budget");
      const unchanged = JSON.stringify(saved) === JSON.stringify(store.doc);
      if (!unchanged) store.update((doc) => {
        for (const key of Object.keys(doc)) delete doc[key];
        Object.assign(doc, saved);
      }, "Reopen saved local project");
      if (app.mode !== store.doc.mode) app.setMode(store.doc.mode || "beginner", true);
      return { reopened: true, documentId, storage: "browser-local", unchanged, undoPreserved: true, serializationVerified: true };
    },
    saveVersion,
    versionName,
    version: () => verOf(),
    newDesign: (mode) => createNew(null, mode),
    exportSTL,
    stlBytes, objBytes, threeMFBytes, stepBytes, // jumpstart-3d: scripting bridge
  };
}
void fmt;
