// Architect landscape: a weather simulator (sun, clouds, rain, thunderstorms, snow, fog and wind)
// and moving water (waves and ripples on ponds and lakes). Both are only for looking at: they can
// be switched on and off and never change the design or the exported model. Sizes in mm, Z up.
import * as THREE from "three";

export const WEATHER = [
  { id: "clear", name: "Sunny" }, { id: "cloudy", name: "Cloudy" }, { id: "rain", name: "Rain" },
  { id: "storm", name: "Thunderstorm" }, { id: "snow", name: "Snow" }, { id: "fog", name: "Fog" },
];
const rnd = (a, b) => a + Math.random() * (b - a);

export function makeWeather(vp, root) {
  const g = new THREE.Group();
  g.name = "weather";
  root.add(g);
  const st = { on: false, kind: "clear", wind: 0.3, water: true, waves: 0.5, t: 0, bounds: null, flash: 0, next: 3 };
  let rain = null, snow = null, clouds = null, saved = null, water = null, plants = null, raf = 0, last = 0;
  // the area the weather covers: the landscape (or the house), and how high it reaches
  function box() { const b = st.bounds || { x0: -10000, y0: -10000, x1: 10000, y1: 10000, z0: 0, z1: 6000 }; return { ...b, top: Math.max(b.z1 + 6000, 12000) }; }
  function clear() { for (const o of [rain, snow, clouds]) if (o) { g.remove(o); o.traverse((q) => { q.geometry && q.geometry.dispose(); q.material && q.material.dispose && q.material.dispose(); }); } rain = snow = clouds = null; }
  function build() {
    clear();
    if (!st.on) return;
    const B = box(), W = B.x1 - B.x0, D = B.y1 - B.y0, H = B.top - B.z0;
    if (st.kind === "rain" || st.kind === "storm") {
      const n = st.kind === "storm" ? 9000 : 5000, pos = new Float32Array(n * 6), v = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = rnd(B.x0, B.x1), y = rnd(B.y0, B.y1), z = rnd(B.z0, B.top); pos.set([x, y, z, x, y, z - 350], i * 6); v[i] = rnd(0.8, 1.2); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.55, depthWrite: false }));
      rain.userData = { v, n }; rain.frustumCulled = false; g.add(rain);
    }
    if (st.kind === "snow") {
      const n = 6000, pos = new Float32Array(n * 3), ph = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos.set([rnd(B.x0, B.x1), rnd(B.y0, B.y1), rnd(B.z0, B.top)], i * 3); ph[i] = rnd(0, 6.28); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
      snow.userData = { ph, n }; snow.frustumCulled = false; g.add(snow);
    }
    if (st.kind !== "clear" && st.kind !== "fog") {
      // a layer of soft clouds above the scene
      clouds = new THREE.Group();
      const dark = st.kind === "storm" ? 0x5d6470 : st.kind === "rain" ? 0x8a929c : 0xe9edf1;
      const mat = new THREE.MeshStandardMaterial({ color: dark, roughness: 1, transparent: true, opacity: st.kind === "cloudy" ? 0.7 : 0.85, depthWrite: false, flatShading: true });
      const nC = Math.max(6, Math.round((W * D) / 4e7));
      for (let i = 0; i < Math.min(nC, 40); i++) {
        const c = new THREE.Group();
        for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(1200, 2400), 1), mat); m.scale.set(1.6, 1, 0.55); m.position.set(rnd(-2500, 2500), rnd(-1200, 1200), rnd(-300, 300)); c.add(m); }
        c.position.set(rnd(B.x0, B.x1), rnd(B.y0, B.y1), B.top + rnd(3000, 6000));
        clouds.add(c);
      }
      clouds.userData = { W, D };
      g.add(clouds);
    }
    void H;
  }
  // light and sky for the weather (put back when it is switched off)
  function sky() {
    if (!saved) saved = { bg: vp.bg.clone(), hemi: vp.hemi.intensity, head: vp.headlight.intensity, key: vp.keyLight.intensity, sun: vp.sun.intensity, sunc: vp.sun.color.clone(), fog: vp.scene.fog };
    const k = st.on ? st.kind : null;
    const set = (bg, hemi, head, key, sun) => { vp.bg.set(bg); vp.hemi.intensity = saved.hemi * hemi; vp.headlight.intensity = saved.head * head; vp.keyLight.intensity = saved.key * key; vp.sun.intensity = sun; };
    if (!k) { vp.bg.copy(saved.bg); vp.hemi.intensity = saved.hemi; vp.headlight.intensity = saved.head; vp.keyLight.intensity = saved.key; vp.sun.intensity = saved.sun; vp.sun.color.copy(saved.sunc); vp.scene.fog = saved.fog || null; return; }
    vp.scene.fog = null;
    if (k === "clear") { set("#bcdcf5", 1, 0.9, 1.2, 1.2); vp.sun.color.set("#fff1d6"); }
    else if (k === "cloudy") set("#cdd5dd", 0.95, 0.85, 0.6, 0.15);
    else if (k === "rain") set("#9aa4ae", 0.8, 0.75, 0.4, 0);
    else if (k === "storm") set("#5e6670", 0.6, 0.6, 0.25, 0);
    else if (k === "snow") set("#dfe5ea", 1.05, 0.85, 0.5, 0.1);
    else if (k === "fog") { set("#d5dadf", 0.95, 0.8, 0.4, 0); vp.scene.fog = new THREE.Fog(0xd5dadf, 1000, 30000); }
  }
  // ---------------------------------------------------------------- each frame
  function frame(now) {
    raf = 0;
    if (!running()) return;
    // about 30 frames a second is plenty, and kinder to small laptops
    if (last && now - last < 30) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    st.t += dt;
    const B = box(), wind = st.wind;
    if (rain) {
      const P = rain.geometry.attributes.position.array, { v, n } = rain.userData, fall = (st.kind === "storm" ? 11000 : 8000) * dt, dx = wind * 4500 * dt, sl = wind * 300;
      for (let i = 0; i < n; i++) {
        const o = i * 6; let x = P[o] + dx * v[i], z = P[o + 2] - fall * v[i];
        if (z < B.z0) { z = B.top; x = rnd(B.x0, B.x1); P[o + 1] = P[o + 4] = rnd(B.y0, B.y1); }
        if (x > B.x1) x -= B.x1 - B.x0;
        P[o] = x; P[o + 2] = z; P[o + 3] = x - sl; P[o + 5] = z - 350;
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }
    if (snow) {
      const P = snow.geometry.attributes.position.array, { ph, n } = snow.userData, fall = 900 * dt;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        P[o] += (Math.sin(st.t * 1.3 + ph[i]) * 300 + wind * 2500) * dt; P[o + 1] += Math.cos(st.t + ph[i]) * 200 * dt; P[o + 2] -= fall * (0.7 + 0.3 * Math.sin(ph[i]));
        if (P[o + 2] < B.z0) { P[o + 2] = B.top; P[o] = rnd(B.x0, B.x1); P[o + 1] = rnd(B.y0, B.y1); }
        if (P[o] > B.x1) P[o] -= B.x1 - B.x0;
      }
      snow.geometry.attributes.position.needsUpdate = true;
    }
    if (clouds) for (const c of clouds.children) { c.position.x += (300 + wind * 2500) * dt; if (c.position.x > B.x1 + 3000) c.position.x = B.x0 - 3000; }
    // lightning
    if (st.on && st.kind === "storm") {
      st.next -= dt;
      if (st.next < 0) { st.flash = 0.25; st.next = rnd(2.5, 8); }
      if (st.flash > 0) { st.flash -= dt; vp.hemi.intensity = saved.hemi * (st.flash > 0.12 || (st.flash > 0 && st.flash < 0.06) ? 2.6 : 0.6); vp.bg.set(st.flash > 0 ? "#c9d2dc" : "#5e6670"); if (st.flash <= 0) { vp.hemi.intensity = saved.hemi * 0.6; vp.bg.set("#5e6670"); } }
    }
    // fog keeps to the distance you look from
    if (vp.scene.fog && st.on && st.kind === "fog") { const d = vp.camera.position.length(); vp.scene.fog.near = d * 0.15; vp.scene.fog.far = d * 1.5; }
    // wind sways the plants
    if (plants) {
      const amp = (st.on ? wind : 0) * 0.06 + (st.on && st.kind === "storm" ? 0.04 : 0);
      for (const p of plants.children) { const ph = (p.position.x + p.position.y) * 0.0007; p.rotation.x = amp * Math.sin(st.t * 2.1 + ph); p.rotation.y = amp * 0.7 * Math.sin(st.t * 1.7 + ph * 1.3); }
    }
    // moving water: waves across ponds and lakes, rain makes them choppier
    if (water && water.geometry.userData.base) {
      const P = water.geometry.attributes.position.array, base = water.geometry.userData.base;
      const a = st.water ? 18 + st.waves * 70 * (0.5 + (st.on ? wind : 0)) + (st.on && (st.kind === "rain" || st.kind === "storm") ? 25 : 0) : 0;
      const sp = 1 + (st.on ? wind * 2 : 0);
      for (let i = 0; i < P.length; i += 3) { const x = base[i], y = base[i + 1]; P[i + 2] = base[i + 2] + a * (Math.sin(x * 0.0021 + st.t * 1.6 * sp) * 0.6 + Math.sin(y * 0.0033 - st.t * 1.1 * sp) * 0.4 + Math.sin((x + y) * 0.006 + st.t * 2.7) * 0.25); }
      water.geometry.attributes.position.needsUpdate = true; water.geometry.computeVertexNormals();
      if (water.material.color) water.material.color.setHSL(0.575, 0.62, 0.53 + 0.03 * Math.sin(st.t * 0.9));
    }
    vp.request();
    raf = requestAnimationFrame(frame);
  }
  const running = () => (st.on || (st.water && water)) && g.parent && g.parent.visible !== false && root.visible !== false;
  function kick() { if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); } }
  return {
    state: st,
    set(o) {
      const rebuild = o.on !== undefined && o.on !== st.on || o.kind !== undefined && o.kind !== st.kind;
      Object.assign(st, o);
      if (rebuild) { build(); sky(); }
      // still water when moving water is off
      if (!st.water && water && water.geometry.userData.base) { water.geometry.attributes.position.array.set(water.geometry.userData.base); water.geometry.attributes.position.needsUpdate = true; water.geometry.computeVertexNormals(); }
      vp.request(); kick();
    },
    // the scene's extent, the water surface and the plants (after the landscape is redrawn)
    attach({ bounds, waterMesh, plantGroup }) {
      const changed = JSON.stringify(bounds) !== JSON.stringify(st.bounds);
      st.bounds = bounds; plants = plantGroup;
      water = waterMesh || null;
      if (water && !water.geometry.userData.base) water.geometry.userData.base = water.geometry.attributes.position.array.slice();
      if (changed && st.on) build();
      kick();
    },
    show(on) { g.visible = on; if (on) { sky(); kick(); } else if (saved) { const k = st.on; st.on = false; sky(); st.on = k; for (const p of plants ? plants.children : []) p.rotation.set(0, 0, p.rotation.z); } },
  };
}
