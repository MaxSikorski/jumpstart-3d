// Themed textures: seasons, holidays, celebrations and animals. Each is a tiling pattern of little
// raised pictures (snowflakes, leaves, snowmen, pumpkins, squirrels…) drawn with the canvas the
// first time it is needed, then softened a little so the edges are rounded when printed.
// Pictures are drawn in a 100 × 100 box centred on 0, 0 (y down, like an image), white = raised;
// "cut" draws black (holes and grooves inside a picture, like a pumpkin's face).

export const THEME_CATS = [["season", "Seasons"], ["holiday", "Holidays"], ["party", "Celebrations"], ["animal", "Animals"]];

// ------------------------------------------------------------------ drawing helpers
function pen(g) {
  const W = "#fff", B = "#000";
  const D = {
    g,
    fill(c) { g.fillStyle = c ? B : W; g.strokeStyle = c ? B : W; },
    // ellipse, circle, polygon, rounded rectangle, a thick line through points (round ends)
    E(x, y, rx, ry, rot = 0, cut = false) { D.fill(cut); g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); },
    C(x, y, r, cut = false) { D.E(x, y, r, r, 0, cut); },
    P(pts, cut = false) { D.fill(cut); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); },
    R(x, y, w, h, r = 0, cut = false) { D.fill(cut); g.beginPath(); if (g.roundRect) g.roundRect(x - w / 2, y - h / 2, w, h, r); else g.rect(x - w / 2, y - h / 2, w, h); g.fill(); },
    L(pts, w, cut = false) { D.fill(cut); g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); },
    // a smooth curve through points (quadratic midpoints), stroked
    Q(pts, w, cut = false) {
      D.fill(cut); g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
      const n = pts[pts.length - 1]; g.lineTo(n[0], n[1]); g.stroke();
    },
    // an SVG path, filled
    S(d, cut = false) { D.fill(cut); g.fill(new Path2D(d)); },
    star(x, y, R, r, n = 5, rot = -Math.PI / 2, cut = false) { const p = []; for (let i = 0; i < 2 * n; i++) { const a = rot + (i * Math.PI) / n, q = i % 2 ? r : R; p.push([x + q * Math.cos(a), y + q * Math.sin(a)]); } D.P(p, cut); },
    heart(x, y, s, cut = false) { D.S(`M ${x} ${y + 0.9 * s} C ${x - 1.25 * s} ${y + 0.05 * s} ${x - 0.95 * s} ${y - 0.95 * s} ${x} ${y - 0.4 * s} C ${x + 0.95 * s} ${y - 0.95 * s} ${x + 1.25 * s} ${y + 0.05 * s} ${x} ${y + 0.9 * s} Z`, cut); },
  };
  return D;
}

