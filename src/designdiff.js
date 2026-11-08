// Pure document comparison. Stable keys avoid reporting object insertion order as an edit.
const stable = (v) => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const same = (a, b) => stable(a) === stable(b);
const omit = (v, keys) => Object.fromEntries(Object.entries(v || {}).filter(([k]) => !keys.includes(k)));
const show = (v) => v === undefined ? "(none)" : JSON.stringify(v);
const name = (v) => `${v.name || v.id} (${v.id})`;
const index = (items, key) => new Map((items || []).map((v, i) => [key(v, i), v]));

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
        (x, y) => { if (!same(x, y)) lines.push(`${who} feature changed: ${x.t === y.t ? y.t : x.t + " -> " + y.t} (${y.id ?? "no id"}): ${show(x)} -> ${show(y)}.`); });
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
  const rest = ["bodies", "sketches", "params", "seq"];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!rest.includes(key) && !same(before[key], after[key])) lines.push(`Design ${key} changed: ${show(before[key])} -> ${show(after[key])}.`);
  }
  return lines.join("\n") || "No changes.";
}
