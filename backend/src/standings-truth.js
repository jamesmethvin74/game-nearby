import { fetchPublishedStandings } from "./published-standings.js";
import { reconcileFootballOverallRecords } from "./football-record-reconciliation.js";
import { loadMaterializedCalculatedStandings, overlayCalculatedStandings } from "./calculated-standings.js";
import { overlayVolleyballLiveRecords } from "./volleyball-standings-overlay.js";
import { overlayFootballLiveRecords } from "./football-standings-overlay.js";

function recordGameCount(value = "") {
  return (String(value || "").match(/\d+/g)?.map(Number) || [])
    .reduce((sum, part) => sum + part, 0);
}

/**
 * A published 0-0 table can assign every team a synthetic "1st" before any
 * conference game has been played. That is membership, not a real standing.
 * Normalize that once in the shared truth resolver so Team Detail and the
 * Standings endpoint cannot disagree about not-started conferences.
 */
export function normalizeNotStartedStandings(result) {
  if (!result || !Array.isArray(result.standings)) return result;
  return {
    ...result,
    standings: result.standings.map(row => {
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

/**
 * Resolve one conference table through the same backend truth path for every caller.
 * This is deliberately response-agnostic so both /api/v1/standings and team-detail
 * status can consume the exact same standings result without client-side stitching.
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
    if (calculated?.conference?.coverage_complete) return normalizeNotStartedStandings(calculated);
  } catch (error) {
    console.warn("calculated standings read failed; using published fallback", {
      sport: normalizedSport,
      conferenceId: normalizedConferenceId,
      error: String(error?.message || error)
    });
    calculated = null;
  }

  try {
    let result = await fetchPublishedStandings({
      sport: normalizedSport,
      conferenceId: normalizedConferenceId
    });
    result = await reconcileFootballOverallRecords(result, { sport: normalizedSport });

    try {
      result = await overlayFootballLiveRecords(env, result, {
        sport: normalizedSport,
        season
      });
    } catch (error) {
      console.warn("live football standings overlay failed; preserving published table", {
        conferenceId: normalizedConferenceId,
        error: String(error?.message || error)
      });
    }

    try {
      result = await overlayVolleyballLiveRecords(env, result, {
        sport: normalizedSport,
        season
      });
    } catch (error) {
      console.warn("live volleyball standings overlay failed; preserving published table", {
        conferenceId: normalizedConferenceId,
        error: String(error?.message || error)
      });
    }

    if (calculated) result = overlayCalculatedStandings(result, calculated);
    return normalizeNotStartedStandings(result);
  } catch (error) {
    if (calculated) return normalizeNotStartedStandings({ ...calculated, partial_roster: true });
    throw error;
  }
}
