import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_CHRISTIAN_GROUP_REPAIR_PATH = "/api/v1/maintenance/volleyball-membership/christian-groups-approved-20260910-b814e3";

const CHRISTIAN_GROUP_TARGETS = Object.freeze({
  "df-xhqftl-volleyball-2026":"arkansas-christian--central-volleyball",
  "df-uqet7h-volleyball-2026":"arkansas-christian--south-volleyball"
});
const CHRISTIAN_GROUP_TEAM_IDS = Object.freeze(Object.keys(CHRISTIAN_GROUP_TARGETS));

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

function maintenanceJson(body, status = 200) {
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

async function verifyChristianGroupTargets(env) {
  const payload = CHRISTIAN_GROUP_TEAM_IDS.map(team_id => ({
    team_id,
    conference_id:CHRISTIAN_GROUP_TARGETS[team_id]
  }));
  const { results=[] } = await env.DB.prepare(`
    WITH target AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        json_extract(value,'$.conference_id') AS expected_conference_id
      FROM json_each(?)
    )
    SELECT
      target.team_id,
      s.name AS school_name,
      s.city,
      t.conference_id,
      c.name AS conference_name,
      target.expected_conference_id
    FROM target
    JOIN teams t ON t.id=target.team_id
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    ORDER BY target.team_id
  `).bind(JSON.stringify(payload)).all();
  return results;
}

function exactChristianGroupVerification(rows=[]) {
  return rows.length===CHRISTIAN_GROUP_TEAM_IDS.length
    && new Set(rows.map(row=>String(row.team_id))).size===CHRISTIAN_GROUP_TEAM_IDS.length
    && rows.every(row=>CHRISTIAN_GROUP_TARGETS[String(row.team_id)]===String(row.conference_id||""));
}

function exactInitialChristianGroupPlan(plan={}) {
  const changes=Array.isArray(plan.changes)?plan.changes:[];
  const missing=Array.isArray(plan.missing)?plan.missing:[];
  const wrong=Array.isArray(plan.wrong)?plan.wrong:[];
  const changeIds=new Set(changes.map(row=>String(row.team_id)));
  return plan.assignments===2
    && plan.change_count===2
    && plan.missing_count===2
    && plan.wrong_count===0
    && changes.length===2
    && missing.length===2
    && wrong.length===0
    && changeIds.size===2
    && CHRISTIAN_GROUP_TEAM_IDS.every(id=>changeIds.has(id))
    && changes.every(row=>String(row.expected_conference_id||"")===CHRISTIAN_GROUP_TARGETS[String(row.team_id)])
    && missing.every(row=>row.current_conference_id==null);
}

async function runChristianGroupRepair(env) {
  const before=await verifyChristianGroupTargets(env);
  if(before.length!==2) {
    return { httpStatus:409, body:{ status:"REFUSED", reason:"target_set_not_exact", verification:before } };
  }

  if(exactChristianGroupVerification(before)) {
    return { httpStatus:200, body:{
      status:"ALREADY_APPLIED",
      change_count:0,
      missing_count:0,
      wrong_count:0,
      d1Statements:0,
      conferenceWrites:0,
      teamWrites:0,
      verification:before
    }};
  }

  if(before.some(row=>row.conference_id!=null)) {
    return { httpStatus:409, body:{ status:"REFUSED", reason:"target_membership_changed", verification:before } };
  }

  const syncOptions={
    conferenceIds:["arkansas-christian--central","arkansas-christian--south"],
    targetTeamIds:CHRISTIAN_GROUP_TEAM_IDS,
    maxTeamChanges:2,
    maxConferenceRows:2
  };

  const dry=await syncPublishedVolleyballConferenceMembership(env,{ ...syncOptions, dryRun:true });
  if(dry.status!=="DRY_RUN"
    || dry.selectedConferences!==2
    || dry.fetchedConferences!==2
    || !Array.isArray(dry.failedConferences)
    || dry.failedConferences.length!==0
    || dry.assignments!==2
    || dry.conferenceRows!==2
    || dry.d1Statements!==0
    || dry.teamWrites!==0
    || dry.conferenceWrites!==0
    || !exactInitialChristianGroupPlan(dry.plan||{})) {
    return { httpStatus:409, body:{ status:"REFUSED", reason:"exact_preflight_failed", dryRun:dry } };
  }

  const written=await syncPublishedVolleyballConferenceMembership(env,{ ...syncOptions, dryRun:false });
  const verification=await verifyChristianGroupTargets(env);
  const success=written.status==="SUCCESS"
    && written.plan?.change_count===2
    && written.plan?.missing_count===2
    && written.plan?.wrong_count===0
    && written.d1Statements===2
    && written.teamWrites===2
    && Number(written.conferenceWrites)<=2
    && exactChristianGroupVerification(verification);

  return {
    httpStatus:success?200:500,
    body:{
      status:success?"SUCCESS":"VERIFICATION_FAILED",
      change_count:Number(written.plan?.change_count||0),
      missing_count:Number(written.plan?.missing_count||0),
      wrong_count:Number(written.plan?.wrong_count||0),
      d1Statements:Number(written.d1Statements||0),
      conferenceWrites:Number(written.conferenceWrites||0),
      teamWrites:Number(written.teamWrites||0),
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

    if (request.method === "GET" && path === VOLLEYBALL_CHRISTIAN_GROUP_REPAIR_PATH) {
      try {
        const outcome=await runChristianGroupRepair(env);
        return maintenanceJson(outcome.body,outcome.httpStatus);
      } catch (error) {
        return maintenanceJson({
          status:"REFUSED",
          reason:"christian_group_repair_exception",
          message:String(error?.message || error)
        }, 500);
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
