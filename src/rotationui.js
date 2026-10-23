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
export function nearestArc(vp, e, cands, maxPx = TOUCH_PICK_PX) { const r = nearestArcAt(vp, e, cands, maxPx); return r && r.key; }
// the same, with how far (on screen, in px) the drawn line is from the pointer
export function nearestArcAt(vp, e, cands, maxPx = TOUCH_PICK_PX) {
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
  return best && { key: best, d: bd };
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

// ---------------------------------------------------------------------------------------------- turn feedback (issue #100 follow-up)
// A neutral dashed circle round the pivot, perpendicular to the axis being turned, that passes through the selection's own
// orbit (never smaller than 70 screen pixels), and a contrasting pill with the applied angle beside the pointer.
export const MIN_RING_PX = 70;
const PILL_GAP = 18, PILL_FINGER_UP = 56;

// put a pill beside the pointer (farther above a finger), kept inside the viewport
export function placePill(vp, pill, e) {
  const [mx, my] = vp.local(e);
  const w = pill.offsetWidth || 60, h = pill.offsetHeight || 24;
  const x = Math.max(4, Math.min(vp.w - w - 4, mx + PILL_GAP));
  const y = Math.max(4, Math.min(vp.h - h - 4, vp.touchMode ? my - PILL_FINGER_UP : my - h / 2));
  pill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function turnFeedback(vp) {
  const N = 96, pts = [];
  for (let i = 0; i < N; i++) pts.push(new THREE.Vector3(Math.cos((i / N) * Math.PI * 2), Math.sin((i / N) * Math.PI * 2), 0));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x8a95a3, dashSize: 0.05, gapSize: 0.04, depthTest: false, depthWrite: false, transparent: true }));
  line.computeLineDistances();
  line.renderOrder = 45;
  line.visible = false;
  line.userData.turnRing = true;
  vp.overlay.add(line);
  const pill = el("div", { class: "turn-pill", hidden: true });
  vp.labels.append(pill);
  return {
    line, pill,
    // pivot and axis of the turn; orbit: the selection's middle (its distance from the axis sets the radius)
    show(pivot, axis, orbit) {
      const off = orbit.clone().sub(pivot), r = off.sub(axis.clone().multiplyScalar(off.dot(axis))).length();
      line.position.copy(pivot);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      line.scale.setScalar(Math.max(r, MIN_RING_PX * vp.pixelSize(pivot)));
      line.visible = true;
      vp.request();
    },
    angle(deg, e) {
      pill.hidden = false;
      pill.textContent = `${deg > 0 ? "+" : ""}${deg}°`;
      placePill(vp, pill, e);
    },
    hide() { line.visible = false; pill.hidden = true; vp.request(); },
    dispose() { vp.overlay.remove(line); line.geometry.dispose(); line.material.dispose(); pill.remove(); },
  };
}

// ---------------------------------------------------------------------------------------------- drag math shared by Move / Copy and the live gizmo
// where along the line (origin, dir) the pointer is, in world units: the closest point of the pointer's ray to the line
export function axisAlong(vp, ev, origin, dir) {
  const ray = vp.ray(ev);
  const w0 = origin.clone().sub(ray.origin);
  const b = dir.dot(ray.direction), c = ray.direction.dot(ray.direction), d = dir.dot(w0), ee = ray.direction.dot(w0);
  const den = c - b * b;
  return Math.abs(den) < 1e-9 ? null : (b * ee - c * d) / den;
}
// Turning by dragging a ring: the angle (degrees, by the 15° rule) of the pointer round the ring's centre on screen since the press.
// Which way round counts as positive depends on whether the axis faces the viewer.
export function ringDrag(vp, e, center, axis) {
  const facing = Math.sign(axis.dot(vp.camera.position.clone().sub(center))) || 1;
  const angAt = (ev) => { const [mx, my] = vp.local(ev), s = vp.project(center); return Math.atan2(-(my - s[1]), mx - s[0]); };
  let prev = angAt(e), total = 0;
  return (ev) => {
    const a = angAt(ev);
    let da = a - prev;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    prev = a;
    total += da * facing;
    return dragAngle((total * 180) / Math.PI, ev.shiftKey);
  };
}

