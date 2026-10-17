// Pipe (a round, square or triangular section along sketch curves or body edges, solid
// or hollow) and Coil (a helix body: springs, threads-to-print, spirals), as in Fusion 360.
import * as THREE from "three";
import { store, findBody, findSketch, nextSeq, IDENTITY, pathChain } from "./store.js";
import { el, uid, nextColor } from "./util.js";
import { resolveSketch } from "./regions.js";
import { M4, arr, nextName } from "./ops.js";
import { planeMatrix } from "./scene.js";

const BODY_COLORS = ["#9fb1c4", "#c9a27a", "#8fb79a", "#b49ac8", "#c98f8f", "#8fb8c9"];
const SECTIONS = [["circle", "Round"], ["square", "Square"], ["triangle", "Triangle"]];

export function initPipeCoil(app, X) {
  const { vp, scene, openCmd, closeCmd, commit, schedulePreview, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawDot, clearOv, row, seg, pickbox, pickSketchCurve, pathPts, deleteFeature, frameFrom } = X;
  const V3 = (a) => new THREE.Vector3(...a);
  const r6 = (v) => v.toArray().map((q) => (Math.abs(q) < 1e-9 ? 0 : +q.toFixed(6)));

  // ------------------------------------------------------------ shared: operation
  function opRow(body, st, editing) {
    if (editing && !editing.mod) return;
    const ops = editing ? [["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]] : [["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]];
    const sel = el("select", { class: "num", id: "pc-op" }, ...ops.map(([v, l]) => el("option", { value: v, selected: v === st.op }, l)));
    sel.onchange = () => { st.op = sel.value; st.refresh(); };
    body.append(row("Operation", sel, "pc-op"));
  }
  function bodiesTouching(box, skip) {
    return store.doc.bodies.filter((b) => !b.hole && !b.hidden && !b.locked && b.id !== skip).filter((b) => { const bb = scene.bodyTightBox(b.id); return bb && bb.intersectsBox(box); }).map((b) => b.id);
  }
  // put the new feature in the design: a new body, or join/cut/intersect into the bodies it reaches
  function place(doc, st, node, m, box) {
    const editing = st.editing;
    if (editing) {
      const b = findBody(doc, editing.body);
      if (editing.mod) { const md = b.node.mods.find((x) => x.id === editing.mod); md.tool = { ...node, mods: [] }; md.op = st.op === "new" ? md.op : st.op; md.m = arr(M4(b.m).invert().multiply(M4(m))); }
      else { b.node = { ...node, mods: b.node.mods || [] }; b.m = m.slice(); }
      return;
    }
    const parts = st.op === "new" ? [] : bodiesTouching(box);
    if (st.op === "new" || (st.op === "join" && !parts.length)) {
      doc.bodies.push({ id: st.newId || (st.newId = uid("b")), name: nextName(doc, node.t === "coil" ? "Coil" : "Pipe"), seq: nextSeq(doc), color: app.mode === "beginner" ? nextColor() : BODY_COLORS[doc.bodies.length % BODY_COLORS.length], hole: false, hidden: false, m: m.slice(), node: { ...node, mods: [] } });
      return;
    }
    if (!parts.length) throw new Error(st.op === "cut" ? "It doesn't reach any body to cut." : "It doesn't reach any body.");
    // while previewing a cut, show the volume being removed in see-through red
    if (app.previewing && st.op === "cut") doc.bodies.push({ id: "__cut_preview", name: "Cut preview", seq: 1e9, color: "#e5484d", hole: false, hidden: false, cutPreview: true, m: m.slice(), node: { ...node, mods: [] } });
    const seq = nextSeq(doc);
    for (const id of st.op === "join" ? [parts[0]] : parts) {
      const b = findBody(doc, id);
      b.node.mods = b.node.mods || [];
      b.node.mods.push({ id: uid("f"), seq, t: "bool", op: st.op, tool: { ...node, mods: [] }, m: arr(M4(b.m).invert().multiply(M4(m))) });
    }
  }
  function existing(editing) {
    if (!editing) return null;
    const b = findBody(store.doc, editing.body);
    if (!b) return null;
    if (!editing.mod) return { node: b.node, m: b.m, op: "new" };
    const md = b.node.mods.find((x) => x.id === editing.mod);
    return { node: md.tool, m: arr(M4(b.m).multiply(M4(md.m || IDENTITY))), op: md.op };
  }

  // ------------------------------------------------------------ Pipe
  // a body edge as a fixed world-space path segment
  function edgeSeg(h) {
    const base = h.base, info = h.info, m = base.m;
    const A = V3(info.a).applyMatrix4(m), B = V3(info.b).applyMatrix4(m), Mid = V3(info.m).applyMatrix4(m);
    if (info.t === "LINE") return [{ t: "line", a: r6(A), b: r6(B) }];
    const pts = edgeWorldPts(base, h.edge);
    if (info.t === "CIRCLE") {
      if (A.distanceTo(B) < 1e-6) {
        const p1 = pts[Math.floor(pts.length / 3)], p2 = pts[Math.floor((2 * pts.length) / 3)];
        const c = circum(A, p1, p2);
        if (c) return [{ t: "circle", c: r6(c), r: +A.distanceTo(c).toFixed(6), n: r6(new THREE.Vector3().crossVectors(p1.clone().sub(A), p2.clone().sub(A)).normalize()) }];
      } else return [{ t: "arc", a: r6(A), m: r6(Mid), b: r6(B) }];
    }
    // other curves: follow the drawn polyline
    const out = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 1e-6) out.push({ t: "line", a: r6(pts[i - 1]), b: r6(pts[i]) });
    return out;
  }
  function circum(a, m, b) {
    const ab = b.clone().sub(a), am = m.clone().sub(a), n = new THREE.Vector3().crossVectors(ab, am), n2 = n.lengthSq();
    if (n2 < 1e-12) return null;
    return a.clone().add(new THREE.Vector3().crossVectors(n, ab).multiplyScalar(am.lengthSq()).add(new THREE.Vector3().crossVectors(am, n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n2));
  }
  // join picked edges end to end into one path
  function chainSegs(groups) {
    const segs = groups.flat();
    if (segs.length === 1 || segs.some((s) => s.t === "circle")) {
      if (segs.length > 1) throw new Error("A full circle edge has to be the whole path");
      return segs;
    }
    const tol = 1e-3, same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < tol;
    const rev = (s) => ({ ...s, a: s.b, b: s.a });
    const left = segs.slice();
    // start from an end that nothing else touches (or anywhere for a closed loop)
    let startI = left.findIndex((s) => !left.some((o) => o !== s && (same(o.a, s.a) || same(o.b, s.a))));
    let cur;
    if (startI >= 0) cur = [left.splice(startI, 1)[0]];
    else {
      startI = left.findIndex((s) => !left.some((o) => o !== s && (same(o.a, s.b) || same(o.b, s.b))));
      cur = startI >= 0 ? [rev(left.splice(startI, 1)[0])] : [left.shift()];
    }
    while (left.length) {
      const end = cur[cur.length - 1].b;
      const i = left.findIndex((s) => same(s.a, end) || same(s.b, end));
      if (i < 0) throw new Error("The picked edges must connect end to end");
      const s = left.splice(i, 1)[0];
      cur.push(same(s.a, end) ? s : rev(s));
    }
    return cur;
  }
  function pipeCmd(editing = null) {
    const ex = existing(editing);
    const st = { path: null, edges: [], section: "circle", size: 5, hollow: false, wall: 1, op: "new", editing, hover: null };
    if (ex) {
      const n = ex.node;
      Object.assign(st, { path: n.path || null, section: n.section || "circle", size: n.size ?? 5, hollow: !!n.hollow, wall: n.wall ?? 1, op: ex.op, fixedSegs: n.edgeSegs || null });
    }
    const pathSegsNow = () => (st.edges.length ? chainSegs(st.edges.map((e) => e.segs)) : st.fixedSegs || null);
    const def = {
      title: (editing ? "Edit " : "") + "Pipe",
      valid: () => !!((st.path && st.path.ents.length) || st.edges.length || st.fixedSegs),
      canOk: () => def.valid(),
      apply(doc) {
        const node = { t: "pipe", section: st.section, size: st.size, hollow: st.hollow, wall: st.wall };
        if (st.path) node.path = st.path; else node.edgeSegs = pathSegsNow();
        place(doc, st, node, IDENTITY.slice(), toolBox());
        if (st.path && !editing) { const ps = findSketch(doc, st.path.sketch); if (ps) ps.hidden = true; }
      },
      ok() { commit(def, editing ? "Edit pipe" : "Pipe"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => def.valid() ? "Set the section and size, then OK." : "Click a sketch line, arc or spline, or body edges, for the path.",
      build(body) {
        const n = st.path ? st.path.ents.length : st.edges.length;
        const label = st.path ? `${n} sketch curve${n > 1 ? "s" : ""}` : st.edges.length ? `${n} edge${n > 1 ? "s" : ""}` : st.fixedSegs ? "body edges" : null;
        body.append(row("Path", pickbox(!label, label ? el("b", {}, label) : "Click curves or edges", label ? () => { st.path = null; st.edges = []; st.fixedSegs = null; refresh(); } : null)));
        body.append(row("Section", seg(SECTIONS, st.section, (v) => { st.section = v; refresh(); }, "pp-sec")));
        body.append(row(st.section === "circle" ? "Diameter" : "Size", app.numField({ value: st.size, id: "pp-size", min: 0.05, step: 0.5, live: true, onCommit: (v) => { st.size = v; refresh(false); } }), "pp-size"));
        body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "pp-hollow", checked: st.hollow, onchange: (e) => { st.hollow = e.target.checked; refresh(); } }), "Hollow"));
        if (st.hollow) body.append(row("Wall", app.numField({ value: st.wall, id: "pp-wall", min: 0.05, step: 0.1, live: true, onCommit: (v) => { st.wall = v; refresh(false); } }), "pp-wall"));
        opRow(body, st, editing);
        body.append(el("div", { class: "hint", style: { padding: 0 } }, "Connected sketch curves are picked as one chain. Body edges are added one click at a time and must connect end to end."));
      },
      start() { scene.syncSketches(store.view); refresh(); },
      handler: {
        hover(e) {
          const c = pickSketchCurve(e);
          let h = null;
          if (c) h = { kind: "sketch", c, pts: pathPts(c) };
          else { const eh = pickBaseEdge(e, (b) => !b.hole); if (eh) h = { kind: "edge", eh, pts: [edgeWorldPts(eh.base, eh.edge)] }; }
          st.hover = h; draw();
          vp.canvas.style.cursor = h ? "pointer" : "default";
        },
        down(e) {
          const c = pickSketchCurve(e);
          if (c) {
            const sk = findSketch(store.view, c.sketch);
            st.path = { sketch: c.sketch, ents: pathChain(resolveSketch(sk), c.curve.id) };
            st.edges = []; st.fixedSegs = null;
            refresh();
            return true;
          }
          const eh = pickBaseEdge(e, (b) => !b.hole);
          if (eh) {
            st.path = null; st.fixedSegs = null;
            const i = st.edges.findIndex((x) => x.body === eh.body && x.edge === eh.edge);
            if (i >= 0) st.edges.splice(i, 1);
            else st.edges.push({ body: eh.body, edge: eh.edge, segs: edgeSeg(eh), pts: edgeWorldPts(eh.base, eh.edge) });
            try { pathSegsNow(); def.error = null; } catch (err) { def.error = err.message; }
            refresh();
          }
          return true;
        },
      },
    };
    function pathLines() {
      if (st.path) return pathPts({ sketch: st.path.sketch, curve: { id: st.path.ents[0] } });
      if (st.edges.length) return st.edges.map((x) => x.pts);
      if (st.fixedSegs) return st.fixedSegs.map((s) => s.t === "circle" ? circlePts(s) : s.t === "arc" ? [V3(s.a), V3(s.m), V3(s.b)] : [V3(s.a), V3(s.b)]);
      return [];
    }
    function circlePts(s) {
      const c = V3(s.c), n = V3(s.n).normalize(), u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
      const out = [];
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; out.push(c.clone().addScaledVector(u, Math.cos(a) * s.r).addScaledVector(w, Math.sin(a) * s.r)); }
      return out;
    }
    function toolBox() {
      const box = new THREE.Box3();
      for (const pl of pathLines()) for (const p of pl) box.expandByPoint(p);
      if (!box.isEmpty()) box.expandByScalar(st.size / 2 + 1e-3);
      return box;
    }
    function draw() {
      clearOv();
      for (const pl of pathLines()) drawLine(pl, 0x2f66c8);
      if (st.hover) for (const pl of st.hover.pts) drawLine(pl, 0xe8a317);
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    st.refresh = refresh;
    openCmd(def);
  }

  // ------------------------------------------------------------ Coil
  const AXES = { Z: [0, 0, 1], X: [1, 0, 0], Y: [0, 1, 0] };
  function coilCmd(editing = null) {
    const ex = existing(editing);
    const t = vp.view.target;
    const st = { o: [+t.x.toFixed(1), +t.y.toFixed(1), 0], n: [0, 0, 1], axis: "Z", d: 20, turns: 5, h: 20, pitch: 4, mode: "height", angle: 0, section: "circle", size: 2, pos: "on", left: false, op: "new", editing };
    if (ex) {
      const n = ex.node, M = M4(ex.m);
      const o = new THREE.Vector3().setFromMatrixPosition(M), z = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
      Object.assign(st, { d: n.d ?? 20, turns: n.turns ?? 5, h: n.h ?? 20, pitch: n.pitch ?? 4, mode: n.mode || "height", angle: n.angle || 0, section: n.section || "circle", size: n.size ?? 2, pos: n.pos || "on", left: !!n.left, op: ex.op, o: r6(o), n: r6(z), axis: null });
      for (const [k, v] of Object.entries(AXES)) if (z.distanceTo(V3(v)) < 1e-6) st.axis = k;
    }
    let hover = null;
    const matrix = () => arr(planeMatrix(frameFrom(st.o, st.n)));
    const def = {
      title: (editing ? "Edit " : "") + "Coil",
      apply(doc) {
        const node = { t: "coil", d: st.d, turns: st.turns, mode: st.mode, h: st.h, pitch: st.pitch, angle: st.angle, section: st.section, size: st.size, pos: st.pos, left: st.left };
        const m = matrix();
        const tall = st.mode === "pitch" ? st.pitch * st.turns + st.size : st.h;
        const box = new THREE.Box3(new THREE.Vector3(-st.d / 2 - st.size, -st.d / 2 - st.size, 0), new THREE.Vector3(st.d / 2 + st.size, st.d / 2 + st.size, tall)).applyMatrix4(M4(m));
        place(doc, st, node, m, box);
      },
      ok() { commit(def, editing ? "Edit coil" : "Coil"); },
      onDelete: editing ? () => deleteFeature(editing) : null,
      hint: () => "Click the ground or a flat face to place the coil's center, then set its size.",
      build(body) {
        const num = (label, key, id, min, step, unit) => row(label, app.numField({ value: st[key], id, min, step, live: true, onCommit: (v) => { st[key] = v; refresh(false); } }), id);
        body.append(num("Diameter", "d", "cl-d", 0.1, 1));
        body.append(row("Type", seg([["height", "Turns & height"], ["pitch", "Turns & pitch"]], st.mode, (v) => { st.mode = v; refresh(); }, "cl-mode")));
        body.append(num("Turns", "turns", "cl-turns", 0.25, 0.5));
        body.append(st.mode === "pitch" ? num("Pitch", "pitch", "cl-pitch", 0.05, 0.5) : num("Height", "h", "cl-h", 0.1, 1));
        body.append(num("Taper °", "angle", "cl-angle", -60, 1));
        body.append(row("Twist", seg([["right", "Right-hand"], ["left", "Left-hand"]], st.left ? "left" : "right", (v) => { st.left = v === "left"; refresh(); }, "cl-hand")));
        body.append(el("div", { class: "subhead" }, "Section"));
        body.append(row("Shape", seg([["circle", "Round"], ["square", "Square"], ["triangle", "Tri out"], ["triangle-in", "Tri in"]], st.section, (v) => { st.section = v; refresh(); }, "cl-sec")));
        body.append(num("Size", "size", "cl-size", 0.05, 0.5));
        body.append(row("Sits", seg([["inside", "Inside"], ["on", "On"], ["outside", "Outside"]], st.pos, (v) => { st.pos = v; refresh(); }, "cl-pos")));
        body.append(el("div", { class: "subhead" }, "Placement"));
        const p3 = el("div", { class: "row3" });
        ["X", "Y", "Z"].forEach((l, i) => p3.append(el("label", {}, l, app.numField({ value: st.o[i], id: "cl-o" + i, step: 1, onCommit: (v) => { st.o = st.o.slice(); st.o[i] = v; refresh(false); } }))));
        body.append(p3);
        body.append(row("Axis", seg([["Z", "Z"], ["X", "X"], ["Y", "Y"]], st.axis, (v) => { st.axis = v; st.n = AXES[v]; refresh(); }, "cl-axis")));
        opRow(body, st, editing);
      },
      start() { refresh(); },
      handler: {
        hover(e) {
          const f = pickBaseFace(e, (b) => !b.hole && (!editing || b.id !== editing.body));
          hover = f && f.info && f.info.t === "PLANE" ? f.point.clone() : f ? null : vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
          draw();
          vp.canvas.style.cursor = hover ? "crosshair" : "default";
        },
        down(e) {
          const f = pickBaseFace(e, (b) => !b.hole && (!editing || b.id !== editing.body));
          if (f && f.info && f.info.t === "PLANE") { st.o = r6(f.point); st.n = r6(V3(f.info.n).transformDirection(f.base.m).normalize()); st.axis = null; for (const [k, v] of Object.entries(AXES)) if (V3(st.n).distanceTo(V3(v)) < 1e-6) st.axis = k; }
          else if (!f) { const p = vp.rayPlane(e, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)); if (!p) return true; st.o = r6(p); st.n = [0, 0, 1]; st.axis = "Z"; }
          else { app.toast("Place a coil on a flat face or the ground."); return true; }
          refresh();
          return true;
        },
      },
    };
    function draw() {
      clearOv();
      const o = V3(st.o), n = V3(st.n).normalize(), L = Math.max(st.d, st.mode === "pitch" ? st.pitch * st.turns : st.h) * 0.75 + 5;
      drawLine([o.clone().addScaledVector(n, -2), o.clone().addScaledVector(n, L)], 0x1f4fa8);
      drawDot(o, 0x1f4fa8, 9);
      if (hover) drawDot(hover, 0xe8a317, 9);
      vp.request();
    }
    function refresh(rerender = true) { if (rerender) def.render(); draw(); schedulePreview(def); }
    st.refresh = refresh;
    openCmd(def);
  }

  return { pipeCmd, coilCmd };
}
