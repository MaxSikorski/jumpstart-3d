// Checks on exported files for the fuzzer (test/fuzz.spec.mjs). Plain Node, no browser.
import { inflateRawSync } from "node:zlib";

// A small seeded random generator (mulberry32): the same seed always gives the same numbers.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // both ends included
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

// Binary STL: 80-byte header, uint32 triangle count, then 50 bytes a triangle.
export function readStl(bytes) {
  if (bytes.length < 84) throw new Error(`STL is ${bytes.length} bytes, shorter than its header`);
  const n = bytes.readUInt32LE(80);
  if (bytes.length !== 84 + 50 * n) throw new Error(`STL says ${n} triangles but is ${bytes.length} bytes (want ${84 + 50 * n})`);
  const tris = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i, t = [];
    for (let v = 0; v < 3; v++) t.push([0, 1, 2].map((k) => bytes.readFloatLE(o + 12 + 12 * v + 4 * k)));
    tris.push(t);
  }
  return tris;
}

// Closed and consistently turned: every directed edge a->b has a matching b->a somewhere (several shells that
// touch are fine). Vertices closer than `tol` count as one, so a shared corner written twice with a rounding
// difference does not look like a hole. Returns { open, triangles, volume } where `open` counts unmatched edges
// and `volume` is the signed volume (positive when the faces point outward).
export function meshReport(tris, tol = 1e-4) {
  const cell = 1e-3, grid = new Map(), reps = [];
  const weld = (p) => {
    const c = p.map((v) => Math.floor(v / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const id of grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) || []) {
        const q = reps[id];
        if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol && Math.abs(q[2] - p[2]) <= tol) return id;
      }
    }
    reps.push(p);
    const key = c.join(",");
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(reps.length - 1);
    return reps.length - 1;
  };
  const edges = new Map();
  let volume = 0;
  for (const t of tris) {
    const [a, b, c] = t.map(weld);
    volume += (t[0][0] * (t[1][1] * t[2][2] - t[1][2] * t[2][1]) - t[0][1] * (t[1][0] * t[2][2] - t[1][2] * t[2][0]) + t[0][2] * (t[1][0] * t[2][1] - t[1][1] * t[2][0])) / 6;
    if (a === b || b === c || a === c) continue; // a sliver: it has no area, so it has no edge to match
    for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.set(`${u}>${v}`, (edges.get(`${u}>${v}`) || 0) + 1);
  }
  let open = 0;
  for (const [k, n] of edges) {
    const [u, v] = k.split(">");
    open += Math.abs(n - (edges.get(`${v}>${u}`) || 0));
  }
  return { triangles: tris.length, open, volume };
}

// A 3MF is a zip: find one entry and return its text. Reads the central directory, so entries written with a
// data descriptor work too.
export function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("3MF is not a zip file (no end-of-directory record)");
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw new Error("3MF zip directory is damaged");
    const method = bytes.readUInt16LE(p + 10), size = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28), extraLen = bytes.readUInt16LE(p + 30), commentLen = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42), name = bytes.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// What a 3MF holds, as a consumer would build it: every <object> with a <mesh> (triangle count, directed edges with
