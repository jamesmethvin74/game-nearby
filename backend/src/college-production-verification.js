import { collegeProductionActivationPlan } from "./college-production-activation.js";

const HIGH_SCHOOL_BASELINE = 1102;
const PROTECTION_INDEXES = [
  "idx_canonical_members_reporting_team",
  "idx_games_team_record_lookup",
  "idx_games_source_time",
  "idx_games_opponent_time",
  "idx_sources_enabled_checked"
];

export const COLLEGE_PRODUCTION_VERIFICATION_SQL = `
WITH expected_schools AS (
  SELECT json_extract(value,'$.id') AS school_id
  FROM json_each(?)
), expected_teams AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season
  FROM json_each(?)
), certified AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season
  FROM json_each(?)
), desired_sources AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season,
    json_extract(value,'$.sourceUrl') AS source_url,
    json_extract(value,'$.parserType') AS parser_type
  FROM json_each(?)
), target_team_rows AS (
  SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.active
  FROM teams t
  JOIN expected_teams x
    ON x.school_id=t.school_id
   AND x.sport=t.sport
   AND x.gender=t.gender
   AND x.season=t.season
), certified_team_rows AS (
  SELECT t.id,t.school_id,t.sport,t.gender,t.season,t.active
  FROM teams t
  JOIN certified c
    ON c.school_id=t.school_id
   AND c.sport=t.sport
   AND c.gender=t.gender
   AND c.season=t.season
), desired_source_matches AS (
  SELECT d.school_id,d.sport,d.gender,d.season,
    EXISTS (
      SELECT 1
      FROM teams t
      JOIN sources src ON src.team_id=t.id
      WHERE t.school_id=d.school_id
        AND t.sport=d.sport
        AND t.gender=d.gender
        AND t.season=d.season
        AND src.source_url=d.source_url
        AND src.parser_type=d.parser_type
    ) AS present,
    EXISTS (
      SELECT 1
      FROM teams t
      JOIN sources src ON src.team_id=t.id AND src.enabled=1
      WHERE t.school_id=d.school_id
        AND t.sport=d.sport
        AND t.gender=d.gender
        AND t.season=d.season
        AND src.source_url=d.source_url
        AND src.parser_type=d.parser_type
    ) AS enabled
  FROM desired_sources d
)
SELECT
  (SELECT COUNT(*) FROM schools s JOIN expected_schools x ON x.school_id=s.id WHERE s.level='college' AND s.catalog_scope='local') AS college_schools_present,
  (SELECT COUNT(*) FROM target_team_rows) AS college_targets_present,
  (SELECT COUNT(*) FROM certified_team_rows WHERE active=1) AS certified_teams_active,
  (SELECT COUNT(*) FROM target_team_rows t WHERE t.active=0) AS inactive_targets,
  (SELECT COUNT(*) FROM desired_source_matches WHERE present=1) AS certified_source_targets_present,
  (SELECT COUNT(*) FROM desired_source_matches WHERE enabled=1) AS certified_source_targets_enabled,
  (SELECT COUNT(*)
     FROM sources src JOIN target_team_rows t ON t.id=src.team_id
     WHERE NOT EXISTS (
       SELECT 1 FROM certified c
       WHERE c.school_id=t.school_id AND c.sport=t.sport AND c.gender=t.gender AND c.season=t.season
     )) AS inactive_target_source_rows,
  (SELECT COUNT(*)
     FROM sources src JOIN certified_team_rows t ON t.id=src.team_id
     WHERE src.enabled=1
       AND NOT EXISTS (
         SELECT 1 FROM desired_sources d
         WHERE d.school_id=t.school_id AND d.sport=t.sport AND d.gender=t.gender AND d.season=t.season
           AND d.source_url=src.source_url AND d.parser_type=src.parser_type
       )) AS unexpected_enabled_certified_sources,
  (SELECT COUNT(DISTINCT g.team_id)
     FROM games g
     JOIN certified_team_rows t ON t.id=g.team_id
     JOIN sources src ON src.id=g.source_id AND src.enabled=1
     WHERE datetime(g.scheduled_at)>=datetime(?)) AS certified_teams_with_current_observations,
  (SELECT COUNT(*)
     FROM games g
     JOIN certified_team_rows t ON t.id=g.team_id
     JOIN sources src ON src.id=g.source_id AND src.enabled=1
     WHERE datetime(g.scheduled_at)>=datetime(?)) AS current_college_observations,
  (SELECT COUNT(*)
     FROM games g
     JOIN certified_team_rows t ON t.id=g.team_id
     JOIN sources src ON src.id=g.source_id AND src.enabled=1
     WHERE datetime(g.scheduled_at)<datetime(?)) AS stale_prior_season_observations,
  (SELECT COUNT(*)
     FROM games g
     JOIN certified_team_rows t ON t.id=g.team_id
     JOIN sources src ON src.id=g.source_id AND src.enabled=1
     WHERE g.status='FINAL' AND datetime(g.scheduled_at)>=datetime(?)) AS current_final_results,
  (SELECT COUNT(*)
     FROM teams t JOIN schools s ON s.id=t.school_id
     WHERE s.level='high-school' AND s.catalog_scope='local' AND t.active=1) AS high_school_active_teams,
  (SELECT COUNT(*)
     FROM sqlite_master
     WHERE type='index' AND name IN (${PROTECTION_INDEXES.map(() => "?").join(",")})) AS protection_indexes_present
`;

export async function verifyCollegeProductionActivation(env, { season = "2026" } = {}) {
  if (!env?.DB) throw new Error("D1 binding DB is required");
  const plan = collegeProductionActivationPlan(season);
  const seasonStart = `${season}-07-01T00:00:00.000Z`;
  const statement = env.DB.prepare(COLLEGE_PRODUCTION_VERIFICATION_SQL).bind(
    JSON.stringify(plan.schools),
    JSON.stringify(plan.teams),
    JSON.stringify(plan.certifiedTargets),
    JSON.stringify(plan.sourceRows),
    seasonStart,seasonStart,seasonStart,seasonStart,
    ...PROTECTION_INDEXES
  );
  const result = await statement.first();
  const meta = result?.meta || {};
  const actual = { ...(result || {}) };
  delete actual.meta;
  const expected = {
    college_schools_present:plan.counts.schools,
    college_targets_present:plan.counts.teams,
    certified_teams_active:plan.counts.ready,
    inactive_targets:plan.counts.inactive,
    certified_source_targets_present:plan.counts.ready,
    certified_source_targets_enabled:plan.counts.ready,
    inactive_target_source_rows:0,
    unexpected_enabled_certified_sources:0,
    certified_teams_with_current_observations:plan.counts.ready,
    stale_prior_season_observations:0,
    high_school_active_teams:HIGH_SCHOOL_BASELINE,
    protection_indexes_present:PROTECTION_INDEXES.length
  };
  const exactKeys = Object.keys(expected);
  const exactPass = exactKeys.every(key => Number(actual[key]) === Number(expected[key]));
  const observationsPass = Number(actual.current_college_observations || 0) > 0;
  return {
    status: exactPass && observationsPass ? "VERIFIED" : "MISMATCH",
    season,
    expected,
    actual,
    rowsRead:Number(meta.rows_read || 0),
    rowsWritten:Number(meta.rows_written || 0),
    durationMs:Number(meta.duration || 0) || null
  };
}

export { HIGH_SCHOOL_BASELINE, PROTECTION_INDEXES };
