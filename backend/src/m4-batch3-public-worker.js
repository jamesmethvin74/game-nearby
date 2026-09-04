import app from "./m4-public-worker.js";
import core from "./index.js";
import { runScopedCadence } from "./scoped-cadence-runner.js";

const APPROVED_BOOTSTRAP_BATCH3_PATH = "/api/v1/m4/bootstrap-approved-b3";
const COLLEGE_BOOTSTRAP_SEASON = "2026";

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function authorizedBatch3(request, env) {
  return Boolean(env.M4_BATCH3_TOKEN) && request.headers.get("x-m4-batch3-token") === env.M4_BATCH3_TOKEN;
}

async function runApprovedBootstrapBatch3(request, env, ctx) {
  if (!authorizedBatch3(request, env)) return privateJson({ error:"not_found" }, 404);
  const result = await runScopedCadence({
    core,
    env,
    ctx,
    controller:null,
    plan:{
      kind:"m4-college-initial-ingestion-approved-batch3",
      scope:"college-bootstrap",
      season:COLLEGE_BOOTSTRAP_SEASON
    }
  });
  return privateJson(result || { status:"SKIPPED" });
}

function batch3Readiness(request, env) {
  if (!authorizedBatch3(request, env)) return privateJson({ error:"not_found" }, 404);
  return new Response(null, { status:204, headers:{ "cache-control":"no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === APPROVED_BOOTSTRAP_BATCH3_PATH) {
      if (request.method === "HEAD") return batch3Readiness(request, env);
      if (request.method === "POST") return runApprovedBootstrapBatch3(request, env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
