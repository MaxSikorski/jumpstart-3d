// Auto trace: turns a picture into sketch outlines.
// 1. brightness of each pixel (see-through parts count as white paper)
// 2. a light blur, then a threshold (picked automatically with Otsu's method) splits it into
//    "ink" and "paper"
// 3. the borders between ink and paper pixels are followed into closed loops
// 4. loops are simplified (fewer points), tiny specks dropped
// 5. each loop becomes straight lines where it is straight or has corners and smooth splines
//    where it curves
// Everything here works in picture pixels (y down); curvesFor maps to sketch coordinates.

// brightness 0..255 per pixel, over white
export function luminance(img) {
  const { data, width: W, height: H } = img, L = new Float32Array(W * H);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    const a = data[j + 3] / 255;
    L[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) * a + 255 * (1 - a);
  }
  return L;
}
function blur(L, W, H) {
  const T = new Float32Array(L.length), O = new Float32Array(L.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = x > 0 ? L[i - 1] : L[i], b = x < W - 1 ? L[i + 1] : L[i];
    T[i] = (a + 2 * L[i] + b) / 4;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = y > 0 ? T[i - W] : T[i], b = y < H - 1 ? T[i + W] : T[i];
    O[i] = (a + 2 * T[i] + b) / 4;
  }
  return O;
}
// the brightness that best splits the picture in two (Otsu)
export function otsu(L) {
  const hist = new Float64Array(256);
  for (let i = 0; i < L.length; i++) hist[Math.max(0, Math.min(255, L[i] | 0))]++;
  const n = L.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 128, bv = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bv) { bv = v; best = t; }
  }
  return best + 0.5;
}

