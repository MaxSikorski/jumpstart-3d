// Upstream 2.1.3 regressions, shared by the configured site and single-file projects.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, waitIdle, bodies, newDoc, body, prim, IDENTITY } from "./helpers.mjs";
import { BUILD, VERSION } from "../src/version.js";
import { facePatCells } from "../src/facepat.js";

const box = (mode = "advanced", size = 20) => newDoc("Upstream 2.1.3", mode, {
  bodies: [body("b1", "Box", prim("box", { w: size, d: size, h: 8, r: 0, c: 0 }))],
});

test("Pattern cell limit permits 2500 accepted cells and stops at the 2501st", () => {
  const pattern = { kind: "mesh", size: 1, gap: 0.1 }, bounds = [0, 0, 50, 50];
  const cells = facePatCells(pattern, bounds, ({ c: [x, y] }) => x >= 0 && y >= 0 && x < 50 && y < 50);
  expect(cells).toHaveLength(2500);
  let visited = 0, accepted = 0;
  expect(() => facePatCells(pattern, bounds, ({ c: [x, y] }) => {
    visited++;
    const fits = x >= 0 && y >= 0;
    if (fits) accepted++;
    return fits;
  })).toThrow("Pattern: that would be more than 2500 shapes. Make the pattern size bigger (or pick a smaller face).");
  expect(accepted).toBe(2501);
  expect(visited).toBeGreaterThan(accepted);
});

// Use the same world-point projection as holepattern.spec.mjs to pick a real top face.
async function lookDown(page) {
  await page.evaluate(() => {
    const a = window.__app, v = a.vp, V = v.camera.position.constructor;
    a.needFit = false;
    v.animateTo({ az: -Math.PI / 2, el: 1.4, dist: 100, target: new V(0, 0, 0) }, 10);
    if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms);
    v.render();
  });
}
async function pickTop(page) {
  const point = await page.evaluate(() => {
    const v = window.__app.vp, V = v.camera.position.constructor;
    const p = v.project(new V(0, 0, 8)), r = v.canvas.getBoundingClientRect();
    return [r.left + p[0], r.top + p[1]];
  });
  await page.mouse.click(...point);
}

async function voxelExportColors(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#vx-3mf")]);
  expect(download.suggestedFilename()).toMatch(/\.3mf$/);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  // makeZip writes stored entries; read the model entry from the actual downloaded archive.
  let model;
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 30, offset + 30 + nameLength) === "3D/3dmodel.model") model = bytes.toString("utf8", start, start + size);
    offset = start + size;
  }
  expect(model).toBeDefined();
  const result = await page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    return { errors: xml.querySelectorAll("parsererror").length, colors: [...xml.querySelectorAll("base")].map((b) => b.getAttribute("displaycolor")) };
  }, model);
  expect(result.errors).toBe(0);
  return result.colors;
}

