// Architect: stairs, railings and porches, as lists of simple parts (boxes and cylinders) in mm.
// Every part is { t: "box" | "cyl", x, y, z, w, d, h, rz, ry, col }: (x, y, z) is the middle of
// its bottom face, w along its own x, d along its own y, h up; it is turned by ry (about its own
// y, tilting it) and then by rz (about z). The same parts become meshes in Architect and
// shapes (boxes and cylinders) in Beginner and Advanced.

export const STAIR_KINDS = [
  { id: "straight", name: "Straight stairs", w: 914, note: "One straight flight up to the floor above" },
  { id: "L", name: "L-shaped (landing)", w: 914, note: "Two flights with a square landing, turning left or right" },
  { id: "U", name: "U-shaped (switchback)", w: 914, note: "Up, a landing across both flights, and back the other way" },
  { id: "spiral", name: "Spiral stairs", w: 1524, note: "Wedge treads round a centre pole: fits a small square" },
  { id: "wide", name: "Grand straight stairs", w: 1524, note: "A wide straight flight" },
  { id: "steps", name: "Outdoor steps", w: 1219, note: "A few steps up to a porch, deck or front door (no floor above needed)" },
];
export const RAIL_STYLES = [
  { id: "wood", name: "Wood balusters", col: "#f2efe8", infill: "#f2efe8" },
  { id: "metal", name: "Black metal balusters", col: "#2a2a2c", infill: "#2a2a2c" },
  { id: "glass", name: "Glass panels", col: "#c9ccd0", infill: "#bfe3f5" },
  { id: "cable", name: "Cable rail", col: "#5b4636", infill: "#9aa0a6" },
  { id: "bars", name: "Horizontal bars (modern)", col: "#3a3d42", infill: "#3a3d42" },
  { id: "colonial", name: "Colonial turned spindles", col: "#ffffff", infill: "#ffffff" },
  { id: "iron", name: "Wrought iron with scrolls", col: "#1d1d1f", infill: "#1d1d1f" },
  { id: "pipe", name: "Pipe handrail only", col: "#8d9298", infill: "#8d9298" },
];
export const POST_STYLES = [
  { id: "square", name: "Square wood posts", w: 140, col: "#f4f1ea" },
  { id: "round", name: "Round columns", w: 220, col: "#ffffff" },
  { id: "craftsman", name: "Craftsman (tapered on a pier)", w: 260, col: "#efe9dd" },
  { id: "metal", name: "Slim metal posts", w: 90, col: "#2a2a2c" },
  { id: "log", name: "Rustic log posts", w: 230, col: "#8a6038" },
];
export const PORCH_ROOFS = [
  { id: "shed", name: "Shed (slopes away from the house)" },
  { id: "gable", name: "Gable (peak at the front)" },
  { id: "hip", name: "Hip" },
  { id: "flat", name: "Flat" },
  { id: "none", name: "No roof (a deck)" },
];
export const STAIR_COL = "#b08a5e", DECK_COL = "#9a7350";
const RISER = 190, TREAD = 254;

const box = (x, y, z, w, d, h, col, rz = 0, ry = 0) => ({ t: "box", x, y, z, w, d, h, rz, ry, col });
const cyl = (x, y, z, dia, h, col, rz = 0, ry = 0) => ({ t: "cyl", x, y, z, w: dia, d: dia, h, rz, ry, col });
// local (u across, v along the climb) to plan, for a stair at (x, y) turned by r
const toPlan = (s) => { const c = Math.cos(s.r || 0), n = Math.sin(s.r || 0); return (u, v) => [s.x + u * c - v * n, s.y + u * n + v * c]; };
function place(s, list) {
  const P = toPlan(s);
  return list.map((q) => { const [x, y] = P(q.x, q.y); return { ...q, x, y, rz: (q.rz || 0) + (s.r || 0) }; });
}

