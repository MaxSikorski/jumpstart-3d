// Agents as users: random but repeatable chains of edits through the JS3D bridge, with the facts that must hold
// after every step checked. A chain is fully decided by its seed, so a failure prints the seed and the steps and
// the command that replays it. See test/README.md ("The fuzzer").
//   default:         4 fixed seeds (1, 7, 20, 30), 18 steps each, then a few controls on the checks themselves (both builds)
//   FUZZ_RUNS=50     seeds 1..50 instead      FUZZ_OPS=30  steps per chain (1 to 50)      FUZZ_SEED=7  that one seed only
//   FUZZ_STRICT=1    the known kernel problems (listed in test/README.md) fail the run instead of being noted
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { boot, loadDoc, newDoc, watchErrors } from "./helpers.mjs";
import {
  makeRng, readStl, meshReport, readThreeMf, readStep, meshMatches, lostTorusExcused, stretchExcused, replayCommand, coneOpenExcused,
} from "./fuzz-checks.mjs";

const OPS = +(process.env.FUZZ_OPS || 18);
// The app keeps 120 undo steps and a step can take two; past 50 steps the early ones fall off and undo can no longer return to them.
if (!Number.isInteger(OPS) || OPS < 1 || OPS > 50) throw new Error("FUZZ_OPS must be a whole number from 1 to 50");
const CUSTOM = !!(process.env.FUZZ_SEED || process.env.FUZZ_RUNS);
const SEEDS = process.env.FUZZ_SEED ? [+process.env.FUZZ_SEED]
  : process.env.FUZZ_RUNS ? Array.from({ length: +process.env.FUZZ_RUNS }, (_, i) => i + 1)
  : [1, 7, 20, 30]; // picked so that together they run every kind of step in REQUIRED
const KINDS = ["box", "box", "box", "cylinder", "cylinder", "sphere", "cone", "pyramid", "wedge", "prism", "tube",
  "hemisphere", "torus", "star", "capsule", "roof"];
// What the default seeds together must have done (a step that was skipped does not count).
const REQUIRED = ["add", "move", "moveTo", "rotate", "scale", "setHole", "hide", "duplicate", "remove", "resize", "roundtrip",
  "ungroup", "uiGroup", "undo", "redo", "group:join", "group:cut", "group:intersect", "combine:join", "combine:cut",
  "combine:intersect", "export:stl", "export:3mf", "export:step"];
const REL = 1e-3; // booleans are checked against each other with this slack; the kernel's exact volumes agree far better
const near = (a, b, rel = REL, abs = 0.01) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b));

class Fail extends Error {}
class Stall extends Fail {} // the kernel's watchdog gave up on a build (src/kernelClient.js)
const check = (ok, what) => { if (!ok) throw new Fail(what); };
// Known open problems of the kernel are noted, not failed, so a long run goes on and finds new things. Each one is
// listed in test/README.md with its smallest case, and each is excused only for the case that was shown, never wider.
// FUZZ_STRICT=1 turns them back into failures.
const findings = [];
const soft = (ok, what) => { if (ok) return; if (process.env.FUZZ_STRICT) throw new Fail(what); findings.push(what); };
const RAW_EMPTY = "[object WebAssembly.Exception]";
const NOTE_EMPTY = `a boolean that leaves nothing shows the error "${RAW_EMPTY}" instead of a message`;
const NOTE_TORUS = "a torus grouped with a shape it does not touch is missing from the group's mesh, box and exports while its volume still counts it";
const NOTE_STRETCH = 'JS3D.scale with different factors on a body the kernel rebuilds from a fine mesh (over 4000 triangles) is accepted, then the body shows "can\'t be stretched unevenly"';
const noteCurved = (kinds) => `booleans with a sphere, hemisphere, capsule or torus can disagree with each other, or give a negative volume (seen with ${kinds})`;
const NOTE_STALL = "joining several shapes that include a torus can stall the geometry engine for 25 s (\"This shape stalled the geometry engine\")";
const NOTE_CONE = "the STL of a cone is not watertight: its edges near the apex are cut differently on the two sides of the seam";
const NOTE_FLAT_CAPSULE = "a capsule flatter than it is wide (height under depth, for example 36 by 12 by 6) is built wrongly: its mesh is open and holds a third of its volume";
// Shapes the kernel's booleans get wrong in the cases we know of; every other kind (a group of them included) is strict.
const CURVED_BOOLEAN = new Set(["sphere", "hemisphere", "capsule", "torus"]);
// A stretch that is not the same shape stretched (a capsule's ends stay round, a tube's wall keeps its thickness)
const NOT_AFFINE = new Set(["capsule", "torus", "tube", "spring", "group"]);

// A fresh page for every chain, so a seed gives the same run alone as in a long series (kernel memory is not shared).
let page, errors;
test.beforeEach(async ({ browser }, info) => { page = await browser.newPage(); errors = watchErrors(page); await boot(page, info); });
test.afterEach(async () => { await page.close(); });

// ---- reading the app -----------------------------------------------------------------------------------------
// Every top-level body as the bridge reports it, plus: how many features it carries, how many separate solids it built,
// every kind of shape inside it (a group's parts and a feature's tool too) and how many triangles it is drawn with.
const snapshot = () => page.evaluate(() => {
  const kindsOf = (n, out) => {
    out.add(n.t === "prim" ? n.kind : n.t);
    if (n.kind === "capsule") { // a capsule flatter than it is wide (its stretch included) is built wrongly by the kernel (test/README.md)
      const k = (n.mods || []).filter((m) => m.t === "scale").reduce((p, m) => [p[0] * m.k[1], p[1] * m.k[2]], [1, 1]);
      if (n.p.h * k[1] < n.p.d * k[0] - 1e-9) out.add("capsule-flat");
    }
    for (const c of n.children || []) kindsOf(c.node, out);
    for (const m of n.mods || []) if (m.tool) kindsOf(m.tool, out);
    return out;
  };
  const countCones = (n) => (n.t === "prim" && n.kind === "cone" ? 1 : 0)
    + (n.children || []).reduce((c, x) => c + countCones(x.node), 0) + (n.mods || []).reduce((c, m) => c + (m.tool ? countCones(m.tool) : 0), 0);
  return JS3D.list().map((b) => {
    const v = __app.scene.views.get(b.id), node = JS3D.get(b.id).node;
    return {
      ...b, mods: (node.mods || []).length, cones: countCones(node), kinds: [...kindsOf(node, new Set())].sort(),
      solids: v && v.data ? v.data.solidCount : null, nonSolid: !!(v && v.data && v.data.hasNonSolidFaces),
      tris: v && v.data ? v.data.triangles.length / 3 : 0,
    };
  });
});
const depths = () => page.evaluate(() => ({ undo: __store.undoStack.length, redo: __store.redoStack.length }));
const ready = () => page.evaluate(() => JS3D.ready(45_000)); // a stuck kernel shows up as this timing out, not as a hang

