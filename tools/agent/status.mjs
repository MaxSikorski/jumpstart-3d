// Where are we, in one call: the live release, main and its CI, open PRs, worktrees (merged? pushed? dirty?), test runs and free slots, RAM and swap,
// the GitHub API budget, the agent map (check-map) and the ready backlog items. About 25 lines, then the WARN lines (each with its next step) and a last line.
// Read-only except `git fetch -q --prune --no-auto-maintenance origin` (20 s limit). --offline uses no fetch and no gh at all; --no-fetch skips only the fetch.
// A failed gh call prints one FAIL line in place of its section (the other sections still print) and the exit code is 1. Exit 2 = bad usage.
// Every git, gh, ps, lsof and sysctl call goes through execFile with an argument array (never a shell string), so no quoting trap can eat an argument.
// A test run is a process whose program is `node` and whose script is playwright (`playwright test`, `playwright/cli.js test`) or
// tools/(chat-bench|judge-exports|measure-load).mjs: shells, `npm exec`, workers, wait loops and agent prompts that only mention "playwright test" never count.
// The main checkout is the first entry of `git worktree list`; with no --root the report is about it, also when the script is run from a linked worktree.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { check as checkMap } from "./check-map.mjs";
import { claimedPorts, freePort, isListening } from "./ports.mjs";

const USAGE = "usage: node tools/agent/status.mjs [--root <dir>] [--offline] [--no-fetch] [--json] [--ram-limit <GB>] [--help]  "
  + "(--offline = no git fetch and no gh; default root = the main checkout; default RAM limit = total RAM minus 3 GB)";
const SLOTS = 2; // Playwright runs at once on this Mac
const GB = 1024 ** 3;
const LOG_MAX = 20e6; // a run's output file bigger than this is not read
const GH_HINT = "gh auth status, or run with --offline";
const FAILED_CHECK = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const QUIET_MERGE_STATES = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS", "DRAFT"]);
const TOOL_SCRIPT = /(?:^|\/)tools\/(chat-bench|judge-exports|measure-load)\.mjs$/;
const PLAYWRIGHT_SCRIPT = /(?:^|\/)(?:playwright(?:\/cli\.js)?|@playwright\/test\/cli\.js)$/;

// ---- small helpers -------------------------------------------------------------------------------------------------------------------------------------------

const lines = (s) => s.split("\n").filter(Boolean);
const pad2 = (n) => String(n).padStart(2, "0");
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const gb = (bytes) => (bytes / GB).toFixed(1);
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export function clock(d) {
  const tz = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm(d)} ${tz}`.trim();
}

// ps etime: [[dd-]hh:]mm:ss -> seconds
export function parseEtime(s) {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return null;
  const [d, h, min, sec] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0));
  return ((d * 24 + h) * 60 + min) * 60 + sec;
}

// 45 s, 8 min, 1 h 05 min
export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${pad2(min % 60)} min`;
}

// Seconds left, from the pace so far; null until 5 tests are done.
export function eta(elapsed, done, total) {
  return done >= 5 && total > done ? Math.round((elapsed * (total - done)) / done) : null;
}

// ---- parsers (text in, plain values out) ---------------------------------------------------------------------------------------------------------------------

// Test runs in a `ps -o pid=,etime=,command=` listing: [{ pid, elapsed, tool, specs, lastFailed }]
export function parsePs(text) {
  const runs = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(\S.*)$/.exec(line);
    if (!m || m[3].includes("workerProcessEntry")) continue;
    const words = m[3].trim().split(/\s+/);
    if (!/^node(?:\.exe)?$/.test(basename(words[0]))) continue;
    const at = words.findIndex((w, i) => i > 0 && !w.startsWith("-")); // the script, after any node options
    if (at < 0) continue;
    const script = words[at];
    const tool = TOOL_SCRIPT.exec(script)?.[1] ?? (PLAYWRIGHT_SCRIPT.test(script) && words[at + 1] === "test" ? "playwright" : null);
    if (!tool) continue;
    const args = words.slice(at + 1);
    runs.push({
      pid: Number(m[1]),
      elapsed: parseEtime(m[2]) ?? 0,
      tool,
      specs: tool === "playwright" ? args.filter((a) => /\.spec\.mjs(?::\d+)*$/.test(a)).map((a) => basename(a).replace(/(?::\d+)+$/, "")) : [],
      lastFailed: args.includes("--last-failed"),
    });
  }
  return runs;
}

