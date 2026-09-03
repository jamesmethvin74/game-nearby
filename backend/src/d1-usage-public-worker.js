import app from "./milestone2-scheduled-worker.js";
import { loadD1Usage, publicBudgetSnapshot } from "./d1-usage-monitor.js";
import { maybeHandleM2ProductionBootstrap } from "./m2-production-bootstrap.js";
import { maybeHandleM2ProductionBootstrapV2 } from "./m2-production-bootstrap-v2-route.js";
import { maybeHandleM2ProductionBootstrapV3 } from "./m2-production-bootstrap-v3-route.js";
import { maybeHandleM2BootstrapStatus } from "./m2-bootstrap-status.js";

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
    const uniqueV3Bootstrap = await maybeHandleM2ProductionBootstrapV3(request, env);
    if (uniqueV3Bootstrap) return uniqueV3Bootstrap;

    const uniqueV2Bootstrap = await maybeHandleM2ProductionBootstrapV2(request, env);
    if (uniqueV2Bootstrap) return uniqueV2Bootstrap;

    const statusProbe = await maybeHandleM2BootstrapStatus(request, env);
    if (statusProbe) return statusProbe;

    const bootstrap = await maybeHandleM2ProductionBootstrap(request, env);
    if (bootstrap) return bootstrap;

    const url = new URL(request.url);
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
