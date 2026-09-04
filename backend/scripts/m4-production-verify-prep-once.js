import { spawnSync } from "node:child_process";
import { collegeProductionActivationPlan } from "../src/college-production-activation.js";

const DATABASE = "localbleachersar-sports";
const SEASON = "2026";
const plan = collegeProductionActivationPlan(SEASON);

const expected = {
  schools: 36,
  teams: 130,
  readyActive: 103,
  inactive: 27,
  sourceMatches: 103,
  newSourceEnabled: 0
};

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const schoolIds = JSON.stringify(plan.schools.map(row => row.id));
const teamIds = JSON.stringify(plan.teams.map(row => row.id));
const readyIds = JSON.stringify(plan.certifiedTargets.map(row => `${row.schoolId}-${row.sport}-${row.gender}-${row.season}`));
const desiredSources = JSON.stringify(plan.sourceRows);

const sql = `
WITH school_targets AS (
  SELECT value AS id FROM json_each(${literal(schoolIds)})
), team_targets AS (
  SELECT value AS id FROM json_each(${literal(teamIds)})
), ready_targets AS (
  SELECT value AS id FROM json_each(${literal(readyIds)})
), desired AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season,
    json_extract(value,'$.sourceId') AS source_id,
    json_extract(value,'$.sourceUrl') AS source_url,
    json_extract(value,'$.parserType') AS parser_type
  FROM json_each(${literal(desiredSources)})
)
SELECT
  (SELECT COUNT(*) FROM schools s JOIN school_targets x ON x.id=s.id
    WHERE s.level='college' AND s.catalog_scope='local') AS schools,
  (SELECT COUNT(*) FROM teams t JOIN team_targets x ON x.id=t.id) AS teams,
  (SELECT COUNT(*) FROM teams t JOIN ready_targets x ON x.id=t.id WHERE t.active=1) AS readyActive,
  (SELECT COUNT(*) FROM teams t JOIN team_targets x ON x.id=t.id
    WHERE t.id NOT IN (SELECT id FROM ready_targets) AND t.active=0) AS inactive,
  (SELECT COUNT(*)
    FROM desired d
    JOIN teams t
      ON t.school_id=d.school_id
     AND t.sport=d.sport
     AND t.gender=d.gender
     AND t.season=d.season
    WHERE EXISTS (
      SELECT 1 FROM sources s
      WHERE s.team_id=t.id
        AND s.source_url=d.source_url
        AND s.parser_type=d.parser_type
    )) AS sourceMatches,
  (SELECT COUNT(*)
    FROM desired d
    JOIN sources s ON s.id=d.source_id
    WHERE s.enabled=1) AS newSourceEnabled
`;

const result = spawnSync("wrangler", [
  "d1", "execute", DATABASE,
  "--remote",
  `--command=${sql}`,
  "--json"
], { encoding:"utf8", maxBuffer:2 * 1024 * 1024 });

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "M4 read-only verification failed\n");
  process.exit(result.status || 1);
}

const payload = JSON.parse(result.stdout || "[]");
const query = payload?.[0] || {};
const row = query.results?.[0] || {};
const actual = Object.fromEntries(Object.keys(expected).map(key => [key, Number(row[key] ?? -1)]));
const meta = query.meta || {};
console.log(`M4_PREP_VERIFY_RESULT ${JSON.stringify({ actual, rowsRead:Number(meta.rows_read || 0), rowsWritten:Number(meta.rows_written || 0), durationMs:Number(meta.duration || 0) || null })}`);

for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(`M4 prep verification mismatch ${key}: ${actual[key]} != ${value}`);
  }
}

if (Number(meta.rows_written || 0) !== 0) throw new Error(`Read-only verification unexpectedly wrote ${meta.rows_written} rows`);
