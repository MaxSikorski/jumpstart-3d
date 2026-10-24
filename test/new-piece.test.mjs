// The piece starter (tools/agent/new-piece.mjs): a worktree on a new --no-track branch from a fresh origin/main, a verified empty upstream, the node_modules link, a free test port,
// and the promise that a FAIL means nothing was made. Every test runs on scratch repos (copies of one template: a local bare "origin" and a main checkout) with HOME, GH_CONFIG_DIR and
// PATH pointed at scratch folders (see piece-helpers.mjs), so nothing reaches GitHub, the real ~/.gitconfig or this repo. The tools run with JS3D_PORT_FIRST=18805, so the real
// test ports 8805-8895 are never touched; the choice of the port itself is tested in ports.test.mjs. The tests run side by side (the tools are async children).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_PORT_FIRST, bases, hold, makeWorld, q } from "./piece-helpers.mjs";

process.env.JS3D_PORT_FIRST = String(TEST_PORT_FIRST); // before ports.mjs is loaded: the range this file looks at is 18805-18895
const { claimedPorts, freePort } = await import("../tools/agent/ports.mjs");

const TOOL = fileURLToPath(new URL("../tools/agent/new-piece.mjs", import.meta.url));
const PORTS = fileURLToPath(new URL("../tools/agent/ports.mjs", import.meta.url));
const world = makeWorld("new-piece");
after(() => world.cleanup());
const { g, gTry } = world;
const start = (repo, args, options) => world.runIn(repo, TOOL, args, options);
const portOf = (r) => Number(/JS3D_PORT=(\d+)\)$/.exec(r.lines.at(-1))?.[1]);
const lockOf = (repo) => join(repo.root, ".git", "js3d-port.lock");
const worktreeCount = (repo) => g(repo.root, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

// Everything a FAIL must leave behind: no folder, no branch, no lock, no extra worktree.
function assertNothingMade(repo, name, branch = name) {
  assert.equal(existsSync(repo.sibling(name)), false, "no folder");
  assert.ok(!repo.localBranches().includes(branch), "no branch");
  assert.equal(existsSync(lockOf(repo)), false, "no lock left behind");
  assert.equal(worktreeCount(repo), 1, "only the main checkout is a worktree");
}

describe("new-piece", { concurrency: 8 }, () => {
  it("a piece: worktree from origin/main, no upstream, node_modules linked, a port written down and hidden from git", async () => {
    const repo = world.makeRepo();
    writeFileSync(join(repo.root, "scratch-notes.txt"), "an untracked file in the root is fine\n");
    const r = await start(repo, ["demo"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    const port = portOf(r);
    assert.ok(bases().includes(port), `port ${port} is one of 18805, 18815 ... 18895`);
    const folder = repo.sibling("demo");
    const sha = g(repo.root, "rev-parse", "--short", "origin/main");
    assert.deepEqual(r.lines, [
      `OK repo ${repo.root}`,
      "OK branch main",
      "OK clean (no changed tracked files)",
      `OK fetch origin (origin/main at ${sha})`,
      `OK names free (branch demo, folder ${folder})`,
      `OK port ${port} (${port}-${port + 2} are not in use and no worktree claims them)`,
      `OK worktree ${folder} (new branch demo from origin/main ${sha})`,
      "OK no upstream for demo",
      `OK node_modules linked to ${join(repo.root, "node_modules")}`,
      `OK wrote ${join(folder, ".js3d-port")} (ignored by git)`,
      `new-piece: OK ${folder} (branch demo, JS3D_PORT=${port})`,
    ]);
    assert.equal(r.stderr, "");

    assert.equal(g(folder, "rev-parse", "--abbrev-ref", "HEAD"), "demo");
    assert.equal(g(folder, "rev-parse", "HEAD"), g(repo.root, "rev-parse", "origin/main"));
    assert.equal(gTry(repo.root, "config", "--get", "branch.demo.remote").code, 1, "no tracking config for the new branch");
    assert.equal(gTry(repo.root, "rev-parse", "--abbrev-ref", "demo@{upstream}").code !== 0, true);
    assert.equal(readlinkSync(join(folder, "node_modules")), join(repo.root, "node_modules"));
    assert.equal(readFileSync(join(folder, "node_modules", "marker.txt"), "utf8"), "keep me\n");
    assert.equal(readFileSync(join(folder, ".js3d-port"), "utf8"), `${port}\n`);
    assert.equal(g(folder, "status", "--porcelain"), "", "the port file and the link do not show up in git status");
    assert.equal(gTry(folder, "check-ignore", "-q", ".js3d-port").code, 0);
    assert.equal(existsSync(lockOf(repo)), false, "the port lock is released");
    assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main", "the main checkout is untouched");
    assert.equal(g(repo.root, "status", "--porcelain"), "?? scratch-notes.txt");
  });

  it("the piece starts from the fetched origin/main, not from the main checkout's older main", async () => {
    const repo = world.makeRepo();
    const newTip = repo.advanceOrigin();
    assert.notEqual(g(repo.root, "rev-parse", "HEAD"), newTip, "the checkout is behind origin before the run");
    const r = await start(repo, ["fresh"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(g(repo.sibling("fresh"), "rev-parse", "HEAD"), newTip);
    assert.ok(r.lines.includes(`OK fetch origin (origin/main at ${newTip.slice(0, 7)})`));
    assert.notEqual(g(repo.root, "rev-parse", "HEAD"), newTip, "the main checkout itself is not moved");
  });

  it("--branch names the branch, the folder still follows the name, and a branch name may have a slash", async () => {
    const repo = world.makeRepo();
    const r = await start(repo, ["thing", "--branch", "feature/thing-2"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(r.lines.at(-1), `new-piece: OK ${repo.sibling("thing")} (branch feature/thing-2, JS3D_PORT=${portOf(r)})`);
    assert.equal(g(repo.sibling("thing"), "rev-parse", "--abbrev-ref", "HEAD"), "feature/thing-2");
    assert.ok(!repo.localBranches().includes("thing"));
  });

  it("without --root it works on the repo the script lives in", async () => {
    // The default root is two folders above the script, so a copy of the tool (with its ports.mjs) inside a scratch repo must act on that repo.
    const repo = world.makeRepo();
    const copy = join(repo.root, "tools", "agent");
    mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, "new-piece.mjs"), readFileSync(TOOL));
    writeFileSync(join(copy, "ports.mjs"), readFileSync(PORTS));
    g(repo.root, "add", ".");
    g(repo.root, "commit", "-q", "-m", "tool");
    const r = await world.run(join(copy, "new-piece.mjs"), ["viaroot"], { cwd: repo.dir, env: { FAKE_GH_LOG: repo.ghLog } });
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(r.lines.at(-1), `new-piece: OK ${repo.sibling("viaroot")} (branch viaroot, JS3D_PORT=${portOf(r)})`);
  });

  it("a root without node_modules skips the link and says so", async () => {
    const repo = world.makeRepo({ modules: false });
    const r = await start(repo, ["bare"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes(`SKIP node_modules (none in ${repo.root})`));
    assert.equal(existsSync(join(repo.sibling("bare"), "node_modules")), false);
    assert.equal(g(repo.sibling("bare"), "status", "--porcelain"), "");
  });

  it("a root with changed tracked files is refused and nothing is created; a staged change counts too", async () => {
    const repo = world.makeRepo();
    writeFileSync(join(repo.root, "README.md"), "changed\n");
    const r = await start(repo, ["dirty"]);
    assert.deepEqual(r.lines, [
      `OK repo ${repo.root}`,
      "OK branch main",
      `FAIL: 1 tracked file(s) changed in ${repo.root} → commit or stash them, then run it again (untracked files are fine)`,
      "new-piece: 1 problem(s)",
    ]);
    assert.equal(r.code, 1);
    assertNothingMade(repo, "dirty");
    g(repo.root, "checkout", "--", "README.md");
    writeFileSync(join(repo.root, "new.txt"), "x\n");
    g(repo.root, "add", "new.txt");
    const staged = await start(repo, ["staged"]);
    assert.match(staged.lines.at(-2), /^FAIL: 1 tracked file\(s\) changed/);
    assert.equal(staged.code, 1);
  });

  it("a git that cannot tell the root's status is a FAIL, not a clean root", async () => {
    const repo = world.makeRepo();
    const r = await start(repo, ["blind"], { env: world.shimEnv({ SHIM_FAIL: "status", SHIM_CWD: repo.root }) });
    assert.equal(r.lines.at(-2), `FAIL: git status failed in ${repo.root}: simulated failure of git status → fix the repo (git -C ${q(repo.root)} status), then run it again`);
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "blind");
  });

  it("a root that is not on main is refused (detached too)", async () => {
    const repo = world.makeRepo();
    g(repo.root, "switch", "-q", "-c", "elsewhere");
    const r = await start(repo, ["x"]);
    assert.equal(r.lines.at(-2), `FAIL: ${repo.root} is on elsewhere, not main → git -C ${q(repo.root)} switch main`);
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "x");
    g(repo.root, "checkout", "-q", "--detach");
    const d = await start(repo, ["x"]);
    assert.match(d.lines.at(-2), /^FAIL: .* is on no branch \(detached HEAD\), not main/);
  });

  it("a root that is itself a piece worktree is told to run from the main checkout", async () => {
    const repo = world.makeRepo();
    assert.equal((await start(repo, ["first"])).code, 0);
    const r = await world.run(TOOL, ["--root", repo.sibling("first"), "second"]);
    assert.equal(r.lines.at(-2), `FAIL: ${repo.sibling("first")} is on first, not main → run it from the main checkout, or pass --root ${q(repo.root)}`);
    assert.equal(r.code, 1);
    assert.equal(existsSync(repo.sibling("second")), false);
  });

  it("a piece worktree whose main checkout has moved away gets a FAIL, not a stack trace", async () => {
    const repo = world.makeRepo();
    assert.equal((await start(repo, ["stay"])).code, 0);
    renameSync(repo.root, `${repo.root}-moved`);
    const r = await world.run(TOOL, ["--root", repo.sibling("stay"), "other"]);
    assert.match(r.lines.at(-2), /^FAIL: /);
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "");
  });

  it("a branch that already exists, here, on origin or as the worktree folder, is refused", async () => {
    const repo = world.makeRepo();
    g(repo.root, "branch", "taken");
    const r = await start(repo, ["taken"]);
    assert.equal(r.lines.at(-2), "FAIL: branch taken already exists → finish it with node tools/agent/done-piece.mjs 'taken', or pick another name or --branch");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "taken", "nothing");

    // An old piece nobody cleaned up: gone locally, still on origin (also when this clone never fetched that branch).
    g(repo.root, "push", "-q", "origin", "main:refs/heads/oldpiece");
    const o = await start(repo, ["oldpiece"]);
    assert.equal(o.lines.at(-2), "FAIL: origin already has a branch oldpiece (an old piece nobody cleaned up?) → finish it with node tools/agent/done-piece.mjs 'oldpiece', or pick another name or --branch");
    assert.equal(o.code, 1);
    assertNothingMade(repo, "oldpiece");
    // A branch of the same tail on origin is not the same branch.
    g(repo.root, "push", "-q", "origin", "main:refs/heads/other/tail");
    assert.equal((await start(repo, ["tail"])).code, 0);

    mkdirSync(repo.sibling("folder"));
    const f = await start(repo, ["folder"]);
    assert.equal(f.lines.at(-2), `FAIL: ${repo.sibling("folder")} already exists → remove it or pick another name`);
    assert.equal(f.code, 1);
    assert.ok(!repo.localBranches().includes("folder"), "no branch was made");

    // A second piece with the first one's name is refused as well.
    assert.equal((await start(repo, ["again"])).code, 0);
    const twice = await start(repo, ["again"]);
    assert.match(twice.lines.at(-2), /^FAIL: branch again already exists/);
    assert.equal(twice.code, 1);
  });

  it("a git that cannot list origin's branches is a FAIL, not a free name", async () => {
    const repo = world.makeRepo();
    const r = await start(repo, ["blind"], { env: world.shimEnv({ SHIM_FAIL: "ls-remote" }) });
    assert.equal(r.lines.at(-2), "FAIL: git ls-remote origin failed: simulated failure of git ls-remote → check the network and the origin remote, then run it again");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "blind");
  });

  it("a branch that tracks origin/main is caught and rolled back: a FAIL means nothing was made", async () => {
    const repo = world.makeRepo();
    const r = await start(repo, ["leaky"], { env: world.shimEnv({ SHIM_TRACK: "1" }) });
    const sha = g(repo.root, "rev-parse", "--short", "origin/main");
    assert.deepEqual(r.lines.slice(-4), [
      `OK worktree ${repo.sibling("leaky")} (new branch leaky from origin/main ${sha})`,
      "FAIL: branch leaky tracks origin/main, so a push from Desktop would land on it → check git config branch.autoSetupMerge, then run it again",
      "OK rolled back (worktree and branch removed, nothing was made)",
      "new-piece: 1 problem(s)",
    ]);
    assert.equal(r.code, 1);
    assert.ok(!r.lines.some((l) => l.startsWith("OK no upstream") || l.startsWith("OK node_modules") || l.startsWith("OK wrote")), "it stops at the failed check");
    assertNothingMade(repo, "leaky");
    assert.equal(r.stderr, "");
    // And the same name works afterwards with a normal git.
    assert.equal((await start(repo, ["leaky"])).code, 0);
  });

  it("a link that cannot be made is rolled back too", async () => {
    // The repo tracks a file called node_modules, so the worktree already has one where the link should go.
    const repo = world.makeRepo({ modules: false });
    writeFileSync(join(repo.root, "node_modules"), "not a folder\n");
    g(repo.root, "add", "-f", "node_modules");
    g(repo.root, "commit", "-q", "-m", "a file called node_modules");
    g(repo.root, "push", "-q", "origin", "main");
    const r = await start(repo, ["nolink"]);
    assert.match(r.lines.at(-3), /^FAIL: could not link node_modules: EEXIST.* → look at .*node_modules, then run it again$/);
    assert.equal(r.lines.at(-2), "OK rolled back (worktree and branch removed, nothing was made)");
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "nolink");
  });

  it("a worktree add that fails after git made the branch takes the branch away again", async () => {
    const repo = world.makeRepo();
    const before = repo.localBranches();
    const r = await start(repo, ["halfway"], { env: world.shimEnv({ SHIM_ADD_LEAVES_BRANCH: "1" }) });
    assert.match(r.lines.at(-2), /^FAIL: git worktree add failed: simulated checkout failure after the branch was made → fix that, then run it again$/);
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assert.deepEqual(repo.localBranches(), before, "the branch the failed add left behind is gone");
    assertNothingMade(repo, "halfway");
  });

  it("a claim that cannot be written is rolled back too", async () => {
    // The repo tracks a folder called .js3d-port, so the worktree has a folder where the claim file should go.
    const repo = world.makeRepo();
    mkdirSync(join(repo.root, ".js3d-port"));
    writeFileSync(join(repo.root, ".js3d-port", "keep"), "x\n");
    g(repo.root, "add", ".js3d-port/keep");
    g(repo.root, "commit", "-q", "-m", "a folder called .js3d-port");
    g(repo.root, "push", "-q", "origin", "main");
    const r = await start(repo, ["noclaim"]);
    assert.match(r.lines.at(-3), /^FAIL: could not write \.js3d-port: EISDIR.* → look at .*\.js3d-port, then run it again$/);
    assert.equal(r.lines.at(-2), "OK rolled back (worktree and branch removed, nothing was made)");
    assert.equal(r.code, 1);
    assertNothingMade(repo, "noclaim");
  });

  it("when the roll-back fails as well, both problems are named with the commands to finish by hand", async () => {
    const repo = world.makeRepo();
    const r = await start(repo, ["stuck"], { env: world.shimEnv({ SHIM_TRACK: "1", SHIM_FAIL: "worktree remove" }) });
    const folder = repo.sibling("stuck");
    assert.match(r.lines.at(-3), /^FAIL: branch stuck tracks origin\/main, so a push from Desktop would land on it → /);
    assert.equal(r.lines.at(-2), `FAIL: roll-back failed (simulated failure of git worktree remove) → git -C ${q(repo.root)} worktree remove --force ${q(folder)}; git -C ${q(repo.root)} branch -D ${q("stuck")}`);
    assert.equal(r.lines.at(-1), "new-piece: 2 problem(s)");
    assert.equal(r.code, 1);
    assert.equal(existsSync(lockOf(repo)), false, "the lock is released even then");
    assert.ok(existsSync(folder), "what could not be undone is still there, and the message says how to remove it");
  });

  it("the port claim: new-piece writes the port as a number on the first line of .js3d-port, and the shared freePort skips what it claimed", async () => {
    const repo = world.makeRepo();
    const first = portOf(await start(repo, ["a"]));
    const second = portOf(await start(repo, ["b"]));
    assert.notEqual(second, first, "the second piece does not reuse the first piece's port");
    assert.ok(second > first);
    for (const [name, port] of [["a", first], ["b", second]]) {
      const claim = readFileSync(join(repo.sibling(name), ".js3d-port"), "utf8");
      assert.equal(claim, `${port}\n`);
      assert.equal(claimedPorts([repo.sibling(name)]).has(port), true, "ports.mjs reads the claim back");
    }
    const next = await freePort({ root: repo.root });
    assert.ok(next > second, `freePort answers ${next}, past both claimed blocks (${first}, ${second})`);
    // Removing a piece (as done-piece does) takes its claim with it.
    rmSync(repo.sibling("a"), { recursive: true, force: true });
    g(repo.root, "worktree", "prune");
    assert.equal(portOf(await start(repo, ["c"])), first);
  });

  it("the port: when no block is free the run stops before anything is made", async () => {
    const repo = world.makeRepo();
    const first = 19805; // a range of its own, so the tests that run side by side keep their ports
    const busy = await hold(...bases(first)); // every base port that is not already taken by something else
    try {
      const r = await start(repo, ["full"], { env: { JS3D_PORT_FIRST: String(first) } });
      assert.equal(r.lines.at(-2), `FAIL: no free test port: each block of 3 ports from ${first}, ${first + 10} ... ${first + 90} has a port in use or claimed → finish an old piece with node tools/agent/done-piece.mjs <branch> or stop a test server, then run it again`);
      assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
      assert.equal(r.code, 1);
      assertNothingMade(repo, "full");
    } finally { await busy.close(); }
    assert.equal((await start(repo, ["full"], { env: { JS3D_PORT_FIRST: String(first) } })).code, 0, "and it works as soon as a block is free");
  });

  it("two runs at the same time get two different ports (the choice and the claim happen under a lock)", async () => {
    const repo = world.makeRepo();
    const results = await Promise.all(["p1", "p2", "p3", "p4"].map((n) => start(repo, [n])));
    for (const r of results) assert.equal(r.code, 0, r.lines.join("\n"));
    const ports = results.map(portOf);
    assert.equal(new Set(ports).size, 4, `four runs, four ports: ${ports.join(", ")}`);
    assert.deepEqual([...claimedPorts(["p1", "p2", "p3", "p4"].map((n) => repo.sibling(n)))].sort(), [...ports].sort());
    assert.equal(existsSync(lockOf(repo)), false);
    assert.equal(worktreeCount(repo), 5);
  });

  it("a run waits for the port lock while another run holds it, then goes ahead", async () => {
    const repo = world.makeRepo();
    mkdirSync(lockOf(repo));
    const releaseAfter = 500;
    setTimeout(() => rmSync(lockOf(repo), { recursive: true, force: true }), releaseAfter);
    const t0 = Date.now();
    const r = await start(repo, ["waits"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(Date.now() - t0 >= releaseAfter, "it could not have started before the lock was let go");
    assert.equal(existsSync(lockOf(repo)), false);
  });

  it("a port lock left behind by a crashed run (older than a minute) is taken over", async () => {
    const repo = world.makeRepo();
    mkdirSync(lockOf(repo));
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(lockOf(repo), old, old);
    const r = await start(repo, ["takeover"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(existsSync(lockOf(repo)), false);
    assert.deepEqual(readdirSync(join(repo.root, ".git")).filter((f) => f.startsWith("js3d-port.lock")), [], "the renamed stale lock was removed too");
  });

  it("the port file and node_modules are added to the shared exclude once each, and a root exclude without a final newline is respected", async () => {
    const repo = world.makeRepo({ exclude: "" });
    const exclude = join(repo.root, ".git", "info", "exclude");
    writeFileSync(exclude, "something-else"); // no newline at the end, and no node_modules: .gitignore's `node_modules/` does not match a symlink
    const first = await start(repo, ["p"]);
    assert.equal(first.code, 0, first.lines.join("\n"));
    assert.equal(g(repo.sibling("p"), "status", "--porcelain"), "", "neither the link nor the claim shows up in git status");
    assert.equal((await start(repo, ["q"])).code, 0);
    assert.equal(readFileSync(exclude, "utf8"), "something-else\n.js3d-port\nnode_modules\n");
    assert.equal(g(repo.root, "check-ignore", "-v", ".js3d-port").includes(".js3d-port"), true);
  });

  it("a failed fetch is a FAIL with the way out, and nothing is created", async () => {
    const repo = world.makeRepo();
    g(repo.root, "remote", "set-url", "origin", join(repo.dir, "does-not-exist.git"));
    const r = await start(repo, ["nofetch"]);
    assert.match(r.lines.at(-2), /^FAIL: git fetch origin failed: .* → check the network and the origin remote, then run it again$/);
    assert.equal(r.code, 1);
    assertNothingMade(repo, "nofetch");
  });

  it("a folder that is not a git repo, or not the top of one, is refused", async () => {
    const plain = join(world.scratch, "plain");
    mkdirSync(plain);
    const r = await world.run(TOOL, ["--root", plain, "x"]);
    assert.deepEqual(r.lines, [`FAIL: ${plain} is not a git repo → run it from the main checkout or pass --root <repo>`, "new-piece: 1 problem(s)"]);
    assert.equal(r.code, 1);
    const repo = world.makeRepo();
    const inside = join(repo.root, "inner");
    mkdirSync(inside);
    const s = await world.run(TOOL, ["--root", inside, "x"]);
    assert.equal(s.lines[0], `FAIL: ${inside} is inside a repo but is not its top folder → pass --root ${q(repo.root)}`);
    assert.equal(s.code, 1);
    const missing = await world.run(TOOL, ["--root", join(plain, "nope"), "x"]);
    assert.match(missing.lines[0], /does not exist → pass --root/);
    assert.equal(missing.code, 1);
    assert.equal(missing.stderr, "");
  });

  it("names that cannot be a folder or a branch are refused before anything is touched", async () => {
    const repo = world.makeRepo();
    for (const name of ["a/b", "has space", "-lead", ".dot", "a..b"]) {
      const r = await start(repo, ["--branch=ok", "--", name]);
      assert.match(r.lines[0], /^FAIL: name ".*" cannot be a folder name → use letters, digits/, name);
      assert.equal(r.code, 1);
    }
    for (const branch of ["-x", "a..b", "has space", "end.lock", "x~1", "x:y", ""]) {
      const r = await start(repo, ["fine", `--branch=${branch}`]);
      assert.equal(r.lines[0], `FAIL: "${branch}" is not a branch name git accepts → pick another with --branch`, branch);
      assert.equal(r.code, 1);
    }
    assertNothingMade(repo, "fine");
  });

  it("--help prints the usage and exits 0; bad command lines exit 2 with the usage on stderr", async () => {
    const h = await world.run(TOOL, ["--help"]);
    assert.equal(h.code, 0);
    assert.match(h.lines[0], /^usage: node tools\/agent\/new-piece\.mjs <name> \[--branch <branch>\] \[--root <repo>\]/);
    for (const args of [[], ["a", "b"], ["--nope", "a"], ["--branch"]]) {
      const r = await world.run(TOOL, args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /usage: node tools\/agent\/new-piece\.mjs/);
      assert.equal(r.lines.join(""), "");
    }
  });

  it("the tool never starts a shell or runs through a string: it uses spawnSync with argument lists only", () => {
    assert.doesNotMatch(readFileSync(TOOL, "utf8"), /execSync|exec\(|shell:\s*true/);
  });
});
