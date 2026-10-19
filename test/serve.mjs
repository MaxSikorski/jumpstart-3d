// Tiny static file server for the test runs: node test/serve.mjs <dir> <port>
// Playwright starts it for docs/ (the site); the single file is opened from disk.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

const [dir, port] = [process.argv[2], +process.argv[3]];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/octet-stream", ".png": "image/png", ".json": "application/json" };
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dir, path);
  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); statSync(file); }
  catch { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}/`));
