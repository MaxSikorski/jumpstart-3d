// Geometry kernel: turns the document's node trees into OpenCascade solids
// and meshes. Runs inside a Web Worker in the app, and directly in Node for tests.
import * as R from "replicad";
import { fontBytes } from "./fonts.js";

let OC = null;
export async function initKernel(opencascade, wasmBinary) {
  OC = await opencascade({ wasmBinary, locateFile: (f) => f });
  R.setOC(OC);
  for (const name of ["sans", "serif", "mono"]) await R.loadFont(fontBytes(name), name, true);
}

// ---------------------------------------------------------------- cache
const cache = new Map(); // key -> Shape (owned by cache)
const CACHE_MAX = 80;
function cacheGet(key) {
  const s = cache.get(key);
  if (!s) return null;
  cache.delete(key);
  cache.set(key, s); // LRU bump
  return s.clone();
}
function cachePut(key, shape) {
  if (cache.has(key)) return;
  cache.set(key, shape.clone());
  while (cache.size > CACHE_MAX) {
    const [k, s] = cache.entries().next().value;
    cache.delete(k);
    try { s.delete(); } catch (e) {}
  }
}
export function clearCache() {
  for (const s of cache.values()) try { s.delete(); } catch (e) {}
  cache.clear();
}

// ---------------------------------------------------------------- helpers
const EPS = 1e-7;
function transformShape(shape, m) {
  // m: column-major 4x4 (three.js Matrix4.elements)
  if (!m) return shape;
  const isId = m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-12);
  if (isId) return shape;
  const trsf = new OC.gp_Trsf();
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
  const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
  const out = R.cast(op.Shape());
  op.delete(); trsf.delete(); shape.delete();
  return out;
}

function polyDrawing(pts) {
  let pen = R.draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close();
}
function ellipseDrawing(rx, ry) {
  if (Math.abs(rx - ry) < 1e-9) return R.drawCircle(rx);
  return rx >= ry ? R.drawEllipse(rx, ry) : R.drawEllipse(ry, rx).rotate(90, [0, 0]);
}
function ngon(n, rx, ry, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return pts;
}
const clampPos = (v, min = 0.01) => (v > min ? v : min);
// map 2D points so they exactly fill a w x d box centred on the origin
function fitMap(pts, w, d) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const sx = w / (x1 - x0 || 1), sy = d / (y1 - y0 || 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return ([x, y]) => [(x - cx) * sx, (y - cy) * sy];
}
const fitPts = (pts, w, d) => pts.map(fitMap(pts, w, d));

function roundOff(shape, p) {
  // Tinkercad-style "Radius" / "Bevel" on a primitive: applied to every edge.
  // Clamped below half the smallest dimension: OpenCascade can hang otherwise.
  const lim = Math.min(clampPos(p.w), clampPos(p.d), clampPos(p.h)) / 2 * 0.96;
  p = { ...p, r: Math.min(p.r || 0, lim), c: Math.min(p.c || 0, lim) };
  if (p.r > 0) {
    try { const s = shape.fillet(p.r); shape.delete(); return s; } catch (e) { throw new Error("Radius is too large for this shape"); }
  }
  if (p.c > 0) {
    try { const s = shape.chamfer(p.c); shape.delete(); return s; } catch (e) { throw new Error("Bevel is too large for this shape"); }
  }
  return shape;
}

// ---------------------------------------------------------------- primitives
// Local frame: centered on X/Y, resting on Z = 0, Z up.
function buildPrim(kind, p) {
  const w = clampPos(p.w), d = clampPos(p.d), h = clampPos(p.h);
  switch (kind) {
    case "box": {
      return roundOff(R.makeBaseBox(w, d, h), p);
    }
    case "cylinder": {
      // round ones are true cylinders (one smooth side face), oval ones are extruded ellipses
      const s = Math.abs(w - d) < 1e-9 ? R.makeCylinder(w / 2, h, [0, 0, 0], [0, 0, 1]) : ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY").extrude(h);
      return roundOff(s, p);
    }
    case "tube": {
      const t = Math.min(clampPos(p.wall ?? 2), Math.min(w, d) / 2 - 0.01);
      const outer = ellipseDrawing(w / 2, d / 2);
      const inner = ellipseDrawing(w / 2 - t, d / 2 - t);
      return outer.cut(inner).sketchOnPlane("XY").extrude(h);
    }
    case "cone": {
      const top = Math.max(0, Math.min(1, p.top ?? 0));
      const base = ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY");
      if (top < 0.005) return base.loftWith([], { endPoint: [0, 0, h], ruled: true });
      const lid = ellipseDrawing((w / 2) * top, (d / 2) * top).sketchOnPlane("XY", h);
      return base.loftWith(lid, { ruled: true });
    }
    case "pyramid": {
      const n = Math.max(3, Math.round(p.sides ?? 4));
      const rot = n === 4 ? Math.PI / 4 : Math.PI / 2;
      const k = n === 4 ? Math.SQRT1_2 : 1;
      const pts = ngon(n, (w / 2) / k, (d / 2) / k, rot);
      if (n === 4) for (const q of pts) { q[0] = Math.sign(q[0]) * w / 2; q[1] = Math.sign(q[1]) * d / 2; }
      return polyDrawing(pts).sketchOnPlane("XY").loftWith([], { endPoint: [0, 0, h], ruled: true });
    }
    case "prism": {
      const n = Math.max(3, Math.round(p.sides ?? 6));
      const s = polyDrawing(ngon(n, w / 2, d / 2, Math.PI / 2)).sketchOnPlane("XY").extrude(h);
      return roundOff(s, p);
    }
    case "wedge": {
      // Ramp: right triangle in XZ, extruded along Y.
      const s = polyDrawing([[-w / 2, 0], [w / 2, 0], [-w / 2, h]])
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
      return roundOff(s, p);
    }
    case "sphere": {
      if (Math.abs(w - d) < 1e-9 && Math.abs(w - h) < 1e-9) return R.makeSphere(w / 2).translate(0, 0, h / 2);
      return R.makeEllipsoid(w / 2, d / 2, h / 2).translate(0, 0, h / 2);
    }
    case "hemisphere": {
      const e = Math.abs(w - d) < 1e-9 && Math.abs(w / 2 - h) < 1e-9 ? R.makeSphere(h) : R.makeEllipsoid(w / 2, d / 2, h);
      const half = e.cutPlane("XY", 0, "positive");
      e.delete();
      return half;
    }
    case "torus": {
      const tube = Math.min(clampPos(p.tube ?? 5), w / 2 - 0.01);
      const R0 = w / 2 - tube / 2;
      const ring = R.drawCircle(tube / 2).translate(R0, 0)
        .sketchOnPlane(new R.Plane([0, 0, tube / 2], [1, 0, 0], [0, -1, 0]))
        .revolve([0, 0, 1], { origin: [0, 0, 0] });
      return ring;
    }
    case "text": {
      // Tinkercad-style 3D text, centred on the origin
      const curve = Math.max(-350, Math.min(350, +p.curve || 0));
      if (Math.abs(curve) > 0.5) {
        // text bent along an arc: each letter turns to follow the curve
        const gl = glyphDrawings({ str: p.text, size: p.size, font: p.font });
        const span = Math.max(1e-3, gl[gl.length - 1].u - gl[0].u + (p.size || 10) * 0.7);
        const sgn = Math.sign(curve), R0 = span / ((Math.abs(curve) * Math.PI) / 180);
        const parts = gl.map((g) => {
          const th = g.u / R0;
          const x = R0 * Math.sin(th), y = sgn * (R0 * Math.cos(th) - R0);
          return g.d.rotate((-sgn * th * 180) / Math.PI, [0, 0]).translate(x, y).sketchOnPlane("XY").extrude(clampPos(p.h || 5));
        });
        let out = parts[0];
        for (let i = 1; i < parts.length; i++) { const f = out.fuse(parts[i]); out.delete(); parts[i].delete(); out = f; }
        const bb = out.boundingBox.center;
        return out.translate(-bb[0], -bb[1], 0);
      }
      let d = textDrawing({ str: p.text, size: p.size, font: p.font });
      const c = d.boundingBox.center;
      d = d.translate(-c[0], -c[1]);
      return d.sketchOnPlane("XY").extrude(clampPos(p.h || 5));
    }
    case "star": {
      const n = Math.max(3, Math.min(24, Math.round(p.points ?? 5)));
      const k = Math.max(0.1, Math.min(0.95, p.inner ?? 0.5));
      const pts = [];
      for (let i = 0; i < 2 * n; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? k : 1;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return polyDrawing(fitPts(pts, w, d)).sketchOnPlane("XY").extrude(h);
    }
    case "heart": {
      // four cubic curves, fitted exactly to the w x d box
      const segs = [
        [[0, -1], [0.35, -0.55], [1, -0.25], [1, 0.3]],
        [[1, 0.3], [1, 0.95], [0.1, 1.05], [0, 0.6]],
        [[0, 0.6], [-0.1, 1.05], [-1, 0.95], [-1, 0.3]],
        [[-1, 0.3], [-1, -0.25], [-0.35, -0.55], [0, -1]],
      ];
      const bez = (q, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * q[0][i] + 3 * u * u * t * q[1][i] + 3 * u * t * t * q[2][i] + t * t * t * q[3][i]); };
      const all = [];
      for (const q of segs) for (let i = 0; i <= 64; i++) all.push(bez(q, i / 64));
      const map = fitMap(all, w, d);
      let pen = R.draw(map(segs[0][0]));
      for (const q of segs) pen = pen.cubicBezierCurveTo(map(q[3]), map(q[1]), map(q[2]));
      return pen.close().sketchOnPlane("XY").extrude(h);
    }
    case "roof": {
      // gable roof: a triangle across X, run along Y
      return polyDrawing([[-w / 2, 0], [w / 2, 0], [0, h]])
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
    }
    case "roundroof": {
      // half of an oval cylinder lying along Y
      const pen = R.draw([w / 2, 0]).lineTo([-w / 2, 0]);
      const half = Math.abs(w / 2 - h) < 1e-9 ? pen.threePointsArcTo([w / 2, 0], [0, h]) : pen.ellipseTo([w / 2, 0], w / 2, h, 0, false, false);
      return half.close()
        .sketchOnPlane(new R.Plane([0, d / 2, 0], [1, 0, 0], [0, -1, 0]))
        .extrude(d);
    }
    case "paraboloid": {
      if (Math.abs(w - d) < 1e-9) {
        // a parabola is exactly one quadratic curve; spin it about Z
        return R.draw([0, 0]).lineTo([w / 2, 0]).quadraticBezierCurveTo([0, h], [w / 4, h]).close()
          .sketchOnPlane("XZ").revolve([0, 0, 1], { origin: [0, 0, 0] });
      }
      const fr = [0.8, 0.6, 0.4, 0.2];
      const base = ellipseDrawing(w / 2, d / 2).sketchOnPlane("XY");
      const lids = fr.map((f) => ellipseDrawing((w / 2) * f, (d / 2) * f).sketchOnPlane("XY", h * (1 - f * f)));
      return base.loftWith(lids, { endPoint: [0, 0, h], ruled: false });
    }
    case "gem": {
      // icosahedron stretched to the box
      const g = (1 + Math.sqrt(5)) / 2;
      const V = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
      const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      const P = V.map(([x, y, z]) => [(x / g) * (w / 2), (y / g) * (d / 2), ((z / g) + 1) * (h / 2)]);
      return R.makeSolid(F.map((f) => R.makePolygon(f.map((i) => P[i]))));
    }
    case "capsule": {
      // a pill lying along X: length w, section d x h, rounded ends, resting on Z = 0
      const ry = d / 2, rz = h / 2, cx = Math.min(ry, rz, w / 2);
      const L = Math.max(0, w - 2 * cx);
      if (Math.abs(ry - rz) < 1e-6 && cx >= ry - 1e-6) {
        // round section: analytic cylinder + spheres (fast booleans)
        const r = ry;
        let out = R.makeSphere(r).translate(-L / 2, 0, rz);
        const add = (b) => { const f = out.fuse(b); out.delete(); b.delete(); out = f; };
        if (L > 1e-6) add(R.makeCylinder(r, L, [-L / 2, 0, rz], [1, 0, 0]));
        add(R.makeSphere(r).translate(L / 2, 0, rz));
        return out.simplify ? out.simplify() : out;
      }
      const parts = [];
      if (L > 1e-6) parts.push(ellipseDrawing(ry, rz).sketchOnPlane(new R.Plane([-L / 2, 0, rz], [0, 1, 0], [1, 0, 0])).extrude(L));
      parts.push(R.makeEllipsoid(cx, ry, rz).translate(-L / 2, 0, rz), R.makeEllipsoid(cx, ry, rz).translate(L / 2, 0, rz));
      let out = parts[0];
      for (let i = 1; i < parts.length; i++) { const f = out.fuse(parts[i]); out.delete(); parts[i].delete(); out = f; }
      return out;
    }
    case "arrow": {
      // a flat arrow pointing +X, fitted to w x d, h thick
      const head = Math.min(w * 0.45, d * 1.1), shaft = d * 0.42;
      const pts = [[-w / 2, -shaft / 2], [w / 2 - head, -shaft / 2], [w / 2 - head, -d / 2], [w / 2, 0], [w / 2 - head, d / 2], [w / 2 - head, shaft / 2], [-w / 2, shaft / 2]];
      return polyDrawing(pts).sketchOnPlane("XY").extrude(h);
    }
    case "spring": {
      const wire = Math.max(0.2, Math.min(p.wire ?? 2, Math.min(w, d) / 2 - 0.05));
      const r = Math.min(w, d) / 2 - wire / 2;
      const z0 = wire / 2, len = Math.max(0.01, h - wire);
      // never let the coils touch: a short spring gets fewer turns
      const turns = Math.max(0.25, Math.min(p.turns ?? 5, len / (wire * 1.05)));
      const pitch = len / turns;
      const helix = helixWire(pitch, len, r, [0, 0, z0], [0, 0, 1], false);
      const sp = helix.startPoint.toTuple();
      const rad = [sp[0], sp[1], 0], rl = Math.hypot(...rad) || 1;
      const tan0 = [-rad[1] / rl * 2 * Math.PI * r, rad[0] / rl * 2 * Math.PI * r, pitch], tl = Math.hypot(...tan0);
      const tan = tan0.map((v) => v / tl);
      const sk = R.drawCircle(wire / 2).sketchOnPlane(new R.Plane(sp, [rad[0] / rl, rad[1] / rl, 0], tan));
      const prof = sk.wire.clone();
      sk.delete();
      try { return R.genericSweep(prof, helix, { frenet: true }, false); }
      catch (e) { throw new Error("The spring couldn't be built with these sizes"); }
      finally { prof.delete(); helix.delete(); }
    }
    default:
      throw new Error("Unknown shape: " + kind);
  }
}

// ---------------------------------------------------------------- text
// size = height of capital letters in mm; (x, y) = left end of the baseline.
function textDrawing(t) {
  const str = String(t.str || "").replace(/\s+$/, "");
  if (!str.trim()) throw new Error("Type some text first");
  const fontName = ["sans", "serif", "mono"].includes(t.font) ? t.font : "sans";
  const font = R.getFont(fontName);
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fontSize = clampPos(t.size || 10) * font.unitsPerEm / cap;
  let d = R.drawText(str, { startX: 0, startY: 0, fontSize, fontFamily: fontName });
  // line the solid up with the outline the sketch shows (baseline at y = 0, text running +x)
  const pb = font.getPath(str, 0, 0, fontSize).getBoundingBox();
  const [lo] = d.boundingBox.bounds;
  d = d.translate(pb.x1 - lo[0], -pb.y2 - lo[1]);
  if (t.angle) d = d.rotate(t.angle, [0, 0]);
  return d.translate(t.x || 0, t.y || 0);
}

