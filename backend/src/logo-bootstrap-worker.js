import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { planM7FinalTwoRepair, executeM7FinalTwoRepair } from "./m7-final-two-repair.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const M7_FINAL_VERSION_PATH = "/api/v1/internal/m7-final-three-version-9c27e4ad";
export const M7_FINAL_PLAN_PATH = "/api/v1/internal/m7-final-three-plan-9c27e4ad";
export const M7_FINAL_EXECUTE_PATH = "/api/v1/internal/m7-final-three-execute-9c27e4ad";
export const M7_FINAL_MARKER = "m7-final-three-corrections-v2-bed011f5";
export const M7_FINAL_EXPIRES_AT = Date.parse("2026-09-12T06:30:00Z");

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
    if (request.method === "GET" && path === M7_FINAL_VERSION_PATH) {
      if (Date.now() > M7_FINAL_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      return privateJson({ marker:M7_FINAL_MARKER, d1_access:false });
    }
    if (request.method === "GET" && path === M7_FINAL_PLAN_PATH) {
      if (Date.now() > M7_FINAL_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try { return privateJson(await planM7FinalTwoRepair(env)); }
      catch (error) { return privateJson({ error:"m7_final_plan_failed", message:String(error?.message || error) }, 500); }
    }
    if (request.method === "POST" && path === M7_FINAL_EXECUTE_PATH) {
      if (Date.now() > M7_FINAL_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      const input=await options(request);
      try { return privateJson(await executeM7FinalTwoRepair(env,{fingerprint:input.fingerprint})); }
      catch (error) { return privateJson({ error:"m7_final_execute_failed", message:String(error?.message || error) }, 409); }
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
