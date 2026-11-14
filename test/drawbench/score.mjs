import { readFile, access } from "node:fs/promises";
import { basename, join } from "node:path";

export const KINDS = ["size", "holes", "distance", "radius", "volume", "solids"];
export const RESERVED = ["gate", "holes-total", "overlap"];
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const positive = (n) => finite(n) && n > 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const vector = (v, n, test = finite) => Array.isArray(v) && v.length === n && v.every(test);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const round = (v) => typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : Array.isArray(v) ? v.map(round) : object(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;

export function tolOf(tol, value) {
  if (finite(tol) && tol >= 0) return { minus: tol, plus: tol };
  if (object(tol) && finite(tol.minus) && tol.minus >= 0 && finite(tol.plus) && tol.plus >= 0) return { minus: tol.minus, plus: tol.plus };
  if (typeof tol === "string" && /^(?:\d+(?:\.\d*)?|\.\d+)%$/.test(tol) && finite(value)) {
    const n = Math.abs(value) * Number(tol.slice(0, -1)) / 100;
    if (finite(n)) return { minus: n, plus: n };
  }
  throw new Error("invalid tolerance");
}
export const within = (measured, value, t) => measured >= value - t.minus - 1e-9 && measured <= value + t.plus + 1e-9;

export function validateTruth(truth) {
  const bad = (reason) => { throw new Error(`truth.json: ${reason}`); };
  if (!object(truth) || truth.spec !== 1) bad("spec must be 1");
  if (truth.units !== "mm") bad("units must be mm");
  if (!text(truth.name)) bad("name must not be empty");
  if (!Array.isArray(truth.checks) || truth.checks.length < 1 || truth.checks.length > 200) bad("checks must contain 1 to 200 checks");
  if (!Array.isArray(truth.assumed) || !Array.isArray(truth.questions)) bad("assumed and questions must be arrays");
  const ids = new Set();
  for (const c of truth.checks) {
    const id = c?.id, label = text(id) ? id : "unnamed check";
    const fail = (reason) => bad(`${label}: ${reason}`);
    if (!object(c) || typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(id) || RESERVED.includes(id) || id.startsWith("edit-") || ids.has(id)) fail("invalid or duplicate id");
    ids.add(id);
    if (!KINDS.includes(c.kind)) fail("invalid kind");
    if (c.from !== undefined && !["stated", "given", "derived", "measured", "assumed"].includes(c.from)) fail("invalid from");
    if (c.note !== undefined && typeof c.note !== "string") fail("note must be text");
    if (c.kind !== "solids") { try { tolOf(c.tol, 1); } catch { fail("invalid tolerance"); } }
    if (c.kind === "size" && !vector(c.value, 3, positive)) fail("size must contain three positive numbers");
    if (c.kind === "holes") {
      if (!positive(c.dia) || !Number.isInteger(c.count) || c.count < 1 || c.count > 200 || !["x", "y", "z"].includes(c.axis) || typeof c.through !== "boolean") fail("invalid holes diameter, count, axis or through");
      if (c.at !== undefined && (!Array.isArray(c.at) || c.at.length !== c.count || !c.at.every((p) => vector(p, 2)))) fail("invalid hole positions");
      if (c.depth !== undefined && (c.through || !positive(c.depth))) fail("depth requires a blind hole and a positive number");
      if (c.cbore !== undefined && (!object(c.cbore) || !positive(c.cbore.dia) || c.cbore.dia <= c.dia || !positive(c.cbore.depth))) fail("invalid counterbore");
      if (c.opens !== undefined && (!/^[+-][xyz]$/.test(c.opens) || c.opens[1] !== c.axis || (c.through && !c.cbore))) fail("opens must be +axis or -axis (for example \"+z\"), on a blind or counterbored hole");
    }
    if (c.kind === "distance" && (!vector(c.a?.near, 3) || !vector(c.b?.near, 3) || !positive(c.value))) fail("invalid distance points or value");
    if (c.kind === "radius" && (!vector(c.near, 3) || !positive(c.value))) fail("invalid radius point or value");
    if (c.kind === "volume" && !positive(c.value)) fail("volume must be positive");
    if (c.kind === "solids" && (!Number.isInteger(c.value) || c.value < 1)) fail("solids must be a positive integer");
  }
  if (truth.checks.filter((c) => c.kind === "size").length !== 1) bad("checks must contain exactly one size check");
  return truth;
}
export function validateCase(kase, dirName, truth) {
  const bad = (reason) => { throw new Error(`case.json: ${reason}`); };
  if (!object(kase) || kase.drawbench !== 1) bad("drawbench must be 1");
  if (typeof kase.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(kase.id) || kase.id !== dirName) bad("id must match the folder name");
  if (!text(kase.title)) bad("title must not be empty");
  if (![1, 2].includes(kase.wave) || !["development", "qualification"].includes(kase.set)) bad("invalid wave or set");
  const input = kase.input;
  if (!object(input) || !["drawing", "sketch", "photo"].includes(input.kind) || !text(input.picture) || input.picture.includes("/") || input.picture.includes("\\") || input.picture.includes("..") || !text(input.request)) bad("invalid input picture, kind or request");
  if (!finite(kase.overlap) || kase.overlap <= 0 || kase.overlap > 1) bad("overlap must be greater than 0 and at most 1");
  if (!Array.isArray(kase.editable)) bad("editable must be an array");
  const ids = new Set();
  for (const e of kase.editable) {
    if (!object(e) || typeof e.id !== "string" || !/^edit-[A-Za-z0-9_.-]+$/.test(e.id) || ids.has(e.id) || !positive(e.param) || !positive(e.to) || e.to === e.param || !vector(e.size, 3, positive)) bad(`invalid editable ${e?.id ?? "item"}`);
    ids.add(e.id);
  }
  if (!object(kase.drawing)) bad("drawing must be an object");
  if (!Array.isArray(kase.wrong) || !kase.wrong.length) bad("wrong must contain at least one recipe");
  if (kase.other !== undefined && !Array.isArray(kase.other)) bad("other must be an array");
  const recipes = new Set(), known = new Set([...truth.checks.map((c) => c.id), ...RESERVED, ...ids]);
  for (const o of kase.other ?? []) {
    if (!object(o) || typeof o.recipe !== "string" || !/^other-[a-z0-9-]+\.recipe\.json$/.test(o.recipe) || recipes.has(o.recipe)) bad("invalid or duplicate other recipe");
    recipes.add(o.recipe);
    if (!text(o.why) || !Array.isArray(o.fails) || new Set(o.fails).size !== o.fails.length || o.fails.some((id) => !ids.has(id))) bad(`${o.recipe}: invalid why or fails (an other build may only fail editable checks)`);
  }
  for (const w of kase.wrong) {
    if (!object(w) || typeof w.recipe !== "string" || !/^wrong-[a-z0-9-]+\.recipe\.json$/.test(w.recipe) || recipes.has(w.recipe)) bad("invalid or duplicate wrong recipe");
    recipes.add(w.recipe);
    if (!text(w.why) || !Array.isArray(w.fails) || !w.fails.length || new Set(w.fails).size !== w.fails.length || w.fails.some((id) => !known.has(id))) bad(`${w.recipe}: invalid why or fails`);
  }
  return kase;
}
export async function loadCase(dir) {
  const read = async (name) => { try { return JSON.parse(await readFile(join(dir, name), "utf8")); } catch (e) { throw new Error(`${name}: ${e.message}`); } };
  const truth = validateTruth(await read("truth.json"));
  const kase = validateCase(await read("case.json"), basename(dir), truth);
  for (const name of [kase.input.picture, ...kase.wrong.map((w) => w.recipe), ...(kase.other ?? []).map((o) => o.recipe), "truth.recipe.json"]) {
    try { await access(join(dir, name)); } catch { throw new Error(`missing file ${name}`); }
  }
  return { kase, truth, dir };
}

const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const determinant = (r) => r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6]);
export const ROTATIONS = permutations.flatMap((p) => [1, -1].flatMap((a) => [1, -1].flatMap((b) => [1, -1].map((c) => {
  const r = Array(9).fill(0); [a, b, c].forEach ( (s, i) => { r[3*i+p[i]] = s; }); return r;
})))).filter((r) => determinant(r) === 1);
const multiply = (r, v) => [0, 1, 2].map((i) => r[3*i]*v[0] + r[3*i+1]*v[1] + r[3*i+2]*v[2]);
const transpose = (r) => [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
export const turnedSize = (r, size) => multiply(r.map(Math.abs), size);
export function poses(truthSize, builtSize, t) {
  const all = ROTATIONS.map((R, index) => ({ index, R }));
  const matches = all.filter(({ R }) => turnedSize(R, truthSize).every((v, i) => within(builtSize[i], v, t)));
  if (matches.length) return matches;
  const error = ({ R }) => Math.max(...turnedSize(R, truthSize).map((v, i) => Math.abs(v - builtSize[i])));
  const best = Math.min(...all.map(error));
  return all.filter((p) => error(p) <= best + 1e-6);
}
const corner = (r, size) => [0, 1, 2].map((i) => size.reduce((sum, v, j) => sum + Math.min(0, r[3*i+j] * v), 0));
export function toBuilt(r, truthSize, builtMin, p) {
  const c = corner(r, truthSize); return multiply(r, p).map((v, i) => builtMin[i] + v - c[i]);
}
export function stepMatrix(r, truthSize, truthMin, builtMin) {
  const t = toBuilt(r, truthSize, builtMin, truthMin.map((v) => -v));
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, ...t, 1];
}
export const holePoint = (axis, at) => axis === "z" ? [at[0], at[1], 0] : axis === "y" ? [at[0], 0, at[1]] : [0, at[0], at[1]];
const dot = (a, b) => a.reduce((s, v, i) => s + v*b[i], 0);
const lineDistance = (p, h) => { const d = p.map((v, i) => v - h.point[i]), along = dot(d, h.axis); return Math.hypot(...d.map((v, i) => v - along*h.axis[i])); };
const rawMeasured = Symbol("raw measured");
const result = (id, kind, status, expected, measured, tol, note = "", gating = true) => {
  const check = { id, kind, status, expected: round(expected), measured: round(measured), tol, note: status === "pass" ? "" : note, gating };
  Object.defineProperty(check, rawMeasured, { value: measured });
  return check;
};
export function gate(truth, part) {
  const expected = truth.checks.find((c) => c.kind === "solids")?.value ?? 1;
  let note = "";
  if (part.bodies.length !== 1) note = `found ${part.bodies.length} visible bodies, expected 1`;
  else if (part.bodies[0].error) note = `body failed to build: ${part.bodies[0].error}`;
  else if (part.bodies[0].mesh) note = "the body is a mesh (triangles), not a CAD solid";
  else if (part.volumeFrom !== "solid" || part.bodies[0].volumeFrom !== "solid") note = "body is not an exact solid";
  else if (part.solids !== expected || part.bodies[0].solids !== expected) note = `found ${part.solids} solids, expected ${expected}`;
  return { id: "gate", kind: "gate", status: note ? "fail" : "pass", note, gating: true };
}
// the largest set of truth centres matched one-to-one to built holes within tolerance (Kuhn's augmenting paths)
function assign(d, ok) {
  const owner = new Array(d[0]?.length ?? 0).fill(-1);
  const claim = (i, seen) => d[i].some((_, j) => {
    if (seen[j] || !ok(d[i][j])) return false;
    seen[j] = true;
    if (owner[j] < 0 || claim(owner[j], seen)) { owner[j] = i; return true; }
    return false;
  });
  d.forEach((_, i) => claim(i, new Array(owner.length).fill(false)));
  return d.map((_, i) => owner.indexOf(i));
}
const opening = (h) => h.open ?? null;
function holesCheck(c, part, r, truthSize) {
  const axis = multiply(r, ["x", "y", "z"].map((a) => +(a === c.axis)));
  const t = tolOf(c.tol, c.dia), candidates = part.holes.filter((h) => Math.abs(dot(h.axis, axis)) >= Math.cos(Math.PI / 360) && within(h.dia, c.dia, t));
  const measured = { count: candidates.length, at: [] };
  let note = candidates.length !== c.count ? `found ${candidates.length} Ø${c.dia} holes along ${c.axis}, expected ${c.count}` : "";
  const selected = [];
  if (c.at) {
    const d = c.at.map((at) => { const p = toBuilt(r, truthSize, part.box.min, holePoint(c.axis, at)); return candidates.map((h) => lineDistance(p, h)); });
    const match = assign(d, (x) => within(x, 0, t));
    c.at.forEach((at, i) => {
      const nearest = d[i].length ? Math.min(...d[i]) : null;
      measured.at.push(match[i] >= 0 ? d[i][match[i]] : nearest);
      if (match[i] >= 0) selected.push({ h: candidates[match[i]], at });
      else if (!note) note = nearest === null ? `no Ø${c.dia} hole at [${at.join(", ")}]` : `no Ø${c.dia} hole at [${at.join(", ")}] (nearest is ${round(nearest)} mm away)`;
    });
  } else selected.push(...candidates.map((h) => ({ h, at: null })));
  const opens = c.opens && multiply(r, ["x", "y", "z"].map((a) => (a === c.opens[1] ? (c.opens[0] === "+" ? 1 : -1) : 0)));
  for (const { h, at } of selected) {
    const where = at ? ` at [${at.join(", ")}]` : "";
    if (opens && h.through === false && !note && (!opening(h) || dot(opening(h), opens) < 0.99)) note = `the Ø${c.dia} hole${where} opens on the wrong side (expected ${c.opens})`;
    if (h.through !== c.through && !note) note = `the Ø${c.dia} hole${where} is ${h.through === null ? "of unknown depth" : h.through ? "through" : "blind"}, expected ${c.through ? "through" : "blind"}`;
    if (c.depth !== undefined && !within(h.to - h.from, c.depth, tolOf(c.tol, c.depth)) && !note) note = `hole depth ${round(h.to - h.from)} mm, expected ${c.depth} mm`;
    if (c.cbore) {
      const s = [...h.segments].sort((a, b) => b.dia - a.dia)[0];
      const plain = h.segments.length < 2;
      if ((plain || !within(s.dia, c.cbore.dia, tolOf(c.tol, c.cbore.dia)) || !within(s.to - s.from, c.cbore.depth, tolOf(c.tol, c.cbore.depth))) && !note) note = `${plain ? "no counterbore" : `counterbore Ø${round(s.dia)} × ${round(s.to - s.from)}`}, expected Ø${c.cbore.dia} × ${c.cbore.depth}`;
      const atLow = Math.abs(s.from - h.from) < 0.01, atHigh = Math.abs(s.to - h.to) < 0.01;
      const side = h.axis.map((v) => v * (atHigh ? 1 : -1)); // the counterbore's end of the hole, as a direction
      if (!plain && !note && !atLow && !atHigh) note = `the Ø${round(s.dia)} bore of the Ø${c.dia} hole${where} is inside the hole, not a counterbore at its opening`;
      if (!plain && !note && opening(h) && dot(side, opening(h)) < 0.99) note = `the counterbore of the Ø${c.dia} hole${where} is at its closed end`;
      if (!plain && !note && opens && dot(side, opens) < 0.99) note = `the counterbore of the Ø${c.dia} hole${where} is on the wrong side (expected ${c.opens})`;
    } else if (h.segments.some((s) => !within(s.dia, c.dia, t)) && !note) note = `the Ø${c.dia} hole${where} has an unexpected bore diameter`;
  }
  return result(c.id, c.kind, note ? "fail" : "pass", c.count, measured, c.tol, note);
}
export function checkPose({ truth, kase, part, pose, evidence }) {
  const r = pose.R, truthSize = truth.checks.find((c) => c.kind === "size").value;
  const checks = truth.checks.map((c) => {
    if (c.kind === "holes") return holesCheck(c, part, r, truthSize);
    let measured = null, status = "pass", note = "";
    const fail = (message) => { status = "fail"; note = message; };
    if (c.kind === "size") {
      measured = turnedSize(transpose(r), part.size);
      if (measured.some((v, i) => !within(v, c.value[i], tolOf(c.tol, c.value[i])))) fail(`size [${round(measured).join(", ")}], expected [${c.value.join(", ")}]`);
    } else if (c.kind === "distance" || c.kind === "radius") {
      const e = (c.kind === "distance" ? evidence.distances : evidence.radii)?.[c.id];
      if (!e || e.error) { status = "unverified"; note = e?.error ?? "measurement is missing"; }
      else {
        const t = tolOf(c.tol, c.value), lim = Math.max(1, 2 * Math.max(t.minus, t.plus));
        measured = c.kind === "distance" ? e.distance : e.radius;
        if (c.kind === "distance" && e.kind !== "planes") fail("the faces near a and b are not two parallel flat faces");
        else if (c.kind === "distance" && (e.nearA > lim || e.nearB > lim)) { const a = e.nearA > lim; fail(`no flat face near ${a ? "a" : "b"} (closest ${round(a ? e.nearA : e.nearB)} mm away)`); }
        else if (c.kind === "radius" && e.type !== "cylinder") fail("the face near the point is not cylindrical");
        else if (c.kind === "radius" && e.near > lim) fail(`no cylindrical face near the point (closest ${round(e.near)} mm away)`);
        else if (!within(measured, c.value, t)) fail(`${c.kind} ${round(measured)} mm, expected ${c.value} mm`);
      }
    } else if (c.kind === "volume") {
      measured = part.volume;
      if (part.volumeFrom !== "solid") { status = "unverified"; note = "volume is not from an exact solid"; }
      else if (!within(measured, c.value, tolOf(c.tol, c.value))) fail(`volume ${round(measured)}, expected ${c.value}`);
    } else { measured = part.solids; if (measured !== c.value) fail(`found ${measured} solids, expected ${c.value}`); }
    return result(c.id, c.kind, status, c.value, measured, c.tol ?? null, note);
  });
  const count = truth.checks.filter((c) => c.kind === "holes").reduce((n, c) => n + c.count, 0);
  checks.push(result("holes-total", "holes-total", part.holes.length === count ? "pass" : "fail", count, part.holes.length, null, `found ${part.holes.length} holes, expected ${count}`));
  const e = evidence.overlap;
  if (!e || e.error) checks.push(result("overlap", "overlap", "unverified", kase.overlap, null, null, `overlap not measured: ${e?.error ?? "measurement is missing"}`, false));
  else { const iou = e.shared / (part.volume + e.truthVolume - e.shared); checks.push(result("overlap", "overlap", iou >= kase.overlap ? "pass" : "fail", kase.overlap, iou, null, `overlap ${round(iou)}, expected at least ${kase.overlap}`)); }
  return checks;
}
export function pickPose(scored) {
  let best = 0;
  const passing = (s) => s.checks.filter((c) => c.gating && c.status === "pass").length;
  const overlap = (s) => { const c = s.checks.find((x) => x.id === "overlap"); const value = c?.[rawMeasured] ?? c?.measured; return c && c.status !== "unverified" && finite(value) ? value : -1; };
  for (let i = 1; i < scored.length; i++) if (passing(scored[i]) > passing(scored[best]) || (passing(scored[i]) === passing(scored[best]) && overlap(scored[i]) > overlap(scored[best]))) best = i;
  return best;
}
export function finish({ truth, kase, part, scored, editable = [] }) {
  const g = gate(truth, part), sizeTol = truth.checks.find((c) => c.kind === "size").tol;
  const edits = kase.editable.map((e, i) => { const m = editable[i]; return result(e.id, "editable", g.status === "pass" && m ? m.status : "not run", e.size, g.status === "pass" && m ? m.measured : null, sizeTol, g.status === "pass" && m ? m.note : "not run", false); });
  let checks, pose = null;
  if (g.status === "pass" && scored.length) { const kept = scored[pickPose(scored)]; pose = kept.pose.index; checks = [g, ...kept.checks, ...edits]; }
  else {
    const pending = [...truth.checks.map((c) => [c.id, c.kind, c.kind === "holes" ? c.count : c.value, c.tol ?? null]), ["holes-total", "holes-total", truth.checks.filter((c) => c.kind === "holes").reduce((n, c) => n + c.count, 0), null], ["overlap", "overlap", kase.overlap, null]];
    checks = [g, ...pending.map(([id, kind, expected, tol]) => result(id, kind, "not run", expected, null, tol, "not run")), ...edits];
  }
  const passed = checks.filter((c) => c.status === "pass").length, total = checks.length;
  return { case: kase.id, pass: checks.every((c) => !c.gating || c.status === "pass"), score: { passed, total, percent: Math.floor(100 * passed / total) }, pose, checks };
}
export function expectWrong(result, fails) {
  const failing = result.checks.filter((c) => c.status !== "pass").map((c) => c.id), expected = new Set(fails), actual = new Set(failing);
  const unexpected = failing.filter((id) => !expected.has(id)), missing = fails.filter((id) => !actual.has(id));
  return { ok: !unexpected.length && !missing.length && (!result.pass || fails.every((id) => result.checks.some((c) => c.id === id && !c.gating))), unexpected, missing };
}
export function table(rows) {
  const cells = rows.map((r) => [r.case, r.design, `${r.result.score.passed}/${r.result.score.total}`, `${r.result.score.percent}%`, r.result.pass ? "PASS" : "FAIL", r.expected === undefined ? "" : (typeof r.expected === "boolean" ? r.expected : r.expected.ok) ? "as expected" : "NOT as expected", r.result.checks.filter((c) => c.status !== "pass").map((c) => c.id).join(", ")]);
  const widths = [0, 1, 2, 3, 4, 5].map((i) => Math.max(0, ...cells.map((c) => String(c[i]).length)));
  const lines = cells.map((c) => c.map((v, i) => i < 6 ? String(v).padEnd(widths[i]) : v).join("  ").trimEnd());
  // kind: "truth" (a reference part: must score 100 %), "other" (another correct build: must pass), "wrong", "design" (one given design)
  const of = (kind) => rows.filter((r) => (r.kind ?? (r.expected === undefined ? "truth" : "wrong")) === kind);
  const correct = (r) => typeof r.expected === "boolean" ? r.expected : r.expected.ok;
  const sums = [];
  if (of("truth").length) sums.push(`Reference parts: ${of("truth").filter((r) => r.result.pass && r.result.score.percent === 100).length} of ${of("truth").length} score 100 %.`);
  if (of("other").length) sums.push(`Other correct builds: ${of("other").filter(correct).length} of ${of("other").length} pass as expected.`);
  if (of("wrong").length) sums.push(`Wrong parts: ${of("wrong").filter(correct).length} of ${of("wrong").length} fail as expected.`);
  for (const r of of("design")) sums.push(`${r.design}: ${r.result.pass ? "PASS" : "FAIL"}, ${r.result.score.passed} of ${r.result.score.total} checks (${r.result.score.percent} %).`);
  lines.push("", sums.join(" "));
  return lines.join("\n");
}
