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
// It refuses to write through a symbolic link, keeps executable bits, follows a
// file upstream moved (our edits carry to the new path), lists any network code
// that came in from upstream, and removes its branch and worktree if it fails.
// Zips are unpacked with the system `unzip` into a temp folder and read as data;
// nothing from them is ever run.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    note: "A bundled library changed: check the licence files, THIRD-PARTY-NOTICES.md and the golden suite. third_party/ is not scanned for network code." },
  { from: "LICENSES/", to: "LICENSES/", how: "merge", area: "licences", note: "Licence texts changed: compare with NOTICE.md and THIRD-PARTY-NOTICES.md." },
  { from: "THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md", how: "merge", area: "licences", note: "Third-party notices changed." },
  { from: "README.md", to: "UPSTREAM-README.md", how: "merge", area: "docs", note: "The author's README changed; UPSTREAM-README.md follows it." },
  { from: "LICENSE", to: null, how: "report", area: "licences", note: "The author's LICENSE changed. His is MIT and is kept in LICENSES/MIT-jumpstart-3d-jsiwek.txt; ours is AGPL-3.0: read NOTICE.md and decide by hand." },
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
// Code from upstream that reaches the network or the service worker is always listed for a person.
const XML_NAMESPACE = /https?:\/\/(schemas\.openxmlformats\.org|schemas\.microsoft\.com|www\.w3\.org|purl\.org|www\.opengis\.net)[^\s"'<>]*/g; // names, not requests
const NETWORK = /\bfetch\s*(\?\.)?\s*\(|XMLHttpRequest|WebSocket|sendBeacon|serviceWorker|importScripts|EventSource|\bnew\s+(Shared)?Worker\s*\(|\bimport\s*\(|["'`]\/\/[\w.-]+\.\w|\bwindow\.open\s*\(|\blocation\.href\s*=|https?:\/\//;

const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
const textLines = (buf) => buf.toString("utf8").split("\n").map((l) => l.replace(/\r$/, ""));

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
  const has = (d) => existsSync(join(d, "app", "src"));
  if (has(dir)) return dir;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !IGNORE.test(e.name) && has(join(dir, e.name))) return join(dir, e.name);
  }
  throw new Error(`${dir} does not look like a JumpStart 3D source (no app/src inside)`);
}

function walk(root) {
  const files = new Map(), skipped = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (IGNORE.test(r)) continue;
      const st = lstatSync(join(root, r));
      if (st.isDirectory()) rec(r);
      else if (st.isFile()) files.set(r, { abs: join(root, r), exec: (st.mode & 0o111) !== 0 });
      else skipped.push(r + (st.isSymbolicLink() ? " (a symbolic link)" : " (not a plain file)")); // never followed
    }
  };
  rec("");
  return { files, skipped };
}

function openSource(input, scratch, label) {
  const p = resolve(input);
  if (!existsSync(p)) throw new Error(`${label} not found: ${p}`);
  let dir = p;
  const notes = [];
  if (lstatSync(p).isFile()) {
    dir = mkdtempSync(join(scratch, label + "-"));
    const r = spawnSync("unzip", ["-q", "-o", p, "-d", dir, "-x", "__MACOSX/*", "*/.DS_Store"], { encoding: "utf8" });
    if (r.status !== 0 && r.status !== 1) throw new Error(`could not unzip ${p}: ${r.stderr || r.error}`); // 1 = warnings only
    for (const l of (r.stderr ?? "").split("\n").filter((x) => x && !/excluded filename not matched/.test(x))) notes.push(`${label} zip: ${l.trim()}`);
  }
  const root = findRoot(dir);
  const { files, skipped } = walk(root);
  let version = null;
  const v = files.get("app/src/version.js");
  if (v) version = /VERSION\s*=\s*["']([^"']+)["']/.exec(readFileSync(v.abs, "utf8"))?.[1] ?? null;
  version ??= /(\d+\.\d+(?:\.\d+)*)/.exec(basename(p))?.[1] ?? null;
  for (const s of skipped) notes.push(`${label} source: skipped ${s}`);
  return { files, version, notes, read: (rel) => (files.has(rel) ? readFileSync(files.get(rel).abs) : null), exec: (rel) => files.get(rel)?.exec ?? null };
}

// ---------- reading our checkout at a commit ----------
function git(cwd, args, opts = {}) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: opts.binary ? "buffer" : "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(" ")} failed: ${String(r.stderr || r.error).trim()}`);
  return r;
}

