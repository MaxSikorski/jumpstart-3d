// Little looping animations for the tutorial steps, like animated GIFs but drawn as SVG at
// run time (tiny in the file, sharp on every screen, and they work in Safari). Each one is a
// "scene": a function of time t (0 to 1 over one loop) that returns a list of shapes. The scene
// is sampled at FR frames and turned into SVG elements with SMIL <animate> tags, so the browser
// plays it by itself with no JavaScript running.
//
// A shape: { k: "poly", pts: [[x,y],...] } | { k: "path", d } | { k: "circle", cx, cy, r }
//          | { k: "line", x1, y1, x2, y2 } | { k: "text", x, y, s: "text" } | { k: "rect", x, y, w, h }
// plus fill, stroke, sw (stroke width), op (opacity), dash. Every frame must return the same
// shapes in the same order (hide one with op: 0).

const W = 300, H = 130, FR = 40;
const C = {
  ink: "#1b1f24", sub: "#6b7480", grid: "#c9d6ea", plane: "#e8f0fb",
  blue: ["#7fb0f2", "#4f8de0", "#2f66c8"], red: ["#f59a8a", "#e8604c", "#c2412f"], green: ["#8fdcae", "#3dbb74", "#25975a"],
  gold: ["#ffd76a", "#f0b429", "#c98c06"], purple: ["#c4a8f0", "#9b6fe0", "#7246c4"], gray: ["#e2e6ec", "#c3cad4", "#98a2b0"],
  hole: ["#ffffff", "#e9edf2", "#d5dbe3"], sel: "#2d7ff9", warn: "#e0341f",
};

// ---------------------------------------------------------------- timing helpers
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (v) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2);
// 0 before a, 1 after b, eased in between
const ph = (t, a, b) => ease(clamp((t - a) / (b - a)));
const lerp = (a, b, f) => a + (b - a) * f;
const on = (t, a, b = 2) => (t >= a && t < b ? 1 : 0);

// ---------------------------------------------------------------- 3D (isometric) helpers
// viewer at +x +y +z looking at the origin; screen y grows downward
function view(ox = 150, oy = 82, s = 1) {
  const P = (x, y, z) => [ox + (x - y) * 0.866 * s, oy + (x + y) * 0.5 * s - z * s];
  return { P, s };
}
const r1 = (v) => Math.round(v * 10) / 10;
const pts = (...ps) => ps.map((p) => [r1(p[0]), r1(p[1])]);
// a box from (x,y,z) with size w,d,h: the three faces you can see
function box(V, x, y, z, w, d, h, col, extra = {}) {
  const { P } = V, X = x + w, Y = y + d, Z = z + h;
  return [
    { k: "poly", pts: pts(P(x, Y, z), P(X, Y, z), P(X, Y, Z), P(x, Y, Z)), fill: col[1], ...extra }, // front (+y)
    { k: "poly", pts: pts(P(X, y, z), P(X, Y, z), P(X, Y, Z), P(X, y, Z)), fill: col[2], ...extra }, // right (+x)
    { k: "poly", pts: pts(P(x, y, Z), P(X, y, Z), P(X, Y, Z), P(x, Y, Z)), fill: col[0], ...extra }, // top
  ];
}
// a vertical cylinder: side band + top ellipse
function cyl(V, cx, cy, z, r, h, col, extra = {}) {
  const { P, s } = V, rx = r1(1.2247 * r * s), ry = r1(0.7071 * r * s);
  const [bx, by] = P(cx, cy, z), [tx, ty] = P(cx, cy, z + h);
  const side = `M${r1(tx - rx)} ${r1(ty)}L${r1(bx - rx)} ${r1(by)}A${rx} ${ry} 0 0 0 ${r1(bx + rx)} ${r1(by)}L${r1(tx + rx)} ${r1(ty)}Z`;
  return [
    { k: "path", d: side, fill: col[1], ...extra },
    { k: "ellipse", cx: r1(tx), cy: r1(ty), rx, ry, fill: col[0], ...extra },
  ];
}
// the workplane: a flat diamond with a few grid lines
function plane(V, n = 50, extra = {}) {
  const { P } = V, out = [{ k: "poly", pts: pts(P(-n, -n, 0), P(n, -n, 0), P(n, n, 0), P(-n, n, 0)), fill: C.plane, stroke: C.grid, sw: 1, ...extra }];
  for (let i = -n + 20; i < n; i += 20) {
    const a = P(i, -n, 0), b = P(i, n, 0), c = P(-n, i, 0), d = P(n, i, 0);
    out.push({ k: "line", x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]), stroke: C.grid, sw: 1, ...extra });
    out.push({ k: "line", x1: r1(c[0]), y1: r1(c[1]), x2: r1(d[0]), y2: r1(d[1]), stroke: C.grid, sw: 1, ...extra });
  }
  return out;
}
// the mouse pointer (tip at x,y) and a ripple when it clicks
function cursor(x, y, click = 0, op = 1) {
  const p = [[0, 0], [0, 15], [4, 11.5], [7, 18], [9.5, 17], [6.5, 10.5], [11.5, 10.5]].map(([a, b]) => [r1(x + a), r1(y + b)]);
  return [
    { k: "circle", cx: r1(x), cy: r1(y), r: r1(4 + 12 * click), fill: "none", stroke: C.sel, sw: 2, op: click > 0 && click < 1 ? 1 - click : 0 },
    { k: "poly", pts: p, fill: "#fff", stroke: C.ink, sw: 1.2, op },
  ];
}
// cursor that travels a list of [time, x, y, clickAt?] keys
function path(t, keys) {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const f = b === a ? 0 : ph(t, a[0], b[0]);
  const x = lerp(a[1], b[1], f), y = lerp(a[2], b[2], f);
  let click = 0;
  for (const k of keys) if (k[3] && t >= k[0] && t < k[0] + 0.08) click = (t - k[0]) / 0.08;
  return cursor(x, y, click);
}
const label = (x, y, s, extra = {}) => ({ k: "text", x, y, s, size: 11, fill: C.ink, weight: 600, ...extra });
// a number box like the app's fields, with text "typed" in (shown letter by letter)
function field(x, y, w, lab, val, f, active) {
  const n = Math.round(val.length * clamp(f));
  const out = [
    { k: "text", x, y: y + 12, s: lab, size: 10, fill: C.sub },
    { k: "rect", x: x + 38, y, w, h: 17, rx: 4, fill: "#fff", stroke: active ? C.sel : "#c3cad4", sw: active ? 2 : 1 },
  ];
  // one text element per prefix length, so "typing" is just showing the next one
  for (let i = 1; i <= val.length; i++) out.push({ k: "text", x: x + 43, y: y + 12.5, s: val.slice(0, i), size: 11, fill: C.ink, op: i === n ? 1 : 0, mono: true });
  return out;
}
const key = (x, y, s, down) => [
  { k: "rect", x, y: y + (down ? 1.5 : 0), w: 11 + s.length * 6.5, h: 17, rx: 4, fill: down ? "#dde6f5" : "#fff", stroke: "#98a2b0", sw: 1 },
  { k: "text", x: x + 5.5, y: y + 12.5 + (down ? 1.5 : 0), s, size: 10, fill: C.ink, weight: 700 },
];

