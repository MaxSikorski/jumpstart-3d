// jumpstart-3d: advanced CAD calls (IMPROVEMENT_PLAN 9.1). AGPL-3.0-only.
// Shapes as data -> sketch points, entities and constraints, every shape fully dimensioned (degrees of freedom 0) the way the
// sketcher's own tools leave it; and the default profile choice for Extrude and Revolve. Pure: no app, no browser.
import { uid } from "./util.js";
import { pointInPoly, regionContains } from "./regions.js";

const KEYS = {
  rect: ["center", "size"], roundrect: ["center", "size", "radius"], circle: ["center", "diameter"], slot: ["center", "length", "width", "angle"],
  polygon: ["center", "sides", "diameter"], polyline: ["points", "closed"], line: ["from", "to", "construction"],
};
const MAX_SKETCH = 2000;
const isNum = (x) => typeof x === "number" && isFinite(x);
const isPair = (a) => Array.isArray(a) && a.length === 2 && a.every(isNum);
const tiny = (x) => Math.abs(x) < 1e-9;
const plainNum = (v, what) => { if (isNum(v)) return { v }; throw new Error(`${what} "${v}" does not give a usable number`); };

class Sketch {
  pts = []; ents = []; cons = []; origin = null;
  pt(x, y) { const id = uid("p"); this.pts.push({ id, x, y }); return id; }
  ent(e) { const id = uid("e"); this.ents.push({ id, ...e }); return id; }
  con(c) { this.cons.push({ id: uid("k"), ...c }); }
  dim(c, n, off) { this.con({ t: "dim", ...c, v: n.v, ...(n.expr ? { expr: n.expr } : {}), off }); }
  // an anchor point at (x, y): on the origin, or measured from a point on it
  place(q, x, y) {
    if (tiny(x) && tiny(y)) return this.con({ t: "origin", p: q });
    if (!this.origin) { this.origin = this.pt(0, 0); this.ent({ t: "point", p: this.origin }); this.con({ t: "origin", p: this.origin }); }
    const o = this.origin;
    if (tiny(x)) this.con({ t: "vertical", p1: o, p2: q }); else this.dim({ k: "dist", p1: o, p2: q, o: "h" }, { v: Math.abs(x) }, [x / 2, -4]);
    if (tiny(y)) this.con({ t: "horizontal", p1: o, p2: q }); else this.dim({ k: "dist", p1: o, p2: q, o: "v" }, { v: Math.abs(y) }, [-4, y / 2]);
  }
  // a line between two plain points, held by the sketcher's rule: horizontal or vertical with its length, else both extents
  segment(a, b, ia, ib, cons) {
    const id = this.ent({ t: "line", a: ia, b: ib, ...(cons ? { cons: true } : {}) });
    const dx = b[0] - a[0], dy = b[1] - a[1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (!tiny(dx) && !tiny(dy)) {
      this.dim({ k: "dist", p1: ia, p2: ib, o: "h" }, { v: Math.abs(dx) }, [mx, Math.min(a[1], b[1]) - 6]);
      this.dim({ k: "dist", p1: ia, p2: ib, o: "v" }, { v: Math.abs(dy) }, [Math.max(a[0], b[0]) + 6, my]);
    } else if (tiny(dy)) {
      this.con({ t: "horizontal", e1: id });
      this.dim({ k: "dist", p1: ia, p2: ib, o: "h" }, { v: Math.abs(dx) }, [mx, a[1] - 6]);
    } else {
      this.con({ t: "vertical", e1: id });
      this.dim({ k: "dist", p1: ia, p2: ib, o: "v" }, { v: Math.abs(dy) }, [a[0] + 6, my]);
    }
    return id;
  }
}

// shapes: the list the caller gave; num(value, what) -> { v, expr? } turns a number or an expression into a value (and throws
// `<what> "<text>" does not give a usable number`). Returns { pts, ents, cons, shapes: [{ type, ents, center? }] }.
export function buildShapes(shapes, num = plainNum) {
  if (!Array.isArray(shapes) || shapes.length < 1 || shapes.length > 200) throw new Error("shapes must be a list of 1 to 200 shapes");
  let points = 0, entities = 0;
  for (const s of shapes) {
    const m = Array.isArray(s?.points) ? s.points.length : 0, n = Number.isInteger(s?.sides) ? s.sides : 0;
    const [p, e] = { rect: [5, 6], roundrect: [13, 10], circle: [1, 1], slot: [7, 6], polygon: [n + 1, n + 1], polyline: [m, s?.closed === false ? m - 1 : m], line: [2, 1] }[Object.hasOwn(KEYS, s?.type) ? s.type : "line"];
    points += p; entities += e;
  }
  if (points > MAX_SKETCH || entities > MAX_SKETCH) throw new Error(`this sketch would have ${Math.max(points, entities)} ${points >= entities ? "points" : "entities"}; the most is ${MAX_SKETCH} per call — split it into several sketches`);
  const S = new Sketch(), out = [];
  shapes.forEach((s, i) => {
    const at = `shapes[${i}]`;
    if (!s || typeof s !== "object" || !Object.hasOwn(KEYS, s.type)) throw new Error(`${at}.type must be one of ${Object.keys(KEYS).join(", ")}`);
    for (const k of Object.keys(s)) if (k !== "type" && !KEYS[s.type].includes(k)) throw new Error(`${at} has an unknown key "${k}"; it takes ${KEYS[s.type].join(", ")}`);
    const size = (v, key, msg = `${at}.${key} must be a number of mm more than 0, or an expression`) => {
      if (!(isNum(v) || (typeof v === "string" && v.trim()))) throw new Error(msg);
      const n = num(v, `${at}.${key}`);
      if (!(n.v > 0)) throw new Error(msg);
      return n;
    };
    const pair = (v, key, what = "[x, y] in mm") => { if (!isPair(v)) throw new Error(`${at}.${key} must be ${what}`); return v; };
    const center = s.center === undefined ? [0, 0] : pair(s.center, "center", "[x, y] in mm (numbers; expressions are for sizes)");
    const [cx, cy] = center;
    let drawn, withCenter = true;
    if (s.type === "rect" || s.type === "roundrect") {
      const msg = `${at}.size must be [w, h] in mm, each more than 0`;
      if (!Array.isArray(s.size) || s.size.length !== 2) throw new Error(msg);
      const w = size(s.size[0], "size[0]", msg), h = size(s.size[1], "size[1]", msg), hw = w.v / 2, hh = h.v / 2;
      const P = (x, y) => S.pt(cx + x, cy + y), C = S.pt(cx, cy), line = (a, b) => S.ent({ t: "line", a, b });
      if (s.type === "rect") {
        const p = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], L = p.map((a, k) => line(a, p[(k + 1) % 4]));
        L.forEach((id, k) => S.con({ t: k % 2 ? "vertical" : "horizontal", e1: id }));
        const diag = S.ent({ t: "line", a: p[0], b: p[2], cons: true });
        S.ent({ t: "point", p: C });
        S.con({ t: "midpoint", p: C, e: diag });
        S.dim({ k: "dist", p1: p[0], p2: p[1], o: "h" }, w, [cx, cy - hh - 6]);
        S.dim({ k: "dist", p1: p[1], p2: p[2], o: "v" }, h, [cx + hw + 6, cy]);
        drawn = L;
      } else {
        const lim = Math.min(w.v, h.v) / 2;
        if (s.radius === undefined) throw new Error(`${at}.radius must be more than 0 and less than half the smaller side (${+lim.toFixed(4)} mm here)`);
        const r = size(s.radius, "radius");
        if (!(r.v < lim)) throw new Error(`${at}.radius must be more than 0 and less than half the smaller side (${+lim.toFixed(4)} mm here)`);
        const p = [P(-hw + r.v, -hh), P(hw - r.v, -hh), P(hw, -hh + r.v), P(hw, hh - r.v), P(hw - r.v, hh), P(-hw + r.v, hh), P(-hw, hh - r.v), P(-hw, -hh + r.v)];
        const c = [P(-hw + r.v, -hh + r.v), P(hw - r.v, -hh + r.v), P(hw - r.v, hh - r.v), P(-hw + r.v, hh - r.v)];
        const arc = (k, a, b) => S.ent({ t: "arc", c: c[k], a: p[a], b: p[b] });
        const L = [line(p[0], p[1]), line(p[2], p[3]), line(p[4], p[5]), line(p[6], p[7])];
        const br = arc(1, 1, 2), tr = arc(2, 3, 4), tl = arc(3, 5, 6), bl = arc(0, 7, 0);
        const diag = S.ent({ t: "line", a: c[0], b: c[2], cons: true });
        S.ent({ t: "point", p: C });
        S.con({ t: "horizontal", e1: L[0] }); S.con({ t: "vertical", e1: L[1] }); S.con({ t: "horizontal", e1: L[2] }); S.con({ t: "vertical", e1: L[3] });
        for (const [l, a] of [[0, br], [1, br], [1, tr], [2, tr], [2, tl], [3, tl], [3, bl], [0, bl]]) S.con({ t: "tangent", e1: L[l], e2: a });
        for (const a of [tr, tl, bl]) S.con({ t: "equal", e1: br, e2: a });
        S.con({ t: "midpoint", p: C, e: diag });
        const k = 0.7 * r.v + 3;
        S.dim({ k: "rad", e1: br }, r, [cx + hw - r.v + k, cy - hh + r.v + k]);
        S.dim({ k: "ll", e1: L[0], e2: L[2] }, h, [cx + hw + 6, cy]);
        S.dim({ k: "ll", e1: L[1], e2: L[3] }, w, [cx, cy - hh - 6]);
        drawn = [...L, br, tr, tl, bl];
      }
      S.place(C, cx, cy);
    } else if (s.type === "circle") {
      const d = size(s.diameter, "diameter"), C = S.pt(cx, cy), e = S.ent({ t: "circle", c: C, r: d.v / 2 }), k = 0.7 * d.v / 2 + 3;
      S.dim({ k: "dia", e1: e }, d, [cx + k, cy + k]);
      S.place(C, cx, cy);
      drawn = [e];
    } else if (s.type === "slot") {
      const width = size(s.width, "width"), length = size(s.length, "length");
      if (!(length.v > width.v)) throw new Error(`${at}.length must be more than its width`);
      const angle = s.angle ?? 0;
      if (angle !== 0 && angle !== 90) throw new Error(`${at}.angle must be 0 or 90 (for other angles use a polyline)`);
      const k = (length.v - width.v) / 2, r = width.v / 2, vertical = angle === 90;
      const P = (x, y) => (vertical ? S.pt(cx - y, cy + x) : S.pt(cx + x, cy + y));
      const A = P(-k, -r), B = P(k, -r), Cc = P(k, r), D = P(-k, r), Cr = P(k, 0), Cl = P(-k, 0), M = P(0, 0);
      const ab = S.ent({ t: "line", a: A, b: B }), right = S.ent({ t: "arc", c: Cr, a: B, b: Cc }), cd = S.ent({ t: "line", a: Cc, b: D }), left = S.ent({ t: "arc", c: Cl, a: D, b: A });
      const axis = S.ent({ t: "line", a: Cl, b: Cr, cons: true });
      S.ent({ t: "point", p: M });
      S.con({ t: vertical ? "vertical" : "horizontal", e1: ab }); S.con({ t: vertical ? "vertical" : "horizontal", e1: cd });
      for (const [l, a] of [[ab, left], [ab, right], [cd, right], [cd, left]]) S.con({ t: "tangent", e1: l, e2: a });
      S.dim({ k: "ll", e1: ab, e2: cd }, width, vertical ? [cx + length.v / 2 + 6, cy] : [cx, cy - r - 6]);
      const gap = { v: k * 2 };
      if (width.expr || length.expr) gap.expr = `(${length.expr ?? length.v})-(${width.expr ?? width.v})`;
      S.dim({ k: "dist", p1: Cl, p2: Cr, o: vertical ? "v" : "h" }, gap, vertical ? [cx - r - 6, cy] : [cx, cy + r + 6]);
      S.con({ t: "midpoint", p: M, e: axis });
      S.place(M, cx, cy);
      drawn = [ab, right, cd, left];
    } else if (s.type === "polygon") {
      const n = s.sides;
      if (!Number.isInteger(n) || n < 3 || n > 64) throw new Error(`${at}.sides must be a whole number from 3 to 64`);
      const d = size(s.diameter, "diameter"), R = d.v / 2, C = S.pt(cx, cy);
      const V = Array.from({ length: n }, (_, k) => { const t = ((-90 - 180 / n + (360 * k) / n) * Math.PI) / 180; return S.pt(cx + R * Math.cos(t), cy + R * Math.sin(t)); });
      const L = V.map((a, k) => S.ent({ t: "line", a, b: V[(k + 1) % n] }));
      const ring = S.ent({ t: "circle", c: C, r: R, cons: true });
      const k = 0.7 * R + 3;
      S.dim({ k: "dia", e1: ring }, d, [cx + k, cy + k]);
      V.forEach((p) => S.con({ t: "coincident", p, e: ring }));
      for (let j = 1; j < n; j++) S.con({ t: "equal", e1: L[0], e2: L[j] });
      S.con({ t: "horizontal", e1: L[0] });
      S.place(C, cx, cy);
      drawn = L;
    } else {
      withCenter = false;
      if (s.type === "line") {
        const a = pair(s.from, "from"), b = pair(s.to, "to");
        if (tiny(b[0] - a[0]) && tiny(b[1] - a[1])) throw new Error(`${at} has a zero-length side at point 1`);
        const ia = S.pt(...a), ib = S.pt(...b);
        drawn = [S.segment(a, b, ia, ib, s.construction === true)];
        S.place(ia, a[0], a[1]);
      } else {
        const closed = s.closed ?? true, p = s.points;
        if (typeof closed !== "boolean") throw new Error(`${at}.closed must be true or false`);
        if (!Array.isArray(p) || p.length < (closed ? 3 : 2) || p.length > 200 || !p.every(isPair)) throw new Error(`${at}.points must be 2 to 200 [x, y] points in mm (3 or more when closed)`);
        const m = p.length, segs = closed ? m : m - 1;
        for (let k = 0; k < segs; k++) {
          const a = p[k], b = p[(k + 1) % m];
          if (tiny(b[0] - a[0]) && tiny(b[1] - a[1])) throw new Error(`${at} has a zero-length side at point ${(k + 1) % m}`);
        }
        const ids = p.map((q) => S.pt(...q));
        drawn = [];
        for (let k = 0; k < segs; k++) {
          if (closed && k === m - 1) drawn.push(S.ent({ t: "line", a: ids[k], b: ids[0] }));
          else drawn.push(S.segment(p[k], p[k + 1], ids[k], ids[k + 1]));
        }
        S.place(ids[0], p[0][0], p[0][1]);
      }
    }
    out.push({ type: s.type, ents: drawn, ...(withCenter ? { center } : {}) });
  });
  return { pts: S.pts, ents: S.ents, cons: S.cons, shapes: out };
}

// The profiles an extrude uses when none are named: every region lying inside an even number of the other regions' outlines (a
// rectangle with a circle in it gives the ring; separate shapes all; a circle in a circle in a rectangle gives the ring and the disc).
export function defaultProfiles(regions) {
  return regions.filter((r) => regions.filter((o) => o !== r && pointInPoly(r.pt, o.poly)).length % 2 === 0);
}

// The region holding each [x, y] (the smallest when shapes lie inside one another), once each. sketchName is for the message.
export function pickProfiles(regions, points, sketchName) {
  const out = [];
  for (const pt of points) {
    if (!isPair(pt)) throw new Error("profiles must be a list of [x, y] points in the sketch");
    const hit = regions.filter((r) => regionContains(r, pt)).sort((a, b) => a.area - b.area)[0];
    if (!hit) throw new Error(`no closed profile at [${pt[0]}, ${pt[1]}] in ${sketchName}`);
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}
