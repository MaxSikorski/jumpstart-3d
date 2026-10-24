// Prints the tests a change needs, so a local run and CI's "changed specs" job start from the same list and nobody guesses.
// The change = the files that differ between `git merge-base <base> HEAD` (default base origin/main) and the working tree: committed, staged,
// edited and untracked (not ignored) files, deleted files too. Rules, each printed as the reason of the spec it adds:
//   a changed test/*.spec.mjs         itself (CI's list from tools/ci-select-specs.mjs, plus smoke, golden, mobile and chatjudge, which CI runs elsewhere, and no cap of 10)
//   a changed test/*.test.mjs         itself, with `node --test` (the FreeCAD test, judge.integration, is CI-only and only noted)
//   a src/ or tools/ file             the spec or node test of the same name (src/gears.js -> gears.spec.mjs, tools/agent/check-map.mjs -> check-map.test.mjs),
//                                     and any spec that imports it or names it (`src/x.js`, `../tools/x.mjs`); a node test counts only when it imports it;
//                                     a tools/ script also counts through the tools/ scripts that import it (one hop: ports.mjs -> status.mjs -> status.test.mjs)
//   geometry, import, export code     golden.spec.mjs (src/kernel.js, worker.js, gears.js, ..., third_party/replicad/**; the list is GEOMETRY_SRC and GEOMETRY_DIRS below)
//   src/app.js, index.html, build.mjs, src/style*.css, package.json, playwright.config.mjs ...   smoke.spec.mjs
//   mcp/**, src/bridge.js, skills/**, .claude-plugin/**, README.md, and every file mcp/test/*.mjs reads (MCP_FILES)   `npm run test:mcp` (the MCP tests read the README, the skill and the plugin files)
//   src/tutorial*.js, a new <button id> in src/index.html, an added el("button") / <button / data-act line in advanced, beginner, simulate, app.js or index.html
//                                     the tutorials specs (every toolbar button needs a lesson or an entry in test/tutorial-gaps.json)
//   a module whose spec has another name   the ALIAS table below (src/fineturn.js -> fine-rotate.spec.mjs, ...)
//   a src/ or third_party/ file nothing above names   smoke (the app must still boot)
//   a file used by more than SHARED_MAX tests (test/helpers.mjs)   smoke stands in; the nightly runs the rest
//   docs (*.md outside src/, LICENSES/, GitHub templates) that no test reads   nothing: `OK no specs needed (docs only)`
// Output: one `spec <file>  ← <reason>` line per test, `note:` lines, then the commands to paste (Playwright, `node --test`, `npm run test:mcp`)
// and a last line `affected-specs: <n> spec(s)`. Exit 0 = listed (also when nothing is needed), 1 = git could not say (FAIL line), 2 = bad usage.
// Read-only: git runs through execFile with argument arrays; the only network-like call is freePort's connect to 127.0.0.1 (tools/agent/ports.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { select } from "../ci-select-specs.mjs";
import { freePort } from "./ports.mjs";

const USAGE = "usage: node tools/agent/affected-specs.mjs [--base <ref>] [--root <repo>] [--json] [--help]  "
  + "(the tests needed by the files changed since `git merge-base <base> HEAD`, uncommitted and untracked included; default base origin/main, default root = this repo)";
export const SHARED_MAX = 8; // a file that more tests than this use is shared infrastructure: smoke stands in for all of them
const SMOKE = "test/smoke.spec.mjs";
const FALLBACK = "no spec names it: "; // the reason smoke gets for a src/ or third_party/ file that no rule and no test names
const GOLDEN = "test/golden.spec.mjs";
const SPEC = /^test\/[^/\r\n]+\.spec\.mjs$/; // the same shape tools/ci-select-specs.mjs accepts
const NODE_TEST = /^test\/(?:bench\/)?[^/\r\n]+\.test\.mjs$/;
// Found by a stem or a reference but never listed for that: long or nightly-only (fuzz, chat judge), their own CI job (the phone walk), or needing a tool only CI has (FreeCAD).
// They are listed when the change touches them directly (the FreeCAD one only gets a note).
const NOT_AUTO = new Set(["test/fuzz.spec.mjs", "test/chatjudge.spec.mjs", "test/mobile.spec.mjs", "test/judge.integration.test.mjs"]);
const CI_ONLY = new Set(["test/judge.integration.test.mjs"]);

