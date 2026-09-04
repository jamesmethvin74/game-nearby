import fs from "node:fs";
import { collegeProductionActivationPlan } from "../src/college-production-activation.js";

const season = "2026";
const plan = collegeProductionActivationPlan(season);

if (plan.counts.teams !== 130 || plan.counts.ready !== 103 || plan.counts.inactive !== 27 || plan.counts.sourceRows !== 103) {
  throw new Error(`Unexpected M4 verification denominator: ${JSON.stringify(plan.counts)}`);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const desired = sqlLiteral(JSON.stringify(plan.sourceRows));
const targets = sqlLiteral(JSON.stringify(plan.teams));

const sql = `
WITH desired AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season,
    json_extract(value,'$.sourceUrl') AS source_url,
    json_extract(value,'$.parserType') AS parser_type
  FROM json_each(${desired})
), targets AS (
  SELECT
    json_extract(value,'$.schoolId') AS school_id,
    json_extract(value,'$.sport') AS sport,
    json_extract(value,'$.gender') AS gender,
    json_extract(value,'$.season') AS season
  FROM json_each(${targets})
), target_teams AS (
  SELECT t.id,t.active,t.school_id,t.sport,t.gender,t.season
  FROM targets x
  JOIN teams t
    ON t.school_id=x.school_id
   AND t.sport=x.sport
   AND t.gender=x.gender
   AND t.season=x.season
  JOIN schools sch ON sch.id=t.school_id
  WHERE sch.level='college' AND sch.catalog_scope='local'
), stats AS (
  SELECT
    (SELECT COUNT(*) FROM target_teams) AS target_teams,
    (SELECT COUNT(*) FROM target_teams WHERE active=1) AS active_teams,
    (SELECT COUNT(*) FROM target_teams WHERE active=0) AS inactive_teams,
    (SELECT COUNT(DISTINCT tt.id)
       FROM target_teams tt
       JOIN desired d
         ON d.school_id=tt.school_id
        AND d.sport=tt.sport
        AND d.gender=tt.gender
        AND d.season=tt.season
       JOIN sources s
         ON s.team_id=tt.id
        AND s.source_url=d.source_url
        AND s.parser_type=d.parser_type
        AND s.enabled=1
      WHERE tt.active=1) AS certified_enabled_teams,
    (SELECT COUNT(DISTINCT tt.id)
       FROM target_teams tt
       JOIN sources s ON s.team_id=tt.id AND s.enabled=1
      WHERE tt.active=0) AS inactive_enabled_teams,
    (SELECT COUNT(*)
       FROM target_teams tt
       JOIN sources s ON s.team_id=tt.id AND s.enabled=1
      WHERE NOT EXISTS (
        SELECT 1 FROM desired d
        WHERE d.school_id=tt.school_id
          AND d.sport=tt.sport
          AND d.gender=tt.gender
          AND d.season=tt.season
          AND d.source_url=s.source_url
          AND d.parser_type=s.parser_type
      )) AS wrong_enabled_rows
)
SELECT
  target_teams,
  active_teams,
  inactive_teams,
  certified_enabled_teams,
  inactive_enabled_teams,
  wrong_enabled_rows,
  CASE WHEN target_teams=130
         AND active_teams=103
         AND inactive_teams=27
         AND certified_enabled_teams=103
         AND inactive_enabled_teams=0
         AND wrong_enabled_rows=0
       THEN 1 ELSE 0 END AS ok
FROM stats;
`;

const normalized = sql.replace(/\s+/g," ").trim().toLowerCase();
for (const forbidden of [" update "," insert "," delete "," alter "," drop "," create "," replace "]) {
  if (` ${normalized} `.includes(forbidden)) throw new Error(`Verification SQL unexpectedly mutates data: ${forbidden.trim()}`);
}

fs.writeFileSync(".m4-source-verify.sql", sql.trim() + "\n", "utf8");
console.log(JSON.stringify({status:"M4_SOURCE_VERIFICATION_RENDERED",teams:130,ready:103,inactive:27}));
