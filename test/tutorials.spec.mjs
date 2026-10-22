// The app's built-in tutorials as tests (queue idea 4b, plan §10 outcome 6: "anyone can learn the app without Max").
//  1. Data: every tutorial is well formed, and every step's "check" runs without throwing (the app swallows a throw,
//     so a typo in a check would just leave the step never ticking itself off).
//  2. Walk: each tutorial is opened from the Tutorials button like a student would, and every step is visited: its
//     "Show me" must land on a real, visible button, tile or field; menu items must be inside the menu the step names;
//     the name, save and export steps are done for real and must tick themselves off; Finish must end the tutorial.
//  3. Coverage: every toolbar and menu button in the DOM (Beginner and Advanced) is listed and compared with the
//     buttons the tutorials point at. Today's gaps are in test/tutorial-gaps.json; a NEW button without a tutorial fails.
// One page for the whole file (the kernel loads once). Steps whose target only appears after an earlier step (a sketch
// tool, the Lathe, a selected body's fields) get that state set up through the real buttons first; see prepareFor().
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { ICON } from "../src/icons.js";
import { boot, watchErrors, loadDoc, newDoc } from "./helpers.mjs";

let page, errors, project;
const tutorials = []; // { id, mode, title, steps }, read from the running app so the test sees exactly what users see
const exportedIn = new Set(), savedIn = new Set();
const stats = { tutorials: 0, steps: 0, menuItems: 0, tiles: 0, namedAndTicked: 0, saved: 0, exported: 0, started: 0 };

