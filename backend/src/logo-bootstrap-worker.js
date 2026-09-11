import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { runM7VolleyballCompletenessAudit } from "./m7-volleyball-completeness-audit.js";
import { planM7VolleyballDateFinals } from "./m7-volleyball-date-final-plan.js";
import { planM7OneSidedIdentity } from "./m7-volleyball-one-sided-identity-plan.js";
import { loadM7VolleyballIdentityCatalog } from "./m7-volleyball-identity-catalog.js";
import { planM7StatewideFinalConvergence, executeM7StatewideFinalConvergence } from "./m7-volleyball-statewide-final-convergence.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const M7_VOLLEYBALL_AUDIT_PATH = "/api/v1/internal/m7-vb-audit-7e49c2a1bd6f4083";
export const M7_VOLLEYBALL_AUG18_PLAN_PATH = "/api/v1/internal/m7-vb-plan-aug18-891f4ea83c214327";
export const M7_VOLLEYBALL_ONE_SIDED_IDENTITY_PATH = "/api/v1/internal/m7-vb-one-sided-identity-36ea42b0ea994312";
export const M7_VOLLEYBALL_IDENTITY_CATALOG_PATH = "/api/v1/internal/m7-vb-identity-catalog-d2bd775959894b2d";
export const M7_VOLLEYBALL_STATEWIDE_FINAL_PLAN_PATH = "/api/v1/internal/m7-vb-statewide-final-plan-1f2b3ac4d5e64788";
export const M7_VOLLEYBALL_STATEWIDE_FINAL_EXECUTE_PATH = "/api/v1/internal/m7-vb-statewide-final-execute-6c812b9f0de34a55";
export const M7_VOLLEYBALL_AUDIT_EXPIRES_AT = Date.parse("2026-09-11T06:00:00Z");

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

export function authorizedLogoBootstrap(request, env) {
  const refreshAuthorized = Boolean(env.REFRESH_TOKEN)
    && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
  const executionAuthorized = Boolean(env.LOGO_BOOTSTRAP_TOKEN)
    && request.headers.get("x-logo-bootstrap-token") === env.LOGO_BOOTSTRAP_TOKEN;
  return refreshAuthorized || executionAuthorized;
}

export function logoBootstrapReadiness(request, env) {
  const executionAuthorized = Boolean(env.LOGO_BOOTSTRAP_TOKEN)
    && request.headers.get("x-logo-bootstrap-token") === env.LOGO_BOOTSTRAP_TOKEN;
  if (!executionAuthorized) return privateJson({ error:"not_found" }, 404);
  return new Response(null, { status:204, headers:{ "cache-control":"no-store" } });
}

async function options(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function m7ThroughDate(value) {
  const text=String(value||"").trim();
  if(!/^2026-\d{2}-\d{2}$/.test(text)) return null;
  const date=new Date(`${text}T18:00:00Z`);
  return Number.isNaN(date.getTime())?null:date;
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
    console.error("live statewide volleyball result probe failed", {
      plan:plan.kind,
      error:String(error?.message || error)
    });
    return { status:"FAILURE", error:String(error?.message || error) };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === M7_VOLLEYBALL_AUDIT_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try {
        return privateJson(await runM7VolleyballCompletenessAudit(env));
      } catch (error) {
        console.error("M7 statewide volleyball completeness audit failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_audit_failed", message:String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && path === M7_VOLLEYBALL_AUG18_PLAN_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try {
        return privateJson(await planM7VolleyballDateFinals(env,"2026-08-18"));
      } catch (error) {
        console.error("M7 Aug 18 volleyball final planner failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_date_plan_failed", message:String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && path === M7_VOLLEYBALL_ONE_SIDED_IDENTITY_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try {
        return privateJson(await planM7OneSidedIdentity(env));
      } catch (error) {
        console.error("M7 one-sided identity planner failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_one_sided_identity_failed", message:String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && path === M7_VOLLEYBALL_IDENTITY_CATALOG_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try {
        return privateJson(await loadM7VolleyballIdentityCatalog(env));
      } catch (error) {
        console.error("M7 identity catalog failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_identity_catalog_failed", message:String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && path === M7_VOLLEYBALL_STATEWIDE_FINAL_PLAN_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      try {
        const through=m7ThroughDate(url.searchParams.get("through"));
        const plan=await planM7StatewideFinalConvergence(env,through?{now:through}:{});
        const { _private, ...publicPlan }=plan;
        return privateJson(publicPlan);
      } catch (error) {
        console.error("M7 statewide final convergence plan failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_statewide_final_plan_failed", message:String(error?.message || error) }, 500);
      }
    }

    if (request.method === "POST" && path === M7_VOLLEYBALL_STATEWIDE_FINAL_EXECUTE_PATH) {
      if (Date.now() > M7_VOLLEYBALL_AUDIT_EXPIRES_AT) return privateJson({ error:"not_found" }, 404);
      const input=await options(request);
      if(input.approved_scope!=="m7-statewide-volleyball-preapproved") return privateJson({ error:"approved_scope_required" },409);
      try {
        const through=m7ThroughDate(input.through_local_date);
        return privateJson(await executeM7StatewideFinalConvergence(env,through?{now:through}:{}));
      } catch (error) {
        console.error("M7 statewide final convergence failed", { error:String(error?.message || error) });
        return privateJson({ error:"volleyball_statewide_final_convergence_failed", message:String(error?.message || error) }, 409);
      }
    }

    if (request.method === "HEAD" && path === LOGO_BOOTSTRAP_READY_PATH) {
      return logoBootstrapReadiness(request, env);
    }

    const logoPath = path === HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH || path === COLLEGE_LOGO_BOOTSTRAP_PATH;
    if (request.method === "POST" && logoPath) {
      if (!authorizedLogoBootstrap(request, env)) return privateJson({ error:"not_found" }, 404);
      const input = await options(request);
      try {
        if (path === HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH) {
          const result = await runStatewideHighSchoolLogoCompletion(env, {
            limit: Math.min(HIGH_SCHOOL_LOGO_BATCH_LIMIT, Number(input.limit) || HIGH_SCHOOL_LOGO_BATCH_LIMIT)
          });
          return privateJson(result);
        }
        const result = await runCollegeLogoCompletion(env, {
          limit: Math.min(COLLEGE_LOGO_BATCH_LIMIT, Number(input.limit) || COLLEGE_LOGO_BATCH_LIMIT),
          schoolIds: Array.isArray(input.schoolIds) ? input.schoolIds : null
        });
        return privateJson(result);
      } catch (error) {
        console.error("logo bootstrap failed", { path, error:String(error?.message || error) });
        return privateJson({ error:"logo_bootstrap_failed", message:String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    await runVolleyballLiveTick(controller, env);
    return app.scheduled(controller, env, ctx);
  }
};
