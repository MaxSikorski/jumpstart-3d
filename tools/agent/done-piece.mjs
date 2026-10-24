// Cleans up one piece of work after its merge, the same way every time: the pair of new-piece.mjs.
// Steps (one line each): find the worktree of the branch; git fetch origin; the branch is merged (an ancestor of origin/main, or a merged pull request whose last commit is the
// branch tip: a squash merge leaves the branch off main's history, and a merged PR of an older branch with the same name must not count); the worktree has no changed tracked
// files and no new files git does not know (git ls-files --others --exclude-standard: a file never added is the one thing a merge cannot have saved, so it is refused, the first
// five names listed; ignored files such as .js3d-port, the node_modules link and test-results may go); git worktree remove --force; git branch -D; the remote branch (see below);
// git pull --ff-only origin main in the main checkout (a WARN, not a FAIL, when that checkout is not on main or has changed tracked files).
// The remote branch goes only when its own last commit (git ls-remote, not a possibly stale tracking ref) passes the same merged check, and with --force-with-lease on that commit, so
// work pushed after the merge is never deleted: it is kept, with a FAIL. A branch already gone from origin is OK; --keep-remote leaves it alone.
// Nothing is deleted unless the merged and clean checks pass, and a git command that fails is a FAIL, never "nothing to see". A branch that has no worktree any more (removed or
// deleted by hand) is still cleaned up; main, the main checkout's own branch, the worktree this run was started from and a branch with no worktree and no local branch are refused.
// After the removal the clean-up steps each run, whatever the one before did. When IMPROVEMENT_PLAN.md or .claude/backlog.md exists in the root, a NEXT line reminds you to tick them
// by hand (they are local files; this tool never edits them).
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
// Why a push failed: git prints "To <url>" first, and the reason on the "rejected" or "error" line after it.
const pushReason = (err) => (err.split("\n").map((l) => l.trim()).find((l) => /^(?:!\s*)?\[(?:remote )?rejected\]|^error:|^fatal:/.test(l)) ?? firstLine(err)).replace(/^(?:error|fatal): /, "");
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const short = (sha) => sha.slice(0, 7);

// [{ path, branch }] for every worktree (branch is null when detached), the main checkout first; null when git cannot say.
function worktrees(root) {
  const r = git(["worktree", "list", "--porcelain"], root);
  if (!r.ok) return null;
  return r.out.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    return { path, branch: ref?.replace(/^refs\/heads\//, "") ?? null };
  }).filter((w) => w.path);
}

// The tracked files that changed in a folder: { ok, files } (ok is false when git could not tell).
function changedTracked(cwd) {
  const r = git(["status", "--porcelain", "--untracked-files=no"], cwd);
  return { ok: r.ok, err: firstLine(r.err), files: r.out.split("\n").filter(Boolean) };
}

// Is the commit merged? { merged: true, how } or { merged: false, why }. tip is a commit id: a branch's, here or on origin.
function mergedCheck(root, branch, tip) {
  const ancestor = git(["merge-base", "--is-ancestor", tip, "refs/remotes/origin/main"], root);
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
  return { merged: false, why: `merged pull request #${list[0].number} does not contain the last commit ${short(tip)}, so there is newer work on it` };
}

