// Send to slicer (Open/Export menu): hand the design to the user's slicer as the same painted 3MF that Export > 3MF saves.
// On a computer it downloads <design>.3mf (a .3mf opens in OrcaSlicer, PrusaSlicer, Cura or Bambu Studio once that app owns
// the file type); on an iPhone, iPad or Android phone it opens the share sheet when the browser can share files, else it
// downloads. A tip on how to open it shows the first time only, and not again after a reload.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim, exportBytes, reload } from "./helpers.mjs";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const design = () => newDoc("Pi lid", "beginner", { bodies: [
  body("b1", "Lid", prim("box", { w: 40, d: 30, h: 10, r: 0, c: 0 }), undefined, { color: "#3b82c4" }),
  body("b2", "Peg", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 0, 0, 1], { color: "#e05a2b" }),
] });

// the entries of a 3MF (makeZip writes stored, uncompressed entries)
function zipEntries(bytes) {
  const out = {};
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    expect(bytes.readUInt16LE(offset + 8), "stored entry").toBe(0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    out[bytes.toString("utf8", offset + 30, offset + 30 + nameLength)] = bytes.toString("utf8", start, start + size);
    offset = start + size;
  }
  return out;
}

// parse the 3MF the way a slicer starts: the package parts, then the model XML; each object's name, colour and triangle count
async function read3MF(page, bytes) {
  const files = zipEntries(bytes);
  expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
  expect(files["_rels/.rels"]).toContain('Target="/3D/3dmodel.model"');
  return page.evaluate((text) => {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const bases = [...xml.querySelectorAll("basematerials base")].map((b) => b.getAttribute("displaycolor"));
    return {
      errors: xml.querySelectorAll("parsererror").length,
      unit: xml.documentElement.getAttribute("unit"),
      objects: [...xml.querySelectorAll("resources > object")].map((o) => ({
        name: o.getAttribute("name"), color: bases[+o.getAttribute("pindex")], triangles: o.querySelectorAll("triangle").length,
      })),
      items: xml.querySelectorAll("build > item").length,
    };
  }, files["3D/3dmodel.model"]);
}

const expectTwoBodies = (m) => {
  expect(m.errors).toBe(0);
  expect(m.unit).toBe("millimeter");
  expect(m.objects.map((o) => [o.name, o.color])).toEqual([["Lid", "#3B82C4FF"], ["Peg", "#E05A2BFF"]]);
  for (const o of m.objects) expect(o.triangles, o.name).toBeGreaterThanOrEqual(12);
  expect(m.items).toBe(2);
};

async function readDownload(dl) {
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  return Buffer.concat(chunks);
}

const openMenuItem = async (page) => {
  await page.click("#btn-export");
  const item = page.locator('#menu-export button[data-act="slicer"]');
  await expect(item).toBeVisible();
  return item;
};

// records any navigator.share call; the computer path must never use it
const shareSpy = () => {
  window.__shared = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const f = d.files[0];
    window.__shared.push({ name: f.name, type: f.type, bytes: [...new Uint8Array(await f.arrayBuffer())] });
  };
};

