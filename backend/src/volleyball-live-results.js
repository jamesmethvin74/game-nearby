import { statewideSportConfig } from "./statewide-sport-config.js";
import { runStatewideLiveResultProbe, statewideResultSnapshotChanged } from "./statewide-live-results.js";

const CONFIG = statewideSportConfig("volleyball-girls");

export function volleyballResultSnapshotChanged(detailsJson, payload) {
  return statewideResultSnapshotChanged(detailsJson, payload, CONFIG, { acceptLegacySignature:true });
}

export async function runVolleyballLiveResultProbe(env, {
  fetchFn = fetch,
  now = new Date()
} = {}) {
  return runStatewideLiveResultProbe(env, CONFIG, {
    fetchFn,
    now,
    acceptLegacySignature:true,
    userAgent:"LocalBleachersAR-volleyball-live/2.0"
  });
}
