import { fetchPublishedStandings } from "./published-standings.js";
import { loadMaterializedCalculatedStandings } from "./calculated-standings.js";
import {
  cohortTruthState,
  parseStandingsRecord,
  reconcileConferenceStandings,
  schoolKey
} from "./conference-standings-truth.js";

function recordGameCount(value = "") {
  return (String(value || "").match(/\d+/g)?.map(Number) || [])
    .reduce((sum, part) => sum + part, 0);
}

function sameRecord(left, right) {
  const a=parseStandingsRecord(left);
  const b=parseStandingsRecord(right);
  return a.wins===b.wins && a.losses===b.losses && a.ties===b.ties;
}

/**
 * Keep the historical helper export for callers/tests, but normalize only
 * canonical/calculated rows. Source-published evidence is intentionally kept
 * under published_* fields by reconcileConferenceStandings and is never promoted
 * into canonical rank or record truth here.
 */
export function normalizeNotStartedStandings(result) {
  if (!result || !Array.isArray(result.standings)) return result;
  return {
    ...result,
    standings: result.standings.map(row => {
      if (row?.method === "source-published" || row?.standing_state === "source-published") return row;
      const conferenceGames = recordGameCount(row?.conference_record);
      if (conferenceGames > 0) {
        return {
          ...row,
          standing_state: row?.rank == null ? "unavailable" : "ranked"
        };
      }
      return {
        ...row,
        conference_record: "N/A",
        rank: null,
        standing_state: "not-started"
      };
    })
  };
}

async function tryPublishedStandings({ sport, conferenceId }) {
  try {
    return await fetchPublishedStandings({ sport, conferenceId });
  } catch (error) {
    console.warn("published standings cross-check unavailable", {
      sport,
      conferenceId,
      error:String(error?.message || error)
    });
    return null;
  }
}

export async function loadDurableConferenceCohortState(env, {
  sport,
  conferenceId,
  season = "2026"
} = {}) {
  if (!env?.DB || !conferenceId || !sport) {
    return cohortTruthState({ expectedMembers:0, explicitMembers:0 });
  }
  const result=await env.DB.prepare(`
    SELECT
      COUNT(*) AS expected_members,
      SUM(CASE WHEN cm.team_id IS NOT NULL
        AND cm.membership_state='member'
        AND cm.conference_id=t.conference_id THEN 1 ELSE 0 END) AS explicit_members,
      SUM(CASE WHEN cm.membership_state='unknown' THEN 1 ELSE 0 END) AS unknown_members,
      SUM(CASE WHEN cm.team_id IS NULL
        OR cm.membership_state<>'member'
        OR COALESCE(cm.conference_id,'')<>COALESCE(t.conference_id,'') THEN 1 ELSE 0 END) AS invalid_memberships
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    LEFT JOIN conference_memberships cm ON cm.team_id=t.id
    WHERE t.active=1
      AND t.conference_id=?
      AND t.sport=?
      AND t.season=?
      AND s.catalog_scope='local'
  `).bind(conferenceId,String(sport).toLowerCase(),season).first();
  return cohortTruthState({
    expectedMembers:Number(result?.expected_members || 0),
    explicitMembers:Number(result?.explicit_members || 0),
    unknownMembers:Number(result?.unknown_members || 0),
    invalidMemberships:Number(result?.invalid_memberships || 0)
  });
}