// Our file at the commit: { buf, exec } for a plain file, { special } for a symlink or submodule, null when absent.
function oursReader(checkout, ref) {
  return (path) => {
    const t = git(checkout, ["ls-tree", "-z", ref, "--", path], { allowFail: true }).stdout;
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(t || "");
    if (!m) return null;
    if (m[2] !== "blob" || m[1] === "120000") return { special: m[1] === "120000" ? "a symbolic link" : "not a plain file" };
    return { buf: git(checkout, ["cat-file", "blob", m[3]], { binary: true }).stdout, exec: m[1] === "100755" };
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

// Conflict hunks as they sit in the merged file: line numbers and a peek at each side. Files with CRLF line ends have
// markers ending in \r; an incomplete marker is skipped, never the rest of the file.
function hunksOf(buf) {
  const lines = textLines(buf);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< ")) continue;
    let mid = -1, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (mid < 0 && lines[j] === "=======") mid = j;
      else if (lines[j].startsWith(">>>>>>> ")) { end = j; break; }
    }
    if (end < 0 || mid < 0) continue;
    const peek = (k, n) => (n ? lines[k].trim().slice(0, 80) : "(nothing: this side removed the lines)");
    out.push({ line: i + 1, endLine: end + 1, oursLines: mid - i - 1, theirLines: end - mid - 1, oursPeek: peek(i + 1, mid - i - 1), theirPeek: peek(mid + 1, end - mid - 1) });
    i = end;
  }
  return out;
}

// Lines upstream added in this file (a real line diff, base to new; every line of a new file) that reach the network,
// found in the merged result. Each added line is matched once.
function networkHits(e, scratch) {
  if (!e.result || !(e.area === "src" || e.area === "helpers") || isBinary(e.result)) return [];
  const f = { b: join(scratch, "net-base"), n: join(scratch, "net-new") };
  writeFileSync(f.b, e._b ?? Buffer.alloc(0));
  writeFileSync(f.n, e._n);
  const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--unified=0", f.b, f.n], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout ?? "";
  const added = new Map();
  for (const l of diff.split("\n")) {
    if (l[0] !== "+" || l.startsWith("+++")) continue;
    const t = l.slice(1).replace(/\r$/, "");
    added.set(t, (added.get(t) ?? 0) + 1);
  }
  const hits = [];
  textLines(e.result).forEach((l, i) => {
    const t = l.replace(XML_NAMESPACE, "");
    const m = NETWORK.exec(t);
    if (m && added.get(l) > 0) { added.set(l, added.get(l) - 1); hits.push({ file: e.dest, line: i + 1, text: t.slice(Math.max(0, m.index - 30), m.index + 80).trim() }); }
  });
  return hits;
}

