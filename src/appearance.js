// Appearances: colors and simulated materials for bodies and faces (display only,
// like Fusion 360's Appearance). They never change the shape or exports.
export const MATERIALS = [
  // key, name, group, base color, metalness, roughness, opacity, takes a custom color
  { key: "paint", name: "Color (paint)", group: "Paint & plastic", color: "#2f6fd6", metal: 0, rough: 0.45, tint: true },
  { key: "plastic-gloss", name: "Plastic, glossy", group: "Paint & plastic", color: "#d23a3a", metal: 0, rough: 0.18, tint: true },
  { key: "plastic-matte", name: "Plastic, matte", group: "Paint & plastic", color: "#3a3f46", metal: 0, rough: 0.8, tint: true },
  { key: "rubber", name: "Rubber", group: "Paint & plastic", color: "#23262a", metal: 0, rough: 0.96, tint: true },
  { key: "ceramic", name: "Ceramic", group: "Paint & plastic", color: "#f3f0e8", metal: 0, rough: 0.12, tint: true },
  // 3D-print filaments: how printed parts look. Silk filaments have a pearly, metal-like shine;
  // rainbow silk changes color along its length, so a print shows color bands up its height, and
  // two-tone gradient silk fades from one color at the bottom to another at the top
  { key: "pla", name: "PLA", group: "3D-print filament", color: "#f08a24", metal: 0, rough: 0.5, tint: true },
  { key: "pla-matte", name: "PLA, matte", group: "3D-print filament", color: "#5d7f9e", metal: 0, rough: 0.9, tint: true },
  { key: "petg", name: "PETG", group: "3D-print filament", color: "#1f8fd0", metal: 0, rough: 0.12, tint: true, env: 1 },
  { key: "petg-clear", name: "PETG, translucent", group: "3D-print filament", color: "#58b8d8", metal: 0, rough: 0.08, opacity: 0.62, tint: true, env: 1 },
  { key: "tpu", name: "TPU (flexible)", group: "3D-print filament", color: "#2b2d31", metal: 0, rough: 0.78, tint: true, env: 0.35 },
  { key: "silk", name: "Silk PLA", group: "3D-print filament", color: "#c9a227", metal: 0.62, rough: 0.24, tint: true },
  { key: "silk-rainbow", name: "Silk, rainbow", group: "3D-print filament", color: "#e04848", metal: 0.62, rough: 0.24, fx: "rainbow" },
  { key: "silk-two", name: "Silk, two-tone gradient", group: "3D-print filament", color: "#d4a017", color2: "#9b3fc4", metal: 0.62, rough: 0.24, tint: true, fx: "grad" },
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
  return { color: (m.tint && a && a.color) || m.color, color2: m.fx === "grad" ? (a && a.color2) || m.color2 : null, fx: m.fx || null, bands: Math.max(1, Math.min(8, (a && a.bands) || 1)),
    metal: m.metal, rough: m.rough, opacity: m.opacity ?? 1, env: m.env, name: m.name };
}
// rainbow and two-tone gradient silk: the color changes with height (Z, the print's layers),
// from the bottom to the top of the body; z0, z1 are the body's bottom and top. Works on
// three.js MeshStandardMaterial / MeshPhysicalMaterial. Returns false when the look has no effect.
const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); };
export function heightColors(m, L, z0, z1) {
  if (!L.fx) { if (m.userData.fxKey) { m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => ""; m.userData.fxKey = null; m._fxMode = 0; m.needsUpdate = true; } return false; }
  m.color.setRGB(1, 1, 1); // the shader paints the color
  const key = [L.fx, L.color, L.color2, L.bands, z0.toFixed(3), z1.toFixed(3)].join("|");
  if (m.userData.fxKey === key) return true;
  m.userData.fxKey = key;
  // three.js builds the shader once per kind and keeps its uniforms, so the same uniform objects
  // are kept on the material and only their values change
  const U = m._fxU || (m._fxU = { fxZ0: { value: 0 }, fxZ1: { value: 1 }, fxA: { value: [1, 1, 1] }, fxB: { value: [1, 1, 1] }, fxN: { value: 1 } });
  U.fxZ0.value = z0; U.fxZ1.value = Math.max(z0 + 1e-3, z1); U.fxA.value = lin(L.color); U.fxB.value = lin(L.color2 || L.color); U.fxN.value = L.bands;
  const mode = L.fx === "rainbow" ? 1 : 2;
  if (m._fxMode === mode) return true; // same shader: the new values are used from the next frame
  m._fxMode = mode;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = "varying float vFxZ;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vFxZ = (modelMatrix * vec4(transformed, 1.0)).z;");
    sh.fragmentShader = `varying float vFxZ; uniform float fxZ0, fxZ1, fxN; uniform vec3 fxA, fxB;
vec3 fxHue(float h) { vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); c = mix(vec3(0.92), c, 0.8); return pow(c, vec3(2.2)); }
` + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
 { float t = clamp((vFxZ - fxZ0) / (fxZ1 - fxZ0), 0.0, 1.0);
   ${mode === 1 ? "diffuseColor.rgb *= fxHue(fract(t * fxN * 0.999) * 0.86);" : "diffuseColor.rgb *= mix(fxA, fxB, smoothstep(0.0, 1.0, t));"} }`);
  };
  m.customProgramCacheKey = () => "fx" + mode;
  m.needsUpdate = true;
  return true;
}
// a CSS swatch that hints at the material: a lit ball
export function swatchCSS(a) {
  const L = lookOf(a);
  if (L.fx) {
    const g = L.fx === "rainbow" ? "#e04848, #f0a030, #e8d840, #48c060, #3890e0, #8a50d0" : `${L.color}, ${L.color2}`;
    return `radial-gradient(circle at 34% 30%, rgba(255,255,255,.9) 0, rgba(255,255,255,0) 32%), linear-gradient(0deg, ${g})`;
  }
  const hi = L.metal > 0.5 ? "rgba(255,255,255,.95)" : `rgba(255,255,255,${0.75 - L.rough * 0.6})`;
  return `radial-gradient(circle at 34% 30%, ${hi} 0, ${hi.replace(/[\d.]+\)$/, "0)")} ${20 + L.rough * 30}%), radial-gradient(circle at 50% 55%, ${L.color} 0, ${shade(L.color, L.metal > 0.5 ? 0.45 : 0.7)} 100%)`;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
