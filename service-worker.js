const CACHE_NAME = "localbleachersar-shell-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./styles.css",
  "./polish.css",
  "./brand-exact.css",
  "./pitched-layout.css",
  "./reference-layout.css",
  "./app.js",
  "./school-expansion.js",
  "./school-ticket-links.js",
  "./school-follow-logic.js",
  "./polish.js",
  "./pitched-layout.js",
  "./reference-layout.js",
  "./assets/localbleachersar-icon.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && event.request.url.startsWith(self.location.origin)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request, {ignoreSearch:true});
      if (cached) return cached;
      if (event.request.mode === "navigate") return caches.match("./index.html");
      throw new Error("Network unavailable and no cached response.");
    }
  })());
});
