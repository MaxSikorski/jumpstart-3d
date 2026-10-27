import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, loadDoc, newDoc, body, prim, IDENTITY, waitIdle, bodies, watchErrors, quarantine, exportBytes, stlTriangles } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage(); errors = watchErrors(page); await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors).toEqual([]); });
const run = (fn, arg) => page.evaluate(fn, arg);
const translated = (x, y, z) => { const m = IDENTITY.slice(); m.splice(12, 3, x, y, z); return m; };
const box = (id, w, d, h, m = IDENTITY) => body(id, id === "target" ? "Block" : id, prim("box", { w, d, h }), m);
const fixture = (mode, width = 22, z = 9) => newDoc("Combine pieces", mode, { bodies: [box("target", 20, 20, 20), box("cutter", width, 22, 2, translated(0, 0, z))] });
async function combine(mode, op = "Cut", keep = false) {
  if (mode === "beginner") {
    await run(() => JS3D.select(["cutter"]));
    await page.locator(".solidhole").getByRole("button", { name: "Hole", exact: true }).click();
    await run(() => JS3D.select(["target", "cutter"]));
  } else {
    await run(() => JS3D.select(__store.doc.bodies.map(b => b.id)));
    await page.click("#ad-advmod"); await page.click("#ad-combine");
    await page.locator("#cb-op").getByRole("button", { name: op, exact: true }).click();
    if (keep) await page.check("#cb-keep");
  }
  const before = await run(() => ({ depth: __store.undoStack.length, bodies: JS3D.doc().bodies }));
  await page.click(mode === "beginner" ? "#bb-group" : "#cmd-ok");
  await expect.poll(() => run(() => __store.undoStack.length)).toBe(before.depth + 1);
  await waitIdle(page);
  return before;
}
async function expectVolumes(want) {
  const got = await bodies(page);
  expect(got.map(b => b.error)).toEqual(want.map(() => null));
  expect(got.map(b => b.volume).sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
  return got;
}
async function clickPiece(z) {
  const xy = await run((z) => {
    const v = __app.vp, V = v.camera.position.constructor;
    __app.needFit = false;
    v.animateTo({ az: -Math.PI / 2, el: 0.25, dist: 100, target: new V(0, 0, 10) }, 10);
    if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms);
    v.render();
    const p = v.project(new V(-7, -10, z)), r = v.canvas.getBoundingClientRect();
    return [r.left + p[0], r.top + p[1]];
  }, z);
  await page.mouse.click(...xy);
}

for (const mode of ["advanced", "beginner"]) {
  test(`${mode}: a through cut creates two selectable, movable bodies in one undo step and survives reopening`, async () => {
    await loadDoc(page, fixture(mode));
    const before = await combine(mode);
    const pieces = await expectVolumes([3600, 3600]);
    const original = await run(() => JS3D.doc().bodies);
    expect(original.map(b => b.color)).toEqual(["#3b82c4", "#3b82c4"]);
    expect(original[1].name).toBe(original[0].name + " (split)");
    if (mode === "advanced") expect(original[0]).toMatchObject({ id: "target", name: "Block" });
    // Undo immediately: no later edit can mask a second commit made by splitting.
    await run(() => JS3D.undo()); await waitIdle(page);
    expect(await run(() => JS3D.doc().bodies)).toEqual(before.bodies);
    await run(() => JS3D.redo()); await waitIdle(page);
    await clickPiece(4);
    expect(await run(() => JS3D.selection())).toEqual([pieces[0].id]);
    await clickPiece(15);
    expect(await run(() => JS3D.selection())).toEqual([pieces[1].id]);
    await run(id => JS3D.move([id], [30, 0, 0]), pieces[1].id); await waitIdle(page);
    const moved = await run(() => JS3D.doc().bodies);
    expect(moved[0]).toEqual(original[0]);
    expect(moved[1].m[12]).toBe(original[1].m[12] + 30);
    const saved = await run(() => JS3D.save());
    await run(async saved => { await JS3D.newDesign("beginner"); await JS3D.load(saved); }, saved);
    await expectVolumes([3600, 3600]);
    expect(await run(() => JS3D.doc().bodies)).toEqual(moved);
    await page.click("#btn-save");
    await expect(page.locator("#toasts")).toContainText("Saved as");
    await boot(page, test.info()); await waitIdle(page);
    await expectVolumes([3600, 3600]);
    expect(await run(() => JS3D.doc().bodies)).toEqual(moved);
  });
  test(`${mode}: a cut that leaves a connecting wall remains one body`, async () => {
    await loadDoc(page, fixture(mode, 18)); await combine(mode);
    await expectVolumes([7280]);
  });
}

