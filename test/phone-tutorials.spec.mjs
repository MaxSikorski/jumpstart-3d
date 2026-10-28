// Outcome 2 (a first part on a phone), PR 1: the lessons can be reached on a 375 x 667 touch phone. The top bar hides Tutorials below
// 560 px and has no room for another 44 px button, so the entry lives at the top of the Open/Export menu there. This walk taps it,
// checks the chooser fits the screen, starts the community lesson c-hole-block and checks its first step is on screen, readable and
// under nothing. A second walk (below) plays the whole lesson by taps. Runs in its own touch context, so it is part of both builds.
import { test, expect, devices } from "@playwright/test";
import { watchErrors, boot, waitIdle, bodies, buildOf } from "./helpers.mjs";
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

// ---------------------------------------------------------------- PR 1b: "Show me" on a phone and on an iPad
// Every lesson, every step, by taps: the chooser (the way a person can reach it at this width), the card, then at each step the quick name
// boxes, a tap on Show me and a look at what it points at. A pointer is only good if its target is on screen, nothing covers it, Show me did not
// shift it, its pop-up is on screen and a finger tap would land on it. Every problem found is collected, so one run shows them all, and the
// list is asserted once at the end. The set-up a step needs (a sketch open, the Lathe, a selected box, ...) is done page-side: it is not what is judged.
// Architect layout on narrow screens is not this PR's work; a fix that clears one must delete it here (the test fails on an entry that now passes).
const KNOWN = [
  "375x812 h-grid 7", "375x812 l-flood 5", "375x812 l-flood 6",
  "768x1024 h-grid 4", "768x1024 h-grid 5", "768x1024 h-grid 6", "768x1024 h-grid 7", "768x1024 l-flood 5", "768x1024 l-flood 6",
];

// Put the app back to a plain state between steps (page-side, as tutorials.spec.mjs does): out of a sketch and the Lathe, no menu or pop-up left open.
async function normalize(p, { keepLathe = false } = {}) {
  const vis = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; }, sel);
  if (keepLathe && (await vis("#lathe-cancel, .lathe-done-back"))) return;
  const dirty = await p.evaluate(() => {
    const d = [".lathe-done-back", "#lathe-start", "#lathe-cancel", "#sk-finish", "#ribbon-menu"].some((s) => { const e = document.querySelector(s); return e && e.getClientRects().length; });
    if (!d) { document.querySelectorAll(".modal-back").forEach((b) => b.remove()); const m = document.getElementById("menu-export"); if (m) m.hidden = true; }
    return d;
  });
  if (dirty) {
    for (let k = 0; k < 4; k++) {
      if (await vis(".lathe-done-back")) { await p.evaluate(() => [...document.querySelectorAll(".lathe-done-back button")].find((b) => b.textContent === "Keep turning").click()); continue; }
      if (await vis("#lathe-start")) { await p.evaluate(() => [...document.querySelectorAll(".s3d-modal-btns button")].find((b) => b.textContent === "Cancel").click()); continue; }
      if (await vis("#lathe-cancel")) { await p.evaluate(() => document.querySelector("#lathe-cancel").click()); continue; }
      if (await vis("#sk-finish")) { await p.evaluate(() => document.querySelector("#sk-finish").click()); continue; }
      if (await vis("#ribbon-menu")) { await p.keyboard.press("Escape"); continue; }
      break;
    }
  }
  if (dirty) await p.evaluate(() => { document.querySelectorAll(".modal-back").forEach((b) => b.remove()); const m = document.getElementById("menu-export"); if (m) m.hidden = true; });
}

