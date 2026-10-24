// Upstream 2.4 and 2.5 regressions (J.Siwek's Architect changes: log walls, landscape, flood test, floor plans, house and
// landscape export, and the CAM Studio 4th axis), shared by the site and single-file projects.
// The author's own scripts (JumpStart-3D-v2.5-full-source/tests/ar4..ar7, cam4) show how he drives the same features.
import { test, expect } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, quarantine } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";

// the text of one member of a zip file (stored or deflated)
function zipText(bytes, wanted) {
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 30, offset + 30 + nameLength) === wanted) {
      const data = bytes.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset = start + size;
  }
  throw new Error("no " + wanted + " in the zip");
}

test.describe("versions 2.4 and 2.5", () => {
  let page, errors;
  test.beforeAll(async ({ browser }, info) => {
    page = await browser.newPage({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    errors = watchErrors(page);
    await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    await boot(page, info);
  });
  test.afterAll(async () => { await page.close(); });
  test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

  // screen position of a point in the building's world (millimetres, Z up)
  const at = (x, y, z) => page.evaluate(([x, y, z]) => {
    const v = window.__app.vp, q = v.project(new v.camera.position.constructor(x, y, z)), r = v.canvas.getBoundingClientRect();
    return [r.left + q[0], r.top + q[1]];
  }, [x, y, z]);
  const arch = () => page.evaluate(() => { const a = window.__store.doc.arch; return { walls: a.walls.length, raised: a.walls.filter((w) => w.h > 0).length, openings: a.openings.length, roofs: a.roofs.length, logs: a.walls.filter((w) => w.log).length }; });
  const enterArch = async (name) => {
    await loadDoc(page, newDoc(name, "beginner"));
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
  };
  const leaveArch = async () => {
    await page.click("#mode-beginner");
    await page.waitForFunction(() => window.__app.mode === "beginner");
  };
  // a room dragged corner to corner, then every wall raised
  const roomRaised = async (half = [3000, 2500], wallType = null) => {
    await page.click("#ar-room");
    if (wallType) await page.selectOption("#ar-walltype", wallType);
    const [x0, y0] = await at(-half[0], -half[1], 0), [x1, y1] = await at(half[0], half[1], 0);
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await arch()).walls).toBe(4);
    await page.click("#ar-raise");
    await page.click("#ar-raise-all");
    await expect.poll(async () => (await arch()).raised).toBe(4);
  };
  // a door by pointing at the front wall (the blue preview needs the camera settled: aim again each time)
  const doorInFront = async (x, y) => {
    await page.click("#ar-door");
    let aim;
    await expect.poll(async () => {
      aim = await at(x, y, 1000);
      await page.mouse.move(aim[0] - 3, aim[1], { steps: 2 });
      await page.mouse.move(aim[0], aim[1], { steps: 2 });
      return page.evaluate(() => !!(window.__app.arch.state.ghost && window.__app.arch.state.ghost.ok));
    }, { timeout: 15_000 }).toBe(true);
    await page.mouse.click(aim[0], aim[1]);
    await expect.poll(async () => (await arch()).openings).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
  };
  const view = (az, el, tx, ty, dist) => page.evaluate(([az, el, tx, ty, dist]) => {
    const vp = window.__app.vp; vp.animateTo({ az, el, roll: 0, target: new vp.camera.position.constructor(tx, ty, 0), dist });
  }, [az, el, tx, ty, dist]).then(() => page.waitForFunction(() => !window.__app.vp.isMoving()));
  const drag = async (pts) => {
    const s = await Promise.all(pts.map(([x, y]) => at(x, y, 0)));
    await page.mouse.move(...s[0]); await page.mouse.down();
    for (const q of s.slice(1)) await page.mouse.move(...q, { steps: 6 });
    await page.waitForTimeout(250); await page.mouse.up();
  };
  const landStats = () => page.evaluate(() => {
    const L = window.__store.doc.arch.land;
    const arr = (b) => new Int16Array(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer);
    const h = arr(L.h), w = arr(L.w);
    let hi = -1e9, lo = 1e9, wet = 0;
    for (const v of h) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    for (const v of w) if (v !== -32768) wet++;
    return { range: (hi - lo) * 10, wet, plants: L.plants.length };
  });
  const makeLand = async () => {
    await page.click("#ar-land");
    await page.click("#ar-land-make [data-m]:nth-child(2)");
    await expect.poll(() => page.evaluate(() => !!window.__store.doc.arch.land)).toBe(true);
  };
  const download = async (click) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), click()]);
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    return { name: dl.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };

  test("the splash and About show the current version (2.5.1) and the community build, with 2.4 and 2.5 listed and the credit kept", async () => {
    expect(VERSION).toBe("2.5.1");
    expect(BUILD).toBeGreaterThanOrEqual(22);
    const label = `Version 2.5.1 · community build ${BUILD}`;
    expect(await page.locator("#sp-ver").textContent()).toBe(label); // app.js rewrites #sp-ver at start-up; smoke.spec.mjs checks the same text in src/index.html
    await page.click("#btn-about");
    const about = page.locator(".modal", { hasText: "Created by J.Siwek" });
    await expect(about).toContainText(label);
    await expect(about).toContainText("New in version 2.5");
    await expect(about).toContainText("New in version 2.4");
    await expect(about).toContainText("Created by J.Siwek");
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();
  });

  test("log walls: a room of round logs is all log, Beginner gets bodies that fit the 256 mm plate, and Architect is full size again", async ({}, info) => {
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await enterArch("Upstream 2.5 logs");
    await roomRaised([3000, 2500], "logR250");
    expect(await arch()).toMatchObject({ walls: 4, logs: 4 });
    const full = await page.evaluate(() => { const b = window.__app.arch.box(), s = b.getSize(b.min.clone()); return [s.x, s.y]; });
    expect(Math.min(...full)).toBeGreaterThan(4000); // a 6 m by 5 m house, in millimetres
    await leaveArch();
    await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length), { timeout: 60_000 }).toBeGreaterThan(0);
    await waitIdle(page);
    expect((await bodies(page)).filter((b) => b.error)).toEqual([]);
    const fit = await page.evaluate(() => { const b = window.__app.scene.allBox(), s = b.getSize(b.min.clone()); return [s.x, s.y]; });
    expect(fit[0]).toBeGreaterThan(20); expect(fit[1]).toBeGreaterThan(20);
    expect(fit[0]).toBeLessThanOrEqual(256.5); expect(fit[1]).toBeLessThanOrEqual(256.5);
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
    const back = await page.evaluate(() => { const b = window.__app.arch.box(), s = b.getSize(b.min.clone()); return [s.x, s.y]; });
    expect(back).toEqual(full);
    expect(await arch()).toMatchObject({ walls: 4, logs: 4 });
    await leaveArch();
  });

  test("Beginner to Architect and back: the camera returns to the home view and the build plate is still on screen", async () => {
    await loadDoc(page, newDoc("Upstream 2.5 camera", "beginner", { bodies: [body("b1", "Block", prim("box", { w: 40, d: 30, h: 10, r: 0, c: 0 }))] }));
    await waitIdle(page);
    await page.click("#mode-arch");
    await page.waitForFunction(() => window.__app.mode === "arch");
    await page.click("#mode-beginner");
    await page.waitForFunction(() => window.__app.mode === "beginner");
    // the home view animates in; the design's own framing timers (about a second) must not undo it
    const look = () => page.evaluate(() => {
      const vp = window.__app.vp, p = vp.camera.position, r = vp.canvas.getBoundingClientRect();
      const xs = [], ys = [];
      for (const [x, y] of [[-128, -128], [128, -128], [128, 128], [-128, 128]]) { const q = vp.project(new p.constructor(x, y, 0)); xs.push(q[0]); ys.push(q[1]); }
      return { moving: vp.isMoving(), dist: Math.hypot(p.x, p.y, p.z), plateW: (Math.max(...xs) - Math.min(...xs)) / r.width, plateH: (Math.max(...ys) - Math.min(...ys)) / r.height, gridVisible: vp.grid.visible };
    });
    await page.waitForFunction(() => !window.__app.vp.isMoving());
    for (const wait of [0, 1500]) {
      await page.waitForTimeout(wait);
      const v = await look();
      expect(v.gridVisible, "the plate and grid are drawn").toBe(true);
      expect(v.dist, "camera distance from the origin (mm)").toBeLessThan(1000);
      expect(v.plateW, "the 256 mm plate's width as a share of the view").toBeGreaterThan(0.3);
    }
  });

  test("landscape: Make the ground, a Raise drag lifts it, a Pond drag adds water", async ({}, info) => {
    test.setTimeout(300_000); // software WebGL draws the ground and water slowly, more so while other runs share the machine
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await enterArch("Upstream 2.5 land");
    await roomRaised();
    await makeLand();
    const flat = await landStats();
    expect(flat.range).toBe(0);
    expect(flat.wet).toBe(0);
    await page.click("#ar-sim");
    if (await page.evaluate(() => document.getElementById("ar-wx-water").checked)) await page.click("#ar-wx-water"); // still water: no animation noise while dragging
    await page.click("#ar-land");
    await view(-0.9, 0.6, 0, 0, 32000);
    const stroke = [[-9000, 6000], [-7000, 8000], [-9000, 9000]];
    await drag(stroke); await drag(stroke);
    const hills = await landStats();
    expect(hills.range, "ground height range after a Raise drag (mm)").toBeGreaterThan(flat.range + 100);
    // the landscape lessons tick their steps off from this same state
    expect(await page.evaluate(() => window.__app.tutorials.T.archLandRange(500)), "the l-yard Raise step's check").toBe(true);
    await page.click('#ar-landtools [data-t="water"]');
    await drag([[7000, -7000], [8500, -6000], [9000, -8000]]);
    const pond = await landStats();
    expect(pond.wet, "water cells after a Pond drag").toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__app.tutorials.T.archLandWater()), "the l-pond Pond step's check").toBe(true);
    // a tree stays in the landscape too
    await page.click('#ar-landtools [data-t="plant"]');
    await page.click('#ar-plants [data-p="oak"]');
    const [sx, sy] = await at(-8000, -6000, 0);
    await page.mouse.click(sx, sy);
    await expect.poll(async () => (await landStats()).plants).toBe(1);
    expect(await page.evaluate(() => window.__app.tutorials.T.archPlants("tree")), "the l-yard tree step counts the oak").toBe(1);
    await leaveArch();
  });

  test("flood test: a raised house with a door, on its ground, runs a rainstorm and shows a result", async ({}, info) => {
    test.setTimeout(300_000); // software WebGL draws the ground and water slowly, more so while other runs share the machine
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await enterArch("Upstream 2.5 flood");
    await roomRaised();
    await doorInFront(-2000, -2500);
    await page.click("#ar-roof");
    await page.click("#ar-roof-all");
    await expect.poll(async () => (await arch()).roofs).toBeGreaterThan(0);
    await makeLand();
    await page.click("#ar-sim");
    await view(-0.9, 0.55, 0, 0, 26000);
    await page.click("#ar-flood-rate [data-r]:first-child"); // the lightest rain
    await page.click("#ar-flood-hours button:nth-child(1)"); // for one hour
    await page.click("#ar-flood-run");
    await page.waitForFunction(() => { const f = window.__app.arch.state.flood; return f.result && !f.running; }, null, { timeout: 120_000 });
    const res = await page.evaluate(() => { const f = window.__app.arch.state.flood; return { running: f.running, hasResult: !!f.result, doors: f.result.doors.length }; });
    expect(res).toEqual({ running: false, hasResult: true, doors: 1 });
    expect(await page.evaluate(() => window.__app.tutorials.T.archFloodDone()), "the l-flood run step's check").toBe(true);
    await expect(page.locator("#ar-flood-verdict")).toBeVisible();
    expect((await page.locator("#ar-flood-result").innerText()).trim().length).toBeGreaterThan(10);
    await leaveArch();
  });

  test("floor plan: the Floor plan dialog saves SVG, DXF and PDF files that are not empty", async ({}, info) => {
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await enterArch("Upstream 2.5 plan");
    await roomRaised();
    await doorInFront(-2000, -2500);
    const save = async (nth) => {
      await page.click("#ar-planexp");
      await page.click(`#ar-pe-fmt button:nth-child(${nth})`);
      return download(() => page.click("#ar-pe-go"));
    };
    const svg = await save(2);
    expect(svg.name).toMatch(/\.svg$/i);
    expect(svg.bytes.length).toBeGreaterThan(500);
    expect(svg.bytes.toString("utf8", 0, 200)).toMatch(/<svg|<\?xml/);
    const dxf = await save(3);
    expect(dxf.name).toMatch(/\.dxf$/i);
    expect(dxf.bytes.length).toBeGreaterThan(500);
    expect(dxf.bytes.toString("utf8", 0, 40)).toMatch(/^\s*0\s*\r?\nSECTION/);
    expect(dxf.bytes.toString("utf8")).toMatch(/\r?\nEOF\s*$/);
    const pdf = await save(1);
    expect(pdf.name).toMatch(/\.pdf$/i);
    expect(pdf.bytes.toString("latin1", 0, 5)).toBe("%PDF-");
    await leaveArch();
  });

  test("house and landscape export: STL and 3MF download, are not empty and fit the build plate", async ({}, info) => {
    test.setTimeout(300_000); // software WebGL draws the ground and water slowly, more so while other runs share the machine
    quarantine(info, ["site-firefox", "single-firefox"], "mouse drawing of walls does not register in Firefox");
    await enterArch("Upstream 2.5 export");
    await roomRaised();
    await doorInFront(-2000, -2500);
    await page.click("#ar-roof");
    await page.click("#ar-roof-all");
    await makeLand();
    const exportAs = async (nth) => {
      await page.click("#ar-export");
      await page.click(`#ar-e-fmt button:nth-child(${nth})`);
      const file = await download(() => page.click("#ar-exp-go"));
      await expect(page.locator("#ar-exp-go")).toHaveCount(0, { timeout: 60_000 }); // the dialog closes once the file is made
      return file;
    };
    const stl = await exportAs(3);
    expect(stl.name).toBe("house-and-landscape.stl");
    const n = stl.bytes.readUInt32LE(80);
    expect(n).toBeGreaterThan(100);
    expect(stl.bytes.length).toBe(84 + n * 50);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const x = stl.bytes.readFloatLE(84 + t * 50 + 12 + v * 12 + k * 4);
      lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);
    }
    expect(hi[0] - lo[0]).toBeGreaterThan(20); expect(hi[0] - lo[0]).toBeLessThanOrEqual(256.5);
    expect(hi[1] - lo[1]).toBeGreaterThan(20); expect(hi[1] - lo[1]).toBeLessThanOrEqual(256.5);
    expect(hi[2] - lo[2]).toBeGreaterThan(5);
    const mf = await exportAs(1);
    expect(mf.name).toBe("house-and-landscape.3mf");
    const xml = zipText(mf.bytes, "3D/3dmodel.model");
    const xs = [], ys = [];
    for (const m of xml.matchAll(/<vertex x="(-?[\d.e+-]+)" y="(-?[\d.e+-]+)"/g)) { xs.push(+m[1]); ys.push(+m[2]); }
    expect(xs.length).toBeGreaterThan(100);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(256.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(256.5);
    expect(xml).toContain("<basematerials");
    await leaveArch();
  });

  test("CAM Studio 4th axis: rotary on a small cylinder makes G-code with A moves", async () => {
    // a 20 mm round bar lying along X, in Advanced (the author's cam4.cjs setup)
    await loadDoc(page, newDoc("Upstream 2.5 rotary", "advanced", { bodies: [
      body("c1", "Handle", prim("cylinder", { w: 20, d: 20, h: 50 }), [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -25, 0, 12, 1], { color: "#c9a27a" }),
    ] }));
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    await page.click("#ws-simulate");
    await page.click("#sim-cam");
    await expect(page.locator("#cam-side")).toBeVisible();
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.result && u.done; }, null, { timeout: 90_000 });
    await page.click('#cam-axes button[data-v="4"]');
    if (await page.locator("#cam-use4").count()) await page.click("#cam-use4");
    await page.waitForFunction(() => { const u = window.__app.cam._ui(); return u && u.result && u.result.job.rotary && u.done; }, null, { timeout: 120_000 });
    const gcode = await page.evaluate(() => window.__app.cam._ui().result.gcode);
    expect(gcode.split("\n").length).toBeGreaterThan(20);
    expect(gcode).toMatch(/^G[01] .*\bA-?[\d.]+/m); // moves that turn the A axis
    await page.click("#cam-export");
    const saved = await download(() => page.click("#cam-save-go"));
    // the machine can switch to one with a rotary axis after the first read, which changes the comment header: compare the moves
    const moves = (t) => t.split("\n").filter((l) => !l.startsWith("(")).join("\n");
    expect(moves(saved.bytes.toString("utf8"))).toBe(moves(gcode));
    await page.click("#cam-close");
    await expect(page.locator("#cam-side")).toHaveCount(0);
  });
});
