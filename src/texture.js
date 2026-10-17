// Surface textures, ported from the Tactile Texturizer: a library of tiling
// height maps, and a mesh post-process that subdivides the chosen faces and
// moves their vertices along the surface normal. Textures change the mesh used
// for display and STL export; the exact (STEP) solid is not changed.
const TAU = Math.PI * 2;
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
function hash2(i, j){ let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
function periodicNoise(P, seed, linear, Py){
  const Px = P, PY = Py || P, r = mulberry32(seed), g = new Float32Array(Px * PY);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const X = x * Px, Y = y * PY, xi = Math.floor(X), yi = Math.floor(Y);
    const fx = X - xi, fy = Y - yi, sx = linear ? fx : fx * fx * (3 - 2 * fx), sy = linear ? fy : fy * fy * (3 - 2 * fy);
    const x0 = ((xi % Px) + Px) % Px, y0 = ((yi % PY) + PY) % PY, x1 = (x0 + 1) % Px, y1 = (y0 + 1) % PY;
    const a = g[y0 * Px + x0], b = g[y0 * Px + x1], c = g[y1 * Px + x0], d = g[y1 * Px + x1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}
/* Draw rounded strands (grass, fur, hair) into a tiling buffer, keeping the highest value. */
function strandBuffer(w, h){
  const d = new Float32Array(w * h);
  return { d, splat(x, y, r, v){
    const cx = x * w, cy = y * h, R = Math.max(.6, r * w);
    for (let py = Math.floor(cy - R); py <= Math.ceil(cy + R); py++) for (let px = Math.floor(cx - R); px <= Math.ceil(cx + R); px++){
      const dd = Math.hypot(px + .5 - cx, py + .5 - cy); if (dd > R) continue;
      const val = v * (.55 + .45 * Math.sqrt(1 - (dd / R) ** 2)), i = (((py % h) + h) % h) * w + (((px % w) + w) % w);
      if (val > d[i]) d[i] = val;
    }
  } };
}
function voronoi(pts, W, H, X, Y){
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let i = 0; i < pts.length; i++){
    const px = pts[i][0], py = pts[i][1];
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++){
      const dx = X - (px + ox * W), dy = Y - (py + oy * H), d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1){ f2 = f1; f1 = d; id = i; } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}
function makeHM(w, h, fn){
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = fn((x + .5) / w, (y + .5) / h);
  return normalizeHM({ w, h, data: d });
}
function normalizeHM(hm){
  let mn = Infinity, mx = -Infinity; const d = hm.data;
  for (let i = 0; i < d.length; i++){ if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const s = mx - mn > 1e-9 ? 1 / (mx - mn) : 0;
  for (let i = 0; i < d.length; i++) d[i] = s ? (d[i] - mn) * s : .5;
  return hm;
}
const tri = t => 1 - 2 * Math.abs(fract(t) - .5);
const SQ3 = Math.sqrt(3);

export const TEX_CATS = [['all', 'All'], ['geo', 'Geometric'], ['nature', 'Nature'], ['skin', 'Skin & fur'], ['mat', 'Materials'], ['mine', 'My images']];
function buildLibrary(){
  const n4 = periodicNoise(4, 7), n8 = periodicNoise(8, 11), n16 = periodicNoise(16, 3), n32 = periodicNoise(32, 5), n64 = periodicNoise(64, 9);
  const hexPts = [[0, 0], [.5, SQ3 / 2]];
  const rs = mulberry32(42), stonePts = Array.from({ length: 16 }, () => [rs(), rs()]), stoneH = Array.from({ length: 16 }, () => rs());
  const rl = mulberry32(99), leatherPts = Array.from({ length: 70 }, () => [rl(), rl()]);
  const pts = (n, seed, jitterGrid) => { const r = mulberry32(seed); if (!jitterGrid) return Array.from({ length: n }, () => [r(), r()]);
    const out = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([(i + .5 + (j & 1) * .5 + (r() - .5) * jitterGrid) / n % 1, (j + .5 + (r() - .5) * jitterGrid) / n]); return out; };
  const rnd = n => { const r = mulberry32(n); return Array.from({ length: 200 }, () => r()); };
  const ridged = n => 1 - Math.abs(2 * n - 1);
  // extra noise sources
  const L6 = periodicNoise(6, 21, true), L12 = periodicNoise(12, 22, true), L24 = periodicNoise(24, 23, true), L48 = periodicNoise(48, 24, true);
  const bark1 = periodicNoise(14, 31, false, 3), bark2 = periodicNoise(40, 32, false, 8), brush1 = periodicNoise(3, 41, false, 160), brush2 = periodicNoise(6, 42, false, 256);
  const woodFine = periodicNoise(64, 9, false, 16), w3 = periodicNoise(3, 51), w6 = periodicNoise(6, 52), n12 = periodicNoise(12, 53), n24 = periodicNoise(24, 54);
  const mudPts = pts(26, 61), mudR = rnd(62), cobPts = pts(5, 63, .7), cobR = rnd(64), hamPts = pts(60, 65), snakePts = pts(7, 66, .35);

  const defs = [
    // Geometric
    { key: 'knurl', name: 'Diamond knurl', cat: 'geo', fn: (x, y) => Math.min(tri(x + y), tri(x - y)) },
    { key: 'hex', name: 'Hex cells', cat: 'geo', h: 443, fn: (x, y) => { const v = voronoi(hexPts, 1, SQ3, x, y * SQ3); return smooth(.015, .09, (v[1] - v[0]) / 2); } },
    { key: 'pyramids', name: 'Pyramids', cat: 'geo', fn: (x, y) => Math.min(1, 1.15 * (1 - 2 * Math.max(Math.abs(fract(2 * x) - .5), Math.abs(fract(2 * y) - .5)))) },
    { key: 'ribs', name: 'Ribs', cat: 'geo', fn: (x) => smooth(.15, .45, tri(x)) },
    { key: 'waves', name: 'Sine waves', cat: 'geo', fn: (x, y) => .5 + .5 * Math.sin(TAU * (2 * y + .28 * Math.sin(TAU * x))) },
    { key: 'dots', name: 'Dots', cat: 'geo', h: 443, fn: (x, y) => { const f = voronoi(hexPts, 1, SQ3, x, y * SQ3)[0], r = .34; return f < r ? Math.sqrt(1 - (f / r) ** 2) : 0; } },
    { key: 'crosshatch', name: 'Crosshatch', cat: 'geo', fn: (x, y) => { const l = t => 1 - smooth(.06, .16, Math.abs(fract(3 * t) - .5)); return Math.max(l(x + y), l(x - y)); } },
    { key: 'chevron', name: 'Chevron tread', cat: 'geo', fn: (x, y) => smooth(.25, .45, tri(2 * y + 1.4 * Math.abs(x - .5))) },
    { key: 'waffle', name: 'Waffle', cat: 'geo', fn: (x, y) => { const g = t => 1 - smooth(.07, .13, Math.abs(fract(4 * t) - .5)); return Math.max(g(x), g(y)); } },
    // Nature
    { key: 'grass', name: 'Grass', cat: 'nature', gen: (w, h) => {
      const B = strandBuffer(w, h), r = mulberry32(71);
      for (let i = 0; i < w * h; i++) B.d[i] = .12 * n32(fract(i % w / w), Math.floor(i / w) / h);
      for (let k = 0; k < 340; k++){
        const bx = r(), by = r(), ang = -Math.PI / 2 + (r() - .5) * .7, len = .12 + r() * .2, bend = (r() - .5) * .18, wd = .006 + r() * .007, tall = .7 + .3 * r();
        for (let s = 0; s <= 40; s++){ const t = s / 40; B.splat(bx + Math.cos(ang) * len * t + bend * t * t, by + Math.sin(ang) * len * t, wd * (1 - t * .85), (.3 + .7 * t) * tall); }
      }
      return B.d; } },
    { key: 'moon', name: 'Moon craters', cat: 'nature', gen: (w, h) => {
      const d = new Float32Array(w * h), r = mulberry32(81);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = .12 * (n8(x / w, y / h) * .6 + n32(x / w, y / h) * .4);
      for (let k = 0; k < 75; k++){
        const cx = r(), cy = r(), rad = .015 + .17 * Math.pow(r(), 3), depth = rad * 1.6;
        const R = rad * 1.6, x0 = Math.floor((cx - R) * w), x1 = Math.ceil((cx + R) * w), y0 = Math.floor((cy - R) * h), y1 = Math.ceil((cy + R) * h);
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++){
          const q = Math.hypot((px + .5) / w - cx, (py + .5) / h - cy) / rad; if (q > 1.6) continue;
          const bowl = q < 1 ? (q * q - 1) * depth : 0, rim = depth * .45 * Math.exp(-(((q - 1) / .18) ** 2));
          d[(((py % h) + h) % h) * w + (((px % w) + w) % w)] += bowl + rim;
        }
      }
      return d; } },
    { key: 'ocean', name: 'Ocean waves', cat: 'nature', fn: (x, y) => {
      const wv = [[0, 2, 1, 0], [1, 2, .55, 1.3], [-1, 3, .35, 2.1], [2, 5, .2, .7]], warp = .9 * (w3(x, y) - .5);
      let h = 0; for (const [kx, ky, a, ph] of wv) h += a * Math.pow(.5 + .5 * Math.cos(TAU * (kx * x + ky * y) + ph + warp * 3), 2.5);
      return h + .08 * n24(x, y); } },
    { key: 'ripples', name: 'Water ripples', cat: 'nature', fn: (x, y) => {
      let h = 0; for (const [cx, cy, f] of [[.3, .35, 16], [.75, .7, 12], [.8, .15, 20]]){
        let dx = x - cx, dy = y - cy; dx -= Math.round(dx); dy -= Math.round(dy); const d = Math.hypot(dx, dy);
        h += Math.cos(TAU * d * f) * Math.exp(-d * 4) * (1 - smooth(.32, .5, d));
      } return h; } },
    { key: 'bark', name: 'Tree bark', cat: 'nature', fn: (x, y) => .75 * Math.pow(ridged(bark1(x, y)), 1.6) + .25 * bark2(x, y) },
    { key: 'mud', name: 'Cracked earth', cat: 'nature', fn: (x, y) => { const v = voronoi(mudPts, 1, 1, x, y); return smooth(.003, .018, v[1] - v[0] + .025 * (n16(x, y) - .5)) * (.8 + .2 * mudR[v[2]]) + .06 * n32(x, y); } },
    { key: 'stone', name: 'Stone', cat: 'nature', fn: (x, y) => { const v = voronoi(stonePts, 1, 1, x, y); return smooth(0, .03, v[1] - v[0]) * (.7 + .3 * stoneH[v[2]]) + .08 * n32(x, y); } },
    { key: 'terraces', name: 'Terraces', cat: 'nature', fn: (x, y) => { const t = (.6 * n4(x, y) + .4 * n8(x, y)) * 8; return Math.floor(t) + smooth(.8, 1, fract(t)); } },
    { key: 'coral', name: 'Coral maze', cat: 'nature', fn: (x, y) => 1 - Math.abs(Math.sin(Math.PI * 7 * (.6 * w6(x, y) + .4 * n12(x, y)))) },
    { key: 'wood', name: 'Wood grain', cat: 'nature', fn: (x, y) => { const t = 6 * y + 1.3 * (n4(x, y) * .7 + n8(x, y) * .3); return .8 * Math.pow(.5 + .5 * Math.cos(TAU * t), 2.2) + .2 * woodFine(x, y); } },
    { key: 'sand', name: 'Sand', cat: 'nature', fn: (x, y) => .5 * n16(x, y) + .3 * n32(x, y) + .2 * n64(x, y) },
    // Skin & fur
    { key: 'fur', name: 'Fur', cat: 'skin', gen: (w, h) => {
      const B = strandBuffer(w, h), r = mulberry32(91);
      for (let i = 0; i < w * h; i++) B.d[i] = .25 * n16((i % w) / w, Math.floor(i / w) / h);
      for (let k = 0; k < 2600; k++){
        const bx = r(), by = r(), ang = Math.PI / 2 + 2.2 * (w3(bx, by) - .5), len = .035 + r() * .045, v0 = .6 + .4 * r();
        for (let s = 0; s <= 14; s++){ const t = s / 14; B.splat(bx + Math.cos(ang) * len * t, by + Math.sin(ang) * len * t, .0045 * (1 - t * .6), v0 * (.45 + .55 * t)); }
      }
      return B.d; } },
    { key: 'hair', name: 'Hair', cat: 'skin', gen: (w, h) => {
      const B = strandBuffer(w, h), r = mulberry32(95);
      for (let k = 0; k < 420; k++){
        let x = r(), y = r(); const v0 = .55 + .45 * r(), wd = .0025 + r() * .0025, ph = r() * TAU;
        for (let s = 0; s < 260; s++){
          const ang = .35 * Math.sin(TAU * x + ph * .2) + 1.2 * (w3(fract(x), fract(y)) - .5);
          x += Math.cos(ang) * .004; y += Math.sin(ang) * .004; B.splat(x, y, wd, v0);
        }
      }
      return B.d; } },
    { key: 'scales', name: 'Scales', cat: 'skin', fn: (x, y) => {
      let h = 0;
      for (let j = -1; j <= 3; j++) for (let i = -1; i <= 2; i++){
        const cx = i + (j & 1) * .5, cy = j * .5, d = Math.hypot(x - cx, y - cy), r = .58;
        if (d < r) h = .25 + .75 * Math.pow(1 - (d / r) ** 2, .5) * (y > cy ? 1 : .85);
      }
      return h; } },
    { key: 'snake', name: 'Snakeskin', cat: 'skin', fn: (x, y) => { const v = voronoi(snakePts, 1, 1, x, y); return smooth(0, .05, v[1] - v[0]) * (1 - .45 * Math.min(1, (v[0] / .12) ** 2)); } },
    { key: 'leather', name: 'Pebble leather', cat: 'skin', fn: (x, y) => { const v = voronoi(leatherPts, 1, 1, x, y); return Math.pow(smooth(0, .03, v[1] - v[0]), .7) * (.85 + .15 * n16(x, y)); } },
    // Materials
    { key: 'paper', name: 'Crinkled paper', cat: 'mat', fn: (x, y) => .45 * ridged(L6(x, y)) + .3 * ridged(L12(x, y)) + .17 * ridged(L24(x, y)) + .08 * L48(x, y) },
    { key: 'hammered', name: 'Hammered metal', cat: 'mat', fn: (x, y) => { const f = voronoi(hamPts, 1, 1, x, y)[0]; return 1 - Math.pow(1 - Math.min(1, f / .085), 2) + .04 * n32(x, y); } },
    { key: 'brushed', name: 'Brushed metal', cat: 'mat', fn: (x, y) => .6 * brush1(x, y) + .4 * brush2(x, y) },
    { key: 'carbon', name: 'Carbon fiber', cat: 'mat', fn: (x, y) => {
      const N = 8, i = Math.floor(N * x), j = Math.floor(N * y), a = fract(N * x), b = fract(N * y);
      const over = (((i - j) % 4) + 4) % 4 < 2, across = over ? b : a, along = over ? a : b;
      return Math.pow(Math.sin(Math.PI * across), .5) * (.8 + .2 * Math.sin(Math.PI * along)) * (.93 + .07 * Math.sin(TAU * 5 * across)); } },
    { key: 'weave', name: 'Basket weave', cat: 'mat', fn: (x, y) => {
      const i = Math.floor(2 * x), j = Math.floor(2 * y), a = fract(2 * x), b = fract(2 * y);
      const horiz = ((i + j) & 1) === 0, across = horiz ? b : a, along = horiz ? a : b;
      return Math.pow(Math.sin(Math.PI * across), .6) * (.7 + .3 * Math.sin(Math.PI * along)); } },
    { key: 'knit', name: 'Knit', cat: 'mat', fn: (x, y) => {
      const u = fract(4 * x), v = fract(4 * y);
      const lobe = (cx, rot) => { let dx = u - cx, dy = v - .5; for (const o of [-1, 0, 1]){ const ddy = dy + o; const c = Math.cos(rot), s = Math.sin(rot); const X = (dx * c + ddy * s) / .2, Y = (-dx * s + ddy * c) / .42, q = X * X + Y * Y; if (q < 1) return Math.sqrt(1 - q); } return 0; };
      return Math.max(lobe(.28, .55), lobe(.72, -.55)); } },
    { key: 'bricks', name: 'Bricks', cat: 'mat', h: 128, fn: (x, y) => {
      const X = x, Y = y * .5, row = Math.floor(Y / .25), off = row % 2 ? .25 : 0;
      const bx = fract((X + off) / .5) * .5, by = Y - row * .25;
      return smooth(.008, .03, Math.min(bx, .5 - bx, by, .25 - by)) * (.9 + .1 * n8(x, y)); } },
    { key: 'cobble', name: 'Cobblestone', cat: 'mat', fn: (x, y) => { const v = voronoi(cobPts, 1, 1, x, y); return Math.sqrt(smooth(0, .07, v[1] - v[0])) * (.85 + .15 * cobR[v[2]]) + .04 * n32(x, y); } },
    { key: 'stucco', name: 'Stucco', cat: 'mat', fn: (x, y) => .8 * smooth(.42, .72, .6 * n16(x, y) + .4 * n32(x, y)) + .2 * n64(x, y) },
  ];
  // Height maps are generated the first time they are needed.
  return defs.map(d => {
    const w = d.w || 256, h = d.h || 256; let src = null;
    return { key: d.key, name: d.name, cat: d.cat, get src(){
      if (!src) src = d.gen ? normalizeHM({ w, h, data: d.gen(w, h) }) : makeHM(w, h, d.fn);
      return src; } };
  });
}

/* ------------------------------------------------------------------ *
 *  Height map processing (per region adjustments) and sampling
 * ------------------------------------------------------------------ */
function boxBlur(d, w, h, r){
  const tmp = new Float32Array(d.length), out = new Float32Array(d.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++){
    let s = 0; for (let k = -r; k <= r; k++) s += d[y * w + ((k % w) + w) % w];
    for (let x = 0; x < w; x++){ tmp[y * w + x] = s / n; s += d[y * w + (x + r + 1) % w] - d[y * w + ((x - r) % w + w) % w]; }
  }
  for (let x = 0; x < w; x++){
    let s = 0; for (let k = -r; k <= r; k++) s += tmp[(((k % h) + h) % h) * w + x];
    for (let y = 0; y < h; y++){ out[y * w + x] = s / n; s += tmp[((y + r + 1) % h) * w + x] - tmp[(((y - r) % h + h) % h) * w + x]; }
  }
  return out;
}
function hmSample(hm, u, v){
  const w = hm.w, h = hm.h, d = hm.data;
  const x = u * w - .5, y = (1 - v) * h - .5;
  let x0 = Math.floor(x), y0 = Math.floor(y); const fx = x - x0, fy = y - y0;
  x0 = ((x0 % w) + w) % w; y0 = ((y0 % h) + h) % h;
  const x1 = x0 + 1 === w ? 0 : x0 + 1, y1 = y0 + 1 === h ? 0 : y0 + 1;
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
}
function drawHM(cv, hm, reps = 2){
  const S = cv.width, ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), asp = hm.h / hm.w, e = 1 / S;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++){
    const u = px / S * reps, v = 1 - py / S * reps / asp;
    const h = hmSample(hm, u, v);
    const dx = hmSample(hm, u + e * reps, v) - hmSample(hm, u - e * reps, v);
    const dy = hmSample(hm, u, v + e * reps) - hmSample(hm, u, v - e * reps);
    const s = clamp01(.34 + .5 * h + (-dx + dy) * 2.2);
    const i = (py * S + px) * 4;
    img.data[i] = 38 + s * 196; img.data[i + 1] = 44 + s * 194; img.data[i + 2] = 51 + s * 192; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ *
 *  Mesh import: STL (binary + ASCII) and 3MF
/* Weld duplicate vertices (tolerance 0.1 µm-ish) and drop degenerate triangles. */
function weld(P, I){
  const n = P.length / 3;
  if (!I){ I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; }
  let mx = 1; for (let i = 0; i < P.length; i++){ const a = Math.abs(P[i]); if (a > mx) mx = a; }
  const q = Math.min(1e4, 1e9 / mx);
  let size = 1; while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), mask = size - 1;
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  const out = new Float32Array(n * 3), remap = new Int32Array(n);
  let nv = 0;
  for (let i = 0; i < n; i++){
    const x = Math.round(P[i * 3] * q), y = Math.round(P[i * 3 + 1] * q), z = Math.round(P[i * 3 + 2] * q);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;){
      const e = table[h];
      if (e < 0){ table[h] = nv; qx[nv] = x; qy[nv] = y; qz[nv] = z; out[nv * 3] = P[i * 3]; out[nv * 3 + 1] = P[i * 3 + 1]; out[nv * 3 + 2] = P[i * 3 + 2]; remap[i] = nv++; break; }
      if (qx[e] === x && qy[e] === y && qz[e] === z){ remap[i] = e; break; }
      h = (h + 1) & mask;
    }
  }
  const idx = new Uint32Array(I.length); let m = 0;
  for (let t = 0; t < I.length; t += 3){
    const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
    if (a === b || b === c || a === c) continue;
    idx[m++] = a; idx[m++] = b; idx[m++] = c;
  }
  return { pos: out.slice(0, nv * 3), idx: idx.slice(0, m) };
}
function eigSym3(m){ // m = [xx, xy, xz, yy, yz, zz]
  const A = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++){
    if (Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]) < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]){
      if (Math.abs(A[p][q]) < 1e-18) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++){ const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++){ const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++){ const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  return { vals: [A[0][0], A[1][1], A[2][2]], vecs: [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]) };
}
function solve3(M, b){ // M = [a,b,c,d,e,f,g,h,i] row-major
  const [a, b1, c, d, e, f, g, h, i] = M;
  const det = a * (e * i - f * h) - b1 * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [
    (b[0] * (e * i - f * h) - b1 * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det,
    (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det,
    (a * (e * b[2] - b[1] * h) - b1 * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det,
  ];
}
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function planeAxes(n){
  let u = Math.abs(n[2]) > .95 ? [1, 0, 0] : norm3(cross3([0, 0, 1], n));
  if (Math.abs(n[2]) > .95){ u = norm3([1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]]); }
  return { u, v: cross3(n, u) };
}


// ------------------------------------------------------------------ library
export const LIB = buildLibrary();
// textures made from the user's own pictures: stored in the design as small grayscale maps
const CUSTOM = new Map();
let customSource = () => null;
export function setCustomTextureSource(fn) { customSource = fn; }
function b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
export function bytesToB64(u) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function customTex(key) {
  if (CUSTOM.has(key)) return CUSTOM.get(key);
  const imgs = customSource() || {};
  const rec = imgs[key.slice(4)];
  if (!rec) return null;
  return registerImageTexture(key.slice(4), rec);
}
// rec: { name, w, h, b64 } (one byte per pixel, 255 = high)
export function registerImageTexture(id, rec) {
  const key = "img:" + id;
  const u = b64ToBytes(rec.b64), d = new Float32Array(rec.w * rec.h);
  for (let i = 0; i < d.length; i++) d[i] = u[i] / 255;
  const t = { key, name: rec.name || "My image", cat: "mine", custom: true, src: { w: rec.w, h: rec.h, data: d, aspect: true } };
  CUSTOM.set(key, t);
  return t;
}
export const texByKey = (k) => (k && k.startsWith("img:") ? customTex(k) : null) || LIB.find((t) => t.key === k) || LIB[0];
const hmCache = new Map();
function layerHM(L) {
  const key = `${L.tex}|${!!L.invert}|${L.blur || 0}`;
  if (hmCache.has(key)) return hmCache.get(key);
  const src = texByKey(L.tex).src;
  let d = new Float32Array(src.data);
  const r = Math.round(L.blur || 0);
  if (r > 0) { d = boxBlur(d, src.w, src.h, r); d = boxBlur(d, src.w, src.h, r); }
  const hm = normalizeHM({ w: src.w, h: src.h, data: d });
  hm.aspect = !!src.aspect;
  if (L.invert) for (let i = 0; i < d.length; i++) d[i] = 1 - d[i];
  if (hmCache.size > 30) hmCache.delete(hmCache.keys().next().value);
  hmCache.set(key, hm);
  return hm;
}
// small shaded preview of a texture, as a data URL (cached)
const thumbs = new Map();
export function textureThumb(key, size = 64) {
  const k = key + "|" + size;
  if (thumbs.has(k)) return thumbs.get(k);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  drawHM(cv, texByKey(key).src, 2);
  const url = cv.toDataURL();
  thumbs.set(k, url);
  return url;
}
export const TEXTURE_DEFAULTS = { tex: "knurl", size: 4, depth: 0.6, dir: "raise", rot: 0, mapping: "auto", falloff: 0, invert: false, once: false };

// ------------------------------------------------------------------ face matching
// Texture layers remember faces by center/type/normal (like fillets remember edges),
// so they follow the body when it is edited.
export function matchTextureFaces(data, faces) {
  const info = data.faceInfo || [];
  if (faces === "all") return info.map((_, i) => i);
  const bb = data.bbox, diag = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;
  const out = new Set();
  for (const q of faces || []) {
    let best = -1, bd = Infinity;
    info.forEach((f, i) => {
      if (!f || !f.c || (q.t && f.t !== q.t)) return;
      if (q.n && f.n && f.n[0] * q.n[0] + f.n[1] * q.n[1] + f.n[2] * q.n[2] < 0.99) return;
      const d = Math.hypot(f.c[0] - q.c[0], f.c[1] - q.c[1], f.c[2] - q.c[2]);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd < Math.max(0.5, diag * 0.08)) out.add(best);
  }
  return [...out];
}

// ------------------------------------------------------------------ mesh pipeline
function weldTris(P, I) {
  const n = P.length / 3;
  let mx = 1; for (let i = 0; i < P.length; i++) { const a = Math.abs(P[i]); if (a > mx) mx = a; }
  const q = Math.min(1e5, 1e9 / mx);
  let size = 1; while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), mask = size - 1;
  const qx = new Int32Array(n), qy = new Int32Array(n), qz = new Int32Array(n);
  const out = new Float32Array(n * 3), remap = new Int32Array(n);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(P[i * 3] * q), y = Math.round(P[i * 3 + 1] * q), z = Math.round(P[i * 3 + 2] * q);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const e = table[h];
      if (e < 0) { table[h] = nv; qx[nv] = x; qy[nv] = y; qz[nv] = z; out[nv * 3] = P[i * 3]; out[nv * 3 + 1] = P[i * 3 + 1]; out[nv * 3 + 2] = P[i * 3 + 2]; remap[i] = nv++; break; }
      if (qx[e] === x && qy[e] === y && qz[e] === z) { remap[i] = e; break; }
      h = (h + 1) & mask;
    }
  }
  const idx = new Uint32Array(I.length), src = new Int32Array(I.length / 3);
  let m = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
    if (a === b || b === c || a === c) continue;
    src[m / 3] = t / 3;
    idx[m++] = a; idx[m++] = b; idx[m++] = c;
  }
  return { pos: out.slice(0, nv * 3), idx: idx.slice(0, m), src: src.slice(0, m / 3) };
}
function makeBase(pos, idx) {
  const nV = pos.length / 3, nT = idx.length / 3;
  const triN = new Float32Array(nT * 3), triA = new Float32Array(nT), triC = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); triA[t] = l / 2;
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    triN[t * 3] = nx; triN[t * 3 + 1] = ny; triN[t * 3 + 2] = nz;
    for (let k = 0; k < 3; k++) triC[t * 3 + k] = (pos[a + k] + pos[b + k] + pos[c + k]) / 3;
  }
  return { pos, idx, nV, nT, triN, triA, triC };
}
// projection frame for every textured face (patch): planar, cylindrical or triplanar
function computeFrames(B, po, P, layers) {
  const np = P.length;
  const acc = new Float64Array(np * 22);
  for (let t = 0; t < B.nT; t++) {
    const p = po[t]; if (p < 0) continue;
    const o = p * 22, A = B.triA[t];
    const nx = B.triN[t * 3], ny = B.triN[t * 3 + 1], nz = B.triN[t * 3 + 2];
    const cx = B.triC[t * 3], cy = B.triC[t * 3 + 1], cz = B.triC[t * 3 + 2];
    acc[o] += A; acc[o + 1] += A * nx; acc[o + 2] += A * ny; acc[o + 3] += A * nz;
    acc[o + 4] += A * cx; acc[o + 5] += A * cy; acc[o + 6] += A * cz;
    acc[o + 7] += A * nx * nx; acc[o + 8] += A * nx * ny; acc[o + 9] += A * nx * nz; acc[o + 10] += A * ny * ny; acc[o + 11] += A * ny * nz; acc[o + 12] += A * nz * nz;
    const nc = nx * cx + ny * cy + nz * cz;
    acc[o + 13] += A * (1 - nx * nx); acc[o + 14] -= A * nx * ny; acc[o + 15] -= A * nx * nz; acc[o + 16] += A * (1 - ny * ny); acc[o + 17] -= A * ny * nz; acc[o + 18] += A * (1 - nz * nz);
    acc[o + 19] += A * (cx - nx * nc); acc[o + 20] += A * (cy - ny * nc); acc[o + 21] += A * (cz - nz * nc);
  }
  const cylList = [];
  for (let p = 0; p < np; p++) {
    const o = p * 22, A = acc[o], pt = P[p];
    pt.area = A;
    if (A <= 0) { pt.kind = "none"; continue; }
    const L = layers[pt.layer];
    const nS = [acc[o + 1], acc[o + 2], acc[o + 3]], nl = Math.hypot(...nS), flat = nl / A;
    const c = [acc[o + 4] / A, acc[o + 5] / A, acc[o + 6] / A];
    const eg = eigSym3([acc[o + 7] / A, acc[o + 8] / A, acc[o + 9] / A, acc[o + 10] / A, acc[o + 11] / A, acc[o + 12] / A]);
    let mi = 0; for (let k = 1; k < 3; k++) if (eg.vals[k] < eg.vals[mi]) mi = k;
    let axis = norm3(eg.vecs[mi]);
    const lamMin = eg.vals[mi];
    let kind;
    const mode = L.mapping || "auto";
    if (mode === "triplanar") kind = "tri";
    else if (mode === "planar") kind = "planar";
    else if (mode === "cylindrical") kind = flat > 0.995 ? "planar" : "cyl";
    else kind = flat > 0.97 ? "planar" : lamMin < 0.03 ? "cyl" : flat > 0.3 ? "planar" : "tri";
    pt.kind = kind; pt.c = c;
    if (kind === "planar") {
      const n = nl > 1e-9 ? [nS[0] / nl, nS[1] / nl, nS[2] / nl] : [0, 0, 1];
      const ax = planeAxes(n); pt.n = n; pt.u = ax.u; pt.v = ax.v;
    } else if (kind === "cyl") {
      let big = 0; for (let k = 1; k < 3; k++) if (Math.abs(axis[k]) > Math.abs(axis[big])) big = k;
      if (axis[big] < 0) axis = axis.map((x) => -x);
      const k = A;
      const M = [acc[o + 13] + k * axis[0] * axis[0], acc[o + 14] + k * axis[0] * axis[1], acc[o + 15] + k * axis[0] * axis[2],
        acc[o + 14] + k * axis[1] * axis[0], acc[o + 16] + k * axis[1] * axis[1], acc[o + 17] + k * axis[1] * axis[2],
        acc[o + 15] + k * axis[2] * axis[0], acc[o + 17] + k * axis[2] * axis[1], acc[o + 18] + k * axis[2] * axis[2]];
      const ac = dot3(axis, c);
      const center = solve3(M, [acc[o + 19] + k * axis[0] * ac, acc[o + 20] + k * axis[1] * ac, acc[o + 21] + k * axis[2] * ac]) || c;
      let r0;
      if (Math.abs(axis[2]) < 0.9) r0 = norm3(cross3(axis, [0, 0, 1]));
      else { const wv = [1, 0, 0]; r0 = norm3([wv[0] - axis[0] * dot3(axis, wv), wv[1] - axis[1] * dot3(axis, wv), wv[2] - axis[2] * dot3(axis, wv)]); }
      pt.a = axis; pt.c = center; pt.r0 = r0; pt.r1 = cross3(axis, r0);
      pt.rS = 0; pt.bins = new Uint8Array(36);
      cylList.push(p);
    }
  }
  if (cylList.length) {
    for (let t = 0; t < B.nT; t++) {
      const p = po[t]; if (p < 0) continue; const pt = P[p]; if (pt.kind !== "cyl") continue;
      const dx = B.triC[t * 3] - pt.c[0], dy = B.triC[t * 3 + 1] - pt.c[1], dz = B.triC[t * 3 + 2] - pt.c[2];
      const x = dx * pt.r0[0] + dy * pt.r0[1] + dz * pt.r0[2], y = dx * pt.r1[0] + dy * pt.r1[1] + dz * pt.r1[2];
      pt.rS += B.triA[t] * Math.hypot(x, y);
      pt.bins[Math.min(35, Math.floor(((Math.atan2(y, x) + Math.PI) / TAU) * 36))] = 1;
    }
    for (const p of cylList) { const pt = P[p]; pt.R = Math.max(1e-3, pt.rS / pt.area); pt.full = pt.bins.every((b) => b); }
  }
  layers.forEach((L, li) => {
    let A = 0; const c = [0, 0, 0];
    P.forEach((pt) => { if (pt.layer === li && pt.area > 0) { A += pt.area; for (let k = 0; k < 3; k++) c[k] += pt.area * pt.c[k]; } });
    L._center = A ? c.map((x) => x / A) : [0, 0, 0];
  });
}
// Conforming refinement of the textured triangles until every edge is shorter than
// `target`. Each mesh edge is split into 2^m equal parts, decided by its length
// alone, so the two triangles that share an edge always agree on its points (no
// cracks). Fat triangles split 1-to-4; slivers (common in CAD meshes) are zipped
// along their long sides, so their triangle count grows with area, not length².
function subdivide(B, po, target, budget) {
  const P = Array.from(B.pos);
  const idxOut = [], tbOut = [];
  const SH = 67108864;
  const edges = new Map(); // key -> { a, list }
  const key = (a, b) => (a < b ? a * SH + b : b * SH + a);
  const addV = (x, y, z) => { P.push(x, y, z); return P.length / 3 - 1; };
  const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  function register(list) {
    const k = key(list[0], list[list.length - 1]);
    if (edges.has(k)) return;
    edges.set(k, { a: list[0], list });
    if (list.length > 2) { const h = (list.length - 1) / 2; register(list.slice(0, h + 1)); register(list.slice(h)); }
  }
  function edge(a, b) {
    let e = edges.get(key(a, b));
    if (!e) {
      const L = len(a, b);
      const m = L > target ? Math.ceil(Math.log2(L / target) - 1e-9) : 0;
      const n = 1 << Math.min(m, 20);
      const list = [a];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        list.push(addV(P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t));
      }
      list.push(b);
      register(list);
      e = edges.get(key(a, b));
    }
    return e.a === a ? e.list : e.list.slice().reverse();
  }
  const emit = (a, b, c, base) => { idxOut.push(a, b, c); tbOut.push(base); };
  function fill(a, b, c, base) {
    const ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
    const nab = ab.length - 1, nbc = bc.length - 1, nca = ca.length - 1;
    if (nab > 1 && nbc > 1 && nca > 1) {
      const mab = ab[nab / 2], mbc = bc[nbc / 2], mca = ca[nca / 2];
      fill(a, mab, mca, base); fill(mab, b, mbc, base); fill(mca, mbc, c, base); fill(mab, mbc, mca, base);
      return;
    }
    // rotate so the shortest side (fewest points) is b-c
    let A = a, Bv = b, C = c, nBC = nbc;
    if (nca < nBC && nca <= nab) { A = b; Bv = c; C = a; nBC = nca; }
    else if (nab < nBC) { A = c; Bv = a; C = b; nBC = nab; }
    if (nBC > 1) { fill(a, b, c, base); return; } // not reached: handled above
    const p = edge(A, Bv), qq = edge(A, C); // A -> B, A -> C
    const bcList = edge(Bv, C);
    if (p.length === 2 && qq.length === 2) {
      if (bcList.length === 2) emit(A, Bv, C, base);
      else for (let i = 0; i < bcList.length - 1; i++) emit(A, bcList[i], bcList[i + 1], base);
      return;
    }
    if (bcList.length > 2) { // short side split but a long side not: fan from the far corner
      for (let i = 0; i < bcList.length - 1; i++) emit(A, bcList[i], bcList[i + 1], base);
      return;
    }
    // zipper between A->B and A->C
    const np = p.length - 1, nq = qq.length - 1;
    emit(A, p[1], qq[1], base);
    let i = 1, j = 1;
    while (i < np || j < nq) {
      const advP = j >= nq || (i < np && (i + 1) / np <= (j + 1) / nq);
      if (advP) { emit(p[i], p[i + 1], qq[j], base); i++; }
      else { emit(p[i], qq[j + 1], qq[j], base); j++; }
    }
  }
  // estimate the size first and coarsen if it would blow the budget
  let est = 0;
  for (let t = 0; t < B.nT; t++) if (po[t] >= 0) est += (2.2 * B.triA[t]) / (target * target * 0.433) + 2;
  let limited = false;
  if (est > budget) { target *= Math.sqrt(est / budget); limited = true; }
  for (let t = 0; t < B.nT; t++) if (po[t] >= 0) fill(B.idx[t * 3], B.idx[t * 3 + 1], B.idx[t * 3 + 2], t);
  // untextured triangles take on the points of the edges they share
  for (let t = 0; t < B.nT; t++) {
    if (po[t] >= 0) continue;
    const v = [B.idx[t * 3], B.idx[t * 3 + 1], B.idx[t * 3 + 2]];
    const ring = [];
    let split = false;
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const e = edges.get(key(a, b));
      const list = e ? (e.a === a ? e.list : e.list.slice().reverse()) : [a, b];
      if (list.length > 2) split = true;
      for (let i = 0; i < list.length - 1; i++) ring.push(list[i]);
    }
    if (!split) { emit(v[0], v[1], v[2], t); continue; }
    let cx = 0, cy = 0, cz = 0;
    for (const k of v) { cx += P[k * 3]; cy += P[k * 3 + 1]; cz += P[k * 3 + 2]; }
    const c = addV(cx / 3, cy / 3, cz / 3);
    for (let i = 0; i < ring.length; i++) emit(c, ring[i], ring[(i + 1) % ring.length], t);
  }
  const nV = P.length / 3, nT = tbOut.length;
  return { pos: new Float32Array(P), idx: new Uint32Array(idxOut), tb: new Int32Array(tbOut), nV, nT, limited, target };
}
// distance (along mesh edges) from the border of the textured region, for edge blending
function borderDistance(H, po) {
  const { nV, nT, idx, tb, pos } = H;
  const deg = new Int32Array(nV + 1);
  for (let t = 0; t < nT; t++) { if (po[tb[t]] < 0) continue; for (let k = 0; k < 3; k++) deg[idx[t * 3 + k] + 1] += 2; }
  for (let i = 0; i < nV; i++) deg[i + 1] += deg[i];
  const nbr = new Int32Array(deg[nV]), fillp = deg.slice(0, nV);
  for (let t = 0; t < nT; t++) {
    if (po[tb[t]] < 0) continue;
    for (let k = 0; k < 3; k++) { const a = idx[t * 3 + k], b = idx[t * 3 + ((k + 1) % 3)], c = idx[t * 3 + ((k + 2) % 3)]; nbr[fillp[a]++] = b; nbr[fillp[a]++] = c; }
  }
  const dist = new Float64Array(nV).fill(Infinity); // float64: rounding in float32 can loop forever
  let hk = new Float64Array(1024), hv = new Int32Array(1024), hs = 0;
  const push = (k, v) => {
    if (hs === hk.length) { const a = new Float64Array(hs * 2); a.set(hk); hk = a; const b = new Int32Array(hs * 2); b.set(hv); hv = b; }
    let i = hs++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const v = hv[0], lk = hk[--hs], lv = hv[hs]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= hs) break; if (c + 1 < hs && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = lk; hv[i] = lv; return v;
  };
  for (let v = 0; v < nV; v++) if (H.bnd[v] && H.vp[v * 3] >= 0) { dist[v] = 0; push(0, v); }
  while (hs) {
    const d0 = hk[0], v = pop(); if (d0 > dist[v]) continue;
    for (let j = deg[v]; j < deg[v + 1]; j++) {
      const u = nbr[j];
      const nd = d0 + Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]);
      if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
    }
  }
  return dist;
}
function sampleTile(R, x, y, W, H) {
  const xr = x * R.cr + y * R.sr, yr = -x * R.sr + y * R.cr;
  // pictures keep their shape: the tile is as tall as the picture's proportions say
  if (R.hm.aspect) H = H * R.hm.h / R.hm.w;
  if (R.L.once) {
    // a single copy centred on the face; outside it the surface stays flat
    const u = xr / W + 0.5, v = yr / H + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return R.base;
    return hmSample(R.hm, Math.min(u, 0.9999), Math.min(v, 0.9999));
  }
  return hmSample(R.hm, xr / W, yr / H);
}
function heightAt(R, pt, px, py, pz, nx, ny, nz) {
  const L = R.L, S = L.size || 4;
  if (pt.kind === "planar") {
    const dx = px - pt.c[0], dy = py - pt.c[1], dz = pz - pt.c[2];
    return sampleTile(R, dx * pt.u[0] + dy * pt.u[1] + dz * pt.u[2], dx * pt.v[0] + dy * pt.v[1] + dz * pt.v[2], S, S);
  }
  if (pt.kind === "cyl") {
    const dx = px - pt.c[0], dy = py - pt.c[1], dz = pz - pt.c[2];
    const x = dx * pt.r0[0] + dy * pt.r0[1] + dz * pt.r0[2], y = dx * pt.r1[0] + dy * pt.r1[1] + dz * pt.r1[2], h = dx * pt.a[0] + dy * pt.a[1] + dz * pt.a[2];
    const circ = TAU * pt.R;
    let W = S, H = S;
    // a whole cylinder gets a whole number of tiles around, so there is no seam
    if (pt.full && !L.rot) { const n = Math.max(1, Math.round(circ / W)); const s = circ / n / W; W *= s; H *= s; }
    return sampleTile(R, Math.atan2(y, x) * pt.R, h, W, H);
  }
  const c = L._center, dx = px - c[0], dy = py - c[1], dz = pz - c[2];
  let wx = nx ** 4, wy = ny ** 4, wz = nz ** 4; const s = wx + wy + wz || 1; wx /= s; wy /= s; wz /= s;
  let h = 0;
  if (wx > 0.01) h += wx * sampleTile(R, nx >= 0 ? dy : -dy, dz, S, S);
  if (wy > 0.01) h += wy * sampleTile(R, ny >= 0 ? -dx : dx, dz, S, S);
  if (wz > 0.01) h += wz * sampleTile(R, dx, nz >= 0 ? dy : -dy, S, S);
  return h;
}

