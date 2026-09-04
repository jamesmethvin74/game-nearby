import app from "./m4-public-worker.js";
import core from "./index.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";

const APPROVED_BOOTSTRAP_PATH = "/api/v1/m4/bootstrap-approved-FIJy3Ofb8ZW9ZezIvbcPEYS3YJfuwBKLFpJ7lQYsnFc";

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === APPROVED_BOOTSTRAP_PATH) {
      const result = await runScopedCadence({
        core,
        env,
        ctx,
        controller: null,
        plan: {
          kind: "m4-college-initial-ingestion-approved-batch1",
          scope: "college-bootstrap",
          season: "2026"
        }
      });
      return privateJson(result || { status: "SKIPPED" });
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { APPROVED_BOOTSTRAP_PATH };
