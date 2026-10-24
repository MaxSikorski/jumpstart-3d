// The piece cleaner (tools/agent/done-piece.mjs): after the merge it removes the worktree, deletes the local and remote branch and fast-forwards main, and it refuses
// (deleting nothing) while the work is not merged or the worktree has changed tracked files.
// Scratch repos only (a local bare "origin" plus a main checkout), HOME, GH_CONFIG_DIR and PATH pointed at scratch folders with a fake `gh` first on PATH (see piece-helpers.mjs):
// "GitHub merging a pull request" is a second clone that merges or squashes the pushed branch into main, and what `gh pr list` answers is whatever the test says.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorld } from "./piece-helpers.mjs";

const TOOL = fileURLToPath(new URL("../tools/agent/done-piece.mjs", import.meta.url));
const world = makeWorld("done-piece");
after(() => world.cleanup());
const { g } = world;
const finish = (repo, args, options) => world.run(TOOL, ["--root", repo.root, ...args], options);
const ghCalls = () => (existsSync(world.env.FAKE_GH_LOG) ? readFileSync(world.env.FAKE_GH_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const resetGhLog = () => rmSync(world.env.FAKE_GH_LOG, { force: true });
const merged = (number, headRefOid) => JSON.stringify([{ number, headRefOid }]);

// Everything the tool must leave alone when it refuses: the worktree, the local branch, the remote branch.
function assertUntouched(repo, branch, folder) {
  assert.ok(existsSync(folder), "the worktree is still there");
  assert.ok(repo.localBranches().includes(branch), "the local branch is still there");
  assert.ok(repo.remoteBranches().includes(branch), "the remote branch is still there");
}

test("merged by a merge commit: worktree, local and remote branch go, main moves up, the root's node_modules is not touched", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("feat");
  mkdirSync(join(folder, "test-results"));
  writeFileSync(join(folder, "test-results", "run.log"), "log\n");
  writeFileSync(join(folder, "scratch.txt"), "untracked\n");
  const mergeSha = repo.githubMerge("feat");
  writeFileSync(join(repo.root, "IMPROVEMENT_PLAN.md"), "# plan\n"); // untracked in the root: a local file, as on Max's Mac
  resetGhLog();

  const r = finish(repo, ["feat"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(r.lines.length, 11, r.lines.join("\n"));
  assert.deepEqual(r.lines.slice(0, 3), [`OK repo ${repo.root}`, `OK worktree ${folder}`, "OK fetch origin"]);
  assert.equal(r.lines[3], "OK merged (an ancestor of origin/main)");
  assert.equal(r.lines[4], "OK clean (no changed tracked files; 2 untracked file(s) will go with the worktree)");
  assert.deepEqual(r.lines.slice(5, 8), [`OK removed worktree ${folder}`, "OK deleted local branch feat", "OK deleted origin/feat"]);
  assert.match(r.lines[8], /^OK main fast-forwarded [0-9a-f]{7,} → [0-9a-f]{7,}$/);
  assert.equal(r.lines[9], "NEXT: tick IMPROVEMENT_PLAN.md ## Progress and move the backlog line to .claude/backlog-done.md");
  assert.equal(r.lines[10], "done-piece: OK feat");
  assert.equal(r.stderr, "");

  assert.equal(existsSync(folder), false);
  assert.ok(!repo.localBranches().includes("feat"));
  assert.ok(!repo.remoteBranches().includes("feat"));
  assert.equal(g(repo.root, "worktree", "list", "--porcelain").includes(folder), false);
  assert.equal(g(repo.root, "rev-parse", "HEAD"), mergeSha, "the main checkout caught up with origin/main");
  assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(readFileSync(join(repo.root, "node_modules", "marker.txt"), "utf8"), "keep me\n", "removing the worktree did not follow its node_modules link");
  assert.equal(readFileSync(join(repo.root, "feat.txt"), "utf8"), "work\n", "the merged work is in the main checkout now");
  assert.deepEqual(ghCalls(), [], "an ancestor needs no gh call");
});

test("the NEXT line comes from .claude/backlog.md too, and is left out when neither local file exists", () => {
  const repo = world.makeRepo();
  repo.addPiece("a");
  repo.githubMerge("a");
  assert.equal(finish(repo, ["a"]).lines.some((l) => l.startsWith("NEXT:")), false);

  repo.addPiece("b");
  repo.githubMerge("b");
  mkdirSync(join(repo.root, ".claude"));
  writeFileSync(join(repo.root, ".claude", "backlog.md"), "- [ ] b\n");
  const r = finish(repo, ["b"]);
  assert.equal(r.lines.at(-2), "NEXT: tick IMPROVEMENT_PLAN.md ## Progress and move the backlog line to .claude/backlog-done.md");
  assert.equal(r.lines.at(-1), "done-piece: OK b");
  assert.equal(readFileSync(join(repo.root, ".claude", "backlog.md"), "utf8"), "- [ ] b\n", "the local files are not edited");
});

test("a squash merge: not an ancestor, but a merged pull request with the branch's last commit counts", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("sq");
  repo.githubMerge("sq", "squash");
  const tip = g(folder, "rev-parse", "HEAD");
  resetGhLog();
  const r = finish(repo, ["sq"], { env: { FAKE_GH_OUT: merged(42, tip) } });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes("OK merged (merged as pull request #42)"));
  assert.equal(r.lines.at(-1), "done-piece: OK sq");
  assert.deepEqual(ghCalls(), [["pr", "list", "--head", "sq", "--state", "merged", "--json", "number,headRefOid"]]);
  assert.equal(existsSync(folder), false);
  assert.ok(!repo.localBranches().includes("sq"));
  assert.ok(!repo.remoteBranches().includes("sq"));
});

test("a squash merge where the local branch is behind the pull request's last commit still counts", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("behind");
  const oldTip = g(folder, "rev-parse", "HEAD");
  writeFileSync(join(folder, "more.txt"), "pushed from elsewhere\n");
  g(folder, "add", ".");
  g(folder, "commit", "-q", "-m", "more");
  g(folder, "push", "-q", "origin", "behind");
  const prTip = g(folder, "rev-parse", "HEAD");
  g(folder, "reset", "-q", "--hard", oldTip); // this checkout never saw the last commit
  repo.githubMerge("behind", "squash");
  const r = finish(repo, ["behind"], { env: { FAKE_GH_OUT: merged(7, prTip) } });
  assert.equal(r.code, 0, r.lines.join("\n"));
});

