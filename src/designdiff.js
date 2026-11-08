// Pure document comparison. Stable keys avoid reporting object insertion order as an edit.
const stable = (v) => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const same = (a, b) => stable(a) === stable(b);
const omit = (v, keys) => Object.fromEntries(Object.entries(v || {}).filter(([k]) => !keys.includes(k)));
const CAP = 200, MAX_LINES = 200, MAX_BYTES = 20 * 1024;
const clip = (t) => t.length > CAP ? t.slice(0, CAP) + "..." : t;
const show = (v) => v === undefined ? "(none)" : clip(JSON.stringify(v) ?? "(none)");
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const kb = (a) => Math.max(1, Math.round((typeof a?.data === "string" ? a.data.length : 0) / 1024));
const record = (a, id) => `${id} (${a?.kind ?? "?"}, ${clip(String(a?.name ?? id))}, ${kb(a)} KB)`;
// per-id comparison of a map of large records (assets, media): by id, kind, name and data length, never by stringifying the data
function mapDiff(label, a, b, lines) {
  const old = a || {}, now = b || {};
  for (const id of Object.keys(old)) if (!own(now, id)) lines.push(`${label} removed: ${record(old[id], id)}.`);
  for (const id of Object.keys(now)) {
    if (!own(old, id)) { lines.push(`${label} added: ${record(now[id], id)}.`); continue; }
    const x = old[id], y = now[id];
    if (x === y) continue;
    const xd = x?.data, yd = y?.data;
    if (x?.kind !== y?.kind || x?.name !== y?.name || (xd?.length ?? 0) !== (yd?.length ?? 0) || (typeof xd === "string" && typeof yd === "string" && xd !== yd)) lines.push(`${label} changed: ${record(y, id)}.`);
  }
}
// feature changes: only the fields that differ, with short values
const fieldDiff = (x, y) => {
  const out = [];
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[k], y[k])) out.push(`${k}: ${show(x[k])} -> ${show(y[k])}`);
  return out.join(", ");
};
const name = (v) => `${clip(String(v.name || v.id))} (${v.id})`;
const index = (items, key) => new Map((items || []).map((v, i) => [key(v, i), v]));

function cap(lines) {
  if (!lines.length) return "No changes.";
  const out = [];
  let bytes = 0;
  for (const l of lines) {
    if (out.length >= MAX_LINES || bytes + l.length + 1 > MAX_BYTES) break;
    out.push(l); bytes += l.length + 1;
  }
  if (out.length < lines.length) out.push(`...and ${lines.length - out.length} more changes`);
  return out.join("\n");
}

export function designDiff(before, after) {
  const lines = [];
  const compare = (a, b, key, added, removed, changed) => {
    const old = index(a, key), now = index(b, key);
    for (const [id, v] of old) if (!now.has(id)) removed(v);
    for (const [id, v] of now) {
      if (!old.has(id)) added(v);
      else changed(old.get(id), v);
    }
  };
  compare(before.bodies, after.bodies, (b) => b.id,
    (b) => lines.push(`Body added: ${name(b)}.`),
    (b) => lines.push(`Body removed: ${name(b)}.`),
    (a, b) => {
      const who = `Body ${name(b)}`;
      if (a.name !== b.name) lines.push(`${who} renamed: ${show(a.name)} -> ${show(b.name)}.`);
      for (const key of ["color", "hole", "hidden"]) {
        const av = key === "color" ? a[key] : !!a[key], bv = key === "color" ? b[key] : !!b[key];
        if (av !== bv) lines.push(`${who} ${key}: ${show(av)} -> ${show(bv)}.`);
      }
      const delta = [12, 13, 14].map((i) => (b.m?.[i] || 0) - (a.m?.[i] || 0));
      if (delta.some((v) => v !== 0)) lines.push(`${who} moved: translation delta [${delta.join(", ")}] mm.`);
      if (!same(a.m?.slice(0, 12), b.m?.slice(0, 12))) lines.push(`${who} rotation/scale changed.`);
      compare(a.node?.mods, b.node?.mods, (f, i) => f.id ?? `index:${i}`,
        (f) => lines.push(`${who} feature added: ${f.t} (${f.id ?? "no id"}).`),
        (f) => lines.push(`${who} feature removed: ${f.t} (${f.id ?? "no id"}).`),
        (x, y) => { if (!same(x, y)) lines.push(`${who} feature changed: ${x.t === y.t ? y.t : x.t + " -> " + y.t} (${y.id ?? "no id"}): ${fieldDiff(x, y)}.`); });
      const featureOrder = (n) => (n?.mods || []).map((f, i) => f.id ?? `index:${i}`);
      const ao = featureOrder(a.node), bo = featureOrder(b.node);
      if (ao.length === bo.length && same([...ao].sort(), [...bo].sort()) && !same(ao, bo)) lines.push(`${who} feature order changed.`);
      if (!same(omit(a.node, ["mods"]), omit(b.node, ["mods"]))) lines.push(`${who} shape definition changed.`);
      if (!same(omit(a, ["name", "color", "hole", "hidden", "m", "node", "_key"]), omit(b, ["name", "color", "hole", "hidden", "m", "node", "_key"]))) lines.push(`${who} other properties changed.`);
    });
  compare(before.sketches, after.sketches, (s) => s.id,
    (s) => lines.push(`Sketch added: ${name(s)}.`), (s) => lines.push(`Sketch removed: ${name(s)}.`),
    (a, b) => { if (!same(a, b)) lines.push(`Sketch changed: ${name(b)}.`); });
  compare(before.params, after.params, (p) => p.name,
    (p) => lines.push(`Parameter ${p.name}: (none) -> ${show(p.expr)}.`),
    (p) => lines.push(`Parameter ${p.name}: ${show(p.expr)} -> (none).`),
    (a, b) => {
      if (a.expr !== b.expr) lines.push(`Parameter ${b.name}: ${show(a.expr)} -> ${show(b.expr)}.`);
      if ((a.unit || "mm") !== (b.unit || "mm")) lines.push(`Parameter ${b.name} unit: ${a.unit || "mm"} -> ${b.unit || "mm"}.`);
    });
  mapDiff("Asset", before.assets, after.assets, lines);
  mapDiff("Media", before.media, after.media, lines);
  const rest = ["bodies", "sketches", "params", "seq", "assets", "media"], big = ["cosforge", "arch", "planes", "joints"];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (rest.includes(key)) continue;
    const a = before[key], b = after[key];
    if (big.includes(key)) { if (a !== b && !same(a, b)) lines.push(`Design ${key} changed.`); }
    else if (!same(a, b)) lines.push(`Design ${key} changed: ${show(a)} -> ${show(b)}.`);
  }
  return cap(lines);
}
