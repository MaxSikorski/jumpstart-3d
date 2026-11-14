// Layerscape: turns a photo into a layered, slot-together diorama to laser cut or 3D print.
// It runs in its own window over the app. The diorama is kept with the design (doc.layerscape),
// its files are saved through JumpStart 3D, and the finished model can be added to the design.
import { helperAsset, helperLoadingNote, helperFailText } from "./helperpages.js"; // jumpstart-3d: the page loads the first time it is opened, like the Neon Sign Builder
import { store } from "./store.js";
import { addMeshBodies } from "./lsimport.js";
import * as THREE from "three";
import { cleanLayerscape } from "./lsguard.js"; // jumpstart-3d: a diorama from a design or a file is untrusted

export function initLayerscape(app) {
  let frame = null;
  if (!window.__JS3D_SAVE__) window.__JS3D_SAVE__ = (filename, bytes) => app.projects.saveModel(filename, bytes);
  const theme = () => { const t = document.documentElement.dataset.ui || "light"; return t === "dark" ? "dark" : "light"; };
  // a diorama in the design that Layerscape refuses or can't read is never saved over unless the user says so (checked
  // at every save, so Undo or opening again can't get round it), and Layerscape only saves into the design it was opened for
  let held = null, heldNote = "", declined = null, openedFor, opening = null;
  const unreadable = new Set(); // dioramas whose pictures couldn't be read, this session
  const cannotOpen = (raw) => { if (!raw) return false; if (unreadable.has(raw)) return true; try { return !cleanLayerscape(JSON.parse(raw)); } catch (e) { return true; } };
  const hold = (raw, why) => {
    held = raw;
    heldNote = `The Layerscape diorama saved with this design couldn't be opened. ${why} It stays in your design unchanged, and Layerscape asks before saving over it.`;
    app.toast(heldNote, "err");
  };
  window.__JS3D_LS__ = {
    theme,
    project() { // jumpstart-3d: only safe pictures and fields; a refused one is held
      held = null; declined = null; openedFor = store.doc.id; opening = store.doc.layerscape || null;
      if (!opening) return null;
      let d = null, why = "It isn't a diorama Layerscape can open safely.";
      try { d = cleanLayerscape(JSON.parse(opening)); } catch (e) { if (!(e instanceof SyntaxError) && e && e.message) why = e.message; }
      if (!d) hold(opening, why);
      return d;
    },
    // Layerscape couldn't open the design's diorama (a picture that can't be read)
    couldNotOpen(e) { if (opening && held === null) { unreadable.add(opening); hold(opening, e && typeof e.message === "string" && e.message ? e.message : "One of its pictures couldn't be read."); } }, // e comes from the frame's window, so no instanceof
    heldNote: () => (held !== null && store.doc.layerscape === held ? heldNote : ""),
    clean: cleanLayerscape, // jumpstart-3d: layerscape.html checks every project it opens (a design, a saved one, a file)
    store(d) {
      const json = JSON.stringify(d);
      if (store.doc.layerscape === json) return;
      if (store.doc.id !== openedFor) { app.toast("Layerscape was opened for another design, so it didn't save into this one."); return false; }
      if (cannotOpen(store.doc.layerscape)) {
        if (declined === store.doc.layerscape || !confirm(`This design keeps a Layerscape diorama that couldn't be opened.\n\nReplace it with "${d.name}"? Undo brings the old one back. Cancel keeps it.`)) {
          declined = store.doc.layerscape;
          app.toast("Kept the Layerscape diorama saved with your design. Layerscape didn't save over it.");
          return false;
        }
        app.toast(`Replaced the Layerscape diorama that couldn't be opened with "${d.name}". Undo brings the old one back.`);
      }
      // the time it was saved isn't a change worth an undo step
      try { const old = store.doc.layerscape && JSON.parse(store.doc.layerscape); if (old) { delete old.updated; const nd = { ...d }; delete nd.updated; if (JSON.stringify(old) === JSON.stringify(nd)) return; } } catch (e) {}
      store.update((doc) => { doc.layerscape = json; }, "Layerscape diorama");
    },
    close: () => close(),
    // the puzzle maker's 3D preview uses JumpStart 3D's three.js
    THREE,
    // the design as one triangle mesh (mm, Z up): the selected objects, or all the shown ones
    designMesh() {
      const sel = app.selected ? app.selected() : [];
      const bodies = (sel.length ? sel : store.doc.bodies).filter((b) => !b.hole && !b.hidden);
      const V = [], I = [], v = new THREE.Vector3();
      let n = 0;
      for (const b of bodies) {
        const view = app.scene.views.get(b.id); if (!view || !view.data) continue;
        view.group.updateMatrixWorld(true);
        const P = view.data.vertices, T = view.data.triangles, base = V.length / 3, M = view.mesh ? view.mesh.matrixWorld : view.group.matrixWorld;
        for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); V.push(v.x, v.y, v.z); }
        for (let i = 0; i < T.length; i++) I.push(base + T[i]);
        n++;
      }
      return { V: new Float32Array(V), I: new Uint32Array(I), count: n, name: (sel.length === 1 && sel[0].name) || store.doc.name || "My design" };
    },
    // the design as building blocks for a building kit: upright boxes, cylinders, prisms, cones, pyramids
    // and roof shapes as their shapes and places; anything else as its triangle mesh
    designBlocks() {
      const sel = app.selected ? app.selected() : [];
      const bodies = (sel.length ? sel : store.doc.bodies).filter((b) => !b.hole && !b.hidden);
      const KINDS = new Set(["box", "cylinder", "tube", "prism", "cone", "pyramid", "roof"]), items = [], v = new THREE.Vector3();
      const upright = (e) => Math.abs(e[10] - 1) < 1e-4 && Math.abs(e[2]) < 1e-4 && Math.abs(e[6]) < 1e-4 && Math.abs(Math.hypot(e[0], e[1]) - 1) < 1e-4 && Math.abs(Math.hypot(e[4], e[5]) - 1) < 1e-4;
      const flat = (node, M, color, name, out) => {
        if (!node) return false;
        if (node.t === "prim" && !(node.mods || []).length && KINDS.has(node.kind) && upright(M.elements) && !(node.kind === "cone" && (node.p.top || 0) > 0.05)) { out.push({ kind: node.kind, p: { ...node.p }, m: Array.from(M.elements), color, name }); return true; }
        if (node.t === "group" && Array.isArray(node.children) && !(node.mods || []).length) {
          for (const c of node.children) { if (c.hole) return false; const cm = new THREE.Matrix4().fromArray(c.m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); if (!flat(c.node, M.clone().multiply(cm), color, name, out)) return false; }
          return true;
        }
        return false;
      };
      for (const b of bodies) {
        const out = [];
        if (b.m && flat(b.node, new THREE.Matrix4().fromArray(b.m), b.color, b.name, out)) { items.push(...out); continue; }
        const view = app.scene.views.get(b.id); if (!view || !view.data) continue;
        view.group.updateMatrixWorld(true);
        const P = view.data.vertices, T = view.data.triangles, M = view.mesh ? view.mesh.matrixWorld : view.group.matrixWorld, V = new Float32Array(P.length);
        for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); V[i] = v.x; V[i + 1] = v.y; V[i + 2] = v.z; }
        let z = Infinity; for (let i = 2; i < V.length; i += 3) z = Math.min(z, V[i]);
        items.push({ kind: "mesh", V, I: new Uint32Array(T), color: b.color, name: b.name, z });
      }
      return { items, count: bodies.length, name: (sel.length === 1 && sel[0].name) || store.doc.name || "My design" };
    },
    // parts: [{ name, color, V: Float32Array, I: Uint32Array }] in mm, Z up, already put together
    addParts(parts, title) {
      const ids = addMeshBodies(app, parts, "Add Layerscape " + (title || "diorama"));
      close();
      app.toast(`Added ${ids.length} Layerscape part${ids.length === 1 ? "" : "s"} to your design. Group them to move the diorama as one.`);
      return ids.length;
    },
  };
  function open() {
    close();
    document.body.classList.add("ls-on"); // toasts show over Layerscape
    frame = document.createElement("div");
    frame.className = "flexigen layerscape";
    frame.id = "layerscape";
    const ifr = document.createElement("iframe");
    ifr.title = "Layerscape";
    ifr.addEventListener("load", () => { try { ifr.contentWindow.focus(); } catch (e) {} });
    // jumpstart-3d: the page arrives on first use (the single file has it inline), with Loading and Close until then; a failed download closes it with a toast and is tried again next time
    const note = helperLoadingNote(() => close());
    ifr.style.visibility = "hidden";
    const mine = frame;
    helperAsset("layerscape.html").then((html) => {
      if (frame !== mine) return;
      note.done(); ifr.style.visibility = ""; ifr.srcdoc = html;
    }, (e) => {
      if (frame !== mine) return;
      note.done(); close();
      app.toast(helperFailText("Layerscape", e), "err");
    });
    frame.append(ifr, note);
    // end jumpstart-3d
    document.body.append(frame);
  }
  function close() { if (frame) { frame.remove(); frame = null; } document.body.classList.remove("ls-on"); }
  // follow JumpStart 3D's light / dark look
  new MutationObserver(() => { const w = frame && frame.querySelector("iframe").contentWindow; if (w && w.document) w.document.documentElement.dataset.theme = theme(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui"] });
  return { open, close, get isOpen() { return !!frame; }, get frame() { return frame && frame.querySelector("iframe"); } };
}
