// Builds JumpStart 3D from the readable source in src/ into:
//   docs/                  the GitHub Pages site (app, worker and kernel as separate files)
//   dist/jumpstart-3d.html one self-contained file, works offline from disk
//
//   npm install   (once; installs the pinned esbuild)
//   node build.mjs
//
// This is the author's app/dist.sh + app/standalone.py from the v2.0 source
// release, written in Node. The helper pages (src/flexigen.html,
// src/meshstep.html, src/chisel.html) are committed already built; see
// tools/helpers/README.md to regenerate them.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto"; // jumpstart-3d: offline
import { gzipSize, checkBudget } from "./tools/size-budget.mjs"; // jumpstart-3d: size budget

const root = new URL(".", import.meta.url).pathname;
const src = join(root, "src");
const tp = join(root, "third_party");
const docs = join(root, "docs");
const dist = join(root, "dist");
const out = join(root, "build");

const alias = {
  replicad: join(tp, "replicad/src/index.ts"),
  "replicad/shape-functions": join(tp, "replicad/src/shapeFunctions/index.ts"),
  "opentype.js": join(tp, "opentype.js/dist/opentype.module.js"),
  flatbush: join(tp, "flatbush/index.js"),
  flatqueue: join(tp, "flatqueue/index.js"),
  "manifold-3d": join(tp, "manifold-3d/index.js"),
  "replicad-opencascadejs": join(tp, "replicad-opencascadejs/dist/replicad_single.js"),
  three: join(tp, "three/build/three.module.js"),
};
const common = { bundle: true, minify: true, legalComments: "eof", target: "es2020", alias, logLevel: "warning" };

const wasm = join(src, "occt-gz.wasm");
const wasmSize = statSync(wasm).size; // the loading bar's total

rmSync(out, { recursive: true, force: true });
await build({ ...common, entryPoints: [join(src, "app.js")], format: "esm", outfile: join(out, "app.js"),
  loader: { ".html": "text" }, define: { __WASM_PARTS__: JSON.stringify([{ url: "occt-gz.wasm", gz: true, size: wasmSize }]) } });
await build({ ...common, entryPoints: [join(src, "worker.js")], format: "esm", outfile: join(out, "worker.js"), external: ["node:*"] });
await build({ ...common, entryPoints: [join(src, "worker.js")], format: "iife", outfile: join(out, "worker.iife.js"), external: ["node:*"],
  logOverride: { "empty-import-meta": "silent" } }); // the loader's import.meta.url is never used in the single file

const read = (p) => readFileSync(p, "utf8");
const shell = read(join(src, "index.html"));
const appTag = '<script type="module" src="app.js"></script>\n';
if (!shell.includes(appTag)) throw new Error("src/index.html is missing the app.js script tag");
// jumpstart-3d: a manifest belongs to the hosted site, not the single file
const manifestLink = '<link rel="manifest" href="manifest.webmanifest">';
if (!shell.includes(manifestLink)) throw new Error('src/index.html is missing href="manifest.webmanifest"');
// jumpstart-3d: tab icons inline in the single file (the site links them as files)
const icons = [["favicon.svg", "image/svg+xml"], ["favicon-32.png", "image/png"], ["apple-touch-icon.png", "image/png"]];
const appIcons = ["icon-192.png", "icon-512.png"];
const dataUri = (f, mime) => "data:" + mime + ";base64," + readFileSync(join(src, f)).toString("base64");
for (const [f] of icons) if (!shell.includes('href="' + f + '"')) throw new Error('src/index.html is missing href="' + f + '"');
const app = read(join(out, "app.js"));
const worker = read(join(out, "worker.iife.js"));
for (const s of [app, worker]) if (/<\/script/i.test(s)) throw new Error("a bundle contains </script>, which would end the inline block");

// jumpstart-3d: size budget. The gzipped app may grow 5 % over size-budget.json; node build.mjs --bump-budget records a deliberate growth.
const budgetFile = join(root, "size-budget.json");
const appGz = gzipSize(app);
if (process.argv.includes("--bump-budget")) { writeFileSync(budgetFile, JSON.stringify({ "docs/app.js gzip bytes": appGz }, null, 2) + "\n"); console.log("size budget recorded:", appGz); }
else {
  let recorded;
  try { recorded = JSON.parse(read(budgetFile))["docs/app.js gzip bytes"]; } catch (e) {}
  const verdict = checkBudget(appGz, recorded);
  if (!verdict.ok) throw new Error(verdict.message);
  console.log("size budget ok:", verdict.message);
}

