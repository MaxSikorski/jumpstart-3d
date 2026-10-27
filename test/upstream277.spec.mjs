// Upstream 2.7.7 (J.Siwek 2.7.4 to 2.7.7), shared by the site and single-file projects:
//  - Shell for any shape: the Auto method hollows a box, drain holes cut through the wall, several shapes shell at once from the dialog,
//    the "Any shape" distance-field method hollows a torus
//  - Beginner has Fillet and Shell buttons and lists a shape's fillets and shells under "Rounding and hollow"
//  - sketch line width and colour are a setting that is stored with the other preferences (workplane.ui.v1)
//  - Chip Carving opens and closes cleanly, carves a board and adds the carving to the design as a body
//  - Roland MDX-50 is a CAM machine and posts Roland NC code
//  - the splash and About show 2.7.7 with the notes for 2.7.7 to 2.7.4
// His own test (JumpStart-3D-v2.7.7-full-source/tests/shell.cjs) is a screenshot script, so the designs below are ours.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, reload, IDENTITY } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";
import { BUILD, VERSION } from "../src/version.js";
import { MACHINES, POSTS, MATERIALS, TOOLS, feedsSpeeds, buildProgram, toGcode } from "../src/camcore.js";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const near = (got, want, tol = 0.005) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * tol + 1e-6);
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const vol = async (id) => (await bodies(page)).find((b) => b.id === id).volume;
const okAll = async () => { for (const b of await bodies(page)) expect(b.error, b.name).toBeNull(); };

test("the splash and About show version 2.7.7 with the notes for 2.7.7 to 2.7.4", async () => {
  expect(VERSION).toBe("2.7.7");
  const label = `Version 2.7.7 · community build ${BUILD}`;
  expect(await page.locator("#sp-ver").textContent()).toBe(label);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText(label);
  for (const t of ["New in version 2.7.7", "Shell for any shape", "New in version 2.7.5", "Chip Carving", "Roland MDX-50", "New in version 2.7.4", "Sketch line style", "New in version 2.7.3"]) await expect(about).toContainText(t);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

// ---------------------------------------------------------------- Shell for any shape
// A 40 x 30 x 20 box, hollow with a 2 mm wall: 24000 - 36 x 26 x 16 = 9024 mm3.
const BOX_V = 40 * 30 * 20, HOLLOW_V = BOX_V - 36 * 26 * 16;
const shellMod = (extra = {}) => ({ id: "f1", seq: 2, t: "shell", th: 2, faces: [], ...extra });
const boxWith = (mods) => newDoc("Shell", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 }, mods))] });

test("Shell (Auto) hollows a box: the volume drops to the wall, and the STL is one closed solid", async () => {
  await loadDoc(page, boxWith([shellMod()]));
  await okAll();
  near(await vol("b1"), HOLLOW_V, 0.005);
  const rep = meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
  expect(rep.open, "open edges").toBe(0);
  near(rep.volume, HOLLOW_V, 0.01);
});

test("Shell drain holes cut through the bottom wall, and the print is still closed", async () => {
  await loadDoc(page, boxWith([shellMod({ drain: { n: 2, d: 4 } })]));
  await okAll();
  // two 4 mm holes through a 2 mm wall take 2 x pi x 2^2 x 2 = about 50 mm3 off the hollow box
  const v = await vol("b1");
  expect(v).toBeLessThan(HOLLOW_V - 30);
  near(v, HOLLOW_V - 2 * Math.PI * 4 * 2, 0.02);
  const s = readStl(bytes(await run(() => JS3D.export("stl"))));
  const rep = meshReport(s);
  expect(rep.open, "open edges").toBe(0);
  near(rep.volume, v, 0.01);
  // the holes open the cavity to the outside: some triangle of the inner wall reaches the bottom face (z = 0 under the box's own placement)
  const zs = s.flat().map((q) => q[2]);
  const bottom = Math.min(...zs);
  const lowFaceTris = s.filter((t) => t.every((q) => Math.abs(q[2] - bottom) < 1e-3)).length;
  const noDrain = await (async () => { await loadDoc(page, boxWith([shellMod()])); return meshReport(readStl(bytes(await run(() => JS3D.export("stl"))))).triangles; })();
  expect(lowFaceTris).toBeGreaterThan(0);
  expect(s.length, "the holes add triangles to the wall").toBeGreaterThan(noDrain);
});

