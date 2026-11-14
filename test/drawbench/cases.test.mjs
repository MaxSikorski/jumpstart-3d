// The case files themselves (no browser): every case loads, its recipes are valid, its picture is a PNG 2000 pixels wide,
// SOURCES.md names it, and wave 1 has 2 development and 4 qualification cases (design section 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRecipe } from "../../mcp/recipe.mjs";
import { loadCase, holePoint } from "./score.mjs";
import { validateDrawing } from "./draw.mjs";

const CASES = fileURLToPath(new URL("./cases/", import.meta.url));
const ids = (await readdir(CASES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const cases = await Promise.all(ids.map((id) => loadCase(join(CASES, id))));
const json = async (dir, name) => JSON.parse(await readFile(join(dir, name), "utf8"));

test("wave 1: six cases, two for development and four for qualification", () => {
  assert.deepEqual(ids, ["counterbored-block", "flanged-bushing", "hex-standoff", "l-bracket", "plate-holes", "pocket-block"]);
  assert.equal(cases.filter((c) => c.kase.set === "development").length, 2);
  assert.ok(cases.every((c) => c.kase.wave === 1));
});

test("every recipe is valid and every wrong or other recipe in a folder is listed in its case", async () => {
  for (const { kase, dir } of cases) {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".recipe.json")).sort();
    assert.deepEqual(files, ["truth.recipe.json", ...kase.wrong.map((w) => w.recipe), ...(kase.other ?? []).map((o) => o.recipe)].sort(), kase.id);
    for (const f of files) checkRecipe(await json(dir, f));
  }
});

test("every drawing is valid and every picture is a PNG 2000 pixels wide", async () => {
  for (const { kase, dir } of cases) {
    validateDrawing(kase.drawing);
    assert.equal(kase.drawing.projection, (await json(dir, "truth.json")).source.projection, `${kase.id}: projection`);
    const png = await readFile(join(dir, kase.input.picture));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${kase.id}: PNG signature`);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.equal(width, 2000, kase.id);
    assert.ok(height >= 1000 && height <= 4000, `${kase.id}: height ${height}`);
  }
});

test("truth points lie on or inside the part's box", () => {
  for (const { kase, truth } of cases) {
    const size = truth.checks.find((c) => c.kind === "size").value, inside = (p) => p.every((v, i) => v >= -1e-9 && v <= size[i] + 1e-9);
    for (const c of truth.checks) {
      const points = c.kind === "holes" ? (c.at ?? []).map((at) => holePoint(c.axis, at)) : c.kind === "distance" ? [c.a.near, c.b.near] : c.kind === "radius" ? [c.near] : [];
      for (const p of points) assert.ok(inside(p), `${kase.id} ${c.id}: [${p}] is outside the box`);
    }
  }
});

test("SOURCES.md has a line for every case", async () => {
  const sources = await readFile(join(CASES, "SOURCES.md"), "utf8");
  for (const id of ids) assert.match(sources, new RegExp(`^\\| \`${id}\` \\|`, "m"), id);
});
