// Renderer, cameras, navigation, workplane grid and view cube.
import * as THREE from "three";
import { theme } from "./theme.js";
import { IS_MAC } from "./util.js";

const GRID_VS = `
varying vec3 vPos;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FS = `
uniform vec3 cMinor; uniform vec3 cMajor; uniform vec3 cBg; uniform vec3 cAxisX; uniform vec3 cAxisY;
uniform float minor; uniform float major; uniform float halfSize; uniform float bgAlpha; uniform float fade; uniform vec3 center;
uniform float showAxes;
varying vec3 vPos;
float line(vec2 p, float s, float w){
  vec2 q = p / s; vec2 fw = fwidth(q);
  vec2 g = abs(fract(q - 0.5) - 0.5) / fw;
  float l = 1.0 - min(min(g.x, g.y) / w, 1.0);
  float dens = max(fw.x, fw.y);
  return l * (1.0 - smoothstep(0.18, 0.45, dens));
}
void main(){
  vec2 p = vPos.xy;
  if (abs(p.x) > halfSize || abs(p.y) > halfSize) discard;
  float mi = line(p, minor, 1.0);
  float ma = line(p, major, 1.3);
  vec3 col = cBg; float a = bgAlpha;
  col = mix(col, cMinor, mi * 0.9); a = max(a, mi * 0.55);
  col = mix(col, cMajor, ma); a = max(a, ma * 0.85);
  if (showAxes > 0.5) {
    vec2 fw = fwidth(p);
    float ax = 1.0 - min(abs(p.y) / (fw.y * 1.4), 1.0);
    float ay = 1.0 - min(abs(p.x) / (fw.x * 1.4), 1.0);
    col = mix(col, cAxisX, ax); a = max(a, ax);
    col = mix(col, cAxisY, ay); a = max(a, ay);
  }
  float d = length(p - center.xy);
  a *= 1.0 - smoothstep(fade * 0.55, fade, d);
  // border of a finite workplane
  if (halfSize < 10000.0) {
    vec2 e = (halfSize - abs(p)) / fwidth(p);
    float b = 1.0 - min(min(e.x, e.y) / 2.0, 1.0);
    col = mix(col, cMajor, b); a = max(a, b);
  }
  gl_FragColor = vec4(col, a);
}`;

export class Viewport {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: true }); // stencil: section analysis caps
    this.perf = PERF.ultra; this.perfName = "ultra"; this.movingUntil = 0;
    this.renderer.setPixelRatio(this.wantDpr(false));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "vp-canvas";
    this.canvas.tabIndex = 0;
    container.append(this.canvas);

    this.scene = new THREE.Scene();
    this.overlay = new THREE.Scene(); // handles drawn on top
    this.bg = new THREE.Color("#e9edf1");

    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 50000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
    this.persp.up.set(0, 0, 1);
    this.ortho.up.set(0, 0, 1);
    this.useOrtho = false;
    // roll: turn of the picture around the line of sight (the view cube's curved arrows)
    this.view = { target: new THREE.Vector3(0, 0, 0), az: (-55 * Math.PI) / 180, el: (28 * Math.PI) / 180, dist: 330, roll: 0 };

    const hemi = (this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a929c, 1.6));
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    this.headlight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
    const key = (this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6));
    key.position.set(0.5, -0.8, 1.2);
    this.scene.add(key);
    // realistic lighting: a sun that casts soft shadows, a fill light, soft studio reflections
    const sun = (this.sun = new THREE.DirectionalLight(0xfff6ea, 0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 12;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.sunDir = new THREE.Vector3(-0.42, -0.62, 1).normalize();
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }));
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = -1;
    this.shadowPlane.visible = false;
    this.shadowPlane.raycast = () => {};
    this.scene.add(this.shadowPlane);
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // shadows only depend on the model, not the camera: they are redrawn when the model changes
    this.renderer.shadowMap.autoUpdate = false;
    this._shadowSig = null;
    this.realistic = false;

    this.grid = this.makeGrid();
    this.scene.add(this.grid);
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.labels = document.createElement("div");
    this.labels.className = "vp-labels";
    container.append(this.labels);
    this.labelFns = new Set();

    this.dirty = true;
    this.anim = null;
    this.handler = null; // tool interaction handler
    this.afterRender = new Set();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 1;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.bindInput();
    let lastT = 0, slowMs = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      if (this.anim) this.stepAnim(t);
      // while the view moves, fewer pixels (performance modes); full sharpness once it stops
      const want = this.wantDpr(this.isMoving());
      if (Math.abs(want - this.renderer.getPixelRatio()) > 1e-3) { this.renderer.setPixelRatio(want); this.renderer.setSize(this.w, this.h, false); this.dirty = true; }
      if (this.dirty) {
        // frames that keep coming slowly while you work: tell the app (Auto steps down)
        if (lastT && t - lastT < 400 && !document.hidden) { slowMs = t - lastT > 55 ? slowMs + (t - lastT) : Math.max(0, slowMs - (t - lastT)); if (slowMs > 2500) { slowMs = 0; this.onSlow && this.onSlow(); } }
        lastT = t;
        this.render();
      }
    };
    requestAnimationFrame(loop);
  }

  get camera() { return this.useOrtho ? this.ortho : this.persp; }

  makeGrid() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: GRID_VS,
      fragmentShader: GRID_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
      uniforms: {
        cMinor: { value: new THREE.Color("#b8c3cf") },
        cMajor: { value: new THREE.Color("#8e9cab") },
        cBg: { value: new THREE.Color("#ffffff") },
        cAxisX: { value: new THREE.Color("#d9534f") },
        cAxisY: { value: new THREE.Color("#3f9b52") },
        minor: { value: 1 },
        major: { value: 10 },
        halfSize: { value: 20000 },
        bgAlpha: { value: 0 },
        fade: { value: 3000 },
        center: { value: new THREE.Vector3() },
        showAxes: { value: 1 },
      },
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.renderOrder = -10;
    m.userData.isGrid = true;
    return m;
  }

  setGridStyle(style) {
    const u = this.grid.material.uniforms;
    const T = theme.c;
    if (style === "workplane") {
      // Tinkercad-style blue workplane
      u.cBg.value.setStyle(T.wp.bg, THREE.LinearSRGBColorSpace);
      u.cMinor.value.setStyle(T.wp.minor, THREE.LinearSRGBColorSpace);
      u.cMajor.value.setStyle(T.wp.major, THREE.LinearSRGBColorSpace);
      u.bgAlpha.value = 0.96;
      u.halfSize.value = 128; // a 256 × 256 mm workplane (a typical 3D printer bed)
      this.grid.scale.set(256, 256, 1);
      u.showAxes.value = 0;
      this.bg.set(T.wpBg);
    } else {
      u.cBg.value.setStyle(T.lines.bg, THREE.LinearSRGBColorSpace);
      u.cMinor.value.setStyle(T.lines.minor, THREE.LinearSRGBColorSpace);
      u.cMajor.value.setStyle(T.lines.major, THREE.LinearSRGBColorSpace);
      u.bgAlpha.value = T.lines.alpha || 0; // dark mode: a lighter gray ground so the workplane stands out
      u.halfSize.value = 20000;
      this.grid.scale.set(40000, 40000, 1);
      u.showAxes.value = 1;
      this.bg.set(T.bg);
    }
    this.gridStyle = style;
    this.request();
  }
  setGridSpacing(minor) {
    const u = this.grid.material.uniforms;
    u.minor.value = minor;
    u.major.value = minor * 10;
    this.request();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.request();
  }

  request() { this.dirty = true; }
  // ---------------------------------------------------------- performance
  setPerf(name) {
    const p = PERF[name] || PERF.ultra;
    this.perf = p; this.perfName = name;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== p.shadow) { sh.mapSize.set(p.shadow, p.shadow); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    sh.blurSamples = p.blur;
    const type = p.vsm ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
    if (this.renderer.shadowMap.type !== type) {
      this.renderer.shadowMap.type = type;
      if (sh.map) { sh.map.dispose(); sh.map = null; }
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    this._shadowSig = null;
    this.dirty = true;
  }
  wantDpr(moving) {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(d, moving ? this.perf.moveDpr : this.perf.dpr);
  }
  isMoving() { return !!this.anim || performance.now() < this.movingUntil; }
  moving(ms = 220) { this.movingUntil = Math.max(this.movingUntil, performance.now() + ms); }

  updateCamera() {
    const v = this.view;
    const el = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, v.el));
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(v.az), Math.cos(el) * Math.sin(v.az), Math.sin(el));
    for (const cam of [this.persp, this.ortho]) {
      cam.position.copy(v.target).addScaledVector(dir, v.dist);
      cam.lookAt(v.target);
      if (v.roll) cam.rotateZ(v.roll);
    }
    const hh = v.dist * Math.tan((this.persp.fov * Math.PI) / 360);
    const aspect = this.w / this.h;
    this.ortho.left = -hh * aspect; this.ortho.right = hh * aspect;
    this.ortho.top = hh; this.ortho.bottom = -hh;
    this.ortho.near = -v.dist * 50; this.ortho.far = v.dist * 50;
    this.ortho.updateProjectionMatrix();
    this.persp.near = Math.max(0.05, v.dist / 500);
    this.persp.far = v.dist * 200;
    this.persp.updateProjectionMatrix();
    if (this.onViewChange) {
      const sig = [v.az, v.el, v.dist, v.target.x, v.target.y, v.target.z, this.useOrtho, this.w, this.h].map((q) => (typeof q === "number" ? q.toFixed(4) : q)).join();
      if (sig !== this._viewSig) { this._viewSig = sig; this.onViewChange(); }
    }
    this.headlight.position.copy(this.camera.position);
    this.headlight.target.position.copy(v.target);
    const u = this.grid.material.uniforms;
    u.center.value.copy(v.target);
    u.fade.value = Math.max(400, v.dist * 6);
    if (this.gridStyle === "workplane") {
      // Tinkercad-style mat: 1 mm / 10 mm, or 1/8 in / 1 in
      const inch = this.gridUnit === "in";
      u.minor.value = inch ? 25.4 / 8 : 1; u.major.value = inch ? 25.4 : 10;
    } else {
      // adaptive grid: 1, 10, 100mm minor spacing depending on zoom, respecting snap
      const base = this.gridBase || 1;
      let s = base;
      const pxPerMm = this.h / (2 * hh);
      if (this.gridUnit === "in") {
        // inches: fractions, then whole inches, with a bolder line every 4 (or every foot)
        while (s * pxPerMm < 7) s *= s >= 25.4 ? 12 : 4;
        u.minor.value = s; u.major.value = s >= 25.4 ? s * 12 : s * 4;
      } else {
        while (s * pxPerMm < 7) s *= 10;
        u.minor.value = s; u.major.value = s * 10;
      }
    }
  }

  // soft studio surroundings for gentle reflections, made once
  studioEnv() {
    if (this._env) return this._env;
    const room = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0xa3aab2, side: THREE.BackSide }));
    room.add(box);
    const panel = (x, y, z, sx, sy, sz, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); room.add(m); };
    panel(0, 0, 4.9, 6, 6, 0.1, 0xffffff); // overhead softbox
    panel(-4.9, -1, 1.5, 0.1, 4, 3, 0xd8dde3);
    panel(3, -4.9, 1, 3, 0.1, 2.5, 0xc8ced5);
    panel(0, 0, -4.9, 9, 9, 0.1, 0x4e555d); // darker floor
    const pm = new THREE.PMREMGenerator(this.renderer);
    this._env = pm.fromScene(room, 0.04).texture;
    pm.dispose();
    return this._env;
  }
  setRealistic(on) {
    on = !!on;
    if (on === this.realistic && this._lightSet) return;
    this._lightSet = true;
    this.realistic = on;
    this.renderer.shadowMap.enabled = on;
    this.hemi.intensity = on ? 0.65 : 1.6;
    this.hemi.groundColor.set(on ? 0x59626c : 0x8a929c);
    this.headlight.intensity = on ? 0.7 : 1.5;
    this.keyLight.intensity = on ? 0.35 : 0.6;
    this.sun.intensity = on ? 2.4 : 0;
    this.scene.environment = on ? this.studioEnv() : null;
    this.scene.environmentIntensity = 0.55;
    this.shadowPlane.visible = on;
    this._shadowSig = null;
    this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    this.dirty = true;
  }
  // keep the shadow-casting sun wrapped around whatever is in the scene
  fitSun() {
    const box = new THREE.Box3();
    this.world.traverseVisible((o) => { if (o.isMesh && o.castShadow && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    if (box.isEmpty()) { this.shadowPlane.visible = false; this.sun.castShadow = false; return; }
    // redraw the shadows only when something in the model moved, changed or appeared
    let sig = 0, n = 0;
    this.world.traverseVisible((o) => { if (o.isMesh && o.castShadow && o.geometry) { const e = o.matrixWorld.elements; n++; sig += o.geometry.id * 7.13 + e[0] + e[1] * 1.3 + e[2] * 1.7 + e[4] * 2.1 + e[5] * 2.3 + e[6] * 2.9 + e[8] * 3.1 + e[9] * 3.7 + e[10] * 4.1 + e[12] * 5.3 + e[13] * 6.1 + e[14] * 7.9;
      // cut-away views (section, print simulation) change the shadow too
      for (const m of [].concat(o.material)) if (m && m.clippingPlanes) for (const c of m.clippingPlanes) sig += c.constant * 11.3 + c.normal.x * 13.1 + c.normal.y * 17.3 + c.normal.z * 19.7;
      if (o.isInstancedMesh) sig += o.count * 23.9; } });
    const key = n + ":" + sig.toFixed(6) + ":" + (this.sun.shadow.map ? 1 : 0);
    if (key !== this._shadowSig) { this._shadowSig = key; this.renderer.shadowMap.needsUpdate = true; }
    this.sun.castShadow = true;
    this.shadowPlane.visible = true;
    const c = box.getCenter(new THREE.Vector3()), R = Math.max(5, box.getSize(new THREE.Vector3()).length() / 2);
    const floor = Math.min(0, box.min.z);
    // reach down to the floor so shadows land on it
    const cc = new THREE.Vector3(c.x, c.y, (c.z + floor) / 2), RR = R + (c.z - floor) / 2;
    const sc = this.sun.shadow.camera;
    this.sun.target.position.copy(cc);
    this.sun.position.copy(cc).addScaledVector(this.sunDir, RR * 3);
    sc.left = -RR * 1.6; sc.right = RR * 1.6; sc.top = RR * 1.6; sc.bottom = -RR * 1.6;
    sc.near = RR * 0.5; sc.far = RR * 6;
    sc.updateProjectionMatrix();
    this.sun.shadow.radius = 4;
    this.shadowPlane.position.set(c.x, c.y, floor - Math.max(0.01, RR * 1e-4));
    this.shadowPlane.scale.set(RR * 8, RR * 8, 1);
  }

  render() {
    this.dirty = false;
    this.updateCamera();
    if (this.realistic) { this.scene.updateMatrixWorld(); this.fitSun(); }
    for (const f of this.afterRender) f();
    const r = this.renderer;
    r.setClearColor(this.bg, 1);
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.overlay, this.camera);
    for (const f of this.labelFns) f();
    this.onRendered && this.onRendered();
  }

  // ---------------------------------------------------------- geometry helpers
  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  ray(e) {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.ray;
  }
  rayPlane(e, plane) {
    const ray = this.ray(e);
    const p = new THREE.Vector3();
    return ray.intersectPlane(plane, p) ? p : null;
  }
  project(v) {
    const p = v.clone().project(this.camera);
    return [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h, p.z];
  }
  // world size of one screen pixel at a point
  pixelSize(at) {
    const d = this.useOrtho ? this.view.dist : this.camera.position.distanceTo(at || this.view.target);
    return (2 * d * Math.tan((this.persp.fov * Math.PI) / 360)) / this.h;
  }
  pick(e, objects) {
    this.ray(e);
    return this.raycaster.intersectObjects(objects, false);
  }

  // ---------------------------------------------------------- navigation
  bindInput() {
    // Mouse: left = tool, right = orbit, middle / shift+right = pan, wheel = zoom.
    // Touch: tap = click, drag on empty space = orbit (or the tool's drag when it
    // claims the touch), two fingers = pan + pinch zoom, double-tap = double-click.
    const c = this.canvas;
    let drag = null;
    let lastTap = null;
    const pointers = new Map();
    this.touchMode = false;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      c.focus({ preventScroll: true });
      this.touchMode = e.pointerType === "touch" || e.pointerType === "pen";
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // second finger: abandon whatever the first finger started; pan + pinch
        if (drag && drag.mode === "tool") this.handler && this.handler.cancel && this.handler.cancel();
        drag = { mode: "touch2", d: this.pinchDist(pointers), c: this.pinchCenter(pointers) };
        return;
      }
      if (pointers.size > 2) return;
      this.anim = null;
      if (this.touchMode) {
        this.handler && this.handler.hover && this.handler.hover(e);
        if (this.handler && this.handler.wantsTouch && this.handler.wantsTouch(e) && this.handler.down(e) !== false) {
          drag = { mode: "tool" };
        } else {
          drag = { mode: "touchnav", x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
        }
        c.setPointerCapture(e.pointerId);
        return;
      }
      // Mac: Control-click is a right-click (orbit, or the menu when it doesn't move);
      // Option-drag orbits and Option-Shift-drag pans, for a trackpad with one button
      const btn = IS_MAC && e.button === 0 && e.ctrlKey && !e.metaKey ? 2 : e.button;
      const nav = btn === 2 || btn === 1 || (btn === 0 && e.altKey);
      if (!nav && btn === 0 && this.handler && this.handler.down && this.handler.down(e) !== false) {
        drag = { mode: "tool" };
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (!nav) return;
      const pan = btn === 1 || ((btn === 2 || btn === 0) && e.shiftKey);
      drag = { mode: pan ? "pan" : "orbit", x: e.clientX, y: e.clientY, moved: false, button: btn };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!drag) { if (e.pointerType === "mouse") this.handler && this.handler.hover && this.handler.hover(e); return; }
      this.moving();
      if (drag.mode === "tool") { this.handler && this.handler.move && this.handler.move(e); return; }
      if (drag.mode === "touch2") {
        if (pointers.size < 2) return;
        const d = this.pinchDist(pointers), ctr = this.pinchCenter(pointers);
        this.panBy(ctr.x - drag.c.x, ctr.y - drag.c.y);
        this.zoomAt({ clientX: ctr.x, clientY: ctr.y }, drag.d / d);
        drag.d = d; drag.c = ctr;
        return;
      }
      if (drag.mode === "touch2wait") return;
      if (drag.mode === "touchnav") {
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
        drag.moved = true;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === "orbit" || drag.mode === "touchnav") {
        // with the view rolled, turn the drag back into the upright picture's directions
        const r = this.view.roll || 0, ox = dx * Math.cos(r) + dy * Math.sin(r), oy = -dx * Math.sin(r) + dy * Math.cos(r);
        this.view.az -= ox * 0.0085;
        this.view.el = Math.max(-Math.PI / 2 + 1e-3, Math.min(Math.PI / 2 - 1e-3, this.view.el + oy * 0.0085));
      } else this.panBy(dx, dy);
      this.request();
    });
    const end = (e) => {
      const had = pointers.delete(e.pointerId);
      if (!drag || !had) return;
      if (drag.mode === "tool") this.handler && this.handler.up && this.handler.up(e);
      else if (drag.mode === "orbit" && !drag.moved && drag.button === 2) this.onContext && this.onContext(e);
      else if (drag.mode === "touchnav" && !drag.moved && e.type === "pointerup") {
        // a tap: behave like a click, and two quick taps like a double-click
        const now = performance.now();
        const dbl = lastTap && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
        if (dbl && this.handler && this.handler.dblclick) { lastTap = null; this.handler.dblclick(e); }
        else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          if (this.handler && this.handler.down && this.handler.down(e) !== false) this.handler.up && this.handler.up(e);
        }
      }
      if (pointers.size === 0) drag = null;
      else if (drag.mode === "touch2") drag = { mode: "touch2wait" };
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", (e) => {
      this.moving();
      e.preventDefault();
      if (gest) return; // Safari sends its own pinch (below)
      // a trackpad pinch arrives as Ctrl + wheel with small steps: make it as quick as the wheel
      const f = Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 30 : e.ctrlKey ? 6 : 1));
      this.zoomAt(e, f);
    }, { passive: false });
    // Safari (Mac trackpad pinch, iPad / iPhone): gesture events. Fingers on the screen are
    // already handled as pointers above, so these only zoom when no finger is down.
    let gest = null;
    const gpos = (e) => (e.clientX || e.clientY ? e : (() => { const r = c.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; })());
    c.addEventListener("gesturestart", (e) => { e.preventDefault(); gest = { s: e.scale || 1, p: gpos(e) }; });
    c.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      if (!gest || pointers.size) return;
      const s = e.scale || 1;
      this.moving();
      this.zoomAt(gest.p, gest.s / s);
      gest.s = s;
    });
    c.addEventListener("gestureend", (e) => { e.preventDefault(); setTimeout(() => { gest = null; }, 60); });
    c.addEventListener("dblclick", (e) => { if (!this.touchMode) this.handler && this.handler.dblclick && this.handler.dblclick(e); });
    c.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") this.handler && this.handler.leave && this.handler.leave(e); });
  }
  // screen tolerance in px for picking: fingers need more room than a mouse
  tol(px) { return this.touchMode ? px * 2 : px; }
  pinchDist(p) { const [a, b] = [...p.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  pinchCenter(p) { const [a, b] = [...p.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  panBy(dx, dy) {
    this.updateCamera();
    const s = this.pixelSize(this.view.target);
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    this.view.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    this.request();
  }
  zoomAt(e, f) {
    this.anim = null;
    f = Math.max(0.5, Math.min(2, f));
    const v = this.view;
    const nd = Math.max(2, Math.min(20000, v.dist * f));
    f = nd / v.dist;
    // zoom toward the point under the cursor
    const hits = this.zoomTargets ? this.pick(e, this.zoomTargets()) : [];
    let P = hits.length ? hits[0].point : null;
    if (!P) {
      const ray = this.ray(e);
      const n = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, v.target);
      P = ray.intersectPlane(plane, new THREE.Vector3()) || v.target.clone();
    }
    v.target.lerp(P, 1 - f);
    v.dist = nd;
    this.request();
  }
  animateTo(to, ms = 380) {
    const from = { target: this.view.target.clone(), az: this.view.az, el: this.view.el, dist: this.view.dist, roll: this.view.roll || 0 };
    let daz = (to.az ?? from.az) - from.az;
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    let droll = (to.roll ?? from.roll) - from.roll;
    droll = Math.atan2(Math.sin(droll), Math.cos(droll));
    this.anim = { from, to: { target: (to.target || from.target).clone(), az: from.az + daz, el: to.el ?? from.el, dist: to.dist ?? from.dist, roll: from.roll + droll }, t0: performance.now(), ms };
    this.request();
  }
  stepAnim(t) {
    const a = this.anim;
    let k = Math.min(1, (t - a.t0) / a.ms);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) k = 1;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const v = this.view;
    v.target.lerpVectors(a.from.target, a.to.target, e);
    v.az = a.from.az + (a.to.az - a.from.az) * e;
    v.el = a.from.el + (a.to.el - a.from.el) * e;
    v.dist = a.from.dist + (a.to.dist - a.from.dist) * e;
    v.roll = a.from.roll + (a.to.roll - a.from.roll) * e;
    if (k >= 1) { this.anim = null; v.roll = Math.atan2(Math.sin(v.roll), Math.cos(v.roll)); if (Math.abs(v.roll) < 1e-6) v.roll = 0; }
    this.request();
  }
  // direction from target to camera for named views (Z up)
  static VIEWS = {
    top: { az: -Math.PI / 2, el: Math.PI / 2 - 1e-4 },
    bottom: { az: -Math.PI / 2, el: -Math.PI / 2 + 1e-4 },
    front: { az: -Math.PI / 2, el: 0 },
    back: { az: Math.PI / 2, el: 0 },
    right: { az: 0, el: 0 },
    left: { az: Math.PI, el: 0 },
    home: { az: (-55 * Math.PI) / 180, el: (28 * Math.PI) / 180 },
  };
  setView(name, fitBox) {
    const v = Viewport.VIEWS[name];
    const to = { ...v, roll: 0 };
    if (fitBox) Object.assign(to, this.fitParams(fitBox));
    this.animateTo(to);
  }
  lookAlong(normal, up, center, dist) {
    // camera looks against `normal` (camera sits on the normal side)
    const n = normal.clone().normalize();
    const el = Math.asin(Math.max(-1, Math.min(1, n.z)));
    let az = Math.atan2(n.y, n.x);
    if (Math.abs(n.z) > 0.9999 && up) az = Math.atan2(-up.y, -up.x) * (n.z > 0 ? 1 : 1);
    this.animateTo({ az, el: Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, el)), target: center, dist, roll: 0 });
  }
  fitParams(box) {
    if (!box || box.isEmpty()) return { target: new THREE.Vector3(0, 0, 0), dist: 330 };
    const s = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(s.radius, 5);
    const fov = (this.persp.fov * Math.PI) / 180;
    const aspect = Math.min(1, this.w / this.h);
    const dist = (r / Math.sin(fov / 2)) * 1.15 / Math.max(0.6, aspect);
    return { target: s.center, dist };
  }
  fit(box) { this.animateTo(this.fitParams(box)); }

  // ---------------------------------------------------------- html labels
  addLabel(cls = "") {
    const d = document.createElement("div");
    d.className = "vp-label " + cls;
    this.labels.append(d);
    return d;
  }
}

// ------------------------------------------------------------ view cube
// performance modes, from the lightest to the sharpest: how many pixels are drawn (at rest and
// while the view moves) and how detailed the soft shadows are; models, tools and exports are the
// same in every mode. Normal: slower computers; High: most laptops and Chromebooks; Ultra:
// powerful computers.
export const PERF = {
  normal: { dpr: 1, moveDpr: 0.7, shadow: 1024, blur: 4, vsm: false },
  high: { dpr: 1.25, moveDpr: 1, shadow: 1024, blur: 6, vsm: true },
  ultra: { dpr: 2, moveDpr: 2, shadow: 2048, blur: 12, vsm: true },
};

export class ViewCube {
  constructor(container, viewport, onPick) {
    this.vp = viewport;
    this.size = 96;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(this.size, this.size);
    r.domElement.className = "viewcube";
    container.append(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    this.camera.up.set(0, 0, 1);
    const names = ["RIGHT", "LEFT", "BACK", "FRONT", "TOP", "BOTTOM"]; // +x -x +y -y +z -z
    this.views = ["right", "left", "back", "front", "top", "bottom"];
    this.mats = names.map((n) => new THREE.MeshBasicMaterial({ map: this.faceTex(n, false) }));
    this.hoverMats = names.map((n) => new THREE.MeshBasicMaterial({ map: this.faceTex(n, true) }));
    const geo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    // three's box UVs put +Y "up" on the side faces; this app's up is +Z, so map the four side
    // faces so their labels read upright (horizontal) when seen from that side
    {
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      const rightOf = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // screen-right axis seen from +x, -x, +y, -y
      for (let f = 0; f < 4; f++) {
        const [rx, ry] = rightOf[f];
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          uv.setXY(i, (rx * x + ry * y) / 1.7 + 0.5, z / 1.7 + 0.5);
        }
      }
      uv.needsUpdate = true;
    }
    this.cube = new THREE.Mesh(geo, this.mats.slice());
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x59636e }));
    this.cube.add(edges);
    // small axis tripod at the corner
    const ax = (x, y, z, c) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.85, -0.85, -0.85), new THREE.Vector3(-0.85 + x, -0.85 + y, -0.85 + z)]);
      this.scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })));
    };
    ax(1.3, 0, 0, 0xd9534f); ax(0, 1.3, 0, 0x3f9b52); ax(0, 0, 1.3, 0x2f6fd0);
    this.ray = new THREE.Raycaster();
    const el = r.domElement;
    // drag the cube to turn the view freely (like Fusion's view cube); a click still picks a face,
    // edge or corner
    let cdrag = null;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      cdrag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener("pointermove", (e) => {
      if (cdrag && cdrag.id === e.pointerId) {
        const dx = e.clientX - cdrag.x, dy = e.clientY - cdrag.y;
        if (!cdrag.moved && Math.hypot(dx, dy) < 3) return;
        cdrag.moved = true; cdrag.x = e.clientX; cdrag.y = e.clientY;
        const v = this.vp.view, r = v.roll || 0;
        const ox = dx * Math.cos(r) + dy * Math.sin(r), oy = -dx * Math.sin(r) + dy * Math.cos(r);
        this.vp.anim = null;
        v.az -= ox * 0.012;
        v.el = Math.max(-Math.PI / 2 + 1e-3, Math.min(Math.PI / 2 - 1e-3, v.el + oy * 0.012));
        this.vp.moving && this.vp.moving();
        this.vp.request();
        el.style.cursor = "grabbing";
        return;
      }
      this.hover(e);
    });
    const endDrag = (e) => {
      if (!cdrag || cdrag.id !== e.pointerId) return;
      const wasDrag = cdrag.moved;
      cdrag = null;
      el.style.cursor = "";
      if (!wasDrag && e.type === "pointerup") { const d = this.hit(e); if (d) this.goTo(d); }
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("pointerleave", () => { if (!cdrag) this.hover(null); });
    this.onPick = onPick;
    // highlight for the face, edge or corner under the pointer
    this.hi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2d63c8, transparent: true, opacity: 0.45, depthTest: false }));
    this.hi.renderOrder = 5;
    this.hi.visible = false;
    this.scene.add(this.hi);
    // arrow buttons: step the view 90° around or 45° up/down
    const arrows = document.createElement("div");
    arrows.className = "cube-arrows";
    const mk = (cls, label, title, fn) => {
      const b = document.createElement("button");
      b.className = "cube-arrow " + cls;
      b.setAttribute("aria-label", title);
      b.title = title;
      b.textContent = label;
      b.addEventListener("click", fn);
      arrows.append(b);
    };
    const snap = (v, step) => Math.round(v / step) * step;
    mk("l", "◀", "Rotate view left", () => this.step(Math.PI / 2, 0));
    mk("r", "▶", "Rotate view right", () => this.step(-Math.PI / 2, 0));
    mk("u", "▲", "Tilt view up", () => this.step(0, Math.PI / 4));
    mk("d", "▼", "Tilt view down", () => this.step(0, -Math.PI / 4));
    void snap;
    // Fusion-style curved arrows above the cube: turn the picture 90° around the line of sight
    const roll = (dir) => {
      // build on where a running turn is heading, so quick clicks add up
      const r = this.vp.anim ? this.vp.anim.to.roll : this.vp.view.roll || 0, q = Math.PI / 2;
      this.vp.animateTo({ roll: Math.round(r / q) * q + dir * q });
    };
    const arc = (cls, title, flip, fn) => {
      const b = document.createElement("button");
      b.className = "cube-roll " + cls;
      b.setAttribute("aria-label", title);
      b.title = title;
      b.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"${flip ? ' style="transform:scaleX(-1)"' : ""}><path d="M4.61 13.20 A7.5 7.5 0 0 1 17.57 9.48" fill="none"/><path d="M20.65 12.90 L14.50 11.44 L19.85 6.63 Z" fill="currentColor" stroke="none"/></svg>`;
      b.addEventListener("click", fn);
      arrows.append(b);
    };
    // one over each top corner: the left one curls left (counter-clockwise), the right one curls right
    arc("ccw", "Turn view 90° counter-clockwise", true, () => roll(-1));
    arc("cw", "Turn view 90° clockwise", false, () => roll(1));
    container.append(arrows);
    viewport.afterRender.add(() => this.render());
  }
  // orbit by a fixed step, landing on clean 45° / 90° views
  step(daz, del) {
    const v = this.vp.view;
    const q = Math.PI / 4;
    let az = Math.round((v.az + daz) / q) * q;
    if (daz && Math.abs(Math.round(v.az / q) * q - v.az) > 1e-3) az = Math.round(v.az / (Math.PI / 2)) * (Math.PI / 2) + daz;
    let el = Math.round((v.el + del) / q) * q;
    el = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, el));
    this.vp.animateTo({ az, el });
  }
  // look from direction d (from the target toward the camera)
  goTo(d) {
    const n = d.clone().normalize();
    const el = Math.asin(Math.max(-1, Math.min(1, n.z)));
    let az = Math.abs(n.z) > 0.999 ? this.vp.view.az : Math.atan2(n.y, n.x);
    // straight down or up: keep the front of the model at the bottom of the screen
    if (Math.abs(n.z) > 0.999) az = -Math.PI / 2;
    this.vp.animateTo({ az, el: Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, el)), roll: 0 });
  }
  faceTex(label, hot) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = hot ? "#cfe0f7" : "#f4f6f8";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = hot ? "#1f4fa8" : "#4a5562";
    g.font = "600 25px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 64, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // which face, edge or corner was hit: returns a direction like (1,0,0), (1,-1,0) or (1,1,1)
  hit(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const h = this.ray.intersectObject(this.cube, false)[0];
    if (!h) return null;
    const p = h.point, half = 0.85, band = half * 0.42;
    const d = new THREE.Vector3();
    for (const k of ["x", "y", "z"]) {
      const c = p[k];
      d[k] = c > half - band ? 1 : c < -half + band ? -1 : 0;
    }
    return d.lengthSq() ? d : null;
  }
  hover(e) {
    const d = e ? this.hit(e) : null;
    const half = 0.85, band = half * 0.42;
    if (d) {
      // size and place the highlight for this region
      const size = new THREE.Vector3(), pos = new THREE.Vector3();
      for (const k of ["x", "y", "z"]) {
        if (d[k]) { size[k] = d.lengthSq() === 1 ? 0.04 : band; pos[k] = d[k] * (half - (d.lengthSq() === 1 ? -0.01 : band / 2 - 0.02)); }
        else { size[k] = 2 * (half - band); pos[k] = 0; }
      }
      if (d.lengthSq() === 1) for (const k of ["x", "y", "z"]) if (!d[k]) size[k] = 2 * (half - band);
      this.hi.scale.copy(size).max(new THREE.Vector3(0.04, 0.04, 0.04));
      this.hi.position.copy(pos);
      this.hi.visible = true;
    } else this.hi.visible = false;
    const face = d && d.lengthSq() === 1 ? ["x", "y", "z"].map((k, i) => (d[k] ? i * 2 + (d[k] > 0 ? 0 : 1) : -1)).find((i) => i >= 0) : null;
    this.cube.material = this.mats.map((m, i) => (i === face ? this.hoverMats[i] : m));
    this.renderer.domElement.style.cursor = d ? "pointer" : "default";
    this.render();
  }
  render() {
    const cam = this.vp.camera;
    const dir = new THREE.Vector3().subVectors(cam.position, this.vp.view.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(4));
    this.camera.up.copy(cam.up);
    this.camera.quaternion.copy(cam.quaternion);
    this.renderer.render(this.scene, this.camera);
  }
}
