// Pictures → 3D models (v2.9.8.9.5). Not an AI reconstruction, but a lot closer than a puffed
// outline: the subject's cut-out from one picture gets a real thickness (each limb, leg, tail or
// stem round on its own, from the outline's medial axis), and every extra picture (side, back,
// top) carves the model to match that view too (a visual hull), then the edges are rounded.
// Also: the cut-out refinements (picked colours, keep / remove brush strokes, grow or shrink,
// holes, pieces), and the helmet radius map for the Helmet Maker's "from photos" step.
// Everything works on plain arrays and runs offline. Model space: mm, Z up, the main picture
// faces -Y (the Front view), standing on z = 0, centred on x.
import { subjectMask, largestPiece, distanceInside, maskBox } from "./puffy.js";
import { gridMesh } from "./carve.js";
import * as THREE from "three";

// ------------------------------------------------------------------ cut-out
// picture pixels -> a smaller copy (long side `max`) as ImageData-like {data, width, height}
export function shrink(src, max = 420) {
  const W0 = src.width, H0 = src.height, k = Math.min(1, max / Math.max(W0, H0));
  const W = Math.max(8, Math.round(W0 * k)), H = Math.max(8, Math.round(H0 * k));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  if (src.data) { const c0 = document.createElement("canvas"); c0.width = W0; c0.height = H0; c0.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(src.data), W0, H0), 0, 0); g.drawImage(c0, 0, 0, W, H); }
  else g.drawImage(src, 0, 0, W, H);
  return g.getImageData(0, 0, W, H);
}
// a full cut-out with every refinement. o: { mode: auto|dark|light|pick, sens, thr, fg: [[r,g,b]...]
// (subject colours, picked), bg: [[r,g,b]...] (background colours, picked), seeds: [[x,y]...],
// grow (px, + or -), smooth, keepHoles, allPieces, strokes: [{ keep, r, pts: [[x,y]...] }] }
export function cutOut(img, o = {}) {
  const W = img.width, H = img.height, n = W * H, D = img.data;
  let m;
  if (o.mode === "pick" && o.fg && o.fg.length) {
    // the picked colours, grown out from where they were picked
    const thr = 14 + (o.sens ?? 30) * 1.4, like = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (D[j + 3] < 128) continue;
      let best = 1e9;
      for (const c of o.fg) best = Math.min(best, cdist(D[j], D[j + 1], D[j + 2], c));
      let bgb = 1e9; for (const c of o.bg || []) bgb = Math.min(bgb, cdist(D[j], D[j + 1], D[j + 2], c));
      like[i] = best < thr && best <= bgb ? 1 : 0;
    }
    m = new Uint8Array(n);
    const st = [];
    for (const [x, y] of o.seeds || []) { const i = clampI(y, 0, H - 1) * W + clampI(x, 0, W - 1); if (like[i] && !m[i]) { m[i] = 1; st.push(i); } }
    if (!st.length) m = like; // no seed on a matching pixel: every matching pixel
    while (st.length) { const i = st.pop(), x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < n && like[j] && !m[j]) { m[j] = 1; st.push(j); } }
  } else {
    m = subjectMask(img, { mode: o.mode === "pick" ? "auto" : o.mode || "auto", sens: o.sens, thr: o.thr, smooth: 0, raw: true, bg: o.bg });
  }
  // smooth the edge, then grow or shrink it
  m = smoothMask(m, W, H, o.smooth ?? 2);
  if (o.grow) m = growMask(m, W, H, o.grow);
  // the brush: keep / remove
  for (const s of o.strokes || []) paintStroke(m, W, H, s);
  if (!o.allPieces) m = largestPiece(m, W, H);
  if (!o.keepHoles) m = fillHoles(m, W, H);
  // strokes that remove win again (a hole painted on purpose stays)
  for (const s of o.strokes || []) if (!s.keep) paintStroke(m, W, H, s);
  return m;
}
const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
function cdist(r, g, b, c) { const dr = r - c[0], dg = g - c[1], db = b - c[2]; return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7; }
export function paintStroke(m, W, H, s) {
  const r = Math.max(1, s.r || 6), v = s.keep ? 1 : 0, P = s.pts || [];
  const dot = (cx, cy) => { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * W + x] = v; };
  for (let i = 0; i < P.length; i++) {
    if (!i) { dot(P[0][0], P[0][1]); continue; }
    const [x0, y0] = P[i - 1], [x1, y1] = P[i], L = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(L / (r * 0.4)));
    for (let t = 1; t <= k; t++) dot(x0 + ((x1 - x0) * t) / k, y0 + ((y1 - y0) * t) / k);
  }
}
export function smoothMask(m, W, H, passes) {
  if (!passes) return m;
  let a = Float32Array.from(m);
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += a[yy * W + xx]; c++; } }
      b[y * W + x] = s / c;
    }
    a = b;
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = a[i] >= 0.5 ? 1 : 0;
  return out;
}
function growMask(m, W, H, g) {
  const inv = new Uint8Array(m.length);
  if (g > 0) { for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1; const d = distanceInside(inv, W, H); const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] || d[i] <= g ? 1 : 0; return o; }
  const d = distanceInside(m, W, H), o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] && d[i] > -g ? 1 : 0;
  return o;
}
export function fillHoles(m, W, H) {
  const out = new Uint8Array(m.length).fill(1), st = [];
  const seed = (i) => { if (!m[i] && out[i]) { out[i] = 0; st.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W); }
  return out;
}
// the colour at a picture point (averaged over a little square)
export function colorAt(img, x, y, r = 2) {
  let R = 0, G = 0, B = 0, c = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(img.height - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(img.width - 1, x + r); xx++) { const j = (yy * img.width + xx) * 4; R += img.data[j]; G += img.data[j + 1]; B += img.data[j + 2]; c++; }
  return [R / c, G / c, B / c];
}

