// Appearances: colors and simulated materials for bodies and faces (display only,
// like Fusion 360's Appearance). They never change the shape or exports.
export const MATERIALS = [
  // key, name, group, base color, metalness, roughness, opacity, takes a custom color
  { key: "paint", name: "Color (paint)", group: "Paint & plastic", color: "#2f6fd6", metal: 0, rough: 0.45, tint: true },
  { key: "plastic-gloss", name: "Plastic, glossy", group: "Paint & plastic", color: "#d23a3a", metal: 0, rough: 0.18, tint: true },
  { key: "plastic-matte", name: "Plastic, matte", group: "Paint & plastic", color: "#3a3f46", metal: 0, rough: 0.8, tint: true },
  { key: "pla", name: "PLA print", group: "Paint & plastic", color: "#f08a24", metal: 0, rough: 0.55, tint: true },
  { key: "rubber", name: "Rubber", group: "Paint & plastic", color: "#23262a", metal: 0, rough: 0.96, tint: true },
  { key: "ceramic", name: "Ceramic", group: "Paint & plastic", color: "#f3f0e8", metal: 0, rough: 0.12, tint: true },
  { key: "alu-brushed", name: "Aluminum, brushed", group: "Metal", color: "#c9cdd2", metal: 1, rough: 0.38 },
  { key: "alu-anod", name: "Aluminum, anodized", group: "Metal", color: "#3b6fc4", metal: 0.85, rough: 0.32, tint: true },
  { key: "steel", name: "Steel, polished", group: "Metal", color: "#c3c7cc", metal: 1, rough: 0.12 },
  { key: "steel-satin", name: "Steel, satin", group: "Metal", color: "#a6abb1", metal: 1, rough: 0.32 },
  { key: "chrome", name: "Chrome", group: "Metal", color: "#f2f4f6", metal: 1, rough: 0.03 },
  { key: "titanium", name: "Titanium", group: "Metal", color: "#8e8a84", metal: 1, rough: 0.34 },
  { key: "gold", name: "Gold", group: "Metal", color: "#e7b94c", metal: 1, rough: 0.16 },
  { key: "copper", name: "Copper", group: "Metal", color: "#d58358", metal: 1, rough: 0.24 },
  { key: "brass", name: "Brass", group: "Metal", color: "#d4b05a", metal: 1, rough: 0.26 },
  { key: "iron", name: "Cast iron", group: "Metal", color: "#55585c", metal: 0.9, rough: 0.7 },
  { key: "wood-oak", name: "Wood, oak", group: "Other", color: "#b98a55", metal: 0, rough: 0.68 },
  { key: "wood-walnut", name: "Wood, walnut", group: "Other", color: "#6b4529", metal: 0, rough: 0.6 },
  { key: "carbon", name: "Carbon fiber", group: "Other", color: "#25272a", metal: 0.35, rough: 0.28 },
  { key: "concrete", name: "Concrete", group: "Other", color: "#9b9a95", metal: 0, rough: 0.96 },
  { key: "glass", name: "Glass, clear", group: "Other", color: "#dfeaf0", metal: 0, rough: 0.04, opacity: 0.3 },
  { key: "glass-tint", name: "Glass, tinted", group: "Other", color: "#3c8f6a", metal: 0, rough: 0.05, opacity: 0.45, tint: true },
];
export const matByKey = (k) => MATERIALS.find((m) => m.key === k) || MATERIALS[0];
// the look of one appearance: { mat, color }
export function lookOf(a) {
  const m = matByKey(a && a.mat);
  return { color: (m.tint && a && a.color) || m.color, metal: m.metal, rough: m.rough, opacity: m.opacity ?? 1, name: m.name };
}
// a CSS swatch that hints at the material: a lit ball
export function swatchCSS(a) {
  const L = lookOf(a);
  const hi = L.metal > 0.5 ? "rgba(255,255,255,.95)" : `rgba(255,255,255,${0.75 - L.rough * 0.6})`;
  return `radial-gradient(circle at 34% 30%, ${hi} 0, ${hi.replace(/[\d.]+\)$/, "0)")} ${20 + L.rough * 30}%), radial-gradient(circle at 50% 55%, ${L.color} 0, ${shade(L.color, L.metal > 0.5 ? 0.45 : 0.7)} 100%)`;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
