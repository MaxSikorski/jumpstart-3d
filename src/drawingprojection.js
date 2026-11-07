export const DRAWING_VIEWS = ["top", "front", "right"];
// Exact hidden-line removal grows fast with the face count; above this a drawing is refused before it starts.
export const FACE_LIMIT = 1500;
export function countFaces(OC, shape) {
  const ex = new OC.TopExp_Explorer(shape.wrapped, OC.TopAbs_ShapeEnum.TopAbs_FACE, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0;
  try { for (; ex.More(); ex.Next()) n++; } finally { ex.delete(); }
  return n;
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function cleanCurves(curves, tol) {
  if (tol == null) {
    const pts = curves.flatMap(c => c.t === "line" ? [c.a, c.b] : c.t === "poly" ? c.pts : [c.c]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const size = pts.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
    tol = 1e-6 * size + 1e-6;
  }
  const out = [];
  for (const c of curves) {
    if (c.t === "line") {
      if (distance(c.a, c.b) <= tol) continue;
      let a = [...c.a], b = [...c.b];
      for (let i = 0; i < out.length;) {
        const d = out[i];
        if (d.t !== "line") { i++; continue; }
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
        const along = p => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
        const off = p => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
        const x = along(d.a), y = along(d.b);
        if (off(d.a) <= tol && off(d.b) <= tol && Math.max(x, y) >= -tol && Math.min(x, y) <= len + tol) {
          const lo = Math.min(0, x, y), hi = Math.max(len, x, y), origin = a;
          a = [origin[0] + lo * ux, origin[1] + lo * uy]; b = [origin[0] + hi * ux, origin[1] + hi * uy];
          out.splice(i, 1); i = 0;
        } else i++;
      }
      out.push({ t: "line", a, b });
    } else if (c.t === "circle" || c.t === "arc") {
      if (c.r <= tol) continue;
      if (!out.some(d => d.t === c.t && distance(c.c, d.c) <= tol && Math.abs(c.r - d.r) <= tol && (c.t === "circle" || (angleDiff(c.a0, d.a0) * c.r <= tol && angleDiff(c.a1, d.a1) * c.r <= tol)))) out.push(c);
    } else out.push(c);
  }
  return out;
}

function readEdge(OC, edge) {
  OC.BRepLib.BuildCurves3d(edge.wrapped);
  const curve = new OC.BRepAdaptor_Curve(edge.wrapped);
  try {
    const first = curve.FirstParameter(), last = curve.LastParameter();
    const point = u => { const p = curve.Value(u); try { return [p.X(), p.Y()]; } finally { p.delete(); } };
    const type = curve.GetType();
    if (type === OC.GeomAbs_CurveType.GeomAbs_Line) return { t: "line", a: point(first), b: point(last) };
    if (type === OC.GeomAbs_CurveType.GeomAbs_Circle) {
      const circle = curve.Circle();
      try {
        const loc = circle.Location(), axis = circle.Axis();
        try {
          const dir = axis.Direction();
          try {
            const c = [loc.X(), loc.Y()], r = circle.Radius();
            if (Math.abs(last - first) >= 2 * Math.PI - 1e-7) return { t: "circle", c, r };
            const a = point(first), b = point(last);
            let a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
            if (dir.Z() < 0) [a0, a1] = [a1, a0];
            return { t: "arc", c, r, a0, a1 };
          } finally { dir.delete(); }
        } finally { loc.delete(); axis.delete(); }
      } finally { circle.delete(); }
    }
    // Subdivide until every chord is within 0.01 mm (depth 16 bounds the work on one edge).
    const start = point(first), end = point(last), pts = [start];
    const subdivide = (u0, p0, u1, p1, depth) => {
      const du = u1 - u0, samples = [0.25, 0.5, 0.75].map(t => point(u0 + du * t));
      const deviation = (p, t) => distance(p, [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
      if (depth < 16 && samples.some((p, i) => deviation(p, (i + 1) / 4) > 0.01)) {
        subdivide(u0, p0, u0 + du / 2, samples[1], depth + 1);
        subdivide(u0 + du / 2, samples[1], u1, p1, depth + 1);
      } else pts.push(p1);
    };
    subdivide(first, start, last, end, 0);
    const dx = end[0] - start[0], dy = end[1] - start[1], len = Math.hypot(dx, dy);
    if (len > 1e-9 && pts.every(p => Math.abs((p[0] - start[0]) * dy - (p[1] - start[1]) * dx) / len < 1e-7 && (p[0] - start[0]) * dx + (p[1] - start[1]) * dy >= -1e-7 && (p[0] - end[0]) * dx + (p[1] - end[1]) * dy <= 1e-7)) return { t: "line", a: start, b: end };
    const closed = distance(start, end) < 1e-7;
    if (closed) pts.pop();
    return { t: "poly", pts, closed };
  } finally { curve.delete(); }
}

// Raw curves per view; the page runs cleanCurves (it is quadratic and need not hold up the engine).
export function projectViews(OC, R, shape, views, onView) {
  const axes = { top: [[0, 0, 1], [1, 0, 0]], front: [[0, -1, 0], [1, 0, 0]], right: [[1, 0, 0], [0, 1, 0]] };
  const result = {};
  for (const [i, view] of views.entries()) {
    if (onView) onView(view, i, views.length);
    if (!axes[view]) throw new Error(`Unknown drawing view: ${view}`);
    const [normal, right] = axes[view], owned = [];
    const own = x => (owned.push(x), x);
    try {
      const origin = own(new OC.gp_Pnt(0, 0, 0)), n = own(new OC.gp_Dir(...normal)), x = own(new OC.gp_Dir(...right));
      const frame = own(new OC.gp_Ax2(origin, n, x)), projector = own(new OC.HLRAlgo_Projector(frame));
      const hlr = own(new OC.HLRBRep_Algo());
      hlr.Add(shape.wrapped, 0); hlr.Projector(projector); hlr.Update(); hlr.Hide();
      const extraction = own(new OC.HLRBRep_HLRToShape(hlr)), curves = [];
      for (const get of ["VCompound", "OutLineVCompound"]) {
        const compound = extraction[get]();
        if (compound.IsNull()) { compound.delete(); continue; }
        const wrapped = R.cast(compound);
        try { const edges = wrapped.edges; try { for (const edge of edges) curves.push(readEdge(OC, edge)); } finally { edges.forEach(e => e.delete()); } } finally { wrapped.delete(); compound.delete(); }
      }
      result[view] = curves;
    } finally { owned.reverse().forEach(o => o.delete()); }
  }
  return result;
}
