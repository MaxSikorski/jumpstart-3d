// The piece cleaner (tools/agent/done-piece.mjs): after the merge it removes the worktree, deletes the local and remote branch and fast-forwards main, and it refuses
// (deleting nothing) while the work is not merged, the worktree has changed tracked files, or it holds a new file that was never added to git (a merge cannot have saved that).
// Scratch repos only (copies of one template: a local bare "origin" plus a main checkout), HOME, GH_CONFIG_DIR and PATH pointed at scratch folders with a fake `gh` first on PATH
// (see piece-helpers.mjs): "GitHub merging a pull request" is a merge or squash commit made on the bare origin, and what `gh pr list` answers is whatever the test says.
// A git that fails on request (the shim in piece-helpers.mjs) proves that a failing git is a FAIL and never a "clean". The tests run side by side (the tools are async children).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorld, q } from "./piece-helpers.mjs";

const TOOL = fileURLToPath(new URL("../tools/agent/done-piece.mjs", import.meta.url));
const world = makeWorld("done-piece");
after(() => world.cleanup());
const { g } = world;
const finish = (repo, args, options) => world.runIn(repo, TOOL, args, options);
const prs = (number, headRefOid) => JSON.stringify([{ number, headRefOid }]);
const NEXT = "NEXT: tick IMPROVEMENT_PLAN.md ## Progress and move the backlog line to .claude/backlog-done.md";

// Everything the tool must leave alone when it refuses: the worktree, the local branch, the remote branch.
function assertUntouched(repo, branch, folder, { remote = true } = {}) {
  assert.ok(existsSync(folder), "the worktree is still there");
  assert.ok(repo.localBranches().includes(branch), "the local branch is still there");
  if (remote) assert.ok(repo.remoteBranches().includes(branch), "the remote branch is still there");
}