function sameBody(a, b, what) {
  for (const k of ["id", "name", "kind", "hole", "hidden", "color"]) {
    check(a[k] === b[k], `${what}: ${a.name} ${k} ${JSON.stringify(a[k])} != ${JSON.stringify(b[k])}`);
  }
  check(a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-6), `${what}: ${a.name} moved`);
  if (a.volume === null || b.volume === null) check(a.volume === b.volume, `${what}: ${a.name} volume ${a.volume} != ${b.volume}`);
  else check(near(a.volume, b.volume, 1e-6, 1e-6), `${what}: ${a.name} volume ${a.volume} != ${b.volume}`);
  if (a.bbox && b.bbox) {
    for (const side of ["min", "max"]) {
      check(a.bbox[side].every((v, i) => v === b.bbox[side][i] || Math.abs(v - b.bbox[side][i]) < 1e-4), `${what}: ${a.name} box changed`);
    }
  }
}
function sameList(a, b, what) {
  check(a.length === b.length, `${what}: ${a.length} bodies, wanted ${b.length} (${a.map((x) => x.name)} vs ${b.map((x) => x.name)})`);
  a.forEach((x, i) => sameBody(x, b[i], what));
}

// What must hold after any step, whatever it was.
function sane(list, what) {
  for (const b of list) {
    check(!b.error, `${what}: ${b.name} has a kernel error: ${b.error}`);
    if (!b.hidden && b.volume < 0 && (b.kind === "group" || b.mods > 0) && b.kinds.some((k) => CURVED_BOOLEAN.has(k))) soft(false, noteCurved(b.kinds));
    else if (!b.hidden) {
      check(Number.isFinite(b.volume) && b.volume >= 0, `${what}: ${b.name} volume is ${b.volume}`);
      check(b.volume > 0 || b.kind === "group", `${what}: ${b.name} has no volume`);
    }
    check(b.position.every(Number.isFinite), `${what}: ${b.name} position is ${b.position}`);
    if (!b.hidden && ![...b.bbox.min, ...b.bbox.max].every(Number.isFinite)) {
      check(b.solids > 1 && b.kinds.includes("torus"), `${what}: ${b.name} box is not finite`);
      soft(false, NOTE_TORUS);
    }
  }
  check(new Set(list.map((b) => b.id)).size === list.length, `${what}: duplicate body ids`);
}

