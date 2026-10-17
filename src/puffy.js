// Picture → puffy 3D model. Not an AI reconstruction: it cuts the subject out of the picture,
// then "inflates" its outline into a rounded, closed solid (like blowing up a balloon shaped
// like the outline), optionally with a little surface relief from the picture's shading. The
// picture is then painted on (see media.js), so from the front it looks like the photo.
// Everything works on plain pixel arrays, so it is quick and runs offline.

// ---- 1. what is the subject?
// "auto": the colors along the picture's border are taken as the background; anything that
// differs (by more than the sensitivity) and is not reachable from the border through background
// is the subject. "dark" / "light": a brightness threshold, like Auto trace.
export function subjectMask(img, opts = {}) {
  const { data, width: W, height: H } = img, n = W * H;
  const mode = opts.mode || "auto";
  const bgLike = new Uint8Array(n);
  if (mode === "auto") {
    // background colors: the common colors along the border (coarse bins)
    const bins = new Map(), border = [];
    const push = (x, y) => { const j = (y * W + x) * 4; if (data[j + 3] < 128) return; border.push(j); const k = (data[j] >> 4) * 256 + (data[j + 1] >> 4) * 16 + (data[j + 2] >> 4); bins.set(k, (bins.get(k) || 0) + 1); };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { push(0, y); push(W - 1, y); }
    const total = Math.max(1, border.length), cols = [];
    for (const [k, c] of [...bins].sort((a, b) => b[1] - a[1])) {
      if (c / total < 0.03 && cols.length) break;
      // the average color of that bin
      let r = 0, g = 0, b = 0, m = 0;
      for (const j of border) { const kk = (data[j] >> 4) * 256 + (data[j + 1] >> 4) * 16 + (data[j + 2] >> 4); if (kk === k) { r += data[j]; g += data[j + 1]; b += data[j + 2]; m++; } }
      cols.push([r / m, g / m, b / m]);
      if (cols.length >= 6) break;
    }
    const thr = 12 + (opts.sens ?? 30) * 1.6; // color distance
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (data[j + 3] < 128) { bgLike[i] = 1; continue; }
      let best = 1e9;
      for (const c of cols) { const dr = data[j] - c[0], dg = data[j + 1] - c[1], db = data[j + 2] - c[2]; const d = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7; if (d < best) best = d; }
      bgLike[i] = best < thr ? 1 : 0;
    }
  } else {
    const L = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const a = data[j + 3] / 255; L[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) * a + 255 * (1 - a); }
    const thr = opts.thr ?? 128;
    for (let i = 0; i < n; i++) bgLike[i] = (mode === "dark" ? L[i] >= thr : L[i] <= thr) ? 1 : 0;
  }
  // background = background-like pixels connected to the border
  const bg = new Uint8Array(n), stack = [];
  const seed = (i) => { if (bgLike[i] && !bg[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W);
  }
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = bg[i] ? 0 : 1;
  // smooth the edge a little (blur + threshold), keep the biggest piece, fill its holes
  mask = smoothMask(mask, W, H, opts.smooth ?? 2);
  mask = largestPiece(mask, W, H);
  mask = fillHoles(mask, W, H);
  return mask;
}
function smoothMask(m, W, H, passes) {
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
export function largestPiece(m, W, H) {
  const lab = new Int32Array(m.length).fill(-1), sizes = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const id = sizes.length, st = [s]; lab[s] = id; let c = 0;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0; c++;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && m[j] && lab[j] < 0) { lab[j] = id; st.push(j); }
    }
    sizes.push(c);
  }
  if (!sizes.length) return new Uint8Array(m.length);
  const best = sizes.indexOf(Math.max(...sizes)), out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}
