// STEP import (GitHub #173): a file with several parts keeps every part, a file that cannot be read says so in plain words,
// and a file with 200 parts loads in seconds. The importer used to join the file's solids with one boolean union after another:
// touching parts melted into one solid, and 200 parts took 45 s on a fast machine (a minute or more on a slower one, and the
// watchdog stops any build at 120 s). The fixtures are made with the app's own kernel (nothing downloaded):
//   step-assembly-3-parts.step  an assembly of three parts as other CAD programs write one: a 60x40x10 plate with a 4 mm hole, a pin 0.05 mm wider
//                               than the hole pressed into it, and a 60x40x10 block lying on the plate (the old union melted all three into one solid)
//   step-2-touching-cubes.step  an assembly of two 10 mm cubes that touch face to face
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, bodies, newDoc, body, prim, IDENTITY, browserOf, quarantine } from "./helpers.mjs";

const UNREADABLE = "Could not read this STEP file (it may be damaged or not a STEP file).";
const NO_SHAPES = "This STEP file has no solids or surfaces in it, so there is nothing to import.";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);

// Open a design whose only body is the STEP file (as Import leaves it), wait until it is built, and say what came out.
let imports = 0;
async function importStep(name, bytes) {
  const asset = "step" + ++imports, id = "s" + imports; // new ids each time: the engine keeps an asset's bytes by id, and a body that fails keeps the picture of the last one with its id
  const doc = newDoc("step " + name, "advanced", {
    assets: { [asset]: { kind: "step", name, data: Buffer.from(bytes).toString("base64") } },
    bodies: [body(id, name, { t: "step", asset, k: 1, mods: [] }, IDENTITY)],
  });
  const t0 = Date.now();
  await loadDoc(page, doc);
  const seconds = (Date.now() - t0) / 1000;
  const list = await bodies(page);
  const solids = await run((id) => { const v = __app.scene.views.get(id); return v && v.data ? v.data.solidCount : null; }, id);
  return { list, solids, seconds };
}

test("an assembly of three parts comes in as one body that still holds all three solids", async () => {
  const r = await importStep("three parts", fixture("step-assembly-3-parts.step"));
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.list).toHaveLength(1);
  expect(r.solids).toBe(3);
  // the parts' own volumes added up: plate with its hole + pin + block (the melted-together solid is 48515 mm3)
  near(r.list[0].volume, 60 * 40 * 10 - Math.PI * 4 * 4 * 10 + Math.PI * 4.05 * 4.05 * 30 + 60 * 40 * 10, 0.002);
});

test("two cubes that touch stay two solids instead of melting into one block", async () => {
  const r = await importStep("touching cubes", fixture("step-2-touching-cubes.step"));
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.solids).toBe(2);
  near(r.list[0].volume, 2 * 10 * 10 * 10, 0.002);
});

test("a damaged or non-STEP file says so in plain words, not 'This shape has not type'", async () => {
  const whole = fixture("step-assembly-3-parts.step");
  const cases = {
    "garbage text": Buffer.from("This is not a STEP file, only some text.\n"),
    "a file cut off half way": whole.subarray(0, Math.floor(whole.length / 2)),
    "an empty file": Buffer.alloc(0),
  };
  for (const [label, bytes] of Object.entries(cases)) {
    const r = await importStep(label, bytes);
    expect(r.list[0].error, label).toBe(UNREADABLE);
    expect(r.list[0].volume, label).toBeNull();
  }
});

test("a STEP file that holds no solids or surfaces says so in plain words", async () => {
  const header = [
    "ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('nothing in it'),'2;1');",
    "FILE_NAME('empty.step','2026-01-01T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", "ENDSEC;", "END-ISO-10303-21;", "",
  ].join("\n");
  const r = await importStep("no shapes", Buffer.from(header));
  expect(r.list[0].error).toBe(NO_SHAPES);
});

// 200 separate parts: the app's own kernel writes the file (200 boxes exported as STEP), then it is imported as one file.
// Before the fix: 49 s in Chromium on a 2023 Mac (the scout saw 7 minutes in Firefox, which the watchdog stops at 2 minutes). After: about 4 s. The limit is generous for a slow runner and still far under the 120 s watchdog; Firefox and WebKit run the engine several times slower.
// quarantined: the single file in WebKit cannot read the STEP blob back out of the engine worker (see booleans.spec.mjs)
test("a file with 200 parts loads in seconds and keeps every part", async ({}, info) => {
  quarantine(info, ["single-webkit"], "the single file in WebKit cannot read the STEP blob back out of the engine worker");
  const parts = 200, side = 15;
  const grid = newDoc("200 boxes", "advanced", {
    bodies: Array.from({ length: parts }, (_, i) => {
      const m = [...IDENTITY]; m[12] = (i % side) * 12; m[13] = Math.floor(i / side) * 12;
      return body("p" + i, "Part " + i, prim("box", { w: 8, d: 8, h: 8 + (i % 5), r: 0, c: 0 }), m);
    }),
  });
  await loadDoc(page, grid);
  const base64 = await run(async () => {
    const u8 = await JS3D.export("step");
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const file = Buffer.from(base64, "base64");
  expect(file.length).toBeGreaterThan(100_000); // it really is a big file, not an empty export

  const limit = browserOf(info) === "chromium" ? 30 : 100; // seconds
  const r = await importStep("200 parts", file);
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.solids).toBe(parts);
  const volume = Array.from({ length: parts }, (_, i) => 8 * 8 * (8 + (i % 5))).reduce((a, b) => a + b, 0);
  near(r.list[0].volume, volume, 0.002);
  console.log(`200-part STEP file (${(file.length / 1e6).toFixed(2)} MB) loaded in ${r.seconds.toFixed(1)} s [${info.project.name}]`);
  expect(r.seconds, "seconds to load 200 parts").toBeLessThan(limit);
});
