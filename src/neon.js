// Neon Sign Builder: glowing LED signs to 3D print (shells for LED strips that snap onto a backing).
// It runs in its own window over the app; the design is never changed.
import * as THREE from "three";
import { helperPage, helperLoadingNote, helperFailText } from "./helperpages.js"; // jumpstart-3d: the builder's page loads the first time it is opened, like the Floor Planner
import { store } from "./store.js";
import { fontBytes } from "./fonts.js";
import { PRINTERS } from "./printsim.js";

const NEON_FONTS = ["dancing", "pacifico", "lobster", "varela", "bebas", "bungee", "orbitron", "audiowide", "fredoka", "marker", "caveat", "sans"];

export function initNeon(app) {
  let frame = null;
  if (!window.__JS3D_SAVE__) window.__JS3D_SAVE__ = (filename, bytes) => app.projects.saveModel(filename, bytes);
  window.__JS3D_NEON_CLOSE__ = () => close();
  // shapes in the design that can become the backing
  window.__JS3D_NEON_BODIES__ = () => store.doc.bodies.filter((b) => app.scene.views.get(b.id) && app.scene.views.get(b.id).data).map((b) => ({ id: b.id, name: b.name || "Shape" }));
  window.__JS3D_NEON_SOUP__ = (bodyId) => {
    const v = app.scene.views.get(bodyId);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles, out = new Float32Array(T.length * 3), p = new THREE.Vector3();
    for (let i = 0; i < T.length; i++) { const k = T[i] * 3; p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }
    return out;
  };
  window.__JS3D_NEON_READY__ = async () => {
    // jumpstart-3d: 11 of its 12 fonts are the extra fonts, which load on first use here (morefonts.js); without them it would get Rounded sans
    if (app.moreFonts) await app.moreFonts.load();
    const w = frame && frame.querySelector("iframe").contentWindow;
    if (!w || !w.__neon) return;
    const fonts = {};
    for (const k of NEON_FONTS) { try { fonts[k] = fontBytes(k); } catch (e) {} }
    const printers = Object.entries(PRINTERS).map(([id, p]) => ({ id, name: `${p.name} (${p.w} × ${p.d})`, w: p.w, d: p.d }));
    w.__neon.load({ fonts, printers, printer: "a1" });
  };
  function open() {
    close();
    frame = document.createElement("div");
    frame.className = "flexigen neon";
    const ifr = document.createElement("iframe");
    ifr.title = "Neon Sign Builder";
    // keys go to the builder (undo, copy, paste…) as soon as it opens
    ifr.addEventListener("load", () => { try { ifr.contentWindow.focus(); } catch (e) {} });
    // jumpstart-3d: the page (and the shared three.js) arrive on first use, with Loading and Close until then; a failed download closes it with a toast and is tried again next time
    const note = helperLoadingNote(() => close());
    note.style.color = "#fff";
    ifr.style.visibility = "hidden";
    const mine = frame;
    helperPage("neon").then((html) => {
      if (frame !== mine) return;
      note.done(); ifr.style.visibility = ""; ifr.srcdoc = html;
    }, (e) => {
      if (frame !== mine) return;
      note.done(); close();
      app.toast(helperFailText("the Neon Sign Builder", e), "err");
    });
    frame.append(ifr, note);
    // end jumpstart-3d
    document.body.append(frame);
  }
  function close() { if (frame) { frame.remove(); frame = null; } }
  return { open, close, get isOpen() { return !!frame; }, get frame() { return frame && frame.querySelector("iframe"); } };
}