test("not merged (squash-looking, and gh knows no merged pull request): refused, nothing deleted", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("open");
  const r = finish(repo, ["open"]);
  assert.equal(r.lines.at(-2), "FAIL: open is not merged: it is not an ancestor of origin/main and no merged pull request has this branch as its head → finish the pull request (bash .claude/land.sh <worktree> open <pr>); to throw the work away instead, remove it by hand");
  assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
  assert.equal(r.code, 1);
  assertUntouched(repo, "open", folder);
  assert.equal(r.lines.some((l) => l.startsWith("OK removed") || l.startsWith("OK deleted") || l.startsWith("NEXT")), false);
});

test("a merged pull request of an older branch with the same name does not count when the branch has newer work", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("reused");
  const r = finish(repo, ["reused"], { env: { FAKE_GH_OUT: merged(3, "0".repeat(40)) } });
  assert.match(r.lines.at(-2), /^FAIL: reused is not merged: merged pull request #3 does not contain the branch's last commit [0-9a-f]{7}, so there is newer work on it →/);
  assert.equal(r.code, 1);
  assertUntouched(repo, "reused", folder);
  const noOid = finish(repo, ["reused"], { env: { FAKE_GH_OUT: '[{"number":3}]' } });
  assert.equal(noOid.code, 1, "a pull request with no last commit to compare is not proof");
  assertUntouched(repo, "reused", folder);
});

