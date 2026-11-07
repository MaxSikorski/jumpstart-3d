// Upstream 2.9.3 (J.Siwek 2.8.1.4 to 2.9.3), shared by the site and single-file projects. One outcome test per headline feature:
//  - the splash and About show 2.9.3 with his notes for 2.9.3 back to 2.8.1.4
//  - Neon Sign Builder (Simulate → Signs): its page loads only when first opened (site: one fetch of helpers/neon.html, nothing at start;
//    single file: inline), runs on the shared three.js, and nothing leaves the machine
//  - Save downloads the project file (.json) by default; the Open/Export switch turns that off, and Save then only saves
//  - layouts: the theme menu switches Default / Simplified / Clean / Classic CAD / Tablet, the ribbon moves, and the choice is kept
//  - the pinned Constraints palette while sketching: Pin shows every constraint on the workspace, and it stays pinned
//  - a gear set (a pair) from Insert → Gears builds two error-free bodies, linked by a joint for the motion study
//  - Architect furniture: the Furniture tool places a chosen piece on the ground; undo takes it away
//  - timeline rollback: stepping back and forward shows earlier steps, and the design and its undo list are unchanged
// His own tests (JumpStart-3D-v2.9.3-full-source/tests/*.cjs) are screenshot scripts; the checks below assert real state.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, buildOf } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

let page, errors;
const requests = [];
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  errors = watchErrors(page);
  page.on("request", (r) => requests.push(r.url()));
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const okAll = async () => { const list = await bodies(page); for (const b of list) expect(b.error, b.name).toBeNull(); return list; };
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const steady = () => expect.poll(() => run(() => window.__app.vp.isMoving()), { timeout: 10_000 }).toBe(false);

test("the splash and About show version 2.9.3 with his notes for 2.9.3 back to 2.8.1.4", async () => {
  expect(VERSION).toBe("2.9.3");
  const label = `Version 2.9.3 · community build ${BUILD}`;
  expect(await page.locator("#sp-ver").textContent()).toBe(label);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText(label);
  for (const t of ["New in version 2.9.3", "Neon Sign Builder projects", "New in version 2.9.2", "New in version 2.9.1", "New in version 2.9.0", "New in version 2.8.2.4", "New in version 2.8.2.0", "New in version 2.8.1.4"]) await expect(about).toContainText(t);
  await expect(about.locator("#ab-site")).toHaveText("J.Siwek's site"); // his "Visit classyapps.org" button is ours as a second link
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

// ---------------------------------------------------------------- Neon Sign Builder
test("Neon Sign Builder: its page loads only when first opened, runs on the shared three.js, and nothing leaves the machine", async ({}, info) => {
  await loadDoc(page, newDoc("Neon", "advanced"));
  const fetched = () => requests.filter((u) => u.endsWith("/helpers/neon.html")).length;
  expect(fetched(), "the builder's page is not part of the start").toBe(0);
  const from = requests.length;
  await page.click("#ws-simulate");
  await page.click("#sim-neon");
  const inner = page.frameLocator(".flexigen.neon iframe");
  await expect.poll(() => run(() => { const f = document.querySelector(".flexigen.neon iframe"); const w = f && f.contentWindow; return !!(w && w.__neon && w.THREE && w.THREE.REVISION); }), { timeout: 60_000 }).toBe(true);
  expect(fetched(), "fetched once when opened on the site; inline in the single file").toBe(buildOf(info) === "site" ? 1 : 0);
  await expect(inner.locator("body")).toBeVisible();
  const urls = requests.slice(from).filter((u) => /^https?:/.test(u));
  const own = new URL(info.project.use.baseURL).origin;
  expect(urls.filter((u) => !u.startsWith(own)), "no request to another site").toEqual([]);
  await run(() => window.__app.neon.close());
  expect(await run(() => window.__app.neon.isOpen)).toBe(false);
  // a second opening uses the copy already loaded
  await page.click("#sim-neon");
  await expect.poll(() => run(() => { const f = document.querySelector(".flexigen.neon iframe"); return !!(f && f.contentWindow && f.contentWindow.__neon); }), { timeout: 30_000 }).toBe(true);
  expect(fetched()).toBe(buildOf(info) === "site" ? 1 : 0);
  await run(() => window.__app.neon.close());
  await page.click("#ws-design");
});

// ---------------------------------------------------------------- Save downloads a file
test("Save downloads the project file by default; the Open/Export switch turns it off and Save then only saves", async () => {
  await loadDoc(page, newDoc("Saved Box", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 10 }))] }));
  await okAll();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#btn-save")]);
  expect(dl.suggestedFilename()).toMatch(/\.json$/);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  const file = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(file.app).toBe("jumpstart-3d");
  expect(file.doc.bodies.map((b) => b.name)).toEqual(["Box"]);
  await expect(page.locator("#toasts")).toContainText("and downloaded");
  // the switch in Open/Export
  await page.click("#btn-export");
  await expect(page.locator("#save-dl-toggle")).toHaveAttribute("aria-checked", "true");
  await page.click("#save-dl-toggle");
  await expect(page.locator("#save-dl-toggle")).toHaveAttribute("aria-checked", "false");
  if (await page.locator("#menu-export").isVisible()) await page.keyboard.press("Escape");
  expect(await run(() => localStorage.getItem("jumpstart.saveDownload"))).toBe("off");
  let got = 0;
  const count = () => { got++; };
  page.on("download", count);
  const before = await run(() => window.__store.doc.ver || 0);
  await page.click("#btn-save");
  await expect.poll(() => run(() => window.__store.doc.ver || 0)).toBe(before + 1);
  await page.waitForTimeout(800); // a download would have started by now
  page.off("download", count);
  expect(got, "no download with the switch off").toBe(0);
  await run(() => { localStorage.removeItem("jumpstart.saveDownload"); });
});