test.describe("geometry and tools", () => {
  let page, errors;
  test.beforeAll(async ({ browser }, info) => {
    page = await browser.newPage();
    errors = watchErrors(page);
    page.on("console", (m) => { if (m.type() === "warning" && m.text().startsWith("texture failed")) errors.push(m.text()); });
    await boot(page, info);
  });
  test.afterAll(async () => { await page.close(); });
  test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

  for (const mode of ["raise", "cut"]) test(`Pattern on face: ${mode} is one editable modifier and undo restores the box`, async () => {
    await loadDoc(page, box());
    const [plain] = await bodies(page);
    expect(plain.error).toBeNull();
    await lookDown(page);
    await page.click("#ad-decorate");
    await page.click("#ad-facepat");
    await expect(page.locator("#cmd")).toContainText("Pattern on face");
    await pickTop(page);
    await page.click('#fp-kind [data-k="hex"]');
    if (mode === "cut") await page.locator("#fp-mode").getByRole("button", { name: "Cut in", exact: true }).click();
    await expect(page.locator("#cmd-ok")).toBeEnabled();
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
    const result = await bodies(page);
    expect(result).toHaveLength(1);
    expect(result[0].error).toBeNull();
    if (mode === "raise") expect(result[0].volume).toBeGreaterThan(plain.volume);
    else expect(result[0].volume).toBeLessThan(plain.volume);
    const mods = await page.evaluate(() => window.__store.doc.bodies[0].node.mods);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ t: "facepat", kind: "hex", mode });
    await expect(page.locator('.tl-item[aria-label="Pattern on face"]')).toHaveCount(1);
    await page.locator('.tl-item[aria-label="Pattern on face"]').dblclick();
    await expect(page.locator("#cmd")).toContainText("Edit Pattern on face");
    await page.fill("#fp-size", "6");
    await page.locator("#fp-size").blur();
    await page.click("#cmd-ok");
    await expect(page.locator("#cmd")).toBeHidden();
    await waitIdle(page);
    const edited = await bodies(page);
    expect(edited).toHaveLength(1);
    expect(edited[0].error).toBeNull();
    expect(edited[0].volume).not.toBe(result[0].volume);
    expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods)).toEqual([{ ...mods[0], size: 6 }]);
    await page.evaluate(() => window.__store.undo());
    await waitIdle(page);
    expect(await bodies(page)).toEqual(result);
    expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods)).toEqual(mods);
    await page.evaluate(() => window.__store.undo());
    await waitIdle(page);
    expect(await bodies(page)).toEqual([plain]);
    expect(await page.evaluate(() => window.__store.doc.bodies[0].node.mods)).toEqual([]);
  });

  test("Pattern on face: a large candidate grid is accepted when only one hexagon fits", async () => {
    await loadDoc(page, box("advanced", 21.6));
    await page.evaluate(() => window.__store.update((doc) => {
      doc.bodies[0].node.mods.push({ id: "border", seq: 2, t: "facepat", p: [0, 0, 8], n: [0, 0, 1], x: [1, 0, 0], kind: "hex", mode: "raise", size: 0.5, gap: 0.1, depth: 1, border: 10.2, edge: "whole", angle: 0, ox: 0, oy: 0 });
    }, "Bordered face pattern"));
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    // Upstream generates 2517 candidates here, but accepts only the central hexagon.
    const volume = await page.evaluate(() => window.__app.scene.views.get("b1").data.volume);
    expect(volume - 21.6 * 21.6 * 8).toBeCloseTo(Math.sqrt(3) / 2 * 0.4 ** 2, 4);
  });

  test("Pattern on face: excessive count reports the kernel limit and the worker recovers", async () => {
    await loadDoc(page, box("advanced", 26));
    await page.evaluate(() => window.__store.update((doc) => {
      doc.bodies[0].node.mods.push({ id: "limit", seq: 2, t: "facepat", p: [0, 0, 8], n: [0, 0, 1], x: [1, 0, 0], kind: "mesh", mode: "raise", size: 0.5, gap: 0.1, depth: 1, border: 0, edge: "whole", angle: 0, ox: 0, oy: 0 });
    }, "Excessive face pattern"));
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBe("Pattern: that would be more than 2500 shapes. Make the pattern size bigger (or pick a smaller face).");
    await page.evaluate(() => window.__store.undo());
    await waitIdle(page);
    const [restored] = await bodies(page);
    expect(restored.error).toBeNull();
    expect(restored.volume).toBe(26 * 26 * 8);
  });

  test("Voxel Studio: imported and exported colours are normalized, and closing preserves the design", async () => {
    const doc = newDoc("Imported voxel colours", "advanced", {
      bodies: ["#12ABEF", '#123456" injected="yes', "#abcdef\n", "#abc"].map((color, i) => {
        const m = IDENTITY.slice(); m[12] = i * 12;
        return body(`colour${i}`, `Colour ${i}`, prim("box", { w: 8, d: 8, h: 8, r: 0, c: 0 }), m, { color });
      }),
    });
    await page.setInputFiles("#file-import", { name: "voxel-colours.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "jumpstart-3d", version: 1, doc })) });
    await page.waitForFunction(() => window.__store.doc.name === "Imported voxel colours");
    await waitIdle(page);
    const before = await bodies(page);
    expect(before).toHaveLength(4);
    expect(before.map((b) => b.error)).toEqual([null, null, null, null]);
    await page.evaluate(() => localStorage.setItem("jumpstart3d.voxel.count", "16"));
    await page.click("#ws-simulate");
    await page.click("#sim-voxel");
    await expect(page.getByRole("dialog", { name: "Voxel Studio", exact: true })).toBeVisible();
    await page.waitForFunction(() => {
      const u = window.__app.voxel._ui();
      return u && u.g && u.g.occ.some((v) => v > 0);
    });
    await expect(page.locator("#vx-count").getByRole("button", { name: "16", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__app.voxel._ui().g.colors)).toEqual(["#12abef", "#c8ccd2"]);
    expect(await voxelExportColors(page)).toEqual(["#12ABEFFF", "#C8CCD2FF"]);
    // Bypass import normalization to exercise the independent XML boundary too.
    await page.evaluate(() => { window.__app.voxel._ui().g.colors.splice(0, 2, "#abcdef", '#123456" injected="yes'); });
    expect(await voxelExportColors(page)).toEqual(["#ABCDEFFF", "#C8CCD2FF"]);
    await page.click("#vx-cancel");
    await expect(page.locator("#voxel")).toHaveCount(0);
    await waitIdle(page);
    expect(await bodies(page)).toEqual(before);
  });

  test("Voxel Studio: picking and painting the same palette colour uses one colour", async () => {
    const doc = box();
    doc.bodies[0].color = "#D01012";
    await loadDoc(page, doc);
    await page.evaluate(() => localStorage.setItem("jumpstart3d.voxel.count", "16"));
    await page.click("#ws-simulate");
    await page.click("#sim-voxel");
    await page.waitForFunction(() => {
      const u = window.__app.voxel._ui();
      return u && u.g && u.mesh && !u.dirty;
    });
    // A single solid box fills the camera target at the centre of the canvas.
    const canvas = page.locator("#voxel-canvas");
    await page.click('#vx-tool [data-v="pick"]');
    await canvas.click();
    await expect(page.locator('#vx-tool [data-v="paint"]')).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__app.voxel._ui().st.color)).toBe("#d01012");
    await canvas.click();
    await page.click('#vx-colors [data-c="#d01012"]');
    await canvas.click();
    expect(await page.evaluate(() => window.__app.voxel._ui().g.colors)).toEqual(["#d01012"]);
    await expect(page.locator("#vx-colorlist tr")).toHaveCount(1);
    await page.click("#vx-cancel");
    await expect(page.locator("#voxel")).toHaveCount(0);
  });

  test("Beginner: ArrowRight follows the default camera's screen-right ground axis; Shift moves ten steps", async () => {
    await loadDoc(page, box("beginner"));
    const expected = await page.evaluate(() => {
      const a = window.__app, v = a.vp;
      v.setView("home");
      if (v.anim) v.stepAnim(v.anim.t0 + v.anim.ms);
      a.select(["b1"]);
      const step = a.gridStep() || 1;
      // Independent expected axis from camera orientation; arrowDelta uses the closest ground axis.
      const R = new v.camera.position.constructor(1, 0, 0).applyQuaternion(v.camera.quaternion);
      const axis = Math.abs(R.x) >= Math.abs(R.y) ? [Math.sign(R.x), 0, 0] : [0, Math.sign(R.y), 0];
      return { step, delta: axis.map((x) => x * step) };
    });
    await page.locator("#viewport").click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => window.__app.select(["b1"]));
    await page.keyboard.press("ArrowRight");
    await waitIdle(page);
    const position = () => page.evaluate(() => window.__store.doc.bodies[0].m.slice(12, 15));
    expect(await position()).toEqual(expected.delta);
    expect(await page.evaluate(() => {
      const v = window.__app.vp, V = v.camera.position.constructor;
      const pos = window.__store.doc.bodies[0].m.slice(12, 15);
      return v.project(new V(...pos))[0] - v.project(new V(0, 0, 0))[0];
    }), "ArrowRight moves right on screen").toBeGreaterThan(0);
    await page.keyboard.press("Shift+ArrowRight");
    await waitIdle(page);
    expect(await position()).toEqual(expected.delta.map((x) => x * 11));
    expect((await bodies(page))[0].error).toBeNull();
  });

  test("Textures: Wood, Building and Fabric offer new keys and oak applies", async () => {
    await loadDoc(page, box());
    await page.evaluate(() => window.__app.select(["b1"]));
    await page.click("#ad-decorate");
    await page.click("#ad-texture");
    for (const [category, key] of [["Wood", "oak"], ["Building", "shingles"], ["Fabric", "denim"]]) {
      await page.locator("#tx-cats").getByRole("button", { name: category, exact: true }).click();
      await expect(page.locator(`#tx-grid [data-key="${key}"]`)).toBeVisible();
    }
    await page.click("#tx-all");
    await page.locator("#tx-cats").getByRole("button", { name: "Wood", exact: true }).click();
    await page.click('#tx-grid [data-key="oak"]');
    await page.click("#cmd-ok");
    await waitIdle(page);
    expect((await bodies(page))[0].error).toBeNull();
    expect(await page.evaluate(() => window.__store.doc.bodies[0].textures)).toEqual([expect.objectContaining({ tex: "oak", faces: "all" })]);
  });
});

