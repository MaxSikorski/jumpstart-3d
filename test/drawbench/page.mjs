// What the two drawing-bench specs share (drawbench.spec.mjs, drawbench-wrong.spec.mjs): JS3D.invoke in a Playwright page
// as mcp/session.mjs calls it, and a case opened in the booted app with its reference part built.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boot, watchErrors } from "../helpers.mjs";
import { loadCase } from "./score.mjs";
import { buildTruth } from "./measure.mjs";

const CASES = fileURLToPath(new URL("./cases/", import.meta.url));
export const caseIds = (await readdir(CASES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
export const recipeOf = async (dir, name) => ({ recipe: JSON.parse(await readFile(join(dir, name), "utf8")) });
export const failing = (result) => result.checks.filter((c) => c.status !== "pass").map((c) => `${c.id} (${c.status}): ${c.note}`);

// bytes come back as {"$bytes": base64}, as JS3D.invoke makes them
export const callIn = (page) => async (name, args = []) => {
  const r = await page.evaluate(async ([n, a]) => {
    try { return { ok: (await window.JS3D.invoke(n, a)) ?? null }; } catch (e) { return { err: (e && e.message) || String(e) }; }
  }, [name, args]);
  if (r.err !== undefined) throw new Error(`${name}: ${r.err}`);
  const v = r.ok;
  return v && typeof v === "object" && typeof v.$bytes === "string" && Object.keys(v).length === 1 ? Buffer.from(v.$bytes, "base64") : v;
};

export async function openCase(page, info, id) {
  const errors = watchErrors(page);
  await boot(page, info);
  const loaded = await loadCase(join(CASES, id)), call = callIn(page);
  const truthBuild = await buildTruth(call, (await recipeOf(loaded.dir, "truth.recipe.json")).recipe);
  return { ...loaded, call, truthBuild, errors };
}
