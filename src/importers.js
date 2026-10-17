// SVG and DXF import: turn drawings into sketch curves (lines, arcs, circles, splines).
// Coordinates come out in millimetres with Y up.

// ------------------------------------------------------------------ SVG
const MM_PER = { px: 25.4 / 96, pt: 25.4 / 72, pc: 25.4 / 6, in: 25.4, cm: 10, mm: 1, q: 0.25 };
function lenMM(v) {
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v || "");
  if (!m || m[2] === "%") return null;
  return +m[1] * (MM_PER[(m[2] || "px").toLowerCase()] || MM_PER.px);
}
function pathCommands(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)/gi;
  let m, cur = null;
  while ((m = re.exec(d))) {
    if (m[1]) { cur = { c: m[1], n: [] }; out.push(cur); }
    else if (cur) cur.n.push(+m[2]);
  }
  return out;
}
// sample a cubic Bezier
const cub = (p0, p1, p2, p3, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; };
// SVG arc to points (endpoint parameterisation)
function arcPoints(p0, rx, ry, phi, large, sweep, p1, n = 12) {
  if (!rx || !ry) return [p1];
  const c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sg = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = sg * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(dt) / (2 * Math.PI)) * n * 2));
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = t1 + (dt * i) / steps;
    pts.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]);
  }
  pts[pts.length - 1] = p1;
  return pts;
}
// One SVG subpath -> curves. Straight segments stay lines; runs of curves become splines.
function subpathCurves(segs, closed, out) {
  // segs: [{kind:'line'|'curve', pts:[...points after the start]}], with a start point
  let run = null;
  const flush = () => { if (run && run.length >= 2) out.push({ t: "spline", pts: run }); run = null; };
  for (const s of segs) {
    if (s.kind === "line") { flush(); out.push({ t: "line", a: s.from, b: s.to }); }
    else { if (!run) run = [s.from]; run.push(...s.pts); }
  }
  if (closed && run && segs.every((s) => s.kind === "curve")) {
    // a fully curved closed shape: one closed spline
    const pts = run.slice(0, -1);
    out.push({ t: "spline", pts, closed: true });
    run = null;
  }
  flush();
}
export function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") throw new Error("That file doesn't look like an SVG drawing.");
  // put it on the page (out of sight) so the browser works out every transform
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden";
  const svg = document.importNode(root, true);
  host.append(svg);
  document.body.append(host);
  try {
    // mm per user unit
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const wmm = lenMM(svg.getAttribute("width"));
    let unit = MM_PER.px;
    if (vb.length === 4 && vb[2] > 0 && wmm) unit = wmm / vb[2];
    const rootInv = svg.getScreenCTM() ? svg.getScreenCTM().inverse() : null;
    const curves = [];
    const els = svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon");
    for (const el of els) {
      if (el.closest("defs, clipPath, mask, symbol, marker, pattern")) continue;
      const ctm = el.getScreenCTM && el.getScreenCTM();
      const M = ctm && rootInv ? rootInv.multiply(ctm) : null;
      const T = (p) => {
        const x = M ? M.a * p[0] + M.c * p[1] + M.e : p[0];
        const y = M ? M.b * p[0] + M.d * p[1] + M.f : p[1];
        return [x * unit, -y * unit]; // Y up
      };
      const uniform = !M || (Math.abs(Math.hypot(M.a, M.b) - Math.hypot(M.c, M.d)) < 1e-9 && Math.abs(M.a * M.c + M.b * M.d) < 1e-9);
      const scale = M ? Math.hypot(M.a, M.b) : 1;
      const tag = el.nodeName.toLowerCase();
      const num = (a) => parseFloat(el.getAttribute(a)) || 0;
      const segsOut = [];
      if (tag === "line") { segsOut.push({ t: "line", a: T([num("x1"), num("y1")]), b: T([num("x2"), num("y2")]) }); }
      else if (tag === "rect") {
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        if (w > 0 && h > 0) { const P = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(T); for (let i = 0; i < 4; i++) segsOut.push({ t: "line", a: P[i], b: P[(i + 1) % 4] }); }
      } else if (tag === "circle" || tag === "ellipse") {
        const cx = num("cx"), cy = num("cy"), rx = tag === "circle" ? num("r") : num("rx"), ry = tag === "circle" ? num("r") : num("ry");
        if (rx > 0 && ry > 0) {
          if (Math.abs(rx - ry) < 1e-9 && uniform) segsOut.push({ t: "circle", c: T([cx, cy]), r: rx * scale * unit });
          else { const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(T([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])); } segsOut.push({ t: "spline", pts, closed: true }); }
        }
      } else if (tag === "polyline" || tag === "polygon") {
        const n = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
        const P = [];
        for (let i = 0; i + 1 < n.length; i += 2) P.push(T([n[i], n[i + 1]]));
        for (let i = 0; i < P.length - 1; i++) segsOut.push({ t: "line", a: P[i], b: P[i + 1] });
        if (tag === "polygon" && P.length > 2) segsOut.push({ t: "line", a: P[P.length - 1], b: P[0] });
      } else if (tag === "path") {
        let cur = [0, 0], start = [0, 0], lastCtrl = null, lastQ = null, segs = [], startW = null;
        const finish = (closed) => { if (segs.length) subpathCurves(segs, closed, segsOut); segs = []; };
        for (const { c, n } of pathCommands(el.getAttribute("d") || "")) {
          const rel = c === c.toLowerCase(), C = c.toUpperCase();
          const P = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
          let i = 0;
          const take = (k) => { const v = n.slice(i, i + k); i += k; return v; };
          do {
            if (C === "M") { finish(false); const [x, y] = take(2); cur = P(x, y); start = cur; startW = T(cur); lastCtrl = lastQ = null; c === "m" || c === "M"; if (n.length > 2) { /* implicit lineTo */ } }
            else if (C === "Z") { if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) segs.push({ kind: "line", from: T(cur), to: T(start) }); cur = start; finish(true); lastCtrl = lastQ = null; break; }
            else if (C === "L") { const [x, y] = take(2); const p = P(x, y); segs.push({ kind: "line", from: T(cur), to: T(p) }); cur = p; lastCtrl = lastQ = null; }
            else if (C === "H") { const [x] = take(1); const p = rel ? [cur[0] + x, cur[1]] : [x, cur[1]]; segs.push({ kind: "line", from: T(cur), to: T(p) }); cur = p; lastCtrl = lastQ = null; }
            else if (C === "V") { const [y] = take(1); const p = rel ? [cur[0], cur[1] + y] : [cur[0], y]; segs.push({ kind: "line", from: T(cur), to: T(p) }); cur = p; lastCtrl = lastQ = null; }
            else if (C === "C" || C === "S") {
              let c1;
              if (C === "C") { const [x1, y1] = take(2); c1 = P(x1, y1); }
              else c1 = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
              const [x2, y2, x, y] = take(4); const c2 = P(x2, y2), p = P(x, y);
              const pts = []; for (let k = 1; k <= 4; k++) pts.push(T(cub(cur, c1, c2, p, k / 4)));
              segs.push({ kind: "curve", from: T(cur), pts }); cur = p; lastCtrl = c2; lastQ = null;
            } else if (C === "Q" || C === "T") {
              let q;
              if (C === "Q") { const [x1, y1] = take(2); q = P(x1, y1); }
              else q = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur;
              const [x, y] = take(2); const p = P(x, y);
              const c1 = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], c2 = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
              const pts = []; for (let k = 1; k <= 3; k++) pts.push(T(cub(cur, c1, c2, p, k / 3)));
              segs.push({ kind: "curve", from: T(cur), pts }); cur = p; lastQ = q; lastCtrl = null;
            } else if (C === "A") {
              const [rx, ry, rot, la, sw, x, y] = take(7); const p = P(x, y);
              const pts = arcPoints(cur, rx, ry, (rot * Math.PI) / 180, !!la, !!sw, p).map(T);
              segs.push({ kind: "curve", from: T(cur), pts }); cur = p; lastCtrl = lastQ = null;
            } else break;
            // after M, extra coordinate pairs are implicit L
            if (C === "M" && i < n.length) { while (i + 1 < n.length) { const [x, y] = take(2); const p = P(x, y); segs.push({ kind: "line", from: T(cur), to: T(p) }); cur = p; } }
          } while (i < n.length && C !== "Z");
        }
        finish(false);
        void startW;
      }
      curves.push(...segsOut);
    }
    if (!curves.length) throw new Error("No shapes were found in that SVG (text has to be converted to paths first).");
    return curves;
  } finally { host.remove(); }
}