// jumpstart-3d: self-hosted fonts (src/fonts/*.woff2, rules in src/webfonts.css). The site serves docs/fonts/ and the rules sit in index.html; the single file carries the fonts as data: URIs, so neither makes a font request to anyone else.
const fontMarker = '<style id="js3d-fonts"></style>';
if (!shell.includes(fontMarker)) throw new Error('src/index.html is missing ' + fontMarker);
const fontCss = read(join(src, "webfonts.css"));
const fontFiles = readdirSync(join(src, "fonts")).filter((f) => f.endsWith(".woff2"));
for (const f of fontFiles) if (!fontCss.includes("url(fonts/" + f + ")")) throw new Error("src/webfonts.css has no rule for fonts/" + f);
const siteShell = shell.replace(fontMarker, () => '<style id="js3d-fonts">' + fontCss + "</style>");
const singleShell = shell.replace(fontMarker, () => '<style id="js3d-fonts">' + fontCss.replace(/url\(fonts\/([^)]+)\)/g, (_, f) => "url(" + dataUri("fonts/" + f, "font/woff2") + ")") + "</style>");

// ---------- site ----------
rmSync(docs, { recursive: true, force: true });
mkdirSync(docs, { recursive: true });
writeFileSync(join(docs, "index.html"), siteShell);
cpSync(join(src, "fonts"), join(docs, "fonts"), { recursive: true });
cpSync(join(root, "LICENSES", "OFL-1.1-fonts.txt"), join(docs, "fonts", "OFL.txt")); // the license travels with the fonts
writeFileSync(join(docs, "app.js"), app);
cpSync(join(out, "worker.js"), join(docs, "worker.js"));
cpSync(wasm, join(docs, "occt-gz.wasm"));
cpSync(join(src, "og-image.png"), join(docs, "og-image.png")); // link-preview card; the meta tags in index.html point here
for (const [f] of icons) cpSync(join(src, f), join(docs, f)); // tab icons; index.html links them
// jumpstart-3d: installable app assets
cpSync(join(src, "manifest.webmanifest"), join(docs, "manifest.webmanifest"));
for (const f of appIcons) cpSync(join(src, f), join(docs, f));
writeFileSync(join(docs, ".nojekyll"), "");
// jumpstart-3d: offline. the site's service worker; its cache name comes from the files it keeps, so every build gets its own cache. Not in the single file.
const swFonts = fontFiles.map((f) => "fonts/" + f); // the fonts are cached too, and part of the cache name
const swVersion = createHash("sha256").update(Buffer.concat(["index.html", "app.js", "worker.js", "occt-gz.wasm", ...swFonts].map((f) => readFileSync(join(docs, f))))).digest("hex").slice(0, 10);
const swSource = read(join(src, "sw.js"));
if (!swSource.includes('const VERSION = "dev";')) throw new Error('src/sw.js is missing the line const VERSION = "dev";');
if (!swSource.includes("const FONTS = [];")) throw new Error('src/sw.js is missing the line const FONTS = [];');
writeFileSync(join(docs, "sw.js"), swSource.replace('const VERSION = "dev";', () => `const VERSION = "${swVersion}";`).replace("const FONTS = [];", () => "const FONTS = " + JSON.stringify(swFonts) + ";"));

// ---------- single file ----------
mkdirSync(dist, { recursive: true });
const wasmB64 = readFileSync(wasm).toString("base64");
// Replacement callbacks everywhere: a replacement *string* would interpret "$'" and "$$" inside the code.
let single = singleShell.replace(
  appTag,
  () =>
    '<script type="text/plain" id="wp-worker-src">' + worker + "</script>\n" +
    '<script type="text/plain" id="wp-occt">' + wasmB64 + "</script>\n" +
    '<script type="module">' + app + "</script>\n"
);
for (const [f, mime] of icons) single = single.replace('href="' + f + '"', () => 'href="' + dataUri(f, mime) + '"');
single = single.replace(manifestLink, () => ""); // jumpstart-3d: a web manifest cannot be used from file://
writeFileSync(join(dist, "jumpstart-3d.html"), single);

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log("docs/app.js:", mb(app.length), " docs/worker.js:", mb(statSync(join(docs, "worker.js")).size), " docs/occt-gz.wasm:", mb(wasmSize));
console.log("dist/jumpstart-3d.html:", mb(Buffer.byteLength(single)), " (fonts inlined: " + mb(Buffer.byteLength(singleShell) - Buffer.byteLength(siteShell)) + ")");
console.log("docs/sw.js:", swVersion); // jumpstart-3d: offline
