#!/usr/bin/env node
// Bring a new JumpStart 3D source release from J.Siwek into this fork.
//
//   node tools/upstream-merge.mjs --base <last-ported source> --new <new source> [options]
//
//   --base <zip|folder>   the upstream source we last ported (e.g. the v2.0 zip)
//   --new  <zip|folder>   the new upstream source (e.g. the v2.1.3 zip)
//   --ours <checkout>     our checkout (default: the current folder)
//   --ours-ref <ref>      the commit to merge into (default: main)
//   --version <x.y.z>     the new version, for the branch name (default: read from the new source)
//   --out <folder>        where the merged tree goes (default: next to the checkout; a temp folder with --dry-run)
//   --dry-run             touch no branch or worktree: write only the changed files and the report to a temp folder
//   --report <file>       also write the report here
//
// What it does: maps the author's file layout onto ours (MAPPING below, the one
// place), then three-way merges each changed file with `git merge-file`
// (base = last upstream, ours = our file at --ours-ref, theirs = new upstream).
// Without --dry-run it creates branch upstream-<version> from --ours-ref in a new
// worktree and writes the result there, conflict markers included. It never
// commits or pushes. The report (Markdown, plain English) says what to do next.
// Zips are unpacked with the system `unzip` into a temp folder and read as data;
// nothing from them is ever run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The author's zip layout -> ours. First matching rule wins.
//   from: exact file, or a folder when it ends in "/"; match: a regexp on the upstream path.
//   to: our path or folder (null = nothing of ours corresponds); how: "merge" or "report" (list only, change nothing).
export const MAPPING = [
  { match: /\.wasm$/, to: null, how: "report", area: "third_party",
    note: "The OpenCascade kernel changed. Our src/occt-gz.wasm is the gzip of that file (gzip -9 -n); rebuild it, rebuild docs/ and run the golden suite." },
  { from: "app/src/", to: "src/", how: "merge", area: "src" },
  { from: "app/fontsub/", to: "src/fontsub/", how: "merge", area: "src" },
  { from: "app/tools/", to: "tools/", how: "merge", area: "helpers",
    note: "Helper-page sources changed: regenerate src/flexigen.html, src/meshstep.html and src/chisel.html as tools/README-helpers.md says." },
  { from: "third_party/", to: "third_party/", how: "merge", area: "third_party",
    note: "A bundled library changed: check the licence files, THIRD-PARTY-NOTICES.md and the golden suite." },
  { from: "LICENSES/", to: "LICENSES/", how: "merge", area: "licences", note: "Licence texts changed: compare with NOTICE.md and THIRD-PARTY-NOTICES.md." },
  { from: "THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md", how: "merge", area: "licences", note: "Third-party notices changed." },
  { from: "README.md", to: "UPSTREAM-README.md", how: "merge", area: "docs", note: "The author's README changed; UPSTREAM-README.md follows it." },
  { from: "LICENSE", to: null, how: "report", area: "licences", note: "The author's LICENSE changed. Ours covers repo tooling only: read NOTICE.md and decide by hand." },
  { from: "app/build.sh", to: null, how: "report", area: "build", note: "The author's build scripts changed; ours is build.mjs. Port any real change by hand." },
  { from: "app/dist.sh", to: null, how: "report", area: "build", note: "The author's build scripts changed; ours is build.mjs. Port any real change by hand." },
  { from: "app/standalone.py", to: null, how: "report", area: "build", note: "The author's build scripts changed; ours is build.mjs. Port any real change by hand." },
  { from: "app/package.json", to: null, how: "report", area: "build", note: "The author's package.json changed; check the pinned esbuild in ours." },
  { from: "app/test/", to: null, how: "report", area: "tests", note: "The author's debug scripts: not part of our test/ folder." },
  { from: "tests/", to: null, how: "report", area: "tests", note: "The author's own test scripts: not ported; the new ones show what he now covers, worth a look for new Playwright cases." },
  { match: /./, to: null, how: "report", area: "other", note: "Not in our layout: look at it by hand." },
];