// `lsof -Fpfn` records -> Map pid -> { cwd, out } (out = the name behind file descriptor 1)
export function parseLsof(text) {
  const found = new Map();
  let entry, fd;
  for (const line of text.split("\n")) {
    const value = line.slice(1);
    if (line[0] === "p") { entry = {}; found.set(Number(value), entry); fd = null; }
    else if (line[0] === "f") fd = value;
    else if (line[0] === "n" && entry) { if (fd === "cwd") entry.cwd = value; else if (fd === "1") entry.out = value; }
  }
  return found;
}

// A Playwright run's output (list or line reporter) -> { total, done, failed } or null before the "Running N tests" line. Only the last run in the text counts.
// List reporter: done = the highest finished number. Line reporter: `[n/total]` is the number started, shown as is (at most `workers` ahead of finished).
export function parseProgress(text) {
  const head = [...text.matchAll(/Running (\d+) tests? using (\d+) workers?/g)].at(-1); // a log may hold several runs (a rerun appended): the last one counts
  if (head) text = text.slice(head.index);
  let total = head ? Number(head[1]) : null;
  let done = 0;
  let failed = 0;
  const list = [...text.matchAll(/^\s+(✓|✘|-)\s+(\d+) \[/gm)];
  if (list.length) {
    done = list.reduce((hi, m) => Math.max(hi, Number(m[2])), 0);
    failed = list.filter((m) => m[1] === "✘").length;
  } else {
    const counter = [...text.matchAll(/^\[(\d+)\/(\d+)\]/gm)];
    if (counter.length) {
      done = counter.reduce((hi, m) => Math.max(hi, Number(m[1])), 0);
      total ??= Number(counter.at(-1)[2]);
      failed = new Set([...text.matchAll(/^\s+(\d+)\) \[/gm)].map((m) => m[1])).size;
    }
  }
  return total === null ? null : { total, done, failed };
}

export function parseVmStat(text) {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (name) => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, "m").exec(text)?.[1]);
  const free = pages("free") + pages("inactive"); // free + inactive pages count as free, as slack.sh did
  return size && Number.isFinite(free) ? { freeBytes: free * size } : null;
}

// `sysctl -n vm.swapusage`: "total = 1024.00M  used = 0.25M  free = 1023.75M  (encrypted)"
export function parseSwap(text) {
  const m = /used = ([\d.]+)([KMGT])/.exec(text);
  return m ? { text: `${m[1]}${m[2]}`, bytes: Number(m[1]) * 1024 ** "KMGT".indexOf(m[2]) * 1024 } : null;
}

export function parseMeminfo(text) {
  const kb = (name) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1]);
  const [total, available, swapTotal, swapFree] = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"].map(kb);
  if (!(total > 0) || !Number.isFinite(available)) return null;
  return { totalBytes: total * 1024, usedBytes: (total - available) * 1024, swapBytes: Number.isFinite(swapTotal) ? (swapTotal - (swapFree || 0)) * 1024 : null };
}

// A PR's check rollup -> fail | running | none | pass
export function ciWord(rollup = []) {
  const isStatus = (c) => c.__typename === "StatusContext" || (c.__typename === undefined && c.state !== undefined);
  if (rollup.some((c) => (isStatus(c) ? ["FAILURE", "ERROR"].includes(c.state) : FAILED_CHECK.has(c.conclusion)))) return "fail";
  if (rollup.some((c) => (isStatus(c) ? ["PENDING", "EXPECTED"].includes(c.state) : c.status !== "COMPLETED"))) return "running";
  return rollup.length ? "pass" : "none";
}

// ---- running things ------------------------------------------------------------------------------------------------------------------------------------------

