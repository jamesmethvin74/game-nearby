import app from "./m4-public-worker.js";
import { membershipPublicStatus } from "./conference-membership-truth.js";
import { loadStandingsTruth } from "./standings-truth.js";
import { parseStandingsRecord } from "./conference-standings-truth.js";

function json(body, response) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

export function applyMembershipTruthToStatuses(statuses = [], memberships = []) {
  const byTeam = new Map(memberships.map(row => [String(row.team_id), row]));
  return statuses.map(status => {
    const teamId = String(status.team_id || "");
    const row = byTeam.get(teamId);
    if (!row) {
      return {
        ...status,
        conference_membership_state: "unknown",
        conference_id: null,
        conference_name: null,
        conference_classification: null,
        conference_division: null,
        membership_source: null,
        membership_authority_key: null,
        membership_source_url: null,
        membership_verified_at: null,
        conference_record: null,
        rank: null,
        standing_state: "unknown"
      };
    }

    const truth = membershipPublicStatus(row);
    if (truth.conference_membership_state !== "member") {
      return {
        ...status,
        ...truth,
        conference_record: null,
        rank: null
      };
    }

    const sameConference = !status.conference_id || String(status.conference_id) === String(truth.conference_id);
    return {
      ...status,
      ...truth,
      conference_record: sameConference ? status.conference_record : null,
      rank: sameConference ? status.rank : null,
      standing_state: sameConference
        ? (status.conference_games > 0 ? (status.rank ? "ranked" : "unavailable") : "not-started")
        : "unavailable"
    };
  });
}