// ------------------------------------------------------------------ distances and thickness
// signed distance to the outline in pixels (+ inside)
export function signedDist(m, W, H) {
  const din = distanceInside(m, W, H), inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const dout = distanceInside(inv, W, H), out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i] ? din[i] - 0.5 : 0.5 - dout[i];
  return out;
}
// each inside pixel's "local radius": the radius of the biggest circle inside the outline that
// covers it (from the medial axis). A leg gets the leg's radius, the body the body's.
export function localRadius(m, dist, W, H) {
  const R = new Float32Array(m.length);
  const ridge = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, d = dist[i];
    if (!m[i] || d < 1) continue;
    // a ridge point: higher than both neighbours across some direction (a crest of the distance)
    const crest = (a, b, k) => d - Math.max(a, b) > 0.2 * k;
    if (crest(dist[i - 1], dist[i + 1], 1) || crest(dist[i - W], dist[i + W], 1) || crest(dist[i - W - 1], dist[i + W + 1], 1.41) || crest(dist[i - W + 1], dist[i + W - 1], 1.41)) ridge.push(i);
  }
  ridge.sort((a, b) => dist[b] - dist[a]);
  for (const i of ridge) {
    const r = dist[i], cx = i % W, cy = (i / W) | 0, rr = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
      const dy = y - cy, row = y * W;
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        const j = row + x; if (!m[j] || R[j] >= r) continue;
        if ((x - cx) ** 2 + dy * dy <= rr) R[j] = r;
      }
    }
  }
  for (let i = 0; i < m.length; i++) if (m[i] && R[i] < dist[i]) R[i] = Math.max(dist[i], 0.5);
  return R;
}
function blur2(a, W, H, r) {
  if (r < 1) return a;
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let x = -r; x < W + r; x++) { const add = x + r, rem = x - r - 1; if (add < W && add >= 0) { s += a[y * W + add]; c++; } if (rem >= 0 && rem < W) { s -= a[y * W + rem]; c--; } if (x >= 0 && x < W) t[y * W + x] = s / Math.max(1, c); } }
  for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let y = -r; y < H + r; y++) { const add = y + r, rem = y - r - 1; if (add < H && add >= 0) { s += t[add * W + x]; c++; } if (rem >= 0 && rem < H) { s -= t[rem * W + x]; c--; } if (y >= 0 && y < H) o[y * W + x] = s / Math.max(1, c); } }
  return o;
}