const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|\._[^/]*)(\/|$)/;
const HELPER_PAGES = new Set(["app/src/chisel.html", "app/src/flexigen.html", "app/src/meshstep.html"]);

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

export function ruleFor(path) {
  for (const r of MAPPING) {
    if (r.match ? r.match.test(path) : r.from.endsWith("/") ? path.startsWith(r.from) : path === r.from) {
      const to = r.to === null ? null : r.from.endsWith("/") ? r.to + path.slice(r.from.length) : r.to;
      return { ...r, dest: to };
    }
  }
  throw new Error("no mapping rule for " + path);
}

// ---------- reading an upstream source (zip or folder) ----------
function findRoot(dir) {
  const has = (d) => existsSync(join(d, "app", "src", "version.js")) || existsSync(join(d, "app", "src"));
  if (has(dir)) return dir;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !IGNORE.test(e.name) && has(join(dir, e.name))) return join(dir, e.name);
  }
  throw new Error(`${dir} does not look like a JumpStart 3D source (no app/src inside)`);
}

function walk(root) {
  const files = new Map();
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (IGNORE.test(r)) continue;
      const st = lstatSync(join(root, r));
      if (st.isDirectory()) rec(r);
      else if (st.isFile()) files.set(r, join(root, r)); // symlinks and other oddities are skipped
    }
  };
  rec("");
  return files;
}

function openSource(input, scratch, label) {
  const p = resolve(input);
  if (!existsSync(p)) throw new Error(`${label} not found: ${p}`);
  let dir = p;
  if (lstatSync(p).isFile()) {
    dir = mkdtempSync(join(scratch, label + "-"));
    const r = spawnSync("unzip", ["-q", "-o", p, "-d", dir, "-x", "__MACOSX/*", "*/.DS_Store"], { encoding: "utf8" });
    if (r.status !== 0 && r.status !== 1) throw new Error(`could not unzip ${p}: ${r.stderr || r.error}`); // 1 = warnings only
  }
  const root = findRoot(dir);
  const files = walk(root);
  let version = null;
  const v = files.get("app/src/version.js");
  if (v) version = /VERSION\s*=\s*["']([^"']+)["']/.exec(readFileSync(v, "utf8"))?.[1] ?? null;
  version ??= /(\d+\.\d+(?:\.\d+)*)/.exec(basename(p))?.[1] ?? null;
  return { files, version, read: (rel) => (files.has(rel) ? readFileSync(files.get(rel)) : null) };
}

// ---------- reading our checkout at a commit ----------
function git(cwd, args, opts = {}) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: opts.binary ? "buffer" : "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(" ")} failed: ${String(r.stderr || r.error).trim()}`);
  return r;
}

function oursReader(checkout, ref) {
  return (path) => {
    const r = git(checkout, ["cat-file", "blob", `${ref}:${path}`], { binary: true, allowFail: true });
    return r.status === 0 ? r.stdout : null;
  };
}

// ---------- the three-way merge of one file ----------
function mergeFile(scratch, oursBuf, baseBuf, theirsBuf, theirsLabel) {
  const d = mkdtempSync(join(scratch, "m-"));
  const f = { o: join(d, "ours"), b: join(d, "base"), t: join(d, "theirs") };
  writeFileSync(f.o, oursBuf);
  writeFileSync(f.b, baseBuf);
  writeFileSync(f.t, theirsBuf);
  const r = spawnSync("git", ["-c", "merge.conflictStyle=merge", "merge-file", "-p", "-L", "ours", "-L", "base", "-L", theirsLabel, f.o, f.b, f.t],
    { maxBuffer: 1 << 30 });
  rmSync(d, { recursive: true, force: true });
  if (r.status === null || r.status < 0 || r.status === 255) throw new Error("git merge-file failed: " + r.stderr);
  return { merged: r.stdout, clean: r.status === 0 };
}

