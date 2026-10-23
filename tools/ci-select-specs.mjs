// Picks the extra checks the merge gate (.github/workflows/test.yml) runs for a pull request, from the list of changed files.
// Input: CHANGED_LIST, a file of NUL-separated paths (git diff --name-only -z). Output: appends to GITHUB_OUTPUT (when set)
//   specs   JSON array of the changed test/*.spec.mjs files to run on both builds (at most MAX_SPECS)
//   mobile  "true" when test/mobile.spec.mjs must run (it changed, or a file it guards did)
// smoke and golden already run in the gate; chatjudge has its own 8-minute clock (nightly). mobile.spec.mjs has its own project, so it is never in `specs`.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_SPECS = 10;
const ALREADY = new Set(["test/smoke.spec.mjs", "test/golden.spec.mjs"]);
const OWN_JOB = new Set(["test/mobile.spec.mjs", "test/chatjudge.spec.mjs"]);
const PHONE_FILES = new Set(["src/viewport.js", "src/beginner.js", "src/advanced.js", "src/index.html", "src/rotationui.js", "src/pivot.js", "src/fineturn.js"]);
// a path reaches Playwright as a filter and bash as one array element: letters, digits, _ . - and spaces only
const SPEC_NAME = /^test\/[A-Za-z0-9_. -]+\.spec\.mjs$/;

export function select(paths, exists = existsSync) {
  const notices = [];
  let specs = [];
  let mobile = false;
  for (const path of paths) {
    if (PHONE_FILES.has(path) || path === "test/mobile.spec.mjs") mobile = true;
    if (!/^test\/[^/]+\.spec\.mjs$/.test(path) || ALREADY.has(path) || OWN_JOB.has(path)) continue;
    if (!SPEC_NAME.test(path)) { notices.push(`skipped ${JSON.stringify(path)}: the name has characters outside letters, digits, _ . - and space`); continue; }
    if (!exists(path)) continue; // deleted in this pull request
    specs.push(path);
  }
  specs = [...new Set(specs)].sort();
  if (specs.length > MAX_SPECS) {
    notices.push(`${specs.length} spec files changed: running the first ${MAX_SPECS} only (the nightly runs the rest): ${specs.slice(MAX_SPECS).join(" ")}`);
    specs = specs.slice(0, MAX_SPECS);
  }
  if (mobile && !exists("test/mobile.spec.mjs")) mobile = false;
  return { specs, mobile, notices };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const list = process.env.CHANGED_LIST;
  if (!list) { console.error("CHANGED_LIST is not set"); process.exit(1); }
  const paths = readFileSync(list, "utf8").split("\0").filter(Boolean);
  const { specs, mobile, notices } = select(paths);
  for (const n of notices) console.log(`::notice::${n.replace(/[\r\n%]/g, " ")}`);
  console.log(`changed specs to run: ${JSON.stringify(specs)}; mobile walk: ${mobile}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `specs=${JSON.stringify(specs)}\nmobile=${mobile}\n`);
}
