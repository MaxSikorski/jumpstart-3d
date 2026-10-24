// Starts one piece of work the same way every time: a worktree on a new branch cut from a fresh origin/main, with no upstream, the main checkout's node_modules linked in,
// and a free test port written down. The pair of done-piece.mjs, which cleans up after the merge.
// Steps (one line each, stopping at the first FAIL): the root is a git repo on main with no changed tracked files (untracked files are fine); git fetch origin; the branch and the
// folder do not exist yet; a test port is chosen (when none is free nothing is made); git worktree add --no-track -b <branch> <folder> origin/main; the new branch has NO upstream
// (a branch that tracks origin/main once made a Desktop push land on main); node_modules is linked from the root (skipped when the root has none); the port is written to
// <folder>/.js3d-port and that file name is added to the repo's info/exclude (git shares it with every worktree), so it never shows up in git status.
// The folder is a sibling of the root: <root-folder-name>-<name>, e.g. ../jumpstart-3d-<name>. The branch is <name> unless --branch says otherwise.
// The port is JS3D_PORT for the Playwright run, chosen by freePort in ports.mjs (the shared test-port convention: 8805, 8815 ... 8895, with p, p+1 and p+2 all unanswered on
// 127.0.0.1 and not claimed in the .js3d-port of any worktree of this repo, the root included). The claim file holds the port as a number on its first line.
// Last line: `new-piece: OK <folder> (branch <branch>, JS3D_PORT=<port>)`, or `new-piece: 1 problem(s)` after a FAIL (exit 1). A bad command line exits 2.
// Run it from the main checkout: `node tools/agent/new-piece.mjs <name>`; --root points at a different checkout. Argument-list spawns only (no shell); git speaks English and never asks.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PORT_FILE, PORT_FIRST, PORT_LAST, PORT_SPAN, PORT_STEP, freePort } from "./ports.mjs";

const USAGE = "usage: node tools/agent/new-piece.mjs <name> [--branch <branch>] [--root <repo>]  (worktree ../<repo-folder>-<name> on a new branch, default <name>, cut from origin/main, no upstream)";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Runs git with an argument list. Never throws; { ok, out, err } with trimmed text.
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: ((r.stderr ?? "").trim() || r.error?.message || "").trim() };
}
const firstLine = (s) => s.split("\n").find((l) => l.trim())?.replace(/^(?:fatal|error): /, "").trim() ?? "";

// The paths of every worktree of the repo, the main checkout first.
function worktreePaths(root) {
  const r = git(["worktree", "list", "--porcelain"], root);
  return r.ok ? r.out.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)) : [root];
}

