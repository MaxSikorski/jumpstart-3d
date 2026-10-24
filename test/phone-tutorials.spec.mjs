// Outcome 2 (a first part on a phone), PR 1: the lessons can be reached on a 375 x 667 touch phone. The top bar hides Tutorials below
// 560 px and has no room for another 44 px button, so the entry lives at the top of the Open/Export menu there. This walk taps it,
// checks the chooser fits the screen, starts the community lesson c-hole-block and checks its first step is on screen, readable and
// under nothing. A second walk (below) plays the whole lesson by taps. Runs in its own touch context, so it is part of both builds.
import { test, expect, devices } from "@playwright/test";
import { watchErrors, boot, waitIdle, bodies } from "./helpers.mjs";
import { readStl, meshReport } from "./fuzz-checks.mjs";

const W = 375, H = 667;

// The entry's size and what is on top of its centre, read in the page.
const hitTest = (sel) => (s) => {
  const e = document.querySelector(s), r = e.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, covered: !(top === e || e.contains(top)) };
};

test("phone 375 x 667: Tutorials can be opened from the menu and the first step of c-hole-block is readable", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: W, height: H }, screen: { width: W, height: H }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errors = watchErrors(p);
  try {
    await boot(p, info);
    expect(await p.evaluate(() => document.documentElement.classList.contains("touch-ui")), "the touch UI is on").toBe(true);

    await p.locator("#btn-export").tap();
    const entry = p.locator("#btn-tutorials-menu");
    await expect(entry, "a Tutorials entry in the Open/Export menu at 375 px").toBeVisible();
    const hit = await p.evaluate(hitTest("#btn-tutorials-menu"), "#btn-tutorials-menu");
    expect(hit.w, "entry width").toBeGreaterThanOrEqual(44);
    expect(hit.h, "entry height").toBeGreaterThanOrEqual(44);
    expect(hit.left).toBeGreaterThanOrEqual(0);
    expect(hit.right).toBeLessThanOrEqual(W);
    expect(hit.bottom, "entry is on screen").toBeLessThanOrEqual(H);
    expect(hit.covered, "something covers the entry's centre").toBe(false);
    await entry.tap();

    // the chooser fits the screen
    const modal = p.locator(".tut-modal");
    await expect(modal).toBeVisible();
    await expect(p.locator("#menu-export")).toBeHidden();
    const box = await modal.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(W);
    expect(box.y + box.height).toBeLessThanOrEqual(H);
    expect(await p.evaluate(() => document.documentElement.scrollWidth), "the page scrolls sideways with the chooser open").toBeLessThanOrEqual(W);
    expect(await p.evaluate(() => { const m = document.querySelector(".tut-modal .mbody"); return m.scrollWidth - m.clientWidth; }), "the chooser's list scrolls sideways").toBeLessThanOrEqual(0);

    const card = p.locator("#tut-c-hole-block");
    await card.tap();
    await expect(modal).toBeHidden();

    // the first step is on screen, readable and under nothing
    const panel = p.locator("#tut-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".tut-stepno")).toHaveText(/Step 1 of/);
    const s = await p.evaluate(() => {
      const pan = document.getElementById("tut-panel"), pr = pan.getBoundingClientRect();
      const st = document.querySelector(".status").getBoundingClientRect();
      const dock = document.getElementById("shapes"), dr = dock && dock.getClientRects().length ? dock.getBoundingClientRect() : null;
      const inside = (sel) => {
        const e = pan.querySelector(sel), r = e.getBoundingClientRect();
        const top = document.elementFromPoint(Math.min(innerWidth, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight, Math.max(0, r.top + r.height / 2)));
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, font: parseFloat(getComputedStyle(e).fontSize), clipped: r.top < pr.top || r.bottom > pr.bottom, covered: !(top === e || e.contains(top)) };
      };
      return {
        panel: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, sideways: pan.scrollWidth - pan.clientWidth },
        status: { top: st.top }, dock: dr && { top: dr.top },
        scrollWidth: document.documentElement.scrollWidth,
        title: inside(".tut-step h3"), how: inside(".tut-how li"),
      };
    });
    expect(s.panel.left).toBeGreaterThanOrEqual(0);
    expect(s.panel.right).toBeLessThanOrEqual(W);
    expect(s.panel.top).toBeGreaterThanOrEqual(0);
    expect(s.panel.bottom, "panel runs under the status bar").toBeLessThanOrEqual(s.status.top + 0.5);
    if (s.dock) expect(s.panel.bottom, "panel runs under the shape strip").toBeLessThanOrEqual(s.dock.top + 0.5);
    expect(s.panel.sideways, "panel scrolls sideways").toBeLessThanOrEqual(0);
    expect(s.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(W);
    for (const k of ["title", "how"]) {
      expect(s[k].clipped, `${k} of step 1 is cut off by the panel`).toBe(false);
      expect(s[k].covered, `${k} of step 1 is under something else`).toBe(false);
      expect(s[k].font, `${k} font size`).toBeGreaterThanOrEqual(13);
    }
    // the rest of the step is read by scrolling the panel (its footer stays put): the last instruction can be scrolled to the middle, clear of the footer
    const last = await p.evaluate(() => {
      const pan = document.getElementById("tut-panel"), items = pan.querySelectorAll(".tut-how li"), e = items[items.length - 1];
      e.scrollIntoView({ block: "center" });
      const r = e.getBoundingClientRect(), pr = pan.getBoundingClientRect(), nav = pan.querySelector(".tut-nav").getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { n: items.length, inView: r.top >= pr.top && r.bottom <= Math.min(pr.bottom, nav.top + 0.5), covered: !(top === e || e.contains(top)) };
    });
    expect(last.n, "step 1 has more than one instruction").toBeGreaterThan(1);
    expect(last.inView, "the last instruction of step 1 cannot be scrolled clear of the panel's footer").toBe(true);
    expect(last.covered, "the last instruction of step 1 is under something else after scrolling").toBe(false);
    await p.screenshot({ path: process.env.PHONE_TUTORIAL_SHOT || info.outputPath("phone-tutorial-step1.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// The phone entry is for narrow screens only: on a desktop and on an iPad the top bar has the Tutorials button, so the menu must not repeat it.
for (const [width, height] of [[1280, 800], [820, 1180]]) {
  test(`${width} x ${height}: the phone Tutorials entry is not in the Open/Export menu`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await boot(page, info);
    await page.locator("#btn-export").click();
    await expect(page.locator('#menu-export button[data-act="stl"]')).toBeVisible();
    await expect(page.locator("#btn-tutorials-menu")).toBeHidden();
    await expect(page.locator("#btn-tutorials")).toBeVisible();
  });
}

// PR 2: the whole c-hole-block lesson on the phone, by taps alone, following the instructions the panel shows. Every action below is
// what a step's text asks for and is done with a finger (locator.tap, which fails when something covers the target); the page's
// internals are read only to choose where a finger goes and to check the result. The end: a 40 x 40 x 8 mm block with a 10 mm hole
// that goes right through it, and the STL the Export menu downloads says the same.
// the app shows Ctrl as the Command sign on a Mac, so both spellings are listed
const KEYBOARD_ONLY = /⌘|\b(ctrl|cmd|shift|alt|esc|escape|right-click|double-click|mouse wheel|keyboard)\b/i;

// Taps a point on `id` that is on the canvas, under nothing, on that body's surface and clear of the Beginner handles.
async function tapBody(p, id) {
  const pt = await p.evaluate((id) => {
    const { vp, scene } = window.__app;
    const handles = [];
    vp.overlay.traverseVisible((o) => { if (o.userData.handle) handles.push(o); });
    const r = vp.canvas.getBoundingClientRect();
    for (let y = r.top + 8; y < r.bottom - 8; y += 12) for (let x = r.left + 8; x < r.right - 8; x += 12) {
      const e = { clientX: x, clientY: y };
      if (document.elementFromPoint(x, y) !== vp.canvas) continue;
      const hit = scene.pickFace(e);
      if (!hit || hit.body !== id) continue;
      vp.ray(e);
      if (vp.raycaster.intersectObjects(handles, true).length) continue;
      return { x, y };
    }
    return null;
  }, id);
  if (!pt) await p.screenshot({ path: test.info().outputPath("no-tap-point.png") });
  expect(pt, `no visible, handle-free point on ${id} to tap at 375 px`).not.toBeNull();
  await p.touchscreen.tap(pt.x, pt.y);
}

// Taps ground where no body is, then checks nothing is selected.
async function tapEmpty(p) {
  const pt = await p.evaluate(() => {
    const { vp, scene } = window.__app;
    const r = vp.canvas.getBoundingClientRect();
    for (let y = r.bottom - 8; y > r.top + 8; y -= 12) for (let x = r.left + 8; x < r.right - 8; x += 12) {
      if (document.elementFromPoint(x, y) !== vp.canvas) continue;
      if (scene.pickFace({ clientX: x, clientY: y })) continue;
      return { x, y };
    }
    return null;
  });
  expect(pt, "no empty canvas to tap at 375 px").not.toBeNull();
  await p.touchscreen.tap(pt.x, pt.y);
  expect(await p.evaluate(() => window.__app.sel.length), "tapping empty ground leaves a selection").toBe(0);
}

// A toolbar button far along the strip: scroll it in, wait for it to stop moving, tap.
async function tapTool(p, sel) {
  const b = p.locator(sel);
  await b.scrollIntoViewIfNeeded();
  await p.evaluate((sel) => new Promise((ok) => {
    let last = null, still = 0;
    const check = () => { const x = document.querySelector(sel).getBoundingClientRect().x; still = x === last ? still + 1 : 0; last = x; if (still >= 5) ok(); else requestAnimationFrame(check); };
    check();
  }), sel);
  await b.tap();
}

// Types into a number box of the right panel the way a finger does: tap it, type, Enter on the phone keyboard.
async function setField(p, id, value) {
  await p.locator(`#${id}`).tap();
  await p.keyboard.type(String(value));
  await p.keyboard.press("Enter");
  await waitIdle(p);
}

// While Multi-select is on, the right panel is hidden on a phone (it would cover the shapes still to be tapped) but not on a tablet,
// which has the room and is also a touch-ui screen.
for (const [w, h, shown] of [[768, 1024, true], [375, 667, false]]) {
  test(`${w} x ${h} touch: the right panel is ${shown ? "kept" : "hidden"} while Multi-select is on`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: w, height: h }, screen: { width: w, height: h }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    const errors = watchErrors(p);
    try {
      await boot(p, info);
      expect(await p.evaluate(() => document.documentElement.classList.contains("touch-ui")), "the touch UI is on").toBe(true);
      await p.locator("#dock-objects").tap();
      await p.locator('#shapes .tile[data-kind="box"]').tap();
      await waitIdle(p);
      const inspector = p.locator("#inspector");
      await expect(inspector, "the right panel with a shape selected").toBeVisible();
      await tapTool(p, "#bb-multi");
      await expect(p.locator("#bb-multi")).toHaveAttribute("aria-pressed", "true");
      if (shown) await expect(inspector, "the right panel on a tablet with Multi-select on").toBeVisible();
      else await expect(inspector, "the right panel on a phone with Multi-select on").toBeHidden();
      await tapTool(p, "#bb-multi");
      await expect(p.locator("#bb-multi")).toHaveAttribute("aria-pressed", "false");
      await expect(inspector, "the right panel is back with Multi-select off").toBeVisible();
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}

test("phone 375 x 667: the c-hole-block lesson is finished by taps alone and downloads a 40 x 40 x 8 mm block with a 10 mm through-hole", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: W, height: H }, screen: { width: W, height: H }, serviceWorkers: "block", acceptDownloads: true });
  ctx.setDefaultTimeout(20_000); // a tap that cannot land fails with its own message, not the test timeout
  const p = await ctx.newPage();
  const errors = watchErrors(p);
  // The open panel covers the right panel and the tool strip, so a person reads the step, makes the panel small, works, and opens it again for Next.
  const expand = async () => { const line = p.locator("#tut-panel .tut-mini-line"); if (await line.count()) await line.tap(); };
  const small = async () => {
    const r = await p.evaluate(hitTest("#tut-min"), "#tut-min");
    expect(r.w, "Make-small button width").toBeGreaterThanOrEqual(44);
    expect(r.h, "Make-small button height").toBeGreaterThanOrEqual(44);
    await p.locator("#tut-min").tap();
  };
  const how = async (n, title) => {
    await expand();
    await expect(p.locator("#tut-panel .tut-stepno")).toHaveText(new RegExp(`Step ${n} of 9`));
    await expect(p.locator("#tut-panel .tut-step h3")).toHaveText(title);
    return p.locator("#tut-panel .tut-how li").allInnerTexts();
  };
  const next = async () => { await expand(); await p.locator("#tut-next").tap(); };
  try {
    await boot(p, info);
    await p.locator("#btn-export").tap();
    await p.locator("#btn-tutorials-menu").tap();
    await p.locator("#tut-c-hole-block").tap();

    // 1. the name: the quick boxes
    await how(1, "Name your design");
    await p.locator("#tut-last").fill("Lopez");
    await p.locator("#tut-first").fill("Maria");
    await p.locator("#tut-name-apply").tap();
    expect(await p.evaluate(() => window.__store.doc.name)).toBe("Lopez, Maria, Hole Practice");
    await next();

    // 2. the block and the cutter
    const s2 = await how(2, "Make the block and cutter");
    expect(s2.join(" ")).not.toMatch(KEYBOARD_ONLY);
    await small();
    await p.locator("#dock-objects").tap();
    await p.locator('#shapes .tile[data-kind="box"]').tap();
    await waitIdle(p);
    for (const [id, v] of [["insp-w", 40], ["insp-d", 40], ["insp-h", 8], ["insp-pos0", 0], ["insp-pos1", 0], ["insp-pos2", 0]]) await setField(p, id, v);
    await p.locator('#shapes .tile[data-kind="cylinder"]').tap();
    await waitIdle(p);
    for (const [id, v] of [["insp-w", 10], ["insp-d", 10], ["insp-h", 12], ["insp-pos0", 0], ["insp-pos1", 0], ["insp-pos2", -2]]) await setField(p, id, v);
    const made = await p.evaluate(() => window.__store.doc.bodies.map((b) => ({ id: b.id, kind: b.node.kind, hole: !!b.hole, p: b.node.p })));
    expect(made.map((b) => b.kind)).toEqual(["box", "cylinder"]);
    expect(made[0].p).toMatchObject({ w: 40, d: 40, h: 8 });
    expect(made[1].p).toMatchObject({ w: 10, d: 10, h: 12 });
    const [boxId, cutId] = made.map((b) => b.id);
    await next();

    // 3. Hole, 4. Solid and Hole again
    const s3 = await how(3, "Turn the cylinder into a cutter");
    expect(s3.join(" ")).not.toMatch(KEYBOARD_ONLY);
    await small();
    await tapTool(p, "#bb-hole");
    expect(await p.evaluate((id) => window.__store.doc.bodies.find((b) => b.id === id).hole, cutId), "the cylinder became a hole").toBe(true);
    await next();
    const s4 = await how(4, "Try changing it back");
    expect(s4.join(" ")).not.toMatch(KEYBOARD_ONLY);
    await small();
    await tapTool(p, "#bb-solid");
    expect(await p.evaluate((id) => window.__store.doc.bodies.find((b) => b.id === id).hole, cutId), "Solid restored the cylinder").toBe(false);
    await tapTool(p, "#bb-hole");
    expect(await p.evaluate((id) => window.__store.doc.bodies.find((b) => b.id === id).hole, cutId)).toBe(true);
    await next();

    // 5. both pieces selected with Multi-select
    const s5 = await how(5, "Select both pieces");
    expect(s5.join(" ")).not.toMatch(KEYBOARD_ONLY);
    await small();
    await tapEmpty(p);
    await tapTool(p, "#bb-multi");
    await expect(p.locator("#bb-multi")).toHaveAttribute("aria-pressed", "true");
    await tapBody(p, cutId);
    await tapBody(p, boxId);
    await tapTool(p, "#bb-multi");
    await expect(p.locator("#bb-multi")).toHaveAttribute("aria-pressed", "false");
    expect(await p.evaluate(() => [...window.__app.sel].sort())).toEqual([boxId, cutId].sort());
    await next();

    // 6. Group
    const s6 = await how(6, "Cut the hole");
    expect(s6.join(" ")).not.toMatch(KEYBOARD_ONLY);
    await small();
    await tapTool(p, "#bb-group");
    await waitIdle(p);
    let now = await bodies(p);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ hole: false, error: null });
    expect(now[0].volume).toBeCloseTo(40 * 40 * 8 - Math.PI * 25 * 8, -1);
    await next();

    // 7. Ungroup (both pieces stay selected), then group them again
    const s7 = await how(7, "Recover the original pieces");
    expect(s7.join(" "), "a keyboard shortcut in the step text").not.toMatch(KEYBOARD_ONLY);
    await small();
    await tapTool(p, "#bb-ungroup");
    await waitIdle(p);
    expect((await bodies(p)).map((b) => b.hole).sort(), "Ungroup returns the block and the cutter").toEqual([false, true]);
    expect(await p.evaluate(() => window.__app.sel.length), "both pieces stay selected after Ungroup").toBe(2);
    await tapTool(p, "#bb-group");
    await waitIdle(p);
    now = await bodies(p);
    expect(now, "the finished hole").toHaveLength(1);
    expect(now[0]).toMatchObject({ hole: false, error: null });
    expect(now[0].volume).toBeCloseTo(40 * 40 * 8 - Math.PI * 25 * 8, -1);
    await next();

    // 8. Save, 9. Export an STL
    await how(8, "Save your design");
    await small();
    await p.locator("#btn-save").tap();
    await expect.poll(() => p.evaluate(() => window.__app.projects.versionName())).toMatch(/Hole Practice v1$/);
    await next();
    await how(9, "Export an STL for 3D printing");
    await small();
    await tapEmpty(p);
    const [dl] = await Promise.all([
      p.waitForEvent("download", { timeout: 90_000 }),
      (async () => { await p.locator("#btn-export").tap(); await p.locator('#menu-export button[data-act="stl"]').tap(); })(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^Lopez, Maria, Hole Practice v1\.stl$/);
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    const tris = readStl(Buffer.concat(chunks));

    // the file: closed, right size, hollow in the middle
    const rep = meshReport(tris);
    expect(rep.open, "unmatched edges: not a closed mesh").toBe(0);
    expect(rep.volume, "volume of the block minus the hole (mm3)").toBeGreaterThan(40 * 40 * 8 - Math.PI * 25 * 8 - 40);
    expect(rep.volume).toBeLessThan(40 * 40 * 8 - Math.PI * 25 * 8 + 40);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const v of t) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], v[c]); hi[c] = Math.max(hi[c], v[c]); }
    for (const [c, size] of [[0, 40], [1, 40], [2, 8]]) expect(hi[c] - lo[c], "size on axis " + "xyz"[c]).toBeCloseTo(size, 1);
    expect(lo[2], "the block sits on the plate").toBeCloseTo(0, 1);
    // a vertical line down the middle meets no triangle (through-hole); one 15 mm off centre meets the top and the bottom
    const crossings = (x, y) => tris.filter(([a, b, c]) => {
      const d = (u, v, w) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
      const pt = [x, y], s1 = d(pt, a, b), s2 = d(pt, b, c), s3 = d(pt, c, a);
      return !((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) && Math.abs(s1 + s2 + s3) > 1e-9;
    }).length;
    expect(crossings(0, 0), "triangles over the middle of the hole").toBe(0);
    expect(crossings(15, 0), "triangles over solid material").toBe(2);
    await expand();
    await p.locator("#tut-next").tap(); // Finish
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