test.describe("computer", () => {
  let page, errors;
  test.beforeEach(async ({ browser }, info) => {
    page = await browser.newPage();
    errors = watchErrors(page);
    await page.addInitScript(shareSpy);
    await boot(page, info);
    await page.evaluate(() => { try { localStorage.removeItem("jumpstart.slicertip.v1"); } catch (e) {} });
    await loadDoc(page, design());
  });
  test.afterEach(async () => { expect(errors).toEqual([]); await page.close(); });

  test("Send to slicer sits right above the export list, saves the same 3MF as Export > 3MF, and shows the tip once (not again after a reload)", async () => {
    await page.click("#btn-export");
    const order = await page.evaluate(() => [...document.getElementById("menu-export").children].filter((el) => el.offsetParent !== null)
      .map((el) => el.tagName === "HR" ? "HR" : el.id === "export-scope" ? "SCOPE" : el.textContent.trim().slice(0, 14)));
    expect(order.slice(0, 7)).toEqual(["Open a project", "Import a model", "HR", "SCOPE", "HR", "Send to slicer", "STL for 3D pri"]);
    await page.evaluate(() => { document.getElementById("menu-export").hidden = true; });

    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
    const bytes = await readDownload(dl);
    const exported = await exportBytes(page, "3mf");
    expect(dl.suggestedFilename()).toBe(exported.name);
    expect(dl.suggestedFilename()).toMatch(/^Pi lid.*\.3mf$/);
    expect(bytes.equals(exported.bytes), "the same bytes as Export > 3MF").toBe(true);
    expectTwoBodies(await read3MF(page, bytes));
    expect(await page.evaluate(() => window.__shared.length), "a computer downloads, it does not share").toBe(0);

    const tip = page.locator("#slicer-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Saved: " + exported.name);
    await expect(tip).toContainText("OrcaSlicer");
    await expect(tip).toContainText("Ender-3 S1");
    await tip.getByRole("button", { name: "Got it" }).click();
    await expect(tip).toHaveCount(0);

    // second send: the file again, no tip
    const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
    expect(dl2.suggestedFilename()).toBe(exported.name);
    await expect(page.locator("#toasts")).toContainText(exported.name);
    await expect(tip).toHaveCount(0);

    // after a reload: still no tip
    await reload(page);
    await page.waitForFunction(() => window.__app && window.__app.kernel && window.__app.kernel.ready && window.__app.projects.started, null, { timeout: 90_000 });
    await loadDoc(page, design());
    const [dl3] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
    expectTwoBodies(await read3MF(page, await readDownload(dl3)));
    await expect(page.locator("#toasts")).toContainText(exported.name);
    await expect(tip).toHaveCount(0);
  });

  test("Selected bodies only, and a click during a rebuild waits for it", async () => {
    await page.evaluate(() => window.__app.select(["b1"]));
    const [selected] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
    const model = await read3MF(page, await readDownload(selected));
    expect(model.errors).toBe(0);
    expect(model.objects.map((o) => o.name)).toEqual(["Lid"]);
    expect(model.items).toBe(1);

    await page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) window.__toasts.push(n.textContent); })
        .observe(document.getElementById("toasts"), { childList: true });
      window.__app.select([]);
    });
    const [rebuilt] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.evaluate(() => {
        window.__store.update((d) => { d.bodies[1].node.p.w = 30; }, "Resize");
        document.getElementById("btn-export").click();
        document.querySelector('#menu-export button[data-act="slicer"]').click();
      }),
    ]);
    const rebuiltBytes = await readDownload(rebuilt);
    expectTwoBodies(await read3MF(page, rebuiltBytes));
    // the Peg in the file is the resized one (30 mm wide), so the send waited for the rebuild
    const pegX = await page.evaluate((text) => [...[...new DOMParser().parseFromString(text, "application/xml").querySelectorAll("resources > object")][1]
      .querySelectorAll("vertex")].map((v) => +v.getAttribute("x")), zipEntries(rebuiltBytes)["3D/3dmodel.model"]);
    expect(Math.round(Math.max(...pegX) - Math.min(...pegX))).toBe(30);
    expect(await page.evaluate(() => window.__toasts.some((t) => t.includes("Still building")))).toBe(true);
  });

  test("with nothing to export it says so and saves nothing", async () => {
    await loadDoc(page, newDoc("Empty", "beginner"));
    let downloads = 0;
    page.on("download", () => downloads++);
    await (await openMenuItem(page)).click();
    await expect(page.locator("#toasts")).toContainText("Nothing to export yet");
    await expect(page.locator("#slicer-tip")).toHaveCount(0);
    expect(downloads).toBe(0);
  });
});

