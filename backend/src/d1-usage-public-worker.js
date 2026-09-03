import app from "./public-cors-worker.js";
import { loadD1Usage } from "./d1-usage-monitor.js";

const USAGE_PATH = "/api/v1/d1-usage";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function authorized(request, env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === USAGE_PATH) {
      if (!authorized(request, env)) return json({ error: "not_found" }, 404);

      try {
        return json(await loadD1Usage(env));
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
