// Checks the agent map (AGENTS.md and the guides in .claude/guide/) against the repo, so a stale map is caught by a script and not by an agent reading it.
// Checks: every path in backticks exists; every /skill exists; every memory name exists; AGENTS.md stays inside its line and byte budget;
// no sentence is repeated word for word in two files (a warning; an error with --strict).
// Prints one line per check or problem (OK / SKIP / FAIL: <what> → <next step> / WARN) and a last line; exit 0 when there is no FAIL (and no WARN with --strict), else 1.
// AGENTS.md and .claude/ are local-only, so a missing file is skipped (and said so), not an error. Fenced code blocks are not checked (they hold examples).
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const USAGE = "usage: node tools/agent/check-map.mjs [--root <dir>] [--memory-dir <dir>] [--strict] [--max-lines <n>] [--max-bytes <n>] [files...]  (files are relative to the root; default AGENTS.md and .claude/guide/*.md; --max-lines 44 means fewer than 45)";
export const MAX_LINES = 44; // "fewer than 45 lines"
export const MAX_BYTES = 3072;
const GUIDES = ".claude/guide";
const PATH_EXT = /\.(?:md|mjs|js|json|sh|html|ya?ml|txt|ts)$/i;
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
  do { prev = t; t = t.replace(/^[("']+/, "").replace(/["']+$/, "").replace(/[,.;)]+$/, "").replace(/:\d+$/, ""); } while (t !== prev);
  return t;
}

// The repo paths named in the backtick spans of one line.
function pathsIn(line) {
  const out = [];
  for (const span of line.matchAll(/`([^`]+)`/g)) {
    for (const raw of span[1].split(/\s+/)) {
      if (!raw || raw.includes("://") || /^[~/]/.test(raw) || NOT_A_PATH.test(raw)) continue;
      const p = cleanToken(raw);
      if (p && (p.includes("/") || PATH_EXT.test(p))) out.push(p);
    }
  }
  return out;
}

function skillsIn(line) {
  return [...line.matchAll(SKILL)].map((m) => m[1]);
}

function memoryNamesIn(line) {
  const out = [];
  for (const m of line.matchAll(MEMORY)) for (const n of m[1].matchAll(/`([^`\s]+)`/g)) out.push(n[1].replace(/\.md$/, ""));
  return out;
}

// Sentences of at least 40 characters: [{ s, line }]. Lines are split first, then after ". ", "? " and "! "; list and heading marks are dropped.
function sentencesIn(text) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    if (/^[\s|:-]*-[\s|:-]*$/.test(raw)) return; // table separator row or rule
    const line = raw.replace(/^\s*(?:[-*+>]|\d+\.|#+)\s+/, "");
    for (const part of line.split(/(?<=[.?!])\s+/)) {
      const s = part.replace(/\s+/g, " ").trim();
      if (s.length >= 40) out.push({ s, line: i + 1 });
    }
  });
  return out;
}

const countLines = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

// options: root, memoryDir (default from home and root), files (relative to root; empty = the default map), strict, maxLines, maxBytes, home.
// Returns { lines, problems } where lines are the printed lines and problems counts the FAILs (and the WARNs with strict).
export function check({ root, memoryDir, files = [], strict = false, maxLines = MAX_LINES, maxBytes = MAX_BYTES, home = homedir() }) {
  root = resolve(root);
  memoryDir = resolve(memoryDir ?? join(home, ".claude", "projects", root.replaceAll("/", "-"), "memory"));
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
        pathCount++;
        const full = resolve(root, p);
        if (!existsSync(full)) pathProblems.push(`FAIL: ${d.name}:${n} path \`${p}\` not found → fix the path or create it`);
        else if (p.endsWith("/") && !statSync(full).isDirectory()) pathProblems.push(`FAIL: ${d.name}:${n} path \`${p}\` is a file, not a folder → remove the trailing / or fix the path`);
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
        skillCount++;
        const rel = `.claude/skills/${name}/SKILL.md`;
        if (!existsSync(join(root, rel)) && !existsSync(join(home, rel))) skillProblems.push(`FAIL: ${d.name}:${n} skill /${name} not found → ${rel}`);
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
    for (const { s, line } of sentencesIn(d.text)) {
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