// ---------------------------------------------------------------- the scenes
const S = {};

// type the design name
S.name = (t) => {
  const s = "Lopez, Maria, Keychain";
  const out = [
    { k: "rect", x: 0, y: 0, w: W, h: 30, fill: "#1f2633" },
    { k: "rect", x: 14, y: 6, w: 160, h: 18, rx: 4, fill: on(t, 0.12, 0.97) ? "#fff" : "#2b3444", stroke: on(t, 0.12, 0.97) ? C.sel : "#2b3444", sw: 1.5 },
    { k: "text", x: 20, y: 19, s: "Untitled", size: 11, fill: "#fff", op: t < 0.12 ? 1 : 0 },
  ];
  const n = Math.round(s.length * ph(t, 0.2, 0.75));
  for (let i = 1; i <= s.length; i++) out.push({ k: "text", x: 20, y: 19, s: s.slice(0, i), size: 11, fill: on(t, 0.97) ? "#fff" : C.ink, op: i === n ? 1 : 0 });
  out.push(...key(190, 7, "Enter", on(t, 0.8, 0.86)));
  out.push(label(14, 60, "Last name, First name, Item name", { fill: C.sub, size: 12 }));
  out.push({ k: "text", x: 14, y: 84, s: "✓ Saved as  Lopez, Maria, Keychain v1.stl", size: 11, fill: C.green[2], weight: 600, op: ph(t, 0.86, 0.92) });
  out.push(...path(t, [[0, 120, 90], [0.1, 60, 15, 1], [0.75, 60, 15], [0.8, 205, 16, 1], [1, 205, 16]]));
  return out;
};

// click a tile in Beginner's strip; the shape lands on the workplane, then the size is typed
S.tile = (kindCol = C.red, round = false) => (t) => {
  const V = view(110, 52, 0.75);
  const grow = ph(t, 0.55, 0.8), drop = ph(t, 0.16, 0.3);
  const out = [...plane(V, 45)];
  const w = lerp(30, 50, grow), h = lerp(30, 14, grow);
  const z = lerp(40, 0, drop);
  if (round) out.push(...cyl(V, 0, 0, z, w / 2, h, kindCol, { op: on(t, 0.16) })); else out.push(...box(V, -w / 2, -15, z, w, 30, h, kindCol, { op: on(t, 0.16) }));
  // the tile strip
  out.push({ k: "rect", x: 0, y: 104, w: 220, h: 26, fill: "#f4f6f9" });
  for (let i = 0; i < 4; i++) out.push({ k: "rect", x: 8 + i * 52, y: 107, w: 44, h: 20, rx: 4, fill: "#fff", stroke: i === 0 && on(t, 0.08, 0.2) ? C.sel : "#d5dbe3", sw: i === 0 && on(t, 0.08, 0.2) ? 2 : 1 });
  out.push(...(round ? cyl(view(30, 118, 0.25), 0, 0, 0, 12, 14, kindCol) : box(view(30, 118, 0.25), -12, -12, 0, 24, 24, 20, kindCol)));
  // the size fields
  out.push(...field(214, 30, 40, "Width", "50", ph(t, 0.42, 0.52), on(t, 0.4, 0.55)));
  out.push(...field(214, 56, 40, "Height", "14", ph(t, 0.62, 0.72), on(t, 0.6, 0.78)));
  out.push(...path(t, [[0, 150, 70], [0.1, 32, 116, 1], [0.3, 60, 90], [0.42, 270, 38, 1], [0.6, 270, 64, 1], [0.85, 270, 64], [1, 150, 70]]));
  return out;
};

// type the position: the shape slides over and lifts up
S.position = (t) => {
  const V = view(120, 70, 0.8);
  const fx = ph(t, 0.2, 0.4), fz = ph(t, 0.55, 0.75);
  const out = [...plane(V, 45)];
  out.push(...box(V, -30, -10, 0, 50, 20, 6, C.blue));
  out.push(...box(V, lerp(-35, -15, fx), -5, lerp(0, 6, fz), 22, 10, 4, C.red));
  out.push(...field(214, 26, 40, "X", "5", ph(t, 0.15, 0.2), on(t, 0.1, 0.4)));
  out.push(...field(214, 50, 40, "Y", "0", 1, false));
  out.push(...field(214, 74, 40, "Z", "6", ph(t, 0.5, 0.55), on(t, 0.45, 0.75)));
  out.push(label(212, 112, "Z = on top", { op: ph(t, 0.75, 0.8), fill: C.green[2] }));
  return out;
};

