// The map checker (tools/agent/check-map.mjs): paths, skills, memory names, budgets and duplicate sentences in AGENTS.md and the guides.
// The fixtures in test/fixtures/check-map/ are copied to a scratch folder first, with every "dot-claude" folder renamed ".claude" and every
// "AGENTS.fixture.md" renamed "AGENTS.md" (both names are git-ignored on Max's Mac, so a fixture cannot live under them). HOME points at a scratch folder, so the real ~/.claude is never read.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("../tools/agent/check-map.mjs", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "check-map-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function restoreNames(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "dot-claude") renameSync(join(dir, e.name), join(dir, ".claude"));
    else if (e.name === "AGENTS.fixture.md") renameSync(join(dir, e.name), join(dir, "AGENTS.md"));
    else if (e.isDirectory()) restoreNames(join(dir, e.name));
  }
}
const fx = join(scratch, "fx");
cpSync(fileURLToPath(new URL("./fixtures/check-map/", import.meta.url)), fx, { recursive: true });
restoreNames(fx);
const [bad, clean, dup, home] = ["bad", "clean", "dup", "home"].map((n) => join(fx, n));

let counter = 0;
const folder = () => { const d = join(scratch, `t${++counter}`); mkdirSync(d); return d; };
function run(args, { home: h = home, cwd } = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", cwd, env: { ...process.env, HOME: h, USERPROFILE: h } });
  return { lines: r.stdout.trimEnd().split("\n"), stderr: r.stderr, code: r.status };
}
const withMemory = (root) => ["--root", root, "--memory-dir", join(root, "memory")];

const BAD = [
  "FAIL: AGENTS.md:7 path `docs/missing-file.md` not found → fix the path or create it",
  "FAIL: AGENTS.md:7 path `nowhere/` not found → fix the path or create it",
  "FAIL: AGENTS.md:8 path `src/real.js/` is a file, not a folder → remove the trailing / or fix the path",
  "FAIL: .claude/guide/code.md:4 path `src/gone.js` not found → fix the path or create it",
  "FAIL: AGENTS.md:12 skill /nope not found → .claude/skills/nope/SKILL.md",
  "FAIL: .claude/guide/code.md:4 skill /vanished not found → .claude/skills/vanished/SKILL.md",
  "FAIL: AGENTS.md:16 memory name `missing-note` not found → memory/missing-note.md",
  "FAIL: .claude/guide/code.md:5 memory name `ghost-note` not found → memory/ghost-note.md",
  "FAIL: AGENTS.md has 53 lines, limit 44 → move detail into a guide; AGENTS.md is a router",
  "FAIL: AGENTS.md is 3302 bytes, limit 3072 → move detail into a guide; AGENTS.md is a router",
  "WARN: duplicate sentence in AGENTS.md:19 and .claude/guide/code.md:3: \"Never push this file anywhere, and keep every secret out of …\"",
];

const CLEAN = [
  "OK paths (8 checked)",
  "OK skills (2)",
  "OK memory names (3)",
  "OK budget AGENTS.md (19 lines, 633 bytes)",
  "OK duplicates (8 sentences)",
  "check-map: OK",
];

test("a map with every kind of problem prints each FAIL and WARN, and exits 1", () => {
  const r = run(withMemory(bad));
  assert.deepEqual(r.lines, [...BAD, "check-map: 10 problem(s)"]);
  assert.equal(r.code, 1);
});

test("--strict counts the duplicate sentence as a problem too", () => {
  const r = run(["--strict", ...withMemory(bad)]);
  assert.deepEqual(r.lines, [...BAD, "check-map: 11 problem(s)"]);
  assert.equal(r.code, 1);
});

test("a duplicate sentence alone is a warning: exit 0, and exit 1 with --strict", () => {
  const warn = "WARN: duplicate sentence in AGENTS.md:3 and .claude/guide/code.md:3: \"Only one problem here: a long sentence that is shared with t…\"";
  const tail = ["OK paths (0 checked)", "OK skills (0)", "SKIP memory names (no memory dir)", "OK budget AGENTS.md (3 lines, 91 bytes)"];
  const loose = run(["--root", dup]);
  assert.deepEqual(loose.lines, [...tail, warn, "check-map: OK"]);
  assert.equal(loose.code, 0);
  const strict = run(["--root", dup, "--strict"]);
  assert.deepEqual(strict.lines, [...tail, warn, "check-map: 1 problem(s)"]);
  assert.equal(strict.code, 1);
});

test("a clean map exits 0 with one OK line per check, with and without --strict", () => {
  for (const extra of [[], ["--strict"]]) {
    const r = run([...extra, ...withMemory(clean)]);
    assert.deepEqual(r.lines, CLEAN);
    assert.equal(r.code, 0);
  }
});

