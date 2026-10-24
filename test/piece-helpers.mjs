// Scratch worlds for new-piece.test.mjs and done-piece.test.mjs (not a test itself): a scratch HOME with its own git identity, a fake `gh` first on PATH,
// an empty GH_CONFIG_DIR, and repos made of a local bare "origin" plus a main checkout. Nothing here can reach GitHub or the real ~/.claude or ~/.gitconfig.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// The fake gh: logs its arguments (one JSON line) to FAKE_GH_LOG, fails with FAKE_GH_FAIL, otherwise prints FAKE_GH_OUT (default: no pull requests).
const FAKE_GH = `
const { appendFileSync } = require("node:fs");
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.FAKE_GH_FAIL) { console.error(process.env.FAKE_GH_FAIL); process.exit(1); }
console.log(process.env.FAKE_GH_OUT ?? "[]");
`;

const realGit = () => {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) if (dir && existsSync(join(dir, "git"))) return join(dir, "git");
  throw new Error("git not found on PATH");
};

function script(file, body) {
  writeFileSync(file, `#!${process.execPath}\n${body}`);
  chmodSync(file, 0o755);
}

// A world: { scratch, env, bin, run(tool, args, options), g(cwd, ...args), makeRepo(), cleanup() }.
export function makeWorld(label) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), `${label}-`)));
  const home = join(scratch, "home");
  const bin = join(scratch, "bin");
  const ghConfig = join(scratch, "gh-config");
  for (const d of [home, bin, ghConfig]) mkdirSync(d);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Piece Test\n\temail = piece@test.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[advice]\n\tdetachedHead = false\n[pull]\n\trebase = false\n");
  script(join(bin, "gh"), FAKE_GH);

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(?:GIT_|GH_|GITHUB_|FAKE_GH)/.test(k)) env[k] = v;
  Object.assign(env, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
    GH_CONFIG_DIR: ghConfig, GIT_CONFIG_NOSYSTEM: "1", FAKE_GH_LOG: join(scratch, "gh.log"),
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

  // Runs one of the tools; extra.env overrides the world's environment.
  function run(tool, args, { env: extra = {}, cwd } = {}) {
    const r = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8", cwd, env: { ...env, ...extra } });
    return { lines: r.stdout.trimEnd().split("\n"), stderr: r.stderr, code: r.status };
  }

  // A shim `git` first on PATH that turns every --no-track into --track: the stand-in for a branch that tracks origin/main.
  function trackingGitPath() {
    const shimBin = join(scratch, "bin-tracking");
    mkdirSync(shimBin, { recursive: true });
    script(join(shimBin, "git"), `
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2).map((a) => (a === "--no-track" ? "--track" : a));
const r = spawnSync(${JSON.stringify(realGit())}, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
`);
    return `${shimBin}${delimiter}${env.PATH}`;
  }

  let counter = 0;
  // A repo: dir/origin.git (bare), dir/jumpstart-3d (the main checkout, on main, tracking origin/main, with a node_modules folder that git ignores like Max's does).
  function makeRepo({ modules = true } = {}) {
    const dir = join(scratch, `repo${++counter}`);
    mkdirSync(dir);
    const origin = join(dir, "origin.git");
    const root = join(dir, "jumpstart-3d");
    g(dir, "init", "--bare", "-q", "-b", "main", origin);
    g(dir, "clone", "-q", origin, root);
    writeFileSync(join(root, "README.md"), "# scratch\n");
    g(root, "add", ".");
    g(root, "commit", "-q", "-m", "first");
    g(root, "push", "-q", "-u", "origin", "main");
    if (modules) {
      mkdirSync(join(root, "node_modules"));
      writeFileSync(join(root, "node_modules", "marker.txt"), "keep me\n");
      writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n");
    }
    const repo = {
      dir, origin, root,
      sibling: (name) => join(dir, `jumpstart-3d-${name}`),
      // A piece the way new-piece makes it, but by hand: worktree from origin/main, node_modules link, a commit, pushed.
      addPiece(branch, { commit = true, push = true, link = modules } = {}) {
        const folder = join(dir, `jumpstart-3d-${branch.replace(/\//g, "-")}`);
        g(root, "worktree", "add", "--no-track", "-q", "-b", branch, folder, "origin/main");
        if (link) symlinkSync(join(root, "node_modules"), join(folder, "node_modules"));
        if (commit) {
          writeFileSync(join(folder, `${branch.replace(/\//g, "-")}.txt`), "work\n");
          g(folder, "add", ".");
          g(folder, "commit", "-q", "-m", `work on ${branch}`);
        }
        if (push) g(folder, "push", "-q", "origin", branch);
        return folder;
      },
      // What GitHub does when a pull request is merged: in a separate clone, merge or squash the pushed branch into main and push main.
      githubMerge(branch, how = "merge") {
        const gh = join(dir, "github");
        if (!existsSync(gh)) g(dir, "clone", "-q", origin, gh);
        g(gh, "fetch", "-q", "origin");
        g(gh, "checkout", "-q", "-B", "main", "origin/main");
        if (how === "squash") { g(gh, "merge", "--squash", `origin/${branch}`); g(gh, "commit", "-q", "-m", `Squash ${branch}`); }
        else g(gh, "merge", "--no-ff", "-q", "-m", `Merge ${branch}`, `origin/${branch}`);
        g(gh, "push", "-q", "origin", "main");
        return g(gh, "rev-parse", "HEAD");
      },
      // Somebody else pushes a commit to origin/main (this checkout has not fetched it yet).
      advanceOrigin() {
        const gh = join(dir, "github");
        if (!existsSync(gh)) g(dir, "clone", "-q", origin, gh);
        g(gh, "pull", "-q", "origin", "main");
        writeFileSync(join(gh, `elsewhere-${Date.now()}.txt`), "pushed by someone else\n");
        g(gh, "add", ".");
        g(gh, "commit", "-q", "-m", "elsewhere");
        g(gh, "push", "-q", "origin", "main");
        return g(gh, "rev-parse", "HEAD");
      },
      remoteBranches: () => g(root, "ls-remote", "--heads", origin).split("\n").filter(Boolean).map((l) => l.split("\t")[1].replace("refs/heads/", "")),
      localBranches: () => g(root, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean),
    };
    return repo;
  }

  return { scratch, env, g, gTry, run, makeRepo, trackingGitPath, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

// Test ports, the way new-piece.mjs picks them: bases 8805, 8815 ... 8895, each with p, p+1 and p+2.
export const BASES = Array.from({ length: 10 }, (_, i) => 8805 + i * 10);

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
