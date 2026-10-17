// Builds JumpStart 3D from src/ into:
//   docs/                 the GitHub Pages site (split files, fast to load)
//   dist/jumpstart-3d.html one self-contained file, works offline from disk
//
//   node build.mjs
//
// src/app.js holds the app bundle with three placeholders where the helper
// pages (src/tools/*.html) get embedded as template literals. The site keeps
// the helper pages' three.js as shared vendor files; the single-file build
// inlines them back.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const src = join(root, "src");
const docs = join(root, "docs");
const dist = join(root, "dist");
const read = (p) => readFileSync(join(src, p), "utf8");

// Escape text for use inside a JS template literal that also lives inside an
// HTML <script> element.
const toLiteral = (text) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/<\/script/gi, "<\\/script");

const inlineVendor = (html) =>
  html.replace(/<script src="(vendor\/[^"]+)"><\/script>/g, (_, p) => "<script>" + read(p) + "</script>");

function assembleApp({ inline }) {
  let app = read("app.js");
  app = app.replace(/__JS3D_EMBED:([\w./-]+)__/g, (_, p) => {
    let html = read(p);
    if (inline) html = inlineVendor(html);
    return toLiteral(html);
  });
  if (/__JS3D_EMBED:/.test(app)) throw new Error("unresolved embed placeholder");
  return app;
}

const shell = read("index.html");
const appTag = '<script type="module" src="app.js"></script>\n';
if (!shell.includes(appTag)) throw new Error("index.html is missing the app.js script tag");

// ---------- site ----------
rmSync(docs, { recursive: true, force: true });
mkdirSync(join(docs, "vendor"), { recursive: true });
writeFileSync(join(docs, "index.html"), shell);
writeFileSync(join(docs, "app.js"), assembleApp({ inline: false }));
cpSync(join(src, "worker.js"), join(docs, "worker.js"));
cpSync(join(src, "occt-gz.wasm"), join(docs, "occt-gz.wasm"));
cpSync(join(src, "vendor"), join(docs, "vendor"), { recursive: true });
cpSync(join(src, "og-image.png"), join(docs, "og-image.png")); // link-preview card; the meta tags in index.html point here
writeFileSync(join(docs, ".nojekyll"), "");

// ---------- single file ----------
mkdirSync(dist, { recursive: true });
const wasmB64 = readFileSync(join(src, "occt-gz.wasm")).toString("base64");
// Note: replacement callbacks everywhere, since a replacement *string* would
// interpret "$'" and "$$" inside the code being inserted.
const single = shell.replace(
  appTag,
  () =>
    '<script type="text/plain" id="wp-worker-src">' + read("worker.js") + "</script>\n" +
    '<script type="text/plain" id="wp-occt">' + wasmB64 + "</script>\n" +
    '<script type="module">' + assembleApp({ inline: true }) + "</script>\n"
);
writeFileSync(join(dist, "jumpstart-3d.html"), single);

const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log("docs/index.html + app.js:", mb(shell.length + assembleApp({ inline: false }).length));
console.log("dist/jumpstart-3d.html:", mb(Buffer.byteLength(single)));
