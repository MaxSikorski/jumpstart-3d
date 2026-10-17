// Measure: click one or two things (a corner, an edge, a face, a hole) to read sizes,
// distances and angles. Works in both modes; nothing in the design changes.
import * as THREE from "three";
import { el, fmt } from "./util.js";
import { getUnit, setUnit } from "./units.js";

export function initMeasure(app, X) {
  const { vp, openCmd, pickBaseFace, pickBaseEdge, edgeWorldPts, drawLine, drawFace, drawDot, clearOv, row, seg } = X;
  const V3 = (a) => new THREE.Vector3(...a);

  // ------------------------------------------------------------ what's under the pointer
  function circleFrom(a, m, b) {
    // full circles start and end at the same point; the middle point is opposite
    if (a.distanceTo(b) < 1e-6) {
      const c = a.clone().add(m).multiplyScalar(0.5);
      return { c, r: a.distanceTo(m) / 2 };
    }
    const ab = b.clone().sub(a), am = m.clone().sub(a);
    const n = new THREE.Vector3().crossVectors(ab, am);
    const n2 = n.lengthSq();
    if (n2 < 1e-12) return null;
    const c = a.clone().add(
      new THREE.Vector3().crossVectors(n, ab).multiplyScalar(am.lengthSq())
        .add(new THREE.Vector3().crossVectors(am, n).multiplyScalar(ab.lengthSq()))
        .divideScalar(2 * n2));
    return { c, r: c.distanceTo(a) };
  }
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }
  function faceArea(base, face) {
    const [s, c] = base.data.faceGroups[face];
    const V = base.data.vertices, T = base.data.triangles, P = (i) => new THREE.Vector3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]).applyMatrix4(base.m);
    let a = 0;
    for (let t = s; t < s + c; t += 3) { const A = P(T[t]), B = P(T[t + 1]), C = P(T[t + 2]); a += B.sub(A).cross(C.sub(A)).length() / 2; }
    return a;
  }
  function pick(e) {
    const [mx, my] = vp.local(e);
    const near = (p) => { const s = vp.project(p); return Math.hypot(s[0] - mx, s[1] - my) < vp.tol(11); };
    const eh = pickBaseEdge(e, (b) => !b.hole);
    if (eh) {
      const base = eh.base, m = base.m, info = eh.info;
      const a = V3(info.a).applyMatrix4(m), b = V3(info.b).applyMatrix4(m), mid = V3(info.m).applyMatrix4(m);
      // corners first
      for (const p of [a, b]) if (near(p)) return { kind: "vertex", p, label: "Corner" };
      const pts = edgeWorldPts(base, eh.edge);
      if (info.t === "LINE") return { kind: "line", a, b, len: a.distanceTo(b), base, edge: eh.edge, label: "Straight edge" };
      if (info.t === "CIRCLE") {
        const cf = circleFrom(a, mid, b);
        if (cf) {
          const full = a.distanceTo(b) < 1e-6;
          const n = new THREE.Vector3().crossVectors(pts[1].clone().sub(cf.c), pts[Math.floor(pts.length / 2)].clone().sub(cf.c)).normalize();
          return { kind: "circle", c: cf.c, r: cf.r, n, full, len: polyLen(pts), pts, base, edge: eh.edge, label: full ? "Circle" : "Arc" };
        }
      }
      return { kind: "edge", pts, p: mid, len: polyLen(pts), base, edge: eh.edge, label: "Edge" };
    }
    const f = pickBaseFace(e, (b) => !b.hole);
    if (f && f.info) {
      const area = faceArea(f.base, f.face);
      if (f.info.t === "PLANE" && f.info.n) {
        const n = V3(f.info.n).transformDirection(f.base.m).normalize();
        return { kind: "plane", p: f.point.clone(), n, c: V3(f.info.c).applyMatrix4(f.base.m), area, base: f.base, face: f.face, label: "Flat face" };
      }
      if (f.info.t === "CYLINDRE" && f.info.ax) {
        const ax = V3(f.info.ax).transformDirection(f.base.m).normalize(), o = V3(f.info.o).applyMatrix4(f.base.m);
        const p = f.point.clone();
        const foot = o.clone().addScaledVector(ax, p.clone().sub(o).dot(ax));
        return { kind: "cyl", p, o: foot, ax, r: f.info.r * scaleOf(f.base.m), area, base: f.base, face: f.face, label: f.info.ext ? "Round face" : "Hole" };
      }
      return { kind: "face", p: f.point.clone(), area, base: f.base, face: f.face, label: "Curved face" };
    }
    return null;
  }
  const scaleOf = (m) => new THREE.Vector3().setFromMatrixColumn(m, 0).length();

  // ------------------------------------------------------------ geometry between two picks
  const closestOnSeg = (p, a, b) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1))); return a.clone().addScaledVector(ab, t); };
  const pointOf = (E) => (E.kind === "vertex" ? E.p : E.kind === "circle" ? E.c : E.kind === "cyl" ? E.o : E.p || E.c);
  function segSeg(p1, q1, p2, q2) {
    // closest points between two segments
    const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    let s, t;
    if (a <= 1e-12 && e <= 1e-12) return [p1, p2];
    if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      const c = d1.dot(r);
      if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
  }
  const deg = (r) => (r * 180) / Math.PI;
  function relate(A, B) {
    const out = { rows: [] };
    let p1, p2, title = "Distance";
    const isPt = (E) => E.kind === "vertex" || E.kind === "circle" || E.kind === "edge" || E.kind === "face";
    if (A.kind === "plane" && B.kind === "plane") {
      const dot = A.n.dot(B.n);
      if (Math.abs(dot) > 0.9999) {
        const d = B.c.clone().sub(A.p).dot(A.n);
        p1 = A.p.clone(); p2 = A.p.clone().addScaledVector(A.n, d);
        title = "Gap between faces";
      } else {
        out.angle = deg(Math.acos(Math.min(1, Math.abs(dot))));
        p1 = A.p; p2 = B.p; title = "Point to point";
      }
    } else if ((A.kind === "plane") !== (B.kind === "plane") && (isPt(A.kind === "plane" ? B : A) || (A.kind === "plane" ? B : A).kind === "cyl" || (A.kind === "plane" ? B : A).kind === "line")) {
      const P = A.kind === "plane" ? A : B, Q = A.kind === "plane" ? B : A;
      if (Q.kind === "line") {
        const dir = Q.b.clone().sub(Q.a).normalize();
        if (Math.abs(dir.dot(P.n)) < 1e-4) { const d = Q.a.clone().sub(P.c).dot(P.n); p2 = Q.a.clone().add(Q.b).multiplyScalar(0.5); p1 = p2.clone().addScaledVector(P.n, -d); title = "Edge to face"; }
        else { out.angle = 90 - deg(Math.acos(Math.min(1, Math.abs(dir.dot(P.n))))); p1 = P.p; p2 = closestOnSeg(P.p, Q.a, Q.b); title = "Point to point"; }
      } else if (Q.kind === "cyl" && Math.abs(Q.ax.dot(P.n)) > 1e-4) {
        out.angle = 90 - deg(Math.acos(Math.min(1, Math.abs(Q.ax.dot(P.n))))); p1 = P.p; p2 = Q.o; title = "Point to point";
      } else {
        const q = pointOf(Q), d = q.clone().sub(P.c).dot(P.n);
        p2 = q.clone(); p1 = q.clone().addScaledVector(P.n, -d);
        title = Q.kind === "cyl" ? "Hole/round center to face" : Q.kind === "circle" ? "Circle center to face" : "Point to face";
      }
      if (A.kind !== "plane") [p1, p2] = [p2, p1];
    } else if (A.kind === "line" && B.kind === "line") {
      const da = A.b.clone().sub(A.a).normalize(), db = B.b.clone().sub(B.a).normalize();
      const dot = Math.abs(da.dot(db));
      if (dot > 0.9999) {
        const m = A.a.clone().add(A.b).multiplyScalar(0.5);
        const foot = B.a.clone().addScaledVector(db, m.clone().sub(B.a).dot(db));
        p1 = m; p2 = foot; title = "Gap between edges";
      } else { out.angle = deg(Math.acos(Math.min(1, dot))); [p1, p2] = segSeg(A.a, A.b, B.a, B.b); title = "Closest distance"; }
    } else if (A.kind === "line" || B.kind === "line") {
      const L = A.kind === "line" ? A : B, Q = A.kind === "line" ? B : A;
      if (Q.kind === "cyl" && Math.abs(Q.ax.dot(L.b.clone().sub(L.a).normalize())) > 0.9999) {
        const m = L.a.clone().add(L.b).multiplyScalar(0.5); p1 = m; p2 = Q.o.clone().addScaledVector(Q.ax, m.clone().sub(Q.o).dot(Q.ax)); title = "Edge to axis";
      } else { const q = pointOf(Q); p2 = q; p1 = closestOnSeg(q, L.a, L.b); title = "Point to edge"; }
      if (A.kind !== "line") [p1, p2] = [p2, p1];
    } else if (A.kind === "cyl" && B.kind === "cyl" && Math.abs(A.ax.dot(B.ax)) > 0.9999) {
      p1 = A.o; p2 = B.o.clone().addScaledVector(B.ax, A.o.clone().sub(B.o).dot(B.ax)); title = "Center to center";
    } else {
      p1 = pointOf(A); p2 = pointOf(B);
      const nm = (E) => (E.kind === "vertex" ? "corner" : E.kind === "circle" ? "circle center" : E.kind === "cyl" ? "axis" : "point");
      title = A.kind === "circle" && B.kind === "circle" ? "Center to center" : nm(A)[0].toUpperCase() + nm(A).slice(1) + " to " + nm(B);
    }
    out.p1 = p1; out.p2 = p2; out.title = title;
    out.d = p1.distanceTo(p2);
    out.dx = p2.x - p1.x; out.dy = p2.y - p1.y; out.dz = p2.z - p1.z;
    return out;
  }

  // ------------------------------------------------------------ formatting
  const L = (v, dp = 2) => (getUnit() === "in" ? fmt(v / 25.4, dp + 2) + " in" : fmt(v, dp) + " mm");
  const A2 = (v) => (getUnit() === "in" ? fmt(v / 645.16, 4) + " in²" : fmt(v, 2) + " mm²");
  function facts(E) {
    switch (E.kind) {
      case "vertex": return [["X", L(E.p.x)], ["Y", L(E.p.y)], ["Z", L(E.p.z)]];
      case "line": return [["Length", L(E.len)]];
      case "circle": return [["Diameter", L(2 * E.r)], ["Radius", L(E.r)], [E.full ? "Circumference" : "Arc length", L(E.len)], ["Center", `${fmt(E.c.x, 2)}, ${fmt(E.c.y, 2)}, ${fmt(E.c.z, 2)}`]];
      case "edge": return [["Length", L(E.len)]];
      case "plane": return [["Area", A2(E.area)]];
      case "cyl": return [["Diameter", L(2 * E.r)], ["Radius", L(E.r)], ["Area", A2(E.area)]];
      default: return [["Area", A2(E.area)]];
    }
  }

  // ------------------------------------------------------------ the command
  function measureCmd() {
    const st = { a: null, b: null };
    let hover = null;
    const labels = { main: vp.addLabel("measure"), aux: vp.addLabel("measure aux") };
    labels.main.hidden = labels.aux.hidden = true;
    let res = null;
    const place = () => {
      if (!res) { labels.main.hidden = labels.aux.hidden = true; return; }
      const mid = res.p1.clone().add(res.p2).multiplyScalar(0.5);
      const s = vp.project(mid);
      labels.main.hidden = false;
      labels.main.textContent = L(res.d);
      labels.main.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,-140%)`;
      if (res.angle != null) {
        labels.aux.hidden = false;
        labels.aux.textContent = fmt(res.angle, 2) + "°";
        labels.aux.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%,40%)`;
      } else labels.aux.hidden = true;
    };
    vp.afterRender.add(place);
    const def = {
      title: "Measure",
      okLabel: "Done",
      keepSelection: true,
      noEnter: true,
      ok() { X.closeCmd(false); },
      hint: () => !st.a ? "Click a corner, edge or face to measure it." : !st.b ? "Click a second thing to measure between them." : "Click again to start a new measurement.",
      build(body) {
        body.append(row("Units", seg([["mm", "mm"], ["in", "inches"]], getUnit(), (v) => { setUnit(v); refresh(); }, "ms-units")));
        const block = (E, n) => {
          const box = el("div", { class: "measbox" + (E ? "" : " empty"), id: "meas-" + n }, el("div", { class: "mt" }, E ? `${n === "a" ? "1" : "2"} · ${E.label}` : n === "a" ? "Click the first thing" : "Click a second thing (optional)"));
          if (E) for (const [k, v] of facts(E)) box.append(el("div", { class: "mr" }, el("span", {}, k), el("b", {}, v)));
          return box;
        };
        body.append(block(st.a, "a"), block(st.b, "b"));
        if (res) {
          const box = el("div", { class: "measbox result", id: "meas-res" }, el("div", { class: "mt" }, res.title));
          box.append(el("div", { class: "mr big" }, el("span", {}, "Distance"), el("b", { id: "meas-d" }, L(res.d))));
          if (res.angle != null) box.append(el("div", { class: "mr" }, el("span", {}, "Angle"), el("b", { id: "meas-angle" }, fmt(res.angle, 2) + "°")));
          box.append(el("div", { class: "mr" }, el("span", { class: "ax x" }, "ΔX"), el("b", {}, L(Math.abs(res.dx)))));
          box.append(el("div", { class: "mr" }, el("span", { class: "ax y" }, "ΔY"), el("b", {}, L(Math.abs(res.dy)))));
          box.append(el("div", { class: "mr" }, el("span", { class: "ax z" }, "ΔZ"), el("b", {}, L(Math.abs(res.dz)))));
          body.append(box);
        }
        if (st.a) body.append(el("button", { class: "btn", id: "meas-clear", style: { marginTop: "6px" }, onclick: () => { st.a = st.b = null; res = null; refresh(); } }, "Clear"));
      },
      cleanup() { vp.afterRender.delete(place); labels.main.remove(); labels.aux.remove(); clearOv(); },
      handler: {
        hover(e) { hover = pick(e); draw(); vp.canvas.style.cursor = hover ? "crosshair" : "default"; },
        leave() { hover = null; draw(); },
        down(e) {
          const E = pick(e);
          if (!E) return true;
          if (!st.a || st.b) { st.a = E; st.b = null; res = null; }
          else { st.b = E; try { res = relate(st.a, st.b); } catch (err) { console.error("measure", err); res = null; } }
          refresh();
          return true;
        },
      },
    };
    function show(E, color) {
      if (!E) return;
      if (E.kind === "vertex") drawDot(E.p, color, 11);
      else if (E.kind === "line") { drawLine([E.a, E.b], color); drawDot(E.a, color, 6); drawDot(E.b, color, 6); }
      else if (E.kind === "circle") { drawLine(E.pts, color); drawDot(E.c, color, 8); }
      else if (E.kind === "edge") drawLine(E.pts, color);
      else drawFace(E.base, E.face, color);
      if (E.kind === "cyl") drawDot(E.o, color, 8);
    }
    function draw() {
      clearOv();
      if (hover && !(st.a && sameEnt(hover, st.a)) && !(st.b && sameEnt(hover, st.b))) show(hover, 0xe8a317);
      show(st.a, 0x2f66c8);
      show(st.b, 0x2f66c8);
      if (res) {
        drawLine([res.p1, res.p2], 0x1f4fa8);
        drawDot(res.p1, 0x1f4fa8, 8); drawDot(res.p2, 0x1f4fa8, 8);
        // the X, Y and Z parts of the distance
        const c1 = new THREE.Vector3(res.p2.x, res.p1.y, res.p1.z), c2 = new THREE.Vector3(res.p2.x, res.p2.y, res.p1.z);
        if (Math.abs(res.dx) > 1e-6) drawLine([res.p1, c1], 0xd9534f);
        if (Math.abs(res.dy) > 1e-6) drawLine([c1, c2], 0x3f9b52);
        if (Math.abs(res.dz) > 1e-6) drawLine([c2, res.p2], 0x2f6fd0);
      }
      vp.request();
    }
    const sameEnt = (P, Q) => P.kind === Q.kind && P.base === Q.base && P.edge === Q.edge && P.face === Q.face && (P.kind !== "vertex" || P.p.distanceTo(Q.p) < 1e-9);
    function refresh() { def.render(); draw(); }
    openCmd(def);
    draw();
  }
  return { measureCmd };
}
