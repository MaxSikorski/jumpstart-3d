// Upstream 2.8.1.3 (J.Siwek 2.7.8 to 2.8.1.3), shared by the site and single-file projects. One outcome test per headline feature:
//  - the splash and About show 2.8.1.3 with his notes for 2.8.1.3 to 2.7.8 (and not his "Smaller file" note: our single file is not compressed)
//  - 3D Print Sim: turn, scale, copy and arrange objects on the plate, with the design left as it was; G-code with Orca-style ;TYPE: lines;
//    a print time worked out like Orca Slicer
//  - Floor Planner (Architect): opens with its own three.js r128 built in, its tutorial chooser lists ten projects, Quick save keeps a
//    named plan, and nothing is fetched from the web
//  - Quick Hinge, Bin & Box Maker, Stained Glass Studio: a dome lamp added to the design, the square mission lamp built in the studio
//  - an extra Text font builds a body and the font pickers list the extra fonts; on the site the fonts (1.9 MB) and the Floor Planner
//    page (1 MB) are fetched only when first needed, and without a connection the text builds in Rounded sans with a toast
//  - Sweep with a guide rail grows the profile to follow the rail; a sketch inside a body turns Slice on; Image on a face
//  - the merged Fasteners dialog (his parts library with our thread fit): one entry in Advanced Create, a threaded bolt and nut in ISO and UNC
// His own tests (JumpStart-3D-v2.8.1.3-full-source/tests/*.cjs) are screenshot scripts; the checks below assert real state.
import { test, expect } from "@playwright/test";
import { deflateSync, crc32 } from "node:zlib";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, buildOf } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";
import { BUILD, VERSION } from "../src/version.js";