// ---- making a step ---------------------------------------------------------------------------------------------
function chooseStep(rng, cur, depth) {
  const idx = (n, pool = cur.map((_, i) => i)) => {
    const left = pool.slice(), out = [];
    while (out.length < n && left.length) out.push(left.splice(rng.int(0, left.length - 1), 1)[0]);
    return out;
  };
  const solidIdx = cur.map((b, i) => (!b.hole ? i : -1)).filter((i) => i >= 0);
  const visible = cur.map((b, i) => (!b.hidden ? i : -1)).filter((i) => i >= 0);
  const offset = () => [rng.int(-4, 4) * 2, rng.int(-4, 4) * 2, rng.int(-2, 4) * 2];
  const table = [];
  const add = (w, step) => table.push([w, step]);
  add(cur.length < 2 ? 100 : cur.length < 7 ? 26 : 4, () => {
    const kind = rng.pick(KINDS), size = { w: rng.int(6, 28), d: rng.int(6, 28), h: rng.int(6, 28) };
    if (kind === "torus") { size.w = rng.int(16, 28); size.d = size.w; size.h = rng.int(4, 8); }
    if (kind === "tube") { size.w = rng.int(10, 28); size.d = rng.int(10, 28); }
    // a capsule is long in w: with w close to d it takes the kernel 7 to 25 s and sometimes stalls it (listed in test/README.md)
    if (kind === "capsule") { size.d = rng.int(8, 14); size.h = size.d; size.w = size.d * rng.int(2, 3); }
    return { op: "add", kind, size, at: [rng.int(-3, 3) * 4, rng.int(-3, 3) * 4, rng.int(0, 2) * 4], hole: rng.chance(0.2) };
  });
  if (cur.length) {
    add(10, () => ({ op: "move", pick: idx(rng.int(1, 2)), by: offset() }));
    add(4, () => ({ op: "moveTo", pick: idx(1), to: offset() }));
    add(10, () => ({ op: "rotate", pick: idx(rng.int(1, 2)), axis: rng.pick(["x", "y", "z"]), deg: rng.pick([90, 90, 45, 30, 180, -90, 15]) }));
    add(10, () => {
      const pick = idx(1), b = cur[pick[0]];
      const small = b.volume !== null && b.volume < 60;
      const uneven = rng.chance(0.4);
      const k = uneven ? [rng.pick([1, 2]), rng.pick([1, 1.5, 2]), rng.pick([0.5, 1, 2])].map((v) => (small && v < 1 ? 1 : v))
        : (small ? 2 : rng.pick([0.5, 1.5, 2]));
      // a capsule stretched flatter than it is wide is built wrongly and can stall the kernel for 25 s (test/README.md): keep its height up
      if (Array.isArray(k) && b.kinds.includes("capsule")) k[2] = Math.max(k[2], k[1]);
      return { op: "scale", pick, k };
    });
    add(4, () => ({ op: "setHole", pick: idx(1) }));
    add(3, () => ({ op: "hide", pick: idx(1) }));
    add(8, () => ({ op: "duplicate", pick: idx(rng.int(1, 2)), by: offset() }));
    add(cur.length > 3 ? 6 : 1, () => ({ op: "remove", pick: idx(1) }));
    const plain = cur.map((b, i) => (b.kind === "box" && !b.mods && !b.hidden ? i : -1)).filter((i) => i >= 0);
    if (plain.length) add(8, () => ({ op: "resize", pick: [rng.pick(plain)], size: { w: rng.int(6, 28), d: rng.int(6, 28), h: rng.int(6, 28) } }));
  }
  if (cur.length >= 2) {
    // cut and intersect take two bodies, so an empty result can be proved empty (a join takes two or three)
    add(13, () => {
      const how = rng.pick(["join", "join", "cut", "intersect"]);
      return { op: "group", pick: idx(how === "join" && rng.chance(0.3) ? 3 : 2), how };
    });
    const shown = solidIdx.filter((i) => !cur[i].hidden);
    if (shown.length >= 2) {
      add(7, () => ({ op: "roundtrip", pick: idx(2, shown) }));
      add(9, () => ({ op: "combine", pick: idx(2, shown), how: rng.pick(["join", "cut", "intersect"]), keep: rng.chance(0.25) }));
    }
    // the Group button needs two shapes on screen
    if (visible.length >= 2) add(9, () => ({ op: "uiGroup", pick: idx(rng.chance(0.75) ? 2 : 3, visible) }));
  }
  const groups = cur.map((b, i) => (b.kind === "group" && !b.hidden ? i : -1)).filter((i) => i >= 0);
  if (groups.length) add(5, () => ({ op: "ungroup", pick: [rng.pick(groups)] }));
  if (depth.undo > 0) add(9, () => ({ op: "undo" }));
  if (depth.redo > 0) add(30, () => ({ op: "redo" })); // redo only exists right after an undo, so it is taken often when it does
  add(3, () => ({ op: "export", kind: rng.pick(["stl", "stl", "3mf", "step"]) }));
  const total = table.reduce((s, [w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [w, step] of table) { if ((r -= w) < 0) return step(); }
  return table[0][1]();
}

// ---- probes: the app compared with itself ---------------------------------------------------------------------
// A probe builds the result with the bridge's own Group, reads it and takes it back with undo, leaving no trace (the
// redo steps that were there are put back). The Group button and Combine must give the same solids as the bridge's one body.
const probe = async (ids, how) => {
  const out = await probeRaw(ids, how);
  if (/stalled the geometry engine/.test(out.error || "")) throw new Stall(`${how} of ${ids.length} bodies: ${out.error}`);
  return out;
};
const probeRaw = (ids, how) => page.evaluate(async ([ids, how]) => {
  const redo = __store.redoStack; // the probe's undo would leave its own group to "redo"
  const g = JS3D.group(ids, how === "join" ? {} : { op: how });
  await JS3D.ready(45_000);
  const b = JS3D.list().find((x) => x.id === g), v = __app.scene.views.get(g);
  const out = { volume: b.volume, error: b.error, solids: v && v.data ? v.data.solidCount : null, nonSolid: !!(v && v.data && v.data.hasNonSolidFaces) };
  JS3D.undo(); await JS3D.ready(45_000);
  __store.redoStack = redo;
  return out;
}, [ids, how]);
// The volume of everything the holes cover (U) and of holes and solids all joined as solids (all). The solids are inside the holes iff they are equal.
const probeHoleCover = (solidIds, holeIds) => page.evaluate(async ([solidIds, holeIds]) => {
  const redo = __store.redoStack;
  JS3D.setHole(holeIds, false);
  await JS3D.ready(45_000);
  const joined = async (ids) => {
    if (ids.length === 1) return JS3D.list().find((b) => b.id === ids[0]).volume;
    const g = JS3D.group(ids); await JS3D.ready(45_000);
    const v = JS3D.list().find((b) => b.id === g).volume;
    JS3D.undo(); await JS3D.ready(45_000);
    return v;
  };
  const U = await joined(holeIds), all = await joined([...solidIds, ...holeIds]);
  JS3D.undo(); await JS3D.ready(45_000);
  __store.redoStack = redo;
  return { U, all };
}, [solidIds, holeIds]);

// A boolean that leaves nothing comes back from the kernel as the raw error text, not a message (listed in test/README.md).
// Any other error is a failure, and so is that one where the result is not really empty: it has to be proved, by the
// results of other booleans of the same shapes, or the step fails.
async function twoEmptyIsReal(how, picked, ids, err) {
  check(err === RAW_EMPTY, `${how}: the kernel gave an error: ${err}`);
  check(picked.length === 2 && picked.every((b) => b.volume !== null && !b.hole), `${how} left nothing, and that cannot be checked for these bodies`);
  const [a, b] = picked;
  if (how === "intersect") {
    const u = await probe(ids, "join");
    check(!u.error && near(u.volume, a.volume + b.volume, REL, 0.05), `intersect failed with a kernel error although the shapes overlap (join ${u.volume}, apart ${a.volume + b.volume})`);
  } else {
    const i = await probe(ids, "intersect");
    check(!i.error && near(i.volume, a.volume, REL, 0.05), `cut failed with a kernel error although the first shape is not swallowed (overlap ${i.volume} of ${a.volume})`);
  }
  soft(false, NOTE_EMPTY);
}
async function holeCutEmptyIsReal(solidIds, holeIds, err) {
  check(err === RAW_EMPTY, `Group with holes: the kernel gave an error: ${err}`);
  const { U, all } = await probeHoleCover(solidIds, holeIds);
  check(near(all, U, REL, 0.05), `Group with holes failed with a kernel error although the holes (${U}) do not cover the shapes (${all} together)`);
  soft(false, NOTE_EMPTY);
}

// ---- running a step and checking it ---------------------------------------------------------------------------
async function runStep(step, cur, log = []) {
  const ids = (step.pick || []).map((i) => cur[i].id);
  const picked = (step.pick || []).map((i) => cur[i]);
  const before = await depths();
  let want = before.undo + 1, wantRedo = 0; // each edit is one undo step and ends the redo steps
  let after, extra = {};
  const untouched = (list, changed, what) => {
    for (const b of cur.filter((x) => !changed.includes(x.id))) {
      const now = list.find((x) => x.id === b.id);
      check(now, `${what}: ${b.name} vanished`);
      sameBody(now, b, what);
    }
  };
  const skip = (why) => ({ after: cur, skipped: why });
  switch (step.op) {
    case "add": {
      const id = await page.evaluate(({ kind, size, at, hole }) => JS3D.add(kind, { size, at, hole }), step);
      await ready(); after = await snapshot();
      check(after.length === cur.length + 1, `add: ${after.length} bodies, wanted ${cur.length + 1}`);
      untouched(after, [id], "add");
      const b = after.find((x) => x.id === id), { w, d, h } = step.size;
      check(b && b.kind === step.kind && b.hole === step.hole, "add: the new body is not what was asked for");
      const exact = { box: w * d * h, cylinder: Math.PI / 4 * w * d * h, sphere: Math.PI / 6 * w * d * h, cone: Math.PI / 12 * w * d * h }[step.kind];
      if (exact) check(near(b.volume, exact), `add ${step.kind} ${w}x${d}x${h}: volume ${b.volume}, wanted ${exact}`);
      break;
    }
    case "move": case "moveTo": {
      if (step.op === "move") await page.evaluate(([ids, by]) => JS3D.move(ids, by), [ids, step.by]);
      else await page.evaluate(([id, to]) => JS3D.moveTo(id, to), [ids[0], step.to]);
      await ready(); after = await snapshot();
      check(after.length === cur.length, `${step.op}: body count changed`);
      untouched(after, ids, step.op);
      for (const b of picked) {
        const a = after.find((x) => x.id === b.id);
        check(near(a.volume, b.volume, 1e-5, 1e-5), `${step.op}: volume ${b.volume} -> ${a.volume}`);
        const d = step.op === "move" ? step.by : step.to.map((v, i) => v - b.position[i]);
        if (a.bbox && b.bbox && b.bbox.min.every(Number.isFinite)) {
          check(a.bbox.min.every((v, i) => Math.abs(v - b.bbox.min[i] - d[i]) < 1e-3), `${step.op}: box did not move by ${d} (${b.bbox.min} -> ${a.bbox.min})`);
        }
      }
      break;
    }
    case "rotate": case "scale": case "setHole": case "hide": case "resize": {
      if (step.op === "rotate") await page.evaluate(([ids, axis, deg]) => JS3D.rotate(ids, axis, deg), [ids, step.axis, step.deg]);
      if (step.op === "scale") await page.evaluate(([ids, k]) => JS3D.scale(ids, k), [ids, step.k]);
      if (step.op === "setHole") await page.evaluate(([ids, flip]) => JS3D.setHole(ids, flip), [ids, !picked[0].hole]);
      if (step.op === "hide") await page.evaluate(([ids, hide]) => JS3D.setHidden(ids, hide), [ids, !picked[0].hidden]);
      if (step.op === "resize") await page.evaluate(([id, size]) => JS3D.resize(id, size), [ids[0], step.size]);
      await ready(); after = await snapshot();
      const stretched = after.filter((b) => ids.includes(b.id) && /can't be stretched unevenly/.test(b.error || ""));
      if (step.op === "scale" && stretched.length) {
        // The call went through and the body then failed to build. Excused only for what is known (see stretchExcused);
        // the way out is undo, and it must work.
        for (const b of stretched) {
          const was = picked.find((p) => p.id === b.id);
          check(stretchExcused(step.k, was), `scale ${JSON.stringify(step.k)}: ${b.name} says it can't be stretched unevenly, but it is not a body
            the kernel rebuilds from a fine mesh (${was.kind}, ${was.mods} features, ${was.tris} triangles)`);
        }
        soft(false, NOTE_STRETCH);
        await page.evaluate(() => { JS3D.undo(); __store.redoStack = []; });
        await ready(); sameList(await snapshot(), cur, "undo after a failed stretch");
        return { ...skip("stretch failed, undone"), clearedRedo: true };
      }
      check(after.length === cur.length, `${step.op}: body count changed`);
      untouched(after, ids, step.op);
      for (const b of picked) {
        const a = after.find((x) => x.id === b.id);
        if (b.volume === null || a.volume === null) continue; // a hidden shape is not built
        const uniform = !Array.isArray(step.k) || step.k.every((v) => v === step.k[0]);
        if (step.op === "scale" && !uniform && b.kinds.some((k) => NOT_AFFINE.has(k))) continue;
        const factor = step.op !== "scale" ? 1 : Array.isArray(step.k) ? step.k.reduce((p, v) => p * v, 1) : step.k ** 3;
        const wantV = step.op === "resize" ? step.size.w * step.size.d * step.size.h : b.volume * factor;
        check(near(a.volume, wantV, 2e-3, 1e-3), `${step.op}: volume ${b.volume} -> ${a.volume}, wanted ${wantV}`);
        if (step.op === "setHole") check(a.hole !== b.hole, "setHole: flag did not flip");
        if (step.op === "hide") check(a.hidden !== b.hidden, "hide: flag did not flip");
      }
      break;
    }
    case "duplicate": {
      const made = await page.evaluate(([ids, by]) => JS3D.duplicate(ids, by), [ids, step.by]);
      await ready(); after = await snapshot();
      check(made.length === ids.length && after.length === cur.length + ids.length, `duplicate: ${after.length} bodies, wanted ${cur.length + ids.length}`);
      untouched(after, [], "duplicate");
      made.forEach((id, i) => {
        const a = after.find((x) => x.id === id), b = picked[i];
        check(a && a.kind === b.kind && a.hole === b.hole && near(a.volume ?? 0, b.volume ?? 0, 1e-5, 1e-5), `duplicate: copy of ${b.name} differs (${a && a.volume} vs ${b.volume})`);
      });
      break;
    }
    case "remove": {
      const n = await page.evaluate((ids) => JS3D.remove(ids), ids);
      await ready(); after = await snapshot();
      check(n === ids.length && after.length === cur.length - ids.length, `remove: ${after.length} bodies left, wanted ${cur.length - ids.length}`);
      untouched(after, ids, "remove");
      break;
    }
    case "group": {
      const holes = picked.filter((b) => b.hole).length;
      // cut / intersect with a hole shape in the pick is not a defined combination; a hidden one is joined like any other
      if (holes || picked.some((b) => b.hidden)) step.how = "join";
      const how = step.how, sumSolids = picked.filter((b) => !b.hole).reduce((s, b) => s + (b.volume ?? 0), 0);
      const exact = picked.length === 2 && !holes && picked.every((b) => b.volume !== null);
      const strict = !picked.some((b) => b.kinds.some((k) => CURVED_BOOLEAN.has(k)));
      const kindsText = picked.map((b) => b.kinds.join("+")).join(" and ");
      const fits = (ok, what) => (strict ? check : soft)(ok, `${what} (${kindsText}${strict ? "" : "; " + noteCurved(kindsText)}; steps ${JSON.stringify(log.slice(-3))})`);
      if (holes && picked.length > holes) { // a hole that covers the shapes leaves nothing: proved, then the step is skipped
        const full = await probe(ids, "join");
        sameList(await snapshot(), cur, "probe undo");
        if (full.error) {
          await holeCutEmptyIsReal(picked.filter((b) => !b.hole).map((b) => b.id), picked.filter((b) => b.hole).map((b) => b.id), full.error);
          return skip("holes cover the shapes");
        }
      }
      if (exact) {
        // Join, intersect and both cuts of the same two shapes must fit together; each is measured on its own.
        const [a, b] = picked;
        const J = await probe(ids, "join"), I = await probe(ids, "intersect"), C = await probe(ids, "cut"), C2 = await probe([ids[1], ids[0]], "cut");
        check(!J.error, `join of ${kindsText} failed with a kernel error: ${J.error}`);
        if (I.error) { await twoEmptyIsReal("intersect", picked, ids, I.error); I.volume = 0; }
        if (C.error) { await twoEmptyIsReal("cut", picked, ids, C.error); C.volume = 0; }
        if (C2.error) { await twoEmptyIsReal("cut", [b, a], [ids[1], ids[0]], C2.error); C2.volume = 0; }
        sameList(await snapshot(), cur, "probe undo");
        fits(near(J.volume + I.volume, a.volume + b.volume, REL, 0.05), `join ${J.volume} + intersect ${I.volume} is not the two parts ${a.volume} + ${b.volume}`);
        fits(near(C.volume, J.volume - b.volume, REL, 0.05), `cut ${C.volume} is not join ${J.volume} minus the cutter ${b.volume}`);
        fits(near(C2.volume, J.volume - a.volume, REL, 0.05), `reverse cut ${C2.volume} is not join ${J.volume} minus the first part ${a.volume}`);
        if ((how === "intersect" && I.error) || (how === "cut" && C.error)) return skip("empty result");
      } else if (how !== "join") {
        // two bodies are always the exact case (no holes, built); a hidden pick was made a join above
        const direct = await probe(ids, how);
        sameList(await snapshot(), cur, "probe undo");
        if (direct.error) { await twoEmptyIsReal(how, picked, ids, direct.error); return skip("empty result"); }
      }
      const id = await page.evaluate(([ids, how]) => JS3D.group(ids, how === "join" ? {} : { op: how }), [ids, how]);
      await ready(); after = await snapshot();
      check(after.length === cur.length - ids.length + 1, `group: ${after.length} bodies, wanted ${cur.length - ids.length + 1}`);
      untouched(after, ids, "group");
      const g = after.find((x) => x.id === id);
      check(g && g.kind === "group" && g.children === ids.length, "group: result is not a group of the picked bodies");
      if (!g.hole && !g.hidden && picked.every((b) => b.volume !== null)) {
        fits(g.volume <= sumSolids * (1 + REL) + 0.01, `group ${how}: volume ${g.volume} is more than its parts add up to (${sumSolids})`);
        if (how === "join" && !holes) fits(g.volume >= Math.max(...picked.map((b) => b.volume)) * (1 - REL) - 0.01, `group join: volume ${g.volume} is less than its biggest part`);
        if (how === "intersect") fits(g.volume <= Math.min(...picked.map((b) => b.volume)) * (1 + REL) + 0.01, `group intersect: volume ${g.volume} is more than its smallest part`);
        if (how === "cut") fits(g.volume <= picked[0].volume * (1 + REL) + 0.01, `group cut: volume ${g.volume} is more than the part it cuts`);
      }
      break;
    }
    case "roundtrip": {
      // group two solids, split them again: the same shapes come back, in the same places
      const id = await page.evaluate((ids) => JS3D.group(ids), ids);
      await ready(); const mid = await snapshot();
      const back = await page.evaluate((id) => JS3D.ungroup(id), id);
      await ready(); after = await snapshot();
      want = before.undo + 2; // two edits
      extra = { mid };
      check(back.length === 2 && after.length === cur.length, `group then ungroup: ${after.length} bodies, wanted ${cur.length}`);
      untouched(after, ids, "group then ungroup");
      for (const b of picked) {
        const a = after.find((x) => x.kind === b.kind && x.hole === b.hole && x.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-6) && near(x.volume, b.volume, 1e-5, 1e-5));
        check(a, `group then ungroup: ${b.name} did not come back`);
      }
      break;
    }
    case "ungroup": {
      const kids = picked[0].children;
      const r = await page.evaluate(async (id) => { try { return { ids: JS3D.ungroup(id) }; } catch (e) { return { threw: e.message }; } }, ids[0]);
      await ready(); after = await snapshot();
      if (r.threw) {
        check(/features|stretched at an angle/.test(r.threw), `ungroup: unexpected error "${r.threw}"`);
        sameList(after, cur, "refused ungroup");
        return skip("ungroup refused: " + r.threw);
      }
      check(r.ids.length === kids && after.length === cur.length - 1 + kids, `ungroup: ${after.length} bodies, wanted ${cur.length - 1 + kids}`);
      untouched(after, ids, "ungroup");
      break;
    }
    case "undo": case "redo": {
      const label = await page.evaluate((op) => JS3D[op](), step.op);
      await ready(); after = await snapshot();
      check(label, `${step.op}: nothing to ${step.op}, but the app says there is`);
      return { after, undoRedo: step.op };
    }
    case "uiGroup": {
      // the Group button (Beginner): pieces are separate bodies only when holes cut a solid in two
      const solids = picked.filter((b) => !b.hole), holes = picked.filter((b) => b.hole);
      let wantBodies = 1, wantVolume = null;
      if (holes.length && solids.length) {
        const baselineSolids = solids.length === 1 ? solids[0].solids : (await probe(solids.map((b) => b.id), "join")).solids;
        const full = await probe(ids, "join");
        sameList(await snapshot(), cur, "probe undo");
        if (full.error) {
          await holeCutEmptyIsReal(solids.map((b) => b.id), holes.map((b) => b.id), full.error);
          return skip("holes cover the shapes");
        }
        if (!full.nonSolid && full.solids > baselineSolids) wantBodies = full.solids;
        wantVolume = full.volume;
      } else if (solids.length) {
        const full = await probe(ids, "join");
        sameList(await snapshot(), cur, "probe undo");
        check(!full.error, `Group of ${solids.length} shapes without holes failed with a kernel error: ${full.error}`);
        wantVolume = full.volume;
      }
      await page.evaluate((ids) => JS3D.select(ids), ids);
      await page.click("#bb-group");
      await ready(); after = await snapshot();
      await page.evaluate(() => JS3D.select([]));
      const wantCount = cur.length - ids.length + wantBodies;
      check(after.length === wantCount, `Group button on ${picked.map((b) => b.name)}: ${after.length} bodies, wanted ${wantCount} (${wantBodies} pieces)`);
      const made = after.filter((b) => !cur.some((c) => c.id === b.id));
      check(made.length === wantBodies, `Group button: ${made.length} new bodies, wanted ${wantBodies}`);
      untouched(after, ids, "Group button");
      const sum = made.reduce((s, b) => s + b.volume, 0);
      if (wantVolume !== null && !made[0].hole) check(near(sum, wantVolume, REL, 0.05), `Group button: pieces add up to ${sum}, the bridge's group gives ${wantVolume}`);
      break;
    }
    case "combine": {
      // Advanced Combine: the target keeps its identity. Cut and intersect leave separate bodies only when the target was
      // one solid and the result is several (src/combinesplit.js); a target that already is several solids stays whole.
      const [t, tool] = picked;
      const res = await probe(ids, step.how);
      sameList(await snapshot(), cur, "probe undo");
      if (res.error) { await twoEmptyIsReal(step.how, picked, ids, res.error); return skip("empty result"); }
      const wantBodies = step.how !== "join" && t.solids === 1 && !t.nonSolid && !res.nonSolid && res.solids > 1 ? res.solids : 1;
      await page.evaluate((ids) => { JS3D.setMode("advanced"); JS3D.select(ids); }, ids);
      await page.click("#ad-advmod"); await page.click("#ad-combine");
      await page.locator("#cb-op").getByRole("button", { name: { join: "Join", cut: "Cut", intersect: "Intersect" }[step.how], exact: true }).click();
      if (step.keep) await page.check("#cb-keep");
      await page.click("#cmd-ok");
      await ready();
      await page.evaluate(() => { JS3D.select([]); JS3D.setMode("beginner"); });
      await ready(); after = await snapshot();
      const wantCount = cur.length - 1 - (step.keep ? 0 : 1) + wantBodies;
      check(after.length === wantCount, `Combine ${step.how}${step.keep ? " (keep tools)" : ""}: ${after.length} bodies, wanted ${wantCount} (${wantBodies} pieces)`);
      if (step.keep) check(after.some((b) => b.id === tool.id), "Combine keep tools: the tool is gone");
      else check(!after.some((b) => b.id === tool.id), "Combine: the tool body is still there");
      const pieces = after.filter((b) => !cur.some((c) => c.id === b.id) || b.id === t.id);
      check(pieces.length === wantBodies, `Combine: ${pieces.length} result bodies, wanted ${wantBodies}`);
      const sum = pieces.reduce((s, b) => s + b.volume, 0);
      check(near(sum, res.volume, REL, 0.05), `Combine ${step.how}: result ${sum}, the bridge's group gives ${res.volume}`);
      untouched(after, [t.id, tool.id], "Combine");
      break;
    }
    case "export": {
      after = cur; want = before.undo; wantRedo = before.redo; // an export changes nothing, the redo steps included
      await exportCheck(step.kind, cur.filter((b) => !b.hole && !b.hidden));
      sameList(await snapshot(), cur, "export");
      break;
    }
    default: throw new Fail("unknown step " + JSON.stringify(step));
  }
  const d = await depths();
  check(d.undo === want && d.redo === wantRedo, `${step.op}: undo stack is ${d.undo} deep, redo ${d.redo}; wanted ${want} and ${wantRedo}`);
  return { after, ...extra };
}

// STL / 3MF / STEP of everything shown. `solids` are the top-level bodies that should be in it.
const exported = (kind, ids) => page.evaluate(async ([kind, ids]) => {
  try { return { b64: (await JS3D.invoke("export", ids ? [kind, { ids }] : [kind]))["$bytes"] }; } catch (e) { return { threw: e.message }; }
}, [kind, ids]);

async function exportCheck(kind, solids) {
  const r = await exported(kind, null);
  if (!solids.length) { check(r.threw && /nothing to export/.test(r.threw), `${kind} of nothing: ${r.threw || "it produced a file"}`); return; }
  check(!r.threw, `${kind} export failed: ${r.threw}`);
  const bytes = Buffer.from(r.b64, "base64");
  check(bytes.length > 200, `${kind} export is only ${bytes.length} bytes`);
  if (kind === "step") {
    // every solid of every body is one solid entity (a body of several separate solids gives several)
    // (a torus lost from a body's mesh is lost from its STEP as well; such a body still gives at least one)
    const lost = (b) => b.solids > 1 && b.kinds.includes("torus");
    const want = solids.reduce((s, b) => s + b.solids, 0), least = solids.reduce((s, b) => s + (lost(b) ? 1 : b.solids), 0);
    const got = readStep(bytes).solids;
    check(got <= want && got >= least, `STEP has ${got} solids; the ${solids.length} bodies are ${want} solids`);
    if (got < want) soft(false, NOTE_TORUS);
    return;
  }
  // Each body alone is checked against the kernel's exact volume; the whole export must then be those bodies and no others.
  const each = [];
  for (const b of solids) {
    const one = await exported("stl", [b.id]);
    check(!one.threw, `STL of ${b.name} failed: ${one.threw}`);
    const rep = meshReport(readStl(Buffer.from(one.b64, "base64")));
    check(rep.triangles > 0, `STL of ${b.name} has no triangles`);
    const flat = b.kinds.includes("capsule-flat"), flawed = (b.kind === "group" || b.mods > 0) && b.kinds.some((k) => CURVED_BOOLEAN.has(k));
    if (rep.open) {
      const coneOnly = coneOpenExcused(rep.open, b.cones);
      const why = flat ? NOTE_FLAT_CAPSULE : coneOnly ? NOTE_CONE : flawed ? noteCurved(b.kinds) : null;
      check(why, `STL of ${b.name} (${b.kinds}, ${b.cones} cones) is not closed: ${rep.open} edges have no partner`);
      soft(false, why);
    }
    if (!meshMatches(rep.volume, b.volume, b.kinds)) {
      const why = lostTorusExcused(b, rep.volume) ? NOTE_TORUS : flat ? NOTE_FLAT_CAPSULE : flawed ? noteCurved(b.kinds) : null;
      check(why, `STL of ${b.name} (${b.kinds}) encloses ${rep.volume.toFixed(3)} mm3, the kernel says ${b.volume} (${b.solids} solids)`);
      soft(false, why);
    } else check(rep.volume > 0, `STL of ${b.name} has volume ${rep.volume}: the faces point inward`);
    each.push(rep);
  }
  const triangles = each.reduce((n, x) => n + x.triangles, 0), volume = each.reduce((n, x) => n + x.volume, 0);
  if (kind === "stl") {
    const rep = meshReport(readStl(bytes));
    check(rep.open === each.reduce((n, x) => n + x.open, 0), `STL has ${rep.open} edges with no partner; the bodies alone have ${each.reduce((n, x) => n + x.open, 0)}`);
    check(rep.triangles === triangles && near(rep.volume, volume, 1e-4, 0.05),
      `STL has ${rep.triangles} triangles enclosing ${rep.volume.toFixed(3)}; the bodies alone give ${triangles} and ${volume.toFixed(3)}`);
    return;
  }
  // 3MF: welding drops the few triangles that collapse to a line, so the counts differ a little.
  // Every body must be one build item pointing at its own mesh.
  const m = readThreeMf(bytes), tris = m.items.reduce((n, x) => n + x.mesh.triangles, 0);
  check(m.items.length === solids.length, `3MF builds ${m.items.length} items for ${solids.length} bodies`);
  check(new Set(m.items.map((x) => x.objectid)).size === m.items.length, `3MF builds the same object twice: ${m.items.map((x) => x.objectid)}`);
  check(m.objects.size === m.items.length, `3MF has ${m.objects.size} objects and ${m.items.length} build items`);
  m.items.forEach((x) => {
    // an object is excused from being closed only when it is a body whose own STL is open (the known cone seam and the like)
    const knownOpen = each.some((e) => e.open > 0 && near(x.placed, e.volume, 2e-3, 0.05));
    if (!knownOpen) check(x.mesh.open === 0, `3MF object ${x.objectid} is not closed: ${x.mesh.open} edges have no partner`);
    check(x.placed > 0 || each.some((e) => e.volume <= 0), `3MF object ${x.objectid} placed with volume ${x.placed}`);
  });
  check(near(tris, triangles, 0.02, 2), `3MF has ${tris} triangles; the STL has ${triangles}`);
  const got = m.items.map((x) => x.placed).sort((p, q) => p - q), wantV = each.map((x) => x.volume).sort((p, q) => p - q);
  check(got.every((v, i) => near(v, wantV[i], 2e-3, 0.05)), `3MF volumes ${got.map((v) => v.toFixed(2))} differ from the bodies' STL volumes ${wantV.map((v) => v.toFixed(2))}`);
}

// ---- the chains --------------------------------------------------------------------------------------------------
const covered = new Set(), seedsDone = new Set();
function noteFindings() {
  for (const f of new Set(findings)) { console.log("fuzz finding: " + f); test.info().annotations.push({ type: "fuzz finding", description: f }); }
}

for (const seed of SEEDS) {
  test(`fuzz seed ${seed}: ${OPS} random steps keep the design sound`, async () => {
    test.setTimeout(Math.max(120_000, OPS * 15_000));
    const info = test.info(), rng = makeRng(seed), log = [];
    findings.length = 0;
    if (seed === SEEDS[0]) { covered.clear(); seedsDone.clear(); } // coverage is counted per build
    // the steps are on record before each one runs, so a timeout or a crash still shows what led to it
    const record = { type: "fuzz steps", description: "" };
    info.annotations.push(record);
    const show = (n, s) => {
      record.description = log.map((x, i) => `${i + 1}. ${JSON.stringify(x)}`).join("\n");
      if (SEEDS.length <= 4) console.log(`fuzz seed ${seed} step ${n}: ${JSON.stringify(s)}`);
    };
    await loadDoc(page, newDoc("Fuzz " + seed, "beginner"));
    await page.evaluate(() => JS3D.setMode("beginner"));
    let before = null;
    const ran = new Set();
    let cur = [], hist = [[]], ptr = 0; // what the design looked like after each undo step, so undo and redo can be checked
    const replay = () => replayCommand({ seed, ops: OPS, strict: !!process.env.FUZZ_STRICT, project: info.project.name });
    const hint = () => `\n${replay()}\nsteps so far:\n${log.map((s, i) => `  ${i + 1}. ${JSON.stringify(s)}`).join("\n")}`;
    try {
      for (let n = 1; n <= OPS; n++) {
        const dBefore = await depths();
        before = await page.evaluate(() => JSON.stringify(JS3D.save()));
        const step = chooseStep(rng, cur, dBefore);
        log.push(step); show(n, step);
        let result;
        try { result = await runStep(step, cur, log); } catch (e) {
          // a stall is excused only where it was seen: a build that involves a torus (the probe has already undone itself)
          if (!(e instanceof Stall && (step.pick || []).some((i) => cur[i].kinds.includes("torus")))) throw e;
          soft(false, NOTE_STALL);
          result = { after: cur, skipped: "kernel stalled" };
        }
        const { after, undoRedo, mid, skipped, clearedRedo } = result;
        if (skipped) { // the step did nothing, so the design must be exactly as it was
          sameList(await snapshot(), cur, "a refused step changed the design");
          const d = await depths();
          check(d.undo === ptr && d.redo === (clearedRedo ? 0 : dBefore.redo), `a refused step left undo ${d.undo} / redo ${d.redo}, wanted ${ptr} / ${clearedRedo ? 0 : dBefore.redo}`);
          if (clearedRedo) hist = hist.slice(0, ptr + 1);
          log[log.length - 1] = { ...step, skipped };
          show(n, log[log.length - 1]);
          continue;
        }
        sane(after, `step ${n} (${step.op})`);
        const d = await depths();
        if (undoRedo) {
          ptr += undoRedo === "undo" ? -1 : 1;
          sameList(after, hist[ptr], `${undoRedo} did not return to the earlier design`);
          const wantRedo = dBefore.redo + (undoRedo === "undo" ? 1 : -1);
          check(d.undo === ptr && d.redo === wantRedo, `${undoRedo}: undo ${d.undo} / redo ${d.redo}, wanted ${ptr} / ${wantRedo}`);
        } else if (step.op !== "export") {
          hist = hist.slice(0, ptr + 1); ptr = d.undo; hist[ptr] = after; if (mid) hist[ptr - 1] = mid; // group-then-ungroup is two undo steps
        }
        const label = step.op + (step.how ? ":" + step.how : "") + (step.op === "export" ? ":" + step.kind : "");
        covered.add(label); ran.add(label);
        expect(errors, "page errors").toEqual([]);
        cur = after;
      }
      // the end: every kind of export of what is on screen, then all the way back and forward again
      log.push({ op: "final exports" });
      const solids = cur.filter((b) => !b.hole && !b.hidden);
      for (const kind of ["stl", "3mf", "step"]) await exportCheck(kind, solids);
      sameList(await snapshot(), cur, "export left the design changed");
      log.push({ op: "undo all, redo all" });
      let steps = 0;
      while (await page.evaluate(() => JS3D.undo())) {
        steps++; await ready(); ptr--;
        if (hist[ptr]) sameList(await snapshot(), hist[ptr], "undo all");
        if (steps > 200) throw new Fail("undo never ends");
      }
      sameList(await snapshot(), [], "undo all the way did not give the empty design");
      while (await page.evaluate(() => JS3D.redo())) { await ready(); ptr++; if (hist[ptr]) sameList(await snapshot(), hist[ptr], "redo all"); }
      sameList(await snapshot(), hist[hist.length - 1], "redo all the way did not give the design the chain ended on");
      expect(errors, "page errors").toEqual([]);
      console.log(`fuzz seed ${seed} ran: ${[...ran].sort().join(" ")}`);
      noteFindings();
      // the default seeds were picked to reach every kind of step; if a change to the steps loses one, say so
      seedsDone.add(seed);
      // (only when every default seed ran in this run: -g, --last-failed or an earlier failure leave some out)
      if (!CUSTOM && SEEDS.every((x) => seedsDone.has(x))) {
        const missing = REQUIRED.filter((x) => !covered.has(x));
        check(!missing.length, `the default seeds never ran: ${missing.join(", ")} (pick other default seeds, see test/README.md)`);
      }
    } catch (e) {
      noteFindings();
      if (before) { // the design as it was before the step that failed: load it to try that step by hand
        const file = info.outputPath("design-before-the-last-step.json");
        writeFileSync(file, before);
        await info.attach("design-before-the-last-step.json", { path: file, contentType: "application/json" });
      }
      e.message = `${e.message}\n${hint()}`;
      throw e;
    }
  });
}

// ---- controls --------------------------------------------------------------------------------------------------
// The checks above are only worth something if they fail on the cases they were written for. Each control runs a check on
// a small design where the right answer is known, in both directions.
if (!CUSTOM) {
  test("fuzz controls: the checks pass what is right and fail what is wrong", async () => {
    test.setTimeout(240_000);
    findings.length = 0;
    const fresh = async (name) => { await loadDoc(page, newDoc(name, "beginner")); await page.evaluate(() => JS3D.setMode("beginner")); };
    const add = (kind, size, at, hole = false) => page.evaluate(([k, sz, a, h]) => JS3D.add(k, { size: sz, at: a, hole: h }), [kind, size, at, hole]);
    const settled = async () => { await ready(); return snapshot(); };
    const fails = async (run, re) => {
      let message = null;
      try { await run(); } catch (e) { message = e.message; }
      check(message !== null && re.test(message), `wanted a failure matching ${re}, got ${message === null ? "none" : message}`);
    };
    const strictly = async (run) => { process.env.FUZZ_STRICT = "1"; try { await run(); } finally { delete process.env.FUZZ_STRICT; } };

    // Combine: a target that is already two separate solids stays one body when a cut makes four
    await fresh("control combine");
    const a = await add("box", [10, 10, 10], [-30, 0, 0]), b = await add("box", [10, 10, 10], [30, 0, 0]);
    await ready();
    const pair = await page.evaluate(([a, b]) => JS3D.group([a, b]), [a, b]);
    await add("box", [100, 4, 20], [0, 0, 0]);
    let cur = await settled();
    check(cur[0].id === pair && cur[0].solids === 2, "control: the two boxes should be one body of two solids");
    const cut = await runStep({ op: "combine", pick: [0, 1], how: "cut", keep: false }, cur);
    check(cut.after.length === 1 && cut.after[0].solids === 4, `control: the cut should give one body of four solids, got ${cut.after.length} bodies`);

    // Export after undo leaves the redo step alone
    await fresh("control export");
    await add("box", [10, 10, 10], [0, 0, 0]); await add("box", [10, 10, 10], [20, 0, 0]);
    await ready(); await page.evaluate(() => JS3D.undo());
    cur = await settled();
    check((await depths()).redo === 1, "control: one redo step expected");
    await runStep({ op: "export", kind: "stl" }, cur);
    check((await depths()).redo === 1, "control: the export dropped the redo step");

    // The step chooser never offers the Group button with fewer than two shapes on screen
    const shape = (hidden) => ({ hole: false, hidden, volume: 100, mods: 0, kind: "box", kinds: ["box"], solids: 1, children: 0 });
    let offered = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const cur of [[shape(false), shape(true)], [shape(true), shape(true), shape(false)]]) {
        const s = chooseStep(makeRng(seed), cur, { undo: 2, redo: 0 });
        check(s.op !== "uiGroup", `control: Group button offered with one shape on screen (seed ${seed}, pick ${s.pick})`);
      }
      if (chooseStep(makeRng(seed), [shape(false), shape(false), shape(false)], { undo: 2, redo: 0 }).op === "uiGroup") offered++;
    }
    check(offered > 0, "control: the Group button is never offered even with three shapes on screen");

    // A capsule is never stretched flatter, and a negative volume is excused only for a boolean result
    const capsule = { hole: false, hidden: false, volume: 100, mods: 0, kind: "capsule", kinds: ["capsule"], solids: 1, children: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const st = chooseStep(makeRng(seed), [capsule, capsule], { undo: 0, redo: 0 });
      if (st.op === "scale" && Array.isArray(st.k)) check(st.k[2] >= st.k[1], `control: a capsule is stretched flat by ${st.k} (seed ${seed})`);
    }
    const body = { name: "T", id: "t", hole: false, hidden: false, volume: -5, kind: "torus", mods: 0, kinds: ["torus"], solids: 1, position: [0, 0, 0], bbox: { min: [0, 0, 0], max: [1, 1, 1] } };
    await fails(async () => sane([body], "control"), /volume is -5/);
    findings.length = 0;
    sane([{ ...body, kind: "group", kinds: ["group", "torus", "box"] }], "control");
    check(findings.some((f) => /torus/.test(f)), "control: a negative volume of a boolean with a torus was not noticed");

    // Booleans must fit together: join + overlap = both parts. The two-sphere intersect is wrong in the kernel (it gives a
    // whole sphere): noted for spheres, and a failure when strict. Boxes with a known overlap pass in strict mode.
    await fresh("control spheres");
    await add("sphere", [20, 20, 20], [0, 0, 0]); await add("sphere", [20, 20, 20], [6, 0, 0]);
    cur = await settled();
    await strictly(() => fails(() => runStep({ op: "group", pick: [0, 1], how: "intersect" }, cur), /join .* \+ intersect .* is not the two parts/));
    check((await snapshot()).length === 2, "control: the failed check left the design changed");
    findings.length = 0;
    await runStep({ op: "group", pick: [0, 1], how: "intersect" }, cur);
    check(findings.some((f) => /sphere, hemisphere, capsule or torus/.test(f)), "control: two spheres' wrong intersect was not noticed");
    await fresh("control boxes");
    await add("box", [20, 20, 20], [0, 0, 0]); await add("box", [20, 20, 20], [10, 0, 0]);
    cur = await settled();
    await strictly(async () => {
      const r = await runStep({ op: "group", pick: [0, 1], how: "intersect" }, cur);
      check(near(r.after[0].volume, 4000, 1e-6, 1e-6), `control: two boxes overlapping by 10 should intersect in 4000, got ${r.after[0].volume}`);
    });

    // STEP of a solid with an enclosed cavity is one BREP_WITH_VOIDS
    await fresh("control cavity");
    await add("box", [20, 20, 20], [0, 0, 0]); await add("box", [10, 10, 10], [0, 0, 5], true);
    await ready();
    await page.evaluate(() => { const [x, y] = JS3D.list().map((b) => b.id); JS3D.group([x, y]); });
    cur = await settled();
    check(cur.length === 1 && cur[0].solids === 1 && near(cur[0].volume, 7000, 1e-6, 0.01), `control: a box with a cavity should be one 7000 mm3 solid, got ${cur.map((c) => c.volume)}`);
    await exportCheck("step", cur);

    // A torus in a group with something it does not touch is lost from the mesh: noted, and a failure when strict
    await fresh("control torus");
    await add("torus", [20, 20, 10], [-30, 0, 0]); await add("box", [20, 20, 10], [30, 0, 0]);
    await ready();
    await page.evaluate(() => { const [x, y] = JS3D.list().map((b) => b.id); JS3D.group([x, y]); });
    cur = await settled();
    findings.length = 0;
    await exportCheck("stl", cur);
    check(findings.some((f) => /torus/.test(f)), "control: the missing torus was not noticed");
    await strictly(() => fails(() => exportCheck("stl", cur), /torus grouped/));

    // A hole that does not cover the shape cannot excuse the raw empty-result error; one that does, can
    await fresh("control holes");
    await add("box", [10, 10, 10], [0, 0, 0]); await add("box", [10, 10, 10], [50, 0, 0], true); await add("box", [40, 40, 40], [0, 0, -10], true);
    cur = await settled();
    const [solid, apart, covering] = cur.map((x) => x.id);
    await fails(() => holeCutEmptyIsReal([solid], [apart], RAW_EMPTY), /do not cover/);
    findings.length = 0;
    await holeCutEmptyIsReal([solid], [covering], RAW_EMPTY);
    await fails(() => holeCutEmptyIsReal([solid], [covering], "memory access out of bounds"), /the kernel gave an error/);
    const swallowed = await runStep({ op: "uiGroup", pick: [0, 2] }, cur);
    check(swallowed.skipped, "control: a hole covering the shape should leave nothing, and the step should be skipped");
    // two shapes that do overlap: the same error would be a lie
    await fresh("control overlap");
    await add("box", [20, 20, 20], [0, 0, 0]); await add("box", [20, 20, 20], [10, 0, 0]);
    cur = await settled();
    await fails(() => twoEmptyIsReal("intersect", cur, cur.map((c) => c.id), RAW_EMPTY), /although the shapes overlap/);
    await fails(() => twoEmptyIsReal("cut", cur, cur.map((c) => c.id), RAW_EMPTY), /not swallowed/);
  });
}
