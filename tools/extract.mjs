// Turns an upstream single-file build of JumpStart 3D into the src/ tree
// that build.mjs assembles back into a site and a single-file download.
// Run it again whenever a new upstream file appears, then re-apply our own
// additions with tools/add-obj-export.mjs.
//
//   node tools/extract.mjs <path-to-upstream.html>
//
// Known upstream builds: v1.91, v1.93.8.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , input] = process.argv;
if (!input) {
  console.error("usage: node tools/extract.mjs <original.html>");
  process.exit(1);
}
const s = readFileSync(input, "utf8");
const root = new URL("../src/", import.meta.url).pathname;
for (const d of ["", "tools", "vendor"]) mkdirSync(join(root, d), { recursive: true });

// ---------- carve out the big blocks ----------
const between = (startTag, endTag, from = 0) => {
  const a = s.indexOf(startTag, from);
  if (a < 0) throw new Error("missing " + startTag);
  const b = s.indexOf(endTag, a + startTag.length);
  if (b < 0) throw new Error("missing end for " + startTag);
  return { start: a, bodyStart: a + startTag.length, bodyEnd: b, end: b + endTag.length };
};

const worker = between('<script type="text/plain" id="wp-worker-src">', "</script>");
const occt = between('<script type="text/plain" id="wp-occt">', "</script>", worker.end);
const mod = between('<script type="module">', "</script>", occt.end);
if (s.indexOf("</script>", mod.end) !== -1) throw new Error("unexpected extra script after module");

const shellHead = s.slice(0, worker.start);
const shellTail = s.slice(mod.end);

// ---------- worker + wasm ----------
writeFileSync(join(root, "worker.js"), s.slice(worker.bodyStart, worker.bodyEnd));
const gz = Buffer.from(s.slice(occt.bodyStart, occt.bodyEnd).trim(), "base64");
if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error("wasm payload is not gzip");
writeFileSync(join(root, "occt-gz.wasm"), gz);
console.log("worker.js", worker.bodyEnd - worker.bodyStart, "bytes; occt-gz.wasm", gz.length, "bytes");

// ---------- module bundle: lift the embedded helper pages out ----------
let app = s.slice(mod.bodyStart, mod.bodyEnd);

// Find the end of a template literal that starts at index i (just after the
// opening backtick): the first backtick not preceded by an odd run of backslashes.
function literalEnd(str, i) {
  let j = i;
  for (;;) {
    j = str.indexOf("`", j);
    if (j < 0) throw new Error("unterminated literal");
    let bs = 0;
    for (let t = j - 1; str[t] === "\\"; t--) bs++;
    if (bs % 2 === 0) return j;
    j++;
  }
}
// Cook a template literal body (resolve escapes) the same way the engine does.
const cook = (raw) => new Function("return `" + raw + "`")();

// The helper pages are template literals whose minified variable names change
// from build to build, so find them by the page <title> instead.
const pages = [
  { title: "<title>FlexiGen</title>", file: "tools/flexi.html", three: "vendor/three.r169.js" },
  { title: "<title>Mesh to Step Helper</title>", file: "tools/meshstep.html", three: "vendor/three.r169-orbit.js" },
  { title: "<title>Chisel", file: "tools/chisel.html", three: "vendor/three.r169.js" },
];
const vendorWritten = new Map();
let cursor = 0;
let out = "";
for (const p of pages) {
  const t = app.indexOf(p.title, cursor);
  if (t < 0) throw new Error("missing " + p.title);
  const m = /var ([\w$]+)=`[^`]*$/.exec(app.slice(cursor, t));
  if (!m) throw new Error(p.file + ": title is not inside a var=` literal");
  p.v = m[1];
  const a = cursor + m.index;
  const bodyStart = a + m[0].indexOf("`") + 1;
  const bodyEnd = literalEnd(app, bodyStart);
  const raw = app.slice(bodyStart, bodyEnd);
  if (/(?<!\\)\$\{/.test(raw)) throw new Error(p.v + " has live interpolation");
  let html = cook(raw);

  // Replace the inlined three.js build (first <script> in the page) with a
  // reference to a shared vendor file.
  const st = html.indexOf("<script>");
  const se = html.indexOf("</script>", st);
  const lib = html.slice(st + "<script>".length, se);
  if (!/window\.THREE=/.test(lib)) throw new Error(p.v + ": first script is not three.js");
  const prev = vendorWritten.get(p.three);
  if (prev && prev !== lib) throw new Error("vendor mismatch for " + p.three);
  if (!prev) {
    writeFileSync(join(root, p.three), lib);
    vendorWritten.set(p.three, lib);
  }
  html = html.slice(0, st) + `<script src="${p.three}"></script>` + html.slice(se + "</script>".length);
  writeFileSync(join(root, p.file), html);
  console.log(p.file, "(var " + p.v + ")", html.length, "chars; three.js", lib.length, "chars ->", p.three);

  out += app.slice(cursor, bodyStart) + `__JS3D_EMBED:${p.file}__`;
  cursor = bodyEnd;
}
out += app.slice(cursor);
app = out;

// ---------- small runtime patches ----------
const patch = (from, to, label) => {
  const n = app.split(from).length - 1;
  if (n !== 1) throw new Error(`patch "${label}": expected 1 match, found ${n}`);
  app = app.replace(from, () => to);
};
// Load the worker as a classic script when served from URLs (it is an IIFE,
// not an ES module).
patch(
  'workerUrl:new URL("worker.js",location.href)}',
  'workerUrl:new URL("worker.js",location.href),workerType:"classic"}',
  "classic worker"
);
// "Open in a new tab" turns the helper page into a blob: URL, where relative
// vendor paths would no longer resolve. Make them absolute first.
const mesh = pages[1].v;
patch(
  `new Blob([${mesh}],{type:"text/html"})`,
  `new Blob([${mesh}.replace(/ src="vendor\\//g," src=\\""+new URL("vendor/",location.href).href)],{type:"text/html"})`,
  "absolute vendor url for new tab"
);

writeFileSync(join(root, "app.js"), app);
console.log("app.js", app.length, "chars");

// ---------- shell ----------
let shell = shellHead + '<script type="module" src="app.js"></script>\n' + shellTail;
writeFileSync(join(root, "index.html"), shell);
console.log("index.html", shell.length, "chars");
