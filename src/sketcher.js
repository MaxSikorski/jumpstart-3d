// Sketch editing: drawing tools, snapping, typed dimensions, trim, editing.
import * as THREE from "three";
import { store, findSketch, regionsFor, userLoops, regionOwners } from "./store.js";
import { planeMatrix, regionGeometry, textOutlines, sketchImageMesh } from "./scene.js";
import { sketchTexts } from "./store.js";
import { textBounds } from "./textgeo.js";
import {
  resolveSketch, sampleCurve, distToCurve, allIntersections, trimSpan, curvePoint, d2, normAng, angIn, makeSplineCurve, nearestOnCurve,
} from "./regions.js";
import { uid, parseLength, fmt, round, el } from "./util.js";
import { getUnit } from "./units.js";
import { CONSTRAINTS, CONSTRAINT_BADGES, solveSketch, pruneConstraints, pickKind, wants, addConstraint, glyphSpots, autoConstrain } from "./constraints.js";
import { buildDim, dimGraphics, measureDim } from "./dims.js";

const DEG = Math.PI / 180;
import { theme } from "./theme.js";
const C = {
  get line() { return theme.c.sketch; }, get point() { return theme.c.sketch; }, cons: 0xc07a12, proj: 0x7d3fb0, hover: 0xe8a317,
  // brighter selection/preview colors on the dark themes, where dark blue disappears
  get sel() { return theme.name === "light" ? 0x1f4fa8 : 0x4fc3ff; },
  get dim() { return theme.name === "light" ? 0x2b3a4c : 0xb8c6d6; },
  get preview() { return theme.name === "light" ? 0x1f4fa8 : 0xffe600; },
};
// Sketch units: millimetres or inches (inputs, readouts and grid); the model stays in mm.
// (the unit itself is app-wide: see units.js and the switch in the status bar)
const skDisp = (v, d = 3) => fmt(getUnit() === "in" ? v / 25.4 : v, d);

export const SKETCH_TOOLS = {
  line: { label: "Line", key: "L", fields: ["Length", "Angle"] },
  rect: { label: "2-point rectangle", key: "R", fields: ["Width", "Height"] },
  rect3: { label: "3-point rectangle", fields: ["Length", "Angle"] },
  rectc: { label: "Center rectangle", fields: ["Width", "Height"] },
  circle: { label: "Center circle", key: "C", fields: ["Diameter"] },
  arc3: { label: "3-point arc", key: "A", fields: [] },
  arcc: { label: "Center arc", fields: ["Radius", "Sweep"] },
  polygon: { label: "Polygon", key: "P", fields: ["Radius", "Sides"] },
  spline: { label: "Spline", fields: [] },
  point: { label: "Point", fields: [] },
  text: { label: "Text", fields: [] },
  trim: { label: "Trim", key: "T", fields: [] },
  dim: { label: "Sketch dimension", key: "D", fields: [] },
  select: { label: "Select", key: "S", fields: [] },
  ...Object.fromEntries(Object.entries(CONSTRAINTS).map(([k, c]) => ["c-" + k, { label: c.label + " constraint", fields: [], constraint: k }])),
};

// ---------------------------------------------------------------- doc ops
export function normalizeSketch(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  for (const e of sk.ents) {
    if (e.t !== "arc") continue;
    const c = P.get(e.c), a = P.get(e.a), b = P.get(e.b);
    if (!c || !a || !b) continue;
    const r = Math.hypot(a.x - c.x, a.y - c.y);
    const ang = Math.atan2(b.y - c.y, b.x - c.x);
    b.x = c.x + r * Math.cos(ang);
    b.y = c.y + r * Math.sin(ang);
  }
}
// every sketch point an entity uses (splines use a list of fit points)
export function entPts(e) {
  return [e.a, e.b, e.c, e.p, ...(e.pts || [])].filter(Boolean);
}
function pruneOrphans(sk) {
  const used = new Set();
  for (const e of sk.ents) for (const id of entPts(e)) used.add(id);
  sk.pts = sk.pts.filter((p) => used.has(p.id));
}
function addPt(sk, p) {
  // reuse an existing point at the same spot
  const hit = sk.pts.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 1e-6);
  if (hit) return hit.id;
  const id = uid("p");
  sk.pts.push({ id, x: p[0], y: p[1] });
  return id;
}

export class Sketcher {
  constructor(app) {
    this.app = app;
    this.vp = app.vp;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.renderOrder = 6;
    this.vp.world.add(this.group);
    this.active = null; // sketch id
    this.tool = "line";
    this.state = null; // in-progress tool state
    this.sel = new Set(); // selected entity ids
    this.hover = null;
    this.snapOn = true;
    this.polySides = 6;
    this.input = this.makeInput();
    this.vp.container.append(this.input.root);
    // grid drawn on the sketch plane while sketching (spacing follows the zoom)
    this.gridGroup = new THREE.Group();
    this.gridGroup.matrixAutoUpdate = false;
    this.vp.world.add(this.gridGroup);
    this.gridKey = "";
    this.coord = this.vp.addLabel("coord");
    this.coord.hidden = true;
    this.vp.afterRender.add(() => { this.ensureGrid(); this.placeGlyphs(); });
    this.handler = {
      down: (e) => this.down(e),
      move: (e) => this.move(e),
      up: (e) => this.up(e),
      hover: (e) => this.move(e),
      dblclick: () => this.finishChain(),
      leave: () => { this.cursor = null; this.coord.hidden = true; this.redraw(); },
      // on touch, a drag only belongs to the sketch when it grabs geometry with Select
      wantsTouch: (e) => { if (this.tool !== "select" || !this.sketch) return false; const raw = this.to2d(e); return !!(raw && this.pickEnt(raw)); },
      cancel: () => {},
    };
  }

  get sketch() { return this.active ? findSketch(store.view, this.active) : null; }