let page, errors;
const requests = [];
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  errors = watchErrors(page);
  page.on("request", (r) => requests.push(r.url()));
  await boot(page, info);
});
test.afterAll(async () => { await page.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const run = (fn, arg) => page.evaluate(fn, arg);
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const okAll = async () => { const list = await bodies(page); for (const b of list) expect(b.error, b.name).toBeNull(); return list; };
const closedStl = async () => meshReport(readStl(bytes(await run(() => JS3D.export("stl")))));
// a click on the canvas at a point in the world
async function clickWorld(x, y, z) {
  const box = await page.locator("#viewport canvas").first().boundingBox();
  const [sx, sy] = await run(([x, y, z]) => window.__app.vp.project(new (window.__app.vp.view.target.constructor)(x, y, z)), [x, y, z]);
  await page.mouse.move(box.x + sx, box.y + sy);
  await page.mouse.click(box.x + sx, box.y + sy);
}
const download = async (click) => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), click()]);
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) };
};
// a small PNG: a dark square on white
function png(w = 32, h = 32) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(x > 8 && x < 24 && y > 8 && y < 24 ? 20 : 250, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("the splash and About show version 2.8.1.3 with his notes for 2.8.1.3 to 2.7.8", async () => {
  expect(VERSION).toBe("2.8.1.3");
  const label = `Version 2.8.1.3 · community build ${BUILD}`;
  expect(await page.locator("#sp-ver").textContent()).toBe(label);
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  await expect(about).toContainText(label);
  for (const t of ["New in version 2.8.1.3", "Floor Planner tutorials", "3D Print Sim objects", "New in version 2.8.1.2", "New in version 2.8.1.1", "Quick Hinge", "New in version 2.7.10", "Square mission lamp", "New in version 2.7.9", "Stained Glass Studio", "New in version 2.7.8", "Fasteners library", "three.js r128", "Anton (font, subset)"]) await expect(about).toContainText(t);
  await expect(about).not.toContainText("Smaller file:");
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

// ---------------------------------------------------------------- 3D Print Sim
const plateDoc = () => newDoc("Plate", "beginner", { bodies: [
  body("b1", "Box", prim("box", { w: 40, d: 30, h: 20 })),
  { ...body("b2", "Peg", prim("cylinder", { w: 12, d: 12, h: 30 }), T(60, 0, 0)), seq: 2, color: "#3b82f6" },
] });
const sliced = () => expect.poll(() => run(() => document.getElementById("ps-status")?.textContent || ""), { timeout: 90_000 }).toMatch(/Sliced/);
// the plate as the sim sees it: copies made in the sim, and the box of the Box (b1) on the plate
const plate = () => run(() => {
  const s = window.__app.advanced.printSim, w = s.world();
  if (!w) return null;
  const b = w.wbox[w.keys.indexOf("b1")];
  return { copies: s.st.inst.filter((q) => q.key !== q.id).length, box: b ? [b.max.x - b.min.x, b.max.y - b.min.y].map((v) => Math.round(v)) : null, at: b ? Math.round(b.min.x) : null };
});

test("3D Print Sim: turn, scale, copy and arrange an object on the plate; the design is not changed", async () => {
  await loadDoc(page, plateDoc());
  const design = () => run(() => JSON.stringify(window.__store.doc.bodies.map((b) => ({ id: b.id, m: b.m, node: b.node, name: b.name, hidden: b.hidden }))));
  const before = await design();
  await page.click("#bb-printsim");
  await sliced();
  expect(await plate()).toMatchObject({ copies: 0, box: [40, 30] });
  await run(() => window.__app.advanced.printSim.selectKey("b1"));
  await page.click("#ps-otz"); // a quarter turn about Z
  await expect.poll(async () => (await plate()).box, { timeout: 60_000 }).toEqual([30, 40]);
  // the panel redraws when a slice finishes, which can drop a typed value: type it again until the plate shows it
  await expect.poll(async () => {
    if ((await plate()).box.join() !== "45,60") { await page.fill("#ps-oscale", "150"); await page.press("#ps-oscale", "Enter"); }
    return (await plate()).box;
  }, { timeout: 60_000, intervals: [1500] }).toEqual([45, 60]);
  await expect(page.locator("#ps-osize")).toContainText("60");
  // the count box goes back to 1 whenever the panel redraws (a slice finishing): ask again for what is still missing
  await expect.poll(async () => {
    const c = (await plate()).copies;
    if (c < 2) { await page.fill("#ps-ocount", String(2 - c)); await page.click("#ps-odup"); }
    return (await plate()).copies;
  }, { timeout: 60_000, intervals: [1500] }).toBe(2);
  const placed = await plate();
  await page.click("#ps-arrange");
  await expect.poll(async () => (await plate()).at, { timeout: 60_000 }).not.toBe(placed.at);
  expect((await plate()).copies).toBe(2);
  await sliced();
  // the time on the tiles is worked out like Orca Slicer's (hours and minutes)
  await expect(page.locator("#ps-time")).toHaveText(/\d+\s*(h|min)/);
  // G-code: a real file with Orca-style ;TYPE: comments and moves
  const g = await download(() => page.click("#ps-gcode"));
  expect(g.name).toMatch(/\.gcode$/);
  const text = g.bytes.toString("utf8");
  expect(text).toMatch(/^;TYPE:(Outer wall|Inner wall|Sparse infill|Internal solid infill|Top surface|Bottom surface)/m);
  expect((text.match(/^G1 /gm) || []).length).toBeGreaterThan(500);
  await run(() => window.__app.advanced.printSim.teardown());
  expect(await design()).toBe(before);
});

// ---------------------------------------------------------------- Floor Planner
test("Floor Planner: opens with three.js r128 built in, its tutorial chooser lists ten projects, Quick save keeps the plan, nothing from the web", async ({}, info) => {
  await loadDoc(page, newDoc("Plan", "beginner"));
  const fetched = (file) => requests.some((u) => u.endsWith("/helpers/" + file));
  expect(fetched("floorplan.html"), "the planner page is not part of the start").toBe(false);
  const from = requests.length;
  await page.click("#mode-arch");
  await page.click("#ar-floorplanner");
  await expect.poll(() => run(() => !!(window.__app.floorplan && window.__app.floorplan.ready)), { timeout: 30_000 }).toBe(true);
  const frame = page.frameLocator("#floorplan-frame");
  const inner = await (await page.locator("#floorplan-frame").elementHandle()).contentFrame();
  expect(await inner.evaluate(() => THREE.REVISION)).toBe("128");
  await frame.locator("#fp-tuts").click();
  await expect(frame.locator(".jt-card")).toHaveCount(10);
  expect(fetched("floorplan.html")).toBe(buildOf(info) === "site"); // fetched when opened; the single file has it inline
  await frame.locator(".jt-back .jt-x").click();
  await expect(frame.locator(".jt-back")).toHaveCount(0);
  // draw a room through the planner's own state, then Quick save with a name
  await frame.locator("#m-sketch").click();
  await frame.locator("[data-t=rect]").click();
  const pt = (x, y) => inner.evaluate(([x, y]) => { const r = document.getElementById("cv").getBoundingClientRect(); return [r.left + V.x + x * V.z, r.top + V.y + y * V.z]; }, [x, y]);
  const frameBox = await page.locator("#floorplan-frame").boundingBox();
  const a = await pt(2, 2), b = await pt(14, 12);
  await page.mouse.move(frameBox.x + a[0], frameBox.y + a[1]);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(frameBox.x + a[0] + (b[0] - a[0]) * i / 10, frameBox.y + a[1] + (b[1] - a[1]) * i / 10);
  await page.mouse.up();
  await expect.poll(async () => (await run(() => window.__app.floorplan.state())).rooms.length).toBe(1);
  await page.keyboard.press("Control+s");
  await frame.locator("#jn1").fill("Lopez");
  await frame.locator("#jn2").fill("Maria");
  await frame.locator("#jn3").fill("First Room");
  await frame.locator("#jnok").click();
  await expect(frame.locator("#fp-saved")).toContainText("First Room");
  await frame.locator("#fp-plans").click();
  await expect(frame.locator(".jt-back")).toContainText("First Room");
  await frame.locator(".jt-back .jt-x").click();
  // nothing left the machine: the site asks only its own server, the single file nothing over the network
  const urls = requests.slice(from).filter((u) => /^https?:/.test(u));
  const own = new URL(info.project.use.baseURL).origin;
  expect(urls.filter((u) => !u.startsWith(own))).toEqual([]);
  await frame.locator("#js3d-close").click();
  await expect.poll(() => run(() => window.__app.floorplan.isOpen)).toBe(false);
  await page.click("#mode-beginner");
});

// ---------------------------------------------------------------- Makers
test("Quick Hinge: a print-in-place hinge placed on the workplane is a closed, error-free body", async () => {
  await loadDoc(page, newDoc("Hinge", "advanced"));
  await run(() => window.__app.advanced.hinge());
  await expect(page.locator("#hg-info")).toBeVisible();
  const box = await page.locator("#viewport canvas").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  const list = await okAll();
  expect(list.length).toBeGreaterThan(0);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(50);
  expect((await closedStl()).open, "open edges").toBe(0);
});

test("Bin & Box Maker: a bin with a lid from Simulate > Makers is closed and error-free", async () => {
  await loadDoc(page, newDoc("Bin", "advanced"));
  await page.click("#ws-simulate");
  await page.click("#sim-bins");
  await page.check("#bn-lid");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  const list = await okAll();
  expect(list.map((b) => b.name)).toEqual(expect.arrayContaining([expect.stringMatching(/^Bin/), expect.stringMatching(/lid$/)]));
  expect(await run(() => !!window.__store.doc.bodies.find((b) => b.bin))).toBe(true);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(1000);
  expect((await closedStl()).open, "open edges").toBe(0);
  await page.click("#ws-design");
});

// Adding a lamp builds every glass piece as a mesh body (about a minute for the dome); the square lamp is checked inside the studio.
test("Stained Glass Studio: a dome lamp goes into the design as error-free bodies; the square mission lamp builds with its column base", async () => {
  test.setTimeout(240_000);
  const status = () => run(() => document.getElementById("sglass-status")?.textContent || "");
  const pieces = async () => +((await status()).match(/(\d+) pieces/) || [])[1];
  await loadDoc(page, newDoc("Glass", "advanced"));
  await page.click("#ws-simulate");
  await page.click("#sim-sglass");
  await expect.poll(status, { timeout: 60_000 }).toMatch(/\d+ pieces/);
  await page.locator("#sg-pieces").fill("10"); // the fewest pieces: quicker to build into the design
  await expect.poll(pieces, { timeout: 60_000 }).toBeLessThan(30);
  await page.click("#sg-add");
  await expect.poll(() => run(() => window.__store.doc.bodies.length), { timeout: 60_000 }).toBeGreaterThan(1);
  await waitIdle(page, 180_000);
  const list = await okAll();
  expect(list.some((b) => /frame/i.test(b.name)), list.map((b) => b.name).join(", ")).toBe(true);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(0);
  // the square mission lamp: a four-sided shade cut into its Mission pieces, and a square tapered column base on offer
  await loadDoc(page, newDoc("Glass", "advanced"));
  await page.click("#ws-simulate");
  await page.click("#sim-sglass");
  await expect.poll(status, { timeout: 60_000 }).toMatch(/\d+ pieces/);
  const before = await status();
  await page.selectOption("#sg-source", "square");
  await expect.poll(status, { timeout: 60_000 }).not.toBe(before);
  await expect.poll(status, { timeout: 60_000 }).toMatch(/\d+ pieces/);
  expect(await pieces()).toBeGreaterThan(100);
  await expect(page.locator("#sg-base")).toBeVisible();
  await page.click("#sg-close");
  await expect.poll(() => run(() => window.__app.stainedGlass.isOpen)).toBe(false);
  expect(await run(() => window.__store.doc.bodies.length)).toBe(0); // closing adds nothing
  await page.click("#ws-design");
});

// ---------------------------------------------------------------- Text fonts
const textBody = (id, font, x) => ({ ...body(id, font, prim("text", { text: "Hello 3D", size: 10, w: 60, d: 12, h: 3, font }), T(0, x, 0)), seq: x + 2 });
test("an extra Text font (Bangers) builds a body that differs from the Rounded sans one, and the font picker lists the extra fonts", async ({}, info) => {
  const text = textBody;
  // nothing so far needed them: the site has not fetched the fonts (the single file carries them inline)
  expect(requests.some((u) => u.endsWith("/helpers/fonts_more.js"))).toBe(false);
  await loadDoc(page, newDoc("Fonts", "beginner", { bodies: [text("t1", "sans", 0), text("t2", "bangers", 20), text("t3", "fraktur", 40)] }));
  const list = await okAll();
  const v = Object.fromEntries(list.map((b) => [b.name, b.volume]));
  for (const k of ["sans", "bangers", "fraktur"]) expect(v[k], k).toBeGreaterThan(100);
  expect(Math.abs(v.bangers - v.sans) / v.sans).toBeGreaterThan(0.02);
  await run(() => window.__app.select(["t2"]));
  await expect(page.locator("#insp-font")).toBeVisible();
  expect(requests.filter((u) => u.endsWith("/helpers/fonts_more.js")).length).toBe(buildOf(info) === "site" ? 1 : 0); // once, when the design needed them
  await expect.poll(() => page.locator("#insp-font option").count()).toBeGreaterThanOrEqual(45);
  expect(await page.locator("#insp-font optgroup").count()).toBeGreaterThan(3);
  await expect(page.locator("#insp-font")).toHaveValue("bangers");
  await run(() => window.__app.select([]));
});

test("site, no connection: a design in an extra font builds in Rounded sans with a plain toast, and the picker keeps the classic fonts", async ({ browser }, info) => {
  test.skip(buildOf(info) !== "site", "the single file has the fonts inline");
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = watchErrors(p);
  try {
    await p.route("**/helpers/fonts_more.js", (r) => r.abort("internetdisconnected"));
    await boot(p, info);
    await p.evaluate(() => { const a = window.__app, t = a.toast; window.__toasts = []; a.toast = (m, ...r) => { window.__toasts.push(String(m)); return t.call(a, m, ...r); }; });
    await loadDoc(p, newDoc("Offline fonts", "beginner", { bodies: [textBody("t1", "sans", 0), textBody("t2", "bangers", 20)] }));
    expect(await p.evaluate(() => window.__toasts)).toEqual(["The extra fonts need a connection the first time, so text in them uses Rounded sans for now."]);
    const list = await bodies(p);
    for (const b of list) expect(b.error, b.name).toBeNull();
    const v = Object.fromEntries(list.map((b) => [b.name, b.volume]));
    expect(v.bangers).toBeCloseTo(v.sans, 0); // the same text in the default font
    await p.evaluate(() => window.__app.select(["t2"]));
    await expect(p.locator("#insp-font")).toBeVisible();
    await expect.poll(() => p.locator("#insp-font option").count()).toBe(3);
    expect(errs.filter((e) => !/fonts_more|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e))).toEqual([]);
  } finally { await p.close(); }
});

// ---------------------------------------------------------------- Sweep, Slice, Image on a face
test("Sweep with a guide rail: the circle grows from 8 to 20 mm radius along a 60 mm path (a cone of about 39207 mm3)", async () => {
  await loadDoc(page, newDoc("Rail", "advanced", { sketches: [
    { id: "sC", name: "Cone profile", seq: 4, plane: { o: [0, 80, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [{ id: "c", x: 0, y: 0 }], ents: [{ id: "ci", t: "circle", c: "c", r: 8 }], hidden: false },
    { id: "sR", name: "Path and rail", seq: 5, plane: { o: [0, 80, 0], x: [1, 0, 0], n: [0, -1, 0] }, pts: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 60 }, { id: "c", x: 8, y: 0 }, { id: "d", x: 20, y: 60 }], ents: [{ id: "l1", t: "line", a: "a", b: "b" }, { id: "l2", t: "line", a: "c", b: "d" }], hidden: false },
  ] }));
  await run(() => { const b = window.__app.scene.allBox().clone(); b.min.set(-40, 40, -10); b.max.set(140, 120, 70); window.__app.vp.fit(b); });
  await expect.poll(() => run(() => window.__app.vp.isMoving())).toBe(false);
  await page.click("#ad-features");
  await page.click("#ad-sweep");
  await clickWorld(0, 80, 0); // the profile
  await clickWorld(0, 80, 30); // the path line
  await page.getByText("None (optional)").click(); // pick a guide rail
  await clickWorld(14, 80, 30); // the rail line
  await expect(page.locator("#cmd-ok")).toBeEnabled();
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  const [cone] = await okAll();
  expect(await run(() => { const n = window.__store.doc.bodies[0].node; return [n.t, !!(n.rail || n.railEdgeSegs), n.railScale]; })).toEqual(["sweep", true, true]);
  const want = Math.PI * 60 / 3 * (8 * 8 + 8 * 20 + 20 * 20);
  expect(Math.abs(cone.volume - want) / want).toBeLessThan(0.03);
});

test("Slice: a sketch whose plane runs through a body cuts the view open (Slice on, its box ticked), and leaving the sketch turns it off", async () => {
  await loadDoc(page, newDoc("Slice", "advanced", {
    bodies: [body("bx", "Box 1", prim("box", { w: 60, d: 60, h: 60 }))],
    sketches: [{ id: "sk1", name: "Sketch 1", seq: 4, plane: { o: [0, 0, 30], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], hidden: false }],
  }));
  await run(() => window.__app.enterSketch("sk1"));
  await expect.poll(() => run(() => window.__app.sketchSlice.on)).toBe(true);
  await expect(page.locator("#pal-slice")).toBeChecked();
  await page.locator("#pal-slice").uncheck();
  await expect.poll(() => run(() => window.__app.sketchSlice.on)).toBe(false);
  await page.keyboard.press("Escape");
  await run(() => window.__app.sketcher.active && window.__app.sketcher.done());
});

test("Image on a face: the picture lands on the top face of a block, sized to fit", async () => {
  await loadDoc(page, newDoc("Image", "advanced", { bodies: [body("bx", "Block", prim("box", { w: 80, d: 60, h: 20 }))] }));
  await run(() => window.__app.fit());
  await expect.poll(() => run(() => window.__app.vp.isMoving())).toBe(false);
  await page.click("#ad-insert");
  await expect(page.locator("#ad-ins-img")).toHaveText(/Image on a face/);
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#ad-ins-img")]);
  await fc.setFiles({ name: "face.png", mimeType: "image/png", buffer: png() });
  await expect(page.locator("#cmd")).toBeVisible();
  await clickWorld(0, 0, 20);
  await page.click("#cmd-ok");
  await expect.poll(() => run(() => window.__store.doc.sketches.filter((s) => s.image).length)).toBe(1);
  const sk = await run(() => { const s = window.__store.doc.sketches.find((s) => s.image); return { o: s.plane.o, n: s.plane.n, w: s.image.w, h: s.image.h }; });
  expect(sk.o[2]).toBeCloseTo(20, 3);
  expect(sk.n).toEqual([0, 0, 1]);
  expect(Math.max(sk.w, sk.h)).toBeGreaterThan(20);
  expect(Math.max(sk.w, sk.h)).toBeLessThanOrEqual(80.001);
  await page.keyboard.press("Escape");
  await run(() => window.__app.sketcher.active && window.__app.sketcher.done());
});

// ---------------------------------------------------------------- Fasteners: one merged dialog
test("Fasteners: one dialog in Advanced Create and Beginner; a threaded ISO bolt and nut and a UNC bolt build, the nut bored at the ISO minor diameter", async () => {
  test.setTimeout(180_000);
  await loadDoc(page, newDoc("Fast", "advanced"));
  await page.click("#ad-features");
  await expect(page.locator("#ad-fasteners")).toHaveCount(1);
  await expect(page.locator("#ad-fastener")).toHaveCount(0);
  await page.click("#ad-fasteners");
  const make = async (kind, std, size, len) => {
    await page.selectOption("#fs-kind", kind);
    await page.locator(`#fs-std button`, { hasText: std === "inch" ? "Inch" : "Metric" }).click();
    await page.selectOption("#fs-size", size);
    if (len) { await page.fill("#fs-len", String(len)); await page.locator("#fs-len").blur(); }
    await page.locator("#fs-threads").check();
    await expect(page.locator("#fs-clear")).toBeVisible(); // our print offset row, with the hand row
    await expect(page.locator("#fs-hand")).toBeVisible();
    await page.selectOption("#fs-clear", "-0.1");
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
  };
  await make("hexbolt", "metric", "M8", 20);
  await page.click("#ad-insert");
  await page.click("#ad-ins-fast");
  await make("nut", "metric", "M8");
  await page.click("#ad-features");
  await page.click("#ad-fasteners");
  await make("hexbolt", "inch", '1/4"-20', 25.4);
  await waitIdle(page, 120_000);
  const list = await okAll();
  expect(list.map((b) => b.name)).toEqual(["Hex bolt M8 x 20 mm", "Hex nut M8", 'Hex bolt 1/4"-20 x 1"']);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(300);
  const parts = await run(() => window.__store.doc.bodies.map((b) => ({ f: b.fastener, threads: b.node.mods.filter((m) => m.t === "thread").map((m) => [m.pitch, m.clear]), bore: (b.node.children || []).filter((c) => c.hole).map((c) => c.node.p.w) })));
  expect(parts[0].threads).toEqual([[1.25, -0.1]]);
  expect(parts[1].threads).toEqual([[1.25, -0.1]]);
  expect(parts[1].bore).toEqual([+(8 - 1.0825 * 1.25).toFixed(6)]); // the ISO minor diameter D1, where the Thread feature's nut profile starts
  expect(parts[2].threads[0][0]).toBeCloseTo(1.27, 6); // 20 threads per inch
  expect(parts[0].f).toMatchObject({ kind: "hexbolt", std: "metric", size: "M8", threads: true, clear: -0.1, left: false });
  // Beginner's Fasteners button opens the same dialog
  await run(() => window.__app.setMode("beginner"));
  await page.click("#bb-fastener");
  await expect(page.locator("#fs-kind")).toBeVisible();
  await page.click('#cmd button[aria-label="Cancel"]');
});
