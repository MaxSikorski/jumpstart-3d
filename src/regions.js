// 2D sketch geometry: resolves sketch entities, splits curves at their
// intersections, and finds the closed profiles (regions) like Fusion does.
const TAU = Math.PI * 2;
export const EPS = 1e-6;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const len = (a) => Math.hypot(a[0], a[1]);
export const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const normAng = (a) => ((a % TAU) + TAU) % TAU;
// is angle t inside ccw sweep from a0 to a1?
export function angIn(t, a0, a1, tol = 1e-9) {
  const sweep = normAng(a1 - a0) || TAU;
  const rel = normAng(t - a0);
  return rel <= sweep + tol || rel >= TAU - tol;
}

// ------------------------------------------------------------ resolve
// Turn a sketch (points by id + entities) into concrete curves.
export function resolveSketch(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, [p.x, p.y]]));
  const out = [];
  for (const e of sk.ents) {
    if (e.t === "line") {
      const a = P.get(e.a), b = P.get(e.b);
      if (!a || !b || d2(a, b) < EPS) continue;
      out.push({ id: e.id, t: "line", a, b, cons: !!e.cons, proj: !!e.proj, src: e });
    } else if (e.t === "circle") {
      const c = P.get(e.c);
      if (!c || !(e.r > EPS)) continue;
      out.push({ id: e.id, t: "circle", c, r: e.r, cons: !!e.cons, proj: !!e.proj, src: e });
    } else if (e.t === "arc") {
      const c = P.get(e.c), a = P.get(e.a), b = P.get(e.b);
      if (!c || !a || !b) continue;
      const r = d2(a, c);
      if (r < EPS) continue;
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
      const a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      out.push({ id: e.id, t: "arc", c, r, a0, a1, cons: !!e.cons, proj: !!e.proj, src: e,
        pa: a, pb: [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)] });
    } else if (e.t === "spline") {
      const fit = (e.pts || []).map((id) => P.get(id)).filter(Boolean);
      const c = makeSplineCurve(fit, !!e.closed);
      if (!c) continue;
      out.push({ id: e.id, ...c, cons: !!e.cons, proj: !!e.proj, src: e });
    } else if (e.t === "point") {
      const p = P.get(e.p);
      if (p) out.push({ id: e.id, t: "point", p, cons: !!e.cons, src: e });
    }
  }
  return out;
}

