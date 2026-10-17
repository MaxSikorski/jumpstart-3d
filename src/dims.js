// Sketch dimensions, like Fusion 360's Sketch Dimension (D): pick a line, circle, arc, or
// two things (points, lines, round shapes), move the pointer to place the dimension, click,
// then type the value. Dimensions are stored with the sketch constraints (t: "dim") and
// drive the geometry through the solver in constraints.js.
//   k: "dist" (two points; o = "h" horizontal, "v" vertical, "a" aligned)
//      "pl"   (a point to a line), "ll" (two parallel lines)
//      "dia" / "rad" (a circle's diameter, an arc's radius)
//      "ang"  (between two lines; s1/s2 pick which way along each line the angle opens)
//   v: the value (mm or degrees); off: where the label sits (sketch coordinates)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function ctx(sk) {
  const P = new Map(sk.pts.map((p) => [p.id, p]));
  const E = new Map(sk.ents.map((e) => [e.id, e]));
  const pt = (id) => { const p = P.get(id); return p ? [p.x, p.y] : null; };
  const radius = (e) => (e.t === "circle" ? e.r : len(sub(pt(e.a), pt(e.c))));
  return { P, E, pt, radius };
}
// where two lines meet (or the middle between them if they're parallel)
function vertexOf(a1, b1, a2, b2) {
  const d1 = sub(b1, a1), d2 = sub(b2, a2), den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return mul(add(add(a1, b1), add(a2, b2)), 0.25);
  const t = cross(sub(a2, a1), d2) / den;
  return add(a1, mul(d1, t));
}

// The current value of a dimension (what the geometry measures now).
export function measureDim(sk, c) {
  const { E, pt, radius } = ctx(sk);
  if (c.k === "dist") {
    const a = pt(c.p1), b = pt(c.p2);
    if (!a || !b) return NaN;
    return c.o === "h" ? Math.abs(b[0] - a[0]) : c.o === "v" ? Math.abs(b[1] - a[1]) : len(sub(b, a));
  }
  if (c.k === "pl" || c.k === "ll") {
    const e = E.get(c.k === "pl" ? c.e : c.e1);
    const p = c.k === "pl" ? pt(c.p) : (() => { const e2 = E.get(c.e2); return e2 ? mul(add(pt(e2.a), pt(e2.b)), 0.5) : null; })();
    if (!e || !p) return NaN;
    const a = pt(e.a), b = pt(e.b), n = nrm([-(b[1] - a[1]), b[0] - a[0]]);
    return Math.abs(dot(sub(p, a), n));
  }
  if (c.k === "dia" || c.k === "rad") { const e = E.get(c.e1); return e ? radius(e) * (c.k === "dia" ? 2 : 1) : NaN; }
  if (c.k === "ang") {
    const e1 = E.get(c.e1), e2 = E.get(c.e2);
    if (!e1 || !e2) return NaN;
    const d1 = mul(sub(pt(e1.b), pt(e1.a)), c.s1 || 1), d2 = mul(sub(pt(e2.b), pt(e2.a)), c.s2 || 1);
    return Math.abs(Math.atan2(cross(d1, d2), dot(d1, d2))) * 180 / Math.PI;
  }
  return NaN;
}

