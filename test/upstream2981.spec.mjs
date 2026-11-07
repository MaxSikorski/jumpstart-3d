// Upstream 2.9.8.1 (J.Siwek), shared by the site and single-file projects. One outcome test per headline change:
//  - About still lists his "New in version 2.9.8.1" note (the version itself: the newest upstream spec)
//  - Box Maker door catch (doorCatch none / light / firm): two small round bumps on the case's far wall, just in front of the
//    shut door's free edge, reaching past the edge by 0.35 (light) or 0.7 (firm) beyond the clearance
//  - his fix: the case's hollow is cut first and the inside things (stop strips, catch bumps) go on after, so both are really there
//    (this replaces our build-31 fix in bins.js)
// His own tests (JumpStart-3D-v2.9.8.1-full-source/tests/tdoorcatch.cjs, tsa2981.cjs) are screenshot scripts; the checks below assert real state.
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

// one door case through the dialog (Advanced → Simulate → Box Maker), with the given catch
async function makeDoor(doorCatch) {
  await page.click("#ws-simulate");
  await page.click("#sim-bins");
  await expect(page.locator("#cmd")).toBeVisible();
  await page.locator("#bn-style button", { hasText: "Door" }).click();
  for (const k of ["units", "across"]) { await page.locator("#bn-" + k).fill("1"); await page.locator("#bn-" + k).press("Tab"); }
  await page.locator("#bn-catch button", { hasText: doorCatch }).click();
  await page.locator("#bn-layout button", { hasText: "Assembled" }).click();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  await page.click("#ws-design");
  return run(() => { const main = window.__store.doc.bodies.filter((b) => b.bin).pop(); return { id: main.id, bin: main.bin }; });
}

// the case's vertices inside the hollow in front of the shut door (y within 2 of the front), away from floor and ceiling:
// only the catch bumps are there. Returns how many, how far the furthest reaches in from the far (right) wall, and
// how many sit in the lower and upper half
const bumps = (s) => run(({ id, o }) => {
  const P = window.__app.scene.views.get(id).data.vertices, wall = o.w / 2 - o.caseT;
  let n = 0, reach = 0, low = 0, high = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (y < -o.d / 2 + 0.01 || y > -o.d / 2 + 2 || x <= 0 || x > wall - 1e-3 || z < 8 || z > o.h - 8) continue;
    n++; reach = Math.max(reach, wall - x); if (z < o.h / 2) low++; else high++;
  }
  return { n, reach, low, high };
}, { id: s.id, o: s.bin });

test("About still lists his notes for 2.9.8.1", async () => {
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  for (const t of ["New in version 2.9.8.1", "Box Maker door catch:", "New in version 2.9.8"]) await expect(about).toContainText(t);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

test("door catch: light and firm put two bumps on the far wall in front of the door (firm reaches further); none has no bumps", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Door catch", "advanced"));
  const out = {};
  for (const c of ["None", "Light", "Firm"]) { const s = await makeDoor(c); out[c] = { doorCatch: s.bin.doorCatch, clear: s.bin.clear, ...(await bumps(s)) }; }
  await okAll();
  expect(out.None.doorCatch).toBe("none");
  expect(out.Light.doorCatch).toBe("light");
  expect(out.Firm.doorCatch).toBe("firm");
  expect(out.None.n, "no bumps without a catch").toBe(0);
  for (const c of ["Light", "Firm"]) {
    expect(out[c].low, c + ": a bump in the lower half").toBeGreaterThan(0);
    expect(out[c].high, c + ": a bump in the upper half").toBeGreaterThan(0);
  }
  // each reaches in from the wall by the clearance plus its grip (a faceted sphere reaches a little less)
  const cl = out.Light.clear;
  expect(out.Light.reach).toBeGreaterThan(cl + 0.35 - 0.1); expect(out.Light.reach).toBeLessThan(cl + 0.35 + 0.01);
  expect(out.Firm.reach).toBeGreaterThan(cl + 0.7 - 0.1); expect(out.Firm.reach).toBeLessThan(cl + 0.7 + 0.01);
});

test("his fix: the door stop strips stay after the hollow is cut, alongside the catch bumps", async () => {
  test.setTimeout(120_000);
  await loadDoc(page, newDoc("Door stop", "advanced"));
  const s = await makeDoor("Firm");
  await okAll();
  const o = s.bin, t = o.caseT, cl = o.clear;
  const lockDepth = o.lock === "dovetail" ? 3 + cl + 0.2 : o.lock === "pegs" ? 3.6 : 0;
  const tb = Math.max(t, lockDepth ? lockDepth + 1.2 : 0), lip = cl + 1.4, iw = o.w - 2 * t;
  const sy = -o.d / 2 + 2 + 3.2 / 2 + 3.2 / 2 + 0.3 + 0.8; // behind the 3.2 mm door, set back 2 from the front
  const span = (z) => run(({ id, z, sy }) => {
    const P = window.__app.scene.views.get(id).data.vertices;
    let x0 = 1e9, x1 = -1e9;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 2] - z) < 1e-3 && Math.abs(P[i + 1] - sy) < 0.8 + 1e-3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); }
    return x1 - x0;
  }, { id: s.id, z, sy });
  expect(await span(tb + lip), "a strip along the floor, most of the width").toBeGreaterThan(iw * 0.6);
  expect(await span(o.h - t - lip), "a strip along the ceiling, most of the width").toBeGreaterThan(iw * 0.6);
  // the far-side strip: case vertices on its inner face (x = wall - 1.6) at the strip's depth, most of the inside height
  const side = await run(({ id, x, sy }) => {
    const P = window.__app.scene.views.get(id).data.vertices;
    let z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - x) < 0.02 && Math.abs(P[i + 1] - sy) < 0.8 + 1e-3) { z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
    return z1 - z0;
  }, { id: s.id, x: iw / 2 - 1.6, sy });
  expect(side, "a strip up the far side, most of the inside height").toBeGreaterThan((o.h - tb - t) * 0.6);
  const b = await bumps(s);
  expect(b.low).toBeGreaterThan(0); expect(b.high).toBeGreaterThan(0);
});