// ---------------------------------------------------------------- sketch regions
function loopDrawing(loop) {
  if (loop.length === 1 && loop[0].t === "circle") {
    const c = loop[0];
    return R.drawCircle(c.r).translate(c.c[0], c.c[1]);
  }
  let pen = R.draw(loop[0].a);
  for (let i = 0; i < loop.length; i++) {
    const s = loop[i];
    const last = i === loop.length - 1;
    const end = last ? loop[0].a : s.b;
    if (s.t === "line") pen = last ? pen : pen.lineTo(end);
    else if (s.t === "arc") pen = pen.threePointsArcTo(end, s.m);
    else if (s.t === "bez") {
      // spline pieces: cubic Bezier spans (the last one lands exactly on the loop start)
      s.spans.forEach((b, k) => { pen = pen.cubicBezierCurveTo(k === s.spans.length - 1 ? end : b[3], b[1], b[2]); });
    }
  }
  return pen.close();
}
function regionDrawing(region) {
  if (region.text) return textDrawing(region.text);
  let dr = loopDrawing(region.outer);
  for (const h of region.holes || []) dr = dr.cut(loopDrawing(h));
  return dr;
}
function regionsDrawing(regions, stretch) {
  let dr = null;
  for (const r of regions) {
    const d = regionDrawing(r);
    dr = dr ? dr.fuse(d) : d;
  }
  if (stretch) {
    if (Math.abs(stretch[0] - 1) > 1e-12) dr = dr.stretch(stretch[0], [0, 1], [0, 0]); // affinity about the y axis = stretch along x
    if (Math.abs(stretch[1] - 1) > 1e-12) dr = dr.stretch(stretch[1], [1, 0], [0, 0]);
  }
  return dr;
}
function planeOf(pl, shift = 0) {
  const o = [pl.o[0] + pl.n[0] * shift, pl.o[1] + pl.n[1] * shift, pl.o[2] + pl.n[2] * shift];
  return new R.Plane(o, pl.x, pl.n);
}
function buildExtrude(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to extrude");
  const d1 = node.dist || 0;
  const mode = node.mode || "one";
  const mk = (start, len) => {
    const dr = regionsDrawing(node.regions, node.stretch);
    return dr.sketchOnPlane(planeOf(node.plane, start)).extrude(len);
  };
  if (Math.abs(d1) < 1e-6 && mode !== "two") throw new Error("Distance can't be zero");
  if (mode === "sym") return mk(-Math.abs(d1) / 2, Math.abs(d1));
  if (mode === "two") {
    const a = mk(0, Math.abs(d1) || 0.001);
    const d2 = Math.abs(node.dist2 || 0);
    if (d2 < 1e-6) return a;
    const b = mk(-d2, d2);
    const u = a.fuse(b); a.delete(); b.delete();
    return u;
  }
  return d1 > 0 ? mk(0, d1) : mk(d1, -d1);
}
function buildRevolve(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to revolve");
  if (!node.axis && !node.axisWorld) throw new Error("Pick an axis: a sketch line, or X, Y or Z");
  const pl = planeOf(node.plane);
  let a, dir;
  if (node.axisWorld) { a = node.axisWorld.o; dir = node.axisWorld.d; }
  else {
    const st = node.stretch || [1, 1];
    const to3 = (p) => pl.toWorldCoords([p[0] * st[0], p[1] * st[1]]).toTuple();
    a = to3(node.axis.a);
    const b = to3(node.axis.b);
    dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }
  const n = node.plane.n, dl = Math.hypot(...dir) || 1;
  if (Math.abs((dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]) / (dl * (Math.hypot(...n) || 1))) > 1e-6) throw new Error("The axis must lie along the sketch plane, not point out of it");
  // a profile that crosses the axis would turn inside out
  {
    const dn = dir.map((v) => v / dl);
    let pos = false, neg = false;
    const st = node.stretch || [1, 1];
    for (const r of node.regions) for (const s of r.outer || []) for (const q0 of [s.a, s.b, s.m, s.c].filter(Boolean)) {
      const w = pl.toWorldCoords([q0[0] * st[0], q0[1] * st[1]]).toTuple();
      const v = [w[0] - a[0], w[1] - a[1], w[2] - a[2]];
      const side = (v[1] * dn[2] - v[2] * dn[1]) * n[0] + (v[2] * dn[0] - v[0] * dn[2]) * n[1] + (v[0] * dn[1] - v[1] * dn[0]) * n[2];
      if (side > 1e-6) pos = true;
      if (side < -1e-6) neg = true;
    }
    if (pos && neg) throw new Error("The profile crosses the axis. Move it to one side of the axis.");
  }
  const dr = regionsDrawing(node.regions, node.stretch);
  return dr.sketchOnPlane(pl).revolve(dir, { origin: a, angle: node.angle ?? 360 });
}

// Sweep (Fusion-style): closed profiles swept along a path of sketch lines and arcs.
function sweepPath(segs) {
  if (!segs || !segs.length) throw new Error("Pick a path: a sketch line, arc or a chain of them");
  const edges = segs.flatMap((s) => (s.t === "line" ? [R.makeLine(s.a, s.b)] : s.t === "arc" ? [R.makeThreePointArc(s.a, s.m, s.b)] : s.t === "bez" ? s.spans.map((b) => R.makeBezierCurve(b)) : s.t === "bsp" ? [bsplineThrough(s.pts)] : [R.makeCircle(s.r, s.c, s.n)]));
  return R.assembleWire(edges);
}
function pipe(wire, spine, orient) {
  const b = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    b.SetTransitionMode(OC.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    if (orient === "parallel") {
      // the profile keeps its direction instead of turning with the path
      const ax = new OC.gp_Ax2(new OC.gp_Pnt(0, 0, 0), new OC.gp_Dir(0, 0, 1), new OC.gp_Dir(1, 0, 0));
      b.SetMode(ax);
      ax.delete();
    }
    b.Add(wire.wrapped, false, false);
    b.Build();
    if (!b.IsDone()) throw new Error("x");
    b.MakeSolid();
    const out = R.cast(b.Shape());
    if (!(safeVolume(out) > 1e-9)) { out.delete(); throw new Error("x"); }
    return out;
  } catch (e) {
    throw new Error("Couldn't sweep the profile along this path. Check that the profile is not wider than the path's tightest bend.");
  } finally { b.delete(); }
}
// ---------------------------------------------------------------- sweep: distance, taper, twist
// A path trimmed to a fraction of its length, and twisted/tapered sweeps built from profile
// copies placed along the path (rotation-minimizing frames), joined by one pipe shell.
const swV = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len: (a) => Math.hypot(a[0], a[1], a[2]), nrm: (a) => {
  let l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}, lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
function swBezPt(s, t) {
  let u = 1 - t;
  return [0, 1, 2].map((i) => u * u * u * s[0][i] + 3 * u * u * t * s[1][i] + 3 * u * t * t * s[2][i] + t * t * t * s[3][i]);
}
function swBezD(s, t) {
  let u = 1 - t;
  return [0, 1, 2].map((i) => 3 * (u * u * (s[1][i] - s[0][i]) + 2 * u * t * (s[2][i] - s[1][i]) + t * t * (s[3][i] - s[2][i])));
}
function swBezSplitL(s, t) {
  let V = swV, a = V.lerp(s[0], s[1], t), b = V.lerp(s[1], s[2], t), c = V.lerp(s[2], s[3], t), d = V.lerp(a, b, t), e = V.lerp(b, c, t), f = V.lerp(d, e, t);
  return [s[0], a, d, f];
}
function swSeg(s) {
  let V = swV;
  if (s.t === "line") {
    let d = V.sub(s.b, s.a), L = V.len(d), tg2 = V.mul(d, 1 / (L || 1));
    return { s, len: L, at: (u) => ({ p: V.add(s.a, V.mul(d, u)), t: tg2 }), cut: (f) => ({ t: "line", a: s.a, b: V.add(s.a, V.mul(d, f)) }) };
  }
  if (s.t === "arc" || s.t === "circle") {
    let c, r, u02, v02, sweep;
    if (s.t === "arc") {
      let am2 = V.sub(s.m, s.a), ab = V.sub(s.b, s.a), nn = V.cross(ab, am2), d2 = V.dot(nn, nn);
      if (d2 < 1e-18) return swSeg({ t: "line", a: s.a, b: s.b });
      let num = V.cross(V.sub(V.mul(am2, V.dot(ab, ab)), V.mul(ab, V.dot(am2, am2))), nn);
      c = V.add(s.a, V.mul(num, 1 / (2 * d2)));
      let ra2 = V.sub(s.a, c);
      r = V.len(ra2);
      u02 = V.mul(ra2, 1 / r);
      let rm2 = V.sub(s.m, c), rb = V.sub(s.b, c), ax = V.nrm(V.cross(ra2, rm2));
      v02 = V.cross(ax, u02);
      let ang = (p) => {
        let a = Math.atan2(V.dot(p, v02), V.dot(p, u02));
        return a < 0 ? a + 2 * Math.PI : a;
      }, tm2 = ang(rm2), tb = ang(rb);
      sweep = tb > tm2 ? tb : tb - 2 * Math.PI;
    } else {
      let e = R.makeCircle(s.r, s.c, s.n), p02 = e.startPoint.toTuple();
      e.delete();
      c = s.c;
      r = s.r;
      u02 = V.nrm(V.sub(p02, c));
      v02 = V.cross(V.nrm(s.n), u02);
      sweep = 2 * Math.PI;
    }
    let P = (a) => V.add(c, V.add(V.mul(u02, r * Math.cos(a)), V.mul(v02, r * Math.sin(a)))), sg2 = Math.sign(sweep);
    return {
      s,
      len: r * Math.abs(sweep),
      at: (u) => {
        let a = u * sweep;
        return { p: P(a), t: V.mul(V.add(V.mul(u02, -Math.sin(a)), V.mul(v02, Math.cos(a))), sg2) };
      },
      cut: (f) => s.t === "circle" && f >= 1 - 1e-9 ? s : { t: "arc", a: P(0), b: P(f * sweep), m: P(f * sweep / 2) }
    };
  }
  if (s.t === "bez") {
    let K2 = 48, tab = [], total = 0;
    s.spans.forEach((sp, i) => {
      tab.push({ i, t: 0, l: total });
      let prev = sp[0];
      for (let j2 = 1; j2 <= K2; j2++) {
        let p = swBezPt(sp, j2 / K2);
        total += V.len(V.sub(p, prev));
        tab.push({ i, t: j2 / K2, l: total });
        prev = p;
      }
    });
    let loc = (f) => {
      let target = Math.max(0, Math.min(1, f)) * total;
      for (let k = 1; k < tab.length; k++) {
        let a = tab[k - 1], b = tab[k];
        if (a.i !== b.i) continue;
        if (b.l >= target - 1e-12) {
          let w = b.l - a.l > 1e-12 ? (target - a.l) / (b.l - a.l) : 0;
          return { i: b.i, t: a.t + (b.t - a.t) * Math.max(0, Math.min(1, w)) };
        }
      }
      let z = tab[tab.length - 1];
      return { i: z.i, t: 1 };
    };
    return {
      s,
      len: total,
      at: (u) => {
        let q2 = loc(u), sp = s.spans[q2.i], d = swBezD(sp, q2.t);
        if (V.len(d) < 1e-12) d = V.sub(sp[3], sp[0]);
        return { p: swBezPt(sp, q2.t), t: V.nrm(d) };
      },
      cut: (f) => {
        let q2 = loc(f), sp = s.spans.slice(0, q2.i);
        if (q2.t > 1e-9) sp.push(swBezSplitL(s.spans[q2.i], q2.t));
        if (!sp.length) sp.push(swBezSplitL(s.spans[0], 1e-6));
        return { t: "bez", a: sp[0][0], b: sp[sp.length - 1][3], spans: sp };
      }
    };
  }
  throw new Error("Unsupported path segment");
}
function swTrim(segs, f) {
  let ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0), target = f * total, acc = 0, out = [];
  for (let q2 of ps2) {
    if (acc + q2.len <= target + 1e-9) {
      out.push(q2.s);
      acc += q2.len;
      if (Math.abs(acc - target) < 1e-9) break;
      continue;
    }
    out.push(q2.cut((target - acc) / q2.len));
    break;
  }
  return out;
}
function swMat3(a, b) {
  let r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j2 = 0; j2 < 3; j2++) r[i][j2] = a[i][0] * b[0][j2] + a[i][1] * b[1][j2] + a[i][2] * b[2][j2];
  return r;
}
function swRot(ax, an2) {
  let [x, y, z] = ax, c = Math.cos(an2), s = Math.sin(an2), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
function swApply(m, p) {
  return [m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2], m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2], m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]];
}
function swStations(segs, n) {
  let V = swV, ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0), K2 = Math.max(1, Math.ceil(240 / n)), D = n * K2, seg = 0, acc = 0, T2 = [], P = [], A = [], turn = 0;
  for (let j2 = 0; j2 <= D; j2++) {
    let s = j2 / D * total;
    while (seg < ps2.length - 1 && s >= acc + ps2[seg].len - 1e-12) {
      acc += ps2[seg].len;
      seg++;
    }
    let u = ps2[seg].len > 0 ? Math.max(0, Math.min(1, (s - acc) / ps2[seg].len)) : 0, r = ps2[seg].at(u);
    T2.push(r.t);
    P.push(r.p);
    if (j2 === 0) A.push([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    else {
      let a = T2[j2 - 1], b = r.t, c = V.cross(a, b), sn2 = V.len(c), cs2 = V.dot(a, b);
      if (sn2 > 1e-12) {
        let an2 = Math.atan2(sn2, cs2);
        turn += an2;
        A.push(swMat3(swRot(V.mul(c, 1 / sn2), an2), A[j2 - 1]));
      } else if (cs2 < 0) throw new Error("The path doubles back on itself");
      else A.push(A[j2 - 1]);
    }
  }
  let st2 = [];
  for (let k = 0; k <= n; k++) {
    let j2 = k * K2;
    st2.push({ s: k / n * total, p: P[j2], t: T2[j2], A: A[j2] });
  }
  return { total, st: st2, turn };
}
function swDiag(w) {
  let b = w.boundingBox, [a, c] = b.bounds;
  b.delete && b.delete();
  return Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
}
function swOffset(w, d, grow) {
  let d02 = swDiag(w), pick = (sg2) => {
    let o2 = w.clone().offset2D(sg2 * d, "intersection");
    return o2;
  }, o;
  try {
    o = pick(1);
    let bigger = swDiag(o) > d02 + 1e-9;
    if (bigger !== (d > 0 === grow)) {
      o.delete();
      o = pick(-1);
    }
  } catch (e) {
    throw new Error("The taper is too large: the profile collapses before the end of the sweep.");
  }
  return o;
}
function swPipe(spine, wires) {
  let ps2 = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    ps2.SetTransitionMode(OC.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    for (let w of wires) ps2.Add(w.wrapped, false, false);
    ps2.Build();
    if (!ps2.IsDone()) throw new Error("x");
    ps2.MakeSolid();
    let o = R.cast(ps2.Shape()), v = safeVolume(o);
    if (v < 0) {
      let r = R.cast(o.wrapped.Reversed());
      o.delete();
      o = r;
      v = safeVolume(o);
    }
    if (!(v > 1e-9)) {
      o.delete();
      throw new Error("x");
    }
    return o;
  } catch (e) {
    throw new Error("Couldn't sweep with this twist and taper. Try a smaller angle, a shorter distance, or a gentler path.");
  } finally {
    ps2.delete();
  }
}
function swTwistTaper(wire, segs, taper, twist, isHole) {
  let V = swV, tan = Math.tan(taper * Math.PI / 180), tw = twist * Math.PI / 180, ps2 = segs.map(swSeg), total = ps2.reduce((a, q2) => a + q2.len, 0);
  let nTw = Math.ceil(Math.abs(twist) / 12), n = Math.max(2, nTw, Math.min(segs.length + 1, 12)), probe = swStations(segs, n);
  n = Math.max(n, Math.ceil(probe.turn * 180 / Math.PI / 20) + 1);
  n = Math.min(n, 64);
  let S = n === probe.st.length - 1 ? probe : swStations(segs, n), P02 = S.st[0].p, wires = [], ec2 = null;
  try {
    for (let k = 0; k <= n; k++) {
      let st2 = S.st[k], d = tan * st2.s, w = wire.clone();
      if (Math.abs(d) > 1e-7) w = swOffset(w, d, !isHole);
      let ne = w.edges, cnt = ne.length;
      ne.forEach((e) => e.delete());
      if (ec2 === null) ec2 = cnt;
      else if (cnt !== ec2) throw new Error("The taper changes this profile too much (some of its edges vanish). Use a smaller taper angle or distance.");
      let Rm = swMat3(swRot(st2.t, tw * (S.total ? st2.s / S.total : 0)), st2.A), tr2 = V.sub(st2.p, swApply(Rm, P02)), m = [Rm[0][0], Rm[1][0], Rm[2][0], 0, Rm[0][1], Rm[1][1], Rm[2][1], 0, Rm[0][2], Rm[1][2], Rm[2][2], 0, tr2[0], tr2[1], tr2[2], 1];
      wires.push(transformShape(w, m));
    }
    let spine = sweepPath(segs);
    try {
      return swPipe(spine, wires);
    } finally {
      spine.delete();
    }
  } finally {
    wires.forEach((w) => w.delete && w.delete());
  }
}

function buildSweep(node) {
  if (!node.regions || !node.regions.length) throw new Error("Select a closed profile to sweep");
  const pl = planeOf(node.plane);
  // run the path from the end nearest the profile, so either end can be used
  let segs = node.pathSegs || [];
  const r0 = node.regions[0];
  const seg0 = r0 && r0.outer && r0.outer[0];
  const q = seg0 ? (seg0.t === "circle" ? seg0.c : seg0.a) : [0, 0];
  const pc = pl.toWorldCoords(q).toTuple();
  if (segs.length && segs[0].t !== "circle") {
    const s0 = segs[0].a, s1 = segs[segs.length - 1].b;
    if (dist(s1, pc) < dist(s0, pc) - 1e-9) segs = segs.slice().reverse().map((x) => ({ ...x, a: x.b, b: x.a, spans: x.spans && x.spans.slice().reverse().map((b) => [b[3], b[2], b[1], b[0]]) }));
  }
  // Distance (a fraction of the path), taper and twist, like Fusion 360's sweep
  const perp = node.orient !== "parallel";
  const frac = Math.max(1e-3, Math.min(1, node.dist == null ? 1 : +node.dist || 1));
  const taper = perp ? +node.taper || 0 : 0, twist = perp ? +node.twist || 0 : 0;
  const special = Math.abs(taper) > 1e-9 || Math.abs(twist) > 1e-9;
  if (frac < 1 - 1e-9 && segs.length) segs = swTrim(segs, frac);
  if (special) {
    if (segs.length === 1 && segs[0].t === "circle") throw new Error("Twist and taper need an open path. Set Distance below 1, or use a path that is not a closed loop.");
    const start = segs[0].a;
    if (Math.abs(Vec.dot(Vec.sub(start, node.plane.o), Vec.norm(node.plane.n))) > 1e-3) throw new Error("For twist and taper, the profile must sit at the start of the path.");
  }
  const spine = sweepPath(segs);
  let out = null;
  try {
    for (const r of node.regions) {
      if (r.text) throw new Error("Text profiles can't be swept yet");
      const solidOf = (loop, hole) => {
        const sk = loopDrawing(loop).sketchOnPlane(pl);
        try { return special ? swTwistTaper(sk.wire, segs, taper, twist, hole) : pipe(sk.wire, spine, node.orient); } finally { sk.delete(); }
      };
      let s1 = solidOf(r.outer, false);
      if (Math.abs(R.measureVolume(s1)) < 1e-9) throw new Error("Couldn't sweep");
      for (const h of r.holes || []) { const hs = solidOf(h, true); const c = s1.cut(hs); s1.delete(); hs.delete(); s1 = c; }
      if (!out) out = s1; else { const u = out.fuse(s1); out.delete(); s1.delete(); out = u; }
    }
  } finally { spine.delete(); }
  return out;
}

// ---------------------------------------------------------------- loft
// sections: [{ plane, region: { outer, holes } } | { pt: [x,y,z] }] in order; points only at the ends
function loopArea(loop) {
  // signed area of a closed loop of segments (sampled), in its sketch plane
  const pts = [];
  for (const s of loop) {
    if (s.t === "circle") { for (let i = 0; i < 24; i++) { const a = (i / 24) * 2 * Math.PI; pts.push([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]); } continue; }
    pts.push(s.a);
    if (s.m) pts.push(s.m);
  }
  let A = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; A += p[0] * q[1] - q[0] * p[1]; }
  return A / 2;
}
function buildLoft(node) {
  let secs = (node.sections || []).filter((s) => s && (s.region || s.pt));
  const regs = secs.filter((s) => s.region);
  if (secs.length < 2 || !regs.length) throw new Error("Pick at least two profiles (or a profile and a point)");
  if (secs.some((s, i) => s.pt && i !== 0 && i !== secs.length - 1)) throw new Error("A point can only be the first or last section");
  if (regs.some((s) => s.region.text)) throw new Error("Text profiles can't be lofted");
  // one consistent winding: every loop faces the same way along the loft
  const centroid = (s) => { const b = planeOf(s.plane); const c = b.toWorldCoords(loopCenter(s.region.outer)).toTuple(); b.delete && b.delete(); return c; };
  const nrm = (s, loop) => { const a = loopArea(loop) >= 0 ? 1 : -1; return s.plane.n.map((v) => v * a); };
  const keep = [];
  const wireFor = (s, loop, ref) => {
    const sk = loopDrawing(loop).sketchOnPlane(planeOf(s.plane));
    keep.push(sk);
    let w = sk.wire.wrapped;
    const n = nrm(s, loop);
    if (ref && n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) w = OC.TopoDS.Wire(w.Reversed());
    return w;
  };
  // each section faces along the loft: the direction from the section before it to the one after it
  const along = (i) => {
    const cents = secs.map((s) => s.pt || centroid(s));
    const n = cents.length, closed = node.closed && n >= 3;
    const a = cents[i > 0 ? i - 1 : closed ? n - 1 : 0], b = cents[i < n - 1 ? i + 1 : closed ? 0 : n - 1];
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  };
  const vtx = (p) => { const mk = new OC.BRepBuilderAPI_MakeVertex(new OC.gp_Pnt(p[0], p[1], p[2])); const v = mk.Vertex(); mk.delete(); return v; };
  const loftOf = (loopOf) => {
    if (node.railSegs && node.railSegs.length) {
      // centerline loft: the sections ride along a path
      const spine = sweepPath(node.railSegs);
      const b = new OC.BRepOffsetAPI_MakePipeShell(spine.wrapped);
      try {
        b.SetMode(false);
        secs.forEach((s, i) => {
          if (s.pt) b.Add(vtx(s.pt), false, false);
          else b.Add(wireFor(s, loopOf(s), along(i)), false, false);
        });
        b.Build();
        if (!b.IsDone()) throw new Error("x");
        b.MakeSolid();
        return R.cast(b.Shape());
      } catch (e) { throw new Error("Couldn't loft along this centerline. Check that the profiles sit on the path, in order."); }
      finally { b.delete(); spine.delete(); }
    }
    const b = new OC.BRepOffsetAPI_ThruSections(true, !!node.ruled, 1e-6);
    try {
      b.CheckCompatibility(true);
      
      const wires = [];
      secs.forEach((s, i) => {
        if (s.pt) b.AddVertex(vtx(s.pt));
        else { const w = wireFor(s, loopOf(s), along(i)); wires.push(w); b.AddWire(w); }
      });
      b.Build();
      if (!b.IsDone()) throw new Error("x");
      return upright(R.cast(b.Shape()));
    } catch (e) { throw new Error("Couldn't loft these profiles. Try the Straight option, or profiles with similar shapes."); }
    finally { b.delete(); }
  };
  try {
    const closedLoop = node.closed && !secs[0].pt && !secs[secs.length - 1].pt && secs.length >= 3 && !(node.railSegs && node.railSegs.length);
    // a closed loop: the open loft through every section, plus a piece from the last back to the first
    const loftAll = (loopOf) => {
      if (!closedLoop) return loftOf(loopOf);
      const a = loftOf(loopOf);
      const keepSecs = secs;
      secs = [keepSecs[keepSecs.length - 1], keepSecs[0]];
      let b;
      try { b = loftOf(loopOf); } finally { secs = keepSecs; }
      const u = a.fuse(b); a.delete(); b.delete();
      return u;
    };
    let out = loftAll((s) => s.region.outer);
    if (!(Math.abs(safeVolume(out)) > 1e-9)) throw new Error("The loft came out empty. Check the profile order.");
    // holes that line up through every section are lofted too, then cut away
    const nh = regs[0].region.holes ? regs[0].region.holes.length : 0;
    if (nh && !secs.some((s) => s.pt) && regs.every((s) => (s.region.holes || []).length === nh)) {
      for (let h = 0; h < nh; h++) {
        try {
          const hs = loftAll((s) => s.region.holes[h]);
          const c = out.cut(hs); out.delete(); hs.delete(); out = c;
        } catch (e) { /* a hole that can't be lofted is left solid */ }
      }
    }
    return out;
  } finally { for (const k of keep) k.delete(); }
}
// a solid whose skin faces inward measures negative: turn it right side out
function centerOfMass(sh) {
  const props = new OC.GProp_GProps();
  OC.BRepGProp.VolumeProperties(sh.wrapped, props, false, false, false);
  const c = props.CentreOfMass();
  const out = [c.X(), c.Y(), c.Z()];
  props.delete();
  return out;
}
function upright(sh) {
  if (safeVolume(sh) < 0) { const r = R.cast(sh.wrapped.Reversed()); sh.delete(); return r; }
  return sh;
}
function loopCenter(loop) {
  let x = 0, y = 0, n = 0;
  for (const s of loop) { const p = s.t === "circle" ? s.c : s.a; x += p[0]; y += p[1]; n++; }
  return [x / n, y / n];
}
// ---------------------------------------------------------------- mirror
// a body mirrored across a plane (world space): node.src is the source body's node, node.srcM its placement
function buildMirror(node) {
  if (!node.src) throw new Error("The body to mirror is gone");
  const shape = transformShape(evalNode(node.src), node.srcM);
  const p = node.plane;
  const trsf = new OC.gp_Trsf();
  const ax = new OC.gp_Ax2(new OC.gp_Pnt(p.o[0], p.o[1], p.o[2]), new OC.gp_Dir(p.n[0], p.n[1], p.n[2]));
  trsf.SetMirror(ax);
  const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
  const out = R.cast(op.Shape());
  op.delete(); trsf.delete(); ax.delete(); shape.delete();
  return out;
}