// ---------- writing safely ----------
// A destination is built from a fixed prefix and a relative path from the zip, then checked: no "..", and no
// symbolic link anywhere on the way (a link in our checkout must never carry a write outside the tree).
function safePath(root, rel) {
  if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) throw new Error("refusing an odd path: " + rel);
  let p = root;
  for (const seg of rel.split("/")) {
    p = join(p, seg);
    let st;
    try { st = lstatSync(p); } catch { break; } // not there yet: nothing further to check
    if (st.isSymbolicLink()) throw new Error(`refusing to write through a symbolic link: ${rel} (at ${p.slice(root.length + 1)})`);
  }
  return join(root, rel);
}
function writeOut(root, rel, data, exec) {
  const f = safePath(root, rel);
  mkdirSync(dirname(f), { recursive: true });
  safePath(root, rel); // again, now the folders exist
  writeFileSync(f, data);
  if (exec !== undefined) chmodSync(f, exec ? 0o755 : 0o644);
}

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

  // preflight: everything that can be refused is refused before anything is created
  let wt = null, outDir = null;
  if (opts.dryRun) {
    outDir = resolve(opts.out ?? mkdtempSync(join(tmpdir(), "upstream-merge-")));
  } else {
    wt = resolve(opts.out ?? join(dirname(topLevel), basename(topLevel) + "-" + branch));
    if (existsSync(wt)) throw new Error("the worktree folder already exists: " + wt);
    if (!existsSync(dirname(wt))) throw new Error("the folder for the worktree does not exist: " + dirname(wt));
    if (git(topLevel, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch], { allowFail: true }).status === 0) throw new Error(`branch ${branch} already exists`);
  }
  const reportFile = opts.report ?? (opts.dryRun ? join(outDir, "report.md") : join(dirname(wt), branch + "-report.md"));
  if (!existsSync(dirname(reportFile)) && !(opts.dryRun && dirname(reportFile) === outDir)) throw new Error("the folder for the report does not exist: " + dirname(reportFile));

  const paths = [...new Set([...base.files.keys(), ...next.files.keys()])].sort();
  const entries = [];
  let unchanged = 0;
  for (const p of paths) {
    const b = base.read(p), n = next.read(p), execB = base.exec(p), execN = next.exec(p);
    if (same(b, n) && execB === execN) { unchanged++; continue; }
    const rule = ruleFor(p);
    const e = { path: p, dest: rule.dest, area: rule.area, note: rule.note, upstream: b === null ? "added" : n === null ? "deleted" : "changed", _b: b, _n: n };
    if (rule.how === "report") {
      e.status = "report-only";
    } else {
      const oi = readOurs(rule.dest);
      if (oi?.special) { e.status = "ours-special"; e.special = oi.special; }
      else { e._o = oi?.buf ?? null; decide(e, oi, execB, execN, scratch, branch); }
    }
    entries.push(e);
  }
  pairRenames(entries, scratch, branch);

  // checks across the merged result
  const warnings = [];
  const credit = git(checkout, ["grep", "-l", "-F", "Created by J.Siwek", oursSha, "--", "src"], { allowFail: true }).stdout
    ?.split("\n").filter(Boolean).map((l) => l.slice(oursSha.length + 1)) ?? [];
  for (const e of entries) {
    if (e.dest && credit.includes(e.dest) && e.result && !e.result.includes("Created by J.Siwek")) {
      warnings.push(`HIGH: ${e.dest} lost "Created by J.Siwek" in the merge. The credit must stay.`);
    }
    if ((e.status === "deleted" || e.status === "delete-kept" || e.status === "renamed-away") && credit.includes(e.dest)) {
      warnings.push(`HIGH: upstream deleted or moved ${e.dest}, which holds the J.Siwek credit.`);
    }
  }
  const netHits = entries.flatMap((e) => networkHits(e, scratch));

  const res = { base: { version: base.version }, new: { version: next.version }, version, branch, ours: { ref: refName, sha: oursSha, checkout: topLevel },
    unchanged, entries, warnings, netHits, skipped: [...base.notes, ...next.notes], dryRun: !!opts.dryRun, reportFile };
  if (opts.dryRun) { res.outDir = outDir; res.treeDir = join(outDir, "tree"); } else res.worktree = wt;
  res.report = renderReport(res);

  // ---------- write the result ----------
  const apply = (root) => {
    for (const e of entries) {
      if (e.result) writeOut(root, e.dest, e.result, e.exec);
      else if (e.status === "deleted" || e.status === "renamed-away") rmSync(safePath(root, e.dest), { force: true });
    }
  };
  if (opts.dryRun) {
    mkdirSync(outDir, { recursive: true });
    apply(res.treeDir);
    writeFileSync(reportFile, res.report);
  } else {
    git(topLevel, ["worktree", "add", "--no-track", "-b", branch, wt, oursSha]);
    try {
      apply(wt);
      writeFileSync(reportFile, res.report);
    } catch (err) { // leave nothing of this run behind
      git(topLevel, ["worktree", "remove", "--force", wt], { allowFail: true });
      rmSync(wt, { recursive: true, force: true });
      git(topLevel, ["worktree", "prune"], { allowFail: true });
      git(topLevel, ["branch", "-D", branch], { allowFail: true });
      throw err;
    }
  }
  for (const e of entries) { delete e.result; delete e._b; delete e._n; delete e._o; } // keep the returned object small
  return res;
}