// ------------------------------------------------------------------ DXF
const DXF_UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };
function dxfPairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return out;
}
// bulge arc between two polyline points
function bulgeArc(p1, p2, b) {
  const th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
  if (d < 1e-12) return null;
  const m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], nrm = [-dy / d, dx / d];
  const off = d / 2 / Math.tan(th / 2);
  const c = [m[0] + nrm[0] * off, m[1] + nrm[1] * off];
  return b > 0 ? { t: "arc", c, a: p1, b: p2 } : { t: "arc", c, a: p2, b: p1 };
}
// B-spline evaluation (de Boor) for DXF SPLINE without fit points
function deBoor(k, x, t, c, p) {
  const d = [];
  for (let j = 0; j <= p; j++) d.push([...c[j + k - p]]);
  for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
    const den = t[j + 1 + k - r] - t[j + k - p];
    const a = den ? (x - t[j + k - p]) / den : 0;
    d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * (d[j - 1][2] ?? 1) + a * (d[j][2] ?? 1)];
  }
  return d[p];
}
export function parseDXF(text) {
  const P = dxfPairs(text);
  let unit = 1;
  for (let i = 0; i < P.length; i++) if (P[i][0] === 9 && P[i][1] === "$INSUNITS") { const u = +(P[i + 1] || [0, 0])[1]; if (DXF_UNITS[u]) unit = DXF_UNITS[u]; }
  // collect entities in the ENTITIES section
  let i = P.findIndex((p, k) => p[0] === 2 && p[1] === "ENTITIES" && P[k - 1] && P[k - 1][1] === "SECTION");
  if (i < 0) throw new Error("No drawing entities were found in that DXF.");
  const ents = [];
  let cur = null;
  for (i = i + 1; i < P.length; i++) {
    const [code, val] = P[i];
    if (code === 0) {
      if (val === "ENDSEC") break;
      cur = { type: val, g: [] };
      ents.push(cur);
    } else if (cur) cur.g.push([code, val]);
  }
  const S = (p) => [p[0] * unit, p[1] * unit];
  const curves = [];
  const val = (e, code, def = 0) => { const f = e.g.find((x) => x[0] === code); return f ? +f[1] : def; };
  let poly = null; // old-style POLYLINE being collected
  let skipped = 0;
  const addPoly = (pts, closed) => {
    for (let k = 0; k < pts.length - (closed ? 0 : 1); k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      if (Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 1e-9) continue;
      if (Math.abs(a.b) > 1e-9) { const arc = bulgeArc(S(a.p), S(b.p), a.b); if (arc) curves.push(arc); }
      else curves.push({ t: "line", a: S(a.p), b: S(b.p) });
    }
  };
  for (const e of ents) {
    const t = e.type;
    if (t === "LINE") curves.push({ t: "line", a: S([val(e, 10), val(e, 20)]), b: S([val(e, 11), val(e, 21)]) });
    else if (t === "CIRCLE") curves.push({ t: "circle", c: S([val(e, 10), val(e, 20)]), r: val(e, 40) * unit });
    else if (t === "ARC") {
      const c = [val(e, 10), val(e, 20)], r = val(e, 40), a0 = (val(e, 50) * Math.PI) / 180, a1 = (val(e, 51) * Math.PI) / 180;
      curves.push({ t: "arc", c: S(c), a: S([c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)]), b: S([c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)]) });
    } else if (t === "LWPOLYLINE") {
      const pts = [];
      for (const [code, v] of e.g) {
        if (code === 10) pts.push({ p: [+v, 0], b: 0 });
        else if (code === 20 && pts.length) pts[pts.length - 1].p[1] = +v;
        else if (code === 42 && pts.length) pts[pts.length - 1].b = +v;
      }
      addPoly(pts, (val(e, 70) & 1) === 1);
    } else if (t === "POLYLINE") poly = { pts: [], closed: (val(e, 70) & 1) === 1 };
    else if (t === "VERTEX" && poly) poly.pts.push({ p: [val(e, 10), val(e, 20)], b: val(e, 42) });
    else if (t === "SEQEND" && poly) { addPoly(poly.pts, poly.closed); poly = null; }
    else if (t === "SPLINE") {
      const fit = [], ctrl = [], knots = [], w = [];
      for (const [code, v] of e.g) {
        if (code === 11) fit.push([+v, 0]); else if (code === 21 && fit.length) fit[fit.length - 1][1] = +v;
        else if (code === 10) ctrl.push([+v, 0, 1]); else if (code === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = +v;
        else if (code === 40) knots.push(+v); else if (code === 41) w.push(+v);
      }
      const closed = (val(e, 70) & 1) === 1;
      if (fit.length >= 2) curves.push({ t: "spline", pts: fit.map(S), closed });
      else if (ctrl.length >= 2) {
        const p = val(e, 71, 3);
        w.forEach((wi, k) => { if (ctrl[k]) { ctrl[k][0] *= wi; ctrl[k][1] *= wi; ctrl[k][2] = wi; } });
        const lo = knots[p], hi = knots[knots.length - p - 1];
        const N = Math.max(8, ctrl.length * 4), pts = [];
        for (let s = 0; s <= N; s++) {
          const x = lo + ((hi - lo) * s) / N;
          let k = p; while (k < knots.length - p - 2 && x >= knots[k + 1]) k++;
          const q = deBoor(k, x, knots, ctrl, p);
          pts.push(S([q[0] / q[2], q[1] / q[2]]));
        }
        if (closed && pts.length > 2) pts.pop();
        curves.push({ t: "spline", pts, closed });
      }
    } else if (t === "ELLIPSE") {
      const c = [val(e, 10), val(e, 20)], mj = [val(e, 11), val(e, 21)], ratio = val(e, 40, 1);
      let t0 = val(e, 41, 0), t1 = val(e, 42, Math.PI * 2);
      const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6 || Math.abs(t1 - t0) < 1e-9;
      if (t1 < t0) t1 += Math.PI * 2;
      const mn = [-mj[1] * ratio, mj[0] * ratio];
      const n = full ? 16 : Math.max(4, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 16));
      const pts = [];
      for (let k = 0; k < (full ? n : n + 1); k++) { const a = t0 + ((t1 - t0) * k) / n; pts.push(S([c[0] + mj[0] * Math.cos(a) + mn[0] * Math.sin(a), c[1] + mj[1] * Math.cos(a) + mn[1] * Math.sin(a)])); }
      curves.push({ t: "spline", pts, closed: full });
    } else if (!["POINT", "VIEWPORT", "ATTRIB", "SEQEND", "VERTEX"].includes(t)) skipped++;
  }
  if (!curves.length) throw new Error("No lines, arcs, circles or splines were found in that DXF.");
  return { curves, skipped };
}

// bounds of imported curves
export function curvesBounds(curves) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const c of curves) {
    if (c.t === "line") { add(c.a); add(c.b); }
    else if (c.t === "circle") { add([c.c[0] - c.r, c.c[1] - c.r]); add([c.c[0] + c.r, c.c[1] + c.r]); }
    else if (c.t === "arc") { const r = Math.hypot(c.a[0] - c.c[0], c.a[1] - c.c[1]); add(c.a); add(c.b); add([c.c[0] - r, c.c[1] - r]); add([c.c[0] + r, c.c[1] + r]); }
    else for (const p of c.pts) add(p);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