test.beforeAll(async ({ browser }, info) => {
  project = info.project.name;
  page = await browser.newPage();
  errors = watchErrors(page);
  page.on("dialog", (d) => d.accept()); // the Lathe asks "Start over?" before it throws work away
  await page.addInitScript(() => { try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch (e) {} });
  await boot(page, info);
  const list = await page.evaluate(() => window.__app.tutorials.list.map((t) => ({
    id: t.id, mode: t.mode, level: t.level, title: t.title, item: t.item, learn: t.learn, minutes: t.minutes,
    steps: t.steps.map((s) => ({ title: s.title, tool: s.tool, icon: s.icon, how: s.how, when: s.when, show: s.show, hasCheck: typeof s.check === "function", anim: s.anim })),
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
  expect(tutorials.length).toBe(39);
  expect(tutorials.filter((t) => t.mode === "beginner").length).toBe(19);
  expect(tutorials.filter((t) => t.mode === "advanced").length).toBe(20);
  expect(new Set(tutorials.map((t) => t.id)).size).toBe(tutorials.length);
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
    const first = t.steps[0], last2 = t.steps.slice(-2);
    if (!first.show || first.show.sel !== "#docname") problems.push(`${t.id}: step 1 is not the naming step`);
    if (last2[0].show.sel !== "#btn-save" || last2[1].show.sel !== "#btn-export") problems.push(`${t.id}: does not end with Save then Export`);
  }
  expect(problems).toEqual([]);
});

test("tutorial checks: none throws, on an empty design or on one with a box, a group and a sketch", async () => {
  for (const mode of ["beginner", "advanced"]) {
    await loadDoc(page, newDoc("Untitled", mode));
    const r = await page.evaluate(() => {
      const t = window.__app.tutorials, T = t.T, out = { thrown: [], ticked: [] };
      for (const tut of t.list) tut.steps.forEach((s, i) => {
        if (!s.check) return;
        try { if (s.check(T)) out.ticked.push(`${tut.id} step ${i + 1}: ${s.title}`); } catch (e) { out.thrown.push(`${tut.id} step ${i + 1}: ${s.title}: ${e.message}`); }
      });
      return out;
    });
    expect(r.thrown, `checks that throw on an empty ${mode} design`).toEqual([]);
    // a step that is "done" before the student did anything would tick itself off for nothing
    expect(r.ticked, `checks already true on an empty ${mode} design`).toEqual([]);
  }
  const populated = newDoc("Lopez, Maria, Test", "advanced", {
    bodies: [{ id: "b1", name: "Box", seq: 1, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "box", p: { w: 20, d: 20, h: 20, r: 0, c: 0 }, mods: [] } }],
  });
  await loadDoc(page, populated);
  const thrown = await page.evaluate(() => {
    const t = window.__app.tutorials, T = t.T, out = [];
    for (const tut of t.list) tut.steps.forEach((s, i) => { if (s.check) { try { s.check(T); } catch (e) { out.push(`${tut.id} step ${i + 1}: ${e.message}`); } } });
    return out;
  });
  expect(thrown, "checks that throw on a design with a box").toEqual([]);
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
    await page.waitForSelector("#inspector .colors, #insp-pos0", { state: "attached" });
    return "a box is selected";
  }
  if (/param-expr/.test(sel)) { await page.click("#browser .param-add"); return "one parameter added"; }
  return null;
}

// What "Show me" does for this step, checked from the outside. Returns what it pointed at.
async function checkShowMe(tutId, i, show, mode) {
  const at = `${tutId} step ${i + 1}`;
  const showMe = async () => page.evaluate(() => {
    document.getElementById("tut-show").click(); // the same handler a mouse click runs; one round trip instead of several
    const e = document.querySelector(".tut-spot");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { id: e.id, kind: e.dataset.kind || null, cls: e.className, onScreen: e.getClientRects().length > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight, bubble: !!document.querySelector("#tut-bubble") };
  });
  let spot = await showMe(), prepared = null;
  if (!spot) { prepared = await prepareFor(show.sel || "", mode); if (prepared) spot = await showMe(); }
  expect(spot, `${at} (${show.sel || show.tile}): Show me found nothing to point at${prepared ? " even after: " + prepared : ""}`).not.toBeNull();
  expect(spot.onScreen, `${at}: the highlighted target is not on screen`).toBe(true);
  expect(spot.bubble, `${at}: no pop-up next to the target`).toBe(true);
  if (show.tile) {
    expect(spot.kind, `${at}: Show me pointed at the wrong tile`).toBe(show.tile);
    stats.tiles++;
    return `tile ${show.hole ? "hole " : ""}${show.tile}`;
  }
  const wanted = show.sel.split(",").map((s) => s.trim());
  const wantedIds = wanted.filter((s) => /^#[\w-]+$/.test(s)).map((s) => s.slice(1));
  if (show.via && spot.id === show.via.slice(1)) { // the menu is closed: Show me points at its button; the item must be inside once it is open
    await page.click(show.via);
    await expect(page.locator("#ribbon-menu"), `${at}: ${show.via} opens no menu`).toBeVisible();
    const found = await page.evaluate((ids) => ids.find((id) => { const e = document.querySelector("#ribbon-menu #" + id); return e && e.getClientRects().length; }) || null, wantedIds);
    expect(found, `${at}: ${show.sel} is not in the menu ${show.via} opens`).not.toBeNull();
    await page.keyboard.press("Escape");
    stats.menuItems++;
    return found;
  }
  if (wantedIds.length) expect(wantedIds.includes(spot.id) || wanted.some((s) => s.startsWith(".") || s.includes(" ")), `${at}: Show me pointed at #${spot.id}, expected one of ${show.sel}`).toBe(true);
  return spot.id || spot.cls;
}

async function walk(tut) {
  await normalize();
  await page.evaluate(() => window.__app.tutorials.close());
  await page.click("#btn-tutorials");
  await page.click(tut.mode === "advanced" ? "#tut-tab-advanced" : "#tut-tab-beginner");
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
    const target = await checkShowMe(tut.id, i, s.show, tut.mode);
    await normalize({ keepLathe: /#lathe-/.test(tut.steps[i + 1]?.show.sel || "") });
    if (s.show.sel === "#btn-save") {
      await page.click("#btn-save");
      // the app looks at the design every 0.7 s to tick steps off; the check it runs is T.saved(), so ask it directly (waiting for the real tick only in the first tutorial of each mode keeps the run short)
      if (!savedIn.has(tut.mode)) { savedIn.add(tut.mode); await expect(page.locator("#tut-panel .tut-step.done"), `${tut.id}: Save did not tick its step`).toBeVisible({ timeout: 5000 }); }
      else expect(await page.evaluate(() => window.__app.tutorials.T.saved()), `${tut.id}: Save did not make a new version`).toBe(true);
      stats.saved++;
    }
    if (s.show.sel === "#btn-export" && !exportedIn.has(tut.mode)) {
      exportedIn.add(tut.mode); // a real download costs about a second each; the first tutorial of each mode proves the step ticks and the file is named after the design
      if (!(await page.evaluate(() => window.__store.doc.bodies.length))) await addBox(tut.mode); // a student has shapes by now; an empty design exports nothing
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), (async () => { await page.click("#btn-export"); await page.click('#menu-export button[data-act="stl"]'); })()]);
      expect(dl.suggestedFilename(), `${tut.id}: the STL is not named after the design`).toMatch(/^Lopez, Maria, .+\.stl$/);
      await expect(page.locator("#tut-panel .tut-step.done"), `${tut.id}: Export did not tick its step`).toBeVisible({ timeout: 5000 });
      stats.exported++;
    } else if (s.show.sel === "#btn-export") { // the other tutorials: the menu the step describes must offer "STL for 3D printing"
      await page.click("#btn-export");
      await expect(page.locator('#menu-export button[data-act="stl"]'), `${tut.id}: Export has no STL item`).toBeVisible();
      await page.evaluate(() => { document.getElementById("menu-export").hidden = true; });
    }
    stats.steps++;
    expect(target).toBeTruthy();
    await page.click("#tut-next", { force: true }); // the button pulses when a step is done, which Playwright would wait out; "Next →", and "Finish ✓" on the last step
  }
  const finished = page.locator(".tut-done");
  await expect(finished, `${tut.id}: Finish did not open the finished pop-up`).toBeVisible();
  await expect(finished.locator("h2")).toHaveText(/Nice work/); // every step was ticked, by hand or by itself
  await expect(finished).toContainText(`Your design is saved as "Lopez, Maria, ${tut.item}`);
  await page.click(".tut-done .btn.primary");
  await expect(page.locator("#tut-panel")).toHaveCount(0);
  stats.started++;
}

test.describe("walk every tutorial", () => {
  test.describe.configure({ mode: "default" });
  for (const mode of ["beginner", "advanced"]) {
    // the list is read at run time, so declare the tests from the source order of the data (same ids as the app)
    for (const id of mode === "beginner" ? BEGINNER_IDS() : ADVANCED_IDS()) {
      test(`${id}`, async () => {
        const tut = tutorials.find((t) => t.id === id);
        expect(tut, `${id} is not in the app's tutorial list`).toBeTruthy();
        await walk(tut);
      });
    }
  }
});

// ids from the data files, read as text so the tests can be declared before the browser is up
function idsOf(mode) {
  const src = readFileSync(new URL("../src/tutorial_data.js", import.meta.url), "utf8") + readFileSync(new URL("../src/tutorial_data_more.js", import.meta.url), "utf8");
  return [...src.matchAll(/^\s*id: "([\w-]+)", mode: "(\w+)"/gm)].filter((m) => m[2] === mode).map((m) => m[1]);
}
function BEGINNER_IDS() { return idsOf("beginner"); }
function ADVANCED_IDS() { return idsOf("advanced"); }

test("the walk reached every tutorial the app lists", () => {
  expect(stats.started).toBe(tutorials.length);
});

// ---------------------------------------------------------------- 3. coverage
// Every button the toolbars and menus put in the DOM. Ids are the key; shape tiles are "tile:<kind>" and "hole-tile:<kind>".
async function popupItems(buttonSel) {
  await page.click(buttonSel);
  await expect(page.locator("#ribbon-menu")).toBeVisible();
  const ids = await page.evaluate(() => [...document.querySelectorAll("#ribbon-menu button[id]")].map((b) => b.id));
  await page.keyboard.press("Escape");
  await expect(page.locator("#ribbon-menu")).toHaveCount(0);
  return ids;
}
async function ribbonButtons(group, containerSel, { menus = true } = {}) {
  const found = {};
  const ids = await page.evaluate((c) => [...document.querySelectorAll(c + " button[id]")].filter((b) => b.getClientRects().length).map((b) => ({ id: b.id, popup: !!b.getAttribute("aria-haspopup") })), containerSel);
  for (const b of ids) {
    found[b.id] = group;
    if (menus && b.popup) for (const sub of await popupItems("#" + b.id)) found[sub] = group;
  }
  return found;
}
async function collectUniverse() {
  const all = {};
  const add = (o) => Object.assign(all, o);
  for (const mode of ["beginner", "advanced"]) {
    await normalize();
    await loadDoc(page, newDoc("Untitled", mode));
    add(await ribbonButtons("top bar", ".topbar", { menus: false }));
    add(await ribbonButtons("view buttons", ".navbtns", { menus: false }));
    if (mode === "beginner") {
      add(await ribbonButtons("Beginner toolbar", ".bbar"));
      await page.click("#dock-objects");
      for (const k of await page.$$eval("#shapes .tile[data-kind]", (ts) => ts.map((t) => t.dataset.kind))) all["tile:" + k] = "Beginner shape tiles";
      await page.click("#dock-holes");
      for (const k of await page.$$eval("#shapes .tile[data-kind]", (ts) => ts.map((t) => t.dataset.kind))) all["hole-tile:" + k] = "Beginner hole tiles";
      await page.click("#dock-objects");
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
  // a button a step points at that is not in any toolbar or menu is fine only when it is a panel field (inspector, Lathe, Parameters); those are the walk's job
  const newGaps = without.filter((id) => !allowed.has(id));
  const fixed = [...allowed].filter((id) => universe[id] && used.has(id));
  const gone = [...allowed].filter((id) => !universe[id]);
  expect(newGaps, "buttons with no tutorial that are not in test/tutorial-gaps.json: add a tutorial step that uses them, or (if they truly need none) list them in the file").toEqual([]);
  expect(fixed, "buttons now used by a tutorial: remove them from test/tutorial-gaps.json").toEqual([]);
  expect(gone, "ids in test/tutorial-gaps.json that no longer exist in the app: remove them").toEqual([]);
});
