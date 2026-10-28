// STEP import (GitHub #173): a file with several parts is fused in one step, a file that cannot be read says so in plain words, and a file
// with 200 parts loads in seconds. The importer used to fuse the file's solids one after another: every step runs against everything fused so
// far, so 200 parts took 45 s on a fast machine (a minute or more on a slower one; the watchdog stops any build at 120 s). It now fuses them all
// in one boolean. The result is the same shape (touching and overlapping parts become one solid, separate parts stay separate solids in one body).
// Keeping the parts apart in a compound was tried and refused: a boolean never intersects the solids inside one argument, so a hole through an
// overlapping pin removed a third of what it should and a cut across the parts removed nothing. The Import button now splits a file into one body per
// part (test/step-parts.spec.mjs); this spec covers the plain, fused STEP body (a design that holds the file as one body, as a saved design does).
// The fixtures are made with the app's own kernel (nothing downloaded; test/fixtures/make-step-fixtures.mjs writes them):
//   step-assembly-3-parts.step  an assembly of three parts as other CAD programs write one: a 60x40x10 plate with a 4 mm hole, a pin 0.05 mm wider
//                               than the hole pressed into it, and a 60x40x10 block lying on the plate; fused they are one solid of 48515 mm3
//   step-2-touching-cubes.step  an assembly of two 10 mm cubes that touch face to face; fused they are one 20x10x10 block
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
const bytes = (a) => (ArrayBuffer.isView(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : Buffer.from(Object.values(a)));
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);

// Open a design whose only body is the STEP file (as Import leaves it), wait until it is built, and say what came out.
let imports = 0;
async function importStep(name, data, extraBodies = []) {
  const asset = "step" + ++imports, id = "s" + imports; // new ids each time: the engine keeps an asset's bytes by id, and a body that fails keeps the picture of the last one with its id
  const doc = newDoc("step " + name, "advanced", {
    assets: { [asset]: { kind: "step", name, data: Buffer.from(data).toString("base64") } },
    bodies: [body(id, name, { t: "step", asset, k: 1, mods: [] }, IDENTITY), ...extraBodies],
  });
  const t0 = Date.now();
  await loadDoc(page, doc);
  const seconds = (Date.now() - t0) / 1000;
  const list = await bodies(page);
  const solids = await run((id) => { const v = __app.scene.views.get(id); return v && v.data ? v.data.solidCount : null; }, id);
  return { id, list, solids, seconds };
}

// Binary STL: how many edges only one triangle uses (a hole in the surface) and how many more than two use (faces inside the body, or parts glued
// together), with the corners welded at 0.001 mm.
function stlEdges(buf) {
  const n = buf.readUInt32LE(80), ids = new Map(), uses = new Map();
  const vid = (p) => { const k = p.map((v) => Math.round(v * 1000)).join(","); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  for (let t = 0; t < n; t++) {
    const v = [0, 1, 2].map((c) => vid([0, 1, 2].map((a) => buf.readFloatLE(84 + t * 50 + 12 + c * 12 + a * 4))));
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (a === b) continue;
      const k = a < b ? a + ":" + b : b + ":" + a;
      uses.set(k, (uses.get(k) || 0) + 1);
    }
  }
  const counts = [...uses.values()];
  return { triangles: n, single: counts.filter((c) => c === 1).length, over: counts.filter((c) => c > 2).length };
}

test("an assembly of three parts fuses into one solid whose volume is counted once", async () => {
  const r = await importStep("three parts", fixture("step-assembly-3-parts.step"));
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.list).toHaveLength(1);
  expect(r.solids).toBe(1);
  // plate with its hole + pin + block, minus the 0.05 mm ring where the pin sits inside the plate: 48515.3 mm3 (adding the three volumes up gives 49043)
  near(r.list[0].volume, 48515.3, 0.0005);
});

// A compound of overlapping solids made booleans silently wrong (a boolean never intersects the solids inside one argument). Here the pin has
// 0.05 mm of its radius inside the plate, so a 3 mm hole through its axis must remove all of the 30 mm of pin: pi * 1.5^2 * 30 = 212.06 mm3
// (the compound gave 70.7 mm3).
test("a 3 mm hole through the pin of the imported assembly removes the whole pin's length", async () => {
  const at = [...IDENTITY]; at[14] = -30; // the import is centred on X and Y, so the pin is on the axis; the hole starts below the plate
  const hole = body("hole", "Hole", prim("cylinder", { w: 3, d: 3, h: 100, r: 0, c: 0 }), at, { hole: true });
  const before = await importStep("pin before", fixture("step-assembly-3-parts.step"));
  const r = await importStep("pin drilled", fixture("step-assembly-3-parts.step"), [hole]);
  await run(async (ids) => { JS3D.group(ids); await JS3D.ready(60000); }, [r.id, "hole"]);
  const [drilled] = await bodies(page);
  expect(drilled.error).toBeNull();
  near(before.list[0].volume - drilled.volume, Math.PI * 1.5 * 1.5 * 30, 0.005);
});

test("two cubes that touch import as one clean block, not two cubes glued together", async () => {
  const r = await importStep("touching cubes", fixture("step-2-touching-cubes.step"));
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.solids).toBe(1);
  near(r.list[0].volume, 2 * 10 * 10 * 10, 0.0005);
  const stl = stlEdges(bytes(await run(() => JS3D.export("stl"))));
  expect(stl.single, "edges used by one triangle").toBe(0);
  expect(stl.over, "edges used by more than two triangles").toBe(0);
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
// Before the fix: 49 s in Chromium on a 2023 Mac (the scout saw 7 minutes in Firefox, which the watchdog stops at 2 minutes). After: about 4 s.
// The limit is generous for a slow runner and far under the 120 s watchdog; Firefox and WebKit run the engine several times slower. loadDoc gives up
// waiting at 90 s, so a limit above that could never decide: 75 s does.
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

  const limit = browserOf(info) === "chromium" ? 30 : 75; // seconds
  const r = await importStep("200 parts", file);
  expect(r.list.map((b) => b.error)).toEqual([null]);
  expect(r.solids).toBe(parts);
  const volume = Array.from({ length: parts }, (_, i) => 8 * 8 * (8 + (i % 5))).reduce((a, b) => a + b, 0);
  near(r.list[0].volume, volume, 0.002);
  console.log(`200-part STEP file (${(file.length / 1e6).toFixed(2)} MB) loaded in ${r.seconds.toFixed(1)} s [${info.project.name}]`);
  expect(r.seconds, "seconds to load 200 parts").toBeLessThan(limit);
});
