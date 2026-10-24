// Checks the agent map (AGENTS.md and the guides in .claude/guide/) against the repo, so a stale map is caught by a script and not by an agent reading it.
// Checks: every path in backticks exists; every /skill exists; every memory name exists; AGENTS.md stays inside its line and byte budget;
// no sentence is repeated word for word in two files (a warning; an error with --strict).
// A path with a / is checked from the repo root, every segment with exact upper/lower case (so macOS answers like Linux CI). It is checked when it has a file extension,
// ends with /, or starts with a folder that exists at the root or with a dot; other slashes (origin/main, owner/repo, github.com/owner/repo) are not paths.
// A bare file name (no /) passes when a file of that name exists anywhere under the root or in the memory folder. The search skips node_modules and .git, the folders the root
// .gitignore lists (build, playwright-report, ... when there is none), docs, dist and test-results at the root, test/fixtures, and any folder with its own .git (a nested worktree).
// A /skill is found as .claude/skills/<name>/SKILL.md or .claude/commands/<name>.md under the root or the home folder, or is a built-in command; /tmp, /usr and the like are not skills.
// Prints one line per check or problem (OK / SKIP / FAIL: <what> → <next step> / WARN) and a last line; exit 0 when there is no FAIL (and no WARN with --strict), else 1.
// AGENTS.md and .claude/ are local-only, so a missing file is skipped (and said so), not an error. Fenced code blocks are not checked (they hold examples), also not for duplicates.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = "usage: node tools/agent/check-map.mjs [--root <dir>] [--memory-dir <dir>] [--strict] [--max-lines <n>] [--max-bytes <n>] [files...]  (files are relative to the root; default AGENTS.md and .claude/guide/*.md; --max-lines 44 means fewer than 45)";
export const MAX_LINES = 44; // "fewer than 45 lines"
export const MAX_BYTES = 3072;
const GUIDES = ".claude/guide";
const PATH_EXT = /\.(?:md|mjs|cjs|js|json|sh|py|html?|css|svg|ya?ml|toml|ini|txt|ts)$/i;
const DOMAIN_END = /\.(?:io|com|org|net|dev|app|ai|co|edu|gov)$/i;
const SKIP_ANYWHERE = new Set(["node_modules", ".git"]);
const SKIP_AT_ROOT = ["docs", "dist", "test-results"];
const IGNORED_WHEN_NO_GITIGNORE = ["build", "playwright-report", "chat-bench-results", "lighthouse-report"];
const SYSTEM_DIRS = new Set(["tmp", "usr", "etc", "var", "opt", "bin", "dev"]);
const BUILTIN_COMMANDS = new Set(["help", "clear", "compact", "config", "model", "fast", "memory", "agents", "mcp", "hooks", "permissions", "init", "review", "security-review", "code-review", "simplify", "loop", "schedule", "plugin", "reload-plugins", "ultrareview", "doctor", "status", "cost", "resume", "add-dir"]);
const NOT_A_PATH = /[<>*{}$…]|\.\.\./;
const SKILL = /(?<=^|[\s(`])\/([a-z][a-z0-9-]*)(?=$|[\s`),.;])/g;
const NAME = "`[^`\\s]+`";
const MEMORY = new RegExp(`\\bmemor(?:y|ies)\\s+(${NAME}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*/\\s*)${NAME})*)`, "gi");

const posix = (p) => p.split("\\").join("/");

// The text lines of a file outside fenced code blocks: [{ n (1-based), text }].
function proseLines(text) {
  const out = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (!fenced) out.push({ n: i + 1, text: line });
  });
  return out;
}