// ------------------------------------------------------------------ the pictures
const M = {
  snowflake(d) {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a), at = (t, o) => [t * c - o * s, t * s + o * c];
      d.L([[0, 0], at(46, 0)], 6);
      for (const [t, l] of [[18, 13], [31, 10], [41, 6]]) { d.L([at(t, 0), at(t + l * 0.7, l)], 4.5); d.L([at(t, 0), at(t + l * 0.7, -l)], 4.5); }
    }
    d.C(0, 0, 8); d.C(0, 0, 3.5, true);
  },
  maple(d) {
    d.S("M0 46 L3 22 C14 28 26 30 34 26 C30 20 28 16 30 10 C36 12 42 10 46 4 C38 0 34 -6 36 -14 C28 -12 22 -16 20 -24 C16 -18 10 -16 6 -18 C8 -28 6 -40 0 -48 C-6 -40 -8 -28 -6 -18 C-10 -16 -16 -18 -20 -24 C-22 -16 -28 -12 -36 -14 C-34 -6 -38 0 -46 4 C-42 10 -36 12 -30 10 C-28 16 -30 20 -34 26 C-26 30 -14 28 -3 22 Z");
    d.L([[0, 40], [0, -36]], 2.4, true); d.L([[0, 10], [26, -6]], 2, true); d.L([[0, 10], [-26, -6]], 2, true); d.L([[0, 0], [12, -26]], 1.8, true); d.L([[0, 0], [-12, -26]], 1.8, true);
  },
  oak(d) {
    d.S("M0 -46 C8 -44 6 -36 14 -34 C22 -32 20 -24 14 -20 C24 -20 26 -10 18 -6 C26 -2 26 8 16 10 C22 16 18 26 8 24 C10 30 6 36 2 36 L2 48 L-2 48 L-2 36 C-6 36 -10 30 -8 24 C-18 26 -22 16 -16 10 C-26 8 -26 -2 -18 -6 C-26 -10 -24 -20 -14 -20 C-20 -24 -22 -32 -14 -34 C-6 -36 -8 -44 0 -46 Z");
    d.L([[0, 40], [0, -38]], 2.2, true); for (const y of [-22, -6, 10]) { d.L([[0, y + 6], [11, y]], 1.6, true); d.L([[0, y + 6], [-11, y]], 1.6, true); }
  },
  acorn(d) { d.E(0, 10, 24, 30); d.S("M-30 -6 C-30 -26 30 -26 30 -6 C20 -2 -20 -2 -30 -6 Z"); d.L([[0, -22], [4, -34]], 5); for (let i = -2; i <= 2; i++) d.L([[i * 10 - 4, -12], [i * 10 + 4, -8]], 1.6, true); },
  sun(d) { d.C(0, 0, 22); for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6, c = Math.cos(a), s = Math.sin(a), b = 0.18; d.P([[28 * Math.cos(a - b), 28 * Math.sin(a - b)], [46 * c, 46 * s], [28 * Math.cos(a + b), 28 * Math.sin(a + b)]]); } d.C(-8, -5, 3, true); d.C(8, -5, 3, true); d.Q([[-10, 6], [0, 13], [10, 6]], 3, true); },
  flower(d) { for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5 - Math.PI / 2; d.E(24 * Math.cos(a), 24 * Math.sin(a), 18, 12, a); } d.C(0, 0, 12, true); d.C(0, 0, 9); },
  tulip(d) { d.L([[0, 46], [0, 0]], 4); d.E(-12, 28, 12, 5, -0.6); d.E(12, 22, 12, 5, 0.6); d.S("M-18 -8 C-20 -30 -10 -40 -8 -42 L0 -30 L8 -42 C10 -40 20 -30 18 -8 C14 4 -14 4 -18 -8 Z"); },
  raindrop(d) { d.S("M0 -44 C14 -20 28 -2 28 16 C28 34 14 44 0 44 C-14 44 -28 34 -28 16 C-28 -2 -14 -20 0 -44 Z"); d.Q([[-14, 14], [-12, 26], [-4, 32]], 3, true); },
  umbrella(d) { d.S("M-44 0 C-44 -30 44 -30 44 0 C38 -6 30 -6 22 0 C16 -6 6 -6 0 0 C-6 -6 -16 -6 -22 0 C-30 -6 -38 -6 -44 0 Z"); d.L([[0, -2], [0, 34]], 4); d.Q([[0, 34], [0, 42], [-8, 42], [-10, 36]], 4); },
  starfish(d) { d.star(0, 2, 46, 18, 5); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; for (const t of [12, 22, 32]) d.C(t * Math.cos(a), 2 + t * Math.sin(a), 2.2, true); } },
  shell(d) { d.S("M0 40 C-30 36 -44 10 -40 -14 C-36 -34 -16 -42 0 -42 C16 -42 36 -34 40 -14 C44 10 30 36 0 40 Z"); for (let k = -3; k <= 3; k++) d.L([[0, 34], [k * 11, -36]], 2.2, true); d.R(0, 42, 22, 10, 3); },
  snowman(d) { d.C(0, 26, 22); d.C(0, -6, 16); d.C(0, -30, 12); d.R(0, -44, 18, 10, 1); d.R(0, -38, 28, 4, 1); for (const y of [16, 26, 36]) d.C(0, y, 2.4, true); d.C(-4, -32, 2, true); d.C(4, -32, 2, true); d.P([[0, -29], [12, -26], [0, -25]], true); d.L([[-14, -10], [-34, -24]], 3); d.L([[14, -10], [34, -24]], 3); d.L([[-10, -16], [10, -16]], 4); },
  xmastree(d) { d.P([[0, -46], [-18, -18], [-10, -18], [-28, 6], [-18, 6], [-38, 32], [38, 32], [18, 6], [28, 6], [10, -18], [18, -18]]); d.R(0, 40, 12, 14); d.star(0, -46, 10, 4, 5); for (const [x, y] of [[-8, -12], [10, 0], [-14, 18], [6, 22], [22, 26], [-24, 28]]) d.C(x, y, 3, true); },
  nutcracker(d) {
    d.R(0, -36, 22, 20, 2); d.R(0, -24, 28, 4, 1); d.C(0, -48, 4);          // tall hat with a brim and a pompom
    d.R(0, -12, 18, 18, 3); d.C(-4, -15, 1.8, true); d.C(4, -15, 1.8, true); d.R(0, -7, 12, 4, 1, true); d.R(0, -3, 14, 4, 1); // face, eyes, mouth, beard
    d.R(0, 12, 26, 26, 3); d.L([[0, 1], [0, 24]], 2, true); for (const y of [6, 13, 20]) { d.C(-5, y, 1.6, true); d.C(5, y, 1.6, true); } // jacket and buttons
    d.R(-17, 10, 8, 22, 3); d.R(17, 10, 8, 22, 3); d.R(0, 27, 28, 5, 1); // arms, belt
    d.R(-7, 39, 10, 20, 2); d.R(7, 39, 10, 20, 2); d.R(-8, 49, 14, 5, 2); d.R(8, 49, 14, 5, 2); // legs and boots
  },
  candycane(d) { d.Q([[10, 46], [10, -20], [8, -40], [-8, -42], [-18, -32], [-18, -22]], 13); for (let k = 0; k < 8; k++) { const y = 40 - k * 9; d.L([[4, y], [16, y - 6]], 2.8, true); } d.L([[-6, -38], [2, -30]], 2.8, true); d.L([[-14, -32], [-22, -26]], 2.8, true); },
  ornament(d) { d.C(0, 8, 34); d.R(0, -28, 14, 9, 2); d.Q([[-4, -32], [0, -42], [4, -32]], 3); for (const y of [-6, 14]) d.L([[-30, y], [30, y]], 3, true); for (let k = -2; k <= 2; k++) d.C(k * 11, 4, 2.4, true); },
  gingerbread(d) { d.C(0, -28, 14); d.P([[-10, -18], [10, -18], [12, -12], [36, -14], [38, -4], [14, -2], [14, 14], [26, 40], [16, 46], [0, 22], [-16, 46], [-26, 40], [-14, 14], [-14, -2], [-38, -4], [-36, -14], [-12, -12]]); d.C(-5, -30, 2, true); d.C(5, -30, 2, true); d.Q([[-6, -23], [0, -20], [6, -23]], 2, true); for (const y of [-6, 4]) d.C(0, y, 2.4, true); d.L([[-34, -8], [-28, -10]], 2, true); d.L([[34, -8], [28, -10]], 2, true); },
  holly(d) {
    // two spiky leaves made along a midline: spikes where the side bulges out, scallops between
    const leaf = (rot) => { d.g.save(); d.g.rotate(rot); const L = 46, W = 15, n = 4, up = [], dn = [];
      for (let i = 0; i <= 2 * n; i++) { const t = i / (2 * n), x = 4 + t * L, w = W * Math.sin(Math.PI * Math.min(1, t * 1.08)) * (i % 2 ? 0.62 : 1.08); up.push([x, -w]); dn.push([x, w]); }
      d.P([[2, 0], ...up, [L + 8, 0], ...dn.reverse()]); d.L([[6, 0], [L + 2, 0]], 2, true); d.g.restore(); };
    leaf(-2.6); leaf(-0.55); d.C(-4, 10, 8); d.C(8, 12, 8); d.C(2, 0, 8); d.C(-2, 8, 2, true); d.C(10, 10, 2, true);
  },
  bigstar(d) { d.star(0, 2, 46, 20, 5); d.star(0, 2, 30, 13, 5, -Math.PI / 2, true); d.star(0, 2, 22, 9, 5); },
  pumpkin(d) { d.E(-18, 6, 22, 32); d.E(18, 6, 22, 32); d.E(0, 6, 22, 34); d.R(2, -32, 8, 14, 2); d.Q([[4, -34], [14, -40], [20, -34]], 3); d.P([[-20, -6], [-12, -6], [-16, -16]], true); d.P([[12, -6], [20, -6], [16, -16]], true); d.P([[-4, 4], [4, 4], [0, -2]], true); d.S("M-24 14 L-16 18 L-10 14 L-4 20 L4 14 L10 20 L16 14 L24 18 L20 26 C8 32 -8 32 -20 26 Z", true); },
  ghost(d) { d.S("M-30 40 L-30 -12 C-30 -38 30 -38 30 -12 L30 40 L20 32 L10 40 L0 32 L-10 40 L-20 32 Z"); d.E(-10, -12, 5, 7, 0, true); d.E(10, -12, 5, 7, 0, true); d.E(0, 6, 6, 8, 0, true); },
  bat(d) { d.S("M0 -8 C4 -16 8 -16 10 -8 C20 -18 34 -22 46 -14 C40 -8 40 2 44 8 C36 4 30 6 28 14 C22 6 14 6 10 12 L0 20 L-10 12 C-14 6 -22 6 -28 14 C-30 6 -36 4 -44 8 C-40 2 -40 -8 -46 -14 C-34 -22 -20 -18 -10 -8 C-8 -16 -4 -16 0 -8 Z"); d.P([[-6, -10], [-4, -20], [-1, -10]]); d.P([[6, -10], [4, -20], [1, -10]]); d.C(-3, -4, 1.4, true); d.C(3, -4, 1.4, true); },
  web(d) { for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; d.L([[0, 0], [48 * Math.cos(a), 48 * Math.sin(a)]], 2.4); } for (const r of [12, 22, 32, 42]) { const p = []; for (let k = 0; k <= 8; k++) { const a = (k * Math.PI) / 4; p.push([r * Math.cos(a), r * Math.sin(a)]); if (k < 8) { const b = a + Math.PI / 8, q = r * 0.86; p.push([q * Math.cos(b), q * Math.sin(b)]); } } d.L(p, 2.2); } d.E(18, 18, 6, 7); d.C(18, 10, 4); for (const s of [-1, 1]) for (const k of [0, 1, 2]) d.L([[18 + s * 4, 14 + k * 4], [18 + s * 12, 10 + k * 6], [18 + s * 14, 18 + k * 6]], 1.6); },
  witchhat(d) { d.E(0, 30, 46, 10); d.S("M-24 28 C-18 10 -10 -10 -4 -36 C0 -46 12 -44 20 -38 C10 -36 8 -26 10 -16 C14 0 18 14 24 28 Z"); d.R(0, 22, 46, 8, 2, true); d.R(0, 22, 12, 8, 1); d.R(0, 22, 6, 4, 0, true); },
  candycorn(d) { d.S("M0 -44 C8 -44 30 20 30 34 C30 44 -30 44 -30 34 C-30 20 -8 -44 0 -44 Z"); d.L([[-22, 22], [22, 22]], 3, true); d.L([[-14, -2], [14, -2]], 3, true); },
  turkey(d) { for (let k = -3; k <= 3; k++) { const a = -Math.PI / 2 + k * 0.38; d.E(30 * Math.cos(a), 6 + 30 * Math.sin(a), 9, 20, a + Math.PI / 2); } d.E(0, 14, 22, 24); d.C(0, -12, 11); d.P([[-2, -12], [-12, -8], [-2, -6]]); d.Q([[-6, -6], [-8, 2], [-4, 4]], 3); d.C(3, -15, 2, true); d.L([[-8, 36], [-10, 46]], 3); d.L([[8, 36], [10, 46]], 3); d.L([[-16, 46], [-4, 46]], 2.6); d.L([[4, 46], [16, 46]], 2.6); },
  hearts(d) { d.heart(0, 0, 38); d.heart(0, 0, 22, true); d.heart(0, 0, 14); },
  rings(d) { for (const x of [-14, 14]) { d.C(x, 6, 26); d.C(x, 6, 19, true); } d.C(-14, 6, 19, true); d.g.save(); d.g.beginPath(); d.g.rect(-50, -50, 50, 100); d.g.clip(); d.C(14, 6, 26); d.C(14, 6, 19, true); d.g.restore(); d.P([[-14, -24], [-20, -32], [-14, -40], [-8, -32]]); d.P([[-14, -27], [-17, -32], [-14, -37], [-11, -32]], true); },
  heartarrow(d) { d.heart(4, 4, 30); d.L([[-44, 30], [44, -26]], 4); d.P([[44, -26], [32, -26], [40, -16]]); for (const k of [0, 1]) { d.L([[-44 + k * 6, 30 - k * 4], [-48 + k * 6, 22 - k * 4]], 2.6); d.L([[-44 + k * 6, 30 - k * 4], [-36 + k * 6, 34 - k * 4]], 2.6); } },
  egg(d) { d.S("M0 -44 C22 -44 34 -6 34 14 C34 34 18 44 0 44 C-18 44 -34 34 -34 14 C-34 -6 -22 -44 0 -44 Z"); d.L([[-32, -4], [-22, -12], [-12, -4], [-2, -12], [8, -4], [18, -12], [28, -4], [33, -8]], 3, true); d.L([[-34, 18], [34, 18]], 3, true); for (const x of [-20, -6, 8, 22]) d.C(x, 30, 3, true); for (const x of [-12, 2, 16]) d.C(x, 4, 2.4, true); },
  bunny(d) { d.E(0, 22, 24, 22); d.C(0, -8, 15); d.E(-8, -34, 6, 16, -0.15); d.E(8, -34, 6, 16, 0.15); d.E(-8, -34, 2.5, 10, -0.15, true); d.E(8, -34, 2.5, 10, 0.15, true); d.C(-5, -10, 2, true); d.C(5, -10, 2, true); d.C(0, -3, 2.2, true); d.C(24, 30, 7); d.E(-12, 42, 10, 5); d.E(12, 42, 10, 5); },
  shamrock(d) { for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3; d.g.save(); d.g.translate(18 * Math.cos(a), 18 * Math.sin(a) - 4); d.g.rotate(a + Math.PI / 2); d.heart(0, 0, 18); d.g.restore(); } d.Q([[0, 0], [4, 24], [12, 44]], 5); },
  firework(d) { for (let k = 0; k < 16; k++) { const a = (k * Math.PI) / 8, l = k % 2 ? 44 : 34; d.L([[8 * Math.cos(a), 8 * Math.sin(a)], [l * Math.cos(a), l * Math.sin(a)]], 3.2); d.C((l + 4) * Math.cos(a), (l + 4) * Math.sin(a), 3); } d.C(0, 0, 5); },
  dreidel(d) { d.P([[-22, -20], [22, -20], [22, 14], [0, 40], [-22, 14]]); d.R(0, -30, 8, 20, 2); d.L([[-10, 0], [8, 0]], 3, true); d.L([[8, 0], [8, 16]], 3, true); d.L([[-10, -8], [-10, 4]], 3, true); },
  cake(d) { d.R(0, 26, 70, 26, 4); d.R(0, 2, 54, 22, 4); d.Q([[-35, 18], [-26, 24], [-18, 18], [-9, 24], [0, 18], [9, 24], [18, 18], [26, 24], [35, 18]], 3, true); d.Q([[-27, -4], [-18, 2], [-9, -4], [0, 2], [9, -4], [18, 2], [27, -4]], 3, true); for (const x of [-16, 0, 16]) { d.R(x, -18, 5, 18, 1); d.S(`M${x} -38 C${x + 5} -32 ${x + 4} -27 ${x} -27 C${x - 4} -27 ${x - 5} -32 ${x} -38 Z`); } d.R(0, 42, 84, 5, 2); },
  balloons(d) { for (const [x, y, r] of [[-16, -16, 17], [16, -20, 16], [0, 6, 15]]) { d.E(x, y, r * 0.85, r); d.P([[x - 3, y + r + 4], [x + 3, y + r + 4], [x, y + r - 1]]); d.Q([[x, y + r + 3], [x + 3, y + r + 14], [-1, 44]], 1.8); d.E(x - r * 0.35, y - r * 0.4, 3, 5, -0.5, true); } },
  partyhat(d) { d.P([[0, -40], [-28, 34], [28, 34]]); d.C(0, -42, 7); d.R(0, 36, 62, 8, 4); for (const [x, y] of [[-6, 18], [8, 8], [-2, -4], [10, 24], [-14, 28], [2, -20]]) d.C(x, y, 3.2, true); },
  gift(d) { d.R(0, 14, 66, 50, 3); d.R(0, -16, 74, 14, 3); d.R(0, 6, 12, 74, 0, true); d.R(0, 6, 6, 74, 0); d.E(-12, -30, 13, 7, 0.4); d.E(12, -30, 13, 7, -0.4); d.E(-12, -30, 6, 3, 0.4, true); d.E(12, -30, 6, 3, -0.4, true); d.C(0, -26, 5); },
  confetti(d) { const r = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1; for (let i = 0; i < 26; i++) { const x = r(i) * 90 - 45, y = r(i + 99) * 90 - 45, k = i % 3; if (k === 0) d.C(x, y, 3.5); else if (k === 1) { d.g.save(); d.g.translate(x, y); d.g.rotate(r(i + 7) * 3); d.R(0, 0, 10, 4, 1); d.g.restore(); } else d.Q([[x - 6, y], [x - 3, y - 5], [x, y], [x + 3, y + 5], [x + 6, y]], 2.4); } },
  gradcap(d) { d.P([[0, -26], [46, -8], [0, 10], [-46, -8]]); d.S("M-26 2 L-26 22 C-26 34 26 34 26 22 L26 2 L0 12 Z"); d.L([[0, -8], [34, 0], [34, 30]], 2.6); d.R(34, 34, 7, 12, 2); d.C(0, -8, 4); },
  rattle(d) { d.C(-14, -14, 22); d.C(-14, -14, 15, true); d.C(-14, -14, 10); d.L([[2, 2], [32, 32]], 8); d.C(36, 36, 8); },
  duck(d) { d.E(4, 18, 32, 20); d.C(-16, -14, 16); d.P([[-30, -14], [-46, -10], [-30, -6]]); d.C(-20, -18, 2.5, true); d.E(8, 14, 16, 9, 0.3, true); d.E(8, 14, 13, 6, 0.3); d.P([[30, 8], [44, -2], [36, 16]]); },
  squirrel(d) {
    d.Q([[12, 30], [30, 22], [36, 0], [30, -22], [18, -30], [10, -22], [14, -12]], 17); // the bushy tail
    d.E(-6, 16, 18, 24, 0.25); d.C(-16, -14, 13); d.P([[-20, -24], [-16, -38], [-10, -26]]); d.E(-30, -12, 6, 5); d.C(-18, -16, 2.2, true);
    d.E(-14, 38, 12, 6); d.E(-22, 8, 4, 9, 0.6); d.C(-26, 12, 5);           // feet, paws holding a nut
  },
  chipmunk(d) {
    d.Q([[18, 26], [32, 14], [38, -6], [34, -20]], 9);
    d.E(0, 14, 24, 20, -0.2); d.C(-22, -6, 13); d.C(-20, -18, 5); d.E(-34, -4, 5, 4); d.C(-24, -9, 2, true);
    d.Q([[-14, 4], [0, 0], [16, 4]], 2.6, true); d.Q([[-12, 12], [2, 8], [18, 12]], 2.6, true); d.Q([[-26, -2], [-18, 0], [-14, -2]], 2, true); // the stripes
    d.E(-10, 32, 9, 5); d.E(10, 32, 9, 5);
  },
  rabbit(d) { d.E(10, 18, 28, 20); d.C(-18, -2, 14); d.E(-14, -28, 5, 16, 0.25); d.E(-24, -28, 5, 16, -0.15); d.C(-24, -4, 2.2, true); d.C(38, 10, 7); d.E(-4, 36, 12, 5); d.E(22, 36, 12, 5); },
  bird(d) { d.E(4, 6, 26, 18, -0.1); d.C(-20, -10, 13); d.P([[-32, -12], [-44, -8], [-32, -4]]); d.C(-22, -13, 2.4, true); d.P([[26, 4], [46, -8], [42, 12]]); d.Q([[-6, 2], [6, -6], [20, 0]], 3, true); d.L([[-2, 22], [-6, 34]], 2.4); d.L([[8, 22], [8, 34]], 2.4); },
  owl(d) { d.E(0, 8, 30, 38); d.P([[-26, -24], [-22, -42], [-10, -28]]); d.P([[26, -24], [22, -42], [10, -28]]); d.C(-12, -12, 11, true); d.C(12, -12, 11, true); d.C(-12, -12, 5); d.C(12, -12, 5); d.P([[-4, -2], [4, -2], [0, 6]], true); for (const [x, y] of [[-10, 18], [0, 22], [10, 18], [-6, 30], [6, 30]]) d.Q([[x - 4, y], [x, y + 3], [x + 4, y]], 2, true); },
  deer(d) {
    d.E(4, 6, 26, 13); d.L([[-14, 2], [-24, -18]], 9); d.E(-28, -22, 9, 6, -0.4); d.P([[-36, -18], [-46, -14], [-36, -12]]);
    d.L([[-26, -26], [-30, -40], [-38, -46]], 2.6); d.L([[-29, -36], [-22, -46]], 2.4); d.L([[-22, -26], [-16, -38], [-8, -44]], 2.6); d.L([[-16, -36], [-20, -46]], 2.4);
    for (const x of [-14, -6, 14, 22]) d.L([[x, 14], [x, 42]], 4.5); d.C(29, 2, 4); d.C(-29, -23, 1.8, true);
  },
  butterfly(d) { d.E(-18, -14, 18, 22, -0.5); d.E(18, -14, 18, 22, 0.5); d.E(-14, 18, 12, 15, 0.4); d.E(14, 18, 12, 15, -0.4); d.E(0, 2, 4, 26); d.Q([[-2, -22], [-8, -36], [-14, -40]], 1.8); d.Q([[2, -22], [8, -36], [14, -40]], 1.8); d.C(-20, -16, 6, true); d.C(20, -16, 6, true); d.C(-14, 20, 4, true); d.C(14, 20, 4, true); },
  fish(d) { d.E(-6, 0, 32, 20); d.P([[22, 0], [44, -18], [40, 0], [44, 18]]); d.C(-24, -4, 4, true); d.Q([[-14, -16], [-10, 0], [-14, 16]], 2.4, true); for (const [x, y] of [[-2, -6], [6, 4], [-2, 8], [10, -6]]) d.Q([[x - 4, y - 3], [x, y], [x - 4, y + 3]], 1.8, true); },
  cat(d) { d.E(4, 18, 22, 26); d.C(-4, -18, 15); d.P([[-17, -24], [-18, -40], [-6, -30]]); d.P([[9, -24], [10, -40], [-2, -30]]); d.Q([[24, 36], [40, 30], [42, 10], [34, 0]], 6); d.E(-9, -19, 2.2, 3, 0, true); d.E(2, -19, 2.2, 3, 0, true); d.E(-4, 42, 16, 4); },
  paw(d) { d.E(0, 14, 20, 17); for (const [x, y, rx, ry] of [[-24, -10, 8, 10], [-9, -26, 8, 11], [9, -26, 8, 11], [24, -10, 8, 10]]) d.E(x, y, rx, ry); },
  reindeer(d) { M.deer(d); d.C(-46, -15, 5); },
  mitten(d) { d.S("M-20 34 L-22 -8 C-22 -30 -10 -40 2 -40 C16 -40 24 -28 24 -12 L24 34 Z"); d.E(-26, 0, 9, 16, -0.5); d.R(2, 38, 50, 12, 3); for (let x = -18; x <= 22; x += 8) d.L([[x, 33], [x, 43]], 2, true); d.Q([[-12, -14], [0, -20], [12, -14]], 2, true); d.Q([[-12, -2], [0, -8], [12, -2]], 2, true); },
};

