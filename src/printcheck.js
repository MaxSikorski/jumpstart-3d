import { BED_TOUCH } from "./overhang.js";

const point = (p, i, m) => [m[0]*p[i]+m[4]*p[i+1]+m[8]*p[i+2]+m[12], m[1]*p[i]+m[5]*p[i+1]+m[9]*p[i+2]+m[13], m[2]*p[i]+m[6]*p[i+1]+m[10]*p[i+2]+m[14]];
export function worldBounds(vertices, m) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) { const p = point(vertices, i, m); for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], p[j]); max[j] = Math.max(max[j], p[j]); } }
  return { min, max };
}
export function fitsPlate(b, d) {
  if (!d) return { ok: true, why: "none" };
  const { min, max } = b, t = 0.01;
  if (max[0]-min[0] > d.w+t || max[1]-min[1] > d.d+t || (d.h != null && max[2]-min[2] > d.h+t)) return { ok: false, why: "size" };
  if (min[0] < -d.w/2-t || max[0] > d.w/2+t || min[1] < -d.d/2-t || max[1] > d.d/2+t || (d.h != null && max[2] > d.h+t)) return { ok: false, why: "edge" };
  return { ok: true, why: null };
}
export function restsOnPlate(positions, indices, m) {
  const minZ = worldBounds(positions, m).min[2]; let contactArea = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = point(positions, indices[i]*3, m), b = point(positions, indices[i+1]*3, m), c = point(positions, indices[i+2]*3, m);
    if ([a,b,c].some(p => Math.abs(p[2]) > BED_TOUCH)) continue;
    const u = b.map((v,j) => v-a[j]), v = c.map((x,j) => x-a[j]);
    const x = u[1]*v[2]-u[2]*v[1], y = u[2]*v[0]-u[0]*v[2], z = u[0]*v[1]-u[1]*v[0], len = Math.hypot(x,y,z);
    if (len && z/len < -0.99) contactArea += len/2;
  }
  return { minZ, contactArea };
}
export function verdict({ flat, fit, overhang }) {
  if (flat === "float" || flat === "below" || fit === false) return "fail";
  if (flat === "point" || overhang === true || overhang === "large") return "warn";
  return "ready";
}
