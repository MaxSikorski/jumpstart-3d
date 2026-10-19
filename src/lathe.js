// Lathe: turn a body of the design, or a round or square blank, on a virtual wood
// lathe. The work spins at the speed you pick while the pedal is down (hold Space, or the Pedal
// button); push a chisel in with the mouse, a finger or a pen and it cuts away a little at a time,
// with chips flying off. Scroll (or Q / E) twists the chisel; the angle buttons set it exactly.
// When done, the work can be hollowed out (a cup, a vase, a bowl from the end) and goes into the
// design as a mesh body that Beginner, Advanced and Chisel can move, scale and change.
//
// The work is kept as radii: N slices along the spin axis, A angles around it. A cut can only make
// a radius smaller, so a non-round body stays as it was until the chisel reaches it.
import * as THREE from "three";
import { store, findBody, nextSeq, IDENTITY } from "./store.js";
import { el, uid, makeZip } from "./util.js";
import { nextName } from "./ops.js";
import { packMesh, toB64, contentId, simplify } from "./meshimport.js";

const A = 96; // angles around the axis
const MINR = 0.5; // a slice thinner than this has been parted off
const OUT_TRIS = 15000; // triangles in the finished body (more makes the engine crawl)
const H = 0; // the spin axis is the lathe's x axis at height 0

// cutting edges, seen from above: u along the axis, v back from the tip (0 = tip). rate: how many
// mm a second it takes off at 1000 rpm
const TOOLS = {
  rough: { label: "Roughing gouge", w: 25, rate: 10, chip: 1.4, edge: (u) => 13 - Math.sqrt(169 - u * u), tip: "Big, fast cuts: makes a square blank round" },
  spindle: { label: "Spindle gouge", w: 10, rate: 6, chip: 1, edge: (u) => 0.14 * u * u, tip: "Coves, beads and curves" },
  skew: { label: "Skew chisel", w: 20, rate: 6, chip: 0.8, edge: (u) => 0.364 * (u + 10), tip: "Smooth, flat finishing cuts (twist it to change the slope)" },
  parting: { label: "Parting tool", w: 3, rate: 8, chip: 0.7, edge: () => 0, tip: "Narrow, deep cuts: sizes a part or parts it off" },
  vpoint: { label: "Point tool (V)", w: 12, rate: 5, chip: 0.7, edge: (u) => Math.abs(u) * 1.2, tip: "V grooves and fine detail" },
  round: { label: "Round scraper", w: 16, rate: 3, chip: 0.6, edge: (u) => 8 - Math.sqrt(Math.max(0, 64 - u * u)), tip: "Smooths coves and hollows" },
  square: { label: "Square scraper", w: 20, rate: 3, chip: 0.6, edge: () => 0, tip: "Flat, even surfaces" },
};
const WOODS = {
  body: { label: "Same as the body" },
  maple: { label: "Maple", c: "#e6c896" },
  pine: { label: "Pine", c: "#ecd39a" },
  oak: { label: "Oak", c: "#c79a5d" },
  cherry: { label: "Cherry", c: "#b9714a" },
  walnut: { label: "Walnut", c: "#7a5236" },
  plastic: { label: "Plastic (blue)", c: "#4f86c6" },
};
const ANGLES = [-45, -30, -15, 0, 15, 30, 45];