// Conflict hunks as they sit in the merged file: line numbers and a peek at each side.
function hunksOf(buf) {
  const lines = buf.toString("utf8").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< ")) continue;
    let mid = -1, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (mid < 0 && lines[j] === "=======") mid = j;
      else if (lines[j].startsWith(">>>>>>> ")) { end = j; break; }
    }
    if (end < 0 || mid < 0) break;
    const peek = (k, n) => (n ? lines[k].trim().slice(0, 80) : "(nothing: this side removed the lines)");
    out.push({ line: i + 1, endLine: end + 1, oursLines: mid - i - 1, theirLines: end - mid - 1, oursPeek: peek(i + 1, mid - i - 1), theirPeek: peek(mid + 1, end - mid - 1) });
    i = end;
  }
  return out;
}

const count = (buf, needle) => (buf.toString("utf8").match(new RegExp(needle, "g")) ?? []).length;

// ---------- the run ----------
export function run(opts) {
  const scratch = mkdtempSync(join(tmpdir(), "upstream-merge-scratch-"));
  try {
    return runIn(scratch, opts);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runIn(scratch, opts) {
  const checkout = resolve(opts.ours ?? process.cwd());
  const topLevel = git(checkout, ["rev-parse", "--show-toplevel"]).stdout.trim();
  const refName = opts.oursRef ?? "main";
  const oursSha = git(checkout, ["rev-parse", "--verify", refName + "^{commit}"]).stdout.trim();
  const readOurs = oursReader(checkout, oursSha);

  const base = openSource(opts.base, scratch, "base");
  const next = openSource(opts.new, scratch, "new");
  const version = opts.version ?? next.version;
  if (!version) throw new Error("cannot tell the new version; pass --version");
  if (!/^[0-9A-Za-z._-]+$/.test(version)) throw new Error("odd version text: " + version);
  const branch = "upstream-" + version;

  const paths = [...new Set([...base.files.keys(), ...next.files.keys()])].sort();
  const entries = [];
  let unchanged = 0;
  for (const p of paths) {
    const b = base.read(p), n = next.read(p);
    if (same(b, n)) { unchanged++; continue; }
    const rule = ruleFor(p);
    const e = { path: p, dest: rule.dest, area: rule.area, how: rule.how, note: rule.note, baseSha: b && sha(b).slice(0, 10), newSha: n && sha(n).slice(0, 10), upstream: b === null ? "added" : n === null ? "deleted" : "changed" };
    if (rule.how === "report") {
      e.status = "report-only";
    } else {
      const o = readOurs(rule.dest);
      decide(e, o, b, n, scratch, "upstream-" + version);
    }
    entries.push(e);
  }

  // checks across the merged result
  const warnings = [];
  const credit = git(checkout, ["grep", "-l", "-F", "Created by J.Siwek", oursSha, "--", "src"], { allowFail: true }).stdout
    ?.split("\n").filter(Boolean).map((l) => l.slice(oursSha.length + 1)) ?? [];
  for (const e of entries) {
    if (e.dest && credit.includes(e.dest) && e.result && !e.result.includes("Created by J.Siwek")) {
      warnings.push(`HIGH: ${e.dest} lost "Created by J.Siwek" in the merge. The credit must stay.`);
    }
    if (e.status === "merged" || e.status === "conflict") {
      const before = count(readOurs(e.dest), "jumpstart-3d"), after = count(e.result, "jumpstart-3d");
      if (after < before) warnings.push(`${e.dest} has fewer "jumpstart-3d" markers after the merge (${before} -> ${after}): one of our additions may be gone.`);
    }
    if (e.status === "deleted" || e.status === "delete-kept") {
      if (credit.includes(e.dest)) warnings.push(`HIGH: upstream deleted ${e.dest}, which holds the J.Siwek credit.`);
    }
  }

  const res = { base: { version: base.version }, new: { version: next.version }, version, branch, ours: { ref: refName, sha: oursSha, checkout: topLevel },
    unchanged, entries, warnings, dryRun: !!opts.dryRun };

  // ---------- write the result ----------
  if (opts.dryRun) {
    const out = resolve(opts.out ?? mkdtempSync(join(tmpdir(), "upstream-merge-")));
    mkdirSync(out, { recursive: true });
    res.treeDir = join(out, "tree");
    for (const e of entries) {
      if (e.result) {
        const f = join(res.treeDir, e.dest);
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, e.result);
      }
    }
    res.outDir = out;
  } else {
    const wt = resolve(opts.out ?? join(dirname(topLevel), basename(topLevel) + "-" + branch));
    if (existsSync(wt)) throw new Error("the worktree folder already exists: " + wt);
    git(topLevel, ["worktree", "add", "--no-track", "-b", branch, wt, oursSha]);
    for (const e of entries) {
      if (e.result) {
        const f = join(wt, e.dest);
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, e.result);
      } else if (e.status === "deleted") {
        rmSync(join(wt, e.dest), { force: true });
      }
    }
    res.worktree = wt;
  }
  res.report = renderReport(res);
  const reportFile = opts.report ?? (opts.dryRun ? join(res.outDir, "report.md") : join(dirname(res.worktree), branch + "-report.md"));
  writeFileSync(reportFile, res.report);
  res.reportFile = reportFile;
  for (const e of entries) delete e.result; // keep the returned object small
  return res;
}