describe("done-piece", { concurrency: 8 }, () => {
  it("merged by a merge commit: worktree, local and remote branch go, main moves up, the root's node_modules is not touched", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("feat", { file: true, claim: 18805 });
    mkdirSync(join(folder, "test-results"));
    writeFileSync(join(folder, "test-results", "run.log"), "log\n"); // ignored: test-results/ and *.log are in the scratch .gitignore, as in the real one
    writeFileSync(join(folder, "build.log"), "log\n");
    const mergeSha = repo.githubMerge("feat");
    writeFileSync(join(repo.root, "IMPROVEMENT_PLAN.md"), "# plan\n"); // untracked in the root: a local file, as on Max's Mac

    const r = await finish(repo, ["feat"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(r.lines.length, 11, r.lines.join("\n"));
    assert.deepEqual(r.lines.slice(0, 3), [`OK repo ${repo.root}`, `OK worktree ${folder}`, "OK fetch origin"]);
    assert.equal(r.lines[3], "OK merged (an ancestor of origin/main)");
    assert.equal(r.lines[4], "OK clean (no changed tracked files, nothing new to keep; 4 ignored item(s) will go with the worktree)"); // .js3d-port, build.log, node_modules, test-results/
    assert.deepEqual(r.lines.slice(5, 8), [`OK removed worktree ${folder}`, "OK deleted local branch feat", "OK deleted origin/feat"]);
    assert.match(r.lines[8], /^OK main fast-forwarded [0-9a-f]{7,} → [0-9a-f]{7,}$/);
    assert.equal(r.lines[9], NEXT);
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
    assert.deepEqual(repo.ghCalls(), [], "an ancestor needs no gh call");
  });

  it("the NEXT line comes from .claude/backlog.md too, and is left out when neither local file exists", async () => {
    const repo = world.makeRepo();
    repo.addPiece("a");
    repo.githubMerge("a");
    assert.equal((await finish(repo, ["a"])).lines.some((l) => l.startsWith("NEXT:")), false);

    repo.addPiece("b");
    repo.githubMerge("b");
    mkdirSync(join(repo.root, ".claude"));
    writeFileSync(join(repo.root, ".claude", "backlog.md"), "- [ ] b\n");
    const r = await finish(repo, ["b"]);
    assert.equal(r.lines.at(-2), NEXT);
    assert.equal(r.lines.at(-1), "done-piece: OK b");
    assert.equal(readFileSync(join(repo.root, ".claude", "backlog.md"), "utf8"), "- [ ] b\n", "the local files are not edited");
  });

  it("a squash merge: not an ancestor, but a merged pull request with the branch's last commit counts", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("sq");
    repo.githubMerge("sq", "squash");
    const tip = g(folder, "rev-parse", "HEAD");
    const r = await finish(repo, ["sq"], { env: { FAKE_GH_OUT: prs(42, tip) } });
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes("OK merged (merged as pull request #42)"));
    assert.equal(r.lines.at(-1), "done-piece: OK sq");
    assert.deepEqual(repo.ghCalls(), [["pr", "list", "--head", "sq", "--state", "merged", "--json", "number,headRefOid"]], "one question, also when the remote branch is checked (same commit)");
    assert.equal(existsSync(folder), false);
    assert.ok(!repo.localBranches().includes("sq"));
    assert.ok(!repo.remoteBranches().includes("sq"));
  });

  it("a squash merge where the local branch is behind the pull request's last commit still counts", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("behind");
    const oldTip = g(folder, "rev-parse", "HEAD");
    g(folder, "commit", "-q", "--allow-empty", "-m", "pushed from elsewhere");
    g(folder, "push", "-q", "origin", "behind");
    const prTip = g(folder, "rev-parse", "HEAD");
    g(folder, "reset", "-q", "--hard", oldTip); // this checkout never saw the last commit
    repo.githubMerge("behind", "squash");
    const r = await finish(repo, ["behind"], { env: { FAKE_GH_OUT: prs(7, prTip) } });
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(!repo.remoteBranches().includes("behind"), "origin's last commit is the pull request's, so the remote branch may go");
  });

  it("not merged (squash-looking, and gh knows no merged pull request): refused, nothing deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("open");
    const r = await finish(repo, ["open"]);
    assert.equal(r.lines.at(-2), "FAIL: open is not merged: it is not an ancestor of origin/main and no merged pull request has this branch as its head → finish the pull request (bash .claude/land.sh <worktree> open <pr>); to throw the work away instead, remove it by hand");
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertUntouched(repo, "open", folder);
    assert.equal(r.lines.some((l) => l.startsWith("OK removed") || l.startsWith("OK deleted") || l.startsWith("NEXT")), false);
  });

  it("a merged pull request of an older branch with the same name does not count when the branch has newer work", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("reused");
    const r = await finish(repo, ["reused"], { env: { FAKE_GH_OUT: prs(3, "0".repeat(40)) } });
    assert.match(r.lines.at(-2), /^FAIL: reused is not merged: merged pull request #3 does not contain the last commit [0-9a-f]{7}, so there is newer work on it →/);
    assert.equal(r.code, 1);
    assertUntouched(repo, "reused", folder);
    const noOid = await finish(repo, ["reused"], { env: { FAKE_GH_OUT: '[{"number":3}]' } });
    assert.equal(noOid.code, 1, "a pull request with no last commit to compare is not proof");
    assertUntouched(repo, "reused", folder);
  });

  it("gh failing (not signed in, no network) is a FAIL that says so, and nothing is deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("ghfail");
    const r = await finish(repo, ["ghfail"], { env: { FAKE_GH_FAIL: "gh: To get started with GitHub CLI, please run: gh auth login" } });
    assert.match(r.lines.at(-2), /^FAIL: ghfail is not merged: it is not an ancestor of origin\/main and gh could not list merged pull requests: gh: To get started with GitHub CLI, please run: gh auth login →/);
    assert.equal(r.code, 1);
    assertUntouched(repo, "ghfail", folder);
    const junk = await finish(repo, ["ghfail"], { env: { FAKE_GH_OUT: "not json" } });
    assert.match(junk.lines.at(-2), /gh printed something that is not JSON/);
    assert.equal(junk.code, 1);
    assertUntouched(repo, "ghfail", folder);
  });

  it("changed tracked files in the worktree are refused even when merged, and nothing is deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("wip", { file: true });
    repo.githubMerge("wip");
    writeFileSync(join(folder, "wip.txt"), "edited after the merge\n");
    writeFileSync(join(folder, "README.md"), "edited too\n");
    const r = await finish(repo, ["wip"]);
    assert.equal(r.lines.at(-2), `FAIL: 2 tracked file(s) changed in ${folder} → commit or discard them there, then run it again`);
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertUntouched(repo, "wip", folder);
    assert.equal(readFileSync(join(folder, "wip.txt"), "utf8"), "edited after the merge\n");
    // A staged change counts as well.
    g(folder, "checkout", "--", ".");
    writeFileSync(join(folder, "staged.txt"), "x\n");
    g(folder, "add", "staged.txt");
    assert.match((await finish(repo, ["wip"])).lines.at(-2), /^FAIL: 1 tracked file\(s\) changed/);
    assertUntouched(repo, "wip", folder);
  });

  it("a new file that was never added to git is refused (a branch with no commits looks merged, but the file is lost with the worktree)", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("fresh", { commit: false, push: false, claim: 18805 });
    mkdirSync(join(folder, "src"));
    writeFileSync(join(folder, "src", "newmodule.js"), "export const work = 1;\n");
    writeFileSync(join(folder, "notes.txt"), "mine\n");
    const r = await finish(repo, ["fresh"]);
    assert.equal(r.lines.at(-2), `FAIL: 2 new file(s) or folder(s) in ${folder} were never added to git and would be lost: notes.txt, src/ → commit them, move them out or delete them, then run it again`);
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assert.ok(r.lines.includes("OK merged (an ancestor of origin/main)"), "the branch itself looks merged: that is the trap");
    assertUntouched(repo, "fresh", folder, { remote: false });
    assert.equal(readFileSync(join(folder, "src", "newmodule.js"), "utf8"), "export const work = 1;\n");
    // Out of the way, it goes: the ignored claim and link do not count.
    rmSync(join(folder, "src"), { recursive: true });
    rmSync(join(folder, "notes.txt"));
    const again = await finish(repo, ["fresh"]);
    assert.equal(again.code, 0, again.lines.join("\n"));
    assert.equal(existsSync(folder), false);
  });

  it("a merged branch with an untracked scratch file is refused too, and only the first five names are listed", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("scratchy", { file: true });
    repo.githubMerge("scratchy");
    for (let i = 1; i <= 7; i++) writeFileSync(join(folder, `f${i}.txt`), "x\n");
    const r = await finish(repo, ["scratchy"]);
    assert.equal(r.lines.at(-2), `FAIL: 7 new file(s) or folder(s) in ${folder} were never added to git and would be lost: f1.txt, f2.txt, f3.txt, f4.txt, f5.txt, and 2 more → commit them, move them out or delete them, then run it again`);
    assert.equal(r.code, 1);
    assertUntouched(repo, "scratchy", folder);
  });

  it("a remote branch that is already gone is OK, not a FAIL (also with a stale remote-tracking ref)", async () => {
    const repo = world.makeRepo();
    repo.addPiece("gone");
    repo.githubMerge("gone");
    g(repo.root, "push", "-q", "origin", "--delete", "gone"); // GitHub's "delete branch on merge", done from outside
    g(repo.root, "update-ref", "refs/remotes/origin/gone", g(repo.root, "rev-parse", "origin/main")); // and a stale remote-tracking ref left behind
    const r = await finish(repo, ["gone"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes("OK origin/gone was already gone"));
    assert.equal(r.lines.at(-1), "done-piece: OK gone");
    assert.ok(!r.lines.some((l) => l.startsWith("FAIL")));
  });

  it("a remote deletion that really fails is a FAIL, the other clean-up steps still run", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("stuck");
    repo.githubMerge("stuck");
    // A pre-receive hook on origin that refuses deletions.
    writeFileSync(join(repo.origin, "hooks", "pre-receive"), '#!/bin/sh\nwhile read old new ref; do case "$new" in 0000000000000000000000000000000000000000) echo "no deleting" >&2; exit 1;; esac; done\n', { mode: 0o755 });
    const r = await finish(repo, ["stuck"]);
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => /^FAIL: could not delete origin\/stuck: .*rejected.* → /.test(l) && l.endsWith(`→ git -C ${q(repo.root)} push origin --delete ${q("stuck")}`)), r.lines.join("\n"));
    assert.equal(existsSync(folder), false, "the worktree was removed");
    assert.ok(!repo.localBranches().includes("stuck"), "the local branch was deleted");
    assert.ok(r.lines.some((l) => l.startsWith("OK main fast-forwarded")), "main still caught up");
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
  });

  it("commits pushed to the remote branch after the merge are kept: the remote branch stays, with a FAIL, and the rest is cleaned up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("ahead", { file: true });
    repo.githubMerge("ahead");
    const late = repo.advanceOrigin("ahead"); // somebody pushed once more after the merge
    const r = await finish(repo, ["ahead"]);
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => l.startsWith("FAIL: origin/ahead was kept: it is not merged (it is not an ancestor of origin/main and no merged pull request has this branch as its head) → look at it ")), r.lines.join("\n"));
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.deepEqual(repo.remoteBranches().filter((b) => b === "ahead"), ["ahead"], "the remote branch is still there");
    assert.equal(g(repo.origin, "rev-parse", "refs/heads/ahead"), late, "with the late commit");
    assert.equal(existsSync(folder), false, "the merged local work is cleaned up");
    assert.ok(!repo.localBranches().includes("ahead"));
    assert.ok(r.lines.some((l) => l.startsWith("OK main fast-forwarded")));
  });

  it("the same, when a squash merge's pull request ends at the local tip: the later remote commit is not covered by it", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("ahead2");
    const tip = g(folder, "rev-parse", "HEAD");
    repo.githubMerge("ahead2", "squash");
    repo.advanceOrigin("ahead2");
    const r = await finish(repo, ["ahead2"], { env: { FAKE_GH_OUT: prs(9, tip) } });
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => /^FAIL: origin\/ahead2 was kept: it is not merged \(merged pull request #9 does not contain the last commit [0-9a-f]{7}, so there is newer work on it\)/.test(l)), r.lines.join("\n"));
    assert.ok(repo.remoteBranches().includes("ahead2"));
    assert.ok(!repo.localBranches().includes("ahead2"));
  });

  it("a remote branch that moves between the check and the delete is not deleted (the delete only works on the commit that was checked)", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("race");
    repo.githubMerge("race");
    const r = await finish(repo, ["race"], { env: world.shimEnv({ SHIM_ADVANCE: `${repo.origin}|race` }) }); // the shim adds a commit to origin's race right before the push
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => /^FAIL: could not delete origin\/race: .*stale info/.test(l)), r.lines.join("\n"));
    assert.ok(repo.remoteBranches().includes("race"), "the late commit survived");
    assert.equal(existsSync(folder), false);
  });

  it("--keep-remote leaves the remote branch", async () => {
    const repo = world.makeRepo();
    repo.addPiece("keep");
    repo.githubMerge("keep");
    const r = await finish(repo, ["keep", "--keep-remote"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes("SKIP origin/keep kept (--keep-remote)"));
    assert.ok(repo.remoteBranches().includes("keep"));
    assert.ok(!repo.localBranches().includes("keep"));
  });

  it("a main checkout that is not on main is left alone with a WARN, and the piece is still cleaned up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("away");
    repo.githubMerge("away");
    g(repo.root, "switch", "-q", "-c", "side");
    const sideTip = g(repo.root, "rev-parse", "HEAD");
    const r = await finish(repo, ["away"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes(`WARN: ${repo.root} is on side, not main → skipped the fast-forward; later: git -C ${q(repo.root)} switch main && git -C ${q(repo.root)} pull --ff-only origin main`));
    assert.equal(r.lines.at(-1), "done-piece: OK away");
    assert.equal(existsSync(folder), false);
    assert.equal(g(repo.root, "rev-parse", "HEAD"), sideTip, "the checked-out branch did not move");
    assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "side");
  });

  it("a main checkout with changed tracked files is not fast-forwarded: WARN", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("busy");
    repo.githubMerge("busy");
    const head = g(repo.root, "rev-parse", "HEAD");
    writeFileSync(join(repo.root, "README.md"), "my edit\n");
    const r = await finish(repo, ["busy"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes(`WARN: ${repo.root} has 1 changed tracked file(s) → skipped the fast-forward; after committing or stashing them: git -C ${q(repo.root)} pull --ff-only origin main`));
    assert.equal(existsSync(folder), false);
    assert.equal(g(repo.root, "rev-parse", "HEAD"), head);
    assert.equal(readFileSync(join(repo.root, "README.md"), "utf8"), "my edit\n");
  });

  it("a detached main checkout is a WARN too", async () => {
    const repo = world.makeRepo();
    repo.addPiece("detached");
    repo.githubMerge("detached");
    g(repo.root, "checkout", "-q", "--detach");
    const r = await finish(repo, ["detached"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => l.startsWith(`WARN: ${repo.root} is on no branch (detached HEAD), not main`)));
  });

  it("a main that cannot fast-forward is a FAIL, after the clean-up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("diverged");
    repo.githubMerge("diverged");
    writeFileSync(join(repo.root, "local-only.txt"), "a commit on main that origin does not have\n");
    g(repo.root, "add", ".");
    g(repo.root, "commit", "-q", "-m", "local main commit");
    const r = await finish(repo, ["diverged"]);
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => l.startsWith(`FAIL: could not fast-forward main in ${repo.root}: `) && l.endsWith(`→ git -C ${q(repo.root)} pull --ff-only origin main (or sort out main by hand)`)));
    assert.equal(existsSync(folder), false);
    assert.ok(!repo.localBranches().includes("diverged"));
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
  });

  it("a branch that is up to date with main needs no fast-forward and says so", async () => {
    const repo = world.makeRepo();
    repo.addPiece("same", { commit: false, push: false }); // no commits and nothing new in it: an ancestor of main already
    const r = await finish(repo, ["same"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.some((l) => /^OK main already up to date \([0-9a-f]{7,}\)$/.test(l)));
    assert.ok(r.lines.includes("OK origin/same was already gone"), "a branch never pushed has no remote copy");
  });

  it("main, the main checkout's own branch, the worktree it runs from and unknown names are refused", async () => {
    const repo = world.makeRepo();
    const m = await finish(repo, ["main"]);
    assert.deepEqual(m.lines, ["FAIL: main is not a piece → pass the piece's branch name", "done-piece: 1 problem(s)"]);
    assert.equal(m.code, 1);
    assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");

    g(repo.root, "switch", "-q", "-c", "here");
    const h = await finish(repo, ["here"]);
    assert.equal(h.lines.at(-2), `FAIL: here is checked out in the main checkout ${repo.root}, not in a piece worktree → git -C ${q(repo.root)} switch main, then run it again`);
    assert.equal(h.code, 1);
    assert.ok(existsSync(repo.root), "the main checkout is still there");
    assert.ok(repo.localBranches().includes("here"));
    g(repo.root, "switch", "-q", "main");

    // Started from inside the piece's own worktree (the script lives there): it cannot remove the folder it runs from.
    const piece = repo.addPiece("self");
    repo.githubMerge("self");
    const s = await world.run(TOOL, ["--root", piece, "self"], { env: { FAKE_GH_LOG: repo.ghLog } });
    assert.equal(s.lines.at(-2), `FAIL: self is the worktree this run was started from (${piece}), which cannot remove itself → run it from the main checkout: node tools/agent/done-piece.mjs ${q("self")} --root ${q(repo.root)}`);
    assert.equal(s.code, 1);
    assertUntouched(repo, "self", piece);

    const u = await finish(repo, ["nothing-like-it"]);
    assert.equal(u.lines.at(-2), "FAIL: no worktree and no local branch called nothing-like-it → check the name with: git worktree list");
    assert.equal(u.code, 1);

    for (const bad of ["-x", "a..b", "has space"]) {
      const b = await finish(repo, ["--", bad]);
      assert.equal(b.lines[0], `FAIL: "${bad}" is not a branch name git accepts → pass the piece's branch name`, bad);
      assert.equal(b.code, 1);
    }
  });

  it("Main (a case variant of main) is refused and main survives, on any file system", async () => {
    const repo = world.makeRepo();
    const before = g(repo.root, "rev-parse", "main");
    const r = await finish(repo, ["Main"]);
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.ok(r.lines.some((l) => l.startsWith("FAIL: ")), r.lines.join("\n"));
    assert.equal(r.code, 1);
    assert.ok(repo.localBranches().includes("main"), "local main survives");
    assert.equal(g(repo.root, "rev-parse", "main"), before);
    assert.ok(repo.remoteBranches().includes("main"));
    assert.equal(g(repo.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  });

  it("a case variant of a piece's branch is refused, naming the real one, and nothing is deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("foo", { file: true });
    repo.githubMerge("foo");
    const r = await finish(repo, ["Foo"]);
    assert.equal(r.lines.at(-2), "FAIL: there is no branch called Foo; the close match is foo → pass the name exactly: node tools/agent/done-piece.mjs 'foo'");
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertUntouched(repo, "foo", folder);
    assert.ok(!r.lines.some((l) => l.startsWith("OK removed") || l.startsWith("OK deleted")), r.lines.join("\n"));
    const exact = await finish(repo, ["foo"]);
    assert.equal(exact.code, 0, exact.lines.join("\n"));
  });

  it("an ignored file that is not on the expected list (an ignored PR_BODY.md, a local .claude/) blocks the run, and the worktree stays", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("keepme", { file: true, claim: 18805 });
    repo.githubMerge("keepme");
    const exclude = join(repo.root, ".git", "info", "exclude");
    writeFileSync(exclude, readFileSync(exclude, "utf8") + "PR_BODY.md\n.claude/\n");
    writeFileSync(join(folder, "PR_BODY.md"), "my text\n");
    mkdirSync(join(folder, ".claude"));
    writeFileSync(join(folder, ".claude", "notes.md"), "notes\n");
    writeFileSync(join(folder, "keep.log"), "log\n"); // expected: not listed
    const r = await finish(repo, ["keepme"]);
    assert.equal(r.lines.at(-2), `FAIL: 2 ignored item(s) in ${folder} are not on the expected list and would be lost: .claude/, PR_BODY.md → move them out or delete them, then run it again`);
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(r.code, 1);
    assertUntouched(repo, "keepme", folder);
    assert.equal(readFileSync(join(folder, "PR_BODY.md"), "utf8"), "my text\n");
    // Out of the way, it goes.
    rmSync(join(folder, "PR_BODY.md"));
    rmSync(join(folder, ".claude"), { recursive: true });
    const again = await finish(repo, ["keepme"]);
    assert.equal(again.code, 0, again.lines.join("\n"));
    assert.equal(existsSync(folder), false);
  });

  it("build/, .DS_Store at any depth and node_modules at any depth are expected ignored items: they go with the worktree", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("tidy", { file: true, push: false });
    for (const d of ["mcp", "src/deep"]) { mkdirSync(join(folder, d), { recursive: true }); writeFileSync(join(folder, d, "keep.txt"), "tracked\n"); } // tracked files, so these folders are not "new" ones
    g(folder, "add", "."); g(folder, "commit", "-q", "-m", "folders"); g(folder, "push", "-q", "origin", "tidy");
    repo.githubMerge("tidy");
    const exclude = join(repo.root, ".git", "info", "exclude");
    writeFileSync(exclude, readFileSync(exclude, "utf8") + "build/\n.DS_Store\n");
    mkdirSync(join(folder, "build"));
    writeFileSync(join(folder, "build", "intermediate.js"), "x\n");
    writeFileSync(join(folder, ".DS_Store"), "x\n");
    mkdirSync(join(folder, "mcp", "node_modules"));
    writeFileSync(join(folder, "mcp", "node_modules", "dep.js"), "x\n");
    writeFileSync(join(folder, "src", "deep", ".DS_Store"), "x\n");
    const r = await finish(repo, ["tidy"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(existsSync(folder), false);
    assert.ok(!repo.localBranches().includes("tidy"));
  });

  it("lookalikes are still refused: builds/, a deep src/build/, .DS_Store.bak, a .DS_Store folder and my_node_modules/", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("lookalike", { file: true, push: false });
    mkdirSync(join(folder, "src")); writeFileSync(join(folder, "src", "keep.txt"), "tracked\n"); // tracked, so src/ is not a "new" folder
    g(folder, "add", "."); g(folder, "commit", "-q", "-m", "src"); g(folder, "push", "-q", "origin", "lookalike");
    repo.githubMerge("lookalike");
    const exclude = join(repo.root, ".git", "info", "exclude");
    writeFileSync(exclude, readFileSync(exclude, "utf8") + "builds/\nsrc/build/\n.DS_Store.bak\n.DS_Store/\nmy_node_modules/\n");
    mkdirSync(join(folder, "builds"));
    writeFileSync(join(folder, "builds", "a.txt"), "x\n");
    writeFileSync(join(folder, ".DS_Store.bak"), "x\n");
    mkdirSync(join(folder, "my_node_modules"));
    writeFileSync(join(folder, "my_node_modules", "a.txt"), "x\n");
    mkdirSync(join(folder, "src", "build")); // build/ is expected only at the top
    writeFileSync(join(folder, "src", "build", "a.txt"), "x\n");
    mkdirSync(join(folder, ".DS_Store")); // a folder, not the file
    writeFileSync(join(folder, ".DS_Store", "a.txt"), "x\n");
    const r = await finish(repo, ["lookalike"]);
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.match(r.lines.at(-2), /^FAIL: 5 ignored item\(s\) /);
    for (const name of [".DS_Store.bak", ".DS_Store/", "builds/", "my_node_modules/", "src/build/"]) assert.ok(r.lines.at(-2).includes(name), `${name} is named: ${r.lines.at(-2)}`);
    assertUntouched(repo, "lookalike", folder);
  });

  it("a branch whose worktree was already removed by hand is cleaned up as a branch", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("orphan");
    repo.githubMerge("orphan");
    g(repo.root, "worktree", "remove", "--force", folder);
    const r = await finish(repo, ["orphan"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes("SKIP worktree (none for orphan; cleaning up the branch only)"));
    assert.ok(!repo.localBranches().includes("orphan"));
    assert.ok(!repo.remoteBranches().includes("orphan"));
    assert.equal(r.lines.at(-1), "done-piece: OK orphan");
    // Unmerged, it is still refused.
    const keep = repo.addPiece("orphan2");
    g(repo.root, "worktree", "remove", "--force", keep);
    const k = await finish(repo, ["orphan2"]);
    assert.equal(k.code, 1);
    assert.ok(repo.localBranches().includes("orphan2"));
  });

  it("a worktree folder deleted by hand (git still lists it) is pruned and the branch cleaned up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("rmrf");
    repo.githubMerge("rmrf");
    rmSync(folder, { recursive: true, force: true });
    const r = await finish(repo, ["rmrf"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.ok(r.lines.includes(`SKIP worktree ${folder} (the folder is gone; only git's record of it is left)`));
    assert.ok(r.lines.includes(`OK pruned the record of the missing worktree ${folder}`));
    assert.ok(r.lines.includes("OK deleted local branch rmrf"));
    assert.ok(!repo.remoteBranches().includes("rmrf"));
    assert.equal(g(repo.root, "worktree", "list", "--porcelain").includes(folder), false);
    // An unmerged branch whose folder is gone is still refused, and its record stays.
    const lost = repo.addPiece("lost");
    rmSync(lost, { recursive: true, force: true });
    const l = await finish(repo, ["lost"]);
    assert.equal(l.code, 1);
    assert.ok(repo.localBranches().includes("lost"));
  });

  it("a git that cannot tell the worktree's status is a FAIL, not a clean worktree (real corrupt index and a failing git)", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("corrupt", { file: true });
    repo.githubMerge("corrupt");
    writeFileSync(join(folder, "corrupt.txt"), "an edit to a tracked file\n");
    writeFileSync(join(g(folder, "rev-parse", "--absolute-git-dir"), "index"), "garbage");
    const r = await finish(repo, ["corrupt"]);
    assert.match(r.lines.at(-2), new RegExp(`^FAIL: git status failed in ${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .* → fix that worktree \\(git -C .* status\\), then run it again$`));
    assert.equal(r.code, 1);
    assertUntouched(repo, "corrupt", folder);
    assert.equal(readFileSync(join(folder, "corrupt.txt"), "utf8"), "an edit to a tracked file\n");

    const repo2 = world.makeRepo();
    const folder2 = repo2.addPiece("blind");
    repo2.githubMerge("blind");
    const s = await finish(repo2, ["blind"], { env: world.shimEnv({ SHIM_FAIL: "status", SHIM_CWD: folder2 }) });
    assert.equal(s.lines.at(-2), `FAIL: git status failed in ${folder2}: simulated failure of git status → fix that worktree (git -C ${q(folder2)} status), then run it again`);
    assert.equal(s.code, 1);
    assertUntouched(repo2, "blind", folder2);
  });

  it("a git that cannot list the worktree's new files (or its ignored ones) is a FAIL, and so is one that cannot list the worktrees", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("nolist");
    repo.githubMerge("nolist");
    for (const call of ["ls-files --others --exclude-standard", "ls-files --others --ignored"]) { // the two ls-files calls, one at a time
      const r = await finish(repo, ["nolist"], { env: world.shimEnv({ SHIM_FAIL: call, SHIM_CWD: folder }) });
      assert.equal(r.lines.at(-2), `FAIL: git ls-files failed in ${folder}: simulated failure of git ${call} → fix that worktree (git -C ${q(folder)} status), then run it again`, call);
      assert.equal(r.code, 1);
      assertUntouched(repo, "nolist", folder);
    }
    const w = await finish(repo, ["nolist"], { env: world.shimEnv({ SHIM_FAIL: "worktree list" }) });
    assert.equal(w.lines.at(-2), `FAIL: git worktree list failed in ${repo.root} → fix the repo (git -C ${q(repo.root)} worktree list), then run it again`);
    assert.equal(w.code, 1);
    assertUntouched(repo, "nolist", folder);
  });

  it("a git that cannot ask origin for the remote branch is a FAIL, the remote branch is kept, and the rest is cleaned up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("noask");
    repo.githubMerge("noask");
    const r = await finish(repo, ["noask"], { env: world.shimEnv({ SHIM_FAIL: "ls-remote" }) });
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.includes(`FAIL: could not ask origin about noask: simulated failure of git ls-remote → git -C ${q(repo.root)} push origin --delete ${q("noask")} once origin answers`), r.lines.join("\n"));
    assert.ok(repo.remoteBranches().includes("noask"));
    assert.equal(existsSync(folder), false);
    assert.ok(!repo.localBranches().includes("noask"));
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
  });

  it("a git that cannot tell the main checkout's status is a FAIL at the fast-forward, after the clean-up", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("rootblind");
    repo.githubMerge("rootblind");
    const r = await finish(repo, ["rootblind"], { env: world.shimEnv({ SHIM_FAIL: "status", SHIM_CWD: repo.root }) });
    assert.equal(r.code, 1, r.lines.join("\n"));
    assert.ok(r.lines.includes(`FAIL: git status failed in ${repo.root}: simulated failure of git status → fix the main checkout (git -C ${q(repo.root)} status), then: git -C ${q(repo.root)} pull --ff-only origin main`));
    assert.equal(r.lines.at(-1), "done-piece: 1 problem(s)");
    assert.equal(existsSync(folder), false);
    assert.ok(!repo.localBranches().includes("rootblind"));
  });

  it("a locked worktree is refused with the command that unlocks it, and nothing is deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("locked");
    repo.githubMerge("locked");
    g(repo.root, "worktree", "lock", "--reason", "on a USB stick", folder);
    const r = await finish(repo, ["locked"]);
    assert.match(r.lines.at(-2), /^FAIL: git worktree remove failed: cannot remove a locked working tree.* → git -C .* worktree unlock .*, then run it again$/);
    assert.ok(r.lines.at(-2).endsWith(`→ git -C ${q(repo.root)} worktree unlock ${q(folder)}, then run it again`));
    assert.equal(r.code, 1);
    assertUntouched(repo, "locked", folder);
    g(repo.root, "worktree", "unlock", folder);
    assert.equal((await finish(repo, ["locked"])).code, 0, "and it goes once unlocked");
  });

  it("a branch with a slash goes, and a piece with a similar name is untouched", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("feature/deep");
    repo.githubMerge("feature/deep");
    const other = repo.addPiece("feature-deep-2", { commit: false, push: false });
    const r = await finish(repo, ["feature/deep"]);
    assert.equal(r.code, 0, r.lines.join("\n"));
    assert.equal(existsSync(folder), false);
    assert.ok(existsSync(other), "another piece with a similar name is untouched");
    assert.ok(repo.localBranches().includes("feature-deep-2"));
    assert.ok(!repo.remoteBranches().includes("feature/deep"));
  });

  it("a folder that is not a git repo, or not the top of one, is refused", async () => {
    const plain = join(world.scratch, "plain");
    mkdirSync(plain);
    const r = await world.run(TOOL, ["--root", plain, "x"]);
    assert.deepEqual(r.lines, [`FAIL: ${plain} is not a git repo → run it from the main checkout or pass --root <repo>`, "done-piece: 1 problem(s)"]);
    assert.equal(r.code, 1);
    const repo = world.makeRepo();
    const inside = join(repo.root, "inner");
    mkdirSync(inside);
    const s = await world.run(TOOL, ["--root", inside, "x"]);
    assert.equal(s.lines[0], `FAIL: ${inside} is inside a repo but is not its top folder → pass --root ${q(repo.root)}`);
    assert.equal(s.code, 1);
  });

  it("a failed fetch is a FAIL before anything is deleted", async () => {
    const repo = world.makeRepo();
    const folder = repo.addPiece("nofetch");
    g(repo.root, "remote", "set-url", "origin", join(repo.dir, "does-not-exist.git"));
    const r = await finish(repo, ["nofetch"]);
    assert.match(r.lines.at(-2), /^FAIL: git fetch origin failed: .* → check the network and the origin remote, then run it again$/);
    assert.equal(r.code, 1);
    assert.ok(existsSync(folder));
    assert.ok(repo.localBranches().includes("nofetch"));
  });

  it("--help prints the usage and exits 0; bad command lines exit 2 with the usage on stderr", async () => {
    const h = await world.run(TOOL, ["--help"]);
    assert.equal(h.code, 0);
    assert.match(h.lines[0], /^usage: node tools\/agent\/done-piece\.mjs <branch> \[--root <repo>\] \[--keep-remote\]/);
    for (const args of [[], ["a", "b"], ["--nope", "a"], ["--root"]]) {
      const r = await world.run(TOOL, args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /usage: node tools\/agent\/done-piece\.mjs/);
      assert.equal(r.lines.join(""), "");
    }
  });

  it("the tool never starts a shell or runs through a string: it uses spawnSync with argument lists only", () => {
    assert.doesNotMatch(readFileSync(TOOL, "utf8"), /execSync|exec\(|shell:\s*true/);
  });
});
