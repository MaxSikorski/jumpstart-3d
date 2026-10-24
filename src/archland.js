// Architect landscape: the ground around a building as a height grid you can raise, lower,
// smooth and flatten; ponds and lakes dug into it that fill with water; ground materials painted
// on it; and trees, bushes and rocks. It belongs to Architect only (it is not sent to the other
// modes), and can be exported with the house as OBJ, STL or 3MF. Sizes in mm, Z up.
import * as THREE from "three";

// ------------------------------------------------------------------ ground materials and plants
export const GROUND = [
  { id: "grass", name: "Grass", c: "#6aa84f" }, { id: "lawn", name: "Lawn", c: "#4c8c39" }, { id: "dirt", name: "Dirt", c: "#8b6a45" },
  { id: "sand", name: "Sand", c: "#dcc78f" }, { id: "gravel", name: "Gravel path", c: "#a9a49b" }, { id: "rock", name: "Rock", c: "#7c7974" },
  { id: "mulch", name: "Mulch", c: "#5a3b25" }, { id: "flowers", name: "Flower bed", c: "#cf6aa0" }, { id: "snow", name: "Snow", c: "#f1f4f7" },
  { id: "paving", name: "Paving", c: "#c2bdb4" },
  // more grounds (added at the end, so saved designs keep their colours)
  { id: "beach", name: "Beach sand", c: "#efdcaa" }, { id: "redsand", name: "Red desert sand", c: "#c98a5a" }, { id: "dune", name: "Dune sand", c: "#e3c17f" },
  { id: "riverstone", name: "River stones", c: "#9a968d" }, { id: "stonepath", name: "Stone path", c: "#b3aca0" }, { id: "slate", name: "Slate", c: "#5f6670" },
  { id: "moss", name: "Moss", c: "#5c7a33" }, { id: "meadow", name: "Meadow", c: "#93b55a" }, { id: "dryGrass", name: "Dry grass", c: "#b9a75e" },
  { id: "clay", name: "Clay", c: "#a8603f" }, { id: "mud", name: "Mud", c: "#5e4a36" }, { id: "brickpath", name: "Brick path", c: "#a5563f" },
];
export const PLANTS = [
  { id: "oak", name: "Oak tree", h: 7000 }, { id: "maple", name: "Maple (autumn)", h: 6500 }, { id: "birch", name: "Birch", h: 8000 },
  { id: "pine", name: "Pine", h: 9000 }, { id: "spruce", name: "Spruce", h: 6000 }, { id: "palm", name: "Palm", h: 8000 },
  { id: "bush", name: "Round bush", h: 1200 }, { id: "shrub", name: "Flowering shrub", h: 1000 }, { id: "hedge", name: "Hedge", h: 1100 },
  { id: "rock", name: "Boulder", h: 900 }, { id: "grassclump", name: "Tall grass", h: 600 },
  { id: "willow", name: "Weeping willow", h: 8000 }, { id: "cypress", name: "Italian cypress", h: 9000 }, { id: "fir", name: "Blue fir", h: 7000 },
  { id: "cherry", name: "Cherry blossom", h: 5500 }, { id: "apple", name: "Apple tree", h: 4500 }, { id: "aspen", name: "Aspen (gold)", h: 7500 },
  { id: "dead", name: "Bare tree", h: 5500 }, { id: "redmaple", name: "Red maple", h: 6000 }, { id: "fanpalm", name: "Fan palm", h: 4000 },
  { id: "cactus", name: "Cactus", h: 2500 },
  { id: "boxwood", name: "Boxwood", h: 700 }, { id: "lavender", name: "Lavender", h: 600 }, { id: "rose", name: "Rose bush", h: 1100 },
  { id: "hydrangea", name: "Hydrangea", h: 1200 }, { id: "fern", name: "Fern", h: 700 }, { id: "juniper", name: "Juniper", h: 900 },
  { id: "pampas", name: "Pampas grass", h: 1800 }, { id: "reeds", name: "Cattails (reeds)", h: 1500 }, { id: "wildflowers", name: "Wildflowers", h: 500 },
  { id: "tulips", name: "Tulips", h: 450 }, { id: "lilypad", name: "Lily pads", h: 60 },
  { id: "stone", name: "Stone", h: 400 }, { id: "rockpile", name: "Rock pile", h: 800 }, { id: "flatstone", name: "Stepping stone", h: 80 },
  { id: "pebbles", name: "Pebbles", h: 120 }, { id: "boulder2", name: "Granite boulder", h: 1500 },
];
// groups for the catalog
const CAT = { tree: "oak maple birch pine spruce palm willow cypress fir cherry apple aspen dead redmaple fanpalm cactus", shrub: "bush shrub hedge boxwood lavender rose hydrangea fern juniper", grass: "grassclump pampas reeds wildflowers tulips lilypad", rock: "rock stone rockpile flatstone pebbles boulder2" };
for (const P of PLANTS) P.cat = Object.keys(CAT).find((k) => CAT[k].split(" ").includes(P.id)) || "tree";
export const PLANT_CATS = [["tree", "Trees"], ["shrub", "Shrubs"], ["grass", "Grass & flowers"], ["rock", "Rocks & stones"]];
const WATER = "#3d8fd6", NONE = -32768;