// One file: decide what happens, set e.status and (when a file is to be written) e.result.
function decide(e, o, b, n, scratch, theirsLabel) {
  if (b === null) { // new upstream file
    if (o === null) { e.status = "added"; e.result = n; return; }
    if (same(o, n)) { e.status = "already-identical"; return; }
    if (isBinary(o) || isBinary(n)) { e.status = "binary-conflict"; return; }
    const m = mergeFile(scratch, o, Buffer.alloc(0), n, theirsLabel);
    e.status = "conflict"; e.result = m.merged; e.hunks = hunksOf(m.merged); e.bothAdded = true; return;
  }
  if (n === null) { // deleted upstream
    if (o === null) { e.status = "already-identical"; return; }
    e.status = same(o, b) ? "deleted" : "delete-kept";
    return;
  }
  if (o === null) { e.status = "we-removed"; return; } // changed upstream, but we do not have the file
  if (same(o, n)) { e.status = "already-identical"; return; }
  if (same(o, b)) { e.status = "took-upstream"; e.result = n; return; } // we never touched it
  if (isBinary(o) || isBinary(b) || isBinary(n)) { e.status = "binary-conflict"; return; }
  const m = mergeFile(scratch, o, b, n, theirsLabel);
  if (m.clean) { e.status = "merged"; e.result = m.merged; return; }
  e.status = "conflict"; e.result = m.merged; e.hunks = hunksOf(m.merged);
}

