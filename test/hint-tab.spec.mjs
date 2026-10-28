// Two small fixes, proved from the user's side.
//  1. Align > Face to face: the status bar's hint names the face you are picking. Switching Moving face / Target face
//     only redrew the panel, so the hint kept naming the other face.
//  2. Keyboard: the app's Tab key (type a size on the selected shape) used to take Tab even when focus was on a button,
//     so a keyboard user could not Tab to the import note's mm / cm / in buttons. Tab from the view still types a size.
import { test, expect } from "@playwright/test";
import { boot, watchErrors, loadDoc, newDoc, body, prim, waitIdle } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

const M = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
const steady = () => page.waitForFunction(() => !window.__app.vp.isMoving()); // a mouse press stops a camera move half way; testing.md, Flakes

test("Align, Face to face: the hint names Moving face or Target face as you switch between them", async () => {
  await loadDoc(page, newDoc("align hint", "advanced", { bodies: [body("a", "Box A", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), M(0)), body("b", "Box B", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }), M(60))] }));
  await steady();
  await page.evaluate(() => { window.__app.select(["a"]); window.__app.advanced.align(); });
  await expect(page.locator("#cmd")).toContainText("Align");
  await page.click("#al-mode button:has-text('Face to face')");
  const hint = page.locator("#hint");
  const moving = "Click the face on the shape that will move.", target = "Click the face to align it to.";
  const row = (label) => page.locator("#cmd .picklist").nth(label === "Moving face" ? 0 : 1); // the two pick boxes, in order
  await expect(hint).toHaveText(moving);
  await row("Target face").click();
  await expect(hint).toHaveText(target);
  await row("Moving face").click();
  await expect(hint).toHaveText(moving);
  await row("Target face").click();
  await expect(hint).toHaveText(target);
  await page.evaluate(() => window.__app.command && window.__app.command.cancel());
});

test("Tab: a keyboard user can Tab to the import note's buttons; Tab from the view still types a size", async () => {
  await loadDoc(page, newDoc("tab", "beginner"));
  await page.evaluate(() => { document.getElementById("toasts").replaceChildren(); });
  const stl = "solid b\n" + [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]
    .map((t) => `facet normal 0 0 0\nouter loop\n${t.map((i) => `vertex ${i & 1 ? 20 : 0} ${i & 2 ? 10 : 0} ${i & 4 ? 5 : 0}`).join("\n")}\nendloop\nendfacet`).join("\n") + "\nendsolid b\n";
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#bb-import")]);
  await chooser.setFiles({ name: "Tabs.stl", mimeType: "model/stl", buffer: Buffer.from(stl) });
  const note = page.locator("#toasts .imp-toast", { hasText: "Imported Tabs.stl:" });
  await expect(note).toBeVisible();
  await waitIdle(page);
  await steady();
  expect(await page.evaluate(() => window.JS3D.selection().length)).toBe(1);
  // a keyboard user on a button ahead of the note: Tab moves on to the next control, until it reaches the note's buttons
  await page.keyboard.press("Shift"); // the last input was the keyboard, so the focus ring (:focus-visible) shows, as for a keyboard user
  await page.locator("#bb-import").focus();
  let reached = null;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press("Tab");
    expect(await page.locator("#dim-input").count(), "Tab on a button must not open the size box").toBe(0);
    reached = await page.evaluate(() => (document.activeElement.closest("#toasts") ? document.activeElement.dataset.unit || document.activeElement.textContent : null));
  }
  expect(reached, "Tab reached a button of the import note").toBe("mm");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.dataset.unit)).toBe("cm");
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement.dataset.unit)).toBe("mm");
  // Tab from the view itself is unchanged: it types a size on the selected shape
  await page.keyboard.press("Escape"); // hands the keyboard back to the view
  await expect.poll(() => page.evaluate(() => document.activeElement === window.__app.vp.canvas)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator("#dim-input")).toBeVisible();
  const first = await page.locator("#dim-input").getAttribute("data-dim");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.locator("#dim-input").getAttribute("data-dim")).not.toBe(first);
  await page.keyboard.press("Escape");

  // a button the MOUSE clicked keeps its old behaviour: the next Tab still types a size on the selected shape (click New, click a shape, Tab)
  await page.locator("#bb-import").evaluate((b) => b.blur());
  await page.evaluate(() => { document.getElementById("toasts").replaceChildren(); });
  await page.locator("#bb-dup").click();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "bb-dup");
  await page.keyboard.press("Tab");
  await expect(page.locator("#dim-input")).toBeVisible();
  await page.keyboard.press("Escape");
});
