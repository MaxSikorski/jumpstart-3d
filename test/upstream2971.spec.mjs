// Upstream 2.9.7.1 (J.Siwek 2.9.4 to 2.9.7.1), shared by the site and single-file projects. One outcome test per headline feature:
//  - About still lists his notes for 2.9.7.1 back to 2.9.4 (the version itself: the newest upstream spec)
//  - 2.9.6 Beginner ribbon: Neon Sign and Box Maker in place of Chip Carve, Lathe and Stained Glass (all three still in Advanced);
//    Neon Sign opens the builder and nothing leaves the machine
//  - 2.9.5 / 2.9.7 Box Maker in Beginner: a stacked drawer case is one set; a click picks the whole set, the side panel edits it in
//    the Box Maker, and a smaller set really loses its extra bodies
//  - 2.9.7.1 Box Maker door pulls: knob, finger hole or bar, on the front only; the back is flat and the door is 3.2 mm thick;
//    laid out to print, the door lies on its back on the bed
//  - 2.9.4 Architect: the Show menu, and the staging camera (walk at eye height, take a photo, leave)
// His own tests (JumpStart-3D-v2.9.7.1-full-source/tests/*.cjs) are screenshot scripts; the checks below assert real state.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc } from "./helpers.mjs";

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
const steady = () => expect.poll(() => run(() => window.__app.vp.isMoving()), { timeout: 10_000 }).toBe(false);

test("About still lists his notes for 2.9.7.1 back to 2.9.4", async () => {
  // the version and splash label are checked by the newest upstream spec (upstream298.spec.mjs)
  await page.click("#btn-about");
  const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
  for (const t of ["New in version 2.9.7.1", "Box Maker doors:", "New in version 2.9.7", "New in version 2.9.6", "New in version 2.9.5", "New in version 2.9.4", "Staging camera (C):", "New in version 2.9.3"]) await expect(about).toContainText(t);
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
});

