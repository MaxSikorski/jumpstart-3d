// The phone first-part budget (J2, outcome 2 judge). A first-time visitor on a 375 px touch phone (Pixel 7 profile) over a simulated
// 4G link (9 Mbit/s down, 1.5 Mbit/s up, 150 ms), served with gzip like GitHub Pages (test/serve.mjs ... gzip). From the first load it
// taps a box, a cylinder hole, types the hole's size, pans with two fingers, turns on Multi-select, taps the box, groups and exports an STL.
// The page's internals are read only to wait and to choose where a finger goes, never to act. Every run prints a `mobile-budget:` line.
// The budgets are about 2x a MacBook's numbers (bytes: +5 %, they do not vary with the machine). If a CI runner fails only on a time budget,
// set that budget to 1.5x the runner's number, rounded up to the next second, and say so in the changelog. A deliberate size change bumps the bytes.
// The warm-up prepares the server's gzip cache only (Playwright's context.request goes through Node, not Chromium's connection pool or cache), so "usable" still measures a fresh page; the 0.6 s drop seen after adding it is not fully explained.
// CPU slowdown is not emulated: Chromium's does not reach the geometry engine's worker, so it would only add noise.
import { test, expect } from "@playwright/test";
import { watchErrors, waitIdle, bodies, stlTriangles } from "./helpers.mjs";

const BUDGET = { usable: 5_000, ready: 18_000, stl: 25_000, bytes: 9_300_000 }; // lowered after the helpers share one three.js: measured 9_245_863, was 9_595_910 (Max, 2026-10-28); 9_600_000 raised for the Manifold mesh engine in worker.js, about +225 KB gzipped (Max, 2026-10-27); 9_370_000 raised for J.Siwek 2.7.7 (Max, 2026-10-27); lazy-loading CosForge/Carve is the real fix (measured 9_343_178 with 2.7.7; 9_320_000 until 2.7.7); 9_300_000 until J.Siwek 2.7.3 (his round-face repair and pattern picking added about 3.6 KB on the wire)

const STARTUP = ["/", "/app.js", "/worker.js", "/occt-gz.wasm"];

