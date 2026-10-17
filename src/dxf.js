// Sketches out as DXF (for laser cutters, vinyl cutters, CNC, or other CAD). Each sketch is
// written flat in its own sketch coordinates (millimetres), on a layer named after it.
// Lines, circles and arcs stay true lines, circles and arcs; splines and text become
// polylines. Construction geometry and points are left out.
import { resolveSketch } from "./regions.js";
import { textOutlines } from "./scene.js";

const layerName = (s) => (s || "Sketch").replace(/[<>/\\":;?*|=,]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "Sketch";
const num = (v) => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(6));

// the drawable curves of a sketch, in sketch coordinates
export function sketchCurves(sk) {
  const out = [];
  for (const c of resolveSketch(sk)) {
    if (c.cons || c.t === "point") continue;
    if (c.t === "line") out.push({ t: "line", a: c.a, b: c.b });
    else if (c.t === "circle") out.push({ t: "circle", c: c.c, r: c.r });
    else if (c.t === "arc") out.push({ t: "arc", c: c.c, r: c.r, a0: c.a0, a1: c.a1 });
    else if (c.t === "spline" && c.poly && c.poly.length > 1) out.push({ t: "poly", pts: c.poly, closed: !!(c.src && c.src.closed) });
  }
  for (const { pts } of textOutlines(sk)) if (pts.length > 1) out.push({ t: "poly", pts, closed: true });
  return out;
}

export function curvesBox(curves) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const c of curves) {
    if (c.t === "line") { add(c.a); add(c.b); }
    else if (c.t === "circle" || c.t === "arc") { add([c.c[0] - c.r, c.c[1] - c.r]); add([c.c[0] + c.r, c.c[1] + c.r]); }
    else for (const p of c.pts) add(p);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

// sheets: [{ name, curves, dx, dy }] -> DXF text (AutoCAD R12 style, read by nearly everything)
export function writeDXF(sheets) {
  const L = [];
  const g = (code, v) => L.push(String(code), String(v));
  const layers = sheets.map((s) => layerName(s.name));
  let all = null;
  for (const s of sheets) {
    const b = curvesBox(s.curves);
    if (!b) continue;
    const bb = { x0: b.x0 + s.dx, y0: b.y0 + s.dy, x1: b.x1 + s.dx, y1: b.y1 + s.dy };
    all = all ? { x0: Math.min(all.x0, bb.x0), y0: Math.min(all.y0, bb.y0), x1: Math.max(all.x1, bb.x1), y1: Math.max(all.y1, bb.y1) } : bb;
  }
  all = all || { x0: 0, y0: 0, x1: 100, y1: 100 };
  // header: millimetres, drawing extents
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 4);
  g(9, "$MEASUREMENT"); g(70, 1);
  g(9, "$EXTMIN"); g(10, num(all.x0)); g(20, num(all.y0)); g(30, 0);
  g(9, "$EXTMAX"); g(10, num(all.x1)); g(20, num(all.y1)); g(30, 0);
  g(0, "ENDSEC");
  // one layer per sketch, each its own color
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length + 1);
  g(0, "LAYER"); g(2, "0"); g(70, 0); g(62, 7); g(6, "CONTINUOUS");
  layers.forEach((n, i) => { g(0, "LAYER"); g(2, n); g(70, 0); g(62, (i % 6) + 1); g(6, "CONTINUOUS"); });
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  sheets.forEach((s, i) => {
    const ly = layers[i], X = (v) => num(v + s.dx), Y = (v) => num(v + s.dy);
    for (const c of s.curves) {
      if (c.t === "line") {
        g(0, "LINE"); g(8, ly); g(10, X(c.a[0])); g(20, Y(c.a[1])); g(30, 0); g(11, X(c.b[0])); g(21, Y(c.b[1])); g(31, 0);
      } else if (c.t === "circle") {
        g(0, "CIRCLE"); g(8, ly); g(10, X(c.c[0])); g(20, Y(c.c[1])); g(30, 0); g(40, num(c.r));
      } else if (c.t === "arc") {
        // counter-clockwise from start to end, in degrees
        const deg = (a) => num((((a * 180) / Math.PI) % 360 + 360) % 360);
        g(0, "ARC"); g(8, ly); g(10, X(c.c[0])); g(20, Y(c.c[1])); g(30, 0); g(40, num(c.r)); g(50, deg(c.a0)); g(51, deg(c.a1));
      } else if (c.t === "poly") {
        const pts = c.closed && c.pts.length > 2 && Math.hypot(c.pts[0][0] - c.pts[c.pts.length - 1][0], c.pts[0][1] - c.pts[c.pts.length - 1][1]) < 1e-9 ? c.pts.slice(0, -1) : c.pts;
        g(0, "POLYLINE"); g(8, ly); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, c.closed ? 1 : 0);
        for (const p of pts) { g(0, "VERTEX"); g(8, ly); g(10, X(p[0])); g(20, Y(p[1])); g(30, 0); }
        g(0, "SEQEND"); g(8, ly);
      }
    }
  });
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\r\n") + "\r\n";
}

// several sketches in one file: side by side (each sketch keeps its own shape and size), so
// sketches drawn on different planes don't land on top of each other
export function sketchesDXF(sketches) {
  const sheets = [];
  let x = 0;
  for (const sk of sketches) {
    const curves = sketchCurves(sk);
    const b = curvesBox(curves);
    if (!b) continue;
    if (sketches.length === 1) { sheets.push({ name: sk.name, curves, dx: 0, dy: 0 }); break; }
    const gap = Math.max(10, (b.x1 - b.x0) * 0.1);
    sheets.push({ name: sk.name, curves, dx: x - b.x0, dy: -b.y0 });
    x += b.x1 - b.x0 + gap;
  }
  return sheets.length ? writeDXF(sheets) : null;
}