export function initLathe(app) {
  let ui = null;
  const LS = "jumpstart3d.lathe.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  // ------------------------------------------------------------------ opening
  function open(opts = {}) {
    if (ui) return;
    if (app.command && app.advanced && app.advanced.cancel) { try { app.advanced.cancel(); } catch (e) {} }
    if (app.sketcher && app.sketcher.active) app.exitSketch();
    const sel = (app.sel || []).filter((id) => findBody(store.doc, id) && !findBody(store.doc, id).hidden);
    const st = {
      from: app.mode,
      src: sel.length ? "body" : pref("src", "square"), bodyId: sel[0] || null, axis: pref("axis", "auto"),
      blank: pref("blank", { d: 50, side: 50, len: 150 }),
      wood: pref("wood", "maple"),
      tool: pref("tool", "rough"), twist: 0, snap: pref("snap", true),
      rpm: pref("rpm", 1200), latch: false, pedalMode: pref("pedalMode", "on"),
      hollow: pref("hollow", { on: false, end: "tail", wall: 3, base: 6, style: "follow" }),
      keepBiggest: true, copy: pref("copy", true),
      undo: [], redo: [],
    };
    buildUI(st);
    chooseWork(true);
  }

  // ------------------------------------------------------------------ the screen
  function buildUI(st) {
    const root = el("div", { class: "s3d lathe", id: "lathe", role: "dialog", "aria-label": "Lathe" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "lathe-canvas", tabindex: "0" });
    const lab = el("div", { class: "s3d-lab l lathe-lab" }, el("b", {}, "Lathe"), el("span", { id: "lathe-hint" }, ""));
    const rpmEl = el("div", { class: "lathe-rpm", id: "lathe-rpm" }, "0 rpm");
    const pedal = el("button", { class: "lathe-pedal", id: "lathe-pedal" }, "Start");
    const latch = el("span");
    const msg = el("div", { class: "lathe-msg", id: "lathe-msg", hidden: true });
    const tray = el("div", { class: "lathe-tray" }, rpmEl, pedal);
    panes.append(canvas, lab, msg, tray);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--vp-bg").trim() || "#e9edf3");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7a6a5a, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.6, -1.2, 2.2); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(1, 1, 0.5); scene.add(fill);
    const cam = new THREE.PerspectiveCamera(38, 1, 1, 20000); cam.up.set(0, 0, 1);
    const spin = new THREE.Group(); // the work, turning about x
    const lathe = new THREE.Group(); // bed, headstock, tailstock, tool rest
    const tool = new THREE.Group();
    const chipsGroup = new THREE.Group();
    // the chisel and its rest sit in the plane through the spin axis that faces you, so the tip is
    // where the pointer is (a lathe cuts the same all the way around, so any side works)
    const roll = new THREE.Group();
    roll.add(tool);
    scene.add(spin, lathe, roll, chipsGroup);
    ui = { st, root, bar, panes, canvas, renderer, scene, cam, spin, lathe, tool, roll, chipsGroup, rpmEl, pedal, latchBtn: latch, msg,
      view: { az: -Math.PI / 2, el: 0.75, dist: 400, target: new THREE.Vector3() },
      angle: 0, rpmNow: 0, pedalDown: false, pressed: false, tip: null, ptr: null, cutThisPress: false, chips: [], raf: 0, last: performance.now(), work: null, pointers: new Map() };
    renderBar();
    const ro = new ResizeObserver(() => resize()); ro.observe(panes); ui.ro = ro;
    resize();
    bindPointers();
    // the on-screen pedal: in "Stays on" a tap starts or stops the lathe; in "Hold" it spins while held
    pedal.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (st.pedalMode === "on") { setRunning(!st.latch); return; }
      try { pedal.setPointerCapture(e.pointerId); } catch (err) {}
      ui.pedalDown = true;
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pedal.addEventListener(t, (e) => { if (st.pedalMode !== "on") { e.preventDefault(); ui.pedalDown = false; } });
    ui.onKey = (e) => onKey(e, true); ui.onKeyUp = (e) => onKey(e, false);
    addEventListener("keydown", ui.onKey, true); addEventListener("keyup", ui.onKeyUp, true);
    ui.onBlur = () => { if (ui) ui.pedalDown = false; };
    addEventListener("blur", ui.onBlur);
    setTimeout(() => canvas.focus({ preventScroll: true }), 30);
    pedalLook();
    loop();
  }
  function resize() {
    if (!ui) return;
    const r = ui.panes.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    ui.cam.aspect = r.width / Math.max(1, r.height); ui.cam.updateProjectionMatrix();
  }
  function setRunning(on) {
    if (!ui) return;
    ui.st.latch = !!on;
    pedalLook();
  }
  function pedalLook() {
    const st = ui.st, p = ui.pedal;
    const on = st.pedalMode === "on";
    p.textContent = on ? (st.latch ? "Stop" : "Start") : "Pedal";
    p.title = on ? "Start or stop the lathe (or tap Space)" : "The foot pedal: hold to spin (or hold Space)";
    p.classList.toggle("running", on && st.latch);
    const h = document.getElementById("lathe-hint");
    if (h) h.textContent = (on ? "Tap Space (or Start) to turn the lathe on and off" : "Hold Space (or the Pedal button) to spin") + " · point inside the wood's outline (further in cuts deeper) and press and hold to cut, drag to move along · scroll or Q / E twists the chisel · right-drag to look around";
    document.querySelectorAll("#lathe-pedalmode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === st.pedalMode)));
  }
  function placeCamera() {
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.cam.position.copy(v.target).addScaledVector(dir, v.dist); ui.cam.lookAt(v.target);
  }

  // ------------------------------------------------------------------ the toolbar
  function renderBar() {
    const st = ui.st, b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const toolSel = el("select", { class: "num lathe-sel", id: "lathe-tool", title: TOOLS[st.tool].tip, onchange: (e) => { st.tool = e.target.value; setPref("tool", st.tool); buildTool(); renderBar(); } },
      ...Object.entries(TOOLS).map(([k, t]) => el("option", { value: k, selected: k === st.tool }, t.label)));
    const angles = el("div", { class: "seg s3d-seg", id: "lathe-angle" }, ...ANGLES.map((a) => el("button", { "aria-pressed": String(Math.round(st.twist) === a), title: a ? `Twist the chisel ${Math.abs(a)}° ${a < 0 ? "to the left" : "to the right"}` : "Straight in", onclick: () => setTwist(a) }, (a > 0 ? "+" : "") + a + "°")));
    const speed = el("input", { type: "range", min: 100, max: 3000, step: 50, value: st.rpm, id: "lathe-speed", "aria-label": "Speed (rpm)", oninput: (e) => { st.rpm = +e.target.value; setPref("rpm", st.rpm); spd.textContent = st.rpm + " rpm"; } });
    const spd = el("span", { class: "lathe-spd" }, st.rpm + " rpm");
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "Lathe")),
      grp("Work", el("button", { class: "btn", id: "lathe-work", onclick: () => chooseWork(false), title: "Change what is on the lathe" }, workName())),
      grp("Chisel", toolSel),
      grp("Angle", el("div", { class: "lathe-row" }, angles, el("span", { class: "lathe-ang", id: "lathe-ang" }, fmtAng(st.twist)))),
      el("label", { class: "check s3d-chk", title: "Scrolling twists in 15° steps" }, el("input", { type: "checkbox", id: "lathe-snap", checked: st.snap, onchange: (e) => { st.snap = e.target.checked; setPref("snap", st.snap); } }), "Snap 15°"),
      grp("Speed", el("div", { class: "lathe-row" }, speed, spd)),
      grp("Foot pedal", el("div", { class: "seg s3d-seg", id: "lathe-pedalmode" },
        ...[["on", "Stays on", "Tap Space (or Start) once to turn the lathe on, again to turn it off"], ["hold", "Hold", "Spins only while you hold Space (or the Pedal button), like a real foot pedal"]].map(([v, l, t]) => el("button", { "data-v": v, "aria-pressed": String(st.pedalMode === v), title: t, onclick: () => { st.pedalMode = v; setPref("pedalMode", v); ui.pedalDown = false; if (v === "hold") st.latch = false; pedalLook(); } }, l)))),
      el("span", { class: "s3d-sp" }),
      grp("", el("button", { class: "btn", id: "lathe-undo", title: "Undo (Ctrl+Z)", disabled: !st.undo.length, onclick: undo }, "↶ Undo"), el("button", { class: "btn", id: "lathe-redo", title: "Redo (Ctrl+Y)", disabled: !st.redo.length, onclick: redo }, "↷ Redo")),
      grp("", el("select", { class: "num", id: "lathe-export", title: "Save what's on the lathe as a file", disabled: !ui.work, onchange: (e) => { const f = e.target.value; e.target.value = ""; if (f) quickExport(f); } },
        el("option", { value: "" }, "Export…"), el("option", { value: "stl" }, "STL"), el("option", { value: "3mf" }, "3MF"), el("option", { value: "obj" }, "OBJ"))),
      grp("", el("button", { class: "btn", id: "lathe-cancel", onclick: () => close(false) }, "Cancel"), el("button", { class: "btn primary", id: "lathe-done", disabled: !ui.work, onclick: () => finish() }, "Done")),
    );
  }
  const fmtAng = (a) => (a > 0 ? "+" : "") + Math.round(a) + "°";
  function setTwist(a) {
    const st = ui.st;
    st.twist = Math.max(-80, Math.min(80, a));
    const t = document.getElementById("lathe-ang"); if (t) t.textContent = fmtAng(st.twist);
    document.querySelectorAll("#lathe-angle button").forEach((b, i) => b.setAttribute("aria-pressed", String(Math.round(st.twist) === ANGLES[i])));
    placeTool();
  }
  const workName = () => { const st = ui.st; if (st.src === "body") { const b = findBody(store.doc, st.bodyId); return b ? b.name : "A body"; } return st.src === "round" ? "Round blank" : "Square blank"; };

  // ------------------------------------------------------------------ what goes on the lathe
  function chooseWork(first) {
    const st = ui.st;
    const bodies = store.doc.bodies.filter((b) => !b.hidden && !b.hole && app.scene.views.get(b.id) && app.scene.views.get(b.id).data);
    let pick = st.src === "body" && !bodies.length ? "square" : st.src;
    let bodyId = bodies.some((b) => b.id === st.bodyId) ? st.bodyId : bodies[0] && bodies[0].id;
    const back = el("div", { class: "s3d-modal-back" });
    const card = el("div", { class: "s3d-modal", role: "dialog", "aria-label": "Put work on the lathe" });
    const render = () => {
      card.innerHTML = "";
      const opt = (k, label) => el("label", { class: "s3d-base-opt" + (pick === k ? " on" : "") }, el("input", { type: "radio", name: "lathe-src", value: k, checked: pick === k, onchange: () => { pick = k; render(); } }), el("span", {}, label));
      card.append(el("h3", {}, "What do you want to turn?"),
        el("p", { class: "hint", style: { padding: 0 } }, "The work spins between the two centers. A body keeps its shape until the chisel reaches it (hollow spots that face outward are filled in, like the wood you'd start from)."),
        el("div", { class: "s3d-bases" }, bodies.length ? opt("body", "A body in my design") : null, opt("square", "Square blank"), opt("round", "Round blank")));
      const num = (key, lab, obj = st.blank) => el("label", {}, lab, app.numField({ value: obj[key], id: "lathe-b-" + key, min: 4, max: 600, step: 5, len: true, onCommit: (v) => { obj[key] = v; } }));
      if (pick === "body") {
        card.append(el("div", { class: "row" }, el("span", {}, "Body"), el("select", { class: "num", id: "lathe-body", onchange: (e) => { bodyId = e.target.value; } }, ...bodies.map((b) => el("option", { value: b.id, selected: b.id === bodyId }, b.name)))));
        card.append(el("div", { class: "row" }, el("span", {}, "Spin around"), el("select", { class: "num", id: "lathe-axis", onchange: (e) => { st.axis = e.target.value; } },
          ...[["auto", "Its longest side"], ["x", "X (left to right)"], ["y", "Y (front to back)"], ["z", "Z (up and down)"]].map(([v, l]) => el("option", { value: v, selected: st.axis === v }, l)))));
        card.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "lathe-copy", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; setPref("copy", st.copy); } }), "Turn a copy (the original stays exactly as it is)"));
      } else card.append(el("div", { class: "row3" }, pick === "round" ? num("d", "Diameter") : num("side", "Side"), num("len", "Length")));
      card.append(el("div", { class: "row" }, el("span", {}, "Material"), el("select", { class: "num", id: "lathe-wood", onchange: (e) => { st.wood = e.target.value; } },
        ...Object.entries(WOODS).filter(([k]) => k !== "body" || pick === "body").map(([k, w]) => el("option", { value: k, selected: pick === "body" ? k === "body" : st.wood === k || (k === "maple" && st.wood === "body") }, w.label)))));
      card.append(el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => { back.remove(); if (first) close(false, true); } }, first ? "Cancel" : "Keep the current work"),
        el("button", { class: "btn primary", id: "lathe-start", onclick: () => {
          if (!first && ui.st.undo.length && !confirm("Start over with new work? Your cuts so far will be lost.")) return;
          const w = card.querySelector("#lathe-wood"); st.wood = w ? w.value : st.wood;
          st.src = pick; st.bodyId = pick === "body" ? bodyId : null;
          if (pick !== "body") { setPref("src", pick); setPref("blank", st.blank); }
          setPref("axis", st.axis); if (st.wood !== "body") setPref("wood", st.wood);
          back.remove();
          mount();
        } }, "Put it on the lathe")));
    };
    render();
    back.append(card);
    ui.root.append(back);
  }

  // the work as radii: r[i * A + j], slice i at u0 + i * du, angle j at 2πj / A
  function mount() {
    const st = ui.st;
    let work;
    try { work = st.src === "body" ? fromBody(st.bodyId, st.axis) : fromBlank(st); }
    catch (e) { app.toast(e.message || "That can't go on the lathe.", "err"); return; }
    if (!work) { app.toast("That body isn't ready yet.", "err"); return; }
    work.r0 = work.r.slice();
    let col = WOODS[st.wood] && WOODS[st.wood].c;
    if (!col) { const b = findBody(store.doc, st.bodyId); col = (b && b.color) || "#c8a06a"; }
    work.color = new THREE.Color(col);
    ui.work = work;
    st.undo = []; st.redo = [];
    buildLathe(); buildWorkMesh(); buildTool(); buildChips();
    const L = work.L, R = work.rmax;
    ui.view.target.set(0, -R * 0.9, H - R * 0.4);
    ui.view.az = -Math.PI / 2 - 0.42; ui.view.el = 0.9;
    const asp = Math.max(0.3, ui.w / Math.max(1, ui.h)), tanH = Math.tan((ui.cam.fov * Math.PI) / 360);
    ui.view.dist = Math.max(L * 1.9, R * 8, 240, ((L / 2 + 100) / (tanH * asp)) * 1.05);
    ui.tip = { u: work.u0 + L * 0.5, r: R + 15 };
    placeTool();
    renderBar();
  }
  function fromBlank(st) {
    const L = Math.max(10, st.blank.len), square = st.src === "square";
    const R = square ? st.blank.side / 2 : st.blank.d / 2;
    const N = sliceCount(L), du = L / (N - 1), r = new Float32Array(N * A);
    for (let j = 0; j < A; j++) {
      const t = (2 * Math.PI * j) / A;
      const rr = square ? R / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))) : R;
      for (let i = 0; i < N; i++) r[i * A + j] = rr;
    }
    const z = square ? R * Math.SQRT2 : R; // rests on the workplane
    const t = app.vp ? app.vp.view.target : new THREE.Vector3();
    return { N, du, u0: -L / 2, L, r, rmax: square ? R * Math.SQRT2 : R, frame: { c: new THREE.Vector3(Math.round(t.x / 10) * 10, Math.round(t.y / 10) * 10, z), a: new THREE.Vector3(1, 0, 0), e1: new THREE.Vector3(0, 1, 0), e2: new THREE.Vector3(0, 0, 1) }, bodyId: null };
  }
  const sliceCount = (L) => Math.max(60, Math.min(520, Math.ceil(L / 0.35) + 1));
  function fromBody(id, axisPick) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.mesh) return null;
    v.mesh.updateMatrixWorld(true);
    const M = v.mesh.matrixWorld, P = v.data.vertices, T = v.data.triangles;
    const W = new Float32Array(P.length), p = new THREE.Vector3(), box = new THREE.Box3();
    for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); W[i] = p.x; W[i + 1] = p.y; W[i + 2] = p.z; box.expandByPoint(p); }
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    let ax = axisPick;
    if (ax === "auto") ax = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    const a = new THREE.Vector3(ax === "x" ? 1 : 0, ax === "y" ? 1 : 0, ax === "z" ? 1 : 0);
    const e1 = ax === "z" ? new THREE.Vector3(1, 0, 0) : ax === "x" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const e2 = new THREE.Vector3().crossVectors(a, e1);
    // each corner in lathe terms
    const nv = W.length / 3, U = new Float32Array(nv), X = new Float32Array(nv), Y = new Float32Array(nv);
    let umin = Infinity, umax = -Infinity;
    for (let k = 0; k < nv; k++) {
      const dx = W[k * 3] - c.x, dy = W[k * 3 + 1] - c.y, dz = W[k * 3 + 2] - c.z;
      U[k] = dx * a.x + dy * a.y + dz * a.z; X[k] = dx * e1.x + dy * e1.y + dz * e1.z; Y[k] = dx * e2.x + dy * e2.y + dz * e2.z;
      umin = Math.min(umin, U[k]); umax = Math.max(umax, U[k]);
    }
    const L = umax - umin;
    if (!(L > 1)) throw new Error("That body is too small to turn.");
    const N = sliceCount(L), du = L / (N - 1), r = new Float32Array(N * A).fill(-1);
    let rbig = 0; for (let k = 0; k < nv; k++) rbig = Math.max(rbig, Math.hypot(X[k], Y[k]));
    const step = Math.max(0.05, Math.min(du, (rbig * 2 * Math.PI) / A / 2) * 0.8);
    const put = (u, x, y) => {
      const i = Math.round((u - umin) / du); if (i < 0 || i >= N) return;
      let t = Math.atan2(y, x); if (t < 0) t += 2 * Math.PI;
      const j = Math.round((t / (2 * Math.PI)) * A) % A, rr = Math.hypot(x, y), q = i * A + j;
      if (rr > r[q]) r[q] = rr;
    };
    for (let t = 0; t < T.length; t += 3) {
      const ia = T[t], ib = T[t + 1], ic = T[t + 2];
      // samples along the two edges from corner a, each as fine as the slices and angles
      const lb = Math.hypot(U[ib] - U[ia], X[ib] - X[ia], Y[ib] - Y[ia]), lc = Math.hypot(U[ic] - U[ia], X[ic] - X[ia], Y[ic] - Y[ia]);
      const nb = Math.min(1500, Math.max(1, Math.ceil(lb / step))), nc = Math.min(1500, Math.max(1, Math.ceil(lc / step)));
      for (let s = 0; s <= nb; s++) {
        const wb = s / nb, m = Math.floor((1 - wb) * nc + 1e-9);
        for (let q = 0; q <= m; q++) {
          const wc = q / nc, wa = 1 - wb - wc;
          put(U[ia] * wa + U[ib] * wb + U[ic] * wc, X[ia] * wa + X[ib] * wb + X[ic] * wc, Y[ia] * wa + Y[ib] * wb + Y[ic] * wc);
        }
      }
    }
    // angles no surface point landed on: in between their neighbors
    let rmax = 0;
    for (let i = 0; i < N; i++) {
      const row = i * A, have = [];
      for (let j = 0; j < A; j++) if (r[row + j] >= 0) have.push(j);
      if (!have.length) { for (let j = 0; j < A; j++) r[row + j] = 0; continue; }
      for (let j = 0; j < A; j++) {
        if (r[row + j] >= 0) continue;
        let pj = have[0], nj = have[0];
        for (const h of have) { if (h < j) pj = h; }
        if (have[have.length - 1] < j || have[0] > j) pj = have[have.length - 1];
        for (let h = have.length - 1; h >= 0; h--) if (have[h] > j) nj = have[h];
        if (have[have.length - 1] < j) nj = have[0];
        const span = (nj - pj + A) % A || A, f = ((j - pj + A) % A) / span;
        r[row + j] = r[row + pj] * (1 - f) + r[row + nj] * f;
      }
      for (let j = 0; j < A; j++) rmax = Math.max(rmax, r[row + j]);
    }
    // a slice or two with nothing on it between two that have something: in between them
    const empty = (i) => { for (let j = 0; j < A; j++) if (r[i * A + j] > 0) return false; return true; };
    for (let i = 1; i < N - 1; i++) {
      if (!empty(i) || empty(i - 1)) continue;
      let k = i; while (k < N && empty(k)) k++;
      if (k < N && (k - i) * du <= 2) for (let m = i; m < k; m++) { const f = (m - i + 1) / (k - i + 1); for (let j = 0; j < A; j++) r[m * A + j] = r[(i - 1) * A + j] * (1 - f) + r[k * A + j] * f; }
      i = k;
    }
    return { N, du, u0: -L / 2, L, r, rmax, frame: { c: c.clone().addScaledVector(a, (umin + umax) / 2), a, e1, e2 }, bodyId: id };
  }

  // ------------------------------------------------------------------ the scene
  function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); } }
  function buildLathe() {
    const g = ui.lathe, w = ui.work; clearGroup(g);
    const L = w.L, R = Math.max(w.rmax, 10);
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.45, metalness: 0.3 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x3d6f9e, roughness: 0.6, metalness: 0.1 });
    const box = (sx, sy, sz, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); g.add(b); return b; };
    const bedZ = H - R - 60, bedL = L + 340;
    ui.bedZ = bedZ + 12;
    box(bedL, 70, 24, 0, 0, bedZ, metal); // the bed
    box(90, 90, R + 60 + 40, -L / 2 - 85, 0, (bedZ + 12 + H + 40) / 2, paint); // headstock
    box(64, 64, R + 60 + 30, L / 2 + 80, 0, (bedZ + 12 + H + 30) / 2, paint); // tailstock
    const cone = (x, dir) => { const c = new THREE.Mesh(new THREE.ConeGeometry(9, 22, 24), metal); c.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2; c.position.set(x, 0, H); g.add(c); };
    cone(-L / 2 - 9, 1); cone(L / 2 + 9, -1);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 28, 24), metal); spindle.rotation.z = Math.PI / 2; spindle.position.set(-L / 2 - 33, 0, H); g.add(spindle);
    const quill = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 40, 24), metal); quill.rotation.z = Math.PI / 2; quill.position.set(L / 2 + 38, 0, H); g.add(quill);
    // the tool rest, in front of the work, just below center
    const restY = -(R + 8);
    ui.restY = restY;
    for (const c of [...ui.roll.children]) if (c !== ui.tool) { ui.roll.remove(c); c.geometry.dispose(); }
    const rest = new THREE.Mesh(new THREE.BoxGeometry(Math.max(80, L * 0.9), 8, 6), metal);
    rest.position.set(0, restY, H - 5); ui.roll.add(rest);
    // the floor under it all (where chips land)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(bedL * 2, bedL * 1.6), new THREE.MeshStandardMaterial({ color: 0xcfd5dc, roughness: 1 }));
    floor.position.set(0, 0, bedZ - 12 - 0.5); g.add(floor);
    ui.floorZ = bedZ - 12;
  }
  // the work's surface: a grid of rings (and a cap at each end)
  function buildWorkMesh() {
    clearGroup(ui.spin);
    for (const m of [ui.core, ui.blur]) if (m) { ui.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    ui.core = ui.blur = null;
    const w = ui.work, N = w.N;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((N * A + 2) * 3), col = new Float32Array((N * A + 2) * 3);
    const idx = [];
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < A; j++) {
      const a = i * A + j, a1 = i * A + ((j + 1) % A), b = a + A, b1 = a1 + A;
      idx.push(a, a1, b, a1, b1, b);
    }
    const c0 = N * A, c1 = N * A + 1;
    for (let j = 0; j < A; j++) { const j1 = (j + 1) % A; idx.push(c0, j1, j); idx.push(c1, (N - 1) * A + j, (N - 1) * A + j1); }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    ui.spin.add(mesh);
    ui.workMesh = mesh;
    // how it looks spinning fast: a solid core (the smallest radius of each slice) inside a see-through
    // blur (the largest), the way a spinning square block looks like a cylinder
    const ringGeo = () => {
      const g = new THREE.BufferGeometry(), B = 48, id = [];
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((N * B + 2) * 3), 3));
      for (let i = 0; i < N - 1; i++) for (let j = 0; j < B; j++) { const a = i * B + j, a1 = i * B + ((j + 1) % B); id.push(a, a1, a + B, a1, a1 + B, a + B); }
      for (let j = 0; j < B; j++) { id.push(N * B, (j + 1) % B, j); id.push(N * B + 1, (N - 1) * B + j, (N - 1) * B + ((j + 1) % B)); }
      g.setIndex(id); return g;
    };
    ui.core = new THREE.Mesh(ringGeo(), new THREE.MeshStandardMaterial({ color: w.color.clone().lerp(new THREE.Color(1, 1, 1), 0.12), roughness: 0.75 }));
    ui.blur = new THREE.Mesh(ringGeo(), new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.9, transparent: true, opacity: 0.4, depthWrite: false }));
    ui.core.visible = ui.blur.visible = false;
    ui.blur.renderOrder = 2;
    ui.scene.add(ui.core, ui.blur);
    ui.cos = new Float32Array(A); ui.sin = new Float32Array(A);
    for (let j = 0; j < A; j++) { ui.cos[j] = Math.cos((2 * Math.PI * j) / A); ui.sin[j] = Math.sin((2 * Math.PI * j) / A); }
    updateWork(0, N - 1);
  }
  const tmpC = new THREE.Color();
  function updateWork(i0, i1) {
    const w = ui.work, N = w.N, geo = ui.workMesh.geometry;
    const pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const base = w.color, fresh = base.clone().lerp(new THREE.Color(1, 1, 1), 0.22), old = base.clone().multiplyScalar(0.86);
    if (!w.rowMax || w.rowMax.length !== N) w.rowMax = new Float32Array(N);
    for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      const u = w.u0 + i * w.du;
      let mx = 0; for (let j = 0; j < A; j++) mx = Math.max(mx, w.r[i * A + j]);
      w.rowMax[i] = mx;
      for (let j = 0; j < A; j++) {
        const q = i * A + j, r = Math.max(0, w.r[q]), k = q * 3;
        pos[k] = u; pos[k + 1] = r * ui.cos[j]; pos[k + 2] = r * ui.sin[j];
        const cut = r < w.r0[q] - 0.05;
        // growth rings show on the cut wood, and they shift as you go deeper
        const g = 0.9 + 0.1 * Math.sin(r * 1.7 + 2.2 * Math.sin(u * 0.045 + j * 0.13));
        tmpC.copy(cut ? fresh : old).multiplyScalar(cut ? g : 0.97 + 0.03 * Math.sin(j * 0.9 + u * 0.2));
        col[k] = tmpC.r; col[k + 1] = tmpC.g; col[k + 2] = tmpC.b;
      }
    }
    const c0 = N * A * 3, c1 = c0 + 3;
    pos[c0] = w.u0; pos[c0 + 1] = 0; pos[c0 + 2] = 0;
    pos[c1] = w.u0 + (N - 1) * w.du; pos[c1 + 1] = 0; pos[c1 + 2] = 0;
    for (const k of [c0, c1]) { col[k] = old.r; col[k + 1] = old.g; col[k + 2] = old.b; }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (ui.core) {
      for (const [m, pick] of [[ui.core, 0], [ui.blur, 1]]) {
        const P = m.geometry.attributes.position.array, B = 48;
        for (let i = 0; i < N; i++) {
          let lo = Infinity, hi = 0; for (let j = 0; j < A; j++) { const r = w.r[i * A + j]; lo = Math.min(lo, r); hi = Math.max(hi, r); }
          const r = Math.max(0, pick ? hi : lo), u = w.u0 + i * w.du;
          for (let j = 0; j < B; j++) { const t = (2 * Math.PI * j) / B, k = (i * B + j) * 3; P[k] = u; P[k + 1] = r * Math.cos(t); P[k + 2] = r * Math.sin(t); }
        }
        const c = N * B * 3; P[c] = w.u0; P[c + 1] = P[c + 2] = 0; P[c + 3] = w.u0 + (N - 1) * w.du; P[c + 4] = P[c + 5] = 0;
        m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere();
      }
    }
  }

  // ------------------------------------------------------------------ the chisel
  // its cutting edge as points (u, v) about the tip, twisted by the angle
  function edgePoints() {
    const t = TOOLS[ui.st.tool], phi = (ui.st.twist * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const n = Math.max(12, Math.ceil(t.w / 0.15)), out = [];
    let vmin = Infinity;
    const raw = [];
    for (let s = 0; s <= n; s++) { const u = -t.w / 2 + (t.w * s) / n; raw.push([u, t.edge(u)]); }
    for (const [u, v] of raw) { const uu = u * cs - v * sn, vv = u * sn + v * cs; out.push([uu, vv]); vmin = Math.min(vmin, vv); }
    // the tip is the point nearest the work
    let tu = 0; for (const q of out) if (q[1] === vmin) { tu = q[0]; break; }
    for (const q of out) { q[0] -= tu; q[1] -= vmin; }
    return out;
  }
  function buildTool() {
    clearGroup(ui.tool);
    const t = TOOLS[ui.st.tool];
    const shape = new THREE.Shape();
    const n = 40, len = 70;
    for (let s = 0; s <= n; s++) { const u = -t.w / 2 + (t.w * s) / n, v = t.edge(u); s ? shape.lineTo(u, -v) : shape.moveTo(u, -v); }
    const back = Math.max(...Array.from({ length: n + 1 }, (_, s) => t.edge(-t.w / 2 + (t.w * s) / n)));
    shape.lineTo(t.w / 2, -back - len); shape.lineTo(-t.w / 2, -back - len); shape.closePath();
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xd5dae2, roughness: 0.3, metalness: 0.35 }));
    blade.position.z = -2;
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 14, 24), new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.4 }));
    ferrule.position.set(0, -back - len - 7, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(11, 8.5, 150, 24), new THREE.MeshStandardMaterial({ color: 0x8a5530, roughness: 0.6 }));
    handle.position.set(0, -back - len - 14 - 75, 0);
    // the tip turns about the point nearest the work
    const inner = new THREE.Group(); inner.add(blade, ferrule, handle);
    ui.tool.add(inner);
    ui.toolInner = inner;
    placeTool();
  }
  function placeTool() {
    if (!ui || !ui.tip || !ui.toolInner) return;
    const t = TOOLS[ui.st.tool], phi = (ui.st.twist * Math.PI) / 180;
    // the tip (lowest edge point, after the twist) sits at the work; the blade's own origin is the
    // middle of its edge
    let best = null;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    for (let s = 0; s <= 60; s++) { const u = -t.w / 2 + (t.w * s) / 60, v = t.edge(u), vv = u * sn + v * cs; if (!best || vv < best.vv) best = { u, v, vv }; }
    ui.toolInner.position.set(-best.u, best.v, 0);
    ui.tool.position.set(ui.tip.u, -ui.tip.r, H + 2);
    ui.roll.rotation.x = ui.beta || 0;
    ui.tool.rotation.set(0, 0, -phi);
    const tray = ui.toolInner; tray.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ chips
  function buildChips() {
    clearGroup(ui.chipsGroup);
    const MAX = 1600;
    const geo = new THREE.BoxGeometry(1.8, 0.7, 0.18);
    const mat = new THREE.MeshStandardMaterial({ color: ui.work.color.clone().lerp(new THREE.Color(1, 1, 1), 0.3), roughness: 0.8 });
    const im = new THREE.InstancedMesh(geo, mat, MAX);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    ui.chipsGroup.add(im);
    ui.chipMesh = im; ui.chips = []; ui.chipMax = MAX;
  }
  function spawnChips(n, x, rr) {
    const w = ui.work, k = TOOLS[ui.st.tool].chip, omega = (ui.rpmNow / 60) * 2 * Math.PI;
    for (let s = 0; s < n; s++) {
      if (ui.chips.length >= ui.chipMax) ui.chips.shift();
      const sp = Math.min(1600, omega * rr * 0.5 + 150);
      ui.chips.push({
        p: new THREE.Vector3(x + (Math.random() - 0.5) * 4, -(rr + 1) * Math.cos(ui.beta || 0), H - (rr + 1) * Math.sin(ui.beta || 0) + (Math.random() - 0.3) * 3),
        v: new THREE.Vector3((Math.random() - 0.5) * 260, -(120 + Math.random() * 380) * (0.6 + sp / 1600), Math.random() < 0.55 ? 150 + Math.random() * sp * 0.6 : -Math.random() * sp * 0.5),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
        w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30),
        s: k * (0.6 + Math.random() * 0.9), life: 0, rest: false,
      });
    }
    void w;
  }
  const mtmp = new THREE.Matrix4(), qtmp = new THREE.Quaternion(), stmp = new THREE.Vector3();
  function stepChips(dt) {
    const im = ui.chipMesh; if (!im) return false;
    const floor = ui.floorZ, bed = ui.bedZ, bedHalf = 35;
    let n = 0;
    ui.chips = ui.chips.filter((c) => c.life < 9);
    for (const c of ui.chips) {
      c.life += dt;
      if (!c.rest) {
        c.v.z -= 3500 * dt; c.v.multiplyScalar(Math.pow(0.35, dt));
        c.p.addScaledVector(c.v, dt);
        qtmp.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt)); c.q.multiply(qtmp);
        const ground = Math.abs(c.p.y) < bedHalf && Math.abs(c.p.x) < ui.work.L / 2 + 170 ? bed : floor;
        if (c.p.z < ground + 0.3) { c.p.z = ground + 0.3; if (Math.abs(c.v.z) < 120) { c.rest = true; } else { c.v.z *= -0.25; c.v.x *= 0.5; c.v.y *= 0.5; } }
      }
      const fade = c.life > 7 ? Math.max(0.01, 1 - (c.life - 7) / 2) : 1;
      stmp.set(c.s * fade, c.s * fade, c.s * fade);
      mtmp.compose(c.p, c.q, stmp);
      im.setMatrixAt(n++, mtmp);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    return n > 0;
  }

  // ------------------------------------------------------------------ aiming the chisel
  const stepFor = (dt) => TOOLS[ui.st.tool].rate * (ui.rpmNow / 1000) * dt;
  // how far from the axis the tip is when the edge just touches the wood at u
  function touchR(u) {
    const w = ui.work; let best = 0;
    for (const [uu, vv] of edgePoints()) {
      const i = Math.round((u + uu - w.u0) / w.du);
      if (i < 0 || i >= w.N) continue;
      best = Math.max(best, w.rowMax[i] - vv);
    }
    return best;
  }
  // the chisel follows the pointer but can't go into the wood faster than it cuts: pressing on the
  // wood pushes it in, a little more every moment it's held there
  function aim(dt) {
    if (!ui.ptr || !ui.work) return;
    const [x, y] = ui.ptr;
    ray.setFromCamera(new THREE.Vector2((x / ui.w) * 2 - 1, -(y / ui.h) * 2 + 1), ui.cam);
    // the point of the pointer's line of sight nearest the spin axis: how far it passes from the
    // axis is how deep the chisel goes, so the wood's outline on screen is where it starts to cut
    const o = ray.ray.origin, d = ray.ray.direction;
    const a = d.dot(d), b = d.x, dd = d.dot(o), ee = o.x, den = a - b * b;
    if (Math.abs(den) < 1e-9) return;
    const t = Math.max(0, (b * ee - dd) / den);
    const P = o.clone().addScaledVector(d, t);
    let u = P.x, r = Math.hypot(P.y, P.z - H);
    // which side faces you (the chisel lies in that plane)
    // (above the axis line, the far edge: the chisel shows on the near edge, the same distance in)
    ui.beta = Math.min(1.3, Math.atan2(Math.abs(P.z - H), Math.abs(P.y) || 1e-6));
    const lim = ui.work.L / 2 + 40; u = Math.max(-lim, Math.min(lim, u));
    const touch = touchR(u), cutting = ui.pressed && ui.rpmNow >= 30;
    const bite = cutting ? stepFor(dt) : 0;
    // it can't go into the wood faster than it cuts
    r = Math.max(r, touch - bite, 0);
    ui.tip = { u, r, onWood: r < touch + 0.5 };
    placeTool();
  }

  // ------------------------------------------------------------------ cutting
  function cut(dt) {
    const w = ui.work, st = ui.st;
    if (!w || !ui.pressed || !ui.tip || ui.rpmNow < 30) return 0;
    const t = TOOLS[st.tool];
    const pts = edgePoints();
    const N = w.N, du = w.du;
    // the lowest edge point over each slice the chisel covers
    const rc = new Map();
    for (const [u, v] of pts) {
      const x = ui.tip.u + u, i = Math.round((x - w.u0) / du);
      if (i < 0 || i >= N) continue;
      const r = ui.tip.r + v;
      if (!rc.has(i) || rc.get(i) > r) rc.set(i, r);
    }
    // in between edge points (a steep edge skips slices)
    const keys = [...rc.keys()].sort((a, b) => a - b);
    for (let k = 1; k < keys.length; k++) for (let i = keys[k - 1] + 1; i < keys[k]; i++) { const f = (i - keys[k - 1]) / (keys[k] - keys[k - 1]); rc.set(i, rc.get(keys[k - 1]) * (1 - f) + rc.get(keys[k]) * f); }
    const maxStep = stepFor(dt);
    let removed = 0, lo = Infinity, hi = -Infinity, best = 0, bestI = -1;
    for (const [i, r] of rc) {
      const row = i * A;
      let here = 0;
      for (let j = 0; j < A; j++) {
        const q = row + j, cur = w.r[q];
        if (cur <= r) continue;
        const nr = Math.max(r, cur - maxStep, 0);
        here += (cur - nr) * cur;
        w.r[q] = nr;
      }
      if (here > 0) { removed += here; lo = Math.min(lo, i); hi = Math.max(hi, i); if (here > best) { best = here; bestI = i; } }
    }
    if (removed > 0) {
      if (!ui.cutThisPress) { ui.cutThisPress = true; st.undo.push(ui.pressSnap); if (st.undo.length > 40) st.undo.shift(); st.redo = []; renderBar(); }
      updateWork(lo, hi);
      // chips: as many as the wood that came off (mm³)
      const vol = removed * ((2 * Math.PI) / A) * du;
      ui.chipAcc = (ui.chipAcc || 0) + vol * 0.9;
      const n = Math.min(25, Math.floor(ui.chipAcc));
      ui.chipAcc -= n;
      if (n > 0) { const x = w.u0 + bestI * du; let rr = 0; for (let j = 0; j < A; j++) rr = Math.max(rr, w.r[bestI * A + j]); spawnChips(n, x, rr); }
    }
    return removed;
  }

  // ------------------------------------------------------------------ the loop
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - ui.last) / 1000);
    ui.last = now;
    const st = ui.st;
    // the pedal: up to speed while it's down, coasting to a stop when it's up
    const want = ui.pedalDown || st.latch ? st.rpm : 0;
    const acc = want > ui.rpmNow ? 2400 : 900;
    ui.rpmNow = want > ui.rpmNow ? Math.min(want, ui.rpmNow + acc * dt) : Math.max(want, ui.rpmNow - acc * dt);
    ui.angle += (ui.rpmNow / 60) * 2 * Math.PI * dt;
    ui.spin.rotation.x = ui.angle % (2 * Math.PI);
    // fast enough to blur: show the blur instead of a flickering block
    if (ui.core) {
      const fast = ui.rpmNow > 240 && ui.spin.visible !== false && !ui.previewing;
      ui.workMesh.visible = !fast; ui.core.visible = ui.blur.visible = fast;
      ui.blur.material.opacity = Math.min(0.5, 0.18 + ui.rpmNow / 4000);
    }
    if (!ui.rpmShown || Math.abs(ui.rpmShown - ui.rpmNow) > 4 || (ui.rpmNow === 0 && ui.rpmShown !== 0)) { ui.rpmShown = Math.round(ui.rpmNow); ui.rpmEl.textContent = ui.rpmShown + " rpm"; ui.rpmEl.classList.toggle("on", ui.rpmShown > 0); }
    ui.pedal.classList.toggle("down", !!ui.pedalDown);
    if (ui.work) {
      aim(dt);
      cut(dt);
      const m = ui.pressed && ui.rpmNow < 30 ? (st.pedalMode === "on" ? "The lathe is off: tap Space or press Start, then push the chisel in." : "The lathe isn't spinning: hold Space or the Pedal button while you cut.") : "";
      if (ui.msg.textContent !== m) { ui.msg.textContent = m; ui.msg.hidden = !m; }
    }
    stepChips(dt);
    placeCamera();
    ui.renderer.render(ui.scene, ui.cam);
  }

  // ------------------------------------------------------------------ pointer handling
  const ray = new THREE.Raycaster();
  function local(e) { const r = ui.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  // where the pointer is on the tool rest's plane (level with the spin axis)
  function tipAt([x, y]) {
    ray.setFromCamera(new THREE.Vector2((x / ui.w) * 2 - 1, -(y / ui.h) * 2 + 1), ui.cam);
    const pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -H), q = new THREE.Vector3();
    if (!ray.ray.intersectPlane(pl, q)) return null;
    const w = ui.work, lim = w ? w.L / 2 + 40 : 200;
    return { u: Math.max(-lim, Math.min(lim, q.x)), r: Math.max(0, -q.y) };
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (!ui || !ui.work) return;
      e.preventDefault();
      c.focus({ preventScroll: true });
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const [x, y] = local(e);
      const info = { id: e.pointerId, x, y, type: e.pointerType, button: e.button };
      ui.pointers.set(e.pointerId, info);
      const touches = [...ui.pointers.values()].filter((p) => p.type === "touch");
      if (e.pointerType === "touch" && touches.length > 1) {
        // a second finger: look around instead (and stop cutting)
        endPress(); for (const p of touches) p.look = true; return;
      }
      if (e.button === 0 && !e.altKey) {
        info.cut = true;
        ui.ptr = [x, y];
        ui.pressed = true; ui.cutThisPress = false; ui.pressSnap = ui.work.r.slice();
      } else info.look = true;
    });
    c.addEventListener("pointermove", (e) => {
      if (!ui || !ui.work) return;
      const [x, y] = local(e);
      const info = ui.pointers.get(e.pointerId);
      if (!info) {
        // hovering with a mouse: the chisel follows (it only cuts while pressed)
        if (e.pointerType === "mouse" && !ui.pressed) ui.ptr = [x, y];
        return;
      }
      const dx = x - info.x, dy = y - info.y; info.x = x; info.y = y;
      if (info.cut) { ui.ptr = [x, y]; return; }
      const look = [...ui.pointers.values()].filter((p) => p.look);
      if (look.length >= 2) {
        const [a, b] = look, spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (ui.spread0) ui.view.dist = Math.max(60, Math.min(6000, ui.view.dist * (ui.spread0 / Math.max(1, spread))));
        ui.spread0 = spread;
        if (info === a) orbit(dx * 0.5, dy * 0.5);
        return;
      }
      if (info.button === 1) pan(dx, dy); else orbit(dx, dy);
    });
    const up = (e) => {
      if (!ui) return;
      const info = ui.pointers.get(e.pointerId);
      ui.pointers.delete(e.pointerId);
      if ([...ui.pointers.values()].filter((p) => p.look).length < 2) ui.spread0 = 0;
      if (info && info.cut) endPress();
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!ui) return;
      if (e.ctrlKey || e.metaKey) { ui.view.dist = Math.max(60, Math.min(6000, ui.view.dist * Math.exp(e.deltaY * 0.01))); return; }
      // scrolling (or a two-finger trackpad swipe) twists the chisel
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (ui.st.snap) {
        ui.wheelAcc = (ui.wheelAcc || 0) + d;
        if (Math.abs(ui.wheelAcc) >= 40) { setTwist(Math.round(ui.st.twist / 15) * 15 + Math.sign(ui.wheelAcc) * 15); ui.wheelAcc = 0; }
      } else setTwist(ui.st.twist + d * 0.12);
    }, { passive: false });
  }
  function endPress() {
    if (!ui) return;
    ui.pressed = false;
    ui.pressSnap = null;
  }
  function orbit(dx, dy) {
    const v = ui.view;
    v.az -= dx * 0.006;
    v.el = Math.max(-0.2, Math.min(1.55, v.el + dy * 0.006));
  }
  function pan(dx, dy) {
    const cam = ui.cam, d = cam.position.distanceTo(ui.view.target), k = (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / ui.h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    ui.view.target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
  }

  // ------------------------------------------------------------------ undo / redo (each press that cut is one step)
  function undo() {
    const st = ui.st, w = ui.work;
    if (!w || !st.undo.length) return;
    st.redo.push(w.r.slice()); w.r = st.undo.pop();
    updateWork(0, w.N - 1); renderBar();
  }
  function redo() {
    const st = ui.st, w = ui.work;
    if (!w || !st.redo.length) return;
    st.undo.push(w.r.slice()); w.r = st.redo.pop();
    updateWork(0, w.N - 1); renderBar();
  }

  // ------------------------------------------------------------------ keys
  function onKey(e, down) {
    if (!ui) return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape" && e.code !== "Space") return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.code === "Space" && e.target.type !== "range" && e.target.tagName !== "SELECT") return;
    if (e.code === "Space") {
      e.preventDefault(); e.stopPropagation();
      if (ui.st.pedalMode === "on") { if (down && !e.repeat) setRunning(!ui.st.latch); }
      else ui.pedalDown = down;
      return;
    }
    if (!down) { e.stopPropagation(); return; }
    const modal = ui.root.querySelector(".s3d-modal-back");
    if (modal) { e.stopPropagation(); if (e.key === "Escape" && modal.classList.contains("lathe-leave")) modal.remove(); return; }
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    let done = true;
    if (mod && k === "z" && !e.shiftKey) undo();
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) redo();
    else if (!mod && k === "q") setTwist(ui.st.snap ? Math.round(ui.st.twist / 15) * 15 - 15 : ui.st.twist - 5);
    else if (!mod && k === "e") setTwist(ui.st.snap ? Math.round(ui.st.twist / 15) * 15 + 15 : ui.st.twist + 5);
    else if (!mod && /^[1-7]$/.test(k)) { ui.st.tool = Object.keys(TOOLS)[+k - 1]; setPref("tool", ui.st.tool); buildTool(); renderBar(); }
    else if (e.key === "Enter" && ui.work) finish();
    else if (e.key === "Escape") close(false);
    else done = false;
    if (done) e.preventDefault();
    e.stopPropagation(); // the main app's shortcuts are off while the lathe is open
  }

  // ------------------------------------------------------------------ the finished shape
  // pieces (a parting cut can split the work), each a closed mesh in lathe terms (u, x, y)
  function pieces() {
    const w = ui.work, N = w.N, out = [];
    let s = -1;
    const live = (i) => { for (let j = 0; j < A; j++) if (w.r[i * A + j] > MINR) return true; return false; };
    for (let i = 0; i <= N; i++) {
      const on = i < N && live(i);
      if (on && s < 0) s = i;
      if (!on && s >= 0) { if (i - 1 - s >= 1) out.push([s, i - 1]); s = -1; }
    }
    return out.map(([a, b]) => { let v = 0; for (let i = a; i <= b; i++) for (let j = 0; j < A; j++) v += w.r[i * A + j] ** 2; return { a, b, vol: v * Math.PI / A * w.du }; });
  }
  // the cavity when hollowing: from the open end inward, keeping the wall and the bottom
  function cavity(p, ho) {
    const w = ui.work;
    const minR = (i) => { let m = Infinity; for (let j = 0; j < A; j++) m = Math.min(m, w.r[i * A + j]); return m; };
    const open = ho.end === "tail" ? p.b : p.a, dir = ho.end === "tail" ? -1 : 1, far = ho.end === "tail" ? p.a : p.b;
    const inner = new Map();
    for (let i = open; dir > 0 ? i <= far : i >= far; i += dir) {
      if (Math.abs(far - i) * w.du < ho.base) break;
      const rin = minR(i) - ho.wall;
      if (rin < 0.8) break;
      inner.set(i, rin);
    }
    if (inner.size < 2) return null;
    if (ho.style === "straight") { const m = Math.min(...inner.values()); for (const k of inner.keys()) inner.set(k, m); }
    else {
      // a little smoothing so the inside is clean
      const ks = [...inner.keys()], vs = ks.map((k) => inner.get(k));
      for (let it = 0; it < 3; it++) for (let k = 1; k < vs.length - 1; k++) vs[k] = Math.min(vs[k], (vs[k - 1] + vs[k] * 2 + vs[k + 1]) / 4);
      ks.forEach((k, n) => inner.set(k, vs[n]));
    }
    const ks = [...inner.keys()];
    return { open, bottom: ks[ks.length - 1], inner };
  }
  function buildPiece(p, ho) {
    const w = ui.work;
    const cav = ho && ho.on ? cavity(p, ho) : null;
    // fewer rings where the shape is straight
    const keep = new Uint8Array(w.N); keep[p.a] = keep[p.b] = 1;
    if (cav) { keep[cav.open] = keep[cav.bottom] = 1; }
    const tol = 0.04;
    const stack = [[p.a, p.b]];
    const row = (i, j) => Math.max(0.3, w.r[i * A + j]);
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      let bd = 0, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const f = (i - a) / (b - a);
        let d = 0;
        for (let j = 0; j < A; j += 2) d = Math.max(d, Math.abs(row(i, j) - (row(a, j) * (1 - f) + row(b, j) * f)));
        if (cav && cav.inner.has(i) && cav.inner.has(a) && cav.inner.has(b)) d = Math.max(d, Math.abs(cav.inner.get(i) - (cav.inner.get(a) * (1 - f) + cav.inner.get(b) * f)));
        if (d > bd) { bd = d; bi = i; }
      }
      if (bi > 0 && bd > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const rings = []; for (let i = p.a; i <= p.b; i++) if (keep[i]) rings.push(i);
    // round enough: fewer angles
    let round = true;
    for (const i of rings) { let lo = Infinity, hi = -Infinity; for (let j = 0; j < A; j++) { lo = Math.min(lo, w.r[i * A + j]); hi = Math.max(hi, w.r[i * A + j]); } if (hi - lo > 0.08) { round = false; break; } }
    const innerRings = cav ? rings.filter((i) => cav.inner.has(i)) : [];
    let Aout = round ? 64 : A;
    while (Aout > 24 && 2 * Aout * (rings.length + innerRings.length + 2) > OUT_TRIS) Aout = Aout === 96 ? 64 : Aout === 64 ? 48 : Aout === 48 ? 32 : 24;
    const rAt = (i, jo) => {
      // the radius at an output angle (the most material within that angle's share)
      const t = (jo / Aout) * A, j0 = Math.floor(t), f = t - j0;
      return Math.max(0.3, w.r[i * A + (j0 % A)] * (1 - f) + w.r[i * A + ((j0 + 1) % A)] * f);
    };
    const V = [], I = [];
    const ring = (i, rf) => { const base = V.length / 3, u = w.u0 + i * w.du; for (let j = 0; j < Aout; j++) { const t = (2 * Math.PI * j) / Aout, r = rf(j); V.push(u, r * Math.cos(t), r * Math.sin(t)); } return base; };
    const center = (i) => { V.push(w.u0 + i * w.du, 0, 0); return V.length / 3 - 1; };
    const outer = rings.map((i) => ring(i, (j) => rAt(i, j)));
    for (let k = 0; k < rings.length - 1; k++) {
      const A0 = outer[k], B0 = outer[k + 1];
      for (let j = 0; j < Aout; j++) { const j1 = (j + 1) % Aout; I.push(A0 + j, A0 + j1, B0 + j, A0 + j1, B0 + j1, B0 + j); }
    }
    const capLow = (R0) => { const c = center(rings[0]); for (let j = 0; j < Aout; j++) I.push(c, R0 + ((j + 1) % Aout), R0 + j); };
    const capHigh = (R0, i) => { const c = center(i); for (let j = 0; j < Aout; j++) I.push(c, R0 + j, R0 + ((j + 1) % Aout)); };
    if (!cav) { capLow(outer[0]); capHigh(outer[outer.length - 1], rings[rings.length - 1]); }
    else {
      const tail = ho.end === "tail";
      const ir = (tail ? innerRings.slice().reverse() : innerRings); // from the open end inward
      const inner = ir.map((i) => ring(i, () => cav.inner.get(i)));
      // the rim at the open end
      const O = tail ? outer[outer.length - 1] : outer[0], In = inner[0];
      for (let j = 0; j < Aout; j++) {
        const j1 = (j + 1) % Aout;
        if (!tail) I.push(O + j, In + j, O + j1, O + j1, In + j, In + j1);
        else I.push(O + j, O + j1, In + j, O + j1, In + j1, In + j);
      }
      // the inside wall (facing the axis)
      for (let k = 0; k < inner.length - 1; k++) {
        // rings in order of u
        const lo = tail ? inner[k + 1] : inner[k], hi = tail ? inner[k] : inner[k + 1];
        for (let j = 0; j < Aout; j++) { const j1 = (j + 1) % Aout; I.push(lo + j, hi + j, lo + j1, lo + j1, hi + j, hi + j1); }
      }
      // the bottom of the cavity, and the solid end
      const Bt = inner[inner.length - 1], bi = ir[ir.length - 1];
      if (!tail) { capHigh(Bt, bi); capHigh(outer[outer.length - 1], rings[rings.length - 1]); }
      else { const c = center(bi); for (let j = 0; j < Aout; j++) I.push(c, Bt + ((j + 1) % Aout), Bt + j); capLow(outer[0]); }
    }
    return { V: new Float32Array(V), I: new Uint32Array(I), hollow: !!cav };
  }
  // into the design's space
  function toWorld(m) {
    const f = ui.work.frame, V = new Float32Array(m.V.length);
    for (let k = 0; k < V.length; k += 3) {
      const u = m.V[k], x = m.V[k + 1], y = m.V[k + 2];
      V[k] = f.c.x + u * f.a.x + x * f.e1.x + y * f.e2.x;
      V[k + 1] = f.c.y + u * f.a.y + x * f.e1.y + y * f.e2.y;
      V[k + 2] = f.c.z + u * f.a.z + x * f.e1.z + y * f.e2.z;
    }
    if (m.I.length / 3 > OUT_TRIS) return simplify({ V, I: m.I }, OUT_TRIS).mesh;
    return { V, I: m.I };
  }
  function signedVolume({ V, I }) {
    let s = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      s += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
    }
    return s / 6;
  }

  function finish() {
    const st = ui.st, w = ui.work;
    if (!w) return;
    endPress(); ui.pedalDown = false;
    const ps = pieces();
    if (!ps.length) { app.toast("Nothing is left on the lathe.", "err"); return; }
    const big = ps.reduce((a, b) => (b.vol > a.vol ? b : a));
    const back = el("div", { class: "s3d-modal-back lathe-done-back" });
    const ho = st.hollow;
    const card = el("div", { class: "s3d-modal" });
    let prevMesh = null;
    const preview = () => {
      if (prevMesh) { ui.scene.remove(prevMesh); prevMesh.geometry.dispose(); prevMesh.material.dispose(); prevMesh = null; }
      ui.spin.visible = !ho.on; ui.previewing = ho.on;
      const info = card.querySelector("#lathe-hollow-info");
      if (!ho.on) { if (info) info.textContent = ""; return; }
      const m = buildPiece(big, ho);
      if (info) info.textContent = m.hollow ? "The front half is cut away here so you can see inside." : "There isn't room to hollow this: try a thinner wall or bottom.";
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.V, 3)); g.setIndex(new THREE.BufferAttribute(m.I, 1)); g.computeVertexNormals();
      prevMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: w.color.clone().lerp(new THREE.Color(1, 1, 1), 0.15), roughness: 0.75, side: THREE.DoubleSide, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)] }));
      ui.scene.add(prevMesh);
    };
    const num = (key, lab, min) => el("label", {}, lab, app.numField({ value: ho[key], id: "lathe-h-" + key, min, max: 200, step: 0.5, len: true, onCommit: (v) => { ho[key] = v; setPref("hollow", ho); preview(); } }));
    const render = () => {
      card.innerHTML = "";
      card.append(el("h3", {}, "Add the turned part to your design"),
        el("p", { class: "hint", style: { padding: 0 } }, "It becomes a mesh body: move, scale, combine and slice it in Beginner and Advanced, or sculpt it in Chisel."),
        el("label", { class: "check" }, el("input", { type: "checkbox", id: "lathe-hollow", checked: ho.on, onchange: (e) => { ho.on = e.target.checked; setPref("hollow", ho); render(); preview(); } }), "Hollow it out (a cup, vase or box)"));
      if (ho.on) {
        const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id }, ...items.map(([v, l]) => el("button", { "aria-pressed": String(cur === v), onclick: () => on(v) }, l)));
        card.append(
          el("div", { class: "row" }, el("span", {}, "Open end"), seg("lathe-h-end", [["tail", "Tailstock (right)"], ["head", "Headstock (left)"]], ho.end, (v) => { ho.end = v; setPref("hollow", ho); render(); preview(); })),
          el("div", { class: "row" }, el("span", {}, "Inside"), seg("lathe-h-style", [["follow", "Follows the outside"], ["straight", "Straight bore"]], ho.style, (v) => { ho.style = v; setPref("hollow", ho); render(); preview(); })),
          el("div", { class: "row3" }, num("wall", "Wall", 0.8), num("base", "Bottom", 0.8)),
          el("p", { class: "hint", id: "lathe-hollow-info", style: { padding: 0 } }, ""));
      }
      if (ps.length > 1) card.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "lathe-biggest", checked: st.keepBiggest, onchange: (e) => { st.keepBiggest = e.target.checked; } }), `Your parting cuts made ${ps.length} pieces: keep only the biggest`));
      if (st.src === "body") card.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "lathe-copy2", checked: st.copy, onchange: (e) => { st.copy = e.target.checked; setPref("copy", st.copy); } }), "Add it as a copy (keep the original as it is)"),
        st.copy ? null : el("p", { class: "hint", style: { padding: 0 } }, "The turned part takes the original's place; the original is hidden, not deleted (Undo or the eye button brings it back)."));
      card.append(el("div", { class: "row lathe-exp" }, el("span", {}, "Export"),
        ...["stl", "3mf", "obj"].map((f) => el("button", { class: "btn", id: "lathe-exp-" + f, title: `Save the turned part as a .${f} file (for a slicer or another app)`, onclick: () => exportPart(f, ps, big) }, f.toUpperCase()))));
      card.append(el("div", { class: "s3d-modal-btns" },
        el("button", { class: "btn", onclick: () => { cleanup(); } }, "Keep turning"),
        el("button", { class: "btn primary", id: "lathe-add", onclick: () => { cleanup(); commit(ps, big); } }, "Add to design")));
    };
    const cleanup = () => { back.remove(); if (prevMesh) { ui.scene.remove(prevMesh); prevMesh.geometry.dispose(); prevMesh.material.dispose(); } ui.spin.visible = true; ui.previewing = false; };
    render();
    back.append(card); ui.root.append(back);
    preview();
  }
  function finalMeshes(ps, big) {
    const st = ui.st;
    const list = st.keepBiggest || ps.length === 1 ? [big] : ps;
    const meshes = [];
    for (const p of list) {
      const piece = buildPiece(p, p === big ? st.hollow : null);
      let m = toWorld(piece);
      if (signedVolume(m) < 0) { const I = Uint32Array.from(m.I); for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } m = { V: m.V, I }; }
      m.hollow = piece.hollow;
      meshes.push(m);
    }
    return meshes;
  }
  // ------------------------------------------------------------------ files: STL, 3MF, OBJ (mm)
  function stlFile(meshes) {
    const n = meshes.reduce((a, m) => a + m.I.length / 3, 0), dv = new DataView(new ArrayBuffer(84 + n * 50));
    const head = "JumpStart 3D lathe (mm)"; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    let o = 84;
    for (const { V, I } of meshes) for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      for (const f of [nx / l, ny / l, nz / l, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(o, f, true); o += 4; }
      o += 2;
    }
    return new Uint8Array(dv.buffer);
  }
  const num = (x) => { const r = Math.round(x * 1e5) / 1e5; return Object.is(r, -0) ? "0" : String(r); };
  function objFile(meshes) {
    const out = ["# JumpStart 3D lathe, millimeters"];
    let base = 1;
    meshes.forEach((m, k) => {
      out.push("o Turned_part_" + (k + 1));
      for (let i = 0; i < m.V.length; i += 3) out.push("v " + num(m.V[i]) + " " + num(m.V[i + 1]) + " " + num(m.V[i + 2]));
      for (let t = 0; t < m.I.length; t += 3) out.push("f " + (m.I[t] + base) + " " + (m.I[t + 1] + base) + " " + (m.I[t + 2] + base));
      base += m.V.length / 3;
    });
    return new TextEncoder().encode(out.join("\n") + "\n");
  }
  async function threeMFFile(meshes, color) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">JumpStart 3D</metadata>', ' <resources>\n  <basematerials id="1">'];
    meshes.forEach(() => out.push('   <base name="Turned part" displaycolor="' + color.toUpperCase() + 'FF"/>'));
    out.push("  </basematerials>");
    meshes.forEach((m, k) => {
      out.push('  <object id="' + (k + 2) + '" type="model" name="Turned part ' + (k + 1) + '" pid="1" pindex="' + k + '">\n   <mesh>\n    <vertices>');
      for (let i = 0; i < m.V.length; i += 3) out.push('     <vertex x="' + num(m.V[i]) + '" y="' + num(m.V[i + 1]) + '" z="' + num(m.V[i + 2]) + '"/>');
      out.push("    </vertices>\n    <triangles>");
      for (let t = 0; t < m.I.length; t += 3) out.push('     <triangle v1="' + m.I[t] + '" v2="' + m.I[t + 1] + '" v3="' + m.I[t + 2] + '"/>');
      out.push("    </triangles>\n   </mesh>\n  </object>");
    });
    out.push(" </resources>\n <build>");
    meshes.forEach((m, k) => out.push('  <item objectid="' + (k + 2) + '"/>'));
    out.push(" </build>\n</model>\n");
    const enc = new TextEncoder();
    const z = makeZip([
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: "3D/3dmodel.model", data: enc.encode(out.join("\n")) },
    ]);
    return new Uint8Array(await z.arrayBuffer());
  }
  async function exportPart(fmt, ps, big) {
    const meshes = finalMeshes(ps, big);
    const bytes = fmt === "stl" ? stlFile(meshes) : fmt === "obj" ? objFile(meshes) : await threeMFFile(meshes, "#" + ui.work.color.getHexString());
    const nm = (ui.st.src === "body" ? (findBody(store.doc, ui.st.bodyId) || {}).name || "Turned part" : "Turned part").replace(/[\\/:*?"<>|]+/g, "").trim() || "Turned part";
    ui.lastExport = { fmt, size: bytes.length };
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(nm + (ui.st.src === "body" ? " (turned)" : "") + "." + fmt, bytes);
    app.onExport && app.onExport(fmt);
  }
  // the toolbar's Export: the part as it is now (with the hollow settings last used)
  function quickExport(fmt) {
    if (!ui.work) return;
    endPress();
    const ps = pieces();
    if (!ps.length) { app.toast("Nothing is left on the lathe.", "err"); return; }
    const big = ps.reduce((a, b) => (b.vol > a.vol ? b : a));
    exportPart(fmt, ps, big);
  }
  function commit(ps, big) {
    const st = ui.st, w = ui.work;
    const meshes = finalMeshes(ps, big);
    const color = "#" + w.color.getHexString(), ids = [];
    store.update((doc) => {
      doc.assets = doc.assets || {};
      for (const m of meshes) {
        const bytes = packMesh(m), id = contentId(bytes);
        if (!doc.assets[id]) doc.assets[id] = { kind: "mesh", name: "Turned part", data: toB64(bytes) };
        const b = { id: uid("b"), name: nextName(doc, "Turned part"), seq: nextSeq(doc), color, hole: false, hidden: false, m: IDENTITY.slice(), node: { t: "mesh", asset: id, keepPos: true, mods: [] }, turned: { hollow: !!m.hollow } };
        doc.bodies.push(b); ids.push(b.id);
      }
      if (st.src === "body" && !st.copy) { const o = findBody(doc, st.bodyId); if (o) o.hidden = true; }
    }, "Lathe");
    const from = st.from;
    close(true);
    if (from !== "chisel") app.select && app.select(ids);
    app.toast(ids.length > 1 ? `Added ${ids.length} turned parts.` : "Added the turned part. It takes a moment to build.");
    if (from === "chisel" && app.chisel) {
      // Chisel shows it once the design has built it
      const t0 = Date.now();
      const iv = setInterval(() => {
        const ready = ids.every((id) => (app.scene.views.get(id) || {}).data || app.scene.errors.has(id));
        if (ready || Date.now() - t0 > 60000) { clearInterval(iv); app.chisel.load({ keepUndo: true }); }
      }, 300);
    }
  }
  // Cancel after some turning: keep the part, go back to turning, or throw it away
  function askLeave() {
    if (ui.root.querySelector(".lathe-leave")) return;
    endPress();
    const back = el("div", { class: "s3d-modal-back lathe-leave" });
    const done = () => back.remove();
    const card = el("div", { class: "s3d-modal", role: "alertdialog", "aria-label": "Leave the Lathe" },
      el("h3", {}, "Leave the Lathe?"),
      el("p", { class: "hint", style: { padding: 0 } }, "You've turned this piece. What would you like to do with it?"),
      el("div", { class: "lathe-leave-btns" },
        el("button", { class: "btn primary", id: "lathe-leave-keep", onclick: () => {
          done();
          const ps = pieces();
          if (!ps.length) { close(true); return; }
          ui.st.hollow = { ...ui.st.hollow, on: false }; // as turned (hollowing is in Done)
          commit(ps, ps.reduce((a, b) => (b.vol > a.vol ? b : a)));
        } }, "Keep it (add it to my design)"),
        el("button", { class: "btn", id: "lathe-leave-turn", onclick: () => { done(); ui.canvas.focus({ preventScroll: true }); } }, "Keep turning"),
        el("button", { class: "btn danger", id: "lathe-leave-discard", onclick: () => { done(); close(false, true); } }, "Discard it and leave")));
    back.append(card); ui.root.append(back);
    setTimeout(() => card.querySelector("#lathe-leave-turn").focus(), 30);
  }
  function close(saved, quiet) {
    if (!ui) return;
    if (!saved && !quiet && ui.st.undo.length) { askLeave(); return; }
    cancelAnimationFrame(ui.raf);
    removeEventListener("keydown", ui.onKey, true); removeEventListener("keyup", ui.onKeyUp, true); removeEventListener("blur", ui.onBlur);
    ui.ro.disconnect();
    for (const g of [ui.spin, ui.lathe, ui.tool, ui.chipsGroup]) clearGroup(g);
    ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    const from = ui.st.from;
    ui = null;
    if (from && app.mode !== from) app.setMode(from);
  }

  return { open, close: () => close(false, true), get active() { return !!ui; }, _ui: () => ui, _pieces: () => pieces(), _build: (ho) => { const ps = pieces(); const big = ps.reduce((a, b) => (b.vol > a.vol ? b : a)); return toWorld(buildPiece(big, ho)); }, _vol: signedVolume, _last: () => ui && ui.lastExport };
}