test("gh failing (not signed in, no network) is a FAIL that says so, and nothing is deleted", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("ghfail");
  const r = finish(repo, ["ghfail"], { env: { FAKE_GH_FAIL: "gh: To get started with GitHub CLI, please run: gh auth login" } });
  assert.match(r.lines.at(-2), /^FAIL: ghfail is not merged: it is not an ancestor of origin\/main and gh could not list merged pull requests: gh: To get started with GitHub CLI, please run: gh auth login →/);
  assert.equal(r.code, 1);
  assertUntouched(repo, "ghfail", folder);
  const junk = finish(repo, ["ghfail"], { env: { FAKE_GH_OUT: "not json" } });
  assert.match(junk.lines.at(-2), /gh printed something that is not JSON/);
  assert.equal(junk.code, 1);
  assertUntouched(repo, "ghfail", folder);
});

test("changed tracked files in the worktree are refused even when merged, and nothing is deleted", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("wip");
  repo.githubMerge("wip");
  writeFileSync(join(folder, "wip.txt"), "edited after the merge\n");
  writeFileSync(join(folder, "README.md"), "edited too\n");
  const r = finish(repo, ["wip"]);
  assert.equal(r.lines.at(-2), `FAIL: 2 tracked file(s) changed in ${folder} → commit or discard them there, then run it again`);
  assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
  assert.equal(r.code, 1);
  assertUntouched(repo, "wip", folder);
  assert.equal(readFileSync(join(folder, "wip.txt"), "utf8"), "edited after the merge\n");
  // A staged change counts as well.
  g(folder, "checkout", "--", ".");
  writeFileSync(join(folder, "staged.txt"), "x\n");
  g(folder, "add", "staged.txt");
  assert.match(finish(repo, ["wip"]).lines.at(-2), /^FAIL: 1 tracked file\(s\) changed/);
  assertUntouched(repo, "wip", folder);
});

test("a remote branch that is already gone is OK, not a FAIL", () => {
  const repo = world.makeRepo();
  repo.addPiece("gone");
  repo.githubMerge("gone");
  g(repo.root, "push", "-q", "origin", "--delete", "gone"); // GitHub's "delete branch on merge", done from outside
  g(repo.root, "update-ref", "refs/remotes/origin/gone", g(repo.root, "rev-parse", "origin/main")); // and a stale remote-tracking ref left behind
  const r = finish(repo, ["gone"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes("OK origin/gone was already gone"));
  assert.equal(r.lines.at(-1), "done-piece: OK gone");
  assert.ok(!r.lines.some((l) => l.startsWith("FAIL")));
});

test("a remote deletion that really fails is a FAIL, the other clean-up steps still run", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("stuck");
  repo.githubMerge("stuck");
  // A pre-receive hook on origin that refuses deletions.
  const hook = join(repo.origin, "hooks", "pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do case "$new" in 0000000000000000000000000000000000000000) echo "no deleting" >&2; exit 1;; esac; done\n', { mode: 0o755 });
  const r = finish(repo, ["stuck"]);
  assert.equal(r.code, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.startsWith("FAIL: could not delete origin/stuck: ") && l.endsWith(`→ git -C ${repo.root} push origin --delete stuck`)));
  assert.equal(existsSync(folder), false, "the worktree was removed");
  assert.ok(!repo.localBranches().includes("stuck"), "the local branch was deleted");
  assert.ok(r.lines.some((l) => l.startsWith("OK main fast-forwarded")), "main still caught up");
  assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
});

test("--keep-remote leaves the remote branch", () => {
  const repo = world.makeRepo();
  repo.addPiece("keep");
  repo.githubMerge("keep");
  const r = finish(repo, ["keep", "--keep-remote"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes("SKIP origin/keep kept (--keep-remote)"));
  assert.ok(repo.remoteBranches().includes("keep"));
  assert.ok(!repo.localBranches().includes("keep"));
});

test("a main checkout that is not on main is left alone with a WARN, and the piece is still cleaned up", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("away");
  repo.githubMerge("away");
  g(repo.root, "switch", "-q", "-c", "side");
  const sideTip = g(repo.root, "rev-parse", "HEAD");
  const r = finish(repo, ["away"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes(`WARN: ${repo.root} is on side, not main → skipped the fast-forward; later: git -C ${repo.root} switch main && git -C ${repo.root} pull --ff-only origin main`));
  assert.equal(r.lines.at(-1), "done-piece: OK away");
  assert.equal(existsSync(folder), false);
  assert.equal(g(repo.root, "rev-parse", "HEAD"), sideTip, "the checked-out branch did not move");
  assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "side");
});