for (const scenario of ["newer", "equal", "older", "201", "500", "abort", "malformed JSON", "malformed tag"]) {
  test(`Update check: ${scenario}, explicit click only and button recovers`, async ({ page }, info) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const requests = [];
    await page.route("https://api.github.com/**", async (route) => {
      requests.push(route.request());
      if (scenario === "abort") return route.abort();
      const build = BUILD + (scenario === "newer" || scenario === "malformed tag" ? 1 : scenario === "older" ? -1 : 0);
      const tag = `v${VERSION}-community.${build}${scenario === "malformed tag" ? "junk" : ""}`;
      await route.fulfill({ status: scenario === "500" ? 500 : scenario === "201" ? 201 : 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: scenario === "malformed JSON" ? "{" : JSON.stringify({ tag_name: tag, html_url: "https://malicious.invalid/release" }) });
    });
    await boot(page, info);
    expect(requests).toHaveLength(0);
    await page.click("#btn-about");
    await expect(page.locator("#ab-check")).toBeVisible();
    expect(requests).toHaveLength(0);
    await page.click("#ab-check");
    const status = page.locator("#ab-upmsg");
    if (scenario === "newer") {
      await expect(status).toContainText(/available/i);
      await expect(status.locator("a")).toHaveAttribute("href", "https://github.com/MaxSikorski/jumpstart-3d/releases/latest");
    } else if (scenario === "equal" || scenario === "older") await expect(status).toContainText(/latest/i);
    else await expect(status).toContainText("Couldn't check");
    await expect(page.locator("#ab-check")).toBeEnabled();
    expect(requests).toHaveLength(1);
    expect(requests[0].url()).toBe("https://api.github.com/repos/MaxSikorski/jumpstart-3d/releases/latest");
    expect(requests[0].headers().referer).toBeUndefined();
    expect(pageErrors).toEqual([]);
  });
}

test("Update check: the timeout covers a stalled JSON body and uses private uncached fetch options", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await page.clock.install();
  await page.evaluate(() => {
    const original = window.fetch;
    window.__updateFetch = [];
    window.fetch = (url, options) => {
      if (url !== "https://api.github.com/repos/MaxSikorski/jumpstart-3d/releases/latest") return original(url, options);
      window.__updateFetch.push({ credentials: options.credentials, referrerPolicy: options.referrerPolicy, cache: options.cache });
      return Promise.resolve({ status: 200, json: () => {
        window.__updateJsonStarted = true;
        return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      } });
    };
  });
  await page.click("#btn-about");
  await page.click("#ab-check");
  await expect(page.locator("#ab-check")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__updateJsonStarted)).toBe(true);
  await page.clock.fastForward(8001);
  await expect(page.locator("#ab-upmsg")).toContainText("Couldn't check");
  await expect(page.locator("#ab-check")).toBeEnabled();
  expect(await page.evaluate(() => window.__updateFetch)).toEqual([{ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }]);
  expect(errors).toEqual([]);
});
