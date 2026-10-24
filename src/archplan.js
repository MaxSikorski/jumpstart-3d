// Architect floor plans: the walls of a level drawn from above the way plans are drawn (solid walls,
// door swings, windows, dimensions and a title), saved as PDF, SVG or DXF. Plan coordinates are
// millimetres, Y up. No libraries: the three formats are written directly.

// ------------------------------------------------------------------ the drawing
// A: the building (doc.arch); lvl: a level id; o: { fmt (length → text), dims, swings, presets,
// winfo (wall → {L, ux, uy, nx, ny}), wallExt, goodOpenings }
export function planDrawing(A, lvl, o) {
  const items = [], ws = A.walls.filter((w) => w.lvl === lvl);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const w of ws) for (const p of [w.a, w.b]) { bx0 = Math.min(bx0, p[0] - w.t / 2); by0 = Math.min(by0, p[1] - w.t / 2); bx1 = Math.max(bx1, p[0] + w.t / 2); by1 = Math.max(by1, p[1] + w.t / 2); }
  o = { ...o, skipLen: (w, len) => { const { ux, uy } = o.winfo(w); return (Math.abs(uy) < 1e-6 && Math.abs(len - (bx1 - bx0)) < 2) || (Math.abs(ux) < 1e-6 && Math.abs(len - (by1 - by0)) < 2); } };
  const poly = (pts, layer) => items.push({ t: "poly", pts, layer });
  const line = (a, b, layer, dash) => items.push({ t: "line", a, b, layer, dash });
  const arc = (c, r, a0, a1, layer) => items.push({ t: "arc", c, r, a0, a1, layer });
  const text = (p, s, h, layer, anchor = "middle", ang = 0) => items.push({ t: "text", p, s, h, layer, anchor, ang });
  let cx = 0, cy = 0; for (const w of ws) { cx += (w.a[0] + w.b[0]) / 2 / (ws.length || 1); cy += (w.a[1] + w.b[1]) / 2 / (ws.length || 1); }
  for (const w of ws) {
    const { L, ux, uy, nx, ny } = o.winfo(w), e = o.wallExt(A.walls, w), t = w.t, ops = (w.h > 0 ? o.goodOpenings(A, w).ok : []).slice().sort((p, q) => p.s - q.s);
    const P = (u, v) => [w.a[0] + ux * u + nx * v, w.a[1] + uy * u + ny * v];
    // the solid parts of the wall, between the openings (only openings that reach the cut height)
    const cuts = ops.filter((q) => q.sill < 1200 && q.sill + q.h > 900 || q.sill < 1);
    let u = -e[0];
    for (const q of cuts) { if (q.s - u > 1) poly([P(u, -t / 2), P(q.s, -t / 2), P(q.s, t / 2), P(u, t / 2)], "WALLS"); u = Math.max(u, q.s + q.w); }
    if (L + e[1] - u > 1) poly([P(u, -t / 2), P(L + e[1], -t / 2), P(L + e[1], t / 2), P(u, t / 2)], "WALLS");
    // which side is outside: a ray from the middle of the wall that meets no other wall
    const mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
    const hits = (sg) => ws.some((q) => {
      if (q === w) return false;
      const ox = mx + nx * sg * (t / 2 + 1), oy = my + ny * sg * (t / 2 + 1), ex = q.b[0] - q.a[0], ey = q.b[1] - q.a[1], dx = nx * sg, dy = ny * sg;
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) return false;
      const ax = q.a[0] - ox, ay = q.a[1] - oy, tt = (ax * ey - ay * ex) / den, uu = (ax * dy - ay * dx) / den;
      return tt > 0 && uu >= -0.02 && uu <= 1.02;
    });
    const hp = hits(1), hn = hits(-1), exterior = !(hp && hn);
    const out = exterior ? (hp ? -1 : 1) : (mx - cx) * nx + (my - cy) * ny >= 0 ? 1 : -1;
    for (const q of cuts) {
      const Pr = o.presets[q.preset] || {}, s0 = q.s, s1 = q.s + q.w;
      if (q.k === "window") {
        line(P(s0, -t / 2), P(s1, -t / 2), "WINDOWS"); line(P(s0, t / 2), P(s1, t / 2), "WINDOWS"); line(P(s0, 0), P(s1, 0), "WINDOWS");
        line(P(s0, -t / 2), P(s0, t / 2), "WINDOWS"); line(P(s1, -t / 2), P(s1, t / 2), "WINDOWS");
        continue;
      }
      // doors: the frame ends, then the swing
      line(P(s0, -t / 2), P(s0, t / 2), "DOORS"); line(P(s1, -t / 2), P(s1, t / 2), "DOORS");
      if (!o.swings) continue;
      const side = (q.swing === "b" ? 1 : -1) * 1, face = side * t / 2;
      const swing = (hu, dir, len) => {
        const h = P(hu, face), tip = P(hu, face + side * len), end = P(hu + dir * len, face);
        line(h, tip, "DOORS");
        const a0 = Math.atan2(tip[1] - h[1], tip[0] - h[0]), a1 = Math.atan2(end[1] - h[1], end[0] - h[0]);
        let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        arc(h, len, d > 0 ? a0 : a0 + d, d > 0 ? a0 + d : a0, "DOORS");
      };
      if (Pr.kind === "double") { swing(s0, 1, q.w / 2); swing(s1, -1, q.w / 2); }
      else if (Pr.kind === "single" || Pr.kind === "front" || !Pr.kind) { if (q.hingeR) swing(s1, -1, q.w); else swing(s0, 1, q.w); }
      else if (Pr.kind === "slider") { line(P(s0, -t / 6), P((s0 + s1) / 2 + 40, -t / 6), "DOORS"); line(P((s0 + s1) / 2 - 40, t / 6), P(s1, t / 6), "DOORS"); }
      else if (Pr.kind === "garage") line(P(s0, out * t / 2), P(s1, out * t / 2), "DOORS", true);
      else if (Pr.kind === "bifold") { const k = q.w / 4; for (let i = 0; i < 4; i++) line(P(s0 + i * k, face + side * (i % 2 ? 0 : k * 0.5)), P(s0 + (i + 1) * k, face + side * (i % 2 ? k * 0.5 : 0)), "DOORS"); }
    }
    // the wall's length, outside it
    if (o.dims && exterior && !o.skipLen(w, L + e[0] + e[1])) {
      const off = out * (t / 2 + 350), a = P(-e[0], off), b = P(L + e[1], off);
      line(a, b, "DIMS"); line(P(-e[0], out * t / 2 + out * 100), P(-e[0], off + out * 120), "DIMS"); line(P(L + e[1], out * t / 2 + out * 100), P(L + e[1], off + out * 120), "DIMS");
      let ang = Math.atan2(uy, ux); if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI; if (ang <= -Math.PI / 2 + 1e-6) ang += Math.PI;
      text(P((L + e[1] - e[0]) / 2, off + out * 180), o.fmt(L + e[0] + e[1]), 220, "DIMS", "middle", ang);
    }
  }
  // overall size
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of ws) for (const p of [w.a, w.b]) { x0 = Math.min(x0, p[0] - w.t / 2); y0 = Math.min(y0, p[1] - w.t / 2); x1 = Math.max(x1, p[0] + w.t / 2); y1 = Math.max(y1, p[1] + w.t / 2); }
  if (!isFinite(x0)) return { items, box: null };
  if (o.dims) {
    const yD = y0 - 1100, xD = x1 + 1100;
    line([x0, yD], [x1, yD], "DIMS"); line([x0, yD - 150], [x0, y0 - 150], "DIMS"); line([x1, yD - 150], [x1, y0 - 150], "DIMS");
    text([(x0 + x1) / 2, yD - 350], o.fmt(x1 - x0), 260, "DIMS");
    line([xD, y0], [xD, y1], "DIMS"); line([xD + 150, y0], [x1 + 150, y0], "DIMS"); line([xD + 150, y1], [x1 + 150, y1], "DIMS");
    text([xD + 350, (y0 + y1) / 2], o.fmt(y1 - y0), 260, "DIMS", "middle", Math.PI / 2);
  }
  // everything drawn, for the page
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (p) => { box.x0 = Math.min(box.x0, p[0]); box.y0 = Math.min(box.y0, p[1]); box.x1 = Math.max(box.x1, p[0]); box.y1 = Math.max(box.y1, p[1]); };
  for (const it of items) { if (it.t === "poly") it.pts.forEach(grow); else if (it.t === "line") { grow(it.a); grow(it.b); } else if (it.t === "arc") { grow([it.c[0] - it.r, it.c[1] - it.r]); grow([it.c[0] + it.r, it.c[1] + it.r]); } else grow(it.p); }
  return { items, box };
}

