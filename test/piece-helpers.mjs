// Scratch worlds for new-piece.test.mjs and done-piece.test.mjs (not a test itself): a scratch HOME with its own git identity, a fake `gh` first on PATH,
// an empty GH_CONFIG_DIR, and repos made of a local bare "origin" plus a main checkout. Nothing here can reach GitHub or the real ~/.claude or ~/.gitconfig, and the tools run
// with JS3D_PORT_FIRST=18805, so they never look at (or hold) the real test ports 8805-8895.
// Speed: the first makeRepo() builds one template repo (real git, a handful of commands); every other repo is a file copy of it with the origin url rewritten (no git command at all).
// A "GitHub merge" is done on the bare origin with plumbing (git merge-tree --write-tree, 2.38 or newer, commit-tree, update-ref), not with a second clone.
// The tools run asynchronously (world.run), so a test file can run its tests side by side (describe with concurrency): the child processes overlap while the event loop is free.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// What the tools print around a path or name in a command they suggest.
export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const TEST_PORT_FIRST = 18805;
export const bases = (first = TEST_PORT_FIRST) => Array.from({ length: 10 }, (_, i) => first + i * 10); // the base ports new-piece picks from, given the first

// The fake gh: logs its arguments (one JSON line) to FAKE_GH_LOG, fails with FAKE_GH_FAIL, otherwise prints FAKE_GH_OUT (default: no pull requests).
const FAKE_GH = `
const { appendFileSync } = require("node:fs");
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.FAKE_GH_FAIL) { console.error(process.env.FAKE_GH_FAIL); process.exit(1); }
console.log(process.env.FAKE_GH_OUT ?? "[]");
`;

// A `git` that sits in front of the real one and misbehaves on request (all through environment variables, so the same file serves every test):
//   SHIM_TRACK=1          turns every --no-track into --track (the stand-in for a branch that tracks origin/main anyway)
//   SHIM_FAIL=<command>   makes that git command fail, e.g. "status" or "worktree remove" (with SHIM_CWD=<folder>: only when run in that folder)
//   SHIM_ADD_LEAVES_BRANCH=1   makes `worktree add -b <branch> <folder> <base>` create the branch and then fail (a checkout that goes wrong after the branch was made)
//   SHIM_ADVANCE=<origin.git>|<branch>   adds a commit to that branch of origin just before a push (somebody else pushed first)
const gitShim = (realGit) => `
const { spawnSync } = require("node:child_process");
const e = process.env;
let args = process.argv.slice(2);
if (e.SHIM_TRACK) args = args.map((a) => (a === "--no-track" ? "--track" : a));
if (e.SHIM_FAIL && args.slice(0, e.SHIM_FAIL.split(" ").length).join(" ") === e.SHIM_FAIL && (!e.SHIM_CWD || process.cwd() === e.SHIM_CWD)) { console.error("fatal: simulated failure of git " + e.SHIM_FAIL); process.exit(128); }
if (e.SHIM_ADD_LEAVES_BRANCH && args[0] === "worktree" && args[1] === "add" && args.includes("-b")) {
  spawnSync(${JSON.stringify(realGit)}, ["branch", args[args.indexOf("-b") + 1], args[args.length - 1]], { stdio: "inherit" });
  console.error("fatal: simulated checkout failure after the branch was made"); process.exit(128);
}
if (e.SHIM_ADVANCE && args[0] === "push") {
  const [origin, branch] = e.SHIM_ADVANCE.split("|");
  const g = (...a) => spawnSync(${JSON.stringify(realGit)}, a, { cwd: origin, encoding: "utf8" }).stdout.trim();
  g("update-ref", "refs/heads/" + branch, g("commit-tree", "refs/heads/" + branch + "^{tree}", "-p", "refs/heads/" + branch, "-m", "pushed by someone else"));
}
const r = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
`;

