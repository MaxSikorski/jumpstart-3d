import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const PREAMBLE = "Use millimetres, with width along x, depth along y and height along z. Unless I specify otherwise, centre the footprint at x=0, y=0 and put its base at z=0. Leave one visible solid and no spare shapes.";
export const TOLERANCE = { volumeAbsMm3: 1, volumeRel: 0.001, bboxAbsMm: 0.1 };
export const FAMILIES = ["box", "cylinder", "central-bore", "offset-bore", "two-bores", "four-bores", "tube", "side-bore", "boss", "scale-move"];
export const FIXTURE = new URL("./chat-cases.json", import.meta.url);
export const MAX_TRIANGLES = 200000, MAX_STL_BYTES = 84 + 50 * MAX_TRIANGLES;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export class JudgeError extends Error {
  constructor(message, detail = null) { super(message); this.detail = detail; }
}
const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys.split(" ").sort().join(",");
const bounded = (s) => typeof s === "string" && s.trim().length > 0 && s.length <= 2000;
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const boxValid = (b) => fields(b, "min max") && [b.min, b.max].every((v) => Array.isArray(v) && v.length === 3 && v.every(finite)) && b.min.every((v, i) => v < b.max[i]);

export function validateFixture(f, path = String(FIXTURE)) {
  const bad = (reason) => { throw new JudgeError(`chat judge: invalid benchmark at ${path}: ${reason}`); };
  if (!fields(f, "version preamble tolerance cases")) bad("unexpected or missing fields");
  if (f.version !== 1) bad("unsupported version");
  if (f.preamble !== PREAMBLE || !fields(f.tolerance, "volumeAbsMm3 volumeRel bboxAbsMm") ||
      Object.entries(TOLERANCE).some(([k, v]) => f.tolerance[k] !== v)) bad("invalid preamble or tolerance");
  if (!Array.isArray(f.cases) || f.cases.length !== 50 || f.cases.some((c, i) => c?.id !== `J3-${String(i + 1).padStart(3, "0")}`)) bad("expected 50 ordered unique cases");
  for (const c of f.cases) {
    if (!fields(c, "id family request expected calculation") || !fields(c.expected, "bodies volumeMm3 bboxMm holes") || !fields(c.expected.bboxMm, "min max")) bad("unexpected or missing fields");
    if (!bounded(c.request) || !bounded(c.calculation)) bad("invalid request or calculation");
    const e = c.expected;
    if (e.bodies !== 1 || !finite(e.volumeMm3) || e.volumeMm3 <= 0 || !boxValid(e.bboxMm) || !Number.isInteger(e.holes) || e.holes < 0 || e.holes > 4) bad("invalid expected geometry");
  }
  if (FAMILIES.some((name) => f.cases.filter((c) => c.family === name).length !== 5)) bad("expected five cases per family");
  return f;
}

export async function loadFixture(path = FIXTURE) {
  let bytes, value;
  try {
    bytes = await readFile(path);
    if (bytes.length > 1048576) throw new Error();
    value = JSON.parse(bytes);
  } catch { throw new JudgeError(`chat judge: invalid benchmark at ${path}: unexpected or missing fields`); }
  return { fixture: validateFixture(value, String(path)), casesSha256: sha256(bytes) };
}

export function selectCases(fixture, ids) {
  if (ids === undefined) return fixture.cases;
  const wanted = typeof ids === "string" ? ids.split(",") : ids;
  if (!Array.isArray(wanted) || !wanted.length || new Set(wanted).size !== wanted.length || wanted.some((id) => !fixture.cases.some((c) => c.id === id))) throw new JudgeError("chat judge: cases must be unique known IDs");
  return fixture.cases.filter((c) => wanted.includes(c.id));
}

