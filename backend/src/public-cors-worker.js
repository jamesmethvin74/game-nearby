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

function cacheDescriptor(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;

  if (path === "/api/v1/schools") {
    return {
      key: new Request(`${origin}/__localbleachers_cache__/schools`),
      ttl: 24 * 60 * 60
    };
  }

  if (path === "/api/v1/games") {
    const lat = rounded(url.searchParams.get("lat"));
    const lon = rounded(url.searchParams.get("lon"));
    const radius = rounded(url.searchParams.get("radius"), 1);
    return {
      key: new Request(`${origin}/__localbleachers_cache__/games?lat=${lat}&lon=${lon}&radius=${radius}`),
      ttl: 6 * 60 * 60
    };
  }

  if (/^\/api\/v1\/teams\/[^/]+(?:\/(?:schedule|record))?$/.test(path)) {
    return {
      key: new Request(`${origin}/__localbleachers_cache__${path}`),
      ttl: 6 * 60 * 60
    };
  }

  if (path === "/api/v1/standings" || path === "/api/v1/standings/options") {
    const sport = encodeURIComponent(String(url.searchParams.get("sport") || ""));
    const conference = encodeURIComponent(String(url.searchParams.get("conference") || ""));
    return {
      key: new Request(`${origin}/__localbleachers_cache__${path}?sport=${sport}&conference=${conference}`),
      ttl: 6 * 60 * 60
    };
  }

  return null;
}

async function rememberSuccessfulRead(cache, descriptor, response) {
  const copy = response.clone();
  const headers = new Headers(copy.headers);
  headers.set("cache-control", `public, max-age=${descriptor.ttl}`);
  headers.set("x-localbleachers-cache-source", "live");
  headers.delete("set-cookie");
  headers.delete("vary");
  const cached = new Response(copy.body, {
    status: copy.status,
    statusText: copy.statusText,
    headers
  });
  await cache.put(descriptor.key, cached);
}

async function staleRead(cache, descriptor, request) {
  const cached = await cache.match(descriptor.key);
  if (!cached) return null;
  const headers = new Headers(cached.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-localbleachers-api-stale", "1");
  headers.set("x-localbleachers-cache-source", "last-good");
  const response = new Response(cached.body, {
    status: 200,
    statusText: "OK",
    headers
  });
  return applyPublicReadCors(request, response);
}

export default {
  async fetch(request, env, ctx) {
    const descriptor = cacheDescriptor(request);
    const cache = descriptor ? edgeCache() : null;
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
        console.warn("public read cache fallback failed", error);
      }
    }

    return response;
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
