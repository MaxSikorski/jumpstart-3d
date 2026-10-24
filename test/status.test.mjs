// The status report (tools/agent/status.mjs): where are we, in one call. Everything runs without gh, a network or a Mac:
// the parsers get captured text from test/fixtures/status/, the worktree states and the main checkout come from real git on scratch repos (with a local bare origin),
// gh/ps/lsof/vm_stat/sysctl answers are injected through `run`, and the CLI runs with --offline and a fake gh on the PATH that leaves a marker file if it is ever called.
// HOME, the git config and the time zone point at scratch values for the whole file, so the real ~/.claude, ~/.gitconfig and gh login are never read.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as S from "../tools/agent/status.mjs";

const TOOL = fileURLToPath(new URL("../tools/agent/status.mjs", import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "status-")));
after(() => rmSync(scratch, { recursive: true, force: true }));
const home = join(scratch, "home");
mkdirSync(home);
writeFileSync(join(scratch, "gitconfig"), "[user]\n\tname = Test Max\n\temail = max@example.test\n[init]\n\tdefaultBranch = main\n[protocol \"file\"]\n\tallow = always\n");
Object.assign(process.env, { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: join(scratch, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GH_CONFIG_DIR: join(scratch, "gh-empty"), TZ: "UTC" });
delete process.env.GH_TOKEN;
delete process.env.GITHUB_TOKEN;

const fx = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/status/${name}`, import.meta.url)), "utf8");
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const GB = 1024 ** 3;
// Ages ("29 seconds ago") change from run to run and so does the padding they cause: ages become AGE and every run of spaces becomes two.
const noAge = (s) => s.replace(/\b\d+ (?:second|minute|hour)s? ago\b/g, "AGE").replace(/ {2,}/g, "  ");
const NOW = () => new Date("2026-10-24T08:15:30Z");

// ---- scratch repos --------------------------------------------------------------------------------------------------------------------------------------------

function commit(dir, file, text, message) {
  writeFileSync(join(dir, file), text);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", message);
}

// A repo with a bare origin, the tags v2.5.1-community.9 and .24 on the first commit, the merged PR #12 after them, a map file and a backlog.
// It is built once and copied for each test (remote url fixed), because git is the slow part of these tests.
let template;
function light() {
  if (!template) {
    template = realpathSync(mkdtempSync(join(scratch, "template-")));
    const root = join(template, "repo");
    git(template, "init", "-q", "--bare", "-b", "main", "origin.git");
    mkdirSync(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "remote", "add", "origin", join(template, "origin.git"));
    commit(root, "base.txt", "0\n", "first");
    git(root, "tag", "v2.5.1-community.9");
    git(root, "tag", "v2.5.1-community.24");
    git(root, "checkout", "-q", "-b", "feat-merged");
    commit(root, "merged.txt", "m\n", "feature");
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "-m", "Merge pull request #12 from x/y", "feat-merged");
    git(root, "push", "-q", "origin", "main");
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "backlog.md"), [
      "# Backlog", "",
      "- Quiet item · files: x · state: blocked on Max",
      "- Mapping check: run check-map after edits and read every line of its output so nothing slips through the net · state: ready",
      "- Look at the open PRs · state: every heartbeat",
      "- Another item · state: ready", "",
    ].join("\n"));
    writeFileSync(join(root, "AGENTS.md"), "# Map\n\nSee `base.txt`.\n");
    appendFileSync(join(root, ".git", "info", "exclude"), ".claude/\nAGENTS.md\n.js3d-port\n"); // local-only files: git does not count them as new
  }
  const base = realpathSync(mkdtempSync(join(scratch, "s-")));
  cpSync(template, base, { recursive: true });
  git(join(base, "repo"), "remote", "set-url", "origin", join(base, "origin.git"));
  return { base, origin: join(base, "origin.git"), root: join(base, "repo") };
}

// light() plus one worktree for each kind of state.
function scenario() {
  const s = light();
  const { base, root } = s;
  const add = (name, ...args) => { const dir = join(base, `wt-${name}`); git(root, "worktree", "add", "-q", ...args.map((a) => (a === "<dir>" ? dir : a))); return dir; };
  add("feat-merged", "<dir>", "feat-merged"); // its tip is the second parent of the #12 merge
  const fresh = add("fresh", "--no-track", "-b", "fresh", "<dir>", "origin/main");
  writeFileSync(join(fresh, ".js3d-port"), "8815\n"); // this worktree has claimed 8815 (ignored by git, so the worktree stays clean)
  const local = add("local-only", "--no-track", "-b", "local-only", "<dir>", "origin/main");
  commit(local, "l1.txt", "1\n", "local one");
  commit(local, "l2.txt", "2\n", "local two");
  writeFileSync(join(local, "base.txt"), "changed\n"); // one tracked file changed
  writeFileSync(join(local, "untracked.txt"), "x\n"); // and one new file
  const deps = add("mcp-deps", "--no-track", "-b", "mcp-deps", "<dir>", "origin/main");
  commit(deps, "d.txt", "d\n", "deps");
  git(deps, "push", "-q", "origin", "mcp-deps");
  const plus = add("pushed-plus", "--no-track", "-b", "pushed-plus", "<dir>", "origin/main");
  commit(plus, "p1.txt", "1\n", "plus one");
  git(plus, "push", "-q", "origin", "pushed-plus");
  commit(plus, "p2.txt", "2\n", "plus two");
  const behind = add("behind-origin", "--no-track", "-b", "behind-origin", "<dir>", "origin/main");
  commit(behind, "b1.txt", "1\n", "behind one");
  commit(behind, "b2.txt", "2\n", "behind two");
  git(behind, "push", "-q", "origin", "behind-origin");
  git(behind, "reset", "-q", "--hard", "HEAD~1");
  add("detached", "--detach", "<dir>", "origin/main");
  rmSync(add("gone", "--no-track", "-b", "gone", "<dir>", "origin/main"), { recursive: true });
  return s;
}
const shared = scenario();
const rel = (name) => `../wt-${name}`;

// gh, ps, lsof, vm_stat and sysctl answers from the fixtures; everything else (git) is real.
function makeRun({ gh, ps = fx("ps-macos.txt"), calls = [] } = {}) {
  return async (cmd, args, opts) => {
    if (cmd === "gh") { calls.push(args.join(" ")); return gh ? gh(args) : { code: 1, stdout: "", stderr: "no gh here" }; }
    if (cmd === "ps") return ok(ps);
    if (cmd === "lsof") return ok(fx("lsof.txt"));
    if (cmd === "vm_stat") return ok(fx("vm_stat.txt"));
    if (cmd === "sysctl") return ok(args.includes("hw.memsize") ? "25769803776\n" : fx("swapusage.txt"));
    return S.runCommand(cmd, args, opts);
  };
}
const fakeGh = (root, overrides = {}) => (args) => {
  const key = args.slice(0, 2).join(" ");
  if (overrides[key]) return overrides[key];
  const sha = git(root, "rev-parse", "origin/main");
  if (key === "release view") return ok(fx("gh-release.json"));
  if (key === "run list") return ok(fx("gh-runs.json").replaceAll("MAINSHA", sha));
  if (key === "pr list") return ok(fx("gh-prs.json"));
  if (key === "api rate_limit") return ok(fx("gh-rate.json"));
  return { code: 1, stdout: "", stderr: `unexpected gh call: ${args.join(" ")}` };
};
const LOG = "/private/tmp/scratch/chaos-b/4a.log"; // the file descriptor 1 of the playwright run in fixtures/status/lsof.txt
const readLog = (p) => (p === LOG ? { text: fx("line-reporter.log") } : { note: "output not in a file" });
const collectWith = (root, extra = {}) => S.collect({ root, fetch: false, run: makeRun(), platform: "darwin", readLog, portBusy: async (p) => p === 8805, now: NOW, ...extra });

// ---- parsers --------------------------------------------------------------------------------------------------------------------------------------------------

test("parseEtime reads mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
  assert.equal(S.parseEtime("08:31"), 511);
  assert.equal(S.parseEtime("00:05"), 5);
  assert.equal(S.parseEtime("01:02:03"), 3723);
  assert.equal(S.parseEtime("1-02:03:04"), 93784);
  assert.equal(S.parseEtime("soon"), null);
});

test("eta needs 5 finished tests and something left; durations read 45 s, 8 min, 1 h 05 min", () => {
  assert.equal(S.eta(480, 124, 300), 681);
  assert.equal(S.eta(100, 4, 300), null);
  assert.equal(S.eta(100, 5, 300), 5900);
  assert.equal(S.eta(100, 300, 300), null);
  assert.deepEqual([45, 59.6, 480, 681, 3900, 93784].map(S.formatDuration), ["45 s", "60 s", "8 min", "11 min", "1 h 05 min", "26 h 03 min"]);
});

test("parsePs finds only node running playwright or the three tools: no shell, npm exec, worker, codex prompt, wait loop or grep", () => {
  const runs = S.parsePs(fx("ps-macos.txt"));
  assert.deepEqual(runs, [
    { pid: 38943, elapsed: 800, tool: "playwright", specs: ["storage-chaos.spec.mjs", "backup.spec.mjs", "fuzz.spec.mjs"], lastFailed: false },
    { pid: 41002, elapsed: 93784, tool: "chat-bench", specs: [], lastFailed: false },
  ]);
});

test("parsePs: every way to start a run counts, and a prompt that only mentions it does not", () => {
  const ps = (cmd) => S.parsePs(`  500 00:09 ${cmd}\n`);
  assert.equal(ps("node /w/node_modules/playwright/cli.js test --last-failed")[0].lastFailed, true);
  assert.equal(ps("/usr/bin/node /w/node_modules/@playwright/test/cli.js test x.spec.mjs").length, 1);
  assert.deepEqual(ps("node --max-old-space-size=4096 /w/node_modules/.bin/playwright test test/a.spec.mjs:12:3 test/b.spec.mjs").map((r) => r.specs), [["a.spec.mjs", "b.spec.mjs"]]);
  assert.deepEqual(ps("node tools/judge-exports.mjs").map((r) => r.tool), ["judge-exports"]);
  assert.deepEqual(ps("node /w/tools/measure-load.mjs --runs 3").map((r) => r.tool), ["measure-load"]);
  assert.equal(ps("node /w/node_modules/playwright/lib/worker/workerProcessEntry.js").length, 0);
  assert.equal(ps("node /w/node_modules/.bin/playwright show-report").length, 0);
  assert.equal(ps("node /opt/homebrew/bin/codex exec run playwright test now").length, 0);
  assert.equal(ps("node -e setTimeout(()=>{},1)").length, 0);
  assert.equal(ps("npx playwright test").length, 0);
  assert.equal(S.parsePs("garbage line\n\n").length, 0);
});

test("parseLsof reads the folder and what file descriptor 1 points at, per process", () => {
  assert.deepEqual([...S.parseLsof(fx("lsof.txt"))], [
    [38943, { cwd: "/Users/dev/Projects/jumpstart-3d-chaos-b", out: LOG }],
    [41002, { cwd: "/Users/dev/Projects/jumpstart-3d-codecad", out: "->0x4f2e1d7d3b6c2a91" }],
    [41100, { cwd: "/Users/dev/Projects/jumpstart-3d" }],
  ]);
});

test("parseProgress: the list reporter gives the highest finished number and the ✘ count", () => {
  assert.deepEqual(S.parseProgress(fx("list-reporter.log")), { total: 300, done: 124, failed: 1 });
});

test("parseProgress: the line reporter gives the highest started number and the distinct failure headers", () => {
  assert.deepEqual(S.parseProgress(fx("line-reporter.log")), { total: 300, done: 201, failed: 2 });
  assert.deepEqual(S.parseProgress("[3/9] a\n[4/9] b\n"), { total: 9, done: 4, failed: 0 });
});

test("parseProgress counts only the last run in the text (a rerun appended to the same log)", () => {
  const first = "Running 100 tests using 2 workers\n  ✓  1 [site] › a.spec.mjs:1:1 › a\n  ✘  100 [site] › a.spec.mjs:2:1 › b\n";
  assert.deepEqual(S.parseProgress(first), { total: 100, done: 100, failed: 1 });
  assert.deepEqual(S.parseProgress(`${first}\nRunning 20 tests using 1 worker\n  ✓  1 [site] › a.spec.mjs:2:1 › b\n  ✓  2 [site] › a.spec.mjs:3:1 › c\n`), { total: 20, done: 2, failed: 0 });
  assert.deepEqual(S.parseProgress(`${first}\nRunning 20 tests using 1 worker\n[3/20] a\n  1) [site] › a.spec.mjs:2:1 › b\n`), { total: 20, done: 3, failed: 1 });
});

test("parseProgress: only the header (dot reporter) is 0 done; nothing yet is null", () => {
  assert.deepEqual(S.parseProgress("\nRunning 1 test using 1 worker\n.....\n"), { total: 1, done: 0, failed: 0 });
  assert.equal(S.parseProgress(""), null);
  assert.equal(S.parseProgress("building...\n"), null);
});

test("parseVmStat counts free and inactive pages at the page size on the first line", () => {
  assert.deepEqual(S.parseVmStat(fx("vm_stat.txt")), { freeBytes: (120978 + 563507) * 16384 });
  assert.equal(S.parseVmStat("nothing useful"), null);
});

test("parseSwap reads the used value in K, M or G", () => {
  assert.deepEqual(S.parseSwap(fx("swapusage.txt")), { text: "0.25M", bytes: 262144 });
  assert.deepEqual(S.parseSwap("total = 4096.00M  used = 1.50G  free = 2.50G"), { text: "1.50G", bytes: 1.5 * GB });
  assert.deepEqual(S.parseSwap("total = 0.00M  used = 0.00M  free = 0.00M"), { text: "0.00M", bytes: 0 });
  assert.equal(S.parseSwap("?"), null);
});

test("parseMeminfo: used = MemTotal - MemAvailable, swap used = SwapTotal - SwapFree", () => {
  assert.deepEqual(S.parseMeminfo(fx("meminfo.txt")), { totalBytes: 16384000 * 1024, usedBytes: 8192000 * 1024, swapBytes: 0 });
  assert.equal(S.parseMeminfo(fx("meminfo.txt").replace("SwapFree:        2097152", "SwapFree:        1000000")).swapBytes, (2097152 - 1000000) * 1024);
  assert.equal(S.parseMeminfo("MemTotal: 1 kB"), null);
});

test("ciWord: fail beats running beats pass; no checks is none", () => {
  const run = (conclusion, status = "COMPLETED") => ({ __typename: "CheckRun", conclusion, status });
  const ctx = (state) => ({ __typename: "StatusContext", state });
  assert.equal(S.ciWord([]), "none");
  assert.equal(S.ciWord(undefined), "none");
  assert.equal(S.ciWord([run("SUCCESS"), run("SKIPPED"), run("NEUTRAL")]), "pass");
  for (const c of ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]) assert.equal(S.ciWord([run("SUCCESS"), run(c)]), "fail", c);
  assert.equal(S.ciWord([run("SUCCESS"), run("", "IN_PROGRESS")]), "running");
  assert.equal(S.ciWord([run("", "QUEUED")]), "running");
  assert.equal(S.ciWord([run("", "IN_PROGRESS"), run("FAILURE")]), "fail");
  assert.equal(S.ciWord([ctx("SUCCESS")]), "pass");
  assert.equal(S.ciWord([ctx("PENDING")]), "running");
  assert.equal(S.ciWord([ctx("EXPECTED")]), "running");
  assert.equal(S.ciWord([ctx("FAILURE")]), "fail");
  assert.equal(S.ciWord([ctx("ERROR"), run("SUCCESS")]), "fail");
});

// ---- git: worktrees, main, releases ---------------------------------------------------------------------------------------------------------------------------

test("worktreeStates: merged, new, ahead not pushed with a dirty file, pushed, pushed with 1 new, behind origin, detached, missing", async () => {
  const states = await S.worktreeStates({ root: shared.root, run: S.runCommand });
  const by = (branch) => states.find((w) => w.branch === branch);
  const row = (branch) => { const w = { ...by(branch), age: "AGE" }; return S.describeWorktree(w); };
  assert.equal(states.length, 9);
  assert.equal(states.find((w) => w.isMain).path, shared.root);
  assert.equal(by("main").dirty, 0);
  assert.equal(row("feat-merged"), "merged");
  assert.equal(row("fresh"), "new, no commits · clean · AGE");
  assert.equal(row("local-only"), "ahead 2 · not pushed · 1 dirty, 1 new file · AGE");
  assert.equal(row("mcp-deps"), "ahead 1 · pushed · clean · AGE");
  assert.equal(row("pushed-plus"), "ahead 2 · pushed, 1 new · clean · AGE");
  assert.equal(row("behind-origin"), "ahead 1 · behind origin 1 · clean · AGE");
  assert.equal(row("gone"), "missing → git worktree prune");
  const detached = states.find((w) => w.detached);
  assert.equal(detached.branch, null);
  assert.equal(S.describeWorktree({ ...detached, age: "AGE" }), "new, no commits · clean · AGE");
  assert.equal(S.describeWorktree({ ...by("mcp-deps"), age: "AGE", pr: 175 }), "ahead 1 · pushed · PR #175 · clean · AGE");
  assert.equal(S.describeWorktree({ ...by("feat-merged"), dirty: 2 }), "merged · 2 dirty");
  assert.equal(by("local-only").rel, rel("local-only"));
  assert.match(by("fresh").age, /ago$/);
});

test("worktreeStates: diverged from origin shows both sides, and a repo without origin/main compares with main", async () => {
  const { root, base } = light();
  const dir = join(base, "wt-div");
  git(root, "worktree", "add", "-q", "--no-track", "-b", "div", dir, "origin/main");
  commit(dir, "d1.txt", "1\n", "d one");
  git(dir, "push", "-q", "origin", "div");
  git(dir, "reset", "-q", "--hard", "HEAD~1");
  commit(dir, "d2.txt", "2\n", "d two");
  const w = (await S.worktreeStates({ root, run: S.runCommand })).find((x) => x.branch === "div");
  assert.deepEqual(w.remote, { new: 1, behind: 1 });
  assert.equal(S.describeWorktree({ ...w, age: "AGE" }), "ahead 1 · pushed, 1 new, behind origin 1 · clean · AGE");
  git(root, "remote", "remove", "origin");
  const local = (await S.worktreeStates({ root, run: S.runCommand })).find((x) => x.branch === "div");
  assert.equal(local.state, "ahead");
  assert.equal(local.remote, null);
});

test("collect (offline) on a real repo: main = origin/main, the newest tag by version, the PRs merged since it, worktrees by folder, no gh call", async () => {
  const calls = [];
  const data = await collectWith(shared.root, { offline: true, run: makeRun({ calls }) });
  assert.equal(data.main.sha, git(shared.root, "rev-parse", "main"));
  assert.equal(data.main.originSha, data.main.sha);
  assert.deepEqual([data.main.ahead, data.main.behind, data.main.dirty], [0, 0, 0]);
  assert.equal(data.main.lastTag, "v2.5.1-community.24"); // 24 sorts above 9
  assert.deepEqual(data.main.unreleased, [12]); // #12 was merged after the tag
  assert.deepEqual(data.live, { tag: "v2.5.1-community.24" });
  assert.deepEqual(calls, []);
  assert.deepEqual(data.worktrees.map((w) => w.branch), ["behind-origin", null, "feat-merged", "fresh", "gone", "local-only", "mcp-deps", "pushed-plus"]); // by folder name
});

test("unreleased PRs are the merges since the newest tag, oldest first, PR merges only; main ahead and behind origin; a dirty main checkout", async () => {
  const { root, base } = light();
  git(root, "tag", "v2.5.1-community.25"); // on the #12 merge: nothing is unreleased
  assert.deepEqual((await collectWith(root, { offline: true })).main.unreleased, []);
  const clone = join(base, "clone");
  git(base, "clone", "-q", join(base, "origin.git"), clone);
  for (const [branch, title] of [["feat13", "Merge pull request #13 from x/z"], ["other", "Merge branch 'other'"], ["feat14", "Merge pull request #14 from x/w"]]) {
    git(clone, "checkout", "-q", "-b", branch, "main");
    commit(clone, `${branch}.txt`, "1\n", branch);
    git(clone, "checkout", "-q", "main");
    git(clone, "merge", "-q", "--no-ff", "-m", title, branch);
  }
  git(clone, "push", "-q", "origin", "main");
  git(root, "fetch", "-q", "origin");
  commit(root, "local.txt", "l\n", "local only");
  writeFileSync(join(root, "base.txt"), "dirty\n");
  const data = await collectWith(root, { offline: true });
  assert.deepEqual([data.main.ahead, data.main.behind, data.main.dirty], [1, 6, 1]);
  assert.deepEqual(data.main.unreleased, [13, 14]);
  const line = S.render(data).lines.find((l) => l.startsWith("main:"));
  assert.equal(line, `main: ${data.main.sha.slice(0, 7)} ahead 1, behind 6 vs origin/main · unreleased: #13 #14 · CI on main: skipped (offline) · 1 dirty`);
});