// A cutter 1e-6 mm above the floor leaves a film of 4e-4 mm3 under the real block; it must not become a stray body (the Pi-lid run showed one).
for (const mode of ["advanced", "beginner"]) {
  test(`${mode}: a cut that leaves a near-empty film gives one body, one solid, one exported solid`, async () => {
    await loadDoc(page, fixture(mode, 22, 1e-6)); await combine(mode);
    await expectVolumes([7200]);
    const only = await run(() => ({ n: JS3D.doc().bodies.length, solids: __app.scene.views.get(__store.doc.bodies[0].id).data.solidCount, name: JS3D.doc().bodies[0].name }));
    expect(only).toEqual({ n: 1, solids: 1, name: mode === "advanced" ? "Block" : "Group 1" });
    const { bytes } = await exportBytes(page, "stl");
    const tris = stlTriangles(bytes);
    let zMin = Infinity;
    for (let i = 0; i < tris; i++) for (let v = 0; v < 3; v++) zMin = Math.min(zMin, bytes.readFloatLE(84 + i * 50 + 12 + v * 12 + 8));
    expect(zMin).toBeGreaterThan(2);
  });
}
test("Beginner: Ungroup works after a film was dropped from a Group cut", async () => {
  const doc = fixture("beginner", 22, 1e-6); doc.bodies[1].hole = true;
  await loadDoc(page, doc);
  await run(() => JS3D.select(["target", "cutter"]));
  await page.click("#bb-group"); await waitIdle(page);
  await expectVolumes([7200]);
  await page.click("#bb-ungroup"); await waitIdle(page);
  expect(await run(() => JS3D.doc().bodies.length)).toBe(2);
  await expect(page.locator("#toasts")).not.toContainText("keeps one piece");
});
// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on a Combine/Cut (app or runner-speed finding, see the PR notes)
test("Advanced: deleting a Combine that dropped a film restores the inputs", async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on this Combine/Cut build");
  await loadDoc(page, fixture("advanced", 22, 1e-6)); await combine("advanced");
  await expectVolumes([7200]);
  await page.locator('.tl-item[aria-label*="Combine"]').first().dblclick();
  await page.locator("#cmd").getByRole("button", { name: "Delete", exact: true }).click();
  await waitIdle(page);
  const got = await bodies(page);
  expect(got.map(b => b.volume).sort((a, b) => a - b)).toEqual([968, 8000]);
  expect(await run(() => JS3D.doc().bodies.map(b => (b.node.mods || []).length))).toEqual([0, 0]);
});
test("Advanced: Keep tools preserves the cutter beside the two pieces", async () => {
  await loadDoc(page, fixture("advanced")); await combine("advanced", "Cut", true);
  await expectVolumes([3600, 3600, 968]);
  expect(await run(() => JS3D.doc().bodies.find(b => b.id === "cutter"))).toEqual(fixture("advanced").bodies[1]);
});
test("Advanced: Join stays one body and Intersect separates new pieces", async () => {
  await loadDoc(page, newDoc("Join pieces", "advanced", { bodies: [box("target", 4, 4, 4), box("tool", 4, 4, 4, translated(5, 0, 0))] }));
  await combine("advanced", "Join"); await expectVolumes([128]);
  await loadDoc(page, newDoc("Intersect pieces", "advanced", { bodies: [box("target", 20, 20, 20), box("left", 4, 4, 4, translated(-5, 0, 4)), box("right", 4, 4, 4, translated(5, 0, 4))] }));
  await combine("advanced", "Intersect"); await expectVolumes([64, 64]);
});
test("Advanced: pieces sort by z, y, then x, keep numbered names and rebuild in the same order", async () => {
  await loadDoc(page, newDoc("Ordered pieces", "advanced", { bodies: [
    box("target", 30, 30, 20),
    box("top", 4, 4, 4, translated(0, 0, 10)),
    box("right", 4, 4, 4, translated(8, 0, 0)),
    box("back", 4, 4, 4, translated(0, 8, 0)),
    box("left", 4, 4, 4, translated(-8, 1e-9, 1e-9)),
  ] }));
  await combine("advanced", "Intersect"); await expectVolumes([64, 64, 64, 64]);
  const ordered = () => run(() => JS3D.list().map(b => ({
    name: b.name, center: b.bbox.min.map((v, i) => (v + b.bbox.max[i]) / 2),
  })));
  const expected = [
    { name: "Block", center: [-8, 0, 2] },
    { name: "Block (split)", center: [8, 0, 2] },
    { name: "Block (split 2)", center: [0, 8, 2] },
    { name: "Block (split 3)", center: [0, 0, 12] },
  ];
  expect(await ordered()).toEqual(expected);
  const saved = await run(() => JS3D.save());
  await run(async saved => { await JS3D.newDesign("beginner"); await JS3D.load(saved); }, saved);
  await waitIdle(page); await expectVolumes([64, 64, 64, 64]);
  expect(await ordered()).toEqual(expected);
});
test("a saved two-solid body is not automatically expanded", async () => {
  const saved = JSON.parse(readFileSync(new URL("./projects/advanced-3d-sketch-tube.json", import.meta.url), "utf8"));
  await loadDoc(page, saved.doc || saved);
  const got = await bodies(page);
  expect(got).toHaveLength((saved.doc || saved).bodies.length);
  expect(got[0]).toMatchObject({ volume: 1893.1, error: null });
  expect(await run(() => __app.scene.views.get(__store.doc.bodies[0].id).data.solidCount)).toBe(2);
  expect(await run(() => JS3D.doc().bodies.map(b => b.node))).toEqual((saved.doc || saved).bodies.map(b => b.node));
});