// ---------------------------------------------------------------- edge / face matching
function edgeSig(edge, bb) {
  const a = edge.startPoint.toTuple(), b = edge.endPoint.toTuple();
  const m = edge.pointAt(0.5).toTuple();
  const n = m.map((v, i) => (bb.size[i] > 1e-9 ? (v - bb.min[i]) / bb.size[i] : 0.5));
  return { a, b, m, n, t: edge.geomType };
}
function bboxOf(shape) {
  const bb = shape.boundingBox;
  const [min, max] = bb.bounds;
  bb.delete();
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
// radius for a chord-length fillet on each edge: chord = 2 r sin(a / 2), a being the
// angle between the two faces' normals at the middle of the edge
function chordRadii(shape, radius) {
  const out = new Map();
  const faces = shape.faces;
  const owners = new Map();
  for (const f of faces) for (const e of f.edges) { const h = e.hashCode; if (radius.has(h)) { if (!owners.has(h)) owners.set(h, { e, fs: [] }); else e.delete(); owners.get(h).fs.push(f); } else e.delete(); }
  for (const [h, { e, fs }] of owners) {
    const set = radius.get(h);
    if (set.rt !== "chord" || fs.length < 2) continue;
    try {
      const p = e.pointAt(0.5);
      const n1 = fs[0].normalAt(p).toTuple(), n2 = fs[1].normalAt(p).toTuple();
      const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
      const a = Math.acos(Math.abs(dot) > 0.99999 ? Math.sign(dot) : dot);
      const sn = Math.sin(a / 2);
      if (sn > 1e-6) out.set(h, set.r / (2 * sn));
    } catch (err) {}
  }
  for (const { e } of owners.values()) e.delete();
  faces.forEach((f) => f.delete());
  return out;
}
function matchEdges(shape, sigs) {
  // Returns a Set of edge hashCodes matching the stored signatures. Exact
  // positional match first; otherwise the closest edge in the shape's
  // normalized bounding box, so fillets survive resizing.
  const bb = bboxOf(shape);
  const edges = shape.edges;
  const cand = edges.map((e) => ({ e, s: edgeSig(e, bb), h: e.hashCode }));
  const tol = Math.max(1e-3, Math.max(...bb.size) * 1e-5);
  const out = new Set();
  for (const sig of sigs) {
    let best = null, bd = Infinity;
    for (const c of cand) {
      const d = dist(c.s.m, sig.m);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < tol) { out.add(best.h); continue; }
    best = null; bd = Infinity;
    for (const c of cand) {
      if (sig.t && c.s.t !== sig.t) continue;
      const d = dist(c.s.n, sig.n);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < 0.04) out.add(best.h);
  }
  edges.forEach((e) => e.delete());
  return out;
}

// ---------------------------------------------------------------- modifiers
function applyMod(shape, mod) {
  switch (mod.t) {
    case "fillet":
    case "chamfer": {
      // one or more selection sets, each with its own size; a fillet's radius can be
      // constant, variable (start to end) or set by chord length, like Fusion 360
      const isF = mod.t === "fillet";
      const sets = mod.sets && mod.sets.length ? mod.sets : [{ edges: mod.edges || [], r: isF ? mod.r : mod.d }];
      const radius = new Map(); // edge hash -> radius config
      for (const set of sets) {
        const hits = matchEdges(shape, set.edges || []);
        for (const h of hits) radius.set(h, set);
      }
      if (!radius.size) throw new Error(`${isF ? "Fillet" : "Chamfer"}: its edges no longer exist`);
      const chordOf = isF && sets.some((x) => x.rt === "chord") ? chordRadii(shape, radius) : null;
      const valueOf = (h, k) => {
        const set = radius.get(h);
        if (!set) return null;
        if (!isF) return set.r * k;
        if (set.rt === "variable") return [set.r * k, (set.r2 ?? set.r) * k];
        if (set.rt === "chord") return (chordOf.get(h) || set.r) * k;
        return set.r * k;
      };
      const attempt = (k) => {
        const fn = (e) => valueOf(e.hashCode, k);
        return isF ? shape.fillet(fn) : shape.chamfer(fn);
      };
      let out;
      try {
        out = attempt(1);
      } catch (e) {
        // find roughly the largest size that does fit, so the message can say what to use
        let lo = 0, hi = 1;
        const t0 = Date.now();
        for (let n = 0; n < 7 && Date.now() - t0 < 2500; n++) {
          const mid = (lo + hi) / 2;
          try { const r = attempt(mid); r.delete(); lo = mid; } catch (err) { hi = mid; }
        }
        const main = sets[0].r;
        const fit = Math.floor(main * lo * 0.98 * 10) / 10;
        const what = isF ? "Fillet radius" : "Chamfer distance";
        throw new Error(`${what} ${main} mm is too large for the selected edges.` + (fit > 0 ? ` The largest that fits is about ${fit} mm.` : " Try a much smaller size."));
      }
      shape.delete();
      return out;
    }
    case "hole": {
      const spots = mod.at && mod.at.length ? mod.at : [{ p: mod.p, n: mod.n }];
      let cur = shape;
      for (const s of spots) {
        const tool = holeTool(cur, { ...mod, p: s.p, n: s.n });
        const out = cur.cut(tool);
        tool.delete(); cur.delete();
        cur = out;
      }
      // tapped holes: a modeled thread on each hole's wall
      if (mod.tapped && mod.pitch > 0) {
        for (const s of spots) {
          const c = holeWallCenter(cur, s.p, s.n, mod.dia / 2);
          if (!c) continue;
          cur = applyMod(cur, { t: "thread", face: { c, t: "CYLINDRE" }, pitch: mod.pitch, length: mod.through ? 0 : mod.depth, clear: mod.clear || 0 });
        }
      }
      return cur;
    }
    case "bool": {
      const tool = transformShape(evalNode(mod.tool), mod.m);
      let out;
      if (mod.op === "cut") out = shape.cut(tool);
      else if (mod.op === "intersect") out = shape.intersect(tool);
      else out = shape.fuse(tool);
      tool.delete(); shape.delete();
      return out;
    }
    case "halfspace": {
      // Split body: keep the part of the body on one side of a plane (body coordinates)
      const p = mod.plane, n = Vec.norm(p.n).map((v) => v * (mod.side < 0 ? -1 : 1));
      const B = 1e4;
      const x = perpTo(n, null);
      const sk = R.drawRectangle(2 * B, 2 * B).sketchOnPlane(new R.Plane(p.o, x, n));
      const slab = sk.extrude(B);
      const out = shape.intersect(slab);
      shape.delete(); slab.delete();
      if (!(Math.abs(safeVolume(out)) > 1e-9)) { out.delete(); throw new Error("Split body: nothing of the body is on this side of the plane"); }
      return out;
    }
    case "sketchsplit": {
      // Split body with a sketch: the curves are pushed straight through the body (along the
      // sketch's normal) and cut it apart. Pieces are sorted to a side: inside / outside a closed
      // shape, or left / right of an open line. This body keeps mod.side.
      const w = sweepPath(mod.curves);
      const L = 4e3, n = Vec.norm(mod.plane.n);
      const moved = R.cast(w.translate(-n[0] * L / 2, -n[1] * L / 2, -n[2] * L / 2).wrapped);
      const pr = new OC.BRepPrimAPI_MakePrism(moved.wrapped, new OC.gp_Vec(n[0] * L, n[1] * L, n[2] * L), false, true);
      const sheet = R.cast(pr.Shape());
      pr.delete();
      const sp = new OC.BRepAlgoAPI_Splitter();
      const args = new OC.NCollection_List_TopoDS_Shape(); args.Append(shape.wrapped);
      const tools = new OC.NCollection_List_TopoDS_Shape(); tools.Append(sheet.wrapped);
      sp.SetArguments(args); sp.SetTools(tools); sp.Build();
      const all = R.cast(sp.Shape());
      sp.delete(); sheet.delete();
      const pieces = [];
      const ex = new OC.TopExp_Explorer(all.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
      for (; ex.More(); ex.Next()) pieces.push(R.cast(OC.TopoDS.Solid(ex.Current())));
      ex.delete();
      if (pieces.length < 2) { pieces.forEach((p) => p.delete()); throw new Error("Split body: the sketch doesn't cut through the body"); }
      // which side of the sketch a piece is on, measured in the sketch plane
      const P = mod.plane, y = Vec.cross(n, Vec.norm(P.x)), x = Vec.norm(P.x);
      const to2 = (q) => { const d = Vec.sub(q, P.o); return [Vec.dot(d, x), Vec.dot(d, y)]; };
      const poly = mod.poly;
      const inside = (pt) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
      const leftOf = (pt) => {
        let bd = Infinity, side = 0;
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1]);
          if (d < bd) { bd = d; side = dx * (pt[1] - a[1]) - dy * (pt[0] - a[0]); }
        }
        return side > 0;
      };
      const distTo = (pt) => { let bd = Infinity; const m = mod.closed ? poly.length : poly.length - 1; for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); bd = Math.min(bd, Math.hypot(a[0] + dx * t - pt[0], a[1] + dy * t - pt[1])); } return bd; };
      const keep = [];
      for (const pc of pieces) {
        // a corner of the piece far from the sketch tells which side the whole piece is on
        let q = to2(centerOfMass(pc));
        try {
          const ms = pc.mesh({ tolerance: 2, angularTolerance: 0.6 });
          let bd = distTo(q); // the centre counts too (a solid inside a closed shape has no far corners)
          for (let i = 0; i < ms.vertices.length; i += 3) { const v = to2([ms.vertices[i], ms.vertices[i + 1], ms.vertices[i + 2]]); const d = distTo(v); if (d > bd) { bd = d; q = v; } }
        } catch (e) { /* keep the centre */ }
        const a = mod.closed ? inside(q) : leftOf(q);
        if ((mod.side === "a") === a) keep.push(pc); else pc.delete();
      }
      all.delete(); shape.delete();
      if (!keep.length) throw new Error("Split body: nothing of the body is on this side of the sketch");
      let out = keep[0];
      for (let i = 1; i < keep.length; i++) { const f = out.fuse(keep[i]); out.delete(); keep[i].delete(); out = f; }
      return out;
    }
    case "splitface": {
      // Split face: draw dividing edges onto the picked faces; the body stays one solid
      const faces = shape.faces;
      const picked = [];
      for (const q of mod.faces || []) {
        let best = null, bd = Infinity;
        for (const f of faces) {
          if (q.t && f.geomType !== q.t) continue;
          if (f.geomType === "PLANE" && q.n) { let nn; try { nn = f.normalAt().toTuple(); } catch (e) { continue; } if (nn[0] * q.n[0] + nn[1] * q.n[1] + nn[2] * q.n[2] < 0.999) continue; }
          const d = dist(f.center.toTuple(), q.c);
          if (d < bd) { bd = d; best = f; }
        }
        if (best && !picked.includes(best)) picked.push(best);
      }
      if (!picked.length) { faces.forEach((f) => f.delete()); throw new Error("Split face: the picked face no longer exists"); }
      // the splitting tool: a plane, or sketch curves pushed along their sketch's normal into a sheet
      let sheet = null;
      if (mod.curves && mod.curves.length) {
        const w = sweepPath(mod.curves);
        const L = 2e3, n = Vec.norm(mod.dir || [0, 0, 1]);
        const moved = R.cast(w.translate(-n[0] * L, -n[1] * L, -n[2] * L).wrapped);
        const pr = new OC.BRepPrimAPI_MakePrism(moved.wrapped, new OC.gp_Vec(n[0] * 2 * L, n[1] * 2 * L, n[2] * 2 * L), false, true);
        sheet = R.cast(pr.Shape());
        pr.delete();
      }
      const edges = new OC.NCollection_List_TopoDS_Shape();
      let count = 0;
      for (const f of picked) {
        const sec = mod.plane
          ? new OC.BRepAlgoAPI_Section(f.wrapped, new OC.gp_Pln(new OC.gp_Pnt(mod.plane.o[0], mod.plane.o[1], mod.plane.o[2]), new OC.gp_Dir(mod.plane.n[0], mod.plane.n[1], mod.plane.n[2])), true)
          : new OC.BRepAlgoAPI_Section(f.wrapped, sheet.wrapped, true);
        const res = R.cast(sec.Shape());
        const ne = res.edges.length;
        if (ne) { edges.Append(res.wrapped); count += ne; }
        sec.delete();
      }
      faces.forEach((f) => f.delete());
      if (sheet) sheet.delete();
      if (!count) throw new Error("Split face: the splitting tool doesn't cross the picked faces");
      const sp = new OC.BRepAlgoAPI_Splitter();
      const args = new OC.NCollection_List_TopoDS_Shape();
      args.Append(shape.wrapped);
      sp.SetArguments(args); sp.SetTools(edges);
      sp.Build();
      let out = R.cast(sp.Shape());
      sp.delete();
      // the splitter wraps its result in a compound: take the solid back out
      if (out.wrapped.ShapeType() === OC.TopAbs_ShapeEnum.TopAbs_COMPOUND) {
        const ex = new OC.TopExp_Explorer(out.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
        if (ex.More()) { const so = R.cast(OC.TopoDS.Solid(ex.Current())); ex.delete(); out = so; } else ex.delete();
      }
      shape.delete();
      return out;
    }
    case "offset": {
      // Offset face (Fusion's Press Pull): push a face out (+) or in (-). Works on flat
      // and curved faces: the face is thickened into a slab that is added or removed.
      const dist0 = mod.d || 0;
      if (Math.abs(dist0) < 1e-6) return shape;
      let cur = shape;
      for (const q of mod.faces || []) {
        const faces = cur.faces;
        let best = null, bd = Infinity;
        for (const f of faces) {
          const t = f.geomType;
          if (q.t && t !== q.t) continue;
          if (t === "PLANE" && q.n) {
            let n;
            try { n = f.normalAt().toTuple(); } catch (e) { continue; }
            if (n[0] * q.n[0] + n[1] * q.n[1] + n[2] * q.n[2] < 0.999) continue;
          }
          const d = dist(f.center.toTuple(), q.c);
          if (d < bd) { bd = d; best = f; }
        }
        if (!best) { faces.forEach((f) => f.delete()); throw new Error("Offset face: the picked face no longer exists"); }
        // a cylinder or sphere split into several faces is offset as one surface, like Fusion
        const sig = surfaceSig(best);
        const group = sig ? faces.filter((f) => f === best || sameSurface(surfaceSig(f), sig)) : [best];
        let slab = null;
        for (const f of group) {
          const piece = thickenFace(f, dist0, q);
          if (!slab) slab = piece;
          else { const u = slab.fuse(piece); slab.delete(); piece.delete(); slab = u; }
        }
        faces.forEach((f) => f.delete());
        let out;
        try { out = dist0 > 0 ? cur.fuse(slab) : cur.cut(slab); }
        catch (e) { slab.delete(); throw new Error("Offset face couldn't be built with this distance"); }
        slab.delete();
        cur.delete();
        cur = out;
      }
      return cur;
    }
    case "shell": {
      const t = Math.abs(mod.th || 1);
      const dir = mod.dir === "out" || mod.dir === "both" ? mod.dir : "in";
      // faces to remove are stored by their center; pick the nearest face for each
      const bb = bboxOf(shape);
      const faces = shape.faces;
      const cands = faces.map((f) => ({ h: f.hashCode, c: f.center.toTuple() }));
      faces.forEach((f) => f.delete());
      const open = new Set();
      for (const q of mod.faces || []) {
        let best = null, bd = Infinity;
        for (const c of cands) { const d = dist(c.c, q.c); if (d < bd) { bd = d; best = c; } }
        if (best && bd < Math.max(0.5, Math.hypot(...bb.size) * 0.05)) open.add(best.h);
      }
      if ((mod.faces || []).length && !open.size) throw new Error("Shell: the faces to remove weren't found. Edit the shell and pick them again.");
      if (mod.chain) tangentChain(shape, open);
      // removing every face leaves nothing to keep: make a closed, hollow body instead
      if (open.size >= cands.length) open.clear();
      const vIn = safeVolume(shape);
      const out = shellSolid(shape, t, open, dir, vIn);
      if (!out) throw new Error(`Shell: couldn't make a ${t} mm wall here. Try a thinner wall${dir === "in" ? ", or Outside" : ""}.`);
      shape.delete();
      return out;
    }
    case "emboss": {
      const tool = embossTool(mod);
      let out;
      try {
        if (mod.mode === "deboss") out = cutAll(shape, [tool]);
        else out = shape.fuse(tool);
      } finally { tool.delete(); }
      if (!out) throw new Error("The text couldn't be cut into this face");
      shape.delete();
      return out;
    }
    case "thread": {
      const { groove, clipped, crest } = threadGroove(shape, mod);
      // the print offset's crest relief first (a plain ring), then the helical groove
      if (crest) {
        const relieved = cutAll(shape, [crest]);
        crest.delete();
        if (relieved && safeVolume(relieved) > 1e-9) { shape.delete(); shape = relieved; }
        else if (relieved) relieved.delete();
      }
      const v0 = safeVolume(shape);
      // a cut must remove material; anything else is a broken boolean
      const good = (r) => { if (!r) return false; const v = safeVolume(r); return v > 1e-9 && v < v0 - 1e-6; };
      let out = cutAll(shape, [groove]);
      if (!good(out)) {
        if (out) out.delete();
        const g2 = clipped();
        out = cutAll(shape, [g2]);
        g2.delete();
      }
      groove.delete();
      if (!good(out)) { if (out) out.delete(); throw new Error("Thread couldn't be cut here. Try a larger pitch or a shorter length."); }
      shape.delete();
      return out;
    }
    case "scale": return scaleShape(shape, mod.k, mod.o);
    default:
      throw new Error("Unknown feature " + mod.t);
  }
}

