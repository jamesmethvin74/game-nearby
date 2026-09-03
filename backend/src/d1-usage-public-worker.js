import app from "./public-cors-worker.js";
import { loadD1Usage, publicBudgetSnapshot } from "./d1-usage-monitor.js";
import { MILESTONE1_VERIFY_PATH, milestoneOneVerification } from "./milestone1-production-verification.js";

const USAGE_PATH = "/api/v1/d1-usage";
const BUDGET_PATH = "/api/v1/d1-budget";
const BUDGET_CACHE_TTL_SECONDS = 300;

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function publicBudgetJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? `public, max-age=${BUDGET_CACHE_TTL_SECONDS}` : "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function authorized(request, env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
}

function edgeCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch {
    return null;
  }
}

function budgetCacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${BUDGET_PATH}`);
}

async function publicBudgetResponse(request, env, ctx) {
  const cache = edgeCache();
  const key = cache ? budgetCacheKey(request) : null;
  if (cache && key) {
    const cached = await cache.match(key);
    if (cached) return cached;
  }

  try {
    const response = publicBudgetJson(publicBudgetSnapshot(await loadD1Usage(env)));
    if (cache && key) {
      const write = cache.put(key, response.clone()).catch(error => console.warn("D1 budget cache write failed", error));
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
      else await write;
    }
    return response;
  } catch (error) {
    console.error("D1 public budget monitor failed", error);
    return publicBudgetJson({ error: "budget_usage_unavailable" }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === MILESTONE1_VERIFY_PATH) {
      try {
        return privateJson(await milestoneOneVerification(env));
      } catch (error) {
        console.error("Milestone 1 verification failed", error);
        return privateJson({ error: "milestone1_verification_failed", message: String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === BUDGET_PATH) {
      return publicBudgetResponse(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === USAGE_PATH) {
      if (!authorized(request, env)) return privateJson({ error: "not_found" }, 404);

      try {
        return privateJson(await loadD1Usage(env));
      } catch (error) {
        console.error("D1 usage monitor failed", error);
        const message = String(error?.message || error);
        const configurationError = message.includes("not configured");
        return privateJson({
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
