import app from "./m4-public-worker.js";
import { runStatewideHighSchoolLogoCompletion, HIGH_SCHOOL_LOGO_BATCH_LIMIT } from "./statewide-logo-completion.js";
import { runCollegeLogoCompletion, COLLEGE_LOGO_BATCH_LIMIT } from "./college-logo-bootstrap.js";
import { collectionPlanAt } from "./collection-cadence.js";
import { runVolleyballLiveResultProbe } from "./volleyball-live-results.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const HIGH_SCHOOL_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/high-school";
export const COLLEGE_LOGO_BOOTSTRAP_PATH = "/api/v1/content/logo-bootstrap/college";
export const LOGO_BOOTSTRAP_READY_PATH = "/api/v1/content/logo-bootstrap/ready";
export const VOLLEYBALL_REMAINING_AAA_APPROVED_WRITE_PATH = "/api/v1/maintenance/volleyball-membership/remaining-aaa-approved-20260910-5c1d8e";

const VOLLEYBALL_REMAINING_AAA = Object.freeze({
  "2a-4": { name:"2A 4", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/2a-4/?leagueid=7cd5359b-6357-4e1e-ad1c-48545caa85c6" },
  "2a-5": { name:"2A 5", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/2a-5/?leagueid=6cc5c87a-1664-47d7-bedf-517fa12d7ca7" },
  "2a-7": { name:"2A 7", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/2a-7/?leagueid=26656194-f38b-45de-a4c1-7eec71140f19" },
  "2a-8": { name:"2A 8", maxTeamChanges:7, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/2a-8/?leagueid=6d2a607d-c7ca-4722-94a4-2e5ad630ce36" },
  "3a-1": { name:"3A 1", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-1/?leagueid=7b99690e-5d67-4ddd-9543-ba66913f4fb4" },
  "3a-3": { name:"3A 3", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-3/?leagueid=2d6e72cb-9cf0-45db-ad63-b74f2ceb66bc" },
  "3a-4": { name:"3A 4", maxTeamChanges:7, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-4/?leagueid=1654733e-00c6-45a9-ac3e-d446baa636c8" },
  "3a-5": { name:"3A 5", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-5/?leagueid=86fb7214-557c-4700-a14d-879b8f8e12e7" },
  "3a-6": { name:"3A 6", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/3a-6/?leagueid=928184f7-63f1-4e45-8290-d73ad54392cb" },
  "4a-1": { name:"4A 1", maxTeamChanges:9, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-1/?leagueid=e40753e0-1af1-4d1e-94c6-9803212a3709" },
  "4a-2": { name:"4A 2", maxTeamChanges:5, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-2/?leagueid=52fc048b-cbdd-4b10-bbd0-43a6921d0dc6" },
  "4a-3": { name:"4A 3", maxTeamChanges:5, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-3/?leagueid=cc5ff5ec-a78b-41fa-8995-fb9c913441cd" },
  "4a-4": { name:"4A 4", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-4/?leagueid=f33689bb-e031-43c1-bdff-27332140303f" },
  "4a-6": { name:"4A 6", maxTeamChanges:5, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/4a-6/?leagueid=9f4ed236-4d6f-492d-85de-c12808ea789a" },
  "5a-central": { name:"5A Central", maxTeamChanges:6, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/5a-central/?leagueid=6f0edb9d-9fcb-4529-ae2f-729ae00d6f6c" },
  "5a-east": { name:"5A East", maxTeamChanges:9, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/5a-east/?leagueid=898701fe-263a-4f52-922a-3dd604188dda" },
  "5a-south": { name:"5A South", maxTeamChanges:5, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/5a-south/?leagueid=1fdc2e7a-a965-47b7-8b21-71f380757444" },
  "5a-west": { name:"5A West", maxTeamChanges:7, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/5a-west/?leagueid=9dd260d5-8ea3-49e8-a766-3855f61d2b6c" },
  "6a-west": { name:"6A West", maxTeamChanges:9, source_url:"https://www.maxpreps.com/ar/volleyball/26-27/conference/6a-west/?leagueid=a6284ae0-876a-44c2-9a1c-ab9bbc94b8ef" }
});

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

async function verifyConferenceTargets(env, payload) {
  const { results=[] } = await env.DB.prepare(`
    WITH target AS (
      SELECT
        json_extract(value,'$.team_id') AS team_id,
        json_extract(value,'$.conference_id') AS expected_conference_id
      FROM json_each(?)
    )
    SELECT target.team_id,
      s.name AS school_name,
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

async function runApprovedRemainingAaaConferenceRepair(env, conferenceId) {
  const source=VOLLEYBALL_REMAINING_AAA[conferenceId];
  if(!source) return { httpStatus:404, body:{ status:"REFUSED", reason:"conference_not_allowlisted", conferenceId } };

  const expectedConferenceId=`${conferenceId}-volleyball`;
  const dry=await syncPublishedVolleyballConferenceMembership(env, {
    conferenceIds:[conferenceId],
    conferenceSourceOverrides:{
      [conferenceId]:{ name:source.name, source_url:source.source_url }
    },
    dryRun:true,
    maxTeamChanges:source.maxTeamChanges,
    maxConferenceRows:1
  });
  const plan=dry.plan||{};
  const changes=Array.isArray(plan.changes)?plan.changes:[];
  const safe=dry.status==="DRY_RUN"
    && dry.selectedConferences===1
    && dry.fetchedConferences===1
    && Array.isArray(dry.failedConferences) && dry.failedConferences.length===0
    && dry.conferenceRows===1
    && plan.wrong_count===0
    && plan.change_count<=source.maxTeamChanges
    && changes.length===plan.change_count
    && changes.every(row=>row.current_conference_id==null && row.expected_conference_id===expectedConferenceId);

  if(!safe) return { httpStatus:409, body:{
    status:"REFUSED",
    reason:"conference_preflight_failed",
    conferenceId,
    source:source.source_url,
    dryRun:{
      status:dry.status,
      selectedConferences:dry.selectedConferences,
      fetchedConferences:dry.fetchedConferences,
      failedConferences:dry.failedConferences,
      conferenceRows:dry.conferenceRows,
      assignments:dry.assignments,
      unmatched:dry.unmatched,
      ambiguous:dry.ambiguous,
      plan
    }
  }};

  if(plan.change_count===0) return { httpStatus:200, body:{
    status:"ALREADY_APPLIED",
    conferenceId,
    conferenceName:source.name,
    missing_count:0,
    wrong_count:0,
    teamWrites:0,
    conferenceWrites:0,
    d1WriteStatements:0,
    unmatched:dry.unmatched,
    ambiguous:dry.ambiguous
  }};

  const payload=plan.missing.map(row=>({
    team_id:String(row.team_id),
    conference_id:expectedConferenceId
  }));
  if(payload.length!==plan.change_count) return { httpStatus:409, body:{
    status:"REFUSED",
    reason:"non_missing_change_detected",
    conferenceId,
    plan
  }};

  const now=new Date().toISOString();
  const results=await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,source_url,updated_at)
      VALUES(?,?,'Arkansas high school volleyball','published',0,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        classification=excluded.classification,
        standings_method=excluded.standings_method,
        coverage_complete=0,
        source_url=excluded.source_url,
        updated_at=excluded.updated_at
      WHERE conferences.name<>excluded.name
         OR COALESCE(conferences.classification,'')<>COALESCE(excluded.classification,'')
         OR conferences.standings_method<>excluded.standings_method
         OR conferences.coverage_complete<>excluded.coverage_complete
         OR COALESCE(conferences.source_url,'')<>COALESCE(excluded.source_url,'')
    `).bind(expectedConferenceId,source.name,source.source_url,now),
    env.DB.prepare(`
      WITH payload AS (
        SELECT
          json_extract(value,'$.team_id') AS team_id,
          json_extract(value,'$.conference_id') AS conference_id
        FROM json_each(?)
      )
      UPDATE teams
      SET conference_id=(SELECT p.conference_id FROM payload p WHERE p.team_id=teams.id),
          updated_at=?
      WHERE id IN (SELECT team_id FROM payload)
        AND COALESCE(conference_id,'')=''
    `).bind(JSON.stringify(payload),now)
  ]);

  const conferenceWrites=Number(results?.[0]?.meta?.changes||results?.[0]?.changes||0);
  const teamWrites=Number(results?.[1]?.meta?.changes||results?.[1]?.changes||0);
  const verification=await verifyConferenceTargets(env,payload);
  const verified=verification.length===payload.length
    && verification.every(row=>row.conference_id===row.expected_conference_id)
    && teamWrites===payload.length
    && conferenceWrites<=1;

  return {
    httpStatus:verified?200:500,
    body:{
      status:verified?"SUCCESS":"VERIFICATION_FAILED",
      conferenceId,
      conferenceName:source.name,
      source:source.source_url,
      change_count:plan.change_count,
      missing_count:plan.missing_count,
      wrong_count:plan.wrong_count,
      unmatched:dry.unmatched,
      ambiguous:dry.ambiguous,
      d1WriteStatements:2,
      conferenceWrites,
      teamWrites,
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

    if (request.method === "GET" && path === VOLLEYBALL_REMAINING_AAA_APPROVED_WRITE_PATH) {
      const conferenceId=String(url.searchParams.get("conference")||"").trim().toLowerCase();
      try {
        const outcome=await runApprovedRemainingAaaConferenceRepair(env,conferenceId);
        return maintenanceJson(outcome.body,outcome.httpStatus);
      } catch (error) {
        console.error("remaining AAA approved volleyball membership repair failed", {
          conferenceId,
          error:String(error?.message||error)
        });
        return maintenanceJson({
          status:"REFUSED",
          reason:"repair_exception",
          conferenceId,
          message:String(error?.message||error)
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
