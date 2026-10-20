// jumpstart-3d: named parameters. doc.params is [{ id, name, expr, unit?, value }] (value: cached
// result in mm, NaN when the expression fails). A sketch dimension can hold `expr` text that
// uses parameter names; applyParams() re-evaluates everything and re-solves the sketches whose
// dimensions or feature values changed. Called from store.js after every update and on load.
import { parseLength, uid } from "./util.js";
import { solveSketch, normalizeSketch } from "./constraints.js";
import { getUnit } from "./units.js";

export const PARAM_ERROR = "Unknown name or not a valid expression";
const UNIT_WORDS = ["mm", "cm", "m", "in", "ft", "deg"];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (name, flags = "gi") => new RegExp("\\b" + escapeRe(name) + "\\b", flags);

// text -> mm (degrees with { angle: true }), or NaN. Names are replaced by their value, written so
// parseLength reads it as millimetres. With a name in the text a bare number is plain (mm); without
// one it is read in `unit` (the unit it was typed in, saved as `unit` next to the text; none means mm).
export function evalExpr(text, params, { unit = "mm", angle = false } = {}) {
  let s = String(text), named = false;
  if (params.length) {
    let bad = false;
    const byName = new Map(params.map((p) => [p.name.toLowerCase(), p.value]));
    const all = new RegExp("\\b(" + params.map((p) => escapeRe(p.name)).join("|") + ")\\b", "gi");
    s = s.replace(all, (name) => {
      const v = byName.get(name.toLowerCase());
      named = true;
      if (!isFinite(v)) bad = true;
      return `(${v}${angle ? "" : "mm"})`;
    });
    if (bad) return NaN;
  }
  return parseLength(s, angle || named ? "mm" : unit);
}

// Feature values bound to an expression live next to the value: owner.exprs = { dist: "w/2" } (+ owner.exprUnits
// when typed in inches). Owners are extrude/revolve nodes (dist, dist2, angle) and fillet, chamfer, hole and shell
// mods (r, d, dia, depth, th), including bool-mod tools and group children, and Beginner shapes (prim nodes: w, d, h,
// stored in node.p). fn(owner, key) per bound value.
export function forEachFeatureExpr(doc, fn) {
  const visit = (n) => {
    for (const k of Object.keys(n.exprs || {})) fn(n, k);
    if (n.src) visit(n.src); // Mirror with Join and Split by another body keep a copy of the body's node
    for (const m of n.mods || []) { visit(m); if (m.t === "bool" && m.tool) visit(m.tool); }
    for (const c of n.children || []) visit(c.node);
  };
  for (const b of doc.bodies) visit(b.node);
}
// the dialogs' own limits
const FEATURE_MIN = { dist2: 0, angle: 0.1, r: 0.001, d: 0.001, dia: 0.01, depth: 0.01, th: 0.01 };
const featureOk = (o, k, v) => isFinite(v) && (k === "dist" ? Math.abs(v) > 1e-6 : v >= (o.t === "prim" ? 0.01 : FEATURE_MIN[k]) && (k !== "angle" || v <= 360));

// A feature value typed as an expression keeps its text in o.exprs[key] (and the unit it was typed in in o.exprUnits)
export function setExpr(o, key, text, angle) {
  const put = (map, val) => { if (val) (o[map] = o[map] || {})[key] = val; else if (o[map]) { delete o[map][key]; if (!Object.keys(o[map]).length) delete o[map]; } };
  put("exprs", text);
  put("exprUnits", text && !angle && getUnit() !== "mm" ? getUnit() : null);
}
export const exprOf = (o, key) => (o.exprs && o.exprs[key]) || null;
// the exprs/exprUnits of o for keys, stored under the names in `as`
export const exprsOf = (o, keys, as = keys) => {
  const r = {};
  for (const m of ["exprs", "exprUnits"]) keys.forEach((k, i) => { if (o[m] && o[m][k]) (r[m] = r[m] || {})[as[i]] = o[m][k]; });
  return r;
};