// rotate 90 degrees
S.rotate = (t) => {
  const V = view(120, 75, 0.8), f = ph(t, 0.3, 0.6);
  const out = [...plane(V, 45)];
  // a wedge drawn as a box that shrinks one way while growing the other (looks like a turn from above)
  const a = (f * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
  const corners = [[-30, -10], [30, -10], [30, 10], [-30, 10]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const top = corners.map(([x, y]) => V.P(x, y, 16)), bot = corners.map(([x, y]) => V.P(x, y, 0));
  out.push({ k: "poly", pts: pts(bot[0], bot[1], top[1], top[0]), fill: C.purple[1] });
  out.push({ k: "poly", pts: pts(bot[1], bot[2], top[2], top[1]), fill: C.purple[2] });
  out.push({ k: "poly", pts: pts(bot[2], bot[3], top[3], top[2]), fill: C.purple[1] });
  out.push({ k: "poly", pts: pts(...top), fill: C.purple[0] });
  out.push({ k: "path", d: "M230 40a22 22 0 1 1-8 30", fill: "none", stroke: C.sel, sw: 3 });
  out.push({ k: "poly", pts: [[216, 66], [228, 74], [225, 61]], fill: C.sel });
  out.push(label(225, 64, "90°", { size: 13 }));
  out.push(...key(220, 100, "↻ Z", on(t, 0.22, 0.3)));
  out.push(...path(t, [[0, 150, 110], [0.2, 232, 106, 1], [0.4, 232, 112], [1, 232, 112]]));
  return out;
};

// a hole shape overlaps a solid; Group cuts it out
S.hole = (round = true) => (t) => {
  const V = view(130, 62, 0.85), g = ph(t, 0.55, 0.62);
  const out = [...plane(V, 45)];
  out.push(...box(V, -35, -15, 0, 60, 30, 8, C.blue));
  // the cut-out shows after grouping: a dark ellipse on the top
  if (round) {
    out.push(...cyl(V, -20, 0, -2, 6, lerp(14, 0, 0), C.hole, { op: 1 - g, stroke: "#8c96a3", sw: 1, dash: "3 2" }));
    out.push({ k: "ellipse", cx: r1(V.P(-20, 0, 8)[0]), cy: r1(V.P(-20, 0, 8)[1]), rx: r1(1.2247 * 6 * 0.85), ry: r1(0.7071 * 6 * 0.85), fill: "#4a5563", op: g });
  } else {
    out.push(...box(V, -45, -3, 4, 80, 6, 8, C.hole, { op: 1 - g, stroke: "#8c96a3", sw: 1, dash: "3 2" }));
    out.push({ k: "poly", pts: pts(V.P(-35, -3, 8), V.P(25, -3, 8), V.P(25, 3, 8), V.P(-35, 3, 8)), fill: "#4a5563", op: g });
  }
  out.push(label(214, 28, "Hole", { op: 1 - g, fill: C.sub }));
  out.push(...key(214, 44, "Group", on(t, 0.5, 0.58)));
  out.push(label(214, 84, "cut out!", { op: g, fill: C.green[2], size: 13 }));
  return out;
};

// several shapes (and a hole) become one part
S.group = (t) => {
  const V = view(130, 66, 0.85), g = ph(t, 0.45, 0.6);
  const out = [...plane(V, 45)];
  const col = g > 0.5 ? C.green : null;
  out.push(...box(V, -35, -15, 0, 60, 30, 8, col || C.blue));
  out.push(...box(V, -5, -6, 8, 22, 12, 6, col || C.red));
  out.push(...cyl(V, -26, 0, -2, 5, 12, C.hole, { op: 1 - g, stroke: "#8c96a3", sw: 1, dash: "3 2" }));
  out.push({ k: "ellipse", cx: r1(V.P(-26, 0, 8)[0]), cy: r1(V.P(-26, 0, 8)[1]), rx: r1(1.2247 * 5 * 0.85), ry: r1(0.7071 * 5 * 0.85), fill: "#4a5563", op: g });
  // selection box dragged around everything
  const f = ph(t, 0.08, 0.3);
  out.push({ k: "rect", x: 30, y: 18, w: r1(lerp(0, 165, f)), h: r1(lerp(0, 92, f)), fill: "rgba(45,127,249,.08)", stroke: C.sel, sw: 1, dash: "4 3", op: on(t, 0.08, 0.42) });
  out.push(...key(222, 40, "Ctrl+A", on(t, 0.3, 0.36)));
  out.push(...key(222, 64, "Group", on(t, 0.42, 0.48)));
  out.push(label(222, 104, "one part", { op: g, fill: C.green[2], size: 13 }));
  out.push(...path(t, [[0, 30, 18], [0.3, 195, 110], [0.4, 250, 72], [0.42, 250, 72, 1], [1, 250, 72]]));
  return out;
};

// Tinkercad-style align: black dots, click one, the shapes line up
S.align = (t) => {
  const V = view(120, 58, 0.8), f = ph(t, 0.45, 0.65);
  const out = [...plane(V, 50)];
  out.push(...box(V, -40, lerp(-30, -10, f), 0, 30, 20, 16, C.blue));
  out.push(...box(V, 5, lerp(10, -15, f), 0, 30, 30, 10, C.red));
  // the dots along the front edge (Y) of the selection
  const ys = [-35, 0, 35];
  ys.forEach((y, i) => {
    const [x, yy] = V.P(-50, y, 0);
    out.push({ k: "circle", cx: r1(x), cy: r1(yy), r: 5.5, fill: i === 1 && t > 0.4 ? C.gold[1] : C.ink, stroke: "#fff", sw: 1.5, op: ph(t, 0.12, 0.2) });
  });
  const a = V.P(-50, -35, 0), b = V.P(-50, 35, 0);
  out.push({ k: "line", x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]), stroke: C.ink, sw: 1, dash: "4 3", op: 0.5 * ph(t, 0.12, 0.2) });
  const m = V.P(-50, 0, 0);
  out.push(label(214, 40, "Click a dot:", { fill: C.sub }));
  out.push(label(214, 56, "line up the", { fill: C.sub }));
  out.push(label(214, 72, "centers", { op: ph(t, 0.4, 0.45) }));
  out.push(...path(t, [[0, 200, 110], [0.3, m[0] + 1, m[1] + 1], [0.38, m[0] + 1, m[1] + 1, 1], [1, m[0] + 1, m[1] + 1]]));
  return out;
};

// rectangular pattern: copies appear in a row
S.pattern = (t) => {
  const V = view(140, 62, 0.8);
  const out = [...plane(V, 50)];
  out.push(...cyl(V, 0, 0, 0, 40, 6, C.blue));
  for (let i = -3; i <= 3; i++) out.push(...box(V, -45, i * 12 - 2, 3, 90, 4, 4, i === 0 ? C.red : C.gold, { op: i === 0 ? 1 : ph(t, 0.3 + Math.abs(i) * 0.1 + (i < 0 ? 0.05 : 0), 0.36 + Math.abs(i) * 0.1 + (i < 0 ? 0.05 : 0)) }));
  out.push(...field(214, 30, 34, "Count", "4", ph(t, 0.12, 0.16), on(t, 0.1, 0.25)));
  out.push(...field(214, 54, 34, "Space", "14", ph(t, 0.2, 0.25), on(t, 0.18, 0.3)));
  out.push(label(214, 96, "7 copies", { op: ph(t, 0.75, 0.8), fill: C.green[2], size: 13 }));
  return out;
};

// circular pattern: copies appear around the middle
S.cpattern = (t) => {
  const V = view(120, 68, 0.8);
  const out = [...plane(V, 50)];
  out.push(...cyl(V, 0, 0, 0, 12, 7, C.blue));
  const n = 3;
  // draw back to front
  const arms = [...Array(n)].map((_, i) => (i * 2 * Math.PI) / n).map((a, i) => ({ a, i, depth: Math.cos(a) + Math.sin(a) })).sort((p, q) => p.depth - q.depth);
  for (const { a, i } of arms) out.push(...cyl(V, r1(30 * Math.cos(a)), r1(30 * Math.sin(a)), 0, 10, 7, i === 0 ? C.red : C.gold, { op: i === 0 ? 1 : ph(t, 0.3 + i * 0.15, 0.36 + i * 0.15) }));
  out.push({ k: "path", d: "M250 38a24 24 0 1 1-24 24", fill: "none", stroke: C.sel, sw: 2.5, dash: "5 3" });
  out.push({ k: "poly", pts: [[221, 58], [226, 70], [231, 58]], fill: C.sel });
  out.push(label(238, 66, "360°", { size: 12 }));
  out.push(label(215, 112, "Count 3", { op: ph(t, 0.15, 0.2) }));
  return out;
};

