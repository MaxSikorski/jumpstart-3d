// Laser cut files from flat parts (an acrylic lamp panel, a sign, a stencil…): each body's mesh is
// sliced across its thinnest direction. The slice near the bottom gives the CUT lines (the outline
// and any holes right through); the slice just under the top face gives the ENGRAVE areas
// (recesses cut into the top: text, pictures, lines). Written as SVG (cut: red hairlines,
// engrave: black fill) or DXF (layers CUT and ENGRAVE), in millimetres, parts side by side.
import { writeDXF } from "./dxf.js";

// the loops where a mesh crosses a plane: tri = [ax, ay, az, bx…] in "slice space" (u, v, w):
// the plane is w = h. Returns closed loops of [u, v].
function sliceLoops(tris, h) {
  const segs = [];
  const KEY = (p) => Math.round(p[0] * 1e4) + "," + Math.round(p[1] * 1e4);
  for (let i = 0; i < tris.length; i += 9) {
    const P = [[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]];
    const d = P.map((p) => p[2] - h);
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) { const t = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (pts.length === 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) > 1e-7) segs.push(pts);
  }
  // chain the segments end to end
  const at = new Map();
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = KEY(s[e]); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    for (let guard = 0; guard < segs.length; guard++) {
      const end = loop[loop.length - 1], list = at.get(KEY(end)) || [];
      const j = list.find((q) => !used[q]);
      if (j == null) break;
      used[j] = 1;
      const s = segs[j], same = KEY(s[0]) === KEY(end);
      loop.push(same ? s[1] : s[0]);
      if (KEY(loop[loop.length - 1]) === KEY(loop[0])) break;
    }
    if (loop.length > 3) loops.push(simplify(loop));
  }
  return loops;
}
// drop points that lie on a straight line (keeps files small and lines clean)
function simplify(loop) {
  const out = [];
  const n = loop.length - (Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1]) < 1e-6 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) > 1e-6 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))) out.push(b);
  }
  return out.length >= 3 ? out : loop.slice(0, n);
}
const perim = (L) => L.reduce((s, p, i) => s + Math.hypot(p[0] - L[(i + 1) % L.length][0], p[1] - L[(i + 1) % L.length][1]), 0);
const centroid = (L) => [L.reduce((s, p) => s + p[0], 0) / L.length, L.reduce((s, p) => s + p[1], 0) / L.length];
const sameLoop = (a, b) => Math.abs(perim(a) - perim(b)) < 0.05 * Math.max(1, perim(a) / 50) && Math.hypot(centroid(a)[0] - centroid(b)[0], centroid(a)[1] - centroid(b)[1]) < 0.2;

// items: [{ name, data: { vertices, triangles }, m: THREE.Matrix4 }] -> [{ name, cut, engrave, w, h }]
export function laserParts(items) {
  const parts = [];
  for (const it of items) {
    const M = it.m.elements, P = it.data.vertices, T = it.data.triangles;
    const W = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      W[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
      W[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
      W[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < W.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], W[i + k]); hi[k] = Math.max(hi[k], W[i + k]); }
    const size = [0, 1, 2].map((k) => hi[k] - lo[k]);
    // slice across the thinnest direction; the top is its far side (the face you look at)
    const ax = size.indexOf(Math.min(...size)), [ua, va] = ax === 2 ? [0, 1] : ax === 1 ? [0, 2] : [1, 2];
    const tris = new Float64Array(T.length * 3);
    for (let i = 0; i < T.length; i++) { const j = T[i] * 3; tris[i * 3] = W[j + ua]; tris[i * 3 + 1] = W[j + va]; tris[i * 3 + 2] = W[j + ax]; }
    const t = size[ax], cutH = lo[ax] + t * 0.25, engH = hi[ax] - Math.min(0.15, t * 0.1);
    const cut = sliceLoops(tris, cutH), top = sliceLoops(tris, engH);
    const engrave = top.filter((L) => !cut.some((C) => sameLoop(L, C)));
    // the engraved areas are what the top slice lacks: the loops only the top slice has, filled
    // even-odd (the loops both slices share, like the outline, would cancel out anyway)
    const eng = engrave;
    parts.push({ name: it.name, cut, engrave, engFill: eng, x0: lo[ua], y0: lo[va], w: size[ua], h: size[va], thick: t });
  }
  return parts;
}

// side by side, 5 mm apart, from the origin
function layout(parts) { let x = 0; for (const p of parts) { p.dx = x - p.x0; p.dy = -p.y0; x += p.w + 5; } return { w: Math.max(1, x - 5), h: Math.max(1, ...parts.map((p) => p.h)) }; }

export function laserSVG(parts, title = "laser") {
  const { w, h } = layout(parts);
  const f = (v) => +v.toFixed(3);
  const path = (loops, p) => loops.map((L) => "M" + L.map((q) => f(q[0] + p.dx) + " " + f(h - (q[1] + p.dy))).join("L") + "Z").join("");
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">`, `<title>${esc(title)}</title>`];
  // engrave first (fills), then cut lines on top: most laser software runs layers in this order
  out.push(`<g id="ENGRAVE" fill="#000000" fill-rule="evenodd" stroke="none">`);
  for (const p of parts) if (p.engrave.length) out.push(`<path d="${path(p.engFill, p)}"/>`);
  out.push(`</g>`, `<g id="CUT" fill="none" stroke="#ff0000" stroke-width="0.05">`);
  for (const p of parts) out.push(`<path d="${path(p.cut, p)}"/>`);
  out.push(`</g>`, `</svg>`);
  return out.join("\n");
}

export function laserDXF(parts) {
  layout(parts);
  const cut = [], eng = [];
  for (const p of parts) {
    for (const L of p.cut) cut.push({ t: "poly", pts: L.map((q) => [q[0] + p.dx, q[1] + p.dy]), closed: true });
    for (const L of p.engrave) eng.push({ t: "poly", pts: L.map((q) => [q[0] + p.dx, q[1] + p.dy]), closed: true });
  }
  return writeDXF([{ name: "CUT", curves: cut, dx: 0, dy: 0 }, ...(eng.length ? [{ name: "ENGRAVE", curves: eng, dx: 0, dy: 0 }] : [])]);
}