test("a first-time visitor on a phone gets from the first load to a downloaded STL within the budget", async ({ page, context }, info) => {
  const baseURL = info.project.use.baseURL;
  const errors = watchErrors(page);

  // Wire bytes are the content-length of every response from the site (Google Fonts are third-party and not counted). A response without one is recorded, never counted as 0.
  let wire = 0;
  const seen = new Map();
  const noLength = [];
  page.on("response", (r) => {
    if (!r.url().startsWith(baseURL)) return;
    const path = new URL(r.url()).pathname, length = r.headers()["content-length"];
    if (/^\d+$/.test(length || "")) wire += +length; else noLength.push(path);
    seen.set(path, r.headers()["content-encoding"] || "");
  });

  let stl = null; // ms from the navigation to the finished STL download
  let cdp;
  try {
    // Warm the server's gzip cache for the four startup files before the clock starts: after a rebuild, a reused server compresses on the first request, and that must not land inside the timed navigation.
    for (const path of STARTUP) await context.request.get(baseURL + path.slice(1), { headers: { "accept-encoding": "gzip" } });

    // The two page marks, in ms from the navigation's timeOrigin (as tools/measure-load.mjs, without its localStorage line: nothing is seeded).
    await page.addInitScript(() => {
      window.__t = {};
      const poll = setInterval(() => {
        const n = performance.now(), t = window.__t, a = window.__app, l = document.getElementById("loading");
        if (!t.usable && l && (l.hidden || l.classList.contains("done"))) t.usable = n;
        if (!t.ready && a && a.kernel && a.kernel.ready) t.ready = n;
        if (t.usable && t.ready) clearInterval(poll);
      }, 20);
    });
    cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: 1_125_000, uploadThroughput: 187_500, latency: 150 });

    await page.goto(baseURL, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__t && window.__t.usable, null, { timeout: 60_000, polling: 20 });

    // tapped while the engine is still loading
    await page.locator('#shapes .tile[data-kind="box"]').tap();
    await waitIdle(page);

    await page.locator("#dock-holes").tap();
    await page.locator('#shapes .tile[data-kind="cylinder"]').tap();
    await waitIdle(page);

    // 8 mm leaves a 6 mm wall: a real hole, not the tangent cut the default size gives
    for (const key of ["w", "d"]) {
      await page.locator(`#insp-${key}`).tap();
      await page.keyboard.type("8");
      await page.keyboard.press("Enter");
      await waitIdle(page);
    }
    expect(await page.evaluate(() => window.__store.doc.bodies.find((b) => b.hole).node.p)).toMatchObject({ w: 8, d: 8 });

    // At 375 x 667 the inspector covers the view centre, where every new shape lands (a finding for the mobile card, not fixed here), so the view is panned with two fingers over the free strip left of it.
    const free = await page.evaluate(() => [[15, 500], [70, 500]].every(([x, y]) => document.elementFromPoint(x, y) === window.__app.vp.canvas));
    expect(free, "no free canvas left of the inspector at 375 px").toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 15, y: 500, id: 0 }, { x: 70, y: 500, id: 1 }] });
    for (let i = 1; i <= 10; i++) {
      const y = 500 - 14 * i;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 15, y, id: 0 }, { x: 70, y, id: 1 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));

    // Multi-select sits far along the toolbar. On the CI runner a tap that scrolled the button into view and fired 47 ms later did not toggle it (run 39642886347), so scroll first, wait until the button stops moving, tap, and tap once more if it did not take.
    const multi = page.locator("#bb-multi");
    await multi.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((ok) => {
      let last = null, still = 0;
      const check = () => {
        const x = document.getElementById("bb-multi").getBoundingClientRect().x;
        still = x === last ? still + 1 : 0;
        last = x;
        if (still >= 5) ok(); else requestAnimationFrame(check);
      };
      check();
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      await multi.tap();
      if (await expect(multi).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 }).then(() => true, () => false)) break;
    }
    await expect(multi).toHaveAttribute("aria-pressed", "true");

    // A point on the box that is visible, on the box and under no Beginner handle (the selected hole's handles are larger in touch mode).
    const point = await page.evaluate(() => {
      const { vp, scene } = window.__app;
      const boxId = window.__store.doc.bodies.find((b) => !b.hole).id;
      const handles = [];
      vp.overlay.traverseVisible((o) => { if (o.userData.handle) handles.push(o); });
      const spots = [];
      for (const x of [-8, -4, 4, 8]) for (const y of [-8, -4, 4, 8]) spots.push([x, y, 20]);
      for (const z of [3, 7, 13, 17]) for (const t of [-8, -4, 4, 8]) spots.push([t, -10, z]);
      for (const z of [3, 7, 13, 17]) for (const t of [-8, -4, 4, 8]) spots.push([10, t, z]);
      const r = vp.canvas.getBoundingClientRect();
      for (const [x, y, z] of spots) {
        const v = vp.view.target.clone(); v.set(x, y, z);
        const [px, py] = vp.project(v);
        const e = { clientX: r.left + px, clientY: r.top + py };
        if (document.elementFromPoint(e.clientX, e.clientY) !== vp.canvas) continue;
        const hit = scene.pickFace(e);
        if (!hit || hit.body !== boxId) continue;
        vp.ray(e);
        if (vp.raycaster.intersectObjects(handles, true).length) continue;
        return { x: e.clientX, y: e.clientY };
      }
      return null;
    });
    expect(point, "no visible, handle-free point on the box at 375 px").not.toBeNull();
    await page.touchscreen.tap(point.x, point.y);
    const ids = await page.evaluate(() => window.__store.doc.bodies.map((b) => b.id).sort());
    expect(await page.evaluate(() => [...window.__app.sel].sort())).toEqual(ids);

    await page.locator("#bb-group").tap();
    await waitIdle(page);
    const made = await bodies(page);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ hole: false, error: null });
    expect(made[0].volume).toBeCloseTo(6994.7, 0); // 8000 - pi * 4^2 * 20

    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 90_000 }),
      (async () => { await page.locator("#btn-export").tap(); await expect(page.locator("#btn-report")).toBeVisible(); /* the only way to Report a problem on a phone: About is hidden there */ await page.locator('#menu-export button[data-act="stl"]').tap(); })(),
    ]);
    const stlAt = Date.now();
    stl = Math.round(stlAt - (await page.evaluate(() => performance.timeOrigin)));
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    expect(dl.suggestedFilename()).toMatch(/\.stl$/i);
    const triangles = stlTriangles(bytes);
    expect(triangles).toBeGreaterThan(12); // the box alone gives 12
    expect(bytes.length).toBe(84 + 50 * triangles);
  } finally {
    // Reported before any check, whatever failed; a measurement that did not finish reads n/a.
    const t = await page.evaluate(() => window.__t || {}).catch(() => ({}));
    const ms = (v) => (typeof v === "number" ? Math.round(v) + " ms" : "n/a");
    const counted = noLength.length === 0;
    const wireText = counted ? wire + " bytes" : "n/a";
    const description = `usable ${ms(t.usable)} (budget ${BUDGET.usable}), engine ${ms(t.ready)} (${BUDGET.ready}), stl ${ms(stl)} (${BUDGET.stl}), wire ${wireText} (${BUDGET.bytes}); 375x667 touch, 4G 9 Mbit/150 ms, app.js encoding ${seen.get("/app.js") || (seen.has("/app.js") ? "identity" : "n/a")}`;
    console.log("mobile-budget: " + description);
    info.annotations.push({ type: "mobile-budget", description });
  }

  const t = await page.evaluate(() => window.__t);
  expect(errors).toEqual([]);
  for (const f of STARTUP) expect(seen.has(f), `no response for ${f}`).toBe(true);
  expect([...new Set(noLength)], "responses sent without a content-length (the byte count is incomplete; a server that streams chunked is being reused)").toEqual([]);
  expect([...seen.keys()].filter((p) => p.startsWith("/helpers/")), "the helper pages load only when a helper opens (src/helperpages.js), never during the walk").toEqual([]);
  expect(seen.get("/app.js"), "app.js was not sent gzipped: a server without gzip is being reused").toBe("gzip");
  expect.soft(t.usable, "workspace usable (ms)").toBeLessThanOrEqual(BUDGET.usable);
  expect.soft(t.ready, "engine ready (ms)").toBeLessThanOrEqual(BUDGET.ready);
  expect.soft(stl, "STL downloaded (ms)").toBeLessThanOrEqual(BUDGET.stl);
  expect.soft(wire, "bytes on the wire").toBeLessThanOrEqual(BUDGET.bytes);
});
