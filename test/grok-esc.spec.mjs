// Escape and the dialog in front (Grok review, bug 2, 2026-11-13): while a dialog, menu or tool panel is open, Escape closes the one
// in front and nothing else, wherever the keyboard focus is. The report: add a wedge, undo it, open Learn, press Escape, and the dialog
// stayed open (the "Undid add wedge" toast on screen was the one from the undo). Cause: each dialog listens for Escape on itself, so
// once the focus had left it (a click on its text puts the focus on the page) Escape went to the app's key handler, which ignores keys
// while a dialog is open. An open menu let Escape through to the design (it cleared the selection), and the 3D Print Sim ignored it.
// Every outcome is read from the app's state: the layer is gone, the undo and redo stacks, bodies, selection and open tool are as before,
// and no Undid / Redid toast appeared. dialog-esc.spec.mjs covers the same dialogs with the focus inside them.
import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, watchErrors } from "./helpers.mjs";

const BOX = prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 });

async function prepare(page, info, face = "original") {
  if (face === "simple") await page.addInitScript(() => { try { localStorage.setItem("jumpstart.face", "simple"); } catch {} });
  await boot(page, info, face === "simple" ? { face: false } : {});
  expect(await page.evaluate(() => document.documentElement.dataset.face)).toBe(face);
  await loadDoc(page, newDoc("Grok Escape", "beginner", { bodies: [body("b1", "Box", BOX)] }));
  // the report's history: a wedge added, then undone
  await page.evaluate(() => {
    window.__store.update((doc) => { doc.bodies.push({ id: "w1", name: "Wedge", seq: 2, color: "#3b82c4", hole: false, hidden: false, m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], node: { t: "prim", kind: "wedge", p: { w: 20, d: 20, h: 20 }, mods: [] } }); }, "Add wedge");
    window.__app.undo();
  });
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((t) => t.remove()); window.__app.select(["b1"]); });
}
const state = (page) => page.evaluate(() => ({
  undo: window.__store.undoStack.length, redo: window.__store.redoStack.length,
  bodies: window.__store.doc.bodies.map((b) => b.id), sel: [...window.__app.sel],
  tool: window.__app.command ? window.__app.command.title : null, sketch: window.__app.sketcher.active || null,
}));
const undoToasts = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).filter((t) => /^(Undid|Redid)/.test(t)));
// the focus leaves the dialog for the page, as a click on its text does
async function escapeFromPage(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Escape");
}
async function expectUntouched(page, before, errors) {
  expect(await state(page)).toEqual(before);
  expect(await undoToasts(page)).toEqual([]);
  expect(errors).toEqual([]);
}

test("Learn (Simple), the report's steps: Escape after a click on the dialog's text closes Learn and leaves the design alone", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info, "simple");
  expect(await state(page)).toMatchObject({ undo: 0, redo: 1, bodies: ["b1"] });
  const before = await state(page);
  await page.click("#btn-tutorials");
  const dialog = page.getByRole("dialog", { name: "Tutorials", exact: true });
  await expect(dialog).toBeVisible();
  await page.click(".tut-intro"); // not focusable: the focus goes to the page
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectUntouched(page, before, errors);
  // the next Escape belongs to the design again: it clears the selection, and still undoes nothing
  await page.keyboard.press("Escape");
  expect(await state(page)).toEqual({ ...before, sel: [] });
});

const DIALOGS = [
  ["About JumpStart 3D", (page) => page.click("#btn-about")],
  ["Keyboard shortcuts", async (page) => { if (await page.locator("#btn-keys").isVisible()) return page.click("#btn-keys"); await page.click("#btn-theme"); await page.click("#cz-keys"); }],
  ["Tutorials", (page) => page.click("#btn-tutorials")],
  ["Report a problem", async (page) => { await page.click("#btn-export"); await page.click("#btn-report"); }],
  ["Autosaves", (page) => page.evaluate(() => window.__app.recovery.openHistory())],
  ["Your designs", (page) => page.evaluate(() => document.getElementById("btn-projects").click())], // below 1440 px Original keeps the button in Customize
  ["Code CAD", (page) => page.evaluate(() => window.__app.codeCad.open())],
  ["Slow bodies", (page) => page.evaluate(() => window.__app.showSlowHelp())], // no Escape code of its own: its Close button is pressed
];
for (const [name, open] of DIALOGS) {
  test(`${name}: Escape with the focus on the page closes it and nothing else`, async ({ page }, info) => {
    const errors = watchErrors(page);
    await prepare(page, info);
    const before = await state(page);
    await open(page);
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await escapeFromPage(page);
    await expect(dialog).toHaveCount(0);
    await expectUntouched(page, before, errors);
  });
}

test("Printer plate (in Customize): Escape with the focus on the page closes it and nothing else", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  const before = await state(page);
  await page.click("#btn-theme");
  await page.click("#btn-plate");
  await expect(page.locator("#plate-dialog")).toBeVisible();
  await escapeFromPage(page);
  await expect(page.locator("#plate-dialog")).toHaveCount(0);
  await expectUntouched(page, before, errors);
});

test("Two dialogs: Escape closes only the one in front", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  const before = await state(page);
  await page.click("#btn-about");
  await page.evaluate(() => window.__app.showShortcuts());
  const about = page.getByRole("dialog", { name: "About JumpStart 3D", exact: true }), keys = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(keys).toBeVisible();
  await escapeFromPage(page);
  await expect(keys).toHaveCount(0);
  await expect(about).toBeVisible();
  await escapeFromPage(page);
  await expect(about).toHaveCount(0);
  await expectUntouched(page, before, errors);
});

