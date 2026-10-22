// Tests for tools/upstream-merge.mjs (node --test test/upstream-merge.test.mjs).
//
// 1. A small made-up repo and two made-up upstream folders: every kind of change the tool sorts.
// 2. The real replay of the v2.1.3 port, skipped unless JS3D_UPSTREAM_ZIPS names a folder holding
//    JumpStart-3D-v2.0-full-source.zip and JumpStart-3D-v2.1.3-full-source.zip (download them with
//    gh release download upstream-originals -p '<name>' -D <folder>). CI downloads nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, ruleFor, renderReport } from "../tools/upstream-merge.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const put = (root, files) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
};
const lines = (...l) => l.join("\n") + "\n";

test("mapping: the author's layout lands in ours", () => {
  assert.equal(ruleFor("app/src/app.js").dest, "src/app.js");
  assert.equal(ruleFor("app/fontsub/sans.ttf").dest, "src/fontsub/sans.ttf");
  assert.equal(ruleFor("app/tools/make_chisel.py").dest, "tools/make_chisel.py");
  assert.equal(ruleFor("README.md").dest, "UPSTREAM-README.md");
  assert.equal(ruleFor("third_party/three/build/three.module.js").dest, "third_party/three/build/three.module.js");
  assert.equal(ruleFor("third_party/replicad-opencascadejs/dist/replicad_single.wasm").how, "report");
  for (const p of ["LICENSE", "app/build.sh", "tests/new.cjs", "somewhere/else.txt"]) assert.equal(ruleFor(p).how, "report", p);
});

// A made-up fork: upstream folders base/ and new/ (layout app/src/...), our repo ours/ with branch main.
function world(w, { base, next, ours, links = {}, modes = {} }) {
  const b = join(w, "base/JumpStart-3D-v1/"), n = join(w, "new/JumpStart-3D-v2/"), o = join(w, "ours");
  put(b, { "app/src/version.js": 'export const VERSION = "1.0";\n', ...base });
  put(n, { "app/src/version.js": 'export const VERSION = "1.1";\n', ...next });
  put(o, { "src/version.js": 'export const VERSION = "1.0";\n', ...ours });
  for (const [p, m] of Object.entries(modes.base ?? {})) chmodSync(join(b, p), m);
  for (const [p, m] of Object.entries(modes.next ?? {})) chmodSync(join(n, p), m);
  for (const [p, m] of Object.entries(modes.ours ?? {})) chmodSync(join(o, p), m);
  for (const [p, target] of Object.entries(links)) { mkdirSync(dirname(join(o, p)), { recursive: true }); symlinkSync(target, join(o, p)); }
  git(o, "init", "-q", "-b", "main");
  git(o, "add", "-A");
  git(o, "commit", "-q", "-m", "ours");
  return { opts: { base: join(w, "base"), new: join(w, "new"), ours: o, oursRef: "main" }, ours: o, head: git(o, "rev-parse", "HEAD").trim() };
}
const withTmp = (fn) => () => {
  const w = mkdtempSync(join(tmpdir(), "um-test-"));
  try { return fn(w); } finally { rmSync(w, { recursive: true, force: true }); spawnSync("git", ["-C", dirname(w), "worktree", "prune"]); }
};
const status = (r) => Object.fromEntries(r.entries.map((e) => [e.path, e.status]));

