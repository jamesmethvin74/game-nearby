import app from "./m4-public-worker.js";
import { membershipPublicStatus } from "./conference-membership-truth.js";

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

  return json({
    ...body,
    team_statuses: applyMembershipTruthToStatuses(body.team_statuses, memberships),
    conference_membership_truth: {
      method: "durable-authority",
      explicit_rows: memberships.length,
      team_rows: body.team_statuses.length,
      fail_closed_unknowns: Math.max(0, body.team_statuses.length - memberships.length)
    }
  }, response);
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    if (request.method !== "GET") return response;
    return enforceMembershipTruth(response, env);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};

export { enforceMembershipTruth, membershipRows };
