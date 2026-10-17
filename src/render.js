// Photo-style renderer. Many frames are drawn and averaged: each frame moves the
// camera by a fraction of a pixel (smooth edges), samples a random point on the
// key light (soft shadows) and a random patch of sky (soft ambient shadows), so the
// average converges to a clean, soft-lit, photo-like image. Output is a PNG.
import * as THREE from "three";
import { IS_IOS, IS_IPHONE } from "./util.js";
import { lookOf } from "./appearance.js";

export const QUALITY = {
  low: { label: "Low", width: 1280, samples: 48, note: "a few seconds" },
  medium: { label: "Medium", width: 1920, samples: 160, note: "under a minute" },
  high: { label: "High", width: 2560, samples: 480, note: "about 1–3 minutes" },
  ultra: { label: "Ultra high", width: 3840, samples: 1200, note: "several minutes" },
};
export const LIGHT_COLORS = {
  neutral: { label: "Neutral", color: "#ffffff", sky: "#eef3fa" },
  warm: { label: "Warm", color: "#ffd3a3", sky: "#f6efe6" },
  cool: { label: "Cool", color: "#d4e3ff", sky: "#e2ecfb" },
  sunset: { label: "Sunset", color: "#ff9b5e", sky: "#c9b8d9" },
  daylight: { label: "Daylight", color: "#fff6e8", sky: "#bcd6ff" },
};
export const LIGHT_TYPES = {
  studio: { label: "Studio softbox", key: 2.6, soft: 0.22, fill: 0.55, rim: 0, sky: 1.1, env: 0.55 },
  sun: { label: "Sun", key: 3.6, soft: 0.015, fill: 0, rim: 0, sky: 0.9, env: 0.45 },
  spot: { label: "Spotlight", key: 5.2, soft: 0.05, fill: 0, rim: 0.0, sky: 0.12, env: 0.12, spot: true },
  overcast: { label: "Overcast", key: 0.35, soft: 0.6, fill: 0, rim: 0, sky: 2.3, env: 0.6 },
  threepoint: { label: "Three-point", key: 2.4, soft: 0.12, fill: 0.7, rim: 1.6, sky: 0.35, env: 0.4 },
};
export const BACKGROUNDS = {
  studio: { label: "Light studio", top: "#f4f6f9", bottom: "#c9d0d8", floor: 0.42 },
  dark: { label: "Dark studio", top: "#3a4452", bottom: "#0e1217", floor: 0.6 },
  white: { label: "White", top: "#ffffff", bottom: "#ffffff", floor: 0.32 },
  transparent: { label: "Transparent", floor: 0.38 },
  image: { label: "Your picture", floor: 0.4 },
};

