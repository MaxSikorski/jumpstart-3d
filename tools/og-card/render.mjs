// Render card.html (the link-preview card) to a 1200x630 PNG with whatever Chromium-based
// browser is installed. No dependencies. The text is HTML so it can be edited without an image model.
// card.html expects the background artwork at art/og-art.png (1536x1024, text-free, made once with
// gpt-image-2). It is not kept in the repo to save 1.5 MB; re-generate a similar one (blue CAD
// bracket on light drafting paper, left third empty) before re-rendering. The finished card is
// committed as src/og-image.png.
// usage: node tools/og-card/render.mjs [out.png]   (default: src/og-image.png, then run node build.mjs)
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || resolve(here, "..", "..", "src", "og-image.png"));
const page = "file://" + resolve(here, "card.html");
const browsers = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const bin = browsers.find(existsSync);
if (!bin) throw new Error("no Chromium-based browser found");
const r = spawnSync(bin, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
  "--window-size=1200,630", "--virtual-time-budget=8000", // lets the web fonts arrive
  "--screenshot=" + out, page,
], { stdio: "pipe", encoding: "utf8", timeout: 60000 });
if (r.status !== 0 && !existsSync(out)) throw new Error("render failed: " + r.stderr);
console.log("wrote", out, Math.round(statSync(out).size / 1024) + " KB");
