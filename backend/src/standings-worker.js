import app from "./team-read-worker.js";
import { fetchPublishedStandings, listPublishedStandingsOptions } from "./published-standings.js";
import { reconcileFootballOverallRecords } from "./football-record-reconciliation.js";
import { loadMaterializedCalculatedStandings, overlayCalculatedStandings } from "./calculated-standings.js";
import { rebuildTeamRecords } from "./record-rebuild.js";

function publicJson(request, body, status = 200, cacheControl = "public, max-age=120, stale-while-revalidate=300") {
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === "https://jamesmethvin74.github.io" || origin.startsWith("http://localhost:")
    ? (origin || "*")
    : "null";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "access-control-allow-origin": allowed,
      "vary": "Origin"
    }
  });
}

async function rebuildMissingCalculatedConference(env, { sport, conferenceId, season = "2026" } = {}) {
  const result = await env.DB.prepare(`
    SELECT t.id
    FROM teams t
    JOIN schools s ON s.id=t.school_id
    WHERE t.active=1
      AND t.conference_id=?
      AND t.sport=?
      AND t.season=?
      AND s.catalog_scope='local'
    ORDER BY t.id
  `).bind(conferenceId, sport, season).all();
  const teamIds = (result.results || []).map(row => row.id).filter(Boolean);
  if (!teamIds.length) return null;

  // This is a bounded, one-conference recovery path. Normal result collection
  // already rebuilds records + standings in the same cycle. We only invoke this
  // when no calculated standings exist yet (for example, finals collected before
  // the standings materialization code was deployed).
  await rebuildTeamRecords(env, teamIds);
  return loadMaterializedCalculatedStandings(env, { sport, conferenceId, season });
}

async function handleStandingsRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;

  if (url.pathname === "/api/v1/standings/options") {
    const sport = String(url.searchParams.get("sport") || "volleyball").toLowerCase();
    try {
      return publicJson(request, await listPublishedStandingsOptions({ sport }));
    } catch (error) {
      return publicJson(request, { error: "standings_options_failed", message: String(error?.message || error) }, 502);
    }
  }

  if (url.pathname === "/api/v1/standings") {
    const sport = String(url.searchParams.get("sport") || "volleyball").toLowerCase();
    const conferenceId = String(url.searchParams.get("conference") || "").toLowerCase();
    if (!conferenceId) return publicJson(request, { error: "conference_required" }, 400, "no-store");

    // Canonical LocalBleachersAR results remain the record authority, but an
    // incomplete local conference catalog must not collapse the visible table to
    // only the locally materialized teams. Full-coverage local cohorts can be
    // served directly. Incomplete cohorts are overlaid onto the published roster.
    let calculated = null;
    try {
      calculated = await loadMaterializedCalculatedStandings(env, {
        sport,
        conferenceId,
        season: "2026"
      });
      if (!calculated) {
        calculated = await rebuildMissingCalculatedConference(env, {
          sport,
          conferenceId,
          season: "2026"
        });
      }
      if (calculated?.conference?.coverage_complete) {
        return publicJson(request, {
          ...calculated,
          retrieved_at: new Date().toISOString()
        }, 200, "no-store");
      }
    } catch (error) {
      console.warn("calculated standings read/recovery failed; using published fallback", {
        sport,
        conferenceId,
        error: String(error?.message || error)
      });
      calculated = null;
    }

    try {
      let result = await fetchPublishedStandings({ sport, conferenceId });
      result = await reconcileFootballOverallRecords(result, { sport });
      if (calculated) result = overlayCalculatedStandings(result, calculated);
      return publicJson(request, { ...result, retrieved_at: new Date().toISOString() }, 200, "no-store");
    } catch (error) {
      // If the published roster is temporarily unavailable, a partial canonical
      // table is still better than a 502. This does not mark local coverage complete.
      if (calculated) {
        return publicJson(request, {
          ...calculated,
          retrieved_at: new Date().toISOString(),
          partial_roster: true
        }, 200, "no-store");
      }
      return publicJson(request, { error: "standings_unavailable", message: String(error?.message || error) }, 502, "no-store");
    }
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const standingsResponse = await handleStandingsRequest(request, env);
    if (standingsResponse) return standingsResponse;
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
