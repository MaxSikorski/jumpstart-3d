/* ===== JumpStart 3D: more for the Floor Planner =====
   A third floor; floor openings (cut the floor of the level they are on); L-shaped, U-shaped and
   spiral stairs and outdoor steps; railings in eight styles; porches with posts, railings, steps and
   their own roof; arched doors and archways; and side panels that can be moved. Feet, y down the
   page in 2D; in 3D x across, y up, z = the page's y. */
(function () {
  const IN = 1 / 12;
  /* ---------------- a third floor ---------------- */
  LNM['2'] = '3rd floor'; if (!FH['2']) FH['2'] = 8;

  /* ---------------- the catalog ---------------- */
  const add = (cat, list) => { CAT[cat] = (CAT[cat] || []).concat(list); };
  add('Stairs', [
    I('stairs', 'L-Shaped Stairs 8×10', 96, 120, { p: 2600, sk: 'L' }),
    I('stairs', 'L-Shaped Stairs (left) 8×10', 96, 120, { p: 2600, sk: 'L', fl: 1 }),
    I('stairs', 'U-Shaped Stairs 8×10', 96, 120, { p: 3200, sk: 'U' }),
    I('stairs', 'Spiral Stairs 5 ft', 60, 60, { p: 2900, sk: 'spiral' }),
    I('stairs', 'Spiral Stairs 6 ft', 72, 72, { p: 3400, sk: 'spiral' }),
    I('steps', 'Outdoor Steps 4 ft (3 steps)', 48, 36, { p: 450, rise: 1.5 }),
    I('steps', 'Wide Outdoor Steps 8 ft', 96, 36, { p: 800, rise: 1.5 }),
    I('steps', 'Deck Steps 4 ft (5 steps)', 48, 60, { p: 650, rise: 2.5 }),
    I('fhole', 'Floor Opening 3×10 (stairwell)', 36, 120, { p: 0 }),
    I('fhole', 'Floor Opening 4×12 (stairwell)', 48, 144, { p: 0 }),
    I('fhole', 'Floor Opening 8×10 (L or U stairs)', 96, 120, { p: 0 }),
    I('fhole', 'Floor Opening 6×6 (spiral)', 72, 72, { p: 0 }),
    I('fhole', 'Open to Below 12×12', 144, 144, { p: 0 }),
  ]);
  const RS = { wood: ['Wood Baluster', '#f2efe8', '#f2efe8'], metal: ['Black Metal Baluster', '#2a2a2c', '#2a2a2c'], glass: ['Glass Panel', '#c9ccd0', '#bfe3f5'], cable: ['Cable', '#5b4636', '#9aa0a6'], bars: ['Modern Horizontal Bar', '#3a3d42', '#3a3d42'], colonial: ['Colonial Spindle', '#ffffff', '#ffffff'], iron: ['Wrought Iron', '#1d1d1f', '#1d1d1f'], pipe: ['Pipe Handrail', '#8d9298', '#8d9298'] };
  add('Railings', [
    ...Object.entries(RS).map(([k, v]) => I('rail', v[0] + ' Railing 8 ft', 96, 4, { p: 320, rs: k })),
    I('rail', 'Wood Baluster Railing 4 ft', 48, 4, { p: 170, rs: 'wood' }),
    I('rail', 'Glass Panel Railing 4 ft', 48, 4, { p: 260, rs: 'glass' }),
    I('rail', 'Black Metal Baluster Railing 12 ft', 144, 4, { p: 470, rs: 'metal' }),
  ]);
  add('Porches', [
    I('porchk', 'Porch 12×8 · Shed Roof', 144, 96, { p: 9800, pr: 'shed', ps: 'square', rs: 'wood' }),
    I('porchk', 'Porch 16×8 · Gable Roof', 192, 96, { p: 13500, pr: 'gable', ps: 'square', rs: 'wood' }),
    I('porchk', 'Porch 20×8 · Columns, Shed Roof', 240, 96, { p: 16500, pr: 'shed', ps: 'round', rs: 'colonial' }),
    I('porchk', 'Porch 24×8 · Hip Roof', 288, 96, { p: 19000, pr: 'hip', ps: 'craftsman', rs: 'wood' }),
    I('porchk', 'Porch 10×6 · Flat Roof', 120, 72, { p: 7200, pr: 'flat', ps: 'metal', rs: 'metal' }),
    I('porchk', 'Farmhouse Porch 30×8 · Shed Roof', 360, 96, { p: 21000, pr: 'shed', ps: 'square', rs: 'wood' }),
    I('porchk', 'Deck 12×12 (no roof)', 144, 144, { p: 5400, pr: 'none', ps: 'square', rs: 'wood' }),
    I('porchk', 'Deck 16×12 · Glass Railing', 192, 144, { p: 8800, pr: 'none', ps: 'metal', rs: 'glass' }),
  ]);
  CAT.Doors = (CAT.Doors || []).concat([
    I('door', 'Arched · Front Door 36"', 36, 6, { p: 1250, col: '#6b3e26', arch: 1, oh: 8 }),
    I('door', 'Arched · Double Entry 72"', 72, 6, { p: 2600, col: '#6b3e26', dbl: 1, arch: 1, oh: 8.5 }),
    I('door', 'Arched · Interior Door 32"', 32, 6, { p: 420, col: '#f1ece0', arch: 1, oh: 7.5 }),
    I('door', 'Arched · French Double 60"', 60, 6, { p: 1500, col: '#f1ece0', dbl: 1, arch: 1, oh: 8 }),
  ]);
  { const oc = Object.keys(CAT).find((c) => CAT[c].some((t) => t.k === 'open')) || 'Doors';
    CAT[oc] = CAT[oc].concat([I('open', 'Round Archway 48"', 48, 6, { p: 520, oh: 8, arch: 1 }), I('open', 'Round Archway 72"', 72, 6, { p: 680, oh: 8.5, arch: 1 })]); }
  Object.assign(HT, { rail: 3, porchk: 1.5, fhole: 0.02, steps: 1.5 });
  Object.assign(CL, { rail: '#f2efe8', porchk: '#9a7350', fhole: '#e8a317', steps: '#b08a5e' });

  /* ---------------- floor openings cut the floor of their own level ---------------- */
  // (the stairwell holes are worked out in floorHoles / ceilHoles, patched to call these)
  window.__fpHolesOn = (m) => (FLR[m] ? FLR[m].items.filter((t) => t.k === 'fhole') : []);

  /* ---------------- 2D symbols ---------------- */
  const hatch = (w, h, col) => { X.save(); X.beginPath(); X.rect(-w / 2, -h / 2, w, h); X.clip(); X.strokeStyle = col; for (let x = -w / 2 - h; x < w / 2 + h; x += 0.6) { X.beginPath(); X.moveTo(x, -h / 2); X.lineTo(x + h, h / 2); X.stroke(); } X.restore(); X.strokeRect(-w / 2, -h / 2, w, h); };
  const lbl = (txt, y, sz) => { X.save(); X.fillStyle = '#1d2b3a'; X.font = (sz || 0.7) + 'px sans-serif'; X.textAlign = 'center'; X.fillText(txt, 0, y || 0.25); X.restore(); };
  D.fhole = (w, h) => { X.save(); X.fillStyle = 'rgba(232,163,23,.18)'; X.fillRect(-w / 2, -h / 2, w, h); hatch(w, h, '#b07a0c'); lbl('OPEN BELOW', 0.25); X.restore(); };
  D.steps = (w, h, o) => { rr(-w / 2, -h / 2, w, h, '#d8c9a8'); const n = Math.max(2, Math.ceil(((o && o.rise) || 1.5) / 0.6)); for (let i = 1; i < n; i++) ln(-w / 2, -h / 2 + (h * i) / n, w / 2, -h / 2 + (h * i) / n); lbl('UP', h / 2 - 0.3, 0.6); };
  D.rail = (w, h, o) => { const S = RS[(o && o.rs) || 'wood'] || RS.wood; X.save(); X.fillStyle = S[1]; X.fillRect(-w / 2, -0.15, w, 0.3); X.strokeRect(-w / 2, -0.15, w, 0.3); X.fillStyle = '#1d2b3a'; const n = Math.max(1, Math.ceil(w / 6)); for (let i = 0; i <= n; i++) X.fillRect(-w / 2 + (w * i) / n - 0.15, -0.25, 0.3, 0.5); X.restore(); };
  D.porchk = (w, h, o) => {
    rr(-w / 2, -h / 2, w, h, '#c9a27a');
    X.save(); X.strokeStyle = 'rgba(29,43,58,.35)'; for (let y = -h / 2 + 0.5; y < h / 2; y += 0.5) ln(-w / 2, y, w / 2, y); X.restore();
    // posts along the front and sides (the back, at the top of the page, is against the house)
    X.save(); X.fillStyle = '#f4f1ea'; const n = Math.max(1, Math.ceil(w / 8)); for (let i = 0; i <= n; i++) { const x = -w / 2 + 0.4 + ((w - 0.8) * i) / n; X.fillRect(x - 0.3, h / 2 - 0.7, 0.6, 0.6); X.strokeRect(x - 0.3, h / 2 - 0.7, 0.6, 0.6); } X.restore();
    if (o && o.pr && o.pr !== 'none') { X.save(); X.setLineDash([0.5, 0.35]); X.strokeRect(-w / 2 - 1, -h / 2, w + 2, h + 1); X.restore(); }
    // steps out the front
    X.save(); X.fillStyle = '#d8c9a8'; X.fillRect(-2, h / 2, 4, 3); X.strokeRect(-2, h / 2, 4, 3); for (let i = 1; i < 3; i++) ln(-2, h / 2 + i, 2, h / 2 + i); X.restore();
    lbl(((o && o.pr) || 'shed') === 'none' ? 'DECK' : 'PORCH', 0.25, 0.8);
  };
  const _ds = D.stairs;
  D.stairs = (w, h, o) => {
    if (!o || !o.sk || o.sk === 'straight') return _ds(w, h, o);
    rr(-w / 2, -h / 2, w, h, '#efe6d2');
    X.save(); X.fillStyle = '#d8c9a8';
    if (o.sk === 'spiral') { const R = Math.min(w, h) / 2; X.beginPath(); X.arc(0, 0, R, 0, 7); X.fill(); X.stroke(); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ln(0, 0, Math.cos(a) * R, Math.sin(a) * R); } X.beginPath(); X.arc(0, 0, 0.3, 0, 7); X.fillStyle = '#3a3d42'; X.fill(); }
    else { for (const p of stairPlan(w, h, o)) { X.fillRect(p[0], p[1], p[2], p[3]); X.strokeRect(p[0], p[1], p[2], p[3]); } }
    X.restore(); lbl(o.dir === 'down' ? 'DOWN' : 'UP', h / 2 - 0.5, 0.6);
  };
  // the treads of L and U stairs in plan: [x, y, w, h] each, top of the page = the top step
  function stairPlan(w, h, o) {
    const out = [], f = o.sk === 'U' ? w / 2 - 0.1 : Math.min(3.5, w * 0.45), sgn = o.fl ? -1 : 1;
    if (o.sk === 'L') {
      const x0 = sgn > 0 ? w / 2 - f : -w / 2, n1 = Math.max(2, Math.round((h - f) / 0.92));
      for (let i = 0; i < n1; i++) out.push([x0, h / 2 - ((h - f) * (i + 1)) / n1, f, (h - f) / n1]);
      out.push([x0, -h / 2, f, f]);
      const n2 = Math.max(2, Math.round((w - f) / 0.92));
      for (let i = 0; i < n2; i++) out.push([sgn > 0 ? w / 2 - f - ((w - f) * (i + 1)) / n2 : -w / 2 + f + ((w - f) * i) / n2, -h / 2, (w - f) / n2, f]);
    } else {
      const n1 = Math.max(2, Math.round((h - f) / 0.92)), xa = sgn > 0 ? 0.1 : -w / 2, xb = sgn > 0 ? -w / 2 : 0.1;
      for (let i = 0; i < n1; i++) out.push([xa, h / 2 - ((h - f) * (i + 1)) / n1, f, (h - f) / n1]);
      out.push([-w / 2, -h / 2, w, f]);
      for (let i = 0; i < n1; i++) out.push([xb, -h / 2 + f + ((h - f) * i) / n1, f, (h - f) / n1]);
    }
    return out;
  }

  /* ---------------- 3D ---------------- */
  // L, U and spiral stairs (straight ones stay as they were)
  const _st3 = stairs3;
  stairs3 = function (g2, t, col) {
    if (!t.sk || t.sk === 'straight') return _st3(g2, t, col);
    const dir = dirOf(t, STL), rise = (dir === 'down' ? hOf(STL - 1) : hOf(STL)) + SLAB, base = dir === 'down' ? -rise : 0, n = Math.max(6, Math.round(rise / 0.62)), rh = rise / n;
    if (t.sk === 'spiral') {
      const R = Math.min(t.w, t.h) / 2;
      Cy(g2, 0.18, rise + 3, 0, base, 0, '#3a3d42');
      for (let i = 0; i < n - 1; i++) {
        const a = (t.fl ? -1 : 1) * i * (Math.PI * 2 / 13), e = B(g2, R * 0.98, 0.15, R * 0.5, 0, base + (i + 1) * rh - 0.15, 0, col);
        e.position.x = Math.cos(a) * R * 0.5; e.position.z = Math.sin(a) * R * 0.5; e.rotation.y = -a;
        const p = B(g2, 0.06, 3, 0.06, Math.cos(a) * (R - 0.1), base + (i + 1) * rh, Math.sin(a) * (R - 0.1), '#2a2a2c'); void p;
      }
      return;
    }
    // L and U: the plan's treads, each a block up to its own height
    const P = stairPlan(t.w, t.h, t);
    const order = t.sk === 'L' ? P : P;
    order.forEach((q, i) => {
      const top = Math.min(rise, ((i + 1) / order.length) * rise);
      const h3 = dir === 'down' ? Math.max(0.25, rise - top) : top;
      B(g2, q[2], h3, q[3], q[0] + q[2] / 2, base, q[1] + q[3] / 2, col);
    });
  };
  const stepCol = '#b08a5e';
  // outdoor steps: solid, climbing towards the top of the page
  M3.steps = (g, w, d, col, t) => { const rise = t.rise || 1.5, n = Math.max(2, Math.ceil(rise / 0.6)); for (let i = 0; i < n; i++) B(g, w, (rise * (i + 1)) / n, d / n, 0, 0, d / 2 - (d / n) * (i + 0.5), col || stepCol); };
  M3.fhole = () => {};
  // a railing: posts, a top and bottom rail, and the infill of its style, 3 ft tall
  function rail3(g, x0, z0, x1, z1, y, style) {
    const S = RS[style] || RS.wood, L = Math.hypot(x1 - x0, z1 - z0), ang = -Math.atan2(z1 - z0, x1 - x0), H = 3;
    if (L < 0.3) return;
    const grp = new THREE.Group(); grp.position.set(x0, y, z0); grp.rotation.y = ang; g.add(grp);
    const nP = Math.max(1, Math.ceil(L / 6)), pw = style === 'metal' || style === 'iron' || style === 'pipe' ? 0.16 : 0.3;
    for (let i = 0; i <= nP; i++) B(grp, pw, H + 0.2, pw, (L * i) / nP, 0, 0, S[1]);
    B(grp, L + pw, 0.15, style === 'colonial' ? 0.36 : 0.25, L / 2, H - 0.15, 0, S[1]);
    if (style === 'pipe') return;
    B(grp, L, 0.12, 0.2, L / 2, 0.3, 0, S[1]);
    if (style === 'glass') { for (let i = 0; i < nP; i++) B(grp, L / nP - pw - 0.1, H - 0.7, 0.04, (L * (i + 0.5)) / nP, 0.42, 0, 0, MT('#bfe3f5', { transparent: true, opacity: 0.45 })); return; }
    if (style === 'cable' || style === 'bars') { const k = style === 'cable' ? 8 : 4; for (let i = 1; i <= k; i++) B(grp, L, style === 'cable' ? 0.03 : 0.12, style === 'cable' ? 0.03 : 0.08, L / 2, 0.42 + ((H - 0.7) * i) / (k + 1), 0, S[2]); return; }
    const n = Math.max(1, Math.floor(L / (style === 'colonial' ? 0.42 : 0.38)));
    for (let i = 1; i < n; i++) { const x = (L * i) / n; if (style === 'colonial' || style === 'metal') Cy(grp, style === 'colonial' ? 0.075 : 0.03, H - 0.55, x, 0.4, 0, S[2]); else B(grp, style === 'iron' ? 0.06 : 0.12, H - 0.55, style === 'iron' ? 0.06 : 0.12, x, 0.4, 0, S[2]); }
    if (style === 'iron') B(grp, L, 0.05, 0.05, L / 2, 1.5, 0, S[2]);
  }
  M3.rail = (g, w, d, col, t) => rail3(g, -w / 2, 0, w / 2, 0, 0, t.rs || 'wood');
  // a porch: a deck, posts, beams, railings, steps and its own roof; the back (top of the page) is against the house
  M3.porchk = (g, w, d, col, t) => {
    const dh = t.dh || 1.5, ph = 8, pr = t.pr || 'shed', PS = { square: [0.45, '#f4f1ea'], round: [0.7, '#ffffff'], craftsman: [0.85, '#efe9dd'], metal: [0.3, '#2a2a2c'], log: [0.75, '#8a6038'] }[t.ps || 'square'] || [0.45, '#f4f1ea'];
    B(g, w, dh, d, 0, 0, 0, t.col || '#9a7350');
    for (let x = -w / 2 + 0.25; x < w / 2; x += 0.5) B(g, 0.02, 0.01, d, x, dh, 0, '#7d5c3f');
    const roofed = pr !== 'none', front = d / 2 - PS[0] / 2 - 0.1, n = Math.max(1, Math.ceil(w / 8)), posts = [];
    for (let i = 0; i <= n; i++) posts.push([-w / 2 + PS[0] / 2 + 0.1 + ((w - PS[0] - 0.2) * i) / n, front]);
    if (d > 9) for (const sx of [-1, 1]) posts.push([sx * (w / 2 - PS[0] / 2 - 0.1), 0]);
    if (roofed) for (const [x, z] of posts) {
      if (t.ps === 'round' || t.ps === 'log') Cy(g, PS[0] / 2, ph, x, dh, z, PS[1]);
      else if (t.ps === 'craftsman') { B(g, PS[0] + 0.3, ph * 0.38, PS[0] + 0.3, x, dh, z, '#8c8478'); B(g, PS[0] * 0.75, ph * 0.62, PS[0] * 0.75, x, dh + ph * 0.38, z, PS[1]); }
      else B(g, PS[0], ph, PS[0], x, dh, z, PS[1]);
    }
    if (roofed) { B(g, w, 0.65, PS[0], 0, dh + ph, front, PS[1]); for (const sx of [-1, 1]) B(g, PS[0], 0.65, d, sx * (w / 2 - PS[0] / 2 - 0.1), dh + ph, 0, PS[1]); }
    // railings round the front and sides, with a gap for the steps
    if (t.rs && t.rs !== 'none' && dh >= 0.5) {
      const y = dh, e = 0.15, sw = 4.5;
      rail3(g, -w / 2 + e, -d / 2 + e, -w / 2 + e, d / 2 - e, y, t.rs); rail3(g, w / 2 - e, -d / 2 + e, w / 2 - e, d / 2 - e, y, t.rs);
      rail3(g, -w / 2 + e, d / 2 - e, -sw / 2, d / 2 - e, y, t.rs); rail3(g, sw / 2, d / 2 - e, w / 2 - e, d / 2 - e, y, t.rs);
    }
    // steps down at the front
    if (dh >= 0.5) { const nS = Math.max(2, Math.ceil(dh / 0.6)), run = nS * 0.85; for (let i = 0; i < nS - 0; i++) B(g, 4, (dh * (nS - i)) / (nS + 1), 0.85, 0, 0, d / 2 + 0.85 * (i + 0.5), stepCol); void run; }
    // the roof, over the deck with an overhang (shed: high at the house)
    if (roofed) {
      const o = 1, W = w + 2 * o, Dd = d + o, z0 = dh + ph + 0.65, rc = t.rc || '#5a4a42', T = THREE;
      let geo;
      if (pr === 'flat') { B(g, W, 0.4, Dd, 0, z0, o / 2, rc); return; }
      if (pr === 'shed') { const rise = Dd * 0.3, sh = new T.Shape([new T.Vector2(0, 0), new T.Vector2(Dd, 0), new T.Vector2(Dd, 0.35), new T.Vector2(0, rise + 0.35), new T.Vector2(0, rise)]); geo = new T.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }); geo.rotateY(Math.PI / 2); geo.translate(-W / 2, z0, -d / 2); }
      else if (pr === 'gable') { const rise = W * 0.32, sh = new T.Shape([new T.Vector2(-W / 2, 0), new T.Vector2(W / 2, 0), new T.Vector2(0, rise)]); geo = new T.ExtrudeGeometry(sh, { depth: Dd, bevelEnabled: false }); geo.translate(0, z0, -d / 2); }
      else { geo = new T.ConeGeometry(Math.SQRT1_2, 1, 4, 1); geo.rotateY(Math.PI / 4); geo.scale(W, Math.min(W, Dd) * 0.35, Dd); geo.translate(0, z0 + Math.min(W, Dd) * 0.175, o / 2); }
      const m = new T.Mesh(geo, MT(rc)); g.add(m);
    }
  };
  // arched doors: a frame round the arch, leaves with round tops
  window.archDoor3 = function (g, t) {
    const T = THREE, dc = t.col || '#8b5a2b', H = t.oh || 8, r = t.w / 2, ys = Math.max(0.5, H - r), fw = 0.15, N = 24;
    const arc = (R, cx) => { const p = []; for (let i = 0; i <= N; i++) { const a = Math.PI - (i / N) * Math.PI; p.push(new T.Vector2(cx + R * Math.cos(a), ys + R * Math.sin(a))); } return p; };
    const fr = new T.Shape([new T.Vector2(-r - fw, 0), ...arc(r + fw, 0), new T.Vector2(r + fw, 0), new T.Vector2(r, 0), ...arc(r, 0).reverse(), new T.Vector2(-r, 0)]);
    const fg = new T.ExtrudeGeometry(fr, { depth: 0.5, bevelEnabled: false }); fg.translate(0, 0, -0.25); g.add(new T.Mesh(fg, MT('#f1ece0')));
    const leaf = (x0, x1) => { const pts = [new T.Vector2(x0, 0)]; for (const q of arc(r - 0.02, 0)) if (q.x >= x0 - 0.01 && q.x <= x1 + 0.01) pts.push(q); pts.push(new T.Vector2(x1, ys + Math.sqrt(Math.max(0, (r - 0.02) ** 2 - x1 * x1))), new T.Vector2(x1, 0)); const lg = new T.ExtrudeGeometry(new T.Shape(pts), { depth: 0.13, bevelEnabled: false }); lg.translate(0, 0, -0.065); g.add(new T.Mesh(lg, MT(dc))); };
    if (t.dbl) { leaf(-r + 0.02, -0.02); leaf(0.02, r - 0.02); B(g, 0.1, 0.1, 0.35, -0.25, 3, 0, '#c9b037'); B(g, 0.1, 0.1, 0.35, 0.25, 3, 0, '#c9b037'); }
    else { leaf(-r + 0.02, r - 0.02); B(g, 0.1, 0.1, 0.35, r - 0.3, 3, 0, '#c9b037'); }
    if (/French/.test(t.n)) for (const sx of t.dbl ? [-1, 1] : [0]) B(g, r * 0.6, ys * 0.7, 0.15, sx * r / 2, 1.2, 0, 0, MT('#bfe3f5', { transparent: true, opacity: 0.5 }));
  };
  // doors and archways: the wall opening reaches the arch's top
  holes = function (a, b, L) {
    const h = [];
    for (const t of items) {
      if (!/^(door|win|open)$/.test(t.k)) continue;
      const n = nearSeg(a, b, t); if (n.d > 0.4) continue;
      const s = n.u * L;
      h.push({ s0: Math.max(0, s - t.w / 2), s1: Math.min(L, s + t.w / 2), y0: t.k === 'win' ? 2.8 : 0, y1: t.k === 'open' ? (t.oh || 6.8) : t.arch ? (t.oh || 8) : 6.8, arch: !!t.arch && t.k !== 'win' });
    }
    return h.sort((p, q) => p.s0 - q.s0);
  };

  /* ---------------- movable side panels ---------------- */
  const panels = [['left', 'Tools'], ['right', 'Blueprint list']];
  const css = document.createElement('style');
  css.textContent = '.fp-grip{display:flex;align-items:center;gap:6px;margin:-4px -4px 8px;padding:4px 6px;border:1px dashed #2a5d94;border-radius:4px;cursor:move;font-size:11px;color:#9fc6ee;user-select:none;-webkit-user-select:none;touch-action:none}.fp-grip button{margin-left:auto;font-size:11px;padding:2px 6px}aside.fp-float{position:fixed!important;z-index:40;box-shadow:0 10px 30px rgba(0,0,0,.5);border:1px solid #9fd0ff!important;border-radius:8px;max-height:80vh;resize:both;overflow:auto}';
  document.head.appendChild(css);
  const keyOf = (id) => 'fpPanel.' + id;
  function grip(el, id, name) {
    if (el.querySelector(':scope > .fp-grip')) return;
    const gp = document.createElement('div'); gp.className = 'fp-grip'; gp.title = 'Drag to move this panel anywhere; Dock puts it back';
    gp.innerHTML = '<span aria-hidden="true">⠿</span><span>Move ' + name + '</span>' + (el.classList.contains('fp-float') ? '<button class="b" type="button" data-dock>Dock</button>' : '');
    el.insertBefore(gp, el.firstChild);
    gp.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      if (!el.classList.contains('fp-float')) { el.classList.add('fp-float'); el.style.width = r.width + 'px'; el.style.height = Math.min(r.height, innerHeight * 0.75) + 'px'; if (!gp.querySelector('[data-dock]')) gp.insertAdjacentHTML('beforeend', '<button class="b" type="button" data-dock>Dock</button>'); setTimeout(() => { try { draw(); } catch (er) { /* not ready */ } }, 0); }
      gp.setPointerCapture(e.pointerId);
      const mv = (ev) => { el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px'; };
      mv(e);
      const up = () => { gp.removeEventListener('pointermove', mv); gp.removeEventListener('pointerup', up); save(el, id); };
      gp.addEventListener('pointermove', mv); gp.addEventListener('pointerup', up);
    });
    gp.addEventListener('click', (e) => { if (e.target.closest('[data-dock]')) dock(el, id); });
  }
  function save(el, id) { try { localStorage.setItem(keyOf(id), JSON.stringify({ l: el.style.left, t: el.style.top, w: el.style.width, h: el.style.height })); } catch (e) { /* private */ } }
  function dock(el, id) { el.classList.remove('fp-float'); el.style.left = el.style.top = el.style.width = el.style.height = ''; try { localStorage.removeItem(keyOf(id)); } catch (e) { /* private */ } refresh(); }
  function refresh() { for (const [id, name] of panels) { const el = document.getElementById(id); if (!el) continue; const g0 = el.querySelector(':scope > .fp-grip'); if (g0) g0.remove(); grip(el, id, name); } try { draw(); } catch (e) { /* not ready */ } }
  for (const [id, name] of panels) {
    const el = document.getElementById(id); if (!el) continue;
    try { const p = JSON.parse(localStorage.getItem(keyOf(id)) || 'null'); if (p) { el.classList.add('fp-float'); el.style.left = p.l; el.style.top = p.t; el.style.width = p.w; el.style.height = p.h; } } catch (e) { /* private */ }
    grip(el, id, name);
    // the panel's contents are redrawn often: put the grip back each time
    new MutationObserver(() => grip(el, id, name)).observe(el, { childList: true });
  }
  window.__fpPanels = { dock: (id) => { const el = document.getElementById(id); if (el) dock(el, id); } };
})();