// On a Mac, /usr/bin/git is a stub that finds the real git first, which makes every git command about three times slower (33 ms against 10 ms here); the tests start thousands.
// The real one sits at <git --exec-path>/../../bin/git (the same file as /usr/bin/git on Linux), so its folder goes first on the tests' PATH.
const directGit = (() => {
  const exec = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout?.trim();
  const candidate = exec ? join(exec, "..", "..", "bin", "git") : "";
  return candidate && existsSync(candidate) ? candidate : null;
})();
const findGit = () => {
  if (directGit) return directGit;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) if (dir && existsSync(join(dir, "git"))) return join(dir, "git");
  throw new Error("git not found on PATH");
};

function script(file, body) {
  writeFileSync(file, `#!${process.execPath}\n${body}`);
  chmodSync(file, 0o755);
}

// A world: { scratch, env, g, gTry, run, runIn, makeRepo, shimEnv, cleanup }.
export function makeWorld(label) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), `${label}-`)));
  const home = join(scratch, "home");
  const bin = join(scratch, "bin");
  const shimBin = join(scratch, "bin-shim");
  const ghConfig = join(scratch, "gh-config");
  for (const d of [home, bin, shimBin, ghConfig]) mkdirSync(d);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Piece Test\n\temail = piece@test.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[advice]\n\tdetachedHead = false\n[pull]\n\trebase = false\n");
  script(join(bin, "gh"), FAKE_GH);
  script(join(shimBin, "git"), gitShim(findGit()));

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(?:GIT_|GH_|GITHUB_|FAKE_GH|SHIM_|JS3D_)/.test(k)) env[k] = v;
  Object.assign(env, {
    PATH: [bin, directGit && dirname(directGit), process.env.PATH].filter(Boolean).join(delimiter),
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
    GH_CONFIG_DIR: ghConfig, GIT_CONFIG_NOSYSTEM: "1", JS3D_PORT_FIRST: String(TEST_PORT_FIRST),
  });

  // Test-side git: throws when git fails, returns the trimmed output.
  function g(cwd, ...args) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${r.stderr}`);
    return r.stdout.trim();
  }
  // Same, but reports the exit code instead of throwing.
  function gTry(cwd, ...args) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  }

  // Runs one of the tools without blocking the test file; extra.env overrides the world's environment.
  function run(tool, args, { env: extra = {}, cwd } = {}) {
    return new Promise((done) => {
      const child = spawn(process.execPath, [tool, ...args], { cwd, env: { ...env, ...extra } });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => done({ lines: out.trimEnd().split("\n"), stderr: err, code }));
    });
  }
  // The same, on a repo: --root, and a gh log of its own (so tests that run side by side do not see each other's calls).
  const runIn = (repo, tool, args, options = {}) => run(tool, ["--root", repo.root, ...args], { ...options, env: { FAKE_GH_LOG: repo.ghLog, ...options.env } });

  // The environment for a run with the git shim in front: shimEnv({ SHIM_FAIL: "status" }).
  const shimEnv = (extra) => ({ PATH: `${shimBin}${delimiter}${env.PATH}`, ...extra });

  // The template repo: dir/origin.git (bare) and dir/jumpstart-3d (the main checkout on main, tracking origin/main, one commit with README.md and a .gitignore that lists node_modules/
  // like Max's does, which does not match a symlink). node_modules is a folder with a marker file; the checkout's info/exclude lists it, as on Max's Mac.
  let template = null;
  function buildTemplate() {
    const dir = join(scratch, "template");
    mkdirSync(dir);
    const origin = join(dir, "origin.git");
    const root = join(dir, "jumpstart-3d");
    g(dir, "init", "--bare", "-q", "-b", "main", origin);
    g(dir, "clone", "-q", origin, root);
    writeFileSync(join(root, "README.md"), "# scratch\n");
    writeFileSync(join(root, ".gitignore"), "test-results/\n*.log\nnode_modules/\n");
    g(root, "add", ".");
    g(root, "commit", "-q", "-m", "first");
    g(root, "push", "-q", "-u", "origin", "main");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "marker.txt"), "keep me\n");
    writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n");
    return dir;
  }

  let counter = 0;
  // A repo: a copy of the template. modules: false leaves the checkout without node_modules; exclude: the checkout's info/exclude (default: node_modules, as on Max's Mac).
  function makeRepo({ modules = true, exclude = "node_modules\n" } = {}) {
    template ??= buildTemplate();
    const dir = join(scratch, `repo${++counter}`);
    cpSync(template, dir, { recursive: true });
    const origin = join(dir, "origin.git");
    const root = join(dir, "jumpstart-3d");
    const config = join(root, ".git", "config");
    writeFileSync(config, readFileSync(config, "utf8").split(join(template, "origin.git")).join(origin)); // the clone's origin url
    writeFileSync(join(root, ".git", "info", "exclude"), exclude);
    if (!modules) rmSync(join(root, "node_modules"), { recursive: true });
    let commits = 0;
    const repo = {
      dir, origin, root, ghLog: join(dir, "gh.log"),
      sibling: (name) => join(dir, `jumpstart-3d-${name}`),
      // A piece the way new-piece makes it, but by hand: worktree from origin/main, node_modules link, a commit (with file: true it adds a file), pushed. claim writes a .js3d-port and ignores it.
      addPiece(branch, { commit = true, push = true, link = modules, file = false, claim = null } = {}) {
        const safe = branch.replace(/\//g, "-");
        const folder = join(dir, `jumpstart-3d-${safe}`);
        g(root, "worktree", "add", "--no-track", "-q", "-b", branch, folder, "origin/main");
        if (link) symlinkSync(join(root, "node_modules"), join(folder, "node_modules"));
        if (claim) {
          writeFileSync(join(folder, ".js3d-port"), `${claim}\n`);
          writeFileSync(join(root, ".git", "info", "exclude"), `${exclude}.js3d-port\n`);
        }
        if (commit) {
          if (file) { writeFileSync(join(folder, `${safe}.txt`), "work\n"); g(folder, "add", `${safe}.txt`); }
          g(folder, "commit", "-q", "--allow-empty", "-m", `work on ${branch}`);
        }
        if (push) g(folder, "push", "-q", "origin", branch);
        return folder;
      },
      // What GitHub does when a pull request is merged: on the bare origin, merge or squash the pushed branch into main. Needs git 2.38 (merge-tree --write-tree).
      githubMerge(branch, how = "merge") {
        const tree = g(origin, "merge-tree", "--write-tree", "refs/heads/main", `refs/heads/${branch}`).split("\n")[0];
        const parents = how === "squash" ? ["-p", "refs/heads/main"] : ["-p", "refs/heads/main", "-p", `refs/heads/${branch}`];
        const sha = g(origin, "commit-tree", tree, ...parents, "-m", `${how === "squash" ? "Squash" : "Merge"} ${branch}`);
        g(origin, "update-ref", "refs/heads/main", sha);
        return sha;
      },
      // Somebody else pushes a commit to origin's main (this checkout has not fetched it yet), or to a branch of origin.
      advanceOrigin(branch = "main") {
        const ref = `refs/heads/${branch}`;
        const sha = g(origin, "commit-tree", `${ref}^{tree}`, "-p", ref, "-m", `elsewhere ${++commits}`);
        g(origin, "update-ref", ref, sha);
        return sha;
      },
      remoteBranches: () => g(root, "ls-remote", "--heads", origin).split("\n").filter(Boolean).map((l) => l.split("\t")[1].replace("refs/heads/", "")),
      localBranches: () => g(root, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean),
      ghCalls: () => (existsSync(repo.ghLog) ? readFileSync(repo.ghLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    };
    return repo;
  }

  return { scratch, env, g, gTry, run, runIn, makeRepo, shimEnv, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

// Listens on 127.0.0.1:port; the server, or null when the port is taken.
function listen(port) {
  const server = net.createServer();
  return new Promise((done) => { server.once("error", () => done(null)); server.listen(port, "127.0.0.1", () => done(server)); });
}
const close = (server) => new Promise((done) => server.close(done));

// Listens on each port that is free (ports already taken by something else are skipped) and returns { held: [ports], close() }.
export async function hold(...ports) {
  const servers = [];
  const held = [];
  for (const port of ports) { const s = await listen(port); if (s) { servers.push(s); held.push(port); } }
  return { held, close: () => Promise.all(servers.map(close)) };
}
