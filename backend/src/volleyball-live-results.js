import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { statewideDragonFlySignature } from "./dragonfly-statewide.js";
import { certifiedStatewideSignature, runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

const CONFIG = statewideSportConfig("volleyball-girls");

function parseDetails(value) {
  try { return value ? JSON.parse(value) : {}; }
  catch { return {}; }
}

export function volleyballResultSnapshotChanged(detailsJson, payload) {
  const previousSignature = String(parseDetails(detailsJson)?.signature || "");
  const certifiedSignature = certifiedStatewideSignature(payload, CONFIG);
  const legacySignature = statewideDragonFlySignature(payload);
  const unchanged = Boolean(previousSignature)
    && (previousSignature === certifiedSignature || previousSignature === legacySignature);
  return {
    changed: !unchanged,
    previousSignature: previousSignature || null,
    // Do not force a one-time statewide write merely to convert the stored
    // signature format. If an unchanged production state still carries the
    // legacy signature, preserve it until a real semantic feed change occurs.
    signature: unchanged && previousSignature === legacySignature
      ? legacySignature
      : certifiedSignature
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
      "user-agent": "LocalBleachersAR-volleyball-live/2.0",
      accept: "application/json"
    }
  });
  const decision = volleyballResultSnapshotChanged(prior?.details_json, fetched.payload);

  // Live polling is a semantic probe first. An unchanged statewide payload must
  // stay genuinely read-only: no per-source heartbeat writes and no record work.
  if (!decision.changed) {
    return {
      status: "NOT_MODIFIED",
      rawEventCount: Array.isArray(fetched.payload?.schedule) ? fetched.payload.schedule.length : 0,
      pagesFetched: fetched.pageCount,
      signature: decision.signature,
      touchedTeams: 0,
      d1Writes: 0
    };
  }

  const result = await runCertifiedDragonFlyStatewideCollection(env, CONFIG, {
    payload: fetched.payload,
    now
  });
  return {
    ...result,
    pagesFetched: fetched.pageCount,
    liveProbe: true
  };
}