// Returns a new mesh (same layout as a kernel mesh) with the texture layers applied.
export function applyTextures(data, layers0, budget = 1.2e6) {
  const layers = layers0.map((L) => ({ ...L })); // frames get cached on these copies
  const nF = data.faceGroups.length;
  const T0 = data.triangles;
  const faceOfTri = new Int32Array(T0.length / 3);
  data.faceGroups.forEach(([s, c], f) => { for (let t = s / 3; t < (s + c) / 3; t++) faceOfTri[t] = f; });
  const layerOfFace = new Int16Array(nF).fill(-1);
  layers.forEach((L, li) => { for (const f of matchTextureFaces(data, L.faces)) layerOfFace[f] = li; });
  // one patch (projection frame) per textured face
  const patchOfFace = new Int32Array(nF).fill(-1), P = [];
  for (let f = 0; f < nF; f++) if (layerOfFace[f] >= 0) { patchOfFace[f] = P.length; P.push({ layer: layerOfFace[f], face: f }); }
  if (!P.length) return { ...data, texInfo: { faces: 0 } };
  const W = weldTris(data.vertices, T0);
  const B = makeBase(W.pos, W.idx);
  const faceOfBase = new Int32Array(B.nT);
  for (let t = 0; t < B.nT; t++) faceOfBase[t] = faceOfTri[W.src[t]];
  const po = new Int32Array(B.nT);
  for (let t = 0; t < B.nT; t++) po[t] = patchOfFace[faceOfBase[t]];
  computeFrames(B, po, P, layers);
  let target = Infinity;
  for (const L of layers) target = Math.min(target, Math.max(0.06, (L.size || 4) / (String(L.tex).startsWith("img:") ? 80 : 9))); // pictures need finer detail
  const res = subdivide(B, po, target, budget);
  target = res.target;
  const { pos, idx, tb, nV, nT } = res;
  // per-vertex normal (textured faces), patches touching the vertex, region border
  const vn = new Float32Array(nV * 3), vp = new Int32Array(nV * 3).fill(-1), vl = new Int16Array(nV).fill(-2), bnd = new Uint8Array(nV);
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2], p = po[tb[t]], L = p < 0 ? -1 : P[p].layer;
    for (const v of [a, b, c]) { if (vl[v] === -2) vl[v] = L; else if (vl[v] !== L) bnd[v] = 1; }
    if (p < 0) continue;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      vn[v * 3] += nx; vn[v * 3 + 1] += ny; vn[v * 3 + 2] += nz;
      const o = v * 3;
      if (vp[o] === p || vp[o + 1] === p || vp[o + 2] === p) continue;
      if (vp[o] < 0) vp[o] = p; else if (vp[o + 1] < 0) vp[o + 1] = p; else if (vp[o + 2] < 0) vp[o + 2] = p;
    }
  }
  for (let v = 0; v < nV; v++) { const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]); if (l > 0) { vn[v * 3] /= l; vn[v * 3 + 1] /= l; vn[v * 3 + 2] /= l; } }
  const H = { pos, idx, tb, nV, nT, vp, bnd };
  const dist = layers.some((L) => L.falloff > 0) ? borderDistance(H, po) : null;
  // displace
  const RT = layers.map((L) => {
    const a = ((L.rot || 0) * Math.PI) / 180;
    return { L, hm: layerHM(L), cr: Math.cos(a), sr: Math.sin(a), base: L.dir === "engrave" ? 1 : L.dir === "both" ? 0.5 : 0 };
  });
  const disp = new Float32Array(pos);
  for (let v = 0; v < nV; v++) {
    const o = v * 3; if (vp[o] < 0) continue;
    const px = pos[o], py = pos[o + 1], pz = pos[o + 2], nx = vn[o], ny = vn[o + 1], nz = vn[o + 2];
    let sum = 0, cnt = 0;
    for (let s = 0; s < 3; s++) {
      const p = vp[o + s]; if (p < 0) break;
      const pt = P[p], R = RT[pt.layer], L = R.L;
      if (pt.kind === "none") continue;
      let d = (L.depth || 0) * (heightAt(R, pt, px, py, pz, nx, ny, nz) - R.base);
      if (L.falloff > 0 && dist) d *= smooth(0, L.falloff, dist[v]);
      sum += d; cnt++;
    }
    if (!cnt) continue;
    const d = sum / cnt;
    disp[o] = px + nx * d; disp[o + 1] = py + ny * d; disp[o + 2] = pz + nz * d;
  }
  // un-weld per face again so faces keep crisp edges and pick as before
  const faceOf = (t) => faceOfBase[tb[t]];
  const counts = new Int32Array(nF + 1);
  for (let t = 0; t < nT; t++) counts[faceOf(t) + 1]++;
  for (let f = 0; f < nF; f++) counts[f + 1] += counts[f];
  const order = new Int32Array(nT), fill = counts.slice(0, nF);
  for (let t = 0; t < nT; t++) order[fill[faceOf(t)]++] = t;
  const stamp = new Int32Array(nV).fill(-1), local = new Int32Array(nV);
  const outP = [], tris = new Uint32Array(nT * 3);
  let nv = 0;
  const faceGroups = [];
  for (let f = 0; f < nF; f++) {
    const s = counts[f], e = counts[f + 1];
    faceGroups.push([s * 3, (e - s) * 3]);
    for (let j = s; j < e; j++) {
      const t = order[j];
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        if (stamp[v] !== f) { stamp[v] = f; local[v] = nv++; outP.push(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]); }
        tris[j * 3 + k] = local[v];
      }
    }
  }
  const vertices = new Float32Array(outP);
  const normals = new Float32Array(vertices.length);
  for (let t = 0; t < nT; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const ux = vertices[b * 3] - vertices[a * 3], uy = vertices[b * 3 + 1] - vertices[a * 3 + 1], uz = vertices[b * 3 + 2] - vertices[a * 3 + 2];
    const wx = vertices[c * 3] - vertices[a * 3], wy = vertices[c * 3 + 1] - vertices[a * 3 + 1], wz = vertices[c * 3 + 2] - vertices[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) { normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz; }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) { normals[v * 3 + k] /= l; const x = vertices[v * 3 + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; }
  }
  return { ...data, vertices, normals, triangles: tris, faceGroups, bbox: { min, max }, kbbox: data.kbbox || data.bbox, texInfo: { faces: P.length, triangles: nT, limited: res.limited, edge: target } };
}
