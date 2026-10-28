// Box on face: draw a rectangle on a flat face and add one plain box along its normal.
import * as THREE from "three";
import { el, uid, nextColor } from "./util.js";
import { arr, makePrimBody } from "./ops.js";
import { withUnit, showLen } from "./units.js";

const clean = (v) => { const r = Math.round(v * 1e4) / 1e4; return Math.abs(v - r) < 1e-6 ? r + 0 : v; };

export function initFaceBox(app, { openCmd, commit, schedulePreview, row, seg, pickBaseFace, drawFace, ov, clearOv, planeFromFace }) {
  function cmd() {
    const st = { face: null, a: null, sx: 1, sy: 1, w: 20, d: 20, h: 10, dir: "out", hole: false, hTyped: false, id: uid("b") };
    st.color = nextColor();
    let dragging = false, hover = null, plane, o, n, ex, ey, anchorWorld, prev;
    const labels = ["w", "d"].map((k) => {
      const l = app.vp.addLabel("fb-dim");
      l.dataset.k = k;
      l.hidden = true;
      return l;
    });
    const material = new THREE.LineBasicMaterial({ color: 0x2f66c8, depthTest: false });
    const pick = (e) => pickBaseFace(e, (b) => b.id !== st.id && !b.hole && !b.hidden);
    const flat = (f) => f && f.info && f.info.t === "PLANE";
    const world = (u, v) => o.clone().addScaledVector(ex, u).addScaledVector(ey, v);
    function coords(p) {
      const q = p.clone().sub(o), g = app.gridStep();
      const snap = (v) => clean(g > 0 ? Math.round(v / g) * g : v);
      return [snap(q.dot(ex)), snap(q.dot(ey))];
    }
    // A box face microns inside the body next to a flush face makes the join open.
    function outermost(dir, level) {
      const f = st.face, data = f.base.data;
      const [au, av] = st.a, bu = au + st.sx * st.w, bv = av + st.sy * st.d;
      const umin = Math.min(au, bu), umax = Math.max(au, bu), vmin = Math.min(av, bv), vmax = Math.max(av, bv);
      let outer = level;
      for (let k = 0; k < data.faceInfo.length; k++) {
        const info = data.faceInfo[k];
        if (!info || info.t !== "PLANE") continue;
        const nk = new THREE.Vector3(...info.n).transformDirection(f.base.m);
        if (nk.dot(dir) <= 1 - 1e-6) continue;
        const ck = new THREE.Vector3(...info.c).applyMatrix4(f.base.m);
        const d = ck.dot(dir);
        if (Math.abs(d - level) > 0.01) continue;
        const [s, cnt] = data.faceGroups[k];
        let loU = Infinity, hiU = -Infinity, loV = Infinity, hiV = -Infinity;
        for (let j = s; j < s + cnt; j++) {
          const i = data.triangles[j];
          const p = new THREE.Vector3().fromArray(data.vertices, 3 * i).applyMatrix4(f.base.m).sub(o);
          const u = p.dot(ex), v = p.dot(ey);
          loU = Math.min(loU, u); hiU = Math.max(hiU, u);
          loV = Math.min(loV, v); hiV = Math.max(hiV, v);
        }
        if (loU <= umax + 1e-6 && hiU >= umin - 1e-6 && loV <= vmax + 1e-6 && hiV >= vmin - 1e-6) outer = Math.max(outer, d);
      }
      return outer;
    }
    function autoHeight() {
      const mesh = app.scene.views.get(st.face.body)?.mesh;
      if (!mesh) return;
      mesh.updateWorldMatrix(true, false);
      const ray = new THREE.Raycaster(anchorWorld.clone().addScaledVector(n, -1e-4), n.clone().negate());
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit) {
        const bottom = anchorWorld.dot(n) - (hit.distance + 1e-4);
        const d0 = o.dot(n);
        st.h = Math.round((outermost(n, d0) + outermost(n.clone().negate(), -bottom)) * 1e4) / 1e4;
      }
    }
    function matrix() {
      st.w = clean(st.w); st.d = clean(st.d); st.h = clean(st.h);
      const origin = world(st.a[0] + st.sx * st.w / 2, st.a[1] + st.sy * st.d / 2);
      const d0 = o.dot(n), top = outermost(n, d0);
      const off = st.dir === "into" ? -st.h : st.dir === "both" ? -st.h / 2 : 0;
      origin.addScaledVector(n, top - d0 + off);
      const m = new THREE.Matrix4().makeBasis(ex, ey, n).setPosition(origin);
      m.elements = m.elements.map(clean);
      return m;
    }
    function draw() {
      clearOv();
      labels.forEach((l) => { l.hidden = true; });
      if (st.face && st.a) {
        drawFace(st.face.base, st.face.face, 0x2f66c8);
        const [u, v] = st.a, du = st.sx * st.w, dv = st.sy * st.d;
        const corners = [[u, v], [u + du, v], [u + du, v + dv], [u, v + dv]].map(([x, y]) => world(x, y).addScaledVector(n, 0.01));
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), material);
        line.renderOrder = 13;
        ov.add(line);
        const points = [world(u + du / 2, v), world(u + du, v + dv / 2)];
        points[0].addScaledVector(ey, -st.sy * app.vp.pixelSize(points[0]) * 14);
        points[1].addScaledVector(ex, st.sx * app.vp.pixelSize(points[1]) * 14);
        labels.forEach((l, i) => {
          const [x, y] = app.vp.project(points[i]);
          l.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`;
          l.textContent = withUnit(st[l.dataset.k], 2);
          l.hidden = false;
        });
      }
      if (flat(hover)) drawFace(hover.base, hover.face, 0xe8a317);
      app.vp.request();
    }
    function refresh(render = false) {
      if (render) def.render();
      draw();
      def.refreshOk();
      schedulePreview(def);
    }
    const length = (k) => app.numField({
      id: `fb-${k}`, value: st[k], live: true, len: true, min: 0.01, step: 1,
      onCommit: (v) => {
        st[k] = clean(v);
        if (k === "h") st.hTyped = true;
        else if (st.dir !== "out" && !st.hTyped) { // the top level follows the rectangle, so the height to the far side must too
          autoHeight();
          const hf = document.getElementById("fb-h");
          if (hf) hf.value = showLen(st.h, 3);
        }
        refresh();
      },
    });
    const def = {
      title: "Box on face",
      okLabel: "Add box",
      valid: () => !dragging && !!st.face && st.w > 0 && st.d > 0 && st.h > 0,
      canOk: () => def.valid(),
      apply(doc) {
        const b = makePrimBody(doc, "box", arr(matrix()), { p: { w: st.w, d: st.d, h: st.h }, hole: st.hole, color: st.color });
        b.id = st.id;
        doc.bodies.push(b);
      },
      ok() { commit(def, "Add box on face"); if (app.command !== def) app.select([st.id]); },
      build(body) {
        body.append(el("div", { class: "hint" }, "Click a flat face of any shape, then drag a rectangle on it. You can type exact sizes afterwards."));
        if (!st.face) return;
        body.append(row("Width", length("w"), "fb-w"));
        body.append(row("Depth", length("d"), "fb-d"));
        body.append(row("Height", length("h"), "fb-h"));
        body.append(row("Direction", seg([["out", "Out of face"], ["into", "Into face"], ["both", "Both ways"]], st.dir, (v) => {
          st.dir = v;
          if (!st.hTyped) { if (v === "out") st.h = 10; else autoHeight(); }
          refresh(true);
        }, "fb-dir")));
        body.append(seg([[false, "Solid"], [true, "Hole"]], st.hole, (v) => { st.hole = v; refresh(true); }, "fb-kind"));
      },
      cleanup() {
        labels.forEach((l) => { l.hidden = true; l.remove(); });
        clearOv();
        material.dispose();
        app.vp.canvas.style.cursor = "default";
      },
      handler: {
        wantsTouch(e) { return !!flat(pick(e)); },
        hover(e) {
          const f = pick(e);
          hover = flat(f) ? f : null;
          draw();
          app.vp.canvas.style.cursor = hover ? "crosshair" : "default";
        },
        down(e) {
          const f = pick(e);
          if (!f) return false;
          if (!flat(f)) { app.toast("Pick a flat face."); return true; }
          prev = { face: st.face, a: st.a?.slice() ?? null, sx: st.sx, sy: st.sy, w: st.w, d: st.d, h: st.h,
            o: o?.clone(), n: n?.clone(), ex: ex?.clone(), ey: ey?.clone(), plane: plane?.clone(), anchorWorld: anchorWorld?.clone() };
          st.face = f;
          hover = null;
          const frame = planeFromFace(f);
          o = new THREE.Vector3(...frame.o);
          n = new THREE.Vector3(...frame.n).normalize();
          anchorWorld = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o).projectPoint(f.point, new THREE.Vector3()); // on the face clicked, so the thickness is measured through material
          ex = new THREE.Vector3().setFromMatrixColumn(f.base.m, 0).normalize();
          ex.addScaledVector(n, -ex.dot(n));
          if (ex.length() < 0.1) {
            ex.setFromMatrixColumn(f.base.m, 1).normalize();
            ex.addScaledVector(n, -ex.dot(n));
          }
          ex.normalize();
          ey = new THREE.Vector3().crossVectors(n, ex).normalize();
          plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
          st.a = coords(f.point);
          st.sx = st.sy = 1;
          st.w = st.d = 0;
          dragging = true;
          schedulePreview(def);
          def.render();
          draw();
          def.refreshOk();
          return true;
        },
        move(e) {
          if (!dragging) return;
          const p = app.vp.rayPlane(e, plane);
          if (!p) return;
          const b = coords(p);
          const du = b[0] - st.a[0], dv = b[1] - st.a[1];
          st.sx = Math.sign(du) || 1; st.sy = Math.sign(dv) || 1;
          st.w = clean(Math.abs(du)); st.d = clean(Math.abs(dv));
          draw();
        },
        cancel() {
          if (!dragging) return;
          dragging = false;
          const { face, a, sx, sy, w, d, h } = prev;
          Object.assign(st, { face, a, sx, sy, w, d, h });
          ({ o, n, ex, ey, plane, anchorWorld } = prev);
          def.render(); draw(); def.refreshOk(); schedulePreview(def);
        },
        up(e) {
          if (e && e.type === "pointercancel") { def.handler.cancel(); return; }
          if (!dragging) return;
          dragging = false;
          const threshold = app.gridStep() > 0 ? app.gridStep() : 0.5;
          if (st.w < threshold && st.d < threshold) {
            st.a = [st.a[0] - 10, st.a[1] - 10];
            st.sx = st.sy = 1;
            st.w = st.d = 20;
          }
          if (st.dir !== "out" && !st.hTyped) autoHeight();
          refresh(true);
        },
      },
    };
    openCmd(def);
  }
  return { cmd };
}
