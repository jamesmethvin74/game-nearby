const CACHE_NAME = "localbleachersar-shell-v40";
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
  "./team-detail.js",
  "./live-data.js",
  "./assets/app-icon-192-v35.png",
  "./assets/app-icon-512-v35.png",
  "./assets/splash-logo-v35.webp"
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
      return new Response("Offline", {status: 503, headers: {"Content-Type": "text/plain"}});
    }
  })());
});