// the view cube: drag it (or click a face) to turn the view
S.viewcube = (t) => {
  const a = lerp(-0.6, 0.9, ph(t, 0.15, 0.55)) - lerp(0, 1.5, ph(t, 0.7, 0.85));
  const c = Math.cos(a), s = Math.sin(a);
  const P = (x, y, z) => [r1(150 + (x * c - y * s) * 30), r1(66 + (x * s + y * c) * 15 - z * 30)];
  const faces = [
    { n: [0, -1, 0], q: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], s: "FRONT" },
    { n: [1, 0, 0], q: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], s: "RIGHT" },
    { n: [-1, 0, 0], q: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], s: "LEFT" },
    { n: [0, 1, 0], q: [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]], s: "BACK" },
  ];
  const out = [];
  // top face
  out.push({ k: "poly", pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => P(x, y, 1)), fill: "#f4f7fb", stroke: "#98a2b0", sw: 1 });
  for (const f of faces) {
    // facing the viewer when its normal, turned, points toward +screen-y (toward us)
    const ny = f.n[0] * s + f.n[1] * c;
    const vis = ny < -0.02 ? 0 : 1;
    const q = f.q.map((p) => P(...p));
    out.push({ k: "poly", pts: q, fill: "#e8edf4", stroke: "#98a2b0", sw: 1, op: vis });
    const m = P(f.n[0] * 1.001, f.n[1] * 1.001, 0);
    out.push({ k: "text", x: m[0] - 13, y: m[1] + 4, s: f.s, size: 9, fill: C.sub, weight: 700, op: vis * clamp(ny * 3) });
  }
  const tp = P(0, 0, 1);
  out.push({ k: "text", x: tp[0] - 10, y: tp[1] + 4, s: "TOP", size: 9, fill: C.sub, weight: 700 });
  out.push(label(10, 20, "Drag the cube to turn", { fill: C.sub }));
  out.push(label(10, 36, "the view, or click a face", { fill: C.sub }));
  out.push(...path(t, [[0, 120, 110], [0.12, 150, 76], [0.15, 150, 76, 1], [0.55, 205, 86], [0.7, 205, 86], [0.72, 150, 50, 1], [1, 150, 50]]));
  return out;
};

// measure: click two faces, the distance shows
S.measure = (t) => {
  const V = view(130, 70, 0.85);
  const out = [...plane(V, 45)];
  out.push(...box(V, -35, -15, 0, 60, 30, 10, C.blue));
  const a = V.P(-35, 15, 0), b = V.P(25, 15, 0);
  const f = ph(t, 0.4, 0.55);
  out.push({ k: "line", x1: r1(a[0]), y1: r1(a[1] + 14), x2: r1(lerp(a[0], b[0], f)), y2: r1(lerp(a[1], b[1], f) + 14), stroke: C.warn, sw: 2 });
  out.push({ k: "rect", x: r1((a[0] + b[0]) / 2 - 22), y: r1((a[1] + b[1]) / 2 + 18), w: 44, h: 17, rx: 8, fill: C.warn, op: ph(t, 0.55, 0.6) });
  out.push({ k: "text", x: r1((a[0] + b[0]) / 2 - 16), y: r1((a[1] + b[1]) / 2 + 30), s: "60 mm", size: 10, fill: "#fff", weight: 700, op: ph(t, 0.55, 0.6) });
  out.push(...path(t, [[0, 260, 110], [0.15, a[0] + 4, a[1] - 6, 1], [0.3, a[0] + 4, a[1] - 6], [0.4, b[0] - 4, b[1] - 6, 1], [1, b[0] - 4, b[1] - 6]]));
  return out;
};

// texture: pick faces, a pattern appears on them
S.texture = (t) => {
  const V = view(130, 76, 0.9);
  const out = [...plane(V, 45)];
  out.push(...box(V, -25, -25, 0, 50, 50, 40, C.green));
  const f = ph(t, 0.35, 0.7);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    const x = -22 + i * 8.5, z = 4 + j * 9;
    const c = V.P(x + 3, 25, z + 3);
    out.push({ k: "circle", cx: r1(c[0]), cy: r1(c[1]), r: 2.2, fill: C.green[2], op: clamp(f * 24 - (i + j * 6)) });
  }
  out.push(...path(t, [[0, 260, 110], [0.15, 110, 80, 1], [1, 110, 80]]));
  out.push(label(220, 30, "Raise", { fill: C.sub }));
  return out;
};