// Resolves { code, stdout, stderr } and never rejects. GIT_OPTIONAL_LOCKS=0 keeps `git status` from touching another worktree's index.
export function runCommand(cmd, args, { cwd, timeout = 60_000 } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GH_PROMPT_DISABLED: "1" };
  return new Promise((done) => {
    execFile(cmd, args, { cwd, env, timeout, encoding: "utf8", maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      // an exit code alone has no text: the FAIL line then says "exit N"
      const why = !err || typeof err.code === "number" ? "" : err.killed ? `timed out after ${timeout / 1000} s` : err.message;
      done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr: stderr || why });
    });
  });
}

const failure = (what, r, hint = GH_HINT) => ({ error: `${what} failed (${r.stderr.trim().split("\n")[0] || `exit ${r.code}`})`, hint });
function ghJson(r, what) {
  if (r.code !== 0) return failure(what, r);
  try { return { value: JSON.parse(r.stdout) }; } catch { return failure(what, { stderr: "unreadable output", code: r.code }); }
}

function defaultReadLog(path) {
  try {
    const st = statSync(path);
    if (!st.isFile()) return { note: "output not in a file" };
    return st.size > LOG_MAX ? { note: "log over 20 MB" } : { text: readFileSync(path, "utf8") };
  } catch { return { note: "output not in a file" }; }
}
const defaultReadlink = (p) => { try { return readlinkSync(p); } catch { return undefined; } };

// ---- worktrees -----------------------------------------------------------------------------------------------------------------------------------------------

function parseWorktrees(text) {
  return text.split("\n\n").map((block, i) => {
    const w = { path: null, head: null, branch: null, detached: false, bare: false, main: i === 0 }; // git lists the main working tree first
    for (const l of block.split("\n")) {
      if (l.startsWith("worktree ")) w.path = l.slice(9);
      else if (l.startsWith("HEAD ")) w.head = l.slice(5);
      else if (l.startsWith("branch ")) w.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") w.detached = true;
      else if (l === "bare") w.bare = true;
    }
    return w;
  }).filter((w) => w.path && !w.bare).sort((a, b) => (a.path < b.path ? -1 : 1)); // by folder, whatever order this git version lists the linked ones in
}

// Every worktree: { path, rel, branch, detached, isMain, missing, dirty, untracked, state: merged | new | ahead, ahead, remote: null | { new, behind }, age }.
// isMain = the first entry of `git worktree list`; dirty = changed tracked files, untracked = new files that git does not ignore.
// merged = the tip is the second parent of a merge on origin/main's first-parent line (the last 500 merges): a PR merge.
// `--first-parent` leaves out the merges inside a PR's branch ("Merge origin/main into <branch>"), whose second parent is an old main tip, not a merged branch.
// new = the tip is already on origin/main.
// remote = the branch's refs/remotes/origin/<branch> (branches are --no-track).
export async function worktreeStates({ root, run }) {
  const git = (args, cwd = root) => run("git", args, { cwd });
  const base = (await git(["rev-parse", "-q", "--verify", "origin/main"])).code === 0 ? "origin/main" : "main";
  const [list, merges] = await Promise.all([
    git(["worktree", "list", "--porcelain"]),
    git(["rev-list", "--first-parent", "--merges", "--parents", "-n", "500", base]),
  ]);
  const mergedTips = new Set(merges.stdout.split("\n").map((l) => l.split(" ")[2]).filter(Boolean));
  return Promise.all(parseWorktrees(list.stdout).map(async (w) => {
    const info = { path: w.path, rel: relative(root, w.path), branch: w.branch, detached: w.detached, isMain: w.main };
    if (!existsSync(w.path)) return { ...info, missing: true };
    const changes = lines((await git(["status", "--porcelain", "--untracked-files=all"], w.path)).stdout);
    const untracked = changes.filter((l) => l.startsWith("??")).length;
    const dirty = { dirty: changes.length - untracked, untracked };
    if (info.isMain) return { ...info, ...dirty };
    const [count, age, remote] = await Promise.all([
      git(["rev-list", "--count", `${base}..${w.head}`]),
      git(["log", "-1", "--format=%cr"], w.path),
      w.branch ? git(["rev-list", "--left-right", "--count", `${w.head}...refs/remotes/origin/${w.branch}`]) : null,
    ]);
    const ahead = Number(count.stdout);
    const [mine, theirs] = remote?.code === 0 ? remote.stdout.trim().split(/\s+/).map(Number) : [];
    return {
      ...info, ...dirty, age: age.stdout.trim(), ahead,
      state: mergedTips.has(w.head) ? "merged" : ahead === 0 ? "new" : "ahead",
      remote: mine === undefined ? null : { new: mine, behind: theirs },
    };
  }));
}

