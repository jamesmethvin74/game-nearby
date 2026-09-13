import { fetchDragonFlyPagedPayload } from "./dragonfly-feed.js";
import { statewideDragonFlySignature } from "./dragonfly-statewide.js";
import { certifiedStatewideSignature, runCertifiedDragonFlyStatewideCollection } from "./dragonfly-certified-statewide.js";
import { statewideSportConfig } from "./statewide-sport-config.js";

function parseDetails(value) {
  try { return value ? JSON.parse(value) : {}; }
  catch { return {}; }
}

export function statewideResultSnapshotChanged(detailsJson, payload, sportConfig, { acceptLegacySignature = false } = {}) {
  const config = statewideSportConfig(sportConfig);
  const previousSignature = String(parseDetails(detailsJson)?.signature || "");
  const certifiedSignature = certifiedStatewideSignature(payload, config);
  const legacySignature = acceptLegacySignature ? statewideDragonFlySignature(payload) : null;
  const unchanged = Boolean(previousSignature)
    && (previousSignature === certifiedSignature || (legacySignature && previousSignature === legacySignature));

  return {
    changed: !unchanged,
    previousSignature: previousSignature || null,
    // Preserve a legacy signature until a real semantic change occurs. This
    // avoids a one-time statewide write whose only purpose would be signature
    // format conversion.
    signature: unchanged && legacySignature && previousSignature === legacySignature
      ? legacySignature
      : certifiedSignature
  };
}

export async function runStatewideLiveResultProbe(env, sportConfig, {
  fetchFn = fetch,
  now = new Date(),
  acceptLegacySignature = false,
  userAgent = "LocalBleachersAR-statewide-live/1.0"
} = {}) {
  const config = statewideSportConfig(sportConfig);
  const prior = await env.DB.prepare(
    "SELECT details_json FROM statewide_collection_state WHERE id=?"
  ).bind(config.stateId).first();

  const fetched = await fetchDragonFlyPagedPayload(config.feedUrl, {
    fetchFn,
    headers: {
      "user-agent": userAgent,
      accept: "application/json"
    }
  });
  const decision = statewideResultSnapshotChanged(prior?.details_json, fetched.payload, config, { acceptLegacySignature });

  // The live path is a semantic probe first. An unchanged statewide payload
  // must remain genuinely read-only: no source heartbeat writes, no event
  // rewrites and no record rebuilds.
  if (!decision.changed) {
    return {
      status: "NOT_MODIFIED",
      sportKey: config.key,
      rawEventCount: Array.isArray(fetched.payload?.schedule) ? fetched.payload.schedule.length : 0,
      pagesFetched: fetched.pageCount,
      signature: decision.signature,
      touchedTeams: 0,
      d1Writes: 0
    };
  }

  const result = await runCertifiedDragonFlyStatewideCollection(env, config, {
    payload: fetched.payload,
    now
  });
  return {
    ...result,
    sportKey: config.key,
    pagesFetched: fetched.pageCount,
    liveProbe: true
  };
}
