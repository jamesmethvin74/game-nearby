import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_FINAL_SOUTHSIDE_6AWEST_REPAIR_PATH = "/api/v1/maintenance/volleyball-membership/final-southside-6awest-20260910-c9e4a1";

const FINAL_CONFERENCE_SOURCES = Object.freeze({
  "4a-4": {
    name:"4A 4",
    source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-4/?leagueid=f33689bb-e031-43c1-bdff-27332140303f"
  },
  "6a-west": {
    name:"6A West",
    source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-west/?leagueid=a6284ae0-876a-44c2-9a1c-ab9bbc94b8ef"
  }
});

const FINAL_TARGETS = Object.freeze({
  "df-s3xu7u-volleyball-2026":"4a-4-volleyball",
  "df-jh2s9b-volleyball-2026":"6a-west-volleyball",
  "df-3y3kbw-volleyball-2026":"6a-west-volleyball",
  "df-bqp5sf-volleyball-2026":"6a-west-volleyball",
  "df-s7358s-volleyball-2026":"6a-west-volleyball",
  "df-7rxkjc-volleyball-2026":"6a-west-volleyball",
  "df-qe9p6z-volleyball-2026":"6a-west-volleyball",
  "df-qg2ant-volleyball-2026":"6a-west-volleyball",
  "df-7k6qj6-volleyball-2026":"6a-west-volleyball",
  "df-bf8zxn-volleyball-2026":"6a-west-volleyball",
  "df-ptxzvg-volleyball-2026":"6a-west-volleyball"
});
const FINAL_TEAM_IDS = Object.freeze(Object.keys(FINAL_TARGETS));
const FORT_SMITH_SOUTHSIDE_TEAM_ID = "df-jh2s9b-volleyball-2026";

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}

function maintenanceJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
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
  if (!executionAuthorized) return privateJson({ error:"not_found" },404);
  return new Response(null,{ status:204, headers:{ "cache-control":"no-store" } });
}

