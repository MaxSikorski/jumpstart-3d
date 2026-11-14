// The drawing bench's link to the app: every number comes from JS3D calls (inspect, faces, edges, measure, collisions,
// params, save, load), never from a spec the AI wrote. `call(name, args)` is JS3D.invoke in a page: mcp/session.mjs in the
// bench, page.evaluate in the Playwright test. score.mjs does the sums.
import { createHash } from "node:crypto";
import { checkRecipe, substitute, versionAtLeast } from "../../mcp/recipe.mjs";
import { finish, pickPose, poses, stepMatrix, toBuilt, tolOf, turnedSize, within, checkPose } from "./score.mjs";

const LONG = { timeoutMs: 600_000 };
const PARALLEL = Math.cos(Math.PI / 360); // 0.5 degrees
const FULL_TURN = 0.8; // a hole wall covers at least this share of a whole cylinder (a slot's round end is a half)

// A headless app for the bench and the drawing maker (mcp/session.mjs: Chromium on docs/ unless `app` says otherwise).
export async function openApp(app) {
  const { Session } = await import("../../mcp/session.mjs");
  const session = new Session({ mode: "headless", app, log: () => {} });
  return { call: (name, args = []) => session.call(name, args, LONG), close: () => session.close() };
}

// Builds a recipe in the open design, as `jumpstart build` does: "$name" in later args is an earlier step's result.
export async function runRecipe(call, recipe) {
  checkRecipe(recipe);
  if (recipe.needs) {
    const version = await call("run", ["return JS3D.version"]);
    if (!versionAtLeast(version, recipe.needs)) throw new Error(`this recipe needs bridge ${recipe.needs}; the app has ${version}`);
  }
  const vars = Object.create(null);
  for (const [i, step] of recipe.steps.entries()) {
    try {
      const r = await call(step.call, substitute(step.args ?? [], vars));
      if (step.as !== undefined) vars[step.as] = r;
    } catch (e) { throw new Error(`step ${i + 1} (${step.call}): ${(e && e.message) || e}`); }
  }
  await call("ready");
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const n = len(a); const u = a.map((v) => v / n); const k = u.findIndex((v) => Math.abs(v) > 1e-9); return u[k] < 0 ? u.map((v) => -v) : u; };
const offAxis = (p, point, axis) => { const d = sub(p, point); return len(sub(d, axis.map((v) => v * dot(d, axis)))); };

// the centre of a circle edge: a whole circle has start = end and mid opposite; an arc's centre is its three points' circumcentre
function circleCentre(e) {
  const { start: a, mid: m, end: b } = e;
  if (len(sub(a, b)) < 1e-6) return a.map((v, i) => (v + m[i]) / 2);
  const ab = sub(b, a), am = sub(m, a), n = cross(ab, am), nn = dot(n, n);
  if (nn < 1e-18) return e.center;
  const t = cross(n, ab).map((v) => v * dot(am, am)), s = cross(am, n).map((v) => v * dot(ab, ab));
  return a.map((v, i) => v + (t[i] + s[i]) / (2 * nn));
}

// Holes from JS3D.faces and JS3D.edges of one body: hole-wall cylinders grouped by axis line into stacks (a counterbore
// and its bore are one hole). A stack end is closed when the face beyond its end circle is a floor (a flat face whose
// outside points into the hole), a cone or a sphere; a stack closed at both ends is a sealed cavity, not a hole.
export function findHoles(faces, edges) {
  const byIndex = new Map(faces.map((f) => [f.index, f]));
  const circlesOf = new Map();
  for (const e of edges) if (e.type === "circle") for (const fi of e.faces) circlesOf.set(fi, [...(circlesOf.get(fi) || []), e]);
  const pieces = faces.filter((f) => f.type === "cylinder" && f.hole).map((f) => {
    const axis = unit(f.axis), circles = (circlesOf.get(f.index) || []).map((e) => ({ e, c: circleCentre(e) }));
    const point = circles[0]?.c ?? f.center, mid = dot(f.center, axis), at = circles.map(({ c }) => dot(c, axis));
    if (at.length && Math.max(...at) - Math.min(...at) < 0.01) at.push(2 * mid - at[0]);
    if (!at.length) { const half = f.area / (2 * Math.PI * f.radius) / 2; at.push(mid - half, mid + half); }
    return { f, axis, point, dia: 2 * f.radius, from: Math.min(...at), to: Math.max(...at), circles };
  });
  const groups = [];
  for (const p of pieces) {
    const touching = groups.filter((q) => q.some((o) => Math.abs(dot(o.axis, p.axis)) >= PARALLEL && offAxis(p.point, o.point, o.axis) < 0.01 &&
      p.from <= o.to + 0.01 && o.from <= p.to + 0.01));
    for (const q of touching) groups.splice(groups.indexOf(q), 1); // a piece may join stacks met earlier in another order
    groups.push([p, ...touching.flat()]);
  }
  const holes = [];
  for (const g of groups) {
    const axis = g[0].axis, segments = [];
    for (const p of [...g].sort((a, b) => a.from - b.from)) {
      const s = segments.find((x) => Math.abs(x.dia - p.dia) < 1e-6 && p.from <= x.to + 0.01 && x.from <= p.to + 0.01);
      if (s) { s.from = Math.min(s.from, p.from); s.to = Math.max(s.to, p.to); s.area += p.f.area; }
      else segments.push({ dia: p.dia, from: p.from, to: p.to, area: p.f.area });
    }
    if (segments.some((s) => s.area < FULL_TURN * Math.PI * s.dia * (s.to - s.from))) continue; // part of a cylinder: a slot end, a fillet
    const from = Math.min(...segments.map((s) => s.from)), to = Math.max(...segments.map((s) => s.to));
    const closes = (f, inward) => !!f && (f.type === "cone" || f.type === "sphere" ||
      (f.type === "plane" && (f.normal ? dot(f.normal, inward) > 0.5 : f.edgeCount === 1)));
    const end = (at, inward) => {
      const beyond = g.flatMap((p) => p.circles.filter(({ c }) => Math.abs(dot(c, axis) - at) < 0.01).map(({ e }) => e.faces.find((fi) => fi !== p.f.index)));
      return beyond.length ? beyond.some((fi) => closes(byIndex.get(fi), inward)) : null;
    };
    const closedLow = end(from, axis), closedHigh = end(to, axis.map((v) => -v));
    if (closedLow && closedHigh) continue;
    const open = closedLow === true && closedHigh === false ? axis : closedHigh === true && closedLow === false ? axis.map((v) => -v) : null;
    holes.push({
      axis, point: g[0].point.map((v, i) => v + axis[i] * (from - dot(g[0].point, axis))), from, to, dia: Math.min(...segments.map((s) => s.dia)),
      through: closedLow === null || closedHigh === null ? null : !closedLow && !closedHigh, open,
      segments: segments.sort((a, b) => a.from - b.from).map(({ dia, from: f, to: t }) => ({ dia, from: f, to: t })),
    });
  }
  return holes;
}