// A branch that merged origin/main into itself and was then merged by a PR. The old main tip it pulled in is the second parent of the
// inner merge, which is not a merged branch: a worktree still at that tip is "new, no commits", and only the PR branch itself reads "merged".
for (const inner of ["Merge origin/main into feat", "Merge pull request #99 from x/side"]) {
  test(`a worktree at the old main tip that "${inner}" pulled in is new, not merged; the PRs since the tag leave the inner merge out`, async () => {
    const { root, base } = light();
    const oldTip = git(root, "rev-parse", "main");
    git(root, "worktree", "add", "-q", "--no-track", "-b", "old-tip", join(base, "wt-old-tip"), oldTip);
    git(root, "checkout", "-q", "-b", "feat", "main~1"); // the first commit: the branch started before #12 was merged
    commit(root, "f1.txt", "1\n", "feat one");
    git(root, "merge", "-q", "--no-ff", "-m", inner, oldTip);
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "-m", "Merge pull request #20 from x/feat", "feat");
    git(root, "push", "-q", "origin", "main");
    git(root, "worktree", "add", "-q", join(base, "wt-feat"), "feat");
    const data = await collectWith(root, { offline: true });
    const rows = Object.fromEntries(data.worktrees.map((w) => [w.branch, S.describeWorktree({ ...w, age: "AGE" })]));
    assert.deepEqual(rows, { feat: "merged", "old-tip": "new, no commits · clean · AGE" });
    assert.deepEqual(S.render(data).warnings.filter((w) => w.includes("worktree")), ["WARN: worktree feat is merged → git worktree remove ../wt-feat && git branch -D feat"]);
    assert.deepEqual(data.main.unreleased, [12, 20]);
  });
}

