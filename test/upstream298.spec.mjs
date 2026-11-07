// Upstream 2.9.8 (J.Siwek), shared by the site and single-file projects. One outcome test per headline feature:
//  - About still lists his "New in version 2.9.8" note (the version itself: the newest upstream spec)
//  - Box Maker grids: across as well as high; parts keyed down each column then across, named A1, A2, B1, B2
//  - side joints: dovetail rails or pegs stand out of each box's right side; flat sides add nothing
//  - doors open outwards only: a stop strip behind the door along the case floor and ceiling (in his 2.9.8 the case's inside cut
//    removed the strips again; his 2.9.8.1 adds them after the cut)
// His own tests (JumpStart-3D-v2.9.8-full-source/tests/tbingrid.cjs, tsa298.cjs) are screenshot scripts; the checks below assert real state.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const okAll = async () => { const list = await bodies(page); for (const b of list) expect(b.error, b.name).toBeNull(); return list; };

// make a Box Maker set through the dialog (Advanced → Simulate → Box Maker)
async function makeSet({ style, units, across, sideLock }) {
  await page.click("#ws-simulate");
  await page.click("#sim-bins");
  await expect(page.locator("#cmd")).toBeVisible();
  await page.locator("#bn-style button", { hasText: style }).click();
  for (const [k, v] of [["units", units], ["across", across]]) { await page.locator("#bn-" + k).fill(String(v)); await page.locator("#bn-" + k).press("Tab"); }
  if (sideLock) await page.locator("#bn-sidelock button", { hasText: sideLock }).click();
  if (units > 1 || across > 1 || style !== "Open bin") await page.locator("#bn-layout button", { hasText: "Assembled" }).click();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  await page.click("#ws-design");
}
// the newest set's main body and its parts
const lastSet = () => run(() => {
  const all = window.__store.doc.bodies, main = all.filter((b) => b.bin).pop();
  const parts = all.filter((b) => b.binPart === main.id).map((b) => ({ id: b.id, name: b.name, m: b.m }));
  return { id: main.id, name: main.name, bin: main.bin, m: main.m, parts };
});
// the extent of a body's mesh in its own frame
const extent = (id) => run((id) => {
  const P = window.__app.scene.views.get(id).data.vertices, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return { lo, hi };
}, id);

test("About still lists his notes for 2.9.8 and 2.9.7.1", async () => {
  // the version and splash label are checked by the newest upstream spec (upstream2981.spec.mjs)
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  for (const t of ["New in version 2.9.8", "Box Maker grids:", "Doors open outwards only:", "New in version 2.9.7.1"]) await expect(about).toContainText(t);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

test("Box Maker grid: 2 across and 2 high makes 4 bins, keyed down each column then across and named A1, A2, B1, B2", async () => {
  test.setTimeout(120_000);
  await loadDoc(page, newDoc("Grid", "advanced"));
  await makeSet({ style: "Open bin", units: 2, across: 2, sideLock: "None" });
  const list = await okAll();
  expect(list.length, "4 bins").toBe(4);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(1000);
  const s = await lastSet();
  expect(s.bin.units).toBe(2);
  expect(s.bin.across).toBe(2);
  expect(Object.keys(s.bin.ids).sort()).toEqual(["bin1", "bin2", "bin3"]);
  const byKey = Object.fromEntries(Object.entries(s.bin.ids).map(([k, id]) => [k, s.parts.find((p) => p.id === id)]));
  // bin1 is the second in column A (above the first), bin2 and bin3 are column B
  expect(byKey.bin1.name).toBe(s.name + " · bin A2");
  expect(byKey.bin2.name).toBe(s.name + " · bin B1");
  expect(byKey.bin3.name).toBe(s.name + " · bin B2");
  const at = (p) => [p.m[12] - s.m[12], p.m[13] - s.m[13], p.m[14] - s.m[14]];
  expect(at(byKey.bin1)[0]).toBeCloseTo(0, 3); expect(at(byKey.bin1)[2]).toBeGreaterThan(5);
  expect(at(byKey.bin2)[0]).toBeCloseTo(s.bin.w, 3); expect(at(byKey.bin2)[2]).toBeCloseTo(0, 3);
  expect(at(byKey.bin3)[0]).toBeCloseTo(s.bin.w, 3); expect(at(byKey.bin3)[2]).toBeCloseTo(at(byKey.bin1)[2], 3);
});

test("side joints: dovetail rails and pegs stand 3 mm out of each bin's right side; with flat sides the bin is exactly its width", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Side joints", "advanced"));
  const out = {};
  for (const lock of ["Dovetail rails", "Pegs", "None"]) {
    await makeSet({ style: "Open bin", units: 1, across: 2, sideLock: lock });
    const s = await lastSet();
    expect(s.parts.length, lock + ": two bins side by side").toBe(1);
    const e = await extent(s.id);
    out[lock] = { lock: s.bin.sideLock, left: e.lo[0] + s.bin.w / 2, right: e.hi[0] - s.bin.w / 2 };
  }
  await okAll();
  expect(out["Dovetail rails"].lock).toBe("dovetail");
  expect(out["Pegs"].lock).toBe("pegs");
  expect(out["None"].lock).toBe("none");
  for (const lock of ["Dovetail rails", "Pegs"]) {
    expect(out[lock].right, lock + " stand out on the right").toBeCloseTo(3, 1);
    expect(out[lock].left, lock + ": the left side stays flat (grooves or holes cut into it)").toBeCloseTo(0, 2);
  }
  expect(out["None"].right).toBeCloseTo(0, 2);
  expect(out["None"].left).toBeCloseTo(0, 2);
});

test("doors open outwards only: a stop strip runs just behind the door along the case floor and ceiling", async () => {
  test.setTimeout(120_000);
  await loadDoc(page, newDoc("Door stop", "advanced"));
  await makeSet({ style: "Door", units: 1, across: 1 });
  await okAll();
  const s = await lastSet();
  const o = s.bin, t = o.caseT, cl = o.clear;
  const lockDepth = o.lock === "dovetail" ? 3 + cl + 0.2 : o.lock === "pegs" ? 3.6 : 0;
  const tb = Math.max(t, lockDepth ? lockDepth + 1.2 : 0), lip = cl + 1.4, iw = o.w - 2 * t;
  const sy = -o.d / 2 + 2 + 3.2 / 2 + 3.2 / 2 + 0.3 + 0.8; // behind the 3.2 mm door, set back 2 from the front
  // the case's vertices on the top face of the floor strip, and on the bottom face of the ceiling strip
  const span = (z) => run(({ id, z, sy }) => {
    const P = window.__app.scene.views.get(id).data.vertices;
    let x0 = 1e9, x1 = -1e9;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 2] - z) < 1e-3 && Math.abs(P[i + 1] - sy) < 0.8 + 1e-3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); }
    return x1 - x0;
  }, { id: s.id, z, sy });
  expect(await span(tb + lip), "a strip along the floor, most of the width").toBeGreaterThan(iw * 0.6);
  expect(await span(o.h - t - lip), "a strip along the ceiling, most of the width").toBeGreaterThan(iw * 0.6);
});
