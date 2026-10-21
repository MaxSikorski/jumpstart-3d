// Tiny static file server for the test runs: node test/serve.mjs <dir> <port> [gzip]
// Playwright starts it for docs/ (the site); the single file is opened from disk.
import { createServer } from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { gzipSync } from "node:zlib";

const [dir, port, mode] = [process.argv[2], +process.argv[3], process.argv[4]];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

// gzip mode imitates GitHub Pages for the phone budget (test/mobile.spec.mjs): html, js and wasm go out gzipped (level 6, as
// tools/measure-load.mjs) with a content-length. The key holds the size and mtime, so a server reused across a rebuild never serves the old build.
const gzipped = new Map();
const squeeze = (file, st) => {
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (!gzipped.has(key)) gzipped.set(key, gzipSync(readFileSync(file), { level: 6 }));
  return gzipped.get(key);
};
const compressible = (file) => [".html", ".js", ".wasm"].includes(extname(file));
const wantsGzip = (header = "") => header.split(",").some((part) => { const [token, ...params] = part.trim().split(";"); const q = params.map((p) => p.trim().match(/^q=([\d.]+)$/i)).find(Boolean); return token.trim().toLowerCase() === "gzip" && !(q && +q[1] === 0); });
const plain = (res, code, text) => { res.writeHead(code, mode === "gzip" ? { "content-length": Buffer.byteLength(text), vary: "accept-encoding" } : {}); res.end(text); };
if (mode === "gzip") { // compressed once before listen, so no compression happens inside a timed run
  for (const name of readdirSync(dir)) { const f = join(dir, name), st = statSync(f); if (st.isFile() && compressible(f)) squeeze(f, st); }
}

createServer((req, res) => {
  let path;
  try { path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, ""); } catch { plain(res, 400, "bad request"); return; }
  let file = join(dir, path), st;
  try { st = statSync(file); if (st.isDirectory()) { file = join(file, "index.html"); st = statSync(file); } }
  catch { plain(res, 404, "not found"); return; }
  const head = { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store", ...(mode === "gzip" ? { vary: "accept-encoding" } : {}) };
  if (mode === "gzip") {
    if (compressible(file) && wantsGzip(req.headers["accept-encoding"])) {
      const body = squeeze(file, st);
      res.writeHead(200, { ...head, "content-encoding": "gzip", "content-length": body.length });
      res.end(body);
    } else {
      res.writeHead(200, { ...head, "content-length": st.size });
      createReadStream(file).pipe(res);
    }
    return;
  }
  res.writeHead(200, head);
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}/${mode === "gzip" ? " (gzip)" : ""}`));
