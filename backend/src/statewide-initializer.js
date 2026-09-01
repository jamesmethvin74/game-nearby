import { syncDragonFlyVarsityVolleyballCatalog } from "./dragonfly-discovery.js";
import { runDragonFlyStatewideCollection } from "./dragonfly-statewide.js";
import { syncArkansasSchoolLocations } from "./arkansas-school-locations.js";
import { syncMaxPrepsSchoolBranding } from "./school-branding.js";
import { syncCuratedSchoolBranding } from "./school-branding-curated-sync.js";

let bootstrapPromise = null;

async function statewideDataReady(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT t.school_id)
       FROM teams t JOIN schools s ON s.id=t.school_id
       WHERE t.active=1
         AND s.catalog_scope='local'
         AND t.sport='volleyball'
         AND t.gender='girls'
         AND t.season='2026') AS local_schools,
      (SELECT COUNT(*)
       FROM canonical_events
       WHERE sport='volleyball'
         AND gender='girls'
         AND season='2026') AS canonical_games
  `).first();

  return Number(row?.local_schools || 0) >= 100
    && Number(row?.canonical_games || 0) >= 500;
}

async function ensureBranding(env) {
  try {
    const branding = await syncMaxPrepsSchoolBranding(env);
    if (branding?.status !== "SKIPPED") console.log("statewide school branding", branding);
  } catch (error) {
    console.error("statewide school branding sync failed; keeping last-known logos", error);
  }
  try {
    const curated = await syncCuratedSchoolBranding(env);
    if (curated?.status !== "SUCCESS" || curated?.populated) console.log("statewide curated school branding", curated);
  } catch (error) {
    console.error("statewide curated school branding sync failed; keeping last-known logos", error);
  }
}

async function runInitialStatewideCycle(env) {
  console.log("statewide volleyball initial production bootstrap starting");
  let catalogPayload = null;
  try {
    const catalog = await syncDragonFlyVarsityVolleyballCatalog(env);
    catalogPayload = catalog.payload || null;
    const { payload, ...summary } = catalog;
    console.log("statewide volleyball initial catalog", summary);

    const locations = await syncArkansasSchoolLocations(env);
    console.log("statewide volleyball initial locations", {
      status: locations.status,
      targetSchools: locations.targetSchools,
      matchedSchools: locations.matchedSchools,
      unresolvedSchools: locations.unresolvedSchools,
      ambiguousSchools: locations.ambiguousSchools,
      matchRatio: locations.matchRatio
    });

    await ensureBranding(env);

    const statewide = await runDragonFlyStatewideCollection(env, { payload: catalogPayload });
    console.log("statewide volleyball initial collection", statewide);

    if (!await statewideDataReady(env)) {
      throw new Error("Statewide bootstrap completed but production readiness thresholds were not met.");
    }

    console.log("statewide volleyball initial production bootstrap complete");
    return true;
  } finally {
    await env.DB.prepare("UPDATE sources SET enabled=0 WHERE collection_mode='statewide'").run();
  }
}

export async function ensureInitialStatewideData(env) {
  // Branding has its own freshness state and should refresh even if lazy schedule
  // bootstrap is disabled. This keeps mascot logos independent from schedule ingest.
  await ensureBranding(env);

  if (String(env.LAZY_STATEWIDE_BOOTSTRAP || "") !== "1") return false;
  if (await statewideDataReady(env)) return true;

  if (!bootstrapPromise) {
    bootstrapPromise = runInitialStatewideCycle(env)
      .finally(() => { bootstrapPromise = null; });
  }

  return bootstrapPromise;
}