function cleanToken(t) {
  let prev;
  do {
    prev = t;
    t = t.replace(/^[("'@]+/, ""); // an opening bracket or quote, or an @ (@AGENTS.md)
    t = t.replace(/["']+$/, ""); // a closing quote
    t = t.replace(/[,.;)]+$/, ""); // sentence punctuation
    t = t.replace(/(?::\d+(?:[-:]\d+)*|#[\w.-]*)$/, ""); // a line, a line range or an anchor: file.js:10, file.js:10-20, file.md#heading
    t = t.replace(/^(?:\.\/)+/, ""); // ./ at the start
  } while (t !== prev);
  return t;
}

// The repo paths named in the backtick spans of one line.
function pathsIn(line) {
  const out = [];
  for (const span of line.matchAll(/`([^`]+)`/g)) {
    for (const raw of span[1].split(/\s+/)) {
      if (!raw || raw.includes("://") || /^[~/]/.test(raw) || NOT_A_PATH.test(raw)) continue;
      const p = cleanToken(raw);
      if (p && !/^(?:origin|refs)\//.test(p) && (p.includes("/") || PATH_EXT.test(p))) out.push(p);
    }
  }
  return out;
}

function skillsIn(line) {
  return [...line.matchAll(SKILL)].map((m) => m[1]);
}

function memoryNamesIn(line) {
  const out = [];
  for (const m of line.matchAll(MEMORY)) for (const n of m[1].matchAll(/`([^`\s]+)`/g)) if (!/^[~/]/.test(n[1])) out.push(n[1].replace(/\.md$/, "")); // a name starting with ~ or / is a path
  return out;
}

// Sentences of at least 40 characters in prose lines: [{ s, line }]. Lines are split first, then after ". ", "? " and "! "; list and heading marks are dropped.
function sentencesIn(prose) {
  const out = [];
  for (const { n, text: raw } of prose) {
    if (/^[\s|:-]*-[\s|:-]*$/.test(raw)) continue; // table separator row or rule
    const line = raw.replace(/^\s*(?:[-*+>]|\d+\.|#+)\s+/, "");
    for (const part of line.split(/(?<=[.?!])\s+/)) {
      const s = part.replace(/\s+/g, " ").trim();
      if (s.length >= 40) out.push({ s, line: n });
    }
  }
  return out;
}

// The folders to leave out at the root: build output and the folders the root .gitignore lists (lines like /dist/ or build/).
function skippedAtRoot(root) {
  const skipped = new Set(SKIP_AT_ROOT);
  let ignore;
  try { ignore = readFileSync(join(root, ".gitignore"), "utf8"); } catch { IGNORED_WHEN_NO_GITIGNORE.forEach((n) => skipped.add(n)); return skipped; }
  for (const line of ignore.split("\n")) {
    const m = /^\/?([^/\s*?[\]!#][^/\s*?[\]]*)\/$/.exec(line.trim());
    if (m) skipped.add(m[1]);
  }
  return skipped;
}

// Every file name under the root (any depth) except in the skipped folders. Symbolic links to folders are not followed.
function fileNames(root) {
  const atRoot = skippedAtRoot(root);
  const names = new Set();
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) { names.add(e.name); continue; }
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (SKIP_ANYWHERE.has(e.name) || (!rel && atRoot.has(e.name)) || sub === "test/fixtures") continue;
      if (existsSync(join(dir, e.name, ".git"))) continue; // a nested checkout or worktree is a copy of the repo, not part of it
      walk(join(dir, e.name), sub);
    }
  };
  walk(root, "");
  return names;
}

const countLines = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

// options: root, memoryDir (default from home and root), files (relative to root; empty = the default map), strict, maxLines, maxBytes, home.
// Returns { lines, problems } where lines are the printed lines and problems counts the FAILs (and the WARNs with strict).
export function check({ root, memoryDir, files = [], strict = false, maxLines = MAX_LINES, maxBytes = MAX_BYTES, home = homedir() }) {
  root = resolve(root);
  memoryDir = resolve(memoryDir ?? join(home, ".claude", "projects", root.replace(/[^a-zA-Z0-9]/g, "-"), "memory"));
  const lines = [];
  let problems = 0;
  const emit = (found, ok) => {
    if (found.length === 0) { lines.push(ok); return; }
    lines.push(...found);
    problems += found.filter((l) => l.startsWith("FAIL")).length + (strict ? found.filter((l) => l.startsWith("WARN")).length : 0);
  };

  const defaults = files.length === 0;
  const guideDir = join(root, GUIDES);
  const guides = defaults && existsSync(guideDir) ? readdirSync(guideDir).filter((n) => n.endsWith(".md")).sort() : [];
  const names = defaults ? ["AGENTS.md", ...guides.map((n) => `${GUIDES}/${n}`)] : files.map((f) => posix(relative(root, resolve(root, f))));
  const docs = [];
  for (const name of names) {
    const file = join(root, name);
    if (existsSync(file) && statSync(file).isFile()) docs.push({ name, text: readFileSync(file, "utf8") });
    else if (defaults) lines.push(`SKIP ${name} (not present)`);
    else { lines.push(`FAIL: ${name} not found → check the file name`); problems++; }
  }
  if (defaults && guides.length === 0) lines.push(`SKIP ${GUIDES}/*.md (not present)`);

  // Exact-case existence: each segment below the root must be spelled as readdir lists it. The listings and the file names are read once per run.
  const listings = new Map();
  const listing = (dir) => {
    if (!listings.has(dir)) { try { listings.set(dir, new Set(readdirSync(dir))); } catch { listings.set(dir, new Set()); } }
    return listings.get(dir);
  };
  const existsExact = (full) => {
    const rel = relative(root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`)) return existsSync(full);
    let dir = root;
    for (const seg of rel.split(sep).filter(Boolean)) {
      if (!listing(dir).has(seg)) return false;
      dir = join(dir, seg);
    }
    return true;
  };
  let fileSet;
  const hasFileNamed = (name) => {
    if (!fileSet) { fileSet = fileNames(root); if (existsSync(memoryDir)) for (const n of readdirSync(memoryDir)) fileSet.add(n); }
    return fileSet.has(name);
  };
  const startsAtRoot = (p) => { const seg = p.split("/")[0]; return seg.startsWith(".") || listing(root).has(seg); }; // a leading dot: .claude/..., .cluade/...
  const isDomain = (p) => { const seg = p.split("/")[0]; return DOMAIN_END.test(seg) && !listing(root).has(seg); }; // github.com/owner/repo

  const show = (p) => {
    const inRoot = relative(root, p);
    if (!inRoot.startsWith("..")) return posix(inRoot);
    const inHome = relative(home, p);
    return inHome.startsWith("..") ? p : `~/${posix(inHome)}`;
  };

  // 1. Paths
  const pathProblems = [];
  let pathCount = 0;
  for (const d of docs) {
    for (const { n, text } of proseLines(d.text)) {
      for (const p of pathsIn(text)) {
        if (p.includes("/") && (isDomain(p) || (!PATH_EXT.test(p) && !p.endsWith("/") && !startsAtRoot(p)))) continue; // origin/main, owner/repo, github.com/owner/repo: not paths
        pathCount++;
        const full = resolve(root, p);
        let found = p.includes("/") ? existsExact(full) : hasFileNamed(p);
        let isDir = false;
        if (found && p.endsWith("/")) try { isDir = statSync(full).isDirectory(); } catch { found = false; } // a link to nothing
        if (!found) pathProblems.push(`FAIL: ${d.name}:${n} path \`${p}\` not found → fix the path or create it`);
        else if (p.endsWith("/") && !isDir) pathProblems.push(`FAIL: ${d.name}:${n} path \`${p}\` is a file, not a folder → remove the trailing / or fix the path`);
      }
    }
  }
  emit(pathProblems, `OK paths (${pathCount} checked)`);

  // 2. Skills
  const skillProblems = [];
  let skillCount = 0;
  for (const d of docs) {
    for (const { n, text } of proseLines(d.text)) {
      for (const name of skillsIn(text)) {
        if (SYSTEM_DIRS.has(name)) continue; // /tmp, /usr: folders, not skills
        skillCount++;
        const rel = `.claude/skills/${name}/SKILL.md`;
        const found = [rel, `.claude/commands/${name}.md`].some((r) => existsSync(join(root, r)) || existsSync(join(home, r)));
        if (!found && !BUILTIN_COMMANDS.has(name)) skillProblems.push(`FAIL: ${d.name}:${n} skill /${name} not found → ${rel}`);
      }
    }
  }
  emit(skillProblems, `OK skills (${skillCount})`);

  // 3. Memory names
  if (!existsSync(memoryDir)) lines.push("SKIP memory names (no memory dir)");
  else {
    const memProblems = [];
    let memCount = 0;
    for (const d of docs) {
      for (const { n, text } of proseLines(d.text)) {
        for (const name of memoryNamesIn(text)) {
          memCount++;
          const file = join(memoryDir, `${name}.md`);
          if (!existsSync(file)) memProblems.push(`FAIL: ${d.name}:${n} memory name \`${name}\` not found → ${show(file)}`);
        }
      }
    }
    emit(memProblems, `OK memory names (${memCount})`);
  }

  // 4. Budget (AGENTS.md only)
  for (const d of docs.filter((x) => basename(x.name) === "AGENTS.md")) {
    const nLines = countLines(d.text);
    const nBytes = Buffer.byteLength(d.text);
    const budget = [];
    if (nLines > maxLines) budget.push(`FAIL: ${d.name} has ${nLines} lines, limit ${maxLines} → move detail into a guide; AGENTS.md is a router`);
    if (nBytes > maxBytes) budget.push(`FAIL: ${d.name} is ${nBytes} bytes, limit ${maxBytes} → move detail into a guide; AGENTS.md is a router`);
    emit(budget, `OK budget ${d.name} (${nLines} lines, ${nBytes} bytes)`);
  }

  // 5. Duplicate sentences across files
  const seen = new Map(); // sentence -> first line in each file that has it
  let sentenceCount = 0;
  for (const d of docs) {
    for (const { s, line } of sentencesIn(proseLines(d.text))) {
      sentenceCount++;
      const where = seen.get(s) ?? [];
      seen.set(s, where);
      if (!where.some((w) => w.name === d.name)) where.push({ name: d.name, line });
    }
  }
  const dupes = [];
  for (const [s, where] of seen) {
    for (const w of where.slice(1)) dupes.push(`WARN: duplicate sentence in ${where[0].name}:${where[0].line} and ${w.name}:${w.line}: "${s.slice(0, 60)}…"`);
  }
  emit(dupes, `OK duplicates (${sentenceCount} sentences)`);

  lines.push(problems === 0 ? "check-map: OK" : `check-map: ${problems} problem(s)`);
  return { lines, problems };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) { // realpath: a script reached through a symlinked folder (macOS /tmp, /var) must still run
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { root: { type: "string" }, "memory-dir": { type: "string" }, strict: { type: "boolean" }, help: { type: "boolean" }, "max-lines": { type: "string" }, "max-bytes": { type: "string" } },
    });
  } catch (e) {
    console.error(`check-map: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) { console.log(USAGE); process.exit(0); }
  const number = (name, fallback) => {
    if (values[name] === undefined) return fallback;
    const n = Number(values[name]);
    if (!Number.isInteger(n) || n < 0) { console.error(`check-map: --${name} needs a whole number\n${USAGE}`); process.exit(2); }
    return n;
  };
  const { lines, problems } = check({
    root: values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    memoryDir: values["memory-dir"],
    files: positionals,
    strict: values.strict ?? false,
    maxLines: number("max-lines", MAX_LINES),
    maxBytes: number("max-bytes", MAX_BYTES),
  });
  console.log(lines.join("\n"));
  process.exit(problems === 0 ? 0 : 1);
}
