// Face patterns (Pattern on face tool): the 2D shapes of each pattern, shared by the geometry
// engine (which raises or cuts them) and the tool's little previews.
export const FACEPAT = {
  hex: { name: "Hexagons", gap: "Gap", size: 8, g: 1.2 },
  diamond: { name: "Diamond plate", gap: "Bar width", size: 8, g: 2 },
  mesh: { name: "Screen mesh", gap: "Wire width", size: 4, g: 1 },
  circles: { name: "Circles", gap: "Gap", size: 6, g: 1.5 },
  triangles: { name: "Triangles", gap: "Gap", size: 8, g: 1.2 },
  knurl: { name: "Knurl", gap: "Gap", size: 3, g: 0.4 },
  slots: { name: "Ribs", gap: "Gap", size: 4, g: 2 },
};
// the shapes of a pattern (2D polygons, or circles {c, r}) covering a box
export function facePatCells(m, box, accept = () => true) {
  const s = Math.max(0.5, +m.size || 6), kind = m.kind || "hex";
  // the space between shapes never reaches 0, so neighbors never touch (diamond plate: the bar width)
  const g = Math.max(kind === "diamond" ? 0 : 0.1, Math.min(s * 0.9, +m.gap || 0));
  const [x0, y0, x1, y1] = box;
  const out = [];
  // jumpstart-3d: bound retained cells after the kernel's face/border filter.
  const tooMany = (n) => { throw new Error(`Pattern: that would be ${n} shapes. Make the pattern size bigger (or pick a smaller face).`); };
  const room = () => { if (out.length >= 2500) tooMany(out.length + 1); };
  const add = (cell) => { if (accept(cell)) { room(); out.push(cell); } };
  // jumpstart-3d: reject only grid indices whose next increment cannot advance.
  const next = (v) => { const n = v + 1; if (n === v) throw new Error("Pattern: the grid coordinates are too large."); return n; };
  const poly = (cx, cy, pts) => add({ c: [cx, cy], pts: pts.map(([x, y]) => [cx + x, cy + y]) });
  const rotP = (pts, a) => { const c = Math.cos(a), sn = Math.sin(a); return pts.map(([x, y]) => [x * c - y * sn, x * sn + y * c]); };
  if (kind === "hex") {
    const R0 = (s - g) / Math.sqrt(3), dy = (s * Math.sqrt(3)) / 2, hex = [];
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; hex.push([R0 * Math.cos(a), R0 * Math.sin(a)]); }
    const j0 = Math.floor(y0 / dy) - 1, j1 = Math.ceil(y1 / dy) + 1;
    for (let j = j0; j <= j1; j = next(j)) { const off = (j & 1) * s / 2; for (let i = Math.floor((x0 - off) / s) - 1; i <= Math.ceil((x1 - off) / s) + 1; i = next(i)) poly(i * s + off, j * dy, hex); }
  } else if (kind === "diamond") {
    // tread plate: pointed lugs at right angles to each other in a checkerboard, the whole grid
    // turned 45°, so the end of each lug points at the middle of its neighbors
    const W = Math.max(0.3, Math.min(s * 0.35, g > 0 ? g : s * 0.24)), L = s * 1.5 - W;
    const bar = [[-L / 2, 0], [-L / 2 + W / 2, W / 2], [L / 2 - W / 2, W / 2], [L / 2, 0], [L / 2 - W / 2, -W / 2], [-L / 2 + W / 2, -W / 2]];
    const H = bar, V = rotP(bar, Math.PI / 2), c45 = Math.SQRT1_2;
    const Rr = Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1))) + s * 2, n = Math.ceil(Rr / s);
    // jumpstart-3d: clip before looping, padding for roundoff; distant faces must not scan from the origin.
    const pitch = s * c45;
    const j0 = Math.max(-n, Math.ceil((y0 - x1 - 2 * s) / (2 * pitch)) - 1);
    const j1 = Math.min(n, Math.floor((y1 - x0 + 2 * s) / (2 * pitch)) + 1);
    for (let j = j0; j <= j1; j = next(j)) {
      const i0 = Math.max(-n, Math.ceil(Math.max(j + (x0 - s) / pitch, -j + (y0 - s) / pitch)) - 1);
      const i1 = Math.min(n, Math.floor(Math.min(j + (x1 + s) / pitch, -j + (y1 + s) / pitch)) + 1);
      for (let i = i0; i <= i1; i = next(i)) {
        const u = i * s, v = j * s, cx = (u - v) * c45, cy = (u + v) * c45;
        if (cx < x0 - s || cx > x1 + s || cy < y0 - s || cy > y1 + s) continue;
        poly(cx, cy, rotP((i + j) & 1 ? V : H, Math.PI / 4));
      }
    }
  } else if (kind === "mesh") {
    const h = (s - g) / 2, sq = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let j = Math.floor(y0 / s) - 1; j <= Math.ceil(y1 / s) + 1; j = next(j)) for (let i = Math.floor(x0 / s) - 1; i <= Math.ceil(x1 / s) + 1; i = next(i)) poly((i + 0.5) * s, (j + 0.5) * s, sq);
  } else if (kind === "knurl") {
    // diamonds (squares turned 45°) on a diagonal grid
    const h = Math.max(0.2, (s / Math.SQRT2 - g) / 2 * Math.SQRT2), d = [[0, -h], [h, 0], [0, h], [-h, 0]];
    for (let j = Math.floor(y0 / s) - 1; j <= Math.ceil(y1 / s) + 1; j = next(j)) for (let i = Math.floor(x0 / s) - 1; i <= Math.ceil(x1 / s) + 1; i = next(i)) { poly(i * s, j * s, d); poly((i + 0.5) * s, (j + 0.5) * s, d); }
  } else if (kind === "circles") {
    const r = Math.max(0.15, (s - g) / 2), dy = (s * Math.sqrt(3)) / 2;
    for (let j = Math.floor(y0 / dy) - 1; j <= Math.ceil(y1 / dy) + 1; j = next(j)) { const off = (j & 1) * s / 2; for (let i = Math.floor((x0 - off) / s) - 1; i <= Math.ceil((x1 - off) / s) + 1; i = next(i)) { const cx = i * s + off, cy = j * dy; const pts = []; for (let k = 0; k < 16; k++) pts.push([cx + r * Math.cos((k * Math.PI) / 8), cy + r * Math.sin((k * Math.PI) / 8)]); add({ c: [cx, cy], r, pts }); } }
  } else if (kind === "triangles") {
    const hgt = (s * Math.sqrt(3)) / 2, rin = s / (2 * Math.sqrt(3)), k = Math.max(0.05, (rin - g / 2) / rin);
    const up = [[-s / 2, -hgt / 3], [s / 2, -hgt / 3], [0, (2 * hgt) / 3]].map(([x, y]) => [x * k, y * k]);
    const dn = up.map(([x, y]) => [x, -y]);
    for (let j = Math.floor(y0 / hgt) - 1; j <= Math.ceil(y1 / hgt) + 1; j = next(j)) for (let i = Math.floor(x0 / s) - 1; i <= Math.ceil(x1 / s) + 1; i = next(i)) {
      const ox = (j & 1) * s / 2, by = j * hgt;
      poly(i * s + ox, by + hgt / 3, up);
      poly(i * s + ox + s / 2, by + (2 * hgt) / 3, dn);
    }
  } else if (kind === "slots") {
    // long straight ribs (or grooves) across the face
    const w = Math.max(0.2, s - g);
    for (let j = Math.floor(y0 / s) - 1; j <= Math.ceil(y1 / s) + 1; j = next(j)) { const cy = (j + 0.5) * s; add({ c: [(x0 + x1) / 2, cy], strip: true, pts: [[x0 - s, cy - w / 2], [x1 + s, cy - w / 2], [x1 + s, cy + w / 2], [x0 - s, cy + w / 2]] }); }
  }
  return out;
}
