// Golden exports: every design in test/projects/ is loaded, exported as STL, OBJ, 3MF and STEP
// (and DXF when it has sketches) through the real menu, and the bytes are hashed. A hash that moves means the geometry
// or the exporter changed. After an intended change: npm run test:update
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, watchErrors, loadDoc, bodies, exportBytes, sha256, normalizeStep, stlTriangles } from "./helpers.mjs";

const projectsDir = new URL("./projects/", import.meta.url);
const goldenFile = fileURLToPath(new URL("./golden.json", import.meta.url));
const UPDATE = !!process.env.UPDATE_GOLDEN;
const readGolden = () => (existsSync(goldenFile) ? JSON.parse(readFileSync(goldenFile, "utf8")) : {});
const files = readdirSync(projectsDir).filter((f) => f.endsWith(".json")).sort();

// one page for the whole file: the kernel loads once; every test loads its own design first
let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });

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
    got["3mf"] = sha256((await exportBytes(page, "3mf")).bytes); // a zip; the app's writer stamps no dates
    got.step = sha256(normalizeStep((await exportBytes(page, "step")).bytes));
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
  });
}
