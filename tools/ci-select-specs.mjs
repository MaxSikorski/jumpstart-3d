// Picks the extra specs the merge gate (.github/workflows/test.yml) runs for a pull request, from the list of changed files.
// Input: CHANGED_LIST, a file of NUL-separated paths (git diff --name-only -z). Output: appends to GITHUB_OUTPUT (when set)
//   specs   JSON array of the changed test/*.spec.mjs files to run, one job each per build (at most MAX_SPECS)
// smoke and golden already run in the gate; mobile.spec.mjs has its own job (every code pull request); chatjudge has its own 8-minute clock (nightly).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_SPECS = 10;
const SKIP = new Set(["test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs"]);

export function select(paths, exists = existsSync) {
  const notices = [];
  let specs = paths.filter((p) => /^test\/[^/\r\n]+\.spec\.mjs$/.test(p) && !SKIP.has(p) && exists(p)); // exists: false for a spec deleted in this pull request
  specs = [...new Set(specs)].sort();
  if (specs.length > MAX_SPECS) {
    notices.push(`${specs.length} spec files changed: running the first ${MAX_SPECS} only (the nightly runs the rest): ${specs.slice(MAX_SPECS).join(" ")}`);
    specs = specs.slice(0, MAX_SPECS);
  }
  return { specs, notices };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const list = process.env.CHANGED_LIST;
  if (!list) { console.error("CHANGED_LIST is not set"); process.exit(1); }
  const paths = readFileSync(list, "utf8").split("\0").filter(Boolean);
  const { specs, notices } = select(paths);
  for (const n of notices) console.log(`::notice::${n.replace(/[\r\n%]/g, " ")}`);
  console.log(`changed specs to run: ${JSON.stringify(specs)}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `specs=${JSON.stringify(specs)}\n`);
}
