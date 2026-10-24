// The affected-specs tool (tools/agent/affected-specs.mjs): which tests a change needs.
// The rule cases call plan() in the same process with the changed files and their text as data (a made-up repo, no disk, no git, no child process).
// A few cases run the real command on a scratch git repo with a bare origin (built once as a template, copied per test; HOME and the git config point at a
// scratch folder, so nothing outside it is read or written): untracked, staged and deleted files, the merge-base, --json, the exit codes, the free port.
// No network (the tool only asks 127.0.0.1 for a free test port, so the port number is never compared).
import test, { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { select } from "../tools/ci-select-specs.mjs";
import { ALIAS, listTests, plan, text, usedPaths } from "../tools/agent/affected-specs.mjs";

const TOOLS = fileURLToPath(new URL("../tools/", import.meta.url));
const TOOL = join(TOOLS, "agent", "affected-specs.mjs");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "affected-specs-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

// ---- the made-up repo: path -> text ---------------------------------------------------------------------------------------------------------------------------
// Paths a fixture mentions are built from parts (rel(".", "fixtures", "map", "")), so this file does not itself read them: the tool would otherwise count every
// fixture string here as a real use of that file.
const rel = (...parts) => parts.join("/");
const imp = (...parts) => `import "${rel(...parts)}";\n`;
const BUTTONS = '<header>\n<button id="btn-old">Old</button>\n<button class="tb" id="btn-second">Second</button>\n</header>\n<style>button { cursor: pointer; }</style>\n';
const ALIAS_SPECS = ["fine-rotate", "rotation-access", "printerpreview", "paint3mf", "chat", "storage", "storage-chaos", "backup", "restorefolder", "upstream25"];
const BASE = {
  ".gitignore": "ignored/\ntest/ignored.spec.mjs\n",
  "README.md": "# readme\n", "BRIDGE.md": "# bridge\n", "NOTICE.md": "# notice\n", "LICENSES/MIT.txt": "mit\n", "LICENSES/OFL-1.1-fonts.txt": "ofl\n", "LICENSE": "license\n",
  ".github/PULL_REQUEST_TEMPLATE.md": "# pr\n", ".github/workflows/test.yml": "name: test\n",
  "build.mjs": "//\n", "package.json": "{}\n", "size-budget.json": "{}\n",
  "src/app.js": "//\n", "src/index.html": BUTTONS, "src/style.css": "a {}\n", "src/README.md": "# src\n",
  "src/advanced.js": "//\n", "src/beginner.js": "//\n", "src/simulate.js": "//\n",
  "src/combinesplit.js": "//\n", "src/kernel.js": "//\n", "src/worker.js": "//\n", "src/gears.js": "//\n", "src/fasteners.js": "//\n", "src/pivot.js": "//\n", "src/bridge.js": "//\n",
  "src/store.js": "//\n", "src/scene.js": "//\n", "src/version.js": "//\n", "src/sw.js": "//\n", "src/orphan.js": "//\n", "src/tutorial_data.js": "//\n", "src/tutorials.js": "//\n",
  "src/fineturn.js": "//\n", "src/rotationui.js": "//\n", "src/printsim.js": "//\n", "src/chatproviders.js": "//\n", "src/chattools.js": "//\n", "src/recovery.js": "//\n",
  "src/arch.js": "//\n", "src/archplan.js": "//\n", "src/cam.js": "//\n", "src/camcore.js": "//\n", "src/projects.js": "//\n", "src/projstore.js": "//\n",
  "src/fontsub/sans.ttf": "font\n", "src/occt-gz.wasm": "wasm\n",
  "third_party/replicad/src/index.ts": "//\n", "third_party/replicad/README.md": "# replicad\n", "third_party/three/build/three.js": "//\n",
  "mcp/server.mjs": "//\n", "mcp/README.md": "# mcp\n", "mcp/test/server.test.mjs": "//\n", "skills/jumpstart-3d/SKILL.md": "# skill\n", ".claude-plugin/marketplace.json": "{}\n",
  "mcp/test/chat.test.mjs": imp("..", "..", "src", "chattools.js"), // the MCP tests read these without mcp/ in their names
  "mcp/test/cli.test.mjs": `new URL("${rel("..", "..", "test", "projects", "advanced-hole.json")}", import.meta.url);\nnew URL("${rel("..", "..", "tools", "bridge-demo.js")}", import.meta.url);\n`,
  "tools/bridge-demo.js": "//\n", "test/projects/advanced-hole.json": "{}\n",
  "tools/agent/check-map.mjs": imp(".", "lib.mjs"), "tools/agent/lib.mjs": "export {};\n", "tools/pages.mjs": "//\n", "tools/judge-exports.mjs": "//\n",
  "test/helpers.mjs": "export {};\n", "test/golden.json": "{}\n", "test/projects/a.json": "{}\n", "test/README.md": "# tests\n",
  "test/fixtures/map/AGENTS.fixture.md": "# fixture\n", "test/fixtures/status/ok.txt": "ok\n", "test/fixtures/other/x.txt": "x\n",
  "test/smoke.spec.mjs": `import { VERSION } from "${rel("..", "src", "version.js")}";\n`,
  "test/golden.spec.mjs": `const dir = new URL("${rel(".", "projects", "")}", import.meta.url);\nconst file = new URL("${rel(".", "golden.json")}", import.meta.url);\n`,
  "test/tutorials.spec.mjs": "//\n", "test/tutorials-walk.spec.mjs": "//\n",
  "test/combine-split.spec.mjs": "//\n", "test/pivot.spec.mjs": "//\n", "test/gears.spec.mjs": "//\n", "test/bridge.spec.mjs": "//\n",
  "test/report.spec.mjs": `import { VERSION } from "${rel("..", "src", "version.js")}";\n`,
  "test/load.spec.mjs": "// the offline visit through src/sw.js\n",
  "test/fuzz.spec.mjs": "// a boolean that leaves nothing comes back with a message (src/kernel.js)\n",
  "test/mobile.spec.mjs": "//\n", "test/chatjudge.spec.mjs": "//\n", "test/gone.spec.mjs": "//\n",
  ...Object.fromEntries(ALIAS_SPECS.map((n) => [`test/${n}.spec.mjs`, "//\n"])),
  "test/check-map.test.mjs": `${imp("..", "tools", "agent", "check-map.mjs")}const fx = new URL("${rel(".", "fixtures", "map", "")}", import.meta.url);\n`,
  "test/status.test.mjs": "const f = `" + rel(".", "fixtures", "status") + "/${name}`; // a folder, and one file in it picked at run time\n",
  "test/judge.integration.test.mjs": imp("..", "tools", "judge-exports.mjs"),
  "test/bench/score.test.mjs": "//\n",
  "test/copies.test.mjs": "for (const name of [\"a\", \"b\"]) new URL(`" + rel("..", "tools", "agent") + "/${name}`, import.meta.url); // copies some tools, names none here\n",
  "test/pathy.test.mjs": 'const fixture = { "src/pivot.js": "//", "tools/agent/check-map.mjs": "//" }; // paths as data, not files this test reads\n',
  "test/vendor.spec.mjs": "// reads other/src/pivot.js, which is not ours, and says see test/README.md\n",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`test/shared${i}.spec.mjs`, imp(".", "helpers.mjs")])),
};