// One file: decide what happens, set e.status and (when a file is to be written) e.result and e.exec.
function decide(e, oi, execB, execN, scratch, branch) {
  const o = e._o, b = e._b, n = e._n;
  const theirs = branch;
  const execOf = () => (o === null ? execN : b === null ? oi.exec : oi.exec === execB ? execN : oi.exec); // three-way on the executable bit
  if (b === null) { // new upstream file
    if (o === null) { e.status = "added"; e.result = n; e.exec = execN; return; }
    if (same(o, n)) { e.status = "already-identical"; return; }
    if (isBinary(o) || isBinary(n)) { e.status = "binary-conflict"; return; }
    const m = mergeFile(scratch, o, Buffer.alloc(0), n, theirs);
    e.status = m.clean ? "merged" : "conflict"; e.result = m.merged; e.exec = execOf(); e.bothAdded = true;
    if (!m.clean) e.hunks = hunksOf(m.merged);
    return;
  }
  if (n === null) { // deleted upstream
    if (o === null) { e.status = "already-identical"; return; }
    e.status = same(o, b) ? "deleted" : "delete-kept";
    return;
  }
  if (o === null) { e.status = "we-removed"; return; } // changed upstream, but we do not have the file
  if (same(o, n)) {
    e.status = "already-identical";
    if (execB !== execN && oi.exec === execB) { e.status = "mode-only"; e.result = o; e.exec = execN; } // only the executable bit changed upstream
    return;
  }
  if (same(o, b)) { e.status = "took-upstream"; e.result = n; e.exec = execOf(); return; } // we never touched the text
  if (isBinary(o) || isBinary(b) || isBinary(n)) { e.status = "binary-conflict"; return; }
  const m = mergeFile(scratch, o, b, n, theirs);
  e.result = m.merged; e.exec = execOf();
  if (m.clean) e.status = "merged";
  else { e.status = "conflict"; e.hunks = hunksOf(m.merged); }
}

// Upstream renamed a file we had edited: it shows as "deleted" (we changed it) plus "added". Carry our edits to the
// new path with a merge of base = his old file, ours = our old file, theirs = his new file.
function pairRenames(entries, scratch, branch) {
  const gone = entries.filter((e) => e.status === "delete-kept");
  const fresh = entries.filter((e) => e.status === "added" && e.dest);
  // Only lines with a letter or digit count: braces and blank lines are in every file. Small files are never paired.
  const MIN_LINES = 5;
  const meaningful = (buf) => new Set(textLines(buf).map((l) => l.trim()).filter((l) => /[A-Za-z0-9]/.test(l)));
  const sim = (a, c) => {
    let both = 0;
    for (const l of a) if (c.has(l)) both++;
    return both / (a.size + c.size - both);
  };
  for (const g of gone) {
    if (isBinary(g._b) || isBinary(g._o)) continue;
    const gl = meaningful(g._b);
    if (gl.size < MIN_LINES) { g.hint = "no matching new file found"; continue; }
    let best = null, bestScore = 0;
    for (const f of fresh) {
      if (f.renamedFrom || isBinary(f._n)) continue;
      const fl = meaningful(f._n);
      if (fl.size < MIN_LINES) continue;
      const score = sim(gl, fl);
      // the same file name only helps a file that is already somewhat alike; alone it proves nothing
      const ok = score >= 0.6 || (basename(f.dest) === basename(g.dest) && score >= 0.3);
      if (ok && score > bestScore) { best = f; bestScore = score; }
    }
    if (!best) { g.hint = "no matching new file found"; continue; }
    const m = mergeFile(scratch, g._o, g._b, best._n, branch);
    best.renamedFrom = g.dest; best.result = m.merged;
    best.status = m.clean ? "renamed-merged" : "conflict";
    if (!m.clean) best.hunks = hunksOf(m.merged);
    g.status = "renamed-away"; g.renamedTo = best.dest;
  }
}

