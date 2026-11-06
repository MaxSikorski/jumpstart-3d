// Upstream 2.7.1 regressions (J.Siwek's CosForge cosplay designer from 2.6, the Form step from 2.7, the Modern Sci-Fi style from 2.7.1,
// and the CAM Studio changes), shared by the site and single-file projects. His own tests (JumpStart-3D-v2.7.1-full-source/tests/cftest.cjs,
// cf_form.cjs, rel_cf.cjs) are data only here. CosForge is a window of its own over the design: __app.cosforge._t() is its test handle.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, reload } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

test.describe("version 2.7.1", () => {
  let page, errors;
  test.beforeAll(async ({ browser }, info) => {
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    errors = watchErrors(page);
    await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await boot(page, info);
  });
  test.afterAll(async () => { await page.close(); });
  test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

  // CosForge builds each part in a pause after an edit; "ready" is its own idea of being finished (nothing pending, no busy bar, every part built)
  const ready = async (ms = 180_000) => {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => window.__app.cosforge._t().ready(), null, { timeout: ms });
    await page.waitForTimeout(250);
  };
  const cf = (fn, arg) => page.evaluate(fn, arg);
  const openFromAdvanced = async () => {
    await page.click("#mode-advanced");
    await page.click("#ws-simulate");
    await page.click("#sim-cosforge");
    await expect(page.locator("#cosforge")).toBeVisible();
  };
  const closeCosForge = async () => { await page.click("#cf-back"); await expect(page.locator("#cosforge")).toBeHidden(); };
  // open edges of a part's built pieces: every triangle edge must have its twin; the number of edges without one
  const openEdges = (index) => cf((index) => {
    const t = window.__app.cosforge._t();
    let open = 0, tris = 0;
    const parts = index == null ? t.st.parts.filter((q) => !q.hidden) : [t.st.parts[index]];
    for (const q of parts) for (const pc of t.build(q).pieces) {
      const E = new Set(), I = pc.mesh.idx;
      tris += I.length / 3;
      for (let k = 0; k < I.length; k += 3) for (let e = 0; e < 3; e++) E.add(I[k + e] + "_" + I[k + (e + 1) % 3]);
      for (const key of E) { const [a, b] = key.split("_"); if (!E.has(b + "_" + a)) open++; }
    }
    return { open, tris };
  }, index);
  // how many cage points of the first part are off their template position (the form is made on the first edit)
  const movedPoints = () => cf(() => { const f = window.__app.cosforge._t().st.parts[0].form; return f ? f.d.filter((v) => v).length : 0; });
  const bbox = (index) => cf((index) => {
    const t = window.__app.cosforge._t();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const pc of t.build(t.st.parts[index]).pieces) for (let i = 0; i < pc.mesh.pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pc.mesh.pos[i + a]); hi[a] = Math.max(hi[a], pc.mesh.pos[i + a]); }
    return { lo, hi };
  }, index);

  test("the splash and About show the version with the 2.7.1 and 2.6 notes", async () => {
    expect(VERSION).toMatch(/^2\.\d+\./); // 2.7.3 and later keep these notes (upstream2813.spec.mjs checks the newest)
    const label = `Version ${VERSION} · community build ${BUILD}`;
    expect(await page.locator("#sp-ver").textContent()).toBe(label);
    await page.click("#btn-about");
    const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
    await expect(about).toContainText(label);
    await expect(about).toContainText("New in version 2.7.1");
    await expect(about).toContainText("Modern Sci-Fi armor");
    await expect(about).toContainText("New in version 2.6");
    await expect(about).toContainText("Created by J.Siwek");
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();
  });

  test("CosForge opens from Beginner and from Advanced, and builds a mannequin from the measurements", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 open", "beginner"));
    await page.click("#bb-cosforge");
    await expect(page.locator("#cosforge")).toBeVisible();
    expect(await cf(() => window.__app.cosforge.isOpen)).toBe(true);
    await closeCosForge();
    expect(await cf(() => window.__app.cosforge.isOpen)).toBe(false);

    await openFromAdvanced();
    // a measurement preset changes the mannequin: the body is rebuilt for the new height
    await page.click("#cf-preset-teen");
    await expect.poll(() => cf(() => window.__app.cosforge._t().st.meas.height)).toBe(1560);
    const teen = await cf(() => { const t = window.__app.cosforge._t(); return { head: t.B.z.chest, st: t.st.meas.height }; });
    await page.click("#cf-preset-broad");
    await expect.poll(() => cf(() => window.__app.cosforge._t().st.meas.height)).toBeGreaterThan(1560);
    const tall = await cf(() => window.__app.cosforge._t().B.z.chest);
    expect(tall, "chest height follows the measurements").toBeGreaterThan(teen.head);
    await closeCosForge();
  });

  test("a part from a template is added to the design as a real body", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 add", "advanced"));
    await openFromAdvanced();
    await page.click("#cf-step-parts");
    await page.locator("#cf-tpl-basic-chest").click();
    await ready();
    expect(await cf(() => window.__app.cosforge._t().st.parts.map((p) => p.slot))).toEqual(["chest"]);
    const edges = await openEdges();
    expect(edges.tris).toBeGreaterThan(100);
    expect(edges.open, "the chest is watertight").toBe(0);

    await page.click("#cf-step-export");
    await page.locator("#cf-x-what button", { hasText: "Whole outfit" }).click();
    await page.click("#cf-x-design");
    await page.waitForFunction(() => !window.__app.cosforge.isOpen, null, { timeout: 120_000 });
    await waitIdle(page);
    const list = await bodies(page);
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) { expect(b.error, b.name).toBeNull(); expect(b.volume, b.name + " volume").toBeGreaterThan(0); }
    const made = await cf(() => window.__store.doc.bodies.filter((b) => b.cosforge).length);
    expect(made, "bodies marked as made by CosForge").toBe(list.length);
    // the same bodies through the page API: a bounding box with size
    const entries = await cf(() => window.JS3D.list());
    expect(entries.length).toBe(list.length);
    for (const e of entries) { expect(e.kind).toBe("mesh"); expect(e.bbox.max[0] - e.bbox.min[0]).toBeGreaterThan(10); }
  });

  test("the Modern Sci-Fi style has its templates and each one builds a closed shell", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 modern", "advanced"));
    await openFromAdvanced();
    await page.click("#cf-step-parts");
    await expect(page.locator("#cf-theme-modern")).toHaveText("Modern Sci-Fi");
    await page.click("#cf-theme-modern");
    await expect(page.locator("#cf-theme-modern")).toHaveAttribute("aria-pressed", "true");
    // the cards are the style's templates: 27 of them, each with its own id, covering head to toe
    await expect(page.locator(".cf-card")).toHaveCount(27);
    const cards = await page.locator(".cf-card").evaluateAll((els) => els.map((e) => ({ id: e.id, sub: e.querySelector("small").textContent })));
    expect(new Set(cards.map((c) => c.id)).size).toBe(27);
    for (const c of cards) expect(c.sub, c.id).toMatch(/Modern Sci-Fi$/);
    for (const slot of ["Helmet", "Chest", "Back", "Knee", "Shield"]) expect(cards.some((c) => c.sub.startsWith(slot)), slot).toBe(true);
    await expect(page.locator("#cf-addset")).toContainText("Modern Sci-Fi");
    // one card builds a part, and the part is closed
    await page.locator("#cf-tpl-vanguard-chest").click();
    await ready();
    expect(await cf(() => window.__app.cosforge._t().st.parts.map((p) => p.slot))).toEqual(["chest"]);
    const one = await openEdges(0);
    expect(one.tris).toBeGreaterThan(500);
    expect(one.open, "Vanguard Chest is watertight").toBe(0);
    // the whole set at once: more pieces, all closed
    await page.click("#cf-addset");
    await ready(300_000);
    const total = await cf(() => window.__app.cosforge._t().totals);
    expect(total.pieces).toBeGreaterThanOrEqual(10);
    const all = await openEdges();
    expect(all.open, `all ${total.pieces} pieces of the set are watertight`).toBe(0);
    // an STL of the pieces is a zip with real content
    await page.click("#cf-step-export");
    await page.locator("#cf-x-fmt button", { hasText: "STL" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), page.click("#cf-x-go")]);
    const stream = await dl.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    expect(dl.suggestedFilename()).toMatch(/\.(zip|stl)$/i);
    expect(bytes.length, "exported file size").toBeGreaterThan(10_000);
    await closeCosForge();
  });

  test("the Form step: moving cage points changes the part's geometry, and undo takes it back", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 form", "advanced"));
    await openFromAdvanced();
    await page.click("#cf-step-parts");
    await page.locator("#cf-tpl-basic-chest").click();
    await ready();
    const before = await bbox(0);
    await page.click("#cf-step-form");
    await page.waitForFunction(() => !!window.__app.cosforge._t().cage(), null, { timeout: 30_000 });
    const cage = await cf(() => { const c = window.__app.cosforge._t().cage(); return { nu: c.f.nu, nv: c.f.nv }; });
    expect(cage.nu * cage.nv).toBeGreaterThan(20);
    expect(await movedPoints()).toBe(0);
    // select every point and pull the surface out twice
    await page.click("#cf-fm-all");
    expect(await cf(() => window.__app.cosforge._t().form.sel.size)).toBe(cage.nu * cage.nv);
    await page.click("#cf-fm-out");
    await page.click("#cf-fm-out");
    await ready();
    const moved = await movedPoints();
    expect(moved).toBeGreaterThan(0);
    const after = await bbox(0);
    const grew = [0, 1, 2].some((a) => after.hi[a] - after.lo[a] > before.hi[a] - before.lo[a] + 1);
    expect(grew, `bounding box before ${JSON.stringify(before)} after ${JSON.stringify(after)}`).toBe(true);
    expect((await openEdges(0)).open, "still watertight after the edit").toBe(0);
    // subdividing keeps the edit
    await page.click("#cf-fm-sub");
    await ready();
    const sub = await cf(() => { const f = window.__app.cosforge._t().st.parts[0].form; return { nu: f.nu, moved: f.d.filter((v) => v).length }; });
    expect(sub.nu).toBeGreaterThan(cage.nu);
    expect(sub.moved).toBeGreaterThan(0);
    // undo puts the geometry back
    // undo until the part is back at its template form (nearby edits may be one history step), but never as far as the part itself
    for (let i = 0; i < 4 && (await movedPoints()) > 0; i++) { await page.click("#cf-undo"); await ready(); }
    expect(await cf(() => window.__app.cosforge._t().st.parts.length)).toBe(1);
    expect(await movedPoints()).toBe(0);
    const back = await bbox(0);
    for (let a = 0; a < 3; a++) { expect(back.hi[a]).toBeCloseTo(before.hi[a], 1); expect(back.lo[a]).toBeCloseTo(before.lo[a], 1); }
    await closeCosForge();
  });

  test("the costume is kept in the design across a save and a reload", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 keep", "advanced"));
    await openFromAdvanced();
    await page.click("#cf-step-parts");
    await page.locator("#cf-tpl-basic-chest").click();
    await ready();
    await page.click("#cf-step-form");
    await page.click("#cf-fm-all");
    await page.click("#cf-fm-out");
    await ready();
    const mark = await cf(() => { const t = window.__app.cosforge._t(); return { n: t.st.parts.length, d: t.st.parts[0].form.d.filter((v) => v).length, slot: t.st.parts[0].slot }; });
    expect(mark.d).toBeGreaterThan(0);
    // closing the window writes the costume into the design
    await closeCosForge();
    expect(await cf(() => !!window.__store.doc.cosforge)).toBe(true);
    await cf(() => window.__app.projects.saveNow());
    await reload(page);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready && window.__app.projects.started === true, null, { timeout: 90_000 });
    const kept = await cf(() => { const raw = window.__store.doc.cosforge, c = typeof raw === "string" ? JSON.parse(raw) : raw; return c ? { n: c.parts.length, slot: c.parts[0].slot, d: c.parts[0].form.d.filter((v) => v).length } : null; });
    expect(kept).toEqual(mark);
    // and it opens again with the same parts
    await openFromAdvanced();
    expect(await cf(() => { const t = window.__app.cosforge._t(); return { n: t.st.parts.length, d: t.st.parts[0].form.d.filter((v) => v).length }; })).toEqual({ n: mark.n, d: mark.d });
    await closeCosForge();
  });

  test("the page API refuses to edit or replace the design while CosForge is open, and works once it is closed", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 api", "advanced", { bodies: [body("b1", "Block", prim("box", { w: 20, d: 20, h: 10, r: 0, c: 0 }))] }));
    await openFromAdvanced();
    const snap = () => cf(() => JSON.stringify(window.JS3D.list().map((e) => [e.id, e.name])));
    const before = await snap();
    const tries = await cf(() => {
      const out = {};
      for (const [k, fn] of [["newDesign", () => window.JS3D.newDesign("beginner")], ["add", () => window.JS3D.add("box")]]) {
        try { fn(); out[k] = "allowed"; } catch (e) { out[k] = e.message; }
      }
      return out;
    });
    expect(tries).toEqual({ newDesign: "close CosForge first", add: "close CosForge first" });
    expect(await snap()).toBe(before);
    expect(await cf(() => window.__store.doc.name)).toBe("Upstream 2.7.1 api");
    await closeCosForge();
    await cf(() => window.JS3D.add("box"));
    await waitIdle(page);
    expect((await cf(() => window.JS3D.list())).length).toBe(2);
    await cf(() => window.JS3D.newDesign("advanced"));
    expect(await cf(() => window.JS3D.list().length)).toBe(0);
  });

  test("CAM Studio still opens and makes G-code from a part", async () => {
    await loadDoc(page, newDoc("Upstream 2.7.1 cam", "advanced", { bodies: [body("b1", "Block", prim("box", { w: 40, d: 30, h: 10, r: 0, c: 0 }))] }));
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    await page.click("#ws-simulate");
    await page.click("#sim-cam");
    await expect(page.locator("#cam-side")).toBeVisible();
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.result && u.done; }, null, { timeout: 90_000 });
    const g = await cf(() => window.__app.cam._ui().result.gcode);
    expect(g.split("\n").length).toBeGreaterThan(20);
    expect(g).toMatch(/\bG0?1\b/);
    expect(g).toMatch(/\bM30\b|\bM2\b|\bM02\b/);
    await page.click("#cam-close");
    await expect(page.locator("#cam-side")).toHaveCount(0);
  });
});
