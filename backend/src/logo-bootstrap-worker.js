import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { diagnoseVolleyballConvergenceBatch, runVolleyballConvergenceBatch, VOLLEYBALL_CONVERGENCE_PATH, VOLLEYBALL_CONVERGENCE_BATCH_KEY } from "./volleyball-convergence-batch.js";
import { finalizeAug24Finals, verifyAug24Finals, AUG24_FINALIZE_PATH, AUG24_FINALIZE_STATUS_PATH } from "./volleyball-aug24-finalizer.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_CONVERGENCE_READY_PATH = "/api/v1/internal/volleyball-convergence/ready";
export const VOLLEYBALL_CONVERGENCE_DIAGNOSTIC_PATH = "/api/v1/internal/volleyball-convergence/diagnostic";

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

export function authorizedVolleyballConvergence(request, env) {
  return Boolean(env.VOLLEYBALL_CONVERGENCE_TOKEN)
    && request.headers.get("x-volleyball-convergence-token") === env.VOLLEYBALL_CONVERGENCE_TOKEN;
}

export function volleyballConvergenceReadiness(request, env) {
  if (!authorizedVolleyballConvergence(request, env)) return privateJson({ error:"not_found" }, 404);
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
    const path = new URL(request.url).pathname;

    if ((request.method === "POST" && path === AUG24_FINALIZE_PATH) || (request.method === "GET" && path === AUG24_FINALIZE_STATUS_PATH)) {
      if (!authorizedVolleyballConvergence(request, env)) return privateJson({ error:"not_found" }, 404);
      try {
        const result=request.method === "POST" ? await finalizeAug24Finals(env) : await verifyAug24Finals(env);
        return privateJson(result);
      } catch(error) {
        const message=String(error?.message||error);
        console.error("exact Aug 24 volleyball finalizer failed", { method:request.method, error:message });
        return privateJson({ status:"FAIL", message }, 409);
      }
    }

    if (request.method === "GET" && path === VOLLEYBALL_CONVERGENCE_DIAGNOSTIC_PATH) {
      const tokenConfigured=Boolean(env.VOLLEYBALL_CONVERGENCE_TOKEN);
      try {
        const result=await diagnoseVolleyballConvergenceBatch(env,{batchKey:VOLLEYBALL_CONVERGENCE_BATCH_KEY});
        return privateJson({ status:"PASS", tokenConfigured, ...result });
      } catch(error) {
        return privateJson({ status:"FAIL", tokenConfigured, message:String(error?.message||error) });
      }
    }

    if (request.method === "HEAD" && path === VOLLEYBALL_CONVERGENCE_READY_PATH) {
      return volleyballConvergenceReadiness(request, env);
    }

    if (request.method === "POST" && path === VOLLEYBALL_CONVERGENCE_PATH) {
      if (!authorizedVolleyballConvergence(request, env)) return privateJson({ error:"not_found" }, 404);
      const input = await options(request);
      try {
        const result = await runVolleyballConvergenceBatch(env, { batchKey:input.batchKey });
        return privateJson(result);
      } catch (error) {
        const message=String(error?.message || error);
        console.error("bounded volleyball convergence failed", { error:message });
        const status=/Unknown volleyball convergence batch/.test(message)?400:409;
        return privateJson({ error:"volleyball_convergence_failed", message }, status);
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
