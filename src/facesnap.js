// Face snap: where a dragged shape lands on another shape's face (Tinkercad's "Cruise").
// Pure maths on plain arrays, no DOM and no three.js, so Node tests can import it (like placebeside.js).
const r2 = (v) => Math.round(v * 100) / 100;
const rStep = (v, s) => (s > 0 ? Math.round(v / s) * s : v);

// "top" = flat face looking up (the shape sits on it), "under" = looks down (ignored), "side" = anything else
export function faceKind(n) { return n[2] > 0.999 ? "top" : n[2] < -0.01 ? "under" : "side"; }

// how far to lift the shape so its lowest point rests on the hit height
export function topLanding(hitZ, box0MinZ) { return r2(hitZ - box0MinZ); }

// Matrix (three.js Matrix4.elements order) that stands box0's bottom centre on the hit point with the shape's +Z along the face normal
export function sideLanding(n, point, box0, step) {
  const c0 = [(box0.min[0] + box0.max[0]) / 2, (box0.min[1] + box0.max[1]) / 2, box0.min[2]];
  const P = point.map((v, i) => (Math.abs(n[i]) < 1e-6 ? rStep(v, step) : v));
  // shortest turn of +Z onto n: R = I + K + K*K/(1+nz), K = cross matrix of (-ny, nx, 0)
  const k = 1 / (1 + n[2]), vx = -n[1], vy = n[0];
  const R = [
    1 - vy * vy * k, vx * vy * k, vy,
    vx * vy * k, 1 - vx * vx * k, -vx,
    -vy, vx, 1 - (vx * vx + vy * vy) * k,
  ]; // rows
  const t = [0, 1, 2].map((i) => r2(P[i] - (R[i * 3] * c0[0] + R[i * 3 + 1] * c0[1] + R[i * 3 + 2] * c0[2])));
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
}