test("a main checkout with changed tracked files is not fast-forwarded: WARN", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("busy");
  repo.githubMerge("busy");
  const head = g(repo.root, "rev-parse", "HEAD");
  writeFileSync(join(repo.root, "README.md"), "my edit\n");
  const r = finish(repo, ["busy"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes(`WARN: ${repo.root} has 1 changed tracked file(s) → skipped the fast-forward; after committing or stashing them: git -C ${repo.root} pull --ff-only origin main`));
  assert.equal(existsSync(folder), false);
  assert.equal(g(repo.root, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(repo.root, "README.md"), "utf8"), "my edit\n");
});

test("a detached main checkout is a WARN too", () => {
  const repo = world.makeRepo();
  repo.addPiece("detached");
  repo.githubMerge("detached");
  g(repo.root, "checkout", "-q", "--detach");
  const r = finish(repo, ["detached"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.startsWith(`WARN: ${repo.root} is on no branch (detached HEAD), not main`)));
});

test("a main that cannot fast-forward is a FAIL, after the clean-up", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("diverged");
  repo.githubMerge("diverged");
  writeFileSync(join(repo.root, "local-only.txt"), "a commit on main that origin does not have\n");
  g(repo.root, "add", ".");
  g(repo.root, "commit", "-q", "-m", "local main commit");
  const r = finish(repo, ["diverged"]);
  assert.equal(r.code, 1, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.startsWith(`FAIL: could not fast-forward main in ${repo.root}: `) && l.endsWith(`→ git -C ${repo.root} pull --ff-only origin main (or sort out main by hand)`)));
  assert.equal(existsSync(folder), false);
  assert.ok(!repo.localBranches().includes("diverged"));
  assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
});

test("a branch that is up to date with main needs no fast-forward and says so", () => {
  const repo = world.makeRepo();
  repo.addPiece("same", { commit: false, push: false }); // no commits: an ancestor of main already
  const r = finish(repo, ["same"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /^OK main already up to date \([0-9a-f]{7,}\)$/.test(l)));
  assert.ok(r.lines.includes("OK origin/same was already gone"), "a branch never pushed has no remote copy");
});

test("main, the main checkout's own branch and unknown names are refused", () => {
  const repo = world.makeRepo();
  const m = finish(repo, ["main"]);
  assert.deepEqual(m.lines, ["FAIL: main is not a piece → pass the piece's branch name", "done-piece: 1 problem(s)"]);
  assert.equal(m.code, 1);
  assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");

  g(repo.root, "switch", "-q", "-c", "here");
  const h = finish(repo, ["here"]);
  assert.equal(h.lines.at(-2), `FAIL: here is checked out in the main checkout ${repo.root}, not in a piece worktree → git -C ${repo.root} switch main, then run it again`);
  assert.equal(h.code, 1);
  assert.ok(existsSync(repo.root), "the main checkout is still there");
  assert.ok(repo.localBranches().includes("here"));
  g(repo.root, "switch", "-q", "main");

  // Started from inside the piece's own worktree (the script lives there): it cannot remove the folder it runs from.
  const piece = repo.addPiece("self");
  repo.githubMerge("self");
  const s = world.run(TOOL, ["--root", piece, "self"]);
  assert.equal(s.lines.at(-2), `FAIL: self is the worktree this run was started from (${piece}), which cannot remove itself → run it from the main checkout: node tools/agent/done-piece.mjs self --root ${repo.root}`);
  assert.equal(s.code, 1);
  assertUntouched(repo, "self", piece);

  const u = finish(repo, ["nothing-like-it"]);
  assert.equal(u.lines.at(-2), "FAIL: no worktree and no local branch called nothing-like-it → check the name with: git worktree list");
  assert.equal(u.code, 1);

  for (const bad of ["-x", "a..b", "has space"]) {
    const b = finish(repo, ["--", bad]);
    assert.equal(b.lines[0], `FAIL: "${bad}" is not a branch name git accepts → pass the piece's branch name`, bad);
    assert.equal(b.code, 1);
  }
});

