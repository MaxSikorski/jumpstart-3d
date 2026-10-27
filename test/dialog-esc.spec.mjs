// Escape belongs to the dialog: closing it must leave the work behind it alone.
import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, watchErrors } from "./helpers.mjs";

const cases = [
  ["About JumpStart 3D", (page) => page.click("#btn-about")],
  ["Keyboard shortcuts", (page) => page.click("#btn-keys")],
  ["Tutorials", (page) => page.click("#btn-tutorials")],
  ["Report a problem", async (page) => {
    await page.click("#btn-export");
    await page.click("#btn-report");
  }],
  ["Autosaves", (page) => page.evaluate(() => window.__app.recovery.openHistory())],
  ["Recover unsaved work", async (page) => {
    await page.evaluate(() => window.__app.recovery.setEnabled(true));
    // setEnabled starts a write but does not return its promise.
    await expect.poll(() => page.evaluate(async () => {
      const rows = await window.__app.recovery.all();
      return rows.some((r) => r.docId === window.__store.doc.id && r.kind === "latest");
    })).toBe(true);
    await page.evaluate(() => window.__app.recovery.check());
  }],
  ["Code CAD", (page) => page.evaluate(() => window.__app.codeCad.open())],
];

async function prepare(page, info) {
  await boot(page, info);
  await loadDoc(page, newDoc("Dialog Escape", "advanced", {
    bodies: [body("b1", "Box", prim("box", { w: 20, d: 20, h: 20, r: 0, c: 0 }))],
    sketches: [{ id: "s1", name: "Sketch", seq: 1, hidden: false,
      plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] }, pts: [], ents: [], cons: [] }],
  }));
  await page.evaluate(() => window.__app.select(["b1"]));
}
const selection = (page) => page.evaluate(() => [...window.__app.sel]);
const sketch = (page) => page.evaluate(() => ({ active: window.__app.sketcher.active, tool: window.__app.sketcher.tool }));

// Also check propagation directly: a textarea's key can otherwise be ignored by
// the app, hiding a missing stopPropagation in the dialog's handler.
async function watchEscape(page) {
  await page.evaluate(() => {
    window.__dialogEscReachedApp = 0;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.__dialogEscReachedApp++;
    });
  });
}
async function dismiss(page, dialog) {
  await expect(dialog).toBeVisible();
  // Recovery does not move focus into its dialog; use its real Close button.
  // A button also exercises the app's shortcuts, which ignore text fields.
  await dialog.locator("button").first().focus();
  await watchEscape(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__dialogEscReachedApp)).toBe(0);
}

for (const [name, open] of cases) {
  for (const state of ["selected body", "sketch line tool"]) {
    test(`${name}: Escape keeps the ${state}`, async ({ page }, info) => {
      const errors = watchErrors(page);
      await prepare(page, info);
      if (state === "sketch line tool") {
        await page.evaluate(() => {
          window.__app.enterSketch("s1");
          window.__app.sketcher.setTool("line");
        });
        expect(await sketch(page)).toEqual({ active: "s1", tool: "line" });
      } else expect(await selection(page)).toEqual(["b1"]);
      const before = { selection: await selection(page), sketch: await sketch(page) };
      await open(page);
      await dismiss(page, page.getByRole("dialog", { name, exact: true }));
      expect(await selection(page)).toEqual(before.selection);
      expect(await sketch(page)).toEqual(before.sketch);
      expect(errors).toEqual([]);
    });
  }
}

test("Chisel first-visit notice: Escape keeps the selected body and stays inside the notice", async ({ page }, info) => {
  const errors = watchErrors(page);
  await prepare(page, info);
  await page.evaluate(() => localStorage.removeItem("jumpstart.chisel.intro"));
  await page.click("#mode-chisel");
  const dialog = page.getByRole("alertdialog", { name: "Before you sculpt" });
  await expect(dialog).toBeVisible();
  // Switching modes clears selection; select the body behind the open notice.
  await page.evaluate(() => window.__app.select(["b1"]));
  expect(await selection(page)).toEqual(["b1"]);
  await dismiss(page, dialog);
  expect(await selection(page)).toEqual(["b1"]);
  expect(await page.evaluate(() => window.__app.mode)).toBe("chisel");
  expect(errors).toEqual([]);
});
