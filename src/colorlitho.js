// Color Lithophane Studio: a photo becomes a full-colour lithophane printed with white, cyan,
// magenta and yellow (and black) filament. Light shining through it mixes the colours.
//   - a thin white plate at the bottom
//   - colour layers: every colour pixel is a stack of the same number of thin layers, each one
//     white, cyan, magenta, yellow or black; the mix of layers sets its colour (more cyan layers
//     = more cyan). Light passing through loses some of each colour in each layer (Beer–Lambert),
//     using each filament's colour and its TD (transmission distance: how thick it must be before
//     almost no light gets through), so the mixes are worked out like the light really does
//   - a white texture layer on top, thicker where the picture is darker: it sets the brightness
//     and the fine detail, like an ordinary lithophane
// Files: 3MF (one object, a part per filament, set up for Orca Slicer and Bambu Studio), a ZIP of
// STLs (one per filament, like other colour-lithophane tools), or straight into the 3D Print Sim.
import * as THREE from "three";
import { el, makeZip } from "./util.js";

export const LITHO_FILAMENTS = [
  { key: "W", name: "White", color: "#f4f4f2", td: 2.2, fixed: true },
  { key: "C", name: "Cyan", color: "#00a6d6", td: 3.4 },
  { key: "M", name: "Magenta", color: "#d81b7a", td: 3.0 },
  { key: "Y", name: "Yellow", color: "#f6d800", td: 5.2 },
  { key: "K", name: "Black", color: "#202020", td: 0.6, off: true },
];
const SHAPES = [["rect", "Rectangle"], ["round", "Rounded"], ["oval", "Oval"], ["heart", "Heart"], ["hex", "Hexagon"]];
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const unlin = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const hexRGB = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; };
const toHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(1, unlin(v))) * 255).toString(16).padStart(2, "0")).join("");
// CIE Lab from linear RGB (D65)
function lab(r, g, b) {
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// per-millimetre light loss of a filament, per channel: a third of its TD already shows its own
// colour (its pigment), and it scatters, letting through only 1/20 of the light at its TD
const absorb = (f) => hexRGB(f.color).map((c) => (3 * Math.log(1 / Math.max(c, 0.01)) + Math.log(20)) / Math.max(0.1, f.td));
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// every mix of n layers from the filaments (each layer one filament), with the light through it
function makePalette(fils, n, b) {
  const A = fils.map(absorb), out = [];
  const rec = (i, left, counts) => {
    if (i === fils.length - 1) { counts[i] = left; out.push(counts.slice()); return; }
    for (let k = left; k >= 0; k--) { counts[i] = k; rec(i + 1, left - k, counts); }
  };
  rec(0, n, new Array(fils.length).fill(0));
  const white = A[0].map((a) => Math.exp(-a * b * n));
  return out.map((counts) => {
    const t = [0, 1, 2].map((ch) => Math.exp(-counts.reduce((s, c, i) => s + c * A[i][ch] * b, 0)) / white[ch]);
    return { counts, rgb: t, lab: lab(...t) };
  });
}
// shapes, in millimetres from the centre: inside(x, y) for a w × h piece
function shapeFn(kind, w, h, corner) {
  const hw = w / 2, hh = h / 2;
  if (kind === "round") { const r = Math.min(corner, hw, hh); return (x, y) => { const dx = Math.max(0, Math.abs(x) - (hw - r)), dy = Math.max(0, Math.abs(y) - (hh - r)); return Math.abs(x) <= hw && Math.abs(y) <= hh && dx * dx + dy * dy <= r * r; }; }
  if (kind === "oval") return (x, y) => (x * x) / (hw * hw) + (y * y) / (hh * hh) <= 1;
  if (kind === "hex") return (x, y) => { const s = Math.min(hw / 1, hh / 0.866); const ax = Math.abs(x) / s, ay = Math.abs(y) / s; return ay <= 0.866 && ax <= 1 - ay / 1.732; };
  if (kind === "heart") return (x, y) => { const s = Math.min(hw, hh) * 0.82, u = x / s, v = (y + hh * 0.08) / s; const a = u * u + v * v - 1; return a * a * a - u * u * v * v * v <= 0; };
  return (x, y) => Math.abs(x) <= hw && Math.abs(y) <= hh;
}

// ------------------------------------------------------------------ the model
// st: { img (canvas), w, shape, corner, border, layers, lh, plate, cpx, tpx, tmin, tmax, dither,
//       mirror, bright, contrast, sat, fils: [{key,name,color,td,off}] }
export function lithoModel(st) {
  const fils = st.fils.filter((f) => !f.off || f.fixed);
  const img = st.img, W = st.w, H = (W * img.height) / img.width;
  const nx = Math.max(4, Math.round(W / st.cpx)), ny = Math.max(4, Math.round(H / st.cpx)), cw = W / nx, chh = H / ny;
  const tx = Math.max(4, Math.round(W / st.tpx)), ty = Math.max(4, Math.round(H / st.tpx)), tw = W / tx, th = H / ty;
  const inside = shapeFn(st.shape, W, H, st.corner);
  // the picture, adjusted, at the texture's size (linear RGB)
  const cv = document.createElement("canvas"); cv.width = tx; cv.height = ty;
  const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, tx, ty);
  const px = g.getImageData(0, 0, tx, ty).data;
  const br = (st.bright || 0) / 100, ct = 1 + (st.contrast || 0) / 100, sa = 1 + (st.sat || 0) / 100;
  const P = new Float32Array(tx * ty * 3);
  for (let i = 0; i < tx * ty; i++) {
    let r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
    const a = px[i * 4 + 3] / 255; r = r * a + 1 - a; gg = gg * a + 1 - a; b = b * a + 1 - a; // transparent = white
    const l = 0.299 * r + 0.587 * gg + 0.114 * b;
    r = l + (r - l) * sa; gg = l + (gg - l) * sa; b = l + (b - l) * sa;
    r = (r - 0.5) * ct + 0.5 + br; gg = (gg - 0.5) * ct + 0.5 + br; b = (b - 0.5) * ct + 0.5 + br;
    P[i * 3] = lin(Math.max(0, Math.min(1, r))); P[i * 3 + 1] = lin(Math.max(0, Math.min(1, gg))); P[i * 3 + 2] = lin(Math.max(0, Math.min(1, b)));
  }
  // which texels are in the shape: they follow the colour cells, so the edges line up
  const aW = absorb(fils[0]), aWl = lum(aW[0], aW[1], aW[2]);
  const cellOf = (i, j) => Math.min(ny - 1, Math.floor(((j + 0.5) * th) / chh)) * nx + Math.min(nx - 1, Math.floor(((i + 0.5) * tw) / cw));
  const tIn = new Uint8Array(tx * ty), T = new Float32Array(tx * ty), WT = new Float32Array(tx * ty);
  const cIn = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cIn[j * nx + i] = inside((i + 0.5) * cw - W / 2, H / 2 - (j + 0.5) * chh) ? 1 : 0;
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) tIn[j * tx + i] = cIn[cellOf(i, j)];
  // 1. the colour layers set the hue: each cell's colour at full brightness (its brightest channel
  //    at 1), matched to the nearest mix, so dark colours still get their colour
  const pal = makePalette(fils, st.layers, st.lh);
  const target = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const x0 = Math.floor((i * cw) / tw), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * cw) / tw)), y0 = Math.floor((j * chh) / th), y1 = Math.max(y0 + 1, Math.floor(((j + 1) * chh) / th));
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = y0; y < Math.min(ty, y1); y++) for (let x = x0; x < Math.min(tx, x1); x++) { const q = y * tx + x; r += P[q * 3]; gg += P[q * 3 + 1]; b += P[q * 3 + 2]; n++; }
    n = n || 1; r /= n; gg /= n; b /= n;
    const mx = Math.max(r, gg, b, 1e-4), sat = mx > 0.002 ? 1 : 0;
    // very dark cells have no reliable colour: treat them as grey
    target[k * 3] = sat ? r / mx : 1; target[k * 3 + 1] = sat ? gg / mx : 1; target[k * 3 + 2] = sat ? b / mx : 1;
  }
  const pick = new Uint16Array(nx * ny);
  const near = (r, gg, b) => { const L = lab(r, gg, b); let best = 0, bd = Infinity; for (let p = 0; p < pal.length; p++) { const q = pal[p].lab, d = (q[0] - L[0]) ** 2 * 0.35 + (q[1] - L[1]) ** 2 + (q[2] - L[2]) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
  const E = st.dither ? Float32Array.from(target) : target;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const r = Math.max(0, Math.min(1.2, E[k * 3])), gg = Math.max(0, Math.min(1.2, E[k * 3 + 1])), b = Math.max(0, Math.min(1.2, E[k * 3 + 2]));
    const p = near(r, gg, b); pick[k] = p;
    if (st.dither && cIn[k]) {
      const c = pal[p].rgb, er = [r - c[0], gg - c[1], b - c[2]];
      const add = (ii, jj, f) => { if (ii < 0 || ii >= nx || jj >= ny) return; const q = jj * nx + ii; for (let ch = 0; ch < 3; ch++) E[q * 3 + ch] += er[ch] * f * 0.8; };
      add(i + 1, j, 7 / 16); add(i - 1, j + 1, 3 / 16); add(i, j + 1, 5 / 16); add(i + 1, j + 1, 1 / 16);
    }
  }
  // 2. the white texture sets the brightness: as thick as it must be so the light through the mix
  //    under it and the white comes out as bright as the picture (thinnest where brightest)
  let top = 0; for (const q of pal) top = Math.max(top, lum(...q.rgb));
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const k = j * tx + i, c = pal[pick[cellOf(i, j)]].rgb;
    const want = lum(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]) * top, have = Math.max(1e-4, lum(c[0], c[1], c[2]));
    const t = st.tmin + Math.log(Math.max(1e-6, have / Math.max(1e-6, want))) / aWl;
    T[k] = Math.max(st.tmin, Math.min(st.tmax, t));
    WT[k] = Math.exp(-(T[k] - st.tmin) * aWl);
  }
  // how it looks with light behind it (each texture pixel: its cell's mix × the white over it)
  const prev = document.createElement("canvas"); prev.width = tx; prev.height = ty;
  const pg = prev.getContext("2d"), pd = pg.createImageData(tx, ty);
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const k = j * tx + i, ci = Math.min(nx - 1, Math.floor(((i + 0.5) * tw) / cw)), cj = Math.min(ny - 1, Math.floor(((j + 0.5) * th) / chh)), c = pal[pick[cj * nx + ci]].rgb;
    if (!tIn[k]) { pd.data[k * 4 + 3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) pd.data[k * 4 + ch] = Math.round(Math.max(0, Math.min(1, unlin((c[ch] * WT[k]) / top))) * 255);
    pd.data[k * 4 + 3] = 255;
  }
  pg.putImageData(pd, 0, 0);
  // filament use (mm³) and layers
  const used = fils.map(() => 0);
  let cells = 0;
  for (let k = 0; k < nx * ny; k++) if (cIn[k]) { cells++; pal[pick[k]].counts.forEach((c, f) => { used[f] += c * cw * chh * st.lh; }); }
  used[0] += cells * cw * chh * st.plate;
  for (let k = 0; k < tx * ty; k++) if (tIn[k]) used[0] += T[k] * tw * th;
  return { st, fils, W, H, nx, ny, cw, chh, tx, ty, tw, th, pal, pick, cIn, tIn, T, preview: prev, used, inside, zColor: st.plate + st.layers * st.lh };
}