// A new dimension from the picks so far and the pointer (null: not a dimension yet).
// picks: [{ kind: "pt", pid } | { kind: "line", e } | { kind: "round", e }]
export function buildDim(sk, picks, cur) {
  const { pt } = ctx(sk);
  const withV = (d) => { d.v = +measureDim(sk, d).toFixed(6); return isFinite(d.v) ? d : null; };
  const orient = (a, b) => {
    // like Fusion: pull the label above/below for a horizontal size, left/right for a
    // vertical one, and out to the side of a slanted line for its true length
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const inX = cur[0] > x0 && cur[0] < x1, inY = cur[1] > y0 && cur[1] < y1;
    if (Math.abs(a[1] - b[1]) < 1e-9) return "h";
    if (Math.abs(a[0] - b[0]) < 1e-9) return "v";
    if (inX && !inY) return "h";
    if (inY && !inX) return "v";
    return "a";
  };
  const ptOf = (p) => (p.kind === "pt" ? p.pid : p.kind === "round" ? p.e.c : null);
  if (picks.length === 1) {
    const p = picks[0];
    if (p.kind === "line") return withV({ t: "dim", k: "dist", p1: p.e.a, p2: p.e.b, o: orient(pt(p.e.a), pt(p.e.b)), off: cur.slice() });
    if (p.kind === "round") return withV({ t: "dim", k: p.e.t === "circle" ? "dia" : "rad", e1: p.e.id, off: cur.slice() });
    return null;
  }
  if (picks.length !== 2) return null;
  const [A, B] = picks;
  const pa = ptOf(A), pb = ptOf(B);
  if (pa && pb) {
    if (pa === pb) return null;
    return withV({ t: "dim", k: "dist", p1: pa, p2: pb, o: orient(pt(pa), pt(pb)), off: cur.slice() });
  }
  if ((pa && B.kind === "line") || (pb && A.kind === "line")) {
    const p = pa || pb, line = pa ? B.e : A.e;
    return withV({ t: "dim", k: "pl", p, e: line.id, off: cur.slice() });
  }
  if (A.kind === "line" && B.kind === "line") {
    if (A.e.id === B.e.id) return null;
    const a1 = pt(A.e.a), b1 = pt(A.e.b), a2 = pt(B.e.a), b2 = pt(B.e.b);
    const d1 = sub(b1, a1), d2 = sub(b2, a2);
    if (Math.abs(cross(nrm(d1), nrm(d2))) < 1e-4) return withV({ t: "dim", k: "ll", e1: A.e.id, e2: B.e.id, off: cur.slice() });
    // the angle opens toward where the label is placed
    const V = vertexOf(a1, b1, a2, b2), w = sub(cur, V);
    const s1 = dot(w, d1) >= 0 ? 1 : -1, s2 = dot(w, d2) >= 0 ? 1 : -1;
    return withV({ t: "dim", k: "ang", e1: A.e.id, e2: B.e.id, s1, s2, off: cur.slice() });
  }
  return null;
}

