// Agents as users: random but repeatable chains of edits through the JS3D bridge, with the facts that must hold
// after every step checked. A chain is fully decided by its seed, so a failure prints the seed and the steps and
// `FUZZ_SEED=<n> npx playwright test test/fuzz.spec.mjs` replays it. See test/README.md ("The fuzzer").
//   default:         3 fixed seeds, 14 steps each (both builds, under a minute each)
//   FUZZ_RUNS=50     seeds 1..50 instead      FUZZ_OPS=30  steps per chain      FUZZ_SEED=7  that one seed only
import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, watchErrors, waitIdle } from "./helpers.mjs";
import { makeRng, readStl, meshReport, readThreeMf, readStep } from "./fuzz-checks.mjs";

const OPS = +(process.env.FUZZ_OPS || 14);
const SEEDS = process.env.FUZZ_SEED ? [+process.env.FUZZ_SEED]
  : process.env.FUZZ_RUNS ? Array.from({ length: +process.env.FUZZ_RUNS }, (_, i) => i + 1)
  : [1, 2, 3];
const KINDS = ["box", "box", "box", "cylinder", "cylinder", "sphere", "cone", "pyramid", "wedge", "prism", "tube", "hemisphere", "torus", "star", "capsule", "roof"];
const REL = 1e-3; // volumes the kernel gives for the same shape agree to far better than this; booleans are checked against each other with this slack
const near = (a, b, rel = REL, abs = 0.01) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b));

class Fail extends Error {}
const check = (ok, what) => { if (!ok) throw new Fail(what); };
// Known open problems of the kernel are noted, not failed, so a long run goes on and finds new things. Each one is
// listed in test/README.md with its smallest case; FUZZ_STRICT=1 turns them back into failures.
const findings = [];
const soft = (ok, what) => { if (ok) return; if (process.env.FUZZ_STRICT) throw new Fail(what); findings.push(what); };
// Shapes whose boolean results the kernel gets right to the last digit in every run so far; every other kind (sphere,
// hemisphere, capsule, torus, tube, a group...) is checked against the same rules but only noted when they disagree.
const SOLID_BOOLEAN = new Set(["box", "wedge", "pyramid", "prism", "roof", "star", "cylinder", "cone"]);
// A stretch that is not the same shape stretched (a capsule's ends stay round, a tube's wall keeps its thickness)
const NOT_AFFINE = new Set(["capsule", "torus", "tube", "spring", "group"]);

// A fresh page for every chain, so a seed gives the same run alone as in a long series (kernel memory is not shared).
let page, errors;
test.beforeEach(async ({ browser }, info) => { page = await browser.newPage(); errors = watchErrors(page); await boot(page, info); });
test.afterEach(async () => { await page.close(); });

// ---- reading the app -----------------------------------------------------------------------------------------
// Every top-level body as the bridge reports it, plus how many features it carries and how many separate solids it built.
const snapshot = () => page.evaluate(() => JS3D.list().map((b) => {
  const v = __app.scene.views.get(b.id);
  return { ...b, mods: (JS3D.get(b.id).node.mods || []).length, solids: v && v.data ? v.data.solidCount : null, nonSolid: !!(v && v.data && v.data.hasNonSolidFaces) };
}));
const depths = () => page.evaluate(() => ({ undo: __store.undoStack.length, redo: __store.redoStack.length }));
const ready = () => page.evaluate(() => JS3D.ready(45_000)); // a stuck kernel shows up as this timing out, not as a hang

function sameBody(a, b, what) {
  for (const k of ["id", "name", "kind", "hole", "hidden", "color"]) check(a[k] === b[k], `${what}: ${a.name} ${k} ${JSON.stringify(a[k])} != ${JSON.stringify(b[k])}`);
  check(a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-6), `${what}: ${a.name} moved`);
  if (a.volume === null || b.volume === null) check(a.volume === b.volume, `${what}: ${a.name} volume ${a.volume} != ${b.volume}`);
  else check(near(a.volume, b.volume, 1e-6, 1e-6), `${what}: ${a.name} volume ${a.volume} != ${b.volume}`);
  if (a.bbox && b.bbox) for (const side of ["min", "max"]) check(a.bbox[side].every((v, i) => v === b.bbox[side][i] || Math.abs(v - b.bbox[side][i]) < 1e-4), `${what}: ${a.name} box changed`);
}
function sameList(a, b, what) {
  check(a.length === b.length, `${what}: ${a.length} bodies, wanted ${b.length} (${a.map((x) => x.name)} vs ${b.map((x) => x.name)})`);
  a.forEach((x, i) => sameBody(x, b[i], what));
}

