// The affected-specs tool (tools/agent/affected-specs.mjs): which tests a change needs. Every case is a scratch git repo with a bare origin, built once
// as a template and copied per test; HOME and the git config point at a scratch folder, so nothing outside it is read or written. No network (the tool
// only asks 127.0.0.1 for a free test port, so the port number is never compared).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { select } from "../tools/ci-select-specs.mjs";

const TOOLS = fileURLToPath(new URL("../tools/", import.meta.url));
const TOOL = join(TOOLS, "agent", "affected-specs.mjs");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "affected-specs-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

const home = join(scratch, "home");
mkdirSync(home);
writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n[receive]\n\tautogc = false\n");
const ENV = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const put = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const touch = (repo, ...rels) => { for (const rel of rels) appendFileSync(join(repo, rel), "// edit\n"); };
const remove = (repo, rel) => rmSync(join(repo, rel));
const commit = (repo, msg = "change") => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", msg); };

const BUTTONS = '<header>\n<button id="btn-old">Old</button>\n<button class="tb" id="btn-second">Second</button>\n</header>\n<style>button { cursor: pointer; }</style>\n';
const BASE = {
  ".gitignore": "ignored/\ntest/ignored.spec.mjs\n",
  "README.md": "# readme\n", "BRIDGE.md": "# bridge\n", "NOTICE.md": "# notice\n", "LICENSES/MIT.txt": "mit\n", "LICENSE": "license\n",
  ".github/PULL_REQUEST_TEMPLATE.md": "# pr\n", ".github/workflows/test.yml": "name: test\n",
  "build.mjs": "//\n", "package.json": "{}\n", "size-budget.json": "{}\n",
  "src/app.js": "//\n", "src/index.html": BUTTONS, "src/style.css": "a {}\n", "src/README.md": "# src\n",
  "src/combinesplit.js": "//\n", "src/kernel.js": "//\n", "src/worker.js": "//\n", "src/gears.js": "//\n", "src/fasteners.js": "//\n", "src/pivot.js": "//\n", "src/bridge.js": "//\n",
  "src/arch.js": "//\n", "src/store.js": "//\n", "src/version.js": "//\n", "src/sw.js": "//\n", "src/tutorial_data.js": "//\n", "src/tutorials.js": "//\n",
  "src/fontsub/sans.ttf": "font\n", "src/occt-gz.wasm": "wasm\n",
  "third_party/replicad/src/index.ts": "//\n", "third_party/replicad/README.md": "# replicad\n", "third_party/three/build/three.js": "//\n",
  "mcp/server.mjs": "//\n", "mcp/README.md": "# mcp\n", "mcp/test/server.test.mjs": "//\n", "skills/jumpstart-3d/SKILL.md": "# skill\n", ".claude-plugin/marketplace.json": "{}\n",
  "tools/agent/check-map.mjs": "import \"./lib.mjs\";\n", "tools/agent/lib.mjs": "export {};\n", "tools/pages.mjs": "//\n", "tools/judge-exports.mjs": "//\n",
  "test/helpers.mjs": "export {};\n", "test/golden.json": "{}\n", "test/projects/a.json": "{}\n", "test/README.md": "# tests\n",
  "test/fixtures/map/AGENTS.fixture.md": "# fixture\n",
  "test/smoke.spec.mjs": 'import { VERSION } from "../src/version.js";\n',
  "test/golden.spec.mjs": 'const dir = new URL("./projects/", import.meta.url);\nconst file = new URL("./golden.json", import.meta.url);\n',
  "test/tutorials.spec.mjs": "//\n", "test/tutorials-walk.spec.mjs": "//\n",
  "test/combine-split.spec.mjs": "//\n", "test/pivot.spec.mjs": "//\n", "test/gears.spec.mjs": "//\n", "test/bridge.spec.mjs": "//\n",
  "test/report.spec.mjs": 'import { VERSION } from "../src/version.js";\n',
  "test/load.spec.mjs": "// the offline visit through src/sw.js\n",
  "test/fuzz.spec.mjs": "// a boolean that leaves nothing comes back with a message (src/kernel.js)\n",
  "test/mobile.spec.mjs": "//\n", "test/chatjudge.spec.mjs": "//\n", "test/gone.spec.mjs": "//\n",
  "test/check-map.test.mjs": 'import "../tools/agent/check-map.mjs";\nconst fx = new URL("./fixtures/map/", import.meta.url);\n',
  "test/judge.integration.test.mjs": 'import "../tools/judge-exports.mjs";\n',
  "test/bench/score.test.mjs": "//\n",
  "test/copies.test.mjs": 'for (const name of ["a", "b"]) new URL(`../tools/agent/${name}`, import.meta.url); // copies some tools, names none here\n',
  "test/pathy.test.mjs": 'const fixture = { "src/pivot.js": "//", "tools/agent/check-map.mjs": "//" }; // paths as data, not files this test reads\n',
  "test/vendor.spec.mjs": "// reads other/src/pivot.js, which is not ours, and says see test/README.md\n",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`test/shared${i}.spec.mjs`, 'import "./helpers.mjs";\n'])),
};