// ------------------------------------------------------------------ data (stored in the design)
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
// heights and water levels as whole centimetres (Int16), ground materials as bytes
export function newLand(rect, res) {
  const nx = Math.max(2, Math.round((rect.x1 - rect.x0) / res) + 1), ny = Math.max(2, Math.round((rect.y1 - rect.y0) / res) + 1);
  const h = new Int16Array(nx * ny).fill(0), w = new Int16Array(nx * ny).fill(NONE), m = new Uint8Array(nx * ny);
  return { x0: rect.x0, y0: rect.y0, res, nx, ny, h: b64(new Uint8Array(h.buffer)), w: b64(new Uint8Array(w.buffer)), m: b64(m), plants: [], base: 1000 };
}
const cache = new Map();
// the grids of a landscape as typed arrays (cached by their stored text)
export function landArrays(L) {
  const key = L.h + "|" + L.w + "|" + L.m;
  let c = cache.get(key);
  if (!c) {
    const hb = unb64(L.h), wb = unb64(L.w);
    c = { h: new Float32Array(new Int16Array(hb.buffer)).map((v) => v * 10), w: new Float32Array(new Int16Array(wb.buffer)).map((v) => (v === NONE ? NaN : v * 10)), m: unb64(L.m) };
    cache.set(key, c);
    if (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return { h: c.h.slice(), w: c.w.slice(), m: c.m.slice() };
}
export function packArrays(L, arr) {
  const h = new Int16Array(arr.h.length), w = new Int16Array(arr.w.length);
  for (let i = 0; i < h.length; i++) { h[i] = Math.max(-32000, Math.min(32000, Math.round(arr.h[i] / 10))); w[i] = isNaN(arr.w[i]) ? NONE : Math.max(-32000, Math.min(32000, Math.round(arr.w[i] / 10))); }
  return { ...L, h: b64(new Uint8Array(h.buffer)), w: b64(new Uint8Array(w.buffer)), m: b64(arr.m) };
}
export function heightAt(L, arr, x, y) {
  const fx = Math.max(0, Math.min(L.nx - 1.001, (x - L.x0) / L.res)), fy = Math.max(0, Math.min(L.ny - 1.001, (y - L.y0) / L.res));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, n = L.nx, H = arr.h;
  return (H[j * n + i] * (1 - u) + H[j * n + i + 1] * u) * (1 - v) + (H[(j + 1) * n + i] * (1 - u) + H[(j + 1) * n + i + 1] * u) * v;
}

// ------------------------------------------------------------------ brushes
// kind: raise, lower, smooth, flatten (to `target`), water (dig a pond to `target` level, `depth`
// below it), dry (remove water), paint (material `mat`). r = radius, k = strength 0..1
export function brush(L, arr, x, y, o) {
  const { res, nx, ny, x0, y0 } = L, r = o.r, ri = Math.ceil(r / res), ci = Math.round((x - x0) / res), cj = Math.round((y - y0) / res);
  const H = arr.h, W = arr.w, M = arr.m;
  const src = o.kind === "smooth" ? H.slice() : null;
  let changed = false;
  for (let j = Math.max(0, cj - ri); j <= Math.min(ny - 1, cj + ri); j++) for (let i = Math.max(0, ci - ri); i <= Math.min(nx - 1, ci + ri); i++) {
    const d = Math.hypot((i - ci) * res, (j - cj) * res) / r; if (d > 1) continue;
    const f = 0.5 + 0.5 * Math.cos(Math.PI * d), q = j * nx + i, k = o.k * f;
    if (o.kind === "raise") H[q] += k * o.step;
    else if (o.kind === "lower") H[q] -= k * o.step;
    else if (o.kind === "flatten") H[q] += (o.target - H[q]) * Math.min(1, k * 0.6);
    else if (o.kind === "smooth") {
      let s = 0, n = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) { s += src[jj * nx + ii]; n++; } }
      H[q] += (s / n - H[q]) * Math.min(1, k);
    } else if (o.kind === "water") {
      // the pond bottom curves down from the edge; the water stays level at `target`
      const bottom = o.target - o.depth * Math.min(1, (1 - d) * 1.6);
      if (d < 0.92) { if (H[q] > bottom) H[q] += (bottom - H[q]) * Math.min(1, k * 1.4); if (H[q] < o.target - 5) W[q] = o.target; }
    } else if (o.kind === "dry") { if (d < 0.9) W[q] = NaN; }
    else if (o.kind === "paint") { if (d < 0.85 || f > 0.4) M[q] = o.mat; }
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ display
const tmpC = new THREE.Color();
function noise(i, j) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function groundMesh(L, arr) {
  const { nx, ny, x0, y0, res } = L, pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), idx = [];
  const cols = GROUND.map((g) => new THREE.Color(g.c));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i;
    pos[q * 3] = x0 + i * res; pos[q * 3 + 1] = y0 + j * res; pos[q * 3 + 2] = arr.h[q];
    tmpC.copy(cols[arr.m[q]] || cols[0]).multiplyScalar(0.9 + 0.18 * noise(i, j));
    if (!isNaN(arr.w[q])) tmpC.lerp(new THREE.Color("#b8a57c"), 0.35); // wet pond bottom
    col[q * 3] = tmpC.r; col[q * 3 + 1] = tmpC.g; col[q * 3 + 2] = tmpC.b;
  }
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
}
// the water surfaces: every grid square whose four corners hold water
export function waterMesh(L, arr) {
  const { nx, ny, x0, y0, res } = L, pos = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const q = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
    if (q.some((v) => isNaN(arr.w[v]))) continue;
    const z = (arr.w[q[0]] + arr.w[q[1]] + arr.w[q[2]] + arr.w[q[3]]) / 4;
    const P = [[x0 + i * res, y0 + j * res], [x0 + (i + 1) * res, y0 + j * res], [x0 + (i + 1) * res, y0 + (j + 1) * res], [x0 + i * res, y0 + (j + 1) * res]];
    for (const t of [0, 1, 2, 0, 2, 3]) pos.push(P[t][0], P[t][1], z);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: WATER, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1, depthWrite: false }));
}
// a plant or rock as simple closed shapes: [{geo, color}] at the origin, standing on z = 0
const PCACHE = new Map();
export function plantParts(kind) {
  if (PCACHE.has(kind)) return PCACHE.get(kind);
  const parts = [], add = (geo, color, x = 0, y = 0, z = 0) => { geo.translate(x, y, z); parts.push({ geo, color }); };
  const trunk = (r, h, c = "#6b4a2b") => { const g = new THREE.CylinderGeometry(r * 0.75, r, h, 10).rotateX(Math.PI / 2); add(g, c, 0, 0, h / 2); };
  const ball = (r, c, x, y, z, sz = 1) => { const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, 1, sz); add(g, c, x, y, z); };
  const cone = (r, h, c, z) => { const g = new THREE.ConeGeometry(r, h, 12).rotateX(Math.PI / 2); add(g, c, 0, 0, z + h / 2); };
  if (kind === "oak") { trunk(260, 3200); for (const [x, y, z, r] of [[0, 0, 4800, 2000], [900, 500, 4100, 1500], [-900, -400, 4200, 1500], [300, -900, 4500, 1400], [-400, 900, 5300, 1300]]) ball(r, "#4d8a3c", x, y, z); }
  else if (kind === "maple") { trunk(240, 3000); for (const [x, y, z, r] of [[0, 0, 4600, 1900], [800, 400, 4000, 1400], [-800, -300, 4100, 1400], [200, 600, 5200, 1300]]) ball(r, "#d9782e", x, y, z); }
  else if (kind === "birch") { trunk(170, 4800, "#ece8de"); for (const [x, y, z, r] of [[0, 0, 6200, 1300], [500, 200, 5200, 1000], [-400, -300, 5500, 1000]]) ball(r, "#8cc04f", x, y, z, 1.4); }
  else if (kind === "pine") { trunk(220, 2500); cone(2200, 3200, "#2f6b3a", 1500); cone(1700, 2800, "#2f6b3a", 3500); cone(1100, 2600, "#2f6b3a", 5600); }
  else if (kind === "spruce") { trunk(180, 1500); cone(1500, 4800, "#285c40", 1000); }
  else if (kind === "palm") {
    const g = new THREE.CylinderGeometry(150, 230, 7000, 8).rotateX(Math.PI / 2); add(g, "#8a6b48", 0, 0, 3500);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, leaf = new THREE.BoxGeometry(2600, 500, 80); leaf.translate(1300, 0, 0); leaf.rotateY(0.45); leaf.rotateZ(a); add(leaf, "#4f9a3e", 0, 0, 7000); }
    ball(350, "#6b5a2b", 0, 0, 6900);
  } else if (kind === "bush") { for (const [x, y, z, r] of [[0, 0, 550, 650], [400, 200, 450, 450], [-350, -200, 450, 450]]) ball(r, "#4f8f3c", x, y, z); }
  else if (kind === "shrub") { for (const [x, y, z, r] of [[0, 0, 500, 550], [350, 150, 420, 380], [-300, -200, 400, 380]]) ball(r, "#3f7f3a", x, y, z); for (const [x, y, z] of [[300, 300, 800], [-250, 250, 750], [0, -380, 700], [380, -150, 650], [-380, -50, 820]]) ball(110, "#e06aa8", x, y, z); }
  else if (kind === "hedge") { const g = new THREE.BoxGeometry(2400, 800, 1100); add(g, "#3f7a35", 0, 0, 550); }
  else if (kind === "rock") { const g = new THREE.DodecahedronGeometry(600, 0); g.scale(1.3, 1, 0.75); add(g, "#8d8a84", 0, 0, 300); }
  else if (kind === "grassclump") { for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, g = new THREE.ConeGeometry(70, 600, 5).rotateX(Math.PI / 2 + 0.25); g.rotateZ(a); add(g, "#7fae4b", Math.cos(a) * 120, Math.sin(a) * 120, 260); } }
  else if (kind === "willow") {
    trunk(300, 3600);
    ball(1800, "#7fa94a", 0, 0, 4600, 0.8);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, g = new THREE.ConeGeometry(650, 3800, 7).rotateX(-Math.PI / 2); add(g, "#8db556", Math.cos(a) * 1600, Math.sin(a) * 1600, 2900); }
  } else if (kind === "cypress") { trunk(160, 900); const g = new THREE.IcosahedronGeometry(900, 1); g.scale(1, 1, 4.6); add(g, "#2e5a32", 0, 0, 4800); }
  else if (kind === "fir") { trunk(200, 1200); cone(2000, 2600, "#4f7c86", 800); cone(1600, 2400, "#4f7c86", 2600); cone(1100, 2200, "#5b8a93", 4300); cone(600, 1600, "#5b8a93", 5600); }
  else if (kind === "cherry") { trunk(220, 2400, "#5d3b2c"); for (const [x, y, z, r] of [[0, 0, 3800, 1600], [900, 300, 3300, 1100], [-900, -200, 3400, 1100], [200, -800, 3700, 1000], [-300, 800, 4300, 1000]]) ball(r, "#f2b6cf", x, y, z); }
  else if (kind === "apple") { trunk(220, 1900); for (const [x, y, z, r] of [[0, 0, 3200, 1500], [800, 300, 2800, 1000], [-800, -300, 2900, 1000]]) ball(r, "#5f9a3f", x, y, z); for (const [x, y, z] of [[900, 900, 3000], [-1100, 600, 2700], [500, -1300, 3100], [-600, -1000, 3800], [1400, -200, 2600], [0, 1400, 3600]]) ball(140, "#cc2f2f", x, y, z); }
  else if (kind === "aspen") { trunk(150, 4600, "#e4e0d2"); for (const [x, y, z, r] of [[0, 0, 5900, 1200], [400, 300, 5000, 900], [-400, -200, 5200, 900]]) ball(r, "#e2b53b", x, y, z, 1.5); }
  else if (kind === "redmaple") { trunk(240, 2800); for (const [x, y, z, r] of [[0, 0, 4300, 1800], [800, 400, 3800, 1300], [-800, -300, 3900, 1300]]) ball(r, "#b9342a", x, y, z); }
  else if (kind === "dead") {
    trunk(260, 3800, "#6e5d4e");
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3, l = 1600 + (k % 2) * 700, g = new THREE.CylinderGeometry(50, 110, l, 6); g.translate(0, l / 2, 0); g.rotateX(Math.PI / 2); g.rotateY(0.75); g.rotateZ(a); add(g, "#6e5d4e", 0, 0, 2400 + (k % 3) * 500); }
  } else if (kind === "fanpalm") {
    const g = new THREE.CylinderGeometry(220, 300, 3200, 8).rotateX(Math.PI / 2); add(g, "#7d6248", 0, 0, 1600);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, leaf = new THREE.CylinderGeometry(500, 30, 1300, 5).rotateZ(Math.PI / 2); leaf.translate(700, 0, 0); leaf.rotateY(-0.5); leaf.rotateZ(a); add(leaf, "#5a9a46", 0, 0, 3300); }
  } else if (kind === "cactus") {
    const c = "#4f8a45", body = new THREE.CylinderGeometry(260, 300, 2400, 10).rotateX(Math.PI / 2); add(body, c, 0, 0, 1200); ball(260, c, 0, 0, 2400);
    for (const s of [-1, 1]) { const arm = new THREE.CylinderGeometry(150, 170, 800, 8).rotateX(Math.PI / 2); add(arm, c, s * 560, 0, 1500 + (s > 0 ? 300 : 0)); const j = new THREE.CylinderGeometry(150, 150, 420, 8).rotateZ(Math.PI / 2); add(j, c, s * 380, 0, 1150 + (s > 0 ? 300 : 0)); ball(150, c, s * 560, 0, 1900 + (s > 0 ? 300 : 0)); }
  } else if (kind === "boxwood") { ball(420, "#2f6a32", 0, 0, 360, 0.85); }
  else if (kind === "lavender") { for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, r = k % 3 === 0 ? 0 : 220, g = new THREE.CylinderGeometry(40, 40, 520, 5).rotateX(Math.PI / 2); add(g, "#7d9a6a", Math.cos(a) * r, Math.sin(a) * r, 260); ball(70, "#8e6cc9", Math.cos(a) * r, Math.sin(a) * r, 560, 2.2); } }
  else if (kind === "rose") { for (const [x, y, z, r] of [[0, 0, 560, 560], [330, 160, 450, 380], [-300, -180, 450, 380]]) ball(r, "#3b6e34", x, y, z); for (const [x, y, z] of [[300, 320, 860], [-260, 250, 820], [0, -400, 760], [400, -160, 700], [-400, -60, 880], [100, 120, 1080]]) ball(120, "#c8243a", x, y, z); }
  else if (kind === "hydrangea") { for (const [x, y, z, r] of [[0, 0, 600, 650], [380, 180, 500, 450], [-350, -200, 500, 450]]) ball(r, "#47813f", x, y, z); for (const [x, y, z] of [[300, 300, 950], [-300, 250, 900], [0, -420, 850], [420, -150, 800], [-430, -60, 950], [0, 0, 1180]]) ball(230, "#7f98e0", x, y, z); }
  else if (kind === "fern") { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, leaf = new THREE.BoxGeometry(700, 160, 30); leaf.translate(350, 0, 0); leaf.rotateY(-0.6); leaf.rotateZ(a); add(leaf, "#4e8f3a", 0, 0, 120); } }
  else if (kind === "juniper") { for (const [x, y, z, r] of [[0, 0, 330, 700], [600, 250, 260, 500], [-600, -250, 260, 500], [200, -600, 250, 450]]) ball(r, "#3e6b4f", x, y, z, 0.55); }
  else if (kind === "pampas") { for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, t = 0.18 + (k % 3) * 0.06, g = new THREE.ConeGeometry(80, 1300, 5).rotateX(Math.PI / 2 + t); g.rotateZ(a); add(g, "#8fa05b", Math.cos(a) * 150, Math.sin(a) * 150, 620); const pl = new THREE.IcosahedronGeometry(110, 0); pl.scale(1, 1, 3.4); add(pl, "#e8dcc0", Math.cos(a) * (300 + t * 800), Math.sin(a) * (300 + t * 800), 1450); } }
  else if (kind === "reeds") { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, r = (k % 2) * 220 + 80, x = Math.cos(a) * r, y = Math.sin(a) * r, g = new THREE.CylinderGeometry(18, 25, 1400, 4).rotateX(Math.PI / 2); add(g, "#6e8f45", x, y, 700); const top = new THREE.CylinderGeometry(45, 45, 260, 6).rotateX(Math.PI / 2); add(top, "#6b4a2b", x, y, 1250); } }
  else if (kind === "wildflowers") { const cs = ["#e8c33a", "#e06aa8", "#ffffff", "#8e6cc9", "#e65a3a"]; for (let k = 0; k < 10; k++) { const a = k * 2.4, r = 100 + (k % 4) * 90, x = Math.cos(a) * r, y = Math.sin(a) * r, g = new THREE.CylinderGeometry(15, 15, 420, 4).rotateX(Math.PI / 2); add(g, "#6e9a45", x, y, 210); ball(65, cs[k % cs.length], x, y, 440); } }
  else if (kind === "tulips") { const cs = ["#d8323a", "#f2c230", "#e06aa8"]; for (let k = 0; k < 7; k++) { const a = k * 0.9, r = (k % 3) * 120 + 60, x = Math.cos(a) * r, y = Math.sin(a) * r, g = new THREE.CylinderGeometry(15, 15, 380, 4).rotateX(Math.PI / 2); add(g, "#5d8f3e", x, y, 190); const cup = new THREE.CylinderGeometry(60, 35, 120, 6).rotateX(Math.PI / 2); add(cup, cs[k % 3], x, y, 420); } }
  else if (kind === "lilypad") { for (const [x, y, r] of [[0, 0, 300], [450, 200, 220], [-350, 300, 250], [150, -420, 200]]) { const g = new THREE.CylinderGeometry(r, r, 30, 12).rotateX(Math.PI / 2); add(g, "#4f8f3c", x, y, 15); } ball(70, "#f4c3d6", 0, 0, 60); }
  else if (kind === "stone") { const g = new THREE.DodecahedronGeometry(260, 0); g.scale(1.3, 1, 0.7); add(g, "#8b8780", 0, 0, 150); }
  else if (kind === "rockpile") { for (const [x, y, z, r, c] of [[0, 0, 300, 450, "#85817a"], [500, 150, 200, 320, "#97928a"], [-420, 260, 180, 300, "#7a766f"], [120, -430, 170, 280, "#8f8b84"], [80, 80, 650, 280, "#9a958d"]]) { const g = new THREE.DodecahedronGeometry(r, 0); g.scale(1.2, 1, 0.8); add(g, c, x, y, z); } }
  else if (kind === "flatstone") { const g = new THREE.CylinderGeometry(380, 400, 90, 9).rotateX(Math.PI / 2); g.scale(1.25, 1, 1); add(g, "#a29d93", 0, 0, 45); }
  else if (kind === "pebbles") { for (let k = 0; k < 9; k++) { const a = k * 2.1, r = 80 + (k % 4) * 110, g = new THREE.DodecahedronGeometry(70 + (k % 3) * 25, 0); g.scale(1.3, 1, 0.6); add(g, ["#a7a29a", "#8c877f", "#bdb7ad"][k % 3], Math.cos(a) * r, Math.sin(a) * r, 40); } }
  else if (kind === "boulder2") { const g = new THREE.IcosahedronGeometry(950, 0); g.scale(1.25, 1, 0.8); add(g, "#b4aba3", 0, 0, 600); const g2 = new THREE.DodecahedronGeometry(500, 0); add(g2, "#9f978f", 900, 300, 300); }
  PCACHE.set(kind, parts);
  return parts;
}
const matCache = new Map();
const plantMat = (c) => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true })); return matCache.get(c); };
export function plantObject(p, z) {
  const g = new THREE.Group();
  for (const part of plantParts(p.k)) g.add(new THREE.Mesh(part.geo, plantMat(part.color)));
  g.position.set(p.x, p.y, z); g.rotation.z = p.r || 0; g.scale.setScalar(p.s || 1);
  g.userData.plant = p.id;
  return g;
}