function fillHoles(m, W, H) {
  const out = new Uint8Array(m.length).fill(1), st = [];
  const seed = (i) => { if (!m[i] && out[i]) { out[i] = 0; st.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W); }
  return out;
}
// the subject's bounding box in pixels (or null)
export function maskBox(m, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// ---- 2. how far is each pixel from the edge? (exact Euclidean distance, Felzenszwalb)
function edt1(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { const r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; }
  return d;
}
export function distanceInside(m, W, H) {
  const INF = 1e12, g = new Float64Array(W * H);
  for (let i = 0; i < m.length; i++) g[i] = m[i] ? INF : 0;
  const col = new Float64Array(H);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) col[y] = g[y * W + x]; const d = edt1(col, H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  const row = new Float64Array(W), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) row[x] = g[y * W + x]; const d = edt1(row, W); for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]); }
  return out;
}

// ---- 3. the inflated solid
// img: the picture (pixels), mask: subject mask (same size). Options:
//   height (mm, of the subject), puff (0.3..1.5: how thick / round), detail (0..1: relief from
//   the picture's shading), res (grid cells along the long side).
// Returns { V, I } (mm, Z up, standing on z = 0, centered on x / y; the picture faces -Y,
// i.e. the Front view) plus the subject's box in the picture (0..1) for painting.
export function inflate(img, mask, opts = {}) {
  const W = img.width, H = img.height;
  const box = maskBox(mask, W, H);
  if (!box) throw new Error("Nothing to build: the picture's subject wasn't found. Try the other cut-out settings.");
  // a grid over the subject's box (with a 1-cell empty margin)
  const res = opts.res || 110;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const step = Math.max(bw, bh) / res;
  const GW = Math.max(3, Math.ceil(bw / step) + 2), GH = Math.max(3, Math.ceil(bh / step) + 2);
  const sample = (gx, gy) => { // pixel under a grid point
    const px = Math.min(W - 1, Math.max(0, Math.floor(box.x0 + (gx - 1 + 0.5) * step))), py = Math.min(H - 1, Math.max(0, Math.floor(box.y0 + (gy - 1 + 0.5) * step)));
    return py * W + px;
  };
  let gm = new Uint8Array(GW * GH);
  for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) gm[gy * GW + gx] = mask[sample(gx, gy)];
  gm = largestPiece(gm, GW, GH);
  // cells (squares between 4 grid points) that are fully inside; then make sure no two cells
  // meet only at a corner (that would pinch the surface), and keep the biggest piece
  const CW = GW - 1, CH = GH - 1;
  let cell = new Uint8Array(CW * CH);
  const setCells = () => { for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) cell[y * CW + x] = gm[y * GW + x] && gm[y * GW + x + 1] && gm[(y + 1) * GW + x] && gm[(y + 1) * GW + x + 1] ? 1 : 0; };
  setCells();
  for (let pass = 0; pass < 6; pass++) {
    let fixed = 0;
    for (let y = 0; y < CH - 1; y++) for (let x = 0; x < CW - 1; x++) {
      const a = cell[y * CW + x], b = cell[y * CW + x + 1], c = cell[(y + 1) * CW + x], d = cell[(y + 1) * CW + x + 1];
      if ((a && d && !b && !c) || (b && c && !a && !d)) { // fill one of the two missing cells
        const fx = a && d ? x + 1 : x, fy = y;
        gm[fy * GW + fx] = gm[fy * GW + fx + 1] = gm[(fy + 1) * GW + fx] = gm[(fy + 1) * GW + fx + 1] = 1; fixed++;
      }
    }
    setCells();
    if (!fixed) break;
  }
  cell = largestPiece(cell, CW, CH);
  // corners shared by cells only diagonally can still remain at single grid points: open them up
  // by checking the 4 cells around each grid point
  for (let pass = 0; pass < 6; pass++) {
    let fixed = 0;
    for (let y = 1; y < CH; y++) for (let x = 1; x < CW; x++) {
      const a = cell[(y - 1) * CW + x - 1], b = cell[(y - 1) * CW + x], c = cell[y * CW + x - 1], d = cell[y * CW + x];
      if ((a && d && !b && !c) || (b && c && !a && !d)) { if (a && d) cell[(y - 1) * CW + x] = 1; else cell[(y - 1) * CW + x - 1] = 1; fixed++; }
    }
    if (!fixed) break;
  }
  // grid points used by the cells
  const used = new Uint8Array(GW * GH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (cell[y * CW + x]) { used[y * GW + x] = used[y * GW + x + 1] = used[(y + 1) * GW + x] = used[(y + 1) * GW + x + 1] = 1; }
  // inflate: rounded cross-section from the distance to the outline
  const dist = distanceInside(used, GW, GH);
  let R = 0; for (let i = 0; i < dist.length; i++) if (dist[i] > R) R = dist[i];
  R = Math.max(1, R);
  const puff = opts.puff ?? 0.8, detail = opts.detail ?? 0.25;
  // relief from shading: darker than the surroundings sinks a little (eyes, lines)
  const lum = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) { const j = sample(gx, gy) * 4; lum[gy * GW + gx] = (0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]) / 255; }
  const blurL = boxBlur(lum, GW, GH, 4);
  let h = new Float32Array(GW * GH);
  for (let i = 0; i < h.length; i++) {
    if (!used[i]) continue;
    // a round cross-section that closes to a thin seam at the outline
    const t = Math.min(1, Math.max(0, dist[i] - 1) / Math.max(1, R - 1));
    const round = Math.sqrt(Math.max(0, t * (2 - t)));
    const relief = detail * (lum[i] - blurL[i]) * 0.9 * Math.min(1, (dist[i] - 1) / 3);
    h[i] = Math.max(0.03, round + Math.max(-0.5 * round, relief));
  }
  // a couple of smoothing passes (inside only)
  for (let p = 0; p < 2; p++) {
    const g = h.slice();
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
      const i = y * GW + x; if (!used[i]) continue;
      let s = h[i] * 2, c = 2;
      for (const j of [i - 1, i + 1, i - GW, i + GW]) if (used[j]) { s += h[j]; c++; }
      g[i] = s / c;
    }
    h = g;
  }
  // size: the subject's height in the picture becomes opts.height mm
  const mmPerCell = (opts.height || 60) / Math.max(1, bh / step);
  const depth = R * mmPerCell * puff; // half-thickness at the thickest point
  const cx = (GW - 1) / 2;
  // vertices: front (y < 0) and back (y > 0) for every used grid point
  const fId = new Int32Array(GW * GH).fill(-1), bId = new Int32Array(GW * GH).fill(-1);
  const V = [];
  let zTop = -Infinity;
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx; if (!used[i]) continue;
    const X = (gx - cx) * mmPerCell, Z = (GH - 1 - gy) * mmPerCell, Y = h[i] * depth;
    fId[i] = V.length / 3; V.push(X, -Y, Z);
    bId[i] = V.length / 3; V.push(X, Y, Z);
    if (Z > zTop) zTop = Z;
  }
  const I = [];
  const edgeCount = new Map(), key = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const addE = (a, b) => { const k = key(a, b); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); };
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (!cell[y * CW + x]) continue;
    const p00 = y * GW + x, p10 = p00 + 1, p01 = p00 + GW, p11 = p01 + 1;
    // front faces the camera at -Y: counter-clockwise seen from there
    I.push(fId[p00], fId[p01], fId[p10], fId[p10], fId[p01], fId[p11]);
    I.push(bId[p00], bId[p10], bId[p01], bId[p10], bId[p11], bId[p01]);
    addE(p00, p10); addE(p10, p11); addE(p11, p01); addE(p01, p00);
  }
  // the rim: join front and back along every outline edge (each used by one cell only)
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (!cell[y * CW + x]) continue;
    const p00 = y * GW + x, p10 = p00 + 1, p01 = p00 + GW, p11 = p01 + 1;
    // the cell's edges in its front winding order (p00 → p01 → p11 → p10 → p00)
    for (const [a, b] of [[p00, p01], [p01, p11], [p11, p10], [p10, p00]]) {
      if (edgeCount.get(key(a, b)) !== 1) continue;
      // front a→b is used by the cell; the rim quad runs b→a on the front, a→b on the back
      I.push(fId[b], fId[a], bId[a], fId[b], bId[a], bId[b]);
    }
  }
  // smooth the outline (the grid makes it stair-stepped): slide each rim point toward the middle
  // of its two rim neighbours a few times; front and back rim points move together
  const nb = new Map();
  const link = (a, b) => { (nb.get(a) || nb.set(a, []).get(a)).push(b); };
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (!cell[y * CW + x]) continue;
    const p00 = y * GW + x, p10 = p00 + 1, p01 = p00 + GW, p11 = p01 + 1;
    for (const [a, b] of [[p00, p01], [p01, p11], [p11, p10], [p10, p00]]) if (edgeCount.get(key(a, b)) === 1) { link(a, b); link(b, a); }
  }
  for (let it = 0; it < 6; it++) {
    const moved = [];
    for (const [p, ns] of nb) {
      if (ns.length !== 2) continue;
      const f = fId[p] * 3, a = fId[ns[0]] * 3, c = fId[ns[1]] * 3;
      moved.push([p, 0.5 * V[f] + 0.25 * (V[a] + V[c]), 0.5 * V[f + 2] + 0.25 * (V[a + 2] + V[c + 2])]);
    }
    for (const [p, X, Z] of moved) { const f = fId[p] * 3, bk = bId[p] * 3; V[f] = V[bk] = X; V[f + 2] = V[bk + 2] = Z; }
  }
  // drop to the floor and center
  let zMin = Infinity; for (let i = 2; i < V.length; i += 3) zMin = Math.min(zMin, V[i]);
  for (let i = 2; i < V.length; i += 3) V[i] -= zMin;
  // the subject's box in the picture, as fractions (for painting the picture on)
  const crop = [box.x0 / W, box.y0 / H, box.x1 / W, box.y1 / H];
  // the subject's average color (for the unpainted look)
  let r = 0, g = 0, b = 0, m = 0;
  for (let i = 0, j = 0; i < W * H; i++, j += 4) if (mask[i]) { r += img.data[j]; g += img.data[j + 1]; b += img.data[j + 2]; m++; }
  const hex = (v) => Math.round(v / Math.max(1, m)).toString(16).padStart(2, "0");
  return { V: new Float32Array(V), I: new Uint32Array(I), crop, color: "#" + hex(r) + hex(g) + hex(b), size: [(GW - 1) * mmPerCell, 2 * depth, zTop - zMin] };
}
function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let x = -r; x < W + r; x++) { const add = x + r, rem = x - r - 1; if (add < W && add >= 0) { s += a[y * W + add]; c++; } if (rem >= 0 && rem < W) { s -= a[y * W + rem]; c--; } if (x >= 0 && x < W) t[y * W + x] = s / Math.max(1, c); } }
  for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let y = -r; y < H + r; y++) { const add = y + r, rem = y - r - 1; if (add < H && add >= 0) { s += t[add * W + x]; c++; } if (rem >= 0 && rem < H) { s -= t[rem * W + x]; c--; } if (y >= 0 && y < H) o[y * W + x] = s / Math.max(1, c); } }
  return o;
}

// is the mesh closed (every edge shared by exactly two triangles, in opposite directions)?
export function checkClosed({ I }) {
  const m = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; const key = a + "," + b; m.set(key, (m.get(key) || 0) + 1); }
  let open = 0, bad = 0;
  for (const [k, c] of m) { const [a, b] = k.split(","); const r = m.get(b + "," + a) || 0; if (c > 1) bad++; if (r !== c) open++; }
  return { open, bad };
}