// ---------------------------------------------------------------------------------------------- the move / turn gizmo
// X/Y/Z arrows (move along an axis), three rings (turn) and a small screen-plane pad (move freely), drawn on top of everything.
// Its centre is left empty: the pivot dot (pivot.js) owns it. Callers: Move / Copy (a transaction with OK / Cancel) and the live
// gizmo that follows a selection in Advanced.
export const PAD_OFFSET_PX = 52, PAD_PICK_PX = 14, PAD_TOUCH_PX = 22; // the pad sits this far from the centre, so the dot and the pad never compete
export function makeGizmo(vp) {
  const AX = [["x", 0xd9534f, new THREE.Vector3(1, 0, 0)], ["y", 0x3f9b52, new THREE.Vector3(0, 1, 0)], ["z", 0x2f6fd0, new THREE.Vector3(0, 0, 1)]];
  const group = new THREE.Group();
  for (const [name, color, dir] of AX) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 14).translate(0, 1.12, 0), mat);
    // fat invisible grab zone
    const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 6).translate(0, 0.65, 0), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(shaft, tip, grab);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.userData.axis = name; g.userData.dir = dir; g.userData.mat = mat; g.userData.color = color;
    g.renderOrder = shaft.renderOrder = tip.renderOrder = 20;
    group.add(g);
  }
  const padMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), padMat);
  pad.add(new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: 0x18202a, depthTest: false })));
  pad.userData.axis = "free"; pad.userData.mat = padMat; pad.userData.color = 0xffffff;
  pad.renderOrder = 21; pad.children[0].renderOrder = 22;
  group.add(pad);
  const rings = [];
  for (const [name, color, dir] of AX) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.026, 8, 72), mat);
    const grab = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.1, 6, 56), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(ring, grab);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); // a torus lies in XY: its axis is Z
    g.userData.axis = "rot-" + name; g.userData.dir = dir; g.userData.mat = mat; g.userData.color = color; g.userData.ring = true;
    ring.renderOrder = 19;
    group.add(g);
    rings.push(g);
  }
  group.visible = false;
  vp.overlay.add(group);
  return {
    group, rings, pad,
    // centre: where the gizmo sits; ringSet: "all" or "z"; hot: the part under the pointer or being dragged
    place(centre, ringSet, hot) {
      group.position.copy(centre);
      const s = vp.pixelSize(centre) * 70;
      group.scale.setScalar(s);
      for (const g of group.children) if (g.userData.mat) g.userData.mat.color.set(hot === g ? 0xe8a317 : g.userData.color);
      for (const r of rings) r.visible = ringSet === "all" || r.userData.axis === "rot-z";
      // the pad is a camera-facing square down and to the right of the centre
      const q = vp.camera.quaternion, k = PAD_OFFSET_PX / 70 / Math.SQRT2;
      pad.position.set(0, 0, 0).addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), k).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), -k);
      pad.quaternion.copy(q);
    },
    // the part under the pointer (arrow group, ring group or the pad) or null. Arrows win over the rings they sit inside, a ring over
    // the pad. A finger gets the pad by a 44 px zone and the ring drawn nearest the touch (never an invisible one), whichever is nearer.
    pick(e) {
      if (!group.visible) return null;
      vp.updateCamera();
      group.updateMatrixWorld(true);
      const [mx, my] = vp.local(e), pp = vp.project(pad.getWorldPosition(new THREE.Vector3())), dp = Math.hypot(pp[0] - mx, pp[1] - my);
      vp.ray(e);
      const hits = vp.raycaster.intersectObjects(group.children.filter((c) => c.visible && c !== pad), true);
      const pickOf = (h) => { let o = h.object; while (o && !o.userData.axis) o = o.parent; return o; };
      const first = hits.map(pickOf).find((o) => o && !o.userData.ring);
      if (first) return first;
      if (vp.touchMode && !vp.tapping) { // (a finger's tap replayed by the viewport is a click on what is under it: only a handle it hits exactly counts)
        const arc = nearestArcAt(vp, e, rings.filter((r) => r.visible).map((r) => ({ key: r, pts: arcPoints(r, 0.95) })));
        if (dp <= PAD_TOUCH_PX && (!arc || dp < arc.d)) return pad;
        return arc && arc.key;
      }
      if (hits.length) return pickOf(hits[0]);
      return dp <= PAD_PICK_PX ? pad : null;
    },
    dispose() {
      vp.overlay.remove(group);
      group.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
    },
  };
}
