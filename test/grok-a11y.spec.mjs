// Every visible button in the top bar, the view controls, Simple's tool rail and its shape panel has an accessible
// name that does not rest on the tooltip alone (Grok review, "Accessibility": Undo, Redo and the view buttons had a
// tooltip and no name). Names are read the way a screen reader gets them (Playwright's accessible-name computation).
import { test, expect } from "@playwright/test";
import { boot, waitIdle, watchErrors } from "./helpers.mjs";

let errors;
test.beforeEach(async ({ page }, info) => { errors = watchErrors(page); await boot(page, info); });
test.afterEach(() => expect(errors, "console or page errors").toEqual([]));

const CONTROLS = 'button:visible, [role="button"]:visible';

async function expectNamed(page, areas) {
  let count = 0;
  for (const area of areas) {
    for (const loc of await page.locator(area).locator(CONTROLS).all()) {
      count++;
      const who = await loc.evaluate((e) => e.id || e.className || e.outerHTML.slice(0, 80));
      await expect(loc, `${area}: ${who} has an accessible name`).toHaveAccessibleName(/[\p{L}\p{N}]/u);
      // a title is only a tooltip: the name must come from shown text, aria-label, aria-labelledby or a label (text hidden by CSS on a narrow screen does not count)
      const own = await loc.evaluate((e) => {
        const word = (t) => /[\p{L}\p{N}]/u.test(t || "");
        return word(e.getAttribute("aria-label")) || e.hasAttribute("aria-labelledby") || word(e.innerText) || [...(e.labels || [])].some((l) => word(l.textContent));
      });
      expect(own, `${area}: ${who} is named by more than its tooltip`).toBe(true);
    }
  }
  return count;
}

test("Simple: the top bar, view controls, tool rail and shape panel are all named", async ({ page }) => {
  await page.evaluate(() => window.__app.setFace("simple", true));
  await page.evaluate(() => { const id = window.JS3D.add("box", { size: [20, 20, 20] }); window.JS3D.select([id]); });
  await waitIdle(page);
  await expect(page.locator("#simple-panel #insp-name")).toBeVisible();
  for (const id of ["btn-undo", "btn-redo", "nav-home", "nav-fit", "nav-ortho", "nav-light"]) await expect(page.locator("#" + id)).toHaveAttribute("aria-label", /\w/);
  const n = await expectNamed(page, [".topbar", ".navbtns", ".cube-arrows", "#simple-rail", "#simple-panel"]);
  expect(n).toBeGreaterThan(30);
});

test("Original: the top bar and view controls are named", async ({ page }) => {
  await page.evaluate(() => window.__app.setFace("original", true));
  const n = await expectNamed(page, [".topbar", ".navbtns", ".cube-arrows"]);
  expect(n).toBeGreaterThan(15);
});

test("on a narrow window the top bar keeps short names when its labels are hidden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__app.setFace("simple", true));
  await expect(page.locator("#btn-save")).toHaveAccessibleName("Save");
  await expect(page.locator("#btn-export")).toHaveAccessibleName("Print / Export");
  await expectNamed(page, [".topbar", ".navbtns", ".cube-arrows", "#simple-rail"]);
  await page.evaluate(() => window.__app.setFace("original", true));
  await expect(page.locator("#btn-export")).toHaveAccessibleName("Open/Export");
  await expectNamed(page, [".topbar", ".navbtns", ".cube-arrows"]);
});

test("a button added later and a changed tooltip are named too", async ({ page }) => {
  const label = () => page.evaluate(() => document.getElementById("t-late").getAttribute("aria-label"));
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "t-late"; b.title = "Late tool"; b.innerHTML = "<svg></svg>"; document.querySelector(".navbtns").append(b); });
  await expect.poll(label).toBe("Late tool");
  await page.evaluate(() => { document.getElementById("t-late").title = "Renamed tool"; });
  await expect.poll(label).toBe("Renamed tool");
  await page.evaluate(() => { document.getElementById("t-late").textContent = "Visible text"; });
  await expect.poll(label).toBe(null);
  // a name the app sets itself is never overwritten
  await page.evaluate(() => { const b = document.getElementById("t-late"); b.textContent = ""; b.title = "Tool"; });
  await expect.poll(label).toBe("Tool");
  await page.evaluate(() => { const b = document.getElementById("t-late"); b.setAttribute("aria-label", "Mine"); b.title = "Other"; });
  await expect.poll(label).toBe("Mine");
});