// The set-up a step's target needs, the same as prepareFor in tutorials.spec.mjs but with page-side clicks.
async function prepareFor(p, sel, mode) {
  const click = (s) => p.evaluate((s) => document.querySelector(s).click(), s);
  const addBox = async () => { // a selected box, put in through the store (a tile or menu item adds by pointer events; this is not what is judged)
    await p.evaluate(() => {
      window.__store.update((d) => d.bodies.push({ id: "pbox", name: "Box", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] } }), "a box for the walk");
      window.__app.select(["pbox"]);
    });
    await waitIdle(p);
  };
  if (/#sk-/.test(sel)) { await click("#ad-sketch"); await click("#plane-seg button"); await p.waitForSelector("#sk-line", { state: "attached" }); return "sketch open"; }
  if (/#lathe-/.test(sel)) {
    await normalize(p);
    await click(mode === "beginner" ? "#bb-lathe" : "#ad-lathe");
    await p.waitForSelector("#lathe-start", { state: "attached" });
    if (/lathe-start/.test(sel)) return "lathe asks what to turn";
    await click("#lathe-start"); await p.waitForSelector("#lathe-done", { state: "attached" });
    if (/lathe-(add|exp)/.test(sel)) { await click("#lathe-done"); await p.waitForSelector("#lathe-add", { state: "attached" }); return "lathe: Done pressed"; }
    return "lathe on the machine";
  }
  if (/#insp-|\.colors/.test(sel)) { await addBox(); return "a box is selected"; }
  if (/#ar-(add-|o[es]\b|center)|#arch-elev/.test(sel)) {
    await p.evaluate(() => {
      window.__store.update((d) => {
        d.arch.walls = [[0, 0, 4000, 0], [4000, 0, 4000, 3000], [4000, 3000, 0, 3000], [0, 3000, 0, 0]].map(([ax, ay, bx, by], i) => ({ id: "pw" + i, lvl: d.arch.levels[0].id, a: [ax, ay], b: [bx, by], t: 200, h: 2700 }));
      }, "walls for the walk");
      window.__app.arch.select({ k: "wall", id: "pw0" });
    });
    return "a wall is selected";
  }
  if (/#ar-(landtools|grounds|plants|pcat|flood|wx)/.test(sel)) {
    await click("#ar-land");
    if (await p.evaluate(() => { const e = document.querySelector("#ar-land-make"); return !!e && e.getClientRects().length > 0; })) await click("#ar-land-make [data-m]:nth-child(1)");
    await p.waitForFunction(() => !!window.__store.doc.arch.land);
    if (/#ar-(grounds)/.test(sel)) await click('#ar-landtools [data-t="paint"]');
    if (/#ar-(plants|pcat)/.test(sel)) await click('#ar-landtools [data-t="plant"]');
    if (/#ar-(flood|wx)/.test(sel)) await click("#ar-sim");
    return "ground made";
  }
  if (/param-expr/.test(sel)) { await click("#browser .param-add"); return "one parameter added"; }
  return null;
}

// A step that points into the running Lathe (or at a parameter's box) needs the Lathe past its "what to turn" question (the walk keeps the Lathe open between Lathe steps), and past Done for the add/export buttons.
async function settleLathe(p, sel) {
  if (/param-expr/.test(sel)) { await p.evaluate(() => { if (!document.querySelector("#browser .param-expr")) document.querySelector("#browser .param-add").click(); }); return; } // step 3 of the Parameters lesson made the parameters; the walk does not do the work
  if (!/#lathe-/.test(sel) || /lathe-start/.test(sel)) return;
  const vis = (s) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, s);
  if (await vis("#lathe-start")) { await p.evaluate(() => document.querySelector("#lathe-start").click()); await p.waitForSelector("#lathe-done", { state: "attached" }); }
  if (/lathe-(add|exp)/.test(sel) && !(await vis("#lathe-add")) && (await vis("#lathe-done"))) { await p.evaluate(() => document.querySelector("#lathe-done").click()); await p.waitForSelector("#lathe-add", { state: "attached" }); }
}

// What Show me points at, read in the page: where it is, what is on top of its centre, whether the outline moved it, the pop-up, and
// (phone) whether the small lesson panel sits on the view cube. `null` when nothing is outlined.
const readSpot = ({ phone, sel, via }) => {
  const e = document.querySelector(".tut-spot");
  if (!e) return null;
  const rect = () => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const a = rect(), cx = a[0] + a[2] / 2, cy = a[1] + a[3] / 2;
  const onScreen = a[2] >= 1 && a[3] >= 1 && cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
  const out = { id: e.id || e.className.toString().split(" ")[0] || e.tagName.toLowerCase(), onScreen, cx: Math.round(cx), cy: Math.round(cy), isCube: e.classList.contains("viewcube"), disabled: !!e.disabled };
  out.isVia = !!via && e.matches(via); out.isSel = !!sel && e.matches(sel);
  if (onScreen) {
    const top = document.elementFromPoint(cx, cy);
    out.covered = !(top === e || e.contains(top));
    if (out.covered) {
      out.byPanel = !!top && !!top.closest("#tut-panel");
      const own = top ? (top.id ? "#" + top.id : top.tagName.toLowerCase() + (typeof top.className === "string" && top.className ? "." + top.className.split(" ")[0] : "")) : "nothing";
      const holder = top && top.closest("[id]");
      out.by = holder && holder !== top ? own + " inside #" + holder.id : own;
    }
  }
  e.classList.remove("tut-spot");
  const b = rect();
  e.classList.add("tut-spot");
  out.moved = a.some((v, k) => Math.abs(v - b[k]) > 1);
  const bub = document.getElementById("tut-bubble");
  if (!bub) out.bubble = "none";
  else { const r = bub.getBoundingClientRect(); out.bubble = r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 ? "ok" : `outside the screen (${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)})`; }
  const panel = document.getElementById("tut-panel"), cube = document.querySelector(".viewcube");
  out.miniOverCube = false;
  if (phone && panel && panel.classList.contains("mini") && cube && cube.getClientRects().length) {
    const p = panel.getBoundingClientRect(), c = cube.getBoundingClientRect(), left = c.left - 22;
    out.miniOverCube = p.right > left && p.left < c.right && p.bottom > c.top && p.top < c.bottom;
  }
  return out;
};

const SIZES = [
  { w: 375, h: 812, opts: () => ({ ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, screen: { width: 375, height: 812 } }) },
  { w: 768, h: 1024, opts: () => ({ hasTouch: true, isMobile: true, deviceScaleFactor: 1, viewport: { width: 768, height: 1024 }, screen: { width: 768, height: 1024 } }) },
];

for (const { w: W2, h: H2, opts } of SIZES) {
  test(`${W2} x ${H2} touch: every lesson starts and Show me points at something a finger can reach`, async ({ browser, browserName }, info) => {
    test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
    test.skip(buildOf(info) !== "site", "the single file runs the same tutorial code, and the first test in this file already covers it there; this walk takes about 4 minutes per size");
    test.setTimeout(600_000);
    const ctx = await browser.newContext({ ...opts(), serviceWorkers: "block", reducedMotion: "reduce" });
    ctx.setDefaultTimeout(8_000);
    const p = await ctx.newPage();
    const errors = watchErrors(p);
    p.on("dialog", (d) => d.accept()); // the Lathe asks "Start over?" before it throws work away
    await p.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
    const phone = W2 < 700, size = `${W2}x${H2}`;
    const problems = [];
    const c = { lessons: 0, started: 0, finished: 0, steps: 0, nothing: 0, offscreen: 0, byPanel: 0, byOther: 0, cube: 0, narrowMissing: 0, bubble: 0, other: 0, narrowNoted: 0, known: 0, fine: 0 };
    const t0 = Date.now();
    try {
      await boot(p, info);
      expect(await p.evaluate(() => document.documentElement.classList.contains("touch-ui")), "the touch UI is on").toBe(true);
      const only = (process.env.PHONE_TUT_ONLY || "").split(",").filter(Boolean); // PHONE_TUT_ONLY=<id>,<id> walks just those lessons (to look at one quickly)
      const lessons = (await p.evaluate(() => window.__app.tutorials.list.map((t) => ({ id: t.id, mode: t.mode, item: t.item, minWidth: t.minWidth || 0, steps: t.steps.map((s) => ({ show: s.show, strict: !!s.strict })) })))).filter((t) => !only.length || only.includes(t.id));
      expect(lessons.length, "lessons listed").toBeGreaterThan(only.length ? 0 : 80);
      const known = new Set(KNOWN.filter((k) => k.startsWith(size + " ")).map((k) => k.slice(size.length + 1)));
      const knownSeen = new Set();

      for (const L of lessons) {
        c.lessons++;
        const tell = (n, show, what) => `${L.id} step ${n} (${show.sel || "tile:" + show.tile}): ${what} at ${size}`;
        // 1. the chooser, the way a person can reach it at this width
        await normalize(p);
        await p.evaluate(() => { window.__app.tutorials.close(); });
        try {
          if (await p.locator("#btn-tutorials").isVisible()) await p.locator("#btn-tutorials").tap();
          else { await p.locator("#btn-export").tap(); await p.locator("#btn-tutorials-menu").tap(); }
          await p.locator("#tut-tab-" + L.mode).tap();
          const card = p.locator("#tut-" + L.id);
          await card.waitFor();
          // 2. the note for a lesson that needs a wider screen
          const noted = (await card.locator(".tut-narrow").count()) > 0, wants = L.minWidth > W2;
          if (noted !== wants) { problems.push(`${L.id}: ${wants ? "no .tut-narrow note on its card although it needs " + L.minWidth + " px" : ".tut-narrow note on its card although the lesson works at this width"} at ${size}`); if (wants) c.narrowMissing++; }
          await card.tap();
          // 3. step 1 is showing in the right mode
          await p.locator("#tut-panel").waitFor();
          await p.locator("#tut-panel .tut-stepno").waitFor();
        } catch (e) { problems.push(`${L.id}: the lesson could not be started by taps at ${size} (${String(e.message).split("\n")[0]})`); await p.evaluate(() => { document.querySelectorAll(".modal-back").forEach((b) => b.remove()); }); continue; }
        const mode = await p.evaluate(() => window.__app.mode);
        if (mode !== L.mode) problems.push(`${L.id}: the lesson opened in ${mode} mode, not ${L.mode} at ${size}`);
        c.started++;

        const tapOnce = async (loc) => { try { await loc.tap({ timeout: 10000 }); } catch (e) { await p.waitForTimeout(700); await loc.tap({ timeout: 10000 }); } }; // the Lathe's first seconds can shift the page; one retry
        const openPanel = async () => { if (await p.locator("#tut-panel .tut-mini-line").count()) await tapOnce(p.locator("#tut-panel .tut-mini-line")); };
        const press = async (synthetic = false) => { // a finger on Show me; `synthetic` when a menu is open (a real tap would close the menu first)
          if (synthetic) await p.evaluate(() => { const m = document.querySelector("#tut-panel .tut-mini-line"); if (m) m.click(); });
          else await openPanel();
          await p.evaluate(() => { window.__showDone = false; document.getElementById("tut-show").addEventListener("click", () => { window.__showDone = true; }, { once: true }); });
          if (synthetic) await p.evaluate(() => document.getElementById("tut-show").click()); else await tapOnce(p.locator("#tut-show"));
          await p.waitForFunction(() => window.__showDone, null, { timeout: 3000 });
        };
        // would a finger tap land on the outlined target? On failure the pointer is shown again and the check repeated once (the outline lasts 6 s, and a loaded machine can run past that while the Lathe draws)
        const tapLands = async (synthetic) => {
          for (let k = 0; k < 2; k++) {
            try { await p.locator(".tut-spot").tap({ trial: true, timeout: 3000 }); return null; }
            catch (e) { if (k === 1) return String(e.message).split("\n").slice(1, 5).join(" ").replace(/\s+/g, " ").slice(0, 220); await press(synthetic); }
          }
        };
        let ok = true;
        for (let i = 0; i < L.steps.length && ok; i++) {
          const s = L.steps[i], show = s.show, n = i + 1, key = `${size} ${L.id} ${n}`;
          const issues = [];
          const add = (kind, what) => { issues.push(tell(n, show, what)); c[kind]++; };
          try {
            const read = () => p.evaluate(() => ({ mini: !!document.querySelector("#tut-panel .tut-mini-line"), head: document.querySelector("#tut-panel .tut-stepno")?.firstChild?.textContent }));
            let now = await read();
            if (now.mini) { await openPanel(); now = await read(); }
            const head = now.head;
            if (head !== `Step ${n} of ${L.steps.length}`) { problems.push(`${L.id}: the panel shows "${head}" where step ${n} of ${L.steps.length} should be, at ${size}`); ok = false; break; }
            c.steps++;
            if (show.name) {
              await p.locator("#tut-last").fill("Lopez"); await p.locator("#tut-first").fill("Maria"); await p.locator("#tut-item").fill(L.item);
              await p.locator("#tut-name-apply").tap();
            }
            // Show me
            const args = { phone, sel: show.sel || null, via: show.via || null };
            await settleLathe(p, show.sel || "");
            await press();
            let m = await p.evaluate(readSpot, args);
            if (!m) { // the target only exists after earlier work: do that work, then press again for up to 6 s
              const did = await prepareFor(p, show.sel || "", L.mode);
              if (did) for (let k = 0; k < 12 && !m; k++) { await press(); m = await p.evaluate(readSpot, args); if (!m) await p.waitForTimeout(500); }
            }
            if (m && m.bubble === "none") { await p.waitForTimeout(450); await press(); m = await p.evaluate(readSpot, args); } // the automatic pointer's own timer (120-350 ms after a step opens) can land just after a very quick tap and take the pop-up off; a person is slower than that
            const judge = (m, what) => {
              if (!m.onScreen) { add("offscreen", `${what}the target's centre is off screen (${m.cx}, ${m.cy}) or has no size`); return; }
              if (m.covered) add(m.byPanel ? "byPanel" : "byOther", `${what}the target is under ${m.by}`);
              if (m.moved) add(m.isCube ? "cube" : "other", `${what}the outline moved the ${m.isCube ? "view cube" : "target"}`);
              if (m.bubble !== "ok") add("bubble", `${what}pop-up ${m.bubble}`);
              if (m.miniOverCube) add("other", `${what}the small lesson panel covers the view cube`);
            };
            if (!m) {
              const toast = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
              if (L.minWidth > W2 && /This button is hidden on a screen this narrow/.test(toast)) c.narrowNoted++;
              else add("nothing", "Show me found nothing");
            } else {
              judge(m, "");
              if (!issues.length && !m.disabled) { // would a tap land there? (a button that is disabled until a shape is selected is still where the step points)
                const why = await tapLands(false);
                if (why) add("other", "a tap would not land on the target (" + why + ")");
              }
              if (m.isVia && !m.isSel && show.via) { // the menu or panel is closed: Show me points at its button; open it, and Show me must now point at the item
                await p.locator(show.via).first().tap({ timeout: 5000 });
                await press(true);
                const m2 = await p.evaluate(readSpot, args);
                if (!m2) add("nothing", `with ${show.via} open, Show me found nothing`);
                else if (!m2.isSel) add("other", `with ${show.via} open, Show me points at #${m2.id}, not at the item`);
                else {
                  judge(m2, `with ${show.via} open: `);
                  if (!issues.length) { const why = await tapLands(true); if (why) add("other", `with ${show.via} open: a tap would not land on the item (${why})`); }
                }
              }
            }
          } catch (e) { const where = await p.evaluate(() => { const q = document.getElementById("tut-panel"), r = q && q.getBoundingClientRect(), b = document.getElementById("tut-show"), t = b && b.getBoundingClientRect(), h = t && document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return r ? `panel [${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)}] mini ${q.classList.contains("mini")} showme ${t ? [t.left, t.top, t.width, t.height].map(Math.round).join(",") : "gone"} on top ${h ? h.tagName + "#" + h.id + "." + String(h.className).slice(0, 30) : "none"}` : "no panel"; }).catch(() => "?");
            issues.push(tell(n, show, "the walk could not do this step (" + where + "): " + String(e.message).split("\n").slice(0, 6).join(" ").replace(/\s+/g, " ").slice(0, 800))); c.other++; }
          if (known.has(`${L.id} ${n}`)) {
            knownSeen.add(`${L.id} ${n}`);
            if (!issues.length) problems.push(`${key}: this step now passes, delete it from KNOWN`);
            else c.known++;
          } else problems.push(...issues);
          if (!issues.length) c.fine++;

          // back to normal, then on: Save is tapped, "I did this" on a strict step, Next
          try {
            await normalize(p, { keepLathe: /#lathe-/.test(L.steps[i + 1]?.show.sel || "") });
            await openPanel();
            if (show.sel === "#btn-save") { try { await p.locator("#btn-save").tap({ timeout: 3000 }); } catch (e) { await p.evaluate(() => document.getElementById("btn-save").click()); } }
            if (s.strict) await p.evaluate(() => { const b = document.getElementById("tut-check"); if (b && !b.checked) b.click(); });
            await tapOnce(p.locator("#tut-next"));
          } catch (e) { problems.push(`${L.id}: Next could not be tapped at step ${n} at ${size} (${String(e.message).split("\n").slice(0, 6).join(" ").replace(/\s+/g, " ").slice(0, 800)})`); ok = false; }
        }
        if (!ok) continue;
        try {
          await expect(p.locator(".tut-done h2"), `${L.id}: Finish did not open the finished pop-up`).toHaveText(/Nice work/, { timeout: 5000 });
          c.finished++;
          await p.locator(".tut-done .btn.primary").tap();
        } catch (e) { problems.push(`${L.id}: Finish did not open "Nice work" at ${size}`); }
      }
      for (const k of only.length ? [] : known) if (!knownSeen.has(k)) problems.push(`${size} ${k}: this KNOWN entry names a step that was not walked, delete it from KNOWN`);
      console.log(`[${info.project.name}] ${size}: lessons started ${c.started}/${c.lessons}, finished ${c.finished}; steps walked ${c.steps}; Show me found nothing ${c.nothing}; centre off screen ${c.offscreen}; covered by the lesson panel ${c.byPanel}; covered by something else ${c.byOther}; view cube moved ${c.cube}; missing .tut-narrow ${c.narrowMissing}; pop-up off screen ${c.bubble}; other (tap would miss, small panel on the view cube, walk) ${c.other}; fine ${c.fine}; KNOWN steps still failing ${c.known}; ${problems.length} problems; ${Math.round((Date.now() - t0) / 1000)} s`);
      if (problems.length) console.log(`[${info.project.name}] ${size} problems:\n` + problems.join("\n"));
      expect(problems, `Show me problems at ${size}`).toEqual([]);
      expect(c.started, "every lesson started").toBe(c.lessons);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}

// PR 1b, the focused one: on a 375 x 812 phone the open lesson panel covers the colour swatches. Show me makes the panel small and moves it to the
// top of the 3D view (not the automatic pointer: its pop-up stays off the open panel), and tapping the small panel's line opens it again where it was.
test("375 x 812 touch: Show me makes the lesson panel small when it covers the target, and the automatic pointer stays off the panel", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "touch emulation (isMobile) is Chromium only");
  test.skip(buildOf(info) !== "site", "the single file runs the same tutorial code, and the first test in this file already covers it there");
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, screen: { width: 375, height: 812 }, serviceWorkers: "block", reducedMotion: "reduce" });
  ctx.setDefaultTimeout(10_000);
  const p = await ctx.newPage();
  const errors = watchErrors(p);
  await p.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  try {
    await boot(p, info);
    await p.locator("#btn-export").tap();
    await p.locator("#btn-tutorials-menu").tap();
    await p.locator("#tut-tab-beginner").tap();
    await p.locator("#tut-b-keychain").tap();
    await expect(p.locator("#tut-panel .tut-stepno")).toHaveText(/Step 1 of/);
    // a box is selected (its colours are in the right panel), then step 7 ("Pick a color") is opened from the checklist
    await p.evaluate(() => {
      window.__store.update((d) => d.bodies.push({ id: "pbox", name: "Box", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] } }), "a box for the test");
      window.__app.select(["pbox"]);
    });
    await waitIdle(p);
    await p.locator("#tut-panel details summary").tap();
    await p.locator("#tut-list li:nth-child(7) button").tap();
    await expect(p.locator("#tut-panel .tut-stepno")).toHaveText(/Step 7 of/);
    await expect(p.locator("#tut-panel h3")).toHaveText("Pick a color");
    // the automatic pointer ran about 120 ms after the step opened: its pop-up must not sit on the open panel's text
    await p.waitForTimeout(500);
    const overlap = await p.evaluate(() => {
      const b = document.getElementById("tut-bubble"), pn = document.getElementById("tut-panel");
      if (!b) return null;
      const a = b.getBoundingClientRect(), r = pn.getBoundingClientRect();
      return a.bottom > r.top && a.top < r.bottom && a.right > r.left && a.left < r.right;
    });
    expect(overlap, "the automatic pointer's pop-up sits on the open lesson panel").not.toBe(true);
    const before = await p.evaluate(() => document.getElementById("tut-panel").style.top);
    await p.locator("#tut-show").tap();
    const after = await p.evaluate(() => {
      const pn = document.getElementById("tut-panel"), vp = document.getElementById("viewport").getBoundingClientRect(), e = document.querySelector(".tut-spot");
      const r = e && e.getBoundingClientRect(), hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { mini: pn.classList.contains("mini"), top: pn.getBoundingClientRect().top, vpTop: vp.top, spot: !!e && e.matches(".colors"), covered: !!e && !(hit === e || e.contains(hit)) };
    });
    expect(after.mini, "the panel is small after Show me").toBe(true);
    expect(Math.abs(after.top - after.vpTop), "the small panel's top is within 8 px of the 3D view's top").toBeLessThanOrEqual(8);
    expect(after.spot, "the colour swatches are outlined").toBe(true);
    expect(after.covered, "something covers the colour swatches").toBe(false);
    await p.locator("#tut-panel .tut-mini-line").tap();
    expect(await p.evaluate(() => document.getElementById("tut-panel").style.top), "the opened panel is back where it was").toBe(before);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
