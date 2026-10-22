// Regression harness: the same tests run against the site build (docs/, served on port 8765, or JS3D_PORT) and the
// single file (dist/jumpstart-3d.html, opened from disk as users open it). npm test builds first.
// npm test            both builds
// npm run test:site   docs/ only        npm run test:single   dist/ only
// npm run test:update re-records test/golden.json after an intended geometry change
// npm run test:mobile the phone budget only (test/mobile.spec.mjs: its own project, with a gzip server on port + 2)
import { defineConfig, devices } from "@playwright/test";
import { pathToFileURL } from "node:url";

const base = +(process.env.JS3D_PORT || 8765); // set JS3D_PORT when two checkouts run the tests at once
const chromiumArgs = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]; // WebGL without a GPU, as the author's scripts ran

const MOBILE = /mobile\.spec\.mjs/; // its own project: the phone budget needs a phone profile, a throttled link and a gzip server
// CI shards `npm test` over four runners; the chat judge's 8-minute clock is shared by both builds, so it runs in one job of its own (JS3D_SKIP_CHATJUDGE=1 leaves it out of the shards)
const BUILDS_IGNORE = process.env.JS3D_SKIP_CHATJUDGE ? [MOBILE, /chatjudge\.spec\.mjs/] : MOBILE;

export default defineConfig({
  testDir: "test",
  testMatch: /.*\.spec\.mjs/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // every page loads and compiles the 7 MB kernel; one at a time is faster overall
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // a service worker would answer page.reload() from its cache; test/load.spec.mjs allows one in its own context
  use: { viewport: { width: 1400, height: 880 }, launchOptions: { args: chromiumArgs }, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "site", testIgnore: BUILDS_IGNORE, use: { baseURL: `http://127.0.0.1:${base}/` } },
    { name: "single", testIgnore: BUILDS_IGNORE, use: { baseURL: pathToFileURL("dist/jumpstart-3d.html").href } },
    {
      name: "mobile", // port base + 2: 8766 is the single-file preview in .claude/launch.json
      testMatch: MOBILE,
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 667 }, screen: { width: 375, height: 667 }, baseURL: `http://127.0.0.1:${base + 2}/` },
    },
  ],
  webServer: [
    { command: `node test/serve.mjs docs ${base}`, url: `http://127.0.0.1:${base}/`, reuseExistingServer: true },
    { command: `node test/serve.mjs docs ${base + 2} gzip`, url: `http://127.0.0.1:${base + 2}/`, reuseExistingServer: true },
  ],
});