// ---------- the report ----------
export function renderReport(r) {
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
    const from = e.renamedFrom ? ` (upstream moved ${e.renamedFrom} here)` : "";
    if (!e.hunks.length) todo.push(`- **Conflict** ${e.dest}${from}: git reported a conflict but no marker lines were found; open the file and look for \`<<<<<<<\`.`);
    for (const h of e.hunks) todo.push(`- **Conflict** ${e.dest}:${h.line} (to line ${h.endLine})${from}: ours ${h.oursLines} lines, upstream ${h.theirLines} lines. Ours starts \`${h.oursPeek}\`; upstream starts \`${h.theirPeek}\`. ${e.bothAdded ? "Both sides added this file." : "Keep both sides' changes where they do different things."}`);
  }
  for (const e of r.entries.filter((x) => x.renamedFrom)) todo.push(`- **Upstream seems to have moved ${e.renamedFrom} to ${e.dest}**: our edits were carried over by a merge; check that these really are the same file.`);
  for (const e of by("binary-conflict")) todo.push(`- **Binary file changed on both sides** ${e.dest}: ours kept; pick one by hand.`);
  for (const e of by("ours-special")) todo.push(`- **${e.dest} is ${e.special} in our checkout**: upstream changed ${e.path}; nothing written, decide by hand.`);
  for (const e of by("delete-kept")) todo.push(`- **Upstream deleted ${e.dest}, but we changed it**: the file is kept; decide whether it should go${e.hint ? " (" + e.hint + ")" : ""}.`);
  for (const e of by("we-removed")) todo.push(`- **Upstream changed ${e.path}, but we have no ${e.dest}** (we removed or moved it): skipped; check whether the change matters.`);
  for (const w of r.warnings) todo.push("- " + w);
  if (r.netHits.length) {
    todo.push("- **Network or service-worker code that came in from upstream** (REVIEW.md: no network request without user action; read every line):");
    const perFile = new Map();
    for (const h of r.netHits) perFile.set(h.file, [...(perFile.get(h.file) ?? []), h]);
    for (const [file, hs] of perFile) {
      for (const h of hs.slice(0, 8)) todo.push(`  - ${file}:${h.line}: \`${h.text}\``);
      if (hs.length > 8) todo.push(`  - ${file}: and ${hs.length - 8} more`);
    }
  }
  const outside = r.entries.filter((e) => e.area !== "src");
  const notes = new Map();
  for (const e of outside) if (e.note) notes.set(e.note, [...(notes.get(e.note) ?? []), e.path]);
  for (const [note, files] of notes) todo.push(`- **Outside src/**: ${note} (${files.join(", ")})`);
  if (r.entries.some((e) => HELPER_PAGES.has(e.path))) todo.push("- **Helper pages**: upstream's built src/{flexigen,meshstep,chisel}.html changed, but ours are rebuilt from tools/*-source.html with our changes. Regenerate them from the merged sources (tools/README-helpers.md) instead of trusting a text merge.");
  if (r.entries.some((e) => e.path === "app/src/version.js")) todo.push("- **Version**: src/version.js follows upstream; keep our BUILD line and the version text in src/index.html's splash, and check the About dialog.");
  if (r.skipped.length) todo.push(`- **Skipped while reading the sources** (never followed or written): ${r.skipped.join("; ")}`);
  L.push(todo.length ? todo.join("\n") : "Nothing: every change merged cleanly and nothing sits outside src/.", "");

  const list = (title, es, fmt) => {
    L.push(`## ${title} (${es.length})`, "");
    L.push(es.length ? es.map(fmt).join("\n") : "None.", "");
  };
  list("Changed upstream, merged cleanly with our changes", by("merged", "renamed-merged"), (e) => `- ${e.dest}${e.renamedFrom ? ` (upstream moved it from ${e.renamedFrom}; our edits carried over)` : ""}`);
  list("Changed upstream, we never touched the file (took his version)", by("took-upstream", "mode-only"), (e) => `- ${e.dest}${e.status === "mode-only" ? " (only the executable bit)" : ""}`);
  list("Conflicts", conflicts, (e) => `- ${e.dest}: ${e.hunks.length} hunk(s)${e.hunks.length ? " at line " + e.hunks.map((h) => h.line).join(", ") : ""}`);
  list("New upstream files", by("added", "already-identical").filter((e) => e.upstream === "added"), (e) => `- ${e.dest ?? e.path}${e.status === "already-identical" ? " (we already have this exact file)" : ""}`);
  list("Deleted upstream", by("deleted", "delete-kept", "renamed-away").concat(r.entries.filter((e) => e.upstream === "deleted" && e.status === "report-only")),
    (e) => `- ${e.dest ?? e.path}${e.status === "delete-kept" ? " (kept: we changed it)" : e.status === "renamed-away" ? ` (moved to ${e.renamedTo}; our edits carried over)` : e.status === "report-only" ? " (outside src/, not touched)" : " (removed in the merged tree)"}`);
  list("Outside src/ (listed, needs a look)", outside, (e) => `- ${e.path} (${e.upstream}${e.status === "report-only" ? "; left untouched" : "; " + e.status.replace(/-/g, " ")}${e.dest ? " in " + e.dest : ""})`);

  L.push("## Next", "");
  L.push("1. Resolve every conflict marker (`<<<<<<< ours` to `>>>>>>> " + r.branch + "`), keeping both sides' changes where they do different things.",
    "2. Re-apply our marked `jumpstart-3d:` hooks wherever a conflict touched one; set the version text and BUILD; keep \"Created by J.Siwek\".",
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
