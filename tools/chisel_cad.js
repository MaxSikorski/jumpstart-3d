/* ================= JumpStart 3D tools in Chisel =================
   The same tools as Beginner and Advanced, working on Chisel's objects:
   - Move (Beginner): drag on the workplane with grid snapping and snap guides; white size
     handles, the top height handle, the black lift arrow, the three rotation arcs; Tab to type
     sizes.
   - Sketch (Advanced): pick an origin plane or a face, draw rectangles, circles and polygons
     (typed sizes, grid snapping), then extrude: new body, join or cut. New bodies (and joins or
     cuts on untouched design bodies) are real sketch + extrude features in the design;
     sculpts are joined or cut with Chisel's mesh booleans.
   - Combine (Easy): pick two models, then join, cut or keep the overlap.
   Lengths shown and typed are in the design's units (mm or inches). */
const CAD = (() => {
  const MMU = 20; // mm per Chisel unit
  const V = (x = 0, y = 0, z = 0) => new V3(x, y, z);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const gridMM = () => { const g = host && host.grid ? +host.grid() : 1; return g > 0 ? g : 0; };
  const snapCfg = () => (host && host.snap ? host.snap() : { grid: true, obj: true, size: 1, sizes: [{ v: 1, label: '1 mm' }] });
  // the sketch grid as Advanced draws it: the snap size, or a multiple of it when zoomed out
  // (lines never closer than ~12 px); sketch points snap to it
  function gridView() {
    const c = snapCfg(), base = c.size || 1, mmPerPx = pxAt(sk.plane ? sk.plane.o : cam.target) * MMU;
    for (const m of inch() ? [1, 2, 4, 8, 16, 32, 64, 160, 320, 800, 1600] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (base * m / mmPerPx >= 12) return base * m;
    return base * 10000;
  }
  const sketchStep = () => (snapCfg().grid ? gridView() : 0);
  const inch = () => !!(host && host.inch && host.inch());
  const unitName = () => (inch() ? 'in' : 'mm');
  const toU = (mm) => (inch() ? mm / 25.4 : mm);
  const showLen = (mm, dp = 2) => String(+toU(mm).toFixed(inch() ? dp + 1 : dp));
  function parseLen(s) {
    s = String(s).trim().replace(',', '.');
    const v = parseFloat(s);
    if (!isFinite(v)) return NaN;
    const u = /in|"/.test(s) ? 'in' : /mm/.test(s) ? 'mm' : unitName();
    return u === 'in' ? v * 25.4 : v;
  }
  const rnd = (v, g) => (g > 0 ? Math.round(v / g) * g : v);
  const gU = () => (gridMM() || 0.01) / MMU; // grid step in Chisel units
  const pxAt = (p) => worldPerPx(camera.position.distanceTo(p));
  function screen(p) { const v = p.clone().project(camera), { w, h } = viewSize(); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z]; }
  const hitPlane = (x, y, pl) => { const out = V(); return worldRay(x, y).intersectPlane(pl, out) ? out : null; };
  const rc = new THREE.Raycaster();
  const rayAt = (x, y) => { rc.ray.copy(worldRay(x, y)); return rc; };

  // labels and number boxes over the view
  const layer = document.createElement('div'); layer.id = 'cadLayer'; view.append(layer);
  function label(cls) { const l = document.createElement('div'); l.className = 'clab ' + (cls || ''); l.hidden = true; layer.append(l); return l; }
  function place(elm, p) { const [x, y] = Array.isArray(p) ? p : screen(p); elm.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`; }

  // lines a set number of pixels wide (WebGL only draws 1 px lines), as Advanced draws sketches
  function thick(seg, color, w) {
    const pos = [], oth = [], side = [];
    const push = (P, Q, s) => { pos.push(P.x, P.y, P.z); oth.push(Q.x, Q.y, Q.z); side.push(s); };
    for (let k = 0; k + 1 < seg.length; k += 2) { const A = seg[k], B = seg[k + 1]; push(A, B, -1); push(A, B, 1); push(B, A, 1); push(A, B, 1); push(B, A, -1); push(B, A, 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOther', new THREE.Float32BufferAttribute(oth, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    const c = new THREE.Color(color);
    const m = new THREE.ShaderMaterial({
      uniforms: { uRes: { value: [800, 600] }, uW: { value: w }, uC: { value: [c.r, c.g, c.b] } },
      vertexShader: 'uniform vec2 uRes;uniform float uW;attribute vec3 aOther;attribute float aSide;void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.0);vec4 b=projectionMatrix*modelViewMatrix*vec4(aOther,1.0);vec2 sa=a.xy/a.w*uRes*.5;vec2 sb=b.xy/b.w*uRes*.5;vec2 d=sa-sb;float l=length(d);d=l>1e-5?d/l:vec2(1.0,0.0);vec2 n=vec2(-d.y,d.x);vec2 o=(d+n*aSide)*uW*.5;gl_Position=vec4(a.xy+o*2.0/uRes*a.w,a.z,a.w);}',
      fragmentShader: 'uniform vec3 uC;void main(){gl_FragColor=vec4(uC,1.0);\n#include <colorspace_fragment>\n}',
      depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    const o = new THREE.Mesh(g, m), tmp = new THREE.Vector2();
    o.frustumCulled = false; o.renderOrder = 22;
    o.onBeforeRender = (r) => { r.getSize(tmp); m.uniforms.uRes.value = [tmp.x, tmp.y]; };
    return o;
  }

  // ================================================================ Move (Beginner)
  const H = new THREE.Group(); H.visible = false; scene.add(H);
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x18202a, depthTest: false });
  const hotMat = new THREE.MeshBasicMaterial({ color: 0xe8a317, depthTest: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x18202a, depthTest: false });
  const boxG = new THREE.BoxGeometry(1, 1, 1), boxE = new THREE.EdgesGeometry(boxG);
  const coneG = new THREE.ConeGeometry(0.5, 1.2, 20); // points up (+Y is up here)
  function mkHandle(type, data) {
    const m = new THREE.Mesh(type === 'lift' ? coneG : boxG, type === 'lift' ? darkMat : whiteMat);
    const e = new THREE.LineSegments(type === 'lift' ? new THREE.EdgesGeometry(coneG) : boxE, edgeMat);
    m.add(e); m.renderOrder = 40; e.renderOrder = 41;
    m.userData.handle = { type, ...data };
    H.add(m);
    return m;
  }
  const foot = [];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx || sz) foot.push(mkHandle('size', { sx, sz }));
  const topH = mkHandle('height'), liftH = mkHandle('lift');
  // rotation arcs: around up (blue), around X (red), around depth (green), as in Beginner
  const ARC = Math.PI / 2.6;
  const AXES = { y: [V(0, 1, 0), 0x1f4fa8], x: [V(1, 0, 0), 0xb8352a], z: [V(0, 0, 1), 0x2f8a4c] };
  const rots = Object.entries(AXES).map(([ax, [, col]]) => {
    const mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false });
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 6, 32, ARC), mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), mat);
    tip.position.set(Math.cos(ARC), Math.sin(ARC), 0); tip.rotation.z = ARC; m.add(tip);
    m.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 24, ARC), new THREE.MeshBasicMaterial({ visible: false }))); // easier to grab
    m.renderOrder = 40; tip.renderOrder = 40;
    m.userData.handle = { type: 'rot', axis: ax };
    H.add(m);
    return m;
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 4, 96), new THREE.MeshBasicMaterial({ color: 0x1f4fa8, transparent: true, opacity: 0.6, depthTest: false }));
  ring.renderOrder = 39; ring.visible = false; scene.add(ring);
  const guideMat = new THREE.LineDashedMaterial({ color: 0xe8a317, dashSize: 0.06, gapSize: 0.05, depthTest: false });
  const guides = new THREE.LineSegments(new THREE.BufferGeometry(), guideMat); guides.renderOrder = 38; guides.frustumCulled = false; scene.add(guides);
  const dimL = { w: label(), d: label(), h: label(), z: label(), a: label('ang') };
  let hot = null, drag = null, dimEdit = null, rotKeys = null, keyStep = 0;
  // one undo step for a run of arrow-key presses
  function keyUndo() { const t = performance.now(); if (t - keyStep > 900) pushUndo(); keyStep = t; }
  function arrowKey(e) {
    const L = selList().filter((o) => o.visible); if (!L.length) return false;
    const up = e.key === 'ArrowUp', dn = e.key === 'ArrowDown', lt = e.key === 'ArrowLeft', rt = e.key === 'ArrowRight';
    if (rotKeys && L.length === 1 && L[0] === rotKeys.o && objects.includes(rotKeys.o) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const o = rotKeys.o, s = (rt || up ? 1 : -1) * (e.shiftKey ? 15 : 1), wb = worldBox(o), c = wb.getCenter(V());
      keyUndo();
      const R = new THREE.Quaternion().setFromAxisAngle(AXES[rotKeys.axis][0], s * Math.PI / 180);
      o.mesh.quaternion.premultiply(R); o.mesh.position.sub(c).applyQuaternion(R).add(c); o.mesh.updateMatrixWorld(true);
      dimL.a.hidden = false; dimL.a.textContent = (s > 0 ? '+' : '') + s + '°'; place(dimL.a, c); clearTimeout(arrowKey.t); arrowKey.t = setTimeout(() => { dimL.a.hidden = true; }, 1200);
      refreshObjPanelValues(); req(); return true;
    }
    const g = (gridMM() || 1) * (e.shiftKey ? 10 : 1) / MMU;
    const d = (e.ctrlKey || e.metaKey) ? (up ? V(0, g, 0) : dn ? V(0, -g, 0) : null) : up ? V(0, 0, -g) : dn ? V(0, 0, g) : lt ? V(-g, 0, 0) : rt ? V(g, 0, 0) : null;
    if (!d) return false;
    keyUndo();
    for (const o of L) { o.mesh.position.add(d); o.mesh.updateMatrixWorld(true); }
    refreshObjPanelValues(); req(); return true;
  }

  function bbOf(o) { if (!o._bb || o._bbRev !== o.rev || o._bbPos !== o.pos) { o._bb = Core.bboxOf(o.pos); o._bbRev = o.rev; o._bbPos = o.pos; } return o._bb; }
  // the selected object's box in its own frame (position + rotation, sizes include its scale)
  function frame() {
    if (S.tool !== 'xform' || sk.active) return null;
    const L = selList();
    if (L.length !== 1 || !L[0].visible) return null;
    const o = L[0], b = bbOf(o), s = o.mesh.scale;
    const a = V(b[0] * s.x, b[1] * s.y, b[2] * s.z), c = V(b[3] * s.x, b[4] * s.y, b[5] * s.z);
    const min = V(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.min(a.z, c.z)), max = V(Math.max(a.x, c.x), Math.max(a.y, c.y), Math.max(a.z, c.z));
    const m = new THREE.Matrix4().compose(o.mesh.position, o.mesh.quaternion, V(1, 1, 1));
    return { o, m, min, max };
  }
  // put the object's frame box at [min, max]: scale on its own axes, then shift
  function setBox(o, s0, p0, min0, max0, min, max) {
    const k = V((max.x - min.x) / (max0.x - min0.x || 1), (max.y - min.y) / (max0.y - min0.y || 1), (max.z - min.z) / (max0.z - min0.z || 1));
    o.mesh.scale.set(s0.x * k.x, s0.y * k.y, s0.z * k.z);
    const t = V(min.x - k.x * min0.x, min.y - k.y * min0.y, min.z - k.z * min0.z).applyQuaternion(o.mesh.quaternion);
    o.mesh.position.copy(p0).add(t);
    o.mesh.updateMatrixWorld(true);
  }
  function updateHandles() {
    const f = frame();
    H.visible = !!f;
    for (const l of Object.values(dimL)) l.hidden = true;
    if (dimEdit && (!f || f.o !== dimEdit.o)) closeDim();
    if (!f) { ring.visible = false; return; }
    const { o, m, min, max } = f, W = (p) => p.applyMatrix4(m), hs = coarse ? 1.8 : 1;
    const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
    for (const h of foot) {
      const { sx, sz } = h.userData.handle;
      h.position.copy(W(V(sx < 0 ? min.x : sx > 0 ? max.x : cx, min.y, sz < 0 ? min.z : sz > 0 ? max.z : cz)));
      h.scale.setScalar(pxAt(h.position) * (sx && sz ? 9 : 7) * hs);
      h.quaternion.setFromRotationMatrix(m);
      h.material = hot === h ? hotMat : whiteMat;
    }
    const tp = W(V(cx, max.y, cz)), ps = pxAt(tp);
    topH.position.copy(tp); topH.scale.setScalar(ps * 8 * hs); topH.quaternion.setFromRotationMatrix(m); topH.material = hot === topH ? hotMat : whiteMat;
    const up = V(0, 1, 0).transformDirection(m);
    liftH.position.copy(tp).addScaledVector(up, ps * 28); liftH.scale.setScalar(ps * 12 * hs);
    liftH.quaternion.setFromUnitVectors(V(0, 1, 0), up); liftH.material = hot === liftH ? hotMat : darkMat;
    const wb = worldBox(o), c = wb.getCenter(V()), size = wb.getSize(V());
    for (const h of rots) {
      const ax = h.userData.handle.axis, A = AXES[ax][0];
      const r = (ax === 'y' ? Math.max(size.x, size.z) : ax === 'x' ? Math.max(size.y, size.z) : Math.max(size.x, size.y)) / 2 + ps * 26;
      const pos = c.clone(); if (ax === 'y') pos.y = wb.min.y;
      const d = camera.position.clone().sub(pos); d.addScaledVector(A, -d.dot(A));
      if (d.lengthSq() < 1e-12) d.copy(ax === 'y' ? V(0, 0, 1) : V(0, 1, 0));
      d.normalize();
      const mid = ARC / 2, U = d.clone().multiplyScalar(Math.cos(mid)).addScaledVector(A.clone().cross(d), -Math.sin(mid)), Vv = A.clone().cross(U);
      h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, Vv, A));
      h.position.copy(pos); h.scale.setScalar(r * (hot === h ? 1.03 : 1));
      h.visible = !drag || (drag.kind === 'rot' && drag.axis === ax);
    }
    if (drag && drag.kind === 'rot') {
      ring.visible = true; ring.position.copy(drag.center); ring.quaternion.setFromUnitVectors(V(0, 0, 1), drag.axisV); ring.scale.setScalar(drag.radius);
      dimL.a.hidden = false; dimL.a.textContent = drag.angle + '°'; place(dimL.a, drag.center);
    } else ring.visible = false;
    // sizes while hovering or dragging a size handle, or typing them (Tab)
    const showing = dimEdit || (drag ? drag.kind === 'size' || drag.kind === 'height' : hot && /size|height/.test(hot.userData.handle.type));
    if (showing) {
      const cur = dimEdit ? dimEdit.keys[dimEdit.i] : null;
      const lab = (k, v, p) => {
        const s = screen(W(p));
        if (cur === k) { place(dimEdit.input, s); return; }
        dimL[k].hidden = false; dimL[k].textContent = showLen(v, 2); place(dimL[k], s);
      };
      lab('w', (max.x - min.x) * MMU, V(cx, min.y, max.z + ps * 18));
      lab('d', (max.z - min.z) * MMU, V(max.x + ps * 18, min.y, cz));
      lab('h', (max.y - min.y) * MMU, V(max.x, (min.y + max.y) / 2, max.z));
      if (dimEdit) { lab('z', liftOf(o), V(min.x - ps * 22, min.y, max.z + ps * 22)); dimL.z.textContent = '↑ ' + dimL.z.textContent; }
    }
  }
  const liftOf = (o) => (worldBox(o).min.y + 1) * MMU; // bottom height above the workplane, mm
  function pickHandle(x, y) {
    if (!H.visible) return null;
    const hits = rayAt(x, y).intersectObjects([...foot, topH, liftH, ...rots].filter((h) => h.visible), true);
    for (const hit of hits) { let o = hit.object; while (o && !o.userData.handle) o = o.parent; if (o) return o; }
    return null;
  }
  // a handle grabbed: resize, height, lift or rotate (one undo step, like Beginner)
  function startHandle(h, x, y) {
    const f = frame(); if (!f) return false;
    const info = h.userData.handle, o = f.o, m0 = f.m.clone(), inv = m0.clone().invert();
    const min0 = f.min.clone(), max0 = f.max.clone(), s0 = o.mesh.scale.clone(), p0 = o.mesh.position.clone(), q0 = o.mesh.quaternion.clone();
    pushUndo();
    if (info.type === 'size' || info.type === 'height') {
      let plane;
      if (info.type === 'size') plane = new THREE.Plane().setFromNormalAndCoplanarPoint(V(0, 1, 0).transformDirection(m0), V(0, min0.y, 0).applyMatrix4(m0));
      else {
        const axis = V(0, 1, 0).transformDirection(m0), toCam = camera.position.clone().sub(h.position);
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(toCam.sub(axis.clone().multiplyScalar(toCam.dot(axis))).normalize(), h.position);
      }
      drag = {
        kind: info.type,
        move(px, py, ev) {
          const p = hitPlane(px, py, plane); if (!p) return;
          const q = p.applyMatrix4(inv), g = gU(), min = min0.clone(), max = max0.clone();
          if (info.type === 'size') {
            if (info.sx > 0) max.x = Math.max(min0.x + g, min0.x + rnd(q.x - min0.x, g));
            if (info.sx < 0) min.x = Math.min(max0.x - g, max0.x - rnd(max0.x - q.x, g));
            if (info.sz > 0) max.z = Math.max(min0.z + g, min0.z + rnd(q.z - min0.z, g));
            if (info.sz < 0) min.z = Math.min(max0.z - g, max0.z - rnd(max0.z - q.z, g));
            if (ev.shiftKey && info.sx && info.sz) { // keep proportions
              const k = Math.max((max.x - min.x) / (max0.x - min0.x), (max.z - min.z) / (max0.z - min0.z));
              const w = (max0.x - min0.x) * k, d = (max0.z - min0.z) * k;
              if (info.sx > 0) max.x = min0.x + w; else min.x = max0.x - w;
              if (info.sz > 0) max.z = min0.z + d; else min.z = max0.z - d;
              max.y = min0.y + (max0.y - min0.y) * k;
            }
          } else max.y = Math.max(min0.y + g, min0.y + rnd(q.y - min0.y, g));
          setBox(o, s0, p0, min0, max0, min, max); drag.changed = true; req();
        },
      };
      return true;
    }
    if (info.type === 'lift') {
      const toCam = camera.position.clone().sub(h.position); toCam.y = 0;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(toCam.lengthSq() ? toCam.normalize() : V(0, 0, 1), h.position);
      const start = hitPlane(x, y, plane), L = selList(), base = L.map((x) => x.mesh.position.y);
      drag = {
        kind: 'lift',
        move(px, py) {
          const p = hitPlane(px, py, plane); if (!p || !start) return;
          const dy = rnd(p.y - start.y, gU());
          L.forEach((x, i) => { x.mesh.position.y = base[i] + dy; x.mesh.updateMatrixWorld(true); }); if (dy) drag.changed = true; req();
        },
      };
      return true;
    }
    if (info.type === 'rot') {
      const wb = worldBox(o), center = wb.getCenter(V()), axisV = AXES[info.axis][0];
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisV, center);
      const u = info.axis === 'y' ? V(1, 0, 0) : info.axis === 'x' ? V(0, 1, 0) : V(1, 0, 0), v = axisV.clone().cross(u);
      const angOf = (p) => Math.atan2(p.clone().sub(center).dot(v), p.clone().sub(center).dot(u));
      const pA = hitPlane(x, y, plane); if (!pA) { undoStack.pop(); updateUndoBtns(); return false; }
      rotKeys = { o, axis: info.axis };
      const a0 = angOf(pA);
      drag = {
        kind: 'rot', axis: info.axis, center, axisV, angle: 0, radius: h.scale.x,
        move(px, py, ev) {
          const p = hitPlane(px, py, plane); if (!p) return;
          let a = (angOf(p) - a0) * 180 / Math.PI;
          a = ((a + 540) % 360) - 180;
          a = ev.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
          drag.angle = a;
          const R = new THREE.Quaternion().setFromAxisAngle(axisV, a * Math.PI / 180);
          o.mesh.quaternion.copy(R).multiply(q0);
          o.mesh.position.copy(p0).sub(center).applyQuaternion(R).add(center);
          o.mesh.updateMatrixWorld(true); req();
        },
      };
      return true;
    }
    undoStack.pop(); updateUndoBtns();
    return false;
  }
  // dragging objects across the workplane (grid snapping, Shift keeps one direction, snap guides)
  function startMove(hit, x, y) {
    const L = selList(); if (!L.length) return;
    const plane = new THREE.Plane(V(0, 1, 0), -hit.point.y);
    const box = new THREE.Box3(); L.forEach((o) => box.union(worldBox(o)));
    const others = objects.filter((o) => o.visible && !L.includes(o)).map((o) => worldBox(o));
    drag = { kind: 'move', plane, start: hit.point.clone(), x0: x, y0: y, L, base: L.map((o) => o.mesh.position.clone()), box, others, moved: false,
      move(px, py, ev) {
        if (!drag.moved && Math.hypot(px - drag.x0, py - drag.y0) < 3) return;
        const p = hitPlane(px, py, plane); if (!p) return;
        if (!drag.moved) { drag.moved = true; pushUndo(); }
        const g = gU();
        let dx = rnd(p.x - drag.start.x, g), dz = rnd(p.z - drag.start.z, g);
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dz)) dz = 0; else dx = 0; }
        // line edges and centers up with the other objects (like Beginner)
        const tol = pxAt(p) * 6, segs = [];
        const snapAx = (k, d) => {
          const mine = [box.min[k] + d, (box.min[k] + box.max[k]) / 2 + d, box.max[k] + d];
          let best = null;
          for (const b of others) for (const t of [b.min[k], (b.min[k] + b.max[k]) / 2, b.max[k]]) for (const v of mine) { const e = t - v; if (Math.abs(e) < tol && (!best || Math.abs(e) < Math.abs(best.e))) best = { e, t, b }; }
          if (!best) return d;
          const o2 = k === 'x' ? 'z' : 'x', yy = Math.min(box.min.y, best.b.min.y) + 0.002;
          const lo = Math.min(box.min[o2] + (o2 === 'x' ? dx : dz), best.b.min[o2]), hi = Math.max(box.max[o2] + (o2 === 'x' ? dx : dz), best.b.max[o2]);
          segs.push(k === 'x' ? [best.t, yy, lo, best.t, yy, hi] : [lo, yy, best.t, hi, yy, best.t]);
          return d + best.e;
        };
        if (!ev.altKey && snapCfg().obj) { if (!(ev.shiftKey && dx === 0)) dx = snapAx('x', dx); if (!(ev.shiftKey && dz === 0)) dz = snapAx('z', dz); }
        guides.geometry.dispose(); guides.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(segs.flat(), 3)); guides.computeLineDistances();
        L.forEach((o, i) => { o.mesh.position.set(drag.base[i].x + dx, drag.base[i].y, drag.base[i].z + dz); o.mesh.updateMatrixWorld(true); });
        req();
      },
    };
  }
  let CAD_told = false;
  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    guides.geometry.dispose(); guides.geometry = new THREE.BufferGeometry();
    if (d.kind === 'rot' && !CAD_told) { CAD_told = true; toast('Fine-tune: arrow keys turn it 1° (Shift: 15°). Esc or a click stops.'); }
    if ((d.kind === 'rot' && !d.angle) || ((d.kind === 'size' || d.kind === 'height' || d.kind === 'lift') && !d.changed)) { undoStack.pop(); updateUndoBtns(); }
    updateSlicePreview(); refreshAll(); req();
  }
  // Tab: type width, depth, height and lift on the object (like Beginner)
  const DIMS = ['w', 'd', 'h', 'z'], DIM_NAME = { w: 'Width', d: 'Depth', h: 'Height', z: 'Lift' };
  function dimValue(f, k) { if (k === 'z') return liftOf(f.o); const a = { w: 'x', d: 'z', h: 'y' }[k]; return (f.max[a] - f.min[a]) * MMU; }
  function startDim(back) {
    const f = frame(); if (!f) return false;
    if (!dimEdit || dimEdit.o !== f.o) {
      closeDim();
      const input = document.createElement('input'); input.className = 'cdim'; input.inputMode = 'decimal'; layer.append(input);
      dimEdit = { o: f.o, i: back ? DIMS.length - 1 : 0, input, keys: DIMS };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); commitDim(); moveDim(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Enter') { e.preventDefault(); commitDim(); closeDim(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeDim(); }
      });
      input.addEventListener('blur', () => setTimeout(() => { if (dimEdit && dimEdit.input === input && document.activeElement !== input) { commitDim(); closeDim(); } }, 0));
    } else moveDim(back ? -1 : 1);
    showDim(); return true;
  }
  function moveDim(step) { if (!dimEdit) return; dimEdit.i = (dimEdit.i + step + DIMS.length) % DIMS.length; showDim(); }
  function showDim() {
    const f = frame(); if (!f || !dimEdit) return closeDim();
    const k = DIMS[dimEdit.i];
    dimEdit.input.value = showLen(dimValue(f, k), 3); dimEdit.orig = dimEdit.input.value;
    dimEdit.input.title = DIM_NAME[k] + ' in ' + unitName() + ' (Tab: next, Shift+Tab: back, Enter: done, Esc: cancel)';
    dimEdit.input.dataset.dim = DIM_NAME[k];
    req(); setTimeout(() => { if (dimEdit) { dimEdit.input.focus(); dimEdit.input.select(); } }, 0);
  }
  function commitDim() {
    if (!dimEdit || dimEdit.input.value === dimEdit.orig) return;
    const v = parseLen(dimEdit.input.value), f = frame();
    if (!f || !isFinite(v)) return;
    const k = DIMS[dimEdit.i], cur = dimValue(f, k);
    if (Math.abs(v - cur) < 1e-9) return;
    pushUndo();
    if (k === 'z') { f.o.mesh.position.y += (v - cur) / MMU; f.o.mesh.updateMatrixWorld(true); }
    else {
      if (v <= 0) { undoStack.pop(); updateUndoBtns(); return; }
      const a = { w: 'x', d: 'z', h: 'y' }[k], min = f.min.clone(), max = f.max.clone(), len = v / MMU;
      if (a === 'y') max.y = min.y + len; else { const c = (min[a] + max[a]) / 2; min[a] = c - len / 2; max[a] = c + len / 2; }
      setBox(f.o, f.o.mesh.scale.clone(), f.o.mesh.position.clone(), f.min, f.max, min, max);
    }
    dimEdit.orig = showLen(v, 3); refreshAll(); req();
  }
  function closeDim() { if (!dimEdit) return; const i = dimEdit.input; dimEdit = null; i.remove(); req(); }

  // ================================================================ Sketch + Extrude (Advanced)
  const sk = { active: false, stage: null, plane: null, onObj: null, shapes: [], tool: 'rect', sides: 6, cur: null, hov: null, dist: 10, op: 'auto', sel: new Set(), hovPlane: null, fields: null };
  const SKG = new THREE.Group(); SKG.renderOrder = 20; scene.add(SKG);
  const PL = { // the origin planes, as Advanced shows them (in Chisel's Y-up space)
    XY: { name: 'XY · Top', color: 0x2f6fd0, n: V(0, 1, 0), x: V(1, 0, 0) },
    XZ: { name: 'XZ · Front', color: 0x3f9b52, n: V(0, 0, 1), x: V(1, 0, 0) },
    YZ: { name: 'YZ · Right', color: 0xd9534f, n: V(1, 0, 0), x: V(0, 0, -1) },
  };
  const ORIGIN = V(0, -1, 0); // the design's origin
  let gizmo = [], gizmoTags = [];
  const COL = { sketch: '#22303f', fill: '#8fb4ea', minor: '#8b9aaa', major: '#506072', preview: '#1f4fa8' };
  // sketch points: a white ring around a dot in the sketch color
  function dots(P) {
    const g = new THREE.Group();
    for (const [size, color] of [[11, 0xffffff], [7, COL.sketch]]) {
      const geo = new THREE.BufferGeometry().setFromPoints(P.map((q) => toW(q[0], q[1])));
      const m = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true }));
      m.renderOrder = 23 + (size < 10 ? 1 : 0); g.add(m);
    }
    return g;
  }
  function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); c.traverse((x) => { x.geometry && x.geometry.dispose(); x.material && x.material.dispose(); }); } }
  function basis(x, n) { const y = n.clone().cross(x); return new THREE.Matrix4().makeBasis(x, y, n); }
  function showGizmo(on) {
    gizmo.forEach((m) => { scene.remove(m); m.traverse((x) => { x.geometry && x.geometry.dispose(); x.material && x.material.dispose(); }); });
    gizmoTags.forEach((t) => t.remove()); gizmo = []; gizmoTags = [];
    if (!on) { req(); return; }
    const s = Math.max(30, cam.r * MMU * 0.18) / MMU;
    const OFF = { XY: [0, -1], XZ: [0, 0], YZ: [-1, 0] }; // an open corner toward the camera (as in Advanced)
    for (const [k, pl] of Object.entries(PL)) {
      const M = basis(pl.x, pl.n).setPosition(ORIGIN);
      const [ox, oy] = OFF[k].map((v) => v * s);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).translate(s / 2 + ox, s / 2 + oy, 0), new THREE.MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.matrixAutoUpdate = false; m.matrix.copy(M); m.renderOrder = 17; m.userData.plane = k;
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(ox, oy), V(s + ox, oy), V(s + ox, s + oy), V(ox, s + oy)]), new THREE.LineBasicMaterial({ color: pl.color }));
      m.add(edge); edge.renderOrder = 18;
      scene.add(m); gizmo.push(m);
      const tag = label('pltag'); tag.hidden = false; tag.textContent = pl.name; tag.style.background = '#' + pl.color.toString(16).padStart(6, '0');
      tag.userData = V(ox ? -s * 0.72 : s * 0.72, oy ? -s * 0.8 : s * 0.86, 0).applyMatrix4(M); gizmoTags.push(tag);
    }
    req();
  }
  function hotGizmo(m) { for (const g of gizmo) { const h = g === m; g.material.opacity = h ? 0.55 : 0.3; g.children[0].material.color.set(h ? 0xe8a317 : PL[g.userData.plane].color); } req(); }
  const faceHint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe8a317, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }));
  faceHint.visible = false; faceHint.renderOrder = 19; scene.add(faceHint);

  // plane coordinates (mm) <-> world
  const toW = (u, v, w = 0) => sk.plane.o.clone().addScaledVector(sk.plane.x, u / MMU).addScaledVector(sk.plane.y, v / MMU).addScaledVector(sk.plane.n, w / MMU);
  function toUV(x, y) {
    const p = hitPlane(x, y, sk.plane.pl); if (!p) return null;
    const d = p.sub(sk.plane.o); return [d.dot(sk.plane.x) * MMU, d.dot(sk.plane.y) * MMU];
  }
  function polyOf(s) {
    if (s.t === 'rect') return [s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]]];
    if (s.t === 'circle') { const P = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; P.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); } return P; }
    const P = []; for (let i = 0; i < s.n; i++) { const a = s.rot + i / s.n * Math.PI * 2; P.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); } return P;
  }
  const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const ccw = (P) => (area(P) < 0 ? P.slice().reverse() : P);
  // key points to snap to: corners and centers of the shapes drawn
  function keyPts() {
    const out = [[0, 0]];
    for (const s of sk.shapes) { if (s.t === 'rect') out.push(...polyOf(s), [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]); else { out.push(s.c); if (s.t === 'poly') out.push(...polyOf(s)); } }
    return out;
  }
  // corners of the design's bodies (and bounding-box corners of sculpts) on the sketch plane
  let objPts = null;
  function objectPts() {
    if (objPts && objPts.plane === sk.plane) return objPts.pts;
    const pts = [], P = sk.plane, tol = 0.1 / MMU, v = V();
    for (const o of objects) {
      if (!o.visible) continue;
      o.mesh.updateMatrixWorld(true);
      const src = o.refDisp && o.snap === o.refSnap ? o.refDisp.pos : null;
      const add = (w) => { const d = w.clone().sub(P.o); if (Math.abs(d.dot(P.n)) < tol) pts.push([d.dot(P.x) * MMU, d.dot(P.y) * MMU]); };
      if (src) for (let i = 0; i < src.length; i += 3) add(v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(o.mesh.matrixWorld));
      else { const b = worldBox(o); for (const X of [b.min.x, b.max.x]) for (const Y of [b.min.y, b.max.y]) for (const Z of [b.min.z, b.max.z]) add(V(X, Y, Z)); }
    }
    objPts = { plane: P, pts }; return pts;
  }
  function snapUV(uv, x, y) {
    let best = null, bd = 9;
    const cand = snapCfg().obj ? [...keyPts(), ...objectPts()] : keyPts();
    for (const q of cand) { const s = screen(toW(q[0], q[1])), d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = q; } }
    if (best) return [best[0], best[1]];
    const g = sketchStep(); return [rnd(uv[0], g), rnd(uv[1], g)];
  }
  // the camera turns to look straight at the sketch plane (as in Advanced)
  function lookAt(n, target) {
    const th1 = Math.abs(n.y) > 0.999 ? 0 : Math.atan2(n.x, n.z), ph1 = Math.min(Math.PI - 0.05, Math.max(0.05, Math.acos(Math.max(-1, Math.min(1, n.y)))));
    if (typeof CUBE !== 'undefined') CUBE.stop();
    cam.roll = 0;
    const th0 = cam.th, ph0 = cam.ph, t0 = cam.target.clone();
    let dth = ((th1 - th0) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const t1 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t1) / 320), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.th = th0 + dth * e; cam.ph = ph0 + (ph1 - ph0) * e; cam.target.lerpVectors(t0, target, e); updateCam();
      if (k < 1) requestAnimationFrame(step); else redrawSketch();
    };
    requestAnimationFrame(step);
  }
  function startSketch() {
    if (sk.active) return;
    Object.assign(sk, { active: true, stage: 'plane', plane: null, onObj: null, shapes: [], cur: null, hov: null, dist: 10, op: 'auto', sel: new Set(), fields: null });
    closeDim(); showGizmo(true); renderToolSec(); refreshStatus();
  }
  function setPlane(o, x, n, onObj) {
    n = n.clone().normalize(); x = x.clone().addScaledVector(n, -x.dot(n)).normalize();
    const y = n.clone().cross(x);
    sk.plane = { o, x, y, n, pl: new THREE.Plane().setFromNormalAndCoplanarPoint(n, o) };
    sk.onObj = onObj || null; sk.stage = 'draw';
    showGizmo(false); faceHint.visible = false;
    // look at the plane, around where the camera was looking (or the face that was clicked)
    const t = cam.target.clone(), aim = onObj ? onObj.point : t;
    lookAt(n, aim.clone().addScaledVector(n, -aim.clone().sub(o).dot(n)));
    redrawSketch(); renderToolSec(); refreshStatus();
  }
  function planeFromHit(hit) {
    let n = hit.nW.clone().normalize();
    for (const a of [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]) { const d = n.dot(a); if (Math.abs(Math.abs(d) - 1) < 0.002) n = a.clone().multiplyScalar(Math.sign(d)); }
    const x = Math.abs(n.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0).cross(n).normalize();
    // origin: the design's origin, moved onto the face's plane (so the grid lines up)
    const o = ORIGIN.clone().addScaledVector(n, -ORIGIN.clone().sub(hit.point).dot(n));
    return { o, x, n };
  }
  function exitSketch() {
    if (!sk.active) return;
    sk.active = false; sk.stage = null; sk.cur = null; sk.shapes = [];
    showGizmo(false); faceHint.visible = false; clearGroup(SKG); hideFields(); hideCursor(); req();
  }
  // ---- drawing
  const cursorDot = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0xe8a317, depthTest: false }));
  cursorDot.renderOrder = 25; cursorDot.visible = false; scene.add(cursorDot);
  function showCursor(uv) {
    if (!uv) return hideCursor();
    const p = toW(uv[0], uv[1]);
    cursorDot.position.copy(p); cursorDot.quaternion.setFromRotationMatrix(basis(sk.plane.x, sk.plane.n)); cursorDot.scale.setScalar(pxAt(p) * 3.5); cursorDot.visible = true; req();
  }
  function hideCursor() { cursorDot.visible = false; }
  function curShape() {
    const c = sk.cur; if (!c || !c.p) return null;
    const F = sk.fields ? Object.fromEntries(sk.fields.list.map((f) => [f.key, !f.locked ? null : f.key === 'n' ? parseInt(f.input.value, 10) : parseLen(f.input.value)])) : {};
    const a = c.start, p = c.p;
    if (sk.tool === 'rect') {
      let w = p[0] - a[0], h = p[1] - a[1];
      if (isFinite(F.w) && F.w > 0) w = (Math.sign(w) || 1) * F.w;
      if (isFinite(F.h) && F.h > 0) h = (Math.sign(h) || 1) * F.h;
      return { t: 'rect', a: a.slice(), b: [a[0] + w, a[1] + h] };
    }
    let r = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (sk.tool === 'circle') { if (isFinite(F.d) && F.d > 0) r = F.d / 2; return { t: 'circle', c: a.slice(), r }; }
    if (isFinite(F.r) && F.r > 0) r = F.r;
    const n = Math.max(3, Math.min(64, isFinite(F.n) && F.n > 0 ? F.n : sk.sides));
    return { t: 'poly', c: a.slice(), r, n, rot: Math.atan2(p[1] - a[1], p[0] - a[0]) };
  }
  function validShape(s) { return s && (s.t === 'rect' ? Math.abs(s.b[0] - s.a[0]) > 1e-4 && Math.abs(s.b[1] - s.a[1]) > 1e-4 : s.r > 1e-4); }
  function commitShape() {
    const s = curShape();
    if (!validShape(s)) return false;
    if (s.t === 'poly') sk.sides = s.n;
    sk.shapes.push(s); sk.cur = null; hideFields(); redrawSketch(); renderToolSec();
    return true;
  }
  // number boxes next to the pointer while drawing (type a size, Tab to the next, Enter)
  function showFields() {
    const defs = sk.tool === 'rect' ? [['w', 'Width'], ['h', 'Height']] : sk.tool === 'circle' ? [['d', 'Diameter']] : [['r', 'Radius'], ['n', 'Sides']];
    if (!sk.fields || sk.fields.tool !== sk.tool) {
      hideFields();
      const box = document.createElement('div'); box.className = 'cinp'; layer.append(box);
      const list = defs.map(([key, name]) => {
        const lab = document.createElement('label'); lab.innerHTML = `<span>${name}</span>`;
        const input = document.createElement('input'); input.inputMode = 'decimal'; lab.append(input); box.append(lab);
        const f = { key, name, input, locked: false };
        input.addEventListener('input', () => { f.locked = input.value.trim() !== ''; redrawSketch(); });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Tab') { e.preventDefault(); const L = sk.fields.list, i = L.indexOf(f); const nx = L[(i + (e.shiftKey ? -1 : 1) + L.length) % L.length]; nx.input.focus(); nx.input.select(); }
          else if (e.key === 'Enter') { e.preventDefault(); commitShape(); input.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); sk.cur = null; hideFields(); redrawSketch(); }
        });
        return f;
      });
      sk.fields = { tool: sk.tool, box, list };
    }
    const s = curShape(); if (!s) return;
    const vals = s.t === 'rect' ? { w: Math.abs(s.b[0] - s.a[0]), h: Math.abs(s.b[1] - s.a[1]) } : s.t === 'circle' ? { d: s.r * 2 } : { r: s.r, n: s.n };
    for (const f of sk.fields.list) if (!f.locked && document.activeElement !== f.input) f.input.value = f.key === 'n' ? String(vals.n) : showLen(vals[f.key], 2);
    const at = s.t === 'rect' ? toW(Math.max(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1])) : toW(s.c[0] + s.r, s.c[1]);
    const sc = screen(at); sk.fields.box.style.transform = `translate(${sc[0] + 14}px, ${sc[1] + 14}px)`;
  }
  function hideFields() { if (sk.fields) { sk.fields.box.remove(); sk.fields = null; } }
  // ---- what the sketch looks like
  function lineObj(P, color, closed = true, opacity = 1, w = 2.5) {
    const pts = P.map((q) => toW(q[0], q[1]));
    if (w) { const seg = []; for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) seg.push(pts[i], pts[(i + 1) % pts.length]); return thick(seg, color, w); }
    const g = new THREE.BufferGeometry().setFromPoints(closed ? [...pts, pts[0]] : pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity }));
    l.renderOrder = 22; return l;
  }
  function fillObj(P, color, opacity) {
    const shape = new THREE.Shape(ccw(P).map((q) => new THREE.Vector2(q[0], q[1])));
    const g = new THREE.ShapeGeometry(shape); const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const w = toW(pos.getX(i), pos.getY(i), 0.05); pos.setXYZ(i, w.x, w.y, w.z); }
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 21; return m;
  }
  function gridObj() {
    const g = gridView(), ext = Math.max(g * 30, Math.ceil(viewSize().w * pxAt(sk.plane.o) * MMU * 0.8 / (g * 10)) * g * 10);
    sk.gridShown = g;
    const P = [], C = [], cMinor = new THREE.Color(COL.minor), cMajor = new THREE.Color(COL.major);
    const c = toUV0(), u0 = rnd(c[0], g * 10), v0 = rnd(c[1], g * 10);
    for (let i = -Math.ceil(ext / g); i <= Math.ceil(ext / g); i++) {
      const t = i * g, major = i % 10 === 0;
      const cc = major ? cMajor : cMinor;
      for (const [a, b] of [[[u0 + t, v0 - ext], [u0 + t, v0 + ext]], [[u0 - ext, v0 + t], [u0 + ext, v0 + t]]]) {
        const A = toW(a[0], a[1], 0.01), B = toW(b[0], b[1], 0.01); P.push(A.x, A.y, A.z, B.x, B.y, B.z); C.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 })); l.renderOrder = 16;
    return l;
  }
  // the point of the plane in the middle of the view (where the grid is drawn around)
  function toUV0() { const p = cam.target.clone().sub(sk.plane.o); return [p.dot(sk.plane.x) * MMU, p.dot(sk.plane.y) * MMU]; }
  function redrawSketch() {
    clearGroup(SKG);
    if (!sk.active || !sk.plane) { req(); return; }
    if (sk.stage === 'draw') SKG.add(gridObj());
    const ax = (P, c) => { const pts = P.map((q) => toW(q[0], q[1])); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: c, dashSize: 0.1, gapSize: 0.06, depthTest: false, transparent: true })); l.computeLineDistances(); l.renderOrder = 21; SKG.add(l); };
    const e = Math.max(60, cam.r * MMU * 0.5);
    ax([[-e, 0], [e, 0]], 0xd9534f); ax([[0, -e], [0, e]], 0x3f9b52);
    sk.shapes.forEach((s, i) => {
      const P = polyOf(s), on = sk.stage !== 'extrude' || sk.sel.has(i);
      const f = fillObj(P, sk.stage === 'extrude' ? (on ? TH.accent : 0x9fbfec) : 0x9fbfec, sk.stage === 'extrude' ? (on ? 0.35 : 0.08) : 0.22);
      f.userData.shape = i; SKG.add(f); SKG.add(lineObj(P, COL.sketch));
    });
    if (sk.stage === 'draw') { const s = curShape(); if (validShape(s)) { SKG.add(lineObj(polyOf(s), COL.preview)); showFields(); } }
    // corner and center points, as Advanced shows them
    if (sk.stage === 'draw') SKG.add(dots(keyPts().slice(1)));
    if (sk.stage === 'extrude') drawExtrude();
    req();
  }
  // ---- extrude
  const arrow = new THREE.Group();
  { const m = new THREE.MeshBasicMaterial({ color: 0x18202a, depthTest: false }); const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8).translate(0, 0.5, 0), m); const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16).translate(0, 1.1, 0), m); shaft.renderOrder = head.renderOrder = 42; arrow.add(shaft, head); arrow.userData.handle = { type: 'extrude' }; arrow.visible = false; scene.add(arrow); }
  const extLabel = label('ext');
  function selShapes() { return sk.shapes.filter((_, i) => sk.sel.has(i)); }
  function centroidUV(list) { let u = 0, v = 0, n = 0; for (const s of list) { const P = polyOf(s); for (const q of P) { u += q[0]; v += q[1]; n++; } } return n ? [u / n, v / n] : [0, 0]; }
  // one closed prism per shape, in world space, from w0 to w1 mm along the plane normal
  function prismTris(P, w0, w1) {
    P = ccw(P); if (w1 < w0) [w0, w1] = [w1, w0];
    const out = [], B = P.map((q) => toW(q[0], q[1], w0)), T = P.map((q) => toW(q[0], q[1], w1)), push = (...vs) => { for (const v of vs) out.push(v.x, v.y, v.z); };
    for (let i = 1; i < P.length - 1; i++) { push(T[0], T[i], T[i + 1]); push(B[0], B[i + 1], B[i]); }
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; push(B[i], B[j], T[j]); push(B[i], T[j], T[i]); }
    return new Float32Array(out);
  }
  const prisms = () => selShapes().map((s) => prismTris(polyOf(s), 0, sk.dist));
  function prismBox() { const b = new THREE.Box3(); for (const T of prisms()) for (let i = 0; i < T.length; i += 3) b.expandByPoint(V(T[i], T[i + 1], T[i + 2])); return b; }
  function participants() {
    const b = prismBox().expandByScalar(1e-3);
    return objects.filter((o) => o.visible && worldBox(o).intersectsBox(b));
  }
  function resolvedOp() {
    if (sk.op !== 'auto') return sk.op;
    const parts = participants();
    if (!parts.length) return 'new';
    if (sk.onObj) return sk.dist < 0 ? 'cut' : 'join';
    return 'new';
  }
  function drawExtrude() {
    const op = resolvedOp(), cut = op === 'cut';
    for (const T of prisms()) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(T, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: cut ? 0xe5484d : 0x4a90e2, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = 23; SKG.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: cut ? 0xb8352a : 0x1f4fa8, depthTest: false, transparent: true, opacity: 0.8 }));
      e.renderOrder = 24; SKG.add(e);
    }
    const c = centroidUV(selShapes()), base = toW(c[0], c[1], 0), tipW = toW(c[0], c[1], sk.dist), ps = pxAt(base);
    arrow.visible = true; arrow.position.copy(tipW); arrow.quaternion.setFromUnitVectors(V(0, 1, 0), sk.plane.n.clone().multiplyScalar(sk.dist < 0 ? -1 : 1));
    arrow.scale.setScalar(ps * 34 * (coarse ? 1.6 : 1));
    arrow.children.forEach((m) => { m.material.color.set(hotArrow ? 0xe8a317 : TH.accent); });
    extLabel.hidden = false; extLabel.textContent = showLen(sk.dist, 2) + ' ' + unitName() + ' · ' + OPN()[op]; place(extLabel, screen(tipW).map((v, i) => (i === 1 ? v - 30 : v)));
  }
  let hotArrow = false, extDrag = null;
  const OPN = () => (S.easy ? { auto: 'Automatic', new: 'New shape', join: 'Add on', cut: 'Cut away' } : { auto: 'Auto', new: 'New body', join: 'Join', cut: 'Cut' });
  function toExtrude() {
    if (!sk.shapes.length) { toast('Draw a rectangle, circle or polygon first', true); return; }
    if (sk.cur) commitShape();
    sk.stage = 'extrude'; sk.sel = new Set(sk.shapes.map((_, i) => i)); hideFields(); hideCursor();
    // a flat view of the sketch hides the extrusion: tilt the camera a little
    if (Math.abs(camera.getWorldDirection(V()).dot(sk.plane.n)) > 0.97) { cam.ph = Math.max(0.05, Math.min(Math.PI - 0.05, cam.ph + (cam.ph < Math.PI / 2 ? 0.55 : -0.55))); cam.th += 0.45; updateCam(); }
    redrawSketch(); renderToolSec();
  }
  async function applyExtrude() {
    const list = selShapes();
    if (!list.length) { toast('Pick at least one shape to extrude', true); return; }
    if (Math.abs(sk.dist) < 1e-6) { toast('Set a distance first', true); return; }
    const op = resolvedOp(), parts = participants();
    const planeJ = () => {
      const o = sk.plane.o.clone().applyMatrix4(C2J), dir = (v) => V(v.x, -v.z, v.y);
      return { o: [o.x, o.y, o.z].map((v) => +v.toFixed(6)), x: dir(sk.plane.x).toArray().map((v) => +v.toFixed(9)), n: dir(sk.plane.n).toArray().map((v) => +v.toFixed(9)) };
    };
    const shapesJ = list.map((s) => (s.t === 'circle' ? { t: 'circle', c: s.c, r: s.r } : { t: 'poly', pts: polyOf(s), rect: s.t === 'rect' }));
    const dist = sk.dist, plane = planeJ();
    const T = prisms(), Tm = list.map((s) => prismTris(polyOf(s), dist > 0 ? -0.05 : 0.05, dist));
    const raw = (o) => !!o.ref && !o.jsId && !refTouched(o); // an untouched design body (still CAD)
    let targets = [];
    if (op === 'join') targets = parts.length ? [sk.onObj && parts.includes(sk.onObj.obj) ? sk.onObj.obj : parts[0]] : [];
    if (op === 'cut') targets = parts;
    if (op === 'cut' && !targets.length) { toast('The shape does not reach any model to cut', true); return; }
    const meshT = targets.filter((o) => !raw(o)), cadT = targets.filter(raw);
    const isNew = op === 'new' || (op === 'join' && !targets.length);
    exitSketch(); S.tool = 'xform';
    $('#busyText').textContent = isNew ? 'Extruding' : op === 'cut' ? 'Cutting' : 'Joining'; $('#busy').hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    let made = null;
    try {
      if (meshT.length) {
        pushUndo();
        for (const o of meshT) {
          let cur = worldTris(o);
          for (const P of Tm) cur = Core.csg(op === 'join' ? 'union' : 'subtract', cur, P);
          if (!cur.length) toast('Nothing would be left of ' + o.name, true);
          else applyWorldResult(o, cur);
        }
      }
      if ((isNew || cadT.length) && host && host.cadExtrude) {
        const res = await host.cadExtrude({ mode: isNew ? 'new' : op, bodies: cadT.map((o) => o.ref), plane, shapes: shapesJ, dist });
        if (!res || !res.ok) toast('Could not extrude: ' + ((res && res.error) || 'unknown problem'), true);
        else {
          undoStack.push({ host: res.label }); if (undoStack.length > 40) undoStack.shift(); redoStack = []; updateUndoBtns();
          if (res.id) made = objects.find((o) => o.ref === res.id);
        }
      } else if (isNew) {
        // no design to add to (Chisel on its own): a mesh object
        pushUndo();
        let all = T[0]; for (let i = 1; i < T.length; i++) all = Core.csg('union', all, T[i]);
        const m = Core.cleanMesh(all); const c = Core.bboxOf(m.pos), cx = (c[0] + c[3]) / 2, cy = (c[1] + c[4]) / 2, cz = (c[2] + c[5]) / 2;
        for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] -= cx; m.pos[i + 1] -= cy; m.pos[i + 2] -= cz; }
        made = createObj(uniqueName('Extrude'), m.pos, m.idx, objects.length % MATCAPS.length); made.mesh.position.set(cx, cy, cz);
      }
    } catch (err) { console.error(err); toast('Something went wrong: ' + (err.message || err), true); }
    $('#busy').hidden = true;
    if (made) select(made); else if (targets.length) selectMany(targets.filter((o) => objects.includes(o)));
    setTool('xform'); refreshAll(); req();
    toast(isNew ? 'Extruded · ' + showLen(Math.abs(dist)) + ' ' + unitName() : op === 'cut' ? 'Cut' : 'Joined');
  }
  // ---- Combine (Easy): pick two models, then join / cut / keep the overlap
  const cb = { a: null, b: null };
  function combinePick(o) {
    if (o === cb.a) { cb.a = cb.b; cb.b = null; }
    else if (o === cb.b) cb.b = null;
    else if (!cb.a) cb.a = o;
    else cb.b = o;
    selectMany([cb.a, cb.b].filter(Boolean)); if (cb.a) sel = cb.a;
    refreshAll(); renderToolSec();
  }
  function combineValid() { if (cb.a && !objects.includes(cb.a)) cb.a = null; if (cb.b && !objects.includes(cb.b)) cb.b = null; }

  // ================================================================ panel
  const ICON = {
    rect: '<rect x="3.5" y="5" width="13" height="10" rx="1"/>',
    circle: '<circle cx="10" cy="10" r="6.5"/>',
    poly: '<path d="M10 3.5l6 4.4-2.3 7.1H6.3L4 7.9z"/>',
    extrude: '<path d="M4 14h12M6 14V8h8v6"/><path d="M10 7V2.5M8 4.5l2-2 2 2"/>',
    join: '<circle cx="7.5" cy="10" r="5"/><circle cx="12.5" cy="10" r="5"/>',
    cut: '<circle cx="7.5" cy="10" r="5"/><circle cx="12.5" cy="10" r="5" stroke-dasharray="2 1.6"/>',
    inter: '<path d="M10 5.7a5 5 0 0 1 0 8.6 5 5 0 0 1 0-8.6z" fill="currentColor" fill-opacity=".35"/><circle cx="7.5" cy="10" r="5" opacity=".5"/><circle cx="12.5" cy="10" r="5" opacity=".5"/>',
    swap: '<path d="M6 4v12M3.5 6.5L6 4l2.5 2.5M14 16V4M11.5 13.5L14 16l2.5-2.5"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICON[k]}</svg>`;
  function renderSec() {
    const sec = $('#toolSec');
    if (S.tool === 'combine') return renderCombine(sec);
    const easy = S.easy, TN = { rect: 'Rectangle', circle: 'Circle', poly: 'Polygon' }, TK = { rect: 'R', circle: 'C', poly: 'P' };
    let h = `<h2><span class="dot"></span>${sk.stage === 'extrude' ? 'Extrude' : 'Sketch'}<em>${sk.stage === 'extrude' ? 'E' : ''}</em></h2>`;
    if (sk.stage === 'plane') {
      h += `<p class="hint ehint">Click a plane, or a flat face of a model, to sketch on.</p><div class="cad-pl">${Object.entries(PL).map(([k, p]) => `<button class="action" data-pl="${k}"><i style="background:#${p.color.toString(16).padStart(6, '0')}"></i>${p.name}</button>`).join('')}</div>`;
      h += `<div class="acts two cad-foot"><button class="action" data-act="cancel">Cancel</button></div>`;
    } else if (sk.stage === 'draw') {
      h += `<p class="hint ehint">${sk.tool === 'rect' ? 'Click two corners (or drag).' : sk.tool === 'circle' ? 'Click the center, then the edge.' : 'Click the center, then a corner.'} Type a size to make it exact${easy ? '' : ' (Tab: next box)'}.</p>`;
      h += `<div class="cad-tools">${['rect', 'circle', 'poly'].map((t) => `<button class="cadt" data-skt="${t}" aria-pressed="${sk.tool === t}" title="${TN[t]} (${TK[t]})">${ic(t)}<span>${TN[t]}</span></button>`).join('')}</div>`;
      if (sk.tool === 'poly') h += `<label class="row" for="cadSides"><span>Sides</span><input type="range" id="cadSides" min="3" max="12" step="1" value="${sk.sides}"><output>${sk.sides}</output></label>`;
      h += `<p class="hint">${sk.shapes.length ? `<b>${sk.shapes.length}</b> shape${sk.shapes.length > 1 ? 's' : ''} drawn.` : 'Nothing drawn yet.'}</p>` + snapRow();
      h += `<div class="acts cad-foot"><button class="action primary-act" data-act="extrude" ${sk.shapes.length ? '' : 'disabled'}>${ic('extrude')} Extrude (E)</button><button class="action" data-act="undo" ${sk.shapes.length ? '' : 'disabled'}>Undo shape</button><button class="action" data-act="cancel">Cancel</button></div>`;
    } else if (sk.stage === 'extrude') {
      const op = resolvedOp();
      h += `<p class="hint ehint">Drag the arrow or type a distance${easy ? '' : ' (negative goes the other way)'}. Click a shape to leave it out or add it back.</p>`;
      h += `<label class="row cad-dist" for="cadDist"><span>Distance</span><input type="text" id="cadDist" inputmode="decimal" value="${showLen(sk.dist, 3)}"><output>${unitName()}</output></label>`;
      h += `<div class="sub"><div class="sub-h">Result</div><div class="seg cad-op">${['auto', 'new', 'join', 'cut'].map((o) => `<button type="button" data-op="${o}" aria-pressed="${sk.op === o}">${OPN()[o]}</button>`).join('')}</div>${sk.op === 'auto' ? `<p class="hint">Automatic: <b id="cadAuto">${OPN()[op]}</b>${op === 'new' ? (easy ? ' (a new shape you can sculpt or move)' : ' (a new body in your design, editable in Advanced)') : op === 'cut' ? ' (from the model it touches)' : ' (onto the model you sketched on)'}.</p>` : ''}</div>`;
      h += `<div class="acts cad-foot"><button class="action primary-act" data-act="ok">OK (Enter)</button><button class="action" data-act="back">Back to sketch</button><button class="action" data-act="cancel">Cancel</button></div>`;
    }
    sec.innerHTML = h;
    wireSnap(sec);
    sec.querySelectorAll('[data-pl]').forEach((b) => b.addEventListener('click', () => { const p = PL[b.dataset.pl]; setPlane(ORIGIN.clone(), p.x, p.n, null); }));
    sec.querySelectorAll('[data-skt]').forEach((b) => b.addEventListener('click', () => { sk.tool = b.dataset.skt; sk.cur = null; hideFields(); redrawSketch(); renderToolSec(); }));
    const sides = $('#cadSides', sec); if (sides) sides.addEventListener('input', () => { sk.sides = +sides.value; sides.nextElementSibling.textContent = sides.value; redrawSketch(); });
    const dist = $('#cadDist', sec);
    if (dist) {
      dist.addEventListener('input', () => { const v = parseLen(dist.value); if (isFinite(v) && v !== 0) { sk.dist = v; redrawSketch(); const o = $('#cadAuto'); if (o) o.textContent = OPN()[resolvedOp()]; } });
      dist.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); applyExtrude(); } if (e.key === 'Escape') { e.preventDefault(); back(); } });
      dist.addEventListener('change', () => renderToolSec());
    }
    sec.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => { sk.op = b.dataset.op; redrawSketch(); renderToolSec(); }));
    sec.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'cancel') { exitSketch(); setTool('xform'); }
      else if (a === 'extrude') toExtrude();
      else if (a === 'undo') { sk.shapes.pop(); redrawSketch(); renderToolSec(); }
      else if (a === 'ok') applyExtrude();
      else if (a === 'back') back();
    }));
  }
  // Snap to (grid / objects), the same settings as the status bar's Snap to menu
  function snapRow() {
    const c = snapCfg(), g = sk.active && sk.plane ? gridView() : c.size;
    return `<div class="cad-snap"><div class="sub-h">Snap to</div><div class="cad-snap-row"><label><input type="checkbox" data-snapk="grid" ${c.grid ? 'checked' : ''}> Grid</label><select data-snapk="size" ${c.grid ? '' : 'disabled'} aria-label="Grid size">${c.sizes.map((o) => `<option value="${o.v}" ${Math.abs(o.v - c.size) < 1e-9 ? 'selected' : ''}>${o.label}</option>`).join('')}</select><label><input type="checkbox" data-snapk="obj" ${c.obj ? 'checked' : ''}> Objects</label></div>${c.grid && sk.active && sk.plane && Math.abs(g - c.size) > 1e-9 ? `<p class="hint">Zoomed out: snapping to every ${showLen(g)} ${unitName()} (zoom in for ${showLen(c.size)}).</p>` : ''}</div>`;
  }
  function wireSnap(sec) {
    sec.querySelectorAll('[data-snapk]').forEach((el) => el.addEventListener('change', () => {
      if (!host || !host.setSnap) return;
      host.setSnap(el.dataset.snapk, el.type === 'checkbox' ? el.checked : +el.value);
      objPts = null; if (sk.active) redrawSketch(); renderToolSec();
    }));
  }
  function back() { sk.stage = 'draw'; arrow.visible = false; extLabel.hidden = true; redrawSketch(); renderToolSec(); }
  function renderCombine(sec) {
    combineValid();
    const slot = (o, n, what) => `<div class="cb-slot${o ? ' on' : ''}"><b>${n}</b><span>${o ? esc(o.name) : what}</span>${o ? `<button class="mini" data-clear="${n}" aria-label="Remove">✕</button>` : ''}</div>`;
    let h = `<h2><span class="dot"></span>Combine</h2><p class="hint ehint">Click two models: first the one to keep, then the other one.</p>`;
    h += slot(cb.a, 1, 'Click the model to keep') + (cb.a && cb.b ? `<button class="mini cb-swap" data-act="swap">${ic('swap')} Swap</button>` : '') + slot(cb.b, 2, 'Click the other model');
    const ready = cb.a && cb.b, nb = cb.b ? esc(cb.b.name) : 'the other', na = cb.a ? esc(cb.a.name) : 'the first';
    h += `<div class="cb-acts"><button class="etoggle" data-cb="union" ${ready ? '' : 'disabled'}>${ic('join')}<span><b>Join together</b> into one model</span></button>`;
    h += `<button class="etoggle" data-cb="subtract" ${ready ? '' : 'disabled'}>${ic('cut')}<span><b>Cut away</b> ${nb} from ${na}</span></button>`;
    h += `<button class="etoggle" data-cb="intersect" ${ready ? '' : 'disabled'}>${ic('inter')}<span><b>Keep the overlap</b> only</span></button></div>`;
    h += `<p class="hint">${ready ? `${nb} is used up; ${na} keeps the result.` : ''} Undo is at the top if you change your mind.</p>`;
    sec.innerHTML = h;
    sec.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.clear === '1') { cb.a = cb.b; cb.b = null; } else cb.b = null; selectMany([cb.a, cb.b].filter(Boolean)); refreshAll(); renderToolSec(); }));
    const sw = sec.querySelector('[data-act="swap"]'); if (sw) sw.addEventListener('click', () => { [cb.a, cb.b] = [cb.b, cb.a]; sel = cb.a; refreshAll(); renderToolSec(); });
    sec.querySelectorAll('[data-cb]').forEach((b) => b.addEventListener('click', () => {
      if (!cb.a || !cb.b) return;
      sel = cb.a; selSet = new Set([cb.a]); S.boolWith = cb.b.id; S.keepTool = false;
      applyBoolean(b.dataset.cb);
      setTimeout(() => { combineValid(); cb.b = null; if (cb.a) select(cb.a); refreshAll(); renderToolSec(); }, 60);
    }));
  }

  // ================================================================ input routing
  let skDown = null;
  function down(p, e) {
    const x = p.x, y = p.y;
    if (S.tool === 'combine') { const hit = pick(x, y); if (hit) { combinePick(hit.obj); return true; } return false; }
    if (S.tool === 'sketch') {
      if (!sk.active) startSketch();
      if (sk.stage === 'plane') {
        const g = rayAt(x, y).intersectObjects(gizmo, false)[0], hit = pick(x, y);
        if (hit && (!g || hit.d < camera.position.distanceTo(g.point))) { const pl = planeFromHit(hit); setPlane(pl.o, pl.x, pl.n, hit); return true; }
        if (g) { const pl = PL[g.object.userData.plane]; setPlane(ORIGIN.clone(), pl.x, pl.n, null); return true; }
        return false;
      }
      if (sk.stage === 'draw') {
        const uv0 = toUV(x, y); if (!uv0) return false;
        const uv = snapUV(uv0, x, y);
        if (!sk.cur) { sk.cur = { start: uv, p: uv }; skDown = { x, y, moved: false }; redrawSketch(); return true; }
        sk.cur.p = uv; commitShape(); return true;
      }
      if (sk.stage === 'extrude') {
        if (rayAt(x, y).intersectObject(arrow, true).length) {
          const c = centroidUV(selShapes()), base = toW(c[0], c[1], 0), toCam = camera.position.clone().sub(base);
          const n = sk.plane.n, pn = toCam.sub(n.clone().multiplyScalar(toCam.dot(n)));
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(pn.lengthSq() > 1e-9 ? pn.normalize() : sk.plane.x, base);
          extDrag = { base, plane }; return true;
        }
        const f = rayAt(x, y).intersectObjects(SKG.children.filter((c) => c.userData.shape !== undefined), false)[0];
        if (f) { const i = f.object.userData.shape; if (sk.sel.has(i)) { if (sk.sel.size > 1) sk.sel.delete(i); } else sk.sel.add(i); redrawSketch(); renderToolSec(); return true; }
        return false;
      }
      return false;
    }
    if (S.tool === 'xform') {
      const h = pickHandle(x, y);
      rotKeys = null;
      if (h) return startHandle(h, x, y);
      if (e.shiftKey || e.ctrlKey || e.metaKey) return false; // add to / take from the selection
      const hit = pick(x, y);
      if (!hit) return false;
      if (!selSet.has(hit.obj)) select(hit.obj); else sel = hit.obj;
      refreshAll(); startMove(hit, x, y);
      return true;
    }
    return false;
  }
  function move(p, e) {
    if (drag) { drag.move(p.x, p.y, e); refreshObjPanelValues(); return; }
    if (extDrag) {
      const q = hitPlane(p.x, p.y, extDrag.plane); if (!q) return;
      let d = rnd(q.sub(extDrag.base).dot(sk.plane.n) * MMU, gridMM());
      if (Math.abs(d) < 1e-6) d = sk.dist < 0 ? -(gridMM() || 0.1) : (gridMM() || 0.1);
      sk.dist = d; redrawSketch(); const di = $('#cadDist'); if (di && document.activeElement !== di) di.value = showLen(d, 3); return;
    }
    if (sk.active && sk.stage === 'draw' && sk.cur) {
      const uv0 = toUV(p.x, p.y); if (!uv0) return;
      sk.cur.p = snapUV(uv0, p.x, p.y); if (skDown && Math.hypot(p.x - skDown.x, p.y - skDown.y) > 5) skDown.moved = true;
      showCursor(sk.cur.p); redrawSketch();
    }
  }
  function up() {
    if (drag) endDrag();
    if (extDrag) { extDrag = null; renderToolSec(); }
    if (skDown) { const d = skDown; skDown = null; if (d.moved && sk.cur) commitShape(); }
  }
  // hovering: handles light up; the sketch shows where a click lands
  function hover(p) {
    const x = p.x, y = p.y;
    if (S.tool === 'xform') {
      const h = pickHandle(x, y);
      if (h !== hot) { hot = h; req(); }
      glc.style.cursor = h ? (h.userData.handle.type === 'rot' ? 'grab' : h.userData.handle.type === 'lift' ? 'ns-resize' : 'pointer') : pick(x, y) ? 'move' : 'default';
      return true;
    }
    if (S.tool === 'combine') { glc.style.cursor = pick(x, y) ? 'pointer' : 'default'; return true; }
    if (S.tool !== 'sketch' || !sk.active) return false;
    if (sk.stage === 'plane') {
      const g = rayAt(x, y).intersectObjects(gizmo, false)[0], hit = pick(x, y);
      if (hit && (!g || hit.d < camera.position.distanceTo(g.point))) {
        hotGizmo(null); const pl = planeFromHit(hit), s = pxAt(hit.point) * 60;
        faceHint.visible = true; faceHint.position.copy(hit.point).addScaledVector(pl.n, 0.002); faceHint.quaternion.setFromRotationMatrix(basis(pl.x, pl.n)); faceHint.scale.setScalar(s);
      } else { faceHint.visible = false; hotGizmo(g ? g.object : null); }
      glc.style.cursor = g || hit ? 'pointer' : 'default'; req(); return true;
    }
    if (sk.stage === 'draw') {
      const uv0 = toUV(x, y); if (!uv0) { hideCursor(); return true; }
      const uv = snapUV(uv0, x, y); showCursor(uv);
      if (sk.cur) { sk.cur.p = uv; redrawSketch(); }
      glc.style.cursor = 'crosshair'; return true;
    }
    if (sk.stage === 'extrude') {
      const h = rayAt(x, y).intersectObject(arrow, true).length > 0;
      if (h !== hotArrow) { hotArrow = h; redrawSketch(); }
      glc.style.cursor = h ? 'ns-resize' : 'default'; return true;
    }
    return false;
  }
  // keys: R C P tools, E extrude, Enter, Esc, digits type a size; Tab types sizes in Move
  function key(e) {
    const k = e.key;
    if (S.tool === 'xform' && k === 'Tab' && !e.ctrlKey && !e.altKey) { if (startDim(e.shiftKey)) { e.preventDefault(); return true; } }
    if (S.tool === 'xform' && /^Arrow/.test(k)) { if (arrowKey(e)) { e.preventDefault(); return true; } }
    if (S.tool === 'xform' && (k === 'PageUp' || k === 'PageDown')) { if (arrowKey({ key: k === 'PageUp' ? 'ArrowUp' : 'ArrowDown', ctrlKey: true, shiftKey: e.shiftKey })) { e.preventDefault(); return true; } }
    if (k === 'Escape') rotKeys = null;
    if (S.tool !== 'sketch' || !sk.active) return false;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && sk.stage === 'draw' && sk.shapes.length) { e.preventDefault(); sk.shapes.pop(); redrawSketch(); renderToolSec(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'Escape') {
      e.preventDefault();
      if (sk.stage === 'extrude') back();
      else if (sk.cur) { sk.cur = null; hideFields(); redrawSketch(); }
      else { exitSketch(); setTool('xform'); }
      return true;
    }
    if (sk.stage === 'extrude') {
      if (k === 'Enter') { e.preventDefault(); applyExtrude(); return true; }
      if (/^[0-9.\-]$/.test(k)) { const d = $('#cadDist'); if (d) { e.preventDefault(); d.focus(); d.value = k; d.dispatchEvent(new Event('input')); } return true; }
      return false;
    }
    if (sk.stage !== 'draw') return false;
    const lk = k.toLowerCase();
    if (lk === 'r' || lk === 'c' || lk === 'p') { sk.tool = { r: 'rect', c: 'circle', p: 'poly' }[lk]; sk.cur = null; hideFields(); redrawSketch(); renderToolSec(); return true; }
    if (lk === 'e') { toExtrude(); return true; }
    if (k === 'Enter') { e.preventDefault(); if (sk.cur) commitShape(); else toExtrude(); return true; }
    if ((k === 'Backspace' || k === 'Delete') && !sk.cur && sk.shapes.length) { sk.shapes.pop(); redrawSketch(); renderToolSec(); return true; }
    if (/^[0-9.]$/.test(k) && sk.cur && sk.fields) { e.preventDefault(); const f = sk.fields.list[0]; f.input.focus(); f.input.value = k; f.input.dispatchEvent(new Event('input')); return true; }
    return /^[a-z]$/.test(lk) && !['m', 'f', 'w', 'x', 'g'].includes(lk); // other letters do nothing while sketching
  }
  // a tool was picked: start or leave a sketch
  function onTool(prev, id) {
    if (prev === 'sketch' && id !== 'sketch') exitSketch();
    if (id === 'sketch' && prev !== 'sketch') startSketch();
    if (id === 'combine' && prev !== 'combine') { cb.a = selList()[0] || null; cb.b = selList()[1] || null; }
    if (id !== 'xform') { closeDim(); hot = null; }
  }
  // every frame: handles, labels and tags follow the camera
  function frameUpdate() {
    updateHandles();
    for (const t of gizmoTags) place(t, t.userData);
    if (sk.active && sk.stage === 'extrude' && sk.plane) { const c = centroidUV(selShapes()); place(extLabel, screen(toW(c[0], c[1], sk.dist)).map((v, i) => (i === 1 ? v - 30 : v))); } else extLabel.hidden = true;
    if (!(sk.active && sk.stage === 'extrude')) arrow.visible = false;
    if (sk.fields && sk.cur) showFields();
    // zooming changes the grid spacing (and the snap): redraw it
    if (sk.active && sk.stage === 'draw' && sk.plane && sk.gridShown && Math.abs(gridView() - sk.gridShown) > 1e-9) { sk.gridShown = gridView(); setTimeout(() => { redrawSketch(); renderToolSec(); }, 0); }
  }
  // the workplane in the design's colors (like Beginner), and the sketch colors
  function theme(c) {
    if (!c) return;
    Object.assign(COL, { sketch: c.sketch, fill: c.sketchFill, minor: c.wp.minor, major: c.wp.major, preview: c.preview || COL.preview });
    floorMat.color.set(c.wp.bg);
    const g = gridGeo(c.wp.minor, c.wp.major); grid.geometry.dispose(); grid.geometry = g;
    grid.material.vertexColors = true; grid.material.opacity = 0.85; grid.material.needsUpdate = true;
    if (sk.active) redrawSketch();
    req();
  }
  function gridGeo(minor, major) {
    const P = [], C = [], a = new THREE.Color(minor), b = new THREE.Color(major), E = 7, step = 0.5; // 280 mm, a line every 10 mm, bold every 50 mm
    for (let i = -E / step; i <= E / step; i++) {
      const t = i * step, c = i % 5 === 0 ? b : a;
      P.push(t, 0, -E, t, 0, E, -E, 0, t, E, 0, t); for (let k = 0; k < 4; k++) C.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return g;
  }
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xb5d0ed, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = -1.025; floor.renderOrder = -1; scene.add(floor);
  // the floor shows with the grid (the Grid button)
  const gridVis = () => { floor.visible = grid.visible; };
  return { snapAt: (x, y) => { const uv = toUV(x, y); return uv ? snapUV(uv, x, y) : null; }, gridView, snapRow, wireSnap, snapChanged: () => { objPts = null; if (sk.active) redrawSketch(); if (S.tool === 'sketch' || S.tool === 'xform') renderToolSec(); }, down, move, up, hover, key, onTool, frame: () => { gridVis(); frameUpdate(); }, theme, renderSec, sk, cb, exitSketch, startSketch, get dragging() { return !!drag || !!extDrag; }, setPlane, PL, ORIGIN, toExtrude, applyExtrude, commitShape };
})();
