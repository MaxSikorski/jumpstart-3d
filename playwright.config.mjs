// Regression harness: the same tests run against the site build (docs/, served on port 8765, or JS3D_PORT) and the
// single file (dist/jumpstart-3d.html, opened from disk as users open it). npm test builds first.
// npm test            both builds
// npm run test:site   docs/ only        npm run test:single   dist/ only
// npm run test:update re-records test/golden.json after an intended geometry change
// npm run test:mobile the phone budget only (test/mobile.spec.mjs: its own project, with a gzip server on port + 2)
// JS3D_CROSS=1 adds the Firefox and WebKit projects (site-firefox, single-firefox, site-webkit, single-webkit); the nightly workflow sets it,
// and the browsers need `npx playwright install firefox webkit`. They are left out otherwise, so `npm test` stays Chromium only.
// PLAYWRIGHT_JSON_OUTPUT_NAME=<file> also writes a JSON report there (the nightly workflow reads it to list the failing specs).
import { defineConfig, devices } from "@playwright/test";
import { pathToFileURL } from "node:url";

const base = +(process.env.JS3D_PORT || 8765); // set JS3D_PORT when two checkouts run the tests at once
const chromiumArgs = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]; // WebGL without a GPU, as the author's scripts ran

const MOBILE = /mobile\.spec\.mjs/; // its own project: the phone budget needs a phone profile, a throttled link and a gzip server
// CI shards `npm test` over parallel runners. Two specs run whole in jobs of their own and are left out of the shards:
// the chat judge (its 8-minute mock clock is shared by both builds, so one runner must hold both) with JS3D_SKIP_CHATJUDGE=1,
// and the golden exports (the export judge job writes and judges them) with JS3D_SKIP_GOLDEN=1. Only the value 1 counts.
const BUILDS_IGNORE = [MOBILE];
if (process.env.JS3D_SKIP_CHATJUDGE === "1") BUILDS_IGNORE.push(/chatjudge\.spec\.mjs/);
if (process.env.JS3D_SKIP_GOLDEN === "1") BUILDS_IGNORE.push(/golden\.spec\.mjs/);

const CROSS = process.env.JS3D_CROSS === "1";
// Firefox on a Linux runner has no WebGL in headless unless it is forced on (it then uses Mesa's software renderer, installed by the nightly workflow)
const firefoxPrefs = { "webgl.force-enabled": true, "webgl.disable-fail-if-major-performance-caveat": true };
const crossProject = (build, browser, baseURL) => ({
  name: `${build}-${browser}`,
  testIgnore: BUILDS_IGNORE,
  use: { ...devices[browser === "firefox" ? "Desktop Firefox" : "Desktop Safari"], viewport: { width: 1400, height: 880 }, launchOptions: browser === "firefox" ? { firefoxUserPrefs: firefoxPrefs } : {}, baseURL },
});
const singleURL = pathToFileURL("dist/jumpstart-3d.html").href;

export default defineConfig({
  testDir: "test",
  testMatch: /.*\.spec\.mjs/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // every page loads and compiles the 7 MB kernel; one at a time is faster overall
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }], ...(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [["json"]] : [])],
  // a service worker would answer page.reload() from its cache; test/load.spec.mjs allows one in its own context
  use: { viewport: { width: 1400, height: 880 }, launchOptions: { args: chromiumArgs }, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "site", testIgnore: BUILDS_IGNORE, use: { baseURL: `http://127.0.0.1:${base}/` } },
    { name: "single", testIgnore: BUILDS_IGNORE, use: { baseURL: singleURL } },
    ...(CROSS
      ? ["firefox", "webkit"].flatMap((b) => [crossProject("site", b, `http://127.0.0.1:${base}/`), crossProject("single", b, singleURL)])
      : []),
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