export function topology(bytes) {
  const invalid = () => { throw new JudgeError("chat judge: invalid binary STL"); };
  const manifold = (detail) => { throw new JudgeError("chat judge: mesh is not a closed oriented manifold", detail); };
  if (!(bytes instanceof Uint8Array) || bytes.length < 84) invalid();
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = buf.readUInt32LE(80);
  if (count > MAX_TRIANGLES || bytes.length > MAX_STL_BYTES) throw new JudgeError("chat judge: STL exceeds 200000 triangles");
  if (!count || bytes.length !== 84 + 50 * count) invalid();
  const epsilon = 0.00001, cells = new Map(), vertices = [], faces = [], seen = new Set();
  let discardedDegenerates = 0;
  function weld(p) {
    const cell = p.map((n) => Math.floor(n / epsilon));
    let first = Infinity;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const bucket = cells.get([cell[0] + x, cell[1] + y, cell[2] + z].join(","));
      for (const id of bucket || []) if (id < first && Math.hypot(...p.map((v, i) => v - vertices[id][i])) <= epsilon) first = id;
    }
    if (first !== Infinity) return first;
    const key = cell.join(","), id = vertices.length;
    vertices.push(p);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(id);
    return id;
  }
  for (let n = 0; n < count; n++) {
    const ids = [];
    for (let v = 0; v < 3; v++) {
      const p = [0, 1, 2].map((axis) => buf.readFloatLE(84 + 50 * n + 12 + v * 12 + axis * 4));
      if (!p.every(finite)) invalid();
      ids.push(weld(p));
    }
    if (new Set(ids).size < 3) { discardedDegenerates++; continue; }
    const [a, b, c] = ids.map((id) => vertices[id]);
    const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
    if (Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) === 0) manifold("zero-area triangle");
    const key = [...ids].sort((a, b) => a - b).join(",");
    if (seen.has(key)) manifold("duplicate triangle");
    seen.add(key); faces.push(ids);
  }
  if (!faces.length) manifold("no retained triangles");
  const edges = new Map(), links = new Map(), neighbours = faces.map(() => []);
  faces.forEach((face, fi) => {
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], c = face[(i + 2) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ fi, direction: a < b ? 1 : -1 });
      if (!links.has(a)) links.set(a, new Map());
      const link = links.get(a);
      for (const [from, to] of [[b, c], [c, b]]) {
        if (!link.has(from)) link.set(from, []);
        link.get(from).push(to);
      }
    }
  });
  for (const uses of edges.values()) {
    if (uses.length !== 2) manifold("open or non-manifold edge");
    if (uses[0].direction === uses[1].direction) manifold("inconsistent winding");
    neighbours[uses[0].fi].push(uses[1].fi); neighbours[uses[1].fi].push(uses[0].fi);
  }
  for (const link of links.values()) {
    if ([...link.values()].some((ns) => ns.length !== 2)) manifold("non-manifold vertex link");
    const visited = new Set(), stack = [link.keys().next().value];
    while (stack.length) { const id = stack.pop(); if (visited.has(id)) continue; visited.add(id); stack.push(...link.get(id).filter((n) => !visited.has(n))); }
    if (visited.size !== link.size) manifold("non-manifold vertex link");
  }
  let components = 0;
  const visited = new Set();
  for (let i = 0; i < faces.length; i++) {
    if (visited.has(i)) continue;
    components++;
    const stack = [i];
    while (stack.length) { const id = stack.pop(); if (visited.has(id)) continue; visited.add(id); stack.push(...neighbours[id].filter((n) => !visited.has(n))); }
  }
  const V = links.size, E = edges.size, F = faces.length, chi = V - E + F;
  const stats = { V, E, F, chi, components, discardedDegenerates };
  if (components !== 1) throw new JudgeError(`chat judge: expected one connected boundary, got ${components}`, stats);
  const holes = (2 - chi) / 2;
  if (!Number.isInteger(holes) || holes < 0) throw new JudgeError("chat judge: could not compute an integer hole count", stats);
  return { ...stats, holes };
}

export const plannedRow = (c) => ({ id: c.id, status: "not_run", expected: structuredClone(c.expected), observed: null,
  metrics: { body: null, volume: null, bbox: null, holes: null }, toolCalls: 0, toolErrors: [], providerRequests: 0, elapsedMs: 0, messages: [] });

