// FlexiGen: turns one body into a print-in-place articulated ("flexi") model.
// It runs in its own window over the app, on a copy of the body's mesh, so the design is never changed.
import * as THREE from "three";
import FLEXI_HTML from "./flexigen.html";
import { store } from "./store.js";

export function initFlexiGen(app) {
  let frame = null;
  window.__JS3D_SAVE__ = (filename, bytes) => app.projects.saveModel(filename, bytes);
  window.__JS3D_FLEXI_CLOSE__ = () => close();

  // the body's triangles, in world space, sitting on the bed and centred
  function soupOf(bodyId) {
    const v = app.scene.views.get(bodyId);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld;
    const P = v.data.vertices, T = v.data.triangles;
    const out = new Float32Array(T.length * 3);
    const p = new THREE.Vector3();
    const box = new THREE.Box3();
    for (let i = 0; i < T.length; i++) {
      const k = T[i] * 3;
      p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M);
      out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z;
      box.expandByPoint(p);
    }
    const c = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < out.length; i += 3) { out[i] -= c.x; out[i + 1] -= c.y; out[i + 2] -= box.min.z; }
    // a body flipped inside out by a mirror transform still needs outward triangles
    if (M.determinant() < 0) for (let i = 0; i < out.length; i += 9) for (let j = 0; j < 3; j++) { const t = out[i + 3 + j]; out[i + 3 + j] = out[i + 6 + j]; out[i + 6 + j] = t; }
    return out;
  }

  function open(bodyId) {
    const b = store.doc.bodies.find((x) => x.id === bodyId);
    const soup = soupOf(bodyId);
    if (!b || !soup) { app.toast("That body isn't ready yet. Try again in a moment."); return; }
    close();
    const name = (b.name || "body").replace(/[^\w\- ]+/g, "").trim() || "body";
    frame = document.createElement("div");
    frame.className = "flexigen";
    frame.id = "flexigen";
    const ifr = document.createElement("iframe");
    ifr.title = "FlexiGen";
    window.__JS3D_FLEXI_READY__ = () => {
      const w = ifr.contentWindow;
      if (!w || !w.__flexi) return;
      const t = document.documentElement.getAttribute("data-ui") || "light";
      w.__flexi.theme(t === "contrast" ? "contrast" : t === "dark" ? "dark" : "light");
      w.__flexi.load(soup, name);
    };
    ifr.srcdoc = FLEXI_HTML;
    frame.append(ifr);
    document.body.append(frame);
    app.flexiOpen = true;
  }
  function close() {
    if (frame) { frame.remove(); frame = null; }
    app.flexiOpen = false;
  }
  return { open, close, get isOpen() { return !!frame; } };
}