// ------------------------------------------------------------------ meshes
// a part per filament: { key, name, color, V: Float32Array, I: Uint32Array }
export function lithoMeshes(m) {
  const st = m.st, { nx, ny, cw, chh, W, H, fils } = m, n = st.layers, mir = st.mirror ? -1 : 1;
  // z levels: the plate, then the colour layers
  const zs = [0, st.plate]; for (let k = 1; k <= n; k++) zs.push(st.plate + k * st.lh);
  const NL = n + 1, lab3 = new Uint8Array(nx * ny * NL).fill(255);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!m.cIn[k]) continue;
    lab3[k * NL] = 0;
    // each cell's layers, filament by filament from the plate up (white first)
    let z = 1; m.pal[m.pick[k]].counts.forEach((c, f) => { for (let q = 0; q < c; q++) lab3[k * NL + z++] = f; });
  }
  const at = (i, j, z) => (i < 0 || j < 0 || i >= nx || j >= ny || z < 0 || z >= NL ? 255 : lab3[(j * nx + i) * NL + z]);
  const X = (i) => mir * (i * cw - W / 2), Y = (j) => H / 2 - j * chh;
  const parts = [];
  fils.forEach((f, fi) => {
    const V = [], I = [], key = new Map();
    const v = (i, j, z) => { const s = i + "," + j + "," + z; let id = key.get(s); if (id == null) { id = V.length / 3; key.set(s, id); V.push(X(i), Y(j), zs[z]); } return id; };
    const quad = (a, b, c, d) => { if (mir < 0) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d); };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let z = 0; z < NL; z++) {
      if (at(i, j, z) !== fi) continue;
      // outward faces where the neighbour is another filament (or nothing). y grows down the rows,
      // so the picture's top is +Y: corners (i, j) top-left, (i+1, j+1) bottom-right
      if (at(i, j, z - 1) !== fi) quad(v(i, j, z), v(i + 1, j, z), v(i + 1, j + 1, z), v(i, j + 1, z));
      if (at(i, j, z + 1) !== fi) quad(v(i, j, z + 1), v(i, j + 1, z + 1), v(i + 1, j + 1, z + 1), v(i + 1, j, z + 1));
      if (at(i - 1, j, z) !== fi) quad(v(i, j, z), v(i, j + 1, z), v(i, j + 1, z + 1), v(i, j, z + 1));
      if (at(i + 1, j, z) !== fi) quad(v(i + 1, j, z), v(i + 1, j, z + 1), v(i + 1, j + 1, z + 1), v(i + 1, j + 1, z));
      if (at(i, j - 1, z) !== fi) quad(v(i, j, z), v(i, j, z + 1), v(i + 1, j, z + 1), v(i + 1, j, z));
      if (at(i, j + 1, z) !== fi) quad(v(i, j + 1, z), v(i + 1, j + 1, z), v(i + 1, j + 1, z + 1), v(i, j + 1, z + 1));
    }
    if (I.length) parts.push({ key: f.key, name: f.name + (fi === 0 ? " (plate and colour)" : ""), color: f.color, slot: fi, V: new Float32Array(V), I: new Uint32Array(I) });
  });
  // the white texture on top: a height field over the colour stack
  parts.push({ key: "T", name: "White texture", color: fils[0].color, slot: 0, ...heightField(m.tx, m.ty, m.tw, m.th, W, H, mir, (k) => m.tIn[k], (k) => m.T[k], m.zColor) });
  // a white frame round the shape, as tall as the thickest texture
  if (st.border > 0) {
    const grow = shapeFn(st.shape, W + 2 * st.border, H + 2 * st.border, st.corner + st.border);
    const bx = Math.round((W + 2 * st.border) / m.tw), by = Math.round((H + 2 * st.border) / m.th), bw = (W + 2 * st.border) / bx, bh = (H + 2 * st.border) / by;
    const inF = new Uint8Array(bx * by);
    for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) { const x = (i + 0.5) * bw - (W / 2 + st.border), y = (H / 2 + st.border) - (j + 0.5) * bh; inF[j * bx + i] = grow(x, y) && !insideCells(m, x, y) ? 1 : 0; }
    const hf = heightField(bx, by, bw, bh, W + 2 * st.border, H + 2 * st.border, mir, (k) => inF[k], () => m.zColor + st.tmax, 0, true);
    if (hf.I.length) parts.push({ key: "F", name: "White frame", color: fils[0].color, slot: 0, ...hf });
  }
  return parts;
}
function insideCells(m, x, y) {
  const i = Math.floor((x + m.W / 2) / m.cw), j = Math.floor((m.H / 2 - y) / m.chh);
  return i >= 0 && j >= 0 && i < m.nx && j < m.ny && m.cIn[j * m.nx + i] === 1;
}
// a height field over a grid of texels: top at z0 + h(k) (or h(k) when abs), bottom at z0, walls
// round the edge. Corner heights are the average of the texels round them, so the top is smooth.
function heightField(tx, ty, tw, th, W, H, mir, inside, h, z0, abs) {
  const V = [], I = [];
  const top = new Int32Array((tx + 1) * (ty + 1)).fill(-1), bot = new Int32Array((tx + 1) * (ty + 1)).fill(-1);
  const X = (i) => mir * (i * tw - W / 2), Y = (j) => H / 2 - j * th;
  const In = (i, j) => i >= 0 && j >= 0 && i < tx && j < ty && inside(j * tx + i);
  const ztop = (i, j) => { let s = 0, n = 0; for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (In(a, b)) { s += h(b * tx + a); n++; } return abs ? s / n : z0 + s / n; };
  const vt = (i, j) => { const q = j * (tx + 1) + i; if (top[q] < 0) { top[q] = V.length / 3; V.push(X(i), Y(j), ztop(i, j)); } return top[q]; };
  const vb = (i, j) => { const q = j * (tx + 1) + i; if (bot[q] < 0) { bot[q] = V.length / 3; V.push(X(i), Y(j), z0); } return bot[q]; };
  const tri = (a, b, c) => (mir < 0 ? I.push(a, c, b) : I.push(a, b, c));
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    if (!In(i, j)) continue;
    const a = vt(i, j), b = vt(i + 1, j), c = vt(i + 1, j + 1), d = vt(i, j + 1);
    tri(a, d, c); tri(a, c, b); // top, facing up (rows run down -Y)
    const A = vb(i, j), B = vb(i + 1, j), C = vb(i + 1, j + 1), D = vb(i, j + 1);
    tri(A, B, C); tri(A, C, D); // bottom, facing down
    if (!In(i - 1, j)) { tri(A, D, d); tri(A, d, a); }
    if (!In(i + 1, j)) { tri(B, b, c); tri(B, c, C); }
    if (!In(i, j - 1)) { tri(A, a, b); tri(A, b, B); }
    if (!In(i, j + 1)) { tri(D, C, c); tri(D, c, d); }
  }
  return { V: new Float32Array(V), I: new Uint32Array(I) };
}

