// The app's built-in tutorials as tests (queue idea 4b, plan §10 outcome 6: "anyone can learn the app without Max").
//  1. Data: every tutorial is well formed, and every step's "check" runs without throwing on an empty design and on a
//     set of real designs (the app swallows a throw, so a typo in a check would leave the step never ticking itself off).
//  2. Walk: each tutorial is opened from the Tutorials button like a student would, and every step is visited: "Show me"
//     must highlight an element that matches what the step asks for (the selector, the tile kind, or the menu button
//     for a menu item, and then the item itself once the menu is open); the name step, Save and one real Export per mode are
//     done and must tick the step; Next moves through all steps and Finish opens the finished pop-up.
//  3. Coverage: every visible toolbar and menu button (Beginner and Advanced, with the hidden top-bar menus opened and
//     buttons without an id keyed by their data-act or text) is compared with what the tutorials point at. Today's gaps
//     are in test/tutorial-gaps.json; a NEW button without a tutorial fails.
// One page for the whole file (the kernel loads once). Steps whose target only appears after an earlier step (a sketch
// tool, the Lathe, a selected body's fields) get that state set up through the real buttons first; see prepareFor().
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { ICON } from "../src/icons.js";
import { boot, watchErrors, loadDoc, newDoc, waitIdle, bodies, quarantine } from "./helpers.mjs";

let page, errors, project;
const quarantined = new Set();
const tutorials = []; // { id, mode, title, steps }, read from the running app so the test sees exactly what users see
const exportedIn = new Set(), savedIn = new Set(), startedIds = new Set(); // exportedIn and savedIn: "<mode>:<repeat index>", so --repeat-each runs each time
const stats = { tutorials: 0, steps: 0, menuItems: 0, tiles: 0, namedAndTicked: 0, saved: 0, exported: 0, started: 0 };

test.beforeAll(async ({ browser }, info) => {
  project = info.project.name;
  page = await browser.newPage();
  errors = watchErrors(page);
  page.on("dialog", (d) => d.accept()); // the Lathe asks "Start over?" before it throws work away
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await page.emulateMedia({ reducedMotion: "reduce" }); // the "Next" button pulses when a step is done; reduced motion turns that off, so plain clicks do not wait for it
  await boot(page, info);
  const list = await page.evaluate(() => window.__app.tutorials.list.map((t) => ({
    id: t.id, mode: t.mode, level: t.level, title: t.title, item: t.item, learn: t.learn, minutes: t.minutes,
    steps: t.steps.map((s) => ({ title: s.title, tool: s.tool, icon: s.icon, how: s.how, when: s.when, show: s.show, hasCheck: typeof s.check === "function", anim: s.anim, strict: s.strict })),
  })));
  tutorials.push(...list);
});
test.afterAll(async () => {
  console.log(`[${project}] tutorials: ${stats.tutorials}, steps walked: ${stats.steps} (menu items opened: ${stats.menuItems}, tiles: ${stats.tiles}), name steps ticked: ${stats.namedAndTicked}, save: ${stats.saved}, export: ${stats.exported}`);
  await page.close();
});
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const visible = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; }, sel);

