// Opens or updates the one GitHub issue "Nightly failures" after a nightly run (.github/workflows/nightly.yml).
// It never closes anything. Needs: NEEDS (the workflow's `needs` as JSON), RUN_URL, REF, GH_TOKEN, GITHUB_REPOSITORY, and the
// Playwright JSON reports downloaded to REPORT_DIR (default "reports"), one folder per job named results-<job id>-<part>.
// Firefox and WebKit (job id "cross") run with continue-on-error while they settle: their failures are listed but do not open an issue
// by themselves. Set CROSS_BLOCKING=1 to make them count.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TITLE = "Nightly failures";
const MAX_SPECS = 40;

// Failing specs in a Playwright JSON report, as "file › title [project]".
export function failingSpecs(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === "unexpected") out.push(`${spec.file} › ${spec.title} [${t.projectName}]`);
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

// reports: { "<job id>": [spec strings] }; needs: the `needs` object (job id -> { result }).
export function buildReport({ needs, reports, quarantined = [], runUrl, ref, crossBlocking = false }) {
  const failedJobs = Object.entries(needs).filter(([, v]) => v.result !== "success" && v.result !== "skipped").map(([id]) => id);
  // jumpstart-3d: the Lighthouse loading check only reports until a CI baseline is committed; delete "lighthouse" from this list when enforcement goes on (test/README.md)
  const blockingJobs = failedJobs.filter((id) => (id !== "cross" || crossBlocking) && id !== "lighthouse");
  const crossSpecs = reports.cross ?? [];
  const lines = [`Latest failing run: ${runUrl} (branch \`${ref}\`).`, ""];
  const list = (specs) => {
    const shown = specs.slice(0, MAX_SPECS).map((s) => `- ${s}`);
    if (specs.length > MAX_SPECS) shown.push(`- ... and ${specs.length - MAX_SPECS} more (see the run)`);
    return shown;
  };
  if (blockingJobs.length) {
    lines.push("## Failing");
    for (const id of blockingJobs) {
      lines.push(`**${id}**: ${needs[id].result}`);
      lines.push(...list(reports[id] ?? []), "");
    }
  }
  if (crossSpecs.length && !crossBlocking) {
    lines.push("## Firefox and WebKit (not blocking yet)", ...list(crossSpecs), "");
  }
  if (quarantined.length) {
    lines.push("## Quarantined tests (skipped until fixed)", ...quarantined.map((q) => `- ${q}`), "");
  }
  return { open: blockingJobs.length > 0, body: lines.join("\n").slice(0, 60000) };
}

export function quarantinedTests(testDir = "test") {
  const out = [];
  for (const f of readdirSync(testDir).filter((n) => /\.spec\.mjs$/.test(n))) {
    readFileSync(join(testDir, f), "utf8").split("\n").forEach((line, i) => {
      if (/\/\/\s*quarantined:/.test(line)) out.push(`${f}:${i + 1} ${line.trim()}`);
    });
  }
  return out;
}

function collectReports(dir, ids) {
  const reports = {};
  if (!existsSync(dir)) return reports;
  for (const name of readdirSync(dir)) {
    const id = ids.filter((i) => name.startsWith(`results-${i}-`)).sort((a, b) => b.length - a.length)[0];
    if (!id) continue;
    const file = join(dir, name, "pw-report.json");
    if (!existsSync(file)) continue;
    (reports[id] ??= []).push(...failingSpecs(JSON.parse(readFileSync(file, "utf8"))));
  }
  return reports;
}

function main() {
  const needs = JSON.parse(process.env.NEEDS);
  const reports = collectReports(process.env.REPORT_DIR || "reports", Object.keys(needs));
  const { open, body } = buildReport({
    needs, reports, quarantined: quarantinedTests(), runUrl: process.env.RUN_URL, ref: process.env.REF, crossBlocking: process.env.CROSS_BLOCKING === "1",
  });
  console.log(body);
  if (!open) { console.log("Nothing blocking failed: no issue opened or changed."); return; }
  const gh = (...args) => execFileSync("gh", [...args, "--repo", process.env.GITHUB_REPOSITORY], { encoding: "utf8" });
  const existing = JSON.parse(gh("issue", "list", "--state", "open", "--search", `"${TITLE}" in:title`, "--json", "number,title")).find((i) => i.title === TITLE);
  writeFileSync("nightly-issue.md", body);
  if (existing) console.log(gh("issue", "edit", String(existing.number), "--body-file", "nightly-issue.md"));
  else console.log(gh("issue", "create", "--title", TITLE, "--body-file", "nightly-issue.md"));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
