// Projection media: pictures and videos put onto 3D objects, for projection
// mapping with the Projector. Each object can carry one picture or video, fitted one of four ways:
//   Facing view - projected straight on from one direction (like a real projector; set it from
//                 the current view), on the faces that face it (or through to the back too)
//   Wrap around - around the object like a label on a can
//   All sides   - a copy on every side, like wrapping a box
//   Ball        - wrapped onto a sphere
// Media is drawn unlit (at full brightness), on screen and in the projector window. It only
// changes how objects look: models and 3D-print exports are not changed.
// Pictures are saved with the design (scaled to at most 1600 px). Videos stay while the page
// is open: after reopening a design, add the video again (the fitting is remembered).
import * as THREE from "three";
import { store } from "./store.js";
import { el, uid } from "./util.js";

const MAPS = [["front", "Facing view"], ["wrap", "Wrap around"], ["box", "All sides"], ["ball", "Ball"]];
const VERT = `varying vec3 vP; varying vec3 vN;
void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform sampler2D map; uniform int mode; uniform vec3 bmin; uniform vec3 bmax;
uniform vec3 pRight; uniform vec3 pUp; uniform vec3 pDir; uniform vec4 pRect; uniform bool both;
uniform float rep; uniform int rot; uniform bool mirror; uniform vec2 uvScale; uniform vec2 uvOffset;
varying vec3 vP; varying vec3 vN;
const float PI = 3.14159265;
void main(){
  vec3 s = max(bmax - bmin, vec3(1e-4)), c = (bmin + bmax) * 0.5, n = normalize(vN);
  vec2 uv; float alpha = 1.0;
  if (mode == 0) {
    // faces seen edge-on would only smear the picture: it fades into the object's own color
    float f = dot(n, pDir), facing = both ? abs(f) : -f;
    alpha = smoothstep(0.1, 0.4, facing);
    if (alpha <= 0.0) discard;
    uv = vec2((dot(vP, pRight) - pRect.x) / pRect.z, (dot(vP, pUp) - pRect.y) / pRect.w);
  } else if (mode == 1) {
    vec2 d = vP.xy - c.xy;
    uv = vec2(0.5 + atan(d.x, -d.y) / (2.0 * PI), (vP.z - bmin.z) / s.z);
  } else if (mode == 2) {
    vec3 a = abs(n), q = (vP - bmin) / s;
    if (a.z >= a.x && a.z >= a.y) uv = vec2(n.z > 0.0 ? q.x : 1.0 - q.x, q.y);
    else if (a.x >= a.y) uv = vec2(n.x > 0.0 ? q.y : 1.0 - q.y, q.z);
    else uv = vec2(n.y < 0.0 ? q.x : 1.0 - q.x, q.z);
  } else {
    vec3 d = normalize(vP - c);
    uv = vec2(0.5 + atan(d.x, -d.y) / (2.0 * PI), 0.5 + asin(clamp(d.z, -1.0, 1.0)) / PI);
  }
  if (mirror) uv.x = 1.0 - uv.x;
  if (rot == 1) uv = vec2(uv.y, 1.0 - uv.x); else if (rot == 2) uv = 1.0 - uv; else if (rot == 3) uv = vec2(1.0 - uv.y, uv.x);
  uv = fract(uv * rep);
  vec4 col = texture2D(map, uvOffset + uv * uvScale);
  gl_FragColor = vec4(col.rgb, alpha);
  #include <colorspace_fragment>
}`;

