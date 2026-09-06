import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { runDragonFlyStatewideCollection, statewideDragonFlySignature } from "./dragonfly-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

const CONFIG = statewideSportConfig("volleyball-girls");

function parseDetails(value) {
  try { return value ? JSON.parse(value) : {}; }
  catch { return {}; }
}

export function volleyballResultSnapshotChanged(detailsJson, payload) {
  const previousSignature = String(parseDetails(detailsJson)?.signature || "");
  const signature = statewideDragonFlySignature(payload);
  return {
    changed: !previousSignature || previousSignature !== signature,
    previousSignature: previousSignature || null,
    signature
  };
}

export async function runVolleyballLiveResultProbe(env, {
  fetchFn = fetch,
  now = new Date()
} = {}) {
  const prior = await env.DB.prepare(
    "SELECT details_json FROM statewide_collection_state WHERE id=?"
  ).bind(CONFIG.stateId).first();

  const fetched = await fetchDragonFlyPagedPayload(CONFIG.feedUrl, {
    fetchFn,
    headers: {
      "user-agent": "LocalBleachersAR-volleyball-live/1.0",
      accept: "application/json"
    }
  });
  const decision = volleyballResultSnapshotChanged(prior?.details_json, fetched.payload);

  // Live result polling is intentionally read-only when the semantic statewide
  // snapshot is unchanged. Do not touch ~185 source rows every 30 minutes just
  // to say that nothing changed.
  if (!decision.changed) {
    return {
      status: "NOT_MODIFIED",
      rawEventCount: Array.isArray(fetched.payload?.schedule) ? fetched.payload.schedule.length : 0,
      pagesFetched: fetched.pageCount,
      signature: decision.signature,
      d1Writes: 0
    };
  }

  const result = await runDragonFlyStatewideCollection(env, {
    payload: fetched.payload,
    feedUrl: CONFIG.feedUrl,
    stateId: CONFIG.stateId,
    now
  });
  return {
    ...result,
    pagesFetched: fetched.pageCount,
    liveProbe: true
  };
}