// Geometry, import and export code (testing.md: golden.spec.mjs "when geometry, import or export code changed"): the kernel and its worker, the modules that build or
// read or write solids, and the pinned libraries under them. A change here can move a golden hash.
const GEOMETRY_SRC = new Set([
  "kernel", "kernelClient", "worker", "inflate", "fonts", "textgeo", "facepat", "combinesplit", "ops", "regions", "constraints", "params",
  "importers", "meshimport", "meshdetail", "objimport", "gltf", "paint3mf", "dxf", "projects", "store", "scene",
  "gears", "fasteners", "holepattern", "knurl", "spring", "nameplate", "pipecoil", "bricks",
].map((n) => `src/${n}.js`));
GEOMETRY_SRC.add("src/occt-gz.wasm");
const GEOMETRY_DIRS = ["third_party/replicad/", "third_party/replicad-opencascadejs/", "third_party/manifold-3d/", "third_party/opentype.js/", "src/fontsub/"];
const BOOT = new Set(["src/app.js", "src/index.html", "build.mjs", "package.json", "package-lock.json", "playwright.config.mjs", "size-budget.json", "test/serve.mjs"]);
// Files the MCP tests read that are not under mcp/ (mcp/test/*.mjs is also scanned for ../../ paths, so a new one is found without editing this list).
const MCP_FILES = new Set(["src/bridge.js", "README.md", "src/chattools.js", "package.json", "src/app.js", "tools/bridge-demo.js", "test/projects/advanced-hole.json"]);
const MCP_DIRS = ["mcp/", "skills/", ".claude-plugin/"];
const DOC_DIRS = ["LICENSES/", ".github/ISSUE_TEMPLATE/"];
const DOC_FILES = new Set(["LICENSE", ".github/PULL_REQUEST_TEMPLATE.md", ".github/FUNDING.yml"]);

const isGeometry = (p) => GEOMETRY_SRC.has(p) || (GEOMETRY_DIRS.some((d) => p.startsWith(d)) && !/\.md$/i.test(p));
const isBoot = (p) => BOOT.has(p) || /^src\/style[^/]*\.css$/.test(p) || /^LICENSES\/OFL/.test(p); // build.mjs copies the font license into docs/fonts

// Modules whose spec carries another name than the module (the same-name rule cannot see these). Every spec named here must exist in test/ (the test checks it).
export const ALIAS = [
  [/^src\/fineturn\.js$/, ["fine-rotate"]],
  [/^src\/rotationui\.js$/, ["rotation-access"]],
  [/^src\/printsim\.js$/, ["printerpreview", "paint3mf"]],
  [/^src\/chat(?:providers|tools)\.js$/, ["chat"]],
  [/^src\/recovery\.js$/, ["storage-chaos"]],
  [/^src\/(?:arch(?:flood|land|plan|weather)?|cam(?:core|worker)?)\.js$/, ["upstream25"]],
  [/^src\/projects\.js$/, ["storage", "storage-chaos", "backup", "restorefolder"]],
  [/^src\/projstore\.js$/, ["storage", "storage-chaos"]],
];
// The files a toolbar button can be added in, and the line shapes that add one (tutorials.spec scans every visible button).
const BUTTON_FILES = new Set(["src/advanced.js", "src/beginner.js", "src/simulate.js", "src/app.js", "src/index.html"]);
const BUTTON_LINE = /el\("button"|<button|data-act/;
const addedLines = (before, after) => { // the lines of `after` that `before` lacks (a multiset difference, so a moved line is not new)
  const have = new Map();
  for (const l of before.split("\n")) have.set(l, (have.get(l) ?? 0) + 1);
  return after.split("\n").filter((l) => { const n = have.get(l) ?? 0; if (n > 0) { have.set(l, n - 1); return false; } return true; });
};
const isMcp = (p) => MCP_FILES.has(p) || MCP_DIRS.some((d) => p.startsWith(d));
const isTutorialCode = (p) => /^src\/tutorial[^/]*\.js$/.test(p);
const isDoc = (p) => (/\.md$/i.test(p) && !p.startsWith("src/")) || DOC_DIRS.some((d) => p.startsWith(d)) || DOC_FILES.has(p);

// ---- git ---------------------------------------------------------------------------------------------------------------------------------------------------

class Fail extends Error {}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Fail(`FAIL: git ${args[0]} failed in ${root}: ${String(e.stderr ?? e.message).trim().split("\n")[0]} → check --root and --base`);
  }
}

