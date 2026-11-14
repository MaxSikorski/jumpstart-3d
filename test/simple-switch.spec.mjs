// Simple | Original switch: persistence, menu, first-run card, responsive layout and studio boundaries.
import { test, expect } from "@playwright/test";
import { boot, reload, waitIdle, watchErrors } from "./helpers.mjs";

let errors;
test.beforeEach(async ({ page }, info) => {
  errors = watchErrors(page);
  if (info.project.name !== "mobile") await page.setViewportSize({ width: 1500, height: 880 }); // Give desktop tests room for labels.
});
test.afterEach(async () => { expect(errors, "console or page errors").toEqual([]); });

const mobile = (info) => info.project.name === "mobile";
const face = (page) => page.locator("html");
const storedFace = (page) => page.evaluate(() => localStorage.getItem("jumpstart.face"));
const toSimple = async (page) => page.click("#face-simple");
const ready = (page) => page.waitForFunction(() => window.__app?.projects?.started === true, null, { timeout: 90_000 });

test("a new visitor starts in Simple with the one-time card", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#simple-rail")).toBeVisible();
  await expect(page.locator("#try-simple")).toBeVisible();
  await expect(page.locator("#try-simple")).toContainText("Prefer the full toolbar?");
  expect(await page.evaluate(() => window.__app.trySimpleShown)).toBe(true);
  expect(await storedFace(page)).toBeNull();
  await page.click("#face-card-original");
  await expect(face(page)).toHaveAttribute("data-face", "original");
  expect(await storedFace(page)).toBe("original");
  await reload(page);
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "original");
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("switching keeps the design and persists the choice", async ({ page }, info) => {
  await boot(page, info);
  await page.locator('#shapes .tile[data-kind="box"]').click();
  await waitIdle(page);
  const count = await page.evaluate(() => window.__store.doc.bodies.length);
  expect(count).toBeGreaterThan(0);
  await toSimple(page, info);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#face-simple")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#face-original")).toHaveAttribute("aria-pressed", "false");
  expect(await storedFace(page)).toBe("simple");
  await expect(page.locator("#btn-tutorials .lbl")).toHaveText("Learn");
  await expect(page.locator("#btn-export .lbl")).toHaveText("Print / Export");
  await expect(page.locator("#btn-autosave")).toBeHidden();
  expect(await page.evaluate(() => window.__store.doc.bodies.length)).toBe(count);
  await reload(page);
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await page.click("#face-original");
  await expect(face(page)).toHaveAttribute("data-face", "original");
  if (!mobile(info)) await expect(page.locator("#btn-projects")).toBeVisible();
  await expect(page.locator("#btn-tutorials .lbl")).toHaveText("Tutorials");
  await expect(page.locator("#btn-export .lbl")).toHaveText("Open/Export");
});

test("About shows community information and checks for updates", async ({ page }, info) => {
  await boot(page, info); await toSimple(page);
  await page.route("https://api.github.com/repos/MaxSikorski/jumpstart-3d/releases/latest", route => route.fulfill({ json: { tag_name: "v9-community.999" } }));
  await page.click("#face-more");
  const dialog = page.getByRole("dialog", { name: "JumpStart 3D Community Build" });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText(/Version .+ · build \d+/); await expect(dialog).not.toContainText("Siwek");
  await dialog.locator("#sa-check").click(); await expect(dialog.locator("#ab-upmsg")).toContainText("Build 999 is available");
  for (const [label, href] of [["One-time", "https://buy.stripe.com/28E4gydyeetR0S9aNb0gw08"], ["Monthly", "https://buy.stripe.com/7sYcN479Q71p44l1cB0gw09"], ["GitHub Sponsors", "https://github.com/sponsors/MaxSikorski"]]) {
    const link = dialog.getByRole("link", { name: label }); await expect(link).toHaveAttribute("href", href); await expect(link).toHaveAttribute("rel", /noopener/);
  }
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.locator("#face-more")).toBeFocused();
});

test("Customize and the More App group are available in Simple", async ({ page }, info) => {
  await boot(page, info); await expect(page.locator("#btn-theme")).toHaveAttribute("title", "Customize: look, layout, printer, performance, AI");
  if (!mobile(info)) await expect(page.locator("#btn-theme .lbl")).toBeHidden();
  await toSimple(page); await expect(page.locator("#btn-theme")).toBeVisible();
  if (!mobile(info)) await expect(page.locator("#btn-theme .lbl")).toBeVisible();
  await page.click("#btn-theme"); await expect(page.locator(".simple-layout-note")).toBeVisible(); await expect(page.locator('[data-layout="simple"]')).toBeHidden(); await page.click("#btn-theme");
  await page.click("#sr-more");
  for (const id of ["btn-projects", "btn-chat", "mode-chisel", "mode-arch", "btn-about"]) await expect(page.locator('#simple-more [data-for="' + id + '"]')).toBeVisible();
  for (const id of ["btn-chat", "mode-chisel", "mode-arch", "btn-about"]) {
    await page.evaluate(id => { window.__proxyHit = false; document.getElementById(id).addEventListener("click", e => { window.__proxyHit = true; e.stopImmediatePropagation(); }, { capture: true, once: true }); }, id);
    await page.locator('#simple-more [data-for="' + id + '"]').click(); expect(await page.evaluate(() => window.__proxyHit)).toBe(true); await page.click("#sr-more");
  }
  await page.click('#simple-more [data-for="btn-projects"]'); await expect(page.getByRole("dialog", { name: "Your designs" })).toBeVisible();
});

