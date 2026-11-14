// jumpstart-3d: pure generator option checks and pair placement (IMPROVEMENT_PLAN 9.3).
import { show } from "./teach.js";
import { BIN_DEFAULTS } from "./bins.js";
import { GEAR_DEFAULTS } from "./gearlib.js";
import { LIB, TEXTURE_DEFAULTS } from "./texture.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const given = (v) => v !== undefined && v !== null;
const quoteOr = (a) => a.length === 1 ? `"${a[0]}"` : a.slice(0, -1).map((v) => `"${v}"`).join(", ") + ` or "${a.at(-1)}"`;
function only(o, keys) { for (const k of Object.keys(o)) if (!keys.includes(k)) throw new Error(`unknown option ${show(k).length > 30 ? show(k).slice(0, 29) + "…" : show(k)}; options: ${keys.join(", ")}. Remove it.`); }
function num(o, k, lo, hi, unit = "mm") {
  const v = o[k];
  if (!given(v)) return;
  if (!isNum(v) || v < lo || v > hi) throw new Error(`${k} must be a number from ${lo} to ${hi}${unit ? ` (${unit})` : ""}, got ${show(v)}. Try ${lo}.`);
  return v;
}
function int(o, k, lo, hi) { const v = o[k]; if (given(v) && (!Number.isInteger(v) || v < lo || v > hi)) throw new Error(`${k} must be a whole number from ${lo} to ${hi}, got ${show(v)}. Try ${lo}.`); }
function pick(o, k, list) { const v = o[k]; if (given(v) && !list.includes(v)) throw new Error(`${k} must be ${quoteOr(list)}, got ${show(v)}. Try ${show(list[0])}.`); }
function flag(o, k) { const v = o[k]; if (given(v) && typeof v !== "boolean") throw new Error(`${k} must be true or false, got ${show(v)}. Try true.`); }
export function at3(v) {
  if (!given(v)) return [0, 0, 0];
  if (!Array.isArray(v) || v.length !== 3 || !Array.from(v).every(isNum)) throw new Error(`at must be [x, y, z] in mm, got ${show(v)}. Try [0, 0, 0].`);
  return v.slice();
}
export function generatorName(v) {
  const name = v == null ? "" : String(v).trim();
  if (name.length > 256) throw new Error(`name can have at most 256 characters, got ${show(v)}. Use a shorter name.`);
  return name || null;
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const boxKeys = "style w d h units across cols rows shape wall divider floor radius inner scoop scoopR label labelW stack foot lid clear lock sideLock caseT pull hinge doorPull doorCatch layout at name".split(" ");
export function boxOptions(opts = {}) {
  only(opts, boxKeys);
  pick(opts, "style", ["bin", "drawer", "tilt", "door"]);
  const style = opts.style ?? "bin";
  for (const k of ["w", "d"]) num(opts, k, style === "bin" ? 10 : 30, 1000);
  num(opts, "h", style === "bin" ? 5 : 20, 1000);
  for (const k of ["units", "across"]) int(opts, k, 1, 8);
  int(opts, "cols", 1, { bin: 20, drawer: 12, tilt: 8, door: 20 }[style]);
  int(opts, "rows", 1, style === "drawer" ? 12 : 20);
  pick(opts, "shape", ["square", "round", "hex"]);
  for (const k of ["wall", "divider", "floor"]) num(opts, k, 0.4, 20);
  for (const [k, lo, hi] of [["radius", 0, 100], ["inner", 0, 50], ["scoopR", 1, 100], ["labelW", 2, 100], ["foot", 1, 50], ["clear", 0, 2], ["caseT", 1.2, 20]]) num(opts, k, lo, hi);
  for (const k of ["scoop", "label", "stack", "lid"]) flag(opts, k);
  for (const k of ["lock", "sideLock"]) pick(opts, k, ["dovetail", "pegs", "none"]);
  pick(opts, "pull", ["bar", "knob", "notch"]); pick(opts, "hinge", ["left", "right"]);
  pick(opts, "doorPull", ["knob", "hole", "bar"]); pick(opts, "doorCatch", ["none", "light", "firm"]);
  pick(opts, "layout", ["assembled", "print"]);
  const o = { ...BIN_DEFAULTS };
  for (const k of boxKeys) if (!["at", "name", "layout"].includes(k) && given(opts[k])) o[k] = opts[k];
  if (given(opts.layout)) o.layout = opts.layout === "print" ? "print" : "";
  return { o, at: at3(opts.at), name: generatorName(opts.name) };
}
export function pairMatrix(type, m, z1, z2, angleDeg, at) {
  const s = z2 % 2 === 0 ? Math.PI / z2 : 0, sin = Math.sin(s), cos = Math.cos(s);
  if (type === "bevel") return [0, sin, cos, 0, 0, cos, -sin, 0, -1, 0, 0, 0, at[0] + m * z1 / 2, at[1], at[2] + m * z2 / 2, 1].map((x) => r6(x) || 0);
  const cd = m / Math.cos(angleDeg * Math.PI / 180) * (z1 + z2) / 2;
  return [cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1, 0, at[0] + cd, at[1], at[2], 1].map((x) => r6(x) || 0);
}
export function gearSetOptions(opts = {}) {
  only(opts, "type module teeth teeth2 sunTeeth planetTeeth planets width bore boreShape backlash pressureAngle rackLength rackHeight joints clear angle hand at".split(" "));
  pick(opts, "type", ["pair", "rack", "ring", "planet", "bevel", "helical"]);
  const type = opts.type ?? "pair", lib = !["bevel", "helical"].includes(type);
  const allowed = { pair: "teeth teeth2 backlash pressureAngle boreShape joints", rack: "teeth backlash pressureAngle boreShape joints rackLength rackHeight", ring: "teeth teeth2 backlash pressureAngle boreShape joints", planet: "sunTeeth planetTeeth planets backlash pressureAngle boreShape joints", bevel: "teeth teeth2 clear", helical: "teeth teeth2 clear angle hand" };
  for (const k of Object.keys(opts)) if (given(opts[k]) && !("type module width bore at " + allowed[type]).split(" ").includes(k)) throw new Error(`${k} is not used for type "${type}". Remove ${show(k)} or choose another type.`);
  const m = num(opts, "module", 0.3, 10) ?? 2, at = at3(opts.at), width = num(opts, "width", 0.5, 200);
  if (!lib) {
    const teeth = opts.teeth ?? 20, teeth2 = opts.teeth2 ?? teeth, max = type === "bevel" ? 90 : 30;
    for (const [k, v] of [["teeth", teeth], ["teeth2", teeth2]]) if (!Number.isInteger(v) || v < 12 || v > max) throw new Error(`${k} must be a whole number from 12 to ${max} for a ${type} gear, got ${show(v)}. Try 20.`);
    const { bore, clear, angle, hand } = opts, other = hand === "left" ? "right" : "left";
    const spec1 = { kind: type, module: m, teeth, mate: type === "bevel" ? teeth2 : undefined, width, bore, clear, angle, hand, at };
    const spec2 = { ...spec1, teeth: teeth2, mate: type === "bevel" ? teeth : undefined, hand: type === "helical" ? other : undefined, at: [0, 0, 0] };
    const a = angle ?? 20, n = (x) => typeof x === "number" ? +x.toFixed(3) : x, cd = m / Math.cos(a * Math.PI / 180) * (teeth + teeth2) / 2;
    const info = [type === "bevel" ? `Bevel pair ${teeth}:${teeth2}, module ${n(m)}: shafts at 90 degrees; the cone tips meet ${n(m * teeth2 / 2)} mm above at.` : `Helical pair ${teeth}:${teeth2}, module ${n(m)}, ${n(a)} degrees: centres ${n(cd)} mm apart, ${hand ?? "right"} and ${other} hand.`];
    return { type, lib, spec1, spec2, m2: pairMatrix(type, m, teeth, teeth2, a, at), info, at };
  }
  for (const [k, lo, hi] of [["teeth", 6, 300], ["teeth2", 6, 400], ["sunTeeth", 8, 200], ["planetTeeth", 8, 200], ["planets", 2, 6]]) int(opts, k, lo, hi);
  num(opts, "backlash", 0, 1); num(opts, "rackLength", 0, 2000); num(opts, "rackHeight", 2, 100);
  const pressureAngle = opts.pressureAngle;
  if (given(pressureAngle) && ![14.5, 20, 25].includes(pressureAngle)) throw new Error(`pressureAngle must be 14.5, 20 or 25 (degrees), got ${show(pressureAngle)}. Try 20.`);
  pick(opts, "boreShape", ["round", "d", "hex", "key"]); flag(opts, "joints");
  const z = opts.teeth ?? 20, z2 = opts.teeth2 ?? 40, zs = opts.sunTeeth ?? 18, bore = opts.bore ?? 0;
  if (type === "ring" && z2 - z < 8) throw new Error(`a ring gear needs at least 8 more teeth than its pinion (teeth2 at least teeth + 8), got teeth ${show(z)} and teeth2 ${show(z2)}. Increase teeth2.`);
  const zp = opts.planetTeeth ?? 12, planets = opts.planets ?? 3;
  if (type === "planet") {
    const sum = 2 * (zs + zp);
    if (sum % planets) throw new Error(`these teeth cannot be assembled with ${planets} planets: sun + ring teeth (${sum}) must divide by the number of planets, got sunTeeth ${show(zs)} and planetTeeth ${show(zp)}. Try sunTeeth 18, planetTeeth 12 and planets 3.`);
    if (m * (zs + zp) * Math.sin(Math.PI / planets) <= m * (zp + 2) + 0.5) throw new Error(`neighbouring planets need more than 0.5 mm clearance between their teeth, got sunTeeth ${show(zs)}, planetTeeth ${show(zp)} and planets ${show(planets)}. Try fewer planets or more sunTeeth.`);
  }
  const zMin = type === "pair" ? Math.min(z, z2) : type === "planet" ? zs : z;
  const limits = [m * (zMin - 4.5), m * (zMin / 2 - 1.25) * 1.6];
  if (type === "planet") limits.push((zp - 2.5) * m * 0.5, m * (zp / 2 - 1.25) * 1.6);
  const max = Math.floor(Math.min(...limits) * 10 + 1e-9) / 10;
  if (!isNum(bore) || (bore !== 0 && (bore < 0.5 || bore > max))) throw new Error(max < 0.5 ? `bore must be 0 (none): these gears are too small for a bore, got ${show(bore)}. Set bore to 0.` : `bore must be 0 (none) or from 0.5 to ${max} mm for these gears, got ${show(bore)}. Try 0.`);
  const o = { ...GEAR_DEFAULTS, type, m, z, z2, zs, zp: opts.planetTeeth ?? 12, nPlanets: opts.planets ?? 3, thick: width ?? 8, backlash: opts.backlash ?? 0.15, pa: opts.pressureAngle ?? 20, bore: bore > 0 ? opts.boreShape ?? "round" : "none", boreD: bore > 0 ? bore : GEAR_DEFAULTS.boreD, rackLen: opts.rackLength ?? 0, rackH: opts.rackHeight ?? 8, joints: opts.joints ?? true, hub: false, spokes: false };
  return { type, lib, o, at };
}
export function textureOptions(opts = {}) {
  only(opts, "texture faces size depth dir rotation mapping edgeBlend invert once".split(" "));
  const tex = opts.texture ?? TEXTURE_DEFAULTS.tex, item = LIB.find((t) => t.key === tex);
  if (!item) throw new Error(`unknown texture ${show(tex)}; there are ${LIB.length} texture keys. Call JS3D.textures() (list_textures over MCP) and use one of its keys.`);
  num(opts, "size", 0.5, 100); num(opts, "depth", 0.05, 3); num(opts, "rotation", -180, 180, "degrees"); num(opts, "edgeBlend", 0, 10);
  pick(opts, "dir", ["raise", "engrave", "both"]); pick(opts, "mapping", ["auto", "planar", "cylindrical", "triplanar"]);
  flag(opts, "invert"); flag(opts, "once");
  const faces = opts.faces ?? "all", valid = (v) => typeof v === "string" ? v.trim().length > 0 : Number.isInteger(v) && v >= 0;
  if (!(Array.isArray(faces) ? faces.length > 0 && Array.from(faces).every(valid) : valid(faces))) throw new Error(`faces must be "all", a face selector such as "top", a face index or a list of indices, got ${show(faces)}. Try "top".`);
  return { layer: { tex, size: opts.size ?? (item.size || TEXTURE_DEFAULTS.size), depth: opts.depth ?? 0.6, dir: opts.dir ?? "raise", rot: opts.rotation ?? 0, mapping: opts.mapping ?? "auto", falloff: opts.edgeBlend ?? 0, invert: opts.invert ?? false, once: opts.once ?? false }, faces };
}
export function drawingOptions(opts = {}) {
  only(opts, ["ids", "views", "scale", "units", "dims"]);
  const names = ["top", "front", "right"], views = opts.views ?? names;
  if (!Array.isArray(views) || !views.length || new Set(views).size !== views.length || Array.from(views).some((v) => !names.includes(v))) throw new Error(`views must be a list of "top", "front" and "right", got ${show(views)}. Try ["top"].`);
  num(opts, "scale", 0.01, 100, "1 is full size"); pick(opts, "units", ["mm", "in"]); flag(opts, "dims");
  return { ids: opts.ids, views: names.filter((v) => views.includes(v)), scale: opts.scale ?? 1, units: opts.units ?? "mm", dims: opts.dims ?? false };
}
