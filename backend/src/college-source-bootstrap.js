import { parserReadyCollegeSourceCandidates } from "./college-source-platforms.js";

const safe = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

const SOURCE_INSERT_SQL = `
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
  SELECT incoming.*,t.id AS team_id
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
   expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes)
SELECT
  source_id,team_id,source_url,source_type,source_priority,parser_type,'m3-1','America/Chicago',
  expected_min_games,refresh_minutes,active_result_minutes,0,authority_rank,
  CASE WHEN refresh_minutes*3 > 720 THEN refresh_minutes*3 ELSE 720 END
FROM matched`;

export function collegeSourceId(candidate) {
  return `college-${safe(candidate.schoolId)}-${safe(candidate.sport)}-${safe(candidate.gender)}-${candidate.season}-${safe(candidate.parserType)}`;
}

function expectedMinimum(candidate) {
  if (candidate.sport === "football") return 6;
  if (candidate.sport === "basketball") return 12;
  if (candidate.sport === "soccer") return 6;
  if (candidate.sport === "volleyball") return 10;
  return 4;
}

export function certifiedCollegeSourceRows(certifiedKeys, season = "2026") {
  const allowed = certifiedKeys instanceof Set ? certifiedKeys : new Set(certifiedKeys || []);
  const rows=[];
  for (const candidate of parserReadyCollegeSourceCandidates(season)) {
    const key=`${candidate.schoolId}|${candidate.sport}|${candidate.gender}|${candidate.season}`;
    if (!allowed.has(key)) continue;
    rows.push({
      ...candidate,
      sourceId:collegeSourceId(candidate),
      expectedMinGames:expectedMinimum(candidate),
      refreshMinutes:360,
      activeResultMinutes:30,
      authorityRank:20,
      sourcePriority:1
    });
  }
  return rows;
}

export async function materializeCertifiedCollegeSources(env,{certifiedKeys,season="2026"}={}) {
  if (!env?.DB) throw new Error("D1 binding DB is required");
  const rows=certifiedCollegeSourceRows(certifiedKeys,season);
  if (!rows.length) return {status:"SKIPPED",requested:0,inserted:0};
  const result=await env.DB.prepare(SOURCE_INSERT_SQL).bind(JSON.stringify(rows)).run();
  return {
    status:"SUCCESS",
    requested:rows.length,
    rowsWritten:Number(result.meta?.rows_written||0),
    rowsRead:Number(result.meta?.rows_read||0),
    durationMs:Number(result.meta?.duration||0)||null
  };
}

export { SOURCE_INSERT_SQL };
