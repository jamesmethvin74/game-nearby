import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_2A6_DIAGNOSTIC_PATH = "/api/v1/diagnostics/volleyball-membership/2a6-20260909-8f3b9c";
export const VOLLEYBALL_2A6_APPROVED_WRITE_PATH = "/api/v1/maintenance/volleyball-membership/2a6-approved-20260909-71c5a2";

const VOLLEYBALL_2A6_TARGET_TEAM_IDS = Object.freeze([
  "df-x5ebah-volleyball-2026",
  "df-blzxrg-volleyball-2026",
  "df-qqfrm3-volleyball-2026",
  "df-tnebcj-volleyball-2026"
]);
const VOLLEYBALL_2A6_EXPECTED_CONFERENCE_ID = "2a-6-volleyball";

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

async function loadApproved2a6Verification(env) {
  const { results=[] } = await env.DB.prepare(`
    SELECT t.id AS team_id,
      s.name AS school_name,
      t.conference_id,
      c.name AS conference_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id IN (?,?,?,?)
    ORDER BY t.id
  `).bind(...VOLLEYBALL_2A6_TARGET_TEAM_IDS).all();
  return results;
}

function exactApproved2a6TeamSet(rows) {
  if (!Array.isArray(rows) || rows.length!==VOLLEYBALL_2A6_TARGET_TEAM_IDS.length) return false;
  const actual=new Set(rows.map(row=>String(row.team_id)));
  return VOLLEYBALL_2A6_TARGET_TEAM_IDS.every(id=>actual.has(id));
}

function all2a6Conference(rows) {
  return exactApproved2a6TeamSet(rows)
    && rows.every(row=>String(row.conference_id||"")===VOLLEYBALL_2A6_EXPECTED_CONFERENCE_ID);
}

async function runApproved2a6MembershipWrite(env) {
  const before=await loadApproved2a6Verification(env);
  if (!exactApproved2a6TeamSet(before)) {
    return { httpStatus:409, body:{
      status:"REFUSED",
      reason:"approved_team_set_not_found",
      targetTeamIds:VOLLEYBALL_2A6_TARGET_TEAM_IDS,
      before
    }};
  }
  if (all2a6Conference(before)) {
    return { httpStatus:200, body:{
      status:"ALREADY_APPLIED",
      teamWrites:0,
      conferenceWrites:0,
      verification:before
    }};
  }
  if (!before.every(row=>row.conference_id==null || String(row.conference_id).trim()==="")) {
    return { httpStatus:409, body:{
      status:"REFUSED",
      reason:"approved_precondition_failed_non_null_membership",
      expectedCurrentConferenceId:null,
      before
    }};
  }

  const result=await syncPublishedVolleyballConferenceMembership(env, {
    conferenceIds:["2a-6"],
    targetTeamIds:VOLLEYBALL_2A6_TARGET_TEAM_IDS,
    dryRun:false,
    maxTeamChanges:4,
    maxConferenceRows:1
  });
  const verification=await loadApproved2a6Verification(env);
  const verified=result.status==="SUCCESS"
    && result.plan?.change_count===4
    && result.plan?.wrong_count===0
    && result.assignments===4
    && result.d1Statements===2
    && result.teamWrites===4
    && result.conferenceWrites<=1
    && all2a6Conference(verification);

  return {
    httpStatus:verified?200:500,
    body:{
      status:verified?"SUCCESS":"VERIFICATION_FAILED",
      approvedBatch:{
        conferenceId:VOLLEYBALL_2A6_EXPECTED_CONFERENCE_ID,
        teamIds:VOLLEYBALL_2A6_TARGET_TEAM_IDS
      },
      plan:{
        change_count:result.plan?.change_count,
        missing_count:result.plan?.missing_count,
        wrong_count:result.plan?.wrong_count
      },
      d1Statements:result.d1Statements,
      conferenceWrites:result.conferenceWrites,
      teamWrites:result.teamWrites,
      verification
    }
  };
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

    if (request.method === "GET" && path === VOLLEYBALL_2A6_APPROVED_WRITE_PATH) {
      try {
        const outcome=await runApproved2a6MembershipWrite(env);
        return diagnosticJson(outcome.body,outcome.httpStatus);
      } catch (error) {
        console.error("approved 2A 6 volleyball membership write failed", String(error?.message || error));
        return diagnosticJson({
          error:"approved_2a6_membership_write_failed",
          message:String(error?.message || error)
        },500);
      }
    }

    if (request.method === "GET" && path === VOLLEYBALL_2A6_DIAGNOSTIC_PATH) {
      try {
        const result = await syncPublishedVolleyballConferenceMembership(env, {
          conferenceIds:["2a-6"],
          dryRun:true,
          maxTeamChanges:4,
          maxConferenceRows:1
        });
        return diagnosticJson(result);
      } catch (error) {
        console.error("2A 6 volleyball membership diagnostic failed", String(error?.message || error));
        return diagnosticJson({
          error:"volleyball_2a6_membership_diagnostic_failed",
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