// The commit origin really has for the branch: { ok, sha } (sha is null when origin has no such branch). Asked of origin itself, not of a tracking ref that may be stale.
function remoteTip(root, branch) {
  const r = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], root);
  if (!r.ok) return { ok: false, err: firstLine(r.err) };
  const line = r.out.split("\n").find((l) => l.split("\t")[1] === `refs/heads/${branch}`);
  return { ok: true, sha: line ? line.split("\t")[0] : null };
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
  if (all === null) return abort(`git worktree list failed in ${root}`, `fix the repo (git -C ${root} worktree list), then run it again`);
  const found = all.find((w) => w.branch === branch);
  const local = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], root);
  let folder = null;
  let gone = false;
  if (found) {
    folder = real(found.path);
    const mainCheckout = real(all[0].path);
    if (folder === mainCheckout) return abort(`${branch} is checked out in the main checkout ${folder}, not in a piece worktree`, `git -C ${folder} switch main, then run it again`);
    if (folder === root) return abort(`${branch} is the worktree this run was started from (${folder}), which cannot remove itself`, `run it from the main checkout: node tools/agent/done-piece.mjs ${branch} --root ${mainCheckout}`);
    gone = !existsSync(found.path);
    say(gone ? `SKIP worktree ${folder} (the folder is gone; only git's record of it is left)` : `OK worktree ${folder}`);
  } else if (local.ok) say(`SKIP worktree (none for ${branch}; cleaning up the branch only)`);
  else return abort(`no worktree and no local branch called ${branch}`, "check the name with: git worktree list");
  if (!local.ok) return abort(`git cannot read the branch ${branch}`, `check it with: git -C ${root} branch -v`);

  // 2. Merged, and nothing to lose
  const fetched = git(["fetch", "origin"], root);
  if (!fetched.ok) return abort(`git fetch origin failed: ${firstLine(fetched.err)}`, "check the network and the origin remote, then run it again");
  if (!git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"], root).ok) return abort("origin/main does not exist after the fetch", `check the origin remote: git -C ${root} remote -v`);
  say("OK fetch origin");

  const merged = mergedCheck(root, branch, local.out);
  if (!merged.merged) return abort(`${branch} is not merged: ${merged.why}`, `finish the pull request (bash .claude/land.sh <worktree> ${branch} <pr>); to throw the work away instead, remove it by hand`);
  say(`OK merged (${merged.how})`);

  if (folder && !gone) {
    const changed = changedTracked(folder);
    if (!changed.ok) return abort(`git status failed in ${folder}: ${changed.err}`, `fix that worktree (git -C ${folder} status), then run it again`);
    if (changed.files.length > 0) return abort(`${changed.files.length} tracked file(s) changed in ${folder}`, "commit or discard them there, then run it again");
    // A merge cannot have saved a file that was never added: refuse, and name the first few. Ignored files (.js3d-port, the node_modules link, test-results) are not listed.
    const others = git(["ls-files", "--others", "--exclude-standard", "--directory"], folder);
    if (!others.ok) return abort(`git ls-files failed in ${folder}: ${firstLine(others.err)}`, `fix that worktree (git -C ${folder} status), then run it again`);
    const fresh = others.out.split("\n").filter(Boolean);
    if (fresh.length > 0) {
      const names = fresh.slice(0, 5).join(", ") + (fresh.length > 5 ? `, and ${fresh.length - 5} more` : "");
      return abort(`${fresh.length} new file(s) or folder(s) in ${folder} were never added to git and would be lost: ${names}`, "commit them, move them out or delete them, then run it again");
    }
    const ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], folder);
    if (!ignored.ok) return abort(`git ls-files failed in ${folder}: ${firstLine(ignored.err)}`, `fix that worktree (git -C ${folder} status), then run it again`);
    say(`OK clean (no changed tracked files, nothing new to keep; ${ignored.out.split("\n").filter(Boolean).length} ignored item(s) will go with the worktree)`);

    const removed = git(["worktree", "remove", "--force", folder], root);
    if (!removed.ok) {
      const next = /locked/i.test(removed.err) ? `git -C ${root} worktree unlock ${folder}, then run it again` : `close what uses ${folder} (an editor, a test run), then run it again`;
      return abort(`git worktree remove failed: ${firstLine(removed.err)}`, next);
    }
    say(`OK removed worktree ${folder}`);
  } else if (folder) {
    const pruned = git(["worktree", "prune"], root);
    if (!pruned.ok) return abort(`git worktree prune failed: ${firstLine(pruned.err)}`, `git -C ${root} worktree prune, then run it again`);
    say(`OK pruned the record of the missing worktree ${folder}`);
  }

  // 3. The branch, here and on origin (each step runs whatever the one before did)
  const deleted = git(["branch", "-D", branch], root);
  if (deleted.ok) say(`OK deleted local branch ${branch}`);
  else fail(`could not delete local branch ${branch}: ${firstLine(deleted.err)}`, `git -C ${root} branch -D ${branch}`);

  if (keepRemote) say(`SKIP origin/${branch} kept (--keep-remote)`);
  else {
    const remote = remoteTip(root, branch);
    if (!remote.ok) fail(`could not ask origin about ${branch}: ${remote.err}`, `git -C ${root} push origin --delete ${branch} once origin answers`);
    else if (remote.sha === null) say(`OK origin/${branch} was already gone`);
    else {
      // Origin's own commit must be merged too: a push after the merge is work nobody has seen.
      let check;
      if (remote.sha === local.out) check = merged;
      else if (!git(["cat-file", "-e", `${remote.sha}^{commit}`], root).ok) check = { merged: false, why: `this clone does not have its last commit ${short(remote.sha)}` };
      else check = mergedCheck(root, branch, remote.sha);
      if (!check.merged) fail(`origin/${branch} was kept: it is not merged (${check.why})`, `look at it (git -C ${root} fetch origin ${branch}, then git log origin/main..FETCH_HEAD), and delete it by hand when it can go`);
      else {
        const pushed = git(["push", "origin", "--delete", branch, `--force-with-lease=refs/heads/${branch}:${remote.sha}`], root);
        if (pushed.ok) say(`OK deleted origin/${branch}`);
        else if (/remote ref does not exist/i.test(pushed.err)) say(`OK origin/${branch} was already gone`);
        else fail(`could not delete origin/${branch}: ${pushReason(pushed.err)}`, `git -C ${root} push origin --delete ${branch}`);
      }
    }
  }

  // 4. Fast-forward the main checkout, when that is safe
  const current = git(["symbolic-ref", "--short", "-q", "HEAD"], root).out;
  const dirty = changedTracked(root);
  if (!dirty.ok) fail(`git status failed in ${root}: ${dirty.err}`, `fix the main checkout (git -C ${root} status), then: git -C ${root} pull --ff-only origin main`);
  else if (current !== "main") say(`WARN: ${root} is on ${current || "no branch (detached HEAD)"}, not main → skipped the fast-forward; later: git -C ${root} switch main && git -C ${root} pull --ff-only origin main`);
  else if (dirty.files.length > 0) say(`WARN: ${root} has ${dirty.files.length} changed tracked file(s) → skipped the fast-forward; after committing or stashing them: git -C ${root} pull --ff-only origin main`);
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