// no partner, signed volume; the file's vertices are already welded, so indexes are compared as they are), and the
// <build> items resolved to those objects. `placed` is the volume of each build item: mesh volume times the determinant
// of its transform (the 12 numbers of a 3MF matrix, identity when there is none). An item that points at no object, or at
// an object made of components, throws.
export function readThreeMf(bytes) {
  const files = zipEntries(bytes);
  const name = [...files.keys()].find((k) => /\.model$/i.test(k));
  if (!name) throw new Error("3MF has no .model file: " + [...files.keys()].join(", "));
  const xml = files.get(name).toString("utf8");
  if (!/<\/model>\s*$/.test(xml)) throw new Error("3MF model XML is cut off");
  const objects = new Map();
  for (const o of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = (o[1].match(/\bid="([^"]+)"/) || [])[1];
    if (id === undefined) throw new Error("3MF object without an id");
    if (objects.has(id)) throw new Error(`3MF has two objects with id ${id}`);
    if (/<components\b/.test(o[2])) { objects.set(id, { components: true }); continue; }
    const m = o[2].match(/<mesh>([\s\S]*?)<\/mesh>/);
    if (!m) throw new Error(`3MF object ${id} has no mesh`);
    const verts = [...m[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((v) => [+v[1], +v[2], +v[3]]);
    const tris = [...m[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((t) => [+t[1], +t[2], +t[3]]);
    const edges = new Map();
    let volume = 0;
    for (const [a, b, c] of tris) {
      if (![a, b, c].every((i) => i < verts.length)) throw new Error("3MF triangle points at a vertex that is not there");
      const [p, q, r] = [a, b, c].map((i) => verts[i]);
      volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.set(`${u}>${v}`, (edges.get(`${u}>${v}`) || 0) + 1);
    }
    let open = 0;
    for (const [k, n] of edges) { const [u, v] = k.split(">"); open += Math.abs(n - (edges.get(`${v}>${u}`) || 0)); }
    objects.set(id, { vertices: verts.length, triangles: tris.length, open, volume });
  }
  const build = xml.match(/<build>([\s\S]*?)<\/build>/);
  if (!build) throw new Error("3MF has no <build>");
  const items = [...build[1].matchAll(/<item\b([^>]*?)\/?>/g)].map((it) => {
    const objectid = (it[1].match(/\bobjectid="([^"]+)"/) || [])[1];
    const obj = objects.get(objectid);
    if (!obj) throw new Error(`3MF build item points at object ${objectid}, which does not exist`);
    if (obj.components) throw new Error(`3MF build item ${objectid} is made of components (not written by the exporter)`);
    const t = ((it[1].match(/\btransform="([^"]+)"/) || [])[1] || "1 0 0 0 1 0 0 0 1 0 0 0").trim().split(/\s+/).map(Number);
    if (t.length !== 12 || !t.every(Number.isFinite)) throw new Error(`3MF build item ${objectid} has a damaged transform`);
    const det = t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6]);
    return { objectid, mesh: obj, placed: obj.volume * det };
  });
  return { objects, items };
}

// STEP text: a start line, an end line, and how many solid entities it holds. A plain solid is a MANIFOLD_SOLID_BREP; a
// solid with an enclosed cavity is a BREP_WITH_VOIDS.
export function readStep(bytes) {
  const text = bytes.toString("latin1");
  if (!/^ISO-10303-21;/.test(text)) throw new Error("STEP file does not start with ISO-10303-21;");
  if (!/END-ISO-10303-21;\s*$/.test(text)) throw new Error("STEP file does not end with END-ISO-10303-21;");
  return { solids: (text.match(/=\s*(MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS)\s*\(/g) || []).length };
}

// How well a mesh must match the kernel's exact volume. Flat faces are written exactly; curved faces are cut into
// triangles that sit inside the true surface (0.3 to 0.7 percent seen).
export const PLANAR_KINDS = new Set(["box", "wedge", "pyramid", "prism", "roof", "star", "group"]);
export function meshMatches(mesh, exact, kinds) {
  const flat = kinds.every((k) => PLANAR_KINDS.has(k));
  const rel = flat ? 2e-4 : 1e-2, abs = flat ? 0.01 : 0.05;
  return Number.isFinite(mesh) && Math.abs(mesh - exact) <= abs + rel * Math.max(Math.abs(mesh), Math.abs(exact));
}

// What a person pastes to run the same chain again.
export function replayCommand({ seed, ops, strict, project }) {
  return `${strict ? "FUZZ_STRICT=1 " : ""}FUZZ_SEED=${seed} FUZZ_OPS=${ops} npx playwright test test/fuzz.spec.mjs --project=${project}`;
}
