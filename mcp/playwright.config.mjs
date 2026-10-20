import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import upstream from "../playwright.config.mjs";

// Keep fork-specific browser coverage under mcp/ while inheriting upstream's
// site/single-file projects, WebGL settings, and static test server.
export default defineConfig({
  ...upstream,
  testDir: fileURLToPath(new URL("./tests", import.meta.url)),
  testMatch: /.*\.browser\.mjs/,
  projects: upstream.projects.map((project) => project.name === "single" ? { ...project, testIgnore: /native-inspection\.browser\.mjs/ } : project),
  outputDir: fileURLToPath(new URL("../test-results/mcp", import.meta.url)),
  reporter: [["list"], ["html", { outputFolder: fileURLToPath(new URL("../playwright-report/mcp", import.meta.url)), open: "never" }]],
  webServer: { ...upstream.webServer, cwd: fileURLToPath(new URL("..", import.meta.url)) },
});