// Try OpenCascade's thick-solid with a few join styles and tolerances; keep the
// first result that really hollowed the body.
// ---------------------------------------------------------------- shell
// Shell a solid: walls of thickness t, inside (in), outside (out) or centered (both) on the
// surface, with the chosen faces left open (none: a closed, hollow body). OpenCascade's
// thick-solid first; when that can't cope (complex blends, booleans, many surface types),
// offset copies of the whole body are subtracted and the openings cut through.
function shellSolid(shape, t, open, dir, vIn) {
  const ok = (sh, more) => { const v = safeVolume(sh); return v > 1e-6 && (more ? v > vIn * 1.002 : v < vIn * 0.998); };
  // a wall can't hold much more than (area of the kept surface) x thickness; OpenCascade
  // sometimes "succeeds" by hollowing only part of a body, which this catches
  let keptArea = 0;
  for (const f of shape.faces) { if (!open.has(f.hashCode)) try { keptArea += R.measureArea(f); } catch (e) {} f.delete(); }
  const sane = (sh) => {
    if (!sh) return null;
    const v = safeVolume(sh);
    if (dir === "in" && keptArea > 0 && !(v < keptArea * t * 1.25 && v > keptArea * t * 0.25)) { sh.delete(); return null; }
    return sh;
  };
  if (open.size && dir !== "both") {
    const r = sane(thickSolid(shape, dir === "out" ? t : -t, open, vIn, dir === "out"));
    if (r) return r;
    // split coplanar faces (left by booleans) confuse it: merge them and retry
    const u = unified(shape);
    if (u) {
      const open2 = remapFaces(shape, u, open);
      const r2 = open2.size ? sane(thickSolid(u, dir === "out" ? t : -t, open2, vIn, dir === "out")) : null;
      if (r2) { u.delete(); return r2; }
      u.delete();
    }
  }
  // offset-and-subtract
  let outer = null, inner = null, walls = null;
  try {
    if (dir === "in") { inner = offsetSolid(shape, -t, vIn, false); if (!inner) return null; walls = shape.cut(inner); }
    else if (dir === "out") { outer = offsetSolid(shape, t, vIn, true); if (!outer) return null; walls = outer.cut(shape); }
    else {
      outer = offsetSolid(shape, t / 2, vIn, true); inner = offsetSolid(shape, -t / 2, vIn, false);
      if (!outer || !inner) return null;
      walls = outer.cut(inner);
    }
    if (!walls || !(safeVolume(walls) > 1e-6)) return null;
    if (!open.size) { const w = walls; walls = null; return w; }
    // the hollow inside, which each opening reaches
    const cavity = dir === "out" ? shape : inner;
    const tools = [];
    for (const f of shape.faces) {
      if (!open.has(f.hashCode)) { f.delete(); continue; }
      try { tools.push(openingTool(f, t, dir, cavity)); } catch (e) {}
      f.delete();
    }
    const cut = tools.length ? cutAll(walls, tools) : null;
    tools.forEach((x) => x && x.delete && x.delete());
    if (cut && ok(cut)) { walls.delete(); walls = null; return cut; }
    if (cut) cut.delete();
    return null;
  } catch (e) {
    return null;
  } finally {
    if (walls) walls.delete();
    if (inner) inner.delete();
    if (outer) outer.delete();
  }
}
function thickSolid(shape, d, openHashes, vIn, grows) {
  const faces = shape.faces.filter((f) => openHashes.has(f.hashCode));
  const tries = [
    [OC.GeomAbs_JoinType.GeomAbs_Arc, 1e-3, false],
    [OC.GeomAbs_JoinType.GeomAbs_Intersection, 1e-3, false],
    [OC.GeomAbs_JoinType.GeomAbs_Arc, 1e-4, true],
    [OC.GeomAbs_JoinType.GeomAbs_Intersection, 1e-2, true],
  ];
  try {
    for (const [join, tol, inter] of tries) {
      const list = new OC.NCollection_List_TopoDS_Shape();
      for (const f of faces) list.Append(f.wrapped);
      const b = new OC.BRepOffsetAPI_MakeThickSolid();
      let res = null;
      try {
        b.MakeThickSolidByJoin(shape.wrapped, list, d, tol, OC.BRepOffset_Mode.BRepOffset_Skin, inter, false, join, false);
        if (b.IsDone()) {
          const sh = R.cast(b.Shape());
          const v = safeVolume(sh);
          // inside walls: less than the body; outside walls: more than... the walls alone are
          // smaller than the grown body, so only check they're a sensible solid
          if (v > 1e-6 && (grows ? validSolid(sh) : v < vIn * 0.995)) res = sh; else sh.delete();
        }
      } catch (e) { res = null; }
      b.delete(); list.delete();
      if (res) return res;
    }
    return null;
  } finally { faces.forEach((f) => f.delete()); }
}
function validSolid(sh) {
  try { const a = new OC.BRepCheck_Analyzer(sh.wrapped, true, false); const v = a.IsValid(); a.delete(); return v; } catch (e) { return true; }
}
// The whole body grown (d > 0) or shrunk (d < 0) by |d|, as a solid.
function offsetSolid(shape, d, vIn, grows) {
  const good = (sh) => { const v = safeVolume(sh); return v > 1e-6 && (grows ? v > vIn * 1.0005 : v < vIn * 0.9995); };
  const attempts = [
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-3, OC.BRepOffset_Mode.BRepOffset_Skin, false, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false),
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-3, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false),
    (b) => b.PerformByJoin(shape.wrapped, d, 1e-2, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Intersection, false),
    (b) => b.PerformBySimple(shape.wrapped, d),
  ];
  for (const run of attempts) {
    const b = new OC.BRepOffsetAPI_MakeOffsetShape();
    let res = null;
    try {
      run(b);
      if (b.IsDone()) {
        let sh = R.cast(b.Shape());
        sh = asSolid(sh);
        if (sh && good(sh)) res = sh; else if (sh) sh.delete();
      }
    } catch (e) { res = null; }
    b.delete();
    if (res) return res;
  }
  // last resort for unified faces
  const u = unified(shape);
  if (u) {
    const b = new OC.BRepOffsetAPI_MakeOffsetShape();
    let res = null;
    try {
      b.PerformByJoin(u.wrapped, d, 1e-2, OC.BRepOffset_Mode.BRepOffset_Skin, true, false, OC.GeomAbs_JoinType.GeomAbs_Arc, false);
      if (b.IsDone()) { const sh = asSolid(R.cast(b.Shape())); if (sh && good(sh)) res = sh; else if (sh) sh.delete(); }
    } catch (e) {}
    b.delete(); u.delete();
    if (res) return res;
  }
  return null;
}
// offset results can come back as a shell or compound: make a solid of them
function asSolid(sh) {
  if (!sh) return null;
  if (sh.constructor && sh.constructor.name === "Solid") return sh;
  try {
    const ex = new OC.TopExp_Explorer(sh.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (ex.More()) { const s = R.cast(OC.TopoDS.Solid(ex.Current())); ex.delete(); return s; }
    ex.delete();
  } catch (e) {}
  try {
    const ex = new OC.TopExp_Explorer(sh.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (ex.More()) {
      const mk = new OC.BRepBuilderAPI_MakeSolid(OC.TopoDS.Shell(ex.Current()));
      ex.delete();
      if (mk.IsDone()) { const s = R.cast(mk.Solid()); mk.delete(); const fx = fixSolid(s); return fx; }
      mk.delete();
    } else ex.delete();
  } catch (e) {}
  return null;
}
function fixSolid(s) {
  try { const f = new OC.ShapeFix_Solid(); f.Init(s.wrapped); f.Perform(new OC.Message_ProgressRange()); const r = R.cast(f.Solid()); f.delete(); s.delete(); return r; } catch (e) { return s; }
}
function unified(shape) {
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete();
    return s2;
  } catch (e) { return null; }
}
function unifiedTol(shape, lin, ang) {
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false);
    u.SetLinearTolerance(lin);
    u.SetAngularTolerance(ang);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete();
    return s2;
  } catch (e) { return null; }
}
// faces of b at the same places as the chosen faces of a (by center and normal)
function remapFaces(a, b, hashes) {
  const want = [];
  for (const f of a.faces) { if (hashes.has(f.hashCode)) want.push(f.center.toTuple()); f.delete(); }
  const out = new Set();
  const fb = b.faces;
  for (const f of fb) {
    const c = f.center.toTuple();
    // a merged face's center can move: keep it when a wanted center lies on it
    if (want.some((w) => dist(w, c) < 1e-3 || onFace(f, w))) out.add(f.hashCode);
    f.delete();
  }
  return out;
}
function onFace(f, p) {
  try { const v = R.makeVertex(p); const d = R.measureDistanceBetween ? R.measureDistanceBetween(v, f) : NaN; v.delete(); return d < 1e-4; } catch (e) { return false; }
}
// Add the faces that run smoothly (tangent) on from the chosen ones, like Fusion's
// "Tangent chain": clicking a rounded rim takes the whole rim.
function tangentChain(shape, open) {
  const faces = shape.faces;
  const byHash = new Map(faces.map((f) => [f.hashCode, f]));
  const edgeFaces = new Map(); // edge hash -> [{face hash, edge}]
  for (const f of faces) for (const e of f.edges) {
    const k = e.hashCode;
    if (!edgeFaces.has(k)) edgeFaces.set(k, []);
    edgeFaces.get(k).push({ f: f.hashCode, e });
  }
  const queue = [...open];
  try {
    while (queue.length) {
      const h = queue.pop();
      const f = byHash.get(h);
      if (!f) continue;
      for (const e of f.edges) {
        const list = edgeFaces.get(e.hashCode) || [];
        let p = null;
        for (const o of list) {
          if (o.f === h || open.has(o.f)) continue;
          if (!p) try { p = e.pointAt(0.5); } catch (err) { break; }
          try {
            const n1 = f.normalAt(p).toTuple(), n2 = byHash.get(o.f).normalAt(p).toTuple();
            const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
            if (Math.abs(dot) > 0.9995) { open.add(o.f); queue.push(o.f); }
          } catch (err) {}
        }
        if (p) p.delete && p.delete();
        e.delete();
      }
    }
  } finally {
    for (const l of edgeFaces.values()) for (const o of l) try { o.e.delete(); } catch (e) {}
    faces.forEach((f) => f.delete());
  }
}
// The piece of wall to cut away so a removed face becomes an opening: a slab through the
// wall at that face, limited (on flat faces) to the area over the hollow inside.
function openingTool(face, t, dir, cavity) {
  const eps = Math.max(0.05, t * 0.05);
  const n = face.normalAt().toTuple(); // outward
  const span = dir === "in" ? [-(t + eps), eps] : dir === "out" ? [-eps, t + eps] : [-(t / 2 + eps), t / 2 + eps];
  const slabOf = (a, b) => {
    // slab from a to b along the normal (a < b)
    if (face.geomType === "PLANE") {
      const base = face.clone().translate(n.map((v) => v * a));
      const s = R.basicFaceExtrusion(base, new R.Vector(n).multiply(b - a));
      base.delete();
      return s;
    }
    const lo = a < 0 ? thickenFace(face, a) : null, hi = b > 0 ? thickenFace(face, b) : null;
    if (lo && hi) return lo.fuse(hi);
    return lo || hi;
  };
  const slab = slabOf(span[0], span[1]);
  if (face.geomType !== "PLANE") return slab;
  // only over the hollow: the inside pushed out through this face
  const reach = cavity.clone().translate(n.map((v) => v * (t + eps * 2)));
  const pushed = cavity.clone().fuse(reach);
  reach.delete();
  const tool = slab.intersect(pushed);
  slab.delete(); pushed.delete();
  return tool;
}
// axis/center + radius of a cylindrical or spherical face, for grouping split faces
function surfaceSig(face) {
  const t = face.geomType;
  if (t === "PLANE") return null;
  const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const ST = OC.GeomAbs_SurfaceType, k = ad.GetType();
    const P = (p) => [p.X(), p.Y(), p.Z()];
    if (k === ST.GeomAbs_Cylinder) { const c = ad.Cylinder(), a = c.Position(); return { k: "cyl", o: P(a.Location()), d: P(a.Direction()), r: c.Radius() }; }
    if (k === ST.GeomAbs_Sphere) { const c = ad.Sphere(); return { k: "sph", o: P(c.Position().Location()), r: c.Radius() }; }
    return null;
  } catch (e) { return null; } finally { ad.delete(); }
}
function sameSurface(a, b) {
  if (!a || !b || a.k !== b.k || Math.abs(a.r - b.r) > 1e-6) return false;
  if (a.k === "sph") return dist(a.o, b.o) < 1e-6;
  const dot = a.d[0] * b.d[0] + a.d[1] * b.d[1] + a.d[2] * b.d[2];
  if (Math.abs(Math.abs(dot) - 1) > 1e-9) return false;
  // same axis line: the offset between origins runs along the axis
  const w = [b.o[0] - a.o[0], b.o[1] - a.o[1], b.o[2] - a.o[2]];
  const along = w[0] * a.d[0] + w[1] * a.d[1] + w[2] * a.d[2];
  return Math.hypot(w[0] - along * a.d[0], w[1] - along * a.d[1], w[2] - along * a.d[2]) < 1e-6;
}
// A solid between a face and its offset copy (d along the face's outward normal).
// Flat faces: a prism. Cylinders and spheres: an exact revolved slab. Anything else:
// a thickened copy, checked against the face area so a bad result is rejected.
function thickenFace(face, d, q) {
  const t = face.geomType;
  if (t === "PLANE") {
    let n = q && q.n;
    if (!n) n = face.normalAt().toTuple();
    return R.basicFaceExtrusion(face, new R.Vector(n).multiply(d));
  }
  const ad = new OC.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const kind = ad.GetType();
    const ST = OC.GeomAbs_SurfaceType;
    const uv = OC.BRepTools.UVBounds(face.wrapped, 0, 0, 0, 0);
    const reversed = face.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
    const P = (p) => [p.X(), p.Y(), p.Z()];
    if (kind === ST.GeomAbs_Cylinder || kind === ST.GeomAbs_Sphere) {
      const surf = kind === ST.GeomAbs_Cylinder ? ad.Cylinder() : ad.Sphere();
      const pos = surf.Position();
      const r = surf.Radius();
      const direct = pos.Direct();
      const loc = P(pos.Location()), dir = P(pos.Direction()), xd = P(pos.XDirection()), yd = P(pos.YDirection());
      const s = (direct ? 1 : -1) * (reversed ? -1 : 1); // outward of the material, in radius terms
      const r2 = r + s * d;
      if (r2 <= 1e-6) throw new Error(`Offset face: ${Math.abs(d)} mm would close this ${kind === ST.GeomAbs_Cylinder ? "hole or cylinder" : "sphere"} completely`);
      const lo = Math.min(r, r2), hi = Math.max(r, r2);
      const u0 = uv.UMin, u1 = uv.UMax;
      const radial = [0, 1, 2].map((i) => Math.cos(u0) * xd[i] + Math.sin(u0) * yd[i]);
      const axis = direct ? dir : dir.map((v) => -v);
      const normal = [radial[1] * dir[2] - radial[2] * dir[1], radial[2] * dir[0] - radial[0] * dir[2], radial[0] * dir[1] - radial[1] * dir[0]];
      let dr;
      if (kind === ST.GeomAbs_Cylinder) {
        const v0 = uv.VMin, v1 = uv.VMax;
        dr = R.draw([lo, v0]).lineTo([hi, v0]).lineTo([hi, v1]).lineTo([lo, v1]).close();
      } else {
        const v0 = uv.VMin, v1 = uv.VMax, vm = (v0 + v1) / 2;
        const pt = (rr, v) => [rr * Math.cos(v), rr * Math.sin(v)];
        let pen = R.draw(pt(lo, v0)).lineTo(pt(hi, v0)).threePointsArcTo(pt(hi, v1), pt(hi, vm)).lineTo(pt(lo, v1));
        dr = lo > 1e-6 ? pen.threePointsArcTo(pt(lo, v0), pt(lo, vm)).close() : pen.close();
      }
      const sweep = ((u1 - u0) * 180) / Math.PI;
      const sk = dr.sketchOnPlane(new R.Plane(loc, radial, normal));
      return sk.revolve(axis, { origin: loc, angle: Math.min(360, sweep) });
    }
  } finally { ad.delete(); }
  // other curved faces: thicken, then make sure the result is about the right size
  const b = new OC.BRepOffsetAPI_MakeThickSolid();
  let out = null;
  try {
    b.MakeThickSolidBySimple(face.wrapped, d);
    if (b.IsDone()) {
      let sh = R.cast(b.Shape());
      let v = safeVolume(sh);
      // thickening outward can come back inside-out: turn it the right way round
      if (v < 0) { const r = R.cast(sh.wrapped.Reversed()); sh.delete(); sh = r; v = safeVolume(sh); }
      let area = NaN;
      try { area = R.measureArea(face); } catch (e) {}
      const expect = area * Math.abs(d);
      if (v > 1e-9 && (!(expect > 0) || (v > expect * 0.6 && v < expect * 1.6))) out = sh; else sh.delete();
    }
  } catch (e) { out = null; }
  b.delete();
  if (!out) throw new Error("Offset face works on flat, cylindrical and spherical faces. This face shape isn't supported yet.");
  return out;
}
// ---------------------------------------------------------------- threads
// Is point p inside the solid? (a tiny cube intersected with the body)
function insideAt(shape, p, e = 0.01) {
  const cube = R.makeBox([p[0] - e, p[1] - e, p[2] - e], [p[0] + e, p[1] + e, p[2] + e]);
  let v = 0;
  try { const c = shape.intersect(cube); v = safeVolume(c); c.delete(); } catch (err) { v = 0; }
  cube.delete();
  return v > 1e-9;
}
// Axis, radius, axial range and material side of the cylinder a thread goes on.
export function cylinderInfo(shape, q) {
  const faces = shape.faces;
  try {
    let best = null, bd = Infinity;
    for (const f of faces) {
      if (f.geomType !== "CYLINDRE") continue;
      const d = dist(f.center.toTuple(), q.c);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) throw new Error("Thread: pick a cylindrical face (a round hole or a round boss)");
    const sig = surfaceSig(best);
    const group = faces.filter((f) => f === best || sameSurface(surfaceSig(f), sig));
    const o = sig.o, d = sig.d;
    let t0 = Infinity, t1 = -Infinity, side = 0;
    const P = (p) => [p.X(), p.Y(), p.Z()];
    for (const f of group) {
      const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
      try {
        const pos = ad.Cylinder().Position();
        const loc = P(pos.Location()), dir = P(pos.Direction());
        const uv = OC.BRepTools.UVBounds(f.wrapped, 0, 0, 0, 0);
        const base = (loc[0] - o[0]) * d[0] + (loc[1] - o[1]) * d[1] + (loc[2] - o[2]) * d[2];
        const k = dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2];
        for (const v of [uv.VMin, uv.VMax]) { const t = base + v * k; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
        const reversed = f.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
        if (f === best) side = (pos.Direct() ? 1 : -1) * (reversed ? -1 : 1);
      } finally { ad.delete(); }
    }
    // a radial direction perpendicular to the axis
    const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let x = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const xl = Math.hypot(...x); x = x.map((v) => v / xl);
    return { o, d, x, r: sig.r, t0, t1, external: side > 0 };
  } finally { faces.forEach((f) => f.delete()); }
}
// A helix wire made of one edge per turn: a single long helical edge makes sweeps
// and booleans slow and unreliable after a dozen turns.
function helixWire(pitch, height, radius, center, dir, left) {
  const surf = new OC.Geom_CylindricalSurface(R.makeAx3(center, dir), radius);
  const mw = new OC.BRepBuilderAPI_MakeWire();
  const n = Math.max(1, Math.ceil(height / pitch - 1e-9));
  const sgn = left ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const h0 = k * pitch, h1 = Math.min(height, (k + 1) * pitch);
    const a = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h0) / pitch, h0), b = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h1) / pitch, h1);
    const seg = new OC.GC_MakeSegment2d(a, b);
    const me = new OC.BRepBuilderAPI_MakeEdge(seg.Value(), surf);
    const e = me.Edge();
    OC.BRepLib.BuildCurves3d(e, 1e-6, OC.GeomAbs_Shape.GeomAbs_C1, 14, 40);
    mw.Add(e);
    me.delete(); seg.delete(); a.delete(); b.delete();
  }
  const w = new R.Wire(mw.Wire());
  mw.delete();
  return w;
}
// ---------------------------------------------------------------- emboss / deboss text
// one drawing per letter, each centred on its own middle; u = its middle along the line
function glyphDrawings(t) {
  const str = String(t.str || "");
  if (!str.trim()) throw new Error("Type some text first");
  const fontName = ["sans", "serif", "mono"].includes(t.font) ? t.font : "sans";
  const font = R.getFont(fontName);
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || font.unitsPerEm * 0.7;
  const fontSize = clampPos(t.size || 10) * font.unitsPerEm / cap;
  const total = font.getAdvanceWidth(str, fontSize);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (!ch.trim()) continue;
    const adv = font.getAdvanceWidth(str.slice(0, i), fontSize);
    const pb = font.getPath(ch, 0, 0, fontSize).getBoundingBox();
    if (!(pb.x2 > pb.x1)) continue;
    let d = R.drawText(ch, { startX: 0, startY: 0, fontSize, fontFamily: fontName });
    const [lo] = d.boundingBox.bounds;
    d = d.translate(pb.x1 - lo[0], -pb.y2 - lo[1]);
    const mx = (pb.x1 + pb.x2) / 2;
    out.push({ d: d.translate(-mx, -(t.size || 10) / 2), u: adv + mx - total / 2 });
  }
  if (!out.length) throw new Error("Type some text first");
  return out;
}
// mirror a 2D drawing left-to-right about its own centre line
const flipX = (d) => d.mirror([0, 1], [0, 0], "plane");
function embossTool(m) {
  if (m.reverse) m = { ...m, str: Array.from(String(m.str || "")).reverse().join("") };
  const depth = clampPos(m.depth ?? 1), emb = m.mode !== "deboss", size = clampPos(m.size || 10);
  const N = Vec.norm;
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const rot = (v, axis, ang) => { // Rodrigues
    const k = N(axis), c = Math.cos(ang), s = Math.sin(ang), d = Vec.dot(k, v), x = Vec.cross(k, v);
    return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * d * (1 - c));
  };
  const fuseAll = (list) => { let acc = list[0]; for (let i = 1; i < list.length; i++) { const f = acc.fuse(list[i]); acc.delete(); list[i].delete(); acc = f; } return acc; };
  if (m.kind === "cyl" || m.kind === "sphere") {
    const center = m.kind === "cyl" ? m.o : m.c, r = m.r;
    const s = m.ext === false ? -1 : 1; // inside a hole the "outside" points to the axis
    let up, e1;
    if (m.kind === "cyl") {
      up = N(m.ax);
      const v = Vec.sub(m.p, m.o), h = Vec.dot(v, up);
      e1 = N(Vec.sub(v, up.map((q) => q * h)));
    } else {
      e1 = N(Vec.sub(m.p, m.c));
      const z = m.up ? N(m.up) : [0, 0, 1];
      up = Vec.sub(z, e1.map((q) => q * Vec.dot(z, e1)));
      if (Math.hypot(...up) < 1e-6) up = Vec.sub([1, 0, 0], e1.map((q) => q * e1[0]));
      up = N(up);
    }
    const T = N(Vec.cross(up, e1)).map((q) => q * s);
    const base = m.kind === "cyl" ? add(m.o, up, Vec.dot(Vec.sub(m.p, m.o), up)) : m.c;
    const tilt = ((m.angle || 0) * Math.PI) / 180;
    const prisms = [];
    let glyphs = m.along && m.kind === "cyl" ? [{ d: centered(textDrawing({ str: m.str, size, font: m.font })), u: 0, whole: true }] : glyphDrawings({ str: m.str, size, font: m.font });
    if (m.mirror) glyphs = glyphs.map((g) => ({ ...g, d: flipX(g.d), u: -g.u }));
    for (const g of glyphs) {
      // a tilted line of text: each letter moves along the rotated baseline, not just around
      const ua = g.whole ? 0 : g.u * Math.cos(tilt), va = g.whole ? 0 : g.u * Math.sin(tilt);
      const phi = (s * ua) / r;
      let nr = N([0, 1, 2].map((i) => e1[i] * Math.cos(phi) + T[i] * s * Math.sin(phi)));
      let lift = va;
      if (m.kind === "sphere" && Math.abs(va) > 1e-9) { nr = N(rot(nr, Vec.cross(nr, up), va / r)); lift = 0; }
      let xd = N(Vec.cross(up, nr)).map((q) => q * s);
      let yd = up;
      if (g.whole) { xd = up; yd = null; } // running along the axis
      if (tilt && !g.whole) { xd = rot(xd, nr, tilt); }
      // the letter's plane faces whoever looks at this surface (outside a peg, inside a hole)
      const origin = add(add(base, nr, r - s * (depth + 1)), up, lift);
      const sk = g.d.sketchOnPlane(new R.Plane(origin, xd, nr.map((q) => q * s)));
      prisms.push(sk.extrude(2 * depth + 2));
      void yd;
    }
    const prism = fuseAll(prisms);
    // the shell the letters live in: just outside the surface (emboss) or just inside (deboss)
    let r0, r1;
    if (emb) { r0 = s > 0 ? r - 0.02 : r - depth; r1 = s > 0 ? r + depth : r + 0.02; }
    else { r0 = s > 0 ? r - depth : r - 0.5; r1 = s > 0 ? r + 0.5 : r + depth; }
    let shell;
    if (m.kind === "cyl") {
      const H = size * 4 + 2 * depth + Math.abs(glyphs.length * size), b0 = add(base, up, -H / 2);
      const outer = R.makeCylinder(r1, H, b0, up);
      if (r0 > 1e-3) { const inner = R.makeCylinder(r0, H, b0, up); shell = outer.cut(inner); outer.delete(); inner.delete(); } else shell = outer;
    } else {
      const outer = R.makeSphere(r1).translate(...center);
      if (r0 > 1e-3) { const inner = R.makeSphere(r0).translate(...center); shell = outer.cut(inner); outer.delete(); inner.delete(); } else shell = outer;
    }
    const tool = prism.intersect(shell);
    prism.delete(); shell.delete();
    return tool;
  }
  // flat faces (and a straight push for other curved faces)
  const n = N(m.n);
  let x = m.x ? N(m.x) : perpTo(n, null);
  if (m.angle) x = rot(x, n, (m.angle * Math.PI) / 180);
  let dr = centered(textDrawing({ str: m.str, size, font: m.font }));
  if (m.mirror) dr = flipX(dr);
  const curved = m.kind === "other";
  if (emb) {
    const start = curved ? size * 0.6 : 0.02; // reach into a curved face so every letter touches it
    return dr.sketchOnPlane(new R.Plane(add(m.p, n, -start), x, n)).extrude(depth + start);
  }
  return dr.sketchOnPlane(new R.Plane(add(m.p, n, -depth), x, n)).extrude(depth + 0.5);
}
function centered(d) { const b = d.boundingBox.center; return d.translate(-b[0], -b[1]); }

