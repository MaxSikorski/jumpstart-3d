// Starts one piece of work the same way every time: a worktree on a new branch cut from a fresh origin/main, with no upstream, the main checkout's node_modules linked in,
// and a free test port written down. The pair of done-piece.mjs, which cleans up after the merge.
// Steps (one line each, stopping at the first FAIL): the root is a git repo on main with no changed tracked files (untracked files are fine); git fetch origin; the branch and the
// folder do not exist yet, here or on origin (an old piece nobody cleaned up); a test port is chosen (when none is free nothing is made); git worktree add --no-track -b <branch>
// <folder> origin/main; the new branch has NO upstream (a branch that tracks origin/main once made a Desktop push land on main); node_modules is linked from the root (skipped when
// the root has none); the port is written to <folder>/.js3d-port, and that name and node_modules are added to the repo's info/exclude (git shares it with every worktree), so
// neither shows up in git status (.gitignore's `node_modules/` does not match a symlink).
// A FAIL always means nothing was made: after `git worktree add` any FAIL removes the worktree (--force) and deletes the branch again, and says so.
// The folder is a sibling of the root: <root-folder-name>-<name>, e.g. ../jumpstart-3d-<name>. The branch is <name> unless --branch says otherwise.
// The port is JS3D_PORT for the Playwright run, chosen by freePort in ports.mjs (the shared test-port convention: 8805, 8815 ... 8895, with p, p+1 and p+2 all unanswered on
// 127.0.0.1 and not claimed in the .js3d-port of any worktree of this repo, the root included). The claim file holds the port as a number on its first line. Choosing the port
// and writing the claim happen under a lock (the folder <git-common-dir>/js3d-port.lock, tried 50 times, 100 ms apart; a lock older than a minute is taken over), so two runs at
// the same time get two ports.
// Last line: `new-piece: OK <folder> (branch <branch>, JS3D_PORT=<port>)`, or `new-piece: <n> problem(s)` after a FAIL (exit 1). A bad command line exits 2.
// Run it from the main checkout: `node tools/agent/new-piece.mjs <name>`; --root points at a different checkout. Argument-list spawns only (no shell); git speaks English and never asks.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PORT_FILE, PORT_FIRST, PORT_LAST, PORT_SPAN, PORT_STEP, freePort } from "./ports.mjs";

const USAGE = "usage: node tools/agent/new-piece.mjs <name> [--branch <branch>] [--root <repo>]  (worktree ../<repo-folder>-<name> on a new branch, default <name>, cut from origin/main, no upstream)";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOCK_TRIES = 50;
const LOCK_WAIT_MS = 100;
const LOCK_STALE_MS = 60_000;

// Runs git with an argument list. Never throws; { ok, status, out, err } with trimmed text.
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? "").trim(), err: ((r.stderr ?? "").trim() || r.error?.message || "").trim() };
}
const firstLine = (s) => s.split("\n").find((l) => l.trim())?.replace(/^(?:fatal|error): /, "").trim() ?? "";
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// The paths of every worktree of the repo, the main checkout first.
function worktreePaths(root) {
  const r = git(["worktree", "list", "--porcelain"], root);
  return r.ok ? r.out.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)) : [root];
}

