import app from "./logo-bootstrap-worker.js";
import { syncPublishedVolleyballConferenceMembership } from "./volleyball-conference-membership.js";

export const VOLLEYBALL_MEMBERSHIP_DIAGNOSTIC_PATH = "/api/v1/diagnostics/volleyball-membership";

function noStoreJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === VOLLEYBALL_MEMBERSHIP_DIAGNOSTIC_PATH) {
      try {
        const conferenceIds = url.searchParams.getAll("conference").map(value => String(value || "").trim()).filter(Boolean);
        const result = await syncPublishedVolleyballConferenceMembership(env, {
          conferenceIds: conferenceIds.length ? conferenceIds : null,
          dryRun: true,
          maxTeamChanges: 500,
          maxConferenceRows: 50
        });
        return noStoreJson(result);
      } catch (error) {
        console.error("volleyball membership diagnostic failed", String(error?.message || error));
        return noStoreJson({ error: "volleyball_membership_diagnostic_failed", message: String(error?.message || error) }, 500);
      }
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
