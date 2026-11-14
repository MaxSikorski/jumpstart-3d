import { BED_TOUCH } from "./overhang.js";

// Resumable world-space bounds and bed contact, with no per-vertex allocations.
export function startPlateJob(positions, indices, m) {
  let i = 0, minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, contactArea = 0;
  const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    step(ms = 8) {
      const deadline = now() + ms;
      while (i < indices.length) {
        const stop = Math.min(indices.length, i + 3072);
        for (; i + 2 < stop; i += 3) {
          const a = indices[i] * 3, b = indices[i+1] * 3, c = indices[i+2] * 3;
          const ax = m[0]*positions[a]+m[4]*positions[a+1]+m[8]*positions[a+2]+m[12], ay = m[1]*positions[a]+m[5]*positions[a+1]+m[9]*positions[a+2]+m[13], az = m[2]*positions[a]+m[6]*positions[a+1]+m[10]*positions[a+2]+m[14];
          const bx = m[0]*positions[b]+m[4]*positions[b+1]+m[8]*positions[b+2]+m[12], by = m[1]*positions[b]+m[5]*positions[b+1]+m[9]*positions[b+2]+m[13], bz = m[2]*positions[b]+m[6]*positions[b+1]+m[10]*positions[b+2]+m[14];
          const cx = m[0]*positions[c]+m[4]*positions[c+1]+m[8]*positions[c+2]+m[12], cy = m[1]*positions[c]+m[5]*positions[c+1]+m[9]*positions[c+2]+m[13], cz = m[2]*positions[c]+m[6]*positions[c+1]+m[10]*positions[c+2]+m[14];
          minX = Math.min(minX,ax,bx,cx); minY = Math.min(minY,ay,by,cy); minZ = Math.min(minZ,az,bz,cz);
          maxX = Math.max(maxX,ax,bx,cx); maxY = Math.max(maxY,ay,by,cy); maxZ = Math.max(maxZ,az,bz,cz);
          if (Math.abs(az) > BED_TOUCH || Math.abs(bz) > BED_TOUCH || Math.abs(cz) > BED_TOUCH) continue;
          const ux = bx-ax, uy = by-ay, uz = bz-az, vx = cx-ax, vy = cy-ay, vz = cz-az;
          const x = uy*vz-uz*vy, y = uz*vx-ux*vz, z = ux*vy-uy*vx, len = Math.hypot(x,y,z);
          if (len && z/len < -0.99) contactArea += len/2;
        }
        if (i < indices.length && now() >= deadline) return false;
      }
      return true;
    },
    result() { return { bounds: { min: [minX,minY,minZ], max: [maxX,maxY,maxZ] }, minZ, contactArea }; }
  };
}
export function curvedBottom(positions, indices, m, minZ, maxZ) {
  const limit = minZ + Math.max(0.5, 0.05 * (maxZ - minZ)), normals = new Set();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const points = [];
    for (let j = 0; j < 3; j++) {
      const k = indices[i+j] * 3, x = positions[k], y = positions[k+1], z = positions[k+2];
      points.push([m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]);
    }
    const [a, b, c] = points;
    if (a[2] > limit || b[2] > limit || c[2] > limit) continue;
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, len = Math.hypot(nx, ny, nz);
    if (!len || nz/len >= -0.05) continue;
    normals.add([nx, ny, nz].map(n => Math.round(n/len*20)).join(','));
    if (normals.size > 4) return true;
  }
  return false;
}
export function worldBounds(vertices, m) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = m[0]*vertices[i]+m[4]*vertices[i+1]+m[8]*vertices[i+2]+m[12], y = m[1]*vertices[i]+m[5]*vertices[i+1]+m[9]*vertices[i+2]+m[13], z = m[2]*vertices[i]+m[6]*vertices[i+1]+m[10]*vertices[i+2]+m[14];
    minX = Math.min(minX,x); minY = Math.min(minY,y); minZ = Math.min(minZ,z); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y); maxZ = Math.max(maxZ,z);
  }
  return { min: [minX,minY,minZ], max: [maxX,maxY,maxZ] };
}
export function fitsPlate(b, d) {
  if (!d) return { ok: true, why: "none" };
  const { min, max } = b, t = 0.01;
  if (max[0]-min[0] > d.w+t || max[1]-min[1] > d.d+t || (d.h != null && max[2]-min[2] > d.h+t)) return { ok: false, why: "size" };
  if (min[0] < -d.w/2-t || max[0] > d.w/2+t || min[1] < -d.d/2-t || max[1] > d.d/2+t || (d.h != null && max[2] > d.h+t)) return { ok: false, why: "edge" };
  return { ok: true, why: null };
}
export function restsOnPlate(positions, indices, m) {
  const job = startPlateJob(positions, indices, m);
  while (!job.step(1e9));
  const { minZ, contactArea } = job.result();
  return { minZ, contactArea };
}
export function flatness(minZ, contactArea) {
  if (minZ > BED_TOUCH) return { type: "float", value: minZ };
  if (minZ < -BED_TOUCH) return { type: "below", value: -minZ };
  return contactArea < 1 ? { type: "point" } : null;
}
export function verdict({ flat, fit, overhang }) {
  if (flat === "float" || flat === "below" || fit === false) return "fail";
  if (flat === "point" || overhang === true || overhang === "large") return "warn";
  return "ready";
}