const MENUS = [["Customize", "#btn-theme", "#menu-theme"], ["Print / Export", "#btn-export", "#menu-export"], ["Snap to", "#snap-more", "#snap-menu"]];
for (const [name, button, menu] of MENUS) {
  for (const where of ["the page", "the menu"]) {
    test(`${name} menu: Escape with the focus on ${where} closes the menu and keeps the selection`, async ({ page }, info) => {
      const errors = watchErrors(page);
      await prepare(page, info);
      const before = await state(page);
      await page.click(button);
      await expect(page.locator(menu)).toBeVisible();
      if (where === "the page") await escapeFromPage(page);
      else {
        await page.locator(`${menu} :is(button, input):visible`).first().focus(); // the Snap to menu holds checkboxes
        await page.keyboard.press("Escape");
      }
      await expect(page.locator(menu)).toBeHidden();
      if (where === "the menu") expect(await page.evaluate((b) => document.activeElement === document.querySelector(b), button)).toBe(true);
      await expectUntouched(page, before, errors);
    });
  }
}

test("Simple: About this build and the More panel close on Escape with the focus on the page", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info, "simple");
  const before = await state(page);
  await page.click("#face-more");
  const about = page.getByRole("dialog", { name: "JumpStart 3D Community Build", exact: true });
  await expect(about).toBeVisible();
  await escapeFromPage(page);
  await expect(about).toHaveCount(0);
  await page.click("#sr-more");
  await expect(page.locator("#simple-more")).toBeVisible();
  await escapeFromPage(page);
  await expect(page.locator("#simple-more")).toBeHidden();
  await expectUntouched(page, before, errors);
});

test("Simple: with Keyboard shortcuts open over About this build, Escape closes only Keyboard shortcuts", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info, "simple");
  const before = await state(page);
  await page.click("#face-more");
  await page.evaluate(() => window.__app.showShortcuts()); // focus goes to its Close button
  const about = page.getByRole("dialog", { name: "JumpStart 3D Community Build", exact: true }), keys = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(keys).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keys).toHaveCount(0);
  await expect(about).toBeVisible();
  await escapeFromPage(page);
  await expect(about).toHaveCount(0);
  await expectUntouched(page, before, errors);
});

test("A field in a dialog that keeps every key to itself (as Architect's number boxes do): Escape there still closes the dialog", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  const before = await state(page);
  await page.click("#btn-tutorials");
  const dialog = page.getByRole("dialog", { name: "Tutorials", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const inp = document.createElement("input"); inp.id = "esc-test-field";
    inp.addEventListener("keydown", (e) => e.stopPropagation());
    document.querySelector(".tut-modal .mbody").prepend(inp);
  });
  await page.focus("#esc-test-field");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectUntouched(page, before, errors);
});

test("3D Print Sim: Escape closes it, as its X does, and the design is unlocked again", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  const before = await state(page);
  await page.evaluate(() => window.__app.advanced.openPrintSim());
  await expect.poll(() => page.evaluate(() => window.__app.simLock)).toBe(true);
  await escapeFromPage(page);
  await expect.poll(() => page.evaluate(() => window.__app.simLock)).toBe(false);
  expect(await page.evaluate(() => document.body.classList.contains("simlock"))).toBe(false);
  // again from its Scale box (the object picked by its name chip), which keeps its keys from the app
  await page.evaluate(() => window.__app.advanced.openPrintSim());
  await expect.poll(() => page.evaluate(() => window.__app.simLock)).toBe(true);
  await page.click("#ps-obj-0");
  await page.locator("#ps-oscale").focus();
  expect(await page.evaluate(() => document.activeElement.id)).toBe("ps-oscale");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__app.simLock)).toBe(false);
  await expectUntouched(page, before, errors);
});

test("Advanced: Keyboard shortcuts opened over a ribbon menu (? from the menu): Escape closes the dialog first, then the menu", async ({ page }, info) => {
  const errors = watchErrors(page);
  await boot(page, info);
  await loadDoc(page, newDoc("Grok Escape menu", "advanced", { bodies: [body("b1", "Box", BOX)] }));
  await page.evaluate(() => window.__app.select(["b1"]));
  const before = await state(page);
  await page.locator("button.rdrop:visible").first().click();
  await expect(page.locator("#ribbon-menu")).toBeVisible();
  await page.keyboard.press("?"); // the focus is in the menu
  const keys = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  await expect(keys).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keys).toHaveCount(0);
  await expect(page.locator("#ribbon-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ribbon-menu")).toHaveCount(0);
  await expectUntouched(page, before, errors);
});

test("A dialog that answers Escape itself without closing (it clears its field first) stays open, from inside it or from the page", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  const before = await state(page);
  await page.evaluate(() => {
    const back = document.createElement("div"); back.className = "modal-back"; back.id = "esc-test-back";
    const modal = document.createElement("div"); modal.className = "modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-label", "Test");
    const field = document.createElement("input"); field.id = "esc-test-field"; field.value = "abc";
    const close = document.createElement("button"); close.textContent = "Close"; close.onclick = () => back.remove();
    modal.append(field, close); back.append(modal); document.body.append(back);
    back.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; e.stopPropagation(); if (field.value) { e.preventDefault(); field.value = ""; } else back.remove(); });
  });
  const field = page.locator("#esc-test-field"), back = page.locator("#esc-test-back");
  await field.focus();
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("");
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0))); // after escapekey.js's own check, queued first
  await expect(back).toHaveCount(1);
  await field.fill("xyz");
  await escapeFromPage(page);
  await expect(field).toHaveValue("");
  await expect(back).toHaveCount(1);
  await escapeFromPage(page);
  await expect(back).toHaveCount(0);
  await expectUntouched(page, before, errors);
});