test("query parameter chooses and stores a face, then is removed", async ({ page }, info) => {
  const base = info.project.use.baseURL;
  const query = (value) => base + (base.includes("?") ? "&" : "?") + `face=${value}&keep=1#kept`;
  await page.goto(query("simple"));
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  expect(await storedFace(page)).toBe("simple");
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({ search: "?keep=1", hash: "#kept" });
  await page.goto(query("original"));
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "original");
  expect(await storedFace(page)).toBe("original");
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({ search: "?keep=1", hash: "#kept" });
});

test("Keep Simple stores the choice and dismisses the card", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await page.click(mobile(info) ? "#try-simple-close" : "#face-card-keep"); // a phone shows the card as one line, where the x keeps Simple
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  expect(await storedFace(page)).toBe("simple");
  await reload(page);
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("closing the card stores Simple", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await page.click("#try-simple-close");
  expect(await storedFace(page)).toBe("simple");
  await reload(page);
  await ready(page);
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("existing preferences still show the first-run card", async ({ page }, info) => {
  await page.addInitScript(() => { try { localStorage.setItem("workplane.ui.v1", "{}"); } catch (e) {} });
  await boot(page, info, { face: false });
  await expect(page.locator("#try-simple")).toBeVisible();
  await expect(face(page)).toHaveAttribute("data-face", "simple");
});

test("a fresh visitor can choose Original by query", async ({ page }, info) => {
  const base = info.project.use.baseURL;
  await page.goto(base + (base.includes("?") ? "&" : "?") + "face=original");
  await ready(page);
  await expect(face(page)).toHaveAttribute("data-face", "original");
  expect(await storedFace(page)).toBe("original");
  await expect(page.locator("#try-simple")).toHaveCount(0);
});

test("the existing layout is called Big buttons", async ({ page }, info) => {
  await boot(page, info);
  // The original theme button is hidden on narrow phones, but its own handler is still usable.
  if (mobile(info)) await page.locator("#btn-theme").evaluate((button) => button.click());
  else await page.click("#btn-theme");
  await expect(page.locator('#menu-theme button[data-layout="simple"]')).toHaveText(/^Big buttons/);
  await expect(page.locator("#menu-theme button", { hasText: "Simplified" })).toHaveCount(0);
});

test("neither face scrolls sideways", async ({ page }, info) => {
  await boot(page, info);
  const widths = mobile(info) ? [375, 390] : [1400, 1366, 1024, 820];
  for (const name of ["original", "simple"]) {
    await page.evaluate((n) => window.__app.setFace(n, true), name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at the project viewport`).toBe(true);
  }
  for (const width of widths) {
    await page.setViewportSize({ width, height: mobile(info) ? 667 : 880 });
    for (const name of ["original", "simple"]) {
      await page.evaluate((n) => window.__app.setFace(n, true), name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}px`).toBe(true);
    }
  }
});

test("Simple top bar steps aside in Architect", async ({ page }, info) => {
  await boot(page, info);
  await toSimple(page, info);
  await page.evaluate(() => window.__app.switchMode("arch"));
  await expect(page.locator("#mode-arch")).toBeVisible();
  await expect(page.locator("#face-more")).toBeHidden();
  await page.evaluate(() => window.__app.switchMode("beginner"));
  await expect(page.locator("#face-more")).toBeVisible();
});

test("the switch never puts the Original top bar on a second row; Settings › Look switches too", async ({ page }, info) => {
  test.skip(mobile(info), "phones give the switch its own row by design");
  await boot(page, info);
  const oneRow = () => page.evaluate(() => document.querySelector(".topbar").offsetHeight < 50);
  for (const width of [2200, 1920, 1600, 1440, 1366, 1280, 1024]) {
    await page.setViewportSize({ width, height: 880 });
    await expect.poll(oneRow, { message: `Original at ${width}px is one row` }).toBe(true);
    await expect(page.locator("#face-simple"), `the switch shows at ${width}px`).toBeVisible();
    // below 1120 px Original shows only the Simple half (the way back); Crash recovery, Keyboard shortcuts and Full screen move into Customize › Workspace
    if (width >= 1120) await expect(page.locator("#face-original")).toBeVisible(); else await expect(page.locator("#face-original")).toBeHidden();
    if (width < 1440) { await expect(page.locator(".topbar #btn-autosave")).toBeHidden(); await page.click("#btn-theme"); await expect(page.locator("#cz-autosave")).toBeVisible(); await page.click("#btn-theme"); await expect(page.locator("#menu-theme")).toBeHidden(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const width of [640, 820]) { // narrow tablets: the pill gets its own short row; the rest of the bar is one row
    await page.setViewportSize({ width, height: 880 });
    await expect(page.locator("#face-simple")).toBeVisible(); await expect(page.locator("#face-original")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector(".topbar").offsetHeight)).toBeLessThan(80);
  }
  await page.setViewportSize({ width: 1024, height: 880 });
  await page.click("#btn-theme");
  await page.click("#face-menu-simple");
  await expect(face(page)).toHaveAttribute("data-face", "simple");
  await expect(page.locator("#face-original")).toBeVisible();
  await expect.poll(oneRow, { message: "Simple at 1024px is one row" }).toBe(true);
  await page.click("#btn-theme");
  await expect(page.locator("#face-menu-simple")).toHaveAttribute("aria-checked", "true");
  await page.click("#face-menu-original");
  await expect(face(page)).toHaveAttribute("data-face", "original");
});

test("phone switch has its own row in Original", async ({ page }, info) => {
  test.skip(!mobile(info)); await boot(page, info);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 667 });
    await expect(page.locator("#face-simple")).toBeVisible(); await expect(page.locator("#face-original")).toBeVisible();
    expect(await page.evaluate(() => { const bar = document.querySelector(".topbar"), pill = document.querySelector(".faceswitch"); return pill.getBoundingClientRect().top > document.querySelector("#btn-save").getBoundingClientRect().top && bar.scrollWidth <= innerWidth; })).toBe(true);
  }
});