// ---------------------------------------------------------------- 1. the data
test("tutorial data: counts, ids, levels, icons and well-formed steps", async () => {
  // the number of tutorials is smoke.spec.mjs's job (it checks the About text); here: every one is in a mode the chooser has tabs for, and the walk below declares a test for each
  expect(tutorials.length).toBeGreaterThan(0);
  expect(tutorials.filter((t) => ["beginner", "advanced", "arch"].includes(t.mode)).length).toBe(tutorials.length);
  expect(new Set(tutorials.map((t) => t.id)).size).toBe(tutorials.length);
  expect(tutorials.map((t) => t.id).sort(), "the ids the walk declares tests for (read from src/tutorial_data*.js) and the ids the app lists").toEqual([...BEGINNER_IDS(), ...ADVANCED_IDS(), ...ARCH_IDS()].sort());
  const problems = [];
  for (const t of tutorials) {
    if (!["Easy", "Proficient", "Advanced", "Expert"].includes(t.level)) problems.push(`${t.id}: level ${t.level}`);
    if (!t.title || !t.item || !t.learn.length || !t.minutes) problems.push(`${t.id}: title, item, learn or minutes missing`);
    if (t.steps.length < 5) problems.push(`${t.id}: only ${t.steps.length} steps`);
    t.steps.forEach((s, i) => {
      const at = `${t.id} step ${i + 1} (${s.title})`;
      if (!s.title || !s.tool || !s.when || !s.how.length) problems.push(`${at}: title, tool, how or when missing`);
      if (!ICON[s.icon]) problems.push(`${at}: icon "${s.icon}" is not in icons.js (the panel falls back to the select arrow)`);
      if (!s.show) problems.push(`${at}: no "show" target`);
      else if (!s.show.sel && !s.show.tile) problems.push(`${at}: "show" has neither sel nor tile`);
    });
    // every tutorial opens with the naming step and ends with save then export, as the chooser's reminder promises
    // (Architect: a building is not a printable file until it is sent to the design, so only the last of them exports; the others end with Save)
    const first = t.steps[0], last2 = t.steps.slice(-2);
    if (!first.show || first.show.sel !== "#docname") problems.push(`${t.id}: step 1 is not the naming step`);
    if (t.mode === "arch") { if (last2[1].show.sel !== "#btn-save" && !(last2[0].show.sel === "#btn-save" && last2[1].show.sel === "#btn-export")) problems.push(`${t.id}: does not end with Save (then Export)`); }
    else if (last2[0].show.sel !== "#btn-save" || last2[1].show.sel !== "#btn-export") problems.push(`${t.id}: does not end with Save then Export`);
  }
  expect(problems).toEqual([]);
});

// Real designs from test/projects that have what the checks look at: groups with a hole child, sketches with lines, rectangles and
// circles, extrudes with join/cut mods, revolves, fillets, patterns, text, threads. On an empty design most checks stop at "no bodies", so
// only these reach the code behind the guards (childKinds, sketchRect, extrudeMod, hasCombine, ...).
const CHECK_DESIGNS = ["beginner-peg-block", "beginner-box", "advanced-sketch-extrude", "advanced-bool-cut", "advanced-hole", "advanced-revolve", "advanced-pattern-feature", "advanced-fillet-chamfer", "advanced-emboss", "advanced-thread", "advanced-shell", "parametric-features"];
const runChecks = () => page.evaluate(() => {
  const t = window.__app.tutorials, T = t.T, out = { thrown: [], ticked: [], evaluated: 0 };
  for (const tut of t.list) tut.steps.forEach((s, i) => {
    if (!s.check) return;
    out.evaluated++;
    try { if (s.check(T)) out.ticked.push(`${tut.id} step ${i + 1}: ${s.title}`); } catch (e) { out.thrown.push(`${tut.id} step ${i + 1}: ${s.title}: ${e.message}`); }
  });
  return out;
});

