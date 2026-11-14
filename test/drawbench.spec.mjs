// The drawing bench's scorer in the real app, on both builds (test/drawbench/README.md): every reference part scores 100 %
// against its own truth file, every other correct build passes, every wrong part fails exactly the checks its case lists,
// a turned and moved copy still scores 100 % and is left exactly as it was, and a part left as a mesh fails the gate.
// No AI and no key: recipes and project files only.
import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boot, watchErrors } from "./helpers.mjs";
import { expectWrong, loadCase } from "./drawbench/score.mjs";
import { buildTruth, scoreDesign, scoreOpenDesign } from "./drawbench/measure.mjs";

const CASES = fileURLToPath(new URL("./drawbench/cases/", import.meta.url));
const ids = (await readdir(CASES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const recipeOf = async (dir, name) => JSON.parse(await readFile(join(dir, name), "utf8"));

// JS3D.invoke in the page, as mcp/session.mjs calls it: bytes come back as {"$bytes": base64}
const callIn = (page) => async (name, args = []) => {
  const r = await page.evaluate(async ([n, a]) => {
    try { return { ok: (await window.JS3D.invoke(n, a)) ?? null }; } catch (e) { return { err: (e && e.message) || String(e) }; }
  }, [name, args]);
  if (r.err !== undefined) throw new Error(`${name}: ${r.err}`);
  const v = r.ok;
  return v && typeof v === "object" && typeof v.$bytes === "string" && Object.keys(v).length === 1 ? Buffer.from(v.$bytes, "base64") : v;
};
const failing = (result) => result.checks.filter((c) => c.status !== "pass").map((c) => `${c.id} (${c.status}): ${c.note}`);

async function start(page, info, id) {
  const errors = watchErrors(page);
  await boot(page, info);
  const loaded = await loadCase(join(CASES, id)), call = callIn(page);
  const truthBuild = await buildTruth(call, await recipeOf(loaded.dir, "truth.recipe.json"));
  return { ...loaded, call, truthBuild, errors };
}

for (const id of ids) {
  test(`${id}: the reference part scores 100 %, other builds pass and each wrong part fails exactly as listed`, async ({ page }, info) => {
    test.setTimeout(600_000);
    const { kase, truth, dir, call, truthBuild, errors } = await start(page, info, id);
    const own = (await scoreDesign(call, { kase, truth, truthBuild, design: { recipe: await recipeOf(dir, "truth.recipe.json") } })).result;
    expect(failing(own)).toEqual([]);
    expect(own.score.percent).toBe(100);
    expect(own.pass).toBe(true);
    for (const o of kase.other ?? []) {
      const result = (await scoreDesign(call, { kase, truth, truthBuild, design: { recipe: await recipeOf(dir, o.recipe) } })).result;
      const verdict = expectWrong(result, o.fails);
      expect({ other: o.recipe, unexpected: verdict.unexpected, missing: verdict.missing }, failing(result).join("\n")).toEqual({ other: o.recipe, unexpected: [], missing: [] });
      expect(result.pass).toBe(true);
    }
    for (const w of kase.wrong) {
      const result = (await scoreDesign(call, { kase, truth, truthBuild, design: { recipe: await recipeOf(dir, w.recipe) } })).result;
      const verdict = expectWrong(result, w.fails);
      expect({ wrong: w.recipe, unexpected: verdict.unexpected, missing: verdict.missing }, failing(result).join("\n")).toEqual({ wrong: w.recipe, unexpected: [], missing: [] });
      expect(verdict.ok).toBe(true);
      expect(result.score.percent).toBeLessThan(100);
      if (w.fails.some((f) => result.checks.find((c) => c.id === f).gating)) expect(result.pass).toBe(false);
    }
    expect(errors).toEqual([]);
  });
}

test("a turned and moved copy of the L-bracket still scores 100 %, on a turn other than the first, and is left as it was", async ({ page }, info) => {
  test.setTimeout(600_000);
  const { kase, truth, call, truthBuild, errors } = await start(page, info, "l-bracket");
  const saved = await call("save");
  // a quarter turn about x (y becomes z) and a move: the upright now lies flat and the base stands up
  saved.doc.bodies[0].m = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 12, -7, 30, 1];
  await call("load", [JSON.stringify(saved)]);
  await call("ready");
  const before = await call("save");
  const { result, part } = await scoreOpenDesign(call, { kase, truth, truthBuild });
  expect(await call("save")).toEqual(before);
  expect(part.box.min.map((v) => Math.round(v))).toEqual([12, -47, 30]);
  expect(failing(result)).toEqual([]);
  expect(result.score.percent).toBe(100);
  expect(result.pose).not.toBe(0);
  expect(errors).toEqual([]);
});

test("a part left as a mesh fails the gate and nothing else is scored", async ({ page }, info) => {
  test.setTimeout(600_000);
  const { kase, truth, call, truthBuild, errors } = await start(page, info, "plate-holes");
  // buildTruth leaves the reference plate open: its STL, packed the way the app stores an imported mesh
  // (two counts, then float positions, then indices), becomes the only body of a new design
  const stl = await call("export", ["stl", {}]), saved = await call("save");
  const count = stl.readUInt32LE(80), V = [], I = [], seen = new Map();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12, p = [stl.readFloatLE(o), stl.readFloatLE(o + 4), stl.readFloatLE(o + 8)], key = p.join();
    if (!seen.has(key)) { seen.set(key, V.length / 3); V.push(...p); }
    I.push(seen.get(key));
  }
  const packed = Buffer.alloc(8 + V.length * 4 + I.length * 4);
  packed.writeUInt32LE(V.length / 3, 0);
  packed.writeUInt32LE(I.length / 3, 4);
  V.forEach((v, i) => packed.writeFloatLE(v, 8 + i * 4));
  I.forEach((v, i) => packed.writeUInt32LE(v, 8 + V.length * 4 + i * 4));
  const mesh = { ...saved, doc: { ...saved.doc, sketches: [], params: [], assets: { m: { kind: "mesh", name: "plate", data: packed.toString("base64") } },
    bodies: [{ id: "b1", name: "Plate mesh", m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "mesh", asset: "m", k: 1, keepPos: true, mods: [] } }] } };
  const { result, part } = await scoreDesign(call, { kase, truth, truthBuild, design: { project: JSON.stringify(mesh) } });
  expect(part.volumeFrom).toBe("mesh");
  expect(part.size.map((v) => Math.round(v))).toEqual([80, 50, 6]);
  expect(result.checks[0]).toMatchObject({ id: "gate", status: "fail", note: "body is not an exact solid" });
  expect(result.checks.slice(1).every((c) => c.status === "not run")).toBe(true);
  expect(result.pass).toBe(false);
  expect(result.score.passed).toBe(0);
  expect(errors).toEqual([]);
});