const SPEC_FILE = /^test\/[^/]+\.spec\.mjs$/;
const NODE_FILE = /^test\/(?:bench\/)?[^/]+\.test\.mjs$/;
// changes: "path" = edited (its text gets a line), ["path", "text"] = new or rewritten, ["path", null] = deleted. Returns what the command would print, and the plan.
function inproc(changes, { base = BASE, port = null } = {}) {
  const work = { ...base };
  const changed = [];
  for (const c of changes) {
    const [path, body] = typeof c === "string" ? [c, base[c] + "// edit\n"] : c;
    const status = body === null ? "D" : path in base ? "M" : "U";
    if (body === null) delete work[path]; else work[path] = body;
    changed.push({ path, status });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : 1));
  const keys = Object.keys(work);
  const result = plan(changed, {
    root: "/nowhere",
    exists: (p) => p in work,
    read: (p) => { if (!(p in work)) throw new Error(`no ${p}`); return work[p]; },
    readBase: (p) => base[p] ?? "",
    listTests: () => ({ specs: keys.filter((k) => SPEC_FILE.test(k)), nodes: keys.filter((k) => NODE_FILE.test(k)), mcp: keys.filter((k) => /^mcp\/test\/[^/]+\.mjs$/.test(k)) }),
    listTools: () => keys.filter((k) => /^tools\/(?:agent\/)?[^/]+\.mjs$/.test(k)),
  });
  const out = text(result, { port, base: "origin/main", changedCount: changed.length });
  const lines = out.split("\n");
  return { result, out, lines, specs: lines.filter((l) => l.startsWith("spec ")), notes: lines.filter((l) => l.startsWith("note: ")), why: Object.fromEntries([...result.tests].map(([f, t]) => [f, t.reasons])) };
}
const ask = (path, body) => inproc([body === undefined ? path : [path, body]]);
const pwOf = (r) => r.lines.find((l) => l.includes("JS3D_PORT="));

// ---- a scratch git repo, for the cases that need git --------------------------------------------------------------------------------------------------------
const home = join(scratch, "home");
mkdirSync(home);
writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n[receive]\n\tautogc = false\n");
const ENV = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const put = (repo, relPath, body) => { mkdirSync(dirname(join(repo, relPath)), { recursive: true }); writeFileSync(join(repo, relPath), body); };
const touch = (repo, ...rels) => { for (const r of rels) appendFileSync(join(repo, r), "// edit\n"); };
const remove = (repo, relPath) => rmSync(join(repo, relPath));
const commit = (repo, msg = "change") => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", msg); };

// The template: a work repo whose origin/main is its HEAD, and its bare origin, packed (no sample hooks, few files, so a copy is quick). Built on first use.
let template;
function makeTemplate() {
  template = join(scratch, "template");
  mkdirSync(template);
  git(template, "init", "-q", "--template=", "--bare", "-b", "main", "origin.git");
  mkdirSync(join(template, "work"));
  git(join(template, "work"), "init", "-q", "--template=", "-b", "main");
  for (const [relPath, body] of Object.entries(BASE)) put(join(template, "work"), relPath, body);
  commit(join(template, "work"), "base");
  git(join(template, "work"), "remote", "add", "origin", join(template, "origin.git"));
  git(join(template, "work"), "push", "-q", "-u", "origin", "main");
  git(join(template, "work"), "repack", "-adq");
  git(join(template, "origin.git"), "repack", "-adq");
}
let counter = 0;
function fresh() {
  if (!template) makeTemplate();
  const dir = join(scratch, `t${++counter}`);
  cpSync(template, dir, { recursive: true });
  const repo = join(dir, "work");
  git(repo, "remote", "set-url", "origin", join(dir, "origin.git"));
  return repo;
}
// Runs the command in a child process; async, so the cases of the "command" suite below run side by side.
function run(repo, args = [], { cwd, tool = TOOL } = {}) {
  return new Promise((done) => {
    execFile(process.execPath, [tool, ...(repo ? ["--root", repo] : []), ...args], { encoding: "utf8", cwd, env: ENV }, (err, stdout, stderr) => {
      done({ lines: stdout.trimEnd().split("\n"), stdout, stderr, code: err ? err.code : 0 });
    });
  });
}
const unport = (l) => l.replace(/JS3D_PORT=\d+/, "JS3D_PORT=<port>");
const specLines = (r) => r.lines.filter((l) => l.startsWith("spec "));

