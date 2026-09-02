import app from "./standings-worker.js";

const RELEASE = "public-read-resilient-v3";
const CORS_MARKER = "public-get-v3";

function applyPublicReadCors(request, response) {
  const requestedMethod = String(request.headers.get("access-control-request-method") || "").toUpperCase();
  const publicRead = request.method === "GET" || (request.method === "OPTIONS" && requestedMethod === "GET");
  if (!publicRead) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("x-localbleachers-api-cors", CORS_MARKER);
  headers.set("x-localbleachers-api-release", RELEASE);
  headers.delete("vary");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function edgeCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch {
    return null;
  }
}

function rounded(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "na";
}

function dateBucket(value) {
  const raw = String(value || "").trim();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "na";
}

function descriptor(origin, basePath, freshTtl, staleTtl) {
  return {
    freshKey: new Request(`${origin}/__localbleachers_cache__/fresh${basePath}`),
    staleKey: new Request(`${origin}/__localbleachers_cache__/last-good${basePath}`),
    freshTtl,
    staleTtl
  };
}

function cacheDescriptor(request) {
  if (request.method !== "GET") return null;
  if (request.headers.has("x-localbleachers-debug") || request.headers.has("x-localbleachers-diagnostic")) return null;

  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;

  if (path === "/api/v1/schools") {
    return descriptor(origin, "/schools", 6 * 60 * 60, 48 * 60 * 60);
  }

  if (path === "/api/v1/games") {
    const lat = rounded(url.searchParams.get("lat"));
    const lon = rounded(url.searchParams.get("lon"));
    const radius = rounded(url.searchParams.get("radius"), 1);
    const since = dateBucket(url.searchParams.get("since"));
    const until = dateBucket(url.searchParams.get("until"));
    const query = `lat=${lat}&lon=${lon}&radius=${radius}&since=${since}&until=${until}`;
    return descriptor(origin, `/games?${query}`, 5 * 60, 12 * 60 * 60);
  }

  const teamMatch = path.match(/^\/api\/v1\/teams\/[^/]+(?:\/(schedule|record))?$/);
  if (teamMatch) {
    const kind = teamMatch[1] || "team";
    const freshTtl = kind === "record" ? 5 * 60 : kind === "schedule" ? 15 * 60 : 60 * 60;
    return descriptor(origin, path, freshTtl, 24 * 60 * 60);
  }

  if (path === "/api/v1/standings" || path === "/api/v1/standings/options") {
    const sport = encodeURIComponent(String(url.searchParams.get("sport") || ""));
    const conference = encodeURIComponent(String(url.searchParams.get("conference") || ""));
    return descriptor(origin, `${path}?sport=${sport}&conference=${conference}`, 15 * 60, 12 * 60 * 60);
  }

  return null;
}

function cachedResponse(request, cached, { stale = false } = {}) {
  const headers = new Headers(cached.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-localbleachers-cache-source", stale ? "last-good" : "edge-fresh");
  if (stale) headers.set("x-localbleachers-api-stale", "1");
  else headers.delete("x-localbleachers-api-stale");
  const response = new Response(cached.body, {
    status: 200,
    statusText: "OK",
    headers
  });
  return applyPublicReadCors(request, response);
}

async function readCached(cache, key, request, options = {}) {
  const cached = await cache.match(key);
  return cached ? cachedResponse(request, cached, options) : null;
}

async function staleRead(cache, descriptor, request) {
  return readCached(cache, descriptor.staleKey, request, { stale: true });
}

async function putCached(cache, key, response, ttl, source) {
  const copy = response.clone();
  const headers = new Headers(copy.headers);
  headers.set("cache-control", `public, max-age=${ttl}`);
  headers.set("x-localbleachers-cache-source", source);
  headers.delete("x-localbleachers-api-stale");
  headers.delete("set-cookie");
  headers.delete("vary");
  await cache.put(key, new Response(copy.body, {
    status: copy.status,
    statusText: copy.statusText,
    headers
  }));
}

async function rememberSuccessfulRead(cache, descriptor, response) {
  await Promise.all([
    putCached(cache, descriptor.freshKey, response, descriptor.freshTtl, "live"),
    putCached(cache, descriptor.staleKey, response, descriptor.staleTtl, "last-good")
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const descriptor = cacheDescriptor(request);
    const cache = descriptor ? edgeCache() : null;

    if (descriptor && cache) {
      try {
        const fresh = await readCached(cache, descriptor.freshKey, request);
        if (fresh) return fresh;
      } catch (error) {
        console.warn("public fresh cache read failed", error);
      }
    }

    const response = applyPublicReadCors(request, await app.fetch(request, env, ctx));

    if (descriptor && cache && response.ok) {
      const write = rememberSuccessfulRead(cache, descriptor, response).catch(error => {
        console.warn("public read cache write failed", error);
      });
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
      else await write;
      return response;
    }

    if (descriptor && cache && response.status >= 500) {
      try {
        const stale = await staleRead(cache, descriptor, request);
        if (stale) return stale;
      } catch (error) {
        console.warn("public last-good cache fallback failed", error);
      }
    }

    return response;
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
