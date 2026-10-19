// Beginner mode: Tinkercad-style shapes, drag on the workplane, handles, groups.
import * as THREE from "three";
import { store, findBody, IDENTITY, primName, nextSeq } from "./store.js";
import { el, fmt, round, PALETTE, clone, parseLength, uid } from "./util.js";
import { showLen, parseLen } from "./units.js";
import { ICON, shapeTile } from "./icons.js";
import { LIB, textureThumb } from "./texture.js";
import { FONT_NAMES } from "./fonts.js";
import {
  M4, arr, makePrimBody, frameOnFace, deleteBodies, duplicateBodies, groupBodies, ungroupBody, transformBodies, setBodyProps, PRIM_DEFAULTS, nextName,
} from "./ops.js";

const SHAPES = [
  ["box", "#e4572e"], ["cylinder", "#f3a712"], ["sphere", "#2b7bb9"], ["cone", "#29a35a"], ["pyramid", "#d9a400"],
  ["wedge", "#1aa6a6"], ["torus", "#d14d8b"], ["tube", "#7b4fa8"], ["hemisphere", "#e47a2e"], ["prism", "#5a6b7c"], ["text", "#c0392b"],
  ["star", "#f2b705"], ["heart", "#e0475b"], ["roof", "#a0522d"], ["roundroof", "#3d8fd1"], ["paraboloid", "#8e5bd0"], ["gem", "#17a2b8"], ["spring", "#7d8a96"], ["capsule", "#2bb673"], ["arrow", "#ef7d22"],
];

