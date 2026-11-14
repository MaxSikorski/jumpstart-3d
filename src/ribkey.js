// Ribs and keyhole slots: the shapes, built from plain primitives in a frame on a flat face.
// A frame is: origin p on the face, Z = the face's outward normal, Y = along the feature (the rib's
// length, or the keyhole slot's direction), X = Y × Z. Everything here is in body coordinates.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const T = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r6(x), r6(y), r6(z), 1];
const prim = (kind, p) => ({ t: "prim", kind, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])), mods: [] });
const kid = (node, m = T()) => ({ node, m, hole: false });
const group = (children) => ({ t: "group", children, mods: [] });
const line = (pts) => pts.map((a, i) => ({ t: "line", a: a.map(r6), b: pts[(i + 1) % pts.length].map(r6) }));
const PLANE_XZ = { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] };
const extr = (outer, plane, len) => ({ t: "extrude", regions: [{ outer }], plane, dist: r6(len), mode: "one", mods: [] });

const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
};
export { V as Vec3 };

// a frame matrix (column-major, three.js order): local X, Y, Z axes and the origin
export function frame(p, y, n) {
  const Z = V.norm(n), Y = V.norm(V.sub(y, V.scale(Z, V.dot(y, Z)))), X = V.cross(Y, Z);
  return [...X, 0, ...Y, 0, ...Z, 0, ...p.map(r6), 1].map((v, i) => (i % 4 === 3 ? v : r6(v)));
}
const mul = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o.map(r6); };

// "up" on a face: the given up direction (body coordinates) laid onto the face; when the face
// faces up or down, the body's +Y instead. Then turned by ang degrees about the normal.
export function faceUp(n, up = [0, 0, 1], ang = 0) {
  const Z = V.norm(n);
  let u = V.sub(up, V.scale(Z, V.dot(up, Z)));
  if (V.len(u) < 0.2) { u = V.sub([0, 1, 0], V.scale(Z, Z[1])); if (V.len(u) < 0.2) u = V.sub([1, 0, 0], V.scale(Z, Z[0])); }
  u = V.norm(u);
  const a = (ang * Math.PI) / 180, X = V.cross(u, Z);
  return V.norm(V.add(V.scale(u, Math.cos(a)), V.scale(X, -Math.sin(a))));
}

// ------------------------------------------------------------------ keyhole slots
// The screw head goes in the round hole, then the part slides so the screw runs along the slot:
// the narrow slot (screw shank) goes through a lip of depth "lip", and under the lip a wider channel
// (screw head) runs the same length, so the head is trapped behind the lip. The slot runs along +Y
// from the head hole; hang the part with the slot pointing up.
export const KEYHOLE_SIZES = {
  small: { name: "Small (M3 / #6)", head: 7, shank: 3.6, length: 10, lip: 2, depth: 3 },
  medium: { name: "Medium (M4 / #8)", head: 9.5, shank: 4.6, length: 12, lip: 2.5, depth: 3.5 },
  large: { name: "Large (M5 / #10)", head: 11.5, shank: 5.6, length: 14, lip: 3, depth: 4 },
};
export const KEYHOLE_DEFAULTS = { size: "medium", ...KEYHOLE_SIZES.medium, ang: 0 };
export function keyholeLocal(o) {
  const H = o.head, S = Math.min(o.shank, H - 0.5), L = o.length, d1 = o.lip, d2 = o.depth, up = 0.5;
  return group([
    kid(prim("cylinder", { w: H, d: H, h: d1 + d2 + up }), T(0, 0, -(d1 + d2))),         // the head hole
    kid(prim("box", { w: S, d: L, h: d1 + up }), T(0, L / 2, -d1)),                    // the slot through the lip
    kid(prim("cylinder", { w: S, d: S, h: d1 + up }), T(0, L, -d1)),                    // its round end
    kid(prim("box", { w: H, d: L, h: d2 }), T(0, L / 2, -(d1 + d2))),                  // the channel under the lip
    kid(prim("cylinder", { w: H, d: H, h: d2 }), T(0, L, -(d1 + d2))),                  // its round end
  ]);
}
// the cutting tool for every keyhole (each spot: p, n, dir), in body coordinates
export function keyholeTool(o, spots) {
  const one = keyholeLocal(o);
  return group(spots.map((s) => kid(one, frame(s.p, s.dir, s.n))));
}

// ------------------------------------------------------------------ ribs
// A rib stands on a flat face from a start point to an end point: Straight (a wall of even height)
// or Gusset (a triangle, full height at the start, down to nothing at the end: start it against a
// wall to brace a corner). "count" ribs side by side, "spacing" apart, centred on the drawn line.
// They sink 0.3 into the face so they always fuse with it.
export const RIB_DEFAULTS = { shape: "straight", height: 10, thick: 2, count: 1, spacing: 10, flip: false };
const SINK = 0.3;
export function ribLocal(o, L) {
  const t = o.thick, H = o.height;
  if (o.shape === "gusset") {
    // triangle in the XZ plane (x along the rib), extruded across its thickness
    const pts = o.flip ? [[0, -SINK], [L, -SINK], [L, H], [0, 0]] : [[0, -SINK], [L, -SINK], [L, 0], [0, H]];
    return group([kid(extr(line(pts), PLANE_XZ, t), T(0, t / 2, 0))]);
  }
  return group([kid(prim("box", { w: L, d: t, h: H + SINK }), T(L / 2, 0, -SINK))]);
}
// the tool for a rib set from a to b on a face with normal n (body coordinates)
export function ribTool(o, a, b, n) {
  const d = V.sub(b, a), Z = V.norm(n), along = V.sub(d, V.scale(Z, V.dot(d, Z))), L = V.len(along);
  if (L < 0.5) throw new Error("The rib is too short: click its start and end farther apart");
  // local X along the rib: frame(p, y, n) makes Y = y, so build it with y = the sideways direction
  const X = V.norm(along), Y = V.cross(Z, X);
  const M = [...X, 0, ...Y, 0, ...Z, 0, ...a, 1].map(r6);
  const one = ribLocal(o, L), kids = [];
  const n0 = Math.max(1, Math.round(o.count || 1));
  for (let i = 0; i < n0; i++) kids.push(kid(one, mul(M, T(0, (i - (n0 - 1) / 2) * o.spacing, 0))));
  return { tool: group(kids), length: L };
}