async function options(request) {
  try {
    const body=await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function finalExpectedPayload() {
  return FINAL_TEAM_IDS.map(team_id=>({ team_id, conference_id:FINAL_TARGETS[team_id] }));
}

async function verifyFinalTargets(env) {
  const payload=finalExpectedPayload();
  const { results=[] }=await env.DB.prepare(`
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

function exactFinalVerification(rows=[]) {
  return rows.length===FINAL_TEAM_IDS.length
    && new Set(rows.map(row=>String(row.team_id))).size===FINAL_TEAM_IDS.length
    && rows.every(row=>FINAL_TARGETS[String(row.team_id)]===String(row.conference_id||""));
}

function commonFinalDryRunSafe(dry) {
  const plan=dry?.plan||{};
  return dry?.status==="DRY_RUN"
    && dry.selectedConferences===2
    && dry.fetchedConferences===2
    && Array.isArray(dry.failedConferences) && dry.failedConferences.length===0
    && dry.conferenceRows===2
    && dry.assignments===11
    && plan.assignments===11
    && Array.isArray(dry.ambiguous) && dry.ambiguous.length===0
    && dry.d1Statements===0
    && dry.teamWrites===0
    && dry.conferenceWrites===0;
}

function exactInitialFinalPlan(plan={}) {
  const changes=Array.isArray(plan.changes)?plan.changes:[];
  const missing=Array.isArray(plan.missing)?plan.missing:[];
  const wrong=Array.isArray(plan.wrong)?plan.wrong:[];
  const expectedIds=new Set(FINAL_TEAM_IDS);
  const changeIds=new Set(changes.map(row=>String(row.team_id)));
  const wrongRow=wrong[0];

  return plan.change_count===11
    && plan.missing_count===10
    && plan.wrong_count===1
    && changes.length===11
    && missing.length===10
    && wrong.length===1
    && changeIds.size===11
    && FINAL_TEAM_IDS.every(id=>changeIds.has(id))
    && changes.every(row=>
      expectedIds.has(String(row.team_id))
      && String(row.expected_conference_id||"")===FINAL_TARGETS[String(row.team_id)]
    )
    && missing.every(row=>row.current_conference_id==null)
    && String(wrongRow?.team_id||"")===FORT_SMITH_SOUTHSIDE_TEAM_ID
    && String(wrongRow?.current_conference_id||"")==="4a-4-volleyball"
    && String(wrongRow?.expected_conference_id||"")==="6a-west-volleyball";
}

async function runFinalSouthside6aWestRepair(env) {
  const syncOptions={
    conferenceIds:["4a-4","6a-west"],
    targetTeamIds:FINAL_TEAM_IDS,
    conferenceSourceOverrides:FINAL_CONFERENCE_SOURCES,
    maxTeamChanges:11,
    maxConferenceRows:2
  };

  const dry=await syncPublishedVolleyballConferenceMembership(env,{ ...syncOptions, dryRun:true });
  const plan=dry.plan||{};
  if(!commonFinalDryRunSafe(dry)) {
    return { httpStatus:409, body:{ status:"REFUSED", reason:"final_preflight_shape_failed", dryRun:dry } };
  }

  if(plan.change_count===0) {
    const verification=await verifyFinalTargets(env);
    if(!exactFinalVerification(verification)) {
      return { httpStatus:409, body:{ status:"REFUSED", reason:"already_applied_verification_failed", verification } };
    }
    return { httpStatus:200, body:{
      status:"ALREADY_APPLIED",
      change_count:0,
      missing_count:0,
      wrong_count:0,
      d1Statements:0,
      conferenceWrites:0,
      teamWrites:0,
      verification
    }};
  }

  if(!exactInitialFinalPlan(plan)) {
    return { httpStatus:409, body:{ status:"REFUSED", reason:"final_exact_plan_mismatch", dryRun:dry } };
  }

  const written=await syncPublishedVolleyballConferenceMembership(env,{ ...syncOptions, dryRun:false });
  const verification=await verifyFinalTargets(env);
  const success=written.status==="SUCCESS"
    && written.plan?.change_count===11
    && written.plan?.missing_count===10
    && written.plan?.wrong_count===1
    && written.d1Statements===2
    && written.teamWrites===11
    && Number(written.conferenceWrites)<=2
    && exactFinalVerification(verification);

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
  const scheduledTime=Number(controller?.scheduledTime);
  const when=Number.isFinite(scheduledTime)?new Date(scheduledTime):new Date();
  const plan=collectionPlanAt(when);
  if(!plan?.runVolleyballLive) return null;
  try {
    const result=await runVolleyballLiveResultProbe(env,{ now:when });
    console.log("live statewide volleyball result probe",{ plan:plan.kind, ...result });
    return result;
  } catch(error) {
    console.error("live statewide volleyball result probe failed",{
      plan:plan.kind,
      error:String(error?.message||error)
    });
    return { status:"FAILURE", error:String(error?.message||error) };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    const path=url.pathname;

    if(request.method==="GET" && path===VOLLEYBALL_FINAL_SOUTHSIDE_6AWEST_REPAIR_PATH) {
      try {
        const outcome=await runFinalSouthside6aWestRepair(env);
        return maintenanceJson(outcome.body,outcome.httpStatus);
      } catch(error) {
        console.error("final Southside / 6A West volleyball repair failed",String(error?.message||error));
        return maintenanceJson({
          status:"REFUSED",
          reason:"final_repair_exception",
          message:String(error?.message||error)
        },500);
      }
    }

    if(request.method==="HEAD" && path===LOGO_BOOTSTRAP_READY_PATH) {
      return logoBootstrapReadiness(request,env);
    }

    const logoPath=path===HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH || path===COLLEGE_LOGO_BOOTSTRAP_PATH;
    if(request.method==="POST" && logoPath) {
      if(!authorizedLogoBootstrap(request,env)) return privateJson({ error:"not_found" },404);
      const input=await options(request);
      try {
        if(path===HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH) {
          const result=await runStatewideHighSchoolLogoCompletion(env,{
            limit:Math.min(HIGH_SCHOOL_LOGO_BATCH_LIMIT,Number(input.limit)||HIGH_SCHOOL_LOGO_BATCH_LIMIT)
          });
          return privateJson(result);
        }
        const result=await runCollegeLogoCompletion(env,{
          limit:Math.min(COLLEGE_LOGO_BATCH_LIMIT,Number(input.limit)||COLLEGE_LOGO_BATCH_LIMIT),
          schoolIds:Array.isArray(input.schoolIds)?input.schoolIds:null
        });
        return privateJson(result);
      } catch(error) {
        console.error("logo bootstrap failed",{ path,error:String(error?.message||error) });
        return privateJson({ error:"logo_bootstrap_failed",message:String(error?.message||error) },500);
      }
    }

    return app.fetch(request,env,ctx);
  },

  async scheduled(controller, env, ctx) {
    await runVolleyballLiveTick(controller,env);
    return app.scheduled(controller,env,ctx);
  }
};
