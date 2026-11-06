/* ===== Neon Sign Builder: geometry =====
   Everything in mm. The sign lies flat: x right, y up the sign, z up out of it (towards the viewer
   when it hangs on a wall). Tubes are centre lines (polylines); the shells round them and the
   backing under them are built from distance fields: shells with surface nets in 3D, the backing
   as stacked 2D layers (contours by marching squares, extruded). */
const NG = (() => {
  // ------------------------------------------------------------ raster helpers
  // exact Euclidean distance transform (Felzenszwalb): f has 0 on "sites", Infinity elsewhere
  function edt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }
  // distance (in pixels) from each pixel to the nearest pixel where site(i) is true
  function edt(W, H, site) {
    const INF = 1e20, g = new Float64Array(W * H), n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let i = 0; i < W * H; i++) g[i] = site(i) ? 0 : INF;
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; edt1(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1(f, W, d, v, z); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]); }
    return g;
  }
  // Zhang-Suen thinning of a binary image (1 = ink), in place
  function thin(img, W, H) {
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
    let changed = true; const del = [];
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          if (!img[y * W + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
          del.push(y * W + x);
        }
        if (del.length) changed = true;
        for (const i of del) img[i] = 0;
      }
    }
    return img;
  }
  // the skeleton as polylines: walk from ends and junctions; then small spurs are pruned
  function traceSkeleton(img, W, H, minSpur) {
    const N = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const nb = (i) => { const x = i % W, y = (i / W) | 0, o = []; for (const [dx, dy] of N) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && img[Y * W + X]) o.push(Y * W + X); } return o; };
    // staircase corners: a pixel with two side-by-side 4-neighbours (N and E, say) and nothing on the
    // opposite sides is not needed (N and E touch diagonally); removing it leaves a one-pixel 8-connected line
    const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && img[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!img[y * W + x]) continue;
      const n = at(x, y - 1), e = at(x + 1, y), s = at(x, y + 1), w = at(x - 1, y);
      if ((n && e && !s && !w && !at(x - 1, y + 1)) || (e && s && !n && !w && !at(x - 1, y - 1)) || (s && w && !n && !e && !at(x + 1, y - 1)) || (w && n && !s && !e && !at(x + 1, y + 1))) img[y * W + x] = 0;
    }
    const deg = new Uint8Array(W * H); const px = [];
    for (let i = 0; i < W * H; i++) if (img[i]) { deg[i] = nb(i).length; px.push(i); }
    const node = (i) => deg[i] !== 2;
    const used = new Set(), key = (a, b) => (a < b ? a + ":" + b : b + ":" + a), paths = [];
    const walk = (s, n1) => {
      const P = [s], prev0 = s; let prev = prev0, cur = n1; used.add(key(s, n1));
      while (true) {
        P.push(cur);
        if (node(cur) && cur !== s) break;
        const nx = nb(cur).filter((q) => q !== prev && !used.has(key(cur, q)));
        if (!nx.length) break;
        // prefer the 4-neighbour (keeps diagonal staircases from forking)
        nx.sort((a, b) => (Math.abs((a % W) - (cur % W)) + Math.abs(((a / W) | 0) - ((cur / W) | 0))) - (Math.abs((b % W) - (cur % W)) + Math.abs(((b / W) | 0) - ((cur / W) | 0))));
        const q = nx[0]; used.add(key(cur, q)); prev = cur; cur = q;
        if (cur === s) { P.push(s); break; }
      }
      return P;
    };
    for (const i of px) if (node(i) && deg[i] > 0) for (const q of nb(i)) if (!used.has(key(i, q))) paths.push({ pts: walk(i, q) });
    // closed loops with no ends or junctions (an O)
    for (const i of px) if (deg[i] === 2) { const q = nb(i).find((q2) => !used.has(key(i, q2))); if (q !== undefined && !nb(i).every((q2) => used.has(key(i, q2)))) paths.push({ pts: walk(i, q), loop: true }); }
    // prune spurs: short paths that end at a pixel with one neighbour and start at a junction
    const out = [];
    for (const p of paths) {
      const a = p.pts[0], b = p.pts[p.pts.length - 1];
      const len = p.pts.length;
      const spur = len < minSpur && ((deg[a] === 1 && deg[b] >= 3) || (deg[b] === 1 && deg[a] >= 3));
      if (!spur && len >= 3) out.push(p.pts.map((i) => [i % W, (i / W) | 0]));
    }
    return out;
  }
  // skeleton pieces into long strokes: short spurs dropped, then pieces whose ends meet and carry on in
  // the same direction joined (a strip goes through a junction rather than stopping at it)
  function joinPaths(paths, spur) {
    const arc = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };
    const near = (q, P0, skip) => { for (const P of P0) { if (P === skip) continue; for (const p of P) if (Math.abs(p[0] - q[0]) <= 2.5 && Math.abs(p[1] - q[1]) <= 2.5) return true; } return false; };
    let L = paths.map((P) => P.slice());
    for (let pass = 0; pass < 3; pass++) {
      // spurs: short, hanging off another stroke at one end and free at the other
      L = L.filter((P) => { if (isClosed(P) || arc(P) >= spur) return true; const a = near(P[0], L, P), b = near(P[P.length - 1], L, P); return a === b; });
      // tiny pieces between junctions merge into whatever they touch
      let changed = true;
      while (changed) {
        changed = false;
        const ends = [];
        L.forEach((P, k) => { if (isClosed(P) || P.length < 2) return; const n = P.length - 1, m = Math.min(n, 6); ends.push({ k, s: 0, p: P[0], d: norm(P[0][0] - P[m][0], P[0][1] - P[m][1]) }, { k, s: 1, p: P[n], d: norm(P[n][0] - P[n - m][0], P[n][1] - P[n - m][1]) }); });
        let best = null;
        for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
          const A = ends[i], B = ends[j], gap = Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]);
          if (gap > 4.5) continue;
          if (A.k === B.k && L[A.k].length < 8) continue;
          const turn = 1 + (A.d[0] * B.d[0] + A.d[1] * B.d[1]); // 0 = straight through, 2 = doubling back
          if (turn > 0.9) continue;
          const sc = turn + gap * 0.05;
          if (!best || sc < best.sc) best = { A, B, sc };
        }
        if (!best) break;
        const { A, B } = best;
        if (A.k === B.k) { const P = L[A.k]; P.push(P[0].slice()); }
        else {
          let P = L[A.k], Q = L[B.k];
          if (A.s === 0) P = P.slice().reverse();
          if (B.s === 1) Q = Q.slice().reverse();
          L[A.k] = [...P, ...Q]; L.splice(B.k, 1);
        }
        changed = true;
      }
    }
    return L;
  }
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  // marching squares: loops where field = 0 (inside negative); returns [[x,y],...] in grid units
  // prims (optional): the fields F was made from (by max / min); each crossing is placed where the
  // field that changes sign there crosses, so every field made from them shares the same points
  function contours(F, W, H, prims) {
    const segs = [];
    let i0 = 0, i1 = 0;
    const lerp = (a, b) => { if (prims) for (const P of prims) { const pa = P[i0], pb = P[i1]; if ((pa < 0) !== (pb < 0)) return pa / (pa - pb); } return a / (a - b); };
    const at = (u, v) => { i0 = u; i1 = v; };
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const ia = y * W + x, ib = ia + 1, ic = ia + W + 1, id = ia + W;
      const a = F[ia], b = F[ib], c = F[ic], d = F[id];
      let k = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0);
      if (k === 0 || k === 15) continue;
      if (!prims) { var T = [x + lerp(a, b), y, 'h' + x + ',' + y], R = [x + 1, y + lerp(b, c), 'v' + (x + 1) + ',' + y], B = [x + 1 - lerp(c, d), y + 1, 'h' + x + ',' + (y + 1)], L = [x, y + 1 - lerp(d, a), 'v' + x + ',' + y]; }
      else { at(ia, ib); T = [x + lerp(a, b), y, 'h' + x + ',' + y]; at(ib, ic); R = [x + 1, y + lerp(b, c), 'v' + (x + 1) + ',' + y]; at(id, ic); B = [x + lerp(d, c), y + 1, 'h' + x + ',' + (y + 1)]; at(ia, id); L = [x, y + lerp(a, d), 'v' + x + ',' + y]; }
      // segments go with the inside on the left
      const S = {
        1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, B]], 6: [[T, B]], 7: [[L, B]], 8: [[B, L]], 9: [[B, T]], 11: [[B, R]], 12: [[R, L]], 13: [[R, T]], 14: [[T, L]],
      };
      if (k === 5 || k === 10) {
        const m = prims ? 1 : (a + b + c + d) / 4;
        if (k === 5) segs.push(...(m < 0 ? [[L, B], [R, T]] : [[L, T], [R, B]]));
        else segs.push(...(m < 0 ? [[T, L], [B, R]] : [[T, R], [B, L]]));
      } else segs.push(...S[k]);
    }
    // join into loops
    const K = (p) => p[2];
    const from = new Map();
    for (const s of segs) from.set(K(s[0]), s);
    const loops = [], done = new Set();
    for (const s of segs) {
      if (done.has(s)) continue;
      const L0 = []; let cur = s;
      while (cur && !done.has(cur)) { done.add(cur); L0.push([cur[0][0], cur[0][1]]); cur = from.get(K(cur[1])); }
      if (L0.length > 2) loops.push(L0);
    }
    return loops;
  }
  // Ramer-Douglas-Peucker
  function rdp(P, eps, closed) {
    if (P.length < 3) return P.slice();
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [i, j] = st.pop(); let md = -1, mi = -1;
      const ax = P[i][0], ay = P[i][1], bx = P[j][0], by = P[j][1], L = Math.hypot(bx - ax, by - ay) || 1e-9;
      for (let k = i + 1; k < j; k++) { const d = Math.abs((bx - ax) * (ay - P[k][1]) - (ax - P[k][0]) * (by - ay)) / L; if (d > md) { md = d; mi = k; } }
      if (md > eps) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
    }
    const out = P.filter((_, k) => keep[k]);
    void closed;
    return out;
  }
  // a closed loop (first point repeated at the end): split at the far point and simplify each half
  function rdpLoop(P, eps) {
    let far = 0, fd = -1; for (let i = 1; i < P.length - 1; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
    if (far < 1) return P.slice();
    const A = rdp(P.slice(0, far + 1), eps), B = rdp(P.slice(far), eps);
    return [...A, ...B.slice(1)];
  }
  function chaikin(P, n, closed) {
    let Q = P;
    for (let it = 0; it < n; it++) {
      const R = closed ? [] : [Q[0]];
      const m = closed ? Q.length : Q.length - 1;
      for (let i = 0; i < m; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; R.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      if (!closed) R.push(Q[Q.length - 1]);
      Q = R;
    }
    return Q;
  }
  const isClosed = (P) => P.length > 3 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6;

  // ------------------------------------------------------------ a mask (canvas) to tube centre lines
  // mask: Uint8Array W×H (1 = ink); mode "center" (skeleton) or "outline" (the edge, inset by r px);
  // returns polylines in pixel units, smoothed
  function maskToPaths(mask, W, H, mode, rPx, smooth = 2) {
    if (mode === "outline") {
      const din = edt(W, H, (i) => !mask[i]); // distance to the outside, for ink pixels
      const F = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) F[i] = mask[i] ? rPx - din[i] : rPx + 1;
      const loops = contours(F, W, H).map((L) => { const C = chaikin(rdpLoop([...L, L[0]], 0.35).slice(0, -1), smooth, true); return [...C, C[0]]; }).filter((L) => L.length > 4);
      // parts too thin for a tube inside their edge (thin lines) get one tube down their middle
      const dE = edt(W, H, (i) => mask[i] && din[i] > rPx);
      const thinM = new Uint8Array(W * H); let any = 0;
      for (let i = 0; i < W * H; i++) if (mask[i] && dE[i] > rPx + 1.5) { thinM[i] = 1; any++; }
      if (any > 4) for (const P of maskToPaths(thinM, W, H, "center", rPx, smooth)) { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (L > rPx * 2) loops.push(P); }
      return loops;
    }
    const din = edt(W, H, (i) => !mask[i]);
    let maxR = 0; for (let i = 0; i < W * H; i++) if (mask[i] && din[i] > maxR) maxR = din[i];
    const img = new Uint8Array(mask);
    thin(img, W, H);
    let paths = traceSkeleton(img, W, H, Math.max(4, maxR * 1.6));
    paths = joinPaths(paths, Math.max(4, maxR * 1.6));
    return paths.map((P) => { const closed = isClosed(P); const Q = closed ? rdpLoop(P, 0.6) : rdp(P, 0.6); const C = chaikin(closed ? Q.slice(0, -1) : Q, smooth, closed); return closed ? [...C, C[0]] : C; }).filter((P) => P.length >= 2);
  }

  // ------------------------------------------------------------ distance to the tubes (2D grid)
  // G: { x0, y0, c (cell mm), W, H }; paths in mm; returns Float32 distance (mm), capped at cap
  function pathDistance(G, paths, cap) {
    const D = new Float32Array(G.W * G.H).fill(cap);
    for (const P of paths) for (let s = 0; s + 1 < P.length; s++) {
      const ax = P[s][0], ay = P[s][1], bx = P[s + 1][0], by = P[s + 1][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - cap - G.x0) / G.c)), i1 = Math.min(G.W - 1, Math.ceil((Math.max(ax, bx) + cap - G.x0) / G.c));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - cap - G.y0) / G.c)), j1 = Math.min(G.H - 1, Math.ceil((Math.max(ay, by) + cap - G.y0) / G.c));
      for (let j = j0; j <= j1; j++) { const y = G.y0 + j * G.c; for (let i = i0; i <= i1; i++) { const x = G.x0 + i * G.c; let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - ax - t * dx, y - ay - t * dy); const k = j * G.W + i; if (d < D[k]) D[k] = d; } }
    }
    return D;
  }

  // ------------------------------------------------------------ the shell (3D, surface nets)
  // T: tube settings { a: outer half width, Ho: outer height, ri: inner half width, Hi: inner height, bump }
  function shellSDF(d, z, T) {
    const oz = T.Ho - T.a, iz = T.Hi - T.ri;
    const outer = z > oz ? Math.hypot(d, z - oz) - T.a : d - T.a;
    const inner = z > iz ? Math.hypot(d, z - iz) - T.ri : d - T.ri;
    let f = Math.max(outer, -inner, -z);
    if (T.bump) {
      // a small ridge round the bottom of the walls: it clicks into the groove's notch
      const br = T.a + T.bump - Math.max(0, z - 1.3) * 0.9 - Math.max(0, 0.7 - z) * 0.9;
      const b = Math.max(d - br, 0.25 - z, z - 1.9, -inner);
      f = Math.min(f, b);
    }
    return f;
  }
  // surface nets over a 3D grid built slice by slice from a 2D distance grid
  // clip(x, y): extra 2D field (negative inside) to cut a piece out (tiles); returns { pos: Float32Array, idx: Uint32Array }
  function shellMesh(G, D, T, clip) {
    const W = G.W, H = G.H, c = G.c, z0 = -1.5 * c, NZ = Math.ceil((T.Ho + 3 * c - z0) / c) + 1, BIG = 1e3;
    const reach = T.a + T.bump + 2 * c;
    const act = new Uint8Array(W * H);
    const clipF = clip ? new Float32Array(W * H) : null;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (D[k] < reach) { act[k] = 1; if (clipF) clipF[k] = clip(G.x0 + i * c, G.y0 + j * c); } }
    const cube = new Uint8Array(W * H);
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const k = j * W + i; if (act[k] || act[k + 1] || act[k + W] || act[k + W + 1]) cube[k] = 1; }
    const slice = (kz, out) => { const z = z0 + kz * c; for (let k = 0; k < W * H; k++) { if (!act[k]) { out[k] = BIG; continue; } let f = shellSDF(D[k], z, T); if (clipF) f = Math.max(f, clipF[k]); out[k] = f; } };
    let A = new Float32Array(W * H), B = new Float32Array(W * H);
    let prev = new Int32Array(W * H).fill(-1), cur = new Int32Array(W * H).fill(-1);
    const pos = [], idx = [];
    // corners: bit = dx + 2dy + 4dz
    const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = new Float32Array(8);
    const quad = (a, b, cc, d, dir) => {
      // two triangles, wound so the normal points along dir (towards the outside)
      const P = (n) => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]];
      const pa = P(a), pb = P(b), pc = P(cc);
      const nx = (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]), ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]), nz = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) idx.push(a, b, cc, a, cc, d); else idx.push(a, cc, b, a, d, cc);
    };
    slice(0, A);
    for (let kz = 0; kz < NZ - 1; kz++) {
      slice(kz + 1, B);
      cur.fill(-1);
      const z = z0 + kz * c;
      for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
        const k = j * W + i; if (!cube[k]) continue;
        v[0] = A[k]; v[1] = A[k + 1]; v[2] = A[k + W]; v[3] = A[k + W + 1]; v[4] = B[k]; v[5] = B[k + 1]; v[6] = B[k + W]; v[7] = B[k + W + 1];
        let m = 0; for (let q = 0; q < 8; q++) if (v[q] < 0) m |= 1 << q;
        if (m === 0 || m === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [p, q] of ED) { const vp = v[p], vq = v[q]; if ((vp < 0) === (vq < 0)) continue; const t = vp / (vp - vq); sx += CO[p][0] + (CO[q][0] - CO[p][0]) * t; sy += CO[p][1] + (CO[q][1] - CO[p][1]) * t; sz += CO[p][2] + (CO[q][2] - CO[p][2]) * t; n++; }
        cur[k] = pos.length / 3;
        pos.push(G.x0 + (i + sx / n) * c, G.y0 + (j + sy / n) * c, z + (sz / n) * c);
      }
      // faces round each edge that crosses the surface (edges from corner 0 of each cube)
      for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
        const k = j * W + i; if (cur[k] < 0) continue;
        const v0 = A[k], inside0 = v0 < 0;
        // x edge: cubes (i,j,k) (i,j-1,k) (i,j-1,k-1) (i,j,k-1)
        if (j > 0 && kz > 0 && (A[k + 1] < 0) !== inside0) { const a = cur[k], b = cur[k - W], cc = prev[k - W], d = prev[k]; if (b >= 0 && cc >= 0 && d >= 0) quad(a, b, cc, d, inside0 ? [1, 0, 0] : [-1, 0, 0]); }
        // y edge: cubes (i,j,k) (i-1,j,k) (i-1,j,k-1) (i,j,k-1)
        if (i > 0 && kz > 0 && (A[k + W] < 0) !== inside0) { const a = cur[k], b = cur[k - 1], cc = prev[k - 1], d = prev[k]; if (b >= 0 && cc >= 0 && d >= 0) quad(a, b, cc, d, inside0 ? [0, 1, 0] : [0, -1, 0]); }
        // z edge: cubes (i,j,k) (i-1,j,k) (i-1,j-1,k) (i,j-1,k)
        if (i > 0 && j > 0 && (B[k] < 0) !== inside0) { const a = cur[k], b = cur[k - 1], cc = cur[k - 1 - W], d = cur[k - W]; if (b >= 0 && cc >= 0 && d >= 0) quad(a, b, cc, d, inside0 ? [0, 0, 1] : [0, 0, -1]); }
      }
      [A, B] = [B, A]; [prev, cur] = [cur, prev];
    }
    return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
  }

  // ------------------------------------------------------------ the backing (2D layers)
  // F: Float32 field on grid G (negative inside); extruded between z0 and z1; returns triangles (flat array)
  function extrudeField(G, F, z0, z1, out) {
    const loops = contours(F, G.W, G.H).map((L) => rdpLoop([...L, L[0]], 0.08).slice(0, -1)).filter((L) => L.length >= 3).map((L) => L.map(([x, y]) => [G.x0 + x * G.c, G.y0 + y * G.c]));
    const area = (L) => { let s = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
    const inside = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < ((L[j][0] - L[i][0]) * (p[1] - L[i][1])) / (L[j][1] - L[i][1]) + L[i][0]) c = !c; return c; };
    // outer loops and holes by how deeply each is nested; outers anticlockwise, holes clockwise
    const all = loops.filter((L) => Math.abs(area(L)) > 0.3).map((L) => ({ L, a: Math.abs(area(L)) }));
    const groups = [];
    for (const q of all) {
      const depth = all.filter((o) => o !== q && o.a > q.a && inside(q.L[0], o.L)).length;
      q.hole = depth % 2 === 1;
      if ((area(q.L) > 0) === q.hole) q.L.reverse();
    }
    for (const q of all) if (!q.hole) groups.push({ o: q.L, a: q.a, h: [] });
    groups.sort((p, q) => p.a - q.a);
    for (const q of all) if (q.hole) { const g = groups.find((G0) => G0.a > q.a && inside(q.L[0], G0.o)); if (g) g.h.push(q.L); }
    const V2 = (p) => new THREE.Vector2(p[0], p[1]);
    const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const flat = (a, b, c, z, up) => { const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if ((cr > 0) === up) tri([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]); else tri([a[0], a[1], z], [c[0], c[1], z], [b[0], b[1], z]); };
    for (const g of groups) {
      const pts = [...g.o, ...g.h.flat()];
      const faces = THREE.ShapeUtils.triangulateShape(g.o.map(V2), g.h.map((h) => h.map(V2)));
      for (const [a, b, c] of faces) { flat(pts[a], pts[b], pts[c], z1, true); flat(pts[a], pts[b], pts[c], z0, false); }
      for (const L of [g.o, ...g.h]) for (let i = 0; i < L.length; i++) {
        const p = L[i], q = L[(i + 1) % L.length];
        tri([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1]);
        tri([p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]);
      }
    }
    return out;
  }

  // a solid made of flat layers stacked up (each a region of the grid, from z0 to z1), as one closed
  // mesh: walls round each layer, the bottom and top, and at each step only where the layers differ
  function stackLayers(G, layers, prims, out) {
    const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const area = (L) => { let s2 = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; s2 += a[0] * b[1] - b[0] * a[1]; } return s2 / 2; };
    const inside = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < ((L[j][0] - L[i][0]) * (p[1] - L[i][1])) / (L[j][1] - L[i][1]) + L[i][0]) c = !c; return c; };
    const regions = (F, pr) => {
      const all = contours(F, G.W, G.H, pr).filter((L) => L.length >= 3).map((L) => { const M = L.map(([x, y]) => [G.x0 + x * G.c, G.y0 + y * G.c]); return { L: M, s: area(M) }; }).filter((q) => Math.abs(q.s) > 1e-4);
      // outer loops and holes by how deeply each is nested: outers anticlockwise, holes clockwise
      for (const q of all) { q.a = Math.abs(q.s); }
      for (const q of all) { q.hole = all.filter((o) => o !== q && o.a > q.a && inside(q.L[0], o.L)).length % 2 === 1; if ((q.s > 0) === q.hole) q.L.reverse(); }
      const outers = all.filter((q) => !q.hole).sort((p, q) => p.a - q.a).map((q) => ({ o: q.L, a: q.a, h: [] }));
      for (const q of all) if (q.hole) { const g = outers.find((G0) => G0.a > q.a && inside(q.L[0], G0.o)); if (g) g.h.push(q.L); }
      return outers;
    };
    const cap = (F, z, up, pr) => {
      for (const g of regions(F, pr)) {
        const pts = [...g.o, ...g.h.flat()];
        let faces = [];
        // a tiny fixed nudge so the triangulator keeps points in a straight line (the walls use them)
        const V = (p) => { const h = Math.sin(p[0] * 12.9898 + p[1] * 78.233) * 43758.5453; const r = h - Math.floor(h); return new THREE.Vector2(p[0] + (r - 0.5) * 2e-5, p[1] + (((r * 7.31) % 1) - 0.5) * 2e-5); };
        try { faces = THREE.ShapeUtils.triangulateShape(g.o.map(V), g.h.map((h) => h.map(V))); } catch (e) {}
        for (const [a, b, c] of faces) { const A = pts[a], B = pts[b], C = pts[c], cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); if ((cr > 0) === up) tri([A[0], A[1], z], [B[0], B[1], z], [C[0], C[1], z]); else tri([A[0], A[1], z], [C[0], C[1], z], [B[0], B[1], z]); }
      }
    };
    const walls = (F, z0, z1, pr) => {
      for (const g of regions(F, pr)) for (const L of [g.o, ...g.h]) for (let i = 0; i < L.length; i++) {
        const p = L[i], q = L[(i + 1) % L.length];
        tri([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1]);
        tri([p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]);
      }
    };
    const n = G.W * G.H;
    // each layer names the fields it is made from (indices into prims), in the same order
    const pr = (L) => L.p.map((i) => prims[i]), both = (A, B) => [...new Set([...A.p, ...B.p])].sort((a, b) => a - b).map((i) => prims[i]);
    cap(layers[0].F, layers[0].z0, false, pr(layers[0]));
    for (let k = 0; k < layers.length; k++) {
      walls(layers[k].F, layers[k].z0, layers[k].z1, pr(layers[k]));
      if (k + 1 < layers.length) {
        const A = layers[k].F, B = layers[k + 1].F, U = new Float32Array(n), D2 = new Float32Array(n);
        for (let i = 0; i < n; i++) { U[i] = Math.max(A[i], -B[i]); D2[i] = Math.max(B[i], -A[i]); }
        const pb = both(layers[k], layers[k + 1]);
        cap(U, layers[k].z1, true, pb); cap(D2, layers[k].z1, false, pb);
      }
    }
    const L = layers[layers.length - 1]; cap(L.F, L.z1, true, pr(L));
    return out;
  }

  // ------------------------------------------------------------ simple shapes' signed distance
  const sdBox = (x, y, cx, cy, hw, hh, r = 0) => { const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  const sdEll = (x, y, cx, cy, rx, ry) => { const k = Math.min(rx, ry); return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * k; };
  // a convex polygon (anticlockwise): the largest distance outside any edge
  const sdPoly = (x, y, P) => { let m = -Infinity; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1; const d = ((x - a[0]) * ey - (y - a[1]) * ex) / L; if (d > m) m = d; } return m; };

  return { rdpLoop, edt, thin, traceSkeleton, contours, rdp, chaikin, maskToPaths, pathDistance, shellSDF, shellMesh, extrudeField, stackLayers, sdBox, sdEll, sdPoly, isClosed };
})();
