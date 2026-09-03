import app from "./public-cors-worker.js";
import { loadD1Usage } from "./d1-usage-monitor.js";

const USAGE_PATH = "/api/v1/d1-usage";
const CACHE_TTL_SECONDS = 300;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? `public, max-age=${CACHE_TTL_SECONDS}` : "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function edgeCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch {
    return null;
  }
}

function usageCacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}/__localbleachers_cache__/d1-usage`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === USAGE_PATH) {
      const cache = edgeCache();
      const key = cache ? usageCacheKey(request) : null;
      if (cache && key) {
        const cached = await cache.match(key);
        if (cached) return cached;
      }

      try {
        const response = json(await loadD1Usage(env));
        if (cache && key) {
          const write = cache.put(key, response.clone()).catch(error => console.warn("D1 usage cache write failed", error));
          if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
          else await write;
        }
        return response;
      } catch (error) {
        console.error("D1 usage monitor failed", error);
        const message = String(error?.message || error);
        const configurationError = message.includes("not configured");
        return json({
          error: configurationError ? "d1_usage_monitor_not_configured" : "d1_usage_monitor_failed",
          message
        }, configurationError ? 503 : 502);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