// --- Advanced: sketching
function skFrame(t, title) {
  return [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" },
    ...[...Array(15)].map((_, i) => ({ k: "line", x1: i * 20, y1: 0, x2: i * 20, y2: H, stroke: "#e3e9f2", sw: 1 })),
    ...[...Array(7)].map((_, i) => ({ k: "line", x1: 0, y1: 5 + i * 20, x2: W, y2: 5 + i * 20, stroke: "#e3e9f2", sw: 1 })),
    { k: "circle", cx: 60, cy: 105, r: 3, fill: C.ink },
    label(8, 16, title, { fill: C.sub, size: 10 })];
}
// a line tool: segments drawn one after another with length/angle boxes
S.line = (t) => {
  const out = skFrame(t, "Line: type Length, Tab, Angle, Enter");
  const P = [[60, 105], [210, 105], [210, 75], [186, 75], [186, 89], [126, 15], [60, 105]];
  const n = P.length - 1;
  for (let i = 0; i < n; i++) {
    const f = ph(t, 0.05 + i * 0.12, 0.13 + i * 0.12);
    out.push({ k: "line", x1: P[i][0], y1: P[i][1], x2: r1(lerp(P[i][0], P[i + 1][0], f)), y2: r1(lerp(P[i][1], P[i + 1][1], f)), stroke: C.ink, sw: 2, op: f > 0 ? 1 : 0 });
  }
  out.push({ k: "poly", pts: P.slice(0, n), fill: "rgba(79,141,224,.25)", op: ph(t, 0.82, 0.88) });
  const labs = ["75", "15", "12", "7", "60"];
  labs.forEach((s, i) => out.push({ k: "rect", x: 236, y: 30, w: 52, h: 17, rx: 4, fill: "#fff", stroke: C.sel, sw: 1.5, op: on(t, 0.05 + i * 0.12, 0.17 + i * 0.12) }));
  labs.forEach((s, i) => out.push({ k: "text", x: 242, y: 42.5, s: s + " mm", size: 11, fill: C.ink, mono: true, op: on(t, 0.05 + i * 0.12, 0.17 + i * 0.12) }));
  out.push(label(236, 66, "closed ✓", { fill: C.green[2], op: ph(t, 0.84, 0.88) }));
  return out;
};
S.circle = (t) => {
  const out = skFrame(t, "Circle: click the center, type the diameter");
  const f = ph(t, 0.2, 0.55);
  out.push({ k: "circle", cx: 140, cy: 65, r: r1(lerp(1, 42, f)), fill: t > 0.6 ? "rgba(79,141,224,.25)" : "rgba(79,141,224,0)", stroke: C.ink, sw: 2 });
  out.push({ k: "circle", cx: 140, cy: 65, r: 3, fill: C.ink });
  out.push({ k: "line", x1: 98, y1: 120, x2: 182, y2: 120, stroke: C.sub, sw: 1, op: ph(t, 0.55, 0.6) });
  out.push({ k: "text", x: 126, y: 117, s: "Ø 100", size: 11, fill: C.ink, weight: 700, op: ph(t, 0.55, 0.6) });
  out.push(...field(196, 22, 50, "Diam.", "100", ph(t, 0.3, 0.45), on(t, 0.25, 0.55)));
  out.push(...key(240, 48, "Enter", on(t, 0.5, 0.56)));
  out.push(...path(t, [[0, 60, 120], [0.15, 140, 65, 1], [1, 140, 65]]));
  return out;
};
S.rect = (t) => {
  const out = skFrame(t, "Center rectangle: click the middle, type W, Tab, H");
  const f = ph(t, 0.2, 0.55), w = lerp(4, 150, f), h = lerp(4, 60, f);
  out.push({ k: "rect", x: r1(130 - w / 2), y: r1(65 - h / 2), w: r1(w), h: r1(h), fill: t > 0.6 ? "rgba(79,141,224,.25)" : "rgba(79,141,224,0)", stroke: C.ink, sw: 2 });
  out.push({ k: "circle", cx: 130, cy: 65, r: 3, fill: C.ink });
  out.push(...field(214, 22, 40, "W", "80", ph(t, 0.3, 0.38), on(t, 0.25, 0.42)));
  out.push(...field(214, 46, 40, "H", "70", ph(t, 0.44, 0.52), on(t, 0.42, 0.6)));
  out.push(...path(t, [[0, 60, 120], [0.15, 130, 65, 1], [1, 130, 65]]));
  return out;
};
// pick a plane (or a face) to sketch on; the view turns to face it
S.sketch = (t) => {
  const V = view(130, 70, 0.85), f = ph(t, 0.4, 0.75);
  const out = [];
  // tilt from 3D to straight-on: blend iso projection with a flat top view
  const Q = (x, y, z) => { const a = V.P(x, y, z), b = [130 + x * 0.9, 65 + y * 0.9]; return [r1(lerp(a[0], b[0], f)), r1(lerp(a[1], b[1], f))]; };
  out.push({ k: "poly", pts: [Q(-60, -45, 0), Q(60, -45, 0), Q(60, 45, 0), Q(-60, 45, 0)], fill: on(t, 0.2) ? "rgba(45,127,249,.18)" : C.plane, stroke: on(t, 0.2) ? C.sel : C.grid, sw: on(t, 0.2) ? 2 : 1 });
  for (let i = -40; i <= 40; i += 20) { const a = Q(i, -45, 0), b = Q(i, 45, 0); out.push({ k: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: C.grid, sw: 1 }); }
  out.push({ k: "rect", x: 222, y: 20, w: 66, h: 20, rx: 4, fill: on(t, 0.15) ? C.sel : "#fff", stroke: C.sel, sw: 1 });
  out.push({ k: "text", x: 228, y: 34, s: "XY · Top", size: 11, fill: on(t, 0.15) ? "#fff" : C.sel, weight: 600 });
  out.push(label(222, 70, "Now you draw", { op: ph(t, 0.75, 0.8), fill: C.sub }));
  out.push(label(222, 86, "flat, from above", { op: ph(t, 0.75, 0.8), fill: C.sub }));
  out.push(...path(t, [[0, 150, 110], [0.12, 250, 30, 1], [1, 250, 30]]));
  return out;
};
// sketch on a face: click the top face of a part
S.faceSketch = (t) => {
  const V = view(120, 80, 0.85);
  const out = [...plane(V, 45)];
  out.push(...box(V, -35, -25, 0, 60, 50, 20, C.blue));
  const hi = on(t, 0.25);
  out.push({ k: "poly", pts: pts(V.P(-35, -25, 20), V.P(25, -25, 20), V.P(25, 25, 20), V.P(-35, 25, 20)), fill: "rgba(45,127,249,.35)", stroke: C.sel, sw: 2, op: hi });
  const f = ph(t, 0.45, 0.7), c = V.P(-5, 0, 20);
  out.push({ k: "ellipse", cx: r1(c[0]), cy: r1(c[1]), rx: r1(lerp(0, 1.2247 * 14 * 0.85, f)), ry: r1(lerp(0, 0.7071 * 14 * 0.85, f)), fill: "none", stroke: C.ink, sw: 2 });
  out.push(label(214, 36, "Click a flat", { fill: C.sub }));
  out.push(label(214, 52, "face to draw", { fill: C.sub }));
  out.push(label(214, 68, "right on it", { fill: C.sub }));
  out.push(...path(t, [[0, 220, 110], [0.2, c[0] + 18, c[1] - 4, 1], [0.4, c[0], c[1], 1], [0.7, c[0] + 16, c[1] + 6], [1, c[0] + 16, c[1] + 6]]));
  return out;
};
// extrude: a flat sketch rises into a solid
S.extrude = (t) => {
  const V = view(120, 82, 0.85), h = lerp(0.2, 30, ph(t, 0.3, 0.75));
  const out = [...plane(V, 45)];
  out.push(...cyl(V, 0, 0, 0, 28, h, C.blue));
  const top = V.P(0, 0, h);
  out.push({ k: "line", x1: r1(top[0]), y1: r1(top[1]), x2: r1(top[0]), y2: r1(top[1] - 24), stroke: C.sel, sw: 3 });
  out.push({ k: "poly", pts: [[r1(top[0] - 6), r1(top[1] - 22)], [r1(top[0] + 6), r1(top[1] - 22)], [r1(top[0]), r1(top[1] - 32)]], fill: C.sel });
  out.push(...key(214, 22, "E", on(t, 0.08, 0.14)));
  out.push(...field(214, 50, 40, "Dist.", "30", ph(t, 0.2, 0.3), on(t, 0.18, 0.75)));
  out.push(label(214, 100, "flat → solid", { op: ph(t, 0.75, 0.8), fill: C.green[2] }));
  return out;
};
// extrude down into a part (cut)
S.cut = (t) => {
  const V = view(120, 70, 0.85), d = lerp(0, 10, ph(t, 0.3, 0.7));
  const out = [...plane(V, 45)];
  out.push(...box(V, -35, -25, 0, 60, 50, 20, C.blue));
  // the slot, drawn as a dark sunken strip that gets deeper
  const a = V.P(-35, -3, 20), b = V.P(25, -3, 20), c = V.P(25, 3, 20), e = V.P(-35, 3, 20);
  out.push({ k: "poly", pts: pts(a, b, c, e), fill: "#3b4552" });
  out.push({ k: "poly", pts: pts(a, b, [b[0], b[1] + d * 0.85], [a[0], a[1] + d * 0.85]), fill: "#2b333d", op: d > 0.5 ? 1 : 0 });
  out.push({ k: "poly", pts: pts(a, b, c, e), fill: "rgba(79,141,224,.5)", stroke: C.ink, sw: 1, op: 1 - ph(t, 0.3, 0.4) });
  out.push(...field(214, 30, 40, "Dist.", "-3", ph(t, 0.18, 0.28), on(t, 0.15, 0.7)));
  out.push(label(214, 70, "Operation:", { fill: C.sub }));
  out.push(label(214, 86, "Cut", { op: 1 }));
  return out;
};
// revolve: a half-outline spins around the axis into a round part
S.revolve = (t) => {
  const f = ph(t, 0.3, 0.75);
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  // axis
  out.push({ k: "line", x1: 120, y1: 8, x2: 120, y2: 124, stroke: C.warn, sw: 1.5, dash: "6 4" });
  const prof = [[0, 118], [34, 118], [34, 110], [24, 104], [12, 64], [20, 58], [20, 54], [8, 50], [8, 46]];
  // the outline swings around: its mirror grows from the axis
  const full = [...prof.map(([x, y]) => [120 + x, y]), [128, 18], [120, 14], ...prof.slice().reverse().map(([x, y]) => [r1(120 - x * f), y])];
  out.push({ k: "poly", pts: full, fill: f > 0.02 ? C.purple[0] : "rgba(155,111,224,.25)", stroke: C.ink, sw: 1.5 });
  for (const [x, y] of [[34, 114], [24, 104], [12, 64], [20, 56]]) out.push({ k: "ellipse", cx: 120, cy: y, rx: r1(x * f), ry: r1(3 * f), fill: "none", stroke: C.purple[2], sw: 1, op: f > 0.05 ? 0.7 : 0 });
  out.push({ k: "path", d: "M150 26a26 8 0 1 1-60 0", fill: "none", stroke: C.sel, sw: 2.5, op: on(t, 0.25, 0.8) });
  out.push({ k: "poly", pts: [[86, 22], [92, 32], [96, 22]], fill: C.sel, op: on(t, 0.25, 0.8) });
  out.push(label(200, 40, "Axis: Z", { fill: C.sub }));
  out.push(label(200, 58, "Angle: 360°", { fill: C.sub }));
  out.push(label(200, 96, "round part", { op: ph(t, 0.75, 0.8), fill: C.green[2] }));
  return out;
};
// fillet: a sharp edge becomes round
S.fillet = (t) => {
  const f = ph(t, 0.4, 0.75), r = lerp(0.1, 34, f);
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  out.push({ k: "path", d: `M30 120L30 20L${r1(150 - r)} 20A${r1(r)} ${r1(r)} 0 0 1 150 ${r1(20 + r)}L150 120Z`, fill: C.blue[1], stroke: C.ink, sw: 1.5 });
  out.push({ k: "circle", cx: 150, cy: 20, r: 6, fill: "none", stroke: C.gold[1], sw: 3, op: on(t, 0.15, 0.4) });
  out.push(...key(190, 22, "F", on(t, 0.05, 0.1)));
  out.push(...field(190, 54, 40, "Size", "4", ph(t, 0.3, 0.36), on(t, 0.28, 0.75)));
  out.push(label(190, 100, "smooth edge", { op: ph(t, 0.75, 0.8), fill: C.green[2] }));
  out.push(...path(t, [[0, 250, 110], [0.15, 152, 22, 1], [1, 152, 22]]));
  return out;
};
// shell: a solid block is hollowed out, leaving the picked face open
S.shell = (t) => {
  const V = view(120, 80, 0.85), f = ph(t, 0.45, 0.75), w = 3;
  const out = [...plane(V, 45)];
  out.push(...box(V, -30, -25, 0, 60, 50, 40, C.gold));
  out.push({ k: "poly", pts: pts(V.P(-30, -25, 40), V.P(30, -25, 40), V.P(30, 25, 40), V.P(-30, 25, 40)), fill: "rgba(45,127,249,.35)", stroke: C.sel, sw: 2, op: on(t, 0.2, 0.45) });
  // the hole in the top, then the inside walls
  const i0 = V.P(-30 + w, -25 + w, 40), i1 = V.P(30 - w, -25 + w, 40), i2 = V.P(30 - w, 25 - w, 40), i3 = V.P(-30 + w, 25 - w, 40);
  const dz = 34 * 0.85 * f;
  out.push({ k: "poly", pts: pts(i0, i1, i2, i3), fill: C.gold[2], op: f > 0 ? 1 : 0 });
  out.push({ k: "poly", pts: pts(i0, i1, [i1[0], i1[1] + dz], [i0[0], i0[1] + dz]), fill: "#8a6305", op: f > 0 ? 1 : 0 });
  out.push({ k: "poly", pts: pts(i0, i3, [i3[0], i3[1] + dz], [i0[0], i0[1] + dz]), fill: "#a57a08", op: f > 0 ? 1 : 0 });
  out.push(...field(214, 30, 40, "Thick", "3", ph(t, 0.3, 0.36), on(t, 0.28, 0.75)));
  out.push(label(214, 80, "hollow!", { op: ph(t, 0.75, 0.8), fill: C.green[2], size: 13 }));
  out.push(...path(t, [[0, 260, 110], [0.18, 120, 40, 1], [1, 120, 40]]));
  return out;
};
// loft: blend between circles at different heights
S.loft = (t) => {
  const f = ph(t, 0.45, 0.8);
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  const rings = [[118, 30], [70, 46], [20, 24]];
  // the blended outline
  const L = `M${120 - 30} 118C${120 - 30} 100 ${120 - 52} 92 ${120 - 46} 70C${120 - 40} 48 ${120 - 22} 36 ${120 - 24} 20L${120 + 24} 20C${120 + 22} 36 ${120 + 40} 48 ${120 + 46} 70C${120 + 52} 92 ${120 + 30} 100 ${120 + 30} 118Z`;
  out.push({ k: "path", d: L, fill: C.purple[0], stroke: C.purple[2], sw: 1.5, op: f });
  rings.forEach(([y, r], i) => out.push({ k: "ellipse", cx: 120, cy: y, rx: r, ry: r1(r * 0.25), fill: "none", stroke: i === 0 && t < 0.4 ? C.sel : C.ink, sw: 2, op: 1 - 0.5 * f }));
  rings.forEach(([y], i) => out.push({ k: "circle", cx: 230, cy: 28 + i * 18, r: 5, fill: t > 0.12 + (2 - i) * 0.1 ? C.sel : "#d5dbe3" }));
  out.push(label(240, 32, "top", { size: 10, fill: C.sub }));
  out.push(label(240, 50, "middle", { size: 10, fill: C.sub }));
  out.push(label(240, 68, "bottom", { size: 10, fill: C.sub }));
  out.push(label(212, 104, "Smooth", { op: ph(t, 0.8, 0.85), fill: C.green[2] }));
  return out;
};
// combine: two bodies → cut (or join)
S.combine = (t) => {
  const V = view(120, 74, 0.85), f = ph(t, 0.55, 0.65);
  const out = [...plane(V, 45)];
  out.push(...box(V, -35, -25, 0, 60, 50, 14, C.blue));
  out.push(...box(V, -45, -4, 8, 80, 8, 10, C.red, { op: 1 - f }));
  out.push({ k: "poly", pts: pts(V.P(-35, -4, 14), V.P(25, -4, 14), V.P(25, 4, 14), V.P(-35, 4, 14)), fill: "#3b4552", op: f });
  out.push(label(214, 26, "Target", { fill: C.sub }));
  out.push({ k: "rect", x: 214, y: 32, w: 76, h: 16, rx: 3, fill: on(t, 0.15) ? "#dfeafe" : "#fff", stroke: C.sel, sw: 1 });
  out.push({ k: "text", x: 219, y: 44, s: "Coaster", size: 10, fill: C.ink, op: on(t, 0.15) });
  out.push(label(214, 64, "Tool", { fill: C.sub }));
  out.push({ k: "rect", x: 214, y: 70, w: 76, h: 16, rx: 3, fill: on(t, 0.32) ? "#dfeafe" : "#fff", stroke: C.sel, sw: 1 });
  out.push({ k: "text", x: 219, y: 82, s: "Channels", size: 10, fill: C.ink, op: on(t, 0.32) });
  out.push(...key(214, 100, "Cut", on(t, 0.45, 0.52)));
  out.push(...path(t, [[0, 260, 120], [0.12, 80, 80, 1], [0.28, 40, 52, 1], [0.45, 225, 108, 1], [1, 225, 108]]));
  return out;
};
// screw thread: a ridge spirals around the neck
S.thread = (t) => {
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  out.push({ k: "rect", x: 90, y: 20, w: 70, h: 96, fill: C.gold[1] });
  out.push({ k: "ellipse", cx: 125, cy: 20, rx: 35, ry: 7, fill: C.gold[0] });
  const f = ph(t, 0.2, 0.75), n = 5;
  for (let i = 0; i < n; i++) {
    const y = 104 - i * 18;
    out.push({ k: "path", d: `M88 ${y + 8}Q125 ${y + 4} 162 ${y - 4}`, fill: "none", stroke: C.gold[2], sw: 5, op: clamp(f * n - i) });
  }
  out.push(label(190, 40, "Pitch 3", { fill: C.sub }));
  out.push(label(190, 58, "= ridge spacing", { fill: C.sub, size: 10 }));
  out.push(label(190, 96, "twist to close", { op: ph(t, 0.8, 0.85), fill: C.green[2] }));
  return out;
};
// hole tool: a countersunk screw hole on a face
S.holeTool = (t) => {
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  // a cut-away view of a plate with the hole
  const f = ph(t, 0.35, 0.7);
  out.push({ k: "rect", x: 30, y: 50, w: 160, h: 40, fill: C.blue[1], stroke: C.ink, sw: 1.5 });
  out.push({ k: "path", d: `M${r1(110 - 14 * f)} 50L${r1(110 - 5 * f)} ${r1(50 + 9 * f)}L${r1(110 - 5 * f)} 90L${r1(110 + 5 * f)} 90L${r1(110 + 5 * f)} ${r1(50 + 9 * f)}L${r1(110 + 14 * f)} 50Z`, fill: "#f7f9fc", stroke: C.ink, sw: 1.5, op: f > 0.02 ? 1 : 0 });
  // the screw slides in
  const s = ph(t, 0.75, 0.9);
  out.push({ k: "path", d: `M96 ${r1(10 + 40 * s)}L124 ${r1(10 + 40 * s)}L114 ${r1(19 + 40 * s)}L114 ${r1(64 + 40 * s)}L106 ${r1(64 + 40 * s)}L106 ${r1(19 + 40 * s)}Z`, fill: C.gray[2], stroke: C.ink, sw: 1, op: on(t, 0.72) });
  out.push(label(206, 40, "Countersink", { fill: C.ink }));
  out.push(label(206, 58, "screw head", { fill: C.sub, size: 10 }));
  out.push(label(206, 72, "sits flush", { fill: C.sub, size: 10 }));
  out.push(...path(t, [[0, 260, 120], [0.2, 110, 50, 1], [0.7, 110, 50], [0.72, 260, 120], [1, 260, 120]]));
  return out;
};
// move: a part slides by typed distances
S.move = (t) => {
  const V = view(120, 76, 0.8), f = ph(t, 0.3, 0.6) - ph(t, 0.8, 0.95);
  const out = [...plane(V, 50)];
  out.push(...box(V, -45, -20, 0, 40, 40, 30, C.gold));
  out.push(...box(V, lerp(15, -42, f), -17, lerp(0, 2, f), 34, 34, 24, C.blue));
  out.push(...field(214, 26, 40, "X", "-100", ph(t, 0.12, 0.26), on(t, 0.1, 0.3)));
  out.push(label(214, 74, "slides in", { op: on(t, 0.6, 0.8), fill: C.green[2] }));
  out.push(...key(214, 90, "Ctrl+Z", on(t, 0.78, 0.84)));
  return out;
};
// mirror: a copy appears on the other side of a dashed line
S.mirror = (t) => {
  const f = ph(t, 0.35, 0.65);
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  out.push({ k: "line", x1: 120, y1: 8, x2: 120, y2: 124, stroke: C.warn, sw: 1.5, dash: "6 4" });
  const shp = [[124, 110], [190, 110], [190, 96], [150, 96], [140, 30], [124, 30]];
  out.push({ k: "poly", pts: shp, fill: C.blue[1], stroke: C.ink, sw: 1.5 });
  out.push({ k: "poly", pts: shp.map(([x, y]) => [r1(120 - (x - 120) * f), y]), fill: C.blue[0], stroke: C.ink, sw: 1.5, op: f > 0.02 ? 1 : 0 });
  out.push(label(206, 40, "Mirror across", { fill: C.sub }));
  out.push(label(206, 56, "the red line", { fill: C.sub }));
  return out;
};
// emboss text on a face
S.emboss = (t) => {
  const V = view(130, 80, 0.9), f = ph(t, 0.35, 0.7);
  const out = [...plane(V, 45)];
  out.push(...box(V, -45, -12, 0, 90, 24, 18, C.gray));
  const a = V.P(-36, 12, 6), d = 6 * f;
  out.push({ k: "text", x: r1(a[0] + 2), y: r1(a[1] + 1), s: "MARIA", size: 17, fill: "#5b6573", weight: 800, op: f > 0.05 ? 1 : 0, skew: true });
  out.push({ k: "text", x: r1(a[0]), y: r1(a[1] - d * 0.3), s: "MARIA", size: 17, fill: C.blue[2], weight: 800, op: f > 0.05 ? 1 : 0.3, skew: true });
  out.push(...field(214, 26, 50, "Text", "MARIA", ph(t, 0.1, 0.3), on(t, 0.08, 0.35)));
  out.push(label(214, 80, "Raise 1 mm", { op: ph(t, 0.7, 0.75), fill: C.green[2] }));
  return out;
};
// a plane offset up from another
S.plane = (t) => {
  const V = view(120, 92, 0.75), f = ph(t, 0.25, 0.6);
  const out = [...plane(V, 45)];
  for (const [z, d] of [[60, 0], [120, 0.4]]) {
    const zz = z * 0.55 * clamp((f - d) / 0.6 + 0.0001);
    out.push({ k: "poly", pts: pts(V.P(-40, -40, zz), V.P(40, -40, zz), V.P(40, 40, zz), V.P(-40, 40, zz)), fill: "rgba(240,180,41,.25)", stroke: C.gold[2], sw: 1.5, op: f > d ? 1 : 0 });
  }
  out.push(...field(214, 30, 40, "Dist.", "60", ph(t, 0.1, 0.2), on(t, 0.08, 0.3)));
  out.push(label(214, 80, "sketch on it", { op: ph(t, 0.7, 0.75), fill: C.sub }));
  return out;
};
// save: the version number goes up
S.save = (t) => {
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: 30, fill: "#1f2633" }];
  out.push({ k: "text", x: 14, y: 19, s: "Lopez, Maria, Coaster", size: 11, fill: "#fff" });
  out.push({ k: "rect", x: 150, y: 7, w: 30, h: 16, rx: 8, fill: "#2f66c8" });
  for (const [i, v] of [[0, "v1"], [1, "v2"], [2, "v3"]]) out.push({ k: "text", x: 157, y: 19, s: v, size: 10, fill: "#fff", weight: 700, op: on(t, i * 0.33, (i + 1) * 0.33) });
  out.push({ k: "rect", x: 196, y: 6, w: 50, h: 18, rx: 4, fill: [0.28, 0.61, 0.94].some((a) => t > a - 0.05 && t < a) ? "#3a4659" : "#2b3444" });
  out.push({ k: "text", x: 206, y: 19, s: "Save", size: 11, fill: "#fff", weight: 600 });
  out.push(label(14, 62, "Each save of the same design", { fill: C.sub }));
  out.push(label(14, 80, "gets the next version number.", { fill: C.sub }));
  out.push(...key(14, 98, "Ctrl+S", [0.28, 0.61, 0.94].some((a) => t > a - 0.05 && t < a)));
  out.push(...path(t, [[0, 220, 60], [0.23, 221, 15, 1], [0.56, 221, 15, 1], [0.89, 221, 15, 1], [1, 221, 15]]));
  return out;
};
// export: STL file drops out
S["export"] = (t) => {
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  out.push({ k: "rect", x: 150, y: 10, w: 130, h: 54, rx: 6, fill: "#fff", stroke: "#c3cad4", sw: 1, op: on(t, 0.15, 0.45) });
  out.push({ k: "text", x: 160, y: 30, s: "Project file", size: 11, fill: C.sub, op: on(t, 0.15, 0.45) });
  out.push({ k: "rect", x: 154, y: 38, w: 122, h: 20, rx: 4, fill: on(t, 0.3, 0.45) ? "#dfeafe" : "#fff", op: on(t, 0.15, 0.45) });
  out.push({ k: "text", x: 160, y: 52, s: "STL for 3D printing", size: 11, fill: C.ink, weight: 600, op: on(t, 0.15, 0.45) });
  const f = ph(t, 0.5, 0.75);
  out.push({ k: "path", d: `M40 ${r1(lerp(20, 40, f))}h40l14 14v52h-54Z`, fill: "#fff", stroke: C.ink, sw: 1.5, op: on(t, 0.5) });
  out.push({ k: "text", x: 50, y: r1(lerp(62, 82, f)), s: "STL", size: 13, fill: C.blue[2], weight: 800, op: on(t, 0.5) });
  out.push({ k: "text", x: 110, y: 100, s: "Lopez, Maria, Coaster v1.stl", size: 11, fill: C.ink, op: ph(t, 0.7, 0.75) });
  out.push(...path(t, [[0, 120, 110], [0.12, 268, 14, 1], [0.3, 210, 48, 1], [1, 210, 48]]));
  return out;
};
// the 3D print sim: layers stack up, an overhang shows red
S.printsim = (t) => {
  const out = [{ k: "rect", x: 0, y: 0, w: W, h: H, fill: "#f7f9fc" }];
  out.push({ k: "rect", x: 30, y: 116, w: 180, h: 6, fill: "#9aa4b1" });
  const n = 14, f = ph(t, 0.05, 0.75);
  for (let i = 0; i < n; i++) {
    const y = 110 - i * 7, w = i < 8 ? 40 : 40 + (i - 7) * 12;
    const over = i >= 8;
    out.push({ k: "rect", x: 100, y, w: r1(w), h: 6, rx: 2, fill: over ? C.warn : C.gold[1], op: clamp(f * n - i) });
  }
  out.push({ k: "rect", x: 222, y: 18, w: 70, h: 36, rx: 6, fill: C.warn, op: ph(t, 0.75, 0.8) });
  out.push({ k: "text", x: 230, y: 33, s: "Supports", size: 11, fill: "#fff", weight: 700, op: ph(t, 0.75, 0.8) });
  out.push({ k: "text", x: 230, y: 47, s: "needed!", size: 11, fill: "#fff", weight: 700, op: ph(t, 0.75, 0.8) });
  out.push(label(222, 80, "> 45° hangs", { fill: C.sub, size: 10 }));
  out.push(label(222, 94, "in the air", { fill: C.sub, size: 10 }));
  return out;
};
// undo
S.undo = (t) => S.move(t);

