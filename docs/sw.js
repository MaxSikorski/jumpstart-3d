// jumpstart-3d: offline. The hosted site's service worker: keeps the page, the app, the worker and the geometry engine on this computer, so the next visit opens at once and works without a connection.
// Never remove sw.js from the site: a 404 on the update check keeps the old worker serving its cache forever; to retire it, publish a sw.js that calls self.registration.unregister().
const VERSION = "f7110f5776"; // build.mjs replaces this line with a hash of the four files below
const CACHE = "jumpstart-3d-" + VERSION;
const FILES = ["./", "app.js", "worker.js", "occt-gz.wasm"];
const urls = () => FILES.map((f) => new URL(f, self.registration.scope).href);
self.addEventListener("install", (e) => {
  self.skipWaiting();
  // "no-cache": revalidate against the browser's HTTP cache (Pages answers 304 with no body for files just downloaded)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(urls().map((u) => new Request(u, { cache: "no-cache" })))));
});
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) =>
  Promise.all(keys.filter((k) => k.startsWith("jumpstart-3d-") && k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return; // fonts, chat model APIs: untouched (the agent WebSocket never reaches a service worker)
  let key = url.origin + url.pathname; // a query string (link previews) does not matter
  if (req.mode === "navigate" && key === scope.href + "index.html") key = scope.href;
  if (!urls().includes(key)) return; // og-image.png, sw.js itself: the network as usual
  e.respondWith(caches.match(key, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});
