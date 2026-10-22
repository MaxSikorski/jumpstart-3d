// Import OBJ through the real file picker in both modes; measure the built mesh.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, watchErrors, loadDoc, newDoc, waitIdle } from "./helpers.mjs";

let page, errors;
test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage();
  errors = watchErrors(page);
  await boot(page, info);
});
test.afterAll(async () => { await page?.close(); });
test.afterEach(() => { expect(errors, "console or page errors").toEqual([]); });

async function chooseModel(mode, file) {
  if (mode === "advanced") await page.click("#ad-insert");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(mode === "beginner" ? "#bb-import" : "#ad-ins-model"),
  ]);
  // These projects use desktop Chromium; fileAccept deliberately clears this on iOS.
  const accept = (await chooser.element().getAttribute("accept")).split(",");
  expect(accept).toContain(".obj");
  expect(accept).toContain("model/obj");
  await chooser.setFiles(file);
}

for (const mode of ["beginner", "advanced"]) {
  for (const [fixture, size, eol] of [
    ["cube-quads.obj", 20], ["cube-indexed.obj", 20], ["cube-quads.obj", 5],
    ["cube-continued.obj", 5, "LF"], ["cube-continued.obj", 5, "CRLF"],
  ]) {
    test(`${mode}: ${fixture}${eol ? ` (${eol})` : ""} defaults to one ${size} mm cube`, async () => {
      await loadDoc(page, newDoc("OBJ cube", mode));
      const path = fileURLToPath(new URL(`./fixtures/obj/${fixture}`, import.meta.url));
      await chooseModel(mode, size === 5 ? {
        name: fixture, mimeType: "model/obj",
        buffer: Buffer.from(readFileSync(path, "utf8")
          .replace(/\b20\b/g, "5").replace(/\r?\n/g, eol === "CRLF" ? "\r\n" : "\n")),
      } : path);
      await expect(page.locator("#cmd")).toContainText("Import OBJ");
      await expect(page.locator("#cmd")).toContainText("12 triangles");
      await expect(page.locator("#cmd")).toContainText("Closed solid");
      await expect(page.locator("#imp-tostep")).toHaveCount(0);
      await expect(page.locator("#imp-unit").getByRole("button", { name: "mm", exact: true })).toBeVisible();
      await page.click("#cmd-ok");
      await expect(page.locator("#cmd")).toBeHidden();
      await expect.poll(() => page.evaluate(() => window.__store.doc.bodies.length)).toBe(1);
      await waitIdle(page);
      const list = await page.evaluate(() => window.JS3D.list());
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe(fixture.replace(".obj", "").replaceAll("-", " ") + " 1"); // numbered like STL imports
      expect(list[0].error).toBeNull();
      expect(list[0].hidden).toBe(false);
      expect(list[0].hole).toBe(false);
      expect(list[0].volume).toBeCloseTo(size ** 3, 3);
      for (let axis = 0; axis < 3; axis++) {
        expect(list[0].bbox.max[axis] - list[0].bbox.min[axis]).toBeCloseTo(size, 3);
      }
      await page.evaluate(() => window.JS3D.undo());
      await waitIdle(page);
      expect(await page.evaluate(() => window.__store.doc.bodies)).toEqual([]);
      expect(await page.evaluate(() => window.JS3D.list())).toEqual([]);
    });
  }
}

test("a bad OBJ face is refused without importing partial geometry", async () => {
  await loadDoc(page, newDoc("Bad OBJ", "beginner"));
  await chooseModel("beginner", {
    name: "bad-index.obj", mimeType: "model/obj",
    buffer: Buffer.from("v 0 0 0\nv 20 0 0\nv 0 20 0\nf 1 2 3\nf 1 2 99\n"),
  });
  await expect(page.locator("#toasts .toast").last()).toContainText(/OBJ.*index/i);
  await expect(page.locator("#cmd")).toBeHidden();
  await waitIdle(page);
  expect(await page.evaluate(() => window.__store.doc.bodies)).toEqual([]);
});