// the subject presets: how a kind of thing is usually shaped
export const PRESETS = {
  animal: { label: "Animal", tip: "Legs, tail, ears and body each round on their own. A side photo works best; add a front or top photo to get the width right.", profile: "round", thick: 85, maxT: 0, relief: 15, back: 100, flatBack: false, round: 2, smooth: 2 },
  human: { label: "Person / figure", tip: "Arms, legs, body and head round. A front photo with arms a little away from the body works best; add a side photo for depth.", profile: "round", thick: 70, maxT: 0, relief: 20, back: 100, flatBack: false, round: 2, smooth: 2 },
  plant: { label: "Plant / flower", tip: "Stems round, leaves and petals kept thin.", profile: "leaf", thick: 60, maxT: 0, relief: 10, back: 100, flatBack: false, round: 1, smooth: 1 },
  object: { label: "Round object", tip: "Fruit, toys, bottles, rocks: one rounded shape.", profile: "pillow", thick: 90, maxT: 0, relief: 15, back: 100, flatBack: false, round: 2, smooth: 2 },
  relief: { label: "Flat art / relief", tip: "Logos, drawings, coins and wall art: a flat back and raised detail.", profile: "flat", thick: 100, maxT: 6, relief: 45, back: 0, flatBack: true, round: 1, smooth: 1 },
  custom: { label: "Custom", tip: "Your own settings." },
};
export const PROFILES = [["round", "Round (each part)"], ["pillow", "Pillow (whole outline)"], ["leaf", "Thin parts flat"], ["flat", "Flat with round edge"], ["sharp", "Ridged (pointed)"]];