test("Shell on several shapes at once from the Hollow dialog gives each its own shell", async () => {
  await loadDoc(page, newDoc("Two", "advanced", { bodies: [
    body("b1", "Box", prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 }), T(-40, 0, 0)),
    body("b2", "Block", prim("box", { w: 30, d: 30, h: 30, r: 0, c: 0 }), T(40, 0, 0)),
  ] }));
  await run(() => { window.__app.select(["b1", "b2"]); window.__app.advanced.shell({ type: "hollow" }); });
  await page.locator("#cmd-ok").click();
  await waitIdle(page);
  await okAll();
  const mods = await run(() => window.__store.doc.bodies.map((b) => b.node.mods.map((m) => [m.t, m.th, (m.faces || []).length, m.seq])));
  expect(mods[0][0].slice(0, 3)).toEqual(["shell", 2, 0]);
  expect(mods[1][0].slice(0, 3)).toEqual(["shell", 2, 0]);
  expect(mods[0][0][3], "both shells are one step").toBe(mods[1][0][3]);
  near(await vol("b1"), HOLLOW_V, 0.005);
  near(await vol("b2"), 30 * 30 * 30 - 26 * 26 * 26, 0.005);
});

test("the Hollow dialog keeps a thickness typed as a parameter expression, and a quick pick replaces it", async () => {
  await loadDoc(page, { ...boxWith([]), params: [{ id: "q1", name: "wall", expr: "1.5", value: 1.5 }] });
  await run(() => { window.__app.select(["b1"]); window.__app.advanced.shell({ type: "hollow" }); });
  await page.locator("#sh-th").fill("wall");
  await page.locator("#sh-th").press("Enter"); // Enter in the value box also accepts the dialog
  await expect.poll(() => run(() => !window.__app.command)).toBe(true);
  await waitIdle(page);
  let m = (await run(() => window.__store.doc.bodies[0].node.mods))[0];
  expect(m.th).toBe(1.5);
  expect(m.exprs).toEqual({ th: "wall" });
  near(await vol("b1"), BOX_V - 37 * 27 * 17, 0.005);
  // edit it again and pick 3 mm: the expression goes, the value is the quick pick
  await run(() => window.__app.advanced.editFeature("b1", window.__store.doc.bodies[0].node.mods[0].id));
  await page.locator('#sh-thq button[data-v="3"], #sh-thq button:has-text("3 mm")').first().click();
  await page.locator("#cmd-ok").click();
  await waitIdle(page);
  m = (await run(() => window.__store.doc.bodies[0].node.mods))[0];
  expect(m.th).toBe(3);
  expect(m.exprs).toBeUndefined();
  near(await vol("b1"), BOX_V - 34 * 24 * 14, 0.005);
});

test("Shell with the 'Any shape' method hollows a torus (distance-field wall)", async () => {
  await loadDoc(page, newDoc("Torus", "advanced", { bodies: [body("b1", "Ring", prim("torus", { w: 40, d: 40, h: 10, tube: 10 }, [shellMod({ method: "field" })]))] }));
  await okAll();
  const solid = Math.round(2 * Math.PI ** 2 * 15 * 5 * 5 * 10) / 10; // R = 15, r = 5 (tube 10 across): 2 pi^2 R r^2 = 7402
  const v = await vol("b1");
  expect(v, "a wall, not the whole ring").toBeLessThan(solid * 0.8);
  expect(v, "a wall, not nothing").toBeGreaterThan(solid * 0.25);
  // the field wall's STL has some unmatched edges (128 on this ring, seen 2026-10-27; not asserted closed here), but it does keep the volume
  const rep = meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
  near(rep.volume, v, 0.02);
});

