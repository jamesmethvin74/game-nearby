import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const APPROVED_VOLLEYBALL_MEMBERSHIP_REPAIR_PATH =
  "/api/v1/diagnostics/volleyball-membership/repair-4a5-20260909-7f31d2";

const CONFERENCE_ID = "4a-5";
const EXPECTED_LOCAL_CONFERENCE_ID = "4a-5-volleyball";
const TEAM_IDS = [
  "df-vvme46-volleyball-2026",
  "df-y85lbp-volleyball-2026"
];

export async function runApprovedVolleyballMembershipRepair(env) {
  const result = await syncPublishedVolleyballConferenceMembership(env, {
    conferenceIds: [CONFERENCE_ID],
    targetTeamIds: TEAM_IDS,
    dryRun: false,
    maxTeamChanges: 2,
    maxConferenceRows: 1
  });

  const verificationResult = await env.DB.prepare(`
    SELECT t.id AS team_id,
      t.school_id,
      s.name AS school_name,
      t.conference_id,
      c.name AS conference_name
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conferences c ON c.id=t.conference_id
    WHERE t.id IN (SELECT value FROM json_each(?))
    ORDER BY t.id
  `).bind(JSON.stringify(TEAM_IDS)).all();

  const rows = verificationResult.results || [];
  const exactTeams = rows.length === TEAM_IDS.length
    && rows.every(row => TEAM_IDS.includes(String(row.team_id)));
  const membershipsCorrect = exactTeams
    && rows.every(row => String(row.conference_id || "") === EXPECTED_LOCAL_CONFERENCE_ID);
  const boundedWrites = Number(result.teamWrites || 0) <= 2
    && Number(result.conferenceWrites || 0) <= 1
    && Number(result.d1Statements || 0) === 2;
  const changedExpectedRows = Number(result.plan?.change_count || 0) === 2
    && Number(result.teamWrites || 0) === 2;

  return {
    ...result,
    approvedScope: {
      conference_id: CONFERENCE_ID,
      local_conference_id: EXPECTED_LOCAL_CONFERENCE_ID,
      team_ids: TEAM_IDS,
      max_team_changes: 2,
      max_conference_rows: 1
    },
    verification: {
      ok: membershipsCorrect && boundedWrites && changedExpectedRows,
      exactTeams,
      membershipsCorrect,
      boundedWrites,
      changedExpectedRows,
      rows
    }
  };
}