// ------------------------------------------------------------------ pages
export const PAPERS = { letter: { name: "Letter (11 × 8½ in)", w: 279.4, h: 215.9 }, tabloid: { name: "Tabloid (17 × 11 in)", w: 431.8, h: 279.4 }, a4: { name: "A4", w: 297, h: 210 }, a3: { name: "A3", w: 420, h: 297 } };
// sheets: [{ title, sub, drawing }]; scale: "fit" or N (1:N). Each sheet gets a page; the drawing is
// centered in the area above the title strip. Returns per page: { map(p) → paper mm, k, items }
function layout(sheets, paper, scale) {
  const P = PAPERS[paper] || PAPERS.letter, m = 12, strip = 16, W = P.w - 2 * m, H = P.h - 2 * m - strip;
  return sheets.map((sh) => {
    const b = sh.drawing.box || { x0: 0, y0: 0, x1: 1000, y1: 1000 }, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const k = scale === "fit" ? Math.min(W / bw, H / bh) : 1 / scale;
    const ox = m + (W - bw * k) / 2, oy = m + strip + (H - bh * k) / 2;
    return { ...sh, P, m, strip, k, map: (p) => [ox + (p[0] - b.x0) * k, oy + (p[1] - b.y0) * k], fits: bw * k <= W + 0.01 && bh * k <= H + 0.01 };
  });
}
const STYLE = { WALLS: { fill: "#2b2f36", w: 0.25, c: "#2b2f36" }, DOORS: { w: 0.3, c: "#9b4a1f" }, WINDOWS: { w: 0.25, c: "#1f6fb0" }, DIMS: { w: 0.18, c: "#4a5565" }, TEXT: { c: "#1d2430" } };
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
const r3 = (v) => +v.toFixed(3);