// a helix on a cone (taper angle in degrees; 0 = plain cylinder), one edge per turn
function helixWireTaper(pitch, height, radius, center, dir, left, angleDeg) {
  if (!angleDeg || Math.abs(angleDeg) < 1e-6) return helixWire(pitch, height, radius, center, dir, left);
  const a = (angleDeg * Math.PI) / 180;
  const surf = new OC.Geom_ConicalSurface(R.makeAx3(center, dir), a, radius);
  const k = 1 / Math.cos(a);
  const mw = new OC.BRepBuilderAPI_MakeWire();
  const n = Math.max(1, Math.ceil(height / pitch - 1e-9));
  const sgn = left ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const h0 = i * pitch, h1 = Math.min(height, (i + 1) * pitch);
    const A = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h0) / pitch, h0 * k), B = new OC.gp_Pnt2d((sgn * 2 * Math.PI * h1) / pitch, h1 * k);
    const seg = new OC.GC_MakeSegment2d(A, B);
    const me = new OC.BRepBuilderAPI_MakeEdge(seg.Value(), surf);
    const e = me.Edge();
    OC.BRepLib.BuildCurves3d(e, 1e-6, OC.GeomAbs_Shape.GeomAbs_C1, 14, 40);
    mw.Add(e);
    me.delete(); seg.delete(); A.delete(); B.delete();
  }
  const w = new R.Wire(mw.Wire());
  mw.delete();
  return w;
}
// cross-section drawings for pipes and coils, centred on the origin; x points "outward"
function sectionDrawing(kind, size) {
  const s = size;
  if (kind === "square") return polyDrawing([[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]]);
  if (kind === "triangle" || kind === "triangle-in") {
    const h = (s * Math.sqrt(3)) / 2, f = kind === "triangle-in" ? -1 : 1;
    return polyDrawing([[f * (2 * h) / 3, 0], [-f * h / 3, s / 2], [-f * h / 3, -s / 2]].map(([x, y]) => [x, f * y]));
  }
  return R.drawCircle(s / 2);
}
const Vec = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); },
};
// a direction square to t, preferring one in the path's own plane
function perpTo(t, hint) {
  let x = hint ? Vec.sub(hint, t.map((v) => v * Vec.dot(hint, t))) : null;
  if (!x || Math.hypot(...x) < 1e-6) { const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; x = Vec.cross(up, t); }
  return Vec.norm(x);
}
// Pipe: a round, square or triangular section (optionally hollow) along a path
// one smooth cubic B-spline through many points (3D Sketch lines): far quicker and steadier for
// a tube to follow than a chain of short Bezier pieces
function bsplineThrough(pts) {
  const tol = Math.max(0.01, (node_tol_hint || 0.05));
  return R.makeBSplineApproximation(pts, { tolerance: tol, degMin: 3, degMax: 3 });
}
let node_tol_hint = 0.05;
// a 3D Sketch line (one smooth curve through many points): when the engine can't sweep it as it
// is (a bend tighter than the tube, a wobble), try again on a smoothed copy, and if that fails
// too, build the tube from triangles, which always works
function buildPipe(node) {
  const segs = node.pathSegs || [];
  if (segs.length === 1 && segs[0].t === "bsp" && !node.hollow && !node._try) {
    const size = clampPos(node.size ?? 5), P0 = segs[0].pts;
    // a bend much tighter than the tube can't sweep (and finding that out is slow): smooth first
    if (minBend(P0) > size * 0.55) { try { return buildPipeShell(node); } catch (e1) {} }
    const P = relaxPath(P0, size);
    try { return buildPipeShell({ ...node, _tol: Math.max(0.05, size * 0.1), pathSegs: [{ t: "bsp", a: P[0], b: P[P.length - 1], pts: P }] }); } catch (e2) {}
    return solidFromMesh(...tubeMesh(P, size / 2));
  }
  return buildPipeShell(node);
}
function minBend(pts) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let m = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], ab = d(a, b), bc = d(b, c), ca = d(c, a), s2 = (ab + bc + ca) / 2;
    const A = Math.sqrt(Math.max(0, s2 * (s2 - ab) * (s2 - bc) * (s2 - ca)));
    if (A > 1e-12) m = Math.min(m, (ab * bc * ca) / (4 * A));
  }
  return m;
}
function relaxPath(pts, size) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let L = 0; for (let i = 1; i < pts.length; i++) L += d(pts[i - 1], pts[i]);
  const closed = pts.length > 3 && d(pts[0], pts[pts.length - 1]) < 1e-3;
  // even spacing
  const step = Math.max(size * 0.8, L / 150), out = [pts[0].slice()];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], seg = d(a, pts[i]);
    while (acc + seg >= step) { const t = (step - acc) / seg; const q = a.map((v, k) => v + (pts[i][k] - v) * t); out.push(q); a = q; seg = d(a, pts[i]); acc = 0; }
    acc += seg;
  }
  if (closed) out[out.length - 1] = out[0].slice(); else if (d(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1].slice()); else out[out.length - 1] = pts[pts.length - 1].slice();
  // smooth until no bend is tighter than the tube (or it stops helping)
  const rad = (a, b, c) => { const ab = d(a, b), bc = d(b, c), ca = d(c, a); const s2 = (ab + bc + ca) / 2, A = Math.sqrt(Math.max(0, s2 * (s2 - ab) * (s2 - bc) * (s2 - ca))); return A < 1e-12 ? Infinity : (ab * bc * ca) / (4 * A); };
  let p = out;
  const n = p.length, m = closed ? n - 1 : n; // m distinct points (a closed path repeats its first)
  for (let it = 0; it < 60 && m > 2; it++) {
    let tight = false;
    const q = p.map((v) => v.slice());
    for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
      const ia = p[(i - 1 + m) % m], b = p[i], ic = p[(i + 1) % m];
      if (rad(ia, b, ic) < size * 0.75) tight = true;
      for (let k = 0; k < 3; k++) q[i][k] = b[k] * 0.5 + (ia[k] + ic[k]) * 0.25;
    }
    if (closed) q[n - 1] = q[0].slice();
    p = q;
    if (!tight && it > 1) break;
  }
  return p;
}
// a round tube along points as triangles: rings turned with the path (no twisting), flat ends,
// or joined up when the path closes
function tubeMesh(P, r, sides = 20) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const closed = P.length > 3 && d(P[0], P[P.length - 1]) < 1e-3;
  const pts = closed ? P.slice(0, -1) : P, n = pts.length;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const T = pts.map((_, i) => nrm(closed ? sub(pts[(i + 1) % n], pts[(i - 1 + n) % n]) : sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let ref = Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let N = nrm(crs(crs(T[0], ref), T[0]));
  const Ns = [N];
  for (let i = 1; i < n; i++) { const t = T[i]; N = nrm(sub(N, t.map((v) => v * dot(N, t)))); Ns.push(N); }
  // a closed loop: spread the leftover twist along it so the last ring meets the first
  let twist = 0;
  if (closed) {
    const t0 = T[0], Nl = nrm(sub(Ns[n - 1], t0.map((v) => v * dot(Ns[n - 1], t0)))), B0 = crs(t0, Ns[0]);
    twist = Math.atan2(dot(Nl, B0), dot(Nl, Ns[0]));
  }
  const V = [], I = [];
  for (let i = 0; i < n; i++) {
    const t = T[i], b = crs(t, Ns[i]), off = closed ? (-twist * i) / n : 0;
    for (let j = 0; j < sides; j++) {
      const a = off + (2 * Math.PI * j) / sides, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < 3; k++) V.push(pts[i][k] + r * (Ns[i][k] * c + b[k] * s));
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const A0 = i * sides, B0 = ((i + 1) % n) * sides;
    for (let j = 0; j < sides; j++) { const j1 = (j + 1) % sides; I.push(A0 + j, B0 + j, A0 + j1, A0 + j1, B0 + j, B0 + j1); }
  }
  if (!closed) {
    const c0 = V.length / 3; V.push(...pts[0]); const c1 = c0 + 1; V.push(...pts[n - 1]);
    const L = (n - 1) * sides;
    for (let j = 0; j < sides; j++) { const j1 = (j + 1) % sides; I.push(c0, j1, j); I.push(c1, L + j, L + j1); }
  }
  return [new Float32Array(V), new Uint32Array(I)];
}
function buildPipeShell(node) {
  const segs = node.pathSegs || [];
  if (!segs.length) throw new Error("Pick a path: sketch curves or body edges");
  const size = clampPos(node.size ?? 5);
  const s0 = segs[0];
  let sp, t, hint = null;
  if (s0.t === "line") { sp = s0.a; t = Vec.norm(Vec.sub(s0.b, s0.a)); }
  else if (s0.t === "arc") {
    const n = Vec.norm(Vec.cross(Vec.sub(s0.m, s0.a), Vec.sub(s0.b, s0.a)));
    const c = circumcenter(s0.a, s0.m, s0.b);
    sp = s0.a; t = Vec.norm(Vec.cross(n, Vec.sub(s0.a, c)));
    if (Vec.dot(t, Vec.sub(s0.m, s0.a)) < 0) t = t.map((v) => -v);
    hint = Vec.sub(s0.a, c);
  } else if (s0.t === "bez") { const b = s0.spans[0]; sp = b[0]; t = Vec.norm(Vec.sub(b[1], b[0])); }
  else if (s0.t === "bsp") {
    node_tol_hint = node._tol || Math.max(0.02, (node.size || 3) * 0.02);
    // start on the fitted curve itself, along its own direction
    const e = bsplineThrough(s0.pts); sp = e.startPoint.toTuple(); const tv = e.tangentAt(0); t = Vec.norm(tv.toTuple()); tv.delete(); e.delete();
  }
  else {
    // a full circle: start where its edge starts
    const e = R.makeCircle(s0.r, s0.c, s0.n);
    sp = e.startPoint.toTuple(); const tv = e.tangentAt(0); t = Vec.norm(tv.toTuple()); tv.delete(); e.delete();
    hint = Vec.sub(sp, s0.c);
  }
  if (!hint && segs.length > 1) {
    // bend direction of the path keeps a square section square to the bend
    const s1 = segs[1]; const q = s1.t === "circle" ? s1.c : s1.b || s1.a; const w = Vec.sub(q, sp);
    const nn = Vec.cross(t, w); if (Math.hypot(...nn) > 1e-6) hint = Vec.cross(nn, t);
  }
  const x = perpTo(t, hint);
  const plane = new R.Plane(sp, x, t);
  const spine = sweepPath(segs);
  const solidOf = (sz) => { const sk = sectionDrawing(node.section || "circle", sz).sketchOnPlane(plane); try { return pipe(sk.wire, spine, "perp"); } finally { sk.delete(); } };
  try {
    let out = solidOf(size);
    if (node.hollow) {
      const inner = size - 2 * clampPos(node.wall ?? 1);
      if (inner <= 0.01) throw new Error("The wall is too thick for this pipe size");
      const h = solidOf(inner); const c = out.cut(h); out.delete(); h.delete(); out = c;
    }
    return out;
  } finally { spine.delete(); }
}
function circumcenter(a, m, b) {
  const ab = Vec.sub(b, a), am = Vec.sub(m, a), n = Vec.cross(ab, am), n2 = Vec.dot(n, n);
  const t1 = Vec.cross(n, ab).map((v) => v * Vec.dot(am, am)), t2 = Vec.cross(am, n).map((v) => v * Vec.dot(ab, ab));
  return [0, 1, 2].map((i) => a[i] + (t1[i] + t2[i]) / (2 * n2));
}
// Coil: a helical body standing on Z = 0 around the Z axis
function buildCoil(node) {
  const d = clampPos(node.d ?? 20), size = clampPos(node.size ?? 2);
  const turns = Math.max(0.25, node.turns ?? 5);
  // in height mode the whole coil, section included, is exactly h tall
  const pitch = node.mode === "pitch" ? clampPos(node.pitch ?? 4) : Math.max(0.01, clampPos(node.h ?? 20) - size) / turns;
  const height = pitch * turns;
  const sec = node.section || "circle";
  if (pitch < size * 1.01) throw new Error("The coils overlap: increase the pitch or height, or use a smaller section");
  const r = d / 2 + (node.pos === "inside" ? -size / 2 : node.pos === "outside" ? size / 2 : 0);
  const ang = node.angle || 0;
  const rEnd = r + height * Math.tan((ang * Math.PI) / 180);
  if (r - size / 2 <= 0.01 || rEnd - size / 2 <= 0.01) throw new Error("The coil gets too narrow: use a bigger diameter, a smaller section or less taper");
  const helix = helixWireTaper(pitch, height, r, [0, 0, size / 2], [0, 0, 1], !!node.left, ang);
  const e0 = helix.edges[0];
  const sp = e0.startPoint.toTuple(), tv = e0.tangentAt(0), t = Vec.norm(tv.toTuple());
  tv.delete(); e0.delete();
  const rad = Vec.norm([sp[0], sp[1], 0]);
  const x = perpTo(t, rad);
  const sk = sectionDrawing(sec, size).sketchOnPlane(new R.Plane(sp, x, t));
  const prof = sk.wire.clone();
  sk.delete();
  try { return R.genericSweep(prof, helix, { frenet: true }, false); }
  catch (e) { throw new Error("The coil couldn't be built with these sizes"); }
  finally { prof.delete(); helix.delete(); }
}
// The helical groove of a modeled ISO-style 60° thread: a 60° V profile swept along
// a helix on the cylinder, starting past the free end of the face.
function threadGroove(shape, mod) {
  const ci = cylinderInfo(shape, mod.face || {});
  const p = mod.pitch;
  if (!(p > 0.05)) throw new Error("Thread pitch must be at least 0.05 mm");
  const { o, d, x, r, t0, t1, external } = ci;
  const full = t1 - t0;
  if (p > r * 1.2) throw new Error(`Thread pitch is too large for this ${external ? "cylinder" : "hole"}`);
  const at = (t, rad) => [0, 1, 2].map((i) => o[i] + d[i] * t + x[i] * rad);
  // an end is free when there is no material just past it at thread depth
  const probeR = external ? r - 0.25 * p : r + 0.25 * p;
  const eps = Math.max(0.05, 0.05 * p);
  const free0 = !insideAt(shape, at(t0 - eps, probeR));
  const free1 = !insideAt(shape, at(t1 + eps, probeR));
  let fromStart = !(free1 && !free0); // start at the free end
  if (mod.flip) fromStart = !fromStart;
  const startFree = fromStart ? free0 : free1, farFree = fromStart ? free1 : free0;
  const L = mod.length > 0 ? Math.min(mod.length, full) : full;
  const tS = fromStart ? t0 : t1;
  const u = fromStart ? d : d.map((v) => -v);
  const a = startFree ? -p : 0.45 * p;
  const b = L >= full - 1e-6 && farFree ? L + p : L - 0.45 * p;
  if (b - a < 0.6 * p) throw new Error("Thread is too short for this pitch");
  if ((b - a) / p > 400) throw new Error("That thread has too many turns to model. Use a larger pitch or a shorter length.");
  const S = [0, 1, 2].map((i) => o[i] + d[i] * tS + u[i] * a);
  // print offset (clearance): every thread face moves c into the material. For the 60° V that
  // takes the groove 2c deeper (same flank angle) and the crest c lower.
  const c = Math.min(Math.abs(mod.clear || 0), 0.3 * p);
  const depth = (external ? 0.6134 : 0.5413) * p + 2 * c, over = 0.12 * p;
  const sgn = external ? 1 : -1;
  const tan30 = Math.tan(Math.PI / 6);
  const outR = r - sgn * c + sgn * over; // just past the (relieved) crest
  const w = (depth - c + over) * tan30;
  let pts = [[r - sgn * depth, 0], [outR, w], [outR, -w]];
  // a big offset on a fine pitch would make neighbouring turns of the groove overlap:
  // keep the groove a little narrower than the pitch (the tooth comes to a point)
  const wMax = 0.49 * p;
  if (w > wMax) {
    const rk = r - sgn * depth + (sgn * wMax) / tan30;
    pts = [[r - sgn * depth, 0], [rk, wMax], [outR, wMax], [outR, -wMax], [rk, -wMax]];
  }
  const helix = helixWire(p, b - a, r, S, u, !!mod.left);
  const sp = helix.startPoint.toTuple();
  let rad = [sp[0] - S[0], sp[1] - S[1], sp[2] - S[2]];
  const along = rad[0] * u[0] + rad[1] * u[1] + rad[2] * u[2];
  rad = rad.map((v, i) => v - along * u[i]);
  const rl = Math.hypot(...rad) || 1; rad = rad.map((v) => v / rl);
  const nrm = [rad[1] * u[2] - rad[2] * u[1], rad[2] * u[0] - rad[0] * u[2], rad[0] * u[1] - rad[1] * u[0]];
  const sk = polyDrawing(pts).sketchOnPlane(new R.Plane(S, rad, nrm));
  const wire = sk.wire.clone();
  sk.delete();
  let groove;
  try { groove = R.genericSweep(wire, helix, { frenet: true }, false); }
  catch (e) { throw new Error("Thread couldn't be swept on this face"); }
  finally { wire.delete(); helix.delete(); }
  // the run-out past the ends, trimmed to the cylinder's length (used if a cut with
  // the groove poking out of the body fails)
  const clipped = () => {
    const base = [0, 1, 2].map((i) => o[i] + d[i] * t0);
    const clip = R.makeCylinder(r + 3 * p, full, base, d);
    const c = groove.intersect(clip);
    clip.delete();
    return c;
  };
  // crest relief for the print offset: a thin ring over the threaded part of the face
  let crest = null;
  if (c > 1e-6) {
    const lo = fromStart ? t0 + Math.max(0, a) : t1 - Math.min(full, b);
    const hi = fromStart ? t0 + Math.min(full, b) : t1 - Math.max(0, a);
    const span = hi - lo;
    if (span > 1e-6) {
      const base = [0, 1, 2].map((i) => o[i] + d[i] * lo);
      if (external) {
        const outer = R.makeCylinder(r + 2 * p, span, base, d), inner = R.makeCylinder(r - c, span, base, d);
        crest = outer.cut(inner); outer.delete(); inner.delete();
      } else crest = R.makeCylinder(r + c, span, base, d);
    }
  }
  return { groove, clipped, crest };
}
// cut many tools in one boolean (no result simplification: it is slow on threads)
function cutAll(shape, tools) {
  const b = new OC.BRepAlgoAPI_Cut();
  const L1 = new OC.NCollection_List_TopoDS_Shape(); L1.Append(shape.wrapped);
  const L2 = new OC.NCollection_List_TopoDS_Shape(); for (const t of tools) L2.Append(t.wrapped);
  try {
    b.SetArguments(L1); b.SetTools(L2);
    b.Build();
    if (b.HasErrors()) return null;
    const sh = b.Shape();
    if (sh.IsNull()) return null;
    return R.cast(sh);
  } catch (e) { return null; } finally { b.delete(); L1.delete(); L2.delete(); }
}

// ---------------------------------------------------------------- scaling
// Scale x' = k*x + o (per axis) in the body's own frame. Uniform scaling is exact
// for any body; uneven stretching is rebuilt from the source where possible
// (see scaleNode), otherwise the body is rebuilt from a fine mesh.
function isUniform(k) { return Math.abs(k[0] - k[1]) < 1e-9 && Math.abs(k[0] - k[2]) < 1e-9; }
function scaleShape(shape, k, o) {
  if (isUniform(k)) {
    const trsf = new OC.gp_Trsf();
    trsf.SetValues(k[0], 0, 0, o[0], 0, k[0], 0, o[1], 0, 0, k[0], o[2]);
    const op = new OC.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false);
    const out = R.cast(op.Shape());
    op.delete(); trsf.delete(); shape.delete();
    return out;
  }
  return facetedScale(shape, k, o);
}
function facetedScale(shape, k, o) {
  const bb = bboxOf(shape);
  const diag = Math.hypot(...bb.size) || 1;
  const m = shape.mesh({ tolerance: Math.max(0.01, diag * 0.0008), angularTolerance: 0.12 });
  shape.delete();
  const V = (i) => [m.vertices[3 * i] * k[0] + o[0], m.vertices[3 * i + 1] * k[1] + o[1], m.vertices[3 * i + 2] * k[2] + o[2]];
  if (m.triangles.length / 3 > 4000) throw new Error("This body can't be stretched unevenly. Scale it evenly instead (hold Shift while dragging a corner handle).");
  const faces = [];
  for (let t = 0; t < m.triangles.length; t += 3) {
    const a = V(m.triangles[t]), b = V(m.triangles[t + 1]), c = V(m.triangles[t + 2]);
    const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (Math.hypot(...cr) < 1e-10) continue;
    faces.push(R.makePolygon([a, b, c]));
  }
  if (faces.length > 4000) throw new Error("This body can't be stretched unevenly. Scale it evenly instead (hold Shift while dragging a corner handle).");
  let solid = R.makeSolid(faces);
  try {
    const u = new OC.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false);
    u.Build();
    const s2 = R.cast(u.Shape());
    u.delete(); solid.delete(); solid = s2;
  } catch (e) {}
  return solid;
}
// Rebuild a node so its geometry is stretched exactly, or return null when that
// isn't possible (then the mesh fallback is used).
const axisPerm = (v) => { // index and sign of a unit axis vector, or null
  const i = [0, 1, 2].find((j) => Math.abs(Math.abs(v[j]) - 1) < 1e-9);
  return i === undefined ? null : { i, s: Math.sign(v[i]) };
};
// Features are replayed on the stretched body with their reference points moved;
// holes, fillets, shells and threads keep their sizes (like editing the sketch).
function scaleMod(m, k, o) {
  const P = (p) => p && p.map((v, i) => v * k[i] + o[i]);
  const N = (n) => { if (!n) return n; const v = n.map((x, i) => x / k[i]); const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const uni = isUniform(k);
  switch (m.t) {
    case "fillet": case "chamfer": {
      const E = (list) => (list || []).map((e) => ({ ...e, a: P(e.a), b: P(e.b), m: P(e.m), t: e.t === "LINE" || uni ? e.t : undefined }));
      return { ...m, edges: E(m.edges), sets: m.sets && m.sets.map((x) => ({ ...x, edges: E(x.edges) })) };
    }
    case "hole":
      return { ...m, p: P(m.p), n: N(m.n), at: m.at && m.at.map((s) => ({ p: P(s.p), n: N(s.n) })) };
    case "offset": case "shell":
      return { ...m, faces: (m.faces || []).map((f) => ({ ...f, c: P(f.c), n: N(f.n) })) };
    case "thread":
      return { ...m, face: { ...m.face, c: P(m.face.c) } };
    case "bool": {
      const g = scaleNode({ t: "group", children: [{ node: m.tool, m: m.m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }, k, o);
      if (!g) return null;
      return { ...m, tool: g.children[0].node, m: g.children[0].m };
    }
    default: return null;
  }
}
function scaleNode(node, k, o) {
  if (node.mods && node.mods.length) {
    const last = node.mods[node.mods.length - 1];
    if (last.t === "scale") {
      // a trailing scale folds in
      const kk = [0, 1, 2].map((i) => last.k[i] * k[i]), oo = [0, 1, 2].map((i) => last.o[i] * k[i] + o[i]);
      return scaleNode({ ...node, mods: node.mods.slice(0, -1) }, kk, oo);
    }
    const base = scaleNode({ ...node, mods: [] }, k, o);
    if (!base) return null;
    const mods = [...(base.mods || [])];
    for (const m of node.mods) {
      const mm = scaleMod(m, k, o);
      if (!mm) return null;
      mods.push(mm);
    }
    return { ...base, mods };
  }
  const T = (n) => ({ t: "group", children: [{ node: n, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, o[0], o[1], o[2], 1] }] });
  if (node.t === "prim") {
    const p = node.p || {};
    if (node.kind === "torus" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "text" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "spring" && Math.abs(k[0] - k[1]) > 1e-9) return null;
    if (node.kind === "text") return T({ ...node, p: { ...p, size: p.size * k[0], h: (p.h || 5) * k[2] } });
    const np = { ...p, w: p.w * k[0], d: p.d * k[1], h: p.h * k[2] };
    if (node.kind === "torus") np.tube = (p.tube ?? 5) * Math.min(k[0], k[2]);
    if (node.kind === "tube") np.wall = (p.wall ?? 2) * Math.min(k[0], k[1]);
    if (node.kind === "spring") np.wire = (p.wire ?? 2) * k[0];
    return T({ ...node, p: np });
  }
  if (node.t === "extrude" || node.t === "revolve") {
    const pl = node.plane;
    const y = [pl.n[1] * pl.x[2] - pl.n[2] * pl.x[1], pl.n[2] * pl.x[0] - pl.n[0] * pl.x[2], pl.n[0] * pl.x[1] - pl.n[1] * pl.x[0]];
    const ax = axisPerm(pl.x), ay = axisPerm(y), an = axisPerm(pl.n);
    if (!ax || !ay || !an) return null;
    const kx = k[ax.i], ky = k[ay.i], kn = k[an.i];
    const plane = { ...pl, o: [0, 1, 2].map((i) => pl.o[i] * k[i] + o[i]) };
    const out = { ...node, plane, stretch: [kx * ((node.stretch && node.stretch[0]) || 1), ky * ((node.stretch && node.stretch[1]) || 1)] };
    if (node.t === "extrude") {
      out.dist = (node.dist || 0) * kn;
      if (node.dist2 != null) out.dist2 = node.dist2 * kn;
      return out;
    }
    // revolve: only when the stretch keeps circles round around the axis
    let dir;
    if (node.axisWorld) dir = node.axisWorld.d;
    else if (node.axis) {
      const ax2 = [node.axis.b[0] - node.axis.a[0], node.axis.b[1] - node.axis.a[1]];
      dir = [0, 1, 2].map((i) => pl.x[i] * ax2[0] + y[i] * ax2[1]);
    } else return null;
    const ad = axisPerm(dir.map((v) => v / (Math.hypot(...dir) || 1)));
    if (!ad) return null;
    const others = [0, 1, 2].filter((i) => i !== ad.i);
    if (Math.abs(k[others[0]] - k[others[1]]) > 1e-9) return null;
    if (node.axisWorld) out.axisWorld = { o: [0, 1, 2].map((i) => node.axisWorld.o[i] * k[i] + o[i]), d: dir };
    return out;
  }
  if (node.t === "group") {
    const children = [];
    for (const c of node.children) {
      const m = c.m || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // child frame axes must line up with the parent axes
      const cols = [0, 1, 2].map((j) => axisPerm([m[4 * j], m[4 * j + 1], m[4 * j + 2]]));
      if (cols.some((x) => !x)) return null;
      const kc = cols.map((x) => k[x.i]);
      const inner = scaleNode(c.node, kc, [0, 0, 0]);
      if (!inner) return null;
      const m2 = m.slice();
      for (let i = 0; i < 3; i++) m2[12 + i] = m[12 + i] * k[i] + o[i];
      children.push({ ...c, node: inner, m: m2 });
    }
    return { ...node, children };
  }
  return null;
}

function safeVolume(shape) {
  try { return R.measureVolume(shape); } catch (e) { return NaN; }
}
// Fallback shell: subtract an inward offset of the body, then open the chosen
// faces by pushing the matching inner faces back out through the wall.
// the centre of the round wall a hole at p (going along -n, radius r) left behind
function holeWallCenter(shape, p, n, r) {
  const faces = shape.faces;
  try {
    const nn = Vec.norm(n);
    let best = null, bd = Infinity;
    for (const f of faces) {
      if (f.geomType !== "CYLINDRE") continue;
      const sig = surfaceSig(f);
      if (Math.abs(sig.r - r) > 1e-3 * Math.max(1, r)) continue;
      if (Math.abs(Vec.dot(Vec.norm(sig.d), nn)) < 0.999) continue;
      const v = Vec.sub(p, sig.o), along = Vec.dot(v, Vec.norm(sig.d));
      const off = Math.hypot(...Vec.sub(v, Vec.norm(sig.d).map((q) => q * along)));
      if (off > 1e-3 * Math.max(1, r)) continue;
      const c = f.center.toTuple(), dd = dist(c, p);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  } finally { faces.forEach((f) => f.delete()); }
}
function holeTool(shape, mod) {
  const n = mod.n, p = mod.p;
  const len = Math.hypot(...n) || 1;
  const nn = n.map((v) => v / len);
  const down = nn.map((v) => -v);
  const lift = 0.05;
  const start = p.map((v, i) => v + nn[i] * lift);
  const bb = bboxOf(shape);
  const through = mod.through || !(mod.depth > 0);
  const depth = through ? Math.hypot(...bb.size) * 2 + 1 : mod.depth;
  const r = clampPos(mod.dia / 2);
  let tool = R.makeCylinder(r, depth + lift, start, down);
  // a drilled blind hole ends in a 118° point
  if (!through && mod.tip) {
    const hTip = r / Math.tan((59 * Math.PI) / 180);
    const at = start.map((v, i) => v + down[i] * (depth + lift));
    const cone = R.drawCircle(r).sketchOnPlane(new R.Plane(at, null, down)).loftWith([], { endPoint: at.map((v, i) => v + down[i] * hTip), ruled: true });
    const u = tool.fuse(cone); tool.delete(); cone.delete(); tool = u;
  }
  if (mod.kind === "cbore" && mod.cbDia > mod.dia) {
    const cb = R.makeCylinder(mod.cbDia / 2, clampPos(mod.cbDepth) + lift, start, down);
    const u = tool.fuse(cb); tool.delete(); cb.delete(); tool = u;
  } else if (mod.kind === "csink" && mod.csDia > mod.dia) {
    const ang = ((mod.csAngle || 90) * Math.PI) / 180;
    const hDepth = (mod.csDia / 2 - r) / Math.tan(ang / 2);
    const pl = new R.Plane(start, null, down);
    const top = R.drawCircle(mod.csDia / 2 + lift * Math.tan(ang / 2)).sketchOnPlane(pl);
    const bot = R.drawCircle(r).sketchOnPlane(new R.Plane(start.map((v, i) => v + down[i] * (hDepth + lift)), null, down));
    const cone = top.loftWith(bot, { ruled: true });
    const u = tool.fuse(cone); tool.delete(); cone.delete(); tool = u;
  }
  return tool;
}

// ---------------------------------------------------------------- evaluation
function stableKey(node) {
  return JSON.stringify(node, (k, v) => (k === "name" || k === "color" || k === "id" || k === "hidden" ? undefined : v));
}

// ---------------------------------------------------------------- imported models
// Files a design brings in (STL meshes, STEP models) are sent to the worker once as
// "assets"; nodes refer to them by id, so the big data never travels with every rebuild.
const assets = new Map(); // id -> { kind, bytes: Uint8Array }
export function setAsset(id, kind, bytes) { assets.set(id, { kind, bytes }); }
export function hasAsset(id) { return assets.has(id); }
function assetBytes(node) {
  const a = assets.get(node.asset);
  if (!a) throw new Error("This imported model's data is missing. Import the file again.");
  return a.bytes;
}
// STL (indexed: [nv, nt] header, float32 positions, uint32 triangle indices) -> a solid
// made of the triangles (coplanar ones merged), or a surface if the mesh isn't closed
function buildMeshAsset(node) {
  const u8 = assetBytes(node);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const head = new Uint32Array(buf, 0, 2), nv = head[0], nt = head[1];
  const V = new Float32Array(buf, 8, nv * 3), I = new Uint32Array(buf, 8 + nv * 12, nt * 3);
  return solidFromMesh(V, I, node.k || 1);
}
// a solid from triangles (shared corners, consistent winding)
function solidFromMesh(V, I, k = 1) {
  const nv = V.length / 3, nt = I.length / 3;
  const T = { t0: Date.now() };
  // Build the faces on shared vertices and edges, so the triangles are already joined
  // (much faster than making loose triangles and sewing them together afterwards).
  const B = new OC.TopoDS_Builder();
  const verts = new Array(nv);
  const vert = (i) => {
    if (!verts[i]) {
      const p = new OC.gp_Pnt(V[i * 3] * k, V[i * 3 + 1] * k, V[i * 3 + 2] * k);
      const mv = new OC.BRepBuilderAPI_MakeVertex(p);
      verts[i] = mv.Vertex(); mv.delete(); p.delete();
    }
    return verts[i];
  };
  const edges = new Map();
  const edge = (i, j) => { // oriented i -> j
    const lo = Math.min(i, j), hi = Math.max(i, j), key = lo * nv + hi;
    let e = edges.get(key);
    if (!e) { const me = new OC.BRepBuilderAPI_MakeEdge(vert(lo), vert(hi)); e = me.Edge(); me.delete(); edges.set(key, e); }
    return i === lo ? e : e.Reversed();
  };
  const shell = new OC.TopoDS_Shell();
  B.MakeShell(shell);
  let nf = 0;
  for (let t = 0; t < nt; t++) {
    const ia = I[t * 3], ib = I[t * 3 + 1], ic = I[t * 3 + 2];
    const ax = V[ia * 3], ay = V[ia * 3 + 1], az = V[ia * 3 + 2];
    const ux = V[ib * 3] - ax, uy = V[ib * 3 + 1] - ay, uz = V[ib * 3 + 2] - az;
    const wx = V[ic * 3] - ax, wy = V[ic * 3 + 1] - ay, wz = V[ic * 3 + 2] - az;
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-12) continue;
    try {
      const w = new OC.TopoDS_Wire();
      B.MakeWire(w);
      B.Add(w, edge(ia, ib)); B.Add(w, edge(ib, ic)); B.Add(w, edge(ic, ia));
      const mf = new OC.BRepBuilderAPI_MakeFace(w, true);
      if (mf.IsDone()) {
        // the face must point the way the triangle winds (outwards)
        let f = mf.Face();
        const fw = R.cast(f), n = fw.normalAt();
        const [nx, ny, nz] = n.toTuple(); n.delete();
        if (nx * (uy * wz - uz * wy) + ny * (uz * wx - ux * wz) + nz * (ux * wy - uy * wx) < 0) f = f.Reversed();
        B.Add(shell, f); nf++;
      }
      mf.delete(); w.delete();
    } catch (e) {}
  }
  if (!nf) throw new Error("This mesh has no usable triangles");
  T.faces = Date.now();
  let shape = null;
  try {
    const fix = new OC.ShapeFix_Solid();
    shape = R.cast(fix.SolidFromShell(shell));
    fix.delete();
  } catch (e) { shape = null; }
  if (!shape || !(Math.abs(safeVolume(shape)) > 1e-9)) {
    // not watertight: keep it as a surface (it shows and exports, but can't be cut)
    if (shape) shape.delete();
    shape = R.cast(shell);
  }
  T.solid = Date.now();
  if (safeVolume(shape) < 0) { const r = R.cast(shape.wrapped.Reversed()); shape.delete(); shape = r; }
  // merge the flat triangles of each face so the body has proper faces and edges
  // (skipped for dense, curved meshes where it is slow and merges little)
  // (with a small tolerance: STL corners are rounded to 7 digits, so the triangles of a flat
  // face are flat only to about a millionth of the model's size)
  if (nf <= 20000) {
    const bb = bboxOf(shape), diag = Math.hypot(...bb.size) || 1;
    const u = unifiedTol(shape, Math.max(1e-6, diag * 2e-6), 2e-4);
    if (u) { shape.delete(); shape = u; }
  }
  T.unify = Date.now();
  if (typeof process !== "undefined" && process.env && process.env.MESH_T) console.log("mesh build ms: faces", T.faces - T.t0, "solid", T.solid - T.faces, "unify", T.unify - T.solid);
  return shape;
}
function buildStepAsset(node) {
  const bytes = assetBytes(node);
  const name = "import_" + Math.random().toString(36).slice(2);
  OC.FS.writeFile("/" + name, bytes);
  const reader = new OC.STEPControl_Reader();
  try {
    if (!reader.ReadFile(name)) throw new Error("This STEP file couldn't be read");
    reader.TransferRoots();
    let shape = R.cast(reader.OneShape());
    // one solid when the file has several
    const solids = [];
    const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_SOLID, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) solids.push(R.cast(OC.TopoDS.Solid(ex.Current())));
    ex.delete();
    if (solids.length === 1) { shape.delete(); shape = solids[0]; }
    else if (solids.length > 1) { let acc = solids[0]; for (const x of solids.slice(1)) { const f = acc.fuse(x); acc.delete(); x.delete(); acc = f; } shape.delete(); shape = acc; }
    if ((node.k || 1) !== 1) shape = scaleShape(shape, [node.k, node.k, node.k], [0, 0, 0]);
    return shape;
  } finally {
    reader.delete();
    try { OC.FS.unlink("/" + name); } catch (e) {}
  }
}
// imported models sit centered on the origin, resting on the workplane
function placeImported(shape, node) {
  if (node.keepPos) return shape;
  const bb = bboxOf(shape);
  const dx = -(bb.min[0] + bb.max[0]) / 2, dy = -(bb.min[1] + bb.max[1]) / 2, dz = -bb.min[2];
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-9) return shape;
  const out = shape.translate(dx, dy, dz);
  return out;
}
function evalBase(node) {
  switch (node.t) {
    case "prim": return buildPrim(node.kind, node.p || {});
    case "mesh": return placeImported(buildMeshAsset(node), node);
    case "step": return placeImported(buildStepAsset(node), node);
    case "extrude": return buildExtrude(node);
    case "revolve": return buildRevolve(node);
    case "sweep": return buildSweep(node);
    case "pipe": return buildPipe(node);
    case "coil": return buildCoil(node);
    case "group": return buildGroup(node);
    case "loft": return buildLoft(node);
    case "mirror": return buildMirror(node);
    case "placed": return transformShape(evalNode(node.src), node.srcM); // another body, where it sits
    default: throw new Error("Unknown node type " + node.t);
  }
}

