import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { planFinalMissingScoreRepair, executeFinalMissingScoreRepair } from "./final-missing-score-repair.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const FINAL_MISSING_SCORE_PLAN_PATH = "/api/v1/internal/final-missing-score-plan-20260912-4fd5a1c7";
export const FINAL_MISSING_SCORE_EXECUTE_PATH = "/api/v1/internal/final-missing-score-execute-20260912-4fd5a1c7";
export const FINAL_MISSING_SCORE_EXPIRES_AT = Date.parse("2026-09-19T05:00:00Z");

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

export function authorizedLogoBootstrap(request, env) {
  const refreshAuthorized = Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
  const executionAuthorized = Boolean(env.LOGO_BOOTSTRAP_TOKEN) && request.headers.get("x-logo-bootstrap-token") === env.LOGO_BOOTSTRAP_TOKEN;
  return refreshAuthorized || executionAuthorized;
}

export function logoBootstrapReadiness(request, env) {
  const executionAuthorized = Boolean(env.LOGO_BOOTSTRAP_TOKEN) && request.headers.get("x-logo-bootstrap-token") === env.LOGO_BOOTSTRAP_TOKEN;
  if (!executionAuthorized) return privateJson({ error:"not_found" }, 404);
  return new Response(null, { status:204, headers:{ "cache-control":"no-store" } });
}

async function options(request) {
  try { const body = await request.json(); return body && typeof body === "object" ? body : {}; }
  catch { return {}; }
}

async function runVolleyballLiveTick(controller, env) {
  const scheduledTime = Number(controller?.scheduledTime);
  const when = Number.isFinite(scheduledTime) ? new Date(scheduledTime) : new Date();
  const plan = collectionPlanAt(when);
  if (!plan?.runVolleyballLive) return null;
  try {
    const result = await runVolleyballLiveResultProbe(env, { now: when });
    console.log("live statewide volleyball result probe", { plan:plan.kind, ...result });
    return result;
  } catch (error) {
    console.error("live statewide volleyball result probe failed", { plan:plan.kind, error:String(error?.message || error) });
    return { status:"FAILURE", error:String(error?.message || error) };
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (Date.now() <= FINAL_MISSING_SCORE_EXPIRES_AT && request.method === "GET" && path === FINAL_MISSING_SCORE_PLAN_PATH) {
      try { return privateJson(await planFinalMissingScoreRepair(env)); }
      catch (error) { return privateJson({ error:"final_missing_score_plan_failed", message:String(error?.message || error) }, 500); }
    }
    if (Date.now() <= FINAL_MISSING_SCORE_EXPIRES_AT && request.method === "POST" && path === FINAL_MISSING_SCORE_EXECUTE_PATH) {
      const input = await options(request);
      try { return privateJson(await executeFinalMissingScoreRepair(env, { fingerprint:input.fingerprint })); }
      catch (error) { return privateJson({ error:"final_missing_score_execute_failed", message:String(error?.message || error) }, 409); }
    }
    if (request.method === "HEAD" && path === LOGO_BOOTSTRAP_READY_PATH) return logoBootstrapReadiness(request, env);
    const logoPath = path === HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH || path === COLLEGE_LOGO_BOOTSTRAP_PATH;
    if (request.method === "POST" && logoPath) {
      if (!authorizedLogoBootstrap(request, env)) return privateJson({ error:"not_found" }, 404);
      const input = await options(request);
      try {
        if (path === HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH) {
          return privateJson(await runStatewideHighSchoolLogoCompletion(env, { limit: Math.min(HIGH_SCHOOL_LOGO_BATCH_LIMIT, Number(input.limit) || HIGH_SCHOOL_LOGO_BATCH_LIMIT) }));
        }
        return privateJson(await runCollegeLogoCompletion(env, { limit: Math.min(COLLEGE_LOGO_BATCH_LIMIT, Number(input.limit) || COLLEGE_LOGO_BATCH_LIMIT), schoolIds: Array.isArray(input.schoolIds) ? input.schoolIds : null }));
      } catch (error) { return privateJson({ error:"logo_bootstrap_failed", message:String(error?.message || error) }, 500); }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    await runVolleyballLiveTick(controller, env);
    return app.scheduled(controller, env, ctx);
  }
};