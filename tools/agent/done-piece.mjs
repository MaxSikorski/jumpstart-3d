// Cleans up one piece of work after its merge, the same way every time: the pair of new-piece.mjs.
// Steps (one line each): find the worktree of the branch; git fetch origin; the branch is merged (an ancestor of origin/main, or a merged pull request whose last commit is the
// branch tip: a squash merge leaves the branch off main's history, and a merged PR of an older branch with the same name must not count); the worktree has no changed tracked
// files (untracked files, like test logs, are fine and counted); git worktree remove --force; git branch -D; git push origin --delete (a branch already gone from origin is OK;
// --keep-remote leaves it); git pull --ff-only origin main in the main checkout (a WARN, not a FAIL, when that checkout is not on main or has changed tracked files).
// Nothing is deleted unless the merged and clean checks pass. A branch that has no worktree any more (removed by hand) is still cleaned up; main, the main checkout's own branch and a
// branch with no worktree and no local branch are refused. After the removal the three clean-up steps each run, whatever the one before did.
// When IMPROVEMENT_PLAN.md or .claude/backlog.md exists in the root, a NEXT line reminds you to tick them by hand (they are local files; this tool never edits them).
// Last line: `done-piece: OK <branch>`, or `done-piece: <n> problem(s)` (exit 1). WARN and SKIP lines do not count. A bad command line exits 2.
// Run it from the main checkout: `node tools/agent/done-piece.mjs <branch>`; --root points at a different checkout. Argument-list spawns only (no shell); git speaks English and never asks.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = "usage: node tools/agent/done-piece.mjs <branch> [--root <repo>] [--keep-remote]  (after the merge: removes the worktree, deletes the local and remote branch, fast-forwards main)";

// Runs a program with an argument list. Never throws; { ok, status, out, err } with trimmed text.
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", LC_ALL: "C" } });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? "").trim(), err: ((r.stderr ?? "").trim() || r.error?.message || "").trim() };
}
const git = (args, cwd) => run("git", args, cwd);
const firstLine = (s) => s.split("\n").find((l) => l.trim())?.replace(/^(?:fatal|error): /, "").trim() ?? "";
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// [{ path, branch }] for every worktree (branch is null when detached), the main checkout first.
function worktrees(root) {
  const r = git(["worktree", "list", "--porcelain"], root);
  if (!r.ok) return [];
  return r.out.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    return { path, branch: ref?.replace(/^refs\/heads\//, "") ?? null };
  }).filter((w) => w.path);
}

const changedTracked = (cwd) => git(["status", "--porcelain", "--untracked-files=no"], cwd).out.split("\n").filter(Boolean);

// Is the branch merged? { merged: true, how } or { merged: false, why }.
function mergedCheck(root, branch) {
  const tip = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], root).out;
  const ancestor = git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, "refs/remotes/origin/main"], root);
  if (ancestor.ok) return { merged: true, how: "an ancestor of origin/main" };
  if (ancestor.status !== 1) return { merged: false, why: `git could not compare it with origin/main: ${firstLine(ancestor.err)}` };
  const prs = run("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid"], root);
  if (!prs.ok) return { merged: false, why: `it is not an ancestor of origin/main and gh could not list merged pull requests: ${firstLine(prs.err)}` };
  let list;
  try { list = JSON.parse(prs.out || "[]"); } catch { return { merged: false, why: "gh printed something that is not JSON" }; }
  if (!Array.isArray(list)) return { merged: false, why: "gh printed something that is not a list of pull requests" };
  if (list.length === 0) return { merged: false, why: "it is not an ancestor of origin/main and no merged pull request has this branch as its head" };
  for (const pr of list) {
    if (typeof pr.headRefOid !== "string" || pr.headRefOid === "") continue;
    if (pr.headRefOid === tip || git(["merge-base", "--is-ancestor", tip, pr.headRefOid], root).ok) return { merged: true, how: `merged as pull request #${pr.number}` };
  }
  return { merged: false, why: `merged pull request #${list[0].number} does not contain the branch's last commit ${tip.slice(0, 7)}, so there is newer work on it` };
}