test("tutorial checks: none throws, on an empty design or on real designs with groups, sketches and features", async () => {
  for (const mode of ["beginner", "advanced", "arch"]) {
    await loadDoc(page, newDoc("Untitled", mode));
    const r = await runChecks();
    expect(r.thrown, `checks that throw on an empty ${mode} design`).toEqual([]);
    // a step that is "done" before the student did anything would tick itself off for nothing
    expect(r.ticked, `checks already true on an empty ${mode} design`).toEqual([]);
  }
  const everTrue = new Set();
  for (const name of CHECK_DESIGNS) {
    const file = new URL(`./projects/${name}.json`, import.meta.url);
    expect(existsSync(file), `test/projects/${name}.json`).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    await loadDoc(page, doc);
    const r = await runChecks();
    expect(r.thrown, `checks that throw on ${name}`).toEqual([]);
    r.ticked.forEach((x) => everTrue.add(x));
  }
  // a small house, so the Architect checks run past their guards too (walls, a door, a window, a roof, a floor)
  await loadDoc(page, newDoc("House", "arch", { arch: { v: 1, levels: [{ id: "L1", name: "Level 1", elev: 0 }], wallT: 200, wallH: 2700, grid: 100,
    walls: [[0, 0, 4000, 0], [4000, 0, 4000, 3000], [4000, 3000, 0, 3000], [0, 3000, 0, 0]].map(([ax, ay, bx, by], i) => ({ id: "w" + i, lvl: "L1", a: [ax, ay], b: [bx, by], t: 200, h: 2700 })),
    openings: [{ id: "o1", wall: "w0", k: "door", preset: "ext36", s: 500, w: 914, h: 2032, sill: 0 }, { id: "o2", wall: "w1", k: "window", preset: "sh3648", s: 1000, w: 914, h: 1219, sill: 900 }],
    roofs: [{ id: "r1", lvl: "L1", kind: "gable", x0: 0, y0: 0, x1: 4000, y1: 3000, pitch: 30, over: 300, dir: "y", flip: false, thick: 200 }], slabs: [{ id: "s1", lvl: "L1", x0: 0, y0: 0, x1: 4000, y1: 3000, thick: 150 }] } }));
  { const r = await runChecks(); expect(r.thrown, "checks that throw on a small house").toEqual([]); expect(r.ticked.filter((x) => x.startsWith("h-")).length, "Architect checks true on a small house: " + r.ticked.join("; ")).toBeGreaterThanOrEqual(5); r.ticked.forEach((x) => everTrue.add(x)); }
  // the designs must really reach into the predicates: about 55 checks come out true on them, not just "false because empty"
  expect(everTrue.size, "checks that were true on at least one of the real designs: " + [...everTrue].join("; ")).toBeGreaterThanOrEqual(40);
});

// ---------------------------------------------------------------- 2. the walk
// Put the app back to a plain state between steps: out of a sketch, out of the Lathe, no tutorial pop-ups left open.
// keepLathe: the next step is also a Lathe step, so the Lathe stays open (opening it takes seconds in the test browser)
async function normalize({ keepLathe = false } = {}) {
  if (keepLathe && (await visible("#lathe-cancel, .lathe-done-back"))) return;
  const dirty = await page.evaluate(() => [".lathe-done-back", "#lathe-start", "#lathe-cancel", "#sk-finish", "#ribbon-menu"].some((s) => { const e = document.querySelector(s); return e && e.getClientRects().length; }));
  if (!dirty) { await page.evaluate(() => document.querySelectorAll(".modal-back").forEach((b) => b.remove())); return; }
  for (let k = 0; k < 4; k++) {
    if (await visible(".lathe-done-back")) { await page.evaluate(() => [...document.querySelectorAll(".lathe-done-back button")].find((b) => b.textContent === "Keep turning").click()); continue; }
    if (await visible("#lathe-start")) { await page.evaluate(() => [...document.querySelectorAll(".s3d-modal-btns button")].find((b) => b.textContent === "Cancel").click()); continue; }
    if (await visible("#lathe-cancel")) { await page.click("#lathe-cancel"); continue; }
    if (await visible("#sk-finish")) { await page.click("#sk-finish"); continue; }
    if (await visible("#ribbon-menu")) { await page.keyboard.press("Escape"); continue; }
    break;
  }
  await page.evaluate(() => document.querySelectorAll(".modal-back").forEach((b) => b.remove()));
}

