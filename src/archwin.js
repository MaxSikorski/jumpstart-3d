// Window styles for Architect: the glass area's shape (rectangle, round, arch top, octagon), the
// bars across it (wooden muntins or stained-glass leading, as line segments) and, for stained
// glass, a picture of the coloured pieces. The bars and glass are used by the 3D view, the plan
// pictures, and the shapes sent to Beginner/Advanced.
//
// Everything is in the glass area's own coordinates: x from 0 to W across, y from 0 to H up.

// ---------------------------------------------------------------- the glass area
export function inGlass(shape, W, H, x, y, pad = 0) {
  if (x < pad || x > W - pad || y < pad || y > H - pad) return false;
  if (shape === "round") { const r = Math.min(W, H) / 2 - pad; return (x - W / 2) ** 2 + (y - H / 2) ** 2 <= r * r; }
  if (shape === "arch") { const r = W / 2, yc = H - r; return y <= yc || (x - W / 2) ** 2 + (y - yc) ** 2 <= (r - pad) ** 2; }
  if (shape === "oct") { const r = Math.min(W, H) / 2, cx = W / 2, cy = H / 2, k = r * (2 - Math.SQRT2) * 1.0; return Math.abs(x - cx) + Math.abs(y - cy) <= 2 * r - k - pad * 1.4; }
  return true;
}
// the outline of the glass area as points (counter-clockwise)
export function glassOutline(shape, W, H, n = 48) {
  if (shape === "round") { const r = Math.min(W, H) / 2, P = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; P.push([W / 2 + r * Math.cos(a), H / 2 + r * Math.sin(a)]); } return P; }
  if (shape === "arch") { const r = W / 2, yc = Math.max(0, H - r), P = [[0, 0], [W, 0], [W, yc]]; for (let i = 1; i < n; i++) { const a = (i / n) * Math.PI; P.push([W / 2 + r * Math.cos(a), yc + r * Math.sin(a)]); } P.push([0, yc]); return P; }
  if (shape === "oct") { const r = Math.min(W, H) / 2 / Math.cos(Math.PI / 8), P = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; P.push([W / 2 + r * Math.cos(a), H / 2 + r * Math.sin(a)]); } return P; }
  return [[0, 0], [W, 0], [W, H], [0, H]];
}

