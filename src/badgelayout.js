// Where constraint badges go on screen so none sits on another, a corner or a dimension label (browser test F10).
const GAP = 2, CLEAR = 8, STEPS = 6, SIDES = [1, -1], SLIDES = [0, 0.5, -0.5, 1, -1];

const area = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const clash = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5;

// groups: [{ x, y, nx, ny, sizes: [[w, h], ...] }] (anchor and outward unit normal in screen px); obstacles: [[x0, y0, x1, y1], ...]
// returns, per group, the top-left [x, y] of each badge
export function layoutBadges(groups, obstacles) {
  const taken = obstacles.map((o) => [...o]);
  const out = new Array(groups.length);
  const order = groups.map((g, i) => i).sort((a, b) => groups[b].sizes.length - groups[a].sizes.length || a - b);
  for (const gi of order) {
    const { x, y, nx, ny, sizes } = groups[gi];
    const W = sizes.reduce((t, s) => t + s[0], 0) + GAP * (sizes.length - 1), H = Math.max(...sizes.map((s) => s[1]));
    const ax = Math.abs(nx), ay = Math.abs(ny);
    const base = CLEAR + (ax * W + ay * H) / 2, step = ax * (W + GAP) + ay * (H + GAP), slide = ay * (W + GAP) + ax * (H + GAP);
    const cand = [];
    for (let k = 0; k < STEPS; k++) for (const s of SIDES) for (const t of SLIDES) {
      const d = s * (base + k * step), cx = x + nx * d - ny * t * slide, cy = y + ny * d + nx * t * slide;
      cand.push({ away: Math.hypot(cx - x - nx * base, cy - y - ny * base), r: [cx - W / 2, cy - H / 2, cx + W / 2, cy + H / 2] });
    }
    // only boxes a candidate could reach matter: keeps a busy sketch fast
    const reach = base + (STEPS - 1) * step + slide + Math.max(W, H), near = taken.filter((o) => o[2] > x - reach && o[0] < x + reach && o[3] > y - reach && o[1] < y + reach);
    cand.sort((p, q) => p.away - q.away); // nearest to the preferred spot first; ties keep the order above (k, side, slide)
    let best = null, bestCost = Infinity;
    for (const { r } of cand) {
      if (!near.some((o) => clash(r, o))) { best = r; break; }
      const cost = near.reduce((c, o) => c + area(r, o), 0);
      if (cost < bestCost) { bestCost = cost; best = r; }
    }
    taken.push(best);
    let at = best[0];
    out[gi] = sizes.map(([w, h]) => { const p = [Math.round(at), Math.round((best[1] + best[3]) / 2 - h / 2)]; at += w + GAP; return p; });
  }
  return out;
}