// What score.mjs needs to know about the design that is open now (README "How a design is scored").
export async function measurePart(call) {
  const shown = (await call("list")).filter((b) => !b.hole && !b.hidden);
  const part = { bodies: [], body: null, box: null, size: null, volume: null, volumeFrom: null, solids: 0, holes: [], faces: [] };
  if (!shown.length) return part;
  const ins = await call("inspect");
  part.bodies = ins.bodies.map(({ id, name, error, volumeFrom, solids }) => ({ id, name, error: error ?? null, volumeFrom: volumeFrom ?? null, solids: solids ?? 0 }));
  part.solids = part.bodies.reduce((n, b) => n + (b.solids || 0), 0);
  if (part.bodies.length !== 1 || part.bodies[0].error) return part;
  const b = ins.bodies[0];
  Object.assign(part, { body: b.id, box: b.bbox, size: b.size, volume: b.volume, volumeFrom: b.volumeFrom });
  if (b.volumeFrom !== "solid") return part;
  part.faces = await call("faces", [b.id, "all"]);
  part.holes = findHoles(part.faces, await call("edges", [b.id, "all"]));
  return part;
}

// Builds the truth recipe in a fresh design: its measurements and the part as STEP (base64), for the overlap.
export async function buildTruth(call, recipe) {
  await call("newDesign", ["advanced"]);
  await runRecipe(call, recipe);
  const part = await measurePart(call);
  if (!part.body || part.volumeFrom !== "solid") throw new Error("the truth recipe did not build one exact solid");
  const step = await call("export", ["step", { ids: [part.body] }]);
  return { part, step: Buffer.from(step).toString("base64") };
}

const sizeTolOf = (truth) => truth.checks.find((c) => c.kind === "size");

// The truth part, turned for every pose, as STEP bodies next to the built part; JS3D.collisions gives each shared volume.
async function overlaps(call, { truthBuild, part, truthSize, turns, original }) {
  // the app caches imported files by asset id, so the id must change with the content (as the app names its own imports)
  const asset = "drawbench-" + createHash("sha256").update(truthBuild.step).digest("hex").slice(0, 24);
  const doc = structuredClone(original);
  doc.doc.assets = { ...(doc.doc.assets || {}), [asset]: { kind: "step", name: "truth.step", data: truthBuild.step } };
  turns.forEach((p, k) => doc.doc.bodies.push({ id: `drawbench-truth-${k}`, name: `Truth ${k}`, hole: false, hidden: false,
    m: stepMatrix(p.R, truthSize, truthBuild.part.box.min, part.box.min), node: { t: "step", asset, keepPos: true, mods: [] } }));
  const out = [];
  try {
    await call("load", [JSON.stringify(doc)]);
    await call("ready");
    for (const [k] of turns.entries()) {
      try {
        const r = await call("collisions", [{ ids: [part.body, `drawbench-truth-${k}`] }]);
        const pair = r.pairs[0], skipped = r.skipped?.[0];
        const problem = skipped ? `${skipped.name}: ${skipped.error}` : pair?.error ?? pair?.note ?? (pair?.state === "overlap" && typeof pair.overlap !== "number" ? "the shared volume was not worked out" : null);
        if (problem) out.push({ error: problem });
        else out.push({ shared: pair?.state === "overlap" ? pair.overlap : 0, truthVolume: truthBuild.part.volume });
      } catch (e) { out.push({ error: (e && e.message) || String(e) }); }
    }
  } catch (e) {
    while (out.length < turns.length) out.push({ error: (e && e.message) || String(e) });
  } finally {
    await call("load", [JSON.stringify(original), { keepId: true }]);
    await call("ready");
  }
  return out;
}

