import { fetchPublishedStandings } from "./published-standings.js";
import { loadMaterializedCalculatedStandings } from "./calculated-standings.js";
import { reconcileConferenceStandings } from "./conference-standings-truth.js";

function recordGameCount(value = "") {
  return (String(value || "").match(/\d+/g)?.map(Number) || [])
    .reduce((sum, part) => sum + part, 0);
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

/**
 * Resolve one conference through one truth contract for Team Detail and the
 * standings surface.
 *
 * Canonical policy:
 * - materialized local records are the only candidates for calculated truth;
 * - rank is exposed only for a coverage-certified local cohort;
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

  const published = await tryPublishedStandings({
    sport:normalizedSport,
    conferenceId:normalizedConferenceId
  });

  const certified = Boolean(calculated?.conference?.coverage_complete);
  const result = reconcileConferenceStandings({
    calculated,
    published,
    // coverage_complete remains the explicit certification gate until the M9
    // durable statewide membership population is itself certified in production.
    membershipComplete:certified,
    resultEvidenceComplete:certified
  });

  if (!result) {
    const error = new Error("standings_unavailable");
    error.code = "standings_unavailable";
    throw error;
  }
  return normalizeNotStartedStandings(result);
}