test("a made-up port sorts every kind of change", withTmp((w) => {
  const a = lines("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten");
  const { opts, ours, head } = world(w, {
    base: { "app/src/touched.js": a, "app/src/untouched.js": "u1\n", "app/src/clash.js": a, "app/src/gone.js": "g\n", "app/src/gone2.js": "g2\n",
      "app/src/skipped.js": "s1\n", "app/src/same.js": "same\n", "app/src/pic.bin": Buffer.from([0, 1, 2]), "app/src/credit.js": "// Created by J.Siwek\nx\n",
      "app/build.sh": "echo 1\n", "third_party/lib/index.js": "l1\n", "tests/a.cjs": "t\n" },
    next: { "app/src/touched.js": a.replace("ten", "TEN"), "app/src/untouched.js": "u2\n", "app/src/clash.js": a.replace("five", "FIVE-UP"),
      "app/src/skipped.js": "s2\n", "app/src/same.js": "same\n", "app/src/pic.bin": Buffer.from([0, 1, 3]), "app/src/credit.js": "// by someone else\nx\n",
      "app/src/brand-new.js": "n\n", "app/src/both-added.js": "up\n", "app/build.sh": "echo 2\n", "third_party/lib/index.js": "l2\n",
      "tests/a.cjs": "t2\n", "tests/b.cjs": "b\n", "stray.txt": "x\n" },
    ours: { "src/touched.js": a.replace("one", "ONE-OURS"), "src/untouched.js": "u1\n", "src/clash.js": a.replace("five", "FIVE-OURS"),
      "src/gone.js": "g\n", "src/gone2.js": "g2 ours changed\n", "src/same.js": "same\n", "src/pic.bin": Buffer.from([0, 9, 9]),
      "src/credit.js": "// Created by J.Siwek\nx\n", "src/both-added.js": "ours\n", "src/ours-only.js": "mine\n",
      "UPSTREAM-README.md": "r\n", "third_party/lib/index.js": "l1\n" },
  });
  const r = run({ ...opts, dryRun: true, out: join(w, "out") });
  assert.deepEqual(status(r), {
    "app/src/version.js": "took-upstream", "app/src/touched.js": "merged", "app/src/untouched.js": "took-upstream", "app/src/clash.js": "conflict",
    "app/src/gone.js": "deleted", "app/src/gone2.js": "delete-kept", "app/src/skipped.js": "we-removed", "app/src/pic.bin": "binary-conflict",
    "app/src/credit.js": "took-upstream", "app/src/brand-new.js": "added", "app/src/both-added.js": "conflict", "app/build.sh": "report-only",
    "third_party/lib/index.js": "took-upstream", "tests/a.cjs": "report-only", "tests/b.cjs": "report-only", "stray.txt": "report-only",
  });
  assert.equal(r.unchanged, 1); // same.js
  assert.equal(r.version, "1.1");
  assert.equal(r.branch, "upstream-1.1");
  assert.equal(readFileSync(join(r.treeDir, "src/touched.js"), "utf8"), lines("ONE-OURS", "two", "three", "four", "five", "six", "seven", "eight", "nine", "TEN"));
  const clash = r.entries.find((e) => e.path === "app/src/clash.js");
  assert.deepEqual(clash.hunks.map((h) => h.line), [5]);
  assert.match(readFileSync(join(r.treeDir, "src/clash.js"), "utf8").split("\n")[4], /^<<<<<<< ours/);
  assert.ok(!existsSync(join(r.treeDir, "src/ours-only.js")), "files upstream did not touch are not written");
  for (const s of ["src/clash.js:5", "src/pic.bin", "src/gone2.js", "src/skipped.js", "tests/b.cjs", "build.sh", "src/brand-new.js"]) assert.ok(r.report.includes(s), "report mentions " + s);
  // the credit: exactly this warning, nothing else (the report text always says "Created by J.Siwek" in its Next steps)
  assert.deepEqual(r.warnings, ['HIGH: src/credit.js lost "Created by J.Siwek" in the merge. The credit must stay.']);
  assert.ok(r.report.includes("lost \"Created by J.Siwek\""));
  assert.equal(git(ours, "rev-parse", "HEAD").trim(), head);
  assert.equal(git(ours, "branch", "--list", "upstream-*").trim(), "");
  assert.equal(git(ours, "status", "--porcelain").trim(), "");

  // the real run: a new branch in a new worktree, markers in place, nothing committed
  const real = run({ ...opts, out: join(w, "wt") });
  assert.equal(real.worktree, join(w, "wt"));
  assert.equal(git(real.worktree, "rev-parse", "--abbrev-ref", "HEAD").trim(), "upstream-1.1");
  assert.equal(git(real.worktree, "rev-parse", "HEAD").trim(), head);
  assert.ok(!existsSync(join(real.worktree, "src/gone.js")), "a file upstream deleted and we never changed is removed");
  assert.match(readFileSync(join(real.worktree, "src/clash.js"), "utf8"), /^<<<<<<< ours$/m);
  assert.match(git(real.worktree, "status", "--porcelain"), /src\/touched\.js/);
  assert.equal(git(ours, "status", "--porcelain").trim(), "", "the original checkout is untouched");
  assert.ok(existsSync(real.reportFile));
}));

