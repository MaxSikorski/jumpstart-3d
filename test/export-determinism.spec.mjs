// A design's STL, OBJ and 3MF must not depend on what was built before it in the page. OpenCascade's shell/offset
// builder returned a solid's faces in an order that followed memory addresses, so the same filleted box with a
// shell exported the same triangles in a different order after other designs (and golden hashes moved when a new
// design was added ahead of it). Each history below ends in the same design; every export must match the first.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, watchErrors, loadDoc, bodies, exportBytes, sha256, newDoc, body, prim, IDENTITY } from "./helpers.mjs";

const proj = (f) => { const j = JSON.parse(readFileSync(new URL(`./projects/${f}.json`, import.meta.url), "utf8")); return j.doc || j; };
const shell = (th, extra = {}) => ({ id: "s1", seq: 2, t: "shell", th, faces: [{ c: [0, 0, 20] }], ...extra });
const moved = (x) => { const m = [...IDENTITY]; m[12] = x; return m; };
// the design under test: a filleted (rounded) box with a tangent-chain shell, the same box shelled outwards and closed, and a box with a filleted edge shelled
const target = newDoc("determinism", "advanced", {
  bodies: [
    body("b1", "Rounded shell", prim("box", { w: 30, d: 30, h: 20, r: 4, c: 0 }, [shell(2, { chain: true })])),
    body("b2", "Outer shell", prim("box", { w: 30, d: 30, h: 20, r: 0, c: 0 }, [shell(2, { dir: "out" })]), moved(40)),
    body("b3", "Closed rounded", prim("box", { w: 30, d: 30, h: 20, r: 4, c: 0 }, [{ id: "s1", seq: 2, t: "shell", th: 2, faces: [] }]), moved(80)),
    body("b4", "Fillet then shell", prim("box", { w: 30, d: 30, h: 20, r: 0, c: 0 }, [
      { id: "f1", seq: 2, t: "fillet", r: 3, edges: [{ a: [-15, -15, 20], b: [15, -15, 20], m: [0, -15, 20], n: [0.5, 0, 1], t: "LINE" }] },
      { id: "s1", seq: 3, t: "shell", th: 2, faces: [{ c: [0, 0, 20] }] }]), moved(120)),
  ],
});
// other designs, each different in size and in how many shapes it builds, to leave the engine's memory in a different state
const filler = (k) => newDoc("filler" + k, "advanced", {
  bodies: Array.from({ length: 2 + k * 3 }, (_, i) => body("f" + i, "Box", prim("box", { w: 7 + k * 5 + i, d: 9 + i, h: 5 + k, r: i % 3 ? 0 : 1, c: 0 }), moved(i * 20))),
});
const fillers = [() => filler(1), () => filler(2), () => filler(3), () => proj("advanced-shell"), () => proj("advanced-thread"), () => filler(5)];

let page, errors;
test.beforeAll(async ({ browser }, info) => { page = await browser.newPage(); errors = watchErrors(page); await boot(page, info); });
test.afterAll(async () => { await page.close(); });

// forget every built shape and mesh, in the page and in the engine, so the next load builds from scratch
const forget = () => page.evaluate(() => { const k = window.__app.kernel; k.meshes.clear(); k.worker.postMessage({ type: "clear" }); });
async function exportsOf(doc) {
  await loadDoc(page, doc);
  const list = await bodies(page);
  expect(list.filter((b) => b.error), "kernel errors").toEqual([]);
  const out = {};
  for (const k of ["stl", "obj", "3mf"]) out[k] = sha256((await exportBytes(page, k)).bytes);
  return out;
}

test("the same design exports the same bytes whatever was built before it", async () => {
  test.setTimeout(600_000);
  const first = await exportsOf(target);
  for (let i = 0; i < fillers.length; i++) {
    for (let j = 0; j <= i; j++) await exportsOf(fillers[j]());
    await forget();
    expect(await exportsOf(target), `after ${i + 1} other designs`).toEqual(first);
  }
  expect(errors, "console errors").toEqual([]);
});

test("a fresh page gives the same bytes as the first build", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const reference = await exportsOf(target);
  const other = await browser.newPage();
  try {
    await boot(other, info);
    for (const make of [fillers[0], fillers[3]]) { await loadDoc(other, make()); }
    await loadDoc(other, target);
    const got = {};
    for (const k of ["stl", "obj", "3mf"]) got[k] = sha256((await exportBytes(other, k)).bytes);
    expect(got).toEqual(reference);
  } finally { await other.close(); }
});
