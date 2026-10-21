// Times a page load of a built copy of the site on a simulated 10 Mbit / 40 ms connection.
//   node tools/measure-load.mjs [dir=docs] [runs=3]
// A small static server stands in for GitHub Pages (gzip for html/js/wasm, application/wasm, max-age=600, weak ETags
// with 304). Every run starts a new browser and visits twice in the same page. If <dir>/sw.js exists, the run waits
// for the service worker to take over between the visits. Columns, in milliseconds from the start of the visit:
//   DOMContentLoaded   the page's own scripts are loaded and have run
//   workspace usable   the loading splash is gone or fading and no longer blocks the mouse
//   kernel ready       the geometry engine can build shapes
// network bytes: what the page itself fetched over the network from this server in that visit (answers from the
// service worker or the browser cache count as zero; the service worker's own downloads are printed on a line below,
// because Chromium's throttle does not slow them). Within 10 minutes of a first visit the browser's own cache serves a second visit even
// without a service worker, so the second-visit row only differs clearly after 10 minutes or offline.
// To compare: build the old version into a folder, run this on it, then run it on docs/ after node build.mjs.
import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const dir = resolve(process.argv[2] || "docs");
const runs = +(process.argv[3] || 3);
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png" };
const zipped = /\.(html|js|wasm)$/, cache = new Map();

const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  let file = join(dir, p);
  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); statSync(file); } catch { res.writeHead(404); res.end(); return; }
  const st = statSync(file);
  const h = { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "max-age=600", vary: "Accept-Encoding",
    etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
  if (req.headers["if-none-match"] === h.etag) { res.writeHead(304, h); res.end(); return; }
  let body = cache.get(file) || readFileSync(file); cache.set(file, body);
  if (zipped.test(file) && /gzip/.test(req.headers["accept-encoding"] || "")) {
    const k = file + "#gz"; let z = cache.get(k); if (!z) { z = gzipSync(body, { level: 6 }); cache.set(k, z); }
    body = z; h["content-encoding"] = "gzip";
  }
  h["content-length"] = body.length;
  res.writeHead(200, h); res.end(body);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const hasSW = existsSync(join(dir, "sw.js"));
const results = [];
let version = "";

for (let i = 0; i < runs; i++) {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  version = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 }, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__t = {};
    try { localStorage.setItem("jumpstart.chisel.intro", "1"); } catch {}
    document.addEventListener("DOMContentLoaded", () => { window.__t.dcl = performance.now(); });
    const poll = setInterval(() => {
      const n = performance.now(), t = window.__t, a = window.__app, l = document.getElementById("loading");
      if (!t.usable && l && (l.hidden || l.classList.contains("done"))) t.usable = n;
      if (!t.ready && a && a.kernel && a.kernel.ready) t.ready = n;
      if (t.usable && t.ready) clearInterval(poll);
    }, 20);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, downloadThroughput: 1250000, uploadThroughput: 1250000, latency: 40 });

  let phase = "first";
  const bytes = { first: 0, between: 0, second: 0 }, sw = { n: 0 };
  ctx.on("requestfinished", async (req) => {
    try {
      if (!req.url().startsWith(origin)) return;
      const res = await req.response();
      if (!res || res.fromServiceWorker()) return;
      const p = phase, size = (await req.sizes()).responseBodySize;
      if (req.serviceWorker()) sw.n += size; else bytes[p] += size;
    } catch {} // the browser closed before the size came back
  });

  const visit = async () => {
    await page.waitForFunction(() => window.__t && window.__t.usable && window.__t.ready, null, { timeout: 180_000, polling: 100 });
    return page.evaluate(() => ({ dcl: window.__t.dcl, usable: window.__t.usable, ready: window.__t.ready }));
  };
  await page.goto(origin + "/", { waitUntil: "commit" });
  const first = await visit();
  phase = "between";
  if (hasSW) {
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", null, { timeout: 30_000, polling: 200 });
    await page.waitForTimeout(500);
  }
  phase = "second";
  await page.goto(origin + "/", { waitUntil: "commit" });
  const second = await visit();
  await page.waitForTimeout(300); // let the last responses report their sizes
  phase = "after";
  const r = { first: { ...first, bytes: bytes.first }, second: { ...second, bytes: bytes.second }, sw: sw.n };
  results.push(r);
  console.log(`run ${i + 1}: ` + JSON.stringify({ first: r.first, second: r.second, serviceWorkerBytes: r.sw }, (k, v) => (typeof v === "number" ? Math.round(v) : v)));
  await browser.close();
}
server.close(); server.closeAllConnections();

console.log(`\nChromium ${version}, ${dir}, ${runs} runs, median, 10 Mbit / 40 ms${hasSW ? ", service worker present" : ""}\n`);
console.log("| visit | DOMContentLoaded ms | workspace usable ms | kernel ready ms | network bytes |");
console.log("|---|---|---|---|---|");
for (const v of ["first", "second"]) {
  const m = (k) => Math.round(med(results.map((r) => r[v][k])));
  console.log(`| ${v} visit | ${m("dcl")} | ${m("usable")} | ${m("ready")} | ${m("bytes").toLocaleString("en-US")} |`);
}
if (hasSW) console.log(`\nThe service worker's own downloads (median, not in the table): ${Math.round(med(results.map((r) => r.sw))).toLocaleString("en-US")} bytes`);
