// Projector: a stripped-down projection-mapping view. One button opens a second
// window to drag onto a projector or second monitor. It shows only the 3D objects, on black
// (no grid, sketches, handles or labels), and follows the main view's camera as you turn it,
// unless "Hold view" freezes it. Mirror and Upside down suit rear and ceiling projectors.
// The second window is drawn from here (same models and materials, no copies); it is redrawn
// only when the main view is, so it costs nothing while nothing changes.
import * as THREE from "three";
import { el, IS_IOS } from "./util.js";

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="13" height="9" rx="2"/><circle cx="9" cy="12.5" r="2.4"/><path d="M15.5 10.5 21.5 7v11l-6-3.5"/></svg>';

export function initProjector(app) {
  const vp = app.vp;
  let win = null, renderer = null, canvas = null, hint = null, timer = 0, hideT = 0;
  const st = { hold: false, mirror: false, flip: false };
  const proxies = new Map(); // body view -> proxy mesh in the projector's scene
  const mproxies = new Map(); // body view -> proxy of its picture / video (projection media)
  const pscene = new THREE.Scene();
  pscene.background = new THREE.Color(0x000000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a929c, 1.6);
  const head = new THREE.DirectionalLight(0xffffff, 1.5), key = new THREE.DirectionalLight(0xffffff, 0.6), sun = new THREE.DirectionalLight(0xfff6ea, 0);
  pscene.add(hemi, head, head.target, key, key.target, sun, sun.target);
  const persp = new THREE.PerspectiveCamera(45, 1, 0.1, 10000), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  let held = null; // the camera kept by "Hold view"

  // ---- the button (with the other view buttons) and the little control bar
  const btn = el("button", { id: "nav-projector", "aria-pressed": "false", title: "Projector: show your objects on a second screen or projector", html: ICON, onclick: () => (win ? close() : open()) });
  document.querySelector(".navbtns")?.append(btn);
  const bar = el("div", { class: "proj-bar", id: "proj-bar", hidden: true });
  document.getElementById("viewport").append(bar);
  function renderBar() {
    bar.innerHTML = "";
    const tog = (id, label, title, k) => el("button", { id, "aria-pressed": String(st[k]), title, onclick: () => { st[k] = !st[k]; if (k === "hold") held = st.hold ? snap() : null; applyFlip(); renderBar(); draw(); } }, label);
    bar.append(
      el("span", { class: "proj-title" }, el("b", {}, "Projector")),
      tog("proj-hold", "Hold view", "Keep the projector's picture still while you turn the view here", "hold"),
      tog("proj-mirror", "Mirror", "Flip left to right (for projecting from behind a screen)", "mirror"),
      tog("proj-flip", "Upside down", "Turn the picture over (for ceiling-mounted projectors)", "flip"),
      el("button", { id: "proj-close", class: "proj-x", title: "Close the projector window", onclick: () => close() }, "Close"),
    );
  }

  // ---- open / close the second window
  // iPhone / iPad: Safari can't show a second window beside this one, so the projector picture
  // fills this screen instead. Mirror the screen to the projector (AirPlay or a cable); drag on
  // the picture to turn the view, pinch to zoom, two fingers to move it.
  function openInPage() {
    const ov = el("div", { class: "proj-ov", id: "proj-ov", role: "dialog", "aria-label": "Projector view" });
    canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
    hint = el("div", { class: "proj-ov-hint", html: "<b>Projector view</b><br>Mirror this screen to the projector (AirPlay or a cable). Drag to turn the view, pinch to zoom, two fingers to move it." });
    const tools = el("div", { class: "proj-ov-bar" });
    const paint = () => {
      tools.innerHTML = "";
      const tog = (label, k) => el("button", { "aria-pressed": String(st[k]), onclick: () => { st[k] = !st[k]; if (k === "hold") held = st.hold ? snap() : null; applyFlip(); paint(); renderBar(); draw(); } }, label);
      tools.append(tog("Hold view", "hold"), tog("Mirror", "mirror"), tog("Upside down", "flip"), el("button", { class: "done", onclick: () => close() }, "Done"));
    };
    paint();
    ov.append(canvas, hint, tools);
    document.body.append(ov);
    win = { inPage: true, get closed() { return !ov.isConnected; }, get innerWidth() { return ov.clientWidth; }, get innerHeight() { return ov.clientHeight; }, get devicePixelRatio() { return window.devicePixelRatio; }, close() { ov.remove(); } };
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch (e) { const w = win; cleanup(); w.close(); app.toast("The projector view couldn't start 3D drawing on this device.", "err"); return; }
    renderer.outputColorSpace = vp.renderer.outputColorSpace;
    renderer.toneMapping = vp.renderer.toneMapping;
    renderer.toneMappingExposure = vp.renderer.toneMappingExposure;
    // touch: one finger turns the main view (the projector follows it), two pan and zoom
    const pts = new Map(); let last = null;
    const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    canvas.addEventListener("pointerdown", (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = pts.size === 2 ? two() : { x: e.clientX, y: e.clientY };
      hint.style.opacity = "0";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const t = two();
        if (last && last.d) { vp.panBy(t.x - last.x, t.y - last.y); vp.zoomAt({ clientX: t.x, clientY: t.y }, last.d / t.d); }
        last = t;
      } else if (pts.size === 1 && last && last.d === undefined) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
        const sx = st.mirror ? -1 : 1, sy = st.flip ? -1 : 1;
        vp.anim = null;
        vp.view.az -= dx * sx * 0.0085;
        vp.view.el = Math.max(-Math.PI / 2 + 1e-3, Math.min(Math.PI / 2 - 1e-3, vp.view.el + dy * sy * 0.0085));
      }
      vp.moving && vp.moving(); vp.request();
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size === 1 ? { ...[...pts.values()][0] } : pts.size === 2 ? two() : null; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); vp.zoomAt(e, Math.pow(1.0015, e.deltaY)); vp.request(); }, { passive: false });
    window.addEventListener("resize", draw);
    clearInterval(timer); timer = setInterval(() => { if (win && win.closed) cleanup(); }, 800);
    applyFlip();
    btn.setAttribute("aria-pressed", "true");
    bar.hidden = false; renderBar();
    vp.labelFns.add(draw);
    vp.request(); draw();
  }
  function open() {
    if (IS_IOS) { openInPage(); return; }
    let w = null;
    try { w = window.open("", "jumpstart3d-projector", "popup,width=960,height=600"); } catch (e) { w = null; }
    if (!w) { app.toast("The projector window was blocked. Allow pop-ups for this page, then press the projector button again.", "err"); return; }
    let doc;
    try { doc = w.document; doc.body; } catch (e) { try { w.close(); } catch (e2) {} app.toast("This page isn't allowed to control a second window here. Open JumpStart 3D in its own browser tab and try again.", "err"); return; }
    win = w;
    doc.title = "JumpStart 3D · Projector";
    doc.documentElement.style.cssText = "height:100%;background:#000";
    doc.body.innerHTML = "";
    doc.body.style.cssText = "margin:0;height:100%;overflow:hidden;background:#000;cursor:default;font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif";
    canvas = doc.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block";
    doc.body.append(canvas);
    hint = doc.createElement("div");
    hint.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:min(560px,90vw);padding:10px 16px;border-radius:10px;background:rgba(40,44,52,.88);color:#fff;text-align:center;transition:opacity .4s;pointer-events:none";
    hint.innerHTML = "<b>JumpStart 3D Projector</b><br>Drag this window onto the projector or second screen, then <b>double-click</b> (or press <b>F</b>) for full screen.";
    doc.body.append(hint);
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch (e) { cleanup(); try { w.close(); } catch (e2) {} app.toast("The projector window couldn't start 3D drawing on this computer.", "err"); return; }
    renderer.outputColorSpace = vp.renderer.outputColorSpace;
    renderer.toneMapping = vp.renderer.toneMapping;
    renderer.toneMappingExposure = vp.renderer.toneMappingExposure;
    const full = () => { const d = w.document; if (d.fullscreenElement) d.exitFullscreen?.(); else d.documentElement.requestFullscreen?.().catch(() => {}); };
    w.addEventListener("dblclick", full);
    w.addEventListener("keydown", (e) => { if (e.key === "f" || e.key === "F") full(); });
    w.addEventListener("resize", () => draw());
    // the hint and the pointer fade away when the mouse rests
    const wake = () => { hint.style.opacity = "1"; doc.body.style.cursor = "default"; clearTimeout(hideT); hideT = setTimeout(() => { hint.style.opacity = "0"; doc.body.style.cursor = "none"; }, 4000); };
    w.addEventListener("mousemove", wake); wake();
    w.addEventListener("pagehide", () => setTimeout(() => { if (win && win.closed) cleanup(); }, 50));
    // backup: notice the window being closed
    clearInterval(timer); timer = setInterval(() => { if (win && win.closed) cleanup(); }, 800);
    applyFlip();
    btn.setAttribute("aria-pressed", "true");
    bar.hidden = false; renderBar();
    vp.labelFns.add(draw);
    vp.request(); draw();
    try { w.focus(); } catch (e) {}
    app.toast("Projector open. Drag its window to the second screen, then double-click it for full screen.");
  }
  function close() { const w = win; cleanup(); try { w && !w.closed && w.close(); } catch (e) {} }
  function cleanup() {
    clearInterval(timer); clearTimeout(hideT);
    vp.labelFns.delete(draw);
    for (const p of proxies.values()) pscene.remove(p);
    proxies.clear();
    for (const p of mproxies.values()) pscene.remove(p);
    mproxies.clear();
    if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} }
    renderer = null; canvas = null; win = null; hint = null; held = null; st.hold = false;
    btn.setAttribute("aria-pressed", "false");
    bar.hidden = true;
  }
  window.addEventListener("pagehide", () => close());
  function applyFlip() { if (canvas) canvas.style.transform = `scale(${st.mirror ? -1 : 1}, ${st.flip ? -1 : 1})`; }

  // ---- the camera: the main view's, shaped to the projector window
  function snap() {
    const c = vp.camera;
    return { ortho: !!c.isOrthographicCamera, pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov, near: c.near, far: c.far, top: c.top, bottom: c.bottom, zoom: c.zoom || 1 };
  }
  function camFor(aspect) {
    const s = held || snap();
    const cam = s.ortho ? ortho : persp;
    cam.position.copy(s.pos); cam.quaternion.copy(s.quat);
    cam.near = s.near; cam.far = s.far;
    if (s.ortho) { const h = (s.top - s.bottom) / 2; cam.top = h; cam.bottom = -h; cam.left = -h * aspect; cam.right = h * aspect; cam.zoom = s.zoom; }
    else { cam.fov = s.fov; cam.aspect = aspect; }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    return cam;
  }

  // ---- draw: only the solid bodies, true colors (no selection or hover highlight)
  const tmpV2 = new THREE.Vector2();
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function draw() {
    if (!win || !renderer) return;
    if (win.closed) { cleanup(); return; }
    const w = Math.max(1, win.innerWidth | 0), h = Math.max(1, win.innerHeight | 0);
    const dpr = Math.min(win.devicePixelRatio || 1, (vp.perf && vp.perf.dpr) || 2);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const sz = renderer.getSize(tmpV2);
    if (sz.x !== w || sz.y !== h) renderer.setSize(w, h, false);
    // which bodies: visible, solid ones (holes and see-through previews stay out)
    const live = new Set();
    for (const v of app.scene.views.values()) {
      const m = v.mesh, b = v.body;
      if (!m || !b || b.hole || b.cutPreview || !shown(m)) continue;
      if (v.ghost) continue;
      live.add(v);
      let p = proxies.get(v);
      if (!p || p.geometry !== m.geometry) { if (p) pscene.remove(p); p = new THREE.Mesh(m.geometry, m.material); p.matrixAutoUpdate = false; proxies.set(v, p); pscene.add(p); }
      p.material = m.material;
      m.updateWorldMatrix(true, false);
      p.matrix.copy(m.matrixWorld); p.matrixWorld.copy(m.matrixWorld);
    }
    for (const [v, p] of proxies) if (!live.has(v)) { pscene.remove(p); proxies.delete(v); }
    // pictures and videos on the objects
    for (const v of live) {
      const mm = v.mediaMesh;
      let q = mproxies.get(v);
      if (!mm || !mm.visible) { if (q) { pscene.remove(q); mproxies.delete(v); } continue; }
      if (!q || q.geometry !== mm.geometry) { if (q) pscene.remove(q); q = new THREE.Mesh(mm.geometry, mm.material); q.matrixAutoUpdate = false; q.renderOrder = 1; mproxies.set(v, q); pscene.add(q); }
      q.material = mm.material;
      mm.updateWorldMatrix(true, false);
      q.matrix.copy(mm.matrixWorld); q.matrixWorld.copy(mm.matrixWorld);
    }
    for (const [v, q] of mproxies) if (!live.has(v)) { pscene.remove(q); mproxies.delete(v); }
    // the same lights as the main view (no floor, no shadows)
    const cam = camFor(w / h);
    hemi.intensity = vp.hemi.intensity; hemi.color.copy(vp.hemi.color); hemi.groundColor.copy(vp.hemi.groundColor);
    head.intensity = vp.headlight.intensity; head.position.copy(cam.position);
    const tgt = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(cam.position);
    head.target.position.copy(tgt);
    key.intensity = vp.keyLight.intensity; key.position.copy(vp.keyLight.position); key.target.position.set(0, 0, 0);
    sun.intensity = vp.sun.intensity; sun.color.copy(vp.sun.color); sun.position.copy(vp.sun.position); sun.target.position.copy(vp.sun.target.position);
    pscene.environment = vp.scene.environment; pscene.environmentIntensity = vp.scene.environmentIntensity;
    // true colors: take off the selection / hover highlight just for this picture
    const undo = [];
    for (const v of live) {
      const mats = v.mats || [];
      for (const m of mats) if (m.emissiveIntensity) { undo.push([m, "emissiveIntensity", m.emissiveIntensity]); m.emissiveIntensity = 0; }
      if (v.tinted && v.plainColor && mats[0]) { undo.push([mats[0], "color", mats[0].color.clone()]); mats[0].color.copy(v.plainColor); }
      const groups = v.mesh.geometry.groups;
      groups.forEach((g, i) => { if (g.materialIndex === 1 || g.materialIndex === 2) { undo.push([g, "materialIndex", g.materialIndex]); g.materialIndex = (v.faceMat && v.faceMat.get(i)) || 0; } });
    }
    try { renderer.render(pscene, cam); }
    finally { for (let i = undo.length - 1; i >= 0; i--) { const [o, k, val] = undo[i]; if (k === "color") o.color.copy(val); else o[k] = val; } }
  }
  return { open, close, get isOpen() { return !!win; }, state: st, draw };
}
