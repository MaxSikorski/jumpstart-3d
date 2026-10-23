// A small static server that stands in for GitHub Pages (gzip for html/js/wasm, application/wasm, max-age=600, weak ETags
// with 304). Shared by tools/measure-load.mjs and tools/lighthouse.mjs. startServer(dir) resolves { origin, close }.
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png" };
const zipped = /\.(html|js|wasm)$/;

export async function startServer(dir) {
  const cache = new Map();
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
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); server.closeAllConnections(); } };
}