async function membershipRows(env, teamIds) {
  const ids = [...new Set((teamIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const result = await env.DB.prepare(`
    SELECT cm.team_id,cm.membership_state,cm.conference_id,
      c.name AS conference_name,COALESCE(cm.classification,c.classification) AS classification,
      cm.division,cm.authority_provider,cm.authority_key,cm.source_url,cm.verified_at
    FROM conference_memberships cm
    LEFT JOIN conferences c ON c.id=cm.conference_id
    WHERE cm.team_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(ids)).all();
  return result.results || [];
}

function sameRecord(left, right) {
  if (!left || !right || left === "N/A" || right === "N/A") return false;
  const a=parseStandingsRecord(left), b=parseStandingsRecord(right);
  return a.wins===b.wins && a.losses===b.losses && a.ties===b.ties;
}

function rowForStatus(payload, status) {
  const rows=Array.isArray(payload?.standings) ? payload.standings : [];
  return rows.find(row => row.team_id && String(row.team_id)===String(status.team_id))
    || rows.find(row => String(row.school_name||"").trim().toLowerCase()===String(status.school_name||"").trim().toLowerCase())
    || null;
}

export function applyStandingsTruthToStatuses(statuses = [], truthByKey = new Map()) {
  return statuses.map(status => {
    if (status.conference_membership_state !== "member" || !status.conference_id || !status.sport) return status;
    if (Number(status.conference_games || 0) === 0) {
      return { ...status, conference_record:"N/A", rank:null, standing_state:"not-started" };
    }
    const key=`${String(status.sport).toLowerCase()}|${String(status.conference_id).toLowerCase()}`;
    const payload=truthByKey.get(key);
    if (!payload) return { ...status, rank:null, standing_state:"unavailable" };
    const row=rowForStatus(payload,status);
    if (!row) return { ...status, rank:null, standing_state:"unavailable" };

    const canonicalAgree=sameRecord(status.conference_record,row.conference_record);
    return {
      ...status,
      rank:canonicalAgree ? row.rank : null,
      standing_state:canonicalAgree ? (row.standing_state || (row.rank ? "ranked" : "unavailable")) : "unavailable",
      standings_verified:Boolean(canonicalAgree && row.standings_verified),
      published_cross_check:row.published_cross_check || null,
      published_rank:row.published_rank ?? null,
      published_conference_record:row.published_conference_record ?? null,
      published_overall_record:row.published_overall_record ?? null
    };
  });
}

async function loadStatusStandingsTruth(env, statuses) {
  const jobs=new Map();
  for (const status of statuses) {
    if (status.conference_membership_state !== "member" || !status.conference_id || !status.sport) continue;
    const sport=String(status.sport).toLowerCase();
    const conferenceId=String(status.conference_id).toLowerCase();
    const key=`${sport}|${conferenceId}`;
    if (!jobs.has(key)) {
      jobs.set(key,loadStandingsTruth(env,{sport,conferenceId,season:status.season||"2026"}).catch(error => {
        console.warn("durable standings truth unavailable",{sport,conferenceId,error:String(error?.message||error)});
        return null;
      }));
    }
  }
  const resolved=new Map();
  await Promise.all([...jobs].map(async ([key,promise]) => resolved.set(key,await promise)));
  return resolved;
}

async function enforceMembershipTruth(response, env) {
  if (!response || response.status !== 200) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  let body;
  try { body = await response.clone().json(); }
  catch { return response; }
  if (!Array.isArray(body?.team_statuses)) return response;

  let memberships;
  try {
    memberships = await membershipRows(env, body.team_statuses.map(row => row.team_id));
  } catch (error) {
    // Deployment is intentionally backward compatible with the migration order:
    // until 0016 exists, preserve the prior response rather than taking schedules down.
    if (/no such table|conference_memberships/i.test(String(error?.message || error))) return response;
    throw error;
  }

  const membershipStatuses=applyMembershipTruthToStatuses(body.team_statuses,memberships);
  const truthByKey=await loadStatusStandingsTruth(env,membershipStatuses);
  const teamStatuses=applyStandingsTruthToStatuses(membershipStatuses,truthByKey);
  return json({
    ...body,
    team_statuses: teamStatuses,
    conference_membership_truth: {
      method: "durable-authority",
      explicit_rows: memberships.length,
      team_rows: body.team_statuses.length,
      fail_closed_unknowns: Math.max(0, body.team_statuses.length - memberships.length)
    }
  }, response);
}

function conferenceStandingsId(pathname) {
  const match=String(pathname||"").match(/^\/api\/v1\/conferences\/([^/]+)\/standings$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function standingsSport(env, conferenceId, requestedSport = null) {
  if (requestedSport) return String(requestedSport).toLowerCase();
  const result=await env.DB.prepare(`
    SELECT DISTINCT t.sport
    FROM conference_memberships cm
    JOIN teams t ON t.id=cm.team_id
    WHERE cm.membership_state='member' AND cm.conference_id=? AND t.active=1
    ORDER BY t.sport
    LIMIT 2
  `).bind(conferenceId).all();
  const sports=(result.results||[]).map(row=>String(row.sport||"").toLowerCase()).filter(Boolean);
  if (sports.length===1) return sports[0];
  if (sports.length>1) throw new Error("standings_sport_required");
  return null;
}

async function enforceConferenceStandingsRoute(request,response,env) {
  const url=new URL(request.url);
  const conferenceId=conferenceStandingsId(url.pathname);
  if (!conferenceId || request.method!=="GET") return response;
  try {
    const sport=await standingsSport(env,conferenceId,url.searchParams.get("sport"));
    if (!sport) return response;
    const payload=await loadStandingsTruth(env,{sport,conferenceId,season:url.searchParams.get("season")||"2026"});
    return json(payload,response);
  } catch (error) {
    const message=String(error?.message||error);
    if (/no such table|conference_memberships/i.test(message)) return response;
    if (message==="standings_sport_required") {
      return new Response(JSON.stringify({error:"standings_sport_required"}),{
        status:400,
        headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
      });
    }
    console.warn("conference standings truth route failed",{conferenceId,error:message});
    return response;
  }
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    if (request.method !== "GET") return response;
    const standingsResponse=await enforceConferenceStandingsRoute(request,response,env);
    if (standingsResponse!==response) return standingsResponse;
    return enforceMembershipTruth(response, env);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export {
  conferenceStandingsId,
  enforceConferenceStandingsRoute,
  enforceMembershipTruth,
  membershipRows,
  standingsSport
};