// Cleans up. say() gets each printed line. Returns the number of problems.
export function donePiece({ branch, root, keepRemote = false, say = console.log }) {
  let problems = 0;
  const abort = (what, next) => { say(`FAIL: ${what} → ${next}`); say("done-piece: 1 problem(s)"); return 1; };
  const fail = (what, next) => { say(`FAIL: ${what} → ${next}`); problems++; };

  if (branch.startsWith("-") || !git(["check-ref-format", `refs/heads/${branch}`], process.cwd()).ok) return abort(`"${branch}" is not a branch name git accepts`, "pass the piece's branch name");
  if (branch === "main") return abort("main is not a piece", "pass the piece's branch name");

  // 1. The repo and the worktree
  root = real(root);
  const toplevel = git(["rev-parse", "--show-toplevel"], root);
  if (!toplevel.ok) return abort(`${root} is not a git repo`, "run it from the main checkout or pass --root <repo>");
  if (real(toplevel.out) !== root) return abort(`${root} is inside a repo but is not its top folder`, `pass --root ${real(toplevel.out)}`);
  say(`OK repo ${root}`);

  const all = worktrees(root);
  const found = all.find((w) => w.branch === branch);
  const hasLocal = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).ok;
  let folder = null;
  if (found) {
    folder = real(found.path);
    const mainCheckout = real(all[0].path);
    if (folder === mainCheckout) return abort(`${branch} is checked out in the main checkout ${folder}, not in a piece worktree`, `git -C ${folder} switch main, then run it again`);
    if (folder === root) return abort(`${branch} is the worktree this run was started from (${folder}), which cannot remove itself`, `run it from the main checkout: node tools/agent/done-piece.mjs ${branch} --root ${mainCheckout}`);
    say(`OK worktree ${folder}`);
  } else if (hasLocal) say(`SKIP worktree (none for ${branch}; cleaning up the branch only)`);
  else return abort(`no worktree and no local branch called ${branch}`, "check the name with: git worktree list");

  // 2. Merged, and nothing to lose
  const fetched = git(["fetch", "origin"], root);
  if (!fetched.ok) return abort(`git fetch origin failed: ${firstLine(fetched.err)}`, "check the network and the origin remote, then run it again");
  if (!git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"], root).ok) return abort("origin/main does not exist after the fetch", `check the origin remote: git -C ${root} remote -v`);
  say("OK fetch origin");

  const merged = mergedCheck(root, branch);
  if (!merged.merged) return abort(`${branch} is not merged: ${merged.why}`, `finish the pull request (bash .claude/land.sh <worktree> ${branch} <pr>); to throw the work away instead, remove it by hand`);
  say(`OK merged (${merged.how})`);

  if (folder) {
    const changed = changedTracked(folder);
    if (changed.length > 0) return abort(`${changed.length} tracked file(s) changed in ${folder}`, "commit or discard them there, then run it again");
    const untracked = git(["ls-files", "--others", "--exclude-standard"], folder).out.split("\n").filter(Boolean).length;
    say(`OK clean (no changed tracked files; ${untracked} untracked file(s) will go with the worktree)`);

    const removed = git(["worktree", "remove", "--force", folder], root);
    if (!removed.ok) return abort(`git worktree remove failed: ${firstLine(removed.err)}`, `close what uses ${folder} (an editor, a test run), then run it again`);
    say(`OK removed worktree ${folder}`);
  }

  // 3. The branch, here and on origin (each step runs whatever the one before did)
  const deleted = git(["branch", "-D", branch], root);
  if (deleted.ok) say(`OK deleted local branch ${branch}`);
  else fail(`could not delete local branch ${branch}: ${firstLine(deleted.err)}`, `git -C ${root} branch -D ${branch}`);

  if (keepRemote) say(`SKIP origin/${branch} kept (--keep-remote)`);
  else {
    const pushed = git(["push", "origin", "--delete", branch], root);
    if (pushed.ok) say(`OK deleted origin/${branch}`);
    else if (/remote ref does not exist/i.test(pushed.err)) say(`OK origin/${branch} was already gone`);
    else fail(`could not delete origin/${branch}: ${firstLine(pushed.err)}`, `git -C ${root} push origin --delete ${branch}`);
  }

  // 4. Fast-forward the main checkout, when that is safe
  const current = git(["symbolic-ref", "--short", "-q", "HEAD"], root).out;
  const dirty = changedTracked(root);
  if (current !== "main") say(`WARN: ${root} is on ${current || "no branch (detached HEAD)"}, not main → skipped the fast-forward; later: git -C ${root} switch main && git -C ${root} pull --ff-only origin main`);
  else if (dirty.length > 0) say(`WARN: ${root} has ${dirty.length} changed tracked file(s) → skipped the fast-forward; after committing or stashing them: git -C ${root} pull --ff-only origin main`);
  else {
    const before = git(["rev-parse", "--short", "HEAD"], root).out;
    const pulled = git(["pull", "--ff-only", "origin", "main"], root);
    const after = git(["rev-parse", "--short", "HEAD"], root).out;
    if (!pulled.ok) fail(`could not fast-forward main in ${root}: ${firstLine(pulled.err)}`, `git -C ${root} pull --ff-only origin main (or sort out main by hand)`);
    else say(before === after ? `OK main already up to date (${after})` : `OK main fast-forwarded ${before} → ${after}`);
  }

  if (existsSync(join(root, "IMPROVEMENT_PLAN.md")) || existsSync(join(root, ".claude", "backlog.md"))) {
    say("NEXT: tick IMPROVEMENT_PLAN.md ## Progress and move the backlog line to .claude/backlog-done.md");
  }
  say(problems === 0 ? `done-piece: OK ${branch}` : `done-piece: ${problems} problem(s)`);
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) { // realpath: a script reached through a symlinked folder must still run
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { root: { type: "string" }, "keep-remote": { type: "boolean" }, help: { type: "boolean" } } });
  } catch (e) {
    console.error(`done-piece: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (positionals.length !== 1) { console.error(`done-piece: needs exactly one <branch>\n${USAGE}`); process.exit(2); }
  const problems = donePiece({
    branch: positionals[0],
    root: values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    keepRemote: values["keep-remote"] ?? false,
  });
  process.exitCode = problems === 0 ? 0 : 1;
}