// ---------------------------------------------------------------- finer STL for printing
test("STL and 3MF bridge exports match the menu at each quality (Fine by default)", async () => {
  await loadDoc(page, newDoc("Round", "beginner", { bodies: [body("b1", "Peg", prim("cylinder", { w: 30, d: 30, h: 10 }))] }));
  await okAll();
  const viewTriangles = await run(() => window.__app.scene.views.get("b1").data.triangles.length / 3);
  const tris = (buf) => buf.readUInt32LE(80);
  const menu = async (kind) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), (async () => { await page.click("#btn-export"); await page.click(`#menu-export button[data-act="${kind}"]`); })()]);
    const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c);
    return Buffer.concat(chunks);
  };
  const counts = {};
  try {
    for (const quality of [null, "standard", "fine", "extra"]) {
      await run((q) => q ? localStorage.setItem("jumpstart.exportQuality", q) : localStorage.removeItem("jumpstart.exportQuality"), quality);
      for (const kind of ["stl", "3mf"]) {
        const downloaded = await menu(kind);
        const bridge = Buffer.from(await run(async (k) => Array.from(await JS3D.export(k)), kind));
        expect(bridge.equals(downloaded), `${quality || "default"} ${kind}`).toBe(true);
        if (kind === "stl") counts[quality || "default"] = tris(downloaded);
      }
    }
  } finally {
    await run(() => localStorage.removeItem("jumpstart.exportQuality"));
  }
  expect(counts.default).toBe(counts.fine);
  expect(counts.standard).toBeGreaterThan(viewTriangles);
  expect(counts.fine).toBeGreaterThan(counts.standard);
  expect(counts.extra).toBeGreaterThan(counts.fine);
});

// ---------------------------------------------------------------- layouts
test("layouts: the theme menu switches Default, Simplified, Clean, Classic CAD and Tablet; the ribbon moves; the choice is kept", async () => {
  await loadDoc(page, newDoc("Layouts", "advanced"));
  const ribbon = () => page.locator("#ribbon").boundingBox();
  const vpBox = () => page.locator("#viewport").boundingBox();
  const pick = async (name) => { await page.click("#btn-theme"); await page.click(`#menu-theme button[data-layout="${name}"]`); await expect.poll(() => run(() => document.documentElement.dataset.layout || "default")).toBe(name); };
  await pick("clean");
  await expect.poll(async () => { const r = await ribbon(), v = await vpBox(); return r.x + r.width <= v.x + 1; }, { message: "Clean: tools in a column left of the view" }).toBe(true);
  await pick("classic");
  await expect.poll(async () => { const r = await ribbon(), v = await vpBox(); return r.x >= v.x + v.width - 1; }, { message: "Classic CAD: palette right of the view" }).toBe(true);
  await pick("tablet");
  await expect.poll(async () => { const r = await ribbon(), v = await vpBox(); return r.y >= v.y + v.height - 1; }, { message: "Tablet: tools below the view" }).toBe(true);
  await pick("simple");
  expect(JSON.parse(await run(() => localStorage.getItem("workplane.ui.v1"))).layout).toBe("simple");
  await pick("default");
  await expect.poll(async () => { const r = await ribbon(), v = await vpBox(); return r.y + r.height <= v.y + 1; }, { message: "Default: tools across the top" }).toBe(true);
  expect(await run(() => document.documentElement.hasAttribute("data-layout"))).toBe(false);
});