// The template: a work repo whose origin/main is its HEAD, and its bare origin. Each test gets a copy. (No background gc: it would pack and delete loose objects while a copy reads them.)
const template = join(scratch, "template");
mkdirSync(template);
git(template, "init", "-q", "--bare", "-b", "main", "origin.git");
mkdirSync(join(template, "work"));
git(join(template, "work"), "init", "-q", "-b", "main");
for (const [rel, text] of Object.entries(BASE)) put(join(template, "work"), rel, text);
commit(join(template, "work"), "base");
git(join(template, "work"), "remote", "add", "origin", join(template, "origin.git"));
git(join(template, "work"), "push", "-q", "-u", "origin", "main");

let counter = 0;
function fresh() {
  const dir = join(scratch, `t${++counter}`);
  cpSync(template, dir, { recursive: true });
  const repo = join(dir, "work");
  git(repo, "remote", "set-url", "origin", join(dir, "origin.git"));
  return repo;
}

function run(repo, args = [], { cwd, tool = TOOL } = {}) {
  const r = spawnSync(process.execPath, [tool, ...(repo ? ["--root", repo] : []), ...args], { encoding: "utf8", cwd, env: ENV });
  return { lines: r.stdout.trimEnd().split("\n"), stdout: r.stdout, stderr: r.stderr, code: r.status };
}
const unport = (l) => l.replace(/JS3D_PORT=\d+/, "JS3D_PORT=<port>");
const specLines = (r) => r.lines.filter((l) => l.startsWith("spec "));
const noteLines = (r) => r.lines.filter((l) => l.startsWith("note: "));
const pwLine = (r) => r.lines.map(unport).find((l) => l.startsWith("JS3D_PORT=")); // the Playwright command
const last = (r) => r.lines.at(-1);
// One repo for the many one-change questions; it is put back to the base after each (committed work gets a repo of its own).
let pool;
function ask(rel, { edit = touch } = {}) {
  pool ??= fresh();
  edit(pool, rel);
  const r = run(pool);
  git(pool, "reset", "-q", "--hard");
  git(pool, "clean", "-fdq");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  return { r, specs: specLines(r) };
}
// Several changed files in one repo, answered as data: { test file: all its reasons }.
function reasons(rels, { repo = fresh(), edit = touch } = {}) {
  for (const rel of rels) edit(repo, rel);
  const r = run(repo, ["--json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return Object.fromEntries(JSON.parse(r.stdout).specs.map((s) => [s.file, s.reasons]));
}

test("geometry code adds golden with the rule as the reason, and the nightly-only fuzz spec that names the kernel is not dragged in", () => {
  const { r, specs } = ask("src/kernel.js");
  assert.deepEqual(specs, ["spec test/golden.spec.mjs  ← geometry: src/kernel.js"]);
  assert.match(pwLine(r), /^JS3D_PORT=<port> npx playwright test test\/golden\.spec\.mjs --workers=2$/);
  assert.equal(last(r), "affected-specs: 1 spec(s)");
  const rels = ["src/kernel.js", "src/worker.js", "src/fasteners.js", "third_party/replicad/src/index.ts", "src/fontsub/sans.ttf", "src/occt-gz.wasm"];
  assert.deepEqual(reasons(rels), { "test/golden.spec.mjs": rels.sort().map((p) => `geometry: ${p}`) });
});

test("a geometry module that has a spec adds that spec as well; a Markdown file in a geometry folder adds nothing", () => {
  assert.deepEqual(ask("src/gears.js").specs, ["spec test/gears.spec.mjs  ← src/gears.js", "spec test/golden.spec.mjs  ← geometry: src/gears.js"]);
  // the name is compared without hyphens, underscores or case: combinesplit.js and combine-split.spec.mjs
  assert.deepEqual(ask("src/combinesplit.js").specs, ["spec test/combine-split.spec.mjs  ← src/combinesplit.js", "spec test/golden.spec.mjs  ← geometry: src/combinesplit.js"]);
  assert.deepEqual(ask("third_party/replicad/README.md").r.lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
});

test("app.js, index.html, build.mjs, the style sheets and the build and runner config add smoke", () => {
  assert.deepEqual(ask("src/app.js").specs, ["spec test/smoke.spec.mjs  ← boot: src/app.js"]);
  const rels = ["src/app.js", "src/index.html", "build.mjs", "src/style.css", "package.json", "size-budget.json"];
  assert.deepEqual(reasons(rels), { "test/smoke.spec.mjs": rels.sort().map((p) => `boot: ${p}`) });
});

test("mcp/, the bridge, the skill, the plugin files and the README add the mcp tests, with the command last", () => {
  const one = ask("mcp/server.mjs");
  assert.deepEqual(one.specs, ["spec mcp/test  ← mcp: mcp/server.mjs"]);
  assert.deepEqual(one.r.lines.slice(-2), ["npm run test:mcp", "affected-specs: 1 spec(s)"]);
  assert.equal(pwLine(one.r), undefined, "no Playwright line when no Playwright spec is needed");
  const rels = ["mcp/server.mjs", "mcp/README.md", "mcp/test/server.test.mjs", "README.md", "skills/jumpstart-3d/SKILL.md", ".claude-plugin/marketplace.json"];
  assert.deepEqual(reasons(rels), { "mcp/test": rels.sort().map((p) => `mcp: ${p}`) });
  const { r, specs } = ask("src/bridge.js");
  assert.deepEqual(specs, ["spec test/bridge.spec.mjs  ← src/bridge.js", "spec mcp/test  ← mcp: src/bridge.js"]);
  assert.deepEqual(r.lines.slice(-3).map(unport), ["JS3D_PORT=<port> npx playwright test test/bridge.spec.mjs --workers=2", "npm run test:mcp", "affected-specs: 2 spec(s)"]);
});

test("tutorial code adds every tutorials spec; a new button id in index.html adds the tutorials spec, an edited or removed one does not", () => {
  assert.deepEqual(ask("src/tutorial_data.js").specs, ["spec test/tutorials-walk.spec.mjs  ← tutorials: src/tutorial_data.js", "spec test/tutorials.spec.mjs  ← tutorials: src/tutorial_data.js"]);
  assert.deepEqual(ask("src/tutorials.js").specs, ["spec test/tutorials-walk.spec.mjs  ← tutorials: src/tutorials.js", "spec test/tutorials.spec.mjs  ← tutorials: src/tutorials.js"]);
  const edit = (change) => (repo) => put(repo, "src/index.html", change(BUTTONS));
  // a new button: smoke (boot) and tutorials
  assert.deepEqual(ask("src/index.html", { edit: edit((h) => h.replace("</header>", '<button id="btn-new">New</button>\n</header>')) }).specs, [
    "spec test/smoke.spec.mjs  ← boot: src/index.html",
    "spec test/tutorials.spec.mjs  ← tutorials: new button #btn-new in src/index.html",
  ]);
  // two new buttons
  assert.match(ask("src/index.html", { edit: edit((h) => h.replace("</header>", '<button id="a1">1</button><button id="a2">2</button>\n</header>')) }).specs[1], /new button #a1 \(\+1\) in src\/index\.html$/);
  // a renamed id counts as new; a new button with the id after other attributes too
  assert.match(ask("src/index.html", { edit: edit((h) => h.replace('id="btn-old"', 'id="btn-older"')) }).specs[1], /new button #btn-older/);
  assert.match(ask("src/index.html", { edit: edit((h) => h.replace("</header>", '<button type="button" class="x" id="btn-late">L</button>\n</header>')) }).specs[1], /new button #btn-late/);
  // same ids: a new label, a removed button, a button without an id, a data-id, a template id and a div with an id are not new toolbar buttons
  for (const change of [
    (h) => h.replace("Old", "Older"),
    (h) => h.replace('<button class="tb" id="btn-second">Second</button>\n', ""),
    (h) => h.replace("</header>", "<button>plain</button>\n</header>"),
    (h) => h.replace("</header>", '<button data-id="x1">d</button>\n</header>'),
    (h) => h.replace("</header>", '<button id="row-${n}">t</button>\n</header>'),
    (h) => h.replace("</header>", '<div id="not-a-button"></div>\n</header>'),
  ]) assert.deepEqual(ask("src/index.html", { edit: edit(change) }).specs, ["spec test/smoke.spec.mjs  ← boot: src/index.html"]);
});

test("a changed spec file is always in the list, smoke, golden, mobile, the chat judge and fuzz included, with no cap of 10", () => {
  for (const rel of ["test/pivot.spec.mjs", "test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs", "test/fuzz.spec.mjs"]) {
    assert.deepEqual(ask(rel).specs, [`spec ${rel}  ← ${rel}`], rel);
  }
  const repo = fresh();
  const names = Array.from({ length: 12 }, (_, i) => `test/s${String(i).padStart(2, "0")}.spec.mjs`);
  for (const n of names) put(repo, n, "//\n");
  const r = run(repo);
  assert.deepEqual(specLines(r), names.map((n) => `spec ${n}  ← ${n}`));
  assert.equal(last(r), "affected-specs: 12 spec(s)");
  assert.equal(noteLines(r).length, 0, "CI's cap notice is not repeated");
});

test("a tools/ script adds the node test of the same name, and the tests of the scripts that import it; a changed node test is itself", () => {
  let a = ask("tools/agent/check-map.mjs");
  assert.deepEqual(a.specs, ["spec test/check-map.test.mjs  ← tools/agent/check-map.mjs"]);
  assert.deepEqual(a.r.lines.slice(-2), ["node --test test/check-map.test.mjs", "affected-specs: 1 spec(s)"]);
  assert.equal(pwLine(a.r), undefined);
  a = ask("tools/agent/lib.mjs"); // imported by check-map.mjs: one hop
  assert.deepEqual(a.specs, ["spec test/check-map.test.mjs  ← tools/agent/lib.mjs (via check-map.mjs)"]);
  assert.deepEqual(ask("test/check-map.test.mjs").specs, ["spec test/check-map.test.mjs  ← test/check-map.test.mjs"]);
  assert.deepEqual(ask("test/bench/score.test.mjs").specs, ["spec test/bench/score.test.mjs  ← test/bench/score.test.mjs"]);
  // a fixture folder a test reads by a relative path, and a node test next to a Playwright line
  assert.deepEqual(ask("test/fixtures/map/AGENTS.fixture.md").specs, ["spec test/check-map.test.mjs  ← test/fixtures/map/AGENTS.fixture.md"]);
  const repo = fresh();
  touch(repo, "tools/agent/check-map.mjs", "src/pivot.js", "mcp/server.mjs");
  const r = run(repo);
  assert.deepEqual(r.lines.slice(-4).map(unport), ["JS3D_PORT=<port> npx playwright test test/pivot.spec.mjs --workers=2", "node --test test/check-map.test.mjs", "npm run test:mcp", "affected-specs: 3 spec(s)"]);
});

test("the FreeCAD test only CI can run is noted and not listed, also when it is the changed file", () => {
  const { r, specs } = ask("tools/judge-exports.mjs");
  assert.deepEqual(specs, []);
  assert.deepEqual(r.lines, ["OK no specs needed (nothing a test loads changed)", "note: test/judge.integration.test.mjs needs FreeCAD, which only CI has: not listed", "affected-specs: 0 spec(s)"]);
  const own = ask("test/judge.integration.test.mjs");
  assert.deepEqual(own.r.lines, ["OK no specs needed (nothing a test loads changed)", "note: test/judge.integration.test.mjs needs FreeCAD, which only CI has: not listed", "affected-specs: 0 spec(s)"]);
});

test("docs that nothing loads print OK no specs needed (docs only), exit 0; code next to docs gets its specs and no line for the docs", () => {
  const repo = fresh();
  touch(repo, "BRIDGE.md", "NOTICE.md", "LICENSES/MIT.txt", "LICENSE", "test/README.md", ".github/PULL_REQUEST_TEMPLATE.md");
  put(repo, "NEW-NOTES.md", "# notes\n"); // untracked
  const r = run(repo);
  assert.deepEqual(r.lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
  assert.equal(r.code, 0);
  touch(repo, "src/pivot.js");
  const mixed = run(repo);
  assert.deepEqual(specLines(mixed), ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
  assert.ok(!mixed.stdout.includes("docs only") && !mixed.stdout.includes("BRIDGE"));
  // Markdown in src/ is not docs-only; a document a test reads (a fixture) is not either
  assert.deepEqual(ask("src/README.md").specs, ["spec test/smoke.spec.mjs  ← no spec names it: src/README.md"]);
});

test("nothing changed: OK no specs needed (no changes since origin/main)", () => {
  const r = run(fresh());
  assert.deepEqual(r.lines, ["OK no specs needed (no changes since origin/main)", "affected-specs: 0 spec(s)"]);
  assert.equal(r.code, 0);
});

test("a src/ or third_party/ file that no rule and no test names gets smoke; a tools/ or workflow file nothing names gets a note", () => {
  for (const rel of ["src/arch.js", "src/store.js", "third_party/three/build/three.js"]) assert.deepEqual(ask(rel).specs, [`spec test/smoke.spec.mjs  ← no spec names it: ${rel}`], rel);
  const { r } = ask(".github/workflows/test.yml");
  assert.deepEqual(r.lines, ["OK no specs needed (nothing a test loads changed)", "note: .github/workflows/test.yml: no test names it", "affected-specs: 0 spec(s)"]);
  const t = ask("tools/pages.mjs").r;
  assert.deepEqual(t.lines, ["OK no specs needed (nothing a test loads changed)", "note: tools/pages.mjs: no test names it", "affected-specs: 0 spec(s)"]);
});

test("a module is mapped to the specs that import it or name it, not to a comment about a document; a folder a spec reads covers its files", () => {
  // src/version.js: smoke and report import it
  assert.deepEqual(ask("src/version.js").specs, ["spec test/report.spec.mjs  ← src/version.js", "spec test/smoke.spec.mjs  ← src/version.js"]);
  // src/sw.js: load.spec names it in a comment, which counts for a Playwright spec (grep test/ for the module)
  assert.deepEqual(ask("src/sw.js").specs, ["spec test/load.spec.mjs  ← src/sw.js"]);
  // test/projects/ and golden.json are read by golden.spec
  assert.deepEqual(ask("test/projects/a.json").specs, ["spec test/golden.spec.mjs  ← test/projects/a.json"]);
  assert.deepEqual(ask("test/golden.json").specs, ["spec test/golden.spec.mjs  ← test/golden.json"]);
});

test("a file that more than 8 tests use stands for them with smoke and a note, instead of 10 spec lines", () => {
  const { r, specs } = ask("test/helpers.mjs");
  assert.deepEqual(specs, ["spec test/smoke.spec.mjs  ← shared: test/helpers.mjs (used by 10 tests)"]);
  assert.deepEqual(noteLines(r), ["note: test/helpers.mjs is used by 10 tests: smoke stands in, the nightly runs the rest"]);
  const few = fresh(); // with 8 users the tests are listed one by one
  for (const i of [8, 9]) remove(few, `test/shared${i}.spec.mjs`);
  commit(few);
  git(few, "update-ref", "refs/remotes/origin/main", "HEAD");
  touch(few, "test/helpers.mjs");
  assert.equal(specLines(run(few)).length, 8);
});

test("untracked, staged and uncommitted files all count; ignored ones do not", () => {
  const repo = fresh();
  put(repo, "test/fresh.spec.mjs", "//\n"); // untracked
  put(repo, "test/ignored.spec.mjs", "//\n"); // untracked and ignored
  put(repo, "ignored/x.js", "//\n");
  put(repo, "test/staged.spec.mjs", "//\n");
  git(repo, "add", "test/staged.spec.mjs"); // new and staged
  touch(repo, "src/pivot.js"); // edited
  put(repo, "src/brand-new-module.js", "//\n"); // untracked module nothing names
  assert.deepEqual(specLines(run(repo)), [
    "spec test/fresh.spec.mjs  ← test/fresh.spec.mjs",
    "spec test/pivot.spec.mjs  ← src/pivot.js",
    "spec test/smoke.spec.mjs  ← no spec names it: src/brand-new-module.js",
    "spec test/staged.spec.mjs  ← test/staged.spec.mjs",
  ]);
});

test("a deleted file is a change: a deleted module still asks for its spec and the rules, a deleted spec is dropped with a note", () => {
  let repo = fresh();
  remove(repo, "src/pivot.js");
  assert.deepEqual(specLines(run(repo)), ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
  repo = fresh();
  remove(repo, "src/kernel.js");
  assert.deepEqual(specLines(run(repo)), ["spec test/golden.spec.mjs  ← geometry: src/kernel.js"]);
  repo = fresh();
  remove(repo, "src/arch.js");
  assert.deepEqual(specLines(run(repo)), ["spec test/smoke.spec.mjs  ← no spec names it: src/arch.js"]);
  repo = fresh();
  remove(repo, "test/gone.spec.mjs");
  remove(repo, "test/judge.integration.test.mjs");
  const r = run(repo);
  assert.deepEqual(r.lines, ["OK no specs needed (nothing a test loads changed)", "note: test/gone.spec.mjs was deleted: nothing to run", "note: test/judge.integration.test.mjs was deleted: nothing to run", "affected-specs: 0 spec(s)"]);
  repo = fresh();
  remove(repo, "BRIDGE.md");
  assert.deepEqual(run(repo).lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
});

test("the change is measured from the merge-base: committed work on a branch counts with uncommitted edits, what origin/main gained since does not", () => {
  const repo = fresh();
  const dir = dirname(repo);
  git(repo, "checkout", "-q", "-b", "feature");
  touch(repo, "src/pivot.js");
  commit(repo, "feature work");
  touch(repo, "src/arch.js"); // uncommitted
  // origin/main moves on without this branch: another clone changes the kernel and pushes
  git(dir, "clone", "-q", "origin.git", "other");
  touch(join(dir, "other"), "src/kernel.js", "src/bridge.js");
  commit(join(dir, "other"), "main moves on");
  git(join(dir, "other"), "push", "-q", "origin", "main");
  git(repo, "fetch", "-q", "origin");
  assert.notEqual(git(repo, "rev-parse", "origin/main"), git(repo, "merge-base", "origin/main", "HEAD"));
  const r = run(repo);
  assert.deepEqual(specLines(r), ["spec test/pivot.spec.mjs  ← src/pivot.js", "spec test/smoke.spec.mjs  ← no spec names it: src/arch.js"]);
  // --base picks another point: only the uncommitted file is newer than HEAD
  assert.deepEqual(specLines(run(repo, ["--base", "HEAD"])), ["spec test/smoke.spec.mjs  ← no spec names it: src/arch.js"]);
  assert.deepEqual(specLines(run(repo, ["--base", "main"])), ["spec test/pivot.spec.mjs  ← src/pivot.js", "spec test/smoke.spec.mjs  ← no spec names it: src/arch.js"]);
});

test("agreement with CI: every spec tools/ci-select-specs.mjs picks for a list of changed paths is listed with its own path as the reason", () => {
  const repo = fresh();
  const specs = ["test/pivot.spec.mjs", "test/gears.spec.mjs", "test/load.spec.mjs", "test/new-one.spec.mjs", "test/two words.spec.mjs", "test/c++.spec.mjs", "test/$(x).spec.mjs"];
  const others = ["test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs", "test/helpers.mjs", "test/projects/a.spec.mjs", "src/arch.js", "README.md"];
  for (const p of [...specs, ...others]) { put(repo, p, "//\nedit\n"); }
  remove(repo, "test/gone.spec.mjs");
  const paths = [...specs, ...others, "test/gone.spec.mjs"];
  const exists = (p) => p !== "test/gone.spec.mjs";
  const ci = select(paths, exists).specs;
  assert.deepEqual(ci, [...specs].sort()); // CI's own answer for this list
  const r = run(repo);
  for (const p of ci) assert.ok(specLines(r).includes(`spec ${p}  ← ${p}`), `${p} is listed with itself as the reason`);
  assert.ok(!r.stdout.includes("test/gone.spec.mjs  ←"));
  // what CI runs elsewhere is listed too
  for (const p of ["test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs"]) assert.ok(specLines(r).some((l) => l.startsWith(`spec ${p}  ← ${p}`)), p);
});

test("the Playwright line can be pasted: names with spaces, plus signs and shell characters survive the shell and keep their regular-expression meaning", () => {
  const repo = fresh();
  const names = ["test/two words.spec.mjs", "test/c++.spec.mjs", "test/a(b).spec.mjs", "test/$(x).spec.mjs", "test/it's.spec.mjs", "test/plain.spec.mjs"];
  for (const n of names) put(repo, n, "//\n");
  const line = pwLine(run(repo));
  const [, middle] = /^JS3D_PORT=<port> npx playwright test (.*) --workers=2$/.exec(line);
  const parsed = spawnSync("sh", ["-c", `printf '%s\\n' ${middle}`], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  const escape = (s) => s.replace(/[\][\\*+?^${}()|]/g, "\\$&");
  assert.deepEqual(parsed.stdout.trimEnd().split("\n"), [...names].sort().map(escape));
  // each argument, read as a regular expression, matches its own file
  for (const [i, arg] of parsed.stdout.trimEnd().split("\n").entries()) assert.ok(new RegExp(arg, "i").test([...names].sort()[i]), arg);
});

test("--json prints the same plan as data", () => {
  const repo = fresh();
  touch(repo, "src/pivot.js", "mcp/server.mjs");
  const r = run(repo, ["--json"]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.base, "origin/main");
  assert.equal(j.mergeBase, git(repo, "rev-parse", "HEAD").trim());
  assert.deepEqual(j.changed, [{ path: "mcp/server.mjs", status: "M" }, { path: "src/pivot.js", status: "M" }]);
  assert.equal(j.docsOnly, false);
  assert.deepEqual(j.specs, [
    { file: "test/pivot.spec.mjs", kind: "playwright", reasons: ["src/pivot.js"] },
    { file: "mcp/test", kind: "mcp", reasons: ["mcp: mcp/server.mjs"] },
  ]);
  assert.equal(j.commands.at(-1), "npm run test:mcp");
  assert.match(j.commands[0], /^JS3D_PORT=(?:\d+|<port>) npx playwright test test\/pivot\.spec\.mjs --workers=2$/);
  assert.deepEqual(j.notes, []);
  const docs = fresh();
  touch(docs, "BRIDGE.md");
  assert.equal(JSON.parse(run(docs, ["--json"]).stdout).docsOnly, true);
});

test("the Playwright line gets a real free port from tools/agent/ports.mjs", () => {
  const repo = fresh();
  touch(repo, "src/pivot.js");
  const m = /^JS3D_PORT=(\d+) /.exec(run(repo).lines.find((l) => l.startsWith("JS3D_PORT=")));
  if (m) assert.ok(Number(m[1]) >= 8805 && Number(m[1]) <= 8895 && (Number(m[1]) - 8805) % 10 === 0, m[1]); // else every test port is busy on this machine: "<port>"
});

test("--help prints one usage line; a wrong option, a stray argument or a base that is not a ref is refused", () => {
  const help = run(null, ["--help"]);
  assert.equal(help.lines.length, 1);
  assert.match(help.lines[0], /^usage: node tools\/agent\/affected-specs\.mjs /);
  assert.equal(help.code, 0);
  assert.equal(run(null, ["--nope"]).code, 2);
  assert.equal(run(fresh(), ["pivot"]).code, 2);
  assert.equal(run(fresh(), ["--base"]).code, 2);
  const flag = run(fresh(), ["--base=--help"]);
  assert.equal(flag.code, 1);
  assert.match(flag.lines[0], /^FAIL: base --help is not a ref → pass --base <ref>$/);
});

test("a git problem is one FAIL line with the next step and exit 1: no such base, not a repository, no common history", () => {
  const repo = fresh();
  const base = run(repo, ["--base", "origin/nowhere"]);
  assert.deepEqual(base.lines, ["FAIL: base origin/nowhere not found → git fetch origin, or pass --base <ref>"]);
  assert.equal(base.code, 1);
  const notRepo = run(join(scratch, "home"));
  assert.equal(notRepo.code, 1);
  assert.match(notRepo.lines[0], /^FAIL: git rev-parse failed in .+ → check --root and --base$/);
  assert.equal(notRepo.lines.length, 1);
  git(repo, "checkout", "-q", "--orphan", "island");
  commit(repo, "unrelated history");
  const island = run(repo);
  assert.deepEqual(island.lines, ["FAIL: origin/main and HEAD share no history → pass --base <ref> of this repo's own main"]);
  assert.equal(island.code, 1);
});

test("without --root the tool works on the repo two folders above itself, from any working folder", () => {
  const repo = fresh();
  mkdirSync(join(repo, "tools", "agent"), { recursive: true });
  cpSync(join(TOOLS, "ci-select-specs.mjs"), join(repo, "tools", "ci-select-specs.mjs"));
  for (const f of ["affected-specs.mjs", "ports.mjs"]) cpSync(join(TOOLS, "agent", f), join(repo, "tools", "agent", f));
  commit(repo, "tools");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  touch(repo, "src/pivot.js");
  const r = run(null, [], { cwd: scratch, tool: join(repo, "tools", "agent", "affected-specs.mjs") });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(specLines(r), ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
});

test("the reasons shown are the first three that name the spec, the fallback last, and the rest are counted", () => {
  const repo = fresh();
  touch(repo, "src/app.js", "build.mjs", "package.json", "src/index.html", "src/style.css");
  put(repo, "src/aaa-new.js", "//\n"); // sorts before src/app.js, but its reason is the fallback
  assert.deepEqual(specLines(run(repo)), ["spec test/smoke.spec.mjs  ← boot: build.mjs, boot: package.json, boot: src/app.js, +3 more"]);
});
