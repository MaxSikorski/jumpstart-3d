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
  // more trees
  { id: "magnolia", name: "Magnolia", h: 6000 }, { id: "jacaranda", name: "Jacaranda (purple)", h: 6500 }, { id: "ginkgo", name: "Ginkgo (gold)", h: 8000 },
  { id: "olive", name: "Olive tree", h: 4000 }, { id: "japanesemaple", name: "Japanese maple", h: 3000 }, { id: "dogwood", name: "Dogwood", h: 5000 },
  { id: "sequoia", name: "Giant redwood", h: 15000 }, { id: "cedar", name: "Cedar", h: 8500 }, { id: "poplar", name: "Poplar", h: 11000 },
  { id: "elm", name: "Elm", h: 9000 }, { id: "acacia", name: "Acacia (savanna)", h: 6000 }, { id: "baobab", name: "Baobab", h: 9000 },
  { id: "coconut", name: "Coconut palm", h: 9000 }, { id: "datepalm", name: "Date palm", h: 7500 }, { id: "bamboo", name: "Bamboo grove", h: 6000 },
  { id: "eucalyptus", name: "Eucalyptus", h: 10000 }, { id: "lemon", name: "Lemon tree", h: 3500 }, { id: "orange", name: "Orange tree", h: 4000 },
  { id: "joshua", name: "Desert yucca tree", h: 5000 }, { id: "snowpine", name: "Snowy pine", h: 8000 },
  // more shrubs
  { id: "azalea", name: "Azalea", h: 900 }, { id: "lilac", name: "Lilac", h: 2500 }, { id: "forsythia", name: "Forsythia (yellow)", h: 1800 },
  { id: "holly", name: "Holly", h: 1700 }, { id: "topiaryball", name: "Topiary ball", h: 1500 }, { id: "topiarycone", name: "Topiary cone", h: 1600 },
  { id: "tallhedge", name: "Tall hedge", h: 2200 }, { id: "hosta", name: "Hosta", h: 500 }, { id: "agave", name: "Agave", h: 1000 }, { id: "succulents", name: "Succulents", h: 250 },
  // more flowers and grasses
  { id: "sunflowers", name: "Sunflowers", h: 2000 }, { id: "daisies", name: "Daisies", h: 400 }, { id: "poppies", name: "Poppies", h: 550 },
  { id: "daffodils", name: "Daffodils", h: 400 }, { id: "marigolds", name: "Marigolds", h: 350 }, { id: "bluebells", name: "Bluebells", h: 300 },
  { id: "fountaingrass", name: "Fountain grass", h: 1000 }, { id: "clover", name: "Clover patch", h: 100 }, { id: "lotus", name: "Lotus", h: 350 }, { id: "mushrooms", name: "Mushrooms", h: 300 },
  // garden
  { id: "planterpot", name: "Potted plant", h: 1000 }, { id: "vegbed", name: "Vegetable bed", h: 600 }, { id: "corn", name: "Corn stalks", h: 2200 },
  { id: "pumpkins", name: "Pumpkin patch", h: 500 }, { id: "tomato", name: "Tomato plant", h: 1400 }, { id: "bonsai", name: "Bonsai", h: 600 }, { id: "birdbath", name: "Bird bath", h: 900 },
  // logs and more stones
  { id: "log", name: "Fallen log", h: 500 }, { id: "stump", name: "Tree stump", h: 550 }, { id: "mossyrock", name: "Mossy rock", h: 1000 }, { id: "riverrocks", name: "River rocks", h: 200 },
];
// groups for the catalog
const CAT = {
  tree: "oak maple birch pine spruce palm willow cypress fir cherry apple aspen dead redmaple fanpalm cactus magnolia jacaranda ginkgo olive japanesemaple dogwood sequoia cedar poplar elm acacia baobab coconut datepalm bamboo eucalyptus lemon orange joshua snowpine",
  shrub: "bush shrub hedge boxwood lavender rose hydrangea fern juniper azalea lilac forsythia holly topiaryball topiarycone tallhedge hosta agave succulents",
  grass: "grassclump pampas reeds wildflowers tulips lilypad sunflowers daisies poppies daffodils marigolds bluebells fountaingrass clover lotus mushrooms",
  garden: "planterpot vegbed corn pumpkins tomato bonsai birdbath",
  rock: "rock stone rockpile flatstone pebbles boulder2 log stump mossyrock riverrocks",
};
for (const P of PLANTS) P.cat = Object.keys(CAT).find((k) => CAT[k].split(" ").includes(P.id)) || "tree";
export const PLANT_CATS = [["tree", "Trees"], ["shrub", "Shrubs"], ["grass", "Grass & flowers"], ["garden", "Garden"], ["rock", "Rocks & logs"]];
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
  else morePlants(kind, { add, trunk, ball, cone });
  PCACHE.set(kind, parts);
  return parts;
}
// the newer plants: built from the same simple shapes
const cylZ = (rt, rb, h, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n).rotateX(Math.PI / 2);
const coneZ = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n).rotateX(Math.PI / 2);
function ring(n, r, f) { for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + 0.37 * (k % 3); f(Math.cos(a) * r, Math.sin(a) * r, k, a); } }
function morePlants(kind, { add, trunk, ball, cone }) {
  const T1 = "#6b4a2b", T2 = "#5d3b2c";
  // a round crown with fruit or flowers dotted over it
  const dotted = (crown, rC, zC, dot, rD, n) => { ball(rC, crown, 0, 0, zC); for (let k = 0; k < n; k++) { const u = (k + 0.5) / n, z = 1 - 1.6 * u, a = k * 2.39996, rr = Math.sqrt(Math.max(0, 1 - z * z)); ball(rD, dot, Math.cos(a) * rr * rC * 0.98, Math.sin(a) * rr * rC * 0.98, zC + z * rC * 0.98); } };
  const stemsFlowers = (n, h, r, head, rH, stem = "#5d8f3e") => { for (let k = 0; k < n; k++) { const a = k * 2.4, d = 60 + (k % 4) * r, x = Math.cos(a) * d, y = Math.sin(a) * d, hh = h * (0.8 + 0.2 * ((k * 7) % 3) / 2); add(cylZ(14, 16, hh, 4), stem, x, y, hh / 2); ball(rH, head, x, y, hh); } };
  switch (kind) {
    case "magnolia": trunk(220, 2600, T2); for (const [x, y, z, r] of [[0, 0, 4000, 1700], [800, 300, 3500, 1200], [-800, -300, 3600, 1200]]) ball(r, "#3f7a3a", x, y, z); ring(14, 1500, (x, y, k) => ball(200, "#f6dbe6", x * (0.7 + (k % 3) * 0.15), y * (0.7 + (k % 3) * 0.15), 3600 + (k % 4) * 450)); break;
    case "jacaranda": trunk(220, 3000, T2); for (const [x, y, z, r] of [[0, 0, 4600, 2400], [1300, 400, 4200, 1500], [-1300, -400, 4300, 1500]]) ball(r, "#8a6fd1", x, y, z, 0.55); break;
    case "ginkgo": trunk(200, 3600); for (const [x, y, z, r] of [[0, 0, 5600, 1500], [500, 200, 4500, 1300], [-400, -300, 6600, 1000]]) ball(r, "#e8c53a", x, y, z, 1.25); break;
    case "olive": trunk(320, 1700, "#6e5d4e"); for (const [x, y, z, r] of [[0, 0, 2900, 1500], [900, 300, 2500, 1000], [-800, -400, 2700, 1000], [200, -900, 3100, 900]]) ball(r, "#8fa37a", x, y, z, 0.7); break;
    case "japanesemaple": trunk(140, 1300, T2); for (const [x, y, z, r] of [[0, 0, 2000, 1500], [1000, 300, 1700, 1000], [-1000, -200, 1800, 1000], [200, 900, 2400, 900]]) ball(r, "#b8282e", x, y, z, 0.5); break;
    case "dogwood": trunk(180, 2200); dotted("#4d8a3c", 1700, 3400, "#f5f3ec", 160, 22); break;
    case "sequoia": add(cylZ(420, 700, 6500, 10), "#8a4a2e", 0, 0, 3250); cone(2600, 9500, "#2f5a34", 5000); break;
    case "cedar": trunk(320, 2400); for (const [z, r] of [[2300, 2600], [3600, 2200], [4800, 1800], [6000, 1300], [7100, 800]]) add(cylZ(r * 0.8, r, 450, 10), "#3d6a45", 0, 0, z); cone(500, 1200, "#3d6a45", 7300); break;
    case "poplar": trunk(200, 1600); ball(1000, "#5e9a45", 0, 0, 6200, 4.8); break;
    case "elm": trunk(320, 4200); for (const [x, y, z, r] of [[0, 0, 6600, 2600], [1500, 600, 5800, 1600], [-1500, -600, 5900, 1600], [400, -1500, 6100, 1500]]) ball(r, "#4a8040", x, y, z, 0.8); break;
    case "acacia": trunk(220, 4000, "#7d6248"); for (const [x, y, z, r] of [[0, 0, 5000, 2800], [1200, 600, 4700, 1600]]) ball(r, "#6f8f3a", x, y, z, 0.25); break;
    case "baobab": add(cylZ(900, 1150, 6200, 10), "#9a8068", 0, 0, 3100); ring(6, 300, (x, y, k, a) => { const g = cylZ(80, 180, 1500, 6); g.rotateX(0.7); g.rotateZ(a); add(g, "#9a8068", x, y, 6600); ball(500, "#6f9a45", x * 4.5, y * 4.5, 7300 + (k % 2) * 300, 0.5); }); break;
    case "coconut": { for (let k = 0; k < 8; k++) add(cylZ(170, 200, 1150, 8), "#8a6b48", (k * k) * 22, 0, 600 + k * 1050); const tx = 49 * 22, tz = 8700; ring(9, 0, (x, y, k, a) => { const leaf = new THREE.BoxGeometry(2800, 420, 60); leaf.translate(1400, 0, 0); leaf.rotateY(0.55); leaf.rotateZ(a); add(leaf, "#4f9a3e", tx, 0, tz); }); for (const [x, y] of [[150, 0], [-100, 120], [-60, -150]]) ball(180, "#6b4a2b", tx + x, y, tz - 200); break; }
    case "datepalm": add(cylZ(330, 400, 6200, 10), "#8a6b48", 0, 0, 3100); ring(14, 0, (x, y, k, a) => { const leaf = new THREE.BoxGeometry(3200, 360, 60); leaf.translate(1600, 0, 0); leaf.rotateY(k % 2 ? 0.35 : -0.15); leaf.rotateZ(a); add(leaf, "#5f8f43", 0, 0, 6300); }); break;
    case "bamboo": ring(9, 500, (x, y, k) => { const h = 4200 + (k % 3) * 700; add(cylZ(55, 65, h, 6), "#7fa646", x * (0.4 + (k % 2) * 0.6), y * (0.4 + (k % 2) * 0.6), h / 2); ball(380, "#8db556", x * (0.4 + (k % 2) * 0.6), y * (0.4 + (k % 2) * 0.6), h, 1.6); }); break;
    case "eucalyptus": trunk(260, 6000, "#d9d2c4"); for (const [x, y, z, r] of [[0, 0, 7800, 1500], [1000, 500, 6600, 1100], [-900, -400, 7000, 1100], [300, -800, 8800, 900]]) ball(r, "#7a9e8a", x, y, z, 1.2); break;
    case "lemon": trunk(160, 1300); dotted("#4f8a3c", 1300, 2300, "#f2d23a", 120, 18); break;
    case "orange": trunk(180, 1500); dotted("#3f7f35", 1500, 2600, "#f08a24", 140, 18); break;
    case "joshua": trunk(300, 2200, "#8a7a5a"); ring(5, 0, (x, y, k, a) => { const l = 1200 + (k % 2) * 500, g = cylZ(130, 170, l, 6); g.translate(0, 0, l / 2); g.rotateY(0.8); g.rotateZ(a); add(g, "#8a7a5a", 0, 0, 2000 + (k % 3) * 250); const ex = Math.cos(a) * Math.sin(0.8) * l, ey = Math.sin(a) * Math.sin(0.8) * l, ez = 2000 + (k % 3) * 250 + Math.cos(0.8) * l; ring(7, 0, (x2, y2, j, b) => { const sp = coneZ(70, 600, 4); sp.translate(0, 0, 300); sp.rotateY(0.9); sp.rotateZ(b); add(sp, "#6f8f4a", ex, ey, ez); }); }); break;
    case "snowpine": trunk(220, 2200); for (const [r, h, z] of [[2200, 3000, 1400], [1700, 2700, 3300], [1100, 2500, 5300]]) { cone(r, h, "#2f6b3a", z); cone(r * 0.55, h * 0.45, "#f1f4f7", z + h * 0.6); } break;
    case "azalea": dotted("#3f7a3a", 520, 420, "#e85b9a", 120, 26); break;
    case "lilac": trunk(70, 900, T1); for (const [x, y, z, r] of [[0, 0, 1500, 800], [500, 200, 1300, 550], [-450, -250, 1300, 550]]) ball(r, "#4f8a3c", x, y, z); ring(10, 650, (x, y, k) => { add(coneZ(170, 520, 6), "#b598d9", x * (0.6 + (k % 3) * 0.2), y * (0.6 + (k % 3) * 0.2), 1700 + (k % 3) * 220); }); break;
    case "forsythia": for (const [x, y, z, r] of [[0, 0, 900, 800], [600, 300, 750, 600], [-600, -300, 750, 600], [200, -600, 800, 550]]) ball(r, "#f2cf35", x, y, z, 1.1); break;
    case "holly": { const g = new THREE.IcosahedronGeometry(700, 1); g.scale(1, 1, 1.3); add(g, "#24502e", 0, 0, 900); ring(16, 660, (x, y, k) => ball(60, "#c41e2a", x * (0.8 + (k % 3) * 0.1), y * (0.8 + (k % 3) * 0.1), 500 + (k % 5) * 220)); break; }
    case "topiaryball": add(new THREE.BoxGeometry(600, 600, 450), "#a0522d", 0, 0, 225); add(cylZ(40, 50, 800, 6), T1, 0, 0, 850); ball(420, "#2f6a32", 0, 0, 1150); break;
    case "topiarycone": add(new THREE.BoxGeometry(600, 600, 450), "#a0522d", 0, 0, 225); cone(450, 1150, "#2f6a32", 440); break;
    case "tallhedge": add(new THREE.BoxGeometry(3000, 900, 2200), "#356b30", 0, 0, 1100); break;
    case "hosta": ring(9, 260, (x, y, k) => ball(260, k % 2 ? "#6fa35a" : "#8fbf6a", x, y, 220, 0.45)); ball(220, "#5f9a4a", 0, 0, 300, 0.7); break;
    case "agave": ring(12, 0, (x, y, k, a) => { const leaf = coneZ(90, 900, 4); leaf.translate(0, 0, 450); leaf.rotateY(0.45 + (k % 3) * 0.25); leaf.rotateZ(a); add(leaf, "#7a9e8a", 0, 0, 60); }); break;
    case "succulents": { const cs = ["#7fae8f", "#a9c48a", "#c88aa0", "#8fb7a8"]; ring(7, 160, (x, y, k) => ball(90 + (k % 3) * 25, cs[k % 4], x, y, 70, 0.7)); ball(110, "#9cc4a0", 0, 0, 90, 0.8); break; }
    case "sunflowers": for (let k = 0; k < 5; k++) { const a = k * 2.4, d = 80 + (k % 3) * 160, x = Math.cos(a) * d, y = Math.sin(a) * d, h = 1600 + (k % 3) * 200; add(cylZ(22, 28, h, 5), "#5d8f3e", x, y, h / 2); const disc = new THREE.CylinderGeometry(200, 200, 50, 12); disc.rotateZ(Math.PI / 2); disc.rotateY(0.2); disc.rotateZ(a); add(disc, "#f2c230", x, y, h + 100); ball(100, "#6b4a2b", x + Math.cos(a) * 30, y + Math.sin(a) * 30, h + 100, 0.6); } break;
    case "daisies": stemsFlowers(9, 360, 80, "#ffffff", 55); ring(9, 0, () => {}); break;
    case "poppies": stemsFlowers(7, 480, 100, "#e0302a", 75); break;
    case "daffodils": stemsFlowers(8, 360, 80, "#f2d23a", 65); break;
    case "marigolds": for (const [x, y, r] of [[0, 0, 130], [180, 90, 110], [-170, -60, 110], [60, -190, 100], [-80, 190, 100]]) { ball(r * 1.3, "#4f7f36", x, y, 120, 0.6); ball(r, "#f08a24", x, y, 230, 0.8); } break;
    case "bluebells": stemsFlowers(10, 260, 70, "#5a6fd0", 40); break;
    case "fountaingrass": ring(14, 120, (x, y, k, a) => { const g = coneZ(45, 1000, 4); g.translate(0, 0, 500); g.rotateY(0.25 + (k % 3) * 0.15); g.rotateZ(a); add(g, "#a8b36a", x, y, 0); }); ball(160, "#e6dcc0", 0, 0, 900, 2); break;
    case "clover": ring(12, 260, (x, y, k) => add(cylZ(70, 70, 30, 8), "#5f9a45", x * ((k % 3) * 0.3 + 0.4), y * ((k % 3) * 0.3 + 0.4), 30)); ring(5, 200, (x, y) => ball(30, "#f5f3ec", x, y, 80)); break;
    case "lotus": add(new THREE.BoxGeometry(1200, 1000, 20), "#3d8fd6", 0, 0, 10); for (const [x, y, r] of [[0, 0, 300], [420, 220, 220], [-350, 260, 240]]) add(cylZ(r, r, 30, 12), "#4f8f3c", x, y, 40); ring(8, 70, (x, y, k, a) => { const pe = coneZ(70, 260, 4); pe.translate(0, 0, 130); pe.rotateY(0.5); pe.rotateZ(a); add(pe, "#f2a2c0", 0, 0, 60); }); ball(60, "#f2d23a", 0, 0, 120); break;
    case "mushrooms": for (const [x, y, s] of [[0, 0, 1], [160, 80, 0.7], [-130, 110, 0.6], [60, -150, 0.55]]) { add(cylZ(35 * s, 45 * s, 200 * s, 6), "#efe8da", x, y, 100 * s); ball(120 * s, "#c8302a", x, y, 200 * s, 0.5); } break;
    case "planterpot": add(cylZ(330, 240, 450, 12), "#b5653a", 0, 0, 225); dotted("#4f8a3c", 330, 700, "#e06aa8", 70, 12); break;
    case "vegbed": add(new THREE.BoxGeometry(2400, 1100, 300), "#8a6b48", 0, 0, 150); add(new THREE.BoxGeometry(2250, 950, 40), "#5a3b25", 0, 0, 300); for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) ball(130, r === 1 ? "#6aa84f" : "#4f8f3c", -950 + k * 380, -300 + r * 300, 420, 0.8); break;
    case "corn": ring(6, 260, (x, y, k) => { add(cylZ(28, 35, 2100, 5), "#7a9e3a", x, y, 1050); for (const z of [700, 1200, 1700]) { const lf = new THREE.BoxGeometry(600, 90, 20); lf.translate(300, 0, 0); lf.rotateY(-0.4); lf.rotateZ(k + z); add(lf, "#7fae4b", x, y, z); } ball(60, "#f2d23a", x + 40, y, 1300, 2.4); }); break;
    case "pumpkins": for (const [x, y, r] of [[0, 0, 300], [520, 260, 220], [-460, 180, 250], [120, -480, 200]]) { ball(r, "#e87a1e", x, y, r * 0.7, 0.75); add(cylZ(25, 30, 120, 5), "#5d8f3e", x, y, r * 1.35); } for (let k = 0; k < 6; k++) ball(160, "#4f8f3c", Math.cos(k) * 650, Math.sin(k) * 650, 60, 0.3); break;
    case "tomato": ring(3, 280, (x, y) => add(cylZ(14, 14, 1300, 4), "#9a9a9a", x, y, 650)); for (const z of [400, 900, 1300]) add(cylZ(300 - z * 0.05, 300 - z * 0.05, 20, 12), "#9a9a9a", 0, 0, z); dotted("#3f7f35", 420, 800, "#d23a2a", 70, 14); break;
    case "bonsai": add(new THREE.BoxGeometry(700, 450, 160), "#5a6f8a", 0, 0, 80); { const g = cylZ(35, 70, 380, 6); g.rotateY(0.35); add(g, T2, 40, 0, 330); } for (const [x, y, z, r] of [[150, 0, 520, 230], [-120, 80, 470, 170], [60, -100, 600, 150]]) ball(r, "#3f7a35", x, y, z, 0.45); break;
    case "birdbath": add(cylZ(110, 160, 650, 10), "#bdb7ad", 0, 0, 325); add(cylZ(420, 300, 160, 14), "#bdb7ad", 0, 0, 730); add(cylZ(360, 360, 20, 14), "#3d8fd6", 0, 0, 805); break;
    case "log": { const g = new THREE.CylinderGeometry(260, 280, 2600, 10); g.rotateZ(Math.PI / 2); add(g, T1, 0, 0, 260); for (const sx of [-1, 1]) { const e = new THREE.CylinderGeometry(240, 240, 20, 10); e.rotateZ(Math.PI / 2); add(e, "#c8a878", sx * 1305, 0, 260); } break; }
    case "stump": add(cylZ(420, 520, 500, 10), T1, 0, 0, 250); add(cylZ(400, 400, 30, 10), "#c8a878", 0, 0, 510); break;
    case "mossyrock": { const g = new THREE.DodecahedronGeometry(650, 0); g.scale(1.3, 1, 0.8); add(g, "#8d8a84", 0, 0, 450); ball(560, "#5f8a3c", 80, 0, 820, 0.3); break; }
    case "riverrocks": { const cs = ["#9d978e", "#7f7a73", "#b3ada4", "#8e8a82"]; ring(7, 260, (x, y, k) => { const g = new THREE.IcosahedronGeometry(120 + (k % 3) * 40, 1); g.scale(1.4, 1, 0.55); add(g, cs[k % 4], x, y, 55); }); break; }
    default: ball(500, "#4f8f3c", 0, 0, 500);
  }
}
// small pictures for the newer plants' catalog tiles (44 x 40)
const TRK = '<rect x="20.5" y="26" width="3" height="12" fill="#6b4a2b"/>';
const crown = (c, extra = "") => `${TRK}<circle cx="22" cy="17" r="11" fill="${c}"/>${extra}`;
const dots = (c, pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${c}"/>`).join("");
const flowers = (c) => '<path d="M12 38V26M18 38V22M24 38V25M30 38V21M35 38V27" stroke="#5d8f3e" stroke-width="1.6"/>' + [[12, 25], [18, 21], [24, 24], [30, 20], [35, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="${c}"/>`).join("");
export const PLANT_ICONS = {
  magnolia: crown("#3f7a3a", dots("#f6dbe6", [[16, 13], [26, 12], [20, 21], [29, 19], [14, 20]])),
  jacaranda: `${TRK}<ellipse cx="22" cy="18" rx="16" ry="8" fill="#8a6fd1"/>`,
  ginkgo: `${TRK}<ellipse cx="22" cy="15" rx="9" ry="12" fill="#e8c53a"/>`,
  olive: '<path d="M22 38v-12l-3-4" stroke="#6e5d4e" stroke-width="3.5" fill="none"/><ellipse cx="22" cy="18" rx="14" ry="8" fill="#8fa37a"/>',
  japanesemaple: '<path d="M22 38v-10" stroke="#5d3b2c" stroke-width="3"/><ellipse cx="22" cy="24" rx="17" ry="6" fill="#b8282e"/>',
  dogwood: crown("#4d8a3c", dots("#f5f3ec", [[15, 14], [24, 10], [28, 18], [18, 21], [22, 15]])),
  sequoia: '<rect x="19.5" y="22" width="5" height="16" fill="#8a4a2e"/><path d="M22 2 32 30H12z" fill="#2f5a34"/>',
  cedar: '<rect x="20.5" y="26" width="3" height="12" fill="#6b4a2b"/><path d="M8 28h28M11 22h22M14 16h16M18 10h8" stroke="#3d6a45" stroke-width="4"/>',
  poplar: '<rect x="21" y="30" width="2" height="8" fill="#6b4a2b"/><ellipse cx="22" cy="17" rx="5" ry="14" fill="#5e9a45"/>',
  elm: '<path d="M22 38V22l-6-6M22 22l6-6" stroke="#6b4a2b" stroke-width="3" fill="none"/><ellipse cx="22" cy="13" rx="16" ry="9" fill="#4a8040"/>',
  acacia: '<path d="M22 38V18M22 24l-7-6M22 22l7-5" stroke="#7d6248" stroke-width="2.5" fill="none"/><ellipse cx="22" cy="14" rx="18" ry="4" fill="#6f8f3a"/>',
  baobab: '<path d="M16 38 18 16h8l2 22z" fill="#9a8068"/><ellipse cx="13" cy="13" rx="6" ry="3" fill="#6f9a45"/><ellipse cx="31" cy="13" rx="6" ry="3" fill="#6f9a45"/><ellipse cx="22" cy="10" rx="6" ry="3" fill="#6f9a45"/>',
  coconut: '<path d="M18 38c2-10 6-18 10-26" stroke="#8a6b48" stroke-width="3" fill="none"/><path d="M28 12c-6-3-12-2-15 2M28 12c6-3 11-1 13 3M28 12c-2-5-6-8-10-8M28 12c3-5 7-7 11-6" stroke="#4f9a3e" stroke-width="3" fill="none"/>',
  datepalm: '<rect x="20" y="14" width="4.5" height="24" fill="#8a6b48"/><path d="M22 14c-7-3-13 0-16 5M22 14c7-3 13 0 16 5M22 14c-4-6-10-8-14-7M22 14c4-6 10-8 14-7M22 14V3" stroke="#5f8f43" stroke-width="3" fill="none"/>',
  bamboo: '<path d="M13 38V8M19 38V4M25 38V10M31 38V6" stroke="#7fa646" stroke-width="2.5"/><path d="M12 17h3M18 13h3M24 20h3M30 15h3M12 27h3M18 25h3M24 29h3M30 26h3" stroke="#5f8a36" stroke-width="1.2"/>',
  eucalyptus: '<rect x="21" y="18" width="2.4" height="20" fill="#d9d2c4"/><ellipse cx="22" cy="12" rx="7" ry="10" fill="#7a9e8a"/>',
  lemon: crown("#4f8a3c", dots("#f2d23a", [[16, 14], [26, 12], [20, 21], [29, 19], [22, 15]])),
  orange: crown("#3f7f35", dots("#f08a24", [[16, 14], [26, 12], [20, 21], [29, 19], [22, 15]])),
  joshua: '<path d="M22 38V20M22 24l-8-6V12M22 22l7-6V9" stroke="#8a7a5a" stroke-width="3.5" fill="none"/><circle cx="14" cy="11" r="4" fill="#6f8f4a"/><circle cx="29" cy="8" r="4" fill="#6f8f4a"/><circle cx="22" cy="18" r="3.5" fill="#6f8f4a"/>',
  snowpine: `${TRK}<path d="M22 4 34 30H10z" fill="#2f6b3a"/><path d="M22 4 27 15H17zM16 18l4 4h-6zM28 18l2 4h-6z" fill="#f1f4f7"/>`,
  azalea: `<ellipse cx="22" cy="30" rx="13" ry="8" fill="#3f7a3a"/>${dots("#e85b9a", [[14, 27], [19, 24], [25, 23], [30, 27], [22, 30], [27, 31], [16, 32]])}`,
  lilac: '<rect x="21" y="26" width="2" height="12" fill="#6b4a2b"/><ellipse cx="22" cy="24" rx="12" ry="9" fill="#4f8a3c"/><path d="M14 22l2-8 2 8zM20 18l2-9 2 9zM26 20l2-8 2 8z" fill="#b598d9"/>',
  forsythia: '<ellipse cx="22" cy="26" rx="15" ry="11" fill="#f2cf35"/>',
  holly: `<ellipse cx="22" cy="24" rx="10" ry="13" fill="#24502e"/>${dots("#c41e2a", [[17, 20], [25, 17], [27, 27], [19, 30], [22, 24]])}`,
  topiaryball: '<rect x="16" y="31" width="12" height="7" fill="#a0522d"/><rect x="21" y="18" width="2" height="13" fill="#6b4a2b"/><circle cx="22" cy="13" r="8" fill="#2f6a32"/>',
  topiarycone: '<rect x="16" y="31" width="12" height="7" fill="#a0522d"/><path d="M22 4 30 31H14z" fill="#2f6a32"/>',
  tallhedge: '<rect x="4" y="12" width="36" height="26" rx="3" fill="#356b30"/>',
  hosta: '<ellipse cx="14" cy="33" rx="8" ry="4" fill="#6fa35a"/><ellipse cx="30" cy="33" rx="8" ry="4" fill="#8fbf6a"/><ellipse cx="22" cy="30" rx="8" ry="5" fill="#5f9a4a"/>',
  agave: '<path d="M22 38 8 20M22 38l-6-22M22 38V12M22 38l6-22M22 38l14-18" stroke="#7a9e8a" stroke-width="3.5" fill="none"/>',
  succulents: '<circle cx="14" cy="34" r="4" fill="#7fae8f"/><circle cx="22" cy="33" r="5" fill="#a9c48a"/><circle cx="30" cy="34" r="4" fill="#c88aa0"/>',
  sunflowers: '<path d="M14 38V18M28 38V14" stroke="#5d8f3e" stroke-width="2"/><circle cx="14" cy="16" r="6" fill="#f2c230"/><circle cx="14" cy="16" r="2.5" fill="#6b4a2b"/><circle cx="28" cy="12" r="6" fill="#f2c230"/><circle cx="28" cy="12" r="2.5" fill="#6b4a2b"/>',
  daisies: flowers("#ffffff"), poppies: flowers("#e0302a"), daffodils: flowers("#f2d23a"), bluebells: flowers("#5a6fd0"),
  marigolds: '<circle cx="14" cy="32" r="5" fill="#f08a24"/><circle cx="23" cy="30" r="6" fill="#f08a24"/><circle cx="31" cy="33" r="4.5" fill="#f2a33a"/>',
  fountaingrass: '<path d="M22 38C18 28 10 22 6 22M22 38c0-10 0-20 0-26M22 38c4-10 12-16 16-16M22 38c-2-8-6-14-10-18M22 38c2-8 6-14 10-18" stroke="#a8b36a" stroke-width="1.8" fill="none"/>',
  clover: '<ellipse cx="14" cy="35" rx="5" ry="2.5" fill="#5f9a45"/><ellipse cx="24" cy="34" rx="5" ry="2.5" fill="#5f9a45"/><ellipse cx="32" cy="36" rx="4" ry="2" fill="#5f9a45"/><circle cx="24" cy="31" r="1.6" fill="#fff"/>',
  lotus: '<rect x="2" y="30" width="40" height="8" rx="3" fill="#3d8fd6" opacity=".55"/><ellipse cx="14" cy="33" rx="7" ry="2.6" fill="#4f8f3c"/><path d="M22 30l-5-8 5 3 5-3z" fill="#f2a2c0"/>',
  mushrooms: '<rect x="14" y="30" width="4" height="8" fill="#efe8da"/><path d="M8 31a8 7 0 0 1 16 0z" fill="#c8302a"/><rect x="27" y="33" width="3" height="5" fill="#efe8da"/><path d="M23 34a5 4 0 0 1 11 0z" fill="#c8302a"/>',
  planterpot: '<path d="M14 26h16l-2 12H16z" fill="#b5653a"/><circle cx="22" cy="18" r="8" fill="#4f8a3c"/><circle cx="18" cy="15" r="2" fill="#e06aa8"/><circle cx="26" cy="17" r="2" fill="#e06aa8"/>',
  vegbed: '<rect x="4" y="30" width="36" height="8" fill="#8a6b48"/><circle cx="10" cy="28" r="3" fill="#4f8f3c"/><circle cx="18" cy="28" r="3" fill="#6aa84f"/><circle cx="26" cy="28" r="3" fill="#4f8f3c"/><circle cx="34" cy="28" r="3" fill="#6aa84f"/>',
  corn: '<path d="M14 38V6M22 38V4M30 38V8" stroke="#7a9e3a" stroke-width="2"/><path d="M14 22 7 16M22 18l7-6M30 24l7-6" stroke="#7fae4b" stroke-width="2"/><ellipse cx="17" cy="20" rx="2" ry="4" fill="#f2d23a"/>',
  pumpkins: '<ellipse cx="15" cy="32" rx="8" ry="6" fill="#e87a1e"/><ellipse cx="30" cy="34" rx="6" ry="4.5" fill="#e87a1e"/><rect x="14" y="24" width="2" height="3" fill="#5d8f3e"/>',
  tomato: '<path d="M14 38V10M30 38V10M14 16h16M14 26h16" stroke="#9a9a9a" stroke-width="1.5"/><circle cx="22" cy="20" r="8" fill="#3f7f35"/><circle cx="18" cy="22" r="2" fill="#d23a2a"/><circle cx="26" cy="18" r="2" fill="#d23a2a"/>',
  bonsai: '<rect x="10" y="32" width="24" height="6" fill="#5a6f8a"/><path d="M22 32c0-6 3-8 6-10" stroke="#5d3b2c" stroke-width="2.5" fill="none"/><ellipse cx="28" cy="20" rx="7" ry="3" fill="#3f7a35"/><ellipse cx="16" cy="23" rx="5" ry="2.4" fill="#3f7a35"/>',
  birdbath: '<rect x="19" y="20" width="6" height="18" fill="#bdb7ad"/><path d="M9 16h26l-4 5H13z" fill="#bdb7ad"/><rect x="12" y="15" width="20" height="2" fill="#3d8fd6"/>',
  log: '<rect x="5" y="28" width="34" height="9" rx="4.5" fill="#6b4a2b"/><ellipse cx="38" cy="32.5" rx="2.5" ry="4.5" fill="#c8a878"/>',
  stump: '<path d="M13 38V26h18v12z" fill="#6b4a2b"/><ellipse cx="22" cy="26" rx="9" ry="2.5" fill="#c8a878"/>',
  mossyrock: '<path d="M6 37 10 24l10-6 12 4 6 15z" fill="#8d8a84"/><path d="M11 23l9-5 12 4" stroke="#5f8a3c" stroke-width="4" fill="none"/>',
  riverrocks: '<ellipse cx="12" cy="35" rx="6" ry="2.5" fill="#9d978e"/><ellipse cx="23" cy="34" rx="5" ry="2.3" fill="#7f7a73"/><ellipse cx="33" cy="35.5" rx="6" ry="2.4" fill="#b3ada4"/>',
};
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