// ------------------------------------------------------------------ railings
// a railing from a to b ([x, y, z] in mm, z where it stands), h tall, in a style
export function railParts(a, b, h, style, opt = {}) {
  const S = RAIL_STYLES.find((q) => q.id === style) || RAIL_STYLES[0];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy);
  if (L < 50) return [];
  const rz = Math.atan2(dy, dx), pitch = Math.atan2(dz, L), Ls = Math.hypot(L, dz), out = [];
  const at = (t) => [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
  const post = S.id === "metal" || S.id === "iron" || S.id === "pipe" ? 50 : 90;
  // posts at the ends and no more than 1.8 m apart
  const nP = Math.max(1, Math.ceil(L / 1800));
  if (opt.posts !== false) for (let i = 0; i <= nP; i++) { if ((i === 0 && opt.noStart) || (i === nP && opt.noEnd)) continue; const [x, y, z] = at(i / nP); out.push(box(x, y, z, post, post, h + 60, S.col, rz)); }
  // the top rail (and a bottom rail), following the slope
  const rail = (z0, th, w, col) => { const [x, y, z] = at(0.5); out.push(box(x, y, z + z0 - th / 2, Ls + post, w, th, col, rz, -pitch)); };
  if (S.id === "pipe") { const [x, y, z] = at(0.5); out.push(box(x, y, z + h - 25, Ls + post, 50, 50, S.col, rz, -pitch)); return out; }
  rail(h, S.id === "colonial" ? 70 : 50, S.id === "colonial" ? 110 : S.id === "metal" || S.id === "iron" ? 50 : 90, S.col);
  rail(90, 40, 60, S.col);
  const inner = h - 90 - 45, z0 = 90 + 20;
  if (S.id === "glass") {
    for (let i = 0; i < nP; i++) { const [x, y, z] = at((i + 0.5) / nP); out.push(box(x, y, z + z0, Ls / nP - post - 30, 12, inner - 40, S.infill, rz, -pitch)); }
  } else if (S.id === "cable" || S.id === "bars") {
    const n = S.id === "cable" ? Math.max(3, Math.floor(inner / 80)) : 4;
    for (let k = 1; k <= n; k++) { const [x, y, z] = at(0.5); out.push(box(x, y, z + z0 + (inner * k) / (n + 1), Ls, S.id === "cable" ? 8 : 25, S.id === "cable" ? 8 : 40, S.infill, rz, -pitch)); }
  } else {
    // balusters, standing up, about 4" apart
    const gap = S.id === "colonial" ? 125 : 115, n = Math.max(1, Math.floor(L / gap));
    for (let i = 1; i < n; i++) {
      const t = i / n, [x, y, z] = at(t);
      if (S.id === "colonial" || S.id === "metal") out.push(cyl(x, y, z + z0 - 5, S.id === "colonial" ? 45 : 18, inner + 10, S.infill));
      else out.push(box(x, y, z + z0 - 5, S.id === "iron" ? 18 : 38, S.id === "iron" ? 18 : 38, inner + 10, S.infill, rz));
    }
    if (S.id === "iron") { const [x, y, z] = at(0.5); out.push(box(x, y, z + z0 + inner * 0.5, Ls, 14, 14, S.infill, rz, -pitch)); for (let i = 0; i < n; i += 4) { const [x2, y2, z2] = at((i + 0.5) / n); out.push(cyl(x2, y2, z2 + z0 + inner * 0.25, 70, 14, S.infill, rz, Math.PI / 2)); } }
  }
  return out;
}

