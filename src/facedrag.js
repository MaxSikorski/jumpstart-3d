// Face snap in a Beginner move drag: the glue between the pointer and facesnap.js.
import * as THREE from "three";
import { faceKind, topLanding, sideLanding } from "./facesnap.js";

// at drag start: the selection's tight box, or null when face snap does not apply (a hole is being dragged)
export function faceBox(app, ids, doc) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const b = doc.bodies.find((x) => x.id === id);
    const t = app.scene.bodyTightBox(id);
    if (!b || b.hole || !t) return null;
    box.union(t);
  }
  return box.isEmpty() ? null : box;
}

// on each pointer move: null = plain drag; { dz } = slide as today but lifted by dz; { mats } = id -> new matrix (array) for a turned landing
export function faceDrag(app, drag, e) {
  if (!drag.box0 || !app.faceSnap || e.altKey) return null;
  const hit = app.scene.pickFace(e, (b) => !drag.ids.includes(b.id) && !b.hole && !b.hidden);
  const n = hit && hit.normal.toArray(), kind = hit && faceKind(n);
  if (!hit || kind === "under") return drag.touched ? { dz: -drag.box0.min.z } : null;
  drag.touched = true;
  if (kind === "top") return { dz: topLanding(hit.point.z, drag.box0.min.z) };
  const L = new THREE.Matrix4().fromArray(sideLanding(n, hit.point.toArray(), { min: drag.box0.min.toArray(), max: drag.box0.max.toArray() }, app.gridStep()));
  const mats = new Map();
  for (const id of drag.ids) mats.set(id, new THREE.Matrix4().fromArray(drag.base.get(id)).premultiply(L).toArray());
  return { mats };
}