// What to draw for a dimension: line segments (sketch coordinates, flat [x,y,0,...] pairs),
// the label position and its text. px = sketch units per screen pixel (for arrow size).
export function dimGraphics(sk, c, px, fmtLen) {
  const { E, pt, radius } = ctx(sk);
  const segs = [];
  const line = (p, q) => segs.push(p[0], p[1], 0, q[0], q[1], 0);
  const arrow = (tip, dir) => {
    // an open arrowhead at tip, pointing along dir
    const d = nrm(dir), n = [-d[1], d[0]], L = 9 * px, W = 3.5 * px;
    line(tip, add(sub(tip, mul(d, L)), mul(n, W)));
    line(tip, sub(sub(tip, mul(d, L)), mul(n, W)));
  };
  const gap = 3 * px, over = 4 * px;
  const ext = (from, to) => { const d = sub(to, from), l = len(d); if (l < gap) return; const u = mul(d, 1 / l); line(add(from, mul(u, gap)), add(to, mul(u, over))); };
  const off = c.off || [0, 0];
  let at = off, text = "";
  if (c.k === "dist") {
    const a = pt(c.p1), b = pt(c.p2);
    if (!a || !b) return null;
    let A, B;
    if (c.o === "h") { A = [a[0], off[1]]; B = [b[0], off[1]]; at = [off[0], off[1]]; }
    else if (c.o === "v") { A = [off[0], a[1]]; B = [off[0], b[1]]; at = [off[0], off[1]]; }
    else {
      const u = nrm(sub(b, a)), n = [-u[1], u[0]], t = dot(sub(off, a), n);
      A = add(a, mul(n, t)); B = add(b, mul(n, t));
      at = add(A, mul(u, dot(sub(off, A), u)));
    }
    ext(a, A); ext(b, B);
    line(A, B);
    if (len(sub(B, A)) > 1e-9) { arrow(A, sub(A, B)); arrow(B, sub(B, A)); }
    text = fmtLen(c.v);
  } else if (c.k === "pl" || c.k === "ll") {
    const e = E.get(c.k === "pl" ? c.e : c.e1);
    let p;
    if (c.k === "pl") p = pt(c.p); else { const e2 = E.get(c.e2); p = e2 ? mul(add(pt(e2.a), pt(e2.b)), 0.5) : null; }
    if (!e || !p) return null;
    const a = pt(e.a), b = pt(e.b), u = nrm(sub(b, a));
    const f = add(a, mul(u, dot(sub(p, a), u))); // foot on the line
    // the dimension runs from the point square to the line, slid along to the label
    const along = dot(sub(off, f), u);
    const P1 = add(p, mul(u, along)), F1 = add(f, mul(u, along));
    ext(p, P1); ext(f, F1);
    line(P1, F1);
    if (len(sub(F1, P1)) > 1e-9) { arrow(P1, sub(P1, F1)); arrow(F1, sub(F1, P1)); }
    const k = dot(sub(off, F1), nrm(sub(P1, F1)));
    at = add(F1, mul(nrm(sub(P1, F1)), Math.max(0, Math.min(len(sub(P1, F1)), k))));
    text = fmtLen(c.v);
  } else if (c.k === "dia" || c.k === "rad") {
    const e = E.get(c.e1);
    if (!e) return null;
    const C = pt(e.c), r = radius(e);
    let u = sub(off, C);
    if (len(u) < 1e-9) u = [1, 0];
    u = nrm(u);
    const rim = add(C, mul(u, r));
    if (c.k === "dia") { const rim2 = sub(C, mul(u, r)); line(rim2, rim); arrow(rim2, sub(rim2, rim)); arrow(rim, sub(rim, rim2)); }
    else { line(C, rim); arrow(rim, sub(rim, C)); }
    if (len(sub(off, C)) > r) line(rim, off); // leader out to the label
    at = off;
    text = (c.k === "dia" ? "⌀" : "R") + fmtLen(c.v);
  } else if (c.k === "ang") {
    const e1 = E.get(c.e1), e2 = E.get(c.e2);
    if (!e1 || !e2) return null;
    const a1 = pt(e1.a), b1 = pt(e1.b), a2 = pt(e2.a), b2 = pt(e2.b);
    const V = vertexOf(a1, b1, a2, b2);
    const d1 = nrm(mul(sub(b1, a1), c.s1 || 1)), d2 = nrm(mul(sub(b2, a2), c.s2 || 1));
    const R = Math.max(len(sub(off, V)), 12 * px);
    const t1 = Math.atan2(d1[1], d1[0]);
    let sweep = Math.atan2(cross(d1, d2), dot(d1, d2));
    const n = Math.max(6, Math.ceil(Math.abs(sweep) / 0.08));
    let prev = add(V, mul(d1, R));
    for (let i = 1; i <= n; i++) { const t = t1 + (sweep * i) / n; const q = add(V, [R * Math.cos(t), R * Math.sin(t)]); line(prev, q); prev = q; }
    // extension lines from the lines out to the arc when the arc lies beyond them
    for (const [d, a, b] of [[d1, a1, b1], [d2, a2, b2]]) {
      const far = Math.max(dot(sub(a, V), d), dot(sub(b, V), d));
      if (R > far) ext(add(V, mul(d, far)), add(V, mul(d, R)));
    }
    const sgn = Math.sign(sweep) || 1;
    arrow(add(V, mul(d1, R)), [d1[1] * sgn, -d1[0] * sgn]);
    arrow(add(V, mul(d2, R)), [-d2[1] * sgn, d2[0] * sgn]);
    const tm = t1 + sweep / 2;
    at = add(V, [R * Math.cos(tm), R * Math.sin(tm)]);
    text = (+c.v.toFixed(2)) + "°";
  } else return null;
  return { segs, at, text };
}
