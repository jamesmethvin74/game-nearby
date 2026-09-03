import inventory from "../data/arkansas-high-school-team-inventory.json" with { type: "json" };

export const MILESTONE1_VERIFY_PATH = "/api/v1/_m1-final-verify-20260903-629";

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

export async function milestoneOneFinalVerification(env) {
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
    matched_expected AS (
      SELECT et.external_school_id, et.team_code, t.id AS team_id
      FROM expected_targets et
      JOIN certified_schools cs
        ON cs.external_school_id=et.external_school_id
      JOIN teams t
        ON t.school_id=cs.school_id
       AND t.active=1
       AND t.season='2026'
       AND t.sport=CASE et.team_code
         WHEN 'FB' THEN 'football'
         WHEN 'MBB' THEN 'basketball'
         WHEN 'WBB' THEN 'basketball'
         WHEN 'MSO' THEN 'soccer'
         WHEN 'WSO' THEN 'soccer'
         WHEN 'WVB' THEN 'volleyball'
       END
       AND t.gender=CASE et.team_code
         WHEN 'FB' THEN 'boys'
         WHEN 'MBB' THEN 'boys'
         WHEN 'WBB' THEN 'girls'
         WHEN 'MSO' THEN 'boys'
         WHEN 'WSO' THEN 'girls'
         WHEN 'WVB' THEN 'girls'
       END
    ),
    physical_supported AS (
      SELECT t.id
      FROM certified_schools cs
      JOIN teams t
        ON t.school_id=cs.school_id
       AND t.active=1
       AND t.season='2026'
      WHERE
        (t.sport='football' AND t.gender='boys') OR
        (t.sport='basketball' AND t.gender IN ('boys','girls')) OR
        (t.sport='soccer' AND t.gender IN ('boys','girls')) OR
        (t.sport='volleyball' AND t.gender='girls')
    )
    SELECT
      (SELECT COUNT(DISTINCT external_school_id) FROM expected_targets) AS expected_certified_schools,
      (SELECT COUNT(DISTINCT external_school_id) FROM certified_schools) AS represented_certified_schools,
      (SELECT COUNT(*) FROM physical_supported) AS physical_supported_team_rows,
      (SELECT COUNT(*) FROM matched_expected) AS matched_expected_team_targets,
      (SELECT COUNT(*) FROM d1_migrations WHERE name='0011_milestone1_aaa_catalog_completion.sql') AS migration_0011_present,
      (SELECT COUNT(*) FROM d1_migrations WHERE name='0012_d1_read_budget_indexes.sql') AS migration_0012_present,
      (SELECT COUNT(*) FROM d1_migrations WHERE name='0013_milestone1_complete_team_materialization.sql') AS migration_0013_present,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name IN (
        'idx_canonical_members_reporting_team',
        'idx_games_team_record_lookup',
        'idx_games_source_time',
        'idx_games_opponent_time',
        'idx_sources_enabled_checked'
      )) AS protection_index_count,
      (SELECT GROUP_CONCAT(name, ',') FROM (
        SELECT name FROM sqlite_schema WHERE type='index' AND name IN (
          'idx_canonical_members_reporting_team',
          'idx_games_team_record_lookup',
          'idx_games_source_time',
          'idx_games_opponent_time',
          'idx_sources_enabled_checked'
        ) ORDER BY name
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
    migration_0011_present: Number(row.migration_0011_present || 0) === 1,
    migration_0012_present: Number(row.migration_0012_present || 0) === 1,
    migration_0013_present: Number(row.migration_0013_present || 0) === 1,
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