test("editing one copy to a different solid count errors clearly and leaves its sibling intact", async () => {
  await loadDoc(page, fixture("advanced")); await combine("advanced");
  await run(() => __store.update(doc => { doc.bodies[0].node.mods.find(m => m.src === "combine").tool.children[0].node.p.w = 18; }, "Change copied cutter"));
  await waitIdle(page);
  const got = await bodies(page);
  expect(got[0].error).toContain("expected 2 separate solids, found 1");
  expect(got[1]).toMatchObject({ volume: 3600, error: null });
  await run(() => JS3D.undo()); await waitIdle(page); await expectVolumes([3600, 3600]);
});

// A hole group builds twice: first without its holes (the baseline piece count), then complete.
// Hold each build in turn, so the change lands mid-operation whichever one is running.
for (const stage of ["hole-free", "complete"]) for (const scenario of ["failure", "stale edit", "new command"]) {
  test(`Group ${scenario} during its ${stage} build does not commit partial pieces or overwrite newer work`, async () => {
    const doc = fixture("beginner"); doc.bodies[1].hole = true;
    await loadDoc(page, doc);
    await run(() => JS3D.select(["target", "cutter"]));
    // An earlier test's toast lasts 5 s: it would satisfy the wait below before this test's own change is seen.
    await run(() => { document.getElementById("toasts").replaceChildren(); });
    const before = await run(() => ({ doc: JS3D.doc(), depth: __store.undoStack.length }));
    await run(([scenario, stage]) => {
      const k = __app.kernel;
      window.__combineGet = k.get;
      window.__combineHeld = false; window.__combineBaselineDone = false;
      k.get = function(key) {
        if (!key.startsWith('{"t":"group"')) return window.__combineGet.call(this, key);
        const complete = key.includes('"hole":true');
        if (complete === (stage === "complete")) {
          window.__combineHeld = true;
          return scenario === "failure" ? { ok: false, error: "Test build failure" } : undefined;
        }
        const res = window.__combineGet.call(this, key);
        if (res?.ok) window.__combineBaselineDone = true;
        return res;
      };
    }, [scenario, stage]);
    try {
      await page.click("#bb-group");
      await page.waitForFunction(() => window.__combineHeld);
      // The hole-free build runs first; the complete one is only reached after it finished.
      if (stage === "complete") expect(await run(() => window.__combineBaselineDone)).toBe(true);
      if (scenario === "stale edit") await run(() => JS3D.move(["target"], [7, 0, 0]));
      if (scenario === "new command") await run(() => { __app.command = { title: "New command" }; });
      await expect(page.locator("#toasts")).toContainText(scenario === "failure" ? "Test build failure" : "cancelled because the design changed");
    } finally {
      await run(() => { __app.kernel.get = window.__combineGet; if (__app.command?.title === "New command") __app.command = null; });
    }
    await waitIdle(page);
    const after = await run(() => ({ doc: JS3D.doc(), depth: __store.undoStack.length }));
    if (scenario === "stale edit") {
      before.doc.bodies[0].m[12] += 7; before.depth++;
    }
    expect(after).toEqual(before);
  });
}

// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on a Combine/Cut (app or runner-speed finding, see the PR notes)
test('deleting Combine before Keep piece is refused without an undo entry', async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on this Combine/Cut build");
  await loadDoc(page, fixture('advanced')); await combine('advanced');
  const before = await run(() => ({doc: JS3D.doc(), depth: __store.undoStack.length}));
  await page.locator('.tl-item[aria-label*="Combine"]').first().dblclick();
  await page.locator('#cmd').getByRole('button', {name:'Delete', exact:true}).click();
  await expect(page.locator('#toasts')).toContainText('Delete the split pieces, or undo Combine');
  expect(await run(() => ({doc: JS3D.doc(), depth: __store.undoStack.length}))).toEqual(before);
});

