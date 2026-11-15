/* HydroWatch Global service worker.
   - App shell: stale-while-revalidate (instant load, updates arrive on the next visit).
   - /api/region: network-first, falling back to the last good response (works offline for regions already opened).
   - Map tiles: stale-while-revalidate with a size cap.
   Bump VERSION to force clients to drop all old caches. */
const VERSION = "hw-v4";
const SHELL = `${VERSION}-shell`, DATA = `${VERSION}-data`, TILES = `${VERSION}-tiles`;
const MAX_DATA = 150, MAX_TILES = 400;
const SHELL_FILES = [
  "/", "/index.html", "/manifest.webmanifest", "/css/style.css",
  "/js/app.js", "/js/analysis.js", "/js/catalog.js", "/js/icons.js", "/js/learn.js", "/js/report.js", "/js/sites.js", "/js/stats.js",
  "/vendor/leaflet.min.js", "/vendor/leaflet.min.css", "/vendor/chart.umd.min.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg", "/icons/favicon-32.png", "/icons/apple-touch-icon.png",
];
const TILE_HOSTS = ["server.arcgisonline.com", "tile.openstreetmap.org"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]); // oldest first
}

async function staleWhileRevalidate(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: cacheName === SHELL });
  const net = fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) { cache.put(req, res.clone()).then(() => max && trim(cacheName, max)); }
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
}

async function networkFirstData(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) { cache.put(req, res.clone()).then(() => trim(DATA, MAX_DATA)); }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response(JSON.stringify({ error: "You are offline and this region has not been opened before, so it is not saved on this device." }),
      { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname === "/api/region") return e.respondWith(networkFirstData(req));
    if (url.pathname.startsWith("/api/")) return; // health etc: always live
    if (req.mode === "navigate") {
      return e.respondWith(staleWhileRevalidate(new Request("/index.html"), SHELL).then((r) => (r.ok ? r : fetch(req))));
    }
    return e.respondWith(staleWhileRevalidate(req, SHELL));
  }
  if (TILE_HOSTS.includes(url.hostname)) e.respondWith(staleWhileRevalidate(req, TILES, MAX_TILES));
});