// ------------------------------------------------------------------ SVG (one sheet per page, side by side)
export function planSVG(sheets, paper, scale) {
  const pages = layout(sheets, paper, scale), P = pages[0].P, gap = 10, totalW = pages.length * P.w + (pages.length - 1) * gap;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${r3(totalW)}mm" height="${r3(P.h)}mm" viewBox="0 0 ${r3(totalW)} ${r3(P.h)}" font-family="Helvetica, Arial, sans-serif">`];
  pages.forEach((pg, n) => {
    const X = n * (P.w + gap), f = (p) => { const q = pg.map(p); return [r3(X + q[0]), r3(P.h - q[1])]; };
    out.push(`<g id="${esc(pg.title)}"><rect x="${X}" y="0" width="${P.w}" height="${P.h}" fill="#fff" stroke="#c9ced6" stroke-width="0.3"/>`);
    for (const it of pg.drawing.items) {
      const S = STYLE[it.layer] || STYLE.DIMS;
      if (it.t === "poly") out.push(`<polygon points="${it.pts.map((p) => f(p).join(",")).join(" ")}" fill="${S.fill || "none"}" stroke="${S.c}" stroke-width="${S.w}"/>`);
      else if (it.t === "line") { const a = f(it.a), b = f(it.b); out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${S.c}" stroke-width="${S.w}"${it.dash ? ' stroke-dasharray="1.5 1"' : ""}/>`); }
      else if (it.t === "arc") { const a = f([it.c[0] + it.r * Math.cos(it.a0), it.c[1] + it.r * Math.sin(it.a0)]), b = f([it.c[0] + it.r * Math.cos(it.a1), it.c[1] + it.r * Math.sin(it.a1)]), r = r3(it.r * pg.k); out.push(`<path d="M${a[0]} ${a[1]} A${r} ${r} 0 0 1 ${b[0]} ${b[1]}" fill="none" stroke="${S.c}" stroke-width="${S.w * 0.8}" stroke-dasharray="1 0.8"/>`); }
      else { const p = f(it.p), h = r3(Math.max(1.6, Math.min(3.2, it.h * pg.k))); out.push(`<text x="${p[0]}" y="${p[1]}" font-size="${h}" fill="${STYLE.TEXT.c}" text-anchor="${it.anchor}" dominant-baseline="middle"${it.ang ? ` transform="rotate(${r3((-it.ang * 180) / Math.PI)} ${p[0]} ${p[1]})"` : ""}>${esc(it.s)}</text>`); }
    }
    out.push(`<line x1="${X + pg.m}" y1="${P.h - pg.m - pg.strip + 4}" x2="${X + P.w - pg.m}" y2="${P.h - pg.m - pg.strip + 4}" stroke="#2b2f36" stroke-width="0.3"/>`);
    out.push(`<text x="${X + pg.m}" y="${P.h - pg.m - 4}" font-size="5" font-weight="bold" fill="#1d2430">${esc(pg.title)}</text>`);
    out.push(`<text x="${X + P.w - pg.m}" y="${P.h - pg.m - 4}" font-size="3.4" fill="#4a5565" text-anchor="end">${esc(pg.sub)}</text></g>`);
  });
  out.push("</svg>");
  return new TextEncoder().encode(out.join("\n"));
}

// ------------------------------------------------------------------ PDF (one page per sheet)
export function planPDF(sheets, paper, scale) {
  const pages = layout(sheets, paper, scale), pt = 72 / 25.4, enc = new TextEncoder();
  const hex = (c) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
  const ps = (t) => "(" + String(t).replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, (c) => ({ "×": "x", "½": "1/2", "¼": "1/4", "¾": "3/4", "′": "'", "″": '"', "—": "-", "–": "-", "·": "-" })[c] || "?") + ")";
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesId = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"), fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const kids = [];
  for (const pg of pages) {
    const W = pg.P.w * pt, H = pg.P.h * pt, f = (p) => pg.map(p).map((v) => r3(v * pt)), c = [];
    c.push("1 1 1 rg 0 0 " + r3(W) + " " + r3(H) + " re f");
    for (const it of pg.drawing.items) {
      const S = STYLE[it.layer] || STYLE.DIMS;
      c.push(`${hex(S.c)} RG ${r3(S.w * pt)} w ${it.dash ? "[2 1.5] 0 d" : "[] 0 d"}`);
      if (it.t === "poly") { const q = it.pts.map(f); c.push(`${hex(S.fill || "#ffffff")} rg ${q[0][0]} ${q[0][1]} m ${q.slice(1).map((p) => `${p[0]} ${p[1]} l`).join(" ")} h B`); }
      else if (it.t === "line") { const a = f(it.a), b = f(it.b); c.push(`${a[0]} ${a[1]} m ${b[0]} ${b[1]} l S`); }
      else if (it.t === "arc") {
        // arcs as short straight pieces
        const n = 16, pts = []; for (let i = 0; i <= n; i++) { const a = it.a0 + ((it.a1 - it.a0) * i) / n; pts.push(f([it.c[0] + it.r * Math.cos(a), it.c[1] + it.r * Math.sin(a)])); }
        c.push(`[1.5 1.2] 0 d ${pts[0][0]} ${pts[0][1]} m ${pts.slice(1).map((p) => `${p[0]} ${p[1]} l`).join(" ")} S`);
      } else {
        const p = f(it.p), h = Math.max(1.6, Math.min(3.2, it.h * pg.k)) * pt, cs = Math.cos(it.ang || 0), sn = Math.sin(it.ang || 0), wEst = String(it.s).length * h * 0.5;
        const dx = it.anchor === "middle" ? -wEst / 2 : it.anchor === "end" ? -wEst : 0;
        c.push(`BT ${hex(STYLE.TEXT.c)} rg /F1 ${r3(h)} Tf ${r3(cs)} ${r3(sn)} ${r3(-sn)} ${r3(cs)} ${r3(p[0] + dx * cs + (h * 0.35) * sn)} ${r3(p[1] + dx * sn - (h * 0.35) * cs)} Tm ${ps(it.s)} Tj ET`);
      }
    }
    const m = pg.m * pt, sy = (pg.m + pg.strip - 4) * pt;
    c.push(`[] 0 d ${hex("#2b2f36")} RG 0.85 w ${r3(m)} ${r3(sy)} m ${r3(W - m)} ${r3(sy)} l S`);
    c.push(`BT ${hex("#1d2430")} rg /F2 14 Tf ${r3(m)} ${r3(m + 8)} Td ${ps(pg.title)} Tj ET`);
    const subW = String(pg.sub).length * 9.6 * 0.5;
    c.push(`BT ${hex("#4a5565")} rg /F1 9.6 Tf ${r3(W - m - subW)} ${r3(m + 8)} Td ${ps(pg.sub)} Tj ET`);
    const stream = c.join("\n");
    const cont = add(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${r3(W)} ${r3(H)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R >> >> /Contents ${cont} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const parts = [enc.encode("%PDF-1.4\n")], offs = [];
  let len = parts[0].length;
  objs.forEach((o, i) => { const b = enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`); offs.push(len); parts.push(b); len += b.length; });
  void body;
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info << /Producer (JumpStart 3D) /Title ${ps(pages[0].title)} >> >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ DXF (R12, full size; levels side by side)
// inch: write inches (and say so); otherwise millimetres
export function planDXF(sheets, inch) {
  const k = inch ? 1 / 25.4 : 1, L = [], v = (x) => r3(x * k);
  const g = (code, val) => L.push(String(code), String(val));
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, inch ? 1 : 4); g(9, "$MEASUREMENT"); g(70, inch ? 0 : 1); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, 6);
  for (const [n, c] of [["0", 7], ["WALLS", 7], ["DOORS", 1], ["WINDOWS", 4], ["DIMS", 3], ["TEXT", 7]]) { g(0, "LAYER"); g(2, n); g(70, 0); g(62, c); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  let ox = 0;
  for (const sh of sheets) {
    const b = sh.drawing.box || { x0: 0, y0: 0, x1: 0, y1: 0 }, dx = ox - b.x0, dy = -b.y0, P = (p) => [p[0] + dx, p[1] + dy];
    for (const it of sh.drawing.items) {
      if (it.t === "poly") {
        // walls: filled quads (SOLID corners go 1, 2, 4, 3) and their outline
        const q = it.pts.map(P);
        if (q.length === 4) { g(0, "SOLID"); g(8, it.layer); [[q[0], 10], [q[1], 11], [q[3], 12], [q[2], 13]].forEach(([p, c]) => { g(c, v(p[0])); g(c + 10, v(p[1])); g(c + 20, 0); }); }
        for (let i = 0; i < q.length; i++) { const a = q[i], c = q[(i + 1) % q.length]; g(0, "LINE"); g(8, it.layer); g(10, v(a[0])); g(20, v(a[1])); g(30, 0); g(11, v(c[0])); g(21, v(c[1])); g(31, 0); }
      } else if (it.t === "line") { const a = P(it.a), c = P(it.b); g(0, "LINE"); g(8, it.layer); g(10, v(a[0])); g(20, v(a[1])); g(30, 0); g(11, v(c[0])); g(21, v(c[1])); g(31, 0); }
      else if (it.t === "arc") { const c = P(it.c); g(0, "ARC"); g(8, it.layer); g(10, v(c[0])); g(20, v(c[1])); g(30, 0); g(40, v(it.r)); g(50, r3((it.a0 * 180) / Math.PI)); g(51, r3((it.a1 * 180) / Math.PI)); }
      else { const p = P(it.p); g(0, "TEXT"); g(8, it.layer === "DIMS" ? "DIMS" : "TEXT"); g(10, v(p[0])); g(20, v(p[1])); g(30, 0); g(40, v(it.h)); g(1, String(it.s).replace(/[^\x20-\x7e]/g, (c) => ({ "×": "x", "½": "1/2" })[c] || "?")); if (it.ang) g(50, r3((it.ang * 180) / Math.PI)); g(72, it.anchor === "middle" ? 1 : it.anchor === "end" ? 2 : 0); g(11, v(p[0])); g(21, v(p[1])); g(31, 0); g(73, 2); }
    }
    // the sheet's title under it
    g(0, "TEXT"); g(8, "TEXT"); g(10, v(ox)); g(20, v(-1800)); g(30, 0); g(40, v(400)); g(1, String(sh.title + " - " + sh.sub).replace(/[^\x20-\x7e]/g, "-"));
    ox += (b.x1 - b.x0) + 4000;
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return new TextEncoder().encode(L.join("\r\n") + "\r\n");
}