// quarantined: in Firefox the engine's watchdog reports "This shape stalled the geometry engine" on a Combine/Cut (app or runner-speed finding, see the PR notes)
test('editing a connected Join to a through Cut splits in one undo', async ({}, info) => {
  quarantine(info, ["site-firefox", "single-firefox"], "Firefox: the engine stalls on this Combine/Cut build");
  await loadDoc(page, fixture('advanced')); await combine('advanced', 'Join');
  const before = await run(() => ({doc: JS3D.doc(), depth: __store.undoStack.length}));
  await page.locator('.tl-item[aria-label*="Combine"]').first().dblclick();
  await page.locator('#cb-op').getByRole('button', {name:'Cut', exact:true}).click();
  await page.click('#cmd-ok'); await waitIdle(page);
  await expectVolumes([3600, 3600]);
  expect(await run(() => __store.undoStack.length)).toBe(before.depth + 1);
  await run(() => JS3D.undo()); await waitIdle(page);
  expect(await run(() => JS3D.doc())).toEqual(before.doc);
});

test('beginner: a box with a hole through its middle stays one body after Group, as soon as the app is idle', async () => {
  await loadDoc(page, newDoc("Box with hole", "beginner", { bodies: [
    box("target", 20, 20, 20),
    body("hole", "Cylinder hole", prim("cylinder", { w: 8, d: 8, h: 30 }), translated(0, 0, -5), { hole: true }),
  ] }));
  await run(() => JS3D.select(["target", "hole"]));
  const depth = await run(() => __store.undoStack.length);
  await page.click("#bb-group");
  await waitIdle(page); // no poll on the undo stack: idle must already mean the Group has landed
  const made = await bodies(page);
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({ hole: false, error: null });
  expect(made[0].volume).toBeCloseTo(8000 - Math.PI * 16 * 20, 0);
  expect(await run(() => __store.undoStack.length)).toBe(depth + 1);
});

test('Export clicked during a Group waits for the rebuild and downloads the finished part (browser test F4)', async () => {
  await loadDoc(page, newDoc("Export during group", "beginner", { bodies: [
    box("target", 20, 20, 20),
    body("hole", "Cylinder hole", prim("cylinder", { w: 6, d: 6, h: 30 }), translated(0, 0, -5), { hole: true }),
  ] }));
  await waitIdle(page);
  await run(() => {
    window.__toasts = [];
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push(n.textContent); }).observe(document.getElementById("toasts"), { childList: true });
    JS3D.select(["target", "hole"]);
  });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    // one tick: Group, then Export > STL before the rebuild has landed
    run(() => { document.getElementById("bb-group").click(); document.getElementById("btn-export").click(); document.querySelector('#menu-export button[data-act="stl"]').click(); }),
  ]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  const got = Buffer.concat(chunks);
  await waitIdle(page);
  const want = Buffer.from(await run(async () => Array.from(await JS3D.export("stl"))));
  expect(got.equals(want)).toBe(true);
  const toasts = await run(() => window.__toasts);
  expect(toasts.some((t) => t.includes("Still building"))).toBe(true);
  expect(toasts.some((t) => t.includes("Nothing to export"))).toBe(false);
});

test('two Export clicks during a Group give exactly one download, and the later format wins (review of the F4 fix)', async () => {
  await loadDoc(page, newDoc("Double export", "beginner", { bodies: [
    box("target", 20, 20, 20),
    body("hole", "Cylinder hole", prim("cylinder", { w: 6, d: 6, h: 30 }), translated(0, 0, -5), { hole: true }),
  ] }));
  await waitIdle(page);
  await run(() => {
    window.__toasts = [];
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push(n.textContent); }).observe(document.getElementById("toasts"), { childList: true });
    JS3D.select(["target", "hole"]);
  });
  const names = [];
  page.on("download", (d) => names.push(d.suggestedFilename()));
  await run(() => {
    document.getElementById("bb-group").click();
    const click = (act) => { document.getElementById("btn-export").click(); document.querySelector(`#menu-export button[data-act="${act}"]`).click(); };
    click("stl"); click("obj");
  });
  await expect.poll(() => names.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/\.obj$/);
  expect((await run(() => window.__toasts)).some((t) => t.includes("Already waiting"))).toBe(true);
});