export function evalNode(node) {
  const key = stableKey(node);
  const hit = cacheGet(key);
  if (hit) return hit;
  let shape;
  const mods = node.mods || [];
  const last = mods[mods.length - 1];
  const exact = last && last.t === "scale" && !isUniform(last.k) ? scaleNode({ ...node, mods: mods.slice(0, -1) }, last.k, last.o) : null;
  if (exact) {
    try { shape = evalNode(exact); }
    catch (e) { shape = scaleShape(evalNode({ ...node, mods: mods.slice(0, -1) }), last.k, last.o); }
  } else if (mods.length) {
    // evaluate prefix (node without last mod) so editing the last feature is cheap
    const prefix = { ...node, mods: mods.slice(0, -1) };
    shape = evalNode(prefix);
    shape = applyMod(shape, mods[mods.length - 1]);
  } else {
    shape = evalBase(node);
  }
  cachePut(key, shape);
  return shape;
}

function buildGroup(node) {
  const kids = node.children || [];
  if (!kids.length) throw new Error("Empty group");
  const solids = [], holes = [];
  for (const k of kids) {
    const s = transformShape(evalNode(k.node), k.m);
    (k.hole ? holes : solids).push(s);
  }
  let base;
  if (node.op === "intersect") {
    if (solids.length < 2) throw new Error("Intersect needs at least two solid bodies");
    base = solids[0];
    for (let i = 1; i < solids.length; i++) { const n = base.intersect(solids[i]); base.delete(); solids[i].delete(); base = n; }
  } else if (solids.length) {
    base = solids[0];
    for (let i = 1; i < solids.length; i++) { const n = base.fuse(solids[i]); base.delete(); solids[i].delete(); base = n; }
  } else {
    // a group made only of holes stays a hole
    base = holes.shift();
    for (const h of holes.splice(0)) { const n = base.fuse(h); base.delete(); h.delete(); base = n; }
  }
  for (const h of holes) { const n = base.cut(h); base.delete(); h.delete(); base = n; }
  return base;
}

