import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_REMAINING_AAA_DIAGNOSTIC_PATH = "/api/v1/diagnostics/volleyball-membership/remaining-aaa-20260910-b71d42";

const VOLLEYBALL_REMAINING_AAA_CONFERENCE_IDS = Object.freeze([
  "4a-2","4a-3","4a-4","4a-6","5a-south",
  "2a-4","2a-5","2a-7","3a-1","3a-3","3a-5","3a-6","5a-central",
  "2a-8","3a-4","5a-west","4a-1","5a-east","6a-west"
]);

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

function diagnosticJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*"
    }
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

    if (request.method === "GET" && path === VOLLEYBALL_REMAINING_AAA_DIAGNOSTIC_PATH) {
      try {
        const result = await syncPublishedVolleyballConferenceMembership(env, {
          conferenceIds:VOLLEYBALL_REMAINING_AAA_CONFERENCE_IDS,
          dryRun:true,
          maxTeamChanges:121,
          maxConferenceRows:19
        });
        return diagnosticJson(result);
      } catch (error) {
        console.error("remaining AAA volleyball membership diagnostic failed", String(error?.message || error));
        return diagnosticJson({
          error:"remaining_aaa_volleyball_membership_diagnostic_failed",
          message:String(error?.message || error)
        },500);
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