// ------------------------------------------------------------ splines
// A spline passes through its fit points (Catmull-Rom), stored as cubic Bezier spans.
// Its parameter runs 0..n (one unit per span).
export function splineSpans(P, closed) {
  const n = P.length;
  if (n < 2) return [];
  const get = (i) => (closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const cnt = closed ? n : n - 1;
  const spans = [];
  for (let i = 0; i < cnt; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    spans.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
  }
  return spans;
}
export function bezPt(b, t) {
  const u = 1 - t;
  return [u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0], u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]];
}
function bezD(b, t) {
  const u = 1 - t;
  return [3 * u * u * (b[1][0] - b[0][0]) + 6 * u * t * (b[2][0] - b[1][0]) + 3 * t * t * (b[3][0] - b[2][0]), 3 * u * u * (b[1][1] - b[0][1]) + 6 * u * t * (b[2][1] - b[1][1]) + 3 * t * t * (b[3][1] - b[2][1])];
}
// the part of a Bezier between t0 and t1
function bezSub(b, t0, t1) {
  const split = (bb, t) => { // returns right part from t
    const l = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const a1 = l(bb[0], bb[1]), a2 = l(bb[1], bb[2]), a3 = l(bb[2], bb[3]);
    const b1 = l(a1, a2), b2 = l(a2, a3), c1 = l(b1, b2);
    return { left: [bb[0], a1, b1, c1], right: [c1, b2, a3, bb[3]] };
  };
  let r = t0 > 1e-12 ? split(b, t0).right : b;
  if (t1 < 1 - 1e-12) r = split(r, (t1 - t0) / (1 - t0)).left;
  return r;
}
const SPL_SEG = 24;
export function makeSplineCurve(fit, closed) {
  const pts = [];
  for (const p of fit) if (!pts.length || d2(pts[pts.length - 1], p) > EPS) pts.push(p);
  if (closed && pts.length > 2 && d2(pts[0], pts[pts.length - 1]) < EPS) pts.pop();
  if (pts.length < 2 || (closed && pts.length < 3)) return null;
  const spans = splineSpans(pts, closed);
  const n = spans.length;
  const poly = [], polyS = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < SPL_SEG; k++) { poly.push(bezPt(spans[i], k / SPL_SEG)); polyS.push(i + k / SPL_SEG); }
  poly.push(spans[n - 1][3]); polyS.push(n);
  return { t: "spline", spans, n, closed, fit: pts, pa: spans[0][0], pb: spans[n - 1][3], poly, polyS };
}
function splinePoint(c, s) {
  const i = Math.max(0, Math.min(c.n - 1, Math.floor(s)));
  return bezPt(c.spans[i], Math.max(0, Math.min(1, s - i)));
}
function splineDeriv(c, s) {
  const i = Math.max(0, Math.min(c.n - 1, Math.floor(s)));
  return bezD(c.spans[i], Math.max(0, Math.min(1, s - i)));
}
// nearest parameter on a spline to point p
function splineParam(c, p) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < c.poly.length - 1; k++) {
    const a = c.poly[k], b = c.poly[k + 1], v = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), v) / (dot(v, v) || 1)));
    const d = d2(add(a, mul(v, t)), p);
    if (d < bd) { bd = d; best = c.polyS[k] + (c.polyS[k + 1] - c.polyS[k]) * t; }
  }
  // Newton polish
  for (let it = 0; it < 8; it++) {
    const q = splinePoint(c, best), dq = splineDeriv(c, best);
    const g = dot(sub(q, p), dq), h = dot(dq, dq);
    if (h < 1e-18) break;
    const nb = Math.max(0, Math.min(c.n, best - g / h));
    if (Math.abs(nb - best) < 1e-14) break;
    best = nb;
  }
  return best;
}
function splineDist(c, p) { return d2(splinePoint(c, splineParam(c, p)), p); }
// a spline piece (s0..s1) as Bezier spans, optionally reversed
export function splineSub(c, s0, s1, rev = false) {
  const out = [];
  for (let i = Math.floor(s0); i < Math.ceil(s1 - 1e-12) && i < c.n; i++) {
    const t0 = Math.max(0, s0 - i), t1 = Math.min(1, s1 - i);
    if (t1 - t0 < 1e-12) continue;
    out.push(bezSub(c.spans[i], t0, t1));
  }
  return rev ? out.reverse().map((b) => [b[3], b[2], b[1], b[0]]) : out;
}
// intersections of a spline with another curve, as points on the spline (refined)
function splineIntersect(S, O) {
  const out = [];
  const add1 = (p) => { if (!out.some((q) => d2(q, p) < 1e-7)) out.push(p); };
  const refine = (f, lo, hi) => {
    let flo = f(lo);
    for (let it = 0; it < 64; it++) {
      const m = (lo + hi) / 2, fm = f(m);
      if ((fm <= 0) === (flo <= 0)) { lo = m; flo = fm; } else hi = m;
    }
    return (lo + hi) / 2;
  };
  if (O.t === "spline") {
    // polyline crossings, then Newton on both parameters
    for (let i = 0; i < S.poly.length - 1; i++) for (let j = 0; j < O.poly.length - 1; j++) {
      const a = S.poly[i], b = S.poly[i + 1], c = O.poly[j], d = O.poly[j + 1];
      const r = sub(b, a), q = sub(d, c), den = cross(r, q);
      if (Math.abs(den) < 1e-14) continue;
      const t = cross(sub(c, a), q) / den, u = cross(sub(c, a), r) / den;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      let s = S.polyS[i] + (S.polyS[i + 1] - S.polyS[i]) * t, w = O.polyS[j] + (O.polyS[j + 1] - O.polyS[j]) * u;
      for (let it = 0; it < 20; it++) {
        const F = sub(splinePoint(S, s), splinePoint(O, w));
        const A = splineDeriv(S, s), B = splineDeriv(O, w);
        const det = -A[0] * B[1] + A[1] * B[0];
        if (Math.abs(det) < 1e-18) break;
        const ds = (B[1] * F[0] - B[0] * F[1]) / det, dw = (A[1] * F[0] - A[0] * F[1]) / det;
        s = Math.max(0, Math.min(S.n, s + ds)); w = Math.max(0, Math.min(O.n, w + dw));
        if (Math.abs(ds) + Math.abs(dw) < 1e-15) break;
      }
      const p = splinePoint(S, s);
      if (d2(p, splinePoint(O, w)) < 1e-7) add1(p);
    }
    return out;
  }
  // signed distance to the other curve's line / circle
  let f;
  if (O.t === "line") { const v = sub(O.b, O.a), L = len(v) || 1; f = (s) => cross(v, sub(splinePoint(S, s), O.a)) / L; }
  else f = (s) => d2(splinePoint(S, s), O.c) - O.r;
  let prevS = 0, prev = f(0);
  if (Math.abs(prev) < 1e-9) add1(splinePoint(S, 0));
  const steps = S.n * SPL_SEG;
  for (let k = 1; k <= steps; k++) {
    const sk = (k / steps) * S.n, v = f(sk);
    if (Math.abs(v) < 1e-9) add1(splinePoint(S, sk));
    else if ((v < 0) !== (prev < 0) && Math.abs(prev) >= 1e-9) add1(splinePoint(S, refine(f, prevS, sk)));
    prevS = sk; prev = v;
  }
  return out.filter((p) => onCurve(O, p, 1e-6));
}

