// Upstream 2.9.8.2 (J.Siwek), shared by the site and single-file projects. One outcome test per headline change:
//  - About keeps his "New in version 2.9.8.2" note (the version itself: upstream29898.spec.mjs)
//  - Texture tool: four new groups (Seasons, Holidays, Celebrations, Animals) of picture textures drawn on a canvas the first
//    time they are needed (src/texture_themes.js); one applies to a whole body without errors
//  - picture textures (pic: true) subdivide the surface finely, like imported pictures: a much finer mesh than a plain texture
//    of the same tile size
// His own tests (JumpStart-3D-v2.9.8.2-full-source/tests/tthemetex.cjs, tsa2982.cjs) are screenshot scripts; the checks below assert real state.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim } from "./helpers.mjs";

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
const plaque = () => newDoc("Picture texture", "advanced", { bodies: [body("bx", "Plaque", prim("box", { w: 80, d: 80, h: 6 }))] });
// triangles in the body's shown mesh, once it has settled (a texture is applied after the solid is built)
async function triangles(id) {
  await waitIdle(page);
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const n = await run((id) => { const v = window.__app.scene.views.get(id); return v && v.data ? v.data.triangles.length / 3 : 0; }, id);
    if (n > 0 && n === last) return n;
    last = n;
    await page.waitForTimeout(250);
    await waitIdle(page);
  }
  return last;
}

// the version itself is upstream29898.spec.mjs's job since 2.9.8.9.8; his 2.9.8.2 notes stay in About
test("About keeps his notes for 2.9.8.2", async () => {
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  for (const t of ["New in version 2.9.8.2", "Seasonal & holiday textures", "New in version 2.9.8.1"]) await expect(about).toContainText(t);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

test("Texture tool: the four picture groups are listed, and Squirrels applies to a whole body without errors", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, plaque());
  await run(() => window.__app.select(["bx"]));
  await page.click("#ad-decorate");
  await page.click("#ad-texture");
  await expect(page.locator("#cmd")).toBeVisible();
  const cats = page.locator("#tx-cats button");
  for (const c of ["Seasons", "Holidays", "Celebrations", "Animals"]) await expect(cats.filter({ hasText: c })).toHaveCount(1);
  const counts = {};
  for (const c of ["Seasons", "Holidays", "Celebrations", "Animals"]) {
    await cats.filter({ hasText: c }).click();
    counts[c] = await page.locator("#tx-grid .tx-item[data-key]").count();
  }
  expect(Object.values(counts).reduce((a, b) => a + b, 0), JSON.stringify(counts)).toBe(50);
  for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);
  await cats.filter({ hasText: "Animals" }).click();
  await expect(page.locator('#tx-grid [data-key="squirrels"]')).toBeVisible();
  if (await page.locator("#tx-all").count()) await page.click("#tx-all");
  await page.click('#tx-grid [data-key="squirrels"]');
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  const n = await triangles("bx");
  await okAll();
  const tex = await run(() => window.__store.doc.bodies.find((b) => b.id === "bx").textures);
  expect(tex.length).toBe(1);
  expect(tex[0].tex).toBe("squirrels");
  expect(tex[0].faces).toBe("all");
  expect(n, "the picture texture made a real textured mesh").toBeGreaterThan(5000);
});

test("a picture texture makes a much finer mesh than a plain texture of the same tile size", async () => {
  test.setTimeout(180_000);
  const layer = (tex) => ({ id: "t1", seq: 2, faces: "all", tex, size: 40, depth: 0.6, dir: "raise", rot: 0, mapping: "auto", falloff: 0, invert: false, once: false });
  const doc = plaque();
  doc.bodies[0].textures = [layer("stucco")];
  await loadDoc(page, doc);
  const plain = await triangles("bx");
  await okAll();
  const doc2 = plaque();
  doc2.id += "_pic";
  doc2.bodies[0].textures = [layer("squirrels")];
  await loadDoc(page, doc2);
  const pic = await triangles("bx");
  await okAll();
  expect(plain).toBeGreaterThan(0);
  expect(pic, `picture ${pic} vs plain ${plain} triangles`).toBeGreaterThan(4 * plain);
});