// ---------------------------------------------------------------- 2.9.6 Beginner ribbon
test("Beginner ribbon: Neon Sign and Box Maker replace Chip Carve, Lathe and Stained Glass, which stay in Advanced; Neon Sign opens the builder with nothing leaving the machine", async ({}, info) => {
  await loadDoc(page, newDoc("Ribbon", "beginner"));
  await expect(page.locator("#bb-neon")).toBeVisible();
  await expect(page.locator("#bb-bins")).toBeVisible();
  for (const gone of ["#bb-chipcarve", "#bb-lathe", "#bb-sglass"]) await expect(page.locator(gone), gone).toHaveCount(0);
  // Neon Sign opens the builder in its own window
  const from = requests.length;
  await page.click("#bb-neon");
  await expect.poll(() => run(() => { const f = document.querySelector(".flexigen.neon iframe"); const w = f && f.contentWindow; return !!(w && w.__neon && w.THREE); }), { timeout: 60_000 }).toBe(true);
  const own = new URL(info.project.use.baseURL).origin;
  expect(requests.slice(from).filter((u) => /^https?:/.test(u) && !u.startsWith(own)), "no request to another site").toEqual([]);
  await run(() => window.__app.neon.close());
  await expect(page.locator(".flexigen.neon")).toHaveCount(0);
  // the three tools are still in Advanced: Chip Carving and the Lathe under Workshop, Stained Glass under Simulate
  await loadDoc(page, newDoc("Ribbon", "advanced"));
  await page.click("#ad-workshop");
  await expect(page.locator("#ad-chipcarve")).toBeVisible();
  await expect(page.locator("#ad-lathe")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.click("#ws-simulate");
  await expect(page.locator("#sim-sglass")).toBeVisible();
  await page.click("#ws-design");
});

// ---------------------------------------------------------------- 2.9.5 / 2.9.7 Box Maker sets in Beginner
test("Box Maker from the Beginner ribbon: a 3-high drawer case is one set; a click picks it whole; Edit in Box Maker makes it 1 high and the extra bodies go", async () => {
  await loadDoc(page, newDoc("Drawers", "beginner"));
  await page.click("#bb-bins");
  await expect(page.locator("#cmd")).toBeVisible();
  await page.locator('#bn-style button', { hasText: "Drawer" }).click();
  await page.locator("#bn-units").fill("3");
  await page.locator("#bn-units").press("Tab");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  let list = await okAll();
  expect(list.length, "3 cases and 3 drawers").toBe(6);
  for (const b of list) expect(b.volume, b.name).toBeGreaterThan(1000);
  const main = await run(() => window.__store.doc.bodies.find((b) => b.bin).id);
  // a click on one part picks the whole set
  await run(() => { window.__app.select([]); JS3D.fit(); });
  await steady();
  const box = await page.locator("#viewport canvas").first().boundingBox();
  const [sx, sy] = await run((id) => { const b = window.__store.doc.bodies.find((x) => x.id === id); const V = window.__app.vp.view.target.constructor; return window.__app.vp.project(new V(b.m[12], b.m[13], b.m[14] + 10)); }, main);
  await page.mouse.click(box.x + sx, box.y + sy);
  await expect.poll(() => run(() => window.__app.sel.length)).toBe(6);
  await expect(page.locator("#insp-bins")).toBeVisible();
  // Edit in Box Maker: one unit; the second and third case and drawer leave the design
  await page.click("#insp-bins");
  await expect(page.locator("#cmd")).toBeVisible();
  await expect(page.locator("#bn-units")).toHaveValue(/^3/);
  await page.locator("#bn-units").fill("1");
  await page.locator("#bn-units").press("Tab");
  await page.click("#cmd-ok");
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  list = await okAll();
  expect(list.length, "1 case and 1 drawer").toBe(2);
  expect(list.map((b) => b.id)).toContain(main);
});

// ---------------------------------------------------------------- 2.9.7.1 door pulls
test("Box Maker doors: knob, finger hole and bar pulls are on the front only, the back is flat, and laid out to print the door lies on its back", async () => {
  test.setTimeout(240_000);
  await loadDoc(page, newDoc("Doors", "advanced"));
  const make = async (pull, layout) => {
    await page.click("#ws-simulate");
    await page.click("#sim-bins");
    await expect(page.locator("#cmd")).toBeVisible();
    await page.locator('#bn-style button', { hasText: "Door" }).click();
    await page.locator("#bn-units").fill("1");
    await page.locator("#bn-units").press("Tab");
    await page.locator('#bn-doorpull button', { hasText: pull }).click();
    await page.locator('#bn-layout button', { hasText: layout }).click();
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
    // the newest door: its extent in the body's own frame (Y = front to back) and its lowest point in the world
    return run(() => {
      const b = window.__store.doc.bodies.filter((q) => / door$/.test(q.name)).pop(), main = window.__store.doc.bodies.find((q) => q.id === b.binPart);
      const P = window.__app.scene.views.get(b.id).data.vertices;
      let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < P.length; i += 3) { y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
      let onBack = 0, onBed = 0;
      for (let i = 0; i < P.length; i += 3) { if (Math.abs(P[i + 1] - y1) < 1e-3) onBack++; if (Math.abs(P[i + 2] + b.m[14] - (z0 + b.m[14])) < 1e-3) onBed++; }
      return { pull: main.bin.doorPull, y0, y1, z0: z0 + b.m[14], z1: z1 + b.m[14], onBack, onBed };
    });
  };
  const knob = await make("Knob", "Assembled"), hole = await make("Finger hole", "Assembled"), bar = await make("Bar", "Assembled");
  await okAll();
  expect([knob.pull, hole.pull, bar.pull]).toEqual(["knob", "hole", "bar"]);
  // the finger hole door is just the panel: 3.2 mm front to back, so the hinge edge and pins are no thicker than it
  expect(hole.y1 - hole.y0).toBeCloseTo(3.2, 2);
  // knob and bar stand out at the front only: the back plane is the same for all three and is flat
  for (const d of [knob, bar]) {
    expect(d.y1, d.pull + ": back plane").toBeCloseTo(hole.y1, 3);
    expect(d.y1 - d.y0, d.pull + ": the pull stands out at the front").toBeGreaterThan(6);
  }
  for (const d of [knob, hole, bar]) expect(d.onBack, d.pull + ": vertices on the flat back").toBeGreaterThanOrEqual(4);
  // laid out to print: the door lies on its back on the bed (z = 0), the knob up
  const flat = await make("Knob", "Laid out to print");
  await okAll();
  expect(flat.z0).toBeCloseTo(0, 2);
  expect(flat.onBed, "the flat back is on the bed").toBeGreaterThanOrEqual(4);
  expect(flat.z1 - flat.z0, "the knob points up").toBeGreaterThan(6);
  await page.click("#ws-design");
});

// ---------------------------------------------------------------- 2.9.4 Architect: Show menu, staging camera
test("Architect: the Show menu picks how the house is shown; the staging camera walks at eye height, takes a photo and gives the view back", async () => {
  await loadDoc(page, newDoc("Staging", "beginner"));
  await page.click("#mode-arch");
  await steady();
  await run(() => window.__store.update((d) => {
    d.arch.walls = [[0, 0, 4000, 0], [4000, 0, 4000, 3000], [4000, 3000, 0, 3000], [0, 3000, 0, 0]].map(([ax, ay, bx, by], i) => ({ id: "sw" + i, lvl: d.arch.levels[0].id, a: [ax, ay], b: [bx, by], t: 200, h: 2700 }));
  }, "a room"));
  // Show: the whole house solid, then cut away above
  await page.selectOption("#ar-show", "all");
  expect(await run(() => window.__app.arch.state.show)).toBe("all");
  await page.selectOption("#ar-show", "cut");
  expect(await run(() => window.__app.arch.state.show)).toBe("cut");
  await page.selectOption("#ar-show", "level");
  // the staging camera: first person in the middle of the room at eye height (1600 mm)
  const orbit = await run(() => ({ ...window.__app.vp.view, target: window.__app.vp.view.target.toArray() }));
  await page.click("#ar-camera");
  const eye = () => run(() => { const f = window.__app.vp.fpv; return f && [f.eye.x, f.eye.y, f.eye.z]; });
  const e0 = await eye();
  expect(e0).not.toBeNull();
  expect(e0[0]).toBeCloseTo(2000, 0);
  expect(e0[1]).toBeCloseTo(1500, 0);
  expect(e0[2]).toBeCloseTo(1600, 0);
  // walk with the on-screen pad: the eye moves, at the same height
  const fwd = page.locator("#ar-cam-pad").getByRole("button", { name: /Walk forward/ });
  await fwd.hover(); await page.mouse.down();
  await expect.poll(async () => { const e = await eye(); return Math.hypot(e[0] - e0[0], e[1] - e0[1]); }).toBeGreaterThan(50);
  await page.mouse.up();
  expect((await eye())[2]).toBeCloseTo(1600, 0);
  // a photo goes into the panel
  await page.click("#ar-cam-shot");
  await expect(page.locator("#ar-cam-photos figure")).toHaveCount(1);
  // leaving gives the orbit view back
  await page.click("#ar-cam-exit");
  expect(await run(() => window.__app.vp.fpv)).toBeNull();
  const back = await run(() => ({ ...window.__app.vp.view, target: window.__app.vp.view.target.toArray() }));
  expect(back.target).toEqual(orbit.target);
  expect(back.dist).toBeCloseTo(orbit.dist, 3);
  await page.click("#mode-beginner");
});
