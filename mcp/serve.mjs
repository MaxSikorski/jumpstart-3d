// A tiny static file server for headless mode: serves a folder (the built site, docs/) on 127.0.0.1 and nothing else.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, resolve, sep, extname } from "node:path";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/octet-stream", ".png": "image/png", ".json": "application/json" };

// Starts on a free port. Resolves to { url, close() }.
export function serve(dir) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let file;
    try { file = resolve(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname))); } catch { res.writeHead(400); res.end("bad request"); return; }
    try {
      if (file !== root && !file.startsWith(root + sep)) throw new Error("outside");
      if (statSync(file).isDirectory()) file = join(file, "index.html");
      statSync(file);
    } catch { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) }));
  });
}