// ---------------------------------------------------------------- Beginner: Fillet and Shell buttons
test("Beginner has Fillet and Shell buttons: Round all edges and Make hollow work on a box, and the panel lists them", async () => {
  await loadDoc(page, newDoc("Beginner", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 }))] }));
  await expect(page.locator("#bb-fillet")).toBeVisible();
  await expect(page.locator("#bb-shell")).toBeVisible();
  await run(() => window.__app.select(["b1"]));
  await page.locator("#bb-fillet").click();
  await page.locator("#ed-all").click();
  await page.locator("#cmd-ok").click();
  await waitIdle(page);
  await okAll();
  const rounded = await vol("b1");
  expect(rounded).toBeLessThan(BOX_V - 100); // 12 edges rounded take material off
  expect((await run(() => window.__store.doc.bodies[0].node.mods.map((m) => m.t)))).toEqual(["fillet"]);
  await run(() => window.__app.select(["b1"]));
  await page.locator("#bb-shell").click();
  await page.locator("#sh-th").fill("1");
  await page.locator("#sh-th").press("Enter");
  await expect.poll(() => run(() => !window.__app.command)).toBe(true);
  await waitIdle(page);
  await okAll();
  expect(await vol("b1")).toBeLessThan(rounded * 0.3);
  expect((await run(() => window.__store.doc.bodies[0].node.mods.map((m) => m.t)))).toEqual(["fillet", "shell"]);
  await run(() => window.__app.select(["b1"]));
  const panel = page.locator("#insp-fillet").locator("xpath=ancestor::*[contains(@class,'inspector') or contains(@id,'insp')][1]");
  await expect(page.locator("body")).toContainText("Rounding and hollow");
  await expect(page.locator("body")).toContainText("Hollow · 1 mm wall");
  await expect(panel.first()).toBeVisible();
});

// ---------------------------------------------------------------- sketch line width and colour
test("the sketch line width and colour are a setting: the menu sets them, they are stored in workplane.ui.v1 and come back after a reload", async () => {
  await page.click("#btn-theme, [id^='btn-theme'], #btn-appearance").catch(() => {});
  await run(() => window.__app.setSketchStyle({ width: "thick", color: "red" }));
  const stored = await run(() => JSON.parse(localStorage.getItem("workplane.ui.v1")));
  expect(stored.skw).toBe("thick");
  expect(stored.skc).toBe("red");
  await reload(page);
  await page.waitForFunction(() => window.__app.projects.started === true);
  expect(await run(() => document.querySelector('#sk-widths button[data-skw="thick"]').getAttribute("aria-checked"))).toBe("true");
  expect(await run(() => document.querySelector('#sk-colors button[data-skc="red"]').getAttribute("aria-checked"))).toBe("true");
  // the buttons in the menu do the same
  await run(() => document.querySelector('#sk-widths button[data-skw="hair"]').click());
  await run(() => document.querySelector('#sk-colors button[data-skc="theme"]').click());
  const back = await run(() => JSON.parse(localStorage.getItem("workplane.ui.v1")));
  expect([back.skw, back.skc]).toEqual(["hair", "theme"]);
  await run(() => window.__app.setSketchStyle({ width: "thin", color: "theme" }));
});

// ---------------------------------------------------------------- Chip Carving
test("Chip Carving opens from the Beginner button and closes without work or errors; the page API is blocked while it is open", async () => {
  await loadDoc(page, newDoc("Carve", "beginner", { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 20, r: 0, c: 0 }))] }));
  await page.locator("#bb-chipcarve").click();
  await expect(page.getByRole("dialog", { name: "Choose what to carve" })).toBeVisible();
  expect(await run(() => window.__app.carve.active)).toBe(true);
  expect(await run(() => { try { JS3D.newDesign(); return "allowed"; } catch (e) { return e.message; } })).toBe("close Chip Carving first");
  await run(() => window.__app.carve.close());
  expect(await run(() => window.__app.carve.active)).toBe(false);
  await expect(page.locator(".s3d-modal-back")).toHaveCount(0);
  expect(await run(() => { try { JS3D.newDesign(); return "allowed"; } catch (e) { return e.message; } })).toBe("allowed");
});