// ---- rules (in-process) --------------------------------------------------------------------------------------------------------------------------------------

test("geometry code adds golden with the rule as the reason, and the nightly-only fuzz spec that names the kernel is not dragged in", () => {
  const r = ask("src/kernel.js");
  assert.deepEqual(r.specs, ["spec test/golden.spec.mjs  ← geometry: src/kernel.js"]);
  assert.equal(pwOf(r), "node build.mjs && JS3D_PORT=<port> npx playwright test 'test/golden\\.spec\\.mjs$' --workers=2");
  assert.equal(r.lines.at(-1), "affected-specs: 1 spec(s)");
  const rels = ["src/kernel.js", "src/worker.js", "src/fasteners.js", "src/store.js", "src/scene.js", "third_party/replicad/src/index.ts", "src/fontsub/sans.ttf", "src/occt-gz.wasm"];
  assert.deepEqual(inproc(rels).why, { "test/golden.spec.mjs": [...rels].sort().map((p) => `geometry: ${p}`) });
});

test("a geometry module that has a spec adds that spec as well; a Markdown file in a geometry folder adds nothing", () => {
  assert.deepEqual(ask("src/gears.js").specs, ["spec test/gears.spec.mjs  ← src/gears.js", "spec test/golden.spec.mjs  ← geometry: src/gears.js"]);
  // the name is compared without hyphens, underscores or case: combinesplit.js and combine-split.spec.mjs
  assert.deepEqual(ask("src/combinesplit.js").specs, ["spec test/combine-split.spec.mjs  ← src/combinesplit.js", "spec test/golden.spec.mjs  ← geometry: src/combinesplit.js"]);
  assert.deepEqual(ask("third_party/replicad/README.md").lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
});

test("app.js, index.html, build.mjs, the style sheets, the font license and the build and runner config add smoke", () => {
  assert.deepEqual(ask("src/style.css").specs, ["spec test/smoke.spec.mjs  ← boot: src/style.css"]);
  const rels = ["src/app.js", "src/index.html", "build.mjs", "src/style.css", "package.json", "size-budget.json", "LICENSES/OFL-1.1-fonts.txt"];
  assert.deepEqual(inproc(rels).why["test/smoke.spec.mjs"], [...rels].sort().map((p) => `boot: ${p}`));
  assert.deepEqual(ask("LICENSES/OFL-1.1-fonts.txt").specs, ["spec test/smoke.spec.mjs  ← boot: LICENSES/OFL-1.1-fonts.txt"]); // build.mjs copies it into docs/fonts
  assert.deepEqual(ask("LICENSES/MIT.txt").lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
});

test("mcp/, the bridge, the skill, the plugin files and the README add the mcp tests, with the command last", () => {
  const one = ask("mcp/server.mjs");
  assert.deepEqual(one.specs, ["spec mcp/test  ← mcp: mcp/server.mjs"]);
  assert.deepEqual(one.lines.slice(-2), ["npm run test:mcp", "affected-specs: 1 spec(s)"]);
  assert.equal(pwOf(one), undefined, "no Playwright line when no Playwright spec is needed");
  const rels = ["mcp/server.mjs", "mcp/README.md", "mcp/test/server.test.mjs", "README.md", "skills/jumpstart-3d/SKILL.md", ".claude-plugin/marketplace.json"];
  assert.deepEqual(inproc(rels).why, { "mcp/test": [...rels].sort().map((p) => `mcp: ${p}`) });
  const r = ask("src/bridge.js");
  assert.deepEqual(r.specs, ["spec test/bridge.spec.mjs  ← src/bridge.js", "spec mcp/test  ← mcp: src/bridge.js"]);
  assert.deepEqual(r.lines.slice(-3), ["node build.mjs && JS3D_PORT=<port> npx playwright test 'test/bridge\\.spec\\.mjs$' --workers=2", "npm run test:mcp", "affected-specs: 2 spec(s)"]);
});

test("files the MCP tests read without mcp/ in their names add npm run test:mcp: listed ones, and any ../../ path found in mcp/test/*.mjs", () => {
  for (const p of ["src/chattools.js", "package.json", "src/app.js", "tools/bridge-demo.js", "test/projects/advanced-hole.json"]) assert.ok(ask(p).specs.includes(`spec mcp/test  ← mcp: ${p}`), p);
  // not in the list, found by reading mcp/test/*.mjs
  const reader = { ...BASE, "mcp/test/new.test.mjs": `new URL("${rel("..", "..", "src", "kernel.js")}", import.meta.url);\nnew URL("${rel("..", "..", "test", "fixtures", "other", "")}", import.meta.url);\n` };
  assert.ok(inproc(["src/kernel.js"], { base: reader }).specs.includes("spec mcp/test  ← mcp: src/kernel.js"));
  assert.ok(inproc(["test/fixtures/other/x.txt"], { base: reader }).specs.includes("spec mcp/test  ← mcp: test/fixtures/other/x.txt"), "a folder the MCP tests read covers its files");
  assert.ok(!ask("src/kernel.js").specs.some((l) => l.includes("mcp/test")), "without that reader, the kernel is not an MCP file");
  // the real repo: mcp/test/*.mjs is found
  assert.ok(listTests(join(TOOLS, "..")).mcp.includes("mcp/test/chat.test.mjs"));
});

test("tutorial code adds every tutorials spec", () => {
  assert.deepEqual(ask("src/tutorial_data.js").specs, ["spec test/tutorials-walk.spec.mjs  ← tutorials: src/tutorial_data.js", "spec test/tutorials.spec.mjs  ← tutorials: src/tutorial_data.js"]);
  assert.deepEqual(ask("src/tutorials.js").specs, ["spec test/tutorials-walk.spec.mjs  ← tutorials: src/tutorials.js", "spec test/tutorials.spec.mjs  ← tutorials: src/tutorials.js"]);
});

test("a new button id in index.html adds the tutorials spec, an edited or removed one does not", () => {
  const html = (change) => ["src/index.html", change(BUTTONS)];
  const smokeAnd = (reason) => ["spec test/smoke.spec.mjs  ← boot: src/index.html", `spec test/tutorials.spec.mjs  ← tutorials: ${reason}`];
  assert.deepEqual(inproc([html((h) => h.replace("</header>", '<button id="btn-new">New</button>\n</header>'))]).specs, smokeAnd("new button #btn-new in src/index.html"));
  assert.match(inproc([html((h) => h.replace("</header>", '<button id="a1">1</button><button id="a2">2</button>\n</header>'))]).specs[1], /new button #a1 \(\+1\) in src\/index\.html$/);
  // a renamed id counts as new; a new button with the id after other attributes too
  assert.match(inproc([html((h) => h.replace('id="btn-old"', 'id="btn-older"'))]).specs[1], /new button #btn-older/);
  assert.match(inproc([html((h) => h.replace("</header>", '<button type="button" class="x" id="btn-late">L</button>\n</header>'))]).specs[1], /new button #btn-late/);
  // a button without an id, a data-id and a template id are still a new <button> line; so is a button line whose label was edited (an added line, as the rule reads it)
  assert.deepEqual(inproc([html((h) => h.replace("Old", "Older"))]).specs, smokeAnd("new button line in src/index.html"));
  for (const line of ["<button>plain</button>", '<button data-id="x1">d</button>', '<button id="row-${n}">t</button>']) {
    assert.deepEqual(inproc([html((h) => h.replace("</header>", `${line}\n</header>`))]).specs, smokeAnd("new button line in src/index.html"), line);
  }
  // same ids: a removed button, a moved line, and a div with an id are not new toolbar buttons
  for (const change of [
    (h) => h.replace("Old", "Older").replace("Older", "Old"),
    (h) => h.replace('<button class="tb" id="btn-second">Second</button>\n', ""),
    (h) => h.replace('<button id="btn-old">Old</button>\n', "").replace("</header>", '<button id="btn-old">Old</button>\n</header>'),
    (h) => h.replace("</header>", '<div id="not-a-button"></div>\n</header>'),
  ]) assert.deepEqual(inproc([html(change)]).specs, ["spec test/smoke.spec.mjs  ← boot: src/index.html"]);
});

test("a line added to advanced, beginner, simulate or app.js that makes a button, or an index.html line with data-act, adds the tutorials spec", () => {
  const BTN = 'const b = el("button", { class: "tb" }, "Go");\n';
  for (const p of ["src/advanced.js", "src/beginner.js", "src/simulate.js"]) {
    assert.deepEqual(ask(p, "//\n" + BTN).specs, [`spec test/tutorials.spec.mjs  ← tutorials: new button line in ${p}`], p);
    assert.ok(!ask(p).specs.some((l) => l.includes("tutorials")), `${p}: an edit without a button`);
    // a button the file already had (a line moved, or edited around) is not new
    assert.ok(!inproc([[p, BTN + "// more\n"]], { base: { ...BASE, [p]: "// more\n" + BTN } }).specs.some((l) => l.includes("tutorials")), `${p}: moved`);
  }
  const app = ask("src/app.js", "//\n" + BTN);
  assert.ok(app.specs.includes("spec test/tutorials.spec.mjs  ← tutorials: new button line in src/app.js"));
  assert.ok(app.specs.includes("spec test/smoke.spec.mjs  ← boot: src/app.js"));
  assert.ok(ask("src/index.html", BUTTONS + '<span data-act="save">Save</span>\n').specs.includes("spec test/tutorials.spec.mjs  ← tutorials: new button line in src/index.html"));
  assert.ok(!ask("src/kernel.js", "//\n" + BTN).specs.some((l) => l.includes("tutorials")), "only the toolbar files count");
  assert.ok(!ask("src/advanced.js", null).specs.some((l) => l.includes("tutorials")), "a deleted file adds no button");
});

test("a changed spec file is always in the list, smoke, golden, mobile, the chat judge and fuzz included, with no cap of 10", () => {
  for (const p of ["test/pivot.spec.mjs", "test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs", "test/fuzz.spec.mjs"]) {
    assert.deepEqual(ask(p).specs, [`spec ${p}  ← ${p}`], p);
  }
  const names = Array.from({ length: 12 }, (_, i) => `test/s${String(i).padStart(2, "0")}.spec.mjs`);
  const r = inproc(names.map((n) => [n, "//\n"]));
  assert.deepEqual(r.specs, names.map((n) => `spec ${n}  ← ${n}`));
  assert.equal(r.lines.at(-1), "affected-specs: 12 spec(s)");
  assert.equal(r.notes.length, 0, "CI's cap notice is not repeated");
});

test("a tools/ script adds the node test of the same name, and the tests of the scripts that import it; a changed node test is itself", () => {
  const a = ask("tools/agent/check-map.mjs");
  assert.deepEqual(a.specs, ["spec test/check-map.test.mjs  ← tools/agent/check-map.mjs"]);
  assert.deepEqual(a.lines.slice(-2), ["node --test test/check-map.test.mjs", "affected-specs: 1 spec(s)"]);
  assert.equal(pwOf(a), undefined);
  assert.deepEqual(ask("tools/agent/lib.mjs").specs, ["spec test/check-map.test.mjs  ← tools/agent/lib.mjs (via check-map.mjs)"]); // imported by check-map.mjs: one hop
  assert.deepEqual(ask("test/check-map.test.mjs").specs, ["spec test/check-map.test.mjs  ← test/check-map.test.mjs"]);
  assert.deepEqual(ask("test/bench/score.test.mjs").specs, ["spec test/bench/score.test.mjs  ← test/bench/score.test.mjs"]);
  // a fixture folder a test reads by a relative path, and a node test next to a Playwright line
  assert.deepEqual(ask("test/fixtures/map/AGENTS.fixture.md").specs, ["spec test/check-map.test.mjs  ← test/fixtures/map/AGENTS.fixture.md"]);
  const r = inproc(["tools/agent/check-map.mjs", "src/pivot.js", "mcp/server.mjs"]);
  assert.deepEqual(r.lines.slice(-4), ["node build.mjs && JS3D_PORT=<port> npx playwright test 'test/pivot\\.spec\\.mjs$' --workers=2", "node --test test/check-map.test.mjs", "npm run test:mcp", "affected-specs: 3 spec(s)"]);
});

test("a folder a test names up to a ${...} (a fixtures folder read file by file) covers its files, under test/ only", () => {
  assert.deepEqual(ask("test/fixtures/status/ok.txt").specs, ["spec test/status.test.mjs  ← test/fixtures/status/ok.txt"]);
  assert.deepEqual(ask("test/fixtures/other/x.txt").specs, [], "another folder is not read");
  // outside test/ a folder says nothing about one file (copies.test.mjs builds tools/agent/${name}); the usedPaths unit
  assert.ok(!ask("tools/agent/check-map.mjs").specs.some((l) => l.includes("copies.test")));
  const folder = (body, path = "test/x.spec.mjs") => [...usedPaths(path, body, { bare: false })];
  assert.deepEqual(folder("new URL(`" + rel(".", "fixtures", "status") + "/${name}`)"), ["test/fixtures/status"]);
  assert.deepEqual(folder("new URL(`" + rel(".") + "/${name}`)"), [], "a bare ./ would claim every test file");
  assert.deepEqual(folder("new URL(`" + rel("..", "tools") + "/${name}`)"), []);
});

test("an esbuild stdin that writes ./src/x.js in a test means the repo root's src/x.js as well", () => {
  const u = [...usedPaths("test/x.spec.mjs", `contents: 'import "${rel(".", "src", "printsim.js")}"'`, { bare: false })];
  assert.deepEqual(u.sort(), ["src/printsim.js", "test/src/printsim.js"]);
  const sim = { ...BASE, "test/printerpreview.spec.mjs": `contents: 'import "${rel(".", "src", "printsim.js")}"'` };
  assert.ok(inproc(["src/printsim.js"], { base: sim }).specs.some((l) => l.startsWith("spec test/printerpreview.spec.mjs  ← src/printsim.js")));
});

test("the FreeCAD test only CI can run is noted and not listed, also when it is the changed file", () => {
  const note = ["OK no specs needed (nothing a test loads changed)", "note: test/judge.integration.test.mjs needs FreeCAD, which only CI has: not listed", "affected-specs: 0 spec(s)"];
  const r = ask("tools/judge-exports.mjs");
  assert.deepEqual(r.specs, []);
  assert.deepEqual(r.lines, note);
  assert.deepEqual(ask("test/judge.integration.test.mjs").lines, note);
});

test("docs that nothing loads print OK no specs needed (docs only); code next to docs gets its specs and no line for the docs", () => {
  const docs = ["BRIDGE.md", "NOTICE.md", "LICENSES/MIT.txt", "LICENSE", "test/README.md", ".github/PULL_REQUEST_TEMPLATE.md", ["NEW-NOTES.md", "# notes\n"]];
  const r = inproc(docs);
  assert.deepEqual(r.lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
  assert.equal(r.result.docsOnly, true);
  const mixed = inproc([...docs, "src/pivot.js"]);
  assert.deepEqual(mixed.specs, ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
  assert.ok(!mixed.out.includes("docs only") && !mixed.out.includes("BRIDGE"));
  // Markdown in src/ is not docs-only
  assert.deepEqual(ask("src/README.md").specs, ["spec test/smoke.spec.mjs  ← no spec names it: src/README.md"]);
});

test("nothing changed: OK no specs needed (no changes since origin/main)", () => {
  assert.deepEqual(inproc([]).lines, ["OK no specs needed (no changes since origin/main)", "affected-specs: 0 spec(s)"]);
});

test("a src/ or third_party/ file that no rule and no test names gets smoke; a tools/ or workflow file nothing names gets a note", () => {
  for (const p of ["src/orphan.js", "third_party/three/build/three.js"]) assert.deepEqual(ask(p).specs, [`spec test/smoke.spec.mjs  ← no spec names it: ${p}`], p);
  assert.deepEqual(ask(".github/workflows/test.yml").lines, ["OK no specs needed (nothing a test loads changed)", "note: .github/workflows/test.yml: no test names it", "affected-specs: 0 spec(s)"]);
  assert.deepEqual(ask("tools/pages.mjs").lines, ["OK no specs needed (nothing a test loads changed)", "note: tools/pages.mjs: no test names it", "affected-specs: 0 spec(s)"]);
});

test("a module is mapped to the specs that import it or name it, not to a comment about a document; a folder a spec reads covers its files", () => {
  assert.deepEqual(ask("src/version.js").specs, ["spec test/report.spec.mjs  ← src/version.js", "spec test/smoke.spec.mjs  ← src/version.js"]); // smoke and report import it
  assert.deepEqual(ask("src/sw.js").specs, ["spec test/load.spec.mjs  ← src/sw.js"]); // load.spec names it in a comment, which counts for a Playwright spec
  assert.deepEqual(ask("test/projects/a.json").specs, ["spec test/golden.spec.mjs  ← test/projects/a.json"]); // test/projects/ and golden.json are read by golden.spec
  assert.deepEqual(ask("test/golden.json").specs, ["spec test/golden.spec.mjs  ← test/golden.json"]);
});

test("a file that more than 8 tests use stands for them with smoke and a note, instead of 10 spec lines", () => {
  const r = ask("test/helpers.mjs");
  assert.deepEqual(r.specs, ["spec test/smoke.spec.mjs  ← shared: test/helpers.mjs (used by 10 tests)"]);
  assert.deepEqual(r.notes, ["note: test/helpers.mjs is used by 10 tests: smoke stands in, the nightly runs the rest"]);
  const few = Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== "test/shared8.spec.mjs" && k !== "test/shared9.spec.mjs")); // with 8 users the tests are listed one by one
  assert.equal(inproc(["test/helpers.mjs"], { base: few }).specs.length, 8);
});

test("a deleted file is a change: a deleted module still asks for its spec and the rules, a deleted spec is dropped with a note", () => {
  assert.deepEqual(ask("src/pivot.js", null).specs, ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
  assert.deepEqual(ask("src/kernel.js", null).specs, ["spec test/golden.spec.mjs  ← geometry: src/kernel.js"]);
  assert.deepEqual(ask("src/orphan.js", null).specs, ["spec test/smoke.spec.mjs  ← no spec names it: src/orphan.js"]);
  assert.deepEqual(inproc([["test/gone.spec.mjs", null], ["test/judge.integration.test.mjs", null]]).lines,
    ["OK no specs needed (nothing a test loads changed)", "note: test/gone.spec.mjs was deleted: nothing to run", "note: test/judge.integration.test.mjs was deleted: nothing to run", "affected-specs: 0 spec(s)"]);
  assert.deepEqual(ask("BRIDGE.md", null).lines, ["OK no specs needed (docs only)", "affected-specs: 0 spec(s)"]);
});

test("agreement with CI: every spec tools/ci-select-specs.mjs picks for a list of changed paths is listed with its own path as the reason", () => {
  const specs = ["test/pivot.spec.mjs", "test/gears.spec.mjs", "test/load.spec.mjs", "test/new-one.spec.mjs", "test/two words.spec.mjs", "test/c++.spec.mjs", "test/$(x).spec.mjs"];
  const others = ["test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs", "test/helpers.mjs", "test/projects/a.spec.mjs", "src/orphan.js", "README.md"];
  const r = inproc([...[...specs, ...others].map((p) => [p, "//\nedit\n"]), ["test/gone.spec.mjs", null]]);
  const paths = [...specs, ...others, "test/gone.spec.mjs"];
  const ci = select(paths, (p) => p !== "test/gone.spec.mjs").specs;
  assert.deepEqual(ci, [...specs].sort()); // CI's own answer for this list
  for (const p of ci) assert.ok(r.specs.includes(`spec ${p}  ← ${p}`), `${p} is listed with itself as the reason`);
  assert.ok(!r.out.includes("test/gone.spec.mjs  ←"));
  for (const p of ["test/smoke.spec.mjs", "test/golden.spec.mjs", "test/mobile.spec.mjs", "test/chatjudge.spec.mjs"]) assert.ok(r.specs.some((l) => l.startsWith(`spec ${p}  ← ${p}`)), p); // what CI runs elsewhere
});

test("the reasons shown are the first three that name the spec, the fallback last, and the rest are counted", () => {
  const r = inproc(["src/app.js", "build.mjs", "package.json", "src/index.html", "src/style.css", ["src/aaa-new.js", "//\n"]]); // aaa-new sorts first, but its reason is the fallback
  assert.ok(r.specs.includes("spec test/smoke.spec.mjs  ← boot: build.mjs, boot: package.json, boot: src/app.js, +3 more"), r.specs.join("\n"));
});

// ---- module aliases -------------------------------------------------------------------------------------------------------------------------------------

const ALIAS_CASES = [
  ["src/fineturn.js", ["fine-rotate"]],
  ["src/rotationui.js", ["rotation-access"]],
  ["src/printsim.js", ["printerpreview", "paint3mf"]],
  ["src/chatproviders.js", ["chat"]],
  ["src/chattools.js", ["chat"]], // also an MCP file (see above)
  ["src/recovery.js", ["storage-chaos"]],
  ["src/arch.js", ["upstream25"]],
  ["src/archplan.js", ["upstream25"]],
  ["src/cam.js", ["upstream25"]],
  ["src/camcore.js", ["upstream25"]],
  ["src/projects.js", ["storage", "storage-chaos", "backup", "restorefolder"]], // also geometry
  ["src/projstore.js", ["storage", "storage-chaos"]],
];
for (const [src, names] of ALIAS_CASES) {
  test(`${src} asks for ${names.map((n) => `${n}.spec`).join(" and ")}, not just smoke`, () => {
    const r = ask(src);
    for (const n of names) assert.ok(r.specs.includes(`spec test/${n}.spec.mjs  ← ${src}`), `${n}: ${r.specs.join(" | ")}`);
    assert.ok(!r.specs.some((l) => l.includes("no spec names it")), "the alias is the match, so the smoke fallback does not appear");
  });
}

test("every spec the alias table names exists in test/, and every module it names exists in src/", () => {
  const repo = join(TOOLS, "..");
  const want = new Set(ALIAS_CASES.flatMap(([, names]) => names));
  const named = ALIAS.flatMap(([, names]) => names);
  assert.deepEqual([...new Set(named)].sort(), [...want].sort(), "the table and this test's cases agree");
  for (const n of named) assert.ok(existsSync(join(repo, "test", `${n}.spec.mjs`)), `test/${n}.spec.mjs`);
  for (const [src] of ALIAS_CASES.filter(([s]) => !/\/(?:arch|cam)\.js$/.test(s))) assert.ok(existsSync(join(repo, src)), src);
  for (const [src] of ALIAS_CASES) assert.ok(ALIAS.some(([rx]) => rx.test(src)), `${src} is matched by a row`);
});

// ---- the command, on a real git repo -----------------------------------------------------------------------------------------------------------------------

describe("the command, on a real git repo", { concurrency: true }, () => {
  it("the command prints spec lines, notes, then the commands to paste, with a real free test port", async () => {
    const repo = fresh();
    touch(repo, "tools/agent/check-map.mjs", "src/pivot.js", "mcp/server.mjs");
    const r = await run(repo);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stderr, "");
    assert.deepEqual(r.lines.slice(-4).map(unport), ["node build.mjs && JS3D_PORT=<port> npx playwright test 'test/pivot\\.spec\\.mjs$' --workers=2", "node --test test/check-map.test.mjs", "npm run test:mcp", "affected-specs: 3 spec(s)"]);
    const m = /JS3D_PORT=(\d+) /.exec(r.stdout);
    if (m) assert.ok(Number(m[1]) >= 8805 && Number(m[1]) <= 8895 && (Number(m[1]) - 8805) % 10 === 0, m[1]); // else every test port is busy on this machine: "<port>"
  });

  it("untracked, staged, uncommitted and deleted files all count; ignored ones do not; a deleted spec is dropped with a note", async () => {
    const repo = fresh();
    put(repo, "test/fresh.spec.mjs", "//\n"); // untracked
    put(repo, "test/ignored.spec.mjs", "//\n"); // untracked and ignored
    put(repo, "ignored/x.js", "//\n");
    put(repo, "test/staged.spec.mjs", "//\n");
    git(repo, "add", "test/staged.spec.mjs"); // new and staged
    touch(repo, "src/gears.js"); // edited
    put(repo, "src/brand-new-module.js", "//\n"); // untracked module nothing names
    for (const p of ["src/pivot.js", "src/kernel.js", "src/orphan.js", "test/gone.spec.mjs", "BRIDGE.md"]) remove(repo, p); // a deleted module still asks for its spec and the rules
    const r = await run(repo);
    assert.deepEqual(specLines(r), [
      "spec test/fresh.spec.mjs  ← test/fresh.spec.mjs",
      "spec test/gears.spec.mjs  ← src/gears.js",
      "spec test/golden.spec.mjs  ← geometry: src/gears.js, geometry: src/kernel.js",
      "spec test/pivot.spec.mjs  ← src/pivot.js",
      "spec test/smoke.spec.mjs  ← no spec names it: src/brand-new-module.js, no spec names it: src/orphan.js",
      "spec test/staged.spec.mjs  ← test/staged.spec.mjs",
    ]);
    assert.deepEqual(r.lines.filter((l) => l.startsWith("note: ")), ["note: test/gone.spec.mjs was deleted: nothing to run"]);
  });

  it("the change is measured from the merge-base: committed work on a branch counts with uncommitted edits, what origin/main gained since does not", async () => {
    const repo = fresh();
    const dir = dirname(repo);
    git(repo, "checkout", "-q", "-b", "feature");
    touch(repo, "src/pivot.js");
    commit(repo, "feature work");
    touch(repo, "src/orphan.js"); // uncommitted
    // origin/main moves on without this branch: another clone changes the kernel and pushes
    git(dir, "clone", "-q", "origin.git", "other");
    touch(join(dir, "other"), "src/kernel.js", "src/bridge.js");
    commit(join(dir, "other"), "main moves on");
    git(join(dir, "other"), "push", "-q", "origin", "main");
    git(repo, "fetch", "-q", "origin");
    assert.notEqual(git(repo, "rev-parse", "origin/main"), git(repo, "merge-base", "origin/main", "HEAD"));
    assert.deepEqual(specLines(await run(repo)), ["spec test/pivot.spec.mjs  ← src/pivot.js", "spec test/smoke.spec.mjs  ← no spec names it: src/orphan.js"]);
    // --base picks another point: only the uncommitted file is newer than HEAD
    assert.deepEqual(specLines(await run(repo, ["--base", "HEAD"])), ["spec test/smoke.spec.mjs  ← no spec names it: src/orphan.js"]);
  });

  it("--json prints the same plan as data", async () => {
    const repo = fresh();
    touch(repo, "src/pivot.js", "mcp/server.mjs");
    const r = await run(repo, ["--json"]);
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
    assert.match(j.commands[0], /^node build\.mjs && JS3D_PORT=(?:\d+|<port>) npx playwright test 'test\/pivot\\\.spec\\\.mjs\$' --workers=2$/);
    assert.deepEqual(j.notes, []);
  });

  it("the Playwright line can be pasted: names with spaces, plus signs and shell characters survive the shell and are escaped and anchored as CI does", async () => {
    const names = ["test/two words.spec.mjs", "test/c++.spec.mjs", "test/a(b).spec.mjs", "test/$(x).spec.mjs", "test/it's.spec.mjs", "test/plain.spec.mjs"];
    const line = pwOf(inproc(names.map((n) => [n, "//\n"])));
    const [, middle] = /^node build\.mjs && JS3D_PORT=<port> npx playwright test (.*) --workers=2$/.exec(line);
    const parsed = spawnSync("sh", ["-c", `printf '%s\\n' ${middle}`], { encoding: "utf8" });
    assert.equal(parsed.status, 0, parsed.stderr);
    const args = parsed.stdout.trimEnd().split("\n");
    // the escaping in .github/workflows/test.yml, run for real on the same names
    const sed = spawnSync("sh", ["-c", 'for n in "$@"; do printf \'%s\' "$n" | sed -E \'s/[][\\\\.*+?^${}()|]/\\\\&/g\'; printf \'$\\n\'; done', "sh", ...[...names].sort()], { encoding: "utf8" });
    assert.equal(sed.status, 0, sed.stderr);
    assert.deepEqual(args, sed.stdout.trimEnd().split("\n"));
    // each argument, read as a regular expression, matches its own file only
    for (const [i, arg] of args.entries()) {
      assert.ok(new RegExp(arg, "i").test([...names].sort()[i]), arg);
      assert.equal(names.filter((n) => new RegExp(arg, "i").test(n)).length, 1, arg);
    }
  });

  it("--help prints one usage line; a wrong option, a stray argument or a base that is not a ref is refused", async () => {
    const help = await run(null, ["--help"]);
    assert.equal(help.lines.length, 1);
    assert.match(help.lines[0], /^usage: node tools\/agent\/affected-specs\.mjs /);
    assert.equal(help.code, 0);
    assert.equal((await run(null, ["--nope"])).code, 2);
    assert.equal((await run(null, ["pivot"])).code, 2);
    assert.equal((await run(null, ["--base"])).code, 2);
    const flag = await run(join(scratch, "home"), ["--base=--help"]); // refused before git is asked anything
    assert.equal(flag.code, 1);
    assert.match(flag.lines[0], /^FAIL: base --help is not a ref → pass --base <ref>$/);
  });

  it("a git problem is one FAIL line with the next step and exit 1: no such base, not a repository, no common history", async () => {
    const repo = fresh();
    const base = await run(repo, ["--base", "origin/nowhere"]);
    assert.deepEqual(base.lines, ["FAIL: base origin/nowhere not found → git fetch origin, or pass --base <ref>"]);
    assert.equal(base.code, 1);
    const notRepo = await run(join(scratch, "home"));
    assert.equal(notRepo.code, 1);
    assert.match(notRepo.lines[0], /^FAIL: git rev-parse failed in .+ → check --root and --base$/);
    assert.equal(notRepo.lines.length, 1);
    git(repo, "checkout", "-q", "--orphan", "island");
    commit(repo, "unrelated history");
    const island = await run(repo);
    assert.deepEqual(island.lines, ["FAIL: origin/main and HEAD share no history → pass --base <ref> of this repo's own main"]);
    assert.equal(island.code, 1);
  });

  it("without --root the tool works on the repo two folders above itself, from any working folder", async () => {
    const repo = fresh();
    mkdirSync(join(repo, "tools", "agent"), { recursive: true });
    cpSync(join(TOOLS, "ci-select-specs.mjs"), join(repo, "tools", "ci-select-specs.mjs"));
    for (const f of ["affected-specs.mjs", "ports.mjs"]) cpSync(join(TOOLS, "agent", f), join(repo, "tools", "agent", f));
    commit(repo, "tools");
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    touch(repo, "src/pivot.js");
    const r = await run(null, [], { cwd: scratch, tool: join(repo, "tools", "agent", "affected-specs.mjs") });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(specLines(r), ["spec test/pivot.spec.mjs  ← src/pivot.js"]);
  });
});