// closed loops along the borders of the "ink" pixels; each point is the middle of a pixel edge
export function contours(mask, W, H) {
  const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  // directed pixel edges with ink on the left: from lattice point (x, y) to the next
  const VW = W + 1, out = new Map(); // start vertex -> list of edge ids
  const ex = [], ey = [], edx = [], edy = [];
  const add = (x, y, dx, dy) => { const id = ex.length; ex.push(x); ey.push(y); edx.push(dx); edy.push(dy); const k = y * VW + x; const l = out.get(k); if (l) l.push(id); else out.set(k, [id]); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    // y grows downward; walking with ink on the left goes counter-clockwise on screen
    if (!ink(x, y - 1)) add(x + 1, y, -1, 0); // top edge, right to left
    if (!ink(x - 1, y)) add(x, y, 0, 1); // left edge, downward
    if (!ink(x, y + 1)) add(x, y + 1, 1, 0); // bottom edge, left to right
    if (!ink(x + 1, y)) add(x + 1, y + 1, 0, -1); // right edge, upward
  }
  const used = new Uint8Array(ex.length), rings = [];
  for (let s = 0; s < ex.length; s++) {
    if (used[s]) continue;
    const ring = [];
    let e = s;
    while (!used[e]) {
      used[e] = 1;
      ring.push([ex[e] + edx[e] / 2, ey[e] + edy[e] / 2]);
      const nx = ex[e] + edx[e], ny = ey[e] + edy[e];
      const cand = out.get(ny * VW + nx);
      if (!cand) break;
      let next = -1;
      if (cand.length === 1) next = cand[0];
      else {
        // two ways on (pixels touching at a corner): keep turning the same way so touching
        // shapes stay separate loops
        for (const c of cand) if (!used[c] && edx[c] === edy[e] && edy[c] === -edx[e]) { next = c; break; }
        if (next < 0) for (const c of cand) if (!used[c]) { next = c; break; }
      }
      if (next < 0) break;
      e = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
// Douglas-Peucker on an open polyline
function dp(P, tol) {
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let bi = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-9 ? Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L : Math.hypot(P[i][0] - ax, P[i][1] - ay);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
// simplify a closed loop: split it at its two farthest-apart points and simplify each half
export function simplifyRing(r, tol) {
  if (r.length < 5) return r.slice();
  let i0 = 0, far = 0;
  for (let i = 0; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > far) { far = d; i0 = i; } }
  let i1 = 0; far = 0;
  for (let i = 0; i < r.length; i++) { const d = (r[i][0] - r[i0][0]) ** 2 + (r[i][1] - r[i0][1]) ** 2; if (d > far) { far = d; i1 = i; } }
  const a = Math.min(i0, i1), b = Math.max(i0, i1);
  const h1 = dp(r.slice(a, b + 1), tol), h2 = dp(r.slice(b).concat(r.slice(0, a + 1)), tol);
  return h1.slice(0, -1).concat(h2.slice(0, -1));
}

// the whole trace, in picture pixels: { rings, threshold, W, H }
// opts: thr (0..255 or null = automatic), part ("dark" | "light"), tol (px), minArea (fraction of the picture)
export function traceImage(img, opts = {}) {
  const W = img.width, H = img.height;
  const L = blur(luminance(img), W, H);
  const thr = opts.thr == null ? otsu(L) : opts.thr;
  const mask = new Uint8Array(W * H);
  const light = opts.part === "light";
  for (let i = 0; i < mask.length; i++) mask[i] = light ? L[i] > thr : L[i] < thr;
  const minA = (opts.minArea ?? 0.002) * W * H;
  let rings = contours(mask, W, H).filter((r) => Math.abs(ringArea(r)) >= Math.max(minA, 2));
  rings = rings.map((r) => simplifyRing(r, opts.tol ?? 1)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= Math.max(minA, 2));
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const max = opts.maxRings ?? 400, dropped = Math.max(0, rings.length - max);
  return { rings: rings.slice(0, max), dropped, threshold: thr, W, H };
}

// sketch curves for traced loops: lines along straight runs and at corners, smooth splines
// (through the points) where a loop curves
export function ringCurves(ring, smooth = true) {
  const n = ring.length, out = [];
  const line = (a, b) => out.push({ t: "line", a, b });
  if (!smooth || n < 4) { for (let i = 0; i < n; i++) line(ring[i], ring[(i + 1) % n]); return out; }
  const segLen = ring.map((p, i) => Math.hypot(ring[(i + 1) % n][0] - p[0], ring[(i + 1) % n][1] - p[1]));
  const sorted = segLen.slice().sort((a, b) => a - b), med = sorted[n >> 1];
  const longSeg = segLen.map((l) => l > med * 3.5 && l > 6);
  const corner = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], q = ring[i], r = ring[(i + 1) % n];
    const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > (40 * Math.PI) / 180 || longSeg[i] || longSeg[(i - 1 + n) % n]) corner[i] = true;
  }
  const first = corner.indexOf(true);
  if (first < 0) { out.push({ t: "spline", pts: ring.slice(), closed: true }); return out; }
  // walk from corner to corner: a straight piece or a long one is a line, a run of short ones a spline
  let i = first;
  do {
    let j = (i + 1) % n;
    const run = [ring[i]];
    while (true) {
      run.push(ring[j]);
      if (corner[j] || longSeg[j] || longSeg[(j - 1 + n) % n] || j === first) break;
      j = (j + 1) % n;
    }
    if (run.length === 2) line(run[0], run[1]);
    else out.push({ t: "spline", pts: run, closed: false });
    i = j;
  } while (i !== first);
  return out;
}

// map picture pixels onto the sketch picture (center cx, cy; size w x h; turned rot degrees)
export function pixelToSketch(im, W, H) {
  const r = ((im.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (p) => {
    const x = (p[0] / W - 0.5) * im.w, y = (0.5 - p[1] / H) * im.h;
    return [(im.cx || 0) + x * c - y * s, (im.cy || 0) + x * s + y * c];
  };
}
export function curvesFor(trace, im, smooth = true) {
  const T = pixelToSketch(im, trace.W, trace.H), out = [];
  for (const ring of trace.rings) for (const c of ringCurves(ring, smooth)) {
    if (c.t === "line") out.push({ t: "line", a: T(c.a), b: T(c.b) });
    else out.push({ t: "spline", pts: c.pts.map(T), closed: c.closed });
  }
  return out;
}
