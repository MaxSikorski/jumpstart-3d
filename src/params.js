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

// Every sketch dimension has a name d1, d2…, stable: the next number is one above the highest d<n> in use anywhere
// (a dimension's name, a parameter's name, or a name an expression mentions), so a deleted dimension's name is
// never handed out again to something an expression would then follow.
// exprScope is what an expression can use: the parameters plus the dimensions' current values. `except` is the
// dimension being evaluated, which cannot use itself.
function nextDimName(doc) {
  let n = 0;
  const see = (s) => { for (const m of String(s || "").matchAll(/\bd(\d+)\b/gi)) n = Math.max(n, +m[1]); };
  for (const p of doc.params || []) { see(p.name); see(p.expr); }
  for (const sk of doc.sketches || []) for (const c of sk.cons || []) if (c.t === "dim") { see(c.name); see(c.expr); }
  forEachFeatureExpr(doc, (o, k) => see(o.exprs[k]));
  return "d" + (n + 1);
}
// older files and copied sketches: a dimension without a name, or with one already taken (by another dimension, or by a
// parameter, which would otherwise be shadowed), gets the next free one
function nameDims(doc) {
  const seen = new Set((doc.params || []).map((p) => p.name.toLowerCase()));
  for (const sk of doc.sketches || []) for (const c of sk.cons || []) {
    if (c.t !== "dim") continue;
    if (!c.name || seen.has(c.name.toLowerCase())) c.name = nextDimName(doc);
    seen.add(c.name.toLowerCase());
  }
}
export function exprScope(doc, except) {
  const dims = [];
  for (const sk of doc.sketches || []) for (const c of sk.cons || []) if (c.t === "dim" && c.name && c.id !== (except && except.id)) dims.push({ name: c.name, value: c.v });
  return dims.length ? [...(doc.params || []), ...dims] : doc.params || [];
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
const FEATURE_MIN = { dist2: 0, angle: 0.1, r: 0.001, d: 0.001, dia: 0.01, depth: 0.01, th: 0.01, n1: 1, n2: 1, cn: 2, s1: -Infinity, s2: -Infinity }; // jumpstart-3d: pattern (counts and spacings; a negative spacing is a direction)
const FEATURE_MAX = { n1: 200, n2: 200, cn: 360 }; // jumpstart-3d: pattern (the Pattern dialog's own count limits)
const featureOk = (o, k, v) => isFinite(v) && (k === "dist" ? Math.abs(v) > 1e-6 : v >= (o.t === "prim" ? 0.01 : FEATURE_MIN[k]) && v <= (FEATURE_MAX[k] ?? Infinity) && (k !== "angle" || v <= 360));

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
  nameDims(doc);
  // a dimension may use another dimension's value (d2 = d1*2): go over them until nothing moves (a chain with no loop
  // settles within one pass per dimension), then solve the sketches that moved. Feature values below see the final dimension values.
  const bound = [], moved = new Set();
  for (const sk of doc.sketches || []) for (const c of sk.cons || []) if (c.t === "dim" && c.expr) bound.push([sk, c]);
  const before = bound.map(([, c]) => c.v);
  let again = true;
  for (let pass = 0; again && pass <= bound.length; pass++) {
    again = false;
    skipped = 0;
    for (const [sk, c] of bound) {
      const ang = c.k === "ang";
      const v = evalExpr(c.expr, exprScope(doc, c), { unit: c.unit, angle: ang });
      if (!isFinite(v) || !(v > 0) || (ang && v >= 180)) { skipped++; continue; }
      if (Math.abs(v - c.v) <= 1e-9) continue;
      c.v = v;
      moved.add(sk);
      again = true;
    }
  }
  if (again) { // still moving after as many passes as dimensions: a loop (d1 = d2*2, d2 = d1*2). Put every value back and report them.
    bound.forEach(([, c], i) => { c.v = before[i]; });
    moved.clear();
    skipped += bound.length;
  }
  for (const sk of moved) { solveSketch(sk); normalizeSketch(sk); }
  forEachFeatureExpr(doc, (o, k) => {
    const v = evalExpr(o.exprs[k], exprScope(doc), { unit: o.exprUnits && o.exprUnits[k], angle: k === "angle" });
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
  if (/^d\d+$/i.test(name)) return `"${name}" is a dimension name.`;
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

// Parameters as a spreadsheet file: name,expression,unit (unit empty or "in"). A field is quoted only when it holds a comma or a quote.
const csvField = (s) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
export const paramsToCsv = (params) => "name,expression,unit\n" + params.map((p) => [p.name, p.expr, p.unit || ""].map(csvField).join(",") + "\n").join("");
// text -> rows of [name, expression, unit], trimmed. The header row is optional; ; works as well as , (spreadsheets in some countries save it)
export function parseParamsCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const sep = (text.match(/;/g) || []).length >= (text.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], f = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch !== '"') f += ch; else if (text[i + 1] === '"') { f += '"'; i++; } else quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  rows.push([...row, f]);
  const out = rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  if (out.length && out[0][0].toLowerCase() === "name") out.shift();
  return out.map(([name = "", expr = "", unit = ""]) => [name, expr, unit.toLowerCase() === "in" ? "in" : ""]);
}
// rows from parseParamsCsv into doc: a name that exists (any case) takes the new expression and unit, a new valid name is added at the end.
// Returns how many rows were used and how many were skipped (no expression, or a name that is not allowed).
export function importParams(doc, rows) {
  let used = 0, skipped = 0;
  for (const [name, expr, unit] of rows) {
    let p = doc.params.find((q) => q.name.toLowerCase() === name.toLowerCase());
    if (!expr || (!p && paramNameOk(name, doc.params))) { skipped++; continue; }
    if (!p) { newParam(doc); p = doc.params[doc.params.length - 1]; p.name = name; }
    p.expr = expr;
    if (unit) p.unit = unit; else delete p.unit;
    used++;
  }
  return { used, skipped };
}