// ------------------------------------------------------------------ stairs
// s: { x, y, r, kind, w, flip, rail } on a level; rise: how high it climbs. The bottom of the
// first step is at (x, y) and it climbs along its own +y (turned by r).
export function stairGeometry(s, rise) {
  const kind = s.kind || "straight", W = s.w || (STAIR_KINDS.find((q) => q.id === kind) || STAIR_KINDS[0]).w;
  const n = Math.max(2, Math.ceil(rise / RISER)), rh = rise / n, col = s.col || STAIR_COL, rails = [], P = [], rail = s.rail && s.rail !== "none" ? s.rail : null;
  const fl = s.flip ? -1 : 1, RH = 914;
  // a flight of solid steps from local (u, v0) going along +v (dir 1) or -v (dir -1)
  const flight = (u, v0, dir, i0, count, wid) => {
    for (let i = 0; i < count; i++) { const top = (i0 + i + 1) * rh; P.push(box(u, v0 + dir * (i + 0.5) * TREAD, 0, wid, TREAD, top, col)); }
  };
  let foot = null;
  if (kind === "straight" || kind === "wide" || kind === "steps") {
    const steps = kind === "steps" ? n : n - 1; // outdoor steps: every riser is a step; inside, the last one is the floor above
    flight(0, 0, 1, 0, steps, W);
    const run = steps * TREAD;
    if (rail) for (const u of [-W / 2 + 45, W / 2 - 45]) rails.push(...railParts([u, 0, rh], [u, run - TREAD / 2, steps * rh], RH, rail));
    foot = { u0: -W / 2, u1: W / 2, v0: kind === "steps" ? 0 : TREAD, v1: run };
  } else if (kind === "L") {
    const n1 = Math.max(1, Math.round((n - 1) / 2)), n2 = n - 1 - n1, run1 = n1 * TREAD;
    flight(0, 0, 1, 0, n1, W);
    // the landing, then the second flight turns (right, or left when flipped)
    P.push(box(0, run1 + W / 2, 0, W, W, (n1 + 1) * rh, col));
    for (let i = 0; i < n2; i++) { const top = (n1 + 2 + i) * rh; P.push(box(fl * (W / 2 + (i + 0.5) * TREAD), run1 + W / 2, 0, TREAD, W, Math.min(rise, top), col)); }
    const out = -fl * (W / 2 - 45);
    if (rail) { rails.push(...railParts([out, 0, rh], [out, run1 + W - 45, (n1 + 1) * rh], RH, rail)); rails.push(...railParts([out, run1 + W - 45, (n1 + 1) * rh], [fl * (W / 2 + n2 * TREAD), run1 + W - 45, rise], RH, rail, { noStart: true })); }
    foot = { u0: Math.min(-W / 2, fl * (W / 2 + n2 * TREAD)), u1: Math.max(W / 2, fl * (W / 2 + n2 * TREAD)), v0: run1, v1: run1 + W, extra: { u0: Math.min(fl * W / 2, fl * (W / 2 + n2 * TREAD)), u1: Math.max(fl * W / 2, fl * (W / 2 + n2 * TREAD)), v0: run1, v1: run1 + W } };
  } else if (kind === "U") {
    const n1 = Math.max(1, Math.round((n - 1) / 2)), n2 = n - 1 - n1, run1 = n1 * TREAD, g = 100, u1 = -fl * (W / 2 + g / 2), u2 = fl * (W / 2 + g / 2);
    flight(u1, 0, 1, 0, n1, W);
    P.push(box(0, run1 + W / 2, 0, 2 * W + g, W, (n1 + 1) * rh, col));
    for (let i = 0; i < n2; i++) { const top = (n1 + 2 + i) * rh; P.push(box(u2, run1 - (i + 0.5) * TREAD, 0, W, TREAD, Math.min(rise, top), col)); }
    const ou = u1 - fl * (W / 2 - 45), ou2 = u2 + fl * (W / 2 - 45);
    if (rail) { rails.push(...railParts([ou, 0, rh], [ou, run1 + W - 45, (n1 + 1) * rh], RH, rail)); rails.push(...railParts([ou, run1 + W - 45, (n1 + 1) * rh], [ou2, run1 + W - 45, (n1 + 1) * rh], RH, rail, { noStart: true })); }
    foot = { u0: -W - g / 2, u1: W + g / 2, v0: run1 - n2 * TREAD, v1: run1 + W };
  } else if (kind === "spiral") {
    // wedge treads round a pole: a full circle every 12 steps or so
    const R = W / 2, da = (2 * Math.PI) / 13;
    P.push(cyl(0, R, 0, 110, rise + RH, "#3a3d42"));
    for (let i = 0; i < n - 1; i++) {
      const a = fl * i * da, cx = Math.sin(a) * R * 0.5, cy = R - Math.cos(a) * R * 0.5;
      P.push(box(cx, cy, (i + 1) * rh - 45, R * 0.98, R * da * 0.75 + 60, 45, col, -fl * 0 + a - Math.PI / 2));
      if (rail) { const ox = Math.sin(a) * (R - 25), oy = R - Math.cos(a) * (R - 25); P.push(cyl(ox, oy, (i + 1) * rh, 20, RH, (RAIL_STYLES.find((q) => q.id === rail) || RAIL_STYLES[0]).col)); }
    }
    if (rail) for (let i = 0; i < n - 2; i++) {
      const a0 = fl * i * da, a1 = fl * (i + 1) * da;
      const p0 = [Math.sin(a0) * (R - 25), R - Math.cos(a0) * (R - 25), (i + 1) * rh + RH], p1 = [Math.sin(a1) * (R - 25), R - Math.cos(a1) * (R - 25), (i + 2) * rh + RH];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), pz = Math.atan2(p1[2] - p0[2], L);
      P.push(box((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2 - 25, Math.hypot(L, p1[2] - p0[2]) + 20, 50, 50, (RAIL_STYLES.find((q) => q.id === rail) || RAIL_STYLES[0]).col, Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), -pz));
    }
    foot = { u0: -R, u1: R, v0: 0, v1: 2 * R };
  }
  const parts = place(s, [...P, ...rails]);
  // the stairwell: the floor above is cut over the stairs (plan rectangle, turned with the stairs)
  const corners = (f) => [[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]].map(([u, v]) => toPlan(s)(u, v));
  const well = foot && kind !== "steps" ? corners({ u0: foot.u0 - 50, u1: foot.u1 + 50, v0: foot.v0 - 50, v1: foot.v1 + 50 }) : null;
  // its footprint on the floor (for the plan and for picking)
  let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
  for (const q of parts) { fx0 = Math.min(fx0, q.x - q.w / 2); fx1 = Math.max(fx1, q.x + q.w / 2); fy0 = Math.min(fy0, q.y - q.d / 2); fy1 = Math.max(fy1, q.y + q.d / 2); }
  return { parts, well, n, rh, box: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } };
}