export function compare(row, observed, tolerance = TOLERANCE, visibleSolid = true) {
  row.observed = observed;
  if (!observed) {
    row.status = "error"; row.messages.push("chat judge: geometry is missing or failed to build"); return row;
  }
  const e = row.expected, o = observed, m = row.metrics;
  m.body = o.bodies === 1 && visibleSolid;
  if (!m.body) row.messages.push("expected one visible solid and no spare bodies");
  if (o.volumeMm3 != null && finite(o.volumeMm3) && o.volumeMm3 > 0) {
    const delta = Math.abs(o.volumeMm3 - e.volumeMm3), limit = Math.max(tolerance.volumeAbsMm3, tolerance.volumeRel * e.volumeMm3);
    m.volume = delta <= limit;
    if (!m.volume) row.messages.push(`volume differs by ${delta.toFixed(6)} mm3 (allowed ${limit.toFixed(6)})`);
  }
  if (boxValid(o.bboxMm)) {
    m.bbox = true;
    for (const side of ["min", "max"]) for (let i = 0; i < 3; i++) {
      const delta = Math.abs(o.bboxMm[side][i] - e.bboxMm[side][i]);
      if (delta > tolerance.bboxAbsMm) {
        m.bbox = false; row.messages.push(`bbox ${side}.${"xyz"[i]} differs by ${delta.toFixed(6)} mm (allowed 0.1)`);
      }
    }
  }
  if (Number.isInteger(o.holes) && o.holes >= 0) {
    m.holes = o.holes === e.holes;
    if (!m.holes) row.messages.push(`expected ${e.holes} through holes, got ${o.holes}`);
  }
  row.status = !m.body ? "fail" : Object.values(m).some((v) => v === null) ? "error" : Object.values(m).every(Boolean) ? "pass" : "fail";
  if (row.status === "error") row.messages.push("chat judge: geometry is missing or failed to build");
  return row;
}

export function updateSummary(report) {
  const count = (status) => report.cases.filter((r) => r.status === status).length;
  const denominator = report.cases.length, pass = count("pass");
  report.summary = { pass, fail: count("fail"), error: count("error"), notRun: count("not_run"), denominator, percent: denominator ? 100 * pass / denominator : 0 };
  report.complete = !report.runError && !report.summary.error && !report.summary.notRun;
  return report;
}

export const exitCode = (report, interrupted = false) => interrupted ? 130 : updateSummary(report).complete ? 0 : 2;

export function formatReport(report) {
  updateSummary(report);
  const cell = (v) => String(v ?? "—").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const lines = [`# ${report.mode === "mock" ? "Chat geometry scorer regression (mock)" : "Chat geometry benchmark (Ollama)"}`, "",
    `Build: ${report.build}; app: ${report.appVersion ?? "unavailable"}; bridge: ${report.bridgeVersion ?? "unavailable"}; coverage: ${report.coverage.selected}/50${report.coverage.selected < 50 ? " (subset)" : ""}.`,
    `Model: ${cell(report.model)}; digest: ${cell(report.modelDigest)}; Ollama: ${cell(report.ollamaVersion)}; context: 32768; scripts/vision: off; mesh: Normal; token usage: not_collected.`,
    `Started: ${report.startedAt}; finished: ${report.finishedAt ?? "unfinished"}; complete: ${report.complete}.`,
    `Build SHA256: ${report.buildSha256 ?? "unavailable"}; cases SHA256: ${report.casesSha256 ?? "unavailable"}.`,
    `System SHA256: ${report.systemSha256 ?? "unavailable"}; tools SHA256: ${report.toolsSha256 ?? "unavailable"}; offered tools: ${report.toolCount ?? "unavailable"}.`, "",
    "Volume, world bounds and genus are a geometry signature, not proof of exact shape, bore diameter/location or edit history. Holes count separate through-tunnels on one connected closed boundary; this is not a blind-hole or general CAD hole recogniser.", "",
    "Case | Result | Volume (mm³) | Bbox max error (mm) | Holes | Tools | Seconds | Reason",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---"];
  for (const r of report.cases) {
    const o = r.observed, bbox = boxValid(o?.bboxMm) ? Math.max(...["min", "max"].flatMap((s) => o.bboxMm[s].map((n, i) => Math.abs(n - r.expected.bboxMm[s][i])))).toFixed(6) : null;
    lines.push([r.id, r.status, o?.volumeMm3 == null ? null : `${o.volumeMm3.toFixed(6)} / ${r.expected.volumeMm3.toFixed(6)}`, bbox,
      o?.holes == null ? null : `${o.holes} / ${r.expected.holes}`, r.toolCalls, (r.elapsedMs / 1000).toFixed(2), r.messages.map((m) => typeof m === "string" ? m : `detail: ${typeof m.detail === "string" ? m.detail : JSON.stringify(m.detail)}`).join("; ") || "—"].map(cell).join(" | "));
  }
  const s = report.summary;
  lines.push("", `Passed ${s.pass}/${s.denominator} (${s.percent.toFixed(1)}%); failed ${s.fail}; errors ${s.error}; not run ${s.notRun}; coverage ${report.coverage.selected}/50.`);
  if (report.runError) lines.push("", cell(report.runError.message), cell(report.runError.detail));
  if (report.mode === "mock") lines.push("", "The mock tests the scorer, not how well a model understands a request. No real model was scored.");
  return lines.join("\n") + "\n";
}