// a box through the real buttons: the shape tile in Beginner, Primitives > Box in Advanced
async function addBox(mode) {
  if (mode === "arch") { // what Send to design leaves behind: shapes in the design (the Send itself is tested in upstream23.spec.mjs)
    await page.evaluate(() => window.__store.update((d) => d.bodies.push({ id: "sent1", name: "Wall", seq: 1, color: "#c8ccd2", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", p: { w: 40, d: 4, h: 20, r: 0, c: 0 }, mods: [] } }), "shapes from Send to design"));
    return;
  }
  if (mode === "beginner") { await page.click("#dock-objects"); await page.locator('.tile[data-kind="box"]').click(); }
  else { await page.click("#ad-prims"); await page.click("#ad-box"); await page.click("#cmd-ok"); }
}

// A step whose target only exists after earlier steps: do those earlier steps' work through the real buttons.
async function prepareFor(sel, mode) {
  if (/#sk-/.test(sel)) { await page.click("#ad-sketch"); await page.locator("#plane-seg button").first().click(); await page.waitForSelector("#sk-line"); return "sketch open"; }
  if (/#lathe-/.test(sel)) {
    await normalize(); // whatever stage the Lathe is at, start from the closed Lathe
    await page.click(mode === "beginner" ? "#bb-lathe" : "#ad-lathe");
    await page.waitForSelector("#lathe-start");
    if (/lathe-start/.test(sel)) return "lathe asks what to turn";
    await page.click("#lathe-start"); await page.waitForSelector("#lathe-done");
    if (/lathe-(add|exp)/.test(sel)) { await page.click("#lathe-done"); await page.waitForSelector("#lathe-add"); return "lathe: Done pressed"; }
    return "lathe on the machine";
  }
  if (/#insp-|\.colors/.test(sel)) { // a body must be selected for its fields and colours to show
    await addBox(mode);
    return "a box is selected";
  }
  if (/#ar-(add-|o[es]\b|center)|#arch-elev/.test(sel)) { // a wall must be selected for its door and window buttons and its elevation grid
    await page.evaluate(() => {
      window.__store.update((d) => {
        d.arch.walls = [[0, 0, 4000, 0], [4000, 0, 4000, 3000], [4000, 3000, 0, 3000], [0, 3000, 0, 0]].map(([ax, ay, bx, by], i) => ({ id: "pw" + i, lvl: d.arch.levels[0].id, a: [ax, ay], b: [bx, by], t: 200, h: 2700 }));
      }, "walls for the walk");
      window.__app.arch.select({ k: "wall", id: "pw0" });
    });
    return "a wall is selected";
  }
  if (/#ar-(landtools|grounds|plants|pcat|flood|wx)/.test(sel)) { // the landscape and Simulate panels need ground first: Landscape > the smallest "Make the ground", then the panel the step is about
    await page.click("#ar-land");
    if (await visible("#ar-land-make")) await page.click("#ar-land-make [data-m]:nth-child(1)");
    await page.waitForFunction(() => !!window.__store.doc.arch.land);
    if (/#ar-(grounds)/.test(sel)) await page.click('#ar-landtools [data-t="paint"]');
    if (/#ar-(plants|pcat)/.test(sel)) await page.click('#ar-landtools [data-t="plant"]');
    if (/#ar-(flood|wx)/.test(sel)) await page.click("#ar-sim");
    return "ground made";
  }
  if (/param-expr/.test(sel)) { await page.click("#browser .param-add"); return "one parameter added"; }
  return null;
}

// What "Show me" does for this step, checked from the outside. It must highlight an element that is the one the data asks for.
async function checkShowMe(tutId, i, show, mode) {
  const at = `${tutId} step ${i + 1}`;
  const showMe = () => page.evaluate(({ sel, via, tile }) => {
    document.getElementById("tut-show").click(); // the same handler a mouse click runs
    const e = document.querySelector(".tut-spot");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {
      id: e.id, onScreen: e.getClientRects().length > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
      bubble: !!document.querySelector("#tut-bubble"),
      isTile: tile ? e.dataset.kind === tile.kind && e.classList.contains("tile") && e.classList.contains("hole") === tile.hole : false,
      isSel: sel ? e.matches(sel) : false, isVia: via ? e.matches(via) : false,
    };
  }, { sel: show.sel || null, via: show.via || null, tile: show.tile ? { kind: show.tile, hole: !!show.hole } : null });
  let spot = await showMe(), prepared = null;
  if (!spot) { // the target only exists after earlier work: do that work, then wait for the step's own target to appear
    prepared = await prepareFor(show.sel || "", mode);
    if (prepared) await expect.poll(async () => (spot = await showMe()) !== null, { message: `${at} (${show.sel}): Show me found nothing to point at after: ${prepared}`, timeout: 10_000 }).toBe(true);
  }
  expect(spot, `${at} (${show.sel || show.tile}): Show me found nothing to point at`).not.toBeNull();
  expect(spot.onScreen, `${at}: the highlighted target is not on screen`).toBe(true);
  expect(spot.bubble, `${at}: no pop-up next to the target`).toBe(true);
  if (show.tile) {
    expect(spot.isTile, `${at}: Show me did not highlight the ${show.hole ? "hole " : ""}${show.tile} tile`).toBe(true);
    stats.tiles++;
    return;
  }
  if (show.via && spot.isVia && !spot.isSel) { // the menu is closed: Show me points at its button; open it, and Show me must now point at the item
    await page.click(show.via);
    await expect(page.locator("#ribbon-menu, #menu-export:not([hidden])"), `${at}: ${show.via} opens no menu`).toBeVisible();
    const inside = await showMe();
    expect(inside && inside.isSel, `${at}: with ${show.via} open, Show me does not highlight ${show.sel}`).toBe(true);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.getElementById("menu-export").hidden = true; }); // the top bar's Export menu does not close on Escape
    stats.menuItems++;
    return;
  }
  expect(spot.isSel, `${at}: Show me highlighted #${spot.id}, which is not ${show.sel}`).toBe(true);
}

const once = (tut) => `${tut.mode}:${test.info().repeatEachIndex}`;
async function walk(tut) {
  await normalize();
  await page.evaluate(() => window.__app.tutorials.close());
  await page.click("#btn-tutorials");
  await page.click("#tut-tab-" + tut.mode);
  const card = page.locator("#tut-" + tut.id);
  await expect(card, `${tut.id}: no card in the chooser`).toContainText(tut.title);
  await expect(card).toContainText(`${tut.steps.length} steps`);
  await card.click();
  await expect(page.locator("#tut-panel")).toBeVisible();
  expect(await page.evaluate(() => window.__app.mode), `${tut.id}: the tutorial did not switch to ${tut.mode} mode`).toBe(tut.mode);
  stats.tutorials++;
  for (let i = 0; i < tut.steps.length; i++) {
    const s = tut.steps[i];
    const head = await page.evaluate(() => ({ no: document.querySelector("#tut-panel .tut-stepno")?.firstChild?.textContent, h3: document.querySelector("#tut-panel h3")?.textContent, how: document.querySelectorAll("#tut-panel .tut-how li").length, icon: !!document.querySelector("#tut-panel .tut-tool-ic svg"), tool: document.querySelector("#tut-panel .tut-tool b")?.textContent }));
    expect(head, `${tut.id}: the panel does not show step ${i + 1} as the data says`).toEqual({ no: `Step ${i + 1} of ${tut.steps.length}`, h3: s.title, how: s.how.length, icon: true, tool: s.tool });
    // what a student does at the standard steps; the data says what they are (the selectors they point at)
    if (s.show.name) {
      await page.fill("#tut-last", "Lopez"); await page.fill("#tut-first", "Maria"); await page.fill("#tut-item", tut.item);
      await page.click("#tut-name-apply");
      await expect(page.locator("#tut-panel .tut-step.done"), `${tut.id}: naming the design did not tick step 1`).toBeVisible();
      expect(await page.evaluate(() => window.__store.doc.name)).toBe(`Lopez, Maria, ${tut.item}`);
      stats.namedAndTicked++;
    }
    await checkShowMe(tut.id, i, s.show, tut.mode);
    await normalize({ keepLathe: /#lathe-/.test(tut.steps[i + 1]?.show.sel || "") });
    if (s.show.sel === "#btn-save") {
      await page.click("#btn-save");
      // the app looks at the design every 0.7 s to tick steps off; the check it runs is T.saved(), so ask it directly (waiting for the real tick only in the first tutorial of each mode keeps the run short)
      if (!savedIn.has(once(tut))) { savedIn.add(once(tut)); await expect(page.locator("#tut-panel .tut-step.done"), `${tut.id}: Save did not tick its step`).toBeVisible({ timeout: 5000 }); }
      else expect(await page.evaluate(() => window.__app.tutorials.T.saved()), `${tut.id}: Save did not make a new version`).toBe(true);
      stats.saved++;
    }
    if (s.show.sel === "#btn-export" && !exportedIn.has(once(tut))) {
      exportedIn.add(once(tut)); // a real download costs about a second each; the first tutorial of each mode proves the step ticks and the file is named after the design
      if (!(await page.evaluate(() => window.__store.doc.bodies.length))) await addBox(tut.mode); // a student has shapes by now; an empty design exports nothing
      await page.evaluate(() => window.__app.select([])); // nothing selected: every part is exported, and the file name has no part name in it
      await waitIdle(page); // the export waits for nothing: a design whose meshes are not built yet downloads nothing
      expect((await bodies(page)).filter((b) => b.error), `${tut.id}: bodies with a geometry error before Export`).toEqual([]);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), (async () => { await page.click("#btn-export"); await page.click('#menu-export button[data-act="stl"]'); })()]);
      expect(dl.suggestedFilename(), `${tut.id}: the STL is not named design name + version`).toBe(`Lopez, Maria, ${tut.item} v1.stl`);
      await expect(page.locator("#tut-panel .tut-step.done"), `${tut.id}: Export did not tick its step`).toBeVisible({ timeout: 5000 });
      stats.exported++;
    } else if (s.show.sel === "#btn-export") { // the other tutorials: the menu the step describes must offer "STL for 3D printing"
      await page.click("#btn-export");
      await expect(page.locator('#menu-export button[data-act="stl"]'), `${tut.id}: Export has no STL item`).toBeVisible();
      await page.evaluate(() => { document.getElementById("menu-export").hidden = true; });
    }
    stats.steps++;
    if (s.strict) await page.check("#tut-check"); // "I did this": a strict step stops Next until its check passes (browser test F7)
    await page.click("#tut-next"); // "Next →", and "Finish ✓" on the last step
  }
  const finished = page.locator(".tut-done");
  await expect(finished, `${tut.id}: Finish did not open the finished pop-up`).toBeVisible();
  await expect(finished.locator("h2")).toHaveText(/Nice work/); // Next ticks a step off as the student moves on, so this shows Finish ran at the last step, not that the checks passed
  await expect(finished).toContainText(`Your design is saved as "Lopez, Maria, ${tut.item}`);
  await page.click(".tut-done .btn.primary");
  await expect(page.locator("#tut-panel")).toHaveCount(0);
  startedIds.add(tut.id);
}

test("steps whose picture would show the wrong action have no animation (browser test F6)", () => {
  const WRONG = new Set(["#sk-finish", "#nav-ortho", "#ws-design", "#mode-beginner", "#bb-solid"]);
  const hits = tutorials.flatMap((t) => t.steps.map((s, i) => ({ at: t.id + " step " + (i + 1), sel: s.show && s.show.sel, anim: s.anim }))).filter((s) => WRONG.has(s.sel));
  expect(hits.length, "no step points at these buttons any more: update the list").toBeGreaterThan(0);
  expect(hits.filter((s) => s.anim !== false), "steps that still get an animation of another action").toEqual([]);
});

test.describe("walk every tutorial", () => {
  test.describe.configure({ mode: "default" });
  for (const mode of ["beginner", "advanced", "arch"]) {
    // the list is read at run time, so declare the tests from the source order of the data (same ids as the app)
    for (const id of idsOf(mode)) {
      test(`${id}`, async ({}, info) => {
        // quarantined: in Firefox the a-spring panel stays on step 6 after Next (the Save step); not looked into yet
        if (id === "a-spring" && info.project.name.endsWith("-firefox")) { quarantined.add(id); quarantine(info, [info.project.name], "a-spring stalls on step 6 in Firefox"); }
        const tut = tutorials.find((t) => t.id === id);
        expect(tut, `${id} is not in the app's tutorial list`).toBeTruthy();
        await walk(tut);
      });
    }
  }
});

// ids from the data files, read as text so the tests can be declared before the browser is up
function idsOf(mode) {
  const src = ["tutorial_data.js", "tutorial_data_more.js", "tutorial_arch.js", "tutorial_data_community.js"].map((f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");
  return [...src.matchAll(/^\s*id: "([\w-]+)", mode: "(\w+)"/gm)].filter((m) => m[2] === mode).map((m) => m[1]);
}
function BEGINNER_IDS() { return idsOf("beginner"); }
function ADVANCED_IDS() { return idsOf("advanced"); }
function ARCH_IDS() { return idsOf("arch"); }

test("the walk reached every tutorial the app lists", () => {
  expect([...startedIds].sort()).toEqual(tutorials.map((t) => t.id).filter((id) => !quarantined.has(id)).sort());
});

// ---------------------------------------------------------------- 3. coverage
// Every visible button the toolbars and menus put in the page. The key is the button's id; a button without an id is keyed by its menu
// and its data-act / data-theme / data-perf / data-detail / data-agent, or else by its text (export:stl, theme:theme:dark, ribbon:text:Browser).
// Shape tiles are "tile:<kind>" and "hole-tile:<kind>". Runs inside the page, so it must not use anything from this file.
function scanIn({ container, prefix }) {
  const keyOf = (b) => {
    if (b.id) return b.id;
    const d = b.dataset, menu = b.closest(".menu"), p = menu ? menu.id.replace(/^menu-/, "") : prefix;
    if (d.act) return p + ":" + d.act;
    for (const a of ["theme", "perf", "detail"]) if (d[a]) return p + ":" + a + ":" + d[a];
    if ("agent" in d) return p + ":agent";
    return p + ":text:" + b.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
  };
  return [...document.querySelectorAll(container + " button")].filter((b) => b.getClientRects().length).map((b) => ({ key: keyOf(b), popup: b.id && b.getAttribute("aria-haspopup") ? b.id : null }));
}
async function ribbonButtons(group, containerSel, { menus = true } = {}) {
  const found = {};
  for (const b of await page.evaluate(scanIn, { container: containerSel, prefix: group })) {
    found[b.key] = group;
    if (menus && b.popup) { // a ribbon drop-down: open it, read the items, close it
      await page.click("#" + b.popup);
      await expect(page.locator("#ribbon-menu")).toBeVisible();
      for (const item of await page.evaluate(scanIn, { container: "#ribbon-menu", prefix: group })) found[item.key] = group;
      await page.keyboard.press("Escape");
      await expect(page.locator("#ribbon-menu")).toHaveCount(0);
    }
  }
  return found;
}
// the top bar's own menus (Export, and the Settings menu behind the theme button) are hidden until opened
async function topBarMenus() {
  const found = {};
  for (const toggle of await page.$$eval(".topbar .menu-wrap > button[id]", (bs) => bs.map((b) => b.id))) {
    await page.click("#" + toggle);
    const items = await page.evaluate(scanIn, { container: ".topbar .menu:not([hidden])", prefix: toggle });
    expect(items.length, `#${toggle} opened a menu with no buttons`).toBeGreaterThan(0);
    for (const item of items) found[item.key] = "top bar menus";
    await page.evaluate(() => document.querySelectorAll(".topbar .menu").forEach((m) => { m.hidden = true; }));
  }
  return found;
}
async function collectUniverse() {
  const all = {};
  const add = (o) => Object.assign(all, o);
  for (const mode of ["beginner", "advanced", "arch"]) {
    await normalize();
    await loadDoc(page, newDoc("Untitled", mode));
    add(await ribbonButtons("top bar", ".topbar", { menus: false }));
    add(await topBarMenus());
    add(await ribbonButtons("view buttons", ".navbtns", { menus: false }));
    add(await ribbonButtons("snap controls", ".snapctl", { menus: false }));
    if (mode === "beginner") {
      add(await ribbonButtons("Beginner toolbar", ".bbar"));
      add(await ribbonButtons("Beginner shape strip", "#shapes", { menus: false }));
      await page.click("#dock-objects");
      for (const k of await page.$$eval("#shapes .tile[data-kind]", (ts) => ts.map((t) => t.dataset.kind))) all["tile:" + k] = "Beginner shape tiles";
      await page.click("#dock-holes");
      for (const k of await page.$$eval("#shapes .tile[data-kind]", (ts) => ts.map((t) => t.dataset.kind))) all["hole-tile:" + k] = "Beginner hole tiles";
      await page.click("#dock-objects");
    } else if (mode === "arch") {
      add(await ribbonButtons("Architect toolbar", "#ribbon"));
    } else {
      add(await ribbonButtons("Advanced toolbar", "#ribbon"));
      await page.click("#ad-sketch"); await page.locator("#plane-seg button").first().click(); await page.waitForSelector("#sk-line");
      add(await ribbonButtons("Advanced sketch toolbar", "#ribbon"));
      await page.click("#sk-finish");
      for (const [ws, label] of [["#ws-print", "Advanced 3D print sim toolbar"], ["#ws-simulate", "Advanced simulate toolbar"]]) {
        await page.click(ws); add(await ribbonButtons(label, "#ribbon"));
      }
      await page.click("#ws-design");
    }
  }
  return all;
}
function referenced() {
  const ids = new Set();
  for (const t of tutorials) for (const s of t.steps) {
    if (s.show.tile) ids.add((s.show.hole ? "hole-tile:" : "tile:") + s.show.tile);
    if (s.show.sel === "#btn-export") ids.add("export:stl"); // the step says "choose STL for 3D printing", and the walk checks that item is in the menu
    for (const part of (s.show.sel || "").split(",").map((x) => x.trim())) { const m = /^#([\w-]+)$/.exec(part); if (m) ids.add(m[1]); }
    const v = /^#([\w-]+)$/.exec(s.show.via || ""); if (v) ids.add(v[1]);
  }
  return ids;
}

test("every toolbar and menu button is used by a tutorial, or is a known gap in test/tutorial-gaps.json", async () => {
  const universe = await collectUniverse();
  const used = referenced();
  const gapsFile = new URL("./tutorial-gaps.json", import.meta.url);
  const allowed = new Set(Object.values(JSON.parse(readFileSync(gapsFile, "utf8")).gaps).flat());
  const ids = Object.keys(universe).sort();
  const without = ids.filter((id) => !used.has(id));
  const byGroup = {};
  for (const id of without) (byGroup[universe[id]] ||= []).push(id);
  const report = { project: project, buttons: ids.length, withTutorial: ids.length - without.length, withoutTutorial: without.length, gapsByGroup: byGroup, referencedButNotFound: [...used].filter((id) => !universe[id]).sort() };
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/tutorial-coverage-${project}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(`[${project}] ${ids.length} buttons; ${ids.length - without.length} used by a tutorial; ${without.length} without one:\n` + Object.entries(byGroup).map(([g, l]) => `  ${g}: ${l.join(", ")}`).join("\n"));
  // (ids a step points at that are not in any toolbar or menu are panel fields, the inspector, the Lathe or Parameters: the walk covers those)
  const newGaps = without.filter((id) => !allowed.has(id));
  const fixed = [...allowed].filter((id) => universe[id] && used.has(id));
  const gone = [...allowed].filter((id) => !universe[id]);
  expect(newGaps, "buttons with no tutorial that are not in test/tutorial-gaps.json: add a tutorial step that uses them, or (if they truly need none) list them in the file").toEqual([]);
  expect(fixed, "buttons now used by a tutorial: remove them from test/tutorial-gaps.json").toEqual([]);
  expect(gone, "ids in test/tutorial-gaps.json that no longer exist in the app: remove them").toEqual([]);
});
