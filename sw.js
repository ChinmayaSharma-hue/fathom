// Offline support: the app shell is served stale-while-revalidate, prompt data (URLs carry ?v=<bank
// version>) cache-first, data/index.json network-first. /api/* is never cached.
const CACHE = "fathom-v3";
const SHELL = ["./", "index.html", "style.css", "icon.svg", "manifest.webmanifest", "data/index.json", "js/coach.js", "js/scene.js", "js/sprites.js",
  "js/app.js", "js/api.js", "js/match.js", "js/norms.js", "js/daily.js", "js/rarity.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "GET" && /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {   // pixel fonts, offline too
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => put(e.request, r))));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/") || url.pathname.endsWith("/admin")) return;
  if (url.pathname.endsWith("data/index.json")) {
    e.respondWith(fetch(e.request).then((r) => put(e.request, r)).catch(() => caches.match(e.request)));
  } else if (url.pathname.includes("/data/q/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => put(e.request, r))));
  } else {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((r) => put(e.request, r)).catch(() => hit);
      return hit || net;
    }));
  }
});

async function put(req, res) {
  if (res.ok || res.type === "opaque") { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}
