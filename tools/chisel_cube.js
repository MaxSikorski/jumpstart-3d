// ---- the view cube: the very same one as Beginner and Advanced (its class is copied from
// JumpStart 3D's viewport.js when Chisel is built). It works in JumpStart 3D's Z-up frame, so
// this small stand-in viewport turns Chisel's Y-up camera into that frame and back.
@@VIEWCUBE_CLASS@@
const CUBE = (() => {
  const QR = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2); // Chisel → JumpStart 3D axes
  const QI = QR.clone().invert();
  const EL = Math.PI / 2 - 1e-4;
  const fake = new THREE.PerspectiveCamera();
  const vp = {
    camera: fake,
    view: { target: new V3(), az: 0, el: 0, dist: 7, roll: 0 },
    anim: null,
    afterRender: { add() {} },
    // dragging the cube changes view.az / view.el, then asks for a redraw: apply it to Chisel's camera
    request() { const v = this.view; this.set(v.az, v.el, v.dist, v.roll, v.target.clone()); },
    // Chisel's camera, seen in JumpStart 3D's terms
    sync() {
      const v = this.view;
      v.az = Math.atan2(Math.sin(cam.th - Math.PI / 2), Math.cos(cam.th - Math.PI / 2));
      v.el = Math.PI / 2 - cam.ph; v.dist = cam.r; v.roll = cam.roll || 0;
      v.target.copy(cam.target).applyQuaternion(QR);
      fake.position.copy(camera.position).applyQuaternion(QR);
      fake.quaternion.copy(QR).multiply(camera.quaternion);
      fake.up.copy(camera.up).applyQuaternion(QR);
    },
    set(az, el, dist, roll, target) {
      cam.th = az + Math.PI / 2;
      cam.ph = Math.max(1e-4, Math.min(Math.PI - 1e-4, Math.PI / 2 - el));
      cam.r = dist; cam.roll = roll;
      cam.target.copy(target).applyQuaternion(QI);
      updateCam();
    },
    animateTo(to, ms = 380) {
      this.sync();
      const v = this.view;
      const from = { target: v.target.clone(), az: v.az, el: v.el, dist: v.dist, roll: v.roll };
      let daz = (to.az ?? from.az) - from.az; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
      let droll = (to.roll ?? from.roll) - from.roll; droll = Math.atan2(Math.sin(droll), Math.cos(droll));
      this.anim = { from, to: { target: (to.target || from.target).clone(), az: from.az + daz, el: Math.max(-EL, Math.min(EL, to.el ?? from.el)), dist: to.dist ?? from.dist, roll: from.roll + droll }, t0: performance.now(), ms };
      req();
    },
    tick() {
      const a = this.anim; if (!a) return;
      const k = Math.min(1, (performance.now() - a.t0) / a.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const L = (p, q) => p + (q - p) * e;
      let roll = L(a.from.roll, a.to.roll);
      if (k >= 1) { this.anim = null; roll = Math.atan2(Math.sin(roll), Math.cos(roll)); if (Math.abs(roll) < 1e-6) roll = 0; }
      this.set(L(a.from.az, a.to.az), L(a.from.el, a.to.el), L(a.from.dist, a.to.dist), roll, new V3().lerpVectors(a.from.target, a.to.target, e));
    },
  };
  const box = document.createElement('div');
  box.className = 'cube-box';
  view.append(box);
  const cube = new ViewCube(box, vp);
  const baseRender = cube.render.bind(cube);
  cube.render = () => { vp.sync(); baseRender(); };
  return { vp, cube, frame() { vp.tick(); cube.render(); }, stop() { vp.anim = null; } };
})();
// ---- the tab on the panel's edge pushes the right panel away (like Tinkercad) and brings it back
(() => {
  const KEY = 'jumpstart.chisel.tucked';
  const tab = document.createElement('button');
  tab.className = 'panel-tab'; tab.id = 'panelTab'; tab.setAttribute('aria-controls', 'panel');
  tab.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg>';
  view.append(tab);
  const sync = () => { const open = !document.body.classList.contains('tucked'); tab.classList.toggle('closed', !open); tab.title = open ? 'Hide the panel' : 'Show the panel'; tab.setAttribute('aria-label', tab.title); tab.setAttribute('aria-expanded', String(open)); };
  try { if (localStorage.getItem(KEY) === '1') document.body.classList.add('tucked'); } catch (e) {}
  tab.addEventListener('click', () => { const tuck = !document.body.classList.contains('tucked'); document.body.classList.toggle('tucked', tuck); try { localStorage.setItem(KEY, tuck ? '1' : '0'); } catch (e) {} sync(); });
  sync();
})();
// ---- performance modes (set in Beginner / Advanced's theme menu), lightest to sharpest:
// Normal, High, Ultra. Lighter modes draw fewer pixels, and fewer still while you sculpt, orbit
// or drag; full sharpness when you stop. Normal also starts new shapes at Low detail (fewer
// triangles to sculpt); you can still pick more.
const PERF = (() => {
  const LV = { normal: { dpr: 1, move: 0.7 }, high: { dpr: 1.25, move: 1 }, ultra: { dpr: 2, move: 2 } };
  let lv = LV.ultra, name = 'ultra', until = 0, userDetail = false;
  const mark = () => { until = performance.now() + 220; };
  glc.addEventListener('pointermove', (e) => { if (e.buttons) mark(); }, true);
  glc.addEventListener('wheel', mark, { passive: true, capture: true });
  const ds = $('#detailSeg'); if (ds) ds.addEventListener('click', () => { userDetail = true; });
  const want = () => Math.min(window.devicePixelRatio || 1, 2, (performance.now() < until || CUBE.vp.anim) ? lv.move : lv.dpr);
  (function tick() {
    requestAnimationFrame(tick);
    const w = want();
    if (Math.abs(w - renderer.getPixelRatio()) > 1e-3) { renderer.setPixelRatio(w); renderer.setSize(view.clientWidth || 1, view.clientHeight || 1, false); req(); }
  })();
  function set(n) {
    if (!LV[n]) n = 'ultra';
    name = n; lv = LV[n];
    if (!userDetail) {
      S.detail = n === 'normal' ? 0 : 1;
      if (ds) { ds.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === S.detail)); const note = $('#detailNote'); if (note) note.textContent = ['fast', 'balanced', 'dense'][S.detail]; }
    }
    req();
  }
  if (host && host.perf) set(host.perf());
  return { set, get name() { return name; } };
})();
