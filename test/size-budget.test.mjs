// The size budget check (tools/size-budget.mjs): up to 5 % growth passes, more fails until the budget is bumped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBudget, gzipSize } from "../tools/size-budget.mjs";

test("growth up to 5 percent passes, more fails", () => {
  assert.equal(checkBudget(1000, 1000).ok, true);
  assert.equal(checkBudget(1050, 1000).ok, true);
  assert.equal(checkBudget(1051, 1000).ok, false);
  assert.equal(checkBudget(900, 1000).ok, true); // a smaller app is fine
});

test("the failure says how to bump, and a missing record fails", () => {
  assert.match(checkBudget(1100, 1000).message, /--bump-budget/);
  assert.equal(checkBudget(1000, undefined).ok, false);
  assert.equal(checkBudget(1000, 0).ok, false);
});

test("gzipSize is the size of the gzipped text", () => {
  assert.ok(gzipSize("a".repeat(10_000)) < 100);
});

test("the committed budget is a real number close to the built app", () => {
  const recorded = JSON.parse(readFileSync(new URL("../size-budget.json", import.meta.url), "utf8"))["docs/app.js gzip bytes"];
  assert.ok(Number.isInteger(recorded) && recorded > 500_000, "size-budget.json holds the gzipped size of docs/app.js");
});

test("build.mjs fails on a lowered budget and passes after --bump-budget", { timeout: 180_000 }, () => {
  // a scratch folder with its own build.mjs and budget file (the inputs are linked, read-only), so the real docs/, dist/ and size-budget.json are never touched
  const dir = mkdtempSync(join(tmpdir(), "js3d-budget-"));
  const root = new URL("..", import.meta.url).pathname;
  for (const f of ["package.json", "src", "third_party", "tools", "LICENSES", "node_modules"]) symlinkSync(join(root, f), join(dir, f));
  copyFileSync(join(root, "build.mjs"), join(dir, "build.mjs"));
  const tooSmall = join(dir, "size-budget.json");
  writeFileSync(tooSmall, JSON.stringify({ "docs/app.js gzip bytes": 1_000_000 }));
  const bad = spawnSync("node", ["build.mjs"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /over the recorded 1000000/);
  const bump = spawnSync("node", ["build.mjs", "--bump-budget"], { cwd: dir, encoding: "utf8" });
  assert.equal(bump.status, 0, bump.stderr);
  const after = JSON.parse(readFileSync(tooSmall, "utf8"))["docs/app.js gzip bytes"];
  assert.ok(after > 1_000_000);
  assert.equal(spawnSync("node", ["build.mjs"], { cwd: dir, encoding: "utf8" }).status, 0);
  rmSync(dir, { recursive: true, force: true });
});