test("new files are counted ('3 new files'), ignored files are not, and a merged worktree with anything in it gets no removal advice", async () => {
  const { root, base } = light();
  const merged = join(base, "wt-feat-merged");
  git(root, "worktree", "add", "-q", merged, "feat-merged"); // the branch of PR #12: merged
  const look = async () => {
    const lines = S.render(await collectWith(root, { offline: true })).lines.map(noAge);
    return { row: lines.find((l) => l.includes("../wt-feat-merged")), advice: lines.filter((l) => l.startsWith("WARN: worktree")), main: lines.find((l) => l.startsWith("main:")) };
  };
  const clean = await look();
  assert.equal(clean.row, "  feat-merged  merged  ../wt-feat-merged");
  assert.deepEqual(clean.advice, ["WARN: worktree feat-merged is merged → git worktree remove ../wt-feat-merged && git branch -D feat-merged"]);
  writeFileSync(join(merged, "notes.txt"), "x\n");
  mkdirSync(join(merged, "sub"));
  writeFileSync(join(merged, "sub", "a.txt"), "a\n");
  writeFileSync(join(merged, "sub", "b.txt"), "b\n");
  writeFileSync(join(merged, ".js3d-port"), "8815\n"); // ignored through .git/info/exclude: not counted
  const withFiles = await look();
  assert.equal(withFiles.row, "  feat-merged  merged · 3 new files  ../wt-feat-merged");
  assert.deepEqual(withFiles.advice, []);
  writeFileSync(join(merged, "merged.txt"), "changed\n"); // a tracked file changed too
  const withBoth = await look();
  assert.equal(withBoth.row, "  feat-merged  merged · 1 dirty, 3 new files  ../wt-feat-merged");
  assert.deepEqual(withBoth.advice, []);
  rmSync(join(merged, "notes.txt"));
  rmSync(join(merged, "sub"), { recursive: true });
  const dirtyOnly = await look();
  assert.equal(dirtyOnly.row, "  feat-merged  merged · 1 dirty  ../wt-feat-merged");
  assert.deepEqual(dirtyOnly.advice, []);
  // the main checkout: one new file, then one changed file too, said on the main line
  git(merged, "checkout", "--", "merged.txt");
  writeFileSync(join(root, "how-fast.md"), "x\n");
  assert.match((await look()).main, / · unreleased: #12 · CI on main: skipped \(offline\) · 1 new file$/);
  writeFileSync(join(root, "base.txt"), "changed\n");
  assert.match((await look()).main, / · 1 dirty, 1 new file$/);
});

test("the main checkout is the first worktree listed, whatever branch it is on", async () => {
  const { root, base } = light();
  git(root, "checkout", "-q", "-b", "other");
  git(root, "worktree", "add", "-q", join(base, "wt-main"), "main"); // main is free to be checked out elsewhere now
  const data = await collectWith(root, { offline: true });
  assert.equal(data.main.checkout, "other");
  assert.deepEqual(data.worktrees.map((w) => w.branch), ["main"]); // listed like any other worktree
  const lines = S.render(data).lines;
  assert.match(lines.find((l) => l.startsWith("main:")), / = origin\/main · unreleased: #12 · CI on main: skipped \(offline\) · checkout on other$/);
  git(root, "checkout", "-q", "--detach");
  assert.equal((await collectWith(root, { offline: true })).main.checkout, "(detached)");
});

// ---- collect + render, with injected gh -----------------------------------------------------------------------------------------------------------------------

test("collect asks gh for exactly four things, and reads them", async () => {
  const calls = [];
  const data = await collectWith(shared.root, { run: makeRun({ gh: fakeGh(shared.root), calls }) });
  assert.deepEqual(calls.sort(), [
    "api rate_limit",
    "pr list --state open --limit 30 --json number,title,isDraft,headRefName,baseRefName,mergeStateStatus,statusCheckRollup",
    "release view --json tagName,url,publishedAt",
    "run list --limit 20 --json workflowName,status,conclusion,headSha,headBranch,databaseId",
  ]);
  assert.deepEqual(data.live, { tag: "v2.5.1-community.24", url: "https://github.com/MaxSikorski/jumpstart-3d/releases/tag/v2.5.1-community.24", published: "2026-10-24 02:36 UTC" });
  assert.deepEqual(data.actions, { ci: [{ name: "test", word: "running" }, { name: "codeql", word: "queued" }], nightly: { word: "failure 40047654784" }, running: 1, queued: 1 });
  assert.deepEqual(data.prs.list.map((p) => [p.number, p.draft, p.ci, p.state, p.base]), [[175, true, "pass", "CLEAN", "main"], [171, true, "fail", "BEHIND", "main"], [156, false, "running", "BLOCKED", "phase-4"]]);
  assert.deepEqual(data.api, { core: { limit: 5000, remaining: 4830, reset: 1792845604, used: 170 }, graphql: { limit: 5000, remaining: 4947, reset: 1792845722, used: 53 }, reset: "12:40" });
  assert.equal(data.worktrees.find((w) => w.branch === "mcp-deps").pr, 175);
  assert.equal(data.worktrees.find((w) => w.branch === "fresh").pr, undefined);
  assert.equal(data.time, "2026-10-24 08:15 UTC");
});

test("a full report from a real repo, injected gh and macOS command output: every line", async () => {
  const data = await collectWith(shared.root, { run: makeRun({ gh: fakeGh(shared.root) }) });
  const { lines, problems, warnings } = S.render(data);
  const sha = data.main.sha.slice(0, 7);
  assert.deepEqual(lines.map(noAge), [
    "status 2026-10-24 08:15 UTC · repo",
    "Live: v2.5.1-community.24 · 2026-10-24 02:36 UTC · https://github.com/MaxSikorski/jumpstart-3d/releases/tag/v2.5.1-community.24",
    `main: ${sha} = origin/main · unreleased: #12 · CI on main: test running, codeql queued · nightly failure 40047654784`,
    "PRs: 3 open",
    "  #175  draft  pass  mcp-deps  Bump the MCP server's dependencies",
    "  #171  draft  fail  boolean-retry-all  Join and cut retry like intersect when the first t… [BEHIND]",
    "  #156  ready  running  codecad  Code CAD [BLOCKED] base=phase-4",
    "Worktrees: 8",
    "  behind-origin  ahead 1 · behind origin 1 · clean · AGE  ../wt-behind-origin",
    "  (detached)  new, no commits · clean · AGE  ../wt-detached",
    "  feat-merged  merged  ../wt-feat-merged",
    "  fresh  new, no commits · clean · AGE  ../wt-fresh",
    "  gone  missing → git worktree prune  ../wt-gone",
    "  local-only  ahead 2 · not pushed · 1 dirty, 1 new file · AGE  ../wt-local-only",
    "  mcp-deps  ahead 1 · pushed · PR #175 · clean · AGE  ../wt-mcp-deps",
    "  pushed-plus  ahead 2 · pushed, 1 new · clean · AGE  ../wt-pushed-plus",
    "Tests: 2 of 2 running, 0 free · next free port 8825", // 8805 is busy and 8815 is claimed by the worktree fresh
    "  jumpstart-3d-chaos-b  storage-chaos.spec.mjs, backup.spec.mjs +1  201 / 300, 2 failed · 13 min in · ETA ~7 min",
    "  jumpstart-3d-codecad  chat-bench  (output not in a file) · 26 h 03 min in",
    "Actions: 1 running, 1 queued",
    "Memory: RAM in use 13.6 of 24.0 GB (limit 21.0) · swap 0.25M",
    "GitHub API left: core 4830/5000 · graphql 4947/5000 · resets 12:40",
    "Map: OK (check-map)",
    "Backlog ready: 3 · first: Mapping check: run check-map after edits and read every line of its ou…",
    "WARN: worktree feat-merged is merged → git worktree remove ../wt-feat-merged && git branch -D feat-merged",
    "WARN: swap used 0.25M → keep swap at 0: stop a worker or close apps",
    "status: OK, 2 warnings",
  ]);
  assert.equal(problems, 0);
  assert.equal(warnings.length, 2);
});

test("on Linux the folder and output file come from /proc, and memory from /proc/meminfo", async () => {
  const links = { "/proc/38943/cwd": "/w/jumpstart-3d-chaos-b", "/proc/38943/fd/1": LOG, "/proc/41002/cwd": "/w/jumpstart-3d-codecad", "/proc/41002/fd/1": "pipe:[123]" };
  const commands = [];
  const run = makeRun();
  const data = await collectWith(shared.root, {
    offline: true, platform: "linux", run: async (cmd, args, o) => { commands.push(cmd === "ps" ? `ps ${args.join(" ")}` : cmd); return run(cmd, args, o); },
    readlink: (p) => links[p], readFile: (p) => (p === "/proc/meminfo" ? fx("meminfo.txt") : readFileSync(p, "utf8")),
  });
  assert.deepEqual(data.tests.runs.map((r) => [r.pid, r.cwd, r.progress, r.note]), [[38943, "/w/jumpstart-3d-chaos-b", { total: 300, done: 201, failed: 2 }, null], [41002, "/w/jumpstart-3d-codecad", null, "output not in a file"]]);
  assert.deepEqual(data.memory, { totalBytes: 16384000 * 1024, usedBytes: 8192000 * 1024, swap: { bytes: 0, text: "0.00M" } });
  assert.ok(!commands.includes("lsof") && !commands.includes("vm_stat") && !commands.includes("sysctl"), commands.join());
  assert.ok(commands.includes("ps -eww -o pid=,etime=,args="), commands.join()); // wide, so a long command line is not cut
});

test("a failed gh call prints a FAIL line in its own place and exits 1; the other sections still print", async () => {
  const bad = { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)\nrun gh auth login" };
  const run = makeRun({ gh: fakeGh(shared.root, { "pr list": bad, "run list": { code: 4, stdout: "", stderr: "" }, "api rate_limit": ok("not json") }) });
  const r = await S.main(["--root", shared.root, "--no-fetch"], { run, platform: "darwin", readLog, portBusy: async () => false, now: NOW });
  const lines = r.out.trimEnd().split("\n").map(noAge);
  assert.equal(r.code, 1);
  assert.ok(lines.includes("FAIL: gh pr list failed (HTTP 401: Bad credentials (https://api.github.com/graphql)) → gh auth status, or run with --offline"), r.out);
  assert.ok(lines.includes("FAIL: gh run list failed (exit 4) → gh auth status, or run with --offline"));
  assert.ok(lines.includes("FAIL: gh api rate_limit failed (unreadable output) → gh auth status, or run with --offline"));
  assert.ok(lines[1].startsWith("Live: v2.5.1-community.24 · "));
  assert.ok(lines.some((l) => l.startsWith("main: ") && !l.includes("CI on main")));
  assert.ok(lines.includes("Worktrees: 8") && lines.some((l) => l.startsWith("Tests: ")) && lines.some((l) => l.startsWith("Memory: ")) && lines.includes("Map: OK (check-map)"));
  assert.equal(lines.at(-1), "status: 3 problem(s)");
  assert.equal(lines.filter((l) => l.startsWith("PRs:") || l.startsWith("Actions:") || l.startsWith("GitHub API")).length, 0);
});

test("main: a failed release view, a failed fetch and a failed ps", async () => {
  const gh = fakeGh(shared.root, { "release view": { code: 1, stdout: "", stderr: "release not found" } });
  const run = makeRun({ gh });
  const failPs = async (cmd, args, o) => (cmd === "ps" ? { code: 127, stdout: "", stderr: "spawn ps ENOENT" } : cmd === "git" && args[0] === "fetch" ? { code: 128, stdout: "", stderr: "fatal" } : run(cmd, args, o));
  const r = await S.main(["--root", shared.root], { run: failPs, platform: "darwin", readLog, portBusy: async () => false, now: NOW });
  const lines = r.out.trimEnd().split("\n");
  assert.equal(r.code, 1);
  assert.ok(lines.includes("FAIL: gh release view failed (release not found) → gh auth status, or run with --offline"));
  assert.ok(lines.includes("FAIL: ps failed (spawn ps ENOENT) → check that ps is on the PATH"));
  assert.ok(lines.includes("WARN: git fetch failed → origin numbers may be stale"));
  assert.equal(lines.at(-1), "status: 2 problem(s)");
});

test("a git fetch runs unless --no-fetch or --offline", async () => {
  const seen = [];
  const run = async (cmd, args, o) => { if (args[0] === "fetch") seen.push(args.join(" ")); return makeRun({ gh: fakeGh(shared.root) })(cmd, args, o); };
  const deps = { run, platform: "darwin", readLog, portBusy: async () => false, now: NOW };
  await S.main(["--root", shared.root], deps);
  assert.deepEqual(seen, ["fetch -q --prune --no-auto-maintenance origin"]);
  await S.main(["--root", shared.root, "--no-fetch"], deps);
  await S.main(["--root", shared.root, "--offline"], deps);
  assert.equal(seen.length, 1);
});

test("a folder that is not a git repository is one FAIL line", async () => {
  const empty = realpathSync(mkdtempSync(join(scratch, "empty-")));
  const r = await S.main(["--root", empty], { run: makeRun(), platform: "darwin", now: NOW });
  assert.deepEqual(r.out.trimEnd().split("\n"), ["status 2026-10-24 08:15 UTC · " + basename(empty), `FAIL: ${empty} is not a git repository → pass --root <the repo>`, "status: 1 problem(s)"]);
  assert.equal(r.code, 1);
});

test("a map with a broken path is a Map line and a warning; a repo without AGENTS.md is skipped", async () => {
  const { root } = light();
  writeFileSync(join(root, "AGENTS.md"), "# Map\n\nSee `nowhere/gone.md` and `also/missing.js`.\n");
  const lines = S.render(await collectWith(root, { offline: true })).lines;
  assert.ok(lines.includes("Map: 2 problems → node tools/agent/check-map.mjs"));
  assert.ok(lines.includes("WARN: the agent map has 2 problems → node tools/agent/check-map.mjs"));
  rmSync(join(root, "AGENTS.md"));
  assert.ok(S.render(await collectWith(root, { offline: true })).lines.includes("Map: skipped (no AGENTS.md here)"));
});

test("the backlog line appears only when .claude/backlog.md exists", async () => {
  const { root } = light();
  assert.deepEqual((await collectWith(root, { offline: true })).backlog, { count: 3, first: "Mapping check: run check-map after edits and read every line of its output so nothing slips through the net · state: ready" });
  rmSync(join(root, ".claude"), { recursive: true });
  const data = await collectWith(root, { offline: true });
  assert.equal(data.backlog, null);
  assert.ok(!S.render(data).lines.some((l) => l.startsWith("Backlog")));
});

// ---- render, with a made-up data object -----------------------------------------------------------------------------------------------------------------------

const wt = (extra) => ({ detached: false, isMain: false, dirty: 0, untracked: 0, state: "ahead", ahead: 1, remote: { new: 0, behind: 0 }, age: "1 day ago", ...extra });
const FULL = () => ({
  time: "2026-10-24 08:15 EDT", project: "jumpstart-3d", root: "/x/jumpstart-3d", offline: false,
  live: { tag: "v2.5.1-community.24", url: "https://github.com/MaxSikorski/jumpstart-3d/releases/tag/v2.5.1-community.24", published: "2026-10-24 02:36 UTC" },
  main: { sha: "897f68a4bc25eb5cb65749d00cb615bbe95293fd", originSha: "897f68a4bc25eb5cb65749d00cb615bbe95293fd", ahead: 0, behind: 0, dirty: 0, untracked: 0, checkout: "main", lastTag: "v2.5.1-community.24", unreleased: [176, 177] },
  actions: { ci: [{ name: "test", word: "running" }, { name: "codeql", word: "running" }], nightly: { word: "failure 40047654784" }, running: 2, queued: 0 },
  prs: { list: [
    { number: 175, draft: true, ci: "pass", branch: "mcp-deps", title: "Bump the MCP server's dependencies", state: "CLEAN", base: "main" },
    { number: 171, draft: true, ci: "fail", branch: "boolean-retry-all", title: "Join and cut retry like intersect", state: "BEHIND", base: "main" },
  ] },
  worktrees: [
    wt({ branch: "chaos-fixes-b", rel: "../jumpstart-3d-chaos-b", ahead: 3, remote: null, dirty: 2, age: "3 hours ago" }),
    wt({ branch: "mcp-deps", rel: "../jumpstart-3d-mcp-deps", pr: 175 }),
    wt({ branch: "check-map", rel: "../jumpstart-3d-check-map", state: "merged" }),
  ],
  tests: { runs: [{ pid: 1, tool: "playwright", specs: ["storage-chaos.spec.mjs"], lastFailed: false, elapsed: 480, cwd: "/w/jumpstart-3d-chaos-b", progress: { total: 300, done: 124, failed: 0 }, note: null }], free: 1, port: 8815 },
  memory: { totalBytes: 24 * GB, usedBytes: 17.2 * GB, swap: { text: "0.00M", bytes: 0 } },
  api: { core: { remaining: 4830, limit: 5000 }, graphql: { remaining: 4947, limit: 5000 }, reset: "08:59" },
  map: { problems: 0, skipped: false },
  backlog: { count: 3, first: "slack.sh: also count browser runs started outside `playwright test` and `npm exec playwright test` runs, with their folders" },
});

test("render: the whole report, line by line", () => {
  const { lines, problems, warnings } = S.render(FULL());
  assert.deepEqual(lines, [
    "status 2026-10-24 08:15 EDT · jumpstart-3d",
    "Live: v2.5.1-community.24 · 2026-10-24 02:36 UTC · https://github.com/MaxSikorski/jumpstart-3d/releases/tag/v2.5.1-community.24",
    "main: 897f68a = origin/main · unreleased: #176 #177 · CI on main: test running, codeql running · nightly failure 40047654784",
    "PRs: 2 open",
    "  #175  draft  pass  mcp-deps           Bump the MCP server's dependencies",
    "  #171  draft  fail  boolean-retry-all  Join and cut retry like intersect [BEHIND]",
    "Worktrees: 3",
    "  chaos-fixes-b  ahead 3 · not pushed · 2 dirty · 3 hours ago    ../jumpstart-3d-chaos-b",
    "  mcp-deps       ahead 1 · pushed · PR #175 · clean · 1 day ago  ../jumpstart-3d-mcp-deps",
    "  check-map      merged                                          ../jumpstart-3d-check-map",
    "Tests: 1 of 2 running, 1 free · next free port 8815",
    "  jumpstart-3d-chaos-b  storage-chaos.spec.mjs  124 / 300, 0 failed · 8 min in · ETA ~11 min",
    "Actions: 2 running, 0 queued",
    "Memory: RAM in use 17.2 of 24.0 GB (limit 21.0) · swap 0.00M",
    "GitHub API left: core 4830/5000 · graphql 4947/5000 · resets 08:59",
    "Map: OK (check-map)",
    "Backlog ready: 3 · first: slack.sh: also count browser runs started outside `playwright test` an…",
    "WARN: worktree check-map is merged → git worktree remove ../jumpstart-3d-check-map && git branch -D check-map",
    "status: OK, 1 warning",
  ]);
  assert.equal(problems, 0);
  assert.equal(warnings.length, 1);
});

test("render: a clean report has no WARN lines and ends with 'status: OK'", () => {
  const d = FULL();
  d.worktrees.pop();
  const { lines, warnings } = S.render(d);
  assert.equal(lines.at(-1), "status: OK");
  assert.deepEqual(warnings, []);
});

test("render: the warning rules (RAM, swap, main behind, API budget, merged worktree, map, fetch), each with its next step", () => {
  const d = FULL();
  d.memory = { totalBytes: 24 * GB, usedBytes: 22 * GB, swap: { text: "512.00M", bytes: 512 * 1024 ** 2 } };
  d.main.behind = 2;
  d.api.core.remaining = 312;
  d.api.graphql.remaining = 499;
  d.map = { problems: 1, skipped: false };
  d.fetchFailed = true;
  const { lines, warnings } = S.render(d);
  assert.deepEqual(warnings, [
    "WARN: main is 2 behind origin/main → git merge --ff-only origin/main",
    "WARN: worktree check-map is merged → git worktree remove ../jumpstart-3d-check-map && git branch -D check-map",
    "WARN: RAM in use 22.0 GB is over the 21.0 GB limit → let a run finish before starting another",
    "WARN: swap used 512.00M → keep swap at 0: stop a worker or close apps",
    "WARN: GitHub API core has 312 left → poll less: one watcher, 60 s apart",
    "WARN: GitHub API graphql has 499 left → poll less: one watcher, 60 s apart",
    "WARN: the agent map has 1 problem → node tools/agent/check-map.mjs",
    "WARN: git fetch failed → origin numbers may be stale",
  ]);
  assert.ok(lines.includes("main: 897f68a behind 2 vs origin/main · unreleased: #176 #177 · CI on main: test running, codeql running · nightly failure 40047654784"));
  assert.ok(lines.includes("Map: 1 problem → node tools/agent/check-map.mjs"));
  assert.equal(lines.at(-1), "status: OK, 8 warnings");
  // the RAM line is exactly at the limit: no warning; --ram-limit moves the line
  d.memory.usedBytes = 21 * GB;
  assert.ok(!S.render(d).warnings.some((w) => w.includes("RAM")));
  d.memory.usedBytes = 22 * GB;
  assert.ok(!S.render(d, { ramLimit: 23 }).warnings.some((w) => w.includes("RAM")));
  assert.ok(S.render(d, { ramLimit: 23 }).lines.some((l) => l.includes("(limit 23.0)")));
  assert.ok(S.render(d, { ramLimit: 12 }).warnings.some((w) => w.startsWith("WARN: RAM in use 22.0 GB is over the 12.0 GB limit")));
  d.memory.swap = null; // swap unknown
  assert.ok(S.render(d).lines.some((l) => l.endsWith("· swap unknown")));
});

test("render: UNSTABLE shows no flag, DIRTY does; unreleased PRs are cut at 8; no CI run yet, no nightly and no origin/main are said plainly", () => {
  const d = FULL();
  d.prs.list[0].state = "UNSTABLE";
  d.prs.list[1].state = "DIRTY";
  d.main.unreleased = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  d.actions.ci = [];
  d.actions.nightly = null;
  d.main.dirty = 2;
  d.main.ahead = 1;
  const lines = S.render(d).lines;
  assert.ok(lines.includes("  #175  draft  pass  mcp-deps           Bump the MCP server's dependencies"));
  assert.ok(lines.includes("  #171  draft  fail  boolean-retry-all  Join and cut retry like intersect [DIRTY]"));
  assert.ok(lines.includes("main: 897f68a ahead 1 vs origin/main · unreleased: #1 #2 #3 #4 #5 #6 #7 #8 +2 · CI on main: not in the last 20 runs · 2 dirty"));
  d.main.unreleased = null; // no release tag at all
  d.main.originSha = null;
  assert.ok(S.render(d).lines.includes("main: 897f68a (no origin/main) · CI on main: not in the last 20 runs · 2 dirty"));
  d.main.sha = null;
  assert.equal(S.render(d).lines[2], "main: no local main branch · CI on main: not in the last 20 runs · 2 dirty");
});

test("render: no PRs, no worktrees, no runs, no free port, runs without a log, a run of a tool", () => {
  const d = FULL();
  d.prs.list = [];
  d.worktrees = [];
  d.tests = { runs: [
    { pid: 1, tool: "playwright", specs: [], lastFailed: true, elapsed: 30, cwd: null, progress: null, note: null },
    { pid: 2, tool: "playwright", specs: [], lastFailed: false, elapsed: 3700, cwd: "/w/a", progress: { total: 100, done: 10, failed: 1 }, note: null },
    { pid: 3, tool: "judge-exports", specs: [], lastFailed: false, elapsed: 90, cwd: "/w/b", progress: null, note: "log over 20 MB" },
  ], free: 0, port: null };
  d.backlog = { count: 0, first: null };
  const lines = S.render(d).lines;
  assert.ok(lines.includes("PRs: none open"));
  assert.ok(lines.includes("Worktrees: none besides the main checkout"));
  assert.deepEqual(lines.slice(lines.indexOf("Tests: 3 of 2 running, 0 free · no free port from 8805")), [
    "Tests: 3 of 2 running, 0 free · no free port from 8805",
    "  (folder unknown)  last failed    no progress yet · 30 s in",
    "  a                 all specs      10 / 100, 1 failed · 1 h 02 min in · ETA ~9 h 15 min",
    "  b                 judge-exports  (log over 20 MB) · 2 min in",
    ...lines.slice(lines.indexOf("Actions: 2 running, 0 queued")),
  ]);
  assert.ok(lines.includes("Backlog ready: none"));
});

test("render: three specs in a run show two names and +1", () => {
  const d = FULL();
  d.tests.runs[0].specs = ["a.spec.mjs", "b.spec.mjs", "c.spec.mjs", "d.spec.mjs"];
  assert.ok(S.render(d).lines.some((l) => l.includes("a.spec.mjs, b.spec.mjs +2  124 / 300")));
});

test("render: 14 worktrees and 10 PRs show 10 and 8, then '… and N more', and stay near 25 lines", () => {
  const d = FULL();
  d.worktrees = Array.from({ length: 14 }, (_, i) => wt({ branch: `branch-${i}`, rel: `../wt-${i}` }));
  d.prs.list = Array.from({ length: 10 }, (_, i) => ({ number: 100 + i, draft: false, ci: "pass", branch: `b${i}`, title: `PR ${i}`, state: "CLEAN", base: "main" }));
  d.tests.runs = [];
  d.backlog = null;
  const { lines } = S.render(d);
  assert.ok(lines.includes("  … and 4 more"));
  assert.ok(lines.includes("  … and 2 more"));
  assert.equal(lines.filter((l) => l.startsWith("  branch-")).length, 10);
  assert.equal(lines.filter((l) => /^ {2}#1\d\d /.test(l)).length, 8);
  d.prs.list = [];
  assert.ok(S.render(d).lines.length <= 25, `${S.render(d).lines.length} lines`);
});

test("render: offline says 'skipped (offline)' for everything that needs gh", () => {
  const d = FULL();
  Object.assign(d, { offline: true, live: { tag: "v2.5.1-community.24" }, prs: undefined, actions: undefined, api: undefined });
  const lines = S.render(d).lines;
  assert.ok(lines.includes("Live: v2.5.1-community.24 (local tag; offline)"));
  assert.ok(lines.includes("PRs: skipped (offline)"));
  assert.ok(lines.includes("Actions: skipped (offline)"));
  assert.ok(lines.includes("GitHub API left: skipped (offline)"));
  assert.ok(lines.includes("main: 897f68a = origin/main · unreleased: #176 #177 · CI on main: skipped (offline)"));
  d.live = { tag: null };
  assert.ok(S.render(d).lines.includes("Live: none (no local tag; offline)"));
});

// ---- the command line -----------------------------------------------------------------------------------------------------------------------------------------

const exec = promisify(execFile);
async function cli(args, { env = {}, cwd } = {}) {
  try {
    const r = await exec(process.execPath, [TOOL, ...args], { cwd, env: { ...process.env, ...env } });
    return { code: 0, out: r.stdout, err: r.stderr };
  } catch (e) {
    return { code: e.code, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
}
// A gh that would leave a marker file if the tool ever ran it.
function fakeGhBin() {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const marker = join(scratch, "gh-was-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { env: { PATH: `${bin}:${process.env.PATH}` }, marker };
}

test("--help prints one usage line; a wrong option, a positional or a bad --ram-limit exits 2", async () => {
  const help = await cli(["--help"]);
  assert.deepEqual([help.code, help.out.trimEnd().split("\n").length], [0, 1]);
  assert.match(help.out, /^usage: node tools\/agent\/status\.mjs /);
  for (const bad of [["--nope"], ["extra"], ["--ram-limit", "lots"], ["--ram-limit", "-3"], ["--root"]]) {
    const r = await cli(bad);
    assert.equal(r.code, 2, bad.join(" "));
    assert.match(r.err, /usage: node tools\/agent\/status\.mjs/);
    assert.equal(r.out, "");
  }
});

test("--offline never runs gh (a fake gh on the PATH would leave a marker), prints 'PRs: skipped (offline)' and exits 0", async () => {
  const { env, marker } = fakeGhBin();
  const r = await cli(["--offline", "--root", shared.root, "--ram-limit", "1000"], { env });
  const lines = r.out.trimEnd().split("\n");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(lines[0], /^status \d{4}-\d\d-\d\d \d\d:\d\d \S+ · repo$/);
  assert.equal(lines[1], "Live: v2.5.1-community.24 (local tag; offline)");
  assert.ok(lines.includes("PRs: skipped (offline)"));
  assert.ok(lines.includes("Worktrees: 8"));
  assert.match(lines.at(-1), /^status: OK/);
  assert.equal(existsSync(marker), false);
});

test("--json prints the collected data instead of lines", async () => {
  const r = await cli(["--offline", "--no-fetch", "--json", "--root", shared.root]);
  const data = JSON.parse(r.out);
  assert.equal(r.code, 0);
  assert.equal(data.offline, true);
  assert.equal(data.main.lastTag, "v2.5.1-community.24");
  assert.equal(data.worktrees.length, 8);
});

test("a gh that fails (a fake gh with no login) is a FAIL line and exit 1 without --offline", async () => {
  const { env, marker } = fakeGhBin();
  const r = await cli(["--no-fetch", "--root", shared.root], { env });
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL: gh release view failed \(exit 1\) → gh auth status, or run with --offline$/m);
  assert.ok(existsSync(marker));
  assert.match(r.out.trimEnd().split("\n").at(-1), /^status: 4 problem\(s\)$/);
});

// The tools copied into a checkout of a scratch repo, as they sit in the real one.
function installTools(folder) {
  const dest = join(folder, "tools", "agent");
  mkdirSync(dest, { recursive: true });
  for (const name of ["status.mjs", "check-map.mjs", "ports.mjs"]) cpSync(fileURLToPath(new URL(`../tools/agent/${name}`, import.meta.url)), join(dest, name));
  return join(dest, "status.mjs");
}

test("with no --root the report is about the main checkout: a run from the main checkout, and a run from inside a linked worktree", async () => {
  const { root, base } = light();
  git(root, "worktree", "add", "-q", "--no-track", "-b", "elsewhere", join(base, "wt-elsewhere"), "origin/main");
  const fromMain = await exec(process.execPath, [installTools(root), "--offline", "--no-fetch"], { cwd: home, env: process.env });
  const fromWorktree = await exec(process.execPath, [installTools(join(base, "wt-elsewhere")), "--offline", "--no-fetch"], { cwd: home, env: process.env });
  // the tools sit untracked in the checkout they were copied into: 3 new files there, and the main line says so
  for (const [r, elsewhere] of [[fromMain, "clean"], [fromWorktree, "3 new files"]]) {
    const out = r.stdout.split("\n");
    assert.match(out[0], / · repo$/); // not "wt-elsewhere"
    assert.match(out.find((l) => l.startsWith("main:")), / · 3 new files$/);
    assert.ok(out.includes("Worktrees: 1"));
    assert.match(out.find((l) => l.includes("../wt-elsewhere")), new RegExp(`^ +elsewhere +new, no commits · ${elsewhere} · .+ ago +\\.\\./wt-elsewhere$`));
  }
});

test("a real playwright-like process: its folder, its output file and its progress are read from the system (lsof on a Mac, /proc on Linux)", async (t) => {
  if (basename(process.execPath) !== "node") return t.skip("the test node is not called node");
  const script = join(scratch, "node_modules", ".bin", "playwright");
  mkdirSync(join(scratch, "node_modules", ".bin"), { recursive: true });
  writeFileSync(script, 'process.stdout.write("Running 20 tests using 2 workers\\n");\nfor (let i = 1; i <= 6; i++) process.stdout.write("  ✓  " + i + " [site] › test/x.spec.mjs:" + i + ":1 › t" + i + " (1ms)\\n");\nsetInterval(() => {}, 1000);\n');
  const fileDir = join(scratch, "run-in-file");
  const pipeDir = join(scratch, "run-in-pipe");
  mkdirSync(fileDir);
  mkdirSync(pipeDir);
  const logPath = join(scratch, "run.log");
  const fd = openSync(logPath, "w");
  const children = [
    spawn(process.execPath, [script, "test", "alpha.spec.mjs", "--workers=2"], { cwd: fileDir, stdio: ["ignore", fd, "ignore"] }),
    spawn(process.execPath, [script, "test", "beta.spec.mjs"], { cwd: pipeDir, stdio: ["ignore", "pipe", "ignore"] }),
  ];
  children[1].stdout.resume();
  try {
    for (let i = 0; i < 100 && !readFileSync(logPath, "utf8").includes("✓  6"); i++) await new Promise((r) => setTimeout(r, 50));
    const r = await cli(["--offline", "--no-fetch", "--root", shared.root]);
    const rows = r.out.split("\n");
    assert.match(rows.find((l) => l.includes("run-in-file")), /^ +run-in-file +alpha\.spec\.mjs +6 \/ 20, 0 failed · \d+ (?:s|min) in/);
    assert.match(rows.find((l) => l.includes("run-in-pipe")), /^ +run-in-pipe +beta\.spec\.mjs +\(output not in a file\) · \d+ (?:s|min) in$/);
    assert.match(rows.find((l) => l.startsWith("Tests:")), /^Tests: \d+ of 2 running, \d+ free · /);
  } finally {
    for (const c of children) c.kill();
    closeSync(fd);
    await Promise.all(children.map((c) => new Promise((done) => (c.exitCode !== null || c.signalCode ? done() : c.once("exit", done)))));
  }
});

test("the source builds no shell string: no execSync( and no shell: true", () => {
  const src = readFileSync(TOOL, "utf8");
  assert.doesNotMatch(src, /execSync\(|spawnSync\(|shell:\s*true/);
});
