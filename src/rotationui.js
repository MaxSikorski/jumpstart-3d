// jumpstart-3d: rotation access (issue #100). What Beginner's rotation arcs and Advanced's Move / Rotate rings share:
// the angle rule for a drag, the turn matrix, the Snap 15° / Free switch, and a finger-sized way to pick the nearest arc.
import * as THREE from "three";
import { el } from "./util.js";

export const SNAP_DEG = 15;
export const TOUCH_PICK_PX = 22; // half of the 44 px wide zone around an arc
export const snap = { free: false };
// jumpstart-3d: fine rotation (issue #87). The step the , and . keys and the status bar's − / + turn by (Shift on the keys stays 15°)
export const TURN_STEPS = [15, 5, 1, 0.5, 0.1];
export const fine = { step: 1 };

// A drag turns by the nearest 15°. Shift (or the Free switch, for a finger) gives the pointer's own angle, to 0.01°.
export function dragAngle(deg, shiftKey) {
  return shiftKey || snap.free ? Math.round(deg * 100) / 100 : Math.round(deg / SNAP_DEG) * SNAP_DEG;
}

// the matrix that turns things by deg around the line through center along axis
export function turnAbout(center, axis, deg) {
  return new THREE.Matrix4().makeTranslation(center.x, center.y, center.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, (deg * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}

// The point a body turns about: the middle of its own unturned box, carried into the world by matrix m. Unlike the world
// box's middle it does not move when the body turns (a wedge turned +45 then -45 comes back to where it was).
export function pivotOf(scene, id, m) {
  const v = scene.views.get(id);
  if (!v || !v.data) return null;
  if (!v._pivot || v._pivot.data !== v.data) {
    const box = new THREE.Box3(), p = v.data.vertices, t = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(t.set(p[i], p[i + 1], p[i + 2]));
    v._pivot = { data: v.data, c: box.getCenter(new THREE.Vector3()) };
  }
  return v._pivot.c.clone().applyMatrix4(m);
}

// world points along an arc drawn in the XY plane of obj (radius r, from angle 0 for span radians)
export function arcPoints(obj, r, span = Math.PI * 2, n = 48) {
  obj.updateWorldMatrix(true, false);
  return Array.from({ length: n + 1 }, (_, i) => new THREE.Vector3(Math.cos((span * i) / n) * r, Math.sin((span * i) / n) * r, 0).applyMatrix4(obj.matrixWorld));
}

// The candidate ({ key, pts }) whose drawn line passes nearest the pointer, if within maxPx on screen; a thin ring that
// is not under the fingertip no longer loses to a fat invisible one, because only the drawn lines count.
export function nearestArc(vp, e, cands, maxPx = TOUCH_PICK_PX) {
  vp.updateCamera();
  const [mx, my] = vp.local(e);
  let best = null, bd = maxPx;
  for (const { key, pts } of cands) {
    let prev = null;
    for (const p of pts) {
      const s = vp.project(p);
      if (s[2] < -1 || s[2] > 1) { prev = null; continue; }
      if (prev) {
        const dx = s[0] - prev[0], dy = s[1] - prev[1], len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((mx - prev[0]) * dx + (my - prev[1]) * dy) / len2)) : 0;
        const d = Math.hypot(mx - (prev[0] + t * dx), my - (prev[1] + t * dy));
        if (d < bd) { bd = d; best = key; }
      }
      prev = s;
    }
  }
  return best;
}

// The Snap 15° / Free switch, shown in both modes' panels (44 px buttons, so a finger can hit them)
export function snapSwitch() {
  const snapBtn = el("button", { id: "rot-snap", title: "Dragging an arc or ring turns in 15° steps" }, "Snap 15°");
  const freeBtn = el("button", { id: "rot-free", title: "Dragging an arc or ring turns by any angle (Shift does the same)" }, "Free");
  const paint = () => { snapBtn.setAttribute("aria-pressed", String(!snap.free)); freeBtn.setAttribute("aria-pressed", String(snap.free)); };
  snapBtn.onclick = () => { snap.free = false; paint(); };
  freeBtn.onclick = () => { snap.free = true; paint(); };
  paint();
  return el("div", { class: "seg rot-btn" }, snapBtn, freeBtn);
}