// ---------------------------------------------------------------- bars (muntins and leading)
// a long line cut into the pieces that lie inside the glass area
function clipLine(shape, W, H, x0, y0, x1, y1, out) {
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 12));
  let start = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, inside = inGlass(shape, W, H, x, y, 0.5);
    if (inside && !start) start = [x, y];
    if ((!inside || i === n) && start) {
      const e = inside ? [x, y] : [x0 + (x1 - x0) * ((i - 1) / n), y0 + (y1 - y0) * ((i - 1) / n)];
      if (Math.hypot(e[0] - start[0], e[1] - start[1]) > 2) out.push([start[0], start[1], e[0], e[1]]);
      start = null;
    }
  }
}
// a closed curve r(a) around (cx, cy) as segments
function curve(cx, cy, rf, n, out, shape, W, H, a0 = 0, a1 = Math.PI * 2) {
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, r = rf(a), p = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    if (prev && inGlass(shape, W, H, (p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, 0.5)) out.push([prev[0], prev[1], p[0], p[1]]);
    prev = p;
  }
}
// the bars of a style, as segments [x0, y0, x1, y1]
export function windowBars(st, shape, W, H) {
  const out = [];
  if (!st) return out;
  const line = (a, b, c, d) => clipLine(shape, W, H, a, b, c, d, out);
  const R = shape === "arch" ? W / 2 : Math.min(W, H) / 2, yc = shape === "arch" ? H - W / 2 : H / 2, cx = W / 2;
  const p = st.p || {};
  switch (st.pat) {
    case "grid": { const c = p.c || 2, r = p.r || 2; for (let i = 1; i < c; i++) line((W * i) / c, 0, (W * i) / c, H); for (let j = 1; j < r; j++) line(0, (H * j) / r, W, (H * j) / r); break; }
    case "sash": { const c = p.c || 3, r = p.r || 2; line(0, H / 2, W, H / 2); for (const [y0, y1] of [[0, H / 2], [H / 2, H]]) { for (let i = 1; i < c; i++) line((W * i) / c, y0, (W * i) / c, y1); for (let j = 1; j < r; j++) { const y = y0 + ((y1 - y0) * j) / r; line(0, y, W, y); } } break; }
    case "topgrid": { const c = p.c || 3, f = p.f || 0.33; const y0 = H * (1 - f); line(0, y0, W, y0); for (let i = 1; i < c; i++) line((W * i) / c, y0, (W * i) / c, H); break; }
    case "prairie": { const b = Math.min(W, H) * (p.b || 0.14); line(b, 0, b, H); line(W - b, 0, W - b, H); line(0, b, W, b); line(0, H - b, W, H - b); break; }
    case "diamond": { const s = p.s || 120; for (let k = -Math.ceil(H / s); k <= Math.ceil((W + H) / s); k++) { line(k * s, 0, k * s + H, H); line(k * s, 0, k * s - H, H); } break; }
    case "mullion": { const n = p.n || 2; for (let i = 1; i <= n; i++) line((W * i) / (n + 1), 0, (W * i) / (n + 1), H); if (p.transom) line(0, H * p.transom, W, H * p.transom); break; }
    case "radial": { const n = p.n || 12; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; line(cx + R * 0.18 * Math.cos(a), yc + R * 0.18 * Math.sin(a), cx + R * 1.2 * Math.cos(a), yc + R * 1.2 * Math.sin(a)); } for (const f of p.rings || [0.18, 0.55]) curve(cx, yc, () => R * f, 40, out, shape, W, H); break; }
    case "rose": {
      const n = p.n || 12;
      for (const f of [0.16, 0.42, 0.78]) curve(cx, yc, () => R * f, 48, out, shape, W, H);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; line(cx + R * 0.16 * Math.cos(a), yc + R * 0.16 * Math.sin(a), cx + R * 1.1 * Math.cos(a), yc + R * 1.1 * Math.sin(a)); }
      curve(cx, yc, (a) => R * (0.42 + 0.3 * Math.abs(Math.cos((n / 2) * a))), 96, out, shape, W, H); // petals
      break;
    }
    case "sunburst": { // a half-round fan from the bottom middle
      const n = p.n || 9, oy = shape === "arch" ? Math.max(0, H - W / 2) : 0;
      if (oy > 2) line(0, oy, W, oy);
      for (let i = 1; i < n; i++) { const a = (i / n) * Math.PI; line(cx, oy, cx + W * Math.cos(a), oy + W * Math.sin(a)); }
      curve(cx, oy, () => W * 0.16, 24, out, shape, W, H, 0, Math.PI); curve(cx, oy, () => W * 0.36, 32, out, shape, W, H, 0, Math.PI);
      if (oy > 2) for (let i = 1; i < 3; i++) line((W * i) / 3, 0, (W * i) / 3, oy);
      break;
    }
    case "tracery": { // gothic: lancets below and a round light in the arch head
      const yh = shape === "arch" ? H - W / 2 : H * 0.7;
      line(W / 3, 0, W / 3, yh + W * 0.08); line((2 * W) / 3, 0, (2 * W) / 3, yh + W * 0.08); line(0, yh, W, yh);
      curve(cx, yh + W * 0.22, () => W * 0.17, 32, out, shape, W, H);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; line(cx, yh + W * 0.22, cx + W * 0.17 * Math.cos(a), yh + W * 0.22 + W * 0.17 * Math.sin(a)); }
      for (let j = 1; j < 4; j++) line(0, (yh * j) / 4, W, (yh * j) / 4);
      break;
    }
    case "tiffany": { // a flower on a field of slanted pieces
      const fx = W / 2, fy = H * 0.58, fr = Math.min(W, H) * 0.3;
      curve(fx, fy, () => fr * 0.25, 24, out, shape, W, H);
      curve(fx, fy, (a) => fr * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * a))), 90, out, shape, W, H);
      for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i / 5) * Math.PI * 2; line(fx + fr * 0.25 * Math.cos(a), fy + fr * 0.25 * Math.sin(a), fx + fr * Math.cos(a), fy + fr * Math.sin(a)); }
      line(fx, fy - fr, fx, 0); line(fx, H * 0.2, fx - W * 0.22, H * 0.32); line(fx, H * 0.26, fx + W * 0.2, H * 0.36);
      const s = Math.min(W, H) / 4; for (let k = -6; k < 12; k++) line(k * s, 0, k * s + H * 0.5, H);
      break;
    }
    case "deco": { // art deco: border, a centre line and rays from the bottom
      const b = Math.min(W, H) * 0.1; line(b, 0, b, H); line(W - b, 0, W - b, H); line(0, H - b, W, H - b);
      for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; line(cx, 0, cx + 2 * H * Math.cos(a), 2 * H * Math.sin(a)); }
      curve(cx, 0, () => Math.min(W, H) * 0.25, 24, out, shape, W, H, 0, Math.PI);
      break;
    }
    case "mosaic": { const c = p.c || 6, r = Math.max(2, Math.round((c * H) / W)); for (let i = 1; i < c; i++) line((W * i) / c, 0, (W * i) / c, H); for (let j = 1; j < r; j++) line(0, (H * j) / r, W, (H * j) / r); break; }
    case "block": { const s = p.s || 200; for (let x = s; x < W - 1; x += s) line(x, 0, x, H); for (let y = s; y < H - 1; y += s) line(0, y, W, y); break; }
    case "spokes": { const n = p.n || 4; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / 4; line(cx, yc, cx + R * 1.2 * Math.cos(a), yc + R * 1.2 * Math.sin(a)); } break; }
  }
  return out;
}