async function poseEvidence(call, { truth, part, truthSize, pose, overlap }) {
  const at = (p) => toBuilt(pose.R, truthSize, part.box.min, p), body = part.body, faces = new Map(part.faces.map((f) => [f.index, f]));
  const evidence = { distances: {}, radii: {}, overlap };
  for (const c of truth.checks) {
    try {
      if (c.kind === "distance") {
        const r = await call("measure", [{ body, near: at(c.a.near) }, { body, near: at(c.b.near) }]);
        evidence.distances[c.id] = { kind: r.kind, distance: r.distance, nearA: r.a.nearDistance, nearB: r.b.nearDistance };
      }
      if (c.kind === "radius") {
        const p = at(c.near), r = await call("measure", [{ body, near: p }, p]), f = faces.get(r.a.face);
        evidence.radii[c.id] = { type: f?.type ?? null, radius: f?.radius ?? null, near: r.a.nearDistance };
      }
    } catch (e) { (c.kind === "distance" ? evidence.distances : evidence.radii)[c.id] = { error: (e && e.message) || String(e) }; }
  }
  return evidence;
}

const transpose = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
const mm = (v) => v.map((x) => +x.toFixed(2)).join(" × ");

// Editable checks on the kept turn: change a named size, save, reload, measure the box, then put the design back.
async function editableChecks(call, { kase, truth, part, pose, original }) {
  const sizeCheck = sizeTolOf(truth), params = await call("params"), text = JSON.stringify(original), out = [];
  try {
    for (const item of kase.editable) {
      const found = params.filter((p) => Math.abs(p.value - item.param) <= 0.001);
      if (!found.length) { out.push({ id: item.id, status: "fail", measured: null, note: `no named size is ${item.param} mm` }); continue; }
      let result;
      for (const p of found) {
        await call("load", [text]);
        try {
          await call("setParam", [p.name, String(item.to)]);
          await call("load", [JSON.stringify(await call("save"))]);
          await call("ready");
          const b = (await call("inspect", [[part.body]])).bodies[0];
          if (b.error || !b.size) { result = { id: item.id, status: "fail", measured: null, note: `changing ${p.name} to ${item.to} broke the part: ${b.error}` }; continue; }
          const seen = turnedSize(transpose(pose.R), b.size);
          const ok = seen.every((v, i) => within(v, item.size[i], tolOf(sizeCheck.tol, item.size[i])));
          result = { id: item.id, status: ok ? "pass" : "fail", measured: seen,
            note: ok ? "" : `changing ${p.name} from ${item.param} to ${item.to} gave a box of ${mm(seen)}, expected ${mm(item.size)}` };
          if (ok) break;
        } catch (e) { result = { id: item.id, status: "fail", measured: null, note: `changing ${p.name} failed: ${(e && e.message) || e}` }; }
      }
      out.push(result);
    }
  } finally {
    await call("load", [text, { keepId: true }]);
    await call("ready");
  }
  return out;
}

// Scores the design that is open now against a case. truthBuild comes from buildTruth (build it once per case).
export async function scoreOpenDesign(call, { kase, truth, truthBuild }) {
  const original = await call("save");
  await call("load", [JSON.stringify(original), { keepId: true }]);
  await call("ready");
  const part = await measurePart(call);
  const sizeCheck = sizeTolOf(truth), truthSize = sizeCheck.value;
  const gated = finish({ truth, kase, part, scored: [], editable: [] });
  if (gated.checks[0].status !== "pass") return { result: gated, part };
  const turns = poses(truthSize, part.size, tolOf(sizeCheck.tol, Math.max(...truthSize)));
  const shared = await overlaps(call, { truthBuild, part, truthSize, turns, original });
  const scored = [];
  for (const [k, pose] of turns.entries()) {
    const evidence = await poseEvidence(call, { truth, part, truthSize, pose, overlap: shared[k] });
    scored.push({ pose, checks: checkPose({ truth, kase, part, pose, evidence }) });
  }
  const kept = scored[pickPose(scored)].pose;
  const editable = await editableChecks(call, { kase, truth, part, pose: kept, original });
  return { result: finish({ truth, kase, part, scored, editable }), part };
}

// Builds or loads a design in a fresh document and scores it: { recipe } (a parsed recipe) or { project } (project text).
export async function scoreDesign(call, { kase, truth, truthBuild, design }) {
  await call("newDesign", ["advanced"]);
  if (design.recipe) await runRecipe(call, design.recipe);
  else { await call("load", [design.project]); await call("ready"); }
  return scoreOpenDesign(call, { kase, truth, truthBuild });
}