test.describe("phone", () => {
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA, serviceWorkers: "block" };

  async function phonePage(browser, info, initScript) {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.addInitScript(initScript);
    await boot(page, info);
    await loadDoc(page, design());
    return { ctx, page, errors };
  }

  test("share sheet when the browser can share files: the 3MF goes to navigator.share, nothing downloads, the phone tip shows", async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const { ctx, page, errors } = await phonePage(browser, info, shareSpy);
    try {
      let downloads = 0;
      page.on("download", () => downloads++);
      await (await openMenuItem(page)).click();
      await expect.poll(() => page.evaluate(() => window.__shared.length), { timeout: 60_000 }).toBe(1);
      const shared = await page.evaluate(() => window.__shared[0]);
      expect(shared.name).toMatch(/^Pi lid.*\.3mf$/);
      expectTwoBodies(await read3MF(page, Buffer.from(shared.bytes)));
      const tip = page.locator("#slicer-tip");
      await expect(tip).toBeVisible();
      await expect(tip).toContainText("Ender-3 S1");
      await expect(tip).toContainText("You shared it");
      expect(downloads, "the share path saves nothing to downloads").toBe(0);
      // the tip stays open: it hides while the menu is open, so the lower menu items can still be tapped
      const exported = await exportBytes(page, "3mf");
      expect(shared.name).toBe(exported.name);
      expect(Buffer.from(shared.bytes).equals(exported.bytes)).toBe(true);
      await expect(tip).toBeVisible();
    } finally { await ctx.close(); }
    expect(errors).toEqual([]);
  });

  test("no file sharing in this browser: it downloads the 3MF instead", async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const { ctx, page, errors } = await phonePage(browser, info, () => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    try {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
      expect(dl.suggestedFilename()).toMatch(/^Pi lid.*\.3mf$/);
      expectTwoBodies(await read3MF(page, await readDownload(dl)));
      await expect(page.locator("#slicer-tip")).toBeVisible();
    } finally { await ctx.close(); }
    expect(errors).toEqual([]);
  });

  test("closing the share sheet saves nothing and keeps the tip for later", async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const { ctx, page, errors } = await phonePage(browser, info, () => {
      window.__shared = [];
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = async (d) => {
        const f = d.files[0];
        window.__shared.push({ name: f.name, type: f.type, bytes: [...new Uint8Array(await f.arrayBuffer())] });
        throw new DOMException("Share canceled", "AbortError");
      };
    });
    try {
      let downloads = 0;
      page.on("download", () => downloads++);
      await (await openMenuItem(page)).click();
      await expect.poll(() => page.evaluate(() => window.__shared.length), { timeout: 60_000 }).toBe(1);
      await expect(page.locator("#slicer-tip")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("jumpstart.slicertip.v1"))).toBeNull();
      expect(downloads).toBe(0);
      const exported = await exportBytes(page, "stl");
      expect(exported.name).toMatch(/\.stl$/);
      expect(downloads, "only the subsequent STL export downloads").toBe(1);
      await expect(page.locator("#slicer-tip")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("jumpstart.slicertip.v1"))).toBeNull();
    } finally { await ctx.close(); }
    expect(errors).toEqual([]);
  });

  test("a refused share (NotAllowedError) falls back to a download", async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const { ctx, page, errors } = await phonePage(browser, info, () => {
      window.__shared = [];
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = async (d) => {
        const f = d.files[0];
        window.__shared.push({ name: f.name, type: f.type, bytes: [...new Uint8Array(await f.arrayBuffer())] });
        throw new DOMException("", "NotAllowedError");
      };
    });
    try {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
      expect(dl.suggestedFilename()).toMatch(/^Pi lid.*\.3mf$/);
      expectTwoBodies(await read3MF(page, await readDownload(dl)));
      await expect(page.locator("#slicer-tip")).toBeVisible();
      await expect(page.locator("#slicer-tip")).toContainText("saved to your downloads");
    } finally { await ctx.close(); }
    expect(errors).toEqual([]);
  });

  test("canShare says no: it downloads", async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const { ctx, page, errors } = await phonePage(browser, info, () => {
      window.__shared = [];
      navigator.canShare = () => false;
      navigator.share = async (d) => { window.__shared.push(d); };
    });
    try {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), (await openMenuItem(page)).click()]);
      expect(dl.suggestedFilename()).toMatch(/^Pi lid.*\.3mf$/);
      expectTwoBodies(await read3MF(page, await readDownload(dl)));
      expect(await page.evaluate(() => window.__shared.length)).toBe(0);
    } finally { await ctx.close(); }
    expect(errors).toEqual([]);
  });

});
