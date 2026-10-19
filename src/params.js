// jumpstart-3d: named parameters. doc.params is [{ id, name, expr, unit?, value }] (value: cached
// result in mm, NaN when the expression fails). A sketch dimension can hold `expr` text that
// uses parameter names; applyParams() re-evaluates everything and re-solves the sketches whose
// dimensions changed. Called from store.js after every update and on load.
import { parseLength, uid } from "./util.js";
import { solveSketch, normalizeSketch } from "./constraints.js";

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

// a dimension whose expression now gives a different good value takes it and its sketch is solved again.
// Returns how many bound dimensions were skipped because the value is not usable (they keep their last value).
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
  return skipped;
}

export function paramNameOk(name, params, selfId) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Use letters, digits and _, starting with a letter.";
  if (UNIT_WORDS.includes(name.toLowerCase())) return `"${name}" is a unit.`;
  if (params.some((p) => p.id !== selfId && p.name.toLowerCase() === name.toLowerCase())) return `"${name}" is already a parameter.`;
  return null;
}

// rename, and follow the old name in later parameters and in every dimension
export function renameParam(doc, id, newName) {
  const i = doc.params.findIndex((p) => p.id === id);
  const re = wordRe(doc.params[i].name);
  doc.params[i].name = newName;
  const swap = (s) => s.replace(re, () => newName);
  for (const p of doc.params.slice(i + 1)) p.expr = swap(p.expr);
  for (const sk of doc.sketches) for (const c of sk.cons || []) if (c.t === "dim" && c.expr) c.expr = swap(c.expr);
}

// delete a parameter; dimensions that used its name keep their value but lose the expression
// (later parameters are left alone and show an error). Returns how many dimensions were unbound.
export function removeParam(doc, id) {
  const name = doc.params.find((p) => p.id === id).name;
  doc.params = doc.params.filter((p) => p.id !== id);
  let n = 0;
  for (const sk of doc.sketches) for (const c of sk.cons || []) {
    if (c.t === "dim" && c.expr && wordRe(name, "i").test(c.expr)) { delete c.expr; delete c.unit; n++; }
  }
  return n;
}

export function newParam(doc) {
  let n = doc.params.length + 1;
  while (doc.params.some((p) => p.name.toLowerCase() === "p" + n)) n++;
  doc.params.push({ id: uid("q"), name: "p" + n, expr: "10", value: NaN });
}