// ------------------------------------------------------------------ tiles of pictures
// a layout: [picture, x, y, scale, turn] with x, y in 0..1 of the tile; pictures crossing an edge are
// drawn again on the far side so the tile repeats seamlessly
const scatter = (names, n, seed, s0 = 0.34, turn = 0.5) => {
  const r = (i) => Math.abs(Math.sin((i + seed) * 12.9898) * 43758.5453) % 1, out = [], cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) { const c = i % cols, row = Math.floor(i / cols); out.push([names[i % names.length], (c + 0.5 + (row % 2) * 0.5 + (r(i) - 0.5) * 0.25) / cols, (row + 0.5 + (r(i + 50) - 0.5) * 0.25) / Math.ceil(n / cols), s0 * (0.8 + 0.4 * r(i + 9)), (r(i + 31) - 0.5) * 2 * turn]); }
  return out;
};
const grid = (names, cols, rows, s = 0.4, stagger = true) => {
  const out = []; let k = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push([names[k++ % names.length], (i + 0.5 + (stagger && j % 2 ? 0.5 : 0)) / cols, (j + 0.5) / rows, s, 0]);
  return out;
};
function gen(layout, soft = 1.6) {
  return (w, h) => {
    const data = new Float32Array(w * h);
    if (typeof document === "undefined") return data.fill(0.5);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const d = pen(g);
    for (const [name, x, y, s, turn] of layout) for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) {
      const px = (x + ox) * w, py = (y + oy) * h, sz = s * w / 100;
      if (px + 60 * sz < 0 || px - 60 * sz > w || py + 60 * sz < 0 || py - 60 * sz > h) continue;
      g.save(); g.translate(px, py); g.rotate(turn); g.scale(sz, sz); M[name](d); g.restore();
    }
    const img = g.getImageData(0, 0, w, h).data, m = new Float32Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = img[i * 4] / 255;
    // soften: a little blur (wrapping) mixed with the sharp picture, so edges are rounded but crisp
    const r = Math.max(1, Math.round((soft * w) / 256));
    const blur = (src) => { const t = new Float32Array(src.length), o = new Float32Array(src.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s2 = 0; for (let k = -r; k <= r; k++) s2 += src[y * w + ((x + k + w) % w)]; t[y * w + x] = s2 / (2 * r + 1); }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s2 = 0; for (let k = -r; k <= r; k++) s2 += t[((y + k + h) % h) * w + x]; o[y * w + x] = s2 / (2 * r + 1); }
      return o; };
    const b = blur(blur(m));
    for (let i = 0; i < data.length; i++) data[i] = 0.55 * b[i] + 0.45 * m[i];
    return data;
  };
}
const T = (key, name, cat, layout, size = 50) => ({ key, name, cat, size, pic: true, w: 512, h: 512, gen: gen(layout) });