// Adds .js3d-port to the repo's info/exclude (once). `git rev-parse --git-path` answers for the worktree it is run in; for info/exclude that is the shared file.
function excludePortFile(folder) {
  const r = git(["rev-parse", "--git-path", "info/exclude"], folder);
  if (!r.ok) return `git could not find info/exclude (${firstLine(r.err)})`;
  const file = resolve(folder, r.out);
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { /* a new file */ }
  if (text.split("\n").some((l) => l.trim() === PORT_FILE || l.trim() === `/${PORT_FILE}`)) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}${PORT_FILE}\n`);
  } catch (e) { return e.message; }
  return null;
}

// Sets up the worktree. say() gets each printed line. Returns the number of problems (0 or 1).
export async function newPiece({ name, branch = name, root, say = console.log }) {
  const stop = (what, next) => { say(`FAIL: ${what} → ${next}`); say("new-piece: 1 problem(s)"); return 1; };

  if (!NAME.test(name) || name.includes("..")) return stop(`name "${name}" cannot be a folder name`, "use letters, digits, - . _ and start with a letter or digit (no slash, no spaces)");
  if (branch.startsWith("-") || !git(["check-ref-format", `refs/heads/${branch}`], process.cwd()).ok) return stop(`"${branch}" is not a branch name git accepts`, "pick another with --branch");

  // 1. A git repo, on main, without changed tracked files
  let top;
  try { root = realpathSync(resolve(root)); } catch { return stop(`${root} does not exist`, "pass --root <the main checkout>"); }
  const toplevel = git(["rev-parse", "--show-toplevel"], root);
  if (!toplevel.ok) return stop(`${root} is not a git repo`, "run it from the main checkout or pass --root <repo>");
  try { top = realpathSync(toplevel.out); } catch { top = toplevel.out; }
  if (top !== root) return stop(`${root} is inside a repo but is not its top folder`, `pass --root ${top}`);
  say(`OK repo ${root}`);

  const onBranch = git(["symbolic-ref", "--short", "-q", "HEAD"], root);
  if (onBranch.out !== "main") {
    const mainCheckout = worktreePaths(root)[0];
    const next = mainCheckout && realpathSync(mainCheckout) !== root ? `run it from the main checkout, or pass --root ${mainCheckout}` : `git -C ${root} switch main`;
    return stop(`${root} is on ${onBranch.out || "no branch (detached HEAD)"}, not main`, next);
  }
  say("OK branch main");

  const changed = git(["status", "--porcelain", "--untracked-files=no"], root).out.split("\n").filter(Boolean);
  if (changed.length > 0) return stop(`${changed.length} tracked file(s) changed in ${root}`, "commit or stash them, then run it again (untracked files are fine)");
  say("OK clean (no changed tracked files)");

  // 2. Fresh origin/main
  const fetched = git(["fetch", "origin"], root);
  if (!fetched.ok) return stop(`git fetch origin failed: ${firstLine(fetched.err)}`, "check the network and the origin remote, then run it again");
  const base = git(["rev-parse", "--verify", "--quiet", "--short", "refs/remotes/origin/main"], root);
  if (!base.ok) return stop("origin/main does not exist after the fetch", `check the origin remote: git -C ${root} remote -v`);
  say(`OK fetch origin (origin/main at ${base.out})`);

  // 3. The branch and the folder are new
  const folder = join(dirname(root), `${basename(root)}-${name}`);
  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root).ok) return stop(`branch ${branch} already exists`, `finish it with node tools/agent/done-piece.mjs ${branch}, or pick another name or --branch`);
  let folderExists = true;
  try { lstatSync(folder); } catch { folderExists = false; }
  if (folderExists) return stop(`${folder} already exists`, "remove it or pick another name");
  say(`OK names free (branch ${branch}, folder ${folder})`);

  // 4. A free test port, chosen now so that a full house leaves nothing half made
  const port = await freePort({ root });
  if (port === null) return stop(`no free test port: each block of ${PORT_SPAN} ports from ${PORT_FIRST}, ${PORT_FIRST + PORT_STEP} ... ${PORT_LAST} has a port in use or claimed`, "finish an old piece with node tools/agent/done-piece.mjs <branch> or stop a test server, then run it again");
  say(`OK port ${port} (${port}-${port + PORT_SPAN - 1} are not in use and no worktree claims them)`);

  // 5. The worktree, cut from origin/main without tracking it
  const added = git(["worktree", "add", "--no-track", "-b", branch, folder, "origin/main"], root);
  if (!added.ok) return stop(`git worktree add failed: ${firstLine(added.err)}`, "fix that, then run it again");
  say(`OK worktree ${folder} (new branch ${branch} from origin/main ${base.out})`);

  // 6. No upstream: a branch that tracks origin/main lets a Desktop push land on main
  const upstream = git(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], root);
  if (upstream.ok) return stop(`branch ${branch} tracks ${upstream.out}, so a push from Desktop would land on it`, `git -C ${folder} branch --unset-upstream`);
  say(`OK no upstream for ${branch}`);

  // 7. node_modules from the main checkout
  const modules = join(root, "node_modules");
  if (existsSync(modules)) {
    try { symlinkSync(modules, join(folder, "node_modules")); } catch (e) { return stop(`could not link node_modules: ${e.message}`, `ln -s ${modules} ${join(folder, "node_modules")}`); }
    say(`OK node_modules linked to ${modules}`);
  } else say(`SKIP node_modules (none in ${root})`);

  // 8. The port, written down and hidden from git
  try { writeFileSync(join(folder, PORT_FILE), `${port}\n`); } catch (e) { return stop(`could not write ${PORT_FILE}: ${e.message}`, `write ${port} into ${join(folder, PORT_FILE)} by hand`); }
  const excludeProblem = excludePortFile(folder);
  if (excludeProblem) return stop(`could not hide ${PORT_FILE} from git: ${excludeProblem}`, `add ${PORT_FILE} to the repo's info/exclude by hand`);
  say(`OK wrote ${join(folder, PORT_FILE)} (ignored by git)`);

  say(`new-piece: OK ${folder} (branch ${branch}, JS3D_PORT=${port})`);
  return 0;
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
