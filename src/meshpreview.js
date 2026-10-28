// Import preview: while the geometry worker turns an imported STL / 3MF / OBJ into a solid (seconds to a minute), the view draws the file's own
// triangles as a see-through "Preparing…" copy, so the mesh is visible at once. The preview is display only. It lives in the body's view group as
// `v.preview`, never as `v.mesh`, and `v.data` stays empty, so every tool still sees a body that is not built yet and nothing can act on it.
// What works on such a body is what always worked: move (keyboard, Move dialog, JS3D.move: the preview follows), hide, the mm / cm / in buttons
// (the preview rescales), Undo, delete, duplicate (each copy shows its own preview). Group and Export wait for the solid. A click on the preview does
// nothing; handles, faces, edges, measuring and print preview appear once the solid is ready.
import * as THREE from "three";
import { fromB64 } from "./meshimport.js";

const labelled = new WeakSet(); // scenes whose "Preparing…" tags are wired up

// the preview's box in world space (the body's own matrix and the units scale included), or null
export function previewWorldBox(view) {
  const p = view && view.preview;
  if (!p) return null;
  const box = p.geometry.boundingBox.clone();
  box.min.multiplyScalar(p.scale.x);
  box.max.multiplyScalar(p.scale.x);
  return box.applyMatrix4(view.group.matrix);
}

// A units change on a plain imported mesh (same file, no features, same placing rule) is an even stretch about the origin: the kernel scales by k
// and then re-centres, which keeps the centre and the plate contact. Returns the factor to stretch the shown solid by, or null.
export function meshStretch(oldNode, newNode) {
  const plain = (n) => n.t === "mesh" && !(n.mods && n.mods.length);
  if (!plain(oldNode) || !plain(newNode) || oldNode.asset !== newNode.asset || !!oldNode.keepPos !== !!newNode.keepPos) return null;
  const f = (newNode.k || 1) / (oldNode.k || 1);
  return f !== 1 && isFinite(f) && f > 0 ? f : null;
}

// the file's triangles, flat shaded, where the kernel will put them (bbox centre at x 0 / y 0, bottom at z 0, unless keepPos), before the k scale
function previewGeometry(asset, keepPos) {
  const u8 = fromB64(asset.data);
  if (u8.length < 8) throw new Error("mesh file too short");
  const head = new Uint32Array(u8.buffer, 0, 2), nv = head[0], nt = head[1];
  if (8 + nv * 12 + nt * 12 > u8.length) throw new Error("mesh file shorter than its header says");
  const V = new Float32Array(u8.buffer, 8, nv * 3), I = new Uint32Array(u8.buffer, 8 + nv * 12, nt * 3);
  const tris = []; // triangles whose corners all exist
  for (let t = 0; t < nt; t++) if (I[t * 3] < nv && I[t * 3 + 1] < nv && I[t * 3 + 2] < nv) tris.push(t);
  if (!tris.length) throw new Error("mesh file has no usable triangles");
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
    const x = V[I[t * 3 + k] * 3 + c];
    if (x < lo[c]) lo[c] = x;
    if (x > hi[c]) hi[c] = x;
  }
  const off = keepPos ? [0, 0, 0] : [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, n) => { for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) pos[n * 9 + k * 3 + c] = V[I[t * 3 + k] * 3 + c] + off[c]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function disposePreview(v) {
  if (!v.preview) return;
  v.group.remove(v.preview);
  v.preview.geometry.dispose();
  v.preview.material.dispose();
  v.preview = null;
  v.previewSig = null;
}

// Called by SceneSync.refresh for every body, right after it sets v.pending. Shows the preview of a plain imported mesh whose solid is not
// built yet, keeps it in step with the body (units scale, colour), and removes it as soon as that stops being true.
export function syncMeshPreview(scene, v, b) {
  const n = b.node, asset = n.t === "mesh" && !(n.mods && n.mods.length) && scene.doc.assets && scene.doc.assets[n.asset];
  if (!(v.pending && !v.mesh && asset && asset.kind === "mesh")) { disposePreview(v); v.previewBad = null; return; }
  const sig = n.asset + (n.keepPos ? "!" : "");
  if (v.previewBad === sig) { disposePreview(v); return; } // this file could not be previewed: show nothing (not another file's preview), do not retry every refresh
  if (v.previewSig !== sig) {
    disposePreview(v);
    let g;
    try { g = previewGeometry(asset, n.keepPos); }
    catch (e) { v.previewBad = sig; return; } // a damaged file just has no preview; the kernel reports it when it builds
    v.previewBad = null;
    const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.04, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    v.preview = new THREE.Mesh(g, m);
    v.preview.raycast = () => {}; // never takes a click
    v.preview.renderOrder = 3;
    v.preview.userData.meshPreview = true;
    v.previewSig = sig;
    v.group.add(v.preview);
    wireTags(scene);
  }
  v.preview.material.color.set(b.hole ? "#8f99a3" : b.color || "#a7b0ba");
  v.preview.scale.setScalar(n.k || 1);
}

// shown in the world: the group and every parent up to the scene (Architect hides the whole scene root)
const inWorld = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

// one "Preparing…" tag per preview, above its top centre; it goes with the preview
function wireTags(scene) {
  if (labelled.has(scene)) return;
  labelled.add(scene);
  const vp = scene.vp, tags = new Map(); // bodyId -> tag element
  vp.labelFns.add(() => {
    const seen = new Set();
    for (const [id, v] of scene.views) {
      if (!v.preview || !inWorld(v.group)) continue;
      const box = previewWorldBox(v);
      let tag = tags.get(id);
      if (!tag) {
        tag = vp.addLabel("prep");
        tag.textContent = "Preparing…";
        tag.dataset.body = id;
        tags.set(id, tag);
      }
      const s = vp.project(new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z));
      tag.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-130%)`;
      seen.add(id);
    }
    for (const [id, tag] of tags) if (!seen.has(id)) { tag.remove(); tags.delete(id); }
  });
}
