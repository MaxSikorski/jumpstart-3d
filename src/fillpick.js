// jumpstart-3d: fill openings. The plain-number helpers behind the Fill openings panel (src/fillopenings.js): which opening is under a
// point, and which "keep open" entry belongs to which opening. No DOM and no three.js, so Node tests import this file directly
// (fillopenings.js re-exports openingAt). Everything is in body coordinates, in mm.

// A report opening is { c: [x, y, z], a, depth, loops: [[[x, y, z], ...], ...], state, why? } (src/fillopen.js).
const KEEP_RADIUS = 0.5; // the same rule the geometry uses to match a kept opening: nearest centre within 0.5 mm, ties by area

// two axes at right angles to n, to flatten 3D points onto the face's plane
function basis(n) {
  const len = Math.hypot(n[0], n[1], n[2]) || 1, z = [n[0] / len, n[1] / len, n[2] / len];
  const a = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [a[1] * z[2] - a[2] * z[1], a[2] * z[0] - a[0] * z[2], a[0] * z[1] - a[1] * z[0]];
  const ul = Math.hypot(...u);
  u = u.map((q) => q / ul);
  const v = [z[1] * u[2] - z[2] * u[1], z[2] * u[0] - z[0] * u[2], z[0] * u[1] - z[1] * u[0]];
  return { u, v };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// is (px, py) inside this loop? Parity of the crossings of a ray running along +x.
function inLoop(loop, px, py) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Which opening of the report is the point inside, as a position in report.openings, or -1. The point is flattened onto the face
// (n = its normal) and tested against each opening's outlines one by one. An outline inside another one (the island of an "O") is
// part of the same opening: the whole opening is filled, island included, so a click on the island counts as the opening.
export function openingAt(report, point, n) {
  if (!report || !Array.isArray(report.openings) || !point || !n) return -1;
  const { u, v } = basis(n), px = dot(point, u), py = dot(point, v);
  let best = -1, bestArea = Infinity;
  report.openings.forEach((o, i) => {
    const hit = (o.loops || []).some((l) => l.length > 2 && inLoop(l.map((p) => [dot(p, u), dot(p, v)]), px, py));
    if (hit && (o.a ?? 0) < bestArea) { best = i; bestArea = o.a ?? 0; }
  });
  return best;
}

// the keep entry (index in `keep`) that stands for this opening, or -1
export function keepIndex(keep, opening) {
  let best = -1, dist = Infinity, area = Infinity;
  (keep || []).forEach((k, i) => {
    const d = Math.hypot(k.c[0] - opening.c[0], k.c[1] - opening.c[1], k.c[2] - opening.c[2]), a = Math.abs(k.a - opening.a);
    if (d <= KEEP_RADIUS && (d < dist - 1e-9 || (Math.abs(d - dist) <= 1e-9 && a < area))) { best = i; dist = d; area = a; }
  });
  return best;
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
// the keep entry for an opening, rounded to 1e-4 as the mod stores it
export const keepEntry = (o) => ({ c: o.c.map(r4), a: r4(o.a) });

// The kernel stores a body's reports under each Fill openings feature's id, but the page keeps a finished build for as long as the
// feature's contents are the same, whatever its id (open the panel twice on the same face and the second build is the first one's).
// So: the report under the feature's own id, else the one in the same position among the body's Fill openings features. The position
// is only trusted when the counts agree and no id looks like a number (an object lists those first, whatever order they were added in).
export function fillReportFor(mesh, node, modId) {
  const all = mesh && mesh.fillReports;
  if (!all) return null;
  if (Object.prototype.hasOwnProperty.call(all, modId)) return all[modId];
  const ids = Object.keys(all), mods = ((node && node.mods) || []).filter((m) => m.t === "fillopen");
  const i = mods.findIndex((m) => m.id === modId);
  if (i < 0 || ids.length !== mods.length || ids.some((k) => String(k >>> 0) === k)) return null;
  return all[ids[i]];
}