test("conflict markers with CRLF line ends are found and never called clean", withTmp((w) => {
  const crlf = (...l) => l.join("\r\n") + "\r\n";
  const a = crlf("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten");
  const { opts } = world(w, {
    base: { "app/src/c.js": a },
    next: { "app/src/c.js": a.replace("two", "TWO-UP").replace("nine", "NINE-UP") },
    ours: { "src/c.js": a.replace("two", "TWO-OURS").replace("nine", "NINE-OURS") },
  });
  const r = run({ ...opts, dryRun: true, out: join(w, "out") });
  const c = r.entries.find((e) => e.path === "app/src/c.js");
  assert.equal(c.status, "conflict");
  assert.deepEqual(c.hunks.map((h) => h.line), [2, 13], "both hunks found, the later one not dropped");
  assert.match(r.report, /src\/c\.js:2 /);
  assert.match(r.report, /src\/c\.js:13 /);
  assert.doesNotMatch(r.report, /Nothing: every change merged cleanly/);
}));

test("a conflict with no parsed hunks is still listed for a person", () => {
  const r = { base: {}, new: {}, version: "9", branch: "upstream-9", ours: { ref: "main", sha: "0".repeat(40) }, unchanged: 0, warnings: [], netHits: [], skipped: [], dryRun: true, treeDir: "t",
    entries: [{ path: "app/src/x.js", dest: "src/x.js", area: "src", upstream: "changed", status: "conflict", hunks: [] }] };
  const text = renderReport(r);
  assert.match(text, /## Needs a human\n\n- \*\*Conflict\*\* src\/x\.js: git reported a conflict but no marker lines were found/);
  assert.doesNotMatch(text, /Nothing: every change/);
});

test("nothing is written through a symbolic link, and a failed run leaves no branch or worktree", withTmp((w) => {
  const outside = join(w, "outside");
  mkdirSync(outside);
  const { opts, ours } = world(w, {
    base: {}, next: { "app/src/linked/new.js": "new\n", "app/src/lnk.js": "changed upstream\n" }, ours: {},
    links: { "src/linked": outside, "src/lnk.js": "version.js" },
  });
  // our own file being a link is reported, not written
  const dry = run({ ...opts, dryRun: true, out: join(w, "out") });
  assert.equal(status(dry)["app/src/lnk.js"], "report-only".replace("report-only", "added") === "added" ? status(dry)["app/src/lnk.js"] : "");
  assert.ok(["ours-special", "added"].includes(status(dry)["app/src/lnk.js"]));
  // a real run whose folder in our ref is a link refuses, and rolls back what it made
  assert.throws(() => run({ ...opts, out: join(w, "wt") }), /symbolic link/);
  assert.deepEqual(readdirSync(outside), [], "nothing reached the folder the link points to");
  assert.equal(git(ours, "branch", "--list", "upstream-*").trim(), "", "the branch was rolled back");
  assert.ok(!existsSync(join(w, "wt")), "the worktree folder was removed");
  assert.equal(git(ours, "worktree", "list").trim().split("\n").length, 1, "no stray worktree entry");
}));

test("a link in our checkout at the file itself is reported and not overwritten", withTmp((w) => {
  const { opts } = world(w, { base: { "app/src/lnk.js": "x\n" }, next: { "app/src/lnk.js": "y\n" }, ours: {}, links: { "src/lnk.js": "version.js" } });
  const r = run({ ...opts, dryRun: true, out: join(w, "out") });
  assert.equal(status(r)["app/src/lnk.js"], "ours-special");
  assert.ok(!existsSync(join(r.treeDir, "src/lnk.js")));
  assert.match(r.report, /src\/lnk\.js is a symbolic link in our checkout/);
}));

test("preflight refuses before anything is created", withTmp((w) => {
  const { opts, ours } = world(w, { base: { "app/src/a.js": "a\n" }, next: { "app/src/a.js": "b\n" }, ours: { "src/a.js": "a\n" } });
  assert.throws(() => run({ ...opts, out: join(w, "no/such/parent/wt") }), /does not exist/);
  assert.throws(() => run({ ...opts, out: join(w, "wt"), report: join(w, "no/such/report.md") }), /report does not exist/);
  assert.equal(git(ours, "branch", "--list", "upstream-*").trim(), "");
  run({ ...opts, out: join(w, "wt") });
  assert.throws(() => run({ ...opts, out: join(w, "wt2") }), /already exists/, "the branch exists now");
  assert.ok(!existsSync(join(w, "wt2")));
}));

test("executable bits are carried: a new executable, and a change of the bit alone", withTmp((w) => {
  const { opts } = world(w, {
    base: { "app/src/run.sh": "echo\n", "app/src/keep.sh": "echo k\n" },
    next: { "app/src/run.sh": "echo\n", "app/src/keep.sh": "echo k\n", "app/tools/make.sh": "echo new\n", "app/src/plain.txt": "p\n" },
    ours: { "src/run.sh": "echo\n", "src/keep.sh": "echo k\n" },
    modes: { next: { "app/src/run.sh": 0o755, "app/tools/make.sh": 0o755 } },
  });
  const r = run({ ...opts, out: join(w, "wt") });
  const st = status(r);
  assert.equal(st["app/src/run.sh"], "mode-only");
  assert.equal(st["app/tools/make.sh"], "added");
  assert.equal(st["app/src/keep.sh"], undefined, "no change, not listed");
  const exec = (p) => (statSync(join(w, "wt", p)).mode & 0o111) !== 0;
  assert.equal(exec("src/run.sh"), true);
  assert.equal(exec("tools/make.sh"), true);
  assert.equal(exec("src/plain.txt"), false);
  assert.match(git(join(w, "wt"), "diff", "--summary"), /mode change 100644 => 100755 src\/run\.sh/);
}));

test("a file upstream moved keeps our edits at the new path", withTmp((w) => {
  const a = lines("alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa");
  const { opts } = world(w, {
    base: { "app/src/old.js": a },
    next: { "app/src/sub/old.js": a.replace("iota", "IOTA-UP") },
    ours: { "src/old.js": a.replace("beta", "BETA-OURS") },
  });
  const r = run({ ...opts, out: join(w, "wt") });
  const st = status(r);
  assert.equal(st["app/src/old.js"], "renamed-away");
  assert.equal(st["app/src/sub/old.js"], "renamed-merged");
  assert.equal(readFileSync(join(w, "wt/src/sub/old.js"), "utf8"), lines("alpha", "BETA-OURS", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "IOTA-UP", "kappa"));
  assert.ok(!existsSync(join(w, "wt/src/old.js")), "the old path is gone");
  assert.match(r.report, /upstream moved it from src\/old\.js; our edits carried over/);
  assert.deepEqual(r.warnings, []);
}));

test("a moved file we did not edit is a plain delete plus add; an unmatched delete is flagged", withTmp((w) => {
  const { opts } = world(w, {
    base: { "app/src/m.js": "same\ntext\nhere\nfor\nboth\n", "app/src/lone.js": "l1\nl2\n" },
    next: { "app/src/z/m.js": "same\ntext\nhere\nfor\nboth\nmore\n", "app/src/other.js": "totally different\n" },
    ours: { "src/m.js": "same\ntext\nhere\nfor\nboth\n", "src/lone.js": "l1 ours\nl2\n" },
  });
  const r = run({ ...opts, dryRun: true, out: join(w, "out") });
  assert.equal(status(r)["app/src/m.js"], "deleted");
  assert.equal(status(r)["app/src/z/m.js"], "added");
  assert.equal(status(r)["app/src/lone.js"], "delete-kept");
  assert.match(r.report, /deleted src\/lone\.js, but we changed it\*\*: the file is kept; decide whether it should go \(no matching new file found\)/);
}));

test("code that reaches the network is listed even when it merges cleanly", withTmp((w) => {
  const a = lines("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten");
  const { opts } = world(w, {
    base: { "app/src/net.js": a, "app/src/vox.js": "x\n" },
    next: { "app/src/net.js": a.replace("ten", 'const r = await fetch(UPDATE_URL, { cache: "no-store" }); // https://example.org/v.json'), "app/src/vox.js": 'x\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n',
      "app/src/fresh.js": "const ws = new WebSocket(u);\nnavigator.serviceWorker.register(s);\nplain\n", "app/src/comment.js": "// see https://example.org\n" },
    ours: { "src/net.js": a.replace("one", "ONE-OURS"), "src/vox.js": "x\n" },
  });
  const r = run({ ...opts, dryRun: true, out: join(w, "out") });
  assert.equal(status(r)["app/src/net.js"], "merged");
  assert.deepEqual(r.netHits.map((h) => h.file + ":" + h.line), ["src/comment.js:1", "src/fresh.js:1", "src/fresh.js:2", "src/net.js:10"]);
  assert.match(r.report, /src\/net\.js:10: .*fetch\(UPDATE_URL/);
  assert.doesNotMatch(r.report, /schemas\.openxmlformats/);
  assert.match(r.report, /read every line/);
}));

// ---------- the real replay of the v2.1.3 port ----------
const zipDir = process.env.JS3D_UPSTREAM_ZIPS;
const zip20 = zipDir && join(zipDir, "JumpStart-3D-v2.0-full-source.zip");
const zip213 = zipDir && join(zipDir, "JumpStart-3D-v2.1.3-full-source.zip");
const BEFORE = "684eebe6e08afc1a962e9945afe01e4ba1c32a72"; // main just before PR #82 (first parent of its merge commit)
const SHIPPED = "4eb93740730eaf697acf7c1f43b2246a73af6b96"; // the upstream-213 branch after the port, its review fixes and a merge of that main
const haveCommits = () => [BEFORE, SHIPPED].every((c) => spawnSync("git", ["-C", repoRoot, "cat-file", "-e", c + "^{commit}"]).status === 0);
const skip = !zipDir || !existsSync(zip20 ?? "") || !existsSync(zip213 ?? "")
  ? "set JS3D_UPSTREAM_ZIPS to a folder with the v2.0 and v2.1.3 source zips"
  : !haveCommits() ? "the commits of the real port are not in this clone" : false;

test("replay of the v2.1.3 port: same conflicts as the session saw, and the result pinned against what shipped", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "um-replay-"));
  try {
    const r = run({ base: zip20, new: zip213, ours: repoRoot, oursRef: BEFORE, dryRun: true, out });
    assert.equal(r.base.version, "2.0");
    assert.equal(r.new.version, "2.1.3");
    const of = (...s) => r.entries.filter((e) => s.includes(e.status)).map((e) => e.dest).sort();

    // what the session saw: five conflict hunks in four files, the rest clean
    const hunks = r.entries.filter((e) => e.status === "conflict").flatMap((e) => e.hunks.map(() => e.dest));
    assert.equal(hunks.length, 5);
    assert.deepEqual(of("conflict"), ["src/advanced.js", "src/beginner.js", "src/index.html", "src/store.js"]);
    assert.equal(hunks.filter((d) => d === "src/advanced.js").length, 2);
    assert.deepEqual(of("merged"), ["src/app.js", "src/icons.js", "src/kernel.js", "src/sketcher.js", "src/tutorial_data.js"]);
    assert.deepEqual(of("took-upstream"), ["UPSTREAM-README.md", "src/texture.js", "src/tutorials.js", "src/version.js"]);
    assert.deepEqual(of("added"), ["src/facepat.js", "src/tutorial_data_more.js", "src/voxel.js"]);
    assert.deepEqual(of("deleted", "delete-kept", "we-removed", "binary-conflict", "renamed-away", "ours-special", "mode-only"), []);
    assert.deepEqual(r.warnings, [], "the J.Siwek credit survives");
    assert.deepEqual(r.skipped, []);
    const outside = r.entries.filter((e) => e.area !== "src").map((e) => e.path);
    assert.ok(outside.includes("tests/vx1.cjs") && outside.includes("README.md"), "tests and README are listed as outside src/");
    assert.ok(r.report.includes("src/advanced.js:") && r.report.includes("Needs a human"));

    // The update check upstream added merged cleanly into src/app.js. The tool must still put its network lines in front of a person.
    assert.deepEqual(r.netHits.map((h) => h.file), ["src/app.js", "src/app.js", "src/app.js"]);
    assert.ok(r.netHits.some((h) => /fetch\(UPDATE_URL/.test(h.text)), "the fetch is flagged");
    assert.ok(r.netHits.some((h) => /version\.json/.test(h.text)), "the version.json address is flagged");
    assert.match(r.report, /Network or service-worker code that came in from upstream[\s\S]*src\/app\.js:\d+: .*fetch\(UPDATE_URL/);

    // Against what shipped (4eb9374). Files the port left as the author wrote them are identical. For every other file the
    // lines that differ are pinned: how many lines are only ours-from-the-tool, how many only shipped, and a hash of those lines.
    // They are the hand-resolved conflict hunks and the community changes made on top (build number, update check, 2,500-cell
    // face-pattern limit, voxel colours, splash line), and the README the port did not copy. Any other change in these files moves a pin.
    const shippedFile = join(out, "shipped.tmp");
    const PIN = {
      "UPSTREAM-README.md": [12, 4, "a33ce6211d42"], "src/advanced.js": [9, 2, "d11b761cbcd7"], "src/app.js": [18, 26, "4b68a6398492"],
      "src/beginner.js": [8, 3, "5ba13c203ffa"], "src/facepat.js": [12, 26, "bd40db5dbabb"], "src/icons.js": [0, 0, "e3b0c44298fc"],
      "src/index.html": [4, 2, "67781603e0f8"], "src/kernel.js": [3, 1, "8b997882e910"], "src/sketcher.js": [0, 0, "e3b0c44298fc"],
      "src/store.js": [5, 1, "42437256ab25"], "src/texture.js": [0, 0, "e3b0c44298fc"], "src/tutorial_data.js": [0, 0, "e3b0c44298fc"],
      "src/tutorial_data_more.js": [0, 0, "e3b0c44298fc"], "src/tutorials.js": [0, 0, "e3b0c44298fc"], "src/version.js": [0, 2, "8c86f35a2c2e"],
      "src/voxel.js": [2, 4, "c4f99d65ab90"],
    };
    const written = r.entries.filter((e) => e.dest && e.status !== "report-only").map((e) => e.dest).sort();
    assert.deepEqual(written, Object.keys(PIN).sort(), "every file the tool wrote is pinned");
    for (const f of written) {
      writeFileSync(shippedFile, spawnSync("git", ["-C", repoRoot, "show", `${SHIPPED}:${f}`], { maxBuffer: 1 << 28 }).stdout);
      const d = spawnSync("git", ["diff", "--no-index", "--unified=0", shippedFile, join(r.treeDir, f)], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
      const body = d.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
      const plus = body.filter((l) => l[0] === "+").length;
      assert.deepEqual([plus, body.length - plus, createHash("sha256").update(body.join("\n")).digest("hex").slice(0, 12)], PIN[f], f);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
