import {
  COLLEGE_SCHOOL_INSERT_SQL,
  COLLEGE_TEAM_INSERT_SQL,
  collegeCatalogSeed
} from "./college-catalog.js";
import { certifiedCollegeSourceRows } from "./college-source-bootstrap.js";
import {
  blockedPrestoAuthorityTargets,
  parserReadyCollegeSourceCandidates,
  pendingPrestoFallbackTargets
} from "./college-source-resolution.js";

const targetKey = row => `${row.schoolId}|${row.sport}|${row.gender}|${row.season}`;

export const COLLEGE_TEAM_ACTIVATION_SQL = `
WITH certified AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season
  FROM json_each(?)
), targets AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season
  FROM json_each(?)
)
UPDATE teams
SET active = CASE WHEN EXISTS (
      SELECT 1 FROM certified c
      WHERE c.school_id=teams.school_id
        AND c.sport=teams.sport
        AND c.gender=teams.gender
        AND c.season=teams.season
    ) THEN 1 ELSE 0 END,
    updated_at=CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM targets x
  WHERE x.school_id=teams.school_id
    AND x.sport=teams.sport
    AND x.gender=teams.gender
    AND x.season=teams.season
)`;

// M4 deliberately avoids creating a duplicate source when a pre-M3 pilot source
// already represents the same team, URL and parser. Newly created rows remain
// disabled until the separately approved production activation step.
export const COLLEGE_SOURCE_PREPARE_SQL = `
WITH incoming AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season,
    json_extract(value,'$.sourceId') AS source_id,
    json_extract(value,'$.sourceUrl') AS source_url,
    json_extract(value,'$.sourceType') AS source_type,
    json_extract(value,'$.parserType') AS parser_type,
    CAST(json_extract(value,'$.expectedMinGames') AS INTEGER) AS expected_min_games,
    CAST(json_extract(value,'$.refreshMinutes') AS INTEGER) AS refresh_minutes,
    CAST(json_extract(value,'$.activeResultMinutes') AS INTEGER) AS active_result_minutes,
    CAST(json_extract(value,'$.authorityRank') AS INTEGER) AS authority_rank,
    CAST(json_extract(value,'$.sourcePriority') AS INTEGER) AS source_priority
  FROM json_each(?)
), matched AS (
  SELECT incoming.*,t.id AS team_id,sch.latitude AS home_latitude,sch.longitude AS home_longitude
  FROM incoming
  JOIN teams t
    ON t.school_id=incoming.school_id
   AND t.sport=incoming.sport
   AND t.gender=incoming.gender
   AND t.season=incoming.season
   AND t.active=1
  JOIN schools sch
    ON sch.id=t.school_id
   AND sch.level='college'
   AND sch.catalog_scope='local'
)
INSERT OR IGNORE INTO sources
  (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
   expected_min_games,refresh_minutes,active_result_minutes,home_latitude,home_longitude,
   enabled,authority_rank,stale_after_minutes)
SELECT
  source_id,team_id,source_url,source_type,source_priority,parser_type,'m4-1','America/Chicago',
  expected_min_games,refresh_minutes,active_result_minutes,home_latitude,home_longitude,
  0,authority_rank,CASE WHEN refresh_minutes*3 > 720 THEN refresh_minutes*3 ELSE 720 END
FROM matched m
WHERE NOT EXISTS (
  SELECT 1 FROM sources existing
  WHERE existing.team_id=m.team_id
    AND existing.source_url=m.source_url
    AND existing.parser_type=m.parser_type
)`;

export function collegeProductionActivationPlan(season = "2026") {
  const catalog = collegeCatalogSeed(season);
  const ready = parserReadyCollegeSourceCandidates(season);
  const pending = pendingPrestoFallbackTargets(season);
  const blocked = blockedPrestoAuthorityTargets(season);
  const certifiedKeys = new Set(ready.map(targetKey));
  const sourceRows = certifiedCollegeSourceRows(certifiedKeys, season);

  if (ready.length + pending.length + blocked.length !== catalog.teams.length) {
    throw new Error(`College activation resolution mismatch ${ready.length}+${pending.length}+${blocked.length}/${catalog.teams.length}`);
  }
  if (sourceRows.length !== ready.length) {
    throw new Error(`College activation source mismatch ${sourceRows.length}/${ready.length}`);
  }

  return {
    season,
    schools: catalog.schools,
    teams: catalog.teams,
    certifiedTargets: ready,
    pendingTargets: pending,
    blockedTargets: blocked,
    sourceRows,
    counts: {
      schools: catalog.schools.length,
      teams: catalog.teams.length,
      ready: ready.length,
      inactive: pending.length + blocked.length,
      pending: pending.length,
      blocked: blocked.length,
      sourceRows: sourceRows.length
    }
  };
}

export async function prepareCollegeProductionActivation(env, { season = "2026" } = {}) {
  if (!env?.DB) throw new Error("D1 binding DB is required");
  const plan = collegeProductionActivationPlan(season);
  const results = await env.DB.batch([
    env.DB.prepare(COLLEGE_SCHOOL_INSERT_SQL).bind(JSON.stringify(plan.schools)),
    env.DB.prepare(COLLEGE_TEAM_INSERT_SQL).bind(JSON.stringify(plan.teams)),
    env.DB.prepare(COLLEGE_TEAM_ACTIVATION_SQL).bind(JSON.stringify(plan.certifiedTargets), JSON.stringify(plan.teams)),
    env.DB.prepare(COLLEGE_SOURCE_PREPARE_SQL).bind(JSON.stringify(plan.sourceRows))
  ]);
  const meta = results.map(result => result?.meta || {});
  return {
    status: "PREPARED_DISABLED",
    season,
    ...plan.counts,
    rowsRead: meta.reduce((sum,row) => sum + Number(row.rows_read || 0), 0),
    rowsWritten: meta.reduce((sum,row) => sum + Number(row.rows_written || 0), 0),
    durationMs: meta.reduce((sum,row) => sum + Number(row.duration || 0), 0) || null
  };
}