// ------------------------------------------------------------------ export
// closed solids, each [{name, color, pos: Float32Array (triangle soup, mm)}]
// the ground: the height grid on top, straight sides, a flat bottom `base` below its lowest point
export function groundSolid(L, arr) {
  const { nx, ny, x0, y0, res } = L, H = arr.h, P = [];
  let lo = Infinity; for (const v of H) lo = Math.min(lo, v);
  const zb = lo - (L.base || 1000);
  const X = (i) => x0 + i * res, Y = (j) => y0 + j * res, Z = (i, j) => H[j * nx + i];
  const tcol = [], side0 = "#8B6A45";
  let tc = side0;
  const tri = (a, b, c) => { P.push(...a, ...b, ...c); tcol.push(tc); };
  const gc = GROUND.map((g) => g.c.toUpperCase());
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = [X(i), Y(j), Z(i, j)], b = [X(i + 1), Y(j), Z(i + 1, j)], c = [X(i + 1), Y(j + 1), Z(i + 1, j + 1)], d = [X(i), Y(j + 1), Z(i, j + 1)];
    // the cell's ground: the most common of its corners
    const q = [arr.m[j * nx + i], arr.m[j * nx + i + 1], arr.m[(j + 1) * nx + i + 1], arr.m[(j + 1) * nx + i]];
    let best = q[0], bn = 0; for (const v of q) { const n = q.filter((x) => x === v).length; if (n > bn) { bn = n; best = v; } }
    tc = gc[best] || gc[0];
    tri(a, b, c); tri(a, c, d);
  }
  tc = side0;
  // the outline, counter-clockwise seen from above; straight sides down to the base, and the base
  // as a fan from its middle (so every edge meets exactly one other)
  const loop = [];
  for (let i = 0; i < nx - 1; i++) loop.push([i, 0]);
  for (let j = 0; j < ny - 1; j++) loop.push([nx - 1, j]);
  for (let i = nx - 1; i > 0; i--) loop.push([i, ny - 1]);
  for (let j = ny - 1; j > 0; j--) loop.push([0, j]);
  const cB = [(X(0) + X(nx - 1)) / 2, (Y(0) + Y(ny - 1)) / 2, zb];
  for (let k = 0; k < loop.length; k++) {
    const [i0, j0] = loop[k], [i1, j1] = loop[(k + 1) % loop.length];
    const p = [X(i0), Y(j0), Z(i0, j0)], q = [X(i1), Y(j1), Z(i1, j1)], pb = [p[0], p[1], zb], qb = [q[0], q[1], zb];
    tri(p, pb, qb); tri(p, qb, q);
    tri(cB, qb, pb);
  }
  return { name: "Ground", color: GROUND[0].c, pos: new Float32Array(P), tcol, zb };
}
// the water: columns from the pond bottom up to the water level, joined into closed bodies
export function waterSolid(L, arr) {
  const { nx, ny, x0, y0, res } = L, H = arr.h, W = arr.w, P = [];
  const wet = new Uint8Array((nx - 1) * (ny - 1)), lvl = new Float32Array((nx - 1) * (ny - 1));
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const q = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
    if (q.some((v) => isNaN(W[v]))) continue;
    wet[j * (nx - 1) + i] = 1; lvl[j * (nx - 1) + i] = (W[q[0]] + W[q[1]] + W[q[2]] + W[q[3]]) / 4;
  }
  const X = (i) => x0 + i * res, Y = (j) => y0 + j * res, Z = (i, j) => H[j * nx + i];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  const isW = (i, j) => i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 && wet[j * (nx - 1) + i];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (!isW(i, j)) continue;
    const z = lvl[j * (nx - 1) + i];
    const t = [[X(i), Y(j), z], [X(i + 1), Y(j), z], [X(i + 1), Y(j + 1), z], [X(i), Y(j + 1), z]];
    const b = [[X(i), Y(j), Math.min(z - 1, Z(i, j))], [X(i + 1), Y(j), Math.min(z - 1, Z(i + 1, j))], [X(i + 1), Y(j + 1), Math.min(z - 1, Z(i + 1, j + 1))], [X(i), Y(j + 1), Math.min(z - 1, Z(i, j + 1))]];
    tri(t[0], t[1], t[2]); tri(t[0], t[2], t[3]);
    tri(b[0], b[2], b[1]); tri(b[0], b[3], b[2]);
    // walls where the water ends (or meets water at another level)
    // p to q runs counter-clockwise (seen from above), so the walls face out
    const wall = (p, q, bp, bq) => { tri(p, bp, bq); tri(p, bq, q); };
    const nb = (ii, jj) => isW(ii, jj) && Math.abs(lvl[jj * (nx - 1) + ii] - z) < 1;
    if (!nb(i, j - 1)) wall(t[0], t[1], b[0], b[1]);
    if (!nb(i + 1, j)) wall(t[1], t[2], b[1], b[2]);
    if (!nb(i, j + 1)) wall(t[2], t[3], b[2], b[3]);
    if (!nb(i - 1, j)) wall(t[3], t[0], b[3], b[0]);
  }
  return P.length ? { name: "Water", color: WATER, pos: new Float32Array(P) } : null;
}
export function plantSolids(L, arr, plants) {
  const out = new Map();
  for (const p of plants) {
    const z = heightAt(L, arr, p.x, p.y), M = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, z - 30 * (p.s || 1)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.r || 0), new THREE.Vector3(p.s || 1, p.s || 1, p.s || 1));
    for (const part of plantParts(p.k)) {
      const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone(); g.applyMatrix4(M);
      const TR = ["#6b4a2b", "#8a6b48", "#ece8de", "#5d3b2c", "#e4e0d2", "#6e5d4e", "#7d6248"], RK = ["#8d8a84", "#8b8780", "#85817a", "#97928a", "#7a766f", "#8f8b84", "#9a958d", "#a29d93", "#a7a29a", "#8c877f", "#bdb7ad", "#b4aba3", "#9f978f"];
      const name = TR.includes(part.color) ? "Tree trunks" : RK.includes(part.color) ? "Rocks " + part.color : "Plants " + part.color;
      if (!out.has(name)) out.set(name, { name: name.startsWith("Plants") ? "Plants" : name.startsWith("Rocks") ? "Rocks" : name, color: part.color, chunks: [] });
      out.get(name).chunks.push(g.attributes.position.array);
    }
  }
  return [...out.values()].map((o) => { const n = o.chunks.reduce((a, c) => a + c.length, 0), pos = new Float32Array(n); let k = 0; for (const c of o.chunks) { pos.set(c, k); k += c.length; } return { name: o.name, color: o.color, pos }; });
}
// ------------------------------------------------------------------ files
// parts: [{name, color, pos}] in mm; k: scale; off: [x, y, z] (mm, full size) to move to the origin
function xform(parts, k, off) { return parts.map((p) => { const q = new Float32Array(p.pos.length); for (let i = 0; i < q.length; i += 3) { q[i] = (p.pos[i] - off[0]) * k; q[i + 1] = (p.pos[i + 1] - off[1]) * k; q[i + 2] = (p.pos[i + 2] - off[2]) * k; } return { ...p, pos: q }; }); }
export function stlFile(parts, k, off) {
  parts = xform(parts, k, off);
  const n = parts.reduce((a, p) => a + p.pos.length / 9, 0), dv = new DataView(new ArrayBuffer(84 + n * 50));
  dv.setUint32(80, n, true); let o = 84;
  for (const p of parts) for (let t = 0; t < p.pos.length; t += 9) {
    const P = p.pos, ux = P[t + 3] - P[t], uy = P[t + 4] - P[t + 1], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vy = P[t + 7] - P[t + 1], vz = P[t + 8] - P[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    for (const f of [nx / l, ny / l, nz / l]) { dv.setFloat32(o, f, true); o += 4; }
    for (let i = 0; i < 9; i++) { dv.setFloat32(o, P[t + i], true); o += 4; }
    o += 2;
  }
  return new Uint8Array(dv.buffer);
}
const r5 = (v) => { const r = Math.round(v * 1e4) / 1e4; return Object.is(r, -0) ? "0" : String(r); };
// welded vertices (by position) for OBJ and 3MF
function weld(pos) {
  const map = new Map(), V = [], I = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) { const key = r5(pos[i]) + " " + r5(pos[i + 1]) + " " + r5(pos[i + 2]); let id = map.get(key); if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(pos[i], pos[i + 1], pos[i + 2]); } I[i / 3] = id; }
  return { V, I };
}
export function objFile(parts, k, off, title) {
  parts = xform(parts, k, off);
  const L = [`# ${title} - made with JumpStart 3D (Architect)`, "# units: millimetres; vertex colours after the coordinates"];
  let base = 1;
  for (const p of parts) {
    const c = new THREE.Color(p.color), { V, I } = weld(p.pos);
    const vc = new Array(V.length / 3).fill(null);
    if (p.tcol) for (let t = 0; t < I.length; t++) if (!vc[I[t]]) vc[I[t]] = p.tcol[Math.floor(t / 3)];
    const cc = new Map();
    const col = (h) => { if (!h) return c; if (!cc.has(h)) cc.set(h, new THREE.Color(h)); return cc.get(h); };
    L.push(`o ${p.name.replace(/\s+/g, "_")}`);
    for (let i = 0; i < V.length; i += 3) { const q = col(vc[i / 3]); L.push(`v ${r5(V[i])} ${r5(V[i + 1])} ${r5(V[i + 2])} ${q.r.toFixed(3)} ${q.g.toFixed(3)} ${q.b.toFixed(3)}`); }
    for (let t = 0; t < I.length; t += 3) L.push(`f ${I[t] + base} ${I[t + 1] + base} ${I[t + 2] + base}`);
    base += V.length / 3;
  }
  return new TextEncoder().encode(L.join("\n") + "\n");
}
export async function threeMFFile(parts, k, off, title) {
  parts = xform(parts, k, off);
  const esc = (t) => String(t).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]);
  const colors = [...new Set([...parts.map((p) => p.color.toUpperCase()), ...parts.flatMap((p) => (p.tcol ? [...new Set(p.tcol)].map((c) => c.toUpperCase()) : []))])];
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">JumpStart 3D</metadata>', ` <metadata name="Title">${esc(title)}</metadata>`, " <resources>", '  <basematerials id="1">'];
  colors.forEach((c) => out.push(`   <base name="${esc(c)}" displaycolor="${c}FF"/>`));
  out.push("  </basematerials>");
  parts.forEach((p, n) => {
    const { V, I } = weld(p.pos);
    out.push(`  <object id="${n + 2}" type="model" name="${esc(p.name)}" pid="1" pindex="${colors.indexOf(p.color.toUpperCase())}">`, "   <mesh>", "    <vertices>");
    for (let i = 0; i < V.length; i += 3) out.push(`     <vertex x="${r5(V[i])}" y="${r5(V[i + 1])}" z="${r5(V[i + 2])}"/>`);
    out.push("    </vertices>", "    <triangles>");
    for (let t = 0; t < I.length; t += 3) if (I[t] !== I[t + 1] && I[t + 1] !== I[t + 2] && I[t] !== I[t + 2]) out.push(`     <triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"` + (p.tcol ? ` pid="1" p1="${colors.indexOf(p.tcol[t / 3].toUpperCase())}"` : "") + "/>");
    out.push("    </triangles>", "   </mesh>", "  </object>");
  });
  out.push(" </resources>", " <build>");
  parts.forEach((p, n) => out.push(`  <item objectid="${n + 2}"/>`));
  out.push(" </build>", "</model>");
  const enc = new TextEncoder();
  const z = await zipFiles([
    { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: "3D/3dmodel.model", data: enc.encode(out.join("\n")) },
  ]);
  return z;
}
// a zip with deflated entries (3MF files are zips); stored when the browser can't compress
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(u8) {
  if (typeof CompressionStream === "undefined") return null;
  try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); } catch (e) { return null; }
}
async function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), z = await deflate(f.data), data = z || f.data, method = z ? 8 : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, method, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(10, method, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