export function initMedia(app) {
  const vp = app.vp, scene = app.scene;
  const reg = new Map(); // media id -> { kind, tex, video?, url?, w, h }
  let missingTex = null;
  // ---- textures for the media of the design
  function missing(name) {
    if (!missingTex) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 256;
      const g = c.getContext("2d");
      g.fillStyle = "#22262c"; g.fillRect(0, 0, 512, 256);
      g.strokeStyle = "#e8a33d"; g.lineWidth = 8; g.strokeRect(8, 8, 496, 240);
      g.fillStyle = "#fff"; g.font = "bold 34px system-ui, sans-serif"; g.textAlign = "center";
      g.fillText("Video missing", 256, 116); g.font = "22px system-ui, sans-serif"; g.fillText("Add it again in Media", 256, 156);
      missingTex = new THREE.CanvasTexture(c); missingTex.colorSpace = THREE.SRGBColorSpace;
    }
    return { kind: "missing", tex: missingTex, w: 2, h: 1 };
  }
  function entryFor(id, doc) {
    let e = reg.get(id);
    if (e) return e;
    const m = doc && doc.media && doc.media[id];
    if (!m) return null;
    if (m.kind === "image" && m.src) {
      const tex = new THREE.TextureLoader().load(m.src, (t) => { e.w = t.image.width; e.h = t.image.height; scene.refresh(); vp.request(); });
      tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      e = { kind: "image", tex, w: m.w || 1, h: m.h || 1 };
      reg.set(id, e);
      return e;
    }
    return missing(m.name);
  }
  // ---- put the media on a body's view (called whenever the scene refreshes)
  function applyToView(v, b, doc) {
    const md = b.media;
    if (!md || !v.mesh || b.hole) { if (v.mediaMesh) { v.group.remove(v.mediaMesh); v.mediaMesh.material.dispose(); v.mediaMesh = null; } return; }
    const e = entryFor(md.id, doc);
    if (!e) { if (v.mediaMesh) { v.group.remove(v.mediaMesh); v.mediaMesh = null; } return; }
    let mm = v.mediaMesh;
    if (!mm) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, mode: { value: 0 }, bmin: { value: new THREE.Vector3() }, bmax: { value: new THREE.Vector3() }, pRight: { value: new THREE.Vector3(1, 0, 0) }, pUp: { value: new THREE.Vector3(0, 0, 1) }, pDir: { value: new THREE.Vector3(0, 1, 0) }, pRect: { value: new THREE.Vector4(0, 0, 1, 1) }, both: { value: false }, rep: { value: 1 }, rot: { value: 0 }, mirror: { value: false }, uvScale: { value: new THREE.Vector2(1, 1) }, uvOffset: { value: new THREE.Vector2(0, 0) } },
        vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: true,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, depthFunc: THREE.LessEqualDepth,
      });
      mm = v.mediaMesh = new THREE.Mesh(v.mesh.geometry, mat);
      mm.raycast = () => {}; // never picked: clicks go to the body itself
      mm.renderOrder = 1; mm.castShadow = false; mm.receiveShadow = false;
      v.group.add(mm);
    }
    if (mm.geometry !== v.mesh.geometry) mm.geometry = v.mesh.geometry;
    mm.position.copy(v.mesh.position); mm.scale.copy(v.mesh.scale);
    const g = v.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox, U = mm.material.uniforms;
    U.map.value = e.tex;
    U.mode.value = Math.max(0, MAPS.findIndex(([k]) => k === (md.map || "front")));
    U.bmin.value.copy(bb.min); U.bmax.value.copy(bb.max);
    U.rep.value = md.rep || 1; U.rot.value = ((md.rot || 0) / 90) & 3; U.mirror.value = !!md.mirror; U.both.value = (md.map || "front") === "front" && !!md.both;
    // facing view: the picture plane, and how far the object spans across it
    const dir = new THREE.Vector3(...(md.dir || [0, 1, 0])).normalize(), up0 = new THREE.Vector3(...(md.up || [0, 0, 1]));
    const right = new THREE.Vector3().crossVectors(dir, up0).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let i = 0; i < 8; i++) { const p = new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z); const a = p.dot(right), c = p.dot(up); u0 = Math.min(u0, a); u1 = Math.max(u1, a); w0 = Math.min(w0, c); w1 = Math.max(w1, c); }
    U.pRight.value.copy(right); U.pUp.value.copy(up); U.pDir.value.copy(dir);
    U.pRect.value.set(u0, w0, Math.max(1e-6, u1 - u0), Math.max(1e-6, w1 - w0));
    // which part of the picture: a given crop, or (facing view) "cover" so it fills the object
    if (md.crop) { const [a, bq, c, d] = md.crop; U.uvScale.value.set(c - a, d - bq); U.uvOffset.value.set(a, 1 - d); }
    else if ((md.map || "front") === "front" && !md.stretch) {
      const ia = (e.w || 1) / (e.h || 1), ra = (u1 - u0) / Math.max(1e-6, w1 - w0);
      if (ra > ia) { const k = ia / ra; U.uvScale.value.set(1, k); U.uvOffset.value.set(0, (1 - k) / 2); }
      else { const k = ra / ia; U.uvScale.value.set(k, 1); U.uvOffset.value.set((1 - k) / 2, 0); }
    } else { U.uvScale.value.set(1, 1); U.uvOffset.value.set(0, 0); }
    mm.visible = true;
  }
  scene.onView = applyToView;

  // ---- videos: redraw only when a new video frame arrives. While the Projector is open it
  // draws every frame itself and this window refreshes the video about 10 times a second
  // (redrawing the whole editor at video speed is what made playback slow).
  let playing = false, lastMain = 0;
  function onVideoFrame() {
    const now = performance.now();
    if (app.projector && app.projector.isOpen) {
      app.projector.draw();
      if (now - lastMain > 100) { lastMain = now; vp.request(); }
    } else vp.request();
  }
  setInterval(() => {
    let any = false;
    for (const e of reg.values()) if (e.video && !e.video.paused && !e.video.ended) { any = true; break; }
    if (any !== playing) { playing = any; if (panel && !panel.hidden) renderPanel(); }
  }, 400);
  // the largest video picture sent to the graphics card, by performance mode
  const VMAX = { ultra: 1280, high: 960, normal: 640 };

  // ---- adding media
  function pickFile() {
    return new Promise((res) => {
      const inp = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp,video/mp4,video/webm,video/ogg,video/quicktime", style: { display: "none" } });
      inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
      document.body.append(inp); inp.click();
    });
  }
  function readImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let src = c.toDataURL("image/png"); if (src.length > 900000) src = c.toDataURL("image/jpeg", 0.85);
        res({ src, w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That picture couldn't be opened.")); };
      img.src = url;
    });
  }
  function addVideoEntry(id, file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    // iPhone / iPad only play a video by itself when it is muted and "inline" (as attributes)
    video.setAttribute("muted", ""); video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", "");
    Object.assign(video, { muted: true, loop: true, playsInline: true, crossOrigin: "anonymous", preload: "auto" });
    video.src = url;
    // each new frame is copied into a (smaller) canvas, and only then sent to the graphics card
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 9;
    const g = canvas.getContext("2d", { alpha: false });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const e = { kind: "video", tex, video, url, w: 16, h: 9, name: file.name, canvas };
    const size = () => {
      const vw = video.videoWidth || 16, vh = video.videoHeight || 9, k = Math.min(1, (VMAX[app.perfLevel] || 1280) / vw);
      const w = Math.max(2, Math.round(vw * k)), h = Math.max(2, Math.round(vh * k));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; tex.dispose(); }
    };
    const grab = () => {
      if (video.readyState < 2) return;
      size();
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      tex.needsUpdate = true;
      onVideoFrame();
    };
    // a callback per decoded video frame where the browser has it; otherwise check each frame
    if (video.requestVideoFrameCallback) { const step = () => { grab(); video.requestVideoFrameCallback(step); }; video.requestVideoFrameCallback(step); }
    else { let last = -1; (function poll() { requestAnimationFrame(poll); if (!video.paused && video.currentTime !== last) { last = video.currentTime; grab(); } })(); }
    video.addEventListener("loadedmetadata", () => { e.w = video.videoWidth || 16; e.h = video.videoHeight || 9; size(); scene.refresh(); vp.request(); });
    video.addEventListener("loadeddata", grab);
    video.addEventListener("seeked", grab);
    reg.set(id, e);
    video.play().catch(() => {});
    return e;
  }
  async function addMedia(targets) {
    const f = await pickFile();
    if (!f) return;
    const isVideo = /^video\//.test(f.type) || /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(f.name);
    const id = uid("md");
    try {
      if (isVideo) {
        addVideoEntry(id, f);
        store.update((doc) => { doc.media = doc.media || {}; doc.media[id] = { kind: "video", name: f.name }; for (const b of doc.bodies) if (targets.includes(b.id)) b.media = fitFor(b, id, b.media); }, "Add video");
        app.toast("Video added. It plays on the object here and in the projector window. Videos aren't saved with the design: add it again after reopening.");
      } else {
        const im = await readImage(f);
        store.update((doc) => { doc.media = doc.media || {}; doc.media[id] = { kind: "image", name: f.name, src: im.src, w: im.w, h: im.h }; for (const b of doc.bodies) if (targets.includes(b.id)) b.media = fitFor(b, id, b.media); }, "Add picture");
      }
    } catch (err) { app.toast(err.message || "That file couldn't be used.", "err"); }
  }
  // a new piece of media keeps the object's fitting; a first one faces the current view
  function fitFor(b, id, old) {
    if (old) return { ...old, id, crop: undefined };
    return { id, map: "front", ...viewDir(b), rep: 1, rot: 0, mirror: false, both: false };
  }
  // the current view's direction in a body's own coordinates
  function viewDir(b) {
    const m = new THREE.Matrix4().fromArray(b.m), inv = new THREE.Matrix3().setFromMatrix4(m).invert();
    const cam = vp.camera, d = new THREE.Vector3(); cam.getWorldDirection(d);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const r = (x) => +x.toFixed(5);
    return { dir: d.applyMatrix3(inv).normalize().toArray().map(r), up: up.applyMatrix3(inv).normalize().toArray().map(r) };
  }
  function setFit(ids, patch, label = "Media fitting") {
    store.update((doc) => { for (const b of doc.bodies) if (ids.includes(b.id) && b.media) b.media = { ...b.media, ...(typeof patch === "function" ? patch(b) : patch) }; }, label);
  }

  // ---- the panel
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>';
  const btn = el("button", { id: "nav-media", "aria-pressed": "false", title: "Media: put pictures and videos on your objects", html: ICON, onclick: () => toggle() });
  const nav = document.querySelector(".navbtns"), pb = document.getElementById("nav-projector");
  if (nav) { if (pb) pb.before(btn); else nav.append(btn); }
  const panel = el("div", { class: "float media-panel", id: "media-panel", hidden: true });
  document.getElementById("viewport").append(panel);
  function toggle(on = panel.hidden) { panel.hidden = !on; btn.setAttribute("aria-pressed", String(on)); if (on) renderPanel(); }
  const selected = () => (app.sel || []).map((id) => store.view.bodies.find((b) => b.id === id)).filter((b) => b && !b.hole);
  function renderPanel() {
    if (panel.hidden) return;
    panel.innerHTML = "";
    panel.append(el("header", {}, el("h4", {}, "Media"), el("button", { class: "xbtn", "aria-label": "Close", html: "&times;", onclick: () => toggle(false) })));
    const body = el("div", { class: "body" });
    panel.append(body);
    const sel = selected(), ids = sel.map((b) => b.id), doc = store.view;
    if (!sel.length) {
      body.append(el("div", { class: "hint", style: { padding: 0 } }, "Select one or more objects, then add a picture or video to them. It shows on the objects here and in the Projector window."));
      libRow(body, doc, null);
      return;
    }
    const first = sel[0], md = first.media;
    body.append(el("div", { class: "hint", style: { padding: 0 } }, el("b", {}, sel.length === 1 ? first.name : sel.length + " objects")));
    body.append(el("button", { class: "btn primary", id: "media-add", style: { width: "100%" }, onclick: () => addMedia(ids) }, md ? "Change picture or video…" : "Add picture or video…"));
    libRow(body, doc, ids);
    if (!md) return;
    const e = entryFor(md.id, doc), info = doc.media && doc.media[md.id];
    body.append(el("div", { class: "subhead" }, (info && info.kind === "video" ? "Video · " : "Picture · ") + ((info && info.name) || "")));
    // fit
    const seg = el("div", { class: "seg media-seg", id: "media-map" });
    for (const [k, label] of MAPS) seg.append(el("button", { "aria-pressed": String((md.map || "front") === k), onclick: () => setFit(ids, k === "front" && (md.map || "front") !== "front" ? (b) => ({ map: k, ...viewDir(b) }) : { map: k }) }, label));
    body.append(seg);
    if ((md.map || "front") === "front") {
      body.append(el("div", { class: "media-row" },
        el("button", { class: "btn", id: "media-aim", title: "Project it straight from the way you're looking now", onclick: () => setFit(ids, (b) => viewDir(b), "Aim media") }, "Aim from this view"),
        el("label", { class: "check" }, el("input", { type: "checkbox", id: "media-both", checked: !!md.both, onchange: (ev) => setFit(ids, { both: ev.target.checked }) }), "Through to the back")));
    }
    // repeat, turn, mirror
    const rep = el("input", { type: "range", min: 1, max: 8, step: 1, value: md.rep || 1, id: "media-rep" });
    const repOut = el("output", {}, "×" + (md.rep || 1));
    rep.oninput = () => { repOut.textContent = "×" + rep.value; };
    rep.onchange = () => setFit(ids, { rep: +rep.value });
    body.append(el("label", { class: "media-slider" }, el("span", {}, "Repeat"), rep, repOut));
    const turn = el("div", { class: "seg", id: "media-rot" });
    for (const a of [0, 90, 180, 270]) turn.append(el("button", { "aria-pressed": String((md.rot || 0) === a), onclick: () => setFit(ids, { rot: a }) }, a + "°"));
    body.append(el("div", { class: "media-row" }, el("span", { class: "lbl" }, "Turn"), turn));
    body.append(el("label", { class: "check" }, el("input", { type: "checkbox", id: "media-mirror", checked: !!md.mirror, onchange: (ev) => setFit(ids, { mirror: ev.target.checked }) }), "Mirror"));
    // video controls
    if (e && e.video) {
      const v = e.video;
      body.append(el("div", { class: "media-row media-video" },
        el("button", { class: "btn", id: "media-play", onclick: () => { if (v.paused) v.play().catch(() => {}); else v.pause(); setTimeout(renderPanel, 50); } }, v.paused ? "▶ Play" : "❚❚ Pause"),
        el("button", { class: "btn", id: "media-restart", title: "Back to the start", onclick: () => { v.currentTime = 0; v.play().catch(() => {}); } }, "⟲"),
        el("button", { class: "btn", id: "media-sound", "aria-pressed": String(!v.muted), title: "Sound plays from this window", onclick: () => { v.muted = !v.muted; renderPanel(); } }, v.muted ? "Sound off" : "Sound on"),
        el("label", { class: "check" }, el("input", { type: "checkbox", checked: v.loop, onchange: (ev) => { v.loop = ev.target.checked; } }), "Loop")));
    } else if (e && e.kind === "missing") {
      body.append(el("div", { class: "hint", style: { padding: 0 } }, "This video isn't loaded (videos aren't saved with the design). Use ", el("b", {}, "Change picture or video"), " to add it again: the fitting stays."));
    }
    body.append(el("button", { class: "btn danger", id: "media-remove", style: { width: "100%", marginTop: "6px" }, onclick: () => store.update((d) => { for (const b of d.bodies) if (ids.includes(b.id)) delete b.media; }, "Remove media") }, "Remove from " + (sel.length === 1 ? "this object" : "these objects")));
    body.append(el("div", { class: "hint", style: { padding: "6px 0 0", fontSize: "11.5px" } }, "Media changes only how objects look (here and in the Projector), not what gets 3D printed."));
  }
  // pictures and videos already in this design: click one to use it on the selection
  function libRow(body, doc, ids) {
    const lib = Object.entries((doc && doc.media) || {});
    if (!lib.length) return;
    const row = el("div", { class: "media-lib" });
    for (const [id, m] of lib) {
      const t = el("button", { class: "media-thumb", title: (ids ? "Use " : "") + m.name, disabled: !ids, onclick: () => ids && store.update((d) => { for (const b of d.bodies) if (ids.includes(b.id)) b.media = fitFor(b, id, b.media); }, "Use media") });
      if (m.kind === "image" && m.src) t.append(el("img", { src: m.src, alt: "" }));
      else t.append(el("span", { html: ICON }));
      t.append(el("span", { class: "nm" }, m.name || ""));
      row.append(t);
    }
    body.append(el("div", { class: "subhead" }, "In this design"), row);
  }
  // keep the panel in step with the selection and the design
  const prevRefresh = app.refreshUI;
  app.refreshUI = function (kind) { prevRefresh.call(app, kind); if (kind === "select" && !panel.hidden) renderPanel(); };
  let rq = 0;
  store.on((kind) => { if (kind === "preview" || panel.hidden || rq) return; rq = requestAnimationFrame(() => { rq = 0; renderPanel(); }); });
  // forget videos of media no longer used anywhere (and their memory)
  return { applyToView, entryFor, addVideoEntry, open: () => toggle(true), close: () => toggle(false), render: renderPanel, registry: reg, viewDir };
}