const pushText = (r) => {
  if (!r) return "not pushed";
  const ahead = r.new === 0 && r.behind === 0 ? "pushed" : r.new ? `pushed, ${r.new} new` : null;
  return [ahead, r.behind ? `behind origin ${r.behind}` : null].filter(Boolean).join(", ");
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "clean", "2 dirty", "1 new file" or "2 dirty, 3 new files": changed tracked files, and files git does not know yet
export const changesText = (w) => [w.dirty && `${w.dirty} dirty`, w.untracked && plural(w.untracked, "new file")].filter(Boolean).join(", ") || "clean";

// One worktree's status text; w.pr (an open PR number) is added by collect.
export function describeWorktree(w) {
  if (w.missing) return "missing → git worktree prune";
  const changes = changesText(w);
  if (w.state === "merged") return changes === "clean" ? "merged" : `merged · ${changes}`;
  const parts = [w.state === "new" ? "new, no commits" : `ahead ${w.ahead}`];
  if (w.state === "ahead" && w.branch) parts.push(pushText(w.remote));
  if (w.pr) parts.push(`PR #${w.pr}`);
  parts.push(changes, w.age);
  return parts.join(" · ");
}

// ---- collect -------------------------------------------------------------------------------------------------------------------------------------------------

async function mainState({ root, run }) {
  const git = (args) => run("git", args, { cwd: root });
  const rev = async (ref) => { const r = await git(["rev-parse", "-q", "--verify", ref]); return r.code === 0 ? r.stdout.trim() : null; };
  const [sha, originSha, tags] = await Promise.all([rev("main"), rev("origin/main"), git(["tag", "--list", "v*-community.*", "--sort=-v:refname"])]);
  const lastTag = lines(tags.stdout)[0] ?? null;
  const out = { sha, originSha, ahead: 0, behind: 0, lastTag, unreleased: null };
  if (sha && originSha) {
    const r = await git(["rev-list", "--left-right", "--count", "main...origin/main"]);
    if (r.code === 0) [out.ahead, out.behind] = r.stdout.trim().split(/\s+/).map(Number);
  }
  if (lastTag) {
    const r = await git(["log", "--first-parent", "--merges", "--format=%s", `${lastTag}..${originSha ? "origin/main" : "main"}`]);
    if (r.code === 0) out.unreleased = lines(r.stdout).map((s) => /^Merge pull request #(\d+)/.exec(s)?.[1]).filter(Boolean).map(Number).reverse();
  }
  return out;
}

const PR_FIELDS = "number,title,isDraft,headRefName,baseRefName,mergeStateStatus,statusCheckRollup";
const QUEUED = new Set(["queued", "waiting", "pending", "requested"]);
function describeRun(r) {
  if (r.status !== "completed") return QUEUED.has(r.status) ? "queued" : "running";
  return ["success", "skipped", "neutral"].includes(r.conclusion) ? r.conclusion : `${r.conclusion} ${r.databaseId}`;
}

// One `gh run list` -> CI on origin/main per workflow (test first), the newest nightly, and the running/queued counts.
function actionsFrom(runs, originSha) {
  const names = [...new Set(runs.map((r) => r.workflowName))].filter((n) => n !== "nightly");
  names.sort((a, b) => (a === "test" ? -1 : b === "test" ? 1 : a.localeCompare(b)));
  const onMain = (name) => runs.find((r) => r.workflowName === name && r.headBranch === "main" && r.headSha === originSha);
  const ci = names.filter(onMain).map((name) => ({ name, word: describeRun(onMain(name)) }));
  const nightly = runs.find((r) => r.workflowName === "nightly" && r.headBranch === "main");
  return {
    ci, nightly: nightly ? { word: describeRun(nightly) } : null,
    running: runs.filter((r) => r.status === "in_progress").length, queued: runs.filter((r) => QUEUED.has(r.status)).length,
  };
}

async function locate(pids, { platform, run, readlink }) {
  if (!pids.length) return new Map();
  if (platform === "darwin") return parseLsof((await run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd,1", "-Fpfn"])).stdout);
  return new Map(pids.map((p) => [p, { cwd: readlink(`/proc/${p}/cwd`), out: readlink(`/proc/${p}/fd/1`) }])); // Linux
}

async function testRuns({ platform, run, readLog, readlink }) {
  const ps = await run("ps", platform === "darwin" ? ["-axo", "pid=,etime=,command="] : ["-eww", "-o", "pid=,etime=,args="]);
  if (ps.code !== 0) return failure("ps", ps, "check that ps is on the PATH");
  const runs = parsePs(ps.stdout);
  const where = await locate(runs.map((r) => r.pid), { platform, run, readlink });
  for (const r of runs) {
    const w = where.get(r.pid) ?? {};
    const log = w.out?.startsWith("/") ? readLog(w.out) : { note: "output not in a file" };
    Object.assign(r, { cwd: w.cwd ?? null, progress: log.text === undefined ? null : parseProgress(log.text), note: log.note ?? null });
  }
  return { runs, free: Math.max(0, SLOTS - runs.length) };
}

async function memoryState({ platform, run, readFile }) {
  if (platform === "darwin") {
    const [vm, size, swap] = await Promise.all([run("vm_stat", []), run("sysctl", ["-n", "hw.memsize"]), run("sysctl", ["-n", "vm.swapusage"])]);
    const free = parseVmStat(vm.stdout);
    const total = Number(size.stdout);
    if (free && total > 0) return { totalBytes: total, usedBytes: total - free.freeBytes, swap: parseSwap(swap.stdout) };
  } else if (platform === "linux") {
    try {
      const m = parseMeminfo(readFile("/proc/meminfo"));
      if (m) {
        const swap = m.swapBytes === null ? null : { bytes: m.swapBytes, text: `${(m.swapBytes / 1024 ** 2).toFixed(2)}M` };
        return { totalBytes: m.totalBytes, usedBytes: m.usedBytes, swap };
      }
    } catch { /* fall through to os */ }
  }
  return { totalBytes: totalmem(), usedBytes: totalmem() - freemem(), swap: null };
}

function backlogState(root, readFile) {
  let text;
  try { text = readFile(join(root, ".claude", "backlog.md")); } catch { return null; }
  const items = text.split("\n").filter((l) => /state: (?:ready|every heartbeat)/.test(l));
  return { count: items.length, first: items[0]?.replace(/^\s*-\s+/, "") ?? null };
}

function mapState(root) {
  try {
    const r = checkMap({ root });
    return { problems: r.problems, skipped: r.lines.some((l) => l.startsWith("SKIP AGENTS.md")) };
  } catch { return { problems: 0, skipped: true }; }
}

// Everything the report needs, as plain data. The gh calls run side by side; a failed one becomes { error, hint } in its section.
// fetch = run `git fetch` first. Injectable: run (cmd, args, { cwd, timeout }), readFile, readLog, readlink, platform, portBusy (a connect check), now.
export async function collect({
  root, offline = false, fetch = true, run = runCommand, readFile = (p) => readFileSync(p, "utf8"),
  readLog = defaultReadLog, readlink = defaultReadlink, platform = process.platform, portBusy = isListening, now = () => new Date(),
}) {
  const data = { time: clock(now()), project: basename(root), root, offline };
  if ((await run("git", ["rev-parse", "--git-dir"], { cwd: root })).code !== 0) return { ...data, notRepo: true };
  if (fetch && !offline) {
    const fetched = await run("git", ["fetch", "-q", "--prune", "--no-auto-maintenance", "origin"], { cwd: root, timeout: 20_000 });
    data.fetchFailed = fetched.code !== 0;
  }
  const gh = (args) => (offline ? null : run("gh", args, { cwd: root }));
  const [release, runs, prs, rate, main, worktrees, tests, memory] = await Promise.all([
    gh(["release", "view", "--json", "tagName,url,publishedAt"]),
    gh(["run", "list", "--limit", "20", "--json", "workflowName,status,conclusion,headSha,headBranch,databaseId"]),
    gh(["pr", "list", "--state", "open", "--limit", "30", "--json", PR_FIELDS]),
    gh(["api", "rate_limit"]),
    mainState({ root, run }),
    worktreeStates({ root, run }),
    testRuns({ platform, run, readLog, readlink }),
    memoryState({ platform, run, readFile }),
  ]);
  const mainWorktree = worktrees.find((w) => w.isMain);
  data.main = {
    ...main, dirty: mainWorktree?.dirty ?? 0, untracked: mainWorktree?.untracked ?? 0,
    checkout: mainWorktree?.detached ? "(detached)" : mainWorktree?.branch ?? null,
  };

  if (offline) data.live = { tag: main.lastTag };
  else {
    const r = ghJson(release, "gh release view");
    const published = (t) => `${t.replace("T", " ").slice(0, 16)} UTC`;
    data.live = r.error ? r : { tag: r.value.tagName, url: r.value.url, published: published(r.value.publishedAt) };
  }
  if (!offline) {
    const a = ghJson(runs, "gh run list");
    data.actions = a.error ? a : actionsFrom(a.value, main.originSha ?? main.sha);
    const p = ghJson(prs, "gh pr list");
    data.prs = p.error ? p : { list: p.value.map((x) => ({
      number: x.number, draft: x.isDraft, ci: ciWord(x.statusCheckRollup), branch: x.headRefName, title: x.title, state: x.mergeStateStatus, base: x.baseRefName,
    })) };
    const l = ghJson(rate, "gh api rate_limit");
    const res = l.value?.resources;
    data.api = l.error ? l : { core: res.core, graphql: res.graphql, reset: hhmm(new Date(res.core.reset * 1000)) };
  }
  data.worktrees = worktrees.filter((w) => !w.isMain).map((w) => ({ ...w, pr: data.prs?.list?.find((p) => p.branch === w.branch)?.number }));
  data.tests = tests.error ? tests : { ...tests, port: await freePort({ claimed: claimedPorts(worktrees.map((w) => w.path)), busy: portBusy }) };
  data.memory = memory;
  data.map = mapState(root);
  data.backlog = backlogState(root, readFile);
  return data;
}

// ---- render --------------------------------------------------------------------------------------------------------------------------------------------------

// Rows of cells -> indented lines, every cell but the last padded to its column. A one-cell row (the "… and N more" row) is printed as it is.
function table(rows) {
  const widths = [];
  for (const r of rows) r.slice(0, -1).forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, c.length); });
  return rows.map((r) => `  ${r.map((c, i) => (i < r.length - 1 ? c.padEnd(widths[i]) : c)).join("  ").trimEnd()}`);
}
const capped = (rows, max) => (rows.length > max ? [...rows.slice(0, max), [`… and ${rows.length - max} more`]] : rows);
function runRow(r) {
  const specs = r.specs.slice(0, 2).join(", ") + (r.specs.length > 2 ? ` +${r.specs.length - 2}` : "");
  const label = r.tool !== "playwright" ? r.tool : r.lastFailed ? "last failed" : r.specs.length ? specs : "all specs";
  const p = r.progress;
  const left = r.note ? `(${r.note})` : p ? `${p.done} / ${p.total}, ${p.failed} failed` : "no progress yet";
  const rest = p ? eta(r.elapsed, p.done, p.total) : null;
  const timing = [left, `${formatDuration(r.elapsed)} in`, rest === null ? null : `ETA ~${formatDuration(rest)}`];
  return [r.cwd ? basename(r.cwd) : "(folder unknown)", label, timing.filter(Boolean).join(" · ")];
}

// The "main:" line: where main stands, what is unreleased, CI, and what is not clean in the main checkout.
function mainLine(data) {
  const m = data.main;
  const behind = [m.ahead && `ahead ${m.ahead}`, m.behind && `behind ${m.behind}`].filter(Boolean).join(", ");
  const sync = !m.originSha ? "(no origin/main)" : behind ? `${behind} vs origin/main` : "= origin/main";
  const parts = [m.sha ? `main: ${m.sha.slice(0, 7)} ${sync}` : "main: no local main branch"];
  if (m.unreleased) {
    const shown = m.unreleased.slice(0, 8).map((n) => `#${n}`).join(" ") + (m.unreleased.length > 8 ? ` +${m.unreleased.length - 8}` : "");
    parts.push(`unreleased: ${shown || "none"}`);
  }
  if (data.offline) parts.push("CI on main: skipped (offline)");
  else if (!data.actions.error) {
    const ci = data.actions.ci.map((c) => `${c.name} ${c.word}`).join(", ");
    parts.push(`CI on main: ${ci || "not in the last 20 runs"}`);
    if (data.actions.nightly) parts.push(`nightly ${data.actions.nightly.word}`);
  }
  if (m.checkout && m.checkout !== "main") parts.push(`checkout on ${m.checkout}`);
  if (changesText(m) !== "clean") parts.push(changesText(m));
  return parts.join(" · ");
}

function prRows(prs) {
  return prs.map((p) => {
    const flags = [QUIET_MERGE_STATES.has(p.state) ? "" : `[${p.state}]`, p.base === "main" ? "" : `base=${p.base}`];
    return [`#${p.number}`, p.draft ? "draft" : "ready", p.ci, p.branch, [cut(p.title, 50), ...flags].filter(Boolean).join(" ")];
  });
}

// data -> { lines, problems, warnings }. ramLimit in GB (default: total RAM minus 3).
export function render(data, { ramLimit } = {}) {
  const head = `status ${data.time} · ${data.project}`;
  if (data.notRepo) {
    const lines = [head, `FAIL: ${data.root} is not a git repository → pass --root <the repo>`, "status: 1 problem(s)"];
    return { lines, problems: 1, warnings: [] };
  }
  const out = [head];
  const warnings = [];
  let problems = 0;
  const warn = (what, next) => warnings.push(`WARN: ${what} → ${next}`);
  const failed = (e) => { problems++; return `FAIL: ${e.error} → ${e.hint}`; };
  const offline = (label) => `${label}: skipped (offline)`;

  const live = data.live;
  if (live.error) out.push(failed(live));
  else if (data.offline) out.push(live.tag ? `Live: ${live.tag} (local tag; offline)` : "Live: none (no local tag; offline)");
  else out.push(`Live: ${live.tag} · ${live.published} · ${live.url}`);

  out.push(mainLine(data));
  if (data.main.behind) warn(`main is ${data.main.behind} behind origin/main`, "git merge --ff-only origin/main");

  if (data.offline) out.push(offline("PRs"));
  else if (data.prs.error) out.push(failed(data.prs));
  else if (!data.prs.list.length) out.push("PRs: none open");
  else {
    const n = data.prs.list.length;
    out.push(`PRs: ${n}${n >= 30 ? "+" : ""} open`, ...table(capped(prRows(data.prs.list), 8)));
  }

  out.push(data.worktrees.length ? `Worktrees: ${data.worktrees.length}` : "Worktrees: none besides the main checkout",
    ...table(capped(data.worktrees.map((w) => [w.branch ?? "(detached)", describeWorktree(w), w.rel]), 10)));
  // Only a branch that is merged and has nothing in its folder that is not in the repo gets the removal advice.
  for (const w of data.worktrees.filter((x) => x.state === "merged" && changesText(x) === "clean")) {
    warn(`worktree ${w.branch} is merged`, `git worktree remove ${w.rel} && git branch -D ${w.branch}`);
  }

  const t = data.tests;
  if (t.error) out.push(failed(t));
  else {
    const port = t.port === null ? "no free port from 8805" : `next free port ${t.port}`;
    out.push(`Tests: ${t.runs.length} of ${SLOTS} running, ${t.free} free · ${port}`, ...table(capped(t.runs.map(runRow), 5)));
  }

  if (data.offline) out.push(offline("Actions"));
  else out.push(data.actions.error ? failed(data.actions) : `Actions: ${data.actions.running} running, ${data.actions.queued} queued`);

  const mem = data.memory;
  const limit = ramLimit ?? mem.totalBytes / GB - 3;
  out.push(`Memory: RAM in use ${gb(mem.usedBytes)} of ${gb(mem.totalBytes)} GB (limit ${limit.toFixed(1)}) · swap ${mem.swap ? mem.swap.text : "unknown"}`);
  if (mem.usedBytes / GB > limit) warn(`RAM in use ${gb(mem.usedBytes)} GB is over the ${limit.toFixed(1)} GB limit`, "let a run finish before starting another");
  if (mem.swap?.bytes > 0) warn(`swap used ${mem.swap.text}`, "keep swap at 0: stop a worker or close apps");

  if (data.offline) out.push(offline("GitHub API left"));
  else if (data.api.error) out.push(failed(data.api));
  else {
    const { core, graphql } = data.api;
    out.push(`GitHub API left: core ${core.remaining}/${core.limit} · graphql ${graphql.remaining}/${graphql.limit} · resets ${data.api.reset}`);
    for (const [name, r] of [["core", core], ["graphql", graphql]]) {
      if (r.remaining < 500) warn(`GitHub API ${name} has ${r.remaining} left`, "poll less: one watcher, 60 s apart");
    }
  }

  const mapProblems = plural(data.map.problems, "problem");
  if (data.map.skipped) out.push("Map: skipped (no AGENTS.md here)");
  else out.push(data.map.problems ? `Map: ${mapProblems} → node tools/agent/check-map.mjs` : "Map: OK (check-map)");
  if (data.map.problems) warn(`the agent map has ${mapProblems}`, "node tools/agent/check-map.mjs");
  if (data.backlog) out.push(data.backlog.count ? `Backlog ready: ${data.backlog.count} · first: ${cut(data.backlog.first, 70)}` : "Backlog ready: none");
  if (data.fetchFailed) warn("git fetch failed", "origin numbers may be stale");

  const k = warnings.length;
  out.push(...warnings, problems ? `status: ${problems} problem(s)` : k ? `status: OK, ${plural(k, "warning")}` : "status: OK");
  return { lines: out, problems, warnings };
}

// ---- command line --------------------------------------------------------------------------------------------------------------------------------------------

const OPTIONS = {
  root: { type: "string" }, "ram-limit": { type: "string" },
  offline: { type: "boolean" }, "no-fetch": { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" },
};

// The main checkout: the folder above the repo's shared git directory, so a run from inside a linked worktree reports on the main checkout.
// Falls back to the folder two levels above this script.
async function defaultRoot(run) {
  const fallback = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const r = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: fallback });
  const common = r.stdout.trim();
  return r.code === 0 && basename(common) === ".git" ? dirname(common) : fallback;
}

// argv (without node and the script) -> { code, out, err }. deps are passed to collect (tests inject run, platform, now, ...).
export async function main(argv, deps = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS }));
  } catch (e) {
    return { code: 2, out: "", err: `status: ${e.message}\n${USAGE}\n` };
  }
  if (values.help) return { code: 0, out: `${USAGE}\n`, err: "" };
  const ramLimit = values["ram-limit"] === undefined ? undefined : Number(values["ram-limit"]);
  if (ramLimit !== undefined && !(ramLimit > 0)) {
    return { code: 2, out: "", err: `status: --ram-limit needs a number of GB\n${USAGE}\n` };
  }
  let root = resolve(values.root ?? await defaultRoot(deps.run ?? runCommand));
  try { root = realpathSync(root); } catch { /* a missing folder shows up as "not a git repository" */ }
  const data = await collect({ root, offline: values.offline ?? false, fetch: !values["no-fetch"], ...deps });
  const { lines: text, problems } = render(data, { ramLimit });
  return { code: problems ? 1 : 0, out: `${values.json ? JSON.stringify(data, null, 2) : text.join("\n")}\n`, err: "" };
}

// realpath: a script reached through a symlinked folder (macOS /tmp, /var) must still run
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = await main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
