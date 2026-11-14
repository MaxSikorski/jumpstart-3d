#!/usr/bin/env node
// npm run drawing-bench: scores the reference parts and the wrong parts of every case (or one design) and prints the table.
// README.md in this folder explains the cases and the scoring. stdout: the table; stderr: progress.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecipe } from "../../mcp/recipe.mjs";
import { expectWrong, loadCase, table } from "./score.mjs";
import { buildTruth, openApp, scoreDesign } from "./measure.mjs";

const CASES = fileURLToPath(new URL("./cases/", import.meta.url));
const USAGE = "usage: node test/drawbench/bench.mjs [--case <id>] [--design <project or recipe file> (needs --case)] [--app <url|file|dir>] [--json <file>]";
class Usage extends Error {}

function parse(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (!["case", "design", "app", "json"].includes(name) || !argv[i].startsWith("--") || i + 1 >= argv.length) throw new Usage(USAGE);
    if (flags[name] !== undefined) throw new Usage(`--${name} given twice`);
    flags[name] = argv[++i];
  }
  if (flags.design && !flags.case) throw new Usage("--design needs --case");
  return flags;
}

const detail = (result) => result.checks.filter((c) => c.status !== "pass").map((c) => `    ${c.status.padEnd(10)} ${c.id}: ${c.note}`);
const designOf = (text, file) => {
  let value;
  try { value = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
  return isRecipe(value) ? { recipe: value } : { project: text };
};

async function main() {
  const flags = parse(process.argv.slice(2));
  const all = (await readdir(CASES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (flags.case && !all.includes(flags.case)) throw new Usage(`no case named "${flags.case}"; the cases are ${all.join(", ")}`);
  const ids = flags.case ? [flags.case] : all;
  const cases = [];
  for (const id of ids) cases.push(await loadCase(join(CASES, id)));
  const design = flags.design && designOf(await readFile(flags.design, "utf8"), flags.design);
  const app = await openApp(flags.app);
  const rows = [];
  try {
    for (const { kase, truth, dir } of cases) {
      const started = Date.now();
      console.error(`drawing-bench: ${kase.id}`);
      const truthBuild = await buildTruth(app.call, JSON.parse(await readFile(join(dir, "truth.recipe.json"), "utf8")));
      const score = async (d) => (await scoreDesign(app.call, { kase, truth, truthBuild, design: d })).result;
      const recipe = async (name) => ({ recipe: JSON.parse(await readFile(join(dir, name), "utf8")) });
      if (design) rows.push({ case: kase.id, design: flags.design, kind: "design", result: await score(design) });
      else {
        rows.push({ case: kase.id, design: "truth", kind: "truth", result: await score(await recipe("truth.recipe.json")) });
        // other correct builds must pass (failing only the named-size checks they list); wrong parts must fail exactly as listed
        for (const [kind, list] of [["other", kase.other ?? []], ["wrong", kase.wrong]]) for (const x of list) {
          const result = await score(await recipe(x.recipe));
          rows.push({ case: kase.id, design: x.recipe.replace(/\.recipe\.json$/, ""), kind, result, expected: expectWrong(result, x.fails), fails: x.fails });
        }
      }
      console.error(`drawing-bench: ${kase.id} took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally { await app.close(); }
  const lines = [table(rows), ""];
  for (const r of rows) {
    const off = r.expected ? !r.expected.ok : !(r.result.pass && r.result.score.percent === 100);
    if (!design && !off) continue;
    lines.push(`${r.case} ${r.design}:${r.expected && !r.expected.ok ? ` expected to fail exactly ${r.fails.join(", ") || "nothing"}` : ""}`, ...detail(r.result));
  }
  console.log(lines.join("\n").trimEnd());
  if (flags.json) await writeFile(flags.json, JSON.stringify(rows, null, 1) + "\n");
  if (design) return rows.every((r) => r.result.pass) ? 0 : 3;
  return rows.every((r) => (r.expected ? r.expected.ok : r.result.pass && r.result.score.percent === 100)) ? 0 : 3;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error("drawing-bench: " + ((e && e.message) || e));
  process.exitCode = e instanceof Usage ? 2 : 1;
});
