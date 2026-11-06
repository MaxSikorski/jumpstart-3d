// Architect furniture, part 2: luxury fixtures, food and table settings (they sit on whatever surface
// they are put on), people, and greenhouses with their benches, beds and pots. The builders use the
// same simple closed shapes as archfurn.js (boxes, cylinders, balls, cones and flat polygons).
// Sizes are mm, Z up, front at -Y.

const WOOD = "#7a5230", DARK = "#2b2f36", BLACK = "#1b1d22", WHITE = "#f4f6f8", STEEL = "#c3c8cd", METAL = "#8a9099", GOLD = "#d4af37", MARBLE = "#efece6", CREAM = "#f3ead8", GREEN = "#4f8f3c", LEAF = "#5f9e3a", SOIL = "#5a3b25", WATER = "#7fc3e6", POT = "#b5653d", CHINA = "#fbfaf7";
const PALE_GOLD = "#e6c25a";

export const MORE_CATS = [["luxury", "Luxury"], ["food", "Food & table"], ["people", "People"], ["green", "Greenhouses"]];
// builders that go back against a wall when put near one
export const MORE_SNAPS = ["winewall", "winefridge", "library", "lean", "pottingbench", "sauna"];

export function moreBuilders(B, H) {
  const { legs4, rlegs4, fronts } = H;
  // ------------------------------------------------------------------ luxury
  B.canopybed = (p, W, D, H, o) => {
    B.bed(p, W, D, 1200, { wood: o.wood || "$d", pillows: 3 });
    const post = 90;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { p.cyl(i * (W / 2 + 10), j * (D / 2 - 40), 0, post / 2, H, o.wood || "$d", { seg: 12 }); p.ball(i * (W / 2 + 10), j * (D / 2 - 40), H + 40, 55, GOLD, { np: true }); }
    for (const j of [-1, 1]) p.box(0, j * (D / 2 - 40), H - 120, W + 100, 70, 120, o.wood || "$d", { np: true });
    for (const i of [-1, 1]) p.box(i * (W / 2 + 10), 0, H - 120, 70, D - 80, 120, o.wood || "$d", { np: true });
    // curtains gathered at the posts
    for (const [i, j] of [[-1, -1], [1, -1]]) p.cyl(i * (W / 2 - 60), j * (D / 2 - 110), 60, 90, H - 200, o.drape || CREAM, { rt: 140, seg: 14, np: true });
  };
  B.chesterfield = (p, W, D, H, o) => {
    const arm = 230, seat = 430, leg = 80;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.ball(i * (W / 2 - 80), j * (D / 2 - 80), 40, 40, "#3b2414", { rz: 40 });
    p.box(0, 0, leg, W, D, seat - leg - 110, "$d");
    const n = o.seats || 3, cw = (W - 2 * arm) / n;
    for (let i = 0; i < n; i++) p.box(-W / 2 + arm + cw * (i + 0.5), -D * 0.06, seat - 120, cw - 10, D * 0.72, 130, "$");
    p.box(0, D / 2 - 120, leg, W, 240, H - leg - 60, "$");
    p.cylX(0, D / 2 - 120, H - 60, 120, W, "$", { np: true });
    for (const s of [-1, 1]) { p.box(s * (W / 2 - arm / 2), 0, leg, arm, D, H - 120 - leg, "$"); p.cylY(s * (W / 2 - arm / 2), -20, H - 120, 125, D - 40, "$", { np: true }); }
    // buttons (tufting) on the back
    for (let r = 0; r < 2; r++) for (let k = 0; k < Math.round(W / 160); k++) p.ball(-W / 2 + arm + 60 + k * ((W - 2 * arm - 120) / Math.max(1, Math.round(W / 160) - 1)) + (r ? 40 : 0), D / 2 - 245, seat + 120 + r * 160, 14, "$dd", { np: true });
  };
  B.chaise = (p, W, D, H, o) => {
    rlegs4(p, W, D, 120, 18, GOLD, 60);
    p.box(0, 0, 120, W, D, 180, "$");
    p.at(-W / 2 + 280, 0, 280, 0, () => p.box(0, 0, 0, 560, D, 90, "$l"), 0, 0.5);
    p.cylY(-W / 2 + 90, 0, 520, 130, D, "$", { np: true });
    p.box(-W / 2 + 90, 0, 120, 180, D, 400, "$");
  };
  B.crystal = (p, W, D, H, o) => {
    const z = o.z || 1500, top = z + H;
    p.cyl(0, 0, z + H * 0.55, 8, H * 0.45, GOLD, { seg: 6, np: true }); p.cyl(0, 0, top - 30, 90, 30, GOLD, { np: true });
    // tiers of crystal drops round a gold frame
    const tiers = o.tiers || 3;
    for (let t = 0; t < tiers; t++) {
      const r = (W / 2) * (1 - t * 0.28), zt = z + t * H * 0.17, n = Math.max(8, Math.round(r / 45));
      p.cyl(0, 0, zt + 60, r, 25, GOLD, { seg: 24, np: true, rt: r });
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.cone(Math.cos(a) * r, Math.sin(a) * r, zt - 70, 22, 120, "glass", { seg: 6, np: true }); p.ball(Math.cos(a) * r, Math.sin(a) * r, zt + 110, 22, "#fff3c4", { rz: 40, np: true }); }
    }
    p.cone(0, 0, z - 200, W * 0.12, 260, "glass", { seg: 8 });
  };
  B.stonetub = (p, W, D, H, o) => {
    p.cyl(0, 0, 0, W / 2 - 60, H, "$", { rt: W / 2, ry: D / 2 - 30, seg: 40 });
    p.cyl(0, 0, H - 6, W / 2 - 110, 10, o.water ? WATER : "#e3e9ee", { ry: D / 2 - 90, seg: 40, np: true });
    // a floor-mounted tub filler
    p.cyl(-W / 2 - 150, 0, 0, 22, H + 250, o.tap || GOLD, { seg: 12 });
    p.at(-W / 2 - 150, 0, H + 230, 0, () => p.cylX(90, 0, 0, 16, 180, o.tap || GOLD, { np: true }));
  };
  B.rainshower = (p, W, D, H, o) => {
    p.box(0, 0, 0, W, D, 60, "$");
    p.cyl(0, 0, 60, 45, 4, METAL, { np: true });
    // glass on the front and one side, a big rain head and a bench
    p.box(0, -D / 2 + 6, 60, W, 12, H - 260, "glass");
    p.box(W / 2 - 6, 0, 60, 12, D - 12, H - 260, "glass");
    p.box(0, -D / 2 + 6, 60, 40, 30, H - 260, o.trim || GOLD, { np: true });
    p.box(0, D / 2 - 200, H - 120, 20, 400, 20, o.trim || GOLD, { np: true });
    p.box(0, 0, H - 140, 300, 300, 20, o.trim || GOLD);
    p.box(-W / 2 + 200, D / 2 - 180, 60, 380, 340, 420, MARBLE);
  };
  B.waterfall = (p, W, D, H, o) => {
    const t = 60, top = o.top || MARBLE;
    // marble top that runs down both ends to the floor, cabinets between
    p.box(0, 0, H - t, W, D, t, top);
    for (const s of [-1, 1]) p.box(s * (W / 2 - t / 2), 0, 0, t, D, H - t, top);
    p.box(0, D * 0.15, 0, W - 2 * t - 20, D * 0.7, H - t, "$");
    p.at(0, D * 0.15, 0, Math.PI, () => fronts(p, W - 2 * t - 20, D * 0.7, 100, H - t - 10, Math.max(2, Math.round(W / 600)), 2, "$l", GOLD, { bar: true }));
    p.box(0, D * 0.15, 0, W - 2 * t - 40, D * 0.6, 100, BLACK, { np: true });
    if (o.stools) for (let i = 0; i < o.stools; i++) p.at(-W / 2 + (W / o.stools) * (i + 0.5), -D / 2 - 200, 0, 0, () => B.stool(p, 420, 420, 760, { back: true }));
  };
  B.prorange = (p, W, D, H, o) => {
    B.stove(p, W, D, H, o);
    for (let i = 0; i < 6; i++) p.disc(-W * 0.4 + i * W * 0.16, -D / 2 - 14, H - 70, 26, 26, o.knob || GOLD);
    p.box(W * 0.2, -D / 2 - 6, 140, W * 0.32, 12, H * 0.5, BLACK, { np: true });
  };
  B.winewall = (p, W, D, H, o) => {
    p.box(0, 0, 0, W, D, H, "$d");
    p.box(0, -D / 2 + 20, 0, W - 40, 40, H, "glass");
    const cols = Math.max(2, Math.floor((W - 80) / 110)), rows = Math.max(3, Math.floor((H - 200) / 110));
    const cs = ["#4a0f1c", "#2f5d3a", "#5a1a24", "#c9b26b", "#3a1016"];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = -W / 2 + 40 + (i + 0.5) * ((W - 80) / cols), z = 120 + j * ((H - 200) / rows) + 50; p.cylY(x, -D / 2 + 140, z, 38, 160, cs[(i * 3 + j * 7) % cs.length], { seg: 8, np: true }); p.cylY(x, -D / 2 + 50, z, 14, 30, GOLD, { seg: 6, np: true }); }
    for (let j = 0; j <= rows; j++) p.box(0, 0, 100 + j * ((H - 200) / rows), W - 40, D - 60, 12, "$", { np: true });
  };
  B.winefridge = (p, W, D, H, o) => {
    p.box(0, 0, 0, W, D, H, "$");
    p.box(0, -D / 2 - 6, 60, W - 60, 12, H - 120, "glass");
    for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) p.cylY(-W / 2 + 70 + i * (W - 140) / 3, -D / 2 + 140, 140 + j * (H - 260) / 5, 36, 220, ["#4a0f1c", "#c9b26b", "#2f5d3a"][(i + j) % 3], { seg: 8, np: true });
    p.cyl(W / 2 - 60, -D / 2 - 30, H * 0.35, 12, H * 0.3, STEEL, { seg: 8, np: true });
  };
  B.library = (p, W, D, H, o) => {
    const n = Math.max(2, Math.round(W / 900)), bw = W / n;
    for (let k = 0; k < n; k++) p.at(-W / 2 + bw * (k + 0.5), 0, 0, 0, () => B.shelf(p, bw, D, H, { books: true }));
    // a rolling ladder on a brass rail
    p.box(0, -D / 2 - 30, H - 300, W - 100, 30, 30, GOLD, { np: true });
    p.at(W * 0.15, -D / 2 - 300, 0, 0, () => { for (const s of [-1, 1]) p.at(s * 220, 0, 0, 0, () => p.box(0, 0, 0, 40, 50, H - 280, "#5d3b2c"), -0.25); for (let r = 1; r < 8; r++) p.box(0, 270 - r * ((H - 300) / 8) * 0.25, r * ((H - 300) / 8), 420, 40, 25, "#5d3b2c", { np: true }); });
  };
  B.theater = (p, W, D, H, o) => {
    const n = o.seats || 3, sw = W / n;
    for (let i = 0; i < n; i++) p.at(-W / 2 + sw * (i + 0.5), 0, 0, 0, () => B.sofa(p, sw, D, H, { seats: 1, recl: true, arm: 130 }));
    for (let i = 1; i < n; i++) p.cyl(-W / 2 + sw * i, -D * 0.15, H * 0.55, 38, 60, BLACK, { np: true });
  };
  B.statue = (p, W, D, H, o) => {
    const ph = H * 0.38;
    p.box(0, 0, 0, W, D, 80, "$d"); p.box(0, 0, 80, W * 0.8, D * 0.8, ph - 160, "$"); p.box(0, 0, ph - 80, W, D, 80, "$d");
    const s = o.stone || MARBLE, u = H - ph;
    // an abstract standing figure
    p.cyl(0, 0, ph, W * 0.18, u * 0.45, s, { rt: W * 0.14, seg: 16 });
    p.cyl(0, 0, ph + u * 0.45, W * 0.14, u * 0.33, s, { rt: W * 0.2, seg: 16 });
    p.ball(0, 0, ph + u * 0.88, W * 0.11, s, { rz: W * 0.13 });
    for (const k of [-1, 1]) p.at(k * W * 0.22, 0, ph + u * 0.76, 0, () => p.cyl(0, 0, -u * 0.32, W * 0.05, u * 0.32, s, { seg: 10 }), k * 0.25, -k * 0.2);
  };
  B.fountain = (p, W, D, H, o) => {
    const s = o.stone || "$";
    p.cyl(0, 0, 0, W / 2, 450, s, { seg: 40 }); p.cyl(0, 0, 400, W / 2 - 90, 40, WATER, { seg: 40, np: true });
    p.cyl(0, 0, 450, W * 0.08, H * 0.45, s, { rt: W * 0.06, seg: 16 });
    p.cyl(0, 0, H * 0.5, W * 0.22, 120, s, { rt: W * 0.28, seg: 28 }); p.cyl(0, 0, H * 0.5 + 100, W * 0.24, 25, WATER, { seg: 28, np: true });
    p.cyl(0, 0, H * 0.5 + 120, W * 0.04, H * 0.25, s, { seg: 12 });
    p.cyl(0, 0, H * 0.78, W * 0.11, 80, s, { rt: W * 0.14, seg: 20 });
    p.ball(0, 0, H - 60, 60, s);
    // falling water
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; p.cyl(Math.cos(a) * W * 0.25, Math.sin(a) * W * 0.25, 440, 8, H * 0.5 - 340, WATER, { seg: 5, np: true }); }
  };
  B.swimpool = (p, W, D, H, o) => {
    const c = 300;
    for (const [x, y, w, d] of [[0, -D / 2 + c / 2, W, c], [0, D / 2 - c / 2, W, c], [-W / 2 + c / 2, 0, c, D - 2 * c], [W / 2 - c / 2, 0, c, D - 2 * c]]) p.box(x, y, 0, w, d, H, "$");
    p.box(0, 0, 0, W - 2 * c, D - 2 * c, H - 60, o.water || "#4fb3d9");
    // steps in one corner, two loungers
    for (let k = 0; k < 3; k++) p.box(-W / 2 + c + 300, -D / 2 + c + 150 + k * 0, H - 60 - 0, 600 - k * 150, 300, 20, "#e8f6fb", { np: true });
    for (const s of [-1, 1]) p.at(s * W * 0.25, -D / 2 - 600, 0, 0, () => B.lounger && B.lounger(p, 700, 1900, 900, {}));
  };
  B.sauna = (p, W, D, H, o) => {
    const t = 90, wood = "$";
    for (const [x, y, w, d] of [[0, D / 2 - t / 2, W, t], [-W / 2 + t / 2, 0, t, D], [W / 2 - t / 2, 0, t, D]]) p.box(x, y, 0, w, d, H, wood);
    p.box(-W * 0.25, -D / 2 + t / 2, 0, W / 2, t, H, wood);
    p.box(W * 0.25, -D / 2 + t / 2, 0, W / 2 - 40, 30, H - 200, "glass");
    p.box(0, 0, H - t, W, D, t, wood);
    for (const [z, d] of [[450, 500], [900, 450]]) p.box(0, D / 2 - t - d / 2, z, W - 2 * t, d, 50, "$l");
    p.box(-W / 2 + t + 250, -D / 2 + t + 250, 0, 400, 400, 600, METAL); p.box(-W / 2 + t + 250, -D / 2 + t + 250, 600, 380, 380, 80, "#6b6f75", { np: true });
  };
  B.closetisland = (p, W, D, H, o) => {
    p.box(0, 0, 0, W, D, 80, BLACK);
    p.box(0, 0, 80, W, D, H - 120, "$");
    for (const s of [-1, 1]) p.at(0, 0, 0, s > 0 ? 0 : Math.PI, () => fronts(p, W, D, 90, H - 50, Math.max(2, Math.round(W / 450)), 4, "$l", GOLD, { bar: true }));
    p.box(0, 0, H - 40, W + 40, D + 40, 40, "glass");
    p.box(0, 0, H - 60, W, D, 20, MARBLE);
  };
  B.mirror = (p, W, D, H, o) => {
    const z = o.z || 0;
    p.box(0, D / 2 - 30, z, W, 50, H, o.frame || GOLD);
    p.box(0, D / 2 - 58, z + 70, W - 140, 6, H - 140, "#d8eef8", { np: true });
    if (o.ornate) for (const [x, zz] of [[0, z + H - 20], [-W / 2 + 20, z + H / 2], [W / 2 - 20, z + H / 2]]) p.ball(x, D / 2 - 40, zz, 70, o.frame || GOLD, { ry: 30, np: true });
  };

  // ------------------------------------------------------------------ food and table settings
  // everything sits at z = 0 on whatever surface it is placed on
  const plate = (x, y, z, r, c = CHINA) => { p0.cyl(x, y, z, r * 0.72, 8, c, { rt: r, seg: 28 }); p0.cyl(x, y, z + 8, r * 0.98, 6, c, { rt: r, seg: 28, np: true }); };
  let p0 = null;
  const bowl = (x, y, z, r, h, c = CHINA) => p0.cyl(x, y, z, r * 0.55, h, c, { rt: r, seg: 28 });
  const board = (x, y, z, w, d, c = "#b5834e") => p0.box(x, y, z, w, d, 18, c);
  const fork = (x, y, z, len = 190) => { p0.box(x, y, z, 16, len, 3, STEEL, { np: true }); };
  const glassCup = (x, y, z, wine) => { p0.cyl(x, y, z, 32, 4, "glass", { seg: 14 }); p0.cyl(x, y, z + 4, 4, 90, "glass", { seg: 6, np: true }); p0.cyl(x, y, z + 94, 22, 80, "glass", { rt: 40, seg: 16 }); if (wine) p0.cyl(x, y, z + 100, 26, 30, wine, { rt: 33, seg: 16, np: true }); };
  const apple = (x, y, z, c = "#c8243a") => { p0.ball(x, y, z + 38, 40, c, { rz: 36, seg: 12 }); p0.cyl(x, y, z + 72, 3, 14, "#5a3b25", { seg: 4, np: true }); };
  const banana = (x, y, z, a) => p0.at(x, y, z + 20, a, () => { p0.ball(0, 0, 0, 90, "#f2d03b", { ry: 18, rz: 20, seg: 12 }); }, 0, 0.15);
  B.food = (p, W, D, H, o) => {
    p0 = p;
    switch (o.f) {
      case "setting": plate(0, 0, 0, 135); plate(0, 0, 14, 100); fork(-170, 0, 0); p.box(170, 0, 0, 18, 210, 3, STEEL, { np: true }); p.box(-230, 0, 0, 120, 200, 10, "$", { np: true }); glassCup(160, 170, 0); break;
      case "pizza": board(0, 0, 0, W, D * 0.8); p.box(0, -D / 2 + 60, 0, 60, 120, 18, "#b5834e", { np: true }); p.cyl(0, 40, 18, 160, 14, "#e2a74c", { seg: 32 }); p.cyl(0, 40, 30, 145, 6, "#f2c94c", { seg: 32, np: true }); for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 30 + (i % 3) * 38; p.cyl(Math.cos(a) * r, 40 + Math.sin(a) * r, 34, 18, 4, "#b8322a", { seg: 12, np: true }); } for (let i = 0; i < 4; i++) p.ball(Math.cos(i * 1.6 + 0.5) * 90, 40 + Math.sin(i * 1.6 + 0.5) * 90, 38, 8, "#3f7f3a", { np: true }); break;
      case "cake": p.cyl(0, 0, 0, 60, 90, "glass", { rt: 30, seg: 16 }); p.cyl(0, 0, 90, 160, 12, "glass", { seg: 32 }); for (const [r, h, z] of [[140, 90, 102], [110, 80, 192], [80, 70, 272]]) { p.cyl(0, 0, z, r, h, "$", { seg: 32 }); p.cyl(0, 0, z + h - 10, r + 4, 14, "#fff6e8", { seg: 32, np: true }); } for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.cyl(Math.cos(a) * 45, Math.sin(a) * 45, 342, 5, 60, ["#3d8fd6", "#e8a317", "#d0574b", "#4f8f3c", "#6b4f8a"][i], { seg: 6, np: true }); p.cone(Math.cos(a) * 45, Math.sin(a) * 45, 402, 7, 20, "#ffb347", { seg: 6, np: true }); } for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.ball(Math.cos(a) * 125, Math.sin(a) * 125, 200, 14, "#c8243a", { np: true }); } break;
      case "cupcakes": plate(0, 0, 0, W / 2); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * W * 0.27, y = Math.sin(a) * W * 0.27; p.cyl(x, y, 14, 26, 45, ["#e8dcc0", "#6b4f3a"][i % 2], { rt: 34, seg: 12 }); p.ball(x, y, 72, 34, ["#f7b6d2", "#fff6e8", "#b9e3c6"][i % 3], { rz: 30, seg: 12 }); p.ball(x, y, 104, 8, "#c8243a", { np: true }); } break;
      case "fruitbowl": bowl(0, 0, 0, W / 2, 110, "$"); for (const [x, y, c] of [[-50, -40, "#c8243a"], [55, -30, "#ff8c1a"], [0, 50, "#7fbf3f"], [-70, 50, "#ff8c1a"], [70, 60, "#c8243a"]]) apple(x, y, 70, c); banana(0, -20, 140, 0.4); banana(10, -10, 152, 0.6); p.ball(-20, 10, 150, 22, "#6b2a5a", { np: true }); p.ball(5, 25, 150, 22, "#6b2a5a", { np: true }); break;
      case "apples": apple(0, 0, 0); apple(70, 30, 0, "#7fbf3f"); apple(-60, 40, 0, "#ff8c1a"); break;
      case "bananas": for (let i = 0; i < 5; i++) banana(0, -40 + i * 18, 0, 0.1 * i); p.cyl(-90, 20, 10, 10, 30, "#5a4a2a", { seg: 6, np: true }); break;
      case "bread": board(0, 0, 0, W, D); p.ball(-40, 0, 18 + 55, 170, "#c88a45", { ry: 75, rz: 60, seg: 18 }); for (let i = 0; i < 3; i++) p.at(150 + i * 26, 0, 18, 0, () => p.box(0, 0, 0, 18, 130, 110, "#e8c88e", { np: true }), 0, -0.25); break;
      case "croissants": p.cyl(0, 0, 0, W * 0.38, 80, "#b5834e", { rt: W / 2, seg: 24 }); for (const [x, y, a] of [[-60, 0, 0.3], [50, 30, -0.4], [0, -60, 1.2], [20, 50, 2.0]]) p.at(x, y, 90, a, () => { p.ball(0, 0, 0, 80, "#d89a4e", { ry: 34, rz: 30, seg: 12 }); for (const s of [-1, 1]) p.ball(s * 70, 15, -2, 30, "#c8863e", { ry: 20, rz: 20, np: true }); }); break;
      case "donuts": p.box(0, 0, 0, W, D, 20, "#f4eee4"); p.box(0, D / 2 - 10, 0, W, 20, 70, "#f4eee4", { np: true }); for (let i = 0; i < 6; i++) { const x = -W / 3 + (i % 3) * W / 3, y = -D / 4 + Math.floor(i / 3) * D / 2; p.cyl(x, y, 20, 52, 34, "#d89a4e", { seg: 20 }); p.cyl(x, y, 50, 50, 10, ["#f7b6d2", "#6b4f3a", "#fff6e8", "#f2d03b"][i % 4], { seg: 20, np: true }); p.cyl(x, y, 54, 16, 8, "#7a5230", { seg: 12, np: true }); } break;
      case "burger": plate(0, 0, 0, W / 2); p.cyl(-40, 0, 14, 62, 22, "#d89a4e", { seg: 20 }); p.cyl(-40, 0, 36, 64, 24, "#5a2e1a", { seg: 20 }); p.box(-40, 0, 60, 120, 120, 6, "#f2c230", { np: true }); p.cyl(-40, 0, 64, 68, 8, "#6fbf3f", { seg: 20, np: true }); p.cyl(-40, 0, 72, 50, 8, "#d0423a", { seg: 16, np: true }); p.ball(-40, 0, 80, 64, "#d89a4e", { rz: 40, seg: 18 }); for (let i = 0; i < 9; i++) p.at(80 + (i % 3) * 18, -40 + i * 9, 14, i * 0.7, () => p.box(0, 0, 0, 80, 12, 12, "#f2c230", { np: true })); break;
      case "pancakes": plate(0, 0, 0, W / 2); for (let i = 0; i < 6; i++) p.cyl(0, 0, 14 + i * 14, 80 - (i % 2) * 3, 14, "#d89a4e", { seg: 24 }); p.box(0, 0, 98, 30, 30, 14, "#ffe39a", { np: true }); p.cyl(0, 0, 96, 70, 4, "#8a4a1a", { seg: 24, np: true }); for (const [x, y] of [[60, -50], [-55, 60], [70, 40]]) p.ball(x, y, 22, 10, "#3a3fa8", { np: true }); break;
      case "turkey": p.cyl(0, 0, 0, W / 2 - 20, 18, CHINA, { ry: D / 2 - 10, seg: 32 }); p.ball(0, 0, 18 + 90, 150, "#b5652a", { ry: 115, rz: 100, seg: 20 }); for (const s of [-1, 1]) { p.ball(s * 120, -90, 70, 55, "#a85520", { ry: 40, rz: 35 }); p.cyl(s * 150, -150, 60, 12, 40, "#f4eee4", { seg: 6, np: true }); } for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.ball(Math.cos(a) * (W / 2 - 60), Math.sin(a) * (D / 2 - 50), 30, 18, i % 2 ? "#6fbf3f" : "#e8732a", { np: true }); } break;
      case "salad": bowl(0, 0, 0, W / 2, 120, "$"); for (let i = 0; i < 14; i++) { const a = i * 2.39, r = 25 + (i % 4) * 25; p.ball(Math.cos(a) * r, Math.sin(a) * r, 110, 32, ["#6fbf3f", "#4f8f3c", "#9fd06a"][i % 3], { rz: 18, np: i > 2 }); } for (const [x, y] of [[30, 20], [-40, -10], [10, -50]]) p.ball(x, y, 128, 14, "#d0423a", { np: true }); break;
      case "sushi": p.box(0, 0, 0, W, D, 22, "#2b2f36"); for (let i = 0; i < 8; i++) { const x = -W / 2 + 50 + (i % 4) * ((W - 100) / 3), y = i < 4 ? -D * 0.2 : D * 0.2; if (i % 2) { p.cyl(x, y, 22, 26, 40, BLACK, { seg: 14 }); p.cyl(x, y, 62, 22, 2, WHITE, { seg: 14, np: true }); p.cyl(x, y, 63, 9, 2, "#ff7a4a", { seg: 10, np: true }); } else { p.ball(x, y, 22 + 18, 34, WHITE, { ry: 18, rz: 18 }); p.box(x, y, 50, 80, 36, 12, i % 4 ? "#ff7a4a" : "#d0423a", { np: true }); } } p.ball(W / 2 - 40, D / 2 - 30, 30, 18, "#7fbf3f", { np: true }); break;
      case "cheese": board(0, 0, 0, W, D); for (const [x, y, w, c] of [[-120, -30, 90, "#f2c94c"], [-20, 40, 70, "#f7e7a8"], [90, -40, 80, "#e8a317"]]) p.at(x, y, 18, 0.3, () => p.box(0, 0, 0, w, w * 0.8, 50, c)); for (let i = 0; i < 9; i++) p.ball(110 + (i % 3) * 22, 50 + Math.floor(i / 3) * 20, 34 + (i % 2) * 8, 13, "#6b2a5a", { np: true }); for (let i = 0; i < 5; i++) p.cyl(-60 + i * 30, -80, 18, 28, 6, "#e8c88e", { seg: 14, np: true }); break;
      case "wine": p.cyl(0, 0, 0, 38, 220, "$", { seg: 16 }); p.cyl(0, 0, 220, 38, 50, "$", { rt: 14, seg: 16 }); p.cyl(0, 0, 270, 14, 60, "$", { seg: 12 }); p.cyl(0, 0, 320, 15, 25, GOLD, { seg: 12, np: true }); p.box(0, -37, 70, 60, 4, 90, CREAM, { np: true }); glassCup(-110, 40, 0, "#6a0f1e"); glassCup(110, 40, 0, "#6a0f1e"); break;
      case "mugs": for (const s of [-1, 1]) { p.cyl(s * 70, 0, 0, 40, 100, s < 0 ? "$" : WHITE, { seg: 18 }); p.cyl(s * 70, 0, 92, 35, 6, "#4a2a18", { seg: 18, np: true }); p.box(s * 70 + 45, 0, 25, 18, 14, 55, s < 0 ? "$" : WHITE, { np: true }); } break;
      case "tea": p.ball(0, 0, 90, 90, "$", { rz: 80, seg: 18 }); p.cyl(0, 0, 0, 55, 20, "$", { seg: 18 }); p.ball(0, 0, 175, 28, "$d", { rz: 18 }); p.at(80, 0, 90, 0, () => p.cyl(0, 0, 0, 14, 90, "$", { rt: 8, seg: 10 }), 0, 0.8); p.box(-95, 0, 50, 20, 18, 90, "$", { np: true }); for (const s of [-1, 1]) { p.cyl(s * 190, -60, 0, 55, 8, "$", { seg: 20 }); p.cyl(s * 190, -60, 8, 30, 55, "$", { rt: 42, seg: 18 }); } break;
      case "spaghetti": plate(0, 0, 0, W / 2); p.ball(0, 0, 14 + 20, 85, "#f2d07a", { rz: 40, seg: 18 }); p.ball(0, 0, 60, 55, "#c8322a", { rz: 18, np: true }); for (const [x, y] of [[-25, -10], [25, 15], [0, 30]]) p.ball(x, y, 78, 18, "#6b3a22", { np: true }); p.box(90, 70, 14, 16, 170, 3, STEEL, { np: true }); break;
      case "sandwiches": board(0, 0, 0, W, D, "$"); for (let i = 0; i < 4; i++) p.at(-W / 4 + (i % 2) * W / 2, -D / 5 + Math.floor(i / 2) * D * 0.4, 18, i * 0.6, () => { p.box(0, 0, 0, 100, 100, 14, "#e8c88e"); p.box(0, 0, 14, 104, 104, 10, "#6fbf3f", { np: true }); p.box(0, 0, 24, 100, 100, 10, "#d88a8a", { np: true }); p.box(0, 0, 34, 100, 100, 14, "#e8c88e", { np: true }); }); break;
      case "soup": plate(0, 0, 0, 125); bowl(0, 0, 14, 90, 70); p.cyl(0, 0, 70, 78, 4, "#d0702a", { seg: 24, np: true }); p.box(110, 0, 14, 20, 160, 3, STEEL, { np: true }); p.ball(-140, 80, 0 + 35, 50, "#c88a45", { ry: 30, rz: 30 }); break;
      case "watermelon": plate(0, 0, 0, W / 2, "$"); for (let i = 0; i < 3; i++) p.at(-80 + i * 80, 0, 14, 0.15 * (i - 1), () => { p.box(0, 0, 0, 40, 170, 20, "#3f7f3a"); p.box(0, 0, 20, 40, 160, 60, "#ef4a5a", { np: true }); p.box(0, 0, 80, 40, 120, 25, "#ef4a5a", { np: true }); }); break;
      case "breakfast": p.box(-100, 40, 0, 190, 60, 280, "$"); p.box(-100, 8, 70, 150, 4, 120, "#f2c230", { np: true }); p.box(100, 60, 0, 80, 80, 200, WHITE); p.box(100, 60, 200, 80, 40, 40, "#3d8fd6", { np: true }); bowl(30, -90, 0, 80, 60); for (let i = 0; i < 6; i++) p.ball(30 + Math.cos(i) * 35, -90 + Math.sin(i) * 35, 60, 12, "#e8a317", { np: true }); break;
      case "candles": for (const s of [-1, 1]) { p.cyl(s * 120, 0, 0, 55, 20, GOLD, { seg: 18 }); p.cyl(s * 120, 0, 20, 12, 220, GOLD, { seg: 10 }); p.cyl(s * 120, 0, 240, 30, 20, GOLD, { rt: 40, seg: 14 }); p.cyl(s * 120, 0, 260, 16, 170, "$", { seg: 12 }); p.cone(s * 120, 0, 432, 8, 30, "#ffb347", { seg: 6, np: true }); } break;
      case "cookies": plate(0, 0, 0, W / 2); for (let i = 0; i < 9; i++) { const a = i * 2.4, r = (i % 3) * 35 + 10; p.cyl(Math.cos(a) * r, Math.sin(a) * r, 14 + Math.floor(i / 3) * 14, 36, 12, "#c8863e", { seg: 16 }); p.ball(Math.cos(a) * r + 10, Math.sin(a) * r, 28 + Math.floor(i / 3) * 14, 7, "#3b2414", { np: true }); } break;
      default: plate(0, 0, 0, Math.min(W, D) / 2);
    }
  };

  // ------------------------------------------------------------------ people
  // a simple figure: o = { skin, hair, pants, shoes, pose: stand | walk | wave | sit | wheel | cane, kid, dress, long, u (height for sitting) }
  B.person = (p, W, D, H, o) => {
    const u = o.u || H, skin = o.skin || "#e0ac85", hair = o.hair || "#3b2414", pants = o.pants || "#2f3b52", shoe = o.shoes || DARK, kid = !!o.kid;
    const hr = u * (kid ? 0.085 : 0.063), legL = u * (kid ? 0.43 : 0.47), sitZ = kid ? 300 : 440;
    const pose = o.pose || "stand", sit = pose === "sit" || pose === "wheel";
    const hipZ = sit ? sitZ + u * 0.04 : legL + u * 0.03, shZ = hipZ + u * (kid ? 0.3 : 0.33), lean = pose === "cane" ? 0.12 : 0;
    const legR = u * 0.045;
    // legs
    for (const s of [-1, 1]) {
      if (sit) {
        const thigh = u * 0.25;
        p.at(s * u * 0.055, 0, hipZ, 0, () => p.cyl(0, 0, -thigh, legR * 1.1, thigh, pants, { rt: legR * 1.2, seg: 10 }), -Math.PI / 2);
        p.cyl(s * u * 0.055, -thigh, u * 0.03, legR, hipZ - u * 0.03, pants, { seg: 10 });
        p.box(s * u * 0.055, -thigh - u * 0.03, 0, u * 0.07, u * 0.15, u * 0.035, shoe);
      } else {
        const sw = pose === "walk" ? s * 0.3 : 0;
        p.at(s * u * 0.055, 0, hipZ, 0, () => { p.cyl(0, 0, -hipZ + u * 0.03, legR, hipZ - u * 0.03, pants, { rt: legR * 1.15, seg: 10 }); p.box(0, -u * 0.025, -hipZ, u * 0.07, u * 0.15, u * 0.035, shoe); }, sw);
      }
    }
    // body, turned a little forward for someone with a cane
    p.at(0, 0, hipZ, 0, () => {
      const T = shZ - hipZ;
      p.cyl(0, 0, -u * 0.04, u * 0.1, u * 0.09, pants, { ry: u * 0.065, seg: 16 });
      if (o.dress && !sit) p.cyl(0, 0, -u * 0.26, u * 0.17, u * 0.3, "$", { rt: u * 0.105, ry: u * 0.12, seg: 18 });
      p.cyl(0, 0, 0, u * 0.1, T, "$", { rt: u * 0.125, ry: u * 0.062, seg: 16 });
      p.cyl(0, 0, T, u * 0.028, u * 0.05, skin, { seg: 10 });
      const hz = T + u * 0.05 + hr;
      p.ball(0, 0, hz, hr, skin, { rz: hr * 1.12, seg: 16 });
      p.ball(0, hr * 0.15, hz + hr * 0.3, hr * 1.05, hair, { rz: hr * 0.85, seg: 16 });
      if (o.long) p.box(0, hr * 0.55, hz - hr * 1.6, hr * 1.8, hr * 0.7, hr * 2.1, hair, { np: true });
      // arms
      for (const s of [-1, 1]) {
        let rx = 0, ry = -s * 0.12;
        if (pose === "walk") rx = -s * 0.35;
        if (pose === "wave" && s > 0) ry = -2.7;
        if (sit) rx = -0.7;
        if (pose === "cane" && s > 0) rx = -0.35;
        p.at(s * u * 0.135, 0, T - u * 0.02, 0, () => { p.cyl(0, 0, -u * 0.17, u * 0.034, u * 0.17, "$", { seg: 10 }); p.cyl(0, 0, -u * 0.33, u * 0.026, u * 0.16, skin, { seg: 10, np: true }); p.ball(0, 0, -u * 0.35, u * 0.033, skin, { np: true }); }, rx, ry);
      }
    }, lean);
    if (pose === "cane") p.at(u * 0.17, -u * 0.12, 0, 0, () => { p.cyl(0, 0, 0, 12, u * 0.5, "#5d3b2c", { seg: 8 }); p.cylX(-20, 0, u * 0.5, 14, 80, "#5d3b2c", { np: true }); }, 0.05);
    if (pose === "wheel") {
      for (const s of [-1, 1]) { p.at(s * (u * 0.2 + 30), 60, 300, 0, () => { p.cylX(0, 0, 0, 300, 30, BLACK, { seg: 28 }); p.cylX(s * 20, 0, 0, 270, 12, METAL, { seg: 28, np: true }); }); p.ball(s * u * 0.15, -u * 0.32, 60, 60, BLACK, { ry: 25, np: true }); }
      p.box(0, -u * 0.05, sitZ - 40, u * 0.38, u * 0.3, 40, DARK);
      p.box(0, u * 0.1, sitZ, u * 0.38, 30, u * 0.3, DARK);
      p.box(0, -u * 0.3, 80, u * 0.3, 150, 20, METAL, { np: true });
    }
  };

  // ------------------------------------------------------------------ greenhouses
  const pots = (p, x0, x1, y, z, n, seed) => {
    const cs = ["#5f9e3a", "#7fbf3f", "#3f7f3a", "#9fd06a"], fl = ["#e06aa8", "#f2c230", "#d0423a", "#ffffff", "#6b4f8a"];
    for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * ((x1 - x0) / n), k = (seed + i * 7) % 5; p.cyl(x, y, z, 55, 120, POT, { rt: 70, seg: 12 }); p.ball(x, y, z + 175, 75 + (k % 3) * 15, cs[k % 4], { rz: 70, seg: 10 }); if (k % 2) p.ball(x + 25, y - 30, z + 230, 20, fl[k], { np: true }); }
  };
  const bench = (p, x, y, w, d, h, pn = true) => { p.box(x, y, h - 40, w, d, 40, "#9a7350"); for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.box(x + i * (w / 2 - 30), y + j * (d / 2 - 30), 0, 40, 40, h - 40, "#9a7350", { np: true }); p.box(x, y, 150, w - 40, d - 40, 20, "#9a7350", { np: true }); if (pn) pots(p, x - w / 2, x + w / 2, y, h, Math.max(2, Math.round(w / 260)), Math.round(x + y)); };
  const glassWall = (p, x, y, z, w, d, h, frame, n) => {
    p.box(x, y, z, w, d, h, "glass");
    const along = w >= d, L = along ? w : d, k = n || Math.max(1, Math.round(L / 650));
    for (let i = 0; i <= k; i++) { const t = -L / 2 + (L / k) * i; p.box(along ? x + t : x, along ? y : y + t, z, 40, 40, h, frame, { np: i > 0 && i < k }); }
    p.box(x, y, z + h - 30, along ? w : 40, along ? 40 : d, 30, frame, { np: true });
    p.box(x, y, z + h * 0.45, along ? w : 40, along ? 40 : d, 25, frame, { np: true });
  };
  B.greenhouse = (p, W, D, H, o) => {
    const fr = o.frame || "$", st = o.style || "gable", kw = o.knee ?? 450, knee = o.kneeCol || "#a7a197";
    if (st === "gable" || st === "lean") {
      const eave = st === "lean" ? H * 0.68 : H * 0.62;
      // knee wall
      if (kw) for (const [x, y, w, d] of [[0, -D / 2 + 50, W, 100], [0, D / 2 - 50, W, 100], [-W / 2 + 50, 0, 100, D], [W / 2 - 50, 0, 100, D]]) { if (st === "lean" && y > 0 && d === 100) continue; p.box(x, y, 0, w, d, kw, knee); }
      const z0 = kw;
      // walls: the long sides along X (front at -Y), the ends along Y; a door in the front
      glassWall(p, -W / 4 - 220, -D / 2 + 50, z0, W / 2 - 440, 20, eave - z0, fr);
      glassWall(p, W / 4 + 220, -D / 2 + 50, z0, W / 2 - 440, 20, eave - z0, fr);
      p.box(0, -D / 2 + 50, 0, 900, 20, eave, "glass"); for (const s of [-1, 1]) p.box(s * 450, -D / 2 + 50, 0, 50, 60, eave, fr); p.box(0, -D / 2 + 50, eave - 50, 950, 60, 50, fr, { np: true }); p.box(380, -D / 2 + 20, eave * 0.45, 20, 30, 120, METAL, { np: true });
      if (st === "gable") glassWall(p, 0, D / 2 - 50, z0, W, 20, eave - z0, fr);
      for (const s of [-1, 1]) glassWall(p, s * (W / 2 - 50), 0, z0, 20, D, (st === "lean" ? eave : eave) - z0, fr);
      if (st === "gable") {
        const rise = H - eave, half = W / 2, a = Math.atan2(rise, half), L = Math.hypot(rise, half);
        for (const s of [-1, 1]) p.at(s * half / 2, 0, eave + rise / 2, 0, () => { p.box(0, 0, -4, L, D, 8, "glass"); for (let k = 0; k <= Math.round(D / 650); k++) p.box(0, -D / 2 + k * (D / Math.round(D / 650)), 0, L, 40, 40, fr, { np: true }); }, 0, s * a);
        p.box(0, 0, H - 30, 60, D + 40, 60, fr);
        for (const y of [-D / 2 + 50, D / 2 - 50]) p.at(0, y, eave, 0, () => p.poly([[-half, 0], [half, 0], [0, rise]], -10, 20, "glass"), Math.PI / 2);
        // roof vents
        p.at(-half / 2, D / 4, eave + rise / 2 + 30, 0, () => p.box(0, 0, 0, L * 0.4, 600, 20, "glass", { np: true }), 0, -a - 0.25);
      } else {
        // lean-to: one slope from the wall at the back (+Y) down to the front
        const rise = H - eave, a = Math.atan2(rise, D), L = Math.hypot(rise, D);
        p.at(0, 0, eave + rise / 2, 0, () => { p.box(0, 0, -4, W, L, 8, "glass"); for (let k = 0; k <= Math.round(W / 650); k++) p.box(-W / 2 + k * (W / Math.round(W / 650)), 0, 0, 40, L, 40, fr, { np: true }); }, -a);
        for (const s of [-1, 1]) p.at(s * (W / 2 - 50), 0, eave, Math.PI / 2, () => p.poly([[-D / 2, 0], [D / 2, 0], [D / 2, rise]], -10, 20, "glass"), Math.PI / 2);
        p.box(0, D / 2 - 30, 0, W, 60, H, fr, { np: true });
      }
      if (o.inside !== false) { bench(p, -W / 2 + 400, 120, 500, D - 600, 800); bench(p, W / 2 - 400, 120, 500, D - 600, 800); if (W > 2600) { p.box(0, 200, 0, W - 1900, D - 900, 300, "#8a6a48"); p.box(0, 200, 300, W - 2000, D - 1000, 20, SOIL, { np: true }); for (let i = 0; i < 6; i++) p.ball(-W / 4 + 100 + (i % 3) * (W / 6), 0 + Math.floor(i / 3) * (D / 3), 400, 110, LEAF, { rz: 90 }); } }
      return;
    }
    if (st === "hoop") {
      // a polytunnel: hoops along Y covered in clear plastic
      const R = Math.min(W / 2, H), n = 12, hoops = Math.max(3, Math.round(D / 1200));
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI, am = (a0 + a1) / 2, ch = 2 * R * Math.sin(Math.PI / n / 2);
        const x = Math.cos(am) * R * Math.cos(Math.PI / n / 2), z = Math.sin(am) * R * Math.cos(Math.PI / n / 2) * (H / R);
        p.at(x, 0, z, 0, () => { p.box(0, 0, -3, ch * 1.02, D, 6, "glass", { np: i !== 0 && i !== n - 1 }); for (let k = 0; k <= hoops; k++) p.box(0, -D / 2 + (k * D) / hoops, 0, ch * 1.02, 40, 40, fr, { np: true }); }, 0, -(am - Math.PI / 2));
      }
      const arc = []; for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI; arc.push([Math.cos(a) * R, Math.sin(a) * H]); }
      for (const y of [-D / 2, D / 2]) p.at(0, y, 0, 0, () => p.poly(arc, -10, 20, "glass"), Math.PI / 2);
      p.box(0, -D / 2, 0, 900, 60, 2000, fr); p.box(0, -D / 2, 0, 800, 70, 1950, "glass", { np: true });
      if (o.inside !== false) for (const s of [-1, 1]) { p.box(s * W * 0.27, 0, 0, W * 0.3, D - 800, 300, "#8a6a48"); p.box(s * W * 0.27, 0, 300, W * 0.28, D - 850, 20, SOIL, { np: true }); for (let k = 0; k < Math.round((D - 1000) / 600); k++) { p.cyl(s * W * 0.27, -D / 2 + 700 + k * 600, 320, 15, 900, "#8a6a48", { seg: 6, np: true }); p.ball(s * W * 0.27, -D / 2 + 700 + k * 600, 900, 160, LEAF, { rz: 300 }); p.ball(s * W * 0.27 + 60, -D / 2 + 640 + k * 600, 750, 35, "#d0423a", { np: true }); } }
      return;
    }
    if (st === "victorian") {
      // an octagonal conservatory with a glass roof and a finial
      const R = W / 2, eave = H * 0.55;
      p.cyl(0, 0, 0, R, kw, knee, { seg: 8 });
      p.cyl(0, 0, kw, R - 40, eave - kw, "glass", { seg: 8 });
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; p.box(Math.sin(a) * (R - 30), -Math.cos(a) * (R - 30), 0, 60, 60, eave, fr); }
      p.cyl(0, 0, eave, R + 30, 80, fr, { seg: 8 });
      p.cone(0, 0, eave + 80, R, H - eave - 300, "glass", { seg: 8 });
      // rafters from each corner up to the top
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, hh = H - eave - 300, L = Math.hypot(R, hh); p.at(Math.sin(a) * R / 2, -Math.cos(a) * R / 2, eave + 80 + hh / 2, a, () => p.box(0, 0, -20, 40, L, 40, fr, { np: true }), Math.atan2(hh, R)); }
      p.cyl(0, 0, H - 300, 30, 200, fr, { seg: 10 }); p.ball(0, 0, H - 60, 60, fr);
      if (o.inside !== false) { B.table(p, 900, 900, 740, { round: true, ped: true, top: "glass" }); for (const a of [0.6, 2.2, 3.9, 5.4]) p.at(Math.cos(a) * 650, Math.sin(a) * 650, 0, a + Math.PI / 2, () => B.chair(p, 440, 450, 900, {})); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; p.at(Math.cos(a) * (R - 300), Math.sin(a) * (R - 300), 0, 0, () => B.plant(p, 420, 420, 1300, { tall: k % 2 === 0, pot: POT })); } }
      return;
    }
    if (st === "coldframe") {
      const hb = H * 0.55;
      p.box(0, D / 2 - 30, 0, W, 60, H, "$"); p.box(0, -D / 2 + 30, 0, W, 60, hb, "$");
      for (const s of [-1, 1]) p.at(s * (W / 2 - 30), 0, 0, Math.PI / 2, () => p.poly([[-D / 2, 0], [D / 2, 0], [D / 2, H], [-D / 2, hb]], -30, 60, "$"), Math.PI / 2);
      const a = Math.atan2(H - hb, D), L = Math.hypot(H - hb, D);
      p.at(0, 0, (H + hb) / 2 + 10, 0, () => { p.box(0, 0, 0, W, L, 8, "glass"); p.box(0, 0, 0, 40, L, 30, "$d", { np: true }); }, -a);
      p.box(0, 0, 0, W - 120, D - 120, 120, SOIL, { np: true });
      for (let i = 0; i < 8; i++) p.ball(-W / 2 + 120 + (i % 4) * ((W - 240) / 3), -D / 4 + Math.floor(i / 4) * (D / 2), 170, 70, "#7fbf3f", { rz: 50, np: true });
    }
  };
  B.pottingbench = (p, W, D, H) => {
    p.box(0, 0, 850, W, D, 40, "$"); legs4(p, W, D, 850, 60, "$d", 0); p.box(0, 0, 200, W - 60, D - 60, 25, "$", { np: true });
    p.box(0, D / 2 - 15, 890, W, 30, H - 890, "$");
    p.box(0, D / 2 - 120, H - 300, W, 220, 25, "$"); pots(p, -W / 2, W / 2, D / 2 - 120, H - 275, Math.max(2, Math.round(W / 250)), 3);
    p.box(-W / 4, -D / 4, 890, 300, 220, 140, "#8a6a48"); p.box(-W / 4, -D / 4, 1010, 280, 200, 20, SOIL, { np: true });
    p.cyl(W / 4, -50, 890, 70, 180, "#4f8f3c", { rt: 80 }); p.cyl(W / 4 + 120, -50, 1050, 12, 160, "#4f8f3c", { np: true });
  };
  B.plantshelf = (p, W, D, H) => {
    for (const s of [-1, 1]) p.box(s * (W / 2 - 20), 0, 0, 40, D, H, "$");
    const n = 4;
    for (let k = 0; k < n; k++) { const z = 200 + k * ((H - 300) / (n - 1)); p.box(0, 0, z, W, D, 25, "$"); for (let i = 0; i < Math.round(W / 300); i++) { const x = -W / 2 + 150 + i * 300; p.box(x, 0, z + 25, 280, D - 40, 60, BLACK, { np: true }); for (let c = 0; c < 6; c++) p.ball(x - 100 + (c % 3) * 100, -D / 4 + Math.floor(c / 3) * D / 2 * 0.9, z + 100, 28, "#7fbf3f", { rz: 22, np: true }); } }
  };
  B.raisedbed = (p, W, D, H, o) => {
    for (const [x, y, w, d] of [[0, -D / 2 + 25, W, 50], [0, D / 2 - 25, W, 50], [-W / 2 + 25, 0, 50, D], [W / 2 - 25, 0, 50, D]]) p.box(x, y, 0, w, d, H, "$");
    p.box(0, 0, 0, W - 100, D - 100, H - 40, SOIL);
    const n = Math.max(2, Math.round(W / 400));
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
      const x = -W / 2 + 200 + i * ((W - 400) / Math.max(1, n - 1)), y = j ? D / 4 : -D / 4;
      if (o.crop === "tomato") { p.cyl(x, y, H - 40, 120, 900, "#8a9099", { rt: 160, seg: 6, np: true }); p.ball(x, y, H + 500, 200, LEAF, { rz: 420 }); for (let t = 0; t < 4; t++) p.ball(x + Math.cos(t * 1.7) * 150, y + Math.sin(t * 1.7) * 150, H + 300 + t * 80, 40, "#d0423a", { np: true }); }
      else if (o.crop === "herbs") p.ball(x, y, H, 120, ["#5f9e3a", "#7fbf3f", "#9fd06a"][(i + j) % 3], { rz: 110 });
      else { p.ball(x, y, H + 20, 140, "#4f8f3c", { rz: 90 }); p.ball(x, y, H + 40, 60, (i + j) % 2 ? "#e8732a" : "#b9d96a", { np: true }); }
    }
  };
  B.citrus = (p, W, D, H) => { p.cyl(0, 0, 0, W * 0.32, 450, POT, { rt: W * 0.42, seg: 16 }); p.cyl(0, 0, 450, 30, H * 0.4, "#6b4a2b", { seg: 8 }); p.ball(0, 0, H - W * 0.45, W * 0.5, "#3f7f3a", { seg: 16 }); for (let i = 0; i < 9; i++) { const a = i * 2.39, h = (i % 3) * 0.25; p.ball(Math.cos(a) * W * 0.42, Math.sin(a) * W * 0.42, H - W * 0.45 + (h - 0.25) * W * 0.6, 40, "#ff9f1a", { np: true }); } };
  B.hanging = (p, W, D, H, o) => { const z = o.z || 1800; p.cyl(0, 0, z + 250, 4, H - 250, METAL, { seg: 4, np: true }); p.cyl(0, 0, z, W * 0.32, 180, "#6b4a2b", { rt: W * 0.42, seg: 14 }); p.ball(0, 0, z + 220, W * 0.45, "#5f9e3a", { rz: 160 }); for (let i = 0; i < 6; i++) { const a = i * 1.05; p.ball(Math.cos(a) * W * 0.4, Math.sin(a) * W * 0.4, z + 60 - (i % 2) * 150, 60, "#4f8f3c", { np: true }); p.ball(Math.cos(a) * W * 0.3, Math.sin(a) * W * 0.3, z + 300, 22, ["#e06aa8", "#f2c230", "#ffffff"][i % 3], { np: true }); } };
  B.rainbarrel = (p, W, D, H) => { p.cyl(0, 0, 0, W / 2, H, "$", { seg: 24 }); for (const z of [H * 0.2, H * 0.8]) p.cyl(0, 0, z, W / 2 + 10, 40, "$d", { seg: 24, np: true }); p.cylY(0, -W / 2 - 20, 160, 18, 60, STEEL, { np: true }); p.cyl(0, 0, H, W / 2 - 40, 10, BLACK, { seg: 24, np: true }); };
  B.wheelbarrow = (p, W, D, H) => { p.at(0, -D / 2 + 180, 180, 0, () => p.cylX(0, 0, 0, 180, 90, BLACK, { seg: 20 })); p.cyl(0, 40, 300, 260, H - 300, "$", { rt: 340, ry: 330, seg: 18 }); for (const s of [-1, 1]) { p.box(s * 240, D / 2 - 350, 380, 40, 700, 40, "#8a6a48"); p.box(s * 220, 200, 0, 40, 40, 350, METAL, { np: true }); } };
  B.compost = (p, W, D, H) => { for (const [x, y, w, d] of [[0, D / 2 - 25, W, 50], [-W / 2 + 25, 0, 50, D], [W / 2 - 25, 0, 50, D]]) for (let k = 0; k < 6; k++) p.box(x, y, k * (H / 6), w, d, H / 6 - 20, "$"); p.box(0, 30, 0, W - 100, D - 60, H * 0.7, "#4a3020"); };
  B.orchids = (p, W, D, H) => { B.table(p, W, D, H - 400, { round: false, top: "$" }); for (let i = 0; i < Math.round(W / 220); i++) { const x = -W / 2 + 110 + i * 220; p.cyl(x, 0, H - 400, 50, 120, "#f4f6f8", { rt: 60, seg: 12 }); for (let k = 0; k < 3; k++) p.ball(x + 30 - k * 20, -20 + k * 10, H - 400 + 120 + 30, 70, "#3f7f3a", { ry: 18, rz: 8, np: true }); p.cyl(x, 0, H - 260, 4, 230, "#5f9e3a", { seg: 4, np: true }); for (let k = 0; k < 4; k++) p.ball(x + 20 + k * 22, -10, H - 60 - k * 30, 26, ["#e06aa8", "#ffffff", "#b06ad8"][i % 3], { ry: 12, np: true }); } };
}

