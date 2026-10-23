// jumpstart-3d: fine rotation (issue #87). A "Turn" control in the status bar, beside the unit switch: pick an axis and a step
// (15, 5, 1, 0.5 or 0.1 degrees); − and + turn the selected shapes by that step and are big enough for a finger; Snap back
// lines the shape up with the grid again (the nearest right-angle position). The , and . keys use the same step.
import * as THREE from "three";
import { store, findBody } from "./store.js";
import { el } from "./util.js";
import { transformBodies, M4 } from "./ops.js";
import { TURN_STEPS, fine, turnAbout, pivotOf } from "./rotationui.js";

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

// the right-angle orientations: all 48 signed permutation matrices, 24 proper turns (det +1) and 24 mirrored ones (det -1), so a body
// flipped with Mirror snaps to the nearest right-angle pose and stays mirrored
const det3 = (q) => q[0] * (q[4] * q[8] - q[7] * q[5]) - q[3] * (q[1] * q[8] - q[7] * q[2]) + q[6] * (q[1] * q[5] - q[4] * q[2]);
const CUBE_TURNS = (() => {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const q = new Array(9).fill(0); // column-major: column j has sign s[j] in row p[j]
    [sx, sy, sz].forEach((sg, j) => { q[j * 3 + p[j]] = sg; });
    out.push(q);
  }
  return out;
})();
function alignDelta(m) { // the turn that takes the body's orientation to the nearest right-angle one, or null when it is there already
  const r = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => m[i]);
  let best = null, score = -Infinity;
  const flip = det3(r) < 0;
  for (const q of CUBE_TURNS) { if ((det3(q) < 0) !== flip) continue; const s = q.reduce((t, v, i) => t + v * r[i], 0); if (s > score) { score = s; best = q; } }
  const Q = new THREE.Matrix4().set(best[0], best[3], best[6], 0, best[1], best[4], best[7], 0, best[2], best[5], best[8], 0, 0, 0, 0, 1);
  const R = new THREE.Matrix4().set(r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1);
  const D = Q.multiply(R.transpose()); // Q · Rᵀ takes R to Q for a pure turn
  return D.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9) ? null : D;
}

export function initFineTurn(app) {
  const touchUI = () => document.documentElement.classList.add("touch-ui"); // bigger status bar for a finger
  if (matchMedia("(pointer: coarse)").matches) touchUI();
  document.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") touchUI(); }, true);

  const axisSel = el("select", { id: "turn-axis", "aria-label": "Turn around", title: "The axis the − and + buttons turn around" }, ...["z", "x", "y"].map((a) => el("option", { value: a }, a.toUpperCase())));
  const stepSel = el("select", { id: "turn-step", "aria-label": "Turn step", title: "How far − and + turn, and the , and . keys" }, ...TURN_STEPS.map((s) => el("option", { value: s, selected: s === fine.step }, s + "°")));
  stepSel.onchange = () => { fine.step = +stepSel.value; stepSel.blur(); }; // blur: the , and . keys are ignored while a dropdown has focus
  axisSel.onchange = () => axisSel.blur();
  const bar = el("span", { class: "turnctl", id: "turnctl", role: "group", "aria-label": "Fine turn" },
    el("span", {}, "Turn"), axisSel, stepSel,
    el("button", { id: "turn-minus", title: "Turn the selected shape back by the chosen step", "aria-label": "Turn back", onclick: () => turn(-fine.step) }, "−"),
    el("button", { id: "turn-plus", title: "Turn the selected shape forward by the chosen step", "aria-label": "Turn forward", onclick: () => turn(fine.step) }, "+"),
    el("button", { id: "turn-back", title: "Turn the selected shape to the nearest right-angle position, lined up with the grid", onclick: snapBack }, "Snap back"));
  document.getElementById("unit-toggle").after(bar);

  // the selected shapes that can turn, or null (with a word to the user)
  function movable() {
    if (app.command) { app.toast("Finish or cancel the open tool first."); return null; }
    const ids = app.sel.filter((id) => !app.isLocked(id) && findBody(store.doc, id));
    if (!ids.length) app.toast(app.sel.length ? "Locked shapes stay where they are." : "Select a shape to turn.");
    return ids.length ? ids : null;
  }
  function turn(deg) {
    const axis = axisSel.value;
    if (app.command) { if (!(app.command.turnBy && app.command.turnBy(deg, null, axis))) app.toast("Finish or cancel the open tool first."); return; }
    const ids = movable();
    if (!ids) return;
    let c; // one shape turns about its own middle; several about the middle of their combined box (taken once)
    if (ids.length === 1) c = pivotOf(app.scene, ids[0], M4(findBody(store.doc, ids[0]).m));
    else { const box = new THREE.Box3(); for (const id of ids) { const b = app.scene.bodyTightBox(id); if (b) box.union(b); } if (!box.isEmpty()) c = box.getCenter(new THREE.Vector3()); }
    if (!c) return;
    transformBodies(ids, turnAbout(c, AXES[axis], deg), `Turn ${axis.toUpperCase()} ${deg > 0 ? "+" : ""}${deg}°`);
  }
  function snapBack() {
    const ids = movable();
    if (!ids) return;
    const jobs = ids.map((id) => {
      const m = findBody(store.doc, id).m, D = alignDelta(m), c = pivotOf(app.scene, id, M4(m));
      if (!D || !c) return null;
      return [id, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(D).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z))];
    }).filter(Boolean);
    if (!jobs.length) { app.toast("Already lined up with the grid."); return; }
    store.update((doc) => { for (const [id, T] of jobs) transformBodies([id], T, "", doc); }, "Snap back to the grid");
  }
}
