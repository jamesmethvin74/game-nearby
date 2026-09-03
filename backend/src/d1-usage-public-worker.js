import app from "./public-cors-worker.js";
import { loadD1Usage, publicBudgetSnapshot } from "./d1-usage-monitor.js";
import inventory from "../data/arkansas-high-school-team-inventory.json" with { type: "json" };

const USAGE_PATH = "/api/v1/d1-usage";
const BUDGET_PATH = "/api/v1/d1-budget";
const MILESTONE1_VERIFY_PATH = "/api/v1/_milestone1-close-20260903";
const BUDGET_CACHE_TTL_SECONDS = 300;
const PROTECTION_INDEXES = [
  "idx_canonical_members_reporting_team",
  "idx_games_team_record_lookup",
  "idx_games_source_time",
  "idx_games_opponent_time",
  "idx_sources_enabled_checked"
];
const EXPECTED_TEAM_TARGETS = Object.entries(inventory.certified_school_team_codes || {}).flatMap(
  ([external_school_id, teamCodes]) => (teamCodes || []).map(team_code => ({ external_school_id, team_code }))
);

function privateJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function publicBudgetJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? `public, max-age=${BUDGET_CACHE_TTL_SECONDS}` : "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function authorized(request, env) {
  return Boolean(env.REFRESH_TOKEN) && request.headers.get("x-refresh-token") === env.REFRESH_TOKEN;
}

function edgeCache() {
  try {
    return typeof caches !== "undefined" ? caches.default : null;
  } catch {
    return null;
  }
}

function budgetCacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${BUDGET_PATH}`);
}

async function publicBudgetResponse(request, env, ctx) {
  const cache = edgeCache();
  const key = cache ? budgetCacheKey(request) : null;
  if (cache && key) {
    const cached = await cache.match(key);
    if (cached) return cached;
  }

  try {
    const response = publicBudgetJson(publicBudgetSnapshot(await loadD1Usage(env)));
    if (cache && key) {
      const write = cache.put(key, response.clone()).catch(error => console.warn("D1 budget cache write failed", error));
      if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
      else await write;
    }
    return response;
  } catch (error) {
    console.error("D1 public budget monitor failed", error);
    return publicBudgetJson({ error: "budget_usage_unavailable" }, 503);
  }
}

async function milestoneOneVerification(env) {
  const expectedSchoolCount = Number(inventory?.summary?.certified_arkansas_high_school_orgs || 0);
  const expectedTeamTargetCount = Number(inventory?.summary?.certified_expected_team_targets || 0);
  const targetJson = JSON.stringify(EXPECTED_TEAM_TARGETS);

  const result = await env.DB.prepare(`
    WITH expected_targets AS (
      SELECT
        json_extract(value,'$.external_school_id') AS external_school_id,
        json_extract(value,'$.team_code') AS team_code
      FROM json_each(?)
    ),
    certified_schools AS (
      SELECT DISTINCT et.external_school_id, sei.school_id
      FROM expected_targets et
      JOIN school_external_identities sei
        ON sei.provider='dragonfly'
       AND sei.external_school_id=et.external_school_id
      JOIN schools sch
        ON sch.id=sei.school_id
       AND sch.level='high-school'
       AND sch.catalog_scope='local'
    ),
    physical_supported AS (
      SELECT et.external_school_id, et.team_code, t.id AS team_id
      FROM expected_targets et
      JOIN certified_schools cs ON cs.external_school_id=et.external_school_id
      JOIN teams t
        ON t.school_id=cs.school_id
       AND t.active=1
       AND t.season='2026'
       AND (
         (et.team_code='FB'  AND t.sport='football'   AND t.gender='boys') OR
         (et.team_code='MBB' AND t.sport='basketball' AND t.gender='boys') OR
         (et.team_code='WBB' AND t.sport='basketball' AND t.gender='girls') OR
         (et.team_code='MSO' AND t.sport='soccer'     AND t.gender='boys') OR
         (et.team_code='WSO' AND t.sport='soccer'     AND t.gender='girls') OR
         (et.team_code='WVB' AND t.sport='volleyball' AND t.gender='girls')
       )
    )
    SELECT
      (SELECT COUNT(DISTINCT external_school_id) FROM expected_targets) AS expected_certified_schools,
      (SELECT COUNT(DISTINCT external_school_id) FROM certified_schools) AS represented_certified_schools,
      (SELECT COUNT(*) FROM physical_supported) AS physical_supported_team_rows,
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT external_school_id, team_code FROM physical_supported
      )) AS matched_expected_team_targets,
      (SELECT COUNT(*) FROM d1_migrations WHERE name='0011_milestone1_aaa_catalog_completion.sql') AS migration_0011_present,
      (SELECT COUNT(*) FROM d1_migrations WHERE name='0012_d1_read_budget_indexes.sql') AS migration_0012_present,
      (SELECT COUNT(*) FROM sqlite_schema
        WHERE type='index' AND name IN (
          'idx_canonical_members_reporting_team',
          'idx_games_team_record_lookup',
          'idx_games_source_time',
          'idx_games_opponent_time',
          'idx_sources_enabled_checked'
        )) AS protection_index_count,
      (SELECT GROUP_CONCAT(name, ',') FROM (
        SELECT name FROM sqlite_schema
        WHERE type='index' AND name IN (
          'idx_canonical_members_reporting_team',
          'idx_games_team_record_lookup',
          'idx_games_source_time',
          'idx_games_opponent_time',
          'idx_sources_enabled_checked'
        )
        ORDER BY name
      )) AS protection_indexes
  `).bind(targetJson).all();

  const row = result.results?.[0] || {};
  const represented = Number(row.represented_certified_schools || 0);
  const physicalRows = Number(row.physical_supported_team_rows || 0);
  const matchedTargets = Number(row.matched_expected_team_targets || 0);
  return {
    generated_at: new Date().toISOString(),
    expected_certified_schools: expectedSchoolCount,
    represented_certified_schools: represented,
    schools_complete: represented === expectedSchoolCount,
    expected_supported_team_targets: expectedTeamTargetCount,
    physical_supported_team_rows: physicalRows,
    matched_expected_team_targets: matchedTargets,
    missing_expected_team_targets: Math.max(0, expectedTeamTargetCount - matchedTargets),
    duplicate_extra_team_rows: Math.max(0, physicalRows - matchedTargets),
    migration_0011_present: Number(row.migration_0011_present || 0) === 1,
    migration_0012_present: Number(row.migration_0012_present || 0) === 1,
    protection_index_count: Number(row.protection_index_count || 0),
    protection_indexes: String(row.protection_indexes || "").split(",").filter(Boolean),
    expected_protection_indexes: PROTECTION_INDEXES,
    d1_meta: {
      rows_read: Number(result.meta?.rows_read || 0),
      rows_written: Number(result.meta?.rows_written || 0),
      duration_ms: Number(result.meta?.duration || 0) || null
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === MILESTONE1_VERIFY_PATH) {
      try {
        return privateJson(await milestoneOneVerification(env));
      } catch (error) {
        console.error("Milestone 1 verification failed", error);
        return privateJson({ error: "milestone1_verification_failed", message: String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === BUDGET_PATH) {
      return publicBudgetResponse(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === USAGE_PATH) {
      if (!authorized(request, env)) return privateJson({ error: "not_found" }, 404);

      try {
        return privateJson(await loadD1Usage(env));
      } catch (error) {
        console.error("D1 usage monitor failed", error);
        const message = String(error?.message || error);
        const configurationError = message.includes("not configured");
        return privateJson({
          error: configurationError ? "d1_usage_monitor_not_configured" : "d1_usage_monitor_failed",
          message
        }, configurationError ? 503 : 502);
      }
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
