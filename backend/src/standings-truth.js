import { fetchPublishedStandings } from "./published-standings.js";
import { reconcileFootballOverallRecords } from "./football-record-reconciliation.js";
import { loadMaterializedCalculatedStandings, overlayCalculatedStandings } from "./calculated-standings.js";
import { overlayVolleyballLiveRecords } from "./volleyball-standings-overlay.js";
import { overlayFootballLiveRecords } from "./football-standings-overlay.js";

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
    if (calculated?.conference?.coverage_complete) return calculated;
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
    return result;
  } catch (error) {
    if (calculated) return { ...calculated, partial_roster: true };
    throw error;
  }
}