test("files named on the command line are the only ones checked", () => {
  const r = run([...withMemory(clean), "AGENTS.md"]);
  assert.deepEqual(r.lines, ["OK paths (5 checked)", "OK skills (2)", "OK memory names (3)", "OK budget AGENTS.md (19 lines, 633 bytes)", "OK duplicates (7 sentences)", "check-map: OK"]);
  assert.equal(r.code, 0);
});

test("a file named on the command line that is missing is a FAIL", () => {
  const r = run([...withMemory(clean), "nope.md"]);
  assert.equal(r.lines[0], "FAIL: nope.md not found → check the file name");
  assert.equal(r.lines.at(-1), "check-map: 1 problem(s)");
  assert.equal(r.code, 1);
});

test("--max-lines and --max-bytes change the budget", () => {
  const r = run([...withMemory(clean), "--max-lines", "3", "--max-bytes", "50"]);
  assert.deepEqual(r.lines.slice(3, 5), [
    "FAIL: AGENTS.md has 19 lines, limit 3 → move detail into a guide; AGENTS.md is a router",
    "FAIL: AGENTS.md is 633 bytes, limit 50 → move detail into a guide; AGENTS.md is a router",
  ]);
  assert.equal(r.lines.at(-1), "check-map: 2 problem(s)");
  assert.equal(r.code, 1);
  assert.equal(run([...withMemory(clean), "--max-lines", "19", "--max-bytes", "633"]).code, 0);
});

test("a repo without AGENTS.md, guides or memory is skipped line by line, not failed", () => {
  const r = run(["--root", folder()], { home: folder() });
  assert.deepEqual(r.lines, [
    "SKIP AGENTS.md (not present)",
    "SKIP .claude/guide/*.md (not present)",
    "OK paths (0 checked)",
    "OK skills (0)",
    "SKIP memory names (no memory dir)",
    "OK duplicates (0 sentences)",
    "check-map: OK",
  ]);
  assert.equal(r.code, 0);
});

// A home folder with ~/.claude/projects/<root with every / as ->/memory/ holding the named notes, and the home-only skill.
function homeFor(root, notes) {
  const h = folder();
  const memory = join(h, ".claude", "projects", root.replaceAll("/", "-"), "memory");
  mkdirSync(memory, { recursive: true });
  for (const n of notes) writeFileSync(join(memory, `${n}.md`), `# ${n}\n`);
  mkdirSync(join(h, ".claude", "skills", "home-skill"), { recursive: true });
  writeFileSync(join(h, ".claude", "skills", "home-skill", "SKILL.md"), "# home-skill\n");
  return h;
}

test("the memory folder defaults to ~/.claude/projects/<root with / as ->/memory, and a missing name is shown with ~", () => {
  const h = homeFor(clean, ["real-note"]);
  const r = run(["--root", clean], { home: h });
  const where = `~/.claude/projects/${clean.replaceAll("/", "-")}/memory/other-note.md`;
  assert.deepEqual(r.lines, [
    "OK paths (8 checked)",
    "OK skills (2)",
    `FAIL: AGENTS.md:7 memory name \`other-note\` not found → ${where}`,
    "OK budget AGENTS.md (19 lines, 633 bytes)",
    "OK duplicates (8 sentences)",
    "check-map: 1 problem(s)",
  ]);
  assert.equal(r.code, 1);
});

test("the root defaults to the folder two levels above the script", () => {
  const root = realpathSync(folder()); // the script finds its root through the real path (macOS /var is a link to /private/var)
  cpSync(clean, root, { recursive: true });
  const copy = join(root, "tools", "agent");
  mkdirSync(copy, { recursive: true });
  cpSync(TOOL, join(copy, "check-map.mjs"));
  const h = homeFor(root, ["real-note", "other-note"]);
  const r = spawnSync(process.execPath, [join(copy, "check-map.mjs")], { encoding: "utf8", cwd: folder(), env: { ...process.env, HOME: h, USERPROFILE: h } });
  assert.deepEqual(r.stdout.trimEnd().split("\n"), CLEAN);
  assert.equal(r.status, 0);
});

test("--help prints one usage line; a wrong option or number exits 2", () => {
  const help = run(["--help"]);
  assert.equal(help.lines.length, 1);
  assert.match(help.lines[0], /^usage: node tools\/agent\/check-map\.mjs /);
  assert.equal(help.code, 0);
  assert.equal(run(["--nope"]).code, 2);
  assert.equal(run(["--max-lines", "many"]).code, 2);
});