test("a branch whose worktree was already removed by hand is cleaned up as a branch", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("orphan");
  repo.githubMerge("orphan");
  g(repo.root, "worktree", "remove", "--force", folder);
  const r = finish(repo, ["orphan"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(r.lines.includes("SKIP worktree (none for orphan; cleaning up the branch only)"));
  assert.ok(!repo.localBranches().includes("orphan"));
  assert.ok(!repo.remoteBranches().includes("orphan"));
  assert.equal(r.lines.at(-1), "done-piece: OK orphan");
  // Unmerged, it is still refused.
  const keep = repo.addPiece("orphan2");
  g(repo.root, "worktree", "remove", "--force", keep);
  const k = finish(repo, ["orphan2"]);
  assert.equal(k.code, 1);
  assert.ok(repo.localBranches().includes("orphan2"));
});

test("a worktree path with a link to node_modules, a piece nested in another piece's name, and a slash in the branch name", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("feature/deep");
  repo.githubMerge("feature/deep");
  const other = repo.addPiece("feature-deep-2", { commit: false, push: false });
  const r = finish(repo, ["feature/deep"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(existsSync(folder), false);
  assert.ok(existsSync(other), "another piece with a similar name is untouched");
  assert.ok(repo.localBranches().includes("feature-deep-2"));
  assert.ok(!repo.remoteBranches().includes("feature/deep"));
});

test("a folder that is not a git repo, or not the top of one, is refused", () => {
  const plain = join(world.scratch, "plain");
  mkdirSync(plain);
  const r = world.run(TOOL, ["--root", plain, "x"]);
  assert.deepEqual(r.lines, [`FAIL: ${plain} is not a git repo → run it from the main checkout or pass --root <repo>`, "done-piece: 1 problem(s)"]);
  assert.equal(r.code, 1);
  const repo = world.makeRepo();
  const inside = join(repo.root, "inner");
  mkdirSync(inside);
  const s = world.run(TOOL, ["--root", inside, "x"]);
  assert.equal(s.lines[0], `FAIL: ${inside} is inside a repo but is not its top folder → pass --root ${repo.root}`);
  assert.equal(s.code, 1);
});

test("a failed fetch is a FAIL before anything is deleted", () => {
  const repo = world.makeRepo();
  const folder = repo.addPiece("nofetch");
  g(repo.root, "remote", "set-url", "origin", join(repo.dir, "does-not-exist.git"));
  const r = finish(repo, ["nofetch"]);
  assert.match(r.lines.at(-2), /^FAIL: git fetch origin failed: .* → check the network and the origin remote, then run it again$/);
  assert.equal(r.code, 1);
  assert.ok(existsSync(folder));
  assert.ok(repo.localBranches().includes("nofetch"));
});

test("--help prints the usage and exits 0; bad command lines exit 2 with the usage on stderr", () => {
  const h = world.run(TOOL, ["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.lines[0], /^usage: node tools\/agent\/done-piece\.mjs <branch> \[--root <repo>\] \[--keep-remote\]/);
  for (const args of [[], ["a", "b"], ["--nope", "a"], ["--root"]]) {
    const r = world.run(TOOL, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /usage: node tools\/agent\/done-piece\.mjs/);
    assert.equal(r.lines.join(""), "");
  }
});

test("the tool never starts a shell or runs through a string: it uses spawnSync with argument lists only", () => {
  assert.doesNotMatch(readFileSync(TOOL, "utf8"), /execSync|exec\(|shell:\s*true/);
});
