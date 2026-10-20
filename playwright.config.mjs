// Regression harness: the same tests run against the site build (docs/, served on port 8765, or JS3D_PORT) and the
// single file (dist/jumpstart-3d.html, opened from disk as users open it). npm test builds first.
// npm test            both builds
// npm run test:site   docs/ only        npm run test:single   dist/ only
// npm run test:update re-records test/golden.json after an intended geometry change
import { defineConfig } from "@playwright/test";
import { pathToFileURL } from "node:url";

const base = +(process.env.JS3D_PORT || 8765); // set JS3D_PORT when two checkouts run the tests at once
const chromiumArgs = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]; // WebGL without a GPU, as the author's scripts ran

export default defineConfig({
  testDir: "test",
  testMatch: /.*\.spec\.mjs/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // every page loads and compiles the 7 MB kernel; one at a time is faster overall
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { viewport: { width: 1400, height: 880 }, launchOptions: { args: chromiumArgs }, trace: "retain-on-failure" },
  projects: [
    { name: "site", use: { baseURL: `http://127.0.0.1:${base}/` } },
    { name: "single", use: { baseURL: pathToFileURL("dist/jumpstart-3d.html").href } },
  ],
  webServer: { command: `node test/serve.mjs docs ${base}`, url: `http://127.0.0.1:${base}/`, reuseExistingServer: true },
});
