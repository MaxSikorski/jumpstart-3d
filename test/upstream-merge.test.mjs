// Tests for tools/upstream-merge.mjs (node --test test/upstream-merge.test.mjs).
//
// 1. A small made-up repo and two made-up upstream folders: every kind of change the tool sorts.
// 2. The real replay of the v2.1.3 port, skipped unless JS3D_UPSTREAM_ZIPS names a folder holding
//    JumpStart-3D-v2.0-full-source.zip and JumpStart-3D-v2.1.3-full-source.zip (download them with
//    gh release download upstream-originals -p '<name>' -D <folder>). CI downloads nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, ruleFor } from "../tools/upstream-merge.mjs";

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

test("a made-up port sorts every kind of change", () => {
  const w = mkdtempSync(join(tmpdir(), "um-test-"));
  try {
    const base = join(w, "base/JumpStart-3D-v1/"), next = join(w, "new/JumpStart-3D-v2/"), ours = join(w, "ours");
    const a = lines("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten");
    put(base, {
      "app/src/version.js": 'export const VERSION = "1.0";\n',
      "app/src/touched.js": a, "app/src/untouched.js": "u1\n", "app/src/clash.js": a, "app/src/gone.js": "g\n", "app/src/gone2.js": "g2\n",
      "app/src/skipped.js": "s1\n", "app/src/same.js": "same\n", "app/src/pic.bin": Buffer.from([0, 1, 2]), "app/src/credit.js": "// Created by J.Siwek\nx\n",
      "app/build.sh": "echo 1\n", "third_party/lib/index.js": "l1\n", "tests/a.cjs": "t\n",
    });
    put(next, {
      "app/src/version.js": 'export const VERSION = "1.1";\n',
      "app/src/touched.js": a.replace("ten", "TEN"), "app/src/untouched.js": "u2\n", "app/src/clash.js": a.replace("five", "FIVE-UP"),
      "app/src/skipped.js": "s2\n", "app/src/same.js": "same\n", "app/src/pic.bin": Buffer.from([0, 1, 3]), "app/src/credit.js": "// by someone else\nx\n",
      "app/src/brand-new.js": "n\n", "app/src/both-added.js": "up\n", "app/build.sh": "echo 2\n", "third_party/lib/index.js": "l2\n",
      "tests/a.cjs": "t2\n", "tests/b.cjs": "b\n", "stray.txt": "x\n",
    });
    put(ours, {
      "src/version.js": 'export const VERSION = "1.0";\n',
      "src/touched.js": a.replace("one", "ONE-OURS"), "src/untouched.js": "u1\n", "src/clash.js": a.replace("five", "FIVE-OURS"),
      "src/gone.js": "g\n", "src/gone2.js": "g2 ours changed\n", "src/same.js": "same\n", "src/pic.bin": Buffer.from([0, 9, 9]),
      "src/credit.js": "// Created by J.Siwek\nx\n", "src/both-added.js": "ours\n", "src/ours-only.js": "mine\n",
      "UPSTREAM-README.md": "r\n", "third_party/lib/index.js": "l1\n",
    });
    git(ours, "init", "-q", "-b", "main");
    git(ours, "add", "-A");
    git(ours, "commit", "-q", "-m", "ours");
    const head = git(ours, "rev-parse", "HEAD").trim();

    const r = run({ base: join(w, "base"), new: join(w, "new"), ours, oursRef: "main", dryRun: true, out: join(w, "out") });
    const st = Object.fromEntries(r.entries.map((e) => [e.path, e.status]));
    assert.deepEqual(st, {
      "app/src/version.js": "took-upstream", "app/src/touched.js": "merged", "app/src/untouched.js": "took-upstream", "app/src/clash.js": "conflict",
      "app/src/gone.js": "deleted", "app/src/gone2.js": "delete-kept", "app/src/skipped.js": "we-removed", "app/src/pic.bin": "binary-conflict",
      "app/src/credit.js": "took-upstream", "app/src/brand-new.js": "added", "app/src/both-added.js": "conflict", "app/build.sh": "report-only",
      "third_party/lib/index.js": "took-upstream", "tests/a.cjs": "report-only", "tests/b.cjs": "report-only", "stray.txt": "report-only",
    });
    assert.equal(r.unchanged, 1); // same.js
    assert.equal(r.version, "1.1");
    assert.equal(r.branch, "upstream-1.1");
    // the merge keeps both sides' edits; a conflict is marked with the file's own line number
    assert.equal(readFileSync(join(r.treeDir, "src/touched.js"), "utf8"), lines("ONE-OURS", "two", "three", "four", "five", "six", "seven", "eight", "nine", "TEN"));
    const clash = r.entries.find((e) => e.path === "app/src/clash.js");
    assert.deepEqual(clash.hunks.map((h) => h.line), [5]);
    assert.match(readFileSync(join(r.treeDir, "src/clash.js"), "utf8").split("\n")[4], /^<<<<<<< ours/);
    assert.ok(!existsSync(join(r.treeDir, "src/ours-only.js")), "files upstream did not touch are not written");
    // the report says the things a person has to do
    for (const s of ["src/clash.js:5", "src/pic.bin", "src/gone2.js", "src/skipped.js", "Created by J.Siwek", "tests/b.cjs", "build.sh", "src/brand-new.js"]) assert.ok(r.report.includes(s), "report mentions " + s);
    // a dry run leaves the repository alone
    assert.equal(git(ours, "rev-parse", "HEAD").trim(), head);
    assert.equal(git(ours, "branch", "--list", "upstream-*").trim(), "");
    assert.equal(git(ours, "status", "--porcelain").trim(), "");

    // the real run: a new branch in a new worktree, markers in place, nothing committed
    const real = run({ base: join(w, "base"), new: join(w, "new"), ours, oursRef: "main", out: join(w, "wt") });
    assert.equal(real.worktree, join(w, "wt"));
    assert.equal(git(real.worktree, "rev-parse", "--abbrev-ref", "HEAD").trim(), "upstream-1.1");
    assert.equal(git(real.worktree, "rev-parse", "HEAD").trim(), head);
    assert.ok(!existsSync(join(real.worktree, "src/gone.js")), "a file upstream deleted and we never changed is removed");
    assert.match(readFileSync(join(real.worktree, "src/clash.js"), "utf8"), /^<<<<<<< ours$/m);
    assert.match(git(real.worktree, "status", "--porcelain"), /src\/touched\.js/);
    assert.equal(git(ours, "status", "--porcelain").trim(), "", "the original checkout is untouched");
    assert.ok(existsSync(real.reportFile));
    assert.throws(() => run({ base: join(w, "base"), new: join(w, "new"), ours, oursRef: "main", out: join(w, "wt2") }), /already exists|already/, "branch exists");
  } finally {
    rmSync(w, { recursive: true, force: true });
    spawnSync("git", ["-C", w, "worktree", "prune"]);
  }
});

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