export function calculatedResultEvidenceState(calculated, published, { expectedMembers = 0 } = {}) {
  const localRows=Array.isArray(calculated?.standings) ? calculated.standings : [];
  const sourceRows=Array.isArray(published?.standings) ? published.standings : [];
  const localBySchool=new Map(localRows.map(row=>[schoolKey(row.school_name),row]).filter(([key])=>key));
  const sourceBySchool=new Map(sourceRows.map(row=>[schoolKey(row.school_name),row]).filter(([key])=>key));
  let missingLocalRows=Math.max(0,Number(expectedMembers||0)-localRows.length);
  let publishedAhead=0;
  let unexplainedContradictions=0;

  for (const row of localRows) {
    const source=sourceBySchool.get(schoolKey(row.school_name));
    if (!source) continue;
    const localConference=parseStandingsRecord(row.conference_record);
    const localOverall=parseStandingsRecord(row.overall_record);
    const sourceConference=parseStandingsRecord(source.conference_record);
    const sourceOverall=parseStandingsRecord(source.overall_record);

    if (sourceConference.games > localConference.games || sourceOverall.games > localOverall.games) {
      publishedAhead += 1;
      continue;
    }
    if ((sourceConference.games===localConference.games && sourceConference.games>0 && !sameRecord(row.conference_record,source.conference_record))
      || (sourceOverall.games===localOverall.games && sourceOverall.games>0 && !sameRecord(row.overall_record,source.overall_record))) {
      unexplainedContradictions += 1;
    }
  }

  for (const row of sourceRows) {
    const key=schoolKey(row.school_name);
    if (key && !localBySchool.has(key)) missingLocalRows += 1;
  }

  return {
    result_evidence_complete:Number(expectedMembers||0)>0
      && missingLocalRows===0
      && publishedAhead===0
      && unexplainedContradictions===0,
    expected_members:Number(expectedMembers||0),
    calculated_rows:localRows.length,
    missing_local_rows:missingLocalRows,
    published_ahead_rows:publishedAhead,
    unexplained_record_contradictions:unexplainedContradictions
  };
}

/**
 * Resolve one conference through one truth contract for Team Detail and the
 * standings surface.
 *
 * Canonical policy:
 * - materialized local records are the only candidates for calculated truth;
 * - durable M9 membership rows certify the conference cohort;
 * - rank is exposed only when that durable cohort and local result evidence are complete;
 * - published tables are cross-check evidence only and never overwrite local
 *   conference/overall records or calculated rank;
 * - when local truth is absent, source-published rows may be exposed explicitly
 *   as unverified evidence with canonical rank/records left null.
 */
export async function loadStandingsTruth(env, {
  sport,
  conferenceId,
  season = "2026"
} = {}) {
  const normalizedSport = String(sport || "").toLowerCase();
  const normalizedConferenceId = String(conferenceId || "").toLowerCase();
  if (!normalizedConferenceId) throw new Error("conference_required");

  let calculated = null;
  try {
    calculated = await loadMaterializedCalculatedStandings(env, {
      sport: normalizedSport,
      conferenceId: normalizedConferenceId,
      season
    });
  } catch (error) {
    console.warn("calculated standings read failed", {
      sport:normalizedSport,
      conferenceId:normalizedConferenceId,
      error:String(error?.message || error)
    });
  }

  const [published,membershipState] = await Promise.all([
    tryPublishedStandings({ sport:normalizedSport, conferenceId:normalizedConferenceId }),
    loadDurableConferenceCohortState(env, {
      sport:normalizedSport,
      conferenceId:normalizedConferenceId,
      season
    }).catch(error=>{
      console.warn("durable membership cohort read failed",{
        sport:normalizedSport,
        conferenceId:normalizedConferenceId,
        error:String(error?.message||error)
      });
      return cohortTruthState({ expectedMembers:0, explicitMembers:0, invalidMemberships:1 });
    })
  ]);

  const resultEvidence=calculatedResultEvidenceState(calculated,published,{
    expectedMembers:membershipState.expected_members
  });
  const result = reconcileConferenceStandings({
    calculated,
    published,
    membershipComplete:membershipState.membership_complete,
    resultEvidenceComplete:resultEvidence.result_evidence_complete
  });

  if (!result) {
    const error = new Error("standings_unavailable");
    error.code = "standings_unavailable";
    throw error;
  }
  const normalized=normalizeNotStartedStandings(result);
  return {
    ...normalized,
    conference:{
      ...(normalized.conference || {}),
      coverage_complete:Boolean(membershipState.membership_complete && resultEvidence.result_evidence_complete),
      membership_complete:Boolean(membershipState.membership_complete),
      result_evidence_complete:Boolean(resultEvidence.result_evidence_complete),
      membership_truth:membershipState,
      result_evidence:resultEvidence
    }
  };
}