// ------------------------------------------------------------------ files
function stlBytes(list) {
  const nt = list.reduce((s, m) => s + m.I.length / 3, 0), buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (const m of list) {
    const V = m.V, I = m.I;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], wx = V[c] - V[a], wy = V[c + 1] - V[a + 1], wz = V[c + 2] - V[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const q of [a, b, c]) { dv.setFloat32(o, V[q], true); dv.setFloat32(o + 4, V[q + 1], true); dv.setFloat32(o + 8, V[q + 2], true); o += 12; }
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
// one object with a part per filament; Orca Slicer and Bambu Studio read which filament each part
// prints with from Metadata/model_settings.config (other slicers load the parts, ready to assign)
async function threeMF(parts, name, fils) {
  const enc = new TextEncoder(), num = (v) => +v.toFixed(4);
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${name.replace(/[<&>"]/g, "")}</metadata>`, '<metadata name="Application">JumpStart 3D</metadata>', "<resources>",
    '<basematerials id="1">' + parts.map((p) => `<base name="${p.name}" displaycolor="${p.color.toUpperCase()}FF"/>`).join("") + "</basematerials>"];
  // centred on the plate, standing on it
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (let i = 0; i < p.V.length; i += 3) { x0 = Math.min(x0, p.V[i]); x1 = Math.max(x1, p.V[i]); y0 = Math.min(y0, p.V[i + 1]); y1 = Math.max(y1, p.V[i + 1]); }
  parts.forEach((p, k) => {
    const id = k + 2, v = [];
    for (let i = 0; i < p.V.length; i += 3) v.push(`<vertex x="${num(p.V[i])}" y="${num(p.V[i + 1])}" z="${num(p.V[i + 2])}"/>`);
    const t = []; for (let i = 0; i < p.I.length; i += 3) t.push(`<triangle v1="${p.I[i]}" v2="${p.I[i + 1]}" v3="${p.I[i + 2]}"/>`);
    xml.push(`<object id="${id}" name="${p.name}" type="model" pid="1" pindex="${k}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`);
  });
  const asm = parts.length + 2;
  xml.push(`<object id="${asm}" name="${name.replace(/[<&>"]/g, "")}" type="model"><components>${parts.map((_, k) => `<component objectid="${k + 2}"/>`).join("")}</components></object>`);
  xml.push("</resources>", `<build><item objectid="${asm}" transform="1 0 0 0 1 0 0 0 1 ${num(-(x0 + x1) / 2 + 128)} ${num(-(y0 + y1) / 2 + 128)} 0"/></build>`, "</model>");
  const cfg = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>", `  <object id="${asm}">`, `    <metadata key="name" value="${name.replace(/[<&>"]/g, "")}"/>`, '    <metadata key="extruder" value="1"/>',
    ...parts.map((p, k) => `    <part id="${k + 2}" subtype="normal_part">\n      <metadata key="name" value="${p.name}"/>\n      <metadata key="extruder" value="${p.slot + 1}"/>\n    </part>`), "  </object>", "</config>"];
  const z = makeZip([
    { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>') },
    { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: "3D/3dmodel.model", data: enc.encode(xml.join("\n")) },
    { name: "Metadata/model_settings.config", data: enc.encode(cfg.join("\n")) },
  ]);
  void fils;
  return new Uint8Array(await z.arrayBuffer());
}
function readMe(m, name) {
  const st = m.st, f = m.fils;
  return [`${name}: colour lithophane`, "",
    `Size ${m.W.toFixed(1)} × ${m.H.toFixed(1)} mm${st.border ? `, with a ${st.border} mm frame` : ""}; ${(m.zColor + st.tmax).toFixed(2)} mm thick at most.`,
    `Layer height: ${st.lh} mm for the whole print (the plate is ${st.plate} mm, then ${st.layers} colour layers of ${st.lh} mm, then the white texture from ${st.tmin} to ${st.tmax} mm).`,
    `Colour pixels ${m.cw.toFixed(2)} mm, texture pixels ${m.tw.toFixed(2)} mm. ${st.mirror ? "Mirrored, so it reads the right way round from the flat (bed) side." : "Reads the right way round from the textured side."}`,
    "", "Filaments (load them in this order):", ...f.map((x, i) => `  ${i + 1}. ${x.name} ${x.color} (TD ${x.td} mm)`), "",
    "3MF: one object with a part per filament. Orca Slicer and Bambu Studio set each part's filament for you; in other slicers give each part its filament (they are named).",
    "STL files: load them all at once as one object with several parts (answer Yes when asked), then give each part its filament.",
    "Print flat, 100% infill, 2 walls, no ironing, with the plate side on the bed. Give it plenty of light from behind (a white LED panel is best).",
    "", "Made with JumpStart 3D Color Lithophane Studio."].join("\n");
}

// ------------------------------------------------------------------ the studio
export function initColorLitho(app) {
  let ui = null;
  const LS = "jumpstart3d.clitho.";
  const pref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

  function sample() {
    // a sunset over hills with a balloon: plenty of colour to try it on
    const c = document.createElement("canvas"); c.width = 800; c.height = 600;
    const g = c.getContext("2d");
    const sky = g.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, "#1b3f8f"); sky.addColorStop(0.45, "#c1477c"); sky.addColorStop(0.75, "#f58a2f"); sky.addColorStop(1, "#ffd35a");
    g.fillStyle = sky; g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#fff2a8"; g.beginPath(); g.arc(560, 380, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2d6a3a"; g.beginPath(); g.moveTo(0, 470); g.bezierCurveTo(200, 380, 330, 520, 520, 430); g.bezierCurveTo(650, 380, 740, 450, 800, 420); g.lineTo(800, 600); g.lineTo(0, 600); g.fill();
    g.fillStyle = "#1c4a2a"; g.beginPath(); g.moveTo(0, 540); g.bezierCurveTo(260, 470, 420, 590, 800, 510); g.lineTo(800, 600); g.lineTo(0, 600); g.fill();
    const cols = ["#e8322c", "#f7c21a", "#2f8fe0", "#2fb35a", "#e8322c", "#f7c21a"];
    for (let k = 0; k < 6; k++) { g.fillStyle = cols[k]; g.beginPath(); g.moveTo(230, 260); g.arc(230, 170, 95, Math.PI / 2 + Math.PI * 0.62 - (k + 1) * (Math.PI * 1.24) / 6 + Math.PI, Math.PI / 2 + Math.PI * 0.62 - k * (Math.PI * 1.24) / 6 + Math.PI); g.fill(); }
    g.fillStyle = "#7a4a22"; g.fillRect(212, 278, 36, 26); g.strokeStyle = "#5a3a1a"; g.lineWidth = 3; g.beginPath(); g.moveTo(175, 225); g.lineTo(214, 278); g.moveTo(285, 225); g.lineTo(246, 278); g.stroke();
    for (let k = 0; k < 7; k++) { g.strokeStyle = ["#ff0000", "#ff8a00", "#ffee00", "#22cc44", "#1e90ff", "#4b3bd6", "#9b30d9"][k]; g.lineWidth = 9; g.globalAlpha = 0.55; g.beginPath(); g.arc(640, 560, 300 - k * 9, Math.PI * 1.08, Math.PI * 1.55); g.stroke(); }
    g.globalAlpha = 1;
    return c;
  }
  function open() {
    if (ui) return;
    const st = {
      img: null, name: "Sample", w: pref("w", 100), shape: pref("shape", "rect"), corner: pref("corner", 8), border: pref("border", 3),
      layers: pref("layers", 5), lh: pref("lh", 0.1), plate: pref("plate", 0.2), cpx: pref("cpx", 0.8), tpx: pref("tpx", 0.4), tmin: pref("tmin", 0.3), tmax: pref("tmax", 2.0),
      dither: pref("dither", true), mirror: pref("mirror", true), bright: 0, contrast: 0, sat: pref("sat", 10),
      fils: pref("fils", LITHO_FILAMENTS).map((f, i) => ({ ...LITHO_FILAMENTS[i], ...f })), tab: "light",
    };
    st.img = sample();
    buildUI(st);
    recompute();
  }
  function close() {
    if (!ui) return;
    cancelAnimationFrame(ui.raf); clearTimeout(ui.timer); clearTimeout(ui.mtimer);
    removeEventListener("keydown", ui.onKey, true);
    ui.ro.disconnect(); ui.renderer.dispose();
    ui.root.remove();
    document.body.classList.remove("s3d-on");
    ui = null;
    app.vp && app.vp.request && app.vp.request();
  }
  function buildUI(st) {
    const root = el("div", { class: "s3d clitho", id: "clitho", role: "dialog", "aria-label": "Color Lithophane Studio" });
    const bar = el("div", { class: "s3d-bar" });
    const panes = el("div", { class: "s3d-panes bk-panes" });
    const canvas = el("canvas", { class: "s3d-canvas", id: "clitho-canvas" });
    const flat = el("div", { class: "cl-flat", id: "clitho-flat" });
    const side = el("aside", { class: "bk-side", id: "clitho-side" });
    const status = el("div", { class: "s3d-lab r", id: "clitho-status", style: { right: "10px", left: "auto", top: "auto", bottom: "10px" } }, "");
    const tabs = el("div", { class: "cl-tabs seg", id: "clitho-tabs" });
    const view3 = el("div", { class: "bk-view" }, canvas, flat, tabs, status);
    panes.append(view3, side);
    root.append(bar, panes);
    document.body.append(root);
    document.body.classList.add("s3d-on");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-1, -1.5, 2.5); scene.add(sun);
    const grid = new THREE.GridHelper(400, 40, 0x9aa5b1, 0xc9d1da); grid.rotation.x = Math.PI / 2; scene.add(grid);
    const cam = new THREE.PerspectiveCamera(36, 1, 1, 20000); cam.up.set(0, 0, 1);
    const group = new THREE.Group(); scene.add(group);
    ui = { st, root, bar, side, canvas, flat, tabs, view3, renderer, scene, cam, group, grid, view: { az: -Math.PI / 2.4, el: 0.7, dist: 260, target: new THREE.Vector3() }, raf: 0, dirty: true, pointers: new Map() };
    renderBar(); renderTabs();
    const ro = new ResizeObserver(() => resize()); ro.observe(view3); ui.ro = ro;
    resize(); bindPointers();
    ui.onKey = (e) => { if (!ui) return; if (e.key === "Escape" && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) { close(); e.preventDefault(); e.stopPropagation(); } };
    addEventListener("keydown", ui.onKey, true);
    loop();
  }
  function resize() {
    if (!ui) return;
    const r = ui.view3.getBoundingClientRect();
    ui.renderer.setSize(r.width, r.height, false);
    ui.canvas.style.width = r.width + "px"; ui.canvas.style.height = r.height + "px";
    ui.w = r.width; ui.h = r.height;
    ui.cam.aspect = r.width / Math.max(1, r.height); ui.cam.updateProjectionMatrix();
    ui.dirty = true;
  }
  function loop() {
    if (!ui) return;
    ui.raf = requestAnimationFrame(loop);
    if (!ui.dirty || ui.st.tab !== "model") return;
    ui.dirty = false;
    const v = ui.view, dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el));
    ui.cam.position.copy(v.target).addScaledVector(dir, v.dist); ui.cam.lookAt(v.target);
    ui.renderer.render(ui.scene, ui.cam);
  }
  function bindPointers() {
    const c = ui.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (err) {} ui.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); });
    c.addEventListener("pointermove", (e) => {
      const p = ui.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      const all = [...ui.pointers.values()];
      if (all.length >= 2) { const [a, b] = all, sp = Math.hypot(a.x - b.x, a.y - b.y); if (ui.sp0) ui.view.dist = Math.max(10, Math.min(5000, ui.view.dist * (ui.sp0 / Math.max(1, sp)))); ui.sp0 = sp; }
      else if (p.b === 2 || p.b === 1 || p.shift) { const d = ui.view.dist, k = (2 * d * Math.tan((ui.cam.fov * Math.PI) / 360)) / ui.h; const right = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(ui.cam.matrixWorld, 1); ui.view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); }
      else { ui.view.az -= dx * 0.008; ui.view.el = Math.max(-1.5, Math.min(1.55, ui.view.el + dy * 0.008)); }
      ui.dirty = true;
    });
    const up = (e) => { ui.pointers.delete(e.pointerId); if (ui.pointers.size < 2) ui.sp0 = 0; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => { e.preventDefault(); ui.view.dist = Math.max(10, Math.min(5000, ui.view.dist * Math.exp(e.deltaY * 0.001))); ui.dirty = true; }, { passive: false });
  }
  const setStatus = (t) => { const s = ui && ui.root.querySelector("#clitho-status"); if (s) s.textContent = t; };
  function renderTabs() {
    const st = ui.st;
    ui.tabs.innerHTML = "";
    for (const [v, l, t] of [["light", "Lit from behind", "How it looks with light shining through it"], ["layers", "Colour layers", "The mix of colour layers in each pixel, without the white texture"], ["photo", "Your picture", "The picture as you gave it"], ["model", "3D model", "The parts, one per filament"]])
      ui.tabs.append(el("button", { "aria-pressed": String(st.tab === v), id: "cl-tab-" + v, title: t, onclick: () => { st.tab = v; renderTabs(); show(); } }, l));
  }
  function show() {
    const st = ui.st;
    ui.canvas.style.visibility = st.tab === "model" ? "visible" : "hidden";
    ui.flat.style.display = st.tab === "model" ? "none" : "flex";
    ui.flat.innerHTML = "";
    if (!ui.m) return;
    if (st.tab === "model") { ensureMeshes(); ui.dirty = true; return; }
    let c = ui.m.preview;
    if (st.tab === "photo") c = st.img;
    if (st.tab === "layers") c = layersPicture(ui.m);
    const img = el("canvas", { class: "cl-pic", id: "clitho-pic" });
    img.width = c.width; img.height = c.height; img.getContext("2d").drawImage(c, 0, 0);
    if (st.mirror && st.tab !== "photo") img.title = "Seen from the flat (bed) side, the way it is meant to be looked at";
    ui.flat.append(el("div", { class: "cl-glow" + (st.tab === "light" ? " on" : "") }, img));
  }
  function layersPicture(m) {
    const c = document.createElement("canvas"); c.width = m.nx; c.height = m.ny;
    const g = c.getContext("2d"), d = g.createImageData(m.nx, m.ny);
    for (let k = 0; k < m.nx * m.ny; k++) { if (!m.cIn[k]) continue; const p = m.pal[m.pick[k]].rgb; for (let ch = 0; ch < 3; ch++) d.data[k * 4 + ch] = Math.round(Math.min(1, unlin(p[ch])) * 255); d.data[k * 4 + 3] = 255; }
    g.putImageData(d, 0, 0);
    const big = document.createElement("canvas"); big.width = m.nx * 4; big.height = m.ny * 4;
    const bg = big.getContext("2d"); bg.imageSmoothingEnabled = false; bg.drawImage(c, 0, 0, big.width, big.height);
    return big;
  }
  function recompute(soon) {
    if (!ui) return;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => {
      if (!ui) return;
      const t0 = performance.now();
      try { ui.m = lithoModel(ui.st); ui.parts = null; ui.err = null; } catch (e) { console.error(e); ui.err = e.message; }
      ui.ms = Math.round(performance.now() - t0);
      show(); renderSide();
      if (ui.st.tab === "model") ensureMeshes();
    }, soon ? 220 : 0);
  }
  function ensureMeshes() {
    if (!ui || !ui.m) return null;
    if (!ui.parts) {
      ui.parts = lithoMeshes(ui.m);
      for (const c of [...ui.group.children]) { ui.group.remove(c); c.geometry.dispose(); c.material.dispose(); }
      for (const p of ui.parts) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p.V, 3)); g.setIndex(new THREE.BufferAttribute(p.I, 1)); g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0, transparent: p.key === "T" || p.key === "F", opacity: p.key === "T" ? 0.35 : p.key === "F" ? 0.6 : 1, side: THREE.DoubleSide, flatShading: p.key !== "T" }));
        mesh.userData.key = p.key; ui.group.add(mesh);
      }
      if (!ui.framed) { ui.framed = true; ui.view.dist = Math.max(ui.m.W, ui.m.H) * 1.9; }
      ui.dirty = true;
    }
    return ui.parts;
  }
  function renderBar() {
    const b = ui.bar;
    b.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, label ? el("small", {}, label) : null, ...kids);
    const file = el("input", { type: "file", accept: "image/*", id: "cl-file", style: { display: "none" }, onchange: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) loadPicture(f); } });
    b.append(
      el("div", { class: "s3d-title" }, el("b", {}, "Color Lithophane Studio")),
      grp("Picture", el("div", { style: { display: "flex", gap: "6px" } }, file, el("button", { class: "btn primary", id: "cl-open", onclick: () => file.click() }, "Open picture…"), el("button", { class: "btn", id: "cl-sample", onclick: () => { ui.st.img = sample(); ui.st.name = "Sample"; recompute(); } }, "Sample"))),
      el("span", { class: "s3d-sp" }),
      grp("Export", el("div", { style: { display: "flex", gap: "6px" } },
        el("button", { class: "btn", id: "cl-3mf", title: "One object with a part per filament, set up for Orca Slicer and Bambu Studio", onclick: () => exportFile("3mf") }, "3MF"),
        el("button", { class: "btn", id: "cl-zip", title: "One STL per filament, a preview and a read-me with the settings", onclick: () => exportFile("zip") }, "STLs (ZIP)"))),
      grp("", el("button", { class: "btn", id: "cl-close", onclick: () => close() }, "Close"), el("button", { class: "btn primary", id: "cl-sim", title: "Slice it in the 3D Print Sim: watch the colours go down layer by layer, see the filament changes, and save G-code", onclick: () => toSim() }, "Print in 3D Print Sim")),
    );
  }
  function loadPicture(f) {
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); if (!ui) return; ui.st.img = c; ui.st.name = f.name.replace(/\.[a-z0-9]+$/i, ""); recompute(); };
    im.onerror = () => { URL.revokeObjectURL(url); app.toast("That picture couldn't be opened.", "err"); };
    im.src = url;
  }
  function renderSide() {
    const st = ui.st, s = ui.side, m = ui.m;
    const keep = s.scrollTop;
    s.innerHTML = "";
    const grp = (label, ...kids) => el("div", { class: "s3d-grp" }, el("small", {}, label), ...kids);
    const seg = (id, items, cur, on) => el("div", { class: "seg s3d-seg", id, style: { flexWrap: "wrap" } }, ...items.map(([v, l, t]) => el("button", { "aria-pressed": String(cur === v), title: t || "", onclick: () => on(v) }, l)));
    const set = (k, v) => { st[k] = v; if (k !== "bright" && k !== "contrast") setPref(k, v); recompute(true); };
    const slider = (id, label, k, min, max, step, unit) => {
      const out = el("b", { id: id + "-v" }, st[k] + (unit ? " " + unit : ""));
      const inp = el("input", { type: "range", id, min, max, step, value: st[k], oninput: (e) => { out.textContent = e.target.value + (unit ? " " + unit : ""); set(k, +e.target.value); } });
      return el("label", { class: "sg-sl", style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", alignItems: "center" } }, el("span", {}, label), out, el("span", { style: { gridColumn: "1 / span 2" } }, inp));
    };
    const numIn = (id, label, k, min, max, step, unit) => el("label", { class: "cl-num" }, el("span", {}, label), el("input", { type: "number", class: "num", id, value: st[k], min, max, step, onchange: (e) => { const v = Math.max(min, Math.min(max, +e.target.value || min)); set(k, v); } }), el("i", {}, unit));
    s.append(grp("Size and shape",
      el("div", { class: "cl-row" }, numIn("cl-w", "Width", "w", 20, 300, 1, "mm"), m ? el("span", { class: "cl-note" }, `× ${m.H.toFixed(0)} mm high`) : null),
      seg("cl-shape", SHAPES, st.shape, (v) => set("shape", v)),
      st.shape === "round" ? slider("cl-corner", "Corner radius", "corner", 1, 40, 1, "mm") : null,
      slider("cl-border", "White frame", "border", 0, 10, 0.5, "mm"),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "cl-mirror", checked: st.mirror, onchange: (e) => set("mirror", e.target.checked) }), "Look at it from the flat (bed) side: mirrored to read the right way round")));
    s.append(grp("Picture",
      slider("cl-bright", "Brightness", "bright", -40, 40, 1, ""), slider("cl-contrast", "Contrast", "contrast", -40, 60, 1, ""), slider("cl-sat", "Colour (saturation)", "sat", -50, 80, 1, ""),
      el("label", { class: "check" }, el("input", { type: "checkbox", id: "cl-dither", checked: st.dither, onchange: (e) => set("dither", e.target.checked) }), "Dither: mix neighbouring pixels for smoother colours")));
    // filaments
    const fl = el("div", { class: "cl-fils", id: "cl-fils" });
    st.fils.forEach((f, i) => {
      fl.append(el("div", { class: "cl-fil" + (f.off && !f.fixed ? " off" : "") },
        f.fixed ? el("span", { class: "cl-lock", title: "White is always used: the plate, the texture and the lighter mixes" }, "✓") : el("input", { type: "checkbox", id: "cl-on-" + f.key, checked: !f.off, title: "Use " + f.name, onchange: (e) => { f.off = !e.target.checked; setPref("fils", st.fils); recompute(true); } }),
        el("input", { type: "color", id: "cl-col-" + f.key, value: f.color, title: f.name + "'s colour", onchange: (e) => { f.color = e.target.value; setPref("fils", st.fils); recompute(true); } }),
        el("b", {}, `${i + 1}. ${f.name}`),
        el("label", { class: "cl-td", title: "Transmission distance (TD): how thick this filament must be before almost no light gets through. HueForge lists it for most filaments; measure your own for the best colours." }, "TD", el("input", { type: "number", class: "num", id: "cl-td-" + f.key, value: f.td, min: 0.1, max: 20, step: 0.1, onchange: (e) => { f.td = Math.max(0.1, +e.target.value || f.td); setPref("fils", st.fils); recompute(true); } }), "mm"),
        m ? el("i", { class: "cl-g" }, `${((m.used[m.fils.indexOf(f)] || 0) * 1.24 / 1000).toFixed(1)} g`) : null));
    });
    s.append(grp("Filaments (in AMS / CFS / tool order)", fl, el("button", { class: "linkbtn", id: "cl-reset-fils", onclick: () => { st.fils = LITHO_FILAMENTS.map((f) => ({ ...f })); setPref("fils", st.fils); recompute(); } }, "Back to the usual CMY + white")));
    s.append(grp("Layers",
      el("div", { class: "cl-row" }, el("span", {}, "Layer height"), seg("cl-lh", [[0.08, "0.08"], [0.1, "0.10"], [0.12, "0.12"]], st.lh, (v) => set("lh", v))),
      slider("cl-layers", "Colour layers", "layers", 2, 8, 1, ""),
      slider("cl-cpx", "Colour pixel", "cpx", 0.4, 2, 0.1, "mm"),
      slider("cl-tpx", "Texture pixel", "tpx", 0.2, 1, 0.05, "mm"),
      slider("cl-tmin", "Thinnest white", "tmin", 0.1, 1.2, 0.05, "mm"),
      slider("cl-tmax", "Thickest white", "tmax", 0.8, 4, 0.1, "mm"),
      slider("cl-plate", "Base plate", "plate", 0.1, 0.8, 0.02, "mm")));
    if (m) {
      const nm = m.pal.length, layersTotal = Math.ceil((m.zColor + st.tmax) / st.lh - 1e-6);
      s.append(grp("This lithophane", el("div", { class: "cl-sum", id: "cl-sum" },
        el("div", {}, `${m.W.toFixed(0)} × ${m.H.toFixed(0)} mm, ${(m.zColor + st.tmax).toFixed(1)} mm thick at most`),
        el("div", {}, `${m.nx} × ${m.ny} colour pixels · ${nm} colour mixes from ${m.fils.length} filaments`),
        el("div", {}, `${layersTotal} layers at ${st.lh} mm · ${(m.used.reduce((a, b) => a + b, 0) * 1.24 / 1000).toFixed(1)} g in all`),
        ui.err ? el("div", { class: "err-msg" }, ui.err) : null)));
    }
    s.append(el("div", { class: "hint", style: { padding: "6px 2px" } }, "How it works: the white plate, then a stack of thin cyan, magenta, yellow (and black) layers under each pixel mixes its colour, then a white texture on top sets the brightness, like any lithophane. Print it with a multi-filament printer (AMS, CFS, MMU, tool changer) at one layer height, 100% infill, and shine a light through it."));
    s.scrollTop = keep;
    setStatus(m ? `${m.nx}×${m.ny} colour pixels · worked out in ${ui.ms} ms` : "");
  }
  const baseName = () => ((ui.st.name || "Lithophane") + " color lithophane").replace(/[\\/:*?"<>|]+/g, "").trim();
  async function exportFile(fmt) {
    if (!ui || !ui.m) return;
    const parts = ensureMeshes(), name = baseName(), enc = new TextEncoder();
    let bytes, file;
    if (fmt === "zip") {
      const files = parts.map((p, i) => ({ name: `${i + 1}-${p.name.replace(/\s*\(.*\)/, "").replace(/\s+/g, "-").toLowerCase()}.stl`, data: stlBytes([p]) }));
      const pv = await new Promise((r) => ui.m.preview.toBlob(r, "image/png"));
      files.push({ name: "preview.png", data: new Uint8Array(await pv.arrayBuffer()) }, { name: "read-me.txt", data: enc.encode(readMe(ui.m, name)) });
      bytes = new Uint8Array(await makeZip(files).arrayBuffer()); file = name + ".zip";
    } else { bytes = await threeMF(parts, name, ui.m.fils); file = name + ".3mf"; }
    ui.lastExport = { fmt, size: bytes.length, parts: parts.length };
    if (app.projects && app.projects.saveModel) await app.projects.saveModel(file, bytes);
    app.onExport && app.onExport(fmt);
  }
  function toSim() {
    if (!ui || !ui.m) return;
    const parts = ensureMeshes(), m = ui.m, lh = ui.st.lh, name = baseName();
    const list = parts.map((p) => ({ name: p.name, color: m.fils[p.slot].color, slot: p.slot, V: p.V, I: p.I }));
    const slots = m.fils.map((f) => ({ color: f.color, name: f.name }));
    close();
    if (!app.advanced || !app.advanced.openPrintSimWith) { app.toast("The 3D Print Sim isn't ready yet: try again in a moment.", "err"); return; }
    app.advanced.openPrintSimWith(list, { slots, layer: lh, name, infill: 100 });
  }
  return { open, close, get isOpen() { return !!ui; }, _ui: () => ui, _model: () => ui && ui.m, _parts: () => (ui ? ensureMeshes() : null) };
}