// ------------------------------------------------------------------ the model
// views: { front: { img, mask }, side?, back?, top? } (side.faces: "left" | "right": where the
// subject's front is in the side picture; top.front: "bottom" | "top")
// o: { height (mm), profile, thick (%), maxT (mm, 0 = none), minT (mm), relief (%), back (%),
//      flatBack, round (rounding passes), res (cells along the long side) }
export function buildModel(views, o = {}) {
  const F = views.front;
  if (!F || !F.mask) throw new Error("No main picture.");
  const fb = maskBox(F.mask, F.img.width, F.img.height);
  if (!fb) throw new Error("The subject wasn't found in the main picture: adjust the cut-out.");
  const Hmm = o.height || 60, kF = Hmm / (fb.y1 - fb.y0); // mm per pixel of the main picture
  const Wmm = (fb.x1 - fb.x0) * kF, cxF = (fb.x0 + fb.x1) / 2;
  // the main view: signed distance and thickness, in mm, on its own pixels
  const FW = F.img.width, FH = F.img.height;
  const fD = signedDist(F.mask, FW, FH);
  const T = thickness(F.img, F.mask, fD, FW, FH, { ...o, maxTpx: o.maxT ? o.maxT / kF : 0 });
  for (let i = 0; i < T.front.length; i++) { T.front[i] *= kF; T.back[i] *= kF; }
  const minT = o.minT ?? 0.8;
  // the other views, scaled so the subject is as tall (side, back) or as wide (top) as in the main one
  const V = {};
  for (const k of ["side", "back", "top"]) {
    const v = views[k]; if (!v || !v.mask) continue;
    const b = maskBox(v.mask, v.img.width, v.img.height); if (!b) continue;
    const kk = k === "top" ? Wmm / (b.x1 - b.x0) : Hmm / (b.y1 - b.y0);
    V[k] = { ...v, b, k: kk, D: signedDist(v.mask, v.img.width, v.img.height) };
  }
  // how deep: from the side or top view, else from the thickness
  let ymin = 0, ymax = 0;
  for (let i = 0; i < T.front.length; i++) { if (!F.mask[i]) continue; ymin = Math.min(ymin, -T.front[i]); ymax = Math.max(ymax, T.back[i]); }
  const depthFromViews = V.side ? (V.side.b.x1 - V.side.b.x0) * V.side.k : V.top ? (V.top.b.y1 - V.top.b.y0) * V.top.k : 0;
  if (depthFromViews) { ymin = -depthFromViews / 2; ymax = depthFromViews / 2; }
  ymin = Math.min(ymin, -minT); ymax = Math.max(ymax, o.flatBack && !depthFromViews ? 0.01 : minT);
  // the grid
  const res = o.res || 96;
  const L = Math.max(Wmm, Hmm, ymax - ymin);
  const G = makeGridSized(new THREE.Vector3(-Wmm / 2, ymin, 0), new THREE.Vector3(Wmm / 2, ymax, Hmm), L / res);
  const { o: O, h, nx, ny, nz, d, B } = G;
  // sampling a view's signed distance (mm) at picture coordinates
  const at = (D, W, H, px, py) => { const x = Math.max(0, Math.min(W - 1.001, px)), y = Math.max(0, Math.min(H - 1.001, py)); const i = x | 0, j = y | 0, u = x - i, v = y - j; const q = j * W + i; return ((D[q] * (1 - u) + D[q + 1] * u) * (1 - v) + (D[q + W] * (1 - u) + D[q + W + 1] * u) * v); };
  const outside = (px, py, W, H) => px < 0 || py < 0 || px > W - 1 || py > H - 1;
  const useThick = !depthFromViews;
  // with a side or top view the depth comes from that view, but the main picture's round parts
  // still round it off: their thickness is scaled so the thickest part just fills the view's depth
  let kT = 1;
  if (depthFromViews) { let mt = 0; for (let i = 0; i < T.front.length; i++) if (F.mask[i]) mt = Math.max(mt, T.front[i], T.back[i]); kT = mt > 0 ? (depthFromViews / 2) / mt * 1.08 : 1; }
  // per (x, z) column of the main view: the outline distance and the thickness (front, back)
  const colD = new Float32Array(nx * nz), colTf = new Float32Array(nx * nz), colTb = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = O.x + i * h, z = O.z + k * h, px = cxF + x / kF, py = fb.y1 - z / kF, c = k * nx + i;
    if (outside(px, py, FW, FH)) { colD[c] = -B; continue; }
    colD[c] = at(fD, FW, FH, px, py) * kF;
    colTf[c] = at(T.front, FW, FH, px, py); colTb[c] = at(T.back, FW, FH, px, py);
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + nx * (j + ny * k);
    if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) { d[q] = B; continue; }
    const x = O.x + i * h, y = O.y + j * h, z = O.z + k * h, c = k * nx + i;
    let f = -colD[c];
    if (useThick) {
      const tf = Math.max(minT, colTf[c] * kT), tb = o.flatBack && !depthFromViews ? 0 : Math.max(minT, (depthFromViews ? colTf[c] : colTb[c]) * kT);
      f = Math.max(f, y < 0 ? -y - tf : y - tb);
    }
    if (V.side) {
      const v = V.side, W = v.img.width, H = v.img.height, cx = (v.b.x0 + v.b.x1) / 2;
      const px = cx + ((v.faces === "right" ? -y : y) / v.k), py = v.b.y1 - z / v.k;
      f = Math.max(f, outside(px, py, W, H) ? B : -at(v.D, W, H, px, py) * v.k);
    }
    if (V.back) {
      const v = V.back, W = v.img.width, H = v.img.height, cx = (v.b.x0 + v.b.x1) / 2;
      const px = cx - x / v.k, py = v.b.y1 - z / v.k;
      f = Math.max(f, outside(px, py, W, H) ? B : -at(v.D, W, H, px, py) * v.k);
    }
    if (V.top) {
      const v = V.top, W = v.img.width, H = v.img.height, cx = (v.b.x0 + v.b.x1) / 2, cy = (v.b.y0 + v.b.y1) / 2;
      // seen from above: with its front at the bottom of the picture, its left is on the right
      const px = cx + (v.front === "top" ? -x : x) / v.k, py = cy + ((v.front === "top" ? y : -y) / v.k);
      f = Math.max(f, outside(px, py, W, H) ? B : -at(v.D, W, H, px, py) * v.k);
    }
    d[q] = Math.max(-B, Math.min(B, f));
  }
  // round the edges. With more pictures the shape is where the views cross (a visual hull, flat
  // sided): an "opening" (shrink by r, then grow back by r, with exact distances) rounds its
  // corners and edges while keeping every part thicker than 2r (legs, ears). Then a light smoothing.
  if (depthFromViews && (o.round ?? 2) > 0) openGrid(G, (o.round ?? 2) * 0.9);
  for (let p = 0; p < (depthFromViews ? 1 : o.round ?? 2); p++) blur3(G);
  let mesh = gridMesh(G);
  if (!mesh.I.length) throw new Error("Nothing was left after matching the pictures: check that each one shows the whole subject.");
  // stand on the floor, centred
  let zMin = Infinity; for (let i = 2; i < mesh.V.length; i += 3) zMin = Math.min(zMin, mesh.V[i]);
  for (let i = 2; i < mesh.V.length; i += 3) mesh.V[i] -= zMin;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < mesh.V.length; i += 3) { x0 = Math.min(x0, mesh.V[i]); x1 = Math.max(x1, mesh.V[i]); y0 = Math.min(y0, mesh.V[i + 1]); y1 = Math.max(y1, mesh.V[i + 1]); z1 = Math.max(z1, mesh.V[i + 2]); }
  // the subject's colour
  let r = 0, g = 0, b = 0, m = 0;
  for (let i = 0, j = 0; i < F.mask.length; i++, j += 4) if (F.mask[i]) { r += F.img.data[j]; g += F.img.data[j + 1]; b += F.img.data[j + 2]; m++; }
  const hex = (v) => Math.round(v / Math.max(1, m)).toString(16).padStart(2, "0");
  return { V: mesh.V, I: mesh.I, crop: [fb.x0 / FW, fb.y0 / FH, fb.x1 / FW, fb.y1 / FH], color: "#" + hex(r) + hex(g) + hex(b), size: [x1 - x0, y1 - y0, z1], views: Object.keys(V) };
}
function makeGridSized(min, max, h) {
  const pad = 3;
  const o = new THREE.Vector3(min.x - pad * h, min.y - pad * h, min.z - pad * h);
  const nx = Math.ceil((max.x - min.x) / h) + 2 * pad + 1, ny = Math.ceil((max.y - min.y) / h) + 2 * pad + 1, nz = Math.ceil((max.z - min.z) / h) + 2 * pad + 1;
  return { o, h, nx, ny, nz, B: 3 * h, d: new Float32Array(nx * ny * nz), min, max };
}
// exact distances on the grid (in cells) from the solid's surface: Felzenszwalb's squared
// distance transform along x, y and z
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[0] = q; z[0] = -1e20; z[1] = 1e20; k = 0; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function edt3(occ, nx, ny, nz) {
  // squared distance to the nearest cell where occ is 1
  const INF = 1e12, D = new Float64Array(nx * ny * nz), m = Math.max(nx, ny, nz);
  for (let i = 0; i < D.length; i++) D[i] = occ[i] ? 0 : INF;
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (n, idx) => { for (let t = 0; t < n; t++) f[t] = D[idx(t)]; edt1(f, n, d, v, z); for (let t = 0; t < n; t++) D[idx(t)] = d[t]; };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) pass(nx, (t) => t + nx * (j + ny * k));
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(ny, (t) => i + nx * (t + ny * k));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(nz, (t) => i + nx * (j + ny * t));
  return D;
}
function openGrid(G, r) {
  const { nx, ny, nz, d, h, B } = G, n = d.length;
  const inside = new Uint8Array(n), outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) { inside[i] = d[i] < 0 ? 1 : 0; outside[i] = 1 - inside[i]; }
  // shrink: keep cells further than r from the outside
  const dOut = edt3(outside, nx, ny, nz), core = new Uint8Array(n);
  for (let i = 0; i < n; i++) core[i] = inside[i] && dOut[i] > r * r ? 1 : 0;
  // grow back: everything within r of the core, as a smooth distance field
  const dCore = edt3(core, nx, ny, nz);
  let any = false; for (let i = 0; i < n; i++) if (core[i]) { any = true; break; }
  if (!any) return; // everything thinner than the rounding: leave it as it was
  for (let i = 0; i < n; i++) d[i] = Math.max(-B, Math.min(B, (Math.sqrt(dCore[i]) - r) * h));
  // the grid's edge stays outside
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) d[i + nx * (j + ny * k)] = B;
}
// one smoothing pass of a grid's values (3 × 3 × 3 average, edges stay outside)
function blur3(G) {
  const { nx, ny, nz, B } = G, sy = nx, sz = nx * ny;
  let a = G.d;
  for (const [st, lim] of [[1, nx], [sy, ny], [sz, nz]]) {
    const b = new Float32Array(a.length);
    for (let q = 0; q < a.length; q++) {
      const c = st === 1 ? q % nx : st === sy ? ((q / nx) | 0) % ny : (q / sz) | 0;
      b[q] = c === 0 || c === lim - 1 ? a[q] : (a[q - st] + 2 * a[q] + a[q + st]) / 4;
    }
    a = b;
  }
  const d = G.d;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + sy * j + sz * k;
    d[q] = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1 ? B : a[q];
  }
}
// thickness of the main view in pixels: front and back half-thickness for each pixel
function thickness(img, mask, sd, W, H, o) {
  const n = W * H, din = new Float32Array(n);
  for (let i = 0; i < n; i++) din[i] = mask[i] ? Math.max(0, sd[i] + 0.5) : 0;
  let Rg = 1; for (let i = 0; i < n; i++) if (din[i] > Rg) Rg = din[i];
  const prof = o.profile || "round";
  const Rl = prof === "round" || prof === "leaf" ? localRadius(mask, din, W, H) : null;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const D = din[i];
    let v;
    if (prof === "round") { const r = Rl[i], dd = Math.min(D, r); v = Math.sqrt(Math.max(0, r * r - (r - dd) * (r - dd))); }
    else if (prof === "leaf") { const r = Rl[i], dd = Math.min(D, r); const round = Math.sqrt(Math.max(0, r * r - (r - dd) * (r - dd))); const k = Math.min(1, r / (Rg * 0.18)); v = round * (0.25 + 0.75 * (1 - k) * (1 - k)); }
    else if (prof === "pillow") { const tt = Math.min(1, D / Rg); v = Rg * Math.sqrt(Math.max(0, tt * (2 - tt))); }
    else if (prof === "flat") { const rr = Rg * 0.12, dd = Math.min(D, rr); v = Math.sqrt(Math.max(0, rr * rr - (rr - dd) * (rr - dd))) / rr; v *= Rg * 0.12; }
    else v = D; // sharp
    t[i] = v;
  }
  const k = (o.thick ?? 85) / 100;
  for (let i = 0; i < n; i++) t[i] *= k;
  // smooth it a little
  const ts = blur2(t, W, H, Math.max(0, Math.round(o.smooth ?? 2)));
  for (let i = 0; i < n; i++) if (mask[i]) t[i] = ts[i] * 0.5 + t[i] * 0.5;
  // relief from the picture's shading: darker than around it sinks a little (eyes, lines, fur)
  const rel = (o.relief ?? 15) / 100, front = new Float32Array(n), back = new Float32Array(n);
  let lum = null, bl = null;
  if (rel > 0) {
    lum = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) lum[i] = (0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]) / 255;
    bl = blur2(lum, W, H, Math.max(2, Math.round(Math.max(W, H) / 60)));
  }
  const bk = (o.back ?? 100) / 100;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    let tf = t[i];
    if (rel > 0) tf += rel * (lum[i] - bl[i]) * Rg * 0.35 * Math.min(1, din[i] / 3);
    front[i] = Math.max(0, tf);
    back[i] = t[i] * bk;
  }
  // a cap on the thickness (in mm: converted by the caller's scale, so given here in pixels)
  if (o.maxTpx > 0) for (let i = 0; i < n; i++) { front[i] = softMin(front[i], o.maxTpx); back[i] = softMin(back[i], o.maxTpx); }
  return { front, back };
}
const softMin = (a, b) => { const k = b * 0.25; const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };

// ------------------------------------------------------------------ helmets from photos
// The helmet's outside from up to 4 photos (front, side, back, top), as a radius for every
// direction from the head's centre. Units: the helmet is 1 tall (z 0..1), x across (the wearer's
// left), y towards the back. head: { z (0..1, the head's centre height), y (front / back shift) }.
// Returns { w, h, r: Float32Array(w*h) } with azimuth a = 2π (i / w) - π (0 = the face, +π/2 the
// wearer's left) and polar t = π (j / (h - 1)) from straight up.
export function helmetRadii(views, o = {}) {
  const box = (v) => (v && v.mask ? maskBox(v.mask, v.img.width, v.img.height) : null);
  const bF = box(views.front), bS = box(views.side), bB = box(views.back), bT = box(views.top);
  if (!bF && !bS && !bB) throw new Error("Add at least a front, side or back photo of the helmet.");
  const asp = (b) => (b.x1 - b.x0) / (b.y1 - b.y0);
  // widths (x) and depths (y) for a helmet 1 tall
  let wx = bF ? asp(bF) : bB ? asp(bB) : null, wy = bS ? asp(bS) : null;
  if (bT) { const r = (bT.y1 - bT.y0) / (bT.x1 - bT.x0); if (wx && !wy) wy = wx * r; else if (wy && !wx) wx = wy / r; }
  if (!wx) wx = wy / 1.15; if (!wy) wy = wx * 1.15;
  // each view's mask as a lookup in normalised coordinates
  const look = (v, b) => { if (!v) return null; const W = v.img.width, H = v.img.height, m = v.mask; return (u, w) => { const px = Math.round(b.x0 + u * (b.x1 - b.x0)), py = Math.round(b.y0 + w * (b.y1 - b.y0)); return px >= 0 && py >= 0 && px < W && py < H ? m[py * W + px] : 0; }; };
  const LF = look(views.front, bF), LS = look(views.side, bS), LB = look(views.back, bB), LT = look(views.top, bT);
  // the extents of each row (for rounding between the views): front half width and side half depth
  const N = 128, rowX = [], rowY = [];
  const span = (L, z) => { let a = 1, b = 0; for (let i = 0; i <= 64; i++) if (L(i / 64, 1 - z)) { a = Math.min(a, i / 64); b = Math.max(b, i / 64); } return a > b ? null : [a - 0.5, b - 0.5]; };
  for (let r = 0; r <= N; r++) { const z = r / N; rowX.push(LF ? span(LF, z) : LB ? span(LB, z) : null); rowY.push(LS ? span(LS, z) : null); }
  const pw = o.boxy ?? 2.4; // 2 = round, higher = boxier
  const inside = (x, y, z) => {
    if (z < 0 || z > 1) return 0;
    const u = x / wx + 0.5, s = y / wy + 0.5;
    if (u < 0 || u > 1 || s < 0 || s > 1) return 0;
    if (LF && !LF(u, 1 - z)) return 0;
    if (LB && !LB(1 - u, 1 - z)) return 0;
    if (LS && !LS(views.side.faces === "right" ? 1 - s : s, 1 - z)) return 0;
    if (LT && !(views.top.front === "top" ? LT(1 - u, s) : LT(u, 1 - s))) return 0;
    // round between the views: inside the row's superellipse
    const r = Math.round(z * N);
    let ax = rowX[r], ay = rowY[r];
    if (!ax && ay) ax = [ay[0] * (wx / wy), ay[1] * (wx / wy)];
    if (!ay && ax) ay = [ax[0] * (wy / wx) * 1, ax[1] * (wy / wx)];
    if (!ax || !ay) return 0;
    const hx = (ax[1] - ax[0]) / 2, cx = (ax[1] + ax[0]) / 2, hy = (ay[1] - ay[0]) / 2, cy = (ay[1] + ay[0]) / 2;
    const ex = Math.abs(u - 0.5 - cx) / Math.max(1e-3, hx), ey = Math.abs(s - 0.5 - cy) / Math.max(1e-3, hy);
    return ex ** pw + ey ** pw <= 1 ? 1 : 0;
  };
  // rays from the head's centre
  const w = 72, h = 37, R = new Float32Array(w * h);
  const C = [0, (o.headY ?? 0) * wy, o.headZ ?? 0.55];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = (2 * Math.PI * i) / w - Math.PI, t = (Math.PI * j) / (h - 1);
    const dx = Math.sin(t) * Math.sin(a), dy = -Math.sin(t) * Math.cos(a), dz = Math.cos(t);
    let last = 0;
    for (let s = 0.004; s < 1.6; s += 0.004) { if (inside(C[0] + dx * s, C[1] + dy * s, C[2] + dz * s)) last = s; else if (last && s - last > 0.03) break; }
    R[j * w + i] = last;
  }
  // fill rays that missed (the centre outside a thin part), then smooth
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!R[j * w + i]) { let s = 0, c = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const jj = Math.max(0, Math.min(h - 1, j + dj)), ii = (i + di + w) % w, v = R[jj * w + ii]; if (v) { s += v; c++; } } R[j * w + i] = c ? s / c : 0; }
  const sm = R.slice();
  for (let p = 0; p < (o.smooth ?? 2); p++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let s = R[j * w + i] * 2, c = 2; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const jj = j + dj; if (jj < 0 || jj >= h) continue; s += R[jj * w + ((i + di + w) % w)]; c++; } sm[j * w + i] = s / c; }
  return { w, h, r: Array.from(sm, (v) => +v.toFixed(4)), wx: +wx.toFixed(4), wy: +wy.toFixed(4), headZ: C[2] };
}
// radius map lookup for a unit direction (body frame: x left, y back, z up)
export function radiusAt(map, dx, dy, dz) {
  const t = Math.acos(Math.max(-1, Math.min(1, dz))), a = Math.atan2(dx, -dy);
  const fi = ((a + Math.PI) / (2 * Math.PI)) * map.w, fj = (t / Math.PI) * (map.h - 1);
  const i0 = Math.floor(fi), j0 = Math.max(0, Math.min(map.h - 2, Math.floor(fj))), u = fi - i0, v = Math.max(0, Math.min(1, fj - j0));
  const g = (i, j) => map.r[j * map.w + (((i % map.w) + map.w) % map.w)];
  return (g(i0, j0) * (1 - u) + g(i0 + 1, j0) * u) * (1 - v) + (g(i0, j0 + 1) * (1 - u) + g(i0 + 1, j0 + 1) * u) * v;
}
// the darkest big area inside the front photo's helmet: probably the visor. Returns its outline
// (0..1 across and down its box) and its box (0..1 of the helmet's front picture box), or null.
export function findVisor(front) {
  if (!front || !front.mask) return null;
  const { img, mask } = front, W = img.width, H = img.height, b = maskBox(mask, W, H);
  if (!b) return null;
  const lum = new Float32Array(W * H), vals = [];
  for (let i = 0, j = 0; i < W * H; i++, j += 4) { lum[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]; if (mask[i]) vals.push(lum[i]); }
  vals.sort((p, q) => p - q);
  const thr = vals[Math.floor(vals.length * 0.22)] + 6;
  const dk = new Uint8Array(W * H);
  // only the helmet's middle band, away from the outline
  const din = distanceInside(mask, W, H), edge = Math.max(2, (b.x1 - b.x0) * 0.03);
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = y * W + x; const yy = (y - b.y0) / (b.y1 - b.y0); dk[i] = mask[i] && din[i] > edge && lum[i] <= thr && yy > 0.15 && yy < 0.85 ? 1 : 0; }
  const dm = fillHoles(smoothMask(largestPiece(smoothMask(dk, W, H, 2), W, H), W, H, 1), W, H);
  const vb = maskBox(dm, W, H);
  if (!vb) return null;
  let area = 0; for (let i = 0; i < dm.length; i++) area += dm[i];
  if (area < (b.x1 - b.x0) * (b.y1 - b.y0) * 0.03) return null;
  // its outline: walk the boundary in angle order from the centre (good enough for a visor)
  const cx = (vb.x0 + vb.x1) / 2, cy = (vb.y0 + vb.y1) / 2, pts = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let last = null;
    for (let s = 0; s < Math.max(W, H); s += 0.5) { const x = Math.round(cx + dx * s), y = Math.round(cy + dy * s); if (x < 0 || y < 0 || x >= W || y >= H) break; if (dm[y * W + x]) last = [x, y]; }
    if (last) pts.push([+((last[0] - vb.x0) / (vb.x1 - vb.x0)).toFixed(4), +((last[1] - vb.y0) / (vb.y1 - vb.y0)).toFixed(4)]);
  }
  if (pts.length < 8) return null;
  return { poly: pts, box: [(vb.x0 - b.x0) / (b.x1 - b.x0), (vb.y0 - b.y0) / (b.y1 - b.y0), (vb.x1 - b.x0) / (b.x1 - b.x0), (vb.y1 - b.y0) / (b.y1 - b.y0)] };
}