// which animation a step gets: its own "anim", or one that matches its icon
const BY_ICON = {
  text: "name", box: "tile", cylinder: "tileRound", prism: "tile", pyramid: "tile", holeToggle: "hole", group: "group", align: "align",
  pattern: "pattern", eye: "viewcube", measure: "measure", texture: "texture", move: "move", sketch: "sketch", extrude: "extrude",
  fillet: "fillet", combine: "combine", line: "line", circle: "circle", rect: "rect", planeOffset: "plane", loft: "loft", shell: "shell",
  thread: "thread", finish: "save", import: "export", revolve: "revolve", mirror: "mirror", emboss: "emboss", hole: "holeTool",
  appearance: null,
};
const SCENES = {
  ...S, tile: S.tile(C.red), tileRound: S.tile(C.gold, true), hole: S.hole(true), holeBox: S.hole(false),
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ATTR = { pts: "points", fill: "fill", stroke: "stroke", sw: "stroke-width", op: "opacity", dash: "stroke-dasharray", w: "width", h: "height" };
const fmtv = (k, v) => (k === "pts" ? v.map((p) => p.join(",")).join(" ") : String(v));

// build the SVG text for one animation (null when there is none)
export function animSVG(name, dur = 5) {
  const scene = SCENES[name];
  if (!scene) return null;
  const frames = [];
  for (let i = 0; i <= FR; i++) frames.push(scene(i / FR));
  const n = frames[0].length;
  const kt = frames.map((_, i) => (i / FR).toFixed(3)).join(";");
  let body = "";
  for (let j = 0; j < n; j++) {
    const s0 = frames[0][j];
    const tag = s0.k === "poly" ? "polygon" : s0.k;
    const keys = new Set();
    for (const f of frames) if (f[j]) for (const k of Object.keys(f[j])) keys.add(k);
    let attrs = "", anims = "";
    for (const k of keys) {
      if (k === "k" || k === "s" || k === "size" || k === "weight" || k === "mono" || k === "skew") continue;
      const name = ATTR[k] || k;
      const vals = frames.map((f) => (f[j] && f[j][k] != null ? fmtv(k, f[j][k]) : k === "op" ? "1" : ""));
      if (vals.every((v) => v === vals[0])) { if (vals[0] !== "" && !(k === "op" && vals[0] === "1")) attrs += ` ${name}="${vals[0]}"`; continue; }
      attrs += ` ${name}="${vals[0]}"`;
      anims += `<animate attributeName="${name}" dur="${dur}s" repeatCount="indefinite" calcMode="linear" keyTimes="${kt}" values="${vals.join(";")}"/>`;
    }
    if (s0.k === "text") {
      const st = ` font-size="${s0.size || 11}"${s0.weight ? ` font-weight="${s0.weight}"` : ""}${s0.mono ? ' font-family="ui-monospace,Menlo,Consolas,monospace"' : ""}${s0.skew ? ` transform="skewY(30)" transform-origin="${frames[0][j].x} ${frames[0][j].y}"` : ""}`;
      body += `<text${attrs}${st}>${anims}${esc(s0.s)}</text>`;
    } else body += `<${tag}${attrs}${anims ? `>${anims}</${tag}>` : "/>"}`;
  }
  return `<svg class="tut-anim-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animation: ${esc(name)}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
}

export function animFor(step) {
  if (step.anim === false) return null;
  return step.anim || BY_ICON[step.icon] || null;
}
export const ANIM_NAMES = Object.keys(SCENES);