// What must hold after any step, whatever it was.
function sane(list, what) {
  for (const b of list) {
    check(!b.error, `${what}: ${b.name} has a kernel error: ${b.error}`);
    if (!b.hidden) check(Number.isFinite(b.volume) && b.volume >= 0, `${what}: ${b.name} volume is ${b.volume}`);
    if (!b.hidden) check(b.volume > 0 || b.kind === "group", `${what}: ${b.name} has no volume`);
    check(b.position.every(Number.isFinite), `${what}: ${b.name} position is ${b.position}`);
    if (!b.hidden && ![...b.bbox.min, ...b.bbox.max].every(Number.isFinite)) {
      check(b.solids > 1, `${what}: ${b.name} box is not finite`);
      soft(false, "a body made of separate solids can be missing a solid in the view, its box and every export, while its volume still counts it");
    }
  }
  check(new Set(list.map((b) => b.id)).size === list.length, `${what}: duplicate body ids`);
}
const solidsOf = (list) => list.filter((b) => !b.hole);
const vol = (b) => b.volume;

// ---- making a step ---------------------------------------------------------------------------------------------
function chooseStep(rng, cur, depth) {
  const idx = (n, pool = cur.map((_, i) => i)) => { const left = pool.slice(), out = []; while (out.length < n && left.length) out.push(left.splice(rng.int(0, left.length - 1), 1)[0]); return out; };
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
    add(8, () => {
      const pick = idx(1), b = cur[pick[0]];
      const small = b.volume !== null && b.volume < 60;
      const k = rng.chance(0.4) ? [rng.pick([1, 2]), rng.pick([1, 1.5, 2]), rng.pick([0.5, 1, 2])].map((v) => (small && v < 1 ? 1 : v)) : (small ? 2 : rng.pick([0.5, 1.5, 2]));
      return { op: "scale", pick, k };
    });
    add(4, () => ({ op: "setHole", pick: idx(1) }));
    add(3, () => ({ op: "hide", pick: idx(1) }));
    add(8, () => ({ op: "duplicate", pick: idx(rng.int(1, 2)), by: offset() }));
    add(cur.length > 3 ? 6 : 1, () => ({ op: "remove", pick: idx(1) }));
    const plain = cur.map((b, i) => (b.kind === "box" && !b.mods && !b.hidden ? i : -1)).filter((i) => i >= 0);
    if (plain.length) add(3, () => ({ op: "resize", pick: [rng.pick(plain)], size: { w: rng.int(6, 28), d: rng.int(6, 28), h: rng.int(6, 28) } }));
  }
  if (cur.length >= 2) {
    add(13, () => ({ op: "group", pick: idx(rng.chance(0.7) ? 2 : 3), how: rng.pick(["join", "join", "cut", "intersect"]) }));
    const shown = solidIdx.filter((i) => !cur[i].hidden);
    if (shown.length >= 2) {
      add(7, () => ({ op: "roundtrip", pick: idx(2, shown) }));
      add(9, () => ({ op: "combine", pick: idx(2, shown), how: rng.pick(["join", "cut", "intersect"]), keep: rng.chance(0.25) }));
    }
    add(9, () => ({ op: "uiGroup", pick: idx(rng.chance(0.75) ? 2 : 3, visible) }));
  }
  const groups = cur.map((b, i) => (b.kind === "group" && !b.hidden ? i : -1)).filter((i) => i >= 0);
  if (groups.length) add(5, () => ({ op: "ungroup", pick: [rng.pick(groups)] }));
  if (depth.undo > 0) add(9, () => ({ op: "undo" }));
  if (depth.redo > 0) add(7, () => ({ op: "redo" }));
  add(3, () => ({ op: "export", kind: rng.pick(["stl", "stl", "3mf", "step"]) }));
  const total = table.reduce((s, [w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [w, step] of table) { if ((r -= w) < 0) return step(); }
  return table[0][1]();
}

// ---- running a step and checking it ---------------------------------------------------------------------------
// Both group probes build the result with the bridge's own Group and take it back with undo, so the app can be
// compared with itself: UI Group / Combine must give the same solids as the bridge's one-body group.
const probe = (ids, how) => page.evaluate(async ([ids, how]) => {
  const redo = __store.redoStack; // the probe's undo would leave its own group to "redo"; put the real redo steps back
  const g = JS3D.group(ids, how === "join" ? {} : { op: how });
  await JS3D.ready(45_000);
  const b = JS3D.list().find((x) => x.id === g), v = __app.scene.views.get(g);
  const out = { volume: b.volume, error: b.error, solids: v && v.data ? v.data.solidCount : null, nonSolid: !!(v && v.data && v.data.hasNonSolidFaces) };
  JS3D.undo(); await JS3D.ready(45_000);
  __store.redoStack = redo;
  return out;
}, [ids, how]);

// A boolean that leaves nothing (the shapes do not touch, or one swallows the other) comes back from the kernel as a raw
// "[object WebAssembly.Exception]" and not a message (listed in test/README.md). Anything else going wrong is a failure, and
// so is that error where the result is not really empty: for two shapes, the other booleans must agree it is empty.
async function emptyIsReal(how, picked, ids, err) {
  check(err === "[object WebAssembly.Exception]", `${how}: the kernel gave an error: ${err}`);
  soft(false, 'a boolean that leaves nothing shows the error "[object WebAssembly.Exception]" instead of a message');
  if (picked.length !== 2 || picked.some((b) => b.volume === null)) return;
  const [a, b] = picked;
  if (how === "intersect") { const u = await probe(ids, "join"); check(!u.error && near(u.volume, a.volume + b.volume, REL, 0.05), `intersect failed with a kernel error although the shapes overlap (join ${u.volume} against ${a.volume + b.volume} apart)`); }
  else { const i = await probe(ids, "intersect"); check(!i.error && near(i.volume, a.volume, REL, 0.05), `cut failed with a kernel error although the first shape is not swallowed (overlap ${i.volume} of ${a.volume})`); }
}

async function runStep(step, cur, log) {
  const ids = (step.pick || []).map((i) => cur[i].id);
  const picked = (step.pick || []).map((i) => cur[i]);
  const before = await depths();
  let want = before.undo + 1; // each edit is one undo step
  let after, ret;
  const evalStep = (fn, arg) => page.evaluate(fn, arg);
  const others = (changed) => cur.filter((b) => !changed.includes(b.id));
  const untouched = (list, changed, what) => others(changed).forEach((b) => sameBody(list.find((x) => x.id === b.id) || check(false, `${what}: ${b.name} vanished`), b, what));
  switch (step.op) {
    case "add": {
      const id = await evalStep(({ kind, size, at, hole }) => JS3D.add(kind, { size, at, hole }), step);
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
      if (step.op === "move") await evalStep(([ids, by]) => JS3D.move(ids, by), [ids, step.by]);
      else await evalStep(([id, to]) => JS3D.moveTo(id, to), [ids[0], step.to]);
      await ready(); after = await snapshot();
      check(after.length === cur.length, `${step.op}: body count changed`);
      untouched(after, ids, step.op);
      for (const b of picked) {
        const a = after.find((x) => x.id === b.id);
        check(near(a.volume, b.volume, 1e-5, 1e-5), `${step.op}: volume ${b.volume} -> ${a.volume}`);
        const d = step.op === "move" ? step.by : step.to.map((v, i) => v - b.position[i]);
        if (a.bbox && b.bbox && b.bbox.min.every(Number.isFinite)) check(a.bbox.min.every((v, i) => Math.abs(v - b.bbox.min[i] - d[i]) < 1e-3), `${step.op}: box did not move by ${d} (${b.bbox.min} -> ${a.bbox.min})`);
      }
      break;
    }
    case "rotate": case "scale": case "setHole": case "hide": case "resize": {
      if (step.op === "rotate") await evalStep(([ids, axis, deg]) => JS3D.rotate(ids, axis, deg), [ids, step.axis, step.deg]);
      if (step.op === "scale") await evalStep(([ids, k]) => JS3D.scale(ids, k), [ids, step.k]);
      if (step.op === "setHole") await evalStep(([ids, flip]) => JS3D.setHole(ids, flip), [ids, !picked[0].hole]);
      if (step.op === "hide") await evalStep(([ids, hide]) => JS3D.setHidden(ids, hide), [ids, !picked[0].hidden]);
      if (step.op === "resize") await evalStep(([id, size]) => JS3D.resize(id, size), [ids[0], step.size]);
      await ready(); after = await snapshot();
      if (step.op === "scale" && after.some((b) => /can't be stretched unevenly/.test(b.error || ""))) {
        // the call went through and the body then failed to build; the way out is undo, and it must work
        soft(false, 'JS3D.scale with different factors on a group of turned parts succeeds, then the group shows "can\'t be stretched unevenly"');
        await evalStep(() => { JS3D.undo(); __store.redoStack = []; });
        await ready(); sameList(await snapshot(), cur, "undo after a failed stretch");
        want = before.undo; return { after: cur, skipped: true, clearedRedo: true };
      }
      check(after.length === cur.length, `${step.op}: body count changed`);
      untouched(after, ids, step.op);
      for (const b of picked) {
        const a = after.find((x) => x.id === b.id);
        if (b.volume === null || a.volume === null) continue; // a hidden shape is not built
        const uniform = !Array.isArray(step.k) || step.k.every((v) => v === step.k[0]);
        if (step.op === "scale" && !uniform && NOT_AFFINE.has(b.kind)) continue;
        const factor = step.op !== "scale" ? 1 : Array.isArray(step.k) ? step.k.reduce((p, v) => p * v, 1) : step.k ** 3;
        const wantV = step.op === "resize" ? step.size.w * step.size.d * step.size.h : b.volume * factor;
        check(near(a.volume, wantV, 2e-3, 1e-3), `${step.op}: volume ${b.volume} -> ${a.volume}, wanted ${wantV}`);
        if (step.op === "setHole") check(a.hole !== b.hole, "setHole: flag did not flip");
        if (step.op === "hide") check(a.hidden !== b.hidden, "hide: flag did not flip");
      }
      break;
    }
    case "duplicate": {
      const made = await evalStep(([ids, by]) => JS3D.duplicate(ids, by), [ids, step.by]);
      await ready(); after = await snapshot();
      check(made.length === ids.length && after.length === cur.length + ids.length, `duplicate: ${after.length} bodies, wanted ${cur.length + ids.length}`);
      untouched(after, [], "duplicate");
      made.forEach((id, i) => { const a = after.find((x) => x.id === id), b = picked[i]; check(a && a.kind === b.kind && a.hole === b.hole && near(a.volume ?? 0, b.volume ?? 0, 1e-5, 1e-5), `duplicate: copy of ${b.name} differs (${a && a.volume} vs ${b.volume})`); });
      break;
    }
    case "remove": {
      const n = await evalStep((ids) => JS3D.remove(ids), ids);
      await ready(); after = await snapshot();
      check(n === ids.length && after.length === cur.length - ids.length, `remove: ${after.length} bodies left, wanted ${cur.length - ids.length}`);
      untouched(after, ids, "remove");
      break;
    }
    case "group": {
      const solids = picked.filter((b) => !b.hole), holes = picked.length - solids.length;
      let how = step.how;
      if (holes && how !== "join") how = "join"; // cut / intersect with a hole shape in the pick is not a defined combination
      if (picked.some((b) => b.hidden)) how = "join";
      const exact = picked.length === 2 && !holes && picked.every((b) => b.volume !== null);
      const strict = picked.every((b) => SOLID_BOOLEAN.has(b.kind));
      const direct = how === "join" ? null : await probe(ids, how);
      if (direct && direct.error) { await emptyIsReal(how, picked, ids, direct.error); sameList(await snapshot(), cur, "probe undo"); want = before.undo; return { after: cur, skipped: true }; }
      const isect = exact ? (how === "intersect" ? direct : await probe(ids, "intersect")) : null;
      sameList(await snapshot(), cur, "probe undo"); // a probe must leave no trace
      const id = await evalStep(([ids, how]) => JS3D.group(ids, how === "join" ? {} : { op: how }), [ids, how]);
      await ready(); after = await snapshot();
      check(after.length === cur.length - ids.length + 1, `group: ${after.length} bodies, wanted ${cur.length - ids.length + 1}`);
      untouched(after, ids, "group");
      const g = after.find((x) => x.id === id);
      check(g && g.kind === "group" && g.children === ids.length, "group: result is not a group of the picked bodies");
      if (!g.hole && !g.hidden && picked.every((b) => b.volume !== null)) {
        const sum = solids.reduce((s, b) => s + (b.volume ?? 0), 0);
        check(g.volume <= sum * (1 + REL) + 0.01, `group ${how}: volume ${g.volume} is more than its parts add up to (${sum})`);
        if (how === "join" && !holes && picked.every((b) => b.volume !== null)) check(g.volume >= Math.max(...picked.map(vol)) * (1 - REL) - 0.01, `group join: volume ${g.volume} is less than its biggest part`);
        if (how === "intersect") check(g.volume <= Math.min(...picked.map(vol)) * (1 + REL) + 0.01, `group intersect: volume ${g.volume} is more than its smallest part`);
        if (how === "cut") check(g.volume <= picked[0].volume * (1 + REL) + 0.01, `group cut: volume ${g.volume} is more than the part it cuts`);
        if (exact) {
          const [a, b] = picked, i = isect.error ? 0 : isect.volume;
          const wantV = how === "join" ? a.volume + b.volume - i : how === "cut" ? a.volume - i : i;
          // the three results must fit together: join + overlap = both parts, cut + overlap = the first part
          (strict ? check : soft)(near(g.volume, wantV, REL, 0.05), `group ${how} of ${a.kind} and ${b.kind}: volume ${g.volume}, but the parts and their overlap (${i}) say ${wantV} (${strict ? "" : "curved shapes: noted only; "}steps: ${JSON.stringify(log.slice(-3))})`);
        }
      }
      break;
    }
    case "roundtrip": {
      // group two solids, split them again: the same shapes come back, in the same places
      const id = await evalStep((ids) => JS3D.group(ids), ids);
      await ready(); const mid = await snapshot();
      const back = await evalStep((id) => JS3D.ungroup(id), id);
      await ready(); after = await snapshot();
      want = before.undo + 2;
      check(back.length === 2 && after.length === cur.length, `group then ungroup: ${after.length} bodies, wanted ${cur.length}`);
      for (const b of picked) {
        const a = after.find((x) => x.kind === b.kind && x.hole === b.hole && x.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-6) && near(x.volume, b.volume, 1e-5, 1e-5));
        check(a, `group then ungroup: ${b.name} did not come back`);
      }
      return { after, mid };
    }
    case "ungroup": {
      const kids = picked[0].children;
      const r = await evalStep(async (id) => { try { return { ids: JS3D.ungroup(id) }; } catch (e) { return { threw: e.message }; } }, ids[0]);
      await ready(); after = await snapshot();
      if (r.threw) {
        check(/features|stretched at an angle/.test(r.threw), `ungroup: unexpected error "${r.threw}"`);
        want = before.undo; sameList(after, cur, "refused ungroup");
        break;
      }
      check(r.ids.length === kids && after.length === cur.length - 1 + kids, `ungroup: ${after.length} bodies, wanted ${cur.length - 1 + kids}`);
      untouched(after, ids, "ungroup");
      break;
    }
    case "undo": case "redo": {
      ret = await evalStep((op) => JS3D[op](), step.op);
      await ready(); after = await snapshot();
      check(ret, `${step.op}: nothing to ${step.op}, but the app says there is`);
      return { after, undoRedo: step.op, depth: before };
    }
    case "uiGroup": {
      // the Group button (Beginner): pieces are separate bodies only when holes cut a solid in two
      const solids = picked.filter((b) => !b.hole), holes = picked.length - solids.length;
      let wantBodies = 1, wantVolume = null;
      if (holes && solids.length) {
        const baselineSolids = solids.length === 1 ? solids[0].solids : (await probe(solids.map((b) => b.id), "join")).solids;
        const full = await probe(ids, "join");
        sameList(await snapshot(), cur, "probe undo");
        if (full.error) { await emptyIsReal("hole cut", [], ids, full.error); want = before.undo; return { after: cur, skipped: true }; }
        if (!full.nonSolid && full.solids > baselineSolids) wantBodies = full.solids;
        wantVolume = full.volume;
      } else if (solids.length) { wantVolume = (await probe(ids, "join")).volume; sameList(await snapshot(), cur, "probe undo"); }
      await evalStep((ids) => JS3D.select(ids), ids);
      await page.click("#bb-group");
      await ready(); after = await snapshot();
      await evalStep(() => JS3D.select([]));
      check(after.length === cur.length - ids.length + wantBodies, `Group button on ${picked.map((b) => b.name)}: ${after.length} bodies, wanted ${cur.length - ids.length + wantBodies} (${wantBodies} pieces)`);
      const made = after.filter((b) => !cur.some((c) => c.id === b.id));
      check(made.length === wantBodies, `Group button: ${made.length} new bodies, wanted ${wantBodies}`);
      untouched(after, ids, "Group button");
      if (wantVolume !== null && !made[0].hole) check(near(made.reduce((s, b) => s + b.volume, 0), wantVolume, REL, 0.05), `Group button: pieces add up to ${made.reduce((s, b) => s + b.volume, 0)}, the bridge's group gives ${wantVolume}`);
      break;
    }
    case "combine": {
      // Advanced Combine: the target keeps its identity; cut and intersect leave separate bodies only when they separate solids
      const [t, tool] = picked;
      const res = await probe(ids, step.how);
      sameList(await snapshot(), cur, "probe undo");
      if (res.error) { await emptyIsReal(step.how, picked, ids, res.error); want = before.undo; return { after: cur, skipped: true }; }
      const wantBodies = step.how !== "join" && !res.nonSolid && t.solids !== null && res.solids > t.solids ? res.solids : 1;
      await evalStep((ids) => { JS3D.setMode("advanced"); JS3D.select(ids); }, ids);
      await page.click("#ad-advmod"); await page.click("#ad-combine");
      await page.locator("#cb-op").getByRole("button", { name: { join: "Join", cut: "Cut", intersect: "Intersect" }[step.how], exact: true }).click();
      if (step.keep) await page.check("#cb-keep");
      await page.click("#cmd-ok");
      await ready();
      await evalStep(() => { JS3D.select([]); JS3D.setMode("beginner"); });
      await ready(); after = await snapshot();
      const wantCount = cur.length - 1 - (step.keep ? 0 : 1) + wantBodies;
      check(after.length === wantCount, `Combine ${step.how}${step.keep ? " (keep tools)" : ""}: ${after.length} bodies, wanted ${wantCount} (${wantBodies} pieces)`);
      if (step.keep) check(after.some((b) => b.id === tool.id), "Combine keep tools: the tool is gone");
      else check(!after.some((b) => b.id === tool.id), "Combine: the tool body is still there");
      const pieces = after.filter((b) => !cur.some((c) => c.id === b.id) || b.id === t.id);
      check(pieces.length === wantBodies, `Combine: ${pieces.length} result bodies, wanted ${wantBodies}`);
      check(near(pieces.reduce((s, b) => s + b.volume, 0), res.volume, REL, 0.05), `Combine ${step.how}: result ${pieces.reduce((s, b) => s + b.volume, 0)}, the bridge's group gives ${res.volume}`);
      untouched(after, [t.id, tool.id], "Combine");
      break;
    }
    case "export": {
      after = cur; want = before.undo;
      const solids = cur.filter((b) => !b.hole && !b.hidden);
      await exportCheck(step.kind, solids);
      sameList(await snapshot(), cur, "export");
      break;
    }
    default: throw new Fail("unknown step " + JSON.stringify(step));
  }
  const d = await depths();
  check(d.undo === want && d.redo === 0, `${step.op}: undo stack is ${d.undo} deep (redo ${d.redo}), wanted ${want} (redo 0)`);
  return { after };
}

// STL / 3MF / STEP of everything shown. `solids` are the top-level bodies that should be in it.
async function exportCheck(kind, solids) {
  const r = await page.evaluate(async (kind) => {
    try { return { b64: (await JS3D.invoke("export", [kind]))["$bytes"] }; } catch (e) { return { threw: e.message }; }
  }, kind);
  if (!solids.length) { check(r.threw && /nothing to export/.test(r.threw), `${kind} of nothing: ${r.threw || "it produced a file"}`); return; }
  check(!r.threw, `${kind} export failed: ${r.threw}`);
  const bytes = Buffer.from(r.b64, "base64");
  check(bytes.length > 200, `${kind} export is only ${bytes.length} bytes`);
  const total = solids.reduce((s, b) => s + b.volume, 0);
  if (kind === "stl" || kind === "3mf") {
    // the STL is the reference mesh; the 3MF must hold the same number of triangles
    const stl = kind === "stl" ? bytes : Buffer.from((await page.evaluate(async () => (await JS3D.invoke("export", ["stl"]))["$bytes"])), "base64");
    const rep = meshReport(readStl(stl));
    check(rep.triangles > 0, "STL has no triangles");
    check(rep.open === 0, `STL is not closed: ${rep.open} edges have no partner`);
    check(rep.volume > 0, `STL volume ${rep.volume} is not positive (faces point inward?)`);
    if (!near(rep.volume, total, 0.03, 0.5)) {
      // find the body: export each alone. A body of several separate solids is known to lose one from its mesh (listed in
      // test/README.md); a body of one solid has no excuse.
      const bad = [];
      for (const b of solids) {
        const one = await page.evaluate(async (id) => (await JS3D.invoke("export", ["stl", { ids: [id] }]))["$bytes"], b.id);
        const mesh = meshReport(readStl(Buffer.from(one, "base64"))).volume;
        if (!near(mesh, b.volume, 0.03, 0.5)) bad.push(b.solids > 1 ? null : `${b.name} (${b.kind}) kernel ${b.volume} mesh ${mesh.toFixed(2)}`);
      }
      check(bad.length > 0 && bad.every((x) => x === null), `STL encloses ${rep.volume.toFixed(2)} mm3 but the bodies add up to ${total.toFixed(2)}: ${bad.filter(Boolean).join("; ") || "no single body explains it"}`);
      soft(false, "a body made of separate solids (a torus grouped with a shape it does not touch) can be missing a solid in the view, its box and every export, while its volume still counts it");
    }
    if (kind === "3mf") {
      // welding drops the few triangles that collapse to a line, so the 3MF has a little fewer than the STL, never more
      const m = readThreeMf(bytes), tris = m.meshes.reduce((n, x) => n + x.triangles, 0);
      check(m.meshes.length === solids.length && m.build === solids.length, `3MF has ${m.meshes.length} meshes and ${m.build} build items for ${solids.length} bodies`);
      check(tris <= rep.triangles && tris >= rep.triangles * 0.98, `3MF has ${tris} triangles; the STL has ${rep.triangles}`);
      m.meshes.forEach((x, i) => { check(x.open === 0, `3MF mesh ${i + 1} is not closed: ${x.open} edges have no partner`); check(x.volume > 0, `3MF mesh ${i + 1} volume ${x.volume} is not positive`); });
      const v = m.meshes.reduce((n, x) => n + x.volume, 0);
      check(near(v, rep.volume, 0.01, 0.5), `3MF encloses ${v.toFixed(2)} mm3, the STL ${rep.volume.toFixed(2)}`);
    }
  } else {
    const s = readStep(bytes);
    check(s.solids >= solids.length, `STEP has ${s.solids} solids for ${solids.length} bodies`);
  }
}

function noteFindings() {
  for (const f of new Set(findings)) { console.log("fuzz finding: " + f); test.info().annotations.push({ type: "fuzz finding", description: f }); }
}

// ---- the chains --------------------------------------------------------------------------------------------------
for (const seed of SEEDS) {
  test(`fuzz seed ${seed}: ${OPS} random steps keep the design sound`, async () => {
    const rng = makeRng(seed), log = [];
    findings.length = 0;
    await loadDoc(page, newDoc("Fuzz " + seed, "beginner"));
    await page.evaluate(() => JS3D.setMode("beginner"));
    let cur = [], hist = [[]], ptr = 0; // what the design looked like after each undo step, so undo and redo can be checked
    const hint = () => `\nFUZZ_SEED=${seed} FUZZ_OPS=${OPS} npx playwright test test/fuzz.spec.mjs\nsteps so far:\n${log.map((s, i) => `  ${i + 1}. ${JSON.stringify(s)}`).join("\n")}`;
    try {
      for (let n = 0; n < OPS; n++) {
        const step = chooseStep(rng, cur, await depths());
        log.push(step);
        const { after, undoRedo, mid, skipped, clearedRedo } = await runStep(step, cur, log);
        if (skipped) {
          if (clearedRedo) hist = hist.slice(0, ptr + 1); // nothing to do: the boolean leaves nothing, so the design must be exactly as it was
          sameList(await snapshot(), cur, "a refused step changed the design");
          check((await depths()).undo === ptr, "a refused step left an undo entry");
          log[log.length - 1] = { ...step, skipped: "empty result" };
          continue;
        }
        sane(after, `step ${n + 1} (${step.op})`);
        if (undoRedo) {
          ptr += undoRedo === "undo" ? -1 : 1;
          sameList(after, hist[ptr], `${undoRedo} did not return to the earlier design`);
          check((await depths()).undo === ptr, `${undoRedo}: undo stack is ${(await depths()).undo} deep, wanted ${ptr}`);
        } else if (step.op !== "export") {
          const d = await depths();
          hist = hist.slice(0, ptr + 1); ptr = d.undo; hist[ptr] = after; if (mid) hist[ptr - 1] = mid; // group-then-ungroup is two undo steps
        }
        expect(errors, "page errors").toEqual([]);
        cur = after;
      }
      // the end: every kind of export of what is on screen, then all the way back and forward again
      const solids = cur.filter((b) => !b.hole && !b.hidden);
      log.push({ op: "final exports" });
      for (const kind of ["stl", "3mf", "step"]) await exportCheck(kind, solids);
      sameList(await snapshot(), cur, "export left the design changed");
      log.push({ op: "undo all, redo all" });
      let steps = 0;
      while (await page.evaluate(() => JS3D.undo())) { steps++; await ready(); ptr--; if (hist[ptr]) sameList(await snapshot(), hist[ptr], "undo all"); if (steps > 200) throw new Fail("undo never ends"); }
      sameList(await snapshot(), [], "undo all the way did not give the empty design");
      while (await page.evaluate(() => JS3D.redo())) { await ready(); ptr++; if (hist[ptr]) sameList(await snapshot(), hist[ptr], "redo all"); }
      sameList(await snapshot(), hist[hist.length - 1], "redo all the way did not give the design the chain ended on");
      expect(errors, "page errors").toEqual([]);
      const mix = {}; for (const x of log) mix[x.op] = (mix[x.op] || 0) + 1;
      console.log(`fuzz seed ${seed}: ${Object.entries(mix).map(([k, n]) => k + " " + n).join(", ")}`);
      noteFindings();
    } catch (e) {
      noteFindings();
      e.message = `${e.message}\n${hint()}`;
      throw e;
    }
  });
}