// ---------- the report ----------
function renderReport(r) {
  const by = (...s) => r.entries.filter((e) => s.includes(e.status));
  const conflicts = by("conflict");
  const L = [];
  const where = r.dryRun ? `dry run: merged files are in ${r.treeDir}` : `merged tree: ${r.worktree} (branch ${r.branch}, nothing committed)`;
  L.push(`# Upstream merge report: JumpStart 3D ${r.base.version ?? "?"} to ${r.new.version ?? r.version}`, "");
  L.push(`- Merged into: ${r.ours.ref} at ${r.ours.sha.slice(0, 10)}`, `- ${where}`);
  L.push(`- Files the author left alone: ${r.unchanged}. Files he changed, added or deleted: ${r.entries.length}.`, "");

  L.push("## Needs a human", "");
  const todo = [];
  for (const e of conflicts) {
    for (const h of e.hunks) todo.push(`- **Conflict** ${e.dest}:${h.line} (to line ${h.endLine}): ours ${h.oursLines} lines, upstream ${h.theirLines} lines. Ours starts \`${h.oursPeek}\`; upstream starts \`${h.theirPeek}\`. ${e.bothAdded ? "Both sides added this file." : "Keep both sides' changes where they do different things."}`);
  }
  for (const e of by("binary-conflict")) todo.push(`- **Binary file changed on both sides** ${e.dest}: ours kept; pick one by hand.`);
  for (const e of by("delete-kept")) todo.push(`- **Upstream deleted ${e.dest}, but we changed it**: the file is kept; decide whether it should go.`);
  for (const e of by("we-removed")) todo.push(`- **Upstream changed ${e.path}, but we have no ${e.dest}** (we removed or moved it): skipped; check whether the change matters.`);
  for (const w of r.warnings) todo.push("- " + w);
  const outside = r.entries.filter((e) => e.area !== "src");
  const notes = new Map();
  for (const e of outside) if (e.note) notes.set(e.note, [...(notes.get(e.note) ?? []), e.path]);
  for (const [note, files] of notes) todo.push(`- **Outside src/**: ${note} (${files.join(", ")})`);
  if (r.entries.some((e) => HELPER_PAGES.has(e.path))) todo.push("- **Helper pages**: upstream's built src/{flexigen,meshstep,chisel}.html changed, but ours are rebuilt from tools/*-source.html with our changes. Regenerate them from the merged sources (tools/README-helpers.md) instead of trusting a text merge.");
  if (r.entries.some((e) => e.path === "app/src/version.js")) todo.push("- **Version**: src/version.js follows upstream; keep our BUILD line and the version text in src/index.html's splash, and check the About dialog.");
  L.push(todo.length ? todo.join("\n") : "Nothing: every change merged cleanly and nothing sits outside src/.", "");

  const list = (title, es, fmt) => {
    L.push(`## ${title} (${es.length})`, "");
    L.push(es.length ? es.map(fmt).join("\n") : "None.", "");
  };
  list("Changed upstream, merged cleanly with our changes", by("merged"), (e) => `- ${e.dest}`);
  list("Changed upstream, we never touched the file (took his version)", by("took-upstream"), (e) => `- ${e.dest}`);
  list("Conflicts", conflicts, (e) => `- ${e.dest}: ${e.hunks.length} hunk(s) at line ${e.hunks.map((h) => h.line).join(", ")}`);
  list("New upstream files", by("added", "already-identical").filter((e) => e.upstream === "added"), (e) => `- ${e.dest ?? e.path}${e.status === "already-identical" ? " (we already have this exact file)" : ""}`);
  list("Deleted upstream", by("deleted", "delete-kept").concat(r.entries.filter((e) => e.upstream === "deleted" && e.status === "report-only")), (e) => `- ${e.dest ?? e.path}${e.status === "delete-kept" ? " (kept: we changed it)" : e.status === "report-only" ? " (outside src/, not touched)" : " (removed in the merged tree)"}`);
  list("Outside src/ (listed, needs a look)", outside, (e) => `- ${e.path} (${e.upstream}${e.status === "report-only" ? "; left untouched" : "; " + e.status.replace(/-/g, " ")}${e.dest ? " in " + e.dest : ""})`);

  L.push("## Next", "");
  L.push("1. Resolve every conflict marker (`<<<<<<< ours` to `>>>>>>> " + r.branch + "`), keeping both sides' changes where they do different things.",
    "2. Re-apply our marked hooks if the warnings above name a lost one; set the version text and BUILD; keep \"Created by J.Siwek\".",
    "3. `node build.mjs`, `npm test` on both builds, `npm run test:update` only for an intended geometry change.",
    "4. Commit on the branch and open the PR (REVIEW.md: upstream merges are checked for the author's changes and our additions).", "");
  return L.join("\n");
}

// ---------- command line ----------
function parseArgs(argv) {
  const o = {};
  const key = { "--base": "base", "--new": "new", "--ours": "ours", "--ours-ref": "oursRef", "--version": "version", "--out": "out", "--report": "report" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (key[a]) o[key[a]] = argv[++i];
    else throw new Error("unknown argument " + a);
  }
  if (!o.base || !o.new) throw new Error("--base and --new are required (see the header of tools/upstream-merge.mjs)");
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const r = run(parseArgs(process.argv.slice(2)));
    console.log(r.report);
    console.log(`\nReport file: ${r.reportFile}`);
  } catch (e) {
    console.error("upstream-merge: " + e.message);
    process.exit(2);
  }
}