// The changed files as [{ path, status }]: status A, M, D (deleted), T, or U (untracked).
export function changedFiles(root, base) {
  git(root, ["rev-parse", "--git-dir"]);
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Fail(`FAIL: base ${base} not found → git fetch origin, or pass --base <ref>`);
  }
  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Fail(`FAIL: ${base} and HEAD share no history → pass --base <ref> of this repo's own main`);
  }
  const changed = new Map();
  const tracked = git(root, ["diff", "--name-status", "--no-renames", "--ignore-submodules", "-z", mergeBase, "--"]).split("\0");
  for (let i = 0; i + 1 < tracked.length; i += 2) changed.set(tracked[i + 1], tracked[i][0]);
  for (const p of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) changed.set(p, "U");
  return { mergeBase, changed: [...changed].map(([path, status]) => ({ path, status })).sort((a, b) => (a.path < b.path ? -1 : 1)) };
}

// ---- which tests exist, and what each one uses ---------------------------------------------------------------------------------------------------------------

// { specs, nodes, mcp }: the Playwright specs, the node tests and the MCP tests (mcp/test/*.mjs) found under root. plan() takes another function with this shape.
export function listTests(root) {
  const ls = (dir) => { try { return readdirSync(join(root, dir)).sort(); } catch { return []; } };
  return {
    specs: ls("test").map((f) => `test/${f}`).filter((p) => SPEC.test(p)),
    nodes: [...ls("test").map((f) => `test/${f}`), ...ls("test/bench").map((f) => `test/bench/${f}`)].filter((p) => NODE_TEST.test(p)),
    mcp: ls("mcp/test").filter((f) => f.endsWith(".mjs")).map((f) => `mcp/test/${f}`),
  };
}
export function listTools(root) { // the tools/ scripts that can import another tools/ script
  const out = [];
  for (const dir of ["tools", "tools/agent"]) { try { for (const f of readdirSync(join(root, dir)).sort()) if (f.endsWith(".mjs")) out.push(`${dir}/${f}`); } catch { /* no such folder */ } }
  return out;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stemOf = (p) => norm(basename(p).replace(/\.(?:spec|test)\.mjs$/, "").replace(/\.[^.]*$/, ""));

// The repo paths one test file uses: every ./ or ../ string resolved against the file (imports, new URL, readFileSync), and for a Playwright spec also
// every bare src/..., tools/..., mcp/... path written in it (not a Markdown file). A node test is about paths themselves, so a path in its fixtures does not count.
export function usedPaths(testPath, text, { bare }) {
  const used = new Set();
  for (const m of text.matchAll(/["'`](\.{1,2}\/[^"'`$\n]*)(\$\{)?/g)) {
    const p = posix.join(posix.dirname(testPath), m[1]).replace(/\/+$/, "");
    if (p.startsWith("..") || p === ".") continue;
    // ../tools/agent/${name}: only the folder is written, so it says nothing about one file; under test/ a folder is read whole (./fixtures/status/${name})
    if (m[2] && !(p.startsWith("test/") && p.length > 5)) continue;
    used.add(p);
    // an esbuild stdin written in test/ says "./src/x.js" and means the repo root's src/x.js: count that reading too (nothing in test/ is named src/, tools/, ...)
    const rooted = /^test\/((?:src|tools|mcp|third_party|skills)\/.*)$/.exec(p);
    if (rooted) used.add(rooted[1]);
  }
  if (bare) for (const m of text.matchAll(/(?<![\w.-])(?<![\w-]\/)((?:src|tools|mcp|third_party|test|skills)\/[\w./-]*\w)/g)) if (!/\.md$/i.test(m[1])) used.add(m[1]); // a comment that names a document does not make the test read it
  return used;
}

// ---- the plan ------------------------------------------------------------------------------------------------------------------------------------------------

const BUTTON_ID = /<button\b[^>]*?(?<![\w-])id\s*=\s*["']([^"'${}\s]+)["']/g;
const buttonIds = (html) => new Set([...html.matchAll(BUTTON_ID)].map((m) => m[1]));

// changed = [{ path, status }]. env: { root, exists(path), read(path) (working tree text), readBase(path) (text at the merge-base, "" when new) }.
// Returns { tests: Map(file -> { kind, reasons[] }), notes[], docsOnly }.
// env.listTests(root) -> { specs, nodes, mcp } and env.listTools(root) -> ["tools/x.mjs", ...] can be replaced, so a test can hand the plan its files as data.
export function plan(changed, { root, exists = (p) => existsSync(join(root, p)), read = (p) => readFileSync(join(root, p), "utf8"), readBase = () => "", listTests: lt = listTests, listTools: ltools = listTools }) {
  const tests = new Map();
  const notes = [];
  const add = (file, kind, reason) => {
    const t = tests.get(file) ?? { kind, reasons: [] };
    tests.set(file, t);
    const named = t.reasons.some((r) => r === reason || r.endsWith(`: ${reason}`)); // "tutorials: src/x.js" already says "src/x.js"
    if (!named) t.reasons.push(reason);
  };
  const paths = changed.map((c) => c.path);
  const { specs, nodes, mcp = [] } = lt(root);
  const all = [...specs.map((file) => ({ file, kind: "playwright" })), ...nodes.map((file) => ({ file, kind: "node" }))];
  const used = new Map();
  const usedBy = (t) => {
    if (!used.has(t.file)) {
      let text = "";
      try { text = read(t.file); } catch { /* unreadable: uses nothing */ }
      used.set(t.file, usedPaths(t.file, text, { bare: t.kind === "playwright" }));
    }
    return used.get(t.file);
  };

  let mcpUses = null; // the repo paths mcp/test/*.mjs read (scanned when the first file needs it)
  const mcpReads = (p) => {
    mcpUses ??= new Set(mcp.flatMap((f) => { try { return [...usedPaths(f, read(f), { bare: false })]; } catch { return []; } }));
    return [...mcpUses].some((u) => u === p || (u.includes("/") && p.startsWith(`${u}/`)));
  };
  const toolUses = new Map(); // tools/ script -> the repo paths it imports (read when a tools/ file changed)
  const toolImporters = (p) => {
    if (!toolUses.size) for (const f of ltools(root)) { try { toolUses.set(f, usedPaths(f, read(f), { bare: false })); } catch { /* unreadable: imports nothing */ } }
    return [...toolUses].filter(([file, uses]) => file !== p && uses.has(p)).map(([file]) => file);
  };

  // CI's list first (the changed specs it would run), then the ones it leaves to other jobs or to the cap.
  for (const file of select(paths, exists).specs) add(file, "playwright", file);
  for (const p of paths) {
    if (SPEC.test(p) && exists(p)) add(p, "playwright", p);
    else if (NODE_TEST.test(p) && exists(p)) {
      if (CI_ONLY.has(p)) notes.push(`${p} needs FreeCAD, which only CI has: not listed`);
      else add(p, "node", p);
    } else if ((SPEC.test(p) || NODE_TEST.test(p)) && !exists(p)) notes.push(`${p} was deleted: nothing to run`);
  }

  const docs = [];
  const unmatched = [];
  const sharedSeen = new Set();
  for (const { path: p, status } of changed) {
    if (SPEC.test(p) || NODE_TEST.test(p)) continue; // done above
    let hit = false;

    if (isMcp(p) || mcpReads(p)) { add("mcp/test", "mcp", `mcp: ${p}`); hit = true; }
    if (isGeometry(p)) { add(GOLDEN, "playwright", `geometry: ${p}`); hit = true; }
    if (isBoot(p)) { add(SMOKE, "playwright", `boot: ${p}`); hit = true; }
    if (isTutorialCode(p)) for (const t of specs.filter((s) => /^test\/tutorials[^/]*\.spec\.mjs$/.test(s))) { add(t, "playwright", `tutorials: ${p}`); hit = true; }
    if (BUTTON_FILES.has(p) && status !== "D" && exists(p)) { // tutorials.spec scans every visible button: a line that adds one (base text against working text) asks for it
      const was = readBase(p);
      const now = read(p);
      const fresh = p === "src/index.html" ? [...buttonIds(now)].filter((id) => !buttonIds(was).has(id)) : [];
      const reason = fresh.length ? `new button #${fresh[0]}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""} in ${p}`
        : addedLines(was, now).some((l) => BUTTON_LINE.test(l)) ? `new button line in ${p}` : "";
      if (reason) {
        for (const t of specs.filter((s) => /^test\/tutorials\.spec\.mjs$/.test(s))) add(t, "playwright", `tutorials: ${reason}`);
        hit = true;
      }
    }
    for (const [rx, names] of ALIAS) if (rx.test(p)) for (const n of names) if (specs.includes(`test/${n}.spec.mjs`)) { add(`test/${n}.spec.mjs`, "playwright", p); hit = true; }

    // the tests of the same name and the tests that use this file; a tools/ script also counts through the tools/ scripts that import it (one hop)
    const targets = [{ file: p, label: p }];
    if (p.startsWith("tools/")) for (const importer of toolImporters(p)) targets.push({ file: importer, label: `${p} (via ${basename(importer)})` });
    for (const { file, label } of targets) {
      const byName = /^(?:src|tools)\//.test(file) ? all.filter((t) => stemOf(t.file) === stemOf(file)) : [];
      const byUse = all.filter((t) => [...usedBy(t)].some((u) => u === file || (u.includes("/") && file.startsWith(`${u}/`))));
      const users = byUse.filter((t) => !byName.includes(t) && !NOT_AUTO.has(t.file));
      for (const t of byName) if (!NOT_AUTO.has(t.file)) { add(t.file, t.kind, label); hit = true; }
      if (users.length > SHARED_MAX) {
        add(SMOKE, "playwright", `shared: ${label} (used by ${users.length} tests)`);
        if (!sharedSeen.has(file)) notes.push(`${file} is used by ${users.length} tests: smoke stands in, the nightly runs the rest`);
        sharedSeen.add(file);
        hit = true;
      } else for (const t of users) { add(t.file, t.kind, label); hit = true; }
      for (const t of [...byName, ...byUse]) if (CI_ONLY.has(t.file)) { hit = true; if (!notes.some((n) => n.startsWith(t.file))) notes.push(`${t.file} needs FreeCAD, which only CI has: not listed`); }
    }

    if (!hit) {
      if (isDoc(p)) docs.push(p);
      else if (/^(?:src|third_party)\//.test(p)) add(SMOKE, "playwright", `${FALLBACK}${p}`);
      else unmatched.push(p);
    }
  }
  for (const p of unmatched) notes.push(`${p}: no test names it`);
  return { tests, notes, docsOnly: paths.length > 0 && docs.length === paths.length };
}

// ---- output --------------------------------------------------------------------------------------------------------------------------------------------------

const shq = (s) => (/^[A-Za-z0-9_.\/=:@%+,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
const rx = (s) => s.replace(/[\][\\.*+?^${}()|]/g, "\\$&") + "$"; // Playwright reads a file argument as a case-insensitive regular expression: escaped and anchored as .github/workflows/test.yml does
const reasonText = (reasons) => { // the fallback reasons last, so the rules that name the spec are the ones shown
  const sorted = [...reasons].sort((a, b) => a.startsWith(FALLBACK) - b.startsWith(FALLBACK));
  return sorted.length > 3 ? `${sorted.slice(0, 3).join(", ")}, +${sorted.length - 3} more` : sorted.join(", ");
};

export function render(result, { port }) {
  const order = { playwright: 0, node: 1, mcp: 2 };
  const list = [...result.tests].map(([file, t]) => ({ file, ...t })).sort((a, b) => order[a.kind] - order[b.kind] || (a.file < b.file ? -1 : 1));
  const lines = list.map((t) => `spec ${t.file}  ← ${reasonText(t.reasons)}`);
  const commands = [];
  const pw = list.filter((t) => t.kind === "playwright").map((t) => shq(rx(t.file)));
  const nd = list.filter((t) => t.kind === "node").map((t) => shq(t.file));
  if (pw.length) commands.push(`node build.mjs && JS3D_PORT=${port ?? "<port>"} npx playwright test ${pw.join(" ")} --workers=2`);
  if (nd.length) commands.push(`node --test ${nd.join(" ")}`);
  if (list.some((t) => t.kind === "mcp")) commands.push("npm run test:mcp");
  return { list, lines, commands };
}

export async function run({ root, base, json = false }) {
  if (base.startsWith("-")) throw new Fail(`FAIL: base ${base} is not a ref → pass --base <ref>`);
  const { mergeBase, changed } = changedFiles(root, base);
  const readBase = (p) => { try { return execFileSync("git", ["show", `${mergeBase}:${p}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const result = plan(changed, { root, readBase });
  const needsPlaywright = [...result.tests.values()].some((t) => t.kind === "playwright");
  const port = needsPlaywright ? await freePort({ root }) : null;
  const { list, commands } = render(result, { port });
  if (json) {
    return JSON.stringify({
      base, mergeBase, changed, docsOnly: result.docsOnly,
      specs: list.map((t) => ({ file: t.file, kind: t.kind, reasons: t.reasons })), commands, notes: result.notes,
    }, null, 2);
  }
  return text(result, { port, base, changedCount: changed.length });
}

// The plain-text report: OK line when nothing is needed, spec lines, notes, commands, count.
export function text(result, { port = null, base = "origin/main", changedCount = 1 } = {}) {
  const { list, lines, commands } = render(result, { port });
  const reason = changedCount === 0 ? `no changes since ${base}` : result.docsOnly ? "docs only" : "nothing a test loads changed";
  const out = [];
  if (!list.length) out.push(`OK no specs needed (${reason})`);
  out.push(...lines, ...result.notes.map((n) => `note: ${n}`), ...commands, `affected-specs: ${list.length} spec(s)`);
  return out.join("\n");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) { // realpath: a script reached through a symlinked folder (macOS /tmp, /var) must still run
  let parsed;
  try {
    parsed = parseArgs({ options: { base: { type: "string" }, root: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } } });
  } catch (e) {
    console.error(`affected-specs: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const { values } = parsed;
  if (values.help) { console.log(USAGE); process.exit(0); }
  try {
    console.log(await run({
      root: resolve(values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..")),
      base: values.base ?? "origin/main",
      json: values.json ?? false,
    }));
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.log(e.message);
    process.exit(1);
  }
}