// [category, id, name, builder, width, depth, height (inches), colour, options]
const SKIN = ["#f1c7a5", "#e0ac85", "#c68a5f", "#a86e45", "#7a4a2a", "#4e2f1c"];
export const MORE_ITEMS = [
  // luxury
  ["luxury", "canopybed", "Four-poster canopy bed (king)", "canopybed", 84, 90, 96, "#efe6d6", { wood: "#3b2414", drape: "#f3ead8" }],
  ["luxury", "chesterfield", "Chesterfield sofa, leather", "chesterfield", 90, 38, 30, "#6b2e1a", { seats: 3 }],
  ["luxury", "chesterfieldV", "Chesterfield sofa, emerald velvet", "chesterfield", 84, 38, 30, "#1f5c45", { seats: 3 }],
  ["luxury", "chaise", "Velvet chaise lounge", "chaise", 66, 26, 32, "#7a2a4a", {}],
  ["luxury", "crystal", "Crystal chandelier", "crystal", 40, 40, 40, GOLD, { z: 1850 }],
  ["luxury", "crystalG", "Grand crystal chandelier (foyer)", "crystal", 60, 60, 70, GOLD, { z: 3000, tiers: 4 }],
  ["luxury", "grandW", "Concert grand piano, white", "grandpiano", 62, 108, 40, "#f6f5f1", {}],
  ["luxury", "fireMarble", "Marble fireplace", "fireplace", 72, 20, 52, "#efece6", { stone: "#efece6", mantel: "#e3ded4" }],
  ["luxury", "stonetub", "Freestanding stone tub", "stonetub", 70, 34, 24, "#f2f0ec", { water: true }],
  ["luxury", "goldclaw", "Clawfoot tub, gold feet", "claw", 67, 31, 30, "#1b1d22", {}],
  ["luxury", "rainshower", "Rain shower, glass and gold", "rainshower", 72, 48, 96, "#e9e5dc", { trim: GOLD }],
  ["luxury", "vanityLux", 'Double vanity 84", marble', "vanity", 84, 22, 34, "#2b3a4a", { dbl: true, top: MARBLE, mirror: true }],
  ["luxury", "waterfall", "Waterfall marble island", "waterfall", 120, 48, 36, "#2b3a4a", { stools: 4 }],
  ["luxury", "prorange", 'Pro range 48", brass knobs', "prorange", 48, 28, 36, "#c3c8cd", { knob: GOLD }],
  ["luxury", "prohood", "Range hood, brass", "hood", 48, 24, 40, PALE_GOLD, { z: 1650 }],
  ["luxury", "fridge48", 'Built-in refrigerator 48"', "fridge", 48, 26, 84, "#c3c8cd", { type: "sbs" }],
  ["luxury", "winewall", "Wine wall (glass front)", "winewall", 72, 18, 96, "#3b2414", {}],
  ["luxury", "winefridge", "Wine refrigerator", "winefridge", 24, 24, 34, "#2b2f36", {}],
  ["luxury", "library", "Library wall with ladder", "library", 144, 14, 108, "#3b2414", {}],
  ["luxury", "theater", "Home theater seats (3)", "theater", 108, 40, 42, "#1b1d22", { seats: 3 }],
  ["luxury", "theater4", "Home theater seats (4)", "theater", 144, 40, 42, "#6b1a24", { seats: 4 }],
  ["luxury", "dining10", "Marble dining table, 10 chairs", "dining", 132, 72, 30, MARBLE, { ch: 10 }],
  ["luxury", "statue", "Statue on a plinth", "statue", 24, 24, 84, "#d6d0c4", {}],
  ["luxury", "fountain", "Tiered fountain", "fountain", 96, 96, 96, "#d6d0c4", { free: true }],
  ["luxury", "swimpool", "Swimming pool 16' × 32'", "swimpool", 192, 384, 12, "#e6dfd2", { free: true }],
  ["luxury", "sauna", "Sauna room", "sauna", 72, 72, 84, "#c8935a", {}],
  ["luxury", "closetisland", "Closet island, glass top", "closetisland", 60, 36, 38, "#f0ece4", {}],
  ["luxury", "goldmirror", "Ornate gold mirror", "mirror", 40, 4, 60, GOLD, { z: 1000, ornate: true, frame: GOLD }],
  ["luxury", "floormirror", "Gold floor mirror", "mirrorfloor", 32, 18, 84, GOLD, {}],
  ["luxury", "goldpendant", "Brass pendant light", "pendant", 18, 18, 30, PALE_GOLD, { z: 1650 }],
  // food and table settings: they sit on the table, counter or shelf they are put on
  ["food", "setting", "Place setting", "food", 22, 16, 7, "#c8243a", { f: "setting" }],
  ["food", "pizza", "Pizza on a board", "food", 14, 16, 2, "#b5834e", { f: "pizza" }],
  ["food", "cake", "Birthday cake on a stand", "food", 13, 13, 17, "#f7b6d2", { f: "cake" }],
  ["food", "cupcakes", "Plate of cupcakes", "food", 11, 11, 4, CHINA, { f: "cupcakes" }],
  ["food", "fruitbowl", "Fruit bowl", "food", 12, 12, 7, "#b5834e", { f: "fruitbowl" }],
  ["food", "apples", "Apples", "food", 8, 5, 3, "#c8243a", { f: "apples" }],
  ["food", "bananas", "Bunch of bananas", "food", 8, 5, 2, "#f2d03b", { f: "bananas" }],
  ["food", "bread", "Bread on a cutting board", "food", 18, 9, 5, "#b5834e", { f: "bread" }],
  ["food", "croissants", "Basket of croissants", "food", 11, 11, 5, "#b5834e", { f: "croissants" }],
  ["food", "donuts", "Box of donuts", "food", 14, 9, 3, "#f4eee4", { f: "donuts" }],
  ["food", "burger", "Burger and fries", "food", 11, 11, 6, CHINA, { f: "burger" }],
  ["food", "pancakes", "Stack of pancakes", "food", 11, 11, 4, CHINA, { f: "pancakes" }],
  ["food", "turkey", "Roast turkey platter", "food", 20, 14, 9, CHINA, { f: "turkey" }],
  ["food", "salad", "Salad bowl", "food", 12, 12, 6, "#f4f6f8", { f: "salad" }],
  ["food", "spaghetti", "Spaghetti and meatballs", "food", 11, 11, 4, CHINA, { f: "spaghetti" }],
  ["food", "sandwiches", "Sandwich platter", "food", 14, 10, 3, "#b5834e", { f: "sandwiches" }],
  ["food", "soup", "Bowl of soup and bread", "food", 14, 11, 4, CHINA, { f: "soup" }],
  ["food", "sushi", "Sushi platter", "food", 14, 7, 3, DARK, { f: "sushi" }],
  ["food", "cheese", "Cheese board", "food", 16, 10, 3, "#b5834e", { f: "cheese" }],
  ["food", "watermelon", "Watermelon slices", "food", 12, 12, 5, "#3f7f3a", { f: "watermelon" }],
  ["food", "cookies", "Plate of cookies", "food", 10, 10, 2, CHINA, { f: "cookies" }],
  ["food", "breakfast", "Cereal and milk", "food", 12, 9, 11, "#3d8fd6", { f: "breakfast" }],
  ["food", "wine", "Wine bottle and glasses", "food", 12, 6, 14, "#2f5d3a", { f: "wine" }],
  ["food", "mugs", "Coffee mugs", "food", 9, 4, 4, "#c8243a", { f: "mugs" }],
  ["food", "tea", "Teapot and cups", "food", 17, 9, 8, CHINA, { f: "tea" }],
  ["food", "candles", "Candlesticks", "food", 12, 3, 18, CREAM, { f: "candles" }],
  // people (the colour is their shirt or dress)
  ["people", "man", "Man standing", "person", 22, 12, 70, "#3d8fd6", { skin: SKIN[1], hair: "#3b2414" }],
  ["people", "woman", "Woman in a dress", "person", 22, 12, 65, "#c8243a", { skin: SKIN[3], hair: "#1b1d22", dress: true, long: true, pants: SKIN[3] }],
  ["people", "womanJ", "Woman in jeans", "person", 22, 12, 65, "#e8a317", { skin: SKIN[0], hair: "#c8913f", long: true, pants: "#3a5a8a" }],
  ["people", "manW", "Man walking", "person", 22, 18, 71, "#4f8f3c", { skin: SKIN[4], hair: "#1b1d22", pose: "walk", pants: "#6b5a44" }],
  ["people", "womanWave", "Woman waving", "person", 26, 12, 64, "#6b4f8a", { skin: SKIN[2], hair: "#3b2414", pose: "wave", long: true }],
  ["people", "manSit", "Man sitting (on a chair or sofa)", "person", 20, 26, 51, "#7d86a6", { skin: SKIN[2], hair: "#5a3b25", pose: "sit", u: 1760 }],
  ["people", "womanSit", "Woman sitting", "person", 20, 26, 48, "#d06f3c", { skin: SKIN[5], hair: "#1b1d22", pose: "sit", u: 1640, long: true, pants: "#2b2f36" }],
  ["people", "boy", "Boy (about 8)", "person", 16, 10, 50, "#e8732a", { skin: SKIN[1], hair: "#5a3b25", kid: true, pants: "#3a5a8a" }],
  ["people", "girl", "Girl (about 8)", "person", 16, 10, 49, "#f7b6d2", { skin: SKIN[4], hair: "#1b1d22", kid: true, dress: true, long: true, pants: SKIN[4] }],
  ["people", "toddler", "Toddler", "person", 12, 8, 34, "#f2c230", { skin: SKIN[0], hair: "#e0c080", kid: true }],
  ["people", "kidSit", "Child sitting", "person", 14, 18, 34, "#3d8fd6", { skin: SKIN[3], hair: "#3b2414", kid: true, pose: "sit", u: 1250 }],
  ["people", "grandpa", "Older man with a cane", "person", 24, 16, 68, "#8a7f72", { skin: SKIN[0], hair: "#d9d9d9", pose: "cane", pants: "#4a4f57" }],
  ["people", "grandma", "Older woman", "person", 22, 12, 62, "#7a9ac8", { skin: SKIN[2], hair: "#e6e6e6", dress: true, pants: SKIN[2] }],
  ["people", "wheelchair", "Person in a wheelchair", "person", 26, 40, 52, "#c8243a", { skin: SKIN[3], hair: "#1b1d22", pose: "wheel", u: 1700 }],
  // greenhouses and what goes in them
  ["green", "ghGable", "Greenhouse 8' × 10' (glass)", "greenhouse", 96, 120, 96, "#f4f6f8", { style: "gable" }],
  ["green", "ghGableL", "Greenhouse 12' × 16' (glass)", "greenhouse", 144, 192, 120, "#2b2f36", { style: "gable" }],
  ["green", "ghHoop", "Hoop house 10' × 20'", "greenhouse", 120, 240, 96, "#c3c8cd", { style: "hoop" }],
  ["green", "ghVic", "Victorian conservatory", "greenhouse", 144, 144, 168, "#f4f6f8", { style: "victorian", knee: 600, kneeCol: "#b5654a" }],
  ["green", "lean", "Lean-to greenhouse (on a wall)", "greenhouse", 120, 72, 108, "#f4f6f8", { style: "lean" }],
  ["green", "coldframe", "Cold frame", "greenhouse", 48, 30, 18, "#9a7350", { style: "coldframe" }],
  ["green", "pottingbench", "Potting bench", "pottingbench", 48, 22, 60, "#9a7350", {}],
  ["green", "plantshelf", "Seedling shelves", "plantshelf", 48, 18, 72, "#c3c8cd", {}],
  ["green", "raisedTom", "Raised bed, tomatoes", "raisedbed", 96, 36, 18, "#9a7350", { crop: "tomato" }],
  ["green", "raisedVeg", "Raised bed, vegetables", "raisedbed", 96, 36, 18, "#9a7350", {}],
  ["green", "raisedHerb", "Raised bed, herbs", "raisedbed", 48, 24, 24, "#9a7350", { crop: "herbs" }],
  ["green", "citrus", "Lemon tree in a pot", "citrus", 30, 30, 72, POT, {}],
  ["green", "orchids", "Orchid table", "orchids", 48, 20, 44, "#f4f6f8", {}],
  ["green", "hangbasket", "Hanging basket", "hanging", 16, 16, 30, "#6b4a2b", { z: 1700 }],
  ["green", "rainbarrel", "Rain barrel", "rainbarrel", 24, 24, 36, "#3f6f4a", {}],
  ["green", "wheelbarrow", "Wheelbarrow", "wheelbarrow", 26, 58, 26, "#3d8fd6", {}],
  ["green", "compost", "Compost bin", "compost", 36, 36, 36, "#9a7350", {}],
];
// items that sit on the surface below them (a table, a counter, a shelf)
export const ON_TOP = new Set(["food"]);
