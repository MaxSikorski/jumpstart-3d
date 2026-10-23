// Saving designs (account storage when available, plus this browser), export and import.
import { store, newDoc, IDENTITY } from "./store.js";
import { el, uid, debounce, makeZip, fmt } from "./util.js";
import { ICON } from "./icons.js";
import { initRecovery } from "./recovery.js";
import { openProjectStore } from "./projstore.js"; // jumpstart-3d: designs storage
import { initFolder } from "./folder.js"; // jumpstart-3d: copies in a folder
import { glbBytes } from "./gltf.js"; // jumpstart-3d: glTF export
import { initRemote } from "./remote.js"; // jumpstart-3d: remote
import { triangleCodes, paintAttrs, PAINT_NS } from "./paint3mf.js"; // jumpstart-3d: painted 3MF

const LS_PREF = "workplane.pref.v1";

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

export function initProjects(app) {
  let loads = 0; store.on((k) => { if (k === "load") loads++; }); // jumpstart-3d: the delayed framing of a design is dropped once any other load has happened
  const $ = (id) => document.getElementById(id);
  let db = null, userId = null, downloads = null;
  let remoteOk = false;
  let dirty = false, editedAt = 0; // jumpstart-3d: editedAt: when the last edit was made (the closing tab tells projstore.js, so an older delete cannot be mistaken for a later one)
  let opened = { id: null, at: 0, rev: undefined }; // jumpstart-3d: designs storage. which design is open and the `_updated` and `rev` (list entry, see projstore.js) of the copy it was read from or last saved as
  let revs = 0;
  // jumpstart-3d: designs storage. Designs and the list live in projstore.js (IndexedDB, or localStorage where that fails);
  // the version counters and the last-open id stay in localStorage because they are read synchronously.
  const ps = openProjectStore();
  ps.onKept((name) => app.toast(`Saved your edits. Kept "${name}" in Your designs.`)); // jumpstart-3d: another tab's version was displaced by a save; it is kept under this name
  const revOf = async (id) => { try { const e = await ps.entry(id); return (e && e.rev) || undefined; } catch (e) { return undefined; } }; // read before the document: a save in between then shows up as a conflict, never hides one
  const mirror = initFolder({ ps, toast: (m, k) => app.toast(m, k), fileSafe: (t) => fileSafe(t) }); // jumpstart-3d: copies in a folder
  const remote = initRemote({ ps, thumbnail, toast: (m, k) => app.toast(m, k), fileSafe: (t) => fileSafe(t), open: (id) => open(id) }); // jumpstart-3d: remote
  let saving = 0, started = false, openGate;
  const startGate = new Promise((r) => { openGate = r; }); // saves wait until start() has loaded the resumed design
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
  async function getDoc(id) { // jumpstart-3d: designs storage
    try { const s = await ps.get(id); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  async function listAll() {
    const map = new Map((await ps.list()).map((p) => [p.id, { ...p, where: "local" }]));
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
    let local = await getDoc(id);
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
  function record(noThumb) { // jumpstart-3d: designs storage. what a save stores: id, the document string, the list entry (the tab closing skips the thumbnail)
    const doc = store.doc, updated = Date.now();
    return [doc.id, JSON.stringify({ ...doc, _updated: updated }), { id: doc.id, name: doc.name, ver: doc.ver || 0, mode: doc.mode, updated, rev: ps.tab + ":" + ++revs, thumb: noThumb ? null : thumbnail() }];
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
  async function saveNow() { return (await save()).local; }
  let failToasted = false; // jumpstart-3d: one error toast for a run of failed autosaves; a Save click (loud) always gets its own
  async function save(loud) {
    saving++; // jumpstart-3d: designs storage (the whole block up to the remote save)
    let updated = null, doc, thumb;
    try {
      await startGate;
      doc = store.doc;
      const r = record(); // taken after the wait, so the resumed design is saved, never the blank one
      thumb = r[2].thumb;
      dirty = false;
      // the last argument is read when the write runs: what these edits started from (see `displaced` in projstore.js)
      if (await ps.put(r[0], r[1], r[2], () => (opened.id === r[0] ? opened : null))) { if (store.doc.id === r[0]) opened = { id: r[0], at: r[2].updated, rev: r[2].rev }; if (r[0] !== unproven) ls.set(LS_PREF + ".last", r[0]); updated = r[2].updated; mirror.soon(); } // jumpstart-3d: copies in a folder (soon: not awaited)
      else dirty = true; // not stored: the next edit tries again, and closing the tab still keeps a rescue copy
    } finally { saving--; }
    let any = !!updated;
    if (remoteOk) {
      setState("Saving…");
      const ok = await saveRemote(doc, thumb, updated || Date.now());
      any = any || ok;
      setState(ok ? "Saved" : updated ? `Saved in this browser (${remoteNote})` : "Not saved");
    } else setState(updated ? "Saved in this browser" : "Couldn't save: browser storage is full or blocked. Export a project file instead.");
    // jumpstart-3d: the status label is hidden on narrower windows, so a failed save also gets a toast
    if (any) failToasted = false;
    else if (loud || !failToasted) { app.toast("Couldn't save in this browser. Export a project file now.", "err"); failToasted = true; }
    return { local: !!updated, any }; // jumpstart-3d: backup (local: did the write fit?)
  }
  const saveSoon = debounce(saveNow, 1200);

  // jumpstart-3d: designs storage. A slow IndexedDB took over from localStorage. The open design may have been read from an
  // older copy than the one IndexedDB holds (a design moved over on an earlier visit leaves its old copy behind), and a save
  // that failed meanwhile (localStorage full) was never retried.
  ps.onSwitch(async () => {
    let cur = null;
    const rev = await revOf(store.doc.id);
    try { cur = JSON.parse(await ps.get(store.doc.id)); } catch (e) {}
    const newer = cur && opened.id === store.doc.id && (cur._updated || 0) > opened.at;
    // this tab saved the design on localStorage, IndexedDB holds another version and the copy did not keep ours: do not open the other one over it; the write keeps it as "(before fallback)"
    const mine = newer && opened.rev && opened.rev.startsWith(ps.tab + ":") && rev !== opened.rev && !ps.fallbackKept(opened.id);
    if (dirty || saving || mine) saveSoon(); // edits on an older copy are safe: the write keeps a newer stored copy as "(before fallback)" first
    else if (newer) {
      opened = { id: cur.id, at: cur._updated, rev };
      delete cur._updated;
      app.select([]); if (app.command) app.command.cancel(); app.exitSketch();
      store.load(cur);
      setState("Saved in this browser");
      app.toast("Opened the newer saved copy of this design.");
    }
  });

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
    if (!(await save(true)).any) return false; // jumpstart-3d: failed save: the error toast is already up, no "Saved as"
    mirror.now(); // jumpstart-3d: copies in a folder (not awaited)
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
    const rev = await revOf(id);
    const d = await loadDoc(id);
    if (!d) { app.toast("That design couldn't be found.", "err"); return false; }
    opened = { id, at: d._updated || 0, rev };
    delete d._updated;
    app.select([]);
    if (app.command) app.command.cancel();
    app.exitSketch();
    store.load(d);
    ls.set(LS_PREF + ".last", id);
    setState("Saved");
    app.vp.setView("home", app.scene.allBox().isEmpty() ? null : app.scene.allBox());
    const gen = loads; setTimeout(() => { if (gen !== loads) return; const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }, 900); // jumpstart-3d: only the latest load's
    return true;
  }
  // jumpstart-3d: share link. A design opened from a link becomes the one a reload reopens only after it has built without an error,
  // so a design that stalls or breaks the engine is not reopened (and stalls it again) on the next load.
  let unproven = null;
  function proveShared(id) {
    unproven = id;
    const timer = setInterval(() => {
      if (store.doc.id !== id) { clearInterval(timer); if (unproven === id) unproven = null; return; }
      if (app.scene.busy() || store.doc.bodies.some((b) => app.scene.errors.has(b.id))) return;
      clearInterval(timer); unproven = null; ls.set(LS_PREF + ".last", id);
    }, 400);
  }
  // jumpstart-3d: share link. Adds a checked design from a share link as a NEW design (own id, version 0, own creation time) and opens it.
  // The open design is saved first and stays as it is; nothing is replaced until the new one is safely stored. Returns "ok", "save-failed"
  // (the open design could not be saved: nothing happens), "stale" (the person changed designs while this waited: nothing happens),
  // "storage" (the new design could not be stored: the open one stays) or "chisel" (Chisel keeps its own copy of the open design).
  async function importShared(shared) {
    if (app.mode === "chisel") return "chisel";
    const gen = loads;
    if (app.command) app.command.cancel();
    const open0 = store.doc;
    if (!await saveNow()) return "save-failed";
    if (store.doc !== open0 || loads !== gen) return "stale"; // an edit or another design while the save ran: the person is asked again
    const id = uid("d"), now = Date.now(), doc = { ...structuredClone(shared), id, created: now, ver: 0 };
    delete doc._updated;
    if (!await ps.put(id, JSON.stringify({ ...doc, _updated: now }), { id, name: doc.name, ver: 0, mode: doc.mode, updated: now, thumb: null })) return "storage";
    if (store.doc !== open0 || loads !== gen) { await ps.del(id, { marker: false }); return "stale"; }
    app.select([]);
    if (app.command) app.command.cancel();
    app.exitSketch();
    proveShared(id);
    store.load(doc);
    setState("Saved");
    mirror.soon();
    saveNow();
    const b = app.scene.allBox(); app.vp.setView("home", b.isEmpty() ? null : b);
    const g2 = loads; setTimeout(() => { if (g2 !== loads) return; const bx = app.scene.allBox(); if (!bx.isEmpty()) app.vp.fit(bx); }, 900);
    return "ok";
  }
  function createNew(doc, mode = "beginner") {
    app.select([]);
    if (app.command) app.command.cancel();
    app.exitSketch();
    store.load(doc || newDoc("Untitled", mode));
    saveNow();
    const b = app.scene.allBox(); app.vp.setView("home", b.isEmpty() ? null : b); // jumpstart-3d: frame shapes already built, like open()
  }

  // ---------------------------------------------------------------- designs modal
  async function openModal() {
    const back = el("div", { class: "modal-back", onclick: (e) => { if (e.target === back) close(); } });
    const grid = el("div", { class: "projgrid" }, el("div", { class: "empty" }, "Loading…"));
    const where = (remoteOk ? "Designs are saved to your account and in this browser." : "Designs are saved in this browser. Export a project file to keep a copy elsewhere, or back up every design into one file below.") + " Each design opens in the mode you last used it in; switch any time with the Beginner / Advanced buttons.";
    const modal = el("div", { class: "modal", role: "dialog", "aria-label": "Your designs" },
      el("header", {}, el("h2", {}, "Your designs"), el("button", { class: "btn", id: "btn-sample", title: "Open an example design to explore (a copy you can change)", onclick: () => { close(); createNew(app.mode === "advanced" ? sampleAdvanced() : sampleBeginner()); } }, "Open a sample"), el("button", { class: "btn", id: "btn-tut-from-designs", title: "Step-by-step projects", onclick: () => { close(); app.tutorials && app.tutorials.open(); } }, "Tutorials"), el("button", { class: "btn", id: "btn-autosaves", title: "Copies kept while you work, for getting back lost changes", onclick: () => { close(); rec.openHistory(); } }, "Autosaves…"), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: () => close() })),
      el("div", { class: "mbody" }, el("p", { class: "hint", style: { margin: "0 0 12px", color: "var(--ink-3)" } }, where),
        el("div", { class: "backup-row" }, // jumpstart-3d: backup
          el("button", { class: "btn", id: "btn-backup", title: "Save every design in this browser into one file", onclick: () => backupAll() }, "Back up all designs…"),
          el("button", { class: "btn", id: "btn-restore", title: "Add the designs from a backup file; nothing here is deleted or overwritten", onclick: () => pick.click() }, "Restore from backup…"),
          el("button", { class: "btn", id: "btn-restore-folder", title: "Add the designs from the project files in a folder; nothing here is deleted or overwritten", onclick: () => folderPick.click() }, "Restore from a folder…")), grid));
    back.append(modal);
    document.body.append(back);
    const close = () => back.remove();
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    remote.tabs(modal.querySelector(".mbody"), close); // jumpstart-3d: remote
    await saveNow();
    const fr = await mirror.row(); if (fr) grid.before(fr); // jumpstart-3d: copies in a folder
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
            await ps.del(p.id); // jumpstart-3d: designs storage
            if (remoteOk) { try { await col().doc(p.id).delete(); } catch (e) {} }
            card.remove();
            if (p.id === store.doc.id) { close(); createNew(null, store.doc.mode); }
          } }, "Delete"),
          el("button", { class: "btn", style: { padding: "3px 8px" }, onclick: () => confirmRow.replaceWith(acts) }, "Keep"));
        acts.replaceWith(confirmRow);
      };
      acts.append(delBtn);
      // jumpstart-3d: the Architechies tag label is added to the mode tag below
      card.append(th, el("div", { class: "meta" }, el("b", {}, (p.name || "Untitled") + (p.ver ? " v" + p.ver : "")), el("span", {}, when + (p.where === "account" ? " · account" : "")), p.mode ? el("span", { class: "tag " + p.mode }, p.mode === "advanced" ? "Advanced" : p.mode === "chisel" ? "Chisel" : p.mode === "arch" ? "Architechies" : "Beginner") : null), acts);
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
        return true;
      }
      app.toast("Saving files isn't available in this view.", "err"); return;
    }
    try {
      await downloads.save({ filename, data });
      return true;
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
        // jumpstart-3d: test the float32 coordinates actually written, keeping valid facet bytes unchanged.
        const p = o - 50, coord = (k) => dv.getFloat32(p + 12 + k * 4, true);
        const abx = coord(3) - coord(0), aby = coord(4) - coord(1), abz = coord(5) - coord(2);
        const acx = coord(6) - coord(0), acy = coord(7) - coord(1), acz = coord(8) - coord(2);
        if (aby * acz - abz * acy === 0 && abz * acx - abx * acz === 0 && abx * acy - aby * acx === 0) o = p;
      }
    }
    void e;
    dv.setUint32(80, (o - 84) / 50, true);
    return o === 84 ? null : new Uint8Array(buf, 0, o);
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
  // glTF (our addition): the mesh data objBytes reads, one coloured mesh per body; the file format lives in gltf.js
  function glbBytesOf(bodies = exportBodies()) { // jumpstart-3d: scripting bridge
    const parts = [];
    for (const b of bodies) {
      const v = app.scene.views.get(b.id);
      if (v && v.data) parts.push({ name: b.name || b.id, color: b.color, matrix: v.group.matrix.elements, vertices: v.data.vertices, normals: v.data.normals, triangles: v.data.triangles });
    }
    return glbBytes(parts, store.doc.name);
  }
  async function exportGLB() {
    const bytes = glbBytesOf();
    if (!bytes) { app.toast("Nothing to export yet. Holes on their own aren't exported."); return; }
    await offerModel(exportName() + ".glb", bytes);
    app.onExport && app.onExport("glb");
  }
  // 3MF: one object per body with its color, vertices shared so slicers see closed meshes
  function threeMFBytes(bodies = exportBodies()) { // jumpstart-3d: scripting bridge
    const objs = [];
    for (const b of bodies) {
      const v = app.scene.views.get(b.id);
      if (v && v.data) objs.push({ b, data: v.data, m: v.group.matrix });
    }
    if (!objs.length) return null;
    const codes = objs.map((o) => triangleCodes(store.doc.printPaint, o.b.id, o.data)); // jumpstart-3d: painted 3MF
    const esc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
    const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); return "#" + (m ? m[1] : "A7B0BA").toUpperCase() + "FF"; };
    const num = (x) => { const r = Math.round(x * 1e5) / 1e5; return Object.is(r, -0) ? "0" : String(r); };
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"' + (codes.some(Boolean) ? ' xmlns:slic3rpe="' + PAINT_NS + '"' : "") + ">"); // jumpstart-3d: painted 3MF
    out.push(' <metadata name="Application">JumpStart 3D</metadata>');
    out.push(' <metadata name="Title">' + esc(store.doc.name || "design") + '</metadata>');
    out.push(' <resources>\n  <basematerials id="1">');
    objs.forEach((o) => out.push('   <base name="' + esc(o.b.name || "Body") + '" displaycolor="' + hex(o.b.color) + '"/>'));
    out.push('  </basematerials>');
    objs.forEach((o, k) => {
      const M = o.m.elements, P = o.data.vertices, T = o.data.triangles;
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      const index = new Map(), verts = [], remap = new Int32Array(P.length / 3);
      // jumpstart-3d: 3MF weld. Corners closer than 0.1 micron become one vertex, not only those that round to the same
      // 0.01 micron: where two tori touch at one point the mesher leaves a patch of triangles that small, and rounding
      // kept one of them with no partner (fuzz seed 33). The first corner of a cluster places its vertex.
      const cell = 1e-4, grid = new Map(), placed = [];
      const closeTo = (x, y, z) => {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const id of grid.get((gx + dx) + "," + (gy + dy) + "," + (gz + dz)) || []) {
            const p = placed[id];
            if (Math.abs(p[0] - x) <= cell && Math.abs(p[1] - y) <= cell && Math.abs(p[2] - z) <= cell) return id;
          }
        }
      };
      for (let i = 0; i < P.length / 3; i++) {
        const x = M[0] * P[i * 3] + M[4] * P[i * 3 + 1] + M[8] * P[i * 3 + 2] + M[12];
        const y = M[1] * P[i * 3] + M[5] * P[i * 3 + 1] + M[9] * P[i * 3 + 2] + M[13];
        const z = M[2] * P[i * 3] + M[6] * P[i * 3 + 1] + M[10] * P[i * 3 + 2] + M[14];
        const key = num(x) + "," + num(y) + "," + num(z);
        let id = index.get(key);
        if (id === undefined) id = closeTo(x, y, z); // jumpstart-3d: 3MF weld
        if (id === undefined) {
          id = verts.length; verts.push('     <vertex x="' + num(x) + '" y="' + num(y) + '" z="' + num(z) + '"/>');
          // jumpstart-3d: 3MF weld
          placed.push([x, y, z]);
          const g = Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
          if (!grid.has(g)) grid.set(g, []);
          grid.get(g).push(id);
        }
        index.set(key, id);
        remap[i] = id;
      }
      const tris = [];
      for (let t = 0; t < T.length; t += 3) {
        let a = remap[T[t]], b2 = remap[T[t + 1]], c = remap[T[t + 2]];
        if (a === b2 || b2 === c || a === c) continue; // collapsed by welding
        if (det < 0) [b2, c] = [c, b2];
        tris.push('     <triangle v1="' + a + '" v2="' + b2 + '" v3="' + c + '"' + (codes[k] && codes[k][t / 3] ? paintAttrs(codes[k][t / 3]) : "") + "/>"); // jumpstart-3d: painted 3MF
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
        if (j.backup) { app.toast("That is a backup file: use Your designs › Restore from backup…", "err"); return; } // jumpstart-3d: backup
        const doc = j.doc || j;
        if (!Array.isArray(doc.bodies) || !Array.isArray(doc.sketches)) throw new Error("not a JumpStart 3D project");
        doc.id = uid("d");
        // an opened file carries on from its version number
        const vm = /\sv(\d+)\.json$/i.exec(file.name);
        if (vm && !(doc.ver > 0)) doc.ver = +vm[1];
        if (doc.ver) ls.set(VER_KEY + doc.id, String(doc.ver));
        createNew(doc);
        app.toast(`Opened ${doc.name || "project"}`);
        const gen = loads; setTimeout(() => { if (gen !== loads) return; const b = app.scene.allBox(); if (!b.isEmpty()) app.vp.fit(b); }, 900); // jumpstart-3d: only the latest load's
      } catch (e) { app.toast("That file isn't a JumpStart 3D project file.", "err"); }
    };
    r.readAsText(file);
  }
  // jumpstart-3d: backup and restore. "Back up all designs…" in Your designs saves every design in
  // this browser into one JSON file; "Restore from backup…" adds back what is missing. It never
  // deletes or overwrites a design. Docs are copied verbatim from storage; autosave checkpoints
  // (IndexedDB) and settings are not part of it. "Restore from a folder…" adds the designs from the
  // project files in a folder through the same loop.
  const n = (k) => `${k} design${k === 1 ? "" : "s"}`;
  async function backupAll() {
    const saved = await saveNow();
    const designs = [];
    let bad = 0;
    for (const entry of await ps.list()) { // jumpstart-3d: designs storage
      const doc = await getDoc(entry.id);
      if (!doc) { bad++; continue; }
      const ver = +ls.get(VER_KEY + entry.id) || 0;
      designs.push(ver ? { entry, doc, ver } : { entry, doc });
    }
    if (!saved) { // storage is full: the open design's latest edits come from memory instead
      const doc = { ...store.doc, _updated: Date.now() }, ver = verOf(doc), i = designs.findIndex((d) => d.entry.id === doc.id);
      const entry = i < 0 ? { id: doc.id, name: doc.name, ver: doc.ver || 0, mode: doc.mode, updated: doc._updated, thumb: null } : designs[i].entry;
      designs.splice(i < 0 ? designs.length : i, i < 0 ? 0 : 1, ver ? { entry, doc, ver } : { entry, doc });
    }
    if (!designs.length) { app.toast(bad ? `${n(bad)} could not be read` : "Nothing to back up yet", "err"); return; }
    const now = new Date();
    if (!await offer(`jumpstart-3d-backup-${now.toLocaleDateString("en-CA")}.json`, JSON.stringify({ app: "jumpstart-3d", backup: 1, when: now.toISOString(), last: ls.get(LS_PREF + ".last"), designs }))) return;
    app.toast(`Backed up ${n(designs.length)}` + (bad ? `, ${n(bad)} could not be read` : ""), bad ? "err" : undefined);
  }
  async function restoreBackup(file) {
    let j;
    try { j = JSON.parse(await file.text()); } catch (e) { j = null; }
    if (j && j.app === "jumpstart-3d" && j.backup > 1) { app.toast("This backup is from a newer version of the app; update first.", "err"); return; }
    if (!j || j.app !== "jumpstart-3d" || j.backup !== 1 || !Array.isArray(j.designs)) { app.toast("That isn't a JumpStart 3D backup file.", "err"); return; }
    return restoreDesigns(j.designs);
  }
  // list: an array or an async generator of { entry, doc, ver }. none: the toast when it holds no design at all.
  async function restoreDesigns(list, none) {
    // same design apart from save time and the bodies' internal keys
    const same = (a, b) => { const f = ({ _updated, bodies, ...r }) => JSON.stringify({ ...r, bodies: (bodies || []).map(({ _key, ...x }) => x) }); return f(a) === f(b); };
    let idx = await ps.list(), added = 0, here = 0, copies = 0, full = 0, bad = 0; // jumpstart-3d: designs storage
    const docs = new Map(); // each stored design is read once
    const docOf = async (id) => { if (!docs.has(id)) docs.set(id, await getDoc(id)); return docs.get(id); };
    for await (const d of list) {
      const doc = d && d.doc, entry = d && d.entry;
      if (!doc || !entry || !entry.id || !Array.isArray(doc.bodies) || !Array.isArray(doc.sketches)) { bad++; continue; }
      const have = await docOf(entry.id);
      // already here: the same id, or an earlier "(restored)" copy of it under another id and name
      let dup = !!have && same(have, doc);
      if (have) for (const x of idx) { if (dup) break; const o = await docOf(x.id); dup = !!o && same({ ...o, id: doc.id, name: doc.name }, doc); }
      if (dup) { here++; continue; }
      const copy = !!have, id = copy ? uid("d") : entry.id;
      const ent = copy ? { ...entry, id, name: (entry.name || doc.name || "Untitled") + " (restored)" } : entry;
      const stored = copy ? { ...doc, id, name: ent.name } : doc;
      if (full || !await ps.put(id, JSON.stringify(stored), ent)) { full++; continue; }
      docs.set(id, stored);
      const ver = Math.max(doc.ver || 0, +d.ver || 0, +ls.get(VER_KEY + id) || 0);
      if (ver) ls.set(VER_KEY + id, String(ver));
      idx = idx.filter((x) => x.id !== id).concat(ent);
      if (copy) copies++; else added++;
    }
    if (none && !(added + here + copies + full + bad)) { app.toast(none, "err"); return; }
    app.toast(`Restored ${n(added)}, ${here} already here` + (copies ? (copies === 1 ? ', 1 kept as a "(restored)" copy' : `, ${copies} kept as "(restored)" copies`) : "") + (full ? `, ${full} did not fit: free space or delete designs first` : "") + (bad ? `, ${bad} unreadable` : ""), full || bad ? "err" : undefined);
    document.querySelectorAll('.modal-back:has([aria-label="Your designs"])').forEach((m) => m.remove());
    mirror.soon(); // jumpstart-3d: copies in a folder
    openModal();
  }
  const pick = document.createElement("input");
  pick.type = "file"; pick.id = "file-backup"; pick.accept = ".json,application/json"; pick.hidden = true;
  document.body.append(pick);
  pick.onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restoreBackup(f); };
  // jumpstart-3d: restore from a folder. Newest file first, so of two files with one id the newest keeps it.
  // Top level only, .json only, files that claim app "jumpstart-3d" only; backup files are left to Restore from backup.
  // One file is read at a time.
  function restoreFolder(files) {
    async function* read() {
      const all = [...files].filter((f) => (f.webkitRelativePath || "").split("/").length <= 2 && /\.json$/i.test(f.name)).sort((a, b) => b.lastModified - a.lastModified);
      for (const f of all) {
        let j;
        try { j = JSON.parse(await f.text()); } catch (e) { continue; }
        if (!j || j.app !== "jumpstart-3d" || j.backup) continue;
        const doc = j.doc, id = doc && (doc.id || (/-(d[a-z0-9]{7,})\.json$/i.exec(f.name) || [])[1]), updated = f.lastModified || Date.now();
        yield { entry: { id, name: doc && doc.name || "Untitled", ver: doc && doc.ver || 0, mode: doc && doc.mode, updated, thumb: null }, doc: doc && { ...doc, id, _updated: updated }, ver: doc && doc.ver };
      }
    }
    return restoreDesigns(read(), "No JumpStart 3D designs found in that folder.");
  }
  const folderPick = document.createElement("input"); // jumpstart-3d: backup
  folderPick.type = "file"; folderPick.id = "file-folder"; folderPick.webkitdirectory = true; folderPick.hidden = true;
  document.body.append(folderPick);
  folderPick.onchange = (e) => { const l = [...e.target.files]; e.target.value = ""; restoreFolder(l); };
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
    if (a === "glb") exportGLB(); // jumpstart-3d: glTF export
    if (a === "step") exportSTEP();
    if (a === "dxf") app.advanced.exportSketchesDXF(null);
    if (a === "json") exportJSON();
    if (a === "import") $("file-import").click();
  });
  $("file-import").onchange = (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ""; };
  $("btn-projects").onclick = () => openModal();
  window.addEventListener("beforeunload", () => { if (started && (dirty || saving)) { const r = record(true); ps.putNow(r[0], r[1], r[2], opened.id === r[0] ? opened : null, editedAt); } }); // jumpstart-3d: designs storage (putNow starts its writes before this returns; nothing is awaited)

  return {
    // a finished render (PNG) goes through the same save path as models
    async saveImage(filename, blob) { await offerModel(filename, new Uint8Array(await blob.arrayBuffer())); },
    async saveModel(filename, bytes) { await offerModel(filename, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); },
    // jumpstart-3d: report. a copy of the open design for attaching to a bug report: like exportJSON but not a save (no version bump)
    saveCopy(filename) {
      const json = JSON.stringify({ app: "jumpstart-3d", version: 1, doc: store.doc }, null, 1);
      if (new Blob([json]).size > 25e6) app.toast("This design file is over 25 MB, more than GitHub takes. Put it in a .zip before you attach it.");
      return offer(filename, json);
    },
    async start() {
      const capP = capabilities();
      const last = ls.get(LS_PREF + ".last");
      const lastRev = last ? await revOf(last) : undefined;
      let doc = last ? await getDoc(last) : null; // jumpstart-3d: designs storage
      if (doc) { opened = { id: doc.id, at: doc._updated || 0, rev: lastRev }; delete doc._updated; store.load(doc); setState("Saved in this browser"); }
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
      started = true; openGate(); // jumpstart-3d: designs storage (saves wait for this)
      // offer back any work that was never saved (a crash, a closed tab)
      Promise.race([capP, new Promise((r) => setTimeout(r, 3000))]).then(() => setTimeout(() => { if (app.sharelink) app.sharelink.afterDecision(() => rec.check()); else rec.check(); }, 300)); // jumpstart-3d: share link (the recovery offer waits for the person's decision)
      capP.then(async () => {
        if (!remoteOk) { if (!stateEl.textContent) setState("Saved in this browser"); return; }
        // the account may hold a newer copy of this design (edited on another device)
        try {
          const id0 = store.doc.id, gen0 = loads; // jumpstart-3d: share link. a design opened while this waited (a shared one) is not replaced
          const s = await col().doc(id0).get();
          if (s.exists && !store.undoStack.length) {
            const v = s.data();
            const local = await getDoc(id0);
            if (store.doc.id === id0 && loads === gen0 && v.updated > ((local && local._updated) || 0)) { store.load(JSON.parse(v.data)); app.toast("Loaded the latest version from your account"); }
          }
          setState("Saved");
        } catch (e) {}
      });
    },
    changed() { dirty = true; editedAt = Date.now(); setState("Unsaved changes"); saveSoon(); rec.touch(); },
    saveNow,
    saveVersion,
    versionName,
    version: () => verOf(),
    newDesign: (mode) => createNew(null, mode),
    exportSTL,
    exportJSON, liveDoc: () => store.doc, importShared, // jumpstart-3d: share link
    stlBytes, objBytes, threeMFBytes, stepBytes, glbBytes: glbBytesOf, // jumpstart-3d: scripting bridge
    backupAll, restoreBackup, restoreFolder, // jumpstart-3d: backup
    get started() { return started; }, _store: ps, _folder: mirror, _remote: remote, // jumpstart-3d: designs storage, copies in a folder, remote (tests read these)
  };
}
void fmt;
