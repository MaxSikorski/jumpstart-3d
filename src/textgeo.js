// Text outlines on the main thread (for drawing and picking sketch text).
// The kernel builds the exact solid from the same fonts.
import opentype from "opentype.js";
import { fontBytes } from "./fonts.js";
import { pointInPoly, polyArea } from "./regions.js";

const fonts = {};
export function getFont(name) {
  const n = ["sans", "serif", "mono"].includes(name) ? name : "sans";
  if (!fonts[n]) fonts[n] = opentype.parse(fontBytes(n));
  return fonts[n];
}

const cache = new Map();
// Closed polylines (sketch coordinates) for a text spec {str, size, x, y, angle, font}
export function textContours(t) {
  const key = JSON.stringify([t.str, t.size, t.x, t.y, t.angle, t.font]);
  if (cache.has(key)) return cache.get(key);
  const font = getFont(t.font);
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fontSize = Math.max(0.01, t.size || 10) * font.unitsPerEm / cap;
  const path = font.getPath(String(t.str || ""), 0, 0, fontSize);
  const ang = ((t.angle || 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const X = (x, y) => [(t.x || 0) + x * ca - -y * sa, (t.y || 0) + x * sa + -y * ca];
  const contours = [];
  let cur = null, lx = 0, ly = 0;
  for (const c of path.commands) {
    if (c.type === "M") { if (cur && cur.length > 2) contours.push(cur); cur = [X(c.x, c.y)]; lx = c.x; ly = c.y; }
    else if (c.type === "L") { cur.push(X(c.x, c.y)); lx = c.x; ly = c.y; }
    else if (c.type === "Q") {
      for (let i = 1; i <= 6; i++) {
        const s = i / 6, a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, d = s * s;
        cur.push(X(a * lx + b * c.x1 + d * c.x, a * ly + b * c.y1 + d * c.y));
      }
      lx = c.x; ly = c.y;
    } else if (c.type === "C") {
      for (let i = 1; i <= 8; i++) {
        const s = i / 8, a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, e = 3 * (1 - s) * s * s, d = s ** 3;
        cur.push(X(a * lx + b * c.x1 + e * c.x2 + d * c.x, a * ly + b * c.y1 + e * c.y2 + d * c.y));
      }
      lx = c.x; ly = c.y;
    } else if (c.type === "Z") { if (cur && cur.length > 2) contours.push(cur); cur = null; }
  }
  if (cur && cur.length > 2) contours.push(cur);
  cache.set(key, contours);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return contours;
}

// Group contours into filled shapes with holes (even-odd nesting)
export function textShapes(t) {
  const cs = textContours(t);
  const depth = cs.map((c, i) => cs.reduce((n, o, j) => (j !== i && pointInPoly(c[0], o) ? n + 1 : n), 0));
  const shapes = [];
  cs.forEach((c, i) => { if (depth[i] % 2 === 0) shapes.push({ outer: c, holes: [], d: depth[i] }); });
  cs.forEach((c, i) => {
    if (depth[i] % 2 === 0) return;
    // the innermost outer contour containing this hole
    let best = null;
    for (const s of shapes) if (s.d === depth[i] - 1 && pointInPoly(c[0], s.outer) && (!best || Math.abs(polyArea(s.outer)) < Math.abs(polyArea(best.outer)))) best = s;
    if (best) best.holes.push(c);
  });
  return shapes;
}

export function textBounds(t) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of textContours(t)) for (const p of c) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  if (!isFinite(minX)) { const x = t.x || 0, y = t.y || 0; return { minX: x, minY: y, maxX: x + (t.size || 10), maxY: y + (t.size || 10) }; }
  return { minX, minY, maxX, maxY };
}
