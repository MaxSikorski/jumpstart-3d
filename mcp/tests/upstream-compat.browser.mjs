import { test, expect } from "@playwright/test";
import { boot, loadDoc, newDoc, body, prim, watchErrors } from "../../test/helpers.mjs";

test("static and offline editor builds stay quiet without a local MCP broker", async ({ page }, info) => {
  const requests = [], errors = watchErrors(page);
  page.on("request", (request) => { if (request.url().includes("/__mcp/")) requests.push(request.url()); });
  await boot(page, info);
  await expect(page.locator("#ai-status")).toBeHidden();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("pre-2.0 local projects reopen with MCP metadata and recoverable history", async ({ page }, info) => {
  await boot(page, info);
  const legacy = newDoc("legacy-mcp-project", "beginner", {
    bodies: [body("legacy-body", "Legacy box", prim("box", { w: 20, d: 15, h: 5, r: 0, c: 0 }))],
    mcpModels: [{ id: "legacy-model", version: 1, bodyIds: ["legacy-body"], parameters: { width: { value: 20, unit: "mm" } } }],
  });
  await loadDoc(page, legacy);
  const result = await page.evaluate((saved) => {
    localStorage.setItem(`workplane.doc.v1.${saved.id}`, JSON.stringify(saved));
    window.__store.update((doc) => { doc.bodies[0].name = "Before reopen"; }, "Native change");
    const outcome = window.__app.projects.reopenLocalMcp(saved.id);
    const current = structuredClone(window.__store.doc);
    window.__store.undo();
    return { outcome, current, undoneName: window.__store.doc.bodies[0].name };
  }, legacy);
  expect(result.outcome.reopened).toBe(true);
  expect(result.current.params).toEqual([]);
  expect(result.current.mcpModels).toEqual(legacy.mcpModels);
  expect(result.current.bodies[0].name).toBe("Legacy box");
  expect(result.undoneName).toBe("Before reopen");
});
