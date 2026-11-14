// jumpstart-3d: advanced CAD calls (IMPROVEMENT_PLAN 9.1). AGPL-3.0-only.
import { show } from "./teach.js";

const types = { face: ["plane", "cylinder", "cone", "sphere", "torus", "other", "hole"], edge: ["line", "circle", "ellipse", "other"] };
const aliases = { top: [">", "z"], bottom: ["<", "z"], front: ["<", "y"], back: [">", "y"], left: ["<", "x"], right: [">", "x"] };

export function parseSelector(text, kind) {
  text = String(text);
  if (text.length > 500) throw Error(`a selector can be at most 500 characters; this one has ${text.length}, got ${show(text)}. Shorten the selector.`);
  const tokens = [...text.matchAll(/[a-zA-Z]+|-?\d+|[^\s]/g)].map(m => ({ value: m[0].toLowerCase(), raw: m[0], pos: m.index }));
  let i = 0;
  const peek = () => tokens[i]?.value;
  const take = () => tokens[i++]?.value;
  const unexpected = () => { const t = tokens[i]; throw Error(`unexpected ${show(t?.raw ?? "")} at character ${t?.pos ?? text.length} in ${show(text)}. Example selector: "top".`); };
  const index = () => {
    if (peek() !== "[") return undefined;
    take(); const n = take();
    if (!/^-?\d+$/.test(n ?? "") || take() !== "]") unexpected();
    return Number(n);
  };
  const noIndex = () => { throw Error(`an index [n] only follows >X, <X ... or top, bottom, front, back, left, right, got ${show(text)}. Example: "top[0]".`); };
  function item(k) {
    const node = primary(k);
    if (peek() === "[") noIndex();
    return node;
  }
  function primary(k) {
    if (peek() === "not") { take(); return { op: "not", item: item(k) }; }
    if (peek() === "(") {
      take(); const node = selector(k);
      if (peek() !== ")") throw Error(`missing ")" in ${show(text)}. Add a closing parenthesis.`);
      take(); return node;
    }
    const word = take();
    if (word === "edges" && peek() === "of") {
      take(); if (k !== "edge") throw Error(`"edges of" is for edges; this call takes faces, got ${show(text)}. Use a face selector such as "top".`);
      return { op: "edgesOf", item: item("face") };
    }
    if (word === "face" || word === "edge") {
      if (word !== k) { i--; unexpected(); }
      const n = take(); if (!/^-?\d+$/.test(n ?? "")) { i--; unexpected(); }
      return { op: "index", index: Number(n) };
    }
    if ([">", "<", "|", "#", "+", "-"].includes(word)) {
      const axis = take(); if (!["x", "y", "z"].includes(axis)) { i--; unexpected(); }
      if ((word === "+" || word === "-") && k === "edge") throw Error(`+Z and -Z are for faces; for edges use |Z or >Z, got ${show(text)}. Example: "|Z".`);
      return { op: word, axis, level: word === ">" || word === "<" ? index() : undefined };
    }
    if (Object.hasOwn(aliases, word)) { const [op, axis] = aliases[word]; return { op, axis, level: index() }; }
    if (word === "all" || types[k].includes(word)) return { op: "type", type: word };
    const other = k === "face" ? "edge" : "face";
    if (types[other].includes(word)) throw Error(`${show(word)} is ${other === "edge" ? "an" : "a"} ${other} type; ${k} types are ${types[k].join(", ")}. Choose a ${k} type.`);
    if (word === "[") noIndex();
    if (word && /^[a-z]+$/.test(word)) throw Error(`unknown word ${show(word)}; use a ${k} selector. Example: "${k === "face" ? "top" : "edges of top"}".`);
    i--; unexpected();
  }
  function selector(k) {
    const chains = [];
    do {
      if (peek() === "or") take();
      const chain = [item(k)];
      while (peek() === "and") { take(); chain.push(item(k)); }
      chains.push(chain);
    } while (peek() === "or");
    return { op: "selector", chains };
  }
  if (!tokens.length) throw Error(`empty selector, got ${show(text)}. Example: "top".`);
  const ast = selector(kind);
  if (i < tokens.length) unexpected();
  return ast;
}

export function selectItems(ast, topo, kind) {
  const universe = k => topo[k === "face" ? "faces" : "edges"];
  function run(node, current, k) {
    if (node.op === "selector") {
      const out = new Set();
      for (const chain of node.chains) {
        let selected = current;
        for (const part of chain) selected = run(part, selected, k);
        for (const x of selected) out.add(x);
      }
      return current.filter(x => out.has(x));
    }
    if (node.op === "not") { const excluded = new Set(run(node.item, current, k)); return current.filter(x => !excluded.has(x)); }
    if (node.op === "edgesOf") {
      const faces = run(node.item, universe("face"), "face");
      const ids = new Set(faces.flatMap(f => f.edges));
      return current.filter(x => ids.has(x.index));
    }
    if (node.op === "index") {
      if (!universe(k).some(x => x.index === node.index)) {
        const all = universe(k), max = k === "edge" ? (topo.edgeMax ?? Math.max(-1, ...all.map(x => x.index))) : Math.max(-1, ...all.map(x => x.index));
        throw Error(`${topo.name} has no ${k} ${node.index} (it has 0 to ${max}${k === "edge" ? "; seams and smooth joins are not edges" : ""}). Call JS3D.${k === "edge" ? "edges" : "faces"}(id) to see the available indices.`);
      }
      return current.filter(x => x.index === node.index);
    }
    if (node.op === "type") return current.filter(x => node.type === "all" || (node.type === "hole" ? x.type === "cylinder" && x.hole : x.type === node.type));
    const axis = { x: 0, y: 1, z: 2 }[node.axis];
    if (node.op === ">" || node.op === "<") {
      const sorted = [...current].sort((a, b) => (a.center[axis] - b.center[axis]) * (node.op === ">" ? -1 : 1));
      if (!sorted.length) return [];
      if (node.level === undefined) return sorted.filter(x => Math.abs(x.center[axis] - sorted[0].center[axis]) <= 0.01);
      const levels = []; let last;
      for (const x of sorted) { const v = x.center[axis]; if (last === undefined || Math.abs(v - last) > 0.01) levels.push([]); levels.at(-1).push(x); last = v; }
      return levels.at(node.level) ?? [];
    }
    const cosine = Math.cos(Math.PI / 180), sine = Math.sin(Math.PI / 180);
    return current.filter(x => {
      const v = k === "face" ? (x.type === "plane" && x.normal) : (x.type === "line" && x.direction);
      if (!v) return false;
      const d = v[axis];
      return node.op === "|" ? Math.abs(d) >= cosine : node.op === "#" ? Math.abs(d) <= sine : node.op === "+" ? d >= cosine : d <= -cosine;
    });
  }
  return run(ast, universe(kind), kind).map(x => x.index).sort((a, b) => a - b);
}
