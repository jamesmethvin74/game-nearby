const CACHE_NAME = "localbleachersar-shell-v60";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./teams.html",
  "./standings.html",
  "./live-scores.html",
  "./manifest.json",
  "./styles.css",
  "./polish.css",
  "./brand-exact.css",
  "./pitched-layout.css",
  "./reference-layout.css",
  "./teams-page.css",
  "./standings.css",
  "./live-scores.css",
  "./app.js",
  "./school-expansion.js",
  "./school-ticket-links.js",
  "./school-follow-logic.js",
  "./polish.js",
  "./pitched-layout.js",
  "./reference-layout.js",
  "./team-detail.js",
  "./live-data.js",
  "./live-resilience.js",
  "./teams-catalog-bootstrap.js",
  "./school-schedule.js",
  "./school-logo-ui.js",
  "./teams-page.js",
  "./standings.js",
  "./live-scores.js",
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

  // Do not proxy requests to the sports API (or any other external origin)
  // through the PWA service worker. Let the browser perform the normal CORS
  // request directly. The service worker only owns the LocalBleachersAR shell.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const isTeams = /\/teams(?:\.html)?\/?$/.test(requestUrl.pathname);
    const isStandings = /\/standings(?:\.html)?\/?$/.test(requestUrl.pathname);
    const isLiveScores = /\/live-scores(?:\.html)?\/?$/.test(requestUrl.pathname);
    const cacheKey = isTeams
      ? "./teams.html"
      : isStandings
        ? "./standings.html"
        : isLiveScores
          ? "./live-scores.html"
          : "./index.html";
    const network = fetch(event.request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, response.clone());
      }
      return response;
    });

    event.waitUntil(network.catch(() => undefined));
    event.respondWith((async () => {
      const cached = await caches.match(cacheKey, {ignoreSearch:true});
      if (cached) return cached;
      try {
        return await network;
      } catch {
        return new Response("Offline", {status: 503, headers: {"Content-Type": "text/plain"}});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request, {ignoreSearch:true});
      if (cached) return cached;
      return new Response("Offline", {status: 503, headers: {"Content-Type": "text/plain"}});
    }
  })());
});