export function themeDefs() {
  return [
    // seasons
    T("snowflakes", "Snowflakes", "season", scatter(["snowflake"], 9, 3, 0.26, 0.5)),
    T("fallleaves", "Fall leaves", "season", scatter(["maple", "oak", "maple", "acorn"], 9, 7, 0.27, 1.2)),
    T("maples", "Maple leaves", "season", scatter(["maple"], 6, 11, 0.3, 0.8)),
    T("acorns", "Acorns and oak leaves", "season", scatter(["acorn", "oak"], 8, 21, 0.26, 0.9)),
    T("suns", "Suns", "season", grid(["sun"], 3, 3, 0.27)),
    T("flowers", "Spring flowers", "season", scatter(["flower", "tulip", "flower"], 9, 5, 0.27, 0.4)),
    T("rain", "Raindrops and umbrellas", "season", scatter(["raindrop", "umbrella", "raindrop", "raindrop"], 9, 13, 0.25, 0.3)),
    T("beach", "Beach: starfish and shells", "season", scatter(["starfish", "shell"], 8, 17, 0.27, 1)),
    T("winter", "Mittens and snowflakes", "season", scatter(["mitten", "snowflake", "snowflake"], 9, 29, 0.26, 0.4)),
    // holidays
    T("snowmen", "Snowmen", "holiday", grid(["snowman"], 3, 2, 0.4)),
    T("xmastrees", "Christmas trees", "holiday", grid(["xmastree"], 3, 2, 0.38)),
    T("nutcrackers", "Nutcrackers", "holiday", grid(["nutcracker"], 3, 2, 0.36)),
    T("candycanes", "Candy canes", "holiday", grid(["candycane"], 4, 2, 0.34)),
    T("ornaments", "Ornaments", "holiday", grid(["ornament", "bigstar"], 3, 3, 0.27)),
    T("gingerbread", "Gingerbread people", "holiday", grid(["gingerbread"], 3, 2, 0.36)),
    T("holly", "Holly", "holiday", scatter(["holly"], 6, 41, 0.44, 0.8)),
    T("xmasmix", "Christmas mix", "holiday", scatter(["xmastree", "snowman", "candycane", "ornament", "snowflake", "gingerbread"], 9, 43, 0.27, 0.25)),
    T("reindeer", "Reindeer", "holiday", grid(["reindeer"], 3, 2, 0.38)),
    T("pumpkins", "Jack-o'-lanterns", "holiday", grid(["pumpkin"], 3, 2, 0.36)),
    T("ghosts", "Ghosts", "holiday", scatter(["ghost"], 6, 47, 0.32, 0.3)),
    T("bats", "Bats", "holiday", scatter(["bat"], 8, 53, 0.3, 0.5)),
    T("webs", "Spider webs", "holiday", grid(["web"], 2, 2, 0.5)),
    T("halloween", "Halloween mix", "holiday", scatter(["pumpkin", "ghost", "bat", "witchhat", "candycorn", "web"], 9, 59, 0.27, 0.3)),
    T("turkeys", "Thanksgiving turkeys", "holiday", grid(["turkey"], 3, 2, 0.31)),
    T("valentine", "Valentine hearts", "holiday", scatter(["hearts", "heartarrow"], 8, 61, 0.28, 0.4)),
    T("eastereggs", "Easter eggs", "holiday", scatter(["egg"], 8, 67, 0.28, 0.5)),
    T("bunnies", "Easter bunnies", "holiday", grid(["bunny", "egg"], 3, 2, 0.36)),
    T("shamrocks", "Shamrocks", "holiday", scatter(["shamrock"], 8, 71, 0.28, 0.6)),
    T("fireworks", "Fireworks and stars", "holiday", scatter(["firework", "bigstar", "firework"], 9, 73, 0.28, 0.4)),
    T("dreidels", "Dreidels", "holiday", scatter(["dreidel"], 8, 79, 0.28, 0.4)),
    // celebrations
    T("birthday", "Birthday cakes", "party", grid(["cake"], 3, 2, 0.36)),
    T("balloons", "Balloons", "party", grid(["balloons"], 3, 2, 0.36)),
    T("partymix", "Birthday party", "party", scatter(["cake", "balloons", "partyhat", "gift", "confetti"], 9, 83, 0.27, 0.25)),
    T("gifts", "Gifts", "party", grid(["gift"], 3, 2, 0.34)),
    T("confetti", "Confetti", "party", grid(["confetti"], 2, 2, 0.5, false)),
    T("anniversary", "Anniversary rings and hearts", "party", scatter(["rings", "hearts"], 8, 89, 0.28, 0.3)),
    T("heartsonly", "Hearts", "party", grid(["hearts"], 4, 3, 0.25)),
    T("graduation", "Graduation caps", "party", grid(["gradcap"], 3, 2, 0.36)),
    T("baby", "Baby: rattles and ducks", "party", scatter(["rattle", "duck"], 8, 97, 0.28, 0.4)),
    // animals
    T("squirrels", "Squirrels", "animal", grid(["squirrel"], 3, 2, 0.32)),
    T("chipmunks", "Chipmunks", "animal", grid(["chipmunk"], 3, 2, 0.38)),
    T("rabbits", "Rabbits", "animal", grid(["rabbit"], 3, 2, 0.38)),
    T("birds", "Birds", "animal", scatter(["bird"], 8, 101, 0.3, 0.3)),
    T("owls", "Owls", "animal", grid(["owl"], 3, 2, 0.36)),
    T("deer", "Deer", "animal", grid(["deer"], 3, 2, 0.38)),
    T("butterflies", "Butterflies", "animal", scatter(["butterfly"], 8, 103, 0.3, 0.6)),
    T("fishes", "Fish", "animal", scatter(["fish"], 8, 107, 0.3, 0.3)),
    T("cats", "Cats", "animal", grid(["cat"], 3, 2, 0.36)),
    T("paws", "Paw prints", "animal", scatter(["paw"], 10, 109, 0.22, 0.8)),
    T("woodland", "Woodland animals", "animal", scatter(["squirrel", "chipmunk", "rabbit", "owl", "deer", "acorn"], 9, 113, 0.28, 0.15)),
  ];
}