test("replay of the v2.1.3 port matches what the session saw and what shipped", { skip }, () => {
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
    assert.deepEqual(of("deleted", "delete-kept", "we-removed", "binary-conflict"), []);
    assert.deepEqual(r.warnings, [], "the J.Siwek credit and our markers survive");
    const outside = r.entries.filter((e) => e.area !== "src").map((e) => e.path);
    assert.ok(outside.includes("tests/vx1.cjs") && outside.includes("README.md"), "tests and README are listed as outside src/");
    assert.ok(r.report.includes("src/advanced.js:") && r.report.includes("Needs a human"));

    // against what shipped: files the port left as the author wrote them are identical ...
    const shipped = (f) => spawnSync("git", ["-C", repoRoot, "show", `${SHIPPED}:${f}`], { encoding: "buffer", maxBuffer: 1 << 28 }).stdout;
    const mine = (f) => readFileSync(join(r.treeDir, f));
    const identical = (f) => Buffer.compare(mine(f), shipped(f)) === 0;
    for (const f of ["src/icons.js", "src/sketcher.js", "src/tutorial_data.js", "src/tutorial_data_more.js", "src/tutorials.js", "src/texture.js"]) assert.ok(identical(f), f + " is identical to what shipped");
    // ... and the rest differ only where the session added its own work: the four hand-resolved files, the community changes
    // (build number, update check, face-pattern limit, voxel colours) and the README the port did not copy.
    const different = r.entries.filter((e) => e.result === undefined && e.dest && !identical(e.dest)).map((e) => e.dest).sort();
    assert.deepEqual(different, ["UPSTREAM-README.md", "src/advanced.js", "src/app.js", "src/beginner.js", "src/facepat.js", "src/index.html", "src/kernel.js", "src/store.js", "src/version.js", "src/voxel.js"]);
    // In the four conflict files, every line outside the conflict hunks is in the shipped file, in order
    // (the one exception is index.html's splash version line, a community edit).
    const missing = (f) => {
      const hunkLines = new Set();
      for (const h of r.entries.find((e) => e.dest === f).hunks) for (let i = h.line; i <= h.endLine; i++) hunkLines.add(i);
      const sh = shipped(f).toString("utf8").split("\n");
      let at = 0, miss = 0;
      mine(f).toString("utf8").split("\n").forEach((l, i) => {
        if (hunkLines.has(i + 1)) return;
        const k = sh.indexOf(l, at);
        if (k < 0) miss++; else at = k + 1;
      });
      return miss;
    };
    assert.deepEqual(["src/advanced.js", "src/beginner.js", "src/store.js"].map(missing), [0, 0, 0]);
    assert.equal(missing("src/index.html"), 1); // the splash line "Version 2.1.3", which the port changed to add the build number
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