export function initBeginner(app) {
  const vp = app.vp;
  const $ = (id) => document.getElementById(id);
  const ribbon = $("ribbon");
  const shapesEl = $("shapes");
  // the tab on the panel's edge pushes the shapes panel away (like Tinkercad) and brings it back
  {
    const tab = $("shapes-tab"), KEY = "jumpstart.shapesTucked";
    tab.classList.add("bottom");
    const sync = () => { const open = !shapesEl.classList.contains("tucked"); tab.classList.toggle("closed", !open); tab.title = open ? "Hide the objects panel" : "Show the objects panel"; tab.setAttribute("aria-label", tab.title); tab.setAttribute("aria-expanded", String(open)); };
    try { if (localStorage.getItem(KEY) === "1") shapesEl.classList.add("tucked"); } catch (e) {}
    tab.addEventListener("click", () => { const tuck = !shapesEl.classList.contains("tucked"); shapesEl.classList.toggle("tucked", tuck); try { localStorage.setItem(KEY, tuck ? "1" : "0"); } catch (e) {} sync(); });
    sync();
  }
  const vpEl = $("viewport");
  const inspector = el("div", { class: "float inspector", hidden: true, id: "inspector" });
  vpEl.append(inspector);
  const rubber = el("div", { class: "rubber", hidden: true });
  vpEl.append(rubber);

  // ---------------------------------------------------------------- objects dock
  // Along the bottom, like a carousel: pick Objects or Holes, then slide through the tiles
  // (arrows page through and wrap around, the mouse wheel and a sideways drag or swipe scroll,
  // the tiles near the middle are a little bigger). Drag a tile up onto the workplane to add it;
  // click it to drop one in the middle.
  const HOLE_KINDS = ["box", "cylinder", "sphere", "cone", "pyramid", "prism", "wedge", "tube", "hemisphere", "roof", "roundroof", "star", "heart", "capsule", "arrow"];
  let dockKind = "objects";
  shapesEl.classList.remove("side", "right"); shapesEl.classList.add("dock");
  const help = el("div", { class: "dock-help float", id: "dock-help", hidden: true });
  vpEl.append(help);
  function renderShapes() {
    shapesEl.innerHTML = "";
    const segBtn = (k, label) => el("button", { "aria-pressed": String(dockKind === k), id: "dock-" + k, onclick: () => { if (dockKind !== k) { dockKind = k; renderShapes(); } } }, label);
    const side = el("div", { class: "dock-side" },
      el("div", { class: "dock-seg", role: "group", "aria-label": "Objects or holes" }, segBtn("objects", "Objects"), segBtn("holes", "Holes")),
      el("button", { class: "dock-q", id: "dock-help-btn", title: "How it works", "aria-label": "How it works", onclick: () => { help.hidden = !help.hidden; } }, "?"));
    const track = el("div", { class: "dock-track", id: "dock-track", role: "list" });
    if (dockKind === "objects") for (const [kind, color] of SHAPES) track.append(makeTile(kind, color, false, track));
    else for (const kind of HOLE_KINDS) track.append(makeTile(kind, null, true, track));
    const arrow = (dir) => el("button", { class: "dock-arrow " + (dir < 0 ? "prev" : "next"), id: dir < 0 ? "dock-prev" : "dock-next", title: dir < 0 ? "Previous" : "Next", "aria-label": dir < 0 ? "Previous" : "Next",
      html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${dir < 0 ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"}"/></svg>`,
      onclick: () => page(track, dir) });
    shapesEl.append(side, arrow(-1), track, arrow(1));
    // the mouse wheel slides the strip
    track.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); track.scrollBy({ left: e.deltaY * 1.2 }); } }, { passive: false });
    track.addEventListener("scroll", () => carousel(track), { passive: true });
    requestAnimationFrame(() => carousel(track));
    help.innerHTML = "";
    help.append(el("div", { class: "hint", html:
      `Drag a shape onto the workplane or onto another shape (or click it to drop one in the middle). Slide the strip with the arrows, the mouse wheel, or a sideways drag. Or press <b>Sketch</b>, draw a closed shape, and press <b>E</b> to extrude it. Set shapes to <b>Hole</b>, select them together and press <b>Group</b> to cut. <br><br>
      <span class="kbd">Arrows</span> nudge · <span class="kbd">Ctrl</span>+<span class="kbd">↑</span> lift · <span class="kbd">D</span> drop to workplane ·
      <span class="kbd">H</span> hole · <span class="kbd">S</span> solid · <span class="kbd">Ctrl+G</span> group · <span class="kbd">Ctrl+D</span> duplicate · <span class="kbd">A</span> align · <span class="kbd">M</span> mirror · <span class="kbd">L</span> <span class="kbd">R</span> <span class="kbd">C</span> sketch · <span class="kbd">Ctrl+L</span> lock · <span class="kbd">T</span> texture · <span class="kbd">?</span> all shortcuts` }),
      el("button", { class: "btn", style: { marginTop: "8px" }, onclick: () => { help.hidden = true; } }, "Got it"));
  }
  // tutorials: show the Objects or Holes strip and bring one tile into view
  function showTile(kind, hole) {
    const want = hole ? "holes" : "objects";
    if (dockKind !== want) { dockKind = want; renderShapes(); }
    shapesEl.classList.remove("collapsed");
    const t = shapesEl.querySelector(`.tile[data-kind="${kind}"]`);
    if (t) t.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    return t;
  }
  // a page left or right; past either end it wraps around to the other
  function page(track, dir) {
    const max = track.scrollWidth - track.clientWidth;
    if (max <= 1) return;
    const step = Math.max(90, track.clientWidth * 0.75);
    let to = track.scrollLeft + dir * step;
    if (dir > 0 && track.scrollLeft >= max - 8) to = 0;
    else if (dir < 0 && track.scrollLeft <= 8) to = max;
    track.scrollTo({ left: to, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  // the carousel look: tiles near the middle a little bigger, those at the edges a little smaller
  let carT = 0;
  function carousel(track) {
    if (carT) return;
    carT = requestAnimationFrame(() => {
      carT = 0;
      const r = track.getBoundingClientRect(), mid = r.left + r.width / 2, half = Math.max(1, r.width / 2);
      for (const tile of track.children) {
        const b = tile.getBoundingClientRect(), d = Math.min(1, Math.abs(b.left + b.width / 2 - mid) / half);
        tile.style.setProperty("--k", (1.06 - 0.16 * d * d).toFixed(3));
      }
      const max = track.scrollWidth - track.clientWidth;
      shapesEl.classList.toggle("at-start", track.scrollLeft <= 8);
      shapesEl.classList.toggle("at-end", track.scrollLeft >= max - 8);
    });
  }
  function makeTile(kind, color, hole, track) {
    const t = el("div", { class: "tile" + (hole ? " hole" : ""), "data-kind": kind, role: "listitem button", tabindex: "0", title: `Drag to add a ${primName(kind).toLowerCase()}${hole ? " hole" : ""}`, html: shapeTile(kind, color || "#ccc", hole) });
    t.append(el("span", {}, primName(kind)));
    t.addEventListener("pointerdown", (e) => tileDown(e, t, track, kind, color, hole));
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeAt(kind, color, hole, null); } });
    t.addEventListener("focus", () => t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }));
    return t;
  }
  // a press on a tile: sideways slides the strip (with a fling), up drags the shape out, a click adds it
  function tileDown(e, t, track, kind, color, hole) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { t.setPointerCapture(e.pointerId); } catch (err) {}
    const x0 = e.clientX, y0 = e.clientY, s0 = track.scrollLeft;
    let mode = null, lastX = x0, lastT = performance.now(), vel = 0;
    const off = () => { t.removeEventListener("pointermove", mv); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); };
    const mv = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!mode) {
        if (Math.hypot(dx, dy) < 6) return;
        mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "slide" : "drag";
        if (mode === "drag") {
          off();
          startPaletteDrag({ preventDefault() {}, currentTarget: t, pointerId: e.pointerId, clientX: x0, clientY: y0 }, kind, color, hole);
          return;
        }
        track.classList.add("sliding");
      }
      track.scrollLeft = s0 - dx;
      const now = performance.now();
      vel = 0.7 * vel + 0.3 * ((ev.clientX - lastX) / Math.max(1, now - lastT));
      lastX = ev.clientX; lastT = now;
    };
    const up = () => {
      off();
      if (!mode) { placeAt(kind, color, hole, null); return; }
      if (mode === "slide") { track.classList.remove("sliding"); if (Math.abs(vel) > 0.15) track.scrollBy({ left: -vel * 320, behavior: "smooth" }); }
    };
    t.addEventListener("pointermove", mv);
    t.addEventListener("pointerup", up);
    t.addEventListener("pointercancel", up);
  }

  // ---------------------------------------------------------------- toolbar
  function renderRibbon() {
    ribbon.innerHTML = "";
    const bar = el("div", { class: "bbar" });
    const btn = (icon, label, title, fn, id, showLabel = false) => {
      const b = el("button", { class: "ibtn", title, id, "aria-label": label, html: ICON[icon] });
      if (showLabel) b.append(el("span", { class: "lbl" }, label));
      b.onclick = fn;
      bar.append(b);
      return b;
    };
    btn("copy", "Copy", "Copy (Ctrl+C)", () => copy(), "bb-copy");
    btn("paste", "Paste", "Paste (Ctrl+V)", () => paste(), "bb-paste");
    btn("duplicate", "Duplicate", "Duplicate (Ctrl+D)", () => dup(), "bb-dup");
    btn("del", "Delete", "Delete (Del)", () => del(), "bb-del");
    bar.append(el("span", { class: "sep" }));
    btn("sketch", "Sketch", "Draw a 2D sketch on the workplane or a flat face", () => app.advanced.createSketch(), "bb-sketch", true);
    btn("spline", "3D Sketch", "Draw lines in 3D on a shape, a virtual sphere or cube, or in the air", () => app.sketch3d.open(), "bb-sketch3d", true);
    btn("lathe", "Lathe", "Turn a shape or a wood blank on a virtual lathe, with chisels, then hollow it out", () => app.lathe.open(), "bb-lathe", true);
    btn("extrude", "Extrude", "Extrude a sketch into a shape (E)", () => app.quickExtrude(), "bb-extrude", true);
    btn("import", "Import", "Import a 3D model (STL, 3MF or STEP), an SVG or DXF drawing (to extrude), or a picture to trace", () => app.insertFile("any"), "bb-import", true);
    bar.append(el("span", { class: "sep" }));
    btn("group", "Group", "Group (Ctrl+G): merges solids, cuts holes", () => group(), "bb-group", true);
    btn("ungroup", "Ungroup", "Ungroup (Ctrl+Shift+G)", () => ungroup(), "bb-ungroup", true);
    btn("align", "Align", "Align (A)", () => app.advanced.align(), "bb-align", true);
    btn("pattern", "Pattern", "Make rows or circles of copies", () => app.advanced.pattern(), "bb-pattern", true);
    btn("mirror", "Mirror", "Mirror (M)", (e) => mirrorPopover(e.currentTarget), "bb-mirror", true);
    btn("drop", "Drop", "Drop to workplane (D)", () => drop(), "bb-drop", true);
    btn("texture", "Texture", "Add a surface texture (T)", () => app.advanced.texture(), "bb-texture", true);
    btn("measure", "Measure", "Measure sizes, distances and angles (I)", () => app.advanced.measure(), "bb-measure", true);
    btn("printsim", "3D Print Sim", "Simulate printing it: supports, layers, strength, print time", () => app.advanced.openPrintSim(), "bb-printsim", true);
    bar.append(el("span", { class: "sep" }));
    const sh = btn("holeToggle", "Hole", "Make hole (H)", () => setHole(true), "bb-hole", true);
    sh.querySelector("svg").outerHTML;
    btn("box", "Solid", "Make solid (S)", () => setHole(false), "bb-solid", true);
    btn("lock", "Lock", "Lock or unlock (Ctrl+L)", () => toggleLock(), "bb-lock", true);
    bar.append(el("span", { class: "sep" }));
    const mb = btn("select", "Multi-select", "Tap shapes to add them to the selection (same as Shift+click)", () => { multi = !multi; mb.setAttribute("aria-pressed", multi); }, "bb-multi", true);
    mb.setAttribute("aria-pressed", multi);
    bar.append(el("button", { class: "ibtn panel-toggle", onclick: () => $("shapes-tab").click() }, el("span", { class: "lbl" }, "Objects")));
    ribbon.append(bar);
    updateRibbon();
  }
  function updateRibbon() {
    const n = app.sel.length;
    const sel = app.selected();
    const set = (id, on) => { const b = $(id); if (b) b.disabled = !on; };
    set("bb-copy", n); set("bb-dup", n); set("bb-del", n); set("bb-paste", !!app.clipboard);
    set("bb-group", true); const gb = $("bb-group"); if (gb) gb.classList.toggle("dim", n < 2); set("bb-ungroup", sel.some((b) => b.node.t === "group"));
    set("bb-align", n >= 1); set("bb-lock", n);
    const lk = $("bb-lock");
    if (lk) { const all = n && app.sel.every((id) => app.isLocked(id)); lk.innerHTML = ICON[all ? "unlock" : "lock"]; lk.append(el("span", { class: "lbl" }, all ? "Unlock" : "Lock")); } set("bb-pattern", n); set("bb-drop", n); set("bb-hole", n); set("bb-solid", n);
    renderMirror();
  }

  // ---------------------------------------------------------------- operations
  function copy() { const s = app.selected(); if (s.length) { app.clipboard = clone(s); app.toast(`Copied ${s.length} shape${s.length > 1 ? "s" : ""}`); updateRibbon(); } }
  function paste() {
    if (!app.clipboard) return;
    const g = Math.max(app.gridStep(), 1) * 5;
    const ids = [];
    store.update((doc) => {
      for (const b of app.clipboard) {
        const c = clone(b);
        c.id = "b" + Math.random().toString(36).slice(2, 10);
        c.seq = ++doc.seq;
        c.m = arr(M4(c.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0)));
        doc.bodies.push(c);
        ids.push(c.id);
      }
    }, "Paste");
    app.clipboard = app.clipboard.map((b) => ({ ...b, m: arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(g, g, 0))) }));
    app.select(ids);
  }
  // selected shapes that aren't locked (tells the user when some are)
  function free() {
    const ids = app.sel.filter((id) => !app.isLocked(id));
    if (ids.length < app.sel.length) app.toast(ids.length ? "Locked shapes were left alone." : "That shape is locked. Unlock it first (Ctrl+L).");
    return ids;
  }
  function toggleLock() {
    if (!app.sel.length) return;
    const lock = !app.sel.every((id) => app.isLocked(id));
    setBodyProps(app.sel, { locked: lock }, lock ? "Lock" : "Unlock");
    app.toast(lock ? "Locked: it can't be moved, resized or deleted." : "Unlocked");
  }
  function dup() { if (app.sel.length) app.select(duplicateBodies(app.sel)); }
  function del() { const ids = free(); if (ids.length) { deleteBodies(ids); app.select(app.sel.filter((id) => !ids.includes(id))); } }
  function group() {
    if (app.sel.length < 2) { app.toast(app.sel.length ? "Select one more shape to group with: Shift+click (or Ctrl+click) it, or drag a box around the shapes." : "Select the shapes to group first: drag a box around them, press Ctrl+A for all, or Shift+click (Ctrl+click) each one."); return; }
    if (app.sel.some((id) => app.isLocked(id))) { app.toast("Unlock the shapes before grouping them."); return; }
    const id = groupBodies(app.sel);
    if (id) app.select([id]);
  }
  function ungroup() {
    const ids = [];
    for (const b of app.selected()) if (b.node.t === "group") {
      const mods = b.node.mods || [];
      if (mods.length && !(mods.length === 1 && mods[0].t === "scale")) { app.toast("This group has features (fillets, holes) from Advanced mode. Remove them first to ungroup.", "err"); continue; }
      const got = ungroupBody(b.id);
      if (!got.length && mods.length) { app.toast("This group was stretched at an angle, so it can't be split back into shapes.", "err"); continue; }
      ids.push(...got);
    }
    if (ids.length) app.select(ids);
  }
  function setHole(h) { const ids = free(); if (ids.length) setBodyProps(ids, { hole: h }, h ? "Make hole" : "Make solid"); }
  function drop() {
    const ids = free();
    if (!ids.length) return;
    store.update((doc) => {
      for (const id of ids) {
        const box = app.scene.bodyTightBox(id);
        if (!box) continue;
        const b = findBody(doc, id);
        b.m = arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(0, 0, -box.min.z)));
      }
    }, "Drop to workplane");
  }
  function selBox() {
    const box = new THREE.Box3();
    for (const id of app.sel) { const b = app.scene.bodyTightBox(id); if (b) box.union(b); }
    return box;
  }
  function closePopovers() { vpEl.querySelectorAll(".popover").forEach((p) => p.remove()); }
  function popover(anchor, title, body) {
    closePopovers();
    const r = anchor.getBoundingClientRect(), vr = vpEl.getBoundingClientRect();
    const p = el("div", { class: "float popover", style: { left: Math.max(8, Math.min(r.left - vr.left, vr.width - 240)) + "px", top: "8px", width: "230px" } },
      el("header", {}, el("h4", {}, title), el("button", { class: "xbtn", "aria-label": "Close", html: ICON.close, onclick: closePopovers })),
      el("div", { class: "body" }, body));
    vpEl.append(p);
  }
  function alignPopover(anchor) {
    if (app.sel.length < 2) return;
    const rows = ["x", "y", "z"].map((ax, i) => {
      const names = i === 2 ? ["Bottom", "Middle", "Top"] : i === 0 ? ["Left", "Center", "Right"] : ["Front", "Center", "Back"];
      return el("div", { class: "row" }, el("span", { class: "lab" }, ax.toUpperCase() + " axis"),
        el("div", { class: "seg" }, ...names.map((n, j) => el("button", { onclick: () => align(i, j) }, n))));
    });
    popover(anchor, "Align", rows);
  }
  function align(axis, mode) {
    const all = selBox();
    const target = mode === 0 ? all.min.getComponent(axis) : mode === 2 ? all.max.getComponent(axis) : (all.min.getComponent(axis) + all.max.getComponent(axis)) / 2;
    store.update((doc) => {
      for (const id of app.sel) {
        const box = app.scene.bodyTightBox(id);
        if (!box) continue;
        const cur = mode === 0 ? box.min.getComponent(axis) : mode === 2 ? box.max.getComponent(axis) : (box.min.getComponent(axis) + box.max.getComponent(axis)) / 2;
        const d = [0, 0, 0];
        d[axis] = target - cur;
        const b = findBody(doc, id);
        b.m = arr(M4(b.m).premultiply(new THREE.Matrix4().makeTranslation(...d)));
      }
    }, "Align");
  }
  // Mirror stays open as a small tool: pick shapes before or after opening it, then flip.
  var mirrorPop = null; // (var: the ribbon can refresh before this line runs)
  var mirrorState = { copy: false };
  function mirrorPopover(anchor) {
    popover(anchor || $("bb-mirror"), "Mirror", []);
    mirrorPop = vpEl.querySelector(".popover:last-child");
    mirrorPop.classList.add("mirror-pop");
    renderMirror();
  }
  function renderMirror() {
    if (!mirrorPop || !mirrorPop.isConnected) { mirrorPop = null; return; }
    const body = mirrorPop.querySelector(".body");
    body.innerHTML = "";
    const n = free().length;
    const AX = ["X  (left ↔ right)", "Y  (front ↔ back)", "Z  (top ↔ bottom)"];
    body.append(el("div", { class: "hint", style: { padding: 0, marginBottom: "6px" } }, n ? `${n} shape${n > 1 ? "s" : ""} selected. Click another to change (Shift+click adds).` : "Click a shape to mirror it (Shift+click to pick more)."));
    body.append(el("div", { class: "mirror-axes" }, ...[0, 1, 2].map((i) => el("button", { class: "btn", id: "bm-flip" + "xyz"[i], disabled: !n, onclick: () => mirror(i, mirrorState.copy) }, "Flip " + AX[i]))));
    body.append(el("label", { class: "check", style: { marginTop: "6px" } }, el("input", { type: "checkbox", id: "bm-copy", checked: mirrorState.copy, onchange: (e) => { mirrorState.copy = e.target.checked; } }), "Mirror a copy (keep the original)"));
    body.append(el("div", { class: "hint", style: { padding: 0 } }, mirrorState.copy ? "The copy is placed right next to the original, like a reflection." : "Flips the selection in place across its own center."));
  }
  function mirror(axis, copy) {
    const ids = free();
    if (!ids.length) { app.toast("Click a shape first, then pick a direction."); return; }
    const box = selBox(), c = box.getCenter(new THREE.Vector3());
    const s = [1, 1, 1];
    s[axis] = -1;
    // in place: across the selection's center; a copy: across its far side, so it sits next to it
    const at = copy ? box.max.clone() : c;
    const p = [c.x, c.y, c.z];
    p[axis] = at.getComponent(axis);
    const mat = new THREE.Matrix4().makeTranslation(...p).multiply(new THREE.Matrix4().makeScale(...s)).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
    const name = ["left ↔ right", "front ↔ back", "top ↔ bottom"][axis];
    if (!copy) {
      transformBodies(ids, mat, "Mirror");
      app.toast(`Mirrored ${name}.` + (ids.length === 1 && looksSymmetric(ids[0], axis) ? " This shape looks the same both ways: try “Mirror a copy”." : ""));
      return;
    }
    const newIds = [];
    store.update((doc) => {
      for (const id of ids) {
        const b = findBody(doc, id);
        if (!b) continue;
        const cpy = clone(b);
        cpy.id = uid("b");
        cpy.seq = nextSeq(doc);
        cpy.name = nextName(doc, b.name.replace(/\s\d+$/, ""));
        cpy.m = arr(M4(b.m).premultiply(mat));
        doc.bodies.push(cpy);
        newIds.push(cpy.id);
      }
    }, "Mirror copy");
    app.select(newIds);
    app.toast(`Made a mirrored copy (${name}).`);
  }
  // a plain box, cylinder, sphere… looks unchanged when flipped across its own center
  function looksSymmetric(id, axis) {
    const b = findBody(store.doc, id);
    if (!b || b.node.t !== "prim") return false;
    const k = b.node.kind;
    return ["box", "cylinder", "sphere", "torus", "tube", "capsule", "prism", "gem", "paraboloid"].includes(k) || (axis !== 2 && ["cone", "pyramid", "hemisphere"].includes(k));
  }
  function nudge(dx, dy, dz) {
    const ids = free();
    if (!ids.length) return;
    transformBodies(ids, new THREE.Matrix4().makeTranslation(dx, dy, dz), "Nudge");
  }

  // ---------------------------------------------------------------- placing shapes
  function placement(e, kind, ignoreId) {
    const g = app.gridStep() || 0;
    const hit = e ? app.scene.pickFace(e, (b) => b.id !== ignoreId && !b.hole) : null;
    if (hit) {
      const n = hit.normal;
      if (n.z > 0.999) {
        return new THREE.Matrix4().makeTranslation(round(hit.point.x, g), round(hit.point.y, g), hit.point.z);
      }
      return frameOnFace(hit.point, n);
    }
    const p = e ? vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)) : null;
    if (!p) return null;
    return new THREE.Matrix4().makeTranslation(round(p.x, g), round(p.y, g), 0);
  }
  function placeAt(kind, color, hole, mat) {
    let id;
    store.update((doc) => {
      if (!mat) {
        // find a free spot near the view center
        const t = vp.view.target;
        mat = new THREE.Matrix4().makeTranslation(round(t.x, 10), round(t.y, 10), 0);
      }
      const b = makePrimBody(doc, kind, arr(mat), { hole, color: color || undefined });
      doc.bodies.push(b);
      id = b.id;
    }, "Add " + primName(kind).toLowerCase());
    app.select([id]);
    tuckPanel();
  }
  function tuckPanel() { if (window.matchMedia("(max-width: 860px)").matches) shapesEl.classList.add("collapsed"); }
  function startPaletteDrag(e, kind, color, hole) {
    e.preventDefault();
    const tileEl = e.currentTarget;
    tileEl.setPointerCapture(e.pointerId);
    let body = null;
    let over = false;
    const start = [e.clientX, e.clientY];
    const onMove = (ev) => {
      const r = vp.canvas.getBoundingClientRect();
      over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!over) { if (body) store.setPreview(null); return; }
      const mat = placement(ev, kind, body && body.id);
      if (!mat) return;
      if (!body) body = makePrimBody(store.doc, kind, arr(mat), { hole, color: color || undefined });
      body.m = arr(mat);
      store.setPreview((doc) => { doc.seq = Math.max(doc.seq, body.seq); doc.bodies.push(clone(body)); });
      app.sel = [body.id];
      app.scene.setSelected(app.sel);
    };
    const onUp = (ev) => {
      tileEl.removeEventListener("pointermove", onMove);
      tileEl.removeEventListener("pointerup", onUp);
      tileEl.removeEventListener("pointercancel", onUp);
      const moved = Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 4;
      if (!moved) { store.setPreview(null); placeAt(kind, color, hole, null); return; }
      if (over && body) {
        store.commitPreview("Add " + primName(kind).toLowerCase());
        app.select([body.id]);
        tuckPanel();
      } else {
        store.setPreview(null);
        app.select([]);
      }
    };
    tileEl.addEventListener("pointermove", onMove);
    tileEl.addEventListener("pointerup", onUp);
    tileEl.addEventListener("pointercancel", onUp);
  }

  // ---------------------------------------------------------------- handles
  const H = new THREE.Group();
  vp.overlay.add(H);
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x18202a });
  const hotMat = new THREE.MeshBasicMaterial({ color: 0xe8a317 });
  const handleGeo = new THREE.BoxGeometry(1, 1, 1);
  const handleEdge = new THREE.EdgesGeometry(handleGeo);
  function mkHandle(type, data = {}) {
    const m = new THREE.Mesh(handleGeo, type === "lift" ? darkMat : whiteMat);
    if (type === "lift") m.geometry = new THREE.ConeGeometry(0.5, 1.2, 20).rotateX(Math.PI / 2);
    const outline = new THREE.LineSegments(type === "lift" ? new THREE.EdgesGeometry(m.geometry) : handleEdge, new THREE.LineBasicMaterial({ color: 0x18202a }));
    m.add(outline);
    m.userData.handle = { type, ...data };
    H.add(m);
    return m;
  }
  const footprint = [];
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) if (sx || sy) footprint.push(mkHandle("size", { sx, sy }));
  const topHandle = mkHandle("height");
  const lift = mkHandle("lift");
  // rotation arcs
  const rotHandles = ["z", "x", "y"].map((ax) => {
    const geo = new THREE.TorusGeometry(1, 0.022, 6, 32, Math.PI / 2.6);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ax === "z" ? 0x1f4fa8 : ax === "x" ? 0xb8352a : 0x2f8a4c }));
    m.userData.handle = { type: "rot", axis: ax };
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), m.material);
    tip.position.set(Math.cos(Math.PI / 2.6), Math.sin(Math.PI / 2.6), 0);
    tip.rotation.z = Math.PI / 2.6;
    m.add(tip);
    H.add(m);
    return m;
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 4, 96), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, transparent: true, opacity: 0.6 }));
  ring.visible = false;
  H.add(ring);
  const dimLabels = { w: vp.addLabel(), d: vp.addLabel(), h: vp.addLabel(), z: vp.addLabel(), a: vp.addLabel("angle") };
  // ---------------------------------------------------------------- Tab: type sizes on the shape (like Tinkercad)
  const DIMS = ["w", "d", "h", "z"], DIM_NAME = { w: "Width", d: "Depth", h: "Height", z: "Lift" };
  let dimEdit = null; // { id, i, input }
  function dimValue(f, k) {
    if (k === "z") { const box = app.scene.bodyTightBox(f.body.id); return box ? box.min.z : 0; }
    const i = { w: "x", d: "y", h: "z" }[k];
    return f.max[i] - f.min[i];
  }
  function dimKeys(f) { return f.prim === "torus" ? ["w", "z"] : DIMS; }
  function startDimEdit(back) {
    const f = selFrame();
    if (!f) return false;
    const keys = dimKeys(f);
    if (!dimEdit || dimEdit.id !== f.body.id) {
      closeDimEdit();
      const input = el("input", { class: "dim-input", id: "dim-input", inputmode: "decimal", "aria-label": "Size" });
      vp.labels.append(input);
      dimEdit = { id: f.body.id, i: back ? keys.length - 1 : 0, input, keys };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Tab") { e.preventDefault(); commitDim(); moveDim(e.shiftKey ? -1 : 1); }
        else if (e.key === "Enter") { e.preventDefault(); commitDim(); closeDimEdit(); }
        else if (e.key === "Escape") { e.preventDefault(); closeDimEdit(); }
      });
      // (only for this box: an old box's late blur must not close a newly opened one)
      input.addEventListener("blur", () => setTimeout(() => { if (dimEdit && dimEdit.input === input && document.activeElement !== input) { commitDim(); closeDimEdit(); } }, 0));
    } else moveDim(back ? -1 : 1);
    showDim();
    return true;
  }
  function moveDim(step) {
    if (!dimEdit) return;
    const n = dimEdit.keys.length;
    dimEdit.i = (dimEdit.i + step + n) % n;
    showDim();
  }
  function showDim() {
    const f = selFrame();
    if (!f || !dimEdit) return closeDimEdit();
    const k = dimEdit.keys[dimEdit.i];
    dimEdit.input.value = showLen(dimValue(f, k), 3);
    dimEdit.input.title = DIM_NAME[k] + " (Tab: next, Shift+Tab: back, Enter: done, Esc: cancel)";
    dimEdit.input.dataset.dim = DIM_NAME[k];
    dimEdit.orig = dimEdit.input.value;
    vp.request();
    setTimeout(() => { if (dimEdit) { dimEdit.input.focus(); dimEdit.input.select(); } }, 0);
  }
  function commitDim() {
    if (!dimEdit) return;
    const raw = dimEdit.input.value;
    if (raw === dimEdit.orig) return;
    const v = parseLen(raw);
    const f = selFrame();
    if (!f || !isFinite(v)) return;
    const k = dimEdit.keys[dimEdit.i], cur = dimValue(f, k);
    if (Math.abs(v - cur) < 1e-9) return;
    if (k === "z") { transformBodies([f.body.id], new THREE.Matrix4().makeTranslation(0, 0, v - cur), "Lift"); }
    else {
      if (v <= 0) return;
      if (f.prim === true && f.body.node.kind !== "text" && f.body.node.p[k] !== undefined) updatePrim(f.body.id, { [k]: v }, "Resize");
      else if (f.prim === "torus") updatePrim(f.body.id, { w: v }, "Resize");
      else {
        const v0 = app.scene.views.get(f.body.id);
        const bb = v0 && v0.data && (v0.data.kbbox || v0.data.bbox);
        if (!bb) return;
        const kk = [1, 1, 1]; kk[{ w: 0, d: 1, h: 2 }[k]] = v / (cur || 1);
        scaleBody(f.body.id, kk, bb);
      }
    }
    dimEdit.orig = showLen(v, 3);
  }
  function closeDimEdit() {
    if (!dimEdit) return;
    const inp = dimEdit.input;
    dimEdit = null;
    inp.remove();
    vp.request();
    vp.canvas.focus();
  }
  Object.values(dimLabels).forEach((l) => (l.hidden = true));
  const errLabels = new Map();

  function selFrame() {
    // frame for handles: the body's own frame when it has one, else world
    if (app.sel.length !== 1) return null;
    const b = findBody(store.view, app.sel[0]);
    const v = app.scene.views.get(app.sel[0]);
    if (!b || !v || !v.data || b.locked) return null;
    const m = M4(b.m);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    if (Math.abs(Math.abs(s.x) - 1) > 1e-6 || Math.abs(Math.abs(s.y) - 1) > 1e-6 || Math.abs(Math.abs(s.z) - 1) > 1e-6) return null;
    const bb = v.data.kbbox || v.data.bbox;
    let min = new THREE.Vector3(...bb.min), max = new THREE.Vector3(...bb.max);
    // during a resize drag, show handles on the live box
    if (drag && (drag.kind === "size" || drag.kind === "height") && drag.live) { min = drag.live.min; max = drag.live.max; }
    // plain primitives resize through their parameters; everything else gets a Scale feature
    const plain = b.node.t === "prim" && !(b.node.mods && b.node.mods.length);
    const prim = plain ? (b.node.kind === "torus" ? "torus" : true) : "scale";
    return { body: b, m, min, max, prim };
  }
  function updateHandles() {
    const adv = app.mode === "advanced";
    const f = !app.command && !app.sketcher.active ? selFrame() : null;
    H.visible = !!f;
    for (const l of Object.values(dimLabels)) l.hidden = true;
    if (dimEdit && (!f || f.body.id !== dimEdit.id)) setTimeout(closeDimEdit, 0);
    if (!f) { ring.visible = false; return; }
    const { m, min, max } = f;
    const hs = vp.touchMode ? 1.8 : 1; // bigger handles for fingers
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2;
    const W = (p) => p.applyMatrix4(m);
    for (const h of footprint) {
      const { sx, sy } = h.userData.handle;
      const local = new THREE.Vector3(sx < 0 ? min.x : sx > 0 ? max.x : cx, sy < 0 ? min.y : sy > 0 ? max.y : cy, min.z);
      h.position.copy(W(local));
      const ps = vp.pixelSize(h.position);
      h.scale.setScalar(ps * (sx && sy ? 9 : 7) * hs);
      h.quaternion.setFromRotationMatrix(m);
      h.visible = !!f.prim && (f.prim !== "torus" || (sx && sy));
      h.material = hot === h ? hotMat : whiteMat;
    }
    topHandle.position.copy(W(new THREE.Vector3(cx, cy, max.z)));
    topHandle.scale.setScalar(vp.pixelSize(topHandle.position) * 8 * hs);
    topHandle.quaternion.setFromRotationMatrix(m);
    topHandle.visible = !!f.prim && f.prim !== "torus";
    topHandle.material = hot === topHandle ? hotMat : whiteMat;
    const up = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const topW = W(new THREE.Vector3(cx, cy, max.z));
    const ps = vp.pixelSize(topW);
    lift.position.copy(topW).addScaledVector(up, ps * 28);
    lift.scale.setScalar(ps * 12 * hs);
    lift.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    lift.material = hot === lift ? hotMat : darkMat;
    lift.visible = !adv; // Advanced has its own Move tool
    // rotation arcs around the world-space box
    const wb = app.scene.bodyTightBox(f.body.id) || new THREE.Box3(min, max);
    const c = wb.getCenter(new THREE.Vector3());
    const size = wb.getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.y) / 2 + ps * 26;
    const cam = vp.camera.position;
    rotHandles.forEach((h) => {
      const ax = h.userData.handle.axis;
      const r = ax === "z" ? R : Math.max(size.z, ax === "x" ? size.y : size.x) / 2 + ps * 26;
      h.scale.setScalar(r);
      h.position.copy(c);
      // orient arc toward the camera side
      const toCam = new THREE.Vector3().subVectors(cam, c);
      if (ax === "z") { h.position.z = wb.min.z; h.rotation.set(0, 0, Math.atan2(toCam.y, toCam.x) - Math.PI / 4.8); }
      else if (ax === "x") { h.rotation.set(0, Math.PI / 2, 0); h.rotateZ(Math.atan2(toCam.z, -toCam.y) - Math.PI / 4.8 + Math.PI); }
      else { h.rotation.set(Math.PI / 2, 0, 0); h.rotateZ(Math.atan2(toCam.z, toCam.x) - Math.PI / 4.8); }
      h.material.opacity = 1;
      h.visible = !adv && (!drag || (drag.kind === "rot" && drag.axis === ax));
      h.scale.multiplyScalar(hot === h ? 1.02 : 1);
    });
    if (drag && drag.kind === "rot") {
      ring.visible = true;
      ring.position.copy(drag.center);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), drag.axisV);
      ring.scale.setScalar(drag.radius);
    } else ring.visible = false;
    // dimension labels while hovering or dragging a size handle
    const editing = dimEdit && dimEdit.id === f.body.id;
    if (editing || (drag ? drag.kind === "size" || drag.kind === "height" : hot && /size|height/.test(hot.userData.handle.type))) {
      const cur = editing ? dimEdit.keys[dimEdit.i] : null;
      const lab = (k, l, v, pos) => {
        const s = vp.project(W(pos));
        if (cur === k) { const inp = dimEdit.input; inp.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%)`; return; }
        l.hidden = false; l.textContent = showLen(v, 2); l.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%)`;
      };
      lab("w", dimLabels.w, max.x - min.x, new THREE.Vector3(cx, min.y - ps * 18, min.z));
      if (f.prim !== "torus") lab("d", dimLabels.d, max.y - min.y, new THREE.Vector3(max.x + ps * 18, cy, min.z));
      if (f.prim !== "torus") lab("h", dimLabels.h, max.z - min.z, new THREE.Vector3(max.x, min.y, (min.z + max.z) / 2));
      if (editing) {
        const wz = W(new THREE.Vector3(min.x, min.y, min.z)).z;
        const pz = W(new THREE.Vector3(min.x - ps * 22, min.y - ps * 22, min.z));
        lab("z", dimLabels.z, dimValue(f, "z"), pz.clone().applyMatrix4(m.clone().invert()));
        dimLabels.z.textContent = "↑ " + showLen(wz, 2);
      }
    }
    if (drag && drag.kind === "rot") {
      const s = vp.project(drag.center);
      dimLabels.a.hidden = false;
      dimLabels.a.textContent = fmt(drag.angle, 1) + "°";
      dimLabels.a.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%)`;
    }
  }
  vp.afterRender.add(updateHandles);
  vp.labelFns.add(() => {
    // error badges on bodies that failed to rebuild
    const seen = new Set();
    if (app.mode === "beginner") for (const [id, msg] of app.scene.errors) {
      const box = app.scene.bodyTightBox(id);
      if (!box || !findBody(store.view, id)) continue;
      let l = errLabels.get(id);
      if (!l) { l = vp.addLabel("err"); errLabels.set(id, l); }
      const s = vp.project(box.getCenter(new THREE.Vector3()));
      l.textContent = msg;
      l.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-50%)`;
      seen.add(id);
    }
    for (const [id, l] of errLabels) if (!seen.has(id)) { l.remove(); errLabels.delete(id); }
  });

  function pickHandle(e) {
    if (!H.visible) return null;
    vp.ray(e);
    const objs = [...footprint, topHandle, lift, ...rotHandles].filter((o) => o.visible);
    const hits = vp.raycaster.intersectObjects(objs, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.handle) o = o.parent;
    return o;
  }

  // ---------------------------------------------------------------- pointer interaction
  let drag = null;
  let hot = null;
  let multi = false;
  const handler = {
    hover(e) {
      const h = pickHandle(e);
      if (h !== hot) { hot = h; vp.request(); }
      if (h) { app.scene.setHovered(null); vp.canvas.style.cursor = h.userData.handle.type === "rot" ? "grab" : h.userData.handle.type === "lift" ? "ns-resize" : "pointer"; return; }
      const f = app.scene.pickFace(e);
      app.scene.setHovered(f ? f.body : null);
      vp.canvas.style.cursor = f ? "move" : "default";
    },
    leave() { app.scene.setHovered(null); hot = null; vp.request(); },
    // touch: dragging a handle or a shape moves it; dragging empty space orbits
    dblclick(e) {
      // double-click a sketch shape to edit the sketch
      const hits = vp.pick(e, app.scene.regionMeshes());
      if (hits.length) app.enterSketch(hits[0].object.userData.region.sketch);
    },
    wantsTouch(e) { return !!(pickHandle(e) || app.scene.pickFace(e)); },
    down(e) {
      vpEl.querySelectorAll(".popover:not(.mirror-pop)").forEach((p) => p.remove());
      const h = pickHandle(e);
      rotKeys = null; // a click ends arrow-key turning (a rotation arc starts it again)
      if (h) return startHandle(e, h);
      const f = app.scene.pickFace(e);
      if (f) {
        let sel = app.sel.slice();
        if (e.shiftKey || e.ctrlKey || e.metaKey || multi) {
          sel = sel.includes(f.body) ? sel.filter((x) => x !== f.body) : [...sel, f.body];
          app.select(sel);
          drag = { kind: "none" };
          return true;
        }
        if (!sel.includes(f.body)) { sel = [f.body]; app.select(sel); }
        const movable = sel.filter((id) => !app.isLocked(id));
        if (!movable.length) { drag = { kind: "locked", start: vp.local(e) }; return true; }
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -f.point.z);
        drag = { kind: "move", plane, start: f.point.clone(), ids: movable, moved: false, base: new Map(movable.map((id) => [id, findBody(store.doc, id).m])), boxes: new Map(movable.map((id) => [id, app.scene.boxWithMatrix(id, M4(findBody(store.doc, id).m))])) };
        return true;
      }
      drag = { kind: "rubber", start: vp.local(e), add: e.shiftKey || e.ctrlKey || e.metaKey || multi, base: app.sel.slice() };
      return true;
    },
    move(e) {
      if (!drag) return;
      if (drag.kind === "move") {
        const p = vp.rayPlane(e, drag.plane);
        if (!p) return;
        const g = app.gridStep();
        let dx = round(p.x - drag.start.x, g), dy = round(p.y - drag.start.y, g);
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!drag.moved && Math.hypot(...vp.local(e).map((v, i) => v - vp.project(drag.start)[i])) < 3) return;
        drag.moved = true;
        // snap edges and centers to other shapes
        const sn = app.snapToObjects(drag.ids, drag.boxes, new THREE.Vector3(dx, dy, 0), ["x", "y"]);
        dx = sn.delta.x; dy = sn.delta.y;
        const T = new THREE.Matrix4().makeTranslation(dx, dy, 0);
        store.setPreview((doc) => { for (const id of drag.ids) { const b = findBody(doc, id); b.m = arr(M4(drag.base.get(id)).premultiply(T)); } });
        app.status();
      } else if (drag.kind === "locked") {
        const [x, y] = vp.local(e);
        if (!drag.told && Math.hypot(x - drag.start[0], y - drag.start[1]) > 6) { drag.told = true; app.toast("That shape is locked. Unlock it first (Ctrl+L)."); }
      } else if (drag.kind === "rubber") {
        const [x, y] = vp.local(e);
        const [x0, y0] = drag.start;
        drag.rect = [Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)];
        if (drag.rect[2] + drag.rect[3] < 4) return;
        rubber.hidden = false;
        drag.crossing = !!drag.fusion && x < x0;
        rubber.classList.toggle("crossing", drag.crossing);
        Object.assign(rubber.style, { left: drag.rect[0] + "px", top: drag.rect[1] + "px", width: drag.rect[2] + "px", height: drag.rect[3] + "px" });
        // show which bodies the window will catch, as it's drawn
        app.scene.setPreselected(rubberHits(drag));
      } else if (drag.move) drag.move(e);
    },
    up(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === "move") {
        app.clearSnapGuides();
        if (d.moved) store.commitPreview("Move");
        else store.setPreview(null);
      } else if (d.kind === "rubber") {
        rubber.hidden = true;
        app.scene.setPreselected([]);
        if (!d.rect || d.rect[2] + d.rect[3] < 4) { if (!d.add && !d.onPick) app.select([]); return; }
        const hits = rubberHits(d);
        if (d.onPick) d.onPick(hits);
        else app.select(d.add ? [...d.base, ...hits] : hits);
      } else if (d.up) d.up(e);
      vp.request();
    },
    cancel() { if (drag && drag.kind !== "none" && drag.kind !== "rubber") store.setPreview(null); drag = null; rubber.hidden = true; app.scene.setPreselected([]); },
  };

  // bodies a selection window catches: drag right = whole body inside, drag left = touching
  function rubberHits(d) {
    if (!d.rect) return [];
    if (!d.rects) { d.rects = new Map(); for (const b of store.view.bodies) if (!b.hidden) { const r = screenRect(b.id); if (r) d.rects.set(b.id, r); } }
    const [rx, ry, rw, rh] = d.rect;
    const hits = [];
    for (const [id, [minX, minY, maxX, maxY]] of d.rects) {
      const touches = maxX >= rx && minX <= rx + rw && maxY >= ry && minY <= ry + rh;
      const inside = minX >= rx && maxX <= rx + rw && minY >= ry && maxY <= ry + rh;
      if (d.fusion && !d.crossing ? inside : touches) hits.push(id);
    }
    return hits;
  }
  // a body's on-screen bounds, from (up to a few thousand of) its mesh points
  function screenRect(id) {
    const v = app.scene.views.get(id);
    if (!v || !v.data || !v.group.visible) return null;
    const P = v.data.vertices, n = P.length / 3, step = Math.max(1, Math.floor(n / 4000));
    const m = v.group.matrix, t = new THREE.Vector3();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i += step) {
      t.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(m);
      const s = vp.project(t);
      if (s[2] > 1) continue; // behind the camera
      if (s[0] < minX) minX = s[0]; if (s[0] > maxX) maxX = s[0]; if (s[1] < minY) minY = s[1]; if (s[1] > maxY) maxY = s[1];
    }
    return minX === Infinity ? null : [minX, minY, maxX, maxY];
  }
  function startHandle(e, h) {
    if (app.sel.some((id) => app.isLocked(id))) return false;
    const f = selFrame();
    if (!f) return false;
    const info = h.userData.handle;
    const body = f.body;
    const m0 = f.m.clone();
    const inv = m0.clone().invert();
    if (info.type === "size" || info.type === "height") {
      const min0 = f.min.clone(), max0 = f.max.clone();
      const p0 = { ...body.node.p };
      const mods0 = clone(body.node.mods || []);
      let plane;
      if (info.type === "size") {
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(m0), new THREE.Vector3(0, 0, min0.z).applyMatrix4(m0));
      } else {
        const axis = new THREE.Vector3(0, 0, 1).transformDirection(m0);
        const toCam = new THREE.Vector3().subVectors(vp.camera.position, h.position);
        const n = toCam.sub(axis.clone().multiplyScalar(toCam.dot(axis))).normalize();
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h.position);
      }
      drag = {
        kind: info.type,
        live: { min: min0.clone(), max: max0.clone() },
        move(ev) {
          const p = vp.rayPlane(ev, plane);
          if (!p) return;
          const q = p.applyMatrix4(inv);
          const g = app.gridStep() || 0.01;
          const min = min0.clone(), max = max0.clone();
          if (info.type === "size") {
            if (info.sx > 0) max.x = Math.max(min0.x + g, min0.x + round(q.x - min0.x, g));
            if (info.sx < 0) min.x = Math.min(max0.x - g, max0.x - round(max0.x - q.x, g));
            if (info.sy > 0) max.y = Math.max(min0.y + g, min0.y + round(q.y - min0.y, g));
            if (info.sy < 0) min.y = Math.min(max0.y - g, max0.y - round(max0.y - q.y, g));
            if ((ev.shiftKey || f.prim === "torus") && info.sx && info.sy) {
              // uniform footprint
              const kx = (max.x - min.x) / (max0.x - min0.x), ky = (max.y - min.y) / (max0.y - min0.y);
              const k = Math.max(kx, ky);
              const w = (max0.x - min0.x) * k, d = (max0.y - min0.y) * k;
              if (info.sx > 0) max.x = min0.x + w; else min.x = max0.x - w;
              if (info.sy > 0) max.y = min0.y + d; else min.y = max0.y - d;
              if (ev.shiftKey && f.prim !== "torus") max.z = min0.z + (max0.z - min0.z) * k;
            }
          } else {
            max.z = Math.max(min0.z + g, min0.z + round(q.z - min0.z, g));
          }
          drag.live = { min, max };
          const kx = (max.x - min.x) / (max0.x - min0.x), ky = (max.y - min.y) / (max0.y - min0.y), kz = (max.z - min.z) / (max0.z - min0.z);
          const off = new THREE.Vector3((min.x + max.x - min0.x - max0.x) / 2, (min.y + max.y - min0.y - max0.y) / 2, 0);
          if (f.prim === "scale") {
            // any body: append (or fold into) a Scale feature, x' = k*x + o in its own frame
            const k = [kx, ky, kz];
            const o = [min.x - kx * min0.x, min.y - ky * min0.y, min.z - kz * min0.z];
            store.setPreview((doc) => {
              const b = findBody(doc, body.id);
              const mods = clone(mods0);
              const last = mods[mods.length - 1];
              if (last && last.t === "scale") {
                last.k = last.k.map((v, i) => +(v * k[i]).toPrecision(10));
                last.o = last.o.map((v, i) => +(v * k[i] + o[i]).toPrecision(10));
                if (last.k.every((v) => Math.abs(v - 1) < 1e-9) && last.o.every((v) => Math.abs(v) < 1e-9)) mods.pop();
              } else mods.push({ id: "f" + Math.random().toString(36).slice(2, 9), seq: nextSeq(doc), t: "scale", k: k.map((v) => +v.toPrecision(10)), o: o.map((v) => +v.toPrecision(10)) });
              b.node.mods = mods;
            });
            return;
          }
          store.setPreview((doc) => {
            const b = findBody(doc, body.id);
            const p = b.node.p;
            if (b.node.kind === "text") {
              // text keeps its proportions: footprint handles scale the letter size
              const k = Math.abs(kx - 1) > 1e-9 ? kx : ky;
              p.size = +(p0.size * k).toFixed(4); p.h = +(p0.h * kz).toFixed(4);
            } else {
              p.w = +(p0.w * kx).toFixed(4); p.d = +(p0.d * ky).toFixed(4); p.h = +(p0.h * kz).toFixed(4);
            }
            if (b.node.kind === "torus") { p.d = p.w; p.tube = p0.tube; }
            b.m = arr(m0.clone().multiply(new THREE.Matrix4().makeTranslation(off.x, off.y, off.z)));
          });
        },
        up() { drag = null; if (store.preview) store.commitPreview(f.prim === "scale" ? "Scale" : "Resize"); },
      };
      return true;
    }
    if (info.type === "lift") {
      const axis = new THREE.Vector3(0, 0, 1);
      const toCam = new THREE.Vector3().subVectors(vp.camera.position, h.position);
      const n = toCam.sub(axis.clone().multiplyScalar(toCam.dot(axis))).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.lengthSq() ? n : new THREE.Vector3(0, -1, 0), h.position);
      const start = vp.rayPlane(e, plane);
      const ids = app.sel.slice();
      const base = new Map(ids.map((id) => [id, findBody(store.doc, id).m]));
      drag = {
        kind: "lift",
        move(ev) {
          const p = vp.rayPlane(ev, plane);
          if (!p || !start) return;
          const dz = round(p.z - start.z, app.gridStep());
          const T = new THREE.Matrix4().makeTranslation(0, 0, dz);
          store.setPreview((doc) => { for (const id of ids) { const b = findBody(doc, id); b.m = arr(M4(base.get(id)).premultiply(T)); } });
        },
        up() { drag = null; store.commitPreview("Lift"); },
      };
      return true;
    }
    if (info.type === "rot") {
      rotKeys = { id: body.id, axis: info.axis };
      const wb = app.scene.bodyTightBox(body.id);
      const center = wb.getCenter(new THREE.Vector3());
      const axisV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[info.axis];
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisV, center);
      const u = info.axis === "z" ? new THREE.Vector3(1, 0, 0) : info.axis === "x" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const v = new THREE.Vector3().crossVectors(axisV, u);
      const angOf = (p) => Math.atan2(p.clone().sub(center).dot(v), p.clone().sub(center).dot(u));
      const p0 = vp.rayPlane(e, plane);
      if (!p0) return false;
      const a0 = angOf(p0);
      const base = body.m;
      // (the shared up() clears drag before calling this one's up, so keep our own handle)
      const rd = drag = {
        kind: "rot", axis: info.axis, center, axisV, angle: 0, radius: h.scale.x,
        move(ev) {
          const p = vp.rayPlane(ev, plane);
          if (!p) return;
          let a = ((angOf(p) - a0) * 180) / Math.PI;
          a = ((a + 540) % 360) - 180;
          a = ev.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
          rd.angle = a;
          const R = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z)
            .multiply(new THREE.Matrix4().makeRotationAxis(axisV, (a * Math.PI) / 180))
            .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
          store.setPreview((doc) => { const b = findBody(doc, body.id); b.m = arr(M4(base).premultiply(R)); });
        },
        up() { const a = rd.angle; drag = null; if (a) store.commitPreview(`Rotate ${a}°`); else store.setPreview(null); if (!rotKeys.told) { rotKeys.told = true; app.toast(`Fine-tune: arrow keys turn it 1° around ${info.axis.toUpperCase()} (Shift: 15°). Esc or a click stops.`); } },
      };
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- inspector
  let inspKey = "";
  // Tab / Shift+Tab between the number boxes (Width → Depth → Height → X → Y → Z): the value
  // is applied first, and the next box stays focused even though the panel redraws
  let tabTo = null;
  inspector.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !(e.target instanceof HTMLInputElement) || !e.target.classList.contains("num") || e.target.id === "insp-name") return;
    const boxes = [...inspector.querySelectorAll("input.num")].filter((x) => x.id && x.id !== "insp-name" && !x.disabled && x.offsetParent);
    const i = boxes.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const next = boxes[(i + (e.shiftKey ? -1 : 1) + boxes.length) % boxes.length];
    tabTo = { id: next.id, t: performance.now() };
    e.target.dispatchEvent(new Event("change"));
    const now = document.getElementById(tabTo.id);
    if (now) { now.focus(); now.select(); }
  }, true);
  // a click anywhere means the student moved on
  window.addEventListener("pointerdown", () => { tabTo = null; }, true);
  inspector.addEventListener("input", (e) => { if (e.target instanceof HTMLInputElement) e.target.dataset.dirty = "1"; });
  function renderInspector(force) {
    const sel = app.selected();
    if (!sel.length || app.mode !== "beginner") { inspector.hidden = true; inspKey = ""; return; }
    const key = JSON.stringify(sel.map((b) => [b.id, b.node.t === "prim" ? b.node.p : null, b.hole, b.color, b.name, b.m, !!b.locked, b.textures || null, b.node.mods || null, !!app.scene.views.get(b.id)?.data]));
    if (!force && key === inspKey && !inspector.hidden) return;
    const ae = document.activeElement && inspector.contains(document.activeElement) ? document.activeElement : null;
    let focusId = ae ? ae.id : null;
    // whatever is half-typed in the focused box survives the redraw
    const typing = ae && ae.dataset && ae.dataset.dirty ? { id: ae.id, value: ae.value, a: ae.selectionStart, b: ae.selectionEnd } : null;
    // just tabbed to another box: keep going there even if this redraw happens later
    if (tabTo && performance.now() - tabTo.t < 4000) focusId = tabTo.id;
    inspKey = key;
    inspector.hidden = false;
    inspector.innerHTML = "";
    const one = sel.length === 1 ? sel[0] : null;
    const title = one ? el("input", { class: "num", id: "insp-name", value: one.name, style: { fontFamily: "var(--f-ui)", fontWeight: 600 }, "aria-label": "Shape name" }) : el("h4", {}, `${sel.length} shapes`);
    if (one) {
      title.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") title.blur(); });
      title.addEventListener("change", () => setBodyProps([one.id], { name: title.value.trim() || one.name }, "Rename"));
    }
    inspector.append(el("header", {}, title, el("button", { class: "xbtn", "aria-label": "Deselect", title: "Deselect", html: ICON.close, onclick: () => app.select([]) })));
    const body = el("div", { class: "body" });
    inspector.append(body);
    if (sel.some((b) => b.locked)) {
      body.append(el("div", { class: "lockbar" }, el("span", { html: ICON.lock }), el("span", {}, sel.length > 1 ? "Some of these shapes are locked." : "Locked: it can't be moved, resized or deleted."),
        el("button", { class: "btn", id: "insp-unlock", onclick: () => toggleLock() }, "Unlock")));
      if (sel.every((b) => b.locked)) return;
    }
    const allHole = sel.every((b) => b.hole), noHole = sel.every((b) => !b.hole);
    const shColor = (sel.find((b) => !b.hole) || sel[0]).color;
    body.append(el("div", { class: "solidhole" },
      el("button", { "aria-pressed": noHole, onclick: () => setHole(false) }, el("span", { class: "chip", style: { background: shColor } }), "Solid"),
      el("button", { "aria-pressed": allHole, onclick: () => setHole(true) }, el("span", { class: "chip hole" }), "Hole")));
    if (!allHole) {
      const colors = el("div", { class: "colors" });
      for (const c of PALETTE) colors.append(el("button", { style: { background: c }, "aria-label": "Color " + c, "aria-pressed": sel.every((b) => b.color === c), onclick: () => setBodyProps(app.sel, { color: c, hole: false }, "Color") }));
      body.append(colors);
    }
    const plainPrim = one && one.node.t === "prim" && !(one.node.mods || []).some((m) => m.t === "scale");
    if (plainPrim) primControls(body, one);
    else if (one) sizeControls(body, one);
    if (one) transformControls(body, one);
    if (one && !one.hole) textureControls(body, one);
    if (one && one.node.t === "group") body.append(el("button", { class: "btn", onclick: () => ungroup() }, "Ungroup"));
    if (sel.length > 1) body.append(el("button", { class: "btn primary", onclick: () => group() }, `Group ${sel.length} shapes`));
    const feats = one ? (one.node.mods || []).filter((m) => m.t !== "scale").length : 0;
    if (feats) body.append(el("div", { class: "hint", style: { padding: 0 } }, `Has ${feats} feature${feats > 1 ? "s" : ""} from Advanced mode (fillets, holes…).`));
    if (focusId) {
      const f = document.getElementById(focusId);
      if (f) {
        f.focus();
        if (typing && typing.id === focusId) {
          f.value = typing.value; f.dataset.dirty = "1";
          try { f.setSelectionRange(typing.a, typing.b); } catch (e) {}
          // a value put back by script doesn't fire "change" on blur by itself
          f.addEventListener("blur", () => f.dispatchEvent(new Event("change")), { once: true });
        }
        else if (tabTo && tabTo.id === focusId && f.select) f.select();
      }
    }
  }
  // typed size for any body: scales it about its bottom center
  function sizeControls(body, b) {
    const v = app.scene.views.get(b.id);
    if (!v || !v.data) return;
    const bb = v.data.kbbox || v.data.bbox;
    const size = [0, 1, 2].map((i) => bb.max[i] - bb.min[i]);
    const r3 = el("div", { class: "row3" });
    ["Width", "Depth", "Height"].forEach((lab, i) => {
      r3.append(el("label", {}, lab, app.numField({ value: +size[i].toFixed(3), id: "insp-s" + i, min: 0.01, step: 1, onCommit: (val) => {
        const k = [1, 1, 1]; k[i] = val / (size[i] || 1);
        scaleBody(b.id, k, bb);
      } })));
    });
    body.append(el("div", { class: "subhead" }, "Size"), r3);
  }
  function scaleBody(id, k, bb) {
    const a = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2]];
    const o = a.map((x, i) => x - k[i] * x);
    store.update((doc) => {
      const b = findBody(doc, id);
      b.node.mods = b.node.mods || [];
      const last = b.node.mods[b.node.mods.length - 1];
      if (last && last.t === "scale") { last.k = last.k.map((v, i) => +(v * k[i]).toPrecision(10)); last.o = last.o.map((v, i) => +(v * k[i] + o[i]).toPrecision(10)); }
      else b.node.mods.push({ id: "f" + Math.random().toString(36).slice(2, 9), seq: nextSeq(doc), t: "scale", k: k.map((v) => +v.toPrecision(10)), o: o.map((v) => +v.toPrecision(10)) });
    }, "Resize");
  }
  function textureControls(body, b) {
    const list = b.textures || [];
    body.append(el("div", { class: "subhead" }, "Texture"));
    for (const t of list) {
      const name = (LIB.find((x) => x.key === t.tex) || { name: t.tex }).name;
      body.append(el("div", { class: "texrow" },
        el("img", { src: textureThumb(t.tex, 48), alt: "", width: 24, height: 24 }),
        el("span", {}, `${name} · ${t.faces === "all" ? "whole shape" : t.faces.length + " face" + (t.faces.length > 1 ? "s" : "")}`),
        el("button", { class: "btn", onclick: () => app.advanced.texture({ body: b.id, tex: t.id }) }, "Edit"),
        el("button", { class: "xbtn", "aria-label": "Remove texture", title: "Remove texture", html: ICON.close, onclick: () => store.update((doc) => { const x = findBody(doc, b.id); x.textures = (x.textures || []).filter((y) => y.id !== t.id); }, "Remove texture") })));
    }
    body.append(el("button", { class: "btn", id: "insp-texture", onclick: () => app.advanced.texture() }, list.length ? "Add another texture" : "Add texture…"));
  }
  function updatePrim(id, patch, label = "Edit shape") {
    store.update((doc) => { const b = findBody(doc, id); Object.assign(b.node.p, patch); if (b.node.kind === "torus") b.node.p.d = b.node.p.w; }, label);
  }
  function primControls(body, b) {
    const p = b.node.p, kind = b.node.kind;
    const slider = (label, key, min, max, step, scale = 1, id) => {
      const val = (p[key] ?? 0) * scale;
      const range = el("input", { type: "range", min, max, step, value: val, id: id + "-r", "aria-label": label });
      const num = app.numField({ value: val, id, min: -Infinity, max: Infinity, step, onCommit: (v) => updatePrim(b.id, { [key]: v / scale }, label) });
      range.addEventListener("input", () => { num.value = fmt(+range.value, 3); });
      range.addEventListener("change", () => updatePrim(b.id, { [key]: +range.value / scale }, label));
      body.append(el("div", { class: "row" }, el("label", { for: id }, label), el("div", { class: "slider" }, range, num)));
    };
    if (kind === "text") {
      // Tinkercad-style text shape
      const txt = el("input", { class: "num", id: "insp-text", value: p.text || "", style: { fontFamily: "var(--f-ui)" }, "aria-label": "Text" });
      txt.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") txt.blur(); });
      txt.addEventListener("change", () => { if (txt.value.trim()) updatePrim(b.id, { text: txt.value }, "Edit text"); });
      body.append(el("div", { class: "subhead" }, "Text"), txt);
      const fs = el("select", { class: "num", id: "insp-font", "aria-label": "Font" }, ...Object.entries(FONT_NAMES).map(([v, l]) => el("option", { value: v, selected: v === (p.font || "sans") }, l)));
      fs.onchange = () => updatePrim(b.id, { font: fs.value }, "Font");
      body.append(fs);
      const r3 = el("div", { class: "row3" });
      r3.append(el("label", {}, "Letter size", app.numField({ value: p.size, id: "insp-size", min: 0.5, step: 1, onCommit: (v) => updatePrim(b.id, { size: v }, "Resize") })));
      r3.append(el("label", {}, "Height", app.numField({ value: p.h, id: "insp-h", min: 0.1, step: 1, onCommit: (v) => updatePrim(b.id, { h: v }, "Resize") })));
      r3.append(el("span"));
      body.append(r3);
      // bend the text along an arc (circular text)
      slider("Curve °", "curve", -340, 340, 5, 1, "insp-curve");
      body.append(el("div", { class: "hint", style: { padding: 0 } }, "Curve bends the letters along an arc. Use a negative number to bend the other way."));
      // put the text onto another shape's surface (flat, round or ball-shaped)
      body.append(el("button", { class: "btn primary", id: "insp-wrap", style: { width: "100%", marginTop: "6px" }, title: "Click a face of another shape: the letters follow its surface, even round ones",
        onclick: () => app.advanced.emboss({ str: p.text || "TEXT", font: p.font || "sans", size: p.size || 10, depth: Math.max(0.4, Math.min(p.h || 1, 2)), mode: "emboss", removeId: b.id }) }, "Wrap onto a shape…"));
      return;
    }
    const minDim = Math.min(p.w, p.d, p.h);
    if (["box", "wedge", "cylinder", "prism"].includes(kind)) {
      slider("Radius", "r", 0, +(minDim / 2 * 0.96).toFixed(2), 0.1, 1, "insp-r");
      slider("Bevel", "c", 0, +(minDim / 2 * 0.96).toFixed(2), 0.1, 1, "insp-c");
    }
    if (kind === "cone") slider("Top", "top", 0, p.w, 0.5, p.w, "insp-top");
    if (kind === "pyramid" || kind === "prism") slider("Sides", "sides", 3, kind === "prism" ? 24 : 12, 1, 1, "insp-sides");
    if (kind === "tube") slider("Wall", "wall", 0.2, +(Math.min(p.w, p.d) / 2 - 0.1).toFixed(2), 0.1, 1, "insp-wall");
    if (kind === "torus") slider("Tube", "tube", 0.5, +(p.w / 2 - 0.1).toFixed(2), 0.5, 1, "insp-tube");
    if (kind === "star") { slider("Points", "points", 3, 16, 1, 1, "insp-points"); slider("Inner %", "inner", 15, 90, 1, 100, "insp-inner"); }
    if (kind === "spring") { slider("Turns", "turns", 1, 30, 0.5, 1, "insp-turns"); slider("Wire", "wire", 0.4, +(Math.min(p.w, p.d) / 4).toFixed(2), 0.1, 1, "insp-wire"); }
    body.append(el("div", { class: "subhead" }, "Size"));
    const sizeRow = el("div", { class: "row3" });
    const dims = kind === "torus" ? [["Diameter", "w"]] : [["Width", "w"], ["Depth", "d"], ["Height", "h"]];
    for (const [lab, key] of dims) {
      const f = app.numField({ value: p[key], id: "insp-" + key, min: 0.01, step: Math.max(app.gridStep(), 0.1), onCommit: (v) => updatePrim(b.id, { [key]: v }, "Resize") });
      sizeRow.append(el("label", {}, lab, f));
    }
    body.append(sizeRow);
  }
  function transformControls(body, b) {
    const box = app.scene.bodyTightBox(b.id);
    if (!box) return;
    body.append(el("div", { class: "subhead" }, "Position"));
    const row = el("div", { class: "row3" });
    const c = box.getCenter(new THREE.Vector3());
    const vals = [c.x, c.y, box.min.z];
    ["X", "Y", "Z (bottom)"].forEach((lab, i) => {
      const f = app.numField({ value: vals[i], id: "insp-pos" + i, step: Math.max(app.gridStep(), 0.1), onCommit: (v) => {
        const d = [0, 0, 0]; d[i] = v - vals[i];
        transformBodies([b.id], new THREE.Matrix4().makeTranslation(...d), "Move");
      } });
      row.append(el("label", {}, lab, f));
    });
    body.append(row);
    body.append(el("div", { class: "subhead" }, "Rotate 90°"));
    const rr = el("div", { class: "seg" });
    for (const ax of ["x", "y", "z"]) rr.append(el("button", { onclick: () => rotate90(b.id, ax) }, "↻ " + ax.toUpperCase()));
    body.append(rr);
  }
  function rotate90(id, ax) {
    const box = app.scene.bodyTightBox(id);
    const c = box.getCenter(new THREE.Vector3());
    const axisV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[ax];
    const R = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(axisV, -Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    const cur = findBody(store.doc, id);
    const next = M4(cur.m).premultiply(R);
    const nb = app.scene.boxWithMatrix(id, next);
    if (nb) next.premultiply(new THREE.Matrix4().makeTranslation(0, 0, box.min.z - nb.min.z));
    store.update((doc) => { findBody(doc, id).m = arr(next); }, "Rotate");
  }

  // ---------------------------------------------------------------- keys
  // arrow keys after a rotation arc: turn the shape 1° (Shift: 15°) around that arc's axis
  let rotKeys = null;
  function rotateByKey(e) {
    if (!rotKeys || app.sel.length !== 1 || app.sel[0] !== rotKeys.id || !findBody(store.doc, rotKeys.id) || app.isLocked(rotKeys.id)) { rotKeys = null; return false; }
    const s = (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 15 : 1);
    const wb = app.scene.bodyTightBox(rotKeys.id); if (!wb) return false;
    const c = wb.getCenter(new THREE.Vector3()), axisV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[rotKeys.axis];
    const R = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(axisV, (s * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    transformBodies([rotKeys.id], R, `Rotate ${s > 0 ? "+" : ""}${s}°`);
    return true;
  }
  function key(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (/^Arrow/.test(e.key) && !mod && !e.altKey && rotKeys && rotateByKey(e)) return true;
    if (e.key === "Escape") rotKeys = null;
    if (e.key === "Tab" && !mod && !e.altKey && app.sel.length === 1) return startDimEdit(e.shiftKey);
    const k = e.key.toLowerCase();
    const g = (app.gridStep() || 1) * (e.shiftKey ? 10 : 1);
    if (mod && k === "c") { copy(); return true; }
    if (mod && k === "v") { paste(); return true; }
    if (mod && k === "d") { dup(); return true; }
    if (mod && k === "g") { e.shiftKey ? ungroup() : group(); return true; }
    if (mod && k === "a") { app.select(store.doc.bodies.map((b) => b.id)); return true; }
    if (mod && k === "l") { toggleLock(); return true; }
    if (e.key === "Delete" || e.key === "Backspace") { del(); return true; }
    if (e.key === "ArrowUp" && mod) { nudge(0, 0, g); return true; }
    if (e.key === "ArrowDown" && mod) { nudge(0, 0, -g); return true; }
    if (e.key === "ArrowUp") { nudge(0, g, 0); return true; }
    if (e.key === "ArrowDown") { nudge(0, -g, 0); return true; }
    if (e.key === "ArrowLeft") { nudge(-g, 0, 0); return true; }
    if (e.key === "ArrowRight") { nudge(g, 0, 0); return true; }
    if (mod) return false;
    if (k === "h") { setHole(true); return true; }
    if (k === "s") { setHole(false); return true; }
    if (k === "d") { drop(); return true; }
    if (k === "f") { app.fit(); return true; }
    if (k === "a") { app.advanced.align(); return true; }
    if (k === "p") { app.advanced.pattern(); return true; }
    if (k === "t") { app.advanced.texture(); return true; }
    if (k === "i") { app.advanced.measure(); return true; }
    if (k === "l" || k === "r" || k === "c") { app.startSketchTool({ l: "line", r: "rect*", c: "circle" }[k]); return true; }
    if (k === "m") { mirrorPopover($("bb-mirror")); return true; }
    return false;
  }

  renderShapes();
  return {
    handler,
    key,
    showTile,
    pickHandle,
    hoverHandle(e) {
      const h = pickHandle(e);
      if (h !== hot) { hot = h; vp.request(); }
      if (h) vp.canvas.style.cursor = "pointer";
      return !!h;
    },
    handleDown(e) { const h = pickHandle(e); return h ? startHandle(e, h) : false; },
    // Fusion-style: drag right = window (whole body inside), drag left = crossing
    screenRect,
    rubberDown(e, add, start, base, onPick) { drag = { kind: "rubber", start: start || vp.local(e), add, base: base || app.sel.slice(), fusion: true, onPick }; },
    refresh(kind) {
      if (kind === "mode" || !ribbon.querySelector(".bbar")) renderRibbon();
      updateRibbon();
      renderInspector(kind === "mode" || kind === "units");
      closePopovers && kind === "mode" && closePopovers();
      vp.request();
    },
  };
}
