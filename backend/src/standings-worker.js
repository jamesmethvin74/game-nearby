import app from "./team-read-worker.js";
import { fetchPublishedStandings, listPublishedStandingsOptions } from "./published-standings.js";
import { reconcileFootballOverallRecords } from "./football-record-reconciliation.js";
import { loadMaterializedCalculatedStandings } from "./calculated-standings.js";

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

    // Once LocalBleachersAR has materialized a calculated conference from canonical
    // results, that is the live read authority. This makes a just-accepted FINAL
    // visible immediately instead of waiting for a third-party published table.
    try {
      const calculated = await loadMaterializedCalculatedStandings(env, {
        sport,
        conferenceId,
        season: "2026"
      });
      if (calculated) {
        return publicJson(request, {
          ...calculated,
          retrieved_at: new Date().toISOString()
        }, 200, "no-store");
      }
    } catch (error) {
      console.warn("calculated standings read failed; using published fallback", {
        sport,
        conferenceId,
        error: String(error?.message || error)
      });
    }

    try {
      let result = await fetchPublishedStandings({ sport, conferenceId });
      result = await reconcileFootballOverallRecords(result, { sport });
      return publicJson(request, { ...result, retrieved_at: new Date().toISOString() }, 200, "no-store");
    } catch (error) {
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