  enter(id, look = true) {
    this.active = id;
    this.gridKey = "";
    this.vp.grid.visible = false; // the sketch draws its own grid on its plane
    this.sel.clear();
    this.state = null;
    // like Fusion: going back into a sketch that has shapes starts with Select (click a shape to
    // change its size); a new, empty sketch starts with Line, ready to draw
    { const s0 = this.sketch; this.setTool(s0 && s0.ents.some((x) => !x.proj) ? "select" : "line"); }
    const sk = this.sketch;
    this.mat = planeMatrix(sk.plane);
    this.inv = this.mat.clone().invert();
    this.group.matrix.copy(this.mat);
    this.group.matrixWorldNeedsUpdate = true;
    this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...sk.plane.n).normalize(), new THREE.Vector3(...sk.plane.o));
    if (look) {
      const n = new THREE.Vector3(...sk.plane.n);
      const y = new THREE.Vector3().crossVectors(n, new THREE.Vector3(...sk.plane.x));
      const regs = regionsFor(sk);
      let center = new THREE.Vector3(...sk.plane.o);
      let dist = Math.max(120, this.vp.view.dist * 0.8);
      if (sk.pts.length) {
        const b = new THREE.Box3();
        for (const p of sk.pts) b.expandByPoint(new THREE.Vector3(p.x, p.y, 0).applyMatrix4(this.mat));
        const fp = this.vp.fitParams(b);
        center = fp.target; dist = Math.max(60, fp.dist);
      } else {
        // keep looking at the area the user was viewing, projected onto the plane
        const t = this.vp.view.target.clone();
        center = this.plane.projectPoint(t, new THREE.Vector3());
      }
      this.vp.lookAlong(n, y, center, dist);
      void regs;
    }
    this.vp.handler = this.handler;
    this.redraw();
  }
  exit() {
    for (const g of this.glyphEls || []) g.remove();
    this.glyphEls = []; this.glyphSig = null;
    for (const d of this.dimEls || []) d.remove();
    this.dimEls = []; this.dimSig = null; this.dimPicks = []; this.dimPreview = null;
    this.active = null;
    this.state = null;
    this.hideInput();
    this.vp.grid.visible = true;
    this.coord.hidden = true;
    this.clearGrid();
    if (this.app.originMarker) this.app.originMarker.visible = true;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry && c.geometry.dispose(); }
    this.vp.request();
  }

  setTool(t) {
    // "rect*" = the rectangle kind used last (R key), like Fusion's remembered choice
    if (t === "rect*") t = this.rectMode || "rect";
    if (this.tool === "spline" && this.state && t !== "spline") this.finishSpline(); // keep a spline in progress
    if (t === "rect" || t === "rect3" || t === "rectc") this.rectMode = t;
    this.tool = t;
    this.state = null;
    this.cpicks = [];
    this.dimPicks = []; this.dimPreview = null;
    // a constraint chosen with shapes already selected applies to them straight away
    if (t.startsWith("c-") && this.sketch && this.sel.size) {
      const sk = this.sketch, picks = [...this.sel].map((id) => pickKind(sk, id)).filter(Boolean);
      const w = picks.length ? wants(t.slice(2), picks) : "bad";
      if (w === "done") { this.applyConstraint(t.slice(2), picks); this.sel.clear(); }
      else if (w === "more") this.cpicks = picks; // keep them as the first picks
      else this.sel.clear();
    }
    this.hideInput();
    this.redraw();
    this.app.onSketchTool && this.app.onSketchTool(t);
  }

  // ------------------------------------------------------------ coordinates
  to2d(e) {
    const p = this.vp.rayPlane(e, this.plane);
    if (!p) return null;
    p.applyMatrix4(this.inv);
    return [p.x, p.y];
  }
  px() { return this.vp.pixelSize(new THREE.Vector3(...this.sketch.plane.o)); }

  snap(raw, anchor, opts = {}) {
    const sk = this.sketch;
    const tol = this.vp.tol(9) * this.px();
    const curves = resolveSketch(sk);
    let best = null;
    const consider = (p, kind, extra = {}, pr = 0) => {
      const d = d2(p, raw);
      if (d < tol && (!best || pr > best.pr || (pr === best.pr && d < best.d))) best = { p: [...p], kind, d, pr, ...extra };
    };
    if (this.snapOn || true) {
      for (const p of sk.pts) {
        if (opts.exclude && opts.exclude.has(p.id)) continue;
        consider([p.x, p.y], "point", { pid: p.id }, 5);
      }
      consider([0, 0], "origin", {}, 4);
      if (sk.faceCenter) consider(sk.faceCenter, "face center", {}, 4);
      for (const c of curves) {
        if (opts.excludeEnt && opts.excludeEnt.has(c.id)) continue;
        if (c.t === "line") consider([(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2], "mid", {}, 3);
        if (c.t === "circle" || c.t === "arc") consider(c.c, "center", {}, 3);
        if (c.t === "circle" || c.t === "arc")
          for (let k = 0; k < 4; k++) {
            const ang = k * Math.PI / 2;
            if (c.t === "arc" && !angIn(ang, c.a0, c.a1)) continue;
            consider(curvePoint(c, ang), "quad", {}, 2);
          }
      }
      if (!opts.excludeEnt) for (const p of allIntersections(curves)) consider(p, "int", {}, 4);
      // centers of closed shapes (rectangles, polygons...)
      for (const r of regionsFor(sk)) if (r.poly && r.poly.length > 2 && !r.text) consider(polyCentroid(r.poly), "center", {}, 2);
      // the bodies' corners, edge middles and round-edge centers that lie on the sketch plane
      if (this.app.objectSnap) for (const q of this.bodySnapPts()) consider(q.p, q.kind, {}, q.pr);
      if (!best) {
        // nearest point on a curve
        for (const c of curves) {
          if (c.t === "point" || (opts.excludeEnt && opts.excludeEnt.has(c.id))) continue;
          if (distToCurve(c, raw) < tol * 0.7) {
            consider(nearestOnCurve(c, raw), "on", { ent: c.id }, 1);
          }
        }
      }
    }
    if (best) return best;
    // grid and inference
    const g = this.snapStep();
    let p = [...raw];
    const guides = [];
    if (g > 0) p = [round(p[0], g), round(p[1], g)];
    if (anchor) {
      if (Math.abs(raw[1] - anchor[1]) < tol * 0.7) { p[1] = anchor[1]; guides.push("h"); }
      if (Math.abs(raw[0] - anchor[0]) < tol * 0.7) { p[0] = anchor[0]; guides.push("v"); }
    }
    // align with other points
    let align = null;
    for (const q of sk.pts) {
      if (opts.exclude && opts.exclude.has(q.id)) continue;
      if (!guides.includes("v") && Math.abs(raw[0] - q.x) < tol * 0.5) { p[0] = q.x; align = { x: q.x, from: [q.x, q.y] }; }
      if (!guides.includes("h") && Math.abs(raw[1] - q.y) < tol * 0.5) { p[1] = q.y; align = { ...(align || {}), y: q.y, fromY: [q.x, q.y] }; }
    }
    return { p, kind: g > 0 && this.snapOn ? "grid" : "free", guides, align };
  }

  // body points on this sketch's plane (cached briefly; bodies don't change while drawing)
  bodySnapPts() {
    const scene = this.app.scene, key = JSON.stringify(this.sketch.plane) + "|" + [...scene.views.values()].map((v) => v.dataVer).join(",");
    if (this._bsp && this._bsp.key === key && performance.now() - this._bsp.t < 2000) return this._bsp.pts;
    const out = [], tol = 1e-3 * Math.max(1, this.px()), tmp = new THREE.Vector3();
    const local = (L, i, m) => tmp.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(m).applyMatrix4(this.inv).clone();
    for (const v of scene.views.values()) {
      if (!v.data || !v.data.edgeGroups || !v.group || !v.group.visible || (v.body && v.body.hidden)) continue;
      v.group.updateMatrixWorld(true);
      const m = v.group.matrixWorld, L = v.data.lines;
      for (const [s, c] of v.data.edgeGroups) {
        if (c < 2 || c > 2000) continue;
        const a = local(L, s, m), b = local(L, s + c - 1, m);
        const onA = Math.abs(a.z) < tol, onB = Math.abs(b.z) < tol;
        if (onA) out.push({ p: [a.x, a.y], kind: "corner", pr: 5 });
        if (onB) out.push({ p: [b.x, b.y], kind: "corner", pr: 5 });
        if (c === 2 && onA && onB) out.push({ p: [(a.x + b.x) / 2, (a.y + b.y) / 2], kind: "mid", pr: 3 });
        // a closed round edge (a hole or a cylinder's rim) on the plane: its center
        if (c > 6 && a.distanceTo(b) < 1e-6) {
          let x = 0, y = 0, z = 0;
          for (let i = s; i < s + c - 1; i++) { const q = local(L, i, m); x += q.x; y += q.y; z = Math.max(z, Math.abs(q.z)); }
          if (z < tol) out.push({ p: [x / (c - 1), y / (c - 1)], kind: "center", pr: 4 });
        }
      }
    }
    this._bsp = { key, pts: out, t: performance.now() };
    return out;
  }
  // ------------------------------------------------------------ grid
  // The visible grid spacing: the snap size, or a multiple of it when zoomed out,
  // so grid lines never get closer than ~12 px. Sketch points snap to it.
  gridSpacing() {
    const inch = getUnit() === "in";
    const base = this.app.gridStep() || +document.getElementById("snap").value || (inch ? 25.4 / 16 : 1);
    const pxPerMm = 1 / Math.max(1e-9, this.px());
    for (const m of inch ? [1, 2, 4, 8, 16, 32, 64, 160, 320, 800, 1600] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (base * m * pxPerMm >= 12) return base * m;
    return base * 10000;
  }
  snapStep() { return this.app.snapOn ? this.gridSpacing() : 0; }
  clearGrid() {
    for (const c of [...this.gridGroup.children]) { this.gridGroup.remove(c); c.geometry.dispose(); c.material.dispose(); }
    this.gridKey = "";
  }
  ensureGrid() {
    const sk = this.active && this.sketch;
    if (!sk) return;
    const step = this.gridSpacing();
    // centre the grid on the part of the plane you're looking at
    const c = this.plane.projectPoint(this.vp.view.target, new THREE.Vector3()).applyMatrix4(this.inv);
    const major = step * 10;
    const ext = Math.ceil((this.px() * Math.max(this.vp.w, this.vp.h) * 0.8) / major) * major;
    const cx = Math.round(c.x / major) * major, cy = Math.round(c.y / major) * major;
    const key = [step, cx, cy, ext, theme.name, this.app.snapOn].join("|");
    if (key === this.gridKey) return;
    this.clearGrid();
    this.gridKey = key;
    this.gridGroup.matrix.copy(this.mat);
    this.gridGroup.matrixWorldNeedsUpdate = true;
    const minor = [], maj = [];
    const n = Math.round(ext / step);
    for (let i = -n; i <= n; i++) {
      const x = cx + i * step, y = cy + i * step;
      const arr = Math.round(x / step) % 10 === 0 ? maj : minor;
      arr.push(x, cy - ext, 0, x, cy + ext, 0);
      const arr2 = Math.round(y / step) % 10 === 0 ? maj : minor;
      arr2.push(cx - ext, y, 0, cx + ext, y, 0);
    }
    const T = this.vp.gridStyle === "workplane" ? theme.c.wp : theme.c.lines;
    const mk = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      l.renderOrder = 1;
      this.gridGroup.add(l);
    };
    mk(minor, T.minor, this.app.snapOn ? 0.9 : 0.45);
    mk(maj, T.major, 1);
  }
  // live X / Y readout next to the cursor
  showCoord() {
    const cur = this.cursor;
    if (!cur || !this.cursorPx || !this.input.root.hidden) { this.coord.hidden = true; return; }
    const p = this.applyTyped(cur.p);
    const step = this.snapStep();
    const dp = step && step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 1;
    this.coord.hidden = false;
    const SNAP_NAMES = { point: "Point", origin: "Origin", "face center": "Face center", center: "Center", mid: "Midpoint", quad: "Quadrant", int: "Intersection", on: "On curve" };
    const what = SNAP_NAMES[cur.kind];
    const ddp = getUnit() === "in" ? 3 : dp;
    this.coord.textContent = (what ? what + " · " : "") + `${skDisp(p[0], ddp)}, ${skDisp(p[1], ddp)} ${getUnit()}`;
    this.coord.classList.toggle("snapped", !!what);
    this.coord.style.transform = `translate(${this.cursorPx[0] + 16}px, ${this.cursorPx[1] - 22}px)`;
  }

  // ------------------------------------------------------------ input box
  makeInput() {
    const root = el("div", { class: "sk-input", hidden: true });
    const fields = [0, 1].map((i) => {
      const lab = el("label", { class: "sk-f" });
      const name = el("span");
      const inp = el("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", id: "sk-field-" + i });
      lab.append(name, inp);
      root.append(lab);
      inp.addEventListener("keydown", (e) => this.inputKey(e, i));
      inp.addEventListener("input", () => { this.locked[i] = inp.value.trim() !== ""; this.preview(); });
      return { lab, name, inp };
    });
    const ok = el("button", { class: "sk-ok", type: "button", "aria-label": "Use these values", title: "Use these values (Enter)" }, "✓");
    ok.addEventListener("pointerdown", (e) => e.preventDefault());
    ok.addEventListener("click", () => { for (let i = 0; i < 2; i++) if (fields[i].inp.value.trim()) this.locked[i] = true; this.commitTyped(); });
    root.append(ok);
    this.locked = [false, false];
    return { root, fields };
  }
  showInput(names, values, at) {
    const f = this.input.fields;
    values = values.map((v, i) => (getUnit() === "in" && names[i] && /Length|Width|Height|Diameter|Radius/.test(names[i]) && v !== "" && v != null && isFinite(parseFloat(v)) ? skDisp(parseFloat(v)) : v));
    this.input.root.hidden = false;
    names.forEach((n, i) => {
      f[i].lab.hidden = false;
      f[i].name.textContent = n;
      if (!this.locked[i] && document.activeElement !== f[i].inp) f[i].inp.value = values[i] ?? "";
      if (!this.locked[i]) f[i].inp.placeholder = values[i] ?? "";
    });
    for (let i = names.length; i < 2; i++) f[i].lab.hidden = true;
    if (at) {
      const off = this.vp.touchMode ? 34 : 18;
      const x = Math.max(4, Math.min(at[0] + off, this.vp.w - 250)), y = Math.max(4, Math.min(at[1] + off, this.vp.h - 70));
      this.input.root.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
  hideInput() {
    this.input.root.hidden = true;
    this.locked = [false, false];
    for (const f of this.input.fields) { f.inp.value = ""; }
    if (this.input.root.contains(document.activeElement)) this.vp.canvas.focus();
  }
  fieldVal(i) {
    if (!this.locked[i]) return null;
    const isAngle = /Angle|Sweep/.test(this.input.fields[i].name.textContent);
    const v = parseLength(this.input.fields[i].inp.value, isAngle ? "mm" : getUnit());
    return isFinite(v) ? v * (isAngle ? 1 : 1) : null;
  }
  inputKey(e, i) {
    if (e.key === "Tab") {
      e.preventDefault();
      const n = this.input.fields.filter((f) => !f.lab.hidden).length;
      const j = (i + (e.shiftKey ? -1 : 1) + n) % n;
      if (this.input.fields[i].inp.value.trim()) this.locked[i] = true;
      this.input.fields[j].inp.focus();
      this.input.fields[j].inp.select();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.commitTyped();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.escape();
    } else if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey) {
      // E goes on to Extrude even while a value is being typed (any typed value is used first)
      e.preventDefault();
      if (this.input.fields.some((f) => f.inp.value.trim())) this.commitTyped();
      this.app.quickExtrude();
    }
    e.stopPropagation();
  }
  // typing a digit while drawing jumps into the first field
  typeKey(e) {
    if (this.input.root.hidden) return false;
    if (/^[0-9.\-]$/.test(e.key)) {
      const f = this.input.fields[0].inp;
      f.focus();
      f.value = "";
      return false; // let the key go into the field
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this.input.fields[0].inp.focus();
      this.input.fields[0].inp.select();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ events
  down(e) {
    const sk = this.sketch;
    if (!sk) return false;
    const raw = this.to2d(e);
    if (!raw) return false;
    this.cursorPx = this.vp.local(e);
    const t = this.tool;
    if (t === "select") return this.selectDown(e, raw);
    if (t === "trim") { this.doTrim(raw); return true; }
    if (t === "dim") { this.dimClick(raw, e); return true; }
    if (t.startsWith("c-")) { this.constraintPick(this.pickEnt(raw)); return true; }
    const s = this.snap(raw, this.state && this.state.anchor);
    this.click(s, e);
    return true;
  }
  move(e) {
    if (!this.sketch) return;
    const raw = this.to2d(e);
    if (!raw) return;
    this.cursorPx = this.vp.local(e);
    this.rawCursor = raw;
    if (this.drag) return this.dragMove(raw, e);
    if (this.tool === "select" || this.tool === "trim" || this.tool === "dim" || this.tool.startsWith("c-")) {
      this.hover = this.pickEnt(raw);
      this.cursor = null;
      // the dimension being placed follows the pointer
      if (this.tool === "dim") this.dimPreview = this.dimPicks && this.dimPicks.length ? buildDim(this.sketch, this.dimPicks, raw) : null;
      this.redraw();
      return;
    }
    this.cursor = this.snap(raw, this.state && this.state.anchor);
    this.showCoord();
    this.preview();
  }
  up() {
    if (this.drag) this.dragEnd();
  }

  pickEnt(raw) {
    const sk = this.sketch;
    const tol = this.vp.tol(7) * this.px();
    let best = null, bd = tol;
    for (const c of resolveSketch(sk)) {
      const d = distToCurve(c, raw);
      if (d < bd) { bd = d; best = c.id; }
    }
    // points take priority in select mode and for point constraints
    if (this.tool === "select" || this.tool === "dim" || this.tool === "c-coincident" || this.tool === "c-horizontal" || this.tool === "c-vertical" || this.tool === "c-midpoint") {
      const already = new Set((this.cpicks || []).map((k) => k.pid).filter(Boolean));
      for (const p of sk.pts) if (Math.hypot(p.x - raw[0], p.y - raw[1]) < tol && !sk.ents.some((e) => e.t === "text" && e.p === p.id) && !(this.tool === "c-coincident" && already.has(p.id) && Math.hypot(raw[0], raw[1]) < tol)) return "pt:" + p.id;
    }
    // the sketch origin can be picked to pin a point on it (Coincident)
    if (this.tool === "c-coincident" && Math.hypot(raw[0], raw[1]) < tol) return "origin";
    if (best) return best;
    // texts: anywhere inside their bounds
    for (const t of sketchTexts(sk)) {
      const b = textBounds(t.spec);
      if (raw[0] > b.minX - tol && raw[0] < b.maxX + tol && raw[1] > b.minY - tol && raw[1] < b.maxY + tol) return t.id;
    }
    return null;
  }

  // ------------------------------------------------------------ tool clicks
  click(s, e) {
    const t = this.tool;
    const st = this.state;
    const p = this.applyTyped(s.p);
    if (t === "point") {
      this.edit("Sketch point", (sk) => { const id = addPt(sk, p); sk.ents.push({ id: uid("e"), t: "point", p: id }); });
      return;
    }
    if (t === "text") {
      // drop a text at the click (left end of its baseline), then edit it in the palette
      const id = uid("e");
      this.edit("Text", (sk) => { const pid = addPt(sk, p); sk.ents.push({ id, t: "text", p: pid, str: "Text", size: 10, angle: 0, font: "sans" }); });
      this.setTool("select");
      this.sel = new Set([id]);
      this.redraw();
      this.app.onSketchSelection && this.app.onSketchSelection();
      setTimeout(() => { const f = document.getElementById("pal-text"); if (f) { f.focus(); f.select(); } }, 30);
      return;
    }
    if (t === "spline") {
      // click fit points; click the first point to close, double-click / Enter / Esc to finish
      if (!st) {
        this.state = { anchor: p, start: p, fit: [p], pids: [s.pid || null], step: 1 };
        this.preview();
        return;
      }
      const last = st.fit[st.fit.length - 1];
      if (st.fit.length >= 3 && d2(p, st.fit[0]) < 1e-6) { st.closed = true; this.finishSpline(); this.setTool("select"); return; }
      if (d2(p, last) < 1e-6) return this.finishSpline();
      st.fit.push(p); st.pids.push(s.pid || null); st.anchor = p;
      this.preview();
      return;
    }
    if (!st) {
      // first click
      this.state = { anchor: s.p, start: s.p, startPid: s.pid || null, lastPid: s.pid || null, step: 1, chainStart: s.p };
      this.locked = [false, false];
      for (const f of this.input.fields) f.inp.value = "";
      this.preview();
      return;
    }
    if (t === "line") {
      if (d2(st.anchor, p) < 1e-6) return;
      const closes = st.chainStart && d2(p, st.chainStart) < 1e-6 && st.segs > 0;
      this.edit("Line", (sk) => {
        const a = st.lastPid && sk.pts.find((q) => q.id === st.lastPid) ? st.lastPid : addPt(sk, st.anchor);
        const b = addPt(sk, p);
        sk.ents.push({ id: uid("e"), t: "line", a, b });
        st.lastPid = b;
      });
      st.segs = (st.segs || 0) + 1;
      if (closes) { this.state = null; this.hideInput(); this.redraw(); return; }
      st.anchor = p;
      this.locked = [false, false];
      for (const f of this.input.fields) f.inp.value = "";
      this.vp.canvas.focus();
      this.preview();
      return;
    }
    if (t === "rect3") {
      // 1st click: corner, 2nd: end of the first side, 3rd: how wide
      if (st.step === 1) {
        if (d2(st.start, p) < 1e-6) return;
        st.end = p; st.step = 2; st.anchor = null;
        this.locked = [false, false];
        for (const f of this.input.fields) f.inp.value = "";
        this.preview();
        return;
      }
      const q = this.rect3Corners(st, p);
      if (!q) return;
      this.edit("Rectangle", (sk) => {
        const ids = q.map((c) => addPt(sk, c));
        const L = [0, 1, 2, 3].map((i) => { const e = { id: uid("e"), t: "line", a: ids[i], b: ids[(i + 1) % 4] }; sk.ents.push(e); return e.id; });
        // square corners and opposite sides parallel, at any angle (like Fusion)
        sk.cons = sk.cons || [];
        sk.cons.push({ id: uid("k"), t: "perpendicular", e1: L[0], e2: L[1] }, { id: uid("k"), t: "parallel", e1: L[0], e2: L[2] }, { id: uid("k"), t: "parallel", e1: L[1], e2: L[3] });
      });
      return this.done();
    }
    if (t === "rect" || t === "rectc") {
      const [a, b] = this.rectCorners(st.start, p);
      if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return;
      const centered = t === "rectc", center = st.start;
      this.edit("Rectangle", (sk) => {
        const ids = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map((q) => addPt(sk, q));
        const L = [0, 1, 2, 3].map((i) => { const e = { id: uid("e"), t: "line", a: ids[i], b: ids[(i + 1) % 4] }; sk.ents.push(e); return e.id; });
        // sides stay horizontal and vertical, so the corners stay square (like Fusion)
        sk.cons = sk.cons || [];
        L.forEach((id, i) => sk.cons.push({ id: uid("k"), t: i % 2 ? "vertical" : "horizontal", e1: id }));
        if (centered) {
          // a center rectangle keeps its center: a construction diagonal with the center point at its middle
          const diag = { id: uid("e"), t: "line", a: ids[0], b: ids[2], cons: true };
          sk.ents.push(diag);
          const cp = addPt(sk, center);
          sk.ents.push({ id: uid("e"), t: "point", p: cp });
          sk.cons.push({ id: uid("k"), t: "midpoint", p: cp, e: diag.id });
        }
      });
      return this.done();
    }
    if (t === "circle") {
      const r = this.circleR(st.start, p);
      if (r < 1e-6) return;
      this.edit("Circle", (sk) => sk.ents.push({ id: uid("e"), t: "circle", c: addPt(sk, st.start), r }));
      return this.done();
    }
    if (t === "polygon") {
      const pts = this.polyPts(st.start, p);
      if (!pts) return;
      this.edit("Polygon", (sk) => {
        const ids = pts.map((q) => addPt(sk, q));
        for (let i = 0; i < ids.length; i++) sk.ents.push({ id: uid("e"), t: "line", a: ids[i], b: ids[(i + 1) % ids.length] });
      });
      return this.done();
    }
    if (t === "arc3") {
      if (st.step === 1) { if (d2(st.start, p) < 1e-6) return; st.end = p; st.step = 2; st.anchor = null; this.preview(); return; }
      const arc = arcFrom3(st.start, st.end, p);
      if (!arc) return;
      this.edit("Arc", (sk) => {
        const c = addPt(sk, arc.c);
        const a = addPt(sk, arc.ccw ? st.start : st.end), b = addPt(sk, arc.ccw ? st.end : st.start);
        sk.ents.push({ id: uid("e"), t: "arc", c, a, b });
      });
      return this.done();
    }
    if (t === "arcc") {
      if (st.step === 1) {
        if (d2(st.start, p) < 1e-6) return;
        st.a = p; st.step = 2; st.anchor = null;
        this.locked = [false, false];
        this.preview();
        return;
      }
      const end = this.arcEnd(st, p);
      this.edit("Arc", (sk) => {
        const c = addPt(sk, st.start), a = addPt(sk, st.a), b = addPt(sk, end);
        sk.ents.push({ id: uid("e"), t: "arc", c, a, b });
      });
      return this.done();
    }
  }
  done() {
    this.state = null;
    this.hideInput();
    this.vp.canvas.focus();
    this.redraw();
    this.app.status && this.app.status();
  }
  finishChain() {
    if (this.tool === "line" && this.state) this.done();
    if (this.tool === "spline" && this.state) this.finishSpline();
  }
  finishSpline() {
    const st = this.state;
    if (st && st.fit && st.fit.length >= 2) {
      const closed = !!st.closed && st.fit.length >= 3;
      this.edit("Spline", (sk) => {
        const ids = st.fit.map((q, i) => (st.pids[i] && sk.pts.some((x) => x.id === st.pids[i]) ? st.pids[i] : addPt(sk, q)));
        sk.ents.push({ id: uid("e"), t: "spline", pts: ids, closed });
      });
    }
    this.done();
  }
  escape() {
    if (this.dimPicks && this.dimPicks.length) { this.dimPicks = []; this.dimPreview = null; this.redraw(); return true; }
    if (this.state && this.tool === "spline") { this.finishSpline(); return true; }
    if (this.state) { this.done(); return true; }
    if (this.sel.size) { this.sel.clear(); this.redraw(); this.app.onSketchSelection && this.app.onSketchSelection(); return true; }
    if (this.tool !== "select") { this.setTool("select"); return true; }
    return false;
  }

  // typed value overrides for the second point
  applyTyped(p) {
    const st = this.state;
    if (!st) return p;
    const t = this.tool;
    const v0 = this.fieldVal(0), v1 = this.fieldVal(1);
    if (t === "line") {
      const a = st.anchor;
      let L = d2(a, p), ang = Math.atan2(p[1] - a[1], p[0] - a[0]);
      if (v0 != null) L = v0;
      if (v1 != null) ang = v1 * DEG;
      return [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)];
    }
    if (t === "rect3" && st.step === 1) {
      const a = st.start;
      let L = d2(a, p), ang = Math.atan2(p[1] - a[1], p[0] - a[0]);
      if (v0 != null) L = v0;
      if (v1 != null) ang = v1 * DEG;
      return [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)];
    }
    if (t === "rect3" && st.step === 2 && v0 != null) {
      const n = this.rect3Normal(st);
      if (!n) return p;
      const side = (p[0] - st.start[0]) * n[0] + (p[1] - st.start[1]) * n[1] >= 0 ? 1 : -1;
      return [st.end[0] + n[0] * v0 * side, st.end[1] + n[1] * v0 * side];
    }
    if (t === "rect") {
      const sx = Math.sign(p[0] - st.start[0]) || 1, sy = Math.sign(p[1] - st.start[1]) || 1;
      return [v0 != null ? st.start[0] + sx * v0 : p[0], v1 != null ? st.start[1] + sy * v1 : p[1]];
    }
    if (t === "rectc") {
      return [v0 != null ? st.start[0] + v0 / 2 : p[0], v1 != null ? st.start[1] + v1 / 2 : p[1]];
    }
    if (t === "circle" && v0 != null) {
      const ang = Math.atan2(p[1] - st.start[1], p[0] - st.start[0]) || 0;
      return [st.start[0] + (v0 / 2) * Math.cos(ang), st.start[1] + (v0 / 2) * Math.sin(ang)];
    }
    if (t === "polygon" && v0 != null) {
      const ang = Math.atan2(p[1] - st.start[1], p[0] - st.start[0]) || Math.PI / 2;
      return [st.start[0] + v0 * Math.cos(ang), st.start[1] + v0 * Math.sin(ang)];
    }
    if (t === "arcc" && st.step === 1 && v0 != null) {
      const ang = Math.atan2(p[1] - st.start[1], p[0] - st.start[0]) || 0;
      return [st.start[0] + v0 * Math.cos(ang), st.start[1] + v0 * Math.sin(ang)];
    }
    return p;
  }
  commitTyped() {
    if (!this.state) return;
    if (this.tool === "spline") return this.finishSpline();
    const p = this.cursor ? this.cursor.p : this.state.anchor || this.state.start;
    this.click({ p }, null);
  }
  rect3Normal(st) {
    const dx = st.end[0] - st.start[0], dy = st.end[1] - st.start[1], L = Math.hypot(dx, dy);
    return L > 1e-9 ? [-dy / L, dx / L] : null;
  }
  // corners of a 3-point rectangle: first side start→end, width from the third point
  rect3Corners(st, p) {
    const n = this.rect3Normal(st);
    if (!n) return null;
    const h = (p[0] - st.end[0]) * n[0] + (p[1] - st.end[1]) * n[1];
    if (Math.abs(h) < 1e-6) return null;
    const a = st.start, b = st.end;
    return [a, b, [b[0] + n[0] * h, b[1] + n[1] * h], [a[0] + n[0] * h, a[1] + n[1] * h]];
  }
  rectCorners(s, p) {
    if (this.tool === "rectc") return [[2 * s[0] - p[0], 2 * s[1] - p[1]], p];
    return [s, p];
  }
  circleR(c, p) { return d2(c, p); }
  polyPts(c, p) {
    const r = d2(c, p);
    if (r < 1e-6) return null;
    const n = Math.max(3, Math.min(64, Math.round(this.fieldVal(1) ?? this.polySides)));
    this.polySides = n;
    const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([c[0] + r * Math.cos(a0 + (i / n) * Math.PI * 2), c[1] + r * Math.sin(a0 + (i / n) * Math.PI * 2)]);
    return pts;
  }
  arcEnd(st, p) {
    const c = st.start, r = d2(c, st.a);
    const a0 = Math.atan2(st.a[1] - c[1], st.a[0] - c[0]);
    let ang = Math.atan2(p[1] - c[1], p[0] - c[0]);
    const sweep = this.fieldVal(1);
    if (sweep != null) ang = a0 + sweep * DEG;
    return [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
  }

  edit(label, fn) {
    const id = this.active;
    // drawing something new: points dropped on the origin or a line's middle stay there
    const drawing = /^(Line|Rectangle|Circle|Arc|Polygon|Spline|Sketch point|Slot|Ellipse)$/.test(label);
    // closed shapes before this edit (so a newly closed one can be told apart)
    const sk0 = drawing && this.app.onShapeClosed ? findSketch(store.doc, id) : null;
    const before = sk0 ? { loops: new Set(userLoops(sk0).map((l) => l.key)), regs: new Set(regionsFor(sk0).map((r) => r.key)) } : null;
    store.update((doc) => {
      const sk = findSketch(doc, id);
      const oldPts = drawing ? new Set(sk.pts.map((q) => q.id)) : null, oldEnts = drawing ? new Set(sk.ents.map((e) => e.id)) : null;
      fn(sk);
      if (drawing) autoConstrain(sk, oldPts, oldEnts);
      pruneConstraints(sk);
      solveSketch(sk, this.keepPts || new Set());
      normalizeSketch(sk);
    }, label);
    if (before) {
      const sk1 = findSketch(store.doc, id);
      if (sk1) {
        // the shapes you just closed (drawn lines only), and every profile inside them
        const loops = new Set(userLoops(sk1).filter((l) => !before.loops.has(l.key)).map((l) => "u:" + l.key));
        const regs = regionsFor(sk1), own = regionOwners(sk1);
        const fresh = regs.filter((r, i) => loops.has(own[i])).map((r) => r.key);
        // (a line that closes a profile only together with a face's outline: Extrude opens, nothing picked)
        if (fresh.length || regs.some((r) => !before.regs.has(r.key))) this.app.onShapeClosed(id, fresh);
      }
    }
  }

  // ------------------------------------------------------------ select & drag
  selectDown(e, raw) {
    const hit = this.pickEnt(raw);
    if (!hit) {
      if (!e.shiftKey) this.sel.clear();
      this.redraw();
      this.app.onSketchSelection && this.app.onSketchSelection();
      return true;
    }
    if (e.shiftKey) { this.sel.has(hit) ? this.sel.delete(hit) : this.sel.add(hit); }
    else if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
    this.app.onSketchSelection && this.app.onSketchSelection();
    // start drag
    const sk = this.sketch;
    let pids = [];
    if (hit.startsWith("pt:")) pids = [hit.slice(3)];
    else {
      const ent = sk.ents.find((x) => x.id === hit);
      if (ent && !ent.proj) pids = entPts(ent);
      if (ent && ent.t === "arc") pids = [ent.c, ent.a, ent.b];
    }
    if (pids.some((pid) => sk.ents.some((x) => x.proj && entPts(x).includes(pid)))) pids = [];
    this.drag = { start: raw, pids, orig: new Map(sk.pts.filter((p) => pids.includes(p.id)).map((p) => [p.id, [p.x, p.y]])), moved: false, hit, add: e.shiftKey };
    this.redraw();
    return true;
  }
  dragMove(raw) {
    const d = this.drag;
    if (!d.pids.length) return;
    let delta;
    if (d.pids.length === 1) {
      const s = this.snap(raw, null, { exclude: new Set(d.pids) });
      const o = d.orig.get(d.pids[0]);
      delta = [s.p[0] - o[0], s.p[1] - o[1]];
      this.cursor = s;
    } else {
      const g = this.snapStep();
      delta = [round(raw[0] - d.start[0], g), round(raw[1] - d.start[1], g)];
    }
    if (Math.hypot(...delta) > 0) d.moved = true;
    const id = this.active;
    store.setPreview((doc) => {
      const sk = findSketch(doc, id);
      for (const p of sk.pts) if (d.orig.has(p.id)) { const o = d.orig.get(p.id); p.x = o[0] + delta[0]; p.y = o[1] + delta[1]; }
      solveSketch(sk, new Set(d.pids));
      normalizeSketch(sk);
    });
    this.redraw();
  }
  dragEnd() {
    const d = this.drag;
    this.drag = null;
    this.cursor = null;
    if (d.moved) store.commitPreview("Move sketch geometry");
    else store.setPreview(null);
    this.redraw();
    // a plain click on a line, circle or arc: type its size right there
    if (!d.moved && d.hit && !d.add && !d.hit.startsWith("pt:")) setTimeout(() => this.quickSize(d.hit, d.start), 30);
  }
  // Fusion-style quick sizing: the clicked shape's size (a line's length, a circle's diameter, an
  // arc's radius) appears in a box. The typed value becomes a sketch dimension that drives the
  // shape; nothing changes until a value is entered. A shape that already has a dimension just
  // edits that one.
  quickSize(id, at) {
    const sk = this.sketch;
    if (!sk || this.tool !== "select") return;
    const kind = pickKind(sk, id);
    if (!kind || (kind.kind !== "line" && kind.kind !== "round") || kind.e.proj || kind.e.t === "text" || kind.e.t === "spline") return;
    const e = kind.e;
    const ex = (sk.cons || []).find((c) => c.t === "dim" && (kind.kind === "line"
      ? c.k === "dist" && ((c.p1 === e.a && c.p2 === e.b) || (c.p1 === e.b && c.p2 === e.a))
      : (c.k === "dia" || c.k === "rad") && c.e1 === e.id));
    if (ex) { this.editDim(ex.id); return; }
    let off = at.slice();
    if (kind.kind === "line") {
      const P = new Map(sk.pts.map((q) => [q.id, [q.x, q.y]])), a = P.get(e.a), b = P.get(e.b);
      if (a && b) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, g = 14 * this.px();
        off = [mx + nx * g, my + ny * g];
      }
    }
    const d = buildDim(sk, [kind], off);
    if (!d) return;
    const lp = this.vp.project(new THREE.Vector3(off[0], off[1], 0).applyMatrix4(this.mat));
    this.app.promptValue({
      at: [lp[0] - 20, lp[1] - 30],
      label: d.k === "dia" ? `Diameter (${getUnit()})` : d.k === "rad" ? `Radius (${getUnit()})` : `Length (${getUnit()})`,
      value: skDisp(d.v, 3),
      unit: getUnit(),
      onOk: (v) => {
        if (!(v > 0)) { this.app.toast && this.app.toast("Use a size above 0."); return; }
        const did = "dm" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.edit("Dimension", (s2) => { s2.cons = s2.cons || []; s2.cons.push({ id: did, ...d, v }); });
        this.redraw();
        const now = this.sketch && (this.sketch.cons || []).find((x) => x.id === did);
        if (now && Math.abs(measureDim(this.sketch, now) - v) > Math.max(1e-3, v * 1e-3)) this.app.toast && this.app.toast("The sketch couldn't fully reach that size: other dimensions or constraints are holding it.");
      },
    });
  }
  // ------------------------------------------------------------ constraints
  constraintPick(id) {
    const type = this.tool.slice(2), sk = this.sketch;
    const k = pickKind(sk, id);
    if (!k) return;
    const picks = [...(this.cpicks || []), k];
    const w = wants(type, picks);
    if (w === "bad") {
      // start over with this pick if it can begin the constraint
      if (picks.length > 1 && wants(type, [k]) !== "bad") { this.cpicks = [k]; this.sel = new Set([id]); }
      else { this.cpicks = []; this.sel.clear(); this.app.toast && this.app.toast(`${CONSTRAINTS[type].label}: pick ${CONSTRAINTS[type].picks.toLowerCase()}.`); }
      this.redraw();
      return;
    }
    if (w === "more") { this.cpicks = picks; this.sel.add(id); this.redraw(); return; }
    this.applyConstraint(type, picks);
    this.cpicks = []; this.sel.clear(); this.redraw();
  }
  applyConstraint(type, picks) {
    let msg = null;
    this.edit(CONSTRAINTS[type].label + " constraint", (sk) => {
      // picks hold entities from the shown sketch; use this copy's
      const local = picks.map((p) => (p.e ? { ...p, e: sk.ents.find((x) => x.id === p.e.id) } : p));
      msg = addConstraint(sk, type, local);
    });
    if (msg && this.app.toast) this.app.toast(msg);
  }
  // little badges showing each constraint; click one to select it (Delete removes it)
  drawGlyphs(force) {
    const sk = this.sketch;
    this.selCons = this.selCons || new Set();
    const spots = sk && sk.cons ? glyphSpots(sk) : [];
    const sig = JSON.stringify(spots.map((q) => [q.c.id, q.at.map((v) => +v.toFixed(4))])) + [...this.selCons].join();
    if (!force && sig === this.glyphSig) return;
    this.glyphSig = sig;
    for (const g of this.glyphEls || []) g.remove();
    this.glyphEls = [];
    if (!spots.length) return;
    const seen = new Map();
    for (const s2 of spots) {
      const key = s2.at.map((v) => Math.round(v * 10)).join(",");
      const nth = seen.get(key) || 0; seen.set(key, nth + 1);
      const d = el("button", { class: "cglyph" + (this.selCons.has(s2.c.id) ? " on" : ""), title: CONSTRAINT_BADGES[s2.c.t].label + " (click, then Delete to remove)", "aria-label": CONSTRAINT_BADGES[s2.c.t].label + " constraint" }, s2.g);
      d.onpointerdown = (e) => e.stopPropagation();
      d.onclick = (e) => { e.stopPropagation(); this.selCons.has(s2.c.id) ? this.selCons.delete(s2.c.id) : this.selCons.add(s2.c.id); this.drawGlyphs(true); };
      d._at = s2.at; d._nth = nth;
      this.vp.labels.append(d);
      this.glyphEls.push(d);
    }
    this.placeGlyphs();
  }
  placeGlyphs() {
    if (this.mat) for (const d of this.dimEls || []) {
      const p = this.vp.project(new THREE.Vector3(d._at[0], d._at[1], 0).applyMatrix4(this.mat));
      d.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px) translate(-50%, -50%)`;
    }
    if (!this.glyphEls || !this.glyphEls.length || !this.mat) return;
    for (const d of this.glyphEls) {
      const s2 = this.vp.project(new THREE.Vector3(d._at[0], d._at[1], 0).applyMatrix4(this.mat));
      d.style.transform = `translate(${s2[0] + 10 + d._nth * 15}px, ${s2[1] - 18}px)`;
    }
  }
  deleteSelection() {
    if (this.selCons && this.selCons.size) {
      const ids = new Set(this.selCons);
      this.edit("Delete constraint", (sk) => { sk.cons = (sk.cons || []).filter((c) => !ids.has(c.id)); });
      this.selCons.clear();
      this.redraw();
      return true;
    }
    if (!this.sel.size) return false;
    const ids = new Set(this.sel);
    this.edit("Delete sketch geometry", (sk) => {
      const ptIds = new Set([...ids].filter((s) => s.startsWith("pt:")).map((s) => s.slice(3)));
      // a deleted fit point just leaves the spline (if it still has two points)
      for (const e of sk.ents) if (e.t === "spline" && e.pts.some((p) => ptIds.has(p))) {
        const left = e.pts.filter((p) => !ptIds.has(p));
        if (left.length >= 2) e.pts = left;
      }
      sk.ents = sk.ents.filter((e) => !ids.has(e.id) && !entPts(e).some((p) => ptIds.has(p)));
      pruneOrphans(sk);
    });
    this.sel.clear();
    this.app.onSketchSelection && this.app.onSketchSelection();
    this.redraw();
    return true;
  }
  toggleConstruction() {
    const ids = [...this.sel].filter((s) => !s.startsWith("pt:"));
    if (!ids.length) return;
    this.edit("Construction", (sk) => {
      for (const e of sk.ents) if (ids.includes(e.id) && !e.proj) e.cons = !e.cons;
    });
    this.redraw();
  }

  // ------------------------------------------------------------ trim / dimension
  doTrim(raw) {
    const hit = this.pickEnt(raw);
    if (!hit || hit.startsWith("pt:")) return;
    const sk = this.sketch;
    const ent = sk.ents.find((e) => e.id === hit);
    if (!ent || ent.proj) return;
    const curves = resolveSketch(sk).filter((c) => !c.cons || c.id === hit);
    const span = trimSpan(curves, hit, raw);
    if (!span) return;
    this.edit("Trim", (sk2) => {
      const e = sk2.ents.find((x) => x.id === hit);
      const idx = sk2.ents.indexOf(e);
      const keep = [];
      const c = span.c;
      if (span.whole) { /* remove entire curve */ }
      else if (c.t === "spline") {
        // keep the parts outside the trimmed span, through the original fit points
        const n = c.n, ids = e.pts, near = (x, y) => Math.abs(x - y) < 1e-6;
        const part = (from, to, wrap) => {
          const out = [];
          out.push(addPt(sk2, curvePoint(c, from)));
          void near;
          const idx = [];
          if (!wrap) for (let i = Math.ceil(from + 1e-6); i < to - 1e-6; i++) idx.push(i);
          else { for (let i = Math.ceil(from + 1e-6); i < n; i++) idx.push(i); for (let i = 0; i < to - 1e-6; i++) idx.push(i); }
          for (const i of idx) out.push(ids[i % ids.length]);
          out.push(addPt(sk2, curvePoint(c, to)));
          return [...new Set(out)];
        };
        if (c.closed) { const pts = part(span.hi, span.lo, true); if (pts.length >= 2) keep.push({ id: uid("e"), t: "spline", pts, cons: e.cons }); }
        else {
          if (span.lo > 1e-7) { const pts = [ids[0], ...part(0, span.lo, false).slice(1)]; if (pts.length >= 2) keep.push({ id: uid("e"), t: "spline", pts: [...new Set(pts)], cons: e.cons }); }
          if (span.hi < n - 1e-7) { const pts = part(span.hi, n, false); pts[pts.length - 1] = ids[ids.length - 1]; if (pts.length >= 2) keep.push({ id: uid("e"), t: "spline", pts: [...new Set(pts)], cons: e.cons }); }
        }
      } else if (c.t === "line") {
        if (span.lo > 1e-7) keep.push({ id: uid("e"), t: "line", a: e.a, b: addPt(sk2, curvePoint(c, span.lo)), cons: e.cons });
        if (span.hi < 1 - 1e-7) keep.push({ id: uid("e"), t: "line", a: addPt(sk2, curvePoint(c, span.hi)), b: e.b, cons: e.cons });
      } else if (c.t === "circle") {
        // remaining arc goes from hi around to lo
        keep.push({ id: uid("e"), t: "arc", c: e.c, a: addPt(sk2, curvePoint(c, span.hi)), b: addPt(sk2, curvePoint(c, span.lo)), cons: e.cons });
      } else {
        if (span.lo - span.start > 1e-7) keep.push({ id: uid("e"), t: "arc", c: e.c, a: e.a, b: addPt(sk2, curvePoint(c, span.lo)), cons: e.cons });
        if (span.start + span.sweep - span.hi > 1e-7) keep.push({ id: uid("e"), t: "arc", c: e.c, a: addPt(sk2, curvePoint(c, span.hi)), b: e.b, cons: e.cons });
      }
      sk2.ents.splice(idx, 1, ...keep);
      pruneOrphans(sk2);
    });
    this.hover = null;
    this.redraw();
  }
  // ------------------------------------------------------------ dimensions (D), like Fusion
  // Click a line, circle or arc (or two points / lines / round shapes), move to place the
  // dimension, click, then type its value. Dimensions drive the sketch.
  dimClick(raw, e) {
    const sk = this.sketch;
    this.dimPicks = this.dimPicks || [];
    const hit = this.pickEnt(raw);
    const kind = hit ? pickKind(sk, hit) : null;
    const usable = kind && kind.kind !== "other" && !(kind.e && (kind.e.t === "text" || kind.e.t === "spline"));
    if (hit && kind && kind.e && kind.e.t === "spline") { this.app.toast && this.app.toast("Splines are shaped by their points: dimension the points instead."); return; }
    const same = (a, b) => a.kind === b.kind && (a.kind === "pt" ? a.pid === b.pid : a.e.id === b.e.id);
    if (usable && this.dimPicks.length < 2 && !this.dimPicks.some((p) => same(p, kind))) {
      // a second pick joins the first, unless the first is already a complete circle/arc size
      this.dimPicks.push(kind);
      this.dimPreview = buildDim(sk, this.dimPicks, raw);
      this.redraw();
      return;
    }
    if (!this.dimPicks.length) return;
    // a click anywhere else places the dimension
    const d = buildDim(sk, this.dimPicks, raw);
    this.dimPicks = []; this.dimPreview = null;
    if (!d) { this.app.toast && this.app.toast("Those can't be dimensioned together. Pick a line, circle or arc, or two points or lines."); this.redraw(); return; }
    const id = "dm" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.edit("Dimension", (s2) => { s2.cons = s2.cons || []; s2.cons.push({ id, ...d }); });
    this.redraw();
    // after the click has finished (the canvas takes focus on mouse down), ask for the value
    setTimeout(() => this.editDim(id), 60);
  }
  // type a new value for a dimension, at its label
  editDim(id) {
    const sk = this.sketch;
    const c = sk && (sk.cons || []).find((x) => x.id === id);
    if (!c) return;
    const isAng = c.k === "ang";
    const lab = this.dimEls && this.dimEls.find((d) => d._id === id);
    const at = lab ? this.vp.project(new THREE.Vector3(lab._at[0], lab._at[1], 0).applyMatrix4(this.mat)) : this.cursorPx || [100, 100];
    const shown = isAng ? fmt(c.v, 3) : skDisp(c.v, 3);
    this.app.promptValue({
      at: [at[0] - 20, at[1] - 30],
      label: isAng ? "Angle (°)" : c.k === "dia" ? `Diameter (${getUnit()})` : c.k === "rad" ? `Radius (${getUnit()})` : `Distance (${getUnit()})`,
      value: shown,
      unit: isAng ? "mm" : getUnit(),
      onOk: (v) => {
        if (!(v > 0) || (isAng && v >= 180)) { this.app.toast && this.app.toast(isAng ? "Use an angle between 0° and 180°." : "Use a size above 0."); return; }
        this.edit("Edit dimension", (s2) => { const k = (s2.cons || []).find((x) => x.id === id); if (k) k.v = v; });
        this.redraw();
        const now = this.sketch && (this.sketch.cons || []).find((x) => x.id === id);
        if (now && Math.abs(measureDim(this.sketch, now) - v) > Math.max(1e-3, v * 1e-3)) this.app.toast && this.app.toast("The sketch couldn't fully reach that value: other dimensions or constraints are holding it.");
      },
    });
  }
  // what the dimensions look like, plus their labels
  drawDims(px, arr) {
    const sk = this.sketch;
    const list = [];
    const fmtLen = (v) => skDisp(v, 2) + (getUnit() === "in" ? " in" : "");
    for (const c of (sk && sk.cons) || []) {
      if (c.t !== "dim") continue;
      const g = dimGraphics(sk, c, px, fmtLen);
      if (!g) continue;
      arr.push(...g.segs);
      list.push({ id: c.id, at: g.at, text: g.text });
    }
    if (this.dimPreview) {
      const g = dimGraphics(sk, this.dimPreview, px, fmtLen);
      if (g) { arr.preview = g.segs; list.push({ id: "__preview", at: g.at, text: g.text, preview: true }); }
    }
    const sig = JSON.stringify(list.map((d) => [d.id, d.text, (this.selCons || new Set()).has(d.id)]));
    if (sig !== this.dimSig) {
      this.dimSig = sig;
      for (const d of this.dimEls || []) d.remove();
      this.dimEls = list.map((d) => {
        const b = el("button", { class: "dimlabel" + (d.preview ? " preview" : "") + ((this.selCons || new Set()).has(d.id) ? " on" : ""), title: d.preview ? "Click to place" : "Double-click to change (click, then Delete to remove)" }, d.text);
        b._id = d.id;
        if (!d.preview) {
          // keep focus where it is (a focused button would steal it from the value box)
          b.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); };
          b.onmousedown = (e) => e.preventDefault();
          b.onclick = (e) => {
            e.stopPropagation();
            if (this.tool === "dim") { setTimeout(() => this.editDim(d.id), 30); return; }
            this.selCons = this.selCons || new Set();
            this.selCons.has(d.id) ? this.selCons.delete(d.id) : this.selCons.add(d.id);
            this.redraw();
          };
          b.ondblclick = (e) => { e.stopPropagation(); if (this.tool !== "dim") setTimeout(() => this.editDim(d.id), 30); };
        } else b.style.pointerEvents = "none";
        this.vp.labels.append(b);
        return b;
      });
    }
    (this.dimEls || []).forEach((b, i) => { b._at = list[i] ? list[i].at : [0, 0]; });
    this.placeGlyphs();
  }
  setEntSize(entId, v) {
    if (!(v > 0)) return;
    this.edit("Dimension", (sk) => {
      const e = sk.ents.find((x) => x.id === entId);
      const P = (id) => sk.pts.find((p) => p.id === id);
      if (e.t === "line") {
        const a = P(e.a), b = P(e.b);
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        b.x = a.x + ((b.x - a.x) / L) * v; b.y = a.y + ((b.y - a.y) / L) * v;
      } else if (e.t === "circle") e.r = v / 2;
      else if (e.t === "arc") {
        const c = P(e.c);
        for (const q of [P(e.a), P(e.b)]) {
          const L = Math.hypot(q.x - c.x, q.y - c.y) || 1;
          q.x = c.x + ((q.x - c.x) / L) * v; q.y = c.y + ((q.y - c.y) / L) * v;
        }
      }
    });
    this.redraw();
  }
  // used by the inspector
  setEntProps(entId, props) {
    this.edit("Edit sketch geometry", (sk) => {
      const e = sk.ents.find((x) => x.id === entId);
      const P = (id) => sk.pts.find((p) => p.id === id);
      if (!e) return;
      if (e.t === "spline") { if (props.closed != null) e.closed = !!props.closed && e.pts.length >= 3; return; }
      if (e.t === "line") {
        const a = P(e.a), b = P(e.b);
        if (props.ax != null) a.x = props.ax; if (props.ay != null) a.y = props.ay;
        if (props.bx != null) b.x = props.bx; if (props.by != null) b.y = props.by;
        if (props.len != null || props.ang != null) {
          const L = props.len ?? Math.hypot(b.x - a.x, b.y - a.y);
          const A = props.ang != null ? props.ang * DEG : Math.atan2(b.y - a.y, b.x - a.x);
          b.x = a.x + L * Math.cos(A); b.y = a.y + L * Math.sin(A);
        }
      } else if (e.t === "circle") {
        const c = P(e.c);
        if (props.cx != null) c.x = props.cx; if (props.cy != null) c.y = props.cy;
        if (props.dia > 0) e.r = props.dia / 2;
      } else if (e.t === "arc") {
        const c = P(e.c), a = P(e.a), b = P(e.b);
        if (props.cx != null || props.cy != null) {
          const dx = (props.cx ?? c.x) - c.x, dy = (props.cy ?? c.y) - c.y;
          for (const q of [c, a, b]) { q.x += dx; q.y += dy; }
        }
        if (props.r > 0) for (const q of [a, b]) {
          const L = Math.hypot(q.x - c.x, q.y - c.y) || 1;
          q.x = c.x + ((q.x - c.x) / L) * props.r; q.y = c.y + ((q.y - c.y) / L) * props.r;
        }
      } else if (e.t === "point") {
        const p = P(e.p);
        if (props.x != null) p.x = props.x; if (props.y != null) p.y = props.y;
      } else if (e.t === "text") {
        const p = P(e.p);
        if (props.x != null) p.x = props.x; if (props.y != null) p.y = props.y;
        if (props.str != null) e.str = props.str;
        if (props.size > 0) e.size = props.size;
        if (props.angle != null) e.angle = props.angle;
        if (props.font) e.font = props.font;
      }
      if (props.cons != null && !e.proj) e.cons = props.cons;
    });
  }
  setPointProps(pid, x, y) {
    this.edit("Move point", (sk) => { const p = sk.pts.find((q) => q.id === pid); if (p) { p.x = x; p.y = y; } });
  }

  // ------------------------------------------------------------ preview & drawing
  preview() {
    const st = this.state;
    const t = this.tool;
    const cur = this.cursor;
    if (!st || !cur) {
      this.hideInputIfIdle();
      this.redraw();
      return;
    }
    const p = this.applyTyped(cur.p);
    const at = this.cursorPx;
    if (t === "line") {
      const L = d2(st.anchor, p), A = normAng(Math.atan2(p[1] - st.anchor[1], p[0] - st.anchor[0])) / DEG;
      this.showInput(["Length", "Angle"], [fmt(L, 2), fmt(A, 1)], at);
    } else if (t === "rect3") {
      if (st.step === 1) this.showInput(["Length", "Angle"], [fmt(d2(st.start, p), 2), fmt(normAng(Math.atan2(p[1] - st.start[1], p[0] - st.start[0])) / DEG, 1)], at);
      else { const q = this.rect3Corners(st, p); this.showInput(["Width"], [fmt(q ? d2(q[1], q[2]) : 0, 2)], at); }
    } else if (t === "rect" || t === "rectc") {
      const [a, b] = this.rectCorners(st.start, p);
      this.showInput(["Width", "Height"], [fmt(Math.abs(b[0] - a[0]), 2), fmt(Math.abs(b[1] - a[1]), 2)], at);
    } else if (t === "circle") this.showInput(["Diameter"], [fmt(d2(st.start, p) * 2, 2)], at);
    else if (t === "polygon") this.showInput(["Radius", "Sides"], [fmt(d2(st.start, p), 2), String(this.polySides)], at);
    else if (t === "arcc") {
      if (st.step === 1) this.showInput(["Radius"], [fmt(d2(st.start, p), 2)], at);
      else {
        const a0 = Math.atan2(st.a[1] - st.start[1], st.a[0] - st.start[0]);
        const a1 = Math.atan2(p[1] - st.start[1], p[0] - st.start[0]);
        this.showInput(["Radius", "Sweep"], [fmt(d2(st.start, st.a), 2), fmt(normAng(a1 - a0) / DEG, 1)], at);
      }
    } else this.hideInput();
    this.redraw();
  }
  hideInputIfIdle() { if (!this.state) this.input.root.hidden = true; }

  // the app-wide unit changed (status bar switch): redraw the grid and readouts in it
  unitChanged() {
    this.gridKey = "";
    if (this.input) this.input.root.hidden = true;
    this.locked = [false, false];
    if (this.active) this.redraw();
  }
  redraw() {
    if (this.active) this.drawGlyphs();
    const g = this.group;
    for (const c of [...g.children]) { g.remove(c); c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }
    const sk = this.sketch;
    // the 3D origin marker would show up off-plane while sketching on a face
    if (this.app.originMarker) this.app.originMarker.visible = !sk;
    if (!sk) { this.vp.request(); return; }
    const px = this.px();
    const curves = resolveSketch(sk);
    const segs = { line: [], cons: [], proj: [], hover: [], sel: [], preview: [] };
    const pushPoly = (arr, pts) => { for (let i = 0; i < pts.length - 1; i++) arr.push(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0); };
    for (const c of curves) {
      if (c.t === "point") continue;
      const pts = sampleCurve(c);
      const k = this.sel.has(c.id) ? "sel" : this.hover === c.id ? "hover" : c.proj ? "proj" : c.cons ? "cons" : "line";
      pushPoly(segs[k], pts);
    }
    for (const { id, pts } of textOutlines(sk)) pushPoly(segs[this.sel.has(id) ? "sel" : this.hover === id ? "hover" : "line"], pts);
    if (sk.image) { const im = sketchImageMesh(sk.image, () => this.vp.request()); im.material.depthTest = false; im.renderOrder = 4; g.add(im); }
    // profiles
    const regs = regionsFor(sk);
    for (const r of regs) {
      const m = new THREE.Mesh(regionGeometry(r), new THREE.MeshBasicMaterial({ color: 0x9fbfec, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = 5;
      g.add(m);
    }
    // trim preview
    if (this.tool === "trim" && this.hover && !this.hover.startsWith("pt:") && this.rawCursor) {
      const span = trimSpan(curves.filter((c) => !c.cons || c.id === this.hover), this.hover, this.rawCursor);
      if (span) {
        const c = span.c;
        let pts;
        if (span.whole) pts = sampleCurve(c);
        else if (c.t === "line") pts = [curvePoint(c, span.lo), curvePoint(c, span.hi)];
        else { pts = []; for (let i = 0; i <= 40; i++) pts.push(curvePoint(c, span.lo + ((span.hi - span.lo) * i) / 40)); }
        segs.hover = [];
        pushPoly(segs.preview, pts);
      }
    }
    // tool preview
    const st = this.state, cur = this.cursor;
    if (st && cur) {
      const p = this.applyTyped(cur.p);
      const t = this.tool;
      if (t === "spline") {
        const fit = [...st.fit];
        if (d2(fit[fit.length - 1], p) > 1e-6) fit.push(p);
        const c = makeSplineCurve(fit, false);
        if (c) pushPoly(segs.preview, c.poly); else pushPoly(segs.preview, [st.start, p]);
      } else if (t === "line") pushPoly(segs.preview, [st.anchor, p]);
      else if (t === "rect3") {
        if (st.step === 1) pushPoly(segs.preview, [st.start, p]);
        else { const q = this.rect3Corners(st, p); if (q) pushPoly(segs.preview, [...q, q[0]]); else pushPoly(segs.preview, [st.start, st.end]); }
      } else if (t === "rect" || t === "rectc") {
        const [a, b] = this.rectCorners(st.start, p);
        pushPoly(segs.preview, [a, [b[0], a[1]], b, [a[0], b[1]], a]);
      } else if (t === "circle") pushPoly(segs.preview, sampleCurve({ t: "circle", c: st.start, r: d2(st.start, p) }));
      else if (t === "polygon") { const pts = this.polyPts(st.start, p); if (pts) pushPoly(segs.preview, [...pts, pts[0]]); }
      else if (t === "arc3") {
        if (st.step === 1) pushPoly(segs.preview, [st.start, p]);
        else { const a = arcFrom3(st.start, st.end, p); if (a) pushPoly(segs.preview, sampleCurve({ t: "arc", c: a.c, r: a.r, a0: a.a0, a1: a.a1 })); }
      } else if (t === "arcc") {
        if (st.step === 1) pushPoly(segs.preview, [st.start, p]);
        else {
          const end = this.arcEnd(st, p), c = st.start;
          pushPoly(segs.preview, sampleCurve({ t: "arc", c, r: d2(c, st.a), a0: Math.atan2(st.a[1] - c[1], st.a[0] - c[0]), a1: Math.atan2(end[1] - c[1], end[0] - c[0]) }));
          pushPoly(segs.cons, [c, st.a]);
        }
      }
    }
    const mk = (arr, color, extra = {}) => {
      if (!arr.length) return;
      if (!extra.dashed && extra.w) {
        // thick lines: one quad per segment, extra.w pixels wide
        const q = [], hw = (extra.w * px) / 2;
        for (let k = 0; k < arr.length; k += 6) {
          const ax = arr[k], ay = arr[k + 1], bx = arr[k + 3], by = arr[k + 4];
          let dx = bx - ax, dy = by - ay;
          const L = Math.hypot(dx, dy);
          if (L < 1e-12) continue;
          dx /= L; dy /= L;
          const nx = -dy * hw, ny = dx * hw, p0x = ax - dx * hw, p0y = ay - dy * hw, p1x = bx + dx * hw, p1y = by + dy * hw;
          q.push(p0x + nx, p0y + ny, 0, p0x - nx, p0y - ny, 0, p1x + nx, p1y + ny, 0, p0x - nx, p0y - ny, 0, p1x - nx, p1y - ny, 0, p1x + nx, p1y + ny, 0);
        }
        if (!q.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(q, 3));
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, side: THREE.DoubleSide }));
        m.renderOrder = 8;
        g.add(m);
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const dashed = extra.dashed;
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 5 * px, gapSize: 3 * px, depthTest: false, transparent: true })
        : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
      const l = new THREE.LineSegments(geo, mat);
      if (dashed) l.computeLineDistances();
      l.renderOrder = 8;
      g.add(l);
    };
    // dimensions (only while this sketch is being edited)
    const dimSegs = [];
    if (this.active) this.drawDims(px, dimSegs);
    mk(dimSegs, C.dim, { w: 1.4 });
    if (dimSegs.preview) mk(dimSegs.preview, C.preview, { w: 1.6 });
    mk(segs.line, C.line, { w: 2.5 }); mk(segs.cons, C.cons, { dashed: true }); mk(segs.proj, C.proj, { w: 1.8 });
    mk(segs.sel, C.sel, { w: 3.5 }); mk(segs.hover, C.hover, { w: 3.5 }); mk(segs.preview, C.preview, { w: 2.5 });
    // points
    const pp = [], ps = [];
    for (const p of sk.pts) (this.sel.has("pt:" + p.id) || this.hover === "pt:" + p.id ? ps : pp).push(p.x, p.y, 0);
    const pts = (arr, color, size) => {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true }));
      m.renderOrder = 9;
      g.add(m);
    };
    // points with a white halo so they show on any background
    pts(pp, 0xffffff, 13); pts(pp, C.point, 9);
    pts(ps, 0xffffff, 17); pts(ps, C.hover, 12);
    // snap marker + guides
    if (cur && this.tool !== "select") {
      const sp = this.applyTyped(cur.p);
      const color = cur.kind === "grid" || cur.kind === "free" ? 0x1f4fa8 : 0xe8a317;
      pts([sp[0], sp[1], 0], color, cur.kind === "grid" || cur.kind === "free" ? 9 : 14);
      const guide = [];
      const L = 4000;
      if (cur.guides && st && st.anchor) {
        if (cur.guides.includes("h")) guide.push(st.anchor[0] - L, st.anchor[1], 0, st.anchor[0] + L, st.anchor[1], 0);
        if (cur.guides.includes("v")) guide.push(st.anchor[0], st.anchor[1] - L, 0, st.anchor[0], st.anchor[1] + L, 0);
      }
      if (cur.align) {
        if (cur.align.x != null) guide.push(cur.align.from[0], cur.align.from[1], 0, sp[0], sp[1], 0);
        if (cur.align.y != null) guide.push(cur.align.fromY[0], cur.align.fromY[1], 0, sp[0], sp[1], 0);
      }
      mk(guide, 0x6d8fbf, { dashed: true });
    }
    // origin: faint axis lines across the sketch, bold arrows and a dot at the center
    const L0 = 4000;
    mk([-L0, 0, 0, L0, 0, 0], 0xd9534f, { dashed: true });
    mk([0, -L0, 0, 0, L0, 0], 0x3f9b52, { dashed: true });
    const bar = (x0, y0, x1, y1, w, color) => {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * w, ny = (dx / l) * w;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([x0 + nx, y0 + ny, 0, x1 + nx, y1 + ny, 0, x1 - nx, y1 - ny, 0, x0 + nx, y0 + ny, 0, x1 - nx, y1 - ny, 0, x0 - nx, y0 - ny, 0], 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, side: THREE.DoubleSide }));
      m.renderOrder = 10;
      g.add(m);
    };
    const tri = (x, y, dx, dy, s, color) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([x + dx * s, y + dy * s, 0, x - dy * s * 0.55, y + dx * s * 0.55, 0, x + dy * s * 0.55, y - dx * s * 0.55, 0], 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, side: THREE.DoubleSide }));
      m.renderOrder = 10;
      g.add(m);
    };
    const A = 34 * px, W = 1.4 * px;
    bar(0, 0, A, 0, W, 0xd9534f); tri(A, 0, 1, 0, 8 * px, 0xd9534f);
    bar(0, 0, 0, A, W, 0x3f9b52); tri(0, A, 0, 1, 8 * px, 0x3f9b52);
    pts([0, 0, 0], 0x18202a, 13);
    pts([0, 0, 0], 0xffd34d, 7);
    // the center of the face this sketch sits on: an orange crosshair you can snap to
    if (sk.faceCenter) {
      const [fx, fy] = sk.faceCenter, r = 7 * px;
      mk([fx - r * 1.8, fy, 0, fx - r * 0.4, fy, 0, fx + r * 0.4, fy, 0, fx + r * 1.8, fy, 0, fx, fy - r * 1.8, 0, fx, fy - r * 0.4, 0, fx, fy + r * 0.4, 0, fx, fy + r * 1.8, 0], 0xe8730c);
      const ring = [];
      for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; ring.push(fx + r * Math.cos(a0), fy + r * Math.sin(a0), 0, fx + r * Math.cos(a1), fy + r * Math.sin(a1), 0); }
      mk(ring, 0xe8730c);
    }
    // what the cursor snapped to
    this.vp.request();
  }
}

// Add imported curves (sketch coordinates) to a sketch. Points that land within
// `tol` of each other are joined so imported outlines become closed profiles.
export function addImportedCurves(sk, curves, tol = 1e-4) {
  const grid = new Map();
  const keyOf = (x, y) => Math.round(x / tol) + "," + Math.round(y / tol);
  for (const p of sk.pts) grid.set(keyOf(p.x, p.y), p.id);
  const pt = (q) => {
    const k = keyOf(q[0], q[1]);
    // look in neighbouring cells too
    const [ix, iy] = k.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const h = grid.get(ix + dx + "," + (iy + dy)); if (h) return h; }
    const id = uid("p");
    sk.pts.push({ id, x: q[0], y: q[1] });
    grid.set(k, id);
    return id;
  };
  let n = 0;
  for (const c of curves) {
    if (c.t === "line") { const a = pt(c.a), b = pt(c.b); if (a !== b) { sk.ents.push({ id: uid("e"), t: "line", a, b }); n++; } }
    else if (c.t === "circle") { if (c.r > 1e-6) { sk.ents.push({ id: uid("e"), t: "circle", c: pt(c.c), r: c.r }); n++; } }
    else if (c.t === "arc") { const a = pt(c.a), b = pt(c.b); if (a !== b) { sk.ents.push({ id: uid("e"), t: "arc", c: pt(c.c), a, b }); n++; } }
    else if (c.t === "spline") {
      const ids = [];
      for (const q of c.pts) { const id = pt(q); if (ids[ids.length - 1] !== id) ids.push(id); }
      if (c.closed && ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      if (ids.length >= 2) { sk.ents.push({ id: uid("e"), t: "spline", pts: ids, closed: !!c.closed && ids.length >= 3 }); n++; }
    }
  }
  normalizeSketch(sk);
  return n;
}
// area centroid of a closed polygon (the visual center of a rectangle, polygon...)
export function polyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], k = p[0] * q[1] - q[0] * p[1];
    a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < 1e-12) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
}
// circle through three points; ccw tells whether start->end is counter-clockwise via mid
export function arcFrom3(a, b, m) {
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cy = b[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const c = [ux, uy];
  const r = d2(c, a);
  const aa = Math.atan2(a[1] - uy, a[0] - ux), ab = Math.atan2(b[1] - uy, b[0] - ux), am = Math.atan2(m[1] - uy, m[0] - ux);
  const ccw = angIn(am, aa, ab);
  return { c, r, ccw, a0: ccw ? aa : ab, a1: ccw ? ab : aa };
}