// ---------------------------------------------------------------- stained glass picture
const PALETTES = {
  cathedral: ["#1f4fb4", "#c8202f", "#e8b923", "#2f8f4f", "#6a2fa0", "#e06a1f", "#1f9aa8", "#b52f7a"],
  tiffany: ["#e9a23b", "#d75a2e", "#f3d36b", "#7fae4b", "#4f8a3c", "#c0d9ef", "#9fc4e8", "#f2ead8"],
  prairie: ["#d8a54a", "#7a9a4a", "#b8402a", "#e8e2c8", "#4f7a8a"],
  ocean: ["#1f6fb4", "#39a0d0", "#7fd0e0", "#e8f4f8", "#2f4f8f", "#5fb8a8"],
  sunset: ["#e8523a", "#f2a23b", "#f3d36b", "#b52f5a", "#6a2f8a", "#e86a8a"],
  clearpanes: ["#d9ecf4", "#e8f3f8", "#cfe5ef"],
};
const cache = new Map();
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
// a canvas: coloured pieces between dark lead lines (the lines are drawn too), see-through outside
export function stainedCanvas(st, shape, W, H, bars) {
  const key = JSON.stringify([st, shape, Math.round(W), Math.round(H)]);
  if (cache.has(key)) return cache.get(key);
  const S = 256, cw = W >= H ? S : Math.max(32, Math.round((S * W) / H)), ch = W >= H ? Math.max(32, Math.round((S * H) / W)) : S;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const g = cv.getContext("2d");
  const sx = cw / W, sy = ch / H;
  // 1. lead lines on a mask
  g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = "#000"; g.lineWidth = Math.max(1.5, (st.lead || 10) * sx); g.lineCap = "round";
  for (const [x0, y0, x1, y1] of bars) { g.beginPath(); g.moveTo(x0 * sx, ch - y0 * sy); g.lineTo(x1 * sx, ch - y1 * sy); g.stroke(); }
  const img = g.getImageData(0, 0, cw, ch), D = img.data;
  const lead = new Uint8Array(cw * ch); for (let i = 0; i < lead.length; i++) lead[i] = D[i * 4] < 128 ? 1 : 0;
  // 2. each piece (connected region between the lines) gets a colour
  const pal = PALETTES[st.palette || "cathedral"], R = rng(st.seed || 7), clear = st.clear ?? 0.15;
  const region = new Int32Array(cw * ch).fill(-1), cols = [];
  const stack = [];
  for (let start = 0; start < lead.length; start++) {
    if (lead[start] || region[start] >= 0) continue;
    const id = cols.length;
    let c = pal[Math.floor(R() * pal.length)];
    if (R() < clear) c = "#e4f1f6";
    cols.push(c);
    region[start] = id; stack.push(start);
    while (stack.length) {
      const q = stack.pop(), x = q % cw, y = (q / cw) | 0;
      for (const nb of [x > 0 ? q - 1 : -1, x < cw - 1 ? q + 1 : -1, y > 0 ? q - cw : -1, y < ch - 1 ? q + cw : -1]) if (nb >= 0 && !lead[nb] && region[nb] < 0) { region[nb] = id; stack.push(nb); }
    }
  }
  const rgb = cols.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  for (let i = 0; i < lead.length; i++) {
    const x = i % cw, y = (i / cw) | 0, wx = (x + 0.5) / sx, wy = (ch - y - 0.5) / sy, j = i * 4;
    if (!inGlass(shape, W, H, wx, wy)) { D[j + 3] = 0; continue; }
    if (lead[i]) { D[j] = 46; D[j + 1] = 46; D[j + 2] = 50; D[j + 3] = 255; continue; }
    const c = rgb[region[i]], n = 0.9 + 0.2 * (((x * 7 + y * 13) % 17) / 17); // a little texture in the glass
    D[j] = Math.min(255, c[0] * n); D[j + 1] = Math.min(255, c[1] * n); D[j + 2] = Math.min(255, c[2] * n); D[j + 3] = 225;
  }
  g.putImageData(img, 0, 0);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  cache.set(key, cv);
  return cv;
}
// a small catalog picture (44 x 40 SVG) for a window style
export function windowIconSVG(P) {
  const shape = P.shape || "rect", st = P.style;
  const W = 28, H = Math.max(12, Math.min(34, (28 * P.h) / P.w)), x0 = 22 - W / 2, y0 = 37 - H;
  const pts = glassOutline(shape, W, H, 24).map(([x, y]) => `${(x0 + x).toFixed(1)},${(y0 + H - y).toFixed(1)}`).join(" ");
  const fill = st && st.stain ? "url(#sg-" + (st.palette || "cathedral") + ")" : "#bfe3f6";
  let s = `<defs><linearGradient id="sg-${st && st.palette || "cathedral"}" x1="0" y1="0" x2="1" y2="1">${(PALETTES[(st && st.palette) || "cathedral"] || PALETTES.cathedral).slice(0, 4).map((c, i) => `<stop offset="${i / 3}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`;
  s += `<polygon points="${pts}" fill="${fill}" stroke="var(--ink-2)" stroke-width="1.4"/>`;
  // the bars at full size, scaled down to the picture
  const k = W / P.w, bars = windowBars(st, shape, P.w, (H / W) * P.w).map((q) => q.map((v) => v * k));
  const lw = st && st.stain ? 0.7 : 1;
  for (const [a, b, c, d] of bars) s += `<line x1="${(x0 + a).toFixed(1)}" y1="${(y0 + H - b).toFixed(1)}" x2="${(x0 + c).toFixed(1)}" y2="${(y0 + H - d).toFixed(1)}" stroke="${st && st.stain ? "#2e2e32" : "var(--ink-2)"}" stroke-width="${lw}"/>`;
  return s;
}