// a soft photo studio for reflections
function studioEnv(renderer) {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9aa1a9, side: THREE.BackSide })));
  const panel = (x, y, z, sx, sy, sz, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); room.add(m); };
  panel(0, 0, 4.9, 6, 6, 0.1, 0xffffff);
  panel(-4.9, -1, 1.5, 0.1, 4, 3, 0xe4e8ec);
  panel(3, -4.9, 1, 3, 0.1, 2.5, 0xd2d7dc);
  panel(4.9, 2, 2, 0.1, 2, 3, 0xc0c6cc);
  panel(0, 0, -4.9, 9, 9, 0.1, 0x3d434a);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  return tex;
}
function gradientTexture(top, bottom) {
  const cv = document.createElement("canvas");
  cv.width = 4; cv.height = 512;
  const g = cv.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// random direction in the upper hemisphere (cosine weighted), +Z up
function skyDir(r1, r2) {
  const phi = 2 * Math.PI * r1, ct = Math.sqrt(1 - r2), st = Math.sqrt(r2);
  return new THREE.Vector3(Math.cos(phi) * st, Math.sin(phi) * st, ct);
}
// low-discrepancy sequence: evenly spread samples converge faster than random ones
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

// the materials used in the picture: a little richer than the editor's
function photoMaterial(look, fallbackColor, env) {
  const L = look ? lookOf(look) : { color: fallbackColor || "#a7b0ba", metal: 0, rough: 0.42, opacity: 1 };
  const plastic = L.metal < 0.5;
  const m = new THREE.MeshPhysicalMaterial({
    color: L.color, metalness: L.metal, roughness: L.rough, envMap: env,
    envMapIntensity: L.metal > 0.5 ? 1.25 : 0.6,
    clearcoat: plastic && L.rough < 0.5 ? 0.35 : 0, clearcoatRoughness: 0.25,
    side: THREE.DoubleSide,
  });
  if (L.opacity < 1) { m.transparent = true; m.opacity = L.opacity; m.depthWrite = false; }
  return m;
}

/*
  job = {
    items: [{ geometry, matrix: Matrix4, materials: [{look|null, color}], groups: [materialIndex per group] | null }],
    camera, width, height, samples, lightType, lightColor, customColor, azimuth, elevation, intensity,
    background, bgImage (HTMLImageElement), floor (bool), onProgress(n, total, canvas), transparent
  }
  returns { promise (Blob), cancel() }
*/
export function renderImage(job) {
  let cancelled = false;
  // iPhone / iPad: Safari closes a page that asks for too much picture memory, so very big
  // renders are made a little smaller there (the shape of the picture stays the same)
  const cap = IS_IPHONE ? 4.2e6 : IS_IOS ? 8.4e6 : 4e7, sc = Math.min(1, Math.sqrt(cap / Math.max(1, job.width * job.height)));
  const W = Math.max(64, Math.round(job.width * sc)), H = Math.max(64, Math.round(job.height * sc));
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxTex = renderer.capabilities.maxTextureSize;
  const shadowSize = Math.min(job.samples >= 400 ? 4096 : 2048, maxTex);

  const env = studioEnv(renderer);
  const scene = new THREE.Scene();
  scene.environment = env;
  const T = LIGHT_TYPES[job.lightType] || LIGHT_TYPES.studio;
  const LC = LIGHT_COLORS[job.lightColor] || LIGHT_COLORS.neutral;
  const keyColor = new THREE.Color(job.lightColor === "custom" ? job.customColor || "#ffffff" : LC.color);
  const skyColor = new THREE.Color(job.lightColor === "custom" ? job.customColor || "#ffffff" : LC.sky).lerp(new THREE.Color("#ffffff"), job.lightColor === "custom" ? 0.6 : 0);
  const k = Math.max(0.05, job.intensity ?? 1);
  scene.environmentIntensity = T.env * k;

  // the model
  const root = new THREE.Group();
  const mats = [];
  for (const it of job.items) {
    const ms = it.materials.map((m) => photoMaterial(m.look, m.color, env));
    mats.push(...ms);
    const g = it.geometry.clone();
    if (it.groups && g.groups.length) g.groups.forEach((gr, i) => (gr.materialIndex = it.groups[i] || 0));
    const mesh = new THREE.Mesh(g, ms.length > 1 ? ms : ms[0]);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(it.matrix);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  scene.add(root);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 10));
  const center = box.getCenter(new THREE.Vector3()), R = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
  const floorZ = box.min.z;

  // background and floor
  const BG = BACKGROUNDS[job.background] || BACKGROUNDS.studio;
  let bgTex = null;
  if (job.background === "image" && job.bgImage) {
    bgTex = new THREE.Texture(job.bgImage);
    bgTex.colorSpace = THREE.SRGBColorSpace;
    bgTex.needsUpdate = true;
    // fill the frame without stretching (like "cover")
    const ia = job.bgImage.naturalWidth / job.bgImage.naturalHeight, oa = W / H;
    if (ia > oa) { bgTex.repeat.set(oa / ia, 1); bgTex.offset.set((1 - oa / ia) / 2, 0); }
    else { bgTex.repeat.set(1, ia / oa); bgTex.offset.set(0, (1 - ia / oa) / 2); }
    scene.background = bgTex;
  } else if (BG.top) { bgTex = gradientTexture(BG.top, BG.bottom); scene.background = bgTex; }
  const transparent = job.background === "transparent";
  let floor = null;
  const floorWeights = { value: new Array(8).fill(1) };
  if (job.floor !== false) {
    // a shadow catcher where each light darkens the floor by its share of the light
    // (a sun casts a strong shadow; each patch of sky only a little)
    const fm = new THREE.ShadowMaterial({ opacity: BG.floor, transparent: true, depthWrite: false });
    fm.onBeforeCompile = (sh) => {
      sh.uniforms.uW = floorWeights;
      sh.fragmentShader = "uniform float uW[ 8 ];\n" + sh.fragmentShader.replace("gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );", `
        float m = 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 0
        DirectionalLightShadow dls;
        #pragma unroll_loop_start
        for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
          dls = directionalLightShadows[ i ];
          m *= getShadow( directionalShadowMap[ i ], dls.shadowMapSize, uW[ i ], dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[ i ] );
        }
        #pragma unroll_loop_end
        #endif
        #if NUM_SPOT_LIGHT_SHADOWS > 0
        SpotLightShadow sls;
        #pragma unroll_loop_start
        for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
          sls = spotLightShadows[ i ];
          m *= getShadow( spotShadowMap[ i ], sls.shadowMapSize, 1.0, sls.shadowBias, sls.shadowRadius, vSpotLightCoord[ i ] );
        }
        #pragma unroll_loop_end
        #endif
        gl_FragColor = vec4( color, opacity * ( 1.0 - m ) );`);
    };
    floor = new THREE.Mesh(new THREE.PlaneGeometry(R * 40, R * 40), fm);
    floor.position.set(center.x, center.y, floorZ - R * 1e-4);
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // lights: key (moves over its area each frame), fill, rim, and sky samples
  // light direction is measured from the camera: 0° = from behind the camera, negative = from the left
  const camV = job.camera.position.clone().sub(center);
  const camAz = Math.atan2(camV.y, camV.x);
  const az = camAz + ((job.azimuth ?? -50) * Math.PI) / 180, el = ((Math.max(2, Math.min(88, job.elevation ?? 45))) * Math.PI) / 180;
  const keyDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).normalize();
  const fitShadow = (light, dir, r = R) => {
    light.position.copy(center).addScaledVector(dir, r * 4);
    light.target.position.copy(center);
    const c = light.shadow.camera;
    if (c.isOrthographicCamera) { c.left = -r * 1.5; c.right = r * 1.5; c.top = r * 1.5; c.bottom = -r * 1.5; }
    c.near = r * 0.5; c.far = r * 9;
    c.updateProjectionMatrix();
  };
  const mkDir = (int, color, shadows) => {
    const l = new THREE.DirectionalLight(color, int);
    l.castShadow = shadows;
    l.shadow.mapSize.set(shadowSize, shadowSize);
    l.shadow.bias = -0.0002; l.shadow.normalBias = R * 0.004;
    scene.add(l, l.target);
    return l;
  };
  let key;
  if (T.spot) {
    key = new THREE.SpotLight(keyColor, T.key * k, 0, Math.PI / 9, 0.45, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.0002;
    scene.add(key, key.target);
  } else key = mkDir(T.key * k, keyColor, true);
  const fill = T.fill ? mkDir(T.fill * k, keyColor.clone().lerp(skyColor, 0.5), false) : null;
  const rim = T.rim ? mkDir(T.rim * k, keyColor, true) : null;
  const SKY = 2;
  const skies = Array.from({ length: SKY }, () => mkDir((T.sky * k) / SKY, skyColor, true));
  // how much of the shadowing light each caster carries (the floor darkens by these)
  // (directional shadow casters in the order they were added: key unless it is a spot, rim, sky)
  const totalI = T.key + (T.rim || 0) + T.sky;
  const dirW = [...(T.spot ? [] : [Math.min(1, (T.key / totalI) * 1.25)]), ...(rim ? [Math.min(1, (T.rim / totalI) * 0.8)] : []), ...skies.map(() => Math.min(1, (T.sky / totalI) * 1.5))];
  dirW.forEach((w, i) => (floorWeights.value[i] = w));
  if (fill) fitShadow(fill, new THREE.Vector3(-keyDir.x, -keyDir.y, Math.max(0.25, keyDir.z * 0.6)).normalize());
  if (rim) fitShadow(rim, new THREE.Vector3(-keyDir.x * 0.6, -keyDir.y * 0.6, 0.55).normalize().add(new THREE.Vector3(0, 0, 0)));

  // camera: what the view shows, at the picture's proportions
  const cam = job.camera.clone();
  if (cam.isPerspectiveCamera) cam.aspect = W / H;
  else { const h = (cam.top - cam.bottom) / 2, cx = (cam.left + cam.right) / 2; cam.left = cx - h * (W / H); cam.right = cx + h * (W / H); }
  cam.updateProjectionMatrix();

  // accumulation buffers (linear, high precision)
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: 0 };
  const frameRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
  let accA = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: false });
  let accB = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: false });
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const accMat = new THREE.ShaderMaterial({
    uniforms: { prev: { value: null }, cur: { value: null }, w: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D prev, cur; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(prev, vUv), texture2D(cur, vUv), w); }",
    depthTest: false, depthWrite: false,
  });
  const outMat = new THREE.ShaderMaterial({
    uniforms: { src: { value: null }, keepAlpha: { value: transparent ? 1 : 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D src; uniform float keepAlpha; varying vec2 vUv;
      void main(){ vec4 c = texture2D(src, vUv); gl_FragColor = vec4(c.rgb, keepAlpha > 0.5 ? c.a : 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, transparent: false,
  });
  outMat.toneMapped = true;
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, accMat);
  quadScene.add(quad);

  const total = Math.max(1, job.samples | 0);
  const syncBuf = new Uint16Array(4);
  let n = 0;
  const t0 = performance.now();
  function frame(i) {
    // subpixel camera shift: smooth edges
    const jx = halton(i + 1, 2) - 0.5, jy = halton(i + 1, 3) - 0.5;
    cam.setViewOffset(W, H, jx, jy, W, H);
    // key light: a random point on a disc around its direction (soft shadows)
    const u = halton(i + 1, 5), v = halton(i + 1, 7);
    const a = 2 * Math.PI * u, rr = Math.sqrt(v) * T.soft * (job.softness ?? 1);
    const t1 = new THREE.Vector3(0, 0, 1).cross(keyDir); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize();
    const t2 = keyDir.clone().cross(t1).normalize();
    const d = keyDir.clone().addScaledVector(t1, Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr).normalize();
    if (T.spot) { key.position.copy(center).addScaledVector(d, R * 4); key.target.position.copy(center); key.shadow.camera.near = R * 0.5; key.shadow.camera.far = R * 9; key.shadow.camera.updateProjectionMatrix(); }
    else fitShadow(key, d);
    // sky: a few random directions over the dome (soft shadows from all around)
    skies.forEach((s, j) => fitShadow(s, skyDir(halton(i * SKY + j + 1, 11), halton(i * SKY + j + 1, 13))));
    if (rim) { const rd = rim.position.clone().sub(center).normalize(); fitShadow(rim, rd.clone().addScaledVector(t1, (u - 0.5) * 0.15).normalize()); }
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(frameRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    // running average
    quad.material = accMat;
    accMat.uniforms.prev.value = accA.texture;
    accMat.uniforms.cur.value = frameRT.texture;
    accMat.uniforms.w.value = 1 / (i + 1);
    renderer.setRenderTarget(accB);
    renderer.render(quadScene, quadCam);
    [accA, accB] = [accB, accA];
  }
  function present() {
    quad.material = outMat;
    outMat.uniforms.src.value = accA.texture;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(quadScene, quadCam);
  }
  function cleanup() {
    for (const m of mats) m.dispose();
    root.traverse((o) => o.geometry && o.geometry.dispose());
    frameRT.dispose(); accA.dispose(); accB.dispose(); env.dispose(); bgTex && bgTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  const promise = new Promise((resolve, reject) => {
    let lastShow = 0;
    const step = () => {
      if (cancelled) { cleanup(); reject(new Error("cancelled")); return; }
      try {
        const s0 = performance.now();
        // read back one pixel after each pass: it makes the GPU actually finish the work,
        // so progress is honest and the browser never gets a huge queue of passes at once
        while (n < total && performance.now() - s0 < 40) { frame(n++); renderer.readRenderTargetPixels(accA, 0, 0, 1, 1, syncBuf); }
        if (performance.now() - lastShow > 350 || n >= total) { present(); lastShow = performance.now(); job.onProgress && job.onProgress(n, total, renderer.domElement, performance.now() - t0); }
        if (n < total) { setTimeout(step, 0); return; }
        present();
        renderer.domElement.toBlob((blob) => { const url = renderer.domElement.toDataURL("image/png"); cleanup(); resolve({ blob, url }); }, "image/png");
      } catch (e) { cleanup(); reject(e); }
    };
    setTimeout(step, 0);
  });
  return { promise, cancel() { cancelled = true; }, canvas: renderer.domElement };
}