// ------------------------------------------------------------------ porches
// p: { x0, y0, x1, y1, deck, postH, post, roof, pitch, over, rail, steps, house } on a level.
// house: which side is against the house ("x0", "x1", "y0", "y1" or "none"); it has no posts
// and the roof is fastened to the house there. Returns the parts and a roof for the roof code.
export function porchGeometry(p) {
  const x0 = Math.min(p.x0, p.x1), x1 = Math.max(p.x0, p.x1), y0 = Math.min(p.y0, p.y1), y1 = Math.max(p.y0, p.y1);
  const dh = p.deck ?? 450, ph = p.postH ?? 2438, PS = POST_STYLES.find((q) => q.id === p.post) || POST_STYLES[0], pw = PS.w, H = p.house || "none";
  const out = [];
  // the deck: a floor on a skirt
  if (dh > 20) out.push(box((x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, dh, p.deckCol || DECK_COL));
  else out.push(box((x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, 40, p.deckCol || DECK_COL));
  const top = Math.max(dh, 40), roofed = p.roof && p.roof !== "none";
  // the four sides, each with its two ends; the house side has no posts and no railing
  const sides = { y0: [[x0, y0], [x1, y0]], x1: [[x1, y0], [x1, y1]], y1: [[x1, y1], [x0, y1]], x0: [[x0, y1], [x0, y0]] };
  const front = H === "y1" ? "y0" : H === "y0" ? "y1" : H === "x0" ? "x1" : H === "x1" ? "x0" : "y0";
  const posts = [];
  const inset = pw / 2 + 20;
  for (const [k, [A, B]] of Object.entries(sides)) {
    if (k === H) continue;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L / 2440));
    for (let i = 0; i <= n; i++) {
      let x = A[0] + ((B[0] - A[0]) * i) / n, y = A[1] + ((B[1] - A[1]) * i) / n;
      // posts at the corner that meets the house sit against it
      x = Math.min(x1 - inset, Math.max(x0 + inset, x)); y = Math.min(y1 - inset, Math.max(y0 + inset, y));
      if (!posts.some((q) => Math.hypot(q[0] - x, q[1] - y) < 10)) posts.push([x, y]);
    }
  }
  if (H !== "none") for (const [x, y] of [...posts]) { const onHouse = (H === "x0" && x < x0 + inset + 1) || (H === "x1" && x > x1 - inset - 1) || (H === "y0" && y < y0 + inset + 1) || (H === "y1" && y > y1 - inset - 1); if (onHouse) posts.splice(posts.findIndex((q) => q[0] === x && q[1] === y), 1); }
  if (roofed) for (const [x, y] of posts) {
    if (PS.id === "round") { out.push(box(x, y, top, pw + 40, pw + 40, 60, PS.col)); out.push(cyl(x, y, top + 60, pw, ph - 120, PS.col)); out.push(box(x, y, top + ph - 60, pw + 50, pw + 50, 60, PS.col)); }
    else if (PS.id === "craftsman") { out.push(box(x, y, top, pw + 80, pw + 80, ph * 0.38, "#8c8478")); out.push(box(x, y, top + ph * 0.38, pw * 0.85, pw * 0.85, ph * 0.62 * 0.5, PS.col)); out.push(box(x, y, top + ph * 0.69, pw * 0.62, pw * 0.62, ph * 0.31, PS.col)); }
    else if (PS.id === "log") out.push(cyl(x, y, top, pw, ph, PS.col));
    else out.push(box(x, y, top, pw, pw, ph, PS.col));
  }
  // beams on top of the posts, round the open sides
  if (roofed) for (const [k, [A, B]] of Object.entries(sides)) {
    if (k === H) continue;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, ax = A[0] === B[0];
    out.push(box(ax ? Math.min(x1 - inset, Math.max(x0 + inset, mx)) : mx, ax ? my : Math.min(y1 - inset, Math.max(y0 + inset, my)), top + ph, ax ? pw : L, ax ? L : pw, 200, PS.col));
  }
  // steps at the middle of the front, and a railing round the open sides with a gap for them
  const SW = 1219;
  let steps = null;
  if (p.steps !== false && dh >= 150) {
    const [A, B] = sides[front], mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const r = front === "y0" ? Math.PI : front === "y1" ? 0 : front === "x0" ? Math.PI / 2 : -Math.PI / 2;
    // the steps climb towards the porch: they start outside and go in
    const nS = Math.max(1, Math.ceil(dh / RISER)), run = nS * TREAD;
    const ox = front === "x0" ? -run : front === "x1" ? run : 0, oy = front === "y0" ? -run : front === "y1" ? run : 0;
    steps = { x: mx + ox, y: my + oy, r: r + Math.PI, kind: "steps", w: SW, rail: p.rail && p.rail !== "none" ? p.rail : null };
    out.push(...stairGeometry({ ...steps, col: p.deckCol || DECK_COL }, dh).parts);
  }
  if (p.rail && p.rail !== "none" && dh >= 150) for (const [k, [A, B]] of Object.entries(sides)) {
    if (k === H) continue;
    const pin = (q) => [Math.min(x1 - 50, Math.max(x0 + 50, q[0])), Math.min(y1 - 50, Math.max(y0 + 50, q[1])), top];
    const a = pin(A), b = pin(B);
    if (k === front && steps) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, g0 = L / 2 - SW / 2 - 60, g1 = L / 2 + SW / 2 + 60;
      if (g0 > 200) out.push(...railParts(a, [a[0] + ux * g0, a[1] + uy * g0, top], 914, p.rail));
      if (L - g1 > 200) out.push(...railParts([a[0] + ux * g1, a[1] + uy * g1, top], b, 914, p.rail));
    } else out.push(...railParts(a, b, 914, p.rail));
  }
  // the roof: its own, over the porch (shed: high side on the house)
  let roof = null;
  if (roofed) {
    const along = H === "x0" || H === "x1" ? "y" : "x"; // the house wall runs along this
    const kind = p.roof;
    roof = { kind, x0, y0, x1, y1, pitch: p.pitch ?? (kind === "shed" ? 14 : 30), over: p.over ?? 300, thick: 150, z0: top + ph + 200 };
    if (kind === "shed") { roof.dir = along; roof.flip = H === "x1" || H === "y1"; }
    else if (kind === "gable") roof.dir = along === "x" ? "y" : "x"; // the ridge runs out from the house, the gable faces the front
    else roof.dir = along;
  }
  return { parts: out, roof, front, posts: posts.length };
}

// which side of a porch rectangle is against the house: the side with a wall closest to it
export function porchHouseSide(p, walls) {
  const x0 = Math.min(p.x0, p.x1), x1 = Math.max(p.x0, p.x1), y0 = Math.min(p.y0, p.y1), y1 = Math.max(p.y0, p.y1);
  const mids = { x0: [x0, (y0 + y1) / 2], x1: [x1, (y0 + y1) / 2], y0: [(x0 + x1) / 2, y0], y1: [(x0 + x1) / 2, y1] };
  let best = "none", bd = 700;
  for (const [k, [mx, my]] of Object.entries(mids)) for (const w of walls) {
    const ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1], L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / L2)), d = Math.hypot(ax + (bx - ax) * t - mx, ay + (by - ay) * t - my) - (w.t || 0) / 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