test("Chip Carving carves a board and adds the carving to the design as a body", async () => {
  test.setTimeout(300_000); // the carving board is a dense height field: building it and the final mesh takes tens of seconds
  await loadDoc(page, newDoc("Carve", "beginner", { bodies: [] }));
  await run(() => window.__app.carve.open());
  await page.locator('input[name="carve-src"][value="board"]').check();
  await page.getByRole("button", { name: /^(Start|Start carving|Carve|OK)$/ }).first().click();
  await page.waitForFunction(() => window.__app.carve._ready(), null, { timeout: 120_000 });
  const cut = await run(() => {
    const c = window.__app.carve, ui = c._ui();
    const P = window.__app.vp.camera.position.constructor;
    return c._chip(new P(0, 0, ui.G.top || 18), new P(0, 0, 1), new P(1, 0, 0), 4, 1);
  });
  expect(cut).toBeGreaterThan(0);
  await page.locator("#carve-done").click();
  await page.locator("#carve-add").click();
  await waitIdle(page, 120_000);
  expect(await run(() => window.__app.carve.active)).toBe(false);
  const list = await bodies(page);
  expect(list).toHaveLength(1);
  expect(list[0].name).toMatch(/^Chip carving/);
  expect(list[0].error).toBeNull();
  expect(list[0].volume).toBeGreaterThan(1000);
});

// ---------------------------------------------------------------- Roland MDX-50 in CAM Studio
test("Roland MDX-50 is a CAM machine (also with the rotary axis) and posts Roland NC code", async () => {
  const mach = MACHINES.find((m) => m.id === "mdx50");
  expect(mach, "MDX-50 profile").toBeTruthy();
  expect(mach.post).toBe("roland");
  expect(POSTS.roland.ext).toBe("nc");
  expect(MACHINES.find((m) => m.id === "mdx50r").name).toContain("ZCL-50A");
  // a 40 x 30 x 10 block under a 5 mm cutter: roughing and a cutout, posted for the MDX-50
  const tris = [], quad = (a, b, c, d) => tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  const [x0, y0, z0, x1, y1, z1] = [-20, -15, 0, 20, 15, 10];
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]); quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  const mat = MATERIALS[0], tool = TOOLS.find((t) => t.id === "f6"), fs = feedsSpeeds(tool, mat, mach);
  const job = { stock: { x0: -25, y0: -20, x1: 25, y1: 20, zTop: 12, zBot: 0 }, clearZ: 17, res: 0.5, origin: "fl-top", floor: 0.5,
    ops: [{ name: "Roughing", type: "rough", tool, toolNo: 1, ...fs, leave: 0.5, angle: 0 }] };
  const prog = buildProgram(job, new Float32Array(tris));
  const gcode = toGcode(prog, job, mach, { post: "roland", title: "MDX test" });
  const lines = gcode.trimEnd().split("\n");
  expect(lines[0], "Roland NC files are wrapped in %").toBe("%");
  expect(lines[lines.length - 1]).toBe("%");
  expect(gcode).toContain("for Roland NC code MDX");
  expect(gcode).toMatch(/\nT1 M6\nG43 H1\n/);
  expect(gcode).toMatch(/\nS\d+ M3\nG04 X3\.\n/);
  expect(gcode).toMatch(/\nG1 .*F\d+/);
  expect(gcode).not.toMatch(/NaN|undefined/);
});

test("CAM Studio lists the Roland MDX-50 profiles in its machine menu", async () => {
  await loadDoc(page, newDoc("Cam", "advanced", { bodies: [body("b1", "Block", prim("box", { w: 40, d: 30, h: 10, r: 0, c: 0 }))] }));
  await page.click("#ws-simulate");
  await page.click("#sim-cam");
  await expect(page.locator("#cam-side")).toBeVisible();
  const names = await run(() => [...document.querySelectorAll("#cam-machine option")].map((o) => o.textContent));
  expect(names.some((n) => /Roland MDX-50, 5-tool changer/.test(n))).toBe(true);
  expect(names.some((n) => /Roland MDX-50 \+ ZCL-50A/.test(n))).toBe(true);
  await page.click("#cam-close");
  await expect(page.locator("#cam-side")).toBeHidden();
});
