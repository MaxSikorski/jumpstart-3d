// The piece starter (tools/agent/new-piece.mjs): a worktree on a new --no-track branch from a fresh origin/main, a verified empty upstream, the node_modules link, and a free test port.
// Every test runs on scratch repos (a local bare "origin" and a main checkout) with HOME, GH_CONFIG_DIR and PATH pointed at scratch folders (see piece-helpers.mjs),
// so nothing reaches GitHub, the real ~/.gitconfig or this repo. The choice of the port itself is tested in ports.test.mjs; here only that new-piece uses it (8805, 8815 ... 8895),
// writes the claim ports.mjs reads, and makes nothing when no port is free.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimedPorts, freePort } from "../tools/agent/ports.mjs";
import { BASES, hold, makeWorld } from "./piece-helpers.mjs";

const TOOL = fileURLToPath(new URL("../tools/agent/new-piece.mjs", import.meta.url));
const world = makeWorld("new-piece");
after(() => world.cleanup());
const { g, gTry } = world;
const start = (repo, args, options) => world.run(TOOL, ["--root", repo.root, ...args], options);
const portOf = (r) => Number(/JS3D_PORT=(\d+)\)$/.exec(r.lines.at(-1))?.[1]);

test("a piece: worktree from origin/main, no upstream, node_modules linked, a port written down and hidden from git", () => {
  const repo = world.makeRepo();
  writeFileSync(join(repo.root, "scratch-notes.txt"), "an untracked file in the root is fine\n");
  const r = start(repo, ["demo"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  const port = portOf(r);
  assert.ok(BASES.includes(port), `port ${port} is one of 8805, 8815 ... 8895`);
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
  assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main", "the main checkout is untouched");
  assert.equal(g(repo.root, "status", "--porcelain"), "?? scratch-notes.txt");
});

test("the piece starts from the fetched origin/main, not from the main checkout's older main", () => {
  const repo = world.makeRepo();
  const newTip = repo.advanceOrigin();
  assert.notEqual(g(repo.root, "rev-parse", "HEAD"), newTip, "the checkout is behind origin before the run");
  const r = start(repo, ["fresh"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(g(repo.sibling("fresh"), "rev-parse", "HEAD"), newTip);
  assert.ok(r.lines.includes(`OK fetch origin (origin/main at ${newTip.slice(0, 7)})`));
  assert.notEqual(g(repo.root, "rev-parse", "HEAD"), newTip, "the main checkout itself is not moved");
});

test("--branch names the branch, the folder still follows the name, and a branch name may have a slash", () => {
  const repo = world.makeRepo();
  const r = start(repo, ["thing", "--branch", "feature/thing-2"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(r.lines.at(-1), `new-piece: OK ${repo.sibling("thing")} (branch feature/thing-2, JS3D_PORT=${portOf(r)})`);
  assert.equal(g(repo.sibling("thing"), "rev-parse", "--abbrev-ref", "HEAD"), "feature/thing-2");
  assert.ok(!repo.localBranches().includes("thing"));
});

test("without --root it works on the repo the script lives in", () => {
  // The default root is two folders above the script, so a copy of the tool inside a scratch repo must act on that repo.
  const repo = world.makeRepo();
  const copy = join(repo.root, "tools", "agent");
  mkdirSync(copy, { recursive: true });
  writeFileSync(join(copy, "new-piece.mjs"), readFileSync(TOOL));
  writeFileSync(join(copy, "ports.mjs"), readFileSync(fileURLToPath(new URL("../tools/agent/ports.mjs", import.meta.url)))); // the tool imports it from its own folder
  g(repo.root, "add", ".");
  g(repo.root, "commit", "-q", "-m", "tool");
  const r = world.run(join(copy, "new-piece.mjs"), ["viaroot"], { cwd: join(repo.dir) });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(r.lines.at(-1), `new-piece: OK ${repo.sibling("viaroot")} (branch viaroot, JS3D_PORT=${portOf(r)})`);
});

test("a root without node_modules skips the link and says so", () => {
  const repo = world.makeRepo({ modules: false });
  const r = start(repo, ["bare"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes(`SKIP node_modules (none in ${repo.root})`));
  assert.equal(existsSync(join(repo.sibling("bare"), "node_modules")), false);
  assert.equal(g(repo.sibling("bare"), "status", "--porcelain"), "");
});

test("a root with changed tracked files is refused and nothing is created", () => {
  const repo = world.makeRepo();
  writeFileSync(join(repo.root, "README.md"), "changed\n");
  const r = start(repo, ["dirty"]);
  assert.deepEqual(r.lines, [
    `OK repo ${repo.root}`,
    "OK branch main",
    `FAIL: 1 tracked file(s) changed in ${repo.root} → commit or stash them, then run it again (untracked files are fine)`,
    "new-piece: 1 problem(s)",
  ]);
  assert.equal(r.code, 1);
  assert.equal(existsSync(repo.sibling("dirty")), false);
  assert.ok(!repo.localBranches().includes("dirty"));
});

test("a staged change counts as changed too", () => {
  const repo = world.makeRepo();
  writeFileSync(join(repo.root, "new.txt"), "x\n");
  g(repo.root, "add", "new.txt");
  const r = start(repo, ["staged"]);
  assert.match(r.lines.at(-2), /^FAIL: 1 tracked file\(s\) changed/);
  assert.equal(r.code, 1);
});

test("a root that is not on main is refused", () => {
  const repo = world.makeRepo();
  g(repo.root, "switch", "-q", "-c", "elsewhere");
  const r = start(repo, ["x"]);
  assert.equal(r.lines.at(-2), `FAIL: ${repo.root} is on elsewhere, not main → git -C ${repo.root} switch main`);
  assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
  assert.equal(r.code, 1);
  assert.equal(existsSync(repo.sibling("x")), false);
  g(repo.root, "checkout", "-q", "--detach");
  const d = start(repo, ["x"]);
  assert.match(d.lines.at(-2), /^FAIL: .* is on no branch \(detached HEAD\), not main/);
});

test("a root that is itself a piece worktree is told to run from the main checkout", () => {
  const repo = world.makeRepo();
  assert.equal(start(repo, ["first"]).code, 0);
  const r = world.run(TOOL, ["--root", repo.sibling("first"), "second"]);
  assert.equal(r.lines.at(-2), `FAIL: ${repo.sibling("first")} is on first, not main → run it from the main checkout, or pass --root ${repo.root}`);
  assert.equal(r.code, 1);
  assert.equal(existsSync(repo.sibling("first").replace(/first$/, "second")), false);
});

test("a branch that already exists, here or as the worktree folder, is refused", () => {
  const repo = world.makeRepo();
  g(repo.root, "branch", "taken");
  const r = start(repo, ["taken"]);
  assert.equal(r.lines.at(-2), "FAIL: branch taken already exists → finish it with node tools/agent/done-piece.mjs taken, or pick another name or --branch");
  assert.equal(r.code, 1);
  assert.equal(existsSync(repo.sibling("taken")), false, "no folder was made");

  mkdirSync(repo.sibling("folder"));
  const f = start(repo, ["folder"]);
  assert.equal(f.lines.at(-2), `FAIL: ${repo.sibling("folder")} already exists → remove it or pick another name`);
  assert.equal(f.code, 1);
  assert.ok(!repo.localBranches().includes("folder"), "no branch was made");

  // A second piece with the first one's name is refused as well, and leaves the first alone.
  assert.equal(start(repo, ["again"]).code, 0);
  const twice = start(repo, ["again"]);
  assert.match(twice.lines.at(-2), /^FAIL: branch again already exists/);
  assert.equal(twice.code, 1);
});

test("a branch that tracks origin/main is caught by the upstream check (a git that tracks despite --no-track)", () => {
  const repo = world.makeRepo();
  const r = start(repo, ["leaky"], { env: { PATH: world.trackingGitPath() } });
  const folder = repo.sibling("leaky");
  assert.equal(r.lines.at(-2), `FAIL: branch leaky tracks origin/main, so a push from Desktop would land on it → git -C ${folder} branch --unset-upstream`);
  assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
  assert.equal(r.code, 1);
  assert.ok(!r.lines.some((l) => l.startsWith("OK no upstream") || l.startsWith("OK node_modules") || l.startsWith("OK wrote")), "it stops at the failed check");
  assert.equal(existsSync(join(folder, ".js3d-port")), false);
  assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "leaky@{upstream}"), "origin/main", "the shim really made a tracking branch");
});

test("the port claim: new-piece writes the port as a number on the first line of .js3d-port, and the shared freePort skips what it claimed", async () => {
  const repo = world.makeRepo();
  const first = portOf(start(repo, ["a"]));
  const second = portOf(start(repo, ["b"]));
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
  assert.equal(portOf(start(repo, ["c"])), first);
});

test("the port: when no block is free the run stops before anything is made", async () => {
  const repo = world.makeRepo();
  const busy = await hold(...BASES); // every base port that is not already taken by something else
  try {
    const r = start(repo, ["full"]);
    assert.equal(r.lines.at(-2), "FAIL: no free test port: each block of 3 ports from 8805, 8815 ... 8895 has a port in use or claimed → finish an old piece with node tools/agent/done-piece.mjs <branch> or stop a test server, then run it again");
    assert.equal(r.lines.at(-1), "new-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assert.equal(existsSync(repo.sibling("full")), false, "no folder");
    assert.ok(!repo.localBranches().includes("full"), "no branch");
  } finally { await busy.close(); }
  assert.equal(start(repo, ["full"]).code, 0, "and it works as soon as a block is free");
});

test("the port file is added to the shared exclude once, and a root exclude without a final newline is respected", () => {
  const repo = world.makeRepo();
  const exclude = join(repo.root, ".git", "info", "exclude");
  writeFileSync(exclude, "node_modules\nsomething-else"); // no newline at the end
  assert.equal(start(repo, ["p"]).code, 0);
  assert.equal(start(repo, ["q"]).code, 0);
  assert.equal(readFileSync(exclude, "utf8"), "node_modules\nsomething-else\n.js3d-port\n");
  assert.equal(g(repo.root, "check-ignore", "-v", ".js3d-port").includes(".js3d-port"), true);
});

test("a failed fetch is a FAIL with the way out, and nothing is created", () => {
  const repo = world.makeRepo();
  g(repo.root, "remote", "set-url", "origin", join(repo.dir, "does-not-exist.git"));
  const r = start(repo, ["nofetch"]);
  assert.match(r.lines.at(-2), /^FAIL: git fetch origin failed: .* → check the network and the origin remote, then run it again$/);
  assert.equal(r.code, 1);
  assert.equal(existsSync(repo.sibling("nofetch")), false);
});

test("a folder that is not a git repo, or not the top of one, is refused", () => {
  const plain = join(world.scratch, "plain");
  mkdirSync(plain);
  const r = world.run(TOOL, ["--root", plain, "x"]);
  assert.deepEqual(r.lines, [`FAIL: ${plain} is not a git repo → run it from the main checkout or pass --root <repo>`, "new-piece: 1 problem(s)"]);
  assert.equal(r.code, 1);
  const repo = world.makeRepo();
  const inside = join(repo.root, "inner");
  mkdirSync(inside);
  const s = world.run(TOOL, ["--root", inside, "x"]);
  assert.equal(s.lines[0], `FAIL: ${inside} is inside a repo but is not its top folder → pass --root ${repo.root}`);
  assert.equal(s.code, 1);
  const missing = world.run(TOOL, ["--root", join(plain, "nope"), "x"]);
  assert.match(missing.lines[0], /does not exist → pass --root/);
  assert.equal(missing.code, 1);
});

test("names that cannot be a folder or a branch are refused before anything is touched", () => {
  const repo = world.makeRepo();
  for (const name of ["a/b", "has space", "-lead", ".dot", "a..b"]) {
    const r = start(repo, ["--branch=ok", "--", name]);
    assert.match(r.lines[0], /^FAIL: name ".*" cannot be a folder name → use letters, digits/, name);
    assert.equal(r.code, 1);
  }
  for (const branch of ["-x", "a..b", "has space", "end.lock", "x~1", "x:y", ""]) {
    const r = start(repo, ["fine", `--branch=${branch}`]);
    assert.equal(r.lines[0], `FAIL: "${branch}" is not a branch name git accepts → pick another with --branch`, branch);
    assert.equal(r.code, 1);
  }
  assert.equal(existsSync(repo.sibling("fine")), false);
});

test("--help prints the usage and exits 0; bad command lines exit 2 with the usage on stderr", () => {
  const h = world.run(TOOL, ["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.lines[0], /^usage: node tools\/agent\/new-piece\.mjs <name> \[--branch <branch>\] \[--root <repo>\]/);
  for (const args of [[], ["a", "b"], ["--nope", "a"], ["--branch"]]) {
    const r = world.run(TOOL, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /usage: node tools\/agent\/new-piece\.mjs/);
    assert.equal(r.lines.join(""), "");
  }
});

test("the tool never starts a shell or runs through a string: it uses spawnSync with argument lists only", () => {
  const source = readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /execSync|exec\(|shell:\s*true/);
});