// Adds each name to the repo's info/exclude (once each). `git rev-parse --git-path` answers for the worktree it is run in; for info/exclude that is the shared file.
function excludeNames(folder, names) {
  const r = git(["rev-parse", "--git-path", "info/exclude"], folder);
  if (!r.ok) return `git could not find info/exclude (${firstLine(r.err)})`;
  const file = resolve(folder, r.out);
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { /* a new file */ }
  const have = new Set(text.split("\n").map((l) => l.trim().replace(/^\//, "")));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === 0) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  } catch (e) { return e.message; }
  return null;
}

// Takes the port lock (a folder, because mkdir either makes it or fails): { release } or { error, lock }. A lock older than LOCK_STALE_MS is a crashed run's and is taken over.
async function takePortLock(root) {
  const common = git(["rev-parse", "--git-common-dir"], root);
  if (!common.ok) return { error: `git could not find its common folder: ${firstLine(common.err)}` };
  const lock = join(resolve(root, common.out), "js3d-port.lock");
  for (let i = 0; i < LOCK_TRIES; i++) {
    try {
      mkdirSync(lock);
      return { release: () => rmSync(lock, { recursive: true, force: true }) };
    } catch (e) {
      if (e.code !== "EEXIST") return { error: `could not make ${lock}: ${e.message}` };
    }
    try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; } // gone meanwhile: try at once
    await sleep(LOCK_WAIT_MS);
  }
  return { error: `${lock} is held by another run`, lock };
}

// Sets up the worktree. say() gets each printed line. Returns the number of problems (1 after a FAIL, 2 when the roll-back failed too).
export async function newPiece({ name, branch = name, root, say = console.log }) {
  let problems = 0;
  const stop = (what, next) => { say(`FAIL: ${what} → ${next}`); say(`new-piece: ${++problems} problem(s)`); return problems; };

  if (!NAME.test(name) || name.includes("..")) return stop(`name "${name}" cannot be a folder name`, "use letters, digits, - . _ and start with a letter or digit (no slash, no spaces)");
  if (branch.startsWith("-") || !git(["check-ref-format", `refs/heads/${branch}`], process.cwd()).ok) return stop(`"${branch}" is not a branch name git accepts`, "pick another with --branch");

  // 1. A git repo, on main, without changed tracked files
  if (!existsSync(root)) return stop(`${root} does not exist`, "pass --root <the main checkout>");
  root = real(root);
  const toplevel = git(["rev-parse", "--show-toplevel"], root);
  if (!toplevel.ok) return stop(`${root} is not a git repo`, "run it from the main checkout or pass --root <repo>");
  const top = real(toplevel.out);
  if (top !== root) return stop(`${root} is inside a repo but is not its top folder`, `pass --root ${top}`);
  say(`OK repo ${root}`);

  const onBranch = git(["symbolic-ref", "--short", "-q", "HEAD"], root);
  if (onBranch.out !== "main") {
    const mainCheckout = worktreePaths(root)[0];
    const next = mainCheckout && real(mainCheckout) !== root ? `run it from the main checkout, or pass --root ${mainCheckout}` : `git -C ${root} switch main`;
    return stop(`${root} is on ${onBranch.out || "no branch (detached HEAD)"}, not main`, next);
  }
  say("OK branch main");

  const status = git(["status", "--porcelain", "--untracked-files=no"], root);
  if (!status.ok) return stop(`git status failed in ${root}: ${firstLine(status.err)}`, `fix the repo (git -C ${root} status), then run it again`);
  const changed = status.out.split("\n").filter(Boolean);
  if (changed.length > 0) return stop(`${changed.length} tracked file(s) changed in ${root}`, "commit or stash them, then run it again (untracked files are fine)");
  say("OK clean (no changed tracked files)");

  // 2. Fresh origin/main
  const fetched = git(["fetch", "origin"], root);
  if (!fetched.ok) return stop(`git fetch origin failed: ${firstLine(fetched.err)}`, "check the network and the origin remote, then run it again");
  const base = git(["rev-parse", "--verify", "--quiet", "--short", "refs/remotes/origin/main"], root);
  if (!base.ok) return stop("origin/main does not exist after the fetch", `check the origin remote: git -C ${root} remote -v`);
  say(`OK fetch origin (origin/main at ${base.out})`);

  // 3. The branch and the folder are new, here and on origin
  const folder = join(dirname(root), `${basename(root)}-${name}`);
  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).ok) return stop(`branch ${branch} already exists`, `finish it with node tools/agent/done-piece.mjs ${branch}, or pick another name or --branch`);
  const remote = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], root);
  if (!remote.ok) return stop(`git ls-remote origin failed: ${firstLine(remote.err)}`, "check the network and the origin remote, then run it again");
  if (remote.out.split("\n").some((l) => l.split("\t")[1] === `refs/heads/${branch}`)) return stop(`origin already has a branch ${branch} (an old piece nobody cleaned up?)`, `finish it with node tools/agent/done-piece.mjs ${branch}, or pick another name or --branch`);
  let folderExists = true;
  try { lstatSync(folder); } catch { folderExists = false; }
  if (folderExists) return stop(`${folder} already exists`, "remove it or pick another name");
  say(`OK names free (branch ${branch}, folder ${folder})`);

  // 4.-8. Under the port lock: a port, the worktree, the link, the claim. A FAIL once the worktree exists takes it away again.
  const lock = await takePortLock(root);
  if (lock.error) return stop(lock.error, lock.lock ? `if no other new-piece is running, remove ${lock.lock} and run it again` : "check the folder's permissions, then run it again");
  const undo = (what, next) => {
    say(`FAIL: ${what} → ${next}`);
    problems++;
    const removed = git(["worktree", "remove", "--force", folder], root);
    const deleted = git(["branch", "-D", branch], root);
    if (removed.ok && deleted.ok) say("OK rolled back (worktree and branch removed, nothing was made)");
    else {
      problems++;
      say(`FAIL: roll-back failed (${firstLine(removed.err || deleted.err)}) → git -C ${root} worktree remove --force ${folder}; git -C ${root} branch -D ${branch}`);
    }
    say(`new-piece: ${problems} problem(s)`);
    return problems;
  };
  try {
    const port = await freePort({ root });
    if (port === null) return stop(`no free test port: each block of ${PORT_SPAN} ports from ${PORT_FIRST}, ${PORT_FIRST + PORT_STEP} ... ${PORT_LAST} has a port in use or claimed`, "finish an old piece with node tools/agent/done-piece.mjs <branch> or stop a test server, then run it again");
    say(`OK port ${port} (${port}-${port + PORT_SPAN - 1} are not in use and no worktree claims them)`);

    // The worktree, cut from origin/main without tracking it
    const added = git(["worktree", "add", "--no-track", "-b", branch, folder, "origin/main"], root);
    if (!added.ok) return stop(`git worktree add failed: ${firstLine(added.err)}`, "fix that, then run it again");
    say(`OK worktree ${folder} (new branch ${branch} from origin/main ${base.out})`);

    // No upstream: a branch that tracks origin/main lets a Desktop push land on main
    const trackedRemote = git(["config", "--get", `branch.${branch}.remote`], root);
    const trackedMerge = git(["config", "--get", `branch.${branch}.merge`], root);
    if (trackedRemote.out || trackedMerge.out) return undo(`branch ${branch} tracks ${trackedRemote.out}/${trackedMerge.out.replace(/^refs\/heads\//, "")}, so a push from Desktop would land on it`, "check git config branch.autoSetupMerge, then run it again");
    say(`OK no upstream for ${branch}`);

    // node_modules from the main checkout
    const modules = join(root, "node_modules");
    if (existsSync(modules)) {
      try { symlinkSync(modules, join(folder, "node_modules")); } catch (e) { return undo(`could not link node_modules: ${e.message}`, `look at ${join(folder, "node_modules")}, then run it again`); }
      say(`OK node_modules linked to ${modules}`);
    } else say(`SKIP node_modules (none in ${root})`);

    // The claim, hidden from git (the link too: .gitignore's `node_modules/` does not match a symlink)
    try { writeFileSync(join(folder, PORT_FILE), `${port}\n`); } catch (e) { return undo(`could not write ${PORT_FILE}: ${e.message}`, `look at ${join(folder, PORT_FILE)}, then run it again`); }
    const excludeProblem = excludeNames(folder, [PORT_FILE, "node_modules"]);
    if (excludeProblem) return undo(`could not hide ${PORT_FILE} from git: ${excludeProblem}`, "check the repo's info/exclude, then run it again");
    say(`OK wrote ${join(folder, PORT_FILE)} (ignored by git)`);

    say(`new-piece: OK ${folder} (branch ${branch}, JS3D_PORT=${port})`);
    return 0;
  } finally {
    lock.release();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) { // realpath: a script reached through a symlinked folder must still run
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { branch: { type: "string" }, root: { type: "string" }, help: { type: "boolean" } } });
  } catch (e) {
    console.error(`new-piece: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (positionals.length !== 1) { console.error(`new-piece: needs exactly one <name>\n${USAGE}`); process.exit(2); }
  const problems = await newPiece({
    name: positionals[0],
    branch: values.branch ?? positionals[0],
    root: values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  });
  process.exitCode = problems === 0 ? 0 : 1;
}
