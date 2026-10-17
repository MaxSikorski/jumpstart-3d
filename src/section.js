// Section analysis (like Fusion 360's): cut every body with a plane to look inside. Only the
// view changes, never the design. The cut-away side is clipped by the GPU; each body's cut
// face is filled with a hatched cap (drawn with the stencil buffer, so it works for any
// shape) and outlined in bold.
import * as THREE from "three";
import { thickLines } from "./thickline.js";

export function initSection(app, vp, scene) {
  const S = { plane: null, info: null }; // info: { ref, d, flip, hatch } (for editing)
  const clip = new THREE.Plane();
  const root = new THREE.Group();
  root.name = "section";
  vp.world.add(root);
  vp.renderer.localClippingEnabled = true;
  const per = new Map(); // view -> { mesh, back, front, cap, outline, key }
  let hatchTex = null;
  const listeners = new Set();

  function hatch() {
    if (hatchTex) return hatchTex;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = "rgba(0,0,0,0.42)"; g.lineWidth = 5;
    for (let i = -64; i <= 128; i += 21.33) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    hatchTex = new THREE.CanvasTexture(cv);
    hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
    hatchTex.colorSpace = THREE.SRGBColorSpace;
    return hatchTex;
  }
  function stencilMat(side, op) {
    return new THREE.MeshBasicMaterial({
      side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [clip],
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
    });
  }
  function drop(view) {
    const p = per.get(view);
    if (!p) return;
    for (const o of [p.back, p.front]) if (o && o.parent) o.parent.remove(o);
    for (const o of [p.cap, p.outline]) if (o) { root.remove(o); o.geometry.dispose(); o.material.dispose(); }
    if (p.tex) p.tex.dispose();
    p.back && p.back.material.dispose(); p.front && p.front.material.dispose();
    per.delete(view);
  }
  function unclip(view) {
    if (view.mats) for (const m of view.mats) if (m.clippingPlanes && m.clippingPlanes.length) { m.clippingPlanes = null; m.needsUpdate = true; }
    if (view.edges && view.edges.material.clippingPlanes) { view.edges.material.clippingPlanes = null; view.edges.material.needsUpdate = true; }
  }
  // where the plane cuts a body's triangles: segments in world space
  function cutSegments(view) {
    const g = view.mesh.geometry, P = g.attributes.position.array, I = g.index.array;
    const mw = view.mesh.matrixWorld;
    const inv = new THREE.Matrix4().copy(mw).invert();
    const lp = clip.clone().applyMatrix4(inv);
    const n = lp.normal, c = lp.constant;
    const d = new Float32Array(P.length / 3);
    for (let i = 0; i < d.length; i++) d[i] = n.x * P[i * 3] + n.y * P[i * 3 + 1] + n.z * P[i * 3 + 2] + c;
    const out = [], v = new THREE.Vector3();
    const at = (a, b) => { const t = d[a] / (d[a] - d[b]); v.set(P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t).applyMatrix4(mw); return [v.x, v.y, v.z]; };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], cc = I[t + 2];
      const sa = d[a] > 0, sb = d[b] > 0, sc = d[cc] > 0;
      if (sa === sb && sb === sc) continue;
      const pts = [];
      if (sa !== sb) pts.push(at(a, b));
      if (sb !== sc) pts.push(at(b, cc));
      if (sc !== sa) pts.push(at(cc, a));
      if (pts.length === 2) out.push(...pts[0], ...pts[1]);
    }
    return out;
  }
  // runs just before each frame is drawn: keeps every body clipped and capped
  function update() {
    const on = !!S.plane;
    const live = new Set();
    let order = 0;
    for (const view of scene.views.values()) {
      if (!view.mesh) continue;
      const visible = view.group.visible !== false && view.mesh.visible !== false && !!view.body && !view.body.hidden;
      if (!on || !visible) { unclip(view); drop(view); continue; }
      live.add(view);
      for (const m of view.mats) if (m.clippingPlanes !== S.planes) { m.clippingPlanes = S.planes; m.needsUpdate = true; }
      if (view.edges && view.edges.material.clippingPlanes !== S.planes) { view.edges.material.clippingPlanes = S.planes; view.edges.material.needsUpdate = true; }
      let p = per.get(view);
      if (p && p.mesh !== view.mesh) { drop(view); p = null; }
      const solid = !view.mats[0].transparent; // see-through holes and previews get no cap
      if (!p) {
        p = { mesh: view.mesh };
        p.back = new THREE.Mesh(view.mesh.geometry, stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp));
        p.front = new THREE.Mesh(view.mesh.geometry, stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp));
        view.mesh.add(p.back, p.front);
        p.cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
          color: 0xffffff, map: hatch().clone(), side: THREE.DoubleSide,
          stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
        }));
        root.add(p.cap);
        per.set(view, p);
      }
      // one body at a time: count its walls in the stencil, then paint the cap where odd
      p.back.renderOrder = 1000 + order * 3;
      p.front.renderOrder = 1001 + order * 3;
      p.cap.renderOrder = 1002 + order * 3;
      order++;
      p.back.visible = p.front.visible = p.cap.visible = solid;
      const col = new THREE.Color(view.body.color || "#a7b0ba");
      p.cap.material.color.copy(col).lerp(new THREE.Color("#ffffff"), 0.12);
      const wantHatch = !(S.info && S.info.hatch === false);
      if (!!p.cap.material.map !== wantHatch) { p.cap.material.map = wantHatch ? (p.tex || (p.tex = hatch().clone())) : null; p.cap.material.needsUpdate = true; }
      if (wantHatch && !p.tex) p.tex = p.cap.material.map;
      // the cap: a big square lying in the plane, around the body
      const box = new THREE.Box3().setFromObject(view.mesh);
      const size = box.getSize(new THREE.Vector3()).length() * 1.5 + 1;
      const c = clip.projectPoint(box.getCenter(new THREE.Vector3()), new THREE.Vector3());
      p.cap.position.copy(c);
      p.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), clip.normal);
      p.cap.scale.set(size, size, 1);
      // about 60 hatch lines across the cap (3 per tile)
      if (p.cap.material.map) { p.cap.material.map.repeat.set(20, 20); p.cap.material.map.needsUpdate = true; }
      // bold outline of the cut
      const key = [clip.normal.x, clip.normal.y, clip.normal.z, clip.constant].map((x) => x.toFixed(5)).join() + "|" + view.dataVer + "|" + view.group.matrixWorld.elements.map((x) => x.toFixed(4)).join();
      if (p.key !== key) {
        p.key = key;
        if (p.outline) { root.remove(p.outline); p.outline.geometry.dispose(); p.outline.material.dispose(); p.outline = null; }
        view.mesh.updateMatrixWorld();
        const seg = cutSegments(view);
        if (seg.length) { p.outline = thickLines(seg, 0x1b2430, 2.2, true); p.outline.renderOrder = 1999; root.add(p.outline); }
      }
      if (p.outline) p.outline.visible = solid;
    }
    for (const view of [...per.keys()]) if (!live.has(view)) drop(view);
  }
  vp.afterRender.add(update);
  // clicks go through the cut-away part, as if it isn't there
  const pick0 = vp.pick.bind(vp);
  vp.pick = (e, objects) => {
    const hits = pick0(e, objects);
    if (!S.plane) return hits;
    return hits.filter((h) => !(h.object.userData && h.object.userData.bodyView) || clip.distanceToPoint(h.point) >= -1e-6);
  };

  // the section: a reference plane (origin, normal), pushed d along its normal; by default the
  // side the normal points to is cut away (flip keeps that side instead)
  function set(info) {
    if (!info || !info.ref) { S.plane = null; S.planes = null; S.info = null; }
    else {
      const n = new THREE.Vector3(...info.ref.n).normalize();
      const o = new THREE.Vector3(...(info.ref.center || info.ref.o)).addScaledVector(n, info.d || 0);
      clip.setFromNormalAndCoplanarPoint(info.flip ? n : n.clone().negate(), o);
      S.plane = clip;
      S.planes = [clip];
      S.info = { ...info };
    }
    for (const f of listeners) f(S.info);
    vp.request();
  }
  return {
    set,
    clear: () => set(null),
    get info() { return S.info; },
    get on() { return !!S.plane; },
    onChange: (f) => listeners.add(f),
  };
}