test("closing the face card leaves focus on the switch or Settings, not the page", async ({ page }, info) => {
  await boot(page, info, { face: false });
  await page.locator(mobile(info) ? "#try-simple-close" : "#face-card-keep").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#try-simple")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement.id)).toMatch(/^(face-simple|face-original|btn-theme|btn-export)$/);
});

// Lessons point at top-bar buttons; in Simple some sit under More. Such a lesson runs in Original (not stored) and Simple comes back after it.
test("in Simple every lesson can point at its top-bar buttons, and Simple comes back after it", async ({ page }, info) => {
  await boot(page, info);
  await page.evaluate(() => window.__app.setFace("simple", true));
  const lessons = await page.evaluate(() => window.__app.tutorials.list.filter((t) => t.mode !== "plan" && !(t.minWidth > innerWidth)).map((t) => t.id));
  const switched = [];
  for (const id of lessons) {
    const r = await page.evaluate((id) => {
      const app = window.__app, t = app.tutorials.list.find((x) => x.id === id);
      app.tutorials.start(id);
      const face = app.face, stored = localStorage.getItem("jumpstart.face"), missing = [];
      for (const st of t.steps) {
        const parts = ((st.show && st.show.sel) || "").split(",").map((q) => q.trim()).filter(Boolean);
        const inBar = parts.map((q) => document.querySelector(q)).filter((e) => e && e.closest(".topbar") && !e.closest(".menu"));
        const shown = () => inBar.some((e) => e.getClientRects().length);
        if (!inBar.length || inBar.length !== parts.length || shown()) continue;
        app.setFace("original", true, true); // hidden in Original too (the name box on a phone): not Simple's doing
        const inOriginal = shown();
        app.setFace(face, true, true);
        if (inOriginal) missing.push(st.title + ": " + parts.join(", "));
      }
      app.tutorials.close();
      return { face, stored, missing, after: app.face };
    }, id);
    expect(r.missing, `${id}: top-bar targets hidden in its look`).toEqual([]);
    expect(r.stored, `${id}: the lesson does not change the stored look`).toBe("simple");
    expect(r.after, `${id}: Simple after the lesson`).toBe("simple");
    if (r.face === "original") switched.push(id);
    await page.evaluate(() => window.__app.setMode("beginner"));
  }
  if (!mobile(info)) expect(switched).toEqual(expect.arrayContaining(["c3-clay-pebble", "c4-top-bar"]));
  console.log(`[${info.project.name}] ${switched.length} of ${lessons.length} lessons ran in Original: ${switched.join(", ")}`);
  if (!mobile(info)) expect(switched.length, "most lessons stay in Simple").toBeLessThan(lessons.length / 2);
});
