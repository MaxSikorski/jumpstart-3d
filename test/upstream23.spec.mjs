// Upstream 2.3 regressions (J.Siwek's Architechies and CAM Studio), shared by the site and single-file projects.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, quarantine } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

test.describe("version 2.3", () => {
  let page, errors;
  test.beforeAll(async ({ browser }, info) => {
    page = await browser.newPage();
    errors = watchErrors(page);
    await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await boot(page, info);
  });
  test.afterAll(async () => { await page.close(); });
  test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

  test("the splash text and About show version 2.3 and a community build of 21 or later, with the credit kept", async () => {
    expect(VERSION).toBe("2.3");
    expect(BUILD).toBeGreaterThanOrEqual(21);
    const label = `Version 2.3 · community build ${BUILD}`;
    expect(await page.locator("#sp-ver").textContent()).toBe(label); // the splash is in the page before the app loads
    await page.click("#btn-about");
    const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
    await expect(about).toContainText(label);
    await expect(about).toContainText("New in version 2.3");
    await expect(about).toContainText("CAM Studio:");
    await expect(about).toContainText("Architechies:");
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();
  });

  // quarantined: in Firefox the walls drawn with the mouse on the canvas never appear; not looked into yet
  test("Architechies: draw a room and a wall, raise them, Send to design makes bodies in Beginner, and the building stays", async ({}, info) => {
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await loadDoc(page, newDoc("Upstream 2.3 house", "beginner"));
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
    const at = (x, y, z) => page.evaluate(([x, y, z]) => {
      const v = window.__app.vp, q = v.project(new v.camera.position.constructor(x, y, z)), r = v.canvas.getBoundingClientRect();
      return [r.left + q[0], r.top + q[1]];
    }, [x, y, z]);
    const arch = () => page.evaluate(() => { const a = window.__store.doc.arch; return { walls: a.walls.length, raised: a.walls.filter((w) => w.h > 0).length, openings: a.openings.length }; });
    // a room, dragged corner to corner: 8 m by 6 m
    await page.click("#ar-room");
    const [x0, y0] = await at(-4000, -3000, 0), [x1, y1] = await at(4000, 3000, 0);
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await arch()).walls).toBe(4);
    // one inside wall: click both ends, Enter to finish
    await page.click("#ar-wall");
    const [a1, b1] = await at(1000, -3000, 0), [a2, b2] = await at(1000, 3000, 0);
    await page.mouse.click(a1, b1);
    await page.mouse.move(a2, b2, { steps: 5 });
    await page.mouse.click(a2, b2);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await arch()).walls).toBe(5);
    // raise every wall on the level
    await page.click("#ar-raise");
    await page.click("#ar-raise-all");
    await expect.poll(async () => (await arch()).raised).toBe(5);
    // a door in the front wall, by pointing at it
    await page.click("#ar-door");
    await page.click('#ar-cat [data-p="ext36"]');
    // the blue preview appears once the raised wall is drawn, hovered and the camera has settled: aim again each time, click when it is there
    let aim;
    await expect.poll(async () => {
      aim = await at(-2000, -3000, 1000);
      await page.mouse.move(aim[0] - 3, aim[1], { steps: 2 });
      await page.mouse.move(aim[0], aim[1], { steps: 2 });
      return page.evaluate(() => !!(window.__app.arch.state.ghost && window.__app.arch.state.ghost.ok));
    }, { timeout: 15_000 }).toBe(true);
    await page.mouse.click(aim[0], aim[1]);
    await expect.poll(async () => (await arch()).openings).toBe(1);
    // nothing is in the design's bodies yet; Send to design makes them
    expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(0);
    await page.click("#ar-send");
    await page.click("#ar-send-go");
    await page.waitForFunction(() => window.__app.mode === "beginner");
    await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length), { timeout: 30_000 }).toBeGreaterThan(0);
    await waitIdle(page);
    const made = await bodies(page);
    expect(made.filter((b) => b.error)).toEqual([]);
    expect(made.every((b) => b.volume > 0)).toBe(true);
    expect(await page.evaluate(() => window.__store.doc.bodies.every((b) => b.arch))).toBe(true);
    // the box that holds the shapes is about the building's size at the chosen scale (default 1:100 or the saved one): it is not empty or flat
    const size = await page.evaluate(() => { const b = window.__app.scene.allBox(), s = b.getSize(b.min.clone()); return [s.x, s.y, s.z]; });
    expect(size.every((v) => v > 1)).toBe(true);
    // the building is still in the design: back in Architechies the walls are there
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
    expect((await arch()).walls).toBe(5);
    await page.click("#mode-beginner");
    await page.waitForFunction(() => window.__app.mode === "beginner");
  });

  test("Your designs shows the Architechies tag on a design saved in that mode", async () => {
    await loadDoc(page, newDoc("Upstream 2.3 tag", "beginner"));
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
    await page.click("#btn-projects");
    await expect(page.locator(".projgrid .pcard", { hasText: "Upstream 2.3 tag" }).locator(".tag.arch")).toHaveText("Architechies");
    await page.click(".modal-back .xbtn");
    await page.click("#mode-beginner");
    await page.waitForFunction(() => window.__app.mode === "beginner");
  });

  test("CAM Studio: opens from Advanced > Simulate and makes non-empty G-code for a box, which Save G-code downloads", async () => {
    await loadDoc(page, newDoc("Upstream 2.3 CAM", "advanced", { bodies: [body("b1", "Box", prim("box", { w: 40, d: 30, h: 10, r: 0, c: 0 }))] }));
    expect((await bodies(page))[0].error).toBeNull();
    await page.click("#ws-simulate");
    await page.click("#sim-cam");
    await expect(page.locator("#cam-side")).toBeVisible();
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.result && u.done; }, null, { timeout: 90_000 });
    const gcode = await page.evaluate(() => window.__app.cam._ui().result.gcode);
    expect(gcode.split("\n").length).toBeGreaterThan(20);
    expect(gcode).toMatch(/^G[01] .*[XYZ]/m); // real cutting moves, not only a header
    expect(gcode).toMatch(/^M[35]\b/m); // spindle on
    // the cuts sit on this 40 x 30 part: X and Y span at least the box less one bit, and at most the box plus the stock margin (or the bit's radius) each side
    const cut = await page.evaluate(() => {
      const u = window.__app.cam._ui();
      return { margin: u.s.margin, dMax: Math.max(...u.result.prog.ops.map((o) => o.op.tool.d)) };
    });
    expect(gcode).toMatch(/^G21\b/m); // millimetres, so the numbers below are mm
    let x = null, y = null;
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const line of gcode.split("\n")) {
      const g = /^G([01])\b/.exec(line);
      if (!g) continue;
      const mx = /\bX(-?[\d.]+)/.exec(line), my = /\bY(-?[\d.]+)/.exec(line);
      if (mx) x = +mx[1];
      if (my) y = +my[1];
      if (g[1] === "1" && x !== null && y !== null) { lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y); }
    }
    const slack = 2 * Math.max(cut.margin, cut.dMax / 2);
    for (const [i, size] of [[0, 40], [1, 30]]) {
      expect(hi[i] - lo[i]).toBeGreaterThanOrEqual(size - cut.dMax);
      expect(hi[i] - lo[i]).toBeLessThanOrEqual(size + slack + 0.01);
    }
    await expect(page.locator("#cam-stats")).toContainText("lines of G-code");
    await expect(page.locator("#cam-side")).toContainText("Simulated: no crashes found");
    // Save G-code: the downloaded file is the same text
    await page.click("#cam-export");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#cam-save-go")]);
    expect(download.suggestedFilename()).toMatch(/^Upstream 2\.3 CAM\.\w+$/);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(gcode);
    // closing CAM Studio leaves the design as it was
    await page.click("#cam-close");
    await expect(page.locator("#cam-side")).toHaveCount(0);
    expect(await bodies(page)).toHaveLength(1);
  });

  test("Architechies: a floor with no walls draws solid in the dark theme, the grid does not fight it", async () => {
    // The floor's top face lies exactly on z = 0, like the ground grid; the grid is drawn after solids, so unless it is pushed back the two z-fight in patches and stripes (worse in the dark theme).
    await loadDoc(page, newDoc("Upstream 2.3 floor", "beginner"));
    await page.evaluate(() => window.__app.setTheme("dark", true));
    try {
      await page.click("#mode-arch");
      await page.waitForFunction(() => window.__app.mode === "arch");
      // a 10 m by 8 m floor on Level 1, no walls (as after deleting them), at the camera distance the mode starts with
      await page.evaluate(() => {
        const s = window.__store;
        for (const a of new Set([s.doc.arch, s.view.arch])) if (a) { a.walls = []; a.openings = []; a.slabs = [{ id: "sZ", lvl: "L1", x0: -5000, y0: -4000, x1: 5000, y1: 4000, thick: 150 }]; }
        window.__app.arch.refresh();
        window.__app.vp.dirty = true;
      });
      const shot = async (grid) => {
        await page.evaluate((g) => { window.__app.vp.grid.visible = g; window.__app.vp.dirty = true; }, grid);
        await page.waitForTimeout(600);
        return (await page.locator("canvas").first().screenshot()).toString("base64");
      };
      const withGrid = await shot(true), without = await shot(false);
      const r = await page.evaluate(async ([a64, b64]) => {
        const dec = async (b) => { const im = await createImageBitmap(await (await fetch("data:image/png;base64," + b)).blob()); const c = new OffscreenCanvas(im.width, im.height), x = c.getContext("2d"); x.drawImage(im, 0, 0); return { w: im.width, d: x.getImageData(0, 0, im.width, im.height).data }; };
        const A = await dec(a64), B = await dec(b64);
        const v = window.__app.vp, cv = v.canvas.getBoundingClientRect(), k = A.w / cv.width;
        // the top face's corners on screen, then the points inside it, 20% in from every edge (skips the slab's edges and the headlight's rim)
        const P = (x, y) => { const q = v.project(new v.camera.position.constructor(x, y, 0)); return [q[0] * k, q[1] * k]; };
        const c = [P(-5000, -4000), P(5000, -4000), P(5000, 4000), P(-5000, 4000)];
        const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        let n = 0, ok = 0, onscreen = 0;
        for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
          const s = 0.2 + 0.6 * i / 60, t = 0.2 + 0.6 * j / 60;
          const [x, y] = lerp(lerp(c[0], c[1], s), lerp(c[3], c[2], s), t).map(Math.round);
          if (x < 0 || y < 0 || x >= A.w || y >= A.d.length / 4 / A.w) continue;
          onscreen++;
          const o = (y * A.w + x) * 4;
          // "solid" = the same colour as the same pixel without the grid, which is the plain lit slab
          n++;
          if (Math.abs(A.d[o] - B.d[o]) + Math.abs(A.d[o + 1] - B.d[o + 1]) + Math.abs(A.d[o + 2] - B.d[o + 2]) <= 30) ok++;
        }
        const mid = lerp(lerp(c[0], c[1], 0.5), lerp(c[3], c[2], 0.5), 0.5).map(Math.round), mo = (mid[1] * A.w + mid[0]) * 4;
        return { n, ok, onscreen, slabRGB: [B.d[mo], B.d[mo + 1], B.d[mo + 2]], view: { dist: v.view.dist, el: v.view.el, az: v.view.az } };
      }, [withGrid, without]);
      console.log("FLOORPX", JSON.stringify(r), (100 * r.ok / r.n).toFixed(1) + "% solid");
      expect(r.n, "pixels read inside the floor").toBeGreaterThan(2000);
      // the plain slab is tan, not the dark background, so the reading is really of the floor
      expect(r.slabRGB[0]).toBeGreaterThan(r.slabRGB[2] + 8);
      expect(r.ok / r.n, "share of the floor's pixels that match the slab").toBeGreaterThanOrEqual(0.97);
    } finally {
      await page.evaluate(() => { window.__app.vp.grid.visible = true; window.__app.setTheme("light", true); });
      await page.click("#mode-beginner");
      await page.waitForFunction(() => window.__app.mode === "beginner");
    }
  });
});