// ---------------------------------------------------------------- meshing
export function meshShape(shape, quality = 1) {
  const TT = [Date.now()], tick = () => TT.push(Date.now());
  const bb = bboxOf(shape);
  const diag = Math.hypot(...bb.size) || 1;
  const tol = Math.max(0.005, diag * 0.0006 / quality);
  const m = shape.mesh({ tolerance: tol, angularTolerance: 0.2 / quality });
  tick();
  const e = shape.meshEdges({ tolerance: tol, angularTolerance: 0.2 / quality });
  tick();
  const faces = shape.faces;
  // Dense bodies (imported meshes): flat faces get their center and normal from the
  // display triangles, which is exact for flat faces and far quicker than integrating.
  const fastFlat = faces.length > 400 && m.faceGroups.length === faces.length;
  const flatFromMesh = (g) => {
    let ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, A = 0;
    const T = m.triangles, P = m.vertices;
    for (let i = g.start; i < g.start + g.count; i += 3) {
      const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar = Math.hypot(nx, ny, nz) / 2;
      ax += nx; ay += ny; az += nz; A += ar;
      cx += ar * (P[a] + P[b] + P[c]) / 3; cy += ar * (P[a + 1] + P[b + 1] + P[c + 1]) / 3; cz += ar * (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    }
    const L = Math.hypot(ax, ay, az);
    if (!(A > 0) || !(L > 0)) return null;
    return { n: [ax / L, ay / L, az / L], c: [cx / A, cy / A, cz / A] };
  };
  const faceInfo = faces.map((f, fi) => {
    const t = f.geomType;
    const info = { t };
    try {
      const quick = fastFlat && t === "PLANE" ? flatFromMesh(m.faceGroups[fi]) : null;
      if (quick) { info.n = quick.n; info.c = quick.c; }
      else if (t === "PLANE") {
        info.n = f.normalAt().toTuple();
        info.c = f.center.toTuple();
      } else {
        info.c = f.center.toTuple();
        if (t === "SPHERE") {
          const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
          try { const sp = ad.Sphere(); const L = sp.Position().Location(); info.r = sp.Radius(); info.o = [L.X(), L.Y(), L.Z()]; } finally { ad.delete(); }
        }
        if (t === "CYLINDRE") {
          // axis, radius and which side the material is on (for threads)
          const ad = new OC.BRepAdaptor_Surface(f.wrapped, true);
          try {
            const cy = ad.Cylinder(), pos = cy.Position();
            const P = (p) => [p.X(), p.Y(), p.Z()];
            const reversed = f.wrapped.Orientation() === OC.TopAbs_Orientation.TopAbs_REVERSED;
            info.r = cy.Radius(); info.ax = P(pos.Direction()); info.o = P(pos.Location());
            info.ext = (pos.Direct() ? 1 : -1) * (reversed ? -1 : 1) > 0;
          } finally { ad.delete(); }
        }
      }
    } catch (err) {}
    f.delete();
    return info;
  });
  tick();
  const edges = shape.edges;
  const edgeIndex = new Map(edges.map((ed, i) => [ed.hashCode, i]));
  const edgeInfo = edges.map((ed) => {
    const s = edgeSig(ed, bb);
    ed.delete();
    return s;
  });
  // which edges bound each face (so a face can be picked for a fillet)
  const faceEdges = [];
  for (const f of shape.faces) { const list = []; for (const ed of f.edges) { const i = edgeIndex.get(ed.hashCode); if (i !== undefined && !list.includes(i)) list.push(i); ed.delete(); } faceEdges.push(list); f.delete(); }
  // Dense bodies: hide the edges between nearly flush neighbours (the triangles of a
  // curved mesh surface), keeping the sharp ones, so it doesn't look like a wireframe.
  const groups = e.edgeGroups.map((g) => [g.start, g.count]);
  // seams: the edge where a round face (cylinder, cone, sphere, torus…) closes on itself. It is
  // not a real edge of the shape, so it isn't drawn (it showed as a stray line down a cylinder).
  for (const f of shape.faces) {
    const seen = new Map();
    for (const ed of f.edges) {
      const i = edgeIndex.get(ed.hashCode);
      let closed = false;
      try { closed = !!OC.BRep_Tool.IsClosed(ed.wrapped, f.wrapped); } catch (err) {}
      if (i !== undefined && closed) seen.set(i, 2);
      ed.delete();
    }
    f.delete();
    for (const [i, n] of seen) if (n > 1 && groups[i]) groups[i][1] = 0;
  }
  // smooth joins: where two faces meet without a crease (a round side made of several pieces, a
  // flat face split in two), there is no edge to see, so none is drawn
  if (edgeInfo.length <= 400 && faceEdges.length === faceInfo.length) {
    const owners = [];
    faceEdges.forEach((list, fi) => list.forEach((ei) => { (owners[ei] = owners[ei] || []).push(fi); }));
    const fl = shape.faces, el = shape.edges;
    try {
      for (let ei = 0; ei < el.length && ei < groups.length; ei++) {
        const o = owners[ei];
        if (!o || o.length !== 2 || !groups[ei][1]) continue;
        const A = faceInfo[o[0]], B = faceInfo[o[1]];
        let smooth = false;
        if (A.n && B.n) smooth = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] > 0.99985;
        else {
          try {
            const mid = el[ei].pointAt(0.5);
            const n1 = fl[o[0]].normalAt(mid), n2 = fl[o[1]].normalAt(mid);
            smooth = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z > 0.9994;
            n1.delete && n1.delete(); n2.delete && n2.delete(); mid.delete && mid.delete();
          } catch (err) {}
        }
        if (smooth) groups[ei][1] = 0;
      }
    } finally { fl.forEach((f) => f.delete()); el.forEach((x) => x.delete()); }
  }
  if (edgeInfo.length > 400 && faceEdges.length === faceInfo.length) {
    const owners = new Array(edgeInfo.length);
    faceEdges.forEach((list, fi) => list.forEach((ei) => { (owners[ei] = owners[ei] || []).push(fi); }));
    const cosLimit = Math.cos((25 * Math.PI) / 180);
    for (let ei = 0; ei < owners.length && ei < groups.length; ei++) {
      const o = owners[ei];
      if (!o || o.length !== 2) continue;
      const n1 = faceInfo[o[0]].n, n2 = faceInfo[o[1]].n;
      if (n1 && n2 && n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > cosLimit) groups[ei][1] = 0;
    }
  }
  tick();
  let volume = null;
  try { volume = R.measureVolume(shape); } catch (err) {}
  tick();
  if (typeof process !== "undefined" && process.env && process.env.MESH_T) console.log("meshShape ms:", TT.slice(1).map((t, i) => t - TT[i]).join(" "));
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    faceGroups: m.faceGroups.map((g) => [g.start, g.count]),
    faceInfo,
    lines: new Float32Array(e.lines),
    edgeGroups: groups,
    edgeInfo,
    faceEdges,
    bbox: { min: bb.min, max: bb.max },
    volume,
  };
}

export function buildBodies(bodies, quality = 1) {
  const out = [];
  for (const b of bodies) {
    try {
      const shape = evalNode(b.node);
      const mesh = meshShape(shape, quality);
      shape.delete();
      out.push({ id: b.id, rev: b.rev, ok: true, mesh });
    } catch (e) {
      out.push({ id: b.id, rev: b.rev, ok: false, error: friendly(e) });
    }
  }
  return out;
}

function friendly(e) {
  if (typeof e === "number") return "The geometry kernel couldn't build this shape";
  const msg = (e && e.message) || String(e);
  if (/BRep|Standard_|StdFail|NotDone/i.test(msg)) return "The geometry kernel couldn't build this shape";
  return msg;
}

export function exportStep(bodies) {
  const shapes = [];
  for (const b of bodies) {
    try { shapes.push(transformShape(evalNode(b.node), b.m)); } catch (e) {}
  }
  if (!shapes.length) throw new Error("Nothing to export");
  const comp = shapes.length === 1 ? shapes[0] : R.makeCompound(shapes);
  return comp.blobSTEP();
}