// ---------------------------------------------------------------- pinned Constraints palette
test("the pinned Constraints palette: Pin shows every constraint on the workspace while sketching, and it stays pinned", async () => {
  const square = { id: "s1", name: "Square", seq: 1, hidden: false, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] },
    pts: [[-10, -10], [10, -10], [10, 10], [-10, 10]].map(([x, y], i) => ({ id: `p${i}`, x, y })),
    ents: [0, 1, 2, 3].map((i) => ({ id: `e${i}`, t: "line", a: `p${i}`, b: `p${(i + 1) % 4}` })), cons: [] };
  await run(() => localStorage.removeItem("jumpstart.cpalette"));
  await loadDoc(page, newDoc("Palette", "advanced", { sketches: [square] }));
  await run(() => window.__app.enterSketch("s1"));
  await expect(page.locator("#sk-cpin")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cpal")).toHaveCount(0);
  await page.click("#sk-cpin");
  await expect(page.locator(".cpal")).toHaveCount(1);
  expect(await page.locator(".cpal .cgrid button").count(), "every constraint is on the palette").toBeGreaterThanOrEqual(8);
  expect(JSON.parse(await run(() => localStorage.getItem("jumpstart.cpalette"))).on).toBe(true);
  await page.click("#sk-cpin");
  await expect(page.locator(".cpal")).toHaveCount(0);
  expect(JSON.parse(await run(() => localStorage.getItem("jumpstart.cpalette"))).on).toBe(false);
  await run(() => window.__app.exitSketch());
});

// ---------------------------------------------------------------- gears
test("Gears (Insert → Gears): a gear pair builds two error-free bodies, linked by a joint for the motion study", async () => {
  await loadDoc(page, newDoc("Gear pair", "advanced"));
  await page.click("#ad-insert");
  await page.click("#ad-ins-gear");
  await expect(page.locator("#gr-type")).toBeVisible();
  await page.locator("#gr-type button", { hasText: "Gear pair" }).click();
  await page.click("#cmd-ok");
  await waitIdle(page);
  const list = await okAll();
  expect(list.length, "a pair is two gears").toBe(2);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(100);
  const joints = await run(() => (window.__store.doc.joints || []).map((j) => ({ body: j.body, link: j.link || null })));
  expect(joints.length).toBe(2);
  expect(joints.some((j) => j.link && j.link.to && j.link.ratio), "the joints are linked by the tooth ratio").toBe(true);
  // one undo takes the whole set away
  await run(() => window.__store.undo());
  await waitIdle(page);
  expect((await bodies(page)).length).toBe(0);
});

// ---------------------------------------------------------------- Architect furniture
test("Architect furniture: the Furniture tool places a chosen piece on the ground; undo takes it away", async () => {
  await loadDoc(page, newDoc("Furnished", "beginner"));
  await page.click("#mode-arch");
  await steady();
  await page.click("#ar-furn-tool");
  await expect(page.locator("#ar-furn .arch-tile").first()).toBeVisible();
  const tile = page.locator("#ar-furn [data-f]").first();
  const kind = await tile.getAttribute("data-f");
  await tile.click();
  await run(() => window.__app.vp.setView("top", window.__app.arch.box()));
  await steady();
  const box = await page.locator("#viewport canvas").first().boundingBox();
  const [sx, sy] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(sx - 20, sy, { steps: 3 });
  await page.mouse.move(sx, sy, { steps: 3 });
  await page.mouse.click(sx, sy);
  await expect.poll(() => run(() => (window.__store.doc.arch && window.__store.doc.arch.furn || []).map((f) => f.k))).toEqual([kind]);
  await run(() => window.__store.undo());
  await expect.poll(() => run(() => (window.__store.doc.arch && window.__store.doc.arch.furn || []).length)).toBe(0);
  await page.keyboard.press("Escape");
  await page.click("#mode-beginner");
});

// ---------------------------------------------------------------- timeline rollback
test("timeline rollback: back and forward show earlier steps, and the design and its undo list are unchanged", async () => {
  await loadDoc(page, newDoc("Steps", "advanced", { seq: 3, bodies: [
    body("b1", "Box", prim("box", { w: 30, d: 20, h: 10 })),
    { ...body("b2", "Peg", prim("cylinder", { w: 8, d: 8, h: 20 }), T(40, 0, 0)), seq: 2 },
    { ...body("b3", "Ball", prim("sphere", { w: 10, d: 10, h: 10 }), T(-30, 0, 5)), seq: 3 },
  ] }));
  await okAll();
  const before = await run(() => ({ doc: JSON.stringify(window.__store.doc), undo: window.__store.undoStack ? window.__store.undoStack.length : null }));
  const shown = () => run(() => window.__store.view.bodies.map((b) => b.name));
  await expect(page.locator("#tl-first")).toBeVisible();
  await page.click("#tl-first");
  await expect.poll(shown).toEqual(["Box"]);
  await page.click("#tl-fwd");
  await expect.poll(shown).toEqual(["Box", "Peg"]);
  await page.click("#tl-last");
  await expect.poll(shown).toEqual(["Box", "Peg", "Ball"]);
  expect(await run(() => window.__store.rollTo == null)).toBe(true);
  const after = await run(() => ({ doc: JSON.stringify(window.__store.doc), undo: window.__store.undoStack ? window.__store.undoStack.length : null }));
  expect(after.doc, "the design itself is unchanged").toBe(before.doc);
  expect(after.undo, "no undo step was added").toBe(before.undo);
  await waitIdle(page);
  await okAll();
});
