// Golden exports: every design in test/projects/ is loaded, exported as STL, OBJ, 3MF and STEP
// (and DXF when it has sketches) through the real menu, and the bytes are hashed. A hash that moves means the geometry
// or the exporter changed. After an intended change: npm run test:update
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, watchErrors, loadDoc, bodies, exportBytes, sha256, normalizeStep, stlTriangles } from "./helpers.mjs";

const projectsDir = new URL("./projects/", import.meta.url);
const goldenFile = fileURLToPath(new URL("./golden.json", import.meta.url));
const UPDATE = !!process.env.UPDATE_GOLDEN;
const readGolden = () => (existsSync(goldenFile) ? JSON.parse(readFileSync(goldenFile, "utf8")) : {});
const files = readdirSync(projectsDir).filter((f) => f.endsWith(".json")).sort();

// J1: Only complete, verified golden runs may supply the consumer judge.
const COLLECT = process.env.JUDGE_EXPORTS === "1";
if (process.env.JUDGE_EXPORTS && !COLLECT) throw new Error("JUDGE_EXPORTS must be 1 or unset");
if (COLLECT && (UPDATE || !process.env.JUDGE_RUN_ID?.trim())) throw new Error("JUDGE_EXPORTS requires JUDGE_RUN_ID and forbids UPDATE_GOLDEN");
let judgeDir, manifest, successful = 0;
// J1 end.

// one page for the whole file: the kernel loads once; every test loads its own design first
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  // J1: A worker may clear only its own build's inputs.
  if (COLLECT) {
    const build = info.project.name;
    if (!["site", "single"].includes(build)) throw new Error(`Unknown judge build: ${build}`);
    judgeDir = new URL(`../test-results/judge/${build}/`, import.meta.url);
    rmSync(judgeDir, { recursive: true, force: true });
    mkdirSync(judgeDir, { recursive: true });
    manifest = { schema: 1, runId: process.env.JUDGE_RUN_ID, build, goldenSha256: sha256(readFileSync(goldenFile)), fixtures: {} };
    successful = 0;
  }
  // J1 end.
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
// J1: A filtered or failed run must not publish a complete manifest.
test.afterEach(async ({}, info) => { if (COLLECT && info.status === "passed") successful++; });
test.afterAll(async () => {
  await page?.close();
  if (COLLECT && successful === files.length && Object.keys(manifest.fixtures).length === files.length) {
    writeFileSync(new URL("manifest.json", judgeDir), JSON.stringify(manifest, null, 2) + "\n");
  }
});
// J1 end.

for (const file of files) {
  test(`golden: ${file}`, async () => {
    const json = JSON.parse(readFileSync(new URL(file, projectsDir), "utf8"));
    await loadDoc(page, json.doc || json);
    const list = await bodies(page);
    expect(list.filter((b) => b.error), "kernel errors").toEqual([]);
    expect(list.filter((b) => !b.hole && b.volume === null), "bodies without a mesh").toEqual([]);
    const got = { volumes: Object.fromEntries(list.map((b) => [b.id + " " + b.name, b.volume])) };
    const stl = await exportBytes(page, "stl");
    got.stlTriangles = stlTriangles(stl.bytes);
    got.stl = sha256(stl.bytes);
    got.obj = sha256((await exportBytes(page, "obj")).bytes);
    // J1: Keep the original downloads; STEP normalization is only for hashing.
    const threeMF = await exportBytes(page, "3mf"), step = await exportBytes(page, "step");
    got["3mf"] = sha256(threeMF.bytes);
    got.step = sha256(normalizeStep(step.bytes));
    // J1 end.
    if ((json.sketches || []).length) got.dxf = sha256((await exportBytes(page, "dxf")).bytes); // without sketches the menu only shows a toast
    expect(errors, "console errors").toEqual([]);
    const golden = readGolden();
    if (UPDATE) {
      golden[file] = got;
      for (const k of Object.keys(golden)) if (!files.includes(k)) delete golden[k]; // designs that were removed
      writeFileSync(goldenFile, JSON.stringify(golden, null, 2) + "\n");
      return;
    }
    expect(golden[file], `${file} has no entry in test/golden.json; run: npm run test:update`).toBeTruthy();
    expect(got).toEqual(golden[file]);
    // J1: Failed golden assertions must never approve inputs for the judge.
    if (COLLECT) {
      const exports = {};
      for (const [format, { bytes }] of Object.entries({ stl, "3mf": threeMF, step })) {
        const path = file.replace(/\.json$/, `.${format}`);
        writeFileSync(new URL(path, judgeDir), bytes);
        exports[format] = { path, bytes: bytes.length, sha256: sha256(bytes) };
      }
      manifest.fixtures[file] = { projectSha256: sha256(readFileSync(new URL(file, projectsDir))), exports };
    }
    // J1 end.
  });
}