// ------------------------------------------------------------ curve helpers
export function curvePoint(c, s) {
  // s: param (line 0..1, circle/arc angle, spline 0..n)
  if (c.t === "spline") return splinePoint(c, s);
  if (c.t === "line") return add(c.a, mul(sub(c.b, c.a), s));
  return [c.c[0] + c.r * Math.cos(s), c.c[1] + c.r * Math.sin(s)];
}
function paramOf(c, p) {
  if (c.t === "spline") return splineParam(c, p);
  if (c.t === "line") {
    const v = sub(c.b, c.a);
    return dot(sub(p, c.a), v) / dot(v, v);
  }
  return Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
}
function onCurve(c, p, tol) {
  if (c.t === "spline") return splineDist(c, p) < tol;
  if (c.t === "line") {
    const v = sub(c.b, c.a);
    const t = dot(sub(p, c.a), v) / dot(v, v);
    if (t < -tol / len(v) || t > 1 + tol / len(v)) return false;
    return d2(curvePoint(c, Math.max(0, Math.min(1, t))), p) < tol;
  }
  if (Math.abs(d2(p, c.c) - c.r) > tol) return false;
  if (c.t === "circle") return true;
  return angIn(Math.atan2(p[1] - c.c[1], p[0] - c.c[0]), c.a0, c.a1, tol / c.r);
}
// raw intersections of the underlying infinite line / full circle
function rawIntersect(A, B) {
  const isL = (x) => x.t === "line";
  if (isL(A) && isL(B)) {
    const r = sub(A.b, A.a), s = sub(B.b, B.a);
    const den = cross(r, s);
    if (Math.abs(den) < 1e-12) {
      // collinear overlap: report endpoints of each lying on the other
      return [A.a, A.b, B.a, B.b];
    }
    const t = cross(sub(B.a, A.a), s) / den;
    return [add(A.a, mul(r, t))];
  }
  if (isL(A) !== isL(B)) {
    const L = isL(A) ? A : B, C = isL(A) ? B : A;
    const d = sub(L.b, L.a), f = sub(L.a, C.c);
    const a = dot(d, d), b = 2 * dot(f, d), cc = dot(f, f) - C.r * C.r;
    let disc = b * b - 4 * a * cc;
    if (disc < -1e-9 * a) return [];
    disc = Math.max(0, disc);
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    return sq < 1e-12 ? [add(L.a, mul(d, t1))] : [add(L.a, mul(d, t1)), add(L.a, mul(d, t2))];
  }
  const dd = d2(A.c, B.c);
  if (dd < 1e-12) return Math.abs(A.r - B.r) < 1e-9 && A.t === "arc" && B.t === "arc" ? [A.pa, A.pb, B.pa, B.pb] : [];
  if (dd > A.r + B.r + 1e-9 || dd < Math.abs(A.r - B.r) - 1e-9) return [];
  const a = (A.r * A.r - B.r * B.r + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const m = add(A.c, mul(sub(B.c, A.c), a / dd));
  const off = mul([-(B.c[1] - A.c[1]) / dd, (B.c[0] - A.c[0]) / dd], h);
  return h < 1e-12 ? [m] : [add(m, off), sub(m, off)];
}
export function intersect(A, B, tol = 1e-6) {
  if (A.t === "spline") return splineIntersect(A, B);
  if (B.t === "spline") return splineIntersect(B, A);
  return rawIntersect(A, B).filter((p) => onCurve(A, p, tol) && onCurve(B, p, tol));
}

// ------------------------------------------------------------ split into pieces
// A piece: {ent, t:'line'|'arc'|'circle', a, b, (c, r, s0, s1 for arcs)}
export function splitCurves(curves) {
  const geo = curves.filter((c) => c.t !== "point" && !c.cons);
  const cuts = geo.map(() => []);
  for (let i = 0; i < geo.length; i++)
    for (let j = i + 1; j < geo.length; j++) {
      for (const p of intersect(geo[i], geo[j])) {
        cuts[i].push(p);
        cuts[j].push(p);
      }
    }
  const pieces = [];
  geo.forEach((c, i) => {
    if (c.t === "spline") {
      let ts = [0, c.n, ...cuts[i].map((p) => paramOf(c, p))].filter((t) => t >= -1e-9 && t <= c.n + 1e-9).map((t) => Math.max(0, Math.min(c.n, t))).sort((x, y) => x - y);
      const uniq = [];
      for (const t of ts) if (!uniq.length || t - uniq[uniq.length - 1] > 1e-7) uniq.push(t);
      if (c.closed && uniq.length === 2) { pieces.push({ ent: c.id, cid: i, t: "spline", c, s0: 0, s1: c.n, a: c.pa, b: c.pb, whole: true }); return; }
      for (let k = 0; k < uniq.length - 1; k++) pieces.push({ ent: c.id, cid: i, t: "spline", c, s0: uniq[k], s1: uniq[k + 1], a: curvePoint(c, uniq[k]), b: curvePoint(c, uniq[k + 1]) });
      return;
    }
    if (c.t === "line") {
      const ts = [0, 1, ...cuts[i].map((p) => paramOf(c, p))].filter((t) => t >= -1e-9 && t <= 1 + 1e-9).sort((x, y) => x - y);
      const L = d2(c.a, c.b);
      for (let k = 0; k < ts.length - 1; k++) {
        if ((ts[k + 1] - ts[k]) * L < 1e-6) continue;
        pieces.push({ ent: c.id, cid: i, t: "line", s0: ts[k], s1: ts[k + 1], a: curvePoint(c, ts[k]), b: curvePoint(c, ts[k + 1]) });
      }
    } else {
      // angles relative to start
      const start = c.t === "arc" ? c.a0 : 0;
      const sweep = c.t === "arc" ? normAng(c.a1 - c.a0) || TAU : TAU;
      let rels = cuts[i].map((p) => normAng(paramOf(c, p) - start)).filter((r) => r <= sweep + 1e-9);
      if (c.t === "arc") rels.push(0, sweep);
      rels = rels.map((r) => (r > TAU - 1e-9 ? (c.t === "arc" ? r : 0) : r)).sort((x, y) => x - y);
      const uniq = [];
      for (const r of rels) if (!uniq.length || r - uniq[uniq.length - 1] > 1e-7) uniq.push(r);
      if (c.t === "circle") {
        if (uniq.length < 2) {
          pieces.push({ ent: c.id, cid: i, t: "circle", c: c.c, r: c.r });
          return;
        }
        uniq.push(uniq[0] + TAU);
      }
      for (let k = 0; k < uniq.length - 1; k++) {
        const s0 = start + uniq[k], s1 = start + uniq[k + 1];
        if ((s1 - s0) * c.r < 1e-6) continue;
        pieces.push({ ent: c.id, cid: i, t: "arc", c: c.c, r: c.r, s0, s1, a: curvePoint(c, s0), b: curvePoint(c, s1) });
      }
    }
  });
  return { pieces, geo, cuts };
}

// sample a piece from its start to its end (or reversed)
export function samplePiece(p, rev = false, seg = 48) {
  if (p.t === "line") return rev ? [p.b, p.a] : [p.a, p.b];
  if (p.t === "spline") {
    const n = Math.max(4, Math.ceil((p.s1 - p.s0) * (seg >= 720 ? 400 : 24)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curvePoint(p.c, rev ? p.s1 + (p.s0 - p.s1) * (i / n) : p.s0 + (p.s1 - p.s0) * (i / n)));
    return pts;
  }
  if (p.t === "circle") {
    const pts = [];
    for (let i = 0; i < 72; i++) pts.push(curvePoint(p, (i / 72) * TAU * (rev ? -1 : 1)));
    return pts;
  }
  const n = Math.max(2, Math.ceil((Math.abs(p.s1 - p.s0) / TAU) * seg) + 1);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = rev ? p.s1 + (p.s0 - p.s1) * (i / n) : p.s0 + (p.s1 - p.s0) * (i / n);
    pts.push(curvePoint(p, t));
  }
  return pts;
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------ regions
export function findRegions(curves) {
  const { pieces } = splitCurves(curves);
  const loops = []; // {cyc:[{p,rev}], poly, area, ents}

  // standalone circles are their own loop
  for (const p of pieces) if (p.t === "circle" || (p.t === "spline" && p.whole)) {
    const poly = samplePiece(p);
    loops.push({ cyc: [{ p, rev: false }], poly, area: polyArea(poly) });
    loops.push({ cyc: [{ p, rev: true }], poly: samplePiece(p, true), area: -polyArea(poly) });
  }

  // graph of open pieces
  const nodes = [];
  const nodeOf = (pt) => {
    for (let i = 0; i < nodes.length; i++) if (d2(nodes[i], pt) < 1e-5) return i;
    nodes.push(pt);
    return nodes.length - 1;
  };
  let edges = pieces.filter((p) => p.t !== "circle" && !(p.t === "spline" && p.whole)).map((p) => ({ p, u: nodeOf(p.a), v: nodeOf(p.b) }));
  edges = edges.filter((e) => e.u !== e.v || e.p.t === "arc" || e.p.t === "spline");
  // two straight pieces between the same two points (a drawn line lying on a face's projected
  // edge, say) are one edge: duplicates make the face tracing walk around both shapes as one
  {
    const seen = new Map(), out = [];
    for (const e of edges) {
      if (e.p.t !== "line") { out.push(e); continue; }
      const k = Math.min(e.u, e.v) + ":" + Math.max(e.u, e.v);
      const j = seen.get(k);
      if (j == null) { seen.set(k, out.length); out.push(e); }
      else if (out[j].p.proj && !e.p.proj) out[j] = e; // keep the one the user drew
    }
    edges = out;
  }
  // prune dangling edges
  for (let changed = true; changed; ) {
    changed = false;
    const deg = new Map();
    for (const e of edges) { deg.set(e.u, (deg.get(e.u) || 0) + 1); deg.set(e.v, (deg.get(e.v) || 0) + 1); }
    const keep = edges.filter((e) => deg.get(e.u) > 1 && deg.get(e.v) > 1);
    if (keep.length !== edges.length) { edges = keep; changed = true; }
  }
  // half edges
  const half = [];
  edges.forEach((e, i) => {
    half.push({ e: i, rev: false, from: e.u, to: e.v });
    half.push({ e: i, rev: true, from: e.v, to: e.u });
  });
  const outAng = (h) => {
    const p = edges[h.e].p;
    const pts = samplePiece(p, h.rev, 720);
    const from = pts[0];
    // direction to a point a little way along the curve
    let q = pts[1];
    const L = p.t === "line" ? d2(p.a, p.b) : Math.abs(p.s1 - p.s0) * p.r;
    if (p.t === "line") q = add(from, mul(sub(pts[1], from), Math.min(1, 1e-3 / Math.max(L, 1e-9)) ));
    return Math.atan2(q[1] - from[1], q[0] - from[0]);
  };
  const byNode = new Map();
  half.forEach((h, i) => {
    h.ang = outAng(h);
    if (!byNode.has(h.from)) byNode.set(h.from, []);
    byNode.get(h.from).push(i);
  });
  for (const list of byNode.values()) list.sort((a, b) => half[a].ang - half[b].ang);
  const twin = (i) => i ^ 1;
  const used = new Uint8Array(half.length);
  for (let i = 0; i < half.length; i++) {
    if (used[i]) continue;
    const cyc = [];
    let cur = i, guard = 0;
    while (!used[cur] && guard++ < 10000) {
      used[cur] = 1;
      cyc.push(cur);
      const h = half[cur];
      const list = byNode.get(h.to);
      const t = twin(cur);
      const k = list.indexOf(t);
      // next edge clockwise from the twin => face on the left
      cur = list[(k - 1 + list.length) % list.length];
    }
    if (cur !== i) continue;
    const segs = cyc.map((hi) => ({ p: edges[half[hi].e].p, rev: half[hi].rev }));
    const poly = [];
    for (const s of segs) { const pts = samplePiece(s.p, s.rev); poly.push(...pts.slice(0, -1)); }
    loops.push({ cyc: segs, poly, area: polyArea(poly) });
  }

  // positive loops are faces; negative ones are outer boundaries (holes for the face containing them)
  const faces = loops.filter((l) => l.area > 1e-9).map((l) => ({ ...l, holes: [] }));
  const outers = loops.filter((l) => l.area < -1e-9);
  for (const o of outers) {
    const probe = o.poly[0];
    let best = null;
    for (const f of faces) {
      if (f.poly === o.poly) continue;
      // skip the face bounded by the same cycle (same component, same boundary)
      if (Math.abs(f.area + o.area) < 1e-9 && sameCycle(f, o)) continue;
      const mid = interiorProbe(o);
      if (pointInPoly(mid, f.poly) && (!best || f.area < best.area)) {
        if (o.cyc.some((s) => f.cyc.some((t) => t.p === s.p))) continue; // same component
        best = f;
      }
    }
    if (best) best.holes.push(o);
  }
  // only keep top-level holes (a hole inside another hole of the same face belongs to a deeper face)
  for (const f of faces) {
    f.holes = f.holes.filter((h) => !f.holes.some((g) => g !== h && Math.abs(g.area) > Math.abs(h.area) && pointInPoly(h.poly[0], g.poly)));
  }
  return faces.map((f, i) => toRegion(f, i));
}
function sameCycle(a, b) {
  return a.cyc.length === b.cyc.length && a.cyc.every((s) => b.cyc.some((t) => t.p === s.p));
}
function interiorProbe(loop) {
  // a point on the boundary is fine for containment tests against other components
  return loop.poly[Math.floor(loop.poly.length / 2)];
}

function segOut(s) {
  const p = s.p;
  if (p.t === "spline") return { t: "bez", a: s.rev ? p.b : p.a, b: s.rev ? p.a : p.b, spans: splineSub(p.c, p.s0, p.s1, s.rev) };
  if (p.t === "circle") return { t: "circle", c: p.c, r: p.r };
  if (p.t === "line") return s.rev ? { t: "line", a: p.b, b: p.a } : { t: "line", a: p.a, b: p.b };
  const mid = curvePoint(p, (p.s0 + p.s1) / 2);
  return s.rev ? { t: "arc", a: p.b, b: p.a, m: mid } : { t: "arc", a: p.a, b: p.b, m: mid };
}
function toRegion(f) {
  const ents = [...new Set(f.cyc.map((s) => s.p.ent))].sort();
  const holeAreas = f.holes.reduce((s, h) => s + Math.abs(h.area), 0);
  return {
    key: ents.join(","),
    ents,
    outer: f.cyc.map(segOut),
    holes: f.holes.map((h) => h.cyc.map(segOut)),
    poly: f.poly,
    holePolys: f.holes.map((h) => h.poly),
    area: f.area - holeAreas,
    pt: insidePoint(f.poly, f.holes.map((h) => h.poly)),
  };
}
// a point strictly inside a polygon (and outside its holes)
export function insidePoint(poly, holes = []) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  let best = null, bw = -1;
  for (let k = 1; k < 16; k++) {
    const y = minY + ((maxY - minY) * k) / 16 + 1e-7;
    const xs = [];
    for (const ring of [poly, ...holes])
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bw) { bw = w; best = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
  }
  return best || poly[0];
}
export function regionContains(r, pt) {
  return pointInPoly(pt, r.poly) && !r.holePolys.some((h) => pointInPoly(pt, h));
}

// pick the region a saved reference points to
export function resolveRegionRef(regions, ref) {
  const same = regions.filter((r) => r.key === ref.key);
  const pool = same.length ? same : regions;
  const inside = pool.filter((r) => regionContains(r, ref.pt));
  if (inside.length) return inside.sort((a, b) => a.area - b.area)[0];
  if (same.length === 1) return same[0];
  return null;
}

// ------------------------------------------------------------ trim support
// Returns the intersection-bounded span of curve `cid` around `pt`.
export function trimSpan(curves, ent, pt) {
  const { geo, cuts } = splitCurves(curves);
  const i = geo.findIndex((c) => c.id === ent);
  if (i < 0) return null;
  const c = geo[i];
  if (c.t === "spline") {
    const t = paramOf(c, pt);
    const ts = cuts[i].map((p) => paramOf(c, p)).filter((x) => x > 1e-7 && x < c.n - 1e-7);
    if (c.closed && !ts.length) return { c, whole: true };
    const lo = Math.max(0, ...ts.filter((x) => x < t));
    const hi = Math.min(c.n, ...ts.filter((x) => x > t));
    return { c, lo, hi };
  }
  if (c.t === "line") {
    const t = paramOf(c, pt);
    const ts = cuts[i].map((p) => paramOf(c, p)).filter((x) => x > 1e-7 && x < 1 - 1e-7);
    const lo = Math.max(0, ...ts.filter((x) => x < t));
    const hi = Math.min(1, ...ts.filter((x) => x > t));
    return { c, lo, hi };
  }
  const start = c.t === "arc" ? c.a0 : 0;
  const sweep = c.t === "arc" ? normAng(c.a1 - c.a0) || TAU : TAU;
  const rel = normAng(paramOf(c, pt) - start);
  const rs = cuts[i].map((p) => normAng(paramOf(c, p) - start)).filter((r) => r > 1e-7 && r < sweep - 1e-7);
  if (c.t === "circle") {
    if (rs.length < 2) return { c, whole: true };
    const below = rs.filter((r) => r < rel), above = rs.filter((r) => r > rel);
    const lo = below.length ? Math.max(...below) : Math.max(...rs) - TAU;
    const hi = above.length ? Math.min(...above) : Math.min(...rs) + TAU;
    return { c, lo: start + lo, hi: start + hi };
  }
  const lo = Math.max(0, ...rs.filter((r) => r < rel));
  const hi = Math.min(sweep, ...rs.filter((r) => r > rel));
  return { c, lo: start + lo, hi: start + hi, sweep, start };
}

// distance from point to a curve (for picking)
// closest point on a curve
export function nearestOnCurve(c, p) {
  if (c.t === "line") {
    const v = sub(c.b, c.a);
    const t = Math.max(0, Math.min(1, dot(sub(p, c.a), v) / (dot(v, v) || 1)));
    return add(c.a, mul(v, t));
  }
  if (c.t === "spline") return splinePoint(c, splineParam(c, p));
  return curvePoint(c, Math.atan2(p[1] - c.c[1], p[0] - c.c[0]));
}
export function distToCurve(c, p) {
  if (c.t === "point") return d2(c.p, p);
  if (c.t === "spline") return splineDist(c, p);
  if (c.t === "line") {
    const v = sub(c.b, c.a);
    const t = Math.max(0, Math.min(1, dot(sub(p, c.a), v) / dot(v, v)));
    return d2(add(c.a, mul(v, t)), p);
  }
  const ang = Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  if (c.t === "circle" || angIn(ang, c.a0, c.a1)) return Math.abs(d2(p, c.c) - c.r);
  return Math.min(d2(p, c.pa), d2(p, c.pb));
}
export function sampleCurve(c, seg = 96) {
  if (c.t === "line") return [c.a, c.b];
  if (c.t === "spline") return c.poly;
  if (c.t === "circle") {
    const pts = [];
    for (let i = 0; i <= seg; i++) pts.push(curvePoint(c, (i / seg) * TAU));
    return pts;
  }
  if (c.t === "arc") {
    const sw = normAng(c.a1 - c.a0) || TAU;
    const n = Math.max(4, Math.ceil((sw / TAU) * seg));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(curvePoint(c, c.a0 + (sw * i) / n));
    return pts;
  }
  return [];
}
// all intersection points between curves (for snapping)
export function allIntersections(curves) {
  const geo = curves.filter((c) => c.t !== "point");
  const out = [];
  for (let i = 0; i < geo.length; i++)
    for (let j = i + 1; j < geo.length; j++) out.push(...intersect(geo[i], geo[j]));
  return out;
}