// a dimension or feature value whose expression now gives a different good value takes it and its sketch is solved again.
// Returns how many bound values were skipped because the value is not usable (they keep their last value).
export function applyParams(doc) {
  // each parameter sees only the ones above it
  doc.params.forEach((p, i) => { p.value = evalExpr(p.expr, doc.params.slice(0, i), { unit: p.unit }); });
  let skipped = 0;
  for (const sk of doc.sketches || []) {
    let changed = false;
    for (const c of sk.cons || []) {
      if (c.t !== "dim" || !c.expr) continue;
      const ang = c.k === "ang";
      const v = evalExpr(c.expr, doc.params, { unit: c.unit, angle: ang });
      if (!isFinite(v) || !(v > 0) || (ang && v >= 180)) { skipped++; continue; }
      if (Math.abs(v - c.v) <= 1e-9) continue;
      c.v = v;
      changed = true;
    }
    if (changed) { solveSketch(sk); normalizeSketch(sk); }
  }
  forEachFeatureExpr(doc, (o, k) => {
    const v = evalExpr(o.exprs[k], doc.params, { unit: o.exprUnits && o.exprUnits[k], angle: k === "angle" });
    if (!featureOk(o, k, v)) { skipped++; return; }
    const at = o.t === "prim" ? o.p : o; // a Beginner shape keeps its sizes in p
    if (Math.abs(v - at[k]) <= 1e-9) return;
    at[k] = v;
    if (o.kind === "torus" && k === "w") at.d = v;
    if (o.sets && o.sets.length && (k === "r" || k === "d")) o.sets[0].r = v; // the kernel reads sets when there are any
  });
  return skipped;
}

export function paramNameOk(name, params, selfId) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Use letters, digits and _, starting with a letter.";
  if (UNIT_WORDS.includes(name.toLowerCase())) return `"${name}" is a unit.`;
  if (params.some((p) => p.id !== selfId && p.name.toLowerCase() === name.toLowerCase())) return `"${name}" is already a parameter.`;
  return null;
}

// rename, and follow the old name in later parameters and in every dimension and feature value
export function renameParam(doc, id, newName) {
  const i = doc.params.findIndex((p) => p.id === id);
  const re = wordRe(doc.params[i].name);
  doc.params[i].name = newName;
  const swap = (s) => s.replace(re, () => newName);
  for (const p of doc.params.slice(i + 1)) p.expr = swap(p.expr);
  for (const sk of doc.sketches) for (const c of sk.cons || []) if (c.t === "dim" && c.expr) c.expr = swap(c.expr);
  forEachFeatureExpr(doc, (o, k) => { o.exprs[k] = swap(o.exprs[k]); });
}

// delete a parameter; dimensions and feature values that used its name keep their value but lose the expression
// (later parameters are left alone and show an error). Returns how many were unbound.
export function removeParam(doc, id) {
  const name = doc.params.find((p) => p.id === id).name;
  doc.params = doc.params.filter((p) => p.id !== id);
  let n = 0;
  for (const sk of doc.sketches) for (const c of sk.cons || []) {
    if (c.t === "dim" && c.expr && wordRe(name, "i").test(c.expr)) { delete c.expr; delete c.unit; n++; }
  }
  forEachFeatureExpr(doc, (o, k) => {
    if (!wordRe(name, "i").test(o.exprs[k])) return;
    delete o.exprs[k];
    if (o.exprUnits) { delete o.exprUnits[k]; if (!Object.keys(o.exprUnits).length) delete o.exprUnits; }
    if (!Object.keys(o.exprs).length) delete o.exprs;
    n++;
  });
  return n;
}

export function newParam(doc) {
  let n = doc.params.length + 1;
  while (doc.params.some((p) => p.name.toLowerCase() === "p" + n)) n++;
  doc.params.push({ id: uid("q"), name: "p" + n, expr: "10", value: NaN });
}